import { ApplicationFailure, Context } from '@temporalio/activity';
import { config } from '../config';
import { saveHotelOffers } from '../redis/hotelStore';
import type { HotelOffer, SupplierHotel, SupplierId } from '../types';

const SUPPLIER_PATHS: Record<SupplierId, string> = {
  A: '/supplierA/hotels',
  B: '/supplierB/hotels',
};

const isSupplierHotel = (h: unknown): h is SupplierHotel => {
  const o = h as SupplierHotel;
  return (
    !!o &&
    typeof o.name === 'string' &&
    typeof o.price === 'number' &&
    Number.isFinite(o.price) &&
    typeof o.commissionPct === 'number'
  );
};

/** Calls one supplier's hotel API for a city. Throws (and is retried by Temporal) on failure. */
export async function fetchSupplierHotels(supplier: SupplierId, city: string): Promise<SupplierHotel[]> {
  const { log, info } = Context.current();
  const url = `${config.suppliers.baseUrl}${SUPPLIER_PATHS[supplier]}?city=${encodeURIComponent(city)}`;
  log.info('Fetching supplier hotels', { supplier, city, attempt: info.attempt });

  const started = Date.now();
  let res: Response;
  try {
    res = await fetch(url, { signal: AbortSignal.timeout(config.suppliers.timeoutMs) });
  } catch (err) {
    log.warn('Supplier request failed', { supplier, error: (err as Error).message });
    throw new Error(`Supplier ${supplier} unreachable: ${(err as Error).message}`);
  }

  if (!res.ok) {
    log.warn('Supplier returned error status', { supplier, status: res.status });
    // 4xx is a client/contract problem -> retrying won't help.
    if (res.status >= 400 && res.status < 500) {
      throw ApplicationFailure.nonRetryable(`Supplier ${supplier} responded ${res.status}`, 'SupplierClientError');
    }
    throw new Error(`Supplier ${supplier} responded ${res.status}`);
  }

  const body: unknown = await res.json();
  if (!Array.isArray(body)) {
    throw ApplicationFailure.nonRetryable(`Supplier ${supplier} returned a non-array payload`, 'InvalidSupplierPayload');
  }

  const hotels = body.filter(isSupplierHotel);
  if (hotels.length !== body.length) {
    log.warn('Dropped malformed supplier records', { supplier, dropped: body.length - hotels.length });
  }
  log.info('Supplier hotels fetched', { supplier, count: hotels.length, ms: Date.now() - started });
  return hotels;
}

/** Persists the de-duplicated list for a city into Redis. */
export async function cacheHotelOffers(city: string, hotels: HotelOffer[]): Promise<void> {
  const { log } = Context.current();
  await saveHotelOffers(city, hotels);
  log.info('Cached hotel offers in Redis', { city, count: hotels.length });
}
