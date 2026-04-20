/**
 * Escape a single cell value for safe TSV pasting into Google Sheets / Excel.
 *
 * Google Sheets and Excel both honour RFC 4180-style quoting inside TSV:
 *   - If a cell contains a tab (\t), newline (\n or \r), or double-quote ("),
 *     wrap it in double-quotes and double any internal quotes.
 *   - Otherwise return the value as-is.
 *
 * This ensures that multi-line cell content stays inside one cell after paste.
 */
export function tsvEscapeCell(value: unknown): string {
    if (value === null || value === undefined) return '';
    const s = String(value);
    if (s.includes('\t') || s.includes('\n') || s.includes('\r') || s.includes('"')) {
        return '"' + s.replace(/"/g, '""') + '"';
    }
    return s;
}

/**
 * Build a full TSV string from a 2D array, with proper cell escaping.
 * Each inner array is one row; values are tab-separated; rows are newline-separated.
 */
export function buildTsv(rows: unknown[][]): string {
    return rows.map(row => row.map(tsvEscapeCell).join('\t')).join('\n');
}
