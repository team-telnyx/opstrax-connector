# opstrax-connector (Edge Function)

Stateless invoice lookup against OPS Trax for the Hawk Auto Group voice AI
agent. Mode A (typed fetch handler) Telnyx Edge Compute function — no actors,
no storage.

**Customer use case:** Hawk Auto Group's service desk gets calls asking
"where's my parts order?" Instead of putting the caller on hold and walking
to the counter, the phone receptionist AI answers instantly — caller gives an
invoice or RO number, the agent reads back the order status, and the call
ends naturally when done.

```
Voice AI agent ── tool: lookup_invoice ──▶ POST /opstrax/invoice
                                              │ verify CONNECTOR_SHARED_SECRET
                                              ▼
                                           OPS Trax client (src/opstrax.ts)
                                              │ POST {OPSTRAX_BASE_URL}/api/order/GetOrders
                                              ▼
                                           normalized agent JSON
```

## Endpoints

| Route | Purpose |
|---|---|
| `GET /` | API descriptor |
| `GET /health/liveness`, `GET /health/readiness` | Health checks |
| `POST /opstrax/invoice` | Invoice lookup. Body: `{"invoice_number": "602136J"}`. Exact match only — the `"UNAVAILABLE"` placeholder is never a searchable invoice |
| `GET /opstrax/invoice?invoice_number=X` | Same via query string (curl testing) |
| `POST /opstrax/order` | Repair-order lookup. Body: `{"ro_number": "1420321294"}` — covers RO-only (un-invoiced) orders; an RO shared by multiple invoices returns ALL matches |
| `GET /opstrax/order?ro_number=X` | Same via query string (curl testing) |
| `GET /diagnostics/encryption` | WebCrypto AES-CBC self-check (secret-guarded) |

**Auth on this function:** all `/opstrax/*` calls require the
`x-connector-secret` header matching the `CONNECTOR_SHARED_SECRET` Edge
secret. Header-only — the secret never travels in the URL (which would leak
it to access logs, proxy logs, and referrers). Comparison runs on SHA-256
digests. Fails closed: unauthenticated probes get a generic 401/503 with no
configuration details.

## Response contract (agent-facing)

```json
{
  "mode": "demo",
  "fixture": "filled_complete_602136J",
  "status": "found",
  "order": {
    "invoice_number": "602136J",
    "ro_number": "nm314470",
    "request_id": "90141379",
    "status_name": "Complete",
    "is_filled": true,
    "order_qty": 1,
    "invoice_qty": 1,
    "delivery_date": "2026-11-11",
    "shop_name": "Royal Coach - St. Charles",
    "vehicle_model": "Mazda 3"
  },
  "matched_count": 1,
  "agent_message": "Invoice 602136J for RO nm314470 is Complete (filled), 1 of 1 parts invoiced, delivery date 2026-11-11, for the Mazda 3, going to Royal Coach - St. Charles."
}
```

`mode` is present on every response (`"demo"` or `"live"`); `fixture` is
present on demo responses only. Orders without an invoice number lead their
`agent_message` with "Order for RO …" — an invoice number is never invented.
The vehicle description combines `vMakecode` + `vehicleModel` (only `MAZD`
and `CHEV` are mapped from the verified records; unknown codes pass through
untouched). Delivery timestamps are trimmed to their date part. The agent
never speaks shipped/delivered state from `shippedDate`/`arrivedDate`.

| `status` | HTTP | Meaning |
|---|---|---|
| `found` | 200 | Order located (`matched_count` may exceed 1; `order` is the best match) |
| `not_found` | 200 | No matching order — agent speaks the not-found line |
| `invalid_request` | 400 | Missing/blank invoice number |
| `unauthorized` | 502 | OPS Trax rejected the credential — never surfaces as a client error |
| `upstream_error` | 502 | Network/5xx/unknown-response-shape — agent invites retry |
| `not_configured` | 503 | Required secrets not provisioned (see below) |

## Example requests

```sh
EDGE_URL=https://opstrax-connector-b48e8bc3-4.telnyxcompute.com
SECRET="<x-connector-secret value>"   # from the connector secret store; never commit it

# Invoice lookup
curl -s -X POST -H "x-connector-secret: $SECRET" -H 'content-type: application/json' \
  -d '{"invoice_number":"602136J"}' "$EDGE_URL/opstrax/invoice"

# Repair-order lookup — also covers un-invoiced orders, and returns ALL
# matches when one RO is shared by multiple invoices (ask the caller which)
curl -s -X POST -H "x-connector-secret: $SECRET" -H 'content-type: application/json' \
  -d '{"ro_number":"2533043322"}' "$EDGE_URL/opstrax/order"

# Encryption self-check (WebCrypto AES-128-CBC round-trip in the deployed runtime)
curl -s -H "x-connector-secret: $SECRET" "$EDGE_URL/diagnostics/encryption"
```

