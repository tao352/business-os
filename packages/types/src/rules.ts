import { z } from "zod";

export const TriggerTypeSchema = z.enum([
  "lead.created",
  "lead.status_changed",
  "lead.inactivity_exceeded",
  "task.due",
  "visit.scheduled",
  "reservation.created",
  "reservation.expiring",
]);

export type TriggerType = z.infer<typeof TriggerTypeSchema>;

export const ConditionOperatorSchema = z.enum([
  "equals",
  "not_equals",
  "greater_than",
  "less_than",
  "contains",
  "is_empty",
  "is_not_empty",
]);

export type ConditionOperator = z.infer<typeof ConditionOperatorSchema>;

export const RuleConditionSchema = z.object({
  field: z.string(),
  operator: ConditionOperatorSchema,
  value: z.unknown(),
});

export type RuleCondition = z.infer<typeof RuleConditionSchema>;

export const ActionTypeSchema = z.enum([
  "lead.assign_round_robin",
  "lead.assign_specific_user",
  "lead.change_status",
  "task.create",
  "notification.internal",
  "whatsapp.send_template",
]);

export type ActionType = z.infer<typeof ActionTypeSchema>;

export const RuleActionSchema = z.object({
  action_type: ActionTypeSchema,
  params: z.record(z.unknown()),
  delay_seconds: z.number().int().nonnegative().default(0),
});

export type RuleAction = z.infer<typeof RuleActionSchema>;

export const SmartRuleSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string().min(3).max(150),
  description: z.string().optional(),
  trigger_type: TriggerTypeSchema,
  conditions: z.array(RuleConditionSchema).default([]),
  actions: z.array(RuleActionSchema).min(1),
  is_active: z.boolean().default(true),
  version: z.number().int().default(1),
  execution_count: z.number().int().default(0),
  last_triggered_at: z.string().datetime().optional().nullable(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type SmartRule = z.infer<typeof SmartRuleSchema>;

export interface CreateRuleInput {
  name: string;
  description?: string;
  trigger_type: TriggerType;
  conditions?: RuleCondition[];
  actions: RuleAction[];
  is_active?: boolean;
}

export interface UpdateRuleInput {
  name?: string;
  description?: string;
  trigger_type?: TriggerType;
  conditions?: RuleCondition[];
  actions?: RuleAction[];
  is_active?: boolean;
}

export interface RuleExecutionRecord {
  id: string;
  organizationId: string;
  ruleId: string;
  triggerType: string;
  entityType: string;
  entityId: string;
  actionsExecuted: Array<{
    action_type: string;
    status: string;
    result?: unknown;
  }>;
  status: "SUCCESS" | "FAILED" | "SKIPPED";
  errorMessage?: string | null;
  executionDurationMs: number;
  hopDepth: number;
  createdAt: Date | string;
}

export interface DryRunResult {
  ruleName: string;
  triggerType: TriggerType;
  totalSampled: number;
  matchedCount: number;
  matchingEntityIds: string[];
  simulatedActions: Array<{
    action_type: ActionType;
    targetCount: number;
    description: string;
  }>;
}

export interface ScheduledJobRecord {
  id: string;
  organizationId: string;
  jobType: string;
  entitiesEvaluated: number;
  rulesTriggered: number;
  status: "COMPLETED" | "FAILED" | "PARTIAL";
  errorMessage?: string | null;
  startedAt: Date | string;
  completedAt?: Date | string | null;
}

export interface TimeTriggerEvaluationResult {
  jobType: string;
  entitiesEvaluated: number;
  rulesTriggered: number;
  details: Array<{ entityId: string; rulesFiredCount: number }>;
}
