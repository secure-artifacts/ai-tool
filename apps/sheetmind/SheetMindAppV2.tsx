
import React, { useState, useEffect, useRef, useMemo, useCallback, useDeferredValue } from 'react';
import { SheetData, ChartSnapshot, ChartType, SheetMindState, initialSheetMindState } from './types';
import FileUpload from './components/FileUpload';
import DataGrid from './components/DataGrid';
import ChatInterface from './components/ChatInterface';
import Dashboard, { GenericChart } from './components/Dashboard';
import TransposePanel from './components/TransposePanel';
import ColumnAlignPanel from './components/ColumnAlignPanel';
import ImageFormulaPanel from './components/ImageFormulaPanel';
import ReferenceLibraryPanel from './components/ReferenceLibraryPanel';

import MediaGalleryPanel from './components/MediaGalleryPanelV2';
import DataSourceManager, { addDataSource, loadDataSources, DataSource } from './components/DataSourceManager';
import UnifiedSettingsPanel from './components/UnifiedSettingsPanel';
import { SharedConfig, getDefaultSharedConfig } from './types/sharedConfig';
import { Table, BarChart4, ChevronDown, RotateCw, X, MessageSquare, GalleryHorizontalEnd, PanelRightClose, PanelRightOpen, BarChart3, PieChart as PieChartIcon, LineChart as LineChartIcon, Trash2, FolderOpen, ArrowRightLeft, Image, Database, Cloud, Loader2, Filter, Copy, Eye, EyeOff, Layers, Check, HardDrive, Settings, MoveVertical, ClipboardPlus, Plus, BarChart2, Lightbulb, BookOpen, Sparkles } from 'lucide-react';
import { parseSheetAsync, parseMultipleSheetsAsync, fetchWorkbookFromUrl, fetchWorkbookWithAuth, fetchWorkbookSmart, filterWorkbook, getServiceAccountEmail } from './utils/parser';
import { getGoogleAccessToken } from '@/services/authService';
import { GoogleGenAI } from "@google/genai";
import { isUserLoggedIn, saveSnapshotsToCloud, loadSnapshotsFromCloud, CloudChartSnapshot } from './services/firebaseService';
import { isElectron, saveWorkbookCache, loadWorkbookCache, getCacheStats, getCacheKey } from './services/smartCacheService';
import * as XLSX from 'xlsx';


// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Workbook = any;

interface SheetMindAppProps {
    getAiInstance: () => GoogleGenAI;
    state: SheetMindState;
    setState: React.Dispatch<React.SetStateAction<SheetMindState>>;
    textModel?: string;
}

const STORAGE_KEY = 'sheetmind_workbook_cache';
const GALLERY_TABS_KEY = 'sheetmind_gallery_config_tabs';
const GALLERY_ACTIVE_TAB_KEY = 'sheetmind_gallery_active_tab';
const DS_TABS_KEY = 'sheetmind_datasource_tabs';
const DS_ACTIVE_TAB_KEY = 'sheetmind_datasource_active_tab';

interface GalleryConfigTab {
    id: string;
    name: string;
    config: SharedConfig;
    createdAt: number;
    updatedAt: number;
}

