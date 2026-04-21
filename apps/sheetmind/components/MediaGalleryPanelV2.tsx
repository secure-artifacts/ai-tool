import React, { useState, useMemo, useCallback, useEffect, useLayoutEffect, memo, useRef, useDeferredValue, useTransition } from 'react';
import {
    X, ChevronDown, ChevronRight, Image, Calendar, User, Check,
    ZoomIn, ExternalLink, Settings2, ArrowUp, ArrowDown, Plus, Trash2,
    CalendarDays, LayoutGrid, ChevronLeft, Table2, Filter, ArrowRight, Info,
    Cloud, Download, Upload, Loader2, Bookmark, CloudOff, Link2, RefreshCw,
    Grid3X3, Star, Copy, MessageSquare, Edit3, Send, Tag, FolderPlus, RotateCcw, FolderTree, Layers, GripVertical,
    FileText, FolderOpen, Lightbulb, AlertCircle, BookOpen, ClipboardList, BarChart2, Video
} from 'lucide-react';
import { SheetData, DataRow } from '../types';
import { GalleryCalendarView } from './gallery/GalleryCalendarView';
import { GalleryTimelineView } from './gallery/GalleryTimelineView';
import { GalleryCategoryView } from './gallery/GalleryCategoryView';
import { GalleryFavoritesMode } from './gallery/GalleryFavoritesMode';
import { GalleryToolbar } from './gallery/GalleryToolbar';
import { GalleryConfigPanel } from './gallery/GalleryConfigPanel';
import { ImageCard } from './gallery/ImageCard';
import { NoteModal } from './gallery/NoteModal';
import { CategoryModal } from './gallery/CategoryModal';
import { NewFolderModal, EditFolderModal } from './gallery/NewFolderModal';
import { BatchCategoryModal, BatchNoteModal } from './gallery/BatchModals';
import { PresetEditorModal } from './gallery/PresetEditorModal';
import { LoginPromptModal } from './gallery/LoginPromptModal';
import { CopyViewModal } from './gallery/CopyViewModal';
import { FolderSelectionMenu, BatchFolderMenu } from './gallery/FolderMenus';
import { ConfirmDialog } from './gallery/ConfirmDialog';
import { HoverPreview } from './gallery/HoverPreview';
import { DragDropSidebar } from './gallery/DragDropSidebar';
import { ThumbnailContextMenu } from './gallery/ThumbnailContextMenu';
import { ImageModal, RowDetailModal } from './gallery/DetailModals';
import { FolderContextMenu } from './gallery/FolderContextMenu';
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
import JSZip from 'jszip';

// Native saveAs implementation (replaces file-saver dependency for AI Studio compatibility)
import {
    saveAs, extractImageUrl, parseDate, formatDateKey, formatDateValue,
    getGroupKey, isLikelyDateColumn, isImageFormulaColumn, isLikelyImageColumn,
    parseNumericValue, checkHighlight, getDefaultConfig, normalizeGalleryConfig,
    sanitizeSavedConfigForCloud, sanitizeFavoriteForCloud,
    STORAGE_KEY, SAVED_CONFIGS_KEY, FAVORITES_KEY, FAVORITE_FOLDERS_KEY,
    COLLAPSED_SECTIONS_KEY, HEADER_COLLAPSED_KEY, DEFAULT_COLLAPSED_SECTIONS,
    NOTE_COLUMN, CATEGORY_COLUMN, NOTE_HEADER, CATEGORY_HEADER,
    DEFAULT_IMAGE_COLUMN, DEFAULT_LINK_COLUMN, DEFAULT_FOLDER_ID,
    SortRule, NumFilter, GroupBinRange, DateBinRange,
    TextGroupCondition, TextGroupBin, GroupLevel,
    CustomFilter, HighlightRule, GalleryConfig, SavedConfig,
    GalleryPreset, FavoriteItem, FavoriteFolder,
} from './galleryUtils';
import { sortRowsByRules as sortRowsByRulesImpl, sortDateKeys as sortDateKeysImpl, computeProcessedRows, generateExportData as generateExportDataImpl , computeTimelineData, computeGroupedTimelineData, computeMatrixData , generateViewLayoutText , computeCalendarGrid , computeRowGroupKey } from './galleryViewData';
import { useThumbnailDownload } from './useThumbnailDownload';
import { useGallerySheetSync } from './useGallerySheetSync';

interface MediaGalleryPanelProps {
    data: SheetData;
    sourceUrl?: string;          // Google Sheets URL for sync-back
    currentSheetName?: string;   // Current sheet name for sync-back
    isLoading?: boolean;
    sharedConfig?: import('../types/sharedConfig').SharedConfig;
}


