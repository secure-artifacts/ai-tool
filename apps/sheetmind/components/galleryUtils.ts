// Gallery utility functions, constants, and types
// Extracted from MediaGalleryPanelV2.tsx for modularity

import { DataRow } from '../types';
import { SavedGalleryConfig, CloudFavoriteItem } from '../services/firebaseService';

export interface SortRule {
    column: string;
    descending: boolean;
}

export interface NumFilter {
    id: string;
    column: string;
    operator: 'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' | 'equals' | 'notEquals' | 'between' | 'notEmpty' | 'isEmpty';
    value: string;
    value2?: string; // For 'between' operator
}

// Bin range for numeric grouping (similar to Dashboard binning)
export interface GroupBinRange {
    id: string;
    label: string;
    min: number;
    max: number;
}

// Bin range for date grouping (custom date ranges)
export interface DateBinRange {
    id: string;
    label: string;
    startDate: string; // ISO date string (YYYY-MM-DD)
    endDate: string;   // ISO date string (YYYY-MM-DD)
}

// Condition for text group matching
export interface TextGroupCondition {
    id: string;
    operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' |
    'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' | 'numEquals';
    value: string;
}

// Text grouping - for categorizing text values into custom groups
export interface TextGroupBin {
    id: string;
    label: string;      // Group name
    values: string[];   // Cell values that belong to this group (exact match)
    keywords?: string[]; // Keywords for fuzzy matching (contains match) - legacy
    conditions?: TextGroupCondition[]; // Conditions with operators for flexible matching
}

// Multi-level grouping configuration
export interface GroupLevel {
    id: string;
    column: string;
    type: 'text' | 'numeric' | 'date';
    numericBins?: GroupBinRange[];
    textBins?: TextGroupBin[];
    dateBins?: DateBinRange[];
}

export interface CustomFilter {
    id: string;
    column: string;
    operator: 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' |
    'notEmpty' | 'isEmpty' | 'regex' | 'multiSelect' |
    'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' | 'between';
    value: string;
    value2?: string;  // For 'between' operator
    selectedValues?: string[];  // For 'multiSelect' mode (backward compatibility)
}

export interface HighlightRule {
    id: string;
    column: string;
    operator:
    // Text operators
    'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' | 'notEmpty' | 'isEmpty' | 'regex' |
    // Numeric operators
    'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' | 'between' |
    // Date operators
    'dateEquals' | 'dateBefore' | 'dateAfter' | 'today' | 'thisWeek' | 'thisMonth' |
    // Link operators
    'hasLink' | 'hasImageLink' | 'hasFormula';
    value: string;
    value2?: string;  // For 'between' operator
    color: string;  // Highlight color
    borderWidth?: number; // Border thickness in pixels (optional for compatibility)
    enabled?: boolean; // Whether this rule is active (default true)
}

