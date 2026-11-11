import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, it } from "node:test";

import type { ConnectorConfig } from "../src/config.ts";
import { routeRequest } from "../src/index.ts";
import { buildOutcome, buildRoOutcome } from "../src/lookup.ts";
import type { FetchImpl } from "../src/opstrax.ts";

const SECRET = "test-shared-secret";
const TEST_TOKEN = "eyJ0ZXN0LXRva2VuLXZhbHVlLWZvci1jcnlwdG8tY2FzZQ";
const CONFIG: ConnectorConfig = {
  baseUrl: "https://ops.example.com",
  bearerToken: TEST_TOKEN,
  sharedSecret: SECRET,
  timeoutMs: 5_000,
  lookbackDays: 30,
  demoMode: false,
};

function configWith(overrides: Partial<ConnectorConfig>): ConnectorConfig {
  return { ...CONFIG, ...overrides };
}

function jsonRequest(
  path: string,
  init: RequestInit & { secret?: string | null } = {},
): Request {
  const { secret, ...rest } = init;
  const headers = new Headers(rest.headers);
  if (secret !== null) {
    if (secret !== undefined) headers.set("x-connector-secret", secret ?? "");
  }
  return new Request(`https://edge.test${path}`, { ...rest, headers });
}

function stubFetch(
  responder: () => Response | Promise<Response>,
  calls: Array<{ url: string; init: RequestInit }> = [],
): FetchImpl {
  return async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return responder();
  };
}

describe("routeRequest", () => {
  let calls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    calls = [];
  });

  const goodFetch = () =>
    stubFetch(
      async () =>
        Response.json({
          data: [
            {
              requestId: 90141379,
              invoiceNumber: "602136J",
              roNumber: "nm314470",
              statusName: "Complete",
              isFilled: true,
            },
          ],
        }),
      calls,
    );

  it("test_get_root_when_requested_returns_descriptor", async () => {
    const response = await routeRequest(new Request("https://edge.test/"), CONFIG);
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { service: string };
    assert.equal(payload.service, "opstrax-connector");
  });

  it("test_health_paths_when_probed_return_ok", async () => {
    for (const path of ["/health/liveness", "/health/readiness"]) {
      const response = await routeRequest(new Request(`https://edge.test${path}`), CONFIG);
      assert.equal(response.status, 200);
      assert.equal(await response.text(), "ok");
    }
  });

  it("test_unknown_path_when_requested_returns_404", async () => {
    const response = await routeRequest(jsonRequest("/nope"), CONFIG);
    assert.equal(response.status, 404);
  });

  it("test_invoice_path_when_delete_requested_returns_405", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice", { method: "DELETE", secret: SECRET }),
      CONFIG,
    );
    assert.equal(response.status, 405);
  });

  it("test_health_paths_when_get_request_skip_upstream_completely", async () => {
    // Health checks must never touch the upstream (cheap probes).
    const fetchImpl = goodFetch();
    const response = await routeRequest(
      new Request("https://edge.test/health/liveness"),
      CONFIG,
      fetchImpl,
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 0);
  });
});

describe("shared-secret guard", () => {
  it("test_missing_secret_when_provisioned_returns_503_without_leaking_state", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice", { method: "POST", body: "{}" }),
      configWith({ sharedSecret: undefined }),
    );
    assert.equal(response.status, 503);
    const payload = (await response.json()) as { error: string };
    assert.equal(payload.error, "unavailable");
  });

  it("test_missing_header_when_secret_provisioned_returns_401", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice", {
        method: "POST",
        body: '{"invoice_number":"X"}',
        secret: null,
      }),
      CONFIG,
    );
    assert.equal(response.status, 401);
  });

  it("test_wrong_secret_when_provided_returns_401", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice", {
        method: "POST",
        body: '{"invoice_number":"X"}',
        secret: "wrong",
      }),
      CONFIG,
    );
    assert.equal(response.status, 401);
  });

  it("test_correct_secret_when_provided_reaches_the_upstream", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchImpl = stubFetch(
      async () => Response.json({ data: [] }),
      calls,
    );
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice", {
        method: "POST",
        body: '{"invoice_number":"602136J"}',
        secret: SECRET,
      }),
      CONFIG,
      fetchImpl,
    );
    assert.equal(response.status, 200);
    assert.equal(calls.length, 1);
  });
});

