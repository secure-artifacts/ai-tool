/**
 * 增强版审核面板组件 - 支持双栏反馈（问题+建议）
 * 
 * 新增功能：
 * - 预设常用语（预翻译语料库）
 * - 参考图贴入
 * - 取色器
 */
import React, { useState, useCallback, useRef } from 'react';
import {
    Check, X, Edit3, Ban, Loader2, Copy, RefreshCw, Plus, Trash2,
    ChevronDown, ChevronUp, AlertCircle, Palette, Image as ImageIcon,
    BookOpen, Search, Pipette
} from 'lucide-react';
import {
    ImageReview, ReviewStatus, REVIEW_STATUS_CONFIG,
    FeedbackItem, SeverityLevel, SEVERITY_CONFIG,
    TranslationResult, createFeedbackItem
} from '../types';
import { translateFeedback, formatTranslationForCopy } from '../services/translationService';
import { CANNED_PHRASES, PHRASE_CATEGORIES, CannedPhrase, searchPhrases, getPhrasesByCategory } from '../services/cannedPhrases';

interface ReviewPanelProps {
    image: ImageReview | null;
    onStatusChange: (status: ReviewStatus) => void;
    onFeedbackItemsChange: (items: FeedbackItem[]) => void;
    onTranslateAll: () => void;
    isTranslating: boolean;
}

