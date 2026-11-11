/**
 * Pure invoice-lookup logic: request validation, OPS Trax response
 * normalization, and failure classification.
 *
 * No I/O here — every function is deterministic and unit-tested in
 * test/invoice.test.ts.
 */
import type { AgentOrder, FailureKind, OpstraxOrderRow } from "./types.ts";

// ─── Request validation ─────────────────────────────────────────────────────

export type ParsedInvoice =
  | { ok: true; invoiceNumber: string }
  | { ok: false; error: "not_object" | "missing_field" };

/**
 * Validate a tool-call body of the shape { "invoice_number": "602136J" }.
 * Both snake_case and camelCase keys are accepted for resilience.
 */
export function parseInvoiceRequest(body: unknown): ParsedInvoice {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "not_object" };
  }
  const record = body as Record<string, unknown>;
  const raw = record.invoice_number ?? record.invoiceNumber;
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: "missing_field" };
  }
  return { ok: true, invoiceNumber: normalizeInvoiceNumber(raw) };
}

/** Trim and strip all internal whitespace (e.g. " 602 136J " → "602136J"). */
export function normalizeInvoiceNumber(raw: string): string {
  return raw.replace(/\s+/g, "").trim();
}

export type ParsedRo =
  | { ok: true; roNumber: string }
  | { ok: false; error: "not_object" | "missing_field" };

/**
 * Validate a tool-call body of the shape { "ro_number": "1420321294" }.
 * Both snake_case and camelCase keys are accepted for resilience.
 */
export function parseRoRequest(body: unknown): ParsedRo {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: "not_object" };
  }
  const record = body as Record<string, unknown>;
  const raw = record.ro_number ?? record.roNumber;
  if (typeof raw !== "string" || raw.trim() === "") {
    return { ok: false, error: "missing_field" };
  }
  return { ok: true, roNumber: normalizeInvoiceNumber(raw) };
}

// ─── Response extraction ─────────────────────────────────────────────────────
// The exact GetOrders response envelope is not documented by OPS Trax; the
// fields listed in src/types.ts are the confirmed contract. The extractor
// walks the parsed JSON and collects every object that carries an
// `invoiceNumber` key, so it tolerates unknown wrappings
// (arrays, {data:[...]}, {orders:{}}…).

/** True when the value looks like a parseable boolean; null otherwise. */
export function coerceBool(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value === "string") {
    const lowered = value.toLowerCase();
    if (lowered === "true") return true;
    if (lowered === "false") return false;
  }
  return null;
}

/** True when the value looks like a finite number; null otherwise. */
export function coerceNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

