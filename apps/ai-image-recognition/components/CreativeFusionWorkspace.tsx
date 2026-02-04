/**
 * CreativeFusionWorkspace - 创新融合工作区
 * 
 * 允许用户选择多张图片进行灵感融合，生成创新变体
 */
import React, { useState, memo } from 'react';
import {
    Sparkles,
    X,
    Plus,
    Palette,
    Layout,
    User,
    Sun,
    Lightbulb,
    Loader2,
    Copy,
    Check,
    AlertCircle,
    CheckSquare,
    Trash2
} from 'lucide-react';
import { ImageItem, CreativeFusionRole, CreativeFusionItem } from '../types';

// 角色选项
const ROLE_OPTIONS: Array<{ value: CreativeFusionRole; label: string; icon: React.ReactNode; emoji: string }> = [
    { value: 'style', label: '风格', icon: <Palette size={14} />, emoji: '🎨' },
    { value: 'composition', label: '构图', icon: <Layout size={14} />, emoji: '📐' },
    { value: 'subject', label: '主体', icon: <User size={14} />, emoji: '👤' },
    { value: 'lighting', label: '光影', icon: <Sun size={14} />, emoji: '☀️' },
    { value: 'inspiration', label: '灵感', icon: <Lightbulb size={14} />, emoji: '💡' },
];

interface CreativeFusionWorkspaceProps {
    images: ImageItem[];
    fusionItems: CreativeFusionItem[];
    fusionResult: {
        innovations: Array<{ id: string; textEn: string; textZh: string }>;
        status: 'idle' | 'processing' | 'success' | 'error';
        error?: string;
    } | null;
    onAddItem: (imageId: string, role: CreativeFusionRole) => void;
    onRemoveItem: (imageId: string) => void;
    onUpdateRole: (imageId: string, role: CreativeFusionRole) => void;
    onAddAll: () => void; // 批量添加所有图片
    onClearAll: () => void; // 清空所有选择
    onGenerate: () => Promise<void>;
    onClose: () => void;
    creativeInstruction?: string;
}