const ReviewPanelEnhanced: React.FC<ReviewPanelProps> = ({
    image,
    onStatusChange,
    onFeedbackItemsChange,
    onTranslateAll,
    isTranslating,
}) => {
    const [expandedItemId, setExpandedItemId] = useState<string | null>(null);
    const [copySuccess, setCopySuccess] = useState<string | null>(null);
    const [showPhraseSelector, setShowPhraseSelector] = useState<string | null>(null);
    const [phraseSearchQuery, setPhraseSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<string>('anatomy');

    const colorInputRef = useRef<HTMLInputElement>(null);
    const refImageInputRef = useRef<HTMLInputElement>(null);

    // 添加反馈项
    const handleAddFeedbackItem = useCallback(() => {
        if (!image) return;
        const newItem = createFeedbackItem('major');
        onFeedbackItemsChange([...image.feedbackItems, newItem]);
        setExpandedItemId(newItem.id);
    }, [image, onFeedbackItemsChange]);

    // 使用预设短语添加反馈项
    const handleAddFromPhrase = useCallback((phrase: CannedPhrase) => {
        if (!image) return;

        const newItem: FeedbackItem = {
            ...createFeedbackItem('major'),
            problemCn: phrase.problemCn,
            suggestionCn: phrase.suggestionCn,
            problemTranslation: {
                original: phrase.problemCn,
                english: phrase.problemEn,
                backTranslation: phrase.problemCn,
                isAccurate: true,
                timestamp: Date.now(),
            },
            suggestionTranslation: {
                original: phrase.suggestionCn,
                english: phrase.suggestionEn,
                backTranslation: phrase.suggestionCn,
                isAccurate: true,
                timestamp: Date.now(),
            },
        };

        onFeedbackItemsChange([...image.feedbackItems, newItem]);
        setExpandedItemId(newItem.id);
        setShowPhraseSelector(null);
        setPhraseSearchQuery('');
    }, [image, onFeedbackItemsChange]);

    // 更新反馈项
    const handleUpdateFeedbackItem = useCallback((
        itemId: string,
        field: keyof FeedbackItem,
        value: any
    ) => {
        if (!image) return;
        const updated = image.feedbackItems.map(item =>
            item.id === itemId ? { ...item, [field]: value } : item
        );
        onFeedbackItemsChange(updated);
    }, [image, onFeedbackItemsChange]);

    // 删除反馈项
    const handleDeleteFeedbackItem = useCallback((itemId: string) => {
        if (!image) return;
        onFeedbackItemsChange(image.feedbackItems.filter(item => item.id !== itemId));
    }, [image, onFeedbackItemsChange]);

    // 翻译单个反馈项
    const handleTranslateItem = useCallback(async (item: FeedbackItem) => {
        if (!item.problemCn.trim() && !item.suggestionCn.trim()) return;

        try {
            const updatedItem = { ...item };

            if (item.problemCn.trim()) {
                updatedItem.problemTranslation = await translateFeedback(item.problemCn);
            }
            if (item.suggestionCn.trim()) {
                updatedItem.suggestionTranslation = await translateFeedback(item.suggestionCn);
            }

            if (image) {
                const updated = image.feedbackItems.map(i =>
                    i.id === item.id ? updatedItem : i
                );
                onFeedbackItemsChange(updated);
            }
        } catch (error) {
            console.error('翻译失败:', error);
        }
    }, [image, onFeedbackItemsChange]);

    // 复制翻译结果
    const handleCopyTranslation = useCallback(async (text: string, id: string) => {
        await navigator.clipboard.writeText(text);
        setCopySuccess(id);
        setTimeout(() => setCopySuccess(null), 2000);
    }, []);

    // 添加参考图
    const handleAddReferenceImage = useCallback((itemId: string, file: File) => {
        const reader = new FileReader();
        reader.onload = (e) => {
            const base64 = e.target?.result as string;
            const url = URL.createObjectURL(file);
            handleUpdateFeedbackItem(itemId, 'referenceImageUrl', url);
            handleUpdateFeedbackItem(itemId, 'referenceImageBase64', base64);
        };
        reader.readAsDataURL(file);
    }, [handleUpdateFeedbackItem]);

    // 处理颜色选择
    const handleColorChange = useCallback((itemId: string, color: string) => {
        handleUpdateFeedbackItem(itemId, 'colorHex', color);

        // 自动更新建议文本
        if (image) {
            const item = image.feedbackItems.find(i => i.id === itemId);
            if (item && !item.suggestionCn.includes(color.toUpperCase())) {
                const newSuggestion = item.suggestionCn
                    ? `${item.suggestionCn}，推荐颜色：${color.toUpperCase()}`
                    : `推荐颜色：${color.toUpperCase()}`;
                handleUpdateFeedbackItem(itemId, 'suggestionCn', newSuggestion);
            }
        }
    }, [image, handleUpdateFeedbackItem]);

    // 获取过滤后的短语
    const filteredPhrases = phraseSearchQuery.trim()
        ? searchPhrases(phraseSearchQuery)
        : getPhrasesByCategory(activeCategory);

    if (!image) {
        return (
            <div className="h-full flex items-center justify-center text-zinc-500">
                <p>选择图片进行审核</p>
            </div>
        );
    }

    const statusButtons: { status: ReviewStatus; icon: React.ReactNode; colorClass: string }[] = [
        { status: 'approved', icon: <Check size={16} />, colorClass: 'bg-emerald-600 hover:bg-emerald-700 border-emerald-500' },
        { status: 'revision', icon: <Edit3 size={16} />, colorClass: 'bg-amber-600 hover:bg-amber-700 border-amber-500' },
        { status: 'rejected', icon: <X size={16} />, colorClass: 'bg-red-600 hover:bg-red-700 border-red-500' },
    ];

    const severityOptions: SeverityLevel[] = ['critical', 'major', 'minor', 'suggestion'];

    return (
        <div className="h-full flex flex-col bg-zinc-900 border-l border-zinc-800">
            {/* 头部 - 状态选择 */}
            <div className="p-4 border-b border-zinc-800">
                <h3 className="text-sm font-medium text-zinc-300 mb-3">审核状态</h3>
                <div className="flex gap-2">
                    {statusButtons.map(({ status, icon, colorClass }) => {
                        const config = REVIEW_STATUS_CONFIG[status];
                        const isActive = image.status === status;
                        return (
                            <button
                                key={status}
                                onClick={() => onStatusChange(status)}
                                className={`
                                    flex items-center gap-1.5 px-3 py-2 rounded-lg border transition-all
                                    ${isActive
                                        ? `${colorClass} text-white`
                                        : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-700'
                                    }
                                `}
                                title={config.label}
                            >
                                {icon}
                                <span className="text-sm">{config.label}</span>
                            </button>
                        );
                    })}
                </div>
            </div>

            {/* 反馈项列表 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
                <div className="flex items-center justify-between mb-2">
                    <h3 className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                        <AlertCircle size={14} />
                        反馈项 ({image.feedbackItems.length})
                    </h3>
                    <div className="flex gap-1">
                        {/* 快速添加按钮 */}
                        <div className="relative">
                            <button
                                onClick={() => setShowPhraseSelector(showPhraseSelector ? null : 'new')}
                                className="flex items-center gap-1 px-2 py-1 bg-purple-600 hover:bg-purple-700 text-white rounded text-xs transition-colors"
                                title="从常用语添加"
                            >
                                <BookOpen size={12} />
                                常用语
                            </button>

                            {/* 常用语选择器 */}
                            {showPhraseSelector === 'new' && (
                                <div className="absolute right-0 top-full mt-1 w-80 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50 max-h-96 overflow-hidden flex flex-col">
                                    {/* 搜索框 */}
                                    <div className="p-2 border-b border-zinc-700">
                                        <div className="relative">
                                            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                                            <input
                                                type="text"
                                                value={phraseSearchQuery}
                                                onChange={(e) => setPhraseSearchQuery(e.target.value)}
                                                placeholder="搜索常用语..."
                                                className="w-full pl-7 pr-3 py-1.5 bg-zinc-700 border border-zinc-600 rounded text-sm text-white placeholder-zinc-500"
                                                autoFocus
                                            />
                                        </div>
                                    </div>

                                    {/* 分类标签 */}
                                    {!phraseSearchQuery && (
                                        <div className="flex gap-1 p-2 border-b border-zinc-700 overflow-x-auto">
                                            {PHRASE_CATEGORIES.map(cat => (
                                                <button
                                                    key={cat.id}
                                                    onClick={() => setActiveCategory(cat.id)}
                                                    className={`px-2 py-1 rounded text-xs whitespace-nowrap transition-colors ${activeCategory === cat.id
                                                        ? 'bg-teal-600 text-white'
                                                        : 'bg-zinc-700 text-zinc-400 hover:text-white'
                                                        }`}
                                                >
                                                    {cat.label}
                                                </button>
                                            ))}
                                        </div>
                                    )}

                                    {/* 短语列表 */}
                                    <div className="flex-1 overflow-y-auto p-2 space-y-1 max-h-60">
                                        {filteredPhrases.map(phrase => (
                                            <button
                                                key={phrase.id}
                                                onClick={() => handleAddFromPhrase(phrase)}
                                                className="w-full text-left p-2 rounded hover:bg-zinc-700 transition-colors"
                                            >
                                                <div className="flex items-center gap-2">
                                                    <span>{phrase.icon}</span>
                                                    <span className="text-sm text-white">{phrase.labelCn}</span>
                                                    <span className="text-xs text-zinc-500">({phrase.labelEn})</span>
                                                </div>
                                                <p className="text-xs text-zinc-400 mt-1 line-clamp-1">
                                                    {phrase.problemEn}
                                                </p>
                                            </button>
                                        ))}
                                        {filteredPhrases.length === 0 && (
                                            <p className="text-center text-zinc-500 text-sm py-4">
                                                未找到匹配的常用语
                                            </p>
                                        )}
                                    </div>
                                </div>
                            )}
                        </div>

                        <button
                            onClick={handleAddFeedbackItem}
                            className="flex items-center gap-1 px-2 py-1 bg-teal-600 hover:bg-teal-700 text-white rounded text-xs transition-colors"
                        >
                            <Plus size={12} />
                            自定义
                        </button>
                    </div>
                </div>

                {image.feedbackItems.length === 0 ? (
                    <div className="text-center py-8 text-zinc-500">
                        <BookOpen size={32} className="mx-auto mb-3 opacity-50" />
                        <p className="mb-2">暂无反馈项</p>
                        <p className="text-xs">点击「常用语」快速添加预翻译的反馈</p>
                    </div>
                ) : (
                    image.feedbackItems.map((item, index) => {
                        const isExpanded = expandedItemId === item.id;
                        const severityConfig = SEVERITY_CONFIG[item.severity];

                        return (
                            <div
                                key={item.id}
                                className={`bg-zinc-800/50 rounded-lg border transition-colors ${isExpanded ? 'border-teal-600/50' : 'border-zinc-700/50'
                                    }`}
                            >
                                {/* 反馈项头部 */}
                                <div
                                    className="flex items-center justify-between p-3 cursor-pointer"
                                    onClick={() => setExpandedItemId(isExpanded ? null : item.id)}
                                >
                                    <div className="flex items-center gap-2">
                                        <span className="text-sm">{severityConfig.icon}</span>
                                        <span className="text-sm text-zinc-300">
                                            反馈 #{index + 1}
                                        </span>
                                        {item.problemCn && (
                                            <span className="text-xs text-zinc-500 truncate max-w-[150px]">
                                                - {item.problemCn}
                                            </span>
                                        )}
                                        {/* 附件指示 */}
                                        {item.referenceImageUrl && (
                                            <span className="text-xs bg-purple-600/30 text-purple-300 px-1.5 py-0.5 rounded">📎</span>
                                        )}
                                        {item.colorHex && (
                                            <span
                                                className="w-4 h-4 rounded border border-zinc-600"
                                                style={{ backgroundColor: item.colorHex }}
                                            />
                                        )}
                                    </div>
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                handleDeleteFeedbackItem(item.id);
                                            }}
                                            className="p-1 text-zinc-500 hover:text-red-400 transition-colors"
                                        >
                                            <Trash2 size={14} />
                                        </button>
                                        {isExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                    </div>
                                </div>

                                {/* 展开的内容 */}
                                {isExpanded && (
                                    <div className="px-3 pb-3 space-y-3 border-t border-zinc-700/50 pt-3">
                                        {/* 严重程度选择 */}
                                        <div>
                                            <label className="text-xs text-zinc-500 mb-1 block">严重程度</label>
                                            <div className="flex gap-1">
                                                {severityOptions.map(sev => {
                                                    const config = SEVERITY_CONFIG[sev];
                                                    return (
                                                        <button
                                                            key={sev}
                                                            onClick={() => handleUpdateFeedbackItem(item.id, 'severity', sev)}
                                                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${item.severity === sev
                                                                ? `bg-${config.color}-600/30 text-${config.color}-300 border border-${config.color}-500/50`
                                                                : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'
                                                                }`}
                                                            style={{
                                                                backgroundColor: item.severity === sev
                                                                    ? sev === 'critical' ? 'rgba(239, 68, 68, 0.2)' :
                                                                        sev === 'major' ? 'rgba(245, 158, 11, 0.2)' :
                                                                            sev === 'minor' ? 'rgba(59, 130, 246, 0.2)' :
                                                                                'rgba(34, 197, 94, 0.2)'
                                                                    : undefined
                                                            }}
                                                        >
                                                            <span>{config.icon}</span>
                                                            <span>{config.label}</span>
                                                        </button>
                                                    );
                                                })}
                                            </div>
                                        </div>

                                        {/* 问题描述 */}
                                        <div>
                                            <label className="text-xs text-zinc-500 mb-1 block">
                                                ❌ 问题描述 (Problem)
                                            </label>
                                            <textarea
                                                value={item.problemCn}
                                                onChange={(e) => handleUpdateFeedbackItem(item.id, 'problemCn', e.target.value)}
                                                placeholder="描述问题是什么..."
                                                className="w-full h-20 px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-zinc-100 placeholder-zinc-500 resize-none text-sm focus:outline-none focus:border-red-500"
                                            />
                                            {item.problemTranslation && (
                                                <div className="mt-2 p-2 bg-red-900/20 border border-red-700/30 rounded text-sm">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-xs text-red-400">English:</span>
                                                        <button
                                                            onClick={() => handleCopyTranslation(item.problemTranslation!.english, `problem-${item.id}`)}
                                                            className="text-xs text-zinc-500 hover:text-zinc-300"
                                                        >
                                                            {copySuccess === `problem-${item.id}` ? '✓' : <Copy size={10} />}
                                                        </button>
                                                    </div>
                                                    <p className="text-red-200">{item.problemTranslation.english}</p>
                                                    <p className="text-xs text-zinc-500 mt-1">
                                                        回译: {item.problemTranslation.backTranslation}
                                                        {item.problemTranslation.isAccurate ? ' ✅' : ' ⚠️'}
                                                    </p>
                                                </div>
                                            )}
                                        </div>

                                        {/* 改进建议 */}
                                        <div>
                                            <label className="text-xs text-zinc-500 mb-1 block">
                                                💡 改进建议 (Suggestion)
                                            </label>
                                            <textarea
                                                value={item.suggestionCn}
                                                onChange={(e) => handleUpdateFeedbackItem(item.id, 'suggestionCn', e.target.value)}
                                                placeholder="建议如何改进..."
                                                className="w-full h-20 px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-zinc-100 placeholder-zinc-500 resize-none text-sm focus:outline-none focus:border-emerald-500"
                                            />
                                            {item.suggestionTranslation && (
                                                <div className="mt-2 p-2 bg-emerald-900/20 border border-emerald-700/30 rounded text-sm">
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-xs text-emerald-400">English:</span>
                                                        <button
                                                            onClick={() => handleCopyTranslation(item.suggestionTranslation!.english, `suggestion-${item.id}`)}
                                                            className="text-xs text-zinc-500 hover:text-zinc-300"
                                                        >
                                                            {copySuccess === `suggestion-${item.id}` ? '✓' : <Copy size={10} />}
                                                        </button>
                                                    </div>
                                                    <p className="text-emerald-200">{item.suggestionTranslation.english}</p>
                                                    <p className="text-xs text-zinc-500 mt-1">
                                                        回译: {item.suggestionTranslation.backTranslation}
                                                        {item.suggestionTranslation.isAccurate ? ' ✅' : ' ⚠️'}
                                                    </p>
                                                </div>
                                            )}
                                        </div>

                                        {/* 附件工具栏 */}
                                        <div className="flex items-center gap-2 pt-2 border-t border-zinc-700/50">
                                            {/* 参考图 */}
                                            <input
                                                type="file"
                                                ref={refImageInputRef}
                                                accept="image/*"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (file) handleAddReferenceImage(item.id, file);
                                                    e.target.value = '';
                                                }}
                                            />
                                            <button
                                                onClick={() => refImageInputRef.current?.click()}
                                                className="flex items-center gap-1.5 px-2 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition-colors"
                                                title="添加参考图"
                                            >
                                                <ImageIcon size={12} />
                                                {item.referenceImageUrl ? '更换参考图' : '参考图'}
                                            </button>

                                            {/* 取色器 */}
                                            <div className="relative">
                                                <input
                                                    type="color"
                                                    ref={colorInputRef}
                                                    value={item.colorHex || '#ff0000'}
                                                    onChange={(e) => handleColorChange(item.id, e.target.value)}
                                                    className="absolute opacity-0 w-0 h-0"
                                                />
                                                <button
                                                    onClick={() => colorInputRef.current?.click()}
                                                    className="flex items-center gap-1.5 px-2 py-1.5 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded text-xs transition-colors"
                                                    title="选取颜色"
                                                >
                                                    <Pipette size={12} />
                                                    {item.colorHex ? (
                                                        <>
                                                            <span
                                                                className="w-3 h-3 rounded border border-zinc-500"
                                                                style={{ backgroundColor: item.colorHex }}
                                                            />
                                                            <span className="font-mono">{item.colorHex.toUpperCase()}</span>
                                                        </>
                                                    ) : (
                                                        '颜色'
                                                    )}
                                                </button>
                                            </div>
                                        </div>

                                        {/* 参考图预览 */}
                                        {item.referenceImageUrl && (
                                            <div className="relative">
                                                <label className="text-xs text-zinc-500 mb-1 block flex items-center gap-1">
                                                    📎 参考图 (Like this)
                                                </label>
                                                <div className="relative inline-block">
                                                    <img
                                                        src={item.referenceImageUrl}
                                                        alt="Reference"
                                                        className="max-h-32 rounded border border-zinc-600"
                                                    />
                                                    <button
                                                        onClick={() => {
                                                            handleUpdateFeedbackItem(item.id, 'referenceImageUrl', undefined);
                                                            handleUpdateFeedbackItem(item.id, 'referenceImageBase64', undefined);
                                                        }}
                                                        className="absolute -top-2 -right-2 w-5 h-5 bg-red-600 rounded-full flex items-center justify-center text-white hover:bg-red-700"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            </div>
                                        )}

                                        {/* 翻译按钮 */}
                                        <button
                                            onClick={() => handleTranslateItem(item)}
                                            disabled={!item.problemCn.trim() && !item.suggestionCn.trim()}
                                            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg text-sm transition-colors"
                                        >
                                            <RefreshCw size={14} />
                                            翻译此条
                                        </button>
                                    </div>
                                )}
                            </div>
                        );
                    })
                )}
            </div>

            {/* 底部操作栏 */}
            <div className="p-4 border-t border-zinc-800 space-y-2">
                <button
                    onClick={onTranslateAll}
                    disabled={isTranslating || image.feedbackItems.length === 0}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 bg-teal-600 hover:bg-teal-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors"
                >
                    {isTranslating ? (
                        <>
                            <Loader2 size={16} className="animate-spin" />
                            翻译中...
                        </>
                    ) : (
                        <>
                            <RefreshCw size={16} />
                            翻译所有反馈 ({image.feedbackItems.length})
                        </>
                    )}
                </button>
            </div>

            {/* 点击外部关闭选择器 */}
            {showPhraseSelector && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => {
                        setShowPhraseSelector(null);
                        setPhraseSearchQuery('');
                    }}
                />
            )}
        </div>
    );
};

export default ReviewPanelEnhanced;
