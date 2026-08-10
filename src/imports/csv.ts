export class CsvError extends Error {}

export function parseCsv(source: string): string[][] {
  if (Buffer.byteLength(source, "utf8") > 512 * 1024)
    throw new CsvError("CSV files must be 512 KB or smaller.");
  if (source.includes("\0"))
    throw new CsvError("CSV files cannot contain null bytes.");
  const input = source.replace(/^\uFEFF/u, "");
  const rows: string[][] = [];
  let row: string[] = [],
    field = "",
    quoted = false;
  for (let index = 0; index < input.length; index += 1) {
    const character = input[index]!;
    if (quoted) {
      if (character === '"' && input[index + 1] === '"') {
        field += '"';
        index += 1;
      } else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') {
      if (field)
        throw new CsvError(
          "A quoted field must start at the beginning of a column.",
        );
      quoted = true;
    } else if (character === ",") {
      row.push(field);
      field = "";
    } else if (character === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (character !== "\r") field += character;
  }
  if (quoted)
    throw new CsvError("The CSV contains an unterminated quoted field.");
  row.push(field);
  if (row.some(Boolean) || rows.length === 0) rows.push(row);
  if (rows.length < 2)
    throw new CsvError(
      "The CSV must contain a header and at least one data row.",
    );
  if (rows.length > 1001)
    throw new CsvError("CSV imports support at most 1,000 data rows.");
  if (rows[0]!.length > 50)
    throw new CsvError("CSV imports support at most 50 columns.");
  const width = rows[0]!.length;
  if (rows.some((candidate) => candidate.length !== width))
    throw new CsvError(
      "Every CSV row must contain the same number of columns as the header.",
    );
  const headers = rows[0]!.map((header) => header.trim());
  if (headers.some((header) => !header))
    throw new CsvError("CSV headers cannot be empty.");
  if (
    new Set(headers.map((header) => header.toLowerCase())).size !==
    headers.length
  )
    throw new CsvError("CSV headers must be unique.");
  rows[0] = headers;
  return rows;
}

export function csvCell(value: unknown): string {
  let text = value === null || value === undefined ? "" : String(value);
  if (/^[=+\-@]/u.test(text)) text = `'${text}`;
  return /[",\r\n]/u.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

export function csvDocument(columns: string[], rows: unknown[][]): string {
  return `${[columns, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n")}\r\n`;
}
