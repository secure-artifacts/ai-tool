/**
 * 快捷模式独立界面 - 简约App风格
 * 复用现有的所有逻辑层，只是UI表现层不同
 */

import React, { useState, useCallback, useRef, useEffect } from 'react';
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
    Trash2,
    Eye,
    FileCode,
    LayoutGrid,
} from 'lucide-react';
import { CreativeResult, ImageItem, DEFAULT_PRESETS } from '../types';
import { RandomLibraryConfig, getDefaultExtractPrompt } from '../services/randomLibraryService';
import { ConversationLogModal } from './ResultsGrid';

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
    onOverrideChange: (libName: string, updates: { value?: string; extractPrompt?: string; count?: number; mode?: 'text' | 'image' | 'queue-image' }) => void;
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
    onClearTextCards?: () => void;

    // 复制
    onCopyEN: () => void;
    onCopyZH: () => void;
    onCopyAll: () => void;
    onCopyFormulas?: () => void;
    onCopyOriginalAndResults?: () => void;
    copySuccess: string | null;

    // 视图切换
    onSwitchToClassic: () => void;

    // 全局：先描述原图
    needDescribeFirst: boolean;
    onToggleNeedDescribeFirst: (val: boolean) => void;
    // 描述预设
    originalDescPresetId?: string;
    onSetOriginalDescPresetId?: (presetId: string) => void;
    originalDescCustomPrompt?: string;
    onSetOriginalDescCustomPrompt?: (value: string) => void;
    // 图片级：参考图配置更新
    onUpdateRefImageConfig?: (cardId: string, imageIndex: number, update: Partial<import('../types').RefImageConfig> | null) => void;
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
    onClearTextCards,
    onCopyEN,
    onCopyZH,
    onCopyAll,
    onCopyFormulas,
    onCopyOriginalAndResults,
    copySuccess,
    onSwitchToClassic,
    needDescribeFirst,
    onToggleNeedDescribeFirst,
    originalDescPresetId = '1',
    onSetOriginalDescPresetId,
    originalDescCustomPrompt = '',
    onSetOriginalDescCustomPrompt,
    onUpdateRefImageConfig,
}) => {
    const MIN_LEFT_PANEL_WIDTH = 340;
    const DEFAULT_LEFT_RATIO = 0.33;
    const fileInputRef = useRef<HTMLInputElement>(null);
    const [isDragOver, setIsDragOver] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [inlineEditLib, setInlineEditLib] = useState<string | null>(null);
    const [selectedImageId, setSelectedImageId] = useState<string | null>(null);
    const [leftPanelWidth, setLeftPanelWidth] = useState(() => {
        if (typeof window === 'undefined') return 380;
        const maxWidth = Math.floor(window.innerWidth * 0.78);
        const defaultWidth = Math.round(window.innerWidth * DEFAULT_LEFT_RATIO);
        return Math.max(MIN_LEFT_PANEL_WIDTH, Math.min(maxWidth, defaultWidth));
    });
    // 图片→维度映射： dimensionName → imageId （从卡片数据 refImageConfigs 重建）
    const [imageDimensionMap, setImageDimensionMap] = useState<Record<string, string>>(() => {
        if (images.length === 0) return {};
        const card = images[0];
        const cfgs = card.refImageConfigs || [];
        const map: Record<string, string> = {};
        // 构建 imageIndex → imageId 的映射
        const allImgs: string[] = [card.id];
        card.fusionImages?.forEach(fi => allImgs.push(fi.id));
        for (const cfg of cfgs) {
            if (cfg.dimName && cfg.dimName !== '__describe__' && cfg.dimName !== '__append__' && cfg.imageIndex < allImgs.length) {
                map[cfg.dimName] = allImgs[cfg.imageIndex];
            }
        }
        return map;
    });
    // 双击放大编辑弹窗
    const [expandedEdit, setExpandedEdit] = useState<{
        title: string;
        value: string;
        onChange: (val: string) => void;
    } | null>(null);
    // AI对话记录弹窗
    const [showConversationLog, setShowConversationLog] = useState(false);
    // 悬浮大图预览
    const [hoveredPreview, setHoveredPreview] = useState<{ url: string; x: number; y: number } | null>(null);

    const clampLeftPanelWidth = useCallback((nextWidth: number) => {
        if (typeof window === 'undefined') return nextWidth;
        const maxWidth = Math.floor(window.innerWidth * 0.78);
        return Math.max(MIN_LEFT_PANEL_WIDTH, Math.min(maxWidth, nextWidth));
    }, []);

    useEffect(() => {
        const onResize = () => {
            setLeftPanelWidth(prev => clampLeftPanelWidth(prev));
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [clampLeftPanelWidth]);

    const handleTogglePresetSplit = useCallback(() => {
        if (typeof window === 'undefined') return;
        const oneThird = clampLeftPanelWidth(Math.round(window.innerWidth * DEFAULT_LEFT_RATIO));
        const half = clampLeftPanelWidth(Math.round(window.innerWidth * 0.5));
        setLeftPanelWidth(prev => (Math.abs(prev - oneThird) <= 20 ? half : oneThird));
    }, [clampLeftPanelWidth]);

    const handleStartResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = leftPanelWidth;
        const prevCursor = document.body.style.cursor;
        const prevUserSelect = document.body.style.userSelect;
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';

        const handleMouseMove = (event: MouseEvent) => {
            const delta = event.clientX - startX;
            setLeftPanelWidth(clampLeftPanelWidth(startWidth + delta));
        };

        const handleMouseUp = () => {
            document.body.style.cursor = prevCursor;
            document.body.style.userSelect = prevUserSelect;
            window.removeEventListener('mousemove', handleMouseMove);
            window.removeEventListener('mouseup', handleMouseUp);
        };

        window.addEventListener('mousemove', handleMouseMove);
        window.addEventListener('mouseup', handleMouseUp);
    }, [clampLeftPanelWidth, leftPanelWidth]);

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
                width: `${leftPanelWidth}px`,
                minWidth: `${MIN_LEFT_PANEL_WIDTH}px`,
                display: 'flex',
                flexDirection: 'column',
                gap: '12px',
                padding: '16px',
                boxSizing: 'border-box',
                overflowY: 'auto',
                overflowX: 'hidden',
                background: '#0f0f12',
            }} className="quick-standalone-scroll">
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
                )}

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
                                    {(() => {
                                        const card = images[0];
                                        const fusionCount = card?.fusionImages?.length || 0;
                                        const totalCount = 1 + fusionCount;
                                        // Build unified image list
                                        const allImgs: Array<{ id: string; url: string }> = [];
                                        if (card) {
                                            allImgs.push({ id: card.id, url: card.imageUrl || '' });
                                            card.fusionImages?.forEach(fi => {
                                                allImgs.push({ id: fi.id, url: fi.imageUrl || '' });
                                            });
                                        }
                                        return (
                                            <>
                                                <div style={{
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'space-between',
                                                    marginBottom: '8px',
                                                }}>
                                                    <span style={{ fontSize: '11px', color: '#71717a' }}>
                                                        已添加 {totalCount} 张图片
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
                                                    overflowX: 'hidden',
                                                    paddingRight: '4px',
                                                }} className="quick-standalone-scroll">
                                                    {allImgs.map(imgEntry => {
                                                        const isSelected = selectedImageId === imgEntry.id;
                                                        // 查找这张图片关联了哪些维度
                                                        const linkedDims = Object.entries(imageDimensionMap)
                                                            .filter(([_, imgId]) => imgId === imgEntry.id)
                                                            .map(([dim]) => dim);
                                                        return (
                                                            <div
                                                                key={imgEntry.id}
                                                                onClick={(e) => { e.stopPropagation(); setSelectedImageId(isSelected ? null : imgEntry.id); }}
                                                                onMouseEnter={(e) => {
                                                                    const rect = e.currentTarget.getBoundingClientRect();
                                                                    setHoveredPreview({ url: imgEntry.url, x: rect.right + 8, y: rect.top });
                                                                }}
                                                                onMouseLeave={() => setHoveredPreview(null)}
                                                                style={{
                                                                    position: 'relative',
                                                                    width: '56px',
                                                                    height: '56px',
                                                                    cursor: 'pointer',
                                                                }}
                                                            >
                                                                <img
                                                                    src={imgEntry.url}
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
                                                                {/* 图片序号 */}
                                                                {allImgs.length > 1 && (
                                                                    <div style={{
                                                                        position: 'absolute',
                                                                        top: '1px',
                                                                        right: '2px',
                                                                        fontSize: '8px',
                                                                        lineHeight: 1,
                                                                        color: '#a1a1aa',
                                                                        background: 'rgba(0,0,0,0.5)',
                                                                        borderRadius: '3px',
                                                                        padding: '1px 3px',
                                                                    }}>{allImgs.indexOf(imgEntry) + 1}</div>
                                                                )}
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
                                                                {/* 图片级「先描述」按钮 */}
                                                                {onUpdateRefImageConfig && card && (() => {
                                                                    const imgIndex = allImgs.indexOf(imgEntry);
                                                                    const configs = card.refImageConfigs || [];
                                                                    const hasDescribe = configs.some(c => c.imageIndex === imgIndex && c.dimName === '__describe__');
                                                                    return (
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                if (hasDescribe) {
                                                                                    onUpdateRefImageConfig(card.id, imgIndex, { dimName: '__remove____describe__' } as any);
                                                                                } else {
                                                                                    onUpdateRefImageConfig(card.id, imgIndex, { dimName: '__describe__', extractPrompt: '' });
                                                                                    // 开启时自动选中此图片，以便显示描述指令编辑区
                                                                                    setSelectedImageId(imgEntry.id);
                                                                                }
                                                                            }}
                                                                            style={{
                                                                                position: 'absolute',
                                                                                bottom: linkedDims.length > 0 ? '10px' : '-2px',
                                                                                left: '50%',
                                                                                transform: 'translateX(-50%)',
                                                                                background: hasDescribe ? 'rgba(245,158,11,0.9)' : 'rgba(39,39,42,0.85)',
                                                                                color: hasDescribe ? '#000' : '#a1a1aa',
                                                                                fontSize: '7px',
                                                                                fontWeight: 700,
                                                                                padding: '1px 4px',
                                                                                borderRadius: '3px',
                                                                                border: hasDescribe ? '1px solid #f59e0b' : '1px solid #3f3f46',
                                                                                cursor: 'pointer',
                                                                                whiteSpace: 'nowrap',
                                                                                maxWidth: '54px',
                                                                                overflow: 'hidden',
                                                                                textOverflow: 'ellipsis',
                                                                                zIndex: 2,
                                                                            }}
                                                                            title={hasDescribe ? '已开启：先用AI"详细描述全图"并作为基础上下文 (点击关闭)' : '点击开启：先用AI"详细描述全图"并作为基础上下文'}
                                                                        >
                                                                            {hasDescribe ? '✓先描述全图' : '先描述全图'}
                                                                        </button>
                                                                    );
                                                                })()}
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
                                                                {/* 删除按钮 */}
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); onRemoveImage(imgEntry.id); }}
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
                                                {/* 图片级描述指令编辑区：被选中且开启了"先描述"的图片 */}
                                                {onUpdateRefImageConfig && card && (() => {
                                                    // 找到被选中的图片
                                                    const selIdx = selectedImageId ? allImgs.findIndex(i => i.id === selectedImageId) : -1;
                                                    if (selIdx < 0) return null;
                                                    const configs = card.refImageConfigs || [];
                                                    const descCfg = configs.find(c => c.imageIndex === selIdx && c.dimName === '__describe__');
                                                    if (!descCfg) return null;
                                                    return (
                                                        <div style={{
                                                            marginTop: '8px',
                                                            padding: '8px 10px',
                                                            borderRadius: '8px',
                                                            border: '1px solid rgba(245,158,11,0.3)',
                                                            background: 'rgba(245,158,11,0.05)',
                                                        }}>
                                                            <div style={{ fontSize: '10px', color: '#fbbf24', marginBottom: '4px', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '6px' }}>
                                                                📝 图{selIdx + 1} 的描述指令（留空则继承卡片级设置）
                                                            </div>
                                                            <select
                                                                value={descCfg.extractPrompt ? '__has_value__' : ''}
                                                                onChange={(e) => {
                                                                    e.stopPropagation();
                                                                    const val = e.target.value;
                                                                    if (val === '__clear__') {
                                                                        onUpdateRefImageConfig(card.id, selIdx, { dimName: '__describe__', extractPrompt: '' });
                                                                    } else if (val && val !== '__has_value__') {
                                                                        const preset = DEFAULT_PRESETS.find(p => p.id === val);
                                                                        if (preset) {
                                                                            onUpdateRefImageConfig(card.id, selIdx, { dimName: '__describe__', extractPrompt: preset.text });
                                                                        }
                                                                    }
                                                                }}
                                                                onClick={e => e.stopPropagation()}
                                                                style={{
                                                                    width: '100%',
                                                                    padding: '3px 6px',
                                                                    borderRadius: '6px',
                                                                    fontSize: '10px',
                                                                    cursor: 'pointer',
                                                                    border: '1px solid rgba(63,63,70,0.5)',
                                                                    background: 'rgba(24,24,27,0.8)',
                                                                    color: '#d4d4d8',
                                                                    outline: 'none',
                                                                    marginBottom: '4px',
                                                                }}
                                                            >
                                                                <option value="">(继承上级描述指令)</option>
                                                                <option value="__has_value__" disabled style={{ display: 'none' }}>已自定义</option>
                                                                <option value="1">图片转为AI提示词-1（识别原始图片风格）</option>
                                                                <option value="2">图片转为AI提示词-2（统一转为摄影真实风格）</option>
                                                                <option value="6">图片转为AI提示词-3（精准复刻）</option>
                                                                <option value="__clear__">🗑 清空（用继承）</option>
                                                            </select>
                                                            <textarea
                                                                value={descCfg.extractPrompt || ''}
                                                                onChange={(e) => {
                                                                    onUpdateRefImageConfig(card.id, selIdx, { dimName: '__describe__', extractPrompt: e.target.value });
                                                                }}
                                                                onClick={e => e.stopPropagation()}
                                                                onDoubleClick={e => {
                                                                    e.stopPropagation();
                                                                    setExpandedEdit({
                                                                        title: `图${selIdx + 1} 描述指令编辑`,
                                                                        value: descCfg.extractPrompt || '',
                                                                        onChange: (val) => onUpdateRefImageConfig(card.id, selIdx, { dimName: '__describe__', extractPrompt: val }),
                                                                    });
                                                                }}
                                                                placeholder="留空 = 使用卡片级描述预设指令。如需此图单独设置，在此输入自定义描述指令"
                                                                rows={2}
                                                                style={{
                                                                    width: '100%',
                                                                    padding: '5px 8px',
                                                                    borderRadius: '6px',
                                                                    fontSize: '10px',
                                                                    lineHeight: '1.5',
                                                                    border: '1px solid rgba(63,63,70,0.4)',
                                                                    background: 'rgba(9,9,11,0.8)',
                                                                    color: '#d4d4d8',
                                                                    outline: 'none',
                                                                    resize: 'vertical' as const,
                                                                    minHeight: '32px',
                                                                    maxHeight: '100px',
                                                                }}
                                                                title="双击放大编辑"
                                                            />
                                                        </div>
                                                    );
                                                })()}
                                            </>
                                        );
                                    })()}
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



                {/* 覆盖标签 */}
                {
                    enabledLibs.length > 0 && (
                        <div>
                            <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '8px' }}>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                                    <span style={{ fontSize: '11px', color: '#d4d4d8', fontWeight: 600, display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        维度覆盖 <span style={{ fontSize: '10px', color: '#71717a', fontWeight: 400 }}>(点击库名标签指定覆盖)</span>
                                    </span>
                                    <div style={{ fontSize: '10px', color: '#52525b', lineHeight: '1.5' }}>
                                        <span style={{ color: '#a1a1aa' }}>✏️ 指定固定文本：</span> 直接点击标签即可设置。<br />
                                        <span style={{ color: '#a1a1aa' }}>📷 从图片提取：</span> <strong style={{ color: '#d4d4d8', fontWeight: 500 }}>需先点击上方图片选中</strong>，然后再点击标签，由 AI 从图提取。
                                    </div>
                                    {selectedImageId && (
                                        <div style={{ color: '#3b82f6', fontSize: '10px', fontWeight: 500, marginTop: '2px', background: 'rgba(59,130,246,0.1)', padding: '2px 6px', borderRadius: '4px', width: 'fit-content' }}>
                                            ✨ 已选中图片，请点击想要从图中提取的标签 👇
                                        </div>
                                    )}
                                </div>
                                {Object.keys(imageDimensionMap).length > 0 && (
                                    <button
                                        onClick={() => {
                                            // 清除本地映射
                                            setImageDimensionMap({});
                                            // 清除卡片上的所有维度关联 refImageConfigs（保留 __describe__ 和 __append__）
                                            if (onUpdateRefImageConfig && images.length > 0) {
                                                const card = images[0];
                                                const cfgs = card.refImageConfigs || [];
                                                for (const cfg of cfgs) {
                                                    if (cfg.dimName && cfg.dimName !== '__describe__' && cfg.dimName !== '__append__') {
                                                        onUpdateRefImageConfig(card.id, cfg.imageIndex, { dimName: `__remove__${cfg.dimName}` } as any);
                                                    }
                                                }
                                            }
                                        }}
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
                                    const linkedImage = linkedImageId ? (
                                        images.find(i => i.id === linkedImageId) ||
                                        images[0]?.fusionImages?.find(fi => fi.id === linkedImageId) ||
                                        null
                                    ) : null;
                                    const modeIcon = override?.mode === 'image' ? '📷' : override?.mode === 'queue-image' ? '🔄' : '';
                                    const descriptionText = lib.description?.trim();
                                    return (
                                        <div key={lib.id} style={{ display: 'flex', flexDirection: 'column', gap: '2px', maxWidth: '180px' }}>
                                            <button
                                                onClick={() => {
                                                    if (selectedImageId) {
                                                        if (imageDimensionMap[lib.name] === selectedImageId) {
                                                            // 已关联当前图片 → 打开编辑器设置提取要求
                                                            setInlineEditLib(inlineEditLib === lib.name ? null : lib.name);
                                                        } else {
                                                            // 未关联 → 关联到这个维度，默认从图提取
                                                            setImageDimensionMap(prev => ({ ...prev, [lib.name]: selectedImageId }));
                                                            onOverrideChange(lib.name, { mode: 'image' });
                                                            // 持久化到卡片 refImageConfigs
                                                            if (onUpdateRefImageConfig && images.length > 0) {
                                                                const card = images[0];
                                                                const allImgIds = [card.id, ...(card.fusionImages?.map(fi => fi.id) || [])];
                                                                const imgIdx = allImgIds.indexOf(selectedImageId);
                                                                if (imgIdx >= 0) {
                                                                    onUpdateRefImageConfig(card.id, imgIdx, { dimName: lib.name, extractPrompt: '' });
                                                                }
                                                            }
                                                            setInlineEditLib(lib.name);
                                                        }
                                                    } else {
                                                        // 没有选中图片 → 展开文本编辑器
                                                        setInlineEditLib(isInlineEditing ? null : lib.name);
                                                    }
                                                }}
                                                title={descriptionText ? `${lib.name}：${descriptionText}` : lib.name}
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
                                                        // 从卡片 refImageConfigs 移除
                                                        if (onUpdateRefImageConfig && images.length > 0) {
                                                            const card = images[0];
                                                            const cfgs = card.refImageConfigs || [];
                                                            const cfg = cfgs.find(c => c.dimName === lib.name);
                                                            if (cfg) {
                                                                onUpdateRefImageConfig(card.id, cfg.imageIndex, { dimName: `__remove__${lib.name}` } as any);
                                                            }
                                                        }
                                                    }} />
                                                )}
                                            </button>
                                            {descriptionText && (
                                                <div
                                                    style={{
                                                        fontSize: '9px',
                                                        color: '#71717a',
                                                        lineHeight: '1.35',
                                                        padding: '0 4px',
                                                        overflow: 'hidden',
                                                        textOverflow: 'ellipsis',
                                                        whiteSpace: 'nowrap',
                                                    }}
                                                    title={descriptionText}
                                                >
                                                    {descriptionText}
                                                </div>
                                            )}
                                        </div>
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
                                        {/* 模式切换（有关联图片时显示） */}
                                        {hasLinkedImage && (
                                            <div style={{ display: 'flex', gap: '0', borderRadius: '6px', overflow: 'hidden', border: '1px solid #3f3f46' }}>
                                                <button
                                                    onClick={() => onOverrideChange(inlineEditLib, { mode: 'text' })}
                                                    style={{
                                                        flex: 1,
                                                        padding: '4px 8px',
                                                        border: 'none',
                                                        background: (!override?.mode || override?.mode === 'text') ? '#8b5cf6' : '#18181b',
                                                        color: (!override?.mode || override?.mode === 'text') ? 'white' : '#71717a',
                                                        fontSize: '10px',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        transition: 'all 0.15s',
                                                    }}
                                                >
                                                    ✏️ 固定文本
                                                </button>
                                                <button
                                                    onClick={() => onOverrideChange(inlineEditLib, { mode: 'image' })}
                                                    style={{
                                                        flex: 1,
                                                        padding: '4px 8px',
                                                        border: 'none',
                                                        borderLeft: '1px solid #3f3f46',
                                                        background: override?.mode === 'image' ? '#f59e0b' : '#18181b',
                                                        color: override?.mode === 'image' ? '#000' : '#71717a',
                                                        fontSize: '10px',
                                                        fontWeight: 600,
                                                        cursor: 'pointer',
                                                        transition: 'all 0.15s',
                                                    }}
                                                >
                                                    📷 从图提取
                                                </button>
                                            </div>
                                        )}
                                        {/* 固定文本输入（无关联图 或 模式为text时显示） */}
                                        {(!hasLinkedImage || !override?.mode || override?.mode === 'text') && (
                                            <div>
                                                {!hasLinkedImage && <div style={{ fontSize: '9px', color: '#71717a', marginBottom: '3px' }}>固定值</div>}
                                                <input
                                                    type="text"
                                                    value={override?.value || ''}
                                                    onChange={(e) => onOverrideChange(inlineEditLib, { value: e.target.value })}
                                                    onKeyDown={(e) => { if (e.key === 'Enter') setInlineEditLib(null); }}
                                                    onDoubleClick={() => setExpandedEdit({
                                                        title: `「${inlineEditLib}」固定值`,
                                                        value: override?.value || '',
                                                        onChange: (val) => onOverrideChange(inlineEditLib!, { value: val }),
                                                    })}
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
                                        )}
                                        {/* 提取要求（有关联图 且 模式为image时显示） */}
                                        {hasLinkedImage && override?.mode === 'image' && (
                                            <div>
                                                <div style={{ fontSize: '9px', color: '#71717a', marginBottom: '3px' }}>提取要求（从关联图片中提取什么）</div>
                                                <input
                                                    type="text"
                                                    value={override?.extractPrompt || getDefaultExtractPrompt(inlineEditLib)}
                                                    onChange={(e) => {
                                                        onOverrideChange(inlineEditLib, { extractPrompt: e.target.value });
                                                        // 同步到卡片 refImageConfigs
                                                        if (onUpdateRefImageConfig && images.length > 0) {
                                                            const card = images[0];
                                                            const cfgs = card.refImageConfigs || [];
                                                            const cfg = cfgs.find(c => c.dimName === inlineEditLib);
                                                            if (cfg) {
                                                                onUpdateRefImageConfig(card.id, cfg.imageIndex, { dimName: inlineEditLib, extractPrompt: e.target.value });
                                                            }
                                                        }
                                                    }}
                                                    onDoubleClick={() => setExpandedEdit({
                                                        title: `「${inlineEditLib}」提取要求`,
                                                        value: override?.extractPrompt || getDefaultExtractPrompt(inlineEditLib),
                                                        onChange: (val) => onOverrideChange(inlineEditLib!, { extractPrompt: val }),
                                                    })}
                                                    placeholder={`例如：提取主体风格、描述灯光氛围…`}
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
                                                    onFocus={(e) => (e.target.style.borderColor = '#f59e0b')}
                                                    onBlur={(e) => (e.target.style.borderColor = '#3f3f46')}
                                                />
                                            </div>
                                        )}
                                        {/* 覆盖个数 */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                                            <span style={{ fontSize: '9px', color: '#71717a' }}>覆盖个数</span>
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

                {/* 先用AI"详细描述全图"并作为基础上下文 开关 */}
                {images.length > 0 && (
                    <div style={{ marginTop: '8px', marginBottom: '4px' }}>
                        <div
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '8px',
                                cursor: 'pointer',
                                width: 'fit-content',
                                userSelect: 'none',
                                padding: '8px 12px',
                                borderRadius: '10px',
                                transition: 'all 0.2s',
                                background: needDescribeFirst ? 'rgba(245, 158, 11, 0.15)' : 'rgba(39, 39, 42, 0.6)',
                                border: needDescribeFirst ? '1px solid rgba(245, 158, 11, 0.4)' : '1px solid rgba(63, 63, 70, 0.6)',
                                boxShadow: needDescribeFirst ? '0 1px 2px rgba(0,0,0,0.1)' : 'none',
                            }}
                            onClick={(e) => {
                                e.stopPropagation();
                                onToggleNeedDescribeFirst(!needDescribeFirst);
                            }}
                        >
                            <span style={{ fontSize: '11px', fontWeight: 500, display: 'flex', alignItems: 'center', gap: '6px', color: needDescribeFirst ? '#fbbf24' : '#a1a1aa' }}>
                                <Sparkles size={14} color={needDescribeFirst ? '#fbbf24' : '#71717a'} />
                                先用AI"详细描述全图"并作为基础上下文
                            </span>
                            <span style={{
                                marginLeft: '12px',
                                width: '28px',
                                height: '16px',
                                borderRadius: '999px',
                                position: 'relative',
                                transition: 'background-color 0.2s',
                                backgroundColor: needDescribeFirst ? '#f59e0b' : '#52525b',
                            }}>
                                <span style={{
                                    position: 'absolute',
                                    top: '2px',
                                    width: '12px',
                                    height: '12px',
                                    borderRadius: '50%',
                                    backgroundColor: 'white',
                                    transition: 'all 0.2s',
                                    boxShadow: '0 1px 2px rgba(0,0,0,0.2)',
                                    left: needDescribeFirst ? '14px' : '2px',
                                }} />
                            </span>
                        </div>
                        {/* 描述预设下拉菜单 + 可编辑内容 */}
                        {needDescribeFirst && onSetOriginalDescPresetId && (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                gap: '6px',
                                width: '100%',
                            }}>
                                <select
                                    value={originalDescPresetId}
                                    onChange={(e) => {
                                        const newId = e.target.value;
                                        if (newId === 'custom') {
                                            // 切换到自定义：预填当前预设内容
                                            const preset = DEFAULT_PRESETS.find(p => p.id === originalDescPresetId);
                                            const currentText = originalDescCustomPrompt || preset?.text || DEFAULT_PRESETS[0].text;
                                            onSetOriginalDescPresetId(newId);
                                            onSetOriginalDescCustomPrompt?.(currentText);
                                        } else {
                                            onSetOriginalDescPresetId(newId);
                                        }
                                    }}
                                    style={{
                                        padding: '3px 6px',
                                        borderRadius: '6px',
                                        fontSize: '10px',
                                        cursor: 'pointer',
                                        border: '1px solid rgba(63,63,70,0.5)',
                                        background: 'rgba(24,24,27,0.8)',
                                        color: '#d4d4d8',
                                        maxWidth: '220px',
                                        outline: 'none',
                                    }}
                                >
                                    <option value="1">图片转为AI提示词-1（识别原始图片风格）</option>
                                    <option value="2">图片转为AI提示词-2（统一转为摄影真实风格）</option>
                                    <option value="6">图片转为AI提示词-3（精准复刻）</option>
                                    <option value="custom">✏️ 自定义描述指令</option>
                                </select>
                                <textarea
                                    value={originalDescPresetId === 'custom' ? (originalDescCustomPrompt || '') : (() => {
                                        const preset = DEFAULT_PRESETS.find(p => p.id === originalDescPresetId);
                                        return preset?.text || DEFAULT_PRESETS[0].text;
                                    })()}
                                    onChange={(e) => {
                                        const newText = e.target.value;
                                        // 编辑时自动切换为自定义模式
                                        onSetOriginalDescPresetId('custom');
                                        onSetOriginalDescCustomPrompt?.(newText);
                                    }}
                                    style={{
                                        width: '100%',
                                        padding: '6px 8px',
                                        borderRadius: '6px',
                                        fontSize: '10px',
                                        lineHeight: '1.6',
                                        border: '1px solid rgba(63,63,70,0.4)',
                                        background: 'rgba(9,9,11,0.8)',
                                        color: '#d4d4d8',
                                        outline: 'none',
                                        resize: 'vertical' as const,
                                        minHeight: '36px',
                                        maxHeight: '120px',
                                    }}
                                    rows={2}
                                    onClick={e => e.stopPropagation()}
                                    onDoubleClick={e => {
                                        e.stopPropagation();
                                        const currentVal = originalDescPresetId === 'custom' ? (originalDescCustomPrompt || '') : (() => {
                                            const preset = DEFAULT_PRESETS.find(p => p.id === originalDescPresetId);
                                            return preset?.text || DEFAULT_PRESETS[0].text;
                                        })();
                                        setExpandedEdit({
                                            title: '描述指令编辑',
                                            value: currentVal,
                                            onChange: (val) => {
                                                onSetOriginalDescPresetId('custom');
                                                onSetOriginalDescCustomPrompt?.(val);
                                            },
                                        });
                                    }}
                                    title="双击放大编辑"
                                />
                            </div>
                        )}
                    </div>
                )}

                {/* 用户要求 */}
                <div>
                    <div style={{ fontSize: '11px', color: '#71717a', marginBottom: '4px', fontWeight: 500 }}>
                        📝 单任务追加要求
                    </div>
                    <textarea
                        value={prompt}
                        onChange={(e) => onPromptChange(e.target.value)}
                        onDoubleClick={() => setExpandedEdit({
                            title: '单任务追加要求',
                            value: prompt,
                            onChange: (val) => onPromptChange(val),
                        })}
                        placeholder="单任务追加要求（可选）…双击放大编辑"
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
            </div>

            {/* 可拖拽分割线 */}
            <div
                onMouseDown={handleStartResize}
                onDoubleClick={handleTogglePresetSplit}
                role="separator"
                aria-orientation="vertical"
                title="拖拽调整宽度，双击切换 1/3 与 1/2"
                style={{
                    width: '8px',
                    flexShrink: 0,
                    cursor: 'col-resize',
                    background: '#0f0f12',
                    borderLeft: '1px solid #1f1f23',
                    borderRight: '1px solid #1f1f23',
                    position: 'relative',
                }}
                className="quick-standalone-resizer"
            >
                <div
                    style={{
                        position: 'absolute',
                        left: '50%',
                        top: '50%',
                        transform: 'translate(-50%, -50%)',
                        width: '2px',
                        height: '42px',
                        borderRadius: '999px',
                        background: '#27272a',
                    }}
                />
            </div>

            {/* ===== 右面板 ===== */}
            <div style={{
                flex: 1,
                minWidth: 0,
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                background: '#09090b',
            }}>
                {/* 结果头部 */}
                <div style={{
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
                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
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
                        {onCopyFormulas && (
                            <button
                                onClick={onCopyFormulas}
                                disabled={images.length === 0}
                                style={{
                                    padding: '4px 10px',
                                    borderRadius: '6px',
                                    border: `1px solid ${copySuccess === 'formulas' ? '#10b98140' : '#27272a'}`,
                                    background: copySuccess === 'formulas' ? 'rgba(16,185,129,0.15)' : '#18181b',
                                    color: copySuccess === 'formulas' ? '#34d399' : images.length > 0 ? '#fb923c' : '#3f3f46',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    cursor: images.length > 0 ? 'pointer' : 'not-allowed',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    transition: 'all 0.15s',
                                }}
                                title="复制全部 IMAGE 公式"
                            >
                                {copySuccess === 'formulas' ? <Check size={11} /> : <FileCode size={11} />}
                                原始公式
                            </button>
                        )}
                        {onCopyOriginalAndResults && (
                            <button
                                onClick={onCopyOriginalAndResults}
                                disabled={successCount === 0}
                                style={{
                                    padding: '4px 10px',
                                    borderRadius: '6px',
                                    border: `1px solid ${copySuccess === 'original' ? '#10b98140' : '#27272a'}`,
                                    background: copySuccess === 'original' ? 'rgba(16,185,129,0.15)' : '#18181b',
                                    color: copySuccess === 'original' ? '#34d399' : successCount > 0 ? '#a78bfa' : '#3f3f46',
                                    fontSize: '11px',
                                    fontWeight: 600,
                                    cursor: successCount > 0 ? 'pointer' : 'not-allowed',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                    transition: 'all 0.15s',
                                }}
                                title="复制 公式 + 结果 (Tab分隔)"
                            >
                                {copySuccess === 'original' ? <Check size={11} /> : <LayoutGrid size={11} />}
                                原+结果
                            </button>
                        )}
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
                        {/* 查看AI对话记录按钮 - 有图模式或无图模式都支持 */}
                        {((
                            images.length > 0 && (images[0].aiConversationLog?.length ?? 0) > 0
                        ) || (
                            noImageMode && textCards.some(c => (c.aiConversationLog?.length ?? 0) > 0)
                        )) && (
                            <button
                                onClick={() => setShowConversationLog(true)}
                                style={{
                                    padding: '4px 8px',
                                    borderRadius: '6px',
                                    border: '1px solid rgba(34,211,238,0.2)',
                                    background: 'rgba(34,211,238,0.06)',
                                    color: '#22d3ee',
                                    fontSize: '11px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '3px',
                                }}
                                title="查看AI对话记录"
                            >
                                <Eye size={12} />
                                AI日志
                            </button>
                        )}
                    </div>
                </div>

                {/* 结果列表 */}
                <div style={{
                    flex: 1,
                    overflowY: 'auto',
                    padding: '12px 16px',
                }} className="quick-standalone-scroll">
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
                                    {/* 清空全部按钮 */}
                                    {textCards.length > 0 && onClearTextCards && (
                                        <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '2px' }}>
                                            <button
                                                onClick={onClearTextCards}
                                                style={{
                                                    padding: '3px 10px',
                                                    borderRadius: '6px',
                                                    border: '1px solid rgba(239,68,68,0.2)',
                                                    background: 'rgba(239,68,68,0.06)',
                                                    color: '#f87171',
                                                    fontSize: '10px',
                                                    cursor: 'pointer',
                                                    display: 'flex',
                                                    alignItems: 'center',
                                                    gap: '4px',
                                                }}
                                                title="清空全部卡片"
                                            >
                                                <Trash2 size={10} /> 清空全部
                                            </button>
                                        </div>
                                    )}
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
                                                    <span style={{ fontSize: '11px', color: '#ec4899', fontWeight: 600 }}>#{textCards.indexOf(card) + 1}</span>
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
                                                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '8px', padding: '12px 0' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: '#f87171', fontSize: '13px', fontWeight: 600 }}>
                                                            ⚠️ 生成失败
                                                        </div>
                                                        {card.results.length > 0 && card.results[0] && (
                                                            <div style={{ fontSize: '11px', color: 'rgba(248,113,113,0.6)', textAlign: 'center', maxWidth: '300px' }}>
                                                                {card.results[0]}
                                                            </div>
                                                        )}
                                                    </div>
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
                        ) : creativeResults.length === 0 && isProcessing ? (
                            <div style={{
                                display: 'flex',
                                flexDirection: 'column',
                                alignItems: 'center',
                                justifyContent: 'center',
                                height: '100%',
                                gap: '16px',
                            }}>
                                <Loader2 size={36} style={{ color: '#8b5cf6' }} className="animate-spin" />
                                <div style={{ fontSize: '14px', color: '#a78bfa', fontWeight: 600 }}>正在处理中...</div>
                                <div style={{ fontSize: '12px', color: '#52525b' }}>结果将逐步显示在这里</div>
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
                </div>
            </div>

            {/* 双击放大编辑弹窗 */}
            {/* AI对话记录弹窗 - 有图模式用 images[0]，无图模式从 textCards 合并日志 */}
            {showConversationLog && (() => {
                if (!noImageMode && images.length > 0) {
                    return (
                        <ConversationLogModal
                            item={images[0]}
                            onClose={() => setShowConversationLog(false)}
                        />
                    );
                }
                if (noImageMode) {
                    // 把所有 textCards 的 aiConversationLog 合并成一个假 ImageItem
                    const allLogs: Array<{ timestamp: number; prompt: string; response: string; label?: string }> = [];
                    textCards.forEach(card => {
                        if (card.aiConversationLog) {
                            card.aiConversationLog.forEach(log => {
                                allLogs.push({ ...log, label: log.label || `主题: ${card.topic}` });
                            });
                        }
                    });
                    allLogs.sort((a, b) => a.timestamp - b.timestamp);
                    if (allLogs.length > 0) {
                        const fakeItem = {
                            id: 'noimage-logs',
                            imageUrl: '',
                            result: '',
                            status: 'idle' as const,
                            chatHistory: [],
                            chatInput: '',
                            aiConversationLog: allLogs,
                        };
                        return (
                            <ConversationLogModal
                                item={fakeItem as any}
                                onClose={() => setShowConversationLog(false)}
                            />
                        );
                    }
                }
                return null;
            })()}
            {expandedEdit && (
                <div
                    style={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: 999,
                        background: 'rgba(0,0,0,0.75)',
                        backdropFilter: 'blur(4px)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        padding: '24px',
                    }}
                    onClick={() => setExpandedEdit(null)}
                >
                    <div
                        style={{
                            width: '100%',
                            maxWidth: '640px',
                            background: '#18181b',
                            border: '1px solid #3f3f46',
                            borderRadius: '16px',
                            padding: '20px',
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '12px',
                            boxShadow: '0 20px 60px rgba(0,0,0,0.5)',
                        }}
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <span style={{ fontSize: '14px', fontWeight: 600, color: '#e4e4e7' }}>
                                {expandedEdit.title}
                            </span>
                            <button
                                onClick={() => setExpandedEdit(null)}
                                style={{
                                    padding: '4px',
                                    borderRadius: '6px',
                                    border: 'none',
                                    background: 'transparent',
                                    color: '#71717a',
                                    cursor: 'pointer',
                                }}
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <textarea
                            value={expandedEdit.value}
                            onChange={(e) => {
                                const val = e.target.value;
                                expandedEdit.onChange(val);
                                setExpandedEdit(prev => prev ? { ...prev, value: val } : null);
                            }}
                            autoFocus
                            style={{
                                width: '100%',
                                minHeight: '200px',
                                padding: '12px 14px',
                                borderRadius: '10px',
                                border: '1px solid #3f3f46',
                                background: '#0f0f12',
                                color: '#e4e4e7',
                                fontSize: '14px',
                                lineHeight: '1.6',
                                resize: 'vertical',
                                outline: 'none',
                                boxSizing: 'border-box',
                            }}
                            onFocus={(e) => (e.target.style.borderColor = '#8b5cf6')}
                            onBlur={(e) => (e.target.style.borderColor = '#3f3f46')}
                        />
                        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setExpandedEdit(null)}
                                style={{
                                    padding: '8px 20px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                                    color: 'white',
                                    fontSize: '13px',
                                    fontWeight: 600,
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                }}
                            >
                                确定
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* 悬浮大图预览 */}
            {hoveredPreview && (
                <div style={{
                    position: 'fixed',
                    left: Math.min(hoveredPreview.x, window.innerWidth - 320),
                    top: Math.max(8, Math.min(hoveredPreview.y, window.innerHeight - 320)),
                    zIndex: 9999,
                    pointerEvents: 'none',
                    transition: 'opacity 0.15s',
                }}>
                    <img
                        src={hoveredPreview.url}
                        alt=""
                        style={{
                            width: '280px',
                            maxHeight: '300px',
                            objectFit: 'contain',
                            borderRadius: '12px',
                            border: '2px solid #3f3f46',
                            background: '#09090b',
                            boxShadow: '0 12px 40px rgba(0,0,0,0.6)',
                        }}
                    />
                </div>
            )}
        </div>
    );
};
