import { ChevronDown, Smartphone } from 'lucide-react';
import type { CatalogOffer } from '../types';

interface Props {
  offers: CatalogOffer[];
  serviceId: string;
  countryCode: string;
  onServiceChange: (value: string) => void;
  onCountryChange: (value: string) => void;
}

export function OrderCardSelector({ offers, serviceId, countryCode, onServiceChange, onCountryChange }: Props) {
  const services = Array.from(new Map(offers.map((offer) => [offer.serviceId, offer.serviceName])).entries());
  const countries = offers.filter((offer) => offer.serviceId === serviceId);
  const selected = countries.find((offer) => offer.countryCode === countryCode);

  return (
    <div className="space-y-5">
      <label className="block">
        <span className="mb-2 block text-sm font-medium text-slate-700">Pilih aplikasi</span>
        <span className="relative block">
          <Smartphone className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={18} />
          <select
            value={serviceId}
            onChange={(event) => onServiceChange(event.target.value)}
            className="w-full appearance-none rounded-xl border border-slate-200 bg-white py-3 pl-10 pr-10 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100"
          >
            <option value="">Pilih aplikasi</option>
            {services.map(([id, name]) => (
              <option key={id} value={id}>{name}</option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        </span>
        {serviceId && selected && <span className="mt-1.5 block text-xs text-slate-500">Stok tersedia: {selected.stock} nomor</span>}
      </label>

      <label className="block">
        <span className="mb-2 block text-sm font-medium text-slate-700">Pilih negara</span>
        <span className="relative block">
          <select
            value={countryCode}
            disabled={!serviceId}
            onChange={(event) => onCountryChange(event.target.value)}
            className="w-full appearance-none rounded-xl border border-slate-200 bg-white px-4 py-3 pr-10 text-sm text-slate-900 outline-none transition focus:border-slate-400 focus:ring-4 focus:ring-slate-100 disabled:cursor-not-allowed disabled:bg-slate-50 disabled:text-slate-400"
          >
            <option value="">Pilih negara</option>
            {countries.map((offer) => (
              <option key={offer.countryCode} value={offer.countryCode}>
                {offer.countryName} — Rp{offer.sellPriceIdr.toLocaleString('id-ID')}
              </option>
            ))}
          </select>
          <ChevronDown className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        </span>
      </label>
      {selected && (
        <div className="flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
          <span className="text-sm text-slate-500">Harga total</span>
          <span className="tabular-nums text-base font-semibold text-slate-900">Rp{selected.sellPriceIdr.toLocaleString('id-ID')}</span>
        </div>
      )}
    </div>
  );
}
