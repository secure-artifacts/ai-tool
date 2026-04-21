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

export function computeTimelineData(
    processedRows: DataRow[], dateColumn: string, imageColumn: string, accountColumn: string, dateBinning: boolean, dateBins: DateBinRange[], sortDateKeysFn: (keys: string[]) => string[], sortRowsFn: (rows: DataRow[]) => DataRow[]
) {
if (!dateColumn || !imageColumn) {
    return new Map<string, { rows: DataRow[]; accounts: Set<string>; date: Date | null }>();
}

const byDate = new Map<string, { rows: DataRow[]; accounts: Set<string>; date: Date | null }>();

// Helper to get date bin key
const getDateBinKey = (date: Date | null): string => {
    if (!date) return '无效日期';

    if (dateBinning && dateBins.length > 0) {
        const dateTime = date.getTime();

        for (const bin of dateBins) {
            const startTime = new Date(bin.startDate).getTime();
            const endTime = new Date(bin.endDate).getTime() + 86400000 - 1; // End of day
            if (dateTime >= startTime && dateTime <= endTime) {
                // Generate label from dates directly (M/D-M/D format)
                const startD = new Date(bin.startDate);
                const endD = new Date(bin.endDate);
                return `${startD.getMonth() + 1}/${startD.getDate()}-${endD.getMonth() + 1}/${endD.getDate()}`;
            }
        }
        return '其他'; // Outside all defined ranges
    }

    return formatDateKey(date);
};

for (const row of processedRows) {
    const dateVal = row[dateColumn];
    const date = parseDate(dateVal);
    const dateKey = date ? getDateBinKey(date) : formatDateValue(dateVal);

    if (!byDate.has(dateKey)) {
        byDate.set(dateKey, { rows: [], accounts: new Set(), date });
    }

    const group = byDate.get(dateKey)!;
    group.rows.push(row);

    if (accountColumn) {
        const account = String(row[accountColumn] || '');
        if (account) group.accounts.add(account);
    }
}

for (const group of byDate.values()) {
    group.rows = sortRowsFn(group.rows);
}

// Sort by bin order if date binning is enabled, otherwise by date
if (dateBinning && dateBins.length > 0) {
    // Generate labels from dates for sorting
    const binOrder = dateBins.map(b => {
        const startD = new Date(b.startDate);
        const endD = new Date(b.endDate);
        return `${startD.getMonth() + 1}/${startD.getDate()}-${endD.getMonth() + 1}/${endD.getDate()}`;
    });
    const ordered = new Map<string, { rows: DataRow[]; accounts: Set<string>; date: Date | null }>();
    const sortedKeys = [...byDate.keys()].sort((a, b) => {
        const idxA = binOrder.indexOf(a);
        const idxB = binOrder.indexOf(b);
        if (idxA === -1 && idxB === -1) return a.localeCompare(b, undefined, { numeric: true });
        if (idxA === -1) return 1; // '其他' goes last
        if (idxB === -1) return -1;
        return idxA - idxB;
    });
    for (const key of sortedKeys) {
        ordered.set(key, byDate.get(key)!);
    }
    return ordered;
}

const ordered = new Map<string, { rows: DataRow[]; accounts: Set<string>; date: Date | null }>();
for (const key of sortDateKeysFn([...byDate.keys()])) {
    ordered.set(key, byDate.get(key)!);
}
return ordered;
}

