/**
 * Image to Prompt Tool - Main Component
 * 反推提示词工具 - 主组件
 * 
 * 合并自正式版 index.tsx 和创艺魔盒 2 的功能：
 * - 正式版：预设模板系统、精确/快速模式切换、完整的会话历史管理
 * - 创艺魔盒 2：灵感融合模式、更丰富的专家选择 UI、预处理修改指令
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';

// Types
import {
    ExpertKey,
    ImageStatus,
    SessionStatus,
    BatchMode,
    FusionMode,
    FusionRole,
    Message,
    ImageData,
    ImageEntry,
    Session,
    FusionItem,
    FusionResult,
    FusionChatMessage,
    Preset,
    ImageToPromptState,
    ImageToPromptToolProps,
    singleImageResponseSchema,
    batchImageResponseSchema,
    defaultModifiers,
    STORAGE_KEYS
} from './types';

// Utils
import {
    generateUniqueId,
    fileToBase64,
    getMultiExpertSystemInstruction,
    getBatchMultiExpertSystemInstruction,
    getFusionSystemInstruction,
    copyToClipboard,
    extractUrlsFromHtml,
    parsePasteInput,
    fetchImageBlob
} from './utils';

// Components
import {
    Loader,
    PromptDisplay,
    PromptTabs,
    FileUploader,
    ToolHeader,
    ModeToggle
} from './components';
import { FusionWorkspace } from './components/FusionWorkspace';
import { ExpertSelector } from './components/ExpertSelector';
import { HistoryPanel } from './components/HistoryPanel';

// 图标（需要从父项目复用）
// 在实际集成时，这些需要从 lucide-react 导入

interface ImageToPromptAppProps extends ImageToPromptToolProps {
    getAiInstance: () => any;
    t: (key: string) => string;
}

/**
 * 主组件
 */
