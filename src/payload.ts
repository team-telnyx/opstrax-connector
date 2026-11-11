/**
 * Builds the OPS Trax GetOrders request payload (before encryption).
 *
 * Per GetOrders.md:
 *   - Dates are MM/DD/YYYY (request-date window).
 *   - Statuses/types are the site's tab presets; ALL covers every status so
 *     we never assume an invoice is Complete.
 *   - Key order matters only for test determinism; the server parses any
 *     valid JSON.
 */
export const ALL_STATUS_IDS = "0,1,2,3,4,5,6,7,9,10,11";
export const UNFILLED_STATUS_IDS = "0,1,9,10";
export const FILLED_STATUS_IDS = "2,3,4,5,6,7,11";
export const ORDER_TYPES = "1,3,5,4,0";
export const PAGE_SIZE = 25;
export const SORT_FIELD = "-request_date";
const DAY_MS = 86_400_000;

/** The GetOrders wire payload (before encryption). */
export interface GetOrdersPayload {
  pageSize: number;
  pageNumber: number;
  from: string;
  to: string;
  statusId: string;
  orderTypes: string;
  searchText: string;
  orderby: string;
  dealerMakeType: null;
  dealers: string;
  isContainBackorders: number;
  encrypted: true;
}

export interface PayloadQuery {
  invoiceNumber: string;
  pageNumber: number;
  /** Instant to anchor the date window (injectable for tests). */
  now: Date;
  lookbackDays: number;
}

/** Build one page's payload. Pure: inject `now` for deterministic tests. */
export function buildGetOrdersPayload(query: PayloadQuery): GetOrdersPayload {
  const to = startOfLocalDay(query.now);
  // lookbackDays counts today: a 30-day window reaches back 29 days before
  // today, so exactly 30 calendar days are searched inclusive.
  const from = startOfLocalDay(new Date(to.getTime() - (query.lookbackDays - 1) * DAY_MS));
  return {
    pageSize: PAGE_SIZE,
    pageNumber: query.pageNumber,
    from: formatDate(from),
    to: formatDate(to),
    statusId: ALL_STATUS_IDS,
    orderTypes: ORDER_TYPES,
    searchText: query.invoiceNumber,
    orderby: SORT_FIELD,
    dealerMakeType: null,
    dealers: "",
    isContainBackorders: 0,
    encrypted: true,
  };
}

/** Local-time midnight of the given instant's day (avoids TZ drift in tests). */
function startOfLocalDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** MM/DD/YYYY, zero-padded, per the portal's format. */
export function formatDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${month}/${day}/${date.getFullYear()}`;
}
