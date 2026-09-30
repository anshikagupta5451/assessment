import type { HotelOffer, SupplierHotel } from '../types';

// NOTE: this module is imported by the Temporal workflow, so it must stay pure and
// deterministic (no I/O, no Date/Math.random, no Node-only imports).

export const SUPPLIER_LABELS = { A: 'Supplier A', B: 'Supplier B' } as const;

export interface LabelledHotel extends SupplierHotel {
  supplier: string;
}

const normaliseName = (name: string): string => name.trim().toLowerCase();

/**
 * Returns true when `candidate` is a better offer than `current`:
 * cheaper price wins; on a tie, the higher commission wins; otherwise keep the current one.
 */
const isBetter = (candidate: LabelledHotel, current: LabelledHotel): boolean => {
  if (candidate.price !== current.price) return candidate.price < current.price;
  return candidate.commissionPct > current.commissionPct;
};

/**
 * De-duplicates hotels by (case-insensitive) name and keeps the best-priced offer per hotel.
 * Output is sorted by price ascending, then name.
 */
export function selectBestOffers(hotels: LabelledHotel[]): HotelOffer[] {
  const best = new Map<string, LabelledHotel>();

  for (const hotel of hotels) {
    if (!hotel || typeof hotel.name !== 'string' || !Number.isFinite(hotel.price)) continue;
    const key = normaliseName(hotel.name);
    const current = best.get(key);
    if (!current || isBetter(hotel, current)) best.set(key, hotel);
  }

  return [...best.values()]
    .map(({ name, price, supplier, commissionPct }) => ({ name, price, supplier, commissionPct }))
    .sort((a, b) => a.price - b.price || a.name.localeCompare(b.name));
}