export function computeGroupedTimelineData(
    processedRows: DataRow[], groupColumn: string, primaryGroupColumn: string, groupLevels: GroupLevel[], dateColumn: string, imageColumn: string, sortRules: SortRule[], dateBinning: boolean, dateBins: DateBinRange[], sortDateKeysFn: (keys: string[]) => string[], sortRowsFn: (rows: DataRow[]) => DataRow[], textGrouping: boolean, textGroupBins: TextGroupBin[]
) {
if (!primaryGroupColumn || !dateColumn || !imageColumn) {
    return [] as { key: string; label: string; sortKey?: number; dateGroups: Map<string, { rows: DataRow[]; date: Date | null }> }[];
}

// First, group by groupColumn
const primaryGroups = new Map<string, {
    rows: DataRow[];
    sortKey?: number;
    label: string;
    type: 'numbered' | 'date' | 'text' | 'number';
}>();

// Build textGroupBins order map for sorting (index = priority)
const textGroupOrder = new Map<string, number>();
if (textGrouping && textGroupBins.length > 0) {
    textGroupBins.forEach((g, idx) => textGroupOrder.set(g.label, idx));
    textGroupOrder.set('未分组', textGroupBins.length); // Put "未分组" at end
}

for (const row of processedRows) {
    // When using textGrouping, use getRowGroupKey to get the mapped label
    let key: string;
    let sortKey: number | undefined;
    let label: string;
    let type: 'numbered' | 'date' | 'text' | 'number' = 'text';

    if (textGrouping && textGroupBins.length > 0) {
        // Inline text grouping logic (same as getRowGroupKey)
        const cellValue = String(row[primaryGroupColumn] || '').trim();
        const cellValueLower = cellValue.toLowerCase();
        const cellNumValue = parseFloat(cellValue.replace(/[^\d.-]/g, ''));

        let matchedLabel = '未分组';
        for (const group of textGroupBins) {
            // Check exact match
            if (group.values.includes(cellValue)) {
                matchedLabel = group.label;
                break;
            }
            // Check conditions
            if (group.conditions && group.conditions.length > 0) {
                let matched = false;
                for (const cond of group.conditions) {
                    if (!cond.value) continue;
                    const condValueLower = cond.value.toLowerCase();
                    const condNumValue = parseFloat(cond.value.replace(/[^\d.-]/g, ''));
                    switch (cond.operator) {
                        case 'contains': matched = cellValueLower.includes(condValueLower); break;
                        case 'equals': matched = cellValueLower === condValueLower; break;
                        case 'startsWith': matched = cellValueLower.startsWith(condValueLower); break;
                        case 'endsWith': matched = cellValueLower.endsWith(condValueLower); break;
                        case 'greaterThan': matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue > condNumValue; break;
                        case 'lessThan': matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue < condNumValue; break;
                        case 'greaterOrEqual': matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue >= condNumValue; break;
                        case 'lessOrEqual': matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue <= condNumValue; break;
                        case 'numEquals': matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue === condNumValue; break;
                    }
                    if (matched) break;
                }
                if (matched) {
                    matchedLabel = group.label;
                    break;
                }
            }
        }
        key = matchedLabel;
        label = key;
        sortKey = textGroupOrder.get(key);
    } else if (groupLevels.length > 0) {
        // 多级分组：内联处理第一层级的分组逻辑
        const firstLevel = groupLevels[0];
        const rawVal = row[firstLevel.column];

        if (firstLevel.type === 'numeric' && firstLevel.numericBins && firstLevel.numericBins.length > 0) {
            const numVal = parseFloat(String(rawVal));
            if (isNaN(numVal)) {
                key = '其他';
            } else {
                const bin = firstLevel.numericBins.find(b => numVal >= b.min && numVal <= b.max);
                key = bin ? bin.label : '其他';
            }
            label = key;
        } else if (firstLevel.type === 'date' && firstLevel.dateBins && firstLevel.dateBins.length > 0) {
            const dateVal = parseDate(rawVal);
            if (!dateVal) {
                key = '无效日期';
            } else {
                const dateTime = dateVal.getTime();
                const bin = firstLevel.dateBins.find(b => {
                    const start = new Date(b.startDate).getTime();
                    const end = new Date(b.endDate).getTime() + 86400000 - 1;
                    return dateTime >= start && dateTime <= end;
                });
                key = bin ? bin.label : '其他日期';
            }
            label = key;
        } else if (firstLevel.type === 'text' && firstLevel.textBins && firstLevel.textBins.length > 0) {
            const strVal = String(rawVal || '').trim();
            const strValLower = strVal.toLowerCase();
            const matchedBin = firstLevel.textBins.find(b => {
                if (b.conditions && b.conditions.length > 0) {
                    return b.conditions.some(cond => {
                        const condValLower = (cond.value || '').toLowerCase();
                        switch (cond.operator) {
                            case 'equals': return strValLower === condValLower;
                            case 'contains': return strValLower.includes(condValLower);
                            case 'startsWith': return strValLower.startsWith(condValLower);
                            case 'endsWith': return strValLower.endsWith(condValLower);
                            default: return false;
                        }
                    });
                }
                return (b.values || []).some(v => v === strVal);
            });
            key = matchedBin ? matchedBin.label : (strVal || '(空)');
            label = key;
        } else {
            // 默认文本分组：使用原始值
            const result = getGroupKey(row[primaryGroupColumn]);
            key = result?.key || String(rawVal || '').trim() || '(空)';
            label = result?.originalText || key;
            type = result?.type || 'text';
        }
    } else {
        const result = getGroupKey(row[primaryGroupColumn]);
        key = result?.key || '未分组';
        sortKey = result?.sortKey;
        label = result?.originalText || key;
        type = result?.type || 'text';
    }

    if (!primaryGroups.has(key)) {
        primaryGroups.set(key, {
            rows: [],
            sortKey,
            label,
            type
        });
    }
    primaryGroups.get(key)!.rows.push(row);
}

// Sort primary groups (by sortKey when available, then alphabetically)
const groupSortRule = sortRules.find(r => r.column === primaryGroupColumn);

const sortedEntries = [...primaryGroups.entries()].sort((a, b) => {
    const aData = a[1], bData = b[1];
    const aKey = aData.sortKey, bKey = bData.sortKey;

    if (aKey !== undefined && bKey !== undefined) {
        return groupSortRule?.descending ? bKey - aKey : aKey - bKey;
    }
    if (aKey !== undefined) return -1;
    if (bKey !== undefined) return 1;

    return a[0].localeCompare(b[0], 'zh-CN', { numeric: true });
});

// Helper to get date bin key for secondary grouping
const getSecondaryDateKey = (date: Date | null, dateVal: unknown): string => {
    if (!date) return formatDateValue(dateVal);

    if (dateBinning && dateBins.length > 0) {
        const dateTime = date.getTime();
        for (const bin of dateBins) {
            const startTime = new Date(bin.startDate).getTime();
            const endTime = new Date(bin.endDate).getTime() + 86400000 - 1;
            if (dateTime >= startTime && dateTime <= endTime) {
                const startD = new Date(bin.startDate);
                const endD = new Date(bin.endDate);
                return `${startD.getMonth() + 1}/${startD.getDate()}-${endD.getMonth() + 1}/${endD.getDate()}`;
            }
        }
        return '其他';
    }

    return formatDateKey(date);
};

// For each primary group, create secondary date groups
return sortedEntries.map(([key, group]) => {
    const dateGroups = new Map<string, { rows: DataRow[]; date: Date | null }>();

    for (const row of group.rows) {
        const dateVal = row[dateColumn];
        const date = parseDate(dateVal);
        const dateKey = getSecondaryDateKey(date, dateVal);

        if (!dateGroups.has(dateKey)) {
            dateGroups.set(dateKey, { rows: [], date });
        }
        dateGroups.get(dateKey)!.rows.push(row);
    }

    // Sort each date group's rows
    for (const dg of dateGroups.values()) {
        dg.rows = sortRowsFn(dg.rows);
    }

    // Sort date groups - by bin order if binning enabled, otherwise by date
    let sortedDateGroups: Map<string, { rows: DataRow[]; date: Date | null }>;
    if (dateBinning && dateBins.length > 0) {
        const binOrder = dateBins.map(b => {
            const startD = new Date(b.startDate);
            const endD = new Date(b.endDate);
            return `${startD.getMonth() + 1}/${startD.getDate()}-${endD.getMonth() + 1}/${endD.getDate()}`;
        });
        const sortedKeys = [...dateGroups.keys()].sort((a, b) => {
            const idxA = binOrder.indexOf(a);
            const idxB = binOrder.indexOf(b);
            if (idxA === -1 && idxB === -1) return a.localeCompare(b, undefined, { numeric: true });
            if (idxA === -1) return 1;
            if (idxB === -1) return -1;
            return idxA - idxB;
        });
        sortedDateGroups = new Map();
        for (const k of sortedKeys) {
            sortedDateGroups.set(k, dateGroups.get(k)!);
        }
    } else {
        sortedDateGroups = new Map<string, { rows: DataRow[]; date: Date | null }>();
        for (const dateKey of sortDateKeysFn([...dateGroups.keys()])) {
            sortedDateGroups.set(dateKey, dateGroups.get(dateKey)!);
        }
    }

    return {
        key,
        label: group.label,
        sortKey: group.sortKey,
        dateGroups: sortedDateGroups
    };
});
}

