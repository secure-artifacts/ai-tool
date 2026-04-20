// Gallery view data computation functions (pure, no React dependencies)
// Extracted from MediaGalleryPanelV2.tsx for modularity

import { DataRow } from '../types';
import {
    SortRule, NumFilter, CustomFilter, GalleryConfig,
    GroupLevel, DateBinRange, TextGroupBin, GroupBinRange,
    extractImageUrl, parseDate, formatDateKey, getGroupKey,
    formatDateValue, parseNumericValue, checkHighlight, HighlightRule,
} from './galleryUtils';

export function sortRowsByRules(rows: DataRow[], sortRules: SortRule[]) {
const parseNumericValue = (value: unknown): number | null => {
    if (value === null || value === undefined) return null;
    if (typeof value === 'number' && !isNaN(value)) return value;
    if (typeof value !== 'string') return null;

    let str = value.trim();
    if (!str || !/\d/.test(str)) return null;

    const isPercent = /%$/.test(str);
    const unitMatch = str.match(/(万|亿|[kKmMbBwW])$/);
    const unit = unitMatch?.[1] || '';

    str = str
        .replace(/[,\s]/g, '')
        .replace(/^[$¥€£₹]/, '')
        .replace(/[()]/g, '')
        .replace(/%$/, '')
        .replace(/(万|亿|[kKmMbBwW])$/, '');

    const numMatch = str.match(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i);
    if (!numMatch) return null;

    let num = Number(str);
    if (isNaN(num)) return null;

    switch (unit) {
        case 'k':
        case 'K':
            num *= 1e3;
            break;
        case 'm':
        case 'M':
            num *= 1e6;
            break;
        case 'b':
        case 'B':
            num *= 1e9;
            break;
        case 'w':
        case 'W':
        case '万':
            num *= 1e4;
            break;
        case '亿':
            num *= 1e8;
            break;
        default:
            break;
    }

    if (isPercent) num /= 100;
    return num;
};

// Uses sortRules defined above
if (sortRules.length === 0) return [...rows];

const sorted = [...rows];
// Single sort with a comparator that checks all rules in priority order
sorted.sort((a, b) => {
    for (const rule of sortRules) {
        if (!rule.column) continue;

        const aVal = a[rule.column];
        const bVal = b[rule.column];

        const aStr = String(aVal ?? '');
        const bStr = String(bVal ?? '');

        // FIRST: Try number comparison (before date, because parseDate can interpret numbers as dates!)
        // Remove commas for number parsing (e.g., "1,234" -> "1234")
        const aNum = parseNumericValue(aStr);
        const bNum = parseNumericValue(bStr);
        if (aNum !== null && bNum !== null) {
            const cmp = aNum - bNum;
            if (cmp !== 0) {
                return rule.descending ? -cmp : cmp;
            }
            continue; // Equal, check next rule
        }

        // SECOND: Try date comparison (only if values look like dates)
        const looksLikeDateA = /[-/年月日]/.test(aStr) || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(aStr);
        const looksLikeDateB = /[-/年月日]/.test(bStr) || /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(bStr);
        if (looksLikeDateA && looksLikeDateB) {
            const aDate = parseDate(aVal);
            const bDate = parseDate(bVal);
            if (aDate && bDate) {
                const cmp = aDate.getTime() - bDate.getTime();
                if (cmp !== 0) {
                    return rule.descending ? -cmp : cmp;
                }
                continue; // Equal, check next rule
            }
        }

        // THIRD: String comparison
        const cmp = aStr.localeCompare(bStr, 'zh-CN');
        if (cmp !== 0) {
            return rule.descending ? -cmp : cmp;
        }
        // Equal, check next rule
    }
    return 0; // All rules equal
});

return sorted;
}

export function sortDateKeys(keys: string[], sortRules: SortRule[], dateColumn: string): string[] {
    const rule = sortRules.find(r => r.column === dateColumn);
    const descending = rule ? rule.descending : true;
    return [...keys].sort((a, b) => descending ? b.localeCompare(a, undefined, { numeric: true }) : a.localeCompare(b, undefined, { numeric: true }));
}

