import { assertAdmin } from '../_shared/supabaseAdmin.ts';
import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { cancelMidtransTransaction } from '../_shared/midtrans.ts';

function voucherCode(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('').toUpperCase();
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflightResponse(request);
  try {
    await assertAdmin(request);
    const admin = supabaseAdmin();

    if (request.method === 'GET') {
      const url = new URL(request.url);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? 50)));
      const { data, error } = await admin.from('orders')
        .select('order_code, service_name, country_name, sell_price_idr, amount_due_idr, payment_status, fulfillment_status, fulfillment_claimed_at, phone_number, otp_code, created_at')
        .order('created_at', { ascending: false })
        .limit(limit);
      if (error) throw new Error('Data pesanan tidak dapat dimuat.');
      const { data: summary, error: summaryError } = await admin.rpc('get_admin_financial_summary');
      if (summaryError) throw new Error('Ringkasan keuangan tidak dapat dimuat.');
      return jsonResponse(request, { orders: data, summary });
    }

    if (request.method === 'POST') {
      const body: unknown = await request.json();
      if (!body || typeof body !== 'object') return jsonResponse(request, { error: 'Aksi admin tidak dikenal.' }, 400);
      const action = (body as Record<string, unknown>).action;
      const orderCode = (body as Record<string, unknown>).orderCode;
      if (typeof orderCode !== 'string' || !/^VN[A-F0-9]{24}$/.test(orderCode)) {
        return jsonResponse(request, { error: 'Kode pesanan tidak valid.' }, 400);
      }

      if (action === 'issue-voucher') {
        const { data: order, error: lookupError } = await admin.from('orders')
          .select('payment_status, fulfillment_status, supplier_order_id, fulfillment_claimed_at')
          .eq('order_code', orderCode)
          .maybeSingle();
        if (lookupError) throw new Error('Pesanan tidak dapat diperiksa.');
        const claimAge = order?.fulfillment_claimed_at
          ? Date.now() - new Date(order.fulfillment_claimed_at).getTime()
          : 0;
        if (!order || order.payment_status !== 'paid' || order.fulfillment_status !== 'processing'
          || order.supplier_order_id || claimAge < 120_000) {
          return jsonResponse(request, { error: 'Pesanan belum memenuhi syarat rekonsiliasi voucher.' }, 409);
        }
        const { data: result, error } = await admin.rpc('issue_refund_voucher', {
          p_order_code: orderCode,
          p_voucher_code: voucherCode(),
        });
        if (error || !['issued', 'existing'].includes(result?.result)) {
          throw new Error('Voucher kompensasi tidak dapat diterbitkan.');
        }
        return jsonResponse(request, { issued: true });
      }

      if (action !== 'cancel') return jsonResponse(request, { error: 'Aksi admin tidak dikenal.' }, 400);
      const { data: order, error: lookupError } = await admin.from('orders')
        .select('payment_status, midtrans_transaction_id')
        .eq('order_code', orderCode)
        .maybeSingle();
      if (lookupError) throw new Error('Pesanan tidak dapat diperiksa.');
      if (!order || order.payment_status !== 'pending') {
        return jsonResponse(request, { error: 'Pesanan tidak dapat dibatalkan.' }, 409);
      }
      if (order.midtrans_transaction_id) await cancelMidtransTransaction(orderCode);
      const { data, error } = await admin.rpc('cancel_pending_order', { p_order_code: orderCode });
      if (error) throw new Error('Pesanan tidak dapat dibatalkan.');
      if (data?.result !== 'cancelled') return jsonResponse(request, { error: 'Pesanan tidak dapat dibatalkan.' }, 409);
      return jsonResponse(request, { cancelled: true });
    }
    return jsonResponse(request, { error: 'Metode permintaan tidak didukung.' }, 405);
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Permintaan admin gagal.';
    const status = message.includes('Akses admin') || message.includes('Sesi admin') ? 401 : 503;
    return jsonResponse(request, { error: message }, status);
  }
});
