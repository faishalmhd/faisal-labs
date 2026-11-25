import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { cancelMidtransTransaction } from '../_shared/midtrans.ts';
import { supabaseAdmin } from '../_shared/supabaseAdmin.ts';
import { supplierProvider } from '../_shared/supplier5sim.ts';

function validInput(value: unknown): value is { orderCode: string; pin: string } {
  if (!value || typeof value !== 'object') return false;
  const body = value as Record<string, unknown>;
  return typeof body.orderCode === 'string' && /^VN[A-F0-9]{24}$/.test(body.orderCode)
    && typeof body.pin === 'string' && /^[0-9]{6}$/.test(body.pin);
}

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflightResponse(request);
  if (request.method !== 'POST') return jsonResponse(request, { error: 'Metode permintaan tidak didukung.' }, 405);
  try {
    const body: unknown = await request.json();
    if (!validInput(body)) return jsonResponse(request, { error: 'Kode pesanan atau PIN tidak valid.' }, 400);
    const admin = supabaseAdmin();
    const { data: order, error: lookupError } = await admin.rpc('get_order_secure', {
      p_order_code: body.orderCode,
      p_pin_hash: body.pin,
    });
    if (lookupError) throw new Error('Pesanan tidak dapat diperiksa.');
    if (!order) return jsonResponse(request, { error: 'Pesanan tidak ditemukan.' }, 404);
    if (order.payment_status !== 'pending') {
      return jsonResponse(request, { error: 'Hanya pesanan yang belum dibayar yang dapat dibatalkan.' }, 409);
    }

    if (order.midtrans_transaction_id) await cancelMidtransTransaction(body.orderCode);
    const { data: result, error: cancelError } = await admin.rpc('cancel_pending_order', { p_order_code: body.orderCode });
    if (cancelError) throw new Error('Pesanan tidak dapat dibatalkan.');
    if (result?.result !== 'cancelled') return jsonResponse(request, { error: 'Status pesanan telah berubah.' }, 409);
    if (order.supplier_order_id) await supplierProvider().cancel(Number(order.supplier_order_id));
    return jsonResponse(request, { cancelled: true });
  } catch (error) {
    console.error('cancel-order failed', error);
    return jsonResponse(request, { error: 'Pesanan belum dapat dibatalkan.' }, 503);
  }
});
