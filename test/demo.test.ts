import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { describe, it } from "node:test";

import type { ConnectorConfig } from "../src/config.ts";
import { loadConfig, parseBooleanFlag } from "../src/config.ts";
import {
  DEMO_FILLED_INVOICE,
  DEMO_INVOICE_PLACEHOLDER,
  DEMO_MULTI_INVOICE_1,
  DEMO_MULTI_INVOICE_2,
  DEMO_MULTI_RO,
  DEMO_NOT_FOUND_IDENTIFIER,
  DEMO_PARTIAL_INVOICE_1,
  DEMO_PARTIAL_INVOICE_2,
  DEMO_PARTIAL_RO_1,
  DEMO_PARTIAL_RO_2,
  DEMO_UNAVAILABLE_RO,
  DEMO_UNFILLED_RO,
  DEMO_VIEWED_RO_1,
  DEMO_VIEWED_RO_2,
  isDemoModeActive,
  lookupDemoInvoice,
  lookupDemoOrderByRo,
} from "../src/demo.ts";

const TEST_TOKEN = "eyJ0ZXN0LXRva2VuLXZhbHVlLWZvci1jcnlwdG8tY2FzZQ";

const CONFIG: ConnectorConfig = {
  baseUrl: "https://ops.example.com",
  bearerToken: TEST_TOKEN,
  sharedSecret: "test-shared",
  timeoutMs: 5_000,
  lookbackDays: 30,
  demoMode: true,
};

function configWith(overrides: Partial<ConnectorConfig>): ConnectorConfig {
  return { ...CONFIG, ...overrides };
}

