import { describe, it, expect, beforeAll, afterAll } from "vitest";
import crypto from "node:crypto";
import { pool } from "../packages/database/src/index.js";
import type { TenantContext, CustomFieldDefinition } from "@business-os/types";
import {
  registerUser,
  createOrganization,
  createCustomFieldDefinition,
  listCustomFieldDefinitions,
  updateCustomFieldDefinition,
  deleteCustomFieldDefinition,
  createLead,
  updateLead,
  compileCustomDataSchema,
  validateCustomData,
  CustomFieldValidationError,
} from "../packages/core/src/index.js";

describe("Controlled Custom Fields Engine", () => {
  describe("Dynamic Zod Compiler Unit Tests", () => {
    const mockDefs: CustomFieldDefinition[] = [
      {
        id: "def-1",
        organization_id: "org-1",
        entity_type: "lead",
        field_key: "budget",
        display_name: "Budget",
        field_type: "NUMBER",
        validation_rules: { min: 500000, max: 50000000 },
        is_required: true,
        display_order: 1,
        is_active: true,
        created_at: new Date().toISOString(),
      },
      {
        id: "def-2",
        organization_id: "org-1",
        entity_type: "lead",
        field_key: "finishing_type",
        display_name: "Finishing Type",
        field_type: "SINGLE_SELECT",
        validation_rules: {
          options: [
            "Core & Shell",
            "Semi-Finished",
            "Fully Finished",
            "Ultra Super Lux",
          ],
        },
        is_required: false,
        display_order: 2,
        is_active: true,
        created_at: new Date().toISOString(),
      },
      {
        id: "def-3",
        organization_id: "org-1",
        entity_type: "lead",
        field_key: "preferred_locations",
        display_name: "Preferred Locations",
        field_type: "MULTI_SELECT",
        validation_rules: {
          options: ["New Cairo", "Sheikh Zayed", "North Coast", "Red Sea"],
        },
        is_required: false,
        display_order: 3,
        is_active: true,
        created_at: new Date().toISOString(),
      },
    ];

    it("successfully validates conforming custom data payload", () => {
      const validData = {
        budget: 2500000,
        finishing_type: "Ultra Super Lux",
        preferred_locations: ["New Cairo", "North Coast"],
      };

      const result = validateCustomData(mockDefs, validData);
      expect(result.budget).toBe(2500000);
      expect(result.finishing_type).toBe("Ultra Super Lux");
    });

    it("rejects payload missing a required field", () => {
      const missingRequired = {
        finishing_type: "Fully Finished",
      };

      expect(() => validateCustomData(mockDefs, missingRequired)).toThrow(
        CustomFieldValidationError,
      );
    });

    it("rejects numbers outside specified min/max bounds", () => {
      const tooLow = { budget: 10000 };
      expect(() => validateCustomData(mockDefs, tooLow)).toThrow(
        CustomFieldValidationError,
      );

      const tooHigh = { budget: 999999999 };
      expect(() => validateCustomData(mockDefs, tooHigh)).toThrow(
        CustomFieldValidationError,
      );
    });

    it("rejects select options not in the allowed choice list", () => {
      const invalidOption = {
        budget: 1500000,
        finishing_type: "Cardboard & Clay", // Not in options
      };

      expect(() => validateCustomData(mockDefs, invalidOption)).toThrow(
        CustomFieldValidationError,
      );
    });

    it("rejects multi-select with an unapproved choice", () => {
      const invalidMulti = {
        budget: 1500000,
        preferred_locations: ["New Cairo", "Antarctica"],
      };

      expect(() => validateCustomData(mockDefs, invalidMulti)).toThrow(
        CustomFieldValidationError,
      );
    });
  });

  describe("Live Custom Fields Service & CRM Integration", () => {
    const uniqueSuffix = crypto.randomBytes(4).toString("hex");
    let ownerContext: TenantContext;
    let organizationId: string;

    beforeAll(async () => {
      const owner = await registerUser({
        email: `broker.admin.${uniqueSuffix}@luxuryre.local`,
        password: "AdminPassword2026!",
        fullName: "Sherif Luxury",
      });

      const org = await createOrganization({
        userId: owner.id,
        name: "Luxury Properties Egypt",
        slug: `luxury-${uniqueSuffix}`,
      });
      organizationId = org.id;

      ownerContext = {
        organizationId,
        userId: owner.id,
        role: "OWNER",
        correlationId: "custom-fields-req",
      };
    });

    afterAll(async () => {
      await pool.end();
    });

    it("creates custom field definitions in PostgreSQL without dynamic DDL", async () => {
      const budgetDef = await createCustomFieldDefinition(ownerContext, {
        entityType: "lead",
        fieldKey: "budget",
        displayName: "Budget Amount",
        fieldType: "NUMBER",
        validationRules: { min: 200000, max: 100000000 },
        isRequired: true,
        displayOrder: 1,
      });

      expect(budgetDef.id).toBeDefined();
      expect(budgetDef.field_key).toBe("budget");
      expect(budgetDef.field_type).toBe("NUMBER");

      const finishingDef = await createCustomFieldDefinition(ownerContext, {
        entityType: "lead",
        fieldKey: "finishing_type",
        displayName: "Finishing Type",
        fieldType: "SINGLE_SELECT",
        validationRules: {
          options: ["Core & Shell", "Semi Finished", "Fully Finished"],
        },
        isRequired: false,
        displayOrder: 2,
      });

      expect(finishingDef.id).toBeDefined();
      expect(finishingDef.field_key).toBe("finishing_type");
    });

    it("blocks reserved system keywords from being used as field keys", async () => {
      await expect(
        createCustomFieldDefinition(ownerContext, {
          entityType: "lead",
          fieldKey: "status",
          displayName: "Status",
          fieldType: "TEXT",
        }),
      ).rejects.toThrow(/reserved system keyword/);

      await expect(
        createCustomFieldDefinition(ownerContext, {
          entityType: "lead",
          fieldKey: "phone",
          displayName: "Phone Number",
          fieldType: "TEXT",
        }),
      ).rejects.toThrow(/reserved system keyword/);
    });

    it("blocks invalid field key formatting", async () => {
      await expect(
        createCustomFieldDefinition(ownerContext, {
          entityType: "lead",
          fieldKey: "Invalid Key With Spaces!",
          displayName: "Bad Key",
          fieldType: "TEXT",
        }),
      ).rejects.toThrow(/lowercase alphanumeric with underscores/);
    });

    it("lists active custom field definitions ordered by display_order", async () => {
      const defs = await listCustomFieldDefinitions(ownerContext, "lead");
      expect(defs.length).toBeGreaterThanOrEqual(2);
      expect(defs[0].field_key).toBe("budget");
      expect(defs[1].field_key).toBe("finishing_type");
    });

    it("creates lead with conforming custom_data successfully", async () => {
      const lead = await createLead(ownerContext, {
        fullName: "Karim Buyer",
        phone: "+201099887766",
        customData: {
          budget: 3500000,
          finishing_type: "Fully Finished",
        },
      });

      expect(lead.id).toBeDefined();
      expect(lead.custom_data.budget).toBe(3500000);
      expect(lead.custom_data.finishing_type).toBe("Fully Finished");
    });

    it("rejects lead creation when required custom field is missing", async () => {
      await expect(
        createLead(ownerContext, {
          fullName: "Incomplete Buyer",
          phone: "+201012345678",
          customData: {
            finishing_type: "Core & Shell",
            // budget is required!
          },
        }),
      ).rejects.toThrow(CustomFieldValidationError);
    });

    it("rejects lead creation when custom field value is invalid type or out of bounds", async () => {
      // budget below min (200,000)
      await expect(
        createLead(ownerContext, {
          fullName: "Low Budget Buyer",
          phone: "+201012345678",
          customData: {
            budget: 5000,
          },
        }),
      ).rejects.toThrow(CustomFieldValidationError);

      // finishing_type with invalid option
      await expect(
        createLead(ownerContext, {
          fullName: "Bad Option Buyer",
          phone: "+201012345678",
          customData: {
            budget: 5000000,
            finishing_type: "Marble Palace 3000",
          },
        }),
      ).rejects.toThrow(CustomFieldValidationError);
    });

    it("updates lead custom data with valid values", async () => {
      const lead = await createLead(ownerContext, {
        fullName: "Youssef Update Buyer",
        phone: "+201022223333",
        customData: {
          budget: 2000000,
        },
      });

      const updated = await updateLead(ownerContext, lead.id, {
        customData: {
          budget: 4500000,
          finishing_type: "Semi Finished",
        },
      });

      expect(updated.custom_data.budget).toBe(4500000);
      expect(updated.custom_data.finishing_type).toBe("Semi Finished");
    });

    it("ensures custom field definitions are strictly isolated between tenants", async () => {
      const alienOwner = await registerUser({
        email: `alien.custom.${uniqueSuffix}@otherdev.local`,
        password: "AlienPassword123!",
        fullName: "Alien Custom Dev",
      });

      const alienOrg = await createOrganization({
        userId: alienOwner.id,
        name: "Alien Custom Properties",
        slug: `alien-custom-${uniqueSuffix}`,
      });

      const alienContext: TenantContext = {
        organizationId: alienOrg.id,
        userId: alienOwner.id,
        role: "OWNER",
        correlationId: "alien-custom-req",
      };

      // Alien org has zero custom fields for 'lead'
      const alienDefs = await listCustomFieldDefinitions(alienContext, "lead");
      expect(alienDefs).toHaveLength(0);

      // Alien org can create leads without Luxury Properties' custom field constraints
      const alienLead = await createLead(alienContext, {
        fullName: "Alien Unrestricted Lead",
        phone: "+201000112233",
        customData: {
          some_random_field:
            "Allowed because Alien org has no required budget field",
        },
      });

      expect(alienLead.id).toBeDefined();
    });
  });
});
