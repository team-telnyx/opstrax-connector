# Implementing the Opstrax request encryption

The Opstrax dealer API (`https://v3.opstrax.com/api/...`) only accepts **encrypted request bodies**. If you send plain JSON, the server returns `HTTP 500`. Responses are plain JSON, so you only need to encrypt requests and never need to decrypt responses.

This doc covers how to build requests the API accepts. For the endpoint's parameters, status IDs and order types, see `GetOrders.md`.

---

## 1. The algorithm

These values come from the site's own JavaScript (`main.*.js`, which uses CryptoJS).

| | |
|---|---|
| Cipher | **AES-128-CBC** |
| Padding | **PKCS7** (most libraries use it by default) |
| Key | **First 16 characters of the bearer token**, UTF-8 encoded (16 bytes) |
| IV | The fixed string **`ABH&&%#@HKLU1239`**, UTF-8 encoded (16 bytes) |
| Plaintext | The JSON request body, UTF-8 encoded |
| Output | **Base64** of the ciphertext, sent as the raw request body |

Steps:

```
token      = the JWT, without the "Bearer " prefix
key        = utf8(token[0:16])
iv         = utf8("ABH&&%#@HKLU1239")
body       = base64( AES-128-CBC-PKCS7-encrypt(key, iv, utf8(json)) )
```

## 2. The HTTP request

Only these headers are needed. You do not need the cookie, `Origin`, `Referer`, `User-Agent` or any `sec-*` headers.

```
POST https://v3.opstrax.com/api/order/GetOrders
Authorization: Bearer <token>
Content-Type: text/plain        <- required; without it you get 400 "cipherText cannot be null"

<base64 ciphertext>
```

| What you got wrong | What the server returns |
|---|---|
| Missing `Authorization` header | `401` |
| Missing `Content-Type: text/plain` | `400 Value cannot be null. (Parameter 'cipherText')` |
| Body is plain JSON, or encrypted with the wrong key or IV | `500 An internal server error occurred` |

## 3. Reference implementations

### Node.js (18+, no extra packages)

```js
const crypto = require("crypto");

const IV = Buffer.from("ABH&&%#@HKLU1239", "utf8");

function encryptBody(obj, token) {
  const key = Buffer.from(token.slice(0, 16), "utf8");
  const cipher = crypto.createCipheriv("aes-128-cbc", key, IV); // PKCS7 by default
  const json = typeof obj === "string" ? obj : JSON.stringify(obj);
  return Buffer.concat([cipher.update(json, "utf8"), cipher.final()]).toString("base64");
}

function decryptBody(b64, token) { // for inspecting captured traffic
  const key = Buffer.from(token.slice(0, 16), "utf8");
  const d = crypto.createDecipheriv("aes-128-cbc", key, IV);
  return Buffer.concat([d.update(Buffer.from(b64, "base64")), d.final()]).toString("utf8");
}

async function opstraxPost(path, body, token) {
  const res = await fetch(`https://v3.opstrax.com/api/${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "text/plain" },
    body: encryptBody(body, token),
  });
  if (!res.ok) throw new Error(`Opstrax ${res.status}: ${await res.text()}`);
  return res.json();
}

// Example
const token = process.env.APIKEY.replace(/^Bearer\s+/, "").trim();
opstraxPost("order/GetOrders", {
  pageSize: 25, pageNumber: 1,
  from: "11/01/2026", to: "11/11/2026",          // MM/DD/YYYY
  statusId: "0,1,2,3,4,5,6,7,9,10,11",           // all statuses
  orderTypes: "1,3,5,4,0",                       // all order types
  searchText: "602173j",
  orderby: "-request_date",
  dealerMakeType: null, dealers: "", isContainBackorders: 0,
  encrypted: true,
}, token).then(r => console.log(r.totalRecords, r.results[0]?.invoiceNumber));
```

### Python (`pip install cryptography`)

```python
import base64, json, requests
from cryptography.hazmat.primitives import padding
from cryptography.hazmat.primitives.ciphers import Cipher, algorithms, modes

IV = b"ABH&&%#@HKLU1239"

def encrypt_body(obj, token: str) -> str:
    key = token[:16].encode()
    data = (obj if isinstance(obj, str) else json.dumps(obj)).encode()
    padder = padding.PKCS7(128).padder()
    data = padder.update(data) + padder.finalize()
    enc = Cipher(algorithms.AES(key), modes.CBC(IV)).encryptor()
    return base64.b64encode(enc.update(data) + enc.finalize()).decode()

def opstrax_post(path, body, token):
    r = requests.post(
        f"https://v3.opstrax.com/api/{path}",
        data=encrypt_body(body, token),
        headers={"Authorization": f"Bearer {token}", "Content-Type": "text/plain"},
        timeout=60,
    )
    r.raise_for_status()
    return r.json()
```

There is also a dependency-free version in this folder, `opstrax.py`, that uses the system `openssl` instead.

## 4. Verify your implementation

The IV is fixed, so **encryption is deterministic**: the same token and the same JSON always produce the same ciphertext. That gives you an exact test.

1. Log into the dealer site. In Chrome DevTools, open the Network tab and find a `GetOrders` request.
2. Copy the request payload (the base64) and the `Authorization` token.
3. Decrypt the payload with your code. You should get readable JSON.
4. Re-encrypt that JSON string exactly as decrypted. The result must be **byte-for-byte identical** to the captured payload.
5. Send it. You should get `200` and the same results the site shows.

If step 4 doesn't match, re-encrypt the decrypted string itself rather than a re-serialized object, because the key order and spacing in the JSON matter. If step 3 fails, the key is wrong. The usual cause is that the `Bearer ` prefix was left on the token.

## 5. Gotchas

- **Strip `Bearer `** before you take the first 16 characters. Otherwise the key becomes `"Bearer eyJhbGci"`, which is wrong.
- **The key changes with the token.** Don't cache the key. Derive it from the current token on every request. When the token expires (401), you have to log in again. Logging in isn't automated yet, so for now you copy a fresh token from the browser.
- CryptoJS's `keySize: 16` option in the site's source is misleading. The key length comes from the 16-byte key, so the cipher is AES-**128**, not AES-256.
- The `"encrypted": true` field inside the JSON is just part of the payload. Setting it to `false` does **not** let you send plain JSON.
- **Never log the token or the derived key.** The token is a full login credential.
- Responses contain customer contact details (names, emails, phone numbers). Decide what your agent is allowed to store or log.
- This is not an official API. If Opstrax changes their front-end bundle, the IV or the scheme could change. If requests start returning 500 again, search the new `main.*.js` for `AES.encrypt` to find the current values.
