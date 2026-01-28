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
import { ImageItem, Preset, ImageRecognitionState, ChatMessage, InnovationItem, initialImageRecognitionState, savePresetsToStorage, DEFAULT_PRESETS } from './types';
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
import { Play, Pause, Square, ClipboardCopy, Trash2, Settings, Settings2, Zap, LayoutGrid, List, Rows3, Check, X, RotateCw, AlertCircle, CheckCircle2, ImagePlus, Upload, Loader2, Link, FileCode, MessageCircle, Send, Copy, ChevronDown, ChevronUp, Sparkles, Download, ArrowLeftRight, Share2 } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

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
                    console.log('[retryWithBackoff] Empty result, requesting API rotation...');
                    onRotate();
                    didRotate = true;
                }

                // 短暂延迟后重试
                const delay = Math.min(initialDelayMs * Math.pow(1.5, attempt), 5000);
                console.log(`[retryWithBackoff] Empty result, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
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
                    console.log('[retryWithBackoff] Quota exceeded, requesting API rotation...');
                    onRotate();
                    didRotate = true;
                    // 轮换后立即重试，不等待
                    continue;
                }

                // 指数退避：2s, 4s, 8s...
                const delay = initialDelayMs * Math.pow(2, attempt);
                console.log(`Rate limit hit, retrying in ${delay}ms... (attempt ${attempt + 1}/${maxRetries})`);
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
    const { images, prompt, presets, isProcessing, copyMode, viewMode, autoUploadGyazo, innovationInstruction, globalInnovationTemplateId, globalInnovationCount, globalInnovationRounds, pureReplyMode } = state;
    const [showClearConfirm, setShowClearConfirm] = useState(false);
    const [isPaused, setIsPaused] = useState(false);
    const [copySuccess, setCopySuccess] = useState<'links' | 'formulas' | 'results' | 'original' | null>(null);  // 复制成功提示
    const [showAllComplete, setShowAllComplete] = useState(false);  // 全部完成提示
    const [showHistoryPanel, setShowHistoryPanel] = useState(false); // 历史面板 - 已被项目面板替代
    const [showProjectPanel, setShowProjectPanel] = useState(false); // 新的项目管理面板
    const { user } = useAuth();
    const [isBulkInnovating, setIsBulkInnovating] = useState(false);
    const [showGlobalInnovationSettings, setShowGlobalInnovationSettings] = useState(false); // 全局创新设置弹框
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
                    console.log('[Workspace] Loading base64 for image:', img.id, 'from:', urlToFetch);
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
                    console.log('[Workspace] Loaded base64 for:', img.id);
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
                console.log('[Project] Created new temp project:', tempProject.name);
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
            console.log('[Project] Skipping save - no images');
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

        console.log(`[Project] State changed! Images: ${state.images.length}, Success: ${successCount}, Chats: ${totalChats}`)
        lastSavedStateRef.current = stateFingerprint;

        // 保存到项目
        const saveToProject = async () => {
            let projectId = currentProject.id;

            // 临时项目需要先在云端创建
            if (projectId.startsWith('temp_')) {
                // 防止重复创建项目的竞态条件
                if (isCreatingProjectRef.current) {
                    console.log('[Project] Already creating project, skipping...');
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
                    console.log('[Project] Converted temp project to:', projectId);
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

            console.log('[Project] Saving state with', cleanedImages.length, 'images to:', projectId);
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
            console.log('[Project] Switching to:', project.name);
            restoreFromProject(project.currentState);
        } else {
            // 新项目，使用初始状态，但保留当前的 presets
            console.log('[Project] New project, using initial state');
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
                if (cloudPresets && Array.isArray(cloudPresets) && cloudPresets.length > 0) {
                    console.log('[Presets Cloud] Loaded', cloudPresets.length, 'presets from Firebase');

                    // 自动合并新的默认预设（根据名称去重）
                    const existingNames = new Set(cloudPresets.map((p: Preset) => p.name));
                    const newDefaults = DEFAULT_PRESETS.filter(dp => !existingNames.has(dp.name));

                    let finalPresets = cloudPresets;
                    if (newDefaults.length > 0) {
                        // 有新的默认预设需要合并
                        finalPresets = [...newDefaults, ...cloudPresets];
                        console.log(`[Presets Cloud] 自动合并了 ${newDefaults.length} 个新默认预设:`, newDefaults.map(p => p.name));
                        // 异步保存合并后的预设到云端
                        savePresetsToFirebase(user.uid, 'image-recognition', finalPresets).catch(err => {
                            console.error('[Presets Cloud] Failed to save merged presets:', err);
                        });
                    }

                    // 更新状态和本地缓存
                    setState(prev => ({ ...prev, presets: finalPresets }));
                    savePresetsToStorage(finalPresets);
                    presetsSyncedRef.current = true;
                } else {
                    console.log('[Presets Cloud] No presets in Firebase, using defaults');
                    // 云端没有预设，使用默认预设并保存到云端
                    await savePresetsToFirebase(user.uid, 'image-recognition', DEFAULT_PRESETS);
                    setState(prev => ({ ...prev, presets: DEFAULT_PRESETS }));
                    savePresetsToStorage(DEFAULT_PRESETS);
                    presetsSyncedRef.current = true;
                }
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
                console.log('[Presets Cloud] Saved', presets.length, 'presets to Firebase');
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
            console.log('[classifyImage] Getting AI instance...');
            const ai = getAiInstance();
            const modelId = imageModel;

            console.log('[classifyImage] Calling generateContent...');
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

            console.log('[classifyImage] Success!');
            return response.text || "";
        }, 3, 2000, () => {
            console.log('[classifyImage] Rotate API key requested!');
            if (onRotateApiKey) {
                onRotateApiKey();
                console.log('[classifyImage] onRotateApiKey called');
            } else {
                console.warn('[classifyImage] onRotateApiKey is not defined!');
            }
        });
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
            let handled = false;

            if (e.clipboardData) {
                // 1. Files
                if (e.clipboardData.files.length > 0) {
                    e.preventDefault();
                    handleFilesRef.current(Array.from(e.clipboardData.files));
                    handled = true;
                    return;
                }

                // Some browsers only expose pasted images via clipboard items
                const items = Array.from(e.clipboardData.items || []);
                const imageItems = items.filter(item => item.type.startsWith('image/'));
                if (imageItems.length > 0) {
                    const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
                    if (files.length > 0) {
                        e.preventDefault();
                        handleFilesRef.current(files);
                        handled = true;
                        return;
                    }
                }

                // 2. HTML (Google Sheets cells copy as HTML containing <img> tags)
                const html = e.clipboardData.getData('text/html');
                const plainText = e.clipboardData.getData('text/plain');

                const target = e.target as HTMLElement;
                const isHiddenPasteCapture = target.getAttribute('aria-hidden') === 'true';
                const hasImageFormula = !!plainText && plainText.includes('=IMAGE');
                const hasHttp = !!plainText && plainText.includes('http');
                const hasImgTag = !!html && html.includes('<img');
                const shouldHandleText = hasImageFormula || hasHttp || hasImgTag;
                // Skip if pasting into visible input/textarea, but allow hidden paste-capture textarea
                if ((target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') && !shouldHandleText && !isHiddenPasteCapture) {
                    return;
                }


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
                                handleFilesRef.current([file]);
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
        console.log('[handleTextPaste] Input text:', text);
        const parsed = parsePasteInput(text);
        console.log('[handleTextPaste] Parsed result:', JSON.stringify(parsed, null, 2));
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
            let effectivePrompt = (item.useCustomPrompt && item.customPrompt?.trim())
                ? item.customPrompt
                : prompt;

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
        runAnalysis(queue);
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
        runAnalysis(queue);
    };

    const runAnalysis = async (targetImages?: ImageItem[]) => {
        if (!prompt.trim()) {
            alert("请先输入指令或选择一个预设。");
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

        // Process with rate limit protection (concurrency=2, delay=1000ms between requests)
        // 保持适度的并发数和间隔，平衡处理速度和 API 限流风险
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
                let effectivePrompt = (item.useCustomPrompt && item.customPrompt?.trim())
                    ? item.customPrompt
                    : prompt;

                // 如果开启了纯净回复模式，在提示词末尾添加后缀
                if (pureReplyMode) {
                    console.log('[runAnalysis] Pure reply mode is ON, appending suffix');
                    effectivePrompt = effectivePrompt + PURE_REPLY_SUFFIX;
                } else {
                    console.log('[runAnalysis] Pure reply mode is OFF');
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
                        console.log('[Project] Image recognition completed, state will be auto-saved');
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
            alert("请先输入指令或选择一个预设。");
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
                let effectivePrompt = (item.useCustomPrompt && item.customPrompt?.trim())
                    ? item.customPrompt
                    : prompt;

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
            alert('没有可复制的链接');
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
            alert('没有可复制的公式');
        }
    };

    // 复制全部结果 - 保留空行以确保行对齐
    const copyAllResults = () => {
        const lines = images.map(img => {
            if (img.status === 'success' && img.result) {
                return img.result.replace(/\r?\n/g, ' ');
            }
            return ''; // 保留空行
        });

        if (lines.some(l => l)) {
            navigator.clipboard.writeText(lines.join('\n'));
            setCopySuccess('results');
            setTimeout(() => setCopySuccess(null), 2000);
        } else {
            alert('没有可复制的结果');
        }
    };

    // 复制全部原始+结果（Tab分隔）
    const copyAllOriginalAndResults = () => {
        const lines = images.map(img => {
            const original = img.originalInput.startsWith('=IMAGE')
                ? img.originalInput
                : (img.gyazoUrl ? `=IMAGE("${img.gyazoUrl}")` : (img.fetchUrl ? `=IMAGE("${img.fetchUrl}")` : img.originalInput));
            const result = (img.status === 'success' && img.result)
                ? img.result.replace(/\r?\n/g, ' ')
                : '';
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
            alert('没有需要上传的本地图片');
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
                console.log('[Project] Chat completed, state will be auto-saved');
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

            for (let round = 0; round < rounds; round++) {
                // 创新指令 - 生成多个变体
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
                console.log('[Project] Innovation chat completed, state will be auto-saved');
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
            alert('暂无可批量创新的图片，请先完成识别。');
            return;
        }
        setIsBulkInnovating(true);
        try {
            for (const img of readyImages) {
                await startInnovation(img.id);
            }
        } finally {
            setIsBulkInnovating(false);
        }
    }, [images, startInnovation]);

    const handleExportInnovationRecords = useCallback(() => {
        const hasData = images.some(img => getInnovationOutputs(img).length > 0 || (ensureInnovationItemList(img).some(it => it.chatHistory.length > 0)));
        if (!hasData) {
            alert('没有可导出的创新记录');
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
                    if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
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
                            setImageModel={setImageModel}
                            setPrompt={setPrompt}
                            setPresets={setPresets}
                            setViewMode={setViewMode}
                            setAutoUploadGyazo={setAutoUploadGyazo}
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
                                            extraContent={
                                                showClearConfirm ? (
                                                    <div className="flex items-center gap-1 bg-zinc-900 border border-zinc-800 rounded-lg p-0.5 h-[34px]">
                                                        <button onClick={() => { setImages([]); setShowClearConfirm(false); }} className="bg-red-600 hover:bg-red-500 rounded text-white transition-colors h-full px-2 text-[0.625rem]" title="确认清空所有图片">确定</button>
                                                        <button onClick={() => setShowClearConfirm(false)} className="bg-zinc-700 hover:bg-zinc-600 rounded text-zinc-300 transition-colors h-full px-2 text-[0.625rem]" title="取消清空">取消</button>
                                                    </div>
                                                ) : (
                                                    <button
                                                        onClick={() => setShowClearConfirm(true)}
                                                        disabled={images.length === 0}
                                                        className="flex items-center justify-center rounded-lg border border-red-900/30 bg-red-900/10 text-red-400 hover:bg-red-600 hover:text-white hover:border-red-500 transition-all disabled:opacity-30 shrink-0 ml-1 h-[34px] w-[34px]"
                                                        title="清空列表"
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
                                {/* 指令输入区 */}
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
                                    />
                                </div>

                                {/* 右侧工具栏 */}
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

                                    {/* 创新快捷操作 */}
                                    {(() => {
                                        const canBulk = images.some(i => i.status === 'success' && i.result && !i.isInnovating);
                                        const canExport = images.some(img => getInnovationOutputs(img).length > 0 || (ensureInnovationItemList(img).some(it => it.chatHistory.length > 0)));
                                        const btnBase = "flex items-center justify-center gap-1.5 px-2.5 py-2 rounded-md text-[0.6875rem] font-medium border transition-all disabled:opacity-40 disabled:cursor-not-allowed active:scale-95";
                                        return (
                                            <div className="grid grid-cols-3 gap-1.5">
                                                {/* 批量创新 + 设置 */}
                                                <div className="flex gap-1">
                                                    <button
                                                        onClick={handleBulkInnovation}
                                                        disabled={!canBulk || isBulkInnovating}
                                                        className={`flex-1 ${btnBase} tooltip-bottom ${isBulkInnovating ? 'bg-pink-700 text-white border-pink-600 animate-pulse' : 'text-pink-300 bg-pink-900/20 hover:bg-pink-800/30 border-pink-800/40'}`}
                                                        data-tip="对所有已识别的图片执行创新"
                                                    >
                                                        {isBulkInnovating ? <Loader2 size={12} className="animate-spin" /> : <Sparkles size={12} />}
                                                        批量创新
                                                    </button>
                                                    <button
                                                        onClick={() => setShowGlobalInnovationSettings(true)}
                                                        className="px-2 py-2 rounded-md text-[0.6875rem] font-medium border transition-all active:scale-95 text-zinc-400 bg-zinc-800/50 hover:bg-zinc-700/50 border-zinc-700/50 hover:text-zinc-200 tooltip-bottom"
                                                        data-tip="批量创新设置"
                                                    >
                                                        <Settings2 size={12} />
                                                    </button>
                                                </div>
                                                <button
                                                    onClick={handleExportInnovationRecords}
                                                    disabled={!canExport}
                                                    className={`${btnBase} tooltip-bottom ${canExport ? 'text-emerald-300 bg-emerald-900/20 hover:bg-emerald-800/30 border-emerald-800/40' : 'text-zinc-500 bg-zinc-800/40 border-zinc-700/40'}`}
                                                    data-tip="导出创新结果与对话记录"
                                                >
                                                    <Download size={12} />
                                                    导出创新
                                                </button>
                                                <button
                                                    onClick={handleSendAllToDesc}
                                                    disabled={images.filter(i => i.status === 'success' && i.result).length === 0}
                                                    className={`${btnBase} ${sentAllCount !== null ? 'text-emerald-300 bg-emerald-800/30 border-emerald-600/50' : 'text-blue-200 bg-blue-900/20 hover:bg-blue-800/30 border-blue-800/40'}`}
                                                    title={sentAllCount !== null ? `已发送 ${sentAllCount} 条` : '一键发送到提示词创新'}
                                                >
                                                    {sentAllCount !== null ? <Check size={12} /> : <Share2 size={12} />}
                                                    {sentAllCount !== null ? `已发送 ${sentAllCount}` : '批量送去创新'}
                                                </button>
                                            </div>
                                        );
                                    })()}

                                    {/* 状态统计与主控 */}
                                    <div className="flex flex-col gap-2 mt-auto pt-2 border-t border-zinc-800/50">
                                        {/* 状态统计条 */}
                                        <div className="grid grid-cols-4 gap-1.5 mb-1">
                                            <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/40 text-zinc-400 hover:bg-zinc-800/60 transition-colors cursor-default" title="队列">
                                                <span className="text-[0.6875rem] font-medium">队列</span>
                                                <span className="text-xs font-bold text-zinc-200 font-mono">{images.length}</span>
                                            </div>
                                            <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors cursor-default" title="待处理">
                                                <span className="text-[0.6875rem] font-medium">待处理</span>
                                                <span className="text-xs font-bold text-amber-300 font-mono">{images.filter(i => i.status === 'idle' && i.base64Data).length}</span>
                                            </div>
                                            <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-default" title="成功">
                                                <span className="text-[0.6875rem] font-medium">成功</span>
                                                <span className="text-xs font-bold text-emerald-300 font-mono">{images.filter(i => i.status === 'success').length}</span>
                                            </div>
                                            <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors cursor-default" title="失败">
                                                <span className="text-[0.6875rem] font-medium">失败</span>
                                                <span className="text-xs font-bold text-red-300 font-mono">{images.filter(i => i.status === 'error').length}</span>
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
                                                    title="开始对待处理的图片进行 AI 识别"
                                                >
                                                    <Zap size={16} fill="currentColor" /> 开始识别
                                                </button>

                                                {/* 辅助按钮 */}
                                                {images.filter(i => i.status === 'idle' && i.base64Data).length === 0 &&
                                                    images.filter(i => (i.status === 'success' || i.status === 'error') && i.base64Data).length > 0 && (
                                                        <button
                                                            onClick={handleResetAndRun}
                                                            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 shadow-sm hover:shadow-blue-500/20 shrink-0"
                                                            title="重新将所有图片设为待处理并立即开始"
                                                        >
                                                            <RotateCw size={14} /> 全部重跑
                                                        </button>
                                                    )}

                                                {images.filter(i => i.status === 'error').length > 0 && (
                                                    <button
                                                        onClick={handleRetryFailedAndRun}
                                                        className="px-4 py-2 bg-red-900/40 hover:bg-red-900/60 text-red-300 border border-red-500/30 rounded-lg text-xs font-medium transition-colors flex items-center justify-center gap-1.5 shrink-0"
                                                        title="仅重试失败的任务"
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
                                                    title={isPaused ? '继续处理队列' : '暂停处理队列'}
                                                >
                                                    {isPaused ? <><Play size={16} fill="currentColor" /> 继续</> : <><Pause size={16} fill="currentColor" /> 暂停</>}
                                                </button>
                                                <button
                                                    onClick={handleStop}
                                                    className="py-2.5 rounded-lg font-bold text-sm flex items-center justify-center gap-2 bg-zinc-800 hover:bg-red-600/90 text-zinc-300 hover:text-white transition-all"
                                                    title="停止处理并清除队列"
                                                >
                                                    <Square size={16} fill="currentColor" /> 停止
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </div>

                                {/* 提示信息 - 全宽显示 */}
                                {!prompt.trim() && images.length > 0 && (
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

                {/* 主内容区 */}
                <div className="flex-1 overflow-auto">
                    <div className="max-w-none mx-auto px-4 py-4">
                        {/* 结果列表 */}
                        <div className="flex-1">
                            {images.length === 0 ? (
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
                                            e.preventDefault();
                                            const clipboardData = e.clipboardData;

                                            // 检查是否有图片文件
                                            const files = (Array.from(clipboardData.files) as File[]).filter(file => file.type.startsWith('image/'));
                                            if (files.length > 0) {
                                                handleFiles(files);
                                                return;
                                            }

                                            // Some browsers only expose pasted images via clipboard items
                                            const items = Array.from(clipboardData.items || []);
                                            const imageItems = items.filter(item => item.type.startsWith('image/'));
                                            if (imageItems.length > 0) {
                                                const itemFiles = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
                                                if (itemFiles.length > 0) {
                                                    handleFiles(itemFiles);
                                                    return;
                                                }
                                            }

                                            // 优先检查纯文本中是否有 =IMAGE() 公式
                                            const text = clipboardData.getData('text/plain');
                                            if (text && text.includes('=IMAGE')) {
                                                console.log('[DropZone Paste] Detected =IMAGE formula, using text parser');
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
                                />
                            )}
                        </div>
                    </div>
                </div>

                {/* 全局创新设置弹框 */}
                {
                    showGlobalInnovationSettings && (
                        <div
                            className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50"
                            onClick={() => setShowGlobalInnovationSettings(false)}
                        >
                            <div
                                className="bg-zinc-900 border border-zinc-700 rounded-xl p-5 w-[400px] max-w-[90vw] shadow-2xl"
                                onClick={e => e.stopPropagation()}
                            >
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-semibold text-zinc-100 flex items-center gap-2">
                                        <Settings2 size={18} className="text-pink-400" />
                                        批量创新设置
                                    </h3>
                                    <button
                                        onClick={() => setShowGlobalInnovationSettings(false)}
                                        className="text-zinc-500 hover:text-zinc-300 transition-colors"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>

                                {/* 指令模板选择 */}
                                <div className="mb-4">
                                    <label className="block text-xs font-medium text-zinc-400 mb-1.5">指令模版</label>
                                    <select
                                        value={globalInnovationTemplateId || '__system_default__'}
                                        onChange={(e) => setState(prev => ({ ...prev, globalInnovationTemplateId: e.target.value }))}
                                        className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500"
                                    >
                                        <option value="__system_default__">系统默认</option>
                                        <option value="__custom__">自定义</option>
                                        {/* 创新指令 */}
                                        {templateState?.savedTemplates && templateState.savedTemplates.length > 0 && (
                                            <optgroup label="创新指令">
                                                {templateState.savedTemplates.map(t => (
                                                    <option key={t.id} value={t.id}>{t.name}</option>
                                                ))}
                                            </optgroup>
                                        )}
                                        {/* 识别指令 */}
                                        {unifiedPresets.filter(p => p.source === 'recognition').length > 0 && (
                                            <optgroup label="识别指令">
                                                {unifiedPresets.filter(p => p.source === 'recognition').map(p => (
                                                    <option key={p.id} value={`rec:${p.id}`}>{p.name}</option>
                                                ))}
                                            </optgroup>
                                        )}
                                    </select>

                                    {/* 自定义指令输入框 */}
                                    {globalInnovationTemplateId === '__custom__' && (
                                        <textarea
                                            value={innovationInstruction || ''}
                                            onChange={(e) => setState(prev => ({ ...prev, innovationInstruction: e.target.value }))}
                                            placeholder="输入自定义创新指令..."
                                            className="w-full mt-2 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 min-h-[100px] resize-y"
                                        />
                                    )}
                                </div>

                                {/* 每轮个数 和 轮数 */}
                                <div className="grid grid-cols-2 gap-4 mb-4">
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">每轮个数</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="50"
                                            value={globalInnovationCount || 3}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value) || 3;
                                                setState(prev => ({ ...prev, globalInnovationCount: Math.min(50, Math.max(1, val)) }));
                                            }}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="block text-xs font-medium text-zinc-400 mb-1.5">创新轮数</label>
                                        <input
                                            type="number"
                                            min="1"
                                            max="10"
                                            value={globalInnovationRounds || 1}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value) || 1;
                                                setState(prev => ({ ...prev, globalInnovationRounds: Math.min(10, Math.max(1, val)) }));
                                            }}
                                            className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500"
                                        />
                                    </div>
                                </div>

                                <div className="text-xs text-zinc-500 mb-4">
                                    这些设置将应用于所有未单独配置的图片。已单独设置的图片会使用其自己的配置。
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
        </>
    );
};

export default ImageRecognitionApp;
