/**
 * Runtime self-checks for the deployed Edge environment.
 *
 * `verifyWebCryptoAesCbc` exercises the PRODUCTION encrypt path
 * (encryptOpstraxRequest) and decrypts the result with WebCrypto, proving
 * the deployed runtime supports AES-128-CBC with PKCS7 before any live OPS
 * Trax call is attempted. Uses a fixed non-secret self-check key — never a
 * real credential.
 */
import { deriveAesKeyBytes, encryptOpstraxRequest, OPSTRAX_IV_STRING } from "./encryption.ts";

/** Fixed 16-byte self-check key — NOT a credential, never provisioned. */
const SELF_CHECK_TOKEN = "self-check-key-0";
const SELF_CHECK_JSON = JSON.stringify({
  pageSize: 25,
  searchText: "self-check",
  encrypted: true,
});

export interface CryptoCheck {
  ok: boolean;
  detail: string;
}

export async function verifyWebCryptoAesCbc(): Promise<CryptoCheck> {
  try {
    const ciphertext = await encryptOpstraxRequest(SELF_CHECK_JSON, SELF_CHECK_TOKEN);
    const plaintext = await decryptAesCbcBase64(ciphertext, SELF_CHECK_TOKEN);
    if (plaintext !== SELF_CHECK_JSON) {
      return {
        ok: false,
        detail: "AES-CBC round-trip mismatch: decrypted plaintext differs from input",
      };
    }
    return {
      ok: true,
      detail: "AES-128-CBC encrypt/decrypt round-trip via the production encrypt path succeeded",
    };
  } catch (error) {
    return { ok: false, detail: `WebCrypto AES-CBC check failed: ${messageOf(error)}` };
  }
}

/** Decrypt base64 ciphertext produced by the documented OPS Trax scheme. */
async function decryptAesCbcBase64(ciphertext: string, token: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("crypto.subtle is not available in this runtime");
  }
  const key = await subtle.importKey(
    "raw",
    deriveAesKeyBytes(token),
    { name: "AES-CBC" },
    false,
    ["decrypt"],
  );
  const iv = new TextEncoder().encode(OPSTRAX_IV_STRING);
  const raw = Uint8Array.from(atob(ciphertext), (char) => char.charCodeAt(0));
  const plaintext = await subtle.decrypt({ name: "AES-CBC", iv }, key, raw);
  return new TextDecoder().decode(plaintext);
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
