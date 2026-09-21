import { describe, it, expect, beforeAll } from "vitest";
import {
  parseCsv,
  generateCsv,
  autoDetectColumnMapping,
  validateAndDryRunImport,
  executeImport,
  exportEntitiesToCsv,
  createProject,
  createCustomFieldDefinition,
  registerUser,
  createOrganization,
  listLeads,
  listUnits,
  getProject,
} from "../packages/core/src/index.js";
import type { TenantContext } from "@business-os/types";

describe("Phase 8: Robust Import & Export Engine (Excel / CSV)", () => {
  describe("Unit: RFC 4180 CSV Parsing & Generation", () => {
    it("should parse standard CSV with commas, quotes, and newlines", () => {
      const csv = `Full Name,Phone,Notes\n"Ahmed, Ali",01012345678,"He said: ""Call me tomorrow"""\nMona Zaki,01098765432,"Interested in\npenthouse"`;
      const result = parseCsv(csv);

      expect(result.headers).toEqual(["Full Name", "Phone", "Notes"]);
      expect(result.rows).toHaveLength(2);

      expect(result.rows[0]?.["Full Name"]).toBe("Ahmed, Ali");
      expect(result.rows[0]?.["Phone"]).toBe("01012345678");
      expect(result.rows[0]?.["Notes"]).toBe('He said: "Call me tomorrow"');

      expect(result.rows[1]?.["Full Name"]).toBe("Mona Zaki");
      expect(result.rows[1]?.["Notes"]).toBe("Interested in\npenthouse");
    });

    it("should strip UTF-8 BOM when parsing and inject UTF-8 BOM when generating", () => {
      const csvWithBom = `\uFEFFname,phone\nOmar,01011112222`;
      const parsed = parseCsv(csvWithBom);
      expect(parsed.headers[0]).toBe("name");

      const generated = generateCsv(
        ["اسم العميل", "الهاتف"],
        [{ "اسم العميل": "محمود", الهاتف: "0105555" }],
      );
      // First character must be the UTF-8 Byte Order Mark
      expect(generated.charCodeAt(0)).toBe(0xfeff);
      expect(generated).toContain("محمود");
    });

    it("should auto-detect multi-lingual Arabic and English headers", () => {
      const arabicLeadHeaders = [
        "اسم العميل",
        "رقم الهاتف",
        "البريد الالكتروني",
        "الميزانية",
      ];
      const mapping = autoDetectColumnMapping("leads", arabicLeadHeaders, [
        {
          id: "def-1",
          organization_id: "org-1",
          entity_type: "lead",
          field_key: "budget",
          display_name: "الميزانية",
          field_type: "NUMBER",
          validation_rules: {},
          is_required: false,
          display_order: 1,
          is_active: true,
          created_at: new Date().toISOString(),
        },
      ]);

      expect(mapping["اسم العميل"]).toBe("full_name");
      expect(mapping["رقم الهاتف"]).toBe("phone");
      expect(mapping["البريد الالكتروني"]).toBe("email");
      expect(mapping["الميزانية"]).toBe("budget");

      const unitHeaders = [
        "رقم الوحدة",
        "نوع الوحدة",
        "الاستخدام",
        "نموذج",
        "المساحة",
        "السعر",
      ];
      const unitMapping = autoDetectColumnMapping("units", unitHeaders);
      expect(unitMapping["رقم الوحدة"]).toBe("unit_number");
      expect(unitMapping["نوع الوحدة"]).toBe("unit_type");
      expect(unitMapping["الاستخدام"]).toBe("usage_type");
      expect(unitMapping["نموذج"]).toBe("model_name");
      expect(unitMapping["المساحة"]).toBe("gross_area");
      expect(unitMapping["السعر"]).toBe("price");
    });
  });

  describe("Integration: Pre-Flight Dry Run, Ingestion & Filtered Export", () => {
    let orgAContext: TenantContext;
    let orgBContext: TenantContext;
    let projectId: string;

    beforeAll(async () => {
      const suffix = Date.now().toString();

      // Setup Org A
      const userA = await registerUser({
        email: `importer.${suffix}@test.com`,
        password: "Password123!",
        fullName: "Import Specialist",
      });
      const orgA = await createOrganization({
        userId: userA.id,
        name: `Import Export Org ${suffix}`,
        slug: `import-org-${suffix}`,
      });
      orgAContext = {
        organizationId: orgA.id,
        userId: userA.id,
        role: "OWNER",
        correlationId: `corr-imp-${suffix}`,
      };

      // Setup Org B (Foreign)
      const userB = await registerUser({
        email: `rival.imp.${suffix}@test.com`,
        password: "Password123!",
        fullName: "Rival Importer",
      });
      const orgB = await createOrganization({
        userId: userB.id,
        name: `Rival Org ${suffix}`,
        slug: `rival-imp-${suffix}`,
      });
      orgBContext = {
        organizationId: orgB.id,
        userId: userB.id,
        role: "OWNER",
        correlationId: `corr-rival-imp-${suffix}`,
      };

      // Define custom field in Org A: budget with min: 200,000
      await createCustomFieldDefinition(orgAContext, {
        entityType: "lead",
        fieldKey: "budget",
        displayName: "الميزانية",
        fieldType: "NUMBER",
        validationRules: { min: 200000 },
      });

      // Create Project in Org A for units import
      const proj = await createProject(orgAContext, {
        name: "Pyramid Views",
        location: "Giza, Pyramids Plateau",
      });
      projectId = proj.id;
    });

    it("should execute pre-flight dry-run validation with line-by-line error reporting", async () => {
      const csvData =
        `اسم العميل,رقم الهاتف,الميزانية\n` +
        `عمر الشريف,01011112222,1500000\n` + // Valid
        `خالد,12,300000\n` + // Invalid phone (too short)
        `,01033334444,400000\n` + // Missing name
        `عمرو دياب,01055556666,50000\n` + // Custom field validation failure (budget < 200,000)
        `عمر المكرر,01011112222,2000000`; // Duplicate phone in file

      const dryRun = await validateAndDryRunImport(
        orgAContext,
        "leads",
        csvData,
      );

      expect(dryRun.totalRows).toBe(5);
      expect(dryRun.validRowsCount).toBe(1);
      expect(dryRun.errorRowsCount).toBe(4);
      expect(dryRun.duplicateRowsCount).toBe(1);

      // Check specific error rows
      expect(
        dryRun.errors.some((e) => e.rowNumber === 3 && e.field === "phone"),
      ).toBe(true);
      expect(
        dryRun.errors.some((e) => e.rowNumber === 4 && e.field === "full_name"),
      ).toBe(true);
      expect(
        dryRun.errors.some(
          (e) => e.rowNumber === 5 && e.field === "custom_data",
        ),
      ).toBe(true);
      expect(
        dryRun.errors.some((e) => e.rowNumber === 6 && e.field === "phone"),
      ).toBe(true);

      // Verify sample valid row
      expect(dryRun.sampleValidRows[0]?.["full_name"]).toBe("عمر الشريف");
    });

    it("should batch import leads and handle duplicate strategies (SKIP vs UPDATE)", async () => {
      const batchCsv =
        `Full Name,Phone,Email,budget\n` +
        `Hassan Youssef,01077778888,hassan@test.com,500000\n` +
        `Nadia Lutfi,01099990000,nadia@test.com,850000`;

      // 1. Initial import
      const exec1 = await executeImport(orgAContext, "leads", batchCsv);
      expect(exec1.importedCount).toBe(2);
      expect(exec1.skippedCount).toBe(0);

      // 2. Re-import with SKIP strategy
      const duplicateCsv =
        `Full Name,Phone,Email,budget\n` +
        `Hassan Youssef Updated,01077778888,newhassan@test.com,600000`;

      const exec2 = await executeImport(orgAContext, "leads", duplicateCsv, {
        duplicateStrategy: "SKIP",
      });
      expect(exec2.importedCount).toBe(0);
      expect(exec2.skippedCount).toBe(1);

      // Verify name was NOT updated
      const leadsAfterSkip = await listLeads(orgAContext, {
        search: "01077778888",
      });
      expect(leadsAfterSkip[0]?.full_name).toBe("Hassan Youssef");

      // 3. Re-import with UPDATE strategy
      const exec3 = await executeImport(orgAContext, "leads", duplicateCsv, {
        duplicateStrategy: "UPDATE",
      });
      expect(exec3.updatedCount).toBe(1);

      // Verify name WAS updated
      const leadsAfterUpdate = await listLeads(orgAContext, {
        search: "01077778888",
      });
      expect(leadsAfterUpdate[0]?.full_name).toBe("Hassan Youssef Updated");
      expect(leadsAfterUpdate[0]?.email).toBe("newhassan@test.com");
    });

    it("should normalize imported unit taxonomy without mutating declared project total_units", async () => {
      const unitsCsv =
        `Unit #,Type,Area,Price\n` +
        `U-201,Apartment,140,2800000\n` +
        `U-202,Duplex,220,4500000\n` +
        `U-203,Penthouse,280,6200000`;

      const result = await executeImport(orgAContext, "units", unitsCsv, {
        projectId,
      });

      expect(result.importedCount).toBe(3);
      expect(result.failedCount).toBe(0);

      // Verify units in database
      const units = await listUnits(orgAContext, { projectId });
      expect(units).toHaveLength(3);
      expect(units.map((u) => u.unit_number)).toEqual(
        expect.arrayContaining(["U-201", "U-202", "U-203"]),
      );
      expect(units.map((u) => u.unit_type)).toEqual(
        expect.arrayContaining(["APARTMENT", "DUPLEX", "PENTHOUSE"]),
      );
      expect(units.every((u) => u.usage_type === "RESIDENTIAL")).toBe(true);
      expect((await getProject(orgAContext, projectId))?.total_units).toBe(0);
    });

    it("should reject unknown or contradictory unit taxonomy instead of silently importing it", async () => {
      const unknown =
        "Unit #,Type,Area,Price\nU-BAD,Something Ambiguous,100,1500000";
      const unknownDryRun = await validateAndDryRunImport(
        orgAContext,
        "units",
        unknown,
        { projectId },
      );
      expect(unknownDryRun.validRowsCount).toBe(0);
      expect(unknownDryRun.errors[0]?.field).toBe("unit_type");

      const contradictory =
        "Unit #,Type,Usage,Area,Price\nU-WRONG,Apartment,Commercial,120,2000000";
      const contradictionDryRun = await validateAndDryRunImport(
        orgAContext,
        "units",
        contradictory,
        { projectId },
      );
      expect(contradictionDryRun.validRowsCount).toBe(0);
      expect(contradictionDryRun.errors[0]?.field).toBe("usage_type");
    });

    it("should export filtered entity records to Excel-ready CSV with UTF-8 BOM", async () => {
      const exportResult = await exportEntitiesToCsv(orgAContext, {
        entityType: "leads",
        format: "CSV",
        includeCustomFields: true,
      });

      expect(exportResult.filename).toContain("leads-export-");
      expect(exportResult.mimeType).toBe("text/csv; charset=utf-8");
      expect(exportResult.rowCount).toBeGreaterThanOrEqual(2);

      // Verify UTF-8 BOM
      expect(exportResult.content.charCodeAt(0)).toBe(0xfeff);

      // Verify content contains Arabic and English fields
      expect(exportResult.content).toContain("full_name");
      expect(exportResult.content).toContain("Hassan Youssef Updated");
      expect(exportResult.content).toContain("Nadia Lutfi");
    });

    it("should guarantee multi-tenant isolation during export", async () => {
      // Foreign Tenant B exports leads
      const foreignExport = await exportEntitiesToCsv(orgBContext, {
        entityType: "leads",
      });

      expect(foreignExport.rowCount).toBe(0);
      expect(foreignExport.content).not.toContain("Hassan Youssef");
      expect(foreignExport.content).not.toContain("Nadia Lutfi");
    });
  });
});
