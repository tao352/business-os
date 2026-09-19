import { describe, it, expect } from "vitest";
import {
  evaluateCondition,
  evaluateAllConditions,
  getFieldValue,
} from "../packages/core/src/rules-evaluator.js";

describe("Smart Rules Evaluator", () => {
  const mockLead = {
    id: "lead-123",
    full_name: "Ahmed Hassan",
    status: "NEW",
    source: "META_ADS",
    custom_data: {
      budget: 1500000,
      finishing_type: "Ultra Super Lux",
      interested_projects: ["Stars Mall", "Downtown Heights"],
    },
  };

  it("correctly resolves nested field paths", () => {
    expect(getFieldValue(mockLead, "full_name")).toBe("Ahmed Hassan");
    expect(getFieldValue(mockLead, "custom_data.budget")).toBe(1500000);
    expect(getFieldValue(mockLead, "custom_data.non_existent")).toBeUndefined();
  });

  it("evaluates equality conditions accurately", () => {
    expect(
      evaluateCondition(mockLead, {
        field: "status",
        operator: "equals",
        value: "NEW",
      }),
    ).toBe(true);

    expect(
      evaluateCondition(mockLead, {
        field: "status",
        operator: "equals",
        value: "CONTACTED",
      }),
    ).toBe(false);
  });

  it("evaluates numeric comparisons on custom_data", () => {
    expect(
      evaluateCondition(mockLead, {
        field: "custom_data.budget",
        operator: "greater_than",
        value: 1000000,
      }),
    ).toBe(true);

    expect(
      evaluateCondition(mockLead, {
        field: "custom_data.budget",
        operator: "less_than",
        value: 1000000,
      }),
    ).toBe(false);
  });

  it("evaluates string and array contains conditions", () => {
    expect(
      evaluateCondition(mockLead, {
        field: "custom_data.finishing_type",
        operator: "contains",
        value: "Super Lux",
      }),
    ).toBe(true);

    expect(
      evaluateCondition(mockLead, {
        field: "custom_data.interested_projects",
        operator: "contains",
        value: "Stars Mall",
      }),
    ).toBe(true);

    expect(
      evaluateCondition(mockLead, {
        field: "custom_data.interested_projects",
        operator: "contains",
        value: "Unknown Resort",
      }),
    ).toBe(false);
  });

  it("evaluates multiple combined conditions (AND logic)", () => {
    const matchingConditions = [
      { field: "status", operator: "equals" as const, value: "NEW" },
      {
        field: "custom_data.budget",
        operator: "greater_than" as const,
        value: 500000,
      },
      { field: "source", operator: "equals" as const, value: "META_ADS" },
    ];

    expect(evaluateAllConditions(mockLead, matchingConditions)).toBe(true);

    const failingConditions = [
      ...matchingConditions,
      { field: "status", operator: "equals" as const, value: "LOST" },
    ];

    expect(evaluateAllConditions(mockLead, failingConditions)).toBe(false);
  });
});
