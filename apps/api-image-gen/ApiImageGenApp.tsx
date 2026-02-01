// API 生图 - 主组件 (表格批量模式)

import React, { useState, useCallback, useRef, useEffect } from 'react';
import {
    Upload,
    Image as ImageIcon,
    Wand2,
    Play,
    Download,
    RefreshCw,
    Trash2,
    Check,
    AlertCircle,
    Loader2,
    ChevronDown,
    ChevronUp,
    X,
    Plus,
    Edit3,
    Copy,
    Sparkles,
    Layers,
    CheckSquare,
    Square,
    Zap,
    ListPlus,
    Pause,
    Table2,
    ClipboardPaste,
    FolderDown,
    Merge,
    Split,
    Settings,
    RotateCcw,
    History,
    Save,
    Bookmark,
    Maximize2
} from 'lucide-react';
import { HistorySidebar } from './components/HistorySidebar';
import { ImagePreviewPanel } from './components/ImagePreviewPanel';
import {
    WorkflowState,
    GeneratedPrompt,
    ImageGenTask,
    ImageGenModel,
    ImageSize,
    DEFAULT_PROMPT_INSTRUCTION,
    DEFAULT_USER_INSTRUCTION,
    SIZE_OPTIONS,
    MODEL_OPTIONS,
    TaskStatus,
    generateFilePrefix,
    generateDefaultInstruction,
    generateUserInstruction,
    generateFormatRequirement,
    GeneratedImage
} from './types';
import {
    generatePrompts,
    generateImage,
    downloadImage
} from './services/imageGenService';
import {
    parseSheetsPaste,
    fetchImageAsFile,
    extractUrlsFromHtml
} from './utils';
import './ApiImageGen.css';

// 批量输入行类型
interface BatchInputRow {
    id: string;
    images: File[];
    imageUrls: string[]; // 用于显示远程图片
    prompt: string;
    downloadFolder: string;
    status: 'pending' | 'ready' | 'added' | 'loading';
}

// 拖拽模式
type DragMode = 'merge' | 'split';

// 初始状态
const initialState: WorkflowState = {
    inputImages: [],
    inputText: '',
    promptInstruction: DEFAULT_PROMPT_INSTRUCTION,
    promptCount: 4,
    generatedPrompts: [],
    isGeneratingPrompts: false,
    model: 'gemini-2.5-flash-image',
    size: '1024x1792',
    useReferenceImage: false,
    tasks: [],
    isGeneratingImages: false,
    autoDownload: true,
    imagesPerPrompt: 1, // 默认每个词生成1张图
};

// 垫图模式类型
type RefMode = 'standard' | 'fixed';

// 工作流模式：classic=经典模式(直接生图), creative=创新模式(先分析再生图)
type WorkflowMode = 'classic' | 'creative';

