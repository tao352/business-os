import { logger } from "@business-os/logger";
import type { TenantContext, CacheEntry } from "@business-os/types";
import { getRedisClient } from "../security/rate-limiter.js";

const DEFAULT_TTL_SECONDS = 300; // 5 minutes
const DEFAULT_NAMESPACE = "default";

// In-memory tenant cache store for fallback and isolated test environments
const inMemoryCache = new Map<string, CacheEntry<unknown>>();

/**
 * Builds a strictly tenant-isolated cache key.
 * Invariant 3.1: Keyspace MUST always start with tenant:{organizationId}:
 */
export function buildTenantCacheKey(
  organizationId: string,
  key: string,
  namespace = DEFAULT_NAMESPACE,
): string {
  if (!organizationId) {
    throw new Error(
      "Cannot build tenant cache key without valid organizationId",
    );
  }
  return `tenant:${organizationId}:${namespace}:${key}`;
}

/**
 * Gets a cached item for the calling tenant.
 * Guarantees zero cross-tenant key leakage.
 */
export async function getTenantCache<T = unknown>(
  context: TenantContext,
  key: string,
  namespace = DEFAULT_NAMESPACE,
): Promise<T | null> {
  const fullKey = buildTenantCacheKey(context.organizationId, key, namespace);
  const client = getRedisClient();

  if (client && client.status === "ready") {
    try {
      const raw = await client.get(fullKey);
      if (raw) {
        const entry = JSON.parse(raw) as CacheEntry<T>;
        // Cryptographic/logical tenant verification
        if (entry.organizationId === context.organizationId) {
          return entry.data;
        }
        logger.error(
          {
            requestedOrgId: context.organizationId,
            cachedOrgId: entry.organizationId,
          },
          "CRITICAL: Detected cross-tenant cache contamination attempt!",
        );
        return null;
      }
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Redis error in getTenantCache, falling back to memory",
      );
    }
  }

  const memoryEntry = inMemoryCache.get(fullKey);
  if (!memoryEntry) return null;

  if (Date.now() > memoryEntry.expiresAt) {
    inMemoryCache.delete(fullKey);
    return null;
  }

  if (memoryEntry.organizationId !== context.organizationId) {
    logger.error(
      {
        requestedOrgId: context.organizationId,
        cachedOrgId: memoryEntry.organizationId,
      },
      "CRITICAL: In-memory cross-tenant cache contamination detected!",
    );
    return null;
  }

  return memoryEntry.data as T;
}

/**
 * Sets a cached item strictly within the tenant's isolated keyspace.
 */
export async function setTenantCache<T = unknown>(
  context: TenantContext,
  key: string,
  value: T,
  ttlSeconds = DEFAULT_TTL_SECONDS,
  namespace = DEFAULT_NAMESPACE,
): Promise<void> {
  const fullKey = buildTenantCacheKey(context.organizationId, key, namespace);
  const now = Date.now();
  const entry: CacheEntry<T> = {
    data: value,
    cachedAt: now,
    expiresAt: now + ttlSeconds * 1000,
    organizationId: context.organizationId,
  };

  const client = getRedisClient();
  if (client && client.status === "ready") {
    try {
      await client.setex(fullKey, ttlSeconds, JSON.stringify(entry));
      return;
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Redis error in setTenantCache, falling back to memory",
      );
    }
  }

  inMemoryCache.set(fullKey, entry);
}

/**
 * Cache-aside wrapper: Retrieves from cache if present, otherwise executes fetcher and caches result.
 */
export async function withTenantCache<T>(
  context: TenantContext,
  key: string,
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  namespace = DEFAULT_NAMESPACE,
): Promise<T> {
  const cached = await getTenantCache<T>(context, key, namespace);
  if (cached !== null && cached !== undefined) {
    return cached;
  }

  const freshData = await fetcher();
  await setTenantCache<T>(context, key, freshData, ttlSeconds, namespace);
  return freshData;
}

/**
 * Deletes a single key strictly for the calling tenant.
 */
export async function deleteTenantCache(
  context: TenantContext,
  key: string,
  namespace = DEFAULT_NAMESPACE,
): Promise<boolean> {
  const fullKey = buildTenantCacheKey(context.organizationId, key, namespace);
  const client = getRedisClient();

  if (client && client.status === "ready") {
    try {
      const deleted = await client.del(fullKey);
      return deleted > 0;
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Redis error in deleteTenantCache, falling back to memory",
      );
    }
  }

  return inMemoryCache.delete(fullKey);
}

/**
 * Invalidates keys matching a pattern strictly within the calling tenant's keyspace.
 * Invariant 3.1: Cannot invalidate or scan keys of other organizations.
 */
export async function invalidateTenantCache(
  context: TenantContext,
  pattern = "*",
  namespace = DEFAULT_NAMESPACE,
): Promise<number> {
  const prefix = `tenant:${context.organizationId}:${namespace}:`;
  const searchPattern = `${prefix}${pattern}`;
  let count = 0;

  const client = getRedisClient();
  if (client && client.status === "ready") {
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          "MATCH",
          searchPattern,
          "COUNT",
          100,
        );
        cursor = nextCursor;
        if (keys.length > 0) {
          const safeKeys = keys.filter((k: string) => k.startsWith(prefix));
          if (safeKeys.length > 0) {
            count += await client.del(...safeKeys);
          }
        }
      } while (cursor !== "0");
      return count;
    } catch (err) {
      logger.warn(
        { error: err instanceof Error ? err.message : String(err) },
        "Redis error in invalidateTenantCache, falling back to memory",
      );
    }
  }

  for (const [key] of inMemoryCache.entries()) {
    if (key.startsWith(prefix)) {
      const suffix = key.slice(prefix.length);
      const isMatch =
        pattern === "*" ||
        new RegExp(
          "^" +
            pattern
              .replace(/[.+^${}()|[\]\\]/g, "\\$&")
              .replace(/\*/g, ".*")
              .replace(/\?/g, ".") +
            "$",
        ).test(suffix);

      if (isMatch) {
        inMemoryCache.delete(key);
        count++;
      }
    }
  }

  return count;
}

/**
 * Clears entire cache using non-blocking SCAN (used for test resets).
 */
export async function clearAllTenantCaches(): Promise<void> {
  inMemoryCache.clear();

  const client = getRedisClient();
  if (client && client.status === "ready") {
    try {
      let cursor = "0";
      do {
        const [nextCursor, keys] = await client.scan(
          cursor,
          "MATCH",
          "tenant:*",
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
        "Redis error in clearAllTenantCaches",
      );
    }
  }
}
