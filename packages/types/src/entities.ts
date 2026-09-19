import { z } from 'zod';

export const LeadStatusSchema = z.enum([
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'MEETING_SCHEDULED',
  'SITE_VISIT_BOOKED',
  'RESERVED',
  'CONTRACTED',
  'UNQUALIFIED',
  'LOST',
]);

export type LeadStatus = z.infer<typeof LeadStatusSchema>;

export const LeadSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  full_name: z.string().min(2).max(150),
  phone: z.string().min(5).max(30),
  email: z.string().email().nullable().optional(),
  status: LeadStatusSchema.default('NEW'),
  assigned_user_id: z.string().uuid().nullable().optional(),
  campaign_id: z.string().nullable().optional(),
  source: z.string().default('MANUAL'),
  custom_data: z.record(z.unknown()).default({}),
  last_contacted_at: z.string().datetime().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Lead = z.infer<typeof LeadSchema>;

export const UnitStatusSchema = z.enum([
  'AVAILABLE',
  'RESERVED',
  'CONTRACTED',
  'BLOCKED',
]);

export type UnitStatus = z.infer<typeof UnitStatusSchema>;

export const UnitSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  project_id: z.string().uuid(),
  unit_number: z.string().min(1).max(50),
  unit_type: z.string().min(2).max(50), // e.g. Apartment, Villa, Duplex, Retail
  gross_area: z.number().positive(),
  price: z.number().positive(),
  currency: z.string().default('USD'),
  status: UnitStatusSchema.default('AVAILABLE'),
  payment_plan_template: z.record(z.unknown()).default({}),
  custom_data: z.record(z.unknown()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Unit = z.infer<typeof UnitSchema>;

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string().min(2).max(150),
  location: z.string().min(2).max(255),
  description: z.string().optional(),
  total_units: z.number().int().default(0),
  custom_data: z.record(z.unknown()).default({}),
  created_at: z.string().datetime(),
});

export type Project = z.infer<typeof ProjectSchema>;

export const TaskSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  lead_id: z.string().uuid().nullable().optional(),
  assigned_user_id: z.string().uuid(),
  title: z.string().min(2).max(255),
  due_date: z.string().datetime(),
  is_completed: z.boolean().default(false),
  created_at: z.string().datetime(),
});

export type Task = z.infer<typeof TaskSchema>;
