/**
 * DEMO mode for the invoice lookup connector.
 *
 * Fixtures are VERIFIED OPS Trax records captured from the portal (via the
 * GetOrders responses in GetOrders.md) — no synthetic order data. Served so
 * a customer demo can run before OPS Trax issues a live service credential.
 *
 * Gating is fail-safe and mutually exclusive with LIVE mode:
 *   - DEMO is active ONLY when OPSTRAX_DEMO_MODE is truthy AND
 *     OPSTRAX_BEARER_TOKEN is NOT provisioned.
 *   - If a live credential exists, DEMO mode is ignored entirely: demo data
 *     is NEVER substituted for a failing live request.
 * Every demo response is labeled `mode: "demo"` plus a `fixture` name.
 */
import type { ConnectorConfig } from "./config.ts";
import { buildOutcome, buildRoOutcome } from "./lookup.ts";
import type { GetOrdersResult } from "./opstrax.ts";
import type { LookupOutcome, OpstraxOrderRow } from "./types.ts";

/** Verified filled record: invoice 602136J (requestId 90141379). */
export const DEMO_FILLED_INVOICE = "602136J";
/** Verified unfilled record: RO 1420321294 (requestId 90145102) — no invoice number. */
export const DEMO_UNFILLED_RO = "1420321294";
/** Verified RO with two invoiced orders sharing it (requestIds 90168656, 89947164). */
export const DEMO_MULTI_RO = "2533043322";
/** Verified multi-RO invoice 1 (requestId 90168656). */
export const DEMO_MULTI_INVOICE_1 = "209140";
/** Verified multi-RO invoice 2 (requestId 89947164). */
export const DEMO_MULTI_INVOICE_2 = "208753";
/** Verified viewed record: RO 11704 (requestId 90160484) — no invoice number. */
export const DEMO_VIEWED_RO_1 = "11704";
/** Verified viewed record: RO 1410332453 (requestId 90159093) — no invoice number. */
export const DEMO_VIEWED_RO_2 = "1410332453";
/** Verified Partial record: invoice 601515J, RO 1420321273 (requestId 90051769). */
export const DEMO_PARTIAL_INVOICE_1 = "601515J";
export const DEMO_PARTIAL_RO_1 = "1420321273";
/** Verified Partial record: invoice 602307J, RO 11744 (requestId 90168346). */
export const DEMO_PARTIAL_INVOICE_2 = "602307J";
export const DEMO_PARTIAL_RO_2 = "11744";
/** Verified Unavailable record: RO 1421830434 (requestId 90117309); invoice is a placeholder. */
export const DEMO_UNAVAILABLE_RO = "1421830434";
/** Identifier of the recorded no-match envelope: {"results": [], "totalRecords": 0}. */
export const DEMO_NOT_FOUND_IDENTIFIER = "TEST-NOT-FOUND-99999";

/** Invoice placeholder used by OPS Trax when no invoice exists — not a searchable invoice. */
export const DEMO_INVOICE_PLACEHOLDER = "UNAVAILABLE";

/** Fixture names so a demo response can never masquerade as a live one. */
export type DemoFixture =
  | "filled_complete_602136J"
  | "filled_complete_209140"
  | "filled_complete_208753"
  | "unfilled_viewed_90145102"
  | "ro_multiple_2533043322"
  | "viewed_ro_11704"
  | "viewed_ro_1410332453"
  | "partial_invoice_601515J"
  | "partial_invoice_602307J"
  | "unavailable_ro_1421830434"
  | "recorded_no_match";

/**
 * Captured OPS Trax response, 2026-11-11 — requestId 90141379, invoice
 * 602136J, RO nm314470. Complete/filled, 1 of 1 parts invoiced, delivery
 * 2026-11-11. NOT shipped and NOT delivered (shippedDate/arrivedDate null).
 */
const DEMO_FILLED_ROW: OpstraxOrderRow = {
  requestId: 90141379,
  roNumber: "nm314470",
  invoiceNumber: "602136J",
  shopName: "Royal Coach - St. Charles",
  vehicleModel: "3",
  vMakecode: "MAZD",
  status: 2,
  statusName: "Complete",
  isFilled: true,
  isPartial: false,
  orderQty: 1,
  invoiceQty: 1,
  deliveryDate: "2026-11-11T00:00:00",
  shippedDate: null,
  arrivedDate: null,
};