export function computeMatrixData(
    processedRows: DataRow[], config: Pick<GalleryConfig, "viewMode" | "matrixRowColumn" | "matrixColColumn" | "sortRules">, groupColumn: string, textGrouping: boolean, textGroupBins: TextGroupBin[], sortRowsFn: (rows: DataRow[]) => DataRow[]
) {
if (config.viewMode !== 'matrix' || !config.matrixRowColumn || !config.matrixColColumn) {
    return { rowKeys: [] as string[], colKeys: [] as string[], cells: new Map<string, DataRow[]>(), rowLabels: new Map<string, string>(), colLabels: new Map<string, string>() };
}

// Find sort rules for matrix axes
const rowSortRule = config.sortRules.find(r => r.column === config.matrixRowColumn);
const colSortRule = config.sortRules.find(r => r.column === config.matrixColColumn);

// Collect row groups with type tracking
const rowGroups = new Map<string, {
    rows: DataRow[];
    sortKey?: number;
    type: 'numbered' | 'date' | 'text' | 'number';
    originalTexts: Set<string>;
    representativeValue?: string | number | boolean | null;
}>();
// Collect col groups with type tracking
const colGroups = new Map<string, {
    sortKey?: number;
    type: 'numbered' | 'date' | 'text' | 'number';
    originalTexts: Set<string>;
    representativeValue?: string | number | boolean | null;
}>();
const cells = new Map<string, DataRow[]>();

// Check if using group settings for row grouping
const useGroupSettingsForRow = config.matrixRowColumn === '__GROUP_SETTINGS__';

for (const row of processedRows) {
    // Process row key - use getRowGroupKey if "__GROUP_SETTINGS__" is selected
    let rowKey: string;
    let rowType: 'numbered' | 'date' | 'text' | 'number' = 'text';
    let rowSortKey: number | undefined;
    let rowOriginalText: string | undefined;

    if (useGroupSettingsForRow) {
        // Inline text grouping logic (same as getRowGroupKey)
        if (textGrouping && textGroupBins.length > 0 && groupColumn) {
            const cellValue = String(row[groupColumn] || '').trim();
            const cellValueLower = cellValue.toLowerCase();
            const cellNumValue = parseFloat(cellValue.replace(/[^\d.-]/g, ''));

            let foundGroup = false;
            for (let binIdx = 0; binIdx < textGroupBins.length; binIdx++) {
                const group = textGroupBins[binIdx];
                // Check exact match
                if (group.values.includes(cellValue)) {
                    rowKey = group.label;
                    rowSortKey = binIdx;
                    rowType = 'numbered';
                    foundGroup = true;
                    break;
                }
                // Check conditions
                if (group.conditions && group.conditions.length > 0) {
                    for (const cond of group.conditions) {
                        if (!cond.value) continue;
                        let matched = false;
                        const condValueLower = cond.value.toLowerCase();
                        const condNumValue = parseFloat(cond.value.replace(/[^\d.-]/g, ''));
                        switch (cond.operator) {
                            case 'contains': matched = cellValueLower.includes(condValueLower); break;
                            case 'equals': matched = cellValueLower === condValueLower; break;
                            case 'startsWith': matched = cellValueLower.startsWith(condValueLower); break;
                            case 'endsWith': matched = cellValueLower.endsWith(condValueLower); break;
                            case 'greaterThan': matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue > condNumValue; break;
                            case 'lessThan': matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue < condNumValue; break;
                            case 'greaterOrEqual': matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue >= condNumValue; break;
                            case 'lessOrEqual': matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue <= condNumValue; break;
                            case 'numEquals': matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue === condNumValue; break;
                        }
                        if (matched) {
                            rowKey = group.label;
                            rowSortKey = binIdx;
                            rowType = 'numbered';
                            foundGroup = true;
                            break;
                        }
                    }
                    if (foundGroup) break;
                }
            }
            if (!foundGroup) {
                rowKey = '未分组';
                rowSortKey = textGroupBins.length;
            }
        } else {
            // Fallback to regular groupKey
            const result = getGroupKey(row[groupColumn]);
            rowKey = result?.key || '未分组';
        }
    } else {
        const rowResult = getGroupKey(row[config.matrixRowColumn]);
        rowKey = rowResult?.key || String(row[config.matrixRowColumn] || '');
        rowType = rowResult?.type || 'text';
        rowSortKey = rowResult?.sortKey;
        rowOriginalText = rowResult?.originalText;
    }

    // Process col key with getGroupKey
    const colResult = getGroupKey(row[config.matrixColColumn]);
    const colKey = colResult?.key || String(row[config.matrixColColumn] || '');
    const colType = colResult?.type || 'text';

    if (!rowKey || !colKey) continue;

    // Track row groups
    if (!rowGroups.has(rowKey)) {
        rowGroups.set(rowKey, {
            rows: [],
            sortKey: rowSortKey,
            type: rowType,
            originalTexts: new Set(),
            representativeValue: useGroupSettingsForRow ? rowKey : row[config.matrixRowColumn]
        });
    }
    const rg = rowGroups.get(rowKey)!;
    rg.rows.push(row);
    if (rowOriginalText) rg.originalTexts.add(rowOriginalText);

    // Track col groups
    if (!colGroups.has(colKey)) {
        colGroups.set(colKey, {
            sortKey: colResult?.sortKey,
            type: colType,
            originalTexts: new Set(),
            representativeValue: row[config.matrixColColumn]
        });
    }
    const cg = colGroups.get(colKey)!;
    if (colResult?.originalText) cg.originalTexts.add(colResult.originalText);

    // Track cells
    const cellKey = `${rowKey}|${colKey}`;
    if (!cells.has(cellKey)) {
        cells.set(cellKey, []);
    }
    cells.get(cellKey)!.push(row);
}

// Check if we have any numbered groups in each axis
const hasNumberedRows = [...rowGroups.values()].some(g => g.type === 'numbered');
const hasNumberedCols = [...colGroups.values()].some(g => g.type === 'numbered');

// Sort rows: numbered first by sortKey, support user sortRules for non-numbered
const sortedRows = [...rowGroups.keys()].sort((a, b) => {
    const aData = rowGroups.get(a)!, bData = rowGroups.get(b)!;
    const aKey = aData.sortKey, bKey = bData.sortKey;

    // If both have sortKey (numbered groups), sort by number (respecting sort direction)
    if (aKey !== undefined && bKey !== undefined) {
        return rowSortRule?.descending ? bKey - aKey : aKey - bKey;
    }
    if (aKey !== undefined) return -1;
    if (bKey !== undefined) return 1;

    // For non-numbered groups, apply user sortRule if available
    if (rowSortRule && !hasNumberedRows) {
        const aVal = aData.representativeValue;
        const bVal = bData.representativeValue;

        // Try date comparison
        const aDate = parseDate(aVal);
        const bDate = parseDate(bVal);
        if (aDate && bDate) {
            return rowSortRule.descending ? bDate.getTime() - aDate.getTime() : aDate.getTime() - bDate.getTime();
        }

        // Try number comparison
        const aNum = parseFloat(String(aVal));
        const bNum = parseFloat(String(bVal));
        if (!isNaN(aNum) && !isNaN(bNum)) {
            return rowSortRule.descending ? bNum - aNum : aNum - bNum;
        }

        // String comparison
        const aStr = String(aVal || '');
        const bStr = String(bVal || '');
        const cmp = aStr.localeCompare(bStr, 'zh-CN', { numeric: true });
        return rowSortRule.descending ? -cmp : cmp;
    }

    return a.localeCompare(b, 'zh-CN', { numeric: true });
});

// Sort cols: for dates reverse (newest first), for numbered by sortKey, support user sortRules
const sortedCols = [...colGroups.keys()].sort((a, b) => {
    const aData = colGroups.get(a)!, bData = colGroups.get(b)!;
    const aKey = aData.sortKey, bKey = bData.sortKey;

    // If both have sortKey (numbered groups), sort by number (respecting sort direction)
    if (aKey !== undefined && bKey !== undefined) {
        return colSortRule?.descending ? bKey - aKey : aKey - bKey;
    }
    if (aKey !== undefined) return -1;
    if (bKey !== undefined) return 1;

    // Check if dates - default to reverse order (newest first) unless user specifies otherwise
    if (/^\d{4}-\d{2}-\d{2}$/.test(a) && /^\d{4}-\d{2}-\d{2}$/.test(b)) {
        // If user has a sort rule for the column, respect it
        if (colSortRule) {
            return colSortRule.descending ? b.localeCompare(a, undefined, { numeric: true }) : a.localeCompare(b, undefined, { numeric: true });
        }
        return b.localeCompare(a, undefined, { numeric: true }); // Default: newest first
    }

    // For non-numbered, non-date groups, apply user sortRule if available
    if (colSortRule && !hasNumberedCols) {
        const aVal = aData.representativeValue;
        const bVal = bData.representativeValue;

        // Try number comparison
        const aNum = parseFloat(String(aVal));
        const bNum = parseFloat(String(bVal));
        if (!isNaN(aNum) && !isNaN(bNum)) {
            return colSortRule.descending ? bNum - aNum : aNum - bNum;
        }

        // String comparison
        const aStr = String(aVal || '');
        const bStr = String(bVal || '');
        const cmp = aStr.localeCompare(bStr, 'zh-CN');
        return colSortRule.descending ? -cmp : cmp;
    }

    return a.localeCompare(b, 'zh-CN');
});

// Sort each cell's rows using user's sortRules
for (const [cellKey, cellRows] of cells.entries()) {
    cells.set(cellKey, sortRowsFn(cellRows));
}

// Build labels using shortest originalText
const rowLabels = new Map<string, string>();
for (const [key, group] of rowGroups) {
    if (group.originalTexts.size > 0) {
        const texts = Array.from(group.originalTexts);
        rowLabels.set(key, texts.reduce((a, b) => a.length <= b.length ? a : b));
    } else {
        rowLabels.set(key, key);
    }
}

const colLabels = new Map<string, string>();
for (const [key, group] of colGroups) {
    if (group.originalTexts.size > 0) {
        const texts = Array.from(group.originalTexts);
        colLabels.set(key, texts.reduce((a, b) => a.length <= b.length ? a : b));
    } else {
        colLabels.set(key, key);
    }
}

return { rowKeys: sortedRows, colKeys: sortedCols, cells, rowLabels, colLabels };
}

