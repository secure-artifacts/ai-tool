import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Database, Plus, Trash2, ExternalLink, RefreshCw, Check, X, FileSpreadsheet, Cloud, Upload, Link as LinkIcon, Clipboard, Loader2, Info, Settings2, CheckSquare, Square, CloudUpload, HardDrive, Download } from 'lucide-react';
import { getGoogleAccessToken, signInWithGoogle, signInWithGoogleAdvanced } from '@/services/authService';
import { readWorkbookFromFile, fetchWorkbookFromUrl, readWorkbookFromString, readWorkbookFromHtml, fetchWorkbookWithAuth, fetchGoogleSpreadsheetMetadata, fetchGoogleSpreadsheetInfo, filterWorkbook, SheetMetadata, parseMultipleSheetsAsync } from '../utils/parser';
import { saveDataSourcesToCloud, loadDataSourcesFromCloud, mergeDataSources, isUserLoggedIn, overwriteGoogleSheetData } from '../services/firebaseService';
import { loadWorkbookCache } from '../services/smartCacheService';
import { useAuth } from '@/contexts/AuthContext';
import * as XLSX from 'xlsx';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Workbook = any;

export interface DataSource {
    id: string;
    name: string;
    url: string;
    type: 'google-sheets' | 'local-file' | 'manual';
    addedAt: number;
    lastUsedAt?: number;
    lastRefreshedAt?: number; // Last time data was refreshed from source
    rowCount?: number;
    isActive?: boolean;
    selectedSheets?: string[]; // Sheets to import
}

interface DataSourceManagerProps {
    isOpen: boolean;
    onClose: () => void;
    currentSourceUrl?: string;
    onSelectSource: (source: DataSource) => void;
    onWorkbookLoaded: (workbook: Workbook, fileName: string, sourceUrl?: string) => void;
    onRefreshSource?: () => void;
}

const STORAGE_KEY = 'sheetmind_data_sources';
const PENDING_SYNC_KEY = 'sheetmind_data_sources_pending_sync';
const LOCAL_SOURCE_PREFIX = 'local://';

export const loadDataSources = (): DataSource[] => {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch {
        return [];
    }
};

export const saveDataSources = (sources: DataSource[]) => {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sources));
        // Also sync to cloud if user is logged in (async, don't block)
        const loggedIn = isUserLoggedIn();
        if (loggedIn) {
            const cloudSources = sources.filter(source => source.type === 'google-sheets');
            if (cloudSources.length > 0) {
                saveDataSourcesToCloud(cloudSources)
                    .then(() => {
                        localStorage.removeItem(PENDING_SYNC_KEY);
                    })
                    .catch(err => {
                        console.error('[DataSources] Cloud sync failed:', err);
                    });
            } else {
                localStorage.removeItem(PENDING_SYNC_KEY);
            }
        } else {
            const hasCloudSources = sources.some(source => source.type === 'google-sheets');
            if (hasCloudSources) {
                localStorage.setItem(PENDING_SYNC_KEY, 'true');
            } else {
                localStorage.removeItem(PENDING_SYNC_KEY);
            }
        }
    } catch (e) {
        console.warn('Failed to save data sources:', e);
    }
};

export const addDataSource = (source: Omit<DataSource, 'id' | 'addedAt'>): DataSource => {
    const sources = loadDataSources();
    const newSource: DataSource = {
        ...source,
        id: `ds_${Date.now()}`,
        addedAt: Date.now(),
    };
    sources.unshift(newSource);
    saveDataSources(sources);
    return newSource;
};

