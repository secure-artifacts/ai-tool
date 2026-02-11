/**
 * 列表审核视图 - 左右分栏大卡片
 * 左：大图（支持缩放和标注）| 右：状态+反馈输入（始终可见）
 */
import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    Check, X, Edit3, Plus, Trash2,
    Search, RefreshCw, Loader2,
    Image as ImageIcon, Eye, Sparkles,
    Square, Circle, ArrowRight, Pencil, Type, Undo2, ZoomIn, ZoomOut,
    ChevronDown, ChevronUp, Hand, Power
} from 'lucide-react';
import {
    ImageReview, ImageGroup, ReviewStatus, REVIEW_STATUS_CONFIG,
    FeedbackItem, SeverityLevel, SEVERITY_CONFIG, createFeedbackItem,
    Annotation, AnnotationType, ANNOTATION_TOOLS
} from '../types';
import { CANNED_PHRASES, PHRASE_CATEGORIES, CannedPhrase, searchPhrases, getPhrasesByCategory } from '../services/cannedPhrases';
import {
    translateFeedback,
    ToneLevel,
    TranslationTargetLanguage,
    getTranslationTargetConfig
} from '../services/translationService';
import { generateOverallSummary, translateSummaryToEnglish } from '../services/aiSummaryService';

// 预设颜色
const PRESET_COLORS = ['#ef4444', '#f97316', '#22c55e', '#3b82f6', '#ffffff'];

// 严重程度选项
const severityOptions: SeverityLevel[] = ['critical', 'major', 'minor', 'suggestion'];


interface ListReviewViewProps {
    images: ImageReview[];
    groups: ImageGroup[];
    selectedIds: string[];
    toneLevel: ToneLevel;
    translationTargetLanguage: TranslationTargetLanguage;
    onStatusChange: (imageId: string, status: ReviewStatus) => void;
    onFeedbackItemsChange: (imageId: string, items: FeedbackItem[]) => void;
    onAnnotationsChange: (imageId: string, annotations: Annotation[]) => void;
    onImageClick: (imageId: string) => void;
    // 新增：删除和选择
    onDeleteImage: (imageId: string) => void;
    onToggleSelect: (imageId: string) => void;
    onSelectAll: () => void;
    onInvertSelection: () => void;
    onClearSelection: () => void;
    // 新增：组管理
    onCreateEmptyGroup: (name: string) => string;
    onAddToGroup: (groupId: string) => void;
    onRemoveFromGroup: (imageId: string) => void;
    onDeleteGroup: (groupId: string) => void;
    onRenameGroup: (groupId: string, newName: string) => void;
    onGroupFeedbackChange: (groupId: string, feedback: string) => void;
    onGroupStatusChange: (groupId: string, status: ReviewStatus) => void;
    // 新增：汇总建议
    overallSummary?: string;
    overallSummaryEn?: string;
    overallSummaryBackTranslation?: string;
    overallSummaryIsAccurate?: boolean;
    onOverallSummaryChange?: (summary: string) => void;
    onOverallSummaryEnChange?: (summary: string) => void;
    onOverallSummaryTranslationUpdate?: (english: string, backTranslation: string, isAccurate: boolean) => void;
}

