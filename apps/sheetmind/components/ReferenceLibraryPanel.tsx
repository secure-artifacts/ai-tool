/**
 * ReferenceLibraryPanel - 参考库面板
 * 
 * 独立的数据源 + 画廊模式，作为 SheetMind 的子页面。
 * 自带 Google Sheets URL 输入，独立加载数据，
 * 复用 MediaGalleryPanel 的全部功能（设置、分类、筛选等）。
 * 
 * v2: 智能参考库模式
 *   - 自动检测分类列（列标题含"分类"或短文本分类列）
 *   - 按分类自动分组，并显示分类过滤按钮
 *   - 自动检测图片列（IMAGE公式 > URL > 媒体文字列）
 *   - 自动检测描述词列（右键可复制描述词和图片）
 */

import React, { useState, useEffect, useCallback, useMemo, useDeferredValue, useRef } from 'react';
import { BookOpen, Cloud, Loader2, RefreshCw, ArrowLeft, Database, Copy, Check, Plus, X, Settings, Filter, Image, Tag } from 'lucide-react';
import MediaGalleryPanel from './MediaGalleryPanelV2';
import UnifiedSettingsPanel from './UnifiedSettingsPanel';
import { SheetData, DataRow } from '../types';
import { SharedConfig, getDefaultSharedConfig } from '../types/sharedConfig';
import { fetchWorkbookSmart, parseSheetAsync } from '../utils/parser';
import { getGoogleAccessToken } from '@/services/authService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Workbook = any;

const STORAGE_KEY = 'sheetmind_reflib_state';
const TABS_KEY = 'sheetmind_reflib_tabs';
const ACTIVE_TAB_KEY = 'sheetmind_reflib_active_tab';
const CACHE_PREFIX = 'sheetmind_reflib_cache_'; // sessionStorage cache for parsed data

// ==================== 数据缓存工具 ====================
const saveDataCache = (tabId: string, sheetName: string, data: SheetData) => {
    try {
        const key = `${CACHE_PREFIX}${tabId}_${sheetName}`;
        const payload = JSON.stringify({ data, timestamp: Date.now() });
        // sessionStorage 限制约 5MB，如果太大就跳过
        if (payload.length < 4 * 1024 * 1024) {
            sessionStorage.setItem(key, payload);
        }
    } catch { /* ignore quota errors */ }
};

const loadDataCache = (tabId: string, sheetName: string): SheetData | null => {
    try {
        const key = `${CACHE_PREFIX}${tabId}_${sheetName}`;
        const raw = sessionStorage.getItem(key);
        if (!raw) return null;
        const { data } = JSON.parse(raw) as { data: SheetData; timestamp: number };
        return data;
    } catch { return null; }
};

interface RefLibTab {
    id: string;
    name: string;
    sourceUrl: string;
    sheetName?: string;
    config: SharedConfig;
    createdAt: number;
    // 参考库增强：记住用户选择的分类过滤
    activeCategoryFilter?: string; // '' = 全部, 其他 = 分类名
}

interface ReferenceLibraryPanelProps {
    onBack: () => void;
}

// ==================== 智能列检测工具函数 ====================

