import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useAuth } from '../../contexts/AuthContext';
import ProjectPanel from '../../components/ProjectPanel';
import ProjectSwitcher from '../../components/ProjectSwitcher';
import {
    Project,
    debouncedSaveProject,
    createProject,
    getOrCreateDefaultProject
} from '../../services/projectService';
import { v4 as uuidv4 } from 'uuid';
import { ImageItem, Preset, ImageRecognitionState, ChatMessage, InnovationItem, RecognitionTab, initialImageRecognitionState, savePresetsToStorage, DEFAULT_PRESETS, createDefaultTab } from './types';
import { savePresets as savePresetsToFirebase, loadPresets as loadPresetsFromFirebase } from '@/services/firestoreService';

type DescSendItem = {
    text: string;
    imageUrl?: string;
    originalInput?: string;
    chatHistory?: ChatMessage[];
};
import { convertBlobToBase64, parsePasteInput, fetchImageBlob, extractUrlsFromHtml, isLikelyHotlinkBlocked } from './utils';
import DropZone from './components/DropZone';
import PromptManager from './components/PromptManager';
import ResultsGrid from './components/ResultsGrid';
import CompactToolbar from './CompactToolbar';
import { Play, Pause, Square, ClipboardCopy, Trash2, Settings, Settings2, Zap, LayoutGrid, List, Rows3, Check, X, RotateCw, RotateCcw, RefreshCcw, AlertCircle, CheckCircle2, ImagePlus, Upload, Loader2, Link, FileCode, MessageCircle, Send, Copy, ChevronDown, ChevronUp, Sparkles, Download, ArrowLeftRight, Share2, FileText, Eye, EyeOff, ListPlus, Plus, Info, Bell, Languages, HelpCircle } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import { RandomLibraryManager } from './components/RandomLibraryManager';
import TabBar from './components/TabBar';
import {
    RandomLibraryConfig,
    DEFAULT_RANDOM_LIBRARY_CONFIG,
    DEFAULT_QUICK_INNOVATION_PRESETS,
    DEFAULT_TRANSITION_INSTRUCTION,
    USER_REQUIREMENT_TRANSITION,
    FIXED_PRIORITY_INSTRUCTION,
    getPriorityInstruction,
    generateRandomCombination,
    generateMultipleUniqueCombinations,
    generateCartesianCombinations,
    resetUsedCombinations,
    saveRandomLibraryConfig,
    loadRandomLibraryConfig,
} from './services/randomLibraryService';
import { QuickInnovationPanel } from './components/quick-innovation/QuickInnovationPanel';

// 提示词创新相关类型
interface DescEntry {
    id: string;
    source: string;
    outputs: string[];
    status: 'idle' | 'processing' | 'success' | 'error';
    error: string | null;
    originImageId?: string | null;
}

interface DescState {
    entries: DescEntry[];
    descPrompt: string;
    count: number;
    splitChar: string;
    bulkInput: string;
    error: string | null;
    controlNotice: string | null;
    isProcessing: boolean;
    isPaused: boolean;
    pendingAutoGenerate?: boolean;
    shouldPlayCompletionSound?: boolean;
}

// 统一的简单预设类型（用于跨应用共享）
type SimplePreset = {
    id: string;
    name: string;
    text: string;
    source: 'recognition' | 'template' | 'system';
};

interface ImageRecognitionAppProps {
    getAiInstance: () => GoogleGenAI;
    state: ImageRecognitionState;
    setState: React.Dispatch<React.SetStateAction<ImageRecognitionState>>;
    onRotateApiKey?: () => void; // 当遇到配额限制时调用此回调轮换API
    gyazoToken?: string; // Gyazo 图床 Token
    // 提示词创新相关
    descState?: DescState;
    setDescState?: React.Dispatch<React.SetStateAction<DescState>>;
    onNavigateToDesc?: () => void;
    onSendToDescInnovation?: (prompts: string[]) => void; // 发送提示词到创新并自动开始处理
    // 模板共享
    templateState?: { savedTemplates: Array<{ id: string; name: string; sections: any[]; values: Record<string, string> }> };
    // 统一预设共享
    unifiedPresets?: SimplePreset[];
}

// 默认 Gyazo Token
const DEFAULT_GYAZO_TOKEN = 'W0SHYCmn38FEoNQEdu7GwT1bOJP84TjQadGjlSgbG6I';
const DEFAULT_INNOVATION_INSTRUCTION = `你是一个专业的AI图像提示词创新专家。请根据下方“原始提示词”，生成多种风格或角度的创新变体。要求：
- 保持核心主题，细节更丰富、有创意
- 每个变体风格/视角/情绪有差异
- 用清晰自然的描述，不要解释语
- 直接输出变体内容`;

// 纯净回复模式后缀 - 让 AI 只输出描述词，不输出多余内容
const PURE_REPLY_SUFFIX = `\n\n【输出要求】输出内容为完整的图像生成英文描述词；可直接用于AI图像生成；不要输出多余内容，如说明、分析、引言、标点装饰等。`;

// 上传图片到 Gyazo 图床
const uploadToGyazo = async (file: File, token: string): Promise<string | null> => {
    const formData = new FormData();
    formData.append('access_token', token);
    formData.append('imagedata', file);

    try {
        const res = await fetch('https://upload.gyazo.com/api/upload', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            console.error(`Gyazo Upload failed: ${res.status} ${res.statusText}`);
            return null;
        }

        const json = await res.json();
        return json.url || json.permalink_url || null;
    } catch (error) {
        console.error("Gyazo upload error:", error);
        return null;
    }
};

// Helper for concurrency control with rate limiting
async function processWithConcurrency<T>(
    items: T[],
    concurrency: number,
    processItem: (item: T) => Promise<void>,
    delayMs: number = 1000 // 每个请求之间的间隔
) {
    const queue = [...items];
    const activeWorkers = new Set<Promise<void>>();
    let lastRequestTime = 0;

    const processWithDelay = async (item: T) => {
        // 确保请求间隔
        const now = Date.now();
        const timeSinceLastRequest = now - lastRequestTime;
        if (timeSinceLastRequest < delayMs) {
            await new Promise(resolve => setTimeout(resolve, delayMs - timeSinceLastRequest));
        }
        lastRequestTime = Date.now();

        await processItem(item);
    };

    while (queue.length > 0 || activeWorkers.size > 0) {
        while (queue.length > 0 && activeWorkers.size < concurrency) {
            const item = queue.shift()!;
            const promise = processWithDelay(item).finally(() => {
                activeWorkers.delete(promise);
            });
            activeWorkers.add(promise);
        }
        if (activeWorkers.size > 0) {
            await Promise.race(activeWorkers);
        }
    }
}

// Helper for API call with retry on rate limit and empty results
async function retryWithBackoff<T>(
    fn: () => Promise<T>,
    maxRetries: number = 3,
    initialDelayMs: number = 2000,
    onRotate?: () => void,  // 当需要轮换 API 时调用
    validateResult?: (result: T) => boolean  // 可选：验证结果是否有效
): Promise<T> {
    let lastError: Error | null = null;
    let didRotate = false;
    let lastEmptyResult: T | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await fn();

            // 检查结果是否为空（如果提供了验证函数则使用，否则检查字符串是否为空）
            const isEmpty = validateResult
                ? !validateResult(result)
                : (typeof result === 'string' && !result.trim());

            if (isEmpty && attempt < maxRetries) {
                lastEmptyResult = result;
                // 空结果时尝试轮换 API 密钥
                if (!didRotate && onRotate) {
                    onRotate();
                    didRotate = true;
                }

                // 短暂延迟后重试
                const delay = Math.min(initialDelayMs * Math.pow(1.5, attempt), 5000);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            return result;
        } catch (error: any) {
            lastError = error;
            const errorMsg = error.message?.toLowerCase() || '';

            // 检查是否是速率限制/配额错误
            const isQuotaError =
                errorMsg.includes('429') ||
                errorMsg.includes('rate') ||
                errorMsg.includes('quota') ||
                errorMsg.includes('resource exhausted') ||
                errorMsg.includes('too many requests') ||
                errorMsg.includes('exceeded');

            if (isQuotaError && attempt < maxRetries) {
                // 第一次遇到配额错误时尝试轮换 API
                if (!didRotate && onRotate) {
                    onRotate();
                    didRotate = true;
                    // 轮换后立即重试，不等待
                    continue;
                }

                // 指数退避：2s, 4s, 8s...
                const delay = initialDelayMs * Math.pow(2, attempt);
                await new Promise(resolve => setTimeout(resolve, delay));
                continue;
            }

            throw error;
        }
    }

    // 如果最后一次是空结果而不是错误，返回空结果而不是抛出异常
    if (lastEmptyResult !== null) {
        console.warn('[retryWithBackoff] All retries exhausted with empty results');
        return lastEmptyResult;
    }

    throw lastError;
}

