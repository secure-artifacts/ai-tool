import React from 'react';
import {
    Zap, Play, Pause, Square, Trash2, Loader2, Link, FileCode,
    ClipboardCopy, LayoutGrid, Check, ChevronDown, Sparkles,
    Share2, Settings2, RotateCw, Rows3, List, CloudDownload, CloudUpload, Save, X, Pencil, Download
} from 'lucide-react';
import DropZone from './components/DropZone';
import { ImageItem, DEFAULT_PRESETS } from './types';
import { v4 as uuidv4 } from 'uuid';
import { fetchUserPresetsFromSheet, savePresetRowsToSheet } from '@/services/presetSheetService';
import { SHARED_PRESET_SHEET_CONFIG, PRESET_SCOPE_IMAGE_RECOGNITION, encodeScopedCategory, extractScopedRows } from '@/services/presetSheetConfig';

interface CompactToolbarProps {
    images: ImageItem[];
    prompt: string;
    imageModel: string;
    isProcessing: boolean;
    isPaused: boolean;
    viewMode: 'grid' | 'list' | 'compact';
    autoUploadGyazo: boolean;
    isBulkInnovating: boolean;
    copySuccess: 'links' | 'formulas' | 'results' | 'original' | null;
    presets: any[];
    templateState: any;
    unifiedPresets: any[];
    unuploadedCount: number;
    isUploading: boolean;
    setImageModel: (val: string) => void;
    setPrompt: (val: string) => void;
    setPresets: (val: any[]) => void;
    setViewMode: (val: 'grid' | 'list' | 'compact') => void;
    setAutoUploadGyazo: (val: boolean) => void;
    handleFiles: (files: File[]) => void;
    handleTextPaste: (text: string) => void;
    handleHtmlPaste: (urls: { originalUrl: string; fetchUrl: string }[]) => void;
    runAnalysis: () => void;
    handlePauseResume: () => void;
    handleStop: () => void;
    copyAllLinks: () => void;
    copyAllFormulas: () => void;
    copyAllResults: () => void;
    copyAllOriginalAndResults: () => void;
    handleBulkInnovation: () => void;
    handleSendAllToDesc: () => void;
    uploadAllUnuploadedToGyazo: () => void;
    handleResetAndRun: () => void;
    handleRetryFailedAndRun: () => void;
    setShowGlobalInnovationSettings: (val: boolean) => void;
    toggleToolbarCompact: () => void;
    setShowClearConfirm: (val: boolean) => void;
    setImages: (val: ImageItem[] | ((prev: ImageItem[]) => ImageItem[])) => void;
    showClearConfirm: boolean;
}