/** 检测列是否包含 =IMAGE() 公式 */
const isImageFormulaColumn = (rows: DataRow[], column: string): boolean => {
    const sample = rows.slice(0, 15);
    let formulaCount = 0;
    for (const row of sample) {
        const val = row[column];
        if (val && String(val).match(/=IMAGE\s*\(/i)) {
            formulaCount++;
        }
    }
    return formulaCount >= sample.length * 0.3;
};

/** 检测列是否包含图片 URL */
const isLikelyImageColumn = (rows: DataRow[], column: string): boolean => {
    const sample = rows.slice(0, 15);
    let imgCount = 0;
    for (const row of sample) {
        const val = row[column];
        if (!val) continue;
        const str = String(val).trim();
        // Check IMAGE formula
        if (str.match(/=IMAGE\s*\(/i)) { imgCount++; continue; }
        // Check image URL patterns
        if (str.match(/^https?:\/\/.+\.(jpg|jpeg|png|gif|webp|bmp|svg)/i)) { imgCount++; continue; }
        // Check Google Drive / CDN URLs
        if (str.match(/^https?:\/\/.*(drive\.google|googleusercontent|imgur|imgbb|cloudinary|unsplash)/i)) { imgCount++; continue; }
        // Generic URL with image keywords
        if (str.match(/^https?:\/\/[^\s]+$/i) && str.match(/(image|img|photo|pic|thumb|media|cdn|static|upload)/i)) { imgCount++; }
    }
    return imgCount >= sample.length * 0.3;
};

/** 检测列是否是"短文本分类"列（少量唯一值，非URL非数字） */
const isLikelyCategoryColumn = (rows: DataRow[], column: string): { valid: boolean; uniqueValues: string[]; counts: Map<string, number> } => {
    const counts = new Map<string, number>();
    let validTextCount = 0;

    for (const row of rows) {
        const val = row[column];
        if (val === null || val === undefined || val === '') continue;
        const str = String(val).trim();
        if (!str) continue;

        // 排除：URL、公式、纯数字、超长文本
        if (str.match(/^https?:\/\//i)) continue;
        if (str.startsWith('=')) continue;
        if (str.match(/^\d+(\.\d+)?$/)) continue;
        if (str.length > 200) continue; // 支持逗号/顿号分割的长关键词序列

        validTextCount++;
        
        // 支持顿号、逗号（中英文）、斜杠等作为多关键词分隔符
        const tags = str.split(/[、,，/|]/).map(t => t.trim()).filter(Boolean);
        for (const tag of tags) {
            counts.set(tag, (counts.get(tag) || 0) + 1);
        }
    }

    const uniqueValues = Array.from(counts.keys());

    // 判断是否为有效分类列：
    // - 有有效文本值
    // - 唯一值数量在 2~100 之间（支持细粒度的关键词标签）
    // - 每个分类至少出现 1 次
    const valid = validTextCount > 0 &&
        uniqueValues.length >= 2 &&
        uniqueValues.length <= 100 &&
        uniqueValues.length < rows.length * 2; // 放宽唯一数量限制，因为一行可能有多个词

    return { valid, uniqueValues, counts };
};

/** 检测描述词列（较长的中文/英文文本，非URL非公式） */
const isLikelyDescriptionColumn = (rows: DataRow[], column: string): boolean => {
    const sample = rows.slice(0, 15);
    let descCount = 0;
    for (const row of sample) {
        const val = row[column];
        if (!val) continue;
        const str = String(val).trim();
        if (str.length < 5) continue; // 太短不像描述
        if (str.match(/^https?:\/\//i)) continue;
        if (str.startsWith('=')) continue;
        if (str.match(/^\d+(\.\d+)?$/)) continue;
        // 有一定长度的文本
        if (str.length >= 10) descCount++;
    }
    return descCount >= sample.length * 0.3;
};

const normalizeSharedConfig = (config?: SharedConfig | null): SharedConfig => {
    const defaults = getDefaultSharedConfig();
    const merged = { ...defaults, ...(config || {}) } as SharedConfig;
    merged.groupColumns = (config?.groupColumns ?? defaults.groupColumns) || [];
    merged.groupLevels = (config?.groupLevels ?? defaults.groupLevels) || [];
    merged.groupBins = (config?.groupBins ?? defaults.groupBins) || [];
    merged.textGroupBins = (config?.textGroupBins ?? defaults.textGroupBins) || [];
    merged.dateBins = (config?.dateBins ?? defaults.dateBins) || [];
    merged.displayColumns = (config?.displayColumns ?? defaults.displayColumns) || [];
    merged.unpivotHeaderNames = (config?.unpivotHeaderNames ?? defaults.unpivotHeaderNames) || [];
    merged.combineSourceColumns = (config?.combineSourceColumns ?? defaults.combineSourceColumns) || [];
    merged.explodeSourceColumns = (config?.explodeSourceColumns ?? defaults.explodeSourceColumns) || [];
    merged.flattenValueColumns = (config?.flattenValueColumns ?? defaults.flattenValueColumns) || [];
    let sumCols = (config?.flattenSumColumns ?? defaults.flattenSumColumns) || [];
    if (sumCols.length === 0 && config?.flattenSumColumn) {
        sumCols = [config.flattenSumColumn];
    }
    merged.flattenSumColumns = sumCols;
    merged.customFilters = (config?.customFilters ?? defaults.customFilters) || [];
    merged.numFilters = (config?.numFilters ?? defaults.numFilters) || [];
    merged.sortRules = (config?.sortRules ?? defaults.sortRules) || [];
    merged.highlightRules = (config?.highlightRules ?? defaults.highlightRules) || [];
    if (merged.filtersEnabled === undefined) merged.filtersEnabled = true;
    if (merged.sortEnabled === undefined) merged.sortEnabled = true;
    if (merged.highlightEnabled === undefined) merged.highlightEnabled = true;
    return merged;
};

export default function ReferenceLibraryPanel({ onBack }: ReferenceLibraryPanelProps) {
    // ==================== Tab State ====================
    const [tabs, setTabs] = useState<RefLibTab[]>(() => {
        try {
            const saved = localStorage.getItem(TABS_KEY);
            if (saved) return JSON.parse(saved) as RefLibTab[];
        } catch { /* ignore */ }
        return [];
    });
    const [activeTabId, setActiveTabId] = useState<string | null>(() => {
        try { return localStorage.getItem(ACTIVE_TAB_KEY); } catch { return null; }
    });
    const [editingTabId, setEditingTabId] = useState<string | null>(null);

    // ==================== Data State ====================
    const [workbook, setWorkbook] = useState<Workbook | null>(null);
    const [data, setData] = useState<SheetData | null>(null);
    const [sheetNames, setSheetNames] = useState<string[]>([]);
    const [currentSheetName, setCurrentSheetName] = useState<string>('');
    const [isLoading, setIsLoading] = useState(false);
    const [loadError, setLoadError] = useState<string | null>(null);
    const [urlInput, setUrlInput] = useState('');
    const [copiedTabId, setCopiedTabId] = useState<string | null>(null);
    const [isBackgroundRefreshing, setIsBackgroundRefreshing] = useState(false); // 后台静默刷新

    // ==================== Settings State ====================
    const [showSettings, setShowSettings] = useState(false);
    const settingsBtnRef = useRef<HTMLButtonElement>(null);

    // ==================== 智能参考库 State ====================
    const [detectedCategoryCol, setDetectedCategoryCol] = useState<string>('');
    const [detectedImageCol, setDetectedImageCol] = useState<string>('');
    const [detectedDescCol, setDetectedDescCol] = useState<string>('');
    const [categoryValues, setCategoryValues] = useState<string[]>([]);
    const [categoryCounts, setCategoryCounts] = useState<Map<string, number>>(new Map());
    const [activeCategoryFilter, setActiveCategoryFilter] = useState<string>(''); // '' = 全部

    // Get active tab
    const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) || null, [tabs, activeTabId]);
    const activeConfig = useMemo(() => normalizeSharedConfig(activeTab?.config), [activeTab]);

    // ==================== 智能检测和过滤逻辑 ====================

    // 当数据加载后，智能检测列
    useEffect(() => {
        if (!data || data.rows.length === 0) {
            setDetectedCategoryCol('');
            setDetectedImageCol('');
            setDetectedDescCol('');
            setCategoryValues([]);
            setCategoryCounts(new Map());
            return;
        }

        const columns = data.columns;
        const rows = data.rows;

        // 1. 检测分类列/关键词列
        let catCol = '';
        // 优先：列名含分类、标签、关键词等
        const catNameMatch = columns.find(c =>
            /分类|类别|类型|category|type|标签|tag|关键词|keywords?/i.test(c)
        );
        if (catNameMatch) {
            const result = isLikelyCategoryColumn(rows, catNameMatch);
            if (result.valid) {
                catCol = catNameMatch;
                setCategoryValues(result.uniqueValues);
                setCategoryCounts(result.counts);
            }
        }
        // 其次：遍历找第一个符合条件的分类列（排除图片列和描述词列）
        if (!catCol) {
            for (const col of columns) {
                if (isLikelyImageColumn(rows, col)) continue;
                if (isImageFormulaColumn(rows, col)) continue;
                const result = isLikelyCategoryColumn(rows, col);
                if (result.valid) {
                    catCol = col;
                    setCategoryValues(result.uniqueValues);
                    setCategoryCounts(result.counts);
                    break;
                }
            }
        }
        setDetectedCategoryCol(catCol);

        // 2. 检测图片列
        let imgCol = '';
        // 优先：IMAGE() 公式列
        for (const col of columns) {
            if (isImageFormulaColumn(rows, col)) { imgCol = col; break; }
        }
        // 其次：图片URL列
        if (!imgCol) {
            for (const col of columns) {
                if (isLikelyImageColumn(rows, col)) { imgCol = col; break; }
            }
        }
        // 最后：列名含图片关键词
        if (!imgCol) {
            imgCol = columns.find(c => /图片|图像|image|photo|媒体|media|多媒体|缩略/i.test(c)) || '';
        }
        setDetectedImageCol(imgCol);

        // 3. 检测描述词列
        let descCol = '';
        for (const col of columns) {
            if (col === imgCol || col === catCol) continue;
            if (isLikelyDescriptionColumn(rows, col)) {
                descCol = col;
                break;
            }
        }
        // 列名匹配
        if (!descCol) {
            descCol = columns.find(c =>
                c !== imgCol && c !== catCol &&
                /描述|描述词|prompt|文案|文字|内容|说明|description|caption|text/i.test(c)
            ) || '';
        }
        setDetectedDescCol(descCol);

        // 恢复上次的分类过滤选择
        if (activeTab?.activeCategoryFilter && catCol) {
            setActiveCategoryFilter(activeTab.activeCategoryFilter);
        } else {
            setActiveCategoryFilter('');
        }
    }, [data]);

    // 根据检测结果和过滤选择，生成有效的 SharedConfig
    const effectiveConfig = useMemo(() => {
        const config = normalizeSharedConfig(activeTab?.config);

        // 自动设置分组列
        if (detectedCategoryCol && !config.groupColumn) {
            config.groupColumn = detectedCategoryCol;
        }

        // 自动设置图片列
        if (detectedImageCol && !config.imageColumn) {
            config.imageColumn = detectedImageCol;
        }

        // 自动设置详情列（描述词）
        if (detectedDescCol && !config.detailColumn) {
            config.detailColumn = detectedDescCol;
        }

        // 应用分类过滤
        if (activeCategoryFilter && detectedCategoryCol) {
            // 添加一个 contains 过滤器，因为现在的分类列可能是包含顿号的多个关键词
            const filterExists = config.customFilters.some(
                f => f.column === detectedCategoryCol && f.operator === 'contains' && f.value === activeCategoryFilter
            );
            if (!filterExists) {
                config.customFilters = [{
                    id: '__reflib_cat_filter',
                    column: detectedCategoryCol,
                    operator: 'contains',
                    value: activeCategoryFilter,
                }];
            }
        } else {
            // 移除自动添加的过滤器
            config.customFilters = config.customFilters.filter(f => f.id !== '__reflib_cat_filter');
        }

        return config;
    }, [activeTab?.config, detectedCategoryCol, detectedImageCol, detectedDescCol, activeCategoryFilter]);

    const deferredConfig = useDeferredValue(effectiveConfig);

    // ==================== Persistence ====================
    useEffect(() => {
        try {
            localStorage.setItem(TABS_KEY, JSON.stringify(tabs));
            if (activeTabId) localStorage.setItem(ACTIVE_TAB_KEY, activeTabId);
        } catch { /* ignore */ }
    }, [tabs, activeTabId]);

    // Auto-create first tab if none exist
    useEffect(() => {
        if (tabs.length === 0) {
            const now = Date.now();
            const firstTab: RefLibTab = {
                id: `reflib_${now}`,
                name: '参考库 1',
                sourceUrl: '',
                config: normalizeSharedConfig(getDefaultSharedConfig()),
                createdAt: now,
            };
            setTabs([firstTab]);
            setActiveTabId(firstTab.id);
        } else if (!activeTabId || !tabs.some(t => t.id === activeTabId)) {
            setActiveTabId(tabs[0].id);
        }
    }, [tabs, activeTabId]);

    // ==================== Data Loading ====================
    const loadFromUrl = useCallback(async (url: string, sheetName?: string, options?: { background?: boolean }) => {
        if (!url.trim()) return;
        const isBackground = options?.background === true;
        if (!isBackground) {
            setIsLoading(true);
        } else {
            setIsBackgroundRefreshing(true);
        }
        setLoadError(null);
        try {
            // Get OAuth token for private sheets
            let accessToken: string | null = null;
            try { accessToken = await getGoogleAccessToken(); } catch { /* public sheet fallback */ }

            const wb = await fetchWorkbookSmart(url, accessToken);
            if (!wb) throw new Error('无法加载表格数据');

            setWorkbook(wb);
            setSheetNames(wb.SheetNames || []);

            const targetSheet = sheetName || wb.SheetNames[0] || '';
            setCurrentSheetName(targetSheet);

            // Parse sheet
            if (targetSheet && wb.Sheets[targetSheet]) {
                const parsed = await parseSheetAsync(wb, targetSheet, '参考库');
                setData(parsed);
                // 缓存解析后的数据
                if (activeTabId) {
                    saveDataCache(activeTabId, targetSheet, parsed);
                }
            }
        } catch (err: unknown) {
            // 后台刷新失败不显示错误（已有缓存数据）
            if (!isBackground) {
                setLoadError(err instanceof Error ? err.message : '加载失败');
            }
            console.error('[RefLib] Load error:', err);
        } finally {
            if (!isBackground) {
                setIsLoading(false);
            } else {
                setIsBackgroundRefreshing(false);
            }
        }
    }, [activeTabId]);

    // Load data when active tab changes - 有缓存秒开，无缓存等用户点加载
    useEffect(() => {
        if (activeTab && activeTab.sourceUrl) {
            setUrlInput(activeTab.sourceUrl);

            // 1️⃣ 有缓存 → 秒开 + 后台静默刷新
            const cached = loadDataCache(activeTab.id, activeTab.sheetName || '');
            if (cached) {
                setData(cached);
                loadFromUrl(activeTab.sourceUrl, activeTab.sheetName, { background: true });
            }
            // 2️⃣ 无缓存 → 不自动加载，URL 已填好，等用户点"加载"
        } else {
            setData(null);
            setWorkbook(null);
            setSheetNames([]);
            setCurrentSheetName('');
            if (activeTab) setUrlInput(activeTab.sourceUrl || '');
        }
    }, [activeTabId]); // Only reload when tab switches

    // Switch sheet within workbook
    const switchSheet = useCallback(async (sheetName: string) => {
        if (!workbook || !workbook.Sheets[sheetName]) return;
        setCurrentSheetName(sheetName);
        setIsLoading(true);
        try {
            const parsed = await parseSheetAsync(workbook, sheetName, '参考库');
            setData(parsed);
            // Update tab sheetName
            if (activeTabId) {
                setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, sheetName } : t));
            }
        } catch (err) {
            console.error('[RefLib] Parse error:', err);
        } finally {
            setIsLoading(false);
        }
    }, [workbook, activeTabId]);

    // ==================== Tab Actions ====================
    const handleAddTab = useCallback(() => {
        const now = Date.now();
        const newTab: RefLibTab = {
            id: `reflib_${now}`,
            name: `参考库 ${tabs.length + 1}`,
            sourceUrl: '',
            config: normalizeSharedConfig(getDefaultSharedConfig()),
            createdAt: now,
        };
        setTabs(prev => [...prev, newTab]);
        setActiveTabId(newTab.id);
        setData(null);
        setWorkbook(null);
        setUrlInput('');
    }, [tabs.length]);

    const handleDeleteTab = useCallback((tabId: string) => {
        if (tabs.length <= 1) return;
        const tab = tabs.find(t => t.id === tabId);
        if (!tab || !confirm(`删除「${tab.name}」？`)) return;
        const nextTabs = tabs.filter(t => t.id !== tabId);
        setTabs(nextTabs);
        if (activeTabId === tabId) setActiveTabId(nextTabs[0]?.id || null);
    }, [tabs, activeTabId]);

    const handleSaveTabName = useCallback((tabId: string, name: string) => {
        const trimmed = name.trim();
        if (trimmed) setTabs(prev => prev.map(t => t.id === tabId ? { ...t, name: trimmed } : t));
        setEditingTabId(null);
    }, []);

    const handleLoadUrl = useCallback(() => {
        if (!urlInput.trim() || !activeTabId) return;
        setTabs(prev => prev.map(t => t.id === activeTabId ? { ...t, sourceUrl: urlInput.trim() } : t));
        loadFromUrl(urlInput.trim());
    }, [urlInput, activeTabId, loadFromUrl]);

    const handleRefresh = useCallback(() => {
        if (activeTab?.sourceUrl) loadFromUrl(activeTab.sourceUrl, currentSheetName);
    }, [activeTab, currentSheetName, loadFromUrl]);

    const handleCopyUrl = useCallback((tabId: string) => {
        const tab = tabs.find(t => t.id === tabId);
        if (tab?.sourceUrl) {
            navigator.clipboard.writeText(tab.sourceUrl);
            setCopiedTabId(tabId);
            setTimeout(() => setCopiedTabId(null), 1500);
        }
    }, [tabs]);

    // ==================== Config Management ====================
    const handleConfigChange = useCallback((nextConfig: SharedConfig) => {
        if (!activeTabId) return;
        const normalized = normalizeSharedConfig(nextConfig);
        setTabs(prev => prev.map(t =>
            t.id === activeTabId ? { ...t, config: normalized } : t
        ));
    }, [activeTabId]);

    // ==================== Category Filter ====================
    const handleCategoryClick = useCallback((category: string) => {
        const newFilter = activeCategoryFilter === category ? '' : category;
        setActiveCategoryFilter(newFilter);
        // 记住用户选择
        if (activeTabId) {
            setTabs(prev => prev.map(t =>
                t.id === activeTabId ? { ...t, activeCategoryFilter: newFilter } : t
            ));
        }
    }, [activeCategoryFilter, activeTabId]);

    // 排序分类值：按数量降序
    const sortedCategories = useMemo(() => {
        return [...categoryValues].sort((a, b) => {
            const countA = categoryCounts.get(a) || 0;
            const countB = categoryCounts.get(b) || 0;
            return countB - countA;
        });
    }, [categoryValues, categoryCounts]);

    const totalCount = useMemo(() => {
        let total = 0;
        categoryCounts.forEach(c => total += c);
        return total;
    }, [categoryCounts]);

    return (
        <div className="flex flex-col h-full overflow-hidden bg-slate-50">
            {/* ===== 合并的紧凑头部：返回 + 标签页 + 工具按钮 ===== */}
            <div className="flex items-center gap-1 px-2 py-1 bg-white border-b border-slate-200 shrink-0 overflow-x-auto" style={{ scrollbarWidth: 'none' }}>
                <button
                    onClick={onBack}
                    className="p-1 rounded hover:bg-slate-100 text-slate-500 transition-colors shrink-0"
                    title="返回"
                >
                    <ArrowLeft size={14} />
                </button>

                {/* 分隔 */}
                <div className="w-px h-4 bg-slate-200 shrink-0" />

                {/* Tabs inline */}
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        className={`group flex items-center gap-1 px-2 py-0.5 rounded text-[11px] cursor-pointer transition-all shrink-0 ${
                            tab.id === activeTabId
                                ? 'bg-indigo-50 text-indigo-700 font-medium'
                                : 'text-slate-500 hover:bg-slate-50'
                        }`}
                        onClick={() => { if (tab.id !== activeTabId) setActiveTabId(tab.id); }}
                        onDoubleClick={() => setEditingTabId(tab.id)}
                    >
                        {editingTabId === tab.id ? (
                            <input
                                autoFocus
                                className="w-16 bg-transparent outline-none border-b border-indigo-400 text-[11px]"
                                defaultValue={tab.name}
                                onBlur={e => handleSaveTabName(tab.id, e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') handleSaveTabName(tab.id, (e.target as HTMLInputElement).value);
                                    if (e.key === 'Escape') setEditingTabId(null);
                                }}
                                onClick={e => e.stopPropagation()}
                            />
                        ) : (
                            <span className="truncate max-w-[100px]">{tab.name}</span>
                        )}
                        {tab.sourceUrl && (
                            <button
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-indigo-100 rounded transition-opacity"
                                onClick={e => { e.stopPropagation(); handleCopyUrl(tab.id); }}
                                title="复制链接"
                            >
                                {copiedTabId === tab.id ? <Check size={8} className="text-green-500" /> : <Copy size={8} />}
                            </button>
                        )}
                        {tabs.length > 1 && (
                            <button
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 rounded text-red-400 transition-opacity"
                                onClick={e => { e.stopPropagation(); handleDeleteTab(tab.id); }}
                            >
                                <X size={8} />
                            </button>
                        )}
                    </div>
                ))}
                <button
                    className="p-0.5 rounded hover:bg-slate-100 text-slate-400 transition-colors shrink-0"
                    onClick={handleAddTab}
                    title="新建参考库"
                >
                    <Plus size={12} />
                </button>

                <div className="flex-1 min-w-[8px]" />

                {/* 右侧工具按钮 */}
                {/* Detected columns - compact badges */}
                {data && detectedImageCol && (
                    <span className="flex items-center gap-0.5 text-[9px] text-emerald-600 bg-emerald-50 px-1 py-0.5 rounded border border-emerald-100 shrink-0" title={`图片列: ${detectedImageCol}`}>
                        <Image size={8} /> {detectedImageCol}
                    </span>
                )}
                {data && detectedCategoryCol && (
                    <span className="flex items-center gap-0.5 text-[9px] text-indigo-600 bg-indigo-50 px-1 py-0.5 rounded border border-indigo-100 shrink-0" title={`分类列: ${detectedCategoryCol}`}>
                        <Tag size={8} /> {detectedCategoryCol}
                    </span>
                )}
                {data && detectedDescCol && (
                    <span className="flex items-center gap-0.5 text-[9px] text-amber-600 bg-amber-50 px-1 py-0.5 rounded border border-amber-100 shrink-0" title={`描述列: ${detectedDescCol} (右键复制)`}>
                        📝 {detectedDescCol}
                    </span>
                )}

                {sheetNames.length > 1 && (
                    <select
                        className="text-[10px] border border-slate-200 rounded px-1 py-0.5 bg-white text-slate-600 shrink-0"
                        value={currentSheetName}
                        onChange={e => switchSheet(e.target.value)}
                    >
                        {sheetNames.map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                )}

                {activeTab?.sourceUrl && (
                    <button
                        onClick={handleRefresh}
                        disabled={isLoading}
                        className="p-1 rounded hover:bg-slate-100 text-slate-500 transition-colors disabled:opacity-30 shrink-0"
                        title="刷新数据"
                    >
                        <RefreshCw size={12} className={isLoading || isBackgroundRefreshing ? 'animate-spin' : ''} />
                    </button>
                )}

                {data && (
                    <span className="text-[10px] text-slate-400 shrink-0">{data.rows.length}行</span>
                )}

                {data && (
                    <button
                        ref={settingsBtnRef}
                        onClick={() => setShowSettings(!showSettings)}
                        className={`p-1 rounded transition-colors shrink-0 ${
                            showSettings ? 'bg-indigo-100 text-indigo-600' : 'hover:bg-slate-100 text-slate-500'
                        }`}
                        title="设置"
                    >
                        <Settings size={12} />
                    </button>
                )}
            </div>

            {/* Content */}
            {!data ? (
                /* Empty state - 分两种情况 */
                activeTab?.sourceUrl ? (
                    /* 有保存的 URL 但无缓存数据 → 紧凑加载提示 */
                    <div className="flex-1 flex flex-col items-center justify-center p-6">
                        <div className="w-full max-w-md text-center">
                            <BookOpen size={32} className="text-indigo-400 mx-auto mb-3" />
                            <p className="text-sm text-slate-600 mb-4">点击加载参考库数据</p>
                            <div className="flex gap-2 mb-3">
                                <input
                                    className="flex-1 px-3 py-2 rounded-lg border border-slate-200 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-300 bg-white text-slate-500 min-w-0"
                                    value={urlInput}
                                    onChange={e => setUrlInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleLoadUrl(); }}
                                />
                                <button
                                    className="px-6 py-2 rounded-lg bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50 shrink-0"
                                    onClick={handleLoadUrl}
                                    disabled={isLoading || !urlInput.trim()}
                                >
                                    {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                                    加载
                                </button>
                            </div>
                            {loadError && (
                                <div className="p-2 rounded-lg bg-red-50 border border-red-100 text-red-600 text-xs">
                                    ⚠️ {loadError}
                                </div>
                            )}
                            <p className="text-[10px] text-slate-400 mt-2">加载后数据会自动缓存，下次秒开</p>
                        </div>
                    </div>
                ) : (
                    /* 全新标签页 → 完整引导 */
                    <div className="flex-1 flex flex-col items-center justify-center p-8">
                        <div className="w-full max-w-lg">
                            <div className="text-center mb-8">
                                <div className="w-16 h-16 rounded-2xl bg-gradient-to-br from-indigo-100 to-purple-100 flex items-center justify-center mx-auto mb-4">
                                    <BookOpen size={28} className="text-indigo-500" />
                                </div>
                                <h2 className="text-lg font-bold text-slate-800 mb-2">连接参考库</h2>
                                <p className="text-sm text-slate-500">
                                    粘贴 Google Sheets 链接，自动加载图片、生成词和分类数据
                                </p>
                            </div>

                            <div className="flex gap-2">
                                <input
                                    className="flex-1 px-4 py-2.5 rounded-xl border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-400 bg-white placeholder-slate-400"
                                    placeholder="https://docs.google.com/spreadsheets/d/..."
                                    value={urlInput}
                                    onChange={e => setUrlInput(e.target.value)}
                                    onKeyDown={e => { if (e.key === 'Enter') handleLoadUrl(); }}
                                />
                                <button
                                    className="px-5 py-2.5 rounded-xl bg-indigo-500 hover:bg-indigo-600 text-white text-sm font-medium transition-colors flex items-center gap-2 disabled:opacity-50"
                                    onClick={handleLoadUrl}
                                    disabled={isLoading || !urlInput.trim()}
                                >
                                    {isLoading ? <Loader2 size={14} className="animate-spin" /> : <Cloud size={14} />}
                                    加载
                                </button>
                            </div>

                            {loadError && (
                                <div className="mt-4 p-3 rounded-lg bg-red-50 border border-red-100 text-red-600 text-xs">
                                    ⚠️ {loadError}
                                </div>
                            )}

                            <div className="mt-6 text-xs text-slate-400 space-y-1">
                                <p>📋 表格需要设为<strong>「任何拥有链接的人」可查看</strong></p>
                                <p>🖼️ 图片列支持 =IMAGE() 公式和直接 URL</p>
                                <p>🏷️ 含"分类"标题的列会自动识别并显示分类过滤按钮</p>
                                <p>📝 描述词列 → 右键图片可直接复制描述词和图片</p>
                            </div>
                        </div>
                    </div>
                )
            ) : (
                /* Gallery view with data */
                <div className="flex-1 overflow-hidden flex flex-col min-w-0 relative p-0">

                    {/* ===== 分类过滤 + URL 合并为一条紧凑栏 ===== */}
                    {(detectedCategoryCol && sortedCategories.length > 0) && (
                        <div className="shrink-0 border-b border-slate-100 bg-white/80 backdrop-blur-sm">
                            <div
                                className="flex items-center gap-1 px-2 py-1 overflow-x-auto"
                                style={{ scrollbarWidth: 'none', msOverflowStyle: 'none' }}
                            >
                                {/* 全部按钮 */}
                                <button
                                    onClick={() => handleCategoryClick('')}
                                    className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium transition-all duration-200 border ${
                                        activeCategoryFilter === ''
                                            ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                                    }`}
                                >
                                    全部 <span className={`text-[9px] ${activeCategoryFilter === '' ? 'text-indigo-200' : 'text-slate-400'}`}>{totalCount}</span>
                                </button>

                                <div className="w-px h-3 bg-slate-200 shrink-0" />

                                {sortedCategories.map(category => {
                                    const count = categoryCounts.get(category) || 0;
                                    const isActive = activeCategoryFilter === category;
                                    return (
                                        <button
                                            key={category}
                                            onClick={() => handleCategoryClick(category)}
                                            className={`shrink-0 px-2 py-0.5 rounded-full text-[11px] font-medium transition-all duration-200 border whitespace-nowrap ${
                                                isActive
                                                    ? 'bg-indigo-500 text-white border-indigo-500 shadow-sm'
                                                    : 'bg-white text-slate-600 border-slate-200 hover:border-indigo-300 hover:text-indigo-600'
                                            }`}
                                            title={`${category} (${count})`}
                                        >
                                            {category} <span className={`text-[9px] ${isActive ? 'text-indigo-200' : 'text-slate-400'}`}>{count}</span>
                                        </button>
                                    );
                                })}
                            </div>
                        </div>
                    )}

                    <MediaGalleryPanel
                        data={data}
                        sourceUrl={activeTab?.sourceUrl}
                        currentSheetName={currentSheetName}
                        isLoading={isLoading}
                        sharedConfig={deferredConfig}
                    />
                </div>
            )}

            {/* Settings Panel */}
            {data && (
                <UnifiedSettingsPanel
                    isOpen={showSettings}
                    onClose={() => setShowSettings(false)}
                    config={activeConfig}
                    onConfigChange={handleConfigChange}
                    data={data}
                    mode="gallery"
                    anchorRef={settingsBtnRef as React.RefObject<HTMLElement>}
                />
            )}
        </div>
    );
}