const ListReviewView: React.FC<ListReviewViewProps> = ({
    images,
    groups,
    selectedIds,
    toneLevel,
    translationTargetLanguage,
    onStatusChange,
    onFeedbackItemsChange,
    onAnnotationsChange,
    onImageClick,
    onDeleteImage,
    onToggleSelect,
    onSelectAll,
    onInvertSelection,
    onClearSelection,
    onCreateEmptyGroup,
    onAddToGroup,
    onRemoveFromGroup,
    onDeleteGroup,
    onRenameGroup,
    onGroupFeedbackChange,
    onGroupStatusChange,
    overallSummary,
    overallSummaryEn,
    overallSummaryBackTranslation,
    overallSummaryIsAccurate,
    onOverallSummaryChange,
    onOverallSummaryEnChange,
    onOverallSummaryTranslationUpdate,
}) => {
    const targetLanguageLabel = getTranslationTargetConfig(translationTargetLanguage).labelEn;
    const [hoveredImageId, setHoveredImageId] = useState<string | null>(null);
    const [showPhraseSelector, setShowPhraseSelector] = useState<string | null>(null);
    const [phraseSearchQuery, setPhraseSearchQuery] = useState('');
    const [activeCategory, setActiveCategory] = useState<string>('aspect');
    const [translatingItemId, setTranslatingItemId] = useState<string | null>(null);
    const [draggingOverRef, setDraggingOverRef] = useState<string | null>(null);
    // 跟踪折叠的项目（未在此集合中的项目默认展开）
    const [collapsedItemIds, setCollapsedItemIds] = useState<Set<string>>(new Set());
    // 缩放：默认开启，仅跟踪禁用的图片
    const [zoomDisabledImages, setZoomDisabledImages] = useState<Set<string>>(new Set());
    // 创建组的内联输入
    const [isCreatingGroup, setIsCreatingGroup] = useState(false);
    const [newGroupName, setNewGroupName] = useState('');
    // 组管理
    const [showGroupPanel, setShowGroupPanel] = useState(false);
    const [filterGroupId, setFilterGroupId] = useState<string | null>(null); // null = 显示全部
    const [editingGroupId, setEditingGroupId] = useState<string | null>(null);
    const [editingGroupName, setEditingGroupName] = useState('');
    // AI 汇总状态
    const [isGeneratingSummary, setIsGeneratingSummary] = useState(false);
    const [isTranslatingSummary, setIsTranslatingSummary] = useState(false);
    const [showSummaryPanel, setShowSummaryPanel] = useState(false); // 默认收起
    const [showSummaryModal, setShowSummaryModal] = useState(false); // 放大编辑弹窗

    // 专业缩放和平移状态
    const [imageTransforms, setImageTransforms] = useState<Record<string, {
        scale: number;
        translateX: number;
        translateY: number;
    }>>({});
    const [isPanning, setIsPanning] = useState(false);
    const [panStart, setPanStart] = useState<{ x: number; y: number } | null>(null);
    // 抓手工具：默认开启，仅跟踪禁用的图片
    const [panDisabledImages, setPanDisabledImages] = useState<Set<string>>(new Set());
    // 拖拽优化：使用 ref 存储拖拽中的 imageId 和实时位移
    const panningImageIdRef = useRef<string | null>(null);
    const panDeltaRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
    const panImageRef = useRef<HTMLDivElement | null>(null);

    // 标注状态
    const [annotatingImageId, setAnnotatingImageId] = useState<string | null>(null);
    const [currentTool, setCurrentTool] = useState<AnnotationType | null>(null);
    const [annotationColor, setAnnotationColor] = useState('#ef4444');
    const [strokeWidth, setStrokeWidth] = useState(3); // 笔触粗细
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
    const canvasRefs = useRef<Record<string, HTMLCanvasElement | null>>({});
    const imageContainerRefs = useRef<Record<string, HTMLDivElement | null>>({});
    const filteredPhrases = phraseSearchQuery.trim()
        ? searchPhrases(phraseSearchQuery)
        : getPhrasesByCategory(activeCategory);

    // 确保每张图片默认有一条反馈项（只处理新添加的图片）
    const processedImagesRef = useRef<Set<string>>(new Set());
    useEffect(() => {
        images.forEach(image => {
            // 只处理未处理过的图片
            if (!processedImagesRef.current.has(image.id) && image.feedbackItems.length === 0) {
                processedImagesRef.current.add(image.id);
                const defaultItem = createFeedbackItem('major');
                onFeedbackItemsChange(image.id, [defaultItem]);
            }
        });
    }, [images, onFeedbackItemsChange]);

    // 添加反馈项
    const handleAddFeedbackItem = (imageId: string) => {
        const image = images.find(img => img.id === imageId);
        if (!image) return;
        const newItem = createFeedbackItem('major');
        onFeedbackItemsChange(imageId, [...image.feedbackItems, newItem]);
    };

    // 使用预设短语添加
    const handleAddFromPhrase = (imageId: string, phrase: CannedPhrase) => {
        const image = images.find(img => img.id === imageId);
        if (!image) return;

        const newItem: FeedbackItem = {
            ...createFeedbackItem('major'),
            problemCn: phrase.problemCn,
            suggestionCn: phrase.suggestionCn,
        };

        // 常用语仅预置英文翻译，目标语言为英文时才直接带入
        if (translationTargetLanguage === 'en') {
            newItem.problemTranslation = {
                original: phrase.problemCn,
                english: phrase.problemEn,
                backTranslation: phrase.problemCn,
                isAccurate: true,
                targetLanguage: 'en',
                targetLanguageLabel: 'English',
                timestamp: Date.now(),
            };
            newItem.suggestionTranslation = {
                original: phrase.suggestionCn,
                english: phrase.suggestionEn,
                backTranslation: phrase.suggestionCn,
                isAccurate: true,
                targetLanguage: 'en',
                targetLanguageLabel: 'English',
                timestamp: Date.now(),
            };
        }

        onFeedbackItemsChange(imageId, [...image.feedbackItems, newItem]);
        setShowPhraseSelector(null);
        setPhraseSearchQuery('');
    };

    // 删除反馈项
    const handleDeleteFeedbackItem = (imageId: string, itemId: string) => {
        const image = images.find(img => img.id === imageId);
        if (!image) return;
        onFeedbackItemsChange(imageId, image.feedbackItems.filter(item => item.id !== itemId));
    };

    // 更新反馈项
    const handleUpdateFeedbackItem = (imageId: string, itemId: string, field: keyof FeedbackItem, value: any) => {
        const image = images.find(img => img.id === imageId);
        if (!image) return;
        const updated = image.feedbackItems.map(item =>
            item.id === itemId ? { ...item, [field]: value } : item
        );
        onFeedbackItemsChange(imageId, updated);
    };

    // 翻译单个反馈（同时翻译问题和建议）
    const handleTranslateItem = async (imageId: string, item: FeedbackItem) => {
        if (!item.suggestionCn && !item.problemCn) {
            alert('请先填写问题描述或改进建议，再进行翻译');
            return;
        }

        setTranslatingItemId(item.id);
        try {
            const image = images.find(img => img.id === imageId);
            if (!image) return;

            let problemResult = item.problemTranslation;
            let suggestionResult = item.suggestionTranslation;

            // 翻译问题描述
            if (item.problemCn) {
                problemResult = await translateFeedback(item.problemCn, undefined, toneLevel, translationTargetLanguage);
            }
            // 翻译建议
            if (item.suggestionCn) {
                suggestionResult = await translateFeedback(item.suggestionCn, undefined, toneLevel, translationTargetLanguage);
            }

            const updated = image.feedbackItems.map(i => {
                if (i.id === item.id) {
                    return {
                        ...i,
                        problemTranslation: problemResult,
                        suggestionTranslation: suggestionResult
                    };
                }
                return i;
            });
            onFeedbackItemsChange(imageId, updated);
        } catch (error) {
            console.error('Translation failed:', error);
        } finally {
            setTranslatingItemId(null);
        }
    };

    // 处理参考图粘贴
    const handleRefImagePaste = async (imageId: string, itemId: string, e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const file = item.getAsFile();
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (event) => {
                        const base64 = event.target?.result as string;
                        handleUpdateFeedbackItem(imageId, itemId, 'referenceImageBase64', base64);
                    };
                    reader.readAsDataURL(file);
                }
                break;
            }
        }
    };

    // 处理参考图拖拽
    const handleRefImageDrop = (imageId: string, itemId: string, e: React.DragEvent) => {
        e.preventDefault();
        setDraggingOverRef(null);

        const files = e.dataTransfer?.files;
        if (files && files.length > 0) {
            const file = files[0];
            if (file.type.startsWith('image/')) {
                const reader = new FileReader();
                reader.onload = (event) => {
                    const base64 = event.target?.result as string;
                    handleUpdateFeedbackItem(imageId, itemId, 'referenceImageBase64', base64);
                };
                reader.readAsDataURL(file);
            }
        }
    };

    // 获取图片变换状态
    const getTransform = (imageId: string) => {
        return imageTransforms[imageId] || { scale: 1, translateX: 0, translateY: 0 };
    };

    // 检查图片缩放是否启用（默认启用）
    const isZoomEnabled = (imageId: string) => !zoomDisabledImages.has(imageId);

    // 检查图片抓手是否启用（默认启用）
    const isPanEnabled = (imageId: string) => !panDisabledImages.has(imageId);

    // 切换缩放开关
    const toggleZoom = (imageId: string) => {
        setZoomDisabledImages(prev => {
            const newSet = new Set(prev);
            if (newSet.has(imageId)) {
                newSet.delete(imageId);
            } else {
                newSet.add(imageId);
                // 禁用时重置变换
                setImageTransforms(p => ({
                    ...p,
                    [imageId]: { scale: 1, translateX: 0, translateY: 0 }
                }));
            }
            return newSet;
        });
    };

    // 切换抓手开关
    const togglePan = (imageId: string) => {
        setPanDisabledImages(prev => {
            const newSet = new Set(prev);
            if (newSet.has(imageId)) {
                newSet.delete(imageId);
            } else {
                newSet.add(imageId);
            }
            return newSet;
        });
    };

    // 使用原生事件监听器处理滚轮缩放 - 为每张启用缩放的图片添加
    useEffect(() => {
        const handlers: Array<{ container: HTMLElement; handler: (e: WheelEvent) => void }> = [];

        images.forEach(image => {
            if (!isZoomEnabled(image.id)) return;

            const container = imageContainerRefs.current[image.id];
            if (!container) return;

            const handleNativeWheel = (e: WheelEvent) => {
                e.preventDefault();
                e.stopPropagation();

                const rect = container.getBoundingClientRect();
                const mouseX = e.clientX - rect.left - rect.width / 2;
                const mouseY = e.clientY - rect.top - rect.height / 2;

                const current = getTransform(image.id);
                const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
                const newScale = Math.max(0.5, Math.min(5, current.scale * zoomFactor));

                const scaleChange = newScale / current.scale;
                const newTranslateX = mouseX - (mouseX - current.translateX) * scaleChange;
                const newTranslateY = mouseY - (mouseY - current.translateY) * scaleChange;

                setImageTransforms(prev => ({
                    ...prev,
                    [image.id]: {
                        scale: newScale,
                        translateX: newTranslateX,
                        translateY: newTranslateY
                    }
                }));
            };

            container.addEventListener('wheel', handleNativeWheel, { passive: false });
            handlers.push({ container, handler: handleNativeWheel });
        });

        return () => {
            handlers.forEach(({ container, handler }) => {
                container.removeEventListener('wheel', handler);
            });
        };
    }, [images, zoomDisabledImages, imageTransforms]);

    // 开始平移（抓手模式启用时可拖拽）
    const handlePanStart = (imageId: string, e: React.MouseEvent) => {
        if (!isPanEnabled(imageId)) return; // 抓手模式必须启用
        if (annotatingImageId === imageId) return; // 标注模式下不平移

        e.preventDefault();
        setIsPanning(true);
        setPanStart({ x: e.clientX, y: e.clientY });
        panningImageIdRef.current = imageId;
        panDeltaRef.current = { x: 0, y: 0 };
        // 找到图片元素
        const container = imageContainerRefs.current[imageId];
        const imgElement = container?.querySelector('img');
        panImageRef.current = imgElement as HTMLDivElement | null;
    };

    // 平移中 - 使用直接 DOM 操作提高性能
    const handlePanMove = (imageId: string, e: React.MouseEvent) => {
        if (!isPanning || !panStart || !isPanEnabled(imageId) || panningImageIdRef.current !== imageId) return;

        const deltaX = e.clientX - panStart.x;
        const deltaY = e.clientY - panStart.y;

        // 累积位移
        panDeltaRef.current = {
            x: panDeltaRef.current.x + deltaX,
            y: panDeltaRef.current.y + deltaY
        };

        // 直接操作 DOM，避免 React 重新渲染
        if (panImageRef.current) {
            const current = getTransform(imageId);
            const newX = current.translateX + panDeltaRef.current.x;
            const newY = current.translateY + panDeltaRef.current.y;
            panImageRef.current.style.transform = `scale(${current.scale}) translate(${newX}px, ${newY}px)`;
        }

        setPanStart({ x: e.clientX, y: e.clientY });
    };

    // 结束平移 - 将最终位置同步到 state
    const handlePanEnd = () => {
        if (panningImageIdRef.current && (panDeltaRef.current.x !== 0 || panDeltaRef.current.y !== 0)) {
            const imageId = panningImageIdRef.current;
            const delta = panDeltaRef.current;
            const current = getTransform(imageId);

            setImageTransforms(prev => ({
                ...prev,
                [imageId]: {
                    ...current,
                    translateX: current.translateX + delta.x,
                    translateY: current.translateY + delta.y
                }
            }));
        }

        setIsPanning(false);
        setPanStart(null);
        panningImageIdRef.current = null;
        panDeltaRef.current = { x: 0, y: 0 };
        panImageRef.current = null;
    };

    // 重置缩放
    const resetZoom = (imageId: string) => {
        setImageTransforms(prev => ({
            ...prev,
            [imageId]: { scale: 1, translateX: 0, translateY: 0 }
        }));
    };

    // 缩放控制
    const zoomIn = (imageId: string) => {
        const current = getTransform(imageId);
        setImageTransforms(prev => ({
            ...prev,
            [imageId]: { ...current, scale: Math.min(5, current.scale * 1.2) }
        }));
    };

    const zoomOut = (imageId: string) => {
        const current = getTransform(imageId);
        setImageTransforms(prev => ({
            ...prev,
            [imageId]: { ...current, scale: Math.max(0.5, current.scale / 1.2) }
        }));
    };

    // 工具图标组件
    const ToolIcon: React.FC<{ type: AnnotationType; size?: number }> = ({ type, size = 14 }) => {
        switch (type) {
            case 'rectangle': return <Square size={size} />;
            case 'circle': return <Circle size={size} />;
            case 'arrow': return <ArrowRight size={size} />;
            case 'freehand': return <Pencil size={size} />;
            case 'text': return <Type size={size} />;
        }
    };

    // 绘制标注
    const drawAnnotations = useCallback((canvas: HTMLCanvasElement, annotations: Annotation[], tempPoints?: { x: number; y: number }[], tempTool?: AnnotationType) => {
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        ctx.clearRect(0, 0, canvas.width, canvas.height);

        const drawOne = (annotation: Annotation) => {
            ctx.strokeStyle = annotation.color;
            ctx.fillStyle = annotation.color;
            ctx.lineWidth = annotation.strokeWidth;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';

            const { type, points } = annotation;

            switch (type) {
                case 'rectangle':
                    if (points.length >= 2) {
                        const [start, end] = points;
                        ctx.strokeRect(start.x, start.y, end.x - start.x, end.y - start.y);
                    }
                    break;
                case 'circle':
                    if (points.length >= 2) {
                        const [center, edge] = points;
                        const radius = Math.sqrt(Math.pow(edge.x - center.x, 2) + Math.pow(edge.y - center.y, 2));
                        ctx.beginPath();
                        ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
                        ctx.stroke();
                    }
                    break;
                case 'arrow':
                    if (points.length >= 2) {
                        const [start, end] = points;
                        const headLength = 15;
                        const angle = Math.atan2(end.y - start.y, end.x - start.x);
                        ctx.beginPath();
                        ctx.moveTo(start.x, start.y);
                        ctx.lineTo(end.x, end.y);
                        ctx.stroke();
                        ctx.beginPath();
                        ctx.moveTo(end.x, end.y);
                        ctx.lineTo(end.x - headLength * Math.cos(angle - Math.PI / 6), end.y - headLength * Math.sin(angle - Math.PI / 6));
                        ctx.lineTo(end.x - headLength * Math.cos(angle + Math.PI / 6), end.y - headLength * Math.sin(angle + Math.PI / 6));
                        ctx.closePath();
                        ctx.fill();
                    }
                    break;
                case 'freehand':
                    if (points.length > 1) {
                        ctx.beginPath();
                        ctx.moveTo(points[0].x, points[0].y);
                        points.slice(1).forEach(point => ctx.lineTo(point.x, point.y));
                        ctx.stroke();
                    }
                    break;
                case 'text':
                    if (points.length > 0 && annotation.text) {
                        ctx.font = '16px sans-serif';
                        ctx.fillText(annotation.text, points[0].x, points[0].y);
                    }
                    break;
            }
        };

        annotations.forEach(drawOne);

        // 绘制临时标注
        if (tempPoints && tempPoints.length > 0 && tempTool) {
            drawOne({
                id: 'temp',
                type: tempTool,
                points: tempPoints,
                color: annotationColor,
                strokeWidth: strokeWidth,
            });
        }
    }, [annotationColor, strokeWidth]);

    // 标注鼠标事件
    const getCanvasCoords = (canvas: HTMLCanvasElement, e: React.MouseEvent): { x: number; y: number } => {
        const rect = canvas.getBoundingClientRect();
        const scaleX = canvas.width / rect.width;
        const scaleY = canvas.height / rect.height;
        return {
            x: (e.clientX - rect.left) * scaleX,
            y: (e.clientY - rect.top) * scaleY,
        };
    };

    const handleCanvasMouseDown = (imageId: string, e: React.MouseEvent) => {
        if (!currentTool || annotatingImageId !== imageId) return;
        const canvas = canvasRefs.current[imageId];
        if (!canvas) return;

        const coords = getCanvasCoords(canvas, e);
        setIsDrawing(true);
        setCurrentPoints([coords]);
    };

    const handleCanvasMouseMove = (imageId: string, e: React.MouseEvent) => {
        if (!isDrawing || !currentTool || annotatingImageId !== imageId) return;
        const canvas = canvasRefs.current[imageId];
        if (!canvas) return;

        const coords = getCanvasCoords(canvas, e);
        if (currentTool === 'freehand') {
            setCurrentPoints(prev => [...prev, coords]);
        } else {
            setCurrentPoints(prev => [prev[0], coords]);
        }
    };

    const handleCanvasMouseUp = (imageId: string) => {
        if (!isDrawing || !currentTool || currentPoints.length < 2) {
            setIsDrawing(false);
            setCurrentPoints([]);
            return;
        }

        const image = images.find(img => img.id === imageId);
        if (!image) return;

        const newAnnotation: Annotation = {
            id: `ann-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: currentTool,
            points: currentPoints,
            color: annotationColor,
            strokeWidth: strokeWidth,
        };

        onAnnotationsChange(imageId, [...image.annotations, newAnnotation]);
        setIsDrawing(false);
        setCurrentPoints([]);
    };

    const handleUndoAnnotation = (imageId: string) => {
        const image = images.find(img => img.id === imageId);
        if (!image || image.annotations.length === 0) return;
        onAnnotationsChange(imageId, image.annotations.slice(0, -1));
    };

    // 重绘标注
    useEffect(() => {
        images.forEach(image => {
            const canvas = canvasRefs.current[image.id];
            if (canvas) {
                if (annotatingImageId === image.id && isDrawing) {
                    drawAnnotations(canvas, image.annotations, currentPoints, currentTool || undefined);
                } else {
                    drawAnnotations(canvas, image.annotations);
                }
            }
        });
    }, [images, annotatingImageId, isDrawing, currentPoints, currentTool, drawAnnotations]);

    const statusButtons: { status: ReviewStatus; icon: React.ReactNode; label: string; desc: string; colorClass: string; inactiveClass: string }[] = [
        { status: 'approved', icon: <Check size={14} />, label: '合格', desc: '可用于口播', colorClass: 'bg-emerald-600', inactiveClass: 'bg-emerald-900/30 text-emerald-400 hover:bg-emerald-800/50' },
        { status: 'revision', icon: <Edit3 size={14} />, label: '有建议', desc: '简单修改可达标', colorClass: 'bg-amber-600', inactiveClass: 'bg-amber-900/30 text-amber-400 hover:bg-amber-800/50' },
        { status: 'rejected', icon: <X size={14} />, label: '不合格', desc: '建议重新生成', colorClass: 'bg-red-600', inactiveClass: 'bg-red-900/30 text-red-400 hover:bg-red-800/50' },
    ];

    if (images.length === 0) {
        return (
            <div className="h-full flex items-center justify-center text-zinc-500">
                <div className="text-center">
                    <ImageIcon size={48} className="mx-auto mb-4 opacity-50" />
                    <p className="text-lg mb-2">拖拽或粘贴图片到此处</p>
                    <p className="text-sm">支持 JPG、PNG、WebP 等格式</p>
                </div>
            </div>
        );
    }

    return (
        <div className="h-full w-full flex flex-col bg-zinc-950">
            {/* 头部统计和控制 */}
            <div className="p-3 border-b border-zinc-800 bg-zinc-900/50 flex items-center justify-between flex-shrink-0 flex-wrap gap-2">
                <div className="flex items-center gap-4">
                    <span className="text-white font-medium">审核清单 ({images.length} 张)</span>
                    <div className="flex gap-3 text-sm">
                        <span className="text-emerald-400 flex items-center gap-1">
                            <Check size={14} /> {images.filter(i => i.status === 'approved').length}
                        </span>
                        <span className="text-red-400 flex items-center gap-1">
                            <X size={14} /> {images.filter(i => i.status === 'rejected').length}
                        </span>
                        <span className="text-amber-400 flex items-center gap-1">
                            <Edit3 size={14} /> {images.filter(i => i.status === 'revision').length}
                        </span>
                    </div>
                </div>

                {/* 选择控制 */}
                <div className="flex items-center gap-2">
                    <span className="text-zinc-400 text-sm">
                        {selectedIds.length > 0 ? `已选 ${selectedIds.length} 张` : '未选择'}
                    </span>
                    <div className="flex gap-1">
                        <button
                            onClick={onSelectAll}
                            className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded"
                            title="全选"
                        >
                            全选
                        </button>
                        <button
                            onClick={onInvertSelection}
                            className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded"
                            title="反选"
                        >
                            反选
                        </button>
                        {selectedIds.length > 0 && (
                            <button
                                onClick={onClearSelection}
                                className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded"
                                title="取消选择"
                            >
                                取消
                            </button>
                        )}
                    </div>

                    {/* 分组操作 - 始终显示 */}
                    <div className="flex items-center gap-2">
                        <div className="w-px h-4 bg-zinc-600" />

                        {isCreatingGroup ? (
                            /* 内联创建组输入 */
                            <div className="flex items-center gap-1">
                                <input
                                    type="text"
                                    value={newGroupName}
                                    onChange={(e) => setNewGroupName(e.target.value)}
                                    placeholder="输入组名..."
                                    className="px-2 py-1 text-xs bg-zinc-800 border border-purple-500 text-white rounded w-24 focus:outline-none"
                                    autoFocus
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter' && newGroupName.trim()) {
                                            const groupId = onCreateEmptyGroup(newGroupName.trim());
                                            if (selectedIds.length > 0) {
                                                onAddToGroup(groupId);
                                            }
                                            setNewGroupName('');
                                            setIsCreatingGroup(false);
                                        } else if (e.key === 'Escape') {
                                            setNewGroupName('');
                                            setIsCreatingGroup(false);
                                        }
                                    }}
                                />
                                <button
                                    onClick={() => {
                                        if (newGroupName.trim()) {
                                            const groupId = onCreateEmptyGroup(newGroupName.trim());
                                            if (selectedIds.length > 0) {
                                                onAddToGroup(groupId);
                                            }
                                            setNewGroupName('');
                                            setIsCreatingGroup(false);
                                        }
                                    }}
                                    className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded"
                                >
                                    确定
                                </button>
                                <button
                                    onClick={() => {
                                        setNewGroupName('');
                                        setIsCreatingGroup(false);
                                    }}
                                    className="px-2 py-1 text-xs bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded"
                                >
                                    取消
                                </button>
                            </div>
                        ) : (
                            /* 创建组按钮 */
                            <button
                                onClick={() => {
                                    setNewGroupName(`组 ${groups.length + 1}`);
                                    setIsCreatingGroup(true);
                                }}
                                className="px-2 py-1 text-xs bg-purple-600 hover:bg-purple-500 text-white rounded flex items-center gap-1"
                                title={selectedIds.length > 0 ? '将选中图片创建为新组' : '创建空组'}
                            >
                                <Plus size={12} />
                                创建组{selectedIds.length > 0 ? ` (${selectedIds.length}张)` : ''}
                            </button>
                        )}

                        {/* 已有组下拉 */}
                        {groups.length > 0 && selectedIds.length > 0 && (
                            <select
                                onChange={(e) => {
                                    if (e.target.value) {
                                        onAddToGroup(e.target.value);
                                        e.target.value = '';
                                    }
                                }}
                                className="px-2 py-1 text-xs bg-zinc-700 text-zinc-300 rounded border-none cursor-pointer"
                                value=""
                            >
                                <option value="" disabled>添加到组...</option>
                                {groups.map(g => (
                                    <option key={g.id} value={g.id}>{g.name} ({images.filter(i => i.groupId === g.id).length}张)</option>
                                ))}
                            </select>
                        )}

                        {/* 已有组显示 */}
                        {groups.length > 0 && (
                            <span className="text-zinc-500 text-xs">
                                共 {groups.length} 个组
                            </span>
                        )}
                    </div>
                </div>
            </div>

            {/* 整批问题汇总区域 - 可折叠 */}
            {onOverallSummaryChange && (
                <div className="border-b border-zinc-800">
                    {/* 折叠头部 */}
                    <div
                        className="px-4 py-2 bg-gradient-to-r from-teal-900/20 to-cyan-900/20 flex items-center justify-between cursor-pointer hover:from-teal-900/30 hover:to-cyan-900/30"
                        onClick={() => setShowSummaryPanel(!showSummaryPanel)}
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-teal-300 font-medium">📊 整批问题汇总</span>
                            {overallSummary && <span className="text-teal-500 text-xs">（已填写）</span>}
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={async (e) => {
                                    e.stopPropagation();
                                    if (isGeneratingSummary) return;
                                    setIsGeneratingSummary(true);
                                    setShowSummaryPanel(true); // 展开面板
                                    try {
                                        const summary = await generateOverallSummary(images, groups);
                                        onOverallSummaryChange(summary);
                                    } catch (error) {
                                        console.error('AI 汇总失败:', error);
                                        alert(error instanceof Error ? error.message : '生成汇总失败，请检查 API Key');
                                    } finally {
                                        setIsGeneratingSummary(false);
                                    }
                                }}
                                disabled={isGeneratingSummary || images.length === 0}
                                className={`flex items-center gap-1 px-2 py-1 rounded text-xs font-medium transition-all
                                    ${isGeneratingSummary
                                        ? 'bg-teal-600/50 text-teal-200 cursor-wait'
                                        : 'bg-teal-600 text-white hover:bg-teal-500'
                                    }
                                    disabled:opacity-50 disabled:cursor-not-allowed`}
                            >
                                {isGeneratingSummary ? (
                                    <><Loader2 size={12} className="animate-spin" /> 生成中</>
                                ) : (
                                    <><Sparkles size={12} /> AI 汇总</>
                                )}
                            </button>
                            <ChevronDown
                                size={16}
                                className={`text-teal-400 transition-transform ${showSummaryPanel ? 'rotate-180' : ''}`}
                            />
                        </div>
                    </div>
                    {/* 展开内容 */}
                    {/* 展开内容 - 双击放大编辑 */}
                    {showSummaryPanel && (
                        <div
                            className="p-3 bg-zinc-900/50 cursor-pointer hover:bg-zinc-900/70 transition-colors"
                            onDoubleClick={() => setShowSummaryModal(true)}
                            title="双击放大编辑"
                        >
                            <div className="text-xs text-zinc-500 mb-2 flex items-center gap-2">
                                <Eye size={12} /> 双击放大查看和编辑
                            </div>
                            <div className="grid grid-cols-2 gap-3">
                                {/* 中文预览 */}
                                <div className="bg-zinc-800/50 rounded p-2 border border-teal-500/20">
                                    <div className="text-xs text-teal-400 mb-1">中文</div>
                                    <div className="text-xs text-zinc-300 line-clamp-2 whitespace-pre-wrap">
                                        {overallSummary || '点击「AI 汇总」生成...'}
                                    </div>
                                </div>
                                {/* 英文预览 */}
                                <div className="bg-zinc-800/50 rounded p-2 border border-blue-500/20">
                                    <div className="text-xs text-blue-400 mb-1">English</div>
                                    <div className="text-xs text-zinc-300 line-clamp-2 whitespace-pre-wrap">
                                        {overallSummaryEn || 'Click "Translate" to generate...'}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* 汇总编辑弹窗 */}
            {showSummaryModal && (
                <div
                    className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
                    onClick={() => setShowSummaryModal(false)}
                >
                    <div
                        className="bg-zinc-900 rounded-xl w-full max-w-4xl max-h-[90vh] overflow-hidden shadow-2xl"
                        onClick={e => e.stopPropagation()}
                    >
                        {/* 弹窗头部 */}
                        <div className="px-6 py-4 bg-gradient-to-r from-teal-900/30 to-blue-900/30 flex items-center justify-between">
                            <h3 className="text-lg font-semibold text-white">📊 整批问题汇总编辑</h3>
                            <div className="flex items-center gap-2">
                                <button
                                    onClick={async () => {
                                        if (isGeneratingSummary) return;
                                        setIsGeneratingSummary(true);
                                        try {
                                            const summary = await generateOverallSummary(images, groups);
                                            onOverallSummaryChange?.(summary);
                                        } catch (error) {
                                            console.error('AI 汇总失败:', error);
                                            alert(error instanceof Error ? error.message : '生成汇总失败');
                                        } finally {
                                            setIsGeneratingSummary(false);
                                        }
                                    }}
                                    disabled={isGeneratingSummary}
                                    className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-sm bg-teal-600 text-white hover:bg-teal-500 disabled:opacity-50"
                                >
                                    {isGeneratingSummary ? <Loader2 size={14} className="animate-spin" /> : <Sparkles size={14} />}
                                    AI 汇总
                                </button>
                                <button
                                    onClick={() => setShowSummaryModal(false)}
                                    className="p-2 rounded-lg hover:bg-zinc-700 text-zinc-400 hover:text-white"
                                >
                                    <X size={20} />
                                </button>
                            </div>
                        </div>
                        {/* 弹窗内容 */}
                        <div className="p-6 grid grid-cols-2 gap-6 overflow-y-auto max-h-[calc(90vh-80px)]">
                            {/* 中文汇总 */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-teal-300 font-medium">中文 Chinese</span>
                                </div>
                                <textarea
                                    value={overallSummary || ''}
                                    onChange={(e) => onOverallSummaryChange?.(e.target.value)}
                                    placeholder="输入整体问题汇总，或点击「AI 汇总」自动生成..."
                                    className="w-full h-80 px-4 py-3 bg-zinc-800 border border-teal-500/30 rounded-lg text-white placeholder-zinc-500 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-500"
                                />
                            </div>
                            {/* 英文汇总 */}
                            <div>
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-blue-300 font-medium">英文 English</span>
                                    <button
                                        onClick={async () => {
                                            if (isTranslatingSummary || !overallSummary?.trim()) return;
                                            setIsTranslatingSummary(true);
                                            try {
                                                const result = await translateSummaryToEnglish(overallSummary, toneLevel);
                                                onOverallSummaryTranslationUpdate?.(result.english, result.backTranslation, result.isAccurate);
                                            } catch (error) {
                                                console.error('翻译失败:', error);
                                                alert(error instanceof Error ? error.message : '翻译失败');
                                            } finally {
                                                setIsTranslatingSummary(false);
                                            }
                                        }}
                                        disabled={isTranslatingSummary || !overallSummary?.trim()}
                                        className="flex items-center gap-1 px-2 py-1 rounded text-xs bg-blue-600 text-white hover:bg-blue-500 disabled:opacity-50"
                                    >
                                        {isTranslatingSummary ? <Loader2 size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                                        翻译成英文
                                    </button>
                                </div>
                                <textarea
                                    value={overallSummaryEn || ''}
                                    onChange={(e) => onOverallSummaryEnChange?.(e.target.value)}
                                    placeholder="点击「翻译成英文」基于中文汇总生成..."
                                    className="w-full h-60 px-4 py-3 bg-zinc-800 border border-blue-500/30 rounded-lg text-white placeholder-zinc-500 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-blue-500"
                                />
                                {/* 回译验证区域 */}
                                {overallSummaryBackTranslation && (
                                    <div className="mt-3 p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                                        <div className="flex items-center gap-2 mb-2">
                                            <span className="text-xs text-zinc-400">🔄 回译验证</span>
                                            {overallSummaryIsAccurate !== undefined && (
                                                <span className={`text-xs px-2 py-0.5 rounded ${overallSummaryIsAccurate ? 'bg-green-600/20 text-green-400' : 'bg-yellow-600/20 text-yellow-400'}`}>
                                                    {overallSummaryIsAccurate ? '✅ 翻译准确' : '⚠️ 建议核对'}
                                                </span>
                                            )}
                                        </div>
                                        <p className="text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed">
                                            {overallSummaryBackTranslation}
                                        </p>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 组管理面板 */}
            {groups.length > 0 && (
                <div className="border-b border-zinc-800">
                    {/* 组管理面板头部 */}
                    <div
                        className="px-4 py-2 bg-purple-900/20 flex items-center justify-between cursor-pointer hover:bg-purple-900/30"
                        onClick={() => setShowGroupPanel(!showGroupPanel)}
                    >
                        <div className="flex items-center gap-2">
                            <span className="text-purple-300 font-medium">📁 组管理</span>
                            <span className="text-purple-400 text-xs">({groups.length} 个组)</span>
                        </div>
                        <ChevronDown
                            size={16}
                            className={`text-purple-400 transition-transform ${showGroupPanel ? 'rotate-180' : ''}`}
                        />
                    </div>

                    {/* 组管理面板内容 */}
                    {showGroupPanel && (
                        <div className="p-3 bg-zinc-900/50 space-y-2">
                            {/* 筛选栏 */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-zinc-400 text-xs">筛选:</span>
                                <button
                                    onClick={() => setFilterGroupId(null)}
                                    className={`px-2 py-1 text-xs rounded ${filterGroupId === null
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                                        }`}
                                >
                                    全部 ({images.length})
                                </button>
                                <button
                                    onClick={() => setFilterGroupId('ungrouped')}
                                    className={`px-2 py-1 text-xs rounded ${filterGroupId === 'ungrouped'
                                        ? 'bg-purple-600 text-white'
                                        : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                                        }`}
                                >
                                    未分组 ({images.filter(i => !i.groupId).length})
                                </button>
                                {groups.map(g => (
                                    <button
                                        key={g.id}
                                        onClick={() => setFilterGroupId(g.id)}
                                        className={`px-2 py-1 text-xs rounded ${filterGroupId === g.id
                                            ? 'bg-purple-600 text-white'
                                            : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                                            }`}
                                    >
                                        {g.name} ({images.filter(i => i.groupId === g.id).length})
                                    </button>
                                ))}
                            </div>

                            {/* 组列表 */}
                            <div className="space-y-1">
                                {groups.map(g => (
                                    <div
                                        key={g.id}
                                        className={`flex items-center justify-between p-2 rounded ${filterGroupId === g.id ? 'bg-purple-900/40' : 'bg-zinc-800/50'
                                            }`}
                                    >
                                        <div className="flex items-center gap-2 flex-1">
                                            {editingGroupId === g.id ? (
                                                <input
                                                    type="text"
                                                    value={editingGroupName}
                                                    onChange={(e) => setEditingGroupName(e.target.value)}
                                                    className="px-2 py-1 text-sm bg-zinc-700 border border-purple-500 text-white rounded flex-1"
                                                    autoFocus
                                                    onKeyDown={(e) => {
                                                        if (e.key === 'Enter' && editingGroupName.trim()) {
                                                            onRenameGroup(g.id, editingGroupName.trim());
                                                            setEditingGroupId(null);
                                                        } else if (e.key === 'Escape') {
                                                            setEditingGroupId(null);
                                                        }
                                                    }}
                                                    onBlur={() => {
                                                        if (editingGroupName.trim()) {
                                                            onRenameGroup(g.id, editingGroupName.trim());
                                                        }
                                                        setEditingGroupId(null);
                                                    }}
                                                />
                                            ) : (
                                                <>
                                                    <span className="text-white text-sm">{g.name}</span>
                                                    <span className="text-zinc-500 text-xs">
                                                        ({images.filter(i => i.groupId === g.id).length} 张)
                                                    </span>
                                                </>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => setFilterGroupId(g.id)}
                                                className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded"
                                                title="查看该组图片"
                                            >
                                                <Eye size={14} />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    setEditingGroupId(g.id);
                                                    setEditingGroupName(g.name);
                                                }}
                                                className="p-1 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded"
                                                title="重命名"
                                            >
                                                <Edit3 size={14} />
                                            </button>
                                            <button
                                                onClick={() => {
                                                    if (confirm(`确定要删除组"${g.name}"吗？组内图片不会被删除。`)) {
                                                        onDeleteGroup(g.id);
                                                        if (filterGroupId === g.id) {
                                                            setFilterGroupId(null);
                                                        }
                                                    }
                                                }}
                                                className="p-1 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded"
                                                title="删除组"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* 卡片列表 */}
            <div className="flex-1 overflow-y-auto p-4">
                {/* 筛选提示 */}
                {filterGroupId && (
                    <div className="mb-3 p-2 bg-purple-900/20 rounded-lg flex items-center justify-between">
                        <span className="text-purple-300 text-sm">
                            {filterGroupId === 'ungrouped'
                                ? `显示未分组图片 (${images.filter(i => !i.groupId).length} 张)`
                                : `显示组 "${groups.find(g => g.id === filterGroupId)?.name}" (${images.filter(i => i.groupId === filterGroupId).length} 张)`
                            }
                        </span>
                        <button
                            onClick={() => setFilterGroupId(null)}
                            className="text-purple-400 hover:text-purple-300 text-xs"
                        >
                            显示全部
                        </button>
                    </div>
                )}

                {/* 分组图片区域（仅在不筛选或筛选到特定组时显示）*/}
                {filterGroupId !== 'ungrouped' && groups.map(group => {
                    const groupImages = images.filter(img => img.groupId === group.id);
                    if (groupImages.length === 0) return null;
                    if (filterGroupId && filterGroupId !== group.id) return null;

                    return (
                        <div key={group.id} className="mb-6 rounded-xl border-2 border-purple-500/50 bg-purple-900/10 overflow-hidden">
                            {/* 组头部 */}
                            <div className="bg-gradient-to-r from-purple-600 to-violet-600 px-4 py-3 flex items-center justify-between">
                                <div className="flex items-center gap-3">
                                    <span className="text-white font-semibold text-lg">📁 {group.name}</span>
                                    <span className="text-purple-200 text-sm">({groupImages.length} 张)</span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => {
                                            setEditingGroupId(group.id);
                                            setEditingGroupName(group.name);
                                        }}
                                        className="p-1.5 text-white/80 hover:text-white hover:bg-white/20 rounded"
                                        title="重命名"
                                    >
                                        <Edit3 size={14} />
                                    </button>
                                    <button
                                        onClick={() => {
                                            if (confirm(`确定删除组"${group.name}"吗？图片不会被删除。`)) {
                                                onDeleteGroup(group.id);
                                            }
                                        }}
                                        className="p-1.5 text-white/80 hover:text-red-300 hover:bg-red-500/20 rounded"
                                        title="删除组"
                                    >
                                        <Trash2 size={14} />
                                    </button>
                                </div>
                            </div>

                            {/* 组内图片网格 */}
                            <div className="p-4 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                {groupImages.map((img, idx) => (
                                    <div
                                        key={img.id}
                                        className={`relative rounded-lg overflow-hidden bg-zinc-800 cursor-pointer hover:ring-2 hover:ring-purple-400 
                                            ${selectedIds.includes(img.id) ? 'ring-2 ring-purple-500' : ''}`}
                                        onClick={() => onToggleSelect(img.id)}
                                        style={{ aspectRatio: '1' }}
                                    >
                                        <img
                                            src={img.imageUrl}
                                            alt=""
                                            className="w-full h-full object-cover"
                                        />
                                        <div className="absolute top-2 left-2 bg-black/60 text-white text-xs px-2 py-1 rounded">
                                            #{idx + 1}
                                        </div>
                                        <div className="absolute top-2 right-2">
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(img.id)}
                                                onChange={() => onToggleSelect(img.id)}
                                                className="w-4 h-4 accent-purple-500"
                                                onClick={(e) => e.stopPropagation()}
                                            />
                                        </div>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onRemoveFromGroup(img.id);
                                            }}
                                            className="absolute bottom-2 right-2 p-1 bg-red-500/80 hover:bg-red-500 text-white rounded text-xs"
                                            title="移出组"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                ))}
                            </div>

                            {/* 组统一反馈区域 */}
                            <div className="border-t border-purple-500/30 p-4 bg-zinc-900/50">
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="text-purple-300 font-medium">📝 组反馈</span>
                                    <span className="text-zinc-500 text-xs">（此组所有图片共用）</span>
                                </div>
                                <textarea
                                    value={group.groupFeedbackCn || ''}
                                    onChange={(e) => onGroupFeedbackChange(group.id, e.target.value)}
                                    placeholder="输入针对这组图片的整体反馈建议..."
                                    className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-500 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-purple-500"
                                    rows={3}
                                />
                            </div>
                        </div>
                    );
                })}

                {/* 未分组图片区域 */}
                <div className="space-y-4">
                    {images
                        .filter(image => {
                            // 未分组图片
                            if (!image.groupId) {
                                if (filterGroupId === null || filterGroupId === 'ungrouped') return true;
                                return false;
                            }
                            return false; // 分组的图片已经在上面渲染了
                        })
                        .map((image, index) => {
                            const isHovered = hoveredImageId === image.id;
                            const statusConfig = REVIEW_STATUS_CONFIG[image.status];

                            return (
                                <div
                                    key={image.id}
                                    className={`rounded-xl border overflow-hidden transition-all ${selectedIds.includes(image.id) ? 'ring-2 ring-purple-500' : ''
                                        } ${image.status === 'approved' ? 'border-emerald-600/30 bg-emerald-900/10' :
                                            image.status === 'rejected' ? 'border-red-600/30 bg-red-900/10' :
                                                image.status === 'revision' ? 'border-amber-600/30 bg-amber-900/10' :
                                                    'border-zinc-700 bg-zinc-900'
                                        }`}
                                >
                                    {/* 卡片顶栏：选择、序号、删除 */}
                                    <div className="flex items-center justify-between px-3 py-2 bg-zinc-800/50 border-b border-zinc-700/50">
                                        <div className="flex items-center gap-3">
                                            {/* 选择框 */}
                                            <input
                                                type="checkbox"
                                                checked={selectedIds.includes(image.id)}
                                                onChange={() => onToggleSelect(image.id)}
                                                className="w-4 h-4 rounded border-zinc-600 bg-zinc-700 text-purple-500 focus:ring-purple-500 cursor-pointer"
                                            />
                                            {/* 序号 */}
                                            <span className="text-zinc-400 text-sm font-medium">#{index + 1}</span>
                                            {/* 组标识 */}
                                            {image.groupId && (
                                                <span className="px-2 py-0.5 text-xs bg-purple-600/30 text-purple-300 rounded">
                                                    {groups.find(g => g.id === image.groupId)?.name || '组'}
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            {/* 从组中移除 */}
                                            {image.groupId && (
                                                <button
                                                    onClick={() => onRemoveFromGroup(image.id)}
                                                    className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700 rounded"
                                                    title="从组中移除"
                                                >
                                                    <X size={14} />
                                                </button>
                                            )}
                                            {/* 删除按钮 */}
                                            <button
                                                onClick={() => {
                                                    if (confirm('确定要删除这张图片吗？')) {
                                                        onDeleteImage(image.id);
                                                    }
                                                }}
                                                className="p-1 text-red-400 hover:text-red-300 hover:bg-red-900/30 rounded"
                                                title="删除图片"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* 左右分栏布局 */}
                                    <div className="flex">
                                        {/* 左侧：大图（支持缩放和平移）*/}
                                        <div
                                            ref={(el) => { imageContainerRefs.current[image.id] = el; }}
                                            className={`w-[320px] flex-shrink-0 relative group transition-all ${isPanEnabled(image.id)
                                                ? (isPanning ? 'cursor-grabbing' : 'cursor-grab')
                                                : ''
                                                } ${isZoomEnabled(image.id) ? 'ring-2 ring-teal-500/30' : ''}`}
                                            style={{ minHeight: '300px', overflow: 'hidden' }}
                                            onMouseEnter={() => setHoveredImageId(image.id)}
                                            onMouseLeave={() => {
                                                setHoveredImageId(null);
                                                handlePanEnd();
                                            }}
                                            onMouseDown={(e) => handlePanStart(image.id, e)}
                                            onMouseMove={(e) => handlePanMove(image.id, e)}
                                            onMouseUp={handlePanEnd}
                                        >
                                            {/* 图片容器（可缩放和平移）*/}
                                            <div
                                                className="w-full h-full relative bg-zinc-900"
                                                style={{ minHeight: '350px' }}
                                            >
                                                <img
                                                    src={image.imageUrl}
                                                    alt=""
                                                    className="w-full h-full object-contain"
                                                    style={{
                                                        transform: `translate(${getTransform(image.id).translateX}px, ${getTransform(image.id).translateY}px) scale(${getTransform(image.id).scale})`,
                                                        transition: isPanning ? 'none' : 'transform 0.1s ease-out',
                                                        pointerEvents: 'none'
                                                    }}
                                                    onLoad={(e) => {
                                                        // 初始化标注画布尺寸
                                                        const img = e.target as HTMLImageElement;
                                                        const canvas = canvasRefs.current[image.id];
                                                        if (canvas) {
                                                            canvas.width = img.naturalWidth;
                                                            canvas.height = img.naturalHeight;
                                                            drawAnnotations(canvas, image.annotations);
                                                        }
                                                    }}
                                                />

                                                {/* 标注画布层 */}
                                                <canvas
                                                    ref={(el) => { canvasRefs.current[image.id] = el; }}
                                                    className="absolute inset-0 w-full h-full"
                                                    style={{
                                                        cursor: annotatingImageId === image.id && currentTool ? 'crosshair' : 'default',
                                                        pointerEvents: annotatingImageId === image.id ? 'auto' : 'none',
                                                        transform: `translate(${getTransform(image.id).translateX}px, ${getTransform(image.id).translateY}px) scale(${getTransform(image.id).scale})`,
                                                        transition: isPanning ? 'none' : 'transform 0.1s ease-out'
                                                    }}
                                                    onMouseDown={(e) => handleCanvasMouseDown(image.id, e)}
                                                    onMouseMove={(e) => handleCanvasMouseMove(image.id, e)}
                                                    onMouseUp={() => handleCanvasMouseUp(image.id)}
                                                    onMouseLeave={() => setIsDrawing(false)}
                                                />
                                            </div>

                                            {/* 顶部工具栏（悬停时显示）*/}
                                            <div className={`absolute top-0 left-0 right-0 bg-gradient-to-b from-black/80 to-transparent p-2 transition-opacity ${isHovered || annotatingImageId === image.id ? 'opacity-100' : 'opacity-0'}`}>
                                                <div className="flex flex-wrap items-center gap-1">
                                                    {/* 左：序号 */}
                                                    <div className="bg-black/70 text-white text-sm px-2 py-1 rounded font-medium">
                                                        #{index + 1}
                                                    </div>

                                                    {/* 中：标注工具 */}
                                                    <div className="flex items-center gap-0.5 bg-black/70 rounded-lg px-1 py-0.5">
                                                        {ANNOTATION_TOOLS.map(tool => (
                                                            <button
                                                                key={tool.type}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    if (annotatingImageId === image.id && currentTool === tool.type) {
                                                                        setCurrentTool(null);
                                                                        setAnnotatingImageId(null);
                                                                    } else {
                                                                        setAnnotatingImageId(image.id);
                                                                        setCurrentTool(tool.type);
                                                                    }
                                                                }}
                                                                className={`p-1.5 rounded transition-colors ${annotatingImageId === image.id && currentTool === tool.type
                                                                    ? 'bg-teal-600 text-white'
                                                                    : 'text-zinc-400 hover:text-white hover:bg-zinc-700'
                                                                    }`}
                                                                title={tool.label}
                                                            >
                                                                <ToolIcon type={tool.type} />
                                                            </button>
                                                        ))}

                                                        {/* 颜色选择 */}
                                                        <div className="w-px h-4 bg-zinc-600 mx-1" />
                                                        {PRESET_COLORS.slice(0, 3).map(color => (
                                                            <button
                                                                key={color}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setAnnotationColor(color);
                                                                }}
                                                                className={`w-4 h-4 rounded-full ${annotationColor === color ? 'ring-2 ring-white ring-offset-1 ring-offset-black' : ''}`}
                                                                style={{ backgroundColor: color }}
                                                            />
                                                        ))}

                                                        {/* 粗细选择 */}
                                                        <div className="w-px h-4 bg-zinc-600 mx-1" />
                                                        {[2, 4, 6].map(width => (
                                                            <button
                                                                key={width}
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    setStrokeWidth(width);
                                                                }}
                                                                className={`w-5 h-5 flex items-center justify-center rounded ${strokeWidth === width ? 'bg-zinc-600' : 'hover:bg-zinc-700'}`}
                                                                title={width === 2 ? '细' : width === 4 ? '中' : '粗'}
                                                            >
                                                                <div
                                                                    className="rounded-full bg-current"
                                                                    style={{
                                                                        width: width + 2,
                                                                        height: width + 2,
                                                                        backgroundColor: annotationColor
                                                                    }}
                                                                />
                                                            </button>
                                                        ))}

                                                        {/* 撤销按钮 */}
                                                        {image.annotations.length > 0 && (
                                                            <>
                                                                <div className="w-px h-4 bg-zinc-600 mx-1" />
                                                                <button
                                                                    onClick={(e) => {
                                                                        e.stopPropagation();
                                                                        handleUndoAnnotation(image.id);
                                                                    }}
                                                                    className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded"
                                                                    title="撤销"
                                                                >
                                                                    <Undo2 size={14} />
                                                                </button>
                                                            </>
                                                        )}
                                                    </div>

                                                    {/* 右：缩放和抓手控制 */}
                                                    <div className="flex items-center gap-1 bg-black/70 rounded-lg px-1 py-0.5">
                                                        {/* 缩放开关 */}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                toggleZoom(image.id);
                                                            }}
                                                            className={`p-1 rounded ${isZoomEnabled(image.id) ? 'bg-teal-600 text-white' : 'text-zinc-500 hover:text-white'}`}
                                                            title={isZoomEnabled(image.id) ? '缩放已开启（点击关闭）' : '缩放已关闭（点击开启）'}
                                                        >
                                                            <Power size={12} />
                                                        </button>
                                                        {/* 抓手工具 */}
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                togglePan(image.id);
                                                            }}
                                                            className={`p-1 rounded ${isPanEnabled(image.id) ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-white'}`}
                                                            title={isPanEnabled(image.id) ? '抓手已开启（点击关闭）' : '抓手已关闭（点击开启）'}
                                                        >
                                                            <Hand size={14} />
                                                        </button>
                                                        <div className="w-px h-3 bg-zinc-600" />
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                zoomOut(image.id);
                                                            }}
                                                            className="p-1 text-zinc-400 hover:text-white"
                                                            title="缩小"
                                                        >
                                                            <ZoomOut size={14} />
                                                        </button>
                                                        <span className="text-xs text-zinc-300 min-w-[32px] text-center">
                                                            {Math.round(getTransform(image.id).scale * 100)}%
                                                        </span>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                zoomIn(image.id);
                                                            }}
                                                            className="p-1 text-zinc-400 hover:text-white"
                                                            title="放大"
                                                        >
                                                            <ZoomIn size={14} />
                                                        </button>
                                                        <button
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                resetZoom(image.id);
                                                            }}
                                                            className="p-1 text-zinc-400 hover:text-white ml-1"
                                                            title="重置"
                                                        >
                                                            <RefreshCw size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 缩放状态提示 */}
                                            {!isZoomEnabled(image.id) && isHovered && (
                                                <div className="absolute inset-0 bg-black/40 flex items-center justify-center transition-opacity pointer-events-none">
                                                    <span className="text-white text-sm bg-black/50 px-3 py-1 rounded">缩放已禁用</span>
                                                </div>
                                            )}

                                            {/* 状态角标 */}
                                            <div className={`absolute bottom-3 right-3 px-2 py-1 rounded-lg text-xs font-medium ${image.status === 'approved' ? 'bg-emerald-600 text-white' :
                                                image.status === 'rejected' ? 'bg-red-600 text-white' :
                                                    image.status === 'revision' ? 'bg-amber-600 text-white' :
                                                        'bg-zinc-600 text-white'
                                                }`}>
                                                {statusConfig.icon} {statusConfig.label}
                                            </div>

                                            {/* 标注数量提示 */}
                                            {image.annotations.length > 0 && (
                                                <div className="absolute bottom-3 left-3 px-2 py-1 rounded bg-purple-600 text-white text-xs">
                                                    ✏️ {image.annotations.length}
                                                </div>
                                            )}
                                        </div>

                                        {/* 右侧：状态 + 反馈输入 */}
                                        <div className="flex-1 flex flex-col p-4 min-w-0">
                                            {/* 状态按钮组 - 小标签样式 */}
                                            <div className="flex flex-wrap gap-1.5 mb-3">
                                                {statusButtons.map(({ status, icon, label, colorClass, inactiveClass }) => {
                                                    const isActive = image.status === status;
                                                    return (
                                                        <button
                                                            key={status}
                                                            onClick={() => onStatusChange(image.id, status)}
                                                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${isActive
                                                                ? `${colorClass} text-white`
                                                                : inactiveClass
                                                                }`}
                                                        >
                                                            {icon}
                                                            {label}
                                                        </button>
                                                    );
                                                })}
                                            </div>

                                            {/* 快捷标签 - 常用语直接显示 */}
                                            <div className="mb-3">
                                                <div className="flex flex-wrap gap-1.5 mb-2">
                                                    {PHRASE_CATEGORIES.slice(0, 6).map(cat => {
                                                        const isActive = activeCategory === cat.id;
                                                        return (
                                                            <button
                                                                key={cat.id}
                                                                onClick={() => setActiveCategory(isActive ? '' : cat.id)}
                                                                className={`px-2 py-1 rounded text-xs transition-colors ${isActive
                                                                    ? 'bg-teal-600 text-white'
                                                                    : 'bg-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-600'
                                                                    }`}
                                                            >
                                                                {cat.label}
                                                            </button>
                                                        );
                                                    })}
                                                    <button
                                                        onClick={() => handleAddFeedbackItem(image.id)}
                                                        className="px-2 py-1 rounded text-xs bg-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-600"
                                                    >
                                                        + 自定义
                                                    </button>
                                                </div>
                                                {/* 显示当前分类的快捷短语 */}
                                                {activeCategory && (
                                                    <div className="flex flex-wrap gap-1">
                                                        {CANNED_PHRASES.filter(p => p.category === activeCategory).map(phrase => (
                                                            <button
                                                                key={phrase.id}
                                                                onClick={() => handleAddFromPhrase(image.id, phrase)}
                                                                className="flex items-center gap-1 px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white rounded text-xs transition-colors"
                                                                title={phrase.suggestionCn}
                                                            >
                                                                <span>{phrase.icon}</span>
                                                                <span>{phrase.labelCn}</span>
                                                            </button>
                                                        ))}
                                                    </div>
                                                )}
                                            </div>

                                            {/* 反馈列表 */}
                                            <div className="flex-1 space-y-2 overflow-y-auto">
                                                {image.feedbackItems.length === 0 && !activeCategory && (
                                                    <div className="text-center text-zinc-500 py-6 border border-dashed border-zinc-700 rounded-lg text-sm">
                                                        选择上方分类添加常用反馈，或点击"自定义"
                                                    </div>
                                                )}
                                                {image.feedbackItems.map((item, idx) => {
                                                    const isTranslating = translatingItemId === item.id;
                                                    // 默认展开，除非在折叠集合中
                                                    const isExpanded = !collapsedItemIds.has(item.id);
                                                    const severityConfig = SEVERITY_CONFIG[item.severity];

                                                    return (
                                                        <div
                                                            key={item.id}
                                                            className={`rounded-lg border transition-colors ${isExpanded ? 'border-teal-600/50' : 'border-zinc-700/50'} bg-zinc-800/50`}
                                                        >
                                                            {/* 反馈项头部 */}
                                                            <div
                                                                className="flex items-center justify-between p-2 cursor-pointer"
                                                                onClick={() => {
                                                                    setCollapsedItemIds(prev => {
                                                                        const next = new Set(prev);
                                                                        if (next.has(item.id)) {
                                                                            next.delete(item.id);
                                                                        } else {
                                                                            next.add(item.id);
                                                                        }
                                                                        return next;
                                                                    });
                                                                }}
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <span className="text-sm">{severityConfig.icon}</span>
                                                                    <span className="text-sm text-zinc-300">
                                                                        反馈 #{idx + 1}
                                                                    </span>
                                                                    {item.problemCn && (
                                                                        <span className="text-xs text-zinc-500 truncate max-w-[150px]">
                                                                            - {item.problemCn}
                                                                        </span>
                                                                    )}
                                                                    {item.referenceImageBase64 && (
                                                                        <span className="text-xs bg-purple-600/30 text-purple-300 px-1.5 py-0.5 rounded">📎</span>
                                                                    )}
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <button
                                                                        onClick={(e) => {
                                                                            e.stopPropagation();
                                                                            handleDeleteFeedbackItem(image.id, item.id);
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
                                                                    {/* 问题描述 */}
                                                                    <div>
                                                                        <label className="text-xs text-zinc-500 mb-1 block">
                                                                            ❌ 问题描述 (Problem)
                                                                        </label>
                                                                        <textarea
                                                                            value={item.problemCn || ''}
                                                                            onChange={(e) => handleUpdateFeedbackItem(image.id, item.id, 'problemCn', e.target.value)}
                                                                            placeholder="描述问题是什么..."
                                                                            className="w-full h-16 px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-zinc-100 placeholder-zinc-500 resize-none text-sm focus:outline-none focus:border-red-500"
                                                                        />
                                                                        {item.problemTranslation && (
                                                                            <div className="mt-2 p-2 bg-red-900/20 border border-red-700/30 rounded text-xs space-y-1">
                                                                                <div>
                                                                                    <span className="text-red-400">{targetLanguageLabel}: </span>
                                                                                    <span className="text-red-200">{item.problemTranslation.english}</span>
                                                                                </div>
                                                                                <div>
                                                                                    <span className="text-red-400/70">回译: </span>
                                                                                    <span className="text-red-200/80">{item.problemTranslation.backTranslation}</span>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {/* 改进建议 */}
                                                                    <div>
                                                                        <label className="text-xs text-zinc-500 mb-1 block">
                                                                            💡 改进建议 (Suggestion)
                                                                        </label>
                                                                        <textarea
                                                                            value={item.suggestionCn || ''}
                                                                            onChange={(e) => handleUpdateFeedbackItem(image.id, item.id, 'suggestionCn', e.target.value)}
                                                                            placeholder="建议如何改进..."
                                                                            className="w-full h-16 px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-zinc-100 placeholder-zinc-500 resize-none text-sm focus:outline-none focus:border-emerald-500"
                                                                        />
                                                                        {item.suggestionTranslation && (
                                                                            <div className="mt-2 p-2 bg-emerald-900/20 border border-emerald-700/30 rounded text-xs space-y-1">
                                                                                <div>
                                                                                    <span className="text-emerald-400">{targetLanguageLabel}: </span>
                                                                                    <span className="text-emerald-200">{item.suggestionTranslation.english}</span>
                                                                                </div>
                                                                                <div>
                                                                                    <span className="text-emerald-400/70">回译: </span>
                                                                                    <span className="text-emerald-200/80">{item.suggestionTranslation.backTranslation}</span>
                                                                                </div>
                                                                            </div>
                                                                        )}
                                                                    </div>

                                                                    {/* 附件工具栏 */}
                                                                    <div className="flex items-center gap-2 pt-2 border-t border-zinc-700/50">
                                                                        {/* 参考图 */}
                                                                        <div
                                                                            className={`w-16 h-16 rounded-lg border-2 border-dashed flex items-center justify-center cursor-pointer transition-colors ${draggingOverRef === item.id
                                                                                ? 'border-teal-500 bg-teal-500/10'
                                                                                : item.referenceImageBase64
                                                                                    ? 'border-zinc-600'
                                                                                    : 'border-zinc-700 hover:border-zinc-500'
                                                                                }`}
                                                                            onPaste={(e) => handleRefImagePaste(image.id, item.id, e)}
                                                                            onDragOver={(e) => { e.preventDefault(); setDraggingOverRef(item.id); }}
                                                                            onDragLeave={() => setDraggingOverRef(null)}
                                                                            onDrop={(e) => handleRefImageDrop(image.id, item.id, e)}
                                                                            tabIndex={0}
                                                                            title="粘贴或拖拽参考图"
                                                                        >
                                                                            {item.referenceImageBase64 ? (
                                                                                <div className="relative w-full h-full group">
                                                                                    <img
                                                                                        src={item.referenceImageBase64}
                                                                                        alt="参考图"
                                                                                        className="w-full h-full object-cover rounded-lg"
                                                                                    />
                                                                                    <button
                                                                                        onClick={(e) => {
                                                                                            e.stopPropagation();
                                                                                            handleUpdateFeedbackItem(image.id, item.id, 'referenceImageBase64', undefined);
                                                                                        }}
                                                                                        className="absolute -top-1 -right-1 w-4 h-4 bg-red-600 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                                                    >
                                                                                        <X size={10} />
                                                                                    </button>
                                                                                </div>
                                                                            ) : (
                                                                                <div className="text-center text-zinc-500">
                                                                                    <ImageIcon size={14} className="mx-auto" />
                                                                                    <span className="text-xs">参考图</span>
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        <div className="flex-1" />

                                                                        {/* 翻译按钮 */}
                                                                        <button
                                                                            onClick={() => handleTranslateItem(image.id, item)}
                                                                            disabled={isTranslating || (!item.problemCn && !item.suggestionCn)}
                                                                            className={`flex items-center gap-1 px-2 py-1 rounded text-xs transition-colors ${isTranslating
                                                                                ? 'bg-teal-600 text-white'
                                                                                : 'bg-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-600'
                                                                                }`}
                                                                        >
                                                                            {isTranslating ? (
                                                                                <Loader2 size={12} className="animate-spin" />
                                                                            ) : (
                                                                                <RefreshCw size={12} />
                                                                            )}
                                                                            翻译此条
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                            )}
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* 反馈计数信息 */}
                                            {image.feedbackItems.length > 0 && (
                                                <div className="flex items-center justify-between mt-3 pt-2 border-t border-zinc-800">
                                                    <span className="text-xs text-zinc-500">
                                                        共 {image.feedbackItems.length} 条反馈
                                                    </span>
                                                    {/* 显示更多分类按钮 */}
                                                    <button
                                                        onClick={() => setShowPhraseSelector(showPhraseSelector === image.id ? null : image.id)}
                                                        className="text-xs text-zinc-500 hover:text-teal-400"
                                                    >
                                                        更多分类 →
                                                    </button>
                                                </div>
                                            )}

                                            {/* 更多分类弹出框 */}
                                            {showPhraseSelector === image.id && (
                                                <div className="mt-2 p-2 bg-zinc-800/50 rounded-lg border border-zinc-700">
                                                    <div className="mb-2">
                                                        <div className="relative">
                                                            <Search size={14} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                                                            <input
                                                                type="text"
                                                                value={phraseSearchQuery}
                                                                onChange={(e) => setPhraseSearchQuery(e.target.value)}
                                                                placeholder="搜索常用语..."
                                                                className="w-full pl-7 pr-3 py-1.5 bg-zinc-700 border border-zinc-600 rounded text-xs text-white"
                                                                autoFocus
                                                            />
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1 mb-2">
                                                        {PHRASE_CATEGORIES.map(cat => (
                                                            <button
                                                                key={cat.id}
                                                                onClick={() => setActiveCategory(cat.id)}
                                                                className={`px-2 py-1 rounded text-xs ${activeCategory === cat.id
                                                                    ? 'bg-teal-600 text-white'
                                                                    : 'bg-zinc-700 text-zinc-400 hover:text-white'
                                                                    }`}
                                                            >
                                                                {cat.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                    <div className="max-h-40 overflow-y-auto space-y-1">
                                                        {filteredPhrases.map(phrase => (
                                                            <button
                                                                key={phrase.id}
                                                                onClick={() => handleAddFromPhrase(image.id, phrase)}
                                                                className="w-full text-left p-2 rounded hover:bg-zinc-700 group text-xs"
                                                            >
                                                                <div className="flex items-center gap-2">
                                                                    <span>{phrase.icon}</span>
                                                                    <span className="text-white">{phrase.labelCn}</span>
                                                                </div>
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            );
                        })}
                </div>
            </div>

            {/* 点击外部关闭弹窗 */}
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

export default ListReviewView;
