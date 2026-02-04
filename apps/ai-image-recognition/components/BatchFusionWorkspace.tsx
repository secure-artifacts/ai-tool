/**
 * BatchFusionWorkspace - 批量融合工作区
 * 
 * 支持创建多个融合组，每组包含多张图片，各自独立进行融合创新
 */
import React, { useState, memo, useCallback } from 'react';
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
    Trash2,
    Layers,
    ChevronDown,
    ChevronUp
} from 'lucide-react';
import { ImageItem, CreativeFusionRole, FusionGroup, CreativeFusionResult } from '../types';
import { v4 as uuidv4 } from 'uuid';

// 角色选项
const ROLE_OPTIONS: Array<{ value: CreativeFusionRole; label: string; emoji: string }> = [
    { value: 'style', label: '风格', emoji: '🎨' },
    { value: 'composition', label: '构图', emoji: '📐' },
    { value: 'subject', label: '主体', emoji: '👤' },
    { value: 'lighting', label: '光影', emoji: '☀️' },
    { value: 'inspiration', label: '灵感', emoji: '💡' },
];

interface BatchFusionWorkspaceProps {
    images: ImageItem[];
    fusionGroups: FusionGroup[];
    onUpdateGroups: (groups: FusionGroup[]) => void;
    onGenerateAll: (groups: FusionGroup[]) => Promise<void>;
    onClose: () => void;
    isProcessing: boolean;
}

