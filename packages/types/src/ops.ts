import { z } from "zod";

export const FeatureFlagSchema = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  enabled_globally: z.boolean().default(false),
  target_tenants: z.array(z.string().uuid()).default([]),
  percentage: z.number().int().min(0).max(100).default(0),
  metadata: z.record(z.unknown()).default({}),
  created_at: z.coerce.date(),
  updated_at: z.coerce.date(),
});

export type FeatureFlag = z.infer<typeof FeatureFlagSchema>;

export const SetFeatureFlagInputSchema = z.object({
  key: z.string().min(1).max(100),
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  enabled_globally: z.boolean().optional(),
  target_tenants: z.array(z.string().uuid()).optional(),
  percentage: z.number().int().min(0).max(100).optional(),
  metadata: z.record(z.unknown()).optional(),
});

export type SetFeatureFlagInput = z.infer<typeof SetFeatureFlagInputSchema>;

export const TenantIncidentSeveritySchema = z.enum([
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
]);
export type TenantIncidentSeverity = z.infer<
  typeof TenantIncidentSeveritySchema
>;

export const TenantIncidentStatusSchema = z.enum([
  "OPEN",
  "INVESTIGATING",
  "RESOLVED",
]);
export type TenantIncidentStatus = z.infer<typeof TenantIncidentStatusSchema>;

export const TenantIncidentSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  severity: TenantIncidentSeveritySchema,
  title: z.string().min(1).max(255),
  details: z.record(z.unknown()).default({}),
  status: TenantIncidentStatusSchema.default("OPEN"),
  correlation_id: z.string().nullable().optional(),
  created_at: z.coerce.date(),
  resolved_at: z.coerce.date().nullable().optional(),
});

export type TenantIncident = z.infer<typeof TenantIncidentSchema>;

export const RecordIncidentInputSchema = z.object({
  severity: TenantIncidentSeveritySchema,
  title: z.string().min(1).max(255),
  details: z.record(z.unknown()).optional(),
  correlation_id: z.string().optional(),
});

export type RecordIncidentInput = z.infer<typeof RecordIncidentInputSchema>;

export type OpsAccessLevel = "OBSERVE" | "SAFE_OPS" | "BREAK_GLASS";

export interface SystemHealthOverview {
  database_connected: boolean;
  redis_connected: boolean;
  active_organizations_count: number;
  total_leads_count: number;
  recent_incidents_count: number;
  uptime_seconds: number;
  release_version: string;
}

export interface DiagnosticContext {
  trace_id: string;
  correlation_id: string;
  organization_id?: string;
  operation_name: string;
  release_version: string;
  service_name: string;
  timestamp: string;
}
