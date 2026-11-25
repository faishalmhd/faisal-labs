const apiBase = () => Deno.env.get('MIDTRANS_IS_PRODUCTION') === 'true'
  ? 'https://api.midtrans.com'
  : 'https://api.sandbox.midtrans.com';

function serverKey(): string {
  const key = Deno.env.get('MIDTRANS_SERVER_KEY');
  if (!key) throw new Error('Konfigurasi pembayaran belum tersedia.');
  return key;
}

function authHeader(): string {
  return `Basic ${btoa(`${serverKey()}:`)}`;
}

export interface QrisCharge {
  transaction_id: string;
  transaction_status: string;
  status_code?: string;
  actions?: Array<{ name: string; method: string; url: string }>;
  qr_string?: string;
  expiry_time?: string;
}

export async function createQrisCharge(input: {
  orderCode: string;
  amount: number;
  itemName: string;
  expiryMinutes: number;
}): Promise<QrisCharge> {
  const response = await fetch(`${apiBase()}/v2/charge`, {
    method: 'POST',
    headers: {
      Authorization: authHeader(),
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify({
      payment_type: 'qris',
      transaction_details: { order_id: input.orderCode, gross_amount: input.amount },
      item_details: [{ id: 'virtual-number', price: input.amount, quantity: 1, name: input.itemName.slice(0, 50) }],
      custom_expiry: {
        expiry_duration: input.expiryMinutes,
        unit: 'minute',
      },
    }),
  });
  const payload = await response.json().catch(() => null);
  if (!response.ok || !payload?.transaction_id) {
    console.error('Midtrans QRIS charge rejected', {
      httpStatus: response.status,
      statusCode: payload?.status_code,
      statusMessage: payload?.status_message,
    });
    throw new Error('Tagihan QRIS tidak dapat dibuat. Silakan coba kembali.');
  }
  return payload as QrisCharge;
}

export async function cancelMidtransTransaction(orderCode: string): Promise<void> {
  const response = await fetch(`${apiBase()}/v2/${encodeURIComponent(orderCode)}/cancel`, {
    method: 'POST',
    headers: { Authorization: authHeader(), Accept: 'application/json' },
  });
  const payload = await response.json().catch(() => null);
  const midtransStatus = String(payload?.status_code ?? response.status);
  if (!response.ok && response.status !== 404 && response.status !== 412
    && midtransStatus !== '404' && midtransStatus !== '412') {
    throw new Error('Tagihan QRIS tidak dapat dibatalkan.');
  }
}

export async function verifyMidtransSignature(
  orderId: string,
  statusCode: string,
  grossAmount: string,
  signature: string,
): Promise<boolean> {
  const message = new TextEncoder().encode(`${orderId}${statusCode}${grossAmount}${serverKey()}`);
  const digest = await crypto.subtle.digest('SHA-512', message);
  const expected = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
  if (!/^[a-f0-9]{128}$/i.test(signature)) return false;
  let mismatch = 0;
  for (let index = 0; index < expected.length; index += 1) {
    mismatch |= expected.charCodeAt(index) ^ signature.toLowerCase().charCodeAt(index);
  }
  return mismatch === 0;
}

export function extractQrisPayload(charge: QrisCharge): string {
  const action = charge.actions?.find((item) => item.name === 'generate-qr-code');
  const payload = charge.qr_string ?? action?.url;
  if (!payload) throw new Error('Data QRIS dari penyedia pembayaran tidak lengkap.');
  return payload;
}