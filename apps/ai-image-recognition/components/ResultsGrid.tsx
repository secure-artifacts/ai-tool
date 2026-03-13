import React, { useState, useRef, useEffect, memo } from 'react';
import { ImageItem, Preset, ChatMessage, InnovationItem, CreativeResult, WorkMode, DEFAULT_PRESETS } from '../types';
import { RefImage, getDefaultExtractPrompt } from '../services/randomLibraryService';
import { convertBlobToBase64 } from '../utils';
import { Copy, Loader2, AlertCircle, ExternalLink, FileImage, Trash2, RotateCw, Check, Link, Image as ImageIcon, FileCode, MessageCircle, Send, ChevronDown, ChevronRight, ChevronUp, X, Paperclip, Plus, Minus, Sparkles, ArrowLeftRight, Share2, Settings, Maximize2, Play, Eye } from 'lucide-react';

interface ResultsGridProps {
    images: ImageItem[];
    onRemove: (id: string) => void;
    onRetry: (id: string) => void;
    copyMode: 'resultOnly' | 'originalAndResult' | 'originalOnly' | 'linkOnly';
    viewMode: 'grid' | 'list' | 'compact';
    sentToDescIds?: string[];
    // 对话功能
    onToggleChat?: (id: string) => void;
    onSendMessage?: (id: string) => void;
    onUpdateChatInput?: (id: string, value: string) => void;
    onCopyChatHistory?: (id: string) => void;
    onUpdateChatAttachments?: (id: string, attachments: string[]) => void;
    // 单独提示词
    presets?: Preset[];
    onUpdateCustomPrompt?: (id: string, value: string) => void;
    onApplyPreset?: (id: string, text: string) => void;
    onToggleMergeMode?: (id: string, merge: boolean) => void;
    // 创新功能
    onToggleInnovation?: (id: string) => void;
    onStartInnovation?: (id: string) => void;
    onCopyInnovation?: (id: string) => void;
    onSendToDesc?: (id: string) => void;
    globalInnovationInstruction?: string;
    defaultInnovationInstruction?: string;
    onUpdateCustomInnovationInstruction?: (imageId: string, value: string) => void;
    onUpdateCustomInnovationCount?: (imageId: string, count: number) => void;
    onUpdateCustomInnovationRounds?: (imageId: string, rounds: number) => void;
    onUpdateCustomInnovationTemplateId?: (imageId: string, templateId: string) => void;
    templateState?: { savedTemplates: Array<{ id: string; name: string; sections: any[]; values: Record<string, string> }> };
    unifiedPresets?: SimplePreset[];
    onToggleInnovationChat?: (imageId: string, innovationId: string) => void;
    onSendInnovationMessage?: (imageId: string, innovationId: string) => void;
    onUpdateInnovationInput?: (imageId: string, innovationId: string, value: string) => void;
    onCopyInnovationChatHistory?: (imageId: string, innovationId: string) => void;
    onUpdateInnovationAttachments?: (imageId: string, innovationId: string, attachments: string[]) => void;
    // 翻译功能
    onTranslate?: (text: string) => Promise<string>;
    onSaveTranslation?: (itemId: string, translatedText: string) => void;
    onSaveSelection?: (itemId: string, selectedText: string, translatedSelection: string) => void;
    // 创新模式
    workMode?: WorkMode;
    creativeResults?: CreativeResult[];
    // 融合图片功能（用于卡片内多图融合）
    onAddFusionImage?: (imageId: string, file: File) => void;
    onRemoveFusionImage?: (imageId: string, fusionImageId: string) => void;
    // 选中卡片功能（用于粘贴添加融合图片）
    selectedCardId?: string | null;
    onSelectCard?: (imageId: string | null) => void;
    // 指令预览功能
    globalUserPrompt?: string; // 全局用户特殊要求
    baseInstruction?: string; // 基础指令
    // 拆分元素模式
    splitElements?: string[];
    // 卡片级参考图选择
    overrideDimsWithImages?: Array<{ dimName: string; imageLibrary: RefImage[] }>;
    onUpdateCardRefSelection?: (cardId: string, dimName: string, refImageId: string | null) => void;
    // 卡片级覆盖个数
    overrideDimNames?: string[]; // 所有开启了覆盖的维度名
    globalOverrideCounts?: Record<string, number>; // 全局覆盖个数
    globalOverrideModes?: Record<string, string>; // 全局覆盖模式 (text/image/queue-image)
    onUpdateCardOverrideCount?: (cardId: string, dimName: string, count: number | null) => void;
    // 卡片级文字覆盖
    onUpdateCardTextOverride?: (cardId: string, dimName: string, value: string | null) => void;
    // 卡片级维度提取
    allEnabledDimNames?: string[]; // 随机库中所有开启的维度名
    onUpdateRefImageConfig?: (cardId: string, imageIndex: number, update: Partial<import('../types').RefImageConfig> | null) => void;
    // 卡片级维度绑定（从卡片自身图片提取）
    onToggleCardDimBinding?: (cardId: string, dimName: string) => void;
    // 卡片级"先用AI详细描述全图"开关
    onToggleDescribeFirst?: (cardId: string, value: boolean) => void;
    // 卡片级描述预设ID
    onSetDescribePresetId?: (cardId: string, presetId: string) => void;
    // 卡片级自定义描述指令
    onSetDescribeCustomPrompt?: (cardId: string, customPrompt: string) => void;
}


// 统一的简单预设类型（用于跨应用共享）
type SimplePreset = {
    id: string;
    name: string;
    text: string;
    source: 'recognition' | 'template' | 'system';
};

const getInnovationItemsForRender = (item: ImageItem): InnovationItem[] => {
    if (item.innovationItems && item.innovationItems.length > 0) return item.innovationItems;
    if (item.innovationOutputs && item.innovationOutputs.length > 0) {
        return item.innovationOutputs.map((text, idx) => ({
            id: `fallback-${item.id}-${idx}`,
            text,
            chatHistory: [],
            isChatOpen: false,
            chatInput: '',
            chatAttachments: [],
            isChatLoading: false
        }));
    }
    return [];
};

const getInnovationOutputs = (item: ImageItem) => getInnovationItemsForRender(item).map(it => it.text);



const StatusDisplay = ({ item, onRetry, onExpand }: { item: ImageItem; onRetry: (id: string) => void; onExpand?: (item: ImageItem) => void }) => {
    if (item.status === 'idle') return (
        <div className="flex items-center gap-2">
            <span className="text-zinc-600 text-xs italic">等待处理...</span>
            <button
                onClick={() => onRetry(item.id)}
                className="flex items-center gap-1 bg-emerald-600/20 hover:bg-emerald-600/40 text-emerald-300 px-2 py-1 rounded text-[0.625rem] transition-colors tooltip-bottom"
                data-tip="单独开始处理这张图片"
            >
                <Play size={10} />
                开始
            </button>
        </div>
    );
    if (item.status === 'loading') return (
        <div className="flex items-center gap-2 text-emerald-400 text-xs">
            <Loader2 size={14} className="animate-spin" />
            正在分析...
        </div>
    );
    if (item.status === 'error') return (
        <div className="text-red-400 text-xs">
            <div className="flex items-center gap-1 font-bold mb-1"><AlertCircle size={12} /> 错误</div>
            {item.errorMsg || "分析失败。"}
            {item.sourceType !== 'file' && item.errorMsg?.includes('Fetch') && (
                <p className="mt-1 text-[0.625rem] opacity-70">
                    提示: 可能是防盗链或跨域限制。请尝试直接复制图片粘贴。
                </p>
            )}
            <button
                onClick={() => onRetry(item.id)}
                className="mt-2 flex items-center gap-1 bg-red-900/30 hover:bg-red-900/50 text-red-200 px-2 py-1 rounded transition-colors text-[0.625rem]"
            >
                <RotateCw size={10} /> 点击重试
            </button>
        </div>
    );

    // 单击显示提示 - 跟随鼠标位置
    const [clickHint, setClickHint] = useState<{ show: boolean; x: number; y: number }>({ show: false, x: 0, y: 0 });

    const handleSingleClick = (e: React.MouseEvent) => {
        setClickHint({ show: true, x: e.clientX, y: e.clientY });
        setTimeout(() => setClickHint({ show: false, x: 0, y: 0 }), 1500);
    };

    return (
        <div
            className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed cursor-pointer hover:bg-zinc-800/30 rounded-md transition-colors group/result relative tooltip-bottom"
            onClick={handleSingleClick}
            onDoubleClick={() => onExpand?.(item)}
            data-tip="双击放大窗口查看结果"
        >
            {item.result}
            {/* 单击提示气泡 - 显示在鼠标位置 */}
            {clickHint.show && (
                <div
                    className="fixed bg-emerald-600 text-white text-[0.5625rem] px-2 py-1 rounded shadow-lg whitespace-nowrap z-[9999] pointer-events-none"
                    style={{ left: clickHint.x + 10, top: clickHint.y - 30 }}
                >
                    👆 双击放大窗口查看结果
                </div>
            )}
            {/* 悬浮时显示底部提示条 */}
            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-900/90 to-transparent text-[0.625rem] text-zinc-400 text-center py-1 opacity-0 group-hover/result:opacity-100 transition-opacity pointer-events-none">
                双击放大
            </div>
            {/* 放大提示图标 */}
            <button
                onClick={(e) => { e.stopPropagation(); onExpand?.(item); }}
                className="absolute top-0 right-0 p-1 text-zinc-600 hover:text-zinc-300 opacity-0 group-hover/result:opacity-100 transition-opacity tooltip-bottom"
                data-tip="点击放大查看"
            >
                <Maximize2 size={12} />
            </button>
        </div>
    );
};

// 使用 React.memo 优化：只有 props 变化时才重新渲染
const MemoizedStatusDisplay = memo(StatusDisplay);

// === 拆分元素结果显示组件 ===
const SplitResultDisplay = ({ item, splitElements = [] }: { item: ImageItem; splitElements: string[] }) => {
    if (item.status === 'idle') return <div className="text-xs text-zinc-600 italic">等待分析...</div>;
    if (item.status === 'loading') return (
        <div className="flex items-center gap-2 text-emerald-400 text-xs">
            <Loader2 size={14} className="animate-spin" />
            正在分析...
        </div>
    );
    if (item.status === 'error') return (
        <div className="text-red-400 text-xs">
            <div className="flex items-center gap-1 font-bold mb-1"><AlertCircle size={12} /> 错误</div>
            {item.errorMsg || "分析失败。"}
        </div>
    );
    if (!item.result) return <div className="text-xs text-zinc-600 italic">暂无结果</div>;

    // 解析结果：支持 "元素名|||中文|||英文" 或 "元素名|||描述"
    const lines = item.result.split('\n').filter(l => l.trim());
    const pipeLines = lines.filter(l => l.includes('|||'));
    const parsed: Record<string, { zh: string; en: string }> = {};
    let hasBilingual = false;

    // 第一遍：按名称精确/模糊匹配
    const unmatchedLineIndices: number[] = [];
    const matchedElements = new Set<string>();

    for (let lineIdx = 0; lineIdx < pipeLines.length; lineIdx++) {
        const parts = pipeLines[lineIdx].split('|||');
        if (parts.length < 2) continue;
        const rawKey = parts[0].trim().replace(/^\d+\.\s*/, '').replace(/^\*+/, '').replace(/\*+$/, '').trim();
        if (!rawKey) continue;

        // 精确匹配
        let key = splitElements.find(e => e === rawKey);
        // 模糊匹配
        if (!key) {
            key = splitElements.find(e => !matchedElements.has(e) && (rawKey.includes(e) || e.includes(rawKey)));
        }

        if (key) {
            matchedElements.add(key);
            if (parts.length >= 3) {
                parsed[key] = { zh: parts[1].trim(), en: parts[2].trim() };
                hasBilingual = true;
            } else {
                const desc = parts[1].trim();
                const isChinese = /[\u4e00-\u9fff]/.test(desc);
                parsed[key] = { zh: isChinese ? desc : '', en: isChinese ? '' : desc };
            }
        } else {
            unmatchedLineIndices.push(lineIdx);
        }
    }

    // 第二遍：位置回退 — 未匹配的行按顺序对应未匹配的 splitElements
    if (unmatchedLineIndices.length > 0) {
        const unmatchedElements = splitElements.filter(e => !matchedElements.has(e));
        for (let i = 0; i < Math.min(unmatchedLineIndices.length, unmatchedElements.length); i++) {
            const parts = pipeLines[unmatchedLineIndices[i]].split('|||');
            const element = unmatchedElements[i];
            if (parts.length >= 3) {
                parsed[element] = { zh: parts[1].trim(), en: parts[2].trim() };
                hasBilingual = true;
            } else if (parts.length === 2) {
                const desc = parts[1].trim();
                const isChinese = /[\u4e00-\u9fff]/.test(desc);
                parsed[element] = { zh: isChinese ? desc : '', en: isChinese ? '' : desc };
            }
        }
    }

    // 按 splitElements 顺序显示
    const orderedKeys = [...splitElements];
    for (const key of Object.keys(parsed)) {
        if (!orderedKeys.includes(key)) orderedKeys.push(key);
    }
    const activeKeys = orderedKeys.filter(k => parsed[k]);

    if (activeKeys.length === 0) {
        return <div className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">{item.result}</div>;
    }

    return (
        <div className="w-full overflow-x-auto">
            <table className="w-full border-collapse text-xs">
                <thead>
                    <tr>
                        {hasBilingual && (
                            <th className="px-2 py-1.5 text-left text-zinc-500 font-medium border-b border-zinc-700/50 bg-zinc-800/40 whitespace-nowrap w-8"></th>
                        )}
                        {activeKeys.map(key => (
                            <th key={key} className="px-2 py-1.5 text-left text-cyan-400 font-medium border-b border-zinc-700/50 bg-zinc-800/40 whitespace-nowrap">
                                {key}
                            </th>
                        ))}
                    </tr>
                </thead>
                <tbody>
                    {hasBilingual ? (
                        <>
                            <tr>
                                <td className="px-2 py-1.5 text-orange-400 font-medium border-b border-zinc-800/30 whitespace-nowrap align-top">中</td>
                                {activeKeys.map(key => (
                                    <td key={key} className="px-2 py-2 text-zinc-300 border-b border-zinc-800/30 align-top leading-relaxed" style={{ minWidth: '120px' }}>
                                        {parsed[key]?.zh || ''}
                                    </td>
                                ))}
                            </tr>
                            <tr>
                                <td className="px-2 py-1.5 text-blue-400 font-medium border-b border-zinc-800/30 whitespace-nowrap align-top">EN</td>
                                {activeKeys.map(key => (
                                    <td key={key} className="px-2 py-2 text-zinc-400 border-b border-zinc-800/30 align-top leading-relaxed" style={{ minWidth: '120px' }}>
                                        {parsed[key]?.en || ''}
                                    </td>
                                ))}
                            </tr>
                        </>
                    ) : (
                        <tr>
                            {activeKeys.map(key => (
                                <td key={key} className="px-2 py-2 text-zinc-300 border-b border-zinc-800/30 align-top leading-relaxed" style={{ minWidth: '120px' }}>
                                    {parsed[key]?.zh || parsed[key]?.en || ''}
                                </td>
                            ))}
                        </tr>
                    )}
                </tbody>
            </table>
        </div>
    );
};
const MemoizedSplitResultDisplay = memo(SplitResultDisplay);

// 创新结果显示组件 - 用于创新模式下替换右侧的识别结果
interface CreativeResultDisplayProps {
    result: CreativeResult | undefined;
    onCopyItem?: (text: string) => void;
}

const CreativeResultDisplay = ({ result, onCopyItem }: CreativeResultDisplayProps) => {
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1500);
        onCopyItem?.(text);
    };

    if (!result) {
        return (
            <div className="flex items-center justify-center h-full text-zinc-500 text-xs italic">
                <Sparkles size={14} className="mr-1.5 text-purple-400/50" />
                点击"开始创新"生成创意变体
            </div>
        );
    }

    if (result.status === 'processing') {
        return (
            <div className="flex items-center justify-center h-full text-purple-400 text-xs">
                <Loader2 size={14} className="animate-spin mr-2" />
                正在生成创新...
            </div>
        );
    }

    if (result.status === 'error') {
        return (
            <div className="text-red-400 text-xs p-2">
                <div className="flex items-center gap-1 font-bold mb-1">
                    <AlertCircle size={12} />
                    创新失败
                </div>
                {result.error || "请重试"}
            </div>
        );
    }

    if (result.status === 'success' && result.innovations.length > 0) {
        return (
            <div className="space-y-2 h-full overflow-y-auto custom-scrollbar pr-1">
                {/* 原始识别结果 */}
                {(result.originalDesc || result.originalDescZh) && (
                    <div className="bg-emerald-900/20 border border-emerald-700/30 rounded-lg p-2 mb-2">
                        <div className="flex items-center gap-1 text-[10px] text-emerald-400 font-medium mb-1">
                            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
                            原始识别结果
                        </div>
                        <div className="text-xs text-zinc-300 leading-relaxed">
                            {result.originalDescZh || result.originalDesc}
                        </div>
                        <button
                            onClick={() => handleCopy(result.originalDesc || '', 'original')}
                            className="mt-1.5 text-[10px] text-emerald-400 hover:text-emerald-300 flex items-center gap-1 transition-colors"
                        >
                            {copiedId === 'original' ? <Check size={10} /> : <Copy size={10} />}
                            {copiedId === 'original' ? '已复制' : '复制原始结果'}
                        </button>
                    </div>
                )}
                {/* 创新变体列表 */}
                <div className="text-[10px] text-cyan-400 font-medium flex items-center gap-1 mb-1">
                    <Sparkles size={10} />
                    创新变体 ({result.innovations.length})
                </div>
                {result.innovations.map((inno, idx) => (
                    <div
                        key={inno.id}
                        className="group relative bg-zinc-800/40 hover:bg-zinc-800/70 rounded-lg p-2 transition-colors border border-zinc-700/30 hover:border-purple-600/40"
                    >
                        <div className="text-xs text-zinc-200 leading-relaxed mb-1">
                            {inno.textEn}
                        </div>
                        {inno.textZh && (
                            <div className="text-[10px] text-zinc-500">
                                {inno.textZh}
                            </div>
                        )}
                        <button
                            onClick={() => handleCopy(inno.textEn, inno.id)}
                            className="absolute top-1.5 right-1.5 opacity-0 group-hover:opacity-100 p-1 rounded bg-zinc-700 hover:bg-purple-600 text-zinc-400 hover:text-white transition-all"
                        >
                            {copiedId === inno.id ? <Check size={10} /> : <Copy size={10} />}
                        </button>
                    </div>
                ))}
            </div>
        );
    }

    return (
        <div className="flex items-center justify-center h-full text-zinc-500 text-xs italic">
            暂无创新结果
        </div>
    );
};

// 图片放大预览模态框
interface ImagePreviewModalProps {
    imageUrl: string | null;
    title?: string;
    onClose: () => void;
}

const ImagePreviewModal = ({ imageUrl, title, onClose }: ImagePreviewModalProps) => {
    const [zoom, setZoom] = useState(1);

    useEffect(() => {
        setZoom(1);
    }, [imageUrl]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        if (imageUrl) {
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [imageUrl, onClose]);

    if (!imageUrl) return null;

    const zoomOut = () => setZoom(prev => Math.max(0.5, Number((prev - 0.25).toFixed(2))));
    const zoomIn = () => setZoom(prev => Math.min(4, Number((prev + 0.25).toFixed(2))));
    const resetZoom = () => setZoom(1);

    return (
        <div
            className="fixed inset-0 bg-black/80 backdrop-blur-sm flex items-center justify-center z-[120] p-3 md:p-6"
            onClick={onClose}
        >
            <div
                className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full h-full max-w-[96vw] max-h-[94vh] overflow-hidden flex flex-col"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="flex items-center justify-between px-3 py-2 border-b border-zinc-800 bg-zinc-900/95">
                    <div className="text-xs text-zinc-400 truncate pr-3">{title || '图片预览'}</div>
                    <div className="flex items-center gap-1.5 shrink-0">
                        <button
                            onClick={zoomOut}
                            className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                            data-tip="缩小"
                        >
                            <Minus size={14} />
                        </button>
                        <button
                            onClick={resetZoom}
                            className="px-2 py-1 rounded bg-zinc-800 hover:bg-zinc-700 text-[0.625rem] text-zinc-200"
                            data-tip="重置缩放"
                        >
                            {Math.round(zoom * 100)}%
                        </button>
                        <button
                            onClick={zoomIn}
                            className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                            data-tip="放大"
                        >
                            <Plus size={14} />
                        </button>
                        <button
                            onClick={onClose}
                            className="p-1.5 rounded bg-zinc-800 hover:bg-zinc-700 text-zinc-300"
                            data-tip="关闭"
                        >
                            <X size={14} />
                        </button>
                    </div>
                </div>

                <div className="flex-1 overflow-auto bg-zinc-950">
                    <div className="min-w-full min-h-full flex items-center justify-center p-4">
                        <img
                            src={imageUrl}
                            alt="Preview"
                            className="select-none pointer-events-none"
                            style={{
                                width: `${Math.round(zoom * 100)}%`,
                                maxWidth: 'none',
                                height: 'auto'
                            }}
                        />
                    </div>
                </div>
            </div>
        </div>
    );
};

// 结果放大模态框组件
interface ResultExpandModalProps {
    item: ImageItem | null;
    onClose: () => void;
    onTranslate?: (text: string) => Promise<string>;
    onSaveTranslation?: (itemId: string, translatedText: string) => void; // 翻译后保存回调
    onSaveSelection?: (itemId: string, selectedText: string, translatedSelection: string) => void; // 选中翻译保存回调
    workMode?: WorkMode;
    creativeResult?: CreativeResult;
}

const ResultExpandModal = ({ item, onClose, onTranslate, onSaveTranslation, onSaveSelection, workMode = 'standard', creativeResult }: ResultExpandModalProps) => {
    const [copied, setCopied] = useState(false);
    // 使用缓存的翻译结果初始化
    const [translatedText, setTranslatedText] = useState<string | null>(null);
    const [isTranslating, setIsTranslating] = useState(false);
    const [showTranslation, setShowTranslation] = useState(false);
    const [selectedText, setSelectedText] = useState('');
    const [translatedSelection, setTranslatedSelection] = useState<string | null>(null);
    const [isTranslatingSelection, setIsTranslatingSelection] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null); // 主内容区域的引用

    // ESC 键关闭
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        if (item) {
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [item, onClose]);

    // 监听选中文本 - 只从主内容区域检测
    useEffect(() => {
        const handleSelection = () => {
            const selection = window.getSelection();
            if (selection && selection.toString().trim() && contentRef.current) {
                // 检查选区是否在主内容区域内
                const range = selection.rangeCount > 0 ? selection.getRangeAt(0) : null;
                if (range && contentRef.current.contains(range.commonAncestorContainer)) {
                    setSelectedText(selection.toString().trim());
                    setTranslatedSelection(null);
                }
            }
        };
        document.addEventListener('mouseup', handleSelection);
        return () => document.removeEventListener('mouseup', handleSelection);
    }, []);

    // 重置翻译状态当 item 改变 - 但保留缓存的翻译
    useEffect(() => {
        // 如果 item 有缓存的翻译，使用它
        if (item?.translatedResult) {
            setTranslatedText(item.translatedResult);
            setShowTranslation(true);
        } else {
            setTranslatedText(null);
            setShowTranslation(false);
        }
        // 恢复选中翻译缓存
        if (item?.lastSelectedText && item?.lastTranslatedSelection) {
            setSelectedText(item.lastSelectedText);
            setTranslatedSelection(item.lastTranslatedSelection);
        } else {
            setSelectedText('');
            setTranslatedSelection(null);
        }
    }, [item?.id, item?.translatedResult, item?.lastSelectedText, item?.lastTranslatedSelection]);

    if (!item) return null;

    const handleCopy = (textToCopy?: string) => {
        let text = textToCopy;
        if (!text) {
            // 创新模式下，优先复制所有创新结果
            if ((workMode === 'creative' || workMode === 'quick') && creativeResult?.innovations?.length) {
                text = creativeResult.innovations.map(inno => inno.textEn).join('\n');
            } else {
                text = showTranslation && translatedText ? translatedText : item.result;
            }
        }
        if (text) {
            navigator.clipboard.writeText(text);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    // 翻译全文
    const handleTranslateAll = async () => {
        if (!onTranslate || isTranslating || !item.result) return;
        setIsTranslating(true);
        try {
            const result = await onTranslate(item.result);
            setTranslatedText(result);
            setShowTranslation(true);
            // 保存翻译结果到缓存
            if (onSaveTranslation) {
                onSaveTranslation(item.id, result);
            }
        } catch (err) {
            console.error('Translation failed:', err);
        } finally {
            setIsTranslating(false);
        }
    };

    // 翻译选中部分
    const handleTranslateSelection = async () => {
        if (!onTranslate || !selectedText || isTranslatingSelection) return;
        setIsTranslatingSelection(true);
        try {
            const result = await onTranslate(selectedText);
            setTranslatedSelection(result);
            // 保存选中翻译到缓存
            if (onSaveSelection && item) {
                onSaveSelection(item.id, selectedText, result);
            }
        } catch (err) {
            console.error('Translation failed:', err);
        } finally {
            setIsTranslatingSelection(false);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4 md:p-8"
            onClick={onClose}
        >
            <div
                className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col max-w-[90vw] max-h-[85vh] w-full md:max-w-4xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* 头部 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/95 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        {item.imageUrl && (
                            <img
                                src={item.imageUrl}
                                alt="Preview"
                                className="w-10 h-10 object-cover rounded-lg border border-zinc-700"
                            />
                        )}
                        <div>
                            <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                                识别结果
                                {showTranslation && translatedText && (
                                    <span className="text-xs font-normal text-emerald-400">(已翻译)</span>
                                )}
                            </h3>
                            <p className="text-[0.625rem] text-zinc-500 truncate max-w-xs tooltip-bottom" data-tip={item.originalInput}>
                                {item.originalInput}
                            </p>
                        </div>
                    </div>
                    <div className="flex items-center gap-2">
                        {/* 翻译按钮 - 合并翻译和切换功能 */}
                        {onTranslate && item.result && (
                            translatedText ? (
                                // 已翻译：显示切换按钮
                                <button
                                    onClick={() => setShowTranslation(!showTranslation)}
                                    className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all border border-zinc-700 tooltip-bottom"
                                    data-tip="切换原文/译文"
                                >
                                    <ArrowLeftRight size={12} />
                                    <span className={showTranslation ? 'text-zinc-500' : 'text-emerald-400'}>原</span>
                                    <span className="text-zinc-600">/</span>
                                    <span className={showTranslation ? 'text-emerald-400' : 'text-zinc-500'}>译</span>
                                </button>
                            ) : (
                                // 未翻译：显示翻译按钮
                                <button
                                    onClick={handleTranslateAll}
                                    disabled={isTranslating}
                                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-medium bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30 transition-all tooltip-bottom"
                                    data-tip="翻译全文（智能识别中英文）"
                                >
                                    {isTranslating ? (
                                        <Loader2 size={12} className="animate-spin" />
                                    ) : (
                                        <ArrowLeftRight size={12} />
                                    )}
                                    {isTranslating ? '翻译中' : '翻译'}
                                </button>
                            )
                        )}
                        <button
                            onClick={() => handleCopy()}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all tooltip-bottom ${copied
                                ? 'bg-emerald-600 text-white'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white'
                                }`}
                            data-tip="复制结果"
                        >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? '已复制' : '复制'}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors tooltip-bottom"
                            data-tip="关闭 (ESC)"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* 内容 - 可滚动 */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar" ref={contentRef}>
                    {item.imageUrl && (
                        <div className="mb-4 p-2 bg-zinc-950/40 border border-zinc-800 rounded-lg flex items-center justify-center">
                            <img
                                src={item.imageUrl}
                                alt="Large Preview"
                                className="max-w-full max-h-[42vh] w-auto h-auto object-contain rounded"
                            />
                        </div>
                    )}

                    {/* 创新模式下显示创新结果 */}
                    {(workMode === 'creative' || workMode === 'quick') && creativeResult && creativeResult.status === 'success' && creativeResult.innovations.length > 0 ? (
                        <div className="space-y-4">
                            {/* 原始识别结果 */}
                            <div className="border-b border-zinc-700 pb-4">
                                <h4 className="text-xs font-medium text-zinc-400 mb-2 flex items-center gap-1">
                                    <span className="w-2 h-2 rounded-full bg-emerald-500"></span>
                                    原始识别结果
                                </h4>
                                <div className="text-sm text-zinc-300 whitespace-pre-wrap leading-relaxed bg-zinc-800/30 p-3 rounded-lg">
                                    {showTranslation && translatedText
                                        ? translatedText
                                        : (creativeResult.originalDesc || item.result || <span className="text-zinc-500 italic">暂无结果</span>)}
                                </div>
                            </div>
                            {/* 创新结果列表 */}
                            <div>
                                <h4 className="text-xs font-medium text-cyan-400 mb-3 flex items-center gap-1">
                                    <Sparkles size={12} />
                                    创新变体 ({creativeResult.innovations.length})
                                </h4>
                                <div className="space-y-3">
                                    {creativeResult.innovations.map((inno, idx) => (
                                        <div
                                            key={inno.id}
                                            className="group relative bg-zinc-800/50 hover:bg-zinc-800/70 rounded-lg p-3 transition-colors border border-zinc-700/50 hover:border-cyan-600/40"
                                        >
                                            <div className="flex items-start gap-2">
                                                <span className="flex-shrink-0 w-5 h-5 rounded-full bg-cyan-600/30 text-cyan-300 text-[0.625rem] flex items-center justify-center font-medium">
                                                    {idx + 1}
                                                </span>
                                                <div className="flex-1">
                                                    {/* 英文版本 */}
                                                    <p className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed select-text">
                                                        {inno.textEn}
                                                    </p>
                                                    {/* 中文翻译 */}
                                                    {inno.textZh && (
                                                        <p className="text-xs text-zinc-500 mt-1.5 whitespace-pre-wrap leading-relaxed select-text">
                                                            {inno.textZh}
                                                        </p>
                                                    )}
                                                </div>
                                            </div>
                                            {/* 复制按钮 */}
                                            <button
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    navigator.clipboard.writeText(inno.textEn);
                                                }}
                                                className="absolute top-2 right-2 p-1.5 text-zinc-500 hover:text-cyan-400 hover:bg-zinc-700 rounded opacity-0 group-hover:opacity-100 transition-all"
                                            >
                                                <Copy size={12} />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* 普通模式显示原始结果 */
                        <div className="text-sm md:text-base text-zinc-200 whitespace-pre-wrap leading-relaxed select-text">
                            {showTranslation && translatedText
                                ? translatedText
                                : (item.result || <span className="text-zinc-500 italic">暂无结果</span>)}
                        </div>
                    )}
                </div>

                {/* 选中文本翻译区 */}
                {onTranslate && selectedText && (
                    <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-950/50 flex-shrink-0">
                        <div className="flex items-center justify-between gap-3 mb-2">
                            <p className="text-[0.625rem] text-zinc-500">从内容中选中的文本</p>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={() => { setSelectedText(''); setTranslatedSelection(null); }}
                                    className="text-[0.625rem] text-zinc-600 hover:text-zinc-400"
                                >
                                    清除
                                </button>
                                {translatedSelection && (
                                    <button
                                        onClick={() => handleCopy(translatedSelection)}
                                        className="flex items-center gap-1 px-2 py-1 rounded text-[0.625rem] font-medium bg-emerald-600/20 hover:bg-emerald-600/30 text-emerald-300 border border-emerald-500/30 transition-all"
                                    >
                                        <Copy size={10} />
                                        复制译文
                                    </button>
                                )}
                                <button
                                    onClick={handleTranslateSelection}
                                    disabled={isTranslatingSelection}
                                    className="flex items-center gap-1 px-2 py-1 rounded text-[0.625rem] font-medium bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 transition-all"
                                >
                                    {isTranslatingSelection ? <Loader2 size={10} className="animate-spin" /> : <ArrowLeftRight size={10} />}
                                    翻译
                                </button>
                            </div>
                        </div>
                        {/* 原文和译文对比显示 */}
                        <div className="grid grid-cols-2 gap-2">
                            <div className="p-2 bg-zinc-800/30 rounded border border-zinc-700/50">
                                <p className="text-[0.5rem] text-zinc-600 mb-1">原文</p>
                                <p className="text-xs text-zinc-400 whitespace-pre-wrap max-h-20 overflow-y-auto">{selectedText}</p>
                            </div>
                            <div className="p-2 bg-zinc-800/30 rounded border border-zinc-700/50">
                                <p className="text-[0.5rem] text-emerald-500 mb-1">译文</p>
                                {translatedSelection ? (
                                    <p className="text-xs text-zinc-200 whitespace-pre-wrap max-h-20 overflow-y-auto">{translatedSelection}</p>
                                ) : (
                                    <p className="text-xs text-zinc-600 italic">点击翻译按钮</p>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* 底部提示 */}
                <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/95 flex-shrink-0">
                    <p className="text-[0.625rem] text-zinc-600 text-center">
                        按 ESC 键关闭 · 可选中文字复制{onTranslate ? ' · 选中文字可单独翻译' : ''}
                    </p>
                </div>
            </div>
        </div >
    );
};

// 通用文本放大模态框组件（用于对话消息等）
interface TextExpandModalProps {
    text: string | null;
    title?: string;
    subtitle?: string;
    onClose: () => void;
    onTranslate?: (text: string) => Promise<string>; // 翻译回调
}

const TextExpandModal = ({ text, title = '查看内容', subtitle, onClose, onTranslate }: TextExpandModalProps) => {
    const [copied, setCopied] = useState(false);
    const [translatedText, setTranslatedText] = useState<string | null>(null);
    const [isTranslating, setIsTranslating] = useState(false);
    const [showTranslation, setShowTranslation] = useState(false);
    const [selectedText, setSelectedText] = useState('');
    const [translatedSelection, setTranslatedSelection] = useState<string | null>(null);
    const [isTranslatingSelection, setIsTranslatingSelection] = useState(false);
    const contentRef = useRef<HTMLDivElement>(null);

    // ESC 键关闭
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        if (text) {
            document.addEventListener('keydown', handleKeyDown);
            return () => document.removeEventListener('keydown', handleKeyDown);
        }
    }, [text, onClose]);

    // 监听选中文本
    useEffect(() => {
        const handleSelection = () => {
            const selection = window.getSelection();
            if (selection && selection.toString().trim()) {
                setSelectedText(selection.toString().trim());
                setTranslatedSelection(null); // 清除之前的翻译
            }
        };
        document.addEventListener('mouseup', handleSelection);
        return () => document.removeEventListener('mouseup', handleSelection);
    }, []);

    if (!text) return null;

    const handleCopy = (textToCopy: string = text) => {
        navigator.clipboard.writeText(textToCopy);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // 翻译全文
    const handleTranslateAll = async () => {
        if (!onTranslate || isTranslating) return;
        setIsTranslating(true);
        try {
            const result = await onTranslate(text);
            setTranslatedText(result);
            setShowTranslation(true);
        } catch (err) {
            console.error('Translation failed:', err);
        } finally {
            setIsTranslating(false);
        }
    };

    // 翻译选中部分
    const handleTranslateSelection = async () => {
        if (!onTranslate || !selectedText || isTranslatingSelection) return;
        setIsTranslatingSelection(true);
        try {
            const result = await onTranslate(selectedText);
            setTranslatedSelection(result);
        } catch (err) {
            console.error('Translation failed:', err);
        } finally {
            setIsTranslatingSelection(false);
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4 md:p-8"
            onClick={onClose}
        >
            <div
                className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col max-w-[90vw] max-h-[85vh] w-full md:max-w-4xl overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* 头部 */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/95 flex-shrink-0">
                    <div>
                        <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
                            {title}
                            {showTranslation && translatedText && (
                                <span className="text-xs font-normal text-emerald-400">(已翻译)</span>
                            )}
                        </h3>
                        {subtitle && (
                            <p className="text-[0.625rem] text-zinc-500 truncate max-w-xs">{subtitle}</p>
                        )}
                    </div>
                    <div className="flex items-center gap-2">
                        {/* 翻译全文按钮 */}
                        {onTranslate && (
                            <button
                                onClick={handleTranslateAll}
                                disabled={isTranslating}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all tooltip-bottom ${showTranslation && translatedText
                                    ? 'bg-emerald-600/20 text-emerald-300 border border-emerald-500/30'
                                    : 'bg-purple-600/20 hover:bg-purple-600/30 text-purple-300 border border-purple-500/30'
                                    }`}
                                data-tip="翻译全文（智能识别中英文）"
                            >
                                {isTranslating ? (
                                    <Loader2 size={14} className="animate-spin" />
                                ) : (
                                    <ArrowLeftRight size={14} />
                                )}
                                {showTranslation && translatedText ? '显示原文' : '翻译全文'}
                            </button>
                        )}
                        {/* 切换显示按钮 */}
                        {translatedText && (
                            <button
                                onClick={() => setShowTranslation(!showTranslation)}
                                className="flex items-center gap-1.5 px-2 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all"
                            >
                                {showTranslation ? '原文' : '译文'}
                            </button>
                        )}
                        <button
                            onClick={() => handleCopy(showTranslation && translatedText ? translatedText : text)}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all tooltip-bottom ${copied
                                ? 'bg-emerald-600 text-white'
                                : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white'
                                }`}
                            data-tip="复制内容"
                        >
                            {copied ? <Check size={14} /> : <Copy size={14} />}
                            {copied ? '已复制' : '复制'}
                        </button>
                        <button
                            onClick={onClose}
                            className="p-2 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors tooltip-bottom"
                            data-tip="关闭 (ESC)"
                        >
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* 内容 - 可滚动 */}
                <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar" ref={contentRef}>
                    <div className="text-sm md:text-base text-zinc-200 whitespace-pre-wrap leading-relaxed select-text">
                        {showTranslation && translatedText ? translatedText : text}
                    </div>
                </div>

                {/* 选中文本翻译区 */}
                {onTranslate && selectedText && (
                    <div className="px-4 py-3 border-t border-zinc-800 bg-zinc-950/50 flex-shrink-0">
                        <div className="flex items-center justify-between gap-3">
                            <div className="flex-1 min-w-0">
                                <p className="text-[0.625rem] text-zinc-500 mb-1">选中的文本:</p>
                                <p className="text-xs text-zinc-400 truncate">{selectedText.slice(0, 100)}{selectedText.length > 100 ? '...' : ''}</p>
                            </div>
                            <button
                                onClick={handleTranslateSelection}
                                disabled={isTranslatingSelection}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-blue-600/20 hover:bg-blue-600/30 text-blue-300 border border-blue-500/30 transition-all shrink-0"
                            >
                                {isTranslatingSelection ? <Loader2 size={12} className="animate-spin" /> : <ArrowLeftRight size={12} />}
                                翻译选中
                            </button>
                        </div>
                        {translatedSelection && (
                            <div className="mt-2 p-2 bg-zinc-800/50 rounded-lg border border-zinc-700">
                                <p className="text-[0.625rem] text-emerald-400 mb-1">翻译结果:</p>
                                <p className="text-xs text-zinc-200">{translatedSelection}</p>
                                <button
                                    onClick={() => handleCopy(translatedSelection)}
                                    className="mt-1 text-[0.625rem] text-zinc-500 hover:text-zinc-300"
                                >
                                    复制译文
                                </button>
                            </div>
                        )}
                    </div>
                )}

                {/* 底部提示 */}
                <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/95 flex-shrink-0">
                    <p className="text-[0.625rem] text-zinc-600 text-center">
                        按 ESC 键关闭 · 可选中文字复制{onTranslate ? ' · 选中文字可单独翻译' : ''}
                    </p>
                </div>
            </div>
        </div>
    );
};

// AI 对话记录查看弹窗
interface ConversationLogModalProps {
    item: ImageItem | null;
    onClose: () => void;
}

export const ConversationLogModal: React.FC<ConversationLogModalProps> = ({ item, onClose }) => {
    const [copiedIdx, setCopiedIdx] = useState<number | null>(null);
    const [copiedAll, setCopiedAll] = useState(false);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    useEffect(() => {
        const prevUserSelect = document.body.style.userSelect;
        const prevWebkitUserSelect = (document.body.style as any).WebkitUserSelect || '';
        document.body.style.userSelect = 'text';
        (document.body.style as any).WebkitUserSelect = 'text';
        return () => {
            document.body.style.userSelect = prevUserSelect;
            (document.body.style as any).WebkitUserSelect = prevWebkitUserSelect;
        };
    }, []);

    if (!item) return null;

    const logs = item.aiConversationLog || [];
    if (logs.length === 0) return null;

    const copyEntry = (idx: number) => {
        const entry = logs[idx];
        const text = `=== ${entry.label || '对话'} ===\n\n【发送给 AI 的 Prompt】\n${entry.prompt}\n\n【AI 回复】\n${entry.response}`;
        navigator.clipboard.writeText(text);
        setCopiedIdx(idx);
        setTimeout(() => setCopiedIdx(null), 1500);
    };

    const copyAll = () => {
        const text = logs.map((entry, idx) => {
            const header = `=== ${entry.label || `对话 #${idx + 1}`} (${new Date(entry.timestamp).toLocaleTimeString()}) ===`;
            return `${header}\n\n【发送给 AI 的 Prompt】\n${entry.prompt}\n\n【AI 回复】\n${entry.response}`;
        }).join('\n\n' + '─'.repeat(60) + '\n\n');
        navigator.clipboard.writeText(text);
        setCopiedAll(true);
        setTimeout(() => setCopiedAll(false), 1500);
    };

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
            onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
        >
            <div
                className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden select-text"
                style={{ userSelect: 'text', WebkitUserSelect: 'text' }}

            >
                <div style={{ width: '90vw', maxWidth: '900px', maxHeight: '85vh' }} className="flex flex-col overflow-hidden">
                    {/* Header */}
                    <div className="flex items-center justify-between px-5 py-3 border-b border-zinc-800 bg-zinc-900/95 flex-shrink-0">
                        <div className="flex items-center gap-2">
                            <Eye size={16} className="text-amber-400" />
                            <span className="text-sm font-semibold text-zinc-200">AI 对话记录</span>
                            <span className="text-xs text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">{logs.length} 条</span>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={copyAll}
                                className={`px-3 py-1 text-xs rounded-lg transition-all ${copiedAll ? 'bg-emerald-500/20 text-emerald-400' : 'bg-zinc-800 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'}`}
                            >
                                {copiedAll ? '✓ 已复制全部' : '复制全部'}
                            </button>
                            <button
                                onClick={onClose}
                                className="p-1.5 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                    </div>

                    {/* Content */}
                    <div className="flex-1 overflow-y-auto custom-scrollbar p-4 space-y-4 select-text">
                        {logs.map((entry, idx) => (
                            <div key={idx} className="bg-zinc-800/60 border border-zinc-700/50 rounded-xl overflow-hidden">
                                {/* Entry Header */}
                                <div className="flex items-center justify-between px-4 py-2 bg-zinc-800/80 border-b border-zinc-700/30">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs font-mono text-amber-400 bg-amber-500/10 px-2 py-0.5 rounded">
                                            #{idx + 1}
                                        </span>
                                        {entry.label && (
                                            <span className="text-xs text-zinc-300 font-medium">{entry.label}</span>
                                        )}
                                        <span className="text-[10px] text-zinc-500">
                                            {new Date(entry.timestamp).toLocaleTimeString()}
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => copyEntry(idx)}
                                        className={`px-2 py-0.5 text-[10px] rounded transition-all ${copiedIdx === idx ? 'bg-emerald-500/20 text-emerald-400' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700'}`}
                                    >
                                        {copiedIdx === idx ? '✓ 已复制' : '复制'}
                                    </button>
                                </div>

                                {/* Prompt */}
                                <div className="px-4 py-3 border-b border-zinc-700/20">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <span className="text-[10px] font-bold text-blue-400 uppercase tracking-wider">发送 Prompt</span>
                                        <span className="text-[9px] text-zinc-600">({entry.prompt.length} 字符)</span>
                                        {entry.imageSource && (
                                            <span className="text-[9px] text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded">
                                                📷 {entry.imageSource === 'main' ? '图 1' : entry.imageSource.startsWith('fusion:') ? `图 ${parseInt(entry.imageSource.split(':')[1]) + 2}` : entry.imageSource.startsWith('ref:') ? `图(${entry.imageSource.split(':')[1]})` : entry.imageSource}
                                            </span>
                                        )}
                                    </div>
                                    <div className="flex gap-3">
                                        {/* 发送的图片缩略图 */}
                                        {entry.imageSource && (() => {
                                            let imgUrl: string | undefined;
                                            if (entry.imageSource === 'main') {
                                                imgUrl = item.imageUrl;
                                            } else if (entry.imageSource.startsWith('fusion:')) {
                                                const fusionIdx = parseInt(entry.imageSource.split(':')[1]);
                                                const fi = item.fusionImages?.[fusionIdx];
                                                if (fi?.base64Data) {
                                                    imgUrl = fi.base64Data.startsWith('data:') ? fi.base64Data : `data:image/png;base64,${fi.base64Data}`;
                                                }
                                            }
                                            // ref: 类型的参考图无法在这里获取 URL（数据不在 item 中），显示标签即可
                                            return imgUrl ? (
                                                <div className="shrink-0 w-16 h-16 rounded-lg overflow-hidden border border-zinc-700/50 bg-zinc-800">
                                                    <img src={imgUrl} alt="sent" className="w-full h-full object-contain" />
                                                </div>
                                            ) : null;
                                        })()}
                                        <div className="flex-1 text-xs text-zinc-300 whitespace-pre-wrap break-all leading-relaxed max-h-[300px] overflow-y-auto custom-scrollbar bg-zinc-900/50 rounded-lg p-3 font-mono select-text">
                                            {entry.prompt}
                                        </div>
                                    </div>
                                </div>

                                {/* Response */}
                                <div className="px-4 py-3">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <span className="text-[10px] font-bold text-emerald-400 uppercase tracking-wider">AI 回复</span>
                                        <span className="text-[9px] text-zinc-600">({entry.response.length} 字符)</span>
                                    </div>
                                    <div className="text-xs text-zinc-300 whitespace-pre-wrap break-all leading-relaxed max-h-[300px] overflow-y-auto custom-scrollbar bg-zinc-900/50 rounded-lg p-3 font-mono select-text">
                                        {entry.response}
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </div>
            </div>
        </div>
    );
};

interface ChatPanelProps {
    item: ImageItem;
    onToggleChat?: (id: string) => void;
    onSendMessage?: (id: string) => void;
    onUpdateChatInput?: (id: string, value: string) => void;
    onCopyChatHistory?: (id: string) => void;
    onUpdateChatAttachments?: (id: string, attachments: string[]) => void;
    // Minimize mode
    onToggleMinimize?: (id: string) => void;
    isMinimized?: boolean;
    isCompact?: boolean; // 紧凑模式，隐藏标题文字
}

const ChatPanel = ({ item, onToggleChat, onSendMessage, onUpdateChatInput, onCopyChatHistory, onUpdateChatAttachments, onToggleMinimize, isMinimized, isCompact }: ChatPanelProps) => {
    // 移除 localInput，直接使用 item.chatInput，但由于 React 渲染机制，
    // 如果父组件更新导致重新渲染，input 焦点可能会丢失，除非组件的位置和 key 保持稳定。
    // 为了支持中文输入法，通常建议使用非受控组件或者通过 local state + 仅在 blur/enter 时提交的方式，
    // 但这里我们尝试保持受控组件，只要组件实例不被销毁重建（即移出父组件），React 的 diff 算法应该能保持 input 的状态。
    // 为了更稳妥，我们还是使用 local state 并同步。

    const [localInput, setLocalInput] = useState(item.chatInput || '');
    const inputRef = useRef<HTMLInputElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    // 消息放大状态
    const [expandedMessageText, setExpandedMessageText] = useState<string | null>(null);
    // 单击提示状态 - 跟随鼠标位置
    const [clickHint, setClickHint] = useState<{ show: boolean; x: number; y: number }>({ show: false, x: 0, y: 0 });

    // 当 item.chatInput 外部改变（例如清空）时，同步到 localInput
    useEffect(() => {
        if (item.chatInput !== localInput) {
            // 只有当外部为空（发送后清空）或者确实不一致时才同步
            // 注意：这可能导致输入冲突，如果外部更新很频繁。
            // 但在这个应用中，外部更新主要是发送后清空。
            if (item.chatInput === '') {
                setLocalInput('');
            } else if (item.chatInput !== localInput) {
                // 如果是切换了图片 item，也需要更新
                // 但这里 ChatPanel 是针对特定 item 的，key 应该不同。
                // 暂时只处理清空的情况，或者初始化。
            }
        }
    }, [item.chatInput]);

    // 初始化或 item 改变时
    useEffect(() => {
        setLocalInput(item.chatInput || '');
    }, [item.id]);

    // 当对话面板打开时自动聚焦输入框
    useEffect(() => {
        if (item.isChatOpen && inputRef.current) {
            // 稍微延迟一点，确保渲染完成
            setTimeout(() => inputRef.current?.focus(), 50);
        }
    }, [item.isChatOpen]);

    // 当有新消息时滚动到底部
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [item.chatHistory.length, item.isChatLoading]);

    if (!item.isChatOpen) return null;

    const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const value = e.target.value;
        setLocalInput(value);
        onUpdateChatInput?.(item.id, value);
    };

    const handleSend = () => {
        if (localInput.trim() || (item.chatAttachments && item.chatAttachments.length > 0)) {
            onSendMessage?.(item.id);
            // 本地先清空，等待 props 更新
            setLocalInput('');
        }
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
        const files = Array.from(e.clipboardData.files) as File[];
        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        // 如果有图片，阻止默认粘贴（避免由 input 处理 text）
        e.preventDefault();

        const newAttachments: string[] = [];
        for (const file of imageFiles) {
            const f = file as File;
            try {
                const base64 = await convertBlobToBase64(f);
                const dataUrl = `data:${f.type};base64,${base64}`;
                newAttachments.push(dataUrl);
            } catch (err) {
                console.error('Failed to process pasted image', err);
            }
        }

        if (newAttachments.length > 0) {
            onUpdateChatAttachments?.(item.id, [...(item.chatAttachments || []), ...newAttachments]);
        }
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const newAttachments: string[] = [];
        for (const file of files) {
            const f = file as File;
            try {
                const base64 = await convertBlobToBase64(f);
                const dataUrl = `data:${f.type};base64,${base64}`;
                newAttachments.push(dataUrl);
            } catch (err) {
                console.error('Failed to process selected file', err);
            }
        }

        if (newAttachments.length > 0) {
            onUpdateChatAttachments?.(item.id, [...(item.chatAttachments || []), ...newAttachments]);
        }
        // Reset input
        e.target.value = '';
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        // Manually reset global DropZone state by dispatching a synthetic drop event
        // This prevents the global overlay from getting stuck
        const syntheticEvent = new DragEvent('drop', {
            bubbles: true,
            cancelable: true,
            composed: true
        });
        document.dispatchEvent(syntheticEvent);

        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;

        const newAttachments: string[] = [];
        for (const file of files) {
            const f = file as File;
            try {
                const base64 = await convertBlobToBase64(f);
                const dataUrl = `data:${f.type};base64,${base64}`;
                newAttachments.push(dataUrl);
            } catch (err) {
                console.error('Failed to process dropped file', err);
            }
        }

        if (newAttachments.length > 0) {
            onUpdateChatAttachments?.(item.id, [...(item.chatAttachments || []), ...newAttachments]);
        }
    };

    const removeAttachment = (index: number) => {
        const current = item.chatAttachments || [];
        const next = current.filter((_, i) => i !== index);
        onUpdateChatAttachments?.(item.id, next);
    };

    return (
        <div className="flex-1 flex flex-col border-l border-zinc-700 bg-zinc-950/80 min-w-0 min-h-0">
            {/* 对话标题栏 */}
            <div className={`flex items-center justify-between border-b border-zinc-700 bg-zinc-900/50 ${isCompact ? 'px-1.5 py-1' : 'px-3 py-2'}`}>
                <span className="text-xs text-zinc-400 font-medium">
                    {isCompact ? '💬' : '💬 继续对话'}
                </span>
                <div className={`flex items-center ${isCompact ? 'gap-0.5 flex-1 justify-end' : 'gap-1'}`}>
                    {onToggleMinimize && (
                        <button
                            onClick={() => {
                                // 点击精简按钮：设置精简模式为true + 关闭对话面板
                                if (!isMinimized) {
                                    onToggleMinimize(item.id);
                                }
                                onToggleChat?.(item.id);
                            }}
                            className={`text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded transition-colors tooltip-bottom ${isCompact ? 'p-0.5' : 'p-1'}`}
                            data-tip="精简显示 (只看最后结果)"
                        >
                            <ChevronUp size={isCompact ? 12 : 14} />
                        </button>
                    )}
                    <button
                        onClick={() => onToggleChat?.(item.id)}
                        className={`text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded transition-colors tooltip-bottom ${isCompact ? 'p-0.5' : 'p-1'}`}
                        data-tip="关闭对话面板"
                    >
                        <X size={isCompact ? 12 : 14} />
                    </button>
                </div>
            </div>

            {/* 对话历史 */}
            <div
                ref={chatContainerRef}
                className={`flex-1 overflow-y-auto custom-scrollbar p-3 space-y-2 min-h-0 ${isMinimized ? 'max-h-20' : ''}`}
            >
                {item.chatHistory.length === 0 ? (
                    <div className="text-xs text-zinc-500 italic text-center py-4">
                        暂无对话记录，输入问题继续对话
                    </div>
                ) : isMinimized ? (
                    /* 精简模式：只显示最后一条消息 */
                    (() => {
                        const lastMsg = item.chatHistory[item.chatHistory.length - 1];
                        return (
                            <div
                                key={lastMsg.id}
                                className={`text-xs p-2 rounded-lg ${lastMsg.role === 'user'
                                    ? 'bg-blue-900/30 text-blue-100 ml-4'
                                    : 'bg-zinc-800 text-zinc-200 mr-4'
                                    }`}
                            >
                                <div className="whitespace-pre-wrap break-words line-clamp-2">{lastMsg.text}</div>
                            </div>
                        );
                    })()
                ) : (
                    /* 正常模式：显示完整历史 */
                    item.chatHistory.map((msg) => (
                        <div
                            key={msg.id}
                            className={`text-xs p-2 rounded-lg ${msg.role === 'user'
                                ? 'bg-blue-900/30 text-blue-100 ml-4'
                                : 'bg-zinc-800 text-zinc-200 mr-4'
                                }`}
                        >
                            <div className="text-[0.625rem] text-zinc-500 mb-1">
                                {msg.role === 'user' ? '你' : 'AI'}
                            </div>
                            {/* Render Message Images */}
                            {msg.images && msg.images.length > 0 && (
                                <div className="flex gap-2 mb-2 flex-wrap">
                                    {msg.images.map((img, idx) => (
                                        <div key={idx} className="relative group">
                                            <img
                                                src={img}
                                                alt="attachment"
                                                className="h-20 w-20 object-cover rounded border border-zinc-700 cursor-pointer hover:opacity-90"
                                                onClick={() => {
                                                    // Optional: Could implement a lightbox or preview here
                                                    // For now just allow viewing simpler
                                                }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            )}
                            <div
                                className={`tooltip-bottom whitespace-pre-wrap break-words text-xs leading-relaxed ${msg.role === 'user' ? 'text-zinc-400' : 'text-zinc-200 cursor-pointer hover:bg-zinc-700/30 rounded transition-colors relative'} ${isCompact ? 'line-clamp-2' : 'line-clamp-4'}`}
                                onClick={(e) => {
                                    if (msg.role !== 'user') {
                                        setClickHint({ show: true, x: e.clientX, y: e.clientY });
                                        setTimeout(() => setClickHint({ show: false, x: 0, y: 0 }), 1500);
                                    }
                                }}
                                onDoubleClick={() => msg.role !== 'user' && setExpandedMessageText(msg.text)}
                                data-tip={msg.role !== 'user' ? '双击放大窗口查看结果' : undefined}
                            >
                                {msg.text}
                            </div>
                        </div>
                    ))
                )}
                {/* 单击提示气泡 - 显示在鼠标位置 */}
                {clickHint.show && (
                    <div
                        className="fixed bg-emerald-600 text-white text-[0.5625rem] px-2 py-1 rounded shadow-lg whitespace-nowrap z-[9999] pointer-events-none"
                        style={{ left: clickHint.x + 10, top: clickHint.y - 30 }}
                    >
                        👆 双击放大窗口查看结果
                    </div>
                )}
                {item.isChatLoading && (
                    <div className="flex items-center gap-2 text-xs text-emerald-400 p-2">
                        <Loader2 size={12} className="animate-spin" />
                        AI 正在思考...
                    </div>
                )}
            </div>

            {/* 待发送附件 */}
            {!isMinimized && item.chatAttachments && item.chatAttachments.length > 0 && (
                <div className="px-3 pt-2 flex gap-2 overflow-x-auto custom-scrollbar">
                    {item.chatAttachments.map((att, index) => (
                        <div key={index} className="relative group shrink-0 w-16 h-16">
                            <img src={att} alt={`attachment-${index}`} className="w-full h-full object-cover rounded border border-zinc-700" />
                            <button
                                onClick={() => removeAttachment(index)}
                                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity tooltip-bottom"
                                data-tip="删除图片"
                            >
                                <X size={10} />
                            </button>
                        </div>
                    ))}
                    {/* 上传小块块 */}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-16 h-16 shrink-0 rounded border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 transition-colors tooltip-bottom"
                        data-tip="添加图片"
                    >
                        <Plus size={20} />
                    </button>
                </div>
            )}

            {/* 输入框和按钮 - 精简模式下隐藏 */}
            {!isMinimized && (
                <div
                    className={`border-t border-zinc-700 bg-zinc-900/50 transition-all relative ${isDragging ? 'bg-zinc-800' : ''} ${isCompact ? 'p-1.5' : 'p-3'}`}
                    onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                    onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
                    onDrop={handleDrop}
                    style={{ zIndex: isDragging ? 150 : 'auto' }} // Ensure it's above global overlay when dragging
                >
                    {/* 拖拽提示遮罩 */}
                    {isDragging && (
                        <div className="absolute inset-0 z-20 bg-emerald-900/40 backdrop-blur-[1px] flex flex-col items-center justify-center border-2 border-emerald-500/50 border-dashed rounded-lg m-1">
                            <Plus size={24} className="text-emerald-400 mb-1" />
                            <span className="text-xs font-bold text-emerald-200 shadow-sm">松开添加到对话</span>
                        </div>
                    )}
                    <input
                        type="file"
                        ref={fileInputRef}
                        className="hidden"
                        accept="image/*"
                        multiple
                        onChange={handleFileSelect}
                    />
                    <div className={`flex ${isCompact ? 'gap-1' : 'gap-2'}`}>
                        {/* 如果没有附件显示区，可以在这里添加 Paperclip 按钮 */}
                        {(!item.chatAttachments || item.chatAttachments.length === 0) && (
                            <button
                                onClick={() => fileInputRef.current?.click()}
                                className={`bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg transition-colors border border-zinc-700 tooltip-bottom ${isCompact ? 'p-1.5' : 'p-2'}`}
                                data-tip="上传图片"
                            >
                                <Paperclip size={isCompact ? 14 : 18} />
                            </button>
                        )}
                        <input
                            ref={inputRef}
                            type="text"
                            value={localInput}
                            onChange={handleInputChange}
                            onKeyDown={(e) => {
                                if (e.key === 'Enter' && !e.shiftKey) {
                                    e.preventDefault();
                                    handleSend();
                                }
                            }}
                            placeholder={isCompact ? "输入..." : "继续对话，修改描述..."}
                            className={`flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 ${isCompact ? 'px-2 py-1 text-xs' : 'px-3 py-2 text-sm'}`}
                            disabled={item.isChatLoading}
                            autoComplete="off"
                            onPaste={handlePaste}
                        />
                        <button
                            onClick={handleSend}
                            disabled={!localInput.trim() || item.isChatLoading}
                            className={`bg-emerald-600 hover:bg-emerald-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center ${isCompact ? 'p-1.5' : 'px-4 py-2 gap-1'}`}
                        >
                            <Send size={isCompact ? 12 : 14} />
                        </button>
                        {item.chatHistory.length > 0 && (
                            <button
                                onClick={() => onCopyChatHistory?.(item.id)}
                                className={`bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg transition-colors tooltip-bottom ${isCompact ? 'p-1.5' : 'px-3 py-2'}`}
                                data-tip="复制对话历史"
                            >
                                <Copy size={isCompact ? 12 : 14} />
                            </button>
                        )}
                    </div>
                </div>
            )}

            {/* 消息放大模态框 */}
            <TextExpandModal
                text={expandedMessageText}
                title="AI 回复"
                subtitle="对话消息"
                onClose={() => setExpandedMessageText(null)}
            />
        </div>
    );
};

// 使用 React.memo 优化：防止其他图片变化时重新渲染
const MemoizedChatPanel = memo(ChatPanel);
const QUICK_IMAGE_APPEND_DIM = '__append__';
const QUICK_IMAGE_DESCRIBE_DIM = '__describe__';
const DESCRIBE_PRESET_OPTIONS: Array<{ id: string; label: string }> = [
    { id: '1', label: '图片转为AI提示词-1（识别原始图片风格）' },
    { id: '2', label: '图片转为AI提示词-2（统一转为摄影真实风格）' },
    { id: '6', label: '图片转为AI提示词-3（精准复刻）' },
    { id: 'custom', label: '✏️ 自定义描述指令' },
];

// 根据预设ID获取描述指令文本（从 DEFAULT_PRESETS 读取）
const getDescribePromptByPresetIdLocal = (presetId: string, customPrompt?: string): string => {
    if (presetId === 'custom' && customPrompt?.trim()) return customPrompt.trim();
    const preset = DEFAULT_PRESETS.find(p => p.id === presetId);
    return preset?.text || DEFAULT_PRESETS[0].text;
};
interface QuickInlineImageManagerProps {
    item: ImageItem;
    allEnabledDimNames?: string[];
    globalOverrideCounts?: Record<string, number>;
    globalOverrideModes?: Record<string, string>; // 全局覆盖模式
    onUpdateCardOverrideCount?: (cardId: string, dimName: string, count: number | null) => void;
    onUpdateCardTextOverride?: (cardId: string, dimName: string, value: string | null) => void;
    onUpdateCustomPrompt?: (id: string, value: string) => void;
    onUpdateRefImageConfig?: (cardId: string, imageIndex: number, update: Partial<import('../types').RefImageConfig> | null) => void;
    onRemoveFusionImage?: (imageId: string, fusionImageId: string) => void;
    onAddFusionImage?: (imageId: string, file: File) => void;
    onToggleDescribeFirst?: (cardId: string, value: boolean) => void;
    onSetDescribePresetId?: (cardId: string, presetId: string) => void;
    onSetDescribeCustomPrompt?: (cardId: string, customPrompt: string) => void;
}

const QuickInlineImageManager: React.FC<QuickInlineImageManagerProps> = ({
    item,
    allEnabledDimNames,
    globalOverrideCounts,
    globalOverrideModes,
    onUpdateCardOverrideCount,
    onUpdateCardTextOverride,
    onUpdateCustomPrompt,
    onUpdateRefImageConfig,
    onRemoveFusionImage,
    onAddFusionImage,
    onToggleDescribeFirst,
    onSetDescribePresetId,
    onSetDescribeCustomPrompt,
}) => {
    const [promptModalImageIndex, setPromptModalImageIndex] = useState<number | null>(null);
    const [expandedEdit, setExpandedEdit] = useState<{ title: string; value: string; onChange: (val: string) => void } | null>(null);
    const [promptDraft, setPromptDraft] = useState('');
    const promptTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [textOverrideModal, setTextOverrideModal] = useState<{ kind: 'append' | 'dim'; dimName?: string } | null>(null);
    const [textOverrideDraft, setTextOverrideDraft] = useState('');
    const textOverrideTextareaRef = useRef<HTMLTextAreaElement | null>(null);
    const [isTextOverrideExpanded, setIsTextOverrideExpanded] = useState(() => {
        // 如果卡片已有覆盖值，默认展开
        const hasTextOverrides = item.overrideTextOverrides && Object.values(item.overrideTextOverrides).some(v => v?.trim());
        const hasCountOverrides = item.overrideCountOverrides && Object.keys(item.overrideCountOverrides).length > 0;
        return !!(hasTextOverrides || hasCountOverrides);
    });
    // 如果卡片覆盖值出现（如从独立模式切过来），自动展开
    useEffect(() => {
        const hasText = item.overrideTextOverrides && Object.values(item.overrideTextOverrides).some(v => v?.trim());
        const hasCount = item.overrideCountOverrides && Object.keys(item.overrideCountOverrides).length > 0;
        if (hasText || hasCount) setIsTextOverrideExpanded(true);
    }, [item.overrideTextOverrides, item.overrideCountOverrides]);
    const enabledDimNames = allEnabledDimNames || [];
    const cfgs = item.refImageConfigs || [];
    const usedDims = new Set(cfgs.map(c => c.dimName).filter(d => !!d && d !== QUICK_IMAGE_APPEND_DIM && d !== QUICK_IMAGE_DESCRIBE_DIM));
    const allImgs: Array<{ index: number; url: string }> = [];
    if (item.imageUrl || item.base64Data) allImgs.push({ index: 0, url: item.imageUrl || '' });
    item.fusionImages?.forEach((fi, i) => allImgs.push({ index: i + 1, url: fi.imageUrl || '' }));
    const quickFusionInputId = `inline-quick-fusion-input-${item.id}`;
    const activePromptCfg = promptModalImageIndex !== null
        ? cfgs.find(c => c.imageIndex === promptModalImageIndex)
        : undefined;

    useEffect(() => {
        if (promptModalImageIndex === null || !activePromptCfg?.dimName) return;
        const initialValue = (activePromptCfg.dimName === QUICK_IMAGE_APPEND_DIM || activePromptCfg.dimName === QUICK_IMAGE_DESCRIBE_DIM)
            ? (activePromptCfg.extractPrompt || '')
            : (activePromptCfg.extractPrompt ?? getDefaultExtractPrompt(activePromptCfg.dimName));
        setPromptDraft(initialValue);
        requestAnimationFrame(() => {
            promptTextareaRef.current?.focus();
        });
    }, [promptModalImageIndex, activePromptCfg?.dimName, activePromptCfg?.extractPrompt]);

    const closePromptModal = (save: boolean = true) => {
        if (save && promptModalImageIndex !== null && activePromptCfg?.dimName) {
            onUpdateRefImageConfig?.(item.id, promptModalImageIndex, { extractPrompt: promptDraft });
        }
        setPromptModalImageIndex(null);
    };
    useEffect(() => {
        if (!textOverrideModal) return;
        const initialValue = textOverrideModal.kind === 'append'
            ? (item.customPrompt || '')
            : (item.overrideTextOverrides?.[textOverrideModal.dimName || ''] || '');
        setTextOverrideDraft(initialValue);
        requestAnimationFrame(() => {
            textOverrideTextareaRef.current?.focus();
        });
    }, [textOverrideModal, item.customPrompt, item.overrideTextOverrides]);

    const closeTextOverrideModal = (save: boolean = true) => {
        if (save && textOverrideModal) {
            if (textOverrideModal.kind === 'append') {
                onUpdateCustomPrompt?.(item.id, textOverrideDraft);
            } else if (textOverrideModal.dimName) {
                onUpdateCardTextOverride?.(item.id, textOverrideModal.dimName, textOverrideDraft || null);
            }
        }
        setTextOverrideModal(null);
    };
    const canEditDimOverrides = enabledDimNames.length > 0 && !!onUpdateCardTextOverride && !!onUpdateCardOverrideCount;
    const canEditAppendPrompt = !!onUpdateCustomPrompt;
    const showInlineOverridePane = canEditDimOverrides || canEditAppendPrompt;

    const renderTextOverrideRow = () => {
        if (!showInlineOverridePane) return null;
        return (
            <div className="w-full min-w-0 mt-1">
                <div
                    className="flex items-center gap-1 cursor-pointer select-none text-zinc-400 w-fit hover:text-zinc-200 transition-colors mb-2 bg-zinc-800/50 px-2 py-1 rounded border border-zinc-700/50"
                    onClick={(e) => { e.stopPropagation(); setIsTextOverrideExpanded(!isTextOverrideExpanded); }}
                >
                    {isTextOverrideExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
                    <span className="text-[10px] font-medium">✍️ 手动指定文字覆盖 (若无需AI识图，可直接指定固定词语)</span>
                </div>

                {isTextOverrideExpanded && (
                    <div className="flex gap-2 overflow-x-auto overflow-y-visible pb-1 pr-1">
                        {canEditAppendPrompt && (
                            <div className="min-w-[196px] max-w-[196px] rounded border border-purple-700/40 bg-purple-950/20 p-1.5 flex flex-col gap-1">
                                <span className={`text-[9px] ${(item.customPrompt || '').trim() ? 'text-purple-300' : 'text-zinc-500'}`}>追加内容</span>
                                <input
                                    type="text"
                                    value={item.customPrompt || ''}
                                    onChange={e => {
                                        e.stopPropagation();
                                        onUpdateCustomPrompt?.(item.id, e.target.value);
                                    }}
                                    onMouseDown={e => e.stopPropagation()}
                                    onDoubleClick={e => {
                                        e.stopPropagation();
                                        setPromptModalImageIndex(null);
                                        setTextOverrideModal({ kind: 'append' });
                                    }}
                                    placeholder="这张图单独追加"
                                    className="h-6 px-1.5 bg-zinc-800 border border-zinc-700/50 rounded text-[10px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50"
                                    title="双击弹框编辑"
                                />
                                <span className="text-[8px] text-zinc-500">仅作用当前卡片</span>
                            </div>
                        )}
                        {canEditDimOverrides && enabledDimNames.map(dimName => {
                            const val = item.overrideTextOverrides?.[dimName] || '';
                            const globalCount = globalOverrideCounts?.[dimName] ?? 0;
                            const cardCount = item.overrideCountOverrides?.[dimName];
                            const effectiveCount = cardCount !== undefined ? cardCount : globalCount;
                            const isCustomCount = cardCount !== undefined;
                            const dimMode = globalOverrideModes?.[dimName];
                            const isImageMode = dimMode === 'image' || dimMode === 'queue-image';
                            return (
                                <div key={dimName} className={`min-w-[168px] max-w-[168px] rounded border p-1.5 flex flex-col gap-1 ${isImageMode ? 'border-amber-800/30 bg-amber-950/10 opacity-60' : 'border-zinc-700/50 bg-zinc-900/50'}`}>
                                    <span className={`text-[9px] ${isImageMode ? 'text-amber-400/70' : val.trim() ? 'text-cyan-300' : 'text-zinc-500'}`}>{dimName}</span>
                                    {isImageMode ? (
                                        <div className="h-6 px-1.5 bg-zinc-800/50 border border-zinc-700/30 rounded text-[9px] text-amber-400/60 flex items-center" title="已在全局覆盖设置了图片提取模式">
                                            📷 已设为{dimMode === 'queue-image' ? '逐图' : '图片'}提取
                                        </div>
                                    ) : (
                                        <input
                                            type="text"
                                            value={val}
                                            onChange={e => {
                                                e.stopPropagation();
                                                onUpdateCardTextOverride?.(item.id, dimName, e.target.value || null);
                                            }}
                                            onMouseDown={e => e.stopPropagation()}
                                            onDoubleClick={e => {
                                                e.stopPropagation();
                                                setPromptModalImageIndex(null);
                                                setTextOverrideModal({ kind: 'dim', dimName });
                                            }}
                                            placeholder="覆盖词"
                                            className="h-6 px-1.5 bg-zinc-800 border border-zinc-700/50 rounded text-[10px] text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-cyan-500/50"
                                            title="双击弹框编辑"
                                        />
                                    )}
                                    <div className="flex items-center justify-center gap-1">
                                        <button
                                            onClick={e => {
                                                e.stopPropagation();
                                                onUpdateCardOverrideCount?.(item.id, dimName, Math.max(0, effectiveCount - 1));
                                            }}
                                            onMouseDown={e => e.stopPropagation()}
                                            className="w-4 h-4 rounded bg-zinc-800 border border-zinc-600/50 text-amber-400 hover:bg-zinc-700 text-[9px] flex items-center justify-center"
                                        >-</button>
                                        <span className={`text-[9px] min-w-[14px] text-center ${isCustomCount ? 'text-amber-300 font-semibold' : 'text-zinc-400'}`}>
                                            {effectiveCount === 0 ? '全' : effectiveCount}
                                        </span>
                                        <button
                                            onClick={e => {
                                                e.stopPropagation();
                                                onUpdateCardOverrideCount?.(item.id, dimName, effectiveCount + 1);
                                            }}
                                            onMouseDown={e => e.stopPropagation()}
                                            className="w-4 h-4 rounded bg-zinc-800 border border-zinc-600/50 text-amber-400 hover:bg-zinc-700 text-[9px] flex items-center justify-center"
                                        >+</button>
                                        {isCustomCount ? (
                                            <button
                                                onClick={e => {
                                                    e.stopPropagation();
                                                    onUpdateCardOverrideCount?.(item.id, dimName, null);
                                                }}
                                                onMouseDown={e => e.stopPropagation()}
                                                className="text-[8px] text-zinc-600 hover:text-zinc-400"
                                                title="恢复全局"
                                            >↩</button>
                                        ) : (
                                            <span className="text-[8px] text-transparent">·</span>
                                        )}
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}
            </div>
        );
    };

    const renderImageStrip = () => {
        if (allImgs.length === 0) {
            if (!onAddFusionImage) return null;
            return (
                <div className="min-w-[128px] flex flex-col gap-1">
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            const input = document.getElementById(quickFusionInputId) as HTMLInputElement | null;
                            input?.click();
                        }}
                        onMouseDown={e => e.stopPropagation()}
                        className="w-[128px] h-20 rounded border border-dashed border-cyan-500/40 bg-cyan-500/5 text-cyan-300 hover:bg-cyan-500/10 text-[10px] flex items-center justify-center gap-1 transition-colors"
                    >
                        <Plus size={12} />
                        添加图
                    </button>
                    <span className="text-[9px] text-zinc-600">空卡片：先添加图片</span>
                    <input
                        id={quickFusionInputId}
                        type="file"
                        className="hidden"
                        accept="image/*"
                        multiple
                        onChange={(e) => {
                            const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
                            files.forEach(file => onAddFusionImage(item.id, file));
                            e.currentTarget.value = '';
                        }}
                    />
                </div>
            );
        }

        return (
            <div className="flex gap-3 overflow-x-auto overflow-y-visible pb-2 w-full">
                {allImgs.map(img => {
                    // Configs specifically for THIS image
                    const imgCfgs = cfgs.filter(c => c.imageIndex === img.index && c.dimName);

                    return (
                        <div key={img.index} className="flex flex-col gap-2 w-[460px] shrink-0 bg-zinc-900/60 border border-zinc-700/60 rounded-xl p-3 shadow-sm">
                            {/* Row 1: Image & Dimension Toggles */}
                            <div className="flex gap-3">
                                <div className="relative group/ref-img w-28 h-28 shrink-0 rounded-lg overflow-hidden border border-zinc-700/50 bg-zinc-800 flex items-center justify-center p-0.5">
                                    {img.url && <img src={img.url} alt="" className="w-full h-full object-contain" />}
                                    {img.url && (
                                        <div className="pointer-events-none absolute left-0 top-0 z-40 hidden -translate-y-[105%] group-hover/ref-img:block">
                                            <div className="rounded-md border border-zinc-600 bg-zinc-950/95 p-1 shadow-2xl">
                                                <img src={img.url} alt="" className="max-w-[400px] max-h-[300px] w-auto h-auto object-contain rounded" />
                                            </div>
                                        </div>
                                    )}
                                    {img.index > 0 && onRemoveFusionImage && (() => {
                                        const fi = item.fusionImages?.[img.index - 1];
                                        return fi ? (
                                            <button
                                                onClick={e => { e.stopPropagation(); onRemoveFusionImage(item.id, fi.id); }}
                                                className="absolute -top-1.5 -right-1.5 w-6 h-6 bg-red-500/90 hover:bg-red-500 text-white rounded-full flex items-center justify-center opacity-0 group-hover/ref-img:opacity-100 transition-opacity text-xs shadow-sm backdrop-blur-sm"
                                            >✕</button>
                                        ) : null;
                                    })()}
                                </div>

                                <div className="flex flex-col gap-2 flex-1 min-w-0">
                                    <span className="text-[11px] font-medium text-purple-300 flex items-center gap-1">
                                        <FileImage size={12} /> 图 {img.index + 1} · 点击字典让 AI 为该图提取特征：
                                    </span>
                                    <div className="flex flex-wrap gap-1">
                                        {enabledDimNames.map(d => {
                                            const isBound = !!imgCfgs.find(c => c.dimName === d);
                                            return (
                                                <button
                                                    key={d}
                                                    onClick={e => {
                                                        e.stopPropagation();
                                                        if (isBound) {
                                                            onUpdateRefImageConfig?.(item.id, img.index, { dimName: `__remove__${d}` } as any);
                                                        } else {
                                                            onUpdateRefImageConfig?.(item.id, img.index, { dimName: d, extractPrompt: getDefaultExtractPrompt(d) });
                                                        }
                                                    }}
                                                    onMouseDown={e => e.stopPropagation()}
                                                    className={`px-1.5 py-0.5 rounded text-[10px] border transition-all ${isBound
                                                        ? 'bg-purple-600/30 text-purple-200 border-purple-500/50 shadow-inner'
                                                        : 'bg-zinc-800/60 text-zinc-500 border-zinc-700/60 hover:text-zinc-300 hover:border-zinc-500 hover:bg-zinc-700/50'
                                                        }`}
                                                    title={isBound ? `取消「${d}」` : `从此图提取「${d}」`}
                                                >
                                                    {isBound && <Check size={8} className="inline mr-0.5" />}{d}
                                                </button>
                                            );
                                        })}
                                        {/* 描述全图选项 */}
                                        <button
                                            onClick={e => {
                                                e.stopPropagation();
                                                const isBound = !!imgCfgs.find(c => c.dimName === QUICK_IMAGE_DESCRIBE_DIM);
                                                if (isBound) {
                                                    onUpdateRefImageConfig?.(item.id, img.index, { dimName: `__remove__${QUICK_IMAGE_DESCRIBE_DIM}` } as any);
                                                } else {
                                                    onUpdateRefImageConfig?.(item.id, img.index, { dimName: QUICK_IMAGE_DESCRIBE_DIM, extractPrompt: '' });
                                                }
                                            }}
                                            onMouseDown={e => e.stopPropagation()}
                                            className={`px-1.5 py-0.5 rounded text-[10px] border transition-all ${imgCfgs.find(c => c.dimName === QUICK_IMAGE_DESCRIBE_DIM)
                                                ? 'bg-amber-600/30 text-amber-200 border-amber-500/50 shadow-inner'
                                                : 'bg-zinc-800/60 text-zinc-500 border-zinc-700/60 hover:text-zinc-300 hover:border-zinc-500 hover:bg-zinc-700/50'
                                                }`}
                                        >
                                            {imgCfgs.find(c => c.dimName === QUICK_IMAGE_DESCRIBE_DIM) && <Check size={8} className="inline mr-0.5" />}先用AI"详细描述全图"
                                        </button>
                                        {/* 追加内容选项 */}
                                        <button
                                            onClick={e => {
                                                e.stopPropagation();
                                                const isBound = !!imgCfgs.find(c => c.dimName === QUICK_IMAGE_APPEND_DIM);
                                                if (isBound) {
                                                    onUpdateRefImageConfig?.(item.id, img.index, { dimName: `__remove__${QUICK_IMAGE_APPEND_DIM}` } as any);
                                                } else {
                                                    onUpdateRefImageConfig?.(item.id, img.index, { dimName: QUICK_IMAGE_APPEND_DIM, extractPrompt: '' });
                                                }
                                            }}
                                            onMouseDown={e => e.stopPropagation()}
                                            className={`px-1.5 py-0.5 rounded text-[10px] border transition-all ${imgCfgs.find(c => c.dimName === QUICK_IMAGE_APPEND_DIM)
                                                ? 'bg-blue-600/30 text-blue-200 border-blue-500/50 shadow-inner'
                                                : 'bg-zinc-800/60 text-zinc-500 border-zinc-700/60 hover:text-zinc-300 hover:border-zinc-500 hover:bg-zinc-700/50'
                                                }`}
                                        >
                                            {imgCfgs.find(c => c.dimName === QUICK_IMAGE_APPEND_DIM) && <Check size={8} className="inline mr-0.5" />}📝追加描述
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* Row 2: Extraction Params (Local to this Image) */}
                            {imgCfgs.length > 0 && (
                                <div className="flex flex-col gap-2 pt-3 mt-1 border-t border-zinc-700/60">
                                    <div className="text-[11px] font-medium text-zinc-400 mb-0.5 flex items-center gap-1.5">
                                        <Sparkles size={14} className="text-purple-400" /> 告诉 AI 看图时具体要提取什么 (识别提取指令)：
                                    </div>
                                    <div className="flex flex-col gap-2">
                                        {imgCfgs.map(selCfg => {
                                            const isAppend = selCfg.dimName === QUICK_IMAGE_APPEND_DIM;
                                            const isDescribe = selCfg.dimName === QUICK_IMAGE_DESCRIBE_DIM;
                                            const dimMode = (!isAppend && !isDescribe) ? globalOverrideModes?.[selCfg.dimName!] : undefined;
                                            const isTextMode = dimMode === 'text' || (!dimMode && !!(item.overrideTextOverrides?.[selCfg.dimName!]?.trim()));
                                            const hasTextOverride = !isAppend && !isDescribe && isTextMode && !!(item.overrideTextOverrides?.[selCfg.dimName!]?.trim());
                                            return (
                                                <div key={selCfg.dimName} className={`flex flex-col gap-2 bg-zinc-950/80 rounded border p-2.5 ${hasTextOverride ? 'border-cyan-800/30 opacity-60' : 'border-purple-800/30'}`}>
                                                    <div className="flex items-center justify-between">
                                                        <span className="text-xs font-semibold text-purple-200 flex items-center gap-1.5">
                                                            👉 {isDescribe ? '🔍 先用AI"详细描述全图"并作为基础上下文（可自定义描述指令）' : isAppend ? '追加该图的内容到末尾' : `提取【${selCfg.dimName}】的细节设定`}
                                                        </span>
                                                        {!isAppend && !isDescribe && (
                                                            <div className="flex items-center gap-2 bg-zinc-900 px-2 py-0.5 rounded border border-zinc-800">
                                                                <span className="text-[10px] text-zinc-500">该维度覆盖的创新结果的个数：</span>
                                                                <div className="flex items-center justify-center gap-1">
                                                                    <button
                                                                        onClick={e => {
                                                                            e.stopPropagation();
                                                                            onUpdateRefImageConfig?.(item.id, selCfg.imageIndex, { dimName: selCfg.dimName, overrideCount: Math.max(0, (selCfg.overrideCount ?? 0) - 1) });
                                                                        }}
                                                                        onMouseDown={e => e.stopPropagation()}
                                                                        className="w-4 h-4 rounded bg-zinc-800 text-amber-400 hover:bg-zinc-700 text-[10px] flex items-center justify-center transition-colors"
                                                                    >-</button>
                                                                    <span className="text-[10px] text-amber-300 min-w-[16px] text-center font-bold">{(selCfg.overrideCount ?? 0) === 0 ? '全' : selCfg.overrideCount}</span>
                                                                    <button
                                                                        onClick={e => {
                                                                            e.stopPropagation();
                                                                            onUpdateRefImageConfig?.(item.id, selCfg.imageIndex, { dimName: selCfg.dimName, overrideCount: (selCfg.overrideCount ?? 0) + 1 });
                                                                        }}
                                                                        onMouseDown={e => e.stopPropagation()}
                                                                        className="w-4 h-4 rounded bg-zinc-800 text-amber-400 hover:bg-zinc-700 text-[10px] flex items-center justify-center transition-colors"
                                                                    >+</button>
                                                                </div>
                                                            </div>
                                                        )}
                                                    </div>
                                                    {hasTextOverride ? (
                                                        <div className="h-8 px-2.5 bg-zinc-900/50 border border-zinc-700/30 rounded text-[10px] text-cyan-400/60 flex items-center" title="已在下方手动覆盖区设置了固定文本">
                                                            ✏️ 已设为固定文本：{item.overrideTextOverrides?.[selCfg.dimName!]?.slice(0, 30)}{(item.overrideTextOverrides?.[selCfg.dimName!]?.length || 0) > 30 ? '…' : ''}
                                                        </div>
                                                    ) : (
                                                        <>
                                                            {/* 描述模式：预设下拉菜单 */}
                                                            {isDescribe && (
                                                                <select
                                                                    value={selCfg.extractPrompt ? '__has_value__' : ''}
                                                                    onChange={e => {
                                                                        e.stopPropagation();
                                                                        const val = e.target.value;
                                                                        if (val === '__clear__') {
                                                                            onUpdateRefImageConfig?.(item.id, selCfg.imageIndex, { dimName: selCfg.dimName, extractPrompt: '' });
                                                                        } else if (val && val !== '__has_value__') {
                                                                            const preset = DEFAULT_PRESETS.find(p => p.id === val);
                                                                            if (preset) {
                                                                                onUpdateRefImageConfig?.(item.id, selCfg.imageIndex, { dimName: selCfg.dimName, extractPrompt: preset.text });
                                                                            }
                                                                        }
                                                                    }}
                                                                    className="h-6 text-[10px] bg-zinc-900 border border-zinc-700/60 rounded px-1 w-full text-zinc-400 focus:outline-none focus:border-purple-500/40 cursor-pointer"
                                                                >
                                                                    <option value="">(继承上级描述指令)</option>
                                                                    <option value="__has_value__" disabled style={{ display: 'none' }}>已自定义</option>
                                                                    {DESCRIBE_PRESET_OPTIONS.filter(opt => opt.id !== 'custom').map(opt => (
                                                                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                                                                    ))}
                                                                    <option value="__clear__">🗑 清空（用继承）</option>
                                                                </select>
                                                            )}
                                                            <input
                                                                type="text"
                                                                placeholder={isAppend ? `输入要追加的描述文本` : `输入识别提示词（告诉 AI 看什么）`}
                                                                value={isAppend ? (selCfg.extractPrompt || '') : (selCfg.extractPrompt ?? getDefaultExtractPrompt(selCfg.dimName!))}
                                                                onChange={e => { e.stopPropagation(); onUpdateRefImageConfig?.(item.id, selCfg.imageIndex, { dimName: selCfg.dimName, extractPrompt: e.target.value }); }}
                                                                onMouseDown={e => e.stopPropagation()}
                                                                onDoubleClick={e => {
                                                                    e.stopPropagation();
                                                                    setPromptModalImageIndex(selCfg.imageIndex);
                                                                }}
                                                                className="h-8 text-xs bg-zinc-900 border border-zinc-700/80 rounded px-2.5 w-full text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 shadow-inner"
                                                                title={`双击放大编辑`}
                                                            />
                                                        </>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    );
                })}
                {onAddFusionImage && (
                    <div className="min-w-[140px] flex items-stretch py-0.5">
                        <button
                            onClick={(e) => {
                                e.stopPropagation();
                                const input = document.getElementById(quickFusionInputId) as HTMLInputElement | null;
                                input?.click();
                            }}
                            onMouseDown={e => e.stopPropagation()}
                            className="w-[140px] rounded-xl border border-dashed border-zinc-600/50 bg-zinc-800/30 text-zinc-400 hover:bg-zinc-700/50 hover:text-zinc-200 hover:border-zinc-500 text-[11px] flex flex-col items-center justify-center gap-2 transition-all h-full"
                        >
                            <div className="bg-zinc-800 p-2 rounded-full"><Plus size={16} /></div>
                            添加参考图
                        </button>
                        <input
                            id={quickFusionInputId}
                            type="file"
                            className="hidden"
                            accept="image/*"
                            multiple
                            onChange={(e) => {
                                const files = Array.from(e.target.files || []).filter(f => f.type.startsWith('image/'));
                                files.forEach(file => onAddFusionImage(item.id, file));
                                e.currentTarget.value = '';
                            }}
                        />
                    </div>
                )}
            </div>
        );
    };

    return (
        <div className="min-w-0 flex flex-col gap-3 py-1 bg-zinc-900/40 px-2 rounded-lg border border-zinc-800/60">
            {/* Top Row: Describe First Switch */}
            {onToggleDescribeFirst && (item.base64Data || item.imageUrl) && (
                <div className="flex items-center gap-2 flex-wrap">
                    <div
                        className={`flex items-center gap-2 cursor-pointer w-fit select-none px-2.5 py-1.5 rounded-lg transition-all ${item.needDescribeFirst ? 'bg-amber-500/15 text-amber-400 border border-amber-500/40 shadow-sm' : 'bg-zinc-800/80 text-zinc-400 border border-zinc-700/60 hover:bg-zinc-700 hover:text-zinc-200'}`}
                        onClick={(e) => { e.stopPropagation(); onToggleDescribeFirst(item.id, !item.needDescribeFirst); }}
                    >
                        <span className="text-[11px] font-medium flex items-center gap-1.5">
                            <Sparkles size={14} className={item.needDescribeFirst ? 'text-amber-400' : 'text-zinc-500'} />
                            先用AI"详细描述全图"并作为基础上下文
                        </span>
                        <span className={`ml-3 w-7 h-4 rounded-full relative transition-colors ${item.needDescribeFirst ? 'bg-amber-500' : 'bg-zinc-600'}`}>
                            <span className={`absolute top-0.5 w-3 h-3 rounded-full bg-white transition-all shadow-sm ${item.needDescribeFirst ? 'left-[14px]' : 'left-0.5'}`} />
                        </span>
                    </div>
                    {/* 卡片级描述预设下拉菜单 - 开启时显示 */}
                    {item.needDescribeFirst && onSetDescribePresetId && (
                        <div className="flex flex-col gap-1 flex-1 min-w-0">
                            <select
                                value={item.describePresetId || ''}
                                onChange={(e) => {
                                    e.stopPropagation();
                                    const newId = e.target.value;
                                    if (newId === 'custom') {
                                        // 切换到自定义：预填当前预设内容
                                        const currentText = item.describeCustomPrompt || getDescribePromptByPresetIdLocal(item.describePresetId || '1');
                                        onSetDescribePresetId(item.id, newId);
                                        onSetDescribeCustomPrompt?.(item.id, currentText);
                                    } else {
                                        onSetDescribePresetId(item.id, newId);
                                    }
                                }}
                                className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 focus:outline-none focus:border-amber-500/50 cursor-pointer max-w-[220px]"
                            >
                                <option value="">(继承全局)</option>
                                {DESCRIBE_PRESET_OPTIONS.map(opt => (
                                    <option key={opt.id} value={opt.id}>{opt.label}</option>
                                ))}
                            </select>
                            {/* 当 describePresetId 非空时，显示可编辑的指令内容 */}
                            {item.describePresetId && onSetDescribeCustomPrompt && (
                                <textarea
                                    value={item.describePresetId === 'custom' ? (item.describeCustomPrompt || '') : getDescribePromptByPresetIdLocal(item.describePresetId)}
                                    onChange={(e) => {
                                        e.stopPropagation();
                                        const newText = e.target.value;
                                        // 编辑时自动切换到自定义模式
                                        onSetDescribePresetId(item.id, 'custom');
                                        onSetDescribeCustomPrompt(item.id, newText);
                                    }}
                                    className="w-full px-2 py-1 rounded text-[10px] leading-relaxed bg-zinc-900/80 border border-zinc-700/40 text-zinc-300 placeholder-zinc-600 focus:outline-none focus:border-amber-500/50 resize-y min-h-[36px] max-h-[100px]"
                                    rows={2}
                                    onClick={e => e.stopPropagation()}
                                    onDoubleClick={e => {
                                        e.stopPropagation();
                                        const currentVal = item.describePresetId === 'custom' ? (item.describeCustomPrompt || '') : getDescribePromptByPresetIdLocal(item.describePresetId!);
                                        setExpandedEdit({
                                            title: '卡片描述指令编辑',
                                            value: currentVal,
                                            onChange: (val) => {
                                                onSetDescribePresetId(item.id, 'custom');
                                                onSetDescribeCustomPrompt(item.id, val);
                                            },
                                        });
                                    }}
                                    title="双击放大编辑"
                                />
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Middle part: Images and Extracted Dims */}
            <div className="flex flex-col gap-1 min-w-0">
                {renderImageStrip()}
            </div>

            {/* Bottom part: Manual Override */}
            {showInlineOverridePane && renderTextOverrideRow()}
            {promptModalImageIndex !== null && activePromptCfg?.dimName && (
                <div
                    className="fixed inset-0 z-[220] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => closePromptModal(true)}
                >
                    <div
                        className="w-full max-w-2xl bg-zinc-900 border border-cyan-700/40 rounded-xl shadow-2xl overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-4 py-3 border-b border-cyan-800/30 flex items-center justify-between">
                            <div className="text-sm text-cyan-300 font-medium">
                                {activePromptCfg.dimName === QUICK_IMAGE_DESCRIBE_DIM ? '描述指令编辑' : activePromptCfg.dimName === QUICK_IMAGE_APPEND_DIM ? '追加内容编辑' : '提取指令编辑'} · 图{(promptModalImageIndex + 1)} · {activePromptCfg.dimName === QUICK_IMAGE_DESCRIBE_DIM ? '描述' : activePromptCfg.dimName === QUICK_IMAGE_APPEND_DIM ? '追加' : activePromptCfg.dimName}
                            </div>
                            <button
                                onClick={() => closePromptModal(true)}
                                className="text-zinc-400 hover:text-white transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        {/* 描述模式预设快选 */}
                        {activePromptCfg.dimName === QUICK_IMAGE_DESCRIBE_DIM && (
                            <div className="px-4 pt-3 pb-0 flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] text-zinc-500">快速填入预设:</span>
                                <select
                                    key={`preset-fill-${promptDraft.length}`}
                                    defaultValue=""
                                    onChange={(e) => {
                                        const val = e.target.value;
                                        if (val === '__clear__') {
                                            setPromptDraft('');
                                        } else if (val) {
                                            const preset = DEFAULT_PRESETS.find(p => p.id === val);
                                            if (preset) setPromptDraft(preset.text);
                                        }
                                    }}
                                    className="px-1.5 py-0.5 rounded text-[10px] bg-zinc-800/80 border border-zinc-700/50 text-zinc-300 focus:outline-none focus:border-cyan-500/50 cursor-pointer max-w-[220px]"
                                >
                                    <option value="" disabled>选择预设填入...</option>
                                    {DESCRIBE_PRESET_OPTIONS.filter(opt => opt.id !== 'custom').map(opt => (
                                        <option key={opt.id} value={opt.id}>{opt.label}</option>
                                    ))}
                                    <option value="__clear__">🗑 清空（用继承）</option>
                                </select>
                            </div>
                        )}
                        <div className="p-4">
                            <textarea
                                ref={promptTextareaRef}
                                value={promptDraft}
                                onChange={e => setPromptDraft(e.target.value)}
                                onPaste={e => e.stopPropagation()}
                                onKeyDown={e => {
                                    if (e.key === 'Escape') closePromptModal(true);
                                }}
                                className="w-full min-h-[220px] bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 leading-relaxed focus:outline-none focus:border-cyan-500/60 resize-y"
                                placeholder={activePromptCfg.dimName === QUICK_IMAGE_DESCRIBE_DIM ? '留空则使用系统默认描述指令（详细描述图片全貌）。\n如需自定义，可在此输入你的描述指令，例如：\n- 描述这张图的色调和光线\n- 详细描述图中的人物外观' : undefined}
                                autoFocus
                            />
                        </div>
                        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end">
                            <button
                                onClick={() => closePromptModal(true)}
                                className="px-4 py-1.5 text-sm rounded bg-cyan-600/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-600/30 transition-colors"
                            >
                                完成
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {/* 双击放大编辑弹窗 */}
            {expandedEdit && (
                <div
                    className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[230] p-4"
                    onClick={() => setExpandedEdit(null)}
                >
                    <div
                        className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-[640px] max-w-[95vw] shadow-2xl flex flex-col gap-3"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="flex items-center justify-between">
                            <span className="text-sm font-semibold text-zinc-200">{expandedEdit.title}</span>
                            <button
                                onClick={() => setExpandedEdit(null)}
                                className="p-1 rounded hover:bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <textarea
                            value={expandedEdit.value}
                            onChange={e => {
                                const val = e.target.value;
                                expandedEdit.onChange(val);
                                setExpandedEdit(prev => prev ? { ...prev, value: val } : null);
                            }}
                            autoFocus
                            className="w-full min-h-[300px] bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 leading-relaxed focus:outline-none focus:border-cyan-500/60 resize-y"
                            onKeyDown={e => { if (e.key === 'Escape') setExpandedEdit(null); }}
                        />
                        <div className="flex justify-end">
                            <button
                                onClick={() => setExpandedEdit(null)}
                                className="px-4 py-1.5 text-sm rounded bg-cyan-600/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-600/30 transition-colors"
                            >
                                完成
                            </button>
                        </div>
                    </div>
                </div>
            )}
            {textOverrideModal && (
                <div
                    className="fixed inset-0 z-[220] bg-black/70 backdrop-blur-sm flex items-center justify-center p-4"
                    onClick={() => closeTextOverrideModal(true)}
                >
                    <div
                        className="w-full max-w-2xl bg-zinc-900 border border-cyan-700/40 rounded-xl shadow-2xl overflow-hidden"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-4 py-3 border-b border-cyan-800/30 flex items-center justify-between">
                            <div className="text-sm text-cyan-300 font-medium">
                                {textOverrideModal.kind === 'append'
                                    ? '追加内容编辑'
                                    : `覆盖词编辑 · ${textOverrideModal.dimName || ''}`}
                            </div>
                            <button
                                onClick={() => closeTextOverrideModal(true)}
                                className="text-zinc-400 hover:text-white transition-colors"
                            >
                                <X size={16} />
                            </button>
                        </div>
                        <div className="p-4">
                            <textarea
                                ref={textOverrideTextareaRef}
                                value={textOverrideDraft}
                                onChange={e => setTextOverrideDraft(e.target.value)}
                                onPaste={e => e.stopPropagation()}
                                onKeyDown={e => {
                                    if (e.key === 'Escape') closeTextOverrideModal(true);
                                }}
                                className="w-full min-h-[220px] bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 leading-relaxed focus:outline-none focus:border-cyan-500/60 resize-y"
                                autoFocus
                            />
                        </div>
                        <div className="px-4 py-3 border-t border-zinc-800 flex justify-end">
                            <button
                                onClick={() => closeTextOverrideModal(true)}
                                className="px-4 py-1.5 text-sm rounded bg-cyan-600/20 border border-cyan-500/40 text-cyan-300 hover:bg-cyan-600/30 transition-colors"
                            >
                                完成
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

interface CustomPromptPanelProps {
    item: ImageItem;
    presets?: Preset[];
    onUpdateCustomPrompt?: (id: string, value: string) => void;
    onApplyPreset?: (id: string, text: string) => void;
    onToggleMergeMode?: (id: string, merge: boolean) => void;
    globalUserPrompt?: string; // 全局用户特殊要求
    baseInstruction?: string; // 基础指令
    // 卡片级参考图选择
    overrideDimsWithImages?: Array<{ dimName: string; imageLibrary: RefImage[] }>;
    onUpdateCardRefSelection?: (cardId: string, dimName: string, refImageId: string | null) => void;
    // 卡片级覆盖个数
    overrideDimNames?: string[]; // 所有开启了覆盖的维度名
    globalOverrideCounts?: Record<string, number>; // 全局覆盖个数
    onUpdateCardOverrideCount?: (cardId: string, dimName: string, count: number | null) => void;
    // 卡片级文字覆盖
    onUpdateCardTextOverride?: (cardId: string, dimName: string, value: string | null) => void;
    // 卡片级参考图配置
    allEnabledDimNames?: string[];
    onUpdateRefImageConfig?: (cardId: string, imageIndex: number, update: Partial<import('../types').RefImageConfig> | null) => void;
    onRemoveFusionImage?: (imageId: string, fusionImageId: string) => void;
    onAddFusionImage?: (imageId: string, file: File) => void;
    onStartInnovation?: (id: string) => void;
    workMode?: WorkMode;
}

const CustomPromptPanel = ({ item, presets, onUpdateCustomPrompt, onApplyPreset, onToggleMergeMode, overrideDimsWithImages, onUpdateCardRefSelection, workMode, globalUserPrompt, baseInstruction }: CustomPromptPanelProps) => {
    const [showPreview, setShowPreview] = useState(false);
    if (item.status !== 'idle') return null;

    const isMergeMode = item.mergeWithGlobalPrompt ?? true; // 默认为合并模式

    // 有多张参考图的维度
    const dimsWithImages = overrideDimsWithImages?.filter(d => d.imageLibrary.length > 1) || [];
    const isQuickMode = workMode === 'quick';

    return (
        <div className="border-t border-zinc-700/50 bg-zinc-900/50 p-2" onClick={(e) => e.stopPropagation()}>
            {isQuickMode && dimsWithImages.length > 0 && (
                <div className="flex flex-wrap items-center gap-1.5 mb-1.5 pb-1.5 border-b border-zinc-700/30">
                    <span className="text-[9px] text-blue-400 shrink-0">📷 参考图:</span>
                    {dimsWithImages.map(dim => {
                        const selectedRefId = item.overrideRefSelections?.[dim.dimName] || '';
                        return (
                            <select
                                key={dim.dimName}
                                value={selectedRefId}
                                onChange={(e) => {
                                    e.stopPropagation();
                                    onUpdateCardRefSelection?.(item.id, dim.dimName, e.target.value || null);
                                }}
                                onClick={(e) => e.stopPropagation()}
                                onMouseDown={(e) => e.stopPropagation()}
                                className="px-1.5 py-0.5 bg-zinc-800 border border-zinc-700/50 rounded text-[10px] text-zinc-300 focus:outline-none focus:border-blue-500/50"
                                title={`选择"${dim.dimName}"维度使用哪张参考图`}
                            >
                                <option value="">{dim.dimName}: 默认(图1)</option>
                                {dim.imageLibrary.map((refImg, refIdx) => (
                                    <option key={refImg.id} value={refImg.id}>
                                        {dim.dimName}: 图{refIdx + 1}{refImg.label ? ` ${refImg.label}` : ''}
                                    </option>
                                ))}
                            </select>
                        );
                    })}
                </div>
            )}
            <div className="mt-1.5 pt-1.5 border-t border-zinc-700/30">
                <div className="text-[10px] text-zinc-400 mb-1">📝 单任务追加要求</div>
                <div className="flex items-center gap-2">
                    <input
                        type="text"
                        value={item.customPrompt || ''}
                        onChange={(e) => onUpdateCustomPrompt?.(item.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        placeholder={isMergeMode ? "单任务追加要求（将与全局合并）" : "单任务追加要求（独立模式）"}
                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-blue-500"
                    />
                    {/* 合并模式开关 */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            onToggleMergeMode?.(item.id, !isMergeMode);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className={`flex items-center gap-1 px-2 py-1 rounded text-[0.625rem] transition-colors tooltip-bottom ${isMergeMode
                            ? 'bg-purple-600/30 text-purple-300 border border-purple-500/50'
                            : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:border-zinc-600'
                            }`}
                        data-tip={isMergeMode ? "合并模式：全局指令 + 单任务追加要求" : "独立模式：单任务追加要求替代全局指令，全局追加要求仍保留"}
                    >
                        {isMergeMode ? '🔗 合并' : '📝 独立'}
                    </button>
                    {/* 预览按钮 */}
                    <button
                        onClick={(e) => {
                            e.stopPropagation();
                            setShowPreview(true);
                        }}
                        onMouseDown={(e) => e.stopPropagation()}
                        className="flex items-center gap-1 px-2 py-1 rounded text-[0.625rem] bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-zinc-600 hover:text-zinc-300 transition-colors tooltip-bottom"
                        data-tip="预览该卡片最终指令"
                    >
                        <Eye size={12} />
                    </button>
                    {presets && presets.length > 0 && (
                        <select
                            className="bg-zinc-800 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 cursor-pointer"
                            onChange={(e) => {
                                if (e.target.value) {
                                    onApplyPreset?.(item.id, e.target.value);
                                    // 重置为默认选项
                                    e.target.value = '';
                                }
                            }}
                            onClick={(e) => e.stopPropagation()}
                            onMouseDown={(e) => e.stopPropagation()}
                            defaultValue=""
                        >
                            <option value="">预设</option>
                            {presets.map((p, index) => (
                                <option key={`${p.id}-${index}`} value={p.text}>{p.name}</option>
                            ))}
                        </select>
                    )}
                </div>
                {item.customPrompt && (
                    <div className={`text-[0.625rem] mt-1 ${isMergeMode ? 'text-purple-400' : 'text-blue-400'}`}>
                        {isMergeMode ? '🔗 全局指令 + 单任务追加要求 合并运行' : '✓ 单任务追加要求替代全局，全局追加仍保留'}
                    </div>
                )}
            </div>

            {/* 预览弹窗 */}
            {showPreview && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={() => setShowPreview(false)}>
                    <div className="w-full max-w-2xl max-h-[80vh] p-5 bg-zinc-800 rounded-xl border border-zinc-700 shadow-2xl overflow-hidden flex flex-col" onClick={(e) => e.stopPropagation()}>
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Eye size={18} className="text-purple-400" />
                                该图片最终指令预览
                            </h3>
                            <button
                                onClick={() => setShowPreview(false)}
                                className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg transition-colors"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto space-y-3 custom-scrollbar">
                            {/* 基础指令 */}
                            {baseInstruction && (
                                <div className="p-3 rounded-lg border-l-4 border-blue-500 bg-blue-900/20">
                                    <div className="text-xs text-blue-400 mb-1 font-medium">基础指令</div>
                                    <span className="text-blue-300 whitespace-pre-wrap text-sm">{baseInstruction}</span>
                                </div>
                            )}

                            {/* 用户特殊要求 */}
                            {(globalUserPrompt || item.customPrompt) && (
                                <div className="p-3 rounded-lg border-l-4 border-green-500 bg-green-900/20">
                                    <div className="text-xs text-green-400 mb-1 font-medium">【用户特别要求】</div>
                                    <div className="text-green-300 whitespace-pre-wrap text-sm space-y-2">
                                        {globalUserPrompt && (
                                            <div>
                                                <span className="text-green-500 text-xs">全局追加要求：</span>
                                                <span>{globalUserPrompt}</span>
                                            </div>
                                        )}
                                        {item.customPrompt && (
                                            <div>
                                                <span className="text-emerald-500 text-xs">单任务追加要求：</span>
                                                <span>{item.customPrompt}</span>
                                            </div>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 说明 */}
                            <div className="p-3 rounded-lg bg-zinc-900/50 border border-zinc-700">
                                <div className="text-xs text-zinc-400">
                                    <p className="mb-1">💡 <strong>实际发送时还会包含：</strong></p>
                                    <ul className="list-disc list-inside text-zinc-500 space-y-0.5">
                                        <li>图片内容（AI识别原图）</li>
                                        <li>随机库组合（如果开启）</li>
                                        <li>优先级说明</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

// 使用 React.memo 优化
const MemoizedCustomPromptPanel = memo(CustomPromptPanel);

interface InnovationChatBlockProps {
    imageId: string;
    innovation: InnovationItem;
    onSend?: (imageId: string, innovationId: string) => void;
    onUpdateInput?: (imageId: string, innovationId: string, value: string) => void;
    onCopyHistory?: (imageId: string, innovationId: string) => void;
    onUpdateAttachments?: (imageId: string, innovationId: string, attachments: string[]) => void;
}

const InnovationChatBlock = ({
    imageId,
    innovation,
    onSend,
    onUpdateInput,
    onCopyHistory,
    onUpdateAttachments
}: InnovationChatBlockProps) => {
    const [localInput, setLocalInput] = useState(innovation.chatInput || '');
    const fileInputRef = useRef<HTMLInputElement>(null);
    const chatRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    useEffect(() => {
        setLocalInput(innovation.chatInput || '');
    }, [innovation.chatInput, innovation.id]);

    useEffect(() => {
        if (chatRef.current) {
            chatRef.current.scrollTop = chatRef.current.scrollHeight;
        }
    }, [innovation.chatHistory.length, innovation.isChatLoading]);

    const pushAttachments = async (files: File[]) => {
        if (!files || files.length === 0) return;
        const current = innovation.chatAttachments || [];
        const newOnes: string[] = [];
        for (const f of files) {
            try {
                const base64 = await convertBlobToBase64(f);
                newOnes.push(`data:${f.type};base64,${base64}`);
            } catch (err) {
                console.error('Failed to process attachment', err);
            }
        }
        if (newOnes.length > 0) {
            onUpdateAttachments?.(imageId, innovation.id, [...current, ...newOnes]);
        }
    };

    const handlePaste = async (e: React.ClipboardEvent) => {
        const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;
        e.preventDefault();
        await pushAttachments(files);
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        await pushAttachments(files);
        e.target.value = '';
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;
        await pushAttachments(files);
    };

    const removeAttachment = (idx: number) => {
        const next = (innovation.chatAttachments || []).filter((_, i) => i !== idx);
        onUpdateAttachments?.(imageId, innovation.id, next);
    };

    const handleSend = () => {
        if (localInput.trim() || (innovation.chatAttachments && innovation.chatAttachments.length > 0)) {
            onSend?.(imageId, innovation.id);
            setLocalInput('');
        }
    };

    return (
        <div className="mt-2 border border-cyan-900/30 rounded-lg bg-cyan-950/20">
            <div className="flex items-center justify-between px-2.5 py-1.5 text-[0.6875rem] text-cyan-100 border-b border-cyan-900/40">
                <span className="flex items-center gap-1">对话</span>
                <div className="flex items-center gap-1">
                    {innovation.chatHistory.length > 0 && (
                        <button
                            onClick={() => onCopyHistory?.(imageId, innovation.id)}
                            className="p-1 text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800 rounded transition-colors tooltip-bottom"
                            data-tip="复制对话记录"
                        >
                            <Copy size={11} />
                        </button>
                    )}
                    {innovation.isChatLoading && <Loader2 size={12} className="animate-spin text-emerald-400" />}
                </div>
            </div>

            <div
                ref={chatRef}
                className="max-h-44 overflow-y-auto custom-scrollbar px-3 py-2 space-y-2"
            >
                {innovation.chatHistory.length === 0 ? (
                    <div className="text-[0.6875rem] text-zinc-500 text-center py-2">暂无对话，输入内容开始交流</div>
                ) : (
                    innovation.chatHistory.map(msg => (
                        <div
                            key={msg.id}
                            className={`text-[0.6875rem] p-2 rounded-lg ${msg.role === 'user'
                                ? 'bg-cyan-900/30 text-cyan-100 ml-6'
                                : 'bg-zinc-800 text-zinc-200 mr-6'
                                }`}
                        >
                            <div className="text-[0.625rem] text-zinc-500 mb-1">{msg.role === 'user' ? '你' : 'AI'}</div>
                            {msg.images && msg.images.length > 0 && (
                                <div className="flex gap-1 mb-1 flex-wrap">
                                    {msg.images.map((img, idx) => (
                                        <img key={idx} src={img} alt="attachment" className="w-12 h-12 object-cover rounded border border-zinc-700" />
                                    ))}
                                </div>
                            )}
                            <div className="whitespace-pre-wrap break-words leading-relaxed">{msg.text}</div>
                        </div>
                    ))
                )}
                {innovation.isChatLoading && (
                    <div className="flex items-center gap-2 text-[0.6875rem] text-emerald-400">
                        <Loader2 size={12} className="animate-spin" />
                        AI 正在思考...
                    </div>
                )}
            </div>

            {innovation.chatAttachments && innovation.chatAttachments.length > 0 && (
                <div className="px-3 pb-2 flex gap-2 overflow-x-auto custom-scrollbar">
                    {innovation.chatAttachments.map((att, idx) => (
                        <div key={idx} className="relative group w-14 h-14 shrink-0">
                            <img src={att} alt={`attachment-${idx}`} className="w-full h-full object-cover rounded border border-zinc-700" />
                            <button
                                onClick={() => removeAttachment(idx)}
                                className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity tooltip-bottom"
                                data-tip="删除图片"
                            >
                                <X size={8} />
                            </button>
                        </div>
                    ))}
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="w-14 h-14 shrink-0 rounded border border-zinc-700 bg-zinc-800 hover:bg-zinc-700 flex items-center justify-center text-zinc-400 transition-colors tooltip-bottom"
                        data-tip="添加图片"
                    >
                        <Plus size={16} />
                    </button>
                </div>
            )}

            <div
                className="border-t border-cyan-900/30 bg-zinc-900/60 p-2 relative"
                onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(true); }}
                onDragLeave={(e) => { e.preventDefault(); e.stopPropagation(); setIsDragging(false); }}
                onDrop={handleDrop}
            >
                {isDragging && (
                    <div className="absolute inset-1 z-20 border-2 border-dashed border-emerald-500/60 rounded-lg bg-emerald-900/30 flex items-center justify-center text-[0.6875rem] font-bold text-emerald-200 pointer-events-none">
                        松开添加图片
                    </div>
                )}
                <input
                    type="file"
                    ref={fileInputRef}
                    className="hidden"
                    accept="image/*"
                    multiple
                    onChange={handleFileChange}
                />
                <div className="flex gap-2 items-start">
                    <button
                        onClick={() => fileInputRef.current?.click()}
                        className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg border border-zinc-700 transition-colors shrink-0 tooltip-bottom"
                        data-tip="上传参考图"
                    >
                        <Paperclip size={14} />
                    </button>
                    <textarea
                        value={localInput}
                        onChange={(e) => {
                            setLocalInput(e.target.value);
                            onUpdateInput?.(imageId, innovation.id, e.target.value);
                        }}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter' && !e.shiftKey) {
                                e.preventDefault();
                                handleSend();
                            }
                        }}
                        onPaste={handlePaste}
                        className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg px-3 py-2 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 resize-none h-16 custom-scrollbar"
                        placeholder="针对该创新词继续对话，支持粘贴/拖拽图片..."
                        disabled={innovation.isChatLoading}
                    />
                    <button
                        onClick={handleSend}
                        disabled={(!localInput.trim() && (!innovation.chatAttachments || innovation.chatAttachments.length === 0)) || innovation.isChatLoading}
                        className="p-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50 disabled:bg-zinc-700 transition-colors shrink-0"
                    >
                        <Send size={14} />
                    </button>
                </div>
            </div>
        </div>
    );
};

// 使用 React.memo 优化：每个创新项独立渲染
const MemoizedInnovationChatBlock = memo(InnovationChatBlock);

// --- InnovationPanel Component ---
interface InnovationPanelProps {
    item: ImageItem;
    onToggleInnovation?: (id: string) => void;
    onStartInnovation?: (id: string) => void;
    onCopyInnovation?: (id: string) => void;
    isCompact?: boolean; // 紧凑模式，隐藏标题文字
    onToggleMinimize?: (id: string) => void; // 精简模式切换
    isMinimized?: boolean;
    globalInnovationInstruction?: string;
    defaultInnovationInstruction?: string;
    onUpdateCustomInnovationInstruction?: (imageId: string, value: string) => void;
    onUpdateCustomInnovationCount?: (imageId: string, count: number) => void;
    onUpdateCustomInnovationRounds?: (imageId: string, rounds: number) => void;
    onUpdateCustomInnovationTemplateId?: (imageId: string, templateId: string) => void;
    templateState?: { savedTemplates: Array<{ id: string; name: string; sections: any[]; values: Record<string, string> }> };
    unifiedPresets?: SimplePreset[];
    onToggleInnovationChat?: (imageId: string, innovationId: string) => void;
    onSendInnovationMessage?: (imageId: string, innovationId: string) => void;
    onUpdateInnovationInput?: (imageId: string, innovationId: string, value: string) => void;
    onCopyInnovationChatHistory?: (imageId: string, innovationId: string) => void;
    onUpdateInnovationAttachments?: (imageId: string, innovationId: string, attachments: string[]) => void;
}

const InnovationPanel = ({
    item,
    onToggleInnovation,
    onStartInnovation,
    onCopyInnovation,
    isCompact,
    onToggleMinimize,
    isMinimized,
    globalInnovationInstruction,
    defaultInnovationInstruction,
    onUpdateCustomInnovationInstruction,
    onUpdateCustomInnovationCount,
    onUpdateCustomInnovationRounds,
    onUpdateCustomInnovationTemplateId,
    templateState,
    unifiedPresets = [],
    onToggleInnovationChat,
    onSendInnovationMessage,
    onUpdateInnovationInput,
    onCopyInnovationChatHistory,
    onUpdateInnovationAttachments
}: InnovationPanelProps) => {
    const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
    const [copiedAll, setCopiedAll] = useState<'outputs' | 'all' | null>(null);
    const [showSettingsModal, setShowSettingsModal] = useState(false);

    if (!item.isInnovationOpen) return null;

    const innovationItems = getInnovationItemsForRender(item);
    const outputs = getInnovationOutputs(item);
    const hasOutputs = outputs.length > 0;

    const copyOutput = (output: string, index: number) => {
        navigator.clipboard.writeText(output);
        setCopiedIndex(index);
        setTimeout(() => setCopiedIndex(null), 2000);
    };

    // 仅复制创新结果
    const copyOnlyOutputs = () => {
        if (outputs.length === 0) return;
        navigator.clipboard.writeText(outputs.join('\n\n'));
        setCopiedAll('outputs');
        setTimeout(() => setCopiedAll(null), 2000);
    };

    // 复制原始词 + 创新结果
    const copyAllWithSource = () => {
        if (outputs.length === 0) return;
        const text = `原始提示词：\n${item.result || ''}\n\n创新结果：\n${outputs.join('\n\n')}`;
        navigator.clipboard.writeText(text);
        setCopiedAll('all');
        setTimeout(() => setCopiedAll(null), 2000);
    };

    return (
        <div className="flex-1 flex flex-col border-l border-cyan-900/30 bg-zinc-950/80 min-w-0 min-h-0">
            {/* 创新标题栏 */}
            <div className={`flex items-center justify-between border-b border-cyan-900/30 bg-cyan-950/30 ${isCompact ? 'px-1.5 py-1' : 'px-3 py-2'}`}>
                <span className="text-xs text-cyan-400 font-medium flex items-center gap-1">
                    <Sparkles size={isCompact ? 10 : 12} />
                    {!isCompact && '提示词创新'}
                </span>
                <div className={`flex items-center ${isCompact ? 'gap-0.5 flex-1 justify-end' : 'gap-1'}`}>
                    {hasOutputs && (
                        <>
                            {/* 仅复制创新结果 */}
                            <button
                                onClick={copyOnlyOutputs}
                                className={`text-zinc-500 hover:text-emerald-400 hover:bg-zinc-700 rounded transition-colors tooltip-bottom ${isCompact ? 'p-0.5' : 'p-1'}`}
                                data-tip="仅复制创新结果"
                            >
                                {copiedAll === 'outputs' ? <Check size={isCompact ? 10 : 14} className="text-emerald-400" /> : <Copy size={isCompact ? 10 : 14} />}
                            </button>
                            {/* 复制原始词+创新结果 */}
                            <button
                                onClick={copyAllWithSource}
                                className={`text-zinc-500 hover:text-cyan-400 hover:bg-zinc-700 rounded transition-colors flex items-center gap-0.5 tooltip-bottom ${isCompact ? 'p-0.5' : 'p-1'}`}
                                data-tip="复制原始词 + 创新结果"
                            >
                                {copiedAll === 'all' ? <Check size={isCompact ? 10 : 14} className="text-cyan-400" /> : (
                                    <>
                                        <FileCode size={isCompact ? 8 : 12} />
                                        <Copy size={isCompact ? 8 : 12} />
                                    </>
                                )}
                            </button>
                        </>
                    )}
                    {onToggleMinimize && (
                        <button
                            onClick={() => {
                                // 点击精简按钮：设置精简模式为true + 关闭创新面板
                                if (!isMinimized) {
                                    onToggleMinimize(item.id);
                                }
                                onToggleInnovation?.(item.id);
                            }}
                            className={`text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded transition-colors tooltip-bottom ${isCompact ? 'p-0.5' : 'p-1'}`}
                            data-tip="精简显示 (只看最后结果)"
                        >
                            <ChevronUp size={isCompact ? 12 : 14} />
                        </button>
                    )}
                    <button
                        onClick={() => onToggleInnovation?.(item.id)}
                        className={`text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded transition-colors tooltip-bottom ${isCompact ? 'p-0.5' : 'p-1'}`}
                        data-tip="关闭创新面板"
                    >
                        <X size={isCompact ? 12 : 14} />
                    </button>
                </div>
            </div>

            {/* 创新内容 */}
            <div className="flex-1 overflow-y-auto custom-scrollbar p-3 space-y-3 min-h-0">
                {/* 原始识别结果展示 */}
                {item.result && (
                    <div className="p-2.5 bg-zinc-800/30 rounded-lg border border-zinc-700/30">
                        <div className="text-[0.625rem] text-zinc-500 mb-1.5 font-medium">原始识别结果：</div>
                        <div className="text-xs text-zinc-300 leading-relaxed line-clamp-3 tooltip-bottom" data-tip={item.result}>
                            {item.result}
                        </div>
                    </div>
                )}

                {/* 设置按钮 & 弹窗 */}
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => setShowSettingsModal(true)}
                        className="flex items-center gap-1.5 px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs border border-zinc-700 transition-colors"
                    >
                        <Settings size={12} />
                        创新设置
                    </button>
                    {item.customInnovationInstruction && (
                        <span className="text-[0.625rem] text-cyan-400">✓ 已设置自定义指令</span>
                    )}
                </div>

                {/* 设置弹窗 */}
                {showSettingsModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm" onClick={() => setShowSettingsModal(false)}>
                        <div
                            className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl w-full max-w-lg mx-4 max-h-[80vh] overflow-auto"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
                                <h3 className="text-sm font-semibold text-cyan-200 flex items-center gap-2">
                                    <Sparkles size={14} />
                                    创新设置
                                </h3>
                                <button
                                    onClick={() => setShowSettingsModal(false)}
                                    className="p-1 hover:bg-zinc-800 rounded text-zinc-400 hover:text-zinc-200 transition-colors"
                                >
                                    <X size={16} />
                                </button>
                            </div>
                            <div className="p-4 space-y-4">
                                {/* 自定义创新要求 */}
                                <div className="space-y-2">
                                    <label className="text-xs font-medium text-zinc-300">自定义创新要求 (留空则使用全局设置)</label>
                                    <textarea
                                        value={item.customInnovationInstruction || ''}
                                        onChange={(e) => onUpdateCustomInnovationInstruction?.(item.id, e.target.value)}
                                        className="w-full bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 px-3 py-2 resize-none min-h-[80px] focus:outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/30 placeholder-zinc-600"
                                        placeholder={globalInnovationInstruction || '全局要求: (空)'}
                                    />
                                </div>

                                {/* 指令模板 */}
                                <div className="flex items-center gap-2">
                                    <label className="text-xs font-medium text-zinc-400 whitespace-nowrap">指令模板:</label>
                                    <select
                                        value={item.customInnovationTemplateId || ''}
                                        onChange={(e) => onUpdateCustomInnovationTemplateId?.(item.id, e.target.value)}
                                        className="flex-1 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 px-2 py-1.5 focus:outline-none focus:border-cyan-500"
                                    >
                                        <option value="">跟随全局</option>
                                        <option value="__system_default__">系统默认</option>
                                        {/* 指令模版 */}
                                        {templateState?.savedTemplates && templateState.savedTemplates.length > 0 && (
                                            <optgroup label="创新指令">
                                                {templateState.savedTemplates.map(t => (
                                                    <option key={t.id} value={t.id}>{t.name}</option>
                                                ))}
                                            </optgroup>
                                        )}
                                        {/* AI图片识别预设 */}
                                        {unifiedPresets.filter(p => p.source === 'recognition').length > 0 && (
                                            <optgroup label="识别指令">
                                                {unifiedPresets.filter(p => p.source === 'recognition').map(p => (
                                                    <option key={p.id} value={`rec:${p.id}`}>{p.name}</option>
                                                ))}
                                            </optgroup>
                                        )}
                                    </select>
                                </div>

                                {/* 每轮个数 和 轮数 */}
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-medium text-zinc-400 whitespace-nowrap">每轮个数:</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="50"
                                            value={item.customInnovationCount || 3}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value) || 3;
                                                onUpdateCustomInnovationCount?.(item.id, Math.min(50, Math.max(1, val)));
                                            }}
                                            className="w-16 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 px-2 py-1.5 text-center focus:outline-none focus:border-cyan-500"
                                        />
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <label className="text-xs font-medium text-zinc-400 whitespace-nowrap">轮数:</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="10"
                                            value={item.customInnovationRounds || 1}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value) || 1;
                                                onUpdateCustomInnovationRounds?.(item.id, Math.min(10, Math.max(1, val)));
                                            }}
                                            className="w-16 bg-zinc-950 border border-zinc-800 rounded-lg text-xs text-zinc-200 px-2 py-1.5 text-center focus:outline-none focus:border-cyan-500"
                                        />
                                    </div>
                                </div>

                                {/* 底部按钮 */}
                                <div className="flex justify-end gap-2 pt-2 border-t border-zinc-800">
                                    <button
                                        onClick={() => setShowSettingsModal(false)}
                                        className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-xs transition-colors"
                                    >
                                        关闭
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}


                {item.isInnovating ? (
                    <div className="flex items-center gap-2 text-xs text-cyan-400 p-4 justify-center">
                        <Loader2 size={14} className="animate-spin" />
                        正在创新提示词...
                    </div>
                ) : hasOutputs ? (
                    <div className="space-y-2">
                        <div className="text-[0.625rem] text-cyan-400/80 font-medium">创新变体：</div>
                        {innovationItems.map((inv, idx) => (
                            <div
                                key={inv.id}
                                className="relative p-2.5 bg-zinc-800/50 rounded-lg border border-zinc-700/50 hover:border-cyan-700/30 transition-colors overflow-hidden space-y-2"
                            >
                                <div className="flex items-start justify-between gap-2">
                                    <div className="text-sm text-zinc-200 whitespace-pre-wrap break-words pr-2">{inv.text}</div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => copyOutput(inv.text, idx)}
                                            className="p-1 text-zinc-500 hover:text-emerald-400 rounded transition-colors tooltip-bottom"
                                            data-tip="复制创新词"
                                        >
                                            {copiedIndex === idx ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                        </button>
                                        {onToggleInnovationChat && (
                                            <button
                                                onClick={() => onToggleInnovationChat(item.id, inv.id)}
                                                className={`p-1 rounded transition-colors tooltip-bottom ${inv.isChatOpen
                                                    ? 'text-blue-300 bg-blue-500/20 ring-1 ring-blue-500/40'
                                                    : (inv.chatHistory && inv.chatHistory.length > 0
                                                        ? 'text-blue-300 bg-blue-900/20'
                                                        : 'text-blue-300 hover:bg-zinc-800')
                                                    }`}
                                                data-tip={inv.chatHistory && inv.chatHistory.length > 0 ? '继续对话' : '打开对话'}
                                            >
                                                <MessageCircle size={12} />
                                            </button>
                                        )}
                                        {inv.chatHistory && inv.chatHistory.length > 0 && onCopyInnovationChatHistory && (
                                            <button
                                                onClick={() => onCopyInnovationChatHistory(item.id, inv.id)}
                                                className="p-1 text-zinc-500 hover:text-emerald-400 rounded transition-colors tooltip-bottom"
                                                data-tip="复制对话记录"
                                            >
                                                <Copy size={12} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                                {inv.chatHistory && inv.chatHistory.length > 0 && (
                                    <div className="text-[0.625rem] text-zinc-500">
                                        对话 {inv.chatHistory.length} 条
                                    </div>
                                )}
                                {inv.isChatOpen && (
                                    <MemoizedInnovationChatBlock
                                        imageId={item.id}
                                        innovation={inv}
                                        onSend={onSendInnovationMessage}
                                        onUpdateInput={onUpdateInnovationInput}
                                        onCopyHistory={onCopyInnovationChatHistory}
                                        onUpdateAttachments={onUpdateInnovationAttachments}
                                    />
                                )}
                            </div>
                        ))}
                    </div>
                ) : item.innovationError ? (
                    <div className="text-xs text-red-400 p-4 text-center">
                        <AlertCircle size={20} className="mx-auto mb-2" />
                        <p className="mb-3">创新失败: {item.innovationError}</p>
                        <button
                            onClick={() => onStartInnovation?.(item.id)}
                            className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 mx-auto"
                        >
                            <RotateCw size={14} />
                            重试创新
                        </button>
                    </div>
                ) : (
                    <div className="text-xs text-zinc-500 italic text-center py-4">
                        {item.status === 'success' && item.result ? (
                            <>
                                <p className="mb-3">点击下方按钮对识别结果进行创新</p>
                                <button
                                    onClick={() => onStartInnovation?.(item.id)}
                                    className="px-4 py-2 bg-cyan-600 hover:bg-cyan-500 text-white rounded-lg text-sm font-medium transition-colors flex items-center gap-2 mx-auto"
                                >
                                    <Sparkles size={14} />
                                    开始创新
                                </button>
                            </>
                        ) : (
                            <p>请先完成图片识别后再进行创新</p>
                        )}
                    </div>
                )}
            </div>

            {/* 底部操作栏 */}
            {hasOutputs && (
                <div className={`border-t border-cyan-900/30 bg-cyan-950/20 ${isCompact ? 'p-1.5' : 'p-3'}`}>
                    <div className={`flex ${isCompact ? 'gap-1' : 'gap-2'}`}>
                        <button
                            onClick={() => onStartInnovation?.(item.id)}
                            disabled={item.isInnovating}
                            className={`flex-1 bg-cyan-600 hover:bg-cyan-500 disabled:bg-zinc-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center ${isCompact ? 'px-2 py-1 text-[0.625rem] gap-1' : 'px-3 py-2 text-xs gap-1.5'}`}
                        >
                            <RotateCw size={isCompact ? 10 : 12} />
                            {isCompact ? '重新' : '重新创新'}
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
};

// --- ResultsGrid Component ---
const ResultsGrid: React.FC<ResultsGridProps> = ({
    images,
    onRemove,
    onRetry,
    copyMode,
    viewMode,
    sentToDescIds,
    onToggleChat,
    onSendMessage,
    onUpdateChatInput,
    onCopyChatHistory,
    onUpdateChatAttachments,
    presets,
    onUpdateCustomPrompt,
    onApplyPreset,
    onToggleMergeMode,
    onToggleInnovation,
    onStartInnovation,
    onCopyInnovation,
    onSendToDesc,
    globalInnovationInstruction,
    defaultInnovationInstruction,
    onUpdateCustomInnovationInstruction,
    onUpdateCustomInnovationCount,
    onUpdateCustomInnovationRounds,
    onUpdateCustomInnovationTemplateId,
    templateState,
    unifiedPresets = [],
    onToggleInnovationChat,
    onSendInnovationMessage,
    onUpdateInnovationInput,
    onCopyInnovationChatHistory,
    onUpdateInnovationAttachments,
    onTranslate,
    onSaveTranslation,
    onSaveSelection,
    workMode = 'standard',
    creativeResults = [],
    onAddFusionImage,
    onRemoveFusionImage,
    selectedCardId,
    onSelectCard,
    globalUserPrompt,
    baseInstruction,
    splitElements,
    overrideDimsWithImages,
    onUpdateCardRefSelection,
    overrideDimNames,
    globalOverrideCounts,
    globalOverrideModes,
    onUpdateCardOverrideCount,
    onUpdateCardTextOverride,
    allEnabledDimNames,
    onUpdateRefImageConfig,
    onToggleCardDimBinding,
    onToggleDescribeFirst,
    onSetDescribePresetId,
    onSetDescribeCustomPrompt
}) => {
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [copiedAction, setCopiedAction] = useState<'image' | 'link' | 'formula' | 'result' | 'result-zh' | 'result-en' | null>(null);
    // 侧边栏宽度状态 - 分别存储不同视图的宽度
    const [sidebarWidths, setSidebarWidths] = useState<{ grid: number; list: number }>({
        grid: 80,
        list: 80
    });
    const [panelHeights, setPanelHeights] = useState<Record<string, number>>({});
    const [cardWidths, setCardWidths] = useState<Record<string, number>>({}); // 网格视图卡片宽度
    const [isResizing, setIsResizing] = useState(false);
    const [minimizedChats, setMinimizedChats] = useState<Record<string, boolean>>({});
    // 对话面板和创新面板之间的宽度比例（对话面板占右侧空间的百分比）
    const [chatPanelRatio, setChatPanelRatio] = useState<Record<string, number>>({});
    // 展开结果的模态框状态
    const [expandedResultItem, setExpandedResultItem] = useState<ImageItem | null>(null);
    // 快捷模式：放大编辑卡片状态
    const [expandedEditCardId, setExpandedEditCardId] = useState<string | null>(null);
    // AI 对话记录弹窗状态
    const [conversationLogItem, setConversationLogItem] = useState<ImageItem | null>(null);
    // 图片放大预览弹窗状态
    const [expandedImage, setExpandedImage] = useState<{ url: string; title?: string } | null>(null);
    const expandedEditCard = expandedEditCardId ? (images.find(img => img.id === expandedEditCardId) || null) : null;
    const expandedEditCardCreativeResult = expandedEditCard
        ? creativeResults.find(r => r.imageId === expandedEditCard.id)
        : undefined;

    const isInteractiveTarget = (target: EventTarget | null): boolean => {
        const el = target as HTMLElement | null;
        if (!el) return false;
        return !!el.closest(
            'button, input, textarea, select, option, a, [role="button"], [contenteditable="true"], [data-prevent-card-select]'
        );
    };

    const openImagePreview = (item: ImageItem, e?: React.MouseEvent) => {
        if (e) {
            e.preventDefault();
            e.stopPropagation();
        }
        if (!item.imageUrl) return;
        setExpandedImage({ url: item.imageUrl, title: item.originalInput });
    };

    useEffect(() => {
        if (!expandedEditCardId) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setExpandedEditCardId(null);
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [expandedEditCardId]);

    const expandedCardEditorModal = (workMode === 'quick' && expandedEditCard) ? (
        <div
            className="fixed inset-0 z-[140] bg-black/75 backdrop-blur-sm flex items-center justify-center p-4"
            onClick={() => setExpandedEditCardId(null)}
        >
            <div
                className="w-full max-w-[96vw] h-[88vh] bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl flex flex-col overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                <div className="px-5 py-3 border-b border-zinc-700 flex items-start justify-between gap-3 bg-zinc-900/95">
                    <div className="min-w-0">
                        <h3 className="text-sm font-semibold text-zinc-100">放大编辑卡片</h3>
                        <p className="text-[11px] text-zinc-500 truncate mt-0.5" title={expandedEditCard.originalInput}>
                            {expandedEditCard.originalInput || '当前卡片'}
                        </p>
                    </div>
                    <div className="flex items-center gap-1.5 flex-wrap justify-end">
                        {(expandedEditCard.status === 'idle' && onStartInnovation) && (
                            <button
                                onClick={() => onStartInnovation(expandedEditCard.id)}
                                className="p-1.5 text-emerald-400 hover:text-emerald-300 hover:bg-emerald-500/20 rounded transition-colors tooltip-bottom"
                                data-tip="开始单卡创新"
                            >
                                <Play size={12} />
                            </button>
                        )}
                        {expandedEditCard.status === 'error' && (
                            <button
                                onClick={() => onRetry(expandedEditCard.id)}
                                className="p-1.5 text-red-400 hover:text-red-300 hover:bg-red-500/20 rounded transition-colors tooltip-bottom"
                                data-tip="重试"
                            >
                                <RotateCw size={12} />
                            </button>
                        )}
                        <button
                            onClick={() => copyImage(expandedEditCard)}
                            disabled={!expandedEditCard.imageUrl}
                            className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed tooltip-bottom ${(copiedId === expandedEditCard.id && copiedAction === 'image')
                                ? 'text-emerald-400 bg-emerald-900/20'
                                : 'text-zinc-500 hover:text-purple-400 hover:bg-zinc-800'
                                }`}
                            data-tip={expandedEditCard.imageUrl ? '复制图片到剪贴板' : '无图片'}
                        >
                            {(copiedId === expandedEditCard.id && copiedAction === 'image') ? <Check size={12} /> : <ImageIcon size={12} />}
                        </button>
                        <button
                            onClick={() => copyLink(expandedEditCard)}
                            disabled={!canCopyLink(expandedEditCard)}
                            className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${expandedEditCard.isUploadingToGyazo
                                ? 'text-blue-400 animate-pulse'
                                : (copiedId === expandedEditCard.id && copiedAction === 'link')
                                    ? 'text-emerald-400 bg-emerald-900/20'
                                    : 'text-zinc-500 hover:text-blue-400 hover:bg-zinc-800'
                                }`}
                            data-tip={getLinkTitle(expandedEditCard)}
                        >
                            {expandedEditCard.isUploadingToGyazo ? <Loader2 size={12} className="animate-spin" /> : ((copiedId === expandedEditCard.id && copiedAction === 'link') ? <Check size={12} /> : <Link size={12} />)}
                        </button>
                        <button
                            onClick={() => copyFormula(expandedEditCard)}
                            disabled={!canCopyFormula(expandedEditCard)}
                            className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed tooltip-bottom ${(copiedId === expandedEditCard.id && copiedAction === 'formula')
                                ? 'text-emerald-400 bg-emerald-900/20'
                                : 'text-zinc-500 hover:text-orange-400 hover:bg-zinc-800'
                                }`}
                            data-tip={getFormulaTitle(expandedEditCard)}
                        >
                            {(copiedId === expandedEditCard.id && copiedAction === 'formula') ? <Check size={12} /> : <FileCode size={12} />}
                        </button>
                        <button
                            onClick={() => copyCreativeResult(expandedEditCard)}
                            disabled={!expandedEditCardCreativeResult || expandedEditCardCreativeResult.status !== 'success'}
                            className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed tooltip-bottom ${(copiedId === expandedEditCard.id && copiedAction === 'result')
                                ? 'text-emerald-400 bg-emerald-900/20'
                                : 'text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800'
                                }`}
                            data-tip="复制所有创新结果"
                        >
                            {(copiedId === expandedEditCard.id && copiedAction === 'result') ? <Check size={12} /> : <Copy size={12} />}
                        </button>
                        {(expandedEditCard.status === 'success') && (
                            <button
                                onClick={() => onRetry(expandedEditCard.id)}
                                className="p-1.5 text-zinc-500 hover:text-emerald-400 transition-colors rounded hover:bg-zinc-800 tooltip-bottom"
                                data-tip="重新创新"
                            >
                                <RotateCw size={12} />
                            </button>
                        )}
                        <button
                            onClick={() => onRemove(expandedEditCard.id)}
                            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors tooltip-bottom"
                            data-tip="删除卡片"
                        >
                            <Trash2 size={12} />
                        </button>
                        <button
                            onClick={() => setExpandedEditCardId(null)}
                            className="p-1.5 rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 transition-colors"
                            title="关闭"
                        >
                            <X size={16} />
                        </button>
                    </div>
                </div>
                <div className="flex-1 min-h-0 p-4 grid grid-cols-1 xl:grid-cols-[2fr_1fr] gap-4 overflow-hidden">
                    <div className="min-h-0 overflow-y-auto custom-scrollbar pr-1">
                        <QuickInlineImageManager
                            item={expandedEditCard}
                            allEnabledDimNames={allEnabledDimNames}
                            globalOverrideCounts={globalOverrideCounts}
                            globalOverrideModes={globalOverrideModes}
                            onUpdateCardOverrideCount={onUpdateCardOverrideCount}
                            onUpdateCardTextOverride={onUpdateCardTextOverride}
                            onUpdateCustomPrompt={onUpdateCustomPrompt}
                            onUpdateRefImageConfig={onUpdateRefImageConfig}
                            onRemoveFusionImage={onRemoveFusionImage}
                            onAddFusionImage={onAddFusionImage}
                            onToggleDescribeFirst={onToggleDescribeFirst}
                            onSetDescribePresetId={onSetDescribePresetId}
                            onSetDescribeCustomPrompt={onSetDescribeCustomPrompt}
                        />
                    </div>
                    <div className="min-h-0 overflow-y-auto custom-scrollbar bg-zinc-950/60 border border-zinc-800 rounded-xl p-3">
                        <div className="text-xs text-purple-300 mb-2">创新结果预览</div>
                        <CreativeResultDisplay result={expandedEditCardCreativeResult} />
                    </div>
                </div>
            </div>
        </div>
    ) : null;

    // 获取当前视图模式下的侧边栏宽度 (默认为grid或者list的宽度，Compact模式用不到但给个默认值)
    const currentSidebarWidth = viewMode === 'list' ? sidebarWidths.list : sidebarWidths.grid;

    const toggleMinimize = (id: string) => {
        setMinimizedChats(prev => ({ ...prev, [id]: !prev[id] }));
    };

    // Vertical Resize Handler (Height)
    const startResizingHeight = (e: React.MouseEvent, itemId: string) => {
        e.preventDefault();
        setIsResizing(true);
        const startY = e.clientY;

        // 获取实际渲染的高度
        const containerElement = document.getElementById(`card-container-${itemId}`);
        const currentHeight = containerElement?.offsetHeight || (minimizedChats[itemId] ? 60 : 360);
        const startHeight = panelHeights[itemId] || currentHeight;

        // 关键修复：如果是第一次拖拽，先把当前高度设置到 state，避免 CSS 模式切换导致的跳变
        if (!panelHeights[itemId]) {
            setPanelHeights(prev => ({ ...prev, [itemId]: currentHeight }));
        }

        const onMouseMove = (moveEvent: MouseEvent) => {
            const deltaY = moveEvent.clientY - startY;
            const newHeight = Math.max(60, startHeight + deltaY); // Minimum height 60px
            setPanelHeights(prev => ({ ...prev, [itemId]: newHeight }));
        };

        const onMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    };

    // Card Width Resize Handler (for Grid view)
    const startResizingCardWidth = (e: React.MouseEvent, itemId: string, cardElement: HTMLElement | null) => {
        e.preventDefault();
        setIsResizing(true);
        const startX = e.clientX;
        const currentWidth = cardElement?.offsetWidth || 400;
        const startWidth = cardWidths[itemId] || currentWidth;

        // 关键修复：如果是第一次拖拽，先把当前宽度设置到 state，避免 CSS 模式切换导致的跳变
        if (!cardWidths[itemId]) {
            setCardWidths(prev => ({ ...prev, [itemId]: currentWidth }));
        }

        const onMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const newWidth = Math.max(280, startWidth + deltaX); // Minimum width 280px
            setCardWidths(prev => ({ ...prev, [itemId]: newWidth }));
        };

        const onMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    // Sidebar Resize Handler
    const startResizing = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        const startX = e.clientX;
        const startWidth = currentSidebarWidth;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            // 限制最小宽度为 75px，最大宽度为 400px
            const newWidth = Math.max(75, Math.min(400, startWidth + delta));

            setSidebarWidths(prev => ({
                ...prev,
                [viewMode === 'list' ? 'list' : 'grid']: newWidth
            }));
        };

        const onMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    // 对话面板和创新面板之间的分隔条拖拽处理
    const startResizingPanels = (e: React.MouseEvent, itemId: string, containerRef: HTMLDivElement | null) => {
        if (!containerRef) return;
        e.preventDefault();
        setIsResizing(true);
        const startX = e.clientX;
        const containerRect = containerRef.getBoundingClientRect();
        const containerWidth = containerRect.width - currentSidebarWidth; // 右侧可用空间
        const startRatio = chatPanelRatio[itemId] ?? 50; // 默认 50%

        const onMouseMove = (moveEvent: MouseEvent) => {
            const deltaX = moveEvent.clientX - startX;
            const deltaPercent = (deltaX / containerWidth) * 100;
            // 限制比例在 20% - 80% 之间
            const newRatio = Math.max(20, Math.min(80, startRatio + deltaPercent));
            setChatPanelRatio(prev => ({ ...prev, [itemId]: newRatio }));
        };

        const onMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
    };

    // 显示复制成功状态
    function showCopied(id: string, action: 'image' | 'link' | 'formula' | 'result' | 'result-zh' | 'result-en') {
        setCopiedId(id);
        setCopiedAction(action);
        setTimeout(() => { setCopiedId(null); setCopiedAction(null); }, 2000);
    }

    // 复制图片文件到剪贴板
    async function copyImage(item: ImageItem) {
        if (!item.imageUrl) {
            alert('无图片可复制');
            return;
        }

        try {
            // 获取图片
            const response = await fetch(item.imageUrl);
            const originalBlob = await response.blob();

            // 转换为 PNG 格式（更好的浏览器兼容性）
            const img = new Image();
            img.crossOrigin = 'anonymous';

            await new Promise<void>((resolve, reject) => {
                img.onload = () => resolve();
                img.onerror = () => reject(new Error('图片加载失败'));
                img.src = item.imageUrl;
            });

            const canvas = document.createElement('canvas');
            canvas.width = img.naturalWidth;
            canvas.height = img.naturalHeight;
            const ctx = canvas.getContext('2d');
            ctx?.drawImage(img, 0, 0);

            const pngBlob = await new Promise<Blob>((resolve, reject) => {
                canvas.toBlob(blob => {
                    if (blob) resolve(blob);
                    else reject(new Error('转换PNG失败'));
                }, 'image/png');
            });

            // 尝试使用 ClipboardItem API
            if (typeof ClipboardItem !== 'undefined' && navigator.clipboard.write) {
                await navigator.clipboard.write([
                    new ClipboardItem({
                        'image/png': pngBlob
                    })
                ]);
                showCopied(item.id, 'image');
            } else {
                // 浏览器不支持
                throw new Error('浏览器不支持复制图片');
            }
        } catch (error: any) {
            console.error('复制图片失败:', error);

            // 提供备用方案：复制链接
            const link = item.gyazoUrl || item.fetchUrl;
            if (link) {
                await navigator.clipboard.writeText(link);
                showCopied(item.id, 'link');
                alert('无法直接复制图片，已复制图片链接到剪贴板。');
            } else {
                alert(`复制图片失败: ${error.message || '未知错误'}\n\n请尝试复制链接或公式。`);
            }
        }
    }

    // 复制纯链接
    async function copyLink(item: ImageItem) {
        const link = getLink(item);
        if (!link) return;
        await navigator.clipboard.writeText(link);
        showCopied(item.id, 'link');
    }

    // 获取链接（用于判断是否可复制）
    function getLink(item: ImageItem): string {
        if (item.gyazoUrl) return item.gyazoUrl;
        if (item.fetchUrl) return item.fetchUrl;
        const formulaMatch = item.originalInput.match(/=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i);
        if (formulaMatch) return formulaMatch[1];
        return '';
    }

    // 是否可以复制链接
    function canCopyLink(item: ImageItem): boolean {
        return !item.isUploadingToGyazo && !!getLink(item);
    }

    // 复制公式（=IMAGE("url")格式）
    async function copyFormula(item: ImageItem) {
        const formula = getFormula(item);
        if (!formula) return;
        await navigator.clipboard.writeText(formula);
        showCopied(item.id, 'formula');
    }

    // 获取公式（用于判断是否可复制）
    function getFormula(item: ImageItem): string {
        if (item.originalInput.startsWith('=IMAGE')) return item.originalInput;
        if (item.gyazoUrl) return `=IMAGE("${item.gyazoUrl}")`;
        if (item.fetchUrl) return `=IMAGE("${item.fetchUrl}")`;
        return '';
    }

    // 是否可以复制公式
    function canCopyFormula(item: ImageItem): boolean {
        return !item.isUploadingToGyazo && !!getFormula(item);
    }

    // 获取链接的提示信息
    function getLinkTitle(item: ImageItem): string {
        if (item.isUploadingToGyazo) return '正在上传到 Gyazo...';
        if (item.gyazoUrl) return `复制 Gyazo 链接`;
        if (item.fetchUrl) return '复制图片链接';
        if (item.sourceType === 'file') return '未上传，暂无链接';
        return '无链接';
    }

    // 获取公式的提示信息
    function getFormulaTitle(item: ImageItem): string {
        if (item.isUploadingToGyazo) return '正在上传到 Gyazo...';
        if (canCopyFormula(item)) return '复制公式 =IMAGE(...)';
        if (item.sourceType === 'file') return '未上传，暂无公式';
        return '无公式';
    }

    // 复制识别结果
    function copyResult(item: ImageItem) {
        if (!item.result) return;
        navigator.clipboard.writeText(item.result);
        showCopied(item.id, 'result');
    }

    // 复制创新结果（创新模式专用）
    function copyCreativeResult(item: ImageItem) {
        const result = creativeResults.find(r => r.imageId === item.id);
        if (!result || result.status !== 'success' || result.innovations.length === 0) return;

        // 格式化创新结果：每个变体一行
        const text = result.innovations.map((inno, idx) =>
            `${idx + 1}. ${inno.textZh || inno.textEn}`
        ).join('\n\n');

        navigator.clipboard.writeText(text);
        showCopied(item.id, 'result');
    }

    // 判断当前复制的是什么
    function isCopied(id: string, action: 'image' | 'link' | 'formula' | 'result' | 'result-zh' | 'result-en') {
        return copiedId === id && copiedAction === action;
    }

    // 复制拆分结果（单张，按语言）
    const copySplitResultLang = (item: ImageItem, lang: 'zh' | 'en') => {
        if (!item.result) return;
        const lines = item.result.split('\n').filter(l => l.includes('|||'));
        const parts: string[] = [];
        for (const line of lines) {
            const segs = line.split('|||');
            const name = segs[0]?.trim().replace(/^\d+\.\s*/, '');
            if (segs.length >= 3) {
                parts.push(`${name}: ${lang === 'zh' ? segs[1].trim() : segs[2].trim()}`);
            } else if (segs.length === 2) {
                parts.push(`${name}: ${segs[1].trim()}`);
            }
        }
        navigator.clipboard.writeText(parts.join('\n'));
        showCopied(item.id, lang === 'zh' ? 'result-zh' : 'result-en');
    };

    if (images.length === 0) return null;

    // 创建隐藏的 file input refs (用于添加融合图片)
    const fusionInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

    // 处理添加融合图片
    const handleFusionFileSelect = (imageId: string, files: FileList | null) => {
        if (!files || files.length === 0 || !onAddFusionImage) return;
        Array.from(files).forEach(file => {
            if (file.type.startsWith('image/')) {
                onAddFusionImage(imageId, file);
            }
        });
    };

    // 处理拖拽添加融合图片
    const handleFusionDrop = (imageId: string, e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (!onAddFusionImage) return;
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        files.forEach(file => onAddFusionImage(imageId, file));
    };

    const ImageThumbnail = ({ item }: { item: ImageItem }) => (
        <>
            {item.status === 'error' && !item.imageUrl ? (
                <div className="flex flex-col items-center justify-center h-full text-red-400 gap-2 p-4 text-center bg-zinc-950/50">
                    <AlertCircle size={24} />
                    <span className="text-[0.625rem]">加载失败</span>
                </div>
            ) : (
                <div
                    className="w-full h-full relative"
                    onDragOver={(e) => { e.preventDefault(); }}
                    onDrop={(e) => handleFusionDrop(item.id, e)}
                >
                    {/* 主图 / 空卡占位 */}
                    {item.imageUrl ? (
                        <img
                            src={item.imageUrl}
                            alt="Preview"
                            className={`w-full h-full object-contain cursor-zoom-in ${item.fusionImages && item.fusionImages.length > 0 ? 'border-2 border-cyan-500/50 rounded' : ''}`}
                            onClick={(e) => openImagePreview(item, e)}
                            onError={(e) => {
                                (e.target as HTMLImageElement).style.display = 'none';
                            }}
                        />
                    ) : (
                        <div className="w-full h-full flex flex-col items-center justify-center text-zinc-500 bg-zinc-950/40 border border-dashed border-zinc-700/60 rounded">
                            <Plus size={18} />
                            <span className="text-[0.625rem] mt-1">空卡片，点击 + 添加图片</span>
                        </div>
                    )}

                    {/* 融合图片缩略图（右下角叠加）— 当有参考图提取配置区时隐藏 */}
                    {item.fusionImages && item.fusionImages.length > 0 && workMode !== 'quick' && (
                        <div className="absolute bottom-8 right-1 flex flex-row-reverse gap-0.5">
                            {item.fusionImages.slice(0, 3).map((fImg, idx) => (
                                <div
                                    key={fImg.id}
                                    className="relative group/fusion"
                                    style={{ zIndex: 10 - idx }}
                                >
                                    <img
                                        src={fImg.imageUrl}
                                        alt={`Fusion ${idx + 1}`}
                                        className="w-8 h-8 object-cover rounded border border-cyan-500/70 shadow-lg"
                                    />
                                    {/* 删除按钮 */}
                                    {onRemoveFusionImage && (
                                        <button
                                            onClick={(e) => { e.stopPropagation(); onRemoveFusionImage(item.id, fImg.id); }}
                                            className="absolute -top-1 -right-1 w-3.5 h-3.5 bg-red-500 hover:bg-red-400 text-white rounded-full flex items-center justify-center opacity-0 group-hover/fusion:opacity-100 transition-opacity"
                                        >
                                            <X size={8} />
                                        </button>
                                    )}
                                </div>
                            ))}
                            {item.fusionImages.length > 3 && (
                                <div className="w-8 h-8 bg-zinc-800 rounded border border-zinc-600 flex items-center justify-center text-[0.5rem] text-zinc-400">
                                    +{item.fusionImages.length - 3}
                                </div>
                            )}
                        </div>
                    )}

                    {/* 创新模式下显示"+"按钮 */}
                    {(workMode === 'creative' || workMode === 'quick') && onAddFusionImage && (
                        <>
                            <input
                                type="file"
                                ref={(el) => { fusionInputRefs.current[item.id] = el; }}
                                className="hidden"
                                accept="image/*"
                                multiple
                                onChange={(e) => handleFusionFileSelect(item.id, e.target.files)}
                            />
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    fusionInputRefs.current[item.id]?.click();
                                }}
                                className="absolute top-2 left-2 w-6 h-6 bg-cyan-500/80 hover:bg-cyan-400 text-white rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity shadow-lg tooltip-bottom"
                                data-tip="添加图片"
                            >
                                <Plus size={14} />
                            </button>
                        </>
                    )}
                </div>
            )}

            {/* Type Badge */}
            <div className="absolute bottom-1 left-1 bg-black/70 backdrop-blur-sm text-zinc-300 text-[0.5625rem] px-1.5 py-0.5 rounded-md uppercase font-bold tracking-wider flex items-center gap-1">
                {item.sourceType === 'file' ? <FileImage size={9} /> : <ExternalLink size={9} />}
                {item.sourceType === 'file' ? '文件' : (item.sourceType === 'formula' ? '公式' : '链接')}
                {/* 融合图片数量标识 — 有参考图提取配置区时隐藏 */}
                {item.fusionImages && item.fusionImages.length > 0 && workMode !== 'quick' && (
                    <span className="ml-1 px-1 py-0.5 bg-cyan-500/40 text-cyan-200 rounded text-[0.5rem]">
                        +{item.fusionImages.length}
                    </span>
                )}
            </div>

            {/* 卡片维度绑定标签 — 独立于全局覆盖 */}
            {allEnabledDimNames && allEnabledDimNames.length > 0 && item.imageUrl && onToggleCardDimBinding && (
                <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-black/80 via-black/50 to-transparent pt-5 pb-1 px-1">
                    <div className="flex flex-wrap gap-0.5 justify-center">
                        {allEnabledDimNames.map(dimName => {
                            const isBound = item.overrideRefSelections?.[dimName] === '__self__';
                            return (
                                <button
                                    key={dimName}
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        onToggleCardDimBinding(item.id, dimName);
                                    }}
                                    className={`px-1 py-px rounded text-[7px] leading-tight border transition-all ${isBound
                                        ? 'bg-purple-700/70 text-purple-100 border-purple-500/60'
                                        : 'bg-black/40 text-zinc-500 border-zinc-700/40 hover:text-zinc-300 hover:border-zinc-500'
                                        }`}
                                    title={isBound ? `取消从此图提取「${dimName}」` : `从此图提取「${dimName}」`}
                                >
                                    {isBound ? '✓' : ''}{dimName}
                                </button>
                            );
                        })}
                    </div>
                </div>
            )}
        </>
    );


    // --- COMPACT VIEW ---
    if (viewMode === 'compact') {
        return (
            <>
                {/* 结果放大模态框 */}
                <ResultExpandModal item={expandedResultItem} onClose={() => setExpandedResultItem(null)} onTranslate={onTranslate} onSaveTranslation={onSaveTranslation} onSaveSelection={onSaveSelection} workMode={workMode} creativeResult={expandedResultItem ? creativeResults.find(r => r.imageId === expandedResultItem.id) : undefined} />
                {/* AI 对话记录弹窗 */}
                <ConversationLogModal item={conversationLogItem} onClose={() => setConversationLogItem(null)} />
                {/* 图片放大预览弹窗 */}
                <ImagePreviewModal imageUrl={expandedImage?.url || null} title={expandedImage?.title} onClose={() => setExpandedImage(null)} />
                {/* 卡片放大编辑弹窗 */}
                {expandedCardEditorModal}

                <div
                    className="flex flex-col gap-1.5 pb-20"
                    onClick={(e) => {
                        if (workMode !== 'creative' || !onSelectCard) return;
                        const target = e.target as HTMLElement;
                        if (target.closest('[data-image-card]')) return;
                        onSelectCard(null);
                    }}
                >
                    {images.map((item) => (
                        <div
                            key={item.id}
                            data-image-card
                            className={`group flex flex-row h-14 bg-zinc-900/80 border rounded-lg transition-all ${item.status === 'error' ? 'border-red-900/40 bg-red-950/20' : item.status === 'success' ? 'border-emerald-900/30' : 'border-zinc-800 hover:border-zinc-600'}`}
                        >
                            {/* Compact Thumbnail */}
                            <div className="w-14 h-14 bg-zinc-950 relative flex-shrink-0 border-r border-zinc-800/50 flex items-center justify-center overflow-hidden">
                                {item.status === 'error' && !item.imageUrl ? (
                                    <div className="flex items-center justify-center h-full text-red-400">
                                        <AlertCircle size={16} />
                                    </div>
                                ) : (
                                    <img
                                        src={item.imageUrl}
                                        alt="Preview"
                                        className="w-full h-full object-contain p-1 cursor-zoom-in"
                                        onClick={(e) => openImagePreview(item, e)}
                                        onError={(e) => {
                                            (e.target as HTMLImageElement).style.display = 'none';
                                        }}
                                    />
                                )}
                            </div>

                            {/* Content - Compact Layout */}
                            <div className="flex-1 flex items-center gap-3 px-3 min-w-0">
                                {/* Status Icon */}
                                <div className="flex-shrink-0">
                                    {item.status === 'idle' && (
                                        <div className="w-5 h-5 rounded-full bg-zinc-800 flex items-center justify-center tooltip-bottom" data-tip="等待处理">
                                            <div className="w-2 h-2 rounded-full bg-zinc-600" />
                                        </div>
                                    )}
                                    {item.status === 'loading' && (
                                        <span className="tooltip-bottom" data-tip="AI 识别中">
                                            <Loader2 size={16} className="animate-spin text-emerald-400" />
                                        </span>
                                    )}
                                    {item.status === 'success' && (
                                        <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center tooltip-bottom" data-tip="识别成功">
                                            <div className="w-2 h-2 rounded-full bg-emerald-400" />
                                        </div>
                                    )}
                                    {item.status === 'error' && (
                                        <span className="tooltip-bottom" data-tip="处理出错">
                                            <AlertCircle size={16} className="text-red-400" />
                                        </span>
                                    )}
                                </div>

                                {/* Result or Status Text */}
                                <div className="flex-1 min-w-0">
                                    {item.status === 'success' ? (
                                        <div className="text-sm text-zinc-200 truncate tooltip-bottom" data-tip={item.result}>
                                            {item.result}
                                        </div>
                                    ) : item.status === 'error' ? (
                                        <div className="text-xs text-red-400 truncate tooltip-bottom" data-tip={item.errorMsg}>
                                            {item.errorMsg || '处理失败'}
                                        </div>
                                    ) : item.status === 'loading' ? (
                                        <div className="text-xs text-emerald-400">分析中...</div>
                                    ) : (
                                        <div className="text-xs text-zinc-500 truncate tooltip-bottom" data-tip={item.originalInput}>
                                            {item.originalInput}
                                        </div>
                                    )}
                                </div>
                            </div>

                            {/* Compact Actions - 始终可见 */}
                            <div className="flex items-center gap-0.5 px-1.5 flex-shrink-0">
                                {(item.status === 'idle' && (workMode === 'creative' || workMode === 'quick') && onStartInnovation) ? (
                                    <button
                                        onClick={() => onStartInnovation(item.id)}
                                        className="p-1 text-emerald-400 hover:text-white hover:bg-emerald-500/20 rounded transition-colors tooltip-bottom"
                                        data-tip="开始单卡创新"
                                    >
                                        <Play size={12} />
                                    </button>
                                ) : item.status === 'error' ? (
                                    <button
                                        onClick={() => onRetry(item.id)}
                                        className="p-1 text-red-400 hover:text-white hover:bg-red-500/20 rounded transition-colors tooltip-bottom"
                                        data-tip="重试"
                                    >
                                        <RotateCw size={12} />
                                    </button>
                                ) : (
                                    <>
                                        {/* 复制按钮组 */}
                                        <button
                                            onClick={() => copyImage(item)}
                                            disabled={!item.imageUrl}
                                            className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed tooltip-bottom ${isCopied(item.id, 'image')
                                                ? 'text-emerald-400 bg-emerald-900/20'
                                                : 'text-zinc-500 hover:text-purple-400 hover:bg-zinc-800'
                                                }`}
                                            data-tip={item.imageUrl ? '复制图片到剪贴板' : '无图片'}
                                        >
                                            {isCopied(item.id, 'image') ? <Check size={12} /> : <ImageIcon size={12} />}
                                        </button>
                                        <button
                                            onClick={() => copyLink(item)}
                                            disabled={!canCopyLink(item)}
                                            className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${item.isUploadingToGyazo
                                                ? 'text-blue-400 animate-pulse'
                                                : isCopied(item.id, 'link')
                                                    ? 'text-emerald-400 bg-emerald-900/20'
                                                    : 'text-zinc-500 hover:text-blue-400 hover:bg-zinc-800'
                                                }`}
                                            data-tip={getLinkTitle(item)}
                                        >
                                            {item.isUploadingToGyazo ? <Loader2 size={12} className="animate-spin" /> : (isCopied(item.id, 'link') ? <Check size={12} /> : <Link size={12} />)}
                                        </button>
                                        <button
                                            onClick={() => copyFormula(item)}
                                            disabled={!canCopyFormula(item)}
                                            className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isCopied(item.id, 'formula')
                                                ? 'text-emerald-400 bg-emerald-900/20'
                                                : 'text-zinc-500 hover:text-orange-400 hover:bg-zinc-800'
                                                }`}
                                            data-tip={getFormulaTitle(item)}
                                        >
                                            {isCopied(item.id, 'formula') ? <Check size={12} /> : <FileCode size={12} />}
                                        </button>
                                        {item.status === 'success' && (
                                            <>
                                                {workMode === 'split' ? (
                                                    <>
                                                        <button
                                                            onClick={() => copySplitResultLang(item, 'zh')}
                                                            className={`p-1 rounded transition-colors tooltip-bottom text-[9px] font-bold ${isCopied(item.id, 'result-zh')
                                                                ? 'text-emerald-400 bg-emerald-900/20'
                                                                : 'text-zinc-500 hover:text-orange-400 hover:bg-zinc-800'
                                                                }`}
                                                            data-tip="复制中文描述"
                                                        >
                                                            {isCopied(item.id, 'result-zh') ? <Check size={12} /> : <span>中</span>}
                                                        </button>
                                                        <button
                                                            onClick={() => copySplitResultLang(item, 'en')}
                                                            className={`p-1 rounded transition-colors tooltip-bottom text-[9px] font-bold ${isCopied(item.id, 'result-en')
                                                                ? 'text-emerald-400 bg-emerald-900/20'
                                                                : 'text-zinc-500 hover:text-blue-400 hover:bg-zinc-800'
                                                                }`}
                                                            data-tip="复制英文描述"
                                                        >
                                                            {isCopied(item.id, 'result-en') ? <Check size={12} /> : <span>EN</span>}
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        onClick={() => copyResult(item)}
                                                        className={`p-1 rounded transition-colors tooltip-bottom ${isCopied(item.id, 'result')
                                                            ? 'text-emerald-400 bg-emerald-900/20'
                                                            : 'text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800'
                                                            }`}
                                                        data-tip="复制结果"
                                                    >
                                                        {isCopied(item.id, 'result') ? <Check size={12} /> : <Copy size={12} />}
                                                    </button>
                                                )}
                                                {workMode !== 'split' && onSendToDesc && (
                                                    <button
                                                        onClick={() => onSendToDesc(item.id)}
                                                        className={`p-1 rounded transition-colors tooltip-bottom ${sentToDescIds?.includes(item.id)
                                                            ? 'text-emerald-300 bg-emerald-700/20 border border-emerald-500/40'
                                                            : 'text-blue-300 hover:text-white hover:bg-blue-500/30'
                                                            }`}
                                                        data-tip={sentToDescIds?.includes(item.id) ? '已发送' : '发送到提示词创新'}
                                                    >
                                                        {sentToDescIds?.includes(item.id) ? <Check size={12} /> : <Share2 size={12} />}
                                                    </button>
                                                )}
                                                {onToggleChat && (
                                                    <button
                                                        onClick={() => onToggleChat(item.id)}
                                                        className={`p-1 rounded transition-colors tooltip-bottom ${item.isChatOpen
                                                            ? 'text-blue-400 bg-blue-500/30 ring-2 ring-blue-400/50'
                                                            : (item.chatHistory.length > 1
                                                                ? 'text-blue-400 bg-blue-900/20'
                                                                : 'text-blue-400 hover:bg-zinc-800')
                                                            }`}
                                                        data-tip={item.chatHistory.length > 1 ? "继续对话 (已有记录)" : "继续对话"}
                                                    >
                                                        <MessageCircle size={12} fill={item.chatHistory.length > 1 ? "currentColor" : "none"} fillOpacity={item.chatHistory.length > 1 ? 0.2 : 0} />
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => onRetry(item.id)}
                                                    className="p-1 text-zinc-600 hover:text-emerald-400 hover:bg-zinc-800 rounded transition-colors tooltip-bottom"
                                                    data-tip="重新识别"
                                                >
                                                    <RotateCw size={12} />
                                                </button>
                                            </>
                                        )}
                                    </>
                                )}
                                {workMode === 'quick' && (
                                    <button
                                        onClick={() => setExpandedEditCardId(item.id)}
                                        className="p-1 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/20 rounded transition-colors tooltip-bottom"
                                        data-tip="放大编辑卡片"
                                    >
                                        <Maximize2 size={12} />
                                    </button>
                                )}
                                {/* AI 对话记录按钮 */}
                                {item.aiConversationLog && item.aiConversationLog.length > 0 && (
                                    <button
                                        onClick={() => setConversationLogItem(item)}
                                        className="p-1 text-amber-500/70 hover:text-amber-400 hover:bg-amber-500/10 rounded transition-colors tooltip-bottom"
                                        data-tip={`AI 对话记录 (${item.aiConversationLog.length})`}
                                    >
                                        <Eye size={12} />
                                    </button>
                                )}
                                <button
                                    onClick={() => onRemove(item.id)}
                                    className="p-1 text-zinc-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors tooltip-bottom"
                                    data-tip="删除"
                                >
                                    <Trash2 size={12} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            </>
        );
    }

    // --- LIST VIEW ---
    if (viewMode === 'list') {
        return (
            <>
                {/* 结果放大模态框 */}
                <ResultExpandModal item={expandedResultItem} onClose={() => setExpandedResultItem(null)} onTranslate={onTranslate} onSaveTranslation={onSaveTranslation} onSaveSelection={onSaveSelection} workMode={workMode} creativeResult={expandedResultItem ? creativeResults.find(r => r.imageId === expandedResultItem.id) : undefined} />
                {/* AI 对话记录弹窗 */}
                <ConversationLogModal item={conversationLogItem} onClose={() => setConversationLogItem(null)} />
                {/* 图片放大预览弹窗 */}
                <ImagePreviewModal imageUrl={expandedImage?.url || null} title={expandedImage?.title} onClose={() => setExpandedImage(null)} />
                {/* 卡片放大编辑弹窗 */}
                {expandedCardEditorModal}

                <div
                    className="flex flex-col gap-3 pb-20"
                    onClick={(e) => {
                        if (workMode !== 'creative' || !onSelectCard) return;
                        const target = e.target as HTMLElement;
                        if (target.closest('[data-image-card]')) return;
                        onSelectCard(null);
                    }}
                >
                    {images.map((item) => {
                        const isItemMinimized = !!minimizedChats[item.id] && !item.isChatOpen;
                        const hasInnovationOutputs = getInnovationOutputs(item).length > 0;

                        // 精简模式：单行紧凑显示（类似compact view）
                        if (isItemMinimized) {
                            return (
                                <div
                                    key={item.id}
                                    data-image-card
                                    className={`group flex flex-row h-14 bg-zinc-900/80 border rounded-lg transition-all ${item.status === 'error' ? 'border-red-900/40 bg-red-950/20' : item.status === 'success' ? 'border-emerald-900/30' : 'border-zinc-800 hover:border-zinc-600'}`}
                                >
                                    {/* Compact Thumbnail */}
                                    <div className="w-14 h-14 bg-zinc-950 relative flex-shrink-0 border-r border-zinc-800/50 flex items-center justify-center overflow-hidden">
                                        {item.status === 'error' && !item.imageUrl ? (
                                            <div className="flex items-center justify-center h-full text-red-400">
                                                <AlertCircle size={16} />
                                            </div>
                                        ) : (
                                            <img
                                                src={item.imageUrl}
                                                alt="Preview"
                                                className="w-full h-full object-contain p-1 cursor-zoom-in"
                                                onClick={(e) => openImagePreview(item, e)}
                                                onError={(e) => {
                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                }}
                                            />
                                        )}
                                    </div>

                                    {/* Content - Compact Layout */}
                                    <div className="flex-1 flex items-center gap-3 px-3 min-w-0">
                                        {/* Status Icon */}
                                        <div className="flex-shrink-0">
                                            {item.status === 'success' && (
                                                <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center tooltip-bottom" data-tip="识别成功">
                                                    <div className="w-2 h-2 rounded-full bg-emerald-400" />
                                                </div>
                                            )}
                                        </div>

                                        {/* Result Text (last message) */}
                                        <div className="flex-1 min-w-0">
                                            {item.chatHistory.length > 0 ? (
                                                <div className="text-sm text-zinc-200 truncate tooltip-bottom" data-tip={item.chatHistory[item.chatHistory.length - 1].text}>
                                                    {item.chatHistory[item.chatHistory.length - 1].text}
                                                </div>
                                            ) : item.result ? (
                                                <div className="text-sm text-zinc-200 truncate tooltip-bottom" data-tip={item.result}>
                                                    {item.result}
                                                </div>
                                            ) : (
                                                <div className="text-xs text-zinc-500 truncate tooltip-bottom" data-tip={item.originalInput}>
                                                    {item.originalInput}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                    {/* Compact Actions */}
                                    <div className="flex items-center gap-0.5 px-1.5 flex-shrink-0">
                                        {/* 展开按钮 */}
                                        <button
                                            onClick={() => {
                                                // 取消精简模式并打开对话面板
                                                toggleMinimize(item.id);
                                                onToggleChat?.(item.id);
                                            }}
                                            className="p-1 text-blue-400 hover:text-blue-300 hover:bg-zinc-800 rounded transition-colors tooltip-bottom"
                                            data-tip="展开对话"
                                        >
                                            <ChevronDown size={12} />
                                        </button>
                                        {/* 复制按钮组 */}
                                        <button
                                            onClick={() => copyImage(item)}
                                            disabled={!item.imageUrl}
                                            className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed tooltip-bottom ${isCopied(item.id, 'image')
                                                ? 'text-emerald-400 bg-emerald-900/20'
                                                : 'text-zinc-500 hover:text-purple-400 hover:bg-zinc-800'
                                                }`}
                                            data-tip={item.imageUrl ? '复制图片到剪贴板' : '无图片'}
                                        >
                                            {isCopied(item.id, 'image') ? <Check size={12} /> : <ImageIcon size={12} />}
                                        </button>
                                        <button
                                            onClick={() => copyLink(item)}
                                            disabled={!canCopyLink(item)}
                                            className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${item.isUploadingToGyazo
                                                ? 'text-blue-400 animate-pulse'
                                                : isCopied(item.id, 'link')
                                                    ? 'text-emerald-400 bg-emerald-900/20'
                                                    : 'text-zinc-500 hover:text-blue-400 hover:bg-zinc-800'
                                                }`}
                                            data-tip={getLinkTitle(item)}
                                        >
                                            {item.isUploadingToGyazo ? <Loader2 size={12} className="animate-spin" /> : (isCopied(item.id, 'link') ? <Check size={12} /> : <Link size={12} />)}
                                        </button>
                                        <button
                                            onClick={() => copyFormula(item)}
                                            disabled={!canCopyFormula(item)}
                                            className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isCopied(item.id, 'formula')
                                                ? 'text-emerald-400 bg-emerald-900/20'
                                                : 'text-zinc-500 hover:text-orange-400 hover:bg-zinc-800'
                                                }`}
                                            data-tip={getFormulaTitle(item)}
                                        >
                                            {isCopied(item.id, 'formula') ? <Check size={12} /> : <FileCode size={12} />}
                                        </button>
                                        {item.status === 'success' && (
                                            <>
                                                {workMode === 'split' ? (
                                                    <>
                                                        <button
                                                            onClick={() => copySplitResultLang(item, 'zh')}
                                                            className={`p-1 rounded transition-colors tooltip-bottom text-[9px] font-bold ${isCopied(item.id, 'result-zh')
                                                                ? 'text-emerald-400 bg-emerald-900/20'
                                                                : 'text-zinc-500 hover:text-orange-400 hover:bg-zinc-800'
                                                                }`}
                                                            data-tip="复制中文描述"
                                                        >
                                                            {isCopied(item.id, 'result-zh') ? <Check size={12} /> : <span>中</span>}
                                                        </button>
                                                        <button
                                                            onClick={() => copySplitResultLang(item, 'en')}
                                                            className={`p-1 rounded transition-colors tooltip-bottom text-[9px] font-bold ${isCopied(item.id, 'result-en')
                                                                ? 'text-emerald-400 bg-emerald-900/20'
                                                                : 'text-zinc-500 hover:text-blue-400 hover:bg-zinc-800'
                                                                }`}
                                                            data-tip="复制英文描述"
                                                        >
                                                            {isCopied(item.id, 'result-en') ? <Check size={12} /> : <span>EN</span>}
                                                        </button>
                                                    </>
                                                ) : (
                                                    <button
                                                        onClick={() => copyResult(item)}
                                                        className={`p-1 rounded transition-colors tooltip-bottom ${isCopied(item.id, 'result')
                                                            ? 'text-emerald-400 bg-emerald-900/20'
                                                            : 'text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800'
                                                            }`}
                                                        data-tip="复制结果"
                                                    >
                                                        {isCopied(item.id, 'result') ? <Check size={12} /> : <Copy size={12} />}
                                                    </button>
                                                )}
                                                {workMode !== 'split' && onSendToDesc && (
                                                    <button
                                                        onClick={() => onSendToDesc(item.id)}
                                                        className={`p-1 rounded transition-colors tooltip-bottom ${sentToDescIds?.includes(item.id)
                                                            ? 'text-emerald-300 bg-emerald-700/20 border border-emerald-500/40'
                                                            : 'text-blue-300 hover:text-white hover:bg-blue-500/30'
                                                            }`}
                                                        data-tip={sentToDescIds?.includes(item.id) ? '已发送' : '发送到提示词创新'}
                                                    >
                                                        {sentToDescIds?.includes(item.id) ? <Check size={12} /> : <Share2 size={12} />}
                                                    </button>
                                                )}
                                                <button
                                                    onClick={() => onRetry(item.id)}
                                                    className="p-1 text-zinc-600 hover:text-emerald-400 hover:bg-zinc-800 rounded transition-colors tooltip-bottom"
                                                    data-tip="重新识别"
                                                >
                                                    <RotateCw size={12} />
                                                </button>
                                            </>
                                        )}
                                        {/* AI 对话记录按钮 */}
                                        {item.aiConversationLog && item.aiConversationLog.length > 0 && (
                                            <button
                                                onClick={() => setConversationLogItem(item)}
                                                className="p-1 text-amber-500/70 hover:text-amber-400 hover:bg-amber-500/10 rounded transition-colors tooltip-bottom"
                                                data-tip={`AI 对话记录 (${item.aiConversationLog.length})`}
                                            >
                                                <Eye size={12} />
                                            </button>
                                        )}
                                        <button
                                            onClick={() => onRemove(item.id)}
                                            className="p-1 text-zinc-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors tooltip-bottom"
                                            data-tip="删除"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </div>
                            );
                        }

                        // 正常视图
                        const isSelectedInList = selectedCardId === item.id;
                        return (
                            <div
                                key={item.id}
                                data-image-card
                                tabIndex={(workMode === 'creative' || workMode === 'quick') ? 0 : -1}
                                className={`group bg-zinc-900 border rounded-xl overflow-hidden transition-all duration-300 outline-none
                                    ${item.status === 'error' ? 'border-red-900/30' : 'border-zinc-800 hover:border-zinc-600'}
                                    focus:ring-2 focus:ring-cyan-500/50
                                `}
                                onClick={(e) => {
                                    if ((workMode === 'creative' || workMode === 'quick') && onSelectCard) {
                                        if (isInteractiveTarget(e.target)) return;
                                        const newSelected = isSelectedInList ? null : item.id;
                                        onSelectCard(newSelected);
                                        if (newSelected) {
                                            (e.currentTarget as HTMLElement).focus();
                                        }
                                    }
                                }}
                                onPaste={async (e) => {
                                    console.log('[Card Paste] Triggered! workMode:', workMode, 'onAddFusionImage:', !!onAddFusionImage, 'itemId:', item.id);
                                    // 创新模式下，卡片接管粘贴事件
                                    if ((workMode === 'creative' || workMode === 'quick') && onAddFusionImage) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        console.log('[Card Paste] Event stopped, processing clipboard...');
                                        const clipboardData = e.clipboardData;
                                        const files = Array.from(clipboardData.files).filter(f => f.type.startsWith('image/'));
                                        console.log('[Card Paste] files:', files.length, 'items:', clipboardData.items?.length);
                                        if (files.length > 0) {
                                            for (const file of files) {
                                                console.log('[Card Paste] Adding fusion image from file:', file.name);
                                                await onAddFusionImage(item.id, file);
                                            }
                                            return;
                                        }
                                        const items = Array.from(clipboardData.items || []);
                                        const imageItems = items.filter(it => it.type.startsWith('image/'));
                                        if (imageItems.length > 0) {
                                            const itemFiles = imageItems.map(it => it.getAsFile()).filter(Boolean) as File[];
                                            console.log('[Card Paste] Adding fusion image from items:', itemFiles.length);
                                            for (const file of itemFiles) {
                                                await onAddFusionImage(item.id, file);
                                            }
                                        }
                                    }
                                }}
                                onDragOver={(e) => {
                                    if ((workMode === 'creative' || workMode === 'quick') && onAddFusionImage) {
                                        e.preventDefault();
                                        e.stopPropagation();
                                        e.currentTarget.classList.add('ring-2', 'ring-cyan-500', 'border-cyan-500');
                                    }
                                }}
                                onDragLeave={(e) => {
                                    e.currentTarget.classList.remove('ring-2', 'ring-cyan-500', 'border-cyan-500');
                                }}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.currentTarget.classList.remove('ring-2', 'ring-cyan-500', 'border-cyan-500');
                                    if ((workMode === 'creative' || workMode === 'quick') && onAddFusionImage) {
                                        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                                        for (const file of files) {
                                            onAddFusionImage(item.id, file);
                                        }
                                    }
                                }}
                            >
                                {/* 判断是否有面板打开（对话或创新） */}
                                {(() => {
                                    const hasPanelOpen = item.isChatOpen || item.isInnovationOpen;
                                    const bothPanelsOpen = item.isChatOpen && item.isInnovationOpen;
                                    const chatRatio = chatPanelRatio[item.id] ?? 50;
                                    return (
                                        <>
                                            {/* 主内容区域 - 左右布局 */}
                                            <div
                                                ref={(el) => {
                                                    // 使用闭包存储 ref
                                                    (window as any)[`container-${item.id}`] = el;
                                                }}
                                                id={`card-container-${item.id}`}
                                                className="flex flex-row min-h-0 overflow-hidden"
                                                style={{
                                                    height: panelHeights[item.id]
                                                        ? `${panelHeights[item.id]}px`
                                                        : (hasPanelOpen
                                                            ? (minimizedChats[item.id] ? '140px' : '320px')
                                                            : (workMode === 'quick' ? '220px' : '192px'))
                                                }}
                                            >
                                                {/* 左侧：图片 + 结果 + 操作按钮 */}
                                                <div
                                                    className={`flex ${!hasPanelOpen ? 'flex-row flex-1 min-w-0' : 'flex-col flex-shrink-0'} h-full min-h-0 ${isResizing ? '' : 'transition-all duration-300'}`}
                                                    style={{ width: hasPanelOpen ? currentSidebarWidth : undefined }}
                                                >
                                                    {/* 图片区域 — 快捷模式下改为底部统一管理；其余模式保持原布局 */}
                                                    {workMode !== 'quick' && (
                                                        <div className={`bg-zinc-950 relative flex-shrink-0 
                                                        ${!hasPanelOpen ? 'border-r w-48 h-full' : 'border-b h-36 p-2'} 
                                                        ${isSelectedInList ? 'ring-2 ring-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)] border-cyan-500/50' : 'border-zinc-800'}
                                                        ${isResizing ? '' : 'transition-all duration-300'}
                                                    `}>
                                                            {/* 删除按钮悬浮层 - 在两种模式下都可用 */}
                                                            <div className={`absolute top-2 right-2 z-10 ${hasPanelOpen ? 'opacity-0 group-hover:opacity-100' : 'opacity-0 group-hover:opacity-100'} transition-opacity`}>
                                                                <button
                                                                    onClick={() => onRemove(item.id)}
                                                                    className="bg-black/50 hover:bg-red-500/80 text-white p-1.5 rounded-full backdrop-blur-sm transition-colors"
                                                                >
                                                                    <Trash2 size={14} />
                                                                </button>
                                                            </div>
                                                            <ImageThumbnail item={item} />
                                                        </div>
                                                    )}

                                                    {/* 内容区域 - 仅在面板关闭时显示 (List View特定的横向内容) */}
                                                    {!hasPanelOpen && (
                                                        <div className="flex-1 p-3 flex flex-col min-w-0 relative">
                                                            {/* Metadata Header */}
                                                            <div className="flex justify-between items-start mb-2 border-b border-zinc-800 pb-2">
                                                                <div className="text-xs text-zinc-500 font-mono truncate max-w-[90%] tooltip-bottom" data-tip={item.originalInput}>
                                                                    {item.originalInput}
                                                                </div>
                                                            </div>

                                                            {/* Result Content */}
                                                            <div className={`flex-1 ${workMode === 'quick' ? 'overflow-x-auto overflow-y-visible custom-scrollbar' : 'overflow-y-auto custom-scrollbar'} pr-1`}>
                                                                {(workMode === 'creative' || workMode === 'quick') ? (
                                                                    (() => {
                                                                        const creativeResult = creativeResults.find(r => r.imageId === item.id);
                                                                        const showQuickInlineManager = workMode === 'quick';
                                                                        const hasQuickResult = !!(creativeResult && creativeResult.status === 'success' && creativeResult.innovations.length > 0);
                                                                        if (!showQuickInlineManager) {
                                                                            return (
                                                                                <div
                                                                                    className="cursor-pointer hover:bg-zinc-800/30 rounded-md transition-colors h-full"
                                                                                    onDoubleClick={() => setExpandedResultItem(item)}
                                                                                    data-tip="双击放大查看"
                                                                                >
                                                                                    <CreativeResultDisplay result={creativeResult} />
                                                                                </div>
                                                                            );
                                                                        }
                                                                        return (
                                                                            <div className="flex items-start gap-3">
                                                                                <div className={`${hasQuickResult ? 'w-[64%] border-r border-zinc-800/70 pr-2' : 'w-full'} min-w-0`}>
                                                                                    <QuickInlineImageManager
                                                                                        item={item}
                                                                                        allEnabledDimNames={allEnabledDimNames}
                                                                                        globalOverrideCounts={globalOverrideCounts}
                                                                                        globalOverrideModes={globalOverrideModes}
                                                                                        onUpdateCardOverrideCount={onUpdateCardOverrideCount}
                                                                                        onUpdateCardTextOverride={onUpdateCardTextOverride}
                                                                                        onUpdateCustomPrompt={onUpdateCustomPrompt}
                                                                                        onUpdateRefImageConfig={onUpdateRefImageConfig}
                                                                                        onRemoveFusionImage={onRemoveFusionImage}
                                                                                        onAddFusionImage={onAddFusionImage}
                                                                                        onToggleDescribeFirst={onToggleDescribeFirst}
                                                                                        onSetDescribePresetId={onSetDescribePresetId}
                                                                                        onSetDescribeCustomPrompt={onSetDescribeCustomPrompt}
                                                                                    />
                                                                                </div>
                                                                                {hasQuickResult && (
                                                                                    <div
                                                                                        className="flex-1 min-w-0 cursor-pointer hover:bg-zinc-800/30 rounded-md transition-colors h-full"
                                                                                        onDoubleClick={() => setExpandedResultItem(item)}
                                                                                        data-tip="双击放大查看"
                                                                                    >
                                                                                        <CreativeResultDisplay result={creativeResult} />
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        );
                                                                    })()
                                                                ) : workMode === 'split' ? (
                                                                    <MemoizedSplitResultDisplay item={item} splitElements={splitElements || []} />
                                                                ) : (
                                                                    <MemoizedStatusDisplay item={item} onRetry={onRetry} onExpand={setExpandedResultItem} />
                                                                )}
                                                            </div>
                                                        </div>
                                                    )}

                                                    {/* 操作按钮 - 在面板打开时显示在底部，关闭时显示在右侧 */}
                                                    <div className={`${!hasPanelOpen
                                                        ? 'w-10 bg-zinc-950/30 border-l border-zinc-800 flex flex-col items-center justify-center gap-1 py-2 flex-shrink-0 relative z-10'
                                                        : 'p-2 flex flex-wrap justify-end gap-1 bg-zinc-900/50 flex-shrink-0'
                                                        }`}>
                                                        {(item.status === 'idle' && (workMode === 'creative' || workMode === 'quick') && onStartInnovation) ? (
                                                            <button
                                                                onClick={() => onStartInnovation(item.id)}
                                                                className={`tooltip-bottom ${!item.isChatOpen ? 'p-1.5 hover:text-white hover:bg-emerald-500/20' : 'p-1.5 hover:bg-zinc-800'} text-emerald-400 rounded transition-colors`}
                                                                data-tip="开始单卡创新"
                                                            >
                                                                <Play size={12} />
                                                            </button>
                                                        ) : item.status === 'error' ? (
                                                            <button
                                                                onClick={() => onRetry(item.id)}
                                                                className={`tooltip-bottom ${!item.isChatOpen ? 'p-1.5 hover:text-white hover:bg-red-500/20' : 'p-1.5 hover:bg-zinc-800'} text-red-400 rounded transition-colors`}
                                                                data-tip="重试下载/识别"
                                                            >
                                                                <RotateCw size={12} />
                                                            </button>
                                                        ) : (
                                                            <>
                                                                <button
                                                                    onClick={() => copyImage(item)}
                                                                    disabled={!item.imageUrl}
                                                                    className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed tooltip-bottom ${isCopied(item.id, 'image')
                                                                        ? 'text-emerald-400 bg-emerald-900/20'
                                                                        : 'text-zinc-500 hover:text-purple-400 hover:bg-zinc-800'
                                                                        }`}
                                                                    data-tip={item.imageUrl ? '复制图片到剪贴板' : '无图片'}
                                                                >
                                                                    {isCopied(item.id, 'image') ? <Check size={12} /> : <ImageIcon size={12} />}
                                                                </button>
                                                                <button
                                                                    onClick={() => copyLink(item)}
                                                                    disabled={!canCopyLink(item)}
                                                                    className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${item.isUploadingToGyazo
                                                                        ? 'text-blue-400 animate-pulse'
                                                                        : isCopied(item.id, 'link')
                                                                            ? 'text-emerald-400 bg-emerald-900/20'
                                                                            : 'text-zinc-500 hover:text-blue-400 hover:bg-zinc-800'
                                                                        }`}
                                                                    data-tip={getLinkTitle(item)}
                                                                >
                                                                    {item.isUploadingToGyazo ? <Loader2 size={12} className="animate-spin" /> : (isCopied(item.id, 'link') ? <Check size={12} /> : <Link size={12} />)}
                                                                </button>
                                                                <button
                                                                    onClick={() => copyFormula(item)}
                                                                    disabled={!canCopyFormula(item)}
                                                                    className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isCopied(item.id, 'formula')
                                                                        ? 'text-emerald-400 bg-emerald-900/20'
                                                                        : 'text-zinc-500 hover:text-orange-400 hover:bg-zinc-800'
                                                                        }`}
                                                                    data-tip={getFormulaTitle(item)}
                                                                >
                                                                    {isCopied(item.id, 'formula') ? <Check size={12} /> : <FileCode size={12} />}
                                                                </button>
                                                                {workMode === 'split' ? (
                                                                    <>
                                                                        <button
                                                                            onClick={() => copySplitResultLang(item, 'zh')}
                                                                            disabled={item.status !== 'success'}
                                                                            className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed tooltip-bottom text-[9px] font-bold ${isCopied(item.id, 'result-zh')
                                                                                ? 'text-emerald-400 bg-emerald-900/20'
                                                                                : 'text-zinc-500 hover:text-orange-400 hover:bg-zinc-800'
                                                                                }`}
                                                                            data-tip="复制中文描述"
                                                                        >
                                                                            {isCopied(item.id, 'result-zh') ? <Check size={12} /> : <span>中</span>}
                                                                        </button>
                                                                        <button
                                                                            onClick={() => copySplitResultLang(item, 'en')}
                                                                            disabled={item.status !== 'success'}
                                                                            className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed tooltip-bottom text-[9px] font-bold ${isCopied(item.id, 'result-en')
                                                                                ? 'text-emerald-400 bg-emerald-900/20'
                                                                                : 'text-zinc-500 hover:text-blue-400 hover:bg-zinc-800'
                                                                                }`}
                                                                            data-tip="复制英文描述"
                                                                        >
                                                                            {isCopied(item.id, 'result-en') ? <Check size={12} /> : <span>EN</span>}
                                                                        </button>
                                                                    </>
                                                                ) : (
                                                                    <button
                                                                        onClick={() => (workMode === 'creative' || workMode === 'quick') ? copyCreativeResult(item) : copyResult(item)}
                                                                        disabled={(workMode === 'creative' || workMode === 'quick')
                                                                            ? !(creativeResults.find(r => r.imageId === item.id)?.status === 'success')
                                                                            : item.status !== 'success'}
                                                                        className={`p-1.5 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed tooltip-bottom ${isCopied(item.id, 'result')
                                                                            ? 'text-emerald-400 bg-emerald-900/20'
                                                                            : 'text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800'
                                                                            }`}
                                                                        data-tip={(workMode === 'creative' || workMode === 'quick') ? '复制所有创新结果' : (item.status === 'success' ? '复制识别结果' : '暂无结果')}
                                                                    >
                                                                        {isCopied(item.id, 'result') ? <Check size={12} /> : <Copy size={12} />}
                                                                    </button>
                                                                )}
                                                                {/* 发送到提示词创新 - 创新模式下隐藏 */}
                                                                {workMode !== 'creative' && workMode !== 'split' && item.status === 'success' && onSendToDesc && (
                                                                    <button
                                                                        onClick={() => onSendToDesc(item.id)}
                                                                        className={`p-1.5 rounded transition-colors tooltip-bottom ${sentToDescIds?.includes(item.id)
                                                                            ? 'text-emerald-300 bg-emerald-700/20 border border-emerald-500/40'
                                                                            : 'text-blue-300 hover:text-white hover:bg-blue-500/30'
                                                                            }`}
                                                                        data-tip={sentToDescIds?.includes(item.id) ? '已发送' : '发送到提示词创新'}
                                                                    >
                                                                        {sentToDescIds?.includes(item.id) ? <Check size={12} /> : <Share2 size={12} />}
                                                                    </button>
                                                                )}
                                                                {/* 对话按钮 - 创新模式下隐藏 */}
                                                                {workMode !== 'creative' && item.status === 'success' && onToggleChat && (
                                                                    <button
                                                                        onClick={() => onToggleChat(item.id)}
                                                                        className={`p-1.5 rounded transition-colors tooltip-bottom ${item.isChatOpen
                                                                            ? 'text-blue-400 bg-blue-500/30 ring-2 ring-blue-400/50'
                                                                            : (item.chatHistory.length > 1
                                                                                ? 'text-blue-400 bg-blue-900/20'
                                                                                : 'text-blue-400 hover:bg-zinc-800')
                                                                            }`}
                                                                        data-tip={item.chatHistory.length > 1 ? "继续对话 (已有记录)" : "继续对话"}
                                                                    >
                                                                        <MessageCircle size={12} fill={!item.isChatOpen && item.chatHistory.length > 1 ? "currentColor" : "none"} fillOpacity={!item.isChatOpen && item.chatHistory.length > 1 ? 0.2 : 0} />
                                                                    </button>
                                                                )}
                                                                {workMode !== 'split' && (workMode === 'creative' ? (
                                                                    // 创新模式：放大查看按钮
                                                                    <button
                                                                        onClick={() => setExpandedResultItem(item)}
                                                                        disabled={!(creativeResults.find(r => r.imageId === item.id)?.status === 'success')}
                                                                        className="p-1.5 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/20 rounded transition-colors tooltip-bottom disabled:opacity-30 disabled:cursor-not-allowed"
                                                                        data-tip="放大查看"
                                                                    >
                                                                        <Maximize2 size={12} />
                                                                    </button>
                                                                ) : (
                                                                    // 标准模式：创新按钮
                                                                    item.status === 'success' && onToggleInnovation && (
                                                                        <button
                                                                            onClick={() => onToggleInnovation(item.id)}
                                                                            className={`p-1.5 rounded transition-colors tooltip-bottom ${item.isInnovationOpen
                                                                                ? 'text-cyan-400 bg-cyan-500/30 ring-2 ring-cyan-400/50'
                                                                                : (hasInnovationOutputs
                                                                                    ? 'text-cyan-400 bg-cyan-900/20'
                                                                                    : 'text-cyan-400 hover:bg-zinc-800')
                                                                                }`}
                                                                            data-tip={hasInnovationOutputs ? "查看创新结果" : "创新提示词"}
                                                                        >
                                                                            <Sparkles size={12} fill={!item.isInnovationOpen && hasInnovationOutputs ? "currentColor" : "none"} fillOpacity={!item.isInnovationOpen && hasInnovationOutputs ? 0.2 : 0} />
                                                                        </button>
                                                                    )
                                                                ))}
                                                                {/* 重试按钮 - 创新模式下改为重新创新（暂时仍使用onRetry） */}
                                                                {item.status === 'success' && (
                                                                    <button
                                                                        onClick={() => onRetry(item.id)}
                                                                        className="p-1.5 text-zinc-600 hover:text-emerald-400 hover:bg-zinc-800 rounded transition-colors tooltip-bottom"
                                                                        data-tip={(workMode === 'creative' || workMode === 'quick') ? "重新创新" : "重新识别"}
                                                                    >
                                                                        <RotateCw size={12} />
                                                                    </button>
                                                                )}
                                                                {/* AI 对话记录按钮 */}
                                                                {item.aiConversationLog && item.aiConversationLog.length > 0 && (
                                                                    <button
                                                                        onClick={() => setConversationLogItem(item)}
                                                                        className="p-1.5 text-amber-500/70 hover:text-amber-400 hover:bg-amber-500/10 rounded transition-colors tooltip-bottom"
                                                                        data-tip={`查看 AI 对话记录 (${item.aiConversationLog.length} 条)`}
                                                                    >
                                                                        <Eye size={12} />
                                                                    </button>
                                                                )}
                                                            </>
                                                        )}
                                                        {workMode === 'quick' && (
                                                            <button
                                                                onClick={() => setExpandedEditCardId(item.id)}
                                                                className="p-1.5 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/20 rounded transition-colors tooltip-bottom"
                                                                data-tip="放大编辑卡片"
                                                            >
                                                                <Maximize2 size={12} />
                                                            </button>
                                                        )}

                                                        {/* 删除按钮 - 仅在关闭状态显示（即右侧操作栏），打开状态时使用图片悬浮删除按钮 */}
                                                        {!hasPanelOpen && (
                                                            <button
                                                                onClick={() => onRemove(item.id)}
                                                                className={`p-1.5 text-zinc-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors tooltip-bottom`}
                                                                data-tip="删除此图片"
                                                            >
                                                                <Trash2 size={12} />
                                                            </button>
                                                        )}
                                                    </div>
                                                </div>

                                                {/* Resizer Handle */}
                                                {hasPanelOpen && (
                                                    <div
                                                        className="w-1 bg-zinc-900 hover:bg-blue-500/50 cursor-col-resize flex-shrink-0 transition-colors z-10 border-l border-zinc-800"
                                                        onMouseDown={startResizing}
                                                    />
                                                )}

                                                {/* 右侧：对话面板 - 左右布局 */}
                                                {item.isChatOpen && (
                                                    <div
                                                        className="flex flex-col min-w-0 min-h-0"
                                                        style={bothPanelsOpen ? { flex: `${chatRatio} 1 0%` } : { flex: '1 1 0%' }}
                                                    >
                                                        <MemoizedChatPanel
                                                            item={item}
                                                            onToggleChat={onToggleChat}
                                                            onSendMessage={onSendMessage}
                                                            onUpdateChatInput={onUpdateChatInput}
                                                            onCopyChatHistory={onCopyChatHistory}
                                                            onUpdateChatAttachments={onUpdateChatAttachments}
                                                            onToggleMinimize={toggleMinimize}
                                                            isMinimized={!!minimizedChats[item.id]}
                                                        />
                                                    </div>
                                                )}

                                                {/* 对话和创新面板之间的分隔条 */}
                                                {bothPanelsOpen && (
                                                    <div
                                                        className="w-1.5 bg-zinc-900 hover:bg-purple-500/50 cursor-col-resize flex-shrink-0 transition-colors z-10 border-x border-zinc-800 flex items-center justify-center group/panel-resizer"
                                                        onMouseDown={(e) => startResizingPanels(e, item.id, (window as any)[`container-${item.id}`])}
                                                    >
                                                        <div className="w-0.5 h-6 bg-zinc-700 rounded-full group-hover/panel-resizer:bg-purple-400 transition-colors" />
                                                    </div>
                                                )}

                                                {/* 右侧：创新面板 */}
                                                {item.isInnovationOpen && (
                                                    <div
                                                        className="flex flex-col min-w-0 min-h-0"
                                                        style={bothPanelsOpen ? { flex: `${100 - chatRatio} 1 0%` } : { flex: '1 1 0%' }}
                                                    >
                                                        <InnovationPanel
                                                            item={item}
                                                            onToggleInnovation={onToggleInnovation}
                                                            onStartInnovation={onStartInnovation}
                                                            onCopyInnovation={onCopyInnovation}
                                                            onToggleMinimize={toggleMinimize}
                                                            isMinimized={!!minimizedChats[item.id]}
                                                            globalInnovationInstruction={globalInnovationInstruction}
                                                            defaultInnovationInstruction={defaultInnovationInstruction}
                                                            onUpdateCustomInnovationInstruction={onUpdateCustomInnovationInstruction}
                                                            onUpdateCustomInnovationCount={onUpdateCustomInnovationCount}
                                                            onUpdateCustomInnovationRounds={onUpdateCustomInnovationRounds}
                                                            onUpdateCustomInnovationTemplateId={onUpdateCustomInnovationTemplateId}
                                                            templateState={templateState}
                                                            unifiedPresets={unifiedPresets}
                                                            onToggleInnovationChat={onToggleInnovationChat}
                                                            onSendInnovationMessage={onSendInnovationMessage}
                                                            onUpdateInnovationInput={onUpdateInnovationInput}
                                                            onCopyInnovationChatHistory={onCopyInnovationChatHistory}
                                                            onUpdateInnovationAttachments={onUpdateInnovationAttachments}
                                                        />
                                                    </div>
                                                )}
                                            </div>

                                            {/* Vertical Resizer Handle - 始终显示，支持调整卡片高度 */}
                                            <div
                                                className="h-1.5 w-full bg-zinc-950 hover:bg-zinc-800 cursor-row-resize flex items-center justify-center z-20 group/resizer"
                                                onMouseDown={(e) => startResizingHeight(e, item.id)}
                                            >
                                                <div className="w-10 h-0.5 bg-zinc-700 rounded-full group-hover/resizer:bg-blue-500 transition-colors" />
                                            </div>

                                            {/* 单独提示词面板 */}
                                            <MemoizedCustomPromptPanel
                                                item={item}
                                                presets={presets}
                                                onUpdateCustomPrompt={onUpdateCustomPrompt}
                                                onApplyPreset={onApplyPreset}
                                                onToggleMergeMode={onToggleMergeMode}
                                                globalUserPrompt={globalUserPrompt}
                                                baseInstruction={baseInstruction}
                                                overrideDimsWithImages={overrideDimsWithImages}
                                                onUpdateCardRefSelection={onUpdateCardRefSelection}
                                                overrideDimNames={overrideDimNames}
                                                globalOverrideCounts={globalOverrideCounts}
                                                onUpdateCardOverrideCount={onUpdateCardOverrideCount}
                                                onUpdateCardTextOverride={onUpdateCardTextOverride}
                                                allEnabledDimNames={allEnabledDimNames}
                                                onUpdateRefImageConfig={onUpdateRefImageConfig}
                                                onRemoveFusionImage={onRemoveFusionImage}
                                                onAddFusionImage={onAddFusionImage}
                                                onStartInnovation={onStartInnovation}
                                                workMode={workMode}
                                            />
                                        </>
                                    );
                                })()}
                            </div>
                        );
                    })}
                </div>
            </>
        );
    }

    // --- GRID VIEW ---
    return (
        <>
            {/* 结果放大模态框 */}
            <ResultExpandModal item={expandedResultItem} onClose={() => setExpandedResultItem(null)} onTranslate={onTranslate} onSaveTranslation={onSaveTranslation} onSaveSelection={onSaveSelection} workMode={workMode} creativeResult={expandedResultItem ? creativeResults.find(r => r.imageId === expandedResultItem.id) : undefined} />
            {/* AI 对话记录弹窗 */}
            <ConversationLogModal item={conversationLogItem} onClose={() => setConversationLogItem(null)} />
            {/* 图片放大预览弹窗 */}
            <ImagePreviewModal imageUrl={expandedImage?.url || null} title={expandedImage?.title} onClose={() => setExpandedImage(null)} />
            {/* 卡片放大编辑弹窗 */}
            {expandedCardEditorModal}

            <div
                className="flex flex-wrap gap-4 pb-20"
                onClick={(e) => {
                    if (workMode !== 'creative' || !onSelectCard) return;
                    const target = e.target as HTMLElement;
                    if (target.closest('[data-image-card]')) return;
                    onSelectCard(null);
                }}
            >
                {images.map((item) => {
                    const isItemMinimized = !!minimizedChats[item.id] && !item.isChatOpen;
                    const hasInnovationOutputs = getInnovationOutputs(item).length > 0;

                    // 精简模式：单行紧凑显示
                    if (isItemMinimized) {
                        return (
                            <div
                                key={item.id}
                                data-image-card
                                className={`group flex flex-row h-14 bg-zinc-900/80 border rounded-lg transition-all ${item.status === 'error' ? 'border-red-900/40 bg-red-950/20' : item.status === 'success' ? 'border-emerald-900/30' : 'border-zinc-800 hover:border-zinc-600'}`}
                                style={{ minWidth: '200px', maxWidth: '400px', flex: '1 1 280px' }}
                            >
                                {/* Compact Thumbnail */}
                                <div className="w-14 h-14 bg-zinc-950 relative flex-shrink-0 border-r border-zinc-800/50 flex items-center justify-center overflow-hidden">
                                    {item.status === 'error' && !item.imageUrl ? (
                                        <div className="flex items-center justify-center h-full text-red-400">
                                            <AlertCircle size={16} />
                                        </div>
                                    ) : (
                                        <img
                                            src={item.imageUrl}
                                            alt="Preview"
                                            className="w-full h-full object-contain p-1 cursor-zoom-in"
                                            onClick={(e) => openImagePreview(item, e)}
                                            onError={(e) => {
                                                (e.target as HTMLImageElement).style.display = 'none';
                                            }}
                                        />
                                    )}
                                </div>

                                {/* Content - Compact Layout */}
                                <div className="flex-1 flex items-center gap-3 px-3 min-w-0">
                                    {/* Status Icon */}
                                    <div className="flex-shrink-0">
                                        {item.status === 'success' && (
                                            <div className="w-5 h-5 rounded-full bg-emerald-500/20 flex items-center justify-center tooltip-bottom" data-tip="识别成功">
                                                <div className="w-2 h-2 rounded-full bg-emerald-400" />
                                            </div>
                                        )}
                                    </div>

                                    {/* Result Text */}
                                    <div className="flex-1 min-w-0">
                                        {item.chatHistory.length > 0 ? (
                                            <div className="text-sm text-zinc-200 truncate tooltip-bottom" data-tip={item.chatHistory[item.chatHistory.length - 1].text}>
                                                {item.chatHistory[item.chatHistory.length - 1].text}
                                            </div>
                                        ) : item.result ? (
                                            <div className="text-sm text-zinc-200 truncate tooltip-bottom" data-tip={item.result}>
                                                {item.result}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-zinc-500 truncate tooltip-bottom" data-tip={item.originalInput}>
                                                {item.originalInput}
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* Compact Actions */}
                                <div className="flex items-center gap-0.5 px-1.5 flex-shrink-0">
                                    <button
                                        onClick={() => {
                                            toggleMinimize(item.id);
                                            onToggleChat?.(item.id);
                                        }}
                                        className="p-1 text-blue-400 hover:text-blue-300 hover:bg-zinc-800 rounded transition-colors tooltip-bottom"
                                        data-tip="展开对话"
                                    >
                                        <ChevronDown size={12} />
                                    </button>
                                    <button
                                        onClick={() => copyImage(item)}
                                        disabled={!item.imageUrl}
                                        className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed tooltip-bottom ${isCopied(item.id, 'image')
                                            ? 'text-emerald-400 bg-emerald-900/20'
                                            : 'text-zinc-500 hover:text-purple-400 hover:bg-zinc-800'
                                            }`}
                                        data-tip={item.imageUrl ? '复制图片到剪贴板' : '无图片'}
                                    >
                                        {isCopied(item.id, 'image') ? <Check size={12} /> : <ImageIcon size={12} />}
                                    </button>
                                    <button
                                        onClick={() => copyLink(item)}
                                        disabled={!canCopyLink(item)}
                                        className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isCopied(item.id, 'link')
                                            ? 'text-emerald-400 bg-emerald-900/20'
                                            : 'text-zinc-500 hover:text-blue-400 hover:bg-zinc-800'
                                            }`}
                                        data-tip={getLinkTitle(item)}
                                    >
                                        {isCopied(item.id, 'link') ? <Check size={12} /> : <Link size={12} />}
                                    </button>
                                    <button
                                        onClick={() => copyFormula(item)}
                                        disabled={!canCopyFormula(item)}
                                        className={`p-1 rounded transition-colors disabled:opacity-30 disabled:cursor-not-allowed ${isCopied(item.id, 'formula')
                                            ? 'text-emerald-400 bg-emerald-900/20'
                                            : 'text-zinc-500 hover:text-orange-400 hover:bg-zinc-800'
                                            }`}
                                        data-tip={getFormulaTitle(item)}
                                    >
                                        {isCopied(item.id, 'formula') ? <Check size={12} /> : <FileCode size={12} />}
                                    </button>
                                    {item.status === 'success' && (
                                        <>
                                            {workMode === 'split' ? (
                                                <>
                                                    <button
                                                        onClick={() => copySplitResultLang(item, 'zh')}
                                                        className={`p-1 rounded transition-colors tooltip-bottom text-[9px] font-bold ${isCopied(item.id, 'result-zh')
                                                            ? 'text-emerald-400 bg-emerald-900/20'
                                                            : 'text-zinc-500 hover:text-orange-400 hover:bg-zinc-800'
                                                            }`}
                                                        data-tip="复制中文描述"
                                                    >
                                                        {isCopied(item.id, 'result-zh') ? <Check size={12} /> : <span>中</span>}
                                                    </button>
                                                    <button
                                                        onClick={() => copySplitResultLang(item, 'en')}
                                                        className={`p-1 rounded transition-colors tooltip-bottom text-[9px] font-bold ${isCopied(item.id, 'result-en')
                                                            ? 'text-emerald-400 bg-emerald-900/20'
                                                            : 'text-zinc-500 hover:text-blue-400 hover:bg-zinc-800'
                                                            }`}
                                                        data-tip="复制英文描述"
                                                    >
                                                        {isCopied(item.id, 'result-en') ? <Check size={12} /> : <span>EN</span>}
                                                    </button>
                                                </>
                                            ) : (
                                                <button
                                                    onClick={() => copyResult(item)}
                                                    className={`p-1 rounded transition-colors tooltip-bottom ${isCopied(item.id, 'result')
                                                        ? 'text-emerald-400 bg-emerald-900/20'
                                                        : 'text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800'
                                                        }`}
                                                    data-tip="复制结果"
                                                >
                                                    {isCopied(item.id, 'result') ? <Check size={12} /> : <Copy size={12} />}
                                                </button>
                                            )}
                                        </>
                                    )}
                                    {workMode !== 'split' && item.status === 'success' && onSendToDesc && (
                                        <button
                                            onClick={() => onSendToDesc(item.id)}
                                            className={`p-1 rounded transition-colors tooltip-bottom ${sentToDescIds?.includes(item.id)
                                                ? 'text-emerald-300 bg-emerald-700/20 border border-emerald-500/40'
                                                : 'text-blue-300 hover:text-white hover:bg-blue-500/30'
                                                }`}
                                            data-tip={sentToDescIds?.includes(item.id) ? '已发送' : '发送到提示词创新'}
                                        >
                                            {sentToDescIds?.includes(item.id) ? <Check size={12} /> : <Share2 size={12} />}
                                        </button>
                                    )}
                                    {/* AI 对话记录按钮 */}
                                    {item.aiConversationLog && item.aiConversationLog.length > 0 && (
                                        <button
                                            onClick={() => setConversationLogItem(item)}
                                            className="p-1 text-amber-500/70 hover:text-amber-400 hover:bg-amber-500/10 rounded transition-colors tooltip-bottom"
                                            data-tip={`AI 对话记录 (${item.aiConversationLog.length})`}
                                        >
                                            <Eye size={12} />
                                        </button>
                                    )}
                                    <button
                                        onClick={() => onRemove(item.id)}
                                        className="p-1 text-zinc-600 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors tooltip-bottom"
                                        data-tip="删除"
                                    >
                                        <Trash2 size={12} />
                                    </button>
                                </div>
                            </div>
                        );
                    }

                    // 正常视图
                    const isSelected = selectedCardId === item.id;
                    return (
                        <div
                            key={item.id}
                            id={`grid-card-${item.id}`}
                            data-image-card
                            tabIndex={(workMode === 'creative' || workMode === 'quick') ? 0 : -1}
                            className={`group relative bg-zinc-900 border rounded-xl overflow-hidden cursor-pointer outline-none
                        ${item.status === 'error' ? 'border-red-900/30' : 'border-zinc-800 hover:border-zinc-600'}
                        ${isResizing ? '' : 'transition-all duration-300'}
                        focus:ring-2 focus:ring-cyan-500/50
                    `}
                            style={{
                                width: cardWidths[item.id] ? `${cardWidths[item.id]}px` : undefined,
                                minWidth: '280px',
                                maxWidth: cardWidths[item.id] ? undefined : '500px',
                                flex: cardWidths[item.id] ? '0 0 auto' : '1 1 320px'
                            }}
                            onClick={(e) => {
                                // 只在创新模式下且点击在图片区域时选中
                                if ((workMode === 'creative' || workMode === 'quick') && onSelectCard) {
                                    // 点击交互控件时不触发选中
                                    if (isInteractiveTarget(e.target)) return;
                                    const newSelected = isSelected ? null : item.id;
                                    onSelectCard(newSelected);
                                    // 如果选中了卡片，让卡片获得焦点以接收粘贴事件
                                    if (newSelected) {
                                        (e.currentTarget as HTMLElement).focus();
                                    }
                                }
                            }}
                            onPaste={async (e) => {
                                // 创新模式下，卡片接管粘贴事件
                                if ((workMode === 'creative' || workMode === 'quick') && onAddFusionImage) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    const clipboardData = e.clipboardData;
                                    const files = Array.from(clipboardData.files).filter(f => f.type.startsWith('image/'));
                                    if (files.length > 0) {
                                        for (const file of files) {
                                            await onAddFusionImage(item.id, file);
                                        }
                                        return;
                                    }
                                    // 也检查 clipboardData.items
                                    const items = Array.from(clipboardData.items || []);
                                    const imageItems = items.filter(it => it.type.startsWith('image/'));
                                    if (imageItems.length > 0) {
                                        const itemFiles = imageItems.map(it => it.getAsFile()).filter(Boolean) as File[];
                                        for (const file of itemFiles) {
                                            await onAddFusionImage(item.id, file);
                                        }
                                    }
                                }
                            }}
                            onDragOver={(e) => {
                                if ((workMode === 'creative' || workMode === 'quick') && onAddFusionImage) {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    e.currentTarget.classList.add('ring-2', 'ring-cyan-500', 'border-cyan-500');
                                }
                            }}
                            onDragLeave={(e) => {
                                e.currentTarget.classList.remove('ring-2', 'ring-cyan-500', 'border-cyan-500');
                            }}
                            onDrop={(e) => {
                                e.preventDefault();
                                e.stopPropagation();
                                e.currentTarget.classList.remove('ring-2', 'ring-cyan-500', 'border-cyan-500');
                                if ((workMode === 'creative' || workMode === 'quick') && onAddFusionImage) {
                                    const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
                                    for (const file of files) {
                                        onAddFusionImage(item.id, file);
                                    }
                                }
                            }}
                        >
                            {/* 主内容区域 - 左右布局 */}
                            <div
                                id={`card-container-${item.id}`}
                                className={`flex flex-row min-h-0 ${isResizing ? '' : 'transition-all duration-300'}`}
                                style={{
                                    height: panelHeights[item.id]
                                        ? `${panelHeights[item.id]}px`
                                        : ((item.isChatOpen || item.isInnovationOpen)
                                            ? '360px'
                                            : (workMode === 'quick' ? '420px' : '300px'))
                                }}
                            >
                                {/* 左侧：图片 + 结果 + 操作按钮 */}
                                <div
                                    className={`flex flex-col flex-shrink-0 h-full ${isResizing ? '' : 'transition-all duration-300'} ${!(item.isChatOpen || item.isInnovationOpen) ? 'w-full' : ''}`}
                                    style={{ width: (item.isChatOpen || item.isInnovationOpen) ? Math.min(currentSidebarWidth, 120) : undefined }}
                                >
                                    {/* 图片区域 - 快捷模式下改为底部统一管理；其余模式保持原布局 */}
                                    {workMode !== 'quick' && (
                                        <div
                                            className={`bg-zinc-950 relative flex-shrink-0 border-b transition-all duration-300 
                                            ${(item.isChatOpen || item.isInnovationOpen) ? 'h-48 p-2' : 'h-36'}
                                            ${isSelected ? 'ring-2 ring-cyan-400 shadow-[0_0_15px_rgba(34,211,238,0.4)] border-cyan-500/50' : 'border-zinc-800'}
                                        `}
                                        >
                                            {/* Remove Button Overlay */}
                                            <div className="absolute top-2 right-2 z-10 opacity-0 group-hover:opacity-100 transition-opacity">
                                                <button
                                                    onClick={() => onRemove(item.id)}
                                                    className="bg-black/50 hover:bg-red-500/80 text-white p-1.5 rounded-full backdrop-blur-sm transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </div>
                                            <ImageThumbnail item={item} />
                                            {/* 选中状态提示 */}
                                            {isSelected && (
                                                <div className="absolute inset-0 bg-red-500/10 flex items-center justify-center pointer-events-none">
                                                    <div className="bg-black/70 text-red-300 text-xs px-3 py-1.5 rounded-full flex items-center gap-1.5">
                                                        <Plus size={12} />
                                                        粘贴或拖拽添加融合图
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}

                                    {/* 内容区域 */}
                                    {!item.isChatOpen && (
                                        <div className="flex-1 p-3 flex flex-col gap-2 overflow-hidden bg-zinc-900">
                                            <div className="text-[0.625rem] text-zinc-500 font-mono truncate border-b border-zinc-800 pb-2 mb-1 tooltip-bottom" data-tip={item.originalInput}>
                                                {item.originalInput}
                                            </div>

                                            <div className={`flex-1 ${workMode === 'quick' ? 'overflow-x-auto overflow-y-visible custom-scrollbar' : 'overflow-y-auto custom-scrollbar'}`}>
                                                {(workMode === 'creative' || workMode === 'quick') ? (
                                                    (() => {
                                                        const creativeResult = creativeResults.find(r => r.imageId === item.id);
                                                        const showQuickInlineManager = workMode === 'quick';
                                                        const hasQuickResult = !!(creativeResult && creativeResult.status === 'success' && creativeResult.innovations.length > 0);
                                                        if (!showQuickInlineManager) {
                                                            return (
                                                                <div
                                                                    className="cursor-pointer hover:bg-zinc-800/30 rounded-md transition-colors h-full"
                                                                    onDoubleClick={() => setExpandedResultItem(item)}
                                                                    data-tip="双击放大查看"
                                                                >
                                                                    <CreativeResultDisplay result={creativeResult} />
                                                                </div>
                                                            );
                                                        }
                                                        return (
                                                            <div className="flex items-start gap-3">
                                                                <div className={`${hasQuickResult ? 'w-[64%] border-r border-zinc-800/70 pr-2' : 'w-full'} min-w-0`}>
                                                                    <QuickInlineImageManager
                                                                        item={item}
                                                                        allEnabledDimNames={allEnabledDimNames}
                                                                        globalOverrideCounts={globalOverrideCounts}
                                                                        globalOverrideModes={globalOverrideModes}
                                                                        onUpdateCardOverrideCount={onUpdateCardOverrideCount}
                                                                        onUpdateCardTextOverride={onUpdateCardTextOverride}
                                                                        onUpdateCustomPrompt={onUpdateCustomPrompt}
                                                                        onUpdateRefImageConfig={onUpdateRefImageConfig}
                                                                        onRemoveFusionImage={onRemoveFusionImage}
                                                                        onAddFusionImage={onAddFusionImage}
                                                                        onToggleDescribeFirst={onToggleDescribeFirst}
                                                                        onSetDescribePresetId={onSetDescribePresetId}
                                                                        onSetDescribeCustomPrompt={onSetDescribeCustomPrompt}
                                                                    />
                                                                </div>
                                                                {hasQuickResult && (
                                                                    <div
                                                                        className="flex-1 min-w-0 cursor-pointer hover:bg-zinc-800/30 rounded-md transition-colors h-full"
                                                                        onDoubleClick={() => setExpandedResultItem(item)}
                                                                        data-tip="双击放大查看"
                                                                    >
                                                                        <CreativeResultDisplay result={creativeResult} />
                                                                    </div>
                                                                )}
                                                            </div>
                                                        );
                                                    })()
                                                ) : workMode === 'split' ? (
                                                    <MemoizedSplitResultDisplay item={item} splitElements={splitElements || []} />
                                                ) : (
                                                    item.status === 'success' ? (
                                                        <div
                                                            className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed px-1 cursor-pointer hover:bg-zinc-800/30 rounded-md transition-colors group/result relative tooltip-bottom"
                                                            onDoubleClick={() => setExpandedResultItem(item)}
                                                            data-tip="双击放大窗口查看结果"
                                                        >
                                                            {item.chatHistory.length > 0
                                                                ? item.chatHistory[item.chatHistory.length - 1].text
                                                                : item.result}
                                                            {/* 悬浮时显示底部提示条 */}
                                                            <div className="absolute bottom-0 left-0 right-0 bg-gradient-to-t from-zinc-900/90 to-transparent text-[0.625rem] text-zinc-400 text-center py-1 opacity-0 group-hover/result:opacity-100 transition-opacity pointer-events-none">
                                                                双击放大
                                                            </div>
                                                            {/* 放大提示图标 */}
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); setExpandedResultItem(item); }}
                                                                className="absolute top-0 right-0 p-1 text-zinc-600 hover:text-zinc-300 opacity-0 group-hover/result:opacity-100 transition-opacity tooltip-bottom"
                                                                data-tip="点击放大查看"
                                                            >
                                                                <Maximize2 size={12} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <MemoizedStatusDisplay item={item} onRetry={onRetry} onExpand={setExpandedResultItem} />
                                                    )
                                                )}
                                            </div>
                                        </div>
                                    )}

                                    {/* Footer Actions - 支持按钮换行 */}
                                    <div className="p-2 border-t border-zinc-800 flex flex-wrap justify-end gap-1 bg-zinc-900/50 flex-shrink-0">
                                        {(item.status === 'idle' && (workMode === 'creative' || workMode === 'quick') && onStartInnovation) ? (
                                            <button
                                                onClick={() => onStartInnovation(item.id)}
                                                className="flex items-center gap-1.5 text-xs font-medium text-emerald-400 hover:text-emerald-300 transition-colors px-3 py-1.5 rounded-md hover:bg-emerald-900/20"
                                            >
                                                <Play size={14} />
                                                开始
                                            </button>
                                        ) : item.status === 'error' ? (
                                            <button
                                                onClick={() => onRetry(item.id)}
                                                className="flex items-center gap-1.5 text-xs font-medium text-red-400 hover:text-red-300 transition-colors px-3 py-1.5 rounded-md hover:bg-red-900/20"
                                            >
                                                <RotateCw size={14} />
                                                重试
                                            </button>
                                        ) : (
                                            <>
                                                {/* 复制按钮组 */}
                                                <button
                                                    onClick={() => copyImage(item)}
                                                    className={`p-1.5 rounded transition-colors tooltip-bottom ${isCopied(item.id, 'image')
                                                        ? 'text-emerald-400 bg-emerald-900/20'
                                                        : 'text-zinc-400 hover:text-purple-400 hover:bg-zinc-800'
                                                        }`}
                                                    data-tip="复制图片"
                                                    disabled={!item.imageUrl}
                                                >
                                                    {isCopied(item.id, 'image') ? <Check size={12} /> : <ImageIcon size={12} />}
                                                </button>
                                                <button
                                                    onClick={() => copyLink(item)}
                                                    className={`p-1.5 rounded transition-colors ${item.isUploadingToGyazo
                                                        ? 'text-blue-400 animate-pulse'
                                                        : isCopied(item.id, 'link')
                                                            ? 'text-emerald-400 bg-emerald-900/20'
                                                            : 'text-zinc-400 hover:text-blue-400 hover:bg-zinc-800'
                                                        }`}
                                                    data-tip={item.isUploadingToGyazo ? '上传中...' : '复制链接'}
                                                >
                                                    {item.isUploadingToGyazo ? <Loader2 size={12} className="animate-spin" /> : (isCopied(item.id, 'link') ? <Check size={12} /> : <Link size={12} />)}
                                                </button>
                                                <button
                                                    onClick={() => copyFormula(item)}
                                                    className={`p-1.5 rounded transition-colors tooltip-bottom ${isCopied(item.id, 'formula')
                                                        ? 'text-emerald-400 bg-emerald-900/20'
                                                        : 'text-zinc-400 hover:text-orange-400 hover:bg-zinc-800'
                                                        }`}
                                                    data-tip="复制公式"
                                                >
                                                    {isCopied(item.id, 'formula') ? <Check size={12} /> : <FileCode size={12} />}
                                                </button>
                                                {workMode === 'split' ? (
                                                    item.status === 'success' && (
                                                        <>
                                                            <button
                                                                onClick={() => copySplitResultLang(item, 'zh')}
                                                                className={`p-1.5 rounded transition-colors tooltip-bottom text-[9px] font-bold ${isCopied(item.id, 'result-zh')
                                                                    ? 'text-emerald-400 bg-emerald-900/20'
                                                                    : 'text-zinc-400 hover:text-orange-400 hover:bg-zinc-800'
                                                                    }`}
                                                                data-tip="复制中文描述"
                                                            >
                                                                {isCopied(item.id, 'result-zh') ? <Check size={12} /> : <span>中</span>}
                                                            </button>
                                                            <button
                                                                onClick={() => copySplitResultLang(item, 'en')}
                                                                className={`p-1.5 rounded transition-colors tooltip-bottom text-[9px] font-bold ${isCopied(item.id, 'result-en')
                                                                    ? 'text-emerald-400 bg-emerald-900/20'
                                                                    : 'text-zinc-400 hover:text-blue-400 hover:bg-zinc-800'
                                                                    }`}
                                                                data-tip="复制英文描述"
                                                            >
                                                                {isCopied(item.id, 'result-en') ? <Check size={12} /> : <span>EN</span>}
                                                            </button>
                                                        </>
                                                    )
                                                ) : (
                                                    <button
                                                        onClick={() => (workMode === 'creative' || workMode === 'quick') ? copyCreativeResult(item) : copyResult(item)}
                                                        disabled={(workMode === 'creative' || workMode === 'quick')
                                                            ? !(creativeResults.find(r => r.imageId === item.id)?.status === 'success')
                                                            : item.status !== 'success'}
                                                        className={`p-1.5 rounded transition-colors disabled:opacity-30 tooltip-bottom ${isCopied(item.id, 'result')
                                                            ? 'text-emerald-400 bg-emerald-900/20'
                                                            : 'text-zinc-400 hover:text-emerald-400 hover:bg-zinc-800'
                                                            }`}
                                                        data-tip={(workMode === 'creative' || workMode === 'quick') ? '复制所有创新结果' : '复制结果'}
                                                    >
                                                        {isCopied(item.id, 'result') ? <Check size={12} /> : <Copy size={12} />}
                                                    </button>
                                                )}
                                                {/* 发送到提示词创新 - 创新模式下隐藏 */}
                                                {workMode !== 'creative' && workMode !== 'split' && item.status === 'success' && onSendToDesc && (
                                                    <button
                                                        onClick={() => onSendToDesc(item.id)}
                                                        className={`p-1.5 rounded transition-colors tooltip-bottom ${sentToDescIds?.includes(item.id)
                                                            ? 'text-emerald-300 bg-emerald-700/20 border border-emerald-500/40'
                                                            : 'text-blue-300 hover:text-white hover:bg-blue-500/30'
                                                            }`}
                                                        data-tip={sentToDescIds?.includes(item.id) ? '已发送' : '发送到提示词创新'}
                                                    >
                                                        {sentToDescIds?.includes(item.id) ? <Check size={12} /> : <Share2 size={12} />}
                                                    </button>
                                                )}
                                                {/* 对话按钮 - 创新模式下隐藏 */}
                                                {workMode !== 'creative' && item.status === 'success' && onToggleChat && (
                                                    <button
                                                        onClick={() => onToggleChat(item.id)}
                                                        className={`p-1.5 rounded transition-colors tooltip-bottom ${item.isChatOpen
                                                            ? 'text-blue-400 bg-blue-500/30 ring-2 ring-blue-400/50'
                                                            : 'text-blue-400 hover:bg-zinc-800'
                                                            }`}
                                                        data-tip="继续对话"
                                                    >
                                                        <MessageCircle size={12} />
                                                    </button>
                                                )}
                                                {workMode !== 'split' && (workMode === 'creative' ? (
                                                    // 创新模式：放大查看按钮
                                                    <button
                                                        onClick={() => setExpandedResultItem(item)}
                                                        disabled={!(creativeResults.find(r => r.imageId === item.id)?.status === 'success')}
                                                        className="p-1.5 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/20 rounded transition-colors tooltip-bottom disabled:opacity-30 disabled:cursor-not-allowed"
                                                        data-tip="放大查看"
                                                    >
                                                        <Maximize2 size={12} />
                                                    </button>
                                                ) : (
                                                    // 标准模式：创新按钮
                                                    item.status === 'success' && onToggleInnovation && (
                                                        <button
                                                            onClick={() => onToggleInnovation(item.id)}
                                                            className={`p-1.5 rounded transition-colors tooltip-bottom ${item.isInnovationOpen
                                                                ? 'text-cyan-400 bg-cyan-500/30 ring-2 ring-cyan-400/50'
                                                                : (hasInnovationOutputs
                                                                    ? 'text-cyan-400 bg-cyan-900/20'
                                                                    : 'text-cyan-400 hover:bg-zinc-800')
                                                                }`}
                                                            data-tip={hasInnovationOutputs ? "查看创新结果" : "创新提示词"}
                                                        >
                                                            <Sparkles size={12} fill={!item.isInnovationOpen && hasInnovationOutputs ? "currentColor" : "none"} fillOpacity={!item.isInnovationOpen && hasInnovationOutputs ? 0.2 : 0} />
                                                        </button>
                                                    )
                                                ))}
                                                {/* 重试按钮 */}
                                                {item.status === 'success' && (
                                                    <button
                                                        onClick={() => onRetry(item.id)}
                                                        className="p-1.5 text-zinc-500 hover:text-emerald-400 transition-colors rounded hover:bg-zinc-800 tooltip-bottom"
                                                        data-tip={(workMode === 'creative' || workMode === 'quick') ? "重新创新" : "重新识别"}
                                                    >
                                                        <RotateCw size={12} />
                                                    </button>
                                                )}
                                            </>
                                        )}
                                        {workMode === 'quick' && (
                                            <button
                                                onClick={() => setExpandedEditCardId(item.id)}
                                                className="p-1.5 text-cyan-400 hover:text-cyan-300 hover:bg-cyan-500/20 rounded transition-colors tooltip-bottom"
                                                data-tip="放大编辑卡片"
                                            >
                                                <Maximize2 size={12} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Resizer Handle - 当有面板打开时显示 */}
                                {(item.isChatOpen || item.isInnovationOpen) && (
                                    <div
                                        className="w-1 bg-zinc-900 hover:bg-blue-500/50 cursor-col-resize flex-shrink-0 transition-colors z-10 border-l border-zinc-800"
                                        onMouseDown={startResizing}
                                    />
                                )}

                                {/* 右侧：对话面板 */}
                                {item.isChatOpen && (
                                    <div
                                        className="flex flex-col min-w-0 min-h-0"
                                        style={(item.isChatOpen && item.isInnovationOpen) ? { flex: `${chatPanelRatio[item.id] ?? 50} 1 0%` } : { flex: '1 1 0%' }}
                                    >
                                        <MemoizedChatPanel
                                            item={item}
                                            onToggleChat={onToggleChat}
                                            onSendMessage={onSendMessage}
                                            onUpdateChatInput={onUpdateChatInput}
                                            onCopyChatHistory={onCopyChatHistory}
                                            onUpdateChatAttachments={onUpdateChatAttachments}
                                            onToggleMinimize={toggleMinimize}
                                            isMinimized={!!minimizedChats[item.id]}
                                            isCompact={true}
                                        />
                                    </div>
                                )}

                                {/* 面板之间的分隔条 - 仅当两个面板都打开时显示 */}
                                {item.isChatOpen && item.isInnovationOpen && (
                                    <div
                                        className="w-1 bg-zinc-900 hover:bg-cyan-500/50 cursor-col-resize flex-shrink-0 transition-colors z-10"
                                        onMouseDown={(e) => {
                                            e.preventDefault();
                                            setIsResizing(true);
                                            const startX = e.clientX;
                                            const container = document.getElementById(`grid-card-${item.id}`);
                                            const containerWidth = container?.offsetWidth || 400;
                                            const startRatio = chatPanelRatio[item.id] ?? 50;

                                            const onMouseMove = (moveEvent: MouseEvent) => {
                                                const deltaX = moveEvent.clientX - startX;
                                                const deltaPercent = (deltaX / containerWidth) * 100;
                                                const newRatio = Math.max(20, Math.min(80, startRatio + deltaPercent));
                                                setChatPanelRatio(prev => ({ ...prev, [item.id]: newRatio }));
                                            };

                                            const onMouseUp = () => {
                                                setIsResizing(false);
                                                document.removeEventListener('mousemove', onMouseMove);
                                                document.removeEventListener('mouseup', onMouseUp);
                                                document.body.style.cursor = '';
                                                document.body.style.userSelect = '';
                                            };

                                            document.addEventListener('mousemove', onMouseMove);
                                            document.addEventListener('mouseup', onMouseUp);
                                            document.body.style.cursor = 'col-resize';
                                            document.body.style.userSelect = 'none';
                                        }}
                                    />
                                )}

                                {/* 右侧：创新面板 */}
                                {item.isInnovationOpen && (
                                    <div
                                        className="flex flex-col min-w-0 min-h-0"
                                        style={(item.isChatOpen && item.isInnovationOpen) ? { flex: `${100 - (chatPanelRatio[item.id] ?? 50)} 1 0%` } : { flex: '1 1 0%' }}
                                    >
                                        <InnovationPanel
                                            item={item}
                                            onToggleInnovation={onToggleInnovation}
                                            onStartInnovation={onStartInnovation}
                                            onCopyInnovation={onCopyInnovation}
                                            isCompact={true}
                                            onToggleMinimize={toggleMinimize}
                                            isMinimized={!!minimizedChats[item.id]}
                                            globalInnovationInstruction={globalInnovationInstruction}
                                            defaultInnovationInstruction={defaultInnovationInstruction}
                                            onUpdateCustomInnovationInstruction={onUpdateCustomInnovationInstruction}
                                            onUpdateCustomInnovationCount={onUpdateCustomInnovationCount}
                                            onUpdateCustomInnovationRounds={onUpdateCustomInnovationRounds}
                                            onUpdateCustomInnovationTemplateId={onUpdateCustomInnovationTemplateId}
                                            templateState={templateState}
                                            unifiedPresets={unifiedPresets}
                                            onToggleInnovationChat={onToggleInnovationChat}
                                            onSendInnovationMessage={onSendInnovationMessage}
                                            onUpdateInnovationInput={onUpdateInnovationInput}
                                            onCopyInnovationChatHistory={onCopyInnovationChatHistory}
                                            onUpdateInnovationAttachments={onUpdateInnovationAttachments}
                                        />
                                    </div>
                                )}
                            </div>

                            {/* Vertical Resizer Handle - 始终显示，支持调整卡片高度 */}
                            <div
                                className="h-1.5 w-full bg-zinc-950 hover:bg-zinc-800 cursor-row-resize flex items-center justify-center z-20 group/resizer"
                                onMouseDown={(e) => startResizingHeight(e, item.id)}
                            >
                                <div className="w-10 h-0.5 bg-zinc-700 rounded-full group-hover/resizer:bg-blue-500 transition-colors" />
                            </div>

                            {/* 单独提示词面板 */}
                            <MemoizedCustomPromptPanel
                                item={item}
                                presets={presets}
                                onUpdateCustomPrompt={onUpdateCustomPrompt}
                                onApplyPreset={onApplyPreset}
                                onToggleMergeMode={onToggleMergeMode}
                                globalUserPrompt={globalUserPrompt}
                                baseInstruction={baseInstruction}
                                overrideDimsWithImages={overrideDimsWithImages}
                                onUpdateCardRefSelection={onUpdateCardRefSelection}
                                overrideDimNames={overrideDimNames}
                                globalOverrideCounts={globalOverrideCounts}
                                onUpdateCardOverrideCount={onUpdateCardOverrideCount}
                                onUpdateCardTextOverride={onUpdateCardTextOverride}
                                allEnabledDimNames={allEnabledDimNames}
                                onUpdateRefImageConfig={onUpdateRefImageConfig}
                                onRemoveFusionImage={onRemoveFusionImage}
                                onAddFusionImage={onAddFusionImage}
                                onStartInnovation={onStartInnovation}
                                workMode={workMode}
                            />

                            {/* 右下角调整大小手柄 */}
                            <div
                                className="absolute bottom-0 right-0 w-4 h-4 cursor-se-resize z-30 group/corner"
                                onMouseDown={(e) => {
                                    // 同时调整宽度和高度
                                    e.preventDefault();
                                    setIsResizing(true);
                                    const startX = e.clientX;
                                    const startY = e.clientY;
                                    const cardElement = document.getElementById(`grid-card-${item.id}`);
                                    const containerElement = document.getElementById(`card-container-${item.id}`);

                                    // 获取当前实际渲染的尺寸
                                    const currentWidth = cardElement?.offsetWidth || 400;
                                    const currentHeight = containerElement?.offsetHeight || ((item.isChatOpen || item.isInnovationOpen) ? 360 : 300);

                                    // 使用已记录的值或当前渲染值
                                    const startWidth = cardWidths[item.id] || currentWidth;
                                    const startHeight = panelHeights[item.id] || currentHeight;

                                    // 关键修复：如果是第一次拖拽，先把当前尺寸设置到 state，避免 CSS 模式切换导致的跳变
                                    if (!cardWidths[item.id]) {
                                        setCardWidths(prev => ({ ...prev, [item.id]: currentWidth }));
                                    }
                                    if (!panelHeights[item.id]) {
                                        setPanelHeights(prev => ({ ...prev, [item.id]: currentHeight }));
                                    }

                                    const onMouseMove = (moveEvent: MouseEvent) => {
                                        const deltaX = moveEvent.clientX - startX;
                                        const deltaY = moveEvent.clientY - startY;
                                        const newWidth = Math.max(280, startWidth + deltaX);
                                        const newHeight = Math.max(200, startHeight + deltaY);
                                        setCardWidths(prev => ({ ...prev, [item.id]: newWidth }));
                                        setPanelHeights(prev => ({ ...prev, [item.id]: newHeight }));
                                    };

                                    const onMouseUp = () => {
                                        setIsResizing(false);
                                        document.removeEventListener('mousemove', onMouseMove);
                                        document.removeEventListener('mouseup', onMouseUp);
                                        document.body.style.cursor = '';
                                        document.body.style.userSelect = '';
                                    };

                                    document.addEventListener('mousemove', onMouseMove);
                                    document.addEventListener('mouseup', onMouseUp);
                                    document.body.style.cursor = 'se-resize';
                                    document.body.style.userSelect = 'none';
                                }}
                            >
                                {/* 角落手柄视觉指示器 */}
                                <div className="absolute bottom-1 right-1 w-2 h-2 border-r-2 border-b-2 border-zinc-600 group-hover/corner:border-blue-400 transition-colors" />
                            </div>
                        </div>
                    );
                })}
            </div>
        </>
    );
};

export default ResultsGrid;