export function generateViewLayoutText(
    layoutMode: 'horizontal' | 'vertical' | 'columns',
    columnsPerRow: number,
    includeExtraData: boolean,
    selectedColumns: string[],
    applyOverrides: boolean,
    processedRows: DataRow[],
    effectiveGroupColumns: string[],
    effectiveGroupLevels: GroupLevel[],
    effectiveImageColumn: string,
    classificationOverrides: Record<string, string>,
    customOrderByGroup: Record<string, string[]>
): { text: string; groupCount: number; totalImages: number; error: string | null } {
const primaryGroupColumn = effectiveGroupColumns[0];

if (!effectiveImageColumn) {
    return { text: '', groupCount: 0, totalImages: 0, error: '❌ 请先配置图片列' };



}

// Multi-level grouping helper (inline version of getRowGroupKey logic)
const useMultiLevelLogic = effectiveGroupLevels.length > 1 ||
    (effectiveGroupLevels.length === 1 && (
        effectiveGroupLevels[0].numericBins?.length ||
        effectiveGroupLevels[0].dateBins?.length ||
        effectiveGroupLevels[0].textBins?.length
    ));

const getGroupKeyForRow = (row: DataRow): string => {
    if (useMultiLevelLogic && effectiveGroupLevels.length > 0) {
        const keys: string[] = [];
        for (const level of effectiveGroupLevels) {
            const rawVal = row[level.column];
            let key = '';

            if (level.type === 'numeric' && level.numericBins && level.numericBins.length > 0) {
                const numVal = parseFloat(String(rawVal));
                if (isNaN(numVal)) {
                    key = '其他';
                } else {
                    const bin = level.numericBins.find(b => numVal >= b.min && numVal <= b.max);
                    key = bin ? bin.label : '其他';
                }
            } else if (level.type === 'date' && level.dateBins && level.dateBins.length > 0) {
                const dateVal = parseDate(rawVal);
                if (!dateVal) {
                    key = '无效日期';
                } else {
                    const dateTime = dateVal.getTime();
                    const bin = level.dateBins.find(b => {
                        const start = new Date(b.startDate).getTime();
                        const end = new Date(b.endDate).getTime() + 86400000 - 1;
                        return dateTime >= start && dateTime <= end;
                    });
                    key = bin ? bin.label : '其他日期';
                }
            } else if (level.type === 'text' && level.textBins && level.textBins.length > 0) {
                const groupResult = getGroupKey(rawVal);
                const strVal = groupResult?.originalText || groupResult?.key || String(rawVal || '').trim();
                const strValLower = strVal.toLowerCase();
                const matchedBin = level.textBins.find(b => {
                    if (b.conditions && b.conditions.length > 0) {
                        return b.conditions.some(cond => {
                            const condValLower = (cond.value || '').toLowerCase();
                            switch (cond.operator) {
                                case 'equals': return strValLower === condValLower;
                                case 'contains': return strValLower.includes(condValLower);
                                case 'startsWith': return strValLower.startsWith(condValLower);
                                case 'endsWith': return strValLower.endsWith(condValLower);
                                default: return false;
                            }
                        });
                    }
                    return (b.values || []).some(v => v === strVal);
                });
                key = matchedBin ? matchedBin.label : (strVal || '(空)');
            } else {
                const groupResult = getGroupKey(rawVal);
                key = groupResult?.originalText || groupResult?.key || String(rawVal || '').trim() || '(空)';
            }

            keys.push(key);
        }
        return keys.join(' › ');
    }

    // Simple grouping: use primary group column
    return primaryGroupColumn
        ? String(row[primaryGroupColumn] || '未分组')
        : '全部图片';
};

// Group rows by multi-level group key (considering classification overrides)
const groups = new Map<string, DataRow[]>();
processedRows.forEach(row => {
    const imageUrl = extractImageUrl(row[effectiveImageColumn]);
    let groupKey: string;

    // Apply classification overrides if enabled
    if (applyOverrides && imageUrl && classificationOverrides[imageUrl]) {
        groupKey = classificationOverrides[imageUrl];
    } else {
        groupKey = getGroupKeyForRow(row);
    }

    if (!groups.has(groupKey)) groups.set(groupKey, []);
    groups.get(groupKey)!.push(row);
});

// Sort groups numerically
const sortedGroups = Array.from(groups.entries())
    .sort((a, b) => a[0].localeCompare(b[0], 'zh-CN', { numeric: true }));

// Apply custom ordering within each group
const orderedGroups = sortedGroups.map(([groupKey, rows]) => {
    const customOrder = customOrderByGroup[groupKey];
    if (customOrder && customOrder.length > 0) {
        // Sort rows by custom order
        const orderedRows = [...rows].sort((a, b) => {
            const urlA = extractImageUrl(a[effectiveImageColumn]) || '';
            const urlB = extractImageUrl(b[effectiveImageColumn]) || '';
            const indexA = customOrder.indexOf(urlA);
            const indexB = customOrder.indexOf(urlB);
            // Items not in custom order go to the end
            if (indexA === -1 && indexB === -1) return 0;
            if (indexA === -1) return 1;
            if (indexB === -1) return -1;
            return indexA - indexB;
        });
        return [groupKey, orderedRows] as [string, DataRow[]];
    }
    return [groupKey, rows] as [string, DataRow[]];
});

// Build the output rows
const outputRows: string[][] = [];

if (layoutMode === 'columns') {
    // Transposed mode: Categories as headers, images directly below
    const headerRow: string[] = [];
    const subHeaderRow: string[] = []; // Only used if includeExtraData

    // Parse formatted data per group
    const groupData = orderedGroups.map(([, rows]) => {
        return rows
            .map(row => {
                const url = extractImageUrl(row[effectiveImageColumn]);
                const formula = url ? `=IMAGE("${url}")` : '';
                const extraData: Record<string, string> = {};
                if (includeExtraData) {
                    selectedColumns.forEach(col => {
                        extraData[col] = String(row[col] || '');
                    });
                }
                return { formula, extraData };
            })
            .filter(item => item.formula);
    });

    // How many columns per group?
    const colsPerGroup = includeExtraData && selectedColumns.length > 0 ? 1 + selectedColumns.length : 1;

    orderedGroups.forEach(([groupKey]) => {
        headerRow.push(groupKey);
        for (let i = 1; i < colsPerGroup; i++) headerRow.push(groupKey); // Fill completely instead of empty padding for non-merged workflows

        if (includeExtraData && selectedColumns.length > 0) {
            selectedColumns.forEach(col => subHeaderRow.push(col));
            subHeaderRow.push('缩略图');
        }
    });

    outputRows.push(headerRow);
    if (subHeaderRow.length > 0) outputRows.push(subHeaderRow);

    const maxRows = Math.max(...groupData.map(d => d.length));

    for (let r = 0; r < maxRows; r++) {
        const dataRow: string[] = [];
        groupData.forEach((items) => {
            if (r < items.length) {
                if (includeExtraData && selectedColumns.length > 0) {
                    selectedColumns.forEach(col => {
                        dataRow.push(items[r].extraData[col] || '');
                    });
                    dataRow.push(items[r].formula);
                } else {
                    dataRow.push(items[r].formula);
                }
            } else {
                // Pad empty
                for (let c = 0; c < colsPerGroup; c++) dataRow.push('');
            }
        });
        outputRows.push(dataRow);
    }
} else {
    orderedGroups.forEach(([groupKey, rows]) => {
        // Extract rows with their image URLs and data
        const rowsWithImages = rows
            .map(row => {
                const url = extractImageUrl(row[effectiveImageColumn]);
                const formula = url ? `=IMAGE("${url}")` : '';
                const extraData: Record<string, string> = {};
                if (includeExtraData) {
                    selectedColumns.forEach(col => {
                        extraData[col] = String(row[col] || '');
                    });
                }
                return { formula, extraData, row };
            })
            .filter(item => item.formula);

        if (rowsWithImages.length === 0) return;

        if (layoutMode === 'vertical') {
            // Vertical mode: group header row + item rows below it
            outputRows.push(['分组', groupKey]);
            if (includeExtraData && selectedColumns.length > 0) {
                outputRows.push(['序号', ...selectedColumns, '缩略图']);
                rowsWithImages.forEach((item, idx) => {
                    outputRows.push([
                        String(idx + 1),
                        ...selectedColumns.map(colName => item.extraData[colName] || ''),
                        item.formula
                    ]);
                });
            } else {
                outputRows.push(['序号', '缩略图']);
                rowsWithImages.forEach((item, idx) => {
                    outputRows.push([String(idx + 1), item.formula]);
                });
            }
            outputRows.push([]);
            return;
        }

        // Horizontal mode: thumbnails in grid rows
        for (let i = 0; i < rowsWithImages.length; i += columnsPerRow) {
            const chunk = rowsWithImages.slice(i, i + columnsPerRow);

            if (includeExtraData && selectedColumns.length > 0) {
                // Add column name labels in first column, with groupKey prepended
                selectedColumns.forEach(colName => {
                    const dataRow = [groupKey, colName];
                    chunk.forEach(item => {
                        dataRow.push(item.extraData[colName] || '');
                    });
                    while (dataRow.length < columnsPerRow + 2) {
                        dataRow.push('');
                    }
                    outputRows.push(dataRow);
                });

                // Add image row with groupKey prepended
                const imageRow = [groupKey, '缩略图'];
                chunk.forEach(item => {
                    imageRow.push(item.formula);
                });
                while (imageRow.length < columnsPerRow + 2) {
                    imageRow.push('');
                }
                outputRows.push(imageRow);
            } else {
                // Images only - prepend groupKey as first column
                const rowImages = [groupKey];
                chunk.forEach(item => {
                    rowImages.push(item.formula);
                });
                while (rowImages.length < columnsPerRow + 1) {
                    rowImages.push('');
                }
                outputRows.push(rowImages);
            }
        }
    });
}

if (layoutMode === 'vertical') {
    while (outputRows.length > 0 && outputRows[outputRows.length - 1].length === 0) {
        outputRows.pop();
    }
}

// Convert to TSV format
const text = outputRows.map(row => row.join('\t')).join('\n');
    const groupCount = orderedGroups.length;
    const totalImages = orderedGroups.reduce((sum, [, rows]) => {
        return sum + rows.filter(row => !!extractImageUrl(row[effectiveImageColumn])).length;
    }, 0);

    return { text, groupCount, totalImages, error: null };
}