Missing/wrong secret → `401`. Missing invoice/RO → `400 invalid_request`.

## Order status semantics (verified against captured portal records)

| Status | Meaning | Spoken as |
|---|---|---|
| `Complete` | All parts invoiced | "Complete (filled)" |
| `Viewed` | Order entered, nothing invoiced yet | "Viewed (not yet filled)" |
| `Partial` | Some parts invoiced; remaining parts have a partial date | "Partial" — **never** "(filled)", even though `isFilled: true` in the record |
| `Unavailable` | One or more parts unavailable from the vendor | "Unavailable" — **never** "(filled)", even though `isFilled: true` in the record |

Semantics the agent relies on (and the tests pin down):

- `isFilled: true` on Partial/Unavailable does **not** mean Complete — only
  the status name does.
- `deliveryDate` and `partialDate` are preserved as separate fields
  (e.g. invoice `601515J`: delivery 2026-11-09, partial date 2026-11-16).
- `invoiceNumber: "UNAVAILABLE"` is a status placeholder, not an invoice: it
  is normalized to `null`, is never searchable as an invoice, and is never
  spoken. Orders with a null invoice number lead their message with
  "Order for RO …" — an invoice number is never invented.
- `isReceived: false` is reported even when `arrivedDate`/`receivedDate`
  timestamps are populated — receipt is never inferred from timestamps.
- Dates are spoken naturally by the agent ("November twelfth") and API field
  names are never spoken.


## Request encryption (IMPLEMENTING-ENCRYPTION.md)

OPS Trax only accepts **encrypted request bodies** — plain JSON returns
`HTTP 500`. The scheme is implemented in `src/encryption.ts`:

