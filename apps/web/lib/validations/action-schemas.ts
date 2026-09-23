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

export const updateLeadStatusSchema = z
  .object({
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
    lostReasonCode: z
      .enum([
        "PRICE",
        "FINANCING",
        "UNIT_NOT_AVAILABLE",
        "LOCATION",
        "TIMING",
        "COMPETITOR",
        "NO_RESPONSE",
        "NOT_QUALIFIED",
        "DUPLICATE",
        "OTHER",
      ])
      .optional()
      .nullable(),
    lostReasonNotes: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (
      (data.newStatus === "LOST" || data.newStatus === "UNQUALIFIED") &&
      !data.lostReasonCode
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lostReasonCode"],
        message: "A reason is required when closing a lead",
      });
    }
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

export const createProjectSchema = z.object({
  name: z.string().trim().min(1, "Project name is required").max(100),
  location: z.string().trim().min(1, "Location is required").max(150),
  description: z.string().trim().max(1000).optional().or(z.literal("")),
  projectType: z
    .enum(["RESIDENTIAL", "COMMERCIAL", "MIXED_USE"])
    .default("COMMERCIAL"),
  constructionStatus: z
    .enum(["PLANNING", "UNDER_CONSTRUCTION", "READY_FOR_DELIVERY", "COMPLETED"])
    .default("UNDER_CONSTRUCTION"),
  salesStatus: z
    .enum(["UPCOMING", "SELLING", "SOLD_OUT", "RENTAL_ONLY", "ON_HOLD"])
    .default("SELLING"),
  totalUnits: z.coerce.number().min(0).default(0),
});

export const createUnitSchema = z.object({
  projectId: z.string().uuid("Invalid project ID"),
  unitNumber: z.string().trim().min(1, "Unit number is required").max(50),
  usageType: z
    .enum(["RESIDENTIAL", "COMMERCIAL", "ADMINISTRATIVE", "MEDICAL"])
    .default("COMMERCIAL"),
  unitType: z
    .enum([
      "APARTMENT",
      "DUPLEX",
      "PENTHOUSE",
      "STUDIO",
      "STANDALONE_VILLA",
      "TWIN_HOUSE",
      "TOWNHOUSE",
      "RETAIL_STORE",
      "RESTAURANT_CAFE",
      "PHARMACY",
      "KIOSK",
      "OFFICE",
      "CLINIC",
      "LABORATORY",
      "OTHER",
    ])
    .default("RETAIL_STORE"),
  modelName: z.string().trim().max(100).optional().or(z.literal("")),
  floor: z.string().trim().max(20).optional().or(z.literal("")),
  grossArea: z.coerce.number().positive("Gross area must be greater than 0"),
  price: z.coerce.number().positive("Price must be greater than 0"),
  currency: z.string().trim().default("EGP"),
});

export const reserveUnitSchema = z.object({
  leadId: z.string().uuid("Invalid lead ID"),
  unitId: z.string().uuid("Invalid unit ID"),
  depositAmount: z.coerce
    .number()
    .positive("Deposit amount must be greater than 0"),
  currency: z.string().trim().default("EGP"),
  expiresAt: z.string().min(1, "Expiration date is required"),
  paymentMethod: z.string().trim().optional().or(z.literal("")),
  notes: z.string().trim().max(1000).optional().or(z.literal("")),
});

export const addLeadInterestSchema = z.object({
  leadId: z.string().uuid("Invalid lead ID"),
  projectId: z
    .string()
    .uuid("Invalid project ID")
    .optional()
    .or(z.literal(""))
    .nullable(),
  specificUnitId: z
    .string()
    .uuid("Invalid unit ID")
    .optional()
    .or(z.literal(""))
    .nullable(),
  usageType: z
    .enum(["RESIDENTIAL", "COMMERCIAL", "ADMINISTRATIVE", "MEDICAL"])
    .optional()
    .nullable(),
  unitType: z
    .enum([
      "APARTMENT",
      "DUPLEX",
      "PENTHOUSE",
      "STUDIO",
      "STANDALONE_VILLA",
      "TWIN_HOUSE",
      "TOWNHOUSE",
      "RETAIL_STORE",
      "RESTAURANT_CAFE",
      "PHARMACY",
      "KIOSK",
      "OFFICE",
      "CLINIC",
      "LABORATORY",
      "OTHER",
    ])
    .optional()
    .nullable(),
  budgetMin: z.coerce.number().min(0).optional().nullable(),
  budgetMax: z.coerce.number().min(0).optional().nullable(),
  areaMin: z.coerce.number().positive().optional().nullable(),
  areaMax: z.coerce.number().positive().optional().nullable(),
  isPrimary: z.boolean().default(true),
  notes: z.string().trim().max(1000).optional().or(z.literal("")).nullable(),
});


export const createOpportunitySchema = z.object({
  leadId: z.string().uuid("Invalid lead ID"),
  title: z
    .string()
    .trim()
    .min(1, "Opportunity title is required")
    .max(200, "Opportunity title is too long"),
  value: z.coerce
    .number()
    .min(0, "Opportunity value cannot be negative")
    .finite("Opportunity value must be a valid number"),
  currency: z.string().trim().min(1).max(10).default("EGP"),
  expectedCloseDate: z.string().optional().or(z.literal("")).nullable(),
  assignedUserId: z
    .string()
    .uuid("Invalid assignee ID")
    .optional()
    .or(z.literal(""))
    .nullable(),
});

export const updateOpportunityStageSchema = z
  .object({
    opportunityId: z.string().uuid("Invalid Opportunity ID"),
    newStage: z.enum([
      "DISCOVERY",
      "PROPOSAL",
      "NEGOTIATION",
      "WON",
      "LOST",
    ]),
    lostReasonCode: z
      .enum([
        "PRICE",
        "FINANCING",
        "TIMING",
        "COMPETITOR",
        "NO_RESPONSE",
        "AVAILABILITY",
        "REQUIREMENTS_MISMATCH",
        "CUSTOMER_WITHDREW",
        "DUPLICATE",
        "OTHER",
      ])
      .optional()
      .nullable(),
    lostReasonNotes: z.string().trim().max(1000).optional().nullable(),
  })
  .superRefine((data, ctx) => {
    if (data.newStage === "LOST" && !data.lostReasonCode) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["lostReasonCode"],
        message: "A loss reason is required when closing an Opportunity",
      });
    }
  });

export const reopenOpportunitySchema = z.object({
  opportunityId: z.string().uuid("Invalid Opportunity ID"),
  targetStage: z.enum(["DISCOVERY", "PROPOSAL", "NEGOTIATION"]),
});
