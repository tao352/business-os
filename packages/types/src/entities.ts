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

export const ProjectSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  name: z.string().min(2).max(150),
  location: z.string().min(2).max(255),
  description: z.string().optional(),
  total_units: z.number().int().default(0),
  custom_data: z.record(z.unknown()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Project = z.infer<typeof ProjectSchema>;

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
  unit_type: z.string().min(2).max(50), // e.g. Apartment, Villa, Duplex, Retail, Penthouse
  gross_area: z.number().positive(),
  price: z.number().positive(),
  currency: z.string().default('EGP'),
  status: UnitStatusSchema.default('AVAILABLE'),
  payment_plan_template: z.record(z.unknown()).default({}),
  custom_data: z.record(z.unknown()).default({}),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Unit = z.infer<typeof UnitSchema>;

export const PaymentFrequencySchema = z.enum([
  'MONTHLY',
  'QUARTERLY',
  'SEMI_ANNUAL',
  'ANNUAL',
]);

export type PaymentFrequency = z.infer<typeof PaymentFrequencySchema>;

export const InstallmentTypeSchema = z.enum([
  'DOWN_PAYMENT',
  'INSTALLMENT',
  'DELIVERY',
  'MAINTENANCE',
]);

export type InstallmentType = z.infer<typeof InstallmentTypeSchema>;

export const InstallmentSchema = z.object({
  installmentNumber: z.number().int(),
  dueDate: z.string(), // YYYY-MM-DD
  amount: z.number().positive(),
  type: InstallmentTypeSchema,
  percentage: z.number(),
});

export type Installment = z.infer<typeof InstallmentSchema>;

export const PaymentPlanInputSchema = z.object({
  totalPrice: z.number().positive(),
  downPaymentPercent: z.number().min(0).max(100),
  installmentsYears: z.number().min(0.5).max(30),
  frequency: PaymentFrequencySchema,
  deliveryPaymentPercent: z.number().min(0).max(100).default(0).optional(),
  deliveryDate: z.string().optional(),
  startDate: z.string(), // YYYY-MM-DD
  maintenancePercent: z.number().min(0).max(50).default(0).optional(),
});

export type PaymentPlanInput = z.infer<typeof PaymentPlanInputSchema>;

export interface PaymentScheduleResult {
  totalPrice: number;
  downPaymentAmount: number;
  installmentsCount: number;
  installmentAmount: number;
  deliveryAmount: number;
  maintenanceAmount: number;
  schedule: Installment[];
}

export const VisitStatusSchema = z.enum([
  'SCHEDULED',
  'COMPLETED',
  'CANCELLED',
  'NO_SHOW',
]);

export type VisitStatus = z.infer<typeof VisitStatusSchema>;

export const VisitSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  project_id: z.string().uuid(),
  scheduled_by_user_id: z.string().uuid(),
  assigned_agent_id: z.string().uuid().nullable().optional(),
  scheduled_at: z.string().datetime(),
  status: VisitStatusSchema.default('SCHEDULED'),
  notes: z.string().nullable().optional(),
  feedback: z.string().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Visit = z.infer<typeof VisitSchema>;

export const ReservationStatusSchema = z.enum([
  'PENDING',
  'CONFIRMED',
  'CANCELLED',
  'EXPIRED',
  'CONVERTED',
]);

export type ReservationStatus = z.infer<typeof ReservationStatusSchema>;

export const ReservationSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  lead_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  reserved_by_user_id: z.string().uuid(),
  deposit_amount: z.number().nonnegative(),
  currency: z.string().default('EGP'),
  status: ReservationStatusSchema.default('CONFIRMED'),
  expires_at: z.string().datetime(),
  payment_method: z.string().nullable().optional(),
  notes: z.string().nullable().optional(),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Reservation = z.infer<typeof ReservationSchema>;

export const ContractStatusSchema = z.enum([
  'DRAFT',
  'SIGNED',
  'ACTIVE',
  'TERMINATED',
  'COMPLETED',
]);

export type ContractStatus = z.infer<typeof ContractStatusSchema>;

export const ContractSchema = z.object({
  id: z.string().uuid(),
  organization_id: z.string().uuid(),
  reservation_id: z.string().uuid().nullable().optional(),
  lead_id: z.string().uuid(),
  unit_id: z.string().uuid(),
  contract_number: z.string().min(2).max(100),
  contract_value: z.number().positive(),
  currency: z.string().default('EGP'),
  payment_schedule: z.array(InstallmentSchema).default([]),
  signed_at: z.string().datetime().nullable().optional(),
  status: ContractStatusSchema.default('DRAFT'),
  created_at: z.string().datetime(),
  updated_at: z.string().datetime(),
});

export type Contract = z.infer<typeof ContractSchema>;

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