export const ImageToPromptApp: React.FC<ImageToPromptAppProps> = ({
    getAiInstance,
    t,
    templateBuilderState,
    textModel = 'gemini-2.0-flash',
}) => {
    // ========== State ==========

    // 会话状态
    const [sessions, setSessions] = useState<Session[]>([]);
    const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
    const [activeImageId, setActiveImageId] = useState<string | null>(null);
    const [userInput, setUserInput] = useState<Record<string, string>>({});
    const [error, setError] = useState<string | null>(null);

    // 专家选择
    const [selectedExperts, setSelectedExperts] = useState<ExpertKey[]>(['general']);

    // 模式切换
    const [batchMode, setBatchMode] = useState<BatchMode>(() => {
        if (typeof window === 'undefined') return 'accurate';
        try {
            return (localStorage.getItem(STORAGE_KEYS.BATCH_MODE) as BatchMode) || 'accurate';
        } catch {
            return 'accurate';
        }
    });

    const [fusionMode, setFusionMode] = useState<FusionMode>('batch');

    // 融合状态（来自创艺魔盒 2）
    const [fusionItems, setFusionItems] = useState<FusionItem[]>([]);
    const [fusionResult, setFusionResult] = useState<FusionResult | null>(null);
    const [fusionChatHistory, setFusionChatHistory] = useState<FusionChatMessage[]>([]);
    const [fusionChatInput, setFusionChatInput] = useState('');
    const [extraInstruction, setExtraInstruction] = useState('');

    // 预设和模板
    const [presets, setPresets] = useState<Preset[]>(() => {
        if (typeof window === 'undefined') return defaultModifiers;
        try {
            const saved = localStorage.getItem(STORAGE_KEYS.MODIFIERS);
            return saved ? JSON.parse(saved) : defaultModifiers;
        } catch {
            return defaultModifiers;
        }
    });
    const [selectedPresetId, setSelectedPresetId] = useState('system_default');
    const [manualInstruction, setManualInstruction] = useState(() => {
        if (typeof window === 'undefined') return '';
        try {
            return localStorage.getItem(STORAGE_KEYS.MANUAL_INSTRUCTION) || '';
        } catch {
            return '';
        }
    });

    // UI 状态
    const [isProcessing, setIsProcessing] = useState(false);
    const [isBatchProcessing, setIsBatchProcessing] = useState(false);
    const [showSystemInstructionModal, setShowSystemInstructionModal] = useState(false);
    const [showDeprecationWarning, setShowDeprecationWarning] = useState(() => {
        if (typeof window === 'undefined') return true;
        try {
            return localStorage.getItem(STORAGE_KEYS.HIDE_DEPRECATION_WARNING) !== 'true';
        } catch {
            return true;
        }
    });
    const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

    // Refs
    const chatContainerRef = useRef<HTMLDivElement>(null);
    const globalPasteTextareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ========== Computed ==========

    const activeSession = sessions.find(s => s.id === activeSessionId) || null;
    const activeImage = activeSession?.images.find(img => img.id === activeImageId) || null;
    const isStaging = activeSession?.status === 'staging';

    // ========== Effects ==========

    // 保存会话到本地存储
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            // 只保存简化版本的会话（不含大型 base64 数据）
            const sessionsToSave = sessions.map(session => ({
                id: session.id,
                experts: session.experts,
                status: session.status,
                imageCount: session.images.length,
                // 保存第一张图的缩略图 URL（如果存在）
                thumbnailUrl: session.images[0]?.imageData.url || null
            }));
            localStorage.setItem(STORAGE_KEYS.SESSIONS, JSON.stringify(sessionsToSave));
        } catch (e) {
            console.warn('Failed to save sessions:', e);
        }
    }, [sessions]);

    // 保存批量模式
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(STORAGE_KEYS.BATCH_MODE, batchMode);
        } catch (e) {
            console.warn('Failed to save batch mode:', e);
        }
    }, [batchMode]);

    // 保存手动指令
    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(STORAGE_KEYS.MANUAL_INSTRUCTION, manualInstruction);
        } catch (e) {
            console.warn('Failed to save manual instruction:', e);
        }
    }, [manualInstruction]);

    // 全局粘贴事件处理（与 AI 图片识别工具保持一致的粘贴逻辑）
    const handleGlobalPaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        // 注意：不要在这里调用 e.stopPropagation()，否则会阻止普通文本粘贴
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        const handlePasteFiles = async (files: File[]) => {
            if (fusionMode === 'fusion') {
                await handleAddFusionImages(files);
                return;
            }
            if (isStaging) {
                await handleAppendImages(files);
                return;
            }
            await handleBatchImageUpload(files);
        };

        const handlePasteUrls = async (urls: string[]) => {
            if (isStaging && fusionMode !== 'fusion') {
                await handleAppendFromUrls(urls);
                return;
            }
            await handleAddFromUrls(urls);
        };

        // 1. 直接粘贴图片文件
        if (clipboardData.files.length > 0) {
            const imageFiles = Array.from(clipboardData.files).filter(f => f.type.startsWith('image/'));
            if (imageFiles.length > 0) {
                e.preventDefault();
                await handlePasteFiles(imageFiles);
                return;
            }
        }

        // 2. 通过 clipboardData.items 获取图片（某些浏览器需要这样）
        const items = Array.from(clipboardData.items || []);
        const imageItems = items.filter(item => item.type.startsWith('image/'));
        if (imageItems.length > 0) {
            const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
            if (files.length > 0) {
                e.preventDefault();
                await handlePasteFiles(files);
                return;
            }
        }

        // 3. 从 HTML 中提取图片 URL（Google Sheets 支持）
        const html = clipboardData.getData('text/html');
        const plainText = clipboardData.getData('text/plain');

        // 优先检查纯文本中是否有 =IMAGE() 公式
        if (plainText && plainText.includes('=IMAGE')) {
            e.preventDefault();
            const parsed = parsePasteInput(plainText);
            if (parsed.length > 0) {
                await handlePasteUrls(parsed.map(p => p.url));
            }
            return;
        }

        // 从 HTML 中提取图片 URL
        if (html) {
            const extractedUrls = extractUrlsFromHtml(html);
            if (extractedUrls.length > 0) {
                e.preventDefault();
                await handlePasteUrls(extractedUrls.map(u => u.fetchUrl));
                return;
            }
        }

        // 4. 纯文本 URL
        const text = clipboardData.getData('text');
        if (text && (text.includes('http') || text.includes('=IMAGE'))) {
            e.preventDefault();
            const parsed = parsePasteInput(text);
            if (parsed.length > 0) {
                await handlePasteUrls(parsed.map(p => p.url));
            }
        }
    }, [fusionMode, selectedExperts, isStaging, activeSessionId, sessions]);

    // 从 URL 添加图片
    const fetchFilesFromUrls = async (urls: string[]): Promise<File[]> => {
        if (urls.length === 0) return [];

        const files: File[] = [];
        for (const url of urls) {
            try {
                const { blob, mimeType } = await fetchImageBlob(url);
                const ext = mimeType.split('/')[1] || 'jpg';
                const file = new File([blob], `image-${Date.now()}.${ext}`, { type: mimeType });
                files.push(file);
            } catch (error) {
                console.warn('Failed to fetch image from URL:', url, error);
            }
        }

        return files;
    };

    const handleAddFromUrls = async (urls: string[]) => {
        const files = await fetchFilesFromUrls(urls);
        if (files.length === 0) return;

        if (fusionMode === 'fusion') {
            await handleAddFusionImages(files);
        } else {
            await handleBatchImageUpload(files);
        }
    };

    const handleAppendFromUrls = async (urls: string[]) => {
        const files = await fetchFilesFromUrls(urls);
        if (files.length > 0) {
            await handleAppendImages(files);
        }
    };

    // ========== Handlers ==========

    // 新建会话
    const handleNewSession = useCallback(() => {
        setActiveSessionId(null);
        setActiveImageId(null);
        setUserInput({});
        setError(null);
    }, []);

    // 选择会话
    const handleSelectSession = useCallback((sessionId: string) => {
        const session = sessions.find(s => s.id === sessionId);
        if (session) {
            setActiveSessionId(sessionId);
            setActiveImageId(session.images[0]?.id || null);
        }
    }, [sessions]);

    // 删除会话
    const handleDeleteSession = useCallback((sessionId: string) => {
        setSessions(prev => {
            const newSessions = prev.filter(s => s.id !== sessionId);
            return newSessions;
        });
        if (activeSessionId === sessionId) {
            const remaining = sessions.filter(s => s.id !== sessionId);
            setActiveSessionId(remaining[0]?.id || null);
            setActiveImageId(remaining[0]?.images[0]?.id || null);
        }
    }, [activeSessionId, sessions]);

    // 创建图片对象
    const createImageObjects = async (files: File[], sessionId: string): Promise<ImageEntry[]> => {
        const imagePromises = files.map(async (file) => {
            const url = URL.createObjectURL(file);
            const base64 = await fileToBase64(file);
            return {
                id: `${sessionId}-${file.name}-${file.lastModified}`,
                imageData: { file, url, base64, type: file.type, name: file.name },
                chatHistory: [] as Message[],
                status: 'pending' as ImageStatus,
                error: null,
                preModificationPrompt: '',
            };
        });
        return await Promise.all(imagePromises);
    };

    // 批量上传图片
    const handleBatchImageUpload = async (files: File[]) => {
        if (selectedExperts.length === 0) {
            setError(t('error_selectExpert') || '请选择至少一个专家模型');
            return;
        }
        if (files.length === 0) return;

        setError(null);
        const newSessionId = generateUniqueId();
        const sessionImages = await createImageObjects(files, newSessionId);

        const newSession: Session = {
            id: newSessionId,
            images: sessionImages,
            experts: [...selectedExperts],
            status: 'staging' as SessionStatus,
        };

        setSessions(prev => [newSession, ...prev]);
        setActiveSessionId(newSessionId);
        setActiveImageId(sessionImages[0]?.id || null);
        setUserInput({});
    };

    // 添加融合图片
    const handleAddFusionImages = async (files: File[]) => {
        const newItems: FusionItem[] = await Promise.all(files.map(async (file) => {
            const url = URL.createObjectURL(file);
            const base64 = await fileToBase64(file);
            return {
                id: generateUniqueId(),
                imageData: { file, url, base64, type: file.type, name: file.name },
                role: 'inspiration' as FusionRole,
            };
        }));
        setFusionItems(prev => [...prev, ...newItems]);
    };

    // 更新融合项
    const handleUpdateFusionItem = (id: string, updates: Partial<FusionItem>) => {
        setFusionItems(prev => prev.map(item =>
            item.id === id ? { ...item, ...updates } : item
        ));
    };

    // 移除融合项
    const handleRemoveFusionItem = (id: string) => {
        setFusionItems(prev => prev.filter(item => item.id !== id));
    };

    // 删除单张图片
    const handleDeleteImage = (imageId: string) => {
        if (!activeSessionId) return;
        setSessions(prev => prev.map(s => {
            if (s.id !== activeSessionId) return s;
            const filteredImages = s.images.filter(img => img.id !== imageId);
            // 如果删除后没有图片了，删除整个会话
            if (filteredImages.length === 0) {
                return null as any;
            }
            return { ...s, images: filteredImages };
        }).filter(Boolean));

        // 如果删除的是当前选中的图片，切换到第一张
        if (activeImageId === imageId) {
            const currentSession = sessions.find(s => s.id === activeSessionId);
            if (currentSession) {
                const remaining = currentSession.images.filter(img => img.id !== imageId);
                setActiveImageId(remaining[0]?.id || null);
            }
        }
    };

    // 追加图片到当前会话
    const handleAppendImages = async (files: File[]) => {
        if (!activeSessionId || files.length === 0) return;
        const currentSession = sessions.find(s => s.id === activeSessionId);
        if (!currentSession || currentSession.status !== 'staging') return;

        const newImages = await createImageObjects(files, activeSessionId);
        setSessions(prev => prev.map(s =>
            s.id !== activeSessionId
                ? s
                : { ...s, images: [...s.images, ...newImages] }
        ));
    };

    // 重试单张图片的处理
    const handleRetryImage = async (imageId: string) => {
        if (!activeSession) return;
        const imageToRetry = activeSession.images.find(img => img.id === imageId);
        if (!imageToRetry) return;

        // 设置为处理中状态
        setSessions(prev => prev.map(s =>
            s.id === activeSessionId
                ? { ...s, images: s.images.map(img => img.id === imageId ? { ...img, status: 'processing' as ImageStatus, error: null } : img) }
                : s
        ));

        try {
            const ai = getAiInstance();
            const systemInstruction = getEffectiveInstruction(activeSession.experts, false);
            const imagePart = { inlineData: { mimeType: imageToRetry.imageData.type, data: imageToRetry.imageData.base64 } };
            const parts: any[] = [imagePart];

            if (imageToRetry.preModificationPrompt?.trim()) {
                parts.push({ text: imageToRetry.preModificationPrompt.trim() });
            }

            const response = await ai.models.generateContent({
                model: textModel,
                contents: { parts },
                config: {
                    systemInstruction,
                    responseMimeType: "application/json",
                    responseSchema: singleImageResponseSchema
                },
            });

            const modelMessage: Message = { sender: 'model', text: response.text };

            setSessions(prev => prev.map(s =>
                s.id === activeSessionId
                    ? { ...s, images: s.images.map(img => img.id === imageId ? { ...img, status: 'success' as ImageStatus, chatHistory: [modelMessage] } : img) }
                    : s
            ));
        } catch (e: any) {
            console.error(`Retry image ${imageId} failed:`, e);
            setSessions(prev => prev.map(s =>
                s.id === activeSessionId
                    ? { ...s, images: s.images.map(img => img.id === imageId ? { ...img, status: 'error' as ImageStatus, error: e.message } : img) }
                    : s
            ));
        }
    };

    // 获取有效的系统指令
    const getEffectiveInstruction = (experts: ExpertKey[], isBatch: boolean): string => {
        // 如果选择了手动输入模式
        if (selectedPresetId === 'manual_input' && manualInstruction.trim()) {
            return manualInstruction.trim();
        }

        // 如果选择了预设模板
        if (selectedPresetId !== 'system_default') {
            const preset = presets.find(p => p.id === selectedPresetId);
            if (preset) {
                return preset.prompt;
            }
        }

        // 使用系统默认指令
        return isBatch
            ? getBatchMultiExpertSystemInstruction(experts)
            : getMultiExpertSystemInstruction(experts);
    };

    // 开始批量处理
    const handleStartProcessing = async () => {
        if (!activeSession || activeSession.status !== 'staging') return;

        setIsBatchProcessing(true);

        try {
            const ai = getAiInstance();

            // 更新会话状态为处理中
            setSessions(prev => prev.map(s =>
                s.id === activeSessionId
                    ? { ...s, status: 'processing' as SessionStatus, images: s.images.map(img => ({ ...img, status: 'processing' as ImageStatus })) }
                    : s
            ));

            if (batchMode === 'accurate') {
                // 精确模式：逐张处理
                for (const img of activeSession.images) {
                    try {
                        const systemInstruction = getEffectiveInstruction(activeSession.experts, false);
                        const imagePart = { inlineData: { mimeType: img.imageData.type, data: img.imageData.base64 } };
                        const parts: any[] = [imagePart];

                        if (img.preModificationPrompt?.trim()) {
                            parts.push({ text: img.preModificationPrompt.trim() });
                        }

                        const response = await ai.models.generateContent({
                            model: textModel,
                            contents: { parts },
                            config: {
                                systemInstruction,
                                responseMimeType: "application/json",
                                responseSchema: singleImageResponseSchema
                            },
                        });

                        const modelMessage: Message = { sender: 'model', text: response.text };

                        setSessions(prev => prev.map(s =>
                            s.id === activeSessionId
                                ? { ...s, images: s.images.map(i => i.id === img.id ? { ...i, status: 'success' as ImageStatus, chatHistory: [modelMessage] } : i) }
                                : s
                        ));
                    } catch (e: any) {
                        console.error(`Processing image ${img.id} failed:`, e);
                        setSessions(prev => prev.map(s =>
                            s.id === activeSessionId
                                ? { ...s, images: s.images.map(i => i.id === img.id ? { ...i, status: 'error' as ImageStatus, error: e.message } : i) }
                                : s
                        ));
                    }
                }
            } else {
                // 快速模式：批量打包
                const systemInstruction = getEffectiveInstruction(activeSession.experts, true);

                const parts = activeSession.images.flatMap((img, index) => {
                    const markerPart = { text: `[IMAGE ${index}]` };
                    const imagePart = { inlineData: { mimeType: img.imageData.type, data: img.imageData.base64 } };
                    if (img.preModificationPrompt?.trim()) {
                        return [markerPart, imagePart, { text: img.preModificationPrompt.trim() }];
                    }
                    return [markerPart, imagePart];
                });

                const response = await ai.models.generateContent({
                    model: textModel,
                    contents: { parts },
                    config: {
                        systemInstruction,
                        responseMimeType: "application/json",
                        responseSchema: batchImageResponseSchema
                    }
                });

                const results = JSON.parse(response.text);
                const resultsMap = new Map(results.map((r: any) => [r.imageIndex, r.prompts]));

                const updatedImages = activeSession.images.map((img, index) => {
                    const imageResultPrompts = resultsMap.get(index);
                    if (imageResultPrompts && Array.isArray(imageResultPrompts)) {
                        const modelMessage: Message = { sender: 'model', text: JSON.stringify(imageResultPrompts) };
                        return { ...img, status: 'success' as ImageStatus, chatHistory: [modelMessage] };
                    } else {
                        return { ...img, status: 'error' as ImageStatus, error: 'AI did not return a result for this image.' };
                    }
                });

                setSessions(prev => prev.map(s =>
                    s.id === activeSessionId
                        ? { ...s, status: 'complete' as SessionStatus, images: updatedImages }
                        : s
                ));
            }

            // 更新会话状态为完成
            setSessions(prev => prev.map(s =>
                s.id === activeSessionId ? { ...s, status: 'complete' as SessionStatus } : s
            ));

        } catch (e: any) {
            console.error("Batch processing failed:", e);
            setError(e.message || t('error_failedToAnalyze'));
            setSessions(prev => prev.map(s =>
                s.id === activeSessionId
                    ? { ...s, status: 'complete' as SessionStatus, images: s.images.map(img => ({ ...img, status: 'error' as ImageStatus, error: e.message })) }
                    : s
            ));
        } finally {
            setIsBatchProcessing(false);
        }
    };

    // 融合生成
    const handleFusionGenerate = async () => {
        if (fusionItems.length < 1) return;

        setIsProcessing(true);

        try {
            const ai = getAiInstance();
            const systemInstruction = getFusionSystemInstruction();

            const parts = fusionItems.flatMap(item => [
                { text: `[Role: ${item.role}]` },
                { inlineData: { mimeType: item.imageData.type, data: item.imageData.base64 } }
            ]);

            if (extraInstruction.trim()) {
                parts.push({ text: `Additional instruction: ${extraInstruction.trim()}` });
            }

            const response = await ai.models.generateContent({
                model: textModel,
                contents: { parts },
                config: {
                    systemInstruction,
                    responseMimeType: "application/json"
                }
            });

            const result = JSON.parse(response.text);
            setFusionResult({
                englishPrompt: result.englishPrompt || '',
                chinesePrompt: result.chinesePrompt || ''
            });
            setFusionChatHistory([]);

        } catch (e: any) {
            console.error("Fusion generation failed:", e);
            setError(e.message || t('error_fusionFailed'));
        } finally {
            setIsProcessing(false);
        }
    };

    // 融合对话
    const handleFusionChat = async () => {
        if (!fusionResult || !fusionChatInput.trim()) return;

        setIsProcessing(true);
        const userMessage: FusionChatMessage = { sender: 'user', text: fusionChatInput };
        setFusionChatHistory(prev => [...prev, userMessage]);
        setFusionChatInput('');

        try {
            const ai = getAiInstance();

            const contextParts = [
                { text: `Previous generated prompt:\nEnglish: ${fusionResult.englishPrompt}\nChinese: ${fusionResult.chinesePrompt}` },
                { text: `User modification request: ${fusionChatInput}` },
                { text: 'Please modify the prompt based on the user request. Return JSON with "englishPrompt" and "chinesePrompt" keys.' }
            ];

            const response = await ai.models.generateContent({
                model: textModel,
                contents: { parts: contextParts },
                config: { responseMimeType: "application/json" }
            });

            const result = JSON.parse(response.text);
            const modelMessage: FusionChatMessage = {
                sender: 'model',
                text: `English: ${result.englishPrompt}\n\n中文: ${result.chinesePrompt}`
            };
            setFusionChatHistory(prev => [...prev, modelMessage]);
            setFusionResult({
                englishPrompt: result.englishPrompt || fusionResult.englishPrompt,
                chinesePrompt: result.chinesePrompt || fusionResult.chinesePrompt
            });

        } catch (e: any) {
            console.error("Fusion chat failed:", e);
            const errorMessage: FusionChatMessage = { sender: 'model', text: `Error: ${e.message}` };
            setFusionChatHistory(prev => [...prev, errorMessage]);
        } finally {
            setIsProcessing(false);
        }
    };

    // 发送对话消息
    const handleSendMessage = async () => {
        if (!activeImageId || !activeSession || !userInput[activeImageId]?.trim()) return;
        if (!activeImage) return;

        const localUserInput = userInput[activeImageId];
        const userMessage: Message = { sender: 'user', text: localUserInput };

        // 更新聊天历史
        setSessions(prev => prev.map(s =>
            s.id === activeSessionId
                ? { ...s, images: s.images.map(img => img.id === activeImageId ? { ...img, chatHistory: [...img.chatHistory, userMessage] } : img) }
                : s
        ));
        setUserInput(prev => {
            const newInput = { ...prev };
            delete newInput[activeImageId];
            return newInput;
        });

        setIsProcessing(true);

        try {
            const ai = getAiInstance();
            const systemInstruction = getEffectiveInstruction(activeSession.experts, false);

            // 构建对话历史
            const historyParts = activeImage.chatHistory.map(msg => ({
                role: msg.sender === 'user' ? 'user' : 'model',
                parts: [{ text: msg.text }]
            }));
            historyParts.push({ role: 'user', parts: [{ text: localUserInput }] });

            const response = await ai.models.generateContent({
                model: textModel,
                contents: historyParts,
                config: { systemInstruction }
            });

            const modelMessage: Message = { sender: 'model', text: response.text };

            setSessions(prev => prev.map(s =>
                s.id === activeSessionId
                    ? { ...s, images: s.images.map(img => img.id === activeImageId ? { ...img, chatHistory: [...img.chatHistory, modelMessage] } : img) }
                    : s
            ));

        } catch (e: any) {
            console.error("Send message failed:", e);
            const errorMessage: Message = { sender: 'model', text: `Error: ${e.message}` };
            setSessions(prev => prev.map(s =>
                s.id === activeSessionId
                    ? { ...s, images: s.images.map(img => img.id === activeImageId ? { ...img, chatHistory: [...img.chatHistory, errorMessage] } : img) }
                    : s
            ));
        } finally {
            setIsProcessing(false);
        }
    };

    // ========== Render ==========

    // 渲染创建会话视图（初始上传界面）
    const renderCreateSessionView = () => (
        <div className="input-area create-session-view">
            {/* 专家选择器 */}
            <ExpertSelector
                selectedExperts={selectedExperts}
                onExpertChange={setSelectedExperts}
            />


            {/* 文件上传器 */}
            <FileUploader
                onFileSelect={(files) => handleBatchImageUpload(files as File[])}
                multiple
                openOnClick={false}
                onRequestPasteFocus={() => globalPasteTextareaRef.current?.focus()}
            >
                <div
                    className="uploader-content"
                    onDoubleClick={() => fileInputRef.current?.click()}
                    style={{ cursor: 'pointer' }}
                >
                    {/* 隐藏的文件输入 */}
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={(e) => {
                            const files = Array.from(e.target.files || []);
                            if (files.length > 0) {
                                handleBatchImageUpload(files);
                            }
                            e.target.value = '';
                        }}
                    />
                    <span>🖼️</span>
                    <p>2. {t('uploadPrompt') || '拖拽上传，双击选择文件，或粘贴图片'}</p>
                    <p style={{ fontSize: '0.85rem', opacity: 0.7, margin: '0.5rem 0' }}>
                        在上传区按 <strong>Ctrl+V</strong> 可粘贴截图
                    </p>
                    <div className="upload-buttons">
                        <button
                            type="button"
                            className="btn btn-secondary"
                            onClick={(e) => {
                                e.stopPropagation();
                                fileInputRef.current?.click();
                            }}
                        >
                            {t('uploadFromComputer') || '从电脑上传'}
                        </button>
                        <button type="button" className="btn btn-secondary">
                            {t('uploadFromUrl') || '从链接添加'}
                        </button>
                    </div>
                </div>
            </FileUploader>
        </div>
    );

    // 渲染暂存视图（已上传但未开始处理）- 采用创艺魔盒 2 的双栏布局
    const renderStagingView = () => {
        if (!activeSession) return null;

        return (
            <div className="staging-layout">
                <div className="staging-main">
                    <h3>{t('stagingTitle') || `已选择 ${activeSession.images.length} 张图片`}</h3>
                    <div className="batch-image-grid staging-grid">
                        {activeSession.images.map((img) => (
                            <div key={img.id} className="batch-image-item-staging">
                                <div className="batch-image-item" style={{ position: 'relative' }}>
                                    <img src={img.imageData.url} alt={img.imageData.name} />
                                    <div className="batch-item-overlay">
                                        <div className="batch-item-info">
                                            <p className="filename" title={img.imageData.name}>{img.imageData.name}</p>
                                        </div>
                                    </div>
                                    <button
                                        className="delete-img-btn"
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            handleDeleteImage(img.id);
                                        }}
                                        title={t('deleteImage') || '删除图片'}
                                        style={{
                                            position: 'absolute',
                                            top: '5px',
                                            right: '5px',
                                            zIndex: 100,
                                            width: '24px',
                                            height: '24px',
                                            borderRadius: '50%',
                                            background: 'rgba(0,0,0,0.6)',
                                            color: 'white',
                                            border: 'none',
                                            cursor: 'pointer',
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            fontSize: '16px',
                                            padding: 0
                                        }}
                                    >×</button>
                                </div>
                                <textarea
                                    className="pre-modification-input"
                                    placeholder={t('preModificationPlaceholder') || '预处理指令（可选）'}
                                    value={img.preModificationPrompt || ''}
                                    onChange={(e) => {
                                        setSessions(prev => prev.map(s =>
                                            s.id === activeSessionId
                                                ? { ...s, images: s.images.map(i => i.id === img.id ? { ...i, preModificationPrompt: e.target.value } : i) }
                                                : s
                                        ));
                                    }}
                                    rows={2}
                                />
                            </div>
                        ))}
                    </div>
                </div>
                <aside className="staging-sidebar">
                    {/* 批量模式切换 */}
                    <div className="mode-selector" style={{ marginBottom: '1rem' }}>
                        <ModeToggle
                            modes={[
                                { key: 'accurate', label: t('accurateMode') || '精确模式' },
                                { key: 'fast', label: t('fastMode') || '快速模式' }
                            ]}
                            activeMode={batchMode}
                            onModeChange={(mode) => setBatchMode(mode as BatchMode)}
                        />
                    </div>
                    {/* 追加图片上传器 */}
                    <FileUploader
                        onFileSelect={(files) => handleAppendImages(files as File[])}
                        multiple
                        openOnClick={false}
                        onRequestPasteFocus={() => globalPasteTextareaRef.current?.focus()}
                    >
                        <div className="uploader-content">
                            <span>➕</span>
                            <p>{t('appendImages') || '继续添加图片'}</p>
                            <p style={{ fontSize: '0.8rem', opacity: 0.7, margin: '0.5rem 0' }}>
                                拖拽、双击选择，或 Ctrl+V 粘贴
                            </p>
                            <div className="upload-buttons">
                                <button type="button" className="btn btn-secondary" onClick={(e) => {
                                    e.stopPropagation();
                                    (e.currentTarget.closest('label')?.querySelector('input[type="file"]') as HTMLInputElement)?.click();
                                }}>{t('uploadFromComputer') || '从电脑上传'}</button>
                            </div>
                        </div>
                    </FileUploader>
                    <button
                        className="primary process-all-btn"
                        onClick={handleStartProcessing}
                        disabled={isBatchProcessing}
                        style={{ width: '100%', padding: '12px', marginTop: '1rem' }}
                    >
                        {isBatchProcessing ? <Loader small /> : null}
                        {isBatchProcessing ? (t('processing') || '处理中...') : (t('startPrompting') || '开始反推提示词')}
                    </button>
                    {error && <p className="error-message">{error}</p>}
                </aside>
            </div>
        );
    };

    // 渲染处理结果视图 - 采用创艺魔盒 2 的水平标签页风格
    const renderResultsView = () => {
        if (!activeSession) return null;

        // 计算合并的提示词
        const mergedPrompts = (() => {
            const allEnglish: string[] = [];
            const allChinese: string[] = [];
            activeSession.images.forEach((img) => {
                if (img.status !== 'success' || img.chatHistory.length === 0) return;
                const lastModelMessage = [...img.chatHistory].reverse().find(msg => msg.sender === 'model');
                if (!lastModelMessage) return;
                try {
                    const prompts = JSON.parse(lastModelMessage.text);
                    if (Array.isArray(prompts)) {
                        prompts.forEach((p: any) => {
                            if (p.englishPrompt) allEnglish.push(p.englishPrompt);
                            if (p.chinesePrompt) allChinese.push(p.chinesePrompt);
                        });
                    }
                } catch { }
            });
            return {
                english: allEnglish.length > 0 ? allEnglish.join('\n\n---\n\n') : t('noEnglishPrompts') || 'No English prompts generated yet.',
                chinese: allChinese.length > 0 ? allChinese.join('\n\n---\n\n') : t('noChinesePrompts') || '暂无中文提示词。'
            };
        })();

        return (
            <>
                {isBatchProcessing && (
                    <div className="global-loader">
                        <Loader />
                        <p>{t('processing') || '处理中...'}</p>
                    </div>
                )}

                {/* 批量操作工具栏 - 始终可见 */}
                <div className="flex flex-wrap gap-2 items-center mb-3 p-3 rounded-md" style={{ background: 'var(--control-bg-color)' }}>
                    <span className="text-sm text-muted mr-2">批量操作:</span>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                            const success = await copyToClipboard(mergedPrompts.english);
                            if (success) {
                                setCopyFeedback('en');
                                setTimeout(() => setCopyFeedback(null), 1500);
                            }
                        }}
                    >
                        {copyFeedback === 'en' ? '✅ 已复制' : '📋 复制英文'}
                    </button>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={async () => {
                            const success = await copyToClipboard(mergedPrompts.chinese);
                            if (success) {
                                setCopyFeedback('zh');
                                setTimeout(() => setCopyFeedback(null), 1500);
                            }
                        }}
                    >
                        {copyFeedback === 'zh' ? '✅ 已复制' : '📋 复制中文'}
                    </button>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                            const content = `=== 英文提示词 ===\n\n${mergedPrompts.english}\n\n\n=== 中文提示词 ===\n\n${mergedPrompts.chinese}`;
                            const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `prompts_${new Date().toISOString().slice(0, 10)}.txt`;
                            a.click();
                            URL.revokeObjectURL(url);
                        }}
                    >
                        💾 导出TXT
                    </button>
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={() => {
                            const data = {
                                exportTime: new Date().toISOString(),
                                sessionId: activeSession?.id,
                                imageCount: activeSession?.images.length,
                                prompts: activeSession?.images.map(img => {
                                    if (img.status !== 'success' || img.chatHistory.length === 0) return null;
                                    const lastModelMessage = [...img.chatHistory].reverse().find(msg => msg.sender === 'model');
                                    if (!lastModelMessage) return null;
                                    try {
                                        return {
                                            imageName: img.imageData.name,
                                            prompts: JSON.parse(lastModelMessage.text)
                                        };
                                    } catch { return null; }
                                }).filter(Boolean)
                            };
                            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
                            const url = URL.createObjectURL(blob);
                            const a = document.createElement('a');
                            a.href = url;
                            a.download = `prompts_${new Date().toISOString().slice(0, 10)}.json`;
                            a.click();
                            URL.revokeObjectURL(url);
                        }}
                    >
                        📁 导出JSON
                    </button>
                </div>

                {/* 水平标签页 */}
                <div className="batch-prompt-tabs-container">
                    <div className="batch-prompt-tabs">
                        {activeSession.images.map((img) => (
                            <div
                                key={img.id}
                                onClick={() => !isBatchProcessing && setActiveImageId(img.id)}
                                className={`tab-btn ${img.id === activeImageId ? 'active' : ''} ${isBatchProcessing ? 'disabled' : ''}`}
                                role="button"
                                tabIndex={isBatchProcessing ? -1 : 0}
                            >
                                <img src={img.imageData.url} alt="thumbnail" />
                                <span className="tab-filename" title={img.imageData.name}>{img.imageData.name}</span>
                                <div className="status-indicator">
                                    {img.status === 'processing' && <Loader small />}
                                    {img.status === 'success' && '✓'}
                                    {img.status === 'error' && '!'}
                                </div>
                                {(img.status === 'success' || img.status === 'error') && (
                                    <button
                                        className="retry-btn"
                                        onClick={(e) => { e.stopPropagation(); handleRetryImage(img.id); }}
                                        disabled={isBatchProcessing}
                                        title={t('reGenerate') || '重新生成'}
                                    >🔄</button>
                                )}
                                <button
                                    className="delete-img-btn-tab"
                                    onClick={(e) => { e.stopPropagation(); handleDeleteImage(img.id); }}
                                    title={t('deleteImage') || '删除图片'}
                                    style={{
                                        marginLeft: '8px',
                                        background: 'transparent',
                                        border: 'none',
                                        color: 'var(--text-color)',
                                        opacity: 0.6,
                                        cursor: 'pointer',
                                        fontSize: '16px',
                                        padding: '0 4px',
                                        lineHeight: 1
                                    }}
                                >×</button>
                            </div>
                        ))}
                        <button
                            onClick={() => setActiveImageId('merged')}
                            className={`tab-btn tab-btn-merged ${'merged' === activeImageId ? 'active' : ''}`}
                            disabled={isBatchProcessing}
                        >
                            {t('mergedPrompts') || '合并提示词'}
                        </button>
                    </div>
                </div>

                {/* 内容区域 */}
                {activeImageId === 'merged' ? (
                    <div className="merged-prompt-view">
                        <PromptDisplay title={t('allEnglishPrompts') || 'All English Prompts'} text={mergedPrompts.english} />
                        <PromptDisplay title={t('allChinesePrompts') || 'All Chinese Prompts'} text={mergedPrompts.chinese} />
                    </div>
                ) : activeImage ? (
                    <div className="image-chat-content">
                        <div className="image-preview-wrapper-small">
                            <img src={activeImage.imageData.url} alt="Uploaded preview" />
                        </div>
                        <div className="output-area">
                            <div className="chat-container" ref={chatContainerRef}>
                                {activeImage.chatHistory.map((msg, index) => {
                                    if (msg.sender === 'user') {
                                        return <div key={index} className="chat-message user"><pre>{msg.text}</pre></div>;
                                    }
                                    try {
                                        const prompts = JSON.parse(msg.text);
                                        if (Array.isArray(prompts) && prompts.length > 0) {
                                            return (
                                                <div key={index} className="chat-message model prompt-wrapper">
                                                    <PromptTabs prompts={prompts} />
                                                </div>
                                            );
                                        }
                                    } catch { }
                                    return <div key={index} className="chat-message model"><pre>{msg.text}</pre></div>;
                                })}
                                {isProcessing && <div className="chat-message model"><Loader /></div>}
                                {activeImage.status === 'error' && <p className="error-message">{activeImage.error}</p>}
                            </div>
                            {error && <p className="error-message">{error}</p>}
                            {/* 对话输入框 */}
                            {activeImage.status === 'success' && (
                                <div className="chat-input">
                                    <input
                                        type="text"
                                        value={userInput[activeImageId] || ''}
                                        onChange={(e) => setUserInput(prev => ({ ...prev, [activeImageId]: e.target.value }))}
                                        placeholder={t('chatPlaceholder') || '输入修改指令...'}
                                        onKeyPress={(e) => e.key === 'Enter' && !isProcessing && handleSendMessage()}
                                        disabled={isProcessing}
                                    />
                                    <button
                                        className="btn btn-primary"
                                        onClick={handleSendMessage}
                                        disabled={isProcessing || !userInput[activeImageId]?.trim()}
                                    >
                                        {t('sendMessage') || '发送'}
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
                ) : <p>{t('selectImageToView') || 'Select an image to view its prompts.'}</p>}
            </>
        );
    };

    // 渲染主内容
    const renderContent = () => {
        // 融合模式
        if (fusionMode === 'fusion') {
            return (
                <FusionWorkspace
                    fusionItems={fusionItems}
                    fusionResult={fusionResult}
                    fusionChatHistory={fusionChatHistory}
                    fusionChatInput={fusionChatInput}
                    extraInstruction={extraInstruction}
                    onAddImages={handleAddFusionImages}
                    onUpdateItem={handleUpdateFusionItem}
                    onRemoveItem={handleRemoveFusionItem}
                    onFusionGenerate={handleFusionGenerate}
                    onFusionChat={handleFusionChat}
                    onChatInputChange={setFusionChatInput}
                    onExtraInstructionChange={setExtraInstruction}
                    isProcessing={isProcessing}
                    t={t}
                    onPaste={handleGlobalPaste}
                />
            );
        }

        // 批量模式
        if (!activeSession) {
            return renderCreateSessionView();
        }

        if (activeSession.status === 'staging') {
            return renderStagingView();
        }

        return renderResultsView();
    };

    return (
        <div
            className="tool-container image-to-prompt-layout"
            tabIndex={-1}
            onClick={(e) => {
                const target = e.target as HTMLElement;
                const inPasteZone = target.closest('[data-paste-zone="image-to-prompt"]');
                if (!inPasteZone) return;

                // 只在没有选中文本的情况下聚焦隐藏的 textarea
                const selection = window.getSelection();
                const hasTextSelection = selection && selection.toString().length > 0;
                if (hasTextSelection) return;

                globalPasteTextareaRef.current?.focus();
            }}
        >
            {/* 全局隐藏的 textarea，用于接收粘贴事件 */}
            <textarea
                ref={globalPasteTextareaRef}
                onPaste={handleGlobalPaste}
                style={{ position: 'absolute', left: '-9999px', top: 0, width: '1px', height: '1px', opacity: 0 }}
                aria-hidden="true"
            />

            {/* 左侧历史面板 */}
            <HistoryPanel
                sessions={sessions}
                activeSessionId={activeSessionId}
                onSelectSession={handleSelectSession}
                onDeleteSession={handleDeleteSession}
                onNewSession={handleNewSession}
                t={t}
            />

            {/* 主内容区域 */}
            <div className="main-content">
                {/* 工具标题 */}
                <ToolHeader
                    title={t('promptTitle') || '反推提示词 (Image to Prompt)'}
                    description={t('promptDescription') || '支持批量上传图片，对每张图的提示词进行独立的多轮对话修改'}
                    onReset={activeSession ? () => handleDeleteSession(activeSessionId!) : undefined}
                    actions={
                        <>
                            {/* 模式切换：批量 / 融合 */}
                            <ModeToggle
                                modes={[
                                    { key: 'batch', label: t('batchMode') || '批量反推' },
                                    { key: 'fusion', label: t('fusionMode') || '灵感融合' }
                                ]}
                                activeMode={fusionMode}
                                onModeChange={(mode) => setFusionMode(mode as FusionMode)}
                            />
                        </>
                    }
                />

                {/* 功能更新提示 */}
                {showDeprecationWarning && (
                    <div style={{
                        background: 'linear-gradient(135deg, rgba(34, 197, 94, 0.15), rgba(16, 185, 129, 0.1))',
                        border: '2px solid rgba(34, 197, 94, 0.5)',
                        borderRadius: '16px',
                        padding: '24px 32px',
                        marginBottom: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        gap: '24px',
                        position: 'relative'
                    }}>
                        <span style={{ fontSize: '48px' }}>✨</span>
                        <div style={{ flex: 1 }}>
                            <div style={{ color: '#22c55e', fontWeight: 700, fontSize: '20px', marginBottom: '8px' }}>
                                功能已更新
                            </div>
                            <div style={{ color: 'rgba(34, 197, 94, 0.9)', fontSize: '14px', lineHeight: 1.6 }}>
                                此功能已合并「<strong>创艺魔盒</strong>」最新版本，支持灵感融合等新功能。<br /><br />
                                您也可以使用顶部工具栏这个工具旁边的「<strong>AI 图片识别</strong>」工具。<br />
                                1. 支持自定义选择或者输入识别（反推）指令、识别结果管理、云端同步、对话、历史记录、一键创新等更多高级功能。<br />
                                2. 不仅仅用于反推提示词，还可以进行图片分类（最好是根据自己需要自定义分类的类别），方便总结图片。
                            </div>
                        </div>
                        <button
                            onClick={() => {
                                setShowDeprecationWarning(false);
                                try {
                                    localStorage.setItem(STORAGE_KEYS.HIDE_DEPRECATION_WARNING, 'true');
                                } catch { }
                            }}
                            style={{
                                position: 'absolute',
                                top: '12px',
                                right: '12px',
                                background: 'rgba(34, 197, 94, 0.2)',
                                border: '1px solid rgba(34, 197, 94, 0.4)',
                                borderRadius: '6px',
                                color: '#22c55e',
                                padding: '6px 12px',
                                cursor: 'pointer',
                                fontSize: '12px',
                                fontWeight: 500
                            }}
                        >
                            知道了
                        </button>
                    </div>
                )}

                {/* 错误提示 */}
                {error && (
                    <div style={{
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        borderRadius: '8px',
                        padding: '12px 16px',
                        marginBottom: '16px',
                        color: '#ef4444'
                    }}>
                        {error}
                        <button
                            onClick={() => setError(null)}
                            style={{ marginLeft: '12px', background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer' }}
                        >
                            ×
                        </button>
                    </div>
                )}

                {/* 主内容 */}
                {renderContent()}
            </div>

            {/* 系统指令查看模态框 */}
            {showSystemInstructionModal && (
                <div
                    className="modal-overlay"
                    onClick={() => setShowSystemInstructionModal(false)}
                    style={{
                        position: 'fixed',
                        inset: 0,
                        background: 'rgba(0,0,0,0.7)',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        zIndex: 10000
                    }}
                >
                    <div
                        className="modal-content"
                        onClick={(e) => e.stopPropagation()}
                        style={{
                            background: 'var(--secondary-bg-color)',
                            borderRadius: '16px',
                            padding: '24px',
                            maxWidth: '800px',
                            maxHeight: '80vh',
                            overflow: 'auto'
                        }}
                    >
                        <h3 style={{ marginBottom: '16px' }}>{t('systemInstruction') || '系统指令'}</h3>
                        <pre style={{
                            whiteSpace: 'pre-wrap',
                            fontSize: '0.85rem',
                            background: 'var(--control-bg-color)',
                            padding: '16px',
                            borderRadius: '8px',
                            maxHeight: '400px',
                            overflow: 'auto'
                        }}>
                            {getEffectiveInstruction(selectedExperts, false)}
                        </pre>
                        <div style={{ marginTop: '16px', display: 'flex', gap: '8px', justifyContent: 'flex-end' }}>
                            <button
                                className="btn btn-secondary"
                                onClick={() => copyToClipboard(getEffectiveInstruction(selectedExperts, false))}
                            >
                                {t('copy') || '复制'}
                            </button>
                            <button
                                className="btn btn-primary"
                                onClick={() => setShowSystemInstructionModal(false)}
                            >
                                {t('close') || '关闭'}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImageToPromptApp;
