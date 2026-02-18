import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/components/ui/Toast';
import type { GoogleGenAI } from '@google/genai';
import { parsePasteInput, fetchImageBlob, extractUrlsFromHtml, convertBlobToBase64, processImageUrl } from '@/apps/ai-image-recognition/utils';
import './ImageTextExtractor.css';

interface ImageTextExtractorAppProps {
    getAiInstance: () => GoogleGenAI;
    textModel?: string;
}

interface ImageItem {
    id: string;
    name: string;             // 文件名或来源描述
    previewUrl: string;       // 预览用的 blob URL 或原始 URL
    base64Data?: string;      // base64 编码的图片数据
    mimeType?: string;        // 图片 MIME 类型
    fetchUrl?: string;        // 需要远程获取的 URL
    originalInput?: string;   // 原始输入（公式或URL）
    status: 'pending' | 'loading' | 'processing' | 'success' | 'error';
    extractedText: string;    // 原文
    chineseText: string;      // 中文翻译
    error?: string;
    sourceType: 'file' | 'url' | 'formula';
}

const MODEL_OPTIONS = [
    { value: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash（推荐，速度快）' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash（稳定）' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash（最新）' },
];

const ImageTextExtractorApp: React.FC<ImageTextExtractorAppProps> = ({ getAiInstance, textModel = 'gemini-2.0-flash' }) => {
    const toast = useToast();
    const [images, setImages] = useState<ImageItem[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [model, setModel] = useState(textModel);
    const [customPrompt, setCustomPrompt] = useState('');
    const [showCustomPrompt, setShowCustomPrompt] = useState(false);
    const [batchSize, setBatchSize] = useState(10);
    const [concurrency, setConcurrency] = useState(3);
    const [processedCount, setProcessedCount] = useState(0);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [copiedAll, setCopiedAll] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const [isLoadingUrls, setIsLoadingUrls] = useState(false);
    const [showImportOld, setShowImportOld] = useState(false);
    const [importOldText, setImportOldText] = useState('');
    const [showGuide, setShowGuide] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef(false);
    const dropZoneRef = useRef<HTMLDivElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const addFromUrlsRef = useRef<(urls: { type: 'url' | 'formula'; content: string; url: string }[]) => void>(() => { });

    // 生成唯一 ID
    const genId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    const STORAGE_KEY = 'ite-saved-results';

    // 初始化时从 localStorage 加载已保存的结果
    useEffect(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) {
                const parsed: ImageItem[] = JSON.parse(saved);
                if (Array.isArray(parsed) && parsed.length > 0) {
                    setImages(parsed);
                    toast.success(`已恢复 ${parsed.length} 条历史记录`);
                }
            }
        } catch { /* ignore */ }
    }, []);

    // images 变化时自动保存到 localStorage（只保存有结果的记录）
    useEffect(() => {
        if (images.length === 0) {
            localStorage.removeItem(STORAGE_KEY);
            return;
        }
        try {
            // 只保存必要字段，排除大体积的 base64Data
            const toSave = images.map(img => ({
                id: img.id,
                name: img.name,
                previewUrl: img.sourceType !== 'file' ? img.previewUrl : '',
                fetchUrl: img.fetchUrl,
                originalInput: img.originalInput,
                status: img.status === 'processing' ? 'pending' as const : img.status,
                extractedText: img.extractedText,
                chineseText: img.chineseText,
                error: img.error,
                sourceType: img.sourceType,
                // 不保存 base64Data 和本地 blob URL（刷新后无效）
            }));
            localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
        } catch { /* storage full, ignore */ }
    }, [images]);

    // ==========================================
    // 添加本地文件
    // ==========================================
    const addFiles = useCallback(async (files: FileList | File[]) => {
        const imageFiles = Array.from(files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) {
            toast.warning('未检测到有效的图片文件');
            return;
        }

        const newItems: ImageItem[] = [];
        for (const f of imageFiles) {
            const previewUrl = URL.createObjectURL(f);
            const base64 = await fileToBase64(f);
            newItems.push({
                id: genId(),
                name: f.name,
                previewUrl,
                base64Data: base64,
                mimeType: f.type,
                status: 'pending',
                extractedText: '',
                chineseText: '',
                sourceType: 'file',
            });
        }
        setImages(prev => [...prev, ...newItems]);
        toast.success(`已添加 ${newItems.length} 张图片`);
    }, [toast]);

    // ==========================================
    // 从 URL 添加图片（Google Sheets / =IMAGE() / 纯 URL）
    // ==========================================
    const addFromUrls = useCallback(async (urls: { type: 'url' | 'formula'; content: string; url: string }[]) => {
        if (urls.length === 0) return;

        setIsLoadingUrls(true);

        // 先创建占位卡片
        const pendingItems = urls.map(p => ({
            id: genId(),
            name: p.type === 'formula' ? p.content : p.url.split('/').pop()?.split('?')[0] || 'image',
            previewUrl: p.url,   // 先用原始 URL 做预览
            fetchUrl: p.url,
            originalInput: p.content, // 保存原始输入（公式或URL）
            status: 'loading' as const,
            extractedText: '',
            chineseText: '',
            sourceType: p.type === 'formula' ? 'formula' as const : 'url' as const,
        }));

        setImages(prev => [...prev, ...pendingItems]);
        toast.success(`正在加载 ${pendingItems.length} 张图片...`);

        // 并发下载图片
        const FETCH_CONCURRENCY = 5;
        let fetchIdx = 0;
        const fetchQueue = [...pendingItems];

        const fetchWorker = async () => {
            while (fetchIdx < fetchQueue.length) {
                const idx = fetchIdx++;
                const item = fetchQueue[idx];
                try {
                    const { blob, mimeType } = await fetchImageBlob(item.fetchUrl!);
                    const blobUrl = URL.createObjectURL(blob);
                    const base64 = await convertBlobToBase64(blob);

                    setImages(prev => prev.map(img =>
                        img.id === item.id
                            ? { ...img, previewUrl: blobUrl, base64Data: base64, mimeType, status: 'pending' as const }
                            : img
                    ));
                } catch (err: any) {
                    setImages(prev => prev.map(img =>
                        img.id === item.id
                            ? { ...img, status: 'error' as const, error: err.message || '图片下载失败' }
                            : img
                    ));
                }
            }
        };

        await Promise.all(
            Array.from({ length: Math.min(FETCH_CONCURRENCY, fetchQueue.length) }, () => fetchWorker())
        );

        setIsLoadingUrls(false);
    }, [toast]);

    // 保持 ref 最新
    useEffect(() => {
        addFromUrlsRef.current = addFromUrls;
    }, [addFromUrls]);

    // ==========================================
    // 粘贴处理（支持 Google Sheets =IMAGE() / HTML <img> / URL / 文件）
    // ==========================================
    useEffect(() => {
        const handleGlobalPaste = (e: ClipboardEvent) => {
            const container = containerRef.current;
            if (!container) return;

            // 检查组件可见性
            const rect = container.getBoundingClientRect();
            if (rect.width <= 0 || rect.height <= 0) return;

            // 检查粘贴目标是否在本组件内
            const pasteTarget = e.target as Node;
            if (!container.contains(pasteTarget)) return;

            // 如果粘贴目标是普通输入框（非 URL 输入区），允许正常粘贴
            const targetEl = e.target as HTMLElement;
            const isUrlTextarea = targetEl.classList.contains('ite-url-textarea');
            if ((targetEl.tagName === 'INPUT' || targetEl.tagName === 'TEXTAREA') && !isUrlTextarea) {
                return;
            }

            let handled = false;

            if (e.clipboardData) {
                const html = e.clipboardData.getData('text/html');
                const plainText = e.clipboardData.getData('text/plain');

                const hasImageFormula = !!plainText && plainText.includes('=IMAGE');
                const hasHttp = !!plainText && plainText.includes('http');
                const hasImgTag = !!html && html.includes('<img');
                const shouldHandleAsImageContent = hasImageFormula || hasHttp || hasImgTag;

                // 1. =IMAGE() 公式（Google Sheets 复制单元格）
                if (plainText && plainText.includes('=IMAGE')) {
                    e.preventDefault();
                    const parsed = parsePasteInput(plainText);
                    addFromUrlsRef.current(parsed);
                    handled = true;
                    return;
                }

                // 2. HTML <img> 标签（Google Sheets 单元格含图片）
                if (html && hasImgTag) {
                    const extractedUrls = extractUrlsFromHtml(html);
                    if (extractedUrls.length > 0) {
                        e.preventDefault();
                        const textLines = plainText ? plainText.split(/\r?\n/).filter(line => line.trim() !== '') : [];
                        const formulaRegex = /=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i;
                        const formulaUrls: string[] = [];
                        textLines.forEach(line => {
                            const match = line.match(formulaRegex);
                            if (match && match[1]) formulaUrls.push(match[1]);
                        });

                        const urlItems = extractedUrls.map(({ originalUrl, fetchUrl }, index) => {
                            let originalContent = (index < textLines.length && textLines[index].trim()) ? textLines[index] : null;
                            let actualFetchUrl = fetchUrl;
                            if (index < formulaUrls.length) {
                                actualFetchUrl = formulaUrls[index];
                            } else if (originalContent) {
                                const formulaMatch = originalContent.match(formulaRegex);
                                if (formulaMatch && formulaMatch[1]) actualFetchUrl = formulaMatch[1];
                            }
                            if (!originalContent || !originalContent.includes('=IMAGE')) {
                                originalContent = `=IMAGE("${originalUrl}")`;
                            }
                            return { type: 'url' as const, content: originalContent, url: actualFetchUrl };
                        });

                        addFromUrlsRef.current(urlItems);
                        handled = true;
                        return;
                    }
                }

                // 3. 纯文本 URL
                if (plainText && hasHttp) {
                    e.preventDefault();
                    const parsed = parsePasteInput(plainText);
                    if (parsed.length > 0) {
                        addFromUrlsRef.current(parsed);
                        handled = true;
                        return;
                    }
                }

                // 4. 本地文件粘贴（截图等）
                if (e.clipboardData.files.length > 0) {
                    const hasMeaningfulText = plainText && plainText.trim().length > 0;
                    if (hasMeaningfulText && !shouldHandleAsImageContent) return;
                    e.preventDefault();
                    const files = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
                    if (files.length > 0) addFiles(files);
                    handled = true;
                    return;
                }

                // 5. Clipboard items fallback
                const items = Array.from(e.clipboardData.items || []);
                const imageItems = items.filter(item => item.type.startsWith('image/'));
                if (imageItems.length > 0) {
                    e.preventDefault();
                    const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
                    if (files.length > 0) addFiles(files);
                    handled = true;
                    return;
                }
            }

            // 6. navigator.clipboard fallback
            if (!handled && navigator.clipboard?.read) {
                void (async () => {
                    try {
                        const items = await navigator.clipboard.read();
                        for (const item of items) {
                            const imageType = item.types.find(type => type.startsWith('image/'));
                            if (imageType) {
                                const blob = await item.getType(imageType);
                                const file = new File([blob], `pasted-image.${imageType.split('/')[1] || 'png'}`, { type: imageType });
                                addFiles([file]);
                                return;
                            }
                        }
                        const text = await navigator.clipboard.readText();
                        if (text && (text.includes('http') || text.includes('=IMAGE'))) {
                            const parsed = parsePasteInput(text);
                            addFromUrlsRef.current(parsed);
                        }
                    } catch (err) {
                        console.warn('[ITE Paste Fallback] Clipboard read failed:', err);
                    }
                })();
            }
        };

        window.addEventListener('paste', handleGlobalPaste, true);
        return () => window.removeEventListener('paste', handleGlobalPaste, true);
    }, [addFiles]);

    // ==========================================
    // 手动输入 URL / =IMAGE() 解析
    // ==========================================
    const handleUrlInputSubmit = () => {
        const text = urlInput.trim();
        if (!text) return;
        const parsed = parsePasteInput(text);
        if (parsed.length > 0) {
            addFromUrls(parsed);
            setUrlInput('');
        } else {
            toast.warning('未识别到有效的图片链接或 =IMAGE() 公式');
        }
    };

    // 拖放
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dropZoneRef.current?.classList.remove('drag-over');
        if (e.dataTransfer.files.length > 0) {
            addFiles(e.dataTransfer.files);
        }
    }, [addFiles]);

    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dropZoneRef.current?.classList.add('drag-over');
    }, []);

    const handleDragLeave = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        dropZoneRef.current?.classList.remove('drag-over');
    }, []);

    // 转换图片为 base64
    const fileToBase64 = (file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => {
                const result = reader.result as string;
                const base64 = result.split(',')[1];
                resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    };

    // 解析单张图片的 AI 响应，分离原文和中文
    const parseSingleResponse = (raw: string): { original: string; chinese: string } => {
        // 尝试用分隔符解析
        const origMatch = raw.match(/===ORIGINAL===\s*([\s\S]*?)\s*===CHINESE===/i);
        const cnMatch = raw.match(/===CHINESE===\s*([\s\S]*?)$/i);

        if (origMatch && cnMatch) {
            return {
                original: origMatch[1].trim(),
                chinese: cnMatch[1].trim(),
            };
        }

        // 备用方案：尝试其他常见分隔格式
        const altMatch = raw.match(/^(.*?)\n\s*-{3,}\s*\n(.*)$/s);
        if (altMatch) {
            return { original: altMatch[1].trim(), chinese: altMatch[2].trim() };
        }

        // 无法分离时，全部作为原文
        return { original: raw.trim(), chinese: '' };
    };

    // 带重试的 API 调用
    const retryWithBackoff = async <T,>(
        fn: () => Promise<T>,
        maxRetries: number = 3,
        initialDelayMs: number = 2000,
        validateResult?: (result: T) => boolean
    ): Promise<T> => {
        let lastError: Error | null = null;
        for (let attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                const result = await fn();
                if (validateResult && !validateResult(result)) {
                    throw new Error('结果验证失败，尝试重试');
                }
                return result;
            } catch (err: any) {
                lastError = err;
                const msg = err?.message || '';
                const isRateLimit = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED');
                if (attempt < maxRetries) {
                    const delay = isRateLimit
                        ? initialDelayMs * Math.pow(2, attempt)  // 限流用指数退避
                        : initialDelayMs;  // 其他错误固定延迟
                    console.log(`[ITE] 第 ${attempt + 1} 次重试，等待 ${delay}ms...`);
                    await new Promise(r => setTimeout(r, delay));
                }
            }
        }
        throw lastError || new Error('重试次数已耗尽');
    };

    // 批量处理多张图片（合并成一次 API 请求，带自动重试）
    const processImagesBatch = async (
        items: ImageItem[]
    ): Promise<Map<string, { original: string; chinese: string; error?: string }>> => {
        const resultMap = new Map<string, { original: string; chinese: string; error?: string }>();

        // 过滤掉没有 base64 数据的
        const validItems = items.filter(item => item.base64Data && item.mimeType);
        if (validItems.length === 0) {
            items.forEach(item => resultMap.set(item.id, { original: '', chinese: '', error: '图片数据未加载完成' }));
            return resultMap;
        }

        try {
            const ai = getAiInstance();

            // 构建 parts：交替放置图片和编号标记
            const parts: any[] = [];
            validItems.forEach((item, index) => {
                parts.push({
                    inlineData: {
                        mimeType: item.mimeType!,
                        data: item.base64Data!,
                    }
                });
                parts.push({ text: `[图片 ${index + 1}]` });
            });

            const defaultPrompt = `提取图片中的文案，不要暗色背景图片中的文字。只保留中间部分清晰的文案，包含标题和内容，标题单独一行，请原样将文案给我。不需要有其他的输出。不需要其他任何多余的内容。`;

            const basePrompt = customPrompt.trim() || defaultPrompt;

            // 追加批次处理说明
            parts.push({
                text: `${basePrompt}

【批次处理说明】
以上共有 ${validItems.length} 张图片，已按 [图片 1]、[图片 2]... 编号。
请对每张图片分别提取前景文字，并严格按以下格式返回结果：

=== [1] ===
===ORIGINAL===
（图片1的原文，保持段落结构和换行）
===CHINESE===
（图片1的中文翻译，如果原文已经是中文则原样输出）
=== [2] ===
===ORIGINAL===
（图片2的原文）
===CHINESE===
（图片2的中文翻译）
...以此类推

注意：
- 每张图片的结果必须用 === [编号] === 分隔
- 编号从 1 开始，与图片顺序一一对应
- 只提取中间前景区域的文字，忽略外围背景
- 如果前景区域有标题，先输出标题再输出正文
- 中文翻译要自然流畅，保持与原文对应的段落结构
- 如果原文是中文，===CHINESE=== 部分直接原样输出即可`
            });

            // 带重试的 API 调用
            const fullText = await retryWithBackoff(
                async () => {
                    const response = await ai.models.generateContent({
                        model: model,
                        contents: [{ role: 'user', parts }],
                    });
                    return response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                },
                3, // 最多重试 3 次
                2000,
                (text) => !!text?.trim() // 验证：返回内容不为空
            );

            // 解析批量结果：按 === [N] === 分割
            const sections = fullText.split(/===\s*\[(\d+)\]\s*===/);
            // sections 格式: [前缀, "1", 内容1, "2", 内容2, ...]
            for (let i = 1; i < sections.length; i += 2) {
                const index = parseInt(sections[i], 10) - 1;
                const content = (sections[i + 1] || '').trim();
                if (index >= 0 && index < validItems.length && content) {
                    const parsed = parseSingleResponse(content);
                    resultMap.set(validItems[index].id, { original: parsed.original, chinese: parsed.chinese });
                }
            }

            // 检查是否有遗漏的图片
            for (const item of validItems) {
                if (!resultMap.has(item.id)) {
                    resultMap.set(item.id, { original: '', chinese: '', error: '批次解析未返回此图片的结果' });
                }
            }

            // 如果解析结果严重不足（< 50%），记录警告
            const successCount = Array.from(resultMap.values()).filter(r => !r.error).length;
            if (successCount < validItems.length * 0.5) {
                console.warn(`[ITE Batch] 只成功解析 ${successCount}/${validItems.length} 张`);
            }

            return resultMap;
        } catch (err: any) {
            const msg = err?.message || String(err);
            const errorMsg = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED')
                ? '请求频率过高，已重试多次仍失败，请减小批次大小'
                : msg;
            validItems.forEach(item => {
                if (!resultMap.has(item.id)) {
                    resultMap.set(item.id, { original: '', chinese: '', error: errorMsg });
                }
            });
            return resultMap;
        }
    };

    // 单张重试（将单张图片作为一个批次处理）
    const retrySingle = async (item: ImageItem) => {
        if (!item.base64Data) {
            toast.error('图片数据未加载，无法重试');
            return;
        }
        // 标记为处理中
        setImages(prev => prev.map(img =>
            img.id === item.id ? { ...img, status: 'processing' as const, error: undefined } : img
        ));

        const resultMap = await processImagesBatch([item]);
        const result = resultMap.get(item.id);
        setImages(prev => prev.map(img => {
            if (img.id === item.id && result) {
                return {
                    ...img,
                    status: result.error ? 'error' as const : 'success' as const,
                    extractedText: result.original,
                    chineseText: result.chinese,
                    error: result.error,
                };
            }
            return img;
        }));

        if (result && !result.error) {
            toast.success('重试成功');
        } else {
            toast.error('重试失败：' + (result?.error || '未知错误'));
        }
    };

    // 批量处理（按批次分组）
    const handleProcess = async () => {
        const pending = images.filter(img => (img.status === 'pending' || img.status === 'error') && img.base64Data);
        if (pending.length === 0) {
            toast.warning('没有待处理的图片（需要先下载完成）');
            return;
        }

        setIsProcessing(true);
        abortRef.current = false;
        setProcessedCount(0);

        // 标记所有待处理图片
        setImages(prev => prev.map(img =>
            ((img.status === 'pending' || img.status === 'error') && img.base64Data)
                ? { ...img, status: 'pending' as const, extractedText: '', chineseText: '', error: undefined }
                : img
        ));

        let completed = 0;

        // 将待处理图片按 batchSize 分组
        const batches: ImageItem[][] = [];
        for (let i = 0; i < pending.length; i += batchSize) {
            batches.push(pending.slice(i, i + batchSize));
        }
        const totalBatches = batches.length;

        // 并发处理多个批次（信号量模式）
        let activeCount = 0;
        const batchPromises: Promise<void>[] = [];

        for (const batchItems of batches) {
            if (abortRef.current) break;

            // 等待并发槽位
            while (activeCount >= concurrency) {
                await new Promise(r => setTimeout(r, 100));
            }

            activeCount++;

            // 标记当前批次为处理中
            setImages(prev => prev.map(img =>
                batchItems.some(b => b.id === img.id)
                    ? { ...img, status: 'processing' as const }
                    : img
            ));

            const promise = processImagesBatch(batchItems).then(resultMap => {
                activeCount--;
                completed += batchItems.length;
                setProcessedCount(completed);
                setImages(prev => prev.map(img => {
                    const result = resultMap.get(img.id);
                    if (result) {
                        return {
                            ...img,
                            status: result.error ? 'error' as const : 'success' as const,
                            extractedText: result.original,
                            chineseText: result.chinese,
                            error: result.error,
                        };
                    }
                    return img;
                }));
            });

            batchPromises.push(promise);

            // 批次启动间小延迟
            await new Promise(r => setTimeout(r, 300));
        }

        await Promise.allSettled(batchPromises);

        setIsProcessing(false);
        if (!abortRef.current) {
            toast.success(`处理完成！共 ${completed} 张（${totalBatches} 个批次）`);
        }
    };

    // 停止
    const handleStop = () => {
        abortRef.current = true;
        toast.warning('正在停止...');
    };

    // 删除单张
    const removeImage = (id: string) => {
        setImages(prev => {
            const item = prev.find(i => i.id === id);
            if (item && item.previewUrl.startsWith('blob:')) URL.revokeObjectURL(item.previewUrl);
            return prev.filter(i => i.id !== id);
        });
    };

    // 清空全部
    const clearAll = () => {
        images.forEach(img => {
            if (img.previewUrl.startsWith('blob:')) URL.revokeObjectURL(img.previewUrl);
        });
        setImages([]);
        setProcessedCount(0);
    };

    // 复制
    const copyText = (id: string, text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    // HTML 转义（\n → <br> 保留单元格内换行）
    const escapeHtml = (text: string): string => {
        if (!text) return '';
        return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;').replace(/\n/g, '<br>');
    };

    // TSV 单元格转义：包含换行/Tab/引号的内容用双引号包裹
    const tsvCell = (text: string): string => {
        if (!text) return '';
        if (text.includes('\n') || text.includes('\r') || text.includes('\t') || text.includes('"')) {
            return `"${text.replace(/"/g, '""')}"`;
        }
        return text;
    };

    // 以 HTML 表格 + TSV 双格式写入剪贴板
    const copyAsHtmlTable = async (rows: string[][], successMsg: string) => {
        // HTML 表格：保留换行
        const html = '<meta charset="utf-8"><table>' + rows.map(row =>
            '<tr>' + row.map(cell => `<td style="white-space:pre-wrap">${escapeHtml(cell)}</td>`).join('') + '</tr>'
        ).join('') + '</table>';
        // TSV 格式：用双引号包裹含换行的单元格（Google Sheets 标准）
        const plainText = rows.map(row => row.map(tsvCell).join('\t')).join('\n');
        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([plainText], { type: 'text/plain' }),
                })
            ]);
        } catch {
            // fallback: 旧浏览器不支持 ClipboardItem
            await navigator.clipboard.writeText(plainText);
        }
        setCopiedAll(true);
        toast.success(successMsg);
        setTimeout(() => setCopiedAll(false), 2000);
    };

    // 复制全部链接（纯 URL）
    const copyAllLinks = () => {
        const rows = images.map(img => {
            if (img.fetchUrl) return [img.fetchUrl];
            const formulaMatch = (img.originalInput || '').match(/=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i);
            if (formulaMatch) return [formulaMatch[1]];
            return [''];
        });
        if (rows.some(r => r[0])) {
            copyAsHtmlTable(rows, `已复制 ${rows.filter(r => r[0]).length} 条链接`);
        } else {
            toast.warning('没有可复制的链接');
        }
    };

    // 复制全部公式（=IMAGE() 格式）
    const copyAllFormulas = () => {
        const rows = images.map(img => {
            if (img.originalInput && img.originalInput.toUpperCase().includes('=IMAGE')) {
                return [img.originalInput];
            }
            if (img.fetchUrl) return [`=IMAGE("${img.fetchUrl}")`];
            return [img.name];
        });
        if (rows.some(r => r[0])) {
            copyAsHtmlTable(rows, `已复制 ${rows.filter(r => r[0]).length} 条公式`);
        } else {
            toast.warning('没有可复制的公式');
        }
    };

    // 复制识别结果（原文+中文，两列）
    const copyAllResults = () => {
        const successItems = images.filter(img => img.status === 'success');
        if (successItems.length === 0) { toast.warning('没有可复制的结果'); return; }
        const rows = images.map(img => {
            const original = (img.status === 'success') ? img.extractedText : '';
            const chinese = (img.status === 'success') ? img.chineseText : '';
            return [original, chinese];
        });
        copyAsHtmlTable(rows, `已复制 ${successItems.length} 条识别结果`);
    };

    // 复制原+结果（公式+原文+中文，三列）
    const copyAllOriginalAndResults = () => {
        const successItems = images.filter(img => img.status === 'success');
        if (successItems.length === 0) { toast.warning('没有可复制的结果'); return; }
        const rows = images.map(img => {
            const formula = img.originalInput || (img.fetchUrl ? `=IMAGE("${img.fetchUrl}")` : img.name);
            const original = (img.status === 'success') ? img.extractedText : '';
            const chinese = (img.status === 'success') ? img.chineseText : '';
            return [formula, original, chinese];
        });
        copyAsHtmlTable(rows, `已复制 ${successItems.length} 条（公式+原文+中文）`);
    };

    // 导出
    // 通用下载辅助函数（Electron 兼容）
    const downloadBlob = (blob: Blob, filename: string) => {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.style.display = 'none';
        document.body.appendChild(a);
        a.click();
        // 延迟移除和释放，确保下载触发
        setTimeout(() => {
            document.body.removeChild(a);
            URL.revokeObjectURL(url);
        }, 500);
    };

    const exportTxt = () => {
        const successItems = images.filter(img => img.status === 'success' && (img.extractedText || img.chineseText));
        if (successItems.length === 0) { toast.warning('没有可导出的结果'); return; }
        const content = successItems.map(img => {
            let text = `=== ${img.name} ===\n`;
            if (img.extractedText) text += `【原文】\n${img.extractedText}\n`;
            if (img.chineseText) text += `【中文】\n${img.chineseText}`;
            return text;
        }).join('\n\n---\n\n');
        downloadBlob(
            new Blob([content], { type: 'text/plain;charset=utf-8' }),
            `文字提取结果_${new Date().toISOString().slice(0, 10)}.txt`
        );
        toast.success('已导出 TXT 文件');
    };

    const exportCsv = () => {
        const successItems = images.filter(img => img.status === 'success' && (img.extractedText || img.chineseText));
        if (successItems.length === 0) { toast.warning('没有可导出的结果'); return; }
        const escape = (s: string) => `"${s.replace(/"/g, '""')}"`;
        const rows = [
            ['文件名', '原始公式', '原文', '中文翻译'].map(escape).join(','),
            ...successItems.map(img => [
                img.name,
                img.originalInput || (img.fetchUrl ? `=IMAGE("${img.fetchUrl}")` : ''),
                img.extractedText,
                img.chineseText
            ].map(escape).join(','))
        ];
        const bom = '\uFEFF';
        downloadBlob(
            new Blob([bom + rows.join('\n')], { type: 'text/csv;charset=utf-8' }),
            `文字提取结果_${new Date().toISOString().slice(0, 10)}.csv`
        );
        toast.success('已导出 CSV 文件');
    };

    // 导入旧版本复制的结果
    const importOldResults = () => {
        if (!importOldText.trim()) {
            toast.warning('请先粘贴旧版本复制的结果');
            return;
        }
        // 解析旧格式：=== 文件名 ===\n【原文】\n...\n【中文】\n...
        const blocks = importOldText.split(/===\s*(.+?)\s*===/).filter(s => s.trim());
        const imported: ImageItem[] = [];
        for (let i = 0; i < blocks.length; i += 2) {
            const name = blocks[i]?.trim();
            const content = blocks[i + 1]?.trim();
            if (!name || !content) continue;
            let extractedText = '';
            let chineseText = '';
            // 尝试拆分原文和中文
            const originalMatch = content.match(/【原文】\s*\n([\s\S]*?)(?=【中文】|$)/);
            const chineseMatch = content.match(/【中文】\s*\n([\s\S]*)$/);
            if (originalMatch) extractedText = originalMatch[1].trim();
            if (chineseMatch) chineseText = chineseMatch[1].trim();
            // 如果没有标记，整个内容当原文
            if (!extractedText && !chineseText) extractedText = content;
            imported.push({
                id: genId(),
                name,
                previewUrl: '',
                status: 'success',
                extractedText,
                chineseText,
                sourceType: 'url',
            });
        }
        if (imported.length === 0) {
            toast.warning('未能解析出任何结果，请确认格式正确');
            return;
        }
        setImages(prev => [...prev, ...imported]);
        toast.success(`已导入 ${imported.length} 条旧结果`);
        setImportOldText('');
        setShowImportOld(false);
    };

    const pendingCount = images.filter(i => i.status === 'pending').length;
    const loadingCount = images.filter(i => i.status === 'loading').length;
    const processingCount = images.filter(i => i.status === 'processing').length;
    const successCount = images.filter(i => i.status === 'success').length;
    const errorCount = images.filter(i => i.status === 'error').length;
    const readyToProcess = pendingCount + errorCount;

    return (
        <div className="ite-app" ref={containerRef} tabIndex={-1}>
            {/* 标题区 */}
            <div className="ite-header">
                <div className="ite-header-icon">📝</div>
                <div className="ite-header-info">
                    <h1 className="ite-title">图片前景文字提取器</h1>
                    <p className="ite-subtitle">
                        专为 YouTube 贴文竖版缩略图设计，提取图片中间前景区域的文案（标题+正文），自动忽略外围暗色/模糊背景，同时输出原文和中文翻译。支持批量处理。
                    </p>
                </div>
                <button className="ite-help-btn" onClick={() => setShowGuide(true)} title="使用说明">❓</button>
            </div>

            {/* 使用说明弹框 */}
            {showGuide && (
                <div className="ite-guide-overlay" onClick={() => setShowGuide(false)}>
                    <div className="ite-guide-modal" onClick={e => e.stopPropagation()}>
                        <div className="ite-guide-modal-header">
                            <h3>📖 使用说明</h3>
                            <button className="ite-guide-close" onClick={() => setShowGuide(false)}>✕</button>
                        </div>
                        <div className="ite-guide-content">
                            <div className="ite-guide-section">
                                <h4>🎯 用途</h4>
                                <p>专为提取 YouTube 贴文竖版缩略图上的前景文案设计。AI 会自动识别图片中间区域的文字（包含标题和正文），忽略外围的暗色/模糊背景。支持任何语言的文字识别。</p>
                            </div>
                            <div className="ite-guide-section">
                                <h4>📥 添加图片的方式</h4>
                                <ul>
                                    <li><strong>本地文件</strong>：点击"选择图片"按钮或直接拖拽图片到页面</li>
                                    <li><strong>粘贴图片</strong>：复制图片后 Ctrl+V / Cmd+V 直接粘贴</li>
                                    <li><strong>URL 链接</strong>：在下方输入框粘贴图片链接（每行一个）</li>
                                    <li><strong>Google Sheets 公式</strong>：支持 <code>=IMAGE("url")</code> 格式，直接从表格复制粘贴</li>
                                </ul>
                            </div>
                            <div className="ite-guide-section">
                                <h4>⚙️ 工作流程</h4>
                                <ol>
                                    <li>添加图片（支持批量）→ 等待 URL 图片下载完成</li>
                                    <li>点击"🚀 开始提取"→ AI 自动识别每张图片的前景文字</li>
                                    <li>查看结果：每张图片同时输出「原文」和「中文翻译」</li>
                                    <li>导出：支持复制全部、导出 TXT、导出 CSV、复制 HTML 表格</li>
                                </ol>
                            </div>
                            <div className="ite-guide-section">
                                <h4>💡 提示</h4>
                                <ul>
                                    <li>批次大小控制每次 API 请求处理的图片数，并发数控制同时发送的请求数</li>
                                    <li>可自定义提取指令来调整 AI 的提取行为</li>
                                    <li>提取失败的图片可以单独重试</li>
                                </ul>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 设置区 */}
            <div className="ite-settings-card">
                <div className="ite-settings-row">
                    <div className="ite-setting-group">
                        <label className="ite-label">
                            <span className="ite-label-icon">🤖</span>
                            AI 模型
                        </label>
                        <select
                            className="ite-select"
                            value={model}
                            onChange={e => setModel(e.target.value)}
                            disabled={isProcessing}
                        >
                            {MODEL_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="ite-setting-group">
                        <label className="ite-label">
                            <span className="ite-label-icon">📦</span>
                            每批图片数
                        </label>
                        <input
                            type="number"
                            className="ite-input-small"
                            value={batchSize}
                            onChange={e => setBatchSize(Math.max(1, Math.min(20, parseInt(e.target.value) || 1)))}
                            min={1}
                            max={20}
                            disabled={isProcessing}
                        />
                    </div>
                    <div className="ite-setting-group">
                        <label className="ite-label">
                            <span className="ite-label-icon">⚡</span>
                            并发数
                        </label>
                        <input
                            type="number"
                            className="ite-input-small"
                            value={concurrency}
                            onChange={e => setConcurrency(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                            min={1}
                            max={10}
                            disabled={isProcessing}
                        />
                    </div>
                    <div className="ite-setting-group">
                        <label className="ite-label">
                            <span className="ite-label-icon">📋</span>
                            <button
                                className="ite-link-btn"
                                onClick={() => setShowCustomPrompt(!showCustomPrompt)}
                            >
                                {showCustomPrompt ? '收起自定义提示词 ▲' : '自定义提示词 ▼'}
                            </button>
                        </label>
                    </div>
                </div>
                {showCustomPrompt && (
                    <div className="ite-custom-prompt">
                        <textarea
                            className="ite-textarea"
                            rows={5}
                            value={customPrompt}
                            onChange={e => setCustomPrompt(e.target.value)}
                            placeholder="留空则使用默认提示词（自动识别中间前景区域文字）。可自定义提示词来调整 AI 的识别行为..."
                            disabled={isProcessing}
                        />
                        {customPrompt && (
                            <button className="ite-clear-prompt-btn" onClick={() => setCustomPrompt('')} title="清除自定义指令，恢复为默认提取指令">
                                恢复默认
                            </button>
                        )}
                    </div>
                )}
            </div>

            {/* 上传区 */}
            <div
                ref={dropZoneRef}
                className="ite-dropzone"
                onDrop={handleDrop}
                onDragOver={handleDragOver}
                onDragLeave={handleDragLeave}
                onClick={() => !isProcessing && fileInputRef.current?.click()}
            >
                <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/*"
                    multiple
                    style={{ display: 'none' }}
                    onChange={e => {
                        if (e.target.files) addFiles(e.target.files);
                        e.target.value = '';
                    }}
                />
                <div className="ite-dropzone-content">
                    <span className="ite-dropzone-icon">🖼️</span>
                    <p className="ite-dropzone-text">
                        点击上传 · 拖放图片 · 粘贴 (Ctrl+V)
                    </p>
                    <p className="ite-dropzone-hint">支持 JPG、PNG、WebP 等格式，支持粘贴 Google Sheets =IMAGE() 公式和图片链接</p>
                </div>
            </div>

            {/* URL 输入区 */}
            <div className="ite-url-input-area">
                <textarea
                    className="ite-url-textarea"
                    rows={3}
                    value={urlInput}
                    onChange={e => setUrlInput(e.target.value)}
                    placeholder={"粘贴图片链接或 =IMAGE() 公式，每行一个：\nhttps://example.com/image.jpg\n=IMAGE(\"https://example.com/image.jpg\")"}
                    disabled={isProcessing || isLoadingUrls}
                />
                <button
                    className="ite-btn ite-btn-primary ite-url-submit-btn"
                    onClick={handleUrlInputSubmit}
                    disabled={!urlInput.trim() || isProcessing || isLoadingUrls}
                    title="解析输入框中的链接/公式并添加为图片"
                >
                    {isLoadingUrls ? '⏳ 加载中...' : '📥 添加链接'}
                </button>
            </div>

            {/* 导入旧结果 */}
            <div style={{ padding: '0 1rem', marginBottom: '0.5rem' }}>
                <button
                    className="ite-btn ite-btn-ghost"
                    onClick={() => setShowImportOld(!showImportOld)}
                    style={{ fontSize: '0.8rem', opacity: 0.7 }}
                    title="从旧版工具复制的文本结果中导入数据"
                >
                    📥 {showImportOld ? '收起' : '导入旧版结果'}
                </button>
                {showImportOld && (
                    <div style={{ marginTop: '0.5rem' }}>
                        <textarea
                            className="ite-url-textarea"
                            rows={6}
                            value={importOldText}
                            onChange={e => setImportOldText(e.target.value)}
                            placeholder={"粘贴旧版\"复制全部\"的结果，格式如：\n=== 文件名 ===\n【原文】\nHello World\n【中文】\n你好世界\n\n=== 文件名2 ===\n..."}
                        />
                        <button
                            className="ite-btn ite-btn-primary"
                            onClick={importOldResults}
                            disabled={!importOldText.trim()}
                            style={{ marginTop: '0.4rem' }}
                            title="解析粘贴的旧版结果并导入为图片数据"
                        >
                            📥 解析并导入
                        </button>
                    </div>
                )}
            </div>

            {/* 操作栏 */}
            {images.length > 0 && (
                <div className="ite-toolbar">
                    <div className="ite-toolbar-left">
                        <span className="ite-stats">
                            共 <strong>{images.length}</strong> 张
                            {loadingCount > 0 && <span className="ite-stat-loading"> · ⬇️ {loadingCount} 下载中</span>}
                            {successCount > 0 && <span className="ite-stat-success"> · ✅ {successCount} 成功</span>}
                            {errorCount > 0 && <span className="ite-stat-error"> · ❌ {errorCount} 失败</span>}
                            {pendingCount > 0 && <span className="ite-stat-pending"> · ⏳ {pendingCount} 待处理</span>}
                            {processingCount > 0 && <span className="ite-stat-processing"> · 🔄 {processingCount} 处理中</span>}
                        </span>
                    </div>
                    <div className="ite-toolbar-right">
                        {isProcessing ? (
                            <button className="ite-btn ite-btn-danger" onClick={handleStop} title="停止当前正在进行的批量提取任务">
                                ⏹ 停止
                            </button>
                        ) : (
                            <>
                                <button
                                    className="ite-btn ite-btn-primary"
                                    onClick={handleProcess}
                                    disabled={readyToProcess === 0}
                                    title="使用 AI 批量提取所有待处理图片的前景文字"
                                >
                                    🚀 开始提取 ({readyToProcess})
                                </button>
                                {successCount > 0 && (
                                    <>
                                        <button className="ite-btn ite-btn-outline" onClick={copyAllLinks} title="复制所有图片的原始 URL 链接">
                                            🔗 原始链接
                                        </button>
                                        <button className="ite-btn ite-btn-outline" onClick={copyAllFormulas} title="复制所有图片的 =IMAGE() 公式">
                                            📋 原始公式
                                        </button>
                                        <button className="ite-btn ite-btn-outline" onClick={copyAllResults} title="复制所有提取结果（原文+中文翻译）">
                                            📄 识别结果
                                        </button>
                                        <button className="ite-btn ite-btn-outline" onClick={copyAllOriginalAndResults} title="复制原始链接/公式 + 识别结果的完整数据">
                                            🔲 原+结果
                                        </button>
                                        <button className="ite-btn ite-btn-outline" onClick={exportCsv} title="导出为 CSV 文件，可用 Excel 打开">
                                            📊 导出 CSV
                                        </button>
                                    </>
                                )}
                                <button className="ite-btn ite-btn-ghost" onClick={clearAll} title="清空所有图片和结果">
                                    🗑 清空
                                </button>
                            </>
                        )}
                    </div>
                </div>
            )}

            {/* 进度条 */}
            {isProcessing && (
                <div className="ite-progress-bar">
                    <div
                        className="ite-progress-fill"
                        style={{ width: `${(processedCount / Math.max(1, pendingCount + processingCount + processedCount)) * 100}%` }}
                    />
                    <span className="ite-progress-text">
                        {processedCount} / {pendingCount + processingCount + processedCount}
                    </span>
                </div>
            )}

            {/* 结果列表 */}
            <div className="ite-results">
                {images.map(img => (
                    <div key={img.id} className={`ite-result-card ite-status-${img.status}`}>
                        <div className="ite-result-preview">
                            <img
                                src={img.previewUrl}
                                alt={img.name}
                                onError={(e) => {
                                    // URL 图片加载失败时显示占位
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />
                            <div className="ite-result-status">
                                {img.status === 'loading' && <span className="ite-badge ite-badge-loading">⬇️ 下载中</span>}
                                {img.status === 'pending' && <span className="ite-badge ite-badge-pending">待处理</span>}
                                {img.status === 'processing' && <span className="ite-badge ite-badge-processing">处理中...</span>}
                                {img.status === 'success' && <span className="ite-badge ite-badge-success">✅ 完成</span>}
                                {img.status === 'error' && <span className="ite-badge ite-badge-error">❌ 失败</span>}
                                {img.status === 'error' && !isProcessing && (
                                    <button
                                        className="ite-retry-btn"
                                        onClick={() => retrySingle(img)}
                                        title="重试此图片"
                                    >
                                        🔄 重试
                                    </button>
                                )}
                            </div>
                            {!isProcessing && (
                                <button className="ite-remove-btn" onClick={() => removeImage(img.id)} title="删除">
                                    ✕
                                </button>
                            )}
                        </div>
                        <div className="ite-result-content">
                            <div className="ite-result-filename" title={img.name}>
                                {img.sourceType === 'formula' && <span className="ite-source-badge">📊 表格</span>}
                                {img.sourceType === 'url' && <span className="ite-source-badge">🔗 链接</span>}
                                {img.sourceType === 'file' && <span className="ite-source-badge">📁 本地</span>}
                                {img.name}
                            </div>
                            {img.status === 'success' && (img.extractedText || img.chineseText) && (
                                <div className="ite-bilingual-wrapper">
                                    {/* 原文列 */}
                                    <div className="ite-bilingual-col">
                                        <div className="ite-col-header">
                                            <span className="ite-col-label">📄 原文</span>
                                            <button
                                                className="ite-copy-btn-inline"
                                                onClick={() => copyText(img.id + '-orig', img.extractedText)}
                                            >
                                                {copiedId === img.id + '-orig' ? '✅' : '📋'}
                                            </button>
                                        </div>
                                        <pre className="ite-result-text">{img.extractedText || '（无）'}</pre>
                                    </div>
                                    {/* 中文列 */}
                                    <div className="ite-bilingual-col">
                                        <div className="ite-col-header">
                                            <span className="ite-col-label">🇨🇳 中文</span>
                                            <button
                                                className="ite-copy-btn-inline"
                                                onClick={() => copyText(img.id + '-cn', img.chineseText)}
                                            >
                                                {copiedId === img.id + '-cn' ? '✅' : '📋'}
                                            </button>
                                        </div>
                                        <pre className="ite-result-text">{img.chineseText || '（无）'}</pre>
                                    </div>
                                </div>
                            )}
                            {img.status === 'error' && img.error && (
                                <div className="ite-result-error">
                                    {img.error}
                                    {!isProcessing && (
                                        <button
                                            className="ite-retry-btn-inline"
                                            onClick={() => retrySingle(img)}
                                        >
                                            🔄 点击重试
                                        </button>
                                    )}
                                </div>
                            )}
                            {img.status === 'loading' && (
                                <div className="ite-result-loading">
                                    <div className="ite-spinner" />
                                    <span>正在下载图片...</span>
                                </div>
                            )}
                            {img.status === 'processing' && (
                                <div className="ite-result-loading">
                                    <div className="ite-spinner" />
                                    <span>AI 正在识别中间前景区域文字...</span>
                                </div>
                            )}
                        </div>
                    </div>
                ))}
            </div>

            {/* 空状态 */}
            {images.length === 0 && (
                <div className="ite-empty-state">
                    <div className="ite-empty-icon">📷</div>
                    <p className="ite-empty-title">上传图片开始提取</p>
                    <p className="ite-empty-desc">
                        适用于社交媒体常见的"竖图填充横屏"格式 —— 中间是原图内容，外围是暗色/模糊/放大的背景填充。
                        <br />
                        AI 会自动识别并只读取中间前景区域的文字。
                        <br /><br />
                        <strong>支持多种输入方式：</strong>
                        <br />
                        📁 本地上传 · 📋 粘贴截图 · 📊 粘贴 Google Sheets =IMAGE() · 🔗 图片链接
                    </p>
                </div>
            )}
        </div>
    );
};

export default ImageTextExtractorApp;
