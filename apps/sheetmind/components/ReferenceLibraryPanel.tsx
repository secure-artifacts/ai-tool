/**
 * ReferenceLibraryPanel - 参考库面板
 * 
 * 独立的数据源 + 画廊模式，作为 SheetMind 的子页面。
 * 自带 Google Sheets URL 输入，独立加载数据，
 * 复用 MediaGalleryPanel 的全部功能（设置、分类、筛选等）。
 */

import React, { useState, useEffect, useCallback, useMemo, useDeferredValue, useRef } from 'react';
import { BookOpen, Cloud, Loader2, RefreshCw, ArrowLeft, Database, Copy, Check, Plus, X, Settings } from 'lucide-react';
import MediaGalleryPanel from './MediaGalleryPanelV2';
import UnifiedSettingsPanel from './UnifiedSettingsPanel';
import { SheetData } from '../types';
import { SharedConfig, getDefaultSharedConfig } from '../types/sharedConfig';
import { fetchWorkbookSmart, parseSheetAsync } from '../utils/parser';
import { getGoogleAccessToken } from '@/services/authService';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Workbook = any;

const STORAGE_KEY = 'sheetmind_reflib_state';
const TABS_KEY = 'sheetmind_reflib_tabs';
const ACTIVE_TAB_KEY = 'sheetmind_reflib_active_tab';

interface RefLibTab {
    id: string;
    name: string;
    sourceUrl: string;
    sheetName?: string;
    config: SharedConfig;
    createdAt: number;
}

interface ReferenceLibraryPanelProps {
    onBack: () => void;
}

