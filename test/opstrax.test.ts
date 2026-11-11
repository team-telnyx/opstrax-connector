import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";

import type { ConnectorConfig } from "../src/config.ts";
import { GET_ORDERS_PATH } from "../src/config.ts";
import type { FetchImpl } from "../src/opstrax.ts";
import { callGetOrders, MAX_PAGES } from "../src/opstrax.ts";
import { PAGE_SIZE } from "../src/payload.ts";

const TEST_TOKEN = "eyJ0ZXN0LXRva2VuLXZhbHVlLWZvci1jcnlwdG8tY2FzZQ";
const TEST_IV = "ABH&&%#@HKLU1239";

function makeConfig(overrides: Partial<ConnectorConfig> = {}): ConnectorConfig {
  return {
    baseUrl: "https://ops.example.com",
    bearerToken: TEST_TOKEN,
    sharedSecret: "test-shared",
    timeoutMs: 5_000,
    lookbackDays: 30,
    demoMode: false,
    ...overrides,
  };
}

function decryptBody(b64: string): string {
  const key = Buffer.from(TEST_TOKEN.slice(0, 16), "utf8");
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.from(TEST_IV, "utf8"));
  return Buffer.concat([
    decipher.update(Buffer.from(b64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

interface RecordedCall {
  url: string;
  init: RequestInit;
}

function recordedFetch(
  pages: Array<string>,
  calls: RecordedCall[] = [],
): FetchImpl {
  let index = 0;
  return async (url: string, init: RequestInit) => {
    const page = pages[index];
    index += 1;
    calls.push({ url, init });
    return new Response(page ?? "{}", { status: 200 });
  };
}

describe("callGetOrders", () => {
  it("test_missing_credential_when_called_fails_fast_without_network", async () => {
    const config = makeConfig({ bearerToken: undefined });
    let fetchCalled = false;
    const fetchImpl: FetchImpl = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };

    const result = await callGetOrders(config, { invoiceNumber: "X" }, fetchImpl);

    assert.equal(result.kind, "not_configured");
    assert.equal(fetchCalled, false);
  });

  it("test_valid_credential_when_called_sends_bearer_and_encrypted_text_plain_body", async () => {
    const calls: RecordedCall[] = [];
    const fetchImpl = recordedFetch([JSON.stringify({ results: [], totalRecords: 0 })], calls);

    const result = await callGetOrders(
      makeConfig(),
      { invoiceNumber: "602136J" },
      fetchImpl,
    );

    assert.equal(result.kind, "ok");
    assert.equal(calls.length, 1);
    assert.equal(calls[0]!.url, `https://ops.example.com${GET_ORDERS_PATH}`);
    assert.equal(calls[0]!.init.method, "POST");
    const headers = new Headers(calls[0]!.init.headers);
    assert.equal(headers.get("authorization"), `Bearer ${TEST_TOKEN}`);
    assert.equal(headers.get("content-type"), "text/plain");

    const payload = JSON.parse(decryptBody(String(calls[0]!.init.body))) as Record<string, unknown>;
    assert.equal(payload.searchText, "602136J");
    assert.equal(payload.encrypted, true);
    assert.equal(payload.pageSize, PAGE_SIZE);
    assert.equal(payload.pageNumber, 1);
    assert.equal(payload.orderTypes, "1,3,5,4,0");
    assert.match(String(payload.from), /^\d{2}\/\d{2}\/\d{4}$/);
    assert.match(String(payload.to), /^\d{2}\/\d{2}\/\d{4}$/);
  });

  it("test_wrapped_response_when_parsed_collects_order_rows", async () => {
    const fetchImpl = recordedFetch([
      JSON.stringify({
        results: [
          {
            requestId: 90141379,
            invoiceNumber: "602136J",
            roNumber: "nm314470",
            statusName: "Complete",
          },
        ],
        totalRecords: 1,
      }),
    ]);
    const result = await callGetOrders(makeConfig(), { invoiceNumber: "602136J" }, fetchImpl);
    assert.equal(result.kind, "ok");
    if (result.kind === "ok") assert.equal(result.orders.length, 1);
  });

  it("test_multiple_pages_when_returned_are_paged_until_total_is_reached", async () => {
    const calls: RecordedCall[] = [];
    const page1 = JSON.stringify({
      results: [{ invoiceNumber: "602136J", requestId: 100 }],
      totalRecords: 26,
    });
    const page2 = JSON.stringify({
      results: Array.from({ length: 25 }, (_, i) => ({
        invoiceNumber: "602136J",
        requestId: i,
      })),
      totalRecords: 26,
    });
    const fetchImpl = recordedFetch([page1, page2], calls);

    const result = await callGetOrders(makeConfig(), { invoiceNumber: "602136J" }, fetchImpl);

    assert.equal(result.kind, "ok");
    if (result.kind === "ok") assert.equal(result.orders.length, 26);
    assert.equal(calls.length, 2);
    const secondPayload = JSON.parse(decryptBody(String(calls[1]!.init.body))) as Record<string, unknown>;
    assert.equal(secondPayload.pageNumber, 2);
  });

  it("test_repeated_rows_across_pages_when_paged_are_deduped", async () => {
    const row = { invoiceNumber: "602136J", requestId: 7, statusName: "Open" };
    const fetchImpl = recordedFetch([
      JSON.stringify({ results: [row], totalRecords: 2 }),
      JSON.stringify({ results: [{ ...row, statusName: "Open" }], totalRecords: 2 }),
      JSON.stringify({ results: [], totalRecords: 2 }),
    ]);

    const result = await callGetOrders(makeConfig(), { invoiceNumber: "602136J" }, fetchImpl);

    assert.equal(result.kind, "ok");
    if (result.kind === "ok") assert.equal(result.orders.length, 1);
  });

  it("test_max_pages_when_exhausted_without_total_stops_and_warns", async () => {
    const calls: RecordedCall[] = [];
    // Each page returns 25 rows with totalRecords always ahead of what has
    // been collected, so the loop never breaks early.
    let pageIndex = 0;
    const fetchImpl: FetchImpl = async (url, init) => {
      calls.push({ url, init });
      pageIndex += 1;
      return new Response(
        JSON.stringify({
          results: Array.from({ length: PAGE_SIZE }, (_, i) => ({
            invoiceNumber: "X",
            requestId: (pageIndex - 1) * PAGE_SIZE + i,
          })),
          totalRecords: MAX_PAGES * PAGE_SIZE + 1,
        }),
        { status: 200 },
      );
    };

    const result = await callGetOrders(makeConfig(), { invoiceNumber: "X" }, fetchImpl);

    assert.equal(result.kind, "ok");
    if (result.kind === "ok") assert.equal(result.orders.length, MAX_PAGES * PAGE_SIZE);
    assert.equal(calls.length, MAX_PAGES);
  });

  it("test_missing_request_id_rows_when_repeated_are_deduped_by_content", async () => {
    const row = { invoiceNumber: "602136J", statusName: "Open" };
    const fetchImpl = recordedFetch([
      JSON.stringify({ results: [row], totalRecords: 2 }),
      JSON.stringify({ results: [row], totalRecords: 2 }),
      JSON.stringify({ results: [], totalRecords: 2 }),
    ]);

    const result = await callGetOrders(makeConfig(), { invoiceNumber: "602136J" }, fetchImpl);

    assert.equal(result.kind, "ok");
    if (result.kind === "ok") assert.equal(result.orders.length, 1);
  });

  it("test_401_when_received_maps_to_auth_failure", async () => {
    const failing: FetchImpl = async () => new Response("unauthorized", { status: 401 });
    const result = await callGetOrders(makeConfig(), { invoiceNumber: "X" }, failing);
    assert.equal(result.kind, "upstream_failure");
    if (result.kind === "upstream_failure") {
      assert.equal(result.failure, "auth_failure");
      assert.equal(result.status, 401);
    }
  });

  it("test_404_when_received_maps_to_api_error", async () => {
    const failing: FetchImpl = async () => new Response("nope", { status: 404 });
    const result = await callGetOrders(makeConfig(), { invoiceNumber: "X" }, failing);
    assert.equal(result.kind, "upstream_failure");
    if (result.kind === "upstream_failure") assert.equal(result.failure, "api_error");
  });

  it("test_500_when_received_maps_to_api_error_with_detail", async () => {
    const failing: FetchImpl = async () => new Response("boom", { status: 500 });
    const result = await callGetOrders(makeConfig(), { invoiceNumber: "X" }, failing);
    assert.equal(result.kind, "upstream_failure");
    if (result.kind === "upstream_failure") {
      assert.equal(result.failure, "api_error");
      assert.equal(result.detail, "boom");
    }
  });

  it("test_non_json_200_when_parsed_maps_to_unmapped_response", async () => {
    const failing: FetchImpl = async () => new Response("<html>not json</html>", { status: 200 });
    const result = await callGetOrders(makeConfig(), { invoiceNumber: "X" }, failing);
    assert.equal(result.kind, "upstream_failure");
    if (result.kind === "upstream_failure") assert.equal(result.failure, "unmapped_response");
  });

  it("test_rejected_connection_when_fetched_maps_to_network_error", async () => {
    const failing: FetchImpl = async () => {
      throw new Error("getaddrinfo failed");
    };
    const result = await callGetOrders(makeConfig(), { invoiceNumber: "X" }, failing);
    assert.equal(result.kind, "upstream_failure");
    if (result.kind === "upstream_failure") assert.equal(result.failure, "network_error");
  });

  it("test_short_configured_token_when_encrypted_maps_to_not_configured", async () => {
    const failing: FetchImpl = async () => new Response("{}", { status: 200 });
    const result = await callGetOrders(
      makeConfig({ bearerToken: "short" }),
      { invoiceNumber: "X" },
      failing,
    );
    assert.equal(result.kind, "not_configured");
  });
});
