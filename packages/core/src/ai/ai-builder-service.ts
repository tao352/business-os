import crypto from "node:crypto";
import { logger } from "@business-os/logger";
import type {
  TenantContext,
  ChangeProposal,
  ApplyProposalResult,
  CreateRuleInput,
  CreateSavedViewInput,
  CustomFieldType,
} from "@business-os/types";
import {
  createCustomFieldDefinition,
  type CreateCustomFieldInput,
} from "../metadata/custom-fields-service.js";
import { createRule } from "../rules/rules-service.js";
import { createSavedView } from "../views/views-service.js";
import { assertPermission } from "../permissions/checker.js";

const ARABIC_KEY_MAP: Record<string, string> = {
  طريقة_السداد: "payment_method",
  نظام_السداد: "payment_plan",
  نوع_التشطيب: "finishing_type",
  التشطيب: "finishing_type",
  الميزانية: "budget",
  رقم_الهاتف_البديل: "secondary_phone",
  الهاتف_البديل: "secondary_phone",
  المساحة: "area_sqm",
  الدور: "floor_number",
};

function generateSafeFieldKey(label: string): string {
  const normalized = label.trim().toLowerCase().replace(/\s+/g, "_");
  for (const [ar, key] of Object.entries(ARABIC_KEY_MAP)) {
    if (normalized.includes(ar)) return key;
  }
  const asciiKey = label
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  if (asciiKey.length >= 2 && asciiKey.length <= 50) return asciiKey;
  const hash = crypto
    .createHash("md5")
    .update(label)
    .digest("hex")
    .substring(0, 8);
  return `cf_${hash}`;
}

function extractName(
  prompt: string,
  defaultName: string,
  stopWords?: RegExp,
): string {
  const quoted = prompt.match(
    /(?:اسمه|اسمها|بعنوان|called|named)\s+["']([^"']+)["']/i,
  );
  if (quoted?.[1]) return quoted[1].trim();
  const unquoted = prompt.match(
    /(?:اسمه|اسمها|بعنوان|called|named)\s+([^\s,]+(?:\s+[^\s,]+){0,4})/i,
  );
  if (unquoted?.[1]) {
    let name = unquoted[1].trim();
    if (stopWords) {
      name = name.split(stopWords)[0]?.trim() || defaultName;
    }
    return name || defaultName;
  }
  return defaultName;
}

function makeProposal(
  id: string,
  intentType: ChangeProposal["intentType"],
  title: string,
  description: string,
  entity: string,
  payload: Record<string, unknown>,
): ChangeProposal {
  return {
    id,
    intentType,
    title,
    description,
    proposedPayload: payload,
    previewDiff: { entity, action: "INSERT", changes: payload },
    status: "PENDING_APPROVAL",
    createdAt: new Date(),
  };
}

/**
 * AI Builder Service: Parses natural language business configuration requests
 * into safe, structured, reversible Change Proposals (AGENTS.md Rule 3.2).
 */
