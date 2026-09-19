import { Redis } from "ioredis";
import { logger } from "@business-os/logger";
import type { RateLimitConfig, RateLimitResult } from "@business-os/types";

const DEFAULT_CONFIG: RateLimitConfig = {
  windowMs: 60000, // 1 minute
  maxRequests: 100,
  keyPrefix: "rl",
};

// In-memory sliding-window store for fallback and unit testing
const inMemoryStore = new Map<string, number[]>();

let redisClient: Redis | null = null;
let redisInitialized = false;

export function getRedisClient(): Redis | null {
  if (redisInitialized) return redisClient;

  redisInitialized = true;
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      retryStrategy: () => null, // Don't hang indefinitely on test/offline
      lazyConnect: true,
    });

    client.on("error", (err: Error) => {
      logger.warn(
        { error: err.message },
        "Redis rate limiter connection error, falling back to in-memory store",
      );
    });

    redisClient = client;
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "Failed to initialize Redis client, using in-memory store",
    );
    redisClient = null;
  }

  return redisClient;
}

export function setRedisClient(client: Redis | null): void {
  redisClient = client;
  redisInitialized = true;
}

/**
 * Consumes 1 request token against the sliding window.
 */
export async function consumeRateLimit(
  key: string,
  customConfig?: Partial<RateLimitConfig>,
): Promise<RateLimitResult> {
  const config: RateLimitConfig = { ...DEFAULT_CONFIG, ...customConfig };
  const fullKey = `${config.keyPrefix}:${key}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  const client = getRedisClient();

  if (client && client.status === "ready") {
    try {
      const member = `${now}-${Math.random().toString(36).substring(2, 9)}`;
      const pipeline = client.pipeline();
      pipeline.zremrangebyscore(fullKey, 0, windowStart);
      pipeline.zcard(fullKey);
      pipeline.zadd(fullKey, now, member);
      pipeline.pexpire(fullKey, config.windowMs);

      const results = await pipeline.exec();
      const currentCount = (results?.[1]?.[1] as number) ?? 0;

      if (currentCount >= config.maxRequests) {
        // Rollback added member since it exceeds limit
        await client.zrem(fullKey, member);
        return {
          allowed: false,
          limit: config.maxRequests,
          remaining: 0,
          resetTimeMs: now + config.windowMs,
          current: currentCount,
        };
      }

      return {
        allowed: true,
        limit: config.maxRequests,
        remaining: Math.max(0, config.maxRequests - (currentCount + 1)),
        resetTimeMs: now + config.windowMs,
        current: currentCount + 1,
      };
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Redis error in consumeRateLimit, falling back to memory",
      );
    }
  }

  // In-memory sliding window implementation
  let timestamps = inMemoryStore.get(fullKey) || [];
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= config.maxRequests) {
    inMemoryStore.set(fullKey, timestamps);
    return {
      allowed: false,
      limit: config.maxRequests,
      remaining: 0,
      resetTimeMs: (timestamps[0] ?? now) + config.windowMs,
      current: timestamps.length,
    };
  }

  timestamps.push(now);
  inMemoryStore.set(fullKey, timestamps);

  return {
    allowed: true,
    limit: config.maxRequests,
    remaining: config.maxRequests - timestamps.length,
    resetTimeMs: timestamps[0]! + config.windowMs,
    current: timestamps.length,
  };
}

/**
 * Checks current rate limit without consuming a token.
 */
export async function checkRateLimit(
  key: string,
  customConfig?: Partial<RateLimitConfig>,
): Promise<RateLimitResult> {
  const config: RateLimitConfig = { ...DEFAULT_CONFIG, ...customConfig };
  const fullKey = `${config.keyPrefix}:${key}`;
  const now = Date.now();
  const windowStart = now - config.windowMs;

  const client = getRedisClient();

  if (client && client.status === "ready") {
    try {
      await client.zremrangebyscore(fullKey, 0, windowStart);
      const count = await client.zcard(fullKey);
      return {
        allowed: count < config.maxRequests,
        limit: config.maxRequests,
        remaining: Math.max(0, config.maxRequests - count),
        resetTimeMs: now + config.windowMs,
        current: count,
      };
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Redis error in checkRateLimit, falling back to memory",
      );
    }
  }

  let timestamps = inMemoryStore.get(fullKey) || [];
  timestamps = timestamps.filter((t) => t > windowStart);
  inMemoryStore.set(fullKey, timestamps);

  return {
    allowed: timestamps.length < config.maxRequests,
    limit: config.maxRequests,
    remaining: Math.max(0, config.maxRequests - timestamps.length),
    resetTimeMs: (timestamps[0] ?? now) + config.windowMs,
    current: timestamps.length,
  };
}

/**
 * Resets rate limit for a specific key.
 */
export async function resetRateLimit(
  key: string,
  prefix = DEFAULT_CONFIG.keyPrefix,
): Promise<void> {
  const fullKey = `${prefix}:${key}`;
  inMemoryStore.delete(fullKey);

  const client = getRedisClient();
  if (client && client.status === "ready") {
    try {
      await client.del(fullKey);
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Redis error in resetRateLimit",
      );
    }
  }
}

/**
 * Clears all rate limits (primarily used for test cleanup).
 */
export async function clearAllRateLimits(): Promise<void> {
  inMemoryStore.clear();

  const client = getRedisClient();
  if (client && client.status === "ready") {
    try {
      const keys = await client.keys(`${DEFAULT_CONFIG.keyPrefix}:*`);
      if (keys.length > 0) {
        await client.del(...keys);
      }
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Redis error in clearAllRateLimits",
      );
    }
  }
}
