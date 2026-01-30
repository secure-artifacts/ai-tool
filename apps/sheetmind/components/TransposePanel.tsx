/**
 * TransposePanel - Formula-Based Transpose Tool for SheetMind
 * Supports grouping by date, number, text, or numbered categories.
 * Can export formulas for Google Sheets.
 */

import React, { useState, useMemo, useCallback, useEffect, memo } from 'react';
import { SheetData, DataRow } from '../types';
import { extractImageFromFormula } from '../utils/parser';
import {
    savePresetToCloud,
    loadPresetsFromCloud,
    deletePresetFromCloud,
    isUserLoggedIn,
    getCurrentUserName,
    syncVersionToGoogleSheet,
    parseGoogleSheetsUrl,
    saveTransposeHighlightRulesToCloud,
    loadTransposeHighlightRulesFromCloud,
    saveDisplaySettingsToCloud,
    loadDisplaySettingsFromCloud,
    saveFavoritesToCloud,
    loadFavoritesFromCloud,
    loadGalleryCategoriesFromCloud,
    upsertGalleryCategoryToCloud,
    CloudHighlightRule,
    CloudDisplaySettings
} from '../services/firebaseService';
import { getGoogleAccessToken } from '@/services/authService';
import {
    ArrowRightLeft,
    Copy,
    Check,
    Download,
    ChevronDown,
    ChevronUp,
    ChevronLeft,
    ChevronRight,
    Info,
    Zap,
    Calendar,
    Hash,
    Type,
    ListOrdered,
    Plus,
    Trash2,
    Save,
    Bookmark,
    Cloud,
    CloudOff,
    Loader2,
    Link2,
    ExternalLink,
    RefreshCw,
    RotateCcw,
    Star,
    Tag,
    X,
    AlertCircle,
    Sparkles
} from 'lucide-react';

// Types
interface SortRule {
    column: string;
    descending: boolean;
}

// Custom filter for advanced filtering
interface CustomFilter {
    id: string;
    column: string;
    operator: 'contains' | 'notContains' | 'equals' | 'notEquals' | 'startsWith' | 'endsWith' |
    'notEmpty' | 'isEmpty' | 'regex' | 'multiSelect' |
    'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' | 'between';
    value: string;
    value2?: string;  // For 'between' operator
    selectedValues?: string[];  // For 'multiSelect' mode
}

interface TransposeConfig {
    groupColumn: string;           // Column to group by (backward compatible)
    groupColumns: string[];        // Multi-level group columns (new)
    dataColumns: string[];         // Columns to transpose (A4)
    pageSize: number;              // Items per page (A6)
    mergeThreshold: number;        // Merge small groups threshold (A8)
    fuzzyRules: FuzzyRule[];       // Fuzzy matching rules (A9)
    sortColumn: string;            // Column to sort by (A10) - deprecated, use sortRules
    sortDescending: boolean;       // Sort direction - deprecated, use sortRules
    sortRules: SortRule[];         // Multi-level sort rules (new)
    filterDateColumn: string;      // Date filter column (A11)
    filterStartDate: string;       // Start date filter (A12)
    filterEndDate: string;         // End date filter (A13)
    filterNumColumn: string;       // Number filter column (A14)
    filterMinNum: number | null;   // Minimum number filter (A15)
    customFilters: CustomFilter[]; // Custom advanced filters
}

interface FuzzyRule {
    target: string;
    keywords: string[];
}

interface GroupResult {
    key: string;
    type: 'date' | 'text' | 'number' | 'numbered' | 'mixed';
    count: number;
    sortKey?: number;
    members?: { key: string; type: string }[];
    rows: DataRow[];
    label?: string;
    level?: number;  // Group depth level (0 = root)
    children?: GroupResult[];  // Nested sub-groups
    parentKey?: string;  // Parent group key for breadcrumb
}

interface TransposeOutput {
    label: string;
    column: string;
    data: (string | number | null)[];
    rows?: DataRow[];
    formula?: string;
}

// Favorites & Categories (shared with gallery)
interface FavoriteItem {
    id: string;
    imageUrl: string;
    rowData: DataRow;
    addedAt: number;
    folderId?: string;
}

interface FavoriteFolder {
    id: string;
    name: string;
    emoji?: string;
    createdAt: number;
}

const FAVORITES_KEY = 'sheetmind-gallery-favorites';
const FAVORITE_FOLDERS_KEY = 'sheetmind-gallery-favorite-folders';
const GALLERY_CONFIG_KEY = 'sheetmind-gallery-config';
const DEFAULT_FOLDER_ID = 'default';
const CATEGORY_HEADER = '媒体标签';
const DEFAULT_CATEGORY_OPTIONS = ['婴儿/幼儿', '小学生/学生', '家庭', '成年男性', '成年女性', '老人', '主耶稣', '玛丽亚'];

// Helper to sanitize rowData for Firebase (empty field names are not allowed)
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

// Highlight rule for conditional cell background coloring
interface HighlightRule {
    id: string;
    column: string;  // Column to check - REQUIRED for row-level highlighting
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
    color: string;   // Background color
}

interface TransposePanelProps {
    data: SheetData;
    sharedConfig?: import('../types/sharedConfig').SharedConfig;
}

type GroupLevel = import('../types/sharedConfig').GroupLevel;

// Config preset for saving/loading configurations
interface ConfigPreset {
    id: string;
    name: string;
    config: TransposeConfig;
    createdAt: number;
}

// Clickable number component - shows text by default, input on click
const ClickableNumber: React.FC<{
    value: number;
    min: number;
    max: number;
    onChange: (val: number) => void;
    suffix?: string;
}> = ({ value, min, max, onChange, suffix = 'px' }) => {
    const [editing, setEditing] = React.useState(false);
    const [tempValue, setTempValue] = React.useState(String(value));
    const inputRef = React.useRef<HTMLInputElement>(null);

    React.useEffect(() => {
        if (editing && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editing]);

    React.useEffect(() => {
        setTempValue(String(value));
    }, [value]);

    const handleBlur = () => {
        setEditing(false);
        const num = Math.min(max, Math.max(min, Number(tempValue) || min));
        onChange(num);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleBlur();
        } else if (e.key === 'Escape') {
            setEditing(false);
            setTempValue(String(value));
        }
    };

    if (editing) {
        return (
            <input
                ref={inputRef}
                type="text"
                value={tempValue}
                onChange={(e) => {
                    const val = e.target.value;
                    if (val === '' || /^-?\d*$/.test(val)) {
                        setTempValue(val);
                    }
                }}
                onBlur={handleBlur}
                onKeyDown={handleKeyDown}
                style={{ backgroundColor: 'white', color: '#374151' }}
                className="w-12 h-5 text-[11px] text-right border border-[#dadce0] rounded px-1.5 focus:ring-1 focus:ring-[#1a73e8] focus:border-[#1a73e8] focus:outline-none font-normal"
            />
        );
    }

    return (
        <span
            onClick={() => setEditing(true)}
            onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault();
                    setEditing(true);
                }
            }}
            className="inline-flex items-center justify-end min-w-[2.5rem] h-5 px-1.5 text-[11px] font-normal text-[#5f6368] bg-[#f8f9fa] border border-[#dadce0] rounded cursor-pointer transition-colors hover:bg-[#e8eaed] hover:text-[#202124]"
            role="button"
            tabIndex={0}
        >
            {value}{suffix}
        </span>
    );
};

const defaultConfig: TransposeConfig = {
    groupColumn: '',
    groupColumns: [],
    dataColumns: [],
    pageSize: 0, // 0 = no pagination, show all data in group
    mergeThreshold: 2,
    fuzzyRules: [],
    sortColumn: '',
    sortDescending: true, // default to descending
    sortRules: [], // multi-level sort rules
    filterDateColumn: '',
    filterStartDate: '',
    filterEndDate: '',
    filterNumColumn: '',
    filterMinNum: null,
    customFilters: [], // Custom advanced filters
};

const getDefaultTransposeConfig = (columns: string[]): TransposeConfig => {
    const defaultDataCols = ['贴文多媒体', '贴文链接'].filter(col => columns.includes(col));
    const fallbackCols = defaultDataCols.length > 0
        ? defaultDataCols
        : columns.slice(0, Math.min(2, columns.length));
    return {
        ...defaultConfig,
        dataColumns: fallbackCols,
    };
};

// Helper: Parse fuzzy rules string
const parseFuzzyRules = (ruleText: string): FuzzyRule[] => {
    if (!ruleText) return [];
    return ruleText.split(';')
        .map(item => item.trim())
        .filter(Boolean)
        .map(item => {
            const [targetRaw, keywordsRaw] = item.split('=');
            if (!targetRaw || !keywordsRaw) return null;
            const target = targetRaw.trim();
            const keywords = keywordsRaw.split('|').map(k => k.trim().toLowerCase()).filter(Boolean);
            if (!target || keywords.length === 0) return null;
            return { target, keywords };
        })
        .filter((x): x is FuzzyRule => x !== null);
};

// Helper: Detect value type and extract group key
const getGroupKey = (val: unknown, fuzzyRules: FuzzyRule[]): { key: string; type: 'date' | 'text' | 'number' | 'numbered'; sortKey?: number; originalText?: string } | null => {
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
        return { key: String(minNum), type: 'numbered', sortKey: minNum, originalText: s };
    }

    // Check if it's a date-like string (with or without time)
    // Matches: YYYY-MM-DD, YYYY/MM/DD, YYYY-MM-DD HH:MM, YYYY-MM-DD HH:MM:SS, etc.
    const dateMatch = s.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:\s+\d{1,2}:\d{1,2}(?::\d{1,2})?)?/);
    if (dateMatch) {
        const y = dateMatch[1];
        const m = dateMatch[2].padStart(2, '0');
        const d = dateMatch[3].padStart(2, '0');
        return { key: `${y}-${m}-${d}`, type: 'date' };
    }

    // Fuzzy match
    const lower = s.toLowerCase();
    const matchedRule = fuzzyRules.find(rule => rule.keywords.some(kw => lower.includes(kw)));
    if (matchedRule) {
        return { key: matchedRule.target, type: 'text' };
    }

    return { key: s, type: 'text' };
};

// Format date for display
const formatDateValue = (val: unknown): string => {
    if (val instanceof Date) {
        const y = val.getFullYear();
        const m = val.getMonth() + 1;
        const d = val.getDate();
        return `${y}-${m < 10 ? '0' + m : m}-${d < 10 ? '0' + d : d}`;
    }
    return String(val || '');
};

