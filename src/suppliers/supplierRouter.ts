import { Router } from 'express';
import { logger } from '../logger';
import type { SupplierHotel, SupplierId } from '../types';
import { supplierAHotels, supplierBHotels } from './mockData';

/**
 * Runtime up/down switch for each mock supplier, so "supplier down" can be simulated
 * without restarting containers. Initial state can be forced with SUPPLIER_A_DOWN / SUPPLIER_B_DOWN.
 */
const supplierStatus: Record<SupplierId, { up: boolean }> = {
  A: { up: process.env.SUPPLIER_A_DOWN !== 'true' },
  B: { up: process.env.SUPPLIER_B_DOWN !== 'true' },
};

const inventories: Record<SupplierId, SupplierHotel[]> = {
  A: supplierAHotels,
  B: supplierBHotels,
};

const buildSupplierRouter = (id: SupplierId): Router => {
  const router = Router();

  // GET /supplierX/hotels?city=delhi  (no city => full inventory)
  router.get('/hotels', (req, res) => {
    if (!supplierStatus[id].up) {
      logger.warn({ supplier: id }, 'Mock supplier is DOWN, returning 503');
      res.status(503).json({ error: `Supplier ${id} is unavailable` });
      return;
    }
    const city = typeof req.query.city === 'string' ? req.query.city.trim().toLowerCase() : '';
    const hotels = city ? inventories[id].filter((h) => h.city === city) : inventories[id];
    res.json(hotels);
  });

  // Lightweight health probe for this supplier.
  router.get('/health', (_req, res) => {
    if (!supplierStatus[id].up) {
      res.status(503).json({ status: 'down' });
      return;
    }
    res.json({ status: 'up' });
  });

  return router;
};

export const supplierARouter = buildSupplierRouter('A');
export const supplierBRouter = buildSupplierRouter('B');

/**
 * Admin routes to toggle mock suppliers:
 *   POST /admin/suppliers/:id/down
 *   POST /admin/suppliers/:id/up
 *   GET  /admin/suppliers
 */
export const supplierAdminRouter = Router();

supplierAdminRouter.get('/', (_req, res) => {
  res.json(supplierStatus);
});

supplierAdminRouter.post('/:id/:state', (req, res) => {
  const id = req.params.id.toUpperCase() as SupplierId;
  const state = req.params.state.toLowerCase();
  if (!(id in supplierStatus) || (state !== 'up' && state !== 'down')) {
    res.status(400).json({ error: 'Use POST /admin/suppliers/{A|B}/{up|down}' });
    return;
  }
  supplierStatus[id].up = state === 'up';
  logger.info({ supplier: id, up: supplierStatus[id].up }, 'Mock supplier status changed');
  res.json({ supplier: id, ...supplierStatus[id] });
});
