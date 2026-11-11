/** Shared value types for the OPS Trax invoice lookup connector. */

/** Fields confirmed present in the OPS Trax GetOrders response (GetOrders.md + verified captures). */
export interface OpstraxOrderRow {
  requestId?: unknown;
  invoiceNumber?: unknown;
  roNumber?: unknown;
  status?: unknown;
  statusName?: unknown;
  isFilled?: unknown;
  isPartial?: unknown;
  orderQty?: unknown;
  invoiceQty?: unknown;
  deliveryDate?: unknown;
  partialDate?: unknown;
  shippedDate?: unknown;
  arrivedDate?: unknown;
  receivedDate?: unknown;
  isReceived?: unknown;
  unavailableCount?: unknown;
  shopName?: unknown;
  shopId?: unknown;
  vehicleModel?: unknown;
  vMakecode?: unknown;
}

/** A query for the OPS Trax GetOrders endpoint. */
export interface GetOrdersRequest {
  invoiceNumber: string;
}

/** Normalized order record exposed to the AI agent. */
export interface AgentOrder {
  invoice_number: string | null;
  ro_number: string | null;
  request_id: string | null;
  status_name: string | null;
  is_filled: boolean | null;
  is_partial: boolean | null;
  order_qty: number | null;
  invoice_qty: number | null;
  delivery_date: string | null;
  partial_date: string | null;
  unavailable_count: number | null;
  is_received: boolean | null;
  shop_name: string | null;
  vehicle_model: string | null;
}

/** Outcome of a lookup, shaped for the voice agent. */
export type LookupOutcome =
  | {
      status: "found";
      /** Primary (first) match — kept for compatibility with single-match callers. */
      order: AgentOrder;
      /** ALL exact matches, in upstream order. Same as [order] when one match. */
      orders: AgentOrder[];
      matched_count: number;
      agent_message: string;
    }
  | { status: "not_found"; agent_message: string }
  | { status: "invalid_request"; agent_message: string }
  | { status: "unauthorized"; agent_message: string }
  | { status: "upstream_error"; agent_message: string }
  | { status: "not_configured"; agent_message: string };

/** Classification of an OPS Trax call failure. */
export type FailureKind =
  | "auth_failure"
  | "not_found"
  | "api_error"
  | "network_error"
  | "unmapped_response";
