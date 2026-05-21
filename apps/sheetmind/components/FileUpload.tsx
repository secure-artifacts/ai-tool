import React, { useCallback, useState, useEffect, useRef } from 'react';
import { Upload, FileSpreadsheet, Link as LinkIcon, Loader2, Clipboard, AlertCircle, Info, LogIn, Check, X, Database, Cloud, ChevronRight, HardDrive, Download } from 'lucide-react';
import { readWorkbookFromFile, fetchWorkbookFromUrl, readWorkbookFromString, readWorkbookFromHtml, fetchWorkbookWithAuth, fetchGoogleSpreadsheetMetadata, filterWorkbook, parseMultipleSheetsAsync, fetchWorkbookSmart, fetchGoogleSpreadsheetInfoWithApiKey } from '../utils/parser';
import { getGoogleAccessToken, signInWithGoogle } from '@/services/authService';
import { addDataSource, addLocalDataSource, loadDataSources, saveDataSources, DataSource } from './DataSourceManager';
import { loadDataSourcesFromCloud, mergeDataSources, isUserLoggedIn } from '../services/firebaseService';
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Workbook = any;

const extractSpreadsheetId = (url: string): string | null => {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match?.[1] || null;
};

const isGenericGoogleSheetName = (name: string): boolean => {
    return /^Google Sheet(?:\s*\([^)]+\))?$/.test(name.trim());
};

interface FileUploadProps {
    onWorkbookLoaded: (workbook: Workbook, fileName: string, sourceUrl?: string) => void;
    isLoading: boolean;
    onSelectSource?: (source: DataSource) => void; // Optional callback to select a saved source
}

