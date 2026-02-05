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
import React, { useState, useCallback, useEffect, useRef } from 'react';
import {
    Upload, Grid, Image as ImageIcon, LayoutGrid, Trash2, Download,
    HelpCircle, Settings, ChevronLeft, ChevronRight, Maximize2, Minimize2,
    FolderPlus, Layers, Eye, EyeOff, RefreshCw, Check, X, Loader2,
    FileText, Copy, Clipboard, ListChecks, MessageCircle, List, Globe
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
import { translateFeedback, ToneLevel, TONE_CONFIG } from './services/translationService';
import {
    generateReportSummary, downloadPDFReport, downloadTextReport, copyReportToClipboard, downloadHTMLReport,
    generateReportImageAndUploadToGyazo, type HTMLExportMode
} from './services/reportExportService';
import { uploadBase64ToGyazo, getGyazoToken, uploadBase64ToGyazoAndShorten } from './services/gyazoService';

interface ImageReviewAppProps {
    standalone?: boolean;
}

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
    const [showExportMenu, setShowExportMenu] = useState(false);

    // Gyazo 长图分享
    const [isGeneratingShareLink, setIsGeneratingShareLink] = useState(false);
    const [gyazoShareLink, setGyazoShareLink] = useState<string | null>(null);

    // 视图模式：review = 审核视图, list = 列表审核, execution = 执行清单
    const [mainViewMode, setMainViewMode] = useState<'review' | 'list' | 'execution'>('review');

    // 语气级别
    const [toneLevel, setToneLevel] = useState<ToneLevel>('suggestive');

    const dropZoneRef = useRef<HTMLDivElement>(null);

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
                updated.problemTranslation = await translateFeedback(item.problemCn);
                progress++;
                setBatchProgress({ current: progress, total: items.length * 2 });
            }

            if (item.suggestionCn.trim()) {
                updated.suggestionTranslation = await translateFeedback(item.suggestionCn);
                progress++;
                setBatchProgress({ current: progress, total: items.length * 2 });
            }

            translatedItems.push(updated);
        }

        handleFeedbackItemsChange(translatedItems);
        setIsBatchTranslating(false);
    }, [activeImage, handleFeedbackItemsChange]);

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
                    updated.problemTranslation = await translateFeedback(item.problemCn);
                    progress++;
                    setBatchProgress({ current: progress, total: totalTasks });
                }

                if (item.suggestionCn.trim() && !item.suggestionTranslation) {
                    updated.suggestionTranslation = await translateFeedback(item.suggestionCn);
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
    }, [images]);

    // ========== 导出功能 ==========

    const handleExportPDF = useCallback(async (useEnglish: boolean) => {
        if (images.length === 0) return;
        await downloadPDFReport(images, projectInfo, useEnglish);
        setShowExportMenu(false);
    }, [images, projectInfo]);

    const handleExportText = useCallback((useEnglish: boolean) => {
        if (images.length === 0) return;
        downloadTextReport(images, projectInfo, useEnglish);
        setShowExportMenu(false);
    }, [images, projectInfo]);

    const handleCopyReport = useCallback(async (useEnglish: boolean) => {
        if (images.length === 0) return;
        await copyReportToClipboard(images, projectInfo, useEnglish);
        setShowExportMenu(false);
    }, [images, projectInfo]);

    const handleExportHTML = useCallback((mode: HTMLExportMode = 'online') => {
        if (images.length === 0) return;
        downloadHTMLReport(images, projectInfo, mode);
        setShowExportMenu(false);
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

    return (
        <div
            ref={dropZoneRef}
            className="h-full flex flex-col bg-zinc-950 text-white"
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
                            <div className="absolute top-full left-0 mt-1 w-56 bg-zinc-800 border border-zinc-700 rounded-lg shadow-xl z-50">
                                <div className="p-2 border-b border-zinc-700">
                                    <p className="text-xs text-zinc-400 px-2">英文报告 (For Team)</p>
                                </div>
                                <button
                                    onClick={() => handleExportPDF(true)}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
                                >
                                    <Download size={14} />
                                    打印/下载 PDF (英文)
                                </button>
                                <button
                                    onClick={() => handleExportText(true)}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
                                >
                                    <FileText size={14} />
                                    下载文本 (英文)
                                </button>
                                <button
                                    onClick={() => handleCopyReport(true)}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
                                >
                                    <Copy size={14} />
                                    复制到剪贴板 (英文)
                                </button>

                                <div className="p-2 border-t border-zinc-700 mt-1">
                                    <p className="text-xs text-zinc-400 px-2">中文报告</p>
                                </div>
                                <button
                                    onClick={() => handleExportPDF(false)}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
                                >
                                    <Download size={14} />
                                    打印/下载 PDF (中文)
                                </button>
                                <button
                                    onClick={() => handleExportText(false)}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
                                >
                                    <FileText size={14} />
                                    下载文本 (中文)
                                </button>

                                <div className="p-2 border-t border-zinc-700 mt-1">
                                    <div className="flex items-center justify-between px-2">
                                        <p className="text-xs text-zinc-400">📱 网页版 (手机友好)</p>
                                        {/* Gyazo 上传状态 */}
                                        {(() => {
                                            const uploadingCount = images.filter(img => img.isUploadingToGyazo).length;
                                            const uploadedCount = images.filter(img => img.gyazoUrl).length;
                                            const totalWithBase64 = images.filter(img => img.base64Data).length;

                                            if (uploadingCount > 0) {
                                                return <span className="text-xs text-amber-400">🔄 {uploadingCount} 上传中...</span>;
                                            } else if (uploadedCount > 0) {
                                                return <span className="text-xs text-emerald-400">☁️ {uploadedCount}/{images.length}</span>;
                                            }
                                            return null;
                                        })()}
                                    </div>
                                </div>
                                <button
                                    onClick={() => handleExportHTML('online')}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
                                    title="使用 Gyazo 云端链接，文件小，需要联网查看"
                                >
                                    <Globe size={14} />
                                    🌐 在线版 (文件小)
                                    <span className="ml-auto text-xs text-zinc-500">
                                        {images.filter(img => img.gyazoUrl).length}/{images.length}
                                    </span>
                                </button>
                                <button
                                    onClick={() => handleExportHTML('offline')}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
                                    title="使用 base64 嵌入图片，文件大，离线可用"
                                >
                                    <Download size={14} />
                                    💾 离线版 (原图)
                                    <span className="ml-auto text-xs text-zinc-500">
                                        {images.filter(img => img.base64Data).length}/{images.length}
                                    </span>
                                </button>
                                <button
                                    onClick={() => handleExportHTML('compressed')}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
                                    title="压缩图片后嵌入，文件较小，离线可用"
                                >
                                    <Download size={14} />
                                    📦 压缩版 (中英对照)
                                    <span className="ml-auto text-xs text-zinc-500">800px</span>
                                </button>
                                <button
                                    onClick={() => handleExportHTML('compressed-english')}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 flex items-center gap-2"
                                    title="纯英文版本，适合发送给海外团队"
                                >
                                    <Download size={14} />
                                    🇺🇸 压缩版 (纯英文)
                                    <span className="ml-auto text-xs text-zinc-500">English</span>
                                </button>

                                {/* Gyazo 长图分享 */}
                                <div className="p-2 border-t border-zinc-700 mt-1">
                                    <p className="text-xs text-zinc-400 px-2">🔗 在线分享 (Gyazo)</p>
                                </div>
                                <button
                                    onClick={handleGenerateGyazoShareLink}
                                    disabled={isGeneratingShareLink || images.length === 0}
                                    className="w-full px-3 py-2 text-left text-sm hover:bg-zinc-700 disabled:text-zinc-500 flex items-center gap-2"
                                    title="生成报告长图并上传到 Gyazo，获取分享链接"
                                >
                                    {isGeneratingShareLink ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" />
                                            生成中...
                                        </>
                                    ) : (
                                        <>
                                            <Globe size={14} />
                                            📸 生成分享长图
                                        </>
                                    )}
                                </button>

                                {/* 显示生成的链接 */}
                                {gyazoShareLink && (
                                    <div className="px-3 py-2 bg-emerald-900/30 border-t border-emerald-700">
                                        <p className="text-xs text-emerald-400 mb-1">✅ 链接已复制!</p>
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
            {showProjectModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="bg-zinc-800 rounded-xl p-6 w-[500px] max-w-[90vw]">
                        <h2 className="text-lg font-semibold mb-4">项目信息</h2>
                        <div className="space-y-3">
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
                                    className="w-full h-20 px-3 py-2 bg-zinc-700 border border-zinc-600 rounded-lg text-white placeholder-zinc-500 resize-none"
                                />
                            </div>

                            {/* 语气级别 */}
                            <div className="pt-3 border-t border-zinc-700">
                                <label className="text-xs text-zinc-400 mb-2 block flex items-center gap-2">
                                    <MessageCircle size={12} />
                                    英文翻译语气
                                </label>
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
                        <div className="flex justify-end gap-2 mt-4">
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
                </div>
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