| | |
|---|---|
| Cipher | AES-128-CBC, PKCS7 padding |
| Key | first 16 bytes (UTF-8) of the bearer token, `Bearer ` prefix stripped |
| IV | fixed string `ABH&&%#@HKLU1239` (from the portal's own JS — not a secret) |
| Body | `base64(ciphertext)` sent as `Content-Type: text/plain` |

- WebCrypto's `AES-CBC` applies PKCS7 padding per the Web Crypto spec — exactly
  what the portal expects. The implementation is cross-checked byte-for-byte
  against a `node:crypto` reference in `test/encryption.test.ts`.
- **Caveat resolved:** WebCrypto AES-128-CBC is confirmed working in the
  deployed Telnyx Edge runtime (verified live via the
  `/diagnostics/encryption` self-check, 2026-11-11), so no plaintext
  fallback exists or is needed.
- Encryption is **deterministic** (fixed IV, key from token): the same
  payload always yields the same ciphertext, which the tests rely on.
- Failures before the wire (e.g. token shorter than 16 bytes) map to
  `not_configured`, since they indicate a mis-provisioned credential.

## Modes: DEMO vs LIVE (strictly separated)

| Mode | When active | Response label |
|---|---|---|
| LIVE | `OPSTRAX_BEARER_TOKEN` provisioned | `"mode": "live"` |
| DEMO | `OPSTRAX_DEMO_MODE` on AND no live credential | `"mode": "demo"` |

- DEMO serves verified OPS Trax records captured from the portal (fixtures
  in `src/demo.ts` carry the exact captured field values):
  - invoice `602136J` → requestId 90141379, RO `nm314470`, "Royal Coach -
    St. Charles", Mazda 3 (`MAZD`), Complete/filled, 1 of 1 parts
    invoiced, delivery 2026-11-11 — not shipped, not delivered
    (`shippedDate`/`arrivedDate` are null in the record)
  - RO `1420321294` → requestId 90145102, "Gerber - Bloomington",
    Chevrolet Silverado 1500 RST Crew Cab 147" WB 4WD (`CHEV`),
    Viewed/unfilled, 0 of 1 parts invoiced, **no invoice number** (null in
    the record) — reachable only via `/opstrax/order`
  - RO `2533043322` → two invoiced orders sharing that RO (fixture
    `ro_multiple_2533043322`): invoice `209140` (requestId 90168656) with
    delivery 2026-11-11 and invoice `208753` (requestId 89947164) with
    delivery 2026-11-05 — both "Caliber - Blue Island - Western Ave",
    Volkswagen Atlas Cross Sport (`VW  ` with the portal's trailing-space
    padding preserved), Complete/filled, 1 of 1 parts invoiced
  - Invoice lookup stays exact: `209140` and `208753` each return only
    their own record; the RO number used as an invoice returns
    `not_found`
  - RO `11704` → requestId 90160484, "CARSTAR Todd's Body Shop",
    Cadillac XTS Luxury FWD (`CADI`), Viewed/unfilled, 0 of 1 parts
    invoiced, **no invoice number** — reachable only via `/opstrax/order`
  - RO `1410332453` → requestId 90159093, "Gerber - Crystal Lake",
    Cadillac CT5 Premium Luxury (`CADI`), Viewed/unfilled, 0 of 1 parts
    invoiced, **no invoice number** — reachable only via `/opstrax/order`
  - invoice `601515J` / RO `1420321273` → requestId 90051769,
    "Gerber - Bloomington", Cadillac CTS Sedan Luxury AWD (`CADI`),
    status **Partial** with `isFilled: true` (Partial ≠ Complete), 2 of 2
    parts invoiced, `deliveryDate` 2026-11-09 and `partialDate`
    2026-11-16 kept as separate fields, `isReceived: false` — the record
    carries `arrivedDate`/`receivedDate` timestamps, but receipt is
    **never** inferred from them; the summary says "not yet received"
  - invoice `602307J` / RO `11744` → requestId 90168346, "CARSTAR Todd's
    Body Shop", Chevrolet Silverado 1500 LT Crew Cab 147" WB 4WD w/1LT
    Pkg (`CHEV`), status **Partial** with `isFilled: true`, 10 of 10
    parts invoiced, delivery 2026-11-12, partial date 2026-11-16,
    `isReceived: false`
  - RO `1421830434` → requestId 90117309, "Gerber - Plainfield", Jeep
    Compass Latitude 4WD (`JEEP`), status **Unavailable** with
    `isFilled: true` (Unavailable ≠ Complete), 1 part unavailable, 0 of
    1 parts invoiced, `invoiceNumber` is the literal placeholder
    `"UNAVAILABLE"` — normalized to null so it can neither be searched
    as an invoice nor spoken as one — delivery 2026-11-10, partial date
    2026-11-10, `isReceived: false`
  - Any other identifier (including `TEST-NOT-FOUND-99999` and the
    literal string `UNAVAILABLE`) maps to the recorded no-match envelope
    `{"results": [], "totalRecords": 0}`, labeled
    `fixture: "recorded_no_match"`.
- RO lookup returns **all** exact matches (`orders[]`, `matched_count`)
  with an `agent_message` that lists every invoice and tells the agent to
  ask the caller which one they want — it never silently picks the first.
- Fixtures contain only the documented non-contact fields. A test asserts
  the demo source never gains shop-contact or dealer-contact PII keys.
- If a live credential exists, the DEMO flag is ignored entirely — the
  connector always calls the real OPS Trax API. Demo data is **never**
  substituted when a live request fails; a live failure surfaces as
  `unauthorized`/`upstream_error`, not as demo data.
- Every response carries its `mode`, so a demo result can never masquerade
  as a live one.
- Auth is identical in both modes: `x-connector-secret` header required.

## Live deployment reference (as of 2026-11-11)

| Component | Value |
|---|---|
| Telnyx AI Assistant | `assistant-340973f7-dba2-41b3-8a83-c793580c4176` — "Hawk Auto — OPS Trax Order Lookup (Test)" |
| Model | `moonshotai/Kimi-K2.6` |
| Voice | `Telnyx.Ultra.f786b574-daa5-4673-aa0c-cbe3e8534c02` @ `voice_speed` 0.9 |
| Phone number | `+18102971205` (TeXML app `3090935876847404732`) |
| Edge Function | `opstrax-connector`, func_id `b48e8bc3-46c8-4866-a560-0f395cc62996` |
| Deployed URL | `https://opstrax-connector-b48e8bc3-4.telnyxcompute.com` |
| Assistant tools | `lookup_invoice` → `/opstrax/invoice`, `lookup_ro` → `/opstrax/order`, built-in `hangup` (goodbye → hangup verified on live PSTN calls) |
| Tool auth | `x-connector-secret: {{#integration_secret}}opstrax_connector_secret{{/integration_secret}}` (integration secret id `f2fe5c12-54dc-415b-a7a5-0be7665075b0`) — the secret value itself lives only in Telnyx's secret store |

The assistant greets, asks for an invoice or RO number, reads back the
status in natural language, offers further help, and on "that's all" says
"Thank you for calling Hawk Auto Group! Have a great day!" then terminates
the call with the built-in hangup tool — never before the goodbye finishes,
and never while the caller wants more help.

## Deploy

```sh
```sh
npm install && npm run typecheck && npm test   # 153 unit tests, no network
telnyx-edge new-func --actor --name=opstrax-connector   # once, to mint func_id
# → copy this src/ + telnyx.toml over the scaffold, keep the real func_id
telnyx-edge secrets add CONNECTOR_SHARED_SECRET "$(openssl rand -hex 32)"
telnyx-edge secrets add OPSTRAX_DEMO_MODE 1     # for a customer demo without a live credential
telnyx-edge secrets add OPSTRAX_BEARER_TOKEN <token-issued-by-ops-trax>  # live mode (overrides demo)
telnyx-edge ship    # re-ship AFTER secrets add — secrets inject at deploy time
```

Secrets (all injected at deploy time, never in code):

| Secret | Purpose |
|---|---|
| `CONNECTOR_SHARED_SECRET` | Inbound bearer for agent tool calls |
| `OPSTRAX_BEARER_TOKEN` | OPS-issued service credential (when available) |
| `OPSTRAX_BASE_URL` | Optional override; default `https://v3.opstrax.com` |
| `OPSTRAX_TIMEOUT_MS` | Optional; default 10000 |
| `OPSTRAX_LOOKBACK_DAYS` | Optional; search window in days. Default 30, max 365 |
| `OPSTRAX_DEMO_MODE` | Optional; "1"/"true"/"yes"/"on". Demo fixtures (no live credential) |

**Token expiry:** the API key is tied to the OPS Trax login token. A `401`
after a period of use means the token expired — OPS must re-issue; there is
no automated login. Never substitute browser session tokens.

## Missing dependencies — the blocker

This connector is **functionally complete but operationally blocked** on one
external fact: no authorized OPS Trax credential exists yet (as of
2026-11-11, none is provisioned in the environment, repo, or Telnyx
secrets). Until OPS issues one, live calls fail fast with `not_configured`.
Browser session tokens observed via DevTools are *not* a supported
integration surface and are deliberately not implemented.

What to request from OPS Trax (via support.opstrax.com / Hawk's account
manager): official API access for order-status lookup, service credentials,
a sandbox host, rate limits, and written permission for programmatic access.

Response tolerance: `collectOrders()` walks the parsed JSON and accepts any
envelope shape, because the exact GetOrders envelope beyond the documented
field list is unconfirmed. An HTML/garbage 200 response maps to
`upstream_error` (`unmapped_response`) rather than crashing.

**PII caution:** GetOrders responses contain customer contact and vehicle
details. Only the documented, normalized fields are relayed to the agent —
never log or forward raw upstream bodies.

## Verification checklist (post-credential, pre-assistant)

1. `curl $EDGE_URL/` → descriptor
2. `curl $EDGE_URL/health/liveness` and `/health/readiness` → `ok`
3. Secret not provisioned → 503 `unavailable`; wrong or missing header → 401
4. `curl -H 'x-connector-secret: …' $EDGE_URL/diagnostics/encryption` → `ok: true` proves the deployed runtime can produce encrypted OPS Trax requests (WebCrypto AES-128-CBC round-trip through the production encrypt path)
5. Demo mode: `telnyx-edge secrets add OPSTRAX_DEMO_MODE 1` + re-ship → fixture lookups labeled `mode: "demo"`; remove the flag and re-ship before live use
6. First live lookup — single read: `telnyx-edge secrets add OPSTRAX_BEARER_TOKEN <token>`, `telnyx-edge ship`, then one
   `curl -X POST -H 'x-connector-secret: …' -d '{"invoice_number":"602136J"}' $EDGE_URL/opstrax/invoice`
   and confirm the encrypted body is accepted (no `HTTP 500` / "cipherText cannot be null").
7. Exercise `found`, `not_found` (unknown invoice), `unauthorized` (expired token → 401 → re-provision), `upstream_error` (network path).
8. Only then wire the AI agent tool (per `docs/ai-assistant-integration-recipe.md`, Tools Library).
