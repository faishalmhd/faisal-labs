import { isDemoMode, supabase } from './supabaseClient';
import type { AdminFinancialSummary, AdminOrder, CatalogOffer, CreatedOrder, SecureOrder } from '../types';

export { isDemoMode };

const demoCatalog: CatalogOffer[] = [
  { serviceId: 'telegram', serviceName: 'Telegram', countryCode: 'indonesia', countryName: 'Indonesia', stock: 45, sellPriceIdr: 3500 },
  { serviceId: 'telegram', serviceName: 'Telegram', countryCode: 'usa', countryName: 'Amerika Serikat', stock: 20, sellPriceIdr: 4200 },
  { serviceId: 'whatsapp', serviceName: 'WhatsApp', countryCode: 'indonesia', countryName: 'Indonesia', stock: 32, sellPriceIdr: 5000 },
  { serviceId: 'whatsapp', serviceName: 'WhatsApp', countryCode: 'usa', countryName: 'Amerika Serikat', stock: 15, sellPriceIdr: 6500 },
  { serviceId: 'google', serviceName: 'Google / Gmail', countryCode: 'indonesia', countryName: 'Indonesia', stock: 50, sellPriceIdr: 4000 },
  { serviceId: 'tiktok', serviceName: 'TikTok', countryCode: 'indonesia', countryName: 'Indonesia', stock: 28, sellPriceIdr: 3000 },
];

const DEMO_STORE_KEY = 'demo_orders_store';

function getDemoStore(): Record<string, { order: SecureOrder; pin: string }> {
  try {
    const raw = sessionStorage.getItem(DEMO_STORE_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch {
    return {};
  }
}

function saveDemoStore(store: Record<string, { order: SecureOrder; pin: string }>) {
  try {
    sessionStorage.setItem(DEMO_STORE_KEY, JSON.stringify(store));
  } catch {}
}

async function invoke<T>(name: string, options?: {
  body?: Record<string, unknown>;
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
}): Promise<T> {
  const { data, error } = await supabase.functions.invoke<T>(name, options);
  if (error) {
    const context = error.context;
    if (context instanceof Response) {
      const payload = await context.clone().json().catch(() => null);
      if (typeof payload?.error === 'string') throw new Error(payload.error);
    }
    throw new Error(error.message || 'Permintaan belum dapat diproses.');
  }
  if (!data) throw new Error('Server tidak mengembalikan data.');
  return data;
}

export async function fetchCatalog(): Promise<CatalogOffer[]> {
  if (isDemoMode) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    return demoCatalog;
  }
  const result = await invoke<{ offers: CatalogOffer[] }>('get-catalog', { method: 'GET' });
  return result.offers;
}

export async function createOrder(input: {
  serviceId: string;
  countryCode: string;
  pin: string;
  voucherCode?: string;
}): Promise<CreatedOrder> {
  if (isDemoMode) {
    await new Promise((resolve) => setTimeout(resolve, 300));
    const offer = demoCatalog.find((item) => item.serviceId === input.serviceId && item.countryCode === input.countryCode);
    if (!offer) throw new Error('Layanan tidak ditemukan.');
    const code = `VNDEMO${Array.from(crypto.getRandomValues(new Uint8Array(10)), (b) => b.toString(16).padStart(2, '0')).join('').toUpperCase()}`;
    const expiresAt = new Date(Date.now() + 10 * 60_000).toISOString();
    const hasVoucher = input.voucherCode?.trim().toUpperCase() === 'DEMO100' || input.voucherCode?.trim().toUpperCase() === 'GRATIS';
    const amountDue = hasVoucher ? 0 : offer.sellPriceIdr;
    const voucherApplied = hasVoucher ? offer.sellPriceIdr : 0;

    const secureOrder: SecureOrder = {
      order_code: code,
      service_name: offer.serviceName,
      country_name: offer.countryName,
      sell_price_idr: offer.sellPriceIdr,
      amount_due_idr: amountDue,
      payment_status: amountDue === 0 ? 'paid' : 'pending',
      fulfillment_status: amountDue === 0 ? 'processing' : 'waiting_payment',
      phone_number: amountDue === 0 ? '+6281234567890' : null,
      otp_code: null,
      qris_payload: amountDue === 0 ? null : `00020101021226540014ID.LINKAJA.WWW011893600911002234567802150000000000000005204581253033605802ID5919VIRTUAL NUMBER DEMO6007JAKARTA61051234062070703A0163041234#${code}`,
      voucher_code: null,
      voucher_amount_idr: null,
      expires_at: expiresAt,
      service_id: offer.serviceId,
      country_code: offer.countryCode,
    };

    const store = getDemoStore();
    store[code] = { order: secureOrder, pin: input.pin };
    saveDemoStore(store);

    return {
      orderCode: code,
      pin: input.pin,
      amount: amountDue,
      originalAmount: offer.sellPriceIdr,
      voucherApplied,
      qrisPayload: secureOrder.qris_payload,
      expiresAt,
      paymentStatus: secureOrder.payment_status === 'paid' ? 'paid' : 'pending',
      fulfillmentStatus: secureOrder.fulfillment_status,
      message: amountDue === 0 ? 'Voucher telah menutup seluruh pembayaran. Pesanan sedang diproses.' : undefined,
    };
  }
  return invoke<CreatedOrder>('create-qris-order', { body: input });
}

export async function getOrder(orderCode: string, pin: string): Promise<{ order: SecureOrder }> {
  if (isDemoMode) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const store = getDemoStore();
    const entry = store[orderCode];
    if (!entry || entry.pin !== pin) {
      throw new Error('Pesanan tidak ditemukan. Periksa kembali kode dan PIN.');
    }
    if (entry.order.payment_status === 'paid' && !entry.order.otp_code) {
      if (!entry.order.phone_number) {
        entry.order.phone_number = '+6281234567890';
        entry.order.fulfillment_status = 'processing';
      } else {
        entry.order.otp_code = '849-203';
        entry.order.fulfillment_status = 'completed';
      }
      saveDemoStore(store);
    }
    return { order: { ...entry.order } };
  }
  return invoke<{ order: SecureOrder }>('sync-otp', { body: { orderCode, pin } });
}

