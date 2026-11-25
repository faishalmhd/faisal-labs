export interface CatalogPair {
  serviceId: string;
  serviceName: string;
  countryCode: string;
  countryName: string;
}

export interface SupplierOffer extends CatalogPair {
  stock: number;
  supplierCostIdr: number;
  sellPriceIdr: number;
}

export interface SupplierPurchase {
  id: number;
  phone: string;
}

export interface SupplierActivation {
  status: string;
  sms?: Array<{ code?: string; text?: string }>;
}

export interface SupplierProvider {
  getBalanceIdr(): Promise<number>;
  getOffers(pairs: CatalogPair[]): Promise<SupplierOffer[]>;
  buy(pair: CatalogPair): Promise<SupplierPurchase>;
  getActivation(id: number): Promise<SupplierActivation>;
  finish(id: number): Promise<void>;
  cancel(id: number): Promise<void>;
}

export class SupplierApiError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = 'SupplierApiError';
  }
}

function required(name: string): string {
  const value = Deno.env.get(name);
  if (!value) throw new Error(`Konfigurasi ${name} belum tersedia.`);
  return value;
}

function numberEnv(name: string, fallback: number): number {
  const value = Deno.env.get(name);
  if (!value) return fallback;
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) throw new Error(`Konfigurasi ${name} tidak valid.`);
  return parsed;
}

export function configuredCatalogPairs(): CatalogPair[] {
  const raw = Deno.env.get('CATALOG_PAIRS_JSON') ?? '[]';
  let pairs: unknown;
  try {
    pairs = JSON.parse(raw);
  } catch {
    throw new Error('Konfigurasi katalog tidak valid.');
  }
  if (!Array.isArray(pairs)) throw new Error('Konfigurasi katalog harus berupa daftar.');
  return pairs.map((entry) => {
    const item = entry as Partial<CatalogPair>;
    if (![item.serviceId, item.serviceName, item.countryCode, item.countryName].every((part) => typeof part === 'string' && part.length > 0)) {
      throw new Error('Konfigurasi katalog memiliki pasangan layanan atau negara yang tidak valid.');
    }
    return item as CatalogPair;
  });
}

export function sellPriceIdr(costIdr: number): number {
  if (!Number.isSafeInteger(costIdr) || costIdr <= 0) throw new Error('Harga modal supplier tidak valid.');
  const marginBps = numberEnv('SELLER_MARGIN_BPS', 2000);
  const beforeMdr = costIdr * (1 + marginBps / 10_000) / (1 - 0.007);
  const sellPrice = Math.ceil(beforeMdr / 100) * 100;
  if (!Number.isSafeInteger(sellPrice)) throw new Error('Harga jual berada di luar batas yang didukung.');
  return sellPrice;
}

export class FiveSimSupplier implements SupplierProvider {
  private readonly baseUrl = (Deno.env.get('SUPPLIER_BASE_URL') ?? 'https://5sim.net/v1').replace(/\/+$/, '');
  private readonly conversion = numberEnv('SUPPLIER_CURRENCY_TO_IDR', 16000);

  private async request<T>(path: string): Promise<T> {
    const response = await fetch(`${this.baseUrl}${path}`, {
      headers: { Authorization: `Bearer ${required('SUPPLIER_API_KEY')}`, Accept: 'application/json' },
    });
    const text = await response.text();
    let payload: unknown;
    try {
      payload = JSON.parse(text);
    } catch {
      payload = text;
    }
    if (typeof payload === 'string' && /NO_NUMBERS|OUT_OF_STOCK|NO_STOCK|NO_FREE_PHONES|no free phones|no numbers|no_product|NO_PRODUCT/i.test(payload)) {
      throw new SupplierApiError(payload, 'Stok nomor supplier sedang habis.');
    }
    if (!response.ok) {
      const code = typeof payload === 'string'
        ? payload
        : typeof payload === 'object' && payload !== null && 'message' in payload
          ? String((payload as { message: unknown }).message)
          : `HTTP_${response.status}`;
      throw new SupplierApiError(code, `Supplier merespons dengan status ${response.status}.`);
    }
    return payload as T;
  }

  async getBalanceIdr(): Promise<number> {
    const profile = await this.request<{ balance?: number | string }>('/user/profile');
    const balance = Number(profile.balance);
    if (!Number.isFinite(balance) || balance < 0) {
      throw new Error('Saldo supplier tidak dapat diverifikasi.');
    }
    return Math.floor(balance * this.conversion);
  }

  async getOffers(pairs: CatalogPair[]): Promise<SupplierOffer[]> {
    const results = await Promise.all(pairs.map(async (pair) => {
      const path = `/guest/products/${encodeURIComponent(pair.countryCode)}/any`;
      const products = await this.request<Record<string, unknown>>(path);
      const entry = products[pair.serviceId];
      if (!entry || typeof entry !== 'object') return null;
      const variants = Object.values(entry as Record<string, unknown>);
      const candidates = [
        entry as Record<string, unknown>,
        ...variants.filter((variant): variant is Record<string, unknown> => typeof variant === 'object' && variant !== null),
      ];
      const product = candidates.find((candidate) =>
        Number.isFinite(Number(candidate.price ?? candidate.Price ?? candidate.cost ?? candidate.Cost))
        && Number.isFinite(Number(candidate.quantity ?? candidate.count ?? candidate.qty ?? candidate.Qty))
      );
      if (!product) return null;
      const rawPrice = Number(product.price ?? product.Price ?? product.cost ?? product.Cost);
      const rawStock = Number(product.quantity ?? product.count ?? product.qty ?? product.Qty);
      const supplierCostIdr = Math.ceil(rawPrice * this.conversion);
      if (!Number.isSafeInteger(supplierCostIdr) || supplierCostIdr <= 0 || !Number.isFinite(rawStock) || rawStock < 0) return null;
      return {
        ...pair,
        stock: Math.max(0, Math.floor(rawStock)),
        supplierCostIdr,
        sellPriceIdr: sellPriceIdr(supplierCostIdr),
      };
    }));
    return results.filter((item): item is SupplierOffer => item !== null && item.stock > 0);
  }

