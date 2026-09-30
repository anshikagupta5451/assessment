export type SupplierId = 'A' | 'B';

/** Raw hotel record as returned by a supplier API. */
export interface SupplierHotel {
  hotelId: string;
  name: string;
  price: number;
  city: string;
  commissionPct: number;
}

/** Final, de-duplicated offer returned to clients. */
export interface HotelOffer {
  name: string;
  price: number;
  supplier: string;
  commissionPct: number;
}

export interface SupplierFetchResult {
  supplier: SupplierId;
  ok: boolean;
  hotels: SupplierHotel[];
  error?: string;
}

export interface HotelSearchInput {
  city: string;
}

export interface HotelSearchResult {
  city: string;
  hotels: HotelOffer[];
  suppliers: { supplier: SupplierId; ok: boolean; count: number; error?: string }[];
}
