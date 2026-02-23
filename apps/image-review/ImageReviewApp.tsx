/**
 * 图片审核工具 - 主组件（增强版）
 * 
 * 功能：
 * - 图片导入与管理
 * - 审核状态标记
 * - 双栏反馈：问题描述 + 改进建议
 * - 严重程度标记
 * - 英文翻译与回译验证
 * - 图片标注
 * - 批量操作
 * - PDF/Google Docs 报告导出
 */
import React, { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    Upload, Grid, Image as ImageIcon, LayoutGrid, Trash2, Download,
    Settings, ChevronLeft, ChevronRight, Maximize2, Minimize2,
    FolderPlus, Layers, Eye, EyeOff, RefreshCw, Check, X, Loader2,
    FileText, Copy, Clipboard, ListChecks, MessageCircle, List, Globe, Sparkles
} from 'lucide-react';
import {
    ImageReviewState, ImageReview, ReviewStatus, TranslationResult,
    AnnotationType, ViewMode, initialImageReviewState, createImageReview,
    createImageGroup, REVIEW_STATUS_CONFIG, FeedbackItem, ProjectInfo
} from './types';
import ImageGrid from './components/ImageGrid';
import ReviewPanelEnhanced from './components/ReviewPanelEnhanced';
import ImageCanvas from './components/ImageCanvas';
import ExecutionView from './components/ExecutionView';
import ListReviewView from './components/ListReviewView';
import {
    translateFeedback,
    ToneLevel,
    TONE_CONFIG,
    TranslationTargetLanguage,
    TRANSLATION_TARGET_LANGUAGES,
    getTranslationTargetConfig
} from './services/translationService';
import {
    generateReportSummary, downloadPDFReport, downloadTextReport, copyReportToClipboard, downloadHTMLReport,
    generateReportImageAndUploadToGyazo, type HTMLExportMode
} from './services/reportExportService';
import { uploadBase64ToGyazo, getGyazoToken, uploadBase64ToGyazoAndShorten } from './services/gyazoService';

interface ImageReviewAppProps {
    standalone?: boolean;
}

const IMAGE_REVIEW_UPDATE_VERSION = 'v2.2.0';
const IMAGE_REVIEW_UPDATE_STORAGE_KEY = `image-review-update-${IMAGE_REVIEW_UPDATE_VERSION}-seen`;
const TRANSLATION_LANGUAGE_DATALIST_ID = 'image-review-translation-language-options';

