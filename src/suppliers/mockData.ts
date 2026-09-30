import type { SupplierHotel } from '../types';

// Static mock inventory. Several hotel names overlap between A and B so that the
// price comparison is meaningful. Any city not listed here returns an empty array.

export const supplierAHotels: SupplierHotel[] = [
  { hotelId: 'a1', name: 'Holtin', price: 6000, city: 'delhi', commissionPct: 10 },
  { hotelId: 'a2', name: 'Radison', price: 5900, city: 'delhi', commissionPct: 13 },
  { hotelId: 'a3', name: 'Taj Palace', price: 12500, city: 'delhi', commissionPct: 15 },
  { hotelId: 'a4', name: 'The Oberoi', price: 14200, city: 'delhi', commissionPct: 12 },
  { hotelId: 'a5', name: 'Lemon Tree', price: 3200, city: 'delhi', commissionPct: 8 },
  { hotelId: 'a6', name: 'ITC Maratha', price: 11000, city: 'mumbai', commissionPct: 14 },
  { hotelId: 'a7', name: 'Trident', price: 9800, city: 'mumbai', commissionPct: 11 },
  { hotelId: 'a8', name: 'Fairfield', price: 5400, city: 'mumbai', commissionPct: 9 },
];

export const supplierBHotels: SupplierHotel[] = [
  { hotelId: 'b1', name: 'Holtin', price: 5340, city: 'delhi', commissionPct: 20 },
  { hotelId: 'b2', name: 'Radison', price: 6150, city: 'delhi', commissionPct: 18 },
  { hotelId: 'b3', name: 'Taj Palace', price: 11990, city: 'delhi', commissionPct: 10 },
  { hotelId: 'b4', name: 'The Leela', price: 15800, city: 'delhi', commissionPct: 16 },
  { hotelId: 'b5', name: 'Ibis', price: 2900, city: 'delhi', commissionPct: 7 },
  { hotelId: 'b6', name: 'ITC Maratha', price: 10450, city: 'mumbai', commissionPct: 12 },
  { hotelId: 'b7', name: 'Trident', price: 10200, city: 'mumbai', commissionPct: 15 },
  { hotelId: 'b8', name: 'Novotel', price: 7600, city: 'mumbai', commissionPct: 10 },
];
