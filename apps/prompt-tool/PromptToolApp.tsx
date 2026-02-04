
import React, { useState, useRef, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../../contexts/AuthContext';
import ProjectPanel from '../../components/ProjectPanel';
import {
    Project,
    debouncedSaveProject,
    createProject
} from '../../services/projectService';
import {
    Zap,
    Play,
    Pause,
    Square,
    Trash2,
    Copy,
    Check,
    Eye,
    Settings2,
    MessageSquareText,
    List,
    ChevronDown,
    ChevronUp,
    AlertCircle,
    X,
    FilePlus,
    Files,
    Sparkles,
    Loader2,
    Languages,
    ArrowLeftRight,
    ClipboardCopy,
    RotateCw,
    SlidersHorizontal,
    Plus,
    MessageCircle,
    Send,
    Paperclip,
    Image as ImageIcon,
    Download,
    FileText,
    MessageSquare
} from 'lucide-react';
import { DirectChatView } from './DirectChatView';
import { CopywritingView } from './CopywritingView';
import {
    appendToSheet,
    getSheetsSyncConfig
} from '@/services/sheetsSyncService';

// --- Types ---

interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    images?: string[]; // Base64 data strings (full data URL)
    timestamp: number;
}

interface OutputItem {
    id: string;
    en: string;
    zh: string;
    // Chat state
    chatHistory: ChatMessage[];
    isChatOpen: boolean;
    chatInput: string;
    chatAttachments?: string[]; // Pending image attachments (data URLs)
    isChatLoading: boolean;
}

interface DescEntry {
    id: string;
    source: string;
    outputs: OutputItem[];
    status: 'idle' | 'processing' | 'success' | 'error';
    error?: string | null;
    roundsCompleted: number;
    // Per-entry overrides
    customTemplateId?: string;
    customRequirement?: string;
    customCount?: number;
    customRounds?: number;
    showSettings?: boolean; // UI toggle for settings panel
    originImageUrl?: string;
    originInput?: string;
    originChatHistory?: ChatMessage[];
    fromImageRecognition?: boolean;
    // 原始对话（用于图片识别侧传入的历史）
    originChatOpen?: boolean;
    originChatInput?: string;
    originChatAttachments?: string[];
    originChatLoading?: boolean;
}

export interface DescState {
    entries: DescEntry[];
    requirement: string;
    countPerRound: number;
    rounds: number;
    selectedTemplateId: string;
    bulkInput: string;
    isProcessing: boolean;
    isPaused: boolean;
    enableTranslation: boolean;
    viewLanguage: 'en' | 'zh'; // Global default
    viewOverrides: Record<string, 'en' | 'zh'>; // Overrides for specific IDs (task or card)
    pendingAutoGenerate?: boolean; // Signal to trigger processing after state update
    activeTab?: 'innovator' | 'chat' | 'copywriting'; // New state for tab switching
}

// --- Constants ---
const DEFAULT_SPLIT_CHAR = '###SPLIT###';
const STORAGE_KEY = 'desc_innovator_state_v5'; // Bumped version for new OutputItem structure