export function parseConfigurationIntent(
  _context: TenantContext,
  prompt: string,
): ChangeProposal {
  const p = prompt.trim().toLowerCase();
  const proposalId = crypto.randomUUID();

  // 1. Custom Field Intent
  if (
    p.includes("حقل") ||
    p.includes("حقول") ||
    p.includes("custom field") ||
    p.includes("field definition")
  ) {
    let entityType: "lead" | "unit" | "deal" = "lead";
    if (p.includes("وحدة") || p.includes("unit")) entityType = "unit";
    else if (p.includes("صفقة") || p.includes("deal")) entityType = "deal";

    let fieldType: CustomFieldType = "TEXT";
    let options: string[] | undefined;

    if (
      p.includes("اختيار متعدد") ||
      p.includes("multi_select") ||
      p.includes("multi select")
    ) {
      fieldType = "MULTI_SELECT";
      options = ["كاش", "تقسيط"];
    } else if (
      p.includes("قائمة") ||
      p.includes("dropdown") ||
      p.includes("اختيار") ||
      p.includes("single")
    ) {
      fieldType = "SINGLE_SELECT";
      options = ["تشطيب كامل", "نصف تشطيب", "بدون تشطيب"];
    } else if (
      p.includes("رقم") ||
      p.includes("number") ||
      p.includes("ميزانية")
    ) {
      fieldType = "NUMBER";
    } else if (p.includes("تاريخ") || p.includes("date")) {
      fieldType = "DATE";
    } else if (p.includes("نعم/لا") || p.includes("boolean")) {
      fieldType = "BOOLEAN";
    }

    const fieldLabel = extractName(
      prompt,
      "طريقة السداد",
      /\s+(?:نوعه|من\s+نوع|with|type)(?:\s+|$)/i,
    );
    const fieldKey = generateSafeFieldKey(fieldLabel);

    const payload: CreateCustomFieldInput = {
      entityType,
      fieldKey,
      displayName: fieldLabel,
      fieldType,
      validationRules: options ? { options } : undefined,
      isRequired: false,
    };

    return makeProposal(
      proposalId,
      "CREATE_CUSTOM_FIELD",
      `إنشاء حقل مخصص: ${fieldLabel}`,
      `إضافة حقل مخصص جديد (${fieldLabel}) من نوع ${fieldType} إلى كيان ${entityType}`,
      "custom_field_definitions",
      payload as unknown as Record<string, unknown>,
    );
  }

  // 2. Smart Rule Intent
  if (
    p.includes("قاعدة") ||
    p.includes("أتمتة") ||
    p.includes("smart rule") ||
    p.includes("automation") ||
    p.includes("توزيع")
  ) {
    const ruleName = extractName(
      prompt,
      "توزيع العملاء المحتملين بالتناوب العادل",
      /\s+(?:توزع|يقوم|تقوم|عند|when|to)(?:\s+|$)/i,
    );

    const payload: CreateRuleInput = {
      name: ruleName,
      trigger_type: "lead.created",
      conditions: [],
      actions: [
        {
          action_type: "lead.assign_round_robin",
          params: {},
          delay_seconds: 0,
        },
      ],
    };

    return makeProposal(
      proposalId,
      "CREATE_SMART_RULE",
      `إنشاء قاعدة أتمتة: ${ruleName}`,
      `إنشاء قاعدة أتمتة ذكية تنفذ الإجراء '${payload.actions[0]?.action_type}' عند وقوع الحدث '${payload.trigger_type}'`,
      "automation_rules",
      payload as unknown as Record<string, unknown>,
    );
  }

  // 3. Saved View Intent
  const viewName = extractName(
    prompt,
    "عرض مخصص للعملاء الجدد",
    /\s+(?:مع|بشروط|شروط|with)(?:\s+|$)/i,
  );

  const payload: CreateSavedViewInput = {
    entity_type: "leads",
    name: viewName,
    filter_ast: {
      logical: "AND",
      conditions: [{ field: "status", operator: "EQUALS", value: "NEW" }],
    },
    sort_config: [],
    columns_config: [],
    is_default: false,
    is_shared: false,
  };

  return makeProposal(
    proposalId,
    "CREATE_SAVED_VIEW",
    `إنشاء جدول عرض مخصص: ${viewName}`,
    `حفظ جدول عرض مخصص لكيان ${payload.entity_type} مع شروط فرز تلقائية`,
    "saved_views",
    payload as unknown as Record<string, unknown>,
  );
}

/**
 * Safely applies an approved Change Proposal.
 */
export async function applyChangeProposal(
  context: TenantContext,
  proposal: ChangeProposal,
): Promise<ApplyProposalResult> {
  if (proposal.status !== "PENDING_APPROVAL") {
    throw new Error(
      `Proposal '${proposal.id}' cannot be applied because its status is '${proposal.status}'`,
    );
  }

  let resource: unknown;
  let resourceType: string;
  let resourceId: string;

  if (proposal.intentType === "CREATE_CUSTOM_FIELD") {
    assertPermission(context, "create", "custom_field");
    const input = proposal.proposedPayload as unknown as CreateCustomFieldInput;
    const def = await createCustomFieldDefinition(context, input);
    resource = def;
    resourceType = "custom_field_definition";
    resourceId = def.id;
  } else if (proposal.intentType === "CREATE_SMART_RULE") {
    assertPermission(context, "create", "smart_rule");
    const input = proposal.proposedPayload as unknown as CreateRuleInput;
    const rule = await createRule(context, input);
    resource = rule;
    resourceType = "automation_rule";
    resourceId = rule.id;
  } else if (proposal.intentType === "CREATE_SAVED_VIEW") {
    const input = proposal.proposedPayload as unknown as CreateSavedViewInput;
    const view = await createSavedView(context, input);
    resource = view;
    resourceType = "saved_view";
    resourceId = view.id;
  } else {
    throw new Error(`Unsupported intent type: ${proposal.intentType}`);
  }

  proposal.status = "APPLIED";

  logger.info(
    {
      organizationId: context.organizationId,
      proposalId: proposal.id,
      resourceType,
      resourceId,
    },
    "Successfully applied AI Builder configuration proposal",
  );

  return {
    proposalId: proposal.id,
    applied: true,
    resourceType,
    resourceId,
    resource,
  };
}
