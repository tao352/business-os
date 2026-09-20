import { z } from "zod";
import type { LeadStatus } from "@business-os/types";

export const createLeadSchema = z.object({
  fullName: z
    .string()
    .trim()
    .min(1, "Full name is required")
    .max(100, "Full name is too long"),
  phone: z
    .string()
    .trim()
    .min(3, "Phone number is required")
    .max(50, "Phone number is too long"),
  email: z
    .string()
    .trim()
    .email("Invalid email address")
    .optional()
    .or(z.literal(""))
    .nullable(),
  source: z.string().trim().default("MANUAL"),
  assignedUserId: z
    .string()
    .uuid("Invalid assignee ID")
    .optional()
    .or(z.literal(""))
    .nullable(),
});

export const updateLeadStatusSchema = z.object({
  leadId: z.string().uuid("Invalid lead ID"),
  newStatus: z.enum([
    "NEW",
    "CONTACTED",
    "QUALIFIED",
    "MEETING_SCHEDULED",
    "SITE_VISIT_BOOKED",
    "RESERVED",
    "CONTRACTED",
    "UNQUALIFIED",
    "LOST",
  ]) as z.ZodType<LeadStatus>,
});

export const assignLeadSchema = z.object({
  leadId: z.string().uuid("Invalid lead ID"),
  targetUserId: z.string().uuid("Invalid target agent ID"),
});

export const addNoteSchema = z.object({
  leadId: z.string().uuid("Invalid lead ID"),
  content: z
    .string()
    .trim()
    .min(1, "Note content cannot be empty")
    .max(2000, "Note content too long"),
});

export const createTaskSchema = z.object({
  leadId: z
    .string()
    .uuid("Invalid lead ID")
    .optional()
    .or(z.literal(""))
    .nullable(),
  title: z
    .string()
    .trim()
    .min(1, "Task title is required")
    .max(200, "Task title too long"),
  dueDate: z.string().min(1, "Due date is required"),
  priority: z.enum(["LOW", "MEDIUM", "HIGH", "URGENT"]).default("MEDIUM"),
  description: z.string().trim().max(1000).optional().nullable(),
});

export const completeTaskSchema = z.object({
  taskId: z.string().uuid("Invalid task ID"),
  leadId: z.string().uuid("Invalid lead ID").optional().nullable(),
});

export const switchOrgSchema = z.object({
  targetOrganizationId: z
    .string()
    .uuid("Target organization ID must be a valid UUID"),
});
