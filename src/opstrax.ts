/**
 * OPS Trax API client for the GetOrders endpoint.
 *
 * Wire format (IMPLEMENTING-ENCRYPTION.md + GetOrders.md):
 *   POST {base}/api/order/GetOrders
 *   Authorization: Bearer <token>
 *   Content-Type: text/plain
 *   body: base64(AES-128-CBC(JSON))
 *
 * Error signatures:
 *   401 → missing/invalid credential
 *   400 "cipherText cannot be null" → missing text/plain content type
 *   500 → plain JSON body, wrong key, or wrong IV
 *
 * Known limitation: the API key changes with the login token. When it
 * expires (401), a new authorized token must be provisioned; there is no
 * automated login. Do not fall back to browser session tokens.
 */
import type { ConnectorConfig } from "./config.ts";
import { GET_ORDERS_PATH } from "./config.ts";
import { classifyFailure, collectOrders } from "./invoice.ts";
import { encryptOpstraxRequest } from "./encryption.ts";
import { buildGetOrdersPayload } from "./payload.ts";
import type { FailureKind, GetOrdersRequest, OpstraxOrderRow } from "./types.ts";

/**
 * Minimal fetch signature so tests can stub without type casts.
 * The platform `fetch` (Edge runtime / Node) satisfies this structurally.
 */
export type FetchImpl = (
  url: string,
  init: RequestInit,
) => Promise<Response>;

export type GetOrdersResult =
  | { kind: "ok"; orders: OpstraxOrderRow[] }
  | { kind: "not_configured"; detail: string }
  | { kind: "upstream_failure"; failure: FailureKind; status?: number; detail?: string };

/** Hard ceiling on pagination: 40 pages × 25 rows = 1,000 orders max. */
export const MAX_PAGES = 40;

/**
 * Fetch all pages of the invoice search. The portal paginates at
 * PAGE_SIZE=25 per request; multiple pages are only hit when the search
 * matches many orders. Each request is read-only.
 */
export async function callGetOrders(
  config: ConnectorConfig,
  query: GetOrdersRequest,
  fetchImpl: FetchImpl = fetch,
): Promise<GetOrdersResult> {
  if (!config.bearerToken) {
    return {
      kind: "not_configured",
      detail:
        "OPSTRAX_BEARER_TOKEN is not provisioned. OPS Trax must issue a service credential " +
        "before live calls can be made (see README → Missing dependencies).",
    };
  }

  const url = `${config.baseUrl}${GET_ORDERS_PATH}`;
  const all: OpstraxOrderRow[] = [];
  const seenRowKeys = new Set<string>();
  const now = new Date();
  let stoppedEarly = false;

  for (let pageNumber = 1; pageNumber <= MAX_PAGES; pageNumber++) {
    const payload = buildGetOrdersPayload({
      invoiceNumber: query.invoiceNumber,
      pageNumber,
      now,
      lookbackDays: config.lookbackDays,
    });

    let body: string;
    try {
      body = await encryptOpstraxRequest(JSON.stringify(payload), config.bearerToken);
    } catch (error) {
      console.warn(`opstrax: request encryption failed: ${messageOf(error)}`);
      return {
        kind: "not_configured",
        detail: `request encryption failed (likely an invalid or unsupported credential): ${messageOf(error)}`,
      };
    }

    let response: Response;
    try {
      response = await fetchImpl(url, {
        method: "POST",
        headers: {
          "Authorization": `Bearer ${config.bearerToken}`,
          "Content-Type": "text/plain",
        },
        body,
        signal: AbortSignal.timeout(config.timeoutMs),
      });
    } catch (error) {
      const isTimeout =
        typeof error === "object" &&
        error !== null &&
        (error as { name?: string }).name === "TimeoutError";
      if (isTimeout) {
        console.warn(`opstrax: request to ${url} timed out after ${config.timeoutMs}ms`);
      } else {
        console.warn(`opstrax: network failure calling ${url}: ${messageOf(error)}`);
      }
      return {
        kind: "upstream_failure",
        failure: "network_error",
        detail: messageOf(error),
      };
    }

    if (response.status !== 200) {
      return mapHttpError(response, url);
    }

    const page = await parseOrdersPage(response);
    if (page === null) {
      console.warn(`opstrax: 200 response from ${url} was not parseable JSON`);
      return { kind: "upstream_failure", failure: "unmapped_response", status: 200 };
    }

    all.push(...dedupe(page.orders, seenRowKeys));
    const total = page.totalRecords ?? all.length;
    if (page.orders.length === 0 || all.length >= total) {
      stoppedEarly = true;
      break;
    }
  }

  if (!stoppedEarly) {
    console.warn(
      `opstrax: page limit of ${MAX_PAGES} reached with ${all.length} rows collected; ` +
        "results may be truncated relative to the full result set",
    );
  }

  return { kind: "ok", orders: all };
}

/** Drop rows seen on an earlier page (paging instability can repeat rows). */
function dedupe(rows: OpstraxOrderRow[], seen: Set<string>): OpstraxOrderRow[] {
  const fresh: OpstraxOrderRow[] = [];
  for (const row of rows) {
    const key = row.requestId !== undefined && row.requestId !== null
      ? `id:${JSON.stringify(row.requestId)}`
      : JSON.stringify(row);
    if (!seen.has(key)) {
      seen.add(key);
      fresh.push(row);
    }
  }
  return fresh;
}

async function mapHttpError(response: Response, url: string): Promise<GetOrdersResult> {
  const detail = (await safeBodyText(response)).slice(0, 500) || undefined;
  const failure = classifyFailure(response.status);
  console.warn(
    `opstrax: ${response.status} from ${url} (${failure})${detail ? `: ${detail}` : ""}`,
  );
  return { kind: "upstream_failure", failure, status: response.status, detail };
}

interface OrdersPage {
  orders: OpstraxOrderRow[];
  totalRecords?: number;
}

/**
 * Parse one GetOrders response page. The documented envelope is
 * `{ results: [...], totalRecords: n }`; extraction stays tolerant because
 * the only verified contract is the field names of the rows themselves.
 */
async function parseOrdersPage(response: Response): Promise<OrdersPage | null> {
  const text = await safeBodyText(response);
  if (text.trim() === "") return null;
  try {
    const parsed = JSON.parse(text) as unknown;
    const orders = collectOrders(parsed);
    const totalRecords =
      typeof parsed === "object" &&
      parsed !== null &&
      typeof (parsed as { totalRecords?: unknown }).totalRecords === "number"
        ? (parsed as { totalRecords: number }).totalRecords
        : undefined;
    return { orders, totalRecords };
  } catch {
    return null;
  }
}

async function safeBodyText(response: Response): Promise<string> {
  try {
    return await response.text();
  } catch (error) {
    console.warn(`opstrax: failed reading response body: ${messageOf(error)}`);
    return "";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
