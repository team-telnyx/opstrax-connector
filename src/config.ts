/**
 * Runtime configuration for the OPS Trax connector, sourced from Edge
 * secrets (injected as process.env at deploy time — see
 * skills/steves-edge-actor-skills/SKILL.md §"Secrets and the [telnyx]"
 * binding"). Fail-closed: the fetch handler refuses to serve lookups until
 * the required secrets are provisioned.
 */

export const GET_ORDERS_PATH = "/api/order/GetOrders";

export interface ConnectorConfig {
  /** OPS Trax portal origin. Overridable for a future sandbox host. */
  baseUrl: string;
  /**
   * OPS-issued API credential (the portal bearer token, WITHOUT the
   * "Bearer " prefix — stripped here if present). The AES key is derived
   * from its first 16 bytes on every request. Until OPS provides one this
   * is unset and every live call fails fast with `not_configured`.
   */
  bearerToken?: string;
  /** Shared secret the AI agent's tool calls must present. */
  sharedSecret?: string;
  /** Outbound call timeout in milliseconds. */
  timeoutMs: number;
  /** How many days back the GetOrders date window reaches. */
  lookbackDays: number;
  /** DEMO mode flag (OPSTRAX_DEMO_MODE). Only honored when no live credential exists. */
  demoMode: boolean;
}

const DEFAULT_BASE_URL = "https://v3.opstrax.com";
const DEFAULT_TIMEOUT_MS = 10_000;
const DEFAULT_LOOKBACK_DAYS = 30;
const MAX_LOOKBACK_DAYS = 365;

/** Strip an optional "Bearer " prefix from a credential string. */
export function normalizeBearerToken(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const stripped = raw.replace(/^Bearer\s+/i, "").trim();
  return stripped === "" ? undefined : stripped;
}

export function loadConfig(env: Record<string, string | undefined>): ConnectorConfig {
  const timeoutValue = Number(env.OPSTRAX_TIMEOUT_MS ?? "");
  const lookbackValue = Number(env.OPSTRAX_LOOKBACK_DAYS ?? "");
  return {
    baseUrl: (env.OPSTRAX_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/+$/, ""),
    bearerToken: normalizeBearerToken(env.OPSTRAX_BEARER_TOKEN),
    sharedSecret: env.CONNECTOR_SHARED_SECRET || undefined,
    timeoutMs:
      Number.isFinite(timeoutValue) && timeoutValue > 0 ? timeoutValue : DEFAULT_TIMEOUT_MS,
    lookbackDays:
      Number.isInteger(lookbackValue) && lookbackValue >= 1
        ? Math.min(lookbackValue, MAX_LOOKBACK_DAYS)
        : DEFAULT_LOOKBACK_DAYS,
    demoMode: parseBooleanFlag(env.OPSTRAX_DEMO_MODE),
  };
}

/** OPSTRAX_DEMO_MODE is true for "1", "true", "yes", or "on" (any case). */
export function parseBooleanFlag(raw: string | undefined): boolean {
  return ["1", "true", "yes", "on"].includes((raw ?? "").trim().toLowerCase());
}