export const addLocalDataSource = (source: Omit<DataSource, 'id' | 'addedAt' | 'url'> & { url?: string }): DataSource => {
    const sources = loadDataSources();
    const id = `local_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
    const newSource: DataSource = {
        ...source,
        id,
        url: source.url || `${LOCAL_SOURCE_PREFIX}${id}`,
        addedAt: Date.now(),
    };
    sources.unshift(newSource);
    saveDataSources(sources);
    return newSource;
};

export const removeDataSource = (id: string) => {
    const sources = loadDataSources();
    saveDataSources(sources.filter(s => s.id !== id));
};

export const updateDataSource = (id: string, updates: Partial<DataSource>) => {
    const sources = loadDataSources();
    const idx = sources.findIndex(s => s.id === id);
    if (idx >= 0) {
        sources[idx] = { ...sources[idx], ...updates };
        saveDataSources(sources);
    }
};

const DataSourceManager: React.FC<DataSourceManagerProps> = ({
    isOpen,
    onClose,
    currentSourceUrl,
    onSelectSource,
    onWorkbookLoaded,
    onRefreshSource,
}) => {
    const { user, loading: authLoading } = useAuth();
    const [sources, setSources] = useState<DataSource[]>([]);
    const [isAddingNew, setIsAddingNew] = useState(false);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
    const [backupSource, setBackupSource] = useState<DataSource | null>(null);
    const [showBackupModal, setShowBackupModal] = useState(false);
    const [backupSheetUrl, setBackupSheetUrl] = useState('');
    const [backupSheetName, setBackupSheetName] = useState('');
    const [backupError, setBackupError] = useState<string | null>(null);
    const [backupProgress, setBackupProgress] = useState<{ written: number; total: number } | null>(null);
    const [isBackingUp, setIsBackingUp] = useState(false);
    const [sourceTab, setSourceTab] = useState<'sheets' | 'local'>('sheets');

    // File upload states (same as FileUpload component)
    const [url, setUrl] = useState('');
    const [pasteContent, setPasteContent] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [loadProgress, setLoadProgress] = useState<string | null>(null);
    const [pasteHint, setPasteHint] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Sheet Selection State
    const [selectingSheets, setSelectingSheets] = useState(false);
    const [sheetCandidates, setSheetCandidates] = useState<string[]>([]); // Names of all available sheets
    const [selectedSheetNames, setSelectedSheetNames] = useState<string[]>([]); // Names of selected sheets
    const [pendingWorkbook, setPendingWorkbook] = useState<Workbook | null>(null); // For public export flow
    const [pendingUrl, setPendingUrl] = useState<string>('');
    const [isAuthMode, setIsAuthMode] = useState(false);
    const [editingSourceId, setEditingSourceId] = useState<string | null>(null); // If editing existing source
    const [pendingSpreadsheetTitle, setPendingSpreadsheetTitle] = useState<string>('Google Sheet'); // Real spreadsheet name
    const [isSyncing, setIsSyncing] = useState(false);

    // 缓存相关状态
    const [cachedSourceIds, setCachedSourceIds] = useState<Set<string>>(new Set());
    const [cachingSourceId, setCachingSourceId] = useState<string | null>(null);
    const [batchCaching, setBatchCaching] = useState(false);

    // 检查是否在Electron环境中
    const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;
    const sheetSources = sources.filter(source => source.type === 'google-sheets');
    const localSources = sources.filter(source => source.type !== 'google-sheets');
    const visibleSources = sourceTab === 'sheets' ? sheetSources : localSources;

    const handleManualSync = async () => {
        if (!isUserLoggedIn()) {
            setError('请先登录 Google 账号');
            return;
        }
        setIsSyncing(true);
        try {
            await saveDataSourcesToCloud(sources.filter(source => source.type === 'google-sheets'));
            setError(null);
        } catch (err) {
            console.error('Sync failed:', err);
            setError('同步失败，请重试');
        } finally {
            setIsSyncing(false);
        }
    };

    // 缓存单个数据源
    const handleCacheSource = async (source: DataSource, e: React.MouseEvent) => {
        e.stopPropagation();
        if (source.type !== 'google-sheets') {
            alert('仅支持缓存 Google Sheets 数据源');
            return;
        }
        if (!isElectron) {
            alert('缓存功能仅在桌面版可用');
            return;
        }

        setCachingSourceId(source.id);
        try {
            const accessToken = getGoogleAccessToken();
            if (!accessToken) {
                alert('请先登录Google账号');
                setCachingSourceId(null);
                return;
            }

            // 加载数据源
            const wb = await fetchWorkbookWithAuth(source.url, accessToken, () => { }, source.selectedSheets);

            // 📊 预解析数据以加速后续加载
            let parsedData = null;
            try {
                const sheetNames = wb.SheetNames || [];
                if (sheetNames.length > 0) {
                    parsedData = await parseMultipleSheetsAsync(wb, sheetNames, source.name, { chunkSize: 1000 });
                }
            } catch (parseErr) {
                console.warn('[Cache] Pre-parse failed, will parse on load:', parseErr);
            }

            // 保存到本地缓存（包含解析后的数据）
            const cacheKey = `datasource_${source.id}`;
            const result = await (window as any).electronAPI.cacheData(cacheKey, {
                source,
                workbook: wb,
                parsedData, // 🚀 包含解析后的数据
                cachedAt: Date.now()
            });

            if (result.success) {
                setCachedSourceIds(prev => new Set([...prev, source.id]));
            } else {
                throw new Error(result.error);
            }
        } catch (err) {
            console.error('[Cache] Failed:', err);
            alert(`缓存失败: ${err}`);
        } finally {
            setCachingSourceId(null);
        }
    };

    // 批量缓存所有数据源（包括补充旧缓存的预解析数据）
    const handleBatchCache = async () => {
        if (!isElectron) {
            alert('缓存功能仅在桌面版可用');
            return;
        }

        const googleSources = sources.filter(source => source.type === 'google-sheets');
        if (googleSources.length === 0) {
            alert('暂无可缓存的 Google Sheets 数据源');
            return;
        }

        const accessToken = getGoogleAccessToken();
        // 注意：对于升级旧缓存，不需要登录（可以使用缓存中的 workbook）
        // 只有新增缓存才需要登录

        setBatchCaching(true);
        let successCount = 0;
        let upgradedCount = 0;

        for (const source of googleSources) {
            const cacheKey = `datasource_${source.id}`;

            // 检查是否已缓存且有预解析数据
            let needsCache = !cachedSourceIds.has(source.id);
            let existingCache: any = null;

            if (cachedSourceIds.has(source.id)) {
                // 检查旧缓存是否有 parsedData
                try {
                    const result = await (window as any).electronAPI.loadCache(cacheKey);
                    if (result && result.success && result.data) {
                        existingCache = result.data;
                        if (!existingCache.parsedData) {
                            // 旧缓存缺少预解析数据，需要升级
                            needsCache = true;
                        } else {
                        }
                    } else {
                        // 缓存加载失败，需要重新缓存
                        needsCache = true;
                    }
                } catch (err) {
                    console.warn('[Cache] Failed to check existing cache:', err);
                    needsCache = true; // 检查失败时也重新缓存
                }
            }

            if (!needsCache) continue;

            try {
                setCachingSourceId(source.id);

                // 如果有旧缓存的 workbook，使用它；否则需要重新加载
                let wb = existingCache?.workbook;
                if (!wb) {
                    // 需要从网络加载，检查是否有登录
                    if (!accessToken) {
                        continue;
                    }
                    wb = await fetchWorkbookWithAuth(source.url, accessToken, () => { }, source.selectedSheets);
                }

                // 📊 预解析数据
                let parsedData = null;
                try {
                    const sheetNames = wb.SheetNames || [];
                    if (sheetNames.length > 0) {
                        parsedData = await parseMultipleSheetsAsync(wb, sheetNames, source.name, { chunkSize: 1000 });
                    }
                } catch (parseErr) {
                    console.warn('[Cache] Pre-parse failed:', parseErr);
                }

                const result = await (window as any).electronAPI.cacheData(cacheKey, {
                    source,
                    workbook: wb,
                    parsedData, // 🚀 包含预解析数据
                    cachedAt: Date.now()
                });

                if (result.success) {
                    setCachedSourceIds(prev => new Set([...prev, source.id]));
                    if (existingCache) {
                        upgradedCount++;
                    } else {
                        successCount++;
                    }
                }
            } catch (err) {
                console.error('[Cache] Failed for', source.name, err);
            }
        }

        setCachingSourceId(null);
        setBatchCaching(false);

        // 计算已跳过的数量（已有完整缓存）
        const skippedCount = googleSources.length - successCount - upgradedCount;

        // 构建友好的提示信息
        let msg = '';
        if (successCount === 0 && upgradedCount === 0) {
            if (skippedCount === googleSources.length) {
                msg = `✅ 所有 ${googleSources.length} 个数据源都已有完整缓存（含预解析数据），无需重新缓存`;
            } else {
                msg = `⚠️ 没有可缓存的数据源。请先登录 Google 账号以缓存新数据源。`;
            }
        } else {
            const parts = [];
            if (successCount > 0) parts.push(`${successCount} 个新缓存`);
            if (upgradedCount > 0) parts.push(`${upgradedCount} 个已升级`);
            if (skippedCount > 0) parts.push(`${skippedCount} 个已跳过（已有完整缓存）`);
            msg = `✅ 批量缓存完成: ${parts.join(', ')}`;
        }
        alert(msg);
    };

    // Load sources on open (from local + cloud)
    useEffect(() => {
        if (isOpen && !authLoading) {
            const localSources = loadDataSources();
            setSources(localSources);

            // Also try to load from cloud and merge if user is logged in
            const loggedIn = !!user;

            if (loggedIn) {
                setIsSyncing(true);
                loadDataSourcesFromCloud()
                    .then(cloudSources => {
                        if (cloudSources.length > 0) {
                            // Merge cloud with local
                            const merged = mergeDataSources(localSources, cloudSources);
                            setSources(merged);
                            // Save merged back to local
                            localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
                            // Also sync merged back to cloud
                            saveDataSourcesToCloud(merged.filter(source => source.type === 'google-sheets'))
                                .then(() => localStorage.removeItem(PENDING_SYNC_KEY))
                                .catch(console.warn);
                        } else if (localSources.length > 0) {
                            // Cloud is empty but local has data, push local to cloud
                            saveDataSourcesToCloud(localSources.filter(source => source.type === 'google-sheets'))
                                .then(() => localStorage.removeItem(PENDING_SYNC_KEY))
                                .catch(console.warn);
                        }
                    })
                    .catch(err => {
                        console.error('[DataSourceManager] 云端加载失败:', err);
                    })
                    .finally(() => {
                        setIsSyncing(false);
                    });
            } else {
            }

            // 检查哪些数据源已经被缓存（仅Electron环境）
            if (isElectron) {
                (window as any).electronAPI.listCache().then((cacheList: any) => {
                    if (cacheList.success && cacheList.files) {
                        const cachedIds = new Set<string>();
                        for (const file of cacheList.files) {
                            if (file.key.startsWith('datasource_')) {
                                const id = file.key.replace('datasource_', '');
                                cachedIds.add(id);
                            }
                        }
                        setCachedSourceIds(cachedIds);
                    }
                }).catch((err: any) => {
                    console.error('[Cache] Failed to check cache:', err);
                });
            }
        }
    }, [isOpen, authLoading, user, isElectron]);

    useEffect(() => {
        if (sheetSources.length === 0 && localSources.length > 0) {
            setSourceTab('local');
        }
        if (localSources.length === 0 && sheetSources.length > 0) {
            setSourceTab('sheets');
        }
    }, [sheetSources.length, localSources.length]);

    // Handle paste for Google Sheets HTML format
    useEffect(() => {
        if (!isOpen) return;

        const handleGlobalPaste = async (e: ClipboardEvent) => {
            if (document.activeElement !== textareaRef.current) return;

            const clipboardData = e.clipboardData;
            if (!clipboardData) return;

            const htmlData = clipboardData.getData('text/html');
            const textData = clipboardData.getData('text/plain');

            if (htmlData && htmlData.includes('google-sheets-html-origin')) {
                e.preventDefault();
                setPasteHint('检测到 Google Sheets 格式，正在解析...');
                setIsLoading(true);
                setError(null);

                try {
                    const wb = await readWorkbookFromHtml(htmlData);
                    const localSource = addLocalDataSource({
                        name: "Google Sheets 粘贴的数据",
                        type: 'manual'
                    });
                    onWorkbookLoaded(wb, localSource.name, localSource.url);
                    setSources(loadDataSources());
                    setPasteContent('');
                    setPasteHint(null);
                    onClose();
                } catch (err: unknown) {
                    console.error('HTML parse error:', err);
                    if (textData) {
                        try {
                            const wb = await readWorkbookFromString(textData);
                            const localSource = addLocalDataSource({
                                name: "粘贴的数据",
                                type: 'manual'
                            });
                            onWorkbookLoaded(wb, localSource.name, localSource.url);
                            setSources(loadDataSources());
                            setPasteContent('');
                            setPasteHint(null);
                            onClose();
                        } catch {
                            setError("无法解析粘贴的内容。");
                            setPasteHint(null);
                        }
                    } else {
                        setError("无法解析 Google Sheets 数据。");
                        setPasteHint(null);
                    }
                } finally {
                    setIsLoading(false);
                }
            }
        };

        document.addEventListener('paste', handleGlobalPaste);
        return () => document.removeEventListener('paste', handleGlobalPaste);
    }, [isOpen, onWorkbookLoaded, onClose]);

    const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setIsLoading(true);
            setError(null);
            try {
                const wb = await readWorkbookFromFile(file);
                const localSource = addLocalDataSource({
                    name: file.name,
                    type: 'local-file'
                });
                onWorkbookLoaded(wb, localSource.name, localSource.url);
                setSources(loadDataSources());
                onClose();
            } catch (err) {
                setError("解析文件出错。请确保是有效的 Excel 或 CSV 文件。");
                console.error(err);
            } finally {
                setIsLoading(false);
            }
        }
    }, [onWorkbookLoaded, onClose]);

    const handleUrlSubmit = async () => {
        if (!url.trim()) return;
        setIsLoading(true);
        setError(null);
        setLoadProgress('正在准备加载...');
        setPendingUrl(url);
        setEditingSourceId(null); // Adding new

        try {
            const accessToken = getGoogleAccessToken();

            if (accessToken) {
                // Auth mode: Fetch metadata first
                setIsAuthMode(true);
                setLoadProgress('正在获取表格信息...');

                // Extract ID to fetch metadata
                const matches = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
                if (!matches || !matches[1]) {
                    throw new Error("无效的 Google 表格链接。");
                }
                const spreadsheetId = matches[1];

                const spreadsheetInfo = await fetchGoogleSpreadsheetInfo(spreadsheetId, accessToken);
                const candidates = spreadsheetInfo.sheets.map(s => s.title);

                setPendingSpreadsheetTitle(spreadsheetInfo.title); // Store the real spreadsheet name
                setSheetCandidates(candidates);
                setSelectedSheetNames(candidates); // Default select all
                setSelectingSheets(true); // Show selection UI
                setLoadProgress(null);
                setIsLoading(false); // Reset loading state

            } else {
                // Public mode: Fetch full workbook (export) then filter
                setIsAuthMode(false);
                setLoadProgress('使用公开链接加载...');
                const wb = await fetchWorkbookFromUrl(url, (msg) => {
                    setLoadProgress(msg);
                });

                // For public mode, we can't get the spreadsheet title via API
                // Use a descriptive name based on the URL or "Google Sheet (公开)"
                const urlIdMatch = url.match(/\/d\/([a-zA-Z0-9-_]+)/);
                const shortId = urlIdMatch ? urlIdMatch[1].substring(0, 8) : '';
                setPendingSpreadsheetTitle(`Google Sheet${shortId ? ` (${shortId}...)` : ''}`);

                setPendingWorkbook(wb);
                setSheetCandidates(wb.SheetNames);
                setSelectedSheetNames(wb.SheetNames); // Default select all
                setSelectingSheets(true); // Show selection UI
                setLoadProgress(null);
                setIsLoading(false); // Reset loading state
            }
        } catch (err: unknown) {
            setLoadProgress(null);
            let errorMessage = "无法加载表格。";
            if (err instanceof Error) {
                errorMessage = err.message;
            }
            setError(errorMessage);
            setIsLoading(false);
        }
    };

    const handleEditSheets = async (source: DataSource) => {
        setIsLoading(true);
        setError(null);
        setLoadProgress('正在获取表格信息...');
        setPendingUrl(source.url);
        setEditingSourceId(source.id);

        try {
            const accessToken = getGoogleAccessToken();

            if (accessToken) {
                setIsAuthMode(true);
                const matches = source.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
                if (!matches || !matches[1]) throw new Error("无效链接");

                const spreadsheetInfo = await fetchGoogleSpreadsheetInfo(matches[1], accessToken);
                const candidates = spreadsheetInfo.sheets.map(s => s.title);

                setPendingSpreadsheetTitle(spreadsheetInfo.title);
                setSheetCandidates(candidates);
                // Pre-select existing selection or all
                setSelectedSheetNames(source.selectedSheets && source.selectedSheets.length > 0
                    ? source.selectedSheets.filter(s => candidates.includes(s))
                    : candidates);

                setSelectingSheets(true);
            } else {
                setIsAuthMode(false);
                setLoadProgress('正在读取表格...');
                const wb = await fetchWorkbookFromUrl(source.url, (msg) => setLoadProgress(msg));

                // Keep existing name or use fallback
                setPendingSpreadsheetTitle(source.name || 'Google Sheet');
                setPendingWorkbook(wb);
                setSheetCandidates(wb.SheetNames);
                setSelectedSheetNames(source.selectedSheets && source.selectedSheets.length > 0
                    ? source.selectedSheets.filter(s => wb.SheetNames.includes(s))
                    : wb.SheetNames);

                setSelectingSheets(true);
            }
            setLoadProgress(null);
            setIsLoading(false); // Reset loading state
        } catch (err: unknown) {
            console.error(err);
            setError("无法获取表格信息，请检查链接权限或网络。");
            setIsLoading(false);
        }
    };

    const handleConfirmSheetSelection = async () => {
        if (selectedSheetNames.length === 0) {
            setError("请至少选择一个工作表");
            return;
        }

        setIsLoading(true);
        setLoadProgress('正在加载选中的数据...');

        try {
            let finalWorkbook: Workbook;

            if (isAuthMode) {
                const accessToken = getGoogleAccessToken();
                if (!accessToken) throw new Error("登录已过期");

                // Fetch only selected sheets
                finalWorkbook = await fetchWorkbookWithAuth(pendingUrl, accessToken, (msg) => setLoadProgress(msg), selectedSheetNames);
            } else {
                // Filter the pending workbook
                if (!pendingWorkbook) throw new Error("加载失败，请重试");
                finalWorkbook = filterWorkbook(pendingWorkbook, selectedSheetNames);
            }

            // If editing, update source config only (unless it's the current one? usually we just save)
            if (editingSourceId) {
                updateDataSource(editingSourceId, {
                    selectedSheets: selectedSheetNames,
                    rowCount: undefined // Reset row count as it might change? or we keep specific stats?
                });
                // If the updated source is the current one, reload it into the app?
                // The user requirement is 'modify which pages', usually implies subsequent usage. 
                // But a user might expect immediate update.
                // Let's reload it into app immediately.
                onWorkbookLoaded(finalWorkbook, pendingSpreadsheetTitle, pendingUrl);

                // Also update the source name in storage
                updateDataSource(editingSourceId, { name: pendingSpreadsheetTitle });

                // Update local sources list in UI
                setSources(loadDataSources());

                setSelectingSheets(false);
                setEditingSourceId(null);
                setPendingWorkbook(null);
                onClose();
            } else {
                // Adding new
                onWorkbookLoaded(finalWorkbook, pendingSpreadsheetTitle, pendingUrl);

                // Update the *automatically created* source with selection
                // onWorkbookLoaded in App triggers addDataSource, but without selectedSheets info.
                // We should manually update the latest added source or add it here?
                // App.tsx logic: "if url... addDataSource". 
                // We can't easily intercept App.tsx's automatic add.
                // Solution: We can call addDataSource HERE, ensuring it has correct info, 
                // then pass to onWorkbookLoaded. 
                // But App.tsx checks `!alreadyExists`. So if we add it first, App.tsx won't add duplicate.

                addDataSource({
                    name: pendingSpreadsheetTitle,
                    url: pendingUrl,
                    type: 'google-sheets',
                    selectedSheets: selectedSheetNames
                });

                setUrl('');
                setSelectingSheets(false);
                setPendingWorkbook(null);
                onClose();
            }

        } catch (err: unknown) {
            let errorMessage = "加载失败。";
            if (err instanceof Error) {
                errorMessage = err.message;
            }
            setError(errorMessage);
        } finally {
            setIsLoading(false);
            setLoadProgress(null);
        }
    };

    const toggleSheetSelection = (name: string) => {
        setSelectedSheetNames(prev =>
            prev.includes(name)
                ? prev.filter(n => n !== name)
                : [...prev, name]
        );
    };

    const handlePasteSubmit = async () => {
        if (!pasteContent.trim()) return;
        setIsLoading(true);
        setError(null);
        try {
            const wb = await readWorkbookFromString(pasteContent);
            const localSource = addLocalDataSource({
                name: "粘贴的数据",
                type: 'manual'
            });
            onWorkbookLoaded(wb, localSource.name, localSource.url);
            setSources(loadDataSources());
            setPasteContent("");
            onClose();
        } catch (err: unknown) {
            let errorMessage = "无法解析粘贴的内容。";
            if (err instanceof Error) {
                errorMessage = err.message;
            }
            setError(errorMessage);
        } finally {
            setIsLoading(false);
        }
    };

    const handleDeleteSource = (id: string) => {
        removeDataSource(id);
        setSources(sources.filter(s => s.id !== id));
        setConfirmDelete(null);
    };

    // Refresh the name of an existing data source from Google API
    const handleRefreshSourceName = async (source: DataSource) => {
        const accessToken = getGoogleAccessToken();
        if (!accessToken) {
            setError('需要登录 Google 才能刷新表格名称');
            return;
        }

        try {
            const matches = source.url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
            if (!matches || !matches[1]) {
                setError('无效的表格链接');
                return;
            }

            const spreadsheetInfo = await fetchGoogleSpreadsheetInfo(matches[1], accessToken);

            // Update source name
            updateDataSource(source.id, { name: spreadsheetInfo.title });

            // Refresh the UI
            setSources(loadDataSources());
        } catch (err: unknown) {
            console.error('Failed to refresh source name:', err);
            if (err instanceof Error) {
                setError(err.message);
            } else {
                setError('刷新名称失败');
            }
        }
    };

    const handleSelectSource = (source: DataSource) => {
        const nextSources = sources.map(item => {
            if (item.id === source.id) {
                return { ...item, lastUsedAt: Date.now(), isActive: true };
            }
            return { ...item, isActive: false };
        });
        saveDataSources(nextSources);
        setSources(nextSources);
        onSelectSource(source);
        onClose();
    };

    const parseSpreadsheetId = (input: string): string | null => {
        const trimmed = input.trim();
        if (!trimmed) return null;
        const match = trimmed.match(/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
        return match ? match[1] : trimmed;
    };

    const sanitizeSheetName = (name: string): string => {
        return name
            .replace(/[\/\\?*[\]:'"()→←↔]/g, '_')
            .replace(/_+/g, '_')
            .replace(/^_|_$/g, '')
            .slice(0, 100) || 'Sheet1';
    };

    const openBackupModal = (source: DataSource) => {
        setBackupSource(source);
        setBackupSheetName(source.name || 'Sheet1');
        setBackupSheetUrl('');
        setBackupError(null);
        setBackupProgress(null);
        setShowBackupModal(true);
    };

    const closeBackupModal = () => {
        if (isBackingUp) return;
        setShowBackupModal(false);
        setBackupSource(null);
    };

    const handleBackupToSheets = async () => {
        if (!backupSource) return;

        const spreadsheetId = parseSpreadsheetId(backupSheetUrl);
        if (!spreadsheetId) {
            setBackupError('请输入有效的 Google Sheets 链接或表格 ID');
            return;
        }

        const accessToken = getGoogleAccessToken();
        if (!accessToken) {
            setBackupError('需要高级登录才能写入 Google Sheets');
            return;
        }

        setIsBackingUp(true);
        setBackupError(null);
        setBackupProgress({ written: 0, total: 0 });

        try {
            const cacheResult = await loadWorkbookCache(backupSource.url, backupSource.id);
            if (!cacheResult.success || !cacheResult.data?.workbook) {
                throw new Error('本地缓存不存在，请重新导入该数据源');
            }

            const workbook = cacheResult.data.workbook as XLSX.WorkBook;
            const activeSheet = cacheResult.data.currentSheetName || workbook.SheetNames?.[0];
            if (!activeSheet) {
                throw new Error('未找到可用的工作表');
            }

            const sheet = workbook.Sheets[activeSheet];
            if (!sheet) {
                throw new Error('当前工作表读取失败');
            }

            const rows = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as (string | number | boolean | null)[][];
            const targetSheetName = sanitizeSheetName(backupSheetName || backupSource.name || activeSheet);

            setBackupProgress({ written: 0, total: rows.length });

            await overwriteGoogleSheetData(
                spreadsheetId,
                targetSheetName,
                rows,
                accessToken,
                {
                    chunkSize: 2000,
                    onProgress: (written, total) => {
                        setBackupProgress({ written, total });
                    }
                }
            );

            setBackupProgress({ written: rows.length, total: rows.length });
            setIsBackingUp(false);
            alert('✅ 备份完成');
            closeBackupModal();
            return;
        } catch (err) {
            const msg = err instanceof Error ? err.message : '备份失败';
            setBackupError(msg);
        } finally {
            setIsBackingUp(false);
        }
    };

    const handleGoogleLogin = async () => {
        try {
            await signInWithGoogle();
            setSources([...sources]);
        } catch (err) {
            console.error('Google login failed:', err);
        }
    };

    const handleAdvancedLogin = async () => {
        try {
            await signInWithGoogleAdvanced();
        } catch (err) {
            console.error('Advanced Google login failed:', err);
        }
    };

    if (!isOpen) return null;

    return (
        <>
            <div className="fixed inset-0 bg-black/50 z-50" onClick={onClose} />
            <div className="fixed inset-y-4 right-4 w-[480px] max-w-[calc(100vw-32px)] bg-white rounded-2xl shadow-2xl z-50 flex flex-col overflow-hidden">
                {/* Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-emerald-500 to-teal-500">
                    <div className="flex items-center gap-3">
                        <Database className="text-white" size={22} />
                        <div>
                            <h2 className="text-lg font-bold text-white">数据源管理</h2>
                            <p className="text-xs text-emerald-100">加载和管理您的数据</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="text-white/80 hover:text-white p-1">
                        <X size={20} />
                    </button>
                </div>

                {/* Google Auth Status */}
                <div className="px-5 py-3 bg-slate-50 border-b border-slate-200 flex items-center justify-between">
                    {getGoogleAccessToken() ? (
                        <div className="flex items-center gap-2 text-emerald-600 text-sm">
                            <Check size={16} />
                            <span>已登录 Google - 数据跨设备同步</span>
                            {isSyncing && <Loader2 size={14} className="animate-spin text-blue-500" />}
                        </div>
                    ) : (
                        <span className="text-xs text-slate-500">请在软件主界面登录 Google 以启用大表格和云同步功能</span>
                    )}
                </div>

                {/* Sheet Selection Step (Overlay in Content) */}
                {selectingSheets ? (
                    <div className="absolute inset-0 z-10 bg-white flex flex-col animate-in fade-in slide-in-from-right duration-200">
                        <div className="px-5 py-4 border-b border-slate-200 flex items-center justify-between bg-slate-50">
                            <h3 className="font-bold text-slate-700">选择要导入的工作表</h3>
                            <button
                                onClick={() => {
                                    setSelectingSheets(false);
                                    setPendingWorkbook(null);
                                    setIsLoading(false);
                                }}
                                className="text-slate-400 hover:text-slate-600"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-2">
                            {/* Hint for non-auth mode */}
                            {!isAuthMode && (
                                <div className="mx-2 mb-3 px-3 py-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-700">
                                    💡 提示：登录 Google 后，可在下载前选择分页，大幅缩短大表格的加载时间。
                                </div>
                            )}
                            {/* Select All / None */}
                            <div className="px-3 py-2 flex gap-4 text-xs text-blue-600 border-b border-slate-100 mb-2">
                                <button onClick={() => setSelectedSheetNames(sheetCandidates)}>全选</button>
                                <button onClick={() => setSelectedSheetNames([])}>清空</button>
                            </div>

                            <div className="space-y-1">
                                {sheetCandidates.map(name => {
                                    const isSelected = selectedSheetNames.includes(name);
                                    return (
                                        <div
                                            key={name}
                                            onClick={() => toggleSheetSelection(name)}
                                            className={`flex items-center gap-3 px-4 py-3 rounded-lg cursor-pointer transition-colors ${isSelected ? 'bg-blue-50 text-blue-800' : 'hover:bg-slate-50 text-slate-600'
                                                }`}
                                        >
                                            <div className={`w-5 h-5 rounded border flex items-center justify-center transition-colors ${isSelected ? 'bg-blue-500 border-blue-500 text-white' : 'border-slate-300 bg-white'
                                                }`}>
                                                {isSelected && <Check size={14} strokeWidth={3} />}
                                            </div>
                                            <span className="text-sm font-medium">{name}</span>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>

                        <div className="p-4 border-t border-slate-200 flex justify-end gap-3 bg-white">
                            <div className="flex-1 flex items-center text-xs text-slate-500">
                                已选 {selectedSheetNames.length} / {sheetCandidates.length} 个
                            </div>
                            <button
                                onClick={() => {
                                    setSelectingSheets(false);
                                    setPendingWorkbook(null);
                                }}
                                className="px-4 py-2 text-slate-600 bg-slate-100 rounded-lg text-sm hover:bg-slate-200"
                            >
                                上一步
                            </button>
                            <button
                                onClick={handleConfirmSheetSelection}
                                disabled={selectedSheetNames.length === 0 || isLoading}
                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium flex items-center gap-2"
                            >
                                {isLoading ? <Loader2 className="animate-spin" size={16} /> : "确认加载"}
                            </button>
                        </div>
                    </div>
                ) : (
                    // Default Content (Add + List)
                    <>
                        {/* Add New Source */}
                        <div className="px-5 py-4 border-b border-slate-200">
                            {isAddingNew ? (
                                <div className="space-y-4">
                                    {/* File Upload */}
                                    <div className="flex flex-col items-center justify-center w-full h-28 border-2 border-slate-300 border-dashed rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors relative group">
                                        {isLoading ? (
                                            <div className="flex flex-col items-center animate-pulse">
                                                <FileSpreadsheet className="w-8 h-8 text-blue-500 mb-2" />
                                                <p className="text-xs text-slate-500">{loadProgress || '正在处理...'}</p>
                                            </div>
                                        ) : (
                                            <label htmlFor="dropzone-file-manager" className="flex flex-col items-center justify-center w-full h-full cursor-pointer">
                                                <div className="flex flex-col items-center justify-center">
                                                    <div className="bg-white p-2 rounded-full shadow-sm mb-2 group-hover:scale-110 transition-transform">
                                                        <Upload className="w-5 h-5 text-blue-500" />
                                                    </div>
                                                    <p className="text-xs text-slate-600 font-medium">点击上传文件</p>
                                                    <p className="text-[10px] text-slate-400">Excel (.xlsx) 或 CSV</p>
                                                </div>
                                                <input
                                                    id="dropzone-file-manager"
                                                    type="file"
                                                    className="hidden"
                                                    accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                                                    onChange={handleFileChange}
                                                />
                                            </label>
                                        )}
                                    </div>

                                    {/* URL Input */}
                                    <div className="space-y-2">
                                        <label className="block text-xs font-medium text-slate-700 flex items-center gap-1">
                                            <LinkIcon size={12} className="text-blue-600" />
                                            Google 表格链接
                                        </label>
                                        <div className="flex gap-2">
                                            <input
                                                type="text"
                                                value={url}
                                                onChange={(e) => setUrl(e.target.value)}
                                                placeholder="https://docs.google.com/spreadsheets/d/..."
                                                className="flex-1 px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-emerald-500 outline-none"
                                                disabled={isLoading}
                                            />
                                            <button
                                                onClick={handleUrlSubmit}
                                                disabled={!url.trim() || isLoading}
                                                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium"
                                            >
                                                {isLoading ? <Loader2 className="animate-spin" size={16} /> : "下一步"}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Paste Input */}
                                    <div className="space-y-2">
                                        <label className="block text-xs font-medium text-slate-700 flex items-center gap-1">
                                            <Clipboard size={12} className="text-purple-600" />
                                            直接粘贴数据
                                        </label>
                                        {pasteHint && (
                                            <div className="text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg flex items-center gap-2">
                                                <Info size={12} />
                                                {pasteHint}
                                            </div>
                                        )}
                                        <textarea
                                            ref={textareaRef}
                                            value={pasteContent}
                                            onChange={(e) => setPasteContent(e.target.value)}
                                            placeholder="从 Google Sheets / Excel 复制数据后粘贴..."
                                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                                            disabled={isLoading}
                                            style={{ minHeight: '80px' }}
                                        />
                                        <button
                                            onClick={handlePasteSubmit}
                                            disabled={!pasteContent.trim() || isLoading}
                                            className="w-full bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900 disabled:opacity-50 text-sm font-medium"
                                        >
                                            {isLoading ? <Loader2 className="animate-spin mx-auto" size={16} /> : "解析文本"}
                                        </button>
                                    </div>

                                    {error && (
                                        <div className="text-xs text-red-600 bg-red-50 p-3 rounded-lg">
                                            {error}
                                        </div>
                                    )}

                                    <button
                                        onClick={() => {
                                            setIsAddingNew(false);
                                            setUrl('');
                                            setPasteContent('');
                                            setError(null);
                                        }}
                                        className="w-full py-2 text-slate-600 bg-slate-100 rounded-lg text-sm hover:bg-slate-200"
                                    >
                                        取消
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setIsAddingNew(true)}
                                    className="w-full flex items-center justify-center gap-2 py-3 border-2 border-dashed border-slate-300 rounded-xl text-slate-500 hover:border-emerald-400 hover:text-emerald-600 transition-colors"
                                >
                                    <Plus size={18} />
                                    <span className="text-sm font-medium">添加新数据源</span>
                                </button>
                            )}
                        </div>

                        {/* Sources Tabs */}
                        <div className="px-5 py-2 border-b border-slate-200 bg-white flex items-center gap-2">
                            <button
                                onClick={() => setSourceTab('sheets')}
                                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${sourceTab === 'sheets'
                                    ? 'bg-emerald-500 text-white border-emerald-500'
                                    : 'bg-white text-slate-500 border-slate-200 hover:border-emerald-300 hover:text-emerald-600'
                                    }`}
                            >
                                Google 表格 ({sheetSources.length})
                            </button>
                            <button
                                onClick={() => setSourceTab('local')}
                                className={`px-3 py-1.5 text-xs rounded-full border transition-colors ${sourceTab === 'local'
                                    ? 'bg-blue-500 text-white border-blue-500'
                                    : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300 hover:text-blue-600'
                                    }`}
                            >
                                本地数据 ({localSources.length})
                            </button>
                        </div>

                        {/* Sources List */}
                        <div className="flex-1 overflow-y-auto p-4 space-y-3">
                            {visibleSources.length === 0 ? (
                                <div className="text-center py-8 text-slate-400">
                                    <FileSpreadsheet size={40} className="mx-auto mb-3 opacity-50" />
                                    <p className="text-sm">暂无保存的数据源</p>
                                    <p className="text-xs mt-1">
                                        {sourceTab === 'sheets' ? '加载 Google Sheets 后会自动保存' : '导入/粘贴数据后会自动保存'}
                                    </p>
                                </div>
                            ) : (
                                visibleSources.map(source => {
                                    const isActive = source.url === currentSourceUrl;
                                    const isConfirmingDelete = confirmDelete === source.id;

                                    return (
                                        <div
                                            key={source.id}
                                            className={`p-3 rounded-xl border transition-all ${isActive
                                                ? 'border-emerald-400 bg-emerald-50 shadow-sm'
                                                : 'border-slate-200 bg-white hover:border-slate-300 hover:shadow-sm'
                                                }`}
                                        >
                                            <div className="flex items-start justify-between gap-3">
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-center gap-2">
                                                        <h3 className="font-medium text-slate-800 text-sm truncate">
                                                            {source.name}
                                                        </h3>
                                                        {isActive && (
                                                            <span className="px-1.5 py-0.5 bg-emerald-500 text-white text-[10px] rounded-full">
                                                                当前
                                                            </span>
                                                        )}
                                                    </div>
                                                    <p className="text-xs text-slate-400 truncate mt-1" title={source.url}>
                                                        {source.type === 'google-sheets' ? source.url : '本地数据（离线缓存）'}
                                                    </p>
                                                    <div className="flex items-center gap-3 mt-1 text-[10px] text-slate-400">
                                                        <span>
                                                            {new Date(source.addedAt).toLocaleDateString('zh-CN')}
                                                        </span>
                                                        {source.type !== 'google-sheets' && (
                                                            <span className="flex items-center gap-1 text-slate-500">
                                                                <HardDrive size={10} />
                                                                本地
                                                            </span>
                                                        )}
                                                        {source.selectedSheets && (
                                                            <span className="flex items-center gap-1 text-slate-500">
                                                                <CheckSquare size={10} />
                                                                {source.selectedSheets.length} 个工作表
                                                            </span>
                                                        )}
                                                        {source.rowCount && !source.selectedSheets && (
                                                            <span>{source.rowCount.toLocaleString()} 行</span>
                                                        )}
                                                    </div>
                                                </div>

                                                <div className="flex items-center gap-1">
                                                    {!isActive && (
                                                        <button
                                                            onClick={() => handleSelectSource(source)}
                                                            className="p-1.5 text-emerald-600 hover:bg-emerald-100 rounded-md"
                                                            data-tip="使用此数据源" className="tooltip-bottom"
                                                        >
                                                            <Check size={16} />
                                                        </button>
                                                    )}
                                                    {source.type === 'google-sheets' && (
                                                        <>
                                                            <button
                                                                onClick={() => handleRefreshSourceName(source)}
                                                                className="p-1.5 text-slate-400 hover:text-green-600 hover:bg-green-50 rounded-md"
                                                                data-tip="刷新表格名称" className="tooltip-bottom"
                                                            >
                                                                <RefreshCw size={16} />
                                                            </button>
                                                            <button
                                                                onClick={() => handleEditSheets(source)}
                                                                className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md"
                                                                data-tip="修改导入的分页" className="tooltip-bottom"
                                                            >
                                                                <Settings2 size={16} />
                                                            </button>
                                                        </>
                                                    )}
                                                    {source.type !== 'google-sheets' && (
                                                        <button
                                                            onClick={() => openBackupModal(source)}
                                                            className="p-1.5 text-blue-600 hover:bg-blue-50 rounded-md"
                                                            data-tip="备份到 Google Sheets（覆盖写入）" className="tooltip-bottom"
                                                        >
                                                            <CloudUpload size={16} />
                                                        </button>
                                                    )}
                                                    {isElectron && source.type === 'google-sheets' && (
                                                        <button
                                                            onClick={(e) => handleCacheSource(source, e)}
                                                            disabled={cachingSourceId === source.id || cachedSourceIds.has(source.id)}
                                                            className={`p-1.5 rounded-md transition-colors ${cachedSourceIds.has(source.id)
                                                                ? 'text-green-500 bg-green-50'
                                                                : 'text-amber-500 hover:bg-amber-50'}`}
                                                            title={cachedSourceIds.has(source.id) ? '已缓存' : '缓存到本地'}
                                                        >
                                                            {cachingSourceId === source.id ? <Loader2 size={16} className="animate-spin" /> : cachedSourceIds.has(source.id) ? <Check size={16} /> : <HardDrive size={16} />}
                                                        </button>
                                                    )}
                                                    {source.type === 'google-sheets' && (
                                                        <a
                                                            href={source.url}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-md"
                                                            data-tip="在新窗口打开" className="tooltip-bottom"
                                                        >
                                                            <ExternalLink size={16} />
                                                        </a>
                                                    )}
                                                    {isConfirmingDelete ? (
                                                        <div className="flex items-center gap-1 ml-1">
                                                            <button
                                                                onClick={() => handleDeleteSource(source.id)}
                                                                className="px-2 py-1 bg-red-500 text-white text-xs rounded"
                                                            >
                                                                确认
                                                            </button>
                                                            <button
                                                                onClick={() => setConfirmDelete(null)}
                                                                className="px-2 py-1 bg-slate-200 text-slate-600 text-xs rounded"
                                                            >
                                                                取消
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <button
                                                            onClick={() => setConfirmDelete(source.id)}
                                                            className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-md"
                                                            data-tip="删除" className="tooltip-bottom"
                                                        >
                                                            <Trash2 size={16} />
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })
                            )}
                        </div>

                        {/* Footer */}
                        <div className="px-5 py-3 border-t border-slate-200 bg-slate-50">
                            <div className="flex items-center justify-between text-xs text-slate-500">
                                <div className="flex items-center gap-3">
                                    <span>{sources.length} 个已保存的数据源</span>
                                    {/* Cloud Sync Status */}
                                    {isUserLoggedIn() && (
                                        <button
                                            onClick={handleManualSync}
                                            disabled={isSyncing}
                                            className={`flex items-center gap-1 px-2 py-0.5 rounded-full transition-colors cursor-pointer ${isSyncing
                                                ? 'bg-blue-100 text-blue-600'
                                                : 'bg-green-100 text-green-600 hover:bg-green-200'
                                                }`}
                                            data-tip="点击立即同步" className="tooltip-bottom"
                                        >
                                            {isSyncing ? (
                                                <>
                                                    <Loader2 size={10} className="animate-spin" />
                                                    <span>同步中...</span>
                                                </>
                                            ) : (
                                                <>
                                                    <Cloud size={10} />
                                                    <span>已云同步</span>
                                                </>
                                            )}
                                        </button>
                                    )}
                                    {!isUserLoggedIn() && (
                                        <span className="flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-200 text-slate-500">
                                            <Cloud size={10} />
                                            <span>仅本地</span>
                                        </span>
                                    )}
                                    {isElectron && sources.some(source => source.type === 'google-sheets') && (
                                        <button
                                            onClick={handleBatchCache}
                                            disabled={batchCaching}
                                            className="flex items-center gap-1 px-2 py-1 bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg transition-colors disabled:opacity-50"
                                            data-tip="批量缓存所有数据源到本地" className="tooltip-bottom"
                                        >
                                            {batchCaching ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                                            批量缓存
                                        </button>
                                    )}
                                </div>
                                {currentSourceUrl && onRefreshSource && (
                                    <button
                                        onClick={() => {
                                            onRefreshSource();
                                            onClose();
                                        }}
                                        className="flex items-center gap-1 text-blue-600 hover:text-blue-800"
                                    >
                                        <RefreshCw size={12} /> 刷新当前数据
                                    </button>
                                )}
                            </div>
                        </div>
                    </>
                )}
            </div>

            {showBackupModal && backupSource && (
                <>
                    <div className="fixed inset-0 bg-black/40 z-[60]" onClick={closeBackupModal} />
                    <div className="fixed inset-0 z-[61] flex items-center justify-center p-4">
                        <div className="w-full max-w-lg bg-white rounded-2xl shadow-2xl overflow-hidden">
                            <div className="px-5 py-4 border-b border-slate-200 bg-slate-50 flex items-center justify-between">
                                <div>
                                    <h3 className="text-sm font-semibold text-slate-800">备份到 Google Sheets</h3>
                                    <p className="text-[11px] text-slate-500 mt-1">本次备份将覆盖目标工作表内容</p>
                                </div>
                                <button
                                    onClick={closeBackupModal}
                                    className="p-1.5 rounded-md text-slate-400 hover:text-slate-600 hover:bg-slate-100"
                                >
                                    <X size={16} />
                                </button>
                            </div>

                            <div className="p-5 space-y-4">
                                <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-2">目标表格链接或 ID</label>
                                    <input
                                        value={backupSheetUrl}
                                        onChange={(e) => setBackupSheetUrl(e.target.value)}
                                        placeholder="https://docs.google.com/spreadsheets/d/..."
                                        disabled={isBackingUp}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-600 mb-2">写入的工作表名称</label>
                                    <input
                                        value={backupSheetName}
                                        onChange={(e) => setBackupSheetName(e.target.value)}
                                        placeholder="Sheet1"
                                        disabled={isBackingUp}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none"
                                    />
                                </div>

                                {backupProgress && (
                                    <div className="text-xs text-slate-500">
                                        已写入 {backupProgress.written.toLocaleString()} / {backupProgress.total.toLocaleString()} 行
                                    </div>
                                )}

                                {backupError && (
                                    <div className="text-xs text-red-500 bg-red-50 border border-red-100 px-3 py-2 rounded-lg">
                                        {backupError}
                                    </div>
                                )}
                            </div>

                            <div className="px-5 py-4 border-t border-slate-200 bg-slate-50 flex items-center justify-between">
                                <button
                                    onClick={handleAdvancedLogin}
                                    disabled={isBackingUp}
                                    className="text-xs text-blue-600 hover:text-blue-700"
                                >
                                    高级登录（获取写入权限）
                                </button>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={closeBackupModal}
                                        disabled={isBackingUp}
                                        className="px-3 py-1.5 text-xs rounded-md bg-slate-200 text-slate-600 hover:bg-slate-300 disabled:opacity-50"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={handleBackupToSheets}
                                        disabled={isBackingUp}
                                        className="px-3 py-1.5 text-xs rounded-md bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 flex items-center gap-1"
                                    >
                                        {isBackingUp ? <Loader2 size={12} className="animate-spin" /> : <CloudUpload size={12} />}
                                        开始备份
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </>
            )}
        </>
    );
};

export default DataSourceManager;