const ImageRecognitionApp: React.FC<ImageRecognitionAppProps> = ({
    getAiInstance,
    state,
    setState,
    onRotateApiKey,
    gyazoToken,
    descState,
    setDescState,
    onNavigateToDesc,
    onSendToDescInnovation,
    templateState,
    unifiedPresets = []
}) => {
    const { images, prompt, presets, isProcessing, copyMode, viewMode, autoUploadGyazo, innovationInstruction, globalInnovationTemplateId, globalInnovationCount, globalInnovationRounds, pureReplyMode, workMode = 'standard' as const, creativeCount = 4, creativeResults = [], creativeInstruction = '', needOriginalDesc = false, originalDescPresetId = '1', tabs = [], activeTabId = '' } = state;
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [copySuccess, setCopySuccess] = useState<'links' | 'formulas' | 'results' | 'results-zh' | 'original' | 'creative' | 'creative-en' | 'creative-zh' | 'creative-all' | null>(null);  // 复制成功提示
    const [showAllComplete, setShowAllComplete] = useState(false);  // 全部完成提示
    const [showHistoryPanel, setShowHistoryPanel] = useState(false); // 历史面板 - 已被项目面板替代
    const [showProjectPanel, setShowProjectPanel] = useState(false); // 新的项目管理面板
    const { user } = useAuth();
    const [isBulkInnovating, setIsBulkInnovating] = useState(false);
    const [showGlobalInnovationSettings, setShowGlobalInnovationSettings] = useState(false); // 全局创新设置弹框
    const [showRulesModal, setShowRulesModal] = useState(false); // 规则说明弹窗
    const [showPresetEditor, setShowPresetEditor] = useState<'standard' | 'withRandomLib' | null>(null); // 预设编辑弹窗
    const [showGlobalPromptEditor, setShowGlobalPromptEditor] = useState(false); // 全局用户要求放大编辑弹窗
    const [showCreativeSettings, setShowCreativeSettings] = useState(false); // 创新模式设置弹框
    // === 拆分元素模式 ===
    const DEFAULT_SPLIT_ELEMENTS = ['背景', '主体/人物', '手持物品', '服装（须含性别）', '光影/氛围', '风格/构图'];
    const OLD_SPLIT_ELEMENTS_V1 = ['背景', '主体/人物', '服装/配饰', '光影/氛围', '风格/构图']; // 旧版默认，用于迁移检测
    const DEFAULT_SPLIT_INSTRUCTION = `详细描述图片，不要图片中的文字。请根据我指定的拆分元素库进行分别详细描述对应元素的完整的AI描述词。方便我直接给其他软件生成图片或者视频使用。你只需要给我各个元素的最终AI描述词就行，不需要其他任何多余的内容。并且英文回复我。`;
    const [splitElements, setSplitElements] = useState<string[]>(() => {
        if (typeof window !== 'undefined') {
            const saved = localStorage.getItem('split_elements');
            if (saved) {
                try {
                    const parsed = JSON.parse(saved);
                    // 如果保存的是旧版默认值，自动迁移到新版
                    if (Array.isArray(parsed) && JSON.stringify(parsed) === JSON.stringify(OLD_SPLIT_ELEMENTS_V1)) {
                        localStorage.setItem('split_elements', JSON.stringify(DEFAULT_SPLIT_ELEMENTS));
                        return DEFAULT_SPLIT_ELEMENTS;
                    }
                    return parsed;
                } catch { }
            }
        }
        return DEFAULT_SPLIT_ELEMENTS;
    });
    const [splitInstruction, setSplitInstruction] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('split_instruction') || DEFAULT_SPLIT_INSTRUCTION;
        }
        return DEFAULT_SPLIT_INSTRUCTION;
    });
    const [splitElementInput, setSplitElementInput] = useState('');
    const [showSplitSettings, setShowSplitSettings] = useState(false);
    const [showSplitPreview, setShowSplitPreview] = useState(false);
    // 保存拆分元素设置
    useEffect(() => {
        if (typeof window !== 'undefined') {
            localStorage.setItem('split_elements', JSON.stringify(splitElements));
            localStorage.setItem('split_instruction', splitInstruction);
        }
    }, [splitElements, splitInstruction]);
    const [imageModel, setImageModel] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('image_model') || 'gemini-3-flash-preview';
        }
        return 'gemini-3-flash-preview';
    });
    const [sentToDescIds, setSentToDescIds] = useState<string[]>([]);
    const [sentAllCount, setSentAllCount] = useState<number | null>(null);
    const [isToolbarCompact, setIsToolbarCompact] = useState(() => {
        if (typeof window !== 'undefined') {
            return localStorage.getItem('isToolbarCompact') === 'true';
        }
        return false;
    });

    const toggleToolbarCompact = useCallback(() => {
        setIsToolbarCompact(prev => {
            const next = !prev;
            localStorage.setItem('isToolbarCompact', String(next));
            return next;
        });
    }, []);

    // ==================== 多标签页管理 ====================
    // 确保至少有一个标签页
    useEffect(() => {
        if (tabs.length === 0) {
            const defaultTab = createDefaultTab('标签页 1');
            setState(prev => ({
                ...prev,
                tabs: [defaultTab],
                activeTabId: defaultTab.id,
                images: defaultTab.images,
                prompt: defaultTab.prompt,
            }));
        }
    }, [tabs.length, setState]);

    // 获取当前活动的标签页
    const activeTab = tabs.find(t => t.id === activeTabId) || tabs[0];

    // 用于标签页切换时临时存储待恢复的随机库配置
    const pendingRandomLibraryConfigRef = useRef<import('./services/randomLibraryService').RandomLibraryConfig | null>(null);

    // 切换标签页
    const handleTabChange = useCallback((tabId: string) => {
        const targetTab = tabs.find(t => t.id === tabId);
        if (!targetTab || tabId === activeTabId) return;

        // 先保存当前标签页的状态到 tabs 数组，然后切换
        setState(prev => {
            const currentTabIdx = prev.tabs.findIndex(t => t.id === prev.activeTabId);
            const updatedTabs = [...prev.tabs];
            if (currentTabIdx >= 0) {
                updatedTabs[currentTabIdx] = {
                    ...updatedTabs[currentTabIdx],
                    images: prev.images,
                    prompt: prev.prompt,
                    innovationInstruction: prev.innovationInstruction,
                    globalInnovationTemplateId: prev.globalInnovationTemplateId,
                    globalInnovationCount: prev.globalInnovationCount,
                    globalInnovationRounds: prev.globalInnovationRounds,
                    isProcessing: prev.isProcessing,
                    randomLibraryConfig: randomLibraryConfigRef.current, // 保存当前标签页的随机库配置
                };
            }

            // 保存目标标签页的配置到 ref（稍后恢复）
            pendingRandomLibraryConfigRef.current = targetTab.randomLibraryConfig || DEFAULT_RANDOM_LIBRARY_CONFIG;

            // 加载目标标签页的状态
            return {
                ...prev,
                tabs: updatedTabs,
                activeTabId: tabId,
                images: targetTab.images,
                prompt: targetTab.prompt,
                innovationInstruction: targetTab.innovationInstruction,
                globalInnovationTemplateId: targetTab.globalInnovationTemplateId,
                globalInnovationCount: targetTab.globalInnovationCount,
                globalInnovationRounds: targetTab.globalInnovationRounds,
                isProcessing: false,
            };
        });
    }, [tabs, activeTabId, setState]);

    // 新建标签页
    const handleTabAdd = useCallback(() => {
        const newTabNumber = tabs.length + 1;
        const newTab = createDefaultTab(`标签页 ${newTabNumber}`);

        // 先保存当前标签页状态，再添加新标签页并切换
        setState(prev => {
            const currentTabIdx = prev.tabs.findIndex(t => t.id === prev.activeTabId);
            const updatedTabs = [...prev.tabs];
            if (currentTabIdx >= 0) {
                updatedTabs[currentTabIdx] = {
                    ...updatedTabs[currentTabIdx],
                    images: prev.images,
                    prompt: prev.prompt,
                    innovationInstruction: prev.innovationInstruction,
                    isProcessing: prev.isProcessing,
                };
            }
            return {
                ...prev,
                tabs: [...updatedTabs, newTab],
                activeTabId: newTab.id,
                images: [],
                prompt: '',
                innovationInstruction: '',
                isProcessing: false,
            };
        });
    }, [tabs, setState]);

    // 删除标签页
    const handleTabRemove = useCallback((tabId: string) => {
        if (tabs.length <= 1) return; // 至少保留一个标签页

        setState(prev => {
            const tabIdx = prev.tabs.findIndex(t => t.id === tabId);
            if (tabIdx < 0) return prev;

            const newTabs = prev.tabs.filter(t => t.id !== tabId);
            let newActiveTabId = prev.activeTabId;
            let newImages = prev.images;
            let newPrompt = prev.prompt;

            // 如果删除的是当前活动标签页，切换到相邻的标签页
            if (tabId === prev.activeTabId) {
                const newActiveTab = newTabs[Math.min(tabIdx, newTabs.length - 1)];
                newActiveTabId = newActiveTab.id;
                newImages = newActiveTab.images;
                newPrompt = newActiveTab.prompt;
            }

            return {
                ...prev,
                tabs: newTabs,
                activeTabId: newActiveTabId,
                images: newImages,
                prompt: newPrompt,
            };
        });
    }, [tabs.length, setState]);

    // 重命名标签页
    const handleTabRename = useCallback((tabId: string, newName: string) => {
        setState(prev => ({
            ...prev,
            tabs: prev.tabs.map(t =>
                t.id === tabId ? { ...t, name: newName } : t
            )
        }));
    }, [setState]);

    // 同步当前图片/状态变化到当前标签页
    useEffect(() => {
        if (!activeTabId || tabs.length === 0) return;

        setState(prev => {
            const tabIdx = prev.tabs.findIndex(t => t.id === prev.activeTabId);
            if (tabIdx < 0) return prev;

            const updatedTabs = [...prev.tabs];
            updatedTabs[tabIdx] = {
                ...updatedTabs[tabIdx],
                images: prev.images,
                prompt: prev.prompt,
                innovationInstruction: prev.innovationInstruction,
                globalInnovationTemplateId: prev.globalInnovationTemplateId,
                globalInnovationCount: prev.globalInnovationCount,
                globalInnovationRounds: prev.globalInnovationRounds,
                isProcessing: prev.isProcessing,
            };
            return { ...prev, tabs: updatedTabs };
        });
    }, [images.length, prompt, activeTabId]); // 只在关键数据变化时同步，避免无限循环
    // ==================================================

    // 随机库配置状态
    const [randomLibraryConfig, setRandomLibraryConfig] = useState<RandomLibraryConfig>(DEFAULT_RANDOM_LIBRARY_CONFIG);
    const randomLibraryConfigRef = useRef<RandomLibraryConfig>(DEFAULT_RANDOM_LIBRARY_CONFIG);

    // 处理切换标签页时恢复随机库配置
    useEffect(() => {
        if (pendingRandomLibraryConfigRef.current !== null) {
            setRandomLibraryConfig(pendingRandomLibraryConfigRef.current);
            randomLibraryConfigRef.current = pendingRandomLibraryConfigRef.current;
            pendingRandomLibraryConfigRef.current = null;
        }
    }, [activeTabId]); // 当活动标签页改变时触发


    // 无图创新模式
    const [noImageMode, setNoImageMode] = useState(() => {
        // 从localStorage恢复无图模式开关状态
        const saved = localStorage.getItem('ai-image-recognition-no-image-mode');
        return saved === 'true';
    });
    const [textCards, setTextCards] = useState<{ id: string, topic: string, results: string[], status: 'idle' | 'processing' | 'done' | 'error' }[]>(() => {
        // 从localStorage恢复无图模式卡片
        try {
            const saved = localStorage.getItem('ai-image-recognition-text-cards');
            if (saved) {
                const parsed = JSON.parse(saved);
                // 恢复时将所有processing状态改为idle（未完成的任务）
                return parsed.map((card: any) => ({
                    ...card,
                    status: card.status === 'processing' ? 'idle' : card.status
                }));
            }
        } catch (e) {
            console.error('Failed to load text cards from localStorage:', e);
        }
        return [];
    });
    const [isGeneratingNoImage, setIsGeneratingNoImage] = useState(false);
    const [showBulkImportModal, setShowBulkImportModal] = useState(false); // 批量导入弹窗
    const [bulkImportText, setBulkImportText] = useState(''); // 批量导入文本
    const [cardBatchSize, setCardBatchSize] = useState(() => {
        // 从localStorage恢复批次大小设置
        const saved = localStorage.getItem('ai-image-recognition-card-batch-size');
        return saved ? parseInt(saved, 10) : 1; // 默认1（单条模式）
    }); // 批次处理大小：多个卡片合并成一次AI请求
    const [imageBatchSize, setImageBatchSize] = useState(() => {
        const saved = localStorage.getItem('ai-image-recognition-image-batch-size');
        return saved ? parseInt(saved, 10) : 1; // 默认1（单张模式）
    }); // 图片批次分类大小：多张图片合并成一次AI请求

    // 自动保存无图模式状态和卡片到localStorage
    useEffect(() => {
        localStorage.setItem('ai-image-recognition-no-image-mode', String(noImageMode));
    }, [noImageMode]);

    useEffect(() => {
        // 只保存id、topic、results，status不需要持久化（会在加载时重置）
        const toSave = textCards.map(card => ({
            id: card.id,
            topic: card.topic,
            results: card.results,
            status: card.status === 'processing' ? 'idle' : card.status
        }));
        localStorage.setItem('ai-image-recognition-text-cards', JSON.stringify(toSave));
    }, [textCards]);

    // 保存批次大小设置
    useEffect(() => {
        localStorage.setItem('ai-image-recognition-card-batch-size', String(cardBatchSize));
    }, [cardBatchSize]);
    // 保存图片批次大小设置
    useEffect(() => {
        localStorage.setItem('ai-image-recognition-image-batch-size', String(imageBatchSize));
    }, [imageBatchSize]);
    const [toastMessage, setToastMessage] = useState<string | null>(null); // Toast提示
    const [confirmModal, setConfirmModal] = useState<{ show: boolean; message: string; onConfirm: () => void }>({
        show: false,
        message: '',
        onConfirm: () => { },
    });
    // 结果详情弹窗状态
    const [resultDetailModal, setResultDetailModal] = useState<{ show: boolean; card: { id: string, topic: string, results: string[], status: string } | null }>({
        show: false,
        card: null,
    });
    // 翻译缓存状态: { "cardId-resultIndex": "翻译内容" }
    const [translationCache, setTranslationCache] = useState<Record<string, string>>(() => {
        try {
            const saved = localStorage.getItem('ai-image-recognition-translations');
            return saved ? JSON.parse(saved) : {};
        } catch {
            return {};
        }
    });
    // 正在翻译的项目
    const [translatingItems, setTranslatingItems] = useState<Set<string>>(new Set());

    // 保存翻译缓存到localStorage
    useEffect(() => {
        localStorage.setItem('ai-image-recognition-translations', JSON.stringify(translationCache));
    }, [translationCache]);
    // 更新说明弹窗状态
    const [showUpdateNotes, setShowUpdateNotes] = useState(() => {
        // 检查是否已经看过v2.96更新说明
        const hasSeenUpdate = localStorage.getItem('ai-image-recognition-update-v2.96-seen');
        return !hasSeenUpdate;
    });

    // 关闭更新说明时标记已读
    const closeUpdateNotes = useCallback(() => {
        localStorage.setItem('ai-image-recognition-update-v2.96-seen', 'true');
        setShowUpdateNotes(false);
    }, []);

    // 显示Toast提示（替代alert）
    const showToast = useCallback((message: string) => {
        setToastMessage(message);
        setTimeout(() => setToastMessage(null), 2500);
    }, []);

    // 显示确认弹窗（替代confirm）
    const showConfirm = useCallback((message: string, onConfirm: () => void) => {
        setConfirmModal({ show: true, message, onConfirm });
    }, []);


    // 加载随机库配置
    useEffect(() => {
        loadRandomLibraryConfig().then(config => {
            setRandomLibraryConfig(config);
            randomLibraryConfigRef.current = config;
        });
    }, []);

    // 保存随机库配置
    const handleRandomLibraryConfigChange = useCallback((config: RandomLibraryConfig) => {
        setRandomLibraryConfig(config);
        randomLibraryConfigRef.current = config;
        saveRandomLibraryConfig(config);
    }, []);

    // 卡片选中状态（用于粘贴添加融合图片）
    const [selectedCardId, setSelectedCardId] = useState<string | null>(null);
    const selectedCardIdRef = useRef<string | null>(null);
    const workModeRef = useRef(workMode);
    const handleAddFusionImageRef = useRef<((imageId: string, file: File) => Promise<void>) | null>(null);
    selectedCardIdRef.current = selectedCardId;
    workModeRef.current = workMode;

    // ==================== 项目持久化 ====================
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const projectInitializedRef = useRef(false);
    const lastSavedStateRef = useRef<string>('');
    const lastUserIdRef = useRef<string | null>(null);
    const isCreatingProjectRef = useRef(false); // 防止重复创建项目的竞态条件

    // ==================== Gyazo 上传追踪 ====================
    // 使用 Map 追踪每个图片的 Gyazo 上传 Promise，确保历史保存时等待上传完成
    const gyazoUploadPromisesRef = useRef<Map<string, Promise<string | null>>>(new Map());

    // 生成临时项目名称
    const generateTempProjectName = () => {
        const now = new Date();
        const month = now.getMonth() + 1;
        const day = now.getDate();
        const hour = now.getHours();
        const minute = now.getMinutes();
        return `项目 ${month}/${day} ${hour}:${minute.toString().padStart(2, '0')}`;
    };

    // 从项目恢复状态
    const restoreFromProject = useCallback((savedState: Partial<ImageRecognitionState>) => {
        if (!savedState) return;

        // 辅助函数：从 =IMAGE("url") 格式提取 URL
        const extractImageUrl = (input: string): string | null => {
            if (!input) return null;
            if (input.startsWith('http')) return input;
            const match = input.match(/=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i);
            return match ? match[1] : null;
        };

        // 处理图片恢复
        const restoreImage = (imgData: any): ImageItem => {
            let displayUrl = imgData.imageUrl;
            if (!displayUrl || displayUrl.startsWith('blob:') || displayUrl === '[base64-image]') {
                displayUrl = imgData.gyazoUrl || extractImageUrl(imgData.originalInput) || '';
            }
            return {
                id: imgData.id || uuidv4(),
                sourceType: imgData.sourceType || 'url',
                originalInput: imgData.originalInput || '',
                imageUrl: displayUrl,
                fetchUrl: imgData.fetchUrl,
                mimeType: imgData.mimeType,
                status: imgData.status || 'success',
                result: imgData.result || '',
                errorMsg: imgData.errorMsg,
                gyazoUrl: imgData.gyazoUrl,
                chatHistory: imgData.chatHistory || [],
                isChatOpen: false,
                isChatLoading: false,
                chatInput: '',
                chatAttachments: [],
                innovationOutputs: imgData.innovationOutputs || [],
                innovationItems: imgData.innovationItems || [],
                isInnovationOpen: false,
                isInnovating: false,
                innovationError: undefined,
                customPrompt: imgData.customPrompt,
                useCustomPrompt: imgData.useCustomPrompt || false,
                // base64Data 会在下面异步加载
                base64Data: undefined
            };
        };

        // 恢复整个状态
        const restoredImages = savedState.images ? savedState.images.map(restoreImage) : [];
        setState(prev => ({
            ...prev,
            images: restoredImages.length > 0 ? restoredImages : prev.images,
            prompt: savedState.prompt ?? prev.prompt,
            // 只有当云端 presets 有内容时才恢复，否则保留本地预设
            presets: (savedState.presets && savedState.presets.length > 0) ? savedState.presets : prev.presets,
            innovationInstruction: savedState.innovationInstruction ?? prev.innovationInstruction,
            copyMode: savedState.copyMode ?? prev.copyMode,
            viewMode: savedState.viewMode ?? prev.viewMode,
            autoUploadGyazo: savedState.autoUploadGyazo ?? prev.autoUploadGyazo,
            pureReplyMode: savedState.pureReplyMode ?? prev.pureReplyMode,
        }));

        // 异步加载图片的 base64 数据（用于对话和创新）
        if (restoredImages.length > 0) {
            restoredImages.forEach(async (img) => {
                const urlToFetch = img.gyazoUrl || img.fetchUrl || img.imageUrl;
                if (!urlToFetch || !urlToFetch.startsWith('http')) return;

                try {
                    // 使用 fetchImageBlob 处理各种代理和跨域问题
                    const { blob, mimeType } = await fetchImageBlob(urlToFetch);
                    const base64 = await convertBlobToBase64(blob);

                    setState(prev => ({
                        ...prev,
                        images: prev.images.map(i =>
                            i.id === img.id
                                ? { ...i, base64Data: base64, mimeType: mimeType }
                                : i
                        )
                    }));
                } catch (error) {
                    console.error('[Workspace] Failed to load base64 for:', img.id, error);
                }
            });
        }
    }, [setState]);

    // 初始化：每次加载时创建新的临时项目（用户可通过项目面板切换到之前的项目）
    useEffect(() => {
        // 如果用户变化了，重置初始化标志
        if (lastUserIdRef.current !== user?.uid) {
            projectInitializedRef.current = false;
            lastUserIdRef.current = user?.uid || null;
        }

        if (projectInitializedRef.current) return;

        let cancelled = false;

        const createLocalTempProject = (): Project => ({
            id: 'temp_' + Date.now(),
            moduleId: 'image-recognition',
            name: generateTempProjectName(),
            createdAt: { toDate: () => new Date() } as any,
            updatedAt: { toDate: () => new Date() } as any,
            isActive: true,
            isStarred: false,
            isPinned: false,
            tags: [],
            preview: '',
            itemCount: 0,
            currentState: {},
            versionCount: 0
        });

        const initProject = async () => {
            projectInitializedRef.current = true;

            // 每次都创建新的临时项目，不自动加载之前的项目
            const tempProject = createLocalTempProject();
            if (!cancelled) {
                setCurrentProject(tempProject);
            }
        };

        initProject();

        return () => {
            cancelled = true;
        };
    }, [user?.uid]);

    // 自动保存状态到项目（防抖）
    // 注意：如果未登录但配置了邮箱云同步，数据会通过 index.tsx 中的云同步逻辑保存
    useEffect(() => {
        // 检查是否有邮箱云同步配置
        const hasSyncEmail = typeof window !== 'undefined' && localStorage.getItem('cloud_sync_email');

        // 如果没有登录且没有邮箱同步，跳过
        if (!user?.uid && !hasSyncEmail) return;

        // 如果没有登录但有邮箱同步，不使用项目保存（由云同步处理）
        if (!user?.uid && hasSyncEmail) {
            // 数据通过邮箱云同步在 index.tsx 中处理
            return;
        }

        // 登录用户的项目保存逻辑
        if (!currentProject?.id || !projectInitializedRef.current) return;

        // 空项目不保存
        if (state.images.length === 0) {
            return;
        }

        // 计算对话数量用于调试（单次遍历，避免多次 filter 导致性能问题）
        let totalChats = 0;
        let totalInnovations = 0;
        let idleCount = 0;
        let loadingCount = 0;
        let successCount = 0;
        let errorCount = 0;
        const successFingerprints: string[] = [];

        for (const img of state.images) {
            totalChats += img.chatHistory?.length || 0;
            totalInnovations += img.innovationItems?.length || 0;
            switch (img.status) {
                case 'idle': idleCount++; break;
                case 'loading': loadingCount++; break;
                case 'success':
                    successCount++;
                    // 只记录前20个成功图片的摘要，避免大量图片时指纹过长
                    if (successFingerprints.length < 20) {
                        successFingerprints.push(`${img.id.slice(-6)}:${(img.result || '').length}`);
                    }
                    break;
                case 'error': errorCount++; break;
            }
        }

        // 使用轻量的状态指纹替代完整 JSON 序列化
        const stateFingerprint = [
            state.images.length,
            idleCount,
            loadingCount,
            successCount,
            errorCount,
            successFingerprints.join(','),
            totalChats,
            totalInnovations,
            state.copyMode,
            state.viewMode
        ].join('_');

        // 只在状态真正变化时保存
        if (stateFingerprint === lastSavedStateRef.current) {
            return;
        }

        lastSavedStateRef.current = stateFingerprint;

        // 保存到项目
        const saveToProject = async () => {
            let projectId = currentProject.id;

            // 临时项目需要先在云端创建
            if (projectId.startsWith('temp_')) {
                // 防止重复创建项目的竞态条件
                if (isCreatingProjectRef.current) {
                    return;
                }

                isCreatingProjectRef.current = true;
                try {
                    projectId = await createProject(user.uid, {
                        moduleId: 'image-recognition',
                        name: currentProject.name
                    });
                    // 更新 currentProject 的 ID
                    setCurrentProject(prev => prev ? { ...prev, id: projectId } : null);
                } catch (error) {
                    console.error('[Project] Failed to create project:', error);
                    isCreatingProjectRef.current = false;
                    return;
                }
                isCreatingProjectRef.current = false;
            }

            // 准备保存数据（清理 base64 和 blob URL）
            const removeUndefined = (obj: any): any => {
                if (obj === null || obj === undefined) return null;
                if (Array.isArray(obj)) return obj.map(removeUndefined);
                if (typeof obj === 'object') {
                    const cleaned: any = {};
                    for (const [key, value] of Object.entries(obj)) {
                        if (value !== undefined) {
                            cleaned[key] = removeUndefined(value);
                        }
                    }
                    return cleaned;
                }
                return obj;
            };

            const cleanedImages = state.images.map(img => {
                // Ensure originalInput uses gyazoUrl if available, avoiding base64 data URLs
                let cleanOriginalInput = img.originalInput;
                if (img.gyazoUrl) {
                    cleanOriginalInput = `=IMAGE("${img.gyazoUrl}")`;
                } else if (img.fetchUrl && !cleanOriginalInput?.startsWith('=IMAGE')) {
                    cleanOriginalInput = `=IMAGE("${img.fetchUrl}")`;
                } else if (cleanOriginalInput?.includes('base64,')) {
                    // Don't save base64 data in originalInput
                    cleanOriginalInput = img.gyazoUrl ? `=IMAGE("${img.gyazoUrl}")` : '[local-image]';
                }

                return removeUndefined({
                    id: img.id,
                    sourceType: img.sourceType,
                    originalInput: cleanOriginalInput,
                    imageUrl: img.gyazoUrl || img.fetchUrl || img.imageUrl?.replace(/^blob:.*$/, '') || '',
                    fetchUrl: img.fetchUrl || null,
                    gyazoUrl: img.gyazoUrl || null,
                    status: img.status,
                    result: img.result || '',
                    errorMsg: img.errorMsg || null,
                    chatHistory: img.chatHistory || [],
                    innovationItems: img.innovationItems || [],
                    customPrompt: img.customPrompt || null,
                    useCustomPrompt: img.useCustomPrompt || false,
                    translatedResult: img.translatedResult || null,
                    lastSelectedText: img.lastSelectedText || null,
                    lastTranslatedSelection: img.lastTranslatedSelection || null
                });
            });

            const stateToSave = removeUndefined({
                images: cleanedImages,
                prompt: state.prompt || '',
                presets: state.presets || [], // Save user presets to Firebase
                innovationInstruction: state.innovationInstruction || '',
                copyMode: state.copyMode || 'resultOnly',
                viewMode: state.viewMode || 'list',
                autoUploadGyazo: state.autoUploadGyazo ?? true,
                pureReplyMode: state.pureReplyMode ?? false
            });

            const thumbnailUrl = state.images.find(img => img.gyazoUrl)?.gyazoUrl;
            const previewText = state.images[0]?.result?.slice(0, 100) || `${state.images.length} 张图片`;

            debouncedSaveProject(user.uid, 'image-recognition', projectId, stateToSave, {
                preview: previewText,
                itemCount: state.images.length,
                thumbnail: thumbnailUrl,
                createVersion: true
            });
        };

        saveToProject();
    }, [user?.uid, currentProject?.id, currentProject?.name, state]);

    // 处理项目切换
    const handleProjectChange = useCallback((project: Project) => {
        setCurrentProject(project);

        if (project.currentState && Object.keys(project.currentState).length > 0) {
            restoreFromProject(project.currentState);
        } else {
            // 新项目，使用初始状态，但保留当前的 presets
            setState(prev => ({
                ...initialImageRecognitionState,
                presets: prev.presets,
            }));
        }
    }, [restoreFromProject, setState]);
    // ==================================================

    // Refs for controlling the processing loop
    const pausedRef = useRef(false);
    const stoppedRef = useRef(false);

    // Helper setters to update parent state
    const setImages = useCallback((valOrFn: ImageItem[] | ((prev: ImageItem[]) => ImageItem[])) => {
        setState(prev => ({
            ...prev,
            images: typeof valOrFn === 'function' ? valOrFn(prev.images) : valOrFn
        }));
    }, [setState]);

    const setPrompt = useCallback((val: string) => {
        setState(prev => ({ ...prev, prompt: val }));
    }, [setState]);

    const setPresets = useCallback((val: Preset[]) => {
        setState(prev => ({ ...prev, presets: val }));
        // 同时保存到 localStorage 确保预设持久化
        savePresetsToStorage(val);
    }, [setState]);

    // ==================== Firebase 预设云端同步 ====================
    const presetsSyncedRef = useRef(false);
    const presetsSaveTimeoutRef = useRef<NodeJS.Timeout | null>(null);

    // 登录时从 Firebase 加载预设
    useEffect(() => {
        if (!user?.uid || presetsSyncedRef.current) return;

        const loadFromCloud = async () => {
            try {
                const cloudPresets = await loadPresetsFromFirebase(user.uid, 'image-recognition');

                // 获取默认预设的 ID 列表
                const defaultPresetIds = new Set(DEFAULT_PRESETS.map(p => p.id));

                // 分离云端数据：默认预设 vs 自定义预设
                const cloudCustomPresets = (cloudPresets && Array.isArray(cloudPresets))
                    ? cloudPresets.filter((p: Preset) => !defaultPresetIds.has(p.id))
                    : [];

                // 合并：默认预设（最新版本）+ 云端自定义预设
                // 默认预设始终使用代码中的最新版本，不被云端覆盖
                const finalPresets = [...DEFAULT_PRESETS, ...cloudCustomPresets];

                // 更新状态和本地缓存
                setState(prev => ({ ...prev, presets: finalPresets }));
                savePresetsToStorage(finalPresets);
                presetsSyncedRef.current = true;

                // 保存合并后的预设到云端
                await savePresetsToFirebase(user.uid, 'image-recognition', finalPresets);
            } catch (error) {
                console.error('[Presets Cloud] Failed to load presets:', error);
            }
        };

        loadFromCloud();
    }, [user?.uid, setState]);

    // 预设变化时保存到 Firebase（防抖 3 秒）
    useEffect(() => {
        if (!user?.uid || !presetsSyncedRef.current) return;
        if (presets.length === 0) return;

        if (presetsSaveTimeoutRef.current) {
            clearTimeout(presetsSaveTimeoutRef.current);
        }

        presetsSaveTimeoutRef.current = setTimeout(async () => {
            try {
                await savePresetsToFirebase(user.uid, 'image-recognition', presets);
            } catch (error) {
                console.error('[Presets Cloud] Failed to save presets:', error);
            }
        }, 3000);

        return () => {
            if (presetsSaveTimeoutRef.current) {
                clearTimeout(presetsSaveTimeoutRef.current);
            }
        };
    }, [user?.uid, presets]);
    // ==============================================================

    const setInnovationInstruction = useCallback((val: string) => {
        setState(prev => ({ ...prev, innovationInstruction: val }));
    }, [setState]);

    const setIsProcessing = useCallback((val: boolean) => {
        setState(prev => ({ ...prev, isProcessing: val }));
    }, [setState]);

    const setCopyMode = useCallback((val: 'resultOnly' | 'originalAndResult' | 'originalOnly' | 'linkOnly') => {
        setState(prev => ({ ...prev, copyMode: val }));
    }, [setState]);

    const setViewMode = useCallback((val: 'grid' | 'list' | 'compact') => {
        setState(prev => ({ ...prev, viewMode: val }));
    }, [setState]);

    const setAutoUploadGyazo = useCallback((val: boolean) => {
        setState(prev => ({ ...prev, autoUploadGyazo: val }));
    }, [setState]);

    const setPureReplyMode = useCallback((val: boolean) => {
        setState(prev => ({ ...prev, pureReplyMode: val }));
    }, [setState]);



    const buildDescPayload = useCallback((items: ImageItem[]): DescSendItem[] => {
        return items
            .filter(img => !!img.result)
            .map(img => ({
                text: img.result || '',
                imageUrl: img.gyazoUrl || img.fetchUrl || img.imageUrl,
                originalInput: img.originalInput,
                chatHistory: img.chatHistory || []
            }));
    }, []);

    const sendToDescTool = useCallback((payload: DescSendItem[], askNavigate: boolean = true) => {
        if (!payload.length) {
            return false;
        }
        if (typeof window !== 'undefined') {
            const event = new CustomEvent('desc-add-from-image-recognition', { detail: { items: payload } });
            window.dispatchEvent(event);
        }
        if (askNavigate && onNavigateToDesc) {
            onNavigateToDesc();
        }
        return true;
    }, [onNavigateToDesc]);

    const classifyImage = async (base64Data: string, mimeType: string, prompt: string): Promise<string> => {
        return retryWithBackoff(async () => {
            const ai = getAiInstance();
            const modelId = imageModel;

            const response = await ai.models.generateContent({
                model: modelId,
                contents: {
                    parts: [
                        {
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Data,
                            },
                        },
                        {
                            text: prompt,
                        },
                    ],
                },
                config: {
                    temperature: 0.2,
                }
            });

            return response.text || "";
        }, 3, 2000, () => {
            if (onRotateApiKey) {
                onRotateApiKey();
            } else {
                console.warn('[classifyImage] onRotateApiKey is not defined!');
            }
        });
    };

    // 批量分类：一次 API 调用处理多张图片
    const classifyImagesBatch = async (
        items: { base64Data: string; mimeType: string; id: string }[],
        prompt: string
    ): Promise<Map<string, string>> => {
        return retryWithBackoff(async () => {
            const ai = getAiInstance();
            const modelId = imageModel;

            // 构建 parts：交替放置图片和编号标记
            const parts: any[] = [];
            items.forEach((item, index) => {
                parts.push({
                    inlineData: {
                        mimeType: item.mimeType,
                        data: item.base64Data,
                    },
                });
                parts.push({
                    text: `[图片 ${index + 1}]`,
                });
            });

            // 最后追加用户 prompt + 批次要求
            parts.push({
                text: `${prompt}

【批次处理说明】
以上共有 ${items.length} 张图片，已按 [图片 1]、[图片 2]... 编号。
请对每张图片分别执行上述指令，并严格按以下格式返回结果：

=== [1] ===
（图片1的分析结果）
=== [2] ===
（图片2的分析结果）
...以此类推

注意：
- 每张图片的结果必须用 === [编号] === 分隔
- 编号从 1 开始，与图片顺序一一对应
- 每张图片的结果格式与单张处理时完全相同`,
            });

            const response = await ai.models.generateContent({
                model: modelId,
                contents: { parts },
                config: {
                    temperature: 0.2,
                },
            });

            const fullText = response.text || "";

            // 解析批量结果
            const resultMap = new Map<string, string>();
            const sections = fullText.split(/===\s*\[(\d+)\]\s*===/);

            // sections 的格式为: [前缀, "1", 内容1, "2", 内容2, ...]
            for (let i = 1; i < sections.length; i += 2) {
                const index = parseInt(sections[i], 10) - 1;
                const content = (sections[i + 1] || '').trim();
                if (index >= 0 && index < items.length && content) {
                    resultMap.set(items[index].id, content);
                }
            }

            // 如果解析结果数量严重不足（< 50%），说明格式不对，抛错让重试
            if (resultMap.size < items.length * 0.5) {
                console.warn(`[classifyImagesBatch] 只解析到 ${resultMap.size}/${items.length} 个结果，尝试重试`);
                throw new Error(`Batch parse incomplete: ${resultMap.size}/${items.length}`);
            }

            return resultMap;
        }, 2, 3000, () => {
            if (onRotateApiKey) {
                onRotateApiKey();
            }
        });
    };

    // 简单文本生成（用于智能库等功能）
    const generateText = useCallback(async (prompt: string): Promise<string> => {
        const ai = getAiInstance();
        const response = await ai.models.generateContent({
            model: imageModel || 'gemini-2.0-flash',
            contents: prompt,
            config: {
                temperature: 0.8, // 更高温度增加创意性
            }
        });
        return response.text || "";
    }, [imageModel]);

    // 多模态图片分析（用于图片转库功能）
    const analyzeImages = useCallback(async (images: { base64: string; mimeType: string }[], prompt: string): Promise<string> => {
        const ai = getAiInstance();

        // 构建多模态 parts：先是所有图片，最后是文本提示
        const parts: Array<{ inlineData: { mimeType: string; data: string } } | { text: string }> = [];

        // 添加所有图片
        for (const img of images) {
            parts.push({
                inlineData: {
                    mimeType: img.mimeType,
                    data: img.base64,
                },
            });
        }

        // 添加文本提示
        parts.push({ text: prompt });

        const response = await ai.models.generateContent({
            model: imageModel || 'gemini-2.0-flash',
            contents: { parts },
            config: {
                temperature: 0.7,
            }
        });

        return response.text || "";
    }, [imageModel]);

    // 无图模式：添加文字卡片
    const addTextCard = useCallback(() => {
        setTextCards(prev => [...prev, {
            id: uuidv4(),
            topic: '',
            results: [],
            status: 'idle'
        }]);
    }, []);

    // 无图模式：更新文字卡片主题
    const updateTextCardTopic = useCallback((id: string, topic: string) => {
        setTextCards(prev => prev.map(card =>
            card.id === id ? { ...card, topic } : card
        ));
    }, []);

    // 无图模式：删除文字卡片
    const deleteTextCard = useCallback((id: string) => {
        setTextCards(prev => prev.filter(card => card.id !== id));
    }, []);

    // 无图模式：清空所有卡片
    const clearAllTextCards = useCallback(() => {
        if (textCards.length > 0) {
            showConfirm(`确定清空所有 ${textCards.length} 个卡片吗？`, () => {
                setTextCards([]);
                setConfirmModal({ show: false, message: '', onConfirm: () => { } });
            });
        }
    }, [textCards.length, showConfirm]);

    // 无图模式：解析Google Sheets格式（支持单元格内换行）
    const parseGoogleSheetsCells = (text: string): string[] => {
        const cells: string[] = [];
        let current = '';
        let inQuotes = false;

        for (let i = 0; i < text.length; i++) {
            const char = text[i];
            const nextChar = text[i + 1];

            if (char === '"') {
                if (inQuotes && nextChar === '"') {
                    // 转义的引号 ""
                    current += '"';
                    i++;
                } else {
                    // 切换引号状态
                    inQuotes = !inQuotes;
                }
            } else if (char === '\t' && !inQuotes) {
                // Tab 分隔符（不在引号内）= 单元格分隔
                if (current.trim()) {
                    // 清理单元格内的换行，合并成一个整体
                    const cleaned = current.trim().replace(/[\r\n]+/g, ' ').trim();
                    if (cleaned) {
                        cells.push(cleaned);
                    }
                }
                current = '';
            } else if ((char === '\n' || char === '\r') && !inQuotes) {
                // 换行分隔符（不在引号内）= 行分隔
                if (char === '\r' && nextChar === '\n') {
                    i++; // 跳过 \r\n 中的 \n
                }
                if (current.trim()) {
                    // 清理单元格内的换行，合并成一个整体
                    const cleaned = current.trim().replace(/[\r\n]+/g, ' ').trim();
                    if (cleaned) {
                        cells.push(cleaned);
                    }
                }
                current = '';
            } else {
                current += char;
            }
        }

        // 添加最后一个单元格
        if (current.trim()) {
            const cleaned = current.trim().replace(/[\r\n]+/g, ' ').trim();
            if (cleaned) {
                cells.push(cleaned);
            }
        }

        return cells;
    };

    // 无图模式：批量导入（支持Google Sheets格式和普通换行）
    const handleBulkImport = useCallback(() => {
        // 检测是否是Google Sheets格式：
        // 1. 包含Tab分隔符（多列）
        // 2. 或者以双引号开头/包含换行+双引号（单列，单元格内有换行）
        const hasTabSeparator = bulkImportText.includes('\t');
        const hasQuotedContent = /^"|"\n|"\r/.test(bulkImportText);
        const isGoogleSheetsFormat = hasTabSeparator || hasQuotedContent;

        let topics: string[];

        if (isGoogleSheetsFormat) {
            // Google Sheets格式：使用专门的解析器
            topics = parseGoogleSheetsCells(bulkImportText);
        } else {
            // 普通格式：简单按行分割
            topics = bulkImportText
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0);
        }

        if (topics.length === 0) {
            showToast('请输入至少一个主题');
            return;
        }

        const newCards = topics.map(topic => ({
            id: uuidv4(),
            topic,
            results: [] as string[],
            status: 'idle' as const
        }));

        setTextCards(prev => [...prev, ...newCards]);
        setBulkImportText('');
        setShowBulkImportModal(false);
        showToast(`已添加 ${topics.length} 个主题卡片`);
    }, [bulkImportText]);

    // 无图模式：直接粘贴处理（支持Google Sheets格式）
    const handleNoImagePaste = useCallback((e: React.ClipboardEvent | ClipboardEvent) => {
        const text = e.clipboardData?.getData('text/plain');
        if (!text || !text.trim()) return;

        // 检测是否包含Tab分隔符（Google Sheets格式）
        const hasTabSeparator = text.includes('\t');

        let topics: string[];

        if (hasTabSeparator) {
            // Google Sheets格式：使用专门的解析器
            topics = parseGoogleSheetsCells(text);
        } else {
            // 普通格式：简单按行分割
            topics = text
                .split(/\r?\n/)
                .map(line => line.trim())
                .filter(line => line.length > 0);
        }

        if (topics.length === 0) return;

        const newCards = topics.map(topic => ({
            id: uuidv4(),
            topic,
            results: [] as string[],
            status: 'idle' as const
        }));

        setTextCards(prev => [...prev, ...newCards]);

        // 显示提示
        const format = hasTabSeparator ? 'Google表格' : '普通文本';
        showToast(`已从${format}粘贴添加 ${topics.length} 个主题卡片`);
    }, []);

    // 无图模式：全局粘贴监听
    useEffect(() => {
        if (!noImageMode || workMode !== 'creative') return;

        const handleGlobalPaste = (e: ClipboardEvent) => {
            // 如果焦点在输入框内，不处理
            const activeElement = document.activeElement;
            if (activeElement && (activeElement.tagName === 'INPUT' || activeElement.tagName === 'TEXTAREA')) {
                return;
            }

            // 如果焦点在弹窗/对话框内，不处理（避免干扰高级设置等弹窗的粘贴操作）
            if (activeElement && activeElement.closest('[role="dialog"], .modal, [data-modal], .fixed.inset-0')) {
                return;
            }

            handleNoImagePaste(e);
        };

        document.addEventListener('paste', handleGlobalPaste);
        return () => document.removeEventListener('paste', handleGlobalPaste);
    }, [noImageMode, workMode, handleNoImagePaste]);


    const runNoImageBatchInnovation = async () => {
        const cardsToProcess = textCards.filter(card => card.topic.trim() && card.status !== 'processing');
        if (cardsToProcess.length === 0) {
            showToast('请至少输入一个主题');
            return;
        }

        // 获取基础指令：快捷模式下优先使用配套指令，否则使用默认预设
        const userInput = prompt.trim(); // 用户输入的内容
        let baseInstruction: string;
        if (workMode === 'quick') {
            const config = randomLibraryConfigRef.current;
            const activeSheet = config.activeSourceSheet || '';
            const linkedInstruction = config.linkedInstructions?.[activeSheet];
            if (linkedInstruction && linkedInstruction.trim()) {
                baseInstruction = linkedInstruction.trim();
                console.log('[无图快捷模式] 使用配套创新指令:', { activeSheet });
            } else {
                // 没有配套指令时，根据随机库是否启用来自动判断使用哪个预设
                const isRandomLibEnabled = config.enabled &&
                    config.libraries.some(lib => lib.enabled && lib.values.length > 0);
                const presetType = isRandomLibEnabled ? 'withRandomLib' : 'standard';
                const presets = DEFAULT_QUICK_INNOVATION_PRESETS;
                baseInstruction = presets[presetType] || DEFAULT_QUICK_INNOVATION_PRESETS[presetType];
                console.log('[无图快捷模式] 使用默认预设:', { presetType, isRandomLibEnabled });
            }
        } else {
            baseInstruction = prompt || DEFAULT_CREATIVE_INSTRUCTION;
        }

        // 构建有效指令（基础指令 + 用户输入）
        let effectivePrompt = baseInstruction;
        if (userInput && workMode === 'quick') {
            // 快捷模式下，如果用户有输入，添加为特别要求
            effectivePrompt = `${baseInstruction}\n\n${USER_REQUIREMENT_TRANSITION}\n${userInput}`;
        }

        setIsGeneratingNoImage(true);

        // === 批次处理模式（cardBatchSize > 1）：多个卡片合并成一次AI请求 ===
        if (cardBatchSize > 1 && cardsToProcess.length > 1 && !randomLibraryConfigRef.current.enabled) {
            // 批次模式只在不使用随机库时生效（随机库模式已经有批量合并了）
            console.log(`[无图批次模式] 开始批次处理，每批 ${cardBatchSize} 个卡片`);

            // 设置所有卡片为处理中
            setTextCards(prev => prev.map(c =>
                cardsToProcess.find(p => p.id === c.id)
                    ? { ...c, status: 'processing', results: [] }
                    : c
            ));

            // 分批处理
            for (let i = 0; i < cardsToProcess.length; i += cardBatchSize) {
                const batchCards = cardsToProcess.slice(i, i + cardBatchSize);
                const count = creativeCount || 5;

                try {
                    // 构建批量提示词
                    const topicsList = batchCards.map((card, idx) => `[${idx + 1}] ${card.topic}`).join('\n');
                    const priorityInstruction = getPriorityInstruction(true, false);

                    const batchPrompt = `${effectivePrompt}

${priorityInstruction}

请为以下每个主题分别生成 ${count} 个不同的AI图像生成描述词（英文）：

${topicsList}

【输出要求】
- 对于每个主题，使用 "=== [编号] ===" 分隔不同主题的结果
- 对于同一主题的多个变体，使用 --- 分隔
- 每个变体是一个完整的描述词，不要有编号或标题
- 格式示例：
=== [1] ===
描述词1
---
描述词2
---
描述词3
=== [2] ===
描述词1
---
描述词2
---
描述词3`;

                    const batchResult = await generateText(batchPrompt);

                    // 解析批量结果
                    const topicSections = batchResult.split(/===\s*\[(\d+)\]\s*===/).filter(s => s.trim());

                    for (let j = 0; j < batchCards.length; j++) {
                        const card = batchCards[j];
                        // 找到对应的section
                        const sectionIdx = topicSections.findIndex((s, idx) => idx % 2 === 0 && s.trim() === String(j + 1));
                        const sectionContent = sectionIdx >= 0 && sectionIdx + 1 < topicSections.length
                            ? topicSections[sectionIdx + 1]
                            : topicSections[j * 2 + 1] || '';

                        const results = sectionContent
                            .split(/---+/)
                            .map(r => r.trim())
                            .filter(r => r.length > 0 && !r.match(/^\[?\d+\]?$/));

                        if (results.length > 0) {
                            setTextCards(prev => prev.map(c =>
                                c.id === card.id ? { ...c, status: 'done', results } : c
                            ));
                        } else {
                            setTextCards(prev => prev.map(c =>
                                c.id === card.id ? { ...c, status: 'error', results: ['批次解析失败'] } : c
                            ));
                        }
                    }
                } catch (error) {
                    console.error('[无图批次模式] 处理失败:', error);
                    // 该批次所有卡片标记为失败
                    for (const card of batchCards) {
                        setTextCards(prev => prev.map(c =>
                            c.id === card.id ? { ...c, status: 'error', results: ['批次处理失败'] } : c
                        ));
                    }
                }

                // 批次之间延迟避免 API 限流
                if (i + cardBatchSize < cardsToProcess.length) {
                    await new Promise(resolve => setTimeout(resolve, 300));
                }
            }

            setIsGeneratingNoImage(false);
            return;
        }

        // === 单条处理模式（cardBatchSize === 1 或使用随机库）===
        for (const card of cardsToProcess) {
            // 更新状态为处理中
            setTextCards(prev => prev.map(c =>
                c.id === card.id ? { ...c, status: 'processing', results: [] } : c
            ));

            try {
                // 检查是否启用随机库
                const useRandomLibrary = randomLibraryConfigRef.current.enabled &&
                    randomLibraryConfigRef.current.libraries.filter(lib => lib.enabled && lib.values.length > 0).length > 0;

                const results: string[] = [];

                if (useRandomLibrary) {
                    // 随机库模式：根据设置生成多个组合
                    const combinations: string[] = [];

                    if (randomLibraryConfigRef.current.combinationMode === 'cartesian') {
                        // 笛卡尔积模式
                        const cartesian = generateCartesianCombinations(randomLibraryConfigRef.current);
                        combinations.push(...cartesian);
                    } else {
                        // 随机模式：按创新个数生成
                        const count = creativeCount || 5;
                        const uniqueCombos = generateMultipleUniqueCombinations(randomLibraryConfigRef.current, count);
                        combinations.push(...uniqueCombos);
                    }

                    const transitionInstruction = DEFAULT_TRANSITION_INSTRUCTION;
                    // 无图模式下，card.topic就是用户要求
                    const hasUserInput = true; // 无图模式下总有用户要求（topic）

                    // 批量模式：把所有组合合并成一次请求，节省token
                    if (combinations.length > 1) {
                        const priorityInstruction = getPriorityInstruction(hasUserInput, true);
                        // 构建批量提示词
                        const combinationsList = combinations.map((combo, idx) => `【组合${idx + 1}】\n${combo}`).join('\n\n');
                        const batchPrompt = `${effectivePrompt}

${transitionInstruction}

下面有 ${combinations.length} 个不同的创意组合，请针对每个组合生成一个对应的描述词：

${combinationsList}

${priorityInstruction}

【用户特别要求】
${card.topic}

【输出要求】
- 使用 --- 作为分隔符，分隔不同组合的结果
- 每个组合输出一个完整的图像生成描述词（英文）
- 不要输出组合编号、标题或任何解释
- 共 ${combinations.length} 个结果，以 --- 分隔
- 格式示例：
描述词1内容
---
描述词2内容
---
描述词3内容`;

                        const batchResult = await generateText(batchPrompt);
                        // 解析批量结果
                        const parsedResults = batchResult
                            .split(/---+/)
                            .map(r => r.trim())
                            .filter(r => r.length > 0);

                        results.push(...parsedResults);

                        // 更新结果
                        setTextCards(prev => prev.map(c =>
                            c.id === card.id ? { ...c, results: [...results] } : c
                        ));
                    } else if (combinations.length === 1) {
                        // 单个组合：正常处理
                        const combination = combinations[0];
                        const priorityInstruction = getPriorityInstruction(hasUserInput, true);
                        const aiPrompt = `${effectivePrompt}

${transitionInstruction}
${combination}

${priorityInstruction}

【用户特别要求】
${card.topic}

【输出要求】
- 直接输出完整的图像生成描述词（英文）
- 以基础主题为核心，融入创意组合的风格/场景
- 描述应该包含画面主体、风格、光影、色彩、氛围等要素
- 不要输出任何解释、标题或编号
- 可以直接用于AI图像生成`;

                        const result = await generateText(aiPrompt);
                        results.push(result.trim());

                        setTextCards(prev => prev.map(c =>
                            c.id === card.id ? { ...c, results: [...results] } : c
                        ));
                    }
                } else {
                    // 纯主题模式：批量生成多个变体（节省token）
                    const count = creativeCount || 5;
                    // 无图模式下，card.topic就是用户要求
                    const priorityInstruction = getPriorityInstruction(true, false);

                    if (count > 1) {
                        // 批量模式：一次请求生成所有变体
                        const batchPrompt = `${effectivePrompt}

${priorityInstruction}

请根据以下用户要求，生成 ${count} 个完全不同的AI图像生成描述词（英文）：

【用户特别要求】
${card.topic}

【输出要求】
- 使用 --- 作为分隔符，分隔不同变体
- 每个变体输出一个完整的图像生成描述词（英文）
- 每个变体要有不同的创意角度和风格
- 描述应该包含画面主体、风格、光影、色彩、氛围等要素
- 不要输出编号、标题或任何解释
- 共 ${count} 个结果，以 --- 分隔
- 格式示例：
描述词1内容
---
描述词2内容
---
描述词3内容`;

                        const batchResult = await generateText(batchPrompt);
                        // 解析批量结果
                        const parsedResults = batchResult
                            .split(/---+/)
                            .map(r => r.trim())
                            .filter(r => r.length > 0);

                        results.push(...parsedResults);

                        setTextCards(prev => prev.map(c =>
                            c.id === card.id ? { ...c, results: [...results] } : c
                        ));
                    } else {
                        // 单个：正常处理
                        const aiPrompt = `${effectivePrompt}

${priorityInstruction}

请根据以下用户要求，生成一个完整、专业、有创意的AI图像生成描述词（英文）：

【用户特别要求】
${card.topic}

【输出要求】
- 直接输出完整的图像生成描述词（英文）
- 描述应该包含画面主体、风格、光影、色彩、氛围等要素
- 不要输出任何解释、标题或编号
- 可以直接用于AI图像生成`;

                        const result = await generateText(aiPrompt);
                        results.push(result.trim());

                        setTextCards(prev => prev.map(c =>
                            c.id === card.id ? { ...c, results: [...results] } : c
                        ));
                    }
                }

                setTextCards(prev => prev.map(c =>
                    c.id === card.id ? { ...c, status: 'done', results } : c
                ));
            } catch (error) {
                console.error('无图创新失败:', error);
                setTextCards(prev => prev.map(c =>
                    c.id === card.id ? { ...c, status: 'error', results: ['生成失败'] } : c
                ));
            }
        }

        setIsGeneratingNoImage(false);
    };

    // 单个卡片重新创新（清空并重新生成所有结果）
    const regenerateTextCard = async (cardId: string) => {
        const card = textCards.find(c => c.id === cardId);
        if (!card || !card.topic.trim()) return;

        // 清除该卡片所有结果的翻译缓存（内容即将重新生成）
        setTranslationCache(prev => {
            const next = { ...prev };
            for (const key of Object.keys(next)) {
                if (key.startsWith(`${cardId}-`)) {
                    delete next[key];
                }
            }
            return next;
        });

        setTextCards(prev => prev.map(c =>
            c.id === cardId ? { ...c, status: 'processing', results: [] } : c
        ));

        try {
            const useRandomLibrary = randomLibraryConfigRef.current.enabled &&
                randomLibraryConfigRef.current.libraries.filter(lib => lib.enabled && lib.values.length > 0).length > 0;

            const results: string[] = [];

            if (useRandomLibrary) {
                const combinations: string[] = [];
                if (randomLibraryConfigRef.current.combinationMode === 'cartesian') {
                    const cartesian = generateCartesianCombinations(randomLibraryConfigRef.current);
                    combinations.push(...cartesian);
                } else {
                    const count = creativeCount || 5;
                    const uniqueCombos = generateMultipleUniqueCombinations(randomLibraryConfigRef.current, count);
                    combinations.push(...uniqueCombos);
                }

                const transitionInstruction = DEFAULT_TRANSITION_INSTRUCTION;

                for (const combination of combinations) {
                    const prompt = `${innovationInstruction}

${transitionInstruction}

基础主题：${card.topic}

创意组合：${combination}

【输出要求】
- 直接输出完整的图像生成描述词（英文）
- 以基础主题为核心，融入创意组合的风格/场景
- 描述应该包含画面主体、风格、光影、色彩、氛围等要素
- 不要输出任何解释、标题或编号
- 可以直接用于AI图像生成`;

                    const result = await generateText(prompt);
                    results.push(result.trim());
                    setTextCards(prev => prev.map(c =>
                        c.id === cardId ? { ...c, results: [...results] } : c
                    ));
                }
            } else {
                const count = creativeCount || 5;
                for (let i = 0; i < count; i++) {
                    const prompt = `${innovationInstruction}

请根据以下主题，生成一个完整、专业、有创意的AI图像生成描述词（英文）：

主题：${card.topic}

【输出要求】
- 直接输出完整的图像生成描述词（英文）
- 每次生成要有不同的创意角度和风格
- 描述应该包含画面主体、风格、光影、色彩、氛围等要素
- 这是第 ${i + 1}/${count} 个变体，请确保与其他变体有明显差异
- 不要输出任何解释、标题或编号
- 可以直接用于AI图像生成`;

                    const result = await generateText(prompt);
                    results.push(result.trim());
                    setTextCards(prev => prev.map(c =>
                        c.id === cardId ? { ...c, results: [...results] } : c
                    ));
                }
            }

            setTextCards(prev => prev.map(c =>
                c.id === cardId ? { ...c, status: 'done', results } : c
            ));
        } catch (error) {
            console.error('重新创新失败:', error);
            setTextCards(prev => prev.map(c =>
                c.id === cardId ? { ...c, status: 'error' } : c
            ));
        }
    };

    // 单个结果重试（替换指定索引的结果）
    const retryTextCardResult = async (cardId: string, resultIndex: number) => {
        const card = textCards.find(c => c.id === cardId);
        if (!card || !card.topic.trim()) return;

        // 清除该条结果的翻译缓存（内容即将重新生成）
        const retryCacheKey = `${cardId}-${resultIndex}`;
        setTranslationCache(prev => {
            const next = { ...prev };
            delete next[retryCacheKey];
            return next;
        });

        // 标记该卡片正在处理
        setTextCards(prev => prev.map(c =>
            c.id === cardId ? { ...c, status: 'processing' } : c
        ));

        try {
            const useRandomLibrary = randomLibraryConfigRef.current.enabled &&
                randomLibraryConfigRef.current.libraries.filter(lib => lib.enabled && lib.values.length > 0).length > 0;

            let retryPrompt = '';
            if (useRandomLibrary) {
                const combination = generateRandomCombination(randomLibraryConfigRef.current);
                const transitionInstruction = DEFAULT_TRANSITION_INSTRUCTION;

                retryPrompt = `${prompt}

${transitionInstruction}

基础主题：${card.topic}

创意组合：${combination}

【输出要求】
- 直接输出完整的图像生成描述词（英文）
- 以基础主题为核心，融入创意组合的风格/场景
- 描述应该包含画面主体、风格、光影、色彩、氛围等要素
- 不要输出任何解释、标题或编号
- 可以直接用于AI图像生成`;
            } else {
                retryPrompt = `${prompt}

请根据以下主题，生成一个完整、专业、有创意的AI图像生成描述词（英文）：

主题：${card.topic}

【输出要求】
- 直接输出完整的图像生成描述词（英文）
- 描述应该包含画面主体、风格、光影、色彩、氛围等要素
- 请生成与之前不同的创意变体
- 不要输出任何解释、标题或编号
- 可以直接用于AI图像生成`;
            }

            const result = await generateText(retryPrompt);

            setTextCards(prev => prev.map(c => {
                if (c.id === cardId) {
                    const newResults = [...c.results];
                    newResults[resultIndex] = result.trim();
                    return { ...c, status: 'done', results: newResults };
                }
                return c;
            }));
        } catch (error) {
            console.error('重试失败:', error);
            setTextCards(prev => prev.map(c =>
                c.id === cardId ? { ...c, status: 'done' } : c
            ));
            showToast('重试失败');
        }
    };

    // 追加生成更多结果
    const appendTextCardResults = async (cardId: string, count: number = 1) => {
        const card = textCards.find(c => c.id === cardId);
        if (!card || !card.topic.trim()) return;

        setTextCards(prev => prev.map(c =>
            c.id === cardId ? { ...c, status: 'processing' } : c
        ));

        try {
            const useRandomLibrary = randomLibraryConfigRef.current.enabled &&
                randomLibraryConfigRef.current.libraries.filter(lib => lib.enabled && lib.values.length > 0).length > 0;

            const newResults: string[] = [];

            for (let i = 0; i < count; i++) {
                let appendPrompt = '';
                if (useRandomLibrary) {
                    const combination = generateRandomCombination(randomLibraryConfigRef.current);
                    const transitionInstruction = DEFAULT_TRANSITION_INSTRUCTION;

                    appendPrompt = `${prompt}

${transitionInstruction}

基础主题：${card.topic}

创意组合：${combination}

【输出要求】
- 直接输出完整的图像生成描述词（英文）
- 以基础主题为核心，融入创意组合的风格/场景
- 描述应该包含画面主体、风格、光影、色彩、氛围等要素
- 不要输出任何解释、标题或编号
- 可以直接用于AI图像生成`;
                } else {
                    appendPrompt = `${prompt}

请根据以下主题，生成一个完整、专业、有创意的AI图像生成描述词（英文）：

主题：${card.topic}

【输出要求】
- 直接输出完整的图像生成描述词（英文）
- 描述应该包含画面主体、风格、光影、色彩、氛围等要素
- 请生成与现有结果不同的新创意变体
- 不要输出任何解释、标题或编号
- 可以直接用于AI图像生成`;
                }

                const result = await generateText(appendPrompt);
                newResults.push(result.trim());

                setTextCards(prev => prev.map(c => {
                    if (c.id === cardId) {
                        return { ...c, results: [...c.results, ...newResults] };
                    }
                    return c;
                }));
            }

            setTextCards(prev => prev.map(c =>
                c.id === cardId ? { ...c, status: 'done' } : c
            ));
        } catch (error) {
            console.error('追加生成失败:', error);
            setTextCards(prev => prev.map(c =>
                c.id === cardId ? { ...c, status: 'done' } : c
            ));
            showToast('追加生成失败');
        }
    };

    // 批量重试所有失败的卡片
    const retryAllFailedCards = async () => {
        const failedCards = textCards.filter(c => c.status === 'error');
        if (failedCards.length === 0) {
            showToast('没有失败的卡片需要重试');
            return;
        }

        setIsGeneratingNoImage(true);
        let successCount = 0;

        for (const card of failedCards) {
            try {
                await regenerateTextCard(card.id);
                successCount++;
            } catch (error) {
                console.error(`重试卡片 ${card.id} 失败:`, error);
            }
        }

        setIsGeneratingNoImage(false);
        showToast(`已重试 ${failedCards.length} 个失败卡片，成功 ${successCount} 个`);
    };

    // 重新创新所有卡片
    const regenerateAllTextCards = async () => {
        const cardsToProcess = textCards.filter(c => c.topic.trim());
        if (cardsToProcess.length === 0) return;

        setIsGeneratingNoImage(true);

        for (const card of cardsToProcess) {
            await regenerateTextCard(card.id);
        }

        setIsGeneratingNoImage(false);
        showToast(`已重新创新 ${cardsToProcess.length} 个卡片！`);
    };

    // 翻译单条结果
    const translateResult = async (cardId: string, resultIndex: number, text: string) => {
        const cacheKey = `${cardId}-${resultIndex}`;

        // 如果已有翻译，直接返回
        if (translationCache[cacheKey]) {
            return;
        }

        // 标记正在翻译
        setTranslatingItems(prev => new Set(prev).add(cacheKey));

        try {
            const prompt = `请将以下英文翻译成中文，只输出翻译结果，不要有任何解释：\n\n${text}`;
            const translation = await generateText(prompt);

            if (translation && translation.trim()) {
                setTranslationCache(prev => ({
                    ...prev,
                    [cacheKey]: translation.trim()
                }));
            } else {
                showToast('翻译结果为空');
            }
        } catch (error) {
            console.error('翻译失败:', error);
            showToast('翻译失败: ' + (error instanceof Error ? error.message : '未知错误'));
        } finally {
            setTranslatingItems(prev => {
                const next = new Set(prev);
                next.delete(cacheKey);
                return next;
            });
        }
    };

    // 批量翻译卡片的所有结果
    const translateAllResults = async (cardId: string, results: string[]) => {
        let translatedCount = 0;

        for (let i = 0; i < results.length; i++) {
            const cacheKey = `${cardId}-${i}`;

            // 直接检查localStorage中是否已有翻译
            try {
                const cachedData = localStorage.getItem('ai-image-recognition-translations');
                const cached = cachedData ? JSON.parse(cachedData) : {};
                if (cached[cacheKey]) {
                    continue; // 已翻译过，跳过
                }
            } catch (e) {
                // ignore
            }

            // 标记正在翻译
            setTranslatingItems(prev => new Set(prev).add(cacheKey));

            try {
                const prompt = `请将以下英文翻译成中文，只输出翻译结果，不要有任何解释：\n\n${results[i]}`;
                const translation = await generateText(prompt);

                if (translation && translation.trim()) {
                    setTranslationCache(prev => ({
                        ...prev,
                        [cacheKey]: translation.trim()
                    }));
                    translatedCount++;
                }
            } catch (error) {
                console.error('翻译失败:', error);
            } finally {
                setTranslatingItems(prev => {
                    const next = new Set(prev);
                    next.delete(cacheKey);
                    return next;
                });
            }
        }

        showToast(`翻译完成，共翻译 ${translatedCount} 条`);
    };

    const addFromUrls = async (urls: { type: 'url' | 'formula', content: string, url: string }[]) => {
        if (urls.length === 0) return;

        const tokenToUse = gyazoToken || DEFAULT_GYAZO_TOKEN;

        // 立即创建所有项目并显示（使用原始URL先显示图片）
        const pendingItems = urls.map(p => {
            const id = uuidv4();
            // 检测是否是需要代理的链接（如 Facebook CDN）
            const needsRehost = isLikelyHotlinkBlocked(p.url);
            return {
                item: {
                    id,
                    sourceType: p.type,
                    originalInput: p.content,
                    imageUrl: p.url,  // 先用原始URL显示图片
                    fetchUrl: p.url,
                    status: 'loading',  // 表示正在准备base64
                    result: '',
                    chatHistory: [],
                    isUploadingToGyazo: needsRehost  // 如果需要代理，自动上传到 Gyazo
                } as ImageItem,
                fetchUrl: p.url,
                needsRehost
            };
        });

        const newItems = pendingItems.map(p => p.item);
        setImages(prev => [...newItems, ...prev]); // 新图片添加到顶部

        // Fetch images with concurrency (limit 5)
        await processWithConcurrency(pendingItems, 5, async ({ item, fetchUrl, needsRehost }: { item: ImageItem, fetchUrl: string, needsRehost: boolean }) => {
            if (!fetchUrl) return;

            try {
                const { blob, mimeType } = await fetchImageBlob(fetchUrl);
                const blobUrl = URL.createObjectURL(blob);
                const base64 = await convertBlobToBase64(blob);

                // 如果是需要代理的链接，自动上传到 Gyazo
                if (needsRehost) {
                    // 将 blob 转换为 File 对象以便上传
                    const file = new File([blob], 'image.jpg', { type: mimeType || 'image/jpeg' });

                    try {
                        const gyazoUrl = await uploadToGyazo(file, tokenToUse);
                        if (gyazoUrl) {
                            // 上传成功，更新图片信息
                            setImages(prev => prev.map(img => {
                                if (img.id === item.id) {
                                    return {
                                        ...img,
                                        imageUrl: blobUrl,
                                        base64Data: base64,
                                        mimeType: mimeType,
                                        status: 'idle',
                                        gyazoUrl: gyazoUrl,
                                        originalInput: `=IMAGE("${gyazoUrl}")`,  // 替换为 Gyazo 链接
                                        isUploadingToGyazo: false
                                    };
                                }
                                return img;
                            }));
                            return;
                        }
                    } catch (uploadError) {
                        console.warn('Gyazo upload failed, keeping original URL:', uploadError);
                    }
                }

                // 正常更新或 Gyazo 上传失败时保留原链接
                setImages(prev => prev.map(img => {
                    if (img.id === item.id) {
                        return {
                            ...img,
                            imageUrl: blobUrl,
                            base64Data: base64,
                            mimeType: mimeType,
                            status: 'idle',
                            isUploadingToGyazo: false
                        };
                    }
                    return img;
                }));
            } catch (error: any) {
                setImages(prev => prev.map(img => {
                    if (img.id === item.id) {
                        return {
                            ...img,
                            status: 'error',
                            errorMsg: error.message || '图片下载失败',
                            isUploadingToGyazo: false
                        };
                    }
                    return img;
                }));
            }
        });
    };


    const dropzoneRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const didAutoFocusRef = useRef(false);

    // Auto-focus container on mount to enable paste without extra click
    useEffect(() => {
        // Use requestAnimationFrame to ensure DOM is fully rendered
        const focusContainer = () => {
            if (didAutoFocusRef.current) return;
            const active = document.activeElement as HTMLElement | null;
            // Don't steal focus from inputs/textareas
            if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
                return;
            }
            // Focus the main container to receive paste events
            containerRef.current?.focus();
            didAutoFocusRef.current = true;
        };

        // Double RAF to ensure rendering is complete
        requestAnimationFrame(() => {
            requestAnimationFrame(focusContainer);
        });
    }, []);

    // Handle Global Paste
    // 使用 capture phase 确保此监听器在其他监听器之前运行
    useEffect(() => {
        const handleGlobalPaste = (e: ClipboardEvent) => {
            // =============================================
            // 安全检查：确保只有当本组件可见且粘贴目标在本组件内时才处理
            // =============================================
            const container = containerRef.current;
            if (!container) return;

            // 检查组件是否可见（不是隐藏的）
            const rect = container.getBoundingClientRect();
            const isVisible = rect.width > 0 && rect.height > 0;
            if (!isVisible) return;

            // 检查粘贴目标是否在本组件容器内
            const pasteTarget = e.target as Node;
            const isInContainer = container.contains(pasteTarget);

            // 只有当粘贴目标在本组件容器内时才处理
            if (!isInContainer) return;

            // 创新模式下：若选中了卡片，粘贴应进入卡片；否则允许新建卡片

            // 如果粘贴目标是普通的 INPUT 或 TEXTAREA（非隐藏的粘贴捕获元素），允许正常粘贴
            const targetElement = e.target as HTMLElement;
            const isHiddenPasteCapture = targetElement.getAttribute('aria-hidden') === 'true';
            if ((targetElement.tagName === 'INPUT' || targetElement.tagName === 'TEXTAREA') && !isHiddenPasteCapture) {
                // 让普通输入框正常接收粘贴事件
                return;
            }
            // =============================================

            let handled = false;

            if (e.clipboardData) {
                // ===== 先检查文本内容，判断是否应该处理 =====
                const html = e.clipboardData.getData('text/html');
                const plainText = e.clipboardData.getData('text/plain');

                const hasImageFormula = !!plainText && plainText.includes('=IMAGE');
                const hasHttp = !!plainText && plainText.includes('http');
                const hasImgTag = !!html && html.includes('<img');
                const shouldHandleAsImageContent = hasImageFormula || hasHttp || hasImgTag;

                const target = e.target as HTMLElement;
                const isHiddenPasteCapture = target.getAttribute('aria-hidden') === 'true';

                // Skip if pasting into visible input/textarea and content doesn't look like image data
                if ((target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !shouldHandleAsImageContent && !isHiddenPasteCapture) {
                    return;
                }

                // ===== 如果有纯文本但不包含 =IMAGE/http，说明是普通文本粘贴 =====
                // Google Sheets 复制纯文本时会同时包含图片（单元格截图），但我们应该优先处理文本
                // 只有当没有有意义的文本时，才处理图片
                const hasMeaningfulText = plainText && plainText.trim().length > 0;

                // 1. Files (真正的文件粘贴，如从文件管理器复制的图片)
                if (e.clipboardData.files.length > 0) {
                    // 如果剪贴板有文件但也有不包含链接的纯文本，可能是 Google Sheets 复制
                    // 检查是否是真正的图片粘贴还是带截图的文本粘贴
                    if (hasMeaningfulText && !shouldHandleAsImageContent) {
                        // 有纯文本但没有链接/公式，让浏览器正常处理
                        return;
                    }
                    e.preventDefault();
                    const files = Array.from(e.clipboardData.files);
                    const canAddToSelected =
                        workModeRef.current === 'creative' &&
                        !!selectedCardIdRef.current &&
                        !!handleAddFusionImageRef.current;
                    if (canAddToSelected) {
                        void (async () => {
                            for (const file of files) {
                                if (file.type.startsWith('image/')) {
                                    await handleAddFusionImageRef.current!(selectedCardIdRef.current!, file);
                                }
                            }
                        })();
                    } else {
                        handleFilesRef.current(files);
                    }
                    handled = true;
                    return;
                }

                // Some browsers only expose pasted images via clipboard items
                const items = Array.from(e.clipboardData.items || []);
                const imageItems = items.filter(item => item.type.startsWith('image/'));
                if (imageItems.length > 0) {
                    // 同样的检查：如果有纯文本但没有链接，说明图片只是附带的截图
                    if (hasMeaningfulText && !shouldHandleAsImageContent) {
                        // 有纯文本但没有链接/公式，让浏览器正常处理
                        return;
                    }
                    const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
                    if (files.length > 0) {
                        e.preventDefault();
                        const canAddToSelected =
                            workModeRef.current === 'creative' &&
                            !!selectedCardIdRef.current &&
                            !!handleAddFusionImageRef.current;
                        if (canAddToSelected) {
                            void (async () => {
                                for (const file of files) {
                                    await handleAddFusionImageRef.current!(selectedCardIdRef.current!, file);
                                }
                            })();
                        } else {
                            handleFilesRef.current(files);
                        }
                        handled = true;
                        return;
                    }
                }

                // 2. HTML (Google Sheets cells copy as HTML containing <img> tags)


                // 优先检查纯文本中是否有 =IMAGE() 公式
                // 因为从 Google Sheets 复制单元格时，纯文本中的 URL 才是原始可用的 URL
                // HTML 中的 URL 通常是 Google 代理过的，无法直接下载（特别是 Facebook CDN 链接）
                if (plainText && plainText.includes('=IMAGE')) {
                    e.preventDefault();
                    const parsed = parsePasteInput(plainText);
                    addFromUrlsRef.current(parsed);
                    handled = true;
                    return;
                }

                if (html) {
                    const extractedUrls = extractUrlsFromHtml(html);
                    if (extractedUrls.length > 0) {
                        e.preventDefault();

                        const textLines = plainText ? plainText.split(/\r?\n/).filter(line => line.trim() !== '') : [];

                        // 从纯文本中提取 =IMAGE() 公式里的 URL
                        const formulaRegex = /=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i;

                        // 先从所有纯文本行中提取公式 URL
                        const formulaUrls: string[] = [];
                        textLines.forEach(line => {
                            const match = line.match(formulaRegex);
                            if (match && match[1]) {
                                formulaUrls.push(match[1]);
                            }
                        });

                        const urlItems = extractedUrls.map(({ originalUrl, fetchUrl }, index) => {
                            // Try to match with plain text line (user might have copied formulas)
                            let originalContent = (index < textLines.length && textLines[index].trim()) ? textLines[index] : null;

                            // 优先使用从公式中提取的 URL
                            // 如果有对应的公式 URL，使用它；否则尝试从当前行的公式中提取
                            let actualFetchUrl = fetchUrl;

                            if (index < formulaUrls.length) {
                                // 使用对应位置的公式 URL
                                actualFetchUrl = formulaUrls[index];
                            } else if (originalContent) {
                                const formulaMatch = originalContent.match(formulaRegex);
                                if (formulaMatch && formulaMatch[1]) {
                                    actualFetchUrl = formulaMatch[1];
                                }
                            }

                            // If no plain text match, OR if the plain text is just the URL itself (not a formula)
                            // We construct an IMAGE formula using the ORIGINAL URL to ensure it pastes back correctly
                            if (!originalContent || !originalContent.includes('=IMAGE')) {
                                originalContent = `=IMAGE("${originalUrl}")`;
                            }

                            return {
                                type: 'url' as const,
                                content: originalContent,
                                url: actualFetchUrl  // Use the best URL for fetching
                            };
                        });

                        addFromUrlsRef.current(urlItems);
                        handled = true;
                        return;
                    }
                }

                // 3. Plain Text
                const text = e.clipboardData.getData('text');
                if (text && (text.includes('http') || text.includes('=IMAGE'))) {
                    e.preventDefault();
                    const parsed = parsePasteInput(text);
                    addFromUrlsRef.current(parsed);
                    handled = true;
                    return;
                }
            }

            if (!handled && navigator.clipboard?.read) {
                // Fallback: some environments don't expose files/items on clipboardData
                void (async () => {
                    try {
                        const items = await navigator.clipboard.read();
                        for (const item of items) {
                            const imageType = item.types.find(type => type.startsWith('image/'));
                            if (imageType) {
                                const blob = await item.getType(imageType);
                                const file = new File([blob], `pasted-image.${imageType.split('/')[1] || 'png'}`, { type: imageType });
                                const canAddToSelected =
                                    workModeRef.current === 'creative' &&
                                    !!selectedCardIdRef.current &&
                                    !!handleAddFusionImageRef.current;
                                if (canAddToSelected) {
                                    await handleAddFusionImageRef.current!(selectedCardIdRef.current!, file);
                                } else {
                                    handleFilesRef.current([file]);
                                }
                                return;
                            }
                        }
                        const text = await navigator.clipboard.readText();
                        if (text && (text.includes('http') || text.includes('=IMAGE'))) {
                            const parsed = parsePasteInput(text);
                            addFromUrlsRef.current(parsed);
                        }
                    } catch (err) {
                        console.warn('[Paste Fallback] Clipboard read failed:', err);
                    }
                })();
            }
        };
        // 使用 capture: true 确保在冒泡阶段的其他监听器之前运行
        window.addEventListener('paste', handleGlobalPaste, true);
        return () => {
            window.removeEventListener('paste', handleGlobalPaste, true);
        };
    }, []);

    const handleFiles = async (files: File[]) => {
        const tokenToUse = gyazoToken || DEFAULT_GYAZO_TOKEN;
        const shouldUpload = autoUploadGyazo;

        const fileProcessingPromises = files.map(async (file) => {
            if (!file.type.startsWith('image/')) return null;

            const blobUrl = URL.createObjectURL(file);
            const base64 = await convertBlobToBase64(file);
            const id = uuidv4();

            // 创建项目
            const item: ImageItem = {
                id,
                sourceType: 'file' as const,
                originalInput: file.name,
                imageUrl: blobUrl,
                base64Data: base64,
                mimeType: file.type,
                status: 'idle' as const,
                isUploadingToGyazo: shouldUpload,
                chatHistory: []
            };

            return { item, file };
        });

        const processed = (await Promise.all(fileProcessingPromises)).filter(Boolean) as { item: ImageItem, file: File }[];

        // 立即添加到列表
        setImages(prev => [...processed.map(p => p.item), ...prev]); // 新图片添加到顶部

        // 如果开启了自动上传，后台上传到 Gyazo 并追踪 Promise
        if (shouldUpload) {
            processed.forEach(({ item, file }) => {
                // 创建上传 Promise 并注册到追踪 Map
                const uploadPromise = (async (): Promise<string | null> => {
                    try {
                        const gyazoUrl = await uploadToGyazo(file, tokenToUse);
                        if (gyazoUrl) {
                            // 上传成功，更新 gyazoUrl 和 originalInput
                            setImages(prev => prev.map(img =>
                                img.id === item.id
                                    ? {
                                        ...img,
                                        gyazoUrl: gyazoUrl,
                                        originalInput: `=IMAGE("${gyazoUrl}")`,
                                        isUploadingToGyazo: false
                                    }
                                    : img
                            ));
                            return gyazoUrl;
                        } else {
                            // 上传失败
                            setImages(prev => prev.map(img =>
                                img.id === item.id
                                    ? { ...img, isUploadingToGyazo: false }
                                    : img
                            ));
                            return null;
                        }
                    } catch (error) {
                        console.error('Gyazo upload failed for', file.name, error);
                        setImages(prev => prev.map(img =>
                            img.id === item.id
                                ? { ...img, isUploadingToGyazo: false }
                                : img
                        ));
                        return null;
                    }
                })();

                // 注册到追踪 Map
                gyazoUploadPromisesRef.current.set(item.id, uploadPromise);
            });
        }
    };

    // Use refs to always have access to latest functions in event handlers
    const addFromUrlsRef = useRef(addFromUrls);
    const handleFilesRef = useRef(handleFiles);

    useEffect(() => {
        addFromUrlsRef.current = addFromUrls;
        handleFilesRef.current = handleFiles;
    });

    // 将旧的 innovationOutputs 转换为带对话能力的 innovationItems
    useEffect(() => {
        setImages(prev => prev.map(img => {
            if ((!img.innovationItems || img.innovationItems.length === 0) && img.innovationOutputs && img.innovationOutputs.length > 0) {
                const generatedItems: InnovationItem[] = img.innovationOutputs.map((text, idx) => ({
                    id: `legacy-${img.id}-${idx}`,
                    text,
                    chatHistory: [],
                    isChatOpen: false,
                    chatInput: '',
                    chatAttachments: [],
                    isChatLoading: false
                }));
                return { ...img, innovationItems: generatedItems };
            }
            return img;
        }));
    }, [setImages]);

    const handleTextPaste = async (text: string) => {
        const parsed = parsePasteInput(text);
        addFromUrls(parsed);
    };

    // Handle HTML paste from DropZone (Google Sheets cells)
    const handleHtmlPaste = async (urls: { originalUrl: string; fetchUrl: string }[]) => {
        const urlItems = urls.map(({ originalUrl, fetchUrl }) => ({
            type: 'url' as const,
            content: `=IMAGE("${originalUrl}")`,
            url: fetchUrl
        }));
        addFromUrls(urlItems);
    };

    const handleRetry = async (id: string) => {
        const item = images.find(img => img.id === id);
        if (!item) return;

        // 创新模式下：重新运行创新流程（仅处理这张图片）
        if (workMode === 'creative' || workMode === 'quick') {
            // 调用创新流程，传入要重新处理的图片ID
            runCreativeAnalysis([id]);
            return;
        }

        const updateItem = (updates: Partial<ImageItem>) => {
            setImages(prev => prev.map(img => img.id === id ? { ...img, ...updates } : img));
        };

        updateItem({ status: 'loading', errorMsg: undefined });

        if (!item.base64Data && item.fetchUrl) {
            try {
                const { blob, mimeType } = await fetchImageBlob(item.fetchUrl);
                const blobUrl = URL.createObjectURL(blob);
                const base64 = await convertBlobToBase64(blob);

                updateItem({
                    imageUrl: blobUrl,
                    base64Data: base64,
                    mimeType: mimeType,
                    status: 'idle'
                });
            } catch (error: any) {
                updateItem({ status: 'error', errorMsg: error.message || '图片下载重试失败' });
            }
            return;
        }

        if (item.base64Data) {
            // 使用图片单独的提示词（如果启用），否则使用全局提示词
            // 支持合并模式：全局指令 + 单独指令
            let effectivePrompt: string;
            if (item.useCustomPrompt && item.customPrompt?.trim()) {
                if ((item.mergeWithGlobalPrompt ?? true) && prompt.trim()) {
                    // 合并模式：全局指令 + 单独指令
                    effectivePrompt = prompt.trim() + '\n\n' + item.customPrompt.trim();
                } else {
                    // 独立模式：仅使用单独指令
                    effectivePrompt = item.customPrompt;
                }
            } else {
                // 没有单独指令，使用全局指令
                effectivePrompt = prompt;
            }

            if (!effectivePrompt.trim()) {
                updateItem({ status: 'error', errorMsg: '请先输入指令' });
                return;
            }

            // 如果开启了纯净回复模式，在提示词末尾添加后缀（与 runAnalysis 保持一致）
            if (pureReplyMode) {
                effectivePrompt = effectivePrompt + PURE_REPLY_SUFFIX;
            }

            try {
                const result = await classifyImage(item.base64Data, item.mimeType || 'image/jpeg', effectivePrompt);

                setImages(prev => prev.map(img => {
                    if (img.id === id) {
                        const timestamp = Date.now();
                        // 记录这次重试使用的指令
                        const userMsg = {
                            id: uuidv4(),
                            role: 'user' as const,
                            text: effectivePrompt,
                            timestamp: timestamp
                        };
                        // 记录新的结果
                        const aiMsg = {
                            id: uuidv4(),
                            role: 'model' as const,
                            text: result,
                            timestamp: timestamp + 1
                        };

                        return {
                            ...img,
                            status: 'success',
                            result,
                            chatHistory: [...img.chatHistory, userMsg, aiMsg]
                        };
                    }
                    return img;
                }));
            } catch (error: any) {
                updateItem({ status: 'error', errorMsg: error.message });
            }
        } else {
            updateItem({ status: 'error', errorMsg: '无法重试：缺少图片数据' });
        }
    };

    // 重置并立即开始
    const handleResetAndRun = () => {
        const nextImages = images.map(img =>
            (img.status === 'success' || img.status === 'error') && img.base64Data
                ? { ...img, status: 'idle' as const, result: undefined, errorMsg: undefined }
                : img
        );
        setImages(nextImages);
        // 立即使用计算出的新状态启动分析
        const queue = nextImages.filter(img => img.status === 'idle' && img.base64Data);
        runAnalysis(queue, workMode === 'split' ? buildSplitPrompt() : undefined);
    };

    // 重试失败并立即开始
    const handleRetryFailedAndRun = () => {
        const nextImages = images.map(img =>
            img.status === 'error' && img.base64Data
                ? { ...img, status: 'idle' as const, result: undefined, errorMsg: undefined }
                : img
        );
        setImages(nextImages);
        const queue = nextImages.filter(img => img.status === 'idle' && img.base64Data);
        runAnalysis(queue, workMode === 'split' ? buildSplitPrompt() : undefined);
    };

    const runAnalysis = async (targetImages?: ImageItem[], overridePrompt?: string) => {
        const effectiveBasePrompt = overridePrompt || prompt;
        if (!effectiveBasePrompt.trim()) {
            showToast("请先输入指令或选择一个预设。");
            return;
        }

        // Reset control flags
        stoppedRef.current = false;
        pausedRef.current = false;
        setIsPaused(false);
        setIsProcessing(true);

        // 如果传入了 targetImages，则使用它作为待处理队列（通常是重置/重试后的新状态）
        // 否则，从当前的 state 中筛选 idle 的图片
        const queue = targetImages || images.filter(img => img.status === 'idle' && img.base64Data);

        // 如果没有待处理的图片，直接返回
        if (!queue || queue.length === 0) {
            setIsProcessing(false);
            return;
        }

        // === 批次模式（imageBatchSize > 1）：多张图片合并成一次 API 调用 ===
        if (imageBatchSize > 1) {
            console.log(`[图片批次模式] 开始批次处理，每批 ${imageBatchSize} 张图片，并发 3`);

            // 过滤出有自定义 prompt 的图片，这些不能批量处理
            const customPromptItems = queue.filter(item => item.useCustomPrompt && item.customPrompt?.trim());
            const standardItems = queue.filter(item => !(item.useCustomPrompt && item.customPrompt?.trim()));

            // 标准图片分批处理
            const batches: ImageItem[][] = [];
            for (let i = 0; i < standardItems.length; i += imageBatchSize) {
                batches.push(standardItems.slice(i, i + imageBatchSize));
            }

            // 构建有效 prompt
            let effectivePrompt = effectiveBasePrompt;
            if (pureReplyMode) {
                effectivePrompt = effectivePrompt + PURE_REPLY_SUFFIX;
            }

            // 使用并发处理批次
            await processWithConcurrency(batches, 3, async (batch: ImageItem[]) => {
                if (stoppedRef.current) return;
                while (pausedRef.current && !stoppedRef.current) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }
                if (stoppedRef.current) return;

                // 标记这一批为 loading
                const batchIds = new Set(batch.map(item => item.id));
                setImages(prev => prev.map(img => batchIds.has(img.id) ? { ...img, status: 'loading' } : img));

                // 过滤出有 base64 的图片
                const validItems = batch.filter(item => item.base64Data && item.mimeType);
                if (validItems.length === 0) return;

                try {
                    const resultMap = await classifyImagesBatch(
                        validItems.map(item => ({
                            base64Data: item.base64Data!,
                            mimeType: item.mimeType!,
                            id: item.id,
                        })),
                        effectivePrompt
                    );

                    // 更新成功的结果
                    setImages(prev => prev.map(img => {
                        if (!batchIds.has(img.id)) return img;
                        const result = resultMap.get(img.id);
                        if (result) {
                            const initialMessage = {
                                id: uuidv4(),
                                role: 'model' as const,
                                text: result,
                                timestamp: Date.now()
                            };
                            return { ...img, status: 'success' as const, result, chatHistory: [initialMessage] };
                        } else {
                            // 该图片未在批次结果中找到，标记为 idle 等待单独重试
                            return { ...img, status: 'idle' as const };
                        }
                    }));

                    // 批次中未匹配到结果的图片，回退到逐张处理
                    const unmatchedItems = validItems.filter(item => !resultMap.has(item.id));
                    if (unmatchedItems.length > 0) {
                        console.log(`[图片批次模式] ${unmatchedItems.length} 张图片批次解析失败，回退到逐张处理`);
                        for (const item of unmatchedItems) {
                            if (stoppedRef.current) break;
                            try {
                                setImages(prev => prev.map(img => img.id === item.id ? { ...img, status: 'loading' } : img));
                                const singleResult = await classifyImage(item.base64Data!, item.mimeType!, effectivePrompt);
                                const msg = { id: uuidv4(), role: 'model' as const, text: singleResult, timestamp: Date.now() };
                                setImages(prev => prev.map(img => img.id === item.id ? { ...img, status: 'success', result: singleResult, chatHistory: [msg] } : img));
                            } catch (err: any) {
                                setImages(prev => prev.map(img => img.id === item.id ? { ...img, status: 'error', errorMsg: err.message } : img));
                            }
                        }
                    }
                } catch (error: any) {
                    console.error('[图片批次模式] 批次处理失败，回退到逐张处理:', error);
                    // 整个批次失败，逐张重试
                    for (const item of validItems) {
                        if (stoppedRef.current) break;
                        while (pausedRef.current && !stoppedRef.current) {
                            await new Promise(resolve => setTimeout(resolve, 200));
                        }
                        try {
                            setImages(prev => prev.map(img => img.id === item.id ? { ...img, status: 'loading' } : img));
                            const singleResult = await classifyImage(item.base64Data!, item.mimeType!, effectivePrompt);
                            const msg = { id: uuidv4(), role: 'model' as const, text: singleResult, timestamp: Date.now() };
                            setImages(prev => prev.map(img => img.id === item.id ? { ...img, status: 'success', result: singleResult, chatHistory: [msg] } : img));
                        } catch (err: any) {
                            setImages(prev => prev.map(img => img.id === item.id ? { ...img, status: 'error', errorMsg: err.message } : img));
                        }
                    }
                }
            }, 300); // 批次之间 300ms 间隔

            // 处理有自定义 prompt 的图片（逐张处理）
            if (customPromptItems.length > 0 && !stoppedRef.current) {
                console.log(`[图片批次模式] ${customPromptItems.length} 张图片有自定义指令，逐张处理`);
                await processWithConcurrency(customPromptItems, 3, async (item: ImageItem) => {
                    if (stoppedRef.current) return;
                    while (pausedRef.current && !stoppedRef.current) {
                        await new Promise(resolve => setTimeout(resolve, 200));
                    }
                    if (stoppedRef.current) return;

                    setImages(prev => prev.map(img => img.id === item.id ? { ...img, status: 'loading' } : img));
                    try {
                        if (!item.base64Data || !item.mimeType) throw new Error("No image data");
                        let ep = item.customPrompt!;
                        if ((item.mergeWithGlobalPrompt ?? true) && effectiveBasePrompt.trim()) {
                            ep = effectiveBasePrompt.trim() + '\n\n' + ep.trim();
                        }
                        if (pureReplyMode) ep += PURE_REPLY_SUFFIX;

                        const result = await classifyImage(item.base64Data, item.mimeType, ep);
                        const msg = { id: uuidv4(), role: 'model' as const, text: result, timestamp: Date.now() };
                        setImages(prev => prev.map(img => img.id === item.id ? { ...img, status: 'success', result, chatHistory: [msg] } : img));
                    } catch (err: any) {
                        setImages(prev => prev.map(img => img.id === item.id ? { ...img, status: 'error', errorMsg: err.message } : img));
                    }
                }, 500);
            }

        } else {
            // === 单张模式（原始逻辑）===
            // Process with rate limit protection (concurrency=2, delay=1000ms between requests)
            await processWithConcurrency(queue, 2, async (item: ImageItem) => {
                // Check if stopped
                if (stoppedRef.current) {
                    return;
                }

                // Wait while paused
                while (pausedRef.current && !stoppedRef.current) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                }

                // Check again after pause
                if (stoppedRef.current) {
                    return;
                }

                setImages(prev => prev.map(img => img.id === item.id ? { ...img, status: 'loading' } : img));

                try {
                    if (!item.base64Data || !item.mimeType) throw new Error("No image data");

                    // 使用图片单独的提示词（如果启用），否则使用全局提示词
                    // 支持合并模式：全局指令 + 单独指令
                    let effectivePrompt: string;
                    if (item.useCustomPrompt && item.customPrompt?.trim()) {
                        if ((item.mergeWithGlobalPrompt ?? true) && effectiveBasePrompt.trim()) {
                            // 合并模式：全局指令 + 单独指令
                            effectivePrompt = effectiveBasePrompt.trim() + '\n\n' + item.customPrompt.trim();
                        } else {
                            // 独立模式：仅使用单独指令
                            effectivePrompt = item.customPrompt;
                        }
                    } else {
                        // 没有单独指令，使用全局指令
                        effectivePrompt = effectiveBasePrompt;
                    }

                    // 如果开启了纯净回复模式，在提示词末尾添加后缀
                    if (pureReplyMode) {
                        effectivePrompt = effectivePrompt + PURE_REPLY_SUFFIX;
                    } else {
                    }

                    const result = await classifyImage(item.base64Data, item.mimeType, effectivePrompt);

                    // 识别成功后，将结果也添加到聊天历史的第一条
                    const initialMessage = {
                        id: uuidv4(),
                        role: 'model' as const,
                        text: result,
                        timestamp: Date.now()
                    };

                    setImages(prev => prev.map(img => img.id === item.id ? {
                        ...img,
                        status: 'success',
                        result: result,
                        chatHistory: [initialMessage]
                    } : img));

                    // 每张图片识别完成后保存到历史
                    // 等待 Gyazo 上传完成后再保存（如果有上传任务的话）
                    if (user?.uid) {
                        const itemId = item.id;
                        const userId = user.uid;
                        const promptUsed = effectivePrompt;

                        // 获取该图片的上传 Promise（如果存在）
                        const uploadPromise = gyazoUploadPromisesRef.current.get(itemId);

                        // 项目状态会自动保存，不再需要单独保存历史记录
                        const saveToHistory = () => {
                            // 项目系统会自动保存整个状态，包括识别结果
                        };

                        if (uploadPromise) {
                            // 等待上传完成后再保存，最多等待 10 秒
                            Promise.race([
                                uploadPromise,
                                new Promise(resolve => setTimeout(resolve, 10000))
                            ]).then(() => {
                                // 清理已完成的 Promise
                                gyazoUploadPromisesRef.current.delete(itemId);
                                saveToHistory();
                            });
                        } else {
                            // 没有上传任务，直接保存
                            saveToHistory();
                        }
                    }

                } catch (error: any) {
                    setImages(prev => prev.map(img => img.id === item.id ? {
                        ...img,
                        status: 'error',
                        errorMsg: error.message
                    } : img));
                }
            });
        }

        setIsProcessing(false);
        setIsPaused(false);

        // 检查是否全部完成（没有 idle 和 loading 状态的项目）
        // 注意：这里需要再次获取最新的 state，不能依赖闭包中的 images
        // 但我们在 setImages 中无法直接获取全量，只能通过 setState callback hack 或者在这里简单假设
        // 受限于 React 闭包，这里 setShowAllComplete 最好依赖一个 Effect，或者忽略它
        // 为了简单起见，我们暂时保留原逻辑，但注意它读取的是旧的 prev 闭包吗？
        // 原代码用了 setState(prev => ...)，这是完全正确的。
        // 但这里是 runAnalysis 结尾，我们没有 setState 钩子去读全局。
        // 我们可以简单地触发一次无操作的 setState 来检查
        setImages(prev => {
            const hasRemaining = prev.some(img => img.status === 'idle' || img.status === 'loading');
            const hasSuccess = prev.some(img => img.status === 'success');
            if (!hasRemaining && hasSuccess && prev.length > 0) {
                setShowAllComplete(true);
                setTimeout(() => setShowAllComplete(false), 3000);
                // 单条已保存，批量完成时不再重复保存
            }
            return prev;
        });
    };

    const handlePauseResume = () => {
        if (isPaused) {
            pausedRef.current = false;
            setIsPaused(false);
        } else {
            pausedRef.current = true;
            setIsPaused(true);
        }
    };

    const handleStop = () => {
        stoppedRef.current = true;
        pausedRef.current = false;
        setIsPaused(false);
        setIsProcessing(false);  // 立即停止处理状态
        // Reset loading items back to idle
        setImages(prev => prev.map(img =>
            img.status === 'loading'
                ? { ...img, status: 'idle' as const }
                : img
        ));
    };



    const removeImage = (id: string) => {
        setImages(prev => {
            // 释放 blob URL 以防止内存泄漏
            const imgToRemove = prev.find(img => img.id === id);
            if (imgToRemove?.imageUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(imgToRemove.imageUrl);
            }
            return prev.filter(img => img.id !== id);
        });
    };

    // Batch retry all failed images - directly process them
    const retryAllFailed = async () => {
        const failedItems = images.filter(img => img.status === 'error' && img.base64Data);
        if (failedItems.length === 0) return;

        if (!prompt.trim()) {
            showToast("请先输入指令或选择一个预设。");
            return;
        }

        // Reset control flags
        stoppedRef.current = false;
        pausedRef.current = false;
        setIsPaused(false);
        setIsProcessing(true);

        // First reset all failed items to loading status
        const failedIds = failedItems.map(img => img.id);
        setImages(prev => prev.map(img =>
            failedIds.includes(img.id)
                ? { ...img, status: 'loading' as const, errorMsg: undefined }
                : img
        ));

        // Process with rate limit protection
        await processWithConcurrency(failedItems, 2, async (item: ImageItem) => {
            if (stoppedRef.current) return;

            while (pausedRef.current && !stoppedRef.current) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            if (stoppedRef.current) return;

            try {
                if (!item.base64Data || !item.mimeType) throw new Error("No image data");

                // 使用图片单独的提示词（如果启用），否则使用全局提示词
                // 支持合并模式：全局指令 + 单独指令
                let effectivePrompt: string;
                if (item.useCustomPrompt && item.customPrompt?.trim()) {
                    if ((item.mergeWithGlobalPrompt ?? true) && prompt.trim()) {
                        // 合并模式：全局指令 + 单独指令
                        effectivePrompt = prompt.trim() + '\n\n' + item.customPrompt.trim();
                    } else {
                        // 独立模式：仅使用单独指令
                        effectivePrompt = item.customPrompt;
                    }
                } else {
                    // 没有单独指令，使用全局指令
                    effectivePrompt = prompt;
                }

                // 如果开启了纯净回复模式，在提示词末尾添加后缀
                if (pureReplyMode) {
                    effectivePrompt = effectivePrompt + PURE_REPLY_SUFFIX;
                }

                const result = await classifyImage(item.base64Data, item.mimeType, effectivePrompt);

                setImages(prev => prev.map(img => img.id === item.id ? {
                    ...img,
                    status: 'success',
                    result: result
                } : img));
            } catch (error: any) {
                setImages(prev => prev.map(img => img.id === item.id ? {
                    ...img,
                    status: 'error',
                    errorMsg: error.message
                } : img));
            }
        });

        setIsProcessing(false);
        setIsPaused(false);

        // 检查是否全部完成
        setState(prev => {
            const hasRemaining = prev.images.some(img => img.status === 'idle' || img.status === 'loading');
            const hasSuccess = prev.images.some(img => img.status === 'success');
            if (!hasRemaining && hasSuccess && prev.images.length > 0) {
                setShowAllComplete(true);
                setTimeout(() => setShowAllComplete(false), 3000);
            }
            return prev;
        });
    };

    // 复制全部链接 - 保留空行以确保行对齐
    const copyAllLinks = () => {
        const lines = images.map(img => {
            if (img.gyazoUrl) return img.gyazoUrl;
            if (img.fetchUrl) return img.fetchUrl;
            const formulaMatch = img.originalInput.match(/=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i);
            if (formulaMatch) return formulaMatch[1];
            return ''; // 保留空行
        });

        if (lines.some(l => l)) {
            navigator.clipboard.writeText(lines.join('\n'));
            setCopySuccess('links');
            setTimeout(() => setCopySuccess(null), 2000);
        } else {
            showToast('没有可复制的链接');
        }
    };

    // 复制全部公式 - 保留空行以确保行对齐
    const copyAllFormulas = () => {
        const lines = images.map(img => {
            // 去掉可能的前导单引号
            const cleanInput = img.originalInput.replace(/^'+/, '');
            if (cleanInput.toUpperCase().startsWith('=IMAGE')) return cleanInput;
            if (img.gyazoUrl) return `=IMAGE("${img.gyazoUrl}")`;
            if (img.fetchUrl) return `=IMAGE("${img.fetchUrl}")`;
            return ''; // 保留空行
        });

        if (lines.some(l => l)) {
            navigator.clipboard.writeText(lines.join('\n'));
            setCopySuccess('formulas');
            setTimeout(() => setCopySuccess(null), 2000);
        } else {
            showToast('没有可复制的公式');
        }
    };

    // 复制全部结果 - 保留空行以确保行对齐
    // 对于含换行的结果，用双引号包裹以便粘贴到Google Sheets时保持在同一单元格
    const copyAllResults = () => {
        const lines = images.map(img => {
            if (img.status === 'success' && img.result) {
                const result = img.result;
                // 如果结果包含换行、Tab或双引号，需要用双引号包裹（TSV格式规范）
                if (result.includes('\n') || result.includes('\r') || result.includes('\t') || result.includes('"')) {
                    // 双引号需要转义为两个双引号
                    return `"${result.replace(/"/g, '""')}"`;
                }
                return result;
            }
            return ''; // 保留空行
        });

        if (lines.some(l => l)) {
            navigator.clipboard.writeText(lines.join('\n'));
            setCopySuccess('results');
            setTimeout(() => setCopySuccess(null), 2000);
        } else {
            showToast('没有可复制的结果');
        }
    };

    // 复制全部原始+结果（Tab分隔）
    const copyAllOriginalAndResults = () => {
        const lines = images.map(img => {
            const original = img.originalInput.startsWith('=IMAGE')
                ? img.originalInput
                : (img.gyazoUrl ? `=IMAGE("${img.gyazoUrl}")` : (img.fetchUrl ? `=IMAGE("${img.fetchUrl}")` : img.originalInput));
            let result = '';
            if (img.status === 'success' && img.result) {
                const r = img.result;
                // 如果结果包含换行、Tab或双引号，需要用双引号包裹（TSV格式规范）
                if (r.includes('\n') || r.includes('\r') || r.includes('\t') || r.includes('"')) {
                    result = `"${r.replace(/"/g, '""')}"`;
                } else {
                    result = r;
                }
            }
            return `${original}\t${result}`;
        });

        if (lines.length > 0) {
            navigator.clipboard.writeText(lines.join('\n'));
            setCopySuccess('original');
            setTimeout(() => setCopySuccess(null), 2000);
        }
    };

    // 重置所有已完成/出错的图片为待处理状态，便于重新运行
    const resetAllToIdle = () => {
        setImages(prev => prev.map(img =>
            (img.status === 'success' || img.status === 'error') && img.base64Data
                ? { ...img, status: 'idle' as const, result: undefined, errorMsg: undefined }
                : img
        ));
    };

    // 一键上传所有未上传的本地图片到 Gyazo
    const uploadAllUnuploadedToGyazo = async () => {
        const tokenToUse = gyazoToken || DEFAULT_GYAZO_TOKEN;

        // 找出所有未上传的本地图片
        const unuploadedItems = images.filter(img =>
            img.sourceType === 'file' && !img.gyazoUrl && !img.isUploadingToGyazo && img.base64Data
        );

        if (unuploadedItems.length === 0) {
            showToast('没有需要上传的本地图片');
            return;
        }

        // 标记为正在上传
        setImages(prev => prev.map(img =>
            unuploadedItems.find(u => u.id === img.id)
                ? { ...img, isUploadingToGyazo: true }
                : img
        ));

        // 并行上传
        for (const item of unuploadedItems) {
            try {
                // 将 base64 转为 File
                const base64Response = await fetch(`data:${item.mimeType};base64,${item.base64Data}`);
                const blob = await base64Response.blob();
                const file = new File([blob], item.originalInput || 'image.png', { type: item.mimeType });

                const gyazoUrl = await uploadToGyazo(file, tokenToUse);
                if (gyazoUrl) {
                    setImages(prev => prev.map(img =>
                        img.id === item.id
                            ? {
                                ...img,
                                gyazoUrl: gyazoUrl,
                                originalInput: `=IMAGE("${gyazoUrl}")`,
                                isUploadingToGyazo: false
                            }
                            : img
                    ));
                } else {
                    setImages(prev => prev.map(img =>
                        img.id === item.id
                            ? { ...img, isUploadingToGyazo: false }
                            : img
                    ));
                }
            } catch (error) {
                console.error('Gyazo upload failed for', item.id, error);
                setImages(prev => prev.map(img =>
                    img.id === item.id
                        ? { ...img, isUploadingToGyazo: false }
                        : img
                ));
            }
        }
    };

    // ========== 对话功能 ==========

    // 切换对话面板
    const toggleChat = useCallback((id: string) => {
        setImages(prev => prev.map(img =>
            img.id === id
                ? { ...img, isChatOpen: !img.isChatOpen }
                : img
        ));
    }, [setImages]);

    // 更新对话输入
    const updateChatInput = useCallback((id: string, value: string) => {
        setImages(prev => prev.map(img =>
            img.id === id
                ? { ...img, chatInput: value }
                : img
        ));
    }, [setImages]);

    // 更新对话附件
    const updateChatAttachments = useCallback((id: string, attachments: string[]) => {
        setImages(prev => prev.map(img =>
            img.id === id
                ? { ...img, chatAttachments: attachments }
                : img
        ));
    }, [setImages]);

    // 发送对话消息
    const sendChatMessage = useCallback(async (imageId: string) => {
        const image = images.find(img => img.id === imageId);
        // 检查是否有文本或图片附件
        const hasText = !!image?.chatInput?.trim();
        const hasAttachments = !!(image?.chatAttachments && image.chatAttachments.length > 0);

        if (!image || (!hasText && !hasAttachments) || !image.base64Data) return;

        const userMessage: ChatMessage = {
            id: uuidv4(),
            role: 'user' as const,
            text: image.chatInput?.trim() || '',
            images: image.chatAttachments, // Include attachments
            timestamp: Date.now()
        };

        // 添加用户消息并清空输入和附件
        setImages(prev => prev.map(img =>
            img.id === imageId
                ? {
                    ...img,
                    chatHistory: [...img.chatHistory, userMessage],
                    chatInput: '',
                    chatAttachments: [], // Clear attachments
                    isChatLoading: true
                }
                : img
        ));

        try {
            const ai = getAiInstance();

            // 构建对话历史
            const updatedImage = images.find(img => img.id === imageId);
            const history = updatedImage ? [...updatedImage.chatHistory, userMessage] : [userMessage];

            // 构建内容
            const contents: any[] = [
                {
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                mimeType: image.mimeType || 'image/png',
                                data: image.base64Data,
                            }
                        },
                        { text: `之前的识别结果：${image.result || '无'}\n\n请根据用户的后续问题继续回答。` }
                    ]
                }
            ];

            // 添加对话历史
            history.forEach(msg => {
                const parts: any[] = [];

                // 处理消息中的图片
                if (msg.images && msg.images.length > 0) {
                    msg.images.forEach(imgDataUrl => {
                        // 移除 Data URL 前缀，只保留 base64
                        const base64Data = imgDataUrl.replace(/^data:image\/\w+;base64,/, '');
                        parts.push({
                            inlineData: {
                                mimeType: 'image/png', // 假设是 PNG，或者从 Data URL 解析
                                data: base64Data
                            }
                        });
                    });
                }

                // 处理文本
                if (msg.text) {
                    parts.push({ text: msg.text });
                }

                if (parts.length > 0) {
                    contents.push({
                        role: msg.role === 'user' ? 'user' : 'model',
                        parts: parts
                    });
                }
            });

            const response = await ai.models.generateContent({
                model: imageModel,
                contents: contents
            });

            const modelMessage = {
                id: uuidv4(),
                role: 'model' as const,
                text: response.text || '无响应',
                timestamp: Date.now()
            };

            setImages(prev => prev.map(img =>
                img.id === imageId
                    ? {
                        ...img,
                        chatHistory: [...img.chatHistory, modelMessage],
                        isChatLoading: false
                    }
                    : img
            ));

            // 对话完成后项目状态会自动保存
            if (user?.uid) {
            }
        } catch (error: any) {
            console.error('Chat error:', error);
            const errorMessage = {
                id: uuidv4(),
                role: 'model' as const,
                text: `错误: ${error.message || '请求失败'}`,
                timestamp: Date.now()
            };

            setImages(prev => prev.map(img =>
                img.id === imageId
                    ? {
                        ...img,
                        chatHistory: [...img.chatHistory, errorMessage],
                        isChatLoading: false
                    }
                    : img
            ));
        }
    }, [images, getAiInstance, imageModel, setImages, user]);

    // 复制对话历史
    const copyChatHistory = useCallback((imageId: string) => {
        const image = images.find(img => img.id === imageId);
        if (!image) return;

        const historyText = image.chatHistory.map(msg =>
            `[${msg.role === 'user' ? '用户' : 'AI'}] ${msg.text}`
        ).join('\n\n');

        navigator.clipboard.writeText(historyText);
    }, [images]);

    // 更新单独提示词
    const updateCustomPrompt = useCallback((id: string, value: string) => {
        setImages(prev => prev.map(img =>
            img.id === id
                ? { ...img, customPrompt: value, useCustomPrompt: true }
                : img
        ));
    }, [setImages]);

    // 切换是否使用单独提示词
    const toggleUseCustomPrompt = useCallback((id: string) => {
        setImages(prev => prev.map(img =>
            img.id === id
                ? { ...img, useCustomPrompt: !img.useCustomPrompt }
                : img
        ));
    }, [setImages]);

    // 应用预设到单独提示词
    const applyPresetToImage = useCallback((imageId: string, presetText: string) => {
        setImages(prev => prev.map(img =>
            img.id === imageId
                ? { ...img, customPrompt: presetText, useCustomPrompt: true }
                : img
        ));
    }, [setImages]);

    // 切换单独指令的合并模式
    const toggleMergeMode = useCallback((id: string, merge: boolean) => {
        setImages(prev => prev.map(img =>
            img.id === id
                ? { ...img, mergeWithGlobalPrompt: merge }
                : img
        ));
    }, [setImages]);

    const updateCustomInnovationInstruction = useCallback((imageId: string, value: string) => {
        setImages(prev => prev.map(img =>
            img.id === imageId
                ? { ...img, customInnovationInstruction: value }
                : img
        ));
    }, [setImages]);

    const updateCustomInnovationCount = useCallback((imageId: string, count: number) => {
        setImages(prev => prev.map(img =>
            img.id === imageId
                ? { ...img, customInnovationCount: count }
                : img
        ));
    }, [setImages]);

    const updateCustomInnovationRounds = useCallback((imageId: string, rounds: number) => {
        setImages(prev => prev.map(img =>
            img.id === imageId
                ? { ...img, customInnovationRounds: rounds }
                : img
        ));
    }, [setImages]);

    const updateCustomInnovationTemplateId = useCallback((imageId: string, templateId: string) => {
        setImages(prev => prev.map(img =>
            img.id === imageId
                ? { ...img, customInnovationTemplateId: templateId }
                : img
        ));
    }, [setImages]);

    const ensureInnovationItemList = (img: ImageItem): InnovationItem[] => {
        if (img.innovationItems && img.innovationItems.length > 0) return img.innovationItems;
        if (img.innovationOutputs && img.innovationOutputs.length > 0) {
            return img.innovationOutputs.map((text, idx) => ({
                id: `legacy-${img.id}-${idx}`,
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

    const updateInnovationItem = useCallback((
        imageId: string,
        innovationId: string,
        updater: (item: InnovationItem, index: number, all: InnovationItem[]) => InnovationItem
    ) => {
        setImages(prev => prev.map(img => {
            if (img.id !== imageId) return img;
            const items = ensureInnovationItemList(img);
            if (items.length === 0) return img;
            const updatedItems = items.map((it, idx) => it.id === innovationId ? updater(it, idx, items) : it);
            const syncedOutputs = (img.innovationOutputs && img.innovationOutputs.length > 0)
                ? img.innovationOutputs.map((text, idx) => updatedItems[idx]?.text ?? text)
                : updatedItems.map(it => it.text);
            return { ...img, innovationItems: updatedItems, innovationOutputs: syncedOutputs };
        }));
    }, [setImages]);

    // 创新功能：切换创新面板显示
    const toggleInnovation = useCallback((id: string) => {
        setImages(prev => prev.map(img =>
            img.id === id
                ? { ...img, isInnovationOpen: !img.isInnovationOpen }
                : img
        ));
    }, [setImages]);

    // 创新功能：开始创新
    const startInnovation = useCallback(async (id: string) => {
        const image = images.find(img => img.id === id);
        if (!image || !image.result || image.isInnovating) return;

        // 获取使用的模板ID：优先使用图片自定义 > 全局设置 > 系统默认
        const effectiveTemplateId = image.customInnovationTemplateId || globalInnovationTemplateId || '__system_default__';

        // 获取创新指令：优先使用自定义指令 > 模版指令 > 全局指令 > 默认指令
        let instruction = DEFAULT_INNOVATION_INSTRUCTION;

        if (image.customInnovationInstruction && image.customInnovationInstruction.trim()) {
            // 使用用户自定义的指令
            instruction = image.customInnovationInstruction.trim();
        } else if (effectiveTemplateId === '__custom__' && innovationInstruction && innovationInstruction.trim()) {
            // 使用全局自定义指令
            instruction = innovationInstruction.trim();
        } else if (effectiveTemplateId === '__system_default__') {
            // 使用系统默认指令
            instruction = DEFAULT_INNOVATION_INSTRUCTION;
        } else if (effectiveTemplateId?.startsWith('rec:') && unifiedPresets.length > 0) {
            // 使用图片识别预设
            const presetId = effectiveTemplateId.substring(4);
            const preset = unifiedPresets.find(p => p.id === presetId);
            if (preset?.text) {
                instruction = preset.text;
            }
        } else if (effectiveTemplateId && templateState?.savedTemplates) {
            // 使用选择的模版
            const template = templateState.savedTemplates.find(t => t.id === effectiveTemplateId);
            if (template && template.sections && template.values) {
                const templateContent = template.sections
                    .map((section: any) => (template.values[section.id] || '').trim())
                    .filter(Boolean)
                    .join('\n\n');
                if (templateContent.trim()) {
                    instruction = templateContent.trim();
                }
            }
        } else if (innovationInstruction && innovationInstruction.trim()) {
            instruction = innovationInstruction.trim();
        }

        // 设置加载状态
        setImages(prev => prev.map(img =>
            img.id === id
                ? { ...img, isInnovating: true, innovationError: undefined }
                : img
        ));

        try {
            const ai = getAiInstance();
            const modelId = imageModel; // 使用用户选择的模型
            // 使用图片自定义设置 > 全局设置 > 默认值
            const count = image.customInnovationCount || globalInnovationCount || 3;
            const rounds = image.customInnovationRounds || globalInnovationRounds || 1;

            // 多轮创新
            let allOutputs: string[] = [];

            // 检查是否启用了随机库（高级创新模式）
            const isAdvancedMode = randomLibraryConfigRef.current.enabled &&
                randomLibraryConfigRef.current.libraries.some(lib => lib.enabled && lib.values.length > 0);

            if (isAdvancedMode) {
                // 高级创新模式：每个随机组合单独调用AI，生成1个结果
                // count 表示生成多少个不同的随机组合
                const totalCombinations = count * rounds;
                const combinations = generateMultipleUniqueCombinations(randomLibraryConfigRef.current, totalCombinations);

                for (const randomCombination of combinations) {
                    // 组合最终指令
                    let finalInstruction = instruction;
                    if (randomLibraryConfigRef.current.insertPosition === 'before') {
                        finalInstruction = `${randomCombination}\n\n${instruction}`;
                    } else {
                        finalInstruction = `${instruction}\n\n随机元素：${randomCombination}`;
                    }

                    const innovationPrompt = `${finalInstruction}

原始提示词：
${image.result}

请根据以上要求生成1个创新变体，直接输出结果，不要序号。`;

                    const response = await ai.models.generateContent({
                        model: modelId,
                        contents: { parts: [{ text: innovationPrompt }] },
                        config: { temperature: 0.85 }
                    });

                    const responseText = (response.text || '').trim();
                    if (responseText) {
                        // 清理可能的序号前缀
                        const cleaned = responseText.replace(/^\d+[\.\、\)]\s*/, '').trim();
                        allOutputs.push(cleaned);
                    }
                }
            } else {
                // 普通模式：原有逻辑，每轮生成多个变体
                for (let round = 0; round < rounds; round++) {
                    const innovationPrompt = `${instruction}

原始提示词：
${image.result}

请根据以上要求生成${count}个创新变体，使用清晰的序号或换行分隔。`;

                    const response = await ai.models.generateContent({
                        model: modelId,
                        contents: { parts: [{ text: innovationPrompt }] },
                        config: { temperature: 0.8 }
                    });

                    const responseText = response.text || '';

                    // 解析输出 - 按序号分割
                    const outputs: string[] = [];
                    const lines = responseText.split(/\n/).filter(line => line.trim());
                    let currentOutput = '';

                    for (const line of lines) {
                        // 检测新序号开始
                        if (/^\d+[\.、\)]\s*/.test(line.trim())) {
                            if (currentOutput.trim()) {
                                outputs.push(currentOutput.trim());
                            }
                            currentOutput = line.replace(/^\d+[\.、\)]\s*/, '').trim();
                        } else {
                            currentOutput += (currentOutput ? ' ' : '') + line.trim();
                        }
                    }
                    if (currentOutput.trim()) {
                        outputs.push(currentOutput.trim());
                    }

                    // 如果没有正确解析，就把整个响应作为一个输出
                    const roundOutputs = outputs.length > 0 ? outputs : [responseText.trim()];
                    allOutputs = allOutputs.concat(roundOutputs);
                }
            }

            // 更新状态 - 使用所有轮次的输出
            setImages(prev => prev.map(img =>
                img.id === id
                    ? {
                        ...img,
                        innovationOutputs: allOutputs,
                        innovationItems: allOutputs.map(text => ({
                            id: uuidv4(),
                            text,
                            chatHistory: [],
                            isChatOpen: false,
                            chatInput: '',
                            chatAttachments: [],
                            isChatLoading: false
                        })),
                        isInnovating: false,
                        innovationError: undefined,
                        isInnovationOpen: true
                    }
                    : img
            ));
        } catch (error: any) {
            console.error('Innovation error:', error);
            setImages(prev => prev.map(img =>
                img.id === id
                    ? { ...img, isInnovating: false, innovationError: error.message || '创新失败' }
                    : img
            ));
        }
    }, [images, getAiInstance, setImages, innovationInstruction, templateState, unifiedPresets, imageModel, globalInnovationTemplateId, globalInnovationCount, globalInnovationRounds]);

    const toggleInnovationChat = useCallback((imageId: string, innovationId: string) => {
        setImages(prev => prev.map(img => {
            if (img.id !== imageId) return img;
            const items = ensureInnovationItemList(img);
            if (items.length === 0) return img;
            const updatedItems = items.map(it => it.id === innovationId ? { ...it, isChatOpen: !it.isChatOpen } : it);
            const syncedOutputs = (img.innovationOutputs && img.innovationOutputs.length > 0)
                ? img.innovationOutputs.map((text, idx) => updatedItems[idx]?.text ?? text)
                : updatedItems.map(it => it.text);
            return { ...img, innovationItems: updatedItems, innovationOutputs: syncedOutputs, isInnovationOpen: true };
        }));
    }, [setImages]);

    const updateInnovationChatInput = useCallback((imageId: string, innovationId: string, value: string) => {
        updateInnovationItem(imageId, innovationId, item => ({ ...item, chatInput: value }));
    }, [updateInnovationItem]);

    const updateInnovationChatAttachments = useCallback((imageId: string, innovationId: string, attachments: string[]) => {
        updateInnovationItem(imageId, innovationId, item => ({ ...item, chatAttachments: attachments }));
    }, [updateInnovationItem]);

    const sendInnovationChatMessage = useCallback(async (imageId: string, innovationId: string) => {
        const image = images.find(img => img.id === imageId);
        if (!image) return;
        const items = ensureInnovationItemList(image);
        const target = items.find(it => it.id === innovationId);
        const hasText = target?.chatInput?.trim();
        const hasAttachments = target?.chatAttachments && target.chatAttachments.length > 0;
        if (!target || (!hasText && !hasAttachments)) return;

        const userMessage: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            text: target.chatInput?.trim() || '',
            images: target.chatAttachments || [],
            timestamp: Date.now()
        };

        // 先落地用户消息
        setImages(prev => prev.map(img => {
            if (img.id !== imageId) return img;
            const list = ensureInnovationItemList(img);
            const updated = list.map(it => it.id === innovationId ? {
                ...it,
                chatHistory: [...it.chatHistory, userMessage],
                chatInput: '',
                chatAttachments: [],
                isChatLoading: true,
                isChatOpen: true
            } : it);
            const syncedOutputs = (img.innovationOutputs && img.innovationOutputs.length > 0)
                ? img.innovationOutputs.map((text, idx) => updated[idx]?.text ?? text)
                : updated.map(it => it.text);
            return { ...img, innovationItems: updated, innovationOutputs: syncedOutputs, isInnovationOpen: true };
        }));

        try {
            const ai = getAiInstance();
            const history = [...(target.chatHistory || []), userMessage];
            const contents: any[] = [];

            if (image.base64Data) {
                contents.push({
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                mimeType: image.mimeType || 'image/png',
                                data: image.base64Data
                            }
                        },
                        {
                            text: `原始识别结果：${image.result || '无'}\n当前创新提示词：${target.text}\n请基于后续对话针对该创新提示词做定向修改、补充或重写，输出更新后的提示词。`
                        }
                    ]
                });
            }

            history.forEach(msg => {
                const parts: any[] = [];
                if (msg.images && msg.images.length > 0) {
                    msg.images.forEach(imgDataUrl => {
                        const match = imgDataUrl.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,(.+)$/);
                        const mimeType = match ? match[1] : 'image/png';
                        const data = match ? match[2] : imgDataUrl;
                        parts.push({
                            inlineData: {
                                mimeType,
                                data
                            }
                        });
                    });
                }
                if (msg.text) {
                    parts.push({ text: msg.text });
                }
                if (parts.length > 0) {
                    contents.push({
                        role: msg.role === 'user' ? 'user' : 'model',
                        parts
                    });
                }
            });

            const response = await ai.models.generateContent({
                model: imageModel,
                contents,
                config: {
                    systemInstruction: 'You are refining a single innovative AI image prompt. Keep answers concise and return the improved prompt directly.'
                }
            });

            const responseText = response.text || '无响应';
            const modelMessage: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: responseText,
                timestamp: Date.now()
            };

            setImages(prev => prev.map(img => {
                if (img.id !== imageId) return img;
                const list = ensureInnovationItemList(img);
                const updated = list.map(it => it.id === innovationId ? {
                    ...it,
                    chatHistory: [...it.chatHistory, modelMessage],
                    isChatLoading: false,
                    text: responseText
                } : it);
                const syncedOutputs = (img.innovationOutputs && img.innovationOutputs.length > 0)
                    ? img.innovationOutputs.map((text, idx) => updated[idx]?.text ?? text)
                    : updated.map(it => it.text);
                return { ...img, innovationItems: updated, innovationOutputs: syncedOutputs };
            }));

            // 创新对话完成后项目状态会自动保存
            if (user?.uid) {
            }
        } catch (error: any) {
            console.error('Innovation chat error:', error);
            const errorMessage: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: `错误: ${error.message || '请求失败'}`,
                timestamp: Date.now()
            };
            setImages(prev => prev.map(img => {
                if (img.id !== imageId) return img;
                const list = ensureInnovationItemList(img);
                const updated = list.map(it => it.id === innovationId ? {
                    ...it,
                    chatHistory: [...it.chatHistory, errorMessage],
                    isChatLoading: false
                } : it);
                const syncedOutputs = (img.innovationOutputs && img.innovationOutputs.length > 0)
                    ? img.innovationOutputs.map((text, idx) => updated[idx]?.text ?? text)
                    : updated.map(it => it.text);
                return { ...img, innovationItems: updated, innovationOutputs: syncedOutputs };
            }));
        }
    }, [getAiInstance, imageModel, images, setImages]);

    const copyInnovationChatHistory = useCallback((imageId: string, innovationId: string) => {
        const image = images.find(img => img.id === imageId);
        if (!image) return;
        const items = ensureInnovationItemList(image);
        const target = items.find(it => it.id === innovationId);
        if (!target || !target.chatHistory || target.chatHistory.length === 0) return;
        const historyText = target.chatHistory.map(msg => {
            const role = msg.role === 'user' ? '用户' : 'AI';
            const attachmentNote = msg.images && msg.images.length > 0 ? ` [含${msg.images.length}张图]` : '';
            return `[${role}]${attachmentNote} ${msg.text}`;
        }).join('\n');
        navigator.clipboard.writeText(historyText);
    }, [images]);

    const getInnovationOutputs = (image?: ImageItem) => {
        if (!image) return [];
        const items = ensureInnovationItemList(image);
        if (items.length > 0) return items.map(it => it.text);
        return image.innovationOutputs || [];
    };

    // 创新功能：复制创新结果
    const copyInnovation = useCallback((id: string) => {
        const image = images.find(img => img.id === id);
        const outputs = getInnovationOutputs(image);
        if (!image || outputs.length === 0) return;
        navigator.clipboard.writeText(outputs.join('\n\n'));
    }, [images]);

    // 翻译功能：智能识别中英文并翻译
    const translateText = useCallback(async (text: string): Promise<string> => {
        try {
            const ai = getAiInstance();
            // 检测语言并翻译
            const prompt = `请翻译以下文本。如果是中文，翻译成英文；如果是英文或其他语言，翻译成中文。只返回翻译结果，不要添加任何解释或前缀：

${text}`;
            const response = await ai.models.generateContent({
                model: imageModel || 'gemini-3-flash-preview',
                contents: prompt
            });
            return response.text?.trim() || text;
        } catch (error) {
            console.error('Translation failed:', error);
            throw error;
        }
    }, [getAiInstance, imageModel]);

    // 保存翻译结果到缓存
    const saveTranslation = useCallback((itemId: string, translatedText: string) => {
        setImages(prev => prev.map(img =>
            img.id === itemId ? { ...img, translatedResult: translatedText } : img
        ));
    }, [setImages]);

    // 保存选中翻译结果到缓存
    const saveSelection = useCallback((itemId: string, selectedText: string, translatedSelection: string) => {
        setImages(prev => prev.map(img =>
            img.id === itemId ? { ...img, lastSelectedText: selectedText, lastTranslatedSelection: translatedSelection } : img
        ));
    }, [setImages]);

    const handleBulkInnovation = useCallback(async () => {
        const readyImages = images.filter(img => img.status === 'success' && img.result && !img.isInnovating);
        if (readyImages.length === 0) {
            showToast('暂无可批量创新的图片，请先完成识别。');
            return;
        }
        setIsBulkInnovating(true);
        // 重置已用随机组合，确保批量创新时不同卡片使用不同组合
        resetUsedCombinations();
        try {
            for (const img of readyImages) {
                await startInnovation(img.id);
            }
        } finally {
            setIsBulkInnovating(false);
        }
    }, [images, startInnovation]);

    // 重试所有失败的创新
    const handleRetryFailedInnovation = useCallback(async () => {
        const failedImages = images.filter(img => img.innovationError && !img.isInnovating);
        if (failedImages.length === 0) {
            showToast('没有失败的创新需要重试');
            return;
        }
        setIsBulkInnovating(true);
        try {
            for (const img of failedImages) {
                await startInnovation(img.id);
            }
        } finally {
            setIsBulkInnovating(false);
        }
    }, [images, startInnovation]);

    // 重新生成所有创新（覆盖已有结果）
    const handleRegenerateAllInnovation = useCallback(async () => {
        const innovatedImages = images.filter(img =>
            img.status === 'success' &&
            img.result &&
            !img.isInnovating &&
            (getInnovationOutputs(img).length > 0 || img.innovationError)
        );
        if (innovatedImages.length === 0) {
            showToast('没有可重新生成的创新结果');
            return;
        }

        showConfirm(`确定要重新生成 ${innovatedImages.length} 个图片的创新结果吗？已有结果会被覆盖。`, async () => {
            setConfirmModal({ show: false, message: '', onConfirm: () => { } });
            setIsBulkInnovating(true);
            try {
                // 先清空已有的创新结果
                setImages(prev => prev.map(img =>
                    innovatedImages.some(i => i.id === img.id)
                        ? { ...img, innovationOutputs: undefined, innovationError: undefined }
                        : img
                ));
                for (const img of innovatedImages) {
                    await startInnovation(img.id);
                }
            } finally {
                setIsBulkInnovating(false);
            }
        });
    }, [images, startInnovation, showConfirm]);

    const handleExportInnovationRecords = useCallback(() => {
        const hasData = images.some(img => getInnovationOutputs(img).length > 0 || (ensureInnovationItemList(img).some(it => it.chatHistory.length > 0)));
        if (!hasData) {
            showToast('没有可导出的创新记录');
            return;
        }

        let exportText = `# AI 图片识别 - 创新导出\n`;
        exportText += `时间: ${new Date().toLocaleString()}\n`;
        exportText += `图片数量: ${images.length}\n`;
        exportText += `\n${'='.repeat(60)}\n\n`;

        images.forEach((img, idx) => {
            exportText += `## 图片 ${idx + 1}\n`;
            exportText += `原始输入: ${img.originalInput}\n`;
            exportText += `识别结果: ${img.result || '暂无'}\n`;
            const items = ensureInnovationItemList(img);
            if (items.length === 0) {
                exportText += `\n(暂无创新记录)\n\n${'-'.repeat(40)}\n\n`;
                return;
            }
            items.forEach((inv, invIdx) => {
                exportText += `\n- 创新 ${invIdx + 1}: ${inv.text || '(空)'}\n`;
                if (inv.chatHistory && inv.chatHistory.length > 0) {
                    exportText += `  对话记录:\n`;
                    inv.chatHistory.forEach(msg => {
                        const role = msg.role === 'user' ? '用户' : 'AI';
                        const note = msg.images && msg.images.length > 0 ? ` [含${msg.images.length}图]` : '';
                        exportText += `    [${role}]${note} ${msg.text}\n`;
                    });
                }
            });
            exportText += `\n${'-'.repeat(40)}\n\n`;
        });

        const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ai_image_innovation_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, [images]);

    const handleSendSingleToDesc = useCallback((imageId: string) => {
        const target = images.find(img => img.id === imageId);
        if (!target || !target.result) {
            return;
        }
        const payload = buildDescPayload([target]);
        const sent = sendToDescTool(payload, false);
        if (sent) {
            setSentToDescIds(prev => [...prev, imageId]);
            setTimeout(() => {
                setSentToDescIds(prev => prev.filter(id => id !== imageId));
            }, 2000);
        }
    }, [images, buildDescPayload, sendToDescTool]);

    const handleSendAllToDesc = useCallback(() => {
        const successOnes = images.filter(img => img.status === 'success' && img.result);
        const payload = buildDescPayload(successOnes);
        const sent = sendToDescTool(payload, false);
        if (sent) {
            setSentAllCount(payload.length);
            setTimeout(() => setSentAllCount(null), 2000);
        }
    }, [images, buildDescPayload, sendToDescTool]);

    // ==================== 创新模式 ====================
    const DEFAULT_ORIGINAL_DESC_PROMPT = `详细描述图片，不要图片中的文字。给我完整的AI描述词，方便我直接给其他软件生成图片或者视频使用。你只需要给我最终的AI描述词就行，不需要其他任何多余的内容。并且英文回复我。

关键细节要求：你对每个提示词的描述必须详尽且高度细致。切勿简略。

主体与场景：极其精确地描述所有主体、物体和角色。对于人物，详细说明其外貌、服装（面料、款式、颜色）、配饰、姿势、表情和动作。指定他们彼此之间以及与环境的空间关系。

构图与风格：明确定义镜头类型（如"特写"、"全景"）、摄像机角度（如"低角度"、"荷兰式倾斜角"）以及整体艺术风格（如"超写实 3D 渲染"、"印象派油画"、"动漫关键视觉图"）。

艺术元素：如果图像具有独特的艺术风格，你必须描述其具体特征。这包括笔触（如"明显的厚涂笔触"、"平滑融合的数字喷枪"）、线条（如"锐利、干净的赛璐璐阴影轮廓"、"草率、松散的铅笔线条"）、调色板（如"鲜艳的霓虹色"、"柔和、低饱和度的色调"）和光影（如"戏剧性的明暗对比照明"、"柔和、弥散的晨光"）。

环境：详细描述背景和前景，包括地点、时间、天气和特定的环境元素。

你只需要给我最终的AI描述词就行，不需要其他任何多余的内容。并且英文回复我。`;

    const DEFAULT_CREATIVE_INSTRUCTION = `请基于原始描述生成创新变体，保持核心主题但引入创意变化`;

    // 切换工作模式
    const setWorkMode = useCallback((mode: 'standard' | 'creative' | 'quick' | 'split') => {
        setState(prev => ({ ...prev, workMode: mode }));
    }, [setState]);

    // 构建拆分元素模式的 prompt
    const buildSplitPrompt = useCallback(() => {
        const elementsText = splitElements.map((e, i) => `${i + 1}. ${e}`).join('\n');
        return `${splitInstruction}\n\n【拆分元素库】\n${elementsText}\n\n【核心规则 - 极其重要】\n每个元素的描述必须"只描述该元素本身"，严禁混入其他元素的信息！\n- 描述"手持物品"时：只描述物品本身的外观、材质、颜色等，不要提及谁在拿着它、动作是什么\n- 描述"背景/场景"时：只描述场景环境本身，不要提及人物在场景中做什么\n- 描述"人物/主体"时：只描述人物的外貌特征，不要提及场景或物品\n- 描述"服装"时：只描述衣服本身的款式、颜色、材质，不要提及穿着者\n- 以此类推：每个元素都是"独立、纯粹"的描述，可以直接作为AI生图的局部提示词使用\n\n【输出格式要求】\n请严格按以下格式输出，每个元素占一行，用 ||| 分隔元素名称、中文描述和英文描述：\n${splitElements.map(e => `${e}|||（纯粹描述该元素本身的中文AI描述词）|||（纯粹描述该元素本身的英文AI描述词）`).join('\n')}\n\n⚠️⚠️⚠️【严禁翻译或改写元素名称】⚠️⚠️⚠️\n- 每行开头的元素名称必须与上方【拆分元素库】中的名称**完全一致**，一字不差\n- 禁止将中文元素名翻译成英文（例如「图片风格」不能写成「Image Style」）\n- 禁止改写、缩写或同义替换元素名（例如「背景风景」不能写成「Background」或「风景背景」）\n- 元素名就是用户给的原文，只有 ||| 后面的描述内容才分中英文\n\n注意：一行一个元素，使用 ||| 作为分隔符，每行格式为"元素名|||中文描述|||英文描述"。描述必须只包含该元素自身的特征，绝对不能掺杂其他元素的描述。`;
    }, [splitElements, splitInstruction]);

    // 解析拆分结果（支持双语格式：元素名|||zh|||en 或旧格式：元素名|||desc）
    const parseSplitResult = useCallback((result: string): Record<string, { zh: string; en: string }> => {
        const parsed: Record<string, { zh: string; en: string }> = {};
        const lines = result.split('\n').filter(l => l.includes('|||'));

        // 第一遍：尝试按名称精确匹配
        const unmatchedLineIndices: number[] = [];
        const matchedElements = new Set<string>();

        for (let lineIdx = 0; lineIdx < lines.length; lineIdx++) {
            const line = lines[lineIdx];
            const parts = line.split('|||');
            const name = parts[0]?.trim().replace(/^\d+\.\s*/, '').replace(/^\*+/, '').replace(/\*+$/, '').trim();
            if (!name) continue;

            // 精确匹配：完全相同
            let matchedElement = splitElements.find(e => e === name);
            // 模糊匹配：包含关系
            if (!matchedElement) {
                matchedElement = splitElements.find(e =>
                    !matchedElements.has(e) && (name.includes(e) || e.includes(name))
                );
            }

            if (matchedElement) {
                matchedElements.add(matchedElement);
                if (parts.length >= 3) {
                    parsed[matchedElement] = { zh: parts[1].trim(), en: parts[2].trim() };
                } else if (parts.length === 2) {
                    const desc = parts[1].trim();
                    const isChinese = /[\u4e00-\u9fff]/.test(desc);
                    parsed[matchedElement] = { zh: isChinese ? desc : '', en: isChinese ? '' : desc };
                }
            } else {
                unmatchedLineIndices.push(lineIdx);
            }
        }

        // 第二遍：位置回退 — 未匹配的行按顺序对应未匹配的 splitElements
        if (unmatchedLineIndices.length > 0) {
            const unmatchedElements = splitElements.filter(e => !matchedElements.has(e));
            for (let i = 0; i < Math.min(unmatchedLineIndices.length, unmatchedElements.length); i++) {
                const lineIdx = unmatchedLineIndices[i];
                const line = lines[lineIdx];
                const parts = line.split('|||');
                const element = unmatchedElements[i];
                if (parts.length >= 3) {
                    parsed[element] = { zh: parts[1].trim(), en: parts[2].trim() };
                } else if (parts.length === 2) {
                    const desc = parts[1].trim();
                    const isChinese = /[\u4e00-\u9fff]/.test(desc);
                    parsed[element] = { zh: isChinese ? desc : '', en: isChinese ? '' : desc };
                }
            }
        }

        return parsed;
    }, [splitElements]);

    // 复制拆分结果为 TSV（每个元素一列）
    const copySplitResults = useCallback((lang: 'zh' | 'en' = 'en') => {
        const successImages = images.filter(img => img.status === 'success' && img.result);
        if (successImages.length === 0) {
            showToast('没有可复制的结果');
            return;
        }
        // 表头
        const headerRow = splitElements.join('\t');
        // 数据行
        const dataRows = images.map(img => {
            if (img.status !== 'success' || !img.result) {
                return splitElements.map(() => '').join('\t');
            }
            const parsed = parseSplitResult(img.result);
            return splitElements.map(e => {
                const val = parsed[e]?.[lang] || parsed[e]?.en || parsed[e]?.zh || '';
                // TSV 格式规范
                if (val.includes('\n') || val.includes('\t') || val.includes('"')) {
                    return `"${val.replace(/"/g, '""')}"`;
                }
                return val;
            }).join('\t');
        });
        const tsv = [headerRow, ...dataRows].join('\n');
        navigator.clipboard.writeText(tsv);
        setCopySuccess(lang === 'zh' ? 'results-zh' : 'results');
        setTimeout(() => setCopySuccess(null), 2000);
    }, [images, splitElements, parseSplitResult]);

    // 复制拆分结果（含公式列）为 TSV
    const copySplitWithFormula = useCallback((lang: 'zh' | 'en' = 'en') => {
        const successImages = images.filter(img => img.status === 'success' && img.result);
        if (successImages.length === 0) {
            showToast('没有可复制的结果');
            return;
        }
        // 表头：公式 + 各元素
        const headerRow = ['公式', ...splitElements].join('\t');
        // 数据行
        const dataRows = images.map(img => {
            // 公式列
            const cleanInput = img.originalInput.replace(/^'+/, '');
            let formula = '';
            if (cleanInput.toUpperCase().startsWith('=IMAGE')) formula = cleanInput;
            else if (img.gyazoUrl) formula = `=IMAGE("${img.gyazoUrl}")`;
            else if (img.fetchUrl) formula = `=IMAGE("${img.fetchUrl}")`;

            if (img.status !== 'success' || !img.result) {
                return [formula, ...splitElements.map(() => '')].join('\t');
            }
            const parsed = parseSplitResult(img.result);
            const vals = splitElements.map(e => {
                const val = parsed[e]?.[lang] || parsed[e]?.en || parsed[e]?.zh || '';
                if (val.includes('\n') || val.includes('\t') || val.includes('"')) {
                    return `"${val.replace(/"/g, '""')}"`;
                }
                return val;
            });
            return [formula, ...vals].join('\t');
        });
        const tsv = [headerRow, ...dataRows].join('\n');
        navigator.clipboard.writeText(tsv);
        setCopySuccess(lang === 'zh' ? 'formula-zh' : 'formula-en');
        setTimeout(() => setCopySuccess(null), 2000);
    }, [images, splitElements, parseSplitResult]);

    // 设置创新个数
    const setCreativeCount = useCallback((count: number) => {
        setState(prev => ({ ...prev, creativeCount: count }));
    }, [setState]);

    // 设置创新指令
    const setCreativeInstruction = useCallback((instruction: string) => {
        setState(prev => ({ ...prev, creativeInstruction: instruction }));
    }, [setState]);

    // 设置是否需要原始描述词
    const setNeedOriginalDesc = useCallback((value: boolean) => {
        setState(prev => ({ ...prev, needOriginalDesc: value }));
    }, [setState]);

    // 设置原始描述词使用的预设ID
    const setOriginalDescPresetId = useCallback((presetId: string) => {
        setState(prev => ({ ...prev, originalDescPresetId: presetId }));
    }, [setState]);

    // 清空创新结果
    const clearCreativeResults = useCallback(() => {
        setState(prev => ({ ...prev, creativeResults: [] }));
    }, [setState]);

    // 创新模式核心处理函数
    // targetImageIds: 可选，指定要处理的图片ID列表。如果不传，处理所有图片
    const runCreativeAnalysis = useCallback(async (targetImageIds?: string[]) => {
        // 创新模式：处理所有有图片数据的图片（不限于idle状态）
        let readyImages = images.filter(img => img.base64Data);

        // 如果指定了目标图片，只处理这些图片
        if (targetImageIds && targetImageIds.length > 0) {
            readyImages = readyImages.filter(img => targetImageIds.includes(img.id));
        }

        if (readyImages.length === 0) {
            showToast('请先添加图片');
            return;
        }

        // 使用输入框的内容作为用户输入（用户特别要求）
        // 基础指令单独获取，不与用户输入混淆
        const userInput = prompt.trim(); // 用户在输入框中输入的内容（可选）

        // 获取基础指令
        let baseInstruction: string;
        if (workMode === 'quick') {
            const config = randomLibraryConfigRef.current;
            const activeSheet = config.activeSourceSheet || '';
            const linkedInstruction = config.linkedInstructions?.[activeSheet];
            if (linkedInstruction && linkedInstruction.trim()) {
                // 优先使用从表格导入的配套指令
                baseInstruction = linkedInstruction.trim();
                console.log('[快捷模式] 使用配套创新指令:', { activeSheet, instruction: baseInstruction.substring(0, 50) + '...' });
            } else {
                // 没有配套指令时，根据随机库是否启用来自动判断使用哪个预设
                const isRandomLibEnabled = config.enabled &&
                    config.libraries.some(lib => lib.enabled && lib.values.length > 0);
                const presetType = isRandomLibEnabled ? 'withRandomLib' : 'standard';
                const presets = DEFAULT_QUICK_INNOVATION_PRESETS;
                baseInstruction = presets[presetType] || DEFAULT_QUICK_INNOVATION_PRESETS[presetType];
                console.log('[快捷模式] 使用默认预设:', { presetType, isRandomLibEnabled, instruction: baseInstruction.substring(0, 50) + '...' });
            }
        } else {
            // 创新模式下，基础指令就是默认创新指令
            baseInstruction = DEFAULT_CREATIVE_INSTRUCTION;
        }

        // 构建最终有效指令（基础指令 + 用户输入）
        let effectiveInstruction = baseInstruction;
        if (userInput) {
            // 用户有特别要求时，添加到基础指令之后
            effectiveInstruction = `${baseInstruction}\n\n${USER_REQUIREMENT_TRANSITION}\n${userInput}`;
        }
        const count = creativeCount || 4;

        // 检查是否启用了高级创新模式（随机库）
        const isAdvancedMode = randomLibraryConfigRef.current.enabled &&
            randomLibraryConfigRef.current.libraries.some(lib => lib.enabled && lib.values.length > 0);

        // 调试日志 - 帮助诊断随机库状态
        console.log('[创新模式] 随机库配置检查:', {
            enabled: randomLibraryConfigRef.current.enabled,
            librariesCount: randomLibraryConfigRef.current.libraries.length,
            enabledLibraries: randomLibraryConfigRef.current.libraries.filter(lib => lib.enabled).map(lib => ({
                name: lib.name,
                valuesCount: lib.values.length,
                participationRate: lib.participationRate ?? 100
            })),
            isAdvancedMode,
            needOriginalDesc
        });

        // 重置已用随机组合
        if (isAdvancedMode) {
            resetUsedCombinations();
            console.log('[创新模式] 随机库已启用，将使用随机组合生成创新');
        } else {
            console.log('[创新模式] 随机库未启用或无有效库，将使用普通模式');
        }

        // 开始处理
        stoppedRef.current = false;
        pausedRef.current = false;
        setIsPaused(false);
        setIsProcessing(true);

        // 清空之前的创新结果
        setState(prev => ({ ...prev, creativeResults: [] }));

        const ai = getAiInstance();
        const modelId = imageModel;

        // 注意：多图融合创新模式已禁用，改为批量模式（每张图片单独创新）
        // 如果需要融合模式，可以在这里添加一个开关
        const useFusionMode = false; // TODO: 可以添加UI开关让用户选择

        // 多图融合创新模式（需要手动开启）
        if (useFusionMode && readyImages.length > 1) {
            // 标记所有图片为处理中
            setImages(prev => prev.map(img =>
                readyImages.some(r => r.id === img.id) ? { ...img, status: 'loading' } : img
            ));

            // 初始化融合创新结果（使用第一张图片的ID作为标识）
            const fusionId = 'fusion-' + readyImages.map(img => img.id).join('-').substring(0, 50);
            setState(prev => ({
                ...prev,
                creativeResults: [{
                    imageId: fusionId,
                    originalDesc: '',
                    innovations: [],
                    status: 'processing'
                }]
            }));

            try {
                // 构建多图 parts
                const imageParts = readyImages.map(img => ({
                    inlineData: { mimeType: img.mimeType!, data: img.base64Data! }
                }));

                // 检查是否使用随机库
                if (isAdvancedMode) {
                    // 高级创新模式：每个随机组合单独调用AI
                    let combinations: string[];
                    if (randomLibraryConfigRef.current.combinationMode === 'cartesian') {
                        combinations = generateCartesianCombinations(randomLibraryConfigRef.current);
                    } else {
                        combinations = generateMultipleUniqueCombinations(randomLibraryConfigRef.current, count);
                    }

                    console.log('[多图融合] 生成的组合:', {
                        combinationMode: randomLibraryConfigRef.current.combinationMode,
                        count,
                        combinationsLength: combinations.length
                    });

                    const results: string[] = [];

                    for (const randomCombination of combinations) {
                        const transitionInstruction = DEFAULT_TRANSITION_INSTRUCTION;
                        const priorityInstruction = getPriorityInstruction(!!userInput, true);

                        let finalInstruction: string;
                        // 顺序：基础指令+用户要求 -> 画面细节 -> 优先级说明
                        finalInstruction = `${effectiveInstruction}\n\n${transitionInstruction}\n${randomCombination}\n\n${priorityInstruction}`;

                        const singlePrompt = `
${finalInstruction}

请综合分析以上 ${readyImages.length} 张图片的内容、风格和元素，生成1个融合创意描述。
返回格式为JSON对象:
{"en": "完整的英文融合创意描述", "zh": "完整的中文翻译"}

只输出JSON对象，不要其他内容。`;

                        const singleResult = await retryWithBackoff(async () => {
                            const response = await ai.models.generateContent({
                                model: modelId,
                                contents: {
                                    parts: [
                                        ...imageParts,
                                        { text: singlePrompt }
                                    ]
                                },
                                config: {
                                    temperature: 0.85,
                                    responseMimeType: 'application/json'
                                }
                            });
                            return response.text || '';
                        }, 3, 2000, onRotateApiKey);

                        results.push(singleResult);
                    }

                    // 组合所有结果为JSON数组格式
                    const fusionResult = '[' + results.map(r => {
                        try {
                            const clean = r.replace(/```json/g, '').replace(/```/g, '').trim();
                            return clean;
                        } catch {
                            return r;
                        }
                    }).join(',') + ']';

                    // 解析创新结果
                    let innovations: Array<{ id: string; textEn: string; textZh: string }> = [];
                    try {
                        const parsed = JSON.parse(fusionResult);
                        if (Array.isArray(parsed)) {
                            innovations = parsed.map((p: any, idx: number) => ({
                                id: `inno-fusion-${idx}`,
                                textEn: p.en || p.textEn || p.prompt || '',
                                textZh: p.zh || p.textZh || ''
                            }));
                        }
                    } catch (parseError) {
                        console.warn('[Creative Fusion] JSON解析失败:', parseError);
                        innovations = [{
                            id: 'inno-fusion-0',
                            textEn: fusionResult,
                            textZh: '解析失败'
                        }];
                    }

                    // 更新所有图片状态为成功
                    setImages(prev => prev.map(img =>
                        readyImages.some(r => r.id === img.id) ? { ...img, status: 'success' } : img
                    ));

                    // 更新融合创新结果
                    setState(prev => ({
                        ...prev,
                        creativeResults: [{
                            imageId: fusionId,
                            originalDesc: `融合 ${readyImages.length} 张图片`,
                            innovations,
                            status: 'success'
                        }]
                    }));

                } else {
                    // 普通模式：多图融合创新提示词
                    const fusionPrompt = `
${effectiveInstruction}

请综合分析以上 ${readyImages.length} 张图片的内容、风格和元素，生成 ${count} 个融合创意描述。
要求：结合多张图片的核心元素，创作出融合多图特点的创新描述。

返回格式为JSON数组:
[
  {"en": "完整的英文融合创意描述1", "zh": "完整的中文翻译1"},
  {"en": "完整的英文融合创意描述2", "zh": "完整的中文翻译2"}
]

只输出JSON数组，不要其他内容。`;

                    const fusionResult = await retryWithBackoff(async () => {
                        const response = await ai.models.generateContent({
                            model: modelId,
                            contents: {
                                parts: [
                                    ...imageParts,
                                    { text: fusionPrompt }
                                ]
                            },
                            config: {
                                temperature: 0.8,
                                responseMimeType: 'application/json'
                            }
                        });
                        return response.text || '';
                    }, 3, 2000, onRotateApiKey);

                    // 解析创新结果
                    let innovations: Array<{ id: string; textEn: string; textZh: string }> = [];
                    try {
                        const cleanText = fusionResult.replace(/```json/g, '').replace(/```/g, '').trim();
                        const parsed = JSON.parse(cleanText);
                        if (Array.isArray(parsed)) {
                            innovations = parsed.slice(0, count).map((p: any, idx: number) => ({
                                id: `inno-fusion-${idx}`,
                                textEn: p.en || p.textEn || p.prompt || '',
                                textZh: p.zh || p.textZh || ''
                            }));
                        }
                    } catch (parseError) {
                        console.warn('[Creative Fusion] JSON解析失败:', parseError);
                        innovations = [{
                            id: 'inno-fusion-0',
                            textEn: fusionResult,
                            textZh: '解析失败'
                        }];
                    }

                    // 更新所有图片状态为成功
                    setImages(prev => prev.map(img =>
                        readyImages.some(r => r.id === img.id) ? { ...img, status: 'success' } : img
                    ));

                    // 更新融合创新结果
                    setState(prev => ({
                        ...prev,
                        creativeResults: [{
                            imageId: fusionId,
                            originalDesc: `融合 ${readyImages.length} 张图片`,
                            innovations,
                            status: 'success'
                        }]
                    }));
                }

            } catch (error: any) {
                console.error('[Creative Fusion] 错误:', error);
                setImages(prev => prev.map(img =>
                    readyImages.some(r => r.id === img.id) ? { ...img, status: 'error', errorMsg: error.message } : img
                ));
                setState(prev => ({
                    ...prev,
                    creativeResults: [{
                        imageId: fusionId,
                        originalDesc: '',
                        innovations: [],
                        status: 'error',
                        error: error.message
                    }]
                }));
            }

            setIsProcessing(false);
            return;
        }

        // 单图模式：保持原有逻辑
        await processWithConcurrency(readyImages, 2, async (item: ImageItem) => {
            if (stoppedRef.current) return;

            while (pausedRef.current && !stoppedRef.current) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }

            if (stoppedRef.current) return;

            // 标记为处理中
            setImages(prev => prev.map(img =>
                img.id === item.id ? { ...img, status: 'loading' } : img
            ));

            // 初始化该图片的创新结果
            setState(prev => ({
                ...prev,
                creativeResults: [
                    ...(prev.creativeResults || []),
                    {
                        imageId: item.id,
                        originalDesc: '',
                        innovations: [],
                        status: 'processing'
                    }
                ]
            }));

            try {
                if (!item.base64Data || !item.mimeType) throw new Error('No image data');

                // 获取该图片的追加指令作为用户特殊要求
                let itemUserInput = userInput; // 默认使用全局用户输入
                if (item.useCustomPrompt && item.customPrompt?.trim()) {
                    if (item.mergeWithGlobalPrompt ?? true) {
                        // 合并模式：全局用户输入 + 单独追加指令
                        itemUserInput = userInput ? `${userInput}\n${item.customPrompt.trim()}` : item.customPrompt.trim();
                    } else {
                        // 独立模式：仅使用单独追加指令
                        itemUserInput = item.customPrompt.trim();
                    }
                }

                // 重新构建该图片的effectiveInstruction
                let itemEffectiveInstruction = baseInstruction;
                if (itemUserInput) {
                    itemEffectiveInstruction = `${baseInstruction}\n\n${USER_REQUIREMENT_TRANSITION}\n${itemUserInput}`;
                }

                let originalDesc = '';
                let innovationResult = '';

                if (needOriginalDesc) {
                    // 模式A：先获取原始描述，再基于描述创新
                    // 第一步：使用固定的详细指令识别图片获取原始描述
                    const descPrompt = DEFAULT_ORIGINAL_DESC_PROMPT;
                    const descResponse = await retryWithBackoff(async () => {
                        const response = await ai.models.generateContent({
                            model: modelId,
                            contents: {
                                parts: [
                                    { inlineData: { mimeType: item.mimeType!, data: item.base64Data! } },
                                    { text: descPrompt }
                                ]
                            },
                            config: { temperature: 0.3 }
                        });
                        return response.text || '';
                    }, 3, 2000, onRotateApiKey);
                    originalDesc = descResponse;

                    // 更新原始描述到结果中
                    setState(prev => ({
                        ...prev,
                        creativeResults: (prev.creativeResults || []).map(r =>
                            r.imageId === item.id ? { ...r, originalDesc } : r
                        )
                    }));

                    // 第二步：基于描述生成创新（支持随机库）
                    if (isAdvancedMode) {
                        // 高级创新模式：每个随机组合单独调用AI
                        let combinations: string[];
                        if (randomLibraryConfigRef.current.combinationMode === 'cartesian') {
                            combinations = generateCartesianCombinations(randomLibraryConfigRef.current);
                        } else {
                            combinations = generateMultipleUniqueCombinations(randomLibraryConfigRef.current, count);
                        }
                        const results: string[] = [];

                        for (const randomCombination of combinations) {
                            const transitionInstruction = DEFAULT_TRANSITION_INSTRUCTION;
                            const priorityInstruction = getPriorityInstruction(!!itemUserInput, true);

                            // 顺序：基础指令+用户要求 -> 画面细节 -> 优先级说明
                            let finalInstruction: string;
                            finalInstruction = `${itemEffectiveInstruction}\n\n${transitionInstruction}\n${randomCombination}\n\n${priorityInstruction}`;

                            const singlePrompt = `
${finalInstruction}

请根据这张图片生成1个创意变体描述。
返回格式为JSON对象:
{"en": "完整的英文创意描述", "zh": "完整的中文翻译"}

只输出JSON对象，不要其他内容。`;

                            const singleResult = await retryWithBackoff(async () => {
                                const response = await ai.models.generateContent({
                                    model: modelId,
                                    contents: {
                                        parts: [
                                            { inlineData: { mimeType: item.mimeType!, data: item.base64Data! } },
                                            { text: singlePrompt }
                                        ]
                                    },
                                    config: {
                                        temperature: 0.85,
                                        responseMimeType: 'application/json'
                                    }
                                });
                                return response.text || '';
                            }, 3, 2000, onRotateApiKey);

                            results.push(singleResult);
                        }

                        // 组合所有结果为JSON数组格式
                        innovationResult = '[' + results.map(r => {
                            try {
                                const clean = r.replace(/```json/g, '').replace(/```/g, '').trim();
                                return clean;
                            } catch {
                                return r;
                            }
                        }).join(',') + ']';

                    } else {
                        // 普通模式：一次调用生成多个变体
                        const innovationPrompt = `
${itemEffectiveInstruction}

请根据这张图片生成 ${count} 个创意变体描述。
返回格式为JSON数组:
[
  {"en": "完整的英文创意描述1", "zh": "完整的中文翻译1"},
  {"en": "完整的英文创意描述2", "zh": "完整的中文翻译2"}
]

只输出JSON数组，不要其他内容。`;

                        innovationResult = await retryWithBackoff(async () => {
                            const response = await ai.models.generateContent({
                                model: modelId,
                                contents: {
                                    parts: [
                                        { inlineData: { mimeType: item.mimeType!, data: item.base64Data! } },
                                        { text: innovationPrompt }
                                    ]
                                },
                                config: {
                                    temperature: 0.8,
                                    responseMimeType: 'application/json'
                                }
                            });
                            return response.text || '';
                        }, 3, 2000, onRotateApiKey);
                    }

                } else {
                    // 模式B：直接基于图片和创新指令生成变体

                    if (isAdvancedMode) {
                        // 高级创新模式：每个随机组合单独调用AI
                        // 根据组合模式选择不同的生成方式
                        let combinations: string[];
                        if (randomLibraryConfigRef.current.combinationMode === 'cartesian') {
                            // 笛卡尔积模式：生成所有排列组合
                            combinations = generateCartesianCombinations(randomLibraryConfigRef.current);
                        } else {
                            // 整体随机模式：由创新个数控制
                            combinations = generateMultipleUniqueCombinations(randomLibraryConfigRef.current, count);
                        }

                        // 调试日志
                        console.log('[创新模式] 生成的组合:', {
                            combinationMode: randomLibraryConfigRef.current.combinationMode,
                            count,
                            combinationsLength: combinations.length,
                            combinations: combinations.slice(0, 3) // 只显示前3个
                        });

                        // 如果没有生成有效组合，使用普通模式
                        if (combinations.length === 0) {
                            console.warn('[创新模式] 警告：没有生成有效组合，回退到普通模式');
                        }

                        const results: string[] = [];

                        for (const randomCombination of combinations) {
                            // 获取过渡指令和动态优先级
                            const transitionInstruction = DEFAULT_TRANSITION_INSTRUCTION;
                            const priorityInstruction = getPriorityInstruction(!!itemUserInput, true);

                            // 顺序：基础指令+用户要求 -> 画面细节 -> 优先级说明
                            let finalInstruction: string;
                            finalInstruction = `${itemEffectiveInstruction}\n\n${transitionInstruction}\n${randomCombination}\n\n${priorityInstruction}`;

                            const singlePrompt = `${finalInstruction}

请根据这张图片生成1个创意变体描述。返回格式为JSON对象:
{"en": "完整的英文创意描述", "zh": "完整的中文翻译"}

只输出JSON对象，不要其他内容。`;

                            const singleResult = await retryWithBackoff(async () => {
                                const response = await ai.models.generateContent({
                                    model: modelId,
                                    contents: {
                                        parts: [
                                            { inlineData: { mimeType: item.mimeType!, data: item.base64Data! } },
                                            { text: singlePrompt }
                                        ]
                                    },
                                    config: {
                                        temperature: 0.85,
                                        responseMimeType: 'application/json'
                                    }
                                });
                                return response.text || '';
                            }, 3, 2000, onRotateApiKey);

                            results.push(singleResult);
                        }

                        // 组合所有结果为JSON数组格式
                        innovationResult = '[' + results.map(r => {
                            try {
                                const clean = r.replace(/```json/g, '').replace(/```/g, '').trim();
                                return clean;
                            } catch {
                                return r;
                            }
                        }).join(',') + ']';

                    } else {
                        // 普通模式：一次调用生成多个变体
                        const innovationPrompt = `
${itemEffectiveInstruction}

请根据这张图片生成 ${count} 个创意变体描述。返回格式为JSON数组:
[
  {"en": "完整的英文创意描述1", "zh": "完整的中文翻译1"},
  {"en": "完整的英文创意描述2", "zh": "完整的中文翻译2"}
]

只输出JSON数组，不要其他内容。`;

                        innovationResult = await retryWithBackoff(async () => {
                            const response = await ai.models.generateContent({
                                model: modelId,
                                contents: {
                                    parts: [
                                        { inlineData: { mimeType: item.mimeType!, data: item.base64Data! } },
                                        { text: innovationPrompt }
                                    ]
                                },
                                config: {
                                    temperature: 0.8,
                                    responseMimeType: 'application/json'
                                }
                            });
                            return response.text || '';
                        }, 3, 2000, onRotateApiKey);
                    }
                }

                // 解析创新结果
                let innovations: Array<{ id: string; textEn: string; textZh: string }> = [];
                try {
                    const cleanText = innovationResult.replace(/```json/g, '').replace(/```/g, '').trim();
                    const parsed = JSON.parse(cleanText);
                    if (Array.isArray(parsed)) {
                        innovations = parsed.slice(0, count).map((p: any, idx: number) => ({
                            id: `inno-${item.id}-${idx}`,
                            textEn: p.en || p.textEn || p.prompt || '',
                            textZh: p.zh || p.textZh || ''
                        }));
                    }
                } catch (parseError) {
                    console.warn('[Creative] JSON解析失败，使用原始文本:', parseError);
                    innovations = [{
                        id: `inno-${item.id}-0`,
                        textEn: innovationResult,
                        textZh: '解析失败'
                    }];
                }

                // 更新状态 - 成功（创新模式不更新result，避免在图片卡片显示）
                setImages(prev => prev.map(img =>
                    img.id === item.id ? { ...img, status: 'success' } : img
                ));

                setState(prev => ({
                    ...prev,
                    creativeResults: (prev.creativeResults || []).map(r =>
                        r.imageId === item.id
                            ? { ...r, innovations, status: 'success' }
                            : r
                    )
                }));

            } catch (error: any) {
                console.error('[Creative] 处理失败:', error);
                setImages(prev => prev.map(img =>
                    img.id === item.id ? { ...img, status: 'error', errorMsg: error.message } : img
                ));

                setState(prev => ({
                    ...prev,
                    creativeResults: (prev.creativeResults || []).map(r =>
                        r.imageId === item.id
                            ? { ...r, status: 'error', error: error.message }
                            : r
                    )
                }));
            }
        });

        setIsProcessing(false);
    }, [images, prompt, creativeCount, imageModel, needOriginalDesc, onRotateApiKey, setState, setImages, setIsProcessing]);

    // 复制创新结果（中英文两列，制表符分隔）
    const copyCreativeResults = useCallback(() => {
        const successResults = creativeResults.filter(r => r.status === 'success');
        if (successResults.length === 0) {
            showToast('没有可复制的创新结果');
            return;
        }

        // 格式：英文\t中文，每行一条，粘贴到表格时自动分两列
        const textLines: string[] = [];
        successResults.forEach(result => {
            result.innovations.forEach(inno => {
                textLines.push(`${inno.textEn}\t${inno.textZh || ''}`);
            });
        });

        navigator.clipboard.writeText(textLines.join('\n'));
        setCopySuccess('creative-all');
        setTimeout(() => setCopySuccess(null), 2000);
    }, [creativeResults]);

    // 复制所有英文创新结果
    const copyCreativeEN = useCallback(() => {
        const successResults = creativeResults.filter(r => r.status === 'success');
        if (successResults.length === 0) return;

        const textLines: string[] = [];
        successResults.forEach(result => {
            result.innovations.forEach(inno => {
                textLines.push(inno.textEn);
            });
        });

        // 使用单换行符分隔，粘贴到Google表格时每条结果进入单独的单元格
        navigator.clipboard.writeText(textLines.join('\n'));
        setCopySuccess('creative-en');
        setTimeout(() => setCopySuccess(null), 2000);
    }, [creativeResults]);

    // 复制所有中文创新结果
    const copyCreativeZH = useCallback(() => {
        const successResults = creativeResults.filter(r => r.status === 'success');
        if (successResults.length === 0) return;

        const textLines: string[] = [];
        successResults.forEach(result => {
            result.innovations.forEach(inno => {
                textLines.push(inno.textZh || inno.textEn);
            });
        });

        // 使用单换行符分隔，粘贴到Google表格时每条结果进入单独的单元格
        navigator.clipboard.writeText(textLines.join('\n'));
        setCopySuccess('creative-zh');
        setTimeout(() => setCopySuccess(null), 2000);
    }, [creativeResults]);


    // 卡片内添加融合图片
    const handleAddFusionImage = useCallback(async (imageId: string, file: File) => {
        // 生成 blob URL 用于显示
        const imageUrl = URL.createObjectURL(file);

        // 转换为 base64 用于 API 调用
        const reader = new FileReader();
        const base64Data = await new Promise<string>((resolve) => {
            reader.onload = () => resolve(reader.result as string);
            reader.readAsDataURL(file);
        });

        const newFusionImage = {
            id: uuidv4(),
            imageUrl,
            base64Data,
            role: 'inspiration' as const
        };

        setImages(prev => prev.map(img =>
            img.id === imageId
                ? { ...img, fusionImages: [...(img.fusionImages || []), newFusionImage] }
                : img
        ));
    }, []);
    handleAddFusionImageRef.current = handleAddFusionImage;

    // 卡片内删除融合图片
    const handleRemoveFusionImage = useCallback((imageId: string, fusionImageId: string) => {
        setImages(prev => prev.map(img => {
            if (img.id !== imageId) return img;
            const fusionImg = img.fusionImages?.find(f => f.id === fusionImageId);
            // 清理 blob URL
            if (fusionImg?.imageUrl?.startsWith('blob:')) {
                URL.revokeObjectURL(fusionImg.imageUrl);
            }
            return {
                ...img,
                fusionImages: img.fusionImages?.filter(f => f.id !== fusionImageId)
            };
        }));
    }, []);

    // 计算未上传的本地图片数量
    const unuploadedCount = images.filter(img =>
        img.sourceType === 'file' && !img.gyazoUrl && !img.isUploadingToGyazo
    ).length;

    // 是否有正在上传的图片
    const isUploading = images.some(img => img.isUploadingToGyazo);

    // 全局隐藏 textarea 的 ref，用于接收粘贴事件
    const globalPasteTextareaRef = useRef<HTMLTextAreaElement>(null);

    return (
        <>
            <div
                ref={containerRef}
                tabIndex={-1}
                className="h-full flex flex-col font-sans bg-zinc-950 text-zinc-100 outline-none"
                onClick={(e) => {
                    // 点击任意非输入区域时，聚焦隐藏的 textarea 以接收粘贴事件
                    const target = e.target as HTMLElement;
                    if ((workMode === 'creative' || workMode === 'quick') && selectedCardId && !target.closest('[data-image-card]')) {
                        setSelectedCardId(null);
                    }
                    const isEditingControl = !!target.closest('input, textarea, select, option, [contenteditable="true"]');
                    if (!isEditingControl) {
                        globalPasteTextareaRef.current?.focus();
                    }
                }}
            >
                {/* 全局隐藏的 textarea，始终存在以接收粘贴事件 */}
                <textarea
                    ref={globalPasteTextareaRef}
                    className="absolute -left-[9999px] top-0 w-px h-px opacity-0"
                    aria-hidden="true"
                />
                {/* 顶部固定工具栏 */}
                <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
                    {/* ===== 工具栏 ===== */}
                    {isToolbarCompact ? (
                        <CompactToolbar
                            images={images}
                            prompt={prompt}
                            imageModel={imageModel}
                            isProcessing={isProcessing}
                            isPaused={isPaused}
                            viewMode={viewMode}
                            autoUploadGyazo={autoUploadGyazo}
                            isBulkInnovating={isBulkInnovating}
                            copySuccess={copySuccess}
                            presets={presets}
                            templateState={templateState}
                            unifiedPresets={unifiedPresets}
                            unuploadedCount={unuploadedCount}
                            isUploading={isUploading}
                            workMode={workMode}
                            imageBatchSize={imageBatchSize}
                            setImageModel={setImageModel}
                            setPrompt={setPrompt}
                            setPresets={setPresets}
                            setViewMode={setViewMode}
                            setAutoUploadGyazo={setAutoUploadGyazo}
                            setWorkMode={setWorkMode}
                            setImageBatchSize={setImageBatchSize}
                            handleFiles={handleFiles}
                            handleTextPaste={handleTextPaste}
                            handleHtmlPaste={handleHtmlPaste}
                            runAnalysis={() => runAnalysis()}
                            handlePauseResume={handlePauseResume}
                            handleStop={handleStop}
                            copyAllLinks={copyAllLinks}
                            copyAllFormulas={copyAllFormulas}
                            copyAllResults={copyAllResults}
                            copyAllOriginalAndResults={copyAllOriginalAndResults}
                            handleBulkInnovation={handleBulkInnovation}
                            handleSendAllToDesc={handleSendAllToDesc}
                            uploadAllUnuploadedToGyazo={uploadAllUnuploadedToGyazo}
                            handleResetAndRun={handleResetAndRun}
                            handleRetryFailedAndRun={handleRetryFailedAndRun}
                            copySplitResults={copySplitResults}
                            setShowGlobalInnovationSettings={setShowGlobalInnovationSettings}
                            toggleToolbarCompact={toggleToolbarCompact}
                            setShowClearConfirm={setShowClearConfirm}
                            setImages={setImages}
                            showClearConfirm={showClearConfirm}
                        />
                    ) : (
                        <div className="max-w-none mx-auto px-4 py-2 space-y-3">
                            {/* 第一行：标题 + 进度统计 */}
                            <div className="flex items-center w-full gap-3">
                                <div className="flex items-center shrink-0 gap-2">
                                    <div className="bg-emerald-500/20 rounded-lg p-1.5">
                                        <Zap className="text-emerald-400 w-4 h-4" fill="currentColor" />
                                    </div>
                                    <h1 className="text-base font-bold tracking-tight text-white hidden xl:block">AI 图片识别</h1>
                                    {/* 查看更新按钮 */}
                                    <button
                                        onClick={() => setShowUpdateNotes(true)}
                                        className="flex items-center gap-1 px-2 py-1 text-[10px] text-emerald-400 hover:bg-emerald-900/30 rounded-lg transition-colors"
                                        title="查看最新更新"
                                    >
                                        <Sparkles size={12} />
                                        <span className="hidden lg:inline">更新说明</span>
                                    </button>
                                </div>

                                {/* 项目切换器 */}
                                <ProjectSwitcher
                                    moduleId="image-recognition"
                                    currentProject={currentProject}
                                    onProjectChange={handleProjectChange}
                                    onOpenFullPanel={() => setShowProjectPanel(true)}
                                />

                                {/* 中间操作区：上传 + 清空 + 视图 */}
                                <div className="flex-1 flex items-center min-w-0 gap-2 h-9">
                                    <div className="flex-1 h-full flex items-center min-w-[200px]">
                                        <DropZone
                                            onFilesDropped={handleFiles}
                                            onTextPasted={handleTextPaste}
                                            onHtmlPasted={handleHtmlPaste}
                                            hideOverlay={workMode === 'creative' || workMode === 'quick'}
                                            extraContent={
                                                showClearConfirm ? (
                                                    <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 h-[34px]">
                                                        <button onClick={() => { setImages([]); setShowClearConfirm(false); }} className="bg-red-600 hover:bg-red-500 rounded text-white transition-colors h-full px-2 text-[0.625rem] tooltip-bottom" data-tip="确认清空所有图片">确定</button>
                                                        <button onClick={() => setShowClearConfirm(false)} className="bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-300 transition-colors h-full px-2 text-[0.625rem] tooltip-bottom" data-tip="取消清空">取消</button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => setShowClearConfirm(true)}
                                                        disabled={images.length === 0}
                                                        className="flex items-center justify-center rounded-lg border border-red-900/30 bg-red-900/10 text-red-400 hover:bg-red-600 hover:text-white hover:border-red-500 transition-all disabled:opacity-30 shrink-0 ml-1 h-[34px] w-[34px] tooltip-bottom"
                                                        data-tip="清空列表"
                                                    >
                                                        <Trash2 size={14} />
                                                    </button>
                                                )
                                            }
                                        />
                                    </div>

                                    {/* 视图切换 */}
                                    <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 shrink-0 h-full items-center">
                                        <button onClick={() => setViewMode('compact')} className={`h-full flex items-center justify-center rounded-md transition-all w-8 tooltip-bottom ${viewMode === 'compact' ? 'bg-zinc-800 text-emerald-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`} data-tip="精简"><Rows3 size={14} /></button>
                                        <button onClick={() => setViewMode('list')} className={`h-full flex items-center justify-center rounded-md transition-all w-8 tooltip-bottom ${viewMode === 'list' ? 'bg-zinc-800 text-emerald-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`} data-tip="列表"><List size={14} /></button>
                                        <button onClick={() => setViewMode('grid')} className={`h-full flex items-center justify-center rounded-md transition-all w-8 tooltip-bottom ${viewMode === 'grid' ? 'bg-zinc-800 text-emerald-400 shadow-sm' : 'text-zinc-500 hover:text-zinc-300'}`} data-tip="网格"><LayoutGrid size={14} /></button>
                                    </div>

                                    {/* 模式切换 */}
                                    <div className="flex bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 shrink-0 h-full items-center">
                                        <button
                                            onClick={() => setWorkMode('standard')}
                                            className={`h-full flex items-center gap-1 px-2.5 rounded-md transition-all text-xs font-medium ${workMode === 'standard'
                                                ? 'bg-emerald-600/20 text-emerald-400 shadow-sm'
                                                : 'text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            <Zap size={12} fill={workMode === 'standard' ? 'currentColor' : 'none'} />
                                            标准
                                        </button>
                                        <button
                                            onClick={() => setWorkMode('creative')}
                                            className={`h-full flex items-center gap-1 px-2.5 rounded-md transition-all text-xs font-medium ${workMode === 'creative'
                                                ? 'bg-purple-600/20 text-purple-400 shadow-sm'
                                                : 'text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            <Sparkles size={12} fill={workMode === 'creative' ? 'currentColor' : 'none'} />
                                            创新
                                        </button>
                                        <button
                                            onClick={() => setWorkMode('quick')}
                                            className={`h-full flex items-center gap-1 px-2.5 rounded-md transition-all text-xs font-medium ${workMode === 'quick'
                                                ? 'bg-orange-600/20 text-orange-400 shadow-sm'
                                                : 'text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            <Zap size={12} fill={workMode === 'quick' ? 'currentColor' : 'none'} />
                                            快捷
                                        </button>
                                        <button
                                            onClick={() => setWorkMode('split')}
                                            className={`h-full flex items-center gap-1 px-2.5 rounded-md transition-all text-xs font-medium ${workMode === 'split'
                                                ? 'bg-cyan-600/20 text-cyan-400 shadow-sm'
                                                : 'text-zinc-500 hover:text-zinc-300'}`}
                                        >
                                            <LayoutGrid size={12} />
                                            拆分
                                        </button>
                                    </div>
                                </div>

                                {/* 右侧：Gyazo 设置 + 一键上传 */}
                                <div className="flex items-center shrink-0 border-l border-zinc-800 gap-3 pl-3">

                                    {/* Gyazo 开关 */}
                                    <div className="flex items-center gap-2">
                                        <button
                                            onClick={() => setAutoUploadGyazo(!autoUploadGyazo)}
                                            className={`relative inline-flex items-center rounded-full transition-colors focus:outline-none h-4 w-7 tooltip-bottom ${autoUploadGyazo ? 'bg-blue-600' : 'bg-zinc-700'}`}
                                            data-tip={autoUploadGyazo ? '已开启：本地图片自动上传到 Gyazo ' : '已关闭：本地图片不上传'}
                                        >
                                            <span
                                                className={`inline-block transform rounded-full bg-white transition-transform h-2.5 w-2.5 ${autoUploadGyazo ? 'translate-x-3.5' : 'translate-x-0.5'}`}
                                            />
                                        </button>
                                        <span className={`text-[0.625rem] font-medium cursor-pointer select-none ${autoUploadGyazo ? 'text-blue-400' : 'text-zinc-500'}`} onClick={() => setAutoUploadGyazo(!autoUploadGyazo)}>
                                            Gyazo
                                        </span>
                                    </div>


                                    {unuploadedCount > 0 && (
                                        <button
                                            onClick={uploadAllUnuploadedToGyazo}
                                            disabled={isUploading}
                                            className={`flex items-center gap-1 rounded-full font-bold uppercase tracking-wide transition-all px-2 py-1 text-[0.625rem] ${isUploading
                                                ? 'bg-blue-900/30 text-blue-400 border border-blue-500/30 animate-pulse'
                                                : 'bg-orange-600/20 text-orange-400 border border-orange-500/30 hover:bg-orange-600 hover:text-white'
                                                }`}
                                        >
                                            {isUploading ? <Loader2 size={12} className="animate-spin" /> : <Upload size={12} />}
                                            {isUploading ? '..' : `上传 ${unuploadedCount}`}
                                        </button>
                                    )}

                                    {/* 项目管理按钮 */}
                                    <button
                                        onClick={() => setShowProjectPanel(true)}
                                        className="flex items-center justify-center w-6 h-6 rounded-md text-zinc-500 hover:text-amber-400 hover:bg-zinc-800 transition-colors tooltip-bottom"
                                        data-tip="项目管理"
                                    >
                                        📁
                                    </button>

                                    {/* 收起按钮 */}
                                    <button
                                        onClick={toggleToolbarCompact}
                                        className="flex items-center justify-center w-6 h-6 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors ml-1 tooltip-bottom"
                                        data-tip="收起工具栏"
                                    >
                                        <ChevronUp size={16} />
                                    </button>
                                </div>
                            </div>

                            {/* 第二行：指令和操作区 */}
                            <div className="grid grid-cols-1 lg:grid-cols-5 gap-3 items-start">
                                {/* 指令输入区 - 快捷模式和拆分模式下隐藏（使用自动生成的指令） */}
                                {workMode !== 'quick' && workMode !== 'split' && (
                                    <div className="lg:col-span-3 min-w-0">
                                        <PromptManager
                                            prompt={prompt}
                                            setPrompt={setPrompt}
                                            presets={presets}
                                            setPresets={setPresets}
                                            compact
                                            templateState={templateState}
                                            unifiedPresets={unifiedPresets}
                                            pureReplyMode={pureReplyMode}
                                            setPureReplyMode={setPureReplyMode}
                                            workMode={workMode}
                                        />
                                    </div>
                                )}

                                {/* 右侧工具栏 - 根据模式条件渲染 */}
                                {workMode === 'standard' && (
                                    <div className="lg:col-span-2 flex flex-col gap-2">
                                        {/* 1. 复制按钮网格 */}
                                        <div className="grid grid-cols-4 gap-1.5">
                                            {(() => {
                                                const hasImages = images.length > 0;
                                                const successCount = images.filter(i => i.status === 'success').length;
                                                const hasResults = successCount > 0;

                                                const btnBaseClass = "flex items-center justify-center gap-1.5 px-1 py-1.5 rounded-md text-[0.6875rem] font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95";

                                                return (
                                                    <>
                                                        <button
                                                            onClick={copyAllLinks}
                                                            disabled={!hasImages}
                                                            className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'links'
                                                                ? 'bg-emerald-600 text-white border-emerald-500'
                                                                : 'text-blue-400 hover:text-white bg-blue-900/20 hover:bg-blue-800/30 border-blue-800/30'
                                                                }`}
                                                            data-tip="复制全部图片链接"
                                                        >
                                                            {copySuccess === 'links' ? <Check size={12} /> : <Link size={12} />}
                                                            原始链接
                                                        </button>

                                                        <button
                                                            onClick={copyAllFormulas}
                                                            disabled={!hasImages}
                                                            className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'formulas'
                                                                ? 'bg-emerald-600 text-white border-emerald-500'
                                                                : 'text-orange-400 hover:text-white bg-orange-900/20 hover:bg-orange-800/30 border-orange-800/30'
                                                                }`}
                                                            data-tip="复制全部 IMAGE 公式"
                                                        >
                                                            {copySuccess === 'formulas' ? <Check size={12} /> : <FileCode size={12} />}
                                                            原始公式
                                                        </button>

                                                        <button
                                                            onClick={copyAllResults}
                                                            disabled={!hasResults}
                                                            className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'results'
                                                                ? 'bg-emerald-600 text-white border-emerald-500'
                                                                : 'text-emerald-400 hover:text-white bg-emerald-900/20 hover:bg-emerald-800/30 border-emerald-800/30'
                                                                }`}
                                                            data-tip="只复制识别结果"
                                                        >
                                                            {copySuccess === 'results' ? <Check size={12} /> : <ClipboardCopy size={12} />}
                                                            识别结果
                                                        </button>

                                                        <button
                                                            onClick={copyAllOriginalAndResults}
                                                            disabled={!hasResults}
                                                            className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'original'
                                                                ? 'bg-emerald-600 text-white border-emerald-500'
                                                                : 'text-purple-400 hover:text-white bg-purple-900/20 hover:bg-purple-800/30 border-purple-800/30'
                                                                }`}
                                                            data-tip="复制 公式 + 结果 (Tab分隔)"
                                                        >
                                                            {copySuccess === 'original' ? <Check size={12} /> : <LayoutGrid size={12} />}
                                                            原+结果
                                                        </button>
                                                    </>
                                                );
                                            })()}
                                        </div>

                                        {/* 创新快捷操作 - 单行紧凑版 */}
                                        {(() => {
                                            const canBulk = images.some(i => i.status === 'success' && i.result && !i.isInnovating);
                                            const canExport = images.some(img => getInnovationOutputs(img).length > 0 || (ensureInnovationItemList(img).some(it => it.chatHistory.length > 0)));
                                            const btnBase = "flex-1 flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[0.65rem] font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95";
                                            return (
                                                <div className="flex gap-1.5">
                                                    <div className="flex gap-0.5 flex-1">
                                                        <button
                                                            onClick={handleBulkInnovation}
                                                            disabled={!canBulk || isBulkInnovating}
                                                            className={`${btnBase} tooltip-bottom ${isBulkInnovating ? 'bg-pink-700 text-white border-pink-600 animate-pulse' : 'text-pink-300 bg-pink-900/20 hover:bg-pink-800/30 border-pink-800/40'}`}
                                                            data-tip="对所有已识别的图片执行创新"
                                                        >
                                                            {isBulkInnovating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
                                                            创新
                                                        </button>
                                                        <button
                                                            onClick={() => setShowGlobalInnovationSettings(true)}
                                                            className="px-1.5 py-1.5 rounded-md text-[0.65rem] font-medium border transition-all active:scale-95 text-zinc-400 bg-zinc-800/50 hover:bg-zinc-700/50 border-zinc-700/50 hover:text-zinc-200 tooltip-bottom"
                                                            data-tip="批量创新设置"
                                                        >
                                                            <Settings2 size={11} />
                                                        </button>
                                                    </div>
                                                    {/* 重新生成 */}
                                                    <button
                                                        onClick={handleRegenerateAllInnovation}
                                                        disabled={!images.some(img => getInnovationOutputs(img).length > 0 || img.innovationError) || isBulkInnovating}
                                                        className={`${btnBase} tooltip-bottom text-amber-300 bg-amber-900/20 hover:bg-amber-800/30 border-amber-800/40`}
                                                        data-tip="重新生成所有已创新的结果"
                                                    >
                                                        <RotateCw size={11} />
                                                        重生成
                                                    </button>
                                                    {/* 重试失败 */}
                                                    <button
                                                        onClick={handleRetryFailedInnovation}
                                                        disabled={!images.some(img => img.innovationError) || isBulkInnovating}
                                                        className={`${btnBase} tooltip-bottom text-red-300 bg-red-900/20 hover:bg-red-800/30 border-red-800/40`}
                                                        data-tip="重试所有失败的创新"
                                                    >
                                                        <RotateCw size={11} />
                                                        重试
                                                    </button>
                                                    {/* 导出创新 */}
                                                    <button
                                                        onClick={handleExportInnovationRecords}
                                                        disabled={!canExport}
                                                        className={`${btnBase} tooltip-bottom ${canExport ? 'text-emerald-300 bg-emerald-900/20 hover:bg-emerald-800/30 border-emerald-800/40' : 'text-zinc-500 bg-zinc-800/40 border-zinc-700/40'}`}
                                                        data-tip="导出创新结果与对话记录"
                                                    >
                                                        <Download size={11} />
                                                        导出
                                                    </button>
                                                    {/* 批量送去创新 */}
                                                    <button
                                                        onClick={handleSendAllToDesc}
                                                        disabled={images.filter(i => i.status === 'success' && i.result).length === 0}
                                                        className={`${btnBase} tooltip-bottom ${sentAllCount !== null ? 'text-emerald-300 bg-emerald-800/30 border-emerald-600/50' : 'text-blue-200 bg-blue-900/20 hover:bg-blue-800/30 border-blue-800/40'}`}
                                                        data-tip={sentAllCount !== null ? `已发送 ${sentAllCount} 条` : '一键发送到提示词创新'}
                                                    >
                                                        {sentAllCount !== null ? <Check size={11} /> : <Share2 size={11} />}
                                                        {sentAllCount !== null ? `已发${sentAllCount}` : '送创新'}
                                                    </button>
                                                </div>
                                            );
                                        })()}

                                        {/* 状态统计与主控 */}
                                        <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-zinc-800/50">
                                            {/* 状态统计条 */}
                                            <div className="grid grid-cols-4 gap-1.5 mb-1">
                                                <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/40 text-zinc-400 hover:bg-zinc-800/60 transition-colors cursor-default tooltip-bottom" data-tip="队列">
                                                    <span className="text-[0.6875rem] font-medium">队列</span>
                                                    <span className="text-xs font-bold text-zinc-200 font-mono">{images.length}</span>
                                                </div>
                                                <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors cursor-default tooltip-bottom" data-tip="待处理">
                                                    <span className="text-[0.6875rem] font-medium">待处理</span>
                                                    <span className="text-xs font-bold text-amber-300 font-mono">{images.filter(i => i.status === 'idle' && i.base64Data).length}</span>
                                                </div>
                                                <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-default tooltip-bottom" data-tip="成功">
                                                    <span className="text-[0.6875rem] font-medium">成功</span>
                                                    <span className="text-xs font-bold text-emerald-300 font-mono">{images.filter(i => i.status === 'success').length}</span>
                                                </div>
                                                <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors cursor-default tooltip-bottom" data-tip="失败">
                                                    <span className="text-[0.6875rem] font-medium">失败</span>
                                                    <span className="text-xs font-bold text-red-300 font-mono">{images.filter(i => i.status === 'error').length}</span>
                                                </div>
                                            </div>

                                            {/* 图片批次设置 */}
                                            <div className="flex items-center justify-between gap-2 py-1.5 px-1">
                                                <span className="text-[0.6875rem] text-zinc-400">批次模式</span>
                                                <div className="flex bg-zinc-900 rounded p-0.5 border border-zinc-800">
                                                    {[1, 3, 5, 8].map(size => (
                                                        <button
                                                            key={size}
                                                            onClick={() => setImageBatchSize(size)}
                                                            className={`px-2 py-0.5 rounded text-[0.625rem] font-medium transition-colors ${imageBatchSize === size
                                                                ? size === 1
                                                                    ? 'bg-zinc-700 text-zinc-200'
                                                                    : 'bg-cyan-600/30 text-cyan-300'
                                                                : 'text-zinc-500 hover:text-zinc-300'
                                                                }`}
                                                            data-tip={size === 1 ? '逐张处理' : `每 ${size} 张图合并为一次 API 调用`}
                                                        >
                                                            {size === 1 ? '单张' : `${size}张`}
                                                        </button>
                                                    ))}
                                                </div>
                                            </div>

                                            {/* 控制按钮 */}
                                            {!isProcessing ? (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => runAnalysis()}
                                                        disabled={!prompt.trim() || images.filter(i => i.status === 'idle' && i.base64Data).length === 0}
                                                        className={`
                                            flex-1 py-2 rounded-lg font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-all shadow-lg min-w-[100px]
                                            ${!prompt.trim() || images.filter(i => i.status === 'idle' && i.base64Data).length === 0
                                                                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                                                                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-900/20 hover:shadow-emerald-900/40 hover:-translate-y-0.5'
                                                            }
                                        `}
                                                        data-tip="开始对待处理的图片进行 AI 识别"
                                                    >
                                                        <Zap size={16} fill="currentColor" /> 开始识别
                                                    </button>

                                                    {/* 辅助按钮 */}
                                                    {images.filter(i => i.status === 'idle' && i.base64Data).length === 0 &&
                                                        images.filter(i => (i.status === 'success' || i.status === 'error') && i.base64Data).length > 0 && (
                                                            <button
                                                                onClick={handleResetAndRun}
                                                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 shadow-sm hover:shadow-blue-500/20 shrink-0 tooltip-bottom"
                                                                data-tip="重新将所有图片设为待处理并立即开始"
                                                            >
                                                                <RotateCw size={14} /> 全部重跑
                                                            </button>
                                                        )}

                                                    {images.filter(i => i.status === 'error').length > 0 && (
                                                        <button
                                                            onClick={handleRetryFailedAndRun}
                                                            className="px-4 py-2 bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 shrink-0 tooltip-bottom"
                                                            data-tip="仅重试失败的任务"
                                                        >
                                                            <RotateCw size={14} /> 重试失败 ({images.filter(i => i.status === 'error').length})
                                                        </button>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="grid grid-cols-2 gap-2">
                                                    <button
                                                        onClick={handlePauseResume}
                                                        className={`py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all ${isPaused
                                                            ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                                            : 'bg-amber-600 hover:bg-amber-500 text-white'
                                                            }`}
                                                        data-tip={isPaused ? '继续处理队列' : '暂停处理队列'}
                                                    >
                                                        {isPaused ? <><Play size={16} fill="currentColor" /> 继续</> : <><Pause size={16} fill="currentColor" /> 暂停</>}
                                                    </button>
                                                    <button
                                                        onClick={handleStop}
                                                        className="py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 bg-zinc-800 hover:bg-red-600/90 text-zinc-300 hover:text-white transition-all tooltip-bottom"
                                                        data-tip="停止处理并清除队列"
                                                    >
                                                        <Square size={16} fill="currentColor" /> 停止
                                                    </button>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* 拆分元素模式工具栏 */}
                                {workMode === 'split' && (
                                    <div className="lg:col-span-5 flex flex-col gap-2">
                                        {/* 元素库标签 + 操作 */}
                                        <div className="flex items-start gap-2">
                                            {/* 元素标签区 */}
                                            <div className="flex-1 flex flex-wrap items-center gap-1.5 min-h-[32px] p-1.5 rounded-lg border border-cyan-800/30 bg-cyan-950/20">
                                                {splitElements.map((el, idx) => (
                                                    <span key={idx} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-md text-xs font-medium bg-cyan-900/40 text-cyan-300 border border-cyan-700/40">
                                                        {el}
                                                        <button
                                                            onClick={() => setSplitElements(prev => prev.filter((_, i) => i !== idx))}
                                                            className="hover:text-red-400 transition-colors ml-0.5"
                                                        >
                                                            <X size={10} />
                                                        </button>
                                                    </span>
                                                ))}
                                                {/* 添加新元素 */}
                                                <form
                                                    onSubmit={e => {
                                                        e.preventDefault();
                                                        const vals = splitElementInput.split(/[,，]/).map(v => v.trim()).filter(v => v && !splitElements.includes(v));
                                                        if (vals.length > 0) {
                                                            setSplitElements(prev => [...prev, ...vals]);
                                                            setSplitElementInput('');
                                                        }
                                                    }}
                                                    className="inline-flex items-center"
                                                >
                                                    <input
                                                        value={splitElementInput}
                                                        onChange={e => setSplitElementInput(e.target.value)}
                                                        placeholder="+ 添加元素"
                                                        className="w-20 px-1.5 py-0.5 text-xs bg-transparent border-none outline-none text-zinc-400 placeholder:text-zinc-600"
                                                    />
                                                </form>
                                            </div>
                                            {/* 操作按钮 */}
                                            <div className="flex items-center gap-1 shrink-0">
                                                <button
                                                    onClick={() => setShowSplitSettings(true)}
                                                    className="p-1.5 rounded-md text-zinc-400 hover:text-cyan-400 hover:bg-cyan-950/30 transition-all tooltip-bottom"
                                                    data-tip="编辑指令"
                                                >
                                                    <Settings size={14} />
                                                </button>
                                                <button
                                                    onClick={() => { setSplitElements(DEFAULT_SPLIT_ELEMENTS); setSplitInstruction(DEFAULT_SPLIT_INSTRUCTION); }}
                                                    className="p-1.5 rounded-md text-zinc-400 hover:text-orange-400 hover:bg-orange-950/30 transition-all tooltip-bottom"
                                                    data-tip="恢复默认"
                                                >
                                                    <RotateCw size={14} />
                                                </button>
                                            </div>
                                        </div>

                                        {/* 操作行 */}
                                        <div className="flex flex-col gap-2">
                                            {/* 1. 复制按钮网格 - 和标准模式样式一致 */}
                                            <div className="grid grid-cols-3 gap-1.5">
                                                {(() => {
                                                    const hasImages = images.length > 0;
                                                    const successCount = images.filter(i => i.status === 'success').length;
                                                    const hasResults = successCount > 0;
                                                    const btnBaseClass = "flex items-center justify-center gap-1.5 px-1 py-1.5 rounded-md text-[0.6875rem] font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95";

                                                    return (
                                                        <>
                                                            <button
                                                                onClick={copyAllLinks}
                                                                disabled={!hasImages}
                                                                className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'links'
                                                                    ? 'bg-emerald-600 text-white border-emerald-500'
                                                                    : 'text-blue-400 hover:text-white bg-blue-900/20 hover:bg-blue-800/30 border-blue-800/30'
                                                                    }`}
                                                                data-tip="复制全部图片链接"
                                                            >
                                                                {copySuccess === 'links' ? <Check size={12} /> : <Link size={12} />}
                                                                原始链接
                                                            </button>

                                                            <button
                                                                onClick={copyAllFormulas}
                                                                disabled={!hasImages}
                                                                className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'formulas'
                                                                    ? 'bg-emerald-600 text-white border-emerald-500'
                                                                    : 'text-orange-400 hover:text-white bg-orange-900/20 hover:bg-orange-800/30 border-orange-800/30'
                                                                    }`}
                                                                data-tip="复制全部 IMAGE 公式"
                                                            >
                                                                {copySuccess === 'formulas' ? <Check size={12} /> : <FileCode size={12} />}
                                                                原始公式
                                                            </button>

                                                            <button
                                                                onClick={() => copySplitResults('zh')}
                                                                disabled={!hasResults}
                                                                className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'results-zh'
                                                                    ? 'bg-emerald-600 text-white border-emerald-500'
                                                                    : 'text-orange-400 hover:text-white bg-orange-900/20 hover:bg-orange-800/30 border-orange-800/30'
                                                                    }`}
                                                                data-tip="复制全部中文拆分结果 (TSV格式)"
                                                            >
                                                                {copySuccess === 'results-zh' ? <Check size={12} /> : <Copy size={12} />}
                                                                复制中文
                                                            </button>

                                                            <button
                                                                onClick={() => copySplitResults('en')}
                                                                disabled={!hasResults}
                                                                className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'results'
                                                                    ? 'bg-emerald-600 text-white border-emerald-500'
                                                                    : 'text-emerald-400 hover:text-white bg-emerald-900/20 hover:bg-emerald-800/30 border-emerald-800/30'
                                                                    }`}
                                                                data-tip="复制全部英文拆分结果 (TSV格式)"
                                                            >
                                                                {copySuccess === 'results' ? <Check size={12} /> : <ClipboardCopy size={12} />}
                                                                复制英文
                                                            </button>

                                                            <button
                                                                onClick={() => copySplitWithFormula('zh')}
                                                                disabled={!hasResults}
                                                                className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'formula-zh'
                                                                    ? 'bg-emerald-600 text-white border-emerald-500'
                                                                    : 'text-cyan-400 hover:text-white bg-cyan-900/20 hover:bg-cyan-800/30 border-cyan-800/30'
                                                                    }`}
                                                                data-tip="复制 IMAGE公式 + 中文拆分结果 (TSV格式)"
                                                            >
                                                                {copySuccess === 'formula-zh' ? <Check size={12} /> : <><FileCode size={10} /><Copy size={10} /></>}
                                                                公式+中文
                                                            </button>

                                                            <button
                                                                onClick={() => copySplitWithFormula('en')}
                                                                disabled={!hasResults}
                                                                className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'formula-en'
                                                                    ? 'bg-emerald-600 text-white border-emerald-500'
                                                                    : 'text-purple-400 hover:text-white bg-purple-900/20 hover:bg-purple-800/30 border-purple-800/30'
                                                                    }`}
                                                                data-tip="复制 IMAGE公式 + 英文拆分结果 (TSV格式)"
                                                            >
                                                                {copySuccess === 'formula-en' ? <Check size={12} /> : <><FileCode size={10} /><ClipboardCopy size={10} /></>}
                                                                公式+英文
                                                            </button>
                                                        </>
                                                    );
                                                })()}
                                            </div>

                                            {/* 2. 控制按钮 */}
                                            {!isProcessing ? (
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => {
                                                            runAnalysis(undefined, buildSplitPrompt());
                                                        }}
                                                        disabled={images.filter(i => i.status === 'idle' && i.base64Data).length === 0}
                                                        className={`
                                                            flex-1 py-2 rounded-lg font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-all shadow-lg min-w-[100px]
                                                            ${images.filter(i => i.status === 'idle' && i.base64Data).length === 0
                                                                ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                                                                : 'bg-gradient-to-r from-cyan-600 to-blue-600 text-white hover:from-cyan-500 hover:to-blue-500 hover:-translate-y-0.5 shadow-cyan-900/20'
                                                            }
                                                        `}
                                                        data-tip="开始对待处理的图片进行拆分识别"
                                                    >
                                                        <Zap size={16} fill="currentColor" /> 开始拆分识别
                                                    </button>

                                                    {/* 全部重跑 */}
                                                    {images.filter(i => i.status === 'idle' && i.base64Data).length === 0 &&
                                                        images.filter(i => (i.status === 'success' || i.status === 'error') && i.base64Data).length > 0 && (
                                                            <button
                                                                onClick={handleResetAndRun}
                                                                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 shadow-sm hover:shadow-blue-500/20 shrink-0 tooltip-bottom"
                                                                data-tip="重新将所有图片设为待处理并立即开始"
                                                            >
                                                                <RotateCw size={14} /> 全部重跑
                                                            </button>
                                                        )}

                                                    {/* 重试失败 */}
                                                    {images.filter(i => i.status === 'error').length > 0 && (
                                                        <button
                                                            onClick={handleRetryFailedAndRun}
                                                            className="px-4 py-2 bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 shrink-0 tooltip-bottom"
                                                            data-tip="仅重试失败的任务"
                                                        >
                                                            <RotateCw size={14} /> 重试失败 ({images.filter(i => i.status === 'error').length})
                                                        </button>
                                                    )}
                                                </div>
                                            ) : (
                                                <div className="flex flex-col gap-1.5">
                                                    {/* 进度条 */}
                                                    <div className="flex items-center gap-2">
                                                        <div className="flex-1 h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                                                            <div
                                                                className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-300"
                                                                style={{ width: `${images.length > 0 ? (images.filter(i => i.status === 'success' || i.status === 'error').length / images.length * 100) : 0}%` }}
                                                            />
                                                        </div>
                                                        <span className="text-xs text-cyan-400 font-medium shrink-0">
                                                            {images.filter(i => i.status === 'success').length}/{images.length}
                                                            {images.filter(i => i.status === 'error').length > 0 && (
                                                                <span className="text-red-400 ml-1">({images.filter(i => i.status === 'error').length}失败)</span>
                                                            )}
                                                        </span>
                                                    </div>
                                                    {/* 控制按钮 */}
                                                    <div className="grid grid-cols-2 gap-2">
                                                        <button
                                                            onClick={handlePauseResume}
                                                            className={`py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 transition-all ${isPaused
                                                                ? 'bg-emerald-600 hover:bg-emerald-500 text-white'
                                                                : 'bg-amber-600 hover:bg-amber-500 text-white'
                                                                }`}
                                                            data-tip={isPaused ? '继续处理队列' : '暂停处理队列'}
                                                        >
                                                            {isPaused ? <><Play size={16} fill="currentColor" /> 继续</> : <><Pause size={16} fill="currentColor" /> 暂停</>}
                                                        </button>
                                                        <button
                                                            onClick={handleStop}
                                                            className="py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 bg-zinc-800 hover:bg-red-600/90 text-zinc-300 hover:text-white transition-all tooltip-bottom"
                                                            data-tip="停止处理并清除队列"
                                                        >
                                                            <Square size={16} fill="currentColor" /> 停止
                                                        </button>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* 创新模式工具栏（创新和快捷模式共用） */}
                                {(workMode === 'creative' || workMode === 'quick') && (
                                    <div className={`${workMode === 'quick' ? 'lg:col-span-5' : 'lg:col-span-2'} flex flex-col gap-2`}>
                                        {/* 快捷模式：紧凑单行布局 */}
                                        {workMode === 'quick' ? (
                                            <>
                                                {/* 单行工具栏 */}
                                                <div className="flex items-center gap-1.5 flex-wrap">
                                                    {/* 预设指示器 - 始终显示，提供编辑功能 */}
                                                    {(() => {
                                                        const activeSheet = randomLibraryConfig.activeSourceSheet || '';
                                                        const hasLinkedInstruction = !!(randomLibraryConfig.linkedInstructions?.[activeSheet]?.trim());
                                                        // 根据随机库是否启用来自动判断使用哪个预设
                                                        const isRandomLibEnabled = randomLibraryConfig.enabled &&
                                                            randomLibraryConfig.libraries.some(lib => lib.enabled && lib.values.length > 0);
                                                        const currentPreset = isRandomLibEnabled ? 'withRandomLib' : 'standard';

                                                        return (
                                                            <div className="flex items-center gap-1">
                                                                {/* 显示当前状态 */}
                                                                {hasLinkedInstruction ? (
                                                                    <span className="text-[10px] text-green-400 bg-green-900/30 px-1.5 py-1 rounded border border-green-700/50 flex items-center gap-1">
                                                                        ✓ 已导入
                                                                    </span>
                                                                ) : (
                                                                    <span className={`text-[10px] px-2 py-1 rounded border flex items-center gap-1 ${isRandomLibEnabled
                                                                        ? 'text-purple-300 bg-purple-900/30 border-purple-700/50'
                                                                        : 'text-cyan-300 bg-cyan-900/30 border-cyan-700/50'
                                                                        }`}>
                                                                        {isRandomLibEnabled ? '🎲 随机库' : '📝 标准'}
                                                                    </span>
                                                                )}
                                                                {/* 编辑按钮 - 始终显示 */}
                                                                <button
                                                                    onClick={() => setShowPresetEditor(currentPreset)}
                                                                    className="w-6 h-6 flex items-center justify-center rounded bg-zinc-800/60 text-zinc-400 hover:bg-zinc-700/60 hover:text-zinc-300 border border-zinc-700/50 transition-all"
                                                                    data-tip="编辑默认指令"
                                                                >
                                                                    <Settings size={12} />
                                                                </button>
                                                            </div>
                                                        );
                                                    })()}

                                                    {/* 复制按钮组 */}
                                                    {(() => {
                                                        const successCount = creativeResults.filter(r => r.status === 'success').length;
                                                        const hasResults = successCount > 0;
                                                        const btnClass = "flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[0.6875rem] font-medium border transition-all disabled:opacity-40 active:scale-95";
                                                        return (
                                                            <>
                                                                <button onClick={copyCreativeEN} disabled={!hasResults}
                                                                    className={`${btnClass} ${copySuccess === 'creative-en' ? 'bg-emerald-600 text-white border-emerald-500' : 'text-blue-400 bg-blue-900/20 hover:bg-blue-800/40 border-blue-700/40'}`}
                                                                    data-tip="复制英文">
                                                                    {copySuccess === 'creative-en' ? <Check size={12} /> : <Copy size={12} />} EN
                                                                </button>
                                                                <button onClick={copyCreativeZH} disabled={!hasResults}
                                                                    className={`${btnClass} ${copySuccess === 'creative-zh' ? 'bg-emerald-600 text-white border-emerald-500' : 'text-orange-400 bg-orange-900/20 hover:bg-orange-800/40 border-orange-700/40'}`}
                                                                    data-tip="复制中文">
                                                                    {copySuccess === 'creative-zh' ? <Check size={12} /> : <Copy size={12} />} 中
                                                                </button>
                                                                <button onClick={copyCreativeResults} disabled={!hasResults}
                                                                    className={`${btnClass} ${copySuccess === 'creative-all' ? 'bg-emerald-600 text-white border-emerald-500' : 'text-emerald-400 bg-emerald-900/20 hover:bg-emerald-800/40 border-emerald-700/40'}`}
                                                                    data-tip="复制全部">
                                                                    {copySuccess === 'creative-all' ? <Check size={12} /> : <Copy size={12} />} 全
                                                                </button>
                                                            </>
                                                        );
                                                    })()}

                                                    <div className="w-px h-5 bg-zinc-700 mx-1" />

                                                    {/* 创新个数 */}
                                                    <div className="flex items-center gap-0.5 bg-zinc-900/60 rounded-md border border-zinc-700/50 px-1.5 py-1">
                                                        <button onClick={() => setCreativeCount(Math.max(1, creativeCount - 1))}
                                                            className="w-4 h-4 flex items-center justify-center rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-[10px]">-</button>
                                                        <span className="text-[11px] font-bold text-purple-300 min-w-[14px] text-center">{creativeCount}</span>
                                                        <button onClick={() => setCreativeCount(Math.min(50, creativeCount + 1))}
                                                            className="w-4 h-4 flex items-center justify-center rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-[10px]">+</button>
                                                    </div>

                                                    {/* 清空、高级、无图 */}
                                                    {(() => {
                                                        const btnClass = "flex items-center justify-center gap-1 px-2 py-1.5 rounded-md text-[0.6875rem] font-medium border transition-all";
                                                        return (
                                                            <>
                                                                <button onClick={clearCreativeResults} disabled={creativeResults.length === 0}
                                                                    className={`${btnClass} ${creativeResults.length > 0 ? 'text-red-300 bg-red-900/20 hover:bg-red-800/30 border-red-800/40' : 'text-zinc-500 bg-zinc-800/40 border-zinc-700/40 opacity-40'}`}
                                                                    data-tip="清空结果">
                                                                    <Trash2 size={12} /> 清空
                                                                </button>
                                                                <button onClick={() => setShowGlobalInnovationSettings(true)}
                                                                    className={`${btnClass} ${randomLibraryConfig.enabled ? 'text-purple-300 bg-purple-900/30 border-purple-800/40' : 'text-zinc-400 bg-zinc-800/40 hover:bg-zinc-700/40 border-zinc-700/40'}`}
                                                                    data-tip="高级设置">
                                                                    <Settings2 size={12} /> 高级
                                                                </button>
                                                                <button onClick={() => { setNoImageMode(!noImageMode); if (!noImageMode && textCards.length === 0) addTextCard(); }}
                                                                    className={`${btnClass} ${noImageMode ? 'text-pink-300 bg-pink-900/30 border-pink-800/40' : 'text-zinc-400 bg-zinc-800/40 hover:bg-zinc-700/40 border-zinc-700/40'}`}
                                                                    data-tip="无图模式">
                                                                    <FileText size={12} /> 无图
                                                                </button>
                                                            </>
                                                        );
                                                    })()}

                                                    <div className="w-px h-5 bg-zinc-700 mx-1" />

                                                    {/* 状态统计 - 带标签 */}
                                                    <div className="flex items-center gap-2 text-[10px]">
                                                        <span className="text-zinc-400">队列<span className="text-zinc-200 font-bold ml-0.5">{images.length}</span></span>
                                                        <span className="text-purple-400">就绪<span className="text-purple-300 font-bold ml-0.5">{images.filter(i => i.base64Data).length}</span></span>
                                                        <span className="text-emerald-400">成功<span className="text-emerald-300 font-bold ml-0.5">{images.filter(i => i.status === 'success').length}</span></span>
                                                        {images.filter(i => i.status === 'error').length > 0 && (
                                                            <span className="text-red-400">失败<span className="text-red-300 font-bold ml-0.5">{images.filter(i => i.status === 'error').length}</span></span>
                                                        )}
                                                        {/* 当前总库名称 */}
                                                        {randomLibraryConfig.enabled && randomLibraryConfig.activeSourceSheet && (
                                                            <span className="text-indigo-400 ml-1">
                                                                📚 <span className="text-indigo-300 font-medium">{randomLibraryConfig.activeSourceSheet}</span>
                                                            </span>
                                                        )}
                                                    </div>

                                                    <div className="flex-1" />

                                                    {/* 开始创新按钮 */}
                                                    <button
                                                        onClick={() => runCreativeAnalysis()}
                                                        disabled={isProcessing || images.filter(i => i.base64Data).length === 0}
                                                        className={`px-4 py-1.5 rounded-lg font-bold text-xs flex items-center gap-1.5 transition-all shadow-lg
                                                            ${isProcessing
                                                                ? 'bg-purple-900/30 text-purple-400 animate-pulse border border-purple-700'
                                                                : images.filter(i => i.base64Data).length === 0
                                                                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                                                                    : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/20'
                                                            }`}
                                                    >
                                                        {isProcessing ? <><Loader2 size={14} className="animate-spin" /> 处理中</> : <><Sparkles size={14} fill="currentColor" /> 创新</>}
                                                    </button>
                                                </div>
                                                {/* 全局用户特殊要求输入框 */}
                                                <div className="mt-2">
                                                    <input
                                                        type="text"
                                                        value={prompt}
                                                        onChange={(e) => setPrompt(e.target.value)}
                                                        onDoubleClick={() => setShowGlobalPromptEditor(true)}
                                                        placeholder="全局用户要求（可选，应用到所有图片）双击放大编辑"
                                                        title="双击放大编辑"
                                                        className="w-full px-3 py-1.5 text-xs bg-zinc-800/50 border border-zinc-700/50 rounded-lg text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 cursor-text"
                                                    />
                                                </div>
                                            </>
                                        ) : (
                                            /* 创新模式：保持原有多行布局 */
                                            <>
                                                {/* 1. 复制按钮网格 - 3个复制按钮 */}
                                                <div className="grid grid-cols-3 gap-1.5">
                                                    {(() => {
                                                        const successCount = creativeResults.filter(r => r.status === 'success').length;
                                                        const hasResults = successCount > 0;
                                                        const btnBaseClass = "flex items-center justify-center gap-1.5 px-2 py-2 rounded-md text-xs font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95";

                                                        return (
                                                            <>
                                                                <button
                                                                    onClick={copyCreativeEN}
                                                                    disabled={!hasResults}
                                                                    className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'creative-en'
                                                                        ? 'bg-emerald-600 text-white border-emerald-500'
                                                                        : 'text-blue-400 hover:text-white bg-blue-900/20 hover:bg-blue-800/40 border-blue-700/40'
                                                                        }`}
                                                                    data-tip="复制全部英文（每行一条）"
                                                                >
                                                                    {copySuccess === 'creative-en' ? <Check size={14} /> : <Copy size={14} />}
                                                                    复制英文
                                                                </button>

                                                                <button
                                                                    onClick={copyCreativeZH}
                                                                    disabled={!hasResults}
                                                                    className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'creative-zh'
                                                                        ? 'bg-emerald-600 text-white border-emerald-500'
                                                                        : 'text-orange-400 hover:text-white bg-orange-900/20 hover:bg-orange-800/40 border-orange-700/40'
                                                                        }`}
                                                                    data-tip="复制全部中文（每行一条）"
                                                                >
                                                                    {copySuccess === 'creative-zh' ? <Check size={14} /> : <Copy size={14} />}
                                                                    复制中文
                                                                </button>

                                                                <button
                                                                    onClick={copyCreativeResults}
                                                                    disabled={!hasResults}
                                                                    className={`${btnBaseClass} tooltip-bottom ${copySuccess === 'creative-all'
                                                                        ? 'bg-emerald-600 text-white border-emerald-500'
                                                                        : 'text-emerald-400 hover:text-white bg-emerald-900/20 hover:bg-emerald-800/40 border-emerald-700/40'
                                                                        }`}
                                                                    data-tip="复制全部（英文+中文双列，粘贴表格自动分列）"
                                                                >
                                                                    {copySuccess === 'creative-all' ? <Check size={14} /> : <Copy size={14} />}
                                                                    复制全部
                                                                </button>
                                                            </>
                                                        );
                                                    })()}
                                                </div>

                                                {/* 2. 创新设置行 */}
                                                <div className="grid grid-cols-6 gap-1.5">
                                                    {(() => {
                                                        const btnBase = "flex items-center justify-center gap-1.5 px-2 py-1.5 rounded-md text-[0.6875rem] font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95";
                                                        return (
                                                            <>
                                                                {/* 创新个数设置 */}
                                                                <div className="flex items-center justify-center gap-1 bg-zinc-900/60 rounded-md border border-zinc-700/50 px-2 py-1.5">
                                                                    <button
                                                                        onClick={() => setCreativeCount(Math.max(1, creativeCount - 1))}
                                                                        className="w-5 h-5 flex items-center justify-center rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-xs"
                                                                    >
                                                                        -
                                                                    </button>
                                                                    <span className="text-xs font-bold text-purple-300 min-w-[16px] text-center">{creativeCount}</span>
                                                                    <button
                                                                        onClick={() => setCreativeCount(Math.min(50, creativeCount + 1))}
                                                                        className="w-5 h-5 flex items-center justify-center rounded bg-zinc-800 text-zinc-300 hover:bg-zinc-700 text-xs"
                                                                    >
                                                                        +
                                                                    </button>
                                                                    <span className="text-[0.625rem] text-zinc-500">个</span>
                                                                </div>

                                                                {/* 需要原描述开关 */}
                                                                <button
                                                                    onClick={() => setState(prev => ({ ...prev, needOriginalDesc: !needOriginalDesc }))}
                                                                    className={`${btnBase} tooltip-bottom ${needOriginalDesc
                                                                        ? 'text-emerald-300 bg-emerald-900/30 border-emerald-800/40'
                                                                        : 'text-zinc-400 bg-zinc-800/40 border-zinc-700/40'
                                                                        }`}
                                                                    data-tip={needOriginalDesc ? "开启：先识别再创新" : "关闭：直接创新"}
                                                                >
                                                                    {needOriginalDesc ? <Eye size={12} /> : <EyeOff size={12} />}
                                                                    原描述
                                                                </button>

                                                                {/* 创新统计 */}
                                                                <div className={`${btnBase} bg-purple-900/20 border-purple-800/40 text-purple-300 cursor-default tooltip-bottom`} data-tip="创新结果统计">
                                                                    <Sparkles size={12} />
                                                                    {creativeResults.reduce((sum, r) => sum + (r.innovations?.length || 0), 0)} 条
                                                                </div>

                                                                {/* 清空按钮 */}
                                                                <button
                                                                    onClick={clearCreativeResults}
                                                                    disabled={creativeResults.length === 0}
                                                                    className={`${btnBase} tooltip-bottom ${creativeResults.length > 0
                                                                        ? 'text-red-300 bg-red-900/20 hover:bg-red-800/30 border-red-800/40'
                                                                        : 'text-zinc-500 bg-zinc-800/40 border-zinc-700/40'
                                                                        }`}
                                                                    data-tip="清空所有创新结果"
                                                                >
                                                                    <Trash2 size={12} />
                                                                    清空
                                                                </button>

                                                                {/* 高级创新设置按钮 */}
                                                                <button
                                                                    onClick={() => setShowGlobalInnovationSettings(true)}
                                                                    className={`${btnBase} tooltip-bottom ${randomLibraryConfig.enabled
                                                                        ? 'text-purple-300 bg-purple-900/30 border-purple-800/40'
                                                                        : 'text-zinc-400 bg-zinc-800/40 hover:bg-zinc-700/40 border-zinc-700/40'
                                                                        }`}
                                                                    data-tip="高级创新设置（随机库）"
                                                                >
                                                                    <Settings2 size={12} />
                                                                    高级
                                                                </button>

                                                                {/* 无图模式开关 */}
                                                                <button
                                                                    onClick={() => {
                                                                        setNoImageMode(!noImageMode);
                                                                        if (!noImageMode && textCards.length === 0) {
                                                                            addTextCard();
                                                                        }
                                                                    }}
                                                                    className={`${btnBase} tooltip-bottom ${noImageMode
                                                                        ? 'text-pink-300 bg-pink-900/30 border-pink-800/40'
                                                                        : 'text-zinc-400 bg-zinc-800/40 hover:bg-zinc-700/40 border-zinc-700/40'
                                                                        }`}
                                                                    data-tip="无图模式：用文字主题代替图片"
                                                                >
                                                                    <FileText size={12} />
                                                                    无图
                                                                </button>
                                                            </>
                                                        );
                                                    })()}
                                                </div>

                                                {/* 3. 状态统计条 */}
                                                <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-zinc-800/50">
                                                    <div className="grid grid-cols-4 gap-1.5">
                                                        <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/40 text-zinc-400 hover:bg-zinc-800/60 transition-colors cursor-default tooltip-bottom" data-tip="队列">
                                                            <span className="text-[0.6875rem] font-medium">队列</span>
                                                            <span className="text-xs font-bold text-zinc-200 font-mono">{images.length}</span>
                                                        </div>
                                                        <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-purple-500/20 bg-purple-500/10 text-purple-300 hover:bg-purple-500/20 transition-colors cursor-default tooltip-bottom" data-tip="可进行创新的图片">
                                                            <span className="text-[0.6875rem] font-medium">可创新</span>
                                                            <span className="text-xs font-bold text-purple-300 font-mono">{images.filter(i => i.base64Data).length}</span>
                                                        </div>
                                                        <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-default tooltip-bottom" data-tip="成功">
                                                            <span className="text-[0.6875rem] font-medium">成功</span>
                                                            <span className="text-xs font-bold text-emerald-300 font-mono">{images.filter(i => i.status === 'success').length}</span>
                                                        </div>
                                                        <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors cursor-default tooltip-bottom" data-tip="失败">
                                                            <span className="text-[0.6875rem] font-medium">失败</span>
                                                            <span className="text-xs font-bold text-red-300 font-mono">{images.filter(i => i.status === 'error').length}</span>
                                                        </div>
                                                    </div>

                                                    {/* 4. 开始创新按钮 */}
                                                    <button
                                                        onClick={() => runCreativeAnalysis()}
                                                        disabled={isProcessing || images.filter(i => i.base64Data).length === 0 || !prompt.trim()}
                                                        className={`
                                                            w-full py-2 rounded-lg font-bold text-sm tracking-wide flex items-center justify-center gap-2 transition-all shadow-lg
                                                            ${isProcessing
                                                                ? 'bg-purple-900/30 text-purple-400 animate-pulse border border-purple-700'
                                                                : images.filter(i => i.base64Data).length === 0 || !prompt.trim()
                                                                    ? 'bg-zinc-800 text-zinc-500 cursor-not-allowed border border-zinc-700'
                                                                    : 'bg-purple-600 hover:bg-purple-500 text-white shadow-purple-900/20 hover:shadow-purple-900/40 hover:-translate-y-0.5'
                                                            }
                                                        `}
                                                        data-tip="开始对待处理的图片进行创新"
                                                    >
                                                        {isProcessing ? (
                                                            <><Loader2 size={16} className="animate-spin" /> 创新中...</>
                                                        ) : (
                                                            <><Sparkles size={16} fill="currentColor" /> 开始创新</>
                                                        )}
                                                    </button>
                                                </div>
                                            </>
                                        )}
                                    </div>
                                )}

                                {/* 提示信息 - 全宽显示 */}
                                {/* 快捷模式下有默认预设，所以不需要显示此提示 */}
                                {!prompt.trim() && images.length > 0 && workMode !== 'quick' && workMode !== 'split' && (
                                    <div className="lg:col-span-5 flex items-center justify-center gap-2 text-xs text-amber-400/80 bg-amber-900/10 border border-amber-900/20 rounded-lg px-3 py-2 mt-2 animate-pulse">
                                        <AlertCircle size={14} />
                                        <span>请先输入指令或选择预设</span>
                                    </div>
                                )}

                                {/* 全部完成提示 - 全宽显示 */}
                                {showAllComplete && (
                                    <div className="lg:col-span-5 flex items-center justify-center gap-2 text-sm text-emerald-300 bg-emerald-900/20 border border-emerald-900/30 rounded-lg px-4 py-3 mt-2 animate-pulse">
                                        <CheckCircle2 size={18} className="text-emerald-400" />
                                        <span className="font-medium">🎉 全部完成！共识别 {images.filter(i => i.status === 'success').length} 张图片</span>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* 多标签页栏 */}
                <TabBar
                    tabs={tabs}
                    activeTabId={activeTabId}
                    onTabChange={handleTabChange}
                    onTabAdd={handleTabAdd}
                    onTabRemove={handleTabRemove}
                    onTabRename={handleTabRename}
                />

                {/* 主内容区 */}
                <div className={`flex-1 ${noImageMode ? 'overflow-y-auto overflow-x-hidden' : 'overflow-auto'}`}>
                    <div className="max-w-none mx-auto px-4 py-4">
                        {/* 结果列表 */}
                        <div className="flex-1">
                            {/* 无图模式：显示文字卡片（创新和快捷模式都支持） */}
                            {noImageMode && (workMode === 'creative' || workMode === 'quick') ? (
                                <div className="space-y-4">
                                    {/* 无图模式工具栏 */}
                                    <div className="flex items-center justify-between p-3 bg-zinc-800/50 rounded-lg border border-pink-700/30">
                                        <div className="flex items-center gap-3">
                                            <FileText size={18} className="text-pink-400" />
                                            <span className="text-sm font-medium text-white">无图创新模式</span>
                                            <span className="text-xs text-zinc-500">
                                                {randomLibraryConfig.enabled ? '（随机库已启用）' : '（纯主题模式）'}
                                            </span>
                                            {textCards.length > 0 && (
                                                <span className="text-xs px-2 py-0.5 bg-pink-600/30 text-pink-300 rounded">
                                                    {textCards.length} 个卡片
                                                </span>
                                            )}
                                        </div>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={addTextCard}
                                                className="flex items-center gap-1 px-2 py-1.5 text-xs bg-pink-600 hover:bg-pink-500 text-white rounded transition-colors"
                                            >
                                                <ImagePlus size={14} />
                                                单个
                                            </button>
                                            <button
                                                onClick={() => setShowBulkImportModal(true)}
                                                className="flex items-center gap-1 px-2 py-1.5 text-xs bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
                                            >
                                                <ListPlus size={14} />
                                                批量
                                            </button>
                                            {textCards.length > 0 && (
                                                <button
                                                    onClick={clearAllTextCards}
                                                    className="flex items-center gap-1 px-2 py-1.5 text-xs bg-red-600/30 hover:bg-red-600/50 text-red-300 rounded transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                    清空
                                                </button>
                                            )}
                                            <button
                                                onClick={runNoImageBatchInnovation}
                                                disabled={isGeneratingNoImage || textCards.filter(c => c.topic.trim()).length === 0}
                                                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-purple-600 hover:bg-purple-500 disabled:bg-zinc-700 text-white rounded transition-colors disabled:opacity-50"
                                            >
                                                {isGeneratingNoImage ? (
                                                    <><Loader2 size={14} className="animate-spin" />生成中...</>
                                                ) : (
                                                    <><Sparkles size={14} />开始创新</>
                                                )}
                                            </button>
                                            {/* 批次设置 */}
                                            <div className="flex items-center gap-1 px-2 py-1 bg-zinc-800/60 rounded border border-zinc-700/50 relative z-50" title="批次处理：多个卡片合并成一次AI请求，节省token">
                                                <span className="text-[10px] text-zinc-400">批次</span>
                                                <select
                                                    value={cardBatchSize}
                                                    onChange={(e) => setCardBatchSize(parseInt(e.target.value, 10))}
                                                    className="bg-zinc-800 text-xs text-zinc-200 border-none outline-none cursor-pointer rounded px-1 py-0.5 relative z-50"
                                                    style={{ WebkitAppearance: 'menulist', pointerEvents: 'auto' }}
                                                >
                                                    <option value="1" className="bg-zinc-800 text-zinc-200">×1（单条）</option>
                                                    <option value="3" className="bg-zinc-800 text-zinc-200">×3</option>
                                                    <option value="5" className="bg-zinc-800 text-zinc-200">×5</option>
                                                    <option value="10" className="bg-zinc-800 text-zinc-200">×10</option>
                                                    <option value="20" className="bg-zinc-800 text-zinc-200">×20</option>
                                                </select>
                                            </div>
                                            {/* 重新创新全部按钮 */}
                                            <button
                                                onClick={regenerateAllTextCards}
                                                disabled={isGeneratingNoImage || textCards.filter(c => c.topic.trim() && c.results.length > 0).length === 0}
                                                className="flex items-center gap-1 px-3 py-1.5 text-xs bg-amber-600 hover:bg-amber-500 disabled:bg-zinc-700 text-white rounded transition-colors disabled:opacity-50"
                                                title="清空并重新生成所有卡片的结果"
                                            >
                                                <RefreshCcw size={14} />
                                                全部重新创新
                                            </button>
                                            {/* 重试失败按钮 */}
                                            {textCards.filter(c => c.status === 'error').length > 0 && (
                                                <button
                                                    onClick={retryAllFailedCards}
                                                    disabled={isGeneratingNoImage}
                                                    className="flex items-center gap-1 px-3 py-1.5 text-xs bg-red-600 hover:bg-red-500 disabled:bg-zinc-700 text-white rounded transition-colors disabled:opacity-50"
                                                    title="重试所有失败的卡片"
                                                >
                                                    <RotateCcw size={14} />
                                                    重试失败 ({textCards.filter(c => c.status === 'error').length})
                                                </button>
                                            )}
                                        </div>
                                    </div>

                                    {/* 文字卡片列表（类似创新模式） */}
                                    {textCards.length === 0 ? (
                                        <div
                                            className="h-60 flex flex-col items-center justify-center text-zinc-500 border-2 border-dashed border-pink-700/50 rounded-2xl bg-zinc-900/30 cursor-pointer hover:border-pink-600/70 transition-colors"
                                            onClick={addTextCard}
                                            onPaste={handleNoImagePaste}
                                            tabIndex={0}
                                        >
                                            <FileText size={48} className="text-pink-600/50 mb-4" />
                                            <p className="text-lg font-medium text-zinc-400">点击添加 或 直接粘贴</p>
                                            <p className="text-sm text-zinc-600 mt-2">支持从Google表格复制粘贴（Ctrl/Cmd+V）</p>
                                        </div>
                                    ) : (
                                        <>
                                            {/* 复制按钮栏 */}
                                            {textCards.some(c => c.results.length > 0) && (
                                                <div className="flex items-center gap-2 mb-3 flex-wrap">
                                                    <span className="text-xs text-zinc-500">批量复制:</span>
                                                    <button
                                                        onClick={() => {
                                                            // 把结果内的换行替换成空格，确保每个结果是单行
                                                            const cleanText = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();
                                                            // 所有结果平铺，每个结果一行
                                                            const allResults = textCards.flatMap(c => c.results).map(r => cleanText(r));
                                                            navigator.clipboard.writeText(allResults.join('\n'));
                                                            showToast(`已复制 ${allResults.length} 条结果！`);
                                                        }}
                                                        className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-purple-600 hover:bg-purple-500 text-white"
                                                        title="每个结果一行（适合粘贴表格）"
                                                    >
                                                        <Copy size={12} />
                                                        只复制结果
                                                    </button>
                                                    <button
                                                        onClick={() => {
                                                            // 把结果内的换行替换成空格
                                                            const cleanText = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();
                                                            // 第一列是主题，后面是结果
                                                            const rows = textCards.filter(c => c.results.length > 0).map(c =>
                                                                `${cleanText(c.topic)}\t${c.results.map(r => cleanText(r)).join('\t')}`
                                                            );
                                                            navigator.clipboard.writeText(rows.join('\n'));
                                                            showToast(`已复制 ${textCards.flatMap(c => c.results).length} 条（主题+结果）！`);
                                                        }}
                                                        className="flex items-center gap-1 px-2.5 py-1 rounded text-xs bg-emerald-600 hover:bg-emerald-500 text-white"
                                                        title="第一列主题，后面结果分列（适合粘贴表格）"
                                                    >
                                                        <Copy size={12} />
                                                        主题+结果
                                                    </button>
                                                </div>
                                            )}

                                            {/* 结果列表 */}
                                            <div className="space-y-2">
                                                {textCards.map((card, index) => (
                                                    <div
                                                        key={card.id}
                                                        className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
                                                    >
                                                        {/* 表格布局：左右双列 */}
                                                        <div className="grid gap-px bg-zinc-800" style={{ gridTemplateColumns: '30% 70%' }}>
                                                            {/* 左列：主题 */}
                                                            <div className="bg-zinc-950 flex flex-col">
                                                                <div className="px-3 py-1.5 bg-zinc-800/50 flex items-center justify-between border-b border-zinc-700/50">
                                                                    <span className="text-[10px] text-pink-400 font-medium">#{index + 1} 主题</span>
                                                                    <div className="flex items-center gap-1">
                                                                        {card.status === 'processing' && (
                                                                            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-purple-900/30 text-purple-400 text-[10px] rounded">
                                                                                <Loader2 size={10} className="animate-spin" /> 处理中
                                                                            </span>
                                                                        )}
                                                                        {card.status === 'done' && (
                                                                            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 text-[10px] rounded">
                                                                                <Check size={10} /> 完成
                                                                            </span>
                                                                        )}
                                                                        {card.status === 'error' && (
                                                                            <span className="px-1.5 py-0.5 bg-red-900/30 text-red-400 text-[10px] rounded">失败</span>
                                                                        )}
                                                                        {card.status === 'idle' && (
                                                                            <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 text-[10px] rounded">待处理</span>
                                                                        )}
                                                                        <button
                                                                            onClick={() => deleteTextCard(card.id)}
                                                                            className="p-0.5 text-zinc-500 hover:text-red-400 transition-colors"
                                                                        >
                                                                            <X size={12} />
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <div className="px-3 py-2 flex-1">
                                                                    <textarea
                                                                        value={card.topic}
                                                                        onChange={(e) => updateTextCardTopic(card.id, e.target.value)}
                                                                        placeholder="输入创作主题..."
                                                                        className="w-full h-full min-h-[60px] px-2 py-1.5 text-sm bg-zinc-800/50 border border-zinc-700 rounded text-white placeholder-zinc-500 resize-none focus:border-pink-500 focus:outline-none"
                                                                        disabled={card.status === 'processing'}
                                                                    />
                                                                </div>
                                                            </div>

                                                            {/* 右列：结果 */}
                                                            <div className="bg-zinc-950 border-l-2 border-purple-500/50 flex flex-col">
                                                                <div className="px-3 py-1.5 bg-zinc-800/50 flex items-center justify-between border-b border-zinc-700/50">
                                                                    <span className="text-[10px] text-purple-400 font-medium">
                                                                        生成结果 {card.results.length > 0 && `(${card.results.length})`}
                                                                    </span>
                                                                    <div className="flex items-center gap-1">
                                                                        {/* 追加生成按钮 */}
                                                                        <button
                                                                            onClick={() => appendTextCardResults(card.id, 1)}
                                                                            disabled={card.status === 'processing'}
                                                                            className="px-1.5 py-0.5 text-[9px] text-emerald-400 hover:bg-emerald-900/30 rounded disabled:opacity-50 flex items-center gap-0.5"
                                                                            title="追加生成1条"
                                                                        >
                                                                            <Plus size={9} />
                                                                            追加
                                                                        </button>
                                                                        {/* 整体重新创新按钮 */}
                                                                        <button
                                                                            onClick={() => regenerateTextCard(card.id)}
                                                                            disabled={card.status === 'processing'}
                                                                            className="px-1.5 py-0.5 text-[9px] text-amber-400 hover:bg-amber-900/30 rounded disabled:opacity-50 flex items-center gap-0.5"
                                                                            title="清空并重新生成所有结果"
                                                                        >
                                                                            <RefreshCcw size={9} />
                                                                            重新创新
                                                                        </button>
                                                                        {/* 复制全部按钮 */}
                                                                        {card.results.length > 0 && (
                                                                            <button
                                                                                onClick={() => {
                                                                                    // 把结果内的换行替换成空格，确保每个结果是单行
                                                                                    const cleanText = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();
                                                                                    const cleanResults = card.results.map(r => cleanText(r));
                                                                                    navigator.clipboard.writeText(cleanResults.join('\n'));
                                                                                    showToast(`已复制 ${card.results.length} 条结果！`);
                                                                                }}
                                                                                className="px-1.5 py-0.5 text-[9px] text-purple-400 hover:bg-purple-900/30 rounded"
                                                                            >
                                                                                复制全部
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                </div>
                                                                <div
                                                                    className="px-3 py-2 flex-1 max-h-60 overflow-y-auto cursor-pointer"
                                                                    onDoubleClick={() => setResultDetailModal({ show: true, card })}
                                                                    title="双击放大查看"
                                                                >
                                                                    {card.status === 'processing' ? (
                                                                        <div className="flex items-center gap-2 text-purple-400 text-sm">
                                                                            <Loader2 size={14} className="animate-spin" />
                                                                            AI正在创作...{card.results.length > 0 && ` (${card.results.length}条)`}
                                                                        </div>
                                                                    ) : card.results.length > 0 ? (
                                                                        <div className="space-y-2">
                                                                            {card.results.map((result, idx) => (
                                                                                <div key={idx} className="group relative bg-zinc-900/50 rounded-lg p-2 border border-zinc-800">
                                                                                    <div className="flex items-center justify-between mb-1">
                                                                                        <span className="text-[10px] text-zinc-500">#{idx + 1}</span>
                                                                                        <div className="flex items-center gap-1">
                                                                                            <button
                                                                                                onClick={() => retryTextCardResult(card.id, idx)}
                                                                                                disabled={card.status === 'processing'}
                                                                                                className="opacity-0 group-hover:opacity-100 px-1 py-0.5 text-[9px] text-amber-400 hover:bg-amber-900/30 rounded transition-opacity disabled:opacity-50"
                                                                                                title="重新生成这条结果"
                                                                                            >
                                                                                                <RotateCcw size={10} />
                                                                                            </button>
                                                                                            <button
                                                                                                onClick={() => {
                                                                                                    // 把结果内的换行替换成空格，确保是单行
                                                                                                    const cleanText = result.replace(/[\r\n]+/g, ' ').trim();
                                                                                                    navigator.clipboard.writeText(cleanText);
                                                                                                    showToast('已复制！');
                                                                                                }}
                                                                                                className="opacity-0 group-hover:opacity-100 px-1 py-0.5 text-[9px] text-purple-400 hover:bg-purple-900/30 rounded transition-opacity"
                                                                                            >
                                                                                                复制
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>
                                                                                    <div className="text-sm text-purple-100 whitespace-pre-wrap break-words">
                                                                                        {result}
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    ) : card.status === 'error' ? (
                                                                        <div className="text-sm text-red-400">生成失败</div>
                                                                    ) : (
                                                                        <div className="text-sm text-zinc-600 italic">等待生成...</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </>
                                    )}
                                </div>
                            ) : images.length === 0 ? (
                                <div
                                    className="h-80 flex flex-col items-center justify-center text-zinc-500 border-2 border-dashed border-zinc-700 hover:border-emerald-600/50 focus-within:border-emerald-500 focus-within:ring-2 focus-within:ring-emerald-500/30 rounded-2xl bg-zinc-900/30 transition-all cursor-pointer group relative"
                                    ref={dropzoneRef}
                                    onClick={(e) => {
                                        // 单击：聚焦隐藏的 textarea，以便接收粘贴事件
                                        const textarea = (e.currentTarget as HTMLElement).querySelector('textarea');
                                        textarea?.focus();
                                    }}
                                    onDoubleClick={(e) => {
                                        // 双击：选择文件
                                        e.stopPropagation();
                                        const input = document.createElement('input');
                                        input.type = 'file';
                                        input.multiple = true;
                                        input.accept = 'image/*';
                                        input.onchange = (e: any) => {
                                            if (e.target.files?.length) {
                                                handleFiles(Array.from(e.target.files));
                                            }
                                        };
                                        input.click();
                                    }}
                                >
                                    {/* 隐藏的 textarea 用于接收粘贴事件 */}
                                    <textarea
                                        className="absolute opacity-0 w-0 h-0 pointer-events-none"
                                        aria-hidden="true"
                                        tabIndex={0}
                                        onPaste={async (e) => {
                                            console.log('[Global Paste] Triggered! workMode:', workMode, 'selectedCardId:', selectedCardId);
                                            e.preventDefault();
                                            const clipboardData = e.clipboardData;

                                            // 检查是否有图片文件
                                            const files = (Array.from(clipboardData.files) as File[]).filter(file => file.type.startsWith('image/'));
                                            console.log('[Global Paste] files:', files.length);
                                            if (files.length > 0) {
                                                // 创新模式下，如果有选中的卡片，添加到该卡片的融合图片
                                                if ((workMode === 'creative' || workMode === 'quick') && selectedCardId) {
                                                    console.log('[Global Paste] Adding to selected card:', selectedCardId);
                                                    for (const file of files) {
                                                        await handleAddFusionImage(selectedCardId, file);
                                                    }
                                                    return;
                                                }
                                                console.log('[Global Paste] Creating new card with handleFiles');
                                                handleFiles(files);
                                                return;
                                            }

                                            // Some browsers only expose pasted images via clipboard items
                                            const items = Array.from(clipboardData.items || []);
                                            const imageItems = items.filter(item => item.type.startsWith('image/'));
                                            if (imageItems.length > 0) {
                                                const itemFiles = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
                                                if (itemFiles.length > 0) {
                                                    // 创新模式下，如果有选中的卡片，添加到该卡片的融合图片
                                                    if ((workMode === 'creative' || workMode === 'quick') && selectedCardId) {
                                                        for (const file of itemFiles) {
                                                            await handleAddFusionImage(selectedCardId, file);
                                                        }
                                                        return;
                                                    }
                                                    handleFiles(itemFiles);
                                                    return;
                                                }
                                            }

                                            // 优先检查纯文本中是否有 =IMAGE() 公式
                                            const text = clipboardData.getData('text/plain');
                                            if (text && text.includes('=IMAGE')) {
                                                handleTextPaste(text);
                                                return;
                                            }

                                            // 检查是否有 HTML 内容（如从 Google Sheets 粘贴）
                                            const html = clipboardData.getData('text/html');
                                            if (html) {
                                                const tempDiv = document.createElement('div');
                                                tempDiv.innerHTML = html;
                                                const imgs = tempDiv.querySelectorAll('img');
                                                if (imgs.length > 0) {
                                                    const decodeHtml = (str: string) => {
                                                        const txt = document.createElement('textarea');
                                                        txt.innerHTML = str;
                                                        return txt.value;
                                                    };

                                                    const urls = Array.from(imgs).map(img => {
                                                        const decodedUrl = decodeHtml(img.src);
                                                        return {
                                                            originalUrl: decodedUrl,
                                                            fetchUrl: decodedUrl
                                                        };
                                                    });

                                                    const urlItems = urls.map(({ originalUrl, fetchUrl }) => ({
                                                        type: 'url' as const,
                                                        content: `=IMAGE("${originalUrl}")`,
                                                        url: fetchUrl
                                                    }));
                                                    addFromUrls(urlItems);
                                                    return;
                                                }
                                            }

                                            // 检查是否有文本内容（链接）
                                            if (text && text.trim()) {
                                                handleTextPaste(text);
                                            }
                                        }}
                                    />
                                    <div className="flex flex-col items-center gap-4 p-8">
                                        <div className="w-20 h-20 rounded-full bg-zinc-800 flex items-center justify-center group-hover:bg-emerald-900/30 transition-colors">
                                            <ImagePlus className="w-10 h-10 text-zinc-600 group-hover:text-emerald-500 transition-colors" />
                                        </div>
                                        <div className="text-center space-y-2">
                                            <p className="text-lg font-medium text-zinc-400 group-hover:text-white transition-colors">
                                                拖拽图片到此处上传
                                            </p>
                                            <p className="text-sm text-zinc-600">
                                                <span className="text-blue-400">单击后可粘贴</span> · <span className="text-emerald-500">双击选择文件</span>
                                            </p>
                                            <div className="flex items-center justify-center gap-4 mt-4 text-xs text-zinc-600">
                                                <span className="flex items-center gap-1">
                                                    <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">Ctrl</kbd>
                                                    <span>+</span>
                                                    <kbd className="px-1.5 py-0.5 bg-zinc-800 rounded text-zinc-400">V</kbd>
                                                    <span className="ml-1">粘贴图片/链接</span>
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <ResultsGrid
                                    images={images}
                                    onRemove={removeImage}
                                    onRetry={handleRetry}
                                    copyMode={copyMode}
                                    viewMode={viewMode}
                                    onToggleChat={toggleChat}
                                    onSendMessage={sendChatMessage}
                                    onUpdateChatInput={updateChatInput}
                                    onCopyChatHistory={copyChatHistory}
                                    onUpdateChatAttachments={updateChatAttachments}
                                    presets={presets}
                                    onUpdateCustomPrompt={updateCustomPrompt}
                                    onApplyPreset={applyPresetToImage}
                                    onToggleMergeMode={toggleMergeMode}
                                    onToggleInnovation={toggleInnovation}
                                    onStartInnovation={startInnovation}
                                    onCopyInnovation={copyInnovation}
                                    onSendToDesc={handleSendSingleToDesc}
                                    sentToDescIds={sentToDescIds}
                                    globalInnovationInstruction={innovationInstruction || DEFAULT_INNOVATION_INSTRUCTION}
                                    defaultInnovationInstruction={DEFAULT_INNOVATION_INSTRUCTION}
                                    onUpdateCustomInnovationInstruction={updateCustomInnovationInstruction}
                                    onUpdateCustomInnovationCount={updateCustomInnovationCount}
                                    onUpdateCustomInnovationRounds={updateCustomInnovationRounds}
                                    onUpdateCustomInnovationTemplateId={updateCustomInnovationTemplateId}
                                    templateState={templateState}
                                    unifiedPresets={unifiedPresets}
                                    onToggleInnovationChat={toggleInnovationChat}
                                    onSendInnovationMessage={sendInnovationChatMessage}
                                    onUpdateInnovationInput={updateInnovationChatInput}
                                    onCopyInnovationChatHistory={copyInnovationChatHistory}
                                    onUpdateInnovationAttachments={updateInnovationChatAttachments}
                                    onTranslate={translateText}
                                    onSaveTranslation={saveTranslation}
                                    onSaveSelection={saveSelection}
                                    workMode={workMode}
                                    creativeResults={creativeResults}
                                    splitElements={splitElements}
                                    onAddFusionImage={handleAddFusionImage}
                                    onRemoveFusionImage={handleRemoveFusionImage}
                                    selectedCardId={selectedCardId}
                                    onSelectCard={setSelectedCardId}
                                    globalUserPrompt={prompt}
                                    baseInstruction={(() => {
                                        // 快捷模式下：优先使用配套指令，否则使用默认预设
                                        if (workMode === 'quick') {
                                            const activeSheet = randomLibraryConfig.activeSourceSheet || '';
                                            const linkedInstruction = randomLibraryConfig.linkedInstructions?.[activeSheet];
                                            if (linkedInstruction && linkedInstruction.trim()) {
                                                return linkedInstruction.trim();
                                            }
                                            const isRandomLibEnabled = randomLibraryConfig.enabled &&
                                                randomLibraryConfig.libraries.some(lib => lib.enabled && lib.values.length > 0);
                                            const presetType = isRandomLibEnabled ? 'withRandomLib' : 'standard';
                                            return DEFAULT_QUICK_INNOVATION_PRESETS[presetType];
                                        }
                                        return prompt || DEFAULT_CREATIVE_INSTRUCTION;
                                    })()}
                                />
                            )}
                        </div>
                    </div>
                </div>

                {/* 批量导入弹窗 */}
                {showBulkImportModal && (
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]"
                        onClick={() => setShowBulkImportModal(false)}
                    >
                        <div
                            className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-[500px] max-w-[95vw] shadow-2xl"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <div className="flex items-center gap-2">
                                    <ListPlus size={20} className="text-blue-400" />
                                    <h3 className="text-lg font-semibold text-white">批量添加主题</h3>
                                </div>
                                <button
                                    onClick={() => setShowBulkImportModal(false)}
                                    className="text-zinc-500 hover:text-white"
                                >
                                    <X size={20} />
                                </button>
                            </div>

                            <p className="text-sm text-zinc-400 mb-3">
                                支持两种格式：<span className="text-blue-400">每行一个主题</span> 或 <span className="text-emerald-400">从Google表格粘贴</span>（自动识别Tab分隔）
                            </p>

                            <textarea
                                value={bulkImportText}
                                onChange={(e) => setBulkImportText(e.target.value)}
                                placeholder="方式1：每行一个主题&#10;赛博朋克城市夜景&#10;梦幻森林仙女&#10;未来科技机械臂&#10;&#10;方式2：从Google表格复制粘贴&#10;（自动识别单元格，支持单元格内换行）"
                                className="w-full h-60 px-3 py-2 text-sm bg-zinc-800 border border-zinc-700 rounded-lg text-white placeholder-zinc-600 resize-none focus:border-blue-500 focus:outline-none font-mono"
                                autoFocus
                            />

                            <div className="flex items-center justify-between mt-4">
                                <div className="flex items-center gap-2">
                                    <span className="text-xs text-zinc-500">
                                        {(() => {
                                            const hasTab = bulkImportText.includes('\t');
                                            const hasQuotedContent = /^"|"\n|"\r/.test(bulkImportText);
                                            if (hasTab || hasQuotedContent) {
                                                return <span className="text-emerald-400">📊 Google表格格式</span>;
                                            }
                                            return <span className="text-blue-400">📝 普通文本格式</span>;
                                        })()}
                                    </span>
                                    <span className="text-xs text-zinc-400">
                                        {(() => {
                                            const hasTab = bulkImportText.includes('\t');
                                            const hasQuotedContent = /^"|"\n|"\r/.test(bulkImportText);
                                            if (hasTab || hasQuotedContent) {
                                                return parseGoogleSheetsCells(bulkImportText).length;
                                            }
                                            return bulkImportText.split(/\r?\n/).filter(l => l.trim()).length;
                                        })()} 个主题
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => setShowBulkImportModal(false)}
                                        className="px-4 py-2 text-sm text-zinc-400 hover:text-white transition-colors"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={handleBulkImport}
                                        disabled={bulkImportText.trim().length === 0}
                                        className="flex items-center gap-2 px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-zinc-700 text-white rounded-lg transition-colors disabled:opacity-50"
                                    >
                                        <ListPlus size={14} />
                                        添加
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 全局创新设置弹框 */}
                {
                    showGlobalInnovationSettings && (
                        <div
                            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]"
                            onClick={() => setShowGlobalInnovationSettings(false)}
                        >
                            <div
                                className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-[700px] max-w-[95vw] max-h-[85vh] overflow-y-auto shadow-2xl mt-10"
                                onClick={e => e.stopPropagation()}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                                        <Sparkles size={18} className="text-purple-400" />
                                        高级创新设置
                                    </h3>
                                    <button
                                        onClick={() => setShowGlobalInnovationSettings(false)}
                                        className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>

                                {/* 规则说明按钮 */}
                                <div className="mb-4 flex items-center gap-2">
                                    <button
                                        onClick={() => setShowRulesModal(true)}
                                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800/50 hover:bg-zinc-700/50 rounded-lg border border-zinc-700/50 transition-colors"
                                    >
                                        <HelpCircle size={14} />
                                        查看指令组合规则
                                    </button>
                                </div>

                                {/* 随机库组合 - 高级创新 */}
                                <div className="mb-4">
                                    <RandomLibraryManager
                                        config={randomLibraryConfig}
                                        onChange={handleRandomLibraryConfigChange}
                                        onAIGenerate={generateText}
                                        onAIAnalyzeImages={analyzeImages}
                                        innovationCount={creativeCount}
                                        workMode={workMode}
                                        globalUserPrompt={prompt}
                                        baseInstruction={(() => {
                                            // 快捷模式下：优先使用配套指令，否则使用默认预设
                                            if (workMode === 'quick') {
                                                const activeSheet = randomLibraryConfig.activeSourceSheet || '';
                                                const linkedInstruction = randomLibraryConfig.linkedInstructions?.[activeSheet];
                                                if (linkedInstruction && linkedInstruction.trim()) {
                                                    return linkedInstruction.trim();
                                                }
                                                // 没有配套指令，使用默认预设
                                                const isRandomLibEnabled = randomLibraryConfig.enabled &&
                                                    randomLibraryConfig.libraries.some(lib => lib.enabled && lib.values.length > 0);
                                                const presetType = isRandomLibEnabled ? 'withRandomLib' : 'standard';
                                                return DEFAULT_QUICK_INNOVATION_PRESETS[presetType];
                                            }
                                            // 创新模式下：使用用户输入的 prompt
                                            return prompt;
                                        })()}
                                    />
                                </div>

                                <div className="text-xs text-zinc-500 mb-4 bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
                                    <p className="mb-1.5"><strong className="text-zinc-400">使用说明：</strong></p>
                                    <ul className="list-disc list-inside space-y-1 text-zinc-500">
                                        <li>启用后，工具栏的「创新个数」表示生成多少个不同的随机组合</li>
                                        <li>每个随机组合会单独调用AI生成1个创意描述</li>
                                        <li>不同图片会使用不同的随机组合，确保多样性</li>
                                    </ul>
                                </div>

                                <div className="flex justify-end gap-2">
                                    <button
                                        onClick={() => setShowGlobalInnovationSettings(false)}
                                        className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 transition-colors"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={() => setShowGlobalInnovationSettings(false)}
                                        className="px-4 py-2 text-sm font-medium bg-pink-600 hover:bg-pink-500 text-white rounded-lg transition-colors"
                                    >
                                        确定
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                }

                {/* 规则说明弹窗 */}
                {showRulesModal && (
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]"
                        onClick={() => setShowRulesModal(false)}
                    >
                        <div
                            className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-[500px] max-w-[95vw] shadow-2xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                                    <HelpCircle size={18} className="text-blue-400" />
                                    指令组合规则
                                </h3>
                                <button
                                    onClick={() => setShowRulesModal(false)}
                                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="space-y-3 text-sm">
                                <div className="p-3 bg-blue-900/20 border border-blue-800/30 rounded-lg">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-blue-400 font-bold">1️⃣</span>
                                        <span className="text-zinc-300 font-medium">有用户要求 + 有随机库</span>
                                    </div>
                                    <div className="text-zinc-400 text-xs ml-6 mb-1">
                                        基础指令 → 【用户特别要求】 → 【画面创新细节】 → 优先级说明
                                    </div>
                                    <div className="text-amber-400/80 text-xs ml-6">
                                        ⚠️ 优先级：【用户特别要求】 &gt; 【画面创新细节】 &gt; 基础指令 &gt; 默认还原
                                    </div>
                                </div>

                                <div className="p-3 bg-green-900/20 border border-green-800/30 rounded-lg">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-green-400 font-bold">2️⃣</span>
                                        <span className="text-zinc-300 font-medium">有用户要求 + 无随机库</span>
                                    </div>
                                    <div className="text-zinc-400 text-xs ml-6 mb-1">
                                        基础指令 → 【用户特别要求】 → 优先级说明
                                    </div>
                                    <div className="text-amber-400/80 text-xs ml-6">
                                        ⚠️ 优先级：【用户特别要求】 &gt; 基础指令 &gt; 默认还原
                                    </div>
                                </div>

                                <div className="p-3 bg-yellow-900/20 border border-yellow-800/30 rounded-lg">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-yellow-400 font-bold">3️⃣</span>
                                        <span className="text-zinc-300 font-medium">无用户要求 + 有随机库</span>
                                    </div>
                                    <div className="text-zinc-400 text-xs ml-6 mb-1">
                                        基础指令 → 【画面创新细节】 → 优先级说明
                                    </div>
                                    <div className="text-amber-400/80 text-xs ml-6">
                                        ⚠️ 优先级：【画面创新细节】 &gt; 基础指令 &gt; 默认还原
                                    </div>
                                </div>

                                <div className="p-3 bg-orange-900/20 border border-orange-800/30 rounded-lg">
                                    <div className="flex items-center gap-2 mb-1">
                                        <span className="text-orange-400 font-bold">4️⃣</span>
                                        <span className="text-zinc-300 font-medium">无用户要求 + 无随机库</span>
                                    </div>
                                    <div className="text-zinc-400 text-xs ml-6 mb-1">
                                        基础指令 → 优先级说明
                                    </div>
                                    <div className="text-amber-400/80 text-xs ml-6">
                                        ⚠️ 优先级：基础指令 &gt; 默认还原
                                    </div>
                                </div>
                            </div>

                            <div className="mt-4 pt-3 border-t border-zinc-700/50 text-xs text-zinc-500">
                                <div className="mb-2">
                                    <span className="text-amber-400">⚠️</span> 优先级说明会根据实际情况动态生成，放在指令最后以强调执行顺序。
                                </div>
                                <div className="text-zinc-400">
                                    每个优先级说明都会附加：「请严格按照优先级的顺序规则来生成描述词」
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {/* 预设编辑弹窗 - 只读模式 */}
                {showPresetEditor && (
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]"
                        onClick={() => setShowPresetEditor(null)}
                    >
                        <div
                            className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-[700px] max-w-[95vw] max-h-[85vh] overflow-y-auto shadow-2xl mt-10"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                                    <Settings2 size={18} className={showPresetEditor === 'standard' ? 'text-cyan-400' : 'text-purple-400'} />
                                    查看{showPresetEditor === 'standard' ? '标准' : '随机库'}预设
                                </h3>
                                <button
                                    onClick={() => setShowPresetEditor(null)}
                                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="mb-4">
                                <label className="block text-sm font-medium text-zinc-400 mb-2">
                                    创新指令内容（只读）
                                </label>
                                <div
                                    className="w-full h-80 p-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-zinc-300 text-sm overflow-y-auto whitespace-pre-wrap"
                                >
                                    {DEFAULT_QUICK_INNOVATION_PRESETS[showPresetEditor]}
                                </div>
                            </div>

                            <div className="text-xs text-zinc-500 mb-4 bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
                                <p className="mb-1.5"><strong className="text-zinc-400">说明：</strong></p>
                                <ul className="list-disc list-inside space-y-1 text-zinc-500">
                                    {showPresetEditor === 'standard' ? (
                                        <>
                                            <li><strong className="text-cyan-400">标准模式</strong>：直接使用此指令进行创新</li>
                                            <li>适合不使用随机库、只用AI分析图片进行创新的场景</li>
                                        </>
                                    ) : (
                                        <>
                                            <li><strong className="text-purple-400">随机库模式</strong>：指令末尾会自动接入随机库的内容</li>
                                            <li>适合需要结合随机元素（如风格、场景等）进行创新的场景</li>
                                        </>
                                    )}
                                </ul>
                            </div>

                            <div className="flex justify-end">
                                <button
                                    onClick={() => setShowPresetEditor(null)}
                                    className={`px-4 py-2 text-sm font-medium text-white rounded-lg transition-colors ${showPresetEditor === 'standard' ? 'bg-cyan-600 hover:bg-cyan-500' : 'bg-purple-600 hover:bg-purple-500'
                                        }`}
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* 全局用户要求放大编辑弹窗 */}
                {showGlobalPromptEditor && (
                    <div
                        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]"
                        onClick={() => setShowGlobalPromptEditor(false)}
                    >
                        <div
                            className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-[700px] max-w-[95vw] max-h-[85vh] overflow-y-auto shadow-2xl"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between mb-4">
                                <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                                    <Settings2 size={18} className="text-purple-400" />
                                    全局用户要求
                                </h3>
                                <button
                                    onClick={() => setShowGlobalPromptEditor(false)}
                                    className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>

                            <div className="mb-4">
                                <label className="block text-sm font-medium text-zinc-400 mb-2">
                                    输入您的全局要求（将应用到所有图片）
                                </label>
                                <textarea
                                    value={prompt}
                                    onChange={(e) => setPrompt(e.target.value)}
                                    placeholder="在此输入全局用户要求...\n\n例如：\n- 使用更简洁的语言\n- 突出产品特点\n- 加入情感化描述"
                                    className="w-full h-64 p-3 bg-zinc-800/50 border border-zinc-700 rounded-lg text-zinc-200 text-sm placeholder-zinc-500 focus:outline-none focus:border-purple-500/50 focus:ring-1 focus:ring-purple-500/20 resize-none"
                                    autoFocus
                                />
                            </div>

                            <div className="text-xs text-zinc-500 mb-4 bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
                                <p className="mb-1.5"><strong className="text-zinc-400">提示：</strong></p>
                                <ul className="list-disc list-inside space-y-1 text-zinc-500">
                                    <li>此内容将作为附加要求应用到所有图片的创新过程</li>
                                    <li>支持多行输入，可以详细描述您的需求</li>
                                    <li>按 <kbd className="px-1 py-0.5 bg-zinc-700 rounded text-zinc-300">Esc</kbd> 或点击外部区域关闭</li>
                                </ul>
                            </div>

                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setPrompt('')}
                                    className="px-4 py-2 text-sm font-medium text-zinc-400 hover:text-zinc-200 rounded-lg transition-colors"
                                >
                                    清空
                                </button>
                                <button
                                    onClick={() => setShowGlobalPromptEditor(false)}
                                    className="px-4 py-2 text-sm font-medium text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
                                >
                                    确定
                                </button>
                            </div>
                        </div>
                    </div>
                )}

            </div >

            {/* 项目管理面板 */}
            <ProjectPanel
                isOpen={showProjectPanel}
                onClose={() => setShowProjectPanel(false)}
                moduleId="image-recognition"
                currentProjectId={currentProject?.id}
                onProjectChange={(project) => {
                    handleProjectChange(project);
                    setShowProjectPanel(false);
                }}
                onCreateNew={() => {
                    // 创建新项目时重置状态
                    setState(prev => ({
                        ...initialImageRecognitionState,
                        presets: prev.presets,
                    }));
                    setCurrentProject(null);
                }}
            />

            {/* Toast 提示 */}
            {toastMessage && (
                <div className="fixed bottom-8 left-1/2 -translate-x-1/2 z-[200] animate-in fade-in slide-in-from-bottom-4 duration-300">
                    <div className="px-6 py-3 bg-zinc-800 border border-zinc-600 rounded-xl shadow-2xl text-white text-sm font-medium backdrop-blur-sm">
                        {toastMessage}
                    </div>
                </div>
            )}

            {/* 确认弹窗 */}
            {confirmModal.show && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[200] flex items-center justify-center">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-5 max-w-sm w-full mx-4">
                        <p className="text-white text-sm mb-5">{confirmModal.message}</p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setConfirmModal({ show: false, message: '', onConfirm: () => { } })}
                                className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={confirmModal.onConfirm}
                                className="px-4 py-2 text-sm text-white bg-purple-600 hover:bg-purple-500 rounded-lg transition-colors"
                            >
                                确定
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 结果详情弹窗 */}
            {resultDetailModal.show && resultDetailModal.card && (() => {
                // 从 textCards 获取最新数据，避免使用过时的快照
                const liveCard = textCards.find(c => c.id === resultDetailModal.card!.id) || resultDetailModal.card;
                return (
                    <div
                        className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
                        onClick={() => setResultDetailModal({ show: false, card: null })}
                    >
                        <div
                            className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-3xl w-full max-h-[85vh] overflow-hidden flex flex-col"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* 弹窗头部 */}
                            <div className="px-5 py-4 border-b border-zinc-700 flex items-center justify-between bg-zinc-800/50">
                                <div>
                                    <h3 className="text-lg font-semibold text-white">结果详情</h3>
                                    <p className="text-sm text-zinc-400 mt-1">主题: {liveCard.topic}</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => translateAllResults(liveCard.id, liveCard.results)}
                                        disabled={translatingItems.size > 0}
                                        className="px-3 py-1.5 text-xs text-blue-400 hover:bg-blue-900/30 rounded flex items-center gap-1 disabled:opacity-50"
                                    >
                                        {translatingItems.size > 0 ? (
                                            <><Loader2 size={12} className="animate-spin" />翻译中...</>
                                        ) : (
                                            <><Languages size={12} />全部翻译</>
                                        )}
                                    </button>
                                    <button
                                        onClick={() => {
                                            // 把结果内的换行替换成空格，确保每个结果是单行
                                            const cleanText = (text: string) => text.replace(/[\r\n]+/g, ' ').trim();
                                            const cleanResults = liveCard.results.map(r => cleanText(r));
                                            navigator.clipboard.writeText(cleanResults.join('\n'));
                                            showToast(`已复制 ${liveCard.results.length} 条结果！`);
                                        }}
                                        className="px-3 py-1.5 text-xs text-purple-400 hover:bg-purple-900/30 rounded flex items-center gap-1"
                                    >
                                        <Copy size={12} />
                                        复制全部
                                    </button>
                                    <button
                                        onClick={() => setResultDetailModal({ show: false, card: null })}
                                        className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg transition-colors"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                            </div>
                            {/* 结果列表 */}
                            <div className="flex-1 overflow-y-auto p-5 space-y-4">
                                {liveCard.results.map((result, idx) => {
                                    const cacheKey = `${liveCard.id}-${idx}`;
                                    const translation = translationCache[cacheKey];
                                    const isTranslating = translatingItems.has(cacheKey);

                                    return (
                                        <div key={idx} className="group bg-zinc-800/50 rounded-xl p-4 border border-zinc-700 hover:border-purple-500/50 transition-colors">
                                            <div className="flex items-center justify-between mb-3">
                                                <span className="text-sm font-medium text-purple-400">#{idx + 1}</span>
                                                <div className="flex items-center gap-2">
                                                    {/* 翻译按钮 */}
                                                    {!translation && (
                                                        <button
                                                            onClick={() => translateResult(liveCard.id, idx, result)}
                                                            disabled={isTranslating}
                                                            className="px-2 py-1 text-xs text-blue-400 hover:bg-blue-900/30 rounded flex items-center gap-1 disabled:opacity-50"
                                                        >
                                                            {isTranslating ? (
                                                                <><Loader2 size={10} className="animate-spin" />翻译中...</>
                                                            ) : (
                                                                <><Languages size={10} />翻译</>
                                                            )}
                                                        </button>
                                                    )}
                                                    <button
                                                        onClick={() => retryTextCardResult(liveCard.id, idx)}
                                                        className="opacity-0 group-hover:opacity-100 px-2 py-1 text-xs text-amber-400 hover:bg-amber-900/30 rounded flex items-center gap-1 transition-opacity"
                                                    >
                                                        <RotateCcw size={10} />
                                                        重新生成
                                                    </button>
                                                </div>
                                            </div>

                                            {/* 英文原文 */}
                                            <div className="mb-2">
                                                <div className="flex items-center justify-between mb-1">
                                                    <span className="text-[10px] text-zinc-500 font-medium">🇬🇧 English</span>
                                                    <button
                                                        onClick={() => {
                                                            const cleanText = result.replace(/[\r\n]+/g, ' ').trim();
                                                            navigator.clipboard.writeText(cleanText);
                                                            showToast('已复制英文！');
                                                        }}
                                                        className="px-1.5 py-0.5 text-[9px] text-purple-400 hover:bg-purple-900/30 rounded flex items-center gap-0.5"
                                                    >
                                                        <Copy size={8} />
                                                        复制
                                                    </button>
                                                </div>
                                                <div className="text-sm text-zinc-200 whitespace-pre-wrap break-words leading-relaxed bg-zinc-900/50 rounded p-2">
                                                    {result}
                                                </div>
                                            </div>

                                            {/* 中文翻译 */}
                                            {translation && (
                                                <div>
                                                    <div className="flex items-center justify-between mb-1">
                                                        <span className="text-[10px] text-zinc-500 font-medium">🇨🇳 中文</span>
                                                        <button
                                                            onClick={() => {
                                                                const cleanText = translation.replace(/[\r\n]+/g, ' ').trim();
                                                                navigator.clipboard.writeText(cleanText);
                                                                showToast('已复制中文！');
                                                            }}
                                                            className="px-1.5 py-0.5 text-[9px] text-emerald-400 hover:bg-emerald-900/30 rounded flex items-center gap-0.5"
                                                        >
                                                            <Copy size={8} />
                                                            复制
                                                        </button>
                                                    </div>
                                                    <div className="text-sm text-emerald-200 whitespace-pre-wrap break-words leading-relaxed bg-emerald-900/20 rounded p-2 border border-emerald-800/30">
                                                        {translation}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                            {/* 弹窗底部 */}
                            <div className="px-5 py-3 border-t border-zinc-700 flex items-center justify-between bg-zinc-800/30">
                                <span className="text-xs text-zinc-500">共 {liveCard.results.length} 条结果{liveCard.status === 'processing' ? ' · 生成中...' : ''}</span>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => {
                                            appendTextCardResults(liveCard.id, 1);
                                        }}
                                        className="px-3 py-1.5 text-xs text-emerald-400 hover:bg-emerald-900/30 rounded flex items-center gap-1"
                                    >
                                        <Plus size={12} />
                                        追加1条
                                    </button>
                                    <button
                                        onClick={() => {
                                            regenerateTextCard(liveCard.id);
                                        }}
                                        className="px-3 py-1.5 text-xs text-amber-400 hover:bg-amber-900/30 rounded flex items-center gap-1"
                                    >
                                        <RefreshCcw size={12} />
                                        全部重新生成
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 更新说明弹窗 */}
            {showUpdateNotes && (
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[250] flex items-center justify-center p-4"
                    onClick={closeUpdateNotes}
                >
                    <div
                        className="bg-gradient-to-br from-zinc-900 via-zinc-900 to-emerald-950/30 border border-emerald-700/50 rounded-2xl shadow-2xl max-w-3xl w-full max-h-[90vh] overflow-hidden flex flex-col"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 弹窗头部 */}
                        <div className="px-6 py-5 border-b border-emerald-800/30 flex items-start justify-between bg-gradient-to-r from-emerald-900/20 to-transparent">
                            <div className="flex items-start gap-4">
                                <div className="bg-emerald-500/20 rounded-xl p-3 mt-1">
                                    <Sparkles className="text-emerald-400 w-6 h-6" fill="currentColor" />
                                </div>
                                <div>
                                    <h2 className="text-xl font-bold text-emerald-400">功能更新说明</h2>
                                    <p className="text-sm text-zinc-400 mt-1">v2.96 · 2026.02.14</p>
                                </div>
                            </div>
                            <button
                                onClick={closeUpdateNotes}
                                className="px-4 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
                            >
                                知道了
                            </button>
                        </div>

                        {/* 更新内容 */}
                        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-6">
                            {/* v2.96 新功能 */}
                            <div className="space-y-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-xs font-bold text-emerald-400 bg-emerald-500/20 px-2 py-0.5 rounded">2026.02.14</span>
                                    <span className="text-xs text-zinc-500">v2.96.0</span>
                                </div>
                                <div className="bg-zinc-800/50 rounded-lg p-3 border border-cyan-700/30">
                                    <h4 className="text-sm font-semibold text-cyan-300 mb-2">🖼️ 新增拆分模式（split）</h4>
                                    <ul className="text-xs text-zinc-400 space-y-1">
                                        <li>• 将画面元素拆开描述，支持中英文分别输出</li>
                                        <li>• 所有视图（列表、网格、紧凑）统一支持「中」「EN」分语言复制</li>
                                    </ul>
                                </div>
                            </div>

                            <div className="border-t border-zinc-700/50 pt-4">
                                <div className="flex items-center gap-2 mb-3">
                                    <span className="text-xs font-bold text-zinc-500 bg-zinc-700/50 px-2 py-0.5 rounded">2026.02.09</span>
                                    <span className="text-xs text-zinc-500">v2.95.0</span>
                                </div>
                            </div>

                            {/* 一、三种工作模式 */}
                            <div className="space-y-3">
                                <h3 className="text-base font-bold text-emerald-400 flex items-center gap-2">
                                    <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-xs">一</span>
                                    三种工作模式
                                </h3>
                                <p className="text-sm text-zinc-300 leading-relaxed">
                                    工具栏顶部可切换三种模式，覆盖从图片识别到批量描述词创新的完整工作流：
                                </p>
                                <div className="grid gap-3 pl-4">
                                    <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
                                        <h4 className="text-sm font-semibold text-emerald-300 mb-2">⚡ 标准模式</h4>
                                        <ul className="text-xs text-zinc-400 space-y-1">
                                            <li>• 逐张识别分析图片，生成描述词或分析结果</li>
                                            <li>• 支持自定义提示词预设、纯回复模式</li>
                                            <li>• 每张图片支持独立的多轮对话追问</li>
                                            <li>• 批量重试、并发控制、自动上传 Gyazo 图床</li>
                                        </ul>
                                    </div>
                                    <div className="bg-zinc-800/50 rounded-lg p-3 border border-purple-700/30">
                                        <h4 className="text-sm font-semibold text-purple-300 mb-2">✨ 创新模式</h4>
                                        <ul className="text-xs text-zinc-400 space-y-1">
                                            <li>• 基于图片 + 指令，每张图生成多条创新描述词</li>
                                            <li>• 支持融合图片：为卡片额外添加参考图，融合多种风格</li>
                                            <li>• 无图模式：纯文本输入，批量创新描述词</li>
                                            <li>• 翻译功能：单条/批量英→中翻译，结果缓存</li>
                                            <li>• 可发送结果到「反推提示词」工具</li>
                                        </ul>
                                    </div>
                                    <div className="bg-zinc-800/50 rounded-lg p-3 border border-orange-700/30">
                                        <h4 className="text-sm font-semibold text-orange-300 mb-2">⚡ 快捷模式 <span className="text-[10px] text-orange-400 bg-orange-900/30 px-1.5 py-0.5 rounded ml-1">新</span></h4>
                                        <ul className="text-xs text-zinc-400 space-y-1">
                                            <li>• 无需图片，纯文本批量创新的高效模式</li>
                                            <li>• 自动集成随机库系统，实现组合式创新</li>
                                            <li>• 支持配套指令：每个随机库数据源可绑定专用指令</li>
                                            <li>• 紧凑的快捷面板，一站式管理随机库和创新</li>
                                        </ul>
                                    </div>
                                </div>
                            </div>

                            {/* 二、随机库系统 */}
                            <div className="space-y-3">
                                <h3 className="text-base font-bold text-emerald-400 flex items-center gap-2">
                                    <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-xs">二</span>
                                    随机库系统全面升级
                                </h3>
                                <div className="bg-gradient-to-r from-purple-900/30 to-zinc-800/50 rounded-lg p-4 border border-purple-700/30">
                                    <ul className="text-xs text-zinc-300 space-y-2">
                                        <li className="flex items-start gap-2">
                                            <span className="text-purple-400">✨</span>
                                            <span>支持<span className="text-purple-400 font-medium">多维度随机库</span>（风格、场景、角色等），在设定范围内组合式创新</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-400">✓</span>
                                            <span><span className="text-emerald-400 font-medium">Google Sheets 同步</span>：支持从 Google Sheets 导入/导出随机库数据，多数据源切换</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-400">✓</span>
                                            <span><span className="text-amber-400 font-medium">配套指令</span>：每个数据源可绑定专用创新指令，切换数据源时自动切换指令</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-400">✓</span>
                                            <span>AI 智能填充：使用 AI 自动生成随机库内容或分析图片提取元素</span>
                                        </li>
                                        <li className="flex items-start gap-2">
                                            <span className="text-emerald-400">✓</span>
                                            <span>支持笛卡尔积生成所有组合，或智能随机抽取不重复组合</span>
                                        </li>
                                    </ul>
                                </div>
                            </div>

                            {/* 三、项目管理与云同步 */}
                            <div className="space-y-3">
                                <h3 className="text-base font-bold text-emerald-400 flex items-center gap-2">
                                    <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-xs">三</span>
                                    项目管理与云同步
                                </h3>
                                <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
                                    <ul className="text-xs text-zinc-400 space-y-1.5">
                                        <li>• <span className="text-emerald-400">多项目管理</span>：创建多个项目，每个项目独立保存图片、结果、预设等数据</li>
                                        <li>• <span className="text-emerald-400">自动保存</span>：操作过程中自动保存到当前项目</li>
                                        <li>• <span className="text-emerald-400">云端同步</span>：项目数据可同步到 Firestore 云端</li>
                                        <li>• <span className="text-emerald-400">预设同步</span>：自定义预设支持上传/下载到 Google Sheets</li>
                                    </ul>
                                </div>
                            </div>

                            {/* 四、流程说明 */}
                            <div className="space-y-3">
                                <h3 className="text-base font-bold text-emerald-400 flex items-center gap-2">
                                    <span className="bg-emerald-500/20 text-emerald-400 px-2 py-0.5 rounded text-xs">四</span>
                                    工作流程说明
                                </h3>
                                <div className="bg-zinc-800/50 rounded-lg p-3 border border-zinc-700/50">
                                    <ul className="text-xs text-zinc-400 space-y-1.5">
                                        <li>• 本工具专注于 <span className="text-emerald-400">Prompt 创作与批量创新</span></li>
                                        <li>• 创新指令可直接使用 Opal 的特定创新/翻版指令</li>
                                        <li>• 生成的 Prompt 可直接复制粘贴到 Google Sheets 或对接批量生图插件</li>
                                    </ul>
                                </div>
                                <div className="flex items-start gap-2 p-2 bg-emerald-900/20 rounded-lg border border-emerald-700/30">
                                    <span className="text-emerald-400">📌</span>
                                    <p className="text-xs text-emerald-300">本工具专注于写词（Prompt 创作），生图由外部工具完成，组合方式更灵活、可扩展性更强。</p>
                                </div>
                            </div>
                        </div>

                        {/* 弹窗底部 */}
                        <div className="px-6 py-4 border-t border-emerald-800/30 flex items-center justify-between bg-zinc-900/50">
                            <span className="text-xs text-zinc-500">点击外部或按"知道了"关闭此弹窗</span>
                            <button
                                onClick={closeUpdateNotes}
                                className="px-5 py-2 text-sm font-medium text-white bg-emerald-600 hover:bg-emerald-500 rounded-lg transition-colors"
                            >
                                知道了
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 拆分元素模式 - 指令编辑弹窗 */}
            {showSplitSettings && (
                <div
                    className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[200] flex items-center justify-center p-4"
                    onClick={() => setShowSplitSettings(false)}
                >
                    <div
                        className="bg-zinc-900 border border-cyan-700/40 rounded-2xl shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col"
                        onClick={e => e.stopPropagation()}
                    >
                        <div className="px-5 py-4 border-b border-cyan-800/30 flex items-center justify-between bg-gradient-to-r from-cyan-900/20 to-transparent">
                            <div className="flex items-center gap-3">
                                <div className="bg-cyan-500/20 rounded-lg p-2">
                                    <LayoutGrid className="text-cyan-400 w-5 h-5" />
                                </div>
                                <div>
                                    <h3 className="text-base font-bold text-cyan-400">拆分元素设置</h3>
                                    <p className="text-xs text-zinc-500 mt-0.5">自定义拆分指令和元素库</p>
                                </div>
                            </div>
                            <button onClick={() => setShowSplitSettings(false)} className="text-zinc-400 hover:text-white transition-colors">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            {/* 元素库管理 */}
                            <div>
                                <label className="text-sm font-medium text-zinc-300 mb-2 block">元素库（当前 {splitElements.length} 个）</label>
                                <div className="flex flex-wrap gap-1.5 mb-2 p-3 rounded-lg bg-zinc-800/60 border border-zinc-700/50 min-h-[40px]">
                                    {splitElements.map((el, idx) => (
                                        <span key={idx} className="inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium bg-cyan-900/50 text-cyan-300 border border-cyan-700/40">
                                            {el}
                                            <button onClick={() => setSplitElements(prev => prev.filter((_, i) => i !== idx))} className="hover:text-red-400 transition-colors ml-1">
                                                <X size={11} />
                                            </button>
                                        </span>
                                    ))}
                                </div>
                                <div className="flex gap-2">
                                    <input
                                        value={splitElementInput}
                                        onChange={e => setSplitElementInput(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                e.preventDefault();
                                                const vals = splitElementInput.split(/[,，]/).map(v => v.trim()).filter(v => v && !splitElements.includes(v));
                                                if (vals.length > 0) {
                                                    setSplitElements(prev => [...prev, ...vals]);
                                                    setSplitElementInput('');
                                                }
                                            }
                                        }}
                                        placeholder="输入元素名称，按 Enter 添加（支持逗号分隔）"
                                        className="flex-1 px-3 py-2 text-sm rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 outline-none focus:border-cyan-600 placeholder:text-zinc-600"
                                    />
                                    <button
                                        onClick={() => {
                                            const vals = splitElementInput.split(/[,，]/).map(v => v.trim()).filter(v => v && !splitElements.includes(v));
                                            if (vals.length > 0) {
                                                setSplitElements(prev => [...prev, ...vals]);
                                                setSplitElementInput('');
                                            }
                                        }}
                                        className="px-4 py-2 text-sm font-medium rounded-lg bg-cyan-600 text-white hover:bg-cyan-500 transition-colors"
                                    >
                                        添加
                                    </button>
                                </div>
                                <div className="flex items-center justify-between mt-1.5">
                                    <p className="text-xs text-zinc-600">支持批量添加：用逗号分隔多个元素，例如 "人物,背景,光影"</p>
                                    <button
                                        onClick={() => setSplitElements(DEFAULT_SPLIT_ELEMENTS)}
                                        className="text-xs text-orange-500 hover:text-orange-400 transition-colors shrink-0"
                                    >
                                        恢复默认元素
                                    </button>
                                </div>
                            </div>
                            {/* 指令编辑 */}
                            <div>
                                <label className="text-sm font-medium text-zinc-300 mb-2 block">自定义拆分指令</label>
                                <textarea
                                    value={splitInstruction}
                                    onChange={e => setSplitInstruction(e.target.value)}
                                    rows={6}
                                    className="w-full px-3 py-2.5 text-sm rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 outline-none focus:border-cyan-600 resize-y font-mono leading-relaxed placeholder:text-zinc-600"
                                    placeholder="输入拆分指令..."
                                />
                                <div className="flex items-center justify-between mt-1.5">
                                    <p className="text-xs text-zinc-600">系统会自动追加元素库列表和输出格式要求</p>
                                    <button
                                        onClick={() => setSplitInstruction(DEFAULT_SPLIT_INSTRUCTION)}
                                        className="text-xs text-orange-500 hover:text-orange-400 transition-colors"
                                    >
                                        恢复默认指令
                                    </button>
                                </div>
                            </div>
                            {/* 最终指令预览 */}
                            <div>
                                <button
                                    onClick={() => setShowSplitPreview(!showSplitPreview)}
                                    className="flex items-center gap-2 text-sm font-medium text-zinc-300 hover:text-cyan-400 transition-colors w-full"
                                >
                                    <Eye size={14} />
                                    <span>预览最终指令</span>
                                    {showSplitPreview ? <ChevronUp size={14} className="ml-auto" /> : <ChevronDown size={14} className="ml-auto" />}
                                </button>
                                {showSplitPreview && (
                                    <div className="mt-2 p-3 rounded-lg bg-zinc-950 border border-zinc-700/50 max-h-[300px] overflow-y-auto">
                                        <pre className="text-xs text-zinc-400 whitespace-pre-wrap font-mono leading-relaxed">{buildSplitPrompt()}</pre>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="px-5 py-3 border-t border-zinc-800 flex items-center justify-end gap-2">
                            <button onClick={() => setShowSplitSettings(false)} className="px-4 py-2 text-sm font-medium text-white bg-cyan-600 hover:bg-cyan-500 rounded-lg transition-colors">
                                完成
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};

export default ImageRecognitionApp;
