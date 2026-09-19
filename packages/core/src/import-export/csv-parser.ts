export interface ParsedCsvResult {
  headers: string[];
  rows: Record<string, string>[];
}

export function parseCsv(rawContent: string, delimiter = ','): ParsedCsvResult {
  if (!rawContent || rawContent.trim().length === 0) {
    return { headers: [], rows: [] };
  }

  // Strip UTF-8 Byte Order Mark (BOM) if present
  let content = rawContent;
  if (content.charCodeAt(0) === 0xfeff) {
    content = content.slice(1);
  }

  const rawRows: string[][] = [];
  let currentRow: string[] = [];
  let currentField = '';
  let insideQuotes = false;

  for (let i = 0; i < content.length; i++) {
    const char = content[i]!;
    const nextChar = content[i + 1];

    if (insideQuotes) {
      if (char === '"') {
        if (nextChar === '"') {
          // Escaped quote ("")
          currentField += '"';
          i++; // skip next quote
        } else {
          // End of quoted field
          insideQuotes = false;
        }
      } else {
        currentField += char;
      }
    } else {
      if (char === '"') {
        insideQuotes = true;
      } else if (char === delimiter) {
        currentRow.push(currentField.trim());
        currentField = '';
      } else if (char === '\r') {
        if (nextChar === '\n') {
          i++; // skip LF after CR
        }
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          rawRows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else if (char === '\n') {
        currentRow.push(currentField.trim());
        if (currentRow.some((f) => f.length > 0)) {
          rawRows.push(currentRow);
        }
        currentRow = [];
        currentField = '';
      } else {
        currentField += char;
      }
    }
  }

  // Push final field/row if any
  currentRow.push(currentField.trim());
  if (currentRow.some((f) => f.length > 0)) {
    rawRows.push(currentRow);
  }

  if (rawRows.length === 0) {
    return { headers: [], rows: [] };
  }

  const headers = rawRows[0]!.map((h) => h.trim());
  const rows: Record<string, string>[] = [];

  for (let r = 1; r < rawRows.length; r++) {
    const rowData = rawRows[r]!;
    const rowObj: Record<string, string> = {};
    for (let c = 0; c < headers.length; c++) {
      const header = headers[c];
      if (header) {
        rowObj[header] = rowData[c] ?? '';
      }
    }
    rows.push(rowObj);
  }

  return { headers, rows };
}

export function escapeCsvField(val: unknown, delimiter = ','): string {
  if (val === null || val === undefined) {
    return '';
  }

  let str: string;
  if (typeof val === 'object') {
    str = JSON.stringify(val);
  } else {
    str = String(val);
  }

  const needsQuotes =
    str.includes(delimiter) ||
    str.includes('"') ||
    str.includes('\n') ||
    str.includes('\r');

  if (needsQuotes) {
    return `"${str.replace(/"/g, '""')}"`;
  }

  return str;
}

export function generateCsv(
  headers: string[],
  rows: Record<string, unknown>[],
  options: { delimiter?: string; includeBom?: boolean } = {}
): string {
  const delimiter = options.delimiter ?? ',';
  const includeBom = options.includeBom ?? true;

  const lines: string[] = [];

  // Header line
  lines.push(headers.map((h) => escapeCsvField(h, delimiter)).join(delimiter));

  // Data rows
  for (const row of rows) {
    const line = headers.map((h) => escapeCsvField(row[h], delimiter)).join(delimiter);
    lines.push(line);
  }

  const csvBody = lines.join('\r\n');
  return includeBom ? `\uFEFF${csvBody}` : csvBody;
}
