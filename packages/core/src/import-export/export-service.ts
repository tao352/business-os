import type { TenantContext, ExportOptions, ExportResult } from '@business-os/types';
import { queryEntities } from '../query/entity-query-service.js';
import { generateCsv } from './csv-parser.js';

export async function exportEntitiesToCsv(
  context: TenantContext,
  options: ExportOptions
): Promise<ExportResult> {
  const delimiter = options.format === 'TSV' ? '\t' : ',';
  const fileExt = options.format === 'TSV' ? 'tsv' : 'csv';

  // 1. Fetch matching entities via Phase 6 query service
  const queryRes = await queryEntities<Record<string, unknown>>(context, options.entityType, {
    filter_ast: options.filter_ast,
    sort_config: options.sort_config,
    search: options.search,
    limit: 10000,
    offset: 0,
  });

  const rawRows = queryRes.data;

  // 2. Discover columns
  let headers: string[] = [];
  if (options.columns && options.columns.length > 0) {
    headers = [...options.columns];
  } else {
    // Default core fields per entity
    if (options.entityType === 'leads') {
      headers = ['full_name', 'phone', 'email', 'status', 'source', 'created_at'];
    } else if (options.entityType === 'units') {
      headers = ['unit_number', 'unit_type', 'gross_area', 'price', 'currency', 'status'];
    } else if (options.entityType === 'projects') {
      headers = ['name', 'location', 'total_units', 'created_at'];
    } else if (options.entityType === 'deals') {
      headers = ['title', 'value', 'currency', 'stage', 'created_at'];
    } else {
      headers = ['title', 'status', 'due_date', 'created_at'];
    }

    // Append custom fields if enabled
    if (options.includeCustomFields !== false) {
      const customKeys = new Set<string>();
      for (const row of rawRows) {
        if (row.custom_data && typeof row.custom_data === 'object') {
          for (const k of Object.keys(row.custom_data as Record<string, unknown>)) {
            customKeys.add(k);
          }
        }
      }
      for (const k of customKeys) {
        if (!headers.includes(k)) {
          headers.push(k);
        }
      }
    }
  }

  // 3. Format rows
  const flattenedRows: Record<string, unknown>[] = [];
  for (const row of rawRows) {
    const flat: Record<string, unknown> = {};
    const customData = (row.custom_data as Record<string, unknown>) || {};

    for (const h of headers) {
      if (h in row && h !== 'custom_data') {
        flat[h] = row[h];
      } else if (h in customData) {
        flat[h] = customData[h];
      } else {
        flat[h] = '';
      }
    }
    flattenedRows.push(flat);
  }

  // 4. Generate CSV with UTF-8 BOM
  const csvContent = generateCsv(headers, flattenedRows, {
    delimiter,
    includeBom: true,
  });

  const dateStr = new Date().toISOString().slice(0, 10);
  const filename = `${options.entityType}-export-${dateStr}.${fileExt}`;

  return {
    filename,
    content: csvContent,
    rowCount: flattenedRows.length,
    mimeType: options.format === 'TSV' ? 'text/tab-separated-values; charset=utf-8' : 'text/csv; charset=utf-8',
  };
}
