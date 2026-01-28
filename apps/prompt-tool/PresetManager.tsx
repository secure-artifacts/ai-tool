/**
 * PresetManager.tsx
 * 预设管理器 - 管理文案改写预设
 * 
 * 功能:
 * 1. 弹窗显示所有预设（内置+用户自定义+公共预设）
 * 2. 添加、编辑、删除预设
 * 3. 导入/导出预设
 * 4. 保存到 Firebase 支持跨设备同步
 * 5. 分享预设到公共库（可选匿名）
 */

import React, { useState, useRef, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
    X,
    Plus,
    Trash2,
    Edit3,
    Download,
    Upload,
    Check,
    Settings2,
    Copy,
    Save,
    ChevronDown,
    ChevronUp,
    FileText,
    AlertCircle,
    Share2,
    Globe,
    User,
    Loader2
} from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { getPublicPresets, sharePresetToPublic, deletePublicPreset, PublicPreset, PRESET_CATEGORIES, PresetCategory } from './publicPresetService';

// 预设类型
export interface CopywritingPreset {
    id: string;
    name: string;
    instruction: string;
    createdAt: number;
    isBuiltin?: boolean;  // 内置预设标记
}

interface PresetManagerProps {
    isOpen: boolean;
    onClose: () => void;
    presets: CopywritingPreset[];
    builtinPresets: CopywritingPreset[];
    onPresetsChange: (presets: CopywritingPreset[]) => void;
    onSelectPreset: (preset: CopywritingPreset) => void;
}

