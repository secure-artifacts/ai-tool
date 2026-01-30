// API 生图 - 主组件

import React, { useState, useCallback, useRef } from 'react';
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
    Zap
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
    generateFilePrefix
} from './types';
import {
    generatePrompts,
    generateImage,
    downloadImage,
    downloadAllImages
} from './services/imageGenService';

// 初始状态
const initialState: WorkflowState = {
    inputImages: [],
    inputText: '',
    promptInstruction: DEFAULT_PROMPT_INSTRUCTION,
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
        input: true,
        prompts: true,
        generate: true,
    });
    const [isOneClickMode, setIsOneClickMode] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // 更新状态
    const updateState = useCallback((updates: Partial<WorkflowState>) => {
        setState(prev => ({ ...prev, ...updates }));
    }, []);

    // 处理图片上传
    const handleImageUpload = useCallback((files: FileList | null) => {
        if (!files) return;
        const newImages = Array.from(files).filter(f => f.type.startsWith('image/'));
        updateState({ inputImages: [...state.inputImages, ...newImages] });
    }, [state.inputImages, updateState]);

    // 删除图片
    const removeImage = useCallback((index: number) => {
        const newImages = [...state.inputImages];
        newImages.splice(index, 1);
        updateState({ inputImages: newImages });
    }, [state.inputImages, updateState]);

    // 拖拽上传
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        handleImageUpload(e.dataTransfer.files);
    }, [handleImageUpload]);

    // 第二步：生成描述词
    const handleGeneratePrompts = async () => {
        if (state.inputImages.length === 0 && !state.inputText.trim()) {
            alert('请先上传图片或输入文字描述');
            return;
        }

        updateState({ isGeneratingPrompts: true, generatedPrompts: [] });

        try {
            const prompts = await generatePrompts(
                state.inputImages,
                state.inputText,
                state.promptInstruction
            );
            updateState({ generatedPrompts: prompts, isGeneratingPrompts: false });
            return prompts; // 返回生成的 prompts 供一键生成使用
        } catch (error) {
            console.error('生成描述词失败:', error);
            alert('生成描述词失败: ' + (error as Error).message);
            updateState({ isGeneratingPrompts: false });
            return null;
        }
    };

    // 切换 Prompt 选中状态
    const togglePromptSelection = useCallback((promptId: string) => {
        const newPrompts = state.generatedPrompts.map(p =>
            p.id === promptId ? { ...p, selected: !p.selected } : p
        );
        updateState({ generatedPrompts: newPrompts });
    }, [state.generatedPrompts, updateState]);

    // 编辑 Prompt (英文版本)
    const updatePromptTextEn = useCallback((promptId: string, newText: string) => {
        const newPrompts = state.generatedPrompts.map(p =>
            p.id === promptId ? { ...p, textEn: newText } : p
        );
        updateState({ generatedPrompts: newPrompts });
    }, [state.generatedPrompts, updateState]);

    // 第三步：开始批量生图
    const handleStartGeneration = async (promptsToUse?: GeneratedPrompt[]) => {
        const selectedPrompts = (promptsToUse || state.generatedPrompts).filter(p => p.selected);
        if (selectedPrompts.length === 0) {
            alert('请至少选择一个描述词');
            return;
        }

        // 生成唯一前缀，同一批次的图片共用
        const batchPrefix = generateFilePrefix();

        // 创建任务，每个任务有唯一的文件名
        const tasks: ImageGenTask[] = selectedPrompts.map((prompt, index) => ({
            id: `task-${Date.now()}-${prompt.id}`,
            promptId: prompt.id,
            promptText: prompt.textEn, // 使用英文版本生成
            filename: `${batchPrefix}-${index + 1}.png`, // 唯一文件名
            model: state.model,
            size: state.size,
            useReferenceImage: state.useReferenceImage,
            status: 'pending' as TaskStatus,
            progress: 0,
            createdAt: Date.now(),
        }));

        updateState({ tasks, isGeneratingImages: true });

        // 依次执行任务
        for (let i = 0; i < tasks.length; i++) {
            const task = tasks[i];

            // 更新任务状态为运行中
            setState(prev => ({
                ...prev,
                tasks: prev.tasks.map(t =>
                    t.id === task.id ? { ...t, status: 'running' as TaskStatus } : t
                ),
            }));

            try {
                const result = await generateImage(
                    task.promptText,
                    state.useReferenceImage ? state.inputImages : null,
                    task.model,
                    task.size,
                    (progress) => {
                        setState(prev => ({
                            ...prev,
                            tasks: prev.tasks.map(t =>
                                t.id === task.id ? { ...t, progress } : t
                            ),
                        }));
                    }
                );

                // 更新任务状态为完成
                setState(prev => ({
                    ...prev,
                    tasks: prev.tasks.map(t =>
                        t.id === task.id
                            ? { ...t, status: 'completed' as TaskStatus, result, progress: 100, completedAt: Date.now() }
                            : t
                    ),
                }));

                // 自动下载 - 使用任务的唯一文件名
                if (state.autoDownload && result) {
                    downloadImage(result, task.filename);
                }
            } catch (error) {
                console.error('生成图片失败:', error);
                setState(prev => ({
                    ...prev,
                    tasks: prev.tasks.map(t =>
                        t.id === task.id
                            ? { ...t, status: 'failed' as TaskStatus, error: (error as Error).message }
                            : t
                    ),
                }));
            }
        }

        updateState({ isGeneratingImages: false });
    };

    // 一键生成：自动执行步骤2和步骤3
    const handleOneClickGeneration = async () => {
        if (state.inputImages.length === 0 && !state.inputText.trim()) {
            alert('请先上传图片或输入文字描述');
            return;
        }

        setIsOneClickMode(true);

        // 执行步骤2：生成描述词
        const prompts = await handleGeneratePrompts();

        if (prompts && prompts.length > 0) {
            // 等待状态更新完成
            await new Promise(resolve => setTimeout(resolve, 100));

            // 执行步骤3：批量生图
            await handleStartGeneration(prompts);
        }

        setIsOneClickMode(false);
    };

    // 下载所有完成的图片 - 使用任务的唯一文件名
    const handleDownloadAll = () => {
        const completedTasks = state.tasks.filter(t => t.status === 'completed' && t.result);
        completedTasks.forEach(task => {
            downloadImage(task.result!, task.filename);
        });
    };

    // 清空重置
    const handleReset = () => {
        if (confirm('确定要清空所有内容吗？')) {
            setState(initialState);
        }
    };

    // 渲染任务状态图标
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
                        Opal 风格工作流
                    </span>
                </div>
                <div className="flex items-center gap-2">
                    {/* 一键生成按钮 */}
                    <button
                        onClick={handleOneClickGeneration}
                        disabled={isOneClickMode || state.isGeneratingPrompts || state.isGeneratingImages || (state.inputImages.length === 0 && !state.inputText.trim())}
                        className="px-3 py-1.5 bg-gradient-to-r from-amber-500 to-orange-500 text-white rounded-lg text-sm font-medium flex items-center gap-1.5 hover:from-amber-600 hover:to-orange-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-sm"
                        data-tip="一键生成"
                    >
                        {isOneClickMode ? (
                            <>
                                <Loader2 size={14} className="animate-spin" />
                                生成中...
                            </>
                        ) : (
                            <>
                                <Zap size={14} />
                                一键生成
                            </>
                        )}
                    </button>
                    <button
                        onClick={handleReset}
                        className="text-slate-500 hover:text-red-500 p-2 rounded-lg hover:bg-red-50 transition-colors"
                        data-tip="重置"
                    >
                        <Trash2 size={18} />
                    </button>
                </div>
            </div>

            {/* Main Content - 三步工作流 */}
            <div className="flex-1 overflow-auto p-4 space-y-4">
                {/* 第一步：输入 */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                        onClick={() => setExpandedSections(s => ({ ...s, input: !s.input }))}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-blue-500 to-blue-600 text-white"
                    >
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">1</div>
                            <Upload size={18} />
                            <span className="font-medium">输入图片和/或文字</span>
                        </div>
                        {expandedSections.input ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>

                    {expandedSections.input && (
                        <div className="p-4 space-y-4">
                            {/* 图片上传区 */}
                            <div
                                onDrop={handleDrop}
                                onDragOver={(e) => e.preventDefault()}
                                onClick={() => fileInputRef.current?.click()}
                                className="border-2 border-dashed border-slate-300 rounded-xl p-6 text-center cursor-pointer hover:border-blue-400 hover:bg-blue-50/50 transition-all"
                            >
                                <input
                                    ref={fileInputRef}
                                    type="file"
                                    multiple
                                    accept="image/*"
                                    onChange={(e) => handleImageUpload(e.target.files)}
                                    className="hidden"
                                />
                                <ImageIcon size={32} className="mx-auto text-slate-400 mb-2" />
                                <p className="text-slate-600">拖拽图片到这里，或点击选择</p>
                                <p className="text-xs text-slate-400 mt-1">支持多张图片</p>
                            </div>

                            {/* 已上传的图片 */}
                            {state.inputImages.length > 0 && (
                                <div className="flex flex-wrap gap-2">
                                    {state.inputImages.map((file, index) => (
                                        <div key={index} className="relative group">
                                            <img
                                                src={URL.createObjectURL(file)}
                                                alt={`上传图片 ${index + 1}`}
                                                className="w-20 h-20 object-cover rounded-lg border border-slate-200"
                                            />
                                            <button
                                                onClick={(e) => { e.stopPropagation(); removeImage(index); }}
                                                className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => fileInputRef.current?.click()}
                                        className="w-20 h-20 border-2 border-dashed border-slate-300 rounded-lg flex items-center justify-center text-slate-400 hover:border-blue-400 hover:text-blue-400 transition-colors"
                                    >
                                        <Plus size={24} />
                                    </button>
                                </div>
                            )}

                            {/* 文字描述 */}
                            <div>
                                <label className="block text-sm font-medium text-slate-700 mb-1">
                                    文字描述（可选）
                                </label>
                                <textarea
                                    value={state.inputText}
                                    onChange={(e) => updateState({ inputText: e.target.value })}
                                    placeholder="描述你想要生成的图片内容..."
                                    className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-blue-500 focus:border-blue-500 resize-none"
                                    rows={3}
                                />
                            </div>
                        </div>
                    )}
                </div>

                {/* 第二步：生成描述词 */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                        onClick={() => setExpandedSections(s => ({ ...s, prompts: !s.prompts }))}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-purple-500 to-purple-600 text-white"
                    >
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">2</div>
                            <Wand2 size={18} />
                            <span className="font-medium">AI 生成描述词</span>
                            {state.generatedPrompts.length > 0 && (
                                <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
                                    {state.generatedPrompts.filter(p => p.selected).length} 个已选
                                </span>
                            )}
                        </div>
                        {expandedSections.prompts ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>

                    {expandedSections.prompts && (
                        <div className="p-4 space-y-4">
                            {/* 自定义指令 */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-sm font-medium text-slate-700">
                                        自定义指令
                                    </label>
                                    <button
                                        onClick={() => setShowInstructionEditor(!showInstructionEditor)}
                                        className="text-xs text-purple-600 hover:text-purple-700 flex items-center gap-1"
                                    >
                                        <Edit3 size={12} />
                                        {showInstructionEditor ? '收起' : '编辑指令'}
                                    </button>
                                </div>
                                {showInstructionEditor && (
                                    <textarea
                                        value={state.promptInstruction}
                                        onChange={(e) => updateState({ promptInstruction: e.target.value })}
                                        className="w-full px-3 py-2 border border-slate-300 rounded-lg focus:ring-2 focus:ring-purple-500 focus:border-purple-500 text-sm font-mono"
                                        rows={8}
                                        placeholder="输入 AI 生成描述词的指令..."
                                    />
                                )}
                                {!showInstructionEditor && (
                                    <p className="text-xs text-slate-500 bg-slate-50 p-2 rounded-lg line-clamp-2">
                                        {state.promptInstruction.slice(0, 100)}...
                                    </p>
                                )}
                            </div>

                            {/* 生成按钮 */}
                            <button
                                onClick={handleGeneratePrompts}
                                disabled={state.isGeneratingPrompts || (state.inputImages.length === 0 && !state.inputText.trim())}
                                className="w-full py-2.5 bg-gradient-to-r from-purple-500 to-purple-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:from-purple-600 hover:to-purple-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                            >
                                {state.isGeneratingPrompts ? (
                                    <>
                                        <Loader2 size={18} className="animate-spin" />
                                        生成中...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles size={18} />
                                        生成描述词
                                    </>
                                )}
                            </button>

                            {/* 生成的描述词列表 - 双语显示 */}
                            {state.generatedPrompts.length > 0 && (
                                <div className="space-y-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-sm font-medium text-slate-700">
                                            生成的描述词 ({state.generatedPrompts.filter(p => p.selected).length}/{state.generatedPrompts.length} 已选)
                                        </span>
                                        <button
                                            onClick={handleGeneratePrompts}
                                            className="text-xs text-purple-600 hover:text-purple-700 flex items-center gap-1"
                                        >
                                            <RefreshCw size={12} />
                                            重新生成
                                        </button>
                                    </div>
                                    {state.generatedPrompts.map((prompt, index) => (
                                        <div
                                            key={prompt.id}
                                            className={`p-3 rounded-lg border transition-all ${prompt.selected
                                                ? 'border-purple-300 bg-purple-50'
                                                : 'border-slate-200 bg-slate-50 opacity-60'
                                                }`}
                                        >
                                            <div className="flex items-start gap-2">
                                                <button
                                                    onClick={() => togglePromptSelection(prompt.id)}
                                                    className="mt-0.5 text-purple-500"
                                                >
                                                    {prompt.selected ? <CheckSquare size={18} /> : <Square size={18} />}
                                                </button>
                                                <div className="flex-1 space-y-2">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs font-bold text-purple-600">
                                                            Prompt {index + 1}
                                                        </span>
                                                    </div>

                                                    {/* 中文版本 - 仅展示 */}
                                                    {prompt.textZh && (
                                                        <div className="bg-white/50 rounded-lg p-2">
                                                            <div className="flex items-center gap-1 mb-1">
                                                                <span className="text-[10px] font-medium text-slate-400 bg-slate-200 px-1.5 py-0.5 rounded">🇨🇳 中文</span>
                                                            </div>
                                                            <p className="text-sm text-slate-600">{prompt.textZh}</p>
                                                        </div>
                                                    )}

                                                    {/* 英文版本 - 可编辑 (用于生成) */}
                                                    <div className="bg-white/50 rounded-lg p-2">
                                                        <div className="flex items-center gap-1 mb-1">
                                                            <span className="text-[10px] font-medium text-blue-400 bg-blue-100 px-1.5 py-0.5 rounded">🇺🇸 EN</span>
                                                            <span className="text-[10px] text-slate-400">(用于生成)</span>
                                                        </div>
                                                        <textarea
                                                            value={prompt.textEn}
                                                            onChange={(e) => updatePromptTextEn(prompt.id, e.target.value)}
                                                            className="w-full text-sm text-slate-700 bg-transparent border-none resize-none focus:outline-none focus:ring-0"
                                                            rows={2}
                                                        />
                                                    </div>
                                                </div>
                                                <button
                                                    onClick={() => navigator.clipboard.writeText(prompt.textEn)}
                                                    className="text-slate-400 hover:text-slate-600"
                                                    data-tip="复制英文"
                                                >
                                                    <Copy size={14} />
                                                </button>
                                            </div>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 第三步：批量生图 */}
                <div className="bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
                    <button
                        onClick={() => setExpandedSections(s => ({ ...s, generate: !s.generate }))}
                        className="w-full flex items-center justify-between px-4 py-3 bg-gradient-to-r from-green-500 to-emerald-600 text-white"
                    >
                        <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-white/20 flex items-center justify-center text-sm font-bold">3</div>
                            <Layers size={18} />
                            <span className="font-medium">批量生图</span>
                            {state.tasks.length > 0 && (
                                <span className="bg-white/20 px-2 py-0.5 rounded-full text-xs">
                                    {state.tasks.filter(t => t.status === 'completed').length}/{state.tasks.length} 完成
                                </span>
                            )}
                        </div>
                        {expandedSections.generate ? <ChevronUp size={18} /> : <ChevronDown size={18} />}
                    </button>

                    {expandedSections.generate && (
                        <div className="p-4 space-y-4">
                            {/* 配置选项 */}
                            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                {/* 模型选择 */}
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">模型</label>
                                    <select
                                        value={state.model}
                                        onChange={(e) => updateState({ model: e.target.value as ImageGenModel })}
                                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
                                    >
                                        {MODEL_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* 尺寸选择 */}
                                <div>
                                    <label className="block text-xs font-medium text-slate-700 mb-1">尺寸</label>
                                    <select
                                        value={state.size}
                                        onChange={(e) => updateState({ size: e.target.value as ImageSize })}
                                        className="w-full px-2 py-1.5 border border-slate-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500"
                                    >
                                        {SIZE_OPTIONS.map(opt => (
                                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                                        ))}
                                    </select>
                                </div>

                                {/* 垫图模式 */}
                                <div className="flex items-end">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={state.useReferenceImage}
                                            onChange={(e) => updateState({ useReferenceImage: e.target.checked })}
                                            className="w-4 h-4 text-green-500 rounded focus:ring-green-500"
                                            disabled={state.inputImages.length === 0}
                                        />
                                        <span className="text-sm text-slate-700">垫图模式 (img2img)</span>
                                    </label>
                                </div>

                                {/* 自动下载 */}
                                <div className="flex items-end">
                                    <label className="flex items-center gap-2 cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={state.autoDownload}
                                            onChange={(e) => updateState({ autoDownload: e.target.checked })}
                                            className="w-4 h-4 text-green-500 rounded focus:ring-green-500"
                                        />
                                        <span className="text-sm text-slate-700">自动下载</span>
                                    </label>
                                </div>
                            </div>

                            {/* 生成按钮 */}
                            <div className="flex gap-2">
                                <button
                                    onClick={() => handleStartGeneration()}
                                    disabled={state.isGeneratingImages || state.generatedPrompts.filter(p => p.selected).length === 0}
                                    className="flex-1 py-2.5 bg-gradient-to-r from-green-500 to-emerald-600 text-white rounded-lg font-medium flex items-center justify-center gap-2 hover:from-green-600 hover:to-emerald-700 disabled:opacity-50 disabled:cursor-not-allowed transition-all"
                                >
                                    {state.isGeneratingImages ? (
                                        <>
                                            <Loader2 size={18} className="animate-spin" />
                                            生成中...
                                        </>
                                    ) : (
                                        <>
                                            <Play size={18} />
                                            开始批量生图 ({state.generatedPrompts.filter(p => p.selected).length} 张)
                                        </>
                                    )}
                                </button>
                                {state.tasks.some(t => t.status === 'completed') && (
                                    <button
                                        onClick={handleDownloadAll}
                                        className="px-4 py-2.5 bg-slate-100 text-slate-700 rounded-lg font-medium flex items-center gap-2 hover:bg-slate-200 transition-colors"
                                    >
                                        <Download size={18} />
                                        全部下载
                                    </button>
                                )}
                            </div>

                            {/* 任务队列 / 结果展示 */}
                            {state.tasks.length > 0 && (
                                <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                                    {state.tasks.map((task, index) => (
                                        <div
                                            key={task.id}
                                            className="relative rounded-xl border border-slate-200 overflow-hidden bg-slate-50"
                                        >
                                            {/* 图片预览区 */}
                                            <div className="aspect-square relative">
                                                {task.result ? (
                                                    <img
                                                        src={task.result}
                                                        alt={`生成图片 ${index + 1}`}
                                                        className="w-full h-full object-cover"
                                                    />
                                                ) : (
                                                    <div className="w-full h-full flex items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200">
                                                        {renderTaskStatus(task.status, task.progress)}
                                                    </div>
                                                )}

                                                {/* 状态角标 */}
                                                <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-black/50 text-white text-xs">
                                                    #{index + 1}
                                                </div>
                                            </div>

                                            {/* 操作区 */}
                                            {task.result && (
                                                <div className="p-2 flex justify-center gap-2">
                                                    <button
                                                        onClick={() => downloadImage(task.result!, task.filename)}
                                                        className="px-3 py-1 bg-green-500 text-white text-xs rounded-lg hover:bg-green-600"
                                                    >
                                                        <Download size={12} className="inline mr-1" />
                                                        下载
                                                    </button>
                                                </div>
                                            )}

                                            {/* 文件名显示 */}
                                            {task.filename && (
                                                <div className="px-2 pb-2 text-[10px] text-slate-400 truncate text-center">
                                                    {task.filename}
                                                </div>
                                            )}

                                            {/* 错误提示 */}
                                            {task.status === 'failed' && task.error && (
                                                <div className="p-2 text-xs text-red-600 bg-red-50">
                                                    {task.error}
                                                </div>
                                            )}
                                        </div>
                                    ))}
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
