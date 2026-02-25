/**
 * 快捷模式独立界面 - 简约App风格
 * 复用现有的所有逻辑层，只是UI表现层不同
 */

import React, { useState, useCallback, useRef } from 'react';
import {
    Upload,
    Sparkles,
    Copy,
    Check,
    Loader2,
    X,
    Download,
    Settings,
    RefreshCw,
    Plus,
    Minus,
    ToggleLeft,
    ToggleRight,
    ArrowLeft,
    Pause,
    Play,
    Square,
    RotateCcw,
} from 'lucide-react';
import { CreativeResult, ImageItem } from '../types';
import { RandomLibraryConfig } from '../services/randomLibraryService';

// Props - 全部从父组件传入，不自己管理任何业务逻辑
interface QuickModeStandaloneProps {
    // 图片
    images: ImageItem[];
    onAddImages: (files: FileList) => void;
    onRemoveImage: (id: string) => void;
    onClearImages: () => void;

    // 用户要求
    prompt: string;
    onPromptChange: (prompt: string) => void;

    // 随机库配置
    randomLibraryConfig: RandomLibraryConfig;
    onRandomLibraryConfigChange: (config: RandomLibraryConfig) => void;
    onOpenLibraryManager: () => void;
    onSyncLibraries: () => void;
    isSyncing: boolean;

    // 覆盖
    quickOverrides: Record<string, any>;
    onOverrideClick: (libName: string) => void;
    onOverrideChange: (libName: string, updates: { value?: string; extractPrompt?: string; count?: number }) => void;
    editingOverrideLib: string | null;

    // 创新
    creativeCount: number;
    onCreativeCountChange: (count: number) => void;
    isProcessing: boolean;
    onStartInnovation: () => void;
    onRetryFailed?: () => void;
    onRerunCards?: () => void;
    creativeResults: CreativeResult[];
    onClearResults: () => void;

    // 暂停/停止
    isPaused: boolean;
    onPauseResume: () => void;
    onStop: () => void;

    // 无图模式
    noImageMode: boolean;
    onToggleNoImageMode: () => void;

    // 无图模式文字卡片
    textCards?: Array<{ id: string; topic: string; results: string[]; resultsZh?: string[]; status: string; createdAt?: number; aiConversationLog?: Array<{ timestamp: number; prompt: string; response: string; label?: string }> }>;
    isGeneratingNoImage?: boolean;

    // 复制
    onCopyEN: () => void;
    onCopyZH: () => void;
    onCopyAll: () => void;
    copySuccess: string | null;

    // 视图切换
    onSwitchToClassic: () => void;
}

