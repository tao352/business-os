import { z } from "zod";

export const RateLimitConfigSchema = z.object({
  windowMs: z.number().int().positive().default(60000), // Default 1 minute
  maxRequests: z.number().int().positive().default(100),
  keyPrefix: z.string().default("rl"),
});

export type RateLimitConfig = z.infer<typeof RateLimitConfigSchema>;

export const RateLimitResultSchema = z.object({
  allowed: z.boolean(),
  limit: z.number().int(),
  remaining: z.number().int(),
  resetTimeMs: z.number().int(),
  current: z.number().int(),
});

export type RateLimitResult = z.infer<typeof RateLimitResultSchema>;

export const CacheOptionsSchema = z.object({
  ttlSeconds: z.number().int().positive().default(300), // 5 minutes default
  namespace: z.string().default("default"),
});

export type CacheOptions = z.infer<typeof CacheOptionsSchema>;

export interface CacheEntry<T = unknown> {
  data: T;
  cachedAt: number;
  expiresAt: number;
  organizationId: string;
}