export function computeCalendarGrid(mode: string, selectedDate: string, calendarMonth: Date) {
    const selDate = selectedDate ? new Date(selectedDate) : new Date();

    if (mode === 'month') {
        const year = calendarMonth.getFullYear();
        const month = calendarMonth.getMonth();
        const firstDay = new Date(year, month, 1).getDay();
        const daysInMonth = new Date(year, month + 1, 0).getDate();

        const weeks: (number | null)[][] = [];
        let week: (number | null)[] = new Array(firstDay).fill(null);

        for (let day = 1; day <= daysInMonth; day++) {
            week.push(day);
            if (week.length === 7) {
                weeks.push(week);
                week = [];
            }
        }
        if (week.length > 0) {
            while (week.length < 7) week.push(null);
            weeks.push(week);
        }

        return { type: 'month' as const, year, month, weeks };
    } else if (mode === 'day') {
        return { type: 'day' as const, dates: [selDate] };
    } else if (mode === 'week') {
        const startOfWeek = new Date(selDate);
        startOfWeek.setDate(selDate.getDate() - selDate.getDay());
        const dates = [];
        for (let i = 0; i < 7; i++) {
            const d = new Date(startOfWeek);
            d.setDate(startOfWeek.getDate() + i);
            dates.push(d);
        }
        return { type: 'week' as const, dates };
    } else if (mode === 'range7') {
        const dates = [];
        for (let i = -3; i <= 3; i++) {
            const d = new Date(selDate);
            d.setDate(selDate.getDate() + i);
            dates.push(d);
        }
        return { type: 'range7' as const, dates };
    } else {
        // scroll mode
        return { type: 'scroll' as const, dates: [] };
    }
}


