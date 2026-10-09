const FORMULA_START = /^[=+\-@\t\r]/;

/**
 * Spreadsheet formula injection guard (OWASP "CSV Injection"): a cell that starts with = + - @ tab
 * or carriage return gets a leading apostrophe, so Excel and Sheets show it as text.
 */
export function escapeCell(value: string): string {
  return FORMULA_START.test(value) ? `'${value}` : value;
}
