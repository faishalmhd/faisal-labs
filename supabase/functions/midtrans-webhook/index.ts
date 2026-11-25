import { jsonResponse } from '../_shared/cors.ts';
import { verifyMidtransSignature } from '../_shared/midtrans.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { configuredCatalogPairs, SupplierApiError, supplierProvider } from '../_shared/supplier5sim.ts';

interface MidtransNotification {
  transaction_id: string;
  transaction_status: string;
  status_code: string;
  payment_type: string;
  order_id: string;
  gross_amount: string;
  signature_key: string;
}

function validNotification(value: unknown): value is MidtransNotification {
  if (!value || typeof value !== 'object') return false;
  const data = value as Record<string, unknown>;
  return ['transaction_id', 'transaction_status', 'status_code', 'payment_type', 'order_id', 'gross_amount', 'signature_key']
    .every((key) => typeof data[key] === 'string' && (data[key] as string).length > 0);
}

function voucherCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

Deno.serve(async (request) => {
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Metode permintaan tidak didukung.' }, 405);
  try {
    const notification: unknown = await request.json();
    if (!validNotification(notification)) return jsonResponse(request, { error: 'Notifikasi tidak valid.' }, 400);
    if (notification.payment_type !== 'qris') {
      return jsonResponse(request, { error: 'Metode pembayaran tidak diizinkan.' }, 422);
    }
    const signatureValid = await verifyMidtransSignature(
      notification.order_id,
      notification.status_code,
      notification.gross_amount,
      notification.signature_key,
    );
    if (!signatureValid) return jsonResponse(request, { error: 'Tanda tangan tidak valid.' }, 401);

    const admin = supabaseAdmin();
    const { data: result, error: rpcError } = await admin.rpc('process_midtrans_event', {
      p_transaction_id: notification.transaction_id,
      p_transaction_status: notification.transaction_status,
      p_status_code: notification.status_code,
      p_order_code: notification.order_id,
      p_gross_amount: notification.gross_amount,
    });
    if (rpcError) throw new Error('Notifikasi pembayaran tidak dapat diproses.');
    if (result?.result === 'amount_mismatch') return jsonResponse(request, { error: 'Nilai pembayaran tidak sesuai.' }, 422);
    if (result?.result === 'not_found') return jsonResponse(request, { error: 'Pesanan tidak ditemukan.' }, 404);
    if (!['fulfill', 'duplicate', 'already_paid'].includes(result?.result)) {
      return jsonResponse(request, { received: true, result: result?.result ?? 'ignored' });
    }

    const { data: order, error: orderError } = await admin.from('orders')
      .select('order_code, service_id, service_name, country_code, country_name, supplier_cost_idr, payment_status, fulfillment_status, supplier_order_id')
      .eq('order_code', notification.order_id)
      .maybeSingle();
    if (orderError || !order) throw new Error('Data pesanan tidak dapat dibaca.');
    if (order.payment_status !== 'paid' || order.fulfillment_status !== 'processing' || order.supplier_order_id) {
      return jsonResponse(request, { received: true, result: result.result });
    }
    const { data: claimed, error: claimError } = await admin.rpc('claim_supplier_fulfillment', {
      p_order_code: order.order_code,
    });
    if (claimError) throw new Error('Pemrosesan nomor tidak dapat diklaim.');
    if (claimed !== true) return jsonResponse(request, { received: true, result: 'fulfillment_in_progress' });

    const configured = configuredCatalogPairs();
    const catalog = configured.length > 0 ? configured : [
      { serviceId: 'telegram', serviceName: 'Telegram', countryCode: 'indonesia', countryName: 'Indonesia' },
      { serviceId: 'telegram', serviceName: 'Telegram', countryCode: 'usa', countryName: 'Amerika Serikat' },
      { serviceId: 'whatsapp', serviceName: 'WhatsApp', countryCode: 'indonesia', countryName: 'Indonesia' },
      { serviceId: 'whatsapp', serviceName: 'WhatsApp', countryCode: 'usa', countryName: 'Amerika Serikat' },
    ];
    const pair = catalog.find((item) => item.serviceId === order.service_id && item.countryCode === order.country_code);
    if (!pair) throw new Error('Konfigurasi produk pesanan tidak tersedia.');

    try {
      const purchase = await supplierProvider().buy(pair);
      const { data: saved, error: saveError } = await admin.rpc('save_supplier_purchase', {
        p_order_code: order.order_code,
        p_supplier_order_id: purchase.id,
        p_phone_number: purchase.phone,
      });
      if (saveError || saved !== true) throw new Error('Nomor supplier belum dapat disimpan; perlu rekonsiliasi admin.');
    } catch (error) {
      const message = error instanceof Error ? error.message : '';
      const code = error instanceof SupplierApiError ? error.code : '';
      if (/NO_NUMBERS|OUT_OF_STOCK|NO_STOCK|NO_FREE_PHONES|no free phones|no numbers|no_product|NO_PRODUCT/i.test(code)
        || /NO_NUMBERS|OUT_OF_STOCK|NO_STOCK|NO_FREE_PHONES|no free phones|no numbers|no_product|NO_PRODUCT/i.test(message)) {
        const { error: voucherError } = await admin.rpc('issue_refund_voucher', {
          p_order_code: order.order_code,
          p_voucher_code: voucherCode(),
        });
        if (voucherError) throw new Error('Voucher kompensasi tidak dapat diterbitkan.');
        return jsonResponse(request, { received: true, result: 'voucher_issued' });
      }
      throw error;
    }
    return jsonResponse(request, { received: true, result: 'fulfilled' });
  } catch (error) {
    console.error('midtrans-webhook failed', error);
    return jsonResponse(request, { error: 'Notifikasi pembayaran belum dapat diproses.' }, 500);
  }
});