export function computeProcessedRows(inputRows: DataRow[], searchKeyword: string, imageColumn: string, sortRules: SortRule[], dateColumn: string, dateStart: string, dateEnd: string, customFilters: any[], numFilters: any[]): DataRow[] {
// Use inputRows for non-blocking computation on large datasets
let rows = [...inputRows].map((row, originalIndex) => ({
    ...row,
    // Include originalIndex to ensure unique keys even for duplicate images
    _rowId: `${extractImageUrl(row[imageColumn]) || ''}||${row._sourceSheet || ''}||${originalIndex}`
}));

// Global keyword search - search across all text columns
if (searchKeyword && searchKeyword.trim()) {
    const keywords = searchKeyword.toLowerCase().trim().split(/\s+/);
    rows = rows.filter(row => {
        // Combine all text values from the row
        const allText = Object.values(row)
            .map(v => String(v || '').toLowerCase())
            .join(' ');
        // All keywords must match (AND logic)
        return keywords.every(kw => allText.includes(kw));
    });
}

// Date filter - uses effective config
if (dateColumn && (dateStart || dateEnd)) {
    const startDate = dateStart ? new Date(dateStart) : null;
    const endDate = dateEnd ? new Date(dateEnd) : null;

    rows = rows.filter(row => {
        const date = parseDate(row[dateColumn]);
        if (!date) return true;
        if (startDate && date < startDate) return false;
        if (endDate && date > endDate) return false;
        return true;
    });
}

// Custom filters - uses customFilters defined above
for (const cf of customFilters) {
    if (!cf.column) continue;

    rows = rows.filter(row => {
        const rawValue = String(row[cf.column] ?? '');
        const strValue = rawValue.toLowerCase();
        const numValue = parseFloat(rawValue);
        const ruleValue = (cf.value || '').toLowerCase();
        const ruleNumValue = parseFloat(cf.value || '0');
        const ruleNumValue2 = cf.value2 ? parseFloat(cf.value2) : 0;

        switch (cf.operator) {
            // Text operators
            case 'contains':
                return ruleValue ? strValue.includes(ruleValue) : true;
            case 'notContains':
                return ruleValue ? !strValue.includes(ruleValue) : true;
            case 'equals':
                return strValue === ruleValue;
            case 'notEquals':
                return strValue !== ruleValue;
            case 'startsWith':
                return ruleValue ? strValue.startsWith(ruleValue) : true;
            case 'endsWith':
                return ruleValue ? strValue.endsWith(ruleValue) : true;
            case 'notEmpty':
                return rawValue.trim().length > 0;
            case 'isEmpty':
                return rawValue.trim().length === 0;
            case 'regex':
                try {
                    if (cf.value) {
                        const regex = new RegExp(cf.value, 'i');
                        return regex.test(rawValue);
                    }
                    return true;
                } catch { return true; }

            // Numeric operators
            case 'greaterThan':
                return !isNaN(numValue) && !isNaN(ruleNumValue) && numValue > ruleNumValue;
            case 'lessThan':
                return !isNaN(numValue) && !isNaN(ruleNumValue) && numValue < ruleNumValue;
            case 'greaterOrEqual':
                return !isNaN(numValue) && !isNaN(ruleNumValue) && numValue >= ruleNumValue;
            case 'lessOrEqual':
                return !isNaN(numValue) && !isNaN(ruleNumValue) && numValue <= ruleNumValue;
            case 'between':
                return !isNaN(numValue) && !isNaN(ruleNumValue) && !isNaN(ruleNumValue2) &&
                    numValue >= ruleNumValue && numValue <= ruleNumValue2;

            // Multi-select (legacy/backward compatibility)
            case 'multiSelect':
                const values = cf.selectedValues || [];
                return values.length === 0 || values.includes(rawValue);

            default:
                return true;
        }
    });
}

// Number filters - uses numFilters defined above
for (const nf of numFilters) {
    if (!nf.column) continue;

    rows = rows.filter(row => {
        const rawValue = String(row[nf.column] ?? '');
        const numValue = parseFloat(rawValue);
        const ruleNumValue = parseFloat(nf.value || '0');
        const ruleNumValue2 = nf.value2 ? parseFloat(nf.value2) : 0;

        switch (nf.operator) {
            case 'greaterThan':
                return !isNaN(numValue) && !isNaN(ruleNumValue) && numValue > ruleNumValue;
            case 'lessThan':
                return !isNaN(numValue) && !isNaN(ruleNumValue) && numValue < ruleNumValue;
            case 'greaterOrEqual':
                return !isNaN(numValue) && !isNaN(ruleNumValue) && numValue >= ruleNumValue;
            case 'lessOrEqual':
                return !isNaN(numValue) && !isNaN(ruleNumValue) && numValue <= ruleNumValue;
            case 'equals':
                return !isNaN(numValue) && !isNaN(ruleNumValue) && numValue === ruleNumValue;
            case 'notEquals':
                return isNaN(numValue) || isNaN(ruleNumValue) || numValue !== ruleNumValue;
            case 'between':
                return !isNaN(numValue) && !isNaN(ruleNumValue) && !isNaN(ruleNumValue2) &&
                    numValue >= ruleNumValue && numValue <= ruleNumValue2;
            case 'notEmpty':
                return rawValue.trim().length > 0 && !isNaN(numValue);
            case 'isEmpty':
                return rawValue.trim().length === 0 || isNaN(numValue);
            default:
                return true;
        }
    });
}

return sortRowsByRules(rows, sortRules);
}

