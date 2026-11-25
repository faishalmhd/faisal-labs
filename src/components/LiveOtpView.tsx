import { Check, Copy, LoaderCircle, RotateCw, TicketCheck } from 'lucide-react';
import { useState } from 'react';
import type { SecureOrder } from '../types';

interface Props {
  order: SecureOrder;
  onRefresh: () => void;
  busy: boolean;
}

export function LiveOtpView({ order, onRefresh, busy }: Props) {
  const [copied, setCopied] = useState(false);
  const [voucherCopied, setVoucherCopied] = useState(false);
  const paid = order.payment_status === 'paid';
  const inactive = order.payment_status === 'cancelled' || order.payment_status === 'expired';

  async function copy(value: string, isVoucher = false) {
    await navigator.clipboard.writeText(value);
    if (isVoucher) {
      setVoucherCopied(true);
      window.setTimeout(() => setVoucherCopied(false), 1600);
    } else {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1600);
    }
  }

  return (
    <section className="animate-fade-in space-y-5">
      <div className="text-center">
        <span className={`mx-auto mb-3 grid h-11 w-11 place-items-center rounded-full ${paid ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-500'}`}>
          {paid ? <Check size={21} /> : <LoaderCircle className="animate-spin" size={20} />}
        </span>
        <h2 className="text-lg font-semibold text-slate-900">
          {inactive ? (order.payment_status === 'expired' ? 'Batas pembayaran berakhir' : 'Pesanan dibatalkan')
            : paid ? 'Pembayaran berhasil' : 'Menunggu pembayaran'}
        </h2>
        <p className="mt-1 text-sm text-slate-500">
          {order.service_name} · {order.country_name}
        </p>
      </div>

      {order.fulfillment_status === 'refunded' && order.voucher_code ? (
        <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-center">
          <TicketCheck className="mx-auto text-emerald-700" size={24} />
          <h3 className="mt-2 font-semibold text-emerald-950">Voucher kompensasi tersedia</h3>
          <p className="mt-1 text-sm text-emerald-800">Gunakan voucher ini untuk pesanan berikutnya.</p>
          <p className="my-4 font-mono text-lg font-semibold tracking-wider text-emerald-950">{order.voucher_code}</p>
          <button onClick={() => copy(order.voucher_code as string, true)} className="inline-flex items-center gap-2 rounded-lg bg-white px-4 py-2 text-sm font-medium text-emerald-900 shadow-sm">
            {voucherCopied ? <Check size={16} /> : <Copy size={16} />} {voucherCopied ? 'Tersalin' : 'Salin voucher'}
          </button>
          <p className="mt-3 text-xs text-emerald-800">Nilai Rp{Number(order.voucher_amount_idr).toLocaleString('id-ID')}</p>
        </div>
      ) : (
        <>
          {order.phone_number && (
            <div className="rounded-2xl border border-slate-200 p-5 text-center">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Nomor virtual</p>
              <p className="mt-2 font-mono text-xl font-semibold tabular-nums text-slate-900">{order.phone_number}</p>
            </div>
          )}

          <div className="rounded-2xl bg-slate-900 p-6 text-center text-white">
            <p className="text-xs font-medium uppercase tracking-[0.18em] text-slate-300">Kode OTP</p>
            <p className="my-4 font-mono text-4xl font-semibold tracking-[0.2em] tabular-nums">
              {order.otp_code ?? '— — — — — —'}
            </p>
            {order.otp_code ? (
              <button onClick={() => copy(order.otp_code as string)} className="inline-flex items-center gap-2 rounded-lg bg-white/10 px-4 py-2 text-sm hover:bg-white/15">
                {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Tersalin' : 'Salin kode'}
              </button>
            ) : (
              <p className="text-sm text-slate-300">
                {inactive ? 'Buat pesanan baru untuk melanjutkan.'
                  : paid ? 'Kode akan muncul otomatis setelah diterima.'
                    : `Selesaikan pembayaran Rp${Number(order.amount_due_idr).toLocaleString('id-ID')} untuk melanjutkan.`}
              </p>
            )}
          </div>
        </>
      )}

      <button onClick={onRefresh} disabled={busy} className="secondary-button w-full">
        <RotateCw className={busy ? 'animate-spin' : ''} size={16} /> Perbarui status
      </button>
    </section>
  );
}