const ImageReviewApp: React.FC<ImageReviewAppProps> = ({ standalone = true }) => {
    // 状态
    const [state, setState] = useState<ImageReviewState>(initialImageReviewState);
    const [isLoading, setIsLoading] = useState(false);
    const [showSidebar, setShowSidebar] = useState(true);
    const [sidebarWidth, setSidebarWidth] = useState(420);
    const [isBatchTranslating, setIsBatchTranslating] = useState(false);
    const [batchProgress, setBatchProgress] = useState({ current: 0, total: 0 });

    // 项目信息
    const [projectInfo, setProjectInfo] = useState<ProjectInfo>({
        name: '',
        reviewerName: '',
        reviewDate: new Date().toISOString().split('T')[0],
        batchNumber: '',
        notes: '',
    });
    const [showProjectModal, setShowProjectModal] = useState(false);
    // 更新说明弹窗（按版本号记忆是否已读）
    const [showUpdateNotes, setShowUpdateNotes] = useState(() => {
        const hasSeenUpdate = localStorage.getItem(IMAGE_REVIEW_UPDATE_STORAGE_KEY);
        return !hasSeenUpdate;
    });
    const [showExportMenu, setShowExportMenu] = useState(false);
    const [exportLanguage, setExportLanguage] = useState<'zh' | 'en'>('zh');
    const [showAdvancedExport, setShowAdvancedExport] = useState(false);

    const closeUpdateNotes = useCallback(() => {
        localStorage.setItem(IMAGE_REVIEW_UPDATE_STORAGE_KEY, 'true');
        setShowUpdateNotes(false);
    }, []);

    // Gyazo 长图分享
    const [isGeneratingShareLink, setIsGeneratingShareLink] = useState(false);
    const [gyazoShareLink, setGyazoShareLink] = useState<string | null>(null);

    // 视图模式：review = 审核视图, list = 列表审核, execution = 执行清单
    const [mainViewMode, setMainViewMode] = useState<'review' | 'list' | 'execution'>('review');

    // 语气级别
    const [toneLevel, setToneLevel] = useState<ToneLevel>('suggestive');
    const [translationTargetLanguage, setTranslationTargetLanguage] = useState<TranslationTargetLanguage>('en');
    const [translationLanguageSearch, setTranslationLanguageSearch] = useState('');
    const [viewportHeight, setViewportHeight] = useState<number>(() => {
        if (typeof window === 'undefined') return 900;
        return Math.floor(window.visualViewport?.height || window.innerHeight || 900);
    });

    const dropZoneRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const updateViewportHeight = () => {
            setViewportHeight(Math.floor(window.visualViewport?.height || window.innerHeight || 900));
        };

        updateViewportHeight();
        window.addEventListener('resize', updateViewportHeight);
        window.visualViewport?.addEventListener('resize', updateViewportHeight);
        window.visualViewport?.addEventListener('scroll', updateViewportHeight);

        return () => {
            window.removeEventListener('resize', updateViewportHeight);
            window.visualViewport?.removeEventListener('resize', updateViewportHeight);
            window.visualViewport?.removeEventListener('scroll', updateViewportHeight);
        };
    }, []);

    // 解构状态
    const {
        images, groups, quickPhrases, selectedIds, activeImageId,
        viewMode, showAnnotations, currentAnnotationTool, annotationColor
    } = state;

    // 获取当前激活的图片
    const activeImage = images.find(img => img.id === activeImageId) || null;

    // ========== 图片导入 ==========

    // 处理拖放
    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();

        setIsLoading(true);
        const newImages: ImageReview[] = [];

        // 处理文件
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        for (const file of files) {
            const base64 = await fileToBase64(file);
            const url = URL.createObjectURL(file);
            const imageReview = createImageReview(url, base64, file.name);

            // 自动上传到 Gyazo（后台执行）
            if (getGyazoToken() && base64) {
                // 设置上传中状态
                imageReview.isUploadingToGyazo = true;

                uploadBase64ToGyazo(base64, file.name).then(gyazoUrl => {
                    setState(prev => ({
                        ...prev,
                        images: prev.images.map(img =>
                            img.id === imageReview.id
                                ? {
                                    ...img,
                                    gyazoUrl: gyazoUrl || undefined,
                                    // 上传成功后用 Gyazo URL 替换显示 URL，确保切换页面后仍能显示
                                    imageUrl: gyazoUrl || img.imageUrl,
                                    isUploadingToGyazo: false,
                                    // 上传成功后清除 base64 数据以释放内存
                                    base64Data: gyazoUrl ? undefined : img.base64Data
                                }
                                : img
                        )
                    }));
                }).catch(() => {
                    // 上传失败，清除状态
                    setState(prev => ({
                        ...prev,
                        images: prev.images.map(img =>
                            img.id === imageReview.id
                                ? { ...img, isUploadingToGyazo: false }
                                : img
                        )
                    }));
                });
            }

            newImages.push(imageReview);
        }

        // 处理 URL
        const text = e.dataTransfer.getData('text');
        if (text && (text.startsWith('http://') || text.startsWith('https://'))) {
            newImages.push(createImageReview(text, undefined, text));
        }

        if (newImages.length > 0) {
            setState(prev => ({
                ...prev,
                images: [...prev.images, ...newImages],
                activeImageId: prev.activeImageId || newImages[0].id,
            }));
        }

        setIsLoading(false);
    }, []);

    // 处理拖入
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
    }, []);

    // 文件转 base64 (完整的 data URL，用于 HTML 显示)
    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                // 保留完整的 data:image/xxx;base64,xxx 格式，用于 HTML 和导出
                resolve(result);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    // 处理粘贴
    useEffect(() => {
        const handlePaste = async (e: ClipboardEvent) => {
            // ===== 隔离检查：避免拦截其他工具的粘贴事件 =====
            const target = e.target as HTMLElement;
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }
            if (!target.closest('.image-review-app')) {
                return;
            }

            const items = e.clipboardData?.items;
            if (!items) return;

            const newImages: ImageReview[] = [];

            for (const item of Array.from(items)) {
                if (item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) {
                        const base64 = await fileToBase64(file);
                        const url = URL.createObjectURL(file);
                        const imageReview = createImageReview(url, base64, 'pasted-image');

                        // 自动上传到 Gyazo（后台执行）
                        if (getGyazoToken() && base64) {
                            imageReview.isUploadingToGyazo = true;

                            uploadBase64ToGyazo(base64, 'pasted-image.png').then(gyazoUrl => {
                                setState(prev => ({
                                    ...prev,
                                    images: prev.images.map(img =>
                                        img.id === imageReview.id
                                            ? {
                                                ...img,
                                                gyazoUrl: gyazoUrl || undefined,
                                                // 上传成功后用 Gyazo URL 替换显示 URL
                                                imageUrl: gyazoUrl || img.imageUrl,
                                                isUploadingToGyazo: false,
                                                // 上传成功后清除 base64 数据以释放内存
                                                base64Data: gyazoUrl ? undefined : img.base64Data
                                            }
                                            : img
                                    )
                                }));
                            }).catch(() => {
                                setState(prev => ({
                                    ...prev,
                                    images: prev.images.map(img =>
                                        img.id === imageReview.id
                                            ? { ...img, isUploadingToGyazo: false }
                                            : img
                                    )
                                }));
                            });
                        }

                        newImages.push(imageReview);
                    }
                } else if (item.type === 'text/plain') {
                    item.getAsString((text) => {
                        if (text.startsWith('http://') || text.startsWith('https://')) {
                            // URL 图片
                            if (/\.(jpg|jpeg|png|gif|webp)$/i.test(text)) {
                                setState(prev => ({
                                    ...prev,
                                    images: [...prev.images, createImageReview(text, undefined, text)],
                                }));
                            }
                        }
                    });
                }
            }

            if (newImages.length > 0) {
                setState(prev => ({
                    ...prev,
                    images: [...prev.images, ...newImages],
                    activeImageId: prev.activeImageId || newImages[0].id,
                }));
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, []);

    // ========== 图片选择与操作 ==========

    // 选择图片
    const handleSelect = useCallback((id: string, multiSelect?: boolean) => {
        setState(prev => {
            if (multiSelect) {
                const isSelected = prev.selectedIds.includes(id);
                return {
                    ...prev,
                    selectedIds: isSelected
                        ? prev.selectedIds.filter(i => i !== id)
                        : [...prev.selectedIds, id],
                };
            } else {
                return {
                    ...prev,
                    selectedIds: [id],
                };
            }
        });
    }, []);

    // 激活图片（进入详细编辑）
    const handleActivate = useCallback((id: string) => {
        setState(prev => ({
            ...prev,
            activeImageId: id,
            viewMode: 'single',
        }));
    }, []);

    // 删除图片
    const handleDelete = useCallback((ids: string[]) => {
        setState(prev => ({
            ...prev,
            images: prev.images.filter(img => !ids.includes(img.id)),
            selectedIds: prev.selectedIds.filter(id => !ids.includes(id)),
            activeImageId: ids.includes(prev.activeImageId || '') ? null : prev.activeImageId,
        }));
    }, []);

    // ========== 审核操作 ==========

    // 更新图片状态
    const handleStatusChange = useCallback((status: ReviewStatus) => {
        if (!activeImageId) return;

        setState(prev => ({
            ...prev,
            images: prev.images.map(img =>
                img.id === activeImageId
                    ? { ...img, status, updatedAt: Date.now() }
                    : img
            ),
        }));
    }, [activeImageId]);

    // 更新反馈项
    const handleFeedbackItemsChange = useCallback((items: FeedbackItem[]) => {
        if (!activeImageId) return;

        setState(prev => ({
            ...prev,
            images: prev.images.map(img =>
                img.id === activeImageId
                    ? { ...img, feedbackItems: items, updatedAt: Date.now() }
                    : img
            ),
        }));
    }, [activeImageId]);

    // 更新标注
    const handleAnnotationsChange = useCallback((annotations: any[]) => {
        if (!activeImageId) return;

        setState(prev => ({
            ...prev,
            images: prev.images.map(img =>
                img.id === activeImageId
                    ? { ...img, annotations, updatedAt: Date.now() }
                    : img
            ),
        }));
    }, [activeImageId]);

    // 更新标注工具
    const handleToolChange = useCallback((tool: AnnotationType | null) => {
        setState(prev => ({ ...prev, currentAnnotationTool: tool }));
    }, []);

    // 更新标注颜色
    const handleColorChange = useCallback((color: string) => {
        setState(prev => ({ ...prev, annotationColor: color }));
    }, []);

    // ========== 图片管理 ==========

    // 删除单张图片
    const handleDeleteImage = useCallback((imageId: string) => {
        setState(prev => {
            const newImages = prev.images.filter(img => img.id !== imageId);
            const newSelectedIds = prev.selectedIds.filter(id => id !== imageId);
            // 如果删除的是当前激活的图片，切换到下一张
            let newActiveId = prev.activeImageId;
            if (prev.activeImageId === imageId) {
                const currentIndex = prev.images.findIndex(img => img.id === imageId);
                if (newImages.length > 0) {
                    newActiveId = newImages[Math.min(currentIndex, newImages.length - 1)]?.id || null;
                } else {
                    newActiveId = null;
                }
            }
            return {
                ...prev,
                images: newImages,
                selectedIds: newSelectedIds,
                activeImageId: newActiveId,
            };
        });
    }, []);

    // 批量删除选中的图片
    const handleDeleteSelected = useCallback(() => {
        if (selectedIds.length === 0) return;
        if (!confirm(`确定要删除选中的 ${selectedIds.length} 张图片吗？`)) return;

        setState(prev => ({
            ...prev,
            images: prev.images.filter(img => !prev.selectedIds.includes(img.id)),
            selectedIds: [],
            activeImageId: prev.selectedIds.includes(prev.activeImageId || '')
                ? (prev.images.find(img => !prev.selectedIds.includes(img.id))?.id || null)
                : prev.activeImageId,
        }));
    }, [selectedIds]);

    // ========== 选择管理 ==========

    // 切换单个图片选中状态
    const toggleSelectImage = useCallback((imageId: string) => {
        setState(prev => ({
            ...prev,
            selectedIds: prev.selectedIds.includes(imageId)
                ? prev.selectedIds.filter(id => id !== imageId)
                : [...prev.selectedIds, imageId],
        }));
    }, []);

    // 全选
    const selectAll = useCallback(() => {
        setState(prev => ({
            ...prev,
            selectedIds: prev.images.map(img => img.id),
        }));
    }, []);

    // 反选
    const invertSelection = useCallback(() => {
        setState(prev => ({
            ...prev,
            selectedIds: prev.images
                .filter(img => !prev.selectedIds.includes(img.id))
                .map(img => img.id),
        }));
    }, []);

    // 取消全选
    const clearSelection = useCallback(() => {
        setState(prev => ({ ...prev, selectedIds: [] }));
    }, []);

    // ========== 组管理 ==========

    // 创建新组（传入图片 ID 数组）
    const handleCreateGroup = useCallback((ids: string[]) => {
        const groupName = `组 ${groups.length + 1}`;
        const newGroup = createImageGroup(groupName, ids);
        setState(prev => ({
            ...prev,
            groups: [...prev.groups, newGroup],
            images: prev.images.map(img =>
                ids.includes(img.id) ? { ...img, groupId: newGroup.id } : img
            ),
        }));
    }, [groups.length]);

    // 创建空组（仅传入名称）
    const handleCreateEmptyGroup = useCallback((groupName: string) => {
        const newGroup = createImageGroup(groupName, []);
        setState(prev => ({
            ...prev,
            groups: [...prev.groups, newGroup],
        }));
        return newGroup.id;
    }, []);

    // 删除组
    const handleDeleteGroup = useCallback((groupId: string) => {
        setState(prev => ({
            ...prev,
            groups: prev.groups.filter(g => g.id !== groupId),
            // 清除图片的 groupId
            images: prev.images.map(img =>
                img.groupId === groupId ? { ...img, groupId: undefined } : img
            ),
        }));
    }, []);

    // 将选中的图片添加到组
    const handleAddToGroup = useCallback((groupId: string) => {
        if (selectedIds.length === 0) return;

        setState(prev => ({
            ...prev,
            images: prev.images.map(img =>
                prev.selectedIds.includes(img.id)
                    ? { ...img, groupId, updatedAt: Date.now() }
                    : img
            ),
            groups: prev.groups.map(g =>
                g.id === groupId
                    ? {
                        ...g,
                        imageIds: [...new Set([...g.imageIds, ...prev.selectedIds])],
                        updatedAt: Date.now()
                    }
                    : g
            ),
            selectedIds: [], // 清除选择
        }));
    }, [selectedIds]);

    // 从组中移除图片
    const handleRemoveFromGroup = useCallback((imageId: string) => {
        setState(prev => {
            const image = prev.images.find(img => img.id === imageId);
            if (!image?.groupId) return prev;

            return {
                ...prev,
                images: prev.images.map(img =>
                    img.id === imageId ? { ...img, groupId: undefined } : img
                ),
                groups: prev.groups.map(g =>
                    g.id === image.groupId
                        ? { ...g, imageIds: g.imageIds.filter(id => id !== imageId) }
                        : g
                ),
            };
        });
    }, []);

    // 更新组反馈
    const handleGroupFeedbackChange = useCallback((groupId: string, feedback: string) => {
        setState(prev => ({
            ...prev,
            groups: prev.groups.map(g =>
                g.id === groupId
                    ? { ...g, groupFeedbackCn: feedback, updatedAt: Date.now() }
                    : g
            ),
        }));
    }, []);

    // 更新组状态
    const handleGroupStatusChange = useCallback((groupId: string, status: ReviewStatus) => {
        setState(prev => ({
            ...prev,
            groups: prev.groups.map(g =>
                g.id === groupId
                    ? { ...g, groupStatus: status, updatedAt: Date.now() }
                    : g
            ),
        }));
    }, []);

    // 重命名组
    const handleRenameGroup = useCallback((groupId: string, newName: string) => {
        setState(prev => ({
            ...prev,
            groups: prev.groups.map(g =>
                g.id === groupId
                    ? { ...g, name: newName, updatedAt: Date.now() }
                    : g
            ),
        }));
    }, []);

    // ========== 批量翻译 ==========

    // 翻译当前图片所有反馈
    const handleTranslateCurrentImage = useCallback(async () => {
        if (!activeImage) return;

        setIsBatchTranslating(true);
        const items = activeImage.feedbackItems;
        setBatchProgress({ current: 0, total: items.length * 2 }); // 每项有问题和建议两个字段

        const translatedItems: FeedbackItem[] = [];
        let progress = 0;

        for (const item of items) {
            const updated = { ...item };

            if (item.problemCn.trim()) {
                updated.problemTranslation = await translateFeedback(
                    item.problemCn,
                    undefined,
                    toneLevel,
                    translationTargetLanguage
                );
                progress++;
                setBatchProgress({ current: progress, total: items.length * 2 });
            }

            if (item.suggestionCn.trim()) {
                updated.suggestionTranslation = await translateFeedback(
                    item.suggestionCn,
                    undefined,
                    toneLevel,
                    translationTargetLanguage
                );
                progress++;
                setBatchProgress({ current: progress, total: items.length * 2 });
            }

            translatedItems.push(updated);
        }

        handleFeedbackItemsChange(translatedItems);
        setIsBatchTranslating(false);
    }, [activeImage, handleFeedbackItemsChange, toneLevel, translationTargetLanguage]);

    // 批量翻译所有图片
    const handleBatchTranslateAll = useCallback(async () => {
        const imagesToTranslate = images.filter(img =>
            img.feedbackItems.some(item =>
                (item.problemCn.trim() && !item.problemTranslation) ||
                (item.suggestionCn.trim() && !item.suggestionTranslation)
            )
        );

        if (imagesToTranslate.length === 0) return;

        setIsBatchTranslating(true);

        // 计算总任务数
        let totalTasks = 0;
        imagesToTranslate.forEach(img => {
            img.feedbackItems.forEach(item => {
                if (item.problemCn.trim() && !item.problemTranslation) totalTasks++;
                if (item.suggestionCn.trim() && !item.suggestionTranslation) totalTasks++;
            });
        });

        setBatchProgress({ current: 0, total: totalTasks });
        let progress = 0;

        for (const img of imagesToTranslate) {
            const translatedItems: FeedbackItem[] = [];

            for (const item of img.feedbackItems) {
                const updated = { ...item };

                if (item.problemCn.trim() && !item.problemTranslation) {
                    updated.problemTranslation = await translateFeedback(
                        item.problemCn,
                        undefined,
                        toneLevel,
                        translationTargetLanguage
                    );
                    progress++;
                    setBatchProgress({ current: progress, total: totalTasks });
                }

                if (item.suggestionCn.trim() && !item.suggestionTranslation) {
                    updated.suggestionTranslation = await translateFeedback(
                        item.suggestionCn,
                        undefined,
                        toneLevel,
                        translationTargetLanguage
                    );
                    progress++;
                    setBatchProgress({ current: progress, total: totalTasks });
                }

                translatedItems.push(updated);
            }

            setState(prev => ({
                ...prev,
                images: prev.images.map(i =>
                    i.id === img.id
                        ? { ...i, feedbackItems: translatedItems, updatedAt: Date.now() }
                        : i
                ),
            }));
        }

        setIsBatchTranslating(false);
    }, [images, toneLevel, translationTargetLanguage]);

    // ========== 导出功能 ==========

    const handleExportPDF = useCallback(async (useEnglish: boolean) => {
        if (images.length === 0) return;
        try {
            await downloadPDFReport(images, projectInfo, useEnglish);
            setShowExportMenu(false);
        } catch (error) {
            console.error('Export PDF failed:', error);
            alert('导出 PDF 失败，请检查浏览器弹窗权限后重试');
        }
    }, [images, projectInfo]);

    const handleExportText = useCallback((useEnglish: boolean) => {
        if (images.length === 0) return;
        try {
            downloadTextReport(images, projectInfo, useEnglish);
            setShowExportMenu(false);
        } catch (error) {
            console.error('Export text failed:', error);
            alert('导出文本失败，请重试');
        }
    }, [images, projectInfo]);

    const handleCopyReport = useCallback(async (useEnglish: boolean) => {
        if (images.length === 0) return;
        try {
            await copyReportToClipboard(images, projectInfo, useEnglish);
            setShowExportMenu(false);
        } catch (error) {
            console.error('Copy report failed:', error);
            alert('复制报告失败，请检查剪贴板权限后重试');
        }
    }, [images, projectInfo]);

    const handleExportHTML = useCallback(async (mode: HTMLExportMode = 'online') => {
        if (images.length === 0) return;
        try {
            await downloadHTMLReport(images, projectInfo, mode);
            setShowExportMenu(false);
        } catch (error) {
            console.error('Export HTML failed:', error);
            alert('导出 HTML 失败，请重试');
        }
    }, [images, projectInfo]);

    // 生成 Gyazo 长图分享链接
    const handleGenerateGyazoShareLink = useCallback(async () => {
        if (images.length === 0) return;

        setIsGeneratingShareLink(true);
        setGyazoShareLink(null);

        try {
            const shareUrl = await generateReportImageAndUploadToGyazo(
                images,
                projectInfo,
                uploadBase64ToGyazoAndShorten
            );

            if (shareUrl) {
                setGyazoShareLink(shareUrl);
                // 尝试自动复制到剪贴板（可能因页面失焦而失败）
                try {
                    await navigator.clipboard.writeText(shareUrl);
                } catch {
                    // 复制失败，用户可以手动点击链接复制
                    console.log('Auto-copy failed, user can copy manually');
                }
            } else {
                alert('上传失败，请检查网络连接');
            }
        } catch (error) {
            console.error('Generate share link error:', error);
            alert('生成分享链接失败，请重试');
        } finally {
            setIsGeneratingShareLink(false);
        }
    }, [images, projectInfo]);

    // ========== 导航 ==========

    // 上一张/下一张
    const navigateImage = useCallback((direction: 'prev' | 'next') => {
        if (!activeImageId || images.length === 0) return;

        const currentIndex = images.findIndex(img => img.id === activeImageId);
        let newIndex = direction === 'prev' ? currentIndex - 1 : currentIndex + 1;

        if (newIndex < 0) newIndex = images.length - 1;
        if (newIndex >= images.length) newIndex = 0;

        setState(prev => ({
            ...prev,
            activeImageId: images[newIndex].id,
            selectedIds: [images[newIndex].id],
        }));
    }, [activeImageId, images]);

    // 键盘快捷键
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // 如果在输入框中，不处理
            if (['INPUT', 'TEXTAREA'].includes((e.target as HTMLElement).tagName)) return;

            switch (e.key) {
                case 'ArrowLeft':
                    navigateImage('prev');
                    break;
                case 'ArrowRight':
                    navigateImage('next');
                    break;
                case '1':
                    handleStatusChange('approved');
                    break;
                case '2':
                    handleStatusChange('revision');
                    break;
                case '3':
                    handleStatusChange('rejected');
                    break;
                case 'Delete':
                case 'Backspace':
                    if (selectedIds.length > 0) {
                        handleDelete(selectedIds);
                    }
                    break;
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [navigateImage, handleStatusChange, handleDelete, selectedIds]);

    // ========== 统计 ==========
    const stats = generateReportSummary(images);
    const currentTranslationTargetConfig = getTranslationTargetConfig(translationTargetLanguage);
    const offlineReadyCount = images.filter(img => img.base64Data).length;
    const gyazoUploadingCount = images.filter(img => img.isUploadingToGyazo).length;
    const isCompactModal = viewportHeight < 820;
    const projectModalMaxHeight = Math.max(360, viewportHeight - 20);
    const translationListMaxHeight = Math.max(120, Math.min(280, Math.floor(viewportHeight * 0.24)));
    const filteredTranslationLanguages = useMemo(() => {
        const query = translationLanguageSearch.trim().toLowerCase();
        if (!query) return TRANSLATION_TARGET_LANGUAGES;
        return TRANSLATION_TARGET_LANGUAGES.filter((language) => {
            return (
                language.code.toLowerCase().includes(query) ||
                language.label.toLowerCase().includes(query) ||
                language.labelEn.toLowerCase().includes(query)
            );
        });
    }, [translationLanguageSearch]);

    return (
        <div
            ref={dropZoneRef}
            className="h-full flex flex-col bg-zinc-950 text-white image-review-app"
            onDrop={handleDrop}
            onDragOver={handleDragOver}
        >
            {/* 顶部工具栏 */}
            <div className="h-14 px-4 flex items-center justify-between border-b border-zinc-800 bg-zinc-900/50">
                <div className="flex items-center gap-4">
                    <h1 className="text-lg font-semibold flex items-center gap-2">
                        <ImageIcon size={20} className="text-teal-400" />
                        图片审核
                    </h1>

                    {/* 导入按钮 */}
                    <label className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 rounded-lg cursor-pointer transition-colors">
                        <Upload size={16} />
                        <span className="text-sm">导入图片</span>
                        <input
                            type="file"
                            multiple
                            accept="image/*"
                            className="hidden"
                            onChange={async (e) => {
                                const files = Array.from(e.target.files || []);
                                const newImages: ImageReview[] = [];
                                for (const file of files) {
                                    const base64 = await fileToBase64(file);
                                    const url = URL.createObjectURL(file);
                                    const imageReview = createImageReview(url, base64, file.name);

                                    // 自动上传到 Gyazo（后台执行）
                                    if (getGyazoToken() && base64) {
                                        imageReview.isUploadingToGyazo = true;

                                        uploadBase64ToGyazo(base64, file.name).then(gyazoUrl => {
                                            setState(prev => ({
                                                ...prev,
                                                images: prev.images.map(img =>
                                                    img.id === imageReview.id
                                                        ? {
                                                            ...img,
                                                            gyazoUrl: gyazoUrl || undefined,
                                                            // 上传成功后用 Gyazo URL 替换显示 URL
                                                            imageUrl: gyazoUrl || img.imageUrl,
                                                            isUploadingToGyazo: false,
                                                            // 上传成功后清除 base64 数据以释放内存
                                                            base64Data: gyazoUrl ? undefined : img.base64Data
                                                        }
                                                        : img
                                                )
                                            }));
                                        }).catch(() => {
                                            setState(prev => ({
                                                ...prev,
                                                images: prev.images.map(img =>
                                                    img.id === imageReview.id
                                                        ? { ...img, isUploadingToGyazo: false }
                                                        : img
                                                )
                                            }));
                                        });
                                    }

                                    newImages.push(imageReview);
                                }
                                setState(prev => ({
                                    ...prev,
                                    images: [...prev.images, ...newImages],
                                }));
                            }}
                        />
                    </label>

                    {/* 项目信息 */}
                    <button
                        onClick={() => setShowProjectModal(true)}
                        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors"
                    >
                        <Settings size={16} />
                        <span className="text-sm">项目信息</span>
                    </button>

                    {/* 功能说明 */}
                    <button
                        onClick={() => setShowUpdateNotes(true)}
                        className="flex items-center gap-1 px-2 py-1 text-[11px] text-emerald-400 hover:bg-emerald-900/30 rounded-lg transition-colors"
                        title="查看功能说明"
                    >
                        <Sparkles size={12} />
                        <span>功能说明</span>
                    </button>

                    {/* 批量翻译 */}
                    <button
                        onClick={handleBatchTranslateAll}
                        disabled={isBatchTranslating || images.length === 0}
                        className="flex items-center gap-2 px-3 py-1.5 bg-blue-600 hover:bg-blue-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg transition-colors"
                    >
                        {isBatchTranslating ? (
                            <>
                                <Loader2 size={16} className="animate-spin" />
                                <span className="text-sm">{batchProgress.current}/{batchProgress.total}</span>
                            </>
                        ) : (
                            <>
                                <RefreshCw size={16} />
                                <span className="text-sm">批量翻译</span>
                            </>
                        )}
                    </button>

                    {/* 导出菜单 */}
                    <div className="relative">
                        <button
                            onClick={() => setShowExportMenu(!showExportMenu)}
                            disabled={images.length === 0}
                            className="flex items-center gap-2 px-3 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:bg-zinc-700 disabled:text-zinc-500 rounded-lg transition-colors"
                        >
                            <FileText size={16} />
                            <span className="text-sm">导出报告</span>
                        </button>

                        {showExportMenu && (
                            <div className="absolute top-full left-0 mt-1 w-80 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50">
                                <div className="p-3 border-b border-zinc-700">
                                    <p className="text-sm font-medium text-white">导出报告</p>
                                    <p className="text-xs text-zinc-400 mt-1">先选语言，再选择导出方式</p>
                                    <div className="mt-3 inline-flex bg-zinc-700 rounded-lg p-0.5">
                                        <button
                                            onClick={() => setExportLanguage('zh')}
                                            className={`px-3 py-1 text-xs rounded-md transition-colors ${exportLanguage === 'zh'
                                                ? 'bg-teal-600 text-white'
                                                : 'text-zinc-300 hover:text-white'
                                                }`}
                                        >
                                            中文
                                        </button>
                                        <button
                                            onClick={() => setExportLanguage('en')}
                                            className={`px-3 py-1 text-xs rounded-md transition-colors ${exportLanguage === 'en'
                                                ? 'bg-teal-600 text-white'
                                                : 'text-zinc-300 hover:text-white'
                                                }`}
                                        >
                                            English
                                        </button>
                                    </div>
                                </div>

                                <div className="p-2">
                                    <p className="px-2 py-1 text-[11px] text-zinc-400">快速操作（推荐）</p>
                                    <button
                                        onClick={() => handleExportPDF(exportLanguage === 'en')}
                                        className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 rounded-md flex items-center gap-2"
                                    >
                                        <Download size={14} />
                                        {exportLanguage === 'en' ? '打印/下载 PDF (英文)' : '打印/下载 PDF (中文)'}
                                    </button>
                                    <button
                                        onClick={() => handleCopyReport(exportLanguage === 'en')}
                                        className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 rounded-md flex items-center gap-2"
                                    >
                                        <Copy size={14} />
                                        {exportLanguage === 'en' ? '复制报告 (英文)' : '复制报告 (中文)'}
                                    </button>
                                    <button
                                        onClick={() => handleExportHTML(exportLanguage === 'en' ? 'compressed-english' : 'compressed')}
                                        className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 rounded-md flex items-center gap-2"
                                        title="压缩 HTML（推荐）"
                                    >
                                        <Download size={14} />
                                        压缩网页（{exportLanguage === 'en' ? '英文' : '中英'}）
                                        <span className="ml-auto text-xs text-zinc-500">800px</span>
                                    </button>
                                </div>

                                <div className="px-2 pb-2">
                                    <button
                                        onClick={() => setShowAdvancedExport(!showAdvancedExport)}
                                        className="w-full px-3 py-2 text-left text-xs text-zinc-300 hover:bg-zinc-700 rounded-md transition-colors"
                                    >
                                        {showAdvancedExport ? '收起更多格式' : '更多格式'}
                                    </button>
                                </div>

                                {showAdvancedExport && (
                                    <div className="px-2 pb-2 border-t border-zinc-700 pt-2">
                                        <button
                                            onClick={() => handleExportText(exportLanguage === 'en')}
                                            className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 rounded-md flex items-center gap-2"
                                        >
                                            <FileText size={14} />
                                            {exportLanguage === 'en' ? '下载文本 (英文)' : '下载文本 (中文)'}
                                        </button>
                                        <button
                                            onClick={() => handleExportHTML('offline')}
                                            className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 rounded-md flex items-center gap-2"
                                            title="离线 HTML（原图）"
                                        >
                                            <Download size={14} />
                                            离线网页（原图）
                                            <span className="ml-auto text-xs text-zinc-500">{offlineReadyCount}/{images.length}</span>
                                        </button>
                                    </div>
                                )}

                                <div className="p-2 border-t border-zinc-700">
                                    <div className="px-2 py-1 flex items-center justify-between">
                                        <p className="text-[11px] text-zinc-400">在线分享（Gyazo）</p>
                                        {gyazoUploadingCount > 0 && (
                                            <span className="text-xs text-amber-400">上传中 {gyazoUploadingCount}</span>
                                        )}
                                    </div>
                                    <button
                                        onClick={handleGenerateGyazoShareLink}
                                        disabled={isGeneratingShareLink || images.length === 0}
                                        className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 disabled:text-zinc-500 rounded-md flex items-center gap-2"
                                        title="生成报告长图并上传到 Gyazo"
                                    >
                                        {isGeneratingShareLink ? (
                                            <>
                                                <Loader2 size={14} className="animate-spin" />
                                                生成中...
                                            </>
                                        ) : (
                                            <>
                                                <Globe size={14} />
                                                生成分享长图
                                            </>
                                        )}
                                    </button>

                                    {gyazoShareLink && (
                                        <div className="px-3 py-2 mt-2 bg-emerald-900/30 border border-emerald-700 rounded-md">
                                            <p className="text-xs text-emerald-400 mb-1">✅ 链接已复制</p>
                                            <a
                                                href={gyazoShareLink}
                                                target="_blank"
                                                rel="noopener noreferrer"
                                                className="text-xs text-blue-400 hover:underline break-all"
                                            >
                                                {gyazoShareLink}
                                            </a>
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}
                    </div>
                </div>

                {/* 视图切换 */}
                <div className="flex items-center gap-2">
                    {/* 审核/列表/执行视图切换 */}
                    <div className="flex bg-zinc-800 rounded-lg p-0.5">
                        <button
                            onClick={() => setMainViewMode('review')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${mainViewMode === 'review'
                                ? 'bg-teal-600 text-white'
                                : 'text-zinc-400 hover:text-white'
                                }`}
                            title="审核视图 - 网格/单图模式"
                        >
                            <ImageIcon size={14} />
                            审核
                        </button>
                        <button
                            onClick={() => setMainViewMode('list')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${mainViewMode === 'list'
                                ? 'bg-purple-600 text-white'
                                : 'text-zinc-400 hover:text-white'
                                }`}
                            title="列表审核 - 左图右反馈"
                        >
                            <List size={14} />
                            列表
                        </button>
                        <button
                            onClick={() => setMainViewMode('execution')}
                            className={`flex items-center gap-1.5 px-3 py-1.5 rounded-md text-sm transition-colors ${mainViewMode === 'execution'
                                ? 'bg-amber-600 text-white'
                                : 'text-zinc-400 hover:text-white'
                                }`}
                            title="执行清单视图 (For Team)"
                        >
                            <ListChecks size={14} />
                            执行清单
                        </button>
                    </div>

                    <div className="w-px h-6 bg-zinc-700 mx-1" />

                    {/* 子视图切换（仅在审核模式下显示） */}
                    {mainViewMode === 'review' && (
                        <>
                            <button
                                onClick={() => setState(prev => ({ ...prev, viewMode: 'grid' }))}
                                className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-teal-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                                    }`}
                                title="网格视图"
                            >
                                <LayoutGrid size={18} />
                            </button>
                            <button
                                onClick={() => setState(prev => ({ ...prev, viewMode: 'single' }))}
                                className={`p-2 rounded-lg transition-colors ${viewMode === 'single' ? 'bg-teal-600 text-white' : 'bg-zinc-800 text-zinc-400 hover:text-white'
                                    }`}
                                title="单图视图"
                            >
                                <Maximize2 size={18} />
                            </button>

                            <div className="w-px h-6 bg-zinc-700 mx-1" />

                            <button
                                onClick={() => setShowSidebar(!showSidebar)}
                                className="p-2 rounded-lg bg-zinc-800 text-zinc-400 hover:text-white transition-colors"
                                title={showSidebar ? '隐藏侧边栏' : '显示侧边栏'}
                            >
                                {showSidebar ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* 主内容区 */}
            <div className="flex-1 flex overflow-hidden">
                {mainViewMode === 'execution' ? (
                    /* 执行清单视图 */
                    <ExecutionView
                        images={images}
                        onCopyAll={() => {
                            // 复制成功提示
                        }}
                    />
                ) : mainViewMode === 'list' ? (
                    /* 列表审核视图 */
                    <ListReviewView
                        images={images}
                        groups={groups}
                        selectedIds={selectedIds}
                        toneLevel={toneLevel}
                        translationTargetLanguage={translationTargetLanguage}
                        onStatusChange={(imageId, status) => {
                            setState(prev => ({
                                ...prev,
                                images: prev.images.map(img =>
                                    img.id === imageId ? { ...img, status } : img
                                ),
                            }));
                        }}
                        onFeedbackItemsChange={(imageId, items) => {
                            setState(prev => ({
                                ...prev,
                                images: prev.images.map(img =>
                                    img.id === imageId ? { ...img, feedbackItems: items } : img
                                ),
                            }));
                        }}
                        onImageClick={(imageId) => {
                            setState(prev => ({ ...prev, activeImageId: imageId }));
                            setMainViewMode('review');
                            setState(prev => ({ ...prev, viewMode: 'single' }));
                        }}
                        onAnnotationsChange={(imageId, annotations) => {
                            setState(prev => ({
                                ...prev,
                                images: prev.images.map(img =>
                                    img.id === imageId ? { ...img, annotations } : img
                                ),
                            }));
                        }}
                        onDeleteImage={handleDeleteImage}
                        onToggleSelect={toggleSelectImage}
                        onSelectAll={selectAll}
                        onInvertSelection={invertSelection}
                        onClearSelection={clearSelection}
                        onCreateEmptyGroup={handleCreateEmptyGroup}
                        onAddToGroup={handleAddToGroup}
                        onRemoveFromGroup={handleRemoveFromGroup}
                        onDeleteGroup={handleDeleteGroup}
                        onRenameGroup={handleRenameGroup}
                        onGroupFeedbackChange={handleGroupFeedbackChange}
                        onGroupStatusChange={handleGroupStatusChange}
                        overallSummary={projectInfo.overallSummary}
                        overallSummaryEn={projectInfo.overallSummaryEn}
                        overallSummaryBackTranslation={projectInfo.overallSummaryBackTranslation}
                        overallSummaryIsAccurate={projectInfo.overallSummaryIsAccurate}
                        onOverallSummaryChange={(summary) => {
                            setProjectInfo(prev => ({ ...prev, overallSummary: summary }));
                        }}
                        onOverallSummaryEnChange={(summary) => {
                            setProjectInfo(prev => ({ ...prev, overallSummaryEn: summary }));
                        }}
                        onOverallSummaryTranslationUpdate={(english, backTranslation, isAccurate) => {
                            setProjectInfo(prev => ({
                                ...prev,
                                overallSummaryEn: english,
                                overallSummaryBackTranslation: backTranslation,
                                overallSummaryIsAccurate: isAccurate,
                            }));
                        }}
                    />
                ) : (
                    <>
                        {/* 左侧：图片区域 */}
                        <div className="flex-1 flex flex-col overflow-hidden">
                            {viewMode === 'grid' ? (
                                <ImageGrid
                                    images={images}
                                    selectedIds={selectedIds}
                                    activeImageId={activeImageId}
                                    onSelect={handleSelect}
                                    onActivate={handleActivate}
                                    onDelete={handleDelete}
                                    onCreateGroup={handleCreateGroup}
                                />
                            ) : activeImage ? (
                                <div className="flex-1 flex flex-col">
                                    {/* 导航栏 */}
                                    <div className="h-10 px-4 flex items-center justify-between bg-zinc-800/50 border-b border-zinc-700/50">
                                        <button
                                            onClick={() => navigateImage('prev')}
                                            className="p-1 hover:bg-zinc-700 rounded transition-colors"
                                        >
                                            <ChevronLeft size={20} />
                                        </button>
                                        <span className="text-sm text-zinc-400">
                                            {images.findIndex(img => img.id === activeImageId) + 1} / {images.length}
                                        </span>
                                        <button
                                            onClick={() => navigateImage('next')}
                                            className="p-1 hover:bg-zinc-700 rounded transition-colors"
                                        >
                                            <ChevronRight size={20} />
                                        </button>
                                    </div>

                                    {/* 标注画布 */}
                                    <ImageCanvas
                                        imageUrl={activeImage.imageUrl}
                                        annotations={activeImage.annotations}
                                        currentTool={currentAnnotationTool}
                                        annotationColor={annotationColor}
                                        onAnnotationsChange={handleAnnotationsChange}
                                        onToolChange={handleToolChange}
                                        onColorChange={handleColorChange}
                                    />
                                </div>
                            ) : (
                                <div className="flex-1 flex items-center justify-center text-zinc-500">
                                    <div className="text-center">
                                        <ImageIcon size={48} className="mx-auto mb-4 opacity-50" />
                                        <p className="text-lg mb-2">拖拽或粘贴图片到此处</p>
                                        <p className="text-sm">支持 JPG、PNG、WebP 等格式</p>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* 右侧：审核面板 */}
                        {showSidebar && (
                            <div style={{ width: sidebarWidth }} className="flex-shrink-0">
                                <ReviewPanelEnhanced
                                    image={activeImage}
                                    onStatusChange={handleStatusChange}
                                    onFeedbackItemsChange={handleFeedbackItemsChange}
                                    onTranslateAll={handleTranslateCurrentImage}
                                    isTranslating={isBatchTranslating}
                                    toneLevel={toneLevel}
                                    translationTargetLanguage={translationTargetLanguage}
                                />
                            </div>
                        )}
                    </>
                )}
            </div>

            {/* 底部状态栏 */}
            <div className="h-8 px-4 flex items-center justify-between border-t border-zinc-800 bg-zinc-900/50 text-xs text-zinc-500">
                <div className="flex items-center gap-4">
                    <span>共 <span className="text-white">{stats.total}</span> 张</span>
                    <span className="text-emerald-400">✅ 合格 {stats.approved}</span>
                    <span className="text-amber-400">✏️ 有建议 {stats.revision}</span>
                    <span className="text-red-400">❌ 不合格 {stats.rejected}</span>
                    <span>⏳ 待审 {stats.pending}</span>
                    <span className="mx-2">|</span>
                    <span className="text-red-400">🔴 {stats.criticalIssues}</span>
                    <span className="text-amber-400">🟡 {stats.majorIssues}</span>
                    <span className="text-blue-400">🔵 {stats.minorIssues}</span>
                    <span className="text-green-400">💡 {stats.suggestions}</span>
                </div>
                <div className="flex items-center gap-2">
                    <span>快捷键：← → 切换 | 1-3 设置状态 | Delete 删除</span>
                </div>
            </div>

            {/* 项目信息模态框 */}
            {showProjectModal && typeof document !== 'undefined' && createPortal(
                <div className="fixed inset-0 bg-black/60 flex items-start sm:items-center justify-center z-[2147483647] p-4 sm:p-6 overflow-y-auto">
                    <div
                        className="bg-zinc-800 rounded-xl w-[560px] max-w-[96vw] overflow-hidden flex flex-col"
                        style={{ maxHeight: `${projectModalMaxHeight}px` }}
                    >
                        <div className={`${isCompactModal ? 'px-4 py-3' : 'px-6 py-4'} border-b border-zinc-700/80`}>
                            <h2 className="text-lg font-semibold">项目信息</h2>
                        </div>
                        <div className={`flex-1 overflow-y-auto ${isCompactModal ? 'px-4 py-3 space-y-2.5' : 'px-6 py-4 space-y-3'}`}>
                            <div>
                                <label className="text-xs text-zinc-400 mb-1 block">项目名称</label>
                                <input
                                    type="text"
                                    value={projectInfo.name}
                                    onChange={(e) => setProjectInfo(prev => ({ ...prev, name: e.target.value }))}
                                    placeholder="例如：产品图片第一批"
                                    className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-white placeholder-zinc-500"
                                />
                            </div>
                            <div>
                                <label className="text-xs text-zinc-400 mb-1 block">审核人</label>
                                <input
                                    type="text"
                                    value={projectInfo.reviewerName}
                                    onChange={(e) => setProjectInfo(prev => ({ ...prev, reviewerName: e.target.value }))}
                                    placeholder="您的姓名"
                                    className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-white placeholder-zinc-500"
                                />
                            </div>
                            <div className="flex gap-3">
                                <div className="flex-1">
                                    <label className="text-xs text-zinc-400 mb-1 block">审核日期</label>
                                    <input
                                        type="date"
                                        value={projectInfo.reviewDate}
                                        onChange={(e) => setProjectInfo(prev => ({ ...prev, reviewDate: e.target.value }))}
                                        className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-white"
                                    />
                                </div>
                                <div className="flex-1">
                                    <label className="text-xs text-zinc-400 mb-1 block">批次号</label>
                                    <input
                                        type="text"
                                        value={projectInfo.batchNumber}
                                        onChange={(e) => setProjectInfo(prev => ({ ...prev, batchNumber: e.target.value }))}
                                        placeholder="例如：Batch-001"
                                        className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-white placeholder-zinc-500"
                                    />
                                </div>
                            </div>
                            <div>
                                <label className="text-xs text-zinc-400 mb-1 block">备注</label>
                                <textarea
                                    value={projectInfo.notes}
                                    onChange={(e) => setProjectInfo(prev => ({ ...prev, notes: e.target.value }))}
                                    placeholder="其他备注..."
                                    className={`w-full ${isCompactModal ? 'h-16' : 'h-20'} px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-white placeholder-zinc-500 resize-none`}
                                />
                            </div>

                            {/* 语气级别 */}
                            <div className="pt-3 border-t border-zinc-700">
                                <label className="text-xs text-zinc-400 mb-2 block flex items-center gap-2">
                                    <MessageCircle size={12} />
                                    翻译设置
                                </label>
                                <div className="mb-2">
                                    <p className="text-xs text-zinc-500 mb-1">目标语言</p>
                                    <input
                                        list={TRANSLATION_LANGUAGE_DATALIST_ID}
                                        value={translationTargetLanguage}
                                        onChange={(e) => setTranslationTargetLanguage(e.target.value || 'en')}
                                        placeholder="输入语言代码或名称（默认 en）"
                                        className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-white text-sm"
                                    />
                                    <datalist id={TRANSLATION_LANGUAGE_DATALIST_ID}>
                                        {TRANSLATION_TARGET_LANGUAGES.map((language) => (
                                            <option key={language.code} value={language.code}>
                                                {language.label} ({language.labelEn})
                                            </option>
                                        ))}
                                    </datalist>
                                </div>
                                <div className="mb-2">
                                    <p className="text-xs text-zinc-500 mb-1">搜索语言</p>
                                    <input
                                        type="text"
                                        value={translationLanguageSearch}
                                        onChange={(e) => setTranslationLanguageSearch(e.target.value)}
                                        placeholder="输入中文/English/语言代码搜索"
                                        className="w-full px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-white text-sm"
                                    />
                                    <div
                                        className="mt-2 overflow-y-auto overscroll-contain bg-zinc-800 border border-zinc-700 rounded-lg touch-pan-y"
                                        style={{ maxHeight: `${translationListMaxHeight}px` }}
                                        onWheel={(e) => e.stopPropagation()}
                                    >
                                        {filteredTranslationLanguages.map((language) => (
                                            <button
                                                key={language.code}
                                                type="button"
                                                onClick={() => setTranslationTargetLanguage(language.code)}
                                                className={`w-full px-3 py-2 text-left text-xs border-b border-zinc-700/60 last:border-b-0 hover:bg-zinc-700 ${translationTargetLanguage.toLowerCase() === language.code.toLowerCase()
                                                    ? 'bg-teal-700/30 text-teal-300'
                                                    : 'text-zinc-300'
                                                    }`}
                                            >
                                                {language.label} ({language.labelEn}) · {language.code}
                                            </button>
                                        ))}
                                        {filteredTranslationLanguages.length === 0 && (
                                            <div className="px-3 py-2 text-xs text-zinc-500">未找到匹配语言</div>
                                        )}
                                    </div>
                                </div>
                                <p className="text-xs text-zinc-500 mb-2">
                                    当前输出目标：{currentTranslationTargetConfig.label} ({currentTranslationTargetConfig.labelEn})
                                </p>
                                <p className="text-xs text-zinc-500 mb-2">
                                    支持输入任意语言代码（如 de / pt-BR / ar），不限于下拉建议项
                                </p>
                                <div className="flex gap-2">
                                    {(['neutral', 'suggestive', 'collaborative'] as ToneLevel[]).map(tone => {
                                        const config = TONE_CONFIG[tone];
                                        return (
                                            <button
                                                key={tone}
                                                onClick={() => setToneLevel(tone)}
                                                className={`flex-1 px-3 py-2 rounded-lg text-sm transition-colors ${toneLevel === tone
                                                    ? 'bg-teal-600 text-white'
                                                    : 'bg-zinc-700 text-zinc-400 hover:text-white hover:bg-zinc-600'
                                                    }`}
                                            >
                                                <div className="font-medium">{config.label}</div>
                                                <div className="text-xs opacity-70 mt-0.5">{config.labelEn}</div>
                                            </button>
                                        );
                                    })}
                                </div>
                                <p className="text-xs text-zinc-500 mt-2">
                                    {toneLevel === 'neutral' && '客观陈述问题，不带情感色彩'}
                                    {toneLevel === 'suggestive' && '以建议方式表达，温和友好 (推荐)'}
                                    {toneLevel === 'collaborative' && '强调团队合作，共同解决问题'}
                                </p>
                            </div>
                        </div>
                        <div className={`${isCompactModal ? 'px-4 py-3' : 'px-6 py-4'} border-t border-zinc-700/80 flex justify-end gap-2 shrink-0`}>
                            <button
                                onClick={() => setShowProjectModal(false)}
                                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={() => setShowProjectModal(false)}
                                className="px-4 py-2 bg-teal-600 hover:bg-teal-700 rounded-lg transition-colors"
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* 功能说明弹窗 */}
            {showUpdateNotes && typeof document !== 'undefined' && createPortal(
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[2147483647] flex items-center justify-center p-4"
                    onClick={closeUpdateNotes}
                >
                    <div
                        className="bg-gradient-to-br from-zinc-900 via-zinc-900 to-emerald-950/30 border border-emerald-700/40 rounded-2xl shadow-2xl max-w-md w-full max-h-[58vh] overflow-hidden flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="px-4 py-3 border-b border-emerald-800/30 flex items-start justify-between bg-gradient-to-r from-emerald-900/20 to-transparent">
                            <div className="flex items-start gap-4">
                                <div className="bg-emerald-500/20 rounded-xl p-2 mt-0.5">
                                    <Sparkles className="text-emerald-400 w-5 h-5" fill="currentColor" />
                                </div>
                                <div>
                                    <h2 className="text-lg font-bold text-emerald-400">功能说明</h2>
                                    <p className="text-sm text-zinc-400 mt-1">图片审核工具是做什么的</p>
                                </div>
                            </div>
                            <button
                                onClick={closeUpdateNotes}
                                className="px-3 py-1.5 text-xs font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
                            >
                                知道了
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto px-4 py-3">
                            <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50 space-y-3">
                                <div>
                                    <p className="text-xs text-emerald-300 font-semibold mb-1">1. 导入与分组</p>
                                    <ul className="text-sm text-zinc-300 leading-relaxed space-y-1 list-disc list-inside">
                                        <li>支持拖拽、粘贴、批量导入图片。</li>
                                        <li>可多选图片创建分组，便于同类问题一起审核。</li>
                                    </ul>
                                </div>

                                <div>
                                    <p className="text-xs text-emerald-300 font-semibold mb-1">2. 审核与标注</p>
                                    <ul className="text-sm text-zinc-300 leading-relaxed space-y-1 list-disc list-inside">
                                        <li>状态分为：合格、有建议、不合格。</li>
                                        <li>支持在图片上标注问题区域，并填写“问题 + 建议”双栏反馈。</li>
                                    </ul>
                                </div>

                                <div>
                                    <p className="text-xs text-emerald-300 font-semibold mb-1">3. 翻译与导出</p>
                                    <ul className="text-sm text-zinc-300 leading-relaxed space-y-1 list-disc list-inside">
                                        <li>可批量翻译英文反馈，便于跨语言反馈建议。</li>
                                        <li>支持导出 PDF、文本、HTML 报告，以及 Gyazo 在线分享链接。</li>
                                    </ul>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* 加载指示器 */}
            {isLoading && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
                    <div className="bg-zinc-800 rounded-lg p-6 flex items-center gap-3">
                        <Loader2 size={24} className="animate-spin text-teal-400" />
                        <span>处理中...</span>
                    </div>
                </div>
            )}

            {/* 点击其他地方关闭导出菜单 */}
            {showExportMenu && (
                <div
                    className="fixed inset-0 z-40"
                    onClick={() => setShowExportMenu(false)}
                />
            )}
        </div>
    );
};

export default ImageReviewApp;
