import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildStatusSummary,
  classifyFailure,
  coerceBool,
  coerceNumber,
  coerceText,
  collectOrders,
  matchOrders,
  matchOrdersBy,
  normalizeInvoiceNumber,
  parseInvoiceRequest,
  parseRoRequest,
  toAgentOrder,
} from "../src/invoice.ts";

describe("parseInvoiceRequest", () => {
  it("test_valid_body_when_parsed_returns_invoice_number", () => {
    const parsed = parseInvoiceRequest({ invoice_number: "602136J" });
    assert.deepEqual(parsed, { ok: true, invoiceNumber: "602136J" });
  });

  it("test_camelCase_key_when_parsed_is_accepted", () => {
    const parsed = parseInvoiceRequest({ invoiceNumber: "602136J" });
    assert.deepEqual(parsed, { ok: true, invoiceNumber: "602136J" });
  });

  it("test_missing_field_when_parsed_is_rejected", () => {
    const parsed = parseInvoiceRequest({ other: "x" });
    assert.deepEqual(parsed, { ok: false, error: "missing_field" });
  });

  it("test_blank_field_when_parsed_is_rejected", () => {
    const parsed = parseInvoiceRequest({ invoice_number: "   " });
    assert.deepEqual(parsed, { ok: false, error: "missing_field" });
  });

  it("test_non_string_field_when_parsed_is_rejected", () => {
    const parsed = parseInvoiceRequest({ invoice_number: 42 });
    assert.deepEqual(parsed, { ok: false, error: "missing_field" });
  });

  it("test_non_object_body_when_parsed_is_rejected", () => {
    const parsed = parseInvoiceRequest("not an object");
    assert.deepEqual(parsed, { ok: false, error: "not_object" });
  });
});

describe("normalizeInvoiceNumber", () => {
  it("test_whitespace_riddled_input_when_normalized_strips_all_spaces", () => {
    assert.equal(normalizeInvoiceNumber(" 602 136J "), "602136J");
  });
});

describe("coerceText", () => {
  it("test_padded_string_when_coerced_returns_trimmed_text", () => {
    assert.equal(coerceText("  ok  "), "ok");
  });

  it("test_whitespace_only_string_when_coerced_returns_null", () => {
    assert.equal(coerceText("   "), null);
  });

  it("test_non_string_value_when_coerced_returns_null", () => {
    assert.equal(coerceText(42), null);
  });
});

describe("coerceBool", () => {
  it("test_true_string_when_coerced_returns_true", () => {
    assert.equal(coerceBool("TRUE"), true);
  });

  it("test_false_string_when_coerced_returns_false", () => {
    assert.equal(coerceBool("false"), false);
  });

  it("test_unknown_word_when_coerced_returns_null", () => {
    assert.equal(coerceBool("maybe"), null);
  });

  it("test_numeric_value_when_coerced_returns_null", () => {
    assert.equal(coerceBool(1), null);
  });
});

describe("coerceNumber", () => {
  it("test_numeric_string_when_coerced_returns_number", () => {
    assert.equal(coerceNumber("12"), 12);
  });

  it("test_finite_float_when_coerced_returns_number", () => {
    assert.equal(coerceNumber(3.5), 3.5);
  });

  it("test_non_numeric_string_when_coerced_returns_null", () => {
    assert.equal(coerceNumber("abc"), null);
  });

  it("test_empty_string_when_coerced_returns_null", () => {
    assert.equal(coerceNumber(""), null);
  });
});

describe("collectOrders", () => {
  it("test_wrapped_envelope_when_scanned_finds_order_rows", () => {
    const payload = {
      some: { data: { results: [{ invoiceNumber: "A", statusName: "Open" }] } },
    };
    const orders = collectOrders(payload);
    assert.equal(orders.length, 1);
  });

  it("test_flat_array_when_scanned_skips_non_order_objects", () => {
    const payload = [
      { invoiceNumber: "A" },
      { noMatch: true },
      { invoiceNumber: "B" },
    ];
    const orders = collectOrders(payload);
    assert.equal(orders.length, 2);
  });

  it("test_payload_without_orders_when_scanned_returns_empty", () => {
    assert.deepEqual(collectOrders({ hello: "world" }), []);
  });
});

