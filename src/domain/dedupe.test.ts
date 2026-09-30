import assert from 'node:assert/strict';
import { test } from 'node:test';
import { selectBestOffers, type LabelledHotel } from './dedupe';

const h = (name: string, price: number, supplier: string, commissionPct = 10): LabelledHotel => ({
  hotelId: `${supplier}-${name}`,
  name,
  price,
  city: 'delhi',
  commissionPct,
  supplier,
});

test('keeps the cheaper offer for hotels present at both suppliers', () => {
  const result = selectBestOffers([
    h('Holtin', 6000, 'Supplier A', 10),
    h('Holtin', 5340, 'Supplier B', 20),
    h('Radison', 5900, 'Supplier A', 13),
    h('Radison', 6150, 'Supplier B', 18),
  ]);
  assert.deepEqual(result, [
    { name: 'Holtin', price: 5340, supplier: 'Supplier B', commissionPct: 20 },
    { name: 'Radison', price: 5900, supplier: 'Supplier A', commissionPct: 13 },
  ]);
});

test('keeps hotels offered by only one supplier', () => {
  const result = selectBestOffers([h('Ibis', 2900, 'Supplier B'), h('Lemon Tree', 3200, 'Supplier A')]);
  assert.equal(result.length, 2);
});

test('matches names case-insensitively and ignores surrounding whitespace', () => {
  const result = selectBestOffers([h('Taj Palace', 12500, 'Supplier A'), h(' taj palace ', 11990, 'Supplier B')]);
  assert.equal(result.length, 1);
  assert.equal(result[0].supplier, 'Supplier B');
});

test('breaks price ties with the higher commission', () => {
  const result = selectBestOffers([h('Novotel', 7000, 'Supplier A', 9), h('Novotel', 7000, 'Supplier B', 14)]);
  assert.equal(result[0].supplier, 'Supplier B');
});

test('returns an empty list for no input', () => {
  assert.deepEqual(selectBestOffers([]), []);
});
