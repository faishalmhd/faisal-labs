export interface CatalogOffer {
  serviceId: string;
  serviceName: string;
  countryCode: string;
  countryName: string;
  stock: number;
  sellPriceIdr: number;
}

export interface CreatedOrder {
  orderCode: string;
  pin: string;
  amount: number;
  originalAmount?: number;
  voucherApplied?: number;
  qrisPayload: string | null;
  expiresAt?: string;
  paymentStatus: 'pending' | 'paid';
  fulfillmentStatus?: 'waiting_payment' | 'processing' | 'completed' | 'refunded' | 'failed';
  voucherCode?: string;
  message?: string;
}

export interface SecureOrder {
  order_code: string;
  service_name: string;
  country_name: string;
  sell_price_idr: number;
  amount_due_idr: number;
  payment_status: 'pending' | 'paid' | 'expired' | 'cancelled';
  fulfillment_status: 'waiting_payment' | 'processing' | 'completed' | 'refunded' | 'failed';
  phone_number: string | null;
  otp_code: string | null;
  qris_payload: string | null;
  voucher_code: string | null;
  voucher_amount_idr: number | null;
  expires_at: string;
  supplier_order_id?: number | null;
  service_id?: string;
  country_code?: string;
  midtrans_transaction_id?: string | null;
}

export interface AdminOrder {
  order_code: string;
  service_name: string;
  country_name: string;
  sell_price_idr: number;
  amount_due_idr: number;
  payment_status: string;
  fulfillment_status: string;
  fulfillment_claimed_at: string | null;
  phone_number: string | null;
  otp_code: string | null;
  created_at: string;
}

export interface AdminFinancialSummary {
  gross_payments_idr: number;
  qris_mdr_idr: number;
  supplier_cost_idr: number;
  net_profit_idr: number;
}
