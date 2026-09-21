import { withTenantContext } from "@business-os/database";
import { logger } from "@business-os/logger";
import type {
  TenantContext,
  ImportEntityType,
  DuplicateStrategy,
  ColumnMapping,
  ImportDryRunResult,
  ImportExecutionResult,
  ImportRowError,
  CustomFieldDefinition,
  LeadStatus,
} from "@business-os/types";
import { parseCsv } from "./csv-parser.js";
import { autoDetectColumnMapping } from "./column-matcher.js";
import { validateCustomData } from "../metadata/custom-fields-compiler.js";
import { recordAuditLog } from "../crm/audit-helper.js";
import { recordInitialLeadStageInTransaction } from "../crm/lead-lifecycle.js";
import { assertPermission } from "../permissions/checker.js";
import {
  inferUsageTypeFromUnitType,
  isUsageTypeCompatible,
  normalizeUnitType,
  normalizeUsageType,
} from "../real-estate/unit-taxonomy.js";

export interface ImportOptions {
  mappingOverrides?: ColumnMapping;
  duplicateStrategy?: DuplicateStrategy;
  projectId?: string; // Required for units import
}

interface ParsedRow {
  rowNumber: number;
  coreData: Record<string, unknown>;
  customData: Record<string, unknown>;
  uniqueKey: string;
}

async function getCustomFieldDefs(
  client: any,
  orgId: string,
  entityType: string,
): Promise<CustomFieldDefinition[]> {
  const typeKey = entityType === "leads" ? "lead" : "unit";
  const res = (await client.query(
    `SELECT * FROM custom_field_definitions
     WHERE organization_id = $1 AND entity_type = $2 AND is_active = true`,
    [orgId, typeKey],
  )) as { rows: CustomFieldDefinition[] };
  return res.rows;
}