describe("lookupDemoInvoice", () => {
  it("test_verified_filled_record_when_looked_up_returns_complete_filled_order", () => {
    const demo = lookupDemoInvoice(DEMO_FILLED_INVOICE);
    assert.equal(demo.outcome.status, "found");
    if (demo.outcome.status === "found") {
      assert.equal(demo.outcome.order.status_name, "Complete");
      assert.equal(demo.outcome.order.is_filled, true);
      assert.equal(demo.outcome.order.order_qty, 1);
      assert.equal(demo.outcome.order.invoice_qty, 1);
      assert.equal(demo.outcome.order.ro_number, "nm314470");
      assert.equal(demo.outcome.order.shop_name, "Royal Coach - St. Charles");
    }
  });

  it("test_verified_filled_record_when_looked_up_reports_mazda_3", () => {
    const demo = lookupDemoInvoice(DEMO_FILLED_INVOICE);
    if (demo.outcome.status === "found") {
      assert.equal(demo.outcome.order.vehicle_model, "Mazda 3");
      assert.equal(demo.outcome.order.delivery_date, "2026-11-11");
    }
  });

  it("test_verified_filled_record_when_looked_up_does_not_say_shipped_or_delivered", () => {
    const demo = lookupDemoInvoice(DEMO_FILLED_INVOICE);
    if (demo.outcome.status === "found") {
      assert.doesNotMatch(demo.outcome.agent_message, /shipped|delivered/i);
    }
  });

  it("test_verified_filled_record_when_looked_up_labels_fixture", () => {
    const demo = lookupDemoInvoice(DEMO_FILLED_INVOICE);
    assert.equal(demo.fixture, "filled_complete_602136J");
  });

  it("test_recorded_no_match_identifier_when_looked_up_returns_labeled_not_found", () => {
    const demo = lookupDemoInvoice(DEMO_NOT_FOUND_IDENTIFIER);
    assert.equal(demo.outcome.status, "not_found");
    assert.equal(demo.fixture, "recorded_no_match");
  });

  it("test_unfilled_record_when_looked_up_by_invoice_is_not_found", () => {
    // The unfilled record has no invoice number; invoice lookup must not
    // surface it under any invoice key.
    const demo = lookupDemoInvoice("1420321294");
    assert.equal(demo.outcome.status, "not_found");
  });

  it("test_verified_multi_invoice_ro_when_looked_up_returns_both_orders", () => {
    const demo = lookupDemoOrderByRo(DEMO_MULTI_RO);
    assert.equal(demo.outcome.status, "found");
    assert.equal(demo.fixture, "ro_multiple_2533043322");
    if (demo.outcome.status === "found") {
      assert.equal(demo.outcome.matched_count, 2);
      assert.deepEqual(
        demo.outcome.orders.map((o) => o.invoice_number),
        ["209140", "208753"],
      );
      assert.deepEqual(
        demo.outcome.orders.map((o) => o.request_id),
        ["90168656", "89947164"],
      );
      assert.match(demo.outcome.agent_message, /invoice 209140/);
      assert.match(demo.outcome.agent_message, /invoice 208753/);
    }
  });

  it("test_multi_ro_first_invoice_when_looked_up_returns_exact_record", () => {
    const demo = lookupDemoInvoice(DEMO_MULTI_INVOICE_1);
    assert.equal(demo.outcome.status, "found");
    assert.equal(demo.fixture, "filled_complete_209140");
    if (demo.outcome.status === "found") {
      assert.equal(demo.outcome.matched_count, 1);
      assert.equal(demo.outcome.order.invoice_number, "209140");
      assert.equal(demo.outcome.order.request_id, "90168656");
      assert.equal(demo.outcome.order.delivery_date, "2026-11-11");
      assert.equal(demo.outcome.order.vehicle_model, "Volkswagen Atlas Cross Sport");
      assert.equal(demo.outcome.order.shop_name, "Caliber - Blue Island - Western Ave");
    }
  });

  it("test_multi_ro_second_invoice_when_looked_up_returns_exact_record", () => {
    const demo = lookupDemoInvoice(DEMO_MULTI_INVOICE_2);
    assert.equal(demo.outcome.status, "found");
    assert.equal(demo.fixture, "filled_complete_208753");
    if (demo.outcome.status === "found") {
      assert.equal(demo.outcome.matched_count, 1);
      assert.equal(demo.outcome.order.invoice_number, "208753");
      assert.equal(demo.outcome.order.request_id, "89947164");
      assert.equal(demo.outcome.order.delivery_date, "2026-11-05");
    }
  });

  it("test_multi_ro_number_by_invoice_lookup_is_not_found", () => {
    // Invoice lookup is exact-match only: the RO number is not an invoice.
    const demo = lookupDemoInvoice(DEMO_MULTI_RO);
    assert.equal(demo.outcome.status, "not_found");
    assert.equal(demo.fixture, "recorded_no_match");
  });

  it("test_verified_records_never_carried_customer_contact_details", async () => {
    // The GetOrders upstream contains shop contact PII; the demo module must
    // never store it. Guard against the fixture files ever gaining it.
    const source = await readFile(new URL("../src/demo.ts", import.meta.url), "utf8");
    assert.doesNotMatch(source, /shopContact|shopContactEmail|shopContactPhoneNumber|dealerContact/i);
  });

  it("test_verified_multi_records_match_captured_values_exactly", () => {
    const demo = lookupDemoInvoice(DEMO_MULTI_INVOICE_2);
    if (demo.outcome.status === "found") {
      assert.deepEqual(demo.outcome.order, {
        invoice_number: "208753",
        ro_number: "2533043322",
        request_id: "89947164",
        status_name: "Complete",
        is_filled: true,
        is_partial: null,
        order_qty: 1,
        invoice_qty: 1,
        delivery_date: "2026-11-05",
        partial_date: null,
        unavailable_count: null,
        is_received: null,
        shop_name: "Caliber - Blue Island - Western Ave",
        vehicle_model: "Volkswagen Atlas Cross Sport",
      });
    }
  });

  it("test_lowercase_input_when_looked_up_matches_exactly", () => {
    const demo = lookupDemoInvoice("602136j");
    assert.equal(demo.outcome.status, "found");
  });
});

