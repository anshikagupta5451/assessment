import { Router, type NextFunction, type Request, type Response } from 'express';
import { logger } from '../logger';
import { findHotelOffersByPrice, isCityCached } from '../redis/hotelStore';
import { runHotelOffersWorkflow } from '../temporal/client';
import type { HotelOffer, HotelSearchResult } from '../types';
import { HttpError } from '../utils/httpError';

export const hotelsRouter = Router();

const parsePrice = (value: unknown, field: string): number | undefined => {
  if (value === undefined || value === '') return undefined;
  const n = Number(value);
  if (typeof value !== 'string' || !Number.isFinite(n) || n < 0) {
    throw new HttpError(400, `${field} must be a non-negative number`);
  }
  return n;
};

const supplierHeader = (result: HotelSearchResult): string =>
  result.suppliers.map((s) => `${s.supplier}=${s.ok ? 'ok' : 'down'}`).join(';');

/**
 * GET /api/hotels?city=delhi[&minPrice=..][&maxPrice=..]
 *
 * Without a price range: runs the Temporal workflow and returns the fresh de-duplicated list.
 * With a price range: filters inside Redis. If the city isn't cached yet, the workflow runs
 * first (which populates Redis) and the filter is then applied in Redis.
 */
hotelsRouter.get('/', async (req: Request, res: Response, next: NextFunction) => {
  try {
    const city = typeof req.query.city === 'string' ? req.query.city.trim().toLowerCase() : '';
    if (!city) throw new HttpError(400, 'Query parameter "city" is required');

    const minPrice = parsePrice(req.query.minPrice, 'minPrice');
    const maxPrice = parsePrice(req.query.maxPrice, 'maxPrice');
    if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
      throw new HttpError(400, 'minPrice cannot be greater than maxPrice');
    }
    const hasFilter = minPrice !== undefined || maxPrice !== undefined;

    if (!hasFilter) {
      const result = await runHotelOffersWorkflow(city);
      res.setHeader('X-Suppliers-Status', supplierHeader(result));
      res.setHeader('X-Data-Source', 'temporal-workflow');
      res.json(result.hotels);
      return;
    }

    let source = 'redis-cache';
    let workflowResult: HotelSearchResult | undefined;
    if (!(await safeIsCached(city))) {
      workflowResult = await runHotelOffersWorkflow(city);
      res.setHeader('X-Suppliers-Status', supplierHeader(workflowResult));
      source = 'temporal-workflow+redis';
    }

    let hotels: HotelOffer[];
    try {
      hotels = await findHotelOffersByPrice(city, minPrice, maxPrice);
    } catch (err) {
      if (!workflowResult) throw err;
      // Redis is unavailable but we have fresh data: degrade gracefully to an in-memory filter.
      logger.warn({ err: (err as Error).message }, 'Redis filter failed, falling back to in-memory filter');
      hotels = workflowResult.hotels.filter(
        (h) => (minPrice === undefined || h.price >= minPrice) && (maxPrice === undefined || h.price <= maxPrice),
      );
      source = 'temporal-workflow (redis unavailable)';
    }

    res.setHeader('X-Data-Source', source);
    res.json(hotels);
  } catch (err) {
    next(err);
  }
});

async function safeIsCached(city: string): Promise<boolean> {
  try {
    return await isCityCached(city);
  } catch (err) {
    logger.warn({ err: (err as Error).message }, 'Redis cache lookup failed, running workflow');
    return false;
  }
}
