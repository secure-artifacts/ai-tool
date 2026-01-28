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

                    console.log(`成功导入 ${uniqueNewPresets.length} 个预设。`);
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
        <div className={`bg-zinc-900 border border-zinc-800 rounded-xl shadow-sm ${compact ? 'p-3' : 'p-4 mb-6'}`}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-3">
                    <label className="text-zinc-400 text-sm font-medium flex items-center gap-2">
                        <MessageSquareText size={16} />
                        识别指令 (Prompt)
                    </label>

                    {/* 纯净模式开关 */}
                    {setPureReplyMode && (
                        <div className="flex items-center gap-1.5 border-l border-zinc-700 pl-3">
                            <button
                                onClick={() => setPureReplyMode(!pureReplyMode)}
                                className={`relative inline-flex items-center rounded-full transition-colors focus:outline-none h-4 w-7 ${pureReplyMode ? 'bg-emerald-600' : 'bg-zinc-700'}`}
                                title={pureReplyMode ? "纯净模式已开启：输出仅包含提示词，无多余说明" : "纯净模式已关闭：AI 可能输出带解释的回复"}
                            >
                                <span
                                    className={`inline-block transform rounded-full bg-white transition-transform h-2.5 w-2.5 ${pureReplyMode ? 'translate-x-3.5' : 'translate-x-0.5'}`}
                                />
                            </button>
                            <span
                                className={`text-[0.625rem] font-medium cursor-pointer select-none ${pureReplyMode ? 'text-emerald-400' : 'text-zinc-500'}`}
                                onClick={() => setPureReplyMode(!pureReplyMode)}
                                title={pureReplyMode ? "纯净模式已开启：输出仅包含提示词，无多余说明" : "纯净模式已关闭：AI 可能输出带解释的回复"}
                            >
                                纯净
                            </span>
                        </div>
                    )}
                </div>

                <div className="flex items-center gap-2">
                    {/* Cloud Sync Tools */}
                    <div className="flex items-center gap-1 mr-2 border-r border-zinc-700 pr-2">
                        {userName ? (
                            <span className="text-[0.625rem] text-zinc-500 mr-1 max-w-20 truncate" title={`同步用户: ${userName}`}>
                                {userName}
                            </span>
                        ) : (
                            <span className="text-[0.625rem] text-zinc-600 mr-1" title="请在首页设置邮箱后才能同步云端预设">
                                未登录
                            </span>
                        )}
                        <button
                            onClick={handleSyncLoad}
                            disabled={isSyncing || !userName}
                            className={`p-1.5 rounded-md transition-all duration-300 disabled:opacity-30 ${syncState?.op === 'load' && syncState.status === 'success' ? 'text-emerald-400 bg-emerald-400/10' :
                                syncState?.op === 'load' && syncState.status === 'error' ? 'text-red-400 bg-red-400/10' :
                                    syncState?.op === 'load' && syncState.status === 'no-change' ? 'text-zinc-400 bg-zinc-800' :
                                        'text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800'
                                }`}
                            title={userName ? "从云端加载预设" : "请先在首页设置邮箱"}
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
                            className={`p-1.5 rounded-md transition-all duration-300 disabled:opacity-30 ${syncState?.op === 'save' && syncState.status === 'success' ? 'text-emerald-400 bg-emerald-400/10' :
                                syncState?.op === 'save' && syncState.status === 'error' ? 'text-red-400 bg-red-400/10' :
                                    'text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800'
                                }`}
                            title={userName ? "保存预设到云端" : "请先在首页设置邮箱"}
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
                            className="p-1.5 text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800 rounded-md transition-colors"
                            title="导入预设 (JSON)"
                        >
                            <Upload size={14} />
                        </button>
                        <button
                            onClick={handleExport}
                            className="p-1.5 text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800 rounded-md transition-colors"
                            title="导出预设 (JSON)"
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
                            className="flex items-center gap-2 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors bg-emerald-400/10 px-3 py-1.5 rounded-full"
                        >
                            预设指令 <ChevronDown size={14} />
                        </button>

                        {isDropdownOpen && (
                            <div className="absolute right-0 top-full mt-2 w-72 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-20 overflow-hidden">
                                <div className="p-2 max-h-80 overflow-y-auto custom-scrollbar">
                                    {/* 系统默认（来自反推提示词） */}
                                    {unifiedPresets.filter(p => p.source === 'system').length > 0 && (
                                        <>
                                            {unifiedPresets.filter(p => p.source === 'system').map(preset => (
                                                <div
                                                    key={preset.id}
                                                    onClick={() => {
                                                        setPrompt(preset.text);
                                                        setIsDropdownOpen(false);
                                                    }}
                                                    className="flex items-center justify-between p-2 hover:bg-zinc-700 rounded-md cursor-pointer group transition-colors mb-1 border-b border-zinc-700 pb-2"
                                                >
                                                    <span className="text-sm text-emerald-400 font-medium">{preset.name}</span>
                                                    <span className="text-[0.625rem] text-zinc-600">反推指令</span>
                                                </div>
                                            ))}
                                        </>
                                    )}

                                    {/* 本地预设 */}
                                    {presets.length > 0 && (
                                        <>
                                            <div className="text-[0.625rem] text-zinc-500 px-2 py-1 uppercase tracking-wider">识别指令</div>
                                            {presets.map(preset => (
                                                <div
                                                    key={preset.id}
                                                    onClick={() => loadPreset(preset)}
                                                    className="flex items-center justify-between p-2 hover:bg-zinc-700 rounded-md cursor-pointer group transition-colors"
                                                >
                                                    <span className="text-sm text-zinc-200 truncate pr-2 flex-1">{preset.name}</span>

                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={(e) => handleEditPreset(preset, e)}
                                                            className="text-zinc-500 hover:text-emerald-400 p-1.5 hover:bg-zinc-600 rounded"
                                                            title="编辑"
                                                        >
                                                            <Pencil size={12} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => deletePreset(preset.id, e)}
                                                            className="text-zinc-500 hover:text-red-400 p-1.5 hover:bg-zinc-600 rounded"
                                                            title="删除"
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
                                            <div className="text-[0.625rem] text-zinc-500 px-2 py-1 mt-2 uppercase tracking-wider border-t border-zinc-700 pt-2">创新指令</div>
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
                                                        className="flex items-center justify-between p-2 hover:bg-zinc-700 rounded-md cursor-pointer group transition-colors"
                                                    >
                                                        <span className="text-sm text-purple-300 truncate pr-2 flex-1">{template.name}</span>
                                                        <span className="text-[0.625rem] text-zinc-600">模版</span>
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

            <div className="relative">
                <textarea
                    value={prompt}
                    onChange={(e) => setPrompt(e.target.value)}
                    onDoubleClick={() => {
                        setExpandedPromptDraft(prompt);
                        setIsExpandedEditorOpen(true);
                    }}
                    placeholder="输入给 AI 的指令 (双击可展开大窗口编辑)..."
                    className={`
            w-full bg-zinc-950 border text-zinc-100 rounded-lg p-3 text-sm focus:ring-2 focus:ring-emerald-500/50 outline-none transition-all ${compact ? 'min-h-[80px]' : 'min-h-[100px]'} resize-y custom-scrollbar
            ${editingPresetId ? 'border-emerald-500/50 ring-1 ring-emerald-500/20' : 'border-zinc-700 focus:border-emerald-500'}
          `}
                    title="双击展开大窗口编辑"
                />

                <div className="absolute bottom-2 right-2 flex gap-2">
                    {isSaving ? (
                        <div className="flex items-center gap-2 bg-zinc-800 p-1.5 rounded-lg border border-zinc-700 shadow-lg animate-in fade-in slide-in-from-right-4 duration-200">
                            {editingPresetId && <span className="text-[0.625rem] text-emerald-500 font-bold px-1">EDIT</span>}
                            <input
                                type="text"
                                autoFocus
                                value={newPresetName}
                                onChange={(e) => setNewPresetName(e.target.value)}
                                placeholder="预设名称"
                                className="bg-transparent text-xs text-white outline-none px-1 w-28 border-b border-zinc-600 focus:border-emerald-500"
                            />
                            <button onClick={savePreset} className="text-zinc-400 hover:text-emerald-400 p-1" title="保存">
                                <Check size={14} />
                            </button>
                            <button onClick={cancelSave} className="text-zinc-500 hover:text-zinc-300 px-1" title="取消">
                                <X size={14} />
                            </button>
                        </div>
                    ) : (
                        <button
                            onClick={() => setIsSaving(true)}
                            disabled={!prompt.trim()}
                            className="text-xs flex items-center gap-1 text-zinc-500 hover:text-zinc-300 disabled:opacity-50 transition-colors bg-zinc-900/50 p-1.5 rounded-md backdrop-blur-sm hover:bg-zinc-800"
                        >
                            <Save size={14} /> 保存为预设
                        </button>
                    )}
                </div>
            </div>

            {/* 大窗口编辑器弹窗 - 使用 Portal 渲染到 body */}
            {isExpandedEditorOpen && createPortal(
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    style={{ zIndex: 9999 }}
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
                                    title="复制指令内容"
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
