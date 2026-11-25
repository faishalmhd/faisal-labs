import { jsonResponse, preflightResponse } from '../_shared/cors.ts';
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
    const { data: order, error } = await admin.rpc('get_order_secure', {
      p_order_code: body.orderCode,
      p_pin_hash: body.pin,
    });
    if (error) throw new Error('Pesanan tidak dapat diperiksa.');
    if (!order) return jsonResponse(request, { error: 'Pesanan tidak ditemukan. Periksa kembali kode dan PIN.' }, 404);

    if (order.payment_status === 'paid' && order.supplier_order_id && !order.otp_code) {
      const activation = await supplierProvider().getActivation(Number(order.supplier_order_id));
      const code = activation.sms?.find((sms) => sms.code)?.code;
      if (code) {
        await supplierProvider().finish(Number(order.supplier_order_id));
        const { data: saved, error: saveError } = await admin.rpc('save_order_otp', {
          p_order_code: body.orderCode,
          p_otp_code: code,
        });
        if (saveError || saved !== true) throw new Error('Kode OTP belum dapat disimpan.');
        order.otp_code = code;
        order.fulfillment_status = 'completed';
      }
    }

    return jsonResponse(request, { order });
  } catch (error) {
    console.error('sync-otp failed', error);
    return jsonResponse(request, { error: 'Status pesanan belum dapat diperbarui.' }, 503);
  }
});