const FileUpload: React.FC<FileUploadProps> = ({ onWorkbookLoaded, isLoading: parentLoading, onSelectSource }) => {
    const [url, setUrl] = useState('');
    const [pasteContent, setPasteContent] = useState('');
    const [localLoading, setLocalLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [pasteHint, setPasteHint] = useState<string | null>(null);
    const [loadProgress, setLoadProgress] = useState<string | null>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Sheet selection state
    const [selectingSheets, setSelectingSheets] = useState(false);
    const [sheetCandidates, setSheetCandidates] = useState<string[]>([]);
    const [selectedSheetNames, setSelectedSheetNames] = useState<string[]>([]);
    const [pendingWorkbook, setPendingWorkbook] = useState<Workbook | null>(null);
    const [pendingUrl, setPendingUrl] = useState<string>('');
    const [pendingSpreadsheetTitle, setPendingSpreadsheetTitle] = useState<string>('Google Sheet');
    const [isAuthMode, setIsAuthMode] = useState(false);

    // Recent data sources (loaded from local + cloud)
    const [recentSources, setRecentSources] = useState<DataSource[]>([]);
    const [loadingSources, setLoadingSources] = useState(true);
    const [loadingSourceId, setLoadingSourceId] = useState<string | null>(null); // Track which source is being loaded
    const [cachingSourceId, setCachingSourceId] = useState<string | null>(null); // Track which source is being cached
    const [cachedSourceIds, setCachedSourceIds] = useState<Set<string>>(new Set()); // Track cached sources
    const [batchCaching, setBatchCaching] = useState(false); // Batch caching in progress

    const isLoading = parentLoading || localLoading;

    // 检查是否在Electron环境中
    const isElectron = typeof window !== 'undefined' && (window as any).electronAPI;

    // Load recent sources on mount
    useEffect(() => {
        const hydrateGenericGoogleSheetNames = async (sources: DataSource[]): Promise<DataSource[]> => {
            const hydrated = await Promise.all(sources.map(async source => {
                if (source.type !== 'google-sheets' || !isGenericGoogleSheetName(source.name)) return source;

                const spreadsheetId = extractSpreadsheetId(source.url);
                if (!spreadsheetId) return source;

                try {
                    const info = await fetchGoogleSpreadsheetInfoWithApiKey(spreadsheetId);
                    return { ...source, name: info.title };
                } catch (err) {
                    console.warn('[FileUpload] Failed to hydrate spreadsheet title:', err);
                    return source;
                }
            }));

            const changed = hydrated.some((source, index) => source.name !== sources[index]?.name);
            if (changed) {
                saveDataSources(hydrated);
            }
            return hydrated;
        };

        const loadSources = async () => {
            setLoadingSources(true);
            const local = loadDataSources();
            let sourcesToShow = local;

            if (isUserLoggedIn()) {
                try {
                    const cloud = await loadDataSourcesFromCloud();
                    const merged = mergeDataSources(local, cloud);
                    sourcesToShow = merged as DataSource[];
                } catch (err) {
                    console.error('[FileUpload] Cloud load failed:', err);
                }
            }

            const hydratedSources = await hydrateGenericGoogleSheetNames(sourcesToShow);
            setRecentSources(hydratedSources);
            setLoadingSources(false);

            // 检查哪些数据源已经被缓存（仅Electron环境）
            if (isElectron) {
                try {
                    const cacheList = await (window as any).electronAPI.listCache();
                    if (cacheList.success && cacheList.files) {
                        const cachedIds = new Set<string>();
                        for (const file of cacheList.files) {
                            // 缓存key格式: datasource_{id}
                            if (file.key.startsWith('datasource_')) {
                                const id = file.key.replace('datasource_', '');
                                cachedIds.add(id);
                            }
                        }
                        setCachedSourceIds(cachedIds);
                    }
                } catch (err) {
                    console.error('[Cache] Failed to check cache:', err);
                }
            }
        };
        loadSources();
    }, [isElectron]);

    useEffect(() => {
        if (!parentLoading) {
            setLoadingSourceId(null);
        }
    }, [parentLoading]);

    // Listen for paste events to capture HTML format from Google Sheets
    useEffect(() => {
        const handleGlobalPaste = async (e: ClipboardEvent) => {
            // Only handle when textarea is focused
            if (document.activeElement !== textareaRef.current) return;

            const clipboardData = e.clipboardData;
            if (!clipboardData) return;

            // Check for HTML format (Google Sheets includes formulas in HTML)
            const htmlData = clipboardData.getData('text/html');
            const textData = clipboardData.getData('text/plain');

            if (htmlData && htmlData.includes('google-sheets-html-origin')) {
                // This is from Google Sheets - use HTML format
                e.preventDefault();
                setPasteHint('检测到 Google Sheets 格式，正在解析...');
                setLocalLoading(true);
                setError(null);

                try {
                    const wb = await readWorkbookFromHtml(htmlData);
                    const localSource = addLocalDataSource({
                        name: "Google Sheets 粘贴的数据",
                        type: 'manual'
                    });
                    onWorkbookLoaded(wb, localSource.name, localSource.url);
                    setRecentSources(prev => [localSource, ...prev]);
                    setPasteContent('');
                    setPasteHint(null);
                } catch (err: unknown) {
                    console.error('HTML parse error:', err);
                    // Fallback to text parsing
                    if (textData) {
                        try {
                            const wb = await readWorkbookFromString(textData);
                            const localSource = addLocalDataSource({
                                name: "粘贴的数据",
                                type: 'manual'
                            });
                            onWorkbookLoaded(wb, localSource.name, localSource.url);
                            setRecentSources(prev => [localSource, ...prev]);
                            setPasteContent('');
                            setPasteHint(null);
                        } catch (textErr) {
                            setError("无法解析粘贴的内容。请尝试直接输入链接。");
                            setPasteHint(null);
                        }
                    } else {
                        setError("无法解析 Google Sheets 数据。请尝试直接输入链接。");
                        setPasteHint(null);
                    }
                } finally {
                    setLocalLoading(false);
                }
            }
        };

        document.addEventListener('paste', handleGlobalPaste);
        return () => document.removeEventListener('paste', handleGlobalPaste);
    }, [onWorkbookLoaded]);

    const handleFileChange = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
        const file = event.target.files?.[0];
        if (file) {
            setLocalLoading(true);
            setError(null);
            try {
                const wb = await readWorkbookFromFile(file);
                const localSource = addLocalDataSource({
                    name: file.name,
                    type: 'local-file'
                });
                onWorkbookLoaded(wb, localSource.name, localSource.url);
                setRecentSources(prev => [localSource, ...prev]);
            } catch (err) {
                setError("解析文件出错。请确保是有效的 Excel 或 CSV 文件。");
                console.error(err);
            } finally {
                setLocalLoading(false);
            }
        }
    }, [onWorkbookLoaded]);

    const handleUrlSubmit = async () => {
        if (!url.trim()) return;
        setLocalLoading(true);
        setError(null);
        setLoadProgress('正在准备加载...');
        setPendingUrl(url);

        try {
            // Use Smart loader: API Key first, then no OAuth fallback for now
            // This removes the 100-user limit while still supporting all public/shared spreadsheets
            setIsAuthMode(false);
            setLoadProgress('正在加载...');
            const wb = await fetchWorkbookSmart(url, null, (msg) => {
                setLoadProgress(msg);
            });

            let spreadsheetTitle = 'Google Sheet';
            const spreadsheetId = extractSpreadsheetId(url);
            if (spreadsheetId) {
                try {
                    const info = await fetchGoogleSpreadsheetInfoWithApiKey(spreadsheetId);
                    spreadsheetTitle = info.title;
                } catch (metadataErr) {
                    console.warn('[FileUpload] Failed to fetch spreadsheet title:', metadataErr);
                }
            }

            setPendingSpreadsheetTitle(spreadsheetTitle);
            setPendingWorkbook(wb);
            setSheetCandidates(wb.SheetNames);
            setSelectedSheetNames(wb.SheetNames);
            setSelectingSheets(true);
            setLoadProgress(null);
            setLocalLoading(false);
        } catch (err: unknown) {
            setLoadProgress(null);
            let errorMessage = "无法加载表格。";
            if (err instanceof Error) {
                errorMessage = err.message;
            }
            setError(errorMessage);
            setLocalLoading(false);
        }
    };

    const handleConfirmSheetSelection = async () => {
        if (selectedSheetNames.length === 0) {
            setError("请至少选择一个工作表");
            return;
        }

        setLocalLoading(true);
        setLoadProgress('正在加载选中的数据...');

        try {
            // Always use public API mode (filter from already loaded workbook)
            if (!pendingWorkbook) throw new Error("加载失败，请重试");
            const finalWorkbook = filterWorkbook(pendingWorkbook, selectedSheetNames);

            // Save data source with sheet selection
            const dataSource = addDataSource({
                name: pendingSpreadsheetTitle,
                url: pendingUrl,
                type: 'google-sheets',
                selectedSheets: selectedSheetNames
            });

            onWorkbookLoaded(finalWorkbook, pendingSpreadsheetTitle, pendingUrl);
            setRecentSources(prev => [dataSource, ...prev.filter(source => source.id !== dataSource.id)]);

            setUrl('');
            setSelectingSheets(false);
            setPendingWorkbook(null);
            setPendingSpreadsheetTitle('Google Sheet');
            setLoadProgress(null);
        } catch (err: unknown) {
            let errorMessage = "加载失败。";
            if (err instanceof Error) {
                errorMessage = err.message;
            }
            setError(errorMessage);
        } finally {
            setLocalLoading(false);
        }
    };

    const toggleSheetSelection = (name: string) => {
        setSelectedSheetNames(prev =>
            prev.includes(name)
                ? prev.filter(n => n !== name)
                : [...prev, name]
        );
    };

    const handleGoogleLogin = async () => {
        try {
            await signInWithGoogle();
            // After login, the access token will be available
        } catch (err) {
            console.error('Google login failed:', err);
        }
    };

    const handlePasteSubmit = async () => {
        if (!pasteContent.trim()) return;
        setLocalLoading(true);
        setError(null);
        try {
            const wb = await readWorkbookFromString(pasteContent);
            const localSource = addLocalDataSource({
                name: "粘贴的数据",
                type: 'manual'
            });
            onWorkbookLoaded(wb, localSource.name, localSource.url);
            setRecentSources(prev => [localSource, ...prev]);
            setPasteContent(""); // Clear after success
        } catch (err: unknown) {
            let errorMessage = "无法解析粘贴的内容。";
            if (err instanceof Error) {
                errorMessage = err.message;
            }
            setError(errorMessage);
        } finally {
            setLocalLoading(false);
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

    // 批量缓存所有数据源
    const handleBatchCache = async () => {
        if (!isElectron) {
            alert('缓存功能仅在桌面版可用');
            return;
        }

        const googleSources = recentSources.filter(source => source.type === 'google-sheets');
        if (googleSources.length === 0) {
            alert('暂无可缓存的 Google Sheets 数据源');
            return;
        }

        const accessToken = getGoogleAccessToken();
        // 对于升级旧缓存，不需要登录

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
                        }
                    } else {
                        needsCache = true;
                    }
                } catch (err) {
                    needsCache = true;
                }
            }

            if (!needsCache) continue;

            try {
                setCachingSourceId(source.id);

                // 如果有旧缓存的 workbook，使用它；否则需要重新加载
                let wb = existingCache?.workbook;
                if (!wb) {
                    if (!accessToken) {
                        continue; // 跳过需要登录的新缓存
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

    // Sheet Selection UI
    if (selectingSheets) {
        return (
            <div className="w-full max-w-lg mx-auto bg-white rounded-2xl shadow-xl border border-slate-200 overflow-hidden">
                <div className="px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-blue-500 to-indigo-500">
                    <h3 className="text-lg font-bold text-white">选择要导入的工作表</h3>
                    <p className="text-xs text-blue-100 mt-1">
                        {isAuthMode ? '✨ API 模式：仅下载选中的分页，速度更快' : '📦 公开模式：已下载全部，选择后进行过滤'}
                    </p>
                </div>

                <div className="max-h-[300px] overflow-y-auto p-3">
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

                <div className="p-4 border-t border-slate-200 flex justify-between items-center bg-slate-50">
                    <span className="text-xs text-slate-500">
                        已选 {selectedSheetNames.length} / {sheetCandidates.length} 个工作表
                    </span>
                    <div className="flex gap-2">
                        <button
                            onClick={() => {
                                setSelectingSheets(false);
                                setPendingWorkbook(null);
                            }}
                            className="px-4 py-2 text-slate-600 bg-white border border-slate-300 rounded-lg text-sm hover:bg-slate-100"
                        >
                            取消
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
            </div>
        );
    }

    return (
        <div className="w-full max-w-3xl mx-auto space-y-6 pt-6">
            {/* Recent Data Sources - Quick Access */}
            {onSelectSource && (
                <div className="bg-gradient-to-r from-emerald-50 to-teal-50 border border-emerald-200 rounded-xl p-4 overflow-visible">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-2">
                            <Database size={16} className="text-emerald-600" />
                            <span className="text-sm font-medium text-emerald-800">最近的数据源</span>
                            {isUserLoggedIn() && (
                                <span className="flex items-center gap-1 text-[10px] px-1.5 py-0.5 bg-emerald-100 text-emerald-600 rounded-full">
                                    <Cloud size={10} />
                                    云同步
                                </span>
                            )}
                        </div>
                        <div className="flex items-center gap-2">
                            {loadingSources && <Loader2 size={14} className="animate-spin text-emerald-500" />}
                            {isElectron && recentSources.some(source => source.type === 'google-sheets') && (
                                <button
                                    onClick={handleBatchCache}
                                    disabled={batchCaching}
                                    className="flex items-center gap-1 px-2 py-1 text-[10px] bg-amber-100 hover:bg-amber-200 text-amber-700 rounded-lg transition-colors disabled:opacity-50 tooltip-bottom"
                                     data-tip="批量缓存所有数据源到本地"
                                >
                                    {batchCaching ? <Loader2 size={10} className="animate-spin" /> : <Download size={10} />}
                                    批量缓存
                                </button>
                            )}
                        </div>
                    </div>

                    {/* Show data sources or login prompt */}
                    {recentSources.length > 0 ? (
                        <div className="space-y-2 max-h-120 overflow-y-auto">
                            {recentSources.map(source => {
                                const isActive = loadingSourceId === source.id;
                                const isCaching = cachingSourceId === source.id;
                                const isCached = cachedSourceIds.has(source.id);
                                return (
                                    <div
                                        key={source.id}
                                        className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-left transition-all group ${isActive
                                            ? 'bg-blue-50 border-2 border-blue-400 ring-2 ring-blue-100'
                                            : 'bg-white hover:bg-emerald-50 border border-emerald-100'
                                            }`}
                                    >
                                        <button
                                            onClick={() => {
                                                if (parentLoading) return;
                                                setLoadingSourceId(source.id);
                                                onSelectSource(source);
                                            }}
                                            disabled={isActive || parentLoading}
                                            className="flex-1 min-w-0 text-left"
                                        >
                                            <p className={`text-sm font-medium truncate ${isActive ? 'text-blue-700' : 'text-slate-700'}`}>{source.name}</p>
                                            <p className="text-[10px] text-slate-400 truncate">
                                                {source.type === 'google-sheets' ? source.url : '本地数据（离线缓存）'}
                                            </p>
                                        </button>
                                        <div className="flex items-center gap-1 shrink-0">
                                            {isElectron && source.type === 'google-sheets' && (
                                                <button
                                                    onClick={(e) => handleCacheSource(source, e)}
                                                    disabled={isCaching || isCached}
                                                    className={`p-1.5 rounded-lg transition-colors ${isCached
                                                        ? 'text-green-500 bg-green-50'
                                                        : 'text-amber-500 hover:bg-amber-50'} disabled:opacity-50`}
                                                    title={isCached ? '已缓存' : '缓存到本地'}
                                                >
                                                    {isCaching ? <Loader2 size={14} className="animate-spin" /> : isCached ? <Check size={14} /> : <HardDrive size={14} />}
                                                </button>
                                            )}
                                            {isActive ? (
                                                <Loader2 size={16} className="animate-spin text-blue-500" />
                                            ) : (
                                                <ChevronRight size={16} className="text-slate-300 group-hover:text-emerald-500 transition-colors" />
                                            )}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : !loadingSources && (
                        <div className="text-center py-3">
                            {!isUserLoggedIn() ? (
                                <p className="text-xs text-slate-500">请在软件主界面登录 Google 账号以同步数据源</p>
                            ) : (
                                <div className="space-y-1">
                                    <p className="text-xs text-slate-400">暂无保存的数据源</p>
                                    <p className="text-[10px] text-slate-300">加载任意 Google Sheet 后会自动保存并同步到云端</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* File Dropzone */}
            <div className="flex flex-col items-center justify-center w-full h-24 border-2 border-slate-300 border-dashed rounded-xl cursor-pointer bg-slate-50 hover:bg-slate-100 transition-colors relative group">
                {isLoading ? (
                    <div className="flex flex-col items-center animate-pulse">
                        <FileSpreadsheet className="w-10 h-10 text-blue-500 mb-2" />
                        <p className="text-sm text-slate-500">{loadProgress || '正在处理数据...'}</p>
                    </div>
                ) : (
                    <label htmlFor="dropzone-file" className="flex flex-col items-center justify-center w-full h-full cursor-pointer">
                        <div className="flex items-center gap-3">
                            <div className="bg-white p-2 rounded-full shadow-sm group-hover:scale-110 transition-transform">
                                <Upload className="w-5 h-5 text-blue-500" />
                            </div>
                            <div>
                                <p className="text-sm text-slate-600 font-medium">点击上传 或拖拽文件至此</p>
                                <p className="text-xs text-slate-400">支持 Excel (.xlsx) 或 CSV</p>
                            </div>
                        </div>
                        <input
                            id="dropzone-file"
                            type="file"
                            className="hidden"
                            accept=".csv, application/vnd.openxmlformats-officedocument.spreadsheetml.sheet, application/vnd.ms-excel"
                            onChange={handleFileChange}
                        />
                    </label>
                )}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                {/* URL Input */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col justify-between h-full">
                    <div>
                        <label className="block text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                            <LinkIcon size={16} className="text-blue-600" />
                            Google 表格链接
                        </label>
                        <input
                            type="text"
                            value={url}
                            onChange={(e) => setUrl(e.target.value)}
                            placeholder="https://docs.google.com/spreadsheets/d/..."
                            className="w-full px-3 py-2 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500 outline-none mb-3"
                            disabled={isLoading}
                        />
                        <div className="flex items-center justify-between mb-4">
                            <p className="text-xs text-slate-400">
                                {getGoogleAccessToken()
                                    ? '✅ 已登录 - 支持快速选页和超大表格'
                                    : '在主界面登录 Google 以支持快速选页'}
                            </p>
                        </div>
                        {loadProgress && (
                            <div className="mb-3 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg flex items-center gap-2">
                                <Loader2 size={14} className="animate-spin" />
                                {loadProgress}
                            </div>
                        )}
                    </div>
                    <button
                        onClick={handleUrlSubmit}
                        disabled={!url.trim() || isLoading}
                        className="w-full bg-blue-600 text-white px-4 py-2 rounded-lg hover:bg-blue-700 disabled:opacity-50 text-sm font-medium transition-colors flex justify-center items-center gap-2"
                    >
                        {isLoading ? <Loader2 className="animate-spin" size={16} /> : "下一步：选择分页"}
                    </button>
                </div>

                {/* Paste Input */}
                <div className="bg-white p-5 rounded-xl border border-slate-200 shadow-sm flex flex-col h-full">
                    <label className="block text-sm font-medium text-slate-700 mb-3 flex items-center gap-2">
                        <Clipboard size={16} className="text-purple-600" />
                        直接粘贴数据
                        <span className="text-xs text-purple-400 font-normal">(支持 Google Sheets 公式)</span>
                    </label>
                    {pasteHint && (
                        <div className="mb-2 text-xs text-blue-600 bg-blue-50 px-3 py-2 rounded-lg flex items-center gap-2">
                            <Info size={14} />
                            {pasteHint}
                        </div>
                    )}
                    <textarea
                        ref={textareaRef}
                        value={pasteContent}
                        onChange={(e) => setPasteContent(e.target.value)}
                        placeholder="从 Google Sheets / Excel 复制数据，然后在此处 Ctrl+V...&#10;&#10;提示：包含 IMAGE 公式的单元格也能被正确读取！"
                        className="flex-1 w-full px-3 py-2 mb-3 border border-slate-300 rounded-lg text-xs font-mono focus:ring-2 focus:ring-purple-500 outline-none resize-none"
                        disabled={isLoading}
                        style={{ minHeight: '120px' }}
                    />
                    <button
                        onClick={handlePasteSubmit}
                        disabled={!pasteContent.trim() || isLoading}
                        className="w-full bg-slate-800 text-white px-4 py-2 rounded-lg hover:bg-slate-900 disabled:opacity-50 text-sm font-medium transition-colors flex justify-center items-center gap-2"
                    >
                        {isLoading ? <Loader2 className="animate-spin" size={16} /> : "解析文本"}
                    </button>
                </div>
            </div>

            {error && (
                <div className="text-sm text-red-600 bg-red-50 p-4 rounded-xl border border-red-100 flex items-start gap-3">
                    <AlertCircle className="shrink-0 mt-0.5" size={18} />
                    <div>
                        <span className="font-bold block">加载失败</span>
                        {error}
                    </div>
                </div>
            )}
        </div>
    );
};

export default FileUpload;
