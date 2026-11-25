import { corsHeaders, jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { cancelMidtransTransaction, createQrisCharge, extractQrisPayload } from '../_shared/midtrans.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import {
  configuredCatalogPairs,
  SupplierApiError,
  supplierProvider,
  type CatalogPair,
  type SupplierOffer,
} from '../_shared/supplier5sim.ts';

const defaultPairs: CatalogPair[] = [
  { serviceId: 'telegram', serviceName: 'Telegram', countryCode: 'indonesia', countryName: 'Indonesia' },
  { serviceId: 'telegram', serviceName: 'Telegram', countryCode: 'usa', countryName: 'Amerika Serikat' },
  { serviceId: 'whatsapp', serviceName: 'WhatsApp', countryCode: 'indonesia', countryName: 'Indonesia' },
  { serviceId: 'whatsapp', serviceName: 'WhatsApp', countryCode: 'usa', countryName: 'Amerika Serikat' },
];

function isRequest(body: unknown): body is {
  serviceId: string; countryCode: string; pin: string; voucherCode?: string;
} {
  if (!body || typeof body !== 'object') return false;
  const value = body as Record<string, unknown>;
  return typeof value.serviceId === 'string' && value.serviceId.length <= 60
    && typeof value.countryCode === 'string' && value.countryCode.length <= 60
    && typeof value.pin === 'string' && /^[0-9]{6}$/.test(value.pin)
    && (value.voucherCode === undefined || (typeof value.voucherCode === 'string' && value.voucherCode.length <= 40));
}

async function hashIp(request: Request): Promise<string> {
  const ip = request.headers.get('cf-connecting-ip')
    ?? request.headers.get('x-real-ip')
    ?? request.headers.get('x-forwarded-for')?.split(',')[0]?.trim();
  if (!ip) throw new Error('Alamat jaringan tidak dapat diverifikasi.');
  const secret = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!secret) throw new Error('Konfigurasi server belum lengkap.');
  const key = await crypto.subtle.importKey('raw', new TextEncoder().encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const digest = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(ip));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function orderCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
  return `VN${suffix}`;
}

