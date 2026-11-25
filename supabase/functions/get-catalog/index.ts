import { corsHeaders, jsonResponse, preflightResponse } from '../_shared/cors.ts';
import { configuredCatalogPairs, supplierProvider } from '../_shared/supplier5sim.ts';

const defaultPairs = [
  { serviceId: 'telegram', serviceName: 'Telegram', countryCode: 'indonesia', countryName: 'Indonesia' },
  { serviceId: 'telegram', serviceName: 'Telegram', countryCode: 'usa', countryName: 'Amerika Serikat' },
  { serviceId: 'whatsapp', serviceName: 'WhatsApp', countryCode: 'indonesia', countryName: 'Indonesia' },
  { serviceId: 'whatsapp', serviceName: 'WhatsApp', countryCode: 'usa', countryName: 'Amerika Serikat' },
];

Deno.serve(async (request) => {
  if (request.method === 'OPTIONS') return preflightResponse(request);
  if (request.method !== 'GET') return jsonResponse(request, { error: 'Metode permintaan tidak didukung.' }, 405);
  try {
    const configured = configuredCatalogPairs();
    const pairs = configured.length > 0 ? configured : defaultPairs;
    const offers = (await supplierProvider().getOffers(pairs)).map((offer) => ({
      serviceId: offer.serviceId,
      serviceName: offer.serviceName,
      countryCode: offer.countryCode,
      countryName: offer.countryName,
      stock: offer.stock,
      sellPriceIdr: offer.sellPriceIdr,
    }));
    return new Response(JSON.stringify({ offers }), {
      status: 200,
      headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    console.error('get-catalog failed', error);
    return jsonResponse(request, { error: 'Katalog belum dapat dimuat. Silakan coba beberapa saat lagi.' }, 503);
  }
});