/**
 * Captured OPS Trax response, 2026-11-10 — requestId 90145102, RO
 * 1420321294. Viewed/unfilled, 1 of 1 parts on order, 0 invoiced. This
 * order has NO invoice number; the null is part of the verified record.
 */
const DEMO_UNFILLED_ROW: OpstraxOrderRow = {
  requestId: 90145102,
  roNumber: "1420321294",
  invoiceNumber: null,
  shopName: "Gerber - Bloomington",
  vehicleModel: 'Silverado 1500 RST Crew Cab 147" WB 4WD',
  vMakecode: "CHEV",
  status: 1,
  statusName: "Viewed",
  isFilled: false,
  isPartial: false,
  orderQty: 1,
  invoiceQty: 0,
  deliveryDate: null,
};

/**
 * Captured OPS Trax response — requestId 90168656, invoice 209140, RO
 * 2533043322. Complete/filled, 1 of 1 parts invoiced, delivery 2026-11-11.
 * This RO shares TWO invoiced orders (see DEMO_MULTI_ROW_2). vMakecode
 * carries the portal's trailing-space padding ("VW  ") verbatim.
 * NOT shipped and NOT delivered (shippedDate/arrivedDate null).
 */
const DEMO_MULTI_ROW_1: OpstraxOrderRow = {
  requestId: 90168656,
  invoiceNumber: "209140",
  roNumber: "2533043322",
  vehicleModel: "Atlas Cross Sport",
  vMakecode: "VW  ",
  shopName: "Caliber - Blue Island - Western Ave",
  status: 2,
  statusName: "Complete",
  isFilled: true,
  orderQty: 1,
  invoiceQty: 1,
  deliveryDate: "2026-11-11T00:00:00",
  shippedDate: null,
  arrivedDate: null,
};

/**
 * Captured OPS Trax response — requestId 89947164, invoice 208753, RO
 * 2533043322. Same RO and shop as DEMO_MULTI_ROW_1, earlier delivery
 * (2026-11-05). NOT shipped and NOT delivered (shippedDate/arrivedDate
 * null).
 */
const DEMO_MULTI_ROW_2: OpstraxOrderRow = {
  requestId: 89947164,
  invoiceNumber: "208753",
  roNumber: "2533043322",
  vehicleModel: "Atlas Cross Sport",
  vMakecode: "VW  ",
  shopName: "Caliber - Blue Island - Western Ave",
  status: 2,
  statusName: "Complete",
  isFilled: true,
  orderQty: 1,
  invoiceQty: 1,
  deliveryDate: "2026-11-05T00:00:00",
  shippedDate: null,
  arrivedDate: null,
};

/**
 * Captured OPS Trax response — requestId 90160484, RO 11704, invoiceNumber
 * null (the record is un-invoiced). Viewed/unfilled, 0 of 1 parts invoiced,
 * responseDate null (not yet quoted), deliveryDate null, isReceived false.
 */
const DEMO_VIEWED_ROW_1: OpstraxOrderRow = {
  requestId: 90160484,
  roNumber: "11704",
  invoiceNumber: null,
  shopName: "CARSTAR Todd's Body Shop",
  vehicleModel: "XTS Luxury FWD",
  vMakecode: "CADI",
  status: 1,
  statusName: "Viewed",
  isFilled: false,
  isPartial: false,
  orderQty: 1,
  invoiceQty: 0,
  unavailableCount: 0,
  deliveryDate: null,
  partialDate: null,
  shippedDate: null,
  arrivedDate: null,
  isReceived: false,
};

/**
 * Captured OPS Trax response — requestId 90159093, RO 1410332453,
 * invoiceNumber null (un-invoiced). Viewed/unfilled, 0 of 1 parts invoiced,
 * responseDate null, deliveryDate null, isReceived false.
 */