export const BatchFusionWorkspace: React.FC<BatchFusionWorkspaceProps> = memo(({
    images,
    fusionGroups,
    onUpdateGroups,
    onGenerateAll,
    onClose,
    isProcessing
}) => {
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());

    // 获取可用的图片（有识别结果和base64数据）
    const availableImages = images.filter(img =>
        img.status === 'success' && img.result && img.base64Data
    );

    // 获取图片信息
    const getImageById = (imageId: string) => images.find(img => img.id === imageId);

    // 添加新组
    const handleAddGroup = useCallback(() => {
        const newGroup: FusionGroup = {
            id: uuidv4(),
            items: []
        };
        onUpdateGroups([...fusionGroups, newGroup]);
        setExpandedGroups(prev => new Set([...prev, newGroup.id]));
    }, [fusionGroups, onUpdateGroups]);

    // 删除组
    const handleRemoveGroup = useCallback((groupId: string) => {
        onUpdateGroups(fusionGroups.filter(g => g.id !== groupId));
    }, [fusionGroups, onUpdateGroups]);

    // 添加图片到组
    const handleAddToGroup = useCallback((groupId: string, imageId: string) => {
        onUpdateGroups(fusionGroups.map(g => {
            if (g.id === groupId && !g.items.some(item => item.imageId === imageId)) {
                return {
                    ...g,
                    items: [...g.items, { imageId, role: 'inspiration' as CreativeFusionRole }]
                };
            }
            return g;
        }));
    }, [fusionGroups, onUpdateGroups]);

    // 从组中移除图片
    const handleRemoveFromGroup = useCallback((groupId: string, imageId: string) => {
        onUpdateGroups(fusionGroups.map(g => {
            if (g.id === groupId) {
                return {
                    ...g,
                    items: g.items.filter(item => item.imageId !== imageId)
                };
            }
            return g;
        }));
    }, [fusionGroups, onUpdateGroups]);

    // 更新图片角色
    const handleUpdateRole = useCallback((groupId: string, imageId: string, role: CreativeFusionRole) => {
        onUpdateGroups(fusionGroups.map(g => {
            if (g.id === groupId) {
                return {
                    ...g,
                    items: g.items.map(item =>
                        item.imageId === imageId ? { ...item, role } : item
                    )
                };
            }
            return g;
        }));
    }, [fusionGroups, onUpdateGroups]);

    // 自动两两配对
    const handleAutoGroup = useCallback(() => {
        const newGroups: FusionGroup[] = [];
        for (let i = 0; i < availableImages.length; i += 2) {
            const items = [
                { imageId: availableImages[i].id, role: 'inspiration' as CreativeFusionRole },
            ];
            if (i + 1 < availableImages.length) {
                items.push({ imageId: availableImages[i + 1].id, role: 'style' as CreativeFusionRole });
            }
            if (items.length >= 2) {
                newGroups.push({
                    id: uuidv4(),
                    items
                });
            }
        }
        onUpdateGroups(newGroups);
        setExpandedGroups(new Set(newGroups.map(g => g.id)));
    }, [availableImages, onUpdateGroups]);

    // 清空所有组
    const handleClearAll = useCallback(() => {
        onUpdateGroups([]);
    }, [onUpdateGroups]);

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

    // 切换组展开/收起
    const toggleGroupExpand = (groupId: string) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(groupId)) {
                next.delete(groupId);
            } else {
                next.add(groupId);
            }
            return next;
        });
    };

    // 统计
    const validGroupsCount = fusionGroups.filter(g => g.items.length >= 2).length;
    const totalImagesInGroups = fusionGroups.reduce((sum, g) => sum + g.items.length, 0);

    return (
        <div className="bg-gradient-to-br from-purple-900/20 to-pink-900/20 border border-purple-500/30 rounded-xl p-4 mb-4">
            {/* 标题栏 */}
            <div className="flex items-center justify-between mb-4">
                <div className="flex items-center gap-2">
                    <Layers size={18} className="text-purple-400" />
                    <h3 className="text-sm font-bold text-purple-300">批量融合工作区</h3>
                    <span className="text-xs text-zinc-500 bg-zinc-800/50 px-2 py-0.5 rounded">
                        {fusionGroups.length} 组 · {totalImagesInGroups} 张图
                    </span>
                </div>

                {/* 操作按钮 */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleAutoGroup}
                        disabled={availableImages.length < 2 || isProcessing}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-blue-900/30 text-blue-300 hover:bg-blue-800/40 border border-blue-700/40"
                        title="自动将图片两两配对成组"
                    >
                        <Layers size={14} />
                        自动配对
                    </button>

                    <button
                        onClick={handleAddGroup}
                        disabled={isProcessing}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-emerald-900/30 text-emerald-300 hover:bg-emerald-800/40 border border-emerald-700/40"
                        title="添加新融合组"
                    >
                        <Plus size={14} />
                        新建组
                    </button>

                    <button
                        onClick={handleClearAll}
                        disabled={fusionGroups.length === 0 || isProcessing}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium transition-all disabled:opacity-40 disabled:cursor-not-allowed bg-red-900/30 text-red-300 hover:bg-red-800/40 border border-red-700/40"
                        title="清空所有组"
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

            {/* 融合组列表 */}
            <div className="space-y-3 max-h-[400px] overflow-y-auto custom-scrollbar pr-1 mb-4">
                {fusionGroups.length === 0 ? (
                    <div className="text-center py-8 text-zinc-500">
                        <Layers size={32} className="mx-auto mb-2 opacity-50" />
                        <p className="text-sm">暂无融合组</p>
                        <p className="text-xs mt-1">点击"新建组"或"自动配对"开始批量融合</p>
                    </div>
                ) : (
                    fusionGroups.map((group, groupIndex) => {
                        const isExpanded = expandedGroups.has(group.id);
                        const groupResult = group.result;
                        const isValid = group.items.length >= 2;
                        const usedImageIds = new Set(group.items.map(item => item.imageId));
                        const availableForGroup = availableImages.filter(img => !usedImageIds.has(img.id));

                        return (
                            <div
                                key={group.id}
                                className={`border rounded-lg transition-all ${isValid ? 'border-purple-500/30 bg-zinc-800/40' : 'border-yellow-500/30 bg-yellow-900/10'
                                    }`}
                            >
                                {/* 组标题 */}
                                <div
                                    className="flex items-center justify-between p-3 cursor-pointer"
                                    onClick={() => toggleGroupExpand(group.id)}
                                >
                                    <div className="flex items-center gap-2">
                                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                        <span className="text-sm font-medium text-zinc-300">
                                            组 {groupIndex + 1}
                                        </span>
                                        <span className="text-xs text-zinc-500">
                                            {group.items.length} 张图片
                                        </span>
                                        {!isValid && (
                                            <span className="text-xs text-yellow-400 bg-yellow-900/30 px-1.5 py-0.5 rounded">
                                                至少需2张
                                            </span>
                                        )}
                                        {groupResult?.status === 'processing' && (
                                            <Loader2 size={14} className="animate-spin text-purple-400" />
                                        )}
                                        {groupResult?.status === 'success' && (
                                            <Check size={14} className="text-emerald-400" />
                                        )}
                                        {groupResult?.status === 'error' && (
                                            <AlertCircle size={14} className="text-red-400" />
                                        )}
                                    </div>

                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleRemoveGroup(group.id);
                                        }}
                                        disabled={isProcessing}
                                        className="p-1 rounded hover:bg-red-900/30 text-zinc-500 hover:text-red-400 transition-colors"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>

                                {/* 展开内容 */}
                                {isExpanded && (
                                    <div className="px-3 pb-3 border-t border-zinc-700/50">
                                        {/* 图片列表 */}
                                        <div className="flex flex-wrap gap-2 mt-3">
                                            {group.items.map((item) => {
                                                const img = getImageById(item.imageId);
                                                if (!img) return null;

                                                return (
                                                    <div
                                                        key={item.imageId}
                                                        className="relative group bg-zinc-700/50 rounded-lg p-1.5 flex items-center gap-2"
                                                    >
                                                        <img
                                                            src={img.imageUrl}
                                                            alt=""
                                                            className="w-10 h-10 rounded object-cover"
                                                        />
                                                        <select
                                                            value={item.role}
                                                            onChange={(e) => handleUpdateRole(group.id, item.imageId, e.target.value as CreativeFusionRole)}
                                                            className="text-xs bg-zinc-900/60 border border-zinc-600/50 rounded px-1.5 py-0.5 text-zinc-300 focus:border-purple-500 focus:outline-none"
                                                            onClick={(e) => e.stopPropagation()}
                                                        >
                                                            {ROLE_OPTIONS.map(opt => (
                                                                <option key={opt.value} value={opt.value}>
                                                                    {opt.emoji} {opt.label}
                                                                </option>
                                                            ))}
                                                        </select>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                handleRemoveFromGroup(group.id, item.imageId);
                                                            }}
                                                            className="p-0.5 rounded bg-red-600/80 text-white opacity-0 group-hover:opacity-100 transition-opacity"
                                                        >
                                                            <X size={10} />
                                                        </button>
                                                    </div>
                                                );
                                            })}

                                            {/* 添加图片 */}
                                            {availableForGroup.length > 0 && (
                                                <div className="relative">
                                                    <div className="w-10 h-10 rounded border-2 border-dashed border-zinc-600/50 flex items-center justify-center cursor-pointer hover:border-purple-500/50 transition-colors">
                                                        <Plus size={16} className="text-zinc-500" />
                                                    </div>
                                                    <select
                                                        className="absolute inset-0 opacity-0 cursor-pointer"
                                                        onChange={(e) => {
                                                            if (e.target.value) {
                                                                handleAddToGroup(group.id, e.target.value);
                                                                e.target.value = '';
                                                            }
                                                        }}
                                                        value=""
                                                    >
                                                        <option value="">添加图片...</option>
                                                        {availableForGroup.map(img => (
                                                            <option key={img.id} value={img.id}>
                                                                {img.originalInput?.slice(0, 20) || `图片 ${images.indexOf(img) + 1}`}
                                                            </option>
                                                        ))}
                                                    </select>
                                                </div>
                                            )}
                                        </div>

                                        {/* 组结果 */}
                                        {groupResult && groupResult.status !== 'idle' && (
                                            <div className="mt-3 pt-3 border-t border-zinc-700/30">
                                                {groupResult.status === 'processing' && (
                                                    <div className="flex items-center gap-2 text-purple-400 text-xs">
                                                        <Loader2 size={12} className="animate-spin" />
                                                        正在融合生成...
                                                    </div>
                                                )}
                                                {groupResult.status === 'error' && (
                                                    <div className="flex items-center gap-2 text-red-400 text-xs">
                                                        <AlertCircle size={12} />
                                                        {groupResult.error || '融合失败'}
                                                    </div>
                                                )}
                                                {groupResult.status === 'success' && groupResult.innovations.length > 0 && (
                                                    <div className="space-y-1.5">
                                                        {groupResult.innovations.slice(0, 3).map((inno) => (
                                                            <div
                                                                key={inno.id}
                                                                className="group/inno relative text-xs text-zinc-300 bg-zinc-800/60 rounded px-2 py-1.5 pr-8"
                                                            >
                                                                <div className="line-clamp-2">{inno.textEn}</div>
                                                                {inno.textZh && (
                                                                    <div className="text-zinc-500 line-clamp-1 mt-0.5">{inno.textZh}</div>
                                                                )}
                                                                <button
                                                                    onClick={() => handleCopy(inno.textEn, inno.id)}
                                                                    className="absolute top-1 right-1 p-1 rounded bg-zinc-700/80 text-zinc-400 hover:text-white opacity-0 group-hover/inno:opacity-100 transition-all"
                                                                >
                                                                    {copiedId === inno.id ? <Check size={10} /> : <Copy size={10} />}
                                                                </button>
                                                            </div>
                                                        ))}
                                                        {groupResult.innovations.length > 3 && (
                                                            <div className="text-xs text-zinc-500">
                                                                还有 {groupResult.innovations.length - 3} 条结果...
                                                            </div>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* 底部操作 */}
            <div className="flex items-center justify-between border-t border-zinc-700/50 pt-3">
                <div className="text-xs text-zinc-500">
                    共 {fusionGroups.length} 组，有效 {validGroupsCount} 组
                    {validGroupsCount < fusionGroups.length && (
                        <span className="text-yellow-500 ml-2">
                            ({fusionGroups.length - validGroupsCount} 组不足2张图)
                        </span>
                    )}
                </div>

                <button
                    onClick={() => onGenerateAll(fusionGroups)}
                    disabled={validGroupsCount === 0 || isProcessing}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg font-medium transition-all ${validGroupsCount === 0 || isProcessing
                            ? 'bg-zinc-700 text-zinc-500 cursor-not-allowed'
                            : 'bg-gradient-to-r from-purple-600 to-pink-600 text-white hover:from-purple-500 hover:to-pink-500 shadow-lg shadow-purple-500/20'
                        }`}
                >
                    {isProcessing ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            批量融合中...
                        </>
                    ) : (
                        <>
                            <Sparkles size={16} />
                            批量融合 ({validGroupsCount} 组)
                        </>
                    )}
                </button>
            </div>
        </div>
    );
});

BatchFusionWorkspace.displayName = 'BatchFusionWorkspace';

export default BatchFusionWorkspace;
