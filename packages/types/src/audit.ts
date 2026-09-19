import { z } from 'zod';

export const AuditActorTypeSchema = z.enum([
  'USER',
  'SMART_RULE',
  'AI_ACTION',
  'SYSTEM',
]);

export type AuditActorType = z.infer<typeof AuditActorTypeSchema>;

export const AuditActionTypeSchema = z.enum([
  'CREATE',
  'UPDATE',
  'DELETE',
  'EXPORT',
  'LOGIN',
  'RULE_EXECUTE',
  'AI_EXECUTE',
]);

export type AuditActionType = z.infer<typeof AuditActionTypeSchema>;

export const AuditLogSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  actor_id: z.string(),
  actor_type: AuditActorTypeSchema,
  action: AuditActionTypeSchema,
  entity_type: z.string(),
  entity_id: z.string(),
  before_state: z.record(z.unknown()).nullable().optional(),
  after_state: z.record(z.unknown()).nullable().optional(),
  ip_address: z.string().nullable().optional(),
  user_agent: z.string().nullable().optional(),
  created_at: z.string().datetime(),
});

export type AuditLog = z.infer<typeof AuditLogSchema>;
