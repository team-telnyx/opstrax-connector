# Opstrax `GetOrders`: request and response

## Endpoint

```
POST https://v3.opstrax.com/api/order/GetOrders
Authorization: Bearer <token>
Content-Type: text/plain
Body: base64(AES-128-CBC(JSON))
```

The site encrypts the request body in the browser before sending it:

| | |
|---|---|
| Cipher | AES-128-CBC, PKCS7 padding |
| Key | First 16 characters of the bearer token |
| IV | Hardcoded string `ABH&&%#@HKLU1239` from the site's JavaScript |
| Encoding | Base64, sent as `text/plain` |

The response is not encrypted. It comes back as plain JSON.

## Request parameters (before encryption)

```json
{
  "pageSize": 25,
  "pageNumber": 1,
  "from": "11/03/2026",
  "to": "11/10/2026",
  "statusId": "2,3,4,5,6,7,11",
  "orderTypes": "1,3,5,4,0",
  "searchText": "602173j",
  "orderby": "-request_date",
  "dealerMakeType": null,
  "dealers": "",
  "isContainBackorders": 0,
  "encrypted": true
}
```

| Param | Meaning |
|---|---|
| `searchText` | The invoice, RO or other search term. Case-insensitive. |
| `from` / `to` | Request date range, in `MM/DD/YYYY` format |
| `statusId` | Comma-separated status IDs to include. See [Status IDs](#status-ids-statusid). |
| `orderTypes` | Comma-separated order types to include. See [Order types](#order-types-ordertypes). |
| `pageSize` / `pageNumber` | Paging |
| `orderby` | Sort field. A leading `-` sorts descending. |
| `encrypted` | Always `true` |

## Status IDs (`statusId`)

From the site's order status enum and the labels on its filter dropdown.

| ID | Enum name | UI label |
|---|---|---|
| 0 | AwaitingResponse | Awaiting Response |
| 1 | Viewed | Viewed |
| 2 | Complete | Complete |
| 3 | Partial | Partial |
| 4 | Unavailable | Unavailable |
| 5 | Expired | Expired |
| 6 | Cancelled | Cancelled |
| 7 | MarkAsReceived | Mark as received |
| 9 | BuyerReview | Buyer Review (only shown when PartsTrader is enabled) |
| 10 | OrderProcessed | (no dropdown label) |
| 11 | CanceledByAutoforwardNoResponse | (no dropdown label) |

ID 8 is not used.

The site's three order tabs send these preset lists:

| Tab | `statusId` |
|---|---|
| UNFILLED | `0,1,9,10` |
| FILLED | `2,3,4,5,6,7,11`. This is the list in the request captured above. |
| ALL | `0,1,2,3,4,5,6,7,9,10,11` |

## Order types (`orderTypes`)

| ID | Name |
|---|---|
| 0 | Manual |
| 1 | Collision |
| 3 | Mechanical |
| 4 | Glass |
| 5 | Tires |

IDs 2 and 6+ are not used. Every tab sends all five types as `1,3,5,4,0`. The UI's "all" option is `-1`.

## Response (trimmed, contact details redacted)

```json
{
  "results": [
    {
      "requestId": 90145102,
      "invoiceNumber": "602173J",
      "roNumber": "1420321294",
      "poNumber": null,
      "vehicleModel": "Silverado 1500 RST Crew Cab 147\" WB 4WD",
      "vMakecode": "CHEV",
      "shopName": "Gerber - Bloomington",
      "shopId": 16041,
      "shopContact": "<redacted>",
      "shopContactEmail": "<redacted>",
      "shopContactPhoneNumber": "<redacted>",
      "dealerContact": "<redacted>",
      "requestDate": "2026-11-10T14:01:00.997",
      "responseDate": "2026-11-10T14:34:58.787",
      "billedDate": "2026-11-10T00:00:00",
      "receivedDate": "2026-11-10T14:36:56.42",
      "deliveryDate": "2026-11-11T00:00:00",
      "status": 2,
      "statusName": "Complete",
      "requestTypeName": "Order",
      "orderQty": 1,
      "invoiceQty": 1,
      "receivedQty": 0,
      "isFilled": true,
      "isPartial": false,
      "unavailableParts": 0,
      "isReceived": false,
      "orderNotes": "",
      "emsId": 85202375
    }
  ],
  "totalRecords": 1,
  "totalUnfilledRecords": 0
}
```

Each result has about 85 fields. The ones above are the most useful. The rest are mostly discrepancy, return, alert and integration flags, and most are `null` for a normal order.

## Notes

- The encryption key comes from the login token, so the request must be re-encrypted whenever the token changes or expires.
- This is not an official API, so it could break if Opstrax changes their site.
- Reference client: `opstrax.py`
  ```bash
  python3 opstrax.py search 602173j                    # all statuses, last 30 days
  python3 opstrax.py search 602173j --tab filled       # unfilled | filled | all
  python3 opstrax.py search "" --status 0,1 --types 1  # explicit status/type IDs
  python3 opstrax.py decrypt '<captured base64>'       # decode a DevTools payload
  ```