export default function CompactToolbar({
    images, prompt, imageModel, isProcessing, isPaused, viewMode, autoUploadGyazo,
    isBulkInnovating, copySuccess, presets, templateState, unifiedPresets,
    unuploadedCount, isUploading,
    setImageModel, setPrompt, setPresets, setViewMode, setAutoUploadGyazo,
    handleFiles, handleTextPaste, handleHtmlPaste, runAnalysis, handlePauseResume,
    handleStop, copyAllLinks, copyAllFormulas, copyAllResults, copyAllOriginalAndResults,
    handleBulkInnovation, handleSendAllToDesc, uploadAllUnuploadedToGyazo,
    handleResetAndRun, handleRetryFailedAndRun, setShowGlobalInnovationSettings,
    toggleToolbarCompact, setShowClearConfirm, setImages, showClearConfirm
}: CompactToolbarProps) {
    const pendingCount = images.filter(i => i.status === 'idle' && i.base64Data).length;
    const successCount = images.filter(i => i.status === 'success').length;
    const errorCount = images.filter(i => i.status === 'error').length;
    const totalCount = images.length;
    const hasResults = successCount > 0;
    const canBulk = images.some(i => i.status === 'success' && i.result && !(i as any).isInnovating);

    // Export function
    const handleExport = () => {
        if (!hasResults) return;
        const dataStr = JSON.stringify(images.map(img => ({
            name: img.originalInput,
            result: img.result,
            status: img.status
        })), null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = "analysis-results.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    // Dropdown States
    const [isPresetDropdownOpen, setIsPresetDropdownOpen] = React.useState(false);
    const [showPromptPopup, setShowPromptPopup] = React.useState(false);

    // Refs for click outside
    const presetDropdownRef = React.useRef<HTMLDivElement>(null);
    const promptContainerRef = React.useRef<HTMLDivElement>(null);

    // Preset Management State
    const [newPresetName, setNewPresetName] = React.useState('');
    const [isSavingPreset, setIsSavingPreset] = React.useState(false);
    const [userName, setUserName] = React.useState(() => typeof window !== 'undefined' ? localStorage.getItem('app_preset_user') || '' : '');
    const [syncState, setSyncState] = React.useState<{ op: 'load' | 'save'; status: 'loading' | 'success' | 'no-change' | 'error' } | null>(null);
    const isSyncing = syncState?.status === 'loading';

    // Listen for global user changes
    React.useEffect(() => {
        const handleStorage = () => setUserName(localStorage.getItem('app_preset_user') || '');
        window.addEventListener('storage', handleStorage);
        const interval = setInterval(() => {
            const current = localStorage.getItem('app_preset_user') || '';
            setUserName(prev => prev !== current ? current : prev);
        }, 1000);
        return () => {
            window.removeEventListener('storage', handleStorage);
            clearInterval(interval);
        };
    }, []);

    React.useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (presetDropdownRef.current && !presetDropdownRef.current.contains(event.target as Node)) {
                setIsPresetDropdownOpen(false);
                setIsSavingPreset(false);
            }
            if (promptContainerRef.current && !promptContainerRef.current.contains(event.target as Node)) {
                setShowPromptPopup(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
        };
    }, []);

    const finishSync = (op: 'load' | 'save', status: 'success' | 'no-change' | 'error') => {
        setSyncState({ op, status });
        setTimeout(() => setSyncState(null), 2000);
    };

    // Load presets from local storage on mount (duplicate logic from PromptManager to support Compact mode)
    React.useEffect(() => {
        // Only load if empty to prevent overwriting updates
        if (presets.length > 0) return;

        const saved = localStorage.getItem('ai-classifier-presets');
        if (saved) {
            try {
                setPresets(JSON.parse(saved));
            } catch (e) {
                console.error("Failed to load presets", e);
            }
        } else {
            // 使用统一的默认预设
            setPresets(DEFAULT_PRESETS);
        }
    }, []);

    const handleSyncLoad = async () => {
        if (!userName) return;
        setSyncState({ op: 'load', status: 'loading' });
        try {
            await new Promise(resolve => setTimeout(resolve, 800));
            const rows = await fetchUserPresetsFromSheet(userName, SHARED_PRESET_SHEET_CONFIG);
            const scopedRows = extractScopedRows(rows, PRESET_SCOPE_IMAGE_RECOGNITION);
            if (scopedRows.length === 0) {
                finishSync('load', 'no-change');
                return;
            }
            const newPresets = scopedRows.map(row => ({
                id: uuidv4(),
                name: row.presetLabel,
                text: row.prompt
            }));
            const existingNames = new Set(presets.map(p => p.name));
            const toAdd = newPresets.filter((p: any) => !existingNames.has(p.name));
            if (toAdd.length > 0) {
                const updated = [...presets, ...toAdd];
                setPresets(updated);
                localStorage.setItem('ai-classifier-presets', JSON.stringify(updated));
                finishSync('load', 'success');
            } else {
                finishSync('load', 'no-change');
            }
        } catch (e) {
            console.error(e);
            finishSync('load', 'error');
        }
    };

    const handleSyncSave = async () => {
        if (!userName || presets.length === 0) return;
        setSyncState({ op: 'save', status: 'loading' });
        try {
            await new Promise(resolve => setTimeout(resolve, 800));
            const rows = presets.map((p, index) => ({
                category: encodeScopedCategory(PRESET_SCOPE_IMAGE_RECOGNITION, 'Default'),
                presetLabel: p.name,
                prompt: p.text,
                presetOrder: index
            }));
            await savePresetRowsToSheet({ userName, rows, config: SHARED_PRESET_SHEET_CONFIG });
            finishSync('save', 'success');
        } catch (e) {
            console.error(e);
            finishSync('save', 'error');
        }
    };

    const handleSaveNewPreset = () => {
        if (!newPresetName.trim() || !prompt.trim()) return;
        const newPreset = { id: uuidv4(), name: newPresetName.trim(), text: prompt };
        const updated = [...presets, newPreset];
        setPresets(updated);
        localStorage.setItem('ai-classifier-presets', JSON.stringify(updated));
        setNewPresetName('');
        setIsSavingPreset(false);
    };

    const handleDeletePreset = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        const updated = presets.filter(p => p.id !== id);
        setPresets(updated);
        localStorage.setItem('ai-classifier-presets', JSON.stringify(updated));
    };

    const iconBtn = "w-8 h-8 flex items-center justify-center rounded border transition-all disabled:opacity-30";

    return (
        <div className="max-w-none mx-auto px-3 py-1.5">
            {/* 单行布局 */}
            <div className="flex items-center gap-2 flex-wrap">
                {/* 标识 */}
                <div className="flex items-center gap-1 shrink-0">
                    <div className="bg-emerald-500/20 p-1.5 rounded">
                        <Zap className="text-emerald-400 w-4 h-4" fill="currentColor" />
                    </div>
                </div>

                {/* 上传区 */}
                <div className="shrink-0 w-28">
                    <DropZone
                        onFilesDropped={handleFiles}
                        onTextPasted={handleTextPaste}
                        onHtmlPasted={handleHtmlPaste}
                        compact={true}
                    />
                </div>

                {/* 预设 - 自定义下拉菜单 */}
                <div className="relative shrink-0" ref={presetDropdownRef}>
                    <button
                        onClick={() => setIsPresetDropdownOpen(!isPresetDropdownOpen)}
                        className={`flex items-center gap-1.5 ${iconBtn} w-auto px-2 text-xs text-zinc-300 hover:text-white bg-zinc-900 border-zinc-700 hover:border-zinc-600 tooltip-bottom`}
                        data-tip="选择预设指令"
                    >
                        <span>预设</span>
                        <ChevronDown size={12} className={`transition-transform duration-200 ${isPresetDropdownOpen ? 'rotate-180' : ''}`} />
                    </button>

                    {isPresetDropdownOpen && (
                        <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 overflow-hidden flex flex-col max-h-[80vh]">
                            {/* Cloud Sync Header */}
                            <div className="flex items-center justify-between px-2 py-1.5 border-b border-zinc-700/50 bg-zinc-800/80 backdrop-blur-sm">
                                <span className="text-[0.625rem] text-zinc-500 font-medium">{userName || '未登录'}</span>
                                <div className="flex items-center gap-1">
                                    <button
                                        onClick={handleSyncLoad}
                                        disabled={isSyncing || !userName}
                                        className={`p-1 rounded text-zinc-400 hover:text-emerald-400 hover:bg-zinc-700 transition-colors disabled:opacity-30 tooltip-bottom ${syncState?.op === 'load' && syncState.status === 'success' ? 'text-emerald-400' : ''}`}
                                        data-tip="云端加载"
                                    >
                                        {syncState?.op === 'load' && syncState.status === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <CloudDownload size={14} />}
                                    </button>
                                    <button
                                        onClick={handleSyncSave}
                                        disabled={isSyncing || !userName}
                                        className={`p-1 rounded text-zinc-400 hover:text-emerald-400 hover:bg-zinc-700 transition-colors disabled:opacity-30 tooltip-bottom ${syncState?.op === 'save' && syncState.status === 'success' ? 'text-emerald-400' : ''}`}
                                        data-tip="保存云端"
                                    >
                                        {syncState?.op === 'save' && syncState.status === 'loading' ? <Loader2 size={12} className="animate-spin" /> : <CloudUpload size={14} />}
                                    </button>
                                </div>
                            </div>

                            <div className="overflow-y-auto custom-scrollbar p-1">
                                {/* 系统默认（来自反推提示词） */}
                                {unifiedPresets.filter(p => p.source === 'system').length > 0 && (
                                    <>
                                        {unifiedPresets.filter(p => p.source === 'system').map(preset => (
                                            <div
                                                key={preset.id}
                                                onClick={() => {
                                                    setPrompt(preset.text);
                                                    setIsPresetDropdownOpen(false);
                                                }}
                                                className="flex items-center justify-between p-2 hover:bg-zinc-700 rounded-md cursor-pointer group transition-colors mb-1 border-b border-zinc-700/50 pb-1"
                                            >
                                                <span className="text-xs text-emerald-400 font-medium">{preset.name}</span>
                                                <span className="text-[0.5625rem] text-zinc-600">反推</span>
                                            </div>
                                        ))}
                                    </>
                                )}

                                {/* 本地预设 */}
                                {presets.length > 0 && (
                                    <>
                                        <div className="text-[0.5625rem] text-zinc-500 px-2 py-1 uppercase tracking-wider font-semibold bg-zinc-800/80 sticky top-0 backdrop-blur-sm z-10">识别指令</div>
                                        {presets.map(preset => (
                                            <div
                                                key={preset.id}
                                                onClick={() => {
                                                    setPrompt(preset.text);
                                                    setIsPresetDropdownOpen(false);
                                                }}
                                                className="flex items-center justify-between p-2 hover:bg-zinc-700 rounded-md cursor-pointer group transition-colors relative"
                                            >
                                                <span className="text-xs text-zinc-200 truncate pr-2 flex-1">{preset.name}</span>
                                                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity absolute right-1 bg-zinc-700 px-1 rounded shadow-sm">
                                                    <button
                                                        onClick={(e) => handleDeletePreset(preset.id, e)}
                                                        className="text-zinc-400 hover:text-red-400 p-1 hover:bg-zinc-600 rounded tooltip-bottom"
                                                        data-tip="删除"
                                                    >
                                                        <Trash2 size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        ))}
                                    </>
                                )}

                                {/* 指令模版（来自提示词工具） */}
                                {templateState?.savedTemplates && templateState.savedTemplates.length > 0 && (
                                    <>
                                        <div className="text-[0.5625rem] text-zinc-500 px-2 py-1 mt-1 uppercase tracking-wider font-semibold border-t border-zinc-700/50 pt-1 bg-zinc-800/80 sticky top-0 backdrop-blur-sm z-10">创新指令</div>
                                        {templateState.savedTemplates.map((template: any) => {
                                            const templateText = template.sections
                                                .map((section: any) => (template.values[section.id] || '').trim())
                                                .filter(Boolean)
                                                .join('\n\n');
                                            return (
                                                <div
                                                    key={template.id}
                                                    onClick={() => {
                                                        if (templateText) {
                                                            setPrompt(templateText);
                                                            setIsPresetDropdownOpen(false);
                                                        }
                                                    }}
                                                    className="flex items-center justify-between p-2 hover:bg-zinc-700 rounded-md cursor-pointer group transition-colors"
                                                >
                                                    <span className="text-xs text-purple-300 truncate pr-2 flex-1">{template.name}</span>
                                                    <span className="text-[0.5625rem] text-zinc-600">模版</span>
                                                </div>
                                            );
                                        })}
                                    </>
                                )}

                                {presets.length === 0 && (!templateState?.savedTemplates || templateState.savedTemplates.length === 0) && (
                                    <p className="text-zinc-500 text-xs p-2 text-center">暂无预设</p>
                                )}
                            </div>

                            {/* Footer: Save New Preset */}
                            <div className="p-2 border-t border-zinc-700/50 bg-zinc-800/80 backdrop-blur-sm">
                                {isSavingPreset ? (
                                    <div className="flex items-center gap-1">
                                        <input
                                            autoFocus
                                            value={newPresetName}
                                            onChange={e => setNewPresetName(e.target.value)}
                                            placeholder="预设名称..."
                                            className="flex-1 bg-zinc-900 border border-zinc-600 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500"
                                            onKeyDown={e => e.key === 'Enter' && handleSaveNewPreset()}
                                        />
                                        <button onClick={handleSaveNewPreset} disabled={!newPresetName.trim()} className="p-1 text-emerald-400 hover:bg-emerald-900/30 rounded"><Check size={14} /></button>
                                        <button onClick={() => setIsSavingPreset(false)} className="p-1 text-zinc-400 hover:text-zinc-300 hover:bg-zinc-700 rounded"><X size={14} /></button>
                                    </div>
                                ) : (
                                    <button
                                        onClick={() => setIsSavingPreset(true)}
                                        disabled={!prompt.trim()}
                                        className="w-full flex items-center justify-center gap-1.5 py-1.5 text-xs text-zinc-400 hover:text-emerald-400 hover:bg-zinc-700/50 rounded transition-colors disabled:opacity-50"
                                    >
                                        <Save size={12} />
                                        <span>将当前指令存为预设</span>
                                    </button>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* 指令输入 */}
                <div className="relative" ref={promptContainerRef}>
                    <input
                        type="text"
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onFocus={() => setShowPromptPopup(true)}
                        placeholder="指令..."
                        data-tip={prompt || '输入识别指令'}
                        style={{ width: '80px', padding: '4px 8px', fontSize: '0.625rem' }}
                        className="bg-zinc-900 border border-zinc-700 text-zinc-200 rounded focus:outline-none focus:border-emerald-500"
                    />
                    {showPromptPopup && (
                        <div className="absolute top-full left-0 mt-1 w-80 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 p-2">
                            <textarea
                                autoFocus
                                value={prompt}
                                onChange={(e) => setPrompt(e.target.value)}
                                placeholder="输入详细指令..."
                                className="w-full h-32 bg-zinc-900 border border-zinc-700 rounded p-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500 resize-none custom-scrollbar"
                            />
                            <div className="flex justify-end mt-1">
                                <button
                                    onClick={() => setShowPromptPopup(false)}
                                    className="px-2 py-1 text-[0.625rem] bg-emerald-600 text-white rounded hover:bg-emerald-500"
                                >
                                    完成
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* 分隔线 */}
                <div className="w-px h-5 bg-zinc-700 shrink-0"></div>

                {/* 识别按钮 */}
                {!isProcessing ? (
                    <button
                        onClick={() => runAnalysis()}
                        disabled={!prompt.trim() || pendingCount === 0}
                        className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white text-xs font-bold rounded flex items-center gap-1 shrink-0 tooltip-bottom"
                        data-tip="开始识别"
                    >
                        <Zap size={14} fill="currentColor" /> 识别
                    </button>
                ) : (
                    <div className="flex items-center gap-0.5 shrink-0">
                        <button onClick={handlePauseResume} className="p-1.5 bg-amber-600 text-white rounded tooltip-bottom" data-tip={isPaused ? "继续" : "暂停"}>
                            {isPaused ? <Play size={16} /> : <Pause size={16} />}
                        </button>
                        <button onClick={handleStop} className="p-1.5 bg-zinc-700 text-white rounded tooltip-bottom" data-tip="停止">
                            <Square size={16} />
                        </button>
                    </div>
                )}

                {/* 清空 */}
                {images.length > 0 && !showClearConfirm && (
                    <button onClick={() => setShowClearConfirm(true)} className="text-red-400 hover:text-red-300 shrink-0 p-1 tooltip-bottom" data-tip="清空">
                        <Trash2 size={16} />
                    </button>
                )}
                {showClearConfirm && (
                    <div className="flex gap-0.5 shrink-0">
                        <button onClick={() => { setImages([]); setShowClearConfirm(false); }} className="px-1.5 py-0.5 bg-red-600 text-white text-[0.5625rem] rounded tooltip-bottom" data-tip="确认清空">清</button>
                        <button onClick={() => setShowClearConfirm(false)} className="px-1.5 py-0.5 bg-zinc-700 text-white text-[0.5625rem] rounded tooltip-bottom" data-tip="取消">✗</button>
                    </div>
                )}

                {/* 状态 */}
                <div className="flex items-center gap-1 text-xs font-mono shrink-0">
                    <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded cursor-default tooltip-bottom" data-tip="待处理">⏳{pendingCount}</span>
                    <span className="px-1.5 py-0.5 bg-emerald-500/20 text-emerald-400 rounded cursor-default tooltip-bottom" data-tip="成功">✓{successCount}</span>
                    <span className="px-1.5 py-0.5 bg-red-500/20 text-red-400 rounded cursor-default tooltip-bottom" data-tip="失败">✗{errorCount}</span>
                    <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 rounded cursor-default tooltip-bottom" data-tip="总数">Σ{totalCount}</span>
                </div>

                {/* 分隔线 */}
                <div className="w-px h-5 bg-zinc-700 shrink-0"></div>

                {/* 复制按钮 */}
                <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={copyAllLinks} disabled={images.length === 0} className={`${iconBtn} tooltip-bottom ${copySuccess === 'links' ? 'bg-emerald-600 text-white border-emerald-500' : 'text-blue-400 bg-blue-900/30 border-blue-800/50'}`} data-tip="链接">
                        {copySuccess === 'links' ? <Check size={16} /> : <Link size={16} />}
                    </button>
                    <button onClick={copyAllFormulas} disabled={images.length === 0} className={`${iconBtn} tooltip-bottom ${copySuccess === 'formulas' ? 'bg-emerald-600 text-white border-emerald-500' : 'text-orange-400 bg-orange-900/30 border-orange-800/50'}`} data-tip="公式">
                        {copySuccess === 'formulas' ? <Check size={16} /> : <FileCode size={16} />}
                    </button>
                    <button onClick={copyAllResults} disabled={!hasResults} className={`${iconBtn} tooltip-bottom ${copySuccess === 'results' ? 'bg-emerald-600 text-white border-emerald-500' : 'text-emerald-400 bg-emerald-900/30 border-emerald-800/50'}`} data-tip="结果">
                        {copySuccess === 'results' ? <Check size={16} /> : <ClipboardCopy size={16} />}
                    </button>
                    <button onClick={copyAllOriginalAndResults} disabled={!hasResults} className={`${iconBtn} tooltip-bottom ${copySuccess === 'original' ? 'bg-emerald-600 text-white border-emerald-500' : 'text-purple-400 bg-purple-900/30 border-purple-800/50'}`} data-tip="原+结果">
                        {copySuccess === 'original' ? <Check size={16} /> : <LayoutGrid size={16} />}
                    </button>
                </div>

                {/* 分隔线 */}
                <div className="w-px h-5 bg-zinc-700 shrink-0"></div>

                {/* 创新按钮 */}
                <div className="flex items-center gap-0.5 shrink-0">
                    <button onClick={handleBulkInnovation} disabled={!canBulk || isBulkInnovating} className={`${iconBtn} tooltip-bottom ${isBulkInnovating ? 'bg-pink-600 text-white border-pink-500 animate-pulse' : 'text-pink-300 bg-pink-900/30 border-pink-800/50'}`} data-tip="批量创新">
                        {isBulkInnovating ? <Loader2 size={16} className="animate-spin" /> : <Sparkles size={16} />}
                    </button>
                    <button onClick={() => setShowGlobalInnovationSettings(true)} className={`${iconBtn} tooltip-bottom text-zinc-400 bg-zinc-800 border-zinc-700`} data-tip="设置">
                        <Settings2 size={16} />
                    </button>
                    <button onClick={handleSendAllToDesc} disabled={successCount === 0} className={`${iconBtn} tooltip-bottom text-blue-300 bg-blue-900/30 border-blue-800/50`} data-tip="送去创新">
                        <Share2 size={16} />
                    </button>
                    <button onClick={handleExport} disabled={!hasResults} className={`${iconBtn} tooltip-bottom text-zinc-400 bg-zinc-800 border-zinc-700`} data-tip="导出结果">
                        <Download size={16} />
                    </button>
                    {/* 清空创新内容按钮 */}
                    <button onClick={() => setImages(prev => prev.map(img => ({ ...img, innovationItems: [], innovationOutputs: [] })))} disabled={!images.some(i => (i.innovationItems && i.innovationItems.length > 0) || (i.innovationOutputs && i.innovationOutputs.length > 0))} className={`${iconBtn} tooltip-bottom text-red-400 bg-red-900/10 border-red-900/30`} data-tip="清空创新">
                        <Trash2 size={16} />
                    </button>
                </div>

                {/* 分隔线 */}
                <div className="w-px h-5 bg-zinc-700 shrink-0"></div>

                {/* 视图切换 */}
                <div className="flex bg-zinc-900 rounded p-0.5 border border-zinc-800 shrink-0 h-8 items-center">
                    <button onClick={() => setViewMode('compact')} className={`w-7 h-7 flex items-center justify-center rounded tooltip-bottom ${viewMode === 'compact' ? 'bg-zinc-700 text-emerald-400' : 'text-zinc-500'}`} data-tip="精简"><Rows3 size={14} /></button>
                    <button onClick={() => setViewMode('list')} className={`w-7 h-7 flex items-center justify-center rounded tooltip-bottom ${viewMode === 'list' ? 'bg-zinc-700 text-emerald-400' : 'text-zinc-500'}`} data-tip="列表"><List size={14} /></button>
                    <button onClick={() => setViewMode('grid')} className={`w-7 h-7 flex items-center justify-center rounded tooltip-bottom ${viewMode === 'grid' ? 'bg-zinc-700 text-emerald-400' : 'text-zinc-500'}`} data-tip="网格"><LayoutGrid size={14} /></button>
                </div>

                {/* Gyazo */}
                <button
                    onClick={() => setAutoUploadGyazo(!autoUploadGyazo)}
                    className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors shrink-0 tooltip-bottom ${autoUploadGyazo ? 'bg-blue-600' : 'bg-zinc-700'}`}
                    data-tip="Gyazo 自动上传"
                >
                    <span className={`inline-block h-3 w-3 transform rounded-full bg-white transition-transform ${autoUploadGyazo ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                </button>
                {unuploadedCount > 0 && (
                    <button onClick={uploadAllUnuploadedToGyazo} disabled={isUploading} className="text-[0.5625rem] text-orange-400 shrink-0 tooltip-bottom" data-tip="上传所有本地图片">
                        {isUploading ? <Loader2 size={10} className="animate-spin" /> : `↑${unuploadedCount}`}
                    </button>
                )}

                {/* 展开 */}
                <button onClick={toggleToolbarCompact} className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded shrink-0 ml-auto tooltip-bottom" data-tip="展开">
                    <ChevronDown size={18} />
                </button>
            </div>
        </div>
    );
}