  async buy(pair: CatalogPair): Promise<SupplierPurchase> {
    const result = await this.request<{ id?: number; phone?: string }>(
      `/user/buy/activation/${encodeURIComponent(pair.countryCode)}/any/${encodeURIComponent(pair.serviceId)}`,
    );
    if (!Number.isSafeInteger(result.id) || !result.phone) {
      throw new Error('Supplier tidak mengembalikan nomor yang valid.');
    }
    return { id: result.id as number, phone: result.phone };
  }

  getActivation(id: number): Promise<SupplierActivation> {
    return this.request<SupplierActivation>(`/user/check/${id}`);
  }

  async finish(id: number): Promise<void> {
    await this.request(`/user/finish/${id}`);
  }

  async cancel(id: number): Promise<void> {
    await this.request(`/user/cancel/${id}`);
  }
}

export class SmsActivateSupplier {
  private readonly baseUrl = 'https://api.sms-activate.org/stubs/handler_api.php';

  private async requestText(params: Record<string, string>): Promise<string> {
    const url = new URL(this.baseUrl);
    url.searchParams.set('api_key', required('SMS_ACTIVATE_API_KEY'));
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
    const response = await fetch(url);
    const text = await response.text();
    if (!response.ok) throw new SupplierApiError(`HTTP_${response.status}`, `SMS-Activate merespons dengan status ${response.status}.`);
    if (text.startsWith('BAD_') || text.startsWith('ERROR_') || text.startsWith('NO_')) {
      throw new SupplierApiError(text, `SMS-Activate menolak permintaan (${text}).`);
    }
    return text;
  }

  private async requestJson<T>(params: Record<string, string>): Promise<T> {
    const text = await this.requestText(params);
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error('Respons SMS-Activate tidak valid.');
    }
  }

  async getBalanceIdr(): Promise<number> {
    const result = await this.requestText({ action: 'getBalance' });
    const match = /^ACCESS_BALANCE:([0-9]+(?:\.[0-9]+)?)$/.exec(result);
    if (!match) throw new Error('Saldo SMS-Activate tidak dapat diverifikasi.');
    return Math.floor(Number(match[1]) * numberEnv('SMS_ACTIVATE_CURRENCY_TO_IDR', 16000));
  }

  async getOffers(pairs: CatalogPair[]): Promise<SupplierOffer[]> {
    const results = await Promise.all(pairs.map(async (pair) => {
      const prices = await this.requestJson<Record<string, Record<string, { cost?: number; count?: number }>>>({
        action: 'getPrices', country: pair.countryCode, service: pair.serviceId,
      });
      const product = prices[pair.countryCode]?.[pair.serviceId];
      if (!product || !Number.isFinite(product.cost)) return null;
      const cost = Math.ceil((product.cost as number) * numberEnv('SMS_ACTIVATE_CURRENCY_TO_IDR', 16000));
      return { ...pair, stock: Number(product.count ?? 0), supplierCostIdr: cost, sellPriceIdr: sellPriceIdr(cost) };
    }));
    return results.filter((item): item is SupplierOffer => item !== null && item.stock > 0);
  }

  async buy(pair: CatalogPair): Promise<SupplierPurchase> {
    const result = await this.requestJson<{ activationId?: number; phoneNumber?: string }>({
      action: 'getNumberV2', country: pair.countryCode, service: pair.serviceId,
    });
    if (!Number.isSafeInteger(result.activationId) || !result.phoneNumber) {
      throw new Error('SMS-Activate tidak mengembalikan nomor yang valid.');
    }
    return { id: result.activationId as number, phone: result.phoneNumber };
  }

  async getActivation(id: number): Promise<SupplierActivation> {
    const result = await this.requestText({ action: 'getStatus', id: String(id) });
    const match = /^STATUS_OK:(.+)$/.exec(result);
    return match ? { status: 'RECEIVED', sms: [{ code: match[1] }] } : { status: 'PENDING' };
  }

  async finish(id: number): Promise<void> {
    await this.requestText({ action: 'setStatus', id: String(id), status: '6' });
  }

  async cancel(id: number): Promise<void> {
    await this.requestText({ action: 'setStatus', id: String(id), status: '8' });
  }
}

export function supplierProvider(): SupplierProvider {
  const provider = Deno.env.get('SUPPLIER_PROVIDER') ?? '5sim';
  if (provider === '5sim') return new FiveSimSupplier();
  if (provider === 'sms-activate') return new SmsActivateSupplier();
  throw new Error(`Penyedia supplier "${provider}" belum diaktifkan.`);
}