function numericEnv(name: string, fallback: number): number {
  const raw = Deno.env.get(name);
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) throw new Error(`Konfigurasi ${name} tidak valid.`);
  return value;
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflightResponse(request);
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Metode permintaan tidak didukung.' }, 405);

  const admin = supabaseAdmin();
  let createdOrderCode: string | null = null;
  try {
    const body: unknown = await request.json();
    if (!isRequest(body)) return jsonResponse(request, { error: 'Data pesanan tidak valid.' }, 400);

    const { data: permitted, error: limitError } = await admin.rpc('allow_qris_request', { p_ip_hash: await hashIp(request) });
    if (limitError) throw new Error('Pembatasan permintaan tidak dapat diverifikasi.');
    if (permitted !== true) return jsonResponse(request, { error: 'Terlalu banyak permintaan. Silakan coba kembali satu menit lagi.' }, 429);

    const pairs = configuredCatalogPairs();
    const catalog = pairs.length > 0 ? pairs : defaultPairs;
    const pair = catalog.find((item) => item.serviceId === body.serviceId && item.countryCode === body.countryCode);
    if (!pair) return jsonResponse(request, { error: 'Layanan atau negara tidak tersedia.' }, 400);

    const supplier = supplierProvider();
    const offers = await supplier.getOffers([pair]);
    const offer = offers.find((item: SupplierOffer) => item.serviceId === pair.serviceId && item.countryCode === pair.countryCode);
    if (!offer || offer.stock < 1) return jsonResponse(request, { error: 'Stok nomor untuk pilihan ini sedang habis.' }, 409);

    const balance = await supplier.getBalanceIdr();
    const minimumBalance = numericEnv('SUPPLIER_MIN_BALANCE_IDR', 500000);
    if (balance < minimumBalance || balance < offer.supplierCostIdr) {
      return jsonResponse(request, { error: 'Layanan sedang pemeliharaan sementara, silakan coba beberapa saat lagi' }, 503);
    }

    const expiryMinutes = numericEnv('QRIS_EXPIRY_MINUTES', 10);
    const code = orderCode();
    const expiresAt = new Date(Date.now() + expiryMinutes * 60_000).toISOString();
    const { data: order, error: createError } = await admin.rpc('create_secure_order', {
      p_order_code: code,
      p_pin: body.pin,
      p_service_id: pair.serviceId,
      p_service_name: pair.serviceName,
      p_country_code: pair.countryCode,
      p_country_name: pair.countryName,
      p_supplier_cost_idr: offer.supplierCostIdr,
      p_sell_price_idr: offer.sellPriceIdr,
      p_expires_at: expiresAt,
      p_voucher_code: body.voucherCode?.trim() || null,
    });
    if (createError || !order) {
      if (createError?.message.includes('voucher')) return jsonResponse(request, { error: 'Voucher tidak valid atau telah kedaluwarsa.' }, 400);
      throw new Error('Pesanan tidak dapat disimpan.');
    }
    createdOrderCode = code;

    if (order.amount_due_idr === 0) {
      const { data: claimed, error: claimError } = await admin.rpc('claim_supplier_fulfillment', {
        p_order_code: code,
      });
      if (claimError || claimed !== true) throw new Error('Pemrosesan nomor tidak dapat dimulai.');
      try {
        const purchase = await supplier.buy(pair);
        const { data: saved, error: saveError } = await admin.rpc('save_supplier_purchase', {
          p_order_code: code,
          p_supplier_order_id: purchase.id,
          p_phone_number: purchase.phone,
        });
        if (saveError || saved !== true) throw new Error('Nomor belum dapat disimpan.');
      } catch (error) {
        const message = error instanceof Error ? error.message : '';
        const code = error instanceof SupplierApiError ? error.code : '';
        if (/NO_NUMBERS|OUT_OF_STOCK|NO_STOCK|NO_FREE_PHONES|no free phones|no numbers|no_product|NO_PRODUCT/i.test(code)
          || /NO_NUMBERS|OUT_OF_STOCK|NO_STOCK|NO_FREE_PHONES|no free phones|no numbers|no_product|NO_PRODUCT/i.test(message)) {
          const bytes = crypto.getRandomValues(new Uint8Array(16));
          const compensationCode = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
          const { error: voucherError } = await admin.rpc('issue_refund_voucher', {
            p_order_code: code,
            p_voucher_code: compensationCode,
          });
          if (voucherError) throw new Error('Voucher kompensasi tidak dapat diterbitkan.');
          return jsonResponse(request, {
            orderCode: code,
            pin: body.pin,
            amount: 0,
            qrisPayload: null,
            paymentStatus: 'paid',
            fulfillmentStatus: 'refunded',
            voucherCode: compensationCode,
            message: 'Stok nomor habis. Saldo telah dikembalikan dalam bentuk voucher refund baru.',
          }, 201);
        } else {
          console.error('voucher-funded supplier purchase requires retry', error);
          return jsonResponse(request, {
            orderCode: code,
            pin: body.pin,
            amount: 0,
            qrisPayload: null,
            paymentStatus: 'paid',
            message: 'Pesanan tersimpan dan sedang diproses. Simpan kode pesanan serta PIN Anda.',
          }, 202);
        }
      }
      return jsonResponse(request, {
        orderCode: code,
        pin: body.pin,
        amount: 0,
        qrisPayload: null,
        paymentStatus: 'paid',
        message: 'Voucher telah menutup seluruh pembayaran. Pesanan sedang diproses.',
      }, 201);
    }

    const charge = await createQrisCharge({
      orderCode: code,
      amount: Number(order.amount_due_idr),
      itemName: `Nomor virtual ${pair.serviceName}`,
      expiryMinutes,
    });
    let qrisPayload: string;
    try {
      qrisPayload = extractQrisPayload(charge);
      const { data: saved, error: saveError } = await admin.rpc('save_qris_payload', {
        p_order_code: code,
        p_qris_payload: qrisPayload,
        p_transaction_id: charge.transaction_id,
      });
      if (saveError || saved !== true) throw new Error('Data QRIS tidak dapat disimpan.');
    } catch (error) {
      await cancelMidtransTransaction(code).catch((cancelError) => {
        console.error('failed to cancel unpersisted QRIS charge', cancelError);
      });
      throw error;
    }

    return jsonResponse(request, {
      orderCode: code,
      pin: body.pin,
      amount: Number(order.amount_due_idr),
      originalAmount: offer.sellPriceIdr,
      voucherApplied: Number(order.voucher_applied_idr),
      qrisPayload,
      expiresAt: charge.expiry_time ?? expiresAt,
      paymentStatus: 'pending',
    }, 201);
  } catch (error) {
    console.error('create-qris-order failed', error);
    if (createdOrderCode) {
      await cancelMidtransTransaction(createdOrderCode).catch((cancelError) => {
        console.error('failed to cancel incomplete QRIS transaction', cancelError);
      });
      const { error: cancelError } = await admin.rpc('cancel_pending_order', { p_order_code: createdOrderCode });
      if (cancelError) console.error('failed to cancel incomplete order', cancelError);
    }
    return jsonResponse(request, { error: 'Pesanan belum dapat dibuat. Silakan coba kembali.' }, 503);
  }
});