export function generateExportData(
    config: Pick<GalleryConfig, "viewMode" | "matrixRowColumn" | "matrixColColumn" | "dateColumn" | "imageColumn" | "groupColumn">,
    processedRows: DataRow[],
    columns: string[],
    sortDateKeysFn: (keys: string[]) => string[],
    sortRowsFn: (rows: DataRow[]) => DataRow[],
): { headers: string[]; rows: string[][] } {
// Helper to convert image URL to =IMAGE() formula
const toImageFormula = (val: unknown): string => {
    if (!val) return '';
    const s = String(val);
    // Check if it's already an IMAGE formula
    if (s.toUpperCase().startsWith('=IMAGE(')) return s;
    // Check if it's a URL that looks like an image
    if (s.startsWith('http') && /\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?.*)?$/i.test(s)) {
        return `=IMAGE("${s}")`;
    }
    // Check for Gyazo/Imgur URLs
    if (s.startsWith('http') && (/gyazo\.com/i.test(s) || /imgur\.com/i.test(s))) {
        return `=IMAGE("${s}")`;
    }
    return s;
};

if (config.viewMode === 'matrix' && config.matrixRowColumn && config.matrixColColumn) {
    // Matrix format - Export as flat rows with row/col labels
    // Each image gets its own row to avoid cell overflow
    const headers = [config.matrixRowColumn, config.matrixColColumn, ...columns.filter(c => c !== config.matrixRowColumn && c !== config.matrixColColumn)];
    const dataRows: string[][] = [];

    for (const row of processedRows) {
        const rowKey = String(row[config.matrixRowColumn] || '');
        const colKey = String(row[config.matrixColColumn] || '');
        if (!rowKey || !colKey) continue;

        const rowData = [rowKey, colKey];
        for (const col of columns) {
            if (col === config.matrixRowColumn || col === config.matrixColColumn) continue;
            const val = row[col];
            // Convert image column to IMAGE formula
            if (col === config.imageColumn) {
                rowData.push(toImageFormula(val));
            } else {
                rowData.push(String(val || ''));
            }
        }
        dataRows.push(rowData);
    }

    return { headers, rows: dataRows };
} else if (config.viewMode === 'timeline' && config.dateColumn) {
    // Timeline format: grouped by date, each row with date prefix
    const groups = new Map<string, DataRow[]>();
    for (const row of processedRows) {
        const dateVal = row[config.dateColumn];
        const dateKey = dateVal ? String(dateVal).slice(0, 10) : '未知日期';
        if (!groups.has(dateKey)) groups.set(dateKey, []);
        groups.get(dateKey)!.push(row);
    }

    const sortedDates = sortDateKeysFn([...groups.keys()]);

    // Headers: Date + all columns
    const headers = ['日期', ...columns];

    // Each row with date prefix, image column as IMAGE formula
    const dataRows: string[][] = [];
    for (const date of sortedDates) {
        const groupRows = sortRowsFn(groups.get(date)!);
        for (const row of groupRows) {
            const rowData = [date];
            for (const col of columns) {
                const val = row[col];
                if (col === config.imageColumn) {
                    rowData.push(toImageFormula(val));
                } else {
                    rowData.push(String(val || ''));
                }
            }
            dataRows.push(rowData);
        }
    }

    return { headers, rows: dataRows };
} else if (config.viewMode === 'calendar') {
    // Calendar format - same as timeline but possibly include groupColumn
    const headers = config.groupColumn
        ? ['日期', config.groupColumn, ...columns.filter(c => c !== config.groupColumn)]
        : ['日期', ...columns];

    const dataRows: string[][] = [];
    for (const row of processedRows) {
        const dateVal = row[config.dateColumn];
        const dateKey = dateVal ? String(dateVal).slice(0, 10) : '';

        const rowData: string[] = [dateKey];
        if (config.groupColumn) {
            rowData.push(String(row[config.groupColumn] || ''));
        }

        for (const col of columns) {
            if (config.groupColumn && col === config.groupColumn) continue;
            const val = row[col];
            if (col === config.imageColumn) {
                rowData.push(toImageFormula(val));
            } else {
                rowData.push(String(val || ''));
            }
        }
        dataRows.push(rowData);
    }

    return { headers, rows: dataRows };
} else {
    // Raw format: all filtered data, each row separate
    const headers = columns;
    const dataRows = processedRows.map(row =>
        columns.map(col => {
            const val = row[col];
            if (col === config.imageColumn) {
                return toImageFormula(val);
            }
            return String(val || '');
        })
    );
    return { headers, rows: dataRows };
}
}
