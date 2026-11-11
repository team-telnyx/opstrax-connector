import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  ALL_STATUS_IDS,
  ORDER_TYPES,
  PAGE_SIZE,
  SORT_FIELD,
  buildGetOrdersPayload,
  formatDate,
} from "../src/payload.ts";

const NOW = new Date(2026, 10, 11); // local 2026-11-11

describe("buildGetOrdersPayload", () => {
  it("test_first_page_when_built_sends_documented_defaults", () => {
    const payload = buildGetOrdersPayload({
      invoiceNumber: "602136J",
      pageNumber: 1,
      now: NOW,
      lookbackDays: 30,
    });
    assert.equal(payload.pageSize, PAGE_SIZE);
    assert.equal(payload.pageNumber, 1);
    assert.equal(payload.searchText, "602136J");
    assert.equal(payload.statusId, ALL_STATUS_IDS);
    assert.equal(payload.orderTypes, ORDER_TYPES);
    assert.equal(payload.orderby, SORT_FIELD);
    assert.equal(payload.dealerMakeType, null);
    assert.equal(payload.dealers, "");
    assert.equal(payload.isContainBackorders, 0);
    assert.equal(payload.encrypted, true);
  });

  it("test_date_window_when_built_uses_mmddyyyy_local_dates", () => {
    const payload = buildGetOrdersPayload({
      invoiceNumber: "X",
      pageNumber: 1,
      now: NOW,
      lookbackDays: 30,
    });
    assert.equal(payload.to, "11/11/2026");
    // Inclusive window: today plus 29 days back = 30 calendar days.
    assert.equal(payload.from, "10/13/2026");
  });

  it("test_date_window_when_built_includes_entire_year_long_lookback", () => {
    const payload = buildGetOrdersPayload({
      invoiceNumber: "X",
      pageNumber: 1,
      now: new Date(2026, 10, 11),
      lookbackDays: 365,
    });
    assert.equal(payload.from, "11/12/2025");
  });

  it("test_second_page_when_built_increments_page_number_only", () => {
    const first = buildGetOrdersPayload({
      invoiceNumber: "X",
      pageNumber: 1,
      now: NOW,
      lookbackDays: 7,
    });
    const second = buildGetOrdersPayload({
      invoiceNumber: "X",
      pageNumber: 2,
      now: NOW,
      lookbackDays: 7,
    });
    assert.equal(second.pageNumber, 2);
    assert.equal(second.from, first.from);
    assert.equal(second.to, first.to);
    assert.equal(second.searchText, first.searchText);
  });

  it("test_invoice_search_text_when_passed_is_never_mutated", () => {
    const payload = buildGetOrdersPayload({
      invoiceNumber: " 602136J ",
      pageNumber: 1,
      now: NOW,
      lookbackDays: 30,
    });
    assert.equal(payload.searchText, " 602136J ");
  });

  it("test_status_ids_when_built_cover_all_documented_statuses", () => {
    const payload = buildGetOrdersPayload({
      invoiceNumber: "X",
      pageNumber: 1,
      now: NOW,
      lookbackDays: 1,
    });
    assert.deepEqual(payload.statusId.split(",").map(Number).sort((a, b) => a - b), [
      0, 1, 2, 3, 4, 5, 6, 7, 9, 10, 11,
    ]);
  });
});

describe("formatDate", () => {
  it("test_single_digit_month_and_day_when_formatted_is_zero_padded", () => {
    assert.equal(formatDate(new Date(2026, 0, 5)), "01/05/2026");
  });

  it("test_double_digit_month_and_day_when_formatted_is_correct", () => {
    assert.equal(formatDate(new Date(2026, 10, 11)), "11/11/2026");
  });
});