export function PresetManager({
    isOpen,
    onClose,
    presets,
    builtinPresets,
    onPresetsChange,
    onSelectPreset
}: PresetManagerProps) {
    const { user } = useAuth();
    const [editingId, setEditingId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const [editingInstruction, setEditingInstruction] = useState('');
    const [showAddNew, setShowAddNew] = useState(false);
    const [newName, setNewName] = useState('');
    const [newInstruction, setNewInstruction] = useState('');
    const [expandedId, setExpandedId] = useState<string | null>(null);
    const [toast, setToast] = useState<string | null>(null);
    const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

    // 公共预设相关状态
    const [publicPresets, setPublicPresets] = useState<PublicPreset[]>([]);
    const [loadingPublic, setLoadingPublic] = useState(false);
    const [showShareModal, setShowShareModal] = useState<CopywritingPreset | null>(null);
    const [shareAsAnonymous, setShareAsAnonymous] = useState(false);
    const [shareDisplayName, setShareDisplayName] = useState('');
    const [shareCategory, setShareCategory] = useState<PresetCategory>('creative');
    const [sharing, setSharing] = useState(false);
    const [confirmDeletePublic, setConfirmDeletePublic] = useState<string | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    // 加载公共预设
    useEffect(() => {
        if (isOpen) {
            loadPublicPresets();
        }
    }, [isOpen]);

    const loadPublicPresets = async () => {
        setLoadingPublic(true);
        try {
            const presets = await getPublicPresets();
            setPublicPresets(presets);
        } catch (error) {
            console.error('[PresetManager] Failed to load public presets:', error);
        } finally {
            setLoadingPublic(false);
        }
    };

    // 分享预设到公共库
    const handleSharePreset = async () => {
        if (!showShareModal || !user?.email) return;

        setSharing(true);
        try {
            const displayName = shareAsAnonymous ? null : (shareDisplayName.trim() || user.displayName || user.email.split('@')[0]);
            const success = await sharePresetToPublic(
                { name: showShareModal.name, instruction: showShareModal.instruction },
                shareCategory,
                displayName,
                user.email
            );

            if (success) {
                showToast('预设已分享到公共库');
                setShowShareModal(null);
                setShareAsAnonymous(false);
                setShareDisplayName('');
                loadPublicPresets(); // 刷新公共预设列表
            } else {
                showToast('分享失败，请重试');
            }
        } catch (error) {
            console.error('[PresetManager] Share failed:', error);
            showToast('分享失败');
        } finally {
            setSharing(false);
        }
    };

    // 删除公共预设
    const handleDeletePublicPreset = async (presetId: string) => {
        if (!user?.email) return;

        try {
            const success = await deletePublicPreset(presetId, user.email);
            if (success) {
                showToast('公共预设已删除');
                setConfirmDeletePublic(null);
                loadPublicPresets();
            } else {
                showToast('删除失败');
            }
        } catch (error) {
            console.error('[PresetManager] Delete public preset failed:', error);
            showToast('删除失败');
        }
    };

    if (!isOpen) return null;

    const showToast = (message: string) => {
        setToast(message);
        setTimeout(() => setToast(null), 2000);
    };

    // 添加新预设
    const handleAddPreset = () => {
        if (!newName.trim() || !newInstruction.trim()) {
            showToast('请填写预设名称和指令');
            return;
        }

        const newPreset: CopywritingPreset = {
            id: uuidv4(),
            name: newName.trim(),
            instruction: newInstruction.trim(),
            createdAt: Date.now()
        };

        onPresetsChange([...presets, newPreset]);
        setNewName('');
        setNewInstruction('');
        setShowAddNew(false);
        showToast('预设已添加');
    };

    // 编辑预设
    const startEditing = (preset: CopywritingPreset) => {
        setEditingId(preset.id);
        setEditingName(preset.name);
        setEditingInstruction(preset.instruction);
    };

    const saveEditing = () => {
        if (!editingName.trim() || !editingInstruction.trim()) {
            showToast('请填写预设名称和指令');
            return;
        }

        const updatedPresets = presets.map(p =>
            p.id === editingId
                ? { ...p, name: editingName.trim(), instruction: editingInstruction.trim() }
                : p
        );
        onPresetsChange(updatedPresets);
        setEditingId(null);
        showToast('预设已更新');
    };

    const cancelEditing = () => {
        setEditingId(null);
        setEditingName('');
        setEditingInstruction('');
    };

    // 删除预设
    const handleDeletePreset = (id: string) => {
        const updatedPresets = presets.filter(p => p.id !== id);
        onPresetsChange(updatedPresets);
        setConfirmDelete(null);
        showToast('预设已删除');
    };

    // 复制预设
    const handleDuplicatePreset = (preset: CopywritingPreset) => {
        const newPreset: CopywritingPreset = {
            id: uuidv4(),
            name: `${preset.name} (副本)`,
            instruction: preset.instruction,
            createdAt: Date.now()
        };
        onPresetsChange([...presets, newPreset]);
        showToast('预设已复制');
    };

    // 导出预设
    const handleExportPresets = () => {
        const exportData = {
            version: '1.0',
            exportedAt: new Date().toISOString(),
            presets: presets
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `copywriting_presets_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        showToast(`已导出 ${presets.length} 个预设`);
    };

    // 导入预设
    const handleImportClick = () => {
        fileInputRef.current?.click();
    };

    const handleImportPresets = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        try {
            const text = await file.text();
            const data = JSON.parse(text);

            if (!data.presets || !Array.isArray(data.presets)) {
                showToast('无效的预设文件格式');
                return;
            }

            // 验证并导入预设
            const importedPresets: CopywritingPreset[] = data.presets
                .filter((p: any) => p.name && p.instruction)
                .map((p: any) => ({
                    id: uuidv4(), // 生成新ID避免冲突
                    name: p.name,
                    instruction: p.instruction,
                    createdAt: Date.now()
                }));

            if (importedPresets.length === 0) {
                showToast('未找到有效的预设');
                return;
            }

            // 合并预设（避免重复名称）
            const existingNames = new Set(presets.map(p => p.name));
            const newPresets = importedPresets.map(p => ({
                ...p,
                name: existingNames.has(p.name) ? `${p.name} (导入)` : p.name
            }));

            onPresetsChange([...presets, ...newPresets]);
            showToast(`已导入 ${newPresets.length} 个预设`);
        } catch (error) {
            console.error('[PresetManager] Import error:', error);
            showToast('导入失败：文件格式错误');
        }

        // 清空 input
        e.target.value = '';
    };

    // 使用预设
    const handleUsePreset = (preset: CopywritingPreset) => {
        onSelectPreset(preset);
        onClose();
        showToast(`已应用预设: ${preset.name}`);
    };

    const allPresets = [...builtinPresets.map(p => ({ ...p, isBuiltin: true })), ...presets];

    return (
        <div
            className="fixed inset-0 bg-black/70 flex items-center justify-center z-[10000] p-4"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className="bg-zinc-900 rounded-xl w-full max-w-2xl max-h-[80vh] flex flex-col shadow-2xl border border-zinc-700 overflow-visible">
                {/* Header */}
                <div className="flex items-center justify-between p-4 border-b border-zinc-700">
                    <div className="flex items-center gap-2">
                        <Settings2 className="w-5 h-5 text-amber-400" />
                        <h2 className="text-lg font-semibold text-zinc-100">预设管理器</h2>
                        <span className="text-xs text-zinc-500 ml-2">
                            {presets.length} 个自定义预设
                        </span>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-zinc-400 hover:text-zinc-200 p-1 rounded hover:bg-zinc-700"
                    >
                        <X className="w-5 h-5" />
                    </button>
                </div>

                {/* Toolbar */}
                <div className="flex items-center gap-2 p-3 border-b border-zinc-800 bg-zinc-800/50">
                    <button
                        onClick={() => setShowAddNew(true)}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium rounded-lg transition-colors"
                    >
                        <Plus className="w-4 h-4" /> 添加预设
                    </button>
                    <button
                        onClick={handleImportClick}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm rounded-lg transition-colors"
                    >
                        <Upload className="w-4 h-4" /> 导入
                    </button>
                    <button
                        onClick={handleExportPresets}
                        disabled={presets.length === 0}
                        className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-200 text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        <Download className="w-4 h-4" /> 导出
                    </button>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept=".json"
                        onChange={handleImportPresets}
                        className="hidden"
                    />
                </div>

                {/* Preset List */}
                <div className="flex-1 overflow-y-auto overflow-x-visible p-3 space-y-2">
                    {/* Add New Form */}
                    {showAddNew && (
                        <div className="bg-zinc-800 border border-amber-500/30 rounded-lg p-3 mb-3">
                            <div className="flex items-center justify-between mb-2">
                                <span className="text-sm font-medium text-amber-400">添加新预设</span>
                                <button
                                    onClick={() => setShowAddNew(false)}
                                    className="text-zinc-500 hover:text-zinc-300"
                                >
                                    <X className="w-4 h-4" />
                                </button>
                            </div>
                            <input
                                type="text"
                                value={newName}
                                onChange={(e) => setNewName(e.target.value)}
                                placeholder="预设名称"
                                className="w-full bg-zinc-900 border border-zinc-600 rounded px-3 py-1.5 text-sm text-zinc-200 mb-2 focus:border-amber-500 focus:outline-none"
                            />
                            <textarea
                                value={newInstruction}
                                onChange={(e) => {
                                    setNewInstruction(e.target.value);
                                    // Auto-resize
                                    e.target.style.height = 'auto';
                                    e.target.style.height = Math.min(e.target.scrollHeight, 300) + 'px';
                                }}
                                placeholder="改写指令内容..."
                                rows={5}
                                className="w-full bg-zinc-900 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 mb-2 resize-y focus:border-amber-500 focus:outline-none"
                                style={{ minHeight: '120px', maxHeight: '300px' }}
                            />
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setShowAddNew(false)}
                                    className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleAddPreset}
                                    className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium rounded transition-colors"
                                >
                                    <Check className="w-4 h-4" /> 保存
                                </button>
                            </div>
                        </div>
                    )}

                    {/* Builtin Presets Section */}
                    <div className="mb-4">
                        <div className="text-xs text-zinc-500 mb-2 flex items-center gap-1">
                            <FileText className="w-3 h-3" /> 内置预设
                        </div>
                        {builtinPresets.map((preset) => (
                            <div
                                key={preset.id}
                                className="bg-zinc-800/50 border border-zinc-700 rounded-lg mb-2 overflow-hidden"
                            >
                                <div
                                    className="flex items-center gap-2 p-2.5 cursor-pointer hover:bg-zinc-700/50"
                                    onClick={() => setExpandedId(expandedId === preset.id ? null : preset.id)}
                                >
                                    <span className="text-sm font-medium text-zinc-300 flex-1">
                                        {preset.name}
                                    </span>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleUsePreset(preset); }}
                                        className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded"
                                    >
                                        使用
                                    </button>
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleDuplicatePreset(preset); }}
                                        className="p-1 text-zinc-500 hover:text-zinc-300"
                                        title="复制为自定义预设"
                                    >
                                        <Copy className="w-4 h-4" />
                                    </button>
                                    {expandedId === preset.id ? (
                                        <ChevronUp className="w-4 h-4 text-zinc-500" />
                                    ) : (
                                        <ChevronDown className="w-4 h-4 text-zinc-500" />
                                    )}
                                </div>
                                {expandedId === preset.id && (
                                    <div className="px-3 pb-3 text-xs text-zinc-400 bg-zinc-900/50 border-t border-zinc-700">
                                        <pre className="whitespace-pre-wrap mt-2">{preset.instruction}</pre>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* User Presets Section */}
                    <div>
                        <div className="text-xs text-zinc-500 mb-2 flex items-center gap-1">
                            <Settings2 className="w-3 h-3" /> 自定义预设 ({presets.length})
                        </div>

                        {presets.length === 0 ? (
                            <div className="text-center py-8 text-zinc-500 text-sm">
                                暂无自定义预设，点击上方"添加预设"创建
                            </div>
                        ) : (
                            presets.map((preset) => (
                                <div
                                    key={preset.id}
                                    className="bg-zinc-800 border border-zinc-700 rounded-lg mb-2 overflow-hidden"
                                >
                                    {editingId === preset.id ? (
                                        // Editing Mode
                                        <div className="p-3">
                                            <input
                                                type="text"
                                                value={editingName}
                                                onChange={(e) => setEditingName(e.target.value)}
                                                className="w-full bg-zinc-900 border border-zinc-600 rounded px-3 py-1.5 text-sm text-zinc-200 mb-2 focus:border-amber-500 focus:outline-none"
                                            />
                                            <textarea
                                                value={editingInstruction}
                                                onChange={(e) => {
                                                    setEditingInstruction(e.target.value);
                                                    // Auto-resize
                                                    e.target.style.height = 'auto';
                                                    e.target.style.height = Math.min(e.target.scrollHeight, 300) + 'px';
                                                }}
                                                rows={6}
                                                className="w-full bg-zinc-900 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 mb-2 resize-y focus:border-amber-500 focus:outline-none"
                                                style={{ minHeight: '150px', maxHeight: '300px' }}
                                            />
                                            <div className="flex justify-end gap-2">
                                                <button
                                                    onClick={cancelEditing}
                                                    className="px-3 py-1.5 text-sm text-zinc-400 hover:text-zinc-200"
                                                >
                                                    取消
                                                </button>
                                                <button
                                                    onClick={saveEditing}
                                                    className="flex items-center gap-1 px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-black text-sm font-medium rounded transition-colors"
                                                >
                                                    <Save className="w-4 h-4" /> 保存
                                                </button>
                                            </div>
                                        </div>
                                    ) : (
                                        // View Mode
                                        <>
                                            <div
                                                className="flex items-center gap-2 p-2.5 cursor-pointer hover:bg-zinc-700/50"
                                                onClick={() => setExpandedId(expandedId === preset.id ? null : preset.id)}
                                            >
                                                <span className="text-sm font-medium text-zinc-200 flex-1">
                                                    {preset.name}
                                                </span>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleUsePreset(preset); }}
                                                    className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded"
                                                >
                                                    使用
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); startEditing(preset); }}
                                                    className="p-1 text-zinc-500 hover:text-amber-400"
                                                    title="编辑"
                                                >
                                                    <Edit3 className="w-4 h-4" />
                                                </button>
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); handleDuplicatePreset(preset); }}
                                                    className="p-1 text-zinc-500 hover:text-zinc-300"
                                                    title="复制"
                                                >
                                                    <Copy className="w-4 h-4" />
                                                </button>
                                                {user && (
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); setShowShareModal(preset); setShareDisplayName(user.displayName || ''); }}
                                                        className="p-1 text-zinc-500 hover:text-blue-400"
                                                        title="分享到公共库"
                                                    >
                                                        <Share2 className="w-4 h-4" />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setConfirmDelete(preset.id); }}
                                                    className="p-1 text-zinc-500 hover:text-red-400"
                                                    title="删除"
                                                >
                                                    <Trash2 className="w-4 h-4" />
                                                </button>
                                                {expandedId === preset.id ? (
                                                    <ChevronUp className="w-4 h-4 text-zinc-500" />
                                                ) : (
                                                    <ChevronDown className="w-4 h-4 text-zinc-500" />
                                                )}
                                            </div>
                                            {expandedId === preset.id && (
                                                <div className="px-3 pb-3 text-xs text-zinc-400 bg-zinc-900/50 border-t border-zinc-700">
                                                    <pre className="whitespace-pre-wrap mt-2">{preset.instruction}</pre>
                                                </div>
                                            )}
                                        </>
                                    )}

                                    {/* Delete Confirmation */}
                                    {confirmDelete === preset.id && (
                                        <div className="p-2 bg-red-900/30 border-t border-red-700/50 flex items-center justify-between">
                                            <span className="text-xs text-red-300 flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3" /> 确定删除此预设？
                                            </span>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setConfirmDelete(null)}
                                                    className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                                                >
                                                    取消
                                                </button>
                                                <button
                                                    onClick={() => handleDeletePreset(preset.id)}
                                                    className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded"
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>

                    {/* Public Presets Section - 用户分享预设 */}
                    <div className="mt-4 pt-4 border-t border-zinc-700">
                        <div className="text-xs text-zinc-500 mb-2 flex items-center gap-1">
                            <Globe className="w-3 h-3" /> 用户分享预设 ({publicPresets.length})
                            {loadingPublic && <Loader2 className="w-3 h-3 animate-spin ml-1" />}
                        </div>

                        {publicPresets.length === 0 ? (
                            <div className="text-center py-4 text-zinc-600 text-sm">
                                {loadingPublic ? '加载中...' : '暂无用户分享预设'}
                            </div>
                        ) : (
                            publicPresets.map((preset) => (
                                <div
                                    key={preset.id}
                                    className="bg-zinc-800/50 border border-zinc-700 rounded-lg mb-2 overflow-hidden"
                                >
                                    <div
                                        className="flex items-center gap-2 p-2.5 cursor-pointer hover:bg-zinc-700/50"
                                        onClick={() => setExpandedId(expandedId === preset.id ? null : preset.id)}
                                    >
                                        <span className="text-sm font-medium text-zinc-300 flex-1">
                                            {preset.name}
                                        </span>
                                        <span className="text-xs px-1.5 py-0.5 rounded bg-zinc-700 text-zinc-400">
                                            {PRESET_CATEGORIES.find(c => c.value === preset.category)?.label || '其它'}
                                        </span>
                                        <span className="text-xs text-zinc-500 flex items-center gap-1">
                                            {preset.createdBy ? (
                                                <><User className="w-3 h-3" /> {preset.createdBy}</>
                                            ) : (
                                                '匿名'
                                            )}
                                        </span>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleUsePreset({
                                                    id: preset.id,
                                                    name: preset.name,
                                                    instruction: preset.instruction,
                                                    createdAt: preset.createdAt
                                                });
                                            }}
                                            className="px-2 py-1 text-xs bg-green-600 hover:bg-green-500 text-white rounded"
                                        >
                                            使用
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDuplicatePreset({
                                                    id: preset.id,
                                                    name: preset.name,
                                                    instruction: preset.instruction,
                                                    createdAt: preset.createdAt
                                                });
                                            }}
                                            className="p-1 text-zinc-500 hover:text-zinc-300"
                                            title="复制为自定义预设"
                                        >
                                            <Copy className="w-4 h-4" />
                                        </button>
                                        {/* 只有创建者可以删除 */}
                                        {user?.email && preset.createdByEmail === user.email && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); setConfirmDeletePublic(preset.id); }}
                                                className="p-1 text-zinc-500 hover:text-red-400"
                                                title="删除"
                                            >
                                                <Trash2 className="w-4 h-4" />
                                            </button>
                                        )}
                                        {expandedId === preset.id ? (
                                            <ChevronUp className="w-4 h-4 text-zinc-500" />
                                        ) : (
                                            <ChevronDown className="w-4 h-4 text-zinc-500" />
                                        )}
                                    </div>
                                    {expandedId === preset.id && (
                                        <div className="px-3 pb-3 text-xs text-zinc-400 bg-zinc-900/50 border-t border-zinc-700">
                                            <pre className="whitespace-pre-wrap mt-2">{preset.instruction}</pre>
                                        </div>
                                    )}
                                    {/* Delete Confirmation for Public Preset */}
                                    {confirmDeletePublic === preset.id && (
                                        <div className="p-2 bg-red-900/30 border-t border-red-700/50 flex items-center justify-between">
                                            <span className="text-xs text-red-300 flex items-center gap-1">
                                                <AlertCircle className="w-3 h-3" /> 确定删除此公共预设？
                                            </span>
                                            <div className="flex gap-2">
                                                <button
                                                    onClick={() => setConfirmDeletePublic(null)}
                                                    className="px-2 py-1 text-xs text-zinc-400 hover:text-zinc-200"
                                                >
                                                    取消
                                                </button>
                                                <button
                                                    onClick={() => handleDeletePublicPreset(preset.id)}
                                                    className="px-2 py-1 text-xs bg-red-600 hover:bg-red-500 text-white rounded"
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-3 border-t border-zinc-700 bg-zinc-800/50 text-xs text-zinc-500 text-center">
                    预设会自动同步到云端，在所有设备上都可使用
                </div>
            </div>

            {/* Share Modal - 分享弹窗 */}
            {showShareModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[10002]">
                    <div className="bg-zinc-900 rounded-xl w-full max-w-md p-4 border border-zinc-700 shadow-2xl">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                                <Share2 className="w-5 h-5 text-blue-400" /> 分享到公共库
                            </h3>
                            <button
                                onClick={() => { setShowShareModal(null); setShareAsAnonymous(false); }}
                                className="text-zinc-400 hover:text-zinc-200"
                            >
                                <X className="w-5 h-5" />
                            </button>
                        </div>

                        <div className="mb-4">
                            <div className="text-sm text-zinc-400 mb-2">预设名称</div>
                            <div className="bg-zinc-800 rounded px-3 py-2 text-zinc-200">{showShareModal.name}</div>
                        </div>

                        <div className="mb-4">
                            <div className="text-sm text-zinc-400 mb-2">类别</div>
                            <select
                                value={shareCategory}
                                onChange={(e) => setShareCategory(e.target.value as PresetCategory)}
                                className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                            >
                                {PRESET_CATEGORIES.map(cat => (
                                    <option key={cat.value} value={cat.value}>{cat.label}</option>
                                ))}
                            </select>
                        </div>

                        <div className="mb-4">
                            <div className="text-sm text-zinc-400 mb-2">提供者显示</div>
                            <label className="flex items-center gap-2 mb-2 cursor-pointer">
                                <input
                                    type="checkbox"
                                    checked={shareAsAnonymous}
                                    onChange={(e) => setShareAsAnonymous(e.target.checked)}
                                    className="rounded border-zinc-600"
                                />
                                <span className="text-sm text-zinc-300">匿名分享</span>
                            </label>
                            {!shareAsAnonymous && (
                                <input
                                    type="text"
                                    value={shareDisplayName}
                                    onChange={(e) => setShareDisplayName(e.target.value)}
                                    placeholder="显示名称"
                                    className="w-full bg-zinc-800 border border-zinc-600 rounded px-3 py-2 text-sm text-zinc-200 focus:border-blue-500 focus:outline-none"
                                />
                            )}
                        </div>

                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => { setShowShareModal(null); setShareAsAnonymous(false); }}
                                className="px-4 py-2 text-sm text-zinc-400 hover:text-zinc-200"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleSharePreset}
                                disabled={sharing}
                                className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50"
                            >
                                {sharing ? <Loader2 className="w-4 h-4 animate-spin" /> : <Share2 className="w-4 h-4" />}
                                {sharing ? '分享中...' : '确认分享'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div className="fixed bottom-4 left-1/2 -translate-x-1/2 px-4 py-2 bg-zinc-800 border border-zinc-600 rounded-lg text-sm text-zinc-200 z-[10001] animate-fade-in">
                    {toast}
                </div>
            )}
        </div>
    );
}

export default PresetManager;