interface DataSourceTab {
    id: string;
    name: string;
    sourceUrl?: string;
    sourceId?: string;    // DataSource id from DataSourceManager
    fileName?: string;
    currentSheetName?: string;
    galleryTabs: GalleryConfigTab[];
    activeGalleryTabId: string | null;
    createdAt: number;
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


const SheetMindApp: React.FC<SheetMindAppProps> = ({ getAiInstance, state, setState, textModel = 'gemini-2.0-flash' }) => {
    // --- STATE ---
    const [workbook, setWorkbook] = useState<Workbook | null>(() => {
        // Try to restore workbook from localStorage on mount
        try {
            const cached = localStorage.getItem(STORAGE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                return parsed.workbook || null;
            }
        } catch (e) {
            console.warn('Failed to restore workbook from cache:', e);
        }
        return null;
    });
    const [fileName, setFileName] = useState<string>(() => {
        try {
            const cached = localStorage.getItem(STORAGE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                return parsed.fileName || state.fileName || "";
            }
        } catch { /* ignore */ }
        return state.fileName || "";
    });
    const [sourceUrl, setSourceUrl] = useState<string | undefined>(() => {
        try {
            const cached = localStorage.getItem(STORAGE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                return parsed.sourceUrl || state.sourceUrl;
            }
        } catch { /* ignore */ }
        return state.sourceUrl;
    });

    const [currentSheetName, setCurrentSheetName] = useState<string>(() => {
        try {
            const cached = localStorage.getItem(STORAGE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                return parsed.currentSheetName || state.currentSheetName || "";
            }
        } catch { /* ignore */ }
        return state.currentSheetName || "";
    });

    // Multi-sheet merge mode states
    const [isMultiSheetMode, setIsMultiSheetMode] = useState(false);
    const [selectedSheets, setSelectedSheets] = useState<Set<string>>(new Set());
    const [sheetSelectorOpen, setSheetSelectorOpen] = useState(false);

    const [data, setData] = useState<SheetData | null>(null);
    const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(() => {
        try {
            const cached = localStorage.getItem(STORAGE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                return parsed.lastRefreshedAt || null;
            }
        } catch { /* ignore */ }
        return null;
    });


    const parsedSnapshotRef = useRef<{ parsedData?: SheetData; parsedCacheKey?: string }>({});

    // Save workbook cache - uses local filesystem in Electron, IndexedDB in browser
    useEffect(() => {
        if (!workbook) return;
        const saveCache = async () => {
            try {
                const snapshot = parsedSnapshotRef.current || {};
                if (sourceUrl) {
                    const success = await saveWorkbookCache(sourceUrl, workbook, {
                        fileName,
                        currentSheetName,
                        lastRefreshedAt: lastRefreshedAt || Date.now()
                    }, snapshot.parsedData, snapshot.parsedCacheKey);
                    if (success) {
                    }

                    // 本地仅保存元信息，避免 localStorage 体积过大
                    localStorage.setItem(STORAGE_KEY, JSON.stringify({
                        workbook: null,
                        fileName,
                        sourceUrl,
                        currentSheetName,
                        lastRefreshedAt,
                        parsedCacheKey: snapshot.parsedCacheKey,
                        isLargeData: false
                    }));
                } else {
                    // 无数据源时仍使用 localStorage（如手动粘贴/本地导入）
                    const payload = {
                        workbook,
                        fileName,
                        sourceUrl,
                        currentSheetName,
                        lastRefreshedAt,
                        isLargeData: false
                    };
                    const dataStr = JSON.stringify(payload);
                    const sizeInMB = dataStr.length / (1024 * 1024);

                    if (sizeInMB > 3) {
                        localStorage.setItem(STORAGE_KEY, JSON.stringify({
                            workbook: null,
                            fileName,
                            sourceUrl,
                            currentSheetName,
                            lastRefreshedAt,
                            isLargeData: true
                        }));
                    } else {
                        localStorage.setItem(STORAGE_KEY, dataStr);
                    }
                }
            } catch (e) {
                console.warn('[Cache] 缓存失败:', e);
            }
        };
        saveCache();
    }, [workbook, fileName, sourceUrl, currentSheetName, lastRefreshedAt]);



    const [view, setView] = useState<'grid' | 'dashboard' | 'transpose' | 'gallery' | 'align' | 'image-formula' | 'reference-library'>(state.view === 'data-pipeline' ? 'grid' : (state.view || 'grid'));
    const isMediaToolMode = view === 'grid' || view === 'dashboard' || view === 'transpose' || view === 'gallery';
    const lastMediaViewRef = useRef<'grid' | 'dashboard' | 'transpose' | 'gallery'>('grid');
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [loadProgress, setLoadProgress] = useState<string | null>(null); // Progress message for large file loading
    const [needsReload, setNeedsReload] = useState(false); // Flag for large data that needs reload
    const [isParsingData, setIsParsingData] = useState(false);
    const loadRequestIdRef = useRef(0);
    const parseRequestIdRef = useRef(0);

    // Close sheet selector when clicking outside
    useEffect(() => {
        const handleClickOutside = () => setSheetSelectorOpen(false);
        if (sheetSelectorOpen) {
            document.addEventListener('click', handleClickOutside);
            return () => document.removeEventListener('click', handleClickOutside);
        }
    }, [sheetSelectorOpen]);

    useEffect(() => {
        if (view === 'grid' || view === 'dashboard' || view === 'transpose' || view === 'gallery') {
            lastMediaViewRef.current = view;
        }
    }, [view]);

    // ==================== Deduplication State ====================
    const [dedupColumn, setDedupColumn] = useState<string>(''); // Column to check for duplicates
    const [dedupMode, setDedupMode] = useState<'off' | 'remove' | 'show'>('off'); // off = no dedup, remove = hide duplicates, show = only show duplicates
    const [showDedupPanel, setShowDedupPanel] = useState(false);

    // ==================== Append Data State ====================
    const [showAppendModal, setShowAppendModal] = useState(false);
    const [appendPasteContent, setAppendPasteContent] = useState('');
    const [appendHtmlContent, setAppendHtmlContent] = useState<string | null>(null); // Google Sheets HTML
    const [appendLoading, setAppendLoading] = useState(false);
    const appendTextareaRef = useRef<HTMLTextAreaElement>(null);
    const settingsBtnRef = useRef<HTMLButtonElement>(null);
    const sheetSelectorBtnRef = useRef<HTMLButtonElement>(null);

    // ==================== Unified Settings State ====================
    const [showUnifiedSettings, setShowUnifiedSettings] = useState(false);
    const [editingTabId, setEditingTabId] = useState<string | null>(null);
    const [galleryTabs, setGalleryTabs] = useState<GalleryConfigTab[]>(() => {
        try {
            const saved = localStorage.getItem(GALLERY_TABS_KEY);
            if (saved) {
                const parsed = JSON.parse(saved) as GalleryConfigTab[];
                return parsed.map(tab => ({
                    ...tab,
                    config: normalizeSharedConfig(tab.config)
                }));
            }
        } catch { /* ignore */ }
        return [];
    });
    const [activeGalleryTabId, setActiveGalleryTabId] = useState<string | null>(() => {
        try {
            return localStorage.getItem(GALLERY_ACTIVE_TAB_KEY);
        } catch { /* ignore */ }
        return null;
    });
    const activeGalleryTab = useMemo(
        () => galleryTabs.find(tab => tab.id === activeGalleryTabId) || null,
        [galleryTabs, activeGalleryTabId]
    );
    const activeConfig = useMemo(
        () => normalizeSharedConfig(activeGalleryTab?.config ?? getDefaultSharedConfig()),
        [activeGalleryTab]
    );
    const deferredSharedConfig = useDeferredValue(activeConfig);

    // ==================== Data Source Tabs State ====================
    const [dataSourceTabs, setDataSourceTabs] = useState<DataSourceTab[]>(() => {
        try {
            const saved = localStorage.getItem(DS_TABS_KEY);
            if (saved) return JSON.parse(saved) as DataSourceTab[];
        } catch { /* ignore */ }
        return [];
    });
    const [activeDataSourceTabId, setActiveDataSourceTabId] = useState<string | null>(() => {
        try {
            return localStorage.getItem(DS_ACTIVE_TAB_KEY);
        } catch { /* ignore */ }
        return null;
    });
    const [editingDsTabId, setEditingDsTabId] = useState<string | null>(null);
    const switchingDsRef = useRef(false); // prevent re-entrant switches

    const updateActiveConfig = useCallback((nextConfig: SharedConfig) => {
        if (!activeGalleryTabId) {
            console.warn('[SheetMindApp] updateActiveConfig called but activeGalleryTabId is null - config update ignored!');
            return;
        }
        const normalized = normalizeSharedConfig(nextConfig);
        setGalleryTabs(prev => prev.map(tab => (
            tab.id === activeGalleryTabId
                ? { ...tab, config: normalized, updatedAt: Date.now() }
                : tab
        )));
    }, [activeGalleryTabId]);

    useEffect(() => {
        if (galleryTabs.length > 0) {
            if (!activeGalleryTabId || !galleryTabs.some(tab => tab.id === activeGalleryTabId)) {
                setActiveGalleryTabId(galleryTabs[0].id);
            }
            return;
        }
        const now = Date.now();
        const initialTab: GalleryConfigTab = {
            id: now.toString(),
            name: '默认配置',
            config: normalizeSharedConfig(getDefaultSharedConfig()),
            createdAt: now,
            updatedAt: now,
        };
        setGalleryTabs([initialTab]);
        setActiveGalleryTabId(initialTab.id);
    }, [galleryTabs, activeGalleryTabId]);

    const switchGalleryTab = useCallback((tabId: string) => {
        const nextTab = galleryTabs.find(tab => tab.id === tabId);
        if (!nextTab) return;
        setActiveGalleryTabId(tabId);
    }, [galleryTabs]);

    useEffect(() => {
        try {
            localStorage.setItem(GALLERY_TABS_KEY, JSON.stringify(galleryTabs));
            if (activeGalleryTabId) {
                localStorage.setItem(GALLERY_ACTIVE_TAB_KEY, activeGalleryTabId);
            }
        } catch { /* ignore */ }
    }, [galleryTabs, activeGalleryTabId]);

    const handleAddGalleryTab = useCallback(() => {
        const now = Date.now();
        const newTab: GalleryConfigTab = {
            id: now.toString(),
            name: `配置 ${galleryTabs.length + 1}`,
            config: normalizeSharedConfig(getDefaultSharedConfig()),
            createdAt: now,
            updatedAt: now,
        };
        setGalleryTabs(prev => [...prev, newTab]);
        setActiveGalleryTabId(newTab.id);
    }, [galleryTabs.length]);

    const handleDuplicateGalleryTab = useCallback(() => {
        if (!activeGalleryTab) return;
        const now = Date.now();
        const newTab: GalleryConfigTab = {
            id: `${now}`,
            name: `${activeGalleryTab.name} 复制`,
            config: normalizeSharedConfig(activeGalleryTab.config),
            createdAt: now,
            updatedAt: now,
        };
        setGalleryTabs(prev => [...prev, newTab]);
        setActiveGalleryTabId(newTab.id);
    }, [activeGalleryTab]);

    const handleRenameGalleryTab = useCallback((tabId: string) => {
        setEditingTabId(tabId);
    }, []);

    const handleSaveTabName = useCallback((tabId: string, newName: string) => {
        const trimmed = newName.trim();
        if (trimmed) {
            setGalleryTabs(prev => prev.map(t => (
                t.id === tabId ? { ...t, name: trimmed, updatedAt: Date.now() } : t
            )));
        }
        setEditingTabId(null);
    }, []);

    const handleDeleteGalleryTab = useCallback((tabId: string) => {
        if (galleryTabs.length <= 1) return;
        const tab = galleryTabs.find(t => t.id === tabId);
        if (!tab) return;
        if (!confirm(`删除标签页 "${tab.name}"？`)) return;
        const nextTabs = galleryTabs.filter(t => t.id !== tabId);
        setGalleryTabs(nextTabs);
        if (activeGalleryTabId === tabId) {
            setActiveGalleryTabId(nextTabs[0]?.id || null);
        }
    }, [galleryTabs, activeGalleryTabId]);

    // ==================== Data Source Tabs Logic ====================
    // Persist data source tabs
    // Ref to bridge forward reference to applyCachedWorkbook (defined later in the component)
    const applyCachedWorkbookRef = useRef<((cached: any, fallbackName?: string) => void) | null>(null);
    useEffect(() => {
        try {
            localStorage.setItem(DS_TABS_KEY, JSON.stringify(dataSourceTabs));
            if (activeDataSourceTabId) {
                localStorage.setItem(DS_ACTIVE_TAB_KEY, activeDataSourceTabId);
            }
        } catch { /* ignore */ }
    }, [dataSourceTabs, activeDataSourceTabId]);

    // Save current state into the current data source tab
    const saveCurrentDsState = useCallback(() => {
        if (!activeDataSourceTabId) return;
        setDataSourceTabs(prev => prev.map(tab => {
            if (tab.id !== activeDataSourceTabId) return tab;
            return {
                ...tab,
                sourceUrl,
                fileName,
                currentSheetName,
                galleryTabs,
                activeGalleryTabId,
            };
        }));
    }, [activeDataSourceTabId, sourceUrl, fileName, currentSheetName, galleryTabs, activeGalleryTabId]);

    // Create a new data source tab for the current data
    const handleAddDataSourceTab = useCallback(() => {
        // Save current state first
        saveCurrentDsState();

        const now = Date.now();
        const initialGalleryTab: GalleryConfigTab = {
            id: `gc_${now}`,
            name: '默认配置',
            config: normalizeSharedConfig(getDefaultSharedConfig()),
            createdAt: now,
            updatedAt: now,
        };
        const newTab: DataSourceTab = {
            id: `ds_${now}`,
            name: `数据源 ${dataSourceTabs.length + 1}`,
            galleryTabs: [initialGalleryTab],
            activeGalleryTabId: initialGalleryTab.id,
            createdAt: now,
        };
        setDataSourceTabs(prev => [...prev, newTab]);
        setActiveDataSourceTabId(newTab.id);

        // Clear current data so user can load a new source
        setWorkbook(null);
        setData(null);
        setSourceUrl(undefined);
        setFileName('');
        setCurrentSheetName('');
        setGalleryTabs([initialGalleryTab]);
        setActiveGalleryTabId(initialGalleryTab.id);
    }, [dataSourceTabs.length, saveCurrentDsState]);

    // Create a data source tab from current loaded data (for initial migration)
    const ensureCurrentDataSourceTab = useCallback(() => {
        if (dataSourceTabs.length > 0) return; // Already have tabs
        if (!sourceUrl && !workbook) return; // No data loaded

        const now = Date.now();
        const currentTab: DataSourceTab = {
            id: `ds_${now}`,
            name: fileName || sourceUrl || '当前数据',
            sourceUrl,
            fileName,
            currentSheetName,
            galleryTabs,
            activeGalleryTabId,
            createdAt: now,
        };
        setDataSourceTabs([currentTab]);
        setActiveDataSourceTabId(currentTab.id);
    }, [dataSourceTabs.length, sourceUrl, workbook, fileName, currentSheetName, galleryTabs, activeGalleryTabId]);

    // Auto-create first data source tab when data is loaded
    useEffect(() => {
        ensureCurrentDataSourceTab();
    }, [ensureCurrentDataSourceTab]);

    // Switch data source tab
    const switchDataSourceTab = useCallback(async (tabId: string, options?: { skipSave?: boolean }) => {
        if (tabId === activeDataSourceTabId) return;
        if (switchingDsRef.current) return;
        switchingDsRef.current = true;

        // Save current state
        if (!options?.skipSave) {
            saveCurrentDsState();
        }

        const targetTab = dataSourceTabs.find(t => t.id === tabId);
        if (!targetTab) {
            switchingDsRef.current = false;
            return;
        }

        setActiveDataSourceTabId(tabId);

        // Restore gallery config tabs
        if (targetTab.galleryTabs && targetTab.galleryTabs.length > 0) {
            setGalleryTabs(targetTab.galleryTabs.map(t => ({ ...t, config: normalizeSharedConfig(t.config) })));
            setActiveGalleryTabId(targetTab.activeGalleryTabId || targetTab.galleryTabs[0].id);
        } else {
            const now = Date.now();
            const defaultTab: GalleryConfigTab = {
                id: `gc_${now}`,
                name: '默认配置',
                config: normalizeSharedConfig(getDefaultSharedConfig()),
                createdAt: now,
                updatedAt: now,
            };
            setGalleryTabs([defaultTab]);
            setActiveGalleryTabId(defaultTab.id);
        }

        // Restore data source metadata
        setFileName(targetTab.fileName || '');
        setCurrentSheetName(targetTab.currentSheetName || '');

        if (targetTab.sourceUrl) {
            // Load from cache
            setIsRefreshing(true);
            setLoadProgress('📂 切换数据源...');
            try {
                const cached = await loadWorkbookCache(targetTab.sourceUrl, targetTab.sourceId);
                if (cached.success && cached.data) {
                    if (applyCachedWorkbookRef.current) {
                        applyCachedWorkbookRef.current({ ...cached.data, sourceUrl: targetTab.sourceUrl }, targetTab.fileName);
                    }
                } else {
                    // No cache, just set the URL and let user refresh
                    setSourceUrl(targetTab.sourceUrl);
                    setWorkbook(null);
                    setData(null);
                }
            } catch (e) {
                console.warn('[DS Tab] Failed to load cached data:', e);
                setSourceUrl(targetTab.sourceUrl);
                setWorkbook(null);
                setData(null);
            } finally {
                setLoadProgress(null);
                setIsRefreshing(false);
            }
        } else {
            // No source URL - empty tab
            setSourceUrl(undefined);
            setWorkbook(null);
            setData(null);
        }

        switchingDsRef.current = false;
    }, [activeDataSourceTabId, dataSourceTabs, saveCurrentDsState]);

    // Delete data source tab
    const handleDeleteDataSourceTab = useCallback((tabId: string) => {
        if (dataSourceTabs.length <= 1) return;
        const tab = dataSourceTabs.find(t => t.id === tabId);
        if (!tab) return;

        const nextTabs = dataSourceTabs.filter(t => t.id !== tabId);
        setDataSourceTabs(nextTabs);

        if (activeDataSourceTabId === tabId) {
            // Switch to another tab
            const nextTab = nextTabs[0];
            if (nextTab) {
                void switchDataSourceTab(nextTab.id, { skipSave: true });
            }
        }
    }, [dataSourceTabs, activeDataSourceTabId, switchDataSourceTab]);

    // Rename data source tab
    const handleSaveDsTabName = useCallback((tabId: string, newName: string) => {
        const trimmed = newName.trim();
        if (trimmed) {
            setDataSourceTabs(prev => prev.map(t => (
                t.id === tabId ? { ...t, name: trimmed } : t
            )));
        }
        setEditingDsTabId(null);
    }, []);

    // Update current DS tab name when data source changes
    useEffect(() => {
        if (!activeDataSourceTabId || !fileName || switchingDsRef.current) return;
        setDataSourceTabs(prev => prev.map(tab => {
            if (tab.id !== activeDataSourceTabId) return tab;
            // Only auto-update name if it was a generic name
            const isGenericName = /^数据源 \d+$/.test(tab.name) || tab.name === '当前数据';
            return {
                ...tab,
                sourceUrl,
                fileName,
                currentSheetName,
                ...(isGenericName && fileName ? { name: fileName } : {}),
            };
        }));
    }, [activeDataSourceTabId, sourceUrl, fileName, currentSheetName]);

    // Sidebar & Gallery State
    const [isSidebarOpen, setIsSidebarOpen] = useState(state.isSidebarOpen || false);
    const [sidebarTab, setSidebarTab] = useState<'chat' | 'gallery'>(state.sidebarTab || 'chat');
    const [snapshots, setSnapshots] = useState<ChartSnapshot[]>(state.snapshots || []);
    const [snapshotsSyncing, setSnapshotsSyncing] = useState(false);
    const snapshotsCloudLoadedRef = useRef(false);
    const sheetParserWorkerRef = useRef<Worker | null>(null);

    // Load snapshots from Firebase on mount
    useEffect(() => {
        if (snapshotsCloudLoadedRef.current) return;

        const loadCloudSnapshots = async () => {
            if (!isUserLoggedIn()) return;
            try {
                const cloudSnapshots = await loadSnapshotsFromCloud();
                if (cloudSnapshots.length > 0) {
                    snapshotsCloudLoadedRef.current = true;
                    setSnapshots(cloudSnapshots as ChartSnapshot[]);
                }
            } catch (err) {
                console.error('[Cloud Sync] Failed to load snapshots:', err);
            }
        };
        loadCloudSnapshots();
    }, []);

    useEffect(() => {
        return () => {
            if (sheetParserWorkerRef.current) {
                sheetParserWorkerRef.current.terminate();
                sheetParserWorkerRef.current = null;
            }
        };
    }, []);

    // Save snapshots to Firebase (debounced)
    const snapshotsSyncTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    useEffect(() => {
        if (!snapshotsCloudLoadedRef.current && snapshots.length === 0) return; // Skip initial empty state

        if (snapshotsSyncTimeoutRef.current) {
            clearTimeout(snapshotsSyncTimeoutRef.current);
        }

        if (isUserLoggedIn()) {
            snapshotsSyncTimeoutRef.current = setTimeout(async () => {
                try {
                    setSnapshotsSyncing(true);
                    await saveSnapshotsToCloud(snapshots as CloudChartSnapshot[]);
                } catch (err) {
                    console.error('[Cloud Sync] Failed to save snapshots:', err);
                } finally {
                    setSnapshotsSyncing(false);
                }
            }, 2000); // 2 second debounce
        }

        return () => {
            if (snapshotsSyncTimeoutRef.current) {
                clearTimeout(snapshotsSyncTimeoutRef.current);
            }
        };
    }, [snapshots]);

    // Close confirmation modal
    const [showCloseConfirm, setShowCloseConfirm] = useState(false);

    // Data source manager
    const [showDataSourceManager, setShowDataSourceManager] = useState(false);

    // Check if we need to reload large data on mount
    useEffect(() => {
        try {
            const cached = localStorage.getItem(STORAGE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed.isLargeData && parsed.sourceUrl && !workbook) {
                    // Large data was not cached, need to reload from URL
                    setNeedsReload(true);
                }
            }
        } catch { /* ignore */ }
    }, []);

