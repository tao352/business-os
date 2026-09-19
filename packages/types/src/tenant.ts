import { z } from "zod";

export const TenantRoleSchema = z.enum([
  "OWNER",
  "ADMIN",
  "SALES_MANAGER",
  "SALESPERSON",
  "MARKETING_MANAGER",
  "MARKETING_USER",
  "OPERATIONS",
  "FINANCE",
  "READ_ONLY",
]);

export type TenantRole = z.infer<typeof TenantRoleSchema>;

export const OrganizationSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(2).max(100),
  slug: z.string().min(2).max(50),
  plan: z.enum(["STARTER", "GROWTH", "ENTERPRISE"]).default("STARTER"),
  settings: z.record(z.unknown()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Organization = z.infer<typeof OrganizationSchema>;

export const UserSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  full_name: z.string().min(2).max(100),
  avatar_url: z.string().url().optional(),
  is_active: z.boolean().default(true),
  created_at: z.string().datetime(),
});

export type User = z.infer<typeof UserSchema>;

export const OrganizationMembershipSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  user_id: z.string().uuid(),
  role: TenantRoleSchema,
  is_active: z.boolean().default(true),
  created_at: z.string().datetime(),
});

export type OrganizationMembership = z.infer<
  typeof OrganizationMembershipSchema
>;

export interface TenantContext {
  organizationId: string;
  userId: string;
  role: TenantRole;
  correlationId: string;
}
