import { AlertCircle, LoaderCircle, LockKeyhole, RefreshCw, Search, ShieldCheck } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Header } from '../components/Header';
import { LiveOtpView } from '../components/LiveOtpView';
import { OrderCardSelector } from '../components/OrderCardSelector';
import { OrderLookupDialog } from '../components/OrderLookupDialog';
import { QrisPaymentView } from '../components/QrisPaymentView';
import { cancelOrder, createOrder, fetchCatalog, getOrder } from '../lib/api';
import type { CatalogOffer, CreatedOrder, SecureOrder } from '../types';

function createPin(): string {
  const limit = Math.floor(0x1_0000_0000 / 1_000_000) * 1_000_000;
  let value: number;
  do {
    value = crypto.getRandomValues(new Uint32Array(1))[0];
  } while (value >= limit);
  return String(value % 1_000_000).padStart(6, '0');
}

export function StorefrontPage({ onAdmin }: { onAdmin: () => void }) {
  const [offers, setOffers] = useState<CatalogOffer[]>([]);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [catalogError, setCatalogError] = useState('');
  const [serviceId, setServiceId] = useState('');
  const [countryCode, setCountryCode] = useState('');
  const [pin, setPin] = useState(createPin);
  const [voucherCode, setVoucherCode] = useState('');
  const [createdOrder, setCreatedOrder] = useState<CreatedOrder | null>(null);
  const [secureOrder, setSecureOrder] = useState<SecureOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [lookupOpen, setLookupOpen] = useState(false);

  const selectedOffer = useMemo(
    () => offers.find((offer) => offer.serviceId === serviceId && offer.countryCode === countryCode),
    [offers, serviceId, countryCode],
  );
  const currentPin = createdOrder?.pin ?? pin;
  const currentOrderCode = createdOrder?.orderCode;

  const loadCatalog = useCallback(async () => {
    setLoadingCatalog(true);
    setCatalogError('');
    try {
      const catalog = await fetchCatalog();
      setOffers(catalog);
      if (catalog.length && !catalog.some((offer) => offer.serviceId === serviceId)) {
        setServiceId('');
        setCountryCode('');
      }
    } catch (caught) {
      setCatalogError(caught instanceof Error ? caught.message : 'Katalog belum dapat dimuat.');
    } finally {
      setLoadingCatalog(false);
    }
  }, [serviceId]);

  useEffect(() => { void loadCatalog(); }, [loadCatalog]);

  const refreshOrder = useCallback(async (orderCode: string, orderPin: string, showError = true) => {
    try {
      const result = await getOrder(orderCode, orderPin);
      setSecureOrder(result.order);
      setError('');
    } catch (caught) {
      if (showError) setError(caught instanceof Error ? caught.message : 'Pesanan belum dapat diperbarui.');
    }
  }, []);

  useEffect(() => {
    if (!currentOrderCode) return;
    const timer = window.setInterval(() => {
      void refreshOrder(currentOrderCode, currentPin, false);
    }, 5000);
    return () => window.clearInterval(timer);
  }, [currentOrderCode, currentPin, refreshOrder]);

  async function submitOrder(event: React.FormEvent) {
    event.preventDefault();
    setError('');
    if (!selectedOffer) {
      setError('Pilih aplikasi dan negara terlebih dahulu.');
      return;
    }
    setBusy(true);
    try {
      const result = await createOrder({
        serviceId: selectedOffer.serviceId,
        countryCode: selectedOffer.countryCode,
        pin,
        voucherCode: voucherCode.trim() || undefined,
      });
      setCreatedOrder(result);
      setSecureOrder(null);
      setVoucherCode('');
      if (result.paymentStatus === 'paid') {
        await refreshOrder(result.orderCode, result.pin);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pesanan belum dapat dibuat.');
    } finally {
      setBusy(false);
    }
  }

  async function lookup(orderCode: string, orderPin: string) {
    setBusy(true);
    setError('');
    try {
      const result = await getOrder(orderCode, orderPin);
      setSecureOrder(result.order);
      setCreatedOrder({
        orderCode: result.order.order_code,
        pin: orderPin,
        amount: result.order.amount_due_idr,
        originalAmount: result.order.sell_price_idr,
        voucherApplied: result.order.sell_price_idr - result.order.amount_due_idr,
        qrisPayload: result.order.qris_payload,
        expiresAt: result.order.expires_at,
        paymentStatus: result.order.payment_status === 'paid' ? 'paid' : 'pending',
      });
      setLookupOpen(false);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pesanan tidak ditemukan.');
    } finally {
      setBusy(false);
    }
  }

  async function cancelCurrentOrder() {
    if (!currentOrderCode) return;
    setBusy(true);
    setError('');
    try {
      await cancelOrder(currentOrderCode, currentPin);
      await refreshOrder(currentOrderCode, currentPin);
      setCreatedOrder(null);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Pesanan belum dapat dibatalkan.');
    } finally {
      setBusy(false);
    }
  }

  async function checkCurrentOrder() {
    const orderCode = currentOrderCode ?? secureOrder?.order_code;
    if (!orderCode) return;
    setBusy(true);
    await refreshOrder(orderCode, currentPin);
    setBusy(false);
  }

  return (
    <div className="min-h-screen bg-[#fafafa]">
      <Header onAdmin={onAdmin} />
      <main className="mx-auto max-w-lg px-4 pb-14 pt-10 sm:px-6 sm:pt-14">
        <div className="mb-7 text-center">
          <div className="mb-3 inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-medium text-slate-600">
            <ShieldCheck size={14} className="text-emerald-700" /> Transaksi terlindungi
          </div>
          <h1 className="text-2xl font-semibold tracking-tight text-slate-900">Nomor virtual, dengan tenang.</h1>
          <p className="mt-2 text-sm text-slate-500">Pilih layanan, bayar QRIS, lalu terima kode OTP Anda.</p>
        </div>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-sm sm:p-7">
          {createdOrder ? (
            secureOrder?.payment_status === 'paid' || secureOrder?.fulfillment_status === 'refunded' ? (
              <LiveOtpView order={secureOrder} onRefresh={checkCurrentOrder} busy={busy} />
            ) : createdOrder.paymentStatus === 'paid' && secureOrder ? (
              <LiveOtpView order={secureOrder} onRefresh={checkCurrentOrder} busy={busy} />
            ) : (
              <QrisPaymentView
                order={createdOrder}
                onLookup={checkCurrentOrder}
                onCancel={cancelCurrentOrder}
                busy={busy}
              />
            )
          ) : secureOrder ? (
            <LiveOtpView order={secureOrder} onRefresh={checkCurrentOrder} busy={busy} />
          ) : (
            <>
              <div className="mb-6 flex items-start justify-between">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Langkah 1 dari 3</p>
                  <h2 className="mt-1 text-lg font-semibold text-slate-900">Pilih layanan</h2>
                </div>
                <button onClick={() => setLookupOpen(true)} className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-xs font-medium text-slate-500 hover:bg-slate-50 hover:text-slate-900">
                  <Search size={14} /> Cari pesanan
                </button>
              </div>

              {loadingCatalog ? (
                <div className="flex items-center justify-center gap-2 py-10 text-sm text-slate-500">
                  <LoaderCircle className="animate-spin" size={18} /> Memuat layanan…
                </div>
              ) : catalogError ? (
                <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                  <p>{catalogError}</p>
                  <button onClick={() => void loadCatalog()} className="mt-3 inline-flex items-center gap-2 font-medium">
                    <RefreshCw size={14} /> Coba lagi
                  </button>
                </div>
              ) : offers.length === 0 ? (
                <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
                  <p>Layanan belum tersedia. Silakan coba beberapa saat lagi.</p>
                  <button onClick={() => void loadCatalog()} className="mt-3 inline-flex items-center gap-2 font-medium text-slate-900">
                    <RefreshCw size={14} /> Muat ulang
                  </button>
                </div>
              ) : (
                <form onSubmit={submitOrder} className="space-y-6">
                  <OrderCardSelector
                    offers={offers}
                    serviceId={serviceId}
                    countryCode={countryCode}
                    onServiceChange={(value) => { setServiceId(value); setCountryCode(''); }}
                    onCountryChange={setCountryCode}
                  />

                  {selectedOffer && (
                    <div className="animate-fade-in border-t border-slate-100 pt-5">
                      <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-400">Langkah 2 dari 3</p>
                      <label className="mt-3 block text-sm font-medium text-slate-700">
                        PIN keamanan Anda
                        <span className="mt-2 flex gap-2">
                          <input
                            required
                            value={pin}
                            onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 6))}
                            inputMode="numeric"
                            pattern="[0-9]{6}"
                            className="input-field font-mono text-lg tracking-[0.24em] tabular-nums"
                            aria-label="PIN keamanan enam digit"
                          />
                          <button type="button" onClick={() => void navigator.clipboard.writeText(pin)} className="shrink-0 rounded-xl border border-slate-200 px-3 text-slate-500 hover:bg-slate-50" aria-label="Salin PIN">
                            <LockKeyhole size={17} />
                          </button>
                        </span>
                      </label>

                      <details className="mt-4">
                        <summary className="cursor-pointer text-xs text-slate-500">Punya voucher kompensasi?</summary>
                        <input
                          value={voucherCode}
                          onChange={(event) => setVoucherCode(event.target.value.toUpperCase())}
                          maxLength={40}
                          placeholder="Masukkan kode voucher"
                          className="input-field mt-2 font-mono uppercase"
                        />
                      </details>

                      <button disabled={busy || pin.length !== 6} className="primary-button mt-5 w-full">
                        {busy ? <><LoaderCircle className="animate-spin" size={17} /> Menyiapkan pesanan…</>
                          : voucherCode.trim()
                            ? 'Lanjut menggunakan voucher'
                            : `Lanjut Bayar QRIS — Rp${selectedOffer.sellPriceIdr.toLocaleString('id-ID')}`}
                      </button>
                      <p className="mt-3 text-center text-xs leading-5 text-slate-400">
                        PIN diperlukan untuk membuka status pesanan. Simpan kode pesanan dan PIN Anda.
                      </p>
                    </div>
                  )}
                </form>
              )}
            </>
          )}

          {error && (
            <div role="alert" className="mt-5 flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
              <AlertCircle size={17} className="mt-0.5 shrink-0" /> {error}
            </div>
          )}
        </section>
        <p className="mt-5 text-center text-xs leading-5 text-slate-400">
          Pembayaran hanya melalui QRIS. Gunakan nomor virtual sesuai ketentuan layanan terkait.
        </p>
      </main>

      <OrderLookupDialog open={lookupOpen} onClose={() => setLookupOpen(false)} onSubmit={lookup} busy={busy} />
    </div>
  );
}