    // Sync state back to parent for persistence
    useEffect(() => {
        setState(prev => ({
            ...prev,
            hasWorkbook: !!workbook,
            fileName,
            sourceUrl,
            currentSheetName,
            view,
            isSidebarOpen,
            sidebarTab,
            snapshots,
        }));
    }, [workbook, fileName, sourceUrl, currentSheetName, view, isSidebarOpen, sidebarTab, snapshots, setState]);

    // --- ACTIONS ---

    const handleWorkbookLoaded = (wb: Workbook, name: string, url?: string) => {
        setWorkbook(wb);
        setFileName(name);
        setSourceUrl(url);

        // Reset multi-sheet mode when loading new workbook
        setIsMultiSheetMode(false);
        setSelectedSheets(new Set());
        setSheetSelectorOpen(false);

        // Default to first sheet
        const firstSheet = wb.SheetNames[0];
        setCurrentSheetName(firstSheet);

        // Auto-save Google Sheets URL to data sources
        if (url && url.includes('docs.google.com/spreadsheets')) {
            const existingSources = loadDataSources();
            const alreadyExists = existingSources.some(s => s.url === url);
            if (!alreadyExists) {
                addDataSource({
                    name: name || '未命名数据源',
                    url: url,
                    type: 'google-sheets',
                });
            }
        }
    };

    // ==================== Sheet Parsing with Cache ====================
    // Cache parsed sheet data to avoid reparsing when switching tabs
    const parsedSheetCacheRef = useRef<Map<string, SheetData>>(new Map());

    // Cache key generator
    const getSheetCacheKey = useCallback((sheetName: string, isMulti: boolean, sheets: Set<string>) => {
        if (isMulti && sheets.size > 0) {
            return `multi:${Array.from(sheets).sort().join(',')}`;
        }
        return `single:${sheetName}`;
    }, []);

    // Clear cache when workbook changes
    useEffect(() => {
        parsedSheetCacheRef.current.clear();
        parsedSnapshotRef.current = {};
    }, [workbook]);

    useEffect(() => {
        try {
            const cached = localStorage.getItem(STORAGE_KEY);
            if (cached) {
                const parsed = JSON.parse(cached);
                if (parsed.parsedData && parsed.parsedCacheKey) {
                    parsedSheetCacheRef.current.set(parsed.parsedCacheKey, parsed.parsedData);
                    parsedSnapshotRef.current = {
                        parsedData: parsed.parsedData,
                        parsedCacheKey: parsed.parsedCacheKey
                    };
                }
            }
        } catch (e) {
            console.warn('[SheetCache] 恢复本地预解析缓存失败:', e);
        }
    }, []);

    useEffect(() => {
        const requestId = ++parseRequestIdRef.current;

        if (!workbook) {
            setData(null);
            setIsParsingData(false);
            return;
        }

        const cacheKey = getSheetCacheKey(currentSheetName, isMultiSheetMode, selectedSheets);

        // Try cache first - instant switch! No loading state needed
        const cached = parsedSheetCacheRef.current.get(cacheKey);
        if (cached) {
            setData(cached);
            setIsParsingData(false);
            setIsRefreshing(false); // 缓存命中也要关闭加载状态
            return;
        }

        // Only show loading state when we actually need to parse
        setIsParsingData(true);

        // Not cached - parse in worker to avoid blocking UI
        const parseWork = async () => {
            if (requestId !== parseRequestIdRef.current) return;

            try {
                let parsedData: SheetData | null = null;

                if (isMultiSheetMode && selectedSheets.size > 0) {
                    const targetSheets = Array.from(selectedSheets).sort();
                    const sheetMap: Record<string, XLSX.WorkSheet> = {};
                    targetSheets.forEach(name => {
                        const sheet = workbook.Sheets?.[name];
                        if (sheet) sheetMap[name] = sheet;
                    });

                    if (typeof Worker !== 'undefined') {
                        if (sheetParserWorkerRef.current) {
                            sheetParserWorkerRef.current.terminate();
                            sheetParserWorkerRef.current = null;
                        }
                        const worker = new Worker(new URL('./workers/sheetParser.worker.ts', import.meta.url), { type: 'module' });
                        sheetParserWorkerRef.current = worker;

                        parsedData = await new Promise<SheetData>((resolve, reject) => {
                            const handleMessage = (event: MessageEvent<{ id: number; result?: SheetData; error?: string }>) => {
                                if (event.data.id !== requestId) return;
                                worker.removeEventListener('message', handleMessage);
                                worker.removeEventListener('error', handleError);
                                sheetParserWorkerRef.current?.terminate();
                                sheetParserWorkerRef.current = null;

                                if (event.data.error) {
                                    reject(new Error(event.data.error));
                                } else if (event.data.result) {
                                    resolve(event.data.result);
                                } else {
                                    reject(new Error('解析失败'));
                                }
                            };
                            const handleError = (err: ErrorEvent) => {
                                worker.removeEventListener('message', handleMessage);
                                worker.removeEventListener('error', handleError);
                                sheetParserWorkerRef.current?.terminate();
                                sheetParserWorkerRef.current = null;
                                reject(err.error || new Error(err.message));
                            };
                            worker.addEventListener('message', handleMessage);
                            worker.addEventListener('error', handleError);
                            worker.postMessage({
                                id: requestId,
                                mode: 'multi',
                                fileName,
                                sheetNames: targetSheets,
                                sheets: sheetMap,
                                allSheetNames: workbook.SheetNames || []
                            });
                        });
                    } else {
                        parsedData = await parseMultipleSheetsAsync(workbook, targetSheets, fileName, { chunkSize: 1000 });
                    }
                } else if (currentSheetName) {
                    const sheet = workbook.Sheets?.[currentSheetName];
                    if (sheet) {
                        if (typeof Worker !== 'undefined') {
                            if (sheetParserWorkerRef.current) {
                                sheetParserWorkerRef.current.terminate();
                                sheetParserWorkerRef.current = null;
                            }
                            const worker = new Worker(new URL('./workers/sheetParser.worker.ts', import.meta.url), { type: 'module' });
                            sheetParserWorkerRef.current = worker;

                            parsedData = await new Promise<SheetData>((resolve, reject) => {
                                const handleMessage = (event: MessageEvent<{ id: number; result?: SheetData; error?: string }>) => {
                                    if (event.data.id !== requestId) return;
                                    worker.removeEventListener('message', handleMessage);
                                    worker.removeEventListener('error', handleError);
                                    sheetParserWorkerRef.current?.terminate();
                                    sheetParserWorkerRef.current = null;

                                    if (event.data.error) {
                                        reject(new Error(event.data.error));
                                    } else if (event.data.result) {
                                        resolve(event.data.result);
                                    } else {
                                        reject(new Error('解析失败'));
                                    }
                                };
                                const handleError = (err: ErrorEvent) => {
                                    worker.removeEventListener('message', handleMessage);
                                    worker.removeEventListener('error', handleError);
                                    sheetParserWorkerRef.current?.terminate();
                                    sheetParserWorkerRef.current = null;
                                    reject(err.error || new Error(err.message));
                                };
                                worker.addEventListener('message', handleMessage);
                                worker.addEventListener('error', handleError);
                                worker.postMessage({
                                    id: requestId,
                                    mode: 'single',
                                    fileName,
                                    sheetName: currentSheetName,
                                    sheet,
                                    allSheetNames: workbook.SheetNames || []
                                });
                            });
                        } else {
                            parsedData = await parseSheetAsync(workbook, currentSheetName, fileName, { chunkSize: 1000 });
                        }
                    }
                }

                if (requestId === parseRequestIdRef.current && parsedData) {
                    // Cache the result
                    parsedSheetCacheRef.current.set(cacheKey, parsedData);
                    parsedSnapshotRef.current = { parsedData, parsedCacheKey: cacheKey };

                    // Update data directly - isParsingData already controls the overlay
                    setData(parsedData);
                    if (sourceUrl && isElectron()) {
                        saveWorkbookCache(sourceUrl, workbook, {
                            fileName,
                            currentSheetName,
                            lastRefreshedAt: lastRefreshedAt || Date.now()
                        }, parsedData, cacheKey).catch((e) => {
                            console.warn('[SmartCache] 预解析缓存写入失败:', e);
                        });
                    }

                    // 🚀 Background pre-parse other sheets for instant switching
                    const preparseRowLimit = 20000;
                    const preparseCellLimit = 300000;
                    const estimatedCells = parsedData.rows.length * parsedData.columns.length;
                    const shouldPreparse = !isMultiSheetMode
                        && workbook.SheetNames
                        && workbook.SheetNames.length > 1
                        && parsedData.rows.length < preparseRowLimit
                        && estimatedCells < preparseCellLimit;

                    if (!shouldPreparse && !isMultiSheetMode && workbook.SheetNames && workbook.SheetNames.length > 1) {
                    }

                    if (shouldPreparse) {
                        const otherSheets = workbook.SheetNames.filter((name: string) => name !== currentSheetName);

                        // Use requestIdleCallback to parse in background without blocking
                        const preParseNext = (index: number) => {
                            if (index >= otherSheets.length) {
                                return;
                            }

                            const sheetName = otherSheets[index];
                            const preCacheKey = `single:${sheetName}`;

                            // Skip if already cached
                            if (parsedSheetCacheRef.current.has(preCacheKey)) {
                                preParseNext(index + 1);
                                return;
                            }

                            const sheet = workbook.Sheets?.[sheetName];
                            if (!sheet) {
                                preParseNext(index + 1);
                                return;
                            }

                            // Parse in idle time
                            const doPreParse = async () => {
                                try {
                                    const preData = await parseSheetAsync(workbook, sheetName, fileName, { chunkSize: 500 });
                                    if (preData) {
                                        parsedSheetCacheRef.current.set(preCacheKey, preData);
                                    }
                                } catch (e) {
                                    console.warn(`[SheetCache] Failed to pre-parse ${sheetName}:`, e);
                                }
                                // Continue with next sheet
                                if (typeof (window as any).requestIdleCallback === 'function') {
                                    (window as any).requestIdleCallback(() => preParseNext(index + 1), { timeout: 2000 });
                                } else {
                                    setTimeout(() => preParseNext(index + 1), 100);
                                }
                            };

                            if (typeof (window as any).requestIdleCallback === 'function') {
                                (window as any).requestIdleCallback(doPreParse, { timeout: 2000 });
                            } else {
                                setTimeout(doPreParse, 100);
                            }
                        };

                        // Start pre-parsing after a short delay to let UI settle
                        setTimeout(() => preParseNext(0), 500);
                    }
                } else if (requestId === parseRequestIdRef.current) {
                    setData(null);
                }
            } catch (e) {
                console.error("Failed to parse sheet", e);
                if (requestId === parseRequestIdRef.current) setData(null);
            } finally {
                if (requestId === parseRequestIdRef.current) {
                    setIsParsingData(false);
                    setIsRefreshing(false); // 同时关闭加载状态，确保无间隙
                }
            }
        };

        // 用 setTimeout 延迟执行，让 React 先渲染蒙版
        // 这样用户能看到"正在切换分页..."的提示
        setTimeout(() => parseWork(), 0);
    }, [workbook, currentSheetName, isMultiSheetMode, selectedSheets, fileName, getSheetCacheKey, sourceUrl, lastRefreshedAt]);

