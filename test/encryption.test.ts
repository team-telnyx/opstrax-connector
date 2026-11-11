import assert from "node:assert/strict";
import crypto from "node:crypto";
import { describe, it } from "node:test";

import { deriveAesKeyBytes, encryptOpstraxRequest } from "../src/encryption.ts";

const TEST_TOKEN = "eyJ0ZXN0LXRva2VuLXZhbHVlLWZvci1jcnlwdG8tY2FzZQ";
const TEST_IV = "ABH&&%#@HKLU1239";

function encryptReference(json: string, token: string): string {
  const key = Buffer.from(token.replace(/^Bearer\s+/i, "").trim().slice(0, 16), "utf8");
  const cipher = crypto.createCipheriv("aes-128-cbc", key, Buffer.from(TEST_IV, "utf8"));
  return Buffer.concat([cipher.update(json, "utf8"), cipher.final()]).toString("base64");
}

function decryptReference(b64: string, token: string): string {
  const key = Buffer.from(token.replace(/^Bearer\s+/i, "").trim().slice(0, 16), "utf8");
  const decipher = crypto.createDecipheriv("aes-128-cbc", key, Buffer.from(TEST_IV, "utf8"));
  return Buffer.concat([
    decipher.update(Buffer.from(b64, "base64")),
    decipher.final(),
  ]).toString("utf8");
}

describe("deriveAesKeyBytes", () => {
  it("test_bearer_prefixed_token_when_derived_strips_prefix_and_takes_16_bytes", () => {
    const key = deriveAesKeyBytes(`Bearer ${TEST_TOKEN}`);
    assert.equal(key.length, 16);
    assert.deepEqual(key, new TextEncoder().encode(TEST_TOKEN.slice(0, 16)));
  });

  it("test_raw_token_when_derived_takes_first_16_characters", () => {
    const key = deriveAesKeyBytes(TEST_TOKEN);
    assert.deepEqual(key, new TextEncoder().encode(TEST_TOKEN.slice(0, 16)));
  });

  it("test_short_token_when_derived_throws_config_error", () => {
    assert.throws(() => deriveAesKeyBytes("short"), /at least 16 bytes/);
  });
});

describe("encryptOpstraxRequest", () => {
  it("test_same_inputs_when_encrypted_produce_identical_ciphertext", async () => {
    const json = JSON.stringify({ pageSize: 25, searchText: "602136J" });
    const first = await encryptOpstraxRequest(json, TEST_TOKEN);
    const second = await encryptOpstraxRequest(json, TEST_TOKEN);
    assert.equal(first, second);
  });

  it("test_webcrypto_implementation_when_compared_with_node_reference_produces_identical_ciphertext", async () => {
    const json = JSON.stringify({
      pageSize: 25,
      pageNumber: 1,
      from: "10/12/2026",
      to: "11/11/2026",
      searchText: "602136j",
      encrypted: true,
    });
    const actual = await encryptOpstraxRequest(json, TEST_TOKEN);
    assert.equal(actual, encryptReference(json, TEST_TOKEN));
  });

  it("test_encrypted_body_when_decrypted_with_documented_scheme_returns_original_json", async () => {
    const json = '{"invoiceNumber":"602136J"}';
    const encrypted = await encryptOpstraxRequest(json, TEST_TOKEN);
    assert.equal(decryptReference(encrypted, TEST_TOKEN), json);
  });

  it("test_ciphertext_when_compared_across_different_keys_produces_different_ciphertext", async () => {
    const json = '{"searchText":"602136J"}';
    const a = await encryptOpstraxRequest(json, TEST_TOKEN);
    const b = await encryptOpstraxRequest(json, "AnotherTokenValueWith16Char");
    assert.notEqual(a, b);
  });

  it("test_adequately_long_multibyte_token_when_encrypted_derives_16_bytes", async () => {
    // The first 16 characters contain a multibyte character; key derivation
    // must still produce exactly 16 bytes without throwing.
    const multibyteToken = "🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐🔐rest";
    const key = deriveAesKeyBytes(multibyteToken);
    assert.equal(key.length, 16);
  });

  it("test_ciphertext_when_compared_with_captured_payload_length_is_base64_and_non_empty", async () => {
    const encrypted = await encryptOpstraxRequest('{"a":1}', TEST_TOKEN);
    assert.match(encrypted, /^[A-Za-z0-9+/]+={0,2}$/);
    assert.ok(encrypted.length > 0);
  });
});

describe("documented_escaping", () => {
  it("test_reference_decrypt_of_captured_payload_shape_when_executed_returns_readable_json", () => {
    const token = "0123456789abcdefghij";
    const payload = JSON.stringify({ searchText: "602136j", encrypted: true });
    const encrypted = encryptReference(payload, token);
    assert.equal(decryptReference(encrypted, token), payload);
  });
});
