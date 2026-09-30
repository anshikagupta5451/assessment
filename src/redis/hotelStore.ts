import Redis from 'ioredis';
import { config } from '../config';
import { logger } from '../logger';
import type { HotelOffer } from '../types';

/**
 * Redis layout per city:
 *   hotels:{city}:byPrice  ZSET  member = hotel name, score = price   (range index for filtering)
 *   hotels:{city}:offers   HASH  hotel name -> JSON(HotelOffer)
 *   hotels:{city}:meta     STRING  ISO timestamp of the last refresh (marks the city as cached, even if empty)
 */
const keys = (city: string) => {
  const c = city.trim().toLowerCase();
  return {
    byPrice: `hotels:${c}:byPrice`,
    offers: `hotels:${c}:offers`,
    meta: `hotels:${c}:meta`,
  };
};

// Range query + payload lookup executed atomically inside Redis.
const FILTER_BY_PRICE_LUA = `
local names = redis.call('ZRANGEBYSCORE', KEYS[1], ARGV[1], ARGV[2])
if #names == 0 then return {} end
return redis.call('HMGET', KEYS[2], unpack(names))
`;

type RedisWithCommands = Redis & {
  filterByPrice(zsetKey: string, hashKey: string, min: string, max: string): Promise<(string | null)[]>;
};

let client: RedisWithCommands | undefined;

export function getRedis(): RedisWithCommands {
  if (!client) {
    const redis = new Redis(config.redis.url, {
      maxRetriesPerRequest: 2,
      retryStrategy: (times) => Math.min(times * 200, 2000),
    });
    redis.defineCommand('filterByPrice', { numberOfKeys: 2, lua: FILTER_BY_PRICE_LUA });
    redis.on('error', (err) => logger.error({ err: err.message }, 'Redis error'));
    redis.on('ready', () => logger.info('Redis connected'));
    client = redis as RedisWithCommands;
  }
  return client;
}

export async function closeRedis(): Promise<void> {
  if (client) {
    await client.quit().catch(() => client?.disconnect());
    client = undefined;
  }
}

/** Replaces the cached de-duplicated list for a city (atomic MULTI/EXEC). */
export async function saveHotelOffers(city: string, hotels: HotelOffer[]): Promise<void> {
  const k = keys(city);
  const ttl = config.redis.ttlSeconds;
  const tx = getRedis().multi().del(k.byPrice, k.offers);

  if (hotels.length > 0) {
    tx.zadd(k.byPrice, ...hotels.flatMap((h) => [h.price, h.name]));
    tx.hset(k.offers, Object.fromEntries(hotels.map((h) => [h.name, JSON.stringify(h)])));
    tx.expire(k.byPrice, ttl).expire(k.offers, ttl);
  }
  tx.set(k.meta, new Date().toISOString(), 'EX', ttl);

  const results = await tx.exec();
  const failed = results?.find(([err]) => err);
  if (!results || failed) throw failed?.[0] ?? new Error('Redis transaction aborted');
}

export async function isCityCached(city: string): Promise<boolean> {
  return (await getRedis().exists(keys(city).meta)) === 1;
}

/** Price range filter evaluated inside Redis (ZRANGEBYSCORE + HMGET via Lua). Inclusive bounds. */
export async function findHotelOffersByPrice(
  city: string,
  minPrice?: number,
  maxPrice?: number,
): Promise<HotelOffer[]> {
  const k = keys(city);
  const min = minPrice === undefined ? '-inf' : String(minPrice);
  const max = maxPrice === undefined ? '+inf' : String(maxPrice);
  const raw = await getRedis().filterByPrice(k.byPrice, k.offers, min, max);
  return raw.filter((v): v is string => v !== null).map((v) => JSON.parse(v) as HotelOffer);
}
