import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { LanguageSelector } from './LanguageSelector';
import { allLanguages } from './constants';
import { fetchImageBlob, processImageUrl as normalizeImageUrl, decodeHtmlEntities } from '@/apps/ai-image-recognition/utils';
import { useAuth } from '../../contexts/AuthContext';
import {
    debouncedSaveProject,
    getOrCreateSharedProject,
    Project
} from '../../services/projectService';
import ProjectPanel from '../../components/ProjectPanel';

interface InstantTranslateToolProps {
    targetLanguage: string;
    setTargetLanguage?: (lang: string) => void;
    getAiInstance: () => GoogleGenAI;
    t: (key: string) => string;
    model: string;
    onSwitchToBatch?: (files?: File[], urls?: string[]) => void;
}

enum TranslationStatus {
    IDLE = 'IDLE',
    TRANSLATING = 'TRANSLATING',
    COMPLETED = 'COMPLETED',
    ERROR = 'ERROR',
    OCR_PROCESSING = 'OCR_PROCESSING'
}

// Debounce hook
function useDebounce<T>(value: T, delay: number): T {
    const [debouncedValue, setDebouncedValue] = useState<T>(value);

    useEffect(() => {
        const handler = setTimeout(() => {
            setDebouncedValue(value);
        }, delay);

        return () => clearTimeout(handler);
    }, [value, delay]);

    return debouncedValue;
}