export const QuickModeStandalone: React.FC<QuickModeStandaloneProps> = ({
    images,
    onAddImages,
    onRemoveImage,
    onClearImages,
    prompt,
    onPromptChange,
    randomLibraryConfig,
    onRandomLibraryConfigChange,
    onOpenLibraryManager,
    onSyncLibraries,
    isSyncing,
    quickOverrides,
    onOverrideClick,
    onOverrideChange,
    editingOverrideLib,
    creativeCount,
    onCreativeCountChange,
    isProcessing,
    onStartInnovation,
    onRetryFailed,
    onRerunCards,
    creativeResults,
    onClearResults,
    isPaused,
    onPauseResume,
    onStop,
    noImageMode,
    onToggleNoImageMode,
    textCards = [],
    isGeneratingNoImage = false,
    onCopyEN,
    onCopyZH,
    onCopyAll,
    copySuccess,
    onSwitchToClassic,
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [inlineEditLib, setInlineEditLib] = useState<string | null>(null);
    const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
    // 图片→维度映射： dimensionName → imageId
    const [imageDimensionMap, setImageDimensionMap] = useState<Record<string, string>>({});

    // 拖拽处理
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragOver(false);
        if (e.dataTransfer.files.length > 0) {
            onAddImages(e.dataTransfer.files);
        }
    }, [onAddImages]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragOver(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        setIsDragOver(false);
    }, []);

    // 复制单条结果
    const copySingleResult = useCallback(async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch { }
    }, []);

    // 下载为CSV
    const downloadCSV = useCallback(() => {
        const successResults = creativeResults.filter(r => r.status === 'success');
        if (successResults.length === 0) return;

        const rows: string[][] = [['序号', '英文描述词', '中文描述词']];
        let idx = 1;
        for (const result of successResults) {
            for (const innovation of result.innovations) {
                rows.push([String(idx++), innovation.textEn, innovation.textZh]);
            }
        }

        const csvContent = rows.map(row =>
            row.map(cell => `"${cell.replace(/"/g, '""')}"`).join(',')
        ).join('\n');

        const BOM = '\uFEFF';
        const blob = new Blob([BOM + csvContent], { type: 'text/csv;charset=utf-8;' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `创新结果_${new Date().toISOString().slice(0, 10)}.csv`;
        a.click();
        URL.revokeObjectURL(url);
    }, [creativeResults]);

    // 总库列表
    const sourceSheets = (() => {
        const sheets = new Set<string>();
        randomLibraryConfig.libraries.forEach(lib => {
            if (lib.sourceSheet) sheets.add(lib.sourceSheet);
        });
        return Array.from(sheets);
    })();
    const activeSourceSheet = randomLibraryConfig.activeSourceSheet || sourceSheets[0] || '';

    // 当前总库下的启用库
    const enabledLibs = randomLibraryConfig.libraries.filter(lib =>
        lib.enabled && lib.values.length > 0 &&
        (sourceSheets.length <= 1 || lib.sourceSheet === activeSourceSheet || !lib.sourceSheet)
    );

    // 成功结果数
    const successCount = noImageMode
        ? textCards.filter(c => c.status === 'done' && c.results.length > 0).length
        : creativeResults.filter(r => r.status === 'success').length;
    const totalInnovations = creativeResults.reduce((sum, r) => sum + (r.innovations?.length || 0), 0);

    return (
        <div style={{
            display: 'flex',
            width: '100%',
            minWidth: 0,
            height: '100%',
            gap: '0',
            background: '#0a0a0a',
            color: '#e4e4e7',
            fontFamily: "'Inter', 'system-ui', sans-serif",
            overflow: 'hidden',
        }}>
            {/* ===== 左面板 ===== */}
            <div style={{
                width: '380px',
                minWidth: '340px',
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                padding: '16px',
                borderRight: '1px solid #1f1f23',
                boxSizing: 'border-box',
                overflowY: 'auto',
                overflowX: 'hidden',
                background: '#0f0f12',
            }}>
                {/* 顶部头部：返回 + 标题 */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    marginBottom: '2px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <button
                            onClick={onSwitchToClassic}
                            style={{
                                padding: '4px 8px',
                                borderRadius: '6px',
                                border: '1px solid #27272a',
                                background: '#18181b',
                                color: '#71717a',
                                fontSize: '11px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                                transition: 'all 0.15s',
                            }}
                            onMouseEnter={(e) => { e.currentTarget.style.color = '#a1a1aa'; e.currentTarget.style.borderColor = '#3f3f46'; }}
                            onMouseLeave={(e) => { e.currentTarget.style.color = '#71717a'; e.currentTarget.style.borderColor = '#27272a'; }}
                        >
                            <ArrowLeft size={12} />
                            经典视图
                        </button>
                        <span style={{ fontSize: '13px', fontWeight: 600, color: '#a1a1aa' }}>⚡ 快捷创新</span>
                    </div>
                    <button
                        onClick={onOpenLibraryManager}
                        style={{
                            padding: '4px',
                            borderRadius: '6px',
                            border: '1px solid #27272a',
                            background: 'transparent',
                            color: '#52525b',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                        }}
                        title="高级设置"
                    >
                        <Settings size={14} />
                    </button>
                </div>

                {/* 图片上传区 */}
                {!noImageMode && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        <div
                            onDrop={handleDrop}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                                border: `2px dashed ${isDragOver ? '#8b5cf6' : '#27272a'}`,
                                borderRadius: '12px',
                                padding: images.length > 0 ? '16px' : '32px 16px',
                                textAlign: 'center',
                                cursor: 'pointer',
                                background: isDragOver ? 'rgba(139,92,246,0.06)' : 'rgba(24,24,27,0.5)',
                                transition: 'all 0.2s ease',
                            }}
                        >
                            {images.length === 0 ? (
                                <>
                                    <Upload size={28} style={{ color: '#52525b', margin: '0 auto 8px' }} />
                                    <div style={{ color: '#71717a', fontSize: '13px', fontWeight: 500 }}>
                                        拖拽图片到此处 或 点击上传
                                    </div>
                                    <div style={{ color: '#3f3f46', fontSize: '11px', marginTop: '4px' }}>
                                        支持 JPG, PNG, WEBP · 可多选
                                    </div>
                                </>
                            ) : (
                                <div>
                                    {/* 图片计数 + 清空按钮 */}
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        marginBottom: '8px',
                                    }}>
                                        <span style={{ fontSize: '11px', color: '#71717a' }}>
                                            已上传 {images.length} 张
                                        </span>
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onClearImages(); }}
                                            style={{
                                                padding: '2px 8px',
                                                borderRadius: '4px',
                                                border: '1px solid rgba(239,68,68,0.3)',
                                                background: 'rgba(239,68,68,0.08)',
                                                color: '#f87171',
                                                fontSize: '10px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '3px',
                                            }}
                                        >
                                            <X size={9} /> 清空
                                        </button>
                                    </div>
                                    {/* 图片网格 - 限制高度可滚动 */}
                                    <div style={{
                                        display: 'flex',
                                        flexWrap: 'wrap',
                                        gap: '6px',
                                        justifyContent: 'center',
                                        maxHeight: '180px',
                                        overflowY: 'auto',
                                        paddingRight: '4px',
                                    }}>
                                        {images.map(img => {
                                            const isSelected = selectedImageId === img.id;
                                            // 查找这张图片关联了哪些维度
                                            const linkedDims = Object.entries(imageDimensionMap)
                                                .filter(([_, imgId]) => imgId === img.id)
                                                .map(([dim]) => dim);
                                            return (
                                                <div
                                                    key={img.id}
                                                    onClick={(e) => { e.stopPropagation(); setSelectedImageId(isSelected ? null : img.id); }}
                                                    style={{
                                                        position: 'relative',
                                                        width: '56px',
                                                        height: '56px',
                                                        cursor: 'pointer',
                                                    }}
                                                >
                                                    <img
                                                        src={img.imageUrl}
                                                        alt=""
                                                        style={{
                                                            width: '100%',
                                                            height: '100%',
                                                            objectFit: 'cover',
                                                            borderRadius: '8px',
                                                            border: isSelected
                                                                ? '2px solid #3b82f6'
                                                                : linkedDims.length > 0
                                                                    ? '2px solid #f59e0b'
                                                                    : '1px solid #27272a',
                                                            boxShadow: isSelected ? '0 0 8px rgba(59,130,246,0.4)' : 'none',
                                                        }}
                                                    />
                                                    {/* 关联标记 */}
                                                    {linkedDims.length > 0 && (
                                                        <div style={{
                                                            position: 'absolute',
                                                            bottom: '-2px',
                                                            left: '50%',
                                                            transform: 'translateX(-50%)',
                                                            background: '#f59e0b',
                                                            color: '#000',
                                                            fontSize: '7px',
                                                            fontWeight: 700,
                                                            padding: '0 3px',
                                                            borderRadius: '3px',
                                                            whiteSpace: 'nowrap',
                                                            maxWidth: '54px',
                                                            overflow: 'hidden',
                                                            textOverflow: 'ellipsis',
                                                        }}>
                                                            {linkedDims.join(',')}
                                                        </div>
                                                    )}
                                                    {/* 选中指示 */}
                                                    {isSelected && (
                                                        <div style={{
                                                            position: 'absolute',
                                                            top: '2px',
                                                            left: '2px',
                                                            width: '14px',
                                                            height: '14px',
                                                            borderRadius: '50%',
                                                            background: '#3b82f6',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                        }}>
                                                            <Check size={8} color="white" />
                                                        </div>
                                                    )}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); onRemoveImage(img.id); }}
                                                        style={{
                                                            position: 'absolute',
                                                            top: '-4px',
                                                            right: '-4px',
                                                            width: '16px',
                                                            height: '16px',
                                                            borderRadius: '50%',
                                                            background: '#ef4444',
                                                            border: '2px solid #0f0f12',
                                                            color: 'white',
                                                            display: 'flex',
                                                            alignItems: 'center',
                                                            justifyContent: 'center',
                                                            cursor: 'pointer',
                                                            padding: 0,
                                                            fontSize: '10px',
                                                            lineHeight: 1,
                                                        }}
                                                    >
                                                        <X size={8} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                        <div style={{
                                            width: '56px',
                                            height: '56px',
                                            borderRadius: '8px',
                                            border: '2px dashed #27272a',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#52525b',
                                        }}>
                                            <Plus size={16} />
                                        </div>
                                    </div>
                                </div>
                            )}
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="image/*"
                                multiple
                                style={{ display: 'none' }}
                                onChange={(e) => e.target.files && onAddImages(e.target.files)}
                            />
                        </div>
                    </div>
                )}

                {/* 用户要求 */}
                <div>
                    <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px', fontWeight: 500 }}>
                        📝 追加要求
                    </div>
                    <textarea
                        value={prompt}
                        onChange={(e) => onPromptChange(e.target.value)}
                        placeholder="全局追加要求（可选）..."
                        rows={2}
                        style={{
                            width: '100%',
                            padding: '10px 12px',
                            borderRadius: '10px',
                            border: '1px solid #27272a',
                            background: '#18181b',
                            color: '#e4e4e7',
                            fontSize: '13px',
                            resize: 'vertical',
                            outline: 'none',
                            transition: 'border-color 0.2s',
                            minHeight: '44px',
                        }}
                        onFocus={(e) => (e.target.style.borderColor = '#8b5cf680')}
                        onBlur={(e) => (e.target.style.borderColor = '#27272a')}
                    />
                </div>

                {/* 总库选择 */}
                {sourceSheets.length > 0 && (
                    <div>
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            marginBottom: '6px',
                        }}>
                            <span style={{ fontSize: '11px', color: '#71717a', fontWeight: 500 }}>📚 总库</span>
                            <div style={{ display: 'flex', gap: '4px' }}>
                                <button
                                    onClick={onSyncLibraries}
                                    disabled={isSyncing}
                                    style={{
                                        padding: '3px 8px',
                                        borderRadius: '6px',
                                        border: '1px solid #27272a',
                                        background: 'transparent',
                                        color: '#71717a',
                                        fontSize: '10px',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        gap: '3px',
                                    }}
                                >
                                    <RefreshCw size={10} className={isSyncing ? 'animate-spin' : ''} /> 同步
                                </button>
                            </div>
                        </div>
                        <select
                            value={activeSourceSheet}
                            onChange={(e) => {
                                const sheet = e.target.value;
                                const updatedLibraries = randomLibraryConfig.libraries.map(lib => ({
                                    ...lib,
                                    enabled: lib.sourceSheet === sheet || !lib.sourceSheet
                                }));
                                onRandomLibraryConfigChange({
                                    ...randomLibraryConfig,
                                    activeSourceSheet: sheet,
                                    libraries: updatedLibraries
                                });
                            }}
                            style={{
                                width: '100%',
                                padding: '8px 12px',
                                borderRadius: '8px',
                                border: '1.5px solid #8b5cf640',
                                background: '#18181b',
                                color: '#a78bfa',
                                fontSize: '12px',
                                fontWeight: 500,
                                cursor: 'pointer',
                                outline: 'none',
                                appearance: 'auto',
                            }}
                        >
                            {sourceSheets.map(sheet => (
                                <option key={sheet} value={sheet}>{sheet}</option>
                            ))}
                        </select>
                    </div>
                )
                }

                {/* 覆盖标签 */}
                {
                    enabledLibs.length > 0 && (
                        <div>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '6px' }}>
                                <span style={{ fontSize: '11px', color: '#71717a', fontWeight: 500 }}>
                                    🎯 覆盖 {selectedImageId && <span style={{ color: '#3b82f6', fontSize: '10px' }}>(点击标签关联选中图片)</span>}
                                </span>
                                {Object.keys(imageDimensionMap).length > 0 && (
                                    <button
                                        onClick={() => setImageDimensionMap({})}
                                        style={{ fontSize: '9px', color: '#71717a', background: 'none', border: 'none', cursor: 'pointer' }}
                                    >
                                        清除关联
                                    </button>
                                )}
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px' }}>
                                {enabledLibs.map(lib => {
                                    const override = quickOverrides[lib.name];
                                    const hasOverride = !!(override?.value?.trim()) || override?.mode === 'queue-image';
                                    const isInlineEditing = inlineEditLib === lib.name;
                                    const linkedImageId = imageDimensionMap[lib.name];
                                    const linkedImage = linkedImageId ? images.find(i => i.id === linkedImageId) : null;
                                    const modeIcon = override?.mode === 'image' ? '📷' : override?.mode === 'queue-image' ? '🔄' : '';
                                    return (
                                        <button
                                            key={lib.id}
                                            onClick={() => {
                                                if (selectedImageId) {
                                                    if (imageDimensionMap[lib.name] === selectedImageId) {
                                                        // 已关联当前图片 → 打开编辑器设置提取要求
                                                        setInlineEditLib(inlineEditLib === lib.name ? null : lib.name);
                                                    } else {
                                                        // 未关联 → 关联到这个维度
                                                        setImageDimensionMap(prev => ({ ...prev, [lib.name]: selectedImageId }));
                                                    }
                                                } else {
                                                    // 没有选中图片 → 展开文本编辑器
                                                    setInlineEditLib(isInlineEditing ? null : lib.name);
                                                }
                                            }}
                                            style={{
                                                padding: '3px 8px',
                                                borderRadius: '6px',
                                                border: isInlineEditing
                                                    ? '1.5px solid #8b5cf6'
                                                    : linkedImage
                                                        ? '1.5px solid #f59e0b'
                                                        : hasOverride
                                                            ? '1px solid rgba(245,158,11,0.4)'
                                                            : selectedImageId
                                                                ? '1px solid rgba(59,130,246,0.4)'
                                                                : '1px solid #27272a',
                                                background: linkedImage
                                                    ? 'rgba(245,158,11,0.15)'
                                                    : hasOverride
                                                        ? 'rgba(245,158,11,0.1)'
                                                        : selectedImageId
                                                            ? 'rgba(59,130,246,0.08)'
                                                            : '#18181b',
                                                color: linkedImage
                                                    ? '#fbbf24'
                                                    : hasOverride
                                                        ? '#fbbf24'
                                                        : selectedImageId
                                                            ? '#60a5fa'
                                                            : '#71717a',
                                                fontSize: '11px',
                                                cursor: 'pointer',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '4px',
                                                transition: 'all 0.15s',
                                            }}
                                        >
                                            {linkedImage && (
                                                <img src={linkedImage.imageUrl} alt="" style={{
                                                    width: '16px', height: '16px', borderRadius: '3px', objectFit: 'cover',
                                                }} />
                                            )}
                                            {modeIcon && <span style={{ fontSize: '10px' }}>{modeIcon}</span>}
                                            {lib.name}
                                            {(hasOverride || linkedImage) && (
                                                <X size={8} style={{ opacity: 0.6 }} onClick={(e) => {
                                                    e.stopPropagation();
                                                    onOverrideChange(lib.name, { value: '' });
                                                    setImageDimensionMap(prev => { const n = { ...prev }; delete n[lib.name]; return n; });
                                                }} />
                                            )}
                                        </button>
                                    );
                                })}
                            </div>
                            {/* 内联编辑器 */}
                            {inlineEditLib && (() => {
                                const override = quickOverrides[inlineEditLib];
                                const linkedImg = imageDimensionMap[inlineEditLib];
                                const hasLinkedImage = !!linkedImg;
                                return (
                                    <div style={{
                                        marginTop: '8px',
                                        padding: '10px',
                                        borderRadius: '8px',
                                        border: '1px solid #3f3f46',
                                        background: '#18181b',
                                        display: 'flex',
                                        flexDirection: 'column',
                                        gap: '8px',
                                    }}>
                                        <div style={{ fontSize: '11px', color: '#a1a1aa', fontWeight: 600 }}>
                                            「{inlineEditLib}」
                                        </div>
                                        {/* 固定值 */}
                                        <div>
                                            <div style={{ fontSize: '9px', color: '#71717a', marginBottom: '3px' }}>✈️ 固定值</div>
                                            <input
                                                type="text"
                                                value={override?.value || ''}
                                                onChange={(e) => onOverrideChange(inlineEditLib, { value: e.target.value })}
                                                onKeyDown={(e) => { if (e.key === 'Enter') setInlineEditLib(null); }}
                                                placeholder={`输入${inlineEditLib}固定值…`}
                                                autoFocus
                                                style={{
                                                    width: '100%',
                                                    padding: '5px 8px',
                                                    borderRadius: '6px',
                                                    border: '1px solid #3f3f46',
                                                    background: '#0f0f12',
                                                    color: '#e4e4e7',
                                                    fontSize: '11px',
                                                    outline: 'none',
                                                    boxSizing: 'border-box',
                                                }}
                                                onFocus={(e) => (e.target.style.borderColor = '#8b5cf6')}
                                                onBlur={(e) => (e.target.style.borderColor = '#3f3f46')}
                                            />
                                        </div>
                                        {/* 提取要求 */}
                                        {hasLinkedImage && (
                                            <div>
                                                <div style={{ fontSize: '9px', color: '#71717a', marginBottom: '3px' }}>📷 提取要求（从关联图片中提取什么）</div>
                                                <input
                                                    type="text"
                                                    value={override?.extractPrompt || ''}
                                                    onChange={(e) => onOverrideChange(inlineEditLib, { extractPrompt: e.target.value })}
                                                    placeholder={`例如：提取主体风格、描述灯光氛围…`}
                                                    style={{
                                                        width: '100%',
                                                        padding: '5px 8px',
                                                        borderRadius: '6px',
                                                        border: '1px solid #3f3f46',
                                                        background: '#0f0f12',
                                                        color: '#e4e4e7',
                                                        fontSize: '11px',
                                                        outline: 'none',
                                                        boxSizing: 'border-box',
                                                    }}
                                                    onFocus={(e) => (e.target.style.borderColor = '#f59e0b')}
                                                    onBlur={(e) => (e.target.style.borderColor = '#3f3f46')}
                                                />
                                            </div>
                                        )}
                                        {/* 覆盖个数 */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ fontSize: '9px', color: '#71717a' }}>🔢 覆盖个数</span>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                <button
                                                    onClick={() => onOverrideChange(inlineEditLib, { count: Math.max(0, (override?.count || 0) - 1) })}
                                                    style={{ width: '20px', height: '20px', borderRadius: '4px', border: '1px solid #3f3f46', background: '#0f0f12', color: '#a1a1aa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}
                                                >
                                                    <Minus size={10} />
                                                </button>
                                                <span style={{ fontSize: '11px', color: (override?.count || 0) === 0 ? '#8b5cf6' : '#e4e4e7', minWidth: '24px', textAlign: 'center', fontWeight: 600 }}>
                                                    {(override?.count || 0) === 0 ? '全部' : override.count}
                                                </span>
                                                <button
                                                    onClick={() => onOverrideChange(inlineEditLib, { count: (override?.count || 0) + 1 })}
                                                    style={{ width: '20px', height: '20px', borderRadius: '4px', border: '1px solid #3f3f46', background: '#0f0f12', color: '#a1a1aa', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12px' }}
                                                >
                                                    <Plus size={10} />
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}
                        </div>
                    )
                }

                {/* 底部操作栏 */}
                <div style={{ marginTop: 'auto', paddingTop: '8px' }}>
                    <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                        {/* 开始创新 / 暂停停止 */}
                        {isProcessing ? (
                            <>
                                {/* 暂停/继续 */}
                                <button
                                    onClick={onPauseResume}
                                    style={{
                                        flex: 1,
                                        padding: '12px 16px',
                                        borderRadius: '10px',
                                        border: 'none',
                                        background: isPaused
                                            ? 'linear-gradient(135deg, #22c55e, #16a34a)'
                                            : 'linear-gradient(135deg, #f59e0b, #d97706)',
                                        color: 'white',
                                        fontSize: '14px',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '6px',
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    {isPaused ? (
                                        <><Play size={16} fill="currentColor" /> 继续</>
                                    ) : (
                                        <><Pause size={16} fill="currentColor" /> 暂停</>
                                    )}
                                </button>
                                {/* 停止 */}
                                <button
                                    onClick={onStop}
                                    style={{
                                        padding: '12px 16px',
                                        borderRadius: '10px',
                                        border: 'none',
                                        background: 'linear-gradient(135deg, #ef4444, #dc2626)',
                                        color: 'white',
                                        fontSize: '14px',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '6px',
                                        transition: 'all 0.2s',
                                    }}
                                >
                                    <Square size={14} fill="currentColor" /> 停止
                                </button>
                            </>
                        ) : noImageMode && textCards.some(c => c.status === 'done') ? (
                            <div style={{ display: 'flex', gap: '6px', flex: 1 }}>
                                {/* 追加创新 */}
                                <button
                                    onClick={onStartInnovation}
                                    style={{
                                        flex: 1,
                                        padding: '10px 10px',
                                        borderRadius: '10px',
                                        border: 'none',
                                        background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                                        color: 'white',
                                        fontSize: '12px',
                                        fontWeight: 700,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '4px',
                                        transition: 'all 0.2s',
                                        boxShadow: '0 4px 14px rgba(139,92,246,0.25)',
                                    }}
                                >
                                    <Plus size={14} /> 追加
                                </button>
                                {/* 重跑全部 */}
                                {onRerunCards && (
                                    <button
                                        onClick={onRerunCards}
                                        style={{
                                            padding: '10px 10px',
                                            borderRadius: '10px',
                                            border: '1px solid #3f3f46',
                                            background: '#27272a',
                                            color: '#a1a1aa',
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '4px',
                                            transition: 'all 0.2s',
                                        }}
                                    >
                                        <RefreshCw size={12} /> 重跑
                                    </button>
                                )}
                                {/* 重试失败 */}
                                {onRetryFailed && textCards.some(c => c.status === 'error') && (
                                    <button
                                        onClick={onRetryFailed}
                                        style={{
                                            padding: '10px 10px',
                                            borderRadius: '10px',
                                            border: '1px solid #7f1d1d',
                                            background: '#371717',
                                            color: '#f87171',
                                            fontSize: '12px',
                                            fontWeight: 600,
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            gap: '4px',
                                            transition: 'all 0.2s',
                                        }}
                                    >
                                        <RotateCcw size={12} /> 重试
                                    </button>
                                )}
                            </div>
                        ) : (
                            <button
                                onClick={onStartInnovation}
                                style={{
                                    flex: 1,
                                    padding: '12px 16px',
                                    borderRadius: '10px',
                                    border: 'none',
                                    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                                    color: 'white',
                                    fontSize: '14px',
                                    fontWeight: 700,
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    gap: '6px',
                                    transition: 'all 0.2s',
                                    boxShadow: '0 4px 14px rgba(139,92,246,0.25)',
                                }}
                            >
                                <Sparkles size={16} fill="currentColor" /> 开始创新
                            </button>
                        )}

                        {/* 生成个数 */}
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            alignItems: 'center',
                            gap: '2px',
                        }}>
                            <span style={{ fontSize: '9px', color: '#52525b', whiteSpace: 'nowrap' }}>生成个数</span>
                            <div style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '2px',
                                background: '#18181b',
                                borderRadius: '8px',
                                border: '1px solid #27272a',
                                padding: '4px',
                            }}>
                                <button
                                    onClick={() => onCreativeCountChange(Math.max(1, creativeCount - 1))}
                                    style={{
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '6px',
                                        border: 'none',
                                        background: '#27272a',
                                        color: '#a1a1aa',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Minus size={12} />
                                </button>
                                <span style={{
                                    minWidth: '28px',
                                    textAlign: 'center',
                                    fontSize: '14px',
                                    fontWeight: 700,
                                    color: '#a78bfa',
                                }}>
                                    {creativeCount}
                                </span>
                                <button
                                    onClick={() => onCreativeCountChange(Math.min(50, creativeCount + 1))}
                                    style={{
                                        width: '28px',
                                        height: '28px',
                                        borderRadius: '6px',
                                        border: 'none',
                                        background: '#27272a',
                                        color: '#a1a1aa',
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                    }}
                                >
                                    <Plus size={12} />
                                </button>
                            </div>
                        </div>
                    </div>

                    {/* 无图模式 */}
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: '6px',
                        marginTop: '8px',
                    }}>
                        <span style={{ fontSize: '11px', color: '#52525b' }}>无图模式</span>
                        <button
                            onClick={onToggleNoImageMode}
                            style={{
                                background: 'none',
                                border: 'none',
                                cursor: 'pointer',
                                color: noImageMode ? '#8b5cf6' : '#3f3f46',
                                padding: 0,
                                display: 'flex',
                            }}
                        >
                            {noImageMode
                                ? <ToggleRight size={22} fill="#8b5cf6" />
                                : <ToggleLeft size={22} />
                            }
                        </button>
                    </div>
                </div>
            </div >

            {/* ===== 右面板 ===== */}
            < div style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                background: '#09090b',
            }}>
                {/* 结果头部 */}
                < div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '12px 16px',
                    borderBottom: '1px solid #1f1f23',
                    flexShrink: 0,
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontSize: '14px', fontWeight: 600 }}>
                            结果
                        </span>
                        {totalInnovations > 0 && (
                            <span style={{
                                fontSize: '11px',
                                color: '#8b5cf6',
                                background: 'rgba(139,92,246,0.12)',
                                padding: '2px 8px',
                                borderRadius: '10px',
                                fontWeight: 600,
                            }}>
                                {totalInnovations}
                            </span>
                        )}
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        {[
                            { label: 'EN', fn: onCopyEN, key: 'creative-en', color: '#60a5fa' },
                            { label: '中', fn: onCopyZH, key: 'creative-zh', color: '#fb923c' },
                            { label: '全', fn: onCopyAll, key: 'creative-all', color: '#34d399' },
                        ].map(({ label, fn, key, color }) => (
                            <button
                                key={key}
                                onClick={fn}
                                disabled={successCount === 0}
                                style={{
                                    padding: '4px 10px',
                                    borderRadius: '6px',
                                    border: `1px solid ${copySuccess === key ? '#10b98140' : '#27272a'}`,
                                    background: copySuccess === key ? 'rgba(16,185,129,0.15)' : '#18181b',
                                    color: copySuccess === key ? '#34d399' : successCount > 0 ? color : '#3f3f46',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    cursor: successCount > 0 ? 'pointer' : 'not-allowed',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    transition: 'all 0.15s',
                                }}
                            >
                                {copySuccess === key ? <Check size={11} /> : <Copy size={11} />}
                                {label}
                            </button>
                        ))}
                        <button
                            onClick={downloadCSV}
                            disabled={successCount === 0}
                            style={{
                                padding: '4px 8px',
                                borderRadius: '6px',
                                border: '1px solid #27272a',
                                background: '#18181b',
                                color: successCount > 0 ? '#a1a1aa' : '#3f3f46',
                                fontSize: '11px',
                                cursor: successCount > 0 ? 'pointer' : 'not-allowed',
                                display: 'flex',
                                alignItems: 'center',
                            }}
                            title="下载CSV"
                        >
                            <Download size={12} />
                        </button>
                        {creativeResults.length > 0 && (
                            <button
                                onClick={onClearResults}
                                style={{
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid rgba(239,68,68,0.2)',
                                    background: 'rgba(239,68,68,0.06)',
                                    color: '#f87171',
                                    fontSize: '11px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                }}
                                title="清空结果"
                            >
                                <X size={12} />
                            </button>
                        )}
                    </div>
                </div >

                {/* 结果列表 */}
                < div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '12px 16px',
                }}>
                    {
                        noImageMode ? (
                            // 无图模式结果展示
                            textCards.length === 0 && !isGeneratingNoImage ? (
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    alignItems: 'center',
                                    justifyContent: 'center',
                                    height: '100%',
                                    color: '#3f3f46',
                                    gap: '12px',
                                }}>
                                    <Sparkles size={40} style={{ opacity: 0.3 }} />
                                    <div style={{ fontSize: '14px' }}>输入主题后点击"开始创新"</div>
                                    <div style={{ fontSize: '12px' }}>结果将显示在这里</div>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                    {textCards.map((card) => (
                                        <div key={card.id} style={{
                                            borderRadius: '10px',
                                            border: '1px solid #27272a',
                                            background: '#18181b',
                                            overflow: 'hidden',
                                        }}>
                                            {/* 卡片头部 */}
                                            <div style={{
                                                padding: '8px 12px',
                                                borderBottom: '1px solid #27272a',
                                                display: 'flex',
                                                alignItems: 'center',
                                                justifyContent: 'space-between',
                                                background: '#1c1c20',
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                                    <span style={{ fontSize: '11px', color: '#ec4899', fontWeight: 600 }}>主题：{card.topic}</span>
                                                    {card.createdAt && (
                                                        <span style={{ fontSize: '9px', color: '#52525b' }}>{new Date(card.createdAt).toLocaleTimeString()}</span>
                                                    )}
                                                    {card.status === 'processing' && (
                                                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px', fontSize: '10px', color: '#8b5cf6' }}>
                                                            <Loader2 size={10} className="animate-spin" /> 生成中
                                                        </span>
                                                    )}
                                                    {card.status === 'done' && (
                                                        <span style={{ fontSize: '10px', color: '#34d399' }}>✓ 完成</span>
                                                    )}
                                                    {card.status === 'error' && (
                                                        <span style={{ fontSize: '10px', color: '#f87171' }}>✗ 失败</span>
                                                    )}
                                                </div>
                                                {card.results.length > 0 && (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                        <span style={{ fontSize: '10px', color: '#71717a' }}>{card.results.length} 条结果</span>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const text = card.results.map(r => r.replace(/[\r\n]+/g, ' ').trim()).join('\n');
                                                                navigator.clipboard.writeText(text);
                                                                setCopiedId(`card-en-${card.id}`);
                                                                setTimeout(() => setCopiedId(null), 1500);
                                                            }}
                                                            style={{
                                                                padding: '2px 6px',
                                                                borderRadius: '4px',
                                                                border: '1px solid #27272a',
                                                                background: copiedId === `card-en-${card.id}` ? 'rgba(16,185,129,0.15)' : 'transparent',
                                                                color: copiedId === `card-en-${card.id}` ? '#34d399' : '#60a5fa',
                                                                fontSize: '9px',
                                                                fontWeight: 600,
                                                                cursor: 'pointer',
                                                            }}
                                                        >
                                                            {copiedId === `card-en-${card.id}` ? '✓' : 'EN'}
                                                        </button>
                                                        {card.resultsZh && card.resultsZh.length > 0 && (
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    const text = (card.resultsZh || []).map(r => r.replace(/[\r\n]+/g, ' ').trim()).join('\n');
                                                                    navigator.clipboard.writeText(text);
                                                                    setCopiedId(`card-zh-${card.id}`);
                                                                    setTimeout(() => setCopiedId(null), 1500);
                                                                }}
                                                                style={{
                                                                    padding: '2px 6px',
                                                                    borderRadius: '4px',
                                                                    border: '1px solid #27272a',
                                                                    background: copiedId === `card-zh-${card.id}` ? 'rgba(16,185,129,0.15)' : 'transparent',
                                                                    color: copiedId === `card-zh-${card.id}` ? '#34d399' : '#fb923c',
                                                                    fontSize: '9px',
                                                                    fontWeight: 600,
                                                                    cursor: 'pointer',
                                                                }}
                                                            >
                                                                {copiedId === `card-zh-${card.id}` ? '✓' : '中'}
                                                            </button>
                                                        )}
                                                    </div>
                                                )}
                                            </div>
                                            {/* 卡片结果 */}
                                            <div style={{ padding: '8px 12px' }}>
                                                {card.status === 'processing' && card.results.length === 0 ? (
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' }}>
                                                        <Loader2 size={14} style={{ color: '#8b5cf6' }} className="animate-spin" />
                                                        <span style={{ color: '#71717a', fontSize: '12px' }}>AI 正在创作...</span>
                                                    </div>
                                                ) : card.results.length > 0 ? (
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                                        {card.results.map((result, idx) => (
                                                            <div
                                                                key={idx}
                                                                style={{
                                                                    padding: '10px 12px',
                                                                    borderRadius: '8px',
                                                                    background: '#141416',
                                                                    border: '1px solid #1f1f23',
                                                                    cursor: 'pointer',
                                                                    transition: 'all 0.15s',
                                                                    position: 'relative',
                                                                }}
                                                                onMouseEnter={(e) => {
                                                                    e.currentTarget.style.borderColor = '#27272a';
                                                                    e.currentTarget.style.background = '#1a1a1e';
                                                                }}
                                                                onMouseLeave={(e) => {
                                                                    e.currentTarget.style.borderColor = '#1f1f23';
                                                                    e.currentTarget.style.background = '#141416';
                                                                }}
                                                                onClick={() => {
                                                                    const clean = result.replace(/[\r\n]+/g, ' ').trim();
                                                                    navigator.clipboard.writeText(clean);
                                                                    setCopiedId(`${card.id}-${idx}`);
                                                                    setTimeout(() => setCopiedId(null), 1500);
                                                                }}
                                                            >
                                                                <div style={{ fontSize: '12px', color: '#d4d4d8', lineHeight: '1.6', whiteSpace: 'pre-wrap', wordBreak: 'break-word' }}>
                                                                    {result}
                                                                </div>
                                                                {card.resultsZh && card.resultsZh[idx] && (
                                                                    <div style={{ fontSize: '11px', color: '#67e8f9', lineHeight: '1.5', whiteSpace: 'pre-wrap', wordBreak: 'break-word', marginTop: '6px', paddingTop: '6px', borderTop: '1px solid #27272a' }}>
                                                                        {card.resultsZh[idx]}
                                                                    </div>
                                                                )}
                                                                {copiedId === `${card.id}-${idx}` && (
                                                                    <div style={{
                                                                        position: 'absolute',
                                                                        top: '6px',
                                                                        right: '8px',
                                                                        fontSize: '10px',
                                                                        color: '#34d399',
                                                                        background: 'rgba(6,78,59,0.3)',
                                                                        padding: '2px 6px',
                                                                        borderRadius: '4px',
                                                                    }}>
                                                                        已复制 ✓
                                                                    </div>
                                                                )}
                                                            </div>
                                                        ))}
                                                    </div>
                                                ) : card.status === 'error' ? (
                                                    <div style={{ fontSize: '12px', color: '#f87171', padding: '8px 0' }}>生成失败</div>
                                                ) : (
                                                    <div style={{ fontSize: '12px', color: '#3f3f46', padding: '8px 0', fontStyle: 'italic' }}>等待生成...</div>
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )
                        ) : creativeResults.length === 0 && !isProcessing ? (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '100%',
                                color: '#3f3f46',
                                gap: '12px',
                            }}>
                                <Sparkles size={40} style={{ opacity: 0.3 }} />
                                <div style={{ fontSize: '14px' }}>{noImageMode ? '输入主题后点击"开始创新"' : '上传图片后点击"开始创新"'}</div>
                                <div style={{ fontSize: '12px' }}>结果将显示在这里</div>
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                                {creativeResults.map((result, rIdx) => {
                                    if (result.status === 'processing') {
                                        return (
                                            <div key={result.imageId} style={{
                                                padding: '16px',
                                                borderRadius: '10px',
                                                border: '1px solid #27272a',
                                                background: '#18181b',
                                                display: 'flex',
                                                alignItems: 'center',
                                                gap: '12px',
                                            }}>
                                                <Loader2 size={18} style={{ color: '#8b5cf6' }} className="animate-spin" />
                                                <span style={{ color: '#71717a', fontSize: '13px' }}>正在生成...</span>
                                            </div>
                                        );
                                    }

                                    if (result.status === 'error') {
                                        return (
                                            <div key={result.imageId} style={{
                                                padding: '12px 16px',
                                                borderRadius: '10px',
                                                border: '1px solid rgba(239,68,68,0.2)',
                                                background: 'rgba(239,68,68,0.05)',
                                                color: '#f87171',
                                                fontSize: '13px',
                                            }}>
                                                ❌ {result.error || '生成失败'}
                                            </div>
                                        );
                                    }

                                    return result.innovations?.map((innovation, iIdx) => (
                                        <div
                                            key={innovation.id}
                                            style={{
                                                padding: '14px 16px',
                                                borderRadius: '10px',
                                                border: '1px solid #1f1f23',
                                                background: '#141416',
                                                transition: 'all 0.15s',
                                                cursor: 'pointer',
                                                position: 'relative',
                                            }}
                                            onMouseEnter={(e) => {
                                                e.currentTarget.style.borderColor = '#27272a';
                                                e.currentTarget.style.background = '#1a1a1e';
                                            }}
                                            onMouseLeave={(e) => {
                                                e.currentTarget.style.borderColor = '#1f1f23';
                                                e.currentTarget.style.background = '#141416';
                                            }}
                                            onClick={() => copySingleResult(innovation.textEn, innovation.id)}
                                        >
                                            <div style={{
                                                display: 'flex',
                                                alignItems: 'flex-start',
                                                gap: '10px',
                                            }}>
                                                {/* 序号 */}
                                                <span style={{
                                                    fontSize: '10px',
                                                    color: '#52525b',
                                                    fontWeight: 700,
                                                    minWidth: '20px',
                                                    paddingTop: '2px',
                                                }}>
                                                    {rIdx * 10 + iIdx + 1}
                                                </span>
                                                {/* 内容 */}
                                                <div style={{ flex: 1 }}>
                                                    <div style={{
                                                        fontSize: '13px',
                                                        lineHeight: '1.6',
                                                        color: '#d4d4d8',
                                                    }}>
                                                        {innovation.textEn}
                                                    </div>
                                                    {innovation.textZh && (
                                                        <div style={{
                                                            fontSize: '12px',
                                                            lineHeight: '1.5',
                                                            color: '#52525b',
                                                            marginTop: '6px',
                                                        }}>
                                                            {innovation.textZh}
                                                        </div>
                                                    )}
                                                </div>
                                                {/* 复制按钮 */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        copySingleResult(innovation.textEn, innovation.id);
                                                    }}
                                                    style={{
                                                        padding: '4px',
                                                        borderRadius: '4px',
                                                        border: 'none',
                                                        background: 'transparent',
                                                        color: copiedId === innovation.id ? '#34d399' : '#3f3f46',
                                                        cursor: 'pointer',
                                                        flexShrink: 0,
                                                        transition: 'color 0.15s',
                                                    }}
                                                >
                                                    {copiedId === innovation.id
                                                        ? <Check size={14} />
                                                        : <Copy size={14} />
                                                    }
                                                </button>
                                            </div>
                                        </div>
                                    ));
                                })}
                            </div>
                        )
                    }
                </div >
            </div >
        </div >
    );
};
