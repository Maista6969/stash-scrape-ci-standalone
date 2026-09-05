import { validateApiKey as getKeyLimit } from "./db.js";
import { client } from "./redis.js";

export enum keyStatus {
  invalid,
  valid,
  exhausted
}

// computed per call so the daily bucket rolls over at UTC midnight even in a
// long-lived process
const utcDay = () => new Date().getUTCDay()

const isAdminKey = (key: string): boolean =>
  !!process.env.ADMIN_KEY && key === process.env.ADMIN_KEY

// validity check only — consumes nothing; used by middleware and /api/validatekey
export const checkKeyValidity = async (key: string): Promise<boolean> => {
  if (isAdminKey(key)) return true
  const limit = await getKeyLimit(key);
  return !!limit
}

// consume one scrape credit; call only when an actual scrape is about to run,
// never for cache hits
export const consumeKeyCredit = async (key: string): Promise<keyStatus> => {
  if (isAdminKey(key)) return keyStatus.valid
  const limit = await getKeyLimit(key);
  if (!limit) return keyStatus.invalid
  if (!client) return keyStatus.valid; // if no redis, skip rate limit
  client.incr(`usecount:${key}`);
  // daily ratelimit
  const dailyKey = `ratelimit:${utcDay()}:${key}`;
  const count = await client.incr(dailyKey);
  if (count === 1) {
    client.expire(dailyKey, 86400); // 24 hour expiry
  } else if (count > limit) {
    return keyStatus.exhausted;
  }
  return keyStatus.valid;
}

export const getKeyUsage = async (key: string): Promise<{ total: number, today: number }> => {
  if (!client) return { total: 0, today: 0 };
  const [total, today] = await Promise.all([
    client.get(`usecount:${key}`),
    client.get(`ratelimit:${utcDay()}:${key}`),
  ]);
  return { total: Number(total) || 0, today: Number(today) || 0 };
}