const normalizeSharedConfig = (config?: SharedConfig | null): SharedConfig => {
    const defaults = getDefaultSharedConfig();
    const merged = { ...defaults, ...(config || {}) } as SharedConfig;
    merged.groupColumns = (config?.groupColumns ?? defaults.groupColumns) || [];
    merged.groupLevels = (config?.groupLevels ?? defaults.groupLevels) || [];
    merged.groupBins = (config?.groupBins ?? defaults.groupBins) || [];
    merged.textGroupBins = (config?.textGroupBins ?? defaults.textGroupBins) || [];
    merged.dateBins = (config?.dateBins ?? defaults.dateBins) || [];
    merged.displayColumns = (config?.displayColumns ?? defaults.displayColumns) || [];
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

    // ==================== Settings State ====================
    const [showSettings, setShowSettings] = useState(false);
    const settingsBtnRef = useRef<HTMLButtonElement>(null);

    // Get active tab
    const activeTab = useMemo(() => tabs.find(t => t.id === activeTabId) || null, [tabs, activeTabId]);
    const activeConfig = useMemo(() => normalizeSharedConfig(activeTab?.config), [activeTab]);
    const deferredConfig = useDeferredValue(activeConfig);

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
    const loadFromUrl = useCallback(async (url: string, sheetName?: string) => {
        if (!url.trim()) return;
        setIsLoading(true);
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
            }
        } catch (err: unknown) {
            setLoadError(err instanceof Error ? err.message : '加载失败');
            console.error('[RefLib] Load error:', err);
        } finally {
            setIsLoading(false);
        }
    }, []);

    // Load data when active tab changes
    useEffect(() => {
        if (activeTab && activeTab.sourceUrl) {
            setUrlInput(activeTab.sourceUrl);
            loadFromUrl(activeTab.sourceUrl, activeTab.sheetName);
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

    return (
        <div className="flex flex-col h-full overflow-hidden bg-slate-50">
            {/* Header */}
            <div className="flex items-center gap-2 px-4 py-2 bg-white border-b border-slate-200 shadow-sm shrink-0">
                <button
                    onClick={onBack}
                    className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors"
                    title="返回"
                >
                    <ArrowLeft size={16} />
                </button>
                <BookOpen size={18} className="text-indigo-500" />
                <span className="font-semibold text-sm text-slate-800">参考库</span>
                <span className="text-xs text-slate-400 hidden sm:inline">从 Google Sheets 加载图片/生成词/参考数据</span>

                <div className="flex-1" />

                {/* Sheet selector */}
                {sheetNames.length > 1 && (
                    <select
                        className="text-xs border border-slate-200 rounded-lg px-2 py-1 bg-white text-slate-600"
                        value={currentSheetName}
                        onChange={e => switchSheet(e.target.value)}
                    >
                        {sheetNames.map(name => (
                            <option key={name} value={name}>{name}</option>
                        ))}
                    </select>
                )}

                {/* Refresh */}
                {activeTab?.sourceUrl && (
                    <button
                        onClick={handleRefresh}
                        disabled={isLoading}
                        className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 transition-colors disabled:opacity-30"
                        title="刷新数据"
                    >
                        <RefreshCw size={14} className={isLoading ? 'animate-spin' : ''} />
                    </button>
                )}

                {data && (
                    <span className="text-xs text-slate-400">
                        {data.rows.length} 行 · {data.columns.length} 列
                    </span>
                )}

                {/* Settings button */}
                {data && (
                    <button
                        ref={settingsBtnRef}
                        onClick={() => setShowSettings(!showSettings)}
                        className={`p-1.5 rounded-lg transition-colors ${
                            showSettings
                                ? 'bg-indigo-100 text-indigo-600'
                                : 'hover:bg-slate-100 text-slate-500'
                        }`}
                        title="设置（图片列、分组、筛选等）"
                    >
                        <Settings size={14} />
                    </button>
                )}
            </div>

            {/* Tabs bar */}
            <div className="flex items-center gap-1 px-3 py-1.5 bg-white border-b border-slate-100 overflow-x-auto shrink-0" style={{ scrollbarWidth: 'none' }}>
                {tabs.map(tab => (
                    <div
                        key={tab.id}
                        className={`group flex items-center gap-1 px-3 py-1 rounded-lg text-xs cursor-pointer transition-all shrink-0 ${
                            tab.id === activeTabId
                                ? 'bg-indigo-50 text-indigo-700 font-medium border border-indigo-200'
                                : 'text-slate-500 hover:bg-slate-50 border border-transparent'
                        }`}
                        onClick={() => {
                            if (tab.id !== activeTabId) setActiveTabId(tab.id);
                        }}
                        onDoubleClick={() => setEditingTabId(tab.id)}
                    >
                        {editingTabId === tab.id ? (
                            <input
                                autoFocus
                                className="w-20 bg-transparent outline-none border-b border-indigo-400 text-xs"
                                defaultValue={tab.name}
                                onBlur={e => handleSaveTabName(tab.id, e.target.value)}
                                onKeyDown={e => {
                                    if (e.key === 'Enter') handleSaveTabName(tab.id, (e.target as HTMLInputElement).value);
                                    if (e.key === 'Escape') setEditingTabId(null);
                                }}
                                onClick={e => e.stopPropagation()}
                            />
                        ) : (
                            <span className="truncate max-w-[120px]">{tab.name}</span>
                        )}

                        {tab.sourceUrl && (
                            <button
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-indigo-100 rounded transition-opacity"
                                onClick={e => { e.stopPropagation(); handleCopyUrl(tab.id); }}
                                title="复制链接"
                            >
                                {copiedTabId === tab.id ? <Check size={10} className="text-green-500" /> : <Copy size={10} />}
                            </button>
                        )}

                        {tabs.length > 1 && (
                            <button
                                className="opacity-0 group-hover:opacity-100 p-0.5 hover:bg-red-100 rounded text-red-400 transition-opacity"
                                onClick={e => { e.stopPropagation(); handleDeleteTab(tab.id); }}
                                title="删除"
                            >
                                <X size={10} />
                            </button>
                        )}
                    </div>
                ))}
                <button
                    className="p-1 rounded-lg hover:bg-slate-100 text-slate-400 transition-colors shrink-0"
                    onClick={handleAddTab}
                    title="新建参考库"
                >
                    <Plus size={14} />
                </button>
            </div>

            {/* Content */}
            {!data ? (
                /* Empty state / URL input */
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
                            <p>📝 文本列会自动识别为生成词/描述</p>
                            <p>🏷️ 短文本列会自动成为筛选分类</p>
                        </div>
                    </div>
                </div>
            ) : (
                /* Gallery view with data */
                <div className="flex-1 overflow-hidden flex flex-col min-w-0 relative p-0">
                    {/* URL bar (compact when data loaded) */}
                    <div className="flex items-center gap-2 px-3 py-1.5 bg-slate-50 border-b border-slate-100 shrink-0">
                        <Database size={12} className="text-slate-400 shrink-0" />
                        <input
                            className="flex-1 text-xs bg-transparent outline-none text-slate-500 placeholder-slate-300 min-w-0"
                            value={urlInput}
                            onChange={e => setUrlInput(e.target.value)}
                            placeholder="Google Sheets URL..."
                            onKeyDown={e => { if (e.key === 'Enter' && urlInput.trim() !== activeTab?.sourceUrl) handleLoadUrl(); }}
                        />
                        {urlInput.trim() !== activeTab?.sourceUrl && urlInput.trim() && (
                            <button
                                className="text-xs px-2 py-0.5 rounded bg-indigo-500 text-white hover:bg-indigo-600 transition-colors"
                                onClick={handleLoadUrl}
                            >
                                加载
                            </button>
                        )}
                    </div>

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
