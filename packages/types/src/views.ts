import { z } from 'zod';

export const FilterOperatorSchema = z.enum([
  'EQUALS',
  'NOT_EQUALS',
  'CONTAINS',
  'STARTS_WITH',
  'GREATER_THAN',
  'GREATER_THAN_OR_EQUAL',
  'LESS_THAN',
  'LESS_THAN_OR_EQUAL',
  'IN',
  'NOT_IN',
  'IS_NULL',
  'IS_NOT_NULL',
  'BETWEEN',
]);

export type FilterOperator = z.infer<typeof FilterOperatorSchema>;

export const FilterConditionSchema = z.object({
  field: z.string().min(1).max(64),
  operator: FilterOperatorSchema,
  value: z.unknown().optional(),
  is_custom: z.boolean().default(false).optional(),
});

export type FilterCondition = z.infer<typeof FilterConditionSchema>;

export type FilterGroup = {
  logical: 'AND' | 'OR';
  conditions: (FilterCondition | FilterGroup)[];
};

export type FilterAST = FilterGroup;

export const FilterGroupSchema: z.ZodType<FilterGroup> = z.lazy(() =>
  z.object({
    logical: z.enum(['AND', 'OR']),
    conditions: z.array(z.union([FilterConditionSchema, FilterGroupSchema])),
  })
);

export const SortDirectionSchema = z.enum(['asc', 'desc']);
export type SortDirection = z.infer<typeof SortDirectionSchema>;

export const SortConfigSchema = z.object({
  field: z.string().min(1).max(64),
  direction: SortDirectionSchema.default('asc'),
  is_custom: z.boolean().default(false).optional(),
  nulls: z.enum(['first', 'last']).optional(),
});

export type SortConfig = z.infer<typeof SortConfigSchema>;

export const SavedViewSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  user_id: z.string().uuid(),
  entity_type: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().nullable().optional(),
  filter_ast: FilterGroupSchema,
  sort_config: z.array(SortConfigSchema).default([]),
  columns_config: z.array(z.string()).default([]),
  is_default: z.boolean().default(false),
  is_shared: z.boolean().default(false),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type SavedView = z.infer<typeof SavedViewSchema>;

export const CreateSavedViewInputSchema = z.object({
  entity_type: z.string().min(1).max(50),
  name: z.string().min(1).max(100),
  description: z.string().optional(),
  filter_ast: FilterGroupSchema.default({ logical: 'AND', conditions: [] }),
  sort_config: z.array(SortConfigSchema).default([]),
  columns_config: z.array(z.string()).default([]),
  is_default: z.boolean().default(false),
  is_shared: z.boolean().default(false),
});

export type CreateSavedViewInput = z.infer<typeof CreateSavedViewInputSchema>;

export const UpdateSavedViewInputSchema = z.object({
  name: z.string().min(1).max(100).optional(),
  description: z.string().nullable().optional(),
  filter_ast: FilterGroupSchema.optional(),
  sort_config: z.array(SortConfigSchema).optional(),
  columns_config: z.array(z.string()).optional(),
  is_default: z.boolean().optional(),
  is_shared: z.boolean().optional(),
});

export type UpdateSavedViewInput = z.infer<typeof UpdateSavedViewInputSchema>;

export const EntityQueryOptionsSchema = z.object({
  filter_ast: FilterGroupSchema.optional(),
  sort_config: z.array(SortConfigSchema).optional(),
  search: z.string().max(100).optional(),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).default(0),
});

export type EntityQueryOptions = z.infer<typeof EntityQueryOptionsSchema>;

export interface EntityQueryResult<T> {
  data: T[];
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
}
