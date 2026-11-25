import { AlertCircle, LoaderCircle, LogOut, RefreshCw, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Header } from '../components/Header';
import { cancelAdminOrder, fetchAdminOrders, issueAdminVoucher } from '../lib/api';
import { isDemoMode, supabase } from '../lib/supabaseClient';
import type { AdminOrder } from '../types';

function statusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: 'Menunggu pembayaran',
    paid: 'Lunas',
    expired: 'Kedaluwarsa',
    cancelled: 'Dibatalkan',
    waiting_payment: 'Menunggu pembayaran',
    processing: 'Diproses',
    completed: 'Selesai',
    refunded: 'Voucher terbit',
    failed: 'Gagal',
  };
  return labels[status] ?? 'Tidak diketahui';
}

export function AdminDashboardPage({ onBack }: { onBack: () => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [orders, setOrders] = useState<AdminOrder[]>([]);
  const [summary, setSummary] = useState({ gross_payments_idr: 0, qris_mdr_idr: 0, supplier_cost_idr: 0, net_profit_idr: 0 });
  const [signedIn, setSignedIn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const loadOrders = useCallback(async () => {
    setBusy(true);
    try {
      const result = await fetchAdminOrders();
      setOrders(result.orders);
      setSummary(result.summary);
      setError('');
    } catch (caught) {
      setOrders([]);
      setError(caught instanceof Error ? caught.message : 'Data pesanan belum dapat dimuat.');
    } finally {
      setBusy(false);
    }
  }, []);

  useEffect(() => {
    void supabase.auth.getSession().then(({ data }) => {
      if (data.session) {
        setSignedIn(true);
        void loadOrders();
      }
    });
    const { data } = supabase.auth.onAuthStateChange((_event, session) => {
      if (!session) setSignedIn(false);
    });
    return () => data.subscription.unsubscribe();
  }, [loadOrders]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError('');

    if (isDemoMode) {
      sessionStorage.setItem('demo_admin_user', email || 'admin@demo.com');
      setSignedIn(true);
      await loadOrders();
      setBusy(false);
      return;
    }

    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password });
    if (signInError) {
      setError('Email atau kata sandi admin tidak valid.');
      setBusy(false);
      return;
    }
    setSignedIn(true);
    await loadOrders();
    setBusy(false);
  }

  async function signOut() {
    sessionStorage.removeItem('demo_admin_user');
    try {
      await supabase.auth.signOut();
    } catch {}
    setSignedIn(false);
    setOrders([]);
  }

  async function cancel(orderCode: string) {
    if (!window.confirm('Batalkan pesanan yang belum dibayar ini?')) return;
    setBusy(true);
    try {
      await cancelAdminOrder(orderCode);
      await loadOrders();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pesanan belum dapat dibatalkan.');
      setBusy(false);
    }
  }

  async function issueVoucher(orderCode: string) {
    const confirmed = window.confirm(
      'Pastikan Anda sudah memeriksa transaksi supplier agar voucher tidak diterbitkan untuk nomor yang berhasil dibeli. Lanjutkan?',
    );
    if (!confirmed) return;
    setBusy(true);
    try {
      await issueAdminVoucher(orderCode);
      await loadOrders();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Voucher belum dapat diterbitkan.');
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <Header admin onBack={onBack} />
      <main className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        {!signedIn ? (
          <form onSubmit={signIn} className="mx-auto mt-10 max-w-sm rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-5 text-center">
              <ShieldCheck className="mx-auto text-slate-700" size={25} />
              <h1 className="mt-3 text-lg font-semibold text-slate-900">Masuk sebagai admin</h1>
              <p className="mt-1 text-sm text-slate-500">Akses terbatas untuk pengelola toko.</p>
            </div>
            {isDemoMode ? (
              <>
                <div className="mb-5 space-y-2">
                  <button
                    type="button"
                    onClick={async () => {
                      setEmail('admin@demo.com');
                      setPassword('admin123');
                      sessionStorage.setItem('demo_admin_user', 'admin@demo.com');
                      setSignedIn(true);
                      await loadOrders();
                    }}
                    className="w-full rounded-xl bg-amber-500 py-3 text-sm font-semibold text-slate-900 shadow-sm hover:bg-amber-400 transition flex items-center justify-center gap-2 cursor-pointer"
                  >
                    ⚡ Masuk Langsung (1-Klik Mode Demo)
                  </button>
                  <div className="flex items-center gap-2 my-2">
                    <div className="h-px flex-1 bg-slate-200"></div>
                    <span className="text-xs text-slate-400">atau login manual bebas</span>
                    <div className="h-px flex-1 bg-slate-200"></div>
                  </div>
                </div>
              </>
            ) : (
              <p className="mb-5 rounded-xl bg-slate-50 p-3 text-xs leading-5 text-slate-500">
                Gunakan akun Supabase Auth yang sudah terdaftar di tabel <code className="font-mono">public.admin_users</code>.
              </p>
            )}
            <label className="mb-4 block text-sm font-medium text-slate-700">
              Email
              <input required type="email" autoComplete="username" value={email} onChange={(event) => setEmail(event.target.value)} className="input-field mt-2" />
            </label>
            <label className="mb-5 block text-sm font-medium text-slate-700">
              Kata sandi
              <input required type="password" autoComplete="current-password" value={password} onChange={(event) => setPassword(event.target.value)} className="input-field mt-2" />
            </label>
            <button disabled={busy} className="primary-button w-full">{busy ? 'Memeriksa…' : 'Masuk'}</button>
          </form>
        ) : (
          <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-7">
            <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
              <div>
                <h1 className="text-xl font-semibold text-slate-900">Pesanan</h1>
                <p className="mt-1 text-sm text-slate-500">Data transaksi terbaru, maksimal 100 pesanan.</p>
              </div>
              <div className="flex gap-2">
                <button onClick={() => void loadOrders()} disabled={busy} className="secondary-button"><RefreshCw size={15} /> Muat ulang</button>
                <button onClick={() => void signOut()} className="secondary-button"><LogOut size={15} /> Keluar</button>
              </div>
            </div>
            <div className="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                ['Pembayaran QRIS', summary.gross_payments_idr],
                ['MDR QRIS 0,7%', summary.qris_mdr_idr],
                ['Modal supplier', summary.supplier_cost_idr],
                ['Profit bersih', summary.net_profit_idr],
              ].map(([label, amount]) => (
                <div key={label} className="rounded-xl border border-slate-100 bg-slate-50 p-4">
                  <p className="text-xs text-slate-500">{label}</p>
                  <p className="mt-1 text-base font-semibold tabular-nums text-slate-900">Rp{Number(amount).toLocaleString('id-ID')}</p>
                </div>
              ))}
            </div>
            {busy && orders.length === 0 ? (
              <div className="flex justify-center py-12 text-slate-500"><LoaderCircle className="animate-spin" /></div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[700px] text-left text-sm">
                  <thead className="border-b border-slate-100 text-xs uppercase tracking-wide text-slate-400">
                    <tr><th className="px-3 py-3">Pesanan</th><th className="px-3 py-3">Layanan</th><th className="px-3 py-3">Pembayaran</th><th className="px-3 py-3">Pemenuhan</th><th className="px-3 py-3">Dibuat</th><th /></tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {orders.map((order) => (
                      <tr key={order.order_code}>
                        <td className="px-3 py-4 font-mono text-xs text-slate-700">{order.order_code}</td>
                        <td className="px-3 py-4 text-slate-700">{order.service_name}<span className="block text-xs text-slate-400">{order.country_name}</span></td>
                        <td className="px-3 py-4">
                          <span className="block text-slate-700">{statusLabel(order.payment_status)}</span>
                          <span className="text-xs tabular-nums text-slate-400">Rp{order.amount_due_idr.toLocaleString('id-ID')}</span>
                        </td>
                        <td className="px-3 py-4 text-slate-600">
                          {order.fulfillment_status === 'processing' && order.fulfillment_claimed_at
                            && Date.now() - new Date(order.fulfillment_claimed_at).getTime() >= 120_000
                            ? 'Perlu rekonsiliasi'
                            : statusLabel(order.fulfillment_status)}
                        </td>
                        <td className="px-3 py-4 text-xs text-slate-500">{new Date(order.created_at).toLocaleString('id-ID')}</td>
                        <td className="px-3 py-4 text-right">
                          {order.payment_status === 'pending' && <button onClick={() => void cancel(order.order_code)} className="text-xs font-medium text-rose-700 hover:underline">Batalkan</button>}
                          {order.payment_status === 'paid' && order.fulfillment_status === 'processing'
                            && order.fulfillment_claimed_at
                            && Date.now() - new Date(order.fulfillment_claimed_at).getTime() >= 120_000
                            && <button onClick={() => void issueVoucher(order.order_code)} className="text-xs font-medium text-emerald-700 hover:underline">Voucher</button>}
                        </td>
                      </tr>
                    ))}
                    {orders.length === 0 && <tr><td colSpan={6} className="px-3 py-10 text-center text-slate-500">Belum ada pesanan.</td></tr>}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )}
        {error && <p role="alert" className="mx-auto mt-4 flex max-w-xl items-center gap-2 rounded-xl bg-rose-50 p-3 text-sm text-rose-800"><AlertCircle size={16} />{error}</p>}
      </main>
    </div>
  );
}