describe("invoice lookup handler", () => {
  let calls: Array<{ url: string; init: RequestInit }>;
  let responses: Array<() => Response>;

  beforeEach(() => {
    calls = [];
  });

  const fetchResponding = (): FetchImpl =>
    stubFetch(async () => responses[0]!(), calls);

  it("test_blank_invoice_when_posted_returns_400_with_agent_message", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice", {
        method: "POST",
        body: '{"invoice_number":"  "}',
        secret: SECRET,
      }),
      CONFIG,
      fetchResponding(),
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { status: string };
    assert.equal(payload.status, "invalid_request");
  });

  it("test_not_configured_when_credential_missing_returns_503", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice?invoice_number=602136J", { secret: SECRET }),
      configWith({ bearerToken: undefined }),
      fetchResponding(),
    );
    assert.equal(response.status, 503);
    const payload = (await response.json()) as { status: string };
    assert.equal(payload.status, "not_configured");
  });

  it("test_no_matching_order_when_upstream_empty_returns_200_not_found", async () => {
    responses = [() => Response.json({ data: [] })];
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice?invoice_number=NOPE", { secret: SECRET }),
      CONFIG,
      fetchResponding(),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { status: string; agent_message: string };
    assert.equal(payload.status, "not_found");
    assert.match(payload.agent_message, /NOPE/);
  });

  it("test_matching_order_when_upstream_returns_row_returns_200_found", async () => {
    responses = [
      () =>
        Response.json({
          data: [
            {
              requestId: 90141379,
              invoiceNumber: "602136J",
              roNumber: "nm314470",
              statusName: "Complete",
              isFilled: true,
              orderQty: 1,
              invoiceQty: 1,
              deliveryDate: "2026-11-11T00:00:00",
              vehicleModel: "3",
              vMakecode: "MAZD",
              shopName: "Royal Coach - St. Charles",
            },
          ],
        }),
    ];
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice?invoice_number=602136J", { secret: SECRET }),
      CONFIG,
      fetchResponding(),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      mode: string;
      status: string;
      order: { status_name: string };
      agent_message: string;
    };
    assert.equal(payload.mode, "live");
    assert.equal(payload.status, "found");
    assert.equal(payload.order.status_name, "Complete");
    assert.match(payload.agent_message, /Mazda 3/);
    assert.match(payload.agent_message, /2026-11-11/);
  });

  it("test_mismatched_rows_when_upstream_ignores_filter_returns_not_found", async () => {
    // Fail-closed guard: if the response contains only a record that does
    // not match the requested invoice (here the verified RO-only unfilled
    // record, which has no invoice number), the agent must say not-found —
    // never read out an unrelated order.
    responses = [
      () =>
        Response.json({
          data: [
            {
              requestId: 90145102,
              invoiceNumber: null,
              roNumber: "1420321294",
              statusName: "Viewed",
            },
          ],
        }),
    ];
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice?invoice_number=602136J", { secret: SECRET }),
      CONFIG,
      fetchResponding(),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { status: string };
    assert.equal(payload.status, "not_found");
  });

  it("test_upstream_auth_failure_when_upstream_401_returns_502_unauthorized", async () => {
    responses = [() => new Response("denied", { status: 401 })];
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice?invoice_number=X", { secret: SECRET }),
      CONFIG,
      fetchResponding(),
    );
    assert.equal(response.status, 502);
    const payload = (await response.json()) as { status: string };
    assert.equal(payload.status, "unauthorized");
  });
});

