import { z } from "zod";

export const CustomFieldTypeSchema = z.enum([
  "TEXT",
  "LONG_TEXT",
  "NUMBER",
  "CURRENCY",
  "DATE",
  "DATETIME",
  "BOOLEAN",
  "SINGLE_SELECT",
  "MULTI_SELECT",
  "PHONE",
  "EMAIL",
  "URL",
  "RELATION",
]);

export type CustomFieldType = z.infer<typeof CustomFieldTypeSchema>;

export const ValidationRulesSchema = z.object({
  min: z.number().optional(),
  max: z.number().optional(),
  regex: z.string().optional(),
  options: z.array(z.string()).optional(),
  currency_code: z.string().default("USD").optional(),
  related_entity: z.string().optional(),
});

export type ValidationRules = z.infer<typeof ValidationRulesSchema>;

export const CustomFieldDefinitionSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  entity_type: z.enum(["lead", "unit", "project", "deal", "contact"]),
  field_key: z
    .string()
    .regex(
      /^[a-z0-9_]{2,50}$/,
      "Must be lowercase alphanumeric with underscores",
    ),
  display_name: z.string().min(2).max(100),
  field_type: CustomFieldTypeSchema,
  validation_rules: ValidationRulesSchema.default({}),
  is_required: z.boolean().default(false),
  display_order: z.number().int().default(0),
  is_active: z.boolean().default(true),
  created_at: z.string().datetime(),
});

export type CustomFieldDefinition = z.infer<typeof CustomFieldDefinitionSchema>;

export type CustomDataPayload = Record<string, unknown>;