// 2025年12月 Gemini API 规范模型选项
const MODEL_OPTIONS = [
    { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview' },
    { value: 'gemini-3-pro-preview', label: 'gemini-3-pro-preview' },
];

// --- Helpers ---
const convertBlobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

// Helper for retrying on empty results - 当 AI 返回空结果时自动重试
async function retryOnEmpty<T>(
    fn: () => Promise<T>,
    isEmpty: (result: T) => boolean,
    maxRetries: number = 3,
    initialDelayMs: number = 1500
): Promise<T> {
    let lastResult: T | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await fn();
            lastResult = result;

            if (!isEmpty(result)) {
                return result;
            }

            if (attempt < maxRetries) {
                const delay = Math.min(initialDelayMs * Math.pow(1.5, attempt), 5000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        } catch (error) {
            throw error;
        }
    }

    console.warn('[retryOnEmpty] All retries exhausted with empty results');
    return lastResult!;
}

// 统一的简单预设类型（用于跨应用共享）
type SimplePreset = {
    id: string;
    name: string;
    text: string;
    source: 'recognition' | 'template' | 'system';
};

// --- Props ---
interface PromptToolAppProps {
    getAiInstance: () => GoogleGenAI;
    textModel: string;
    templateState: any;
    unifiedPresets?: SimplePreset[];
}

// --- Component ---
export default function PromptToolApp({ getAiInstance, textModel, templateState, unifiedPresets = [] }: PromptToolAppProps) {
    // --- State ---
    // 每次打开从空白状态开始，只恢复配置设置（不恢复 entries）
    const [state, setState] = useState<DescState>(() => {
        // 尝试加载配置设置
        let savedSettings: any = null;
        if (typeof window !== 'undefined') {
            try {
                const stored = localStorage.getItem(STORAGE_KEY);
                if (stored) {
                    savedSettings = JSON.parse(stored);
                }
            } catch (e) {
                console.warn('Failed to load desc state', e);
            }
        }

        // 返回空白状态，但恢复一些配置
        return {
            entries: [],  // 不恢复之前的任务
            requirement: savedSettings?.requirement || '',
            countPerRound: savedSettings?.countPerRound || 3,
            rounds: savedSettings?.rounds || 1,
            selectedTemplateId: savedSettings?.selectedTemplateId || 'custom',
            bulkInput: '',  // 不恢复输入
            isProcessing: false,
            isPaused: false,
            enableTranslation: savedSettings?.enableTranslation ?? true,
            viewLanguage: savedSettings?.viewLanguage || 'en',
            viewOverrides: {},
            pendingAutoGenerate: false,
            activeTab: savedSettings?.activeTab || 'innovator'
        };
    });

    const [currentModel, setCurrentModel] = useState(textModel || 'gemini-3-flash-preview');
    const [showPreviewModal, setShowPreviewModal] = useState(false);
    const [previewContent, setPreviewContent] = useState('');
    const [expandedEntryIds, setExpandedEntryIds] = useState<string[]>([]);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [singleRunId, setSingleRunId] = useState<string | null>(null);
    const [draggingOutputId, setDraggingOutputId] = useState<string | null>(null);
    const [showHistoryPanel, setShowHistoryPanel] = useState(false); // 兼容式保留
    const [showProjectPanel, setShowProjectPanel] = useState(false);
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const projectInitializedRef = useRef(false);
    const lastSavedStateRef = useRef<string>('');
    const isCreatingProjectRef = useRef(false); // 防止重复创建项目的竞态条件
    // 双击放大结果文本模态框 - 存储两种语言版本和当前显示模式
    const [expandedOutput, setExpandedOutput] = useState<{ en: string; zh: string | null; mode: 'en' | 'zh' } | null>(null);
    const { user } = useAuth();

    const stopRef = useRef(false);
    const pauseRef = useRef(false);
    const stateRef = useRef(state);
    const singleRunIdRef = useRef<string | null>(null);

    // Keep stateRef updated with latest state
    useEffect(() => {
        stateRef.current = state;
    }, [state]);

    useEffect(() => {
        singleRunIdRef.current = singleRunId;
    }, [singleRunId]);

    useEffect(() => {
        if (typeof window !== 'undefined') {
            try {
                const { isProcessing, isPaused, pendingAutoGenerate, ...rest } = state;
                // Clean large data (images) before saving to localStorage
                const stateToSave = {
                    ...rest,
                    entries: rest.entries.map(entry => ({
                        ...entry,
                        originChatAttachments: [],
                        originChatLoading: false,
                        originChatHistory: (entry.originChatHistory || []).map(msg => ({
                            ...msg,
                            images: []
                        })),
                        outputs: entry.outputs.map(output => ({
                            ...output,
                            chatAttachments: [], // Don't save pending attachments (large base64)
                            isChatLoading: false,
                            // Keep chat history text but remove images to save space
                            chatHistory: output.chatHistory.map(msg => ({
                                ...msg,
                                images: [] // Clear images from chat history
                            }))
                        }))
                    }))
                };
                localStorage.setItem(STORAGE_KEY, JSON.stringify(stateToSave));
            } catch (err) {
                console.warn('Failed to save state to localStorage:', err);
            }
        }
    }, [state]);

    // 自动保存状态到项目
    useEffect(() => {
        if (!user?.uid || state.entries.length === 0) return;

        // 只保存有结果的条目
        const completedEntries = state.entries.filter(e => e.status === 'success' && e.outputs.length > 0);
        if (completedEntries.length === 0) return;

        // 初始化项目（如果没有）
        if (!currentProject && !projectInitializedRef.current) {
            projectInitializedRef.current = true;
            const tempProject: Project = {
                id: `temp_${Date.now()}`,
                moduleId: 'desc-innovator',
                name: '新建创新项目',
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
                updatedAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
                isActive: true,
                isStarred: false,
                isPinned: false,
                tags: [],
                preview: '',
                itemCount: 0,
                currentState: {},
                versionCount: 0
            };
            setCurrentProject(tempProject);
            return;
        }

        if (!currentProject?.id) return;

        // 序列化状态用于比较
        const stateSnapshot = JSON.stringify({
            entries: completedEntries.map(e => ({
                id: e.id,
                source: e.source,
                outputCount: e.outputs.length,
                firstOutput: e.outputs[0]?.en?.slice(0, 50)
            }))
        });

        if (stateSnapshot === lastSavedStateRef.current) return;
        lastSavedStateRef.current = stateSnapshot;

        // 保存到项目
        const saveToProject = async () => {
            let projectId = currentProject.id;

            // 临时项目需要先创建
            if (projectId.startsWith('temp_')) {
                // 防止重复创建项目的竞态条件
                if (isCreatingProjectRef.current) {
                    return;
                }

                isCreatingProjectRef.current = true;
                try {
                    const firstEntry = completedEntries[0];
                    const projectName = firstEntry.source?.slice(0, 30) || '创新项目';
                    projectId = await createProject(user.uid, {
                        moduleId: 'desc-innovator',
                        name: projectName
                    });
                    setCurrentProject(prev => prev ? { ...prev, id: projectId, name: projectName } : null);
                } catch (error) {
                    console.error('[Project] Failed to create project:', error);
                    isCreatingProjectRef.current = false;
                    return;
                }
                isCreatingProjectRef.current = false;
            }

            // 清理保存的数据（移除大型数据如图片）
            const cleanedEntries = completedEntries.map(entry => ({
                id: entry.id,
                source: entry.source,
                status: entry.status,
                roundsCompleted: entry.roundsCompleted,
                outputs: entry.outputs.map(output => ({
                    id: output.id,
                    en: output.en,
                    zh: output.zh,
                    chatHistory: output.chatHistory.map(msg => ({
                        id: msg.id,
                        role: msg.role,
                        text: msg.text,
                        timestamp: msg.timestamp
                        // 移除 images 字段
                    }))
                }))
            }));

            const stateToSave = {
                entries: cleanedEntries,
                requirement: state.requirement,
                countPerRound: state.countPerRound,
                rounds: state.rounds,
                enableTranslation: state.enableTranslation
            };

            const previewText = completedEntries[0]?.outputs[0]?.en?.slice(0, 100) || '';
            const totalOutputs = completedEntries.reduce((sum, e) => sum + e.outputs.length, 0);

            debouncedSaveProject(user.uid, 'desc-innovator', projectId, stateToSave, {
                preview: previewText,
                itemCount: totalOutputs
            });
        };

        saveToProject();
    }, [user?.uid, state.entries, currentProject]);

    // 接收从图片识别发送过来的外部创新任务
    useEffect(() => {
        const handler = (e: CustomEvent<{ items?: any[] }>) => {
            const items = e.detail?.items || [];
            if (!Array.isArray(items) || items.length === 0) return;
            const newEntries = items.map(buildEntryFromIncoming);
            const newIds = newEntries.map(e => e.id);
            setState(prev => ({
                ...prev,
                entries: [...newEntries, ...prev.entries],
                activeTab: 'innovator'
            }));
            setExpandedEntryIds(prev => [...newIds, ...prev]);
        };
        window.addEventListener('desc-add-from-image-recognition', handler as EventListener);
        return () => window.removeEventListener('desc-add-from-image-recognition', handler as EventListener);
    }, []);

    // --- Helpers ---

    const getViewMode = (entryId: string, cardIndex?: number) => {
        const cardId = cardIndex !== undefined ? `${entryId}-${cardIndex}` : null;
        if (cardId && state.viewOverrides[cardId]) return state.viewOverrides[cardId];
        if (state.viewOverrides[entryId]) return state.viewOverrides[entryId];
        return state.viewLanguage;
    };

    const toggleViewOverride = (id: string, currentEffectiveMode: 'en' | 'zh') => {
        setState(prev => {
            const nextMode = currentEffectiveMode === 'en' ? 'zh' : 'en';
            return {
                ...prev,
                viewOverrides: { ...prev.viewOverrides, [id]: nextMode }
            };
        });
    };

    const getSelectedTemplateContent = (entry?: DescEntry) => {
        const templateId = entry?.customTemplateId ?? state.selectedTemplateId;
        if (!templateId || templateId === 'custom') return '';

        // Handle recognition preset (prefixed with 'rec:')
        if (templateId.startsWith('rec:')) {
            const presetId = templateId.substring(4);
            const preset = unifiedPresets.find(p => p.id === presetId);
            return preset?.text || '';
        }

        // Handle template builder template
        const template = templateState.savedTemplates.find((t: any) => t.id === templateId);
        if (!template) return '';
        return template.sections.map((section: any) => (template.values[section.id] || '').trim()).filter(Boolean).join('\n\n');
    };

    const buildEntryFromIncoming = (item: any): DescEntry => {
        const baseText = (item?.text || '').trim();
        const history: ChatMessage[] = Array.isArray(item?.chatHistory) ? item.chatHistory : [];
        // 不预先创建 output，outputs 应该在创新后才生成
        return {
            id: uuidv4(),
            source: baseText || '（待编辑）',
            outputs: [], // 初始为空，等待创新生成
            status: 'idle',
            error: null,
            roundsCompleted: 0,
            customTemplateId: undefined,
            customRequirement: '',
            customCount: undefined,
            customRounds: undefined,
            showSettings: false,
            originImageUrl: item?.imageUrl,
            originInput: item?.originalInput,
            originChatHistory: history,
            originChatOpen: history.length > 0, // 有对话历史时自动展开
            originChatInput: '',
            originChatAttachments: [],
            originChatLoading: false,
            fromImageRecognition: true
        };
    };

    const buildFinalPrompt = (baseDescription: string, entry?: DescEntry) => {
        const templateContent = getSelectedTemplateContent();
        const requirement = (entry?.customRequirement && entry.customRequirement.trim())
            ? entry.customRequirement.trim()
            : state.requirement.trim();

        const count = (entry?.customCount !== undefined && entry.customCount > 0)
            ? entry.customCount
            : state.countPerRound;

        const enableTranslation = state.enableTranslation;

        let prompt = `You are a creative writing assistant specialized in generating AI image prompts.
    
**Objective:**
Innovate and expand upon the provided "Base Description" based on the "Requirements" and "Context".

**Context / Template:**
${templateContent}

**Specific Innovation Requirements:**
${requirement || 'Provide diverse and creative variations suitable for high-quality AI image generation.'}

**Format Instructions (CRITICAL):**
1. Generate exactly ${count} distinct variations.
2. Separate each variation strictly with the string: "${DEFAULT_SPLIT_CHAR}".
3. Do NOT number the outputs (e.g., don't do "1. ...").
4. Output NOTHING else but the variations separated by the splitter.
${enableTranslation ?
                `5. Translation Mode is ENABLED. You MUST output each variation in this EXACT format:
English: [Detailed English Prompt]
Chinese: [Chinese Translation]

Rules:
- The English prompt should be detailed, descriptive, and high-quality (approx. 3-5 sentences).
- The Chinese translation must correspond to the English prompt.
- Do NOT include any other text.`
                :
                `5. Translation Mode is DISABLED.
- Provide the prompts in English ONLY.
- If the input is in Chinese, TRANSLATE it to English.
- Do NOT return any Chinese characters.
- Do NOT add any extra text.`}

**Base Description:**
${baseDescription}
`;
        return prompt;
    };

    // --- Chat Handlers ---

    const toggleOriginChat = (entryId: string) => {
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => e.id === entryId ? { ...e, originChatOpen: !e.originChatOpen } : e)
        }));
    };

    const updateOriginChatInput = (entryId: string, value: string) => {
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => e.id === entryId ? { ...e, originChatInput: value } : e)
        }));
    };

    const updateOriginChatAttachments = (entryId: string, attachments: string[]) => {
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => e.id === entryId ? { ...e, originChatAttachments: attachments } : e)
        }));
    };

    const appendOriginChatAttachments = (entryId: string, newAttachments: string[]) => {
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => e.id === entryId ? { ...e, originChatAttachments: [...(e.originChatAttachments || []), ...newAttachments] } : e)
        }));
    };

    const removeOriginChatAttachment = (entryId: string, index: number) => {
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => e.id === entryId ? {
                ...e,
                originChatAttachments: (e.originChatAttachments || []).filter((_, i) => i !== index)
            } : e)
        }));
    };

    const toggleOutputChat = (entryId: string, outputId: string) => {
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => {
                if (e.id === entryId) {
                    return {
                        ...e,
                        outputs: e.outputs.map(o => o.id === outputId ? { ...o, isChatOpen: !o.isChatOpen } : o)
                    };
                }
                return e;
            })
        }));
    };

    const updateOutputChatInput = (entryId: string, outputId: string, value: string) => {
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => {
                if (e.id === entryId) {
                    return {
                        ...e,
                        outputs: e.outputs.map(o => o.id === outputId ? { ...o, chatInput: value } : o)
                    };
                }
                return e;
            })
        }));
    };

    const updateOutputChatAttachments = (entryId: string, outputId: string, attachments: string[]) => {
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => {
                if (e.id === entryId) {
                    return {
                        ...e,
                        outputs: e.outputs.map(o => o.id === outputId ? { ...o, chatAttachments: attachments } : o)
                    };
                }
                return e;
            })
        }));
    };

    const appendOutputChatAttachments = (entryId: string, outputId: string, newAttachments: string[]) => {
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => {
                if (e.id === entryId) {
                    return {
                        ...e,
                        outputs: e.outputs.map(o => o.id === outputId ? {
                            ...o,
                            chatAttachments: [...(o.chatAttachments || []), ...newAttachments]
                        } : o)
                    };
                }
                return e;
            })
        }));
    };

    const removeChatAttachment = (entryId: string, outputId: string, index: number) => {
        const entry = state.entries.find(e => e.id === entryId);
        const output = entry?.outputs.find(o => o.id === outputId);
        if (!output || !output.chatAttachments) return;
        const newAttachments = output.chatAttachments.filter((_, i) => i !== index);
        updateOutputChatAttachments(entryId, outputId, newAttachments);
    };

    const handleChatFileSelect = async (entryId: string, outputId: string) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*';
        input.onchange = async (e: any) => {
            const files = Array.from(e.target.files || []) as File[];
            if (files.length === 0) return;

            const newAttachments: string[] = [];
            for (const file of files) {
                try {
                    const base64 = await convertBlobToBase64(file);
                    newAttachments.push(base64);
                } catch (err) {
                    console.error('Failed to process file', err);
                }
            }

            if (newAttachments.length > 0) {
                appendOutputChatAttachments(entryId, outputId, newAttachments);
            }
        };
        input.click();
    };

    const handleOriginChatFileSelect = async (entryId: string) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        input.accept = 'image/*';
        input.onchange = async (e: any) => {
            const files = Array.from(e.target.files || []) as File[];
            if (files.length === 0) return;

            const newAttachments: string[] = [];
            for (const file of files) {
                try {
                    const base64 = await convertBlobToBase64(file);
                    newAttachments.push(base64);
                } catch (err) {
                    console.error('Failed to process file', err);
                }
            }

            if (newAttachments.length > 0) {
                appendOriginChatAttachments(entryId, newAttachments);
            }
        };
        input.click();
    };

    const handleChatDrop = async (e: React.DragEvent, entryId: string, outputId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setDraggingOutputId(null);

        const files = Array.from(e.dataTransfer.files).filter((f: File) => f.type.startsWith('image/'));
        if (files.length === 0) return;

        const newAttachments: string[] = [];
        for (const file of files) {
            try {
                const base64 = await convertBlobToBase64(file);
                newAttachments.push(base64);
            } catch (err) {
                console.error('Failed to process dropped image', err);
            }
        }

        if (newAttachments.length > 0) {
            appendOutputChatAttachments(entryId, outputId, newAttachments);
        }
    };

    const handleOriginChatDrop = async (e: React.DragEvent, entryId: string) => {
        e.preventDefault();
        e.stopPropagation();

        const files = Array.from(e.dataTransfer.files).filter((f: File) => f.type.startsWith('image/'));
        if (files.length === 0) return;

        const newAttachments: string[] = [];
        for (const file of files) {
            try {
                const base64 = await convertBlobToBase64(file);
                newAttachments.push(base64);
            } catch (err) {
                console.error('Failed to process dropped image', err);
            }
        }

        if (newAttachments.length > 0) {
            appendOriginChatAttachments(entryId, newAttachments);
        }
    };

    const handleChatPaste = async (e: React.ClipboardEvent, entryId: string, outputId: string) => {
        const items = e.clipboardData.items;
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                const file = items[i].getAsFile();
                if (file) files.push(file);
            }
        }

        if (files.length === 0) return;

        e.preventDefault();
        const newAttachments: string[] = [];
        for (const file of files) {
            try {
                const base64 = await convertBlobToBase64(file);
                newAttachments.push(base64);
            } catch (err) {
                console.error('Failed to process pasted image', err);
            }
        }

        if (newAttachments.length > 0) {
            appendOutputChatAttachments(entryId, outputId, newAttachments);
        }
    };

    const handleOriginChatPaste = async (e: React.ClipboardEvent, entryId: string) => {
        const items = e.clipboardData.items;
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                const file = items[i].getAsFile();
                if (file) files.push(file);
            }
        }

        if (files.length === 0) return;

        e.preventDefault();
        const newAttachments: string[] = [];
        for (const file of files) {
            try {
                const base64 = await convertBlobToBase64(file);
                newAttachments.push(base64);
            } catch (err) {
                console.error('Failed to process pasted image', err);
            }
        }

        if (newAttachments.length > 0) {
            appendOriginChatAttachments(entryId, newAttachments);
        }
    };

    const sendOriginChatMessage = async (entryId: string) => {
        const entry = state.entries.find(e => e.id === entryId);
        if (!entry) return;

        const hasInput = entry.originChatInput && entry.originChatInput.trim();
        const hasImages = entry.originChatAttachments && entry.originChatAttachments.length > 0;
        if (!hasInput && !hasImages) return;

        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            text: (entry.originChatInput || '').trim(),
            images: entry.originChatAttachments || [],
            timestamp: Date.now()
        };

        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => e.id === entryId ? {
                ...e,
                originChatHistory: [...(e.originChatHistory || []), userMsg],
                originChatInput: '',
                originChatAttachments: [],
                originChatLoading: true
            } : e)
        }));

        try {
            const ai = getAiInstance();
            const parts: any[] = [];

            if (userMsg.images && userMsg.images.length > 0) {
                userMsg.images.forEach(imgBase64 => {
                    const mimeMatch = imgBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                    const base64Parts = imgBase64.split(',');
                    const base64Data = base64Parts.length > 1 ? base64Parts[1] : imgBase64;
                    if (base64Data) {
                        parts.push({
                            inlineData: {
                                mimeType,
                                data: base64Data
                            }
                        });
                    }
                });
            }

            const firstOutput = entry.outputs[0];
            const promptText = `You are a creative assistant helping to refine the original prompt before innovation.

Original Input: "${entry.originInput || entry.source}"
${firstOutput ? `Current Draft (English): "${firstOutput.en}"` : ''}
${firstOutput?.zh ? `Current Draft (Chinese): "${firstOutput.zh}"` : ''}

User Message: "${userMsg.text}"

Please respond as a helpful editor: adjust the draft based on the user request and any attached reference images. Keep answers concise and focused on prompt quality.${state.enableTranslation ? ' Provide both English and Chinese if relevant.' : ''}`;

            parts.push({ text: promptText });

            const result = await ai.models.generateContent({
                model: currentModel,
                contents: { parts }
            });

            const responseText = result.text || 'No response';
            const modelMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: responseText,
                timestamp: Date.now()
            };

            setState(prev => ({
                ...prev,
                entries: prev.entries.map(e => e.id === entryId ? {
                    ...e,
                    originChatHistory: [...(e.originChatHistory || []), modelMsg],
                    originChatLoading: false
                } : e)
            }));
        } catch (error: any) {
            console.error(error);
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: `Error: ${error.message || 'Request failed'}`,
                timestamp: Date.now()
            };
            setState(prev => ({
                ...prev,
                entries: prev.entries.map(e => e.id === entryId ? {
                    ...e,
                    originChatHistory: [...(e.originChatHistory || []), errorMsg],
                    originChatLoading: false
                } : e)
            }));
        }
    };

    // 将原始对话的最后一条AI回复应用到原始提示词
    const applyLastOriginChatToSource = (entryId: string) => {
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => {
                if (e.id !== entryId) return e;
                const lastModelMsg = [...(e.originChatHistory || [])].reverse().find(m => m.role === 'model');
                if (!lastModelMsg) return e;
                return {
                    ...e,
                    source: lastModelMsg.text
                };
            })
        }));
    };

    const sendOutputChatMessage = async (entryId: string, outputId: string) => {
        const entry = state.entries.find(e => e.id === entryId);
        const output = entry?.outputs.find(o => o.id === outputId);
        if (!entry || !output || (!output.chatInput.trim() && (!output.chatAttachments || output.chatAttachments.length === 0))) return;

        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            text: output.chatInput.trim(),
            images: output.chatAttachments || [],
            timestamp: Date.now()
        };

        // Add user message, clear input and attachments, set loading
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => e.id === entryId ? {
                ...e,
                outputs: e.outputs.map(o => o.id === outputId ? {
                    ...o,
                    chatHistory: [...o.chatHistory, userMsg],
                    chatInput: '',
                    chatAttachments: [],
                    isChatLoading: true
                } : o)
            } : e)
        }));

        try {
            const ai = getAiInstance();
            const parts: any[] = [];

            // Add images if any
            if (userMsg.images && userMsg.images.length > 0) {
                userMsg.images.forEach(imgBase64 => {
                    // Extract mime type from data URL instead of assuming image/png
                    const mimeMatch = imgBase64.match(/^data:(image\/[a-zA-Z0-9+.-]+);base64,/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

                    // Safely extract base64 data
                    const base64Parts = imgBase64.split(',');
                    const base64Data = base64Parts.length > 1 ? base64Parts[1] : imgBase64;

                    if (base64Data) {
                        parts.push({
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Data
                            }
                        });
                    }
                });
            }

            const promptText = `You are a creative assistant helping to refine an AI image prompt.

Original Concept: "${entry.source}"
Current Draft (English): "${output.en}"
${output.zh ? `Current Draft (Chinese): "${output.zh}"` : ''}

User Request: "${userMsg.text}"

Please rewrite the "Current Draft" to incorporate the "User Request" and any attached reference images, while maintaining the high quality and detail suitable for AI image generation.
${state.enableTranslation ? 'Provide the output in English and Chinese formats like before (English: ... Chinese: ...).' : 'Provide the output in English only.'}`;

            parts.push({ text: promptText });

            const result = await ai.models.generateContent({
                model: currentModel,
                contents: { parts }
            });

            const responseText = result.text || 'No response';

            const modelMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: responseText,
                timestamp: Date.now()
            };

            setState(prev => ({
                ...prev,
                entries: prev.entries.map(e => e.id === entryId ? {
                    ...e,
                    outputs: e.outputs.map(o => o.id === outputId ? {
                        ...o,
                        chatHistory: [...o.chatHistory, modelMsg],
                        isChatLoading: false
                    } : o)
                } : e)
            }));

        } catch (error: any) {
            console.error(error);
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: `Error: ${error.message || 'Request failed'}`,
                timestamp: Date.now()
            };
            setState(prev => ({
                ...prev,
                entries: prev.entries.map(e => e.id === entryId ? {
                    ...e,
                    outputs: e.outputs.map(o => o.id === outputId ? {
                        ...o,
                        chatHistory: [...o.chatHistory, errorMsg],
                        isChatLoading: false
                    } : o)
                } : e)
            }));
        }
    };

    // --- Copy & Export Handlers ---

    const formatChatHistoryText = (output: OutputItem): string => {
        if (output.chatHistory.length === 0) return '';

        let text = `--- 对话记录 ---\n`;
        text += `原文 (EN): ${output.en}\n`;
        if (output.zh) text += `译文 (ZH): ${output.zh}\n`;
        text += `\n`;

        output.chatHistory.forEach((msg, i) => {
            const role = msg.role === 'user' ? '用户' : 'AI';
            const hasImages = msg.images && msg.images.length > 0;
            text += `[${role}]${hasImages ? ' [含图片]' : ''}: ${msg.text}\n`;
        });

        return text;
    };

    const handleCopyChatHistory = (entryId: string, outputId: string) => {
        const entry = state.entries.find(e => e.id === entryId);
        const output = entry?.outputs.find(o => o.id === outputId);
        if (!output || output.chatHistory.length === 0) return;

        const text = formatChatHistoryText(output);
        navigator.clipboard.writeText(text);
        handleCopy(text, `chat-${outputId}`);
    };

    const handleCopyOriginChatHistory = (entryId: string) => {
        const entry = state.entries.find(e => e.id === entryId);
        if (!entry || !entry.originChatHistory || entry.originChatHistory.length === 0) return;
        const outputLike: OutputItem = {
            id: entry.id,
            en: entry.outputs[0]?.en || entry.source,
            zh: entry.outputs[0]?.zh || '',
            chatHistory: entry.originChatHistory,
            isChatOpen: false,
            chatInput: '',
            chatAttachments: [],
            isChatLoading: false
        };
        const text = formatChatHistoryText(outputLike);
        navigator.clipboard.writeText(text);
        handleCopy(text, `chat-origin-${entry.id}`);
    };

    const handleExportAll = () => {
        let exportText = `# 提示词工具 - 导出记录\n`;
        exportText += `导出时间: ${new Date().toLocaleString()}\n`;
        exportText += `总任务数: ${state.entries.length}\n`;
        exportText += `\n${'='.repeat(50)}\n\n`;

        state.entries.forEach((entry, entryIdx) => {
            exportText += `## 任务 ${entryIdx + 1}\n`;
            exportText += `原始提示词: ${entry.source}\n`;
            exportText += `状态: ${entry.status}\n`;
            exportText += `创新结果数: ${entry.outputs.length}\n\n`;

            entry.outputs.forEach((output, outIdx) => {
                exportText += `  ### 创新结果 ${outIdx + 1}\n`;
                exportText += `  英文: ${output.en}\n`;
                if (output.zh) exportText += `  中文: ${output.zh}\n`;

                if (output.chatHistory.length > 0) {
                    exportText += `\n  对话记录 (${output.chatHistory.length} 条):\n`;
                    output.chatHistory.forEach(msg => {
                        const role = msg.role === 'user' ? '用户' : 'AI';
                        const hasImages = msg.images && msg.images.length > 0;
                        exportText += `    [${role}]${hasImages ? ' [含图片]' : ''}: ${msg.text}\n`;
                    });
                }
                exportText += `\n`;
            });

            exportText += `${'-'.repeat(50)}\n\n`;
        });

        // Create and download file
        const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `提示词工具_导出_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // 保存到表格状态
    const [sheetSaveStatus, setSheetSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
    const [sheetSaveError, setSheetSaveError] = useState<string>('');

    const handleSaveToSheet = async () => {
        const successEntries = state.entries.filter(e => e.status === 'success' && e.outputs.length > 0);
        if (successEntries.length === 0) {
            alert('没有可保存的创新结果');
            return;
        }

        const config = getSheetsSyncConfig();
        if (!config.webAppUrl || !config.submitter) {
            alert('请先在设置中配置表格同步');
            return;
        }

        setSheetSaveStatus('saving');
        setSheetSaveError('');

        try {
            const time = new Date().toLocaleString('zh-CN');
            const rows: string[][] = [];

            successEntries.forEach(entry => {
                entry.outputs.forEach(output => {
                    rows.push([
                        time,
                        state.activeTab === 'copywriting' ? '文案模式' : '创新模式',
                        entry.source,
                        output.en || output.zh || ''
                    ]);
                });
            });

            const result = await appendToSheet('prompt-tool', rows);

            if (result.success) {
                setSheetSaveStatus('success');
                setTimeout(() => setSheetSaveStatus('idle'), 3000);
            } else {
                setSheetSaveStatus('error');
                setSheetSaveError(result.error || '保存失败');
            }
        } catch (e) {
            setSheetSaveStatus('error');
            setSheetSaveError(e instanceof Error ? e.message : '保存失败');
        }
    };

    // --- Main Handlers ---

    const handleAddEntries = (mode: 'batch' | 'single' = 'batch') => {
        const raw = state.bulkInput.trim();
        if (!raw) return;

        let lines: string[] = [];

        if (mode === 'single') {
            lines = [raw];
        } else {
            const input = state.bulkInput;
            let current = '';
            let inQuote = false;

            for (let i = 0; i < input.length; i++) {
                const char = input[i];
                const nextChar = input[i + 1];

                if (char === '"') {
                    if (inQuote && nextChar === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuote = !inQuote;
                    }
                } else if (!inQuote && (char === '\t' || char === '\n' || char === '\r')) {
                    if (current.trim()) {
                        lines.push(current.trim());
                    }
                    current = '';
                } else {
                    current += char;
                }
            }
            if (current.trim()) {
                lines.push(current.trim());
            }
        }

        if (lines.length === 0) return;

        const newEntries: DescEntry[] = lines.map(line => ({
            id: `entry-${Date.now()}-${Math.random().toString(36).slice(2)}`,
            source: line,
            outputs: [],
            status: 'idle',
            roundsCompleted: 0,
            customTemplateId: undefined,
            originChatHistory: [],
            originChatOpen: false,
            originChatInput: '',
            originChatAttachments: [],
            originChatLoading: false
        }));

        setState(prev => ({
            ...prev,
            entries: [...prev.entries, ...newEntries],
            bulkInput: ''
        }));
        setExpandedEntryIds(prev => [...prev, ...newEntries.map(e => e.id)]);
    };

    const handleClearEntries = () => {
        setState(prev => ({ ...prev, entries: [], viewOverrides: {} }));
    };

    const handleRemoveEntry = (id: string) => {
        setState(prev => ({ ...prev, entries: prev.entries.filter(e => e.id !== id) }));
    };

    const handleCopy = (text: string, id: string) => {
        if (!text) return;
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const toggleExpand = (id: string) => {
        setExpandedEntryIds(prev =>
            prev.includes(id) ? prev.filter(e => e !== id) : [...prev, id]
        );
    };

    const toggleEntrySettings = (id: string) => {
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => e.id === id ? { ...e, showSettings: !e.showSettings } : e)
        }));
    };

    const updateEntrySettings = (id: string, updates: Partial<DescEntry>) => {
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => e.id === id ? { ...e, ...updates } : e)
        }));
    };

    const handlePreview = () => {
        const sampleBase = state.entries[0]?.source || "[示例：一只可爱的猫咪...]";
        const prompt = buildFinalPrompt(sampleBase, state.entries[0]);
        setPreviewContent(prompt);
        setShowPreviewModal(true);
    };

    // --- Regeneration Handlers ---

    const handleRegenerateAll = () => {
        if (state.isProcessing) return;
        if (state.entries.length === 0) return;

        // Reset status for ALL entries
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => ({
                ...e,
                status: 'idle',
                outputs: [],
                roundsCompleted: 0,
                error: null
            })),
            pendingAutoGenerate: true // Set flag to trigger useEffect
        }));
        setSingleRunId(null);
    };

    const handleRegenerateEntry = (id: string) => {
        if (state.isProcessing) return;

        // Reset status for SINGLE entry
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => e.id === id ? {
                ...e,
                status: 'idle',
                outputs: [],
                roundsCompleted: 0,
                error: null
            } : e),
            pendingAutoGenerate: true // Set flag to trigger useEffect
        }));
        setSingleRunId(id);
    };

    // Retry only failed entries
    const handleRetryAllFailed = () => {
        if (state.isProcessing) return;
        const failedEntries = state.entries.filter(e => e.status === 'error');
        if (failedEntries.length === 0) return;

        // Reset status for FAILED entries only, keep their existing outputs if any
        setState(prev => ({
            ...prev,
            entries: prev.entries.map(e => e.status === 'error' ? {
                ...e,
                status: 'idle',
                error: null
            } : e),
            pendingAutoGenerate: true
        }));
        setSingleRunId(null);
    };

    // --- Processing Logic ---

    const processQueue = async () => {
        // Use stateRef to get the latest state (fixes closure issue)
        const currentState = stateRef.current;

        // Determine targets based on current state
        let targets = currentState.entries.filter(e =>
            (e.status === 'idle' || e.status === 'error') ||
            (e.status === 'success' && e.roundsCompleted < (e.customRounds || currentState.rounds))
        );

        if (singleRunIdRef.current) {
            targets = targets.filter(e => e.id === singleRunIdRef.current);
        }

        if (targets.length === 0) {
            return;
        }

        setState(prev => ({ ...prev, isProcessing: true, isPaused: false }));
        stopRef.current = false;
        pauseRef.current = false;

        const ai = getAiInstance();

        for (const item of targets) {
            if (stopRef.current) break;
            while (pauseRef.current && !stopRef.current) {
                await new Promise(r => setTimeout(r, 500));
            }
            if (stopRef.current) break;

            setState(prev => ({
                ...prev,
                entries: prev.entries.map(e => e.id === item.id ? { ...e, status: 'processing', error: null } : e)
            }));

            // Determine target rounds for this item
            const targetRounds = (item.customRounds !== undefined && item.customRounds > 0) ? item.customRounds : currentState.rounds;
            const roundsNeeded = targetRounds - item.roundsCompleted;

            try {
                // Track outputs added during this processing run (local counter to avoid async state issues)
                let totalOutputsAdded = 0;

                for (let r = 0; r < roundsNeeded; r++) {
                    if (stopRef.current) throw new Error('Stopped by user');
                    while (pauseRef.current && !stopRef.current) {
                        await new Promise(res => setTimeout(res, 500));
                    }

                    const prompt = buildFinalPrompt(item.source, item);

                    // 使用 retryOnEmpty 包装 AI 调用，空结果时自动重试
                    const result = await retryOnEmpty(
                        () => ai.models.generateContent({
                            model: currentModel,
                            contents: { parts: [{ text: prompt }] }
                        }),
                        (res) => !res.text?.trim(),
                        3,  // 最多重试 3 次
                        1500  // 初始延迟 1.5 秒
                    );

                    const text = result.text || '';
                    const rawOutputs = text.split(DEFAULT_SPLIT_CHAR).map(s => s.trim()).filter(Boolean);

                    // Parse English and Chinese
                    const parsedOutputs: OutputItem[] = rawOutputs.map(raw => {
                        // Try matching explicit "English: ... Chinese: ..." format first
                        const enMatch = raw.match(/English:\s*([\s\S]*?)(?=\nChinese:|$)/i);
                        const zhMatch = raw.match(/Chinese:\s*([\s\S]*?)$/i);

                        let en = raw;
                        let zh = '';

                        if (enMatch && zhMatch) {
                            en = enMatch[1].trim();
                            zh = zhMatch[1].trim();
                        } else {
                            // Fallback to previous paren-style regex
                            const match = raw.match(/^([\s\S]*?)\s*[（\(](?:中文[:：]\s*)?([\s\S]*?)[）\)]$/);
                            if (match) {
                                en = match[1].trim();
                                zh = match[2].trim();
                            }
                        }

                        return {
                            id: uuidv4(),
                            en,
                            zh,
                            chatHistory: [],
                            isChatOpen: false,
                            chatInput: '',
                            chatAttachments: [],
                            isChatLoading: false
                        };
                    });

                    // Track if we added any outputs during this round
                    if (parsedOutputs.length > 0) {
                        totalOutputsAdded += parsedOutputs.length;
                        setState(prev => ({
                            ...prev,
                            entries: prev.entries.map(e => {
                                if (e.id === item.id) {
                                    return {
                                        ...e,
                                        outputs: [...e.outputs, ...parsedOutputs],
                                        roundsCompleted: e.roundsCompleted + 1
                                    };
                                }
                                return e;
                            })
                        }));
                    } else {
                        // Empty result from AI for this round
                        console.warn('[Innovation] AI returned empty result for', item.id, 'in round', r + 1);
                    }
                }

                // Check if we added any outputs during processing (using local counter, not async state)
                if (totalOutputsAdded === 0 && item.outputs.length === 0) {
                    // No outputs after processing - mark as error
                    setState(prev => ({
                        ...prev,
                        entries: prev.entries.map(e => e.id === item.id ? {
                            ...e,
                            status: 'error',
                            error: 'AI 返回空结果，请重试'
                        } : e)
                    }));
                } else {
                    setState(prev => ({
                        ...prev,
                        entries: prev.entries.map(e => e.id === item.id ? { ...e, status: 'success' } : e)
                    }));
                }

                // 项目状态会自动保存
                if (user?.uid) {
                }

            } catch (err: any) {
                if (err.message === 'Stopped by user') break;
                console.error(err);
                setState(prev => ({
                    ...prev,
                    entries: prev.entries.map(e => e.id === item.id ? { ...e, status: 'error', error: err.message || '生成失败' } : e)
                }));
            }
        }

        setState(prev => ({ ...prev, isProcessing: false, isPaused: false }));
        setSingleRunId(null);
        // 单条已保存，批量完成时不再重复保存
    };

    // Watch for auto-generate signal
    useEffect(() => {
        if (state.pendingAutoGenerate) {
            setState(prev => ({ ...prev, pendingAutoGenerate: false }));
            setTimeout(() => processQueue(), 0);
        }
    }, [state.pendingAutoGenerate]);

    const handleStop = () => {
        stopRef.current = true;
        setState(prev => ({ ...prev, isProcessing: false, isPaused: false }));
    };

    const handlePause = () => {
        if (state.isPaused) {
            pauseRef.current = false;
            setState(prev => ({ ...prev, isPaused: false }));
        } else {
            pauseRef.current = true;
            setState(prev => ({ ...prev, isPaused: true }));
        }
    };

    const hasOutputs = state.entries.some(e => e.outputs.length > 0);

    // 使用函数来获取 activeTab，避免 TypeScript 类型缩窄导致的虚假比较警告
    // 函数调用的返回值不会被 TypeScript 缩窄
    const getActiveTab = () => state.activeTab;

    // If Direct Chat Tab is Active, render new component
    if (getActiveTab() === 'chat') {
        return (
            <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 font-sans">
                {/* --- Top Bar --- */}
                <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
                    <div className="max-w-none mx-auto px-4 py-2 space-y-3">
                        {/* 第一行：标题 + 模式切换 */}
                        <div className="flex items-center gap-3 w-full">
                            <div className="flex items-center gap-2 shrink-0">
                                <div className="bg-purple-500/20 p-1.5 rounded-lg">
                                    <Zap className="text-purple-400 w-4 h-4" fill="currentColor" />
                                </div>
                                <h1 className="text-base font-bold tracking-tight text-white hidden xl:block">提示词工具</h1>
                            </div>

                            <div className="flex-1"></div>

                            <div className="flex items-center gap-2">
                                <div className="flex bg-zinc-900 border border-zinc-700 rounded-lg p-0.5">
                                    <button
                                        onClick={() => setState(prev => ({ ...prev, activeTab: 'innovator' }))}
                                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${state.activeTab === 'innovator' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'} tooltip-bottom`}
                                        data-tip="切换到创新模式 - 批量创新提示词"
                                    >
                                        创新模式
                                    </button>
                                    <button
                                        onClick={() => setState(prev => ({ ...prev, activeTab: 'chat' }))}
                                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${getActiveTab() === 'chat' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'} tooltip-bottom`}
                                        data-tip="切换到普通模式 - 直接对话"
                                    >
                                        普通模式
                                    </button>
                                    <button
                                        onClick={() => setState(prev => ({ ...prev, activeTab: 'copywriting' }))}
                                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${getActiveTab() === 'copywriting' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-zinc-200'} tooltip-bottom`}
                                        data-tip="切换到文案改写模式 - 批量改写文案"
                                    >
                                        文案改写
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <DirectChatView getAiInstance={getAiInstance} textModel={currentModel} />
            </div>
        );
    }

    // If Copywriting Tab is Active, render copywriting component
    if (getActiveTab() === 'copywriting') {
        return (
            <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 font-sans">
                {/* --- Top Bar --- */}
                <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
                    <div className="max-w-none mx-auto px-4 py-2 space-y-3">
                        {/* 第一行：标题 + 模式切换 */}
                        <div className="flex items-center gap-3 w-full">
                            <div className="flex items-center gap-2 shrink-0">
                                <div className="bg-amber-500/20 p-1.5 rounded-lg">
                                    <Zap className="text-amber-400 w-4 h-4" fill="currentColor" />
                                </div>
                                <h1 className="text-base font-bold tracking-tight text-white hidden xl:block">提示词工具</h1>
                            </div>

                            <div className="flex-1"></div>

                            <div className="flex items-center gap-2">
                                <div className="flex bg-zinc-900 border border-zinc-700 rounded-lg p-0.5">
                                    <button
                                        onClick={() => setState(prev => ({ ...prev, activeTab: 'innovator' }))}
                                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${getActiveTab() === 'innovator' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'} tooltip-bottom`}
                                        data-tip="切换到创新模式 - 批量创新提示词"
                                    >
                                        创新模式
                                    </button>
                                    <button
                                        onClick={() => setState(prev => ({ ...prev, activeTab: 'chat' }))}
                                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${getActiveTab() === 'chat' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'} tooltip-bottom`}
                                        data-tip="切换到普通模式 - 直接对话"
                                    >
                                        普通模式
                                    </button>
                                    <button
                                        onClick={() => setState(prev => ({ ...prev, activeTab: 'copywriting' }))}
                                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${getActiveTab() === 'copywriting' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-zinc-200'} tooltip-bottom`}
                                        data-tip="切换到文案改写模式 - 批量改写文案"
                                    >
                                        文案改写
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                <CopywritingView getAiInstance={getAiInstance} textModel={currentModel} />
            </div>
        );
    }

    return (
        <>
            <div className="h-full flex flex-col font-sans bg-zinc-950 text-zinc-100">

                {/* --- Top Bar --- */}
                <div className="sticky top-0 z-20 bg-zinc-950/95 backdrop-blur-sm border-b border-zinc-800">
                    <div className="max-w-none mx-auto px-4 py-2 space-y-3">
                        {/* 第一行：标题 + 模式切换 */}
                        <div className="flex items-center gap-3 w-full">
                            <div className="flex items-center gap-2 shrink-0">
                                <div className="bg-purple-500/20 p-1.5 rounded-lg">
                                    <Zap className="text-purple-400 w-4 h-4" fill="currentColor" />
                                </div>
                                <h1 className="text-base font-bold tracking-tight text-white hidden xl:block">提示词工具</h1>
                            </div>

                            <div className="flex-1"></div>

                            <div className="flex items-center gap-2">
                                <div className="flex bg-zinc-900 border border-zinc-700 rounded-lg p-0.5">
                                    <button
                                        onClick={() => setState(prev => ({ ...prev, activeTab: 'innovator' }))}
                                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${getActiveTab() === 'innovator' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'} tooltip-bottom`}
                                        data-tip="切换到创新模式 - 批量创新提示词"
                                    >
                                        创新模式
                                    </button>
                                    <button
                                        onClick={() => setState(prev => ({ ...prev, activeTab: 'chat' }))}
                                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${getActiveTab() === 'chat' ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200'} tooltip-bottom`}
                                        data-tip="切换到普通模式 - 直接对话"
                                    >
                                        普通模式
                                    </button>
                                    <button
                                        onClick={() => setState(prev => ({ ...prev, activeTab: 'copywriting' }))}
                                        className={`px-2.5 py-1 rounded text-xs font-medium transition-all ${getActiveTab() === 'copywriting' ? 'bg-amber-600 text-white' : 'text-zinc-400 hover:text-zinc-200'} tooltip-bottom`}
                                        data-tip="切换到文案改写模式 - 批量改写文案"
                                    >
                                        文案改写
                                    </button>
                                </div>
                                {/* 项目管理按钮和当前项目名称 */}
                                <div className="flex items-center gap-2">
                                    {currentProject && !currentProject.id.startsWith('temp_') && (
                                        <span className="text-xs text-zinc-500 max-w-[120px] truncate" title={currentProject.name}>
                                            📁 {currentProject.name}
                                        </span>
                                    )}
                                    <button
                                        onClick={() => setShowProjectPanel(true)}
                                        className="flex items-center justify-center w-7 h-7 rounded-md text-zinc-500 hover:text-amber-400 hover:bg-zinc-800 transition-colors tooltip-bottom"
                                        data-tip="项目管理"
                                    >
                                        📁
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* --- Main Content --- */}
                <div className="flex-1 overflow-y-auto overflow-x-hidden">
                    <div className="max-w-none mx-auto p-4 flex flex-col gap-6 h-full">

                        {/* Top: Compact Configuration Panel */}
                        <div className="w-full">
                            <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 shadow-sm">
                                <div className="flex flex-col lg:flex-row gap-4">
                                    {/* Main Inputs Area (Flex Grow) */}
                                    <div className="flex-1 grid grid-cols-1 md:grid-cols-12 gap-3">
                                        {/* Template Select (Span 2) */}
                                        <div className="md:col-span-2 flex flex-col gap-1">
                                            <label className="text-xs font-medium text-zinc-500 flex items-center gap-1"><FileText size={12} /> 预设指令</label>
                                            <select
                                                className="h-20 w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 cursor-pointer"
                                                value={state.selectedTemplateId}
                                                onChange={(e) => setState(prev => ({ ...prev, selectedTemplateId: e.target.value }))}
                                            >
                                                <option value="custom">自定义</option>
                                                <option value="__system_default__">系统默认</option>
                                                {/* 指令模版 */}
                                                {templateState.savedTemplates.length > 0 && (
                                                    <optgroup label="创新指令">
                                                        {templateState.savedTemplates.map((t: any) => (
                                                            <option key={t.id} value={t.id}>{t.name}</option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                                {/* AI图片识别预设 */}
                                                {unifiedPresets.filter(p => p.source === 'recognition').length > 0 && (
                                                    <optgroup label="识别指令">
                                                        {unifiedPresets.filter(p => p.source === 'recognition').map((p: SimplePreset) => (
                                                            <option key={p.id} value={`rec:${p.id}`}>{p.name}</option>
                                                        ))}
                                                    </optgroup>
                                                )}
                                            </select>
                                        </div>

                                        {/* Requirement (Span 4) */}
                                        <div className="md:col-span-4 flex flex-col gap-1">
                                            <label className="text-xs font-medium text-zinc-500 flex items-center gap-1"><Settings2 size={12} /> 创新要求</label>
                                            <textarea
                                                className="h-20 w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 resize-none custom-scrollbar placeholder-zinc-700 leading-snug"
                                                placeholder="例如：赛博朋克风格，强调光影..."
                                                value={state.requirement}
                                                onChange={(e) => setState(prev => ({ ...prev, requirement: e.target.value }))}
                                            />
                                        </div>

                                        {/* Preview Button (Span 1) */}
                                        <div className="md:col-span-1 flex flex-col gap-1">
                                            <label className="text-xs font-medium text-zinc-500 invisible">预览</label>
                                            <button
                                                onClick={handlePreview}
                                                className="h-20 w-full flex flex-col items-center justify-center gap-1 text-xs font-medium text-zinc-400 hover:text-purple-400 bg-zinc-950 border border-zinc-700 hover:border-purple-500/50 rounded-lg transition-colors tooltip-bottom"
                                                data-tip="预览完整AI指令"
                                            >
                                                <Eye size={18} />
                                                <span>预览</span>
                                            </button>
                                        </div>

                                        {/* Parameters (Span 2) */}
                                        <div className="md:col-span-2 flex flex-col gap-2">
                                            <div className="grid grid-cols-2 gap-2">
                                                <div className="flex flex-col gap-1">
                                                    <label className="text-[0.625rem] text-zinc-500">每轮个数</label>
                                                    <input
                                                        type="number"
                                                        min={1} max={10}
                                                        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:border-purple-500"
                                                        value={state.countPerRound}
                                                        onChange={(e) => setState(prev => ({ ...prev, countPerRound: Math.max(1, parseInt(e.target.value) || 1) }))}
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <label className="text-[0.625rem] text-zinc-500">创新轮数</label>
                                                    <input
                                                        type="number"
                                                        min={1} max={5}
                                                        className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:border-purple-500"
                                                        value={state.rounds}
                                                        onChange={(e) => setState(prev => ({ ...prev, rounds: Math.max(1, parseInt(e.target.value) || 1) }))}
                                                    />
                                                </div>
                                            </div>
                                            <button
                                                onClick={() => setState(prev => ({ ...prev, enableTranslation: !prev.enableTranslation }))}
                                                className={`w-full flex items-center justify-between p-1.5 rounded-lg border transition-colors ${state.enableTranslation ? 'bg-purple-900/20 border-purple-500/30' : 'bg-zinc-950 border-zinc-700'}`}
                                            >
                                                <div className="flex items-center gap-1.5 text-xs text-zinc-400">
                                                    <Languages size={12} />
                                                    <span>中文翻译</span>
                                                </div>
                                                <div className={`relative inline-flex h-4 w-7 items-center rounded-full transition-colors ${state.enableTranslation ? 'bg-purple-600' : 'bg-zinc-700'}`}>
                                                    <span className={`inline-block h-2.5 w-2.5 transform rounded-full bg-white transition-transform ${state.enableTranslation ? 'translate-x-3.5' : 'translate-x-0.5'}`} />
                                                </div>
                                            </button>
                                        </div>

                                        {/* Bulk Input (Span 3) */}
                                        <div className="md:col-span-3 flex flex-col gap-1 relative">
                                            <div className="flex justify-between items-center">
                                                <label className="text-xs font-medium text-zinc-500 flex items-center gap-1"><Files size={12} /> 批量添加</label>
                                                {state.bulkInput && (
                                                    <button onClick={() => setState(prev => ({ ...prev, bulkInput: '' }))} data-tip="清空输入框" className="text-[0.625rem] text-zinc-500 hover:text-zinc-300 tooltip-bottom" >清空</button>
                                                )}
                                            </div>
                                            <textarea
                                                className="h-20 w-full bg-zinc-950 border border-zinc-700 rounded-lg p-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 resize-none custom-scrollbar placeholder-zinc-700 leading-snug pb-9"
                                                placeholder="输入提示词，按回车..."
                                                value={state.bulkInput}
                                                onChange={(e) => setState(prev => ({ ...prev, bulkInput: e.target.value }))}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAddEntries('batch');
                                                }}
                                            />
                                            <div className="absolute bottom-2 right-2 flex gap-2">
                                                <button
                                                    onClick={() => handleAddEntries('single')}
                                                    disabled={!state.bulkInput.trim()}
                                                    className="px-3 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-600 rounded text-xs font-medium transition-colors disabled:opacity-50 flex items-center tooltip-bottom"
                                                    data-tip="将内容作为单条记录添加"
                                                >
                                                    <Plus size={14} className="mr-1" /> 单条
                                                </button>
                                                <button
                                                    onClick={() => handleAddEntries('batch')}
                                                    disabled={!state.bulkInput.trim()}
                                                    className="px-3 py-1 bg-purple-600 hover:bg-purple-500 text-white border border-purple-500 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:bg-zinc-800 disabled:border-zinc-700 flex items-center tooltip-bottom"
                                                    data-tip="按换行分割添加多条记录"
                                                >
                                                    <List size={14} className="mr-1" /> 批量
                                                </button>
                                            </div>
                                        </div>
                                    </div>

                                    {/* Actions Area (Fixed Width on Desktop) */}
                                    <div className="lg:w-48 flex flex-col gap-2 justify-end border-t lg:border-t-0 lg:border-l border-zinc-800 pt-3 lg:pt-0 lg:pl-4 shrink-0">
                                        {!state.isProcessing ? (
                                            <button
                                                onClick={processQueue}
                                                disabled={state.entries.length === 0}
                                                className="h-10 bg-purple-600 hover:bg-purple-500 text-white rounded-lg font-bold text-sm shadow-lg shadow-purple-900/20 transition-all flex items-center justify-center gap-2 disabled:opacity-50 disabled:bg-zinc-800 disabled:shadow-none tooltip-bottom"
                                                data-tip="开始对队列中的提示词进行 AI 创新"
                                            >
                                                <Zap size={16} fill="currentColor" /> 开始创新
                                            </button>
                                        ) : (
                                            <div className="grid grid-cols-2 gap-2 h-10">
                                                <button
                                                    onClick={handlePause}
                                                    className={`rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1 ${state.isPaused ? 'bg-emerald-600 hover:bg-emerald-500' : 'bg-amber-600 hover:bg-amber-500'} text-white`}
                                                    title={state.isPaused ? '继续处理队列' : '暂停处理队列'}
                                                >
                                                    {state.isPaused ? <Play size={14} fill="currentColor" /> : <Pause size={14} fill="currentColor" />}
                                                    {state.isPaused ? '继续' : '暂停'}
                                                </button>
                                                <button
                                                    onClick={handleStop}
                                                    className="bg-zinc-800 hover:bg-red-900/50 hover:text-red-200 text-zinc-400 rounded-lg font-bold text-xs transition-all flex items-center justify-center gap-1 tooltip-bottom"
                                                    data-tip="停止处理并清除队列"
                                                >
                                                    <Square size={14} fill="currentColor" /> 停止
                                                </button>
                                            </div>
                                        )}

                                        <div className="grid grid-cols-3 gap-2">
                                            <button
                                                onClick={handleRegenerateAll}
                                                disabled={state.isProcessing || state.entries.length === 0}
                                                className="py-1.5 bg-blue-600/10 hover:bg-blue-600/20 text-blue-400 hover:text-blue-300 border border-blue-500/20 rounded-lg text-[0.625rem] transition-colors flex items-center justify-center gap-1 disabled:opacity-30 tooltip-bottom"
                                                data-tip="重置所有任务并重新生成"
                                            >
                                                <RotateCw size={12} /> 全部重做
                                            </button>
                                            <button
                                                onClick={handleRetryAllFailed}
                                                disabled={state.isProcessing || state.entries.filter(e => e.status === 'error').length === 0}
                                                className="py-1.5 bg-amber-600/10 hover:bg-amber-600/20 text-amber-400 hover:text-amber-300 border border-amber-500/20 rounded-lg text-[0.625rem] transition-colors flex items-center justify-center gap-1 disabled:opacity-30 tooltip-bottom"
                                                data-tip="重试所有失败的任务"
                                            >
                                                <RotateCw size={12} /> 重试失败 ({state.entries.filter(e => e.status === 'error').length})
                                            </button>
                                            <button
                                                onClick={handleClearEntries}
                                                disabled={state.entries.length === 0}
                                                className="py-1.5 bg-transparent border border-red-900/30 hover:bg-red-900/10 text-red-400/80 hover:text-red-400 rounded-lg text-[0.625rem] transition-colors flex items-center justify-center gap-1 disabled:opacity-30 tooltip-bottom"
                                                data-tip="清空所有任务和结果"
                                            >
                                                <Trash2 size={12} /> 清空列表
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* Bottom: Results List */}
                        <div className="w-full flex-1 flex flex-col min-h-0 relative">
                            <div className="sticky top-0 z-10 bg-zinc-950 pb-2 pt-1 border-b border-zinc-800/50 mb-4">
                                <div className="flex flex-col gap-2 px-1">
                                    <div className="flex items-center justify-between">
                                        <h2 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                                            <List size={16} /> 任务列表
                                        </h2>
                                        <div className="flex gap-2 items-center flex-wrap">
                                            {/* Global View Toggle */}
                                            <div className="flex bg-zinc-900 border border-zinc-700 rounded-lg p-0.5">
                                                <button
                                                    onClick={() => setState(prev => ({ ...prev, viewLanguage: 'en' }))}
                                                    className={`px-2 py-1 rounded text-xs font-medium transition-all ${state.viewLanguage === 'en' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'} tooltip-bottom`}
                                                    data-tip="显示英文结果"
                                                >
                                                    English
                                                </button>
                                                <button
                                                    onClick={() => setState(prev => ({ ...prev, viewLanguage: 'zh' }))}
                                                    className={`px-2 py-1 rounded text-xs font-medium transition-all ${state.viewLanguage === 'zh' ? 'bg-zinc-700 text-white' : 'text-zinc-500 hover:text-zinc-300'} tooltip-bottom`}
                                                    data-tip="显示中文结果"
                                                >
                                                    中文
                                                </button>
                                            </div>

                                            {/* Global Copy Buttons - Always visible */}
                                            <button
                                                disabled={!hasOutputs}
                                                onClick={() => {
                                                    const allOutputs = state.entries.flatMap(e => e.outputs.map(o => o.en)).join('\n\n');
                                                    handleCopy(allOutputs, 'all-en');
                                                }}
                                                className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-colors flex items-center gap-1.5 border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed tooltip-bottom"
                                                data-tip="复制所有英文创新结果"
                                            >
                                                {copiedId === 'all-en' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                                {copiedId === 'all-en' ? <span className="text-emerald-400">已复制英文</span> : 'All EN'}
                                            </button>
                                            <button
                                                disabled={!hasOutputs}
                                                onClick={() => {
                                                    const allOutputs = state.entries.flatMap(e => e.outputs.map(o => o.zh || o.en)).join('\n\n');
                                                    handleCopy(allOutputs, 'all-zh');
                                                }}
                                                className="text-xs px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-md transition-colors flex items-center gap-1.5 border border-zinc-700 disabled:opacity-50 disabled:cursor-not-allowed tooltip-bottom"
                                                data-tip="复制所有中文创新结果"
                                            >
                                                {copiedId === 'all-zh' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                                {copiedId === 'all-zh' ? <span className="text-emerald-400">已复制中文</span> : 'All ZH'}
                                            </button>

                                            {/* Export All Button */}
                                            <button
                                                disabled={!hasOutputs}
                                                onClick={handleExportAll}
                                                className="text-xs px-3 py-1.5 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 hover:text-purple-300 rounded-md transition-colors flex items-center gap-1.5 border border-purple-500/30 disabled:opacity-50 disabled:cursor-not-allowed tooltip-bottom"
                                                data-tip="导出所有创新结果和对话记录"
                                            >
                                                <Download size={12} />
                                                导出全部
                                            </button>

                                            {/* 保存到表格按钮 */}
                                            <button
                                                disabled={!hasOutputs || sheetSaveStatus === 'saving'}
                                                onClick={handleSaveToSheet}
                                                className={`text-xs px-3 py-1.5 rounded-md transition-colors flex items-center gap-1.5 border disabled:opacity-50 disabled:cursor-not-allowed tooltip-bottom ${sheetSaveStatus === 'success' ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50' :
                                                        sheetSaveStatus === 'error' ? 'bg-red-600/20 text-red-400 border-red-500/30' :
                                                            'bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 hover:text-blue-300 border-blue-500/30'
                                                    }`}
                                                data-tip={sheetSaveStatus === 'success' ? '保存成功' : sheetSaveStatus === 'error' ? sheetSaveError : '保存到 Google Sheets'}
                                            >
                                                {sheetSaveStatus === 'saving' ? <Loader2 size={12} className="animate-spin" /> :
                                                    sheetSaveStatus === 'success' ? <Check size={12} /> :
                                                        <FileText size={12} />}
                                                {sheetSaveStatus === 'saving' ? '保存中...' :
                                                    sheetSaveStatus === 'success' ? '已保存' :
                                                        '保存表格'}
                                            </button>
                                        </div>
                                    </div>

                                    {/* Stats Bar */}
                                    {state.entries.length > 0 && (
                                        <div className="grid grid-cols-4 gap-2">
                                            <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-zinc-700/50 bg-zinc-800/40 text-zinc-400 hover:bg-zinc-800/60 transition-colors cursor-default">
                                                <span className="text-[0.6875rem] font-medium">队列</span>
                                                <span className="text-xs font-bold text-zinc-200 font-mono">{state.entries.length}</span>
                                            </div>
                                            <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-amber-500/20 bg-amber-500/10 text-amber-300 hover:bg-amber-500/20 transition-colors cursor-default">
                                                <span className="text-[0.6875rem] font-medium">待处理</span>
                                                <span className="text-xs font-bold text-amber-300 font-mono">
                                                    {state.entries.filter(e => e.status === 'idle' || e.status === 'processing').length}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-emerald-500/20 bg-emerald-500/10 text-emerald-300 hover:bg-emerald-500/20 transition-colors cursor-default">
                                                <span className="text-[0.6875rem] font-medium">成功</span>
                                                <span className="text-xs font-bold text-emerald-300 font-mono">
                                                    {state.entries.filter(e => e.status === 'success').length}
                                                </span>
                                            </div>
                                            <div className="flex items-center justify-center gap-1.5 py-1.5 rounded-md border border-red-500/20 bg-red-500/10 text-red-300 hover:bg-red-500/20 transition-colors cursor-default">
                                                <span className="text-[0.6875rem] font-medium">失败</span>
                                                <span className="text-xs font-bold text-red-300 font-mono">
                                                    {state.entries.filter(e => e.status === 'error').length}
                                                </span>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>

                            <div className="space-y-3 pb-10">
                                {state.entries.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center h-64 border-2 border-dashed border-zinc-800 rounded-xl bg-zinc-900/30 text-zinc-600">
                                        <MessageSquareText size={48} className="mb-4 opacity-20" />
                                        <p>列表为空，请在上方添加提示词</p>
                                    </div>
                                ) : (
                                    state.entries.map((entry, idx) => {
                                        const taskViewMode = getViewMode(entry.id);

                                        return (
                                            <div key={entry.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm transition-all hover:border-zinc-700">
                                                {/* Header */}
                                                <div className="flex items-start justify-between p-3 bg-zinc-900/50 border-b border-zinc-800/50">
                                                    <div className="flex items-center gap-3 flex-1 min-w-0">
                                                        <span className="flex items-center justify-center w-6 h-6 rounded bg-zinc-800 text-xs text-zinc-500 font-mono shrink-0">
                                                            {idx + 1}
                                                        </span>
                                                        {/* Source Text with proper truncation */}
                                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                                            <div className="text-sm text-zinc-200 font-medium truncate flex-1 min-w-0" title={entry.source}>
                                                                {entry.source}
                                                            </div>
                                                            {(entry.outputs[0] || entry.fromImageRecognition || (entry.originChatHistory && entry.originChatHistory.length > 0)) && (
                                                                <button
                                                                    onClick={() => toggleOriginChat(entry.id)}
                                                                    className={`px-2 py-1 rounded text-[0.6875rem] border transition-colors ${(entry.originChatHistory || []).length > 0
                                                                        ? 'text-amber-300 border-amber-500/50 bg-amber-500/10 hover:bg-amber-500/20'
                                                                        : entry.originChatOpen
                                                                            ? 'text-purple-300 border-purple-500/50 bg-purple-500/10'
                                                                            : 'text-zinc-300 border-zinc-700 hover:bg-zinc-800'
                                                                        }`}
                                                                    title={(entry.originChatHistory || []).length > 0 ? `对话记录 (${entry.originChatHistory?.length || 0} 条)` : '对话修改'}
                                                                >
                                                                    <MessageCircle size={12} className="inline-block mr-1" />
                                                                    对话
                                                                </button>
                                                            )}
                                                        </div>
                                                        {entry.fromImageRecognition && (
                                                            <span className="text-[0.625rem] px-2 py-0.5 rounded-full bg-blue-900/30 text-blue-200 border border-blue-700/50 shrink-0">
                                                                来自图片识别
                                                            </span>
                                                        )}
                                                        {/* Status Badge */}
                                                        <div className={`text-[0.625rem] px-2 py-0.5 rounded-full font-medium border shrink-0 whitespace-nowrap ${entry.status === 'processing' ? 'bg-blue-500/10 text-blue-400 border-blue-500/20' :
                                                            entry.status === 'success' ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/20' :
                                                                entry.status === 'error' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                                                                    'bg-zinc-800 text-zinc-500 border-zinc-700'
                                                            }`}>
                                                            {entry.status === 'processing' ? '生成中...' :
                                                                entry.status === 'success' ? `已完成 (${entry.outputs.length})` :
                                                                    entry.status === 'error' ? '失败' : '等待中'}
                                                        </div>
                                                        <button
                                                            onClick={() => handleRegenerateEntry(entry.id)}
                                                            className="p-1 ml-1 hover:bg-zinc-800 rounded text-blue-400 hover:text-blue-300 transition-colors tooltip-bottom"
                                                            data-tip="重新生成此条"
                                                        >
                                                            <RotateCw size={12} />
                                                        </button>
                                                    </div>
                                                    <div className="flex items-center gap-2 ml-3">
                                                        <button
                                                            onClick={() => toggleEntrySettings(entry.id)}
                                                            className={`p-1 rounded transition-colors ${entry.showSettings ? 'text-purple-400 bg-purple-500/10' : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'} tooltip-bottom`}
                                                            data-tip="单独设置 (Requirement)"
                                                        >
                                                            <SlidersHorizontal size={14} />
                                                        </button>
                                                        <button
                                                            onClick={() => toggleExpand(entry.id)}
                                                            className="p-1 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded transition-colors"
                                                        >
                                                            {expandedEntryIds.includes(entry.id) ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                                                        </button>
                                                        <button
                                                            onClick={() => handleRemoveEntry(entry.id)}
                                                            className="p-1 text-zinc-600 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors"
                                                        >
                                                            <Trash2 size={14} />
                                                        </button>
                                                    </div>
                                                </div>

                                                {entry.fromImageRecognition && entry.originImageUrl && (
                                                    <div className="px-3 py-2 bg-blue-900/10 border-b border-zinc-800 flex items-center gap-3">
                                                        <img src={entry.originImageUrl} alt="origin" className="w-12 h-12 rounded border border-blue-800/40 object-cover" />
                                                        <div className="text-[0.6875rem] text-zinc-400 leading-relaxed">
                                                            <div className="font-medium text-blue-200">原始图片参考</div>
                                                            <div className="text-[0.625rem] text-zinc-500 truncate max-w-xs">
                                                                {entry.originInput || entry.source}
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}


                                                {/* Custom Settings Panel (Inline) */}
                                                {entry.showSettings && (
                                                    <div className="p-3 bg-purple-900/10 border-b border-purple-500/10 text-xs">
                                                        <div className="flex flex-col gap-2">
                                                            <div className="flex flex-col gap-1">
                                                                <label className="text-zinc-400 font-medium">自定义创新要求 (留空则使用全局设置)</label>
                                                                <textarea
                                                                    className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-200 focus:border-purple-500 focus:outline-none resize-none h-16"
                                                                    value={entry.customRequirement || ''}
                                                                    onChange={(e) => updateEntrySettings(entry.id, { customRequirement: e.target.value })}
                                                                    placeholder={`全局要求: ${state.requirement || '(空)'}`}
                                                                />
                                                            </div>
                                                            <div className="flex items-center gap-3">
                                                                <label className="text-zinc-400 whitespace-nowrap">指令模板:</label>
                                                                <select
                                                                    className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-sm text-zinc-200 focus:outline-none focus:border-purple-500"
                                                                    value={entry.customTemplateId ?? ''}
                                                                    onChange={(e) => updateEntrySettings(entry.id, { customTemplateId: e.target.value || undefined })}
                                                                >
                                                                    <option value="">跟随全局</option>
                                                                    <option value="custom">自定义</option>
                                                                    {templateState.savedTemplates.map((t: any) => (
                                                                        <option key={t.id} value={t.id}>{t.name}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            <div className="flex gap-4">
                                                                <div className="flex items-center gap-2">
                                                                    <label className="text-zinc-400">每轮个数:</label>
                                                                    <input
                                                                        type="number"
                                                                        min="1" max="10"
                                                                        className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-center"
                                                                        value={entry.customCount || ''}
                                                                        onChange={(e) => updateEntrySettings(entry.id, { customCount: parseInt(e.target.value) || undefined })}
                                                                        placeholder={state.countPerRound.toString()}
                                                                    />
                                                                </div>
                                                                <div className="flex items-center gap-2">
                                                                    <label className="text-zinc-400">轮数:</label>
                                                                    <input
                                                                        type="number"
                                                                        min="1" max="5"
                                                                        className="w-16 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-center"
                                                                        value={entry.customRounds || ''}
                                                                        onChange={(e) => updateEntrySettings(entry.id, { customRounds: parseInt(e.target.value) || undefined })}
                                                                        placeholder={state.rounds.toString()}
                                                                    />
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}

                                                {/* Body - Redesigned Grid Layout */}
                                                {expandedEntryIds.includes(entry.id) && (
                                                    <div className="p-4 bg-zinc-950/30 border-t border-zinc-800/50">
                                                        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4 lg:gap-6">

                                                            {/* Left Column: Source (Takes less space) */}
                                                            <div className="flex flex-col gap-2 min-w-0 lg:col-span-1">
                                                                <div className="flex items-center justify-between px-1">
                                                                    <span className="text-xs font-medium text-zinc-500">原始提示词</span>
                                                                    <div className="flex gap-1 items-center">
                                                                        <button
                                                                            onClick={() => handleCopy(entry.source, `src-${entry.id}`)}
                                                                            className="p-1 hover:bg-zinc-800 rounded text-zinc-500 hover:text-zinc-300 transition-colors tooltip-bottom"
                                                                            data-tip="复制原始词"
                                                                        >
                                                                            {copiedId === `src-${entry.id}` ? <Check size={12} /> : <Copy size={12} />}
                                                                        </button>
                                                                    </div>
                                                                </div>
                                                                <div className="flex-1 p-3 bg-zinc-900/50 rounded-xl border border-zinc-800 text-sm text-zinc-300 whitespace-pre-wrap break-words leading-relaxed overflow-y-auto max-h-[300px] custom-scrollbar">
                                                                    {entry.source}
                                                                </div>

                                                                {/* 原始提示词下方的对话区（首个输出） */}
                                                                {entry.originChatOpen && (
                                                                    <div
                                                                        className="mt-2 p-3 bg-zinc-950/60 rounded-xl border border-zinc-800 flex flex-col gap-2 overflow-auto resize-y preset-textarea-lg"
                                                                        onDragOver={(e) => e.preventDefault()}
                                                                        onDrop={(e) => handleOriginChatDrop(e as any, entry.id)}
                                                                    >
                                                                        <div className="flex items-center justify-between">
                                                                            <div className="text-xs text-zinc-400 font-medium flex items-center gap-1">
                                                                                <MessageCircle size={12} /> 原始对话
                                                                                {(entry.originChatHistory?.length || 0) > 0 && (
                                                                                    <span className="text-amber-300 text-[0.625rem]">({entry.originChatHistory?.length || 0} 条)</span>
                                                                                )}
                                                                            </div>
                                                                            <div className="flex items-center gap-2">
                                                                                {(entry.originChatHistory?.length || 0) > 0 && (
                                                                                    <button
                                                                                        onClick={() => handleCopyOriginChatHistory(entry.id)}
                                                                                        className="text-[0.625rem] px-2 py-0.5 bg-zinc-900 hover:bg-zinc-800 text-zinc-400 hover:text-zinc-200 rounded border border-zinc-700 transition-colors"
                                                                                    >
                                                                                        {copiedId === `chat-origin-${entry.id}` ? '已复制' : '复制对话'}
                                                                                    </button>
                                                                                )}
                                                                                {(entry.originChatHistory || []).some(m => m.role === 'model') && (
                                                                                    <button
                                                                                        onClick={() => applyLastOriginChatToSource(entry.id)}
                                                                                        className="text-[0.625rem] px-2 py-0.5 bg-emerald-900/50 hover:bg-emerald-800/50 text-emerald-300 hover:text-emerald-200 rounded border border-emerald-700/50 transition-colors tooltip-bottom"
                                                                                        data-tip="将AI的最后回复应用到原始提示词"
                                                                                    >
                                                                                        应用到提示词
                                                                                    </button>
                                                                                )}
                                                                                <button
                                                                                    onClick={() => toggleOriginChat(entry.id)}
                                                                                    className="text-[0.6875rem] text-zinc-500 hover:text-zinc-300"
                                                                                >
                                                                                    收起
                                                                                </button>
                                                                            </div>
                                                                        </div>

                                                                        <div className="flex-1 overflow-y-auto custom-scrollbar space-y-2">
                                                                            {(entry.originChatHistory?.length || 0) === 0 ? (
                                                                                <div className="text-[0.6875rem] text-zinc-500 text-center py-2">暂无对话记录</div>
                                                                            ) : (
                                                                                entry.originChatHistory?.map(msg => (
                                                                                    <div key={msg.id} className={`text-[0.6875rem] p-2 rounded-lg ${msg.role === 'user' ? 'bg-purple-900/30 text-purple-100 ml-4' : 'bg-zinc-800 text-zinc-200 mr-4'}`}>
                                                                                        <div className="text-[0.625rem] text-zinc-500 mb-1">{msg.role === 'user' ? '你' : 'AI'}</div>
                                                                                        {msg.images && msg.images.length > 0 && (
                                                                                            <div className="flex gap-1 mb-1 flex-wrap">
                                                                                                {msg.images.map((img, idx) => (
                                                                                                    <img key={idx} src={img} alt="attachment" className="w-12 h-12 object-cover rounded border border-zinc-700" />
                                                                                                ))}
                                                                                            </div>
                                                                                        )}
                                                                                        <div className="whitespace-pre-wrap leading-relaxed">{msg.text}</div>
                                                                                    </div>
                                                                                ))
                                                                            )}
                                                                            {entry.originChatLoading && (
                                                                                <div className="flex items-center gap-2 text-[0.6875rem] text-emerald-400">
                                                                                    <Loader2 size={12} className="animate-spin" />
                                                                                    AI 正在思考...
                                                                                </div>
                                                                            )}
                                                                        </div>

                                                                        {entry.originChatAttachments && entry.originChatAttachments.length > 0 && (
                                                                            <div className="flex gap-2 overflow-x-auto pb-1 custom-scrollbar">
                                                                                {entry.originChatAttachments.map((img, i) => (
                                                                                    <div key={i} className="relative group w-12 h-12 shrink-0">
                                                                                        <img src={img} className="w-full h-full object-cover rounded border border-zinc-700" alt="pending" />
                                                                                        <button
                                                                                            onClick={() => removeOriginChatAttachment(entry.id, i)}
                                                                                            className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity tooltip-bottom"
                                                                                            data-tip="删除图片"
                                                                                        >
                                                                                            <X size={8} />
                                                                                        </button>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )}

                                                                        <div className="flex gap-2 items-end">
                                                                            <button
                                                                                onClick={() => handleOriginChatFileSelect(entry.id)}
                                                                                className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg border border-zinc-700 transition-colors tooltip-bottom"
                                                                                data-tip="上传参考图"
                                                                            >
                                                                                <ImageIcon size={16} />
                                                                            </button>
                                                                            <textarea
                                                                                value={entry.originChatInput || ''}
                                                                                onChange={(e) => updateOriginChatInput(entry.id, e.target.value)}
                                                                                onKeyDown={(e) => {
                                                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                                                        e.preventDefault();
                                                                                        sendOriginChatMessage(entry.id);
                                                                                    }
                                                                                }}
                                                                                onPaste={(e) => handleOriginChatPaste(e as any, entry.id)}
                                                                                placeholder="继续对话修改 (支持粘贴图片)..."
                                                                                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/30 resize-none h-[42px] custom-scrollbar"
                                                                                disabled={entry.originChatLoading}
                                                                            />
                                                                            <button
                                                                                onClick={() => sendOriginChatMessage(entry.id)}
                                                                                disabled={(!(entry.originChatInput || '').trim() && (!entry.originChatAttachments || entry.originChatAttachments.length === 0)) || entry.originChatLoading}
                                                                                className="w-[42px] h-[42px] flex items-center justify-center bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50 disabled:bg-zinc-700 transition-colors"
                                                                            >
                                                                                <Send size={16} />
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>

                                                            {/* Right Column: Results (Takes more space) */}
                                                            <div className="flex flex-col gap-2 min-w-0 lg:col-span-3">
                                                                <div className="flex items-center justify-between px-1 bg-zinc-900/80 p-1.5 rounded-lg border border-zinc-800">
                                                                    <span className="text-xs font-medium text-purple-400 flex items-center gap-1">
                                                                        <Sparkles size={12} /> 创新结果
                                                                    </span>

                                                                    {entry.outputs.length > 0 && (
                                                                        <div className="flex items-center gap-2">
                                                                            {/* Task Level View Toggle */}
                                                                            <button
                                                                                onClick={() => toggleViewOverride(entry.id, taskViewMode)}
                                                                                className="p-1 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors"
                                                                                title={`Switch View: Currently ${taskViewMode.toUpperCase()}`}
                                                                            >
                                                                                <ArrowLeftRight size={12} />
                                                                                <span className="text-[0.625rem] ml-1 font-bold">{taskViewMode.toUpperCase()}</span>
                                                                            </button>

                                                                            <div className="w-px h-3 bg-zinc-700 mx-1"></div>

                                                                            {/* Task Level Copy Buttons */}
                                                                            <button
                                                                                onClick={() => {
                                                                                    const text = entry.outputs.map(o => o.en).join('\n\n');
                                                                                    handleCopy(text, `${entry.id}-all-en`);
                                                                                }}
                                                                                className="text-[0.625rem] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700 flex items-center gap-1 transition-colors tooltip-bottom"
                                                                                data-tip="Copy All English Results"
                                                                            >
                                                                                {copiedId === `${entry.id}-all-en` ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                                                                                {copiedId === `${entry.id}-all-en` ? <span className="text-emerald-400 font-bold">已复制英文</span> : 'EN'}
                                                                            </button>
                                                                            <button
                                                                                onClick={() => {
                                                                                    const text = entry.outputs.map(o => o.zh || o.en).join('\n\n');
                                                                                    handleCopy(text, `${entry.id}-all-zh`);
                                                                                }}
                                                                                className="text-[0.625rem] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded border border-zinc-700 flex items-center gap-1 transition-colors tooltip-bottom"
                                                                                data-tip="Copy All Chinese Results"
                                                                            >
                                                                                {copiedId === `${entry.id}-all-zh` ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                                                                                {copiedId === `${entry.id}-all-zh` ? <span className="text-emerald-400 font-bold">已复制中文</span> : 'ZH'}
                                                                            </button>
                                                                        </div>
                                                                    )}
                                                                </div>

                                                                <div className="flex-1 bg-zinc-900/50 rounded-xl border border-zinc-800/50 p-2 min-h-[100px] flex flex-col gap-2 relative">
                                                                    {/* Processing State */}
                                                                    {entry.status === 'processing' && (
                                                                        <div className="absolute inset-0 bg-zinc-900/80 backdrop-blur-[1px] flex flex-col items-center justify-center z-10 rounded-xl">
                                                                            <Loader2 size={24} className="text-purple-500 animate-spin mb-2" />
                                                                            <span className="text-xs text-purple-400 animate-pulse">正在生成...</span>
                                                                        </div>
                                                                    )}

                                                                    {/* Error State */}
                                                                    {entry.error && (
                                                                        <div className="p-3 bg-red-900/20 border border-red-900/30 rounded-lg text-xs text-red-300 flex items-center gap-2">
                                                                            <AlertCircle size={14} /> {entry.error}
                                                                        </div>
                                                                    )}

                                                                    {/* Output List */}
                                                                    {entry.outputs.length > 0 ? (
                                                                        <div className="space-y-3 overflow-y-auto max-h-[600px] custom-scrollbar pr-1">
                                                                            {entry.outputs.map((output, outIdx) => {
                                                                                const itemViewMode = getViewMode(entry.id, outIdx);
                                                                                const displayText = itemViewMode === 'zh' ? (output.zh || output.en) : output.en;

                                                                                return (
                                                                                    <div key={output.id || outIdx} className="group relative bg-zinc-800/50 hover:bg-zinc-800 border border-zinc-700/50 hover:border-purple-500/30 rounded-lg transition-all overflow-hidden">
                                                                                        {/* Main Text Content */}
                                                                                        <div
                                                                                            className="p-3 cursor-pointer hover:bg-zinc-700/30 transition-colors relative tooltip-bottom"
                                                                                            onDoubleClick={() => setExpandedOutput({ en: output.en, zh: output.zh, mode: itemViewMode })}
                                                                                            data-tip="双击放大查看"
                                                                                        >
                                                                                            <div className="text-sm text-zinc-200 whitespace-pre-wrap break-words pr-20 leading-relaxed">
                                                                                                {displayText}
                                                                                            </div>
                                                                                            {itemViewMode === 'zh' && !output.zh && (
                                                                                                <span className="text-[0.625rem] text-zinc-500 mt-1 block italic">(暂无中文翻译)</span>
                                                                                            )}
                                                                                            {/* 单击提示 - 显示在右下角 */}
                                                                                            <span className="absolute bottom-1 right-2 text-[0.5rem] text-zinc-600 opacity-0 group-hover:opacity-100 transition-opacity">
                                                                                                双击放大
                                                                                            </span>
                                                                                        </div>

                                                                                        {/* Output Chat Panel */}
                                                                                        {output.isChatOpen && (
                                                                                            <div
                                                                                                className="border-t border-zinc-700/50 bg-zinc-900/50 p-3 flex flex-col gap-2"
                                                                                                onDragOver={(e) => {
                                                                                                    e.preventDefault();
                                                                                                    e.stopPropagation();
                                                                                                    if (draggingOutputId !== output.id) setDraggingOutputId(output.id);
                                                                                                }}
                                                                                                onDragLeave={(e) => {
                                                                                                    e.preventDefault();
                                                                                                    e.stopPropagation();
                                                                                                    if (draggingOutputId === output.id) setDraggingOutputId(null);
                                                                                                }}
                                                                                                onDrop={(e) => handleChatDrop(e, entry.id, output.id)}
                                                                                            >
                                                                                                {draggingOutputId === output.id && (
                                                                                                    <div className="border border-dashed border-purple-500/60 rounded-lg p-2 text-[0.6875rem] text-purple-200 bg-purple-900/20 text-center">
                                                                                                        松开添加到对话
                                                                                                    </div>
                                                                                                )}
                                                                                                {output.chatHistory.length > 0 && (
                                                                                                    <div className="flex items-center justify-between mb-1">
                                                                                                        <span className="text-[0.625rem] text-zinc-500">对话记录 ({output.chatHistory.length} 条)</span>
                                                                                                        <button
                                                                                                            onClick={() => handleCopyChatHistory(entry.id, output.id)}
                                                                                                            className="text-[0.625rem] px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded flex items-center gap-1 transition-colors tooltip-bottom"
                                                                                                            data-tip="复制对话记录"
                                                                                                        >
                                                                                                            {copiedId === `chat-${output.id}` ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />}
                                                                                                            {copiedId === `chat-${output.id}` ? '已复制' : '复制对话'}
                                                                                                        </button>
                                                                                                    </div>
                                                                                                )}
                                                                                                <div className="max-h-40 overflow-y-auto custom-scrollbar space-y-2 p-2 bg-zinc-950/30 rounded-lg border border-zinc-800/30">
                                                                                                    {output.chatHistory.map(msg => (
                                                                                                        <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                                                                                            <div className={`max-w-[85%] rounded-lg p-2 text-xs ${msg.role === 'user' ? 'bg-purple-900/30 text-purple-100' : 'bg-zinc-800 text-zinc-300'}`}>
                                                                                                                {msg.images && msg.images.length > 0 && (
                                                                                                                    <div className="flex gap-1 mb-1 flex-wrap justify-end">
                                                                                                                        {msg.images.map((img, i) => (
                                                                                                                            <img key={i} src={img} className="w-12 h-12 object-cover rounded border border-zinc-700" alt="uploaded content" />
                                                                                                                        ))}
                                                                                                                    </div>
                                                                                                                )}
                                                                                                                {msg.text}
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    ))}
                                                                                                    {output.isChatLoading && (
                                                                                                        <div className="flex justify-start">
                                                                                                            <div className="bg-zinc-800 rounded-lg p-2 text-xs text-zinc-400 flex items-center gap-1">
                                                                                                                <Loader2 size={10} className="animate-spin" /> Thinking...
                                                                                                            </div>
                                                                                                        </div>
                                                                                                    )}
                                                                                                    {output.chatHistory.length === 0 && !output.isChatLoading && (
                                                                                                        <div className="text-[0.6875rem] text-zinc-500 text-center">暂无对话</div>
                                                                                                    )}
                                                                                                </div>

                                                                                                {output.chatAttachments && output.chatAttachments.length > 0 && (
                                                                                                    <div className="flex gap-2 p-2 overflow-x-auto bg-zinc-950/20 rounded border border-zinc-800/50 mb-1">
                                                                                                        {output.chatAttachments.map((img, i) => (
                                                                                                            <div key={i} className="relative group w-10 h-10 shrink-0">
                                                                                                                <img src={img} className="w-full h-full object-cover rounded border border-zinc-700" alt="pending" />
                                                                                                                <button
                                                                                                                    onClick={() => removeChatAttachment(entry.id, output.id, i)}
                                                                                                                    className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                                                                                                >
                                                                                                                    <X size={8} />
                                                                                                                </button>
                                                                                                            </div>
                                                                                                        ))}
                                                                                                    </div>
                                                                                                )}

                                                                                                <div className="flex gap-2 items-end">
                                                                                                    <button
                                                                                                        onClick={() => handleChatFileSelect(entry.id, output.id)}
                                                                                                        className="p-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded border border-zinc-700 transition-colors tooltip-bottom"
                                                                                                        data-tip="上传图片"
                                                                                                    >
                                                                                                        <ImageIcon size={14} />
                                                                                                    </button>
                                                                                                    <input
                                                                                                        type="text"
                                                                                                        value={output.chatInput}
                                                                                                        onChange={(e) => updateOutputChatInput(entry.id, output.id, e.target.value)}
                                                                                                        onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && sendOutputChatMessage(entry.id, output.id)}
                                                                                                        onPaste={(e) => handleChatPaste(e, entry.id, output.id)}
                                                                                                        placeholder="输入修改指令 (支持粘贴图片)..."
                                                                                                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-purple-500"
                                                                                                        disabled={output.isChatLoading}
                                                                                                    />
                                                                                                    <button
                                                                                                        onClick={() => sendOutputChatMessage(entry.id, output.id)}
                                                                                                        disabled={(!(output.chatInput || '').trim() && (!output.chatAttachments || output.chatAttachments.length === 0)) || output.isChatLoading}
                                                                                                        className="p-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded-lg disabled:opacity-50 transition-colors"
                                                                                                    >
                                                                                                        <Send size={14} />
                                                                                                    </button>
                                                                                                </div>
                                                                                            </div>
                                                                                        )}

                                                                                        {/* Card Hover Controls */}
                                                                                        <div className="absolute top-2 right-2 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-zinc-900/95 rounded-lg p-1 shadow-sm border border-zinc-700/80 backdrop-blur-sm">
                                                                                            {/* Chat Toggle */}
                                                                                            <button
                                                                                                onClick={() => toggleOutputChat(entry.id, output.id)}
                                                                                                className={`p-1.5 rounded transition-colors relative ${output.chatHistory.length > 0
                                                                                                    ? 'text-amber-400 bg-amber-500/20 hover:bg-amber-500/30'
                                                                                                    : output.isChatOpen
                                                                                                        ? 'text-purple-400 bg-purple-500/10'
                                                                                                        : 'text-zinc-400 hover:text-white hover:bg-zinc-700'
                                                                                                    }`}
                                                                                                title={output.chatHistory.length > 0 ? `对话记录 (${output.chatHistory.length} 条)` : '对话修改'}
                                                                                            >
                                                                                                <MessageCircle size={12} />
                                                                                                {output.chatHistory.length > 0 && (
                                                                                                    <span className="absolute -top-1 -right-1 bg-amber-500 text-black text-[0.5rem] font-bold rounded-full w-3 h-3 flex items-center justify-center">
                                                                                                        {output.chatHistory.length > 9 ? '9+' : output.chatHistory.length}
                                                                                                    </span>
                                                                                                )}
                                                                                            </button>

                                                                                            <div className="w-px h-3 bg-zinc-700 mx-0.5"></div>

                                                                                            {/* Toggle View */}
                                                                                            <button
                                                                                                onClick={() => toggleViewOverride(`${entry.id}-${outIdx}`, itemViewMode)}
                                                                                                className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors"
                                                                                                title={`Switch View: Currently ${itemViewMode.toUpperCase()}`}
                                                                                            >
                                                                                                <ArrowLeftRight size={12} />
                                                                                            </button>
                                                                                            <div className="w-px h-3 bg-zinc-700 mx-0.5"></div>

                                                                                            {/* Copy EN */}
                                                                                            <button
                                                                                                onClick={() => handleCopy(output.en, `${entry.id}-${outIdx}-en`)}
                                                                                                className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors relative flex items-center gap-1 tooltip-bottom"
                                                                                                data-tip="Copy English"
                                                                                            >
                                                                                                {copiedId === `${entry.id}-${outIdx}-en` ? (
                                                                                                    <span className="text-[0.5rem] font-bold text-emerald-400">已复制英文</span>
                                                                                                ) : (
                                                                                                    <>
                                                                                                        <Copy size={12} />
                                                                                                        <span className="text-[0.5rem] font-bold opacity-60">EN</span>
                                                                                                    </>
                                                                                                )}
                                                                                            </button>

                                                                                            {/* Copy ZH */}
                                                                                            <button
                                                                                                onClick={() => handleCopy(output.zh || output.en, `${entry.id}-${outIdx}-zh`)}
                                                                                                className="p-1.5 hover:bg-zinc-700 rounded text-zinc-400 hover:text-white transition-colors relative flex items-center gap-1 tooltip-bottom"
                                                                                                data-tip="Copy Chinese"
                                                                                            >
                                                                                                {copiedId === `${entry.id}-${outIdx}-zh` ? (
                                                                                                    <span className="text-[0.5rem] font-bold text-emerald-400">已复制中文</span>
                                                                                                ) : (
                                                                                                    <>
                                                                                                        <Copy size={12} />
                                                                                                        <span className="text-[0.5rem] font-bold opacity-60">ZH</span>
                                                                                                    </>
                                                                                                )}
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>
                                                                                );
                                                                            })}
                                                                        </div>
                                                                    ) : (
                                                                        entry.status !== 'processing' && !entry.error && (
                                                                            <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 gap-2 min-h-[200px]">
                                                                                <Sparkles size={24} className="opacity-20" />
                                                                                <span className="text-xs italic">等待开始...</span>
                                                                            </div>
                                                                        )
                                                                    )}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        )
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                </div>

                {/* --- Preview Modal --- */}
                {showPreviewModal && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowPreviewModal(false)}>
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Eye size={20} className="text-purple-400" /> 最终指令预览
                                </h3>
                                <button onClick={() => setShowPreviewModal(false)} className="text-zinc-500 hover:text-white">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="p-4 overflow-y-auto bg-zinc-950/50">
                                <p className="text-xs text-zinc-500 mb-2">以下是发送给 AI 的完整 Prompt 结构（以第一条数据为例）：</p>
                                <pre className="text-xs text-zinc-300 whitespace-pre-wrap font-mono bg-black/30 p-4 rounded-lg border border-zinc-800">
                                    {previewContent}
                                </pre>
                            </div>
                            <div className="p-4 border-t border-zinc-800 flex justify-end">
                                <button
                                    onClick={() => setShowPreviewModal(false)}
                                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm transition-colors"
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                )}

                {/* --- Expanded Output Text Modal (双击放大) --- */}
                {expandedOutput && (
                    <div
                        className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
                        onClick={() => setExpandedOutput(null)}
                    >
                        <div
                            className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-4xl shadow-2xl flex flex-col max-h-[90vh]"
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex items-center justify-between p-4 border-b border-zinc-800 shrink-0">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <FileText size={20} className="text-purple-400" /> 放大查看
                                </h3>
                                <div className="flex items-center gap-2">
                                    {/* 切换语言按钮 - 精简版 */}
                                    <button
                                        onClick={() => setExpandedOutput(prev => prev ? { ...prev, mode: prev.mode === 'en' ? 'zh' : 'en' } : null)}
                                        className="flex items-center gap-1 px-2 py-1.5 rounded-lg text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-300 transition-all border border-zinc-700 tooltip-bottom"
                                        data-tip="切换中英文"
                                    >
                                        <ArrowLeftRight size={12} />
                                        <span className={expandedOutput.mode === 'en' ? 'text-emerald-400' : 'text-zinc-500'}>EN</span>
                                        <span className="text-zinc-600">/</span>
                                        <span className={expandedOutput.mode === 'zh' ? 'text-emerald-400' : 'text-zinc-500'}>中</span>
                                    </button>
                                    {/* 复制按钮 */}
                                    <button
                                        onClick={() => {
                                            const textToCopy = expandedOutput.mode === 'zh'
                                                ? (expandedOutput.zh || expandedOutput.en)
                                                : expandedOutput.en;
                                            navigator.clipboard.writeText(textToCopy);
                                            setCopiedId('expanded-modal');
                                            setTimeout(() => setCopiedId(null), 2000);
                                        }}
                                        className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg text-sm transition-colors flex items-center gap-1.5 border border-zinc-700"
                                    >
                                        {copiedId === 'expanded-modal' ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                                        {copiedId === 'expanded-modal' ? '已复制' : '复制'}
                                    </button>
                                    <button onClick={() => setExpandedOutput(null)} className="text-zinc-500 hover:text-white transition-colors">
                                        <X size={20} />
                                    </button>
                                </div>
                            </div>
                            <div className="p-6 overflow-y-auto flex-1 custom-scrollbar">
                                <div className="text-base text-zinc-200 whitespace-pre-wrap leading-relaxed select-text">
                                    {expandedOutput.mode === 'zh'
                                        ? (expandedOutput.zh || expandedOutput.en)
                                        : expandedOutput.en}
                                </div>
                                {expandedOutput.mode === 'zh' && !expandedOutput.zh && (
                                    <p className="text-xs text-zinc-500 italic mt-4">(暂无中文翻译，显示英文原文)</p>
                                )}
                            </div>
                            <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/95 flex-shrink-0">
                                <p className="text-[0.625rem] text-zinc-600 text-center">
                                    按 ESC 键或点击背景关闭 · 可选中文字复制
                                </p>
                            </div>
                        </div>
                    </div>
                )}

            </div>

            {/* 项目管理面板 */}
            <ProjectPanel
                isOpen={showProjectPanel}
                onClose={() => setShowProjectPanel(false)}
                moduleId="desc-innovator"
                currentProjectId={currentProject?.id}
                onProjectChange={(project) => {
                    setCurrentProject(project);
                    // 恢复项目状态，补充默认字段
                    if (project.currentState?.entries) {
                        const restoredEntries = project.currentState.entries.map((entry: any) => ({
                            ...entry,
                            status: entry.status || 'success',
                            outputs: (entry.outputs || []).map((output: any) => ({
                                ...output,
                                chatInput: output.chatInput || '',
                                chatAttachments: output.chatAttachments || [],
                                isChatLoading: false,
                                chatHistory: output.chatHistory || []
                            }))
                        }));
                        setState(prev => ({
                            ...prev,
                            entries: restoredEntries,
                            activeTab: 'innovator'
                        }));
                    }
                    setShowProjectPanel(false);
                }}
                onCreateNew={() => {
                    // 创建新项目时清空状态
                    setState(prev => ({
                        ...prev,
                        entries: []
                    }));
                    setCurrentProject(null);
                }}
            />
        </>
    );
}