const parseDateValue = (val: unknown): Date | null => {
    if (!val) return null;
    if (val instanceof Date) return val;
    if (typeof val === 'number' || (typeof val === 'string' && /^\d+(\.\d+)?$/.test(val.trim()))) {
        const num = typeof val === 'number' ? val : parseFloat(val);
        if (!isNaN(num) && num >= 1 && num < 100000) {
            const excelEpoch = new Date(1899, 11, 30);
            const msPerDay = 24 * 60 * 60 * 1000;
            const date = new Date(excelEpoch.getTime() + num * msPerDay);
            if (!isNaN(date.getTime())) return date;
        }
    }
    const str = String(val);
    const date = new Date(str);
    if (!isNaN(date.getTime())) return date;
    const cnMatch = str.match(/(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (cnMatch) {
        return new Date(parseInt(cnMatch[1], 10), parseInt(cnMatch[2], 10) - 1, parseInt(cnMatch[3], 10));
    }
    return null;
};

// Main Component
const TransposePanel: React.FC<TransposePanelProps> = ({ data, sharedConfig }) => {
    // Use props.data directly (data source management is now global)
    const activeData = data;

    const [config, setConfig] = useState<TransposeConfig>(() => {
        return getDefaultTransposeConfig(data.columns);
    });

    const [showAdvanced, setShowAdvanced] = useState(false);
    const [fuzzyRuleText, setFuzzyRuleText] = useState('');
    const [copied, setCopied] = useState(false);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
    // Display settings storage key
    const DISPLAY_SETTINGS_KEY = 'transpose_display_settings';

    // Load display settings from localStorage
    const loadDisplaySettings = () => {
        try {
            const saved = localStorage.getItem(DISPLAY_SETTINGS_KEY);
            if (saved) return JSON.parse(saved);
        } catch { /* ignore */ }
        return null;
    };

    // Thumbnail size controls - with localStorage persistence
    const savedDisplay = loadDisplaySettings();
    const [thumbnailSize, setThumbnailSize] = useState(savedDisplay?.thumbnailSize ?? 170); // pixels for image row height (default 170)
    const [normalRowHeight, setNormalRowHeight] = useState(savedDisplay?.normalRowHeight ?? 36); // pixels for normal row height  
    const [cellWidth, setCellWidth] = useState(savedDisplay?.cellWidth ?? 100); // pixels for width
    const [borderWidth, setBorderWidth] = useState(savedDisplay?.borderWidth ?? 1); // border width in pixels
    const [borderColor, setBorderColor] = useState(savedDisplay?.borderColor ?? '#e2e8f0'); // border color (slate-200)
    const [columnRowHeights, setColumnRowHeights] = useState<Record<string, number>>(savedDisplay?.columnRowHeights ?? {}); // per-column height overrides

    // UI controls
    const [showGroupPreview, setShowGroupPreview] = useState(true); // toggle group preview section
    const [showOutputPreview, setShowOutputPreview] = useState(true); // toggle output preview section
    const [hoverPreview, setHoverPreview] = useState(false); // enable hover image preview
    const [showDisplaySettings, setShowDisplaySettings] = useState(true); // toggle display settings panel - default open
    const [showColumnHeights, setShowColumnHeights] = useState(false); // toggle per-column height settings - default closed
    const [showLeftPanel, setShowLeftPanel] = useState(true); // toggle left panel
    const [sheetName, setSheetName] = useState('Sheet1'); // source sheet name for formulas
    const [copiedData, setCopiedData] = useState(false); // copy data indicator
    const [hoveredImage, setHoveredImage] = useState<string | null>(null); // currently hovered image URL for preview
    const [draggedColumn, setDraggedColumn] = useState<string | null>(null); // for drag-drop reordering
    const [draggedSortIndex, setDraggedSortIndex] = useState<number | null>(null); // for sort rule drag-drop
    const [visibleRowCount, setVisibleRowCount] = useState(50); // for progressive loading
    const [showAllRows, setShowAllRows] = useState(false); // show all rows instantly without progressive loading

    const loadCategoryOptionsFromGalleryConfig = () => {
        if (typeof window === 'undefined') return DEFAULT_CATEGORY_OPTIONS;
        try {
            const saved = localStorage.getItem(GALLERY_CONFIG_KEY);
            if (!saved) return DEFAULT_CATEGORY_OPTIONS;
            const parsed = JSON.parse(saved);
            if (Array.isArray(parsed?.categoryOptions) && parsed.categoryOptions.length > 0) {
                return parsed.categoryOptions;
            }
        } catch { /* ignore */ }
        return DEFAULT_CATEGORY_OPTIONS;
    };

    // Favorites + categories (shared with gallery storage)
    const [showFavoritesPanel, setShowFavoritesPanel] = useState(true);
    const [showFavoriteButton, setShowFavoriteButton] = useState(() => {
        if (typeof window === 'undefined') return true;
        return localStorage.getItem('transpose_show_favorite_button') !== 'false';
    });
    const [showCategoryButton, setShowCategoryButton] = useState(() => {
        if (typeof window === 'undefined') return true;
        return localStorage.getItem('transpose_show_category_button') !== 'false';
    });
    const [favoriteTargetFolderId, setFavoriteTargetFolderId] = useState(DEFAULT_FOLDER_ID);
    const [favoritesNotice, setFavoritesNotice] = useState<string | null>(null);
    const [favorites, setFavorites] = useState<FavoriteItem[]>(() => {
        if (typeof window === 'undefined') return [];
        try {
            const saved = localStorage.getItem(FAVORITES_KEY);
            return saved ? JSON.parse(saved) : [];
        } catch { /* ignore */ }
        return [];
    });
    const [favoriteFolders, setFavoriteFolders] = useState<FavoriteFolder[]>(() => {
        if (typeof window === 'undefined') return [{ id: DEFAULT_FOLDER_ID, name: '默认收藏夹', emoji: '⭐', createdAt: Date.now() }];
        try {
            const saved = localStorage.getItem(FAVORITE_FOLDERS_KEY);
            const parsed = saved ? JSON.parse(saved) : [];
            const hasDefault = parsed.some((f: FavoriteFolder) => f.id === DEFAULT_FOLDER_ID);
            if (!hasDefault) {
                parsed.unshift({ id: DEFAULT_FOLDER_ID, name: '默认收藏夹', emoji: '⭐', createdAt: Date.now() });
            }
            return parsed.length > 0 ? parsed : [{ id: DEFAULT_FOLDER_ID, name: '默认收藏夹', emoji: '⭐', createdAt: Date.now() }];
        } catch { /* ignore */ }
        return [{ id: DEFAULT_FOLDER_ID, name: '默认收藏夹', emoji: '⭐', createdAt: Date.now() }];
    });
    const [newFolderName, setNewFolderName] = useState('');
    const [newFolderEmoji, setNewFolderEmoji] = useState('📁');
    const [categoryOptions, setCategoryOptions] = useState<string[]>(loadCategoryOptionsFromGalleryConfig);
    const [newCategoryOption, setNewCategoryOption] = useState('');
    const [galleryCategories, setGalleryCategories] = useState<Map<string, string>>(new Map());
    const [favoriteMenu, setFavoriteMenu] = useState<{
        isOpen: boolean;
        x: number;
        y: number;
        imageUrl: string;
        row: DataRow | null;
    } | null>(null);
    const favoriteMenuRef = React.useRef<HTMLDivElement>(null);
    const [favoriteMenuPos, setFavoriteMenuPos] = useState<{ x: number; y: number } | null>(null);
    const [categoryModal, setCategoryModal] = useState<{
        isOpen: boolean;
        imageUrl: string;
        rowIndex: number;
        currentCategory: string;
        isSaving: boolean;
    }>({
        isOpen: false,
        imageUrl: '',
        rowIndex: -1,
        currentCategory: '',
        isSaving: false
    });

    // Confirm dialog state (to replace native confirm())
    const [confirmDialog, setConfirmDialog] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        type: 'info' | 'warning' | 'danger';
        confirmText?: string;
        cancelText?: string;
        onConfirm: () => void;
    } | null>(null);

    // Cell selection state (like Google Sheets)
    const [selectionStart, setSelectionStart] = useState<{ row: number, col: number } | null>(null);
    const [selectionEnd, setSelectionEnd] = useState<{ row: number, col: number } | null>(null);
    const [isSelecting, setIsSelecting] = useState(false);
    const tableRef = React.useRef<HTMLTableElement>(null);

    // Highlight rules state
    const [highlightRules, setHighlightRules] = useState<HighlightRule[]>(() => {
        try {
            const saved = localStorage.getItem('transpose_highlight_rules');
            if (saved) return JSON.parse(saved);
        } catch { /* ignore */ }
        return [];
    });
    const [showHighlightRules, setShowHighlightRules] = useState(true); // Always show highlight rules
    const [highlightRulesSyncing, setHighlightRulesSyncing] = useState(false);
    const isUsingSharedConfig = !!sharedConfig;
    const sharedConfigKeys = useMemo(() => new Set<keyof TransposeConfig>([
        'groupColumn',
        // Note: 'dataColumns' is intentionally NOT in this set
        // This allows users to customize column ORDER in TransposePanel
        // while the CONTENT of columns still comes from sharedConfig.displayColumns
        'filterDateColumn',
        'filterStartDate',
        'filterEndDate',
        'customFilters',
        'sortRules',
    ]), []);

    const effectiveImageColumn = useMemo(() => {
        if (sharedConfig?.imageColumn) return sharedConfig.imageColumn;
        const candidate = data.columns.find(col => /图片|多媒体|媒体|image/i.test(col));
        return candidate || '';
    }, [sharedConfig?.imageColumn, data.columns]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
        } catch (err) {
            console.warn('[Favorites] localStorage quota exceeded, skipping local save:', err);
        }

        if (isUserLoggedIn()) {
            const syncTimeout = setTimeout(async () => {
                try {
                    const cloudPayload = favorites.map(f => ({
                        id: f.id,
                        imageUrl: f.imageUrl,
                        rowData: sanitizeRowDataForCloud(f.rowData as Record<string, unknown>),
                        addedAt: f.addedAt
                    }));
                    await saveFavoritesToCloud(cloudPayload);
                } catch (err) {
                    console.error('[Favorites] 云端同步失败:', err);
                }
            }, 800);
            return () => clearTimeout(syncTimeout);
        }
    }, [favorites]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem('transpose_show_favorite_button', String(showFavoriteButton));
    }, [showFavoriteButton]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem('transpose_show_category_button', String(showCategoryButton));
    }, [showCategoryButton]);

    // Load favorites from Firebase on mount
    useEffect(() => {
        const loadCloudFavorites = async () => {
            if (!isUserLoggedIn()) return;
            try {
                const cloudFavs = await loadFavoritesFromCloud();
                if (cloudFavs.length === 0) return;
                setFavorites(prev => {
                    const merged = new Map<string, FavoriteItem>();
                    prev.forEach(f => merged.set(f.imageUrl, f));
                    cloudFavs.forEach(f => {
                        const existing = merged.get(f.imageUrl);
                        merged.set(f.imageUrl, {
                            id: f.id,
                            imageUrl: f.imageUrl,
                            rowData: f.rowData as DataRow,
                            addedAt: f.addedAt,
                            folderId: existing?.folderId || DEFAULT_FOLDER_ID
                        });
                    });
                    return Array.from(merged.values()).sort((a, b) => b.addedAt - a.addedAt);
                });
            } catch (err) {
                console.error('[Favorites] 云端加载失败:', err);
            }
        };
        loadCloudFavorites();
    }, []);

    // Save folders to localStorage
    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem(FAVORITE_FOLDERS_KEY, JSON.stringify(favoriteFolders));
    }, [favoriteFolders]);

    // Persist category options into gallery config storage
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            const saved = localStorage.getItem(GALLERY_CONFIG_KEY);
            const parsed = saved ? JSON.parse(saved) : {};
            const next = { ...parsed, categoryOptions };
            localStorage.setItem(GALLERY_CONFIG_KEY, JSON.stringify(next));
        } catch { /* ignore */ }
    }, [categoryOptions]);

    // Save highlight rules to localStorage and sync to Firebase
    useEffect(() => {
        localStorage.setItem('transpose_highlight_rules', JSON.stringify(highlightRules));

        // Sync to Firebase if logged in (debounced)
        if (isUserLoggedIn()) {
            const syncTimeout = setTimeout(async () => {
                try {
                    setHighlightRulesSyncing(true);
                    await saveTransposeHighlightRulesToCloud(highlightRules as CloudHighlightRule[]);
                } catch (err) {
                    console.error('[Cloud Sync] Failed to save highlight rules:', err);
                } finally {
                    setHighlightRulesSyncing(false);
                }
            }, 2000); // 2 second debounce
            return () => clearTimeout(syncTimeout);
        }
    }, [highlightRules]);

    useEffect(() => {
        if (!isUsingSharedConfig || !sharedConfig) return;
        setConfig(prev => ({
            ...prev,
            groupColumn: sharedConfig.groupColumn,
            dataColumns: sharedConfig.displayColumns,
            filterDateColumn: sharedConfig.dateColumn,
            filterStartDate: sharedConfig.dateStart,
            filterEndDate: sharedConfig.dateEnd,
            customFilters: sharedConfig.customFilters,
            sortRules: sharedConfig.sortRules,
        }));
        setHighlightRules(sharedConfig.highlightRules ?? []);
    }, [isUsingSharedConfig, sharedConfig]);

    useEffect(() => {
        if (!favoriteMenu?.isOpen) {
            setFavoriteMenuPos(null);
            return;
        }
        const adjustPosition = () => {
            if (!favoriteMenuRef.current) return;
            const rect = favoriteMenuRef.current.getBoundingClientRect();
            const gap = 8;
            const maxX = window.innerWidth - rect.width - gap;
            const maxY = window.innerHeight - rect.height - gap;
            const x = Math.max(gap, Math.min(favoriteMenu.x, maxX));
            const y = Math.max(gap, Math.min(favoriteMenu.y, maxY));
            setFavoriteMenuPos({ x, y });
        };
        adjustPosition();
        window.addEventListener('resize', adjustPosition);
        return () => window.removeEventListener('resize', adjustPosition);
    }, [favoriteMenu]);

    // Load categories from sheet data
    useEffect(() => {
        const categoryColumn = data.columns.find(h => h === CATEGORY_HEADER || h === 'Category' || h === '分类' || h === 'V');
        if (!categoryColumn || !effectiveImageColumn) return;

        setGalleryCategories(prev => {
            const next = new Map(prev);
            data.rows.forEach(row => {
                const rawImage = row[effectiveImageColumn];
                const imageUrl = rawImage ? extractImageFromFormula(String(rawImage)) || String(rawImage) : '';
                if (!imageUrl) return;
                const categoryValue = row[categoryColumn];
                if (categoryValue) {
                    next.set(imageUrl, String(categoryValue).trim());
                }
            });
            return next;
        });
    }, [data.rows, data.columns, effectiveImageColumn]);

    // Load categories from cloud
    useEffect(() => {
        const loadCloudCategories = async () => {
            if (!isUserLoggedIn()) return;
            try {
                const cloudCategories = await loadGalleryCategoriesFromCloud();
                if (cloudCategories.length === 0) return;
                setGalleryCategories(prev => {
                    const next = new Map(prev);
                    cloudCategories.forEach((item: any) => {
                        if (item?.imageUrl && item?.category) {
                            next.set(item.imageUrl, item.category);
                        }
                    });
                    return next;
                });
            } catch (err) {
                console.error('[Category] 云端加载失败:', err);
            }
        };
        loadCloudCategories();
    }, []);

    // Load highlight rules from Firebase on mount
    useEffect(() => {
        const loadCloudHighlightRules = async () => {
            if (!isUserLoggedIn()) return;
            try {
                const cloudRules = await loadTransposeHighlightRulesFromCloud();
                if (cloudRules.length > 0) {
                    // Cloud takes priority, merge with local if needed
                    setHighlightRules(cloudRules as HighlightRule[]);
                }
            } catch (err) {
                console.error('[Cloud Sync] Failed to load highlight rules:', err);
            }
        };
        loadCloudHighlightRules();
    }, []);

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

    // Check if a value matches a single rule
    const matchesRule = useCallback((value: unknown, rule: HighlightRule): boolean => {
        const rawVal = String(value ?? '');
        const strVal = rawVal.toLowerCase();
        const numVal = parseNumericValue(rawVal);
        const ruleVal = (rule.value || '').toLowerCase();
        const ruleNum = parseNumericValue(rule.value || '');
        const ruleNum2 = rule.value2 ? parseNumericValue(rule.value2) : null;

        // Try to parse date
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);

        let dateValue: Date | null = null;
        const dateMatch = rawVal.match(/(\d{4})[/-](\d{1,2})[/-](\d{1,2})/);
        if (dateMatch) {
            dateValue = new Date(parseInt(dateMatch[1]), parseInt(dateMatch[2]) - 1, parseInt(dateMatch[3]));
        }

        switch (rule.operator) {
            // Text operators
            case 'contains':
                return ruleVal ? strVal.includes(ruleVal) : false;
            case 'notContains':
                return ruleVal ? !strVal.includes(ruleVal) : true;
            case 'equals':
                return strVal === ruleVal;
            case 'notEquals':
                return strVal !== ruleVal;
            case 'startsWith':
                return ruleVal ? strVal.startsWith(ruleVal) : false;
            case 'endsWith':
                return ruleVal ? strVal.endsWith(ruleVal) : false;
            case 'notEmpty':
                return strVal.trim().length > 0;
            case 'isEmpty':
                return strVal.trim().length === 0;
            case 'regex':
                try {
                    if (rule.value) {
                        const regex = new RegExp(rule.value, 'i');
                        return regex.test(rawVal);
                    }
                } catch { return false; }
                return false;

            // Numeric operators
            case 'greaterThan':
                return numVal !== null && ruleNum !== null && numVal > ruleNum;
            case 'lessThan':
                return numVal !== null && ruleNum !== null && numVal < ruleNum;
            case 'greaterOrEqual':
                return numVal !== null && ruleNum !== null && numVal >= ruleNum;
            case 'lessOrEqual':
                return numVal !== null && ruleNum !== null && numVal <= ruleNum;
            case 'between':
                return numVal !== null && ruleNum !== null && ruleNum2 !== null && numVal >= ruleNum && numVal <= ruleNum2;

            // Date operators
            case 'dateEquals':
                if (dateValue && rule.value) {
                    const targetDate = new Date(rule.value);
                    return dateValue.toDateString() === targetDate.toDateString();
                }
                return false;
            case 'dateBefore':
                if (dateValue && rule.value) {
                    const targetDate = new Date(rule.value);
                    return dateValue < targetDate;
                }
                return false;
            case 'dateAfter':
                if (dateValue && rule.value) {
                    const targetDate = new Date(rule.value);
                    return dateValue > targetDate;
                }
                return false;
            case 'today':
                return dateValue !== null && dateValue.toDateString() === today.toDateString();
            case 'thisWeek':
                return dateValue !== null && dateValue >= weekStart && dateValue <= today;
            case 'thisMonth':
                return dateValue !== null && dateValue >= monthStart && dateValue <= today;

            // Link operators
            case 'hasLink':
                return /https?:\/\/[^\s]+/.test(rawVal);
            case 'hasImageLink':
                return /https?:\/\/[^\s]+\.(jpg|jpeg|png|gif|webp|bmp)/i.test(rawVal);
            case 'hasFormula':
                return rawVal.startsWith('=');
            default:
                return false;
        }
    }, []);



    // checkRowHighlight 和 checkHighlight 移到 activeHighlightRules 之后

    // Row resize state
    const [resizingRow, setResizingRow] = useState<string | null>(null); // label of row being resized
    const [resizeStartY, setResizeStartY] = useState(0);
    const [resizeStartHeight, setResizeStartHeight] = useState(0);

    // Handle row resize
    const handleRowResizeStart = (label: string, currentHeight: number, e: React.MouseEvent) => {
        e.preventDefault();
        setResizingRow(label);
        setResizeStartY(e.clientY);
        setResizeStartHeight(currentHeight);
    };

    // Mouse move handler for row resize
    React.useEffect(() => {
        if (!resizingRow) return;

        const handleMouseMove = (e: MouseEvent) => {
            const delta = e.clientY - resizeStartY;
            const newHeight = Math.max(24, Math.min(300, resizeStartHeight + delta));
            setColumnRowHeights(prev => ({ ...prev, [resizingRow]: newHeight }));
        };

        const handleMouseUp = () => {
            setResizingRow(null);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);

        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizingRow, resizeStartY, resizeStartHeight]);

    // Cell selection helpers
    const isCellSelected = useCallback((row: number, col: number): boolean => {
        if (!selectionStart || !selectionEnd) return false;
        const minRow = Math.min(selectionStart.row, selectionEnd.row);
        const maxRow = Math.max(selectionStart.row, selectionEnd.row);
        const minCol = Math.min(selectionStart.col, selectionEnd.col);
        const maxCol = Math.max(selectionStart.col, selectionEnd.col);
        return row >= minRow && row <= maxRow && col >= minCol && col <= maxCol;
    }, [selectionStart, selectionEnd]);

    const handleCellMouseDown = useCallback((row: number, col: number, e: React.MouseEvent) => {
        // Don't start selection if we're resizing a row
        if (resizingRow) return;
        e.preventDefault();
        setSelectionStart({ row, col });
        setSelectionEnd({ row, col });
        setIsSelecting(true);
    }, [resizingRow]);

    // Throttle selection updates for smoother dragging
    const selectionRafRef = React.useRef<number | null>(null);
    const handleCellMouseEnter = useCallback((row: number, col: number) => {
        // Don't extend selection if we're resizing a row
        if (isSelecting && !resizingRow) {
            // Cancel previous RAF
            if (selectionRafRef.current) {
                cancelAnimationFrame(selectionRafRef.current);
            }
            // Schedule update on next frame
            selectionRafRef.current = requestAnimationFrame(() => {
                setSelectionEnd({ row, col });
            });
        }
    }, [isSelecting, resizingRow]);

    const handleCellMouseUp = () => {
        setIsSelecting(false);
    };

    // Global mouse up to stop selection
    React.useEffect(() => {
        const handleGlobalMouseUp = () => setIsSelecting(false);
        document.addEventListener('mouseup', handleGlobalMouseUp);
        return () => document.removeEventListener('mouseup', handleGlobalMouseUp);
    }, []);

    // Config presets
    const [presets, setPresets] = useState<ConfigPreset[]>([]);
    const [activePresetId, setActivePresetId] = useState<string | null>(null);
    const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
    const [editingPresetName, setEditingPresetName] = useState('');

    // Cloud sync state
    const [cloudSyncEnabled, setCloudSyncEnabled] = useState(false);
    const [cloudSyncing, setCloudSyncing] = useState(false);
    const [cloudError, setCloudError] = useState<string | null>(null);

    // Google Sheets sync state
    const [sheetsUrl, setSheetsUrl] = useState('');
    const [sheetsSpreadsheetId, setSheetsSpreadsheetId] = useState<string | null>(null);
    const [sheetsSyncing, setSheetsSyncing] = useState(false);
    const [sheetsError, setSheetsError] = useState<string | null>(null);

    // Load presets from cloud on mount
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
                if (cloudPresets.length > 0) {
                    setPresets(cloudPresets.map(p => ({
                        id: p.id,
                        name: p.name,
                        config: p.config as unknown as TransposeConfig,
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

    // Save display settings to localStorage and sync to Firebase
    const [displaySettingsSyncing, setDisplaySettingsSyncing] = useState(false);
    useEffect(() => {
        const displaySettings = {
            thumbnailSize,
            normalRowHeight,
            cellWidth,
            borderWidth,
            borderColor,
            columnRowHeights
        };

        const saveTimeout = setTimeout(() => {
            localStorage.setItem(DISPLAY_SETTINGS_KEY, JSON.stringify(displaySettings));
        }, 300);

        // Also sync to Firebase (with longer debounce)
        let cloudSyncTimeout: NodeJS.Timeout | undefined;
        if (isUserLoggedIn()) {
            cloudSyncTimeout = setTimeout(async () => {
                try {
                    setDisplaySettingsSyncing(true);
                    await saveDisplaySettingsToCloud(displaySettings as CloudDisplaySettings);
                } catch (err) {
                    console.error('[Cloud Sync] Failed to save display settings:', err);
                } finally {
                    setDisplaySettingsSyncing(false);
                }
            }, 3000); // 3 second debounce for cloud
        }

        return () => {
            clearTimeout(saveTimeout);
            if (cloudSyncTimeout) clearTimeout(cloudSyncTimeout);
        };
    }, [thumbnailSize, normalRowHeight, cellWidth, borderWidth, borderColor, columnRowHeights]);

    // Load display settings from Firebase on mount
    useEffect(() => {
        const loadCloudDisplaySettings = async () => {
            if (!isUserLoggedIn()) return;
            try {
                const cloudSettings = await loadDisplaySettingsFromCloud();
                if (cloudSettings) {
                    // Only apply cloud settings if they exist
                    if (cloudSettings.thumbnailSize !== undefined) setThumbnailSize(cloudSettings.thumbnailSize);
                    if (cloudSettings.normalRowHeight !== undefined) setNormalRowHeight(cloudSettings.normalRowHeight);
                    if (cloudSettings.cellWidth !== undefined) setCellWidth(cloudSettings.cellWidth);
                    if (cloudSettings.borderWidth !== undefined) setBorderWidth(cloudSettings.borderWidth);
                    if (cloudSettings.borderColor !== undefined) setBorderColor(cloudSettings.borderColor);
                    if (cloudSettings.columnRowHeights !== undefined) setColumnRowHeights(cloudSettings.columnRowHeights);
                }
            } catch (err) {
                console.error('[Cloud Sync] Failed to load display settings:', err);
            }
        };
        loadCloudDisplaySettings();
    }, []);

    const filterSharedUpdates = useCallback((updates: Partial<TransposeConfig>) => {
        if (!isUsingSharedConfig) return updates;
        const filtered: Partial<TransposeConfig> = {};
        Object.entries(updates).forEach(([key, value]) => {
            if (!sharedConfigKeys.has(key as keyof TransposeConfig)) {
                filtered[key as keyof TransposeConfig] = value as never;
            }
        });
        return filtered;
    }, [isUsingSharedConfig, sharedConfigKeys]);

    const handleResetConfig = useCallback(() => {
        setConfig(getDefaultTransposeConfig(activeData.columns));
        setFuzzyRuleText('');
        setHighlightRules([]);
        setActivePresetId(null);
        setEditingPresetId(null);
        setEditingPresetName('');
        localStorage.removeItem('transpose_highlight_rules');
    }, [activeData.columns]);

    // Update config helper
    const updateConfig = useCallback((updates: Partial<TransposeConfig>) => {
        const filtered = filterSharedUpdates(updates);
        if (Object.keys(filtered).length === 0) return;
        setConfig(prev => ({ ...prev, ...filtered }));
        setActivePresetId(null); // Mark as modified
    }, [filterSharedUpdates]);

    // Save current config as preset
    const savePreset = useCallback(async () => {
        // Default name: groupColumn + sortRules summary
        const sortInfo = config.sortRules.length > 0
            ? ` (${config.sortRules.map(r => r.column).join('→')})`
            : '';
        const name = config.groupColumn
            ? `${config.groupColumn}${sortInfo}`
            : `版本 ${presets.length + 1}`;
        const newPreset: ConfigPreset = {
            id: Date.now().toString(),
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
    const loadPreset = useCallback((preset: ConfigPreset) => {
        // Filter columns to only include ones that exist in current data source
        const availableColumns = activeData.columns;
        const filteredConfig: TransposeConfig = {
            ...preset.config,
            groupColumn: availableColumns.includes(preset.config.groupColumn)
                ? preset.config.groupColumn
                : (availableColumns[0] || ''),
            dataColumns: preset.config.dataColumns.filter(col => availableColumns.includes(col)),
            sortRules: preset.config.sortRules.filter(rule => availableColumns.includes(rule.column)),
            filterDateColumn: preset.config.filterDateColumn && availableColumns.includes(preset.config.filterDateColumn)
                ? preset.config.filterDateColumn
                : '',
            filterNumColumn: preset.config.filterNumColumn && availableColumns.includes(preset.config.filterNumColumn)
                ? preset.config.filterNumColumn
                : '',
        };
        if (isUsingSharedConfig) {
            const filtered = filterSharedUpdates(filteredConfig);
            if (Object.keys(filtered).length > 0) {
                setConfig(prev => ({ ...prev, ...filtered }));
            }
        } else {
            setConfig(filteredConfig);
        }
        setActivePresetId(preset.id);
    }, [activeData.columns, filterSharedUpdates, isUsingSharedConfig]);

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

    // Note: sharedConfig uses different field names than TransposeConfig
    const effectiveGroupLevels = useMemo<GroupLevel[]>(() => {
        if (isUsingSharedConfig) {
            if (sharedConfig?.groupLevels && sharedConfig.groupLevels.length > 0) {
                const validLevels = sharedConfig.groupLevels.filter(level => level && level.column);
                if (validLevels.length > 0) {
                    return validLevels as GroupLevel[];
                }
            }
            const cols = sharedConfig?.groupColumns?.length
                ? sharedConfig.groupColumns
                : sharedConfig?.groupColumn ? [sharedConfig.groupColumn] : [];
            return cols.map((col, idx) => ({ id: `legacy-${idx}`, column: col, type: 'text' }));
        }
        const validLevels = config.groupColumns?.length ? config.groupColumns.filter(c => c) : [];
        const cols = validLevels.length > 0
            ? validLevels
            : config.groupColumn ? [config.groupColumn] : [];
        return cols.map((col, idx) => ({ id: `local-${idx}`, column: col, type: 'text' }));
    }, [isUsingSharedConfig, sharedConfig, config.groupColumns, config.groupColumn]);

    const effectiveGroupColumns = useMemo(
        () => effectiveGroupLevels.map(level => level.column).filter(Boolean),
        [effectiveGroupLevels]
    );

    const effectiveGroupColumn = effectiveGroupColumns[0] || ''; // First level for backward compatibility
    const filtersEnabled = isUsingSharedConfig ? (sharedConfig?.filtersEnabled ?? true) : true;
    const sortEnabled = isUsingSharedConfig ? (sharedConfig?.sortEnabled ?? true) : true;
    const highlightEnabled = isUsingSharedConfig ? (sharedConfig?.highlightEnabled ?? true) : true;

    // Check if a ROW should be highlighted (based on specified column value, highlights ENTIRE row)
    const activeHighlightRules = useMemo(
        () => (highlightEnabled ? highlightRules : []),
        [highlightEnabled, highlightRules]
    );

    const checkRowHighlight = useCallback((row: DataRow): string | null => {
        for (const rule of activeHighlightRules) {
            if (!rule.column) continue; // Must have a column specified
            const value = row[rule.column];
            if (matchesRule(value, rule)) {
                return rule.color;
            }
        }
        return null;
    }, [activeHighlightRules, matchesRule]);

    // Legacy: Check if a single cell value matches any highlight rule (for backward compat)
    const checkHighlight = useCallback((value: unknown, column?: string): string | null => {
        for (const rule of activeHighlightRules) {
            if (rule.column && rule.column !== column) continue;
            if (matchesRule(value, rule)) {
                return rule.color;
            }
        }
        return null;
    }, [activeHighlightRules, matchesRule]);
    const effectiveDateColumn = isUsingSharedConfig ? sharedConfig!.dateColumn : config.filterDateColumn;
    const effectiveDateStart = filtersEnabled ? (isUsingSharedConfig ? sharedConfig!.dateStart : config.filterStartDate) : '';
    const effectiveDateEnd = filtersEnabled ? (isUsingSharedConfig ? sharedConfig!.dateEnd : config.filterEndDate) : '';
    const effectiveDataColumns = useMemo(() => {
        const baseColumns = isUsingSharedConfig ? (sharedConfig?.displayColumns || []) : config.dataColumns;
        if (!isUsingSharedConfig) return baseColumns;
        // When using shared config, use config.dataColumns as the custom order
        // If no custom order set, return base columns
        if (!config.dataColumns || config.dataColumns.length === 0) return baseColumns;
        // Reorder based on config.dataColumns order, but only include columns that exist in baseColumns
        const ordered = config.dataColumns.filter(col => baseColumns.includes(col));
        // Append any columns in baseColumns that weren't in config.dataColumns
        const rest = baseColumns.filter(col => !config.dataColumns.includes(col));
        return [...ordered, ...rest];
    }, [isUsingSharedConfig, sharedConfig, config.dataColumns]);
    const effectiveCustomFilters = filtersEnabled ? (isUsingSharedConfig ? sharedConfig!.customFilters : config.customFilters) : [];
    const effectiveSortRules = sortEnabled ? (isUsingSharedConfig ? sharedConfig!.sortRules : config.sortRules) : [];
    const effectiveNumFilters = filtersEnabled ? (isUsingSharedConfig ? sharedConfig!.numFilters : []) : [];
    const effectiveTextGrouping = isUsingSharedConfig ? sharedConfig!.textGrouping : false;
    const effectiveTextGroupBins = isUsingSharedConfig ? sharedConfig!.textGroupBins : [];
    const effectiveFuzzyRuleText = isUsingSharedConfig ? (sharedConfig!.fuzzyRuleText || '') : fuzzyRuleText;
    // highlightRules only exists in sharedConfig (TransposePanel doesn't have local highlight)

    // Parse and process data
    const { groups, outputPlan, stats } = useMemo(() => {
        // If no data columns selected, return empty
        if (effectiveDataColumns.length === 0) {
            return { groups: [], outputPlan: [], stats: { total: 0, groups: 0, type: 'unknown' } };
        }

        const fuzzyRules = parseFuzzyRules(fuzzyRuleText);

        // NO GROUPING MODE: When groupColumn is empty, chunk data by 25 items per row
        if (!effectiveGroupColumn) {
            const CHUNK_SIZE = 25;
            let filteredRows = [...activeData.rows]; // Copy for sorting

            // Apply filters
            filteredRows = filteredRows.filter(row => {
                // Date range filter
                if (effectiveDateColumn && (effectiveDateStart || effectiveDateEnd)) {
                    const dateVal = row[effectiveDateColumn];
                    if (!dateVal) return false;
                    const dateObj = parseDateValue(dateVal);
                    if (!dateObj) return false;
                    const startDate = effectiveDateStart ? new Date(effectiveDateStart) : null;
                    const endDate = effectiveDateEnd ? new Date(effectiveDateEnd) : null;
                    if (startDate && dateObj < startDate) return false;
                    if (endDate && dateObj > endDate) return false;
                }
                // Custom filters
                for (const cf of effectiveCustomFilters) {
                    if (!cf.column || !cf.operator) continue;
                    const val = String(row[cf.column] || '').toLowerCase();
                    const filterVal = String(cf.value || '').toLowerCase();
                    let passes = true;
                    switch (cf.operator) {
                        case 'contains': passes = val.includes(filterVal); break;
                        case 'notContains': passes = !val.includes(filterVal); break;
                        case 'equals': passes = val === filterVal; break;
                        case 'notEquals': passes = val !== filterVal; break;
                        case 'startsWith': passes = val.startsWith(filterVal); break;
                        case 'endsWith': passes = val.endsWith(filterVal); break;
                        case 'isEmpty': passes = val.trim() === ''; break;
                        case 'notEmpty': passes = val.trim() !== ''; break;
                    }
                    if (!passes) return false;
                }
                // Num filters
                for (const nf of effectiveNumFilters) {
                    if (!nf.column || !nf.operator) continue;
                    const rawValue = String(row[nf.column] || '');
                    const numValue = parseFloat(rawValue.replace(/[^0-9.-]/g, ''));
                    const ruleNumValue = parseFloat(String(nf.value || ''));
                    const ruleNumValue2 = parseFloat(String(nf.value2 || ''));
                    let pass = true;
                    switch (nf.operator) {
                        case 'greaterThan': pass = !isNaN(numValue) && numValue > ruleNumValue; break;
                        case 'lessThan': pass = !isNaN(numValue) && numValue < ruleNumValue; break;
                        case 'greaterOrEqual': pass = !isNaN(numValue) && numValue >= ruleNumValue; break;
                        case 'lessOrEqual': pass = !isNaN(numValue) && numValue <= ruleNumValue; break;
                        case 'equals': pass = !isNaN(numValue) && numValue === ruleNumValue; break;
                        case 'notEquals': pass = !isNaN(numValue) && numValue !== ruleNumValue; break;
                        case 'between': pass = !isNaN(numValue) && numValue >= ruleNumValue && numValue <= ruleNumValue2; break;
                        case 'notEmpty': pass = rawValue.trim() !== ''; break;
                        case 'isEmpty': pass = rawValue.trim() === ''; break;
                    }
                    if (!pass) return false;
                }
                return true;
            });

            // Apply sorting (same as grouped mode)
            if (effectiveSortRules.length > 0) {
                const tryParseNumber = (val: unknown): number | null => {
                    if (val === null || val === undefined) return null;
                    if (typeof val === 'number' && !isNaN(val)) return val;
                    if (typeof val !== 'string') return null;
                    let str = val.trim();
                    if (str === '' || !/\d/.test(str)) return null;
                    const isPercent = /%$/.test(str);
                    const unitMatch = str.match(/(万|亿|[kKmMbBwW])$/);
                    const unit = unitMatch?.[1] || '';
                    str = str.replace(/[,\s]/g, '').replace(/^[$¥€£₹]/, '').replace(/[()]/g, '').replace(/%$/, '').replace(/(万|亿|[kKmMbBwW])$/, '');
                    const numMatch = str.match(/^-?\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i);
                    if (!numMatch) return null;
                    let num = Number(str);
                    if (isNaN(num)) return null;
                    switch (unit) {
                        case 'k': case 'K': num *= 1e3; break;
                        case 'm': case 'M': num *= 1e6; break;
                        case 'b': case 'B': num *= 1e9; break;
                        case 'w': case 'W': case '万': num *= 1e4; break;
                        case '亿': num *= 1e8; break;
                    }
                    if (isPercent) num /= 100;
                    return num;
                };

                filteredRows.sort((a, b) => {
                    for (const rule of effectiveSortRules) {
                        if (!rule.column) continue;
                        let valA = a[rule.column];
                        let valB = b[rule.column];
                        let cmp = 0;
                        if (valA === valB) continue;
                        if (valA === null || valA === undefined || valA === '') {
                            cmp = 1;
                        } else if (valB === null || valB === undefined || valB === '') {
                            cmp = -1;
                        } else {
                            const numA = tryParseNumber(valA);
                            const numB = tryParseNumber(valB);
                            if (numA !== null && numB !== null) {
                                cmp = numA - numB;
                            } else {
                                cmp = String(valA).localeCompare(String(valB), 'zh-CN');
                            }
                        }
                        if (cmp !== 0) {
                            return rule.descending ? -cmp : cmp;
                        }
                    }
                    return 0;
                });
            }

            const totalRows = filteredRows.length;
            const numChunks = Math.ceil(totalRows / CHUNK_SIZE);

            const groupDefs: GroupResult[] = [];
            const output: TransposeOutput[] = [];

            for (let i = 0; i < numChunks; i++) {
                const start = i * CHUNK_SIZE;
                const end = Math.min(start + CHUNK_SIZE, totalRows);
                const chunkRows = filteredRows.slice(start, end);
                const label = `第${i + 1}行 (${start + 1}-${end})`;

                groupDefs.push({
                    key: label,
                    type: 'text',
                    count: chunkRows.length,
                    rows: chunkRows,
                    label,
                });

                // Output all columns for this chunk
                effectiveDataColumns.forEach(col => {
                    const chunkData = chunkRows.map(row => row[col]);
                    output.push({
                        label: `${col} [${label}]`,
                        column: col,
                        data: chunkData as (string | number | null)[],
                        rows: chunkRows,
                    });
                });
            }

            return {
                groups: groupDefs,
                outputPlan: output,
                stats: {
                    total: totalRows,
                    groups: numChunks,
                    type: 'sequential',
                }
            };
        }

        const groupCounts = new Map<string, number>();
        const groupTypes = new Map<string, 'date' | 'text' | 'number' | 'numbered'>();
        const groupSortKeys = new Map<string, number>();
        const groupOriginalTexts = new Map<string, Set<string>>();
        const groupRows = new Map<string, DataRow[]>();

        // Filter functions - use effective config from sharedConfig
        const isInDateRange = (row: DataRow): boolean => {
            if (!effectiveDateColumn || (!effectiveDateStart && !effectiveDateEnd)) return true;
            const dateVal = row[effectiveDateColumn];
            if (!dateVal) return false;
            const dateObj = parseDateValue(dateVal);
            if (!dateObj) return false;
            const startDate = effectiveDateStart ? new Date(effectiveDateStart) : null;
            const endDate = effectiveDateEnd ? new Date(effectiveDateEnd) : null;
            if (startDate && dateObj < startDate) return false;
            if (endDate && dateObj > endDate) return false;
            return true;
        };

        const isAboveMinNum = (row: DataRow): boolean => {
            if (isUsingSharedConfig || !config.filterNumColumn || config.filterMinNum === null) return true;
            const numVal = row[config.filterNumColumn];
            if (numVal === null || numVal === undefined || numVal === '') return false;
            const num = typeof numVal === 'number' ? numVal : parseFloat(String(numVal));
            return !isNaN(num) && num >= config.filterMinNum;
        };

        // Custom filter logic - uses effectiveCustomFilters defined above
        const passesCustomFilters = (row: DataRow): boolean => {
            for (const cf of effectiveCustomFilters) {
                if (!cf.column) continue;

                const rawValue = String(row[cf.column] ?? '');
                const strValue = rawValue.toLowerCase();
                const numValue = parseFloat(rawValue);
                const ruleValue = (cf.value || '').toLowerCase();
                const ruleNumValue = parseFloat(cf.value || '0');
                const ruleNumValue2 = cf.value2 ? parseFloat(cf.value2) : 0;

                let pass = true;
                switch (cf.operator) {
                    // Text operators
                    case 'contains':
                        pass = ruleValue ? strValue.includes(ruleValue) : true;
                        break;
                    case 'notContains':
                        pass = ruleValue ? !strValue.includes(ruleValue) : true;
                        break;
                    case 'equals':
                        pass = strValue === ruleValue;
                        break;
                    case 'notEquals':
                        pass = strValue !== ruleValue;
                        break;
                    case 'startsWith':
                        pass = ruleValue ? strValue.startsWith(ruleValue) : true;
                        break;
                    case 'endsWith':
                        pass = ruleValue ? strValue.endsWith(ruleValue) : true;
                        break;
                    case 'notEmpty':
                        pass = rawValue.trim().length > 0;
                        break;
                    case 'isEmpty':
                        pass = rawValue.trim().length === 0;
                        break;
                    case 'regex':
                        try {
                            if (cf.value) {
                                const regex = new RegExp(cf.value, 'i');
                                pass = regex.test(rawValue);
                            }
                        } catch { pass = true; }
                        break;
                    // Numeric operators
                    case 'greaterThan':
                        pass = !isNaN(numValue) && !isNaN(ruleNumValue) && numValue > ruleNumValue;
                        break;
                    case 'lessThan':
                        pass = !isNaN(numValue) && !isNaN(ruleNumValue) && numValue < ruleNumValue;
                        break;
                    case 'greaterOrEqual':
                        pass = !isNaN(numValue) && !isNaN(ruleNumValue) && numValue >= ruleNumValue;
                        break;
                    case 'lessOrEqual':
                        pass = !isNaN(numValue) && !isNaN(ruleNumValue) && numValue <= ruleNumValue;
                        break;
                    case 'between':
                        pass = !isNaN(numValue) && !isNaN(ruleNumValue) && !isNaN(ruleNumValue2) &&
                            numValue >= ruleNumValue && numValue <= ruleNumValue2;
                        break;
                    // Multi-select
                    case 'multiSelect':
                        const values = cf.selectedValues || [];
                        pass = values.length === 0 || values.includes(rawValue);
                        break;
                }
                if (!pass) return false;
            }
            return true;
        };

        // Num filter logic - uses effectiveNumFilters
        const passesNumFilters = (row: DataRow): boolean => {
            for (const nf of effectiveNumFilters) {
                if (!nf.column) continue;
                const rawValue = String(row[nf.column] ?? '');
                const numValue = parseFloat(rawValue);
                const ruleNumValue = parseFloat(nf.value || '0');
                const ruleNumValue2 = nf.value2 ? parseFloat(nf.value2) : 0;

                let pass = true;
                switch (nf.operator) {
                    case 'greaterThan':
                        pass = !isNaN(numValue) && numValue > ruleNumValue;
                        break;
                    case 'lessThan':
                        pass = !isNaN(numValue) && numValue < ruleNumValue;
                        break;
                    case 'greaterOrEqual':
                        pass = !isNaN(numValue) && numValue >= ruleNumValue;
                        break;
                    case 'lessOrEqual':
                        pass = !isNaN(numValue) && numValue <= ruleNumValue;
                        break;
                    case 'equals':
                        pass = !isNaN(numValue) && numValue === ruleNumValue;
                        break;
                    case 'notEquals':
                        pass = !isNaN(numValue) && numValue !== ruleNumValue;
                        break;
                    case 'between':
                        pass = !isNaN(numValue) && numValue >= ruleNumValue && numValue <= ruleNumValue2;
                        break;
                    case 'notEmpty':
                        pass = rawValue.trim() !== '';
                        break;
                    case 'isEmpty':
                        pass = rawValue.trim() === '';
                        break;
                }
                if (!pass) return false;
            }
            return true;
        };

        const fuzzyRulesToUse = parseFuzzyRules(effectiveFuzzyRuleText);

        const matchTextBins = (cellValue: string, bins: any[]): string | null => {
            if (!bins || bins.length === 0) return null;
            const cellValueLower = cellValue.toLowerCase();
            const cellNumValue = parseFloat(cellValue.replace(/[^\d.-]/g, ''));

            for (const bin of bins) {
                if ((bin.values || []).includes(cellValue)) {
                    return bin.label;
                }
                if (bin.conditions && bin.conditions.length > 0) {
                    for (const cond of bin.conditions) {
                        if (!cond.value) continue;
                        const condValueLower = String(cond.value).toLowerCase();
                        const condNumValue = parseFloat(String(cond.value).replace(/[^\d.-]/g, ''));
                        let matched = false;
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
                        if (matched) return bin.label;
                    }
                }
            }
            return null;
        };

        const getGroupKeyForLevel = (row: DataRow, level: GroupLevel | undefined, fallbackColumn: string) => {
            const column = level?.column || fallbackColumn;
            const rawVal = row[column];
            // 空值归入 "(空)" 分组，而不是跳过
            if (rawVal === null || rawVal === undefined || rawVal === '') {
                return { key: '(空)', type: 'text' as const };
            }

            if (!level) {
                return getRowGroupKeyWithTextBins(rawVal);
            }

            if (level.type === 'numeric') {
                if (level.numericBins && level.numericBins.length > 0) {
                    const numVal = parseFloat(String(rawVal).replace(/[^\d.-]/g, ''));
                    if (isNaN(numVal)) {
                        return { key: '其他', type: 'text' as const };
                    }
                    const bin = level.numericBins.find(b => numVal >= b.min && numVal <= b.max);
                    return { key: (bin ? bin.label : '其他'), type: 'text' as const };
                }
                const numVal = parseFloat(String(rawVal).replace(/[^\d.-]/g, ''));
                if (!isNaN(numVal)) {
                    return { key: String(numVal), type: 'number' as const };
                }
                return { key: String(rawVal).trim() || '(空)', type: 'text' as const };
            }

            if (level.type === 'date') {
                if (level.dateBins && level.dateBins.length > 0) {
                    const dateVal = parseDateValue(rawVal);
                    if (!dateVal) return { key: '无效日期', type: 'text' as const };
                    const dateTime = dateVal.getTime();
                    const bin = level.dateBins.find(b => {
                        const start = new Date(b.startDate).getTime();
                        const end = new Date(b.endDate).getTime() + 86400000 - 1;
                        return dateTime >= start && dateTime <= end;
                    });
                    return { key: (bin ? bin.label : '其他日期'), type: 'text' as const };
                }
                const dateVal = parseDateValue(rawVal);
                if (dateVal) {
                    return { key: formatDateValue(dateVal), type: 'date' as const };
                }
                return { key: String(rawVal).trim() || '无效日期', type: 'text' as const };
            }

            if (level.type === 'text') {
                if (level.textBins && level.textBins.length > 0) {
                    const strVal = String(rawVal || '').trim();
                    const matched = matchTextBins(strVal, level.textBins);
                    return { key: matched ? matched : (strVal || '(空)'), type: 'text' as const };
                }
            }

            return getRowGroupKeyWithTextBins(rawVal);
        };

        // Helper: Get group key with textGroupBins priority
        const getRowGroupKeyWithTextBins = (val: unknown): { key: string; type: 'date' | 'text' | 'number' | 'numbered'; sortKey?: number; originalText?: string } | null => {
            // 空值归入 "(空)" 分组
            if (val === null || val === undefined || val === '') {
                return { key: '(空)', type: 'text' };
            }

            const cellValue = String(val).trim();

            // 1. Text group bins (conditions matching) - highest priority
            if (effectiveTextGrouping && effectiveTextGroupBins.length > 0) {
                const matched = matchTextBins(cellValue, effectiveTextGroupBins as any[]);
                return { key: matched ? matched : '未分组', type: 'text' };
            }

            // 2. Fuzzy rules (keyword merge) - use effectiveFuzzyRuleText
            return getGroupKey(val, fuzzyRulesToUse);
        };

        // Process each row
        activeData.rows.forEach(row => {
            if (!isInDateRange(row) || !isAboveMinNum(row) || !passesCustomFilters(row) || !passesNumFilters(row)) return;

            const result = getGroupKeyForLevel(row, effectiveGroupLevels[0], effectiveGroupColumn);
            if (!result) return;

            groupCounts.set(result.key, (groupCounts.get(result.key) || 0) + 1);
            if (!groupTypes.has(result.key)) {
                groupTypes.set(result.key, result.type);
            }

            // Track rows for each group
            const rows = groupRows.get(result.key) || [];
            rows.push(row);
            groupRows.set(result.key, rows);

            // Track numbered type metadata
            if (result.type === 'numbered' && result.sortKey !== undefined) {
                groupSortKeys.set(result.key, result.sortKey);
                const textsSet = groupOriginalTexts.get(result.key) || new Set();
                if (result.originalText) textsSet.add(result.originalText);
                groupOriginalTexts.set(result.key, textsSet);
            }
        });

        // Sort groups
        const sortedGroupKeys = Array.from(groupCounts.keys()).sort((a, b) => {
            const typeA = groupTypes.get(a)!;
            const typeB = groupTypes.get(b)!;

            if (typeA === 'numbered' && typeB === 'numbered') {
                const numA = groupSortKeys.get(a) || 0;
                const numB = groupSortKeys.get(b) || 0;
                return numA - numB;
            }

            if (typeA === 'date' && typeB === 'date') {
                return new Date(b).getTime() - new Date(a).getTime();
            }

            if (typeA === 'number' && typeB === 'number') {
                return parseFloat(b) - parseFloat(a);
            }

            const typePriority = { numbered: 0, date: 1, number: 2, text: 3 };
            const priorityA = typePriority[typeA] ?? 99;
            const priorityB = typePriority[typeB] ?? 99;
            if (priorityA !== priorityB) return priorityA - priorityB;

            return a.localeCompare(b, 'zh-CN');
        });

        // Build group results
        const groupDefs: GroupResult[] = [];
        const smallGroupDefs: GroupResult[] = [];

        sortedGroupKeys.forEach(key => {
            const count = groupCounts.get(key)!;
            const type = groupTypes.get(key)!;
            const rows = groupRows.get(key) || [];

            // Get label for numbered types
            let label = key;
            if (type === 'numbered') {
                const textsSet = groupOriginalTexts.get(key);
                if (textsSet && textsSet.size > 0) {
                    const texts = Array.from(textsSet);
                    label = texts.reduce((a, b) => a.length <= b.length ? a : b);
                } else {
                    label = `分类${key}`;
                }
            }

            const def: GroupResult = { key, type, count, rows, label };

            if (config.mergeThreshold > 0 && count < config.mergeThreshold) {
                smallGroupDefs.push(def);
            } else {
                groupDefs.push(def);
            }
        });

        // Merge small groups
        if (config.mergeThreshold > 0 && smallGroupDefs.length > 0) {
            const mergedCount = smallGroupDefs.reduce((sum, def) => sum + def.count, 0);
            const mergedRows = smallGroupDefs.flatMap(def => def.rows);
            const mergedLabel = `其他(合并<${config.mergeThreshold})`;
            groupDefs.push({
                key: mergedLabel,
                type: 'mixed',
                count: mergedCount,
                rows: mergedRows,
                label: mergedLabel,
            });
        }

        // Multi-level nesting: If we have more group columns, recursively create sub-groups
        if (effectiveGroupColumns.length > 1) {
            /**
             * buildNestedGroups: Recursively create nested group structure
             * @param parentGroups - The parent groups to nest children into
             * @param nextLevelIdx - Index into effectiveGroupColumns for the NEXT level to create
             * @param parentLevel - The level of the parent groups (0-indexed)
             */
            const buildNestedGroups = (parentGroups: GroupResult[], nextLevelIdx: number, parentLevel: number = 0): GroupResult[] => {
                // No more columns to nest
                if (nextLevelIdx >= effectiveGroupColumns.length) {
                    // Just set the level for leaf groups
                    return parentGroups.map(g => ({ ...g, level: parentLevel }));
                }

                const nextColumn = effectiveGroupColumns[nextLevelIdx];
                if (!nextColumn) {
                    return parentGroups.map(g => ({ ...g, level: parentLevel }));
                }

                return parentGroups.map(group => {
                    // Group the rows of this parent by the next column
                    const subGroupMap = new Map<string, DataRow[]>();
                    const subGroupTypes = new Map<string, 'date' | 'text' | 'number' | 'numbered'>();

                    group.rows.forEach(row => {
                        const result = getGroupKeyForLevel(row, effectiveGroupLevels[nextLevelIdx], nextColumn);
                        const key = result?.key || '(空)';
                        const type = result?.type || 'text';

                        if (!subGroupMap.has(key)) {
                            subGroupMap.set(key, []);
                            subGroupTypes.set(key, type);
                        }
                        subGroupMap.get(key)!.push(row);
                    });

                    // Build child GroupResults
                    const childLevel = parentLevel + 1;
                    const children: GroupResult[] = Array.from(subGroupMap.entries())
                        .map(([key, rows]) => ({
                            key,
                            type: subGroupTypes.get(key) || 'text',
                            count: rows.length,
                            rows,
                            label: key,
                            level: childLevel,
                            parentKey: group.key,
                        }))
                        .sort((a, b) => {
                            // Sort by type then by key
                            if (a.type === 'date' && b.type === 'date') {
                                return new Date(b.key).getTime() - new Date(a.key).getTime();
                            }
                            return a.key.localeCompare(b.key, 'zh-CN');
                        });

                    // Recursively process children if there are more levels
                    const nestedChildren = nextLevelIdx + 1 < effectiveGroupColumns.length
                        ? buildNestedGroups(children, nextLevelIdx + 1, childLevel)
                        : children;

                    return {
                        ...group,
                        level: parentLevel,
                        children: nestedChildren,
                    };
                });
            };

            // groupDefs is already level 0 (first grouping column), so we start building children from column index 1
            const nestedGroupDefs = buildNestedGroups(groupDefs, 1, 0);
            // Replace groupDefs with nested version
            groupDefs.length = 0;
            groupDefs.push(...nestedGroupDefs);
        }

        // Sort rows within groups - multi-level sort (uses effectiveSortRules defined above)
        // Filter out empty sort rules (column is empty or not set)
        const activeSortRules = effectiveSortRules.filter(r => r.column && r.column.trim() !== '').length > 0
            ? effectiveSortRules.filter(r => r.column && r.column.trim() !== '')
            : config.sortColumn
                ? [{ column: config.sortColumn, descending: config.sortDescending }]
                : [];

        if (activeSortRules.length > 0) {
            // Helper: Extract date part from datetime string for comparison
            const extractDatePart = (val: unknown): string | null => {
                if (val instanceof Date) {
                    return val.toISOString().slice(0, 10);
                }
                if (typeof val === 'string') {
                    const match = val.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})/);
                    if (match) {
                        return `${match[1]}-${match[2].padStart(2, '0')}-${match[3].padStart(2, '0')}`;
                    }
                }
                return null;
            };

            // Helper: Try to parse as number (improved to handle more formats)
            const tryParseNumber = (val: unknown): number | null => {
                if (val === null || val === undefined) return null;
                if (typeof val === 'number' && !isNaN(val)) return val;
                if (typeof val !== 'string') return null;

                let str = val.trim();
                if (str === '' || !/\d/.test(str)) return null;

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

            groupDefs.forEach(group => {
                group.rows.sort((a, b) => {
                    for (const rule of activeSortRules) {
                        let valA = a[rule.column];
                        let valB = b[rule.column];
                        let cmp = 0;

                        // Try to extract date part for datetime values
                        const dateA = extractDatePart(valA);
                        const dateB = extractDatePart(valB);
                        if (dateA && dateB) {
                            valA = dateA;
                            valB = dateB;
                        }

                        // Compare values
                        if (valA === valB) continue; // Equal, try next sort level
                        if (valA === null || valA === undefined || valA === '') {
                            cmp = 1; // Null values go to end
                        } else if (valB === null || valB === undefined || valB === '') {
                            cmp = -1;
                        } else {
                            // Try numeric comparison first
                            const numA = tryParseNumber(valA);
                            const numB = tryParseNumber(valB);
                            if (numA !== null && numB !== null) {
                                cmp = numA - numB;
                            } else {
                                cmp = String(valA).localeCompare(String(valB), 'zh-CN');
                            }
                        }

                        if (cmp !== 0) {
                            return rule.descending ? -cmp : cmp;
                        }
                    }
                    return 0; // All sort levels equal
                });
            });
        }

        // Build output plan with pagination
        // Order: All columns for page 1, then all columns for page 2, etc.
        // This matches Google Sheets script output format where each page is a block
        const output: TransposeOutput[] = [];
        const pageSize = config.pageSize > 0 ? config.pageSize : Number.MAX_SAFE_INTEGER;

        // Recursive function to process nested groups
        const processGroup = (group: GroupResult, parentLabels: string[] = []) => {
            const fullLabelPath = [...parentLabels, group.label || group.key];

            // If this group has children, process children instead
            if (group.children && group.children.length > 0) {
                group.children.forEach(child => {
                    processGroup(child, fullLabelPath);
                });
                return;
            }

            // Leaf group: output the data
            const pages = Math.ceil(group.count / pageSize);
            const levelIndent = '  '.repeat(group.level || 0);

            for (let p = 0; p < pages; p++) {
                const start = p * pageSize;
                const end = Math.min(start + pageSize, group.count);
                const pageRows = group.rows.slice(start, end);
                const labelSuffix = pages > 1 ? ` (${p + 1}/${pages})` : '';

                // Build hierarchical label: "Level1 > Level2 > Level3"
                const hierarchicalLabel = fullLabelPath.join(' › ');

                // Output all columns for this page
                effectiveDataColumns.forEach(col => {
                    const pageData = pageRows.map(row => row[col]);
                    output.push({
                        label: `${col} [${hierarchicalLabel}${labelSuffix}]`,
                        column: col,
                        data: pageData as (string | number | null)[],
                        rows: pageRows,
                    });
                });
            }
        };

        groupDefs.forEach(group => {
            processGroup(group, []);
        });

        // Determine predominant type
        const typeCount = { date: 0, text: 0, number: 0, numbered: 0 };
        groupTypes.forEach(t => typeCount[t]++);
        const predominantType = Object.entries(typeCount).sort((a, b) => b[1] - a[1])[0][0];

        return {
            groups: groupDefs,
            outputPlan: output,
            stats: {
                total: activeData.rows.length,
                groups: groupDefs.length,
                type: predominantType,
            }
        };
    }, [activeData, config, fuzzyRuleText, effectiveGroupColumn, effectiveGroupColumns, effectiveGroupLevels, effectiveDateColumn, effectiveDateStart, effectiveDateEnd, effectiveDataColumns, effectiveCustomFilters, effectiveSortRules, effectiveNumFilters, effectiveTextGrouping, effectiveTextGroupBins, effectiveFuzzyRuleText]);

    // Get selected cells data as 2D array (for copy functionality)
    const getSelectedCellsData = useCallback((): string[][] => {
        if (!selectionStart || !selectionEnd) return [];
        const minRow = Math.min(selectionStart.row, selectionEnd.row);
        const maxRow = Math.max(selectionStart.row, selectionEnd.row);

        const rowsToShow = showAllRows ? outputPlan : outputPlan.slice(0, visibleRowCount);
        const result: string[][] = [];

        // Row selection mode (col = -2): select entire row
        if (selectionStart.col === -2 && selectionEnd.col === -2) {
            for (let r = minRow; r <= maxRow; r++) {
                const plan = rowsToShow[r];
                if (!plan) continue;
                const row: string[] = [plan.label];
                for (const val of plan.data) {
                    if (val === null || val === undefined) {
                        row.push('');
                    } else {
                        row.push(String(val));
                    }
                }
                result.push(row);
            }
            return result;
        }

        // Normal cell selection mode
        const minCol = Math.min(selectionStart.col, selectionEnd.col);
        const maxCol = Math.max(selectionStart.col, selectionEnd.col);

        for (let r = minRow; r <= maxRow; r++) {
            const row: string[] = [];
            const plan = rowsToShow[r];
            if (!plan) continue;

            for (let c = minCol; c <= maxCol; c++) {
                // Column -1 is the A column (row header/label)
                if (c === -1) {
                    row.push(plan.label);
                    continue;
                }

                const val = plan.data[c];
                // Keep formulas as-is (like =IMAGE), just convert to string
                if (val === null || val === undefined) {
                    row.push('');
                } else {
                    row.push(String(val));
                }
            }
            result.push(row);
        }
        return result;
    }, [selectionStart, selectionEnd, outputPlan, showAllRows, visibleRowCount]);

    // Copy selected cells to clipboard as TSV (paste into Google Sheets will maintain structure)
    const copySelectedCells = useCallback(async () => {
        const data = getSelectedCellsData();
        if (data.length === 0) return;

        const tsv = data.map(row => row.join('\t')).join('\n');
        try {
            await navigator.clipboard.writeText(tsv);
            setCopiedData(true);
            setTimeout(() => setCopiedData(false), 2000);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    }, [getSelectedCellsData]);

    // Keyboard event for Ctrl+C / Cmd+C copy
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if ((e.ctrlKey || e.metaKey) && e.key === 'c' && selectionStart && selectionEnd) {
                e.preventDefault();
                copySelectedCells();
            }
            // ESC to clear selection
            if (e.key === 'Escape') {
                setSelectionStart(null);
                setSelectionEnd(null);
            }
        };

        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [selectionStart, selectionEnd, copySelectedCells]);

    // Generate Google Sheets formulas
    const generateFormulas = useCallback(() => {
        if (!effectiveGroupColumn || effectiveDataColumns.length === 0) return '';

        const sheetName = activeData.sheetName || 'Sheet1';
        const startRow = 2; // Assuming header is row 1

        let formulas = `// Google Sheets 公式 - ${activeData.fileName}\n`;
        formulas += `// 配置：分组列=${effectiveGroupColumn}, 数据列=${effectiveDataColumns.join(',')}\n\n`;

        outputPlan.forEach((plan, idx) => {
            const groupLabel = plan.label.match(/\[([^\]]+)\]/)?.[1] || plan.label;
            formulas += `// 第${idx + 1}行: ${plan.label}\n`;
            formulas += `// 公式：\n`;
            formulas += `=LET(\n`;
            formulas += `  srcRange, '${sheetName}'!${plan.column}${startRow}:${plan.column},\n`;
            formulas += `  groupRange, '${sheetName}'!${effectiveGroupColumn}${startRow}:${effectiveGroupColumn},\n`;
            formulas += `  mask, BYROW(groupRange, LAMBDA(row, IF(REGEXMATCH(TO_TEXT(row), "${groupLabel}"), 1, 0))),\n`;
            formulas += `  matches, FILTER(srcRange, mask>0),\n`;
            formulas += `  IF(ROWS(matches)>0, TRANSPOSE(matches), "")\n`;
            formulas += `)\n\n`;
        });

        return formulas;
    }, [activeData, effectiveGroupColumn, effectiveDataColumns, outputPlan]);

    // Copy formulas to clipboard
    const handleCopyFormulas = async () => {
        const formulas = generateFormulas();
        try {
            await navigator.clipboard.writeText(formulas);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (e) {
            console.error('Copy failed:', e);
        }
    };

    // Export as TSV
    const handleExport = () => {
        if (outputPlan.length === 0) return;

        // Find max length
        const maxLen = Math.max(...outputPlan.map(p => p.data.length));

        // Build header row
        const headers = outputPlan.map(p => p.label);

        // Build data rows (transposed)
        const rows: string[][] = [];
        for (let i = 0; i < maxLen; i++) {
            const row = outputPlan.map(p => String(p.data[i] ?? ''));
            rows.push(row);
        }

        const tsv = [headers.join('\t'), ...rows.map(r => r.join('\t'))].join('\n');

        const blob = new Blob([tsv], { type: 'text/tab-separated-values' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `转置-${activeData.fileName || 'data'}.tsv`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // Copy preview data as TSV for direct paste to Google Sheets
    const handleCopyData = () => {
        if (outputPlan.length === 0) return;

        // Build TSV content - row label + all data values (raw values, not formulas)
        const lines = outputPlan.map(plan => {
            const values = plan.data.map(val => {
                if (val === null || val === undefined) return '';
                const strVal = String(val);
                // For image formulas, just copy the formula or URL
                const imageUrl = extractImageFromFormula(strVal);
                if (imageUrl) return `=IMAGE("${imageUrl}")`;
                return strVal;
            });
            return [plan.label, ...values].join('\t');
        });

        navigator.clipboard.writeText(lines.join('\n'))
            .then(() => {
                setCopiedData(true);
                setTimeout(() => setCopiedData(false), 2000);
            });
    };

    // Toggle column selection
    const toggleColumn = useCallback((col: string) => {
        updateConfig({
            dataColumns: config.dataColumns.includes(col)
                ? config.dataColumns.filter(c => c !== col)
                : [...config.dataColumns, col]
        });
    }, [config.dataColumns, updateConfig]);

    // Toggle group expansion
    const toggleGroupExpand = (key: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(key)) {
                next.delete(key);
            } else {
                next.add(key);
            }
            return next;
        });
    };

    // Type icon component
    const TypeIcon = ({ type }: { type: string }) => {
        switch (type) {
            case 'date': return <Calendar size={14} className="text-blue-500" />;
            case 'number': return <Hash size={14} className="text-green-500" />;
            case 'numbered': return <ListOrdered size={14} className="text-purple-500" />;
            case 'text': return <Type size={14} className="text-orange-500" />;
            default: return <Type size={14} className="text-slate-400" />;
        }
    };

    // Helper to detect if URL is an image (including Gyazo)
    const isImageUrl = (url: string): boolean => {
        const imageExtensions = /\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?.*)?$/i;
        const gyazoPattern = /^https?:\/\/(i\.)?gyazo\.com\//i;
        const imgurPattern = /^https?:\/\/(i\.)?imgur\.com\//i;
        return imageExtensions.test(url) || gyazoPattern.test(url) || imgurPattern.test(url);
    };

    // Helper to check if a value contains image content
    const isImageContent = (val: unknown): boolean => {
        if (val === null || val === undefined || val === '') return false;
        const strVal = String(val);
        // Check IMAGE formula
        if (extractImageFromFormula(strVal)) return true;
        // Check direct image URL
        if (strVal.startsWith('http') && isImageUrl(strVal)) return true;
        return false;
    };

    // Helper to check if a row contains any image content
    const rowHasImages = (rowData: unknown[]): boolean => {
        return rowData.some(val => isImageContent(val));
    };

    const extractImageUrl = (val: unknown): string | null => {
        if (val === null || val === undefined || val === '') return null;
        const strVal = String(val);
        const formulaUrl = extractImageFromFormula(strVal);
        if (formulaUrl) return formulaUrl;
        if (strVal.startsWith('http') && isImageUrl(strVal)) return strVal;
        return null;
    };

    const isFavorited = useCallback((imageUrl: string) => {
        return favorites.some(f => f.imageUrl === imageUrl);
    }, [favorites]);

    const toggleFavorite = useCallback((imageUrl: string, row: DataRow) => {
        setFavorites(prev => {
            const exists = prev.find(f => f.imageUrl === imageUrl);
            if (exists) {
                setFavoritesNotice('已取消收藏');
                return prev.filter(f => f.imageUrl !== imageUrl);
            }
            const newItem: FavoriteItem = {
                id: `fav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                imageUrl,
                rowData: { ...row },
                addedAt: Date.now(),
                folderId: favoriteTargetFolderId
            };
            const folder = favoriteFolders.find(f => f.id === favoriteTargetFolderId);
            setFavoritesNotice(`已添加到 ${folder?.emoji || '📁'} ${folder?.name || '收藏夹'}`);
            return [newItem, ...prev];
        });
        setTimeout(() => setFavoritesNotice(null), 1500);
    }, [favoriteTargetFolderId, favoriteFolders]);

    const getCategoryForImage = useCallback((imageUrl: string): string => {
        return galleryCategories.get(imageUrl) || '';
    }, [galleryCategories]);

    const findRowIndex = useCallback((row: DataRow, imageUrl: string): number => {
        const index = data.rows.findIndex(r => {
            if (effectiveImageColumn && r[effectiveImageColumn]) {
                const rowImageUrl = extractImageUrl(r[effectiveImageColumn]);
                return rowImageUrl === imageUrl;
            }
            return Object.keys(row).every(k => r[k] === row[k]);
        });
        return index >= 0 ? index + 2 : -1;
    }, [data.rows, effectiveImageColumn]);

    const openCategoryModal = useCallback((imageUrl: string, row: DataRow) => {
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

    const closeCategoryModal = useCallback(() => {
        setCategoryModal(prev => ({ ...prev, isOpen: false }));
    }, []);

    const saveCategory = useCallback(async (selectedCategory: string) => {
        if (!categoryModal.imageUrl) return;
        setCategoryModal(prev => ({ ...prev, isSaving: true }));
        try {
            setGalleryCategories(prev => {
                const next = new Map(prev);
                if (selectedCategory) {
                    next.set(categoryModal.imageUrl, selectedCategory);
                } else {
                    next.delete(categoryModal.imageUrl);
                }
                return next;
            });

            if (isUserLoggedIn() && selectedCategory) {
                try {
                    await upsertGalleryCategoryToCloud({
                        id: btoa(categoryModal.imageUrl).slice(0, 50),
                        imageUrl: categoryModal.imageUrl,
                        category: selectedCategory,
                        createdAt: Date.now(),
                        updatedAt: Date.now()
                    });
                } catch (err) {
                    console.warn('[Category] 云端同步失败:', err);
                }
            }
            setFavoritesNotice('分类已保存');
            setTimeout(() => setFavoritesNotice(null), 1500);
            closeCategoryModal();
        } finally {
            setCategoryModal(prev => ({ ...prev, isSaving: false }));
        }
    }, [categoryModal.imageUrl, closeCategoryModal]);

    const addCategoryOptions = useCallback((items: string[]) => {
        const cleaned = items.map(item => item.trim()).filter(Boolean);
        if (cleaned.length === 0) return;
        setCategoryOptions(prev => {
            const next = [...prev];
            cleaned.forEach(item => {
                if (!next.includes(item)) next.push(item);
            });
            return next;
        });
    }, []);

    const addToFolder = useCallback((imageUrl: string, row: DataRow, folderId: string) => {
        setFavorites(prev => {
            const existing = prev.find(f => f.imageUrl === imageUrl);
            if (existing) {
                return prev.map(f => f.imageUrl === imageUrl ? { ...f, folderId } : f);
            }
            const newItem: FavoriteItem = {
                id: `fav-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
                imageUrl,
                rowData: { ...row },
                addedAt: Date.now(),
                folderId
            };
            return [newItem, ...prev];
        });
        const folder = favoriteFolders.find(f => f.id === folderId);
        setFavoritesNotice(`已加入 ${folder?.emoji || '📁'} ${folder?.name || '收藏夹'}`);
        setTimeout(() => setFavoritesNotice(null), 1500);
    }, [favoriteFolders]);

    const deleteFavoriteFolder = useCallback((folderId: string) => {
        if (folderId === DEFAULT_FOLDER_ID) return;
        setFavorites(prev => prev.map(f => f.folderId === folderId ? { ...f, folderId: DEFAULT_FOLDER_ID } : f));
        setFavoriteFolders(prev => prev.filter(f => f.id !== folderId));
        if (favoriteTargetFolderId === folderId) {
            setFavoriteTargetFolderId(DEFAULT_FOLDER_ID);
        }
        setFavoritesNotice('收藏夹已删除');
        setTimeout(() => setFavoritesNotice(null), 1500);
    }, [favoriteTargetFolderId]);

    // Render cell value - handles images, dates, links, etc.
    const renderCellValue = (val: unknown, rowHeight?: number, row?: DataRow) => {
        if (val === null || val === undefined || val === '') {
            return <span className="text-slate-300">-</span>;
        }

        // Handle Date objects
        if (val instanceof Date) {
            const y = val.getFullYear();
            const m = String(val.getMonth() + 1).padStart(2, '0');
            const d = String(val.getDate()).padStart(2, '0');
            return <span className="text-slate-700">{`${y}/${m}/${d}`}</span>;
        }

        const strVal = String(val);

        // Calculate image size based on row height or thumbnailSize
        const imgHeight = rowHeight ? Math.max(24, rowHeight - 8) : thumbnailSize;

        const imageUrl = extractImageUrl(val);
        if (imageUrl) {
            return (
                <div
                    className="relative inline-block"
                    onMouseEnter={() => hoverPreview && setHoveredImage(imageUrl)}
                    onMouseLeave={() => setHoveredImage(null)}
                >
                    {row && (showFavoriteButton || showCategoryButton) && (
                        <div className="absolute top-1 right-1 flex flex-col gap-1 z-10">
                            {showFavoriteButton && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        if (isFavorited(imageUrl)) {
                                            toggleFavorite(imageUrl, row);
                                            return;
                                        }
                                        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                        setFavoriteMenu({
                                            isOpen: true,
                                            x: rect.left,
                                            y: rect.bottom + 4,
                                            imageUrl,
                                            row
                                        });
                                    }}
                                    className={`p-1 rounded-full shadow ${isFavorited(imageUrl) ? 'bg-yellow-400 text-white' : 'bg-white text-slate-500 hover:text-yellow-500'}`}
                                    title={isFavorited(imageUrl) ? '取消收藏' : '添加收藏'}
                                >
                                    <Star size={12} fill={isFavorited(imageUrl) ? 'currentColor' : 'none'} />
                                </button>
                            )}
                            {showCategoryButton && (
                                <button
                                    type="button"
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        openCategoryModal(imageUrl, row);
                                    }}
                                    className={`p-1 rounded-full shadow ${getCategoryForImage(imageUrl) ? 'bg-purple-500 text-white' : 'bg-white text-slate-500 hover:text-purple-500'}`}
                                    title={getCategoryForImage(imageUrl) ? `媒体标签: ${getCategoryForImage(imageUrl)}` : '设置媒体标签'}
                                >
                                    <Tag size={12} />
                                </button>
                            )}
                        </div>
                    )}
                    <a
                        href={imageUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="block"
                        onClick={e => e.stopPropagation()}
                    >
                        <img
                            src={imageUrl}
                            alt="缩略图"
                            style={{ height: `${imgHeight}px`, maxWidth: `${cellWidth}px` }}
                            className="object-contain rounded border border-slate-200 hover:border-blue-400 hover:shadow-md transition-all bg-slate-50"
                            loading="lazy"
                        />
                    </a>
                </div>
            );
        }

        // Check for generic URL
        if (strVal.startsWith('http')) {
            return (
                <a
                    href={strVal}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-600 hover:underline text-xs truncate block max-w-[100px]"
                    onClick={e => e.stopPropagation()}
                    title={strVal}
                >
                    <Link2 size={12} className="inline mr-1" /> 链接
                </a>
            );
        }

        // Default text display
        return (
            <span
                className="text-slate-700 text-xs truncate block max-w-[150px]"
                title={strVal}
            >
                {strVal}
            </span>
        );
    };


    return (
        <div className="h-full bg-slate-50 overflow-hidden flex flex-col sheetmind-light-form color-scheme-light">
            <div className="flex-1 flex overflow-hidden">
                {/* Left Panel - Config - Collapsible */}
                {showLeftPanel ? (
                    <div className="w-56 lg:w-64 xl:w-72 2xl:w-80 border-r border-slate-200 bg-white overflow-y-auto shrink-0 relative">
                        {/* Collapse Button - Right edge center - Indigo color */}
                        <button
                            onClick={() => setShowLeftPanel(false)}
                            className="absolute -right-3 top-1/2 -translate-y-1/2 z-30 w-6 h-12 bg-indigo-500 hover:bg-indigo-600 border border-indigo-400 rounded-r-full shadow-md transition-colors flex items-center justify-center tooltip-bottom"
                            data-tip="收起设置面板"
                        >
                            <ChevronLeft size={14} className="text-white" />
                        </button>
                        <div className="p-3 space-y-3">
                            <div className="bg-slate-50 rounded-lg p-2 border border-slate-200">
                                <div className="text-xs font-semibold text-slate-700 mb-1.5 flex items-center gap-1">
                                    <ListOrdered size={12} /> 输出顺序
                                    <span className="text-[9px] text-slate-400">(拖拽或按钮调整)</span>
                                </div>
                                {effectiveDataColumns.length === 0 ? (
                                    <div className="text-[10px] text-slate-400">
                                        暂无可排序列，请先在总配置选择显示列
                                    </div>
                                ) : (
                                    <div className="space-y-0.5">
                                        {effectiveDataColumns.map((col, idx) => (
                                            <div
                                                key={col}
                                                draggable
                                                onDragStart={() => setDraggedColumn(col)}
                                                onDragEnd={() => setDraggedColumn(null)}
                                                onDragOver={(e) => e.preventDefault()}
                                                onDrop={() => {
                                                    if (draggedColumn && draggedColumn !== col) {
                                                        const newCols = [...effectiveDataColumns];
                                                        const fromIdx = newCols.indexOf(draggedColumn);
                                                        const toIdx = newCols.indexOf(col);
                                                        newCols.splice(fromIdx, 1);
                                                        newCols.splice(toIdx, 0, draggedColumn);
                                                        updateConfig({ dataColumns: newCols });
                                                    }
                                                }}
                                                className={`flex items-center gap-1 bg-white px-2 py-1 rounded border text-xs cursor-move transition-all ${draggedColumn === col
                                                    ? 'border-indigo-400 bg-indigo-100 opacity-50'
                                                    : draggedColumn
                                                        ? 'border-indigo-300 hover:bg-indigo-50'
                                                        : 'border-indigo-100 hover:border-indigo-200'
                                                    }`}
                                            >
                                                <span className="text-indigo-400 w-4 text-[10px]">{idx + 1}</span>
                                                <span className="flex-1 truncate text-slate-700">{col}</span>
                                                <button
                                                    type="button"
                                                    disabled={idx === 0}
                                                    onClick={() => {
                                                        const newCols = [...effectiveDataColumns];
                                                        [newCols[idx - 1], newCols[idx]] = [newCols[idx], newCols[idx - 1]];
                                                        updateConfig({ dataColumns: newCols });
                                                    }}
                                                    className="p-0.5 hover:bg-indigo-100 rounded disabled:opacity-30 disabled:cursor-not-allowed tooltip-bottom"
                                                    data-tip="上移"
                                                >
                                                    <ChevronUp size={12} className="text-indigo-500" />
                                                </button>
                                                <button
                                                    type="button"
                                                    disabled={idx === effectiveDataColumns.length - 1}
                                                    onClick={() => {
                                                        const newCols = [...effectiveDataColumns];
                                                        [newCols[idx], newCols[idx + 1]] = [newCols[idx + 1], newCols[idx]];
                                                        updateConfig({ dataColumns: newCols });
                                                    }}
                                                    className="p-0.5 hover:bg-indigo-100 rounded disabled:opacity-30 disabled:cursor-not-allowed tooltip-bottom"
                                                    data-tip="下移"
                                                >
                                                    <ChevronDown size={12} className="text-indigo-500" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
                            <div className="bg-slate-50 rounded-lg p-2 border border-slate-200">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-semibold text-slate-700"><Star size={12} className="inline mr-1" /> 收藏 / 媒体标签</span>
                                    <button
                                        onClick={() => setShowFavoritesPanel(prev => !prev)}
                                        className="text-[10px] text-slate-500 hover:text-slate-700"
                                    >
                                        {showFavoritesPanel ? '收起' : '展开'}
                                    </button>
                                </div>
                                {showFavoritesPanel && (
                                    <div className="space-y-2">
                                        {favoritesNotice && (
                                            <div className="text-[10px] text-emerald-600">{favoritesNotice}</div>
                                        )}

                                        <div className="flex items-center justify-between border border-slate-200 bg-white rounded px-2 py-1">
                                            <span className="text-[10px] text-slate-600">显示按钮</span>
                                            <div className="flex items-center gap-2">
                                                <label className="flex items-center gap-1 text-[9px] text-slate-600">
                                                    <input
                                                        type="checkbox"
                                                        checked={showFavoriteButton}
                                                        onChange={(e) => setShowFavoriteButton(e.target.checked)}
                                                    />
                                                    收藏
                                                </label>
                                                <label className="flex items-center gap-1 text-[9px] text-slate-600">
                                                    <input
                                                        type="checkbox"
                                                        checked={showCategoryButton}
                                                        onChange={(e) => setShowCategoryButton(e.target.checked)}
                                                    />
                                                    标签
                                                </label>
                                            </div>
                                        </div>

                                        <div>
                                            <div className="text-[10px] font-semibold text-amber-700 mb-1">收藏夹</div>
                                            <div className="space-y-1 max-h-28 overflow-y-auto">
                                                {favoriteFolders.map(folder => (
                                                    <div key={folder.id} className="flex items-center gap-1">
                                                        <input
                                                            value={folder.emoji || ''}
                                                            onChange={e => {
                                                                const emoji = e.target.value;
                                                                setFavoriteFolders(prev => prev.map(f => f.id === folder.id ? { ...f, emoji } : f));
                                                            }}
                                                            className="w-10 px-1 py-0.5 text-[9px] border rounded"
                                                            placeholder="📁"
                                                        />
                                                        <input
                                                            value={folder.name}
                                                            onChange={e => {
                                                                const name = e.target.value;
                                                                setFavoriteFolders(prev => prev.map(f => f.id === folder.id ? { ...f, name } : f));
                                                            }}
                                                            className="flex-1 px-1 py-0.5 text-[9px] border rounded"
                                                            placeholder="收藏夹名称"
                                                        />
                                                        {folder.id !== DEFAULT_FOLDER_ID && (
                                                            <button
                                                                onClick={() => deleteFavoriteFolder(folder.id)}
                                                                className="text-red-400 hover:text-red-600 tooltip-bottom"
                                                                 data-tip="删除收藏夹"
                                                            >
                                                                <X size={10} />
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                            </div>
                                            <div className="flex items-center gap-1 mt-1">
                                                <input
                                                    value={newFolderEmoji}
                                                    onChange={e => setNewFolderEmoji(e.target.value)}
                                                    className="w-10 px-1 py-0.5 text-[9px] border rounded"
                                                    placeholder="📁"
                                                />
                                                <input
                                                    value={newFolderName}
                                                    onChange={e => setNewFolderName(e.target.value)}
                                                    className="flex-1 px-1 py-0.5 text-[9px] border rounded"
                                                    placeholder="新收藏夹"
                                                />
                                                <button
                                                    onClick={() => {
                                                        const name = newFolderName.trim();
                                                        if (!name) return;
                                                        const newFolder: FavoriteFolder = {
                                                            id: `folder-${Date.now()}`,
                                                            name,
                                                            emoji: newFolderEmoji || '📁',
                                                            createdAt: Date.now()
                                                        };
                                                        setFavoriteFolders(prev => [...prev, newFolder]);
                                                        setNewFolderName('');
                                                        setNewFolderEmoji('📁');
                                                        setFavoritesNotice('收藏夹已创建');
                                                        setTimeout(() => setFavoritesNotice(null), 1500);
                                                    }}
                                                    className="px-2 py-0.5 text-[9px] bg-amber-50 text-amber-700 rounded hover:bg-amber-100"
                                                >
                                                    添加
                                                </button>
                                            </div>
                                        </div>

                                        <div>
                                            <label className="text-[9px] text-slate-500">新增收藏默认加入</label>
                                            <select
                                                value={favoriteTargetFolderId}
                                                onChange={e => setFavoriteTargetFolderId(e.target.value)}
                                                className="w-full px-1 py-0.5 text-[9px] border rounded bg-white mt-1"
                                            >
                                                {favoriteFolders.map(folder => (
                                                    <option key={folder.id} value={folder.id}>
                                                        {(folder.emoji || '📁') + ' ' + folder.name}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>

                                        <div>
                                            <div className="text-[10px] font-semibold text-amber-700 mb-1">收藏列表</div>
                                            <div className="max-h-24 overflow-y-auto space-y-1">
                                                {favorites.length === 0 && (
                                                    <div className="text-[9px] text-slate-400">暂无收藏</div>
                                                )}
                                                {favorites.map(fav => (
                                                    <div key={fav.id} className="flex items-center gap-1">
                                                        <span className="text-[9px] text-slate-600 truncate flex-1" title={fav.imageUrl}>
                                                            {fav.imageUrl}
                                                        </span>
                                                        <button
                                                            onClick={() => setFavorites(prev => prev.filter(f => f.id !== fav.id))}
                                                            className="text-red-400 hover:text-red-600 tooltip-bottom"
                                                             data-tip="移除"
                                                        >
                                                            <X size={10} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        <div>
                                            <div className="text-[10px] font-semibold text-purple-700 mb-1">媒体标签</div>
                                            <div className="flex flex-wrap gap-1">
                                                {categoryOptions.map((cat, idx) => (
                                                    <span key={`${cat}-${idx}`} className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[9px] bg-purple-50 text-purple-700 rounded border border-purple-100">
                                                        {cat}
                                                        <button
                                                            onClick={() => setCategoryOptions(prev => prev.filter((_, i) => i !== idx))}
                                                            className="text-purple-400 hover:text-purple-600"
                                                        >
                                                            ×
                                                        </button>
                                                    </span>
                                                ))}
                                            </div>
                                            <div className="flex items-center gap-1 mt-1">
                                                <input
                                                    value={newCategoryOption}
                                                    onChange={e => setNewCategoryOption(e.target.value)}
                                                    onPaste={(e) => {
                                                        const text = e.clipboardData.getData('text');
                                                        const items = text
                                                            .split(/\r?\n/)
                                                            .flatMap(row => row.split('\t'))
                                                            .map(val => val.trim())
                                                            .filter(Boolean);
                                                        if (items.length > 1) {
                                                            e.preventDefault();
                                                            addCategoryOptions(items);
                                                            setNewCategoryOption('');
                                                        }
                                                    }}
                                                    className="flex-1 px-1 py-0.5 text-[9px] border rounded"
                                                    placeholder="新增标签（可粘贴多项）"
                                                />
                                                <button
                                                    onClick={() => {
                                                        if (!newCategoryOption.trim()) return;
                                                        addCategoryOptions([newCategoryOption.trim()]);
                                                        setNewCategoryOption('');
                                                    }}
                                                    className="px-2 py-0.5 text-[9px] bg-purple-50 text-purple-700 rounded hover:bg-purple-100"
                                                >
                                                    添加
                                                </button>
                                            </div>
                                        </div>

                                        <div className="text-[9px] text-slate-400">
                                            提示：点击图片右上角可收藏或设置媒体标签
                                        </div>
                                    </div>
                                )}
                            </div>

                            <div className="flex items-center justify-between border border-slate-200 bg-slate-50 rounded-lg px-2 py-1">
                            </div>
                            <button
                                onClick={handleResetConfig}
                                className="w-full py-1.5 text-[10px] text-red-600 hover:bg-red-50 rounded border border-red-200 flex items-center justify-center gap-1"
                            >
                                <Trash2 size={10} /> 恢复默认设置
                            </button>

                            {/* Quick Actions */}
                            <div className="bg-indigo-50 rounded-lg p-2 border border-indigo-100">
                                <div className="flex items-center gap-1 mb-2">
                                    <span className="text-[10px] text-indigo-500">源分页:</span>
                                    <input
                                        type="text"
                                        value={sheetName}
                                        onChange={e => setSheetName(e.target.value)}
                                        className="flex-1 px-1.5 py-0.5 text-xs border border-indigo-200 rounded focus:ring-1 focus:ring-indigo-500 bg-white"
                                        placeholder="Sheet1"
                                    />
                                </div>
                                <div className="flex flex-wrap gap-1">
                                    <button
                                        onClick={handleCopyData}
                                        disabled={outputPlan.length === 0}
                                        className="flex-1 px-2 py-1 text-[10px] font-medium bg-green-500 hover:bg-green-600 text-white rounded flex items-center justify-center gap-1 disabled:opacity-50 transition-colors"
                                    >
                                        {copiedData ? <Check size={10} /> : <Copy size={10} />}
                                        {copiedData ? '已复制' : '复制数据'}
                                    </button>
                                    <button
                                        onClick={handleCopyFormulas}
                                        disabled={outputPlan.length === 0}
                                        className="flex-1 px-2 py-1 text-[10px] font-medium bg-slate-500 hover:bg-slate-600 text-white rounded flex items-center justify-center gap-1 disabled:opacity-50 transition-colors"
                                    >
                                        {copied ? <Check size={10} /> : <Copy size={10} />}
                                        公式
                                    </button>
                                    <button
                                        onClick={handleExport}
                                        disabled={outputPlan.length === 0}
                                        className="flex-1 px-2 py-1 text-[10px] font-medium bg-indigo-500 hover:bg-indigo-600 text-white rounded flex items-center justify-center gap-1 disabled:opacity-50 transition-colors"
                                    >
                                        <Download size={10} />
                                        导出
                                    </button>
                                </div>
                            </div>

                            {/* Config Versions */}
                            <div className="bg-slate-50 rounded-lg p-2 border border-slate-200">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs font-semibold text-slate-600 flex items-center gap-1">
                                        <Bookmark size={12} />
                                        配置版本
                                        {cloudSyncing ? (
                                            <Loader2 size={10} className="animate-spin text-indigo-500" />
                                        ) : cloudSyncEnabled ? (
                                            <span className="tooltip-bottom" data-tip="已连接云端"><Cloud size={10} className="text-green-500" /></span>
                                        ) : (
                                            <span className="tooltip-bottom" data-tip="未登录，仅本地保存"><CloudOff size={10} className="text-slate-400" /></span>
                                        )}
                                    </span>
                                    <button
                                        onClick={savePreset}
                                        disabled={cloudSyncing}
                                        className="flex items-center gap-1 px-2 py-1 text-[10px] bg-indigo-500 hover:bg-indigo-600 text-white rounded transition-colors disabled:opacity-50"
                                    >
                                        <Plus size={10} /> 新建版本
                                    </button>
                                </div>
                                {cloudError && (
                                    <p className="text-[10px] text-red-500 mb-1">{cloudError}</p>
                                )}
                                <div className="flex flex-wrap gap-1">
                                    {presets.length === 0 ? (
                                        <p className="text-[10px] text-slate-400 py-1">点击"新建版本"保存当前配置</p>
                                    ) : (
                                        presets.map((preset) => (
                                            <div
                                                key={preset.id}
                                                className={`flex items-center gap-1 px-2 py-1 rounded text-xs cursor-pointer transition-all ${activePresetId === preset.id
                                                    ? 'bg-indigo-500 text-white'
                                                    : 'bg-white border border-slate-200 hover:border-indigo-300 text-slate-600'
                                                    }`}
                                                onClick={() => {
                                                    if (editingPresetId !== preset.id) {
                                                        loadPreset(preset);
                                                    }
                                                }}
                                                onDoubleClick={() => {
                                                    setEditingPresetId(preset.id);
                                                    setEditingPresetName(preset.name);
                                                }}
                                                className="tooltip-bottom" data-tip="点击加载 | 双击重命名"
                                            >
                                                {editingPresetId === preset.id ? (
                                                    <input
                                                        type="text"
                                                        value={editingPresetName}
                                                        onChange={e => setEditingPresetName(e.target.value)}
                                                        onBlur={() => {
                                                            if (editingPresetName.trim() && editingPresetName !== preset.name) {
                                                                renamePreset(preset.id, editingPresetName.trim());
                                                            }
                                                            setEditingPresetId(null);
                                                        }}
                                                        onKeyDown={e => {
                                                            if (e.key === 'Enter') {
                                                                if (editingPresetName.trim() && editingPresetName !== preset.name) {
                                                                    renamePreset(preset.id, editingPresetName.trim());
                                                                }
                                                                setEditingPresetId(null);
                                                            } else if (e.key === 'Escape') {
                                                                setEditingPresetId(null);
                                                            }
                                                        }}
                                                        onClick={e => e.stopPropagation()}
                                                        autoFocus
                                                        className="px-1 py-0 text-xs bg-white text-slate-800 border border-indigo-300 rounded outline-none w-20"
                                                    />
                                                ) : (
                                                    <span className="max-w-[120px] truncate">{preset.name}</span>
                                                )}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        deletePreset(preset.id);
                                                    }}
                                                    className={`p-0.5 rounded hover:bg-red-100 ${activePresetId === preset.id ? 'hover:bg-red-400' : ''}`}
                                                >
                                                    <Trash2 size={10} className={activePresetId === preset.id ? 'text-white' : 'text-red-400'} />
                                                </button>
                                            </div>
                                        ))
                                    )}
                                </div>
                            </div>

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
                                {sheetsSpreadsheetId && activePresetId && (
                                    <button
                                        onClick={async () => {
                                            const token = getGoogleAccessToken();
                                            if (!token) {
                                                setSheetsError('需要重新登录 Google 账号获取写入权限');
                                                return;
                                            }
                                            setSheetsSyncing(true);
                                            setSheetsError(null);
                                            try {
                                                const preset = presets.find(p => p.id === activePresetId);
                                                await syncVersionToGoogleSheet(
                                                    sheetsSpreadsheetId,
                                                    preset?.name || '转置结果',
                                                    outputPlan.map(o => ({ label: o.label, data: o.data })),
                                                    token
                                                );
                                                alert('同步成功！已在表格中创建新分页');
                                            } catch (err: unknown) {
                                                setSheetsError(err instanceof Error ? err.message : '同步失败');
                                            } finally {
                                                setSheetsSyncing(false);
                                            }
                                        }}
                                        disabled={sheetsSyncing || outputPlan.length === 0}
                                        className="mt-2 w-full px-2 py-1.5 text-xs bg-green-500 hover:bg-green-600 text-white rounded flex items-center justify-center gap-1 disabled:opacity-50"
                                    >
                                        {sheetsSyncing ? (
                                            <><Loader2 size={12} className="animate-spin" /> 同步中...</>
                                        ) : (
                                            <><RefreshCw size={12} /> 同步当前版本到表格</>
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

                            {/* Page Size */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                    每组显示行数
                                </label>
                                <input
                                    type="number"
                                    value={config.pageSize}
                                    onChange={e => updateConfig({ pageSize: parseInt(e.target.value) || 0 })}
                                    min={0}
                                    max={1000}
                                    className="w-full px-3 py-2.5 text-sm bg-gradient-to-r from-indigo-500 to-purple-500 text-white placeholder-indigo-200 rounded-xl focus:ring-2 focus:ring-indigo-300 font-medium shadow-sm"
                                    placeholder="0 = 不分页"
                                />
                                <p className="text-[10px] text-slate-400 mt-1">超出此数量的分组会分页显示</p>
                            </div>

                            {/* Merge Threshold */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                    小分组合并阈值
                                </label>
                                <input
                                    type="number"
                                    value={config.mergeThreshold}
                                    onChange={e => updateConfig({ mergeThreshold: parseInt(e.target.value) || 0 })}
                                    min={0}
                                    max={100}
                                    className="w-full px-3 py-2.5 text-sm bg-gradient-to-r from-violet-500 to-fuchsia-500 text-white placeholder-violet-200 rounded-xl focus:ring-2 focus:ring-violet-300 font-medium shadow-sm"
                                    placeholder="0 = 不合并"
                                />
                                <p className="text-[10px] text-slate-400 mt-1">少于此数量的分组合并为"其他"，0=不合并</p>
                            </div>

                            {/* Fuzzy Rules */}
                            <div>
                                <label className="block text-xs font-semibold text-slate-700 mb-1.5">
                                    模糊匹配规则
                                </label>
                                <textarea
                                    value={fuzzyRuleText}
                                    onChange={e => setFuzzyRuleText(e.target.value)}
                                    placeholder="服饰=衣服|衣物;家居=生活"
                                    className="w-full px-2.5 py-2 text-xs bg-gradient-to-r from-emerald-500 to-green-500 text-white placeholder-emerald-200 rounded-xl focus:ring-2 focus:ring-emerald-300 font-medium shadow-sm h-16 resize-none"
                                />
                                <p className="text-[10px] text-slate-400 mt-1">格式：分组名=关键词1|关键词2;...</p>
                            </div>

                            {/* Stats */}
                            {groups.length > 0 && (
                                <div className="p-3 bg-indigo-50 rounded-lg border border-indigo-100">
                                    <div className="flex items-center gap-2 text-xs text-indigo-700">
                                        <Info size={14} />
                                        <span>
                                            已分析 <b>{stats.total}</b> 行，识别 <b>{stats.groups}</b> 个分组
                                            <span className="ml-1 text-indigo-500">
                                                ({stats.type === 'date' ? '日期' :
                                                    stats.type === 'numbered' ? '序号分类' :
                                                        stats.type === 'number' ? '数字' : '文本'}类型)
                                            </span>
                                        </span>
                                    </div>
                                    {/* 警告：只有一个分组 */}
                                    {stats.groups === 1 && (
                                        <div className="mt-2 text-xs text-amber-600 flex items-center gap-1.5">
                                            <AlertCircle size={14} className="text-amber-500" />
                                            <span>分组列只有一个唯一值，建议选择其他列进行分组</span>
                                        </div>
                                    )}
                                    {/* 警告：全部为空值 */}
                                    {stats.groups === 1 && groups[0]?.key === '(空)' && (
                                        <div className="mt-2 text-xs text-red-600 flex items-center gap-1.5">
                                            <AlertCircle size={14} className="text-red-500" />
                                            <span>分组列数据全为空，请检查数据或选择其他列</span>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* === 显示设置 === */}
                            <div className="border-t border-slate-200 pt-3">
                                <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1"><Sparkles size={12} /> 显示设置</div>
                                <div className="space-y-3">
                                    {/* Reset to Defaults Button */}
                                    <button
                                        onClick={() => {
                                            setThumbnailSize(170); // Default image row height
                                            setNormalRowHeight(36);
                                            setCellWidth(100);
                                            setBorderWidth(1);
                                            setBorderColor('#e2e8f0');
                                            setColumnRowHeights({});
                                            localStorage.removeItem(DISPLAY_SETTINGS_KEY);
                                        }}
                                        className="w-full px-2 py-1.5 text-[10px] font-medium bg-slate-100 hover:bg-slate-200 text-slate-600 rounded flex items-center justify-center gap-1 transition-colors"
                                    >
                                        <RotateCcw size={10} />
                                        恢复默认设置
                                    </button>
                                    {/* Default Row Heights */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-500">默认图片行</span>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="range"
                                                min={30}
                                                max={300}
                                                value={thumbnailSize}
                                                onChange={(e) => setThumbnailSize(Number(e.target.value))}
                                                className="w-14 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                            />
                                            <ClickableNumber value={thumbnailSize} min={30} max={300} onChange={setThumbnailSize} />
                                        </div>
                                    </div>
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-500">默认普通行</span>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="range"
                                                min={24}
                                                max={100}
                                                value={normalRowHeight}
                                                onChange={(e) => setNormalRowHeight(Number(e.target.value))}
                                                className="w-14 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                            />
                                            <ClickableNumber value={normalRowHeight} min={24} max={100} onChange={setNormalRowHeight} />
                                        </div>
                                    </div>

                                    {/* Per-Column Row Heights - Collapsible */}
                                    {config.dataColumns.length > 0 && (
                                        <div className="border-t border-slate-100 pt-2 mt-2">
                                            <button
                                                onClick={() => setShowColumnHeights(!showColumnHeights)}
                                                className="w-full flex items-center justify-between mb-1 hover:bg-slate-50 rounded px-1 py-0.5"
                                            >
                                                <span className="text-xs font-semibold text-slate-600">📏 各列行高 ({config.dataColumns.length})</span>
                                                {showColumnHeights ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                                            </button>
                                            {showColumnHeights && (
                                                <div className="space-y-0.5">
                                                    {config.dataColumns.map(col => (
                                                        <div key={col} className="flex items-center gap-1 py-0.5 hover:bg-slate-50 rounded text-[10px] min-w-0">
                                                            <span className="text-slate-600 truncate min-w-0 flex-1">{col}</span>
                                                            <input
                                                                type="range"
                                                                min={20}
                                                                max={200}
                                                                value={columnRowHeights[col] || (rowHasImages([col]) ? thumbnailSize : normalRowHeight)}
                                                                onChange={(e) => setColumnRowHeights(prev => ({ ...prev, [col]: Number(e.target.value) }))}
                                                                className="w-16 shrink-0 h-1 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                                            />
                                                            <ClickableNumber
                                                                value={columnRowHeights[col] || (rowHasImages([col]) ? thumbnailSize : normalRowHeight)}
                                                                min={20}
                                                                max={200}
                                                                onChange={(val) => setColumnRowHeights(prev => ({ ...prev, [col]: val }))}
                                                            />
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {/* Column Width */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-500">列宽</span>
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="range"
                                                min={60}
                                                max={400}
                                                value={cellWidth}
                                                onChange={(e) => setCellWidth(Number(e.target.value))}
                                                className="w-14 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                            />
                                            <ClickableNumber value={cellWidth} min={60} max={400} onChange={setCellWidth} />
                                        </div>
                                    </div>
                                    {/* Row Height */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-500">行高</span>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="range"
                                                min={24}
                                                max={120}
                                                value={normalRowHeight}
                                                onChange={(e) => setNormalRowHeight(Number(e.target.value))}
                                                className="w-14 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                            />
                                            <ClickableNumber value={normalRowHeight} min={24} max={120} onChange={setNormalRowHeight} />
                                        </div>
                                    </div>
                                    {/* Border Width */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-500">边框粗细</span>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="range"
                                                min={0}
                                                max={5}
                                                value={borderWidth}
                                                onChange={(e) => setBorderWidth(Number(e.target.value))}
                                                className="w-12 h-1.5 bg-slate-200 rounded-lg appearance-none cursor-pointer accent-indigo-500"
                                            />
                                            <span className="text-xs text-slate-600 w-6">{borderWidth}px</span>
                                            <input
                                                type="color"
                                                value={borderColor}
                                                onChange={(e) => setBorderColor(e.target.value)}
                                                className="w-5 h-5 rounded cursor-pointer border border-slate-300 tooltip-bottom"
                                                 data-tip="边框颜色"
                                            />
                                        </div>
                                    </div>
                                    {/* Hover Preview Toggle */}
                                    <div className="flex items-center justify-between">
                                        <span className="text-xs text-slate-500">悬停预览大图</span>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={hoverPreview}
                                                onChange={() => setHoverPreview(!hoverPreview)}
                                                className="sr-only peer"
                                            />
                                            <div className="w-9 h-5 bg-slate-300 peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
                                        </label>
                                    </div>
                                    {/* Show All Rows Toggle */}
                                    <div className="flex items-center justify-between">
                                        <div className="flex flex-col">
                                            <span className="text-xs text-slate-500">立即显示全部</span>
                                            <span className="text-[9px] text-slate-400">设置完成后开启</span>
                                        </div>
                                        <label className="relative inline-flex items-center cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={showAllRows}
                                                onChange={() => setShowAllRows(!showAllRows)}
                                                className="sr-only peer"
                                            />
                                            <div className="w-9 h-5 bg-slate-300 peer-focus:ring-2 peer-focus:ring-amber-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-amber-500"></div>
                                        </label>
                                    </div>

                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Expand Button when panel is collapsed */
                    <button
                        onClick={() => setShowLeftPanel(true)}
                        className="w-6 h-full bg-white border-r border-slate-200 hover:bg-indigo-50 transition-colors flex items-center justify-center shrink-0 tooltip-bottom"
                         data-tip="展开设置面板"
                    >
                        <ChevronRight size={14} className="text-slate-500" />
                    </button>
                )}

                {/* Right Panel - Preview */}
                <div className="flex-1 overflow-hidden flex flex-col bg-slate-100">
                    {/* Group Preview Header */}
                    <div className="bg-white border-b border-slate-200 px-4 py-2 shrink-0">
                        <div className="flex items-center justify-between">
                            <button
                                onClick={() => {
                                    const newValue = !showGroupPreview;
                                    setShowGroupPreview(newValue);
                                    // When expanding group preview, collapse output preview
                                    if (newValue) setShowOutputPreview(false);
                                }}
                                className="flex items-center gap-2 text-sm font-semibold text-slate-700 hover:text-slate-900"
                            >
                                {showGroupPreview ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                                分组预览
                                <span className="text-xs font-normal text-slate-400">({groups.length} 组)</span>
                            </button>
                            {showGroupPreview && groups.length > 0 && (
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setExpandedGroups(new Set(groups.map(g => g.key)))}
                                        className="px-2 py-1 text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 rounded transition-colors"
                                    >
                                        全部展开
                                    </button>
                                    <button
                                        onClick={() => setExpandedGroups(new Set())}
                                        className="px-2 py-1 text-[10px] bg-slate-100 text-slate-600 hover:bg-slate-200 rounded transition-colors"
                                    >
                                        全部收起
                                    </button>
                                </div>
                            )}
                        </div>
                        {showGroupPreview && <p className="text-[10px] text-slate-400 mt-1">点击分组查看数据详情</p>}
                    </div>

                    {/* Groups List - Compact height */}
                    {showGroupPreview && (
                        <div className={`overflow-y-auto p-4 space-y-2 ${showOutputPreview ? 'max-h-64' : 'flex-1'}`}>
                            {groups.length === 0 ? (
                                <div className="flex flex-col items-center justify-center py-8 text-slate-400">
                                    <ArrowRightLeft size={48} className="mb-4 opacity-30" />
                                    <p className="text-sm">请先选择要显示的数据列</p>
                                    <p className="text-xs mt-1">配置完成后将自动生成转置预览</p>
                                </div>
                            ) : (
                                <>
                                    {groups.map(group => (
                                        <div key={group.key} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                            <button
                                                onClick={() => toggleGroupExpand(group.key)}
                                                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors"
                                            >
                                                <div className="flex items-center gap-3">
                                                    <TypeIcon type={group.type} />
                                                    <span className="font-medium text-slate-800">{group.label || group.key}</span>
                                                    <span className="text-xs px-2 py-0.5 bg-slate-100 text-slate-600 rounded-full">
                                                        {group.count} 条
                                                    </span>
                                                </div>
                                                {expandedGroups.has(group.key) ? (
                                                    <ChevronUp size={16} className="text-slate-400" />
                                                ) : (
                                                    <ChevronDown size={16} className="text-slate-400" />
                                                )}
                                            </button>

                                            {expandedGroups.has(group.key) && (
                                                <div className="border-t border-slate-100 p-3 bg-slate-50">
                                                    <div className="text-xs text-slate-500 mb-2">
                                                        <ArrowRightLeft size={12} className="inline mr-1" /> 转置预览 (每行=字段，每列=数据)
                                                    </div>
                                                    <div className="overflow-x-auto max-h-[400px] overflow-y-auto">
                                                        <table className="text-xs border-collapse">
                                                            <thead className="sticky top-0 z-10">
                                                                <tr className="bg-blue-50">
                                                                    <th className="px-3 py-2 text-left text-blue-700 font-bold sticky left-0 z-20 bg-blue-50 min-w-[140px]" style={{ borderRight: `${borderWidth}px solid ${borderColor}`, borderBottom: `${borderWidth}px solid ${borderColor}` }}>
                                                                        字段
                                                                    </th>
                                                                    {group.rows.slice(0, 30).map((_, idx) => (
                                                                        <th
                                                                            key={idx}
                                                                            className="px-2 py-2 text-center text-blue-600 font-medium"
                                                                            style={{
                                                                                minWidth: `${cellWidth}px`,
                                                                                borderRight: `${borderWidth}px solid ${borderColor}`,
                                                                                borderBottom: `${borderWidth}px solid ${borderColor}`
                                                                            }}
                                                                        >
                                                                            #{idx + 1}
                                                                        </th>
                                                                    ))}
                                                                    {group.rows.length > 30 && (
                                                                        <th className="px-2 py-2 text-center text-blue-400" style={{ borderBottom: `${borderWidth}px solid ${borderColor}` }}>
                                                                            +{group.rows.length - 30}
                                                                        </th>
                                                                    )}
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {effectiveDataColumns.map((col, colIdx) => {
                                                                    // Get row height for this column (image rows = 2x normal height)
                                                                    const customHeight = columnRowHeights[col];
                                                                    const colData = group.rows.map(r => r[col]);
                                                                    const hasImages = rowHasImages(colData);
                                                                    const rowHeight = customHeight || (hasImages ? thumbnailSize : normalRowHeight);

                                                                    return (
                                                                        <tr key={col} className="hover:bg-blue-50/30 group">
                                                                            <td
                                                                                className="px-3 py-2 bg-slate-50 font-medium text-slate-700 sticky left-0 z-10 whitespace-nowrap relative"
                                                                                style={{ borderRight: `${borderWidth}px solid ${borderColor}`, borderBottom: `${borderWidth}px solid ${borderColor}` }}
                                                                            >
                                                                                {col}
                                                                                {/* Resize Handle - 6px tall for easier grabbing */}
                                                                                <div
                                                                                    className="absolute -bottom-3 left-0 right-0 h-6 cursor-ns-resize flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity z-20"
                                                                                    onMouseDown={(e) => handleRowResizeStart(col, rowHeight, e)}
                                                                                    className="tooltip-bottom" data-tip="拖拽调整行高"
                                                                                >
                                                                                    <div className="w-8 h-1 bg-indigo-500 rounded-full" />
                                                                                </div>
                                                                            </td>
                                                                            {group.rows.slice(0, 30).map((row, rowIdx) => {
                                                                                const highlightColor = checkRowHighlight(row);
                                                                                return (
                                                                                    <td
                                                                                        key={rowIdx}
                                                                                        className="px-2 py-1 align-middle"
                                                                                        style={{
                                                                                            minWidth: `${cellWidth}px`,
                                                                                            height: `${rowHeight}px`,
                                                                                            borderRight: `${borderWidth}px solid ${borderColor}`,
                                                                                            borderBottom: `${borderWidth}px solid ${borderColor}`,
                                                                                            backgroundColor: highlightColor || undefined
                                                                                        }}
                                                                                    >
                                                                                        {renderCellValue(row[col], rowHeight, row)}
                                                                                    </td>
                                                                                );
                                                                            })}
                                                                            {group.rows.length > 30 && (
                                                                                <td
                                                                                    className="px-2 py-2 text-center text-slate-400"
                                                                                    style={{ borderBottom: `${borderWidth}px solid ${borderColor}` }}
                                                                                >
                                                                                    +{group.rows.length - 30}
                                                                                </td>
                                                                            )}
                                                                        </tr>
                                                                    );
                                                                })}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                    <div className="mt-2 text-xs text-slate-400">
                                                        共 {effectiveDataColumns.length} 个字段 × {group.rows.length} 条数据 | 显示前 30 列
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </>
                            )}
                        </div>
                    )}

                    {/* Output Preview - Collapsible */}
                    {outputPlan.length > 0 && (
                        <div className={`p-4 flex flex-col min-h-0 ${showOutputPreview ? 'flex-1' : ''}`}>
                            <div className={`bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col ${showOutputPreview ? 'flex-1' : ''}`}>
                                <button
                                    onClick={() => {
                                        const newValue = !showOutputPreview;
                                        setShowOutputPreview(newValue);
                                        // When expanding output preview, collapse group preview
                                        if (newValue) setShowGroupPreview(false);
                                    }}
                                    className="w-full bg-gradient-to-r from-orange-50 to-amber-50 px-4 py-3 border-b border-orange-100 flex items-center justify-between hover:from-orange-100 hover:to-amber-100 transition-colors"
                                >
                                    <h4 className="text-sm font-bold text-orange-800 flex items-center gap-2">
                                        {showOutputPreview ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
                                        <ArrowRightLeft size={14} /> 转置输出预览
                                        <span className="text-xs font-normal text-orange-600 bg-orange-100 px-2 py-0.5 rounded-full">
                                            {outputPlan.length} 行 × {Math.max(...outputPlan.map(p => p.data.length))} 列
                                        </span>
                                    </h4>
                                    <span className="text-[10px] text-slate-400">
                                        点击{showOutputPreview ? '收起' : '展开'}
                                    </span>
                                </button>
                                {showOutputPreview && (
                                    <div className="overflow-x-auto overflow-y-auto flex-1" style={{ maxHeight: 'calc(100vh - 200px)', minHeight: '400px' }}>
                                        {/* Selection indicator */}
                                        {selectionStart && selectionEnd && (
                                            <div className="sticky top-0 z-30 bg-blue-600 text-white px-3 py-1.5 flex items-center justify-between text-xs">
                                                <span>
                                                    已选择 {Math.abs(selectionEnd.row - selectionStart.row) + 1} × {Math.abs(selectionEnd.col - selectionStart.col) + 1} 个单元格
                                                </span>
                                                <div className="flex items-center gap-2">
                                                    <span className="opacity-75">⌘C / Ctrl+C 复制</span>
                                                    <button
                                                        onClick={copySelectedCells}
                                                        className="px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded transition-colors"
                                                    >
                                                        {copiedData ? '✓ 已复制' : '复制'}
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            setSelectionStart(null);
                                                            setSelectionEnd(null);
                                                        }}
                                                        className="px-2 py-0.5 bg-white/20 hover:bg-white/30 rounded transition-colors"
                                                    >
                                                        取消
                                                    </button>
                                                </div>
                                            </div>
                                        )}
                                        <table ref={tableRef} tabIndex={0} className="w-full border-collapse outline-none select-none will-change-auto">
                                            {/* Column Headers */}
                                            <thead className="sticky top-0 z-10">
                                                <tr>
                                                    {/* Row Number Header */}
                                                    <th className="px-1 py-2 bg-[#f8f9fa] text-center text-[#80868b] font-medium text-[10px] border-r border-b border-[#e0e0e0] sticky left-0 z-20 w-32px">
                                                        #
                                                    </th>
                                                    {/* A Column Header */}
                                                    <th className="px-3 py-2 bg-orange-100 text-left text-orange-800 font-bold text-xs border-r border-b border-orange-200 sticky z-20 min-w-[150px] left-32px">
                                                        A
                                                    </th>
                                                    {Array.from({ length: Math.max(...outputPlan.map(p => p.data.length), 1) }).map((_, i) => (
                                                        <th
                                                            key={i}
                                                            className="px-2 py-2 bg-orange-50 text-center text-orange-700 font-semibold text-xs border-r border-b border-orange-200"
                                                            style={{ minWidth: `${cellWidth}px` }}
                                                        >
                                                            {i < 25 ? String.fromCharCode(66 + i) : `${String.fromCharCode(65 + Math.floor(i / 26))}${String.fromCharCode(65 + (i % 26))}`}
                                                        </th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {(() => {
                                                    // Pre-calculate group indices for consistent coloring
                                                    const groupColors = [
                                                        { bg: 'bg-blue-50', border: 'border-blue-200', header: 'bg-blue-100', text: 'text-blue-700' },
                                                        { bg: 'bg-green-50', border: 'border-green-200', header: 'bg-green-100', text: 'text-green-700' },
                                                        { bg: 'bg-purple-50', border: 'border-purple-200', header: 'bg-purple-100', text: 'text-purple-700' },
                                                        { bg: 'bg-amber-50', border: 'border-amber-200', header: 'bg-amber-100', text: 'text-amber-700' },
                                                        { bg: 'bg-rose-50', border: 'border-rose-200', header: 'bg-rose-100', text: 'text-rose-700' },
                                                        { bg: 'bg-cyan-50', border: 'border-cyan-200', header: 'bg-cyan-100', text: 'text-cyan-700' },
                                                        { bg: 'bg-indigo-50', border: 'border-indigo-200', header: 'bg-indigo-100', text: 'text-indigo-700' },
                                                        { bg: 'bg-orange-50', border: 'border-orange-200', header: 'bg-orange-100', text: 'text-orange-700' },
                                                    ];

                                                    let currentGroupIdx = 0;
                                                    let lastGroup = '';

                                                    const rowsToShow = showAllRows ? outputPlan : outputPlan.slice(0, visibleRowCount);
                                                    return rowsToShow.map((plan, rowIdx) => {
                                                        const currentGroup = plan.label.match(/\[([^\]]+)\]/)?.[1] || '';
                                                        const isNewGroup = currentGroup !== lastGroup;
                                                        if (isNewGroup && rowIdx > 0) {
                                                            currentGroupIdx++;
                                                        }
                                                        lastGroup = currentGroup;

                                                        const color = groupColors[currentGroupIdx % groupColors.length];
                                                        // Get row height: custom > auto-detect (image rows = 2x normal height)
                                                        const customHeight = columnRowHeights[plan.column];
                                                        const hasImages = rowHasImages(plan.data);
                                                        const rowHeight = customHeight || (hasImages ? thumbnailSize : normalRowHeight);

                                                        return (
                                                            <tr
                                                                key={rowIdx}
                                                                className={`hover:brightness-95 ${isNewGroup && rowIdx > 0 ? 'border-t-2 border-t-slate-400' : ''}`}
                                                                style={{ contentVisibility: 'auto', containIntrinsicSize: `auto ${rowHeight}px` }}
                                                            >
                                                                {/* Row Number - click to select row, bottom border to resize */}
                                                                <td
                                                                    className={`relative px-1 py-1 text-center text-[10px] border-r border-b border-[#e0e0e0] sticky left-0 z-10 bg-[#f8f9fa] text-[#80868b] cursor-pointer select-none hover:bg-[#e8eaed] transition-colors ${selectionStart && selectionEnd && selectionStart.col === -2 && selectionEnd.col === -2 && rowIdx >= Math.min(selectionStart.row, selectionEnd.row) && rowIdx <= Math.max(selectionStart.row, selectionEnd.row) ? 'bg-blue-200' : ''}`}
                                                                    className="w-32px"
                                                                    onMouseDown={(e) => {
                                                                        e.preventDefault();
                                                                        // Select entire row (col -2 means row selection mode)
                                                                        setSelectionStart({ row: rowIdx, col: -2 });
                                                                        setSelectionEnd({ row: rowIdx, col: -2 });
                                                                        setIsSelecting(true);
                                                                    }}
                                                                    onMouseEnter={() => {
                                                                        if (isSelecting && selectionStart?.col === -2) {
                                                                            setSelectionEnd({ row: rowIdx, col: -2 });
                                                                        }
                                                                    }}
                                                                    onMouseUp={handleCellMouseUp}
                                                                >
                                                                    {rowIdx + 1}
                                                                    {/* Row resize handle at bottom */}
                                                                    <div
                                                                        className="absolute bottom-0 left-0 right-0 h-1 cursor-ns-resize hover:bg-blue-400 z-20"
                                                                        onMouseDown={(e) => {
                                                                            e.stopPropagation();
                                                                            e.preventDefault();
                                                                            handleRowResizeStart(plan.column, rowHeight, e);
                                                                        }}
                                                                    />
                                                                </td>
                                                                {/* A column (Label) - normal cell selection */}
                                                                <td
                                                                    className={`px-2 py-1 text-xs border-r border-b ${color.border} sticky z-10 whitespace-nowrap ${color.header} ${color.text} cursor-cell select-none ${isCellSelected(rowIdx, -1) || (selectionStart?.col === -2 && selectionEnd?.col === -2 && rowIdx >= Math.min(selectionStart.row, selectionEnd.row) && rowIdx <= Math.max(selectionStart.row, selectionEnd.row)) ? 'bg-blue-100 ring-2 ring-inset ring-blue-500' : ''}`}
                                                                    className="left-32px"
                                                                    onMouseDown={(e) => handleCellMouseDown(rowIdx, -1, e)}
                                                                    onMouseEnter={() => handleCellMouseEnter(rowIdx, -1)}
                                                                    onMouseUp={handleCellMouseUp}
                                                                >
                                                                    <span className="truncate font-medium">{plan.label}</span>
                                                                </td>
                                                                {/* Data Cells - Show ALL columns with selection support */}
                                                                {plan.data.map((val, colIdx) => {
                                                                    // Check if cell is selected (normal mode or row selection mode)
                                                                    const isRowSelected = selectionStart?.col === -2 && selectionEnd?.col === -2 && rowIdx >= Math.min(selectionStart.row, selectionEnd.row) && rowIdx <= Math.max(selectionStart.row, selectionEnd.row);
                                                                    const isSelected = isCellSelected(rowIdx, colIdx) || isRowSelected;
                                                                    const highlightColor = !isSelected ? checkHighlight(val, plan.column) : null;
                                                                    const sourceRow = plan.rows?.[colIdx];
                                                                    return (
                                                                        <td
                                                                            key={colIdx}
                                                                            className={`px-2 py-1 align-middle cursor-cell select-none ${isSelected ? 'bg-blue-100 ring-2 ring-inset ring-blue-500' : ''}`}
                                                                            style={{
                                                                                minWidth: `${cellWidth}px`,
                                                                                height: `${rowHeight}px`,
                                                                                borderRight: `${borderWidth}px solid ${borderColor}`,
                                                                                borderBottom: `${borderWidth}px solid ${borderColor}`,
                                                                                backgroundColor: highlightColor || undefined
                                                                            }}
                                                                            onMouseDown={(e) => handleCellMouseDown(rowIdx, colIdx, e)}
                                                                            onMouseEnter={() => handleCellMouseEnter(rowIdx, colIdx)}
                                                                            onMouseUp={handleCellMouseUp}
                                                                        >
                                                                            <div className="flex items-center justify-center">
                                                                                {renderCellValue(val, rowHeight, sourceRow)}
                                                                            </div>
                                                                        </td>
                                                                    );
                                                                })}
                                                            </tr>
                                                        );
                                                    });
                                                })()}
                                                {/* Load More Button */}
                                                {!showAllRows && outputPlan.length > visibleRowCount && (
                                                    <tr>
                                                        <td
                                                            colSpan={Math.max(...outputPlan.map(p => p.data.length), 1) + 1}
                                                            className="px-3 py-3 text-center bg-slate-50 border-t border-slate-200"
                                                        >
                                                            <button
                                                                onClick={() => setVisibleRowCount(prev => Math.min(prev + 50, outputPlan.length))}
                                                                className="px-4 py-1.5 text-xs bg-indigo-100 text-indigo-700 hover:bg-indigo-200 rounded-lg transition-colors"
                                                            >
                                                                加载更多 ({visibleRowCount} / {outputPlan.length})
                                                            </button>
                                                            <button
                                                                onClick={() => setVisibleRowCount(outputPlan.length)}
                                                                className="ml-2 px-4 py-1.5 text-xs bg-slate-100 text-slate-600 hover:bg-slate-200 rounded-lg transition-colors"
                                                            >
                                                                显示全部
                                                            </button>
                                                        </td>
                                                    </tr>
                                                )}
                                            </tbody>
                                        </table>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Global Hover Preview Overlay */}
            {
                hoveredImage && (
                    <div className="fixed inset-0 z-[9999] pointer-events-none flex items-center justify-center bg-black/30">
                        <div className="bg-white p-4 rounded-2xl shadow-2xl border border-slate-200">
                            <img
                                src={hoveredImage}
                                alt="预览"
                                className="max-w-[500px] max-h-[500px] object-contain rounded-xl"
                            />
                        </div>
                    </div>
                )
            }

            {/* Category Modal */}
            {categoryModal.isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-[300]"
                    onClick={closeCategoryModal}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-md mx-4 overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-4 py-3 border-b border-slate-100 flex items-center justify-between">
                            <h3 className="text-sm font-semibold text-slate-800">媒体标签</h3>
                            <button onClick={closeCategoryModal} className="text-slate-400 hover:text-slate-600">
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-4">
                            {categoryModal.currentCategory && (
                                <div className="text-[10px] text-slate-500 mb-2">
                                    当前: <span className="text-purple-600 font-medium">{categoryModal.currentCategory}</span>
                                </div>
                            )}
                            <div className="grid grid-cols-2 gap-2 max-h-56 overflow-y-auto">
                                {categoryOptions.map((cat) => (
                                    <button
                                        key={cat}
                                        onClick={() => saveCategory(cat)}
                                        disabled={categoryModal.isSaving}
                                        className={`px-2 py-2 text-xs rounded border transition-colors ${categoryModal.currentCategory === cat
                                            ? 'bg-purple-600 text-white border-purple-600'
                                            : 'bg-white text-slate-700 border-slate-200 hover:border-purple-300'
                                            }`}
                                    >
                                        {cat}
                                    </button>
                                ))}
                            </div>
                            {categoryModal.currentCategory && (
                                <button
                                    onClick={() => saveCategory('')}
                                    disabled={categoryModal.isSaving}
                                    className="mt-3 w-full px-3 py-2 text-xs border border-slate-200 rounded text-slate-600 hover:bg-slate-50"
                                >
                                    清除标签
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* Favorite Folder Menu */}
            {favoriteMenu?.isOpen && (
                <div
                    className="fixed inset-0 z-[400]"
                    onMouseDown={() => setFavoriteMenu(null)}
                >
                    <div
                        ref={favoriteMenuRef}
                        className="absolute bg-white rounded-xl shadow-xl border border-slate-200 w-56 overflow-hidden"
                        style={{ left: favoriteMenuPos?.x ?? favoriteMenu.x, top: favoriteMenuPos?.y ?? favoriteMenu.y }}
                        onMouseDown={(e) => e.stopPropagation()}
                    >
                        <div className="px-3 py-2 text-[11px] font-semibold text-slate-700 border-b border-slate-100">
                            选择收藏夹
                        </div>
                        <div className="max-h-60 overflow-y-auto">
                            {favoriteFolders.map(folder => (
                                <button
                                    key={folder.id}
                                    onClick={() => {
                                        if (favoriteMenu.row) {
                                            addToFolder(favoriteMenu.imageUrl, favoriteMenu.row, folder.id);
                                        }
                                        setFavoriteMenu(null);
                                    }}
                                    className="w-full px-3 py-2 text-left text-[11px] text-slate-700 flex items-center gap-2 hover:bg-slate-50"
                                >
                                    <span>{folder.emoji || '📁'}</span>
                                    <span className="truncate">{folder.name}</span>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Confirm Dialog */}
            {confirmDialog && confirmDialog.isOpen && (
                <div
                    className="fixed inset-0 bg-black/50 flex items-center justify-center z-[200]"
                    onClick={() => setConfirmDialog(null)}
                >
                    <div
                        className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden animate-in fade-in zoom-in-95 duration-200"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className={`px-6 pt-6 pb-4 flex flex-col items-center ${confirmDialog.type === 'danger' ? 'text-red-600' :
                            confirmDialog.type === 'warning' ? 'text-amber-600' : 'text-blue-600'
                            }`}>
                            <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 ${confirmDialog.type === 'danger' ? 'bg-red-100' :
                                confirmDialog.type === 'warning' ? 'bg-amber-100' : 'bg-blue-100'
                                }`}>
                                {confirmDialog.type === 'danger' ? (
                                    <Trash2 size={28} />
                                ) : confirmDialog.type === 'warning' ? (
                                    <AlertCircle size={28} />
                                ) : (
                                    <Info size={28} />
                                )}
                            </div>
                            <h3 className="text-lg font-semibold text-slate-800">{confirmDialog.title}</h3>
                        </div>
                        <div className="px-6 pb-4">
                            <p className="text-sm text-slate-600 text-center">{confirmDialog.message}</p>
                        </div>
                        <div className="flex border-t border-slate-100">
                            <button
                                onClick={() => setConfirmDialog(null)}
                                className="flex-1 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors border-r border-slate-100"
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
            )}
        </div >
    );
};

TransposePanel.displayName = 'TransposePanel';

export default memo(TransposePanel);
