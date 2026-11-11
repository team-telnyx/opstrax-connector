/**
 * Pure outcome-mapping logic for the invoice lookup handler.
 * Unit-tested in test/lookup.test.ts; no I/O.
 */
import { buildStatusSummary, matchOrders, matchOrdersBy } from "./invoice.ts";
import type { OrderMatchField } from "./invoice.ts";
import type { GetOrdersResult } from "./opstrax.ts";
import type { AgentOrder, LookupOutcome } from "./types.ts";

/** Map an OPS Trax call result onto the agent-facing outcome (by invoice). */
export function buildOutcome(
  result: GetOrdersResult,
  invoiceNumber: string,
): LookupOutcome {
  return buildOrderOutcome(result, invoiceNumber, "invoice_number");
}

/** Map an OPS Trax call result onto the agent-facing outcome (by RO). */
export function buildRoOutcome(
  result: GetOrdersResult,
  roNumber: string,
): LookupOutcome {
  return buildOrderOutcome(result, roNumber, "ro_number");
}

/** Field-parameterized outcome mapping. */
export function buildOrderOutcome(
  result: GetOrdersResult,
  identifier: string,
  field: OrderMatchField,
): LookupOutcome {
  const label = field === "ro_number" ? "RO" : "invoice";
  switch (result.kind) {
    case "not_configured":
      return {
        status: "not_configured",
        agent_message:
          "The OPS Trax integration is not configured yet. Credentials have not been issued.",
      };
    case "ok": {
      const match = matchOrdersBy(result.orders, identifier, field);
      switch (match.kind) {
        case "single":
          return {
            status: "found",
            order: match.order,
            orders: [match.order],
            matched_count: 1,
            agent_message: buildStatusSummary(match.order),
          };
        case "multiple": {
          // All exact matches are returned — the voice agent asks the caller
          // which invoice (or order) they meant rather than picking one.
          const all = [match.primary, ...match.others];
          return {
            status: "found",
            order: match.primary,
            orders: all,
            matched_count: all.length,
            agent_message: buildMultipleMatchSummary(identifier, label, field, all),
          };
        }
        case "none":
          return {
            status: "not_found",
            agent_message: `I could not find any order for ${label} ${identifier}.`,
          };
      }
    }
    case "upstream_failure":
      return upstreamOutcome(result.failure);
  }
}

/**
 * Message for multiple exact matches. Lists every matching identifier so
 * the voice agent can read them back and ask the caller which one to
 * check — it never silently picks the first.
 */
export function buildMultipleMatchSummary(
  identifier: string,
  label: string,
  field: OrderMatchField,
  orders: AgentOrder[],
): string {
  const items = orders.map((order) => {
    if (field === "ro_number") {
      // Same RO, different invoices — invoice number is the disambiguator.
      return order.invoice_number ? `invoice ${order.invoice_number}` : "an order with no invoice number yet";
    }
    // Same invoice, different orders — distinguish by requestId.
    return `order ${order.request_id ?? "with an unknown request id"}`;
  });
  const list =
    items.length === 2
      ? `${items[0]} and ${items[1]}`
      : `${items.slice(0, -1).join(", ")}, and ${items.at(-1)}`;
  return `${label} ${identifier} matches ${orders.length} orders: ${list}. Ask the caller which invoice they would like details for.`;
}

/** Failure-kind → agent outcome mapping. */
export function upstreamOutcome(
  failure: "auth_failure" | "not_found" | "api_error" | "network_error" | "unmapped_response",
): LookupOutcome {
  switch (failure) {
    case "auth_failure":
      return {
        status: "unauthorized",
        agent_message:
          "The OPS Trax credentials were rejected. The integration needs a valid service credential.",
      };
    case "not_found":
      return {
        status: "not_found",
        agent_message: "OPS Trax reports no orders for that invoice number.",
      };
    case "network_error":
    case "api_error":
    case "unmapped_response":
    default:
      return {
        status: "upstream_error",
        agent_message:
          "The OPS Trax service is not responding as expected. Please try again in a moment.",
      };
  }
}

/**
 * HTTP status policy: 2xx for "definitive, speakable" outcomes so the voice
 * agent keeps its turn; 4xx/5xx only for transport-level failures.
 */
export function outcomeHttpStatus(outcome: LookupOutcome): number {
  switch (outcome.status) {
    case "invalid_request":
      return 400;
    case "not_configured":
      return 503;
    case "unauthorized":
    case "upstream_error":
      return 502;
    case "found":
    case "not_found":
      return 200;
  }
}
