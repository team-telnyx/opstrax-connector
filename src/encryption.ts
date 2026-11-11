/**
 * OPS Trax request-body encryption.
 *
 * Documented scheme (IMPLEMENTING-ENCRYPTION.md, sourced from the portal's
 * own client-side JavaScript — not a secret):
 *   Cipher   AES-128-CBC, PKCS7 padding
 *   Key      first 16 bytes of the bearer token, UTF-8 ("Bearer " stripped)
 *   IV       fixed string "ABH&&%#@HKLU1239"
 *   Body     base64(ciphertext) sent as text/plain
 *
 * WebCrypto's AES-CBC applies PKCS7 padding automatically (spec-mandated),
 * which is exactly the padding OPS Trax expects, so the plaintext is passed
 * straight to subtle.encrypt. Cross-checked against a node:crypto
 * reference in test/encryption.test.ts.
 */
/** Fixed IV from the portal's own JavaScript — documented, not a secret. */
export const OPSTRAX_IV_STRING = "ABH&&%#@HKLU1239";
export const KEY_BYTES = 16;
const CHUNK = 0x8000;

/** Derive the AES-128 key bytes from the raw bearer token. */
export function deriveAesKeyBytes(bearerToken: string): Uint8Array<ArrayBuffer> {
  const raw = bearerToken.replace(/^Bearer\s+/i, "").trim();
  const bytes = new TextEncoder().encode(raw);
  if (bytes.length < KEY_BYTES) {
    throw new Error(
      "OPSTRAX_BEARER_TOKEN is too short: an authorized token of at least 16 bytes (UTF-8) is required for encryption",
    );
  }
  // AES-128 uses exactly the first 16 bytes; any token longer than that is
  // truncated rather than hashed, matching the portal's own implementation.
  return bytes.slice(0, KEY_BYTES);
}

/**
 * Encrypt a JSON request body per the documented scheme.
 * Deterministic: identical key + IV + JSON produce identical ciphertext.
 */
export async function encryptOpstraxRequest(
  json: string,
  bearerToken: string,
): Promise<string> {
  const keyBytes = deriveAesKeyBytes(bearerToken);
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("WebCrypto (crypto.subtle) is not available in this runtime");
  }
  const cryptoKey = await subtle.importKey(
    "raw",
    keyBytes,
    { name: "AES-CBC" },
    false,
    ["encrypt"],
  );
  const iv = new TextEncoder().encode(OPSTRAX_IV_STRING);
  const plaintext = new TextEncoder().encode(json);
  const ciphertext = await subtle.encrypt({ name: "AES-CBC", iv }, cryptoKey, plaintext);
  return toBase64(new Uint8Array(ciphertext));
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}