export const InstantTranslateTool: React.FC<InstantTranslateToolProps> = ({
    targetLanguage,
    setTargetLanguage,
    getAiInstance,
    t,
    model,
    onSwitchToBatch
}) => {
    const [inputText, setInputText] = useState('');
    const [outputText, setOutputText] = useState('');
    const [sourceLang, setSourceLang] = useState('auto'); // auto-detect by default
    const [status, setStatus] = useState<TranslationStatus>(TranslationStatus.IDLE);
    const [isDragging, setIsDragging] = useState(false);
    const [copied, setCopied] = useState(false);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const debouncedInputText = useDebounce(inputText, 800);
    const { user } = useAuth();

    // 最后处理的图片 URL（用于历史记录缩略图）
    const [lastImageUrl, setLastImageUrl] = useState<string | null>(null);
    // 是否来自 OCR
    const [isFromOCR, setIsFromOCR] = useState(false);
    // 项目管理面板
    const [showProjectPanel, setShowProjectPanel] = useState(false);
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    // 上次保存的内容（用于避免重复保存）
    const lastSavedContentRef = useRef<string>('');
    // 自动保存定时器
    const autoSaveTimerRef = useRef<NodeJS.Timeout | null>(null);
    // 历史记录展开状态
    const [showHistory, setShowHistory] = useState(false);
    // 历史记录数据
    const [historyItems, setHistoryItems] = useState<any[]>([]);
    // 历史记录加载状态
    const [historyLoading, setHistoryLoading] = useState(false);

    // 加载历史记录
    const loadHistory = useCallback(async () => {
        if (!user?.uid) {
            return;
        }
        setHistoryLoading(true);
        try {
            const project = await getOrCreateSharedProject(
                user.uid,
                'smart-translate-instant',
                '即时翻译记录'
            );
            const items = project.currentState?.items || [];
            setHistoryItems(items);
        } catch (err) {
            console.error('[History] Failed to load history:', err);
        } finally {
            setHistoryLoading(false);
        }
    }, [user?.uid]);

    // 展开时加载历史（只有本地没有记录时才从服务器加载）
    useEffect(() => {
        if (showHistory && historyItems.length === 0) {
            loadHistory();
        }
    }, [showHistory]);

    // 用 ref 保存最新的状态值，避免 setTimeout 闭包问题
    const latestStateRef = useRef({
        inputText: '',
        outputText: '',
        targetLanguage: '',
        sourceLang: '',
        isFromOCR: false,
        lastImageUrl: null as string | null,
        userId: ''
    });

    // 更新 ref 中的值
    useEffect(() => {
        latestStateRef.current = {
            inputText,
            outputText,
            targetLanguage,
            sourceLang,
            isFromOCR,
            lastImageUrl,
            userId: user?.uid || ''
        };
    }, [inputText, outputText, targetLanguage, sourceLang, isFromOCR, lastImageUrl, user?.uid]);

    // 自动保存逻辑：用户停止输入 5 秒后保存
    useEffect(() => {
        // 清除之前的定时器
        if (autoSaveTimerRef.current) {
            clearTimeout(autoSaveTimerRef.current);
            autoSaveTimerRef.current = null;
        }

        // 只在翻译完成且有内容时启动保存定时器
        if (status !== TranslationStatus.COMPLETED || !inputText.trim() || !outputText.trim() || !user?.uid) {
            return;
        }

        // 用于标识的内容指纹
        const contentFingerprint = `${inputText}|||${outputText}|||${targetLanguage}`;

        // 如果内容没变，不需要保存
        if (contentFingerprint === lastSavedContentRef.current) {
            return;
        }


        // 5 秒后自动保存
        autoSaveTimerRef.current = setTimeout(async () => {
            // 使用 ref 获取最新的状态值（避免闭包问题）
            const state = latestStateRef.current;

            if (!state.userId || !state.inputText.trim() || !state.outputText.trim()) {
                return;
            }

            const currentFingerprint = `${state.inputText}|||${state.outputText}|||${state.targetLanguage}`;
            if (currentFingerprint === lastSavedContentRef.current) {
                return;
            }

            // 创建新的翻译记录
            const newItem = {
                id: Date.now().toString(),
                type: state.isFromOCR ? 'ocr' : 'text',
                originalText: state.inputText,
                translatedText: state.outputText,
                sourceLang: state.sourceLang,
                targetLang: state.targetLanguage,
                imageUrl: state.lastImageUrl,
                timestamp: Date.now()
            };

            // 使用本地 historyItems（而不是从服务器获取）
            const updatedItems = [newItem, ...historyItems].slice(0, 100);

            // 1. 立即更新本地状态（用户立即看到）
            setHistoryItems(updatedItems);

            // 2. 记录已保存的内容指纹
            lastSavedContentRef.current = currentFingerprint;

            // 3. 重置 OCR 标志
            setIsFromOCR(false);
            setLastImageUrl(null);

            // 4. 后台保存到 Firestore（不阻塞，不等待）
            try {
                const sharedProject = await getOrCreateSharedProject(
                    state.userId,
                    'smart-translate-instant',
                    '即时翻译记录'
                );

                debouncedSaveProject(state.userId, 'smart-translate-instant', sharedProject.id, {
                    items: updatedItems
                }, {
                    preview: state.outputText.slice(0, 100),
                    itemCount: updatedItems.length
                });
            } catch (err) {
                console.error('[History] Failed to save to Firestore:', err);
            }
        }, 5000); // 5 秒后保存

        return () => {
            if (autoSaveTimerRef.current) {
                clearTimeout(autoSaveTimerRef.current);
            }
        };
    }, [status, inputText, outputText, targetLanguage, user?.uid, historyItems]);

    // Swap languages
    const handleSwapLanguages = () => {
        if (sourceLang === 'auto') {
            // If source is auto, just swap to target as source
            setSourceLang(targetLanguage);
            if (setTargetLanguage) {
                setTargetLanguage(allLanguages.find(l => l.code === 'en')?.code || 'en');
            }
        } else {
            // Normal swap
            const temp = sourceLang;
            setSourceLang(targetLanguage);
            if (setTargetLanguage) {
                setTargetLanguage(temp);
            }
        }

        // Also swap the text if there's output
        if (outputText) {
            setInputText(outputText);
            setOutputText(inputText);
        }
    };

    // OCR: Extract text from image
    const extractTextFromImage = async (file: File): Promise<string> => {
        try {
            const ai = getAiInstance();

            // Convert file to base64
            const base64 = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onloadend = () => {
                    const result = reader.result as string;
                    const base64String = result.replace(/^data:.+;base64,/, '');
                    resolve(base64String);
                };
                reader.onerror = reject;
                reader.readAsDataURL(file);
            });

            const response = await ai.models.generateContent({
                model,
                contents: {
                    role: 'user',
                    parts: [
                        {
                            inlineData: {
                                data: base64,
                                mimeType: file.type,
                            },
                        },
                        {
                            text: "Please transcribe all the text found in this image exactly as it appears. Output ONLY the text found. Do not add any descriptions or conversational text. If no text is found, return an empty string."
                        }
                    ]
                }
            });

            return response.text || "";
        } catch (error) {
            console.error("OCR Error:", error);
            throw new Error("无法识别图片中的文字，请重试。");
        }
    };

    // Stream translation
    const performTranslation = useCallback(async (text: string, targetLang: string) => {
        if (!text.trim()) {
            setOutputText('');
            setStatus(TranslationStatus.IDLE);
            return;
        }

        setStatus(TranslationStatus.TRANSLATING);
        setOutputText('');

        try {
            const ai = getAiInstance();
            const targetLangName = allLanguages.find(l => l.code === targetLang)?.name || targetLang;

            let systemInstruction = `You are a professional, high - accuracy translation engine similar to DeepL. 
Your goal is to provide fluent, natural - sounding translations that preserve the nuance and tone of the original text.

    Rules:
1. Translate the input text to ${targetLangName}.
2. Do NOT provide explanations, notes, or pronunciation guides. 
3. Output ONLY the translated text.
4. If the input is technically code or a proper noun that shouldn't be translated, keep it as is.`;

            if (targetLang === 'smart_auto') {
                systemInstruction = `You are a professional, high-accuracy translation engine similar to DeepL.
Your goal is to provide fluent, natural-sounding translations that preserve the nuance and tone of the original text.

Rules:
1. If the input text is in English, translate it to Chinese (Simplified).
2. If the input text is NOT in English, translate it to English.
3. Do NOT provide explanations, notes, or pronunciation guides. 
4. Output ONLY the translated text.
5. If the input is technically code or a proper noun that shouldn't be translated, keep it as is.`;
            }

            const responseStream = await ai.models.generateContentStream({
                model,
                contents: text,
                config: {
                    systemInstruction: systemInstruction,
                    temperature: 0.3,
                }
            });

            let fullOutput = '';
            for await (const chunk of responseStream) {
                if (chunk.text) {
                    fullOutput += chunk.text;
                    setOutputText(prev => prev + chunk.text);
                }
            }

            setStatus(TranslationStatus.COMPLETED);
            // 注意：翻译记录的保存由独立的自动保存 useEffect 处理（用户停止输入5秒后保存）
        } catch (error: any) {
            console.error("Translation failed", error);
            setStatus(TranslationStatus.ERROR);
            setOutputText("翻译出错。请检查您的网络连接或稍后重试。");
        }
    }, [getAiInstance, model, allLanguages, user]);

    // Auto-translate when text changes
    useEffect(() => {
        if (status === TranslationStatus.OCR_PROCESSING) {
            return; // Don't translate while OCR is processing
        }
        performTranslation(debouncedInputText, targetLanguage);
    }, [debouncedInputText, targetLanguage]);

    // Handle image upload
    const processImage = async (file: File) => {
        if (!file.type.startsWith('image/')) {
            alert('请上传有效的图片文件');
            return;
        }

        setStatus(TranslationStatus.OCR_PROCESSING);
        try {
            const extractedText = await extractTextFromImage(file);
            if (extractedText) {
                setInputText(extractedText);
                setIsFromOCR(true);  // 标记来自 OCR
                setStatus(TranslationStatus.IDLE);
                // Translation will trigger automatically via useEffect
            } else {
                alert("未能识别出图片中的文字。");
                setStatus(TranslationStatus.IDLE);
            }
        } catch (error) {
            console.error(error);
            alert("识别图片时出错，请重试。");
            setStatus(TranslationStatus.IDLE);
        } finally {
            if (fileInputRef.current) {
                fileInputRef.current.value = '';
            }
        }
    };

    // Drag and drop handlers
    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const files = e.dataTransfer.files;
        if (!files || files.length === 0) return;

        // 获取所有图片文件
        const imageFiles: File[] = [];
        for (let i = 0; i < files.length; i++) {
            if (files[i].type.startsWith('image/')) {
                imageFiles.push(files[i]);
            }
        }

        // 如果有多个图片，跳转到批量模式
        if (imageFiles.length > 1 && onSwitchToBatch) {
            onSwitchToBatch(imageFiles, undefined);
            return;
        }

        // 单个图片则在本地处理
        if (imageFiles.length === 1) {
            processImage(imageFiles[0]);
        }
    };

    // 从图片URL下载并处理
    const processImageUrl = async (url: string) => {
        setStatus(TranslationStatus.OCR_PROCESSING);
        try {
            // 先解码 HTML 实体（如 &amp; -> &）
            const decodedUrl = decodeHtmlEntities(url);
            // 再规范化 URL（支持 Gyazo, Imgur, Google Drive 等）
            const normalizedUrl = normalizeImageUrl(decodedUrl);
            const { blob, mimeType } = await fetchImageBlob(normalizedUrl);
            const urlExtMatch = url.match(/\.(jpeg|jpg|gif|png|webp|bmp|tiff|svg)/i);
            const extFromUrl = urlExtMatch ? urlExtMatch[1].toLowerCase() : null;
            const safeMime = mimeType && mimeType.startsWith('image/')
                ? mimeType
                : extFromUrl
                    ? (extFromUrl === 'jpg' ? 'image/jpeg' : `image/${extFromUrl}`)
                    : (blob.type && blob.type.startsWith('image/') ? blob.type : 'image/png');
            const file = new File([blob], `pasted-image.${safeMime.split('/')[1] || 'png'}`, { type: safeMime });

            // 进行 OCR
            const extractedText = await extractTextFromImage(file);
            if (extractedText) {
                setInputText(extractedText);
                setIsFromOCR(true);  // 标记来自 OCR
                setLastImageUrl(normalizedUrl);  // 保存图片 URL 用于缩略图
                setStatus(TranslationStatus.IDLE);
            } else {
                alert("未能识别出图片中的文字。");
                setStatus(TranslationStatus.IDLE);
            }
        } catch (error) {
            console.error('Error processing image URL:', error);
            alert("无法从链接获取图片，可能是跨域限制或链接已失效。请直接粘贴图片文件。");
            setStatus(TranslationStatus.IDLE);
        }
    };

    // 检测是否为图片URL
    const isImageUrl = (text: string): boolean => {
        const trimmed = text.trim();
        // 检查是否为 URL
        if (!/^https?:\/\/[^\s]+$/.test(trimmed)) return false;
        // 检查是否有图片扩展名
        const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg|tiff|ico)(\?.*)?$/i;
        // 常见图片托管服务
        const imageHosts = /(gyazo\.com|imgur\.com|i\.imgur\.com|googleusercontent\.com|drive\.google\.com|lh[0-9]+\.googleusercontent\.com|pbs\.twimg\.com|cdn\.discordapp\.com|media\.discordapp\.net|i\.redd\.it|preview\.redd\.it|i\.pinimg\.com|images\.unsplash\.com|fbcdn\.net|scontent)/i;
        // Google Drive 分享链接
        const googleDrivePattern = /drive\.google\.com\/.*\/d\/([a-zA-Z0-9_-]+)/i;
        // 图片 CDN 常见路径
        const cdnPatterns = /(\/image\/|\/images\/|\/img\/|\/photo\/|\/photos\/|\/uploads\/)/i;
        return imageExtensions.test(trimmed) || imageHosts.test(trimmed) || googleDrivePattern.test(trimmed) || cdnPatterns.test(trimmed);
    };

    // Paste handler
    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const items = e.clipboardData.items;

        // 首先检查是否有纯文本内容
        // 如果有纯文本，且文本不是图片URL/=IMAGE公式，就让文本正常粘贴
        const plainText = e.clipboardData.getData('text/plain');
        if (plainText && plainText.trim()) {
            const lines = plainText.split(/\n+/).map(l => l.trim()).filter(l => l);
            // 检查是否所有行都是图片 URL 或 =IMAGE 公式
            const isAllImageUrls = lines.length > 0 && lines.every(line => {
                const match = line.match(/=IMAGE\s*\(\s*"([^"]+)"/i);
                if (match) return true;
                return isImageUrl(line);
            });
            // 如果不是图片 URL，就让文本正常粘贴，不拦截
            if (!isAllImageUrls) {
                // 让浏览器默认处理文本粘贴
                return;
            }
        }

        // 1. 检查是否有多个图片文件
        const imageFiles: File[] = [];
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            if (item.type.startsWith('image/')) {
                const file = item.getAsFile();
                if (file) {
                    imageFiles.push(file);
                }
            }
        }

        // 如果有多个图片，跳转到批量模式
        if (imageFiles.length > 1 && onSwitchToBatch) {
            e.preventDefault();
            onSwitchToBatch(imageFiles, undefined);
            return;
        }

        // 单个图片则在本地处理
        if (imageFiles.length === 1) {
            e.preventDefault();
            processImage(imageFiles[0]);
            return;
        }

        // 2. 检查 HTML 内容（Google Sheets 公式、img 标签等）
        const htmlData = e.clipboardData.getData('text/html');
        if (htmlData) {
            const extractedUrls: string[] = [];
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlData, 'text/html');

            // 从 img 标签提取 src
            doc.querySelectorAll('img').forEach(img => {
                const src = img.getAttribute('src');
                if (src && src.startsWith('http')) {
                    extractedUrls.push(src);
                }
            });

            // 从 data-sheets-formula 提取 =IMAGE() 公式中的链接
            doc.querySelectorAll('[data-sheets-formula]').forEach(cell => {
                const formula = cell.getAttribute('data-sheets-formula');
                if (formula) {
                    const match = formula.match(/=IMAGE\s*\(\s*"([^"]+)"/i);
                    if (match && match[1]) {
                        extractedUrls.push(match[1]);
                    }
                }
            });

            // 从 data-sheets-value 提取链接
            doc.querySelectorAll('[data-sheets-value]').forEach(cell => {
                try {
                    const valueAttr = cell.getAttribute('data-sheets-value');
                    if (valueAttr) {
                        const valueObj = JSON.parse(valueAttr);
                        const searchValue = (obj: any): void => {
                            if (typeof obj === 'string') {
                                // 检查 =IMAGE 公式
                                const match = obj.match(/=IMAGE\s*\(\s*"([^"]+)"/i);
                                if (match && match[1]) {
                                    extractedUrls.push(match[1]);
                                }
                                // 检查直接 URL
                                if (/^https?:\/\//.test(obj)) {
                                    extractedUrls.push(obj);
                                }
                            } else if (typeof obj === 'object' && obj !== null) {
                                Object.values(obj).forEach(v => searchValue(v));
                            }
                        };
                        searchValue(valueObj);
                    }
                } catch (err) {
                    // 忽略 JSON 解析错误
                }
            });

            // 如果提取到多个图片链接，跳转到批量模式
            if (extractedUrls.length > 1 && onSwitchToBatch) {
                e.preventDefault();
                e.stopPropagation(); // 阻止事件冒泡到全局 handlePaste
                onSwitchToBatch(undefined, extractedUrls);
                return;
            }

            // 单个链接则在本地处理
            if (extractedUrls.length === 1) {
                e.preventDefault();
                processImageUrl(extractedUrls[0]);
                return;
            }
        }

        // 3. 检查是否为图片链接（或多个链接）
        const text = e.clipboardData.getData('text/plain');
        if (text) {
            const lines = text.split(/\n+/).map(l => l.trim()).filter(l => l);

            // 提取图片链接和 =IMAGE 公式
            const imageUrls: string[] = [];
            lines.forEach(line => {
                // 检查 =IMAGE 公式
                const match = line.match(/=IMAGE\s*\(\s*"([^"]+)"/i);
                if (match && match[1]) {
                    imageUrls.push(match[1]);
                } else if (isImageUrl(line)) {
                    imageUrls.push(line);
                }
            });

            // 如果有多个图片链接，跳转到批量模式
            if (imageUrls.length > 1 && onSwitchToBatch) {
                e.preventDefault();
                e.stopPropagation(); // 阻止事件冒泡到全局 handlePaste
                onSwitchToBatch(undefined, imageUrls);
                return;
            }

            // 单个图片链接则在本地处理
            if (imageUrls.length === 1) {
                e.preventDefault();
                processImageUrl(imageUrls[0]);
                return;
            }
        }

        // 4. 否则正常粘贴文本
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const clearInput = () => {
        setInputText('');
        setOutputText('');
        setStatus(TranslationStatus.IDLE);
    };

    return (
        <div className="deepl-layout">
            {/* Language Bar */}
            <div className="deepl-header">
                <div className="lang-side source">
                    <LanguageSelector
                        value={sourceLang}
                        onChange={setSourceLang}
                        t={t}
                        includeAuto={true}
                    />
                </div>

                <button
                    className="swap-btn tooltip-bottom"
                    onClick={handleSwapLanguages}
                    data-tip="交换语言"
                >
                    ⇄
                </button>

                <div className="lang-side target">
                    {setTargetLanguage ? (
                        <LanguageSelector
                            value={targetLanguage}
                            onChange={setTargetLanguage}
                            t={t}
                            includeAuto={false}
                        />
                    ) : (
                        <span className="lang-static">{targetLanguage}</span>
                    )}
                </div>
            </div>

            {/* Translation Workspace */}
            <div className="deepl-workspace">
                {/* Input Column */}
                <div
                    className="workspace-column source-column"
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                >
                    {/* Drag Overlay */}
                    {isDragging && (
                        <div className="drag-overlay">
                            <svg className="drag-icon" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" />
                            </svg>
                            <span>释放以识别文字</span>
                        </div>
                    )}

                    {/* OCR Loading */}
                    {status === TranslationStatus.OCR_PROCESSING && (
                        <div className="loading-overlay">
                            <div className="loader small"></div>
                            <span>正在从图片提取文字...</span>
                        </div>
                    )}

                    <div className="textarea-wrapper">
                        <textarea
                            className="deepl-textarea source"
                            placeholder="在此输入翻译文本，或粘贴图片/图片链接..."
                            value={inputText}
                            onChange={(e) => setInputText(e.target.value)}
                            onPaste={handlePaste}
                            spellCheck={false}
                        />

                        <div className="column-footer">
                            <input
                                type="file"
                                ref={fileInputRef}
                                className="hidden-file-input"
                                accept="image/*"
                                onChange={(e) => {
                                    const file = e.target.files?.[0];
                                    if (file) processImage(file);
                                }}
                            />

                            <button
                                className="icon-btn tooltip-bottom"
                                onClick={() => fileInputRef.current?.click()}
                                data-tip="上传图片识别文字"
                            >
                                📷
                            </button>

                            {inputText && (
                                <>
                                    <button data-tip="清空文本" className="icon-btn tooltip-bottom" onClick={clearInput} >
                                        ✕
                                    </button>
                                    <button className="icon-btn tooltip-bottom" onClick={() => handleCopy(inputText)} data-tip="复制原文">
                                        📋
                                    </button>
                                </>
                            )}
                        </div>
                    </div>
                </div>

                {/* Output Column */}
                <div className="workspace-column target-column">
                    {/* Progress bar */}
                    {status === TranslationStatus.TRANSLATING && (
                        <div className="translation-progress">
                            <div className="progress-bar"></div>
                        </div>
                    )}

                    <div className="textarea-wrapper">
                        <div className="deepl-textarea target">
                            {outputText || (
                                <span className="placeholder-text">
                                    {status === TranslationStatus.TRANSLATING ? "正在翻译..." : "译文"}
                                </span>
                            )}
                        </div>

                        <div className="column-footer">
                            {outputText && (
                                <button
                                    className={`icon-btn copy-btn ${copied ? 'copied' : ''} tooltip-bottom`}
                                    onClick={() => handleCopy(outputText)}
                                    data-tip="复制译文"
                                >
                                    {copied ? '✓' : '📋'}
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            </div>

            {/* Footer */}
            <div className="deepl-footer">
                <span>字符数：{inputText.length}</span>
                <button
                    onClick={() => setShowHistory(!showHistory)}
                    className="icon-btn mx-2"
                    title={showHistory ? '收起历史记录' : '展开历史记录'}
                >
                    {showHistory ? '▲' : '▼'} 📝
                </button>
                <span>由 {model} 提供支持</span>
            </div>

            {/* 历史记录折叠区域 */}
            {showHistory && (
                <div className="history-panel custom-scrollbar">
                    <div className="history-header">
                        <span className="history-title">
                            翻译历史 ({historyItems.length})
                        </span>
                        {historyItems.length > 0 && (
                            <button
                                onClick={() => setShowProjectPanel(true)}
                                className="history-view-all-btn"
                            >
                                查看全部
                            </button>
                        )}
                    </div>
                    {historyLoading ? (
                        <div className="history-loading">
                            加载中...
                        </div>
                    ) : historyItems.length === 0 ? (
                        <div className="history-empty">
                            暂无翻译记录
                        </div>
                    ) : (
                        <div className="history-list">
                            {historyItems.slice(0, 10).map((item, index) => (
                                <div
                                    key={item.id || index}
                                    onClick={() => {
                                        setInputText(item.originalText || '');
                                        setShowHistory(false);
                                    }}
                                    className="history-item"
                                >
                                    <span className="history-item-icon">
                                        {item.type === 'ocr' ? '🖼️' : '📝'}
                                    </span>
                                    <div className="history-item-content">
                                        <div className="history-item-original">
                                            {(item.originalText || '').slice(0, 40)}{(item.originalText || '').length > 40 ? '...' : ''}
                                        </div>
                                        <div className="history-item-translated">
                                            → {(item.translatedText || '').slice(0, 40)}{(item.translatedText || '').length > 40 ? '...' : ''}
                                        </div>
                                    </div>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            navigator.clipboard.writeText(item.translatedText || '');
                                        }}
                                        className="history-item-copy-btn tooltip-bottom"
                                        data-tip="复制译文"
                                    >
                                        📋
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 项目管理面板 */}
            <ProjectPanel
                isOpen={showProjectPanel}
                onClose={() => setShowProjectPanel(false)}
                moduleId="smart-translate-instant"
                currentProjectId={currentProject?.id}
                onProjectChange={(project) => {
                    setCurrentProject(project);
                    // 刷新历史记录
                    if (project.currentState?.items) {
                        setHistoryItems(project.currentState.items);
                    }
                    setShowProjectPanel(false);
                }}
                onCreateNew={() => {
                    setCurrentProject(null);
                    setHistoryItems([]);
                }}
            />
        </div>
    );
};
