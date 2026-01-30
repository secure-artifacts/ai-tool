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
    RotateCcw
} from 'lucide-react';
import {
    WorkflowState,
    GeneratedPrompt,
    ImageGenTask,
    ImageGenModel,
    ImageSize,
    DEFAULT_PROMPT_INSTRUCTION,
    SIZE_OPTIONS,
    MODEL_OPTIONS,
    TaskStatus,
    generateFilePrefix,
    generateDefaultInstruction
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
    model: 'gemini-3-pro',
    size: '1024x1024',
    useReferenceImage: false,
    tasks: [],
    isGeneratingImages: false,
    autoDownload: true,
};

const ApiImageGenApp: React.FC = () => {
    const [state, setState] = useState<WorkflowState>(initialState);
    const [showInstructionEditor, setShowInstructionEditor] = useState(false);
    const [expandedSections, setExpandedSections] = useState({
        batch: true,
        queue: true,
    });
    const [isProcessingQueue, setIsProcessingQueue] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const pauseRef = useRef(false);

    // 批量输入表格数据
    const [batchRows, setBatchRows] = useState<BatchInputRow[]>([
        { id: `row-${Date.now()}`, images: [], imageUrls: [], prompt: '', downloadFolder: '', status: 'pending' }
    ]);

    // 拖拽模式：merge=多图合并到一行, split=一图一行
    const [dragMode, setDragMode] = useState<DragMode>('split');
    const [isDragging, setIsDragging] = useState(false);

    const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
    const dropzoneRef = useRef<HTMLDivElement>(null);

    // 更新状态
    const updateState = useCallback((updates: Partial<WorkflowState>) => {
        setState(prev => ({ ...prev, ...updates }));
    }, []);

    // 处理全局粘贴事件 (支持 Google Sheets 图片+文本)
    useEffect(() => {
        const handlePaste = async (e: ClipboardEvent) => {
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

        const newTasks: ImageGenTask[] = validRows.map((row, index) => ({
            id: `task-${Date.now()}-${index}-${Math.random().toString(36).substr(2, 9)}`,
            promptId: row.id,
            promptText: row.prompt,
            promptTextZh: row.prompt, // 用户直接输入的 prompt
            filename: row.downloadFolder
                ? `${row.downloadFolder}/${batchPrefix}-${index + 1}.png`
                : `${batchPrefix}-${index + 1}.png`,
            model: state.model,
            size: state.size,
            useReferenceImage: row.images.length > 0,
            referenceImages: row.images.length > 0 ? [...row.images] : undefined,
            status: 'pending' as TaskStatus,
            progress: 0,
            createdAt: Date.now(),
        }));

        setState(prev => ({
            ...prev,
            tasks: [...prev.tasks, ...newTasks],
        }));

        // 标记行为已添加
        setBatchRows(prev => prev.map(r =>
            validRows.find(vr => vr.id === r.id) ? { ...r, status: 'added' as const } : r
        ));
    }, [batchRows, state.model, state.size]);

    // 添加并开始
    const handleAddBatchAndStart = useCallback(() => {
        handleAddBatchToQueue();
        setTimeout(() => {
            processQueue();
        }, 100);
    }, [handleAddBatchToQueue]);

    // 清空批量输入
    const handleClearBatch = useCallback(() => {
        setBatchRows([
            { id: `row-${Date.now()}`, images: [], imageUrls: [], prompt: '', downloadFolder: '', status: 'pending' }
        ]);
    }, []);

    // 处理队列中的任务
    const processQueue = useCallback(async () => {
        if (isProcessingQueue) return;

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

        setIsProcessingQueue(false);
        updateState({ isGeneratingImages: false });
    }, [isProcessingQueue, updateState]);

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
        if (confirm('确定要清空所有任务吗？')) {
            setState(prev => ({
                ...prev,
                tasks: [],
                isGeneratingImages: false,
            }));
            setIsProcessingQueue(false);
        }
    }, []);

    const handleReset = () => {
        if (confirm('确定要清空所有内容吗？')) {
            setState(initialState);
            setBatchRows([{ id: `row-${Date.now()}`, images: [], imageUrls: [], prompt: '', downloadFolder: '', status: 'pending' }]);
            setIsProcessingQueue(false);
            pauseRef.current = false;
            setIsPaused(false);
        }
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
        <div className="h-full flex flex-col bg-gradient-to-br from-slate-50 to-indigo-50/30">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-white/80 backdrop-blur-sm">
                <div className="flex items-center gap-2">
                    <Sparkles size={24} className="text-indigo-500" />
                    <h1 className="text-lg font-bold text-slate-800">API 生图</h1>
                    <span className="text-xs text-slate-400 bg-slate-100 px-2 py-0.5 rounded-full">
                        批量表格模式
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleReset}
                        className="text-slate-500 hover:text-red-500 p-2 rounded-lg hover:bg-red-50 transition-colors"
                        data-tip="重置"
                    >
                        <Trash2 size={18} />
                    </button>
                </div>
            </div>

            {/* Main Content */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
                {/* 批量输入表格 */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                        onClick={() => setExpandedSections(s => ({ ...s, batch: !s.batch }))}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white"
                    >
                        <div className="flex items-center gap-2">
                            <Table2 size={18} />
                            <span className="font-medium">批量生成</span>
                            {validBatchCount > 0 && (
                                <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
                                    {validBatchCount} 个任务
                                </span>
                            )}
                        </div>
                        {expandedSections.batch ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>

                    {expandedSections.batch && (
                        <div className="p-4 space-y-4">
                            {/* 配置选项 */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">模型</label>
                                    <select
                                        value={state.model}
                                        onChange={(e) => updateState({ model: e.target.value as ImageGenModel })}
                                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                    >
                                        {MODEL_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">尺寸</label>
                                    <select
                                        value={state.size}
                                        onChange={(e) => updateState({ size: e.target.value as ImageSize })}
                                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                    >
                                        {SIZE_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">描述词个数</label>
                                    <input
                                        type="number"
                                        min={1}
                                        max={10}
                                        value={state.promptCount}
                                        onChange={(e) => handlePromptCountChange(parseInt(e.target.value) || 4)}
                                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-blue-500"
                                    />
                                </div>
                                <div className="flex items-end">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={state.autoDownload}
                                            onChange={(e) => updateState({ autoDownload: e.target.checked })}
                                            className="w-4 h-4 text-blue-500 rounded focus:ring-blue-500"
                                        />
                                        <span className="text-sm text-slate-700">自动下载</span>
                                    </label>
                                </div>
                            </div>

                            {/* 拖拽区域 */}
                            <div
                                ref={dropzoneRef}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={handleDrop}
                                className={`border-2 border-dashed rounded-lg p-4 text-center transition-colors ${isDragging
                                    ? 'border-blue-500 bg-blue-50'
                                    : 'border-slate-300 hover:border-slate-400'
                                    }`}
                            >
                                <div className="flex items-center justify-center gap-4">
                                    <Upload size={24} className={isDragging ? 'text-blue-500' : 'text-slate-400'} />
                                    <div className="text-left">
                                        <p className={`text-sm font-medium ${isDragging ? 'text-blue-600' : 'text-slate-600'}`}>
                                            拖拽图片到此处，或直接粘贴 (Ctrl+V)
                                        </p>
                                        <p className="text-xs text-slate-400">
                                            支持从 Google Sheets 复制图片+文本
                                        </p>
                                    </div>
                                    <div className="flex items-center gap-1 ml-4 border-l border-slate-200 pl-4">
                                        <span className="text-xs text-slate-500 mr-2">拖拽模式:</span>
                                        <button
                                            onClick={() => setDragMode('split')}
                                            className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${dragMode === 'split'
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                            title="每张图片创建一个任务"
                                        >
                                            <Split size={12} />
                                            一图一行
                                        </button>
                                        <button
                                            onClick={() => setDragMode('merge')}
                                            className={`px-2 py-1 rounded text-xs flex items-center gap-1 ${dragMode === 'merge'
                                                ? 'bg-blue-500 text-white'
                                                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                }`}
                                            title="所有图片合并到一个任务"
                                        >
                                            <Merge size={12} />
                                            合并到一行
                                        </button>
                                    </div>
                                </div>
                            </div>

                            {/* 固定指令设置（第二步的 AI 指令） */}
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                                <button
                                    onClick={() => setShowInstructionEditor(!showInstructionEditor)}
                                    className="w-full flex items-center justify-between px-3 py-2 bg-slate-50 hover:bg-slate-100 transition-colors"
                                >
                                    <div className="flex items-center gap-2 text-sm text-slate-600">
                                        <Settings size={14} />
                                        <span>固定指令 (第二步)</span>
                                        <span className="text-xs text-slate-400">图片+用户指令 → 此指令 → 生成描述词</span>
                                    </div>
                                    {showInstructionEditor ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                </button>
                                {showInstructionEditor && (
                                    <div className="p-3 space-y-2 bg-white">
                                        <div className="flex items-center justify-between">
                                            <p className="text-xs text-slate-500">
                                                这个指令会和用户输入的图片/文本一起发送给 AI，用于生成描述词
                                            </p>
                                            <button
                                                onClick={() => updateState({ promptInstruction: generateDefaultInstruction(state.promptCount) })}
                                                className="text-xs text-blue-500 hover:text-blue-600 flex items-center gap-1"
                                            >
                                                <RotateCcw size={12} />
                                                重置为默认
                                            </button>
                                        </div>
                                        <textarea
                                            value={state.promptInstruction}
                                            onChange={(e) => updateState({ promptInstruction: e.target.value })}
                                            className="w-full h-40 px-3 py-2 border border-slate-300 rounded-lg text-sm font-mono resize-y focus:ring-2 focus:ring-blue-500"
                                            placeholder="输入用于生成描述词的固定指令..."
                                        />
                                    </div>
                                )}
                            </div>

                            {/* 表格 */}
                            <div className="border border-slate-200 rounded-lg overflow-hidden">
                                <table className="w-full">
                                    <thead className="bg-slate-50">
                                        <tr>
                                            <th className="w-12 px-3 py-2 text-left text-xs font-medium text-slate-500">#</th>
                                            <th className="w-32 px-3 py-2 text-left text-xs font-medium text-slate-500">上传图片</th>
                                            <th className="px-3 py-2 text-left text-xs font-medium text-slate-500">生成文本 (Prompt)</th>
                                            <th className="w-40 px-3 py-2 text-left text-xs font-medium text-slate-500">下载文件夹</th>
                                            <th className="w-20 px-3 py-2 text-left text-xs font-medium text-slate-500">状态</th>
                                            <th className="w-12 px-3 py-2"></th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {batchRows.map((row, index) => (
                                            <tr key={row.id} className={row.status === 'added' ? 'bg-green-50' : ''}>
                                                <td className="px-3 py-2 text-sm text-slate-500">{index + 1}</td>
                                                <td
                                                    className="px-3 py-2"
                                                    onDragOver={(e) => { e.preventDefault(); e.currentTarget.classList.add('bg-blue-50'); }}
                                                    onDragLeave={(e) => { e.currentTarget.classList.remove('bg-blue-50'); }}
                                                    onDrop={(e) => { e.currentTarget.classList.remove('bg-blue-50'); handleRowDrop(row.id, e); }}
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
                                                <td className="px-3 py-2">
                                                    <textarea
                                                        value={row.prompt}
                                                        onChange={(e) => handleUpdateRow(row.id, { prompt: e.target.value })}
                                                        placeholder="输入生成文本..."
                                                        className="w-full px-2 py-1 border border-slate-200 rounded text-sm resize-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500"
                                                        rows={2}
                                                    />
                                                </td>
                                                <td className="px-3 py-2">
                                                    <input
                                                        type="text"
                                                        value={row.downloadFolder}
                                                        onChange={(e) => handleUpdateRow(row.id, { downloadFolder: e.target.value })}
                                                        placeholder="可选"
                                                        className="w-full px-2 py-1 border border-slate-200 rounded text-sm focus:ring-1 focus:ring-blue-500"
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
                            <div className="flex flex-wrap gap-2">
                                <button
                                    onClick={handleAddRow}
                                    className="px-3 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm flex items-center gap-1 hover:bg-slate-200"
                                >
                                    <Plus size={14} />
                                    添加行
                                </button>
                                <button
                                    onClick={handleClearBatch}
                                    className="px-3 py-1.5 text-slate-500 hover:text-slate-700 rounded-lg text-sm flex items-center gap-1"
                                >
                                    <Trash2 size={14} />
                                    清空表格
                                </button>
                                <div className="flex-1" />
                                <button
                                    onClick={handleAddBatchToQueue}
                                    disabled={validBatchCount === 0}
                                    className="px-4 py-1.5 bg-slate-100 text-slate-700 rounded-lg text-sm font-medium flex items-center gap-1 hover:bg-slate-200 disabled:opacity-50"
                                >
                                    <ListPlus size={16} />
                                    添加到队列 ({validBatchCount})
                                </button>
                                <button
                                    onClick={handleAddBatchAndStart}
                                    disabled={validBatchCount === 0}
                                    className="px-4 py-1.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg text-sm font-medium flex items-center gap-1 hover:from-green-600 hover:to-emerald-700 disabled:opacity-50"
                                >
                                    <Play size={16} />
                                    添加并开始 ({validBatchCount})
                                </button>
                            </div>
                        </div>
                    )}
                </div>

                {/* 任务队列 */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                        onClick={() => setExpandedSections(s => ({ ...s, queue: !s.queue }))}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white"
                    >
                        <div className="flex items-center gap-2">
                            <Layers size={18} />
                            <span className="font-medium">任务队列</span>
                            {queueStats.total > 0 && (
                                <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
                                    {queueStats.completed}/{queueStats.total}
                                </span>
                            )}
                        </div>
                        {expandedSections.queue ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>

                    {expandedSections.queue && (
                        <div className="p-4 space-y-4">
                            {/* 队列控制 */}
                            {queueStats.total > 0 && (
                                <div className="flex flex-wrap items-center gap-2">
                                    {queueStats.pending > 0 && (
                                        <>
                                            {!isProcessingQueue ? (
                                                <button
                                                    onClick={handleStartQueue}
                                                    className="px-4 py-2 bg-blue-500 text-white rounded-lg font-medium flex items-center gap-2 hover:bg-blue-600"
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
                                        onClick={handleClearAllTasks}
                                        className="px-4 py-2 text-red-500 hover:text-red-700 hover:bg-red-50 rounded-lg font-medium flex items-center gap-2"
                                    >
                                        <Trash2 size={18} />
                                        清空
                                    </button>

                                    <div className="flex-1" />

                                    {/* 队列统计 */}
                                    <div className="flex items-center gap-2 text-xs">
                                        <span className="px-2 py-0.5 bg-slate-100 rounded text-slate-600">
                                            待处理 {queueStats.pending}
                                        </span>
                                        {queueStats.running > 0 && (
                                            <span className="px-2 py-0.5 bg-blue-100 rounded text-blue-600">
                                                进行中 {queueStats.running}
                                            </span>
                                        )}
                                        <span className="px-2 py-0.5 bg-green-100 rounded text-green-600">
                                            完成 {queueStats.completed}
                                        </span>
                                        {queueStats.failed > 0 && (
                                            <span className="px-2 py-0.5 bg-red-100 rounded text-red-600">
                                                失败 {queueStats.failed}
                                            </span>
                                        )}
                                    </div>
                                </div>
                            )}

                            {/* 任务列表 */}
                            {state.tasks.length > 0 ? (
                                <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-3">
                                    {state.tasks.map((task, index) => (
                                        <div
                                            key={task.id}
                                            className="relative rounded-xl border border-slate-200 overflow-hidden bg-slate-50"
                                        >
                                            <div className="aspect-square relative">
                                                {task.result ? (
                                                    <img
                                                        src={task.result}
                                                        alt={`生成图片 ${index + 1}`}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex flex-col items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 p-2">
                                                        {renderTaskStatus(task.status, task.progress)}
                                                        {task.promptTextZh && (
                                                            <p className="mt-2 text-[10px] text-slate-400 text-center line-clamp-3">
                                                                {task.promptTextZh}
                                                            </p>
                                                        )}
                                                    </div>
                                                )}

                                                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/50 text-white text-xs">
                                                    #{index + 1}
                                                </div>

                                                {task.status !== 'running' && (
                                                    <button
                                                        onClick={() => handleRemoveTask(task.id)}
                                                        className="absolute top-2 right-2 w-6 h-6 bg-black/50 text-white rounded-full flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                )}
                                            </div>

                                            {task.result && (
                                                <div className="p-2 flex justify-center">
                                                    <button
                                                        onClick={() => handleDownloadImage(task)}
                                                        className="px-3 py-1 bg-green-500 text-white text-xs rounded-lg hover:bg-green-600"
                                                    >
                                                        <Download size={12} className="inline mr-1" />
                                                        下载
                                                    </button>
                                                </div>
                                            )}

                                            <div className="px-2 pb-2 text-[10px] text-slate-400 truncate text-center">
                                                {task.filename}
                                            </div>

                                            {task.status === 'failed' && task.error && (
                                                <div className="p-2 text-xs text-red-600 bg-red-50">
                                                    {task.error}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            ) : (
                                <div className="text-center py-8 text-slate-400">
                                    <Layers size={48} className="mx-auto mb-2 opacity-50" />
                                    <p>队列为空</p>
                                    <p className="text-xs mt-1">在上方表格中添加任务后点击"添加到队列"</p>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            </div>


        </div>
    );
};

export default ApiImageGenApp;