const DEMO_VIEWED_ROW_2: OpstraxOrderRow = {
  requestId: 90159093,
  roNumber: "1410332453",
  invoiceNumber: null,
  shopName: "Gerber - Crystal Lake",
  vehicleModel: "CT5 Premium Luxury",
  vMakecode: "CADI",
  status: 1,
  statusName: "Viewed",
  isFilled: false,
  isPartial: false,
  orderQty: 1,
  invoiceQty: 0,
  unavailableCount: 0,
  deliveryDate: null,
  partialDate: null,
  shippedDate: null,
  arrivedDate: null,
  isReceived: false,
};

/**
 * Captured OPS Trax response — requestId 90051769, invoice 601515J, RO
 * 1420321273. Status 3 "Partial" with isFilled=true — NOT Complete. 2 of 2
 * parts invoiced, receivedQty 0, isReceived=false. arrivedDate and
 * receivedDate are populated in the record but isReceived is still false —
 * never speak delivery/receipt from timestamps. deliveryDate (2026-11-09)
 * and partialDate (2026-11-16) are separate fields and are kept separate.
 */
const DEMO_PARTIAL_ROW_1: OpstraxOrderRow = {
  requestId: 90051769,
  roNumber: "1420321273",
  invoiceNumber: "601515J",
  shopName: "Gerber - Bloomington",
  vehicleModel: "CTS Sedan Luxury AWD",
  vMakecode: "CADI",
  status: 3,
  statusName: "Partial",
  isFilled: true,
  isPartial: true,
  orderQty: 2,
  invoiceQty: 2,
  unavailableCount: 0,
  deliveryDate: "2026-11-09T00:00:00",
  partialDate: "2026-11-16T00:00:00",
  shippedDate: null,
  arrivedDate: "2026-11-09T09:51:57.727",
  isReceived: false,
};

/**
 * Captured OPS Trax response — requestId 90168346, invoice 602307J, RO
 * 11744. Status 3 "Partial" with isFilled=true — NOT Complete. 10 of 10
 * parts invoiced, isReceived=false. deliveryDate (2026-11-12) and
 * partialDate (2026-11-16) preserved separately.
 */
const DEMO_PARTIAL_ROW_2: OpstraxOrderRow = {
  requestId: 90168346,
  roNumber: "11744",
  invoiceNumber: "602307J",
  shopName: "CARSTAR Todd's Body Shop",
  vehicleModel: 'Silverado 1500 LT Crew Cab 147" WB 4WD w/1LT Pkg',
  vMakecode: "CHEV",
  status: 3,
  statusName: "Partial",
  isFilled: true,
  isPartial: true,
  orderQty: 10,
  invoiceQty: 10,
  unavailableCount: 0,
  deliveryDate: "2026-11-12T00:00:00",
  partialDate: "2026-11-16T00:00:00",
  shippedDate: null,
  arrivedDate: null,
  isReceived: false,
};

/**
 * Captured OPS Trax response — requestId 90117309, RO 1421830434.
 * Status 4 "Unavailable" with isFilled=true — Unavailable is the status,
 * never Complete. invoiceNumber is the literal placeholder "UNAVAILABLE"
 * (retained exactly as captured, normalized to null for the agent — it is
 * a status marker, not a searchable invoice). 0 of 1 parts invoiced, 1
 * part unavailable, deliveryDate/partialDate both 2026-11-10 in the
 * record, isReceived=false.
 */
const DEMO_UNAVAILABLE_ROW: OpstraxOrderRow = {
  requestId: 90117309,
  roNumber: "1421830434",
  invoiceNumber: "UNAVAILABLE",
  shopName: "Gerber - Plainfield",
  vehicleModel: "Compass Latitude 4WD",
  vMakecode: "JEEP",
  status: 4,
  statusName: "Unavailable",
  isFilled: true,
  isPartial: false,
  orderQty: 1,
  invoiceQty: 0,
  unavailableCount: 1,
  deliveryDate: "2026-11-10T00:00:00",
  partialDate: "2026-11-10T00:00:00",
  shippedDate: null,
  arrivedDate: null,
  isReceived: false,
};

interface DemoFixtureEntry {
  rows: OpstraxOrderRow[];
  fixture: DemoFixture;
}

