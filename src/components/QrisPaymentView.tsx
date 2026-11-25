import { Check, Copy, LoaderCircle, QrCode } from 'lucide-react';
import { QRCodeSVG } from 'qrcode.react';
import { useEffect, useState } from 'react';
import { isDemoMode, simulatePayment } from '../lib/api';
import type { CreatedOrder } from '../types';

interface Props {
  order: CreatedOrder;
  onLookup: () => void;
  onCancel: () => void;
  busy: boolean;
}

function isImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'https:';
  } catch {
    return false;
  }
}

export function QrisPaymentView({ order, onLookup, onCancel, busy }: Props) {
  const [copied, setCopied] = useState(false);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(null);

  useEffect(() => {
    if (!order.expiresAt) return;
    const update = () => setSecondsRemaining(Math.max(0, Math.floor((new Date(order.expiresAt as string).getTime() - Date.now()) / 1000)));
    update();
    const timer = window.setInterval(update, 1000);
    return () => window.clearInterval(timer);
  }, [order.expiresAt]);

  async function copyOrder() {
    await navigator.clipboard.writeText(`${order.orderCode} ${order.pin}`);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <section className="animate-fade-in space-y-5">
      <div className="text-center">
        <div className="mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full bg-slate-100 text-slate-700">
          <QrCode size={21} />
        </div>
        <h2 className="text-lg font-semibold text-slate-900">Bayar dengan QRIS</h2>
        <p className="mt-1 text-sm text-slate-500">Pindai kode dengan aplikasi pembayaran Anda.</p>
      </div>

      {order.qrisPayload ? (
        <div className="mx-auto grid min-h-56 w-56 place-items-center rounded-2xl border border-slate-200 bg-white p-3">
          {isImageUrl(order.qrisPayload) ? (
            <img src={order.qrisPayload} alt="Kode pembayaran QRIS" className="h-full w-full object-contain" />
          ) : (
            <QRCodeSVG value={order.qrisPayload} size={200} level="M" includeMargin />
          )}
        </div>
      ) : (
        <div className="rounded-xl bg-emerald-50 p-4 text-center text-sm text-emerald-800">
          Voucher menutup pembayaran. Pesanan sedang diproses.
        </div>
      )}

      <div className="space-y-3 rounded-xl bg-slate-50 p-4">
        <div className="flex justify-between text-sm">
          <span className="text-slate-500">Jumlah pembayaran</span>
          <strong className="tabular-nums text-slate-900">Rp{order.amount.toLocaleString('id-ID')}</strong>
        </div>
        {order.voucherApplied ? (
          <div className="flex justify-between text-sm">
            <span className="text-slate-500">Dibayar dengan voucher</span>
            <span className="tabular-nums text-slate-700">Rp{order.voucherApplied.toLocaleString('id-ID')}</span>
          </div>
        ) : null}
        {secondsRemaining !== null && order.qrisPayload && (
          <p className="text-xs text-slate-500">
            {secondsRemaining > 0
              ? `Selesaikan sebelum ${String(Math.floor(secondsRemaining / 60)).padStart(2, '0')}:${String(secondsRemaining % 60).padStart(2, '0')}.`
              : 'Batas waktu pembayaran telah berakhir.'}
          </p>
        )}
      </div>

      <div className="flex items-center justify-between rounded-xl border border-slate-200 px-4 py-3">
        <div>
          <p className="text-xs text-slate-500">Kode pesanan · PIN</p>
          <p className="mt-1 font-mono text-sm font-medium tabular-nums text-slate-900">{order.orderCode} · {order.pin}</p>
        </div>
        <button aria-label="Salin kode pesanan dan PIN" onClick={copyOrder} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100">
          {copied ? <Check size={17} /> : <Copy size={17} />}
        </button>
      </div>

      {isDemoMode && order.paymentStatus === 'pending' && (
        <button
          type="button"
          onClick={async () => {
            await simulatePayment(order.orderCode);
            onLookup();
          }}
          disabled={busy}
          className="w-full rounded-xl bg-emerald-600 py-3 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 transition flex items-center justify-center gap-2"
        >
          ⚡ Simulasi Bayar QRIS (Demo Mode)
        </button>
      )}

      <button onClick={onLookup} disabled={busy} className="primary-button w-full">
        {busy ? <><LoaderCircle className="animate-spin" size={17} /> Memeriksa pembayaran…</> : 'Saya sudah membayar'}
      </button>
      {order.paymentStatus === 'pending' && (
        <button onClick={onCancel} disabled={busy} className="w-full py-2 text-sm text-slate-500 hover:text-slate-900">
          Batalkan pesanan
        </button>
      )}
    </section>
  );
}
