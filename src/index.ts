/**
 * opstrax-connector — Telnyx Edge Function (Mode A fetch handler).
 *
 * Exposes a stateless invoice lookup for the Hawk Auto Group voice AI
 * agent. Follows the conventions proven in apps/ai-auto-care:
 *   - GET / always returns an API descriptor
 *   - liveness/readiness health endpoints
 *   - secrets via process.env (injected at deploy time)
 *
 * Routes:
 *   GET  /                              → API descriptor
 *   GET  /health/liveness|readiness     → "ok"
 *   POST /opstrax/invoice               → { invoice_number } lookup
 *   GET  /opstrax/invoice?invoice_number=X → same, for curl testing
 *   POST /opstrax/order                 → { ro_number } lookup
 *   GET  /opstrax/order?ro_number=X     → same, for curl testing
 *   GET  /diagnostics/encryption        → WebCrypto AES-CBC self-check (secret-guarded)
 *
 * Inbound auth: the `x-connector-secret` header must equal the
 * CONNECTOR_SHARED_SECRET Edge secret. Header-only — never the URL, which
 * would leak the secret to logs and referrers. Comparison runs on SHA-256
 * digests to avoid timing/length-conditional branches.
 *
 * Modes (strictly separated, never silently substituted):
 *   - LIVE: used whenever OPSTRAX_BEARER_TOKEN is provisioned.
 *   - DEMO: serves labeled fixtures (`mode: "demo"`) only when
 *     OPSTRAX_DEMO_MODE is on AND no live credential exists.
 */
import type { ConnectorConfig } from "./config.ts";
import { loadConfig } from "./config.ts";
import { isDemoModeActive, lookupDemoInvoice, lookupDemoOrderByRo } from "./demo.ts";
import type { DemoLookup } from "./demo.ts";
import { verifyWebCryptoAesCbc } from "./diagnostics.ts";
import { parseInvoiceRequest, parseRoRequest } from "./invoice.ts";
import { buildOutcome, buildRoOutcome, outcomeHttpStatus } from "./lookup.ts";
import type { FetchImpl } from "./opstrax.ts";
import { callGetOrders } from "./opstrax.ts";
import type { GetOrdersRequest } from "./types.ts";

const SHARED_SECRET_HEADER = "x-connector-secret";

export default {
  async fetch(req: Request): Promise<Response> {
    return routeRequest(req, loadConfig(process.env));
  },
};

/** Route table; config and fetch injected so tests exercise every branch. */
export async function routeRequest(
  req: Request,
  config: ConnectorConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "") || "/";

  if (path === "/health/liveness") return new Response("ok");
  if (path === "/health/readiness") return new Response("ok");

  if (path === "/" && req.method === "GET") {
    return Response.json({
      service: "opstrax-connector",
      endpoints: {
        "POST /opstrax/invoice":
          'Look up an OPS Trax order by invoice number. Body: { "invoice_number": "602136J" }. Note: invoiceNumber "UNAVAILABLE" in some recorded responses is a status placeholder, not a searchable invoice.',
        "GET /opstrax/invoice?invoice_number=X":
          "Same lookup via query string, for curl testing.",
        "POST /opstrax/order":
          'Look up OPS Trax orders by repair order number. Body: { "ro_number": "1420321294" }. RO-only (un-invoiced) orders have no invoice number. An RO shared by several invoices returns ALL matching orders (orders[]) — the agent asks the caller which invoice to check.',
        "GET /opstrax/order?ro_number=X":
          "Same RO lookup via query string, for curl testing.",
        "GET /diagnostics/encryption":
          "WebCrypto AES-CBC self-check (secret-guarded). Verifies the deployed runtime can produce encrypted OPS Trax requests.",
      },
      auth: `${SHARED_SECRET_HEADER} header (CONNECTOR_SHARED_SECRET)`,
      modes:
        'live (default) or demo when OPSTRAX_DEMO_MODE is on and no live credential is provisioned; every response is labeled with its mode',
    });
  }

  if (path === "/diagnostics/encryption" && req.method === "GET") {
    const guard = await requireSharedSecret(config.sharedSecret, req);
    if (guard !== null) return guard;
    const check = await verifyWebCryptoAesCbc();
    if (!check.ok) console.warn(`opstrax: encryption self-check failed: ${check.detail}`);
    return Response.json(
      { check: "webcrypto_aes_cbc", ok: check.ok, detail: check.detail },
      { status: check.ok ? 200 : 503 },
    );
  }

  if (path === "/opstrax/invoice") {
    if (req.method !== "GET" && req.method !== "POST") {
      return Response.json(
        { error: "method not allowed" },
        { status: 405, headers: { allow: "GET, POST" } },
      );
    }
    return handleInvoiceLookup(req, config, fetchImpl);
  }

  if (path === "/opstrax/order") {
    if (req.method !== "GET" && req.method !== "POST") {
      return Response.json(
        { error: "method not allowed" },
        { status: 405, headers: { allow: "GET, POST" } },
      );
    }
    return handleOrderLookupByRo(req, config, fetchImpl);
  }

  return Response.json({ error: "not found" }, { status: 404 });
}

export async function handleInvoiceLookup(
  req: Request,
  config: ConnectorConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const guard = await requireSharedSecret(config.sharedSecret, req);
  if (guard !== null) return guard;

  const mode = isDemoModeActive(config) ? "demo" : "live";

  const parsed = parseInvoiceRequest(await readInvoiceBody(req));
  if (!parsed.ok) {
    return Response.json(
      {
        mode,
        status: "invalid_request",
        agent_message:
          "Please provide the invoice number, for example invoice six zero two one three six J.",
      },
      { status: 400 },
    );
  }

  if (mode === "demo") {
    const demo = lookupDemoInvoice(parsed.invoiceNumber);
    return Response.json(
      { mode, fixture: demo.fixture, ...demo.outcome },
      { status: outcomeHttpStatus(demo.outcome) },
    );
  }

  const result = await callGetOrders(
    config,
    { invoiceNumber: parsed.invoiceNumber } satisfies GetOrdersRequest,
    fetchImpl,
  );
  const outcome = buildOutcome(result, parsed.invoiceNumber);
  return Response.json({ mode, ...outcome }, { status: outcomeHttpStatus(outcome) });
}

/**
 * Repair-order lookup. RO-only (un-invoiced) orders carry no invoice
 * number, so they are reachable only through this endpoint. Same fail-closed
 * matching: an unknown RO is "not found", never a different order.
 */
export async function handleOrderLookupByRo(
  req: Request,
  config: ConnectorConfig,
  fetchImpl: FetchImpl = fetch,
): Promise<Response> {
  const guard = await requireSharedSecret(config.sharedSecret, req);
  if (guard !== null) return guard;

  const mode = isDemoModeActive(config) ? "demo" : "live";

  const parsed = parseRoRequest(await readRoBody(req));
  if (!parsed.ok) {
    return Response.json(
      {
        mode,
        status: "invalid_request",
        agent_message: "Please provide the repair order (RO) number.",
      },
      { status: 400 },
    );
  }

  if (mode === "demo") {
    const demo = lookupDemoOrderByRo(parsed.roNumber);
    return Response.json(
      { mode, fixture: demo.fixture, ...demo.outcome },
      { status: outcomeHttpStatus(demo.outcome) },
    );
  }

  // GetOrders.searchText accepts "the invoice, RO or other search term",
  // so the identical encrypted client serves RO lookups.
  const result = await callGetOrders(
    config,
    { invoiceNumber: parsed.roNumber } satisfies GetOrdersRequest,
    fetchImpl,
  );
  const outcome = buildRoOutcome(result, parsed.roNumber);
  return Response.json({ mode, ...outcome }, { status: outcomeHttpStatus(outcome) });
}

/**
 * Verify the shared secret, timing-safely, over SHA-256 digests.
 * Returns a Response to reject, or null to allow the request.
 * Unauthenticated probes get generic bodies — configuration state is never
 * disclosed to callers that have not passed the secret check.
 */
export async function requireSharedSecret(
  sharedSecret: string | undefined,
  req: Request,
): Promise<Response | null> {
  const provided = req.headers.get(SHARED_SECRET_HEADER);
  if (sharedSecret === undefined) {
    console.warn("opstrax: CONNECTOR_SHARED_SECRET not provisioned; rejecting request");
    return Response.json({ error: "unavailable" }, { status: 503 });
  }
  const providedDigest = await sha256Hex(provided ?? "");
  const expectedDigest = await sha256Hex(sharedSecret);
  if (providedDigest !== expectedDigest) {
    return Response.json({ error: "unauthorized" }, { status: 401 });
  }
  return null;
}

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(digest))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

/**
 * Extract the tool-call body in the shape parseInvoiceRequest expects:
 * `{ invoice_number }` from the query string (GET) or JSON body (POST).
 * Unreadable or non-object bodies map to "" so the shared parse path
 * produces the same `invalid_request` outcome as a missing field.
 */
async function readInvoiceBody(req: Request): Promise<unknown> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const raw = url.searchParams.get("invoice_number") ?? url.searchParams.get("invoiceNumber");
    return { invoice_number: raw ?? "" };
  }
  try {
    return (await req.json()) as unknown;
  } catch (error) {
    console.warn(`opstrax: unreadable request body: ${messageOf(error)}`);
    return "";
  }
}

/** Same shape as readInvoiceBody, for `{ ro_number }` lookups. */
async function readRoBody(req: Request): Promise<unknown> {
  if (req.method === "GET") {
    const url = new URL(req.url);
    const raw = url.searchParams.get("ro_number") ?? url.searchParams.get("roNumber");
    return { ro_number: raw ?? "" };
  }
  try {
    return (await req.json()) as unknown;
  } catch (error) {
    console.warn(`opstrax: unreadable request body: ${messageOf(error)}`);
    return "";
  }
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