/** Coerce to a non-empty trimmed string, or null. */
export function coerceText(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** Coerce a numeric or string identifier (e.g. requestId) to a string, or null. */
function coerceId(value: unknown): string | null {
  if (typeof value === "number" && Number.isFinite(value)) return String(value);
  return coerceText(value);
}

/**
 * Invoice placeholder sent by OPS Trax when no invoice exists (e.g.
 * Unavailable status). It is a status marker, never a real invoice
 * identifier — normalize it to null so it can neither be searched as an
 * invoice nor spoken as one.
 */
const INVOICE_PLACEHOLDER = "UNAVAILABLE";

function normalizeInvoiceValue(value: unknown): string | null {
  const text = coerceText(value);
  if (text === null) return null;
  return text.toUpperCase() === INVOICE_PLACEHOLDER ? null : text;
}

/** Recursively collect objects that look like OPS Trax order rows. */
export function collectOrders(value: unknown, out: OpstraxOrderRow[] = []): OpstraxOrderRow[] {
  if (Array.isArray(value)) {
    for (const item of value) collectOrders(item, out);
    return out;
  }
  if (typeof value !== "object" || value === null) return out;
  const record = value as Record<string, unknown>;
  // RO-only orders may lack an invoiceNumber key entirely, so accept rows
  // identified by either documented key.
  if (Object.hasOwn(record, "invoiceNumber") || Object.hasOwn(record, "roNumber")) {
    out.push(record as OpstraxOrderRow);
  }
  for (const child of Object.values(record)) {
    collectOrders(child, out);
  }
  return out;
}

/** Coerce one raw OPS Trax row into the normalized agent shape. */
export function toAgentOrder(row: OpstraxOrderRow): AgentOrder {
  return {
    invoice_number: normalizeInvoiceValue(row.invoiceNumber),
    ro_number: coerceText(row.roNumber),
    request_id: coerceId(row.requestId),
    status_name: coerceText(row.statusName),
    is_filled: coerceBool(row.isFilled),
    is_partial: coerceBool(row.isPartial),
    order_qty: coerceNumber(row.orderQty),
    invoice_qty: coerceNumber(row.invoiceQty),
    delivery_date: coerceDate(row.deliveryDate),
    partial_date: coerceDate(row.partialDate),
    unavailable_count: coerceNumber(row.unavailableCount),
    is_received: coerceBool(row.isReceived),
    shop_name: coerceText(row.shopName),
    vehicle_model: vehicleDisplay(row),
  };
}

/**
 * Make codes seen in verified OPS Trax captures only. Unknown codes pass
 * through untouched — never invent mappings. Codes are trimmed before
 * matching because the portal pads some codes with spaces (e.g. "VW  ").
 */
const MAKECODES: Record<string, string> = {
  MAZD: "Mazda",
  CHEV: "Chevrolet",
  VW: "Volkswagen",
  CADI: "Cadillac",
  JEEP: "Jeep",
};

/** Combine vMakecode + vehicleModel into a speakable vehicle description. */
function vehicleDisplay(row: OpstraxOrderRow): string | null {
  const model = coerceText(row.vehicleModel);
  const code = coerceText(row.vMakecode);
  const make = code === null ? null : (MAKECODES[code.trim().toUpperCase()] ?? null);
  if (make === null) return model;
  if (model === null) return make;
  return model.toLowerCase().startsWith(make.toLowerCase())
    ? model
    : `${make} ${model}`;
}

/** Trim a timestamp ("2026-11-11T00:00:00") to its date part. */
function coerceDate(value: unknown): string | null {
  const text = coerceText(value);
  if (text === null) return null;
  const separator = text.indexOf("T");
  return separator === -1 ? text : text.slice(0, separator);
}

export type OrderMatch =
  | { kind: "none" }
  | { kind: "single"; order: AgentOrder }
  | { kind: "multiple"; primary: AgentOrder; others: AgentOrder[] };

/** Which AgentOrder field a lookup matches against. */
export type OrderMatchField = "invoice_number" | "ro_number";

/**
 * Match collected orders against the requested invoice number
 * (case-insensitive). Fail-closed: when no exact match exists, return
 * "none" — never substitute a different order the upstream happened to
 * return (e.g. if OPS ignored the invoice filter, the voice agent must
 * say "not found", not read out an unrelated customer's order).
 */
export function matchOrders(orders: OpstraxOrderRow[], invoiceNumber: string): OrderMatch {
  return matchOrdersBy(orders, invoiceNumber, "invoice_number");
}

/** Field-parameterized matching (see matchOrders for the fail-closed rules). */
export function matchOrdersBy(
  orders: OpstraxOrderRow[],
  value: string,
  field: OrderMatchField,
): OrderMatch {
  const wanted = normalizeInvoiceNumber(value).toLowerCase();
  const normalized = orders.map(toAgentOrder);
  const exact = normalized.filter((o) => o[field]?.toLowerCase() === wanted);
  if (exact.length === 1) return { kind: "single", order: exact[0]! };
  if (exact.length > 1) {
    return { kind: "multiple", primary: exact[0]!, others: exact.slice(1) };
  }
  return { kind: "none" };
}

// ─── Agent-facing message ───────────────────────────────────────────────────

/** Human-readable one-liner the assistant can read aloud. */
export function buildStatusSummary(order: AgentOrder): string {
  const status = order.status_name ?? "in an unknown status";
  // The (filled)/(not yet filled) parenthetical only clarifies statuses where
  // fill state adds meaning (e.g. Viewed). For Partial and Unavailable the
  // statusName already says everything — isFilled can be true there without
  // the order being fulfilled — so we never decorate it with "filled".
  const AMBIGUOUS_FILL_STATUSES = new Set(["Partial", "Unavailable"]);
  const filled = order.is_filled
    ? "filled"
    : order.is_filled === false
      ? "not yet filled"
      : "pending";
  const statusText = AMBIGUOUS_FILL_STATUSES.has(status)
    ? status
    : `${status} (${filled})`;
  // Records without an invoice number (e.g. un-invoiced orders) are
  // identified by their repair order instead — never invent an invoice.
  const subject = order.invoice_number
    ? `Invoice ${order.invoice_number} for RO ${order.ro_number ?? "unknown"}`
    : `Order for RO ${order.ro_number ?? "unknown"}`;
  const parts: string[] = [
    `${subject} is ${statusText}`,
  ];
  if (order.order_qty !== null && order.invoice_qty !== null) {
    parts.push(`${order.invoice_qty} of ${order.order_qty} parts invoiced`);
  } else if (order.order_qty !== null) {
    parts.push(`${order.order_qty} parts on the order`);
  }
  if (order.unavailable_count !== null && order.unavailable_count > 0) {
    parts.push(
      `${order.unavailable_count} part${order.unavailable_count === 1 ? "" : "s"} unavailable`,
    );
  }
  if (order.delivery_date) {
    parts.push(`delivery date ${order.delivery_date}`);
  }
  if (order.partial_date) {
    parts.push(`partial date ${order.partial_date}`);
  }
  if (order.vehicle_model) {
    parts.push(`for the ${order.vehicle_model}`);
  }
  if (order.shop_name) {
    parts.push(`going to ${order.shop_name}`);
  }
  // isReceived is an explicit API field — the only basis for a "received"
  // claim. Timestamps (receivedDate/arrivedDate) are never used to infer
  // delivery: a record can carry them while isReceived is still false.
  if (order.is_received === false && (order.invoice_qty ?? 0) > 0) {
    parts.push("not yet received");
  }
  return `${parts.join(", ")}.`;
}

// ─── Failure mapping ────────────────────────────────────────────────────────

/**
 * Map an OPS Trax HTTP status onto a failure kind.
 * 404 semantics are undocumented by OPS — it could mean "no rows" or
 * "wrong path/method". Treat it as an upstream error until OPS documents
 * it; a genuine no-match is more likely a 200 with an empty collection,
 * which collectOrders already reduces to "not found".
 */
export function classifyFailure(status: number): FailureKind {
  if (status === 401 || status === 403) return "auth_failure";
  return "api_error";
}