    // ==================== Deduplication Logic ====================
    const { filteredData, duplicateStats } = useMemo(() => {
        // If dedup is off, no column selected, or column doesn't exist in data, return original
        if (!data || !dedupColumn || dedupMode === 'off' || !data.columns.includes(dedupColumn)) {
            return { filteredData: data, duplicateStats: { total: 0, unique: 0, duplicates: 0 } };
        }

        const seen = new Map<string, number[]>(); // value -> row indices
        const rows = data.rows;

        // First pass: group rows by the dedup column value
        rows.forEach((row, index) => {
            const value = String(row[dedupColumn] || '').trim().toLowerCase();
            if (!seen.has(value)) {
                seen.set(value, []);
            }
            seen.get(value)!.push(index);
        });

        // Identify which rows are duplicates
        const duplicateIndices = new Set<number>();
        const firstOccurrenceIndices = new Set<number>();
        let duplicateCount = 0;

        seen.forEach((indices) => {
            if (indices.length > 1) {
                duplicateCount += indices.length;
                firstOccurrenceIndices.add(indices[0]); // Keep first occurrence
                indices.slice(1).forEach(i => duplicateIndices.add(i)); // Mark rest as duplicates
            } else {
                firstOccurrenceIndices.add(indices[0]);
            }
        });

        let filteredRows;
        if (dedupMode === 'remove') {
            // Remove duplicates, keep only first occurrence
            filteredRows = rows.filter((_, index) => !duplicateIndices.has(index));
        } else if (dedupMode === 'show') {
            // Show only rows that have duplicates (including first occurrence)
            const allDuplicateValues = new Set<string>();
            seen.forEach((indices, value) => {
                if (indices.length > 1) {
                    allDuplicateValues.add(value);
                }
            });
            // Sort by the dedup column value to group duplicates together
            filteredRows = rows
                .filter(row => {
                    const value = String(row[dedupColumn] || '').trim().toLowerCase();
                    return allDuplicateValues.has(value);
                })
                .sort((a, b) => {
                    const valA = String(a[dedupColumn] || '').trim().toLowerCase();
                    const valB = String(b[dedupColumn] || '').trim().toLowerCase();
                    return valA.localeCompare(valB);
                });
        } else {
            filteredRows = rows;
        }

        return {
            filteredData: { ...data, rows: filteredRows },
            duplicateStats: {
                total: rows.length,
                unique: seen.size,
                duplicates: duplicateCount
            }
        };
    }, [data, dedupColumn, dedupMode]);