export interface GalleryConfig {
    dateColumn: string;          // Column for date (日期列 - for calendar/timeline)
    groupColumn: string;         // Column for grouping (分组依据列) - 单级分组，向后兼容
    groupColumns: string[];      // Columns for multi-level grouping (多级分组) - 向后兼容
    groupLevels: GroupLevel[];   // Multi-level grouping with per-level config (新增)
    accountColumn: string;       // Column for account name display
    imageColumn: string;         // Column containing image URLs
    linkColumn: string;          // Column for post links
    labelColumns: string[];      // Columns to show as labels
    sortRules: SortRule[];       // Multi-level sort rules
    viewMode: 'timeline' | 'matrix' | 'calendar' | 'gallery' | 'tree'; // gallery = pure thumbnail grid, tree = nested multi-level grouping
    // Calendar options
    calendarMode: 'month' | 'week' | 'day' | 'range7' | 'scroll';
    selectedDate: string;
    scrollDaysPerView: number;   // Days visible in scroll view (1-5)
    // Matrix options - any column selectable
    matrixRowColumn: string;
    matrixColColumn: string;
    // Filters
    dateStart: string;
    dateEnd: string;
    customFilters: CustomFilter[];  // Multiple custom filters
    numFilters: NumFilter[];
    highlightRules: HighlightRule[]; // Highlight rules for conditional styling
    showAllImages: boolean;
    thumbnailSize: number;
    // Custom width settings
    matrixCellWidth: number;      // Matrix view cell min-width (default 280)
    scrollCardWidth: number;      // Scroll view card min-width (default 280)
    calendarCellHeight: number;   // Calendar month view cell min-height (default 100)
    // Gallery pagination
    galleryPageSize: number;      // -1 = progressive loading, 0 = all, or 100/200/300/500/1000
    // Group binning (numeric range grouping)
    groupBinning: boolean;        // Enable numeric binning for groupColumn
    groupBins: GroupBinRange[];   // Bin ranges for grouping
    // Text grouping (for text column - custom value mapping)
    textGrouping: boolean;        // Enable text value grouping
    textGroupBins: TextGroupBin[]; // Text groups with mapped values
    // Date binning (date range grouping for dateColumn)
    dateBinning: boolean;         // Enable date range binning
    dateBins: DateBinRange[];     // Date ranges for grouping
    // Multi-level grouping priority: 'date' = date first, 'column' = column first
    groupPriority: 'date' | 'column';
    // Global search keyword
    searchKeyword: string;  // Search across all text columns
    // Note icon display
    showNoteIcon: boolean;  // Show note icon on all thumbnails (default true)
    // Category/Tag feature
    showFavoriteIcon: boolean; // Show favorite icon on thumbnails (default true)
    showCategoryIcon: boolean;  // Show category icon on thumbnails (default true)
    categoryOptions: string[];  // User-defined category options
    categoryTargetColumn: string;  // Target column for category (fixed to 'B')
    // Thumbnail display mode
    thumbnailFit: 'cover' | 'contain';  // 'cover' = fill grid, 'contain' = original ratio
    // Label overlay on hover
    showLabelOverlay: boolean;  // Show label overlay on thumbnail hover (default true)
    // Hover preview - show enlarged image when hovering over thumbnail
    hoverPreview: boolean;  // Enable hover-to-enlarge preview (default false)
    // Group notes - user-defined notes for each group
    groupNotes: Record<string, string>;  // Map of groupKey -> note text
    // Transpose horizontal data to vertical format
    transposeData: boolean;  // If true, transpose rows<->columns (for horizontal data sources)
    // Toggle switches for filtering/sorting/highlighting
    filtersEnabled?: boolean;  // Global switch for filters (default true)
    sortEnabled?: boolean;     // Global switch for sorting (default true)
    highlightEnabled?: boolean; // Global switch for highlight rules (default true)
    // Fuzzy keyword merge rules
    fuzzyRuleText?: string;    // Keyword merge rules (format: "keyword1,keyword2=group;...")
    // Display columns configuration
    displayColumns?: string[]; // Columns to display in detail view
    detailColumn?: string; // Preferred full-content column for context menu
    // Pure image mode - extract all image URLs from any cell, ignore row/column structure
    pureImageMode?: boolean;
}

export interface SavedConfig {
    id: string;
    name: string;
    config: GalleryConfig;
    createdAt: number;
}

// Config preset for saving/loading configurations (same structure as TransposePanel)
export interface GalleryPreset {
    id: string;
    name: string;
    config: GalleryConfig;
    createdAt: number;
}


export const saveAs = (blob: Blob, filename: string) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
};


export const extractImageUrl = (val: unknown): string | null => {
    if (!val) return null;
    const str = String(val).trim();

    // Check for image formula: =IMAGE("url") or =IMAGE("url", ...)
    const formulaMatch = str.match(/=IMAGE\s*\(\s*"([^"]+)"/i);
    if (formulaMatch) return formulaMatch[1];

    // Check for direct URL with image extension
    if (str.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|bmp|svg|ico)/i)) {
        return str;
    }

    // Check for Google Drive URL
    if ((() => { try { const h = new URL(str).hostname; return h === 'drive.google.com' || h.endsWith('.googleusercontent.com'); } catch { return false; } })()) {
        return str;
    }

    // Check for common image hosting services
    if (str.match(/^https?:\/\/.*(imgur|imgbb|cloudinary|unsplash|pexels|flickr|pinterest|instagram)/i)) {
        return str;
    }

    // Accept any https URL that looks like it might be an image (more lenient)
    // This helps with CDN links and other image hosts that don't have traditional extensions
    if (str.match(/^https?:\/\/[^\s]+$/i) && !str.includes(' ')) {
        // Check if it contains image-related keywords in path
        if (str.match(/(image|img|photo|pic|thumb|media|cdn|static|assets|upload)/i)) {
            return str;
        }
        // Also accept if it has query params (many image CDNs use these)
        if (str.includes('?') || str.includes('/v1/') || str.includes('/api/')) {
            return str;
        }
    }

    return null;
};

