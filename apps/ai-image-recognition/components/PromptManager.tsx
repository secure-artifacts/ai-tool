import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Save, Trash2, ChevronDown, MessageSquareText, Download, Upload, Pencil, X, Check, Cloud, CloudDownload, CloudUpload, Copy } from 'lucide-react';
import { Preset, DEFAULT_PRESETS } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { fetchUserPresetsFromSheet, savePresetRowsToSheet } from '@/services/presetSheetService';
import { SHARED_PRESET_SHEET_CONFIG, PRESET_SCOPE_IMAGE_RECOGNITION, encodeScopedCategory, extractScopedRows } from '@/services/presetSheetConfig';

// 统一的简单预设类型
type SimplePreset = {
    id: string;
    name: string;
    text: string;
    source: 'recognition' | 'template' | 'system';
};

interface PromptManagerProps {
    prompt: string;
    setPrompt: (p: string) => void;
    presets: Preset[];
    setPresets: (presets: Preset[]) => void;
    compact?: boolean;
    templateState?: { savedTemplates: Array<{ id: string; name: string; sections: any[]; values: Record<string, string> }> };
    unifiedPresets?: SimplePreset[];
    pureReplyMode?: boolean;
    setPureReplyMode?: (val: boolean) => void;
}

const PromptManager: React.FC<PromptManagerProps> = ({
    prompt,
    setPrompt,
    presets,
    setPresets,
    compact = false,
    templateState,
    unifiedPresets = [],
    pureReplyMode = false,
    setPureReplyMode
}) => {
    const [isDropdownOpen, setIsDropdownOpen] = useState(false);
    const [newPresetName, setNewPresetName] = useState('');
    const [isSaving, setIsSaving] = useState(false);
    const [editingPresetId, setEditingPresetId] = useState<string | null>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 大窗口编辑模式
    const [isExpandedEditorOpen, setIsExpandedEditorOpen] = useState(false);
    const [expandedPromptDraft, setExpandedPromptDraft] = useState('');

    // Cloud Sync State - Read from global app setting
    const [userName, setUserName] = useState(() => localStorage.getItem('app_preset_user') || '');
    // Unified Sync State
    type SyncOp = 'load' | 'save';
    type SyncStatus = 'loading' | 'success' | 'no-change' | 'error';
    const [syncState, setSyncState] = useState<{ op: SyncOp; status: SyncStatus } | null>(null);

    const isSyncing = syncState?.status === 'loading';

    // Helper to finish sync with status
    const finishSync = (op: SyncOp, status: 'success' | 'no-change' | 'error') => {
        setSyncState({ op, status });
        setTimeout(() => setSyncState(null), 2000);
    };

    // Listen for changes to global user
    useEffect(() => {
        const handleStorage = () => {
            setUserName(localStorage.getItem('app_preset_user') || '');
        };
        window.addEventListener('storage', handleStorage);
        // Also check periodically in case storage event doesn't fire
        const interval = setInterval(() => {
            const current = localStorage.getItem('app_preset_user') || '';
            setUserName(prev => prev !== current ? current : prev);
        }, 1000);
        return () => {
            window.removeEventListener('storage', handleStorage);
            clearInterval(interval);
        };
    }, []);

    // Load presets from local storage on mount
    // Only load if presets array is empty to prevent overwriting updates
    useEffect(() => {
        // 如果已有预设，不重新加载（防止覆盖用户修改）
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
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    const saveToLocalStorage = (newPresets: Preset[]) => {
        setPresets(newPresets);
        localStorage.setItem('ai-classifier-presets', JSON.stringify(newPresets));
    };

    const savePreset = () => {
        if (!newPresetName.trim() || !prompt.trim()) return;

        let updatedPresets: Preset[];

        if (editingPresetId) {
            // Update existing preset
            updatedPresets = presets.map(p =>
                p.id === editingPresetId
                    ? { ...p, name: newPresetName.trim(), text: prompt }
                    : p
            );
        } else {
            // Create new preset
            const newPreset: Preset = {
                id: uuidv4(),
                name: newPresetName.trim(),
                text: prompt
            };
            updatedPresets = [...presets, newPreset];
        }

        saveToLocalStorage(updatedPresets);

        // Reset state
        setNewPresetName('');
        setIsSaving(false);
        setEditingPresetId(null);
    };

    const cancelSave = () => {
        setIsSaving(false);
        setNewPresetName('');
        setEditingPresetId(null);
    };

    const handleEditPreset = (preset: Preset, e: React.MouseEvent) => {
        e.stopPropagation();
        setPrompt(preset.text);
        setNewPresetName(preset.name);
        setEditingPresetId(preset.id);
        setIsSaving(true);
        setIsDropdownOpen(false);
    };

    const deletePreset = (id: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (editingPresetId === id) {
            cancelSave();
        }
        const updated = presets.filter(p => p.id !== id);
        saveToLocalStorage(updated);
    };

    const loadPreset = (preset: Preset) => {
        setPrompt(preset.text);
        setIsDropdownOpen(false);
        if (isSaving) {
            cancelSave();
        }
    };

    const handleExport = () => {
        const dataStr = JSON.stringify(presets, null, 2);
        const blob = new Blob([dataStr], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = "ai-presets.json";
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
    };

    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const json = JSON.parse(event.target?.result as string);
                if (Array.isArray(json)) {
                    const validPresets = json.filter((p: any) => p.name && p.text).map((p: any) => ({
                        ...p,
                        id: p.id || uuidv4()
                    }));

                    if (validPresets.length === 0) {
                        console.warn("文件中未发现有效的预设数据。");
                        return;
                    }

                    const existingNames = new Set(presets.map(p => p.name));
                    const uniqueNewPresets = validPresets.filter((p: Preset) => !existingNames.has(p.name));

                    const finalPresets = [...presets, ...uniqueNewPresets];
                    saveToLocalStorage(finalPresets);

                } else {
                    console.warn("无效的文件格式。请导入导出的 .json 文件。");
                }
            } catch (err) {
                console.error("解析文件失败", err);
            }
            if (fileInputRef.current) fileInputRef.current.value = '';
        };
        reader.readAsText(file);
    };

    // Cloud Sync Handlers
    const handleSyncLoad = async () => {
        if (!userName) {
            // Silently fail or log
            console.warn("请输入用户名");
            return;
        }
        setSyncState({ op: 'load', status: 'loading' });
        const startTime = Date.now();

        try {
            // Artificial delay for better UX
            await new Promise(resolve => setTimeout(resolve, 800));

            const rows = await fetchUserPresetsFromSheet(userName, SHARED_PRESET_SHEET_CONFIG);
            const scopedRows = extractScopedRows(rows, PRESET_SCOPE_IMAGE_RECOGNITION);

            if (scopedRows.length === 0) {
                finishSync('load', 'no-change');
                return;
            }

            const newPresets: Preset[] = scopedRows.map(row => ({
                id: uuidv4(),
                name: row.presetLabel,
                text: row.prompt
            }));

            // 自动合并逻辑：保留本地同名预设，仅添加不存在的
            const existingNames = new Set(presets.map(p => p.name));
            const toAdd = newPresets.filter(p => !existingNames.has(p.name));

            if (toAdd.length > 0) {
                saveToLocalStorage([...presets, ...toAdd]);
                finishSync('load', 'success');
            } else {
                finishSync('load', 'no-change');
            }
        } catch (e: any) {
            console.error(e);
            finishSync('load', 'error');
        } finally {
            const elapsed = Date.now() - startTime;
            if (elapsed < 800) {
                await new Promise(resolve => setTimeout(resolve, 800 - elapsed));
            }
            // If status is still loading (e.g. error happened outside catch? unlikely), clear it.
            // But finishSync sets specific status. The finally block should ensure we don't get stuck in loading if we return early.
            // My code handles returns by calling finishSync before return. 
            // So strictly speaking, finally block isn't needed for state reset if all paths are covered.
            // But let's check one case: inside try block, if await throws, we go to catch -> finishSync('load', 'error').
            // The only issue is the artificial delay inside finally in previous code.
            // Here I moved artificial delay handling.
        }
    };

    const handleSyncSave = async () => {
        if (!userName) {
            console.warn("请输入用户名");
            return;
        }
        if (presets.length === 0) {
            return;
        }
        // No confirm dialog

        setSyncState({ op: 'save', status: 'loading' });
        const startTime = Date.now();

        try {
            // Artificial delay for better UX
            await new Promise(resolve => setTimeout(resolve, 800));

            const rows = presets.map((p, index) => ({
                category: encodeScopedCategory(PRESET_SCOPE_IMAGE_RECOGNITION, 'Default'),
                presetLabel: p.name,
                prompt: p.text,
                presetOrder: index
            }));

            await savePresetRowsToSheet({
                userName,
                rows,
                config: SHARED_PRESET_SHEET_CONFIG
            });
            finishSync('save', 'success');
        } catch (e: any) {
            console.error(e);
            finishSync('save', 'error');
        } finally {
            // No finally needed for state reset as finishSync handles it
        }
    };

    return (
        <div className={`
            relative
            bg-gradient-to-br from-zinc-900/95 via-zinc-900/90 to-zinc-800/80
            backdrop-blur-xl
            border border-zinc-700/50
            rounded-2xl shadow-2xl
            ${compact ? 'p-3' : 'p-5 mb-6'}
            transition-all duration-300
            hover:border-teal-500/30
            hover:shadow-teal-500/5
        `}
            style={{
                background: 'linear-gradient(135deg, rgba(24, 24, 27, 0.95) 0%, rgba(39, 39, 42, 0.9) 50%, rgba(24, 24, 27, 0.95) 100%)'
            }}
        >
            {/* 装饰性渐变光效 */}
            <div className="absolute top-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-teal-500/50 to-transparent" />
            <div className="absolute bottom-0 left-0 right-0 h-px bg-gradient-to-r from-transparent via-zinc-500/20 to-transparent" />

            {/* 头部区域 */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-4">
                    {/* 标题区域 - AI Native 风格 */}
                    <div className="flex items-center gap-2.5">
                        <div className="relative">
                            <div className="absolute inset-0 bg-teal-500/20 rounded-lg blur-md" />
                            <div className="relative flex items-center justify-center w-8 h-8 rounded-lg bg-gradient-to-br from-teal-500 to-teal-600 shadow-lg shadow-teal-500/25">
                                <MessageSquareText size={16} className="text-white" />
                            </div>
                        </div>
                        <div className="flex flex-col">
                            <span className="text-sm font-semibold text-zinc-100 tracking-tight">识别指令</span>
                            <span className="text-[10px] text-zinc-500 font-medium">AI Prompt</span>
                        </div>
                    </div>

                    {/* 纯净模式开关 - 现代化设计 */}
                    {setPureReplyMode && (
                        <div className="flex items-center gap-2 pl-4 border-l border-zinc-700/50">
                            <button
                                onClick={() => setPureReplyMode(!pureReplyMode)}
                                className={`
                                    relative inline-flex items-center rounded-full transition-all duration-300 
                                    focus:outline-none focus:ring-2 focus:ring-teal-500/50 focus:ring-offset-2 focus:ring-offset-zinc-900
                                    h-5 w-10 
                                    ${pureReplyMode
                                        ? 'bg-gradient-to-r from-teal-500 to-teal-400 shadow-lg shadow-teal-500/30'
                                        : 'bg-zinc-700 hover:bg-zinc-600'
                                    }
                                `}
                                title={pureReplyMode ? "纯净模式已开启：输出仅包含提示词，无多余说明" : "纯净模式已关闭：AI 可能输出带解释的回复"}
                            >
                                <span
                                    className={`
                                        inline-block transform rounded-full bg-white 
                                        transition-all duration-300 ease-out
                                        h-3.5 w-3.5 shadow-sm
                                        ${pureReplyMode ? 'translate-x-5' : 'translate-x-1'}
                                    `}
                                />
                            </button>
                            <span
                                className={`
                                    text-xs font-medium cursor-pointer select-none transition-colors duration-200
                                    ${pureReplyMode ? 'text-teal-400' : 'text-zinc-500 hover:text-zinc-400'}
                                `}
                                onClick={() => setPureReplyMode(!pureReplyMode)}
                            >
                                纯净模式
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Cloud Sync Tools */}
                    <div className="flex items-center gap-1 mr-2 border-r border-zinc-700 pr-2">
                        {userName ? (
                            <span className="text-[0.625rem] text-zinc-500 mr-1 max-w-20 truncate tooltip-bottom" data-tip={`同步用户: ${userName}`}>
                                {userName}
                            </span>
                        ) : (
                            <span className="text-[0.625rem] text-zinc-600 mr-1 tooltip-bottom" data-tip="请在首页设置邮箱后才能同步云端预设">
                                未登录
                            </span>
                        )}
                        <button
                            onClick={handleSyncLoad}
                            disabled={isSyncing || !userName}
                            className={`p-1.5 rounded-md transition-all duration-300 disabled:opacity-30 tooltip-bottom ${syncState?.op === 'load' && syncState.status === 'success' ? 'text-emerald-400 bg-emerald-400/10' :
                                syncState?.op === 'load' && syncState.status === 'error' ? 'text-red-400 bg-red-400/10' :
                                    syncState?.op === 'load' && syncState.status === 'no-change' ? 'text-zinc-400 bg-zinc-800' :
                                        'text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800'
                                }`}
                            data-tip={userName ? "从云端加载预设" : "请先在首页设置邮箱"}
                        >
                            {syncState?.op === 'load' && syncState.status === 'loading' ? (
                                <div className="w-3.5 h-3.5 border-2 border-zinc-500 border-t-emerald-400 rounded-full animate-spin" />
                            ) : syncState?.op === 'load' && syncState.status === 'success' ? (
                                <Check size={14} className="animate-in zoom-in duration-300" />
                            ) : syncState?.op === 'load' && syncState.status === 'error' ? (
                                <X size={14} className="animate-in zoom-in duration-300" />
                            ) : (
                                <CloudDownload size={14} />
                            )}
                        </button>
                        <button
                            onClick={handleSyncSave}
                            disabled={isSyncing || !userName}
                            className={`p-1.5 rounded-md transition-all duration-300 disabled:opacity-30 tooltip-bottom ${syncState?.op === 'save' && syncState.status === 'success' ? 'text-emerald-400 bg-emerald-400/10' :
                                syncState?.op === 'save' && syncState.status === 'error' ? 'text-red-400 bg-red-400/10' :
                                    'text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800'
                                }`}
                            data-tip={userName ? "保存预设到云端" : "请先在首页设置邮箱"}
                        >
                            {syncState?.op === 'save' && syncState.status === 'loading' ? (
                                <div className="w-3.5 h-3.5 border-2 border-zinc-500 border-t-emerald-400 rounded-full animate-spin" />
                            ) : syncState?.op === 'save' && syncState.status === 'success' ? (
                                <Check size={14} className="animate-in zoom-in duration-300" />
                            ) : syncState?.op === 'save' && syncState.status === 'error' ? (
                                <X size={14} className="animate-in zoom-in duration-300" />
                            ) : (
                                <CloudUpload size={14} />
                            )}
                        </button>
                    </div>

                    {/* Import/Export Tools */}
                    <div className="flex items-center gap-1 mr-2">
                        <button
                            onClick={handleImportClick}
                            className="p-1.5 text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800 rounded-md transition-colors tooltip-bottom"
                            data-tip="导入预设 (JSON)"
                        >
                            <Upload size={14} />
                        </button>
                        <button
                            onClick={handleExport}
                            className="p-1.5 text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800 rounded-md transition-colors tooltip-bottom"
                            data-tip="导出预设 (JSON)"
                        >
                            <Download size={14} />
                        </button>
                        <input
                            type="file"
                            ref={fileInputRef}
                            onChange={handleFileChange}
                            accept=".json"
                            className="hidden"
                        />
                    </div>

                    <div className="relative">
                        <button
                            onClick={() => setIsDropdownOpen(!isDropdownOpen)}
                            className={`
                                flex items-center gap-2 
                                text-xs font-semibold 
                                px-4 py-2 rounded-xl
                                transition-all duration-300
                                ${isDropdownOpen
                                    ? 'bg-gradient-to-r from-teal-500 to-teal-400 text-white shadow-lg shadow-teal-500/30'
                                    : 'bg-teal-500/10 text-teal-400 hover:bg-teal-500/20 hover:text-teal-300'
                                }
                            `}
                        >
                            <span>预设指令</span>
                            <ChevronDown
                                size={14}
                                className={`transition-transform duration-300 ${isDropdownOpen ? 'rotate-180' : ''}`}
                            />
                        </button>

                        {isDropdownOpen && (
                            <div className="absolute right-0 top-full mt-3 w-80 bg-zinc-900/95 backdrop-blur-xl border border-zinc-700/50 rounded-2xl shadow-2xl z-20 overflow-hidden animate-in fade-in slide-in-from-top-2 duration-200">
                                {/* 顶部装饰线 */}
                                <div className="h-px bg-gradient-to-r from-transparent via-teal-500/50 to-transparent" />

                                <div className="p-3 max-h-96 overflow-y-auto custom-scrollbar">
                                    {/* 系统默认（来自反推提示词） */}
                                    {unifiedPresets.filter(p => p.source === 'system').length > 0 && (
                                        <>
                                            <div className="text-[10px] text-teal-400/80 font-semibold px-2 py-1.5 uppercase tracking-wider flex items-center gap-1.5 mb-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-teal-500" />
                                                反推指令
                                            </div>
                                            {unifiedPresets.filter(p => p.source === 'system').map(preset => (
                                                <div
                                                    key={preset.id}
                                                    onClick={() => {
                                                        setPrompt(preset.text);
                                                        setIsDropdownOpen(false);
                                                    }}
                                                    className="flex items-center justify-between p-2.5 mb-1 hover:bg-teal-500/10 rounded-xl cursor-pointer group transition-all duration-200 border border-transparent hover:border-teal-500/20"
                                                >
                                                    <span className="text-sm text-teal-400 font-medium group-hover:text-teal-300 transition-colors">{preset.name}</span>
                                                    <span className="text-[9px] text-zinc-600 px-1.5 py-0.5 bg-zinc-800/50 rounded group-hover:bg-teal-500/10 group-hover:text-teal-500 transition-all">系统</span>
                                                </div>
                                            ))}
                                            <div className="h-px bg-zinc-700/50 my-2" />
                                        </>
                                    )}

                                    {/* 本地预设 */}
                                    {presets.length > 0 && (
                                        <>
                                            <div className="text-[10px] text-zinc-400/80 font-semibold px-2 py-1.5 uppercase tracking-wider flex items-center gap-1.5 mb-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-zinc-500" />
                                                识别指令
                                            </div>
                                            {presets.map(preset => (
                                                <div
                                                    key={preset.id}
                                                    onClick={() => loadPreset(preset)}
                                                    className="flex items-center justify-between p-2.5 mb-1 hover:bg-zinc-700/50 rounded-xl cursor-pointer group transition-all duration-200 border border-transparent hover:border-zinc-600/50"
                                                >
                                                    <span className="text-sm text-zinc-200 truncate pr-2 flex-1 group-hover:text-white transition-colors">{preset.name}</span>

                                                    <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                        <button
                                                            onClick={(e) => handleEditPreset(preset, e)}
                                                            className="text-zinc-500 hover:text-teal-400 p-1.5 hover:bg-teal-500/10 rounded-lg transition-all tooltip-bottom"
                                                            data-tip="编辑"
                                                        >
                                                            <Pencil size={12} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => deletePreset(preset.id, e)}
                                                            className="text-zinc-500 hover:text-red-400 p-1.5 hover:bg-red-500/10 rounded-lg transition-all tooltip-bottom"
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
                                            <div className="h-px bg-zinc-700/50 my-2" />
                                            <div className="text-[10px] text-purple-400/80 font-semibold px-2 py-1.5 uppercase tracking-wider flex items-center gap-1.5 mb-1">
                                                <span className="w-1.5 h-1.5 rounded-full bg-purple-500" />
                                                创新指令
                                            </div>
                                            {templateState.savedTemplates.map(template => {
                                                // 将模版内容拼接成字符串
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
                                                                setIsDropdownOpen(false);
                                                            }
                                                        }}
                                                        className="flex items-center justify-between p-2.5 mb-1 hover:bg-purple-500/10 rounded-xl cursor-pointer group transition-all duration-200 border border-transparent hover:border-purple-500/20"
                                                    >
                                                        <span className="text-sm text-purple-300 truncate pr-2 flex-1 group-hover:text-purple-200 transition-colors">{template.name}</span>
                                                        <span className="text-[9px] text-zinc-600 px-1.5 py-0.5 bg-zinc-800/50 rounded group-hover:bg-purple-500/10 group-hover:text-purple-400 transition-all">模版</span>
                                                    </div>
                                                );
                                            })}
                                        </>
                                    )}

                                    {presets.length === 0 && (!templateState?.savedTemplates || templateState.savedTemplates.length === 0) && (
                                        <p className="text-zinc-500 text-xs p-2 text-center">暂无预设</p>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>

            {/* 输入区域 */}
            <div className="relative">
                <div className="relative">
                    <textarea
                        value={prompt}
                        onChange={(e) => setPrompt(e.target.value)}
                        onDoubleClick={() => {
                            setExpandedPromptDraft(prompt);
                            setIsExpandedEditorOpen(true);
                        }}
                        placeholder="✨ 选择预设指令或手动输入，用于反推提示词或其他图片识别需求。建议实测不同预设观察效果（双击展开大窗口）"
                        className={`
                            w-full 
                            bg-zinc-950/80 
                            backdrop-blur-sm
                            border border-zinc-700/60 
                            text-zinc-100 
                            rounded-xl 
                            p-4 pt-3
                            text-sm leading-relaxed
                            placeholder:text-zinc-500/80
                            focus:ring-2 focus:ring-teal-500/30 
                            focus:border-teal-500/50
                            outline-none 
                            transition-all duration-300
                            ${compact ? 'min-h-[80px]' : 'min-h-[120px]'} 
                            resize-y 
                            custom-scrollbar
                            ${editingPresetId ? 'border-teal-500/50 ring-2 ring-teal-500/20' : ''}
                        `}
                        data-tip="双击展开大窗口编辑" className="tooltip-bottom"
                    />

                    {/* 字符计数和工具栏 */}
                    <div className="absolute bottom-3 left-4 right-3 flex items-center justify-between">
                        <span className={`text-[10px] font-medium transition-colors ${prompt.length > 0 ? 'text-zinc-500' : 'text-transparent'}`}>
                            {prompt.length} 字符
                        </span>

                        <div className="flex items-center gap-2">
                            {isSaving ? (
                                <div className="flex items-center gap-2 bg-zinc-900/95 backdrop-blur-sm p-2 rounded-lg border border-zinc-700/50 shadow-xl animate-in fade-in slide-in-from-right-4 duration-200">
                                    {editingPresetId && (
                                        <span className="text-[10px] text-teal-400 font-bold px-1.5 py-0.5 bg-teal-500/10 rounded">编辑中</span>
                                    )}
                                    <input
                                        type="text"
                                        autoFocus
                                        value={newPresetName}
                                        onChange={(e) => setNewPresetName(e.target.value)}
                                        placeholder="输入预设名称..."
                                        className="bg-transparent text-xs text-zinc-100 outline-none px-2 w-32 border-b border-zinc-600 focus:border-teal-500 transition-colors"
                                    />
                                    <button
                                        onClick={savePreset}
                                        className="p-1.5 text-zinc-400 hover:text-teal-400 hover:bg-teal-500/10 rounded-md transition-all"
                                        data-tip="确认保存" className="tooltip-bottom"
                                    >
                                        <Check size={14} />
                                    </button>
                                    <button
                                        onClick={cancelSave}
                                        className="p-1.5 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 rounded-md transition-all"
                                        data-tip="取消" className="tooltip-bottom"
                                    >
                                        <X size={14} />
                                    </button>
                                </div>
                            ) : (
                                <button
                                    onClick={() => setIsSaving(true)}
                                    disabled={!prompt.trim()}
                                    className={`
                                        flex items-center gap-1.5 
                                        text-xs font-medium
                                        px-3 py-1.5 rounded-lg
                                        transition-all duration-200
                                        disabled:opacity-30 disabled:cursor-not-allowed
                                        ${prompt.trim()
                                            ? 'text-teal-400 bg-teal-500/10 hover:bg-teal-500/20 hover:text-teal-300 hover:shadow-lg hover:shadow-teal-500/10'
                                            : 'text-zinc-600 bg-zinc-800/50'
                                        }
                                    `}
                                >
                                    <Save size={12} /> 保存预设
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* 大窗口编辑器弹窗 - 使用 Portal 渲染到 body */}
            {isExpandedEditorOpen && createPortal(
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    className="z-max"
                    onClick={() => setIsExpandedEditorOpen(false)}
                >
                    <div
                        className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-full max-w-4xl max-h-[85vh] flex flex-col overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 弹窗头部 */}
                        <div className="flex items-center justify-between px-5 py-4 border-b border-zinc-800">
                            <div className="flex items-center gap-3">
                                <MessageSquareText size={20} className="text-emerald-400" />
                                <h3 className="text-lg font-semibold text-zinc-100">编辑识别指令</h3>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-500">按 Esc 取消 · Enter+Cmd 确认</span>
                                <button
                                    onClick={() => setIsExpandedEditorOpen(false)}
                                    className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* 编辑区域 */}
                        <div className="flex-1 p-5 overflow-hidden">
                            <textarea
                                autoFocus
                                value={expandedPromptDraft}
                                onChange={(e) => setExpandedPromptDraft(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Escape') {
                                        setIsExpandedEditorOpen(false);
                                    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                                        setPrompt(expandedPromptDraft);
                                        setIsExpandedEditorOpen(false);
                                    }
                                }}
                                placeholder="在此输入详细的 AI 识别指令...

例如:
- 分析图片中的场景和物体
- 提取图片中的所有文字
- 判断图片的风格（动漫/写实/插画）
- 生成适合 AI 图像生成的英文提示词"
                                className="w-full h-full min-h-[400px] bg-zinc-950 border border-zinc-700 text-zinc-100 rounded-xl p-4 text-sm focus:ring-2 focus:ring-emerald-500/50 focus:border-emerald-500 outline-none resize-none custom-scrollbar leading-relaxed"
                            />
                        </div>

                        {/* 弹窗底部按钮 */}
                        <div className="flex items-center justify-between px-5 py-4 border-t border-zinc-800 bg-zinc-900/50">
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-zinc-500">
                                    {expandedPromptDraft.length} 字符
                                </span>
                                <button
                                    onClick={async () => {
                                        try {
                                            await navigator.clipboard.writeText(expandedPromptDraft);
                                            // 使用简易的 toast 提示
                                            const btn = document.activeElement as HTMLButtonElement;
                                            if (btn) {
                                                const originalTitle = btn.title;
                                                btn.title = '已复制!';
                                                btn.classList.add('text-emerald-400');
                                                setTimeout(() => {
                                                    btn.title = originalTitle;
                                                    btn.classList.remove('text-emerald-400');
                                                }, 1500);
                                            }
                                        } catch (err) {
                                            console.error('复制失败', err);
                                        }
                                    }}
                                    disabled={!expandedPromptDraft.trim()}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                                    data-tip="复制指令内容" className="tooltip-bottom"
                                >
                                    <Copy size={14} />
                                    复制
                                </button>
                            </div>
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={() => setIsExpandedEditorOpen(false)}
                                    className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={() => {
                                        setPrompt(expandedPromptDraft);
                                        setIsExpandedEditorOpen(false);
                                    }}
                                    className="px-5 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors flex items-center gap-2"
                                >
                                    <Check size={16} />
                                    确认修改
                                </button>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}
        </div>
    );
};

export default PromptManager;