const ApiImageGenApp: React.FC = () => {
    const [state, setState] = useState<WorkflowState>(initialState);
    const [showInstructionEditor, setShowInstructionEditor] = useState(false);
    const [expandedSections, setExpandedSections] = useState({
        batch: true,
        queue: true,
    });
    const [isProcessingQueue, setIsProcessingQueue] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [resetConfirmPending, setResetConfirmPending] = useState(false);
    const pauseRef = useRef(false);
    const isProcessingQueueRef = useRef(false);

    // 批量输入表格数据
    const [batchRows, setBatchRows] = useState<BatchInputRow[]>([
        { id: `row-${Date.now()}`, images: [], imageUrls: [], prompt: '', downloadFolder: '', status: 'pending' }
    ]);

    // 拖拽模式：merge=多图合并到一行, split=一图一行
    const [dragMode, setDragMode] = useState<DragMode>('split');
    const [isDragging, setIsDragging] = useState(false);

    // 垫图模式相关状态
    // useRefForGeneration: 是否保留参考图结构（开启=图生图，关闭=文生图）
    // refMode: 'fixed'=固定人物模式, 'standard'=普通垫图模式
    const [useRefForGeneration, setUseRefForGeneration] = useState(false);
    const [refMode, setRefMode] = useState<RefMode>('standard');

    // 工作流模式：classic=经典模式(直接生图), creative=创新模式(先分析再生图)
    const [workflowMode, setWorkflowMode] = useState<WorkflowMode>('creative');

    // 创新模式工作流步骤: input=输入阶段, review=审核变体阶段, queued=已添加到队列
    type WorkflowStep = 'input' | 'review' | 'queued';
    const [creativeWorkflowStep, setCreativeWorkflowStep] = useState<WorkflowStep>('input');
    // 是否正在分析生成描述词
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    // 创新模式生成的描述词变体
    const [creativePrompts, setCreativePrompts] = useState<{ en: string; zh: string }[]>([]);

    // 历史记录
    const [history, setHistory] = useState<GeneratedImage[]>([]);
    const [isHistoryOpen, setIsHistoryOpen] = useState(false);
    const [previewImage, setPreviewImage] = useState<GeneratedImage | null>(null);

    // 大窗口编辑模态框
    const [textEditorModal, setTextEditorModal] = useState<{
        isOpen: boolean;
        title: string;
        value: string;
        onSave: (value: string) => void;
    }>({ isOpen: false, title: '', value: '', onSave: () => { } });

    // 自定义确认模态框（替代浏览器alert/confirm）
    const [confirmModal, setConfirmModal] = useState<{
        isOpen: boolean;
        title: string;
        message: string;
        onConfirm: () => void;
    }>({ isOpen: false, title: '', message: '', onConfirm: () => { } });

    // 创新要求预设
    const [instructionPresets, setInstructionPresets] = useState<{ name: string; content: string }[]>(() => {
        const saved = localStorage.getItem('api_gen_instruction_presets');
        return saved ? JSON.parse(saved) : [
            { name: '默认 - 详细描述', content: DEFAULT_USER_INSTRUCTION },
            { name: '创意风格 - 艺术化', content: '请根据图片内容，创作出具有艺术感的AI描述词。\n风格可以包括：油画风、水彩风、赛博朋克、极简主义等。\n突出画面的情感和氛围。' },
            { name: '商业风格 - 产品展示', content: '请根据图片，生成适合商业用途的产品展示描述词。\n突出产品特点、质感和专业感。\n适合用于电商、广告等场景。' }
        ];
    });

    const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
    const containerRef = useRef<HTMLDivElement>(null);
    const dropzoneRef = useRef<HTMLDivElement>(null);
    // 用于解决createWorkflow中调用processQueue的循环依赖问题
    const processQueueRef = useRef<() => void>(() => { });


    // 从 localStorage 加载历史记录
    useEffect(() => {
        const saved = localStorage.getItem('api_gen_history_v2');
        if (saved) {
            try {
                const parsed = JSON.parse(saved);
                setHistory(parsed);
            } catch (e) {
                console.error("Failed to load history", e);
            }
        }
    }, []);

    // 保存历史记录到 localStorage（带错误处理和数量限制）
    useEffect(() => {
        try {
            // 只保留最近20条记录，避免localStorage超限
            const limitedHistory = history.slice(0, 20);
            localStorage.setItem('api_gen_history_v2', JSON.stringify(limitedHistory));
        } catch (e) {
            // 如果存储失败（quota exceeded），尝试清理旧数据
            console.warn('[ApiImageGen] 历史记录存储失败，尝试清理:', e);
            try {
                // 只保留最近5条
                const minimalHistory = history.slice(0, 5);
                localStorage.setItem('api_gen_history_v2', JSON.stringify(minimalHistory));
            } catch (e2) {
                // 如果还是失败，删除历史记录
                console.error('[ApiImageGen] 无法保存历史记录，清除存储:', e2);
                localStorage.removeItem('api_gen_history_v2');
            }
        }
    }, [history]);

    // 添加图片到历史记录
    const addToHistory = useCallback((task: ImageGenTask) => {
        if (!task.result) return;
        const newImage: GeneratedImage = {
            id: task.id,
            url: task.result,
            prompt: task.promptText,
            promptZh: task.promptTextZh,
            model: task.model,
            size: task.size,
            timestamp: task.completedAt || Date.now(),
        };
        setHistory(prev => [newImage, ...prev].slice(0, 100)); // 最多保留100条
    }, []);

    // 删除历史记录
    const deleteFromHistory = useCallback((id: string) => {
        setHistory(prev => prev.filter(img => img.id !== id));
        if (previewImage?.id === id) {
            setPreviewImage(null);
        }
    }, [previewImage]);

    // 清空历史记录
    const clearHistory = useCallback(() => {
        setHistory([]);
        setPreviewImage(null);
    }, []);

    // 保存预设到 localStorage
    useEffect(() => {
        localStorage.setItem('api_gen_instruction_presets', JSON.stringify(instructionPresets));
    }, [instructionPresets]);

    // 添加新预设
    const addInstructionPreset = useCallback((name: string, content: string) => {
        setInstructionPresets(prev => [...prev, { name, content }]);
    }, []);

    // 删除预设
    const deleteInstructionPreset = useCallback((index: number) => {
        setInstructionPresets(prev => prev.filter((_, i) => i !== index));
    }, []);

    // 打开大窗口编辑器
    const openTextEditor = useCallback((title: string, value: string, onSave: (value: string) => void) => {
        setTextEditorModal({ isOpen: true, title, value, onSave });
    }, []);

    // 关闭大窗口编辑器
    const closeTextEditor = useCallback(() => {
        setTextEditorModal(prev => ({ ...prev, isOpen: false }));
    }, []);

    // 更新状态
    const updateState = useCallback((updates: Partial<WorkflowState>) => {
        setState(prev => ({ ...prev, ...updates }));
    }, []);

    // ===== 创新模式核心函数 =====

    // 获取增强后的prompt（如果开启垫图模式需要加入固定人物指令）
    const getEnhancedPrompt = useCallback((basePrompt: string) => {
        if (useRefForGeneration && refMode === 'fixed') {
            return "STRICT INSTRUCTION: Keep the character's face, hair, and body features EXACTLY as shown in the reference image. Do not change the person's identity. Only modify the clothing, pose, environment, or style as described here: " + basePrompt;
        }
        return basePrompt;
    }, [useRefForGeneration, refMode]);

    // 运行创新工作流 - 分析图片生成描述词
    // skipReview: true=一键生成, false=分析与审核
    const runCreativeWorkflow = useCallback(async (skipReview: boolean) => {
        // 获取有效行（有图片或描述词的行）
        const validRows = batchRows.filter(row => row.images.length > 0 || row.prompt.trim());
        if (validRows.length === 0) return;

        setIsAnalyzing(true);

        try {
            // 获取第一个有效行的图片和输入（可以扩展支持多行）
            const firstRow = validRows[0];
            const inputImages = firstRow.images;
            const inputText = firstRow.prompt;

            // 调用AI生成描述词
            const prompts = await generatePrompts(
                inputImages,
                inputText,
                state.promptInstruction,
                'gemini-3-pro-preview',
                state.promptCount
            );

            // 转换为创新模式的格式
            const creativeResults = prompts.map(p => ({
                en: p.textEn,
                zh: p.textZh
            }));

            setCreativePrompts(creativeResults);

            if (skipReview) {
                // 一键生成：直接添加到队列并开始
                const batchPrefix = generateFilePrefix();
                const newTasks: ImageGenTask[] = creativeResults.map((p, idx) => ({
                    id: `task-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`,
                    promptId: `creative-${idx}`,
                    promptText: getEnhancedPrompt(p.en),
                    promptTextZh: p.zh,
                    filename: `${batchPrefix}-${idx + 1}.png`,
                    model: state.model,
                    size: state.size,
                    useReferenceImage: useRefForGeneration && inputImages.length > 0,
                    referenceImages: useRefForGeneration ? [...inputImages] : undefined,
                    status: 'pending' as TaskStatus,
                    progress: 0,
                    createdAt: Date.now(),
                }));

                setState(prev => ({
                    ...prev,
                    tasks: [...prev.tasks, ...newTasks],
                }));

                setCreativeWorkflowStep('queued');
                // 延迟启动队列处理（使用ref避免循环依赖）
                setTimeout(() => processQueueRef.current(), 100);
            } else {
                // 分析与审核：进入审核界面
                setCreativeWorkflowStep('review');
            }

        } catch (error) {
            console.error('[创新模式] 分析失败:', error);
        } finally {
            setIsAnalyzing(false);
        }
    }, [batchRows, state.promptInstruction, state.promptCount, state.model, state.size, useRefForGeneration, getEnhancedPrompt]);

    // 从审核界面生成图片
    const handleCreativeGenerate = useCallback(() => {
        if (creativePrompts.length === 0) return;

        const batchPrefix = generateFilePrefix();
        const firstRow = batchRows.find(row => row.images.length > 0);
        const inputImages = firstRow?.images || [];

        const newTasks: ImageGenTask[] = creativePrompts.map((p, idx) => ({
            id: `task-${Date.now()}-${idx}-${Math.random().toString(36).substr(2, 9)}`,
            promptId: `creative-${idx}`,
            promptText: getEnhancedPrompt(p.en),
            promptTextZh: p.zh,
            filename: `${batchPrefix}-${idx + 1}.png`,
            model: state.model,
            size: state.size,
            useReferenceImage: useRefForGeneration && inputImages.length > 0,
            referenceImages: useRefForGeneration ? [...inputImages] : undefined,
            status: 'pending' as TaskStatus,
            progress: 0,
            createdAt: Date.now(),
        }));

        setState(prev => ({
            ...prev,
            tasks: [...prev.tasks, ...newTasks],
        }));

        setCreativeWorkflowStep('queued');
        setTimeout(() => processQueueRef.current(), 100);
    }, [creativePrompts, batchRows, state.model, state.size, useRefForGeneration, getEnhancedPrompt]);

    // 重置创新工作流
    const resetCreativeWorkflow = useCallback(() => {
        setCreativeWorkflowStep('input');
        setCreativePrompts([]);
    }, []);

    // 更新创新模式描述词
    const updateCreativePrompt = useCallback((index: number, updates: { en?: string; zh?: string }) => {
        setCreativePrompts(prev => prev.map((p, i) => i === index ? { ...p, ...updates } : p));
    }, []);

    // 删除创新模式描述词
    const deleteCreativePrompt = useCallback((index: number) => {
        setCreativePrompts(prev => prev.filter((_, i) => i !== index));
    }, []);

    // 添加新的创新模式描述词
    const addCreativePrompt = useCallback(() => {
        setCreativePrompts(prev => [...prev, { en: 'New prompt...', zh: '新变体...' }]);
    }, []);

    // 处理全局粘贴事件 (支持 Google Sheets 图片+文本)
    useEffect(() => {
        const handlePaste = async (e: ClipboardEvent) => {
            const container = containerRef.current;
            if (!container) return;

            const rect = container.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0;
            if (!isVisible) return;

            const targetNode = e.target as Node;
            const isInContainer = container.contains(targetNode);
            const isBodyOrDocument = targetNode === document.body || targetNode === document.documentElement || targetNode === document;
            if (!isInContainer && !isBodyOrDocument) return;

            if (!e.clipboardData) return;

            // 检查是否在输入框中
            const target = e.target as HTMLElement;
            const isInInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA';

            // 1. 检查是否有图片文件 (优先级最高，无论焦点在哪都处理)
            const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
            if (files.length > 0) {
                e.preventDefault();
                handleBulkImageDrop(files);
                return;
            }

            // 2. 检查 clipboard items (某些浏览器的图片粘贴方式)
            const items = Array.from(e.clipboardData.items || []);
            const imageItems = items.filter(item => item.type.startsWith('image/'));
            if (imageItems.length > 0) {
                const imageFiles = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
                if (imageFiles.length > 0) {
                    e.preventDefault();
                    handleBulkImageDrop(imageFiles);
                    return;
                }
            }

            // 3. 检查 HTML (Google Sheets 复制的图片/表格会以 HTML 形式存在)
            const html = e.clipboardData.getData('text/html');
            const plainText = e.clipboardData.getData('text/plain');

            // 检测是否有可解析的特殊内容
            const hasHtmlContent = html && (
                html.includes('<img') ||
                html.includes('<table') ||
                html.includes('<tr')
            );
            const hasSpecialTextContent = plainText && (
                plainText.includes('=IMAGE') ||
                (plainText.includes('\t') && plainText.includes('\n')) // 多行 Tab 分隔的数据
            );

            // 如果在输入框中且没有特殊内容，让输入框正常处理
            if (isInInput && !hasHtmlContent && !hasSpecialTextContent) {
                return;
            }

            if (hasHtmlContent || hasSpecialTextContent) {
                e.preventDefault();
                await handleSheetsPaste(html || '', plainText || '');
                return;
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [dragMode]);

    // 处理 Google Sheets 粘贴
    const handleSheetsPaste = async (html: string, plainText: string) => {
        const parsed = parseSheetsPaste(html, plainText);
        if (parsed.length === 0) return;

        // 创建新行
        const newRows: BatchInputRow[] = parsed.map((item, index) => ({
            id: `row-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
            images: [],
            imageUrls: item.imageUrl ? [item.imageUrl] : [],
            prompt: item.prompt,
            downloadFolder: '',
            status: 'loading' as const
        }));

        setBatchRows(prev => [...prev.filter(r => r.prompt.trim() || r.images.length > 0 || r.imageUrls.length > 0), ...newRows]);

        // 异步下载图片
        for (const row of newRows) {
            if (row.imageUrls.length > 0) {
                const file = await fetchImageAsFile(row.imageUrls[0]);
                setBatchRows(prev => prev.map(r => {
                    if (r.id !== row.id) return r;
                    return {
                        ...r,
                        images: file ? [file] : [],
                        status: 'ready' as const
                    };
                }));
            } else {
                setBatchRows(prev => prev.map(r =>
                    r.id === row.id ? { ...r, status: 'ready' as const } : r
                ));
            }
        }
    };

    // 批量拖拽图片处理
    const handleBulkImageDrop = useCallback((files: File[]) => {
        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) return;

        if (dragMode === 'merge') {
            // 合并模式：所有图片添加到第一个空行或新建一行
            setBatchRows(prev => {
                const emptyRowIndex = prev.findIndex(r => r.images.length === 0 && !r.prompt.trim());
                if (emptyRowIndex >= 0) {
                    return prev.map((r, i) =>
                        i === emptyRowIndex
                            ? { ...r, images: [...r.images, ...imageFiles], status: 'ready' as const }
                            : r
                    );
                } else {
                    return [...prev, {
                        id: `row-${Date.now()}-merge`,
                        images: imageFiles,
                        imageUrls: [],
                        prompt: '',
                        downloadFolder: '',
                        status: 'ready' as const
                    }];
                }
            });
        } else {
            // 分离模式：每张图一行
            const newRows: BatchInputRow[] = imageFiles.map((file, index) => ({
                id: `row-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 5)}`,
                images: [file],
                imageUrls: [],
                prompt: '',
                downloadFolder: '',
                status: 'ready' as const
            }));
            setBatchRows(prev => [...prev.filter(r => r.prompt.trim() || r.images.length > 0), ...newRows]);
        }
    }, [dragMode]);

    // 拖拽事件处理
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length > 0) {
            handleBulkImageDrop(files);
        }
    }, [handleBulkImageDrop]);

    // 添加新行
    const handleAddRow = useCallback(() => {
        setBatchRows(prev => [
            ...prev,
            { id: `row-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, images: [], imageUrls: [], prompt: '', downloadFolder: '', status: 'pending' }
        ]);
    }, []);

    // 删除行
    const handleRemoveRow = useCallback((rowId: string) => {
        setBatchRows(prev => prev.filter(r => r.id !== rowId));
    }, []);

    // 更新行数据
    const handleUpdateRow = useCallback((rowId: string, updates: Partial<BatchInputRow>) => {
        setBatchRows(prev => prev.map(r =>
            r.id === rowId ? { ...r, ...updates, status: 'ready' } : r
        ));
    }, []);

    // 处理图片上传到行
    const handleRowImageUpload = useCallback((rowId: string, files: FileList | null) => {
        if (!files) return;
        const newImages = Array.from(files).filter(f => f.type.startsWith('image/'));
        setBatchRows(prev => prev.map(r =>
            r.id === rowId ? { ...r, images: [...r.images, ...newImages], status: 'ready' } : r
        ));
    }, []);

    // 行级拖拽处理 - 直接拖拽图片到单元格
    const handleRowDrop = useCallback((rowId: string, e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length > 0) {
            setBatchRows(prev => prev.map(r =>
                r.id === rowId ? { ...r, images: [...r.images, ...files], status: 'ready' } : r
            ));
        }
    }, []);

    // 删除行中的图片
    const handleRemoveRowImage = useCallback((rowId: string, imageIndex: number) => {
        setBatchRows(prev => prev.map(r => {
            if (r.id !== rowId) return r;
            const newImages = [...r.images];
            newImages.splice(imageIndex, 1);
            return { ...r, images: newImages };
        }));
    }, []);

    // 更新描述词个数
    const handlePromptCountChange = useCallback((count: number) => {
        const validCount = Math.max(1, Math.min(10, count));
        updateState({
            promptCount: validCount,
            promptInstruction: generateDefaultInstruction(validCount)
        });
    }, [updateState]);

    // 将批量输入行添加到队列
    const handleAddBatchToQueue = useCallback(() => {
        const validRows = batchRows.filter(r => r.prompt.trim() || r.images.length > 0);
        if (validRows.length === 0) {
            alert('请先添加至少一个有效的任务行');
            return;
        }

        const batchPrefix = generateFilePrefix();
        const imagesPerPrompt = state.imagesPerPrompt || 1;

        // 为每个row根据imagesPerPrompt生成多个任务
        const newTasks: ImageGenTask[] = [];
        validRows.forEach((row, rowIndex) => {
            for (let imgIdx = 0; imgIdx < imagesPerPrompt; imgIdx++) {
                newTasks.push({
                    id: `task-${Date.now()}-${rowIndex}-${imgIdx}-${Math.random().toString(36).substr(2, 9)}`,
                    promptId: row.id,
                    promptText: row.prompt,
                    promptTextZh: row.prompt, // 用户直接输入的 prompt
                    filename: row.downloadFolder
                        ? `${row.downloadFolder}/${batchPrefix}-${rowIndex + 1}-${imgIdx + 1}.png`
                        : `${batchPrefix}-${rowIndex + 1}${imagesPerPrompt > 1 ? `-${imgIdx + 1}` : ''}.png`,
                    model: state.model,
                    size: state.size,
                    useReferenceImage: row.images.length > 0,
                    referenceImages: row.images.length > 0 ? [...row.images] : undefined,
                    status: 'pending' as TaskStatus,
                    progress: 0,
                    createdAt: Date.now(),
                });
            }
        });

        setState(prev => ({
            ...prev,
            tasks: [...prev.tasks, ...newTasks],
        }));

        // 标记行为已添加
        setBatchRows(prev => prev.map(r =>
            validRows.find(vr => vr.id === r.id) ? { ...r, status: 'added' as const } : r
        ));
    }, [batchRows, state.model, state.size, state.imagesPerPrompt]);

    // 添加并开始
    const handleAddBatchAndStart = useCallback(() => {
        handleAddBatchToQueue();
        setTimeout(() => {
            processQueue();
        }, 100);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handleAddBatchToQueue]);

    // 清空批量输入
    const handleClearBatch = useCallback(() => {
        setConfirmModal({
            isOpen: true,
            title: '确认清空',
            message: '确定要清空表格吗？',
            onConfirm: () => {
                setBatchRows([
                    { id: `row-${Date.now()}`, images: [], imageUrls: [], prompt: '', downloadFolder: '', status: 'pending' }
                ]);
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
            }
        });
    }, []);

    // 处理队列中的任务
    const processQueue = useCallback(async () => {
        // 使用 ref 来检查，避免闭包问题
        if (isProcessingQueueRef.current) return;

        isProcessingQueueRef.current = true;
        setIsProcessingQueue(true);
        updateState({ isGeneratingImages: true });

        while (true) {
            if (pauseRef.current) {
                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
            }

            const currentState = await new Promise<WorkflowState>(resolve => {
                setState(prev => {
                    resolve(prev);
                    return prev;
                });
            });

            const pendingTask = currentState.tasks.find(t => t.status === 'pending');
            if (!pendingTask) break;

            setState(prev => ({
                ...prev,
                tasks: prev.tasks.map(t =>
                    t.id === pendingTask.id ? { ...t, status: 'running' as TaskStatus } : t
                ),
            }));

            try {
                const result = await generateImage(
                    pendingTask.promptText,
                    pendingTask.referenceImages || null,
                    pendingTask.model,
                    pendingTask.size,
                    (progress) => {
                        setState(prev => ({
                            ...prev,
                            tasks: prev.tasks.map(t =>
                                t.id === pendingTask.id ? { ...t, progress } : t
                            ),
                        }));
                    }
                );

                setState(prev => ({
                    ...prev,
                    tasks: prev.tasks.map(t =>
                        t.id === pendingTask.id
                            ? { ...t, status: 'completed' as TaskStatus, result, progress: 100, completedAt: Date.now() }
                            : t
                    ),
                }));

                // 添加到历史记录
                addToHistory({
                    ...pendingTask,
                    status: 'completed' as TaskStatus,
                    result,
                    progress: 100,
                    completedAt: Date.now()
                });

                if (currentState.autoDownload && result) {
                    downloadImage(result, pendingTask.filename);
                }
            } catch (error) {
                console.error('生成图片失败:', error);
                setState(prev => ({
                    ...prev,
                    tasks: prev.tasks.map(t =>
                        t.id === pendingTask.id
                            ? { ...t, status: 'failed' as TaskStatus, error: (error as Error).message }
                            : t
                    ),
                }));
            }
        }

        isProcessingQueueRef.current = false;
        setIsProcessingQueue(false);
        updateState({ isGeneratingImages: false });
    }, [updateState]);

    // 将processQueue保存到ref，以便前面定义的函数可以调用
    processQueueRef.current = processQueue;

    // 队列控制
    const handleStartQueue = useCallback(() => {
        pauseRef.current = false;
        setIsPaused(false);
        processQueue();
    }, [processQueue]);

    const handleTogglePause = useCallback(() => {
        pauseRef.current = !pauseRef.current;
        setIsPaused(pauseRef.current);
    }, []);

    // 下载和清理
    const handleDownloadImage = useCallback((task: ImageGenTask) => {
        if (task.result) {
            downloadImage(task.result, task.filename);
        }
    }, []);

    const handleDownloadAll = useCallback(() => {
        const completedTasks = state.tasks.filter(t => t.status === 'completed' && t.result);
        completedTasks.forEach(task => {
            downloadImage(task.result!, task.filename);
        });
    }, [state.tasks]);

    const handleRemoveTask = useCallback((taskId: string) => {
        setState(prev => ({
            ...prev,
            tasks: prev.tasks.filter(t => t.id !== taskId),
        }));
    }, []);

    const handleClearCompleted = useCallback(() => {
        setState(prev => ({
            ...prev,
            tasks: prev.tasks.filter(t => t.status !== 'completed'),
        }));
    }, []);

    const handleClearAllTasks = useCallback(() => {
        setConfirmModal({
            isOpen: true,
            title: '确认清空',
            message: '确定要清空所有任务吗？',
            onConfirm: () => {
                setState(prev => ({
                    ...prev,
                    tasks: [],
                    isGeneratingImages: false,
                }));
                setIsProcessingQueue(false);
                setConfirmModal(prev => ({ ...prev, isOpen: false }));
            }
        });
    }, []);

    // 重试单个失败任务
    const handleRetryTask = useCallback((taskId: string) => {
        setState(prev => ({
            ...prev,
            tasks: prev.tasks.map(t =>
                t.id === taskId
                    ? { ...t, status: 'pending' as TaskStatus, progress: 0, error: undefined, result: undefined }
                    : t
            ),
        }));
        // 自动开始处理队列
        setTimeout(() => processQueue(), 100);
    }, []);

    // 重试所有失败任务
    const handleRetryAllFailed = useCallback(() => {
        setState(prev => ({
            ...prev,
            tasks: prev.tasks.map(t =>
                t.status === 'failed'
                    ? { ...t, status: 'pending' as TaskStatus, progress: 0, error: undefined, result: undefined }
                    : t
            ),
        }));
        // 自动开始处理队列
        setTimeout(() => processQueue(), 100);
    }, []);

    const handleReset = () => {
        if (!resetConfirmPending) {
            // 第一次点击，显示确认提示
            setResetConfirmPending(true);
            // 3秒后自动取消确认状态
            setTimeout(() => setResetConfirmPending(false), 3000);
            return;
        }
        // 第二次点击，执行重置
        setState(initialState);
        setBatchRows([{ id: `row-${Date.now()}`, images: [], imageUrls: [], prompt: '', downloadFolder: '', status: 'pending' }]);
        setIsProcessingQueue(false);
        pauseRef.current = false;
        setIsPaused(false);
        setResetConfirmPending(false);
    };

    // 队列统计
    const queueStats = {
        total: state.tasks.length,
        pending: state.tasks.filter(t => t.status === 'pending').length,
        running: state.tasks.filter(t => t.status === 'running').length,
        completed: state.tasks.filter(t => t.status === 'completed').length,
        failed: state.tasks.filter(t => t.status === 'failed').length,
    };

    const validBatchCount = batchRows.filter(r => r.prompt.trim() || r.images.length > 0).length;

    // 渲染任务状态
    const renderTaskStatus = (status: TaskStatus, progress: number) => {
        switch (status) {
            case 'pending':
                return <div className="text-slate-400">⏳</div>;
            case 'running':
                return (
                    <div className="flex items-center gap-1 text-blue-500">
                        <Loader2 size={14} className="animate-spin" />
                        <span className="text-xs">{progress}%</span>
                    </div>
                );
            case 'completed':
                return <Check size={16} className="text-green-500" />;
            case 'failed':
                return <AlertCircle size={16} className="text-red-500" />;
        }
    };

    return (
        <div className="api-gen-container" ref={containerRef}>
            {/* Header */}
            <div className="api-gen-header">
                <div className="api-gen-header-title">
                    <Sparkles size={24} />
                    <h1>API 生图</h1>
                    <span className="api-gen-header-badge">批量表格模式</span>
                    <span className="api-gen-header-warning" style={{
                        marginLeft: '12px',
                        fontSize: '12px',
                        color: '#fbbf24',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '4px',
                        background: 'rgba(251, 191, 36, 0.1)',
                        padding: '4px 10px',
                        borderRadius: '6px',
                        border: '1px solid rgba(251, 191, 36, 0.3)'
                    }}>
                        <AlertCircle size={14} />
                        使用此功能必须使用付费 API Key，创新模式下和Opal是同样的自动化流程原理。
                    </span>
                </div>
                <div className="api-gen-header-actions">
                    <button
                        onClick={() => setIsHistoryOpen(true)}
                        className="api-gen-header-btn history-btn"
                        title="查看历史记录"
                    >
                        <History size={18} />
                        {history.length > 0 && <span className="badge">{history.length}</span>}
                    </button>
                    <button
                        onClick={handleReset}
                        className={`api-gen-header-btn ${resetConfirmPending ? 'confirm-pending' : 'danger'}`}
                        title={resetConfirmPending ? "再次点击确认重置" : "重置"}
                    >
                        <Trash2 size={18} />
                        {resetConfirmPending && <span>确认?</span>}
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="api-gen-content">
                {/* 批量输入表格 */}
                <div className="api-gen-card">
                    <button
                        onClick={() => setExpandedSections(s => ({ ...s, batch: !s.batch }))}
                        className="api-gen-card-header"
                    >
                        <div className="api-gen-card-header-left">
                            <Table2 size={18} />
                            <span>批量生成</span>
                            {validBatchCount > 0 && (
                                <span className="count-badge">{validBatchCount} 个任务</span>
                            )}
                        </div>
                        {expandedSections.batch ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>

                    {expandedSections.batch && (
                        <div className="api-gen-card-body">
                            {/* 配置选项 */}
                            <div className="api-gen-settings-row">
                                {/* 模式切换 */}
                                <div className="api-gen-settings-item">
                                    <label>模式</label>
                                    <div style={{ display: 'flex', gap: '0' }}>
                                        <button
                                            onClick={() => setWorkflowMode('classic')}
                                            className={`api-gen-btn sm ${workflowMode === 'classic' ? 'primary' : 'ghost'}`}
                                            style={{ borderRadius: '6px 0 0 6px', borderRight: 'none' }}
                                            title="直接用词生成图片"
                                        >
                                            经典
                                        </button>
                                        <button
                                            onClick={() => setWorkflowMode('creative')}
                                            className={`api-gen-btn sm ${workflowMode === 'creative' ? 'primary' : 'ghost'}`}
                                            style={{ borderRadius: '0 6px 6px 0' }}
                                            title="先分析图片生成描述词，再生成图"
                                        >
                                            创新
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* 拖拽区域 */}
                            <div
                                ref={dropzoneRef}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                className={`api-gen-dropzone ${isDragging ? 'dragging' : ''}`}
                            >
                                <div className="api-gen-dropzone-content">
                                    <Upload size={24} />
                                    <div className="api-gen-dropzone-text">
                                        <p>拖拽图片到此处，或直接粘贴 (Ctrl+V)</p>
                                        <small>支持从 Google Sheets 复制图片+文本</small>
                                    </div>
                                </div>
                                <div className="api-gen-drag-mode">
                                    <span className="api-gen-drag-mode-label">拖拽模式:</span>
                                    <button
                                        onClick={() => setDragMode('split')}
                                        className={`api-gen-drag-mode-btn ${dragMode === 'split' ? 'active' : ''}`}
                                        title="每张图片创建一个任务"
                                    >
                                        <Split size={12} />
                                        一图一行
                                    </button>
                                    <button
                                        onClick={() => setDragMode('merge')}
                                        className={`api-gen-drag-mode-btn ${dragMode === 'merge' ? 'active' : ''}`}
                                        title="所有图片合并到一个任务"
                                    >
                                        <Merge size={12} />
                                        合并到一行
                                    </button>
                                </div>
                            </div>


                            {/* 表格 */}
                            <div className="api-gen-table-container">
                                <table className="api-gen-table">
                                    <thead>
                                        <tr>
                                            <th style={{ width: '50px' }}>#</th>
                                            <th style={{ width: '130px' }}>上传图片</th>
                                            <th>生成文本 (Prompt)</th>
                                            <th style={{ width: '160px' }}>下载文件夹</th>
                                            <th style={{ width: '80px' }}>状态</th>
                                            <th style={{ width: '48px' }}></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {batchRows.map((row, index) => (
                                            <tr
                                                key={row.id}
                                                style={row.status === 'added' ? { backgroundColor: 'rgba(34, 197, 94, 0.1)' } : {}}
                                            >
                                                <td className="px-3 py-2 text-sm text-slate-500">{index + 1}</td>
                                                <td
                                                    className="px-3 py-2"
                                                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.style.backgroundColor = 'rgba(59, 130, 246, 0.15)'; }}
                                                    onDragLeave={(e) => { e.currentTarget.style.backgroundColor = ''; }}
                                                    onDrop={(e) => { e.currentTarget.style.backgroundColor = ''; handleRowDrop(row.id, e); }}
                                                >
                                                    <div className="flex items-center gap-1 flex-wrap">
                                                        {row.images.map((img, imgIdx) => (
                                                            <div key={imgIdx} className="relative group">
                                                                <img
                                                                    src={URL.createObjectURL(img)}
                                                                    alt=""
                                                                    className="w-10 h-10 object-cover rounded border"
                                                                />
                                                                <button
                                                                    onClick={() => handleRemoveRowImage(row.id, imgIdx)}
                                                                    className="absolute -top-1 -right-1 w-4 h-4 bg-red-500 text-white rounded-full text-[10px] flex items-center justify-center opacity-0 group-hover:opacity-100"
                                                                >
                                                                    ×
                                                                </button>
                                                            </div>
                                                        ))}
                                                        <button
                                                            onClick={() => fileInputRefs.current[row.id]?.click()}
                                                            className="w-10 h-10 border-2 border-dashed border-slate-300 rounded flex items-center justify-center text-slate-400 hover:border-blue-400 hover:text-blue-400 text-xs transition-colors"
                                                            title="点击添加或拖拽图片到此"
                                                        >
                                                            <Plus size={14} />
                                                        </button>
                                                        <input
                                                            ref={el => { fileInputRefs.current[row.id] = el; }}
                                                            type="file"
                                                            multiple
                                                            accept="image/*"
                                                            onChange={(e) => handleRowImageUpload(row.id, e.target.files)}
                                                            className="hidden"
                                                        />
                                                    </div>
                                                </td>
                                                <td>
                                                    <textarea
                                                        value={row.prompt}
                                                        onChange={(e) => handleUpdateRow(row.id, { prompt: e.target.value })}
                                                        onDoubleClick={() => openTextEditor(
                                                            `编辑生成文本 #${batchRows.indexOf(row) + 1}`,
                                                            row.prompt,
                                                            (value) => handleUpdateRow(row.id, { prompt: value })
                                                        )}
                                                        placeholder="输入生成文本...（双击放大编辑）"
                                                        className="api-gen-textarea"
                                                        style={{ minHeight: '56px', height: '56px', cursor: 'text' }}
                                                    />
                                                </td>
                                                <td>
                                                    <input
                                                        type="text"
                                                        value={row.downloadFolder}
                                                        onChange={(e) => handleUpdateRow(row.id, { downloadFolder: e.target.value })}
                                                        placeholder="可选"
                                                        className="api-gen-input"
                                                        style={{ width: '100%' }}
                                                    />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <span className={`text-xs px-2 py-0.5 rounded ${row.status === 'added' ? 'bg-green-100 text-green-600' :
                                                        row.status === 'ready' ? 'bg-blue-100 text-blue-600' :
                                                            'bg-slate-100 text-slate-500'
                                                        }`}>
                                                        {row.status === 'added' ? '已添加' : row.status === 'ready' ? '就绪' : '待填'}
                                                    </span>
                                                </td>
                                                <td className="px-3 py-2">
                                                    {batchRows.length > 1 && (
                                                        <button
                                                            onClick={() => handleRemoveRow(row.id)}
                                                            className="text-slate-400 hover:text-red-500"
                                                        >
                                                            <X size={16} />
                                                        </button>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>

                            {/* 操作按钮 */}
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '0.5rem', alignItems: 'center' }}>
                                <button
                                    onClick={handleAddRow}
                                    className="api-gen-btn ghost sm"
                                >
                                    <Plus size={14} />
                                    添加行
                                </button>
                                <button
                                    onClick={handleClearBatch}
                                    className="api-gen-btn ghost sm"
                                >
                                    <Trash2 size={14} />
                                    清空表格
                                </button>
                                <div style={{ flex: 1 }} />
                                <button
                                    onClick={handleAddBatchToQueue}
                                    disabled={validBatchCount === 0}
                                    className="api-gen-btn ghost"
                                >
                                    <ListPlus size={16} />
                                    添加到队列 ({validBatchCount})
                                </button>
                                <button
                                    onClick={() => {
                                        handleAddBatchToQueue();
                                        setTimeout(() => handleStartQueue(), 100);
                                    }}
                                    disabled={validBatchCount === 0}
                                    className="api-gen-btn cta"
                                >
                                    <Zap size={16} />
                                    添加并开始 ({validBatchCount})
                                </button>
                            </div>

                            {/* 根据图批量生成创新画面 - 仅在创新模式下显示 */}
                            {workflowMode === 'creative' && (
                                <div className="api-gen-instruction-panel">
                                    <button
                                        onClick={() => setShowInstructionEditor(!showInstructionEditor)}
                                        className="api-gen-instruction-header"
                                    >
                                        <div className="api-gen-instruction-header-left">
                                            <Sparkles size={14} />
                                            <span>根据图批量生成创新画面</span>
                                        </div>
                                        {showInstructionEditor ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                    </button>
                                    {showInstructionEditor && (
                                        <div className="api-gen-instruction-body">
                                            {/* 固定说明 + 描述词个数 */}
                                            <div style={{
                                                padding: '0.75rem',
                                                background: 'var(--control-bg-color)',
                                                border: '1px solid var(--border-color)',
                                                borderRadius: 'var(--radius-sm)',
                                                marginBottom: '0.75rem'
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '1rem' }}>
                                                    <div style={{ fontSize: '0.8125rem', color: 'var(--text-color)' }}>
                                                        🎨 根据下面的创新要求，生成
                                                    </div>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <input
                                                            type="number"
                                                            min={1}
                                                            max={10}
                                                            value={state.promptCount}
                                                            onChange={(e) => handlePromptCountChange(parseInt(e.target.value) || 4)}
                                                            className="api-gen-input"
                                                            style={{ width: '60px', textAlign: 'center' }}
                                                        />
                                                        <span style={{ fontSize: '0.8125rem', color: 'var(--text-color)' }}>个描述词</span>
                                                    </div>
                                                </div>
                                            </div>

                                            {/* 可编辑部分：创新要求 */}
                                            <div>
                                                <div className="api-gen-instruction-info" style={{ marginBottom: '0.5rem' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
                                                        <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--primary-color)' }}>
                                                            ✏️ 创新要求 (可自定义)
                                                        </label>
                                                        {/* 预设选择器 */}
                                                        <select
                                                            value=""
                                                            onChange={(e) => {
                                                                const idx = parseInt(e.target.value);
                                                                if (!isNaN(idx) && instructionPresets[idx]) {
                                                                    const newInstruction = instructionPresets[idx].content + '\n\n' + generateFormatRequirement(state.promptCount);
                                                                    updateState({ promptInstruction: newInstruction });
                                                                }
                                                            }}
                                                            className="api-gen-select"
                                                            style={{ fontSize: '0.6875rem', padding: '0.25rem 0.5rem', minWidth: '120px' }}
                                                        >
                                                            <option value="">选择预设...</option>
                                                            {instructionPresets.map((preset, idx) => (
                                                                <option key={idx} value={idx}>{preset.name}</option>
                                                            ))}
                                                        </select>
                                                    </div>
                                                    <div style={{ display: 'flex', gap: '0.25rem' }}>
                                                        {/* 保存当前为预设 */}
                                                        <button
                                                            onClick={() => {
                                                                const name = prompt('请输入预设名称：');
                                                                if (name) {
                                                                    const content = state.promptInstruction.split('\n\n请严格按照以下格式输出')[0];
                                                                    addInstructionPreset(name, content);
                                                                }
                                                            }}
                                                            className="api-gen-reset-btn"
                                                            title="保存为预设"
                                                        >
                                                            <Save size={12} />
                                                            保存
                                                        </button>
                                                        <button
                                                            onClick={() => updateState({ promptInstruction: generateDefaultInstruction(state.promptCount) })}
                                                            className="api-gen-reset-btn"
                                                            title="重置为默认"
                                                        >
                                                            <RotateCcw size={12} />
                                                            重置
                                                        </button>
                                                        {/* 大窗口编辑 */}
                                                        <button
                                                            onClick={() => openTextEditor(
                                                                '编辑创新要求',
                                                                state.promptInstruction.split('\n\n请严格按照以下格式输出')[0],
                                                                (value) => {
                                                                    const newInstruction = value + '\n\n' + generateFormatRequirement(state.promptCount);
                                                                    updateState({ promptInstruction: newInstruction });
                                                                }
                                                            )}
                                                            className="api-gen-reset-btn"
                                                            title="大窗口编辑"
                                                        >
                                                            <Maximize2 size={12} />
                                                        </button>
                                                    </div>
                                                </div>
                                                <textarea
                                                    value={state.promptInstruction.split('\n\n请严格按照以下格式输出')[0]}
                                                    onChange={(e) => {
                                                        const newInstruction = e.target.value + '\n\n' + generateFormatRequirement(state.promptCount);
                                                        updateState({ promptInstruction: newInstruction });
                                                    }}
                                                    onDoubleClick={() => openTextEditor(
                                                        '编辑创新要求',
                                                        state.promptInstruction.split('\n\n请严格按照以下格式输出')[0],
                                                        (value) => {
                                                            const newInstruction = value + '\n\n' + generateFormatRequirement(state.promptCount);
                                                            updateState({ promptInstruction: newInstruction });
                                                        }
                                                    )}
                                                    className="api-gen-textarea"
                                                    style={{ height: '80px', fontFamily: 'var(--font-family-mono)', fontSize: '0.75rem', cursor: 'text' }}
                                                    placeholder="输入你想让 AI 如何分析图片并生成描述词...（双击打开大窗口编辑）"
                                                />
                                            </div>

                                            {/* 只读部分：输出格式 */}
                                            <div>
                                                <div style={{ marginBottom: '0.375rem' }}>
                                                    <label style={{ fontSize: '0.6875rem', fontWeight: 600, color: 'var(--text-muted-color)' }}>
                                                        🔒 输出格式 (固定)
                                                    </label>
                                                </div>
                                                <div
                                                    style={{
                                                        padding: '0.75rem',
                                                        background: 'var(--control-bg-color)',
                                                        border: '1px solid var(--border-color)',
                                                        borderRadius: 'var(--radius-sm)',
                                                        fontSize: '0.6875rem',
                                                        fontFamily: 'var(--font-family-mono)',
                                                        color: 'var(--text-muted-color)',
                                                        whiteSpace: 'pre-wrap',
                                                        maxHeight: '120px',
                                                        overflowY: 'auto'
                                                    }}
                                                >
                                                    {generateFormatRequirement(state.promptCount)}
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 保留参考图结构 (垫图) - 仅在创新模式下显示 */}
                            {workflowMode === 'creative' && (
                                <div>
                                    <div
                                        className={`api-gen-ref-toggle ${useRefForGeneration ? 'active' : ''}`}
                                        onClick={() => setUseRefForGeneration(!useRefForGeneration)}
                                    >
                                        <div className="api-gen-ref-toggle-checkbox">
                                            {useRefForGeneration && <Check size={12} />}
                                        </div>
                                        <div className="api-gen-ref-toggle-content">
                                            <h4>
                                                <Zap size={14} />
                                                保留参考图结构 (垫图)
                                            </h4>
                                            <p>
                                                开启后，最终生成将基于输入图进行修改 (图生图)。<br />
                                                关闭后，仅分析输入图内容，生成全新的图像 (文生图)。
                                            </p>
                                        </div>
                                    </div>

                                    {/* 垫图子模式选项 */}
                                    {useRefForGeneration && (
                                        <div className="api-gen-ref-modes">
                                            <button
                                                className={`api-gen-ref-mode-btn ${refMode === 'fixed' ? 'active' : ''}`}
                                                onClick={() => setRefMode('fixed')}
                                            >
                                                <h5>🔒 固定人物模式</h5>
                                                <p>锁定人物面部特征，仅根据描述词修改背景/动作/风格。</p>
                                            </button>
                                            <button
                                                className={`api-gen-ref-mode-btn ${refMode === 'standard' ? 'active' : ''}`}
                                                onClick={() => setRefMode('standard')}
                                            >
                                                <h5>🎨 普通垫图模式</h5>
                                                <p>整体参考图片结构和氛围，自由度更高。</p>
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* 创新模式：变体审核界面 */}
                            {workflowMode === 'creative' && creativeWorkflowStep === 'review' && (
                                <div className="api-gen-review-section">
                                    <div className="api-gen-review-header">
                                        <label className="api-gen-label">2. 变体确认 (Review)</label>
                                        <button
                                            onClick={resetCreativeWorkflow}
                                            className="api-gen-btn ghost sm"
                                        >
                                            <RotateCcw size={14} />
                                            重新开始
                                        </button>
                                    </div>
                                    <div className="api-gen-review-list">
                                        {creativePrompts.map((p, idx) => (
                                            <div key={idx} className="api-gen-review-item">
                                                <div className="api-gen-review-item-header">
                                                    <span className="api-gen-review-badge">变体 {idx + 1}</span>
                                                    <button
                                                        onClick={() => deleteCreativePrompt(idx)}
                                                        className="api-gen-btn ghost sm"
                                                        title="删除"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                </div>
                                                {/* 中文描述（预览） */}
                                                <div className="api-gen-review-zh">
                                                    {p.zh}
                                                </div>
                                                {/* 英文描述（可编辑） */}
                                                <textarea
                                                    value={p.en}
                                                    onChange={(e) => updateCreativePrompt(idx, { en: e.target.value })}
                                                    className="api-gen-textarea sm"
                                                    placeholder="English prompt..."
                                                    rows={3}
                                                />
                                            </div>
                                        ))}
                                        <button
                                            onClick={addCreativePrompt}
                                            className="api-gen-btn ghost full-width"
                                        >
                                            <Plus size={16} />
                                            添加变体 (Add)
                                        </button>
                                    </div>
                                    {/* 确认生成按钮 */}
                                    <button
                                        onClick={handleCreativeGenerate}
                                        className="api-gen-btn primary full-width"
                                        disabled={creativePrompts.length === 0}
                                    >
                                        <Layers size={18} />
                                        全部生成 ({creativePrompts.length})
                                    </button>
                                </div>
                            )}

                            {/* 创新模式：双按钮操作区（仅在输入阶段显示） */}
                            {workflowMode === 'creative' && creativeWorkflowStep === 'input' && (
                                <div className="api-gen-creative-actions">
                                    <button
                                        onClick={() => runCreativeWorkflow(false)}
                                        disabled={isAnalyzing || validBatchCount === 0}
                                        className="api-gen-btn ghost"
                                        style={{ flex: 1 }}
                                    >
                                        {isAnalyzing ? (
                                            <>
                                                <RefreshCw size={16} className="animate-spin" />
                                                分析中...
                                            </>
                                        ) : (
                                            <>
                                                <Sparkles size={16} />
                                                分析与审核
                                            </>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => runCreativeWorkflow(true)}
                                        disabled={isAnalyzing || validBatchCount === 0}
                                        className="api-gen-btn primary"
                                        style={{ flex: 1.5 }}
                                    >
                                        {isAnalyzing ? (
                                            <>
                                                <RefreshCw size={16} className="animate-spin" />
                                                处理中...
                                            </>
                                        ) : (
                                            <>
                                                <Zap size={16} />
                                                一键生成
                                            </>
                                        )}
                                    </button>
                                </div>
                            )}

                            {/* 创新模式：队列状态（已添加阶段显示新流程按钮） */}
                            {workflowMode === 'creative' && creativeWorkflowStep === 'queued' && (
                                <div className="api-gen-creative-queued">
                                    <button
                                        onClick={resetCreativeWorkflow}
                                        className="api-gen-btn ghost"
                                    >
                                        <Plus size={16} />
                                        新流程
                                    </button>
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 生成设置 - 任务队列上方 */}
                <div className="api-gen-settings-row" style={{ padding: '12px 16px', background: 'rgba(255,255,255,0.02)', borderRadius: '12px', marginBottom: '12px' }}>
                    <div className="api-gen-settings-item">
                        <label>模型</label>
                        <select
                            value={state.model}
                            onChange={(e) => updateState({ model: e.target.value as ImageGenModel })}
                            className="api-gen-select"
                        >
                            {MODEL_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="api-gen-settings-item">
                        <label>尺寸</label>
                        <select
                            value={state.size}
                            onChange={(e) => updateState({ size: e.target.value as ImageSize })}
                            className="api-gen-select"
                        >
                            {SIZE_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="api-gen-settings-item">
                        <label>每词图片数</label>
                        <input
                            type="number"
                            min={1}
                            max={10}
                            value={state.imagesPerPrompt}
                            onChange={(e) => updateState({ imagesPerPrompt: Math.max(1, Math.min(10, parseInt(e.target.value) || 1)) })}
                            className="api-gen-input"
                            style={{ width: '60px', textAlign: 'center' }}
                            title="每个描述词生成多少张图片"
                        />
                    </div>
                    <div className="api-gen-settings-item inline">
                        <input
                            type="checkbox"
                            checked={state.autoDownload}
                            onChange={(e) => updateState({ autoDownload: e.target.checked })}
                            className="api-gen-checkbox"
                            id="auto-download"
                        />
                        <label htmlFor="auto-download">自动下载</label>
                    </div>
                </div>

                {/* 任务队列 */}
                <div className="api-gen-card">
                    <button
                        onClick={() => setExpandedSections(s => ({ ...s, queue: !s.queue }))}
                        className="api-gen-card-header"
                    >
                        <div className="api-gen-card-header-left">
                            <Layers size={18} />
                            <span>任务队列</span>
                            {queueStats.total > 0 && (
                                <span className="count-badge">
                                    {queueStats.completed}/{queueStats.total}
                                </span>
                            )}
                        </div>
                        {expandedSections.queue ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>

                    {expandedSections.queue && (
                        <div className="api-gen-card-body">
                            {/* 队列控制 */}
                            {queueStats.total > 0 && (
                                <div className="api-gen-queue-controls">
                                    {queueStats.pending > 0 && (
                                        <>
                                            {!isProcessingQueue ? (
                                                <button
                                                    onClick={handleStartQueue}
                                                    className="api-gen-btn primary"
                                                >
                                                    <Play size={18} />
                                                    开始 ({queueStats.pending})
                                                </button>
                                            ) : (
                                                <button
                                                    onClick={handleTogglePause}
                                                    className={`px-4 py-2 rounded-lg font-medium flex items-center gap-2 ${isPaused
                                                        ? 'bg-green-500 text-white hover:bg-green-600'
                                                        : 'bg-yellow-500 text-white hover:bg-yellow-600'
                                                        }`}
                                                >
                                                    {isPaused ? <Play size={18} /> : <Pause size={18} />}
                                                    {isPaused ? '继续' : '暂停'}
                                                </button>
                                            )}
                                        </>
                                    )}

                                    {queueStats.completed > 0 && (
                                        <>
                                            <button
                                                onClick={handleDownloadAll}
                                                className="px-4 py-2 bg-slate-100 text-slate-700 rounded-lg font-medium flex items-center gap-2 hover:bg-slate-200"
                                            >
                                                <Download size={18} />
                                                下载全部 ({queueStats.completed})
                                            </button>
                                            <button
                                                onClick={handleClearCompleted}
                                                className="px-4 py-2 text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg font-medium flex items-center gap-2"
                                            >
                                                <X size={18} />
                                                清除已完成
                                            </button>
                                        </>
                                    )}

                                    <button
                                        type="button"
                                        onClick={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleClearAllTasks();
                                        }}
                                        className="api-gen-btn ghost sm"
                                        style={{ color: 'var(--error-color)' }}
                                    >
                                        <Trash2 size={18} />
                                        清空
                                    </button>

                                    <div className="api-gen-queue-stats">
                                        <span className="api-gen-queue-stat pending">
                                            待处理 {queueStats.pending}
                                        </span>
                                        {queueStats.running > 0 && (
                                            <span className="api-gen-queue-stat running">
                                                进行中 {queueStats.running}
                                            </span>
                                        )}
                                        <span className="api-gen-queue-stat completed">
                                            完成 {queueStats.completed}
                                        </span>
                                        {queueStats.failed > 0 && (
                                            <span className="api-gen-queue-stat failed">
                                                失败 {queueStats.failed}
                                            </span>
                                        )}
                                        {queueStats.failed > 0 && (
                                            <button
                                                onClick={handleRetryAllFailed}
                                                className="api-gen-btn ghost sm"
                                                style={{ marginLeft: '0.5rem' }}
                                                title="重试所有失败任务"
                                            >
                                                <RefreshCw size={14} />
                                                重试全部
                                            </button>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 任务列表 */}
                            {state.tasks.length > 0 ? (
                                <div className="api-gen-task-grid">
                                    {state.tasks.map((task, index) => (
                                        <div
                                            key={task.id}
                                            className="api-gen-task-card"
                                        >
                                            <div className="api-gen-task-card-image">
                                                {task.result ? (
                                                    <img
                                                        src={task.result}
                                                        alt={`生成图片 ${index + 1}`}
                                                    />
                                                ) : (
                                                    <div className="api-gen-task-card-placeholder">
                                                        {renderTaskStatus(task.status, task.progress)}
                                                        {task.promptTextZh && (
                                                            <p style={{ fontSize: '10px', marginTop: '0.5rem' }}>
                                                                {task.promptTextZh.slice(0, 50)}...
                                                            </p>
                                                        )}
                                                    </div>
                                                )}

                                                <div className="api-gen-task-card-number">
                                                    #{index + 1}
                                                </div>

                                                {task.status !== 'running' && (
                                                    <button
                                                        onClick={() => handleRemoveTask(task.id)}
                                                        className="api-gen-thumb-remove"
                                                        style={{ opacity: 1, top: '6px', right: '6px', width: '20px', height: '20px' }}
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                )}
                                            </div>

                                            {task.result && (
                                                <div className="api-gen-task-card-footer">
                                                    <button
                                                        onClick={() => handleDownloadImage(task)}
                                                        className="api-gen-btn primary sm"
                                                        style={{ width: '100%' }}
                                                    >
                                                        <Download size={12} />
                                                        下载
                                                    </button>
                                                </div>
                                            )}

                                            <div className="api-gen-task-card-filename">
                                                {task.filename}
                                            </div>

                                            {task.status === 'failed' && (
                                                <div className="api-gen-task-card-footer">
                                                    <button
                                                        onClick={() => handleRetryTask(task.id)}
                                                        className="api-gen-btn ghost sm"
                                                        style={{ width: '100%' }}
                                                    >
                                                        <RefreshCw size={12} />
                                                        重试
                                                    </button>
                                                </div>
                                            )}

                                            {task.status === 'failed' && task.error && (
                                                <div style={{ padding: '0.5rem', fontSize: '10px', color: 'var(--error-color)' }}>
                                                    {task.error}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="api-gen-empty">
                                    <Layers size={48} />
                                    <p>队列为空</p>
                                    <p className="hint">在上方表格中添加任务后点击"添加到队列"</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>


            {/* 历史侧边栏 */}
            <HistorySidebar
                history={history}
                onSelect={(img) => {
                    setPreviewImage(img);
                    setIsHistoryOpen(false);
                }}
                onDelete={deleteFromHistory}
                onClear={clearHistory}
                selectedId={previewImage?.id}
                isOpen={isHistoryOpen}
                onClose={() => setIsHistoryOpen(false)}
            />

            {/* 图片预览面板 */}
            {previewImage && (
                <ImagePreviewPanel
                    image={previewImage}
                    onClose={() => setPreviewImage(null)}
                />
            )}

            {/* 大窗口文本编辑模态框 */}
            {textEditorModal.isOpen && (
                <div
                    className="api-gen-modal-overlay"
                    onClick={closeTextEditor}
                >
                    <div
                        className="api-gen-modal"
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: '80%', maxWidth: '800px' }}
                    >
                        <div className="api-gen-modal-header">
                            <h3>{textEditorModal.title}</h3>
                            <button onClick={closeTextEditor} className="api-gen-modal-close">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="api-gen-modal-body">
                            <textarea
                                value={textEditorModal.value}
                                onChange={(e) => setTextEditorModal(prev => ({ ...prev, value: e.target.value }))}
                                className="api-gen-textarea"
                                style={{
                                    height: '400px',
                                    width: '100%',
                                    fontFamily: 'var(--font-family-mono)',
                                    fontSize: '0.875rem',
                                    resize: 'vertical'
                                }}
                                autoFocus
                            />
                        </div>
                        <div className="api-gen-modal-footer">
                            <button onClick={closeTextEditor} className="api-gen-btn ghost">
                                取消
                            </button>
                            <button
                                onClick={() => {
                                    textEditorModal.onSave(textEditorModal.value);
                                    closeTextEditor();
                                }}
                                className="api-gen-btn primary"
                            >
                                <Check size={16} />
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 自定义确认模态框 */}
            {confirmModal.isOpen && (
                <div
                    className="api-gen-modal-overlay"
                    onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                >
                    <div
                        className="api-gen-modal"
                        onClick={(e) => e.stopPropagation()}
                        style={{ width: '360px', maxWidth: '90%' }}
                    >
                        <div className="api-gen-modal-header">
                            <h3>{confirmModal.title}</h3>
                            <button
                                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                                className="api-gen-modal-close"
                            >
                                <X size={20} />
                            </button>
                        </div>
                        <div className="api-gen-modal-body" style={{ padding: '1.5rem', textAlign: 'center' }}>
                            <p style={{ fontSize: '1rem', color: 'var(--text-color)' }}>
                                {confirmModal.message}
                            </p>
                        </div>
                        <div className="api-gen-modal-footer" style={{ justifyContent: 'center', gap: '1rem' }}>
                            <button
                                onClick={() => setConfirmModal(prev => ({ ...prev, isOpen: false }))}
                                className="api-gen-btn ghost"
                            >
                                取消
                            </button>
                            <button
                                onClick={confirmModal.onConfirm}
                                className="api-gen-btn primary"
                                style={{ background: '#ef4444' }}
                            >
                                <Trash2 size={16} />
                                确认清空
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ApiImageGenApp;