/** Fixtures keyed exactly as the records identify them (uppercased keys). */
const DEMO_BY_INVOICE: Record<string, DemoFixtureEntry> = {
  [DEMO_FILLED_INVOICE]: { rows: [DEMO_FILLED_ROW], fixture: "filled_complete_602136J" },
  [DEMO_MULTI_INVOICE_1]: { rows: [DEMO_MULTI_ROW_1], fixture: "filled_complete_209140" },
  [DEMO_MULTI_INVOICE_2]: { rows: [DEMO_MULTI_ROW_2], fixture: "filled_complete_208753" },
  [DEMO_PARTIAL_INVOICE_1]: { rows: [DEMO_PARTIAL_ROW_1], fixture: "partial_invoice_601515J" },
  [DEMO_PARTIAL_INVOICE_2]: { rows: [DEMO_PARTIAL_ROW_2], fixture: "partial_invoice_602307J" },
  // Note: "UNAVAILABLE" is deliberately NOT indexed as an invoice — it is a
  // status placeholder in the captured record, not an invoice identifier.
};

const DEMO_BY_RO: Record<string, DemoFixtureEntry> = {
  "NM314470": { rows: [DEMO_FILLED_ROW], fixture: "filled_complete_602136J" },
  [DEMO_UNFILLED_RO]: { rows: [DEMO_UNFILLED_ROW], fixture: "unfilled_viewed_90145102" },
  [DEMO_MULTI_RO]: {
    rows: [DEMO_MULTI_ROW_1, DEMO_MULTI_ROW_2],
    fixture: "ro_multiple_2533043322",
  },
  [DEMO_VIEWED_RO_1]: { rows: [DEMO_VIEWED_ROW_1], fixture: "viewed_ro_11704" },
  [DEMO_VIEWED_RO_2]: { rows: [DEMO_VIEWED_ROW_2], fixture: "viewed_ro_1410332453" },
  [DEMO_PARTIAL_RO_1]: { rows: [DEMO_PARTIAL_ROW_1], fixture: "partial_invoice_601515J" },
  [DEMO_PARTIAL_RO_2]: { rows: [DEMO_PARTIAL_ROW_2], fixture: "partial_invoice_602307J" },
  [DEMO_UNAVAILABLE_RO]: {
    rows: [DEMO_UNAVAILABLE_ROW],
    fixture: "unavailable_ro_1421830434",
  },
};

/**
 * DEMO mode is active only with the flag set AND no live credential.
 * Deliberately never consults the network — the demo path has no fetch.
 */
export function isDemoModeActive(config: ConnectorConfig): boolean {
  if (!config.demoMode) return false;
  return config.bearerToken === undefined;
}

export interface DemoLookup {
  outcome: LookupOutcome;
  fixture: DemoFixture;
}

/**
 * Invoice lookup over the verified fixtures. Reuses the exact-invoice
 * matching pipeline from LIVE mode, so demo responses obey the same
 * fail-closed rules: an unknown invoice maps to the recorded no-match
 * envelope (`results: []`), never to another order.
 */
export function lookupDemoInvoice(invoiceNumber: string): DemoLookup {
  const entry = DEMO_BY_INVOICE[invoiceNumber.toUpperCase()];
  if (entry === undefined) {
    return { outcome: notFound(invoiceNumber, "invoice"), fixture: "recorded_no_match" };
  }
  const result: GetOrdersResult = { kind: "ok", orders: entry.rows };
  return { outcome: buildOutcome(result, invoiceNumber), fixture: entry.fixture };
}

/** RO lookup over the verified fixtures (same fail-closed rules). */
export function lookupDemoOrderByRo(roNumber: string): DemoLookup {
  const entry = DEMO_BY_RO[roNumber.toUpperCase()];
  if (entry === undefined) {
    return { outcome: notFound(roNumber, "RO"), fixture: "recorded_no_match" };
  }
  const result: GetOrdersResult = { kind: "ok", orders: entry.rows };
  return { outcome: buildRoOutcome(result, roNumber), fixture: entry.fixture };
}

function notFound(identifier: string, label: string): LookupOutcome {
  return {
    status: "not_found",
    agent_message: `I could not find any order for ${label} ${identifier}.`,
  };
}
