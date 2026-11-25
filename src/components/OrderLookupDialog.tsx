import { X } from 'lucide-react';
import { useState } from 'react';

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (orderCode: string, pin: string) => Promise<void>;
  busy: boolean;
}

export function OrderLookupDialog({ open, onClose, onSubmit, busy }: Props) {
  const [orderCode, setOrderCode] = useState('');
  const [pin, setPin] = useState('');
  if (!open) return null;

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    await onSubmit(orderCode.trim().toUpperCase(), pin);
  }

  return (
    <div className="fixed inset-0 z-20 grid place-items-center bg-slate-900/30 p-4" role="dialog" aria-modal="true" aria-labelledby="lookup-title">
      <form onSubmit={submit} className="w-full max-w-sm rounded-2xl bg-white p-6 shadow-xl">
        <div className="mb-5 flex items-center justify-between">
          <div>
            <h2 id="lookup-title" className="font-semibold text-slate-900">Cari pesanan</h2>
            <p className="mt-1 text-sm text-slate-500">Masukkan kode pesanan dan PIN Anda.</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Tutup" className="rounded-lg p-2 text-slate-400 hover:bg-slate-100"><X size={18} /></button>
        </div>
        <label className="mb-4 block text-sm font-medium text-slate-700">
          Kode pesanan
          <input required value={orderCode} onChange={(event) => setOrderCode(event.target.value)} placeholder="VN…" className="input-field mt-2 font-mono uppercase" />
        </label>
        <label className="mb-5 block text-sm font-medium text-slate-700">
          PIN 6 digit
          <input required value={pin} onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))} inputMode="numeric" pattern="[0-9]{6}" className="input-field mt-2 font-mono tabular-nums" />
        </label>
        <button disabled={busy} className="primary-button w-full">{busy ? 'Memeriksa…' : 'Lihat pesanan'}</button>
      </form>
    </div>
  );
}
