import { validateApiKey as getKeyLimit } from "./db.js";
import { client } from "./redis.js";

export enum keyStatus {
  invalid,
  valid,
  exhausted
}

const day = new Date().getUTCDay()

export const checkKeyLimit = async (key: string): Promise<keyStatus> => {
  // check if matches admin key
  if (key == process.env.ADMIN_KEY) return keyStatus.valid
  const limit = await getKeyLimit(key);
  // add to redis counter
  const hasKey = !!limit
  if (hasKey) {
    if (!client) return keyStatus.valid; // if no redis, skip rate limit
    client.incr(`usecount:${key}`);
    // daily ratelimit
    const dailyKey = `ratelimit:${day}:${key}`;
    const count = await client.incr(dailyKey);
    if (count === 1) {
      client.expire(dailyKey, 86400); // 24 hour expiry
    } else if (count > limit) {
      return keyStatus.exhausted;
    }
    return keyStatus.valid;
  }
  return keyStatus.invalid;
}

export const checkKeyValidity = async (key: string): Promise<boolean> => {
  const limit = await getKeyLimit(key);
  return !!limit
}

export const getKeyUsage = async (key: string): Promise<{ total: number, today: number }> => {
  if (!client) return { total: 0, today: 0 };
  const [total, today] = await Promise.all([
    client.get(`usecount:${key}`),
    client.get(`ratelimit:${day}:${key}`),
  ]);
  return { total: Number(total) || 0, today: Number(today) || 0 };
}