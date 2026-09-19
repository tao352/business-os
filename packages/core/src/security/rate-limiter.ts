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

// Atomic sliding-window Lua script for Redis
const SLIDING_WINDOW_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local window = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local clearBefore = now - window
local member = ARGV[4]

redis.call('ZREMRANGEBYSCORE', key, 0, clearBefore)
local current = redis.call('ZCARD', key)

if current < limit then
  redis.call('ZADD', key, now, member)
  redis.call('PEXPIRE', key, window)
  return { 1, current + 1 }
else
  return { 0, current }
end
`;

export function getRedisClient(): Redis | null {
  if (redisInitialized) return redisClient;

  redisInitialized = true;
  const redisUrl = process.env.REDIS_URL || "redis://localhost:6379";

  try {
    const client = new Redis(redisUrl, {
      maxRetriesPerRequest: 1,
      connectTimeout: 1000,
      retryStrategy: () => null,
      lazyConnect: true,
    });

    client.on("error", (err: Error) => {
      logger.warn(
        { error: err.message },
        "Redis connection error in rate limiter, using fallback",
      );
    });

    redisClient = client;
  } catch (err) {
    logger.warn(
      { error: err instanceof Error ? err.message : String(err) },
      "Failed to initialize Redis client, using memory store",
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
 * Checks if a key represents a high-sensitivity authentication or security endpoint.
 */
function isSensitiveSecurityKey(key: string): boolean {
  return (
    key.includes("auth:") ||
    key.includes("login:") ||
    key.includes("password") ||
    key.includes("security:")
  );
}

/**
 * Consumes 1 request token against the sliding window atomically.
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

  // 1. Atomic Redis execution via Lua script
  if (client && client.status === "ready") {
    try {
      const member = `${now}-${Math.random().toString(36).substring(2, 9)}`;
      const result = (await client.eval(
        SLIDING_WINDOW_LUA,
        1,
        fullKey,
        now,
        config.windowMs,
        config.maxRequests,
        member,
      )) as [number, number];

      const allowed = result[0] === 1;
      const current = result[1];

      return {
        allowed,
        limit: config.maxRequests,
        remaining: Math.max(0, config.maxRequests - current),
        resetTimeMs: now + config.windowMs,
        current,
      };
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Redis error in consumeRateLimit, executing fallback policy",
      );
    }
  }

  // 2. Degraded in-memory fallback policy (H0-19)
  // For sensitive security/login endpoints, enforce strict tightened limits during Redis partition
  const effectiveMax = isSensitiveSecurityKey(fullKey)
    ? Math.max(1, Math.floor(config.maxRequests * 0.5))
    : config.maxRequests;

  let timestamps = inMemoryStore.get(fullKey) || [];
  timestamps = timestamps.filter((t) => t > windowStart);

  if (timestamps.length >= effectiveMax) {
    inMemoryStore.set(fullKey, timestamps);
    return {
      allowed: false,
      limit: effectiveMax,
      remaining: 0,
      resetTimeMs: (timestamps[0] ?? now) + config.windowMs,
      current: timestamps.length,
    };
  }

  timestamps.push(now);
  inMemoryStore.set(fullKey, timestamps);

  return {
    allowed: true,
    limit: effectiveMax,
    remaining: effectiveMax - timestamps.length,
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
 * Clears all rate limits using non-blocking SCAN instead of KEYS (H0-20).
 */
export async function clearAllRateLimits(): Promise<void> {
  inMemoryStore.clear();

  const client = getRedisClient();
  if (client && client.status === "ready") {
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          "MATCH",
          `${DEFAULT_CONFIG.keyPrefix}:*`,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          await client.del(...keys);
        }
      } while (cursor !== "0");
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Redis error in clearAllRateLimits",
      );
    }
  }
}
