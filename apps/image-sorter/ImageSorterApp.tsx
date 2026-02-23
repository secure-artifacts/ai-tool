/**
 * 图片智能分拣器 (Image Sorter)
 * 批量加载图片 → AI 自动分类 + 打标签 → 可视化筛选 → 一键复制到 Google Sheets
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '@/components/ui/Toast';
import type { GoogleGenAI } from '@google/genai';
import {
    Upload, Sparkles, Tags, Grid3x3, List, CheckSquare, Copy, Trash2,
    Loader2, StopCircle, Filter, ImagePlus, X, Check, Download
} from 'lucide-react';
import {
    extractUrlsFromHtml,
    parsePasteInput,
    fetchImageBlob,
    convertBlobToBase64
} from '@/apps/ai-image-recognition/utils';
import './ImageSorter.css';

// ========== Types ==========
interface SorterImage {
    id: string;
    src: string; // base64 for display
    originalUrl?: string; // preserve source URL for =IMAGE() formula
    name: string;
    category?: string;
    tags?: string[];
    classified: boolean;
    originalIndex: number; // preserve insertion order
    loadFailed?: boolean; // true if image failed to load (placeholder)
    aspectRatio?: string; // e.g. '9:16', '4:5', '1:1'
    width?: number;
    height?: number;
}

interface ImageSorterAppProps {
    getAiInstance: () => GoogleGenAI | null;
}

// ========== Constants ==========
const DEFAULT_BATCH_SIZE = 20; // align closer to AI 图片识别批次体验
const BATCH_SIZE_OPTIONS = [10, 20, 30, 50];
const MODEL_OPTIONS = [
    { value: 'gemini-2.0-flash', label: '2.0 Flash' },
    { value: 'gemini-3-flash-preview', label: '3.0 Flash' },
];
const DEFAULT_MODEL = 'gemini-2.0-flash';
const BATCH_CONCURRENCY = 3; // concurrent AI classification requests
const MAX_IMAGE_DIM = 512; // resize for faster processing

// ========== Common aspect ratios ==========
const COMMON_RATIOS: [number, number, string][] = [
    [1, 1, '1:1'],
    [4, 5, '4:5'],
    [5, 4, '5:4'],
    [3, 4, '3:4'],
    [4, 3, '4:3'],
    [2, 3, '2:3'],
    [3, 2, '3:2'],
    [9, 16, '9:16'],
    [16, 9, '16:9'],
    [21, 9, '21:9'],
];

const detectAspectRatio = (w: number, h: number): string => {
    const ratio = w / h;
    let bestMatch = '其他';
    let bestDiff = Infinity;
    for (const [rw, rh, label] of COMMON_RATIOS) {
        const diff = Math.abs(ratio - rw / rh);
        if (diff < bestDiff) {
            bestDiff = diff;
            bestMatch = label;
        }
    }
    // Only match if within 5% tolerance
    return bestDiff < 0.05 ? bestMatch : `${w}×${h}`;
};

const getImageDimensions = (src: string): Promise<{ width: number; height: number }> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => resolve({ width: img.naturalWidth, height: img.naturalHeight });
        img.onerror = () => resolve({ width: 0, height: 0 });
        img.src = src;
    });
};

const normalizeTextKey = (value: string): string => {
    return value
        .trim()
        .toLowerCase()
        .replace(/\s+/g, '')
        .replace(/[“”"'`]/g, '')
        .replace(/[()（）[\]【】{}]/g, '');
};

const normalizeCategoryWithUserCats = (rawCategory: unknown, userCats: string[]): string => {
    const category = String(rawCategory ?? '').trim();
    if (!category) return userCats.length > 0 ? '其他' : '';
    if (userCats.length === 0) return category;
    if (userCats.includes(category)) return category;

    const normalized = normalizeTextKey(category);
    const matched = userCats.find((cat) => normalizeTextKey(cat) === normalized);
    if (matched) return matched;
    if (normalized === normalizeTextKey('其他') || normalized === normalizeTextKey('其它')) return '其他';
    return '其他';
};

const normalizeTags = (rawTags: unknown): string[] => {
    if (!Array.isArray(rawTags)) return [];
    const seen = new Set<string>();
    const tags: string[] = [];
    for (const item of rawTags) {
        const tag = String(item ?? '').trim();
        if (!tag) continue;
        if (seen.has(tag)) continue;
        seen.add(tag);
        tags.push(tag);
        if (tags.length >= 8) break;
    }
    return tags;
};

const escapeTsvCell = (value: unknown): string => {
    const text = String(value ?? '');
    if (text.includes('\n') || text.includes('\t') || text.includes('"')) {
        return `"${text.replace(/"/g, '""')}"`;
    }
    return text;
};

// ========== Helper: resize image ==========
const resizeImageForAI = (base64: string, maxDim: number): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h;
            const ctx = canvas.getContext('2d')!;
            ctx.drawImage(img, 0, 0, w, h);
            resolve(canvas.toDataURL('image/jpeg', 0.7));
        };
        img.onerror = () => resolve(base64);
        img.src = base64;
    });
};

// ========== Helper: load image from File ==========
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(reader.result as string);
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

// ========== Component ==========
const ImageSorterApp: React.FC<ImageSorterAppProps> = ({ getAiInstance }) => {
    const toast = useToast();

    // State
    const [images, setImages] = useState<SorterImage[]>([]);
    const [classifying, setClassifying] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [userCategories, setUserCategories] = useState<string[]>([]);
    const [catInput, setCatInput] = useState('');
    const [activeCategory, setActiveCategory] = useState<string | null>(null); // null = all
    const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
    const [activeRatio, setActiveRatio] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [selectMode, setSelectMode] = useState(false);
    const [galleryMode, setGalleryMode] = useState<'list' | 'grid'>('grid');
    const abortRef = useRef(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const nextIndexRef = useRef(0);
    const [dragging, setDragging] = useState(false);
    const [imageBatchSize, setImageBatchSize] = useState<number>(() => {
        if (typeof window === 'undefined') return DEFAULT_BATCH_SIZE;
        const raw = Number(localStorage.getItem('image-sorter-image-batch-size'));
        if (BATCH_SIZE_OPTIONS.includes(raw)) return raw;
        return DEFAULT_BATCH_SIZE;
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem('image-sorter-image-batch-size', String(imageBatchSize));
    }, [imageBatchSize]);

    const [classifyModel, setClassifyModel] = useState<string>(() => {
        if (typeof window === 'undefined') return DEFAULT_MODEL;
        return localStorage.getItem('image-sorter-classify-model') || DEFAULT_MODEL;
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem('image-sorter-classify-model', classifyModel);
    }, [classifyModel]);

    // ======== Derived data ========
    const allCategories = React.useMemo(() => {
        const map = new Map<string, number>();
        images.forEach(img => {
            if (img.category) {
                map.set(img.category, (map.get(img.category) || 0) + 1);
            }
        });
        return map;
    }, [images]);

    const allTags = React.useMemo(() => {
        const map = new Map<string, number>();
        images.forEach(img => {
            if (img.tags) {
                img.tags.forEach(tag => {
                    map.set(tag, (map.get(tag) || 0) + 1);
                });
            }
        });
        // Sort by frequency descending
        return new Map([...map.entries()].sort((a, b) => b[1] - a[1]));
    }, [images]);

    const allRatios = React.useMemo(() => {
        const map = new Map<string, number>();
        images.forEach(img => {
            if (img.aspectRatio) {
                map.set(img.aspectRatio, (map.get(img.aspectRatio) || 0) + 1);
            }
        });
        return new Map([...map.entries()].sort((a, b) => b[1] - a[1]));
    }, [images]);

    const filteredImages = React.useMemo(() => {
        let filtered = images;
        if (activeCategory) {
            filtered = filtered.filter(img => img.category === activeCategory);
        }
        if (activeTags.size > 0) {
            filtered = filtered.filter(img =>
                img.tags && [...activeTags].some(tag => img.tags!.includes(tag))
            );
        }
        if (activeRatio) {
            filtered = filtered.filter(img => img.aspectRatio === activeRatio);
        }
        // Always sort by original paste order
        return [...filtered].sort((a, b) => a.originalIndex - b.originalIndex);
    }, [images, activeCategory, activeTags, activeRatio]);

    const classifiedCount = images.filter(img => img.classified).length;

    // ======== Image Loading ========
    const addImages = useCallback(async (files: File[]) => {
        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) {
            toast.warning('没有检测到图片文件');
            return;
        }

        toast.info(`正在加载 ${imageFiles.length} 张图片...`);
        const newImages: SorterImage[] = [];

        const baseIndex = nextIndexRef.current;
        nextIndexRef.current += imageFiles.length;
        for (let fi = 0; fi < imageFiles.length; fi++) {
            const file = imageFiles[fi];
            try {
                const base64 = await fileToBase64(file);
                const dims = await getImageDimensions(base64);
                newImages.push({
                    id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    src: base64,
                    name: file.name,
                    classified: false,
                    originalIndex: baseIndex + fi,
                    width: dims.width,
                    height: dims.height,
                    aspectRatio: dims.width > 0 ? detectAspectRatio(dims.width, dims.height) : undefined,
                });
            } catch {
                console.warn(`Failed to load: ${file.name}`);
            }
        }

        setImages(prev => [...prev, ...newImages]);
        toast.success(`已加载 ${newImages.length} 张图片`);
    }, [toast]);

    // Drag & Drop
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        setDragging(false);
    }, []);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        addImages(files);
    }, [addImages]);

    // File input
    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        addImages(files);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [addImages]);

    // Paste - rewritten to match AI Image Recognition tool logic exactly
    // Helper: load URLs concurrently and add to gallery
    const loadUrlsToGallery = useCallback(async (urlItems: { url: string; content?: string }[]) => {
        if (urlItems.length === 0) return;

        // Keep duplicates to preserve 1:1 row alignment with pasted sheet data.
        const total = urlItems.length;
        toast.info(`正在并发加载 ${total} 张图片（保持原始行顺序）...`);
        setProgress({ done: 0, total });

        const baseIdx = nextIndexRef.current;
        nextIndexRef.current += total;
        let loaded = 0;
        let failed = 0;

        const CONCURRENCY = 8;
        const queue = urlItems.map((item, i) => ({ item, index: i }));
        let queueIdx = 0;

        const worker = async () => {
            while (queueIdx < queue.length) {
                const job = queue[queueIdx++];
                const { url: fetchUrl, content: origContent } = job.item;
                // Extract raw URL from =IMAGE("url") formula to prevent double-wrapping
                const formulaExtract = origContent?.match(/=IMAGE\s*\(\s*["']([^"']+)["']/i);
                const displayUrl = formulaExtract ? formulaExtract[1] : (origContent || fetchUrl);
                try {
                    const { blob } = await fetchImageBlob(fetchUrl);
                    const base64Raw = await convertBlobToBase64(blob);
                    const base64 = `data:${blob.type || 'image/jpeg'};base64,${base64Raw}`;
                    const dims = await getImageDimensions(base64);
                    const newImg: SorterImage = {
                        id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        src: base64,
                        originalUrl: displayUrl,
                        name: `图片-${job.index + 1}`,
                        classified: false,
                        originalIndex: baseIdx + job.index,
                        width: dims.width,
                        height: dims.height,
                        aspectRatio: dims.width > 0 ? detectAspectRatio(dims.width, dims.height) : undefined,
                    };
                    setImages(prev => [...prev, newImg]);
                    loaded++;
                } catch (err) {
                    console.warn('图片加载失败:', fetchUrl, err);
                    const placeholder: SorterImage = {
                        id: `img-fail-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        src: '',
                        originalUrl: displayUrl,
                        name: `图片-${job.index + 1}`,
                        classified: true,
                        category: '加载失败',
                        tags: [],
                        originalIndex: baseIdx + job.index,
                        loadFailed: true,
                    };
                    setImages(prev => [...prev, placeholder]);
                    failed++;
                }
                setProgress({ done: loaded + failed, total });
            }
        };

        const workers = Array.from({ length: Math.min(CONCURRENCY, queue.length) }, () => worker());
        await Promise.all(workers);

        setProgress({ done: 0, total: 0 });
        if (loaded > 0) {
            const msg = failed > 0
                ? `已加载 ${loaded} 张图片（${failed} 张失败）`
                : `已加载 ${loaded} 张图片`;
            toast.success(msg);
        } else {
            toast.error(`图片加载失败，请检查链接是否有效`);
        }
    }, [toast]);

    useEffect(() => {
        const handlePaste = async (e: ClipboardEvent) => {
            if (!e.clipboardData) return;

            // ===== 隔离检查：避免拦截其他工具的粘贴事件 =====
            const target = e.target as HTMLElement;
            // 1. 如果焦点在输入框/文本域/可编辑区域，让浏览器正常处理
            if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable) {
                return;
            }
            // 2. 如果粘贴事件不在图片分拣组件内，不拦截
            if (!target.closest('.image-sorter')) {
                return;
            }

            const html = e.clipboardData.getData('text/html') || '';
            const plainText = e.clipboardData.getData('text/plain') || '';

            // 1. 图片文件（截图、拖拽）
            const files: File[] = [];
            const items = Array.from(e.clipboardData.items || []);
            for (const item of items) {
                if (item.kind === 'file' && item.type.startsWith('image/')) {
                    const file = item.getAsFile();
                    if (file) files.push(file);
                }
            }
            if (files.length > 0) {
                addImages(files);
                return;
            }

            // 2. 优先检查纯文本中是否有 =IMAGE() 公式
            // Google Sheets 复制单元格时，纯文本中的 URL 才是原始可用的 URL
            // HTML 中的 URL 通常是 Google 代理过的
            if (plainText && plainText.includes('=IMAGE')) {
                e.preventDefault();
                const parsed = parsePasteInput(plainText);
                if (parsed.length > 0) {
                    console.log('[ImageSorter Paste] =IMAGE() formulas found:', parsed.length);
                    await loadUrlsToGallery(parsed);
                    return;
                }
            }

            // 3. HTML <img> 标签（Google Sheets 渲染的图片）
            if (html) {
                const extractedUrls = extractUrlsFromHtml(html);
                if (extractedUrls.length > 0) {
                    e.preventDefault();

                    // 从纯文本中提取 =IMAGE() 公式的 URL（更优，因为是原始 URL）
                    const formulaRegex = /=IMAGE\s*\(\s*["']([^"']+)["']/gi;
                    const textLines = plainText ? plainText.split(/\r?\n/).filter(l => l.trim() !== '') : [];
                    const formulaUrls: string[] = [];
                    for (const line of textLines) {
                        const cells = line.split('\t');
                        for (const cell of cells) {
                            formulaRegex.lastIndex = 0;
                            const matches = [...cell.matchAll(formulaRegex)];
                            for (const m of matches) {
                                formulaUrls.push(m[1]);
                            }
                        }
                    }

                    const urlItems = extractedUrls.map(({ originalUrl, fetchUrl }: { originalUrl: string; fetchUrl: string }, index: number) => {
                        // 优先使用公式中的 URL（原始 URL 比 Google 代理 URL 更好）
                        let actualFetchUrl = fetchUrl;
                        if (index < formulaUrls.length) {
                            actualFetchUrl = formulaUrls[index];
                        }
                        return {
                            url: actualFetchUrl,
                            content: `=IMAGE("${originalUrl}")`
                        };
                    });

                    console.log('[ImageSorter Paste] HTML <img> with formula cross-ref:', urlItems.length);
                    await loadUrlsToGallery(urlItems);
                    return;
                }
            }

            // 4. 纯文本 URL（非公式）
            if (plainText && (plainText.includes('http'))) {
                const parsed = parsePasteInput(plainText);
                if (parsed.length > 0) {
                    e.preventDefault();
                    console.log('[ImageSorter Paste] Plain text URLs:', parsed.length);
                    await loadUrlsToGallery(parsed);
                    return;
                }
            }
        };

        document.addEventListener('paste', handlePaste);
        return () => document.removeEventListener('paste', handlePaste);
    }, [addImages, toast, loadUrlsToGallery]);

    // ======== AI Classification ========
    const handleClassify = async () => {
        const ai = getAiInstance();
        if (!ai) {
            toast.error('请先设置 API 密钥');
            return;
        }

        const unclassified = images.filter(img => !img.classified);
        if (unclassified.length === 0) {
            toast.info('所有图片都已分类');
            return;
        }

        setClassifying(true);
        abortRef.current = false;
        setProgress({ done: 0, total: unclassified.length });

        const userCats = userCategories;

        const batches: SorterImage[][] = [];
        for (let i = 0; i < unclassified.length; i += imageBatchSize) {
            batches.push(unclassified.slice(i, i + imageBatchSize));
        }

        const counter = { done: 0 };

        // Process batches concurrently with BATCH_CONCURRENCY workers
        let batchIdx = 0;

        const classifySingle = async (item: SorterImage): Promise<{ category: string; tags: string[] }> => {
            if (!item.src || item.loadFailed) {
                return { category: userCats.length > 0 ? '其他' : '未识别', tags: [] };
            }

            try {
                const resized = await resizeImageForAI(item.src, MAX_IMAGE_DIM);
                const match = resized.match(/^data:([^;]+);base64,(.+)$/);
                if (!match) {
                    return { category: userCats.length > 0 ? '其他' : '未识别', tags: [] };
                }

                const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
                    { text: '[图片 1]' },
                    { inlineData: { data: match[2], mimeType: match[1] } },
                ];

                let prompt = `你是一个图片分类标签专家。请分析这 1 张图片。\n\n`;
                if (userCats.length > 0) {
                    prompt += `【主分类】请严格从以下分类中选择一个，必须逐字匹配：\n`;
                    prompt += userCats.map(c => `"${c}"`).join('、') + '\n';
                    prompt += `不匹配时返回"其他"。\n\n`;
                } else {
                    prompt += `【主分类】请输出最合适的主分类。\n\n`;
                }
                prompt += `【标签】输出 3-5 个中文标签。\n`;
                prompt += `只返回 JSON，不要 markdown：{"category":"分类名","tags":["标签1","标签2"]}`;
                parts.push({ text: prompt });

                const response = await ai.models.generateContent({
                    model: classifyModel,
                    contents: [{ role: 'user', parts }],
                    config: { responseMimeType: 'application/json' },
                });

                let text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
                let parsed: any = {};
                try {
                    parsed = JSON.parse(text);
                } catch {
                    parsed = {};
                }
                if (Array.isArray(parsed)) parsed = parsed[0] || {};

                return {
                    category: normalizeCategoryWithUserCats(parsed.category, userCats),
                    tags: normalizeTags(parsed.tags),
                };
            } catch {
                return { category: userCats.length > 0 ? '其他' : '未识别', tags: [] };
            }
        };

        const processBatch = async (batch: SorterImage[]) => {
            if (abortRef.current) return;
            try {
                const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [];
                const processableIndices: number[] = [];

                // Track which batch indices actually got sent (skip failed resizes)
                const indexMap: number[] = []; // indexMap[sentIdx] = batchIdx
                const refToBatchIndex = new Map<string, number>();
                let sentCount = 0;

                for (let i = 0; i < batch.length; i++) {
                    if (!batch[i].src || batch[i].loadFailed) continue; // skip failed images
                    processableIndices.push(i);
                    try {
                        const resized = await resizeImageForAI(batch[i].src, MAX_IMAGE_DIM);
                        const match = resized.match(/^data:([^;]+);base64,(.+)$/);
                        if (match) {
                            sentCount++;
                            const ref = `REF_${sentCount}_${batch[i].id.slice(-8)}`;
                            parts.push({ text: `[图片 ${sentCount}] [REF:${ref}]` });
                            parts.push({ inlineData: { data: match[2], mimeType: match[1] } });
                            indexMap.push(i); // sentCount-1 maps to batch index i
                            refToBatchIndex.set(ref, i);
                        }
                    } catch {
                        console.warn(`图片 ${i + 1} resize 失败，跳过`);
                    }
                }

                let results: Array<{
                    index: number;
                    ref?: string;
                    category: string;
                    tags: string[];
                }> = [];

                if (sentCount > 0) {
                    let prompt = `你是一个图片分类标签专家。请分析以下 ${sentCount} 张图片。\n\n`;

                    if (userCats.length > 0) {
                        prompt += `【主分类】请将每张图片归入以下分类之一（必须严格使用下面给出的原始名称，禁止使用同义词、近义词或改写）：\n`;
                        prompt += userCats.map(c => `"${c}"`).join('、') + '\n';
                        prompt += `⚠️ 分类名必须与上面完全一致，逐字匹配。例如用户给 "没人" 就必须返回 "没人"，不能返回 "无人"。\n`;
                        prompt += `如果图片不属于以上任何分类，使用"其他"。\n\n`;
                    } else {
                        prompt += `【主分类】请根据图片内容自动判断一个最合适的主分类（如：人物、风景、产品、食物、建筑、动物、插画、抽象等）。\n\n`;
                    }

                    prompt += `【标签】同时为每张图片生成 3-5 个描述性标签（必须使用中文），涵盖：内容主体、色调/配色、构图风格、情绪氛围等。\n\n`;
                    prompt += `请严格按以下 JSON 格式返回（不要有其他文字，不要有 markdown 代码块）：\n`;
                    prompt += `[{"index":1,"ref":"REF_1_xxxx","category":"分类名","tags":["标签1","标签2","标签3"]},{"index":2,...}]\n`;
                    prompt += `注意：ref 字段必须原样回填为你看到的 REF 值，不可改写。`;

                    parts.push({ text: prompt });

                    const response = await ai.models.generateContent({
                        model: classifyModel,
                        contents: [{ role: 'user', parts }],
                        config: { responseMimeType: 'application/json' },
                    });

                    let text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                    text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();

                    try {
                        const parsed = JSON.parse(text);
                        results = Array.isArray(parsed)
                            ? parsed
                            : (Array.isArray((parsed as any)?.results) ? (parsed as any).results : []);
                    } catch {
                        console.warn('AI 返回解析失败，回退逐张:', text);
                    }
                }

                const mapped = new Map<number, { category: string; tags: string[] }>();
                const assignedBatchIndices = new Set<number>();
                const unresolved: typeof results = [];

                for (const r of results) {
                    let mappedBatchIdx: number | undefined;
                    const ref = String(r.ref ?? '').trim();
                    if (ref && refToBatchIndex.has(ref)) {
                        mappedBatchIdx = refToBatchIndex.get(ref);
                    } else {
                        const sentIdx = Number(r.index) - 1; // AI returns 1-based index
                        if (Number.isFinite(sentIdx) && sentIdx >= 0 && sentIdx < indexMap.length) {
                            mappedBatchIdx = indexMap[sentIdx];
                        }
                    }

                    if (mappedBatchIdx === undefined || assignedBatchIndices.has(mappedBatchIdx)) {
                        unresolved.push(r);
                        continue;
                    }

                    mapped.set(mappedBatchIdx, {
                        category: normalizeCategoryWithUserCats(r.category, userCats),
                        tags: normalizeTags(r.tags),
                    });
                    assignedBatchIndices.add(mappedBatchIdx);
                }

                // Fallback 1: unresolved results map by remaining order.
                if (unresolved.length > 0) {
                    const remainingByOrder = indexMap.filter((idx) => !assignedBatchIndices.has(idx));
                    for (let i = 0; i < unresolved.length && i < remainingByOrder.length; i++) {
                        const bIdx = remainingByOrder[i];
                        const r = unresolved[i];
                        mapped.set(bIdx, {
                            category: normalizeCategoryWithUserCats(r.category, userCats),
                            tags: normalizeTags(r.tags),
                        });
                        assignedBatchIndices.add(bIdx);
                    }
                }

                // Fallback 2: remaining items retry one-by-one (similar to AI 图片识别批次回退).
                const remainingForSingle = processableIndices.filter((idx) => !assignedBatchIndices.has(idx));
                for (const bIdx of remainingForSingle) {
                    if (abortRef.current) break;
                    const single = await classifySingle(batch[bIdx]);
                    mapped.set(bIdx, single);
                    assignedBatchIndices.add(bIdx);
                }

                // Last fallback: ensure every processable item gets deterministic values.
                for (const bIdx of processableIndices) {
                    if (!mapped.has(bIdx)) {
                        mapped.set(bIdx, {
                            category: userCats.length > 0 ? '其他' : '未识别',
                            tags: [],
                        });
                    }
                }

                // Also mark non-processable items in this batch, so no item remains "unclassified" forever.
                for (let i = 0; i < batch.length; i++) {
                    if (mapped.has(i)) continue;
                    const item = batch[i];
                    mapped.set(i, {
                        category: item.loadFailed ? (item.category || '加载失败') : (userCats.length > 0 ? '其他' : '未识别'),
                        tags: item.tags || [],
                    });
                }

                const batchIdToIdx = new Map(batch.map((item, idx) => [item.id, idx]));
                setImages(prev => prev.map((img) => {
                    const bIdx = batchIdToIdx.get(img.id);
                    if (bIdx === undefined) return img;
                    const result = mapped.get(bIdx);
                    if (!result) return img;
                    return {
                        ...img,
                        category: result.category,
                        tags: result.tags,
                        classified: true,
                    };
                }));

            } catch (err: any) {
                console.error('Classification error:', err);
            } finally {
                counter.done += batch.length;
                setProgress({ done: counter.done, total: unclassified.length });
            }
        };

        // Launch concurrent workers
        const batchWorker = async () => {
            while (batchIdx < batches.length) {
                if (abortRef.current) break;
                const myBatch = batches[batchIdx++];
                await processBatch(myBatch);
            }
        };

        try {
            const workers = Array.from(
                { length: Math.min(BATCH_CONCURRENCY, batches.length) },
                () => batchWorker()
            );
            await Promise.all(workers);
        } finally {
            setClassifying(false);
            setProgress({ done: 0, total: 0 });
            toast.success(`分类完成！共处理 ${counter.done} 张图片`);
        }
    };

    // ======== Selection ========
    const toggleSelect = (id: string) => {
        setSelectedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    };

    const selectAll = () => {
        setSelectedIds(new Set(filteredImages.map(img => img.id)));
    };

    const selectNone = () => {
        setSelectedIds(new Set());
    };

    // ======== Copy to Sheets ========
    const copyToSheets = async () => {
        // If user selected specific images, copy those; otherwise copy ALL images
        const hasSelection = selectedIds.size > 0;
        const pool = hasSelection
            ? images.filter(img => selectedIds.has(img.id))
            : images;

        if (pool.length === 0) {
            toast.warning('\u6ca1\u6709\u53ef\u590d\u5236\u7684\u56fe\u7247');
            return;
        }

        // Stable deterministic order; dedupe by id to avoid accidental duplicates in clipboard payload.
        const seenIds = new Set<string>();
        const ordered = [...pool]
            .filter((img) => {
                if (seenIds.has(img.id)) return false;
                seenIds.add(img.id);
                return true;
            })
            .sort((a, b) => a.originalIndex - b.originalIndex);

        const lines: string[] = [];
        const header = ['序号', '图片', '分类', '标签', '比例', '尺寸', '状态', '文件名', '来源链接'];
        lines.push(header.join('\t'));
        let hasUrl = false;
        for (let i = 0; i < ordered.length; i++) {
            const img = ordered[i];
            const imageFormula = img.originalUrl
                ? `=IMAGE("${img.originalUrl.replace(/"/g, '""')}")`
                : (img.loadFailed ? '[加载失败]' : `[\u672c\u5730\u56fe\u7247: ${img.name}]`);
            if (img.originalUrl) hasUrl = true;
            const category = img.category?.trim() || (img.classified ? '未识别' : '未分类');
            const tags = (img.tags && img.tags.length > 0) ? img.tags.join('\u3001') : '-';
            const ratio = img.aspectRatio || '-';
            const size = (img.width && img.height) ? `${img.width}×${img.height}` : '-';
            const status = img.loadFailed ? '加载失败' : (img.classified ? '已分类' : '未分类');
            const row = [
                String(i + 1),
                imageFormula, // keep formula raw so Sheets can evaluate
                escapeTsvCell(category),
                escapeTsvCell(tags),
                escapeTsvCell(ratio),
                escapeTsvCell(size),
                escapeTsvCell(status),
                escapeTsvCell(img.name || ''),
                escapeTsvCell(img.originalUrl || '-'),
            ];
            lines.push(row.join('\t'));
        }
        const tsv = lines.join('\n');

        try {
            await navigator.clipboard.writeText(tsv);
            const total = lines.length - 1; // data rows
            const filled = ordered.filter(img => !img.loadFailed).length;
            const gaps = total - filled;
            let label = `\u5df2复制列表：表头 + ${total} 行数据`;
            if (gaps > 0) label += `\uff08其中 ${gaps} 行加载失败占位\uff09`;
            if (hasUrl) {
                toast.success(`${label}\uff0c\u7c98\u8d34\u5230 Google Sheets \u540e\u56fe\u7247\u516c\u5f0f\u4f1a\u81ea\u52a8\u663e\u793a`);
            } else {
                toast.success(label);
            }
        } catch {
            toast.error('\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u6743\u9650');
        }
    };

    // ======== Tag toggle ========
    const toggleTag = (tag: string) => {
        setActiveTags(prev => {
            const next = new Set(prev);
            if (next.has(tag)) next.delete(tag);
            else next.add(tag);
            return next;
        });
    };

    // ======== Clear all ========
    const clearAll = () => {
        setImages([]);
        setSelectedIds(new Set());
        setActiveCategory(null);
        setActiveTags(new Set());
        setActiveRatio(null);
        nextIndexRef.current = 0;
        setProgress({ done: 0, total: 0 });
    };

    // ======== Render ========

    // Empty state - no images loaded
    if (images.length === 0) {
        return (
            <div className="image-sorter">
                <div className="is-toolbar">
                    <div className="is-toolbar-title">
                        <Grid3x3 size={18} />
                        图片智能分拣
                    </div>
                </div>

                <div
                    className={`is-dropzone-area ${dragging ? 'dragging' : ''}`}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onClick={() => fileInputRef.current?.click()}
                >
                    <div className="is-dropzone-icon">📂</div>
                    <div className="is-dropzone-title">拖拽图片到这里，或点击选择</div>
                    <div className="is-dropzone-subtitle">
                        支持批量加载数百张图片。也可以直接 <strong>Ctrl+V 粘贴</strong> 从 Google Sheets、网页或剪贴板中的图片/URL。
                        <br /><br />
                        AI 会自动识别每张图的主分类和描述标签，你可以按类别筛选后一键复制到表格。
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleFileSelect}
                    />
                </div>
            </div>
        );
    }

    // Main UI with images loaded
    return (
        <div className="image-sorter">
            {/* Toolbar */}
            <div className="is-toolbar">
                <div className="is-toolbar-title">
                    <Grid3x3 size={18} />
                    图片智能分拣
                </div>

                <div className="is-toolbar-stats">
                    <span>📷 {images.length} 张</span>
                    {classifiedCount > 0 && <span>✅ {classifiedCount} 已分类</span>}
                    {allCategories.size > 0 && <span>📁 {allCategories.size} 个分类</span>}
                    {allTags.size > 0 && <span>🏷️ {allTags.size} 个标签</span>}
                    {allRatios.size > 0 && <span>📐 {allRatios.size} 种比例</span>}
                </div>

                <div className="is-toolbar-actions">
                    <div className="is-view-toggle" title="切换显示模式">
                        <button
                            type="button"
                            className={`is-btn is-btn-sm ${galleryMode === 'list' ? 'is-btn-primary' : ''}`}
                            onClick={() => setGalleryMode('list')}
                        >
                            <List size={12} /> 列表
                        </button>
                        <button
                            type="button"
                            className={`is-btn is-btn-sm ${galleryMode === 'grid' ? 'is-btn-primary' : ''}`}
                            onClick={() => setGalleryMode('grid')}
                        >
                            <Grid3x3 size={12} /> 网格
                        </button>
                    </div>
                    <div className="is-batch-control" title="选择 AI 模型">
                        <span className="is-batch-control-label">模型</span>
                        <select
                            className="is-batch-control-select"
                            value={classifyModel}
                            disabled={classifying}
                            onChange={(e) => setClassifyModel(e.target.value)}
                        >
                            {MODEL_OPTIONS.map((m) => (
                                <option key={m.value} value={m.value}>{m.label}</option>
                            ))}
                        </select>
                    </div>
                    <div className="is-batch-control" title="批次越小越稳，速度略慢">
                        <span className="is-batch-control-label">批次</span>
                        <select
                            className="is-batch-control-select"
                            value={imageBatchSize}
                            disabled={classifying}
                            onChange={(e) => setImageBatchSize(Number(e.target.value))}
                        >
                            {BATCH_SIZE_OPTIONS.map((size) => (
                                <option key={size} value={size}>{size}</option>
                            ))}
                        </select>
                    </div>
                    <button
                        className="is-btn"
                        onClick={() => fileInputRef.current?.click()}
                    >
                        <ImagePlus size={14} /> 添加图片
                    </button>

                    {!classifying ? (
                        <button
                            className="is-btn is-btn-primary"
                            onClick={handleClassify}
                            disabled={images.length === 0}
                        >
                            <Sparkles size={14} />
                            {classifiedCount > 0
                                ? `继续分类 (${images.length - classifiedCount} 张, 批次${imageBatchSize})`
                                : `开始 AI 分类 (${images.length} 张, 批次${imageBatchSize})`}
                        </button>
                    ) : (
                        <button
                            className="is-btn is-btn-danger"
                            onClick={() => { abortRef.current = true; }}
                        >
                            <StopCircle size={14} /> 停止
                        </button>
                    )}

                    <button className="is-btn is-btn-danger" onClick={clearAll}>
                        <Trash2 size={14} /> 清空
                    </button>

                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleFileSelect}
                    />
                </div>
            </div>

            {/* Config: user categories - chip mode */}
            <div className="is-config-panel">
                <div className="is-config-row">
                    <span className="is-config-label">自定义分类：</span>
                    <div className="is-chips-wrapper">
                        {userCategories.map((cat, i) => (
                            <span key={i} className="is-chip">
                                {cat}
                                <button
                                    className="is-chip-remove"
                                    onClick={() => setUserCategories(prev => prev.filter((_, idx) => idx !== i))}
                                    disabled={classifying}
                                >×</button>
                            </span>
                        ))}
                        <input
                            className="is-chips-input"
                            placeholder={userCategories.length === 0 ? '输入分类名按回车添加，或从表格粘贴。留空则 AI 自动分类' : '继续添加...'}
                            value={catInput}
                            onChange={e => setCatInput(e.target.value)}
                            disabled={classifying}
                            onKeyDown={e => {
                                if (e.key === 'Enter' && catInput.trim()) {
                                    e.preventDefault();
                                    const newCats = catInput.split(/[,，、\t\n]/).map(s => s.trim()).filter(Boolean);
                                    setUserCategories(prev => [...prev, ...newCats.filter(c => !prev.includes(c))]);
                                    setCatInput('');
                                } else if (e.key === 'Backspace' && !catInput && userCategories.length > 0) {
                                    setUserCategories(prev => prev.slice(0, -1));
                                }
                            }}
                            onPaste={e => {
                                const text = e.clipboardData.getData('text/plain');
                                if (text.includes('\t') || text.includes('\n') || text.includes(',') || text.includes('，') || text.includes('、')) {
                                    e.preventDefault();
                                    const newCats = text.split(/[,，、\t\n]/).map(s => s.trim()).filter(Boolean);
                                    setUserCategories(prev => [...prev, ...newCats.filter(c => !prev.includes(c))]);
                                    setCatInput('');
                                }
                            }}
                        />
                    </div>
                    <span className="is-config-hint">
                        {userCategories.length > 0 ? `✅ ${userCategories.length} 个分类` : '🤖 AI 自动判断分类'}
                    </span>
                </div>
            </div>

            {/* Progress bar (during loading or classification) */}
            {progress.total > 0 && (
                <div className="is-progress-panel">
                    <div className="is-progress-bar-track">
                        <div
                            className="is-progress-bar-fill"
                            style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
                        />
                    </div>
                    <div className="is-progress-text">
                        <span><Loader2 size={12} className="animate-spin" style={{ display: 'inline', marginRight: 4 }} /> {classifying ? '正在分类...' : '正在加载图片...'}</span>
                        <span>{progress.done} / {progress.total}</span>
                    </div>
                </div>
            )}

            {/* Category filter tabs */}
            {allCategories.size > 0 && (
                <div className="is-filter-bar">
                    <Filter size={14} style={{ color: '#888', flexShrink: 0 }} />
                    <button
                        className={`is-filter-tab ${activeCategory === null ? 'active' : ''}`}
                        onClick={() => setActiveCategory(null)}
                    >
                        全部 <span className="is-tab-count">({images.length})</span>
                    </button>
                    {[...allCategories.entries()].map(([cat, count]) => (
                        <button
                            key={cat}
                            className={`is-filter-tab ${activeCategory === cat ? 'active' : ''}`}
                            onClick={() => setActiveCategory(activeCategory === cat ? null : cat)}
                        >
                            {cat} <span className="is-tab-count">({count})</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Aspect ratio filter */}
            {allRatios.size > 1 && (
                <div className="is-filter-bar">
                    <span style={{ color: '#888', flexShrink: 0, fontSize: '12px' }}>📐</span>
                    <button
                        className={`is-filter-tab ${activeRatio === null ? 'active' : ''}`}
                        onClick={() => setActiveRatio(null)}
                    >
                        全部比例
                    </button>
                    {[...allRatios.entries()].map(([ratio, count]) => (
                        <button
                            key={ratio}
                            className={`is-filter-tab ${activeRatio === ratio ? 'active' : ''}`}
                            onClick={() => setActiveRatio(activeRatio === ratio ? null : ratio)}
                        >
                            {ratio} <span className="is-tab-count">({count})</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Tag cloud */}
            {allTags.size > 0 && (
                <div className="is-tag-cloud">
                    {[...allTags.entries()].slice(0, 50).map(([tag, count]) => (
                        <button
                            key={tag}
                            className={`is-tag ${activeTags.has(tag) ? 'active' : ''}`}
                            onClick={() => toggleTag(tag)}
                        >
                            {tag} <span className="is-tag-count">({count})</span>
                        </button>
                    ))}
                </div>
            )}

            {/* Gallery */}
            <div className={`is-gallery ${galleryMode}`}>
                {filteredImages.map((img, idx) => (
                    <div
                        key={img.id}
                        className={`is-gallery-item ${selectedIds.has(img.id) ? 'selected' : ''}`}
                        onClick={() => toggleSelect(img.id)}
                        style={{ animationDelay: `${Math.min(idx * 20, 500)}ms` }}
                    >
                        <img src={img.src} alt={img.name} loading="lazy" />

                        <span className="is-gallery-index">#{img.originalIndex + 1}</span>

                        {img.aspectRatio && (
                            <span className="is-gallery-ratio">
                                {img.aspectRatio}
                                {img.width && img.height && (
                                    <span style={{ opacity: 0.7, marginLeft: 3, fontSize: '8px' }}>{img.width}×{img.height}</span>
                                )}
                            </span>
                        )}

                        <div className="is-gallery-check">
                            {selectedIds.has(img.id) && <Check size={12} />}
                        </div>

                        {img.classified && (
                            <div className="is-gallery-overlay">
                                {img.category && (
                                    <div className="is-gallery-category">{img.category}</div>
                                )}
                                {img.tags && img.tags.length > 0 && (
                                    <div className="is-gallery-tags">
                                        {img.tags.slice(0, 4).map((tag, i) => (
                                            <span key={i} className="is-gallery-tag">{tag}</span>
                                        ))}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                ))}
            </div>

            {/* Bottom action bar */}
            <div className="is-action-bar">
                <span className="is-action-bar-info">
                    显示 {filteredImages.length} 张
                    {selectedIds.size > 0 && ` · 已选 ${selectedIds.size} 张`}
                </span>

                <button className="is-btn is-btn-sm" onClick={selectAll}>
                    <CheckSquare size={12} /> 全选
                </button>
                <button className="is-btn is-btn-sm" onClick={selectNone}>
                    <X size={12} /> 取消
                </button>

                <button
                    className="is-btn is-btn-primary"
                    onClick={copyToSheets}
                    disabled={images.length === 0}
                >
                    <Copy size={14} /> {selectedIds.size > 0 ? `复制到表格 (${selectedIds.size})` : `复制全部 (${images.length})`}
                </button>
            </div>
        </div>
    );
};

export default ImageSorterApp;