export function computeRowGroupKey(
    row: DataRow,
    effectiveGroupLevels: GroupLevel[],
    effectiveGroupColumn: string,
    effectiveGroupBinning: boolean,
    effectiveGroupBins: GroupBinRange[],
    effectiveTextGrouping: boolean,
    effectiveTextGroupBins: TextGroupBin[],
    getGroupKey: (val: any) => { key: string, originalText: string } | null
): string {
    const useMultiLevelLogic = effectiveGroupLevels.length > 1 ||
        (effectiveGroupLevels.length === 1 && (
            effectiveGroupLevels[0].numericBins?.length ||
            effectiveGroupLevels[0].dateBins?.length ||
            effectiveGroupLevels[0].textBins?.length
        ));

    if (useMultiLevelLogic && effectiveGroupLevels.length > 0) {
        const keys: string[] = [];
        for (const level of effectiveGroupLevels) {
            const rawVal = row[level.column];
            let key = '';

            if (level.type === 'numeric' && level.numericBins && level.numericBins.length > 0) {
                const numVal = parseFloat(String(rawVal));
                if (isNaN(numVal)) {
                    key = '其他';
                } else {
                    const bin = level.numericBins.find(b => numVal >= b.min && numVal <= b.max);
                    key = bin ? bin.label : '其他';
                }
            } else if (level.type === 'date' && level.dateBins && level.dateBins.length > 0) {
                const dateVal = parseDate(rawVal);
                if (!dateVal) {
                    key = '无效日期';
                } else {
                    const dateTime = dateVal.getTime();
                    const bin = level.dateBins.find(b => {
                        const start = new Date(b.startDate).getTime();
                        const end = new Date(b.endDate).getTime() + 86400000 - 1;
                        return dateTime >= start && dateTime <= end;
                    });
                    key = bin ? bin.label : '其他日期';
                }
            } else if (level.type === 'text' && level.textBins && level.textBins.length > 0) {
                const groupResult = getGroupKey(rawVal);
                const strVal = groupResult?.originalText || groupResult?.key || String(rawVal || '').trim();
                const strValLower = strVal.toLowerCase();
                const matchedBin = level.textBins.find(b => {
                    if (b.conditions && b.conditions.length > 0) {
                        return b.conditions.some(cond => {
                            const condValLower = (cond.value || '').toLowerCase();
                            switch (cond.operator) {
                                case 'equals': return strValLower === condValLower;
                                case 'contains': return strValLower.includes(condValLower);
                                case 'startsWith': return strValLower.startsWith(condValLower);
                                case 'endsWith': return strValLower.endsWith(condValLower);
                                default: return false;
                            }
                        });
                    }
                    return (b.values || []).some(v => v === strVal);
                });
                key = matchedBin ? matchedBin.label : (strVal || '(空)');
            } else {
                const groupResult = getGroupKey(rawVal);
                key = groupResult?.originalText || groupResult?.key || String(rawVal || '').trim() || '(空)';
            }
            keys.push(key);
        }
        return keys.join(' › ');
    }

    if (!effectiveGroupColumn) return '未分组';

    if (effectiveGroupBinning && effectiveGroupBins.length > 0) {
        const val = parseFloat(String(row[effectiveGroupColumn]));
        if (isNaN(val)) return '其他';
        for (const bin of effectiveGroupBins) {
            if (val >= bin.min && val <= bin.max) {
                return bin.label;
            }
        }
        return '其他';
    }

    if (effectiveTextGrouping && effectiveTextGroupBins.length > 0) {
        const cellValue = String(row[effectiveGroupColumn] || '').trim();
        const cellValueLower = cellValue.toLowerCase();
        const cellNumValue = parseFloat(cellValue.replace(/[^\d.-]/g, ''));

        for (const group of effectiveTextGroupBins) {
            if (group.values.includes(cellValue)) {
                return group.label;
            }
            if (group.conditions && group.conditions.length > 0) {
                const matched = group.conditions.some(cond => {
                    const condValLower = (cond.value || '').toLowerCase();
                    const condNumVal = parseFloat(condValLower.replace(/[^\d.-]/g, ''));
                    switch (cond.operator) {
                        case 'equals': return cellValueLower === condValLower;
                        case 'contains': return cellValueLower.includes(condValLower);
                        case 'startsWith': return cellValueLower.startsWith(condValLower);
                        case 'endsWith': return cellValueLower.endsWith(condValLower);
                        case 'greaterThan': return !isNaN(cellNumValue) && !isNaN(condNumVal) && cellNumValue > condNumVal;
                        case 'greaterOrEqual': return !isNaN(cellNumValue) && !isNaN(condNumVal) && cellNumValue >= condNumVal;
                        case 'lessThan': return !isNaN(cellNumValue) && !isNaN(condNumVal) && cellNumValue < condNumVal;
                        case 'lessOrEqual': return !isNaN(cellNumValue) && !isNaN(condNumVal) && cellNumValue <= condNumVal;
                        default: return false;
                    }
                });
                if (matched) return group.label;
            }
        }
    }

    const val = row[effectiveGroupColumn];
    const groupResult = getGroupKey(val);
    return groupResult?.originalText || groupResult?.key || String(val || '未分组');
}