export type { GalleryConfig } from './galleryUtils';

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

    // Pure image mode: extract all image URLs from any cell, ignore row/column structure
    const effectivePureImageMode = sharedConfig?.pureImageMode ?? config.pureImageMode;

    const effectiveData = useMemo((): SheetData => {
        // Pure image mode: scan ALL cells to extract image URLs
        if (effectivePureImageMode && data.rows.length > 0) {
            const imageUrls = new Set<string>();

            // Helper function to check if a string looks like an image URL
            const isImageUrl = (url: string): boolean => {
                if (!url.startsWith('http://') && !url.startsWith('https://')) return false;
                const lowerUrl = url.toLowerCase();

                // 1. Standard image extensions
                if (/\.(jpg|jpeg|png|gif|webp|svg|bmp|avif|tiff|ico)(\?|$)/i.test(url)) return true;

                // 2. Known image CDN domains (often no extension)
                if (/pbs\.twimg\.com/i.test(url)) return true;  // Twitter
                if (/instagram\./i.test(url) && /scontent/i.test(url)) return true;  // Instagram CDN
                if (/fbcdn\.net|fbcdn\.com/i.test(url)) return true;  // Facebook CDN
                if (/cdninstagram\.com/i.test(url)) return true;  // Instagram CDN alt
                if (/imgur\.com/i.test(url)) return true;  // Imgur
                if (/googleusercontent\.com/i.test(url)) return true;  // Google
                if (/ggpht\.com/i.test(url)) return true;  // Google Photos
                if (/drive\.google\.com\/thumbnail/i.test(url)) return true;  // Google Drive thumbnails
                if (/tumblr\.com/i.test(url) && /media/i.test(url)) return true;  // Tumblr
                if (/pinimg\.com/i.test(url)) return true;  // Pinterest
                if (/twimg\.com/i.test(url)) return true;  // Twitter alt
                if (/cloudinary\.com/i.test(url)) return true;  // Cloudinary
                if (/unsplash\.com/i.test(url)) return true;  // Unsplash
                if (/pexels\.com/i.test(url)) return true;  // Pexels
                if (/flickr\.com|staticflickr\.com/i.test(url)) return true;  // Flickr
                if (/500px\.org/i.test(url)) return true;  // 500px
                if (/wp\.com|wordpress\.com/i.test(url) && /uploads/i.test(url)) return true;  // WordPress
                if (/cdn\./i.test(url) && /(image|photo|pic|img|media)/i.test(url)) return true;  // Generic CDN with image keywords

                // 3. URL path contains image-related keywords
                if (/(\/photo\/|\/image\/|\/media\/|\/pic\/|\/img\/|\/thumb\/|\/thumbnail\/)/i.test(url)) return true;

                // 4. URL with format parameter suggesting image
                if (/[?&](format|f)=(jpg|jpeg|png|gif|webp)/i.test(url)) return true;

                // 5. Generic pattern: any URL with image-like query params
                if (/[?&](w|h|width|height|size|quality)=/i.test(url) && lowerUrl.length > 50) return true;

                return false;
            };

            // Scan all cells in all rows
            for (const row of data.rows) {
                for (const col of data.columns) {
                    const cellValue = String(row[col] || '');
                    if (!cellValue) continue;

                    // Method 0: Parse =IMAGE("url") formulas (Google Sheets image formula)
                    const imageFormulaMatches = cellValue.match(/=IMAGE\s*\(\s*["']([^"']+)["']/gi);
                    if (imageFormulaMatches) {
                        for (const match of imageFormulaMatches) {
                            const urlMatch = match.match(/["']([^"']+)["']/);
                            if (urlMatch && urlMatch[1]) {
                                imageUrls.add(urlMatch[1]);
                            }
                        }
                    }

                    // Try to extract URLs from cell content
                    // Method 1: Split by common separators
                    const potentialUrls = cellValue.split(/[\s,;\n\t]+/).filter(Boolean);

                    for (const potential of potentialUrls) {
                        const url = potential.trim();
                        if (isImageUrl(url)) {
                            imageUrls.add(url);
                        }
                    }

                    // Method 2: Extract URLs using regex (for URLs embedded in text)
                    const urlMatches = cellValue.match(/https?:\/\/[^\s<>"')\]]+/gi);
                    if (urlMatches) {
                        for (const match of urlMatches) {
                            // Clean up trailing punctuation
                            const cleanUrl = match.replace(/[.,;:!?)\]]+$/, '');
                            if (isImageUrl(cleanUrl)) {
                                imageUrls.add(cleanUrl);
                            }
                        }
                    }
                }
            }

            // Convert to simple rows with just image column
            const newRows: DataRow[] = Array.from(imageUrls).map((url, idx) => ({
                '图片': url,
                '_pureImageIndex': idx
            }));

            return {
                ...data,
                columns: ['图片'],
                rows: newRows
            };
        }

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
    }, [data, sharedConfig?.transposeData, sharedConfig?.mergeTransposeColumns, config.transposeData, effectivePureImageMode, sharedConfig?.pureImageMode, config.pureImageMode]);

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
    const effectiveImageColumn = effectivePureImageMode ? '图片' : (isUsingSharedConfig && sharedConfig!.imageColumn ? sharedConfig!.imageColumn : config.imageColumn);
    const effectiveLinkColumn = isUsingSharedConfig && sharedConfig!.linkColumn ? sharedConfig!.linkColumn : config.linkColumn;
    const effectiveAccountColumn = isUsingSharedConfig && sharedConfig!.accountColumn ? sharedConfig!.accountColumn : config.accountColumn;
    const effectiveDetailColumn = isUsingSharedConfig && (sharedConfig?.detailColumn || '').trim()
        ? (sharedConfig?.detailColumn || '').trim()
        : (config.detailColumn || '').trim();
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
            detailColumn: (sharedConfig.detailColumn || prev.detailColumn || ''),
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
    const { downloadAllThumbnails: doDownload, downloadProgress, downloadFeedback } = useThumbnailDownload();
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
    const [contextDetailColumn, setContextDetailColumn] = useState<string>('');
    const contextMenuRef = React.useRef<HTMLDivElement | null>(null);
    const [contextMenuPos, setContextMenuPos] = useState<{ x: number; y: number } | null>(null);
    const contextMenuCloseTimerRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    const contextDetailColumns = useMemo(() => {
        if (!contextMenu) return [];
        const rowKeys = Object.keys(contextMenu.row || {});
        const textFirst = rowKeys.filter(col => /文案|描述|prompt|caption|copy|正文|标题|内容|text|script/i.test(col));
        const ordered = [effectiveDetailColumn, ...textFirst, ...effectiveLabelColumns, ...rowKeys];
        return ordered.filter((col, idx, arr) =>
            !!col &&
            col !== effectiveImageColumn &&
            col !== effectiveLinkColumn &&
            arr.indexOf(col) === idx
        );
    }, [contextMenu, effectiveDetailColumn, effectiveLabelColumns, effectiveImageColumn, effectiveLinkColumn]);

    const pickDefaultContextDetailColumn = useCallback((row: DataRow): string => {
        const rowKeys = Object.keys(row || {});
        const textFirst = rowKeys.filter(col => /文案|描述|prompt|caption|copy|正文|标题|内容|text|script/i.test(col));
        const ordered = [effectiveDetailColumn, ...textFirst, ...effectiveLabelColumns, ...rowKeys];
        const validColumns = ordered.filter((col, idx, arr) =>
            !!col &&
            col !== effectiveImageColumn &&
            col !== effectiveLinkColumn &&
            arr.indexOf(col) === idx
        );
        if (effectiveDetailColumn && validColumns.includes(effectiveDetailColumn)) {
            return effectiveDetailColumn;
        }
        const firstNonEmpty = validColumns.find(col => String(row[col] ?? '').trim().length > 0);
        return firstNonEmpty || validColumns[0] || '';
    }, [effectiveDetailColumn, effectiveLabelColumns, effectiveImageColumn, effectiveLinkColumn]);

    // Gallery collapsed groups (for grouped thumbnails - default expanded, track collapsed)
    const [collapsedGalleryGroups, setCollapsedGalleryGroups] = useState<Set<string>>(new Set());
    // Manual group order for reordering groups (stores ordered group keys)
    const [manualGroupOrder, setManualGroupOrder] = useState<string[]>([]);

    // Editing group note state (groupKey being edited, null if not editing)
    const [editingGroupNote, setEditingGroupNote] = useState<string | null>(null);
    const [editingGroupNoteValue, setEditingGroupNoteValue] = useState('');

    // Tree view collapsed nodes (for nested multi-level grouping - using path like "level1/level2")
    const [collapsedTreeNodes, setCollapsedTreeNodes] = useState<Set<string>>(new Set());

    // Copy view layout modal state
    const [copyViewModal, setCopyViewModal] = useState<{
        open: boolean;
        columnsPerRow: number;
        layoutMode: 'horizontal' | 'vertical' | 'columns';
        includeExtraData: boolean;
        selectedColumns: string[];
        applyClassificationOverrides: boolean;
    }>({
        open: false,
        columnsPerRow: 10,
        layoutMode: 'horizontal',
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
        'detailColumn',
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
    const [localSearchInput, setLocalSearchInput] = useState(config.searchKeyword || ''); // Local search input (commit on Enter)

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

    const { syncAllNotesToSheet, syncAllCategoriesToSheet, isBatchSyncing, isBatchCategorySyncing } = useGallerySheetSync(
        sourceUrl || '', 
        currentSheetName || '', 
        galleryNotes, 
        galleryCategories, 
        effectiveData, 
        effectiveImageColumn, 
        autoSyncNotesToSheet, 
        autoSyncCategoriesToSheet, 
        setCopyFeedback
    );

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
            setCopyFeedback('⚠️ 无法确定行位置，请稍后重试'); setTimeout(() => setCopyFeedback(null), 3000);
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
            setCopyFeedback('⚠️ 无法确定行位置，请稍后重试'); setTimeout(() => setCopyFeedback(null), 3000);
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

        // Clean detailColumn
        if (config.detailColumn && !availableCols.has(config.detailColumn)) {
            updates.detailColumn = '';
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
            detailColumn: availableColumns.includes(preset.config.detailColumn || '')
                ? preset.config.detailColumn
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
                setCopyFeedback('⚠️ 请先在云同步面板登录'); setTimeout(() => setCopyFeedback(null), 3000);
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
                setCopyFeedback('⚠️ 请先在云同步面板登录'); setTimeout(() => setCopyFeedback(null), 3000);
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
        setContextDetailColumn(pickDefaultContextDetailColumn(row));
    }, [config.imageColumn, pickDefaultContextDetailColumn]);

    // Close context menu on click outside
    React.useEffect(() => {
        const handleClick = () => setContextMenu(null);
        if (contextMenu) {
            document.addEventListener('click', handleClick);
            return () => document.removeEventListener('click', handleClick);
        }
    }, [contextMenu]);

    React.useEffect(() => {
        if (!contextMenu) {
            setContextDetailColumn('');
            return;
        }
        if (!contextDetailColumn || contextMenu.row[contextDetailColumn] === undefined) {
            setContextDetailColumn(pickDefaultContextDetailColumn(contextMenu.row));
        }
    }, [contextMenu, contextDetailColumn, pickDefaultContextDetailColumn]);

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

    // Hover handlers with delay (gated by hoverPreview toggle)
    const handleThumbnailMouseEnter = useCallback((imageUrl: string, e: React.MouseEvent) => {
        if (!config.hoverPreview) return; // Skip if hover preview is disabled
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
        hoverTimerRef.current = setTimeout(() => {
            setHoveredImage(imageUrl);
            setHoverPosition({ x: e.clientX, y: e.clientY });
            setThumbnailRect(rect);
        }, 200); // 200ms delay
    }, [config.hoverPreview]);

    const handleThumbnailMouseLeave = useCallback(() => {
        if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
        setHoveredImage(null);
        setHoverPosition(null);
        setThumbnailRect(null);
    }, []);

    const sortRowsByRules = useCallback((rows: DataRow[]) => {
        return sortRowsByRulesImpl(rows, effectiveSortRules);
    }, [effectiveSortRules]);

    const sortDateKeys = useCallback((keys: string[]) => {
        return sortDateKeysImpl(keys, effectiveSortRules, effectiveDateColumn);
    }, [effectiveSortRules, effectiveDateColumn]);

    // Processed rows with filtering and sorting
    // ── Performance: useDeferredValue on input data prevents UI freeze on large datasets ──
    const deferredRows = useDeferredValue(effectiveData.rows);
    const isProcessingRows = deferredRows !== effectiveData.rows;
    const processedRows = useMemo(() => {
        return computeProcessedRows(deferredRows, config.searchKeyword, effectiveImageColumn, effectiveSortRules, effectiveDateColumn, effectiveDateStart, effectiveDateEnd, effectiveCustomFilters, effectiveNumFilters);
    }, [deferredRows, config.searchKeyword, effectiveImageColumn, effectiveSortRules, effectiveDateColumn, effectiveDateStart, effectiveDateEnd, effectiveCustomFilters, effectiveNumFilters]);

    // Large data safety: track when data is massive for UI hints
    const LARGE_DATA_THRESHOLD = 5000;
    const isLargeDataset = processedRows.length > LARGE_DATA_THRESHOLD;

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
        return generateExportDataImpl(
            config, processedRows, effectiveData.columns,
            sortDateKeys, sortRowsByRules,
        );
    }, [config.viewMode, config.matrixRowColumn, config.matrixColColumn, config.dateColumn, config.imageColumn, config.groupColumn, processedRows, effectiveData.columns, sortDateKeys, sortRowsByRules]);

    // Copy data to clipboard based on current view
    const copyDataToClipboard = useCallback(() => {
        const { headers, rows } = generateExportData();
        const text = headers.join('\t') + '\n' + rows.map(r => r.join('\t')).join('\n');
        navigator.clipboard.writeText(text).then(() => {
            setCopyFeedback(`✅ 已复制 ${rows.length} 行数据到剪贴板 (${config.viewMode}视图)`); setTimeout(() => setCopyFeedback(null), 3000);
        });
    }, [generateExportData, config.viewMode]);

    // Update ref for use in UI
    React.useEffect(() => {
        copyDataToClipboardRef.current = copyDataToClipboard;
    }, [copyDataToClipboard]);

    // Download all thumbnails as ZIP
    const downloadAllThumbnails = useCallback(() => {
        doDownload(processedRows, effectiveImageColumn, effectiveGroupColumns[0]);
    }, [doDownload, processedRows, effectiveImageColumn, effectiveGroupColumns]);

    React.useEffect(() => {
        if (downloadFeedback) {
            setCopyFeedback(downloadFeedback);
        }
    }, [downloadFeedback]);

    // Copy view layout to clipboard (grouped thumbnails in grid format)
    const copyViewLayoutToClipboard = useCallback((
        columnsPerRow: number,
        includeExtraData: boolean,
        selectedColumns: string[],
        applyOverrides: boolean,
        layoutMode: 'horizontal' | 'vertical' | 'columns'
    ) => {
        const { text, groupCount, totalImages, error } = generateViewLayoutText(
            layoutMode, columnsPerRow, includeExtraData, selectedColumns, applyOverrides,
            processedRows, effectiveGroupColumns, effectiveGroupLevels, effectiveImageColumn,
            classificationOverrides, customOrderByGroup
        );

        if (error) {
            setCopyFeedback(error);
            setTimeout(() => setCopyFeedback(null), 2000);
            setCopyViewModal({ ...copyViewModal, open: false });
            return;
        }

        navigator.clipboard.writeText(text).then(() => {
            const extraInfo = includeExtraData && selectedColumns.length > 0
                ? ` · ${selectedColumns.length} 列`
                : '';
            const overrideInfo = applyOverrides && Object.keys(classificationOverrides).length > 0
                ? ` · ${Object.keys(classificationOverrides).length} 项覆盖`
                : '';
            const layoutInfo = layoutMode === 'vertical'
                ? '竖向'
                : layoutMode === 'columns'
                ? '转置（按列分组）'
                : `横向 · 每行 ${columnsPerRow} 个`;
            setCopyFeedback(`✅ 已复制！${layoutInfo} · ${groupCount} 个分组 · ${totalImages} 张图片${extraInfo}${overrideInfo}`);
            setTimeout(() => setCopyFeedback(null), 3000);
            setCopyViewModal({ ...copyViewModal, open: false });
        }).catch(err => {
            console.error('Failed to copy:', err);
            setCopyFeedback('❌ 复制失败，请重试');
            setTimeout(() => setCopyFeedback(null), 2000);
        });
    }, [processedRows, effectiveGroupColumns, effectiveGroupLevels, effectiveImageColumn, classificationOverrides, customOrderByGroup, copyViewModal]);

    // Copy a single group's data to clipboard (TSV format for pasting to spreadsheets)
    const copyGroupDataToClipboard = useCallback((groupKey: string, groupRows: DataRow[]) => {
        if (groupRows.length === 0) {
            setCopyFeedback('❌ 该分组没有数据');
            setTimeout(() => setCopyFeedback(null), 2000);
            return;
        }

        // Generate headers - use all columns from the data
        const headers = data.columns;
        const rows = groupRows.map(row =>
            headers.map(col => String(row[col] ?? ''))
        );

        const text = headers.join('\t') + '\n' + rows.map(r => r.join('\t')).join('\n');
        navigator.clipboard.writeText(text).then(() => {
            setCopyFeedback(`✅ 已复制「${groupKey}」${groupRows.length} 行数据`);
            setTimeout(() => setCopyFeedback(null), 2500);
        }).catch(err => {
            console.error('Failed to copy group data:', err);
            setCopyFeedback('❌ 复制失败');
            setTimeout(() => setCopyFeedback(null), 2000);
        });
    }, [data.columns]);

    // Copy a single group's view layout to clipboard (image formulas in grid)
    const copyGroupViewToClipboard = useCallback((groupKey: string, groupRows: DataRow[], columnsPerRow: number = 5) => {
        const imageRows = groupRows.filter(row => extractImageUrl(row[effectiveImageColumn]));
        if (imageRows.length === 0) {
            setCopyFeedback('❌ 该分组没有图片');
            setTimeout(() => setCopyFeedback(null), 2000);
            return;
        }

        // Build output: group header + image formulas in rows
        const outputRows: string[][] = [];

        // Add group header with note if exists
        const note = config.groupNotes?.[groupKey] || '';
        const headerText = note ? `${groupKey} — ${note}` : groupKey;
        outputRows.push([headerText]);

        // Arrange images in rows of columnsPerRow
        for (let i = 0; i < imageRows.length; i += columnsPerRow) {
            const chunk = imageRows.slice(i, i + columnsPerRow);
            const rowFormulas = chunk.map(row => {
                const url = extractImageUrl(row[effectiveImageColumn]);
                return url ? `=IMAGE("${url}")` : '';
            });
            // Pad with empty cells
            while (rowFormulas.length < columnsPerRow) {
                rowFormulas.push('');
            }
            outputRows.push(rowFormulas);
        }

        const text = outputRows.map(row => row.join('\t')).join('\n');
        navigator.clipboard.writeText(text).then(() => {
            setCopyFeedback(`✅ 已复制「${groupKey}」${imageRows.length} 张图片 (每行 ${columnsPerRow} 个)`);
            setTimeout(() => setCopyFeedback(null), 2500);
        }).catch(err => {
            console.error('Failed to copy group view:', err);
            setCopyFeedback('❌ 复制失败');
            setTimeout(() => setCopyFeedback(null), 2000);
        });
    }, [effectiveImageColumn, extractImageUrl, config.groupNotes]);

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

            setCopyFeedback(`✅ 同步成功！已创建分页: ${sheetName}`); setTimeout(() => setCopyFeedback(null), 4000);
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
        return computeTimelineData(
            processedRows, effectiveDateColumn, effectiveImageColumn, effectiveAccountColumn,
            effectiveDateBinning, effectiveDateBins, sortDateKeys, sortRowsByRules
        );
    }, [processedRows, effectiveDateColumn, effectiveImageColumn, effectiveAccountColumn, effectiveDateBinning, effectiveDateBins, sortDateKeys, sortRowsByRules]);

    // Grouped Timeline data - when groupColumn is set, use it as primary grouping with date as secondary
    // 修复：使用 effectiveGroupLevels 时也需要支持分组显示（来自 TreeGroupConfigModal 的多级分组）
    const primaryGroupColumn = effectiveGroupColumn || (effectiveGroupLevels.length > 0 ? effectiveGroupLevels[0].column : '');
    const groupedTimelineData = useMemo(() => {
        return computeGroupedTimelineData(
            processedRows, effectiveGroupColumn, primaryGroupColumn, effectiveGroupLevels,
            effectiveDateColumn, effectiveImageColumn, effectiveSortRules,
            effectiveDateBinning, effectiveDateBins, sortDateKeys, sortRowsByRules,
            effectiveTextGrouping, effectiveTextGroupBins
        );
    }, [processedRows, effectiveGroupColumn, primaryGroupColumn, effectiveGroupLevels, effectiveDateColumn, effectiveImageColumn, effectiveSortRules, effectiveDateBinning, effectiveDateBins, sortDateKeys, sortRowsByRules, effectiveTextGrouping, effectiveTextGroupBins]);

    // Matrix data
    const matrixData = useMemo(() => {
        return computeMatrixData(
            processedRows, config, effectiveGroupColumn,
            effectiveTextGrouping, effectiveTextGroupBins, sortRowsByRules
        );
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
        return computeCalendarGrid(config.calendarMode, config.selectedDate, calendarMonth);
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

    // Render thumbnail with actions — delegates to memoized ImageCard component
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
        const rowId = String(row._rowId || '');

        return (
            <ImageCard
                key={rowId || idx}
                row={row}
                imageUrl={url}
                rowId={rowId}
                size={size}
                showMeta={showMeta}
                compact={compact}
                isSelected={gallerySelectMode && selectedThumbnails.has(rowId)}
                favorited={isFavorited(url)}
                selectMode={gallerySelectMode}
                highlight={highlight}
                labels={labels}
                account={account}
                link={link}
                showLabelOverlay={config.showLabelOverlay}
                thumbnailFit={config.thumbnailFit}
                onSelect={scheduleThumbnailSelect}
                onToggleSelect={toggleThumbnailSelection}
                onDoubleClick={handleThumbnailDoubleClick}
                onToggleFavorite={toggleFavorite}
                onViewDetail={setSelectedRow}
                onOpenLink={openExternalUrl}
                onContextMenu={handleContextMenu}
                onDragStart={(e, r, imgUrl) => handleThumbnailDragStart(e, imgUrl, r, rowId)}
            />
        );
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 sheetmind-light-form color-scheme-light">

            <div className="relative flex-1 flex overflow-hidden flex-overflow-container">
                {/* Thin side icon bar - completely absolute and overlapping */}
                <div
                    className="absolute top-0 left-0 bottom-0 w-8 lg:w-10 bg-gradient-to-r from-black/5 to-transparent flex flex-col items-center py-4 z-40 transition-opacity opacity-50 hover:opacity-100"
                >
                    <button
                        onClick={() => setShowConfig(!showConfig)}
                        className={`p-1.5 rounded-lg transition-all backdrop-blur-md shadow-sm border ${showConfig ? 'bg-indigo-500/90 text-white border-indigo-400' : 'bg-white/50 text-slate-700 border-white/40 hover:bg-white'}`}
                        title="画面配置"
                    >
                        <Settings2 size={16} />
                    </button>
                </div>

                {/* Config Panel Floating Overlay */}
                {showConfig && (
                    <GalleryConfigPanel BarChart2={BarChart2} CATEGORY_COLUMN={CATEGORY_COLUMN} ChevronDown={ChevronDown} Download={Download} ExternalLink={ExternalLink} FileText={FileText} FolderOpen={FolderOpen} Link2={Link2} NOTE_COLUMN={NOTE_COLUMN} RefreshCw={RefreshCw} RotateCcw={RotateCcw} Star={Star} Tag={Tag} Upload={Upload} Video={Video} activePresetId={activePresetId} advancedSectionRef={advancedSectionRef} autoSyncCategoriesToSheet={autoSyncCategoriesToSheet} autoSyncNotesToSheet={autoSyncNotesToSheet} categoriesSyncCount={categoriesSyncCount} cloudError={cloudError} cloudSyncEnabled={cloudSyncEnabled} cloudSyncing={cloudSyncing} collapsedSections={collapsedSections} config={config} copyDataToClipboard={copyDataToClipboard} copyViewModal={copyViewModal} currentViewLabel={currentViewLabel} customPresets={customPresets} data={data} deleteCustomPreset={deleteCustomPreset} deletePreset={deletePreset} downloadAllThumbnails={downloadAllThumbnails} downloadProgress={downloadProgress} effectiveData={effectiveData} effectivePureImageMode={effectivePureImageMode} effectiveTranspose={effectiveTranspose} getDefaultConfig={getDefaultConfig} getGoogleAccessToken={getGoogleAccessToken} handleResetConfig={handleResetConfig} headerCollapsed={headerCollapsed} isBatchCategorySyncing={isBatchCategorySyncing} isBatchSyncing={isBatchSyncing} loadPreset={loadPreset} notesSectionRef={notesSectionRef} notesSyncCount={notesSyncCount} parseGoogleSheetsUrl={parseGoogleSheetsUrl} presets={presets} processedRows={processedRows} renamePreset={renamePreset} savePreset={savePreset} setActivePresetId={setActivePresetId} setAutoSyncCategoriesToSheet={setAutoSyncCategoriesToSheet} setAutoSyncNotesToSheet={setAutoSyncNotesToSheet} setCopyViewModal={setCopyViewModal} setEditingPreset={setEditingPreset} setGalleryPage={setGalleryPage} setGroupLoadedCount={setGroupLoadedCount} setSheetsError={setSheetsError} setSheetsSpreadsheetId={setSheetsSpreadsheetId} setSheetsUrl={setSheetsUrl} setShowConfig={setShowConfig} setShowPresetEditor={setShowPresetEditor} sheetsError={sheetsError} sheetsSpreadsheetId={sheetsSpreadsheetId} sheetsSyncing={sheetsSyncing} sheetsUrl={sheetsUrl} stats={stats} syncAllCategoriesToSheet={syncAllCategoriesToSheet} syncAllNotesToSheet={syncAllNotesToSheet} syncToGoogleSheet={syncToGoogleSheet} toggleSection={toggleSection} updateConfig={updateConfig} viewSectionRef={viewSectionRef} />
                )}

                {/* Main Content */}
                <div className="flex-1 overflow-hidden flex flex-col relative flex-overflow-container" >
                    {/* Toolbar */}
                    <GalleryToolbar MessageSquare={MessageSquare} calendarMonth={calendarMonth} classificationMode={classificationMode} classificationOverrides={classificationOverrides} clearThumbnailSelection={clearThumbnailSelection} collapseAll={collapseAll} config={config} copyFeedback={copyFeedback} copySelectedThumbnailsData={copySelectedThumbnailsData} customGroups={customGroups} effectiveDateBinning={effectiveDateBinning} effectiveDateBins={effectiveDateBins} effectiveDateColumn={effectiveDateColumn} effectiveGroupLevels={effectiveGroupLevels} effectiveImageColumn={effectiveImageColumn} expandAll={expandAll} extractImageUrl={extractImageUrl} favorites={favorites} favoritesSyncing={favoritesSyncing} galleryCategories={galleryCategories} gallerySelectMode={gallerySelectMode} getRowGroupKey={getRowGroupKey} localSearchInput={localSearchInput} openBatchCategoryModal={openBatchCategoryModal} openBatchNoteModal={openBatchNoteModal} parseDate={parseDate} primaryGroupColumn={primaryGroupColumn} processedRows={processedRows} selectedForClassification={selectedForClassification} selectedThumbnails={selectedThumbnails} setCalendarMonth={setCalendarMonth} setClassificationMode={setClassificationMode} setCollapsedGalleryGroups={setCollapsedGalleryGroups} setCopyFeedback={setCopyFeedback} setDraggedItems={setDraggedItems} setGallerySelectMode={setGallerySelectMode} setLocalSearchInput={setLocalSearchInput} setSelectedForClassification={setSelectedForClassification} setSelectedThumbnails={setSelectedThumbnails} setShowBatchFolderMenu={setShowBatchFolderMenu} setShowCategoryView={setShowCategoryView} setShowFavorites={setShowFavorites} showCategoryView={showCategoryView} showFavorites={showFavorites} stats={stats} updateConfig={updateConfig} />

                    {/* Content */}
                    <div className="flex-1 overflow-auto p-4 flex-overflow-container" ref={contentScrollRef}>
                        {/* Processing indicator */}
                        {isProcessingRows && (
                            <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-blue-50 border border-blue-200 rounded-lg text-xs text-blue-700 animate-pulse">
                                <Loader2 size={14} className="animate-spin" />
                                数据处理中...
                            </div>
                        )}
                        {/* Large dataset warning */}
                        {isLargeDataset && !isProcessingRows && config.galleryPageSize === 0 && (
                            <div className="mb-3 flex items-center gap-2 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                                <AlertCircle size={14} />
                                <span>⚠️ 数据量较大 ({processedRows.length.toLocaleString()} 行)，建议开启分页以避免卡顿</span>
                                <button
                                    onClick={() => updateConfig({ galleryPageSize: 100 })}
                                    className="ml-auto px-2 py-0.5 bg-amber-100 hover:bg-amber-200 rounded text-amber-800 font-medium transition-colors"
                                >
                                    开启分页 (100/页)
                                </button>
                            </div>
                        )}
                        {/* Favorites View */}
                        {showFavorites && (
                            <GalleryFavoritesMode Filter={Filter} MessageSquare={MessageSquare} activeFolderId={activeFolderId} clearAllFavorites={clearAllFavorites} config={config} copyAllFavoritesData={copyAllFavoritesData} copyRowDataToClipboard={copyRowDataToClipboard} copySelectedFavoritesData={copySelectedFavoritesData} deselectAllFavorites={deselectAllFavorites} dragOverTarget={dragOverTarget} favoriteFolders={favoriteFolders} favoriteSearchKeyword={favoriteSearchKeyword} favorites={favorites} getCategoryForImage={getCategoryForImage} getFavoritesInFolder={getFavoritesInFolder} getFilteredFavorites={getFilteredFavorites} getNoteForImage={getNoteForImage} handleContextMenu={handleContextMenu} handleDragEnd={handleDragEnd} handleDropToFolder={handleDropToFolder} handleFavoriteDragStart={handleFavoriteDragStart} handleThumbnailMouseEnter={handleThumbnailMouseEnter} handleThumbnailMouseLeave={handleThumbnailMouseLeave} invertFavoriteSelection={invertFavoriteSelection} isDraggingImage={isDraggingImage} openBatchCategoryModal={openBatchCategoryModal} openBatchNoteModal={openBatchNoteModal} openCategoryModal={openCategoryModal} openExternalUrl={openExternalUrl} openNoteModal={openNoteModal} selectAllFavorites={selectAllFavorites} selectedFavorites={selectedFavorites} setActiveFolderId={setActiveFolderId} setCopyFeedback={setCopyFeedback} setDragOverTarget={setDragOverTarget} setEditFolderModal={setEditFolderModal} setFavoriteSearchKeyword={setFavoriteSearchKeyword} setFloatingTip={setFloatingTip} setFolderContextMenu={setFolderContextMenu} setNewFolderModal={setNewFolderModal} setSelectedThumbnails={setSelectedThumbnails} setShowFavorites={setShowFavorites} toggleFavorite={toggleFavorite} toggleFavoriteSelection={toggleFavoriteSelection} />
                        )}

                        {/* Category View - Group images by their media tags */}
                        {showCategoryView && (
                            <GalleryCategoryView clearCategoryItems={clearCategoryItems} config={config} dragOverTarget={dragOverTarget} effectiveData={effectiveData} effectiveImageColumn={effectiveImageColumn} effectiveLinkColumn={effectiveLinkColumn} extractImageUrl={extractImageUrl} galleryCategories={galleryCategories} gallerySelectMode={gallerySelectMode} getNoteForImage={getNoteForImage} handleContextMenu={handleContextMenu} handleDropToCategory={handleDropToCategory} handleStarClick={handleStarClick} handleThumbnailDoubleClick={handleThumbnailDoubleClick} handleThumbnailMouseEnter={handleThumbnailMouseEnter} handleThumbnailMouseLeave={handleThumbnailMouseLeave} isFavorited={isFavorited} openBatchCategoryModal={openBatchCategoryModal} openBatchNoteModal={openBatchNoteModal} openCategoryModal={openCategoryModal} openNoteModal={openNoteModal} scheduleThumbnailSelect={scheduleThumbnailSelect} selectedThumbnails={selectedThumbnails} setDragOverTarget={setDragOverTarget} setGallerySelectMode={setGallerySelectMode} setSelectedThumbnails={setSelectedThumbnails} setShowBatchFolderMenu={setShowBatchFolderMenu} setShowCategoryView={setShowCategoryView} />
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

                                                // Apply manual group order if set
                                                if (manualGroupOrder.length > 0) {
                                                    filteredGroups = filteredGroups.sort((a, b) => {
                                                        const idxA = manualGroupOrder.indexOf(a[0]);
                                                        const idxB = manualGroupOrder.indexOf(b[0]);
                                                        if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                                                        if (idxA !== -1) return -1;
                                                        if (idxB !== -1) return 1;
                                                        return 0; // preserve natural sort for unlisted
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
                                                            <div className="sticky top-0 z-20 bg-purple-50/95 backdrop-blur-sm border-b border-purple-200 px-2 py-1.5 mb-2 rounded-b-xl shadow-sm max-h-[30vh] overflow-y-auto custom-scrollbar flex flex-col gap-1.5">
                                                                {/* Header Row */}
                                                                <div className="flex items-center gap-1">
                                                                    <Layers size={14} className="text-purple-600" />
                                                                    <span className="text-xs font-medium text-purple-700 whitespace-nowrap hidden sm:inline">工作区</span>
                                                                    <span className="text-[10px] text-purple-500 whitespace-nowrap ml-1">
                                                                        {selectedForClassification.size > 0
                                                                            ? `已选 ${selectedForClassification.size}`
                                                                            : '拖拽到分类'}
                                                                    </span>
                                                                    <div className="ml-auto flex items-center gap-2">
                                                                        {/* Target Type Toggles */}
                                                                        <div className="flex items-center gap-1.5 border-r border-purple-200 pr-2">
                                                                            <span className="text-[10px] text-purple-600">显示:</span>
                                                                            <label className="flex items-center gap-0.5 cursor-pointer">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={dragTargetTypes.classification}
                                                                                    onChange={(e) => setDragTargetTypes(prev => ({ ...prev, classification: e.target.checked }))}
                                                                                    className="w-3 h-3 text-purple-600 rounded focus:ring-purple-500"
                                                                                />
                                                                                <span className="text-[10px] text-slate-600">分组</span>
                                                                            </label>
                                                                            <label className="flex items-center gap-0.5 cursor-pointer">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={dragTargetTypes.favorites}
                                                                                    onChange={(e) => setDragTargetTypes(prev => ({ ...prev, favorites: e.target.checked }))}
                                                                                    className="w-3 h-3 text-amber-500 rounded focus:ring-amber-500"
                                                                                />
                                                                                <span className="text-[10px] text-slate-600">收藏</span>
                                                                            </label>
                                                                            <label className="flex items-center gap-0.5 cursor-pointer">
                                                                                <input
                                                                                    type="checkbox"
                                                                                    checked={dragTargetTypes.tags}
                                                                                    onChange={(e) => setDragTargetTypes(prev => ({ ...prev, tags: e.target.checked }))}
                                                                                    className="w-3 h-3 text-blue-500 rounded focus:ring-blue-500"
                                                                                />
                                                                                <span className="text-[10px] text-slate-600">标签</span>
                                                                            </label>
                                                                        </div>
                                                                        {/* Sync Toggle */}
                                                                        <label className="flex items-center gap-1 cursor-pointer">
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
                                                                                            setCopyFeedback('⚠️ 要同步到表格，请先登录 Google 账号'); setTimeout(() => setCopyFeedback(null), 3000);
                                                                                            return;
                                                                                        }
                                                                                    }
                                                                                    setSyncToSheet(checked);
                                                                                }}
                                                                                className="w-3.5 h-3.5 text-purple-600 rounded focus:ring-purple-500"
                                                                            />
                                                                            <span className={`text-[10px] ${syncToSheet ? 'text-purple-700 font-medium' : 'text-slate-500'}`}>
                                                                                同步到表格
                                                                            </span>
                                                                        </label>
                                                                        {syncToSheet && sourceUrl && (
                                                                            <span className="text-[10px] text-green-600">✓</span>
                                                                        )}
                                                                    </div>
                                                                </div>

                                                                {/* Classification Groups Row */}
                                                                {dragTargetTypes.classification && (
                                                                    <div className="flex flex-wrap gap-1.5 items-center">
                                                                        <span className="text-[10px] text-purple-600 font-medium self-center mr-0.5"><FolderOpen size={10} className="inline mr-0.5" /> 分组:</span>
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
                                                                                        className={`px-2 py-0.5 text-[11px] font-medium rounded border border-dashed bg-opacity-50 cursor-pointer transition-all tooltip-bottom ${dragOverGroup === option
                                                                                            ? 'bg-purple-200 border-purple-500 text-purple-800 scale-105'
                                                                                            : 'bg-white border-purple-300 text-purple-700 hover:bg-purple-100'
                                                                                            }`}
                                                                                        data-tip="拖拽图片到此分类"
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
                                                                                    className={`px-2 py-0.5 text-[11px] font-medium rounded border border-dashed bg-opacity-50 border-dashed cursor-pointer transition-all tooltip-bottom ${dragOverGroup === targetGroup
                                                                                        ? 'bg-purple-200 border-purple-500 text-purple-800 scale-105'
                                                                                        : 'bg-white border-purple-300 text-purple-700 hover:bg-purple-100'
                                                                                        }`}
                                                                                    data-tip="点击跳转到该分组，拖拽图片到此改变分类"
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
                                                                                        className={`p-1 rounded tooltip-bottom ${groupIdx === 0 ? 'text-slate-300 cursor-not-allowed' : 'text-green-600 hover:bg-green-100'}`}
                                                                                        data-tip="上移"
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
                                                                                        className={`p-1 rounded tooltip-bottom ${groupIdx === customGroups.length - 1 ? 'text-slate-300 cursor-not-allowed' : 'text-green-600 hover:bg-green-100'}`}
                                                                                        data-tip="下移"
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
                                                                                        className="p-1 text-red-500 hover:text-red-700 hover:bg-red-50 rounded tooltip-bottom"
                                                                                        data-tip="删除分组"
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
                                                                                    className={`px-2 py-0.5 text-[11px] font-medium rounded border border-dashed bg-opacity-50 border-dashed cursor-grab transition-all tooltip-bottom ${draggingGroupIdx === groupIdx
                                                                                        ? 'opacity-50 bg-green-100 border-green-400'
                                                                                        : dragOverGroup === customGroup
                                                                                            ? draggingGroupIdx !== null
                                                                                                ? 'bg-yellow-200 border-yellow-500 text-yellow-800 scale-105' // 分组重排序
                                                                                                : 'bg-green-200 border-green-500 text-green-800 scale-105'   // 图片拖入
                                                                                            : 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                                                                                        }`}
                                                                                    data-tip="双击编辑 | 拖拽调整顺序"
                                                                                >
                                                                                    ✨ {customGroup}
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            if (confirm(`删除分组 "${customGroup}"？`)) {
                                                                                                setCustomGroups(prev => prev.filter((_, i) => i !== groupIdx));
                                                                                            }
                                                                                        }}
                                                                                        className="ml-1 opacity-0 group-hover:opacity-100 hover:!opacity-100 text-red-400 hover:text-red-600 transition-opacity"
                                                                                        style={{ opacity: 0 }}
                                                                                        onMouseEnter={(e) => { (e.target as HTMLElement).style.opacity = '1'; }}
                                                                                        onMouseLeave={(e) => { (e.target as HTMLElement).style.opacity = '0'; }}
                                                                                        data-tip="删除分组"
                                                                                    >
                                                                                        ✕
                                                                                    </button>
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
                                                                                className="px-2 py-0.5 text-[11px] font-medium rounded border border-dashed bg-opacity-50 border-dashed border-purple-300 text-purple-600 hover:bg-purple-50 hover:border-purple-400 transition-colors flex items-center gap-1 tooltip-bottom"
                                                                                data-tip="添加新分组"
                                                                            >
                                                                                <Plus size={12} />
                                                                                新分组
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {/* Favorites Drop Zone Row */}
                                                                {dragTargetTypes.favorites && (
                                                                    <div className="flex flex-wrap gap-1.5 items-center">
                                                                        <span className="text-[10px] text-amber-600 font-medium self-center mr-0.5"><Star size={10} className="inline mr-0.5" /> 收藏:</span>
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
                                                                                    className={`px-2 py-0.5 text-[11px] font-medium rounded border border-dashed bg-opacity-50 border-dashed cursor-pointer transition-all tooltip-bottom ${dragOverFavoriteFolder === folder.id
                                                                                        ? 'bg-amber-200 border-amber-500 text-amber-800 scale-105'
                                                                                        : 'bg-amber-50 border-amber-300 text-amber-700 hover:bg-amber-100'
                                                                                        }`}
                                                                                    data-tip="点击切换收藏夹视图，拖拽添加收藏"
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
                                                                            className="px-2 py-0.5 text-[11px] font-medium rounded border border-dashed bg-opacity-50 border-dashed border-amber-300 text-amber-600 hover:bg-amber-50 hover:border-amber-400 transition-colors flex items-center gap-1 tooltip-bottom"
                                                                            data-tip="添加新收藏夹"
                                                                        >
                                                                            <Plus size={12} />
                                                                            新收藏
                                                                        </button>
                                                                    </div>
                                                                )}

                                                                {/* Tags Drop Zone Row */}
                                                                {dragTargetTypes.tags && (
                                                                    <div className="flex flex-wrap gap-1.5 items-center">
                                                                        <span className="text-[10px] text-blue-600 font-medium self-center mr-0.5"><Tag size={10} className="inline mr-0.5" /> 标签:</span>
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
                                                                                    className={`px-2 py-0.5 text-[11px] font-medium rounded border border-dashed bg-opacity-50 border-dashed cursor-pointer transition-all tooltip-bottom ${dragOverGroup === `tag:${category}`
                                                                                        ? 'bg-blue-200 border-blue-500 text-blue-800 scale-105'
                                                                                        : 'bg-blue-50 border-blue-300 text-blue-700 hover:bg-blue-100'
                                                                                        }`}
                                                                                    data-tip="点击切换媒体标签视图，拖拽添加标签"
                                                                                >
                                                                                    <Tag size={10} className="inline mr-0.5" /> {category}
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
                                                                            className="px-2 py-0.5 text-[11px] font-medium rounded border border-dashed bg-opacity-50 border-dashed border-blue-300 text-blue-600 hover:bg-blue-50 hover:border-blue-400 transition-colors flex items-center gap-1 tooltip-bottom"
                                                                            data-tip="添加新标签"
                                                                        >
                                                                            <Plus size={12} />
                                                                            新标签
                                                                        </button>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                        {filteredGroups.map(([groupKey, rows], groupIdx) => {
                                                            // Default is expanded, collapsed only if in collapsedGalleryGroups set
                                                            const isExpanded = !collapsedGalleryGroups.has(groupKey);
                                                            const imageCount = rows.filter(r => extractImageUrl(r[effectiveImageColumn])).length;

                                                            return (
                                                                <div key={groupKey} data-group-key={groupKey} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                                                    <div className="w-full px-3 py-1 flex items-center justify-between bg-gradient-to-r from-purple-50 to-white border-b border-purple-50">
                                                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                                                            <button
                                                                                onClick={() => {
                                                                                    const next = new Set(collapsedGalleryGroups);
                                                                                    if (isExpanded) next.add(groupKey);  // Collapse
                                                                                    else next.delete(groupKey);          // Expand
                                                                                    setCollapsedGalleryGroups(next);
                                                                                }}
                                                                                className="flex items-center gap-1 hover:bg-purple-100 rounded px-1 transition-colors tooltip-bottom"
                                                                                data-tip={isExpanded ? '折叠' : '展开'}
                                                                            >
                                                                                {isExpanded ? <ChevronDown size={14} /> : <ChevronRight size={14} />}
                                                                                <span className="font-semibold text-sm text-slate-800">{groupKey}</span>
                                                                            </button>
                                                                            <span className="text-[11px] text-slate-500 bg-slate-100 px-1.5 rounded-full flex-shrink-0">{imageCount} 张</span>
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
                                                                                    className="flex items-center gap-1 text-sm hover:bg-purple-100 px-2 py-0.5 rounded transition-colors max-w-[400px] tooltip-bottom"
                                                                                    data-tip={config.groupNotes?.[groupKey] ? '点击编辑备注' : '点击添加备注'}
                                                                                >
                                                                                    {config.groupNotes?.[groupKey] ? (
                                                                                        <span className="text-slate-700 font-medium">— {config.groupNotes[groupKey]}</span>
                                                                                    ) : (
                                                                                        <span className="text-slate-400 text-xs">+ 添加备注</span>
                                                                                    )}
                                                                                </button>
                                                                            )}
                                                                        </div>
                                                                        <div className="flex items-center gap-1 flex-shrink-0">
                                                                            {/* Move group up/down buttons */}
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    if (groupIdx === 0) return;
                                                                                    const allKeys = filteredGroups.map(g => g[0]);
                                                                                    const newOrder = [...allKeys];
                                                                                    [newOrder[groupIdx - 1], newOrder[groupIdx]] = [newOrder[groupIdx], newOrder[groupIdx - 1]];
                                                                                    setManualGroupOrder(newOrder);
                                                                                }}
                                                                                disabled={groupIdx === 0}
                                                                                className={`p-1 rounded transition-colors tooltip-bottom ${groupIdx === 0 ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                                                                                data-tip="上移"
                                                                            >
                                                                                <ArrowUp size={13} />
                                                                            </button>
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    if (groupIdx === filteredGroups.length - 1) return;
                                                                                    const allKeys = filteredGroups.map(g => g[0]);
                                                                                    const newOrder = [...allKeys];
                                                                                    [newOrder[groupIdx], newOrder[groupIdx + 1]] = [newOrder[groupIdx + 1], newOrder[groupIdx]];
                                                                                    setManualGroupOrder(newOrder);
                                                                                }}
                                                                                disabled={groupIdx === filteredGroups.length - 1}
                                                                                className={`p-1 rounded transition-colors tooltip-bottom ${groupIdx === filteredGroups.length - 1 ? 'text-slate-200 cursor-not-allowed' : 'text-slate-400 hover:text-blue-600 hover:bg-blue-50'}`}
                                                                                data-tip="下移"
                                                                            >
                                                                                <ArrowDown size={13} />
                                                                            </button>
                                                                            <div className="w-px h-4 bg-slate-200 mx-0.5"></div>
                                                                            {/* Copy group data button */}
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    copyGroupDataToClipboard(groupKey, rows);
                                                                                }}
                                                                                className="p-1.5 text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 rounded transition-colors tooltip-bottom"
                                                                                data-tip="复制分组数据"
                                                                            >
                                                                                <Download size={14} />
                                                                            </button>
                                                                            {/* Copy group view button */}
                                                                            <button
                                                                                onClick={(e) => {
                                                                                    e.stopPropagation();
                                                                                    copyGroupViewToClipboard(groupKey, rows);
                                                                                }}
                                                                                className="p-1.5 text-slate-400 hover:text-purple-600 hover:bg-purple-50 rounded transition-colors tooltip-bottom"
                                                                                data-tip="复制缩略图视图"
                                                                            >
                                                                                <Image size={14} />
                                                                            </button>
                                                                            {/* Collapse toggle button */}
                                                                            <button
                                                                                onClick={() => {
                                                                                    const next = new Set(collapsedGalleryGroups);
                                                                                    if (isExpanded) next.add(groupKey);
                                                                                    else next.delete(groupKey);
                                                                                    setCollapsedGalleryGroups(next);
                                                                                }}
                                                                                className="text-[11px] text-slate-400 hover:text-slate-600 ml-1 tooltip-bottom"
                                                                                data-tip={isExpanded ? '隐藏图片' : '显示图片'}
                                                                            >
                                                                                {isExpanded ? '折叠' : '展开'}
                                                                            </button>
                                                                        </div>
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
                                                                            <div className="p-2 bg-slate-50/50">
                                                                                {/* Progressive loading info - show when in progressive loading mode */}
                                                                                {pageSize === -1 && allGroupRows.length > INITIAL_LOAD_COUNT && (
                                                                                    <div className="flex items-center justify-between mb-3 pb-2 border-b border-slate-200">
                                                                                        <span className="text-xs text-slate-600 font-medium">
                                                                                            已加载 {Math.min(groupLoadedCount[groupKey] || INITIAL_LOAD_COUNT, allGroupRows.length)} / {allGroupRows.length} 张 (滚动加载更多)
                                                                                        </span>
                                                                                    </div>
                                                                                )}
                                                                                <div className="flex flex-wrap gap-1.5 items-center">
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
                                                                                                        data-tooltip={classificationMode ? '点击选择，拖拽到目标分组' : (linkUrl ? '双击打开链接 · 右键菜单 · 拖拽' : '右键菜单 · 拖拽到收藏夹')}
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
                                                            <div className="sticky top-0 z-20 bg-purple-50/95 backdrop-blur-sm border-b border-purple-200 px-2 py-1.5 mb-2 rounded-b-xl shadow-sm max-h-[30vh] overflow-y-auto custom-scrollbar flex flex-col gap-1.5">
                                                                {/* Header Row */}
                                                                <div className="flex items-center gap-1.5">
                                                                    <Layers size={14} className="text-purple-600" />
                                                                    <span className="text-xs font-semibold text-purple-700">分类工作区</span>
                                                                    <span className="text-[10px] text-purple-500">
                                                                        {selectedForClassification.size > 0
                                                                            ? `已选择 ${selectedForClassification.size} 张`
                                                                            : '点击缩略图选择，然后拖拽到目标'}
                                                                    </span>
                                                                </div>

                                                                {/* Classification Groups Row */}
                                                                {dragTargetTypes.classification && (
                                                                    <div className="flex flex-wrap gap-1.5 items-center">
                                                                        <span className="text-[10px] text-purple-600 font-medium self-center mr-0.5 flex items-center gap-1"><FolderOpen size={12} /> 分组:</span>
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
                                                                                    className={`px-2 py-0.5 text-[11px] font-medium rounded border border-dashed bg-opacity-50 border-dashed cursor-pointer transition-all tooltip-bottom ${dragOverGroup === option
                                                                                        ? 'bg-purple-200 border-purple-500 text-purple-800 scale-105'
                                                                                        : 'bg-white border-purple-300 text-purple-700 hover:bg-purple-100'
                                                                                        }`}
                                                                                    data-tip="拖拽图片到此分类"
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
                                                                                className={`px-2 py-0.5 text-[11px] font-medium rounded border border-dashed bg-opacity-50 border-dashed cursor-pointer transition-all tooltip-bottom ${dragOverGroup === customGroup
                                                                                    ? 'bg-green-200 border-green-500 text-green-800 scale-105'
                                                                                    : 'bg-green-50 border-green-300 text-green-700 hover:bg-green-100'
                                                                                    }`}
                                                                                data-tip="拖拽图片到此自定义分组"
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
                                                                                className="px-2 py-0.5 text-[11px] font-medium rounded border border-dashed bg-opacity-50 border-dashed border-slate-300 text-slate-500 hover:border-purple-400 hover:text-purple-600 hover:bg-purple-50 transition-all tooltip-bottom"
                                                                                data-tip="添加新分组"
                                                                            >
                                                                                + 新分组
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                )}

                                                                {/* Favorites Drop Zone Row (无分组模式) */}
                                                                {dragTargetTypes.favorites && (
                                                                    <div className="flex flex-wrap gap-1.5 items-center">
                                                                        <span className="text-[10px] text-amber-600 font-medium self-center mr-0.5 flex items-center gap-1"><Star size={12} /> 收藏:</span>
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
                                                                                    className={`px-2 py-0.5 text-[11px] font-medium rounded border border-dashed bg-opacity-50 border-dashed cursor-pointer transition-all ${dragOverFavoriteFolder === folder.id
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
                                                                        data-tooltip={linkUrl ? '双击打开链接 · 右键菜单 · 拖拽到收藏夹' : '右键菜单 · 拖拽到收藏夹'}
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
                                <GalleryTimelineView config={config} effectiveAccountColumn={effectiveAccountColumn} effectiveDateBinning={effectiveDateBinning} effectiveDateBins={effectiveDateBins} effectiveGroupBinning={effectiveGroupBinning} effectiveGroupBins={effectiveGroupBins} effectiveGroupColumn={effectiveGroupColumn} effectiveImageColumn={effectiveImageColumn} expandedGroups={expandedGroups} getRowGroupKey={getRowGroupKey} groupedTimelineData={groupedTimelineData} renderThumbnail={renderThumbnail} setExpandedGroups={setExpandedGroups} timelineData={timelineData} />
                            ) : config.viewMode === 'calendar' && config.calendarMode === 'scroll' ? (
                                /* Scroll View - Responsive full-width day cards */
                                <GalleryCalendarView buildGroupedRows={buildGroupedRows} config={config} effectiveGroupColumn={effectiveGroupColumn} effectiveImageColumn={effectiveImageColumn} parseDate={parseDate} renderThumbnail={renderThumbnail} timelineData={timelineData} updateConfig={updateConfig} />
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

            {/* Hover Preview Overlay for Gallery Mode */}
            <HoverPreview
                imageUrl={hoveredImage}
                thumbnailRect={thumbnailRect}
            />

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
            <DragDropSidebar
                isVisible={isDraggingImage}
                folders={favoriteFolders}
                categoryOptions={config.categoryOptions}
                dragOverTarget={dragOverTarget}
                onDragOverTarget={setDragOverTarget}
                onDropToFolder={handleDropToFolder}
                onDropToCategory={handleDropToCategory}
                getFavoritesCount={(folderId) => getFavoritesInFolder(folderId).length}
            />

            {/* Custom Confirm Dialog */}
            <ConfirmDialog
                dialog={confirmDialog}
                onClose={() => setConfirmDialog(null)}
            />

            {/* Image Modal */}
            <ImageModal
                imageUrl={selectedImage}
                onClose={() => setSelectedImage(null)}
            />

            {/* Row Detail Modal */}
            <RowDetailModal
                row={selectedRow}
                columns={effectiveData.columns}
                imageColumn={effectiveImageColumn}
                extractImageUrl={extractImageUrl}
                onClose={() => setSelectedRow(null)}
            />

            {/* Context Menu for Thumbnail */}
            <ThumbnailContextMenu
                menu={contextMenu}
                menuPos={contextMenuPos}
                menuRef={contextMenuRef}
                closeTimerRef={contextMenuCloseTimerRef}
                onClose={() => setContextMenu(null)}
                labelColumns={effectiveLabelColumns}
                detailColumns={contextDetailColumns}
                detailColumn={contextDetailColumn}
                onDetailColumnChange={setContextDetailColumn}
                linkColumn={effectiveLinkColumn}
                folders={favoriteFolders}
                copyImageToClipboard={copyImageToClipboard}
                copyTextToClipboard={copyTextToClipboard}
                copyRowDataToClipboard={copyRowDataToClipboard}
                isFavorited={isFavorited}
                toggleFavorite={toggleFavorite}
                addToFolder={addToFolder}
                onCreateFolderAndAdd={(imageUrl, row) => {
                    setNewFolderModal({
                        isOpen: true,
                        name: '収藏夹 ' + (favoriteFolders.length + 1),
                        emoji: '📂',
                        onSuccess: (folderId) => {
                            addToFolder(imageUrl, row, folderId);
                        }
                    });
                }}
                openNoteModal={openNoteModal}
                openCategoryModal={openCategoryModal}
                getNoteForImage={getNoteForImage}
                getCategoryForImage={getCategoryForImage}
            />

            {/* Note Modal (备注弹窗) */}
            <NoteModal
                isOpen={noteModal.isOpen}
                imageUrl={noteModal.imageUrl}
                rowIndex={noteModal.rowIndex}
                currentNote={noteModal.currentNote}
                isSaving={noteModal.isSaving}
                syncToSheet={noteModal.syncToSheet}
                noteColumn={NOTE_COLUMN}
                sheetName={currentSheetName}
                onNoteChange={(note) => setNoteModal(prev => ({ ...prev, currentNote: note }))}
                onSyncToggle={() => setNoteModal(prev => ({ ...prev, syncToSheet: !prev.syncToSheet }))}
                onSave={() => saveNote(noteModal.syncToSheet)}
                onClose={closeNoteModal}
            />

            {/* New Folder Modal (新建收藏夹弹窗) */}
            <NewFolderModal
                isOpen={newFolderModal.isOpen}
                name={newFolderModal.name}
                emoji={newFolderModal.emoji}
                onNameChange={(name) => setNewFolderModal(prev => ({ ...prev, name }))}
                onEmojiChange={(emoji) => setNewFolderModal(prev => ({ ...prev, emoji }))}
                onCreate={() => {
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
                onClose={() => setNewFolderModal({ isOpen: false, name: '', emoji: '📂', onSuccess: undefined })}
            />

            {/* Folder Context Menu (收藏夹右键菜单) */}
            <FolderContextMenu
                menu={folderContextMenu}
                folders={favoriteFolders}
                defaultFolderId={DEFAULT_FOLDER_ID}
                onClose={() => setFolderContextMenu(null)}
                onEdit={(folder) => {
                    setEditFolderModal({
                        isOpen: true,
                        folderId: folder.id,
                        name: folder.name,
                        emoji: folder.emoji || '📁'
                    });
                }}
                onClearFolder={clearFavoritesInFolder}
                onDeleteFolder={(folderId) => {
                    setConfirmDialog({
                        isOpen: true,
                        title: '删除收藏夹',
                        message: '确定要删除这个收藏夹吗？文件夹内的收藏将移到默认收藏夹。',
                        type: 'danger',
                        confirmText: '删除',
                        cancelText: '取消',
                        onConfirm: () => {
                            deleteFolder(folderId);
                            setConfirmDialog(null);
                        }
                    });
                }}
            />

            {/* Edit Folder Modal (编辑收藏夹弹窗) */}
            <EditFolderModal
                isOpen={editFolderModal.isOpen}
                name={editFolderModal.name}
                emoji={editFolderModal.emoji}
                onNameChange={(name) => setEditFolderModal(prev => ({ ...prev, name }))}
                onEmojiChange={(emoji) => setEditFolderModal(prev => ({ ...prev, emoji }))}
                onSave={() => {
                    if (editFolderModal.name.trim()) {
                        renameFolder(editFolderModal.folderId, editFolderModal.name.trim(), editFolderModal.emoji);
                        setEditFolderModal({ isOpen: false, folderId: '', name: '', emoji: '' });
                        setCopyFeedback(`✅ 收藏夹已更新`);
                        setTimeout(() => setCopyFeedback(null), 2000);
                    }
                }}
                onClose={() => setEditFolderModal({ isOpen: false, folderId: '', name: '', emoji: '' })}
            />

            {/* Folder Selection Menu (收藏夹选择菜单) */}
            <FolderSelectionMenu
                isOpen={!!showFolderMenu}
                x={showFolderMenu?.x || 0}
                y={showFolderMenu?.y || 0}
                menuRef={folderMenuRef}
                folders={favoriteFolders}
                favorites={favorites}
                onSelectFolder={(folderId) => {
                    if (showFolderMenu) {
                        addToFolder(showFolderMenu.imageUrl, showFolderMenu.row, folderId);
                        setShowFolderMenu(null);
                    }
                }}
                onCreateFolder={() => {
                    if (showFolderMenu) {
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
                    }
                }}
                onClose={() => setShowFolderMenu(null)}
            />

            {/* Batch Folder Selection Menu (批量收藏夹选择菜单) */}
            <BatchFolderMenu
                isOpen={!!showBatchFolderMenu}
                x={showBatchFolderMenu?.x || 0}
                y={showBatchFolderMenu?.y || 0}
                menuRef={batchFolderMenuRef}
                selectedCount={selectedThumbnails.size}
                folders={favoriteFolders}
                favorites={favorites}
                onSelectFolder={(folderId) => {
                    addSelectedToFavorites(processedRows, folderId);
                    setShowBatchFolderMenu(null);
                }}
                onCreateFolder={() => {
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
            />

            {/* Login Prompt Modal (登录提示弹窗) */}
            <LoginPromptModal
                isOpen={!!showLoginPrompt}
                action={showLoginPrompt?.action || ''}
                onLogin={() => {
                    const loginBtn = document.querySelector('[data-login-button]') as HTMLButtonElement;
                    if (loginBtn) {
                        loginBtn.click();
                    } else {
                        setCopyFeedback('⚠️ 请点击右上角的登录按钮登录 Google 账号'); setTimeout(() => setCopyFeedback(null), 4000);
                    }
                    setShowLoginPrompt(null);
                }}
                onClose={() => setShowLoginPrompt(null)}
            />

            {/* Category Modal (分类弹窗) */}
            <CategoryModal
                isOpen={categoryModal.isOpen}
                imageUrl={categoryModal.imageUrl}
                rowIndex={categoryModal.rowIndex}
                currentCategory={categoryModal.currentCategory}
                isSaving={categoryModal.isSaving}
                categoryOptions={config.categoryOptions}
                autoSyncToSheet={autoSyncCategoriesToSheet}
                categoryColumn={CATEGORY_COLUMN}
                sheetName={currentSheetName}
                onSelectCategory={(cat) => saveCategory(cat, autoSyncCategoriesToSheet)}
                onClearCategory={() => saveCategory('', autoSyncCategoriesToSheet)}
                onSyncToggle={() => setAutoSyncCategoriesToSheet(!autoSyncCategoriesToSheet)}
                onClose={closeCategoryModal}
            />

            {/* Batch Category Modal (批量分类弹窗) */}
            <BatchCategoryModal
                isOpen={batchCategoryModal.isOpen}
                isSaving={batchCategoryModal.isSaving}
                selectedCount={selectedThumbnails.size}
                categoryOptions={config.categoryOptions}
                onSelectCategory={(cat) => batchApplyCategory(cat, processedRows)}
                onClearCategory={() => batchApplyCategory('', processedRows)}
                onClose={() => setBatchCategoryModal({ isOpen: false, isSaving: false })}
            />

            {/* Batch Note Modal (批量备注弹窗) */}
            <BatchNoteModal
                isOpen={batchNoteModal.isOpen}
                isSaving={batchNoteModal.isSaving}
                note={batchNoteModal.note}
                imageCount={batchNoteModal.imageUrls.length}
                onNoteChange={(note) => setBatchNoteModal(prev => ({ ...prev, note }))}
                onSave={() => batchApplyNote(batchNoteModal.note, batchNoteModal.imageUrls, processedRows)}
                onClose={() => setBatchNoteModal({ isOpen: false, isSaving: false, note: '', imageUrls: [] })}
            />

            {/* Preset Editor Modal (自定义预设编辑器) */}
            <PresetEditorModal
                isOpen={!!(showPresetEditor && editingPreset)}
                name={editingPreset?.name || ''}
                emoji={editingPreset?.emoji || '🏷️'}
                options={editingPreset?.options || []}
                onNameChange={(name) => editingPreset && setEditingPreset({ ...editingPreset, name })}
                onEmojiChange={(emoji) => editingPreset && setEditingPreset({ ...editingPreset, emoji })}
                onSave={() => {
                    if (editingPreset && editingPreset.name.trim()) {
                        saveCustomPreset(editingPreset);
                        setCopyFeedback(`✅ 预设 "${editingPreset.name}" 已保存`);
                        setTimeout(() => setCopyFeedback(null), 2000);
                    }
                }}
                onClose={() => {
                    setShowPresetEditor(false);
                    setEditingPreset(null);
                }}
            />

            {/* Copy View Layout Modal */}
            <CopyViewModal
                modal={copyViewModal}
                onModalChange={(v) => setCopyViewModal(v)}
                groupColumnName={effectiveGroupColumns[0]}
                allColumns={effectiveData.columns}
                imageColumn={effectiveImageColumn}
                classificationOverridesCount={Object.keys(classificationOverrides).length}
                onCopy={copyViewLayoutToClipboard}
            />

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