describe("lookupDemoOrderByRo", () => {
  it("test_verified_unfilled_record_when_looked_up_by_ro_returns_viewed_order", () => {
    const demo = lookupDemoOrderByRo(DEMO_UNFILLED_RO);
    assert.equal(demo.outcome.status, "found");
    if (demo.outcome.status === "found") {
      assert.equal(demo.outcome.order.status_name, "Viewed");
      assert.equal(demo.outcome.order.is_filled, false);
      assert.equal(demo.outcome.order.invoice_qty, 0);
      assert.equal(demo.outcome.order.order_qty, 1);
      assert.equal(demo.outcome.order.shop_name, "Gerber - Bloomington");
    }
  });

  it("test_verified_unfilled_record_when_looked_up_has_no_invented_invoice", () => {
    const demo = lookupDemoOrderByRo(DEMO_UNFILLED_RO);
    if (demo.outcome.status === "found") {
      assert.equal(demo.outcome.order.invoice_number, null);
      assert.doesNotMatch(demo.outcome.agent_message, /invoice \d/i);
    }
  });

  it("test_verified_unfilled_record_when_looked_up_speaks_vehicle_and_shop", () => {
    const demo = lookupDemoOrderByRo(DEMO_UNFILLED_RO);
    if (demo.outcome.status === "found") {
      assert.match(demo.outcome.agent_message, /Chevrolet Silverado 1500 RST Crew Cab 147" WB 4WD/);
      assert.match(demo.outcome.agent_message, /going to Gerber - Bloomington/);
    }
  });

  it("test_verified_filled_record_when_looked_up_by_ro_returns_complete_order", () => {
    const demo = lookupDemoOrderByRo("nm314470");
    assert.equal(demo.outcome.status, "found");
    if (demo.outcome.status === "found") {
      assert.equal(demo.outcome.order.status_name, "Complete");
    }
    assert.equal(demo.fixture, "filled_complete_602136J");
  });

  it("test_unknown_ro_when_looked_up_returns_labeled_not_found", () => {
    const demo = lookupDemoOrderByRo("0000000000");
    assert.equal(demo.outcome.status, "not_found");
    assert.equal(demo.fixture, "recorded_no_match");
  });
});

describe("isDemoModeActive", () => {
  it("test_demo_flag_without_credential_when_checked_is_active", () => {
    assert.equal(isDemoModeActive(configWith({ demoMode: true, bearerToken: undefined })), true);
  });

  it("test_demo_flag_with_live_credential_when_checked_is_inactive", () => {
    assert.equal(isDemoModeActive(configWith({ demoMode: true })), false);
  });

  it("test_no_demo_flag_when_checked_is_inactive", () => {
    assert.equal(isDemoModeActive(configWith({ demoMode: false, bearerToken: undefined })), false);
  });
});

describe("loadConfig demo flag", () => {
  it("test_one_value_when_parsed_is_true", () => {
    assert.equal(parseBooleanFlag("1"), true);
  });

  it("test_true_value_when_parsed_is_true", () => {
    assert.equal(parseBooleanFlag("TRUE"), true);
  });

  it("test_zero_value_when_parsed_is_false", () => {
    assert.equal(parseBooleanFlag("0"), false);
  });

  it("test_missing_value_when_parsed_is_false", () => {
    assert.equal(parseBooleanFlag(undefined), false);
  });

  it("test_demo_env_when_loaded_sets_demo_mode", () => {
    const config = loadConfig({ OPSTRAX_DEMO_MODE: "yes" });
    assert.equal(config.demoMode, true);
  });

  it("test_no_demo_env_when_loaded_defaults_demo_mode_off", () => {
    const config = loadConfig({});
    assert.equal(config.demoMode, false);
  });
});

describe("batch 2: viewed fixtures (no invoice yet)", () => {
  it("test_viewed_ro_11704_when_looked_up_returns_viewed_cadillac_order", () => {
    const demo = lookupDemoOrderByRo(DEMO_VIEWED_RO_1);
    assert.equal(demo.outcome.status, "found");
    assert.equal(demo.fixture, "viewed_ro_11704");
    if (demo.outcome.status === "found") {
      assert.equal(demo.outcome.matched_count, 1);
      const order = demo.outcome.order;
      assert.equal(order.ro_number, "11704");
      assert.equal(order.invoice_number, null); // never invent an invoice
      assert.equal(order.status_name, "Viewed");
      assert.equal(order.is_filled, false);
      assert.equal(order.order_qty, 1);
      assert.equal(order.invoice_qty, 0);
      assert.equal(order.delivery_date, null);
      assert.equal(order.vehicle_model, "Cadillac XTS Luxury FWD");
      assert.equal(order.shop_name, "CARSTAR Todd's Body Shop");
      assert.match(demo.outcome.agent_message, /^Order for RO 11704/);
      assert.doesNotMatch(demo.outcome.agent_message, /invoice \w+/i);
    }
  });

  it("test_viewed_ro_1410332453_when_looked_up_returns_viewed_cadillac_order", () => {
    const demo = lookupDemoOrderByRo(DEMO_VIEWED_RO_2);
    assert.equal(demo.outcome.status, "found");
    assert.equal(demo.fixture, "viewed_ro_1410332453");
    if (demo.outcome.status === "found") {
      const order = demo.outcome.order;
      assert.equal(order.ro_number, "1410332453");
      assert.equal(order.invoice_number, null);
      assert.equal(order.status_name, "Viewed");
      assert.equal(order.is_filled, false);
      assert.equal(order.vehicle_model, "Cadillac CT5 Premium Luxury");
      assert.equal(order.shop_name, "Gerber - Crystal Lake");
    }
  });

  it("test_viewed_ros_are_not_searchable_by_invoice", () => {
    // No invoice exists for these records — no invoice path may serve them.
    assert.equal(lookupDemoInvoice(DEMO_VIEWED_RO_1).outcome.status, "not_found");
    assert.equal(lookupDemoInvoice(DEMO_VIEWED_RO_2).outcome.status, "not_found");
  });
});

describe("batch 2: partial fixtures", () => {
  it("test_partial_601515J_by_invoice_when_looked_up_preserves_captured_values", () => {
    const demo = lookupDemoInvoice(DEMO_PARTIAL_INVOICE_1);
    assert.equal(demo.outcome.status, "found");
    assert.equal(demo.fixture, "partial_invoice_601515J");
    if (demo.outcome.status === "found") {
      assert.equal(demo.outcome.matched_count, 1);
      const order = demo.outcome.order;
      assert.equal(order.invoice_number, "601515J");
      assert.equal(order.ro_number, "1420321273");
      assert.equal(order.request_id, "90051769");
      assert.equal(order.status_name, "Partial"); // isFilled=true is NOT Complete
      assert.equal(order.is_filled, true);
      assert.equal(order.is_partial, true);
      assert.equal(order.order_qty, 2);
      assert.equal(order.invoice_qty, 2);
      assert.equal(order.delivery_date, "2026-11-09");
      assert.equal(order.partial_date, "2026-11-16");
      assert.equal(order.is_received, false);
      assert.equal(order.vehicle_model, "Cadillac CTS Sedan Luxury AWD");
    }
  });

  it("test_partial_601515J_message_reports_not_yet_received_and_never_delivered", () => {
    const demo = lookupDemoInvoice(DEMO_PARTIAL_INVOICE_1);
    if (demo.outcome.status === "found") {
      assert.match(demo.outcome.agent_message, /not yet received/);
      assert.doesNotMatch(demo.outcome.agent_message, /delivered/i);
      assert.doesNotMatch(demo.outcome.agent_message, /received date/i);
    }
  });

  it("test_partial_601515J_by_ro_when_looked_up_returns_same_record", () => {
    const demo = lookupDemoOrderByRo(DEMO_PARTIAL_RO_1);
    assert.equal(demo.outcome.status, "found");
    assert.equal(demo.fixture, "partial_invoice_601515J");
    if (demo.outcome.status === "found") {
      assert.equal(demo.outcome.order.invoice_number, "601515J");
    }
  });

  it("test_partial_602307J_by_invoice_when_looked_up_preserves_captured_values", () => {
    const demo = lookupDemoInvoice(DEMO_PARTIAL_INVOICE_2);
    assert.equal(demo.outcome.status, "found");
    assert.equal(demo.fixture, "partial_invoice_602307J");
    if (demo.outcome.status === "found") {
      const order = demo.outcome.order;
      assert.equal(order.invoice_number, "602307J");
      assert.equal(order.ro_number, "11744");
      assert.equal(order.request_id, "90168346");
      assert.equal(order.status_name, "Partial");
      assert.equal(order.is_partial, true);
      assert.equal(order.order_qty, 10);
      assert.equal(order.invoice_qty, 10);
      assert.equal(order.delivery_date, "2026-11-12");
      assert.equal(order.partial_date, "2026-11-16");
      assert.equal(order.is_received, false);
      assert.equal(
        order.vehicle_model,
        'Chevrolet Silverado 1500 LT Crew Cab 147" WB 4WD w/1LT Pkg',
      );
      assert.equal(order.shop_name, "CARSTAR Todd's Body Shop");
    }
  });

  it("test_partial_602307J_by_ro_when_looked_up_returns_same_record", () => {
    const demo = lookupDemoOrderByRo(DEMO_PARTIAL_RO_2);
    assert.equal(demo.outcome.status, "found");
    assert.equal(demo.fixture, "partial_invoice_602307J");
    if (demo.outcome.status === "found") {
      assert.equal(demo.outcome.order.invoice_number, "602307J");
      assert.match(demo.outcome.agent_message, /not yet received/);
      assert.doesNotMatch(demo.outcome.agent_message, /delivered/i);
    }
  });
});

describe("batch 2: unavailable fixture", () => {
  it("test_unavailable_ro_when_looked_up_keeps_status_and_placeholder_hidden", () => {
    const demo = lookupDemoOrderByRo(DEMO_UNAVAILABLE_RO);
    assert.equal(demo.outcome.status, "found");
    assert.equal(demo.fixture, "unavailable_ro_1421830434");
    if (demo.outcome.status === "found") {
      const order = demo.outcome.order;
      assert.equal(order.ro_number, "1421830434");
      assert.equal(order.invoice_number, null); // "UNAVAILABLE" placeholder → null
      assert.equal(order.status_name, "Unavailable"); // isFilled=true stays Unavailable
      assert.equal(order.is_filled, true);
      assert.equal(order.unavailable_count, 1);
      assert.equal(order.invoice_qty, 0);
      assert.equal(order.is_received, false);
      assert.equal(order.vehicle_model, "Jeep Compass Latitude 4WD");
      assert.equal(order.shop_name, "Gerber - Plainfield");
      assert.match(demo.outcome.agent_message, /1 part unavailable/);
      assert.doesNotMatch(demo.outcome.agent_message, /invoice \w+/i);
    }
  });

  it("test_invoice_placeholder_when_searched_is_not_found", () => {
    // "UNAVAILABLE" is a status marker, never a searchable invoice.
    const demo = lookupDemoInvoice(DEMO_INVOICE_PLACEHOLDER);
    assert.equal(demo.outcome.status, "not_found");
    assert.equal(demo.fixture, "recorded_no_match");
  });
});

describe("batch 2: fixture inventory", () => {
  it("test_all_ten_identifiers_resolve_to_their_recorded_fixture", () => {
    const cases: Array<[string, () => ReturnType<typeof lookupDemoInvoice>, string]> = [
      ["602136J", () => lookupDemoInvoice(DEMO_FILLED_INVOICE), "filled_complete_602136J"],
      ["2533043322", () => lookupDemoOrderByRo(DEMO_MULTI_RO), "ro_multiple_2533043322"],
      ["209140", () => lookupDemoInvoice(DEMO_MULTI_INVOICE_1), "filled_complete_209140"],
      ["208753", () => lookupDemoInvoice(DEMO_MULTI_INVOICE_2), "filled_complete_208753"],
      ["11704", () => lookupDemoOrderByRo(DEMO_VIEWED_RO_1), "viewed_ro_11704"],
      [
        "1410332453",
        () => lookupDemoOrderByRo(DEMO_VIEWED_RO_2),
        "viewed_ro_1410332453",
      ],
      [
        "601515J",
        () => lookupDemoInvoice(DEMO_PARTIAL_INVOICE_1),
        "partial_invoice_601515J",
      ],
      [
        "1420321273",
        () => lookupDemoOrderByRo(DEMO_PARTIAL_RO_1),
        "partial_invoice_601515J",
      ],
      [
        "602307J",
        () => lookupDemoInvoice(DEMO_PARTIAL_INVOICE_2),
        "partial_invoice_602307J",
      ],
      ["11744", () => lookupDemoOrderByRo(DEMO_PARTIAL_RO_2), "partial_invoice_602307J"],
      [
        "1421830434",
        () => lookupDemoOrderByRo(DEMO_UNAVAILABLE_RO),
        "unavailable_ro_1421830434",
      ],
    ];
    for (const [identifier, lookup, fixture] of cases) {
      const demo = lookup();
      assert.equal(demo.outcome.status, "found", identifier);
      assert.equal(demo.fixture, fixture, identifier);
    }
  });
});