export async function simulatePayment(orderCode: string): Promise<void> {
  if (!isDemoMode) return;
  const store = getDemoStore();
  const entry = store[orderCode];
  if (entry) {
    entry.order.payment_status = 'paid';
    entry.order.fulfillment_status = 'processing';
    entry.order.phone_number = '+6281234567890';
    saveDemoStore(store);
  }
}

export async function cancelOrder(orderCode: string, pin: string): Promise<{ cancelled: boolean }> {
  if (isDemoMode) {
    const store = getDemoStore();
    const entry = store[orderCode];
    if (entry && entry.pin === pin) {
      entry.order.payment_status = 'cancelled';
      entry.order.fulfillment_status = 'failed';
      saveDemoStore(store);
      return { cancelled: true };
    }
    throw new Error('Pesanan tidak ditemukan.');
  }
  return invoke<{ cancelled: boolean }>('cancel-order', { body: { orderCode, pin } });
}

export async function fetchAdminOrders(): Promise<{ orders: AdminOrder[]; summary: AdminFinancialSummary }> {
  if (isDemoMode) {
    await new Promise((resolve) => setTimeout(resolve, 200));
    const store = getDemoStore();
    const mockOrders: AdminOrder[] = Object.values(store).map(({ order }) => ({
      order_code: order.order_code,
      service_name: order.service_name,
      country_name: order.country_name,
      sell_price_idr: order.sell_price_idr,
      amount_due_idr: order.amount_due_idr,
      payment_status: order.payment_status,
      fulfillment_status: order.fulfillment_status,
      fulfillment_claimed_at: order.payment_status === 'paid' ? new Date().toISOString() : null,
      phone_number: order.phone_number,
      otp_code: order.otp_code,
      created_at: new Date().toISOString(),
    }));

    if (mockOrders.length === 0) {
      mockOrders.push({
        order_code: 'VNDEMO998877665544332211',
        service_name: 'Telegram',
        country_name: 'Indonesia',
        sell_price_idr: 3500,
        amount_due_idr: 3500,
        payment_status: 'paid',
        fulfillment_status: 'completed',
        fulfillment_claimed_at: new Date().toISOString(),
        phone_number: '+6281234567890',
        otp_code: '482-192',
        created_at: new Date(Date.now() - 3600_000).toISOString(),
      });
    }

    return {
      orders: mockOrders,
      summary: {
        gross_payments_idr: 35000,
        qris_mdr_idr: 245,
        supplier_cost_idr: 20000,
        net_profit_idr: 14755,
      },
    };
  }
  return invoke<{ orders: AdminOrder[]; summary: AdminFinancialSummary }>('admin-api', { method: 'GET' });
}

export async function cancelAdminOrder(orderCode: string): Promise<{ cancelled: boolean }> {
  if (isDemoMode) {
    const store = getDemoStore();
    if (store[orderCode]) {
      store[orderCode].order.payment_status = 'cancelled';
      store[orderCode].order.fulfillment_status = 'failed';
      saveDemoStore(store);
      return { cancelled: true };
    }
    throw new Error('Pesanan demo tidak ditemukan atau sudah tidak aktif.');
  }
  return invoke<{ cancelled: boolean }>('admin-api', { body: { action: 'cancel', orderCode } });
}

export async function issueAdminVoucher(orderCode: string): Promise<{ issued: boolean }> {
  if (isDemoMode) {
    const store = getDemoStore();
    if (store[orderCode]) {
      store[orderCode].order.fulfillment_status = 'refunded';
      store[orderCode].order.voucher_code = 'VOUCHER-REFUND-DEMO';
      saveDemoStore(store);
      return { issued: true };
    }
    throw new Error('Pesanan demo tidak ditemukan.');
  }
  return invoke<{ issued: boolean }>('admin-api', { body: { action: 'issue-voucher', orderCode } });
}