describe("RO lookup handler", () => {
  let calls: Array<{ url: string; init: RequestInit }>;

  beforeEach(() => {
    calls = [];
  });

  const unfilledFetch = (): FetchImpl =>
    stubFetch(
      async () =>
        Response.json({
          results: [
            {
              requestId: 90145102,
              invoiceNumber: null,
              roNumber: "1420321294",
              statusName: "Viewed",
              isFilled: false,
              orderQty: 1,
              invoiceQty: 0,
            },
          ],
          totalRecords: 1,
        }),
      calls,
    );

  it("test_ro_path_when_delete_requested_returns_405", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/order", { method: "DELETE", secret: SECRET }),
      CONFIG,
    );
    assert.equal(response.status, 405);
  });

  it("test_blank_ro_when_posted_returns_400_with_agent_message", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/order", {
        method: "POST",
        body: '{"ro_number":"  "}',
        secret: SECRET,
      }),
      CONFIG,
      unfilledFetch(),
    );
    assert.equal(response.status, 400);
    const payload = (await response.json()) as { status: string };
    assert.equal(payload.status, "invalid_request");
  });

  it("test_verified_unfilled_ro_when_looked_up_lively_returns_found_viewed", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/order?ro_number=1420321294", { secret: SECRET }),
      CONFIG,
      unfilledFetch(),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      mode: string;
      status: string;
      order: { status_name: string; invoice_number: string | null; ro_number: string | null };
    };
    assert.equal(payload.mode, "live");
    assert.equal(payload.status, "found");
    assert.equal(payload.order.status_name, "Viewed");
    assert.equal(payload.order.invoice_number, null);
    assert.equal(payload.order.ro_number, "1420321294");
    assert.equal(calls.length, 1);
  });

  it("test_verified_multi_invoice_ro_when_looked_up_lively_returns_both_orders", async () => {
    const multiFetch = (): FetchImpl =>
      stubFetch(
        async () =>
          Response.json({
            results: [
              {
                requestId: 90168656,
                invoiceNumber: "209140",
                roNumber: "2533043322",
                vehicleModel: "Atlas Cross Sport",
                vMakecode: "VW  ",
                shopName: "Caliber - Blue Island - Western Ave",
                statusName: "Complete",
                isFilled: true,
                orderQty: 1,
                invoiceQty: 1,
                deliveryDate: "2026-11-11T00:00:00",
              },
              {
                requestId: 89947164,
                invoiceNumber: "208753",
                roNumber: "2533043322",
                vehicleModel: "Atlas Cross Sport",
                vMakecode: "VW  ",
                shopName: "Caliber - Blue Island - Western Ave",
                statusName: "Complete",
                isFilled: true,
                orderQty: 1,
                invoiceQty: 1,
                deliveryDate: "2026-11-05T00:00:00",
              },
            ],
            totalRecords: 2,
          }),
        calls,
      );
    const response = await routeRequest(
      jsonRequest("/opstrax/order?ro_number=2533043322", { secret: SECRET }),
      CONFIG,
      multiFetch(),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      status: string;
      matched_count: number;
      orders: Array<{ invoice_number: string | null }>;
      agent_message: string;
    };
    assert.equal(payload.status, "found");
    assert.equal(payload.matched_count, 2);
    assert.deepEqual(
      payload.orders.map((o) => o.invoice_number),
      ["209140", "208753"],
    );
    assert.match(payload.agent_message, /invoice 209140/);
    assert.match(payload.agent_message, /invoice 208753/);
  });

  it("test_ro_lookup_without_secret_returns_401", async () => {
    const response = await routeRequest(
      new Request("https://edge.test/opstrax/order?ro_number=1420321294"),
      CONFIG,
      unfilledFetch(),
    );
    assert.equal(response.status, 401);
  });
});

describe("demo mode routing", () => {
  const demoConfig = (): ConnectorConfig => ({
    ...CONFIG,
    demoMode: true,
    bearerToken: undefined,
  });

  it("test_demo_mode_when_active_returns_labeled_filled_response", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice?invoice_number=602136J", { secret: SECRET }),
      demoConfig(),
      async () => new Response("{}", { status: 200 }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { mode: string; status: string };
    assert.equal(payload.mode, "demo");
    assert.equal(payload.status, "found");
  });

  it("test_demo_mode_when_unknown_invoice_returns_labeled_not_found", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice?invoice_number=NOPE", { secret: SECRET }),
      demoConfig(),
      async () => new Response("{}", { status: 200 }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { mode: string; status: string };
    assert.equal(payload.mode, "demo");
    assert.equal(payload.status, "not_found");
  });

  it("test_demo_mode_with_live_credential_when_requested_uses_live_not_demo", async () => {
    // With a live credential configured, DEMO must be ignored even though the
    // flag is on — demo data is never substituted for live responses.
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice?invoice_number=602136J", { secret: SECRET }),
      { ...CONFIG, demoMode: true },
      stubFetch(async () => Response.json({ data: [] })),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { mode: string; status: string };
    assert.equal(payload.mode, "live");
    assert.equal(payload.status, "not_found");
  });

  it("test_demo_ro_when_looked_up_returns_labeled_unfilled_fixture", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/order?ro_number=1420321294", { secret: SECRET }),
      demoConfig(),
      async () => new Response("{}", { status: 200 }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      mode: string;
      fixture: string;
      status: string;
    };
    assert.equal(payload.mode, "demo");
    assert.equal(payload.fixture, "unfilled_viewed_90145102");
    assert.equal(payload.status, "found");
  });

  it("test_demo_multi_ro_when_looked_up_returns_labeled_multi_fixture", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/order?ro_number=2533043322", { secret: SECRET }),
      demoConfig(),
      async () => new Response("{}", { status: 200 }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      mode: string;
      fixture: string;
      status: string;
      matched_count: number;
      orders: Array<{ invoice_number: string | null }>;
    };
    assert.equal(payload.mode, "demo");
    assert.equal(payload.fixture, "ro_multiple_2533043322");
    assert.equal(payload.status, "found");
    assert.equal(payload.matched_count, 2);
    assert.deepEqual(
      payload.orders.map((o) => o.invoice_number),
      ["209140", "208753"],
    );
  });

  it("test_demo_multi_invoice_when_looked_up_returns_labeled_single_fixture", async () => {
    const response = await routeRequest(
      jsonRequest("/opstrax/invoice?invoice_number=209140", { secret: SECRET }),
      demoConfig(),
      async () => new Response("{}", { status: 200 }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as {
      mode: string;
      fixture: string;
      status: string;
      matched_count: number;
    };
    assert.equal(payload.mode, "demo");
    assert.equal(payload.fixture, "filled_complete_209140");
    assert.equal(payload.status, "found");
    assert.equal(payload.matched_count, 1);
  });

  it("test_diagnostics_encryption_when_authorized_returns_ok", async () => {
    const response = await routeRequest(
      jsonRequest("/diagnostics/encryption", { secret: SECRET }),
      CONFIG,
      async () => new Response("{}", { status: 200 }),
    );
    assert.equal(response.status, 200);
    const payload = (await response.json()) as { check: string; ok: boolean };
    assert.equal(payload.check, "webcrypto_aes_cbc");
    assert.equal(payload.ok, true);
  });

  it("test_diagnostics_encryption_without_secret_returns_401", async () => {
    const response = await routeRequest(
      new Request("https://edge.test/diagnostics/encryption"),
      CONFIG,
      async () => new Response("{}", { status: 200 }),
    );
    assert.equal(response.status, 401);
  });
});

