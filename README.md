
# Hawk Auto Group — OPS Trax Voice AI Agent Connector

## Objective

Integrate Telnyx Voice AI with OPS Trax to automate order and delivery status inquiries from collision repair shops, reducing inbound calls, manual workload, and operational costs.

## Requirements

| Requirement | Description |
|---|---|
| **Voice AI Agent** | Answer incoming calls from collision repair shops requesting parts delivery updates. |
| **Phone Menu Integration** | Route callers pressing 7 on Hawk Auto Group's existing Avaya phone system to the AI assistant. |
| **Order Lookup** | Identify parts orders using invoice numbers or RO (Repair Order) numbers. |
| **Order Status Retrieval** | Retrieve and communicate order fulfillment status. |
| **Delivery Tracking** | Provide delivery status, route information, and delivery location when available. |
| **OPS Trax Integration** | Connect to OPS Trax to retrieve order, delivery tracking, and routing information. |
| **CDK Integration** | Potential future integration to resolve invoice/quote numbers and corresponding orders. |
| **Automated Responses** | Verbally communicate retrieved information without requiring employee intervention. |

## Capability Goals

1. **Order Lookup & Status:** Retrieve order details using an RO number or invoice number.
2. **Delivery Status & Proof of Delivery:** Retrieve delivery status and proof of delivery when available.
3. **Delivery Route & Location:** Retrieve delivery route, stop, and location information when available.

## Current Implementation Status

| Component | Status |
|---|---|
| **Order Lookup & Status** | ✅ Completed — supports live OPS Trax queries by invoice or RO number. |
| **Delivery Status & Proof of Delivery** | ⚠️ Blocked — upstream API returns HTTP 504 Gateway Timeout. |

### Live AI Agent

- **Phone Number:** +1 (708) 384-7796
- **HD Voice:** Enabled
- **Order Lookup:** Retrieves real-time order status and expected delivery dates directly from OPS Trax.
- **Supported Statuses:** Complete, Viewed, Partial, Unavailable, and other statuses returned by OPS Trax.
- **Multiple Orders:** Supports multiple invoices associated with the same RO number.
- **Conversational Experience:** Handles follow-up inquiries and automatically ends calls when the caller is finished.

### Integration Architecture

```text
Collision Repair Shop
        |
        v
Telnyx Voice AI Agent
        |
        v
Telnyx Edge Function
        |
        v
OPS Trax API
        |
        v
Live Order Data
        |
        v
AI Agent Communicates Order Status
```