describe("toAgentOrder", () => {
  it("test_verified_complete_row_when_normalized_maps_all_fields", () => {
    const agent = toAgentOrder({
      requestId: 90141379,
      roNumber: "nm314470",
      invoiceNumber: "602136J",
      shopName: "Royal Coach - St. Charles",
      vehicleModel: "3",
      vMakecode: "MAZD",
      statusName: "Complete",
      isFilled: true,
      orderQty: 1,
      invoiceQty: 1,
      deliveryDate: "2026-11-11T00:00:00",
      shippedDate: null,
      arrivedDate: null,
    });
    assert.deepEqual(agent, {
      invoice_number: "602136J",
      ro_number: "nm314470",
      request_id: "90141379",
      status_name: "Complete",
      is_filled: true,
      is_partial: null,
      order_qty: 1,
      invoice_qty: 1,
      delivery_date: "2026-11-11",
      partial_date: null,
      unavailable_count: null,
      is_received: null,
      shop_name: "Royal Coach - St. Charles",
      vehicle_model: "Mazda 3",
    });
  });

  it("test_verified_viewed_row_with_chevrolet_makecode_when_normalized_prefixes_make", () => {
    const agent = toAgentOrder({
      requestId: 90145102,
      roNumber: "1420321294",
      invoiceNumber: null,
      shopName: "Gerber - Bloomington",
      vehicleModel: 'Silverado 1500 RST Crew Cab 147" WB 4WD',
      vMakecode: "CHEV",
      statusName: "Viewed",
      isFilled: false,
      orderQty: 1,
      invoiceQty: 0,
      deliveryDate: null,
    });
    assert.equal(agent.vehicle_model, 'Chevrolet Silverado 1500 RST Crew Cab 147" WB 4WD');
    assert.equal(agent.invoice_number, null);
    assert.equal(agent.is_filled, false);
  });

  it("test_unknown_makecode_when_normalized_passes_model_through", () => {
    const agent = toAgentOrder({ invoiceNumber: "X", vehicleModel: "Civic", vMakecode: "UNK1" });
    assert.equal(agent.vehicle_model, "Civic");
  });

  it("test_model_already_containing_make_when_normalized_does_not_duplicate", () => {
    const agent = toAgentOrder({ invoiceNumber: "X", vehicleModel: "Mazda CX-5", vMakecode: "MAZD" });
    assert.equal(agent.vehicle_model, "Mazda CX-5");
  });

  it("test_sparse_row_when_normalized_yields_null_fields", () => {
    const agent = toAgentOrder({ invoiceNumber: "X" });
    assert.equal(agent.ro_number, null);
    assert.equal(agent.shop_name, null);
    assert.equal(agent.vehicle_model, null);
    assert.equal(agent.delivery_date, null);
  });

  it("test_garbage_values_when_normalized_yield_null_fields", () => {
    const agent = toAgentOrder({ invoiceNumber: "X", isFilled: "nonsense", orderQty: "abc" });
    assert.equal(agent.is_filled, null);
    assert.equal(agent.order_qty, null);
  });
});

describe("matchOrders", () => {
  // Verified OPS Trax records (requestId 90141379 / 90145102).
  const filled = {
    requestId: 90141379,
    invoiceNumber: "602136J",
    roNumber: "nm314470",
    statusName: "Complete",
    isFilled: true,
  };
  const unfilled = {
    requestId: 90145102,
    invoiceNumber: null,
    roNumber: "1420321294",
    statusName: "Viewed",
    isFilled: false,
  };

  it("test_exact_invoice_when_matched_returns_single", () => {
    const match = matchOrders([filled, unfilled], "602136j"); // case-insensitive
    assert.equal(match.kind, "single");
    if (match.kind === "single") assert.equal(match.order.ro_number, "nm314470");
  });

  it("test_multiple_exact_matches_when_matched_returns_multiple", () => {
    const match = matchOrders([filled, { ...filled, statusName: "Duplicate" }], "602136J");
    assert.equal(match.kind, "multiple");
    if (match.kind === "multiple") {
      assert.equal(match.primary.status_name, "Complete");
      assert.equal(match.others.length, 1);
    }
  });

  it("test_no_exact_match_when_looked_up_returns_none", () => {
    // Fail-closed: an unmatched invoice never falls back to some other
    // order — the voice agent must say "not found".
    const match = matchOrders([filled], "999999Z");
    assert.equal(match.kind, "none");
  });

  it("test_empty_result_when_looked_up_returns_none", () => {
    const match = matchOrders([], "602136J");
    assert.equal(match.kind, "none");
  });

  it("test_uninvoiced_row_when_matched_by_invoice_is_not_found", () => {
    // The unfilled record has no invoice number; invoice lookup must not
    // surface it — only RO lookup can.
    const match = matchOrders([unfilled], "602136J");
    assert.equal(match.kind, "none");
  });

  it("test_exact_ro_when_matched_returns_single", () => {
    const match = matchOrdersBy([filled, unfilled], "1420321294", "ro_number");
    assert.equal(match.kind, "single");
    if (match.kind === "single") assert.equal(match.order.status_name, "Viewed");
  });

  it("test_ro_case_insensitive_when_matched_returns_single", () => {
    const match = matchOrdersBy([filled], "NM314470", "ro_number");
    assert.equal(match.kind, "single");
  });

  it("test_unknown_ro_when_matched_returns_none", () => {
    const match = matchOrdersBy([filled, unfilled], "0000000000", "ro_number");
    assert.equal(match.kind, "none");
  });
});