    // ==================== Transpose Data Logic ====================
    // This is used to show correct columns in UnifiedSettingsPanel when transpose is enabled
    // Simple transpose: first column values become column headers, each other column becomes a row
    // Merge mode: columns with same base name are merged (e.g., [1.玛丽亚] and [2.主耶稣] become one)
    const transposedDataForSettings = useMemo(() => {
        if (!filteredData || !activeConfig.transposeData) {
            return filteredData;
        }

        if (!filteredData.rows || filteredData.rows.length === 0) return filteredData;

        type DataRow = Record<string, unknown>;

        // Get raw column names from first column
        const rawColumns = filteredData.rows.map(row => String(row[filteredData.columns[0]] || ''));

        // Check if merge mode is enabled
        if (activeConfig.mergeTransposeColumns) {
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
            // e.g., { "贴文多媒体": [0, 3], "贴文点赞量": [1, 4], ... }
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
            for (let colIdx = 1; colIdx < filteredData.columns.length; colIdx++) {
                for (let accountIdx = 0; accountIdx < accountCount; accountIdx++) {
                    const newRow: DataRow = {};

                    // For each unique column, get the value from the corresponding account
                    for (const colName of uniqueColumns) {
                        const rowIndices = columnRowIndices.get(colName) || [];
                        if (accountIdx < rowIndices.length) {
                            const originalRowIdx = rowIndices[accountIdx];
                            const value = filteredData.rows[originalRowIdx][filteredData.columns[colIdx]];
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
                ...filteredData,
                columns: uniqueColumns,
                rows: newRows
            };
        } else {
            // === SIMPLE MODE: No merging, keep original column names ===

            const newRows: DataRow[] = [];
            for (let colIdx = 1; colIdx < filteredData.columns.length; colIdx++) {
                const newRow: DataRow = {};
                filteredData.rows.forEach((originalRow, rowIdx) => {
                    const colName = rawColumns[rowIdx];
                    if (colName) {
                        newRow[colName] = originalRow[filteredData.columns[colIdx]];
                    }
                });
                newRows.push(newRow);
            }

            return {
                ...filteredData,
                columns: rawColumns,
                rows: newRows
            };
        }
    }, [filteredData, activeConfig.transposeData, activeConfig.mergeTransposeColumns]);

    const handleRefresh = async () => {
        if (!sourceUrl) return;
        if (sourceUrl.startsWith('local://')) {
            alert('本地数据无需刷新');
            return;
        }
        setIsRefreshing(true);
        setLoadProgress('正在准备刷新...');

        // Find source config to check for selected sheets
        const sources = loadDataSources();
        const currentSource = sources.find(s => s.url === sourceUrl);
        const selectedSheets = currentSource?.selectedSheets;

        try {
            // 使用智能加载（优先 API Key，公开表格不需登录）
            const accessToken = getGoogleAccessToken();
            const newWb = await fetchWorkbookSmart(sourceUrl, accessToken, (msg) => {
                setLoadProgress(msg);
            }, selectedSheets);

            // Protect against empty workbook
            if (!newWb.SheetNames || newWb.SheetNames.length === 0) {
                throw new Error('加载的工作簿没有包含任何工作表。请检查分页选择设置。');
            }

            setWorkbook(newWb);
            if (!newWb.SheetNames.includes(currentSheetName)) {
                setCurrentSheetName(newWb.SheetNames[0]);
            }
            setLastRefreshedAt(Date.now()); // Track refresh time
            setLoadProgress(null);
        } catch (e) {
            setLoadProgress(null);
            const errorMsg = e instanceof Error ? e.message : '刷新失败';
            alert(errorMsg);
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleReset = () => {
        setShowCloseConfirm(true);
    };

    const confirmReset = () => {
        setWorkbook(null);
        setData(null);
        setSourceUrl(undefined);
        setFileName("");
        setSnapshots([]);
        setIsSidebarOpen(false);
        setShowCloseConfirm(false);
        setView('grid'); // 重置视图到默认，避免卡在对齐工具界面
    };

    // Snapshot Actions
    const handleAddSnapshot = useCallback((snapshot: ChartSnapshot) => {
        setSnapshots(prev => [snapshot, ...prev]);
        setSidebarTab('gallery');
        setIsSidebarOpen(true);
    }, []);

    const handleDeleteSnapshot = (id: string) => {
        setSnapshots(prev => prev.filter(s => s.id !== id));
    };

    // Listen for paste events in append modal to capture HTML format from Google Sheets
    useEffect(() => {
        if (!showAppendModal) return;

        const handleAppendPaste = async (e: ClipboardEvent) => {
            if (document.activeElement !== appendTextareaRef.current) return;

            const clipboardData = e.clipboardData;
            if (!clipboardData) return;

            const htmlData = clipboardData.getData('text/html');

            if (htmlData && htmlData.includes('google-sheets-html-origin')) {
                e.preventDefault();
                setAppendHtmlContent(htmlData);
                setAppendPasteContent('[Google Sheets 数据已加载，点击“追加数据”继续]');
            }
        };

        document.addEventListener('paste', handleAppendPaste);
        return () => document.removeEventListener('paste', handleAppendPaste);
    }, [showAppendModal]);

    // Handle append data from paste
    const handleAppendData = useCallback(async () => {
        if ((!appendPasteContent.trim() && !appendHtmlContent) || !data) return;

        setAppendLoading(true);
        try {
            // Import parser functions
            const { readWorkbookFromString, readWorkbookFromHtml } = await import('./utils/parser');

            // Use HTML parsing if we have Google Sheets HTML, otherwise use string parsing
            let wb;
            if (appendHtmlContent) {
                wb = await readWorkbookFromHtml(appendHtmlContent);
            } else {
                wb = await readWorkbookFromString(appendPasteContent);
            }

            // Parse the first sheet using the same method
            const sheetName = wb.SheetNames[0];
            const parsedData = await parseSheetAsync(wb, sheetName, '追加数据', { chunkSize: 1000 });

            if (!parsedData || parsedData.rows.length === 0) {
                alert('没有解析到有效数据');
                return;
            }


            // Merge with existing data - match by column name
            const existingColumns = data.columns;
            const pastedColumns = parsedData.columns;

            // Find matching and new columns
            const matchedColumns = pastedColumns.filter(h => existingColumns.includes(h));
            const newColumns = pastedColumns.filter(h => !existingColumns.includes(h) && h);

            // Create merged column list
            const allColumns = [...existingColumns, ...newColumns];

            // Map pasted rows to use all columns
            const newRows = parsedData.rows.map(row => {
                const newRow: Record<string, string | number | boolean | null> = {};
                allColumns.forEach(col => {
                    // Use the value from pasted row if available, otherwise empty string
                    newRow[col] = row[col] !== undefined ? row[col] : '';
                });
                return newRow;
            });

            // Update data
            setData({
                ...data,
                columns: allColumns,
                rows: [...data.rows, ...newRows]
            });

            setShowAppendModal(false);
            setAppendPasteContent('');

            const matchInfo = matchedColumns.length > 0
                ? `匹配 ${matchedColumns.length} 列`
                : '无匹配列';
            const newColInfo = newColumns.length > 0
                ? `，新增 ${newColumns.length} 列`
                : '';
            alert(`✅ 成功追加 ${newRows.length} 行数据！（${matchInfo}${newColInfo}）`);
        } catch (err) {
            console.error('Append data error:', err);
            alert('解析数据失败，请确保是从表格复制的数据');
        } finally {
            setAppendLoading(false);
            setAppendHtmlContent(null);
        }
    }, [appendPasteContent, appendHtmlContent, data]);

    const handleUpdateSnapshotType = (id: string, newType: ChartType) => {
        setSnapshots(prev => prev.map(s => s.id === id ? { ...s, type: newType } : s));
    };

    const applyCachedWorkbook = useCallback((cached: {
        workbook: Workbook;
        fileName?: string;
        currentSheetName?: string;
        lastRefreshedAt?: number;
        parsedData?: unknown;
        parsedCacheKey?: string;
        sourceUrl?: string;
    }, fallbackName?: string) => {
        const nextWorkbook = cached.workbook;
        if (!nextWorkbook) return;

        const nextSheetName = cached.currentSheetName || nextWorkbook.SheetNames?.[0] || '';

        setSourceUrl(cached.sourceUrl || sourceUrl);
        setFileName(cached.fileName || fallbackName || '');
        setWorkbook(nextWorkbook);
        setCurrentSheetName(nextSheetName);
        setLastRefreshedAt(cached.lastRefreshedAt || Date.now());
        let nextSelectedSheets = new Set<string>();
        let nextIsMulti = false;

        if (cached.parsedData) {
            let cacheKey = cached.parsedCacheKey;
            if (!cacheKey) {
                const sheetNames = (nextWorkbook.SheetNames || []) as string[];
                cacheKey = `multi:${sheetNames.sort().join(',')}`;
            }
            if (cacheKey) {
                if (cacheKey.startsWith('multi:')) {
                    nextIsMulti = true;
                    const names = cacheKey.replace('multi:', '').split(',').filter(Boolean);
                    nextSelectedSheets = new Set(names);
                }
                parsedSheetCacheRef.current.set(cacheKey, cached.parsedData as SheetData);
                parsedSnapshotRef.current = { parsedData: cached.parsedData as SheetData, parsedCacheKey: cacheKey };
                setData(cached.parsedData as SheetData);
            }
        }

        setIsMultiSheetMode(nextIsMulti);
        setSelectedSheets(nextSelectedSheets);
    }, [sourceUrl]);

    // Update the ref so switchDataSourceTab can use it
    useEffect(() => {
        applyCachedWorkbookRef.current = applyCachedWorkbook;
    }, [applyCachedWorkbook]);

    useEffect(() => {
        if (isElectron()) return;
        if (!sourceUrl || workbook) return;

        const restoreFromCache = async () => {
            try {
                setIsRefreshing(true);
                setLoadProgress('📂 读取本地缓存...');
                const cached = await loadWorkbookCache(sourceUrl);
                if (cached.success && cached.data) {
                    applyCachedWorkbook({ ...cached.data, sourceUrl });
                }
            } catch (e) {
                console.warn('[SmartCache] 本地缓存恢复失败:', e);
            } finally {
                setLoadProgress(null);
                setIsRefreshing(false);
            }
        };

        restoreFromCache();
    }, [applyCachedWorkbook, sourceUrl, workbook]);

    // Handle selecting a data source from the manager
    const handleSelectDataSource = async (source: DataSource) => {
        const requestId = ++loadRequestIdRef.current;

        // 设置加载状态，蒙版会覆盖在现有数据上
        // 不清除旧数据，这样不会跳回首页
        setIsRefreshing(true);
        setLoadProgress('正在加载数据源...');

        try {
            const isLocalSource = source.type !== 'google-sheets' || source.url.startsWith('local://');

            if (isLocalSource) {
                setLoadProgress('📂 读取本地缓存...');
                const cacheResult = await loadWorkbookCache(source.url, source.id);

                if (requestId !== loadRequestIdRef.current) return;

                if (cacheResult.success && cacheResult.data) {
                    applyCachedWorkbook({ ...cacheResult.data, sourceUrl: source.url }, source.name);
                    setLoadProgress(null);
                    setIsRefreshing(false);
                    return;
                }

                setLoadProgress(null);
                setIsRefreshing(false);
                alert('未找到本地缓存，请重新导入该数据源。');
                return;
            }

            setLoadProgress('📂 检查本地缓存...');
            const cacheResult = await loadWorkbookCache(source.url, source.id);

            if (requestId !== loadRequestIdRef.current) return;
            if (cacheResult.success && cacheResult.data) {
                const cached = cacheResult.data;
                const hasParsedData = !!cached.parsedData;
                setLoadProgress(hasParsedData ? '⚡ 秒读（含解析数据）...' : '⚡ 从本地缓存秒读...');

                applyCachedWorkbook({ ...cached, sourceUrl: source.url }, source.name);
                setLoadProgress(null);
                setIsRefreshing(false);

                // 后台刷新链接，避免阻塞当前显示
                void (async () => {
                    try {
                        const accessToken = getGoogleAccessToken();
                        const refreshedWb = await fetchWorkbookSmart(source.url, accessToken, () => { }, source.selectedSheets);
                        if (requestId !== loadRequestIdRef.current) return;
                        if (!refreshedWb.SheetNames || refreshedWb.SheetNames.length === 0) return;
                        setWorkbook(refreshedWb);
                        setCurrentSheetName(refreshedWb.SheetNames[0]);
                        setLastRefreshedAt(Date.now());
                        setIsMultiSheetMode(false);
                        setSelectedSheets(new Set());
                    } catch (e) {
                        console.warn('[SmartCache] 后台刷新失败:', e);
                    }
                })();

                return; // 直接返回，不需要阻塞网络请求
            } else {
                setLoadProgress('🌐 缓存未命中，从云端加载...');
            }

            // 无缓存或非 Electron：使用智能加载（优先 API Key，公开表格不需登录）
            const accessToken = getGoogleAccessToken();
            const newWb = await fetchWorkbookSmart(source.url, accessToken, (msg) => {
                if (requestId === loadRequestIdRef.current) {
                    setLoadProgress(msg);
                }
            }, source.selectedSheets);

            if (requestId !== loadRequestIdRef.current) return;
            // Protect against empty workbook
            if (!newWb.SheetNames || newWb.SheetNames.length === 0) {
                throw new Error('加载的工作簿没有包含任何工作表。请检查分页选择设置。');
            }

            // Only update state AFTER successful load
            setSourceUrl(source.url);
            setFileName(source.name);
            setWorkbook(newWb);
            setCurrentSheetName(newWb.SheetNames[0]);
            setLastRefreshedAt(Date.now()); // Track refresh time
            setIsMultiSheetMode(false);
            setSelectedSheets(new Set());
            setLoadProgress(null);
            // 注意：不在这里设置 setIsRefreshing(false)
            // 让解析 useEffect 接管加载状态，避免蒙版闪烁
        } catch (e) {
            if (requestId !== loadRequestIdRef.current) return;
            setLoadProgress(null);
            const errorMsg = e instanceof Error ? e.message : '加载失败';

            // Check if it's an auth error - expand detection for common token expiry symptoms
            const isAuthError = errorMsg.includes('token') ||
                errorMsg.includes('授权') ||
                errorMsg.includes('认证') ||
                errorMsg.includes('401') ||
                errorMsg.includes('403') ||
                errorMsg.includes('登录') ||
                errorMsg.includes('expired') ||
                errorMsg.includes('invalid') ||
                errorMsg.includes('无法加载表格') ||  // Common symptom of expired token
                errorMsg.includes('Failed to fetch') ||  // Network/auth issue
                errorMsg.includes('UNAUTHENTICATED');

            // Always suggest re-login first as token expiry is the most common cause
            alert(`⚠️ 加载数据源失败\n\n最常见原因：Google 登录已过期（token 每1小时会自动失效）\n\n👉 请先尝试：点击右上角登录按钮重新登录 Google 账号\n\n如果重新登录后仍然失败，请检查：\n1. 网络连接是否正常\n2. 表格权限是否为「知道链接的任何人可查看」\n\n错误详情: ${errorMsg}`);

            // Keep the previous state (no need to rollback since we didn't change it yet)
            setIsRefreshing(false); // 只在出错时关闭
        }
        // 成功时不设置 isRefreshing = false
        // 让解析 useEffect 接管，因为它会设置 isParsingData = true
        // 解析完成后才会隐藏蒙版
    };

    const handleDataSourcesChanged = useCallback((latestSources: DataSource[]) => {
        const nextTabs = dataSourceTabs.filter(tab => {
            if (!tab.sourceUrl) return true;
            return latestSources.some(source => source.url === tab.sourceUrl);
        });

        if (nextTabs.length === dataSourceTabs.length) return;

        setDataSourceTabs(nextTabs);

        if (!activeDataSourceTabId || nextTabs.some(tab => tab.id === activeDataSourceTabId)) return;

        const fallbackTab = nextTabs[0];
        if (fallbackTab) {
            void switchDataSourceTab(fallbackTab.id, { skipSave: true });
        } else {
            setActiveDataSourceTabId(null);
        }
    }, [dataSourceTabs, activeDataSourceTabId, switchDataSourceTab]);

    // --- RENDER ---

    return (
        <div className="h-full w-full flex flex-col bg-slate-100 overflow-hidden sheetmind-app">

            {/* Unified Header */}
            <div className="shrink-0 border-b border-slate-200 bg-white shadow-sm z-50 relative">
                <div className="custom-scrollbar overflow-x-auto">
                    <div className="h-[42px] w-full min-w-full flex items-center relative pl-2 pr-2">

                {/* 1. App Logo (Always Visible) */}
                <div className="flex items-center shrink-0 mr-2 border-r border-slate-200 pr-2 py-1">
                    <div className="bg-green-600 p-0.5 rounded shadow-sm mr-1.5 flex items-center justify-center">
                        <Table className="text-white" size={14} />
                    </div>
                    <h1 className="font-bold text-sm text-slate-700 tracking-tight hidden sm:block">SheetMind</h1>
                </div>

                {/* 顶层功能切换：四个入口 */}
                <div className="flex items-center gap-0.5 shrink-0 mr-2 border-r border-slate-200 pr-2">
                    <button
                        onClick={() => setView(lastMediaViewRef.current)}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${isMediaToolMode ? 'bg-slate-200 text-slate-800' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                        媒体工具
                    </button>
                    <button
                        onClick={() => setView('align')}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${view === 'align' ? 'bg-teal-100 text-teal-800' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                        对齐工具
                    </button>
                    <button
                        onClick={() => setView('image-formula')}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${view === 'image-formula' ? 'bg-sky-100 text-sky-800' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                        图片转公式工具
                    </button>
                    <button
                        onClick={() => setView('reference-library')}
                        className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors ${view === 'reference-library' ? 'bg-indigo-100 text-indigo-800' : 'text-slate-600 hover:bg-slate-100'}`}
                    >
                        参考库工具
                    </button>
                </div>

                {/* 2. Data Source Tabs */}
                {isMediaToolMode && dataSourceTabs.length > 0 && (
                    <div className="flex items-center gap-1 shrink-0 mr-2 border-r border-slate-200 pr-2">
                        {dataSourceTabs.map(dsTab => (
                            <div
                                key={dsTab.id}
                                className={`group relative flex items-center gap-1 px-3 py-1.5 min-w-[120px] max-w-[200px]  text-xs font-medium cursor-pointer transition-all shrink-0 border border-transparent ${activeDataSourceTabId === dsTab.id
                                    ? 'bg-white text-slate-800 shadow-[0_-2px_4px_rgba(0,0,0,0.05)] border-slate-300 border-b-white z-10 '
                                    : 'bg-transparent text-slate-500 hover:bg-slate-300 hover:text-slate-800'
                                    }`}
                            >
                                {editingDsTabId === dsTab.id ? (
                                    <input
                                        type="text"
                                        defaultValue={dsTab.name}
                                        autoFocus
                                        className="text-xs font-medium w-full px-1 rounded border border-blue-400 bg-white text-slate-800 outline-none"
                                        onBlur={(e) => {
                                            if (editingDsTabId === dsTab.id) {
                                                handleSaveDsTabName(dsTab.id, e.target.value);
                                            }
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter') {
                                                e.currentTarget.blur();
                                            } else if (e.key === 'Escape') {
                                                setEditingDsTabId(null);
                                            }
                                        }}
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <button
                                        onClick={() => switchDataSourceTab(dsTab.id)}
                                        onDoubleClick={() => setEditingDsTabId(dsTab.id)}
                                        className="flex-1 text-left truncate tooltip-bottom"
                                        data-tip={dsTab.sourceUrl ? `${dsTab.name}\n${dsTab.sourceUrl}` : dsTab.name}
                                    >
                                        {dsTab.name}
                                    </button>
                                )}
                                {dataSourceTabs.length > 1 && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteDataSourceTab(dsTab.id);
                                        }}
                                        className={`p-0.5 rounded-full opacity-70 group-hover:opacity-100 transition-opacity ${activeDataSourceTabId === dsTab.id ? 'hover:bg-slate-200 text-slate-500' : 'hover:bg-slate-400 text-slate-400'
                                            }`}
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                        ))}
                        <button
                            onClick={handleAddDataSourceTab}
                            className="p-1.5 ml-1  rounded-full hover:bg-slate-300 text-slate-500 hover:text-slate-700 transition-colors shrink-0 tooltip-bottom"
                            data-tip="打开新数据源"
                        >
                            <Plus size={14} />
                        </button>
                        <button
                            onClick={() => setShowDataSourceManager(true)}
                            className="p-1.5 rounded-md hover:bg-slate-300 text-slate-500 hover:text-slate-700 transition-colors shrink-0 tooltip-bottom ml-1 "
                            data-tip="数据源管理器"
                        >
                            <FolderOpen size={14} />
                        </button>
                        {data && (
                            <button
                                onClick={() => setShowAppendModal(true)}
                                className="p-1.5 ml-1 text-slate-500 hover:text-purple-600 hover:bg-purple-100 rounded-md transition-colors flex items-center gap-1 text-xs tooltip-bottom shrink-0 border border-purple-200 bg-purple-50"
                                data-tip="追加粘贴结构相同的数据"
                            >
                                <Plus size={14} />
                                <span className="font-medium whitespace-nowrap">追加数据</span>
                            </button>
                        )}
                        {/* Add some space or flex-1 to push the rest */}
                    </div>
                )}

                {/* 3. Workbook Controls (Refresh, Reset, Address bar, Settings, Append) */}
                {isMediaToolMode && workbook && (

                    <div className="flex items-center gap-2 flex-1 min-w-max">

                        {/* 刷新/导航按钮 */}
                        <div className="flex items-center gap-0.5 pl-1 shrink-0">
                            {sourceUrl && (
                                <button
                                    onClick={handleRefresh}
                                    disabled={isRefreshing}
                                    className={`p-1.5 text-slate-600 hover:bg-slate-100 rounded-full transition-colors tooltip-bottom ${isRefreshing ? 'animate-spin' : ''}`}
                                    data-tip="刷新"
                                >
                                    <RotateCw size={16} />
                                </button>
                            )}
                            <button
                                onClick={handleReset}
                                className="p-1.5 text-slate-600 hover:bg-red-50 hover:text-red-500 rounded-full transition-colors tooltip-bottom"
                                data-tip="关闭工作簿"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        {/* Address Bar Equivalent (Sheet Selector & View Switcher) */}
                        <div className="flex items-center bg-slate-100/80 hover:bg-slate-100 focus-within:bg-white focus-within:shadow-[0_0_0_1px_#cbd5e1] rounded-full px-1.5 py-1 min-w-[300px] mx-2 transition-all border border-transparent shrink-0">

                            {/* Sheet Selector (Domain part) */}
                            <div className="relative border-r border-slate-300 pr-2 py-0.5 shrink-0" onClick={(e) => e.stopPropagation()}>
                                <button
                                    ref={sheetSelectorBtnRef}
                                    onClick={() => setSheetSelectorOpen(!sheetSelectorOpen)}
                                    className={`flex items-center gap-1.5 px-2 py-0.5 text-xs font-semibold rounded-full transition-colors tooltip-bottom ${isMultiSheetMode
                                        ? 'text-purple-700 bg-purple-100/50 hover:bg-purple-100'
                                        : 'text-slate-700 hover:bg-slate-200'
                                        }`}
                                    data-tip="切换工作表"
                                >
                                    {isParsingData && (
                                        <Loader2 size={12} className="animate-spin text-blue-500" />
                                    )}
                                    {isMultiSheetMode ? (
                                        <>
                                            <Layers size={14} className="text-purple-600" />
                                            <span className="max-w-[100px] truncate">合并 {selectedSheets.size} 个</span>
                                        </>

                                    ) : (

                                        <>
                                            <span className="max-w-[150px] truncate">{currentSheetName}</span>
                                        </>
                                    )}
                                </button>
                                {/* Sheet Selection Dropdown - uses fixed positioning to escape overflow-x-auto clipping */}
                                {sheetSelectorOpen && (() => {
                                    const rect = sheetSelectorBtnRef.current?.getBoundingClientRect();
                                    return (
                                    <div
                                        className="fixed w-64 bg-white rounded-xl shadow-xl border border-slate-200 z-[9999] overflow-hidden"
                                        style={rect ? { top: rect.bottom + 4, left: rect.left } : {}}
                                        onClick={(e) => e.stopPropagation()}
                                    >
                                        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50">
                                            <label className="flex items-center justify-between cursor-pointer">
                                                <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                                                    <Layers size={14} />
                                                    合并多分页显示
                                                </span>
                                                <button
                                                    onClick={() => {
                                                        setIsMultiSheetMode(!isMultiSheetMode);
                                                        if (!isMultiSheetMode) {
                                                            setSelectedSheets(new Set([currentSheetName]));
                                                        }
                                                    }}
                                                    className={`relative w-8 h-4 rounded-full transition-colors ${isMultiSheetMode ? 'bg-purple-600' : 'bg-slate-300'}`}
                                                >
                                                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${isMultiSheetMode ? 'left-4.5' : 'left-0.5'}`} />
                                                </button>
                                            </label>
                                        </div>
                                        <div className="max-h-48 overflow-y-auto py-1">
                                            {workbook.SheetNames.map((name: string) => (
                                                <button
                                                    key={name}
                                                    onClick={() => {
                                                        if (isMultiSheetMode) {
                                                            const newSet = new Set(selectedSheets);
                                                            if (newSet.has(name)) newSet.delete(name); else newSet.add(name);
                                                            setSelectedSheets(newSet);
                                                        } else {
                                                            setCurrentSheetName(name);
                                                            setSheetSelectorOpen(false);
                                                        }
                                                    }}
                                                    className={`w-full px-3 py-1.5 text-left text-xs flex items-center gap-2 hover:bg-slate-100 transition-colors ${isMultiSheetMode
                                                        ? selectedSheets.has(name) ? 'bg-purple-50 text-purple-700' : 'text-slate-700'
                                                        : currentSheetName === name ? 'bg-blue-50 text-blue-700 font-medium' : 'text-slate-700'
                                                        }`}
                                                >
                                                    {isMultiSheetMode ? (
                                                        <div className={`w-3.5 h-3.5 rounded border flex items-center justify-center ${selectedSheets.has(name)
                                                            ? 'bg-purple-500 border-purple-500 text-white'
                                                            : 'border-slate-300'
                                                            }`}>
                                                            {selectedSheets.has(name) && <Check size={10} />}
                                                        </div>
                                                    ) : (
                                                        currentSheetName === name && <Check size={12} className="text-blue-500" />
                                                    )}
                                                    <span className="truncate flex-1">{name}</span>
                                                </button>
                                            ))}
                                        </div>
                                        {/* 设置导入分页 - only for Google Sheets sources */}
                                        {sourceUrl && sourceUrl.includes('docs.google.com/spreadsheets') && (
                                            <div className="border-t border-slate-100 px-3 py-1.5">
                                                <button
                                                    onClick={() => {
                                                        setSheetSelectorOpen(false);
                                                        setShowDataSourceManager(true);
                                                    }}
                                                    className="w-full flex items-center gap-1.5 text-xs text-slate-500 hover:text-blue-600 hover:bg-blue-50 rounded px-1.5 py-1 transition-colors"
                                                >
                                                    <Settings size={12} />
                                                    设置导入分页...
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                    );
                                })()}
                            </div>

                            {/* View Switcher (Path part) */}
                            <div className="flex items-center gap-1.5 px-2 py-0.5 shrink-0 whitespace-nowrap">
                                <div className="hidden lg:flex items-center px-1.5 text-[10px] font-medium text-slate-500">视图</div>
                                <div className="flex items-center gap-0.5 px-1 py-0.5 rounded-[10px] border border-slate-200 bg-slate-100/85">
                                <button
                                    onClick={() => setView('grid')}
                                    className={`px-3 py-1 text-xs font-medium rounded-[10px] transition-colors flex items-center gap-1.5 tooltip-bottom ${view === 'grid' ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] text-slate-800' : 'text-slate-600 hover:bg-slate-200/50'}`}
                                    data-tip="网格视图"
                                >
                                    <Table size={14} /> <span className="hidden sm:inline">网格</span>
                                </button>
                                <button
                                    onClick={() => setView('dashboard')}
                                    className={`px-3 py-1 text-xs font-medium rounded-[10px] transition-colors flex items-center gap-1.5 tooltip-bottom ${view === 'dashboard' ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] text-slate-800' : 'text-slate-600 hover:bg-slate-200/50'}`}
                                    data-tip="仪表盘"
                                >
                                    <BarChart4 size={14} /> <span className="hidden sm:inline">仪表盘</span>
                                </button>
                                <button
                                    onClick={() => setView('transpose')}
                                    className={`px-3 py-1 text-xs font-medium rounded-[10px] transition-colors flex items-center gap-1.5 tooltip-bottom ${view === 'transpose' ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] text-slate-800' : 'text-slate-600 hover:bg-slate-200/50'}`}
                                    data-tip="转置视图"
                                >
                                    <ArrowRightLeft size={14} /> <span className="hidden sm:inline">转置</span>
                                </button>
                                <button
                                    onClick={() => setView('gallery')}
                                    className={`px-3 py-1 text-xs font-medium rounded-[10px] transition-colors flex items-center gap-1.5 tooltip-bottom ${view === 'gallery' ? 'bg-white shadow-[0_1px_2px_rgba(0,0,0,0.08)] text-slate-800' : 'text-slate-600 hover:bg-slate-200/50'}`}
                                    data-tip="画廊"
                                >
                                    <Image size={14} /> <span className="hidden sm:inline">画廊</span>
                                </button>
                                </div>
                                {/* Inner Gallery Tabs inline with view switcher */}
                                {view === 'gallery' && (
                                    <>
                                        <div className="w-px h-4 bg-slate-300 mx-1 shrink-0"></div>
                                        {galleryTabs.map(tab => (
                                            <div
                                                key={tab.id}
                                                className={`flex items-center gap-0.5 px-2 py-0.5 rounded-full border transition-all shrink-0 ${activeGalleryTabId === tab.id
                                                    ? 'bg-blue-100 text-blue-700 border-blue-200'
                                                    : 'bg-transparent text-slate-600 border-transparent hover:bg-slate-200/50'
                                                    }`}
                                            >
                                                {editingTabId === tab.id ? (
                                                    <input
                                                        type="text"
                                                        defaultValue={tab.name}
                                                        autoFocus
                                                        className="text-[11px] font-medium w-16 px-1 py-0 rounded border border-blue-300 bg-white text-slate-800 outline-none"
                                                        onBlur={(e) => {
                                                            if (editingTabId === tab.id) {
                                                                handleSaveTabName(tab.id, e.target.value);
                                                            }
                                                        }}
                                                        onKeyDown={(e) => {
                                                            if (e.key === 'Enter') {
                                                                e.currentTarget.blur();
                                                            } else if (e.key === 'Escape') {
                                                                setEditingTabId(null);
                                                            }
                                                        }}
                                                        onClick={(e) => e.stopPropagation()}
                                                    />
                                                ) : (
                                                    <button
                                                        onClick={() => switchGalleryTab(tab.id)}
                                                        onDoubleClick={() => handleRenameGalleryTab(tab.id)}
                                                        className="text-[11px] font-medium whitespace-nowrap tooltip-bottom"
                                                        data-tip="双击重命名"
                                                    >
                                                        {tab.name}
                                                    </button>
                                                )}
                                                {galleryTabs.length > 1 && (
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            handleDeleteGalleryTab(tab.id);
                                                        }}
                                                        className={`p-0.5 rounded-full ${activeGalleryTabId === tab.id ? 'hover:bg-blue-200 text-blue-500' : 'hover:bg-slate-300 text-slate-400'} tooltip-bottom`}
                                                        data-tip="关闭标签页"
                                                    >
                                                        <X size={10} />
                                                    </button>
                                                )}
                                            </div>
                                        ))}
                                        <div className="flex items-center gap-0.5 shrink-0">
                                            <button
                                                onClick={handleDuplicateGalleryTab}
                                                disabled={!activeGalleryTab}
                                                className="p-1 text-slate-500 hover:bg-slate-200/50 rounded-full disabled:opacity-50 tooltip-bottom"
                                                data-tip="复制配置"
                                            >
                                                <Copy size={12} />
                                            </button>
                                            <button
                                                onClick={handleAddGalleryTab}
                                                className="p-1 text-blue-600 hover:bg-blue-100 rounded-full tooltip-bottom"
                                                data-tip="新建配置"
                                            >
                                                <Plus size={12} />
                                            </button>
                                        </div>
                                    </>
                                )}
                            </div>
                        </div>

                        {/* Extension Icons (Right Side Actions) */}
                        <div className="flex items-center gap-1 shrink-0 ml-auto pr-1">
                            {/* Desktop mode indicator */}
                            {isElectron() && (
                                <span className="hidden lg:flex items-center gap-1 mr-1 text-[10px] text-emerald-700 bg-emerald-50 px-2 py-1 rounded-full border border-emerald-200">
                                    <HardDrive size={10} />
                                    桌面
                                </span>
                            )}

                            <div className="relative">
                                <button
                                    ref={settingsBtnRef}
                                    onClick={() => setShowUnifiedSettings(!showUnifiedSettings)}
                                    className={`p-1.5 rounded-full transition-colors flex items-center tooltip-bottom ${showUnifiedSettings
                                        ? 'bg-indigo-100 text-indigo-700 shadow-inner'
                                        : 'text-slate-600 hover:bg-slate-100'
                                        }`}
                                    data-tip="全局配置"
                                >
                                    <Settings size={18} />
                                </button>

                                {/* Dropdown Panel */}
                                <UnifiedSettingsPanel
                                    isOpen={showUnifiedSettings}
                                    onClose={() => setShowUnifiedSettings(false)}
                                    config={activeConfig}
                                    onConfigChange={updateActiveConfig}
                                    data={(transposedDataForSettings || { columns: [], rows: [] }) as SheetData}
                                    transposedData={activeConfig.transposeData ? (transposedDataForSettings as SheetData | undefined) : undefined}
                                    mode={view === 'transpose' ? 'transpose' : view === 'gallery' ? 'gallery' : 'both'}
                                    dedupColumn={dedupColumn}
                                    onDedupColumnChange={setDedupColumn}
                                    dedupMode={dedupMode}
                                    onDedupModeChange={setDedupMode}
                                    duplicateStats={duplicateStats}
                                    anchorRef={settingsBtnRef}
                                />
                            </div>

                            <button
                                onClick={() => setIsSidebarOpen(!isSidebarOpen)}
                                className={`p-1.5 rounded-full transition-colors flex items-center relative tooltip-bottom ${isSidebarOpen ? 'bg-blue-100 text-blue-700 shadow-inner' : 'text-slate-600 hover:bg-slate-100'}`}
                                data-tip={isSidebarOpen ? '关闭侧边助手' : '打开 AI 助手与报告'}
                            >
                                {isSidebarOpen ? <PanelRightClose size={18} /> : <PanelRightOpen size={18} />}
                                {!isSidebarOpen && snapshots.length > 0 && (
                                    <span className="flex h-3 w-3 items-center justify-center rounded-full bg-red-500 text-[8px] text-white absolute top-0 right-0 pointer-events-none ring-1 ring-white">
                                        {snapshots.length}
                                    </span>
                                )}
                            </button>
                        </div>
                    </div>
                )}
                    </div>
                </div>
            </div>

            {/* Main Content Area */}
            <div className="flex-1 flex overflow-hidden relative">

                {/* Center Canvas */}
                <main className="flex-1 flex flex-col min-w-0 bg-slate-100 overflow-hidden relative z-0 transition-all duration-300">

                    {/* 列对齐工具可以独立使用，无需加载数据 */}
                    {view === 'align' ? (
                        <div className="flex-1 p-4 lg:p-6 overflow-hidden flex flex-col min-w-0 relative">
                            <ColumnAlignPanel getAiInstance={getAiInstance} onBack={() => setView(data ? 'grid' : 'grid')} />
                        </div>
                    ) : view === 'image-formula' ? (
                        <div className="flex-1 p-4 lg:p-6 overflow-hidden flex flex-col min-w-0 relative">
                            <ImageFormulaPanel onBack={() => setView(data ? 'grid' : 'grid')} />
                        </div>
                    ) : view === 'reference-library' ? (
                        <div className="flex-1 overflow-hidden flex flex-col min-w-0 relative">
                            <ReferenceLibraryPanel onBack={() => setView(data ? 'grid' : 'grid')} />
                        </div>
                    ) : !data ? (
                        <div className="flex-1 flex flex-col items-center pt-8 p-8 overflow-y-auto bg-slate-50">
                            <div className="max-w-4xl w-full">
                                {/* Show reload prompt for large data */}
                                {needsReload && sourceUrl && (
                                    <div className="bg-amber-50 border border-amber-200 rounded-xl p-6 mb-8 text-center">
                                        <h3 className="text-lg font-bold text-amber-800 mb-2 flex items-center justify-center gap-2"><BarChart2 size={20} /> 上次加载的大数据表格</h3>
                                        <p className="text-amber-700 text-sm mb-4">
                                            由于数据量较大，需要重新加载。点击下方按钮继续使用。
                                        </p>
                                        <p className="text-xs text-amber-600 mb-4 truncate max-w-md mx-auto">
                                            {fileName || sourceUrl}
                                        </p>
                                        <button
                                            onClick={() => {
                                                setNeedsReload(false);
                                                handleRefresh();
                                            }}
                                            disabled={isRefreshing}
                                            className="bg-amber-600 text-white px-6 py-2 rounded-lg hover:bg-amber-700 disabled:opacity-50 text-sm font-medium"
                                        >
                                            {isRefreshing ? '加载中...' : '重新加载数据'}
                                        </button>
                                        {loadProgress && (
                                            <p className="text-xs text-amber-600 mt-3">{loadProgress}</p>
                                        )}
                                    </div>
                                )}
                                <div className="text-center mb-12">
                                    <h2 className="text-3xl font-extrabold text-slate-800 mb-4 tracking-tight">智能数据分析工作台</h2>
                                    <p className="text-slate-500 text-lg max-w-2xl mx-auto">
                                        一站式处理 Excel、CSV 和 Google Sheets。<br />
                                        集成 Gemini AI 引擎，提供自动清洗、公式解析、多模态图片分析与专业级可视化报表。
                                    </p>
                                </div>
                                <FileUpload onWorkbookLoaded={handleWorkbookLoaded} isLoading={isRefreshing} onSelectSource={handleSelectDataSource} />

                                {/* 列对齐工具快捷入口 */}
                                <div className="mt-8 pt-6 border-t border-slate-200 space-y-3">
                                    <button
                                        onClick={() => setView('align')}
                                        className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-indigo-50 to-purple-50 border border-indigo-100 rounded-xl hover:from-indigo-100 hover:to-purple-100 transition-all group"
                                    >
                                        <div className="bg-white p-2 rounded-lg shadow-sm group-hover:shadow-md transition-shadow">
                                            <MoveVertical className="w-5 h-5 text-indigo-600" />
                                        </div>
                                        <div className="text-left">
                                            <div className="font-semibold text-slate-700">列对齐工具</div>
                                            <div className="text-xs text-slate-500">修复翻译错位，自动匹配对应行（无需加载表格）</div>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => setView('image-formula')}
                                        className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-blue-50 to-cyan-50 border border-blue-100 rounded-xl hover:from-blue-100 hover:to-cyan-100 transition-all group"
                                    >
                                        <div className="bg-white p-2 rounded-lg shadow-sm group-hover:shadow-md transition-shadow">
                                            <Image className="w-5 h-5 text-blue-600" />
                                        </div>
                                        <div className="text-left">
                                            <div className="font-semibold text-slate-700">图片公式生成器</div>
                                            <div className="text-xs text-slate-500">批量图片链接转 =IMAGE() 公式，横版排列直接粘贴到 Google Sheets</div>
                                        </div>
                                    </button>
                                    <button
                                        onClick={() => setView('reference-library')}
                                        className="w-full flex items-center justify-center gap-3 px-6 py-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-100 rounded-xl hover:from-amber-100 hover:to-orange-100 transition-all group"
                                    >
                                        <div className="bg-white p-2 rounded-lg shadow-sm group-hover:shadow-md transition-shadow">
                                            <BookOpen className="w-5 h-5 text-amber-600" />
                                        </div>
                                        <div className="text-left">
                                            <div className="font-semibold text-slate-700">参考库</div>
                                            <div className="text-xs text-slate-500">从 Google Sheets 加载图片/生成词/参考数据，画廊模式浏览</div>
                                        </div>
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div className={`flex-1 overflow-hidden flex flex-col min-w-0 relative ${view === 'gallery' ? 'p-0' : 'p-4 lg:p-6'}`}>
                            {view === 'grid' && <DataGrid data={filteredData!} />}
                            {view === 'dashboard' && <Dashboard data={filteredData!} onAddSnapshot={handleAddSnapshot} />}
                            {view === 'transpose' && <TransposePanel data={(transposedDataForSettings!) as SheetData} sharedConfig={deferredSharedConfig} />}
                            {view === 'gallery' && (
                                <MediaGalleryPanel
                                    data={filteredData!}
                                    sourceUrl={sourceUrl}
                                    currentSheetName={currentSheetName}
                                    isLoading={isRefreshing || isParsingData}
                                    sharedConfig={activeConfig}
                                />
                            )}
                            {/* Note: 'align' view is handled in the parent conditional, not here */}
                            {view !== 'gallery' && (isRefreshing || isParsingData) && (
                                <div className="absolute inset-0 bg-white/70 backdrop-blur-[1px] flex items-center justify-center z-40">
                                    <div className="flex items-center gap-2 px-3 py-2 bg-white rounded-lg shadow-md border border-slate-200 text-slate-600 text-sm">
                                        <Loader2 size={16} className="animate-spin text-blue-500" />
                                        <span>{isRefreshing ? '正在加载数据源...' : '正在切换分页...'}</span>
                                    </div>
                                </div>
                            )}
                        </div>
                    )}
                </main>

                {/* Collapsible Sidebar (Push Layout) */}
                {data && (
                    <aside
                        className={`
                    bg-white border-l border-slate-200 shadow-xl overflow-hidden
                    transition-all duration-300 ease-in-out flex flex-col
                    ${isSidebarOpen ? 'w-full sm:w-[400px] translate-x-0' : 'w-0 translate-x-full border-none opacity-0'}
                `}
                    >
                        {/* Sidebar Header / Tabs */}
                        <div className="flex border-b border-slate-200 bg-slate-50 shrink-0 min-w-[300px]">
                            <button
                                onClick={() => setSidebarTab('chat')}
                                className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-colors ${sidebarTab === 'chat' ? 'border-purple-600 text-purple-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'
                                    }`}
                            >
                                <MessageSquare size={16} /> AI 助手
                            </button>
                            <button
                                onClick={() => setSidebarTab('gallery')}
                                className={`flex-1 py-3 text-sm font-medium flex items-center justify-center gap-2 border-b-2 transition-colors ${sidebarTab === 'gallery' ? 'border-blue-600 text-blue-700 bg-white' : 'border-transparent text-slate-500 hover:text-slate-700'
                                    }`}
                            >
                                <GalleryHorizontalEnd size={16} /> 报告画廊
                                {snapshots.length > 0 && <span className="bg-slate-200 text-slate-600 text-[10px] px-1.5 py-0.5 rounded-full">{snapshots.length}</span>}
                                {snapshotsSyncing ? (
                                    <Loader2 size={12} className="animate-spin text-blue-500" />
                                ) : isUserLoggedIn() && snapshots.length > 0 ? (
                                    <span className="tooltip-bottom" data-tip="已云同步"><Cloud size={12} className="text-green-500" /></span>
                                ) : null}
                            </button>
                        </div>

                        {/* Sidebar Content */}
                        <div className="flex-1 overflow-hidden relative bg-white min-w-[300px]">
                            {sidebarTab === 'chat' ? (
                                <ChatInterface data={data} getAiInstance={getAiInstance} />
                            ) : (
                                <div className="h-full overflow-y-auto p-4 bg-slate-50 space-y-4">
                                    {snapshots.length === 0 ? (
                                        <div className="h-full flex flex-col items-center justify-center text-slate-400 p-8 text-center">
                                            <GalleryHorizontalEnd size={48} className="mb-4 opacity-50" />
                                            <p className="text-sm">暂无保存的快照。</p>
                                            <p className="text-xs mt-2">在仪表盘点击"添加到报告"即可在此查看。</p>
                                        </div>
                                    ) : (
                                        snapshots.map(snap => (
                                            <div key={snap.id} className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm flex flex-col group transition-shadow hover:shadow-md">
                                                <div className="flex justify-between items-start mb-3 border-b border-slate-100 pb-2">
                                                    <div className="flex-1 min-w-0">
                                                        <h4 className="font-bold text-slate-700 text-sm truncate" title={snap.title}>{snap.title}</h4>
                                                        <p className="text-[10px] text-slate-400 mt-0.5">{snap.metricLabel} • {snap.xAxisLabel}</p>
                                                    </div>
                                                    <button onClick={() => handleDeleteSnapshot(snap.id)} className="text-slate-300 hover:text-red-500 p-1">
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>

                                                {/* Chart Type Switcher Toolbar */}
                                                <div className="flex gap-1 mb-2 overflow-x-auto scrollbar-hide pb-1">
                                                    {[
                                                        { t: 'bar', i: <BarChart3 size={14} /> },
                                                        { t: 'pie', i: <PieChartIcon size={14} /> },
                                                        { t: 'line', i: <LineChartIcon size={14} /> }
                                                    ].map(opt => (
                                                        <button
                                                            key={opt.t}
                                                            onClick={() => handleUpdateSnapshotType(snap.id, opt.t as ChartType)}
                                                            className={`p-1.5 rounded hover:bg-slate-100 ${snap.type === opt.t ? 'bg-blue-50 text-blue-600' : 'text-slate-400'}`}
                                                            title={opt.t}
                                                        >
                                                            {opt.i}
                                                        </button>
                                                    ))}
                                                </div>

                                                <div className="h-[200px] w-full">
                                                    <GenericChart
                                                        type={snap.type}
                                                        data={snap.data}
                                                        breakdownKeys={snap.breakdownKeys}
                                                        aggregation={snap.aggregation}
                                                        metricLabel={snap.metricLabel}
                                                        xAxisLabel={snap.xAxisLabel}
                                                        isStacked={snap.isStacked}
                                                        showValues={false} // Cleaner look for small gallery cards
                                                    />
                                                </div>
                                            </div>
                                        ))
                                    )}
                                </div>
                            )}
                        </div>
                    </aside>
                )}
            </div>

            {/* Close Confirmation Modal */}
            {showCloseConfirm && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-white rounded-xl shadow-2xl p-6 max-w-sm mx-4 animate-in fade-in zoom-in duration-200">
                        <h3 className="text-lg font-bold text-slate-800 mb-2">关闭文件</h3>
                        <p className="text-sm text-slate-600 mb-6">
                            确定要关闭当前文件并返回上传页吗？<br />
                            <span className="text-amber-600 text-xs">（报告画廊中的快照将被清除）</span>
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowCloseConfirm(false)}
                                className="px-4 py-2 text-sm font-medium text-slate-600 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={confirmReset}
                                className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-lg transition-colors"
                            >
                                确定关闭
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Data Source Manager Modal */}
            <DataSourceManager
                isOpen={showDataSourceManager}
                onClose={() => setShowDataSourceManager(false)}
                currentSourceUrl={sourceUrl}
                onSelectSource={handleSelectDataSource}
                onWorkbookLoaded={handleWorkbookLoaded}
                onRefreshSource={sourceUrl && !sourceUrl.startsWith('local://') ? handleRefresh : undefined}
                onSourcesChanged={handleDataSourcesChanged}
            />

            {/* Append Data Modal */}
            {showAppendModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={() => setShowAppendModal(false)}>
                    <div className="bg-white rounded-xl shadow-2xl w-full max-w-lg mx-4 overflow-hidden" onClick={e => e.stopPropagation()}>
                        <div className="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-purple-500 to-indigo-500">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Plus size={20} /> 追加粘贴数据
                            </h3>
                            <p className="text-xs text-purple-100 mt-1">
                                从 Excel / Google Sheets 复制数据，粘贴到下方追加到当前表格
                            </p>
                        </div>
                        <div className="p-4">
                            <textarea
                                ref={appendTextareaRef}
                                value={appendPasteContent}
                                onChange={e => { setAppendPasteContent(e.target.value); setAppendHtmlContent(null); }}
                                placeholder={"从 Google Sheets / Excel 复制数据后粘贴...\n\n✅ 支持 Google Sheets 公式（如 IMAGE）\n✅ 自动匹配已有列名\n✅ 新列名会被追加到表格末尾"}
                                className="w-full h-48 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                                autoFocus
                            />
                            <p className="text-xs text-slate-400 mt-2">
                                <Lightbulb size={12} className="inline mr-1" /> 提示：当前表格有 {data?.columns.length || 0} 列，{data?.rows.length || 0} 行
                            </p>
                        </div>
                        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50 flex justify-end gap-2">
                            <button
                                onClick={() => { setShowAppendModal(false); setAppendPasteContent(''); }}
                                className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg text-sm"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleAppendData}
                                disabled={!appendPasteContent.trim() || appendLoading}
                                className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
                            >
                                {appendLoading ? <Loader2 size={14} className="animate-spin" /> : <Plus size={14} />}
                                追加数据
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default SheetMindApp;