export const parseDate = (val: unknown): Date | null => {
    if (!val) return null;
    if (val instanceof Date) return val;

    // Handle Excel date serial numbers (e.g., 46015.825)
    // Excel serial numbers: days since 1900-01-01 (with Excel's leap year bug)
    if (typeof val === 'number' || (typeof val === 'string' && /^\d+(\.\d+)?$/.test(val.trim()))) {
        const num = typeof val === 'number' ? val : parseFloat(val);
        // Valid Excel dates are typically between 1 (1900-01-01) and 100000+ (far future)
        // We check for reasonable range: 1 to 100000 (about year 2173)
        if (!isNaN(num) && num >= 1 && num < 100000) {
            // Excel epoch starts at 1900-01-01, but Excel incorrectly treats 1900 as a leap year
            // So we need to subtract 1 for dates after Feb 28, 1900 (serial 60)
            const excelEpoch = new Date(1899, 11, 30); // Dec 30, 1899 (to account for Excel's quirks)
            const msPerDay = 24 * 60 * 60 * 1000;
            const date = new Date(excelEpoch.getTime() + num * msPerDay);
            if (!isNaN(date.getTime())) return date;
        }
    }

    const str = String(val);

    // Try various date formats
    const date = new Date(str);
    if (!isNaN(date.getTime())) return date;

    // Try Chinese format: 2024年12月25日
    const cnMatch = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (cnMatch) {
        return new Date(parseInt(cnMatch[1]), parseInt(cnMatch[2]) - 1, parseInt(cnMatch[3]));
    }

    return null;
};

export const formatDateKey = (date: Date): string => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

// Format any date value to a readable string (handles Date objects, strings, etc.)
// This ensures we never display English date formats like "Sat Jan 03 2026"
export const formatDateValue = (val: unknown): string => {
    if (val === null || val === undefined || val === '') return '无效日期';

    // If it's already a Date object, format it properly
    if (val instanceof Date && !isNaN(val.getTime())) {
        return formatDateKey(val);
    }

    // Try to parse it as a date string
    const parsed = parseDate(val);
    if (parsed) {
        return formatDateKey(parsed);
    }

    // If parsing fails, return the string representation
    // but avoid raw Date.toString() output by checking for that pattern
    const str = String(val);
    // Check if it looks like a Date.toString() output (e.g., "Sat Jan 03 2026 00:00:00 GMT+0100")
    if (/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun)\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}\s+\d{4}/.test(str)) {
        // Try to parse this English date format
        const date = new Date(str);
        if (!isNaN(date.getTime())) {
            return formatDateKey(date);
        }
    }

    return str || '无效日期';
};

// Get group key with smart parsing (same logic as TransposePanel)
export const getGroupKey = (val: unknown): { key: string; type: 'date' | 'text' | 'number' | 'numbered'; sortKey?: number; originalText?: string } | null => {
    if (val === null || val === undefined || val === '') return null;

    // Handle Date objects
    if (val instanceof Date) {
        const y = val.getFullYear();
        const m = val.getMonth() + 1;
        const d = val.getDate();
        return { key: `${y}-${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`, type: 'date' };
    }

    // Handle numbers
    if (typeof val === 'number') {
        return { key: String(val), type: 'number' };
    }

    // Handle strings
    const s = String(val).trim();
    if (s === '') return null;

    // Check for numbered category format: "1. 类别" or "1.类别" or "1、类别"
    const numberedPattern = /(\d+)[.、．]\s*/g;
    const allNumbers: number[] = [];
    let match;
    while ((match = numberedPattern.exec(s)) !== null) {
        allNumbers.push(parseInt(match[1], 10));
    }

    if (allNumbers.length > 0) {
        const minNum = Math.min(...allNumbers);
        // key is the number for grouping, originalText for display
        return { key: String(minNum), type: 'numbered', sortKey: minNum, originalText: s };
    }

    // Check if it's a date-like string
    const dateMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?/);
    if (dateMatch) {
        const y = dateMatch[1];
        const m = dateMatch[2].padStart(2, '0');
        const d = dateMatch[3].padStart(2, '0');
        return { key: `${y}-${m}-${d}`, type: 'date' };
    }

    return { key: s, type: 'text' };
};

export const isLikelyDateColumn = (rows: DataRow[], column: string): boolean => {
    let dateCount = 0;
    const sample = rows.slice(0, 10);
    for (const row of sample) {
        if (parseDate(row[column])) dateCount++;
    }
    return dateCount >= sample.length * 0.5;
};

