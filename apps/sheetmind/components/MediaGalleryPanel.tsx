import React, { useState, useMemo, useCallback, useEffect, useLayoutEffect, memo, useRef } from 'react';
import {
    X, ChevronDown, ChevronRight, Image, Calendar, User, Check,
    ZoomIn, ExternalLink, Settings2, ArrowUp, ArrowDown, Plus, Trash2,
    CalendarDays, LayoutGrid, ChevronLeft, Table2, Filter, ArrowRight, Info,
    Cloud, Download, Upload, Loader2, Bookmark, CloudOff, Link2, RefreshCw,
    Grid3X3, Star, Copy, MessageSquare, Edit3, Send, Tag, FolderPlus, RotateCcw, FolderTree, Layers, GripVertical,
    FileText, FolderOpen, Lightbulb, AlertCircle, BookOpen, ClipboardList, BarChart2, Video
} from 'lucide-react';
import { SheetData, DataRow } from '../types';
import {
    savePresetToCloud,
    loadPresetsFromCloud,
    deletePresetFromCloud,
    isUserLoggedIn,
    parseGoogleSheetsUrl,
    saveFavoritesToCloud,
    loadFavoritesFromCloud,
    saveGallerySavedConfigsToCloud,
    loadGallerySavedConfigsFromCloud,
    saveCurrentGalleryConfigToCloud,
    loadCurrentGalleryConfigFromCloud,
    SavedGalleryConfig,
    CloudFavoriteItem,
    GalleryNote,
    loadGalleryNotesFromCloud,
    upsertGalleryNoteToCloud,
    updateSingleCellInGoogleSheet,
    ensureNotesAndCategoriesColumns,
    GalleryCategory,
    loadGalleryCategoriesFromCloud,
    upsertGalleryCategoryToCloud
} from '../services/firebaseService';
import { getGoogleAccessToken } from '@/services/authService';
import { openExternalUrl } from '../utils/openExternal';

interface MediaGalleryPanelProps {
    data: SheetData;
    sourceUrl?: string;          // Google Sheets URL for sync-back
    currentSheetName?: string;   // Current sheet name for sync-back
    isLoading?: boolean;
    sharedConfig?: import('../types/sharedConfig').SharedConfig;
}

interface SortRule {
    column: string;
    descending: boolean;
}

interface NumFilter {
    id: string;
    column: string;
    operator: 'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' | 'equals' | 'notEquals' | 'between' | 'notEmpty' | 'isEmpty';
    value: string;
    value2?: string; // For 'between' operator
}

// Bin range for numeric grouping (similar to Dashboard binning)
interface GroupBinRange {
    id: string;
    label: string;
    min: number;
    max: number;
}

// Bin range for date grouping (custom date ranges)
interface DateBinRange {
    id: string;
    label: string;
    startDate: string; // ISO date string (YYYY-MM-DD)
    endDate: string;   // ISO date string (YYYY-MM-DD)
}

// Condition for text group matching
interface TextGroupCondition {
    id: string;
    operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' |
    'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' | 'numEquals';
    value: string;
}

// Text grouping - for categorizing text values into custom groups
interface TextGroupBin {
    id: string;
    label: string;      // Group name
    values: string[];   // Cell values that belong to this group (exact match)
    keywords?: string[]; // Keywords for fuzzy matching (contains match) - legacy
    conditions?: TextGroupCondition[]; // Conditions with operators for flexible matching
}

// Multi-level grouping configuration
interface GroupLevel {
    id: string;
    column: string;
    type: 'text' | 'numeric' | 'date';
    numericBins?: GroupBinRange[];
    textBins?: TextGroupBin[];
    dateBins?: DateBinRange[];
}

interface CustomFilter {
    id: string;
    column: string;
    operator: 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' |
    'notEmpty' | 'isEmpty' | 'regex' | 'multiSelect' |
    'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' | 'between';
    value: string;
    value2?: string;  // For 'between' operator
    selectedValues?: string[];  // For 'multiSelect' mode (backward compatibility)
}

interface HighlightRule {
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

interface GalleryConfig {
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
}

interface SavedConfig {
    id: string;
    name: string;
    config: GalleryConfig;
    createdAt: number;
}

// Config preset for saving/loading configurations (same structure as TransposePanel)
interface GalleryPreset {
    id: string;
    name: string;
    config: GalleryConfig;
    createdAt: number;
}

// Helper functions
const extractImageUrl = (val: unknown): string | null => {
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
    if (str.includes('drive.google.com') || str.includes('googleusercontent.com')) {
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

const parseDate = (val: unknown): Date | null => {
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

const formatDateKey = (date: Date): string => {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
};

// Format any date value to a readable string (handles Date objects, strings, etc.)
// This ensures we never display English date formats like "Sat Jan 03 2026"
const formatDateValue = (val: unknown): string => {
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
const getGroupKey = (val: unknown): { key: string; type: 'date' | 'text' | 'number' | 'numbered'; sortKey?: number; originalText?: string } | null => {
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

const isLikelyDateColumn = (rows: DataRow[], column: string): boolean => {
    let dateCount = 0;
    const sample = rows.slice(0, 10);
    for (const row of sample) {
        if (parseDate(row[column])) dateCount++;
    }
    return dateCount >= sample.length * 0.5;
};

// 检测是否包含 =IMAGE() 公式的列（优先级最高）
const isImageFormulaColumn = (rows: DataRow[], column: string): boolean => {
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

const isLikelyImageColumn = (rows: DataRow[], column: string): boolean => {
    let imgCount = 0;
    const sample = rows.slice(0, 10);
    for (const row of sample) {
        if (extractImageUrl(row[column])) imgCount++;
    }
    return imgCount >= sample.length * 0.3;
};

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
const checkHighlight = (row: DataRow, rules: HighlightRule[]): { color: string; borderWidth: number } | null => {
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

const STORAGE_KEY = 'sheetmind-gallery-config';
const SAVED_CONFIGS_KEY = 'sheetmind-gallery-saved-configs';
const FAVORITES_KEY = 'sheetmind-gallery-favorites';
const FAVORITE_FOLDERS_KEY = 'sheetmind-gallery-favorite-folders';
const COLLAPSED_SECTIONS_KEY = 'sheetmind-gallery-collapsed-sections';
const HEADER_COLLAPSED_KEY = 'sheetmind-gallery-header-collapsed';
const DEFAULT_COLLAPSED_SECTIONS = ['advanced', 'highlight', 'bin-date', 'bin-group'];
const NOTE_COLUMN = 'A';
const CATEGORY_COLUMN = 'B';
const NOTE_HEADER = '备注';
const CATEGORY_HEADER = '媒体标签';
const DEFAULT_IMAGE_COLUMN = '贴文多媒体';
const DEFAULT_LINK_COLUMN = '贴文链接';

const sanitizeObject = (obj: Record<string, unknown>): Record<string, unknown> => {
    const cleaned: Record<string, unknown> = {};
    Object.entries(obj || {}).forEach(([key, value]) => {
        if (value === undefined) return;
        cleaned[key] = value;
    });
    return cleaned;
};

const sanitizeConfigForCloud = (config: GalleryConfig): Record<string, unknown> => {
    // JSON round-trip removes undefined and functions
    return JSON.parse(JSON.stringify(config));
};

const sanitizeRowDataForCloud = (rowData: Record<string, unknown>): Record<string, unknown> => {
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

const sanitizeSavedConfigForCloud = (config: SavedConfig): SavedGalleryConfig | null => {
    if (!config || !config.id || !config.name || !config.createdAt) return null;
    return {
        id: config.id,
        name: config.name,
        config: sanitizeConfigForCloud(config.config),
        createdAt: config.createdAt,
    };
};

const sanitizeFavoriteForCloud = (favorite: FavoriteItem): CloudFavoriteItem | null => {
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
interface FavoriteItem {
    id: string;           // Unique ID
    imageUrl: string;     // Image URL
    rowData: DataRow;     // Complete row data
    addedAt: number;      // Timestamp
    folderId?: string;    // Which folder this item belongs to (default folder if not set)
}

// Favorite folder for organizing favorites
interface FavoriteFolder {
    id: string;           // Unique folder ID
    name: string;         // Folder display name
    emoji?: string;       // Optional emoji icon
    createdAt: number;    // Creation timestamp
}

const DEFAULT_FOLDER_ID = 'default';

const getDefaultConfig = (): GalleryConfig => ({
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
});

const normalizeGalleryConfig = (incoming?: Partial<GalleryConfig>): GalleryConfig => {
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

const MediaGalleryPanel: React.FC<MediaGalleryPanelProps> = ({ data, sourceUrl, currentSheetName, isLoading, sharedConfig }) => {
    const [config, setConfig] = useState<GalleryConfig>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                return normalizeGalleryConfig(JSON.parse(saved));
            }
        } catch (e) { /* ignore */ }
        return getDefaultConfig();
    });
    const isUsingSharedConfig = !!sharedConfig;

    // Transpose data if needed (for horizontal data sources)
    // When transposeData is true, rows become columns and columns become rows
    // Priority: sharedConfig > local config - MUST be defined early so all column references use transposed data
    const effectiveTranspose = sharedConfig?.transposeData ?? config.transposeData;

    const effectiveData = useMemo((): SheetData => {
        if (!effectiveTranspose) {
            return data;
        }

        // Transpose the data: A列 becomes column headers, other columns become rows
        // Simple transpose: first column values become column headers, each other column becomes a row
        // Merge mode: columns with same base name are merged

        if (data.rows.length === 0) return data;

        // Get raw column names from first column
        const rawColumns = data.rows.map(row => String(row[data.columns[0]] || ''));

        // Check if merge mode is enabled
        const mergeMode = sharedConfig?.mergeTransposeColumns ?? false;

        if (mergeMode) {
            // === MERGE MODE: Merge column NAMES but keep data separate ===
            // Each account becomes a separate row, using simplified column names

            // Extract base names (e.g., "贴文多媒体 [1.玛丽亚]" -> "贴文多媒体")
            const baseNames = rawColumns.map(rawCol => {
                const baseMatch = rawCol.match(/^([^[\]]+?)(?:\s*\[.*\])?$/);
                return (baseMatch ? baseMatch[1].trim() : rawCol) || '未命名';
            });

            // Get unique base names (preserving order)
            const uniqueColumns: string[] = [];
            const seenColumns = new Set<string>();
            for (const baseName of baseNames) {
                if (!seenColumns.has(baseName)) {
                    seenColumns.add(baseName);
                    uniqueColumns.push(baseName);
                }
            }

            // Group original rows by base name
            const columnRowIndices = new Map<string, number[]>();
            baseNames.forEach((baseName, rowIdx) => {
                if (!columnRowIndices.has(baseName)) {
                    columnRowIndices.set(baseName, []);
                }
                columnRowIndices.get(baseName)!.push(rowIdx);
            });

            // Find how many "accounts" we have (based on max count of same base name)
            const accountCount = Math.max(...Array.from(columnRowIndices.values()).map(arr => arr.length));

            // Each original column (except first) × each account = one row
            const newRows: DataRow[] = [];
            for (let colIdx = 1; colIdx < data.columns.length; colIdx++) {
                for (let accountIdx = 0; accountIdx < accountCount; accountIdx++) {
                    const newRow: DataRow = {};

                    // For each unique column, get the value from the corresponding account
                    for (const colName of uniqueColumns) {
                        const rowIndices = columnRowIndices.get(colName) || [];
                        if (accountIdx < rowIndices.length) {
                            const originalRowIdx = rowIndices[accountIdx];
                            const value = data.rows[originalRowIdx][data.columns[colIdx]];
                            if (value !== undefined && value !== null && value !== '') {
                                newRow[colName] = value;
                            }
                        }
                    }

                    // Only add row if it has some content
                    if (Object.keys(newRow).length > 0) {
                        newRows.push(newRow);
                    }
                }
            }

            return {
                ...data,
                columns: uniqueColumns,
                rows: newRows
            };
        } else {
            // === SIMPLE MODE: No merging, keep original column names ===

            const newRows: DataRow[] = [];
            for (let colIdx = 1; colIdx < data.columns.length; colIdx++) {
                const newRow: DataRow = {};
                data.rows.forEach((originalRow, rowIdx) => {
                    const colName = rawColumns[rowIdx];
                    if (colName) {
                        newRow[colName] = originalRow[data.columns[colIdx]];
                    }
                });
                newRows.push(newRow);
            }

            return {
                ...data,
                columns: rawColumns,
                rows: newRows
            };
        }
    }, [data, sharedConfig?.transposeData, sharedConfig?.mergeTransposeColumns, config.transposeData]);

    // === Effective Config: sharedConfig overrides local config unless using independent ===
    const effectiveGroupColumn = isUsingSharedConfig && sharedConfig!.groupColumn ? sharedConfig!.groupColumn : config.groupColumn;
    // 多级分组支持：优先使用 groupLevels，否则用 groupColumns/groupColumn
    const effectiveGroupLevels: GroupLevel[] = (() => {
        const levels = isUsingSharedConfig ? sharedConfig!.groupLevels : config.groupLevels;
        if (levels && levels.length > 0) return levels as GroupLevel[];
        // 向后兼容：构建默认 GroupLevel
        const cols = isUsingSharedConfig ? sharedConfig!.groupColumns : config.groupColumns;
        if (cols && cols.length > 0) {
            return cols.map((col, idx) => ({ id: `legacy-${idx}`, column: col, type: 'text' as const }));
        }
        if (effectiveGroupColumn) {
            return [{ id: 'legacy-0', column: effectiveGroupColumn, type: 'text' as const }];
        }
        return [];
    })();
    const effectiveGroupColumns: string[] = effectiveGroupLevels.map(l => l.column);
    const filtersEnabled = isUsingSharedConfig ? (sharedConfig?.filtersEnabled ?? true) : true;
    const sortEnabled = isUsingSharedConfig ? (sharedConfig?.sortEnabled ?? true) : true;
    const highlightEnabled = isUsingSharedConfig ? (sharedConfig?.highlightEnabled ?? true) : true;
    const effectiveDateColumn = isUsingSharedConfig && sharedConfig!.dateColumn ? sharedConfig!.dateColumn : config.dateColumn;
    const effectiveDateStart = filtersEnabled ? (isUsingSharedConfig ? sharedConfig!.dateStart : config.dateStart) : '';
    const effectiveDateEnd = filtersEnabled ? (isUsingSharedConfig ? sharedConfig!.dateEnd : config.dateEnd) : '';
    const effectiveImageColumn = isUsingSharedConfig && sharedConfig!.imageColumn ? sharedConfig!.imageColumn : config.imageColumn;
    const effectiveLinkColumn = isUsingSharedConfig && sharedConfig!.linkColumn ? sharedConfig!.linkColumn : config.linkColumn;
    const effectiveAccountColumn = isUsingSharedConfig && sharedConfig!.accountColumn ? sharedConfig!.accountColumn : config.accountColumn;
    const effectiveLabelColumns = (() => {
        const rawCols = isUsingSharedConfig && sharedConfig!.displayColumns.length > 0 ? sharedConfig!.displayColumns : config.labelColumns;
        // Sort: numeric/stats columns first, link/media columns last
        return [...rawCols].sort((a, b) => {
            // Priority score: lower = earlier
            const getPriority = (col: string) => {
                const lc = col.toLowerCase();
                // Numeric stats columns - highest priority
                if (lc.includes('点赞') || lc.includes('播放') || lc.includes('评论') ||
                    lc.includes('收藏') || lc.includes('转发') || lc.includes('分享') ||
                    lc.includes('互动') || lc.includes('观看') || lc.includes('粉丝') ||
                    lc.includes('阅读') || lc.includes('数量') || lc.includes('次数')) {
                    return 1;
                }
                // Date/time columns
                if (lc.includes('日期') || lc.includes('时间') || lc.includes('发布')) {
                    return 2;
                }
                // Link/media columns - lowest priority
                if (lc.includes('链接') || lc.includes('link') || lc.includes('url') ||
                    lc.includes('多媒体') || lc.includes('媒体') || lc.includes('图片')) {
                    return 9;
                }
                return 5; // Default priority
            };
            return getPriority(a) - getPriority(b);
        });
    })();
    const effectiveCustomFilters = filtersEnabled ? (isUsingSharedConfig ? sharedConfig!.customFilters : config.customFilters) : [];
    const effectiveNumFilters = filtersEnabled ? (isUsingSharedConfig ? sharedConfig!.numFilters : config.numFilters) : [];
    const effectiveSortRules = sortEnabled ? (isUsingSharedConfig ? sharedConfig!.sortRules : config.sortRules) : [];
    const effectiveHighlightRules = (highlightEnabled
        ? (isUsingSharedConfig ? sharedConfig!.highlightRules : config.highlightRules)
        : []) as HighlightRule[];
    const effectiveGroupBinning = isUsingSharedConfig ? sharedConfig!.groupBinning : config.groupBinning;
    const effectiveGroupBins = isUsingSharedConfig ? sharedConfig!.groupBins : config.groupBins;
    const effectiveTextGrouping = isUsingSharedConfig ? sharedConfig!.textGrouping : config.textGrouping;
    const effectiveTextGroupBins = isUsingSharedConfig ? sharedConfig!.textGroupBins : config.textGroupBins;
    const effectiveFuzzyRuleText = isUsingSharedConfig ? (sharedConfig!.fuzzyRuleText || '') : (config.fuzzyRuleText || '');
    const effectiveDateBinning = isUsingSharedConfig ? sharedConfig!.dateBinning : config.dateBinning;
    const effectiveDateBins = isUsingSharedConfig ? sharedConfig!.dateBins : config.dateBins;

    useEffect(() => {
        if (!isUsingSharedConfig || !sharedConfig) return;
        setConfig(prev => ({
            ...prev,
            groupColumn: sharedConfig.groupColumn,
            groupColumns: sharedConfig.groupColumns || [],
            groupLevels: (sharedConfig.groupLevels || []) as GroupLevel[],
            dateColumn: sharedConfig.dateColumn,
            dateStart: sharedConfig.dateStart,
            dateEnd: sharedConfig.dateEnd,
            imageColumn: sharedConfig.imageColumn,
            linkColumn: sharedConfig.linkColumn,
            accountColumn: sharedConfig.accountColumn,
            labelColumns: sharedConfig.displayColumns.length > 0 ? sharedConfig.displayColumns : prev.labelColumns,
            customFilters: sharedConfig.customFilters,
            numFilters: sharedConfig.numFilters,
            sortRules: sharedConfig.sortRules,
            highlightRules: (sharedConfig.highlightRules ?? []) as HighlightRule[],
            groupBinning: sharedConfig.groupBinning,
            groupBins: sharedConfig.groupBins,
            textGrouping: sharedConfig.textGrouping,
            textGroupBins: sharedConfig.textGroupBins,
            dateBinning: sharedConfig.dateBinning,
            dateBins: sharedConfig.dateBins,
        }));
    }, [isUsingSharedConfig, sharedConfig]);

    const [savedConfigs, setSavedConfigs] = useState<SavedConfig[]>(() => {
        try {
            const saved = localStorage.getItem(SAVED_CONFIGS_KEY);
            if (saved) return JSON.parse(saved);
        } catch (e) { /* ignore */ }
        return [];
    });

    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    const [selectedImage, setSelectedImage] = useState<string | null>(null);
    const [selectedRow, setSelectedRow] = useState<DataRow | null>(null); // For detail modal
    const [showConfig, setShowConfig] = useState(true);
    // 日历月份初始化：业务周期为23日-次月22日，所以23日及之后算下个月
    const [calendarMonth, setCalendarMonth] = useState(() => {
        const now = new Date();
        // 如果当前日期 >= 23日，则显示下个月
        if (now.getDate() >= 23) {
            return new Date(now.getFullYear(), now.getMonth() + 1, 1);
        }
        return new Date(now.getFullYear(), now.getMonth(), 1);
    });
    const calendarMonthInitRef = React.useRef(false); // 用于跟踪是否已经自动设置过月份

    // 自动跳转到数据中最新日期的月份（遵循业务周期：23日-次月22日）
    React.useEffect(() => {
        // 仅在日历视图、有日期列、且尚未初始化时执行
        if (config.viewMode !== 'calendar' || !effectiveDateColumn || calendarMonthInitRef.current) {
            return;
        }

        // 遍历数据找到最新日期
        let latestDate: Date | null = null;
        for (const row of effectiveData.rows) {
            const dateVal = row[effectiveDateColumn];
            const parsed = parseDate(dateVal);
            if (parsed && (!latestDate || parsed > latestDate)) {
                latestDate = parsed;
            }
        }

        // 如果找到了日期，根据业务周期计算目标月份
        if (latestDate) {
            let targetMonth = latestDate.getMonth();
            let targetYear = latestDate.getFullYear();

            // 业务周期规则：23日及之后算下个月
            if (latestDate.getDate() >= 23) {
                targetMonth += 1;
                if (targetMonth > 11) {
                    targetMonth = 0;
                    targetYear += 1;
                }
            }

            // 使用函数式更新来避免对 calendarMonth 的依赖
            setCalendarMonth(current => {
                const currentMonth = current.getMonth();
                const currentYear = current.getFullYear();

                if (targetMonth !== currentMonth || targetYear !== currentYear) {
                    return new Date(targetYear, targetMonth, 1);
                }
                return current;
            });
        }

        calendarMonthInitRef.current = true;
    }, [config.viewMode, effectiveDateColumn, effectiveData.rows]);

    // 当数据源变化时重置初始化标记
    React.useEffect(() => {
        calendarMonthInitRef.current = false;
    }, [data.fileName, data.sheetName]);

    const [collapsedSections, setCollapsedSections] = useState<Set<string>>(() => {
        if (typeof window === 'undefined') return new Set(DEFAULT_COLLAPSED_SECTIONS);
        try {
            const saved = localStorage.getItem(COLLAPSED_SECTIONS_KEY);
            if (saved) {
                const parsed = JSON.parse(saved);
                if (Array.isArray(parsed)) return new Set(parsed);
            }
        } catch { /* ignore */ }
        return new Set(DEFAULT_COLLAPSED_SECTIONS);
    });
    const [headerCollapsed, setHeaderCollapsed] = useState(() => {
        if (typeof window === 'undefined') return false;
        try {
            const saved = localStorage.getItem(HEADER_COLLAPSED_KEY);
            if (saved !== null) return saved === 'true';
        } catch { /* ignore */ }
        return window.innerHeight < 720;
    });

    // Hover preview state for gallery mode (with delay)
    const [hoveredImage, setHoveredImage] = useState<string | null>(null);
    const [hoverPosition, setHoverPosition] = useState<{ x: number, y: number } | null>(null);
    const [thumbnailRect, setThumbnailRect] = useState<DOMRect | null>(null); // Thumbnail position for non-overlapping preview
    const [pasteConditionOperator, setPasteConditionOperator] = useState<TextGroupCondition['operator']>('contains');
    const hoverTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);
    const viewSectionRef = React.useRef<HTMLDivElement | null>(null);
    const notesSectionRef = React.useRef<HTMLDivElement | null>(null);
    const advancedSectionRef = React.useRef<HTMLDivElement | null>(null);

    // Context menu state for thumbnail right-click
    interface ContextMenuData {
        x: number;
        y: number;
        row: DataRow;
        imageUrl: string;
        imageFormula: string; // The original cell value (formula)
    }
    const [contextMenu, setContextMenu] = useState<ContextMenuData | null>(null);
    const contextMenuRef = React.useRef<HTMLDivElement | null>(null);
    const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
    const contextMenuCloseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // Gallery collapsed groups (for grouped thumbnails - default expanded, track collapsed)
    const [collapsedGalleryGroups, setCollapsedGalleryGroups] = useState<Set<string>>(new Set());

    // Editing group note state (groupKey being edited, null if not editing)
    const [editingGroupNote, setEditingGroupNote] = useState<string | null>(null);
    const [editingGroupNoteValue, setEditingGroupNoteValue] = useState('');

    // Tree view collapsed nodes (for nested multi-level grouping - using path like "level1/level2")
    const [collapsedTreeNodes, setCollapsedTreeNodes] = useState<Set<string>>(new Set());

    // Copy view layout modal state
    const [copyViewModal, setCopyViewModal] = useState<{
        open: boolean;
        columnsPerRow: number;
        includeExtraData: boolean;
        selectedColumns: string[];
        applyClassificationOverrides: boolean;
    }>({
        open: false,
        columnsPerRow: 10,
        includeExtraData: false,
        selectedColumns: [],
        applyClassificationOverrides: true
    });

    // Classification mode state
    const [classificationMode, setClassificationMode] = useState(false);
    const [selectedForClassification, setSelectedForClassification] = useState<Set<string>>(new Set()); // Row IDs selected for classification
    const [draggedItems, setDraggedItems] = useState<string[]>([]); // Items being dragged
    const [dragOverGroup, setDragOverGroup] = useState<string | null>(null); // Group being hovered over
    const [customGroups, setCustomGroups] = useState<string[]>([]); // Custom groups added by user
    const [editingCustomGroup, setEditingCustomGroup] = useState<{ index: number; value: string } | null>(null); // Editing custom group name
    const [draggingGroupIdx, setDraggingGroupIdx] = useState<number | null>(null); // Index of group being dragged for reordering
    const [newGroupInput, setNewGroupInput] = useState(''); // New group name input
    const [showNewGroupInput, setShowNewGroupInput] = useState(false); // Show add group input
    const [syncToSheet, setSyncToSheet] = useState(false); // Whether to sync classification changes to Google Sheet
    // Drag target types - which drop zones to show
    const [dragTargetTypes, setDragTargetTypes] = useState<{ classification: boolean; favorites: boolean; tags: boolean }>({
        classification: true,
        favorites: true,
        tags: true
    });
    const [dragOverFavoriteFolder, setDragOverFavoriteFolder] = useState<string | null>(null); // Favorite folder being hovered

    // Classification overrides stored in localStorage (imageUrl -> groupName mapping)
    const CLASSIFICATION_KEY = `sheetmind_classification_${sourceUrl || 'local'}`;
    const [classificationOverrides, setClassificationOverrides] = useState<Record<string, string>>(() => {
        try {
            const saved = localStorage.getItem(CLASSIFICATION_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    });

    // Save classification overrides to localStorage
    useEffect(() => {
        if (Object.keys(classificationOverrides).length > 0) {
            localStorage.setItem(CLASSIFICATION_KEY, JSON.stringify(classificationOverrides));
        }
    }, [classificationOverrides, CLASSIFICATION_KEY]);

    // Custom order overrides stored in localStorage (groupName -> array of imageUrls in order)
    const ORDER_KEY = `sheetmind_order_${sourceUrl || 'local'}`;
    const [customOrderByGroup, setCustomOrderByGroup] = useState<Record<string, string[]>>(() => {
        try {
            const saved = localStorage.getItem(ORDER_KEY);
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    });

    // Save custom order to localStorage
    useEffect(() => {
        if (Object.keys(customOrderByGroup).length > 0) {
            localStorage.setItem(ORDER_KEY, JSON.stringify(customOrderByGroup));
        }
    }, [customOrderByGroup, ORDER_KEY]);

    // Drag reorder state
    const [reorderDragItem, setReorderDragItem] = useState<string | null>(null); // Current item being dragged for reorder
    const [reorderDropTarget, setReorderDropTarget] = useState<{ group: string; index: number } | null>(null); // Where to insert

    // Gallery pagination
    const [galleryPage, setGalleryPage] = useState(1);
    // Per-group pagination state
    const [groupPages, setGroupPages] = useState<Record<string, number>>({});
    // Per-group loaded items count for progressive loading (initial load = 100)
    const [groupLoadedCount, setGroupLoadedCount] = useState<Record<string, number>>({});
    const INITIAL_LOAD_COUNT = 100; // Initial items to load per group
    const LOAD_MORE_COUNT = 100; // Items to add when loading more

    // Favorites state
    const [favorites, setFavorites] = useState<FavoriteItem[]>(() => {
        try {
            const saved = localStorage.getItem(FAVORITES_KEY);
            if (saved) return JSON.parse(saved);
        } catch { /* ignore */ }
        return [];
    });

    // Favorite folders state
    const [favoriteFolders, setFavoriteFolders] = useState<FavoriteFolder[]>(() => {
        try {
            const saved = localStorage.getItem(FAVORITE_FOLDERS_KEY);
            if (saved) return JSON.parse(saved);
        } catch { /* ignore */ }
        // Default folders
        return [
            { id: DEFAULT_FOLDER_ID, name: '默认收藏夹', emoji: '⭐', createdAt: Date.now() }
        ];
    });
    const [activeFolderId, setActiveFolderId] = useState<string>(DEFAULT_FOLDER_ID); // Currently viewing folder
    const [showFolderMenu, setShowFolderMenu] = useState<{ x: number; y: number; imageUrl: string; row: DataRow } | null>(null); // Folder selection menu
    const [showBatchFolderMenu, setShowBatchFolderMenu] = useState<{ x: number; y: number } | null>(null); // Batch favorites folder selection
    const folderMenuRef = useRef<HTMLDivElement>(null);
    const batchFolderMenuRef = useRef<HTMLDivElement>(null);
    const [showLoginPrompt, setShowLoginPrompt] = useState<{ action: string; onLogin?: () => void } | null>(null); // Login prompt modal

    const sharedConfigKeys = useMemo(() => new Set<keyof GalleryConfig>([
        'groupColumn',
        'dateColumn',
        'dateStart',
        'dateEnd',
        'imageColumn',
        'linkColumn',
        'accountColumn',
        'labelColumns',
        'customFilters',
        'numFilters',
        'sortRules',
        'highlightRules',
        'groupBinning',
        'groupBins',
        'textGrouping',
        'textGroupBins',
        'dateBinning',
        'dateBins',
    ]), []);

    const filterSharedUpdates = useCallback((updates: Partial<GalleryConfig>) => {
        if (!isUsingSharedConfig) return updates;
        const filtered: Partial<GalleryConfig> = {};
        Object.entries(updates).forEach(([key, value]) => {
            if (!sharedConfigKeys.has(key as keyof GalleryConfig)) {
                filtered[key as keyof GalleryConfig] = value as never;
            }
        });
        return filtered;
    }, [isUsingSharedConfig, sharedConfigKeys]);

    const handleResetConfig = useCallback(() => {
        localStorage.removeItem(STORAGE_KEY);
        const defaults = getDefaultConfig();
        if (isUsingSharedConfig) {
            const filtered = filterSharedUpdates(defaults);
            if (Object.keys(filtered).length > 0) {
                setConfig(prev => ({ ...prev, ...filtered }));
            }
        } else {
            setConfig(defaults);
        }
        setGalleryPage(1);
        setGroupPages({});
        setGroupLoadedCount({});
        setCopyFeedback('配置已重置');
        setTimeout(() => setCopyFeedback(null), 1500);
    }, [filterSharedUpdates, isUsingSharedConfig]);

    // New folder modal state
    const [newFolderModal, setNewFolderModal] = useState<{
        isOpen: boolean;
        name: string;
        emoji: string;
        onSuccess?: (folderId: string) => void; // Callback after folder creation
    }>({ isOpen: false, name: '', emoji: '📂', onSuccess: undefined });

    // Edit folder modal state
    const [editFolderModal, setEditFolderModal] = useState<{
        isOpen: boolean;
        folderId: string;
        name: string;
        emoji: string;
    }>({ isOpen: false, folderId: '', name: '', emoji: '' });

    // Folder context menu state
    const [folderContextMenu, setFolderContextMenu] = useState<{
        x: number;
        y: number;
        folderId: string;
    } | null>(null);

    const [showFavorites, setShowFavorites] = useState(false); // Toggle favorites view
    const [showCategoryView, setShowCategoryView] = useState(false); // Toggle category view
    const [selectedFavorites, setSelectedFavorites] = useState<Set<string>>(new Set()); // Selected favorite IDs
    const [selectedThumbnails, setSelectedThumbnails] = useState<Set<string>>(new Set()); // Selected row IDs (imageUrl||sheetName) for batch operations
    const [gallerySelectMode, setGallerySelectMode] = useState(false); // Enable selection mode in gallery
    const [favoriteSearchKeyword, setFavoriteSearchKeyword] = useState(''); // Search keyword for favorites

    // ==================== Drag & Drop State ====================
    const [dragOverTarget, setDragOverTarget] = useState<string | null>(null); // 'folder-{id}' or 'category-{name}'
    const [isDraggingImage, setIsDraggingImage] = useState(false); // Is currently dragging an image
    const [dragSourceFolderId, setDragSourceFolderId] = useState<string | null>(null); // Source folder for cross-folder move
    const [favoriteDragOverIndex, setFavoriteDragOverIndex] = useState<number | null>(null); // For reordering within folder

    // Custom confirm dialog state
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
        confirmText?: string;
        cancelText?: string;
        type?: 'danger' | 'warning' | 'info';
    } | null>(null);

    // Config presets (TransposePanel-style)
    const [presets, setPresets] = useState<GalleryPreset[]>([]);
    const [activePresetId, setActivePresetId] = useState<string | null>(null);

    // Cloud sync state (TransposePanel-style)
    const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
    const [cloudSyncing, setCloudSyncing] = useState(false);
    const [cloudError, setCloudError] = useState<string | null>(null);

    // Legacy cloud sync state (kept for backward compatibility)
    const [isCloudSyncing, setIsCloudSyncing] = useState(false);
    const [cloudSyncStatus, setCloudSyncStatus] = useState<'idle' | 'saving' | 'loading' | 'success' | 'error'>('idle');
    const [cloudConfigs, setCloudConfigs] = useState<{ name: string; updatedAt: any }[]>([]);
    const latestConfigRef = React.useRef(config);
    const contentScrollRef = React.useRef<HTMLDivElement | null>(null);
    const scrollRestoreRef = React.useRef<number | null>(null);
    const galleryGridRef = React.useRef<HTMLDivElement | null>(null);
    const galleryScrollRafRef = React.useRef<number | null>(null);
    const galleryGridOffsetRef = React.useRef<number>(0);
    const [galleryScrollTop, setGalleryScrollTop] = useState(0);
    const [galleryViewportHeight, setGalleryViewportHeight] = useState(0);
    const [galleryViewportWidth, setGalleryViewportWidth] = useState(0);

    // ==================== Notes (备注) State ====================
    const [galleryNotes, setGalleryNotes] = useState<Map<string, GalleryNote>>(new Map());
    const [notesSyncing, setNotesSyncing] = useState(false);
    const notesCloudLoadedRef = React.useRef(false);

    // Note modal state
    interface NoteModalData {
        isOpen: boolean;
        imageUrl: string;
        rowIndex: number;  // 1-indexed row in spreadsheet (excluding header)
        currentNote: string;
        isSaving: boolean;
        syncToSheet: boolean;  // Whether to sync note to Google Sheets (default false)
    }
    const [noteModal, setNoteModal] = useState<NoteModalData>({
        isOpen: false,
        imageUrl: '',
        rowIndex: 0,
        currentNote: '',
        isSaving: false,
        syncToSheet: false  // Default: don't sync to sheet
    });

    // Global toggle: auto sync notes to Google Sheets A column
    const [autoSyncNotesToSheet, setAutoSyncNotesToSheet] = useState(true);

    // ==================== Category/Tag Feature ====================
    // Category data: imageUrl -> category
    const [galleryCategories, setGalleryCategories] = useState<Map<string, string>>(new Map());

    // Floating tooltip for click position tips
    const [floatingTip, setFloatingTip] = useState<{ text: string; x: number; y: number } | null>(null);

    // Category modal state
    interface CategoryModalData {
        isOpen: boolean;
        imageUrl: string;
        rowIndex: number;
        currentCategory: string;
        isSaving: boolean;
    }
    const [categoryModal, setCategoryModal] = useState<CategoryModalData>({
        isOpen: false,
        imageUrl: '',
        rowIndex: 0,
        currentCategory: '',
        isSaving: false
    });

    // Global toggle: auto sync categories to Google Sheets S column
    const [autoSyncCategoriesToSheet, setAutoSyncCategoriesToSheet] = useState(true);

    const notesSyncCount = useMemo(() => {
        return Array.from(galleryNotes.values()).filter(note => note.note && note.rowIndex > 0).length;
    }, [galleryNotes]);

    const categoriesSyncCount = useMemo(() => {
        if (!effectiveImageColumn) return 0;
        const imageUrlToRowIndex = new Map<string, number>();
        effectiveData.rows.forEach((row, idx) => {
            const imageUrl = extractImageUrl(row[effectiveImageColumn]);
            if (imageUrl) {
                imageUrlToRowIndex.set(imageUrl, idx + 2);
            }
        });

        let count = 0;
        galleryCategories.forEach((category, imageUrl) => {
            if (category && imageUrlToRowIndex.get(imageUrl)) {
                count++;
            }
        });

        return count;
    }, [effectiveData.rows, effectiveImageColumn, galleryCategories]);

    const currentViewLabel = useMemo(() => {
        return config.viewMode === 'matrix'
            ? '矩阵'
            : config.viewMode === 'calendar'
                ? '日历'
                : config.viewMode === 'gallery'
                    ? '缩略图'
                    : '时间轴';
    }, [config.viewMode]);

    const showMatrixWidth = config.viewMode === 'matrix';
    const showScrollWidth = config.viewMode === 'calendar' && config.calendarMode === 'scroll';
    const showCalendarHeight = config.viewMode === 'calendar' && config.calendarMode !== 'scroll';
    const showViewSizeControls = showMatrixWidth || showScrollWidth || showCalendarHeight;

    const toggleSection = useCallback((key: string) => {
        setCollapsedSections(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify(Array.from(collapsedSections)));
        } catch { /* ignore */ }
    }, [collapsedSections]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(HEADER_COLLAPSED_KEY, headerCollapsed ? 'true' : 'false');
        } catch { /* ignore */ }
    }, [headerCollapsed]);

    // Custom category presets (synced to Firebase)
    interface CustomPreset {
        id: string;
        name: string;
        emoji: string;
        options: string[];
    }
    const [customPresets, setCustomPresets] = useState<CustomPreset[]>([]);
    const [showPresetEditor, setShowPresetEditor] = useState(false);
    const [editingPreset, setEditingPreset] = useState<CustomPreset | null>(null);
    const customPresetsLoadedRef = React.useRef(false);

    // Text grouping editor state
    const [textGroupSelection, setTextGroupSelection] = useState<Set<string>>(new Set()); // Selected values for assignment

    // Load custom presets from Firebase on mount
    React.useEffect(() => {
        if (customPresetsLoadedRef.current) return;

        const loadPresetsFromCloud = async () => {
            if (!isUserLoggedIn()) {
                customPresetsLoadedRef.current = true;
                return;
            }
            try {
                const { getCurrentUser } = await import('@/services/authService');
                const user = getCurrentUser();
                if (!user?.uid) return;

                const { loadCategoryPresets } = await import('@/services/firestoreService');
                const cloudPresets = await loadCategoryPresets(user.uid);
                if (cloudPresets && cloudPresets.length > 0) {
                    setCustomPresets(cloudPresets);
                }
            } catch (err) {
                console.error('[Presets] Failed to load presets:', err);
            } finally {
                customPresetsLoadedRef.current = true;
            }
        };

        loadPresetsFromCloud();
    }, []);

    // Save custom presets to Firebase
    const saveCustomPresetsToCloud = useCallback(async (presets: CustomPreset[]) => {
        if (!isUserLoggedIn()) return;
        try {
            const { getCurrentUser } = await import('@/services/authService');
            const user = getCurrentUser();
            if (!user?.uid) return;

            const { saveCategoryPresets } = await import('@/services/firestoreService');
            await saveCategoryPresets(user.uid, presets);
        } catch (err) {
            console.error('[Presets] Failed to save presets:', err);
        }
    }, []);

    // Add or update a custom preset
    const saveCustomPreset = useCallback((preset: CustomPreset) => {
        const existingIndex = customPresets.findIndex(p => p.id === preset.id);
        let newPresets: CustomPreset[];

        if (existingIndex >= 0) {
            newPresets = [...customPresets];
            newPresets[existingIndex] = preset;
        } else {
            newPresets = [...customPresets, preset];
        }

        setCustomPresets(newPresets);
        saveCustomPresetsToCloud(newPresets);
        setShowPresetEditor(false);
        setEditingPreset(null);
    }, [customPresets, saveCustomPresetsToCloud]);

    // Delete a custom preset
    const deleteCustomPreset = useCallback((presetId: string) => {
        const newPresets = customPresets.filter(p => p.id !== presetId);
        setCustomPresets(newPresets);
        saveCustomPresetsToCloud(newPresets);
    }, [customPresets, saveCustomPresetsToCloud]);

    // Helper: get category for an image
    const getCategoryForImage = useCallback((imageUrl: string): string => {
        return galleryCategories.get(imageUrl) || '';
    }, [galleryCategories]);

    // Load categories from Firebase on mount
    const categoriesCloudLoadedRef = React.useRef(false);
    React.useEffect(() => {
        if (categoriesCloudLoadedRef.current) return;

        const loadCategoriesFromCloud = async () => {
            if (!isUserLoggedIn()) {
                categoriesCloudLoadedRef.current = true;
                return;
            }
            try {
                const cloudCategories = await loadGalleryCategoriesFromCloud();
                if (cloudCategories.length > 0) {
                    const categoriesMap = new Map<string, string>();
                    cloudCategories.forEach(c => categoriesMap.set(c.imageUrl, c.category));
                    setGalleryCategories(categoriesMap);
                }
            } catch (err) {
                console.error('[Categories] Failed to load categories:', err);
            } finally {
                categoriesCloudLoadedRef.current = true;
            }
        };
        loadCategoriesFromCloud();
    }, []);

    // Load notes from Firebase on mount
    React.useEffect(() => {
        const loadNotesFromCloud = async () => {
            if (!isUserLoggedIn()) {
                notesCloudLoadedRef.current = true;
                return;
            }
            try {
                const cloudNotes = await loadGalleryNotesFromCloud();
                if (cloudNotes.length > 0) {
                    const notesMap = new Map<string, GalleryNote>();
                    cloudNotes.forEach(n => notesMap.set(n.imageUrl, n));
                    setGalleryNotes(notesMap);
                }
            } catch (err) {
                console.error('[Notes] Failed to load notes:', err);
            } finally {
                notesCloudLoadedRef.current = true;
            }
        };
        loadNotesFromCloud();
    }, []);

    // Auto-load notes and categories from spreadsheet columns (A=备注, B=媒体标签)
    const sheetDataLoadedRef = React.useRef(false);
    React.useEffect(() => {
        // Reset when data changes (new sheet loaded)
        if (!effectiveData.rows.length) {
            sheetDataLoadedRef.current = false;
            return;
        }

        // Only run once per data load
        if (sheetDataLoadedRef.current) return;
        sheetDataLoadedRef.current = true;

        // Get headers (column names)
        const headers = effectiveData.rows.length > 0 ? Object.keys(effectiveData.rows[0]) : [];

        // Find note column (A = 备注)
        const noteColumn = headers.find(h => h === NOTE_HEADER || h === 'Notes' || h === 'U');
        // Find category column (B = 媒体标签)
        const categoryColumn = headers.find(h => h === CATEGORY_HEADER || h === 'Category' || h === '分类' || h === 'V');

        if (!effectiveImageColumn) return;

        let notesLoaded = 0;
        let categoriesLoaded = 0;

        // Load from spreadsheet data
        const newNotes = new Map<string, GalleryNote>();
        const newCategories = new Map<string, string>();

        effectiveData.rows.forEach((row, idx) => {
            const imageUrl = extractImageUrl(row[effectiveImageColumn]);
            if (!imageUrl) return;

            // Load note from column
            if (noteColumn && row[noteColumn]) {
                const noteValue = String(row[noteColumn]).trim();
                if (noteValue && !galleryNotes.has(imageUrl)) {
                    newNotes.set(imageUrl, {
                        id: `sheet-note-${idx}`,
                        imageUrl,
                        note: noteValue,
                        rowIndex: idx + 2,
                        spreadsheetId: '',
                        sheetName: currentSheetName || '',
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    });
                    notesLoaded++;
                }
            }

            // Load category from column
            if (categoryColumn && row[categoryColumn]) {
                const categoryValue = String(row[categoryColumn]).trim();
                if (categoryValue && !galleryCategories.has(imageUrl)) {
                    newCategories.set(imageUrl, categoryValue);
                    categoriesLoaded++;
                }
            }
        });

        // Merge with existing (cloud data takes priority)
        if (newNotes.size > 0) {
            setGalleryNotes(prev => {
                const merged = new Map(prev);
                newNotes.forEach((note, url) => {
                    if (!merged.has(url)) {
                        merged.set(url, note);
                    }
                });
                return merged;
            });
        }

        if (newCategories.size > 0) {
            setGalleryCategories(prev => {
                const merged = new Map(prev);
                newCategories.forEach((cat, url) => {
                    if (!merged.has(url)) {
                        merged.set(url, cat);
                    }
                });
                return merged;
            });
        }

        if (notesLoaded > 0 || categoriesLoaded > 0) {
            setCopyFeedback(`📊 已从表格读取 ${notesLoaded} 条备注, ${categoriesLoaded} 条分类`);
            setTimeout(() => setCopyFeedback(null), 3000);
        }
    }, [effectiveData.rows, effectiveImageColumn, currentSheetName]);

    // Get note for an image
    const getNoteForImage = useCallback((imageUrl: string): string => {
        const note = galleryNotes.get(imageUrl);
        return note?.note || '';
    }, [galleryNotes]);

    // Find row index in original data (for sync-back)
    const findRowIndex = useCallback((row: DataRow, imageUrl: string): number => {
        // Find the index in the original effectiveData.rows array
        const index = effectiveData.rows.findIndex(r => {
            // Match by image URL column if available
            if (effectiveImageColumn && r[effectiveImageColumn]) {
                const rowImageUrl = extractImageUrl(r[effectiveImageColumn]);
                return rowImageUrl === imageUrl;
            }
            // Otherwise try to match all properties
            return Object.keys(row).every(k => r[k] === row[k]);
        });
        // Return 1-indexed row (add 2: 1 for header row, 1 for 0-based to 1-based)
        return index >= 0 ? index + 2 : -1;
    }, [effectiveData.rows, effectiveImageColumn]);

    // Open note modal
    const openNoteModal = useCallback((imageUrl: string, row: DataRow) => {
        const rowIndex = findRowIndex(row, imageUrl);
        const existingNote = getNoteForImage(imageUrl);
        setNoteModal({
            isOpen: true,
            imageUrl,
            rowIndex,
            currentNote: existingNote,
            isSaving: false,
            syncToSheet: autoSyncNotesToSheet  // Default follows global toggle
        });
    }, [findRowIndex, getNoteForImage, autoSyncNotesToSheet]);

    // Close note modal
    const closeNoteModal = useCallback(() => {
        setNoteModal(prev => ({ ...prev, isOpen: false }));
    }, []);

    // Save note (to Firebase and optionally to Google Sheets)
    const saveNote = useCallback(async (syncToSheet: boolean = true) => {
        if (!noteModal.imageUrl || noteModal.rowIndex <= 0) {
            alert('无法确定行位置，请稍后重试');
            return;
        }

        setNoteModal(prev => ({ ...prev, isSaving: true }));

        try {
            // Parse spreadsheet ID from sourceUrl
            let spreadsheetId: string | undefined;
            if (sourceUrl) {
                const parsed = parseGoogleSheetsUrl(sourceUrl);
                spreadsheetId = parsed?.spreadsheetId;
            }

            // Create note object
            const note: GalleryNote = {
                id: btoa(noteModal.imageUrl).slice(0, 32), // Simple hash from URL
                imageUrl: noteModal.imageUrl,
                note: noteModal.currentNote,
                rowIndex: noteModal.rowIndex,
                spreadsheetId,
                sheetName: currentSheetName,
                createdAt: galleryNotes.get(noteModal.imageUrl)?.createdAt || Date.now(),
                updatedAt: Date.now()
            };

            // Update local state FIRST (always succeeds)
            setGalleryNotes(prev => {
                const next = new Map(prev);
                next.set(noteModal.imageUrl, note);
                return next;
            });

            // Try to save to Firebase (optional, don't block on failure)
            if (isUserLoggedIn()) {
                try {
                    await upsertGalleryNoteToCloud(note);
                } catch (firebaseErr) {
                    console.warn('[Notes] Firebase save failed (permission issue?):', firebaseErr);
                    // Don't block - local state is already updated
                }
            }

            // Sync to Google Sheets column A (if enabled and available)
            if (syncToSheet && spreadsheetId && currentSheetName) {
                try {
                    const accessToken = getGoogleAccessToken();
                    if (accessToken) {
                        await ensureNotesAndCategoriesColumns(
                            spreadsheetId,
                            currentSheetName,
                            accessToken
                        );

                        // Then write the note value
                        await updateSingleCellInGoogleSheet(
                            spreadsheetId,
                            currentSheetName,
                            NOTE_COLUMN,  // Fixed column A for notes
                            noteModal.rowIndex,
                            noteModal.currentNote,
                            accessToken
                        );
                        setCopyFeedback('✅ 备注已保存并同步到表格');
                    } else {
                        setCopyFeedback('✅ 备注已保存（未登录Google，无法同步表格）');
                    }
                } catch (sheetErr) {
                    console.error('[Notes] Failed to sync to sheet:', sheetErr);
                    setCopyFeedback('⚠️ 备注已保存，但同步到表格失败');
                }
            } else {
                setCopyFeedback('✅ 备注已保存');
            }
            setTimeout(() => setCopyFeedback(null), 2000);

            closeNoteModal();
        } catch (err) {
            console.error('[Notes] Failed to save note:', err);
            setCopyFeedback('❌ 保存失败: ' + (err instanceof Error ? err.message : '未知错误'));
            setTimeout(() => setCopyFeedback(null), 3000);
        } finally {
            setNoteModal(prev => ({ ...prev, isSaving: false }));
        }
    }, [noteModal, sourceUrl, currentSheetName, galleryNotes, closeNoteModal]);

    // ==================== Category Modal Functions ====================
    // Open category modal
    const openCategoryModal = useCallback((imageUrl: string, row: DataRow) => {
        // Check login status before opening category modal
        if (!isUserLoggedIn()) {
            setShowLoginPrompt({
                action: '添加分类标签',
                onLogin: () => {
                    // After login, open the modal
                    const rowIndex = findRowIndex(row, imageUrl);
                    const existingCategory = getCategoryForImage(imageUrl);
                    setCategoryModal({
                        isOpen: true,
                        imageUrl,
                        rowIndex,
                        currentCategory: existingCategory,
                        isSaving: false
                    });
                }
            });
            return;
        }

        const rowIndex = findRowIndex(row, imageUrl);
        const existingCategory = getCategoryForImage(imageUrl);
        setCategoryModal({
            isOpen: true,
            imageUrl,
            rowIndex,
            currentCategory: existingCategory,
            isSaving: false
        });
    }, [findRowIndex, getCategoryForImage]);

    // Close category modal
    const closeCategoryModal = useCallback(() => {
        setCategoryModal(prev => ({ ...prev, isOpen: false }));
    }, []);

    // Save category
    const saveCategory = useCallback(async (selectedCategory: string, syncToSheet: boolean = true) => {
        if (!categoryModal.imageUrl || categoryModal.rowIndex <= 0) {
            alert('无法确定行位置，请稍后重试');
            return;
        }

        setCategoryModal(prev => ({ ...prev, isSaving: true }));

        // Parse spreadsheet ID first
        let spreadsheetId: string | undefined;
        if (sourceUrl) {
            const parsed = parseGoogleSheetsUrl(sourceUrl);
            spreadsheetId = parsed?.spreadsheetId;
        }

        try {
            // Update local state FIRST (always succeeds)
            setGalleryCategories(prev => {
                const next = new Map(prev);
                if (selectedCategory) {
                    next.set(categoryModal.imageUrl, selectedCategory);
                } else {
                    next.delete(categoryModal.imageUrl); // Clear category
                }
                return next;
            });

            // Try to save to Firebase (optional, don't block on failure)
            if (isUserLoggedIn() && selectedCategory) {
                try {
                    await upsertGalleryCategoryToCloud({
                        id: btoa(categoryModal.imageUrl).slice(0, 50),
                        imageUrl: categoryModal.imageUrl,
                        category: selectedCategory,
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    });
                } catch (firebaseErr) {
                    console.warn('[Category] Firebase save failed:', firebaseErr);
                    // Don't block - local state is already updated
                }
            }

            // Sync to Google Sheets column B (if enabled and available)
            if (syncToSheet && spreadsheetId && currentSheetName) {
                try {
                    const accessToken = getGoogleAccessToken();
                    if (accessToken) {
                        await ensureNotesAndCategoriesColumns(
                            spreadsheetId,
                            currentSheetName,
                            accessToken
                        );

                        // Then write the category value
                        await updateSingleCellInGoogleSheet(
                            spreadsheetId,
                            currentSheetName,
                            CATEGORY_COLUMN,
                            categoryModal.rowIndex,
                            selectedCategory,
                            accessToken
                        );
                        setCopyFeedback(`✅ 分类已保存并同步到表格`);
                    } else {
                        setCopyFeedback('✅ 分类已保存（未登录Google，无法同步表格）');
                    }
                } catch (sheetErr) {
                    console.error('[Category] Failed to sync to sheet:', sheetErr);
                    setCopyFeedback('⚠️ 分类已保存，但同步到表格失败');
                }
            } else {
                setCopyFeedback('✅ 分类已保存');
            }
            setTimeout(() => setCopyFeedback(null), 2000);

            closeCategoryModal();
        } catch (err) {
            console.error('[Category] Failed to save:', err);
            setCopyFeedback('❌ 保存分类失败');
            setTimeout(() => setCopyFeedback(null), 3000);
        } finally {
            setCategoryModal(prev => ({ ...prev, isSaving: false }));
        }
    }, [categoryModal, sourceUrl, currentSheetName, closeCategoryModal]);

    // Batch category modal state
    const [batchCategoryModal, setBatchCategoryModal] = useState<{
        isOpen: boolean;
        isSaving: boolean;
    }>({ isOpen: false, isSaving: false });

    // Open batch category modal
    const openBatchCategoryModal = useCallback(() => {
        if (selectedThumbnails.size === 0) {
            setCopyFeedback('⚠️ 请先选择要分类的图片');
            setTimeout(() => setCopyFeedback(null), 2000);
            return;
        }
        setBatchCategoryModal({ isOpen: true, isSaving: false });
    }, [selectedThumbnails.size]);

    // Apply category to all selected thumbnails
    const batchApplyCategory = useCallback(async (category: string, rows: DataRow[]) => {
        if (selectedThumbnails.size === 0) return;

        setBatchCategoryModal(prev => ({ ...prev, isSaving: true }));

        try {
            // Get selected image URLs
            const selectedUrls = Array.from(selectedThumbnails);
            let successCount = 0;

            // Update local state for all selected images
            setGalleryCategories(prev => {
                const next = new Map(prev);
                selectedUrls.forEach(url => {
                    if (category) {
                        next.set(url, category);
                    } else {
                        next.delete(url);
                    }
                });
                return next;
            });

            // Sync to Google Sheets if enabled
            if (autoSyncCategoriesToSheet && sourceUrl && currentSheetName) {
                const parsed = parseGoogleSheetsUrl(sourceUrl);
                const accessToken = getGoogleAccessToken();

                if (parsed?.spreadsheetId && accessToken) {
                    await ensureNotesAndCategoriesColumns(
                        parsed.spreadsheetId,
                        currentSheetName,
                        accessToken
                    );
                    for (const imageUrl of selectedUrls) {
                        // Find row index for this image
                        const row = rows.find(r => {
                            if (!config.imageColumn) return false;
                            const cellValue = r[config.imageColumn];
                            if (!cellValue) return false;
                            const url = extractImageUrl(cellValue);
                            return url === imageUrl;
                        });

                        if (row) {
                            const rowIndex = findRowIndex(row, imageUrl);
                            if (rowIndex > 0) {
                                try {
                                    await updateSingleCellInGoogleSheet(
                                        parsed.spreadsheetId,
                                        currentSheetName,
                                        CATEGORY_COLUMN,
                                        rowIndex,
                                        category,
                                        accessToken
                                    );
                                    successCount++;
                                } catch (err) {
                                    console.warn('[BatchCategory] Failed to sync row', rowIndex, err);
                                }
                            }
                        }
                    }
                    setCopyFeedback(`✅ 已为 ${selectedUrls.length} 张图片设置分类: ${category || '(已清除)'}，同步 ${successCount} 条`);
                } else {
                    setCopyFeedback(`✅ 已为 ${selectedUrls.length} 张图片设置分类: ${category || '(已清除)'}`);
                }
            } else {
                setCopyFeedback(`✅ 已为 ${selectedUrls.length} 张图片设置分类: ${category || '(已清除)'}`);
            }

            setTimeout(() => setCopyFeedback(null), 3000);
            setBatchCategoryModal({ isOpen: false, isSaving: false });
            setSelectedThumbnails(new Set()); // Clear selection
        } catch (err) {
            console.error('[BatchCategory] Failed:', err);
            setCopyFeedback('❌ 批量分类失败');
            setTimeout(() => setCopyFeedback(null), 3000);
            setBatchCategoryModal(prev => ({ ...prev, isSaving: false }));
        }
    }, [selectedThumbnails, autoSyncCategoriesToSheet, sourceUrl, currentSheetName, config.imageColumn, findRowIndex]);

    // Batch note modal state
    const [batchNoteModal, setBatchNoteModal] = useState<{
        isOpen: boolean;
        isSaving: boolean;
        note: string;
        imageUrls: string[];
    }>({ isOpen: false, isSaving: false, note: '', imageUrls: [] });

    // Open batch note modal
    const openBatchNoteModal = useCallback((imageUrls: string[]) => {
        if (imageUrls.length === 0) {
            setCopyFeedback('⚠️ 请先选择要添加备注的图片');
            setTimeout(() => setCopyFeedback(null), 2000);
            return;
        }
        setBatchNoteModal({ isOpen: true, isSaving: false, note: '', imageUrls });
    }, []);

    // Apply note to all selected images
    const batchApplyNote = useCallback(async (note: string, imageUrls: string[], rows: DataRow[]) => {
        if (imageUrls.length === 0) return;

        setBatchNoteModal(prev => ({ ...prev, isSaving: true }));

        try {
            let successCount = 0;

            // Update local state for all selected images
            setGalleryNotes(prev => {
                const next = new Map(prev);
                imageUrls.forEach(imageUrl => {
                    const row = rows.find(r => {
                        if (!config.imageColumn) return false;
                        const url = extractImageUrl(r[config.imageColumn]);
                        return url === imageUrl;
                    });
                    const rowIndex = row ? findRowIndex(row, imageUrl) : -1;

                    if (note) {
                        next.set(imageUrl, {
                            id: `batch-note-${Date.now()}-${imageUrl.slice(-8)}`,
                            imageUrl,
                            note,
                            rowIndex,
                            spreadsheetId: sourceUrl ? (parseGoogleSheetsUrl(sourceUrl)?.spreadsheetId || '') : '',
                            sheetName: currentSheetName || '',
                            createdAt: Date.now(),
                            updatedAt: Date.now()
                        });
                    } else {
                        next.delete(imageUrl);
                    }
                });
                return next;
            });

            // Sync to Google Sheets if enabled
            if (autoSyncNotesToSheet && sourceUrl && currentSheetName) {
                const parsed = parseGoogleSheetsUrl(sourceUrl);
                const accessToken = getGoogleAccessToken();

                if (parsed?.spreadsheetId && accessToken) {
                    await ensureNotesAndCategoriesColumns(
                        parsed.spreadsheetId,
                        currentSheetName,
                        accessToken
                    );
                    for (const imageUrl of imageUrls) {
                        const row = rows.find(r => {
                            if (!config.imageColumn) return false;
                            const url = extractImageUrl(r[config.imageColumn]);
                            return url === imageUrl;
                        });

                        if (row) {
                            const rowIndex = findRowIndex(row, imageUrl);
                            if (rowIndex > 0) {
                                try {
                                    await updateSingleCellInGoogleSheet(
                                        parsed.spreadsheetId,
                                        currentSheetName,
                                        NOTE_COLUMN,
                                        rowIndex,
                                        note,
                                        accessToken
                                    );
                                    successCount++;
                                } catch (err) {
                                    console.warn('[BatchNote] Failed to sync row', rowIndex, err);
                                }
                            }
                        }
                    }
                    setCopyFeedback(`✅ 已为 ${imageUrls.length} 张图片设置备注，同步 ${successCount} 条`);
                } else {
                    setCopyFeedback(`✅ 已为 ${imageUrls.length} 张图片设置备注`);
                }
            } else {
                setCopyFeedback(`✅ 已为 ${imageUrls.length} 张图片设置备注`);
            }

            setTimeout(() => setCopyFeedback(null), 3000);
            setBatchNoteModal({ isOpen: false, isSaving: false, note: '', imageUrls: [] });
            setSelectedThumbnails(new Set()); // Clear selection
        } catch (err) {
            console.error('[BatchNote] Failed:', err);
            setCopyFeedback('❌ 批量备注失败');
            setTimeout(() => setCopyFeedback(null), 3000);
            setBatchNoteModal(prev => ({ ...prev, isSaving: false }));
        }
    }, [autoSyncNotesToSheet, sourceUrl, currentSheetName, config.imageColumn, findRowIndex]);

    // Debounced config update for performance (especially for highlight rules)
    const configTimeoutRef = React.useRef<NodeJS.Timeout | null>(null);
    const debouncedUpdateConfig = useCallback((updates: Partial<GalleryConfig>) => {
        if (configTimeoutRef.current) {
            clearTimeout(configTimeoutRef.current);
        }
        configTimeoutRef.current = setTimeout(() => {
            const filtered = filterSharedUpdates(updates);
            if (Object.keys(filtered).length === 0) return;
            setConfig(prev => ({ ...prev, ...filtered }));
        }, 150);
    }, [filterSharedUpdates]);

    // Save config to localStorage and sync to Firebase (debounced)
    const [configSyncing, setConfigSyncing] = React.useState(false);
    const configCloudLoadedRef = React.useRef(false);

    React.useEffect(() => {
        latestConfigRef.current = config;
        const saveTimeout = setTimeout(() => {
            localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
        }, 300);

        // Also sync to Firebase (with longer debounce)
        let cloudSyncTimeout: NodeJS.Timeout | undefined;
        if (isUserLoggedIn() && configCloudLoadedRef.current) {
            cloudSyncTimeout = setTimeout(async () => {
                try {
                    setConfigSyncing(true);
                    await saveCurrentGalleryConfigToCloud(config as unknown as Record<string, unknown>);
                } catch (err) {
                    console.error('[Cloud Sync] Failed to save gallery config:', err);
                } finally {
                    setConfigSyncing(false);
                }
            }, 3000); // 3 second debounce for cloud
        }

        return () => {
            clearTimeout(saveTimeout);
            if (cloudSyncTimeout) clearTimeout(cloudSyncTimeout);
        };
    }, [config]);

    // Load current config from Firebase on mount
    React.useEffect(() => {
        const loadCloudConfig = async () => {
            if (!isUserLoggedIn()) {
                configCloudLoadedRef.current = true;
                return;
            }
            try {
                const cloudConfig = await loadCurrentGalleryConfigFromCloud();
                if (cloudConfig) {
                    setConfig(prev => {
                        const next = normalizeGalleryConfig({ ...prev, ...(cloudConfig as Partial<GalleryConfig>) });
                        if (!isUsingSharedConfig) return next;
                        const filtered = filterSharedUpdates(next);
                        return Object.keys(filtered).length > 0 ? { ...prev, ...filtered } : prev;
                    });
                }
            } catch (err) {
                console.error('[Cloud Sync] Failed to load gallery config:', err);
            } finally {
                configCloudLoadedRef.current = true;
            }
        };
        loadCloudConfig();
    }, [filterSharedUpdates, isUsingSharedConfig]);

    React.useEffect(() => {
        return () => {
            try {
                localStorage.setItem(STORAGE_KEY, JSON.stringify(latestConfigRef.current));
            } catch (e) {
                // ignore
            }
        };
    }, []);

    // Save savedConfigs to localStorage and sync to Firebase
    const [savedConfigsSyncing, setSavedConfigsSyncing] = React.useState(false);
    React.useEffect(() => {
        localStorage.setItem(SAVED_CONFIGS_KEY, JSON.stringify(savedConfigs));

        // Sync to Firebase
        if (isUserLoggedIn() && savedConfigs.length > 0) {
            const syncTimeout = setTimeout(async () => {
                try {
                    setSavedConfigsSyncing(true);
                    // Convert to cloud format
                    const cloudFormat = savedConfigs
                        .map(c => sanitizeSavedConfigForCloud(c))
                        .filter((c): c is SavedGalleryConfig => !!c);
                    await saveGallerySavedConfigsToCloud(cloudFormat);
                } catch (err) {
                    console.error('[Cloud Sync] Failed to sync saved configs:', err);
                } finally {
                    setSavedConfigsSyncing(false);
                }
            }, 2000);
            return () => clearTimeout(syncTimeout);
        }
    }, [savedConfigs]);

    // Load saved configs from Firebase on mount
    React.useEffect(() => {
        const loadCloudSavedConfigs = async () => {
            if (!isUserLoggedIn()) return;
            try {
                const cloudConfigs = await loadGallerySavedConfigsFromCloud();
                if (cloudConfigs.length > 0) {
                    // Merge with local, cloud takes priority
                    setSavedConfigs(prev => {
                        const merged = new Map<string, SavedConfig>();
                        prev.forEach(c => merged.set(c.id, c));
                        cloudConfigs.forEach(c => merged.set(c.id, {
                            id: c.id,
                            name: c.name,
                            config: c.config as unknown as GalleryConfig,
                            createdAt: c.createdAt
                        }));
                        return Array.from(merged.values()).sort((a, b) => b.createdAt - a.createdAt);
                    });
                }
            } catch (err) {
                console.error('[Cloud Sync] Failed to load saved configs:', err);
            }
        };
        loadCloudSavedConfigs();
    }, []);

    // Clean up invalid column references ONLY when switching to a different data source (not just sheet change)
    const prevDataSourceRef = React.useRef<string | null>(null);
    React.useEffect(() => {
        if (!data || !effectiveData.columns) return;

        // Determine if this is a major data source change (different spreadsheet, not just different sheet)
        const currentDataSource = data.fileName || '';
        const prevDataSource = prevDataSourceRef.current;

        // Only clean up if this is a completely different data source (not just a sheet change)
        // Also skip on first load (prevDataSource === null)
        if (prevDataSource === null || prevDataSource === currentDataSource) {
            prevDataSourceRef.current = currentDataSource;
            return;
        }

        prevDataSourceRef.current = currentDataSource;
        if (isUsingSharedConfig) return;

        const availableCols = new Set(effectiveData.columns);
        let needsUpdate = false;
        const updates: Partial<GalleryConfig> = {};

        // Clean labelColumns
        const validLabelCols = config.labelColumns.filter(col => availableCols.has(col));
        if (validLabelCols.length !== config.labelColumns.length) {
            updates.labelColumns = validLabelCols;
            needsUpdate = true;
        }

        // Clean imageColumn
        if (config.imageColumn && !availableCols.has(config.imageColumn)) {
            updates.imageColumn = '';
            needsUpdate = true;
        }

        // Clean dateColumn
        if (config.dateColumn && !availableCols.has(config.dateColumn)) {
            updates.dateColumn = '';
            needsUpdate = true;
        }

        // Clean groupColumn
        if (config.groupColumn && !availableCols.has(config.groupColumn)) {
            updates.groupColumn = '';
            needsUpdate = true;
        }

        // Clean customFilters
        const validFilters = config.customFilters.filter(f => !f.column || availableCols.has(f.column));
        if (validFilters.length !== config.customFilters.length) {
            updates.customFilters = validFilters;
            needsUpdate = true;
        }

        // Clean sortRules
        const validSortRules = config.sortRules.filter(r => !r.column || availableCols.has(r.column));
        if (validSortRules.length !== config.sortRules.length) {
            updates.sortRules = validSortRules.length > 0 ? validSortRules : [{ column: '', descending: false }];
            needsUpdate = true;
        }

        if (needsUpdate) {
            setConfig(prev => ({ ...prev, ...updates }));
        }
    }, [data?.fileName, data?.columns]); // Only run when fileName or columns change

    // Load presets from cloud on mount (TransposePanel-style)
    useEffect(() => {
        const loadFromCloud = async () => {
            if (!isUserLoggedIn()) {
                setCloudSyncEnabled(false);
                return;
            }
            setCloudSyncEnabled(true);
            setCloudSyncing(true);
            try {
                const cloudPresets = await loadPresetsFromCloud();
                // Filter to only gallery presets (check for gallery-specific fields)
                const galleryPresets = cloudPresets.filter(p => {
                    const cfg = p.config as unknown as GalleryConfig;
                    return cfg && (cfg.viewMode !== undefined || cfg.imageColumn !== undefined);
                });
                if (galleryPresets.length > 0) {
                    setPresets(galleryPresets.map(p => ({
                        id: p.id,
                        name: p.name,
                        config: p.config as unknown as GalleryConfig,
                        createdAt: p.createdAt?.toMillis?.() || Date.now()
                    })));
                }
                setCloudError(null);
            } catch (err) {
                console.error('云端加载失败:', err);
                setCloudError('云端加载失败');
            } finally {
                setCloudSyncing(false);
            }
        };
        loadFromCloud();
    }, []);

    useEffect(() => {
        const el = contentScrollRef.current;
        if (!el) return;

        const handleScroll = () => {
            if (galleryScrollRafRef.current !== null) return;
            galleryScrollRafRef.current = requestAnimationFrame(() => {
                galleryScrollRafRef.current = null;
                if (!contentScrollRef.current) return;
                setGalleryScrollTop(contentScrollRef.current.scrollTop);
            });
        };

        el.addEventListener('scroll', handleScroll, { passive: true });
        setGalleryScrollTop(el.scrollTop);
        setGalleryViewportHeight(el.clientHeight);
        setGalleryViewportWidth(el.clientWidth);

        let observer: ResizeObserver | null = null;
        if (typeof ResizeObserver !== 'undefined') {
            observer = new ResizeObserver(() => {
                if (!contentScrollRef.current) return;
                setGalleryViewportHeight(contentScrollRef.current.clientHeight);
                setGalleryViewportWidth(contentScrollRef.current.clientWidth);
            });
            observer.observe(el);
        }

        return () => {
            el.removeEventListener('scroll', handleScroll);
            if (observer) observer.disconnect();
        };
    }, []);

    useLayoutEffect(() => {
        const container = contentScrollRef.current;
        const grid = galleryGridRef.current;
        if (!container || !grid) return;

        const containerRect = container.getBoundingClientRect();
        const gridRect = grid.getBoundingClientRect();
        galleryGridOffsetRef.current = gridRect.top - containerRect.top + container.scrollTop;
    }, [config.thumbnailSize, config.viewMode, config.groupColumn, showFavorites, showCategoryView, galleryViewportWidth]);

    // Update config helper (mark as modified)
    const updateConfigWithPreset = useCallback((updates: Partial<GalleryConfig>) => {
        const filtered = filterSharedUpdates(updates);
        if (Object.keys(filtered).length === 0) return;
        setConfig(prev => ({ ...prev, ...filtered }));
        setActivePresetId(null); // Mark as modified
    }, [filterSharedUpdates]);

    // Save current config as preset (TransposePanel-style)
    const savePreset = useCallback(async () => {
        // Generate default name based on config
        const viewModeLabel = config.viewMode === 'matrix' ? '矩阵' : config.viewMode === 'calendar' ? '日历' : config.viewMode === 'gallery' ? '缩略图' : config.viewMode === 'tree' ? '树形' : '时间轴';
        const sortInfo = config.sortRules.filter(r => r.column).length > 0
            ? ` (${config.sortRules.filter(r => r.column).map(r => r.column).join('→')})`
            : '';
        const groupColumnLabel = config.groupColumn === '_sourceSheet' ? '分页' : config.groupColumn;
        const name = config.groupColumn
            ? `${viewModeLabel} ${groupColumnLabel}${sortInfo}`
            : `版本 ${presets.length + 1}`;

        const newPreset: GalleryPreset = {
            id: `gallery_${Date.now().toString()}`,
            name,
            config: { ...config },
            createdAt: Date.now()
        };
        setPresets(prev => [...prev, newPreset]);
        setActivePresetId(newPreset.id);

        // Sync to cloud if logged in
        if (cloudSyncEnabled) {
            setCloudSyncing(true);
            try {
                await savePresetToCloud({
                    id: newPreset.id,
                    name: newPreset.name,
                    config: newPreset.config as unknown as Record<string, unknown>
                });
                setCloudError(null);
            } catch (err) {
                console.error('云端保存失败:', err);
                setCloudError('云端保存失败');
            } finally {
                setCloudSyncing(false);
            }
        }
    }, [config, presets.length, cloudSyncEnabled]);

    // Load preset - filter columns based on current data source
    const loadPreset = useCallback((preset: GalleryPreset) => {
        // Filter columns to only include ones that exist in current data source
        const availableColumns = effectiveData.columns;
        const filteredConfig = normalizeGalleryConfig({
            ...preset.config,
            dateColumn: availableColumns.includes(preset.config.dateColumn)
                ? preset.config.dateColumn
                : '',
            groupColumn: availableColumns.includes(preset.config.groupColumn)
                ? preset.config.groupColumn
                : '',
            accountColumn: availableColumns.includes(preset.config.accountColumn)
                ? preset.config.accountColumn
                : '',
            imageColumn: availableColumns.includes(preset.config.imageColumn)
                ? preset.config.imageColumn
                : '',
            linkColumn: availableColumns.includes(preset.config.linkColumn)
                ? preset.config.linkColumn
                : '',
            labelColumns: preset.config.labelColumns?.filter(col => availableColumns.includes(col)) || [],
            sortRules: preset.config.sortRules?.filter(rule => !rule.column || availableColumns.includes(rule.column)) || [],
            matrixRowColumn: availableColumns.includes(preset.config.matrixRowColumn)
                ? preset.config.matrixRowColumn
                : '',
            matrixColColumn: availableColumns.includes(preset.config.matrixColColumn)
                ? preset.config.matrixColColumn
                : '',
        });
        if (isUsingSharedConfig) {
            const filtered = filterSharedUpdates(filteredConfig);
            if (Object.keys(filtered).length > 0) {
                setConfig(prev => ({ ...prev, ...filtered }));
            }
        } else {
            setConfig(filteredConfig);
        }
        setActivePresetId(preset.id);
    }, [effectiveData.columns, filterSharedUpdates, isUsingSharedConfig]);

    // Delete preset
    const deletePreset = useCallback(async (id: string) => {
        setPresets(prev => prev.filter(p => p.id !== id));
        if (activePresetId === id) setActivePresetId(null);

        // Sync to cloud if logged in
        if (cloudSyncEnabled) {
            try {
                await deletePresetFromCloud(id);
            } catch (err) {
                console.error('云端删除失败:', err);
            }
        }
    }, [activePresetId, cloudSyncEnabled]);

    // Rename preset
    const renamePreset = useCallback(async (id: string, newName: string) => {
        // Find the preset to update
        const presetToRename = presets.find(p => p.id === id);
        if (!presetToRename) return;

        // Update local state
        setPresets(prev => prev.map(p =>
            p.id === id ? { ...p, name: newName } : p
        ));

        // Sync to cloud if logged in
        if (cloudSyncEnabled) {
            setCloudSyncing(true);
            try {
                await savePresetToCloud({
                    id: presetToRename.id,
                    name: newName,
                    config: presetToRename.config as unknown as Record<string, unknown>
                });
                setCloudError(null);
            } catch (err) {
                console.error('云端保存失败:', err);
                setCloudError('重命名同步失败');
            } finally {
                setCloudSyncing(false);
            }
        }
    }, [presets, cloudSyncEnabled]);

    // Copy filtered data to clipboard (for pasting to Google Sheets) - will use processedRows
    const copyDataToClipboardRef = React.useRef<(() => void) | null>(null);

    // Load cloud configs
    const loadCloudConfigs = useCallback(async () => {
        // Skip if user is not logged in
        if (!isUserLoggedIn()) return;

        try {
            const { listGalleryConfigs } = await import('@/services/firestoreService');
            // Get user ID from localStorage or context
            const email = localStorage.getItem('cloud_sync_email');
            if (!email) return;
            const userId = btoa(email.trim().toLowerCase()).replace(/[^a-zA-Z0-9]/g, '_');
            const configs = await listGalleryConfigs(userId);
            setCloudConfigs(configs);
        } catch (e) {
            // Silently ignore permission errors - user might not be fully authenticated
            console.warn('Failed to load cloud configs:', e);
        }
    }, []);

    // Save config to Firebase
    const saveToCloud = useCallback(async (configName: string) => {
        try {
            setIsCloudSyncing(true);
            setCloudSyncStatus('saving');
            const { saveGalleryConfig } = await import('@/services/firestoreService');
            const email = localStorage.getItem('cloud_sync_email');
            if (!email) {
                alert('请先在云同步面板登录');
                setCloudSyncStatus('error');
                return;
            }
            const userId = btoa(email.trim().toLowerCase()).replace(/[^a-zA-Z0-9]/g, '_');
            await saveGalleryConfig(userId, configName, config);
            setCloudSyncStatus('success');
            await loadCloudConfigs();
            setTimeout(() => setCloudSyncStatus('idle'), 2000);
        } catch (e) {
            console.error('Failed to save to cloud:', e);
            setCloudSyncStatus('error');
        } finally {
            setIsCloudSyncing(false);
        }
    }, [config, loadCloudConfigs]);

    // Load config from Firebase
    const loadFromCloud = useCallback(async (configName: string) => {
        try {
            setIsCloudSyncing(true);
            setCloudSyncStatus('loading');
            const { loadGalleryConfig } = await import('@/services/firestoreService');
            const email = localStorage.getItem('cloud_sync_email');
            if (!email) {
                alert('请先在云同步面板登录');
                setCloudSyncStatus('error');
                return;
            }
            const userId = btoa(email.trim().toLowerCase()).replace(/[^a-zA-Z0-9]/g, '_');
            const cloudConfig = await loadGalleryConfig(userId, configName);
            if (cloudConfig) {
                const normalized = normalizeGalleryConfig(cloudConfig as Partial<GalleryConfig>);
                if (isUsingSharedConfig) {
                    const filtered = filterSharedUpdates(normalized);
                    if (Object.keys(filtered).length > 0) {
                        setConfig(prev => ({ ...prev, ...filtered }));
                    }
                } else {
                    setConfig(normalized);
                }
                setCloudSyncStatus('success');
            }
            setTimeout(() => setCloudSyncStatus('idle'), 2000);
        } catch (e) {
            console.error('Failed to load from cloud:', e);
            setCloudSyncStatus('error');
        } finally {
            setIsCloudSyncing(false);
        }
    }, [filterSharedUpdates, isUsingSharedConfig]);

    // Delete cloud config
    const deleteFromCloud = useCallback(async (configName: string) => {
        try {
            const { deleteGalleryConfig } = await import('@/services/firestoreService');
            const email = localStorage.getItem('cloud_sync_email');
            if (!email) return;
            const userId = btoa(email.trim().toLowerCase()).replace(/[^a-zA-Z0-9]/g, '_');
            await deleteGalleryConfig(userId, configName);
            await loadCloudConfigs();
        } catch (e) {
            console.error('Failed to delete from cloud:', e);
        }
    }, [loadCloudConfigs]);

    // Load cloud configs on mount
    React.useEffect(() => {
        loadCloudConfigs();
    }, [loadCloudConfigs]);

    // Google Sheets sync state
    const [sheetsUrl, setSheetsUrl] = useState('');
    const [sheetsSpreadsheetId, setSheetsSpreadsheetId] = useState<string | null>(null);
    const [sheetsSyncing, setSheetsSyncing] = useState(false);
    const [sheetsError, setSheetsError] = useState<string | null>(null);

    // Sync to Google Sheets - will be defined after processedRows
    const syncToGoogleSheetRef = React.useRef<(() => Promise<void>) | null>(null);

    // Auto-detect columns
    React.useEffect(() => {
        if (effectiveData.rows.length === 0) return;
        if (isUsingSharedConfig) return;

        const updates: Partial<GalleryConfig> = {};

        // 检查已配置的图片列是否存在于当前数据中
        const imageColumnValid = config.imageColumn && effectiveData.columns.includes(config.imageColumn);

        if (!imageColumnValid) {
            let imageCol = '';

            // 1️⃣ 优先级最高：查找包含 =IMAGE() 公式的列
            for (const col of effectiveData.columns) {
                if (isImageFormulaColumn(effectiveData.rows, col)) {
                    const sample = effectiveData.rows.slice(0, 2).map(r => String(r[col] || '').substring(0, 60));
                    imageCol = col;
                    break;
                }
            }

            // 2️⃣ 其次：查找默认列名
            if (!imageCol && effectiveData.columns.includes(DEFAULT_IMAGE_COLUMN)) {
                imageCol = DEFAULT_IMAGE_COLUMN;
            }

            // 3️⃣ 最后：查找任何包含图片 URL 的列
            if (!imageCol) {
                for (const col of effectiveData.columns) {
                    if (isLikelyImageColumn(effectiveData.rows, col)) {
                        const sample = effectiveData.rows.slice(0, 2).map(r => String(r[col] || '').substring(0, 60));
                        imageCol = col;
                        break;
                    }
                }
            }

            if (!imageCol) {
            }
            if (imageCol) updates.imageColumn = imageCol;
        } else {
        }

        if (!config.linkColumn) {
            let linkCol = '';
            if (effectiveData.columns.includes(DEFAULT_LINK_COLUMN)) {
                linkCol = DEFAULT_LINK_COLUMN;
            } else {
                linkCol = effectiveData.columns.find(col => /链接|link|url|网址/i.test(col)) || '';
            }
            if (linkCol) updates.linkColumn = linkCol;
        }

        if (!config.dateColumn) {
            const dateCol = effectiveData.columns.find(col => isLikelyDateColumn(effectiveData.rows, col)) || '';
            if (dateCol) updates.dateColumn = dateCol;
        }

        if (!config.accountColumn) {
            const accountCol = effectiveData.columns.find(col => /账号|account|user|博主/i.test(col)) || '';
            if (accountCol) updates.accountColumn = accountCol;
        }

        if (Object.keys(updates).length > 0) {
            setConfig(prev => ({ ...prev, ...updates }));
        }
    }, [data, config.imageColumn, config.linkColumn, config.dateColumn, config.accountColumn]);

    // Auto-fill label columns if empty (allow fallback when shared config has no display columns)
    React.useEffect(() => {
        if (effectiveData.rows.length === 0) return;
        if (config.labelColumns.length > 0) return;
        const sharedDisplayCount = sharedConfig?.displayColumns?.length ?? 0;
        if (isUsingSharedConfig && sharedDisplayCount > 0) return;

        const defaultCols = effectiveData.columns.filter(c =>
            c.includes('贴文多媒体') || c.includes('多媒体') ||
            c.includes('点赞') || c.includes('贴文点赞量') ||
            c.includes('播放') || c.includes('评论')
        );
        if (defaultCols.length > 0) {
            setConfig(prev => ({ ...prev, labelColumns: defaultCols }));
        }
    }, [data, config.labelColumns, isUsingSharedConfig, sharedConfig?.displayColumns]);

    const updateConfig = useCallback((updates: Partial<GalleryConfig>) => {
        const filtered = filterSharedUpdates(updates);
        if (Object.keys(filtered).length === 0) return;
        setConfig(prev => ({ ...prev, ...filtered }));
    }, [filterSharedUpdates]);

    const updateConfigPreserveScroll = useCallback((updates: Partial<GalleryConfig>) => {
        // Note: Removed scroll preservation as it causes page jumping when filter changes reduce content height
        const filtered = filterSharedUpdates(updates);
        if (Object.keys(filtered).length === 0) return;
        setConfig(prev => ({ ...prev, ...filtered }));
    }, [filterSharedUpdates]);

    // Copy image to clipboard
    const copyImageToClipboard = useCallback(async (imageUrl: string) => {
        try {
            const response = await fetch(imageUrl);
            const blob = await response.blob();
            await navigator.clipboard.write([
                new ClipboardItem({ [blob.type]: blob })
            ]);
            setCopyFeedback('已复制图片');
            setTimeout(() => setCopyFeedback(null), 1500);
        } catch (err) {
            // Fallback: copy URL
            try {
                await navigator.clipboard.writeText(imageUrl);
                setCopyFeedback('已复制链接');
                setTimeout(() => setCopyFeedback(null), 1500);
            } catch {
                setCopyFeedback('复制失败');
                setTimeout(() => setCopyFeedback(null), 1500);
            }
        }
    }, []);

    // Context menu helpers
    const copyTextToClipboard = useCallback(async (text: string, label: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopyFeedback(`已复制${label}`);
            setTimeout(() => setCopyFeedback(null), 1500);
        } catch {
            setCopyFeedback('复制失败');
            setTimeout(() => setCopyFeedback(null), 1500);
        }
        setContextMenu(null);
    }, []);

    const handleContextMenu = useCallback((e: React.MouseEvent, row: DataRow, imageUrl: string) => {
        e.preventDefault();
        // Get image formula from the cell
        const imageFormula = config.imageColumn ? String(row[config.imageColumn] || '') : '';
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            row,
            imageUrl,
            imageFormula
        });
    }, [config.imageColumn]);

    // Close context menu on click outside
    React.useEffect(() => {
        const handleClick = () => setContextMenu(null);
        if (contextMenu) {
            document.addEventListener('click', handleClick);
            return () => document.removeEventListener('click', handleClick);
        }
    }, [contextMenu]);

    React.useLayoutEffect(() => {
        if (!contextMenu) {
            setContextMenuPos(null);
            return;
        }
        const menuEl = contextMenuRef.current;
        if (!menuEl) {
            setContextMenuPos({ x: contextMenu.x, y: contextMenu.y });
            return;
        }
        const margin = 8;
        const { offsetWidth: menuWidth, offsetHeight: menuHeight } = menuEl;
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;
        const safeX = Math.max(margin, Math.min(contextMenu.x, viewportWidth - menuWidth - margin));
        const safeY = Math.max(margin, Math.min(contextMenu.y, viewportHeight - menuHeight - margin));
        setContextMenuPos({ x: safeX, y: safeY });
    }, [contextMenu]);

    // Save favorites to localStorage and sync to Firebase
    const [favoritesSyncing, setFavoritesSyncing] = useState(false);
    React.useEffect(() => {
        try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
        } catch (err) {
            console.warn('[Favorites] localStorage quota exceeded, skipping local save:', err);
        }

        // Also sync to Firebase if user is logged in (debounced)
        if (isUserLoggedIn()) {
            const syncTimeout = setTimeout(async () => {
                try {
                    setFavoritesSyncing(true);
                    const sanitized = favorites
                        .map(fav => sanitizeFavoriteForCloud(fav))
                        .filter((fav): fav is CloudFavoriteItem => !!fav);
                    await saveFavoritesToCloud(sanitized);
                } catch (err) {
                    console.error('Failed to sync favorites to cloud:', err);
                } finally {
                    setFavoritesSyncing(false);
                }
            }, 1000); // 1 second debounce
            return () => clearTimeout(syncTimeout);
        }
    }, [favorites]);

    React.useEffect(() => {
        if (!showFolderMenu && !showBatchFolderMenu) return;
        const handleDocMouseDown = (e: MouseEvent) => {
            const target = e.target as Node;
            if (showFolderMenu && folderMenuRef.current?.contains(target)) return;
            if (showBatchFolderMenu && batchFolderMenuRef.current?.contains(target)) return;
            setShowFolderMenu(null);
            setShowBatchFolderMenu(null);
        };
        document.addEventListener('mousedown', handleDocMouseDown);
        return () => document.removeEventListener('mousedown', handleDocMouseDown);
    }, [showFolderMenu, showBatchFolderMenu]);

    // Load favorites from Firebase on mount if user is logged in
    React.useEffect(() => {
        const loadCloudFavorites = async () => {
            if (!isUserLoggedIn()) return;
            try {
                const cloudFavs = await loadFavoritesFromCloud();
                if (cloudFavs.length > 0) {
                    // Merge cloud favorites with local, preferring cloud
                    setFavorites(prev => {
                        const localMap = new Map(prev.map(f => [f.imageUrl, f]));
                        cloudFavs.forEach(cf => {
                            localMap.set(cf.imageUrl, cf as FavoriteItem);
                        });
                        return Array.from(localMap.values()).sort((a, b) => b.addedAt - a.addedAt);
                    });
                }
            } catch (err) {
                console.error('Failed to load favorites from cloud:', err);
            }
        };
        loadCloudFavorites();
    }, []);

    // Favorites helper functions
    const isFavorited = useCallback((imageUrl: string) => {
        return favorites.some(f => f.imageUrl === imageUrl);
    }, [favorites]);

    // Get folder name for display
    const getFolderName = useCallback((folderId: string) => {
        const folder = favoriteFolders.find(f => f.id === folderId);
        return folder ? `${folder.emoji || '📁'} ${folder.name}` : '默认收藏夹';
    }, [favoriteFolders]);

    // Get favorites in a specific folder
    const getFavoritesInFolder = useCallback((folderId: string) => {
        if (folderId === 'all') return favorites;
        return favorites.filter(f => (f.folderId || DEFAULT_FOLDER_ID) === folderId);
    }, [favorites]);

    // Get filtered favorites by folder and search keyword
    const getFilteredFavorites = useCallback((folderId: string, searchKeyword: string) => {
        let result = getFavoritesInFolder(folderId);
        if (searchKeyword.trim()) {
            const keyword = searchKeyword.trim().toLowerCase();
            result = result.filter(fav => {
                // Search in rowData values
                const rowDataMatch = Object.values(fav.rowData).some(val =>
                    val && String(val).toLowerCase().includes(keyword)
                );
                // Search in note if exists
                const noteData = galleryNotes.get(fav.imageUrl);
                const noteMatch = noteData?.note?.toLowerCase().includes(keyword);
                // Search in category if exists
                const category = galleryCategories.get(fav.imageUrl);
                const categoryMatch = category?.toLowerCase().includes(keyword);
                return rowDataMatch || noteMatch || categoryMatch;
            });
        }
        return result;
    }, [getFavoritesInFolder, galleryNotes, galleryCategories]);

    // Add to specific folder
    const addToFolder = useCallback((imageUrl: string, row: DataRow, folderId: string) => {
        // Check if already exists in any folder
        const existing = favorites.find(f => f.imageUrl === imageUrl);
        if (existing) {
            // Move to new folder
            setFavorites(prev => prev.map(f =>
                f.imageUrl === imageUrl ? { ...f, folderId } : f
            ));
            const folder = favoriteFolders.find(f => f.id === folderId);
            setCopyFeedback(`已移动到 ${folder?.emoji || '📁'} ${folder?.name || '收藏夹'}`);
        } else {
            // Add new
            const newItem: FavoriteItem = {
                id: `fav-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                imageUrl,
                rowData: { ...row },
                addedAt: Date.now(),
                folderId
            };
            setFavorites(prev => [newItem, ...prev]);
            const folder = favoriteFolders.find(f => f.id === folderId);
            setCopyFeedback(`已添加到 ${folder?.emoji || '📁'} ${folder?.name || '收藏夹'}`);
        }
        setTimeout(() => setCopyFeedback(null), 1500);
        setShowFolderMenu(null);
    }, [favorites, favoriteFolders]);

    // Create new folder
    const createFolder = useCallback((name: string, emoji: string = '📁') => {
        const newFolder: FavoriteFolder = {
            id: `folder-${Date.now()}`,
            name,
            emoji,
            createdAt: Date.now()
        };
        setFavoriteFolders(prev => [...prev, newFolder]);
        setCopyFeedback(`已创建收藏夹: ${emoji} ${name}`);
        setTimeout(() => setCopyFeedback(null), 1500);
        return newFolder.id;
    }, []);

    // Delete folder (move items to default folder)
    const deleteFolder = useCallback((folderId: string) => {
        if (folderId === DEFAULT_FOLDER_ID) return; // Cannot delete default folder
        // Move all items in this folder to default
        setFavorites(prev => prev.map(f =>
            f.folderId === folderId ? { ...f, folderId: DEFAULT_FOLDER_ID } : f
        ));
        setFavoriteFolders(prev => prev.filter(f => f.id !== folderId));
        if (activeFolderId === folderId) {
            setActiveFolderId(DEFAULT_FOLDER_ID);
        }
        setCopyFeedback('收藏夹已删除');
        setTimeout(() => setCopyFeedback(null), 1500);
    }, [activeFolderId]);

    // Rename folder
    const renameFolder = useCallback((folderId: string, newName: string, newEmoji?: string) => {
        setFavoriteFolders(prev => prev.map(f =>
            f.id === folderId ? { ...f, name: newName, emoji: newEmoji || f.emoji } : f
        ));
    }, []);

    // ==================== Drag & Drop Handlers ====================

    // Handle drag start from gallery thumbnail
    const handleThumbnailDragStart = useCallback((
        e: React.DragEvent,
        imageUrl: string,
        row: DataRow,
        rowId: string,
        sourceFolderId?: string
    ) => {
        // If multiple items selected and dragged item is in selection, drag all of them
        let imagesToDrag: Array<{ imageUrl: string; rowData: DataRow }> = [{ imageUrl, rowData: row }];

        if (gallerySelectMode && selectedThumbnails.size > 0) {
            imagesToDrag = Array.from(selectedThumbnails).map(selectedRowId => {
                // rowId format: "imageUrl||sourceSheet||originalIndex"
                const parts = selectedRowId.split('||');
                const originalIndex = parts.length >= 3 ? parseInt(parts[2], 10) : -1;
                const rowImageUrl = parts[0] || '';

                const foundRow = originalIndex >= 0 && originalIndex < effectiveData.rows.length
                    ? effectiveData.rows[originalIndex]
                    : null;
                const rowData = foundRow || row;

                const resolvedUrl = rowImageUrl || extractImageUrl(rowData[effectiveImageColumn || config.imageColumn]);
                if (!resolvedUrl) return null;
                return { imageUrl: resolvedUrl, rowData };
            }).filter((item): item is { imageUrl: string; rowData: DataRow } => item !== null);

            if (imagesToDrag.length > 1) {
                const seen = new Set<string>();
                imagesToDrag = imagesToDrag.filter(item => {
                    if (seen.has(item.imageUrl)) return false;
                    seen.add(item.imageUrl);
                    return true;
                });
            }

            if (imagesToDrag.length === 0) {
                imagesToDrag = [{ imageUrl, rowData: row }];
            }
        }

        e.dataTransfer.setData('application/json', JSON.stringify({
            type: 'gallery-thumbnails',
            imageUrls: imagesToDrag.map(item => item.imageUrl),
            rowDataList: imagesToDrag.map(item => item.rowData),
            rowData: row, // Keep for backwards compatibility
            sourceFolderId
        }));
        e.dataTransfer.effectAllowed = 'copyMove';

        // Create a small drag preview image
        const dragPreview = document.createElement('div');
        dragPreview.style.cssText = `
            position: absolute; 
            left: -9999px; 
            top: -9999px;
            width: 60px; 
            height: 60px; 
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            display: flex;
            align-items: center;
            justify-content: center;
            font-size: 10px;
            color: #64748b;
            overflow: hidden;
        `;

        // Add thumbnail image
        const img = document.createElement('img');
        img.src = imageUrl;
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        dragPreview.appendChild(img);

        // If multiple items, show count badge
        if (imagesToDrag.length > 1) {
            const badge = document.createElement('div');
            badge.style.cssText = `
                position: absolute;
                top: -4px;
                right: -4px;
                background: #3b82f6;
                color: white;
                font-size: 10px;
                font-weight: bold;
                width: 20px;
                height: 20px;
                border-radius: 50%;
                display: flex;
                align-items: center;
                justify-content: center;
                border: 2px solid white;
            `;
            badge.textContent = String(imagesToDrag.length);
            dragPreview.appendChild(badge);
        }

        document.body.appendChild(dragPreview);
        e.dataTransfer.setDragImage(dragPreview, 30, 30);

        // Clean up the preview element after a short delay
        setTimeout(() => {
            if (dragPreview.parentNode) {
                dragPreview.parentNode.removeChild(dragPreview);
            }
        }, 0);

        setIsDraggingImage(true);
        setDragSourceFolderId(sourceFolderId || null);

        // In classification mode, track which items are being dragged
        if (classificationMode) {
            if (selectedForClassification.size > 0) {
                // If items are selected for classification, drag all of them
                setDraggedItems(Array.from(selectedForClassification));
            } else {
                // Otherwise, just drag this single item
                setDraggedItems([rowId]);
            }
        }
    }, [gallerySelectMode, selectedThumbnails, effectiveData.rows, effectiveData.columns, config.imageColumn, effectiveImageColumn, classificationMode, selectedForClassification]);

    // Handle drag start from favorite item (for reordering and cross-folder move)
    const handleFavoriteDragStart = useCallback((
        e: React.DragEvent,
        favorite: FavoriteItem,
        index: number
    ) => {
        e.dataTransfer.setData('application/json', JSON.stringify({
            type: 'favorite-item',
            favoriteId: favorite.id,
            imageUrl: favorite.imageUrl,
            sourceFolderId: favorite.folderId,
            sourceIndex: index
        }));
        e.dataTransfer.effectAllowed = 'move';

        // Create a small drag preview image
        const dragPreview = document.createElement('div');
        dragPreview.style.cssText = `
            position: absolute; 
            left: -9999px; 
            top: -9999px;
            width: 60px; 
            height: 60px; 
            background: white;
            border-radius: 8px;
            box-shadow: 0 4px 12px rgba(0,0,0,0.2);
            overflow: hidden;
        `;

        const img = document.createElement('img');
        img.src = favorite.imageUrl;
        img.style.cssText = 'width: 100%; height: 100%; object-fit: cover;';
        dragPreview.appendChild(img);

        document.body.appendChild(dragPreview);
        e.dataTransfer.setDragImage(dragPreview, 30, 30);

        setTimeout(() => {
            if (dragPreview.parentNode) {
                dragPreview.parentNode.removeChild(dragPreview);
            }
        }, 0);

        setIsDraggingImage(true);
        setDragSourceFolderId(favorite.folderId || null);
    }, []);

    // Handle drag end
    const handleDragEnd = useCallback(() => {
        setIsDraggingImage(false);
        setDragOverTarget(null);
        setDragSourceFolderId(null);
        setFavoriteDragOverIndex(null);
    }, []);

    // Handle classification change - save to localStorage and optionally sync to Google Sheets
    const handleClassificationChange = useCallback(async (rowIds: string[], targetGroup: string) => {
        // Always save to localStorage first
        const newOverrides = { ...classificationOverrides };
        rowIds.forEach(rowId => {
            const parts = rowId.split('||');
            const imageUrl = parts[0] || rowId;
            newOverrides[imageUrl] = targetGroup;
        });
        setClassificationOverrides(newOverrides);

        // If syncToSheet is enabled and sourceUrl exists, sync to Google Sheets
        if (syncToSheet && sourceUrl && effectiveGroupColumns[0]) {
            const primaryGroupColumn = effectiveGroupColumns[0];
            const primaryColIndex = effectiveData.columns.indexOf(primaryGroupColumn);

            if (primaryColIndex >= 0) {
                // Convert column index to letter (A, B, C, ... AA, AB, etc.)
                const colToLetter = (index: number): string => {
                    let letter = '';
                    let num = index;
                    while (num >= 0) {
                        letter = String.fromCharCode((num % 26) + 65) + letter;
                        num = Math.floor(num / 26) - 1;
                    }
                    return letter;
                };
                const columnLetter = colToLetter(primaryColIndex);

                // Extract spreadsheet ID from sourceUrl
                const match = sourceUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
                const spreadsheetId = match ? match[1] : null;

                if (spreadsheetId) {
                    try {
                        // Get access token
                        const token = await getGoogleAccessToken();
                        if (!token) {
                            setCopyFeedback('⚠️ 无法获取访问令牌，已保存到本地');
                            setTimeout(() => setCopyFeedback(null), 3000);
                            return;
                        }

                        // Update each row
                        const updatePromises = rowIds.map(async (rowId) => {
                            const parts = rowId.split('||');
                            const originalIndex = parts.length >= 3 ? parseInt(parts[2], 10) : -1;
                            if (originalIndex >= 0) {
                                const sheetRowIndex = originalIndex + 2; // +1 for header, +1 for 1-based
                                try {
                                    await updateSingleCellInGoogleSheet(
                                        spreadsheetId,
                                        currentSheetName || '',
                                        columnLetter,
                                        sheetRowIndex,
                                        targetGroup,
                                        token
                                    );
                                } catch (err) {
                                    console.error('Failed to update sheet:', err);
                                }
                            }
                        });
                        await Promise.all(updatePromises);
                        setCopyFeedback(`✅ 已将 ${rowIds.length} 张图片移动到 "${targetGroup}"，已同步到表格`);
                    } catch (err) {
                        console.error('Sync to sheet failed:', err);
                        setCopyFeedback(`⚠️ 同步失败，已保存到本地: ${err}`);
                    }
                } else {
                    setCopyFeedback(`✅ 已将 ${rowIds.length} 张图片分类到 "${targetGroup}"`);
                }
            } else {
                setCopyFeedback(`✅ 已将 ${rowIds.length} 张图片分类到 "${targetGroup}"`);
            }
        } else {
            setCopyFeedback(`✅ 已将 ${rowIds.length} 张图片分类到 "${targetGroup}"`);
        }

        setTimeout(() => setCopyFeedback(null), 2000);
        setDraggedItems([]);
        // Keep selection so user can retry if needed
    }, [classificationOverrides, syncToSheet, sourceUrl, effectiveGroupColumns, effectiveData.columns, currentSheetName, setCopyFeedback]);

    // Handle reorder drop - reorder items within a group (supports multi-select)
    const handleReorderDrop = useCallback(async (groupKey: string, draggedImageUrl: string, dropIndex: number, allImageUrlsInGroup: string[]) => {
        // Get current order for this group, or use the default order
        const currentOrder = customOrderByGroup[groupKey] || [...allImageUrlsInGroup];

        // Get all selected items to move (extract imageUrls from rowIds)
        // rowId format is: "imageUrl||sourceSheet||index"
        let itemsToMove: string[] = [];
        if (selectedForClassification.size > 0) {
            // Get image URLs for all selected items by parsing rowId
            selectedForClassification.forEach(rowId => {
                // Extract imageUrl from rowId format: "imageUrl||sourceSheet||index"
                const parts = rowId.split('||');
                const imgUrl = parts[0]; // First part is the imageUrl
                if (imgUrl && allImageUrlsInGroup.includes(imgUrl)) {
                    itemsToMove.push(imgUrl);
                }
            });
        }

        // If no selected items or dragged item not in selection, just move the dragged item
        if (itemsToMove.length === 0 || !itemsToMove.includes(draggedImageUrl)) {
            itemsToMove = [draggedImageUrl];
        }

        // Preserve original order of selected items
        itemsToMove = allImageUrlsInGroup.filter(url => itemsToMove.includes(url));

        // Remove all items to move from current order
        const newOrder = currentOrder.filter(url => !itemsToMove.includes(url));

        // Calculate insert position (adjust for removed items before drop position)
        let insertIndex = dropIndex;
        for (let i = 0; i < dropIndex; i++) {
            if (itemsToMove.includes(currentOrder[i])) {
                insertIndex--;
            }
        }
        insertIndex = Math.max(0, Math.min(insertIndex, newOrder.length));

        // Insert all items at the target position
        newOrder.splice(insertIndex, 0, ...itemsToMove);

        // Save new order to localStorage
        setCustomOrderByGroup(prev => ({
            ...prev,
            [groupKey]: newOrder
        }));

        // Clear reorder state immediately for responsive UI
        setReorderDragItem(null);
        setReorderDropTarget(null);

        // Show feedback
        setCopyFeedback(`✅ 已移动 ${itemsToMove.length} 张图片`);
        setTimeout(() => setCopyFeedback(null), 1500);

        // Sync to Google Sheets if enabled (run in background, don't block UI)
        if (syncToSheet && sourceUrl) {
            const ORDER_COLUMN_NAME = '排序';

            // Check if order column exists
            let orderColIndex = effectiveData.columns.indexOf(ORDER_COLUMN_NAME);

            // Extract spreadsheet ID from sourceUrl
            const match = sourceUrl.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            const spreadsheetId = match ? match[1] : null;

            if (!spreadsheetId) {
                setCopyFeedback('✅ 已调整显示顺序（仅本地）');
                setTimeout(() => setCopyFeedback(null), 1500);
                setReorderDragItem(null);
                setReorderDropTarget(null);
                return;
            }

            try {
                const token = await getGoogleAccessToken();
                if (!token) {
                    setCopyFeedback('⚠️ 无法获取访问令牌，已保存到本地');
                    setTimeout(() => setCopyFeedback(null), 2000);
                    setReorderDragItem(null);
                    setReorderDropTarget(null);
                    return;
                }

                // Convert column index to letter
                const colToLetter = (index: number): string => {
                    let letter = '';
                    let num = index;
                    while (num >= 0) {
                        letter = String.fromCharCode((num % 26) + 65) + letter;
                        num = Math.floor(num / 26) - 1;
                    }
                    return letter;
                };

                // If order column doesn't exist, we need to inform user
                if (orderColIndex === -1) {
                    // Try to find it by checking if it exists
                    orderColIndex = effectiveData.columns.length; // Would be at the end
                    setCopyFeedback(`⚠️ 请在表格中创建"${ORDER_COLUMN_NAME}"列后再试`);
                    setTimeout(() => setCopyFeedback(null), 3000);
                    setReorderDragItem(null);
                    setReorderDropTarget(null);
                    return;
                }

                const orderColumnLetter = colToLetter(orderColIndex);

                // Find all rows in this group and update their order values
                // We need to match images to rows and update the order column
                const updatePromises = newOrder.map(async (imageUrl, orderIdx) => {
                    // Find the row with this image
                    const row = effectiveData.rows.find(r => {
                        const rowImageUrl = extractImageUrl(r[effectiveImageColumn]);
                        return rowImageUrl === imageUrl;
                    });

                    if (row && row._rowId) {
                        // Parse rowId to get original index
                        const rowIdStr = String(row._rowId);
                        const parts = rowIdStr.split('||');
                        const originalIndex = parts.length >= 3 ? parseInt(parts[2], 10) : -1;

                        if (originalIndex >= 0) {
                            const sheetRowIndex = originalIndex + 2; // +1 for header, +1 for 1-based
                            try {
                                await updateSingleCellInGoogleSheet(
                                    spreadsheetId,
                                    currentSheetName || '',
                                    orderColumnLetter,
                                    sheetRowIndex,
                                    String(orderIdx + 1), // 1-based order
                                    token
                                );
                            } catch (err) {
                                console.error('Failed to update order:', err);
                            }
                        }
                    }
                });

                await Promise.all(updatePromises);
                setCopyFeedback(`✅ 已同步到"排序"列`);
            } catch (err) {
                console.error('Sync order failed:', err);
            }
            setTimeout(() => setCopyFeedback(null), 2000);
        }
    }, [customOrderByGroup, syncToSheet, sourceUrl, effectiveData.columns, effectiveData.rows, effectiveImageColumn, currentSheetName, selectedForClassification]);

    // Handle drop to folder (収藏夹)
    const handleDropToFolder = useCallback((e: React.DragEvent, targetFolderId: string) => {
        e.preventDefault();
        e.stopPropagation();

        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));

            if (data.type === 'gallery-thumbnails') {
                // Add gallery images to folder
                const imageUrls: string[] = Array.isArray(data.imageUrls)
                    ? data.imageUrls
                    : (data.imageUrl ? [data.imageUrl] : []);
                const rowDataList: DataRow[] = Array.isArray(data.rowDataList) ? data.rowDataList : [];
                let addedCount = 0;

                if (imageUrls.length === 0) return;

                setFavorites(prev => {
                    const moved = prev.map(f =>
                        imageUrls.includes(f.imageUrl)
                            ? { ...f, folderId: targetFolderId }
                            : f
                    );
                    const existingUrls = new Set(moved.map(f => f.imageUrl));
                    const newItems: FavoriteItem[] = [];

                    imageUrls.forEach((imageUrl, idx) => {
                        if (existingUrls.has(imageUrl)) return;
                        const row = rowDataList[idx] || data.rowData || {};
                        newItems.push({
                            id: `fav-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${idx}`,
                            imageUrl,
                            rowData: row,
                            addedAt: Date.now(),
                            folderId: targetFolderId
                        });
                        existingUrls.add(imageUrl);
                        addedCount++;
                    });

                    return newItems.length > 0 ? [...newItems, ...moved] : moved;
                });

                const folder = favoriteFolders.find(f => f.id === targetFolderId);
                setCopyFeedback(`已添加 ${addedCount > 0 ? addedCount + ' 项到' : '移动到'} ${folder?.emoji || '📁'} ${folder?.name || '收藏夹'}`);
            } else if (data.type === 'favorite-item') {
                // Cross-folder move
                if (data.sourceFolderId !== targetFolderId) {
                    setFavorites(prev => prev.map(f =>
                        f.id === data.favoriteId ? { ...f, folderId: targetFolderId } : f
                    ));
                    const folder = favoriteFolders.find(f => f.id === targetFolderId);
                    setCopyFeedback(`已移动到 ${folder?.emoji || '📁'} ${folder?.name || '收藏夹'}`);
                }
            }
        } catch (err) {
            console.error('Drop to folder failed:', err);
        }

        setTimeout(() => setCopyFeedback(null), 1500);
        setDragOverTarget(null);
        setIsDraggingImage(false);
    }, [favorites, favoriteFolders]);

    // Handle drop to category (媒体标签)
    const handleDropToCategory = useCallback((e: React.DragEvent, categoryName: string) => {
        e.preventDefault();
        e.stopPropagation();

        try {
            const data = JSON.parse(e.dataTransfer.getData('application/json'));

            if (data.type === 'gallery-thumbnails' || data.type === 'favorite-item') {
                const imageUrls: string[] = data.type === 'gallery-thumbnails'
                    ? data.imageUrls
                    : [data.imageUrl];

                imageUrls.forEach(imageUrl => {
                    setGalleryCategories(prev => {
                        const next = new Map(prev);
                        next.set(imageUrl, categoryName);
                        return next;
                    });
                });

                setCopyFeedback(`已设置 ${imageUrls.length} 项的标签为「${categoryName}」`);
            }
        } catch (err) {
            console.error('Drop to category failed:', err);
        }

        setTimeout(() => setCopyFeedback(null), 1500);
        setDragOverTarget(null);
        setIsDraggingImage(false);
    }, []);

    // Reorder favorites within folder
    const reorderFavoritesInFolder = useCallback((
        folderId: string,
        fromIndex: number,
        toIndex: number
    ) => {
        setFavorites(prev => {
            const folderItems = prev.filter(f => (f.folderId || DEFAULT_FOLDER_ID) === folderId);
            const otherItems = prev.filter(f => (f.folderId || DEFAULT_FOLDER_ID) !== folderId);

            if (fromIndex < 0 || fromIndex >= folderItems.length || toIndex < 0 || toIndex >= folderItems.length) {
                return prev;
            }

            // Reorder within folder
            const [movedItem] = folderItems.splice(fromIndex, 1);
            folderItems.splice(toIndex, 0, movedItem);

            // Merge back (keep folder items in order, append others)
            return [...folderItems, ...otherItems];
        });
        setFavoriteDragOverIndex(null);
    }, []);

    // Save folders to localStorage
    React.useEffect(() => {
        localStorage.setItem(FAVORITE_FOLDERS_KEY, JSON.stringify(favoriteFolders));
    }, [favoriteFolders]);

    const toggleFavorite = useCallback((imageUrl: string, row: DataRow) => {
        setFavorites(prev => {
            const exists = prev.find(f => f.imageUrl === imageUrl);
            if (exists) {
                // Remove from favorites
                const newFavs = prev.filter(f => f.imageUrl !== imageUrl);
                setCopyFeedback('已取消收藏');
                setTimeout(() => setCopyFeedback(null), 1500);
                return newFavs;
            } else {
                // Add to default folder
                const newItem: FavoriteItem = {
                    id: `fav-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    imageUrl,
                    rowData: { ...row },
                    addedAt: Date.now(),
                    folderId: DEFAULT_FOLDER_ID
                };
                setCopyFeedback('已添加收藏 ⭐');
                setTimeout(() => setCopyFeedback(null), 1500);
                return [newItem, ...prev];
            }
        });
    }, []);

    // Handle star button click - show folder menu if not favorited, otherwise toggle off
    const handleStarClick = useCallback((e: React.MouseEvent, imageUrl: string, row: DataRow) => {
        e.stopPropagation();

        // Check login status before showing folder menu
        if (!isUserLoggedIn()) {
            setShowLoginPrompt({
                action: '添加收藏',
                onLogin: () => {
                    // After login, show the folder menu
                    const rect = (e.target as HTMLElement).getBoundingClientRect();
                    setShowFolderMenu({
                        x: rect.left,
                        y: rect.bottom + 4,
                        imageUrl,
                        row
                    });
                }
            });
            return;
        }

        if (isFavorited(imageUrl)) {
            // Already favorited - remove it
            toggleFavorite(imageUrl, row);
        } else {
            // Not favorited - show folder selection menu
            const rect = (e.target as HTMLElement).getBoundingClientRect();
            setShowFolderMenu({
                x: rect.left,
                y: rect.bottom + 4,
                imageUrl,
                row
            });
        }
    }, [isFavorited, toggleFavorite]);

    const copyRowDataToClipboard = useCallback(async (rowData: DataRow, imageUrl?: string) => {
        try {
            // Merge effectiveData.columns with any extra keys from rowData to ensure all data is included
            const baseColumns = effectiveData.columns.length > 0 ? [...effectiveData.columns] : [];
            const extraKeys = Object.keys(rowData).filter(k => !baseColumns.includes(k));
            const headers = [...baseColumns, ...extraKeys];
            const values = headers.map(h => String(rowData[h] ?? ''));

            // Add note to A column if available
            let note = '';
            if (imageUrl) {
                note = getNoteForImage(imageUrl);
            } else if (config.imageColumn && rowData[config.imageColumn]) {
                // Try to find image URL from row data
                const imgUrl = extractImageUrl(rowData[config.imageColumn]);
                if (imgUrl) {
                    note = getNoteForImage(imgUrl);
                }
            }

            if (note) {
                const noteIndex = headers.findIndex(h => h === NOTE_HEADER);
                if (noteIndex >= 0) {
                    values[noteIndex] = note;
                } else {
                    headers.unshift(NOTE_HEADER);
                    values.unshift(note);
                }
            }

            const text = headers.join('\t') + '\n' + values.join('\t');
            await navigator.clipboard.writeText(text);
            setCopyFeedback(note ? '已复制行数据(含备注)' : '已复制行数据');
            setTimeout(() => setCopyFeedback(null), 1500);
        } catch {
            setCopyFeedback('复制失败');
            setTimeout(() => setCopyFeedback(null), 1500);
        }
    }, [getNoteForImage, config.imageColumn, effectiveData.columns]);

    const clearAllFavorites = useCallback(() => {
        setConfirmDialog({
            isOpen: true,
            title: '清空收藏',
            message: `确定要清空所有收藏吗？(${favorites.length} 项)`,
            type: 'danger',
            confirmText: '确定清空',
            cancelText: '取消',
            onConfirm: () => {
                setFavorites([]);
                setSelectedFavorites(new Set());
                setCopyFeedback('已清空收藏');
                setTimeout(() => setCopyFeedback(null), 1500);
                setConfirmDialog(null);
            }
        });
    }, [favorites.length]);

    const clearFavoritesInFolder = useCallback((folderId: string) => {
        const folder = favoriteFolders.find(f => f.id === folderId);
        const folderName = folder ? `${folder.emoji || '📁'} ${folder.name}` : '收藏夹';
        const count = getFavoritesInFolder(folderId).length;

        if (count === 0) {
            setCopyFeedback('该收藏夹暂无内容');
            setTimeout(() => setCopyFeedback(null), 1500);
            return;
        }

        setConfirmDialog({
            isOpen: true,
            title: '清空收藏夹',
            message: `确定要清空 ${folderName} 吗？(${count} 项)`,
            type: 'danger',
            confirmText: '确定清空',
            cancelText: '取消',
            onConfirm: () => {
                setFavorites(prev => {
                    const remaining = prev.filter(f => (f.folderId || DEFAULT_FOLDER_ID) !== folderId);
                    const remainingIds = new Set(remaining.map(f => f.id));
                    setSelectedFavorites(sel => {
                        const next = new Set<string>();
                        sel.forEach(id => {
                            if (remainingIds.has(id)) next.add(id);
                        });
                        return next;
                    });
                    return remaining;
                });
                setCopyFeedback(`已清空 ${folderName}`);
                setTimeout(() => setCopyFeedback(null), 1500);
                setConfirmDialog(null);
            }
        });
    }, [favoriteFolders, getFavoritesInFolder]);

    const clearCategoryItems = useCallback((category: string) => {
        const imageUrls = Array.from(galleryCategories.entries())
            .filter(([, cat]) => cat === category)
            .map(([url]) => url);

        if (imageUrls.length === 0) {
            setCopyFeedback('该标签暂无内容');
            setTimeout(() => setCopyFeedback(null), 1500);
            return;
        }

        setConfirmDialog({
            isOpen: true,
            title: '清空媒体标签',
            message: `确定要清空「${category}」吗？(${imageUrls.length} 项)`,
            type: 'danger',
            confirmText: '确定清空',
            cancelText: '取消',
            onConfirm: () => {
                setGalleryCategories(prev => {
                    const next = new Map(prev);
                    imageUrls.forEach(url => next.delete(url));
                    return next;
                });
                setCopyFeedback(`已清空标签：${category}`);
                setTimeout(() => setCopyFeedback(null), 1500);
                setConfirmDialog(null);
            }
        });
    }, [galleryCategories]);

    // Favorite selection functions
    const selectAllFavorites = useCallback(() => {
        setSelectedFavorites(new Set(favorites.map(f => f.id)));
    }, [favorites]);

    const deselectAllFavorites = useCallback(() => {
        setSelectedFavorites(new Set());
    }, []);

    const invertFavoriteSelection = useCallback(() => {
        setSelectedFavorites(prev => {
            const newSet = new Set<string>();
            favorites.forEach(f => {
                if (!prev.has(f.id)) newSet.add(f.id);
            });
            return newSet;
        });
    }, [favorites]);

    const toggleFavoriteSelection = useCallback((id: string) => {
        setSelectedFavorites(prev => {
            const newSet = new Set(prev);
            if (newSet.has(id)) {
                newSet.delete(id);
            } else {
                newSet.add(id);
            }
            return newSet;
        });
    }, []);

    const copySelectedFavoritesData = useCallback(async () => {
        const selectedItems = favorites.filter(f => selectedFavorites.has(f.id));
        if (selectedItems.length === 0) {
            setCopyFeedback('请先选择要复制的收藏');
            setTimeout(() => setCopyFeedback(null), 1500);
            return;
        }

        try {
            // Merge effectiveData.columns with any extra keys from rowData to ensure all data is included
            const baseColumns = effectiveData.columns.length > 0 ? effectiveData.columns : [];
            const extraKeys = new Set<string>();
            selectedItems.forEach(item => {
                Object.keys(item.rowData).forEach(k => {
                    if (!baseColumns.includes(k)) extraKeys.add(k);
                });
            });
            const headers = [...baseColumns, ...Array.from(extraKeys)];

            const rows = selectedItems.map(item =>
                headers.map(h => String(item.rowData[h] ?? '')).join('\t')
            );
            const text = headers.join('\t') + '\n' + rows.join('\n');
            await navigator.clipboard.writeText(text);
            setCopyFeedback(`已复制 ${selectedItems.length} 条数据`);
            setTimeout(() => setCopyFeedback(null), 1500);
        } catch {
            setCopyFeedback('复制失败');
            setTimeout(() => setCopyFeedback(null), 1500);
        }
    }, [favorites, selectedFavorites, effectiveData.columns]);

    const copyAllFavoritesData = useCallback(async () => {
        if (favorites.length === 0) {
            setCopyFeedback('暂无收藏');
            setTimeout(() => setCopyFeedback(null), 1500);
            return;
        }

        try {
            // Merge effectiveData.columns with any extra keys from rowData to ensure all data is included
            const baseColumns = effectiveData.columns.length > 0 ? effectiveData.columns : [];
            const extraKeys = new Set<string>();
            favorites.forEach(item => {
                Object.keys(item.rowData).forEach(k => {
                    if (!baseColumns.includes(k)) extraKeys.add(k);
                });
            });
            const headers = [...baseColumns, ...Array.from(extraKeys)];

            const rows = favorites.map(item =>
                headers.map(h => String(item.rowData[h] ?? '')).join('\t')
            );
            const text = headers.join('\t') + '\n' + rows.join('\n');
            await navigator.clipboard.writeText(text);
            setCopyFeedback(`已复制全部 ${favorites.length} 条数据`);
            setTimeout(() => setCopyFeedback(null), 1500);
        } catch {
            setCopyFeedback('复制失败');
            setTimeout(() => setCopyFeedback(null), 1500);
        }
    }, [favorites, effectiveData.columns]);

    // Gallery thumbnail selection functions
    const toggleThumbnailSelection = useCallback((imageUrl: string) => {
        setSelectedThumbnails(prev => {
            const newSet = new Set(prev);
            if (newSet.has(imageUrl)) {
                newSet.delete(imageUrl);
            } else {
                newSet.add(imageUrl);
            }
            return newSet;
        });
    }, []);

    const thumbnailClickTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);
    const thumbnailClickRowRef = React.useRef<string | null>(null);

    const cancelPendingThumbnailSelect = useCallback((rowId?: string) => {
        if (thumbnailClickTimerRef.current && (!rowId || thumbnailClickRowRef.current === rowId)) {
            clearTimeout(thumbnailClickTimerRef.current);
            thumbnailClickTimerRef.current = null;
            thumbnailClickRowRef.current = null;
        }
    }, []);

    const scheduleThumbnailSelect = useCallback((rowId: string) => {
        if (!gallerySelectMode) return;
        if (thumbnailClickTimerRef.current) {
            clearTimeout(thumbnailClickTimerRef.current);
        }
        thumbnailClickRowRef.current = rowId;
        thumbnailClickTimerRef.current = setTimeout(() => {
            toggleThumbnailSelection(rowId);
            thumbnailClickTimerRef.current = null;
            thumbnailClickRowRef.current = null;
        }, 200);
    }, [gallerySelectMode, toggleThumbnailSelection]);

    const handleThumbnailDoubleClick = useCallback((e: React.MouseEvent, rowId: string, linkUrl: string) => {
        e.stopPropagation();
        cancelPendingThumbnailSelect(rowId);
        if (!effectiveLinkColumn) {
            setFloatingTip({ text: '⚠️ 请先指定链接列', x: e.clientX, y: e.clientY });
            setTimeout(() => setFloatingTip(null), 2000);
            return;
        }
        if (linkUrl) {
            openExternalUrl(linkUrl);
        }
    }, [cancelPendingThumbnailSelect, effectiveLinkColumn, setFloatingTip]);

    const clearThumbnailSelection = useCallback(() => {
        setSelectedThumbnails(new Set());
        setGallerySelectMode(false);
    }, []);

    const addSelectedToFavorites = useCallback((rows: DataRow[], targetFolderId?: string) => {
        const selectedRows = rows.filter(row => {
            const rowId = String(row._rowId || '');
            return rowId && selectedThumbnails.has(rowId);
        });

        if (selectedRows.length === 0) {
            setCopyFeedback('请先选择图片');
            setTimeout(() => setCopyFeedback(null), 1500);
            return;
        }

        const folderId = targetFolderId || DEFAULT_FOLDER_ID;
        const folder = favoriteFolders.find(f => f.id === folderId);

        let addedCount = 0;
        setFavorites(prev => {
            const existingUrls = new Set(prev.map(f => f.imageUrl));
            const newFavs = [...prev];

            selectedRows.forEach(row => {
                const url = extractImageUrl(row[config.imageColumn]);
                if (url && !existingUrls.has(url)) {
                    // Remove _rowId from stored data to avoid confusion
                    const { _rowId, ...cleanRow } = row;
                    newFavs.unshift({
                        id: `fav-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        imageUrl: url,
                        rowData: { ...cleanRow },
                        addedAt: Date.now(),
                        folderId: folderId
                    });
                    existingUrls.add(url); // Prevent duplicates within same batch
                    addedCount++;
                }
            });

            return newFavs;
        });

        setCopyFeedback(`已添加 ${addedCount} 项到 ${folder?.emoji || '⭐'} ${folder?.name || '默认收藏夹'}`);
        setTimeout(() => setCopyFeedback(null), 1500);
        // Don't auto-clear selection - let user manually clear
    }, [config.imageColumn, selectedThumbnails, favoriteFolders]);

    const copySelectedThumbnailsData = useCallback(async (rows: DataRow[]) => {
        const selectedRows = rows.filter(row => {
            const rowId = String(row._rowId || '');
            return rowId && selectedThumbnails.has(rowId);
        });

        if (selectedRows.length === 0) {
            setCopyFeedback('请先选择图片');
            setTimeout(() => setCopyFeedback(null), 1500);
            return;
        }

        try {
            // Exclude internal _rowId column from export
            const headers = Object.keys(selectedRows[0]).filter(h => h !== '_rowId');
            const rowsData = selectedRows.map(row =>
                headers.map(h => String(row[h] || '')).join('\t')
            );
            const text = headers.join('\t') + '\n' + rowsData.join('\n');
            await navigator.clipboard.writeText(text);
            setCopyFeedback(`已复制 ${selectedRows.length} 行数据`);
            setTimeout(() => setCopyFeedback(null), 1500);
        } catch {
            setCopyFeedback('复制失败');
            setTimeout(() => setCopyFeedback(null), 1500);
        }
    }, [config.imageColumn, selectedThumbnails]);

    // Copy entire table data to clipboard
    const copyAllDataToClipboard = useCallback(async () => {
        if (!effectiveData.rows || effectiveData.rows.length === 0) {
            setCopyFeedback('没有数据可复制');
            setTimeout(() => setCopyFeedback(null), 1500);
            return;
        }

        try {
            const headers = effectiveData.columns ? [...effectiveData.columns] : Object.keys(effectiveData.rows[0]);
            let noteIndex = headers.findIndex(h => h === NOTE_HEADER);
            if (noteIndex === -1) {
                headers.unshift(NOTE_HEADER);
                noteIndex = 0;
            }

            // Build rows with notes
            const rowsData = effectiveData.rows.map(row => {
                const values = headers.map((h, idx) => {
                    if (idx === noteIndex) {
                        // Note column (A) - add note if available
                        const imageUrl = config.imageColumn ? extractImageUrl(row[config.imageColumn]) : null;
                        if (imageUrl) {
                            return getNoteForImage(imageUrl) || String(row[h] || '');
                        }
                    }
                    return String(row[h] || '');
                });
                return values.join('\t');
            });

            const text = headers.join('\t') + '\n' + rowsData.join('\n');
            await navigator.clipboard.writeText(text);
            setCopyFeedback(`✓ 已复制整表 (${effectiveData.rows.length} 行，含备注)`);
            setTimeout(() => setCopyFeedback(null), 2000);
        } catch {
            setCopyFeedback('复制失败');
            setTimeout(() => setCopyFeedback(null), 1500);
        }
    }, [effectiveData.rows, effectiveData.columns, config.imageColumn, getNoteForImage]);

    // State for batch sync
    const [isBatchSyncing, setIsBatchSyncing] = useState(false);

    // Batch sync all notes to Google Sheets A column
    const syncAllNotesToSheet = useCallback(async () => {
        if (!sourceUrl || !currentSheetName) {
            setCopyFeedback('⚠️ 未连接 Google 表格');
            setTimeout(() => setCopyFeedback(null), 2000);
            return;
        }

        const accessToken = getGoogleAccessToken();
        if (!accessToken) {
            setCopyFeedback('⚠️ 请先登录 Google 账号');
            setTimeout(() => setCopyFeedback(null), 2000);
            return;
        }

        // Get all notes that need to be synced
        const notesToSync = Array.from(galleryNotes.values()).filter(note =>
            note.note && note.rowIndex > 0
        );

        if (notesToSync.length === 0) {
            setCopyFeedback('没有备注需要同步');
            setTimeout(() => setCopyFeedback(null), 1500);
            return;
        }

        setIsBatchSyncing(true);
        setCopyFeedback(`⏳ 正在同步 ${notesToSync.length} 条备注...`);

        try {
            const parsed = parseGoogleSheetsUrl(sourceUrl);
            if (!parsed?.spreadsheetId) {
                throw new Error('无法解析表格 ID');
            }

            let successCount = 0;
            let failCount = 0;

            await ensureNotesAndCategoriesColumns(
                parsed.spreadsheetId,
                currentSheetName,
                accessToken
            );

            // Sync notes one by one (to avoid rate limits)
            for (const note of notesToSync) {
                try {
                    await updateSingleCellInGoogleSheet(
                        parsed.spreadsheetId,
                        currentSheetName,
                        NOTE_COLUMN,
                        note.rowIndex,
                        note.note,
                        accessToken
                    );
                    successCount++;
                    setCopyFeedback(`⏳ 同步中... (${successCount}/${notesToSync.length})`);
                } catch (err) {
                    console.error(`[Notes] Failed to sync row ${note.rowIndex}:`, err);
                    failCount++;
                }
            }

            if (failCount === 0) {
                setCopyFeedback(`✅ 已同步 ${successCount} 条备注到 ${NOTE_COLUMN} 列`);
            } else {
                setCopyFeedback(`⚠️ 同步完成: ${successCount} 成功, ${failCount} 失败`);
            }
            setTimeout(() => setCopyFeedback(null), 3000);
        } catch (err) {
            console.error('[Notes] Batch sync failed:', err);
            setCopyFeedback('❌ 同步失败: ' + (err instanceof Error ? err.message : '未知错误'));
            setTimeout(() => setCopyFeedback(null), 3000);
        } finally {
            setIsBatchSyncing(false);
        }
    }, [sourceUrl, currentSheetName, galleryNotes]);

    // When auto-sync toggle is turned ON, sync all existing notes
    React.useEffect(() => {
        if (autoSyncNotesToSheet && galleryNotes.size > 0 && !isBatchSyncing) {
            syncAllNotesToSheet();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoSyncNotesToSheet]); // Only trigger when toggle changes

    // State for batch category sync
    const [isBatchCategorySyncing, setIsBatchCategorySyncing] = useState(false);

    // Batch sync all categories to Google Sheets B column
    const syncAllCategoriesToSheet = useCallback(async () => {
        if (!sourceUrl || !currentSheetName) {
            setCopyFeedback('⚠️ 未连接 Google 表格');
            setTimeout(() => setCopyFeedback(null), 2000);
            return;
        }

        const accessToken = getGoogleAccessToken();
        if (!accessToken) {
            setCopyFeedback('⚠️ 请先登录 Google 账号');
            setTimeout(() => setCopyFeedback(null), 2000);
            return;
        }

        // Build a map of imageUrl -> rowIndex from the data
        const imageUrlToRowIndex = new Map<string, number>();
        effectiveData.rows.forEach((row, idx) => {
            const imageUrl = extractImageUrl(row[config.imageColumn]);
            if (imageUrl) {
                imageUrlToRowIndex.set(imageUrl, idx + 2); // +2 because idx is 0-indexed and row 1 is header
            }
        });

        // Get all categories that have a corresponding row
        const categoriesToSync: { imageUrl: string; category: string; rowIndex: number }[] = [];
        galleryCategories.forEach((category, imageUrl) => {
            const rowIndex = imageUrlToRowIndex.get(imageUrl);
            if (category && rowIndex) {
                categoriesToSync.push({ imageUrl, category, rowIndex });
            }
        });

        if (categoriesToSync.length === 0) {
            if (galleryCategories.size === 0) {
                setCopyFeedback('⚠️ 请先为图片设置分类（点击图片左侧的标签图标）');
            } else {
                setCopyFeedback('⚠️ 没有分类匹配到当前表格的图片');
            }
            setTimeout(() => setCopyFeedback(null), 3000);
            return;
        }

        setIsBatchCategorySyncing(true);
        setCopyFeedback(`⏳ 正在同步 ${categoriesToSync.length} 条分类...`);

        try {
            const parsed = parseGoogleSheetsUrl(sourceUrl);
            if (!parsed?.spreadsheetId) {
                throw new Error('无法解析表格 ID');
            }

            let successCount = 0;
            let failCount = 0;

            await ensureNotesAndCategoriesColumns(
                parsed.spreadsheetId,
                currentSheetName,
                accessToken
            );

            // Sync categories one by one (to avoid rate limits)
            for (const item of categoriesToSync) {
                try {
                    await updateSingleCellInGoogleSheet(
                        parsed.spreadsheetId,
                        currentSheetName,
                        CATEGORY_COLUMN, // Fixed column B for categories
                        item.rowIndex,
                        item.category,
                        accessToken
                    );
                    successCount++;
                    setCopyFeedback(`⏳ 同步中... (${successCount}/${categoriesToSync.length})`);
                } catch (err) {
                    console.error(`[Categories] Failed to sync row ${item.rowIndex}:`, err);
                    failCount++;
                }
            }

            if (failCount === 0) {
                setCopyFeedback(`✅ 已同步 ${successCount} 条分类到 ${CATEGORY_COLUMN} 列`);
            } else {
                setCopyFeedback(`⚠️ 同步完成: ${successCount} 成功, ${failCount} 失败`);
            }
            setTimeout(() => setCopyFeedback(null), 3000);
        } catch (err) {
            console.error('[Categories] Batch sync failed:', err);
            setCopyFeedback('❌ 同步失败: ' + (err instanceof Error ? err.message : '未知错误'));
            setTimeout(() => setCopyFeedback(null), 3000);
        } finally {
            setIsBatchCategorySyncing(false);
        }
    }, [sourceUrl, currentSheetName, galleryCategories, effectiveData.rows, config.imageColumn]);

    // When auto-sync toggle is turned ON, sync all existing categories
    React.useEffect(() => {
        if (autoSyncCategoriesToSheet && galleryCategories.size > 0 && !isBatchCategorySyncing) {
            syncAllCategoriesToSheet();
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [autoSyncCategoriesToSheet]); // Only trigger when toggle changes

    // Hover handlers with delay
    const handleThumbnailMouseEnter = useCallback((imageUrl: string, e: React.MouseEvent) => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        hoverTimerRef.current = setTimeout(() => {
            setHoveredImage(imageUrl);
            setHoverPosition({ x: e.clientX, y: e.clientY });
            setThumbnailRect(rect);
        }, 200); // 200ms delay
    }, []);

    const handleThumbnailMouseLeave = useCallback(() => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        setHoveredImage(null);
        setHoverPosition(null);
        setThumbnailRect(null);
    }, []);

    const sortRowsByRules = useCallback((rows: DataRow[]) => {
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

        // Uses effectiveSortRules defined above
        if (effectiveSortRules.length === 0) return [...rows];

        const sorted = [...rows];
        // Single sort with a comparator that checks all rules in priority order
        sorted.sort((a, b) => {
            for (const rule of effectiveSortRules) {
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
    }, [effectiveSortRules]);

    const sortDateKeys = useCallback((keys: string[]) => {
        const rule = effectiveSortRules.find(r => r.column === effectiveDateColumn);
        const descending = rule ? rule.descending : true;
        return [...keys].sort((a, b) => descending ? b.localeCompare(a, undefined, { numeric: true }) : a.localeCompare(b, undefined, { numeric: true }));
    }, [effectiveSortRules, effectiveDateColumn]);

    // Processed rows with filtering and sorting
    const processedRows = useMemo(() => {
        // Use effectiveData which handles transpose if needed
        let rows = [...effectiveData.rows].map((row, originalIndex) => ({
            ...row,
            // Include originalIndex to ensure unique keys even for duplicate images
            _rowId: `${extractImageUrl(row[effectiveImageColumn]) || ''}||${row._sourceSheet || ''}||${originalIndex}`
        }));

        // Global keyword search - search across all text columns
        if (config.searchKeyword && config.searchKeyword.trim()) {
            const keywords = config.searchKeyword.toLowerCase().trim().split(/\s+/);
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
        if (effectiveDateColumn && (effectiveDateStart || effectiveDateEnd)) {
            const startDate = effectiveDateStart ? new Date(effectiveDateStart) : null;
            const endDate = effectiveDateEnd ? new Date(effectiveDateEnd) : null;

            rows = rows.filter(row => {
                const date = parseDate(row[effectiveDateColumn]);
                if (!date) return true;
                if (startDate && date < startDate) return false;
                if (endDate && date > endDate) return false;
                return true;
            });
        }

        // Custom filters - uses effectiveCustomFilters defined above
        for (const cf of effectiveCustomFilters) {
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

        // Number filters - uses effectiveNumFilters defined above
        for (const nf of effectiveNumFilters) {
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

        return sortRowsByRules(rows);
    }, [effectiveData.rows, config.searchKeyword, effectiveImageColumn, sortRowsByRules, effectiveDateColumn, effectiveDateStart, effectiveDateEnd, effectiveCustomFilters, effectiveNumFilters]);

    const rowById = useMemo(() => {
        return new Map(processedRows.map(row => [String(row._rowId || ''), row]));
    }, [processedRows]);

    useEffect(() => {
        setGalleryPage(1);
        setGroupPages({});
        setGroupLoadedCount({});
    }, [config.searchKeyword, effectiveDateStart, effectiveDateEnd, effectiveCustomFilters, effectiveNumFilters]);

    useEffect(() => {
        if (config.viewMode !== 'gallery' || !effectiveImageColumn || effectiveGroupColumn) return;
        const pageSize = config.galleryPageSize || 0;
        if (!pageSize) return;
        const allRows = sortRowsByRules(processedRows).filter(row => extractImageUrl(row[effectiveImageColumn]));
        const totalPages = Math.max(1, Math.ceil(allRows.length / pageSize));
        if (galleryPage > totalPages) {
            setGalleryPage(totalPages);
        } else if (galleryPage < 1) {
            setGalleryPage(1);
        }
    }, [
        config.viewMode,
        effectiveImageColumn,
        effectiveGroupColumn,
        config.galleryPageSize,
        processedRows,
        sortRowsByRules,
        galleryPage
    ]);

    useLayoutEffect(() => {
        const el = contentScrollRef.current;
        if (!el || scrollRestoreRef.current === null) return;
        const maxScrollTop = Math.max(0, el.scrollHeight - el.clientHeight);
        el.scrollTop = Math.min(scrollRestoreRef.current, maxScrollTop);
        scrollRestoreRef.current = null;
    }, [processedRows, config.viewMode]);

    // Generate export data based on current view mode
    const generateExportData = useCallback((): { headers: string[]; rows: string[][] } => {
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
            const headers = [config.matrixRowColumn, config.matrixColColumn, ...effectiveData.columns.filter(c => c !== config.matrixRowColumn && c !== config.matrixColColumn)];
            const dataRows: string[][] = [];

            for (const row of processedRows) {
                const rowKey = String(row[config.matrixRowColumn] || '');
                const colKey = String(row[config.matrixColColumn] || '');
                if (!rowKey || !colKey) continue;

                const rowData = [rowKey, colKey];
                for (const col of effectiveData.columns) {
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

            const sortedDates = sortDateKeys([...groups.keys()]);

            // Headers: Date + all columns
            const headers = ['日期', ...effectiveData.columns];

            // Each row with date prefix, image column as IMAGE formula
            const dataRows: string[][] = [];
            for (const date of sortedDates) {
                const groupRows = sortRowsByRules(groups.get(date)!);
                for (const row of groupRows) {
                    const rowData = [date];
                    for (const col of effectiveData.columns) {
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
                ? ['日期', config.groupColumn, ...effectiveData.columns.filter(c => c !== config.groupColumn)]
                : ['日期', ...effectiveData.columns];

            const dataRows: string[][] = [];
            for (const row of processedRows) {
                const dateVal = row[config.dateColumn];
                const dateKey = dateVal ? String(dateVal).slice(0, 10) : '';

                const rowData: string[] = [dateKey];
                if (config.groupColumn) {
                    rowData.push(String(row[config.groupColumn] || ''));
                }

                for (const col of effectiveData.columns) {
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
            const headers = effectiveData.columns;
            const dataRows = processedRows.map(row =>
                effectiveData.columns.map(col => {
                    const val = row[col];
                    if (col === config.imageColumn) {
                        return toImageFormula(val);
                    }
                    return String(val || '');
                })
            );
            return { headers, rows: dataRows };
        }
    }, [config.viewMode, config.matrixRowColumn, config.matrixColColumn, config.dateColumn, config.imageColumn, config.groupColumn, processedRows, effectiveData.columns, sortDateKeys, sortRowsByRules]);

    // Copy data to clipboard based on current view
    const copyDataToClipboard = useCallback(() => {
        const { headers, rows } = generateExportData();
        const text = headers.join('\t') + '\n' + rows.map(r => r.join('\t')).join('\n');
        navigator.clipboard.writeText(text).then(() => {
            alert(`已复制 ${rows.length} 行数据到剪贴板 (${config.viewMode}视图)`);
        });
    }, [generateExportData, config.viewMode]);

    // Update ref for use in UI
    React.useEffect(() => {
        copyDataToClipboardRef.current = copyDataToClipboard;
    }, [copyDataToClipboard]);

    // Copy view layout to clipboard (grouped thumbnails in grid format)
    const copyViewLayoutToClipboard = useCallback((columnsPerRow: number, includeExtraData: boolean, selectedColumns: string[], applyOverrides: boolean) => {
        const primaryGroupColumn = effectiveGroupColumns[0];

        if (!effectiveImageColumn) {
            setCopyFeedback('❌ 请先配置图片列');
            setTimeout(() => setCopyFeedback(null), 2000);
            setCopyViewModal({ ...copyViewModal, open: false });
            return;
        }

        // Group rows by the primary group column (considering classification overrides)
        const groups = new Map<string, DataRow[]>();
        processedRows.forEach(row => {
            const imageUrl = extractImageUrl(row[effectiveImageColumn]);
            let groupKey: string;

            // Apply classification overrides if enabled
            if (applyOverrides && imageUrl && classificationOverrides[imageUrl]) {
                groupKey = classificationOverrides[imageUrl];
            } else {
                groupKey = primaryGroupColumn
                    ? String(row[primaryGroupColumn] || '未分组')
                    : '全部图片';
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

        // Calculate how many extra rows are needed per image
        const extraRowCount = includeExtraData ? selectedColumns.length : 0;

        // Build the output rows
        const outputRows: string[][] = [];

        orderedGroups.forEach(([groupKey, rows]) => {
            // Add group header row (group name with note if exists)
            const note = config.groupNotes?.[groupKey] || '';
            const headerText = note ? `${groupKey} — ${note}` : groupKey;
            outputRows.push([headerText]);

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

            // Arrange images in rows of columnsPerRow
            for (let i = 0; i < rowsWithImages.length; i += columnsPerRow) {
                const chunk = rowsWithImages.slice(i, i + columnsPerRow);

                if (includeExtraData && selectedColumns.length > 0) {
                    // Add column name labels in first column, then data
                    selectedColumns.forEach(colName => {
                        const dataRow = [colName]; // First cell is column name
                        chunk.forEach(item => {
                            dataRow.push(item.extraData[colName] || '');
                        });
                        // Pad with empty cells if needed
                        while (dataRow.length < columnsPerRow + 1) {
                            dataRow.push('');
                        }
                        outputRows.push(dataRow);
                    });

                    // Add image row with label
                    const imageRow = ['缩略图'];
                    chunk.forEach(item => {
                        imageRow.push(item.formula);
                    });
                    while (imageRow.length < columnsPerRow + 1) {
                        imageRow.push('');
                    }
                    outputRows.push(imageRow);

                    // Add empty separator row
                    outputRows.push([]);
                } else {
                    // Original behavior - just images
                    const rowImages = chunk.map(item => item.formula);
                    while (rowImages.length < columnsPerRow) {
                        rowImages.push('');
                    }
                    outputRows.push(rowImages);
                }
            }

            // Add empty row between groups
            outputRows.push([]);
        });

        // Convert to TSV format
        const text = outputRows.map(row => row.join('\t')).join('\n');

        navigator.clipboard.writeText(text).then(() => {
            const groupCount = orderedGroups.length;
            const totalImages = orderedGroups.reduce((sum, [, rows]) => sum + rows.length, 0);
            const extraInfo = includeExtraData && selectedColumns.length > 0
                ? ` · ${selectedColumns.length} 列`
                : '';
            const overrideInfo = applyOverrides && Object.keys(classificationOverrides).length > 0
                ? ` · ${Object.keys(classificationOverrides).length} 项覆盖`
                : '';
            setCopyFeedback(`✅ 已复制！${groupCount} 个分组 · ${totalImages} 张图片 · 每行 ${columnsPerRow} 个${extraInfo}${overrideInfo}`);
            setTimeout(() => setCopyFeedback(null), 3000);
            setCopyViewModal({ ...copyViewModal, open: false });
        }).catch(err => {
            console.error('Failed to copy:', err);
            setCopyFeedback('❌ 复制失败，请重试');
            setTimeout(() => setCopyFeedback(null), 2000);
        });
    }, [processedRows, effectiveGroupColumns, effectiveImageColumn, config.groupNotes, extractImageUrl, classificationOverrides, customOrderByGroup, copyViewModal]);

    // Sync to Google Sheets based on current view
    const syncToGoogleSheet = useCallback(async () => {
        if (!sheetsSpreadsheetId || processedRows.length === 0) return;

        try {
            const { getGoogleAccessToken } = await import('@/services/authService');
            const { createSheetTab, writeToGoogleSheet } = await import('../services/firebaseService');

            const token = getGoogleAccessToken();
            if (!token) {
                setSheetsError('需要重新登录 Google 账号获取写入权限');
                return;
            }

            setSheetsSyncing(true);
            setSheetsError(null);

            // Generate data based on current view
            const { headers, rows } = generateExportData();
            const sheetData: (string | number | null)[][] = [headers, ...rows];

            // Create new sheet tab with timestamp and view mode
            const viewLabel = config.viewMode === 'matrix' ? '矩阵' : config.viewMode === 'timeline' ? '时间轴' : '画廊';
            const sheetName = `${viewLabel}_${new Date().toLocaleString('zh-CN', {
                month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
            }).replace(/[/:]/g, '-')}`;

            await createSheetTab(sheetsSpreadsheetId, sheetName, token);
            await writeToGoogleSheet(sheetsSpreadsheetId, sheetName, sheetData, token);

            alert(`同步成功！已创建分页: ${sheetName}`);
        } catch (e: any) {
            console.error('Failed to sync to Google Sheets:', e);
            setSheetsError(e.message || '同步失败');
        } finally {
            setSheetsSyncing(false);
        }
    }, [sheetsSpreadsheetId, processedRows, generateExportData, config.viewMode]);

    // Update ref for sync function
    React.useEffect(() => {
        syncToGoogleSheetRef.current = syncToGoogleSheet;
    }, [syncToGoogleSheet]);

    // Timeline data (grouped by date)
    const timelineData = useMemo(() => {
        if (!effectiveDateColumn || !effectiveImageColumn) {
            return new Map<string, { rows: DataRow[]; accounts: Set<string>; date: Date | null }>();
        }

        const byDate = new Map<string, { rows: DataRow[]; accounts: Set<string>; date: Date | null }>();

        // Helper to get date bin key
        const getDateBinKey = (date: Date | null): string => {
            if (!date) return '无效日期';

            if (effectiveDateBinning && effectiveDateBins.length > 0) {
                const dateTime = date.getTime();

                for (const bin of effectiveDateBins) {
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
            const dateVal = row[effectiveDateColumn];
            const date = parseDate(dateVal);
            const dateKey = date ? getDateBinKey(date) : formatDateValue(dateVal);

            if (!byDate.has(dateKey)) {
                byDate.set(dateKey, { rows: [], accounts: new Set(), date });
            }

            const group = byDate.get(dateKey)!;
            group.rows.push(row);

            if (effectiveAccountColumn) {
                const account = String(row[effectiveAccountColumn] || '');
                if (account) group.accounts.add(account);
            }
        }

        for (const group of byDate.values()) {
            group.rows = sortRowsByRules(group.rows);
        }

        // Sort by bin order if date binning is enabled, otherwise by date
        if (effectiveDateBinning && effectiveDateBins.length > 0) {
            // Generate labels from dates for sorting
            const binOrder = effectiveDateBins.map(b => {
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
        for (const key of sortDateKeys([...byDate.keys()])) {
            ordered.set(key, byDate.get(key)!);
        }
        return ordered;
    }, [processedRows, effectiveDateColumn, effectiveImageColumn, effectiveAccountColumn, effectiveDateBinning, effectiveDateBins, sortDateKeys, sortRowsByRules]);

    // Grouped Timeline data - when groupColumn is set, use it as primary grouping with date as secondary
    // 修复：使用 effectiveGroupLevels 时也需要支持分组显示（来自 TreeGroupConfigModal 的多级分组）
    const primaryGroupColumn = effectiveGroupColumn || (effectiveGroupLevels.length > 0 ? effectiveGroupLevels[0].column : '');
    const groupedTimelineData = useMemo(() => {
        if (!primaryGroupColumn || !effectiveDateColumn || !effectiveImageColumn) {
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
        if (effectiveTextGrouping && effectiveTextGroupBins.length > 0) {
            effectiveTextGroupBins.forEach((g, idx) => textGroupOrder.set(g.label, idx));
            textGroupOrder.set('未分组', effectiveTextGroupBins.length); // Put "未分组" at end
        }

        for (const row of processedRows) {
            // When using textGrouping, use getRowGroupKey to get the mapped label
            let key: string;
            let sortKey: number | undefined;
            let label: string;
            let type: 'numbered' | 'date' | 'text' | 'number' = 'text';

            if (effectiveTextGrouping && effectiveTextGroupBins.length > 0) {
                // Inline text grouping logic (same as getRowGroupKey)
                const cellValue = String(row[primaryGroupColumn] || '').trim();
                const cellValueLower = cellValue.toLowerCase();
                const cellNumValue = parseFloat(cellValue.replace(/[^\d.-]/g, ''));

                let matchedLabel = '未分组';
                for (const group of effectiveTextGroupBins) {
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
            } else if (effectiveGroupLevels.length > 0) {
                // 多级分组：内联处理第一层级的分组逻辑
                const firstLevel = effectiveGroupLevels[0];
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
        const groupSortRule = effectiveSortRules.find(r => r.column === primaryGroupColumn);

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

            if (effectiveDateBinning && effectiveDateBins.length > 0) {
                const dateTime = date.getTime();
                for (const bin of effectiveDateBins) {
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
                const dateVal = row[effectiveDateColumn];
                const date = parseDate(dateVal);
                const dateKey = getSecondaryDateKey(date, dateVal);

                if (!dateGroups.has(dateKey)) {
                    dateGroups.set(dateKey, { rows: [], date });
                }
                dateGroups.get(dateKey)!.rows.push(row);
            }

            // Sort each date group's rows
            for (const dg of dateGroups.values()) {
                dg.rows = sortRowsByRules(dg.rows);
            }

            // Sort date groups - by bin order if binning enabled, otherwise by date
            let sortedDateGroups: Map<string, { rows: DataRow[]; date: Date | null }>;
            if (effectiveDateBinning && effectiveDateBins.length > 0) {
                const binOrder = effectiveDateBins.map(b => {
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
                for (const dateKey of sortDateKeys([...dateGroups.keys()])) {
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
    }, [processedRows, effectiveGroupColumn, primaryGroupColumn, effectiveGroupLevels, effectiveDateColumn, effectiveImageColumn, effectiveSortRules, effectiveDateBinning, effectiveDateBins, sortDateKeys, sortRowsByRules, effectiveTextGrouping, effectiveTextGroupBins]);

    // Matrix data
    const matrixData = useMemo(() => {
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
                if (effectiveTextGrouping && effectiveTextGroupBins.length > 0 && effectiveGroupColumn) {
                    const cellValue = String(row[effectiveGroupColumn] || '').trim();
                    const cellValueLower = cellValue.toLowerCase();
                    const cellNumValue = parseFloat(cellValue.replace(/[^\d.-]/g, ''));

                    let foundGroup = false;
                    for (let binIdx = 0; binIdx < effectiveTextGroupBins.length; binIdx++) {
                        const group = effectiveTextGroupBins[binIdx];
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
                        rowSortKey = effectiveTextGroupBins.length;
                    }
                } else {
                    // Fallback to regular groupKey
                    const result = getGroupKey(row[effectiveGroupColumn]);
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
            cells.set(cellKey, sortRowsByRules(cellRows));
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
    }, [processedRows, config.viewMode, config.matrixRowColumn, config.matrixColColumn, config.sortRules, effectiveGroupColumn, effectiveTextGrouping, effectiveTextGroupBins, sortRowsByRules]);

    // Calendar data
    const calendarData = useMemo(() => {
        if (config.viewMode !== 'calendar' || !config.dateColumn) {
            return new Map<string, DataRow[]>();
        }

        const byDate = new Map<string, DataRow[]>();
        for (const row of processedRows) {
            const dateVal = row[config.dateColumn];
            const date = parseDate(dateVal);
            if (!date) continue;
            const dateKey = formatDateKey(date);
            if (!byDate.has(dateKey)) byDate.set(dateKey, []);
            byDate.get(dateKey)!.push(row);
        }
        for (const [dateKey, rows] of byDate.entries()) {
            byDate.set(dateKey, sortRowsByRules(rows));
        }
        return byDate;
    }, [processedRows, config.viewMode, config.dateColumn, sortRowsByRules]);

    // Calendar grid
    const calendarGrid = useMemo(() => {
        const mode = config.calendarMode;
        const selDate = config.selectedDate ? new Date(config.selectedDate) : new Date();

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
    }, [config.calendarMode, config.selectedDate, calendarMonth]);

    // Helper function to get the group key for a row (handles binning)
    const getRowGroupKey = useCallback((row: DataRow): string => {
        // 多级分组：仅当有超过1个层级，或层级有自己的配置时使用
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
                    // 数值范围分组
                    const numVal = parseFloat(String(rawVal));
                    if (isNaN(numVal)) {
                        key = '其他';
                    } else {
                        const bin = level.numericBins.find(b => numVal >= b.min && numVal <= b.max);
                        key = bin ? bin.label : '其他';
                    }
                } else if (level.type === 'date' && level.dateBins && level.dateBins.length > 0) {
                    // 日期范围分组
                    const dateVal = parseDate(rawVal);
                    if (!dateVal) {
                        key = '无效日期';
                    } else {
                        const dateTime = dateVal.getTime();
                        const bin = level.dateBins.find(b => {
                            const start = new Date(b.startDate).getTime();
                            const end = new Date(b.endDate).getTime() + 86400000 - 1; // 包含结束日期
                            return dateTime >= start && dateTime <= end;
                        });
                        key = bin ? bin.label : '其他日期';
                    }
                } else if (level.type === 'text' && level.textBins && level.textBins.length > 0) {
                    // 文本分组 - 使用 getGroupKey 获取完整文本
                    const groupResult = getGroupKey(rawVal);
                    const strVal = groupResult?.originalText || groupResult?.key || String(rawVal || '').trim();
                    const strValLower = strVal.toLowerCase();
                    // 先检查 conditions 匹配
                    const matchedBin = level.textBins.find(b => {
                        // 先检查 conditions
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
                        // 兼容旧的 values 数组
                        return (b.values || []).some(v => v === strVal);
                    });
                    key = matchedBin ? matchedBin.label : (strVal || '(空)');
                } else {
                    // 文本分组（默认按原值）- 使用 getGroupKey 以保留带编号的完整文本
                    const groupResult = getGroupKey(rawVal);
                    key = groupResult?.originalText || groupResult?.key || String(rawVal || '').trim() || '(空)';
                }

                keys.push(key);
            }
            return keys.join(' › ');
        }

        // 简单分组模式：使用原来的逻辑（支持全局 textGrouping, groupBinning 等）
        if (!effectiveGroupColumn) return '未分组';

        // Numeric binning
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

        // Text grouping
        if (effectiveTextGrouping && effectiveTextGroupBins.length > 0) {
            const cellValue = String(row[effectiveGroupColumn] || '').trim();
            const cellValueLower = cellValue.toLowerCase();
            const cellNumValue = parseFloat(cellValue.replace(/[^\d.-]/g, '')); // Parse number from cell

            for (const group of effectiveTextGroupBins) {
                // First check exact match (values array)
                if (group.values.includes(cellValue)) {
                    return group.label;
                }

                // Then check conditions (new flexible matching)
                if (group.conditions && group.conditions.length > 0) {
                    for (const cond of group.conditions) {
                        if (!cond.value) continue;

                        let matched = false;
                        const condValueLower = cond.value.toLowerCase();
                        const condNumValue = parseFloat(cond.value.replace(/[^\d.-]/g, ''));

                        switch (cond.operator) {
                            case 'contains':
                                matched = cellValueLower.includes(condValueLower);
                                break;
                            case 'equals':
                                matched = cellValueLower === condValueLower;
                                break;
                            case 'startsWith':
                                matched = cellValueLower.startsWith(condValueLower);
                                break;
                            case 'endsWith':
                                matched = cellValueLower.endsWith(condValueLower);
                                break;
                            case 'greaterThan':
                                matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue > condNumValue;
                                break;
                            case 'lessThan':
                                matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue < condNumValue;
                                break;
                            case 'greaterOrEqual':
                                matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue >= condNumValue;
                                break;
                            case 'lessOrEqual':
                                matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue <= condNumValue;
                                break;
                            case 'numEquals':
                                matched = !isNaN(cellNumValue) && !isNaN(condNumValue) && cellNumValue === condNumValue;
                                break;
                        }

                        if (matched) {
                            return group.label;
                        }
                    }
                }

                // Legacy: check keyword match (keywords array - contains match)
                if (group.keywords && group.keywords.length > 0) {
                    for (const keyword of group.keywords) {
                        if (keyword && cellValueLower.includes(keyword.toLowerCase())) {
                            return group.label;
                        }
                    }
                }
            }
            return '未分组'; // Value not in any group
        }

        // Fuzzy rule matching (keyword merge grouping)
        if (effectiveFuzzyRuleText) {
            const fuzzyRules = effectiveFuzzyRuleText.split(';').map(rule => {
                const [target, keywords] = rule.split('=');
                return {
                    target: target?.trim() || '',
                    keywords: (keywords || '').split('|').map(k => k.trim().toLowerCase()).filter(Boolean)
                };
            }).filter(r => r.target && r.keywords.length > 0);

            if (fuzzyRules.length > 0) {
                const cellValue = String(row[effectiveGroupColumn] || '').toLowerCase();
                for (const rule of fuzzyRules) {
                    if (rule.keywords.some(kw => cellValue.includes(kw))) {
                        return rule.target;
                    }
                }
            }
        }

        const result = getGroupKey(row[effectiveGroupColumn]);
        // 优先使用 originalText（完整文本），而不是 key（可能只是数字）
        return result?.originalText || result?.key || '未分组';
    }, [effectiveGroupColumn, effectiveGroupColumns, effectiveGroupLevels, effectiveGroupBinning, effectiveGroupBins, effectiveTextGrouping, effectiveTextGroupBins, effectiveFuzzyRuleText]);

    // 多级分组 key 生成函数 - 将多个列的值组合成一个嵌套 key
    const getMultiLevelGroupKey = useCallback((row: DataRow): string => {
        if (effectiveGroupColumns.length === 0) return '未分组';

        const keys: string[] = [];
        for (const col of effectiveGroupColumns) {
            const val = String(row[col] || '').trim();
            keys.push(val || '(空)');
        }

        // 用 " › " 连接多级，便于显示层级关系
        return keys.join(' › ');
    }, [effectiveGroupColumns]);

    // Helper function to get the date group key for a row (handles date binning)
    const getRowDateGroupKey = useCallback((row: DataRow): string => {
        if (!effectiveDateColumn) return '无日期';

        const dateVal = parseDate(row[effectiveDateColumn]);
        if (!dateVal) return '无效日期';

        if (effectiveDateBinning && effectiveDateBins.length > 0) {
            const dateTime = dateVal.getTime();

            for (const bin of effectiveDateBins) {
                const startTime = new Date(bin.startDate).getTime();
                const endTime = new Date(bin.endDate).getTime() + 86400000 - 1; // End of day
                if (dateTime >= startTime && dateTime <= endTime) {
                    return bin.label;
                }
            }
            return '其他';
        }

        // Default: return formatted date
        const y = dateVal.getFullYear();
        const m = dateVal.getMonth() + 1;
        const d = dateVal.getDate();
        return `${y}-${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`;
    }, [effectiveDateColumn, effectiveDateBinning, effectiveDateBins]);

    // Stats
    const stats = useMemo(() => {
        let totalImages = 0;
        const accountSet = new Set<string>();
        const groupSet = new Set<string>();

        // Helper to get date bin label
        const getDateBinLabel = (row: DataRow): string | null => {
            if (!effectiveDateBinning || effectiveDateBins.length === 0 || !effectiveDateColumn) return null;
            const date = parseDate(row[effectiveDateColumn]);
            if (!date) return '无效日期';
            const dateTime = date.getTime();
            for (const bin of effectiveDateBins) {
                const startTime = new Date(bin.startDate).getTime();
                const endTime = new Date(bin.endDate).getTime() + 86400000 - 1;
                if (dateTime >= startTime && dateTime <= endTime) {
                    const startD = new Date(bin.startDate);
                    const endD = new Date(bin.endDate);
                    return `${startD.getMonth() + 1}/${startD.getDate()}-${endD.getMonth() + 1}/${endD.getDate()}`;
                }
            }
            return '其他';
        };

        const hasDateBinning = effectiveDateBinning && effectiveDateBins.length > 0 && effectiveDateColumn;
        const hasColumnGrouping = !!(primaryGroupColumn || effectiveGroupLevels.length > 0);
        const isMultiLevel = hasDateBinning && hasColumnGrouping;

        for (const row of processedRows) {
            if (extractImageUrl(row[effectiveImageColumn])) totalImages++;
            if (effectiveAccountColumn) {
                const acc = String(row[effectiveAccountColumn] || '');
                if (acc) accountSet.add(acc);
            }

            // Track groups based on current grouping mode - only count primary level
            if (config.viewMode === 'gallery') {
                let groupKey: string;
                if (isMultiLevel) {
                    // For multi-level, only count the primary grouping level
                    if (config.groupPriority === 'date') {
                        groupKey = getDateBinLabel(row) || '无日期';
                    } else {
                        groupKey = getRowGroupKey(row);
                    }
                } else if (hasColumnGrouping) {
                    groupKey = getRowGroupKey(row);
                } else if (hasDateBinning) {
                    groupKey = getDateBinLabel(row) || '无日期';
                } else {
                    groupKey = '未分组';
                }
                groupSet.add(groupKey);
            }
        }

        const groupCount = config.viewMode === 'gallery' && (primaryGroupColumn || effectiveGroupLevels.length > 0 || (effectiveDateBinning && effectiveDateBins.length > 0))
            ? groupSet.size
            : timelineData.size;

        return {
            totalImages,
            groups: groupCount,
            accounts: accountSet.size,
        };
    }, [processedRows, effectiveImageColumn, effectiveAccountColumn, effectiveGroupColumn, primaryGroupColumn, effectiveGroupLevels, config.viewMode, effectiveDateBinning, effectiveDateBins, effectiveDateColumn, config.groupPriority, timelineData, getRowGroupKey]);

    // Expand/collapse helpers - adapt to group-first or date-first mode
    const expandAll = () => {
        if (primaryGroupColumn || effectiveGroupLevels.length > 0) {
            // Group-first mode: expand by group keys
            setExpandedGroups(new Set(groupedTimelineData.map(g => g.key)));
        } else {
            // Date-first mode: expand by date keys
            setExpandedGroups(new Set(timelineData.keys()));
        }
    };
    const collapseAll = () => setExpandedGroups(new Set());

    const buildGroupedRows = useCallback((rows: DataRow[]) => {
        if (!primaryGroupColumn && effectiveGroupLevels.length === 0) return [];

        // Track group type for smarter sorting decisions
        const subGroups = new Map<string, {
            rows: DataRow[];
            sortKey?: number;
            type: 'numbered' | 'date' | 'text' | 'number' | 'bin';
            originalTexts: Set<string>;
            // For non-numbered groups, store a representative value for sorting
            representativeValue?: string | number | boolean | null;
            binIndex?: number; // For bin-based sorting
        }>();

        // Helper to get ALL matching bin keys for a value (supports overlapping bins)
        const getAllBinKeys = (val: unknown): { key: string; binIndex: number }[] => {
            if (!effectiveGroupBinning || effectiveGroupBins.length === 0) return [];
            const numVal = parseFloat(String(val));
            if (isNaN(numVal)) return [];

            const matches: { key: string; binIndex: number }[] = [];
            for (let i = 0; i < effectiveGroupBins.length; i++) {
                const bin = effectiveGroupBins[i];
                if (numVal >= bin.min && numVal <= bin.max) {
                    matches.push({ key: bin.label, binIndex: i });
                }
            }
            return matches;
        };

        for (const row of rows) {
            // Check if binning is enabled and applicable
            if (effectiveGroupBinning && effectiveGroupBins.length > 0) {
                const binResults = getAllBinKeys(row[effectiveGroupColumn]);

                if (binResults.length > 0) {
                    // Add row to ALL matching bins (support overlapping)
                    for (const binResult of binResults) {
                        const key = binResult.key;
                        if (!subGroups.has(key)) {
                            subGroups.set(key, {
                                rows: [],
                                sortKey: binResult.binIndex,
                                type: 'bin',
                                originalTexts: new Set(),
                                representativeValue: row[effectiveGroupColumn],
                                binIndex: binResult.binIndex
                            });
                        }
                        subGroups.get(key)!.rows.push(row);
                    }
                } else {
                    // No match - put in "其他"
                    const key = '其他';
                    if (!subGroups.has(key)) {
                        subGroups.set(key, {
                            rows: [],
                            sortKey: effectiveGroupBins.length,
                            type: 'bin',
                            originalTexts: new Set(),
                            representativeValue: row[effectiveGroupColumn],
                            binIndex: effectiveGroupBins.length
                        });
                    }
                    subGroups.get(key)!.rows.push(row);
                }
            } else if (effectiveTextGrouping && effectiveTextGroupBins.length > 0) {
                // Text grouping with conditions - use getRowGroupKey for full support
                const key = getRowGroupKey(row);
                const binIndex = effectiveTextGroupBins.findIndex(g => g.label === key);

                if (!subGroups.has(key)) {
                    subGroups.set(key, {
                        rows: [],
                        sortKey: binIndex >= 0 ? binIndex : effectiveTextGroupBins.length,
                        type: 'bin',
                        originalTexts: new Set(),
                        representativeValue: row[effectiveGroupColumn],
                        binIndex: binIndex >= 0 ? binIndex : effectiveTextGroupBins.length
                    });
                }
                subGroups.get(key)!.rows.push(row);
            } else {
                // Use original getGroupKey logic
                const result = getGroupKey(row[effectiveGroupColumn]);
                const key = result?.key || '未分组';
                const type = result?.type || 'text';
                const sortKey = result?.sortKey;

                if (!subGroups.has(key)) {
                    subGroups.set(key, {
                        rows: [],
                        sortKey,
                        type,
                        originalTexts: new Set(),
                        representativeValue: row[effectiveGroupColumn],
                    });
                }
                const group = subGroups.get(key)!;
                group.rows.push(row);
                if (result?.originalText) {
                    group.originalTexts.add(result.originalText);
                }
            }
        }

        // Determine if we have any numbered groups
        const hasNumberedGroups = [...subGroups.values()].some(g => g.type === 'numbered');
        const hasBinGroups = [...subGroups.values()].some(g => g.type === 'bin');

        // Find if user has a sort rule for the groupColumn
        const groupSortRule = effectiveSortRules.find(r => r.column === effectiveGroupColumn);

        const sortedEntries = [...subGroups.entries()].sort((a, b) => {
            const aData = a[1], bData = b[1];

            // For bin-based groups, always sort by bin index
            if (hasBinGroups && aData.binIndex !== undefined && bData.binIndex !== undefined) {
                return groupSortRule?.descending
                    ? bData.binIndex - aData.binIndex
                    : aData.binIndex - bData.binIndex;
            }

            const aKey = aData.sortKey, bKey = bData.sortKey;

            // If both have sortKey (numbered groups), sort by number
            if (aKey !== undefined && bKey !== undefined) {
                return groupSortRule?.descending ? bKey - aKey : aKey - bKey;
            }

            // If only one has sortKey, numbered groups come first
            if (aKey !== undefined) return -1;
            if (bKey !== undefined) return 1;

            // For non-numbered groups, use sortRule if available
            if (groupSortRule && !hasNumberedGroups) {
                const aVal = aData.representativeValue;
                const bVal = bData.representativeValue;

                // Try date comparison
                const aDate = parseDate(aVal);
                const bDate = parseDate(bVal);
                if (aDate && bDate) {
                    return groupSortRule.descending ? bDate.getTime() - aDate.getTime() : aDate.getTime() - bDate.getTime();
                }

                // Try number comparison
                const aNum = parseFloat(String(aVal));
                const bNum = parseFloat(String(bVal));
                if (!isNaN(aNum) && !isNaN(bNum)) {
                    return groupSortRule.descending ? bNum - aNum : aNum - bNum;
                }

                // String comparison
                const aStr = String(aVal || '');
                const bStr = String(bVal || '');
                const cmp = aStr.localeCompare(bStr, 'zh-CN');
                return groupSortRule.descending ? -cmp : cmp;
            }

            // Default: alphabetical
            return a[0].localeCompare(b[0], 'zh-CN');
        });

        return sortedEntries.map(([subKey, { rows: subRows, originalTexts }]) => {
            let label = subKey;
            if (!effectiveGroupBinning && originalTexts.size > 0) {
                const texts = Array.from(originalTexts);
                label = texts.reduce((a, b) => a.length <= b.length ? a : b);
            }
            // Strictly sort items within each group by user's sortRules
            return { key: subKey, label, rows: sortRowsByRules(subRows) };
        });
    }, [effectiveGroupColumn, effectiveGroupBinning, effectiveGroupBins, effectiveTextGrouping, effectiveTextGroupBins, getRowGroupKey, effectiveSortRules, sortRowsByRules]);

    // Render thumbnail with actions
    const renderThumbnail = (row: DataRow, idx: number, options?: { size?: number; showMeta?: boolean; compact?: boolean }) => {
        const url = extractImageUrl(row[effectiveImageColumn]);
        if (!url) return null;

        const size = options?.size ?? config.thumbnailSize;
        const showMeta = options?.showMeta ?? true;
        const compact = options?.compact ?? false;

        const account = effectiveAccountColumn ? String(row[effectiveAccountColumn] || '') : '';
        const link = effectiveLinkColumn ? String(row[effectiveLinkColumn] || '') : '';
        const labels = effectiveLabelColumns.map(col => String(row[col] || '')).filter(Boolean);
        const highlight = checkHighlight(row, effectiveHighlightRules);

        const buttonSize = compact ? 12 : 16;
        const buttonPadding = compact ? 'p-1' : 'p-2';
        const overlayGap = compact ? 'gap-1' : 'gap-2';
        const title = showMeta ? '' : [account, ...labels].filter(Boolean).join(' · ');

        const rowId = String(row._rowId || '');
        const isSelected = gallerySelectMode && selectedThumbnails.has(rowId);

        return (
            <div
                key={idx}
                className="relative group"
                style={{ width: size }}
                title={title || undefined}
                onClick={(e) => {
                    if (!gallerySelectMode) return;
                    if ((e.target as HTMLElement).closest('button')) return;
                    scheduleThumbnailSelect(rowId);
                }}
                onDoubleClick={(e) => handleThumbnailDoubleClick(e, rowId, link)}
            >
                <div
                    className={`relative overflow-hidden rounded-lg bg-slate-50 transition-all ${isSelected ? 'ring-2 ring-blue-500 ring-offset-1' : ''}`}
                    style={{
                        height: size,
                        border: isSelected ? '2px solid #3b82f6' : (highlight ? `${highlight.borderWidth}px solid ${highlight.color}` : '1px solid #e2e8f0'),
                        boxShadow: highlight ? `0 0 ${highlight.borderWidth * 2}px ${highlight.color}80` : 'none'
                    }}
                >
                    <img
                        src={url}
                        alt=""
                        className="w-full h-full object-contain cursor-pointer"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                    />

                    {/* Selection checkbox - clickable in select mode */}
                    {gallerySelectMode && (
                        <button
                            onClick={(e) => { e.stopPropagation(); toggleThumbnailSelection(rowId); }}
                            className={`absolute top-1 left-1 z-20 w-6 h-6 rounded border-2 flex items-center justify-center transition-all cursor-pointer hover:scale-110 ${isSelected
                                ? 'bg-blue-500 border-blue-500 text-white'
                                : 'bg-white/90 border-slate-400 hover:border-blue-400'
                                }`}
                        >
                            {isSelected && <Check size={14} />}
                        </button>
                    )}

                    {/* Highlight badge - only show when not in select mode */}
                    {!gallerySelectMode && highlight && (
                        <div
                            className="absolute top-1 left-1 w-3 h-3 rounded-full"
                            style={{ backgroundColor: highlight.color }}
                        />
                    )}

                    {/* Favorite button - visible on hover, stays above overlay (hidden in select mode) */}
                    {!gallerySelectMode && (
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                toggleFavorite(url, row);
                            }}
                            className={`absolute top-1 right-1 p-1 rounded-full transition-all z-10 ${isFavorited(url)
                                ? 'bg-amber-400 text-white opacity-100'
                                : 'bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-amber-400'
                                }`}
                            title={isFavorited(url) ? '取消收藏' : '添加收藏'}
                        >
                            <Star size={compact ? 10 : 12} fill={isFavorited(url) ? 'currentColor' : 'none'} />
                        </button>
                    )}

                    {/* Hover overlay - hidden in select mode */}
                    {!gallerySelectMode && (
                        <div className={`absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center ${overlayGap}`}>
                            <button
                                onClick={(e) => { e.stopPropagation(); setSelectedRow(row); }}
                                className={`${buttonPadding} bg-white/20 rounded-full hover:bg-white/40`}
                                title="查看详情"
                            >
                                <Info size={buttonSize} className="text-white" />
                            </button>
                            {link && (
                                <button
                                    onClick={(e) => { e.stopPropagation(); openExternalUrl(link); }}
                                    className={`${buttonPadding} bg-white/20 rounded-full hover:bg-white/40`}
                                    title="打开链接"
                                >
                                    <ExternalLink size={buttonSize} className="text-white" />
                                </button>
                            )}
                        </div>
                    )}
                    {labels.length > 0 && (
                        <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 rounded-b-lg transition-opacity ${config.showLabelOverlay ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                            <div className="text-[11px] text-white truncate">
                                {labels.join(' · ')}
                            </div>
                        </div>
                    )}
                </div>

                {/* Info overlay */}
                {showMeta && (
                    <div className="mt-1 space-y-0.5">
                        {account && (
                            <div className="text-[9px] text-slate-600 truncate">👤 {account}</div>
                        )}
                        {labels.slice(0, 2).map((label, i) => (
                            <div key={i} className="text-[11px] text-slate-400 truncate">{label}</div>
                        ))}
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 sheetmind-light-form" style={{ colorScheme: 'light' }}>

            <div className="flex-1 flex overflow-hidden" style={{ minHeight: 0, minWidth: 0 }}>
                {/* Config Panel */}
                {showConfig && (
                    <div className="w-72 flex-shrink-0 bg-white border-r border-slate-200 overflow-y-auto p-4 space-y-4 [&_label]:font-semibold [&_label]:text-slate-700">
                        <div className="border-b border-slate-200 pb-3 space-y-3">
                            <div className="flex items-start justify-between gap-2">
                                <div className="flex-1 space-y-2">
                                    <div className="flex items-center gap-2">
                                        <Settings2 size={16} className="text-slate-600" />
                                        <h3 className="text-xs font-semibold text-slate-800">画廊配置</h3>
                                        <span className="text-[10px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                                            当前视图：{currentViewLabel}
                                        </span>
                                    </div>
                                </div>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={() => setShowConfig(false)}
                                        className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 hover:text-slate-800 transition"
                                        title="收起配置面板"
                                    >
                                        <X size={16} />
                                    </button>
                                </div>
                            </div>

                            {headerCollapsed ? (
                                <div className="flex items-center gap-2">
                                    <select
                                        value={config.viewMode}
                                        onChange={e => updateConfig({ viewMode: e.target.value as GalleryConfig['viewMode'] })}
                                        className="flex-1 px-2 py-1 text-[10px] bg-white text-slate-800 border border-slate-200 rounded"
                                    >
                                        <option value="gallery">缩略图</option>
                                        <option value="tree">🌳 树形</option>
                                        <option value="timeline">时间轴</option>
                                        <option value="matrix">矩阵</option>
                                        <option value="calendar">日历</option>
                                    </select>
                                    <span className="text-[9px] text-slate-500">顶部已收起</span>
                                </div>
                            ) : (
                                <>
                                    <div className="grid grid-cols-5 gap-1 bg-slate-100 p-1 rounded-lg">
                                        {[
                                            { mode: 'gallery', icon: Grid3X3, label: '缩略图' },
                                            { mode: 'tree', icon: FolderTree, label: '树形' },
                                            { mode: 'timeline', icon: LayoutGrid, label: '时间轴' },
                                            { mode: 'matrix', icon: Table2, label: '矩阵' },
                                            { mode: 'calendar', icon: CalendarDays, label: '日历' },
                                        ].map(({ mode, icon: Icon, label }) => (
                                            <button
                                                key={mode}
                                                onClick={() => updateConfig({ viewMode: mode as GalleryConfig['viewMode'] })}
                                                className={`px-1.5 py-1.5 text-[9px] font-medium rounded-md transition-all flex flex-col items-center gap-0.5 ${config.viewMode === mode ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
                                            >
                                                <Icon size={12} /> {label}
                                            </button>
                                        ))}
                                    </div>

                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-semibold text-slate-600 flex items-center gap-1">
                                                <Bookmark size={12} />
                                                配置版本
                                                {cloudSyncing ? (
                                                    <Loader2 size={10} className="animate-spin text-indigo-500" />
                                                ) : cloudSyncEnabled ? (
                                                    <Cloud size={10} className="text-green-500" />
                                                ) : (
                                                    <CloudOff size={10} className="text-slate-400" />
                                                )}
                                            </span>
                                            {cloudError && <span className="text-[9px] text-red-500">{cloudError}</span>}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <select
                                                value={activePresetId || ''}
                                                onChange={e => {
                                                    const id = e.target.value;
                                                    if (!id) {
                                                        setActivePresetId(null);
                                                        return;
                                                    }
                                                    const preset = presets.find(p => p.id === id);
                                                    if (preset) loadPreset(preset);
                                                }}
                                                className="flex-1 px-2 py-1 text-[10px] bg-white text-slate-800 border border-slate-200 rounded"
                                            >
                                                <option value="">当前配置（未保存）</option>
                                                {presets.map(preset => (
                                                    <option key={preset.id} value={preset.id}>{preset.name}</option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={savePreset}
                                                disabled={cloudSyncing}
                                                className="px-2 py-1 text-[9px] bg-indigo-500 hover:bg-indigo-600 text-white rounded disabled:opacity-50"
                                            >
                                                保存
                                            </button>
                                            <button
                                                onClick={() => {
                                                    if (!activePresetId) return;
                                                    const preset = presets.find(p => p.id === activePresetId);
                                                    if (!preset) return;
                                                    const newName = prompt('输入新版本名称:', preset.name);
                                                    if (newName && newName.trim() && newName.trim() !== preset.name) {
                                                        renamePreset(preset.id, newName.trim());
                                                    }
                                                }}
                                                disabled={!activePresetId}
                                                className="px-2 py-1 text-[9px] bg-slate-100 text-slate-600 hover:bg-slate-200 rounded disabled:opacity-50"
                                            >
                                                重命名
                                            </button>
                                            <button
                                                onClick={() => {
                                                    if (!activePresetId) return;
                                                    const preset = presets.find(p => p.id === activePresetId);
                                                    if (!preset) return;
                                                    if (confirm(`删除版本 "${preset.name}"？`)) {
                                                        deletePreset(preset.id);
                                                    }
                                                }}
                                                disabled={!activePresetId}
                                                className="px-2 py-1 text-[9px] bg-red-50 text-red-600 hover:bg-red-100 rounded disabled:opacity-50"
                                            >
                                                删除
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        <button
                                            onClick={copyDataToClipboard}
                                            className="w-full py-1.5 text-[10px] bg-emerald-500 text-white rounded hover:bg-emerald-600 flex items-center justify-center gap-1"
                                            title="复制筛选后的数据到剪贴板，可粘贴到谷歌表格"
                                        >
                                            <Download size={10} /> 复制到剪贴板 ({processedRows.length}行)
                                        </button>
                                        <button
                                            onClick={() => setCopyViewModal({ ...copyViewModal, open: true })}
                                            className="w-full py-1.5 text-[10px] bg-purple-500 text-white rounded hover:bg-purple-600 flex items-center justify-center gap-1"
                                            title="复制当前分组视图布局（分组名+缩略图网格）"
                                        >
                                            <Image size={10} /> 复制视图布局
                                        </button>
                                        <div className="grid grid-cols-2 gap-2">
                                            <button
                                                onClick={syncAllNotesToSheet}
                                                disabled={isBatchSyncing || notesSyncCount === 0}
                                                className="py-1.5 text-[9px] font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                                            >
                                                {isBatchSyncing ? (
                                                    <>
                                                        <Loader2 size={10} className="animate-spin" />
                                                        同步中...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Upload size={10} />
                                                        备注同步 {NOTE_COLUMN}列
                                                    </>
                                                )}
                                            </button>
                                            <button
                                                onClick={syncAllCategoriesToSheet}
                                                disabled={isBatchCategorySyncing || categoriesSyncCount === 0}
                                                className="py-1.5 text-[9px] font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                                            >
                                                {isBatchCategorySyncing ? (
                                                    <>
                                                        <Loader2 size={10} className="animate-spin" />
                                                        同步中...
                                                    </>
                                                ) : (
                                                    <>
                                                        <Tag size={10} />
                                                        分类同步 {CATEGORY_COLUMN}列
                                                    </>
                                                )}
                                            </button>
                                        </div>
                                        <div className="text-[9px] text-slate-400">A=备注 · B=媒体标签</div>
                                    </div>
                                </>
                            )}
                        </div>

                        <button
                            onClick={handleResetConfig}
                            className="w-full py-1.5 text-[10px] text-red-600 hover:bg-red-50 rounded border border-red-200 flex items-center justify-center gap-1"
                        >
                            <Trash2 size={10} /> 重置配置
                        </button>

                        {/* Gallery Pagination Options */}
                        {config.viewMode === 'gallery' && (
                            <div ref={viewSectionRef}>
                                <label className="block text-xs font-semibold text-slate-700 mb-1">每页显示</label>
                                <div className="flex flex-wrap gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200">
                                    {[
                                        { size: -1, label: '渐进' },
                                        { size: 0, label: '全部' },
                                        { size: 100, label: '100' },
                                        { size: 200, label: '200' },
                                        { size: 300, label: '300' },
                                        { size: 500, label: '500' },
                                    ].map(({ size, label }) => (
                                        <button
                                            key={size}
                                            onClick={() => {
                                                updateConfig({ galleryPageSize: size });
                                                setGalleryPage(1);
                                                setGroupLoadedCount({});
                                            }}
                                            className={`px-2 py-1 text-[9px] font-medium rounded transition-all ${config.galleryPageSize === size ? 'bg-purple-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                    {/* Custom input inline */}
                                    <input
                                        type="number"
                                        min={10}
                                        max={2000}
                                        placeholder="自定义"
                                        defaultValue={config.galleryPageSize > 0 && ![100, 200, 300, 500].includes(config.galleryPageSize) ? config.galleryPageSize : ''}
                                        onBlur={(e) => {
                                            const val = parseInt(e.target.value);
                                            if (val && val >= 10 && val <= 2000) {
                                                updateConfig({ galleryPageSize: val });
                                                setGalleryPage(1);
                                                setGroupLoadedCount({});
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                const val = parseInt((e.target as HTMLInputElement).value);
                                                if (val && val >= 10 && val <= 2000) {
                                                    updateConfig({ galleryPageSize: val });
                                                    setGalleryPage(1);
                                                    setGroupLoadedCount({});
                                                }
                                            }
                                        }}
                                        className="w-10 px-1 py-0.5 text-[9px] bg-white border border-slate-200 rounded text-center focus:ring-1 focus:ring-purple-300 focus:border-purple-400"
                                    />
                                </div>
                            </div>
                        )}

                        {/* Calendar Mode Options */}
                        {config.viewMode === 'calendar' && (
                            <div ref={viewSectionRef}>
                                <label className="block text-xs font-semibold text-slate-700 mb-1">日历显示</label>
                                <div className="grid grid-cols-5 gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200">
                                    {[
                                        { mode: 'month', label: '月' },
                                        { mode: 'week', label: '周' },
                                        { mode: 'day', label: '日' },
                                        { mode: 'range7', label: '±7天' },
                                        { mode: 'scroll', label: '横滚' },
                                    ].map(({ mode, label }) => (
                                        <button
                                            key={mode}
                                            onClick={() => updateConfig({ calendarMode: mode as GalleryConfig['calendarMode'] })}
                                            className={`px-1 py-1 text-[9px] font-medium rounded ${config.calendarMode === mode ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}
                                        >
                                            {label}
                                        </button>
                                    ))}
                                </div>
                                {config.calendarMode !== 'month' && (
                                    <div className="mt-1.5">
                                        <label className="block text-[9px] text-slate-500 mb-0.5">选择日期</label>
                                        <input
                                            type="date"
                                            value={config.selectedDate}
                                            onChange={e => updateConfig({ selectedDate: e.target.value })}
                                            className="w-full px-2 py-1 text-xs bg-white text-slate-800 border border-slate-200 rounded"
                                        />
                                    </div>
                                )}
                                {config.calendarMode === 'scroll' && (
                                    <div className="mt-1.5">
                                        <label className="block text-[9px] text-slate-500 mb-0.5">显示天数</label>
                                        <div className="flex gap-1">
                                            {[1, 2, 3, 4, 5].map(n => (
                                                <button
                                                    key={n}
                                                    onClick={() => updateConfig({ scrollDaysPerView: n })}
                                                    className={`flex-1 py-1 text-[10px] rounded transition ${config.scrollDaysPerView === n
                                                        ? 'bg-indigo-500 text-white'
                                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                        }`}
                                                >
                                                    {n}天
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Matrix Options */}
                        {config.viewMode === 'matrix' && (
                            <div ref={viewSectionRef} className="space-y-2">
                                <label className="block text-xs font-semibold text-slate-700">矩阵行列设置</label>
                                <div className="grid grid-cols-2 gap-2">
                                    <div>
                                        <label className="block text-[9px] text-slate-500 mb-0.5">列（顶部表头）</label>
                                        <select
                                            value={config.matrixColColumn}
                                            onChange={e => updateConfig({ matrixColColumn: e.target.value })}
                                            className="w-full px-2 py-1 text-[10px] bg-white text-slate-800 border border-slate-200 rounded"
                                        >
                                            <option value="">选择列...</option>
                                            {effectiveData.columns.map(col => (
                                                <option key={col} value={col}>{col}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[9px] text-slate-500 mb-0.5">行（左侧表头）</label>
                                        <select
                                            value={config.matrixRowColumn}
                                            onChange={e => updateConfig({ matrixRowColumn: e.target.value })}
                                            className="w-full px-2 py-1 text-[10px] bg-white text-slate-800 border border-slate-200 rounded"
                                        >
                                            <option value="">选择列...</option>
                                            <option value="__GROUP_SETTINGS__">[分组设置]</option>
                                            {effectiveData.columns.map(col => (
                                                <option key={col} value={col}>{col}</option>
                                            ))}
                                        </select>
                                    </div>
                                    {/* Swap Button */}
                                    <button
                                        onClick={() => updateConfig({
                                            matrixRowColumn: config.matrixColColumn,
                                            matrixColColumn: config.matrixRowColumn
                                        })}
                                        className="mt-1 w-full py-1 text-[10px] text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 flex items-center justify-center gap-1"
                                        title="互换行列"
                                    >
                                        ↔️ 行列互换
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* Thumbnail Size */}
                        <div className="border-t border-sky-200 pt-3">
                            <label className="block text-xs font-semibold text-slate-700 mb-1">缩略图: {config.thumbnailSize}px</label>
                            <input
                                type="range"
                                min="80"
                                max="500"
                                value={config.thumbnailSize}
                                onChange={e => updateConfig({ thumbnailSize: parseInt(e.target.value) })}
                                className="w-full"
                            />
                            {/* Thumbnail Fit Mode Toggle */}
                            <div className="flex items-center gap-2 mt-2">
                                <button
                                    onClick={() => updateConfig({ thumbnailFit: 'cover' })}
                                    className={`flex-1 px-2 py-1.5 text-[10px] rounded border transition-colors ${config.thumbnailFit === 'cover'
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                                        }`}
                                >
                                    <Grid3X3 size={14} className="inline mr-1" /> 填充方格
                                </button>
                                <button
                                    onClick={() => updateConfig({ thumbnailFit: 'contain' })}
                                    className={`flex-1 px-2 py-1.5 text-[10px] rounded border transition-colors ${config.thumbnailFit === 'contain'
                                        ? 'bg-blue-600 text-white border-blue-600'
                                        : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                                        }`}
                                >
                                    <Image size={14} className="inline mr-1" /> 原始比例
                                </button>
                            </div>
                            {/* Label Overlay Toggle */}
                            <div className="flex items-center gap-2 mt-2">
                                <input
                                    type="checkbox"
                                    id="showLabelOverlay"
                                    checked={config.showLabelOverlay}
                                    onChange={e => updateConfig({ showLabelOverlay: e.target.checked })}
                                    className="w-4 h-4 rounded border-slate-300"
                                />
                                <label htmlFor="showLabelOverlay" className="text-xs text-slate-600">
                                    持续显示信息标签
                                </label>
                            </div>
                            {/* Favorite Icon Toggle */}
                            <div className="flex items-center gap-2 mt-1">
                                <input
                                    type="checkbox"
                                    id="showFavoriteIcon"
                                    checked={config.showFavoriteIcon}
                                    onChange={e => updateConfig({ showFavoriteIcon: e.target.checked })}
                                    className="w-4 h-4 rounded border-slate-300"
                                />
                                <label htmlFor="showFavoriteIcon" className="text-xs text-slate-600">
                                    显示收藏按钮 <Star size={12} className="inline ml-1" />
                                </label>
                            </div>
                            <div className="flex items-center gap-2 mt-1">
                                <input
                                    type="checkbox"
                                    id="showCategoryIcon"
                                    checked={config.showCategoryIcon}
                                    onChange={e => updateConfig({ showCategoryIcon: e.target.checked })}
                                    className="w-4 h-4 rounded border-slate-300"
                                />
                                <label htmlFor="showCategoryIcon" className="text-xs text-slate-600">
                                    显示媒体标签按钮 <Tag size={12} className="inline ml-1" />
                                </label>
                            </div>
                        </div>

                        {/* View-specific Width Settings */}
                        {showViewSizeControls && (
                            <div className="border-t border-sky-200 pt-3 space-y-2">
                                <label className="block text-xs font-semibold text-slate-700">📐 视图尺寸设置</label>

                                {/* Matrix Cell Width */}
                                {showMatrixWidth && (
                                    <div>
                                        <label className="block text-[10px] text-slate-600 mb-0.5">
                                            矩阵单元格宽度: {config.matrixCellWidth}px
                                        </label>
                                        <input
                                            type="range"
                                            min="150"
                                            max="500"
                                            value={config.matrixCellWidth}
                                            onChange={e => updateConfig({ matrixCellWidth: parseInt(e.target.value) })}
                                            className="w-full"
                                        />
                                    </div>
                                )}

                                {/* Scroll Card Width */}
                                {showScrollWidth && (
                                    <div>
                                        <label className="block text-[10px] text-slate-600 mb-0.5">
                                            滚动卡片宽度: {config.scrollCardWidth}px
                                        </label>
                                        <input
                                            type="range"
                                            min="200"
                                            max="1000"
                                            value={config.scrollCardWidth}
                                            onChange={e => updateConfig({ scrollCardWidth: parseInt(e.target.value) })}
                                            className="w-full"
                                        />
                                    </div>
                                )}

                                {/* Calendar Cell Height */}
                                {showCalendarHeight && (
                                    <div>
                                        <label className="block text-[10px] text-slate-600 mb-0.5">
                                            日历格子高度: {config.calendarCellHeight}px
                                        </label>
                                        <input
                                            type="range"
                                            min="80"
                                            max="300"
                                            value={config.calendarCellHeight}
                                            onChange={e => updateConfig({ calendarCellHeight: parseInt(e.target.value) })}
                                            className="w-full"
                                        />
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Transpose Data Status - controlled from unified settings */}
                        {effectiveTranspose && (
                            <div className="border-t border-purple-200 pt-3 bg-purple-50 -mx-4 px-4 pb-3">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-purple-700 font-medium flex items-center gap-1"><RefreshCw size={12} /> 转置数据已启用</span>
                                </div>
                                <p className="text-[10px] text-purple-600 mt-1">
                                    第一列作为字段名，其他列作为记录。在顶部「配置」按钮中可关闭。
                                </p>
                            </div>
                        )}

                        {/* Show All Images Toggle */}
                        <div className="border-t border-sky-200 pt-3">
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={config.showAllImages}
                                    onChange={e => updateConfig({ showAllImages: e.target.checked })}
                                    className="w-4 h-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-500"
                                />
                                <span className="text-xs text-slate-700 flex items-center gap-1"><Image size={12} /> 显示全部图片 (不限制数量)</span>
                            </label>
                            <p className="text-[10px] text-slate-400 mt-1 ml-6">关闭时，每个分组/单元格只显示部分图片以提高性能</p>
                        </div>

                        <div ref={notesSectionRef} className="text-[11px] font-semibold text-slate-800 tracking-wide">备注与分类</div>

                        {/* Sync Settings */}
                        <div className="border-t border-sky-200 pt-3 space-y-2">
                            <div className="flex items-center justify-between bg-blue-50 px-2 py-1.5 rounded-lg border border-blue-100">
                                <div className="flex items-center gap-1.5">
                                    <Upload size={12} className={autoSyncNotesToSheet ? 'text-blue-600' : 'text-slate-400'} />
                                    <span className={`text-[10px] font-medium ${autoSyncNotesToSheet ? 'text-blue-700' : 'text-slate-500'}`}>
                                        备注 → 表格{NOTE_COLUMN}列
                                    </span>
                                </div>
                                <button
                                    onClick={() => setAutoSyncNotesToSheet(!autoSyncNotesToSheet)}
                                    className={`relative w-8 h-4 rounded-full transition-colors ${autoSyncNotesToSheet ? 'bg-blue-500' : 'bg-slate-300'}`}
                                >
                                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${autoSyncNotesToSheet ? 'left-4' : 'left-0.5'}`} />
                                </button>
                            </div>
                            <div className="flex items-center justify-between bg-purple-50 px-2 py-1.5 rounded-lg border border-purple-100">
                                <div className="flex items-center gap-1.5">
                                    <Tag size={12} className={autoSyncCategoriesToSheet ? 'text-purple-600' : 'text-slate-400'} />
                                    <span className={`text-[10px] font-medium ${autoSyncCategoriesToSheet ? 'text-purple-700' : 'text-slate-500'}`}>
                                        分类 → 表格{CATEGORY_COLUMN}列
                                    </span>
                                </div>
                                <button
                                    onClick={() => setAutoSyncCategoriesToSheet(!autoSyncCategoriesToSheet)}
                                    className={`relative w-8 h-4 rounded-full transition-colors ${autoSyncCategoriesToSheet ? 'bg-purple-500' : 'bg-slate-300'}`}
                                >
                                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${autoSyncCategoriesToSheet ? 'left-4' : 'left-0.5'}`} />
                                </button>
                            </div>
                        </div>

                        {/* Category/Tag Section */}
                        <div className="border-t border-sky-200 pt-3 space-y-3">
                            <div className="flex items-center gap-2">
                                <Tag size={14} className="text-purple-500" />
                                <span className="text-xs font-semibold text-slate-700">【媒体标签】分类设置</span>
                            </div>
                            <p className="text-[10px] text-slate-400">点击图标可快速分类</p>

                            {/* Category Options - 始终显示 */}
                            <div className="space-y-2 bg-slate-50 p-2 rounded-lg">
                                {/* Built-in Presets */}
                                <div className="space-y-1.5">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] font-medium text-slate-600">快速预设</span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => updateConfig({ categoryOptions: getDefaultConfig().categoryOptions })}
                                                className="text-[9px] text-slate-600 hover:text-slate-700 flex items-center gap-0.5"
                                                title="恢复默认预设"
                                            >
                                                <RotateCcw size={10} /> 恢复默认预设
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setEditingPreset({
                                                        id: Date.now().toString(),
                                                        name: '',
                                                        emoji: '🏷️',
                                                        options: [...config.categoryOptions]
                                                    });
                                                    setShowPresetEditor(true);
                                                }}
                                                className="text-[9px] text-purple-600 hover:text-purple-700 flex items-center gap-0.5"
                                                title="保存当前分类为预设"
                                            >
                                                <Plus size={10} /> 保存为预设
                                            </button>
                                        </div>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {/* Built-in presets */}
                                        <button
                                            onClick={() => updateConfig({
                                                categoryOptions: ['神父修女', '玛丽亚', '圣人类', '游行', '各种人物', '祷告词', '主耶稣', '天使', '元素', '其他']
                                            })}
                                            className="px-2 py-1 text-[10px] bg-purple-100 text-purple-700 hover:bg-purple-200 rounded transition-colors"
                                        >
                                            <Image size={12} className="inline mr-1" /> 画面分类
                                        </button>
                                        <button
                                            onClick={() => updateConfig({
                                                categoryOptions: ['开场动画(效果类)', '创意开场', '镜头运动/转场', '场景', '画面形式(效果/动画)', '画面素材', '故事类(真实人物)', '故事类(卡通)']
                                            })}
                                            className="px-2 py-1 text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-200 rounded transition-colors"
                                        >
                                            <Video size={12} className="inline mr-1" /> 参考分类
                                        </button>
                                        <button
                                            onClick={() => updateConfig({
                                                categoryOptions: ['图片', '视频', 'Reels祷告词', 'Sora', '效果类视频', '主耶稣类视频', '玛丽亚视频']
                                            })}
                                            className="px-2 py-1 text-[10px] bg-green-100 text-green-700 hover:bg-green-200 rounded transition-colors"
                                        >
                                            <FileText size={12} className="inline mr-1" /> 贴文类型
                                        </button>
                                        <button
                                            onClick={() => updateConfig({
                                                categoryOptions: ['安东尼奥', '边框设计', '成年男性', '成年女性', '祷告主词', '风景', '黑色背景', '家庭', '教堂', '旧纸张', '卡通插画耶稣', '卡通人物', '蜡烛', '老人', '卢西亚', '玛丽亚', '玛丽亚骑驴', '玫瑰花', '年轻人', '其他', '神父', '圣家族', '圣丽塔', '圣婴耶稣', '十字架', '石头石板', '手拿纸', '书本', '特蕾莎', '天使', '小学生/学生', '修女', '耶稣帮助人', '耶稣骑驴', '婴儿/幼儿', '游行', '灾难', '知更鸟', '主耶稣', '文档']
                                            })}
                                            className="px-2 py-1 text-[10px] bg-orange-100 text-orange-700 hover:bg-orange-200 rounded transition-colors"
                                        >
                                            <Tag size={12} className="inline mr-1" /> 画面细节
                                        </button>
                                        {/* Custom presets from cloud */}
                                        {customPresets.map((preset) => (
                                            <div key={preset.id} className="group relative">
                                                <button
                                                    onClick={() => updateConfig({ categoryOptions: preset.options })}
                                                    className="px-2 py-1 text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-200 rounded transition-colors"
                                                >
                                                    {preset.emoji} {preset.name}
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        if (confirm(`删除预设 "${preset.name}"？`)) {
                                                            deleteCustomPreset(preset.id);
                                                        }
                                                    }}
                                                    className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 text-white rounded-full text-[8px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                                >
                                                    ×
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    {customPresets.length > 0 && (
                                        <p className="text-[9px] text-slate-400 flex items-center gap-1">
                                            <Cloud size={10} /> {customPresets.length} 个自定义预设已同步
                                        </p>
                                    )}
                                </div>

                                <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                                    <span className="text-[10px] font-medium text-slate-600">当前分类选项</span>
                                    <span className="text-[10px] text-slate-400">{config.categoryOptions.length} 项</span>
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    {config.categoryOptions.map((cat, idx) => (
                                        <div key={idx} className="flex items-center gap-1 bg-white border border-slate-200 rounded px-2 py-1 group">
                                            <span className="text-[10px] text-slate-700">{cat}</span>
                                            <button
                                                onClick={() => {
                                                    const newOptions = config.categoryOptions.filter((_, i) => i !== idx);
                                                    updateConfig({ categoryOptions: newOptions });
                                                }}
                                                className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                            >
                                                <X size={10} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                                {/* Add new category */}
                                <div className="flex gap-1">
                                    <input
                                        type="text"
                                        placeholder="新分类..."
                                        className="flex-1 px-2 py-1 text-[10px] border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                                                const newCat = (e.target as HTMLInputElement).value.trim();
                                                if (!config.categoryOptions.includes(newCat)) {
                                                    updateConfig({ categoryOptions: [...config.categoryOptions, newCat] });
                                                }
                                                (e.target as HTMLInputElement).value = '';
                                            }
                                        }}
                                    />
                                    <button
                                        onClick={(e) => {
                                            const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                                            if (input.value.trim() && !config.categoryOptions.includes(input.value.trim())) {
                                                updateConfig({ categoryOptions: [...config.categoryOptions, input.value.trim()] });
                                                input.value = '';
                                            }
                                        }}
                                        className="px-2 py-1 text-[10px] bg-purple-500 text-white rounded hover:bg-purple-600"
                                    >
                                        <Plus size={10} />
                                    </button>
                                </div>
                                <div className="space-y-1">
                                    <textarea
                                        rows={2}
                                        placeholder="批量粘贴分类（支持多单元格/多行）"
                                        className="w-full px-2 py-1 text-[10px] border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                        onPaste={(e) => {
                                            const text = e.clipboardData.getData('text');
                                            if (!text) return;
                                            e.preventDefault();
                                            const items = text
                                                .split(/[\t\n\r]+/)
                                                .map(s => s.trim())
                                                .filter(Boolean);
                                            if (items.length === 0) return;
                                            const merged = [...config.categoryOptions];
                                            items.forEach(item => {
                                                if (!merged.includes(item)) merged.push(item);
                                            });
                                            updateConfig({ categoryOptions: merged });
                                        }}
                                    />
                                    <p className="text-[9px] text-slate-400">从谷歌表格复制一片区域后直接粘贴即可</p>
                                </div>

                                {/* Target Column */}
                                <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                                    <span className="text-[10px] text-slate-500">目标列:</span>
                                    <span className="text-[10px] font-medium text-slate-700">{CATEGORY_COLUMN} 列（固定）</span>
                                </div>
                                <div className="text-[9px] text-slate-400 pt-2 border-t border-slate-200">
                                    同步入口已移至顶部「快捷操作」
                                </div>
                            </div>
                        </div>

                        <div ref={advancedSectionRef} className="border-t border-sky-200 pt-3">
                            <button
                                onClick={() => toggleSection('advanced')}
                                className="w-full flex items-center justify-between text-[11px] font-semibold text-slate-800 tracking-wide"
                            >
                                <span>高级</span>
                                <ChevronDown
                                    size={14}
                                    className={`transition-transform ${collapsedSections.has('advanced') ? '-rotate-90' : 'rotate-0'}`}
                                />
                            </button>

                            {!collapsedSections.has('advanced') && (
                                <div className="space-y-2 pt-2">
                                    <div className="text-[10px] font-semibold text-slate-700">数据源与表格</div>

                                    {/* Data Source Info */}
                                    {data && data.fileName && (
                                        <div className="bg-blue-50 rounded-lg p-2 border border-blue-200">
                                            <div className="flex items-center gap-1 mb-1">
                                                <Table2 size={12} className="text-blue-600" />
                                                <span className="text-xs font-semibold text-blue-700">当前数据源</span>
                                            </div>
                                            <div className="space-y-1">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-blue-500 flex items-center gap-1"><FileText size={10} /> 表格:</span>
                                                    <span className="text-[11px] text-blue-800 font-medium truncate flex-1" title={data.fileName}>
                                                        {data.fileName}
                                                    </span>
                                                </div>
                                                {data.sheetName && (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] text-blue-500"><FileText size={10} className="inline mr-1" /> 工作表:</span>
                                                        <span className="text-[11px] text-blue-800 font-medium truncate flex-1" title={data.sheetName}>
                                                            {data.sheetName}
                                                        </span>
                                                    </div>
                                                )}
                                                <div className="flex items-center gap-2">
                                                    <span className="text-[10px] text-blue-500"><BarChart2 size={10} className="inline mr-1" /> 数据:</span>
                                                    <span className="text-[11px] text-blue-800">
                                                        {effectiveData.rows.length} 行 · {effectiveData.columns.length} 列
                                                    </span>
                                                </div>
                                            </div>
                                        </div>
                                    )}

                                    {/* Google Sheets Sync */}
                                    <div className="bg-green-50 rounded-lg p-2 border border-green-200">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs font-semibold text-green-700 flex items-center gap-1">
                                                <Link2 size={12} />
                                                表格联动
                                            </span>
                                            {sheetsSpreadsheetId && (
                                                <a
                                                    href={sheetsUrl}
                                                    target="_blank"
                                                    rel="noopener noreferrer"
                                                    className="text-[10px] text-green-600 hover:text-green-700 flex items-center gap-0.5"
                                                >
                                                    <ExternalLink size={10} /> 打开表格
                                                </a>
                                            )}
                                        </div>
                                        <div className="flex gap-1">
                                            <input
                                                type="text"
                                                value={sheetsUrl}
                                                onChange={(e) => {
                                                    setSheetsUrl(e.target.value);
                                                    const parsed = parseGoogleSheetsUrl(e.target.value);
                                                    setSheetsSpreadsheetId(parsed?.spreadsheetId || null);
                                                    setSheetsError(null);
                                                }}
                                                placeholder="粘贴 Google Sheets URL..."
                                                className="flex-1 px-3 py-2 text-xs bg-white text-slate-900 border border-green-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-400 shadow-sm placeholder:text-slate-400"
                                            />
                                        </div>
                                        {sheetsSpreadsheetId && (
                                            <button
                                                onClick={syncToGoogleSheet}
                                                disabled={sheetsSyncing || processedRows.length === 0}
                                                className="mt-2 w-full px-2 py-1.5 text-xs bg-green-500 hover:bg-green-600 text-white rounded flex items-center justify-center gap-1 disabled:opacity-50"
                                            >
                                                {sheetsSyncing ? (
                                                    <><Loader2 size={12} className="animate-spin" /> 同步中...</>
                                                ) : (
                                                    <><RefreshCw size={12} /> 同步当前视图到表格</>
                                                )}
                                            </button>
                                        )}
                                        {sheetsError && (
                                            <p className="text-[10px] text-red-500 mt-1">{sheetsError}</p>
                                        )}
                                        {!sheetsSpreadsheetId && sheetsUrl && (
                                            <p className="text-[10px] text-amber-600 mt-1">无法解析表格链接</p>
                                        )}
                                        {!getGoogleAccessToken() && sheetsSpreadsheetId && (
                                            <p className="text-[10px] text-amber-600 mt-1">提示: 需要重新登录 Google 账号获取写入权限</p>
                                        )}
                                    </div>

                                    {/* Stats */}
                                    <div className="bg-slate-50 rounded-lg p-2 text-[10px] text-slate-500 space-y-0.5">
                                        <p><Image size={12} className="inline mr-1" /> {stats.totalImages} 张图片</p>
                                        <p><FolderOpen size={12} className="inline mr-1" /> {stats.groups} 个分组</p>
                                        <p>👤 {stats.accounts} 个账号</p>
                                    </div>

                                    {/* Reset Config */}
                                    <button
                                        onClick={handleResetConfig}
                                        className="w-full py-1.5 text-[10px] text-red-600 hover:bg-red-50 rounded border border-red-200 flex items-center justify-center gap-1"
                                    >
                                        <Trash2 size={10} /> 重置配置
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                )}

                {/* Main Content */}
                <div className="flex-1 overflow-hidden flex flex-col relative" style={{ minHeight: 0, minWidth: 0 }}>
                    {/* Toolbar */}
                    <div className="flex-shrink-0 bg-white border-b border-slate-200 px-4 py-2 flex items-center justify-between gap-4">
                        <div className="flex items-center gap-2">
                            {!showConfig && (
                                <button onClick={() => setShowConfig(true)} className="px-2 py-1 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 rounded flex items-center gap-1">
                                    <Settings2 size={12} /> 配置
                                </button>
                            )}
                            <span className="text-sm text-slate-600">{stats.totalImages} 张图片 · {stats.groups} 个分组</span>

                            {/* Favorites toggle button */}
                            <button
                                onClick={() => {
                                    setShowFavorites(!showFavorites);
                                    if (!showFavorites) setShowCategoryView(false);
                                }}
                                className={`px-3 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${showFavorites
                                    ? 'bg-amber-100 text-amber-700 border border-amber-300'
                                    : 'bg-slate-100 hover:bg-amber-50 text-slate-600 hover:text-amber-600'
                                    }`}
                            >
                                {favoritesSyncing ? (
                                    <Loader2 size={12} className="animate-spin" />
                                ) : (
                                    <Star size={12} fill={showFavorites ? 'currentColor' : 'none'} />
                                )}
                                我的收藏 {favorites.length > 0 && `(${favorites.length})`}
                            </button>

                            {/* Category View toggle button */}
                            <button
                                onClick={() => {
                                    setShowCategoryView(!showCategoryView);
                                    if (!showCategoryView) setShowFavorites(false);
                                }}
                                className={`px-3 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${showCategoryView
                                    ? 'bg-purple-100 text-purple-700 border border-purple-300'
                                    : 'bg-slate-100 hover:bg-purple-50 text-slate-600 hover:text-purple-600'
                                    }`}
                            >
                                <Tag size={12} />
                                媒体标签 {galleryCategories.size > 0 && `(${galleryCategories.size})`}
                            </button>

                            {/* Gallery selection mode toggle */}
                            {!showFavorites && config.viewMode === 'gallery' && (
                                <button
                                    onClick={() => {
                                        setGallerySelectMode(!gallerySelectMode);
                                        if (gallerySelectMode) setSelectedThumbnails(new Set());
                                    }}
                                    className={`px-3 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${gallerySelectMode
                                        ? 'bg-blue-100 text-blue-700 border border-blue-300'
                                        : 'bg-slate-100 hover:bg-blue-50 text-slate-600 hover:text-blue-600'
                                        }`}
                                >
                                    <Check size={12} />
                                    {gallerySelectMode ? `选择中 (${selectedThumbnails.size})` : '多选'}
                                </button>
                            )}

                            {/* Classification mode toggle */}
                            {!showFavorites && config.viewMode === 'gallery' && (
                                <>
                                    <button
                                        onClick={() => {
                                            // 允许在没有分组列时使用分类功能 - 使用 categoryOptions 作为分组
                                            setClassificationMode(!classificationMode);
                                            if (classificationMode) {
                                                setSelectedForClassification(new Set());
                                                setDraggedItems([]);
                                            }
                                        }}
                                        className={`px-3 py-1 text-xs rounded flex items-center gap-1.5 transition-colors ${classificationMode
                                            ? 'bg-purple-100 text-purple-700 border border-purple-300'
                                            : 'bg-slate-100 hover:bg-purple-50 text-slate-600 hover:text-purple-600'
                                            }`}
                                        title="开启分类模式：可拖拽图片到不同分类"
                                    >
                                        <Layers size={12} />
                                        {classificationMode ? `分类中 (${selectedForClassification.size})` : '分类'}
                                    </button>
                                    {/* Clear selection button - shown when items are selected */}
                                    {classificationMode && selectedForClassification.size > 0 && (
                                        <button
                                            onClick={() => {
                                                setSelectedForClassification(new Set());
                                                setDraggedItems([]);
                                                setCopyFeedback('✅ 已取消全选');
                                                setTimeout(() => setCopyFeedback(null), 1500);
                                            }}
                                            className="px-2 py-1 text-xs rounded flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors"
                                            title="取消全选"
                                        >
                                            ✕ 取消选择
                                        </button>
                                    )}
                                </>
                            )}

                            {/* Global Keyword Search */}
                            {!showFavorites && (
                                <div className="relative flex items-center">
                                    <input
                                        type="text"
                                        value={config.searchKeyword}
                                        onChange={e => updateConfig({ searchKeyword: e.target.value })}
                                        placeholder="🔎 搜索关键词..."
                                        className={`w-40 px-2 py-1 text-xs bg-white border rounded transition-all focus:ring-2 focus:ring-blue-400 focus:border-blue-400 ${config.searchKeyword
                                            ? 'border-blue-400 bg-blue-50'
                                            : 'border-slate-200 hover:border-slate-300'
                                            }`}
                                    />
                                    {config.searchKeyword && (
                                        <button
                                            onClick={() => updateConfig({ searchKeyword: '' })}
                                            className="absolute right-1.5 text-slate-400 hover:text-slate-600 p-0.5"
                                            title="清除搜索"
                                        >
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Selection action buttons */}
                            {gallerySelectMode && selectedThumbnails.size > 0 && (
                                <div className="flex items-center gap-2 px-2 py-1 bg-blue-50 rounded-lg border border-blue-200">
                                    <span className="text-xs text-blue-600">已选 {selectedThumbnails.size} 项</span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setShowBatchFolderMenu({ x: e.clientX, y: e.clientY });
                                        }}
                                        className="px-2 py-0.5 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 flex items-center gap-1"
                                    >
                                        <Star size={10} /> 批量收藏 ▾
                                    </button>
                                    <button
                                        onClick={() => copySelectedThumbnailsData(processedRows)}
                                        className="px-2 py-0.5 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600 flex items-center gap-1"
                                    >
                                        <Copy size={10} /> 复制数据
                                    </button>
                                    <button
                                        onClick={openBatchCategoryModal}
                                        className="px-2 py-0.5 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 flex items-center gap-1"
                                    >
                                        <Tag size={10} /> 批量分类
                                    </button>
                                    <button
                                        onClick={() => openBatchNoteModal(Array.from(selectedThumbnails))}
                                        className="px-2 py-0.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
                                    >
                                        <MessageSquare size={10} /> 批量备注
                                    </button>
                                    <button
                                        onClick={clearThumbnailSelection}
                                        className="px-2 py-0.5 text-xs text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                    >
                                        取消
                                    </button>
                                </div>
                            )}

                        </div>

                        {/* Feedback message */}
                        {copyFeedback && (
                            <div className="px-4 py-1.5 text-xs text-center text-slate-600 bg-slate-50 border-t border-slate-200">
                                {copyFeedback}
                            </div>
                        )}

                        {config.viewMode === 'timeline' && (
                            <div className="flex items-center gap-2">
                                <button onClick={expandAll} className="px-2 py-1 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 rounded">全部展开</button>
                                <button onClick={collapseAll} className="px-2 py-1 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 rounded">全部折叠</button>
                            </div>
                        )}

                        {config.viewMode === 'gallery' && (primaryGroupColumn || effectiveGroupLevels.length > 0 || (effectiveDateBinning && effectiveDateBins.length > 0)) && (
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => setCollapsedGalleryGroups(new Set())}
                                    className="px-2 py-1 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
                                >
                                    全部展开
                                </button>
                                <button
                                    onClick={() => {
                                        // Collapse all groups - include classification overrides
                                        const allGroupKeys = new Set<string>();
                                        processedRows.forEach(row => {
                                            // Check for classification override first
                                            const imageUrl = extractImageUrl(row[effectiveImageColumn]);
                                            const overrideKey = imageUrl ? classificationOverrides[imageUrl] : null;

                                            if (overrideKey) {
                                                allGroupKeys.add(overrideKey);
                                            } else if (primaryGroupColumn || effectiveGroupLevels.length > 0) {
                                                allGroupKeys.add(getRowGroupKey(row));
                                            } else if (effectiveDateBinning && effectiveDateBins.length > 0 && effectiveDateColumn) {
                                                // Use date binning
                                                const date = parseDate(row[effectiveDateColumn]);
                                                if (date) {
                                                    const dateTime = date.getTime();
                                                    let found = false;
                                                    for (const bin of effectiveDateBins) {
                                                        const startTime = new Date(bin.startDate).getTime();
                                                        const endTime = new Date(bin.endDate).getTime() + 86400000 - 1;
                                                        if (dateTime >= startTime && dateTime <= endTime) {
                                                            // Generate label from dates
                                                            const startD = new Date(bin.startDate);
                                                            const endD = new Date(bin.endDate);
                                                            allGroupKeys.add(`${startD.getMonth() + 1}/${startD.getDate()}-${endD.getMonth() + 1}/${endD.getDate()}`);
                                                            found = true;
                                                            break;
                                                        }
                                                    }
                                                    if (!found) allGroupKeys.add('其他');
                                                } else {
                                                    allGroupKeys.add('无效日期');
                                                }
                                            }
                                        });
                                        // Also include custom groups
                                        customGroups.forEach(g => allGroupKeys.add(g));
                                        setCollapsedGalleryGroups(allGroupKeys);
                                    }}
                                    className="px-2 py-1 text-xs text-slate-700 bg-slate-100 hover:bg-slate-200 rounded"
                                >
                                    全部折叠
                                </button>
                            </div>
                        )}

                        {config.viewMode === 'calendar' && config.calendarMode === 'month' && (
                            <div className="flex items-center gap-2">
                                <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))} className="p-1 hover:bg-slate-100 rounded">
                                    <ChevronLeft size={16} />
                                </button>
                                <span className="text-sm font-medium min-w-[100px] text-center">{calendarMonth.getFullYear()}年{calendarMonth.getMonth() + 1}月</span>
                                <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))} className="p-1 hover:bg-slate-100 rounded">
                                    <ChevronRight size={16} />
                                </button>
                            </div>
                        )}
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-auto p-4" style={{ minHeight: 0, minWidth: 0 }} ref={contentScrollRef}>
                        {/* Favorites View */}
                        {showFavorites && (
                            <div className="space-y-4">
                                {/* Favorites Header */}
                                <div className="flex items-center justify-between bg-amber-50 px-4 py-3 rounded-xl border border-amber-200">
                                    <div className="flex items-center gap-3">
                                        <Star size={20} className="text-amber-500" fill="currentColor" />
                                        <span className="font-semibold text-amber-800">我的收藏</span>
                                        <span className="text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">{getFavoritesInFolder(activeFolderId).length} 项</span>
                                        {selectedFavorites.size > 0 && (
                                            <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">已选 {selectedFavorites.size}</span>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        {getFavoritesInFolder(activeFolderId).length > 0 && (
                                            <button
                                                onClick={clearAllFavorites}
                                                className="px-3 py-1.5 text-xs text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50"
                                            >
                                                <Trash2 size={12} className="inline mr-1" />清空
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setShowFavorites(false)}
                                            className="px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                                        >
                                            返回画廊
                                        </button>
                                    </div>
                                </div>

                                {/* Folder Tabs with Tip */}
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="text-[10px] text-slate-400"><Lightbulb size={10} className="inline mr-1" /> 双击收藏夹可编辑名称和图标</span>
                                </div>
                                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                                    <button
                                        onClick={() => setActiveFolderId('all')}
                                        className={`px-3 py-1.5 text-xs rounded-lg border whitespace-nowrap transition-colors ${activeFolderId === 'all'
                                            ? 'bg-amber-500 text-white border-amber-500'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'
                                            }`}
                                    >
                                        <BookOpen size={12} className="inline mr-1" /> 全部 ({favorites.length})
                                    </button>
                                    {favoriteFolders.map(folder => (
                                        <button
                                            key={folder.id}
                                            onClick={() => setActiveFolderId(folder.id)}
                                            onDoubleClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setEditFolderModal({
                                                    isOpen: true,
                                                    folderId: folder.id,
                                                    name: folder.name,
                                                    emoji: folder.emoji || '📁'
                                                });
                                            }}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                setFolderContextMenu({ x: e.clientX, y: e.clientY, folderId: folder.id });
                                            }}
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                e.dataTransfer.dropEffect = 'copy';
                                                setDragOverTarget(`folder-${folder.id}`);
                                            }}
                                            onDragLeave={() => setDragOverTarget(null)}
                                            onDrop={(e) => handleDropToFolder(e, folder.id)}
                                            className={`px-3 py-1.5 text-xs rounded-lg border whitespace-nowrap transition-all flex items-center gap-1 ${activeFolderId === folder.id
                                                ? 'bg-amber-500 text-white border-amber-500'
                                                : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'
                                                } ${dragOverTarget === `folder-${folder.id}` ? 'ring-2 ring-green-400 ring-offset-1 scale-105 bg-green-50' : ''}`}
                                            title="双击编辑 | 右键更多选项"
                                        >
                                            {folder.emoji || '📁'} {folder.name} ({getFavoritesInFolder(folder.id).length})
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => setNewFolderModal({
                                            isOpen: true,
                                            name: '收藏夹 ' + (favoriteFolders.length + 1),
                                            emoji: '📂',
                                            onSuccess: undefined
                                        })}
                                        className="px-3 py-1.5 text-xs text-green-600 bg-green-50 rounded-lg border border-green-200 hover:bg-green-100 flex items-center gap-1"
                                    >
                                        <Plus size={12} /> 新建
                                    </button>
                                </div>

                                {/* Search Bar for Favorites */}
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1 max-w-md">
                                        <input
                                            type="text"
                                            value={favoriteSearchKeyword}
                                            onChange={(e) => setFavoriteSearchKeyword(e.target.value)}
                                            placeholder="在收藏中搜索..."
                                            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                                        />
                                        <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                        {favoriteSearchKeyword && (
                                            <button
                                                onClick={() => setFavoriteSearchKeyword('')}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Selection Toolbar */}
                                {favorites.length > 0 && (
                                    <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
                                        <span className="text-xs text-slate-500 mr-2">选择:</span>
                                        <button
                                            onClick={selectAllFavorites}
                                            className="px-2 py-1 text-xs text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                        >
                                            全选
                                        </button>
                                        <button
                                            onClick={deselectAllFavorites}
                                            className="px-2 py-1 text-xs text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                        >
                                            取消
                                        </button>
                                        <button
                                            onClick={invertFavoriteSelection}
                                            className="px-2 py-1 text-xs text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                        >
                                            反选
                                        </button>
                                        <div className="flex-1" />
                                        <button
                                            onClick={copySelectedFavoritesData}
                                            disabled={selectedFavorites.size === 0}
                                            className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                        >
                                            <Copy size={12} /> 复制选中 ({selectedFavorites.size})
                                        </button>
                                        <button
                                            onClick={copyAllFavoritesData}
                                            className="px-3 py-1 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600 flex items-center gap-1"
                                        >
                                            <Copy size={12} /> 复制全部
                                        </button>
                                        <button
                                            onClick={() => {
                                                const imageUrls = Array.from(selectedFavorites).map(id => {
                                                    const fav = favorites.find(f => f.id === id);
                                                    return fav?.imageUrl || '';
                                                }).filter(Boolean);
                                                if (imageUrls.length === 0) {
                                                    setCopyFeedback('⚠️ 请先选择收藏项');
                                                    setTimeout(() => setCopyFeedback(null), 2000);
                                                    return;
                                                }
                                                // Set selectedThumbnails for batch category modal
                                                setSelectedThumbnails(new Set(imageUrls));
                                                openBatchCategoryModal();
                                            }}
                                            disabled={selectedFavorites.size === 0}
                                            className="px-3 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                        >
                                            <Tag size={12} /> 批量分类
                                        </button>
                                        <button
                                            onClick={() => {
                                                const imageUrls = Array.from(selectedFavorites).map(id => {
                                                    const fav = favorites.find(f => f.id === id);
                                                    return fav?.imageUrl || '';
                                                }).filter(Boolean);
                                                openBatchNoteModal(imageUrls);
                                            }}
                                            disabled={selectedFavorites.size === 0}
                                            className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                        >
                                            <MessageSquare size={12} /> 批量备注
                                        </button>
                                    </div>
                                )}

                                {/* Favorites Grid */}
                                {getFilteredFavorites(activeFolderId, favoriteSearchKeyword).length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                                        <Star size={48} className="mb-4 opacity-30" />
                                        <p className="text-lg font-medium">{favoriteSearchKeyword ? '未找到匹配的收藏' : '暂无收藏'}</p>
                                        <p className="text-sm mt-1">{favoriteSearchKeyword ? '请尝试其他关键词' : '右键点击图片或点击右上角⭐可添加收藏'}</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-4">
                                        {getFilteredFavorites(activeFolderId, favoriteSearchKeyword).map((fav, index) => (
                                            <div
                                                key={fav.id}
                                                draggable
                                                onDragStart={(e) => handleFavoriteDragStart(e, fav, index)}
                                                onDragEnd={handleDragEnd}
                                                className={`relative group bg-white rounded-xl border-2 overflow-hidden shadow-sm hover:shadow-lg transition-all cursor-pointer ${selectedFavorites.has(fav.id)
                                                    ? 'border-blue-500 ring-2 ring-blue-200'
                                                    : 'border-slate-200'
                                                    } ${isDraggingImage ? 'cursor-grabbing' : 'cursor-grab'}`}
                                                style={{ width: config.thumbnailSize + 40 }}
                                                onClick={() => toggleFavoriteSelection(fav.id)}
                                                title="拖拽到其他收藏夹可移动"
                                            >
                                                {/* Selection checkbox */}
                                                <div className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${selectedFavorites.has(fav.id)
                                                    ? 'bg-blue-500 border-blue-500 text-white'
                                                    : 'bg-white/80 border-slate-300 opacity-0 group-hover:opacity-100'
                                                    }`}>
                                                    {selectedFavorites.has(fav.id) && <Check size={12} />}
                                                </div>

                                                {/* Image - with hover preview */}
                                                <div
                                                    className="relative"
                                                    onDoubleClick={(e) => {
                                                        if (!config.linkColumn) {
                                                            setFloatingTip({ text: '⚠️ 请先指定链接列', x: e.clientX, y: e.clientY });
                                                            setTimeout(() => setFloatingTip(null), 2000);
                                                            return;
                                                        }
                                                        const linkUrl = String(fav.rowData[config.linkColumn] || '');
                                                        if (linkUrl) {
                                                            e.stopPropagation();
                                                            openExternalUrl(linkUrl);
                                                        }
                                                    }}
                                                    onContextMenu={(e) => handleContextMenu(e, fav.rowData, fav.imageUrl)}
                                                    onMouseEnter={(e) => handleThumbnailMouseEnter(fav.imageUrl, e)}
                                                    onMouseLeave={handleThumbnailMouseLeave}
                                                >
                                                    <img
                                                        src={fav.imageUrl}
                                                        alt=""
                                                        className={`${config.thumbnailFit === 'contain' ? 'object-contain' : 'object-cover'} w-full`}
                                                        style={{
                                                            height: config.thumbnailSize,
                                                            backgroundColor: config.thumbnailFit === 'contain' ? '#f1f5f9' : undefined
                                                        }}
                                                        loading="lazy"
                                                    />
                                                    {/* Favorite badge */}
                                                    <div className="absolute top-2 right-2 bg-amber-400 text-white p-1.5 rounded-full shadow">
                                                        <Star size={16} fill="currentColor" />
                                                    </div>
                                                    {/* Note indicator - top left */}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); openNoteModal(fav.imageUrl, fav.rowData); }}
                                                        className={`absolute top-2 left-2 p-1.5 rounded-full shadow z-10 transition-all ${getNoteForImage(fav.imageUrl)
                                                            ? 'bg-blue-500 text-white opacity-100'
                                                            : 'bg-white/80 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-blue-400 hover:text-white'
                                                            }`}
                                                        title={getNoteForImage(fav.imageUrl)
                                                            ? `备注: ${getNoteForImage(fav.imageUrl).slice(0, 50)}${getNoteForImage(fav.imageUrl).length > 50 ? '...' : ''}`
                                                            : '添加备注'
                                                        }
                                                    >
                                                        <MessageSquare size={16} />
                                                    </button>
                                                    {/* Category indicator - top right (below star) */}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); openCategoryModal(fav.imageUrl, fav.rowData); }}
                                                        className={`absolute top-10 right-2 p-1.5 rounded-full shadow z-10 transition-all ${getCategoryForImage(fav.imageUrl)
                                                            ? 'bg-purple-500 text-white opacity-100'
                                                            : 'bg-white/80 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-purple-400 hover:text-white'
                                                            }`}
                                                        title={getCategoryForImage(fav.imageUrl)
                                                            ? `【媒体标签】: ${getCategoryForImage(fav.imageUrl)}`
                                                            : '添加分类'
                                                        }
                                                    >
                                                        <Tag size={16} />
                                                    </button>
                                                </div>

                                                {/* Actions */}
                                                <div className="p-2 space-y-1" onClick={(e) => e.stopPropagation()}>
                                                    {/* Show some row data preview */}
                                                    <div className="text-[10px] text-slate-500 truncate">
                                                        {Object.entries(fav.rowData).slice(0, 2).map(([k, v]) => (
                                                            v ? <span key={k} className="mr-2">{k}: {String(v).slice(0, 15)}</span> : null
                                                        ))}
                                                    </div>
                                                    <div className="flex gap-1">
                                                        <button
                                                            onClick={() => copyRowDataToClipboard(fav.rowData, fav.imageUrl)}
                                                            className="flex-1 px-2 py-1 text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 rounded flex items-center justify-center gap-1"
                                                        >
                                                            <Copy size={10} /> 复制行数据
                                                        </button>
                                                        <button
                                                            onClick={() => toggleFavorite(fav.imageUrl, fav.rowData)}
                                                            className="px-2 py-1 text-[10px] bg-red-50 text-red-600 hover:bg-red-100 rounded"
                                                            title="取消收藏"
                                                        >
                                                            <Trash2 size={10} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* Category View - Group images by their media tags */}
                        {showCategoryView && (
                            <div className="space-y-4">
                                {/* Category View Header */}
                                <div className="flex items-center justify-between bg-purple-50 px-4 py-3 rounded-xl border border-purple-200">
                                    <div className="flex items-center gap-3">
                                        <Tag size={20} className="text-purple-500" />
                                        <span className="font-semibold text-purple-800">媒体标签分类</span>
                                        <span className="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">{galleryCategories.size} 项</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {/* Toggle select mode */}
                                        <button
                                            onClick={() => {
                                                setGallerySelectMode(!gallerySelectMode);
                                                if (gallerySelectMode) setSelectedThumbnails(new Set());
                                            }}
                                            className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-colors ${gallerySelectMode
                                                ? 'bg-blue-100 text-blue-700 border border-blue-300'
                                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                                                }`}
                                        >
                                            <Check size={12} />
                                            {gallerySelectMode ? `选择中 (${selectedThumbnails.size})` : '多选'}
                                        </button>
                                        <button
                                            onClick={() => setShowCategoryView(false)}
                                            className="px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                                        >
                                            返回画廊
                                        </button>
                                    </div>
                                </div>

                                {/* Category View Batch Actions */}
                                {gallerySelectMode && selectedThumbnails.size > 0 && (
                                    <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg border border-blue-200">
                                        <span className="text-xs text-blue-600">已选 {selectedThumbnails.size} 项</span>
                                        <div className="flex-1" />
                                        <button
                                            onClick={openBatchCategoryModal}
                                            className="px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 flex items-center gap-1"
                                        >
                                            <Tag size={10} /> 批量分类
                                        </button>
                                        <button
                                            onClick={() => openBatchNoteModal(Array.from(selectedThumbnails))}
                                            className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
                                        >
                                            <MessageSquare size={10} /> 批量备注
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setShowBatchFolderMenu({ x: e.clientX, y: e.clientY });
                                            }}
                                            className="px-2 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 flex items-center gap-1"
                                        >
                                            <Star size={10} /> 批量收藏 ▾
                                        </button>
                                        <button
                                            onClick={() => setSelectedThumbnails(new Set())}
                                            className="px-2 py-1 text-xs text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                        >
                                            取消选择
                                        </button>
                                    </div>
                                )}

                                {/* Grouped by Category */}
                                {galleryCategories.size === 0 && config.categoryOptions.filter(c => c.trim()).length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                                        <Tag size={48} className="mb-4 opacity-30" />
                                        <p className="text-lg font-medium">暂无媒体标签</p>
                                        <p className="text-sm mt-1">点击图片上的标签图标可添加分类</p>
                                    </div>
                                ) : (
                                    (() => {
                                        // Group images by category
                                        const categoryGroups = new Map<string, { imageUrl: string; row: DataRow; rowId: string }[]>();

                                        config.categoryOptions
                                            .map(cat => cat.trim())
                                            .filter(Boolean)
                                            .forEach(category => {
                                                if (!categoryGroups.has(category)) {
                                                    categoryGroups.set(category, []);
                                                }
                                            });

                                        galleryCategories.forEach((category, imageUrl) => {
                                            if (!category) return;
                                            const rowIndex = effectiveData.rows.findIndex(r => {
                                                const rowImageUrl = effectiveImageColumn ? extractImageUrl(r[effectiveImageColumn]) : null;
                                                return rowImageUrl === imageUrl;
                                            });
                                            const row = rowIndex >= 0 ? effectiveData.rows[rowIndex] : null;
                                            if (!row) return;

                                            // Generate rowId for this row - include index for uniqueness
                                            const rowId = `${imageUrl}||${row._sourceSheet || ''}||${rowIndex}`;

                                            if (!categoryGroups.has(category)) {
                                                categoryGroups.set(category, []);
                                            }
                                            categoryGroups.get(category)!.push({ imageUrl, row, rowId });
                                        });

                                        return (
                                            <div className="space-y-6">
                                                {Array.from(categoryGroups.entries()).map(([category, items]) => (
                                                    <div key={category} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                                                        <div
                                                            className={`flex items-center justify-between px-4 py-2 bg-purple-50 border-b border-purple-100 transition-all ${dragOverTarget === `category-${category}` ? 'ring-2 ring-green-400 ring-inset bg-green-100' : ''}`}
                                                            onDragOver={(e) => {
                                                                e.preventDefault();
                                                                e.dataTransfer.dropEffect = 'copy';
                                                                setDragOverTarget(`category-${category}`);
                                                            }}
                                                            onDragLeave={() => setDragOverTarget(null)}
                                                            onDrop={(e) => handleDropToCategory(e, category)}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <Tag size={14} className="text-purple-500" />
                                                                <span className="font-medium text-purple-800">{category}</span>
                                                                <span className="text-xs text-purple-500 bg-purple-100 px-1.5 py-0.5 rounded">{items.length}</span>
                                                                {dragOverTarget === `category-${category}` && (
                                                                    <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded">释放添加到此分类</span>
                                                                )}
                                                            </div>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    clearCategoryItems(category);
                                                                }}
                                                                className="text-[10px] text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                                                            >
                                                                清空此标签
                                                            </button>
                                                        </div>
                                                        <div className="p-3 flex flex-wrap gap-3">
                                                            {items.length === 0 ? (
                                                                <div className="text-xs text-slate-400">
                                                                    暂无内容，可从画廊点击标签图标进行分类
                                                                </div>
                                                            ) : items.map(({ imageUrl, row, rowId }) => (
                                                                <div
                                                                    key={rowId}
                                                                    className={`relative group rounded-lg overflow-hidden border transition-all hover:shadow-md ${gallerySelectMode && selectedThumbnails.has(rowId)
                                                                        ? 'border-blue-500 ring-2 ring-blue-300'
                                                                        : 'border-slate-200 hover:border-purple-300'
                                                                        }`}
                                                                    style={{ width: config.thumbnailSize, height: config.thumbnailSize }}
                                                                    onClick={(e) => {
                                                                        if (!gallerySelectMode) return;
                                                                        if ((e.target as HTMLElement).closest('button')) return;
                                                                        scheduleThumbnailSelect(rowId);
                                                                    }}
                                                                    onDoubleClick={(e) => {
                                                                        const linkUrl = effectiveLinkColumn ? String(row[effectiveLinkColumn] || '') : '';
                                                                        handleThumbnailDoubleClick(e, rowId, linkUrl);
                                                                    }}
                                                                    onContextMenu={(e) => handleContextMenu(e, row, imageUrl)}
                                                                    onMouseEnter={(e) => handleThumbnailMouseEnter(imageUrl, e)}
                                                                    onMouseLeave={handleThumbnailMouseLeave}
                                                                >
                                                                    {/* Selection checkbox */}
                                                                    {gallerySelectMode && (
                                                                        <div
                                                                            className={`absolute top-1 left-1 w-5 h-5 rounded border-2 z-20 flex items-center justify-center cursor-pointer transition-all ${selectedThumbnails.has(rowId)
                                                                                ? 'bg-blue-500 border-blue-500 text-white'
                                                                                : 'bg-white/80 border-slate-400 text-transparent hover:border-blue-400'
                                                                                }`}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setSelectedThumbnails(prev => {
                                                                                    const next = new Set(prev);
                                                                                    if (next.has(rowId)) {
                                                                                        next.delete(rowId);
                                                                                    } else {
                                                                                        next.add(rowId);
                                                                                    }
                                                                                    return next;
                                                                                });
                                                                            }}
                                                                        >
                                                                            {selectedThumbnails.has(rowId) && <Check size={14} />}
                                                                        </div>
                                                                    )}
                                                                    <img
                                                                        src={imageUrl}
                                                                        alt=""
                                                                        className="w-full h-full"
                                                                        style={{ objectFit: config.thumbnailFit }}
                                                                        loading="lazy"
                                                                    />
                                                                    {/* Favorite star */}
                                                                    {config.showFavoriteIcon && (
                                                                        <button
                                                                            onClick={(e) => handleStarClick(e, imageUrl, row)}
                                                                            className={`absolute top-1 right-1 p-1.5 rounded-full z-10 transition-all ${isFavorited(imageUrl)
                                                                                ? 'bg-amber-400 text-white opacity-100'
                                                                                : 'bg-black/40 text-white opacity-0 group-hover:opacity-70 hover:bg-amber-400 hover:opacity-100'
                                                                                }`}
                                                                        >
                                                                            <Star size={14} fill={isFavorited(imageUrl) ? 'currentColor' : 'none'} />
                                                                        </button>
                                                                    )}
                                                                    {/* Note indicator */}
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); openNoteModal(imageUrl, row); }}
                                                                        className={`absolute top-8 left-1 p-1.5 rounded z-10 transition-all ${getNoteForImage(imageUrl)
                                                                            ? 'bg-blue-500 text-white opacity-100'
                                                                            : 'bg-black/40 text-white opacity-0 group-hover:opacity-70 hover:bg-blue-400 hover:opacity-100'
                                                                            }`}
                                                                        title={getNoteForImage(imageUrl) || '添加备注'}
                                                                    >
                                                                        <MessageSquare size={14} />
                                                                    </button>
                                                                    {/* Category button */}
                                                                    {config.showCategoryIcon && (
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); openCategoryModal(imageUrl, row); }}
                                                                            className="absolute top-8 right-1 p-1.5 rounded z-10 transition-all bg-purple-500 text-white opacity-100"
                                                                            title={`【媒体标签】: ${category}`}
                                                                        >
                                                                            <Tag size={14} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()
                                )}
                            </div>
                        )}

                        {/* Normal Content (when not showing favorites or category view) */}
                        {!showFavorites && !showCategoryView && (
                            (config.viewMode === 'gallery' || config.viewMode === 'tree') ? (
                                !effectiveImageColumn ? (
                                    <div className="flex items-center justify-center h-full text-slate-500">
                                        <div className="text-center max-w-sm">
                                            <Grid3X3 size={56} className="mx-auto mb-3 opacity-40" />
                                            <p className="text-lg font-semibold text-slate-600 mb-2">缩略图模式</p>
                                            <div className="bg-slate-50 rounded-lg p-4 text-left text-xs space-y-2">
                                                <p className="text-sm text-slate-500 mb-2">请在左侧配置：</p>
                                                <div className="flex items-center gap-2">
                                                    <span className="w-5 h-5 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-[10px] font-bold">1</span>
                                                    <span><strong>图片列</strong>（必填）：选择包含图片链接的列</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[10px]">2</span>
                                                    <span>分组列（可选）：用于分组显示图片</span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[10px]">3</span>
                                                    <span>显示信息（可选）：用于悬停显示和右键复制</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                ) : (
                                    /* Pure Thumbnail Grid View or Tree View */
                                    <div className="space-y-4">
                                        {/* Tree View Mode - Nested Multi-Level Grouping */}
                                        {config.viewMode === 'tree' && effectiveGroupLevels.length > 0 ? (
                                            (() => {
                                                // Build nested tree structure from effectiveGroupLevels
                                                interface TreeNode {
                                                    key: string;
                                                    label: string;
                                                    path: string;
                                                    level: number;
                                                    children: Map<string, TreeNode>;
                                                    rows: DataRow[];
                                                }

                                                const rootNode: TreeNode = {
                                                    key: 'root',
                                                    label: '根',
                                                    path: '',
                                                    level: -1,
                                                    children: new Map(),
                                                    rows: []
                                                };

                                                // Build tree structure
                                                const sortedRows = sortRowsByRules(processedRows);
                                                sortedRows.forEach(row => {
                                                    let currentNode = rootNode;
                                                    let currentPath = '';

                                                    effectiveGroupLevels.forEach((level, levelIdx) => {
                                                        const value = String(row[level.column] || '(空)');
                                                        currentPath = currentPath ? `${currentPath}/${value}` : value;

                                                        if (!currentNode.children.has(value)) {
                                                            currentNode.children.set(value, {
                                                                key: value,
                                                                label: value,
                                                                path: currentPath,
                                                                level: levelIdx,
                                                                children: new Map(),
                                                                rows: []
                                                            });
                                                        }
                                                        currentNode = currentNode.children.get(value)!;
                                                    });

                                                    // Add row to the leaf node
                                                    currentNode.rows.push(row);
                                                });

                                                // Render tree recursively
                                                const renderTreeNode = (node: TreeNode, depth: number = 0): React.ReactNode => {
                                                    const isCollapsed = collapsedTreeNodes.has(node.path);
                                                    const hasChildren = node.children.size > 0;
                                                    const hasImages = node.rows.some(r => extractImageUrl(r[effectiveImageColumn]));
                                                    const imageCount = node.rows.filter(r => extractImageUrl(r[effectiveImageColumn])).length;

                                                    // Get all descendant images count
                                                    const getDescendantImageCount = (n: TreeNode): number => {
                                                        let count = n.rows.filter(r => extractImageUrl(r[effectiveImageColumn])).length;
                                                        n.children.forEach(child => {
                                                            count += getDescendantImageCount(child);
                                                        });
                                                        return count;
                                                    };
                                                    const totalImageCount = getDescendantImageCount(node);

                                                    if (totalImageCount === 0) return null;

                                                    const levelColors = [
                                                        'bg-indigo-50 border-indigo-200 hover:bg-indigo-100',
                                                        'bg-purple-50 border-purple-200 hover:bg-purple-100',
                                                        'bg-pink-50 border-pink-200 hover:bg-pink-100',
                                                        'bg-orange-50 border-orange-200 hover:bg-orange-100',
                                                        'bg-teal-50 border-teal-200 hover:bg-teal-100',
                                                    ];
                                                    const colorClass = levelColors[depth % levelColors.length];

                                                    return (
                                                        <div key={node.path} className="group" style={{ marginLeft: depth * 16 }}>
                                                            {/* Node Header */}
                                                            <button
                                                                onClick={() => {
                                                                    const next = new Set(collapsedTreeNodes);
                                                                    if (isCollapsed) next.delete(node.path);
                                                                    else next.add(node.path);
                                                                    setCollapsedTreeNodes(next);
                                                                }}
                                                                className={`w-full flex items-center gap-2 px-3 py-2 rounded-lg border transition-all ${colorClass}`}
                                                            >
                                                                {hasChildren || hasImages ? (
                                                                    isCollapsed ? <ChevronRight size={16} /> : <ChevronDown size={16} />
                                                                ) : (
                                                                    <span className="w-4" />
                                                                )}
                                                                <FolderTree size={16} className="text-slate-500" />
                                                                <span className="font-medium text-slate-700 flex-1 text-left truncate">
                                                                    {node.label}
                                                                </span>
                                                                <span className="text-xs bg-white/80 text-slate-600 px-2 py-0.5 rounded-full">
                                                                    {totalImageCount} 张
                                                                </span>
                                                            </button>

                                                            {/* Children and Images */}
                                                            {!isCollapsed && (
                                                                <div className="mt-1 space-y-1">
                                                                    {/* Render child nodes */}
                                                                    {Array.from(node.children.values())
                                                                        .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN', { numeric: true }))
                                                                        .map(child => renderTreeNode(child, depth + 1))}

                                                                    {/* Render images at this level */}
                                                                    {hasImages && (
                                                                        <div
                                                                            className="grid gap-2 p-2 ml-4"
                                                                            style={{
                                                                                gridTemplateColumns: `repeat(auto-fill, minmax(${config.thumbnailSize}px, 1fr))`
                                                                            }}
                                                                        >
                                                                            {node.rows.map((row, idx) => {
                                                                                const imageUrl = extractImageUrl(row[effectiveImageColumn]);
                                                                                if (!imageUrl) return null;
                                                                                const rowId = String(row._rowId || '');

                                                                                return (
                                                                                    <div
                                                                                        key={rowId || `${imageUrl}-${idx}`}
                                                                                        className="relative group cursor-pointer"
                                                                                        draggable
                                                                                        onDragStart={(e) => handleThumbnailDragStart(e, imageUrl, row, rowId)}
                                                                                        onDragEnd={handleDragEnd}
                                                                                    >
                                                                                        <img
                                                                                            src={imageUrl}
                                                                                            alt=""
                                                                                            className="w-full rounded-lg object-cover border border-slate-200 hover:border-indigo-400 transition-colors"
                                                                                            style={{ aspectRatio: '1' }}
                                                                                            loading="lazy"
                                                                                            onClick={() => setSelectedImage(imageUrl)}
                                                                                        />
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                };

                                                // Render all root level children (sorted numerically)
                                                const rootChildren = Array.from(rootNode.children.values())
                                                    .sort((a, b) => a.label.localeCompare(b.label, 'zh-CN', { numeric: true }));

                                                if (rootChildren.length === 0) {
                                                    return (
                                                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                                            <FolderTree size={64} className="mb-4 opacity-30" />
                                                            <p className="text-lg font-medium">请配置多级分组</p>
                                                            <p className="text-sm mt-1">点击上方"🌳 树状视图配置"设置分组层级</p>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div className="space-y-2 p-2">
                                                        {/* Tree view controls */}
                                                        <div className="flex items-center justify-between mb-4 bg-slate-50 rounded-lg p-2">
                                                            <span className="text-sm font-medium text-slate-600 flex items-center gap-2">
                                                                <FolderTree size={16} />
                                                                树形分组视图
                                                                <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
                                                                    {effectiveGroupLevels.length} 级
                                                                </span>
                                                            </span>
                                                            <div className="flex gap-2">
                                                                <button
                                                                    onClick={() => setCollapsedTreeNodes(new Set())}
                                                                    className="px-2 py-1 text-xs text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                                                >
                                                                    全部展开
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        // Collect all node paths
                                                                        const allPaths = new Set<string>();
                                                                        const collectPaths = (node: TreeNode) => {
                                                                            if (node.path) allPaths.add(node.path);
                                                                            node.children.forEach(child => collectPaths(child));
                                                                        };
                                                                        rootNode.children.forEach(child => collectPaths(child));
                                                                        setCollapsedTreeNodes(allPaths);
                                                                    }}
                                                                    className="px-2 py-1 text-xs text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                                                >
                                                                    全部折叠
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* Render tree */}
                                                        {rootChildren.map(child => renderTreeNode(child, 0))}
                                                    </div>
                                                );
                                            })()
                                        ) : (primaryGroupColumn || effectiveGroupLevels.length > 0 || (effectiveDateBinning && effectiveDateBins.length > 0)) ? (
                                            /* Grouped thumbnail grid */
                                            (() => {
                                                // Helper to get date bin label
                                                const getDateBinLabel = (row: DataRow): string | null => {
                                                    if (!effectiveDateBinning || effectiveDateBins.length === 0 || !effectiveDateColumn) return null;
                                                    const date = parseDate(row[effectiveDateColumn]);
                                                    if (!date) return '无效日期';
                                                    const dateTime = date.getTime();
                                                    for (const bin of effectiveDateBins) {
                                                        const startTime = new Date(bin.startDate).getTime();
                                                        const endTime = new Date(bin.endDate).getTime() + 86400000 - 1;
                                                        if (dateTime >= startTime && dateTime <= endTime) {
                                                            const startD = new Date(bin.startDate);
                                                            const endD = new Date(bin.endDate);
                                                            return `${startD.getMonth() + 1}/${startD.getDate()}-${endD.getMonth() + 1}/${endD.getDate()}`;
                                                        }
                                                    }
                                                    return '其他';
                                                };

                                                // Determine if we need multi-level grouping
                                                const hasDateBinning = effectiveDateBinning && effectiveDateBins.length > 0 && effectiveDateColumn;
                                                const hasColumnGrouping = !!(primaryGroupColumn || effectiveGroupLevels.length > 0);
                                                const isMultiLevel = hasDateBinning && hasColumnGrouping;

                                                // Generate combined group key based on priority
                                                const groups = new Map<string, DataRow[]>();
                                                const sortedRows = sortRowsByRules(processedRows);

                                                sortedRows.forEach(row => {
                                                    let key: string;

                                                    // Check for classification override first
                                                    const imageUrl = extractImageUrl(row[effectiveImageColumn]);
                                                    const overrideKey = imageUrl ? classificationOverrides[imageUrl] : null;

                                                    if (overrideKey) {
                                                        // Use the override classification
                                                        key = overrideKey;
                                                    } else if (isMultiLevel) {
                                                        // Multi-level grouping
                                                        const dateLabel = getDateBinLabel(row) || '无日期';
                                                        const columnLabel = getRowGroupKey(row);

                                                        if (config.groupPriority === 'date') {
                                                            key = `${dateLabel} › ${columnLabel}`;
                                                        } else {
                                                            key = `${columnLabel} › ${dateLabel}`;
                                                        }
                                                    } else if (hasColumnGrouping) {
                                                        key = getRowGroupKey(row);
                                                    } else if (hasDateBinning) {
                                                        key = getDateBinLabel(row) || '无日期';
                                                    } else {
                                                        key = '未分组';
                                                    }

                                                    if (!groups.has(key)) groups.set(key, []);
                                                    groups.get(key)!.push(row);
                                                });

                                                let filteredGroups = Array.from(groups.entries())
                                                    .filter(([, rows]) => rows.some(r => extractImageUrl(r[effectiveImageColumn])));

                                                // Sort groups
                                                if (isMultiLevel) {
                                                    // Sort by primary grouping order, then secondary
                                                    const dateBinOrder = effectiveDateBins.map(b => {
                                                        const startD = new Date(b.startDate);
                                                        const endD = new Date(b.endDate);
                                                        return `${startD.getMonth() + 1}/${startD.getDate()}-${endD.getMonth() + 1}/${endD.getDate()}`;
                                                    });
                                                    const columnBinOrder = effectiveGroupBinning && effectiveGroupBins.length > 0
                                                        ? effectiveGroupBins.map(b => b.label)
                                                        : null;

                                                    filteredGroups = filteredGroups.sort((a, b) => {
                                                        const [aPrimary, aSecondary] = a[0].split(' › ');
                                                        const [bPrimary, bSecondary] = b[0].split(' › ');

                                                        const primaryOrder = config.groupPriority === 'date' ? dateBinOrder : columnBinOrder;
                                                        const secondaryOrder = config.groupPriority === 'date' ? columnBinOrder : dateBinOrder;

                                                        // Compare primary
                                                        let aPrimaryIdx = primaryOrder?.indexOf(aPrimary) ?? -1;
                                                        let bPrimaryIdx = primaryOrder?.indexOf(bPrimary) ?? -1;
                                                        if (aPrimaryIdx === -1) aPrimaryIdx = 9999;
                                                        if (bPrimaryIdx === -1) bPrimaryIdx = 9999;

                                                        if (aPrimaryIdx !== bPrimaryIdx) return aPrimaryIdx - bPrimaryIdx;

                                                        // Compare secondary
                                                        let aSecondaryIdx = secondaryOrder?.indexOf(aSecondary) ?? -1;
                                                        let bSecondaryIdx = secondaryOrder?.indexOf(bSecondary) ?? -1;
                                                        if (aSecondaryIdx === -1) aSecondaryIdx = 9999;
                                                        if (bSecondaryIdx === -1) bSecondaryIdx = 9999;

                                                        if (aSecondaryIdx !== bSecondaryIdx) return aSecondaryIdx - bSecondaryIdx;

                                                        return a[0].localeCompare(b[0], undefined, { numeric: true });
                                                    });
                                                } else if (effectiveGroupBinning && effectiveGroupBins.length > 0) {
                                                    const binOrder = effectiveGroupBins.map(b => b.label);
                                                    filteredGroups = filteredGroups.sort((a, b) => {
                                                        const idxA = binOrder.indexOf(a[0]);
                                                        const idxB = binOrder.indexOf(b[0]);
                                                        if (idxA === -1 && idxB === -1) return a[0].localeCompare(b[0], undefined, { numeric: true });
                                                        if (idxA === -1) return 1;
                                                        if (idxB === -1) return -1;
                                                        return idxA - idxB;
                                                    });
                                                } else if (effectiveTextGrouping && effectiveTextGroupBins.length > 0) {
                                                    // Sort by textGroupBins order
                                                    const binOrder = effectiveTextGroupBins.map(b => b.label);
                                                    filteredGroups = filteredGroups.sort((a, b) => {
                                                        const idxA = binOrder.indexOf(a[0]);
                                                        const idxB = binOrder.indexOf(b[0]);
                                                        if (idxA === -1 && idxB === -1) return a[0].localeCompare(b[0], undefined, { numeric: true });
                                                        if (idxA === -1) return 1;  // "未分组" goes to end
                                                        if (idxB === -1) return -1;
                                                        return idxA - idxB;
                                                    });
                                                } else if (hasDateBinning) {
                                                    const binOrder = effectiveDateBins.map(b => {
                                                        const startD = new Date(b.startDate);
                                                        const endD = new Date(b.endDate);
                                                        return `${startD.getMonth() + 1}/${startD.getDate()}-${endD.getMonth() + 1}/${endD.getDate()}`;
                                                    });
                                                    filteredGroups = filteredGroups.sort((a, b) => {
                                                        const idxA = binOrder.indexOf(a[0]);
                                                        const idxB = binOrder.indexOf(b[0]);
                                                        if (idxA === -1 && idxB === -1) return a[0].localeCompare(b[0], undefined, { numeric: true });
                                                        if (idxA === -1) return 1;
                                                        if (idxB === -1) return -1;
                                                        return idxA - idxB;
                                                    });
                                                } else {
                                                    // Default group sort (No binning): Sort groups alphanumerically (numeric: true)
                                                    // Respect user's sort rule direction if they have one for the group column
                                                    const groupSortRule = config.sortRules.find(r => r.column === primaryGroupColumn);

                                                    filteredGroups = filteredGroups.sort((a, b) => {
                                                        const cmp = a[0].localeCompare(b[0], 'zh-CN', { numeric: true });
                                                        return groupSortRule?.descending ? -cmp : cmp;
                                                    });
                                                }

                                                if (filteredGroups.length === 0) {
                                                    return (
                                                        <div className="flex flex-col items-center justify-center py-20 text-slate-400">
                                                            <Grid3X3 size={64} className="mb-4 opacity-30" />
                                                            <p className="text-lg font-medium">没有符合条件的图片</p>
                                                            <p className="text-sm mt-1">请调整筛选条件或清除筛选器</p>
                                                        </div>
                                                    );
                                                }

                                                // Auto-expand when there are few groups (≤5)
                                                const autoExpand = filteredGroups.length <= 5;

                                                return (
                                                    <>
                                                        {/* Classification Mode: Drop Target Bar */}
                                                        {classificationMode && (
                                                            <div className="sticky top-0 z-20 bg-purple-50 border-b-2 border-purple-200 p-3 mb-4 rounded-lg">
                                                                {/* Header Row */}
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <Layers size={16} className="text-purple-600" />
                                                                    <span className="text-sm font-medium text-purple-700">分类工作区</span>
                                                                    <span className="text-xs text-purple-500">
                                                                        {selectedForClassification.size > 0
                                                                            ? `已选择 ${selectedForClassification.size} 张`
                                                                            : '点击缩略图选择，然后拖拽到目标'}
                                                                    </span>
                                                                    <div className="ml-auto flex items-center gap-3">
                                                                        {/* Target Type Toggles */}
                                                                        <div className="flex items-center gap-2 border-r border-purple-200 pr-3">
                                                                            <span className="text-xs text-purple-600">显示:</span>
                                                                            <label className="flex items-center gap-1 cursor-pointer">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={dragTargetTypes.classification}
                                                                                    onChange={(e) => setDragTargetTypes(prev => ({ ...prev, classification: e.target.checked }))}
                                                                                    className="w-3.5 h-3.5 text-purple-600 rounded focus:ring-purple-500"
                                                                                />
                                                                                <span className="text-xs text-slate-600">分组</span>
                                                                            </label>
                                                                            <label className="flex items-center gap-1 cursor-pointer">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={dragTargetTypes.favorites}
                                                                                    onChange={(e) => setDragTargetTypes(prev => ({ ...prev, favorites: e.target.checked }))}
                                                                                    className="w-3.5 h-3.5 text-amber-500 rounded focus:ring-amber-500"
                                                                                />
                                                                                <span className="text-xs text-slate-600">收藏</span>
                                                                            </label>
                                                                            <label className="flex items-center gap-1 cursor-pointer">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={dragTargetTypes.tags}
                                                                                    onChange={(e) => setDragTargetTypes(prev => ({ ...prev, tags: e.target.checked }))}
                                                                                    className="w-3.5 h-3.5 text-blue-500 rounded focus:ring-blue-500"
                                                                                />
                                                                                <span className="text-xs text-slate-600">标签</span>
                                                                            </label>
                                                                        </div>
                                                                        {/* Sync Toggle */}
                                                                        <label className="flex items-center gap-1.5 cursor-pointer">
                                                                            <input
                                                                                type="checkbox"
                                                                                checked={syncToSheet}
                                                                                onChange={(e) => {
                                                                                    const checked = e.target.checked;
                                                                                    if (checked) {
                                                                                        if (!sourceUrl) {
                                                                                            alert('要同步到表格，数据源必须来自 Google Sheets。\\n\\n请通过"加载 Google Sheets"功能导入数据，而不是粘贴。');
                                                                                            return;
                                                                                        }
                                                                                        if (!isUserLoggedIn()) {
                                                                                            alert('要同步到表格，请先登录 Google 账号。');
                                                                                            return;
                                                                                        }
                                                                                    }
                                                                                    setSyncToSheet(checked);
                                                                                }}
                                                                                className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                                                                            />
                                                                            <span className={`text-xs ${syncToSheet ? 'text-purple-700 font-medium' : 'text-slate-500'}`}>
                                                                                同步到表格
                                                                            </span>
                                                                        </label>
                                                                        {syncToSheet && sourceUrl && (
                                                                            <span className="text-xs text-green-600">✓ 已连接</span>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* Classification Groups Row */}
                                                                {dragTargetTypes.classification && (
                                                                    <div className="flex flex-wrap gap-2 mb-2">
                                                                        <span className="text-xs text-purple-600 font-medium self-center mr-1"><FolderOpen size={12} className="inline mr-1" /> 分组:</span>
                                                                        {/* 当没有分组列时，使用 categoryOptions 作为分组目标 */}
                                                                        {!primaryGroupColumn && !hasDateBinning ? (
                                                                            config.categoryOptions.length > 0 ? (
                                                                                config.categoryOptions.map((option) => (
                                                                                    <div
                                                                                        key={option}
                                                                                        onDragOver={(e) => {
                                                                                            e.preventDefault();
                                                                                            setDragOverGroup(option);
                                                                                        }}
                                                                                        onDragLeave={() => setDragOverGroup(null)}
                                                                                        onDrop={async (e) => {
                                                                                            e.preventDefault();
                                                                                            setDragOverGroup(null);
                                                                                            if (draggedItems.length > 0) {
                                                                                                await handleClassificationChange(draggedItems, option);
                                                                                            }
                                                                                        }}
                                                                                        className={`px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed cursor-pointer transition-all ${dragOverGroup === option
                                                                                            ? 'bg-purple-200 border-purple-500 text-purple-800 scale-105'
                                                                                            : 'bg-white border-purple-300 text-purple-700 hover:bg-purple-100'
                                                                                            }`}
                                                                                        title="拖拽图片到此分类"
                                                                                    >
                                                                                        {option}
                                                                                    </div>
                                                                                ))
                                                                            ) : (
                                                                                <span className="text-xs text-amber-600"><AlertCircle size={12} className="inline mr-1" /> 请先在「媒体标签」设置中添加分类选项</span>
                                                                            )
                                                                        ) : (
                                                                            filteredGroups.map(([targetGroup]) => (
                                                                                <div
                                                                                    key={targetGroup}
                                                                                    onDragOver={(e) => {
                                                                                        e.preventDefault();
                                                                                        setDragOverGroup(targetGroup);
                                                                                    }}
                                                                                    onDragLeave={() => setDragOverGroup(null)}
                                                                                    onDrop={async (e) => {
                                                                                        e.preventDefault();
                                                                                        setDragOverGroup(null);
                                                                                        // Handle drop - 允许分类即使没有分组列（使用 classificationOverrides）
                                                                                        if (draggedItems.length > 0) {
                                                                                            await handleClassificationChange(draggedItems, targetGroup);
                                                                                        }
                                                                                    }}
                                                                                    onClick={() => {
                                                                                        // Scroll to group section
                                                                                        const groupElement = document.querySelector(`[data-group-key="${targetGroup}"]`);
                                                                                        if (groupElement) {
                                                                                            groupElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                                                                                            // Expand if collapsed
                                                                                            setCollapsedGalleryGroups(prev => {
                                                                                                const next = new Set(prev);
                                                                                                next.delete(targetGroup);
                                                                                                return next;
                                                                                            });
                                                                                        }
                                                                                    }}
                                                                                    className={`px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed cursor-pointer transition-all ${dragOverGroup === targetGroup
                                                                                        ? 'bg-purple-200 border-purple-500 text-purple-800 scale-105'
                                                                                        : 'bg-white border-purple-300 text-purple-700 hover:bg-purple-100'
                                                                                        }`}
                                                                                    title="点击跳转到该分组，拖拽图片到此改变分类"
                                                                                >
                                                                                    {targetGroup}
                                                                                    <span className="ml-1 text-xs opacity-70">
                                                                                        ({filteredGroups.find(g => g[0] === targetGroup)?.[1].length || 0})
                                                                                    </span>
                                                                                </div>
                                                                            ))
                                                                        )}
                                                                        {/* Custom groups added by user - 双击编辑名称 */}
                                                                        {customGroups.map((customGroup, groupIdx) => (
                                                                            editingCustomGroup?.index === groupIdx ? (
                                                                                <div key={`custom-edit-${groupIdx}`} className="flex items-center gap-1">
                                                                                    <input
                                                                                        type="text"
                                                                                        value={editingCustomGroup.value}
                                                                                        onChange={(e) => setEditingCustomGroup({ index: groupIdx, value: e.target.value })}
                                                                                        onKeyDown={(e) => {
                                                                                            if (e.key === 'Enter' && editingCustomGroup.value.trim()) {
                                                                                                const newName = editingCustomGroup.value.trim();
                                                                                                const oldName = customGroup;
                                                                                                setCustomGroups(prev => prev.map((g, i) => i === groupIdx ? newName : g));
                                                                                                setClassificationOverrides(prev => {
                                                                                                    const updated: Record<string, string> = {};
                                                                                                    Object.entries(prev).forEach(([key, val]) => {
                                                                                                        updated[key] = val === oldName ? newName : val;
                                                                                                    });
                                                                                                    return updated;
                                                                                                });
                                                                                                setEditingCustomGroup(null);
                                                                                            } else if (e.key === 'Escape') {
                                                                                                setEditingCustomGroup(null);
                                                                                            }
                                                                                        }}
                                                                                        onBlur={() => {
                                                                                            if (editingCustomGroup.value.trim() && editingCustomGroup.value.trim() !== customGroup) {
                                                                                                const newName = editingCustomGroup.value.trim();
                                                                                                const oldName = customGroup;
                                                                                                setCustomGroups(prev => prev.map((g, i) => i === groupIdx ? newName : g));
                                                                                                setClassificationOverrides(prev => {
                                                                                                    const updated: Record<string, string> = {};
                                                                                                    Object.entries(prev).forEach(([key, val]) => {
                                                                                                        updated[key] = val === oldName ? newName : val;
                                                                                                    });
                                                                                                    return updated;
                                                                                                });
                                                                                            }
                                                                                            setEditingCustomGroup(null);
                                                                                        }}
                                                                                        autoFocus
                                                                                        className="px-2 py-1 text-sm border border-green-400 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 w-28"
                                                                                    />
                                                                                    {/* 排序按钮 */}
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            if (groupIdx > 0) {
                                                                                                setCustomGroups(prev => {
                                                                                                    const newArr = [...prev];
                                                                                                    [newArr[groupIdx - 1], newArr[groupIdx]] = [newArr[groupIdx], newArr[groupIdx - 1]];
                                                                                                    return newArr;
                                                                                                });
                                                                                                setEditingCustomGroup({ index: groupIdx - 1, value: editingCustomGroup.value });
                                                                                            }
                                                                                        }}
                                                                                        disabled={groupIdx === 0}
                                                                                        className={`p-1 rounded ${groupIdx === 0 ? 'text-slate-300 cursor-not-allowed' : 'text-green-600 hover:bg-green-100'}`}
                                                                                        title="上移"
                                                                                    >
                                                                                        ▲
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            if (groupIdx < customGroups.length - 1) {
                                                                                                setCustomGroups(prev => {
                                                                                                    const newArr = [...prev];
                                                                                                    [newArr[groupIdx], newArr[groupIdx + 1]] = [newArr[groupIdx + 1], newArr[groupIdx]];
                                                                                                    return newArr;
                                                                                                });
                                                                                                setEditingCustomGroup({ index: groupIdx + 1, value: editingCustomGroup.value });
                                                                                            }
                                                                                        }}
                                                                                        disabled={groupIdx === customGroups.length - 1}
                                                                                        className={`p-1 rounded ${groupIdx === customGroups.length - 1 ? 'text-slate-300 cursor-not-allowed' : 'text-green-600 hover:bg-green-100'}`}
                                                                                        title="下移"
                                                                                    >
                                                                                        ▼
                                                                                    </button>
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            if (confirm(`删除分组 "${customGroup}"？`)) {
                                                                                                setCustomGroups(prev => prev.filter((_, i) => i !== groupIdx));
                                                                                                setEditingCustomGroup(null);
                                                                                            }
                                                                                        }}
                                                                                        className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded"
                                                                                        title="删除分组"
                                                                                    >
                                                                                        ✕
                                                                                    </button>
                                                                                </div>
                                                                            ) : (
                                                                                <div
                                                                                    key={`custom-${customGroup}`}
                                                                                    draggable
                                                                                    onDragStart={(e) => {
                                                                                        // 标记为分组拖拽（用于区分图片拖拽）
                                                                                        e.dataTransfer.setData('groupReorder', groupIdx.toString());
                                                                                        setDraggingGroupIdx(groupIdx);
                                                                                    }}
                                                                                    onDragEnd={() => setDraggingGroupIdx(null)}
                                                                                    onDragOver={(e) => {
                                                                                        e.preventDefault();
                                                                                        // 如果是分组拖拽（重排序），设置不同的视觉反馈
                                                                                        if (draggingGroupIdx !== null && draggingGroupIdx !== groupIdx) {
                                                                                            setDragOverGroup(customGroup);
                                                                                        } else if (draggedItems.length > 0) {
                                                                                            // 图片拖入分组
                                                                                            setDragOverGroup(customGroup);
                                                                                        }
                                                                                    }}
                                                                                    onDragLeave={() => setDragOverGroup(null)}
                                                                                    onDrop={async (e) => {
                                                                                        e.preventDefault();
                                                                                        setDragOverGroup(null);

                                                                                        // 检查是否是分组重排序
                                                                                        const reorderData = e.dataTransfer.getData('groupReorder');
                                                                                        if (reorderData && draggingGroupIdx !== null) {
                                                                                            const fromIdx = parseInt(reorderData, 10);
                                                                                            const toIdx = groupIdx;
                                                                                            if (fromIdx !== toIdx) {
                                                                                                setCustomGroups(prev => {
                                                                                                    const newArr = [...prev];
                                                                                                    const [removed] = newArr.splice(fromIdx, 1);
                                                                                                    newArr.splice(toIdx, 0, removed);
                                                                                                    return newArr;
                                                                                                });
                                                                                            }
                                                                                            setDraggingGroupIdx(null);
                                                                                            return;
                                                                                        }

                                                                                        // 图片分类
                                                                                        if (draggedItems.length > 0) {
                                                                                            await handleClassificationChange(draggedItems, customGroup);
                                                                                        }
                                                                                    }}
                                                                                    onDoubleClick={() => setEditingCustomGroup({ index: groupIdx, value: customGroup })}
                                                                                    className={`px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed cursor-grab transition-all ${draggingGroupIdx === groupIdx
                                                                                        ? 'opacity-50 bg-green-100 border-green-400'
                                                                                        : dragOverGroup === customGroup
                                                                                            ? draggingGroupIdx !== null
                                                                                                ? 'bg-yellow-200 border-yellow-500 text-yellow-800 scale-105' // 分组重排序
                                                                                                : 'bg-green-200 border-green-500 text-green-800 scale-105'   // 图片拖入
                                                                                            : 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                                                                                        }`}
                                                                                    title="双击编辑 | 拖拽调整顺序"
                                                                                >
                                                                                    ✨ {customGroup}
                                                                                </div>
                                                                            )
                                                                        ))}
                                                                        {/* Add new group button/input */}
                                                                        {showNewGroupInput ? (
                                                                            <div className="flex items-center gap-1">
                                                                                <input
                                                                                    type="text"
                                                                                    value={newGroupInput}
                                                                                    onChange={(e) => setNewGroupInput(e.target.value)}
                                                                                    onKeyDown={(e) => {
                                                                                        if (e.key === 'Enter' && newGroupInput.trim()) {
                                                                                            setCustomGroups([...customGroups, newGroupInput.trim()]);
                                                                                            setNewGroupInput('');
                                                                                            setShowNewGroupInput(false);
                                                                                        } else if (e.key === 'Escape') {
                                                                                            setShowNewGroupInput(false);
                                                                                            setNewGroupInput('');
                                                                                        }
                                                                                    }}
                                                                                    autoFocus
                                                                                    placeholder="输入新分组名..."
                                                                                    className="px-2 py-1 text-sm border border-purple-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-400 w-32"
                                                                                />
                                                                                <button
                                                                                    onClick={() => {
                                                                                        if (newGroupInput.trim()) {
                                                                                            setCustomGroups([...customGroups, newGroupInput.trim()]);
                                                                                            setNewGroupInput('');
                                                                                            setShowNewGroupInput(false);
                                                                                        }
                                                                                    }}
                                                                                    className="px-2 py-1 text-sm bg-purple-500 text-white rounded-lg hover:bg-purple-600"
                                                                                >
                                                                                    添加
                                                                                </button>
                                                                                <button
                                                                                    onClick={() => {
                                                                                        setShowNewGroupInput(false);
                                                                                        setNewGroupInput('');
                                                                                    }}
                                                                                    className="px-2 py-1 text-sm text-slate-500 hover:text-slate-700"
                                                                                >
                                                                                    ✕
                                                                                </button>
                                                                            </div>
                                                                        ) : (
                                                                            <button
                                                                                onClick={() => setShowNewGroupInput(true)}
                                                                                className="px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed border-purple-300 text-purple-600 hover:bg-purple-50 hover:border-purple-400 transition-colors flex items-center gap-1"
                                                                                title="添加新分组"
                                                                            >
                                                                                <Plus size={14} />
                                                                                新分组
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {/* Favorites Drop Zone Row */}
                                                                {dragTargetTypes.favorites && (
                                                                    <div className="flex flex-wrap gap-2 mb-2">
                                                                        <span className="text-xs text-amber-600 font-medium self-center mr-1"><Star size={12} className="inline mr-1" /> 收藏:</span>
                                                                        {favoriteFolders.map(folder => {
                                                                            const folderCount = favorites.filter(f => f.folderId === folder.id || (!f.folderId && folder.id === favoriteFolders[0]?.id)).length;
                                                                            return (
                                                                                <div
                                                                                    key={folder.id}
                                                                                    onDragOver={(e) => {
                                                                                        e.preventDefault();
                                                                                        setDragOverFavoriteFolder(folder.id);
                                                                                    }}
                                                                                    onDragLeave={() => setDragOverFavoriteFolder(null)}
                                                                                    onDrop={(e) => {
                                                                                        e.preventDefault();
                                                                                        setDragOverFavoriteFolder(null);
                                                                                        // Handle drop from classification mode using draggedItems
                                                                                        if (draggedItems.length > 0) {
                                                                                            // Collect all image URLs to add - use processedRows since _rowId is added there
                                                                                            const imageUrlsToAdd: { url: string; row: DataRow }[] = [];
                                                                                            draggedItems.forEach((rowId) => {
                                                                                                const row = processedRows.find(r => String(r._rowId) === rowId);
                                                                                                if (row) {
                                                                                                    const imgUrl = extractImageUrl(row[effectiveImageColumn]);
                                                                                                    if (imgUrl) {
                                                                                                        imageUrlsToAdd.push({ url: imgUrl, row });
                                                                                                    }
                                                                                                }
                                                                                            });

                                                                                            if (imageUrlsToAdd.length > 0) {
                                                                                                // Use functional update to get latest favorites state
                                                                                                setFavorites(prev => {
                                                                                                    const existingUrls = new Set(prev.map(f => f.imageUrl));
                                                                                                    const newFavorites: FavoriteItem[] = [];

                                                                                                    // Add new items that don't exist yet
                                                                                                    imageUrlsToAdd.forEach((item, idx) => {
                                                                                                        if (!existingUrls.has(item.url)) {
                                                                                                            newFavorites.push({
                                                                                                                id: `fav-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${idx}`,
                                                                                                                imageUrl: item.url,
                                                                                                                rowData: item.row,
                                                                                                                addedAt: Date.now(),
                                                                                                                folderId: folder.id
                                                                                                            });
                                                                                                        }
                                                                                                    });

                                                                                                    // Move existing items to target folder
                                                                                                    const updated = prev.map(f =>
                                                                                                        imageUrlsToAdd.some(item => item.url === f.imageUrl)
                                                                                                            ? { ...f, folderId: folder.id }
                                                                                                            : f
                                                                                                    );

                                                                                                    return [...newFavorites, ...updated];
                                                                                                });

                                                                                                setCopyFeedback(`✅ 已添加 ${imageUrlsToAdd.length} 张图片到「${folder.name}」`);
                                                                                                setTimeout(() => setCopyFeedback(null), 2000);
                                                                                            }

                                                                                            setDraggedItems([]);
                                                                                            // Keep selection so user can retry if needed
                                                                                        } else {
                                                                                            // Fallback to handleDropToFolder for other drag sources
                                                                                            handleDropToFolder(e, folder.id);
                                                                                        }
                                                                                    }}
                                                                                    onClick={() => {
                                                                                        // Show tip about favorites
                                                                                        setCopyFeedback('⭐ 拖拽图片到收藏夹，或点击左侧「⭐ 收藏夹」查看');
                                                                                        setTimeout(() => setCopyFeedback(null), 2000);
                                                                                    }}
                                                                                    className={`px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed cursor-pointer transition-all ${dragOverFavoriteFolder === folder.id
                                                                                        ? 'bg-amber-200 border-amber-500 text-amber-800 scale-105'
                                                                                        : 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                                                                                        }`}
                                                                                    title="点击切换收藏夹视图，拖拽添加收藏"
                                                                                >
                                                                                    ❤️ {folder.name}
                                                                                    <span className="ml-1 text-xs opacity-70">({folderCount})</span>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        <button
                                                                            onClick={() => {
                                                                                setFavoriteFolders(prev => [...prev, {
                                                                                    id: Date.now().toString(),
                                                                                    name: '收藏夹 ' + (prev.length + 1),
                                                                                    createdAt: Date.now()
                                                                                }]);
                                                                            }}
                                                                            className="px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed border-amber-300 text-amber-600 hover:bg-amber-50 hover:border-amber-400 transition-colors flex items-center gap-1"
                                                                            title="添加新收藏夹"
                                                                        >
                                                                            <Plus size={14} />
                                                                            新收藏
                                                                        </button>
                                                                    </div>
                                                                )}

                                                                {/* Tags Drop Zone Row */}
                                                                {dragTargetTypes.tags && (
                                                                    <div className="flex flex-wrap gap-2">
                                                                        <span className="text-xs text-blue-600 font-medium self-center mr-1"><Tag size={12} className="inline mr-1" /> 标签:</span>
                                                                        {config.categoryOptions.filter(c => c.trim()).map(category => {
                                                                            const tagCount = Array.from(galleryCategories.entries()).filter(([, cat]) => cat === category).length;
                                                                            return (
                                                                                <div
                                                                                    key={category}
                                                                                    onDragOver={(e) => {
                                                                                        e.preventDefault();
                                                                                        setDragOverGroup(`tag:${category}`);
                                                                                    }}
                                                                                    onDragLeave={() => setDragOverGroup(null)}
                                                                                    onDrop={(e) => {
                                                                                        e.preventDefault();
                                                                                        setDragOverGroup(null);
                                                                                        // Add category to dragged images
                                                                                        if (draggedItems.length > 0) {
                                                                                            // Collect all image URLs first
                                                                                            const imageUrlsToTag: string[] = [];
                                                                                            draggedItems.forEach(rowId => {
                                                                                                const row = processedRows.find(r => String(r._rowId) === rowId);
                                                                                                if (row) {
                                                                                                    const imgUrl = extractImageUrl(row[effectiveImageColumn]);
                                                                                                    if (imgUrl) {
                                                                                                        imageUrlsToTag.push(imgUrl);
                                                                                                    }
                                                                                                }
                                                                                            });

                                                                                            if (imageUrlsToTag.length > 0) {
                                                                                                // Batch update all categories at once
                                                                                                setGalleryCategories(prev => {
                                                                                                    const newMap = new Map(prev);
                                                                                                    imageUrlsToTag.forEach(url => {
                                                                                                        newMap.set(url, category);
                                                                                                    });
                                                                                                    return newMap;
                                                                                                });

                                                                                                setCopyFeedback(`✅ 已为 ${imageUrlsToTag.length} 张图片添加标签 "${category}"`);
                                                                                                setTimeout(() => setCopyFeedback(null), 2000);
                                                                                            }

                                                                                            setDraggedItems([]);
                                                                                            // Keep selection so user can retry if needed
                                                                                        }
                                                                                    }}
                                                                                    onClick={() => {
                                                                                        // Show tip about media tags
                                                                                        setCopyFeedback('🏷️ 拖拽图片到标签，或点击左侧「🏷️ 媒体标签」查看');
                                                                                        setTimeout(() => setCopyFeedback(null), 2000);
                                                                                    }}
                                                                                    className={`px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed cursor-pointer transition-all ${dragOverGroup === `tag:${category}`
                                                                                        ? 'bg-blue-200 border-blue-500 text-blue-800 scale-105'
                                                                                        : 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100'
                                                                                        }`}
                                                                                    title="点击切换媒体标签视图，拖拽添加标签"
                                                                                >
                                                                                    <Tag size={10} className="inline mr-1" /> {category}
                                                                                    <span className="ml-1 text-xs opacity-70">({tagCount})</span>
                                                                                </div>
                                                                            );
                                                                        })}
                                                                        {/* Add new tag button */}
                                                                        <button
                                                                            onClick={() => {
                                                                                const newTag = prompt('输入新标签名称:');
                                                                                if (newTag && newTag.trim() && !config.categoryOptions.includes(newTag.trim())) {
                                                                                    updateConfig({ categoryOptions: [...config.categoryOptions, newTag.trim()] });
                                                                                }
                                                                            }}
                                                                            className="px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 hover:border-blue-400 transition-colors flex items-center gap-1"
                                                                            title="添加新标签"
                                                                        >
                                                                            <Plus size={14} />
                                                                            新标签
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        {filteredGroups.map(([groupKey, rows]) => {
                                                            // Default is expanded, collapsed only if in collapsedGalleryGroups set
                                                            const isExpanded = !collapsedGalleryGroups.has(groupKey);
                                                            const imageCount = rows.filter(r => extractImageUrl(r[effectiveImageColumn])).length;

                                                            return (
                                                                <div key={groupKey} data-group-key={groupKey} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                                                    <div className="w-full px-4 py-3 flex items-center justify-between bg-gradient-to-r from-purple-50 to-white">
                                                                        <div className="flex items-center gap-3 flex-1 min-w-0">
                                                                            <button
                                                                                onClick={() => {
                                                                                    const next = new Set(collapsedGalleryGroups);
                                                                                    if (isExpanded) next.add(groupKey);  // Collapse
                                                                                    else next.delete(groupKey);          // Expand
                                                                                    setCollapsedGalleryGroups(next);
                                                                                }}
                                                                                className="flex items-center gap-2 hover:bg-purple-100 rounded px-1 py-0.5 transition-colors"
                                                                            >
                                                                                {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                                                <span className="font-semibold text-slate-800">{groupKey}</span>
                                                                            </button>
                                                                            <span className="text-xs text-slate-500 bg-slate-100 px-2 py-0.5 rounded-full flex-shrink-0">{imageCount} 张</span>
                                                                            {/* Group note - inline display and edit */}
                                                                            {editingGroupNote === groupKey ? (
                                                                                <div className="flex items-center gap-2 flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
                                                                                    <input
                                                                                        type="text"
                                                                                        value={editingGroupNoteValue}
                                                                                        onChange={(e) => setEditingGroupNoteValue(e.target.value)}
                                                                                        onKeyDown={(e) => {
                                                                                            if (e.key === 'Enter') {
                                                                                                setConfig(prev => ({
                                                                                                    ...prev,
                                                                                                    groupNotes: {
                                                                                                        ...prev.groupNotes,
                                                                                                        [groupKey]: editingGroupNoteValue.trim()
                                                                                                    }
                                                                                                }));
                                                                                                setEditingGroupNote(null);
                                                                                            } else if (e.key === 'Escape') {
                                                                                                setEditingGroupNote(null);
                                                                                            }
                                                                                        }}
                                                                                        onBlur={() => {
                                                                                            setConfig(prev => ({
                                                                                                ...prev,
                                                                                                groupNotes: {
                                                                                                    ...prev.groupNotes,
                                                                                                    [groupKey]: editingGroupNoteValue.trim()
                                                                                                }
                                                                                            }));
                                                                                            setEditingGroupNote(null);
                                                                                        }}
                                                                                        placeholder="输入备注..."
                                                                                        className="flex-1 min-w-0 px-2 py-1 text-sm border border-purple-300 rounded focus:outline-none focus:ring-2 focus:ring-purple-400 bg-white"
                                                                                        autoFocus
                                                                                    />
                                                                                </div>
                                                                            ) : (
                                                                                <button
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        setEditingGroupNote(groupKey);
                                                                                        setEditingGroupNoteValue(config.groupNotes?.[groupKey] || '');
                                                                                    }}
                                                                                    className="flex items-center gap-1 text-base hover:bg-purple-100 px-3 py-1 rounded transition-colors max-w-[400px]"
                                                                                    title={config.groupNotes?.[groupKey] ? '点击编辑备注' : '点击添加备注'}
                                                                                >
                                                                                    {config.groupNotes?.[groupKey] ? (
                                                                                        <span className="text-slate-700 font-medium">— {config.groupNotes[groupKey]}</span>
                                                                                    ) : (
                                                                                        <span className="text-slate-400 text-sm">+ 添加备注</span>
                                                                                    )}
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                        <button
                                                                            onClick={() => {
                                                                                const next = new Set(collapsedGalleryGroups);
                                                                                if (isExpanded) next.add(groupKey);
                                                                                else next.delete(groupKey);
                                                                                setCollapsedGalleryGroups(next);
                                                                            }}
                                                                            className="text-xs text-slate-400 hover:text-slate-600 flex-shrink-0"
                                                                        >
                                                                            {isExpanded ? '点击折叠' : '点击展开'}
                                                                        </button>
                                                                    </div>
                                                                    {isExpanded && (() => {
                                                                        const allGroupRows = rows.filter(row => extractImageUrl(row[effectiveImageColumn]));
                                                                        const pageSize = config.galleryPageSize;

                                                                        // -1 = progressive loading, 0 = all, positive = pagination
                                                                        let displayRows: typeof allGroupRows;
                                                                        let showLoadMore = false;
                                                                        let loadedCount = 0;
                                                                        let totalCount = allGroupRows.length;

                                                                        if (pageSize > 0) {
                                                                            // Pagination mode
                                                                            const currentPage = groupPages[groupKey] || 1;
                                                                            const totalPages = Math.max(1, Math.ceil(allGroupRows.length / pageSize));
                                                                            const actualPage = Math.max(1, Math.min(currentPage, totalPages));
                                                                            displayRows = allGroupRows.slice((actualPage - 1) * pageSize, actualPage * pageSize);
                                                                        } else if (pageSize === -1) {
                                                                            // Progressive loading mode
                                                                            loadedCount = groupLoadedCount[groupKey] || INITIAL_LOAD_COUNT;
                                                                            displayRows = allGroupRows.slice(0, loadedCount);
                                                                            showLoadMore = loadedCount < allGroupRows.length;
                                                                        } else {
                                                                            // All mode (pageSize === 0)
                                                                            displayRows = allGroupRows;
                                                                        }

                                                                        return (
                                                                            <div className="p-4">
                                                                                {/* Progressive loading info - show when in progressive loading mode */}
                                                                                {pageSize === -1 && allGroupRows.length > INITIAL_LOAD_COUNT && (
                                                                                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
                                                                                        <span className="text-xs text-slate-600 font-medium">
                                                                                            已加载 {Math.min(groupLoadedCount[groupKey] || INITIAL_LOAD_COUNT, allGroupRows.length)} / {allGroupRows.length} 张 (滚动加载更多)
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                                <div className="flex flex-wrap gap-2">
                                                                                    {(() => {
                                                                                        // Apply custom order if exists
                                                                                        const allImageUrls = displayRows.map(r => extractImageUrl(r[effectiveImageColumn])!);
                                                                                        const customOrder = customOrderByGroup[groupKey];
                                                                                        let orderedRows = displayRows;
                                                                                        if (customOrder && customOrder.length > 0) {
                                                                                            // Sort by custom order, items not in order go to end
                                                                                            orderedRows = [...displayRows].sort((a, b) => {
                                                                                                const urlA = extractImageUrl(a[effectiveImageColumn])!;
                                                                                                const urlB = extractImageUrl(b[effectiveImageColumn])!;
                                                                                                const idxA = customOrder.indexOf(urlA);
                                                                                                const idxB = customOrder.indexOf(urlB);
                                                                                                if (idxA === -1 && idxB === -1) return 0;
                                                                                                if (idxA === -1) return 1;
                                                                                                if (idxB === -1) return -1;
                                                                                                return idxA - idxB;
                                                                                            });
                                                                                        }

                                                                                        return orderedRows.map((row, idx) => {
                                                                                            const imageUrl = extractImageUrl(row[effectiveImageColumn])!;
                                                                                            const linkUrl = effectiveLinkColumn ? String(row[effectiveLinkColumn] || '') : '';
                                                                                            const rowId = String(row._rowId || '');
                                                                                            const labelValues = effectiveLabelColumns
                                                                                                .map(col => String(row[col] ?? '').trim())
                                                                                                .filter(Boolean);
                                                                                            const isReorderTarget = reorderDropTarget?.group === groupKey && reorderDropTarget?.index === idx;
                                                                                            const isBeingDragged = reorderDragItem === imageUrl;

                                                                                            return (
                                                                                                <div key={rowId || `${imageUrl}-${idx}`} className="flex flex-col relative">
                                                                                                    {/* Reorder drop indicator - left side */}
                                                                                                    {classificationMode && isReorderTarget && (
                                                                                                        <div className="absolute -left-1 top-0 bottom-0 w-1 bg-purple-500 rounded-full z-20" />
                                                                                                    )}
                                                                                                    <div
                                                                                                        className={`relative group cursor-pointer ${gallerySelectMode && selectedThumbnails.has(rowId) ? 'ring-2 ring-blue-500 ring-offset-1 rounded-lg' : ''} ${classificationMode && selectedForClassification.has(rowId) ? 'ring-2 ring-purple-500 ring-offset-1 rounded-lg' : ''} ${isBeingDragged ? 'opacity-50' : ''} ${isDraggingImage ? 'cursor-grabbing' : 'cursor-grab'}`}
                                                                                                        draggable={classificationMode || !gallerySelectMode || selectedThumbnails.has(rowId)}
                                                                                                        onDragStart={(e) => {
                                                                                                            if (gallerySelectMode && !selectedThumbnails.has(rowId) && !classificationMode) return;
                                                                                                            // For reorder within group
                                                                                                            if (classificationMode) {
                                                                                                                setReorderDragItem(imageUrl);
                                                                                                            }
                                                                                                            handleThumbnailDragStart(e, imageUrl, row, rowId);
                                                                                                        }}
                                                                                                        onDragEnd={() => {
                                                                                                            handleDragEnd();
                                                                                                            setReorderDragItem(null);
                                                                                                            setReorderDropTarget(null);
                                                                                                        }}
                                                                                                        onDragOver={(e) => {
                                                                                                            if (!classificationMode || !reorderDragItem || reorderDragItem === imageUrl) return;
                                                                                                            e.preventDefault();
                                                                                                            // Only update if target changed to prevent re-renders
                                                                                                            if (reorderDropTarget?.group !== groupKey || reorderDropTarget?.index !== idx) {
                                                                                                                setReorderDropTarget({ group: groupKey, index: idx });
                                                                                                            }
                                                                                                        }}
                                                                                                        onDragLeave={() => {
                                                                                                            if (reorderDropTarget?.group === groupKey && reorderDropTarget?.index === idx) {
                                                                                                                setReorderDropTarget(null);
                                                                                                            }
                                                                                                        }}
                                                                                                        onDrop={async (e) => {
                                                                                                            if (!classificationMode || !reorderDragItem) return;
                                                                                                            e.preventDefault();
                                                                                                            e.stopPropagation();
                                                                                                            // Handle reorder within this group
                                                                                                            await handleReorderDrop(groupKey, reorderDragItem, idx, allImageUrls);
                                                                                                        }}
                                                                                                        onDoubleClick={(e) => {
                                                                                                            if (!effectiveLinkColumn) {
                                                                                                                setFloatingTip({ text: '⚠️ 请先指定链接列', x: e.clientX, y: e.clientY });
                                                                                                                setTimeout(() => setFloatingTip(null), 2000);
                                                                                                            } else if (linkUrl) {
                                                                                                                openExternalUrl(linkUrl);
                                                                                                            }
                                                                                                        }}
                                                                                                        onClick={(e) => {
                                                                                                            if ((e.target as HTMLElement).closest('button')) return;
                                                                                                            // Classification mode: toggle selection for classification
                                                                                                            if (classificationMode) {
                                                                                                                setSelectedForClassification(prev => {
                                                                                                                    const newSet = new Set(prev);
                                                                                                                    if (newSet.has(rowId)) {
                                                                                                                        newSet.delete(rowId);
                                                                                                                    } else {
                                                                                                                        newSet.add(rowId);
                                                                                                                    }
                                                                                                                    return newSet;
                                                                                                                });
                                                                                                                return;
                                                                                                            }
                                                                                                            // Gallery select mode
                                                                                                            if (!gallerySelectMode) return;
                                                                                                            scheduleThumbnailSelect(rowId);
                                                                                                        }}
                                                                                                        onMouseEnter={(e) => handleThumbnailMouseEnter(imageUrl, e)}
                                                                                                        onMouseLeave={handleThumbnailMouseLeave}
                                                                                                        onContextMenu={(e) => handleContextMenu(e, row, imageUrl)}
                                                                                                        title={classificationMode ? '点击选择，拖拽到目标分组' : (linkUrl ? '双击打开链接 · 右键菜单 · 拖拽到收藏夹' : '右键菜单 · 拖拽到收藏夹')}
                                                                                                    >
                                                                                                        <img
                                                                                                            src={imageUrl}
                                                                                                            alt=""
                                                                                                            draggable={!gallerySelectMode || selectedThumbnails.has(rowId)}
                                                                                                            onDragStart={(e) => {
                                                                                                                if (gallerySelectMode && !selectedThumbnails.has(rowId)) return;
                                                                                                                e.stopPropagation();
                                                                                                                // For reorder within group in classification mode
                                                                                                                if (classificationMode) {
                                                                                                                    setReorderDragItem(imageUrl);
                                                                                                                }
                                                                                                                handleThumbnailDragStart(e, imageUrl, row, rowId);
                                                                                                            }}
                                                                                                            onDragEnd={(e) => {
                                                                                                                e.stopPropagation();
                                                                                                                handleDragEnd();
                                                                                                            }}
                                                                                                            className={`${config.thumbnailFit === 'contain' ? 'object-contain' : 'object-cover'} rounded-lg transition-all ${gallerySelectMode && selectedThumbnails.has(rowId) ? 'brightness-50 saturate-50' : 'group-hover:scale-105'}`}
                                                                                                            style={{
                                                                                                                width: config.thumbnailSize,
                                                                                                                height: config.thumbnailSize,
                                                                                                                backgroundColor: config.thumbnailFit === 'contain' ? '#f1f5f9' : undefined
                                                                                                            }}
                                                                                                            loading="lazy"
                                                                                                        />
                                                                                                        {/* Blue overlay for selected items in gallery select mode */}
                                                                                                        {gallerySelectMode && selectedThumbnails.has(rowId) && (
                                                                                                            <div className="absolute inset-0 bg-blue-500/30 rounded-lg pointer-events-none" />
                                                                                                        )}
                                                                                                        {/* Purple overlay for selected items in classification mode */}
                                                                                                        {classificationMode && selectedForClassification.has(rowId) && (
                                                                                                            <div className="absolute inset-0 bg-purple-500/40 rounded-lg pointer-events-none flex items-center justify-center">
                                                                                                                <div className="bg-white/90 rounded-full p-1">
                                                                                                                    <Check size={16} className="text-purple-600" />
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        )}
                                                                                                        {/* Selection checkbox - in select mode */}
                                                                                                        {gallerySelectMode && (
                                                                                                            <button
                                                                                                                onClick={(e) => { e.stopPropagation(); toggleThumbnailSelection(rowId); }}
                                                                                                                className={`absolute top-1 left-1 z-20 w-6 h-6 rounded border-2 flex items-center justify-center transition-all cursor-pointer hover:scale-110 ${selectedThumbnails.has(rowId)
                                                                                                                    ? 'bg-blue-500 border-blue-500 text-white shadow-lg'
                                                                                                                    : 'bg-white/90 border-slate-400 hover:border-blue-400'
                                                                                                                    }`}
                                                                                                            >
                                                                                                                {selectedThumbnails.has(rowId) && <Check size={14} />}
                                                                                                            </button>
                                                                                                        )}
                                                                                                        {/* Favorite button - hidden in select mode */}
                                                                                                        {!gallerySelectMode && config.showFavoriteIcon && (
                                                                                                            <button
                                                                                                                onClick={(e) => handleStarClick(e, imageUrl, row)}
                                                                                                                className={`absolute top-1 right-1 p-1.5 rounded-full transition-all z-10 ${isFavorited(imageUrl)
                                                                                                                    ? 'bg-amber-400 text-white opacity-100'
                                                                                                                    : 'bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-amber-400'
                                                                                                                    }`}
                                                                                                                title={isFavorited(imageUrl) ? '取消收藏' : '添加收藏'}
                                                                                                            >
                                                                                                                <Star size={16} fill={isFavorited(imageUrl) ? 'currentColor' : 'none'} />
                                                                                                            </button>
                                                                                                        )}
                                                                                                        {linkUrl && (
                                                                                                            <div className="absolute bottom-1 right-1 bg-blue-500 text-white p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                                                <ExternalLink size={10} />
                                                                                                            </div>
                                                                                                        )}
                                                                                                        {/* Note indicator - top left */}
                                                                                                        <button
                                                                                                            onClick={(e) => { e.stopPropagation(); openNoteModal(imageUrl, row); }}
                                                                                                            className={`absolute top-8 left-1 p-1.5 rounded z-10 transition-all ${getNoteForImage(imageUrl)
                                                                                                                ? 'bg-blue-500 text-white opacity-100'
                                                                                                                : 'bg-black/40 text-white opacity-0 group-hover:opacity-70 hover:bg-blue-400 hover:opacity-100'
                                                                                                                }`}
                                                                                                            title={getNoteForImage(imageUrl)
                                                                                                                ? `备注: ${getNoteForImage(imageUrl).slice(0, 50)}${getNoteForImage(imageUrl).length > 50 ? '...' : ''}`
                                                                                                                : '添加备注'
                                                                                                            }
                                                                                                        >
                                                                                                            <MessageSquare size={16} />
                                                                                                        </button>
                                                                                                        {/* Category icon - top right (below star) */}
                                                                                                        {config.showCategoryIcon && (
                                                                                                            <button
                                                                                                                onClick={(e) => { e.stopPropagation(); openCategoryModal(imageUrl, row); }}
                                                                                                                className={`absolute top-8 right-1 p-1.5 rounded z-10 transition-all ${getCategoryForImage(imageUrl)
                                                                                                                    ? 'bg-purple-500 text-white opacity-100'
                                                                                                                    : 'bg-black/40 text-white opacity-0 group-hover:opacity-70 hover:bg-purple-400 hover:opacity-100'
                                                                                                                    }`}
                                                                                                                title={getCategoryForImage(imageUrl)
                                                                                                                    ? `【媒体标签】: ${getCategoryForImage(imageUrl)}`
                                                                                                                    : '添加分类'
                                                                                                                }
                                                                                                            >
                                                                                                                <Tag size={16} />
                                                                                                            </button>
                                                                                                        )}
                                                                                                        {effectiveLabelColumns.length > 0 && (
                                                                                                            <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 rounded-b-lg transition-opacity pointer-events-none ${config.showLabelOverlay ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                                                                                                <div className="text-[11px] text-white truncate">
                                                                                                                    {labelValues.join(' · ')}
                                                                                                                </div>
                                                                                                            </div>
                                                                                                        )}
                                                                                                    </div>
                                                                                                </div>
                                                                                            );
                                                                                        })
                                                                                    })()}
                                                                                </div>
                                                                                {/* Auto-load trigger - when this element becomes visible, load more */}
                                                                                {
                                                                                    showLoadMore && (
                                                                                        <div
                                                                                            className="mt-4 py-4 text-center"
                                                                                            ref={(el) => {
                                                                                                if (el) {
                                                                                                    const observer = new IntersectionObserver(
                                                                                                        ([entry]) => {
                                                                                                            if (entry.isIntersecting) {
                                                                                                                setGroupLoadedCount(prev => ({
                                                                                                                    ...prev,
                                                                                                                    [groupKey]: (prev[groupKey] || INITIAL_LOAD_COUNT) + LOAD_MORE_COUNT
                                                                                                                }));
                                                                                                                observer.disconnect();
                                                                                                            }
                                                                                                        },
                                                                                                        { threshold: 0.1 }
                                                                                                    );
                                                                                                    observer.observe(el);
                                                                                                }
                                                                                            }}
                                                                                        >
                                                                                            <div className="inline-flex items-center gap-2 px-4 py-2 bg-slate-100 text-slate-600 text-sm rounded-lg">
                                                                                                <svg className="animate-spin h-4 w-4" viewBox="0 0 24 24">
                                                                                                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                                                                                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                                                                                </svg>
                                                                                                加载中... ({totalCount - loadedCount} 张剩余)
                                                                                            </div>
                                                                                        </div>
                                                                                    )
                                                                                }
                                                                                {/* All loaded message - show when progressive loading is complete */}
                                                                                {
                                                                                    pageSize === -1 && allGroupRows.length > INITIAL_LOAD_COUNT && !showLoadMore && (
                                                                                        <div className="mt-4 py-2 text-center">
                                                                                            <div className="inline-flex items-center gap-2 px-4 py-2 bg-green-50 text-green-600 text-sm rounded-lg border border-green-200">
                                                                                                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                                                                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                                                                                                </svg>
                                                                                                全部加载完成 (共 {allGroupRows.length} 张)
                                                                                            </div>
                                                                                        </div>
                                                                                    )
                                                                                }
                                                                                {/* Pagination controls at bottom - show when in pagination mode with more than 1 page */}
                                                                                {
                                                                                    pageSize > 0 && (() => {
                                                                                        const currentPage = groupPages[groupKey] || 1;
                                                                                        const totalPages = Math.max(1, Math.ceil(allGroupRows.length / pageSize));
                                                                                        const actualPage = Math.max(1, Math.min(currentPage, totalPages));
                                                                                        if (totalPages <= 1) return null;
                                                                                        return (
                                                                                            <div className="flex items-center justify-center gap-3 mt-4 pt-3 border-t border-slate-200">
                                                                                                <button
                                                                                                    onClick={(e) => {
                                                                                                        e.stopPropagation();
                                                                                                        setGroupPages(prev => ({ ...prev, [groupKey]: Math.max(1, actualPage - 1) }));
                                                                                                    }}
                                                                                                    disabled={actualPage === 1}
                                                                                                    className="px-3 py-1.5 text-slate-700 bg-slate-100 border border-slate-300 rounded-lg hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                                                                                >
                                                                                                    <ChevronLeft size={16} />
                                                                                                    <span className="text-sm">上一页</span>
                                                                                                </button>
                                                                                                <span className="text-sm font-bold text-slate-800 px-3">
                                                                                                    {actualPage} / {totalPages}
                                                                                                </span>
                                                                                                <button
                                                                                                    onClick={(e) => {
                                                                                                        e.stopPropagation();
                                                                                                        setGroupPages(prev => ({ ...prev, [groupKey]: Math.min(totalPages, actualPage + 1) }));
                                                                                                    }}
                                                                                                    disabled={actualPage === totalPages}
                                                                                                    className="px-3 py-1.5 text-white bg-purple-500 border border-purple-600 rounded-lg hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                                                                                >
                                                                                                    <span className="text-sm">下一页</span>
                                                                                                    <ChevronRight size={16} />
                                                                                                </button>
                                                                                            </div>
                                                                                        );
                                                                                    })()
                                                                                }
                                                                            </div>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            );
                                                        })}
                                                    </>
                                                )
                                            })()
                                        ) : (
                                            /* Flat thumbnail grid (no grouping) with pagination */
                                            (() => {
                                                const allRows = sortRowsByRules(processedRows).filter(row => extractImageUrl(row[effectiveImageColumn]));
                                                const pageSize = config.galleryPageSize || 0;
                                                const totalPages = pageSize > 0 ? Math.max(1, Math.ceil(allRows.length / pageSize)) : 1;
                                                // Dynamic page guard: clamp galleryPage to valid range to prevent empty render after filtering
                                                const actualPage = Math.max(1, Math.min(galleryPage, totalPages));
                                                const displayRows = pageSize > 0
                                                    ? allRows.slice((actualPage - 1) * pageSize, actualPage * pageSize)
                                                    : allRows;
                                                const gridGap = 8;
                                                const gridColumns = Math.max(1, Math.floor((galleryViewportWidth + gridGap) / (config.thumbnailSize + gridGap)));
                                                const totalGridRows = Math.ceil(displayRows.length / gridColumns);
                                                const gridScrollTop = Math.max(0, galleryScrollTop - galleryGridOffsetRef.current);
                                                const rowHeight = config.thumbnailSize + gridGap;
                                                const startRow = Math.max(0, Math.floor(gridScrollTop / rowHeight) - 3);
                                                const endRow = Math.min(totalGridRows, Math.ceil((gridScrollTop + galleryViewportHeight) / rowHeight) + 3);
                                                const startIndex = startRow * gridColumns;
                                                const endIndex = Math.min(displayRows.length, endRow * gridColumns);
                                                const virtualEnabled = displayRows.length > 200 && galleryViewportHeight > 0 && galleryViewportWidth > 0;
                                                const windowRows = virtualEnabled ? displayRows.slice(startIndex, endIndex) : displayRows;
                                                const topSpacerHeight = virtualEnabled ? startRow * rowHeight : 0;
                                                const bottomSpacerHeight = virtualEnabled ? Math.max(0, totalGridRows - endRow) * rowHeight : 0;

                                                // Show empty state if no results
                                                if (allRows.length === 0) {
                                                    return (
                                                        <div className="flex flex-col items-center justify-center py-16 text-slate-500">
                                                            <Grid3X3 size={56} className="mb-4 opacity-30" />
                                                            <p className="text-lg font-semibold text-slate-600 mb-2">未检测到图片</p>
                                                            <div className="text-sm text-center space-y-1 max-w-md">
                                                                <p className="text-slate-500">请检查以下配置：</p>
                                                                <div className="mt-3 bg-slate-50 rounded-lg p-4 text-left text-xs space-y-2">
                                                                    <div className="flex items-start gap-2">
                                                                        <span className="text-blue-500 font-bold">1.</span>
                                                                        <span><strong>图片列</strong>：确保选择了包含图片链接的列</span>
                                                                    </div>
                                                                    <div className="flex items-start gap-2">
                                                                        <span className="text-blue-500 font-bold">2.</span>
                                                                        <div>
                                                                            <strong>链接格式</strong>：支持以下格式：
                                                                            <ul className="mt-1 ml-4 text-slate-400 list-disc">
                                                                                <li>=IMAGE("https://...") 公式</li>
                                                                                <li>https://xxx.jpg/.png/.gif 等图片链接</li>
                                                                                <li>Google Drive 或常见图床链接</li>
                                                                            </ul>
                                                                        </div>
                                                                    </div>
                                                                    <div className="flex items-start gap-2">
                                                                        <span className="text-blue-500 font-bold">3.</span>
                                                                        <span><strong>筛选条件</strong>：如有筛选，请检查是否过滤了所有数据</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                }

                                                return (
                                                    <div className="space-y-4">
                                                        {/* Classification Mode: Drop Target Bar (无分组模式) */}
                                                        {classificationMode && (
                                                            <div className="sticky top-0 z-20 bg-purple-50 border-b-2 border-purple-200 p-3 mb-4 rounded-lg">
                                                                {/* Header Row */}
                                                                <div className="flex items-center gap-2 mb-2">
                                                                    <Layers size={16} className="text-purple-600" />
                                                                    <span className="text-sm font-medium text-purple-700">分类工作区</span>
                                                                    <span className="text-xs text-purple-500">
                                                                        {selectedForClassification.size > 0
                                                                            ? `已选择 ${selectedForClassification.size} 张`
                                                                            : '点击缩略图选择，然后拖拽到目标'}
                                                                    </span>
                                                                </div>

                                                                {/* Classification Groups Row */}
                                                                {dragTargetTypes.classification && (
                                                                    <div className="flex flex-wrap gap-2 mb-2">
                                                                        <span className="text-xs text-purple-600 font-medium self-center mr-1 flex items-center gap-1"><FolderOpen size={12} /> 分组:</span>
                                                                        {/* 使用 categoryOptions 作为分组目标 */}
                                                                        {config.categoryOptions.length > 0 ? (
                                                                            config.categoryOptions.map((option) => (
                                                                                <div
                                                                                    key={option}
                                                                                    onDragOver={(e) => {
                                                                                        e.preventDefault();
                                                                                        setDragOverGroup(option);
                                                                                    }}
                                                                                    onDragLeave={() => setDragOverGroup(null)}
                                                                                    onDrop={async (e) => {
                                                                                        e.preventDefault();
                                                                                        setDragOverGroup(null);
                                                                                        if (draggedItems.length > 0) {
                                                                                            await handleClassificationChange(draggedItems, option);
                                                                                        }
                                                                                    }}
                                                                                    className={`px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed cursor-pointer transition-all ${dragOverGroup === option
                                                                                        ? 'bg-purple-200 border-purple-500 text-purple-800 scale-105'
                                                                                        : 'bg-white border-purple-300 text-purple-700 hover:bg-purple-100'
                                                                                        }`}
                                                                                    title="拖拽图片到此分类"
                                                                                >
                                                                                    {option}
                                                                                </div>
                                                                            ))
                                                                        ) : (
                                                                            <span className="text-xs text-amber-600 flex items-center gap-1"><AlertCircle size={12} /> 请先在「媒体标签」设置中添加分类选项</span>
                                                                        )}
                                                                        {/* Custom groups added by user */}
                                                                        {customGroups.map((customGroup, groupIdx) => (
                                                                            <div
                                                                                key={`custom-${groupIdx}`}
                                                                                onDragOver={(e) => {
                                                                                    e.preventDefault();
                                                                                    setDragOverGroup(customGroup);
                                                                                }}
                                                                                onDragLeave={() => setDragOverGroup(null)}
                                                                                onDrop={async (e) => {
                                                                                    e.preventDefault();
                                                                                    setDragOverGroup(null);
                                                                                    if (draggedItems.length > 0) {
                                                                                        await handleClassificationChange(draggedItems, customGroup);
                                                                                    }
                                                                                }}
                                                                                className={`px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed cursor-pointer transition-all ${dragOverGroup === customGroup
                                                                                    ? 'bg-green-200 border-green-500 text-green-800 scale-105'
                                                                                    : 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                                                                                    }`}
                                                                                title="拖拽图片到此自定义分组"
                                                                            >
                                                                                ✨ {customGroup}
                                                                            </div>
                                                                        ))}
                                                                        {/* Add new group button */}
                                                                        {showNewGroupInput ? (
                                                                            <div className="flex items-center gap-1">
                                                                                <input
                                                                                    type="text"
                                                                                    placeholder="新分组名称..."
                                                                                    className="w-24 px-2 py-1 text-xs border border-purple-300 rounded focus:ring-2 focus:ring-purple-400"
                                                                                    autoFocus
                                                                                    onKeyDown={(e) => {
                                                                                        if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                                                                                            setCustomGroups(prev => [...prev, (e.target as HTMLInputElement).value.trim()]);
                                                                                            setShowNewGroupInput(false);
                                                                                        } else if (e.key === 'Escape') {
                                                                                            setShowNewGroupInput(false);
                                                                                        }
                                                                                    }}
                                                                                    onBlur={(e) => {
                                                                                        if (e.target.value.trim()) {
                                                                                            setCustomGroups(prev => [...prev, e.target.value.trim()]);
                                                                                        }
                                                                                        setShowNewGroupInput(false);
                                                                                    }}
                                                                                />
                                                                            </div>
                                                                        ) : (
                                                                            <button
                                                                                onClick={() => setShowNewGroupInput(true)}
                                                                                className="px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed border-slate-300 text-slate-500 hover:border-purple-400 hover:text-purple-600 hover:bg-purple-50 transition-all"
                                                                                title="添加新分组"
                                                                            >
                                                                                + 新分组
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {/* Favorites Drop Zone Row (无分组模式) */}
                                                                {dragTargetTypes.favorites && (
                                                                    <div className="flex flex-wrap gap-2 mb-2">
                                                                        <span className="text-xs text-amber-600 font-medium self-center mr-1 flex items-center gap-1"><Star size={12} /> 收藏:</span>
                                                                        {favoriteFolders.map(folder => {
                                                                            const folderCount = favorites.filter(f => f.folderId === folder.id || (!f.folderId && folder.id === favoriteFolders[0]?.id)).length;
                                                                            return (
                                                                                <div
                                                                                    key={folder.id}
                                                                                    onDragOver={(e) => {
                                                                                        e.preventDefault();
                                                                                        setDragOverFavoriteFolder(folder.id);
                                                                                    }}
                                                                                    onDragLeave={() => setDragOverFavoriteFolder(null)}
                                                                                    onDrop={(e) => {
                                                                                        e.preventDefault();
                                                                                        setDragOverFavoriteFolder(null);
                                                                                        if (draggedItems.length > 0) {
                                                                                            const imageUrlsToAdd: { url: string; row: DataRow }[] = [];
                                                                                            draggedItems.forEach((rowId) => {
                                                                                                const row = processedRows.find(r => String(r._rowId) === rowId);
                                                                                                if (row) {
                                                                                                    const imgUrl = extractImageUrl(row[effectiveImageColumn]);
                                                                                                    if (imgUrl) {
                                                                                                        imageUrlsToAdd.push({ url: imgUrl, row });
                                                                                                    }
                                                                                                }
                                                                                            });
                                                                                            if (imageUrlsToAdd.length > 0) {
                                                                                                setFavorites(prev => {
                                                                                                    const existingUrls = new Set(prev.map(f => f.imageUrl));
                                                                                                    const newFavorites: FavoriteItem[] = [];
                                                                                                    imageUrlsToAdd.forEach((item, idx) => {
                                                                                                        if (!existingUrls.has(item.url)) {
                                                                                                            newFavorites.push({
                                                                                                                id: `fav-${Date.now()}-${Math.random().toString(36).substr(2, 9)}-${idx}`,
                                                                                                                imageUrl: item.url,
                                                                                                                rowData: item.row,
                                                                                                                addedAt: Date.now(),
                                                                                                                folderId: folder.id
                                                                                                            });
                                                                                                        }
                                                                                                    });
                                                                                                    const updated = prev.map(f =>
                                                                                                        imageUrlsToAdd.some(item => item.url === f.imageUrl)
                                                                                                            ? { ...f, folderId: folder.id }
                                                                                                            : f
                                                                                                    );
                                                                                                    return [...newFavorites, ...updated];
                                                                                                });
                                                                                                setCopyFeedback(`✅ 已添加 ${imageUrlsToAdd.length} 张图片到「${folder.name}」`);
                                                                                                setTimeout(() => setCopyFeedback(null), 2000);
                                                                                            }
                                                                                            setDraggedItems([]);
                                                                                        }
                                                                                    }}
                                                                                    className={`px-3 py-2 text-sm font-medium rounded-lg border-2 border-dashed cursor-pointer transition-all ${dragOverFavoriteFolder === folder.id
                                                                                        ? 'bg-amber-200 border-amber-500 text-amber-800 scale-105'
                                                                                        : 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                                                                                        }`}
                                                                                    title={`拖拽图片到「${folder.name}」收藏夹`}
                                                                                >
                                                                                    {folder.name} ({folderCount})
                                                                                </div>
                                                                            );
                                                                        })}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}

                                                        {/* Pagination Header */}
                                                        {pageSize > 0 && totalPages > 1 && (
                                                            <div className="flex items-center justify-between bg-slate-50 px-4 py-2 rounded-lg">
                                                                <span className="text-sm text-slate-600">
                                                                    共 {allRows.length} 张图片，当前显示 {(actualPage - 1) * pageSize + 1}-{Math.min(actualPage * pageSize, allRows.length)}
                                                                </span>
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        onClick={() => setGalleryPage(p => Math.max(1, p - 1))}
                                                                        disabled={actualPage === 1}
                                                                        className="px-2 py-1 text-xs bg-white border rounded hover:bg-slate-100 disabled:opacity-50"
                                                                    >
                                                                        <ChevronLeft size={14} />
                                                                    </button>
                                                                    <span className="text-sm font-medium">{actualPage} / {totalPages}</span>
                                                                    <button
                                                                        onClick={() => setGalleryPage(p => Math.min(totalPages, p + 1))}
                                                                        disabled={actualPage === totalPages}
                                                                        className="px-2 py-1 text-xs bg-white border rounded hover:bg-slate-100 disabled:opacity-50"
                                                                    >
                                                                        <ChevronRight size={14} />
                                                                    </button>
                                                                </div>
                                                            </div>
                                                        )}

                                                        {/* Thumbnail Grid */}
                                                        <div className="flex flex-wrap gap-2 pr-4" ref={galleryGridRef}>
                                                            {virtualEnabled && topSpacerHeight > 0 && (
                                                                <div className="w-full" style={{ height: topSpacerHeight }} />
                                                            )}
                                                            {windowRows.map((row, idx) => {
                                                                const imageUrl = extractImageUrl(row[effectiveImageColumn])!;
                                                                const linkUrl = effectiveLinkColumn ? String(row[effectiveLinkColumn] || '') : '';
                                                                const rowId = String(row._rowId || '');
                                                                const labelValues = effectiveLabelColumns
                                                                    .map(col => String(row[col] ?? '').trim())
                                                                    .filter(Boolean);
                                                                const highlight = checkHighlight(row, effectiveHighlightRules);

                                                                return (
                                                                    <div
                                                                        key={rowId || `${imageUrl}-${idx}`}
                                                                        className={`relative group cursor-pointer ${gallerySelectMode && selectedThumbnails.has(rowId) ? 'ring-2 ring-blue-500 ring-offset-1 rounded-lg' : ''} ${classificationMode && selectedForClassification.has(rowId) ? 'ring-2 ring-purple-500 ring-offset-1 rounded-lg' : ''} ${isDraggingImage ? 'cursor-grabbing' : 'cursor-grab'}`}
                                                                        draggable={classificationMode || !gallerySelectMode || selectedThumbnails.has(rowId)}
                                                                        onDragStart={(e) => {
                                                                            if (gallerySelectMode && !selectedThumbnails.has(rowId) && !classificationMode) return;
                                                                            handleThumbnailDragStart(e, imageUrl, row, rowId);
                                                                        }}
                                                                        onDragEnd={handleDragEnd}
                                                                        onClick={(e) => {
                                                                            if ((e.target as HTMLElement).closest('button')) return;
                                                                            // Classification mode: toggle selection for classification
                                                                            if (classificationMode) {
                                                                                setSelectedForClassification(prev => {
                                                                                    const newSet = new Set(prev);
                                                                                    if (newSet.has(rowId)) {
                                                                                        newSet.delete(rowId);
                                                                                    } else {
                                                                                        newSet.add(rowId);
                                                                                    }
                                                                                    return newSet;
                                                                                });
                                                                                return;
                                                                            }
                                                                            // Gallery select mode
                                                                            if (!gallerySelectMode) return;
                                                                            scheduleThumbnailSelect(rowId);
                                                                        }}
                                                                        onDoubleClick={(e) => handleThumbnailDoubleClick(e, rowId, linkUrl)}
                                                                        onMouseEnter={(e) => handleThumbnailMouseEnter(imageUrl, e)}
                                                                        onMouseLeave={handleThumbnailMouseLeave}
                                                                        onContextMenu={(e) => handleContextMenu(e, row, imageUrl)}
                                                                        title={linkUrl ? '双击打开链接 · 右键菜单 · 拖拽到收藏夹' : '右键菜单 · 拖拽到收藏夹'}
                                                                    >
                                                                        <img
                                                                            src={imageUrl}
                                                                            alt=""
                                                                            draggable={!gallerySelectMode || selectedThumbnails.has(rowId)}
                                                                            onDragStart={(e) => {
                                                                                if (gallerySelectMode && !selectedThumbnails.has(rowId)) return;
                                                                                e.stopPropagation();
                                                                                handleThumbnailDragStart(e, imageUrl, row, rowId);
                                                                            }}
                                                                            onDragEnd={(e) => {
                                                                                e.stopPropagation();
                                                                                handleDragEnd();
                                                                            }}
                                                                            className={`${config.thumbnailFit === 'contain' ? 'object-contain' : 'object-cover'} rounded-lg transition-all ${gallerySelectMode && selectedThumbnails.has(rowId) ? 'brightness-50 saturate-50' : 'group-hover:scale-105'}`}
                                                                            style={{
                                                                                width: config.thumbnailSize,
                                                                                height: config.thumbnailSize,
                                                                                backgroundColor: config.thumbnailFit === 'contain' ? '#f1f5f9' : undefined,
                                                                                border: highlight ? `${highlight.borderWidth}px solid ${highlight.color}` : undefined,
                                                                                boxShadow: highlight ? `0 0 ${highlight.borderWidth * 2}px ${highlight.color}80` : undefined
                                                                            }}
                                                                            loading="lazy"
                                                                        />
                                                                        {/* Blue overlay for selected items */}
                                                                        {gallerySelectMode && selectedThumbnails.has(rowId) && (
                                                                            <div className="absolute inset-0 bg-blue-500/30 rounded-lg pointer-events-none" />
                                                                        )}
                                                                        {/* Selection checkbox - in select mode */}
                                                                        {gallerySelectMode && (
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); toggleThumbnailSelection(rowId); }}
                                                                                className={`absolute top-1 left-1 z-20 w-6 h-6 rounded border-2 flex items-center justify-center transition-all cursor-pointer hover:scale-110 ${selectedThumbnails.has(rowId)
                                                                                    ? 'bg-blue-500 border-blue-500 text-white shadow-lg'
                                                                                    : 'bg-white/90 border-slate-400 hover:border-blue-400'
                                                                                    }`}
                                                                            >
                                                                                {selectedThumbnails.has(rowId) && <Check size={14} />}
                                                                            </button>
                                                                        )}
                                                                        {/* Favorite button - hidden in select mode */}
                                                                        {!gallerySelectMode && config.showFavoriteIcon && (
                                                                            <button
                                                                                onClick={(e) => handleStarClick(e, imageUrl, row)}
                                                                                className={`absolute top-1 right-1 p-1.5 rounded-full transition-all z-10 ${isFavorited(imageUrl)
                                                                                    ? 'bg-amber-400 text-white opacity-100'
                                                                                    : 'bg-black/40 text-white opacity-0 group-hover:opacity-100 hover:bg-amber-400'
                                                                                    }`}
                                                                                title={isFavorited(imageUrl) ? '取消收藏' : '添加收藏'}
                                                                            >
                                                                                <Star size={16} fill={isFavorited(imageUrl) ? 'currentColor' : 'none'} />
                                                                            </button>
                                                                        )}
                                                                        {linkUrl && (
                                                                            <div className="absolute bottom-1 right-1 bg-blue-500 text-white p-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                <ExternalLink size={10} />
                                                                            </div>
                                                                        )}
                                                                        {/* Note indicator - top left */}
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); openNoteModal(imageUrl, row); }}
                                                                            className={`absolute top-8 left-1 p-1.5 rounded z-10 transition-all ${getNoteForImage(imageUrl)
                                                                                ? 'bg-blue-500 text-white opacity-100'
                                                                                : 'bg-black/40 text-white opacity-0 group-hover:opacity-70 hover:bg-blue-400 hover:opacity-100'
                                                                                }`}
                                                                            title={getNoteForImage(imageUrl)
                                                                                ? `备注: ${getNoteForImage(imageUrl).slice(0, 50)}${getNoteForImage(imageUrl).length > 50 ? '...' : ''}`
                                                                                : '添加备注'
                                                                            }
                                                                        >
                                                                            <MessageSquare size={16} />
                                                                        </button>
                                                                        {/* Category icon - top right (below star) */}
                                                                        {config.showCategoryIcon && (
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); openCategoryModal(imageUrl, row); }}
                                                                                className={`absolute top-8 right-1 p-1.5 rounded z-10 transition-all ${getCategoryForImage(imageUrl)
                                                                                    ? 'bg-purple-500 text-white opacity-100'
                                                                                    : 'bg-black/40 text-white opacity-0 group-hover:opacity-70 hover:bg-purple-400 hover:opacity-100'
                                                                                    }`}
                                                                                title={getCategoryForImage(imageUrl)
                                                                                    ? `【媒体标签】: ${getCategoryForImage(imageUrl)}`
                                                                                    : '添加分类'
                                                                                }
                                                                            >
                                                                                <Tag size={16} />
                                                                            </button>
                                                                        )}
                                                                        {effectiveLabelColumns.length > 0 && (
                                                                            <div className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-1 rounded-b-lg transition-opacity pointer-events-none ${config.showLabelOverlay ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'}`}>
                                                                                <div className="text-[11px] text-white truncate">
                                                                                    {labelValues.join(' · ')}
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                );
                                                            })}
                                                            {virtualEnabled && bottomSpacerHeight > 0 && (
                                                                <div className="w-full" style={{ height: bottomSpacerHeight }} />
                                                            )}
                                                        </div>

                                                        {/* Pagination Footer */}
                                                        {pageSize > 0 && totalPages > 1 && (
                                                            <div className="flex items-center justify-center gap-2 py-3 mt-2 bg-white rounded-lg border shadow-sm">
                                                                <button
                                                                    onClick={() => setGalleryPage(1)}
                                                                    disabled={actualPage === 1}
                                                                    className="px-4 py-2 text-sm font-medium bg-slate-100 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                                >
                                                                    首页
                                                                </button>
                                                                <button
                                                                    onClick={() => setGalleryPage(p => Math.max(1, p - 1))}
                                                                    disabled={actualPage === 1}
                                                                    className="px-4 py-2 text-sm font-medium bg-slate-100 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                                >
                                                                    ← 上一页
                                                                </button>
                                                                <div className="flex items-center gap-1 px-3 py-1 bg-purple-600 text-white rounded-lg shadow">
                                                                    <input
                                                                        type="number"
                                                                        min={1}
                                                                        max={totalPages}
                                                                        value={actualPage}
                                                                        onChange={(e) => {
                                                                            const val = parseInt(e.target.value) || 1;
                                                                            setGalleryPage(Math.max(1, Math.min(totalPages, val)));
                                                                        }}
                                                                        className="w-12 px-1 py-0.5 text-sm font-bold text-center bg-white text-purple-700 rounded border-0 focus:ring-2 focus:ring-purple-300"
                                                                    />
                                                                    <span className="text-sm font-medium">/ {totalPages}</span>
                                                                </div>
                                                                <button
                                                                    onClick={() => setGalleryPage(p => Math.min(totalPages, p + 1))}
                                                                    disabled={actualPage === totalPages}
                                                                    className="px-4 py-2 text-sm font-medium bg-purple-500 text-white border border-purple-600 rounded-lg hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                                >
                                                                    下一页 →
                                                                </button>
                                                                <button
                                                                    onClick={() => setGalleryPage(totalPages)}
                                                                    disabled={actualPage === totalPages}
                                                                    className="px-4 py-2 text-sm font-medium bg-slate-100 text-slate-700 border border-slate-300 rounded-lg hover:bg-slate-200 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                                                                >
                                                                    末页
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                );
                                            })()
                                        )}
                                    </div >
                                )
                            ) : (!effectiveDateColumn || !effectiveImageColumn) ? (
                                <div className="flex items-center justify-center h-full text-slate-500">
                                    <div className="text-center max-w-sm">
                                        <Calendar size={56} className="mx-auto mb-3 opacity-40" />
                                        <p className="text-lg font-semibold text-slate-600 mb-2">
                                            {config.viewMode === 'timeline' ? '时间线模式' : config.viewMode === 'calendar' ? '日历模式' : '矩阵模式'}
                                        </p>
                                        <div className="bg-slate-50 rounded-lg p-4 text-left text-xs space-y-2">
                                            <p className="text-sm text-slate-500 mb-2">请在左侧配置：</p>
                                            <div className="flex items-center gap-2">
                                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${effectiveImageColumn ? 'bg-green-100 text-green-600' : 'bg-blue-100 text-blue-600'}`}>✓</span>
                                                <span className={effectiveImageColumn ? 'text-green-600' : ''}><strong>图片列</strong>（必填）{effectiveImageColumn && `：${effectiveImageColumn}`}</span>
                                            </div>
                                            <div className="flex items-center gap-2">
                                                <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[10px] font-bold ${effectiveDateColumn ? 'bg-green-100 text-green-600' : 'bg-red-100 text-red-600'}`}>{effectiveDateColumn ? '✓' : '!'}</span>
                                                <span className={effectiveDateColumn ? 'text-green-600' : 'text-red-600'}><strong>日期列</strong>（必填）{!effectiveDateColumn && '← 请选择'}</span>
                                            </div>
                                            {config.viewMode === 'matrix' && (
                                                <div className="flex items-center gap-2">
                                                    <span className="w-5 h-5 rounded-full bg-slate-100 text-slate-500 flex items-center justify-center text-[10px]">•</span>
                                                    <span>分组列（可选）：用于列分组</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            ) : config.viewMode === 'timeline' ? (
                                /* Timeline View */
                                <div className="space-y-4">
                                    {/* Determine primary grouping based on groupPriority */}
                                    {effectiveGroupColumn && (config.groupPriority === 'column' || !effectiveDateBinning || effectiveDateBins.length === 0) ? (
                                        /* Column-first mode: Primary grouping by groupColumn, secondary by date */
                                        groupedTimelineData.map(({ key: groupKey, label: groupLabel, dateGroups }) => {
                                            // Count total rows across all date groups
                                            const totalRows = [...dateGroups.values()].reduce((sum, dg) => sum + dg.rows.length, 0);
                                            const hasImages = [...dateGroups.values()].some(dg =>
                                                dg.rows.some(r => extractImageUrl(r[effectiveImageColumn]))
                                            );
                                            if (!hasImages) return null;

                                            const isExpanded = expandedGroups.has(groupKey);

                                            return (
                                                <div key={groupKey} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                                    <button
                                                        onClick={() => {
                                                            const next = new Set(expandedGroups);
                                                            if (isExpanded) next.delete(groupKey);
                                                            else next.add(groupKey);
                                                            setExpandedGroups(next);
                                                        }}
                                                        className="w-full px-4 py-3 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-white hover:from-indigo-100"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                            <span className="font-semibold text-slate-800">{groupLabel}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 text-xs text-slate-500">
                                                            <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{totalRows} 个帖子</span>
                                                            <span className="bg-slate-100 px-2 py-0.5 rounded-full">{dateGroups.size} 个日期</span>
                                                        </div>
                                                    </button>

                                                    {isExpanded && (
                                                        <div className="p-4 border-t border-slate-100 space-y-4">
                                                            {[...dateGroups.entries()].map(([dateKey, dg]) => {
                                                                const displayRows = config.showAllImages ? dg.rows : dg.rows.slice(0, 50);
                                                                if (displayRows.length === 0) return null;

                                                                return (
                                                                    <div key={dateKey} className="border-l-2 border-slate-200 pl-3">
                                                                        <div className="flex items-center gap-2 mb-2 pb-1 border-b border-slate-100">
                                                                            <span className="text-xs font-medium text-slate-600">{dateKey}</span>
                                                                            <span className="text-[10px] text-slate-400">({dg.rows.length})</span>
                                                                        </div>
                                                                        <div className="flex flex-wrap gap-3">
                                                                            {displayRows.map((row, idx) => renderThumbnail(row, idx))}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    ) : (
                                        /* Date-first mode: Primary grouping by date */
                                        [...timelineData.entries()].map(([dateKey, group]) => {
                                            const hasImages = group.rows.some(r => extractImageUrl(r[effectiveImageColumn]));
                                            if (!hasImages) return null;

                                            const isExpanded = expandedGroups.has(dateKey);

                                            return (
                                                <div key={dateKey} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                                    <button
                                                        onClick={() => {
                                                            const next = new Set(expandedGroups);
                                                            if (isExpanded) next.delete(dateKey);
                                                            else next.add(dateKey);
                                                            setExpandedGroups(next);
                                                        }}
                                                        className="w-full px-4 py-3 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white hover:from-slate-100"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                            <span className="font-semibold text-slate-800">{dateKey}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 text-xs text-slate-500">
                                                            <span className="bg-slate-100 px-2 py-0.5 rounded-full">{group.rows.length} 个帖子</span>
                                                            {effectiveAccountColumn && <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{group.accounts.size} 个账号</span>}
                                                        </div>
                                                    </button>

                                                    {isExpanded && (
                                                        <div className="p-4 border-t border-slate-100">
                                                            {/* Check if we need secondary column grouping */}
                                                            {effectiveGroupColumn && effectiveDateBinning && effectiveDateBins.length > 0 && config.groupPriority === 'date' ? (
                                                                /* Show secondary grouping by column */
                                                                (() => {
                                                                    // Group rows by column value
                                                                    const columnGroups = new Map<string, DataRow[]>();
                                                                    for (const row of group.rows) {
                                                                        const columnKey = getRowGroupKey(row);
                                                                        if (!columnGroups.has(columnKey)) columnGroups.set(columnKey, []);
                                                                        columnGroups.get(columnKey)!.push(row);
                                                                    }

                                                                    // Sort column groups
                                                                    let sortedColumnGroups = [...columnGroups.entries()];
                                                                    if (effectiveGroupBinning && effectiveGroupBins.length > 0) {
                                                                        const binOrder = effectiveGroupBins.map(b => b.label);
                                                                        sortedColumnGroups.sort((a, b) => {
                                                                            const idxA = binOrder.indexOf(a[0]);
                                                                            const idxB = binOrder.indexOf(b[0]);
                                                                            if (idxA === -1 && idxB === -1) return a[0].localeCompare(b[0]);
                                                                            if (idxA === -1) return 1;
                                                                            if (idxB === -1) return -1;
                                                                            return idxA - idxB;
                                                                        });
                                                                    }

                                                                    return (
                                                                        <div className="space-y-3">
                                                                            {sortedColumnGroups.map(([columnKey, rows]) => (
                                                                                <div key={columnKey} className="border-l-2 border-indigo-200 pl-3">
                                                                                    <div className="flex items-center gap-2 mb-2 pb-1 border-b border-slate-100">
                                                                                        <span className="text-xs font-medium text-indigo-600">{columnKey}</span>
                                                                                        <span className="text-[10px] text-slate-400">({rows.length})</span>
                                                                                    </div>
                                                                                    <div className="flex flex-wrap gap-3">
                                                                                        {(config.showAllImages ? rows : rows.slice(0, 50)).map((row, idx) => renderThumbnail(row, idx))}
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    );
                                                                })()
                                                            ) : (
                                                                /* No secondary grouping */
                                                                <div className="flex flex-wrap gap-3">
                                                                    {(config.showAllImages ? group.rows : group.rows.slice(0, 50)).map((row, idx) => renderThumbnail(row, idx))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
                            ) : config.viewMode === 'calendar' && config.calendarMode === 'scroll' ? (
                                /* Scroll View - Responsive full-width day cards */
                                <div className="h-full flex flex-col">
                                    {/* Quick Date Navigation */}
                                    <div className="flex-shrink-0 bg-white border-b border-slate-200 p-2 flex items-center gap-2 flex-wrap sticky top-0 z-20">
                                        <span className="text-xs text-slate-500">快速跳转:</span>
                                        {[...timelineData.keys()].slice(0, 15).map(dateKey => {
                                            const d = parseDate(dateKey);
                                            const isValidDate = d && !isNaN(d.getTime());
                                            return (
                                                <button
                                                    key={dateKey}
                                                    onClick={() => updateConfig({ selectedDate: dateKey })}
                                                    className={`px-2 py-0.5 text-[10px] rounded transition ${config.selectedDate === dateKey
                                                        ? 'bg-indigo-500 text-white'
                                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                        }`}
                                                >
                                                    {isValidDate ? `${d!.getMonth() + 1}/${d!.getDate()}` : dateKey.slice(0, 10)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {/* Day Cards - Horizontal scroll with all days */}
                                    <div className="flex-1 overflow-auto">
                                        <div className="flex gap-2 p-2 items-start" style={{ minWidth: 'max-content' }}>
                                            {(() => {
                                                // Show ALL entries, scroll horizontally
                                                const entries = [...timelineData.entries()];
                                                if (entries.length === 0) return null;

                                                // Card width based on scrollDaysPerView (how many fit on screen) or user-set scrollCardWidth
                                                const cardWidth = config.scrollCardWidth;

                                                return entries.map(([dateKey, { rows, accounts, date }]) => {
                                                    // Skip dates with no rows that have valid images
                                                    const rowsWithImages = rows.filter(r => extractImageUrl(r[effectiveImageColumn]));
                                                    if (rowsWithImages.length === 0) return null;

                                                    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
                                                    const dateObj = date || parseDate(dateKey);
                                                    const isValidDate = dateObj && !isNaN(dateObj.getTime());
                                                    const displayRows = config.showAllImages ? rowsWithImages : rowsWithImages.slice(0, 50);

                                                    return (
                                                        <div
                                                            key={dateKey}
                                                            className="bg-white rounded-lg border border-slate-200 overflow-hidden flex flex-col flex-shrink-0"
                                                            style={{ width: cardWidth }}
                                                        >
                                                            <div className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-3 py-2 flex-shrink-0 sticky top-0 z-10">
                                                                {isValidDate ? (
                                                                    <>
                                                                        <div className="flex items-baseline gap-2">
                                                                            <span className="text-xl font-bold">{dateObj!.getDate()}</span>
                                                                            <span className="text-sm opacity-80">{dateObj!.getMonth() + 1}月 周{weekDays[dateObj!.getDay()]}</span>
                                                                        </div>
                                                                        <div className="text-[10px] opacity-70 mt-0.5">
                                                                            {rows.length}个帖子 · {accounts.size}个账号
                                                                        </div>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <div className="text-base font-bold truncate">{dateKey}</div>
                                                                        <div className="text-[10px] opacity-70 mt-0.5">
                                                                            {rows.length}个帖子 · {accounts.size}个账号
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </div>
                                                            <div className="p-2">
                                                                {effectiveGroupColumn ? (
                                                                    // Group by groupColumn (with smart parsing like TransposePanel)
                                                                    (() => {
                                                                        const subGroups = buildGroupedRows(displayRows);
                                                                        return subGroups.map(({ key, label, rows: subRows }) => (
                                                                            <div key={key} className="mb-2 last:mb-0">
                                                                                <div className="text-[9px] font-medium text-slate-600 mb-1 pb-0.5 border-b border-slate-200">
                                                                                    {label} ({subRows.length})
                                                                                </div>
                                                                                <div className="flex flex-wrap gap-1">
                                                                                    {subRows.map((row, idx) =>
                                                                                        renderThumbnail(row, idx, { size: config.thumbnailSize, showMeta: false, compact: true })
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        ));
                                                                    })()
                                                                ) : (
                                                                    // No grouping
                                                                    <div className="flex flex-wrap gap-1">
                                                                        {displayRows.map((row, idx) =>
                                                                            renderThumbnail(row, idx, { size: config.thumbnailSize, showMeta: false, compact: true })
                                                                        )}
                                                                        {!config.showAllImages && rows.length > 50 && (
                                                                            <div className="px-2 bg-slate-200 rounded flex items-center justify-center text-xs text-slate-500 font-medium"
                                                                                style={{ height: config.thumbnailSize }}>
                                                                                +{rows.length - 50}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                });
                                            })()}
                                        </div>
                                    </div>
                                    {/* Bottom info bar */}
                                    <div className="flex-shrink-0 bg-white border-t border-slate-200 px-3 py-1.5 flex items-center justify-between text-[10px] text-slate-500">
                                        <span>共 {timelineData.size} 天 · 可水平滚动查看更多 →</span>
                                        <span>每屏显示 {config.scrollDaysPerView} 天</span>
                                    </div>
                                </div>
                            ) : config.viewMode === 'matrix' ? (
                                /* Matrix View */
                                <div className="overflow-auto h-full">
                                    <table className="border-collapse min-w-full">
                                        <thead className="sticky top-0 z-10">
                                            <tr>
                                                <th className="sticky left-0 z-20 bg-slate-100 border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700" style={{ maxWidth: 120, minWidth: 80 }}>
                                                    {config.matrixRowColumn === '__GROUP_SETTINGS__' ? '[分组设置]' : (config.matrixRowColumn || '行')}
                                                </th>
                                                {matrixData.colKeys.map(col => (
                                                    <th key={col} className="bg-slate-100 border border-slate-300 px-2 py-2 text-xs font-medium text-slate-600 whitespace-nowrap">
                                                        {matrixData.colLabels.get(col) || col}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {matrixData.rowKeys.map(rowKey => (
                                                <tr key={rowKey}>
                                                    <td className="sticky left-0 z-10 bg-slate-50 border border-slate-200 px-2 py-2 text-xs font-medium text-slate-700" style={{ maxWidth: 120, minWidth: 80 }}>
                                                        <div className="break-words">{matrixData.rowLabels.get(rowKey) || rowKey}</div>
                                                    </td>
                                                    {matrixData.colKeys.map(colKey => {
                                                        const cellKey = `${rowKey}|${colKey}`;
                                                        const rows = matrixData.cells.get(cellKey) || [];

                                                        return (
                                                            <td key={colKey} className="border border-slate-200 p-1.5 align-top bg-white" style={{ minWidth: config.matrixCellWidth }}>
                                                                {rows.length > 0 ? (
                                                                    config.groupColumn ? (
                                                                        // With groupColumn: show sub-grouped content
                                                                        (() => {
                                                                            const displayRows = config.showAllImages ? rows : rows.slice(0, 20);
                                                                            const subGroups = buildGroupedRows(displayRows);
                                                                            const perGroupLimit = config.showAllImages ? Infinity : 4;
                                                                            return (
                                                                                <div className="space-y-1.5">
                                                                                    {subGroups.map(({ key, label, rows: subRows }) => (
                                                                                        <div key={key} className="border-l-2 border-slate-200 pl-1.5">
                                                                                            <div className="text-[9px] font-medium text-slate-600 mb-0.5">
                                                                                                {label} <span className="text-slate-400">({subRows.length})</span>
                                                                                            </div>
                                                                                            <div className="flex flex-wrap gap-0.5">
                                                                                                {subRows.slice(0, perGroupLimit).map((row, idx) =>
                                                                                                    renderThumbnail(row, idx, { size: config.thumbnailSize, showMeta: false, compact: true })
                                                                                                )}
                                                                                                {!config.showAllImages && subRows.length > 4 && (
                                                                                                    <div className="px-1 bg-slate-200 rounded flex items-center justify-center text-[8px] text-slate-500"
                                                                                                        style={{ height: config.thumbnailSize }}>
                                                                                                        +{subRows.length - 4}
                                                                                                    </div>
                                                                                                )}
                                                                                            </div>
                                                                                        </div>
                                                                                    ))}
                                                                                    {!config.showAllImages && rows.length > 20 && (
                                                                                        <div className="text-[9px] text-slate-400 text-center">
                                                                                            还有 {rows.length - 20} 项...
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })()
                                                                    ) : (
                                                                        // No groupColumn: show flat thumbnails
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {(config.showAllImages ? rows : rows.slice(0, 6)).map((row, idx) =>
                                                                                renderThumbnail(row, idx, { size: config.thumbnailSize, showMeta: false, compact: true })
                                                                            )}
                                                                            {!config.showAllImages && rows.length > 6 && (
                                                                                <div className="px-2 bg-slate-200 rounded flex items-center justify-center text-[10px] text-slate-600"
                                                                                    style={{ height: config.thumbnailSize }}>
                                                                                    +{rows.length - 6}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )
                                                                ) : (
                                                                    <span className="text-slate-300 text-[10px]">—</span>
                                                                )}
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : (
                                /* Calendar View */
                                <div className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                    {calendarGrid.type === 'month' ? (
                                        <>
                                            <div className="grid grid-cols-7 border-b border-slate-200">
                                                {['日', '一', '二', '三', '四', '五', '六'].map(day => (
                                                    <div key={day} className="px-2 py-2 text-center text-xs font-medium text-slate-500 bg-slate-50">{day}</div>
                                                ))}
                                            </div>
                                            <div className="divide-y divide-slate-100">
                                                {calendarGrid.weeks?.map((week, weekIdx) => (
                                                    <div key={weekIdx} className="grid grid-cols-7 divide-x divide-slate-100">
                                                        {week.map((day, dayIdx) => {
                                                            if (day === null) return <div key={dayIdx} className="bg-slate-50" style={{ minHeight: config.calendarCellHeight }} />;

                                                            const dateKey = `${calendarGrid.year}-${String((calendarGrid.month ?? 0) + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
                                                            const dayRows = calendarData.get(dateKey) || [];
                                                            const isToday = new Date().toISOString().slice(0, 10) === dateKey;

                                                            return (
                                                                <div key={dayIdx} className={`p-1 ${isToday ? 'bg-indigo-50' : ''}`} style={{ minHeight: config.calendarCellHeight }}>
                                                                    <div className={`text-xs font-medium mb-1 ${isToday ? 'text-indigo-600' : 'text-slate-500'}`}>
                                                                        {day} {dayRows.length > 0 && <span className="text-[10px] text-slate-400">({dayRows.length})</span>}
                                                                    </div>
                                                                    {(() => {
                                                                        const displayRows = config.showAllImages ? dayRows : dayRows.slice(0, 6);
                                                                        if (config.groupColumn) {
                                                                            const subGroups = buildGroupedRows(displayRows);
                                                                            return (
                                                                                <div className="space-y-1">
                                                                                    {subGroups.map(({ key, label, rows: subRows }) => (
                                                                                        <div key={key} className="space-y-0.5">
                                                                                            <div className="text-[9px] font-medium text-slate-600">
                                                                                                {label} <span className="text-[8px] text-slate-400">({subRows.length})</span>
                                                                                            </div>
                                                                                            <div className="flex flex-wrap gap-0.5">
                                                                                                {subRows.map((row, idx) => renderThumbnail(row, idx, { size: config.thumbnailSize, showMeta: false, compact: true }))}
                                                                                            </div>
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            );
                                                                        }
                                                                        return (
                                                                            <div className="flex flex-wrap gap-0.5">
                                                                                {displayRows.map((row, idx) => renderThumbnail(row, idx, { size: config.thumbnailSize, showMeta: false, compact: true }))}
                                                                                {!config.showAllImages && dayRows.length > 6 && (
                                                                                    <div className="px-1 bg-slate-200 rounded flex items-center justify-center text-[8px] text-slate-600"
                                                                                        style={{ height: config.thumbnailSize }}>
                                                                                        +{dayRows.length - 6}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })()}
                                                                </div>
                                                            );
                                                        })}
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    ) : (
                                        /* Day/Week/Range7 Views */
                                        <div className="p-4">
                                            <div className="flex flex-wrap gap-4">
                                                {calendarGrid.dates?.map((date, idx) => {
                                                    const dateKey = formatDateKey(date);
                                                    const dayRows = calendarData.get(dateKey) || [];
                                                    const isToday = formatDateKey(new Date()) === dateKey;
                                                    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

                                                    return (
                                                        <div
                                                            key={idx}
                                                            className={`p-2 rounded-lg border ${isToday ? 'border-orange-300 bg-orange-50' : 'border-slate-200 bg-white'}`}
                                                            style={{ minWidth: 150 }}
                                                        >
                                                            <div className="flex items-baseline gap-1 mb-2">
                                                                <span className="text-sm font-semibold text-slate-700">{date.getDate()}日</span>
                                                                <span className="text-[10px] text-slate-400">周{weekDays[date.getDay()]}</span>
                                                                {dayRows.length > 0 && <span className="text-[10px] text-slate-400 ml-auto">({dayRows.length})</span>}
                                                            </div>
                                                            {(() => {
                                                                const displayRows = config.showAllImages ? dayRows : dayRows.slice(0, 8);
                                                                if (config.groupColumn) {
                                                                    const subGroups = buildGroupedRows(displayRows);
                                                                    if (subGroups.length === 0) {
                                                                        return <span className="text-[10px] text-slate-300">无内容</span>;
                                                                    }
                                                                    return (
                                                                        <div className="space-y-2">
                                                                            {subGroups.map(({ key, label, rows: subRows }) => (
                                                                                <div key={key} className="space-y-0.5">
                                                                                    <div className="text-[9px] font-medium text-slate-600">
                                                                                        {label} <span className="text-[8px] text-slate-400">({subRows.length})</span>
                                                                                    </div>
                                                                                    <div className="flex flex-wrap gap-1">
                                                                                        {subRows.map((row, idx) => renderThumbnail(row, idx, { size: config.thumbnailSize, showMeta: false, compact: true }))}
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    );
                                                                }
                                                                return (
                                                                    <div className="flex flex-wrap gap-1">
                                                                        {displayRows.map((row, idx) => renderThumbnail(row, idx, { size: config.thumbnailSize, showMeta: false, compact: true }))}
                                                                        {!config.showAllImages && dayRows.length > 8 && (
                                                                            <div className="bg-slate-200 rounded flex items-center justify-center text-[8px] text-slate-600 px-2"
                                                                                style={{ height: config.thumbnailSize }}>
                                                                                +{dayRows.length - 8}
                                                                            </div>
                                                                        )}
                                                                        {dayRows.length === 0 && <span className="text-[10px] text-slate-300">无内容</span>}
                                                                    </div>
                                                                );
                                                            })()}
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )
                        )}
                    </div>
                    {isLoading && (
                        <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center z-40">
                            <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg shadow-md border border-slate-200 text-slate-600 text-sm">
                                <Loader2 size={16} className="animate-spin text-blue-500" />
                                <span>正在刷新画廊...</span>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Hover Preview Overlay for Gallery Mode - Responsive sizing */}
            {
                hoveredImage && hoverPosition && thumbnailRect && (() => {
                    // Responsive preview size: adapt to window size
                    // Larger screens get bigger preview, smaller screens get smaller preview
                    const screenWidth = window.innerWidth;
                    const screenHeight = window.innerHeight;

                    // Base size 480px (doubled from 240), max 50% of smaller screen dimension
                    const maxDimension = Math.min(screenWidth, screenHeight) * 0.5;
                    const basePreviewSize = Math.min(480, maxDimension);
                    const previewWidth = basePreviewSize;
                    const previewHeight = basePreviewSize;
                    const padding = 15;

                    // Try to position on the right of the thumbnail
                    let left = thumbnailRect.right + padding;
                    let top = thumbnailRect.top;

                    // If no room on right, try left
                    if (left + previewWidth > screenWidth) {
                        left = thumbnailRect.left - previewWidth - padding;
                    }

                    // If still no room, position below
                    if (left < 0) {
                        left = Math.max(padding, thumbnailRect.left);
                        top = thumbnailRect.bottom + padding;
                    }

                    // Ensure within viewport vertically
                    if (top + previewHeight > screenHeight) {
                        top = Math.max(padding, screenHeight - previewHeight - padding);
                    }
                    if (top < padding) top = padding;

                    // Clamp left to ensure visibility
                    if (left + previewWidth > screenWidth - padding) {
                        left = screenWidth - previewWidth - padding;
                    }
                    if (left < padding) left = padding;

                    return (
                        <div
                            className="fixed z-40 pointer-events-none"
                            style={{ left, top }}
                        >
                            <div className="bg-white rounded-xl shadow-2xl p-3 border border-slate-200">
                                <img
                                    src={hoveredImage}
                                    alt=""
                                    style={{
                                        maxWidth: previewWidth - 24,
                                        maxHeight: previewHeight - 24
                                    }}
                                    className="object-contain rounded-lg"
                                />
                            </div>
                        </div>
                    );
                })()
            }

            {/* Copy Feedback Toast */}
            {
                copyFeedback && (
                    <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-50 bg-slate-800 text-white px-4 py-2 rounded-lg shadow-lg animate-pulse">
                        <div className="flex items-center gap-2">
                            <Check size={16} className="text-green-400" />
                            {copyFeedback}
                        </div>
                    </div>
                )
            }

            {/* Drag Drop Sidebar - appears when dragging */}
            {isDraggingImage && (
                <div className="fixed left-4 bottom-4 z-50 animate-in slide-in-from-left duration-300">
                    <div className="bg-white backdrop-blur-sm rounded-2xl shadow-2xl border border-slate-200 p-4 w-64 text-slate-700">
                        <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
                            📌 拖拽到目标位置
                        </div>

                        {/* 收藏夹列表 */}
                        <div className="mb-4">
                            <div className="px-2 py-1 text-[10px] font-semibold text-amber-600 uppercase tracking-wider flex items-center gap-1">
                                <Star size={12} className="inline mr-1" /> 收藏夹
                            </div>
                            <div className="space-y-1 max-h-40 overflow-y-auto">
                                {favoriteFolders.map(folder => (
                                    <div
                                        key={folder.id}
                                        onDragOver={(e) => {
                                            e.preventDefault();
                                            e.dataTransfer.dropEffect = 'copy';
                                            setDragOverTarget(`folder-${folder.id}`);
                                        }}
                                        onDragLeave={() => setDragOverTarget(null)}
                                        onDrop={(e) => handleDropToFolder(e, folder.id)}
                                        className={`px-3 py-2 rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${dragOverTarget === `folder-${folder.id}`
                                            ? 'bg-green-100 border-green-400 ring-2 ring-green-300'
                                            : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                                            }`}
                                    >
                                        <span>{folder.emoji || '📁'}</span>
                                        <span className="flex-1 text-sm truncate text-slate-800">{folder.name}</span>
                                        <span className="text-[10px] text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">{getFavoritesInFolder(folder.id).length}</span>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* 媒体标签列表 */}
                        {config.categoryOptions.filter(c => c.trim()).length > 0 && (
                            <div>
                                <div className="px-2 py-1 text-[10px] font-semibold text-purple-600 uppercase tracking-wider flex items-center gap-1">
                                    <Tag size={12} className="inline mr-1" /> 媒体标签
                                </div>
                                <div className="space-y-1 max-h-40 overflow-y-auto">
                                    {config.categoryOptions.filter(c => c.trim()).map(category => (
                                        <div
                                            key={category}
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                e.dataTransfer.dropEffect = 'copy';
                                                setDragOverTarget(`category-${category}`);
                                            }}
                                            onDragLeave={() => setDragOverTarget(null)}
                                            onDrop={(e) => handleDropToCategory(e, category)}
                                            className={`px-3 py-2 rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${dragOverTarget === `category-${category}`
                                                ? 'bg-purple-100 border-purple-400 ring-2 ring-purple-300'
                                                : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                                                }`}
                                        >
                                            <Tag size={14} className="text-purple-500" />
                                            <span className="flex-1 text-sm truncate text-slate-800">{category}</span>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="mt-3 pt-3 border-t border-slate-200 text-[10px] text-slate-500 text-center">
                            ✨ 释放鼠标即可添加
                        </div>
                    </div>
                </div>
            )}

            {/* Custom Confirm Dialog */}
            {
                confirmDialog && confirmDialog.isOpen && (
                    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
                        {/* Backdrop */}
                        <div
                            className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                            onClick={() => setConfirmDialog(null)}
                        />
                        {/* Dialog */}
                        <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
                            {/* Header with icon */}
                            <div className={`px-6 pt-6 pb-4 flex flex-col items-center ${confirmDialog.type === 'danger' ? 'text-red-600' :
                                confirmDialog.type === 'warning' ? 'text-amber-600' : 'text-blue-600'
                                }`}>
                                <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 ${confirmDialog.type === 'danger' ? 'bg-red-100' :
                                    confirmDialog.type === 'warning' ? 'bg-amber-100' : 'bg-blue-100'
                                    }`}>
                                    {confirmDialog.type === 'danger' ? (
                                        <Trash2 size={28} />
                                    ) : confirmDialog.type === 'warning' ? (
                                        <Info size={28} />
                                    ) : (
                                        <Info size={28} />
                                    )}
                                </div>
                                <h3 className="text-lg font-semibold text-slate-800">{confirmDialog.title}</h3>
                            </div>
                            {/* Message */}
                            <div className="px-6 pb-4">
                                <p className="text-sm text-slate-600 text-center">{confirmDialog.message}</p>
                            </div>
                            {/* Actions */}
                            <div className="flex border-t border-slate-200">
                                <button
                                    onClick={() => setConfirmDialog(null)}
                                    className="flex-1 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors border-r border-slate-200"
                                >
                                    {confirmDialog.cancelText || '取消'}
                                </button>
                                <button
                                    onClick={confirmDialog.onConfirm}
                                    className={`flex-1 py-3 text-sm font-medium transition-colors ${confirmDialog.type === 'danger'
                                        ? 'text-red-600 hover:bg-red-50'
                                        : confirmDialog.type === 'warning'
                                            ? 'text-amber-600 hover:bg-amber-50'
                                            : 'text-blue-600 hover:bg-blue-50'
                                        }`}
                                >
                                    {confirmDialog.confirmText || '确定'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Image Modal */}
            {
                selectedImage && (
                    <div
                        className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
                        onClick={() => setSelectedImage(null)}
                    >
                        <div className="relative max-w-[90vw] max-h-[90vh]">
                            <img
                                src={selectedImage}
                                alt=""
                                className="max-w-full max-h-[90vh] object-contain rounded-lg"
                            />
                            <button
                                onClick={() => setSelectedImage(null)}
                                className="absolute -top-4 -right-4 p-2 bg-white rounded-full shadow-lg hover:bg-slate-100"
                            >
                                <X size={20} />
                            </button>
                        </div>
                    </div>
                )
            }

            {/* Row Detail Modal */}
            {
                selectedRow && (
                    <div
                        className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
                        onClick={() => setSelectedRow(null)}
                    >
                        <div
                            className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Header */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                                <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1"><Info size={14} /> 数据详情</h3>
                                <button
                                    onClick={() => setSelectedRow(null)}
                                    className="p-1 hover:bg-slate-200 rounded"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                            {/* Image preview */}
                            {extractImageUrl(selectedRow[effectiveImageColumn]) && (
                                <div className="p-4 border-b border-slate-200 bg-slate-100 flex justify-center">
                                    <img
                                        src={extractImageUrl(selectedRow[effectiveImageColumn])!}
                                        alt=""
                                        className="max-h-48 object-contain rounded-lg shadow"
                                    />
                                </div>
                            )}
                            {/* Data table */}
                            <div className="overflow-y-auto max-h-[50vh] p-4">
                                <table className="w-full text-sm">
                                    <tbody>
                                        {effectiveData.columns.map(col => {
                                            const value = selectedRow[col];
                                            if (value === undefined || value === null || value === '') return null;
                                            return (
                                                <tr key={col} className="border-b border-slate-100 hover:bg-slate-50">
                                                    <td className="py-2 pr-4 text-slate-500 font-medium whitespace-nowrap align-top" style={{ width: '35%' }}>
                                                        {col}
                                                    </td>
                                                    <td className="py-2 text-slate-800 break-words">
                                                        {String(value)}
                                                    </td>
                                                </tr>
                                            );
                                        })}
                                    </tbody>
                                </table>
                            </div>
                            {/* Footer */}
                            <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
                                <button
                                    onClick={() => setSelectedRow(null)}
                                    className="px-4 py-1.5 text-sm bg-slate-600 text-white rounded hover:bg-slate-700"
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Context Menu for Thumbnail */}
            {
                contextMenu && (
                    <div
                        ref={contextMenuRef}
                        className="fixed z-[100] bg-white rounded-lg shadow-2xl border border-slate-200 py-1 min-w-[180px] animate-in fade-in zoom-in-95 duration-100"
                        style={{
                            left: contextMenuPos ? contextMenuPos.x : contextMenu.x,
                            top: contextMenuPos ? contextMenuPos.y : contextMenu.y,
                            maxHeight: '420px',
                            overflowY: 'auto'
                        }}
                        onClick={(e) => e.stopPropagation()}
                        onMouseEnter={() => {
                            if (contextMenuCloseTimerRef.current) {
                                clearTimeout(contextMenuCloseTimerRef.current);
                                contextMenuCloseTimerRef.current = null;
                            }
                        }}
                        onMouseLeave={() => {
                            if (contextMenuCloseTimerRef.current) {
                                clearTimeout(contextMenuCloseTimerRef.current);
                            }
                            contextMenuCloseTimerRef.current = setTimeout(() => {
                                setContextMenu(null);
                                contextMenuCloseTimerRef.current = null;
                            }, 120);
                        }}
                    >
                        {/* Image Copy Options */}
                        <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">图片</div>
                        <button
                            onClick={() => {
                                copyImageToClipboard(contextMenu.imageUrl);
                                setContextMenu(null);
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2"
                        >
                            <Image size={14} /> 复制图片
                        </button>
                        <button
                            onClick={() => copyTextToClipboard(contextMenu.imageUrl, '图片链接')}
                            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2"
                        >
                            <ExternalLink size={14} /> 复制图片链接
                        </button>
                        {contextMenu.imageFormula.startsWith('=IMAGE') && (
                            <button
                                onClick={() => copyTextToClipboard(contextMenu.imageFormula, '图片公式')}
                                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2"
                            >
                                <Grid3X3 size={14} /> 复制图片公式
                            </button>
                        )}

                        {/* Label Column Values */}
                        {effectiveLabelColumns.length > 0 && (
                            <>
                                <div className="border-t border-slate-100 my-1"></div>
                                <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">字段</div>
                                {effectiveLabelColumns.map(col => {
                                    const value = String(contextMenu.row[col] || '');
                                    const displayValue = value || '(空)';
                                    const copyValue = value; // Only copy actual value, not placeholder
                                    return (
                                        <button
                                            key={col}
                                            onClick={() => copyValue ? copyTextToClipboard(copyValue, col) : null}
                                            disabled={!copyValue}
                                            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${copyValue
                                                ? 'text-slate-700 hover:bg-green-50 hover:text-green-700'
                                                : 'text-slate-300 cursor-not-allowed'
                                                }`}
                                        >
                                            <span className="text-[10px] text-slate-400 w-16 truncate">{col}:</span>
                                            <span className="truncate flex-1">{displayValue.length > 20 ? displayValue.slice(0, 20) + '...' : displayValue}</span>
                                        </button>
                                    );
                                })}
                            </>
                        )}

                        {/* Link if available */}
                        {effectiveLinkColumn && contextMenu.row[effectiveLinkColumn] && (
                            <>
                                <div className="border-t border-slate-100 my-1"></div>
                                <button
                                    onClick={() => copyTextToClipboard(String(contextMenu.row[effectiveLinkColumn]), '链接')}
                                    className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-purple-50 hover:text-purple-700 flex items-center gap-2"
                                >
                                    <ExternalLink size={14} /> 复制关联链接
                                </button>
                            </>
                        )}

                        {/* Favorite and Copy Row options */}
                        <div className="border-t border-slate-100 my-1"></div>
                        <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">收藏夹</div>
                        {isFavorited(contextMenu.imageUrl) ? (
                            <button
                                onClick={() => {
                                    toggleFavorite(contextMenu.imageUrl, contextMenu.row);
                                    setContextMenu(null);
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-amber-600 hover:bg-amber-50 flex items-center gap-2"
                            >
                                <Star size={14} fill="currentColor" /> 取消收藏
                            </button>
                        ) : (
                            <>
                                {favoriteFolders.map(folder => (
                                    <button
                                        key={folder.id}
                                        onClick={() => {
                                            addToFolder(contextMenu.imageUrl, contextMenu.row, folder.id);
                                            setContextMenu(null);
                                        }}
                                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-amber-50 hover:text-amber-600 flex items-center gap-2"
                                    >
                                        <span>{folder.emoji || '📁'}</span>
                                        <span className="truncate">{folder.name}</span>
                                    </button>
                                ))}
                                <button
                                    onClick={() => {
                                        const imageUrl = contextMenu.imageUrl;
                                        const row = contextMenu.row;
                                        setNewFolderModal({
                                            isOpen: true,
                                            name: '收藏夹 ' + (favoriteFolders.length + 1),
                                            emoji: '📂',
                                            onSuccess: (folderId) => {
                                                addToFolder(imageUrl, row, folderId);
                                            }
                                        });
                                        setContextMenu(null);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-green-600 hover:bg-green-50 flex items-center gap-2"
                                >
                                    <Plus size={14} /> 新建收藏夹并添加
                                </button>
                            </>
                        )}

                        {/* Add Note Option */}
                        <button
                            onClick={() => {
                                openNoteModal(contextMenu.imageUrl, contextMenu.row);
                                setContextMenu(null);
                            }}
                            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${getNoteForImage(contextMenu.imageUrl)
                                ? 'text-blue-600 hover:bg-blue-50'
                                : 'text-slate-700 hover:bg-blue-50 hover:text-blue-600'
                                }`}
                        >
                            <MessageSquare size={14} fill={getNoteForImage(contextMenu.imageUrl) ? 'currentColor' : 'none'} />
                            {getNoteForImage(contextMenu.imageUrl) ? '编辑备注' : '添加备注'}
                            {getNoteForImage(contextMenu.imageUrl) && (
                                <span className="ml-auto text-[10px] text-blue-400 bg-blue-50 px-1.5 py-0.5 rounded">已有</span>
                            )}
                        </button>

                        {/* Add Category Option */}
                        <button
                            onClick={() => {
                                openCategoryModal(contextMenu.imageUrl, contextMenu.row);
                                setContextMenu(null);
                            }}
                            className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${getCategoryForImage(contextMenu.imageUrl)
                                ? 'text-purple-600 hover:bg-purple-50'
                                : 'text-slate-700 hover:bg-purple-50 hover:text-purple-600'
                                }`}
                        >
                            <Tag size={14} fill={getCategoryForImage(contextMenu.imageUrl) ? 'currentColor' : 'none'} />
                            {getCategoryForImage(contextMenu.imageUrl) ? '编辑分类' : '添加分类'}
                            {getCategoryForImage(contextMenu.imageUrl) && (
                                <span className="ml-auto text-[10px] text-purple-400 bg-purple-50 px-1.5 py-0.5 rounded truncate max-w-[80px]">{getCategoryForImage(contextMenu.imageUrl)}</span>
                            )}
                        </button>

                        {/* Display current note/category info if exists */}
                        {(getNoteForImage(contextMenu.imageUrl) || getCategoryForImage(contextMenu.imageUrl)) && (
                            <>
                                <div className="border-t border-slate-100 my-1"></div>
                                <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">当前标注</div>
                                {getCategoryForImage(contextMenu.imageUrl) && (
                                    <div className="px-3 py-1.5 text-sm text-slate-600 flex items-center gap-2">
                                        <Tag size={12} className="text-purple-400" />
                                        <span className="text-purple-600 font-medium">{getCategoryForImage(contextMenu.imageUrl)}</span>
                                    </div>
                                )}
                                {getNoteForImage(contextMenu.imageUrl) && (
                                    <div className="px-3 py-1.5 text-sm text-slate-600 flex items-start gap-2">
                                        <MessageSquare size={12} className="text-blue-400 mt-0.5 flex-shrink-0" />
                                        <span className="text-blue-600 text-xs break-words max-w-[180px]">{getNoteForImage(contextMenu.imageUrl)?.slice(0, 60)}{(getNoteForImage(contextMenu.imageUrl)?.length || 0) > 60 ? '...' : ''}</span>
                                    </div>
                                )}
                            </>
                        )}

                        <button
                            onClick={() => {
                                copyRowDataToClipboard(contextMenu.row, contextMenu.imageUrl);
                                setContextMenu(null);
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                        >
                            <Copy size={14} /> 复制整行数据
                        </button>
                    </div>
                )
            }

            {/* Note Modal (备注弹窗) */}
            {
                noteModal.isOpen && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110]"
                        onClick={closeNoteModal}
                    >
                        <div
                            className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                                        <MessageSquare size={18} className="text-blue-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-800">添加备注</h3>
                                        <p className="text-[11px] text-slate-400">
                                            备注将同步到 {NOTE_COLUMN}{noteModal.rowIndex} 单元格
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={closeNoteModal}
                                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-5">
                                {/* Image Preview */}
                                <div className="flex gap-4 mb-4">
                                    <div className="w-20 h-20 bg-slate-100 rounded-lg overflow-hidden flex-shrink-0">
                                        <img
                                            src={noteModal.imageUrl}
                                            alt="Preview"
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-slate-500 mb-1">目标位置</p>
                                        <p className="text-sm font-medium text-slate-700 truncate">
                                            {currentSheetName || '当前工作表'} → {NOTE_COLUMN}{noteModal.rowIndex}
                                        </p>
                                        {noteModal.syncToSheet && (
                                            <p className="text-[10px] text-amber-600 mt-2 bg-amber-50 px-2 py-1 rounded inline-block">
                                                <Lightbulb size={12} className="inline mr-1" /> 备注将覆盖 {NOTE_COLUMN} 列现有内容
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Note Input */}
                                <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-2">
                                        备注内容
                                    </label>
                                    <textarea
                                        value={noteModal.currentNote}
                                        onChange={(e) => setNoteModal(prev => ({ ...prev, currentNote: e.target.value }))}
                                        placeholder="输入备注内容..."
                                        className="w-full h-32 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                                        autoFocus
                                    />
                                </div>

                                {/* Sync to Sheet Toggle */}
                                <div className="flex items-center justify-between mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                                    <div className="flex items-center gap-2">
                                        <Upload size={16} className={noteModal.syncToSheet ? 'text-blue-600' : 'text-slate-400'} />
                                        <div>
                                            <p className="text-sm font-medium text-slate-700">同步到 Google 表格</p>
                                            <p className="text-[10px] text-slate-400">将备注写入原表格的 {NOTE_COLUMN} 列</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setNoteModal(prev => ({ ...prev, syncToSheet: !prev.syncToSheet }))}
                                        className={`relative w-11 h-6 rounded-full transition-colors ${noteModal.syncToSheet ? 'bg-blue-600' : 'bg-slate-300'
                                            }`}
                                    >
                                        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${noteModal.syncToSheet ? 'left-6' : 'left-1'
                                            }`} />
                                    </button>
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                                <div className="text-[11px] text-slate-400">
                                    {isUserLoggedIn() ? (
                                        <span className="flex items-center gap-1">
                                            <Cloud size={12} className="text-green-500" />
                                            备注将保存到云端
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-1">
                                            <CloudOff size={12} className="text-amber-500" />
                                            未登录，备注仅保存本地
                                        </span>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={closeNoteModal}
                                        disabled={noteModal.isSaving}
                                        className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={() => saveNote(noteModal.syncToSheet)}
                                        disabled={noteModal.isSaving || noteModal.rowIndex <= 0}
                                        className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                                    >
                                        {noteModal.isSaving ? (
                                            <>
                                                <Loader2 size={14} className="animate-spin" />
                                                保存中...
                                            </>
                                        ) : (
                                            <>
                                                <Check size={14} />
                                                {noteModal.syncToSheet ? '保存并同步' : '保存备注'}
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* New Folder Modal (新建收藏夹弹窗) */}
            {
                newFolderModal.isOpen && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110]"
                        onClick={() => setNewFolderModal({ isOpen: false, name: '', emoji: '📂', onSuccess: undefined })}
                    >
                        <div
                            className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                                        <FolderPlus size={18} className="text-green-600" />
                                    </div>
                                    <h3 className="font-bold text-slate-800">新建收藏夹</h3>
                                </div>
                                <button
                                    onClick={() => setNewFolderModal({ isOpen: false, name: '', emoji: '📂', onSuccess: undefined })}
                                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-5 space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-1.5">收藏夹名称</label>
                                    <input
                                        type="text"
                                        value={newFolderModal.name}
                                        onChange={(e) => setNewFolderModal(prev => ({ ...prev, name: e.target.value }))}
                                        placeholder="输入收藏夹名称"
                                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                                        autoFocus
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-1.5">选择图标</label>
                                    <div className="flex flex-wrap gap-2">
                                        {['📂', '⭐', '❤️', '💼', '🎯', '🔥', '💎', '🎨', '📸', '🎬', '🎵', '📚'].map(emoji => (
                                            <button
                                                key={emoji}
                                                onClick={() => setNewFolderModal(prev => ({ ...prev, emoji }))}
                                                className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all ${newFolderModal.emoji === emoji
                                                    ? 'bg-green-100 border-2 border-green-500'
                                                    : 'bg-slate-100 border border-slate-200 hover:bg-slate-200'
                                                    }`}
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                                <button
                                    onClick={() => setNewFolderModal({ isOpen: false, name: '', emoji: '📂', onSuccess: undefined })}
                                    className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={() => {
                                        if (newFolderModal.name.trim()) {
                                            const folderId = createFolder(newFolderModal.name.trim(), newFolderModal.emoji);
                                            if (newFolderModal.onSuccess) {
                                                newFolderModal.onSuccess(folderId);
                                            }
                                            setNewFolderModal({ isOpen: false, name: '', emoji: '📂', onSuccess: undefined });
                                            setCopyFeedback(`✅ 收藏夹 "${newFolderModal.name.trim()}" 创建成功`);
                                            setTimeout(() => setCopyFeedback(null), 2000);
                                        }
                                    }}
                                    disabled={!newFolderModal.name.trim()}
                                    className="px-4 py-2 text-sm font-medium text-white bg-green-500 rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    创建
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Folder Context Menu (收藏夹右键菜单) */}
            {folderContextMenu && (
                <div
                    className="fixed inset-0 z-[120]"
                    onClick={() => setFolderContextMenu(null)}
                >
                    <div
                        className="absolute bg-white rounded-lg shadow-xl border border-slate-200 py-1 w-36"
                        style={{ left: folderContextMenu.x, top: folderContextMenu.y }}
                        onClick={e => e.stopPropagation()}
                    >
                        <button
                            onClick={() => {
                                const folder = favoriteFolders.find(f => f.id === folderContextMenu.folderId);
                                if (folder) {
                                    setEditFolderModal({
                                        isOpen: true,
                                        folderId: folder.id,
                                        name: folder.name,
                                        emoji: folder.emoji || '📁'
                                    });
                                }
                                setFolderContextMenu(null);
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                        >
                            <Edit3 size={14} /> 编辑
                        </button>
                        <button
                            onClick={() => {
                                clearFavoritesInFolder(folderContextMenu.folderId);
                                setFolderContextMenu(null);
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                        >
                            <Trash2 size={14} /> 清空此收藏夹
                        </button>
                        {folderContextMenu.folderId !== DEFAULT_FOLDER_ID && (
                            <button
                                onClick={() => {
                                    setConfirmDialog({
                                        isOpen: true,
                                        title: '删除收藏夹',
                                        message: '确定要删除这个收藏夹吗？文件夹内的收藏将移到默认收藏夹。',
                                        type: 'danger',
                                        confirmText: '删除',
                                        cancelText: '取消',
                                        onConfirm: () => {
                                            deleteFolder(folderContextMenu.folderId);
                                            setConfirmDialog(null);
                                        }
                                    });
                                    setFolderContextMenu(null);
                                }}
                                className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                            >
                                <Trash2 size={14} /> 删除
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* Edit Folder Modal (编辑收藏夹弹窗) */}
            {editFolderModal.isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130]"
                    onClick={() => setEditFolderModal({ isOpen: false, folderId: '', name: '', emoji: '' })}
                >
                    <div
                        className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* Modal Header */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                            <div className="flex items-center gap-2">
                                <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                                    <Edit3 size={18} className="text-amber-600" />
                                </div>
                                <h3 className="font-bold text-slate-800">编辑收藏夹</h3>
                            </div>
                            <button
                                onClick={() => setEditFolderModal({ isOpen: false, folderId: '', name: '', emoji: '' })}
                                className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* Modal Body */}
                        <div className="p-5 space-y-4">
                            <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">收藏夹名称</label>
                                <input
                                    type="text"
                                    value={editFolderModal.name}
                                    onChange={(e) => setEditFolderModal(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="输入收藏夹名称"
                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label className="block text-xs font-medium text-slate-600 mb-1.5">选择图标</label>
                                <div className="flex flex-wrap gap-2">
                                    {['📂', '⭐', '❤️', '💼', '🎯', '🔥', '💎', '🎨', '📸', '🎬', '🎵', '📚'].map(emoji => (
                                        <button
                                            key={emoji}
                                            onClick={() => setEditFolderModal(prev => ({ ...prev, emoji }))}
                                            className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all ${editFolderModal.emoji === emoji
                                                ? 'bg-amber-100 border-2 border-amber-500'
                                                : 'bg-slate-100 border border-slate-200 hover:bg-slate-200'
                                                }`}
                                        >
                                            {emoji}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        </div>

                        {/* Modal Footer */}
                        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                            <button
                                onClick={() => setEditFolderModal({ isOpen: false, folderId: '', name: '', emoji: '' })}
                                className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => {
                                    if (editFolderModal.name.trim()) {
                                        renameFolder(editFolderModal.folderId, editFolderModal.name.trim(), editFolderModal.emoji);
                                        setEditFolderModal({ isOpen: false, folderId: '', name: '', emoji: '' });
                                        setCopyFeedback(`✅ 收藏夹已更新`);
                                        setTimeout(() => setCopyFeedback(null), 2000);
                                    }
                                }}
                                disabled={!editFolderModal.name.trim()}
                                className="px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Folder Selection Menu (收藏夹选择菜单) */}
            {
                showFolderMenu && (
                    <div
                        className="fixed inset-0 z-[100] pointer-events-none"
                    >
                        <div
                            ref={folderMenuRef}
                            className="absolute bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px] animate-in fade-in zoom-in-95 duration-150 pointer-events-auto"
                            style={{
                                left: Math.min(showFolderMenu.x, window.innerWidth - 200),
                                top: Math.min(showFolderMenu.y, window.innerHeight - 300)
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                                选择收藏夹
                            </div>
                            {favoriteFolders.map(folder => (
                                <button
                                    key={folder.id}
                                    onClick={() => {
                                        addToFolder(showFolderMenu.imageUrl, showFolderMenu.row, folder.id);
                                        setShowFolderMenu(null);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-amber-50 hover:text-amber-600 flex items-center gap-2"
                                >
                                    <span>{folder.emoji || '📁'}</span>
                                    <span className="truncate flex-1">{folder.name}</span>
                                    <span className="text-[10px] text-slate-400">
                                        {favorites.filter(f => f.folderId === folder.id).length}
                                    </span>
                                </button>
                            ))}
                            <div className="border-t border-slate-100 mt-1 pt-1">
                                <button
                                    onClick={() => {
                                        const imageUrl = showFolderMenu.imageUrl;
                                        const row = showFolderMenu.row;
                                        setShowFolderMenu(null);
                                        setNewFolderModal({
                                            isOpen: true,
                                            name: '收藏夹 ' + (favoriteFolders.length + 1),
                                            emoji: '📂',
                                            onSuccess: (folderId) => {
                                                addToFolder(imageUrl, row, folderId);
                                            }
                                        });
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-green-600 hover:bg-green-50 flex items-center gap-2"
                                >
                                    <Plus size={14} />
                                    <span>新建收藏夹</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Batch Folder Selection Menu (批量收藏夹选择菜单) */}
            {
                showBatchFolderMenu && (
                    <div
                        className="fixed inset-0 z-[100] pointer-events-none"
                    >
                        <div
                            ref={batchFolderMenuRef}
                            className="absolute bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px] animate-in fade-in zoom-in-95 duration-150 pointer-events-auto"
                            style={{
                                left: Math.min(showBatchFolderMenu.x, window.innerWidth - 200),
                                top: Math.min(showBatchFolderMenu.y, window.innerHeight - 300)
                            }}
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                                选择收藏夹 ({selectedThumbnails.size} 项)
                            </div>
                            {favoriteFolders.map(folder => (
                                <button
                                    key={folder.id}
                                    onClick={() => {
                                        addSelectedToFavorites(processedRows, folder.id);
                                        setShowBatchFolderMenu(null);
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-amber-50 hover:text-amber-600 flex items-center gap-2"
                                >
                                    <span>{folder.emoji || '📁'}</span>
                                    <span className="truncate flex-1">{folder.name}</span>
                                    <span className="text-[10px] text-slate-400">
                                        {favorites.filter(f => f.folderId === folder.id).length}
                                    </span>
                                </button>
                            ))}
                            <div className="border-t border-slate-100 mt-1 pt-1">
                                <button
                                    onClick={() => {
                                        setShowBatchFolderMenu(null);
                                        setNewFolderModal({
                                            isOpen: true,
                                            name: '收藏夹 ' + (favoriteFolders.length + 1),
                                            emoji: '📂',
                                            onSuccess: (folderId) => {
                                                addSelectedToFavorites(processedRows, folderId);
                                            }
                                        });
                                    }}
                                    className="w-full px-3 py-2 text-left text-sm text-green-600 hover:bg-green-50 flex items-center gap-2"
                                >
                                    <Plus size={14} />
                                    <span>新建收藏夹并添加</span>
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Login Prompt Modal (登录提示弹窗) */}
            {
                showLoginPrompt && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120]"
                        onClick={() => setShowLoginPrompt(null)}
                    >
                        <div
                            className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="p-6 text-center">
                                <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                                    <User size={32} className="text-amber-600" />
                                </div>
                                <h3 className="text-lg font-bold text-slate-800 mb-2">需要登录</h3>
                                <p className="text-sm text-slate-600 mb-6">
                                    {showLoginPrompt.action}功能需要登录邮箱账号才能使用。
                                    <br />
                                    <span className="text-slate-400 text-xs">登录后数据将自动同步到云端</span>
                                    <br />
                                    <span className="text-slate-400 text-xs flex items-center gap-1"><Lightbulb size={12} /> 高级登录需要 Sheets 写入权限，适合需要同步/入库功能的用户；普通用户选择“普通登录”即可。</span>
                                    <br />
                                    <span className="text-slate-400 text-xs">如需权限可联系软件提供人申请，或使用普通模式登录并选择其他验证方式实现表格写入。</span>
                                </p>
                                <div className="flex gap-3">
                                    <button
                                        onClick={() => setShowLoginPrompt(null)}
                                        className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                                    >
                                        稍后再说
                                    </button>
                                    <button
                                        onClick={() => {
                                            // Find and click the login button in the header
                                            const loginBtn = document.querySelector('[data-login-button]') as HTMLButtonElement;
                                            if (loginBtn) {
                                                loginBtn.click();
                                            } else {
                                                // Fallback: show a message
                                                alert('请点击右上角的登录按钮登录您的 Google 账号');
                                            }
                                            setShowLoginPrompt(null);
                                        }}
                                        className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
                                    >
                                        去登录
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Category Modal (分类弹窗) */}
            {
                categoryModal.isOpen && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110]"
                        onClick={closeCategoryModal}
                    >
                        <div
                            className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                                        <Tag size={18} className="text-purple-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-800">【媒体标签】</h3>
                                        <p className="text-[11px] text-slate-400">
                                            标签将同步到 {CATEGORY_COLUMN}{categoryModal.rowIndex} 单元格
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={closeCategoryModal}
                                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-5">
                                {/* Image Preview */}
                                <div className="flex gap-4 mb-4">
                                    <div className="w-20 h-20 bg-slate-100 rounded-lg overflow-hidden flex-shrink-0">
                                        <img
                                            src={categoryModal.imageUrl}
                                            alt="Preview"
                                            className="w-full h-full object-cover"
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                    </div>
                                    <div className="flex-1 min-w-0">
                                        <p className="text-xs text-slate-500 mb-1">目标位置</p>
                                        <p className="text-sm font-medium text-slate-700 truncate">
                                            {currentSheetName || '当前工作表'} → {CATEGORY_COLUMN}{categoryModal.rowIndex}
                                        </p>
                                        {categoryModal.currentCategory && (
                                            <p className="text-sm text-purple-600 mt-2 bg-purple-50 px-2 py-1 rounded inline-block">
                                                当前: {categoryModal.currentCategory}
                                            </p>
                                        )}
                                    </div>
                                </div>

                                {/* Category Options */}
                                <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-3">
                                        选择分类标签
                                    </label>
                                    <div className="grid grid-cols-2 gap-2">
                                        {config.categoryOptions.map((cat) => (
                                            <button
                                                key={cat}
                                                onClick={() => saveCategory(cat, autoSyncCategoriesToSheet)}
                                                disabled={categoryModal.isSaving}
                                                className={`px-4 py-3 text-sm font-medium rounded-lg border-2 transition-all ${categoryModal.currentCategory === cat
                                                    ? 'bg-purple-500 text-white border-purple-500'
                                                    : 'bg-white text-slate-700 border-slate-200 hover:border-purple-300 hover:bg-purple-50'
                                                    } disabled:opacity-50`}
                                            >
                                                {cat}
                                            </button>
                                        ))}
                                    </div>

                                    {/* Clear category button */}
                                    {categoryModal.currentCategory && (
                                        <button
                                            onClick={() => saveCategory('', autoSyncCategoriesToSheet)}
                                            disabled={categoryModal.isSaving}
                                            className="w-full mt-3 px-4 py-2 text-sm text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                                        >
                                            ✕ 清除分类
                                        </button>
                                    )}
                                </div>

                                {/* Auto sync toggle */}
                                <div className="flex items-center justify-between mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                                    <div className="flex items-center gap-2">
                                        <Upload size={16} className={autoSyncCategoriesToSheet ? 'text-purple-600' : 'text-slate-400'} />
                                        <div>
                                            <p className="text-sm font-medium text-slate-700">自动同步到表格</p>
                                            <p className="text-[10px] text-slate-400">将标签写入 {CATEGORY_COLUMN} 列</p>
                                        </div>
                                    </div>
                                    <button
                                        onClick={() => setAutoSyncCategoriesToSheet(!autoSyncCategoriesToSheet)}
                                        className={`relative w-11 h-6 rounded-full transition-colors ${autoSyncCategoriesToSheet ? 'bg-purple-600' : 'bg-slate-300'}`}
                                    >
                                        <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${autoSyncCategoriesToSheet ? 'left-6' : 'left-1'}`} />
                                    </button>
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                                <div className="text-[11px] text-slate-400">
                                    {categoryModal.isSaving ? (
                                        <span className="flex items-center gap-1">
                                            <Loader2 size={12} className="animate-spin text-purple-500" />
                                            正在保存...
                                        </span>
                                    ) : (
                                        <span>点击分类选项即可保存</span>
                                    )}
                                </div>
                                <button
                                    onClick={closeCategoryModal}
                                    disabled={categoryModal.isSaving}
                                    className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Batch Category Modal (批量分类弹窗) */}
            {
                batchCategoryModal.isOpen && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110]"
                        onClick={() => setBatchCategoryModal({ isOpen: false, isSaving: false })}
                    >
                        <div
                            className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                                        <Tag size={18} className="text-purple-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-800">批量分类</h3>
                                        <p className="text-[11px] text-slate-400">
                                            为 {selectedThumbnails.size} 张图片设置分类
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setBatchCategoryModal({ isOpen: false, isSaving: false })}
                                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-5">
                                <label className="block text-xs font-medium text-slate-600 mb-3">
                                    选择要应用的分类
                                </label>
                                <div className="grid grid-cols-2 gap-2">
                                    {config.categoryOptions.map((cat) => (
                                        <button
                                            key={cat}
                                            onClick={() => batchApplyCategory(cat, processedRows)}
                                            disabled={batchCategoryModal.isSaving}
                                            className="px-4 py-3 text-sm font-medium rounded-lg border-2 bg-white text-slate-700 border-slate-200 hover:border-purple-300 hover:bg-purple-50 transition-all disabled:opacity-50"
                                        >
                                            {cat}
                                        </button>
                                    ))}
                                </div>

                                {/* Clear category button */}
                                <button
                                    onClick={() => batchApplyCategory('', processedRows)}
                                    disabled={batchCategoryModal.isSaving}
                                    className="w-full mt-3 px-4 py-2 text-sm text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                                >
                                    ✕ 清除分类
                                </button>
                            </div>

                            {/* Modal Footer */}
                            <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                                <div className="text-[11px] text-slate-400">
                                    {batchCategoryModal.isSaving ? (
                                        <span className="flex items-center gap-1">
                                            <Loader2 size={12} className="animate-spin text-purple-500" />
                                            正在批量设置...
                                        </span>
                                    ) : (
                                        <span>点击分类选项即可批量应用</span>
                                    )}
                                </div>
                                <button
                                    onClick={() => setBatchCategoryModal({ isOpen: false, isSaving: false })}
                                    disabled={batchCategoryModal.isSaving}
                                    className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                                >
                                    取消
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Batch Note Modal (批量备注弹窗) */}
            {
                batchNoteModal.isOpen && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110]"
                        onClick={() => setBatchNoteModal({ isOpen: false, isSaving: false, note: '', imageUrls: [] })}
                    >
                        <div
                            className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                                        <MessageSquare size={18} className="text-blue-600" />
                                    </div>
                                    <div>
                                        <h3 className="font-bold text-slate-800">批量备注</h3>
                                        <p className="text-[11px] text-slate-400">
                                            为 {batchNoteModal.imageUrls.length} 张图片设置备注
                                        </p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => setBatchNoteModal({ isOpen: false, isSaving: false, note: '', imageUrls: [] })}
                                    className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            {/* Modal Body */}
                            <div className="p-5">
                                <label className="block text-xs font-medium text-slate-600 mb-2">
                                    输入备注内容
                                </label>
                                <textarea
                                    value={batchNoteModal.note}
                                    onChange={(e) => setBatchNoteModal(prev => ({ ...prev, note: e.target.value }))}
                                    placeholder="输入要批量添加的备注..."
                                    className="w-full h-32 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-none"
                                    disabled={batchNoteModal.isSaving}
                                />
                            </div>

                            {/* Modal Footer */}
                            <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                                <div className="text-[11px] text-slate-400">
                                    {batchNoteModal.isSaving ? (
                                        <span className="flex items-center gap-1">
                                            <Loader2 size={12} className="animate-spin text-blue-500" />
                                            正在批量设置...
                                        </span>
                                    ) : (
                                        <span>输入备注后点击确定即可批量应用</span>
                                    )}
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setBatchNoteModal({ isOpen: false, isSaving: false, note: '', imageUrls: [] })}
                                        disabled={batchNoteModal.isSaving}
                                        className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={() => batchApplyNote(batchNoteModal.note, batchNoteModal.imageUrls, processedRows)}
                                        disabled={batchNoteModal.isSaving}
                                        className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                                    >
                                        {batchNoteModal.isSaving ? '应用中...' : '确定'}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Preset Editor Modal (自定义预设编辑器) */}
            {
                showPresetEditor && editingPreset && (
                    <div
                        className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110]"
                        onClick={() => {
                            setShowPresetEditor(false);
                            setEditingPreset(null);
                        }}
                    >
                        <div
                            className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* Modal Header */}
                            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                                <div className="flex items-center gap-2">
                                    <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                                        <Tag size={18} className="text-amber-600" />
                                    </div>
                                    <div>
                                        <h3 className="text-lg font-semibold text-slate-800">保存为预设</h3>
                                        <p className="text-xs text-slate-500">自定义预设会同步到云端</p>
                                    </div>
                                </div>
                                <button
                                    onClick={() => {
                                        setShowPresetEditor(false);
                                        setEditingPreset(null);
                                    }}
                                    className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors"
                                >
                                    <X size={18} className="text-slate-500" />
                                </button>
                            </div>

                            {/* Modal Content */}
                            <div className="p-5 space-y-4">
                                {/* Preset Name */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-slate-600">预设名称</label>
                                    <input
                                        type="text"
                                        value={editingPreset.name}
                                        onChange={(e) => setEditingPreset({ ...editingPreset, name: e.target.value })}
                                        placeholder="例如：产品分类"
                                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                                    />
                                </div>

                                {/* Emoji Picker */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-slate-600">图标</label>
                                    <div className="flex flex-wrap gap-2">
                                        {['🏷️', '📦', '🎨', '📷', '🎬', '📝', '🌟', '💼', '🎯', '📊'].map((emoji) => (
                                            <button
                                                key={emoji}
                                                onClick={() => setEditingPreset({ ...editingPreset, emoji })}
                                                className={`w-10 h-10 text-lg rounded-lg border transition-colors ${editingPreset.emoji === emoji
                                                    ? 'bg-amber-100 border-amber-300'
                                                    : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                                                    }`}
                                            >
                                                {emoji}
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                {/* Options Preview */}
                                <div className="space-y-1.5">
                                    <label className="text-xs font-medium text-slate-600">包含分类 ({editingPreset.options.length} 项)</label>
                                    <div className="flex flex-wrap gap-1 p-2 bg-slate-50 rounded-lg max-h-24 overflow-y-auto">
                                        {editingPreset.options.map((opt, idx) => (
                                            <span key={idx} className="px-2 py-0.5 text-xs bg-white border border-slate-200 rounded">
                                                {opt}
                                            </span>
                                        ))}
                                    </div>
                                    <p className="text-[10px] text-slate-400">将当前分类选项保存为预设</p>
                                </div>
                            </div>

                            {/* Modal Footer */}
                            <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                                <button
                                    onClick={() => {
                                        setShowPresetEditor(false);
                                        setEditingPreset(null);
                                    }}
                                    className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={() => {
                                        if (editingPreset.name.trim()) {
                                            saveCustomPreset(editingPreset);
                                            setCopyFeedback(`✅ 预设 "${editingPreset.name}" 已保存`);
                                            setTimeout(() => setCopyFeedback(null), 2000);
                                        }
                                    }}
                                    disabled={!editingPreset.name.trim()}
                                    className="px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                                >
                                    保存预设
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* Copy View Layout Modal */}
            {copyViewModal.open && (
                <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm">
                    <div className="bg-white rounded-2xl shadow-2xl w-[400px] p-6">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                                <Image size={20} className="text-purple-500" />
                                复制视图布局
                            </h3>
                            <button
                                onClick={() => setCopyViewModal({ ...copyViewModal, open: false })}
                                className="p-1 hover:bg-slate-100 rounded"
                            >
                                <X size={18} className="text-slate-500" />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div className="p-4 bg-purple-50 rounded-lg">
                                <p className="text-sm text-slate-600 mb-3">
                                    将当前分组视图复制为表格格式：
                                </p>
                                <ul className="text-xs text-slate-500 space-y-1 ml-4 list-disc">
                                    <li>每个分组名称占一行</li>
                                    <li>缩略图按行排列，每行指定数量</li>
                                    <li>粘贴到 Google Sheets 后可自动识别</li>
                                </ul>
                            </div>

                            <div className="flex items-center gap-3">
                                <label className="text-sm font-medium text-slate-700">每行缩略图数量:</label>
                                <div className="flex items-center gap-2 flex-wrap">
                                    {[10, 15, 20, 25, 30, 40].map(n => (
                                        <button
                                            key={n}
                                            onClick={() => setCopyViewModal({ ...copyViewModal, columnsPerRow: n })}
                                            className={`w-8 h-8 text-sm font-medium rounded-lg transition-colors ${copyViewModal.columnsPerRow === n
                                                ? 'bg-purple-500 text-white'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                        >
                                            {n}
                                        </button>
                                    ))}
                                    <input
                                        type="number"
                                        min="1"
                                        max="200"
                                        value={copyViewModal.columnsPerRow}
                                        onChange={(e) => {
                                            const val = parseInt(e.target.value) || 10;
                                            setCopyViewModal({ ...copyViewModal, columnsPerRow: Math.min(200, Math.max(1, val)) });
                                        }}
                                        className="w-14 h-8 px-2 text-sm text-center border border-slate-300 rounded-lg focus:border-purple-500 focus:outline-none"
                                        title="自定义数量"
                                    />
                                </div>
                            </div>

                            <div className={`text-xs ${effectiveGroupColumns[0] ? 'text-slate-500' : 'text-red-500 font-medium'}`}>
                                {effectiveGroupColumns[0]
                                    ? `当前: 按 "${effectiveGroupColumns[0]}" 分组`
                                    : <><AlertCircle size={12} className="inline mr-1" /> 未设置分组列 - 将把所有图片作为一个组导出</>
                                }
                            </div>

                            {/* Classification overrides toggle */}
                            <label className="flex items-center gap-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={copyViewModal.applyClassificationOverrides}
                                    onChange={(e) => setCopyViewModal({ ...copyViewModal, applyClassificationOverrides: e.target.checked })}
                                    className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                                />
                                <span className="text-sm text-slate-700">应用分类调整</span>
                                {Object.keys(classificationOverrides).length > 0 && (
                                    <span className="text-xs text-purple-500">({Object.keys(classificationOverrides).length} 项)</span>
                                )}
                            </label>

                            {/* Extra data columns toggle */}
                            <div className="space-y-2">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={copyViewModal.includeExtraData}
                                        onChange={(e) => setCopyViewModal({ ...copyViewModal, includeExtraData: e.target.checked })}
                                        className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                                    />
                                    <span className="text-sm text-slate-700">包含额外数据列</span>
                                </label>

                                {copyViewModal.includeExtraData && (
                                    <div className="ml-6 p-3 bg-slate-50 rounded-lg space-y-2 max-h-40 overflow-auto">
                                        <p className="text-xs text-slate-500 mb-2">选择要导出的列:</p>
                                        {effectiveData.columns.filter(col => col !== effectiveImageColumn).map(col => (
                                            <label key={col} className="flex items-center gap-2 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={copyViewModal.selectedColumns.includes(col)}
                                                    onChange={(e) => {
                                                        if (e.target.checked) {
                                                            setCopyViewModal({
                                                                ...copyViewModal,
                                                                selectedColumns: [...copyViewModal.selectedColumns, col]
                                                            });
                                                        } else {
                                                            setCopyViewModal({
                                                                ...copyViewModal,
                                                                selectedColumns: copyViewModal.selectedColumns.filter(c => c !== col)
                                                            });
                                                        }
                                                    }}
                                                    className="w-3.5 h-3.5 text-blue-500 rounded focus:ring-blue-500"
                                                />
                                                <span className="text-xs text-slate-600">{col}</span>
                                            </label>
                                        ))}
                                        {copyViewModal.selectedColumns.length > 0 && (
                                            <p className="text-xs text-blue-600 mt-2">
                                                布局: 第一列 = 列名，后续 = 数据+缩略图
                                            </p>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>

                        <div className="flex justify-end gap-2 mt-6">
                            <button
                                onClick={() => setCopyViewModal({ ...copyViewModal, open: false })}
                                className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => copyViewLayoutToClipboard(
                                    copyViewModal.columnsPerRow,
                                    copyViewModal.includeExtraData,
                                    copyViewModal.selectedColumns,
                                    copyViewModal.applyClassificationOverrides
                                )}
                                className="px-4 py-2 text-sm font-medium text-white bg-purple-500 rounded-lg hover:bg-purple-600 transition-colors"
                            >
                                <ClipboardList size={12} className="inline mr-1" /> 复制视图布局
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Floating Tooltip for click-position tips */}
            {
                floatingTip && (
                    <div
                        className="fixed z-[9999] px-3 py-2 text-sm font-medium text-white bg-slate-800 rounded-lg shadow-lg pointer-events-none animate-in fade-in zoom-in-95"
                        style={{
                            left: floatingTip.x,
                            top: floatingTip.y - 40,
                            transform: 'translateX(-50%)'
                        }}
                    >
                        {floatingTip.text}
                    </div>
                )
            }
        </div >
    );
};

MediaGalleryPanel.displayName = 'MediaGalleryPanel';

export default memo(MediaGalleryPanel);
