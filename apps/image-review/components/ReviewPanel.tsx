/**
 * 审核面板组件 - 状态选择、反馈输入、翻译预览
 */
import React, { useState, useCallback } from 'react';
import { Check, X, Edit3, Ban, Loader2, Copy, RefreshCw, Sparkles, ChevronDown, ChevronUp } from 'lucide-react';
import { ImageReview, ReviewStatus, REVIEW_STATUS_CONFIG, QuickPhrase, TranslationResult } from '../types';
import { translateFeedback, formatTranslationForCopy } from '../services/translationService';

interface ReviewPanelProps {
    image: ImageReview | null;
    quickPhrases: QuickPhrase[];
    onStatusChange: (status: ReviewStatus) => void;
    onFeedbackChange: (feedback: string) => void;
    onTranslationComplete: (translation: TranslationResult) => void;
}

const ReviewPanel: React.FC<ReviewPanelProps> = ({
    image,
    quickPhrases,
    onStatusChange,
    onFeedbackChange,
    onTranslationComplete,
}) => {
    const [isTranslating, setIsTranslating] = useState(false);
    const [copySuccess, setCopySuccess] = useState<string | null>(null);
    const [showQuickPhrases, setShowQuickPhrases] = useState(false);

    // 翻译反馈
    const handleTranslate = useCallback(async () => {
        if (!image?.feedbackCn.trim()) return;

        setIsTranslating(true);
        try {
            const result = await translateFeedback(image.feedbackCn);
            onTranslationComplete(result);
        } catch (error) {
            console.error('翻译失败:', error);
        } finally {
            setIsTranslating(false);
        }
    }, [image?.feedbackCn, onTranslationComplete]);

    // 复制翻译结果
    const handleCopy = useCallback(async (format: 'english-only' | 'with-back' | 'full') => {
        if (!image?.translation) return;

        const text = formatTranslationForCopy(image.translation, format);
        await navigator.clipboard.writeText(text);
        setCopySuccess(format);
        setTimeout(() => setCopySuccess(null), 2000);
    }, [image?.translation]);

    // 添加快捷短语
    const handleAddQuickPhrase = useCallback((phrase: string) => {
        if (!image) return;
        const newFeedback = image.feedbackCn
            ? `${image.feedbackCn}，${phrase}`
            : phrase;
        onFeedbackChange(newFeedback);
    }, [image, onFeedbackChange]);

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

    // 按类别分组快捷短语
    const phraseCategories = quickPhrases.reduce((acc, phrase) => {
        if (!acc[phrase.category]) acc[phrase.category] = [];
        acc[phrase.category].push(phrase);
        return acc;
    }, {} as Record<string, QuickPhrase[]>);

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

            {/* 反馈输入 */}
            <div className="flex-1 p-4 overflow-y-auto space-y-4">
                {/* 中文反馈 */}
                <div>
                    <div className="flex items-center justify-between mb-2">
                        <label className="text-sm font-medium text-zinc-300">📝 中文反馈</label>
                        <button
                            onClick={() => setShowQuickPhrases(!showQuickPhrases)}
                            className="text-xs text-teal-400 hover:text-teal-300 flex items-center gap-1"
                        >
                            <Sparkles size={12} />
                            快捷短语
                            {showQuickPhrases ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
                        </button>
                    </div>

                    {/* 快捷短语面板 */}
                    {showQuickPhrases && (
                        <div className="mb-3 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50">
                            {Object.entries(phraseCategories).map(([category, phrases]) => (
                                <div key={category} className="mb-2 last:mb-0">
                                    <span className="text-xs text-zinc-500">{category}:</span>
                                    <div className="flex flex-wrap gap-1 mt-1">
                                        {phrases.map(phrase => (
                                            <button
                                                key={phrase.id}
                                                onClick={() => handleAddQuickPhrase(phrase.text)}
                                                className="px-2 py-0.5 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded transition-colors"
                                            >
                                                {phrase.text}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}

                    <textarea
                        value={image.feedbackCn}
                        onChange={(e) => onFeedbackChange(e.target.value)}
                        placeholder="输入反馈建议（中文）..."
                        className="w-full h-28 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-zinc-100 placeholder-zinc-500 resize-none focus:outline-none focus:border-teal-500"
                    />

                    <button
                        onClick={handleTranslate}
                        disabled={!image.feedbackCn.trim() || isTranslating}
                        className="mt-2 w-full flex items-center justify-center gap-2 px-4 py-2 bg-teal-600 hover:bg-teal-700 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg transition-colors"
                    >
                        {isTranslating ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                翻译中...
                            </>
                        ) : (
                            <>
                                <RefreshCw size={16} />
                                翻译为英文
                            </>
                        )}
                    </button>
                </div>

                {/* 翻译结果 */}
                {image.translation && (
                    <div className="space-y-3">
                        {/* 英文翻译 */}
                        <div>
                            <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                🔤 英文翻译
                                <button
                                    onClick={() => handleCopy('english-only')}
                                    className="text-xs text-zinc-500 hover:text-zinc-300"
                                    title="复制英文"
                                >
                                    <Copy size={12} />
                                </button>
                                {copySuccess === 'english-only' && (
                                    <span className="text-xs text-emerald-400">已复制!</span>
                                )}
                            </label>
                            <div className="mt-1 p-3 bg-blue-900/20 border border-blue-700/30 rounded-lg text-blue-200 text-sm">
                                {image.translation.english}
                            </div>
                        </div>

                        {/* 回译确认 */}
                        <div>
                            <label className="text-sm font-medium text-zinc-300 flex items-center gap-2">
                                🔙 回译确认
                                {image.translation.isAccurate ? (
                                    <span className="text-xs text-emerald-400 flex items-center gap-1">
                                        <Check size={12} /> 准确
                                    </span>
                                ) : (
                                    <span className="text-xs text-amber-400 flex items-center gap-1">
                                        ⚠️ 可能有偏差
                                    </span>
                                )}
                            </label>
                            <div className={`mt-1 p-3 rounded-lg text-sm ${image.translation.isAccurate
                                ? 'bg-emerald-900/20 border border-emerald-700/30 text-emerald-200'
                                : 'bg-amber-900/20 border border-amber-700/30 text-amber-200'
                                }`}>
                                {image.translation.backTranslation}
                            </div>
                        </div>

                        {/* 复制选项 */}
                        <div className="flex gap-2">
                            <button
                                onClick={() => handleCopy('english-only')}
                                className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
                            >
                                复制英文
                            </button>
                            <button
                                onClick={() => handleCopy('with-back')}
                                className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
                            >
                                复制英文+回译
                            </button>
                            <button
                                onClick={() => handleCopy('full')}
                                className="flex-1 px-3 py-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors"
                            >
                                复制全部
                            </button>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ReviewPanel;