// 检测是否包含 =IMAGE() 公式的列（优先级最高）
export const isImageFormulaColumn = (rows: DataRow[], column: string): boolean => {
    const sample = rows.slice(0, 10);
    let formulaCount = 0;
    for (const row of sample) {
        const val = row[column];
        if (val && String(val).match(/=IMAGE\s*\(/i)) {
            formulaCount++;
        }
    }
    return formulaCount >= sample.length * 0.3;
};

export const isLikelyImageColumn = (rows: DataRow[], column: string): boolean => {
    let imgCount = 0;
    const sample = rows.slice(0, 10);
    for (const row of sample) {
        if (extractImageUrl(row[column])) imgCount++;
    }
    return imgCount >= sample.length * 0.3;
};

export const parseNumericValue = (value: unknown): number | null => {
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
    if (!numMatch) {
        const looseMatch = str.match(/-?\d+(?:\.\d+)?/);
        if (!looseMatch) return null;
        str = looseMatch[0];
    }

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

// Check if a row matches any highlight rule, return first matching rule's color and borderWidth or null
export const checkHighlight = (row: DataRow, rules: HighlightRule[]): { color: string; borderWidth: number } | null => {
    if (!rules || rules.length === 0) return null;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const weekStart = new Date(today);
    weekStart.setDate(today.getDate() - today.getDay());
    const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

    for (const rule of rules) {
        // Skip disabled rules (treat undefined as enabled for backward compatibility)
        if (rule.enabled === false) continue;
        if (!rule.column) continue;

        const cellValue = row[rule.column];
        const rawValue = String(cellValue ?? '');
        const numValue = parseNumericValue(rawValue);
        const strValue = rawValue.toLowerCase();
        const ruleNumValue = parseNumericValue(rule.value || '');
        const ruleNumValue2 = rule.value2 ? parseNumericValue(rule.value2) : null;
        const ruleStrValue = (rule.value || '').toLowerCase();

        // Try to parse date
        let dateValue: Date | null = null;
        const dateMatch = rawValue.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
        if (dateMatch) {
            dateValue = new Date(parseInt(dateMatch[1]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[3]));
        }

        let matches = false;
        // Normalize old operator names to new ones (backward compatibility)
        const op = rule.operator as string;
        const operator = op === '>=' ? 'greaterOrEqual' :
            op === '>' ? 'greaterThan' :
                op === '<=' ? 'lessOrEqual' :
                    op === '<' ? 'lessThan' :
                        op === '==' ? 'equals' :
                            op === '!=' ? 'notEquals' : op;

        switch (operator) {
            // Text operators
            case 'contains':
                matches = ruleStrValue ? strValue.includes(ruleStrValue) : false;
                break;
            case 'notContains':
                matches = ruleStrValue ? !strValue.includes(ruleStrValue) : true;
                break;
            case 'equals':
                matches = strValue === ruleStrValue;
                break;
            case 'notEquals':
                matches = strValue !== ruleStrValue;
                break;
            case 'startsWith':
                matches = ruleStrValue ? strValue.startsWith(ruleStrValue) : false;
                break;
            case 'endsWith':
                matches = ruleStrValue ? strValue.endsWith(ruleStrValue) : false;
                break;
            case 'notEmpty':
                matches = strValue.trim().length > 0;
                break;
            case 'isEmpty':
                matches = strValue.trim().length === 0;
                break;
            case 'regex':
                try {
                    if (rule.value) {
                        const regex = new RegExp(rule.value, 'i');
                        matches = regex.test(rawValue);
                    }
                } catch { matches = false; }
                break;

            // Numeric operators
            case 'greaterThan':
                matches = numValue !== null && ruleNumValue !== null && numValue > ruleNumValue;
                break;
            case 'lessThan':
                matches = numValue !== null && ruleNumValue !== null && numValue < ruleNumValue;
                break;
            case 'greaterOrEqual':
                matches = numValue !== null && ruleNumValue !== null && numValue >= ruleNumValue;
                break;
            case 'lessOrEqual':
                matches = numValue !== null && ruleNumValue !== null && numValue <= ruleNumValue;
                break;
            case 'between':
                matches = numValue !== null && ruleNumValue !== null && ruleNumValue2 !== null &&
                    numValue >= ruleNumValue && numValue <= ruleNumValue2;
                break;

            // Date operators
            case 'dateEquals':
                if (dateValue && rule.value) {
                    const targetDate = new Date(rule.value);
                    matches = dateValue.toDateString() === targetDate.toDateString();
                }
                break;
            case 'dateBefore':
                if (dateValue && rule.value) {
                    const targetDate = new Date(rule.value);
                    matches = dateValue < targetDate;
                }
                break;
            case 'dateAfter':
                if (dateValue && rule.value) {
                    const targetDate = new Date(rule.value);
                    matches = dateValue > targetDate;
                }
                break;
            case 'today':
                matches = dateValue !== null && dateValue.toDateString() === today.toDateString();
                break;
            case 'thisWeek':
                matches = dateValue !== null && dateValue >= weekStart && dateValue <= today;
                break;
            case 'thisMonth':
                matches = dateValue !== null && dateValue >= monthStart && dateValue <= today;
                break;

            // Link operators
            case 'hasLink':
                matches = /https?:\/\/[^\s]+/.test(rawValue);
                break;
            case 'hasImageLink':
                matches = /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp)/i.test(rawValue);
                break;
            case 'hasFormula':
                matches = rawValue.startsWith('=');
                break;
        }

        if (matches) return { color: rule.color, borderWidth: rule.borderWidth || 3 };
    }
    return null;
};

export const STORAGE_KEY = 'sheetmind-gallery-config';
export const SAVED_CONFIGS_KEY = 'sheetmind-gallery-saved-configs';
export const FAVORITES_KEY = 'sheetmind-gallery-favorites';
export const FAVORITE_FOLDERS_KEY = 'sheetmind-gallery-favorite-folders';
export const COLLAPSED_SECTIONS_KEY = 'sheetmind-gallery-collapsed-sections';
export const HEADER_COLLAPSED_KEY = 'sheetmind-gallery-header-collapsed';
export const DEFAULT_COLLAPSED_SECTIONS = ['advanced', 'highlight', 'bin-date', 'bin-group'];
export const NOTE_COLUMN = 'A';
export const CATEGORY_COLUMN = 'B';
export const NOTE_HEADER = '备注';
export const CATEGORY_HEADER = '媒体标签';
export const DEFAULT_IMAGE_COLUMN = '贴文多媒体';
export const DEFAULT_LINK_COLUMN = '贴文链接';

export const sanitizeObject = (obj: Record<string, unknown>): Record<string, unknown> => {
    const cleaned: Record<string, unknown> = {};
    Object.entries(obj || {}).forEach(([key, value]) => {
        if (value === undefined) return;
        cleaned[key] = value;
    });
    return cleaned;
};

export const sanitizeConfigForCloud = (config: GalleryConfig): Record<string, unknown> => {
    // JSON round-trip removes undefined and functions
    return JSON.parse(JSON.stringify(config));
};

export const sanitizeRowDataForCloud = (rowData: Record<string, unknown>): Record<string, unknown> => {
    const cleaned: Record<string, unknown> = {};
    Object.entries(rowData || {}).forEach(([key, value]) => {
        // Skip undefined values and empty string keys (Firebase doesn't allow empty field names)
        if (value === undefined) return;
        if (!key || key.trim() === '') return;
        cleaned[key] = value;
    });
    if (Object.keys(cleaned).length === 0) {
        return { __empty: true };
    }
    return cleaned;
};

export const sanitizeSavedConfigForCloud = (config: SavedConfig): SavedGalleryConfig | null => {
    if (!config || !config.id || !config.name || !config.createdAt) return null;
    return {
        id: config.id,
        name: config.name,
        config: sanitizeConfigForCloud(config.config),
        createdAt: config.createdAt,
    };
};

export const sanitizeFavoriteForCloud = (favorite: FavoriteItem): CloudFavoriteItem | null => {
    if (!favorite || !favorite.id || !favorite.imageUrl || !favorite.addedAt) return null;
    return sanitizeObject({
        id: favorite.id,
        imageUrl: favorite.imageUrl,
        rowData: sanitizeRowDataForCloud(favorite.rowData as Record<string, unknown>),
        addedAt: favorite.addedAt,
        folderId: favorite.folderId,
    }) as unknown as CloudFavoriteItem;
};

// Favorite item stores image URL and all row data
export interface FavoriteItem {
    id: string;           // Unique ID
    imageUrl: string;     // Image URL
    rowData: DataRow;     // Complete row data
    addedAt: number;      // Timestamp
    folderId?: string;    // Which folder this item belongs to (default folder if not set)
}

// Favorite folder for organizing favorites
export interface FavoriteFolder {
    id: string;           // Unique folder ID
    name: string;         // Folder display name
    emoji?: string;       // Optional emoji icon
    createdAt: number;    // Creation timestamp
}

export const DEFAULT_FOLDER_ID = 'default';

export const getDefaultConfig = (): GalleryConfig => ({
    dateColumn: '',
    groupColumn: '',
    groupColumns: [],
    groupLevels: [],
    accountColumn: '',
    imageColumn: '',
    linkColumn: '',
    labelColumns: [],
    sortRules: [{ column: '', descending: true }, { column: '', descending: true }],
    viewMode: 'gallery', // Default to pure thumbnail view
    calendarMode: 'month',
    selectedDate: new Date().toISOString().slice(0, 10),
    scrollDaysPerView: 3,
    matrixRowColumn: '',
    matrixColColumn: '',
    dateStart: '',
    dateEnd: '',
    customFilters: [],
    numFilters: [],
    highlightRules: [],
    showAllImages: false,
    thumbnailSize: 150,
    // Custom width settings
    matrixCellWidth: 280,
    scrollCardWidth: 280,
    calendarCellHeight: 100,
    // Gallery pagination
    galleryPageSize: -1, // -1 = progressive loading (default)
    // Group binning
    groupBinning: false,
    groupBins: [],
    // Text grouping
    textGrouping: false,
    textGroupBins: [],
    // Date binning
    dateBinning: false,
    dateBins: [],
    // Group priority
    groupPriority: 'date', // Default: date first, then column
    // Search
    searchKeyword: '', // Empty by default
    // Note icon
    showNoteIcon: true, // Show note icon on all thumbnails
    // Category/Tag feature
    showFavoriteIcon: true, // Show favorite icon on thumbnails
    showCategoryIcon: true, // Show category icon on thumbnails
    showLabelOverlay: false, // Show label overlay permanently (false=hover only)
    hoverPreview: true, // Hover-to-enlarge preview enabled by default
    categoryOptions: ['安东尼奥', '边框设计', '成年男性', '成年女性', '祷告主词', '风景', '黑色背景', '家庭', '教堂', '旧纸张', '卡通插画耶稣', '卡通人物', '蜡烛', '老人', '卢西亚', '玛丽亚', '玛丽亚骑驴', '玙瑰花', '年轻人', '其他', '神父', '圣家族', '圣丽塔', '圣婴耶稣', '十字架', '石头石板', '手拿纸', '书本', '特蔕莎', '天使', '小学生/学生', '修女', '耶稣帮助人', '耶稣骑驴', '婴儿/幼儿', '游行', '灾难', '知更鸟', '主耶稣', '文档'], // Default: 画面细节分类预设
    categoryTargetColumn: CATEGORY_COLUMN, // Fixed to column B
    // Thumbnail display mode
    thumbnailFit: 'contain', // Default: original ratio
    // Group notes
    groupNotes: {}, // Empty by default
    // Transpose data option
    transposeData: false, // Default: data is vertical (normal format)
    filtersEnabled: true,  // Default: filters enabled
    sortEnabled: true,     // Default: sorting enabled
    highlightEnabled: true, // Default: highlight enabled
    fuzzyRuleText: '',     // Default: no fuzzy rules
    displayColumns: [],    // Default: no display columns
    detailColumn: '',      // Default: auto pick
});

export const normalizeGalleryConfig = (incoming?: Partial<GalleryConfig>): GalleryConfig => {
    const defaults = getDefaultConfig();
    const merged: GalleryConfig = { ...defaults, ...(incoming || {}) };

    if (Array.isArray(merged.customFilters)) {
        merged.customFilters = (merged.customFilters as unknown as Record<string, unknown>[]).map((cf) => ({
            id: (cf.id as string) || Date.now().toString(),
            column: (cf.column as string) || '',
            operator: (cf.operator as CustomFilter['operator']) || 'contains',
            value: (cf.value as string) || '',
            value2: (cf.value2 as string) || '',
            selectedValues: (cf.selectedValues as string[]) || []
        })) as CustomFilter[];
    } else {
        merged.customFilters = [];
    }

    if (merged.showFavoriteIcon === undefined) {
        merged.showFavoriteIcon = true;
    }
    if (merged.showCategoryIcon === undefined) {
        merged.showCategoryIcon = true;
    }

    merged.categoryTargetColumn = CATEGORY_COLUMN;

    if (!merged.categoryOptions || !Array.isArray(merged.categoryOptions) || merged.categoryOptions.length === 0) {
        merged.categoryOptions = defaults.categoryOptions;
    }

    // Ensure groupNotes is always an object
    if (!merged.groupNotes || typeof merged.groupNotes !== 'object') {
        merged.groupNotes = {};
    }

    return merged;
};