describe("buildStatusSummary", () => {
  it("test_verified_complete_order_when_summarized_mentions_status_and_delivery", () => {
    const summary = buildStatusSummary({
      invoice_number: "602136J",
      ro_number: "nm314470",
      request_id: "90141379",
      status_name: "Complete",
      is_filled: true,
      is_partial: false,
      order_qty: 1,
      invoice_qty: 1,
      delivery_date: "2026-11-11",
      partial_date: null,
      unavailable_count: 0,
      is_received: false,
      shop_name: "Royal Coach - St. Charles",
      vehicle_model: "Mazda 3",
    });
    assert.equal(
      summary,
      "Invoice 602136J for RO nm314470 is Complete (filled), 1 of 1 parts invoiced, delivery date 2026-11-11, for the Mazda 3, going to Royal Coach - St. Charles, not yet received.",
    );
  });

  it("test_verified_uninvoiced_order_when_summarized_leads_with_ro", () => {
    const summary = buildStatusSummary({
      invoice_number: null,
      ro_number: "1420321294",
      request_id: "90145102",
      status_name: "Viewed",
      is_filled: false,
      is_partial: false,
      order_qty: 1,
      invoice_qty: 0,
      delivery_date: null,
      partial_date: null,
      unavailable_count: 0,
      is_received: false,
      shop_name: "Gerber - Bloomington",
      vehicle_model: 'Chevrolet Silverado 1500 RST Crew Cab 147" WB 4WD',
    });
    assert.equal(
      summary,
      'Order for RO 1420321294 is Viewed (not yet filled), 0 of 1 parts invoiced, for the Chevrolet Silverado 1500 RST Crew Cab 147" WB 4WD, going to Gerber - Bloomington.',
    );
  });

  it("test_sparse_order_when_summarized_stays_readable", () => {
    const summary = buildStatusSummary({
      invoice_number: null,
      ro_number: null,
      request_id: null,
      status_name: null,
      is_filled: null,
      is_partial: null,
      order_qty: null,
      invoice_qty: null,
      delivery_date: null,
      partial_date: null,
      unavailable_count: null,
      is_received: null,
      shop_name: null,
      vehicle_model: null,
    });
    assert.equal(summary, "Order for RO unknown is in an unknown status (pending).");
  });
});

describe("classifyFailure", () => {
  it("test_401_when_classified_is_auth_failure", () => {
    assert.equal(classifyFailure(401), "auth_failure");
  });

  it("test_403_when_classified_is_auth_failure", () => {
    assert.equal(classifyFailure(403), "auth_failure");
  });

  it("test_404_when_classified_is_api_error", () => {
    // 404 semantics are undocumented by OPS; treat as upstream error.
    assert.equal(classifyFailure(404), "api_error");
  });

  it("test_500_when_classified_is_api_error", () => {
    assert.equal(classifyFailure(500), "api_error");
  });

  it("test_418_when_classified_is_api_error", () => {
    assert.equal(classifyFailure(418), "api_error");
  });
});

