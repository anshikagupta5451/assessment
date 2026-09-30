import { ApplicationFailure, log, proxyActivities } from '@temporalio/workflow';
import { selectBestOffers, SUPPLIER_LABELS, type LabelledHotel } from '../domain/dedupe';
import type { HotelSearchInput, HotelSearchResult, SupplierFetchResult, SupplierId } from '../types';
import type * as activities from './activities';

const { fetchSupplierHotels } = proxyActivities<typeof activities>({
  startToCloseTimeout: '10 seconds',
  retry: {
    initialInterval: '300 milliseconds',
    backoffCoefficient: 2,
    maximumInterval: '2 seconds',
    maximumAttempts: 3,
  },
});

const { cacheHotelOffers } = proxyActivities<typeof activities>({
  startToCloseTimeout: '5 seconds',
  retry: { initialInterval: '200 milliseconds', maximumAttempts: 3 },
});

const SUPPLIERS: SupplierId[] = ['A', 'B'];

/**
 * Orchestrates a hotel search:
 *  1. Calls Supplier A and Supplier B in parallel.
 *  2. Tolerates a single supplier failing; fails only if every supplier is down.
 *  3. De-duplicates by hotel name, keeping the cheapest offer.
 *  4. Saves the de-duplicated list in Redis.
 */
export async function hotelOffersWorkflow(input: HotelSearchInput): Promise<HotelSearchResult> {
  const city = input.city.trim().toLowerCase();
  log.info('Hotel offers workflow started', { city });

  const settled = await Promise.allSettled(SUPPLIERS.map((s) => fetchSupplierHotels(s, city)));

  const results: SupplierFetchResult[] = settled.map((r, i) =>
    r.status === 'fulfilled'
      ? { supplier: SUPPLIERS[i], ok: true, hotels: r.value }
      : { supplier: SUPPLIERS[i], ok: false, hotels: [], error: (r.reason as Error)?.message ?? 'unknown error' },
  );

  for (const r of results.filter((x) => !x.ok)) {
    log.warn('Supplier failed after retries, continuing without it', { supplier: r.supplier, error: r.error });
  }
  if (results.every((r) => !r.ok)) {
    throw ApplicationFailure.nonRetryable('All suppliers are unavailable', 'AllSuppliersDown');
  }

  const labelled: LabelledHotel[] = results.flatMap((r) =>
    r.hotels.map((h) => ({ ...h, supplier: SUPPLIER_LABELS[r.supplier] })),
  );
  const hotels = selectBestOffers(labelled);

  try {
    await cacheHotelOffers(city, hotels);
  } catch (err) {
    // The client still gets its answer; filtered queries will simply re-run the workflow.
    log.error('Failed to cache hotel offers', { city, error: (err as Error).message });
  }

  log.info('Hotel offers workflow completed', { city, count: hotels.length });
  return {
    city,
    hotels,
    suppliers: results.map(({ supplier, ok, hotels: h, error }) => ({ supplier, ok, count: h.length, error })),
  };
}