function parseRawValueForField(
  val: string,
  def?: CustomFieldDefinition,
): unknown {
  if (!def) return val;
  if (def.field_type === "NUMBER" || def.field_type === "CURRENCY") {
    const clean = val.replace(/[,\s]/g, "");
    const num = parseFloat(clean);
    return isNaN(num) ? val : num;
  }
  if (def.field_type === "BOOLEAN") {
    const lower = val.toLowerCase().trim();
    if (["true", "1", "yes", "نعم"].includes(lower)) return true;
    if (["false", "0", "no", "لا"].includes(lower)) return false;
    return val;
  }
  if (def.field_type === "MULTI_SELECT") {
    return val
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return val;
}

export async function validateAndDryRunImport(
  context: TenantContext,
  entityType: ImportEntityType,
  fileContent: string,
  options: ImportOptions = {},
): Promise<ImportDryRunResult> {
  assertPermission(context, "create", entityType === "leads" ? "lead" : "unit");

  const parsed = parseCsv(fileContent);
  if (parsed.rows.length === 0) {
    return {
      totalRows: 0,
      validRowsCount: 0,
      errorRowsCount: 0,
      duplicateRowsCount: 0,
      errors: [],
      sampleValidRows: [],
      detectedHeaders: parsed.headers,
      appliedMapping: {},
    };
  }

  return await withTenantContext(context.organizationId, async (client) => {
    const customDefs = await getCustomFieldDefs(
      client,
      context.organizationId,
      entityType,
    );
    const mapping = {
      ...autoDetectColumnMapping(entityType, parsed.headers, customDefs),
      ...(options.mappingOverrides ?? {}),
    };

    const errors: ImportRowError[] = [];
    const validRows: ParsedRow[] = [];
    const seenKeysInFile = new Set<string>();
    let inDuplicateRowsCount = 0;

    for (let i = 0; i < parsed.rows.length; i++) {
      const rawRow = parsed.rows[i]!;
      const rowNum = i + 2; // Row 1 is header
      const coreData: Record<string, unknown> = {};
      const customData: Record<string, unknown> = {};

      for (const [csvHeader, targetField] of Object.entries(mapping)) {
        const val = rawRow[csvHeader]?.trim();
        if (val === undefined || val === "") continue;

        const def = customDefs.find((d) => d.field_key === targetField);
        if (def) {
          customData[targetField] = parseRawValueForField(val, def);
        } else {
          coreData[targetField] = val;
        }
      }

      // 1. Validation per entity
      if (entityType === "leads") {
        const fullName = coreData.full_name as string;
        const phone = coreData.phone as string;

        if (!fullName || fullName.length < 2) {
          errors.push({
            rowNumber: rowNum,
            field: "full_name",
            message: "Full name is required (min 2 chars)",
          });
          continue;
        }
        if (!phone || phone.length < 5) {
          errors.push({
            rowNumber: rowNum,
            field: "phone",
            message: "Valid phone number is required (min 5 chars)",
          });
          continue;
        }

        const uniqueKey = phone.replace(/[\s\-_]+/g, "");
        if (seenKeysInFile.has(uniqueKey)) {
          inDuplicateRowsCount++;
          errors.push({
            rowNumber: rowNum,
            field: "phone",
            message: `Duplicate phone number '${phone}' in file`,
          });
          continue;
        }
        seenKeysInFile.add(uniqueKey);

        // Validate custom fields
        try {
          const validatedCustom =
            customDefs.length > 0
              ? validateCustomData(customDefs, customData)
              : customData;
          validRows.push({
            rowNumber: rowNum,
            coreData,
            customData: validatedCustom,
            uniqueKey,
          });
        } catch (err: any) {
          errors.push({
            rowNumber: rowNum,
            field: "custom_data",
            message: err.message || "Custom field validation failed",
          });
        }
      } else if (entityType === "units") {
        const unitNumber = coreData.unit_number as string;
        const rawUnitType = String(coreData.unit_type ?? "").trim();
        const unitType = normalizeUnitType(rawUnitType);
        const rawUsageType = String(coreData.usage_type ?? "").trim();
        const explicitUsageType = rawUsageType
          ? normalizeUsageType(rawUsageType)
          : null;
        const usageType =
          explicitUsageType ??
          (unitType ? inferUsageTypeFromUnitType(unitType) : null);
        const grossArea = parseFloat(String(coreData.gross_area || "0"));
        const price = parseFloat(String(coreData.price || "0"));

        if (!unitNumber || unitNumber.length === 0) {
          errors.push({
            rowNumber: rowNum,
            field: "unit_number",
            message: "Unit number is required",
          });
          continue;
        }
        if (!unitType) {
          errors.push({
            rowNumber: rowNum,
            field: "unit_type",
            message: rawUnitType
              ? `Unsupported unit type '${rawUnitType}' — review mapping before import`
              : "Unit type is required",
          });
          continue;
        }
        if (!usageType) {
          errors.push({
            rowNumber: rowNum,
            field: "usage_type",
            message: rawUsageType
              ? `Unsupported usage type '${rawUsageType}' — review mapping before import`
              : `Usage type is required for unit type '${unitType}'`,
          });
          continue;
        }
        if (
          explicitUsageType &&
          !isUsageTypeCompatible(unitType, explicitUsageType)
        ) {
          errors.push({
            rowNumber: rowNum,
            field: "usage_type",
            message: `Usage type '${explicitUsageType}' conflicts with unit type '${unitType}'`,
          });
          continue;
        }
        if (isNaN(price) || price <= 0) {
          errors.push({
            rowNumber: rowNum,
            field: "price",
            message: "Price must be a positive number",
          });
          continue;
        }

        coreData.unit_number = unitNumber;
        coreData.unit_type = unitType;
        coreData.usage_type = usageType;
        coreData.gross_area =
          isNaN(grossArea) || grossArea <= 0 ? 100 : grossArea;
        coreData.price = price;

        const uniqueKey = unitNumber.toLowerCase();
        if (seenKeysInFile.has(uniqueKey)) {
          inDuplicateRowsCount++;
          errors.push({
            rowNumber: rowNum,
            field: "unit_number",
            message: `Duplicate unit number '${unitNumber}' in file`,
          });
          continue;
        }
        seenKeysInFile.add(uniqueKey);

        try {
          const validatedCustom =
            customDefs.length > 0
              ? validateCustomData(customDefs, customData)
              : customData;
          validRows.push({
            rowNumber: rowNum,
            coreData,
            customData: validatedCustom,
            uniqueKey,
          });
        } catch (err: any) {
          errors.push({
            rowNumber: rowNum,
            field: "custom_data",
            message: err.message || "Custom field validation failed",
          });
        }
      }
    }

    return {
      totalRows: parsed.rows.length,
      validRowsCount: validRows.length,
      errorRowsCount: errors.length,
      duplicateRowsCount: inDuplicateRowsCount,
      errors,
      sampleValidRows: validRows
        .slice(0, 5)
        .map((r) => ({ ...r.coreData, ...r.customData })),
      detectedHeaders: parsed.headers,
      appliedMapping: mapping,
    };
  });
}

export async function executeImport(
  context: TenantContext,
  entityType: ImportEntityType,
  fileContent: string,
  options: ImportOptions = {},
): Promise<ImportExecutionResult> {
  assertPermission(context, "create", entityType === "leads" ? "lead" : "unit");

  const duplicateStrategy = options.duplicateStrategy ?? "SKIP";
  const dryRun = await validateAndDryRunImport(
    context,
    entityType,
    fileContent,
    options,
  );

  if (dryRun.validRowsCount === 0) {
    return {
      totalRows: dryRun.totalRows,
      importedCount: 0,
      updatedCount: 0,
      skippedCount: 0,
      failedCount: dryRun.errorRowsCount,
      errors: dryRun.errors,
      jobId: `job-${Date.now()}`,
    };
  }

  const parsed = parseCsv(fileContent);

  return await withTenantContext(context.organizationId, async (client) => {
    const customDefs = await getCustomFieldDefs(
      client,
      context.organizationId,
      entityType,
    );
    const mapping = dryRun.appliedMapping;

    let importedCount = 0;
    let updatedCount = 0;
    let skippedCount = 0;

    for (let i = 0; i < parsed.rows.length; i++) {
      const rawRow = parsed.rows[i]!;
      const rowNum = i + 2;
      const coreData: Record<string, unknown> = {};
      const customData: Record<string, unknown> = {};

      for (const [csvHeader, targetField] of Object.entries(mapping)) {
        const val = rawRow[csvHeader]?.trim();
        if (val === undefined || val === "") continue;

        const def = customDefs.find((d) => d.field_key === targetField);
        if (def) {
          customData[targetField] = parseRawValueForField(val, def);
        } else {
          coreData[targetField] = val;
        }
      }

      if (entityType === "leads") {
        const fullName = coreData.full_name as string;
        const phone = coreData.phone as string;
        if (!fullName || !phone || fullName.length < 2 || phone.length < 5)
          continue;

        const existing = await client.query<{ id: string }>(
          `SELECT id FROM leads WHERE organization_id = $1 AND phone = $2`,
          [context.organizationId, phone],
        );

        if (existing.rows.length > 0) {
          if (duplicateStrategy === "SKIP") {
            skippedCount++;
            continue;
          } else {
            // UPDATE
            await client.query(
              `UPDATE leads
               SET full_name = $1, email = COALESCE($2, email),
                   custom_data = custom_data || $3::jsonb, updated_at = NOW()
               WHERE id = $4`,
              [
                fullName,
                coreData.email ?? null,
                JSON.stringify(customData),
                existing.rows[0]!.id,
              ],
            );
            updatedCount++;
            continue;
          }
        }

        // INSERT
        const insertedLeadRes = await client.query<{
          id: string;
          status: LeadStatus;
        }>(
          `INSERT INTO leads (organization_id, full_name, phone, email, status, source, custom_data)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           RETURNING id, status`,
          [
            context.organizationId,
            fullName,
            phone,
            coreData.email ?? null,
            coreData.status ?? "NEW",
            coreData.source ?? "IMPORT",
            JSON.stringify(customData),
          ],
        );

        const insertedLead = insertedLeadRes.rows[0]!;
        await recordInitialLeadStageInTransaction(
          client,
          context,
          insertedLead.id,
          insertedLead.status,
          {
            source: "csv_import",
            rowNumber: rowNum,
          },
        );

        importedCount++;
      } else if (entityType === "units") {
        if (!options.projectId) {
          throw new Error("projectId is required for units batch import");
        }
        const unitNumber = coreData.unit_number as string;
        const price = parseFloat(String(coreData.price || "0"));
        const unitType = normalizeUnitType(String(coreData.unit_type ?? ""));
        const rawUsageType = String(coreData.usage_type ?? "").trim();
        const explicitUsageType = rawUsageType
          ? normalizeUsageType(rawUsageType)
          : null;
        const usageType =
          explicitUsageType ??
          (unitType ? inferUsageTypeFromUnitType(unitType) : null);
        if (
          !unitNumber ||
          isNaN(price) ||
          price <= 0 ||
          !unitType ||
          !usageType ||
          (explicitUsageType &&
            !isUsageTypeCompatible(unitType, explicitUsageType))
        ) {
          continue;
        }

        const existing = await client.query<{ id: string }>(
          `SELECT id FROM units WHERE organization_id = $1 AND project_id = $2 AND unit_number = $3`,
          [context.organizationId, options.projectId, unitNumber],
        );

        if (existing.rows.length > 0) {
          if (duplicateStrategy === "SKIP") {
            skippedCount++;
            continue;
          } else {
            // UPDATE
            await client.query(
              `UPDATE units
               SET unit_type = $1, usage_type = $2, price = $3,
                   gross_area = COALESCE($4, gross_area),
                   model_name = COALESCE($5, model_name),
                   custom_data = custom_data || $6::jsonb, updated_at = NOW()
               WHERE id = $7`,
              [
                unitType,
                usageType,
                price,
                coreData.gross_area ?? null,
                coreData.model_name ?? null,
                JSON.stringify(customData),
                existing.rows[0]!.id,
              ],
            );
            updatedCount++;
            continue;
          }
        }

        // INSERT
        await client.query(
          `INSERT INTO units (
             organization_id, project_id, unit_number, usage_type, unit_type,
             model_name, gross_area, price, status, custom_data
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
          [
            context.organizationId,
            options.projectId,
            unitNumber,
            usageType,
            unitType,
            coreData.model_name ?? null,
            coreData.gross_area ?? 100,
            price,
            String(coreData.status ?? "AVAILABLE").toUpperCase(),
            JSON.stringify(customData),
          ],
        );
        importedCount++;
      }
    }

    const jobId = `job-${Date.now()}`;
    await recordAuditLog(client, context, {
      action: "CREATE",
      entityType: "import_job",
      entityId: jobId,
      afterState: {
        entityType,
        importedCount,
        updatedCount,
        skippedCount,
        totalRows: parsed.rows.length,
      },
    });

    logger.info(
      {
        organizationId: context.organizationId,
        entityType,
        importedCount,
        updatedCount,
        skippedCount,
      },
      "Batch import completed",
    );

    return {
      totalRows: parsed.rows.length,
      importedCount,
      updatedCount,
      skippedCount,
      failedCount: dryRun.errorRowsCount,
      errors: dryRun.errors,
      jobId,
    };
  });
}