describe("batch 2: UNAVAILABLE placeholder and makecodes", () => {
  it("test_invoice_placeholder_when_normalized_becomes_null", () => {
    const agent = toAgentOrder({
      requestId: 90117309,
      roNumber: "1421830434",
      invoiceNumber: "UNAVAILABLE",
      statusName: "Unavailable",
      isFilled: true,
      orderQty: 1,
      invoiceQty: 0,
      unavailableCount: 1,
    });
    assert.equal(agent.invoice_number, null);
    assert.equal(agent.ro_number, "1421830434");
    assert.equal(agent.status_name, "Unavailable");
  });

  it("test_cadillac_makecode_when_normalized_adds_make", () => {
    const agent = toAgentOrder({
      requestId: 90160484,
      roNumber: "11704",
      vMakecode: "CADI",
      vehicleModel: "XTS Luxury FWD",
    });
    assert.equal(agent.vehicle_model, "Cadillac XTS Luxury FWD");
  });

  it("test_jeep_makecode_when_normalized_adds_make", () => {
    const agent = toAgentOrder({
      requestId: 90117309,
      roNumber: "1421830434",
      vMakecode: "JEEP",
      vehicleModel: "Compass Latitude 4WD",
    });
    assert.equal(agent.vehicle_model, "Jeep Compass Latitude 4WD");
  });

  it("test_partial_dates_when_normalized_are_kept_separate", () => {
    const agent = toAgentOrder({
      requestId: 90051769,
      roNumber: "1420321273",
      invoiceNumber: "601515J",
      statusName: "Partial",
      isFilled: true,
      isPartial: true,
      orderQty: 2,
      invoiceQty: 2,
      deliveryDate: "2026-11-09T00:00:00",
      partialDate: "2026-11-16T00:00:00",
    });
    assert.equal(agent.delivery_date, "2026-11-09");
    assert.equal(agent.partial_date, "2026-11-16");
    assert.equal(agent.is_partial, true);
    assert.equal(agent.is_received, null);
  });
});

describe("batch 2: status summary semantics", () => {
  it("test_partial_order_when_summarized_keeps_partial_and_reports_partial_date", () => {
    const summary = buildStatusSummary({
      invoice_number: "601515J",
      ro_number: "1420321273",
      request_id: "90051769",
      status_name: "Partial",
      is_filled: true,
      is_partial: true,
      order_qty: 2,
      invoice_qty: 2,
      delivery_date: "2026-11-09",
      partial_date: "2026-11-16",
      unavailable_count: 0,
      is_received: false,
      shop_name: "Gerber - Bloomington",
      vehicle_model: "Cadillac CTS Sedan Luxury AWD",
    });
    assert.match(summary, / is Partial,/);
    assert.doesNotMatch(summary, /\(filled\)/);
    assert.doesNotMatch(summary, /Complete/);
    assert.match(summary, /delivery date 2026-11-09/);
    assert.match(summary, /partial date 2026-11-16/);
    assert.match(summary, /not yet received/);
    assert.doesNotMatch(summary, /delivered/i);
  });

  it("test_unavailable_order_when_summarized_keeps_unavailable_and_counts_parts", () => {
    const summary = buildStatusSummary({
      invoice_number: null,
      ro_number: "1421830434",
      request_id: "90117309",
      status_name: "Unavailable",
      is_filled: true,
      is_partial: false,
      order_qty: 1,
      invoice_qty: 0,
      delivery_date: "2026-11-10",
      partial_date: "2026-11-10",
      unavailable_count: 1,
      is_received: false,
      shop_name: "Gerber - Plainfield",
      vehicle_model: "Jeep Compass Latitude 4WD",
    });
    assert.match(summary, / is Unavailable,/);
    assert.doesNotMatch(summary, /\(filled\)/);
    assert.doesNotMatch(summary, /Complete/);
    assert.match(summary, /1 part unavailable/);
    assert.doesNotMatch(summary, /not yet received/); // invoice_qty is 0
    assert.doesNotMatch(summary, /invoice \d/i);
  });

  it("test_multiple_unavailable_parts_when_summarized_pluralizes", () => {
    const summary = buildStatusSummary({
      invoice_number: null,
      ro_number: "1421830434",
      request_id: "90117309",
      status_name: "Unavailable",
      is_filled: true,
      is_partial: false,
      order_qty: 3,
      invoice_qty: 0,
      delivery_date: null,
      partial_date: null,
      unavailable_count: 3,
      is_received: false,
      shop_name: null,
      vehicle_model: null,
    });
    assert.match(summary, /3 parts unavailable/);
  });
});
