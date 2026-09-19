import { z } from "zod";
import type { FilterGroup, SortConfig } from "./views.js";

export const ImportEntityTypeSchema = z.enum(["leads", "units"]);
export type ImportEntityType = z.infer<typeof ImportEntityTypeSchema>;

export const DuplicateStrategySchema = z.enum(["SKIP", "UPDATE"]);
export type DuplicateStrategy = z.infer<typeof DuplicateStrategySchema>;

export type ColumnMapping = Record<string, string>;

export interface ImportRowError {
  rowNumber: number;
  field: string;
  message: string;
  rawValue?: unknown;
}

export interface ImportDryRunResult {
  totalRows: number;
  validRowsCount: number;
  errorRowsCount: number;
  duplicateRowsCount: number;
  errors: ImportRowError[];
  sampleValidRows: Record<string, unknown>[];
  detectedHeaders: string[];
  appliedMapping: ColumnMapping;
}

export interface ImportExecutionResult {
  totalRows: number;
  importedCount: number;
  updatedCount: number;
  skippedCount: number;
  failedCount: number;
  errors: ImportRowError[];
  jobId: string;
}

export const ExportFormatSchema = z.enum(["CSV", "TSV"]);
export type ExportFormat = z.infer<typeof ExportFormatSchema>;

export interface ExportOptions {
  entityType: "leads" | "units" | "deals" | "tasks" | "projects";
  format?: ExportFormat;
  columns?: string[];
  filter_ast?: FilterGroup;
  sort_config?: SortConfig[];
  search?: string;
  includeCustomFields?: boolean;
}

export interface ExportResult {
  filename: string;
  content: string;
  rowCount: number;
  mimeType: string;
}