export const CreativeFusionWorkspace: React.FC<CreativeFusionWorkspaceProps> = memo(({
    images,
    fusionItems,
    fusionResult,
    onAddItem,
    onRemoveItem,
    onUpdateRole,
    onAddAll,
    onClearAll,
    onGenerate,
    onClose,
    creativeInstruction
}) => {
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // 获取已添加的图片ID集合
    const addedImageIds = new Set(fusionItems.map(item => item.imageId));

    // 获取可添加的图片（有识别结果且未添加）
    const availableImages = images.filter(img =>
        img.status === 'success' &&
        img.result &&
        !addedImageIds.has(img.id)
    );

    // 获取融合项对应的图片信息
    const getFusionItemImage = (imageId: string) => images.find(img => img.id === imageId);

    // 复制功能
    const handleCopy = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 1500);
        } catch (err) {
            console.error('Failed to copy:', err);
        }
    };

    const isProcessing = fusionResult?.status === 'processing';

    // 统计可添加的图片数量
    const allEligibleImages = images.filter(img =>
        img.status === 'success' && img.result && img.base64Data
    );

    return (
        <div className="bg-gradient-to-br from-purple-900/20 to-pink-900/20 border border-purple-500/30 rounded-xl p-4 mb-4">
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Sparkles size={18} className="text-purple-400" />
                    <h3 className="text-sm font-bold text-purple-300">灵感融合创新</h3>
                    <span className="text-xs text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded">
                        多图混合生成创新变体
                    </span>
                </div>

                {/* 批量操作按钮 */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={onAddAll}
                        disabled={availableImages.length === 0 || isProcessing}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/40 border border-emerald-700/40"
                        title={`全选所有 ${allEligibleImages.length} 张图片`}
                    >
                        <CheckSquare size={14} />
                        全选 ({allEligibleImages.length})
                    </button>

                    <button
                        onClick={onClearAll}
                        disabled={fusionItems.length === 0 || isProcessing}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-red-900/30 text-red-300 hover:bg-red-800/40 border border-red-700/40"
                        title="清空选择"
                    >
                        <Trash2 size={14} />
                        清空
                    </button>

                    <button
                        onClick={onClose}
                        className="p-1.5 rounded-lg hover:bg-zinc-700/50 text-zinc-400 hover:text-white transition-colors"
                    >
                        <X size={16} />
                    </button>
                </div>
            </div>

            {/* 融合槽位 */}
            <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-5 gap-3 mb-4">
                {fusionItems.map((item) => {
                    const img = getFusionItemImage(item.imageId);
                    if (!img) return null;

                    return (
                        <div
                            key={item.imageId}
                            className="relative bg-zinc-800/60 border border-purple-500/30 rounded-lg p-2 group"
                        >
                            {/* 图片缩略图 */}
                            <div className="relative aspect-square mb-2 rounded overflow-hidden">
                                <img
                                    src={img.imageUrl}
                                    alt=""
                                    className="w-full h-full object-cover"
                                />
                                {/* 删除按钮 */}
                                <button
                                    onClick={() => onRemoveItem(item.imageId)}
                                    className="absolute top-1 right-1 p-1 rounded bg-red-600/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                >
                                    <X size={12} />
                                </button>
                            </div>

                            {/* 角色选择 */}
                            <select
                                value={item.role}
                                onChange={(e) => onUpdateRole(item.imageId, e.target.value as CreativeFusionRole)}
                                className="w-full text-xs bg-zinc-900/60 border border-zinc-600/50 rounded px-2 py-1 text-zinc-300 focus:border-purple-500 focus:outline-none"
                            >
                                {ROLE_OPTIONS.map(opt => (
                                    <option key={opt.value} value={opt.value}>
                                        {opt.emoji} {opt.label}
                                    </option>
                                ))}
                            </select>
                        </div>
                    );
                })}

                {/* 添加槽位按钮 */}
                {availableImages.length > 0 && fusionItems.length < 5 && (
                    <div className="relative">
                        <div className="bg-zinc-800/30 border-2 border-dashed border-zinc-600/50 rounded-lg p-2 flex flex-col items-center justify-center aspect-square cursor-pointer hover:border-purple-500/50 transition-colors group">
                            <Plus size={24} className="text-zinc-500 group-hover:text-purple-400 transition-colors mb-1" />
                            <span className="text-xs text-zinc-500">添加图片</span>
                        </div>

                        {/* 下拉选择 */}
                        <select
                            className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
                            onChange={(e) => {
                                if (e.target.value) {
                                    onAddItem(e.target.value, 'inspiration');
                                    e.target.value = '';
                                }
                            }}
                            value=""
                        >
                            <option value="">选择图片...</option>
                            {availableImages.map(img => (
                                <option key={img.id} value={img.id}>
                                    {img.originalInput?.slice(0, 30) || `图片 ${images.indexOf(img) + 1}`}
                                </option>
                            ))}
                        </select>
                    </div>
                )}
            </div>

            {/* 生成按钮 */}
            <div className="flex items-center justify-between border-t border-zinc-700/50 pt-3">
                <div className="text-xs text-zinc-500">
                    已选择 {fusionItems.length} 张图片
                    {fusionItems.length < 2 && <span className="text-yellow-500 ml-2">（至少需要2张）</span>}
                </div>

                <button
                    onClick={onGenerate}
                    disabled={fusionItems.length < 2 || isProcessing}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${fusionItems.length < 2 || isProcessing
                        ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                        : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-500 hover:to-pink-500 shadow-lg shadow-purple-500/20'
                        }`}
                >
                    {isProcessing ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            融合中...
                        </>
                    ) : (
                        <>
                            <Sparkles size={16} />
                            开始融合创新
                        </>
                    )}
                </button>
            </div>

            {/* 融合结果展示 */}
            {fusionResult && fusionResult.status !== 'idle' && (
                <div className="mt-4 pt-4 border-t border-zinc-700/50">
                    <h4 className="text-sm font-medium text-purple-300 mb-3 flex items-center gap-2">
                        <Sparkles size={14} />
                        融合创新结果
                    </h4>

                    {fusionResult.status === 'processing' && (
                        <div className="flex items-center justify-center py-8 text-purple-400">
                            <Loader2 size={24} className="animate-spin mr-2" />
                            正在融合多图灵感生成创新...
                        </div>
                    )}

                    {fusionResult.status === 'error' && (
                        <div className="flex items-center gap-2 py-4 px-3 bg-red-900/20 border border-red-500/30 rounded-lg text-red-400 text-sm">
                            <AlertCircle size={16} />
                            {fusionResult.error || '融合失败'}
                        </div>
                    )}

                    {fusionResult.status === 'success' && fusionResult.innovations.length > 0 && (
                        <div className="space-y-2 max-h-[300px] overflow-y-auto custom-scrollbar pr-1">
                            {fusionResult.innovations.map((inno) => (
                                <div
                                    key={inno.id}
                                    className="group relative bg-zinc-800/60 border border-purple-500/20 rounded-lg p-3 hover:border-purple-500/40 transition-colors"
                                >
                                    <div className="text-sm text-zinc-200 mb-1">{inno.textEn}</div>
                                    {inno.textZh && (
                                        <div className="text-xs text-zinc-500">{inno.textZh}</div>
                                    )}

                                    {/* 复制按钮 */}
                                    <button
                                        onClick={() => handleCopy(inno.textEn, inno.id)}
                                        className="absolute top-2 right-2 p-1.5 rounded bg-zinc-700/80 text-zinc-400 hover:text-white hover:bg-purple-600 opacity-0 group-hover:opacity-100 transition-all"
                                    >
                                        {copiedId === inno.id ? <Check size={12} /> : <Copy size={12} />}
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}
        </div>
    );
});

CreativeFusionWorkspace.displayName = 'CreativeFusionWorkspace';

export default CreativeFusionWorkspace;