describe("multiple-match RO lookup (outcome mapping)", () => {
  // Two verified OPS Trax rows sharing RO 2533043322 (requestIds
  // 90168656 / 89947164, invoices 209140 / 208753).
  const row1 = {
    requestId: 90168656,
    invoiceNumber: "209140",
    roNumber: "2533043322",
    vehicleModel: "Atlas Cross Sport",
    vMakecode: "VW  ",
    shopName: "Caliber - Blue Island - Western Ave",
    statusName: "Complete",
    isFilled: true,
    orderQty: 1,
    invoiceQty: 1,
    deliveryDate: "2026-11-11T00:00:00",
  };
  const row2 = {
    requestId: 89947164,
    invoiceNumber: "208753",
    roNumber: "2533043322",
    vehicleModel: "Atlas Cross Sport",
    vMakecode: "VW  ",
    shopName: "Caliber - Blue Island - Western Ave",
    statusName: "Complete",
    isFilled: true,
    orderQty: 1,
    invoiceQty: 1,
    deliveryDate: "2026-11-05T00:00:00",
  };

  it("test_multi_invoice_ro_when_looked_up_returns_all_matches", () => {
    const outcome = buildRoOutcome({ kind: "ok", orders: [row1, row2] }, "2533043322");
    assert.equal(outcome.status, "found");
    if (outcome.status === "found") {
      assert.equal(outcome.matched_count, 2);
      assert.equal(outcome.orders.length, 2);
      assert.deepEqual(
        outcome.orders.map((o) => o.invoice_number),
        ["209140", "208753"],
      );
      // `order` remains the first match for compatibility, never a silent choice.
      assert.equal(outcome.order.invoice_number, "209140");
    }
  });

  it("test_multi_invoice_ro_message_lists_every_invoice_and_prompts_the_caller", () => {
    const outcome = buildRoOutcome({ kind: "ok", orders: [row1, row2] }, "2533043322");
    if (outcome.status === "found") {
      assert.match(outcome.agent_message, /invoice 209140/);
      assert.match(outcome.agent_message, /invoice 208753/);
      assert.match(outcome.agent_message, /ask the caller/i);
      assert.doesNotMatch(outcome.agent_message, /showing the first/i);
    }
  });

  it("test_single_invoice_lookup_within_multi_ro_returns_exact_match", () => {
    const outcome = buildOutcome({ kind: "ok", orders: [row1, row2] }, "209140");
    assert.equal(outcome.status, "found");
    if (outcome.status === "found") {
      assert.equal(outcome.matched_count, 1);
      assert.equal(outcome.orders.length, 1);
      assert.equal(outcome.order.invoice_number, "209140");
      assert.equal(outcome.order.request_id, "90168656");
      assert.equal(outcome.order.delivery_date, "2026-11-11");
    }
  });

  it("test_second_invoice_lookup_within_multi_ro_returns_its_exact_match", () => {
    const outcome = buildOutcome({ kind: "ok", orders: [row1, row2] }, "208753");
    if (outcome.status === "found") {
      assert.equal(outcome.order.invoice_number, "208753");
      assert.equal(outcome.order.request_id, "89947164");
      assert.equal(outcome.order.delivery_date, "2026-11-05");
    }
  });

  it("test_ro_number_used_as_invoice_returns_not_found", () => {
    // Invoice lookup must stay exact: the RO number is not an invoice.
    const outcome = buildOutcome({ kind: "ok", orders: [row1, row2] }, "2533043322");
    assert.equal(outcome.status, "not_found");
  });

  it("test_volkswagen_makecode_with_padding_when_normalized_adds_make", () => {
    const outcome = buildOutcome({ kind: "ok", orders: [row1] }, "209140");
    if (outcome.status === "found") {
      assert.equal(outcome.order.vehicle_model, "Volkswagen Atlas Cross Sport");
    }
  });
});
