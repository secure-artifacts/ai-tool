/**
 * 图片智能分拣器 (Image Sorter)
 * 批量加载图片 → AI 自动分类 + 打标签 → 可视化筛选 → 一键复制到 Google Sheets
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { useToast } from '../../components/ui/Toast';
import type { GoogleGenAI } from '@google/genai';
import {
    Upload, Sparkles, Tags, Grid3x3, List, CheckSquare, Copy, Trash2,
    Loader2, StopCircle, Filter, ImagePlus, X, Check, Download, Plus, ChevronDown, Eye, EyeOff, RotateCw, Edit3, RefreshCw, FolderOpen
} from 'lucide-react';
import {
    extractUrlsFromHtml,
    extractUrlsFromHtmlGrouped,
    parsePasteInput,
    processImageUrl,
    fetchImageBlob,
    convertBlobToBase64,
    parseMatrixHtmlTable
} from '../ai-image-recognition/utils';
import { base64ToFile, uploadToGyazo, getGyazoToken } from '../image-review/services/gyazoService';
import JSZip from 'jszip';
import { DIMENSION_PRESETS, ADVANCED_PRESETS } from './presets';
import './ImageSorter.css';

// Native saveAs implementation (replaces file-saver dependency for AI Studio compatibility)
const saveAs = (blob: Blob, filename: string) => {
    if (typeof window === 'undefined') return;
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    }, 100);
};

// ========== Types ==========
interface ClassificationDimension {
    id: string;
    name: string;          // Dimension name, e.g. "场景", "风格"
    description: string;   // Criteria/standard for judging this dimension
    categories: string[];  // Category options for this dimension
    inputValue: string;    // Current input value for chip input
    categoryCriteria?: Record<string, string>; // Individual criteria mapped per category
}

/** 高级分类规则（表格化层级规则，与查重工具的 CustomClassifyRule 一致） */
interface AdvancedClassifyRule {
    id: string;
    name: string;           // 类别名称
    level: string;          // 维度/层级（如 "一级分类", "二级分类"）
    parentCategory: string; // 归属限制（父类名称，留空=顶级）
    criteria: string;       // 判断标准
}

interface SorterImage {
    id: string;
    src: string; // data URL / blob URL / remote URL for display
    originalUrl?: string; // preserve source URL for =IMAGE() formula
    localFile?: File; // keep original file for fast upload/download without base64 conversion
    name: string;
    category?: string;                    // Primary category (first dim or auto) - backward compat
    categories?: Record<string, string>;  // Multi-dimension: dimName → category
    tags?: string[];
    classified: boolean;
    originalIndex: number; // preserve insertion order
    loadFailed?: boolean; // true if image failed to load (placeholder)
    isBlankRow?: boolean; // true if it's an empty structural row
    isGyazoUploading?: boolean; // true while background uploading
    aspectRatio?: string; // e.g. '9:16', '4:5', '1:1'
    width?: number;
    height?: number;
    metadataRows?: string[]; // rows of text found beneath this image in the same column (Matrix Mode)
    originalMatrixColumnIndex?: number; // the column index this image was found in
    folderPath?: string; // relative folder path from webkitRelativePath (e.g. 'root/sub1/sub2')
}

interface ImageSorterAppProps {
    getAiInstance: () => GoogleGenAI | null;
    textModel?: string;
}

// ========== Constants ==========
const DEFAULT_BATCH_SIZE = 10; // 默认批次大小 (10张以内模型分类准确率最高)
const BATCH_SIZE_OPTIONS = [5, 10, 20, 30, 50, 100, 150, 200, 300];
const DEFAULT_MODEL = 'gemini-3-flash-preview';
const BATCH_CONCURRENCY_DEFAULT = 1; // 标准模式默认并发
const TURBO_CONCURRENCY_DEFAULT = 3; // turbo 模式默认并发
const TURBO_MODEL_DEFAULT = 'gemini-2.5-flash'; // Turbo 默认模型
const CONCURRENCY_OPTIONS = [1, 2, 3, 5, 8];
const ALL_MODELS = [
    { value: 'gemini-2.5-flash', label: '⚡ 2.5-flash (GA)' },
    { value: 'gemini-2.5-flash-lite', label: '⚡ 2.5-flash-lite (GA)' },
    { value: 'gemini-2.5-pro', label: '🧠 2.5-pro (GA)' },
    { value: 'gemini-3-flash-preview', label: '3-flash (Preview)' },
    { value: 'gemini-3.1-pro-preview', label: '3.1-pro (Preview)' },
    { value: 'gemini-3.1-flash-lite-preview', label: '3.1-lite (Preview)' },
];
const MAX_RETRIES = 3; // 429 retry attempts
const MAX_IMAGE_DIM = 512; // resize for faster processing
const SIDEBAR_WIDTH_STORAGE_KEY = 'image-sorter-sidebar-width';
const SIDEBAR_MIN_WIDTH = 260;
const SIDEBAR_MAX_WIDTH = 620;

// ========== Folder depth options ==========
type FolderDepthMode = 'first' | 'last' | 'full';
const FOLDER_DEPTH_OPTIONS: { value: FolderDepthMode; label: string }[] = [
    { value: 'first', label: '第一层子文件夹' },
    { value: 'last', label: '最深层子文件夹' },
    { value: 'full', label: '完整路径' },
];

/** Extract folder classification from webkitRelativePath based on depth mode */
const extractFolderCategory = (relativePath: string, depthMode: FolderDepthMode): string => {
    // relativePath format: "rootFolder/sub1/sub2/image.jpg"
    const parts = relativePath.split('/');
    // Remove filename (last part) and root folder (first part, which is the selected folder itself)
    const folderParts = parts.slice(1, -1); // skip root folder name + filename
    if (folderParts.length === 0) return '根目录';
    switch (depthMode) {
        case 'first':
            return folderParts[0];
        case 'last':
            return folderParts[folderParts.length - 1];
        case 'full':
            return folderParts.join(' / ');
        default:
            return folderParts[0];
    }
};

/** Build hierarchical categories map for multi-level folders: { '一级分类': cat1, '二级分类': cat2, ... } */
const extractFolderCategories = (relativePath: string): Record<string, string> => {
    const parts = relativePath.split('/');
    const folderParts = parts.slice(1, -1); // skip root folder name + filename
    const categories: Record<string, string> = {};
    folderParts.forEach((part, i) => {
        categories[`${i + 1}级分类`] = part;
    });
    return categories;
};

/** Recursively read all files from a dropped directory entry */
const readDirectoryEntry = (entry: FileSystemDirectoryEntry): Promise<File[]> => {
    return new Promise((resolve) => {
        const reader = entry.createReader();
        const allFiles: File[] = [];
        const readBatch = () => {
            reader.readEntries(async (entries) => {
                if (entries.length === 0) {
                    resolve(allFiles);
                    return;
                }
                for (const e of entries) {
                    if (e.isFile) {
                        const file = await new Promise<File>((res, rej) => {
                            (e as FileSystemFileEntry).file(res, rej);
                        }).catch(() => null);
                        if (file && file.type.startsWith('image/')) {
                            // Manually set webkitRelativePath via Object.defineProperty
                            // because File from getAsEntry() doesn't preserve it
                            Object.defineProperty(file, 'webkitRelativePath', {
                                value: e.fullPath.replace(/^\//, ''),
                                writable: false,
                            });
                            allFiles.push(file);
                        }
                    } else if (e.isDirectory) {
                        const subFiles = await readDirectoryEntry(e as FileSystemDirectoryEntry);
                        allFiles.push(...subFiles);
                    }
                }
                // readEntries may not return all entries at once, keep reading
                readBatch();
            }, () => resolve(allFiles));
        };
        readBatch();
    });
};






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
        .replace(/[\u201c\u201d\u2018\u2019"'`]/g, '')
        .replace(/[()\uff08\uff09[\]\u3010\u3011{}]/g, '');
};

// Simple Levenshtein distance for fuzzy string matching
const levenshtein = (a: string, b: string): number => {
    if (a.length === 0) return b.length;
    if (b.length === 0) return a.length;
    const matrix: number[][] = [];
    for (let i = 0; i <= a.length; i++) matrix[i] = [i];
    for (let j = 0; j <= b.length; j++) matrix[0][j] = j;
    for (let i = 1; i <= a.length; i++) {
        for (let j = 1; j <= b.length; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            matrix[i][j] = Math.min(
                matrix[i - 1][j] + 1,
                matrix[i][j - 1] + 1,
                matrix[i - 1][j - 1] + cost,
            );
        }
    }
    return matrix[a.length][b.length];
};

const normalizeCategoryWithUserCats = (rawCategory: unknown, userCats: string[]): string => {
    const category = String(rawCategory ?? '').trim();
    if (!category) return userCats.length > 0 ? '其他' : '';
    if (userCats.length === 0) return category;

    // 1. Exact match
    if (userCats.includes(category)) return category;

    // 2. Normalized exact match (strip whitespace, quotes, brackets)
    const normalized = normalizeTextKey(category);
    if (normalized === normalizeTextKey('其他') || normalized === normalizeTextKey('其它')) return '其他';
    const exactNorm = userCats.find((cat) => normalizeTextKey(cat) === normalized);
    if (exactNorm) return exactNorm;

    // 3. Containment match: AI response contains a user category, or vice versa
    //    Prefer the longest matching user category to avoid false positives
    //    e.g. AI returns "虔诚祈祷" -> matches user cat "虔诚"
    let bestContain: string | null = null;
    let bestContainLen = 0;
    for (const cat of userCats) {
        const normCat = normalizeTextKey(cat);
        if (!normCat) continue;
        // AI result contains user category
        if (normalized.includes(normCat) && normCat.length > bestContainLen) {
            bestContain = cat;
            bestContainLen = normCat.length;
        }
        // User category contains AI result (AI returned abbreviation)
        if (normCat.includes(normalized) && normalized.length >= 2 && normCat.length > bestContainLen) {
            bestContain = cat;
            bestContainLen = normCat.length;
        }
    }
    if (bestContain) {
        console.log(`[分拣器] 模糊匹配: AI返回"${category}" → 匹配到"${bestContain}" (包含匹配)`);
        return bestContain;
    }

    // 4. Levenshtein distance: allow up to ~30% edit distance
    let bestLev: string | null = null;
    let bestLevDist = Infinity;
    for (const cat of userCats) {
        const normCat = normalizeTextKey(cat);
        if (!normCat) continue;
        const dist = levenshtein(normalized, normCat);
        const threshold = Math.max(2, Math.floor(Math.max(normalized.length, normCat.length) * 0.3));
        if (dist <= threshold && dist < bestLevDist) {
            bestLevDist = dist;
            bestLev = cat;
        }
    }
    if (bestLev) {
        console.log(`[分拣器] 模糊匹配: AI返回"${category}" → 匹配到"${bestLev}" (编辑距离=${bestLevDist})`);
        return bestLev;
    }

    console.log(`[分拣器] 无法匹配: AI返回"${category}" → 归入"其他" (用户分类: ${userCats.join(', ')})`);
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

const resizeImageForAIWithLabel = (base64: string, maxDim: number, label: string): Promise<string> => {
    return new Promise((resolve) => {
        const img = new Image();
        img.onload = () => {
            const scale = Math.min(1, maxDim / Math.max(img.width, img.height));
            const w = Math.round(img.width * scale);
            const h = Math.round(img.height * scale);
            const labelHeight = Math.max(22, Math.round(w * 0.055));
            const canvas = document.createElement('canvas');
            canvas.width = w;
            canvas.height = h + labelHeight;
            const ctx = canvas.getContext('2d')!;

            ctx.fillStyle = '#ffffff';
            ctx.fillRect(0, 0, w, labelHeight);
            ctx.drawImage(img, 0, labelHeight, w, h);

            ctx.fillStyle = '#111827';
            ctx.font = `700 ${Math.max(14, Math.round(labelHeight * 0.58))}px Arial, sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.fillText(label, 8, labelHeight / 2);

            resolve(canvas.toDataURL('image/jpeg', 0.78));
        };
        img.onerror = () => resolve(base64);
        img.src = base64;
    });
};

const isBlobUrl = (value?: string): boolean => !!value && value.startsWith('blob:');

const yieldToBrowser = (): Promise<void> => {
    return new Promise((resolve) => {
        if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
            window.requestAnimationFrame(() => resolve());
            return;
        }
        setTimeout(() => resolve(), 0);
    });
};

// ========== Component ==========
const ImageSorterApp: React.FC<ImageSorterAppProps> = ({ getAiInstance, textModel }) => {
    // Turbo 模式
    const [turboMode, setTurboMode] = useState(true);

    // Matrix Mode (横版多维大表模式)
    const [dataInputMode, _setDataInputMode] = useState<'standard' | 'matrix'>('standard');
    const dataInputModeRef = useRef(dataInputMode);
    const setDataInputMode = (val: 'standard' | 'matrix') => {
        _setDataInputMode(val);
        dataInputModeRef.current = val;
    };
    const [dataExportMode, setDataExportMode] = useState<'standard' | 'matrix'>('standard');

    const [uploadingGyazo, setUploadingGyazo] = useState<{ done: number; total: number } | null>(null);
    const gyazoAbortRef = useRef(false);
    const [loadingImages, setLoadingImages] = useState<{ done: number; total: number } | null>(null);
    const [downloadProgress, setDownloadProgress] = useState<{ current: number; total: number; status: string } | null>(null);
    const [confirmDownloadState, setConfirmDownloadState] = useState<{ total: number, onlySelected: boolean } | null>(null);
    const [turboModel, setTurboModel] = useState<string>(() => {
        if (typeof window === 'undefined') return TURBO_MODEL_DEFAULT;
        return localStorage.getItem('is-turbo-model') || TURBO_MODEL_DEFAULT;
    });
    const [turboConcurrency, setTurboConcurrency] = useState<number>(() => {
        if (typeof window === 'undefined') return TURBO_CONCURRENCY_DEFAULT;
        const saved = Number(localStorage.getItem('is-turbo-concurrency'));
        return CONCURRENCY_OPTIONS.includes(saved) ? saved : TURBO_CONCURRENCY_DEFAULT;
    });
    const [standardConcurrency, setStandardConcurrency] = useState<number>(() => {
        if (typeof window === 'undefined') return BATCH_CONCURRENCY_DEFAULT;
        const saved = Number(localStorage.getItem('is-standard-concurrency'));
        return CONCURRENCY_OPTIONS.includes(saved) ? saved : BATCH_CONCURRENCY_DEFAULT;
    });
    // 保存设置
    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem('is-turbo-model', turboModel);
        localStorage.setItem('is-turbo-concurrency', String(turboConcurrency));
        localStorage.setItem('is-standard-concurrency', String(standardConcurrency));
    }, [turboModel, turboConcurrency, standardConcurrency]);

    const classifyModel = turboMode ? turboModel : (textModel || DEFAULT_MODEL);
    const effectiveConcurrency = turboMode ? turboConcurrency : standardConcurrency;
    const toast = useToast();

    // State
    const [images, setImages] = useState<SorterImage[]>([]);
    const [editingImage, setEditingImage] = useState<SorterImage | null>(null);
    const [enlargedInput, setEnlargedInput] = useState<{ title: string, value: string, onChange: (val: string) => void } | null>(null);
    const imagesRef = useRef<SorterImage[]>([]);
    const [classifying, setClassifying] = useState(false);
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [apiCallCount, setApiCallCount] = useState(0);
    const [dimensions, setDimensions] = useState<ClassificationDimension[]>(() => {
        if (typeof window !== 'undefined') {
            const savedDims = localStorage.getItem('image-sorter-saved-dimensions');
            if (savedDims) {
                try {
                    return JSON.parse(savedDims);
                } catch (e) {
                    console.warn('Failed to parse saved dimensions', e);
                }
            }
        }
        const savedId = typeof window !== 'undefined' ? localStorage.getItem('image-sorter-category-preset') : null;
        const preset = DIMENSION_PRESETS.find(p => p.id === (savedId || 'default')) || DIMENSION_PRESETS[0];
        if (!preset || preset.dimensions.length === 0) {
            return [{ id: 'dim-default', name: '分类', description: '', categories: [], inputValue: '' }];
        }
        return preset.dimensions.map((d, i) => ({
            id: `dim-preset-${Date.now()}-${i}`,
            name: d.name,
            description: d.description,
            categories: [...d.categories],
            categoryCriteria: d.categoryCriteria ? { ...d.categoryCriteria } : undefined,
            inputValue: '',
        }));
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem('image-sorter-saved-dimensions', JSON.stringify(dimensions));
    }, [dimensions]);

    // 高级分类模式
    const [classifyMode, setClassifyMode] = useState<'basic' | 'advanced'>(() => {
        if (typeof window === 'undefined') return 'basic';
        return (localStorage.getItem('image-sorter-classify-mode') as 'basic' | 'advanced') || 'basic';
    });
    const [advancedRules, setAdvancedRules] = useState<AdvancedClassifyRule[]>(() => {
        if (typeof window === 'undefined') return [];
        try {
            const saved = localStorage.getItem('image-sorter-advanced-rules');
            return saved ? JSON.parse(saved) : [];
        } catch { return []; }
    });
    const [showAdvancedRules, setShowAdvancedRules] = useState(false);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem('image-sorter-classify-mode', classifyMode);
    }, [classifyMode]);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem('image-sorter-advanced-rules', JSON.stringify(advancedRules));
    }, [advancedRules]);
    const [disambiguationHints, setDisambiguationHints] = useState<string>(() => {
        if (typeof window === 'undefined') return '';
        return localStorage.getItem('image-sorter-disambiguation-hints') || '';
    });
    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem('image-sorter-disambiguation-hints', disambiguationHints);
    }, [disambiguationHints]);

    // 高级分类辅助：从规则列表提取唯一的层级名称（按出现顺序）
    const advancedLevels = React.useMemo(() => {
        const seen = new Set<string>();
        const levels: string[] = [];
        for (const rule of advancedRules) {
            const lvl = rule.level.trim();
            if (lvl && !seen.has(lvl)) {
                seen.add(lvl);
                levels.push(lvl);
            }
        }
        return levels;
    }, [advancedRules]);
    const [activeFilters, setActiveFilters] = useState<Record<string, string | null>>({});
    const [collapsedDims, setCollapsedDims] = useState<Record<string, boolean>>({});
    const [activeTags, setActiveTags] = useState<Set<string>>(new Set());
    const [activeRatio, setActiveRatio] = useState<string | null>(null);
    const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
    const [selectMode, setSelectMode] = useState(false);
    const [galleryMode, setGalleryMode] = useState<'list' | 'grid'>('grid');
    const abortRef = useRef(false);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const folderInputRef = useRef<HTMLInputElement>(null);
    const nextIndexRef = useRef(0);
    const [folderDepthMode, setFolderDepthMode] = useState<FolderDepthMode>(() => {
        if (typeof window === 'undefined') return 'first';
        return (localStorage.getItem('image-sorter-folder-depth') as FolderDepthMode) || 'first';
    });
    const [dragging, setDragging] = useState(false);
    const [imageBatchSize, setImageBatchSize] = useState<number>(() => {
        if (typeof window === 'undefined') return DEFAULT_BATCH_SIZE;
        const raw = Number(localStorage.getItem('image-sorter-image-batch-size'));
        if (BATCH_SIZE_OPTIONS.includes(raw)) return raw;
        return DEFAULT_BATCH_SIZE;
    });
    const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
        if (typeof window === 'undefined') return 320;
        const raw = Number(localStorage.getItem(SIDEBAR_WIDTH_STORAGE_KEY));
        if (!Number.isFinite(raw)) return 320;
        return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, raw));
    });

    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem('image-sorter-image-batch-size', String(imageBatchSize));
    }, [imageBatchSize]);

    useEffect(() => {
        imagesRef.current = images;
    }, [images]);

    const revokeObjectUrlIfNeeded = useCallback((url?: string) => {
        if (!isBlobUrl(url)) return;
        try {
            URL.revokeObjectURL(url!);
        } catch {
            // ignore revoke failures
        }
    }, []);

    useEffect(() => {
        return () => {
            imagesRef.current.forEach((img) => revokeObjectUrlIfNeeded(img.src));
        };
    }, [revokeObjectUrlIfNeeded]);

    const clampSidebarWidth = useCallback((nextWidth: number) => {
        if (typeof window === 'undefined') {
            return Math.min(SIDEBAR_MAX_WIDTH, Math.max(SIDEBAR_MIN_WIDTH, nextWidth));
        }
        const viewportMax = Math.max(SIDEBAR_MIN_WIDTH, Math.min(SIDEBAR_MAX_WIDTH, window.innerWidth - 320));
        return Math.min(viewportMax, Math.max(SIDEBAR_MIN_WIDTH, nextWidth));
    }, []);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem(SIDEBAR_WIDTH_STORAGE_KEY, String(sidebarWidth));
    }, [sidebarWidth]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const onResize = () => {
            setSidebarWidth(prev => clampSidebarWidth(prev));
        };
        window.addEventListener('resize', onResize);
        return () => window.removeEventListener('resize', onResize);
    }, [clampSidebarWidth]);

    const startSidebarResize = useCallback((e: React.MouseEvent<HTMLDivElement>) => {
        if (typeof window === 'undefined' || window.innerWidth <= 768) return;
        e.preventDefault();
        const startX = e.clientX;
        const startWidth = sidebarWidth;

        const onMouseMove = (moveEvent: MouseEvent) => {
            const delta = moveEvent.clientX - startX;
            setSidebarWidth(clampSidebarWidth(startWidth + delta));
        };

        const onMouseUp = () => {
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
            window.removeEventListener('mousemove', onMouseMove);
            window.removeEventListener('mouseup', onMouseUp);
        };

        document.body.style.cursor = 'col-resize';
        document.body.style.userSelect = 'none';
        window.addEventListener('mousemove', onMouseMove);
        window.addEventListener('mouseup', onMouseUp);
    }, [sidebarWidth, clampSidebarWidth]);



    // State for multi-select assigning categories/tags to a dimension
    const [pendingAssignItems, setPendingAssignItems] = useState<Array<{ source: string; value: string }>>([]);
    const [assignTargetDim, setAssignTargetDim] = useState('');
    const [assignIsNewDim, setAssignIsNewDim] = useState(true);

    // Custom prompt instructions (user-editable)
    const [customInstructions, setCustomInstructions] = useState<string>(() => {
        if (typeof window === 'undefined') return '';
        return localStorage.getItem('image-sorter-custom-instructions') || '';
    });
    const [ignoreTextContent, setIgnoreTextContent] = useState<boolean>(() => {
        if (typeof window === 'undefined') return true;
        const saved = localStorage.getItem('image-sorter-ignore-text');
        return saved === null ? true : saved === 'true';
    });
    const [showPromptPreview, setShowPromptPreview] = useState(false);
    const [lastSentPrompt, setLastSentPrompt] = useState<string>('');

    useEffect(() => {
        if (typeof window === 'undefined') return;
        const key = 'image-sorter-custom-instructions';
        if (customInstructions.trim()) {
            localStorage.setItem(key, customInstructions);
        } else {
            localStorage.removeItem(key);
        }
    }, [customInstructions]);
    useEffect(() => {
        if (typeof window === 'undefined') return;
        localStorage.setItem('image-sorter-ignore-text', String(ignoreTextContent));
    }, [ignoreTextContent]);

    // Helper: get all dimension names (from config + from image data)
    const effectiveDimNames = React.useMemo(() => {
        const names = new Set<string>();
        // 基础模式维度
        dimensions.forEach(d => { if (d.name.trim()) names.add(d.name.trim()); });
        // 高级模式层级
        advancedLevels.forEach(lvl => names.add(lvl));
        // Also include dimensions from classified images (in case config was cleared)
        images.forEach(img => {
            if (img.categories) Object.keys(img.categories).forEach(k => names.add(k));
        });
        return Array.from(names);
    }, [dimensions, images, advancedLevels]);

    // ======== Derived data ========
    // Per-dimension category counts
    const allCategoriesByDim = React.useMemo(() => {
        const result = new Map<string, Map<string, number>>();
        // If no dimensions configured but images have a primary category, use "分类" as label
        images.forEach(img => {
            if (img.categories) {
                for (const [dimName, catValue] of Object.entries(img.categories)) {
                    if (!result.has(dimName)) result.set(dimName, new Map());
                    const dimMap = result.get(dimName)!;
                    dimMap.set(catValue, (dimMap.get(catValue) || 0) + 1);
                }
            } else if (img.category) {
                // Backward compat: single category
                const dimName = dimensions.length > 0 ? dimensions[0].name : '分类';
                if (!result.has(dimName)) result.set(dimName, new Map());
                const dimMap = result.get(dimName)!;
                dimMap.set(img.category, (dimMap.get(img.category) || 0) + 1);
            }
        });
        return result;
    }, [images, dimensions]);

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
        return new Map(Array.from(map.entries()).sort((a, b) => b[1] - a[1]));
    }, [images]);

    const allRatios = React.useMemo(() => {
        const map = new Map<string, number>();
        images.forEach(img => {
            if (img.aspectRatio) {
                map.set(img.aspectRatio, (map.get(img.aspectRatio) || 0) + 1);
            }
        });
        return new Map(Array.from(map.entries()).sort((a, b) => b[1] - a[1]));
    }, [images]);

    const filteredImages = React.useMemo(() => {
        let filtered = images;
        // Apply multi-dimension filters
        for (const [dimName, filterValue] of Object.entries(activeFilters)) {
            if (filterValue) {
                filtered = filtered.filter(img => {
                    if (img.categories) return img.categories[dimName] === filterValue;
                    // Backward compat: single category matches first dim
                    if (img.category && dimName === (dimensions.length > 0 ? dimensions[0].name : '分类')) {
                        return img.category === filterValue;
                    }
                    return false;
                });
            }
        }
        if (activeTags.size > 0) {
            filtered = filtered.filter(img =>
                img.tags && Array.from(activeTags).some(tag => img.tags!.includes(tag))
            );
        }
        if (activeRatio) {
            filtered = filtered.filter(img => img.aspectRatio === activeRatio);
        }
        // Always sort by original paste order
        return [...filtered].sort((a, b) => a.originalIndex - b.originalIndex);
    }, [images, activeFilters, activeTags, activeRatio, dimensions]);

    const classifiedCount = images.filter(img => img.classified).length;

    // ======== Image Loading ========
    const addImages = useCallback(async (files: File[], opts?: { fromFolder?: boolean }) => {
        const imageFiles = files.filter(f => f.type.startsWith('image/'));
        if (imageFiles.length === 0) {
            toast.warning('没有检测到图片文件');
            return;
        }

        const isFromFolder = opts?.fromFolder === true;
        // Detect if files have folder structure (webkitRelativePath contains '/')
        const hasSubfolders = isFromFolder && imageFiles.some(f => {
            const rp = (f as any).webkitRelativePath || '';
            const parts = rp.split('/');
            return parts.length > 2; // root/file vs root/sub/file
        });

        setLoadingImages({ done: 0, total: imageFiles.length });
        // Let React paint loading overlay before starting heavy work.
        await yieldToBrowser();

        const baseIndex = nextIndexRef.current;
        nextIndexRef.current += imageFiles.length;
        let loadedCount = 0;
        let skippedCount = 0;
        const stagedImages: SorterImage[] = [];
        const FLUSH_EVERY = 25;

        // Collect all unique folder categories for auto-dimension setup
        const folderCatsSet = new Set<string>();
        // For multi-level: collect max depth
        let maxFolderDepth = 0;

        for (let fi = 0; fi < imageFiles.length; fi++) {
            const file = imageFiles[fi];
            try {
                const blobUrl = URL.createObjectURL(file);
                const id = `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
                const relativePath = (file as any).webkitRelativePath || '';
                const hasFolderInfo = isFromFolder && relativePath && relativePath.includes('/');

                let folderPath: string | undefined;
                let autoCategories: Record<string, string> | undefined;

                if (hasFolderInfo && hasSubfolders) {
                    folderPath = relativePath.split('/').slice(1, -1).join('/');
                    // Build hierarchical categories
                    autoCategories = extractFolderCategories(relativePath);
                    // Also set primary category based on depth mode
                    const primaryCat = extractFolderCategory(relativePath, folderDepthMode);
                    folderCatsSet.add(primaryCat);
                    // Track max depth
                    const depth = relativePath.split('/').length - 2; // minus root and filename
                    if (depth > maxFolderDepth) maxFolderDepth = depth;
                }

                const imgEntry: SorterImage = {
                    id,
                    src: blobUrl,
                    name: file.name,
                    localFile: file,
                    classified: hasFolderInfo && hasSubfolders,
                    originalIndex: baseIndex + fi,
                    folderPath,
                    ...(autoCategories ? { categories: autoCategories } : {}),
                    ...(hasFolderInfo && hasSubfolders ? {
                        category: extractFolderCategory(relativePath, folderDepthMode)
                    } : {}),
                };
                stagedImages.push(imgEntry);
                loadedCount++;
            } catch {
                console.warn(`Failed to load: ${file.name}`);
                skippedCount++;
            }
            // Flush in small chunks so large imports stay responsive.
            if (stagedImages.length >= FLUSH_EVERY || fi === imageFiles.length - 1) {
                if (stagedImages.length > 0) {
                    const batch = stagedImages.splice(0, stagedImages.length);
                    setImages(prev => [...prev, ...batch]);
                }
            }
            // Update progress and yield regularly to avoid UI starvation.
            if ((fi + 1) % 5 === 0 || fi === imageFiles.length - 1) {
                setLoadingImages({ done: fi + 1, total: imageFiles.length });
                await yieldToBrowser();
            }
        }

        // Auto-setup classification dimensions from folder structure
        if (hasSubfolders && maxFolderDepth > 0) {
            const newDims: ClassificationDimension[] = [];
            for (let level = 1; level <= maxFolderDepth; level++) {
                // Collect unique category names at this level
                const catsAtLevel = new Set<string>();
                imageFiles.forEach(f => {
                    const rp = (f as any).webkitRelativePath || '';
                    const parts = rp.split('/');
                    if (parts.length > level + 1) { // +1 for filename
                        catsAtLevel.add(parts[level]);
                    }
                });
                newDims.push({
                    id: `dim-folder-${Date.now()}-${level}`,
                    name: `${level}级分类`,
                    description: `从文件夹第${level}层自动提取`,
                    categories: Array.from(catsAtLevel).sort(),
                    inputValue: '',
                });
            }
            setDimensions(newDims);
            toast.info(`📂 已按文件夹结构自动创建 ${maxFolderDepth} 层分类维度`);
        }

        setLoadingImages(null);
        if (loadedCount > 0) {
            const suffix = skippedCount > 0 ? `（${skippedCount} 张失败）` : '';
            const folderSuffix = hasSubfolders ? `（已按文件夹自动分类 📂）` : '';
            toast.success(`已加载 ${loadedCount} 张图片${suffix}${folderSuffix}`);
        } else {
            toast.error('图片加载失败，请检查文件是否损坏');
        }
    }, [toast, folderDepthMode]);

    // Drag & Drop
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(true);
    }, []);

    const handleDragLeave = useCallback(() => {
        setDragging(false);
    }, []);

    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);

        // Check if any dropped items are directories via webkitGetAsEntry
        const items = e.dataTransfer.items;
        if (items && items.length > 0) {
            const entries: FileSystemEntry[] = [];
            let hasDir = false;
            for (let i = 0; i < items.length; i++) {
                const entry = items[i].webkitGetAsEntry?.();
                if (entry) {
                    entries.push(entry);
                    if (entry.isDirectory) hasDir = true;
                }
            }
            if (hasDir) {
                // Recursively collect all image files from directories
                toast.info('📂 正在扫描文件夹...');
                const allFiles: File[] = [];
                for (const entry of entries) {
                    if (entry.isDirectory) {
                        const dirFiles = await readDirectoryEntry(entry as FileSystemDirectoryEntry);
                        allFiles.push(...dirFiles);
                    } else if (entry.isFile) {
                        const file = await new Promise<File | null>((res) => {
                            (entry as FileSystemFileEntry).file(res, () => res(null));
                        });
                        if (file) allFiles.push(file);
                    }
                }
                addImages(allFiles, { fromFolder: true });
                return;
            }
        }

        // Fallback: standard file drop
        const files = Array.from(e.dataTransfer.files);
        addImages(files);
    }, [addImages, toast]);

    // File input
    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        addImages(files);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [addImages]);

    // Folder input
    const handleFolderSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        addImages(files, { fromFolder: true });
        if (folderInputRef.current) folderInputRef.current.value = '';
    }, [addImages]);
    // Remove auto Gyazo uploading. Users should click "上传 Gyazo 图床" explicitly.

    // Paste - rewritten to match AI Image Recognition tool logic exactly
    // Helper: load URLs concurrently and add to gallery
    const loadUrlsToGallery = useCallback(async (urlItems: { url: string; content?: string; isBlankRow?: boolean; metadataRows?: string[]; matrixColumnIndex?: number }[]) => {
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
                const { url: fetchUrl, content: origContent, isBlankRow, metadataRows, matrixColumnIndex } = job.item;

                if (isBlankRow) {
                    const placeholder: SorterImage = {
                        id: `img-blank-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        src: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
                        originalUrl: '',
                        name: `[空白行 ${baseIdx + job.index + 1}]`,
                        classified: true, // skip AI processing
                        category: '-',
                        tags: ['-'],
                        originalIndex: baseIdx + job.index,
                        isBlankRow: true,
                    };
                    setImages(prev => [...prev, placeholder]);
                    loaded++;
                    setProgress({ done: loaded + failed, total });
                    continue;
                }

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
                        metadataRows,
                        originalMatrixColumnIndex: matrixColumnIndex,
                    };
                    setImages(prev => [...prev, newImg]);
                    loaded++;
                } catch (err) {
                    console.warn('图片加载失败:', fetchUrl, err);
                    const placeholder: SorterImage = {
                        id: `img-fail-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        // Fallback: keep original URL so browser can still try to render it.
                        src: displayUrl || fetchUrl,
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
            // 2. 检查组件所属的容器是否处于激活可见状态
            const wrapper = document.querySelector('.image-sorter-wrapper');
            if (wrapper && wrapper.getBoundingClientRect().width === 0) {
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

            // 2. 优先处理 =IMAGE 纯文本（与 ai-image-recognition 对齐）
            //    [Image Sorter 专用] 保留空行以维持与 Google Sheets 的行结构对齐
            if (plainText && plainText.includes('=IMAGE')) {
                e.preventDefault();
                const rawLines = plainText.split(/\r?\n/);
                // 去掉尾部连续空行（粘贴时末尾常带多余换行）
                while (rawLines.length > 0 && rawLines[rawLines.length - 1].trim() === '') rawLines.pop();

                const formulaRegex = /=IMAGE\s*\(\s*(?:"([^"]+)"|'([^']+)'|([^,\)\s]+))/gi;
                const urlRegex = /https?:\/\/[^\s\t]+/g;
                const urlItems: { url: string; content?: string; isBlankRow?: boolean }[] = [];

                for (const line of rawLines) {
                    const trimmed = line.trim();
                    if (!trimmed) {
                        // 空行 → 占位行
                        urlItems.push({ url: '', isBlankRow: true });
                        continue;
                    }
                    // 一行内可能有多个 tab 分隔的单元格
                    const cells = trimmed.split('\t');
                    let foundInLine = false;
                    for (const cell of cells) {
                        const c = cell.trim();
                        if (!c) continue;
                        formulaRegex.lastIndex = 0;
                        const fm = Array.from(c.matchAll(formulaRegex));
                        if (fm.length > 0) {
                            for (const m of fm) {
                                const rawUrl = m[1] || m[2] || m[3] || '';
                                if (rawUrl) {
                                    urlItems.push({ url: processImageUrl(rawUrl), content: m[0] });
                                    foundInLine = true;
                                }
                            }
                        } else {
                            urlRegex.lastIndex = 0;
                            const um = Array.from(c.matchAll(urlRegex));
                            for (const u of um) {
                                urlItems.push({ url: processImageUrl(u[0]), content: c });
                                foundInLine = true;
                            }
                        }
                    }
                    // 如果整行没有任何有效 URL/公式，也作为空行占位
                    if (!foundInLine) {
                        urlItems.push({ url: '', isBlankRow: true });
                    }
                }

                if (urlItems.some(item => !item.isBlankRow)) {
                    const blankCount = urlItems.filter(i => i.isBlankRow).length;
                    console.log(`[ImageSorter Paste] Formula items: ${urlItems.length} (含 ${blankCount} 空行占位)`);
                    await loadUrlsToGallery(urlItems);
                    return;
                }
            }

            // 3. HTML（Google Sheets 单元格拷贝）回退
            if (html) {
                const hasTableRows = html.includes('<tr');
                if (hasTableRows) {
                    if (dataInputModeRef.current === 'matrix') {
                        const matrixItems = parseMatrixHtmlTable(html);
                        if (matrixItems.length > 0) {
                            e.preventDefault();
                            const urlItems = matrixItems.map(item => ({
                                url: item.fetchUrl,
                                content: `=IMAGE("${item.originalUrl}")`,
                                metadataRows: item.metadataRows,
                                matrixColumnIndex: item.matrixColumnIndex,
                            }));
                            console.log('[ImageSorter Paste] HTML matrix rows mapped:', urlItems.length);
                            await loadUrlsToGallery(urlItems);
                            return;
                        }
                    }

                    const groups = extractUrlsFromHtmlGrouped(html);
                    if (groups.length > 0) {
                        e.preventDefault();
                        const urlItems = groups.flatMap(group =>
                            group.map(({ originalUrl, fetchUrl }) => ({
                                url: fetchUrl,
                                content: `=IMAGE("${originalUrl}")`,
                            }))
                        );
                        console.log('[ImageSorter Paste] HTML grouped rows:', groups.length, 'items:', urlItems.length);
                        await loadUrlsToGallery(urlItems);
                        return;
                    }
                }

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
                        let originalContent = (index < textLines.length && textLines[index].trim())
                            ? textLines[index]
                            : `=IMAGE("${originalUrl}")`;

                        let actualFetchUrl = fetchUrl;
                        if (index < formulaUrls.length) {
                            actualFetchUrl = formulaUrls[index];
                        } else {
                            const match = originalContent.match(formulaRegex);
                            if (match && match[1]) actualFetchUrl = match[1];
                        }

                        if (!originalContent.includes('=IMAGE')) {
                            originalContent = `=IMAGE("${originalUrl}")`;
                        }

                        return { url: actualFetchUrl, content: originalContent };
                    });

                    console.log('[ImageSorter Paste] HTML extracted items:', urlItems.length);
                    await loadUrlsToGallery(urlItems);
                    return;
                }
            }

            // 4. 纯文本 URL（非公式）
            if (plainText && (plainText.includes('http') || plainText.includes('=IMAGE'))) {
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

    // ======== Multi-select assign categories/tags to a dimension ========
    const togglePendingAssign = (source: string, value: string) => {
        setPendingAssignItems(prev => {
            const exists = prev.some(p => p.source === source && p.value === value);
            if (exists) return prev.filter(p => !(p.source === source && p.value === value));
            return [...prev, { source, value }];
        });
    };

    const applyAssignToDimension = (targetDimName: string) => {
        if (!targetDimName.trim() || pendingAssignItems.length === 0) return;
        const dimName = targetDimName.trim();

        // Collect all unique values to add to the dimension
        const newValues = Array.from(new Set(pendingAssignItems.map(p => p.value)));

        // Ensure the target dimension exists in config
        const existingDim = dimensions.find(d => d.name === dimName);
        if (!existingDim) {
            setDimensions(prev => [...prev, {
                id: `dim-${Date.now()}`,
                name: dimName,
                description: '',
                categories: newValues,
                inputValue: '',
            }]);
        } else {
            const toAdd = newValues.filter(v => !existingDim.categories.includes(v));
            if (toAdd.length > 0) {
                setDimensions(prev => prev.map(d => d.id === existingDim.id
                    ? { ...d, categories: [...d.categories, ...toAdd] }
                    : d
                ));
            }
        }

        // If any source is auto-classify "分类", promote it first
        const hasAutoSource = pendingAssignItems.some(p => p.source === '分类');
        if (hasAutoSource && !dimensions.some(d => d.name === '分类')) {
            const uniqueCats = new Set<string>();
            images.forEach(img => { if (img.category) uniqueCats.add(img.category); });
            setDimensions(prev => {
                if (prev.some(d => d.name === '分类')) return prev;
                return [...prev, {
                    id: `dim-auto-${Date.now()}`,
                    name: '分类',
                    description: '',
                    categories: Array.from(uniqueCats).filter(c => c !== '其他' && c !== '未识别'),
                    inputValue: '',
                }];
            });
        }

        // Batch update images
        let totalCount = 0;
        setImages(prev => prev.map(img => {
            const baseCats = { ...img.categories };
            if (img.category && !baseCats['分类'] && hasAutoSource) {
                baseCats['分类'] = img.category;
            }

            let matched = false;
            for (const item of pendingAssignItems) {
                let itemMatches = false;
                if (item.source === '__tag__') {
                    itemMatches = !!(img.tags && img.tags.includes(item.value));
                } else if (img.categories?.[item.source] === item.value) {
                    itemMatches = true;
                } else if (!img.categories && img.category === item.value && item.source === '分类') {
                    itemMatches = true;
                }
                if (itemMatches) {
                    baseCats[dimName] = item.value;
                    matched = true;
                    break;
                }
            }
            if (!matched) return img;
            totalCount++;
            return { ...img, categories: baseCats };
        }));

        toast.success(`已将 ${totalCount} 张图片的 ${pendingAssignItems.length} 个分类/标签指定到维度「${dimName}」`);
        setPendingAssignItems([]);
    };

    // ======== Promote auto-classification to a named dimension ========
    const promoteAutoToDimension = (dimName: string) => {
        if (!dimName.trim()) return;
        const name = dimName.trim();
        // Collect all unique auto-category values
        const uniqueCats = new Set<string>();
        images.forEach(img => {
            if (img.category) uniqueCats.add(img.category);
        });
        // Create the dimension
        const newDim: ClassificationDimension = {
            id: `dim-${Date.now()}`,
            name,
            description: '',
            categories: Array.from(uniqueCats).filter(c => c !== '其他' && c !== '未识别'),
            inputValue: '',
        };
        setDimensions(prev => [...prev, newDim]);
        // Transfer category -> categories[dimName] for all images
        setImages(prev => prev.map(img => {
            if (!img.category) return img;
            return {
                ...img,
                categories: { ...img.categories, [name]: img.category },
            };
        }));
        toast.success(`已将自动分类结果保存为维度「${name}」，包含 ${uniqueCats.size} 个分类`);
    };

    const handleReclassifyAll = () => {
        if (!confirm('确定要重新分类所有图片吗？已有的分类结果和标签都将被清除！')) return;
        setImages(prev => prev.map(img => ({
            ...img,
            classified: false,
            category: undefined,
            categories: undefined,
            tags: undefined
        })));
        // 自动触发重新分类
        setTimeout(() => handleClassify(), 300);
    };

    const handleSaveEdit = (editedCategory: string, editedCategories: Record<string, string>, editedTags: string[]) => {
        if (!editingImage) return;
        setImages(prev => prev.map(item => item.id === editingImage.id ? {
            ...item,
            category: editedCategory,
            categories: Object.keys(editedCategories).length > 0 ? editedCategories : undefined,
            tags: editedTags,
            classified: true,
        } : item));
        setEditingImage(null);
        toast.success('分类结果已修改');
    };

    const handleSingleReclassify = async (imgId: string, silent = false) => {
        const imgIndex = images.findIndex(i => i.id === imgId);
        if (imgIndex === -1) { if (!silent) toast.error('找不到该图片'); return; }
        const img = images[imgIndex];
        if (!img.src) { if (!silent) toast.error('图片数据为空，无法重新分类'); return; }
        if (img.loadFailed) { if (!silent) toast.error('图片加载失败，无法重新分类'); return; }

        let ai: any;
        try {
            ai = getAiInstance();
        } catch {
            if (!silent) toast.error('请先设置 API 密钥');
            return;
        }
        if (!ai) {
            if (!silent) toast.error('请先设置 API 密钥');
            return;
        }

        if (!silent) toast.info('正在重新分类...', 3000);

        try {
            const activeDims = dimensions.filter(d => d.name.trim());
            const userCats = dimensions.length > 0 ? dimensions[0].categories : [];

            const buildPrompt = () => {
                let prompt = '';
                prompt += `你只能看到一张静态截图，无法听到任何声音。所有判断必须纯粹基于画面视觉特征（背景、文字密度、人物、色调等）。\n`;
                prompt += `请按以下层级分类体系对图片进行分类：\n\n`;

                for (const lvl of advancedLevels) {
                    const rulesInLevel = advancedRules.filter(r => r.level.trim() === lvl);
                    const byParent = new Map<string, AdvancedClassifyRule[]>();
                    for (const r of rulesInLevel) {
                        const p = r.parentCategory.trim() || '';
                        if (!byParent.has(p)) byParent.set(p, []);
                        byParent.get(p)!.push(r);
                    }

                    prompt += `【${lvl}】`;
                    if (byParent.size === 1 && byParent.has('')) {
                        const items = byParent.get('')!;
                        prompt += `从以下选项中选一个：\n`;
                        prompt += items.map(r => r.criteria ? `"${r.name}" (${r.criteria})` : `"${r.name}"`).join('、') + '\n';
                    } else {
                        prompt += `根据上一层的分类结果，从对应子类中选择：\n`;
                        for (const [parent, items] of Array.from(byParent)) {
                            if (parent) {
                                prompt += `  若上级="${parent}" → `;
                                prompt += items.map(r => r.criteria ? `"${r.name}" (${r.criteria})` : `"${r.name}"`).join('、') + '\n';
                            } else {
                                prompt += `  通用选项：`;
                                prompt += items.map(r => r.criteria ? `"${r.name}" (${r.criteria})` : `"${r.name}"`).join('、') + '\n';
                            }
                        }
                    }
                    prompt += `不匹配时返回"其他"。\n\n`;
                }

                if (disambiguationHints.trim()) {
                    prompt += `【判断提示】${disambiguationHints.trim()}\n\n`;
                }

                const dimFields = advancedLevels.map(l => `"${l}":"分类名"`).join(',');
                return { prompt, dimFields };
            };

            const resized = await resizeImageForAI(img.src, MAX_IMAGE_DIM);
            const match = resized.match(/^data:([^;]+);base64,(.+)$/);
            if (!match) throw new Error('Failed to process image');

            const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
                { text: '[图片 1]' },
                { inlineData: { data: match[2], mimeType: match[1] } },
            ];

            let prompt = `你是一个图片分类标签专家。请分析这 1 张图片。\n\n`;
            if (ignoreTextContent) {
                prompt += `【重要】请根据画面的视觉内容进行分类：关注背景图像、整体构图、画面风格和版式设计。图片中可能包含文字，但不需要阅读或理解文字的具体含义——只需将文字视为画面的视觉设计元素（如排版风格、字体布局）来辅助判断画面类型。\n\n`;
            }

            if (classifyMode === 'advanced' && advancedRules.length > 0) {
                const { prompt: advPrompt, dimFields } = buildPrompt();
                prompt += advPrompt;
                prompt += `【标签】输出 3-5 个中文标签。\n`;
                if (customInstructions.trim()) prompt += `\n【额外要求】${customInstructions.trim()}\n\n`;
                prompt += `只返回 JSON，不要 markdown：{"categories":{${dimFields}},"tags":["标签1","标签2"]}`;
            } else if (activeDims.length > 0) {
                prompt += `请按以下 ${activeDims.length} 个维度分别分析：\n\n`;
                activeDims.forEach((dim, i) => {
                    prompt += `【维度${i + 1}: ${dim.name}】`;
                    if (dim.categories.length > 0) {
                        if (dim.description?.trim()) prompt += `\n判断标准：${dim.description.trim()}\n`;
                        prompt += `请从以下分类中选择一个，必须逐字匹配：\n`;
                        if (dim.categoryCriteria && Object.keys(dim.categoryCriteria).length > 0) {
                            prompt += dim.categories.map(c => dim.categoryCriteria![c] ? `"${c}" (判定条件: ${dim.categoryCriteria![c]})` : `"${c}"`).join('、') + '\n';
                        } else {
                            prompt += dim.categories.map(c => `"${c}"`).join('、') + '\n';
                        }
                        prompt += `不匹配时返回"其他"。\n\n`;
                    } else if (dim.description?.trim()) {
                        prompt += `\n问题/要求：${dim.description.trim()}\n`;
                        prompt += `请根据以上问题/要求回答。\n\n`;
                    } else {
                        prompt += `请自动判断最合适的分类。\n\n`;
                    }
                });
            } else if (userCats.length > 0) {
                prompt += `【主分类】请严格从以下分类中选择一个，必须逐字匹配：\n`;
                prompt += userCats.map(c => `"${c}"`).join('、') + '\n';
                prompt += `不匹配时返回"其他"。\n\n`;
            } else {
                prompt += `【主分类】请输出最合适的主分类。\n\n`;
            }

            if (classifyMode !== 'advanced' || advancedRules.length === 0) {
                prompt += `【标签】输出 3-5 个中文标签。\n`;
                if (customInstructions.trim()) prompt += `\n【额外要求】${customInstructions.trim()}\n\n`;
                if (activeDims.length > 0) {
                    const dimFields = activeDims.map(d => `"${d.name}":"分类名"`).join(',');
                    prompt += `只返回 JSON，不要 markdown：{"categories":{${dimFields}},"tags":["标签1","标签2"]}`;
                } else {
                    prompt += `只返回 JSON，不要 markdown：{"category":"分类名","tags":["标签1","标签2"]}`;
                }
            }
            parts.push({ text: prompt });
            setLastSentPrompt(prompt);

            const response = await ai.models.generateContent({
                model: classifyModel,
                contents: [{ role: 'user', parts }],
                config: { responseMimeType: 'application/json' },
            });

            let text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
            text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
            let parsed: any = {};
            try { parsed = JSON.parse(text); } catch { parsed = {}; }
            if (Array.isArray(parsed)) parsed = parsed[0] || {};

            const categories: Record<string, string> = {};
            if (parsed.categories && typeof parsed.categories === 'object') {
                if (classifyMode === 'advanced' && advancedLevels.length > 0) {
                    for (const lvl of advancedLevels) {
                        const rawVal = String(parsed.categories[lvl] ?? '').trim();
                        const validNames = advancedRules.filter(r => r.level.trim() === lvl).map(r => r.name);
                        categories[lvl] = normalizeCategoryWithUserCats(rawVal, validNames);
                    }
                } else {
                    for (const dim of activeDims) {
                        categories[dim.name] = normalizeCategoryWithUserCats(parsed.categories[dim.name], dim.categories);
                    }
                }
            }

            const primaryCategory = (classifyMode === 'advanced' && advancedLevels.length > 0)
                ? (categories[advancedLevels[0]] || '其他')
                : activeDims.length > 0
                    ? (categories[activeDims[0].name] || '其他')
                    : normalizeCategoryWithUserCats(parsed.category, userCats);

            setImages(prev => prev.map(item => item.id === imgId ? {
                ...item,
                category: primaryCategory,
                categories: Object.keys(categories).length > 0 ? categories : undefined,
                tags: normalizeTags(parsed.tags),
                classified: true,
            } : item));

            if (!silent) toast.success('重新分类成功');
        } catch (e: any) {
            console.error(e);
            if (!silent) toast.error(`重新分类失败: ${e.message}`);
            throw e; // 让 batch 调用者知道失败了
        }
    };

    // ======== Batch Reclassify Selected ========
    const handleBatchReclassify = async (ids: Set<string>) => {
        if (ids.size === 0) return;
        const targets = images.filter(i => ids.has(i.id) && i.src && !i.loadFailed && !i.isBlankRow);
        if (targets.length === 0) { toast.error('所选图片均不可分类（无数据或加载失败）'); return; }

        // 先检查 AI 可用性
        let ai: any;
        try { ai = getAiInstance(); } catch { ai = null; }
        if (!ai) { toast.error('请先设置 API 密钥'); return; }

        toast.info(`正在重新分类 0/${targets.length}...`, 3000);
        let done = 0;
        let failed = 0;
        for (const img of targets) {
            try {
                await handleSingleReclassify(img.id, true);
                done++;
            } catch (e: any) {
                failed++;
                console.error(`[批量重分类] ${img.id} 失败:`, e);
            }
            // Removed loading toast since useToast does not support update by id
        }
        if (failed > 0) {
            toast.error(`批量重新分类完成: ${done} 成功, ${failed} 失败`);
        } else {
            toast.success(`批量重新分类完成 (${done}/${targets.length})`);
        }
    };

    // ======== AI Classification ========
    const handleClassify = async () => {
        const aiCheck = getAiInstance();
        if (!aiCheck) {
            toast.error('请先设置 API 密钥');
            return;
        }

        // Determine which images need classification
        // "Supplement" mode: if all images are classified but new dimensions are configured,
        // re-classify images that are missing values for configured dimensions
        const activeDimsPrecheck = dimensions.filter(d => d.name.trim());
        const needsClassification = (img: SorterImage): boolean => {
            if (!img.classified) return true;
            if (img.loadFailed) return false;
            if (classifyMode === 'advanced') {
                // 高级模式：检查每个层级维度是否都有值
                return advancedLevels.some(lvl => !img.categories?.[lvl]);
            }
            // If there are configured dimensions, check if any dimension is missing a value
            if (activeDimsPrecheck.length > 0) {
                return activeDimsPrecheck.some(d => !img.categories?.[d.name.trim()]);
            }
            return false;
        };

        const unclassified = images.filter(needsClassification);
        if (unclassified.length === 0) {
            toast.info('所有图片都已分类');
            return;
        }

        setClassifying(true);
        abortRef.current = false;
        setApiCallCount(0);
        setProgress({ done: 0, total: unclassified.length });

        const userCats = dimensions.length > 0 ? dimensions[0].categories : [];
        const activeDims = dimensions.filter(d => d.name.trim());

        const batches: SorterImage[][] = [];
        for (let i = 0; i < unclassified.length; i += imageBatchSize) {
            batches.push(unclassified.slice(i, i + imageBatchSize));
        }

        const counter = { done: 0 };

        // Process batches concurrently with BATCH_CONCURRENCY workers
        let batchIdx = 0;

        // 高级分类 prompt 生成器
        const buildAdvancedPrompt = (): { prompt: string; dimFields: string } => {
            let prompt = '';
            prompt += `你只能看到一张静态截图，无法听到任何声音。所有判断必须纯粹基于画面视觉特征（背景、文字密度、人物、色调等）。\n`;
            prompt += `请按以下层级分类体系对图片进行分类：\n\n`;

            for (const lvl of advancedLevels) {
                const rulesInLevel = advancedRules.filter(r => r.level.trim() === lvl);
                // 按父类分组
                const byParent = new Map<string, AdvancedClassifyRule[]>();
                for (const r of rulesInLevel) {
                    const p = r.parentCategory.trim() || '';
                    if (!byParent.has(p)) byParent.set(p, []);
                    byParent.get(p)!.push(r);
                }

                prompt += `【${lvl}】`;
                if (byParent.size === 1 && byParent.has('')) {
                    // 顶级：无父类限制
                    const items = byParent.get('')!;
                    prompt += `从以下选项中选一个：\n`;
                    prompt += items.map(r => r.criteria ? `"${r.name}" (${r.criteria})` : `"${r.name}"`).join('、') + '\n';
                } else {
                    // 有父类约束的层级
                    prompt += `根据上一层的分类结果，从对应子类中选择：\n`;
                    for (const [parent, items] of Array.from(byParent)) {
                        if (parent) {
                            prompt += `  若上级="${parent}" → `;
                            prompt += items.map(r => r.criteria ? `"${r.name}" (${r.criteria})` : `"${r.name}"`).join('、') + '\n';
                        } else {
                            prompt += `  通用选项：`;
                            prompt += items.map(r => r.criteria ? `"${r.name}" (${r.criteria})` : `"${r.name}"`).join('、') + '\n';
                        }
                    }
                }
                prompt += `不匹配时返回"其他"。\n\n`;
            }

            // 混淆提示 / 决策树
            if (disambiguationHints.trim()) {
                prompt += `【判断提示】${disambiguationHints.trim()}\n\n`;
            }

            const dimFields = advancedLevels.map(l => `"${l}":"分类名"`).join(',');
            return { prompt, dimFields };
        };

        const classifySingle = async (item: SorterImage): Promise<{ category: string; tags: string[]; categories?: Record<string, string> } | null> => {
            if (!item.src || item.loadFailed) {
                return null; // 加载失败的图片不标记任何内容
            }

            try {
                const resized = await resizeImageForAI(item.src, MAX_IMAGE_DIM);
                const match = resized.match(/^data:([^;]+);base64,(.+)$/);
                if (!match) {
                    return null; // 解析失败不标记
                }

                const parts: Array<{ text: string } | { inlineData: { data: string; mimeType: string } }> = [
                    { text: '[图片 1]' },
                    { inlineData: { data: match[2], mimeType: match[1] } },
                ];

                let prompt = `你是一个图片分类标签专家。请分析这 1 张图片。\n\n`;
                if (ignoreTextContent) {
                    prompt += `【重要】请根据画面的视觉内容进行分类：关注背景图像、整体构图、画面风格和版式设计。图片中可能包含文字，但不需要阅读或理解文字的具体含义——只需将文字视为画面的视觉设计元素（如排版风格、字体布局）来辅助判断画面类型。\n\n`;
                }

                if (classifyMode === 'advanced' && advancedRules.length > 0) {
                    // ===== 高级分类模式 =====
                    const { prompt: advPrompt, dimFields } = buildAdvancedPrompt();
                    prompt += advPrompt;
                    prompt += `【标签】输出 3-5 个中文标签。\n`;
                    if (customInstructions.trim()) {
                        prompt += `\n【额外要求】${customInstructions.trim()}\n\n`;
                    }
                    prompt += `只返回 JSON，不要 markdown：{"categories":{${dimFields}},"tags":["标签1","标签2"]}`;
                } else if (activeDims.length > 0) {
                    // Multi-dimension prompt
                    prompt += `请按以下 ${activeDims.length} 个维度分别分析：\n\n`;
                    activeDims.forEach((dim, i) => {
                        prompt += `【维度${i + 1}: ${dim.name}】`;
                        if (dim.categories.length > 0) {
                            // Fixed categories mode
                            if (dim.description?.trim()) {
                                prompt += `\n判断标准：${dim.description.trim()}\n`;
                            }
                            prompt += `请从以下分类中选择一个，必须逐字匹配：\n`;
                            if (dim.categoryCriteria && Object.keys(dim.categoryCriteria).length > 0) {
                                prompt += dim.categories.map(c => dim.categoryCriteria![c] ? `"${c}" (判定条件: ${dim.categoryCriteria![c]})` : `"${c}"`).join('、') + '\n';
                            } else {
                                prompt += dim.categories.map(c => `"${c}"`).join('、') + '\n';
                            }
                            prompt += `不匹配时返回"其他"。\n\n`;
                        } else if (dim.description?.trim()) {
                            // Open-ended mode with question/requirement
                            prompt += `\n问题/要求：${dim.description.trim()}\n`;
                            prompt += `请根据以上问题/要求回答。\n\n`;
                        } else {
                            // Fully automatic mode
                            prompt += `请自动判断最合适的分类。\n\n`;
                        }
                    });
                } else if (userCats.length > 0) {
                    prompt += `【主分类】请严格从以下分类中选择一个，必须逐字匹配：\n`;
                    prompt += userCats.map(c => `"${c}"`).join('、') + '\n';
                    prompt += `不匹配时返回"其他"。\n\n`;
                } else {
                    prompt += `【主分类】请输出最合适的主分类。\n\n`;
                }

                if (classifyMode !== 'advanced' || advancedRules.length === 0) {
                    prompt += `【标签】输出 3-5 个中文标签。\n`;
                    if (customInstructions.trim()) {
                        prompt += `\n【额外要求】${customInstructions.trim()}\n\n`;
                    }
                    if (activeDims.length > 0) {
                        const dimFields = activeDims.map(d => `"${d.name}":"分类名"`).join(',');
                        prompt += `只返回 JSON，不要 markdown：{"categories":{${dimFields}},"tags":["\u6807\u7b7e1","\u6807\u7b7e2"]}`;
                    } else {
                        prompt += `只返回 JSON，不要 markdown：{"category":"分类名","tags":["\u6807\u7b7e1","\u6807\u7b7e2"]}`;
                    }
                }
                parts.push({ text: prompt });

                console.log('[分拣器] 单张分类 prompt:\n', prompt);
                setLastSentPrompt(prompt);

                const response = await callWithRetry(async () => {
                    const ai = getAiInstance(); // 每次请求重新获取实例，确保轮换 key
                    if (!ai) throw new Error('No AI instance');
                    return ai.models.generateContent({
                        model: classifyModel,
                        contents: [{ role: 'user', parts }],
                        config: { responseMimeType: 'application/json' },
                    });
                }, `single-${item.id}`);

                let text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';
                text = text.replace(/```json\s*/gi, '').replace(/```\s*/g, '').trim();
                let parsed: any = {};
                try {
                    parsed = JSON.parse(text);
                } catch {
                    parsed = {};
                }
                if (Array.isArray(parsed)) parsed = parsed[0] || {};

                // Parse multi-dimension categories
                const categories: Record<string, string> = {};
                if (parsed.categories && typeof parsed.categories === 'object') {
                    if (classifyMode === 'advanced' && advancedLevels.length > 0) {
                        // 高级模式：按层级解析并校验
                        for (const lvl of advancedLevels) {
                            const rawVal = String(parsed.categories[lvl] ?? '').trim();
                            const validNames = advancedRules.filter(r => r.level.trim() === lvl).map(r => r.name);
                            categories[lvl] = normalizeCategoryWithUserCats(rawVal, validNames);
                        }
                    } else {
                        for (const dim of activeDims) {
                            categories[dim.name] = normalizeCategoryWithUserCats(parsed.categories[dim.name], dim.categories);
                        }
                    }
                }

                const primaryCategory = (classifyMode === 'advanced' && advancedLevels.length > 0)
                    ? (categories[advancedLevels[0]] || '其他')
                    : activeDims.length > 0
                        ? (categories[activeDims[0].name] || '其他')
                        : normalizeCategoryWithUserCats(parsed.category, userCats);

                return {
                    category: primaryCategory,
                    tags: normalizeTags(parsed.tags),
                    categories: Object.keys(categories).length > 0 ? categories : undefined,
                };
            } catch {
                return null; // 分类失败不标记
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
                        const nextSentIndex = sentCount + 1;
                        const ref = `REF_${nextSentIndex}_${batch[i].id.slice(-8)}`;
                        const resized = await resizeImageForAIWithLabel(batch[i].src, MAX_IMAGE_DIM, `IMG ${nextSentIndex} ${ref}`);
                        const match = resized.match(/^data:([^;]+);base64,(.+)$/);
                        if (match) {
                            sentCount = nextSentIndex;
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
                    category?: string;
                    categories?: Record<string, string>;
                    tags: string[];
                }> = [];

                if (sentCount > 0) {
                    let prompt = `你是一个图片分类标签专家。请分析以下 ${sentCount} 张图片。\n\n`;
                    if (ignoreTextContent) {
                        prompt += `【重要】请根据画面的视觉内容进行分类：关注背景图像、整体构图、画面风格和版式设计。图片中可能包含文字，但不需要阅读或理解文字的具体含义——只需将文字视为画面的视觉设计元素（如排版风格、字体布局）来辅助判断画面类型。\n\n`;
                    }

                    if (classifyMode === 'advanced' && advancedRules.length > 0) {
                        // ===== 高级分类模式 =====
                        const { prompt: advPrompt, dimFields } = buildAdvancedPrompt();
                        prompt += advPrompt;
                        prompt += `【标签】同时为每张图片生成 3-5 个描述性标签（必须使用中文），涵盖：内容主体、色调/配色、构图风格、情绪氛围等。\n\n`;
                        if (customInstructions.trim()) {
                            prompt += `【额外要求】${customInstructions.trim()}\n\n`;
                        }
                        prompt += `请严格按以下 JSON 格式返回（不要有其他文字，不要有 markdown 代码块）：\n`;
                        prompt += `[{"index":1,"ref":"REF_1_xxxx","categories":{${dimFields}},"tags":["标签1","标签2"]},{"index":2,...}]\n`;
                        prompt += `⚠️【极其重要 - REF 映射规则】\n`;
                        prompt += `1. 每张图片顶部白色条中有唯一可见标识（如 IMG 1 REF_1_abc, IMG 2 REF_2_def）\n`;
                        prompt += `2. 你必须读取图片顶部白色条，把分类结果与可见的 IMG 序号和 REF 值精确配对\n`;
                        prompt += `3. ref 字段必须原样回填你在该图片上看到的 REF 值，不可改写、不可交换、不可猜测\n`;
                        prompt += `4. index 字段必须等于顶部白色条中的 IMG 序号\n`;
                        prompt += `5. 如果你不确定某张图片的 REF 值，宁可不返回该条结果，也不要填错 REF\n`;
                    } else if (activeDims.length > 0) {
                        // Multi-dimension prompt
                        prompt += `请按以下 ${activeDims.length} 个维度分别分析：\n\n`;
                        activeDims.forEach((dim, i) => {
                            prompt += `【维度${i + 1}: ${dim.name}】`;
                            if (dim.categories.length > 0) {
                                // Fixed categories mode
                                if (dim.description?.trim()) {
                                    prompt += `\n判断标准：${dim.description.trim()}\n`;
                                }
                                if (dim.categoryCriteria && Object.keys(dim.categoryCriteria).length > 0) {
                                    prompt += `\n各分类判定细则（必须严格遵守以下标准）：\n`;
                                    for (const [cName, cDesc] of Object.entries(dim.categoryCriteria)) {
                                        prompt += `- 【${cName}】: ${cDesc}\n`;
                                    }
                                }
                                prompt += `\n请将每张图片归入以下分类之一（必须严格使用下面给出的原始名称，禁止使用同义词、近义词或改写）：\n`;
                                prompt += dim.categories.map(c => `"${c}"`).join('、') + '\n';
                                prompt += `⚠️ 分类名必须与上面完全一致，逐字匹配。不属于以上任何分类，使用"其他"。\n\n`;
                            } else if (dim.description?.trim()) {
                                // Open-ended mode with question/requirement
                                prompt += `\n问题/要求：${dim.description.trim()}\n`;
                                prompt += `请根据以上问题/要求回答。\n\n`;
                            } else {
                                // Fully automatic mode
                                prompt += `请根据图片内容自动判断一个最合适的分类。\n\n`;
                            }
                        });
                    } else if (userCats.length > 0) {
                        prompt += `【主分类】请将每张图片归入以下分类之一（必须严格使用下面给出的原始名称，禁止使用同义词、近义词或改写）：\n`;
                        prompt += userCats.map(c => `"${c}"`).join('、') + '\n';
                        prompt += `⚠️ 分类名必须与上面完全一致，逐字匹配。例如用户给 "没人" 就必须返回 "没人"，不能返回 "无人"。\n`;
                        prompt += `如果图片不属于以上任何分类，使用"其他"。\n\n`;
                    } else {
                        prompt += `【主分类】请根据图片内容自动判断一个最合适的主分类（如：人物、风景、产品、食物、建筑、动物、插画、抽象等）。\n\n`;
                    }

                    if (classifyMode !== 'advanced' || advancedRules.length === 0) {
                        prompt += `【标签】同时为每张图片生成 3-5 个描述性标签（必须使用中文），涵盖：内容主体、色调/配色、构图风格、情绪氛围等。\n\n`;
                        if (customInstructions.trim()) {
                            prompt += `【额外要求】${customInstructions.trim()}\n\n`;
                        }
                        prompt += `请严格按以下 JSON 格式返回（不要有其他文字，不要有 markdown 代码块）：\n`;
                        if (activeDims.length > 0) {
                            const dimFieldsExample = activeDims.map(d => `"${d.name}":"分类名"`).join(',');
                            prompt += `[{"index":1,"ref":"REF_1_xxxx","categories":{${dimFieldsExample}},"tags":["\u6807\u7b7e1","\u6807\u7b7e2"]},{"index":2,...}]\n`;
                        } else {
                            prompt += `[{"index":1,"ref":"REF_1_xxxx","category":"分类名","tags":["\u6807\u7b7e1","\u6807\u7b7e2","\u6807\u7b7e3"]},{"index":2,...}]\n`;
                        }
                    }
                    prompt += `注意：每张图片顶部白色条中有唯一可见标识（如 IMG 1 REF_1_xxxx）。每张图片都必须返回一条结果，index 必须等于顶部 IMG 序号，ref 字段必须原样回填为你看到的 REF 值，不可改写。`;

                    parts.push({ text: prompt });

                    console.log(`[分拣器] 批次分类 prompt (${sentCount} 张):\n`, prompt);
                    setLastSentPrompt(prompt);

                    const response = await callWithRetry(async () => {
                        const ai = getAiInstance(); // 每次请求重新获取实例，确保轮换 key
                        if (!ai) throw new Error('No AI instance');
                        return ai.models.generateContent({
                            model: classifyModel,
                            contents: [{ role: 'user', parts }],
                            config: { responseMimeType: 'application/json' },
                        });
                    }, `batch-${batchIdx}`);

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

                const mapped = new Map<number, { category: string; tags: string[]; categories?: Record<string, string> }>();
                const assignedBatchIndices = new Set<number>();
                const unresolved: typeof results = [];

                // Strict safety gate: DISABLE index-based fallback entirely.
                // AI's "index" field is unreliable — it frequently swaps indices,
                // causing results to land on the wrong image with no pattern.
                // Only visible-label REF + index matching is trustworthy.

                for (const r of results) {
                    let mappedBatchIdx: number | undefined;
                    const rawRef = String(r.ref ?? '').trim();
                    let normalizedRef = rawRef;
                    if (!refToBatchIndex.has(normalizedRef)) {
                        const refMatch = rawRef.match(/REF_\d+_[A-Za-z0-9]+/);
                        normalizedRef = refMatch ? refMatch[0] : rawRef;
                    }

                    if (normalizedRef && refToBatchIndex.has(normalizedRef)) {
                        mappedBatchIdx = refToBatchIndex.get(normalizedRef);
                    } else {
                        // No valid REF → cannot reliably map, send to single retry
                        console.warn(`[分拣器] 结果缺少有效 ref (got "${rawRef}")，跳过批量映射`);
                        unresolved.push(r);
                        continue;
                    }

                    const expectedIndex = indexMap.findIndex((idx) => idx === mappedBatchIdx) + 1;
                    const returnedIndex = Number(r.index);
                    if (!Number.isInteger(returnedIndex) || returnedIndex !== expectedIndex) {
                        console.warn(`[分拣器] ref/index 不一致，跳过批量映射: ref=${normalizedRef}, index=${r.index}, expected=${expectedIndex}`);
                        unresolved.push(r);
                        continue;
                    }

                    if (mappedBatchIdx === undefined || assignedBatchIndices.has(mappedBatchIdx)) {
                        unresolved.push(r);
                        continue;
                    }

                    // Parse multi-dimension categories from batch result
                    const categories: Record<string, string> = {};
                    if (r.categories && typeof r.categories === 'object') {
                        if (classifyMode === 'advanced' && advancedLevels.length > 0) {
                            for (const lvl of advancedLevels) {
                                const rawVal = String(r.categories[lvl] ?? '').trim();
                                const validNames = advancedRules.filter(ar => ar.level.trim() === lvl).map(ar => ar.name);
                                categories[lvl] = normalizeCategoryWithUserCats(rawVal, validNames);
                            }
                        } else {
                            for (const dim of activeDims) {
                                categories[dim.name] = normalizeCategoryWithUserCats(r.categories[dim.name], dim.categories);
                            }
                        }
                    }

                    mapped.set(mappedBatchIdx, {
                        category: (classifyMode === 'advanced' && advancedLevels.length > 0)
                            ? (categories[advancedLevels[0]] || '其他')
                            : activeDims.length > 0
                                ? (categories[activeDims[0].name] || normalizeCategoryWithUserCats(r.category, userCats))
                                : normalizeCategoryWithUserCats(r.category, userCats),
                        tags: normalizeTags(r.tags),
                        categories: Object.keys(categories).length > 0 ? categories : undefined,
                    });
                    assignedBatchIndices.add(mappedBatchIdx);
                }

                // 不再按顺序兜底映射，避免“错位串图”。
                // 只接受能通过 ref/index 精确定位的结果，其余保持未分类。
                if (unresolved.length > 0) {
                    console.warn(`[分拣器] 批量返回中有 ${unresolved.length} 条无法可靠映射，保持未分类`);
                }

                // 批次信任度检查：如果 ref 匹配率太低，丢弃全部批量结果
                const refMatchedCount = results.filter(r => {
                    const rf = String(r.ref ?? '').trim();
                    const rfMatch = rf.match(/REF_\d+_[A-Za-z0-9]+/);
                    const rfNorm = rfMatch ? rfMatch[0] : rf;
                    const bIdx = rfNorm && refToBatchIndex.has(rfNorm) ? refToBatchIndex.get(rfNorm) : undefined;
                    const expectedIndex = bIdx === undefined ? -1 : indexMap.findIndex((idx) => idx === bIdx) + 1;
                    return rfNorm && refToBatchIndex.has(rfNorm) && Number(r.index) === expectedIndex;
                }).length;
                if (sentCount > 1 && refMatchedCount < sentCount * 0.5) {
                    console.warn(`[分拣器] ref 匹配率仅 ${refMatchedCount}/${sentCount} (${Math.round(refMatchedCount / sentCount * 100)}%)，整批不可信，丢弃`);
                    mapped.clear();
                    assignedBatchIndices.clear();
                }

                // 无法通过 REF 匹配的图片直接跳过，不浪费额度逐张重试
                const unmappedCount = processableIndices.filter(idx => !assignedBatchIndices.has(idx)).length;
                if (unmappedCount > 0) {
                    console.warn(`[分拣器] 批次中 ${unmappedCount} 张图片无法映射，跳过（可稍后手动重新分类）`);
                }

                // 不再强制标记剩余项目

                const batchIdToIdx = new Map(batch.map((item, idx) => [item.id, idx]));
                setImages(prev => prev.map((img) => {
                    const bIdx = batchIdToIdx.get(img.id);
                    if (bIdx === undefined) return img;
                    // 只处理本批次中参与分类的图片
                    if (!processableIndices.includes(bIdx)) return img;
                    const result = mapped.get(bIdx);
                    if (!result) {
                        // REF 匹配失败，标记为未分类，可通过"继续分类"重试
                        return { ...img, category: '匹配失败', classified: false };
                    }
                    // Merge: preserve existing categories, add/update new ones
                    const mergedCategories = { ...img.categories };
                    if (result.categories) {
                        for (const [k, v] of Object.entries(result.categories)) {
                            mergedCategories[k] = v;
                        }
                    }
                    return {
                        ...img,
                        category: result.category,
                        categories: Object.keys(mergedCategories).length > 0 ? mergedCategories : result.categories,
                        tags: result.tags,
                        classified: true,
                    };
                }));

            } catch (err: any) {
                console.error('Classification error:', err);
                toast.error(`批次分类失败: ${err?.message || '未知错误'}`);
                if (err?.status === 404 || err?.message?.includes('404') || err?.message?.includes('not found') || err?.message?.includes('API key')) {
                    abortRef.current = true;
                }
            } finally {
                counter.done += batch.length;
                setProgress({ done: counter.done, total: unclassified.length });
            }
        };

        // 429 重试包装器
        const callWithRetry = async (fn: () => Promise<any>, label: string): Promise<any> => {
            for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
                try {
                    setApiCallCount(prev => prev + 1);
                    return await fn();
                } catch (error: any) {
                    const msg = error?.message || '';
                    const is429 = msg.includes('429') || msg.includes('RESOURCE_EXHAUSTED') || msg.includes('quota') || msg.includes('rate limit');
                    if (is429 && attempt < MAX_RETRIES) {
                        const waitSec = Math.pow(2, attempt + 1) * 3; // 6s, 12s, 24s
                        console.warn(`[图片分拣] ${label} 429限速，第${attempt + 1}次重试，等${waitSec}s`);
                        toast.warning(`⏳ API 限速，${waitSec}s 后重试...`);

                        // Wait with abort check
                        const intervalMs = 500;
                        let waited = 0;
                        while (waited < waitSec * 1000) {
                            if (abortRef.current) throw new Error('Aborted by user');
                            await new Promise(resolve => setTimeout(resolve, intervalMs));
                            waited += intervalMs;
                        }
                        continue;
                    }
                    throw error;
                }
            }
        };

        // Launch concurrent workers with rate limiting
        const REQUEST_GAP_MS = turboMode ? 6000 : 10000; // 图片请求重，每次只发 1 个，间隔要足够
        const WORKER_STAGGER_MS = Math.floor(REQUEST_GAP_MS / effectiveConcurrency);

        const batchWorker = async (workerIndex: number) => {
            // 错峰启动
            if (workerIndex > 0) await new Promise(r => setTimeout(r, workerIndex * WORKER_STAGGER_MS));
            while (batchIdx < batches.length) {
                if (abortRef.current) break;
                const myBatch = batches[batchIdx++];
                await processBatch(myBatch);
                // 速率间隔
                let waited = 0;
                while (waited < REQUEST_GAP_MS) {
                    if (abortRef.current) break;
                    await new Promise(r => setTimeout(r, 500));
                    waited += 500;
                }
            }
        };

        try {
            const workers = Array.from(
                { length: Math.min(effectiveConcurrency, batches.length) },
                (_, i) => batchWorker(i)
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

    // ======== Download Images as ZIP ========
    const handleDownloadClick = (onlySelected: boolean) => {
        const pool = onlySelected
            ? images.filter(img => selectedIds.has(img.id))
            : images;

        const toDownload = pool.filter(img => !img.isBlankRow && !img.loadFailed);

        if (toDownload.length === 0) {
            toast.warning('没有可下载的有效图片');
            return;
        }

        setConfirmDownloadState({ total: toDownload.length, onlySelected });
    };

    const executeDownload = async () => {
        if (!confirmDownloadState) return;
        const { onlySelected } = confirmDownloadState;
        setConfirmDownloadState(null); // 立即关闭弹窗

        const pool = onlySelected
            ? images.filter(img => selectedIds.has(img.id))
            : images;

        const toDownload = pool.filter(img => !img.isBlankRow && !img.loadFailed);

        if (toDownload.length === 0) {
            toast.warning('没有可下载的有效图片');
            return;
        }

        const zip = new JSZip();
        let completed = 0;
        let failed = 0;
        const total = toDownload.length;
        const concurrency = 5;

        setDownloadProgress({ current: 0, total, status: '准备下载...' });

        // Helper to get extension from base64 matching what fetchImageBlob gives
        const getExtFromSrc = (src: string) => {
            const match = src.match(/^data:image\/([a-zA-Z0-9]+);base64,/);
            if (match) {
                const ext = match[1].toLowerCase();
                return ext === 'jpeg' ? 'jpg' : ext;
            }
            return 'jpg';
        };

        const downloadOne = async (img: SorterImage, index: number) => {
            try {
                let blob: Blob;
                let ext: string;

                if (img.src.startsWith('data:image')) {
                    // It's a base64 Data URL, we can convert it directly
                    const res = await fetch(img.src);
                    blob = await res.blob();
                    ext = getExtFromSrc(img.src);
                } else if (img.localFile) {
                    blob = img.localFile;
                    ext = img.localFile.name.split('.').pop()?.toLowerCase() || 'jpg';
                    if (ext === 'jpeg') ext = 'jpg';
                } else if (img.src) {
                    // blob: URL or other render source
                    const res = await fetch(img.src);
                    blob = await res.blob();
                    ext = 'jpg';
                    const contentType = res.headers.get('content-type') || blob.type;
                    if (contentType.includes('png')) ext = 'png';
                    if (contentType.includes('webp')) ext = 'webp';
                    if (contentType.includes('gif')) ext = 'gif';
                } else if (img.originalUrl) {
                    // Try to fetch from external URL (may have CORS issues)
                    const res = await fetch(img.originalUrl);
                    blob = await res.blob();
                    ext = 'jpg';
                    const contentType = res.headers.get('content-type');
                    if (contentType) {
                        if (contentType.includes('png')) ext = 'png';
                        if (contentType.includes('webp')) ext = 'webp';
                        if (contentType.includes('gif')) ext = 'gif';
                    }
                } else {
                    throw new Error('No valid image source');
                }

                // Make a safe filename using the AI classification or original name
                // To avoid name collisions, append the index
                let safeName = (img.name || `图片_${index + 1}`).replace(/[\\/:*?"<>|]/g, '_');

                // If the user wants categorical folders, we could implement it here.
                // For now, let's just make it flat or use the first category as folder if available.
                let folderName = '';
                if (img.categories && Object.values(img.categories).length > 0) {
                    folderName = Object.values(img.categories)[0].replace(/[\\/:*?"<>|]/g, '_');
                } else if (img.category) {
                    folderName = img.category.replace(/[\\/:*?"<>|]/g, '_');
                }

                const filename = `${safeName}_${index + 1}.${ext}`;
                const path = folderName ? `${folderName}/${filename}` : filename;

                zip.file(path, blob);
                completed++;
                setDownloadProgress({ current: completed, total, status: `下载中 ${completed}/${total}` });
            } catch (err) {
                console.warn(`[下载失败] ${img.id}`, err);
                failed++;
                completed++;
                setDownloadProgress({ current: completed, total, status: `下载中 ${completed}/${total} (${failed} 失败)` });
            }
        };

        // Process in batches
        for (let i = 0; i < toDownload.length; i += concurrency) {
            const batch = toDownload.slice(i, i + concurrency);
            await Promise.all(batch.map((img, idx) => downloadOne(img, i + idx)));
        }

        setDownloadProgress({ current: total, total, status: '正在打包 ZIP 文件...' });

        try {
            const content = await zip.generateAsync({ type: 'blob' });
            const prefix = onlySelected ? '部分' : '全部';
            const zipName = `图片分拣_${prefix}_${new Date().toISOString().slice(0, 10)}_${toDownload.length}张.zip`;
            saveAs(content, zipName);
            toast.success(`✅ 成功下载 ${toDownload.length - failed} 张图片${failed > 0 ? `（${failed} 张失败）` : ''}`);
        } catch (err) {
            console.error('ZIP 生成失败:', err);
            toast.error('❌ ZIP 打包失败，请重试');
        } finally {
            setDownloadProgress(null);
        }
    };

    // ======== Copy to Sheets ========
    const copyToSheets = async (options: { withImage?: boolean; uploadGyazo?: boolean; classifiedOnly?: boolean } = {}) => {
        const { withImage = true, uploadGyazo = false, classifiedOnly = false } = options;
        // If user selected specific images, copy those; otherwise copy ALL images
        const hasSelection = selectedIds.size > 0;
        let pool = hasSelection
            ? images.filter(img => selectedIds.has(img.id))
            : images;

        // Filter to classified-only if requested
        if (classifiedOnly) {
            pool = pool.filter(img => img.classified);
        }

        if (pool.length === 0) {
            toast.warning(classifiedOnly ? '没有已分类的图片' : '没有可复制的图片');
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

        // --- 核心优化：自动检测本地图片逻辑 ---
        const needsUpload = ordered.filter(img =>
            !img.loadFailed && (
                !!img.localFile ||
                !!(img.originalUrl && img.originalUrl.startsWith('data:image')) ||
                isBlobUrl(img.src)
            )
        );

        // 如果用户要求带图复制，但没选上传，且确实有本地图，则强制进入提示上传流程
        let activeUpload = uploadGyazo;
        if (withImage && !uploadGyazo && needsUpload.length > 0) {
            const confirmed = window.confirm(`检测到有 ${needsUpload.length} 张本地图，直接复制会导致 Excel 公式失效。\n\n是否为您自动上传图床并生成有效公式？`);
            if (!confirmed) {
                toast.info('已按原始路径复制（本地图在 Excel 中将无法显示）');
            } else {
                activeUpload = true;
            }
        }

        if (activeUpload && needsUpload.length > 0) {
            const token = getGyazoToken();
            if (!token) {
                toast.error('未配置 Gyazo Token，无法上传本地图。请前往右上角设置。');
                return;
            }

            gyazoAbortRef.current = false;
            setUploadingGyazo({ done: 0, total: needsUpload.length });
            toast.info(`正在为您上传图床 (${needsUpload.length} 张)...`);

            let doneCounter = 0;
            // 因为我们要更新 state 让后面拿到的 img.originalUrl 是最新的，所以这里需要同步遍历并更新
            // 但 setImages 是异步的，为了确保后面导出时拿到最新值，我们需要一个临时 map 存储结果
            const uploadedUrls = new Map<string, string>();

            for (const img of needsUpload) {
                if (gyazoAbortRef.current) break;

                let file: File | null = null;
                if (img.localFile) {
                    file = img.localFile;
                } else if (img.originalUrl && img.originalUrl.startsWith('data:image')) {
                    file = base64ToFile(img.originalUrl, `sorter_${Date.now()}.png`);
                } else if (isBlobUrl(img.src)) {
                    try {
                        const blob = await fetch(img.src).then(r => r.blob());
                        file = new File([blob], img.name || `sorter_${Date.now()}.png`, { type: blob.type || 'image/png' });
                    } catch (e) { }
                }

                if (file) {
                    try {
                        const gyazoUrl = await uploadToGyazo(file, token);
                        if (gyazoUrl) {
                            uploadedUrls.set(img.id, gyazoUrl);
                            // 同时更新全局状态以便下次不用重传
                            setImages(prev => prev.map(item => item.id === img.id ? { ...item, originalUrl: gyazoUrl } : item));
                        }
                    } catch (e) {
                        console.warn('上传失败', e);
                    }
                }
                doneCounter++;
                setUploadingGyazo({ done: doneCounter, total: needsUpload.length });
            }

            // 重要：同步更新 ordered 数组里的 URL，确保本次导出使用的是刚传好的链接
            ordered.forEach(img => {
                if (uploadedUrls.has(img.id)) {
                    img.originalUrl = uploadedUrls.get(img.id);
                }
            });

            setUploadingGyazo(null);
            if (!gyazoAbortRef.current) {
                toast.success(`✨ 上传完成，正在生成 Excel 公式...`);
            }
        }

        const dimNames = effectiveDimNames;

        // ================= MATRIX EXPORT MODE =================
        if (dataExportMode === 'matrix') {
            const lines: string[] = [];
            let hasUrl = false;

            // Group images by the primary category
            const groups: Record<string, typeof ordered> = {};
            for (const img of ordered) {
                if (img.isBlankRow) continue; // Skip layout padding spaces in Matrix mode

                const primaryCat = dimNames.length > 0
                    ? (img.categories?.[dimNames[0]] || img.category || (img.classified ? '未识别' : '未分类'))
                    : (img.category?.trim() || (img.classified ? '未识别' : '未分类'));

                if (!groups[primaryCat]) groups[primaryCat] = [];
                groups[primaryCat].push(img);
            }

            for (const [catName, catImages] of Object.entries(groups)) {

                const extraDims = dimNames.length > 1 ? dimNames.slice(1) : [];

                // Find maximum vertical items (image + extra dims + original metadata rows)
                let maxMeta = 0;
                catImages.forEach(img => {
                    const originalMetaCount = img.metadataRows ? img.metadataRows.length : 1; // 1 for fallback tags
                    const count = extraDims.length + originalMetaCount;
                    if (count > maxMeta) maxMeta = count;
                });

                // Initialize block rows with category name in the first column
                const imgRow: string[] = [escapeTsvCell(catName)];
                const metaRows: string[][] = Array.from({ length: maxMeta }, () => [escapeTsvCell(catName)]);

                for (const img of catImages) {
                    // 1. Image Row
                    const imageFormula = img.originalUrl
                        ? `=IMAGE("${img.originalUrl.replace(/"/g, '""')}")`
                        : (img.loadFailed ? '[加载失败]' : `[\u672c\u5730\u56fe\u7247: ${img.name}]`);
                    if (img.originalUrl) hasUrl = true;

                    imgRow.push(withImage ? imageFormula : escapeTsvCell(img.originalUrl || ''));

                    // 2. Metadata Rows
                    for (let r = 0; r < maxMeta; r++) {
                        let val = '';
                        if (r < extraDims.length) {
                            // Extra dimensions mapped as metadata rows
                            const dimName = extraDims[r];
                            const dimVal = img.categories?.[dimName] || (img.classified ? '未分类' : '');
                            val = dimVal ? `${dimName}: ${dimVal}` : '';
                        } else {
                            // Original metadata rows
                            const originalR = r - extraDims.length;
                            if (img.metadataRows && img.metadataRows.length > 0) {
                                val = img.metadataRows[originalR] || '';
                            } else {
                                // Fallback
                                if (originalR === 0) {
                                    val = (img.tags && img.tags.length > 0) ? img.tags.join('\u3001') : '-';
                                }
                            }
                        }
                        metaRows[r].push(escapeTsvCell(val));
                    }
                }

                lines.push(imgRow.join('\t'));
                for (const mRow of metaRows) {
                    lines.push(mRow.join('\t'));
                }
            }

            const tsv = lines.join('\n');
            try {
                await navigator.clipboard.writeText(tsv);
                const totalCats = Object.keys(groups).length;
                let label = `\u5df2复制横向排版：共 ${totalCats} 个分类行`;
                if (hasUrl) {
                    toast.success(`${label}\uff0c\u7c98\u8d34\u5230 Google Sheets \u540e\u56fe\u7247\u516c\u5f0f\u4f1a\u81ea\u52a8\u663e\u793a`);
                } else {
                    toast.success(label);
                }
            } catch {
                toast.error('\u590d\u5236\u5931\u8d25\uff0c\u8bf7\u68c0\u67e5\u6d4f\u89c8\u5668\u6743\u9650');
            }
            return;
        }
        // ================= STANDARD EXPORT MODE =================

        const lines: string[] = [];
        // Build header with per-dimension category columns
        const header = ['序号'];
        if (withImage) header.push('图片');
        if (dimNames.length > 0) {
            dimNames.forEach(name => header.push(name));
        } else {
            header.push('分类');
        }
        header.push('标签', '比例', '尺寸', '状态', '文件名');
        if (withImage) header.push('来源链接');
        lines.push(header.join('\t'));
        let hasUrl = false;
        for (let i = 0; i < ordered.length; i++) {
            const img = ordered[i];

            if (img.isBlankRow) {
                // Push completely empty row with matching column count for perfect Google Sheets structural pasting
                const emptyRow = Array(header.length).fill('');
                // Still put the index so it doesn't look totally weird, or leave blank? Leave blank is safest for Google Sheets overrides.
                lines.push(emptyRow.join('\t'));
                continue;
            }

            const imageFormula = img.originalUrl
                ? `=IMAGE("${img.originalUrl.replace(/"/g, '""')}")`
                : (img.loadFailed ? '[加载失败]' : `[\u672c\u5730\u56fe\u7247: ${img.name}]`);
            if (img.originalUrl) hasUrl = true;
            const tags = (img.tags && img.tags.length > 0) ? img.tags.join('\u3001') : '-';
            const ratio = img.aspectRatio || '-';
            const size = (img.width && img.height) ? `${img.width}×${img.height}` : '-';
            const status = img.loadFailed ? '加载失败' : (img.classified ? '已分类' : '未分类');
            const row: string[] = [
                String(i + 1),
            ];
            if (withImage) {
                row.push(imageFormula);
            }
            // Add per-dimension category values
            if (dimNames.length > 0) {
                dimNames.forEach(name => {
                    const catVal = img.categories?.[name] || img.category || (img.classified ? '未识别' : '未分类');
                    row.push(escapeTsvCell(catVal));
                });
            } else {
                const category = img.category?.trim() || (img.classified ? '未识别' : '未分类');
                row.push(escapeTsvCell(category));
            }
            row.push(
                escapeTsvCell(tags),
                escapeTsvCell(ratio),
                escapeTsvCell(size),
                escapeTsvCell(status),
                escapeTsvCell(img.name || '')
            );
            if (withImage) {
                row.push(escapeTsvCell(img.originalUrl || '-'));
            }
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
        images.forEach((img) => revokeObjectUrlIfNeeded(img.src));
        setImages([]);
        setSelectedIds(new Set());
        setActiveFilters({});
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
                {uploadingGyazo && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ background: '#222', padding: 20, borderRadius: 8, color: '#fff', textAlign: 'center' }}>
                            <Loader2 className="animate-spin" size={32} style={{ margin: '0 auto 10px' }} />
                            <div>正在上传云端 ({uploadingGyazo.done}/{uploadingGyazo.total})</div>
                        </div>
                    </div>
                )}
                {loadingImages && (
                    <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                        <div style={{ background: '#222', padding: 24, borderRadius: 12, color: '#fff', textAlign: 'center', minWidth: 280 }}>
                            <Loader2 className="animate-spin" size={32} style={{ margin: '0 auto 10px' }} />
                            <div>正在加载本地图片 ({loadingImages.done}/{loadingImages.total})</div>
                            <div style={{ width: '100%', height: 4, background: '#444', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
                                <div style={{ width: `${(loadingImages.done / loadingImages.total) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #7c3aed, #a78bfa)', borderRadius: 2, transition: 'width 0.3s ease' }} />
                            </div>
                            <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>请等待加载完成后再进行操作...</div>
                        </div>
                    </div>
                )}
                <div className="is-toolbar">
                    <div className="is-toolbar-title">
                        <Grid3x3 size={18} />
                        图片智能分拣
                    </div>
                    <div className="is-toolbar-actions">
                        <div className="is-batch-control" title="粘贴时如何解析数据结构">
                            <span className="is-batch-control-label">粘贴源</span>
                            <select
                                className="is-batch-control-select"
                                value={dataInputMode}
                                onChange={(e) => {
                                    const mode = e.target.value as 'standard' | 'matrix';
                                    setDataInputMode(mode);
                                    setDataExportMode(mode);
                                }}
                            >
                                <option value="standard">默认结构</option>
                                <option value="matrix">横版结构提取 (包含其他数据行)</option>
                            </select>
                        </div>
                    </div>
                </div>

                <div
                    className={`is-dropzone-area ${dragging ? 'dragging' : ''}`}
                    tabIndex={0}
                    onDragOver={handleDragOver}
                    onDragLeave={handleDragLeave}
                    onDrop={handleDrop}
                    onDoubleClick={() => fileInputRef.current?.click()}
                >
                    <div className="is-dropzone-icon">📂</div>
                    <div className="is-dropzone-title">点击后 Ctrl+V 粘贴，双击选择文件</div>
                    <div className="is-dropzone-subtitle">
                        单击此区域获得焦点后，按 <strong>Ctrl+V</strong> 粘贴图片/URL。<strong>双击</strong> 打开文件夹选择图片。也可以直接拖拽图片/文件夹到这里。
                        <br /><br />
                        AI 会自动识别每张图的主分类和描述标签，你可以按类别筛选后一键复制到表格。
                    </div>
                    <div style={{ display: 'flex', gap: 10, marginTop: 16, flexWrap: 'wrap', justifyContent: 'center' }}>
                        <button
                            className="is-btn"
                            onClick={() => fileInputRef.current?.click()}
                            style={{ background: 'rgba(255,255,255,0.08)', padding: '8px 16px', fontSize: 13, borderRadius: 8 }}
                        >
                            <ImagePlus size={14} /> 选择图片
                        </button>
                        <button
                            className="is-btn is-btn-primary"
                            onClick={() => folderInputRef.current?.click()}
                            style={{ padding: '8px 16px', fontSize: 13, borderRadius: 8 }}
                        >
                            <FolderOpen size={14} /> 选择文件夹（自动按子目录分类）
                        </button>
                    </div>
                    <div style={{ marginTop: 12, display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'center' }}>
                        <span style={{ fontSize: 11, opacity: 0.6 }}>文件夹层级模式：</span>
                        <select
                            className="is-batch-control-select"
                            value={folderDepthMode}
                            onChange={(e) => {
                                const mode = e.target.value as FolderDepthMode;
                                setFolderDepthMode(mode);
                                if (typeof window !== 'undefined') localStorage.setItem('image-sorter-folder-depth', mode);
                            }}
                            style={{ fontSize: 11, padding: '2px 6px' }}
                        >
                            {FOLDER_DEPTH_OPTIONS.map(opt => (
                                <option key={opt.value} value={opt.value}>{opt.label}</option>
                            ))}
                        </select>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 11, opacity: 0.5, maxWidth: 500, textAlign: 'center' }}>
                        💡 选择文件夹后，图片会按子文件夹结构<strong>自动分类</strong>。支持多层嵌套目录，每层自动创建独立的分类维度。
                    </div>
                    <input
                        ref={fileInputRef}
                        type="file"
                        accept="image/*"
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleFileSelect}
                    />
                    {/* @ts-ignore — webkitdirectory is a non-standard attribute */}
                    <input
                        ref={folderInputRef}
                        type="file"
                        // @ts-ignore
                        webkitdirectory=""
                        // @ts-ignore
                        directory=""
                        multiple
                        style={{ display: 'none' }}
                        onChange={handleFolderSelect}
                    />
                </div>
            </div>
        );
    }

    // Main UI with images loaded
    return (
        <div className="image-sorter">
            {/* ===== LEFT SIDEBAR ===== */}
            <div className="is-sidebar" style={{ width: `${sidebarWidth}px` }}>
                {/* Config: multi-dimension classification */}
                <div className="is-config-panel">
                    <div className="is-config-header">
                        <span className="is-config-title-row">
                            <Grid3x3 size={14} /> 分类配置
                        </span>
                        <div className="is-config-actions-row">
                            {dimensions.length > 0 && (dimensions.length > 1 || dimensions[0].categories.length > 0 || dimensions[0].name !== '分类') && (
                                <button
                                    onClick={() => {
                                        setDimensions([{ id: `dim-default-${Date.now()}`, name: '分类', description: '', categories: [], inputValue: '' }]);
                                        setActiveFilters({});
                                        setCollapsedDims({});
                                        if (typeof window !== 'undefined') {
                                            localStorage.removeItem('image-sorter-saved-dimensions');
                                            localStorage.removeItem('image-sorter-category-preset');
                                        }
                                        toast.info('已清空所有分类数据，维度已恢复默认');
                                    }}
                                    disabled={classifying}
                                    title="清空所有维度和分类"
                                    className="is-config-clear-btn"
                                >
                                    <Trash2 size={11} />
                                </button>
                            )}
                            <div className="is-config-preset-wrap">
                                <select
                                    value=""
                                    onChange={e => {
                                        const presetId = e.target.value;
                                        const preset = DIMENSION_PRESETS.find(p => p.id === presetId);
                                        if (!preset) return;

                                        const newDims: ClassificationDimension[] = preset.dimensions.map((d, i) => ({
                                            id: `dim-preset-${Date.now()}-${Math.random().toString(36).substring(2, 6)}`,
                                            name: d.name,
                                            description: d.description,
                                            categories: [...d.categories],
                                            categoryCriteria: d.categoryCriteria ? { ...d.categoryCriteria } : undefined,
                                            inputValue: '',
                                        }));

                                        setDimensions(prev => {
                                            if (prev.length === 1 && prev[0].name === '分类' && prev[0].categories.length === 0) {
                                                return newDims;
                                            }
                                            return [...prev, ...newDims];
                                        });
                                        e.target.value = '';
                                    }}
                                    disabled={classifying}
                                    className="is-config-preset-select"
                                >
                                    <option value="" disabled hidden>＋预设</option>
                                    {DIMENSION_PRESETS.map(preset => (
                                        <option key={preset.id} value={preset.id}>
                                            {preset.emoji} {preset.label} {preset.dimensions.length > 1 ? `(${preset.dimensions.length}维度)` : ''}
                                        </option>
                                    ))}
                                </select>
                            </div>
                        </div>
                    </div>

                    {/* Mode toggle: 基础分类 / 高级分类 */}
                    <div style={{ display: 'flex', gap: 0, margin: '6px 0 8px', borderRadius: 6, overflow: 'hidden', border: '1px solid rgba(255,255,255,0.1)' }}>
                        <button
                            style={{
                                flex: 1, fontSize: 11, padding: '5px 0', border: 'none', cursor: 'pointer',
                                background: classifyMode === 'basic' ? 'rgba(167, 139, 250, 0.2)' : 'transparent',
                                color: classifyMode === 'basic' ? '#c4b5fd' : '#888',
                                fontWeight: classifyMode === 'basic' ? 600 : 400,
                                transition: 'all 0.2s',
                            }}
                            onClick={() => setClassifyMode('basic')}
                            disabled={classifying}
                        >
                            基础分类
                        </button>
                        <button
                            style={{
                                flex: 1, fontSize: 11, padding: '5px 0', border: 'none', cursor: 'pointer',
                                borderLeft: '1px solid rgba(255,255,255,0.1)',
                                background: classifyMode === 'advanced' ? 'rgba(34, 197, 94, 0.15)' : 'transparent',
                                color: classifyMode === 'advanced' ? '#22c55e' : '#888',
                                fontWeight: classifyMode === 'advanced' ? 600 : 400,
                                transition: 'all 0.2s',
                            }}
                            onClick={() => { setClassifyMode('advanced'); setShowAdvancedRules(true); }}
                            disabled={classifying}
                        >
                            ⚡ 高级分类 {advancedRules.length > 0 && <span style={{ fontSize: 9, opacity: 0.7 }}>({advancedRules.length})</span>}
                        </button>
                    </div>

                    {/* ===== 高级分类模式 ===== */}
                    {classifyMode === 'advanced' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                            <div style={{ fontSize: 10, color: '#22c55e', lineHeight: 1.5 }}>
                                表格化层级规则：支持一级→二级→三级等父子级分类关系。通过「归属限制」字段建立层级。
                            </div>

                            {/* 预设选择器 */}
                            {ADVANCED_PRESETS.length > 0 && (
                                <div style={{ display: 'flex', gap: 4, alignItems: 'center', flexWrap: 'wrap' }}>
                                    <span style={{ fontSize: 10, color: '#888', whiteSpace: 'nowrap' }}>预设：</span>
                                    {ADVANCED_PRESETS.map(preset => (
                                        <button
                                            key={preset.id}
                                            className="is-btn is-btn-sm"
                                            style={{ fontSize: 10, padding: '2px 8px' }}
                                            disabled={classifying}
                                            onClick={() => {
                                                const rules = preset.rules.map(r => ({
                                                    id: `ar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                                    ...r,
                                                }));
                                                setAdvancedRules(rules);
                                                if (preset.disambiguationHints) {
                                                    setDisambiguationHints(preset.disambiguationHints);
                                                }
                                                toast.success(`已加载预设「${preset.label}」：${rules.length} 条规则`);
                                            }}
                                        >
                                            {preset.emoji} {preset.label}
                                        </button>
                                    ))}
                                </div>
                            )}

                            {/* 规则列表 */}
                            <div style={{ maxHeight: 320, overflowY: 'auto', overscrollBehavior: 'contain' }}>
                                {advancedRules.map((rule, idx) => (
                                    <div key={rule.id} style={{
                                        display: 'flex', gap: 3, alignItems: 'center', padding: '3px 0',
                                        borderBottom: '1px solid rgba(255,255,255,0.06)',
                                    }}>
                                        <input
                                            type="text" placeholder="维度"
                                            value={rule.level}
                                            onChange={e => {
                                                const updated = [...advancedRules];
                                                updated[idx] = { ...rule, level: e.target.value };
                                                setAdvancedRules(updated);
                                            }}
                                            style={{ width: 64, fontSize: 10, padding: '3px 4px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#3b82f6' }}
                                        />
                                        <input
                                            type="text" placeholder="类别名称"
                                            value={rule.name}
                                            onChange={e => {
                                                const updated = [...advancedRules];
                                                updated[idx] = { ...rule, name: e.target.value };
                                                setAdvancedRules(updated);
                                            }}
                                            style={{ width: 70, fontSize: 10, padding: '3px 4px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#e4e4e7' }}
                                        />
                                        <input
                                            type="text" placeholder="归属限制"
                                            value={rule.parentCategory}
                                            title="父级类别名称（留空=顶级）"
                                            onChange={e => {
                                                const updated = [...advancedRules];
                                                updated[idx] = { ...rule, parentCategory: e.target.value };
                                                setAdvancedRules(updated);
                                            }}
                                            style={{ width: 64, fontSize: 10, padding: '3px 4px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#f59e0b' }}
                                        />
                                        <input
                                            type="text" placeholder="判断标准"
                                            value={rule.criteria}
                                            onChange={e => {
                                                const updated = [...advancedRules];
                                                updated[idx] = { ...rule, criteria: e.target.value };
                                                setAdvancedRules(updated);
                                            }}
                                            style={{ flex: 1, minWidth: 0, fontSize: 10, padding: '3px 4px', borderRadius: 3, border: '1px solid rgba(255,255,255,0.1)', background: 'rgba(0,0,0,0.3)', color: '#e4e4e7' }}
                                        />
                                        <button
                                            onClick={() => setAdvancedRules(prev => prev.filter((_, i) => i !== idx))}
                                            style={{ background: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer', padding: '2px', fontSize: 12, lineHeight: 1, flexShrink: 0 }}
                                            title="删除"
                                        >×</button>
                                    </div>
                                ))}
                            </div>

                            {/* 操作按钮 */}
                            <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                <button
                                    onClick={() => {
                                        setAdvancedRules(prev => [...prev, {
                                            id: `ar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                            name: '', level: advancedLevels[0] || '一级分类', parentCategory: '', criteria: '',
                                        }]);
                                    }}
                                    disabled={classifying}
                                    style={{
                                        flex: '1 1 120px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                                        background: 'transparent', color: '#22c55e', border: '1px dashed #22c55e44', borderRadius: 4,
                                        padding: '5px 6px', fontSize: 10, cursor: 'pointer',
                                    }}
                                >
                                    <Plus size={10} /> 添加规则
                                </button>
                                <button
                                    onClick={() => { setAdvancedRules([]); setDisambiguationHints(''); }}
                                    disabled={classifying || advancedRules.length === 0}
                                    style={{
                                        flex: '1 1 120px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 3,
                                        background: 'transparent', color: '#ef4444', border: '1px dashed #ef444444', borderRadius: 4,
                                        padding: '5px 6px', fontSize: 10, cursor: 'pointer',
                                        opacity: advancedRules.length === 0 ? 0.4 : 1,
                                    }}
                                >
                                    <Trash2 size={10} /> 清空
                                </button>
                            </div>

                            {/* 批量粘贴区域 */}
                            <div style={{ fontSize: 9, color: '#666', marginTop: 2 }}>📋 批量粘贴（维度[TAB]类别名[TAB]归属限制[TAB]判断标准）</div>
                            <textarea
                                className="is-chips-input"
                                style={{ width: '100%', minHeight: 28, maxHeight: 60, resize: 'vertical', fontSize: 10, lineHeight: 1.4, padding: '4px 6px' }}
                                placeholder="粘贴表格数据到这里..."
                                disabled={classifying}
                                onPaste={e => {
                                    const text = e.clipboardData.getData('text/plain');
                                    if (!text.trim()) return;
                                    e.preventDefault();
                                    const lines = text.split(/\r?\n/).filter(l => l.trim());
                                    const newRules: AdvancedClassifyRule[] = [];
                                    for (const line of lines) {
                                        const cols = line.split('\t');
                                        const level = cols[0]?.trim() || '一级分类';
                                        const name = cols[1]?.trim() || cols[0]?.trim() || '';
                                        if (!name) continue;
                                        // 检测是否为表头
                                        if (name === '类别名称' || name === '类别' || name.toLowerCase() === 'name') continue;
                                        const parentCategory = cols[2]?.trim() || '';
                                        const criteria = cols[3]?.trim() || '';
                                        newRules.push({
                                            id: `ar-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
                                            level: cols.length >= 2 ? level : '一级分类',
                                            name: cols.length >= 2 ? name : cols[0]?.trim() || '',
                                            parentCategory, criteria,
                                        });
                                    }
                                    if (newRules.length > 0) {
                                        setAdvancedRules(prev => [...prev, ...newRules]);
                                        toast.success(`已导入 ${newRules.length} 条高级分类规则`);
                                    }
                                    (e.target as HTMLTextAreaElement).value = '';
                                }}
                            />

                            {/* 混淆提示 / 决策树 */}
                            <div>
                                <div style={{ fontSize: 9, color: '#666', marginBottom: 2 }}>🌳 判断提示（决策树顺序、易混淆区分等，会直接发给 AI）</div>
                                <textarea
                                    className="is-chips-input"
                                    style={{ width: '100%', minHeight: 32, maxHeight: 80, resize: 'vertical', fontSize: 10, lineHeight: 1.4, padding: '4px 6px' }}
                                    placeholder="例如：先排除动画→灾难→口播→宗派→ig→reels→人声 | reels类=大量文字 vs 人声视频类=极少文字"
                                    title="双击放大编辑"
                                    value={disambiguationHints}
                                    onChange={e => setDisambiguationHints(e.target.value)}
                                    onDoubleClick={() => setEnlargedInput({ title: '🌳 判断提示', value: disambiguationHints, onChange: setDisambiguationHints })}
                                    disabled={classifying}
                                />
                            </div>

                            {/* 层级结构预览 */}
                            {advancedLevels.length > 0 && (
                                <div style={{ fontSize: 10, color: '#888', padding: '4px 6px', background: 'rgba(0,0,0,0.2)', borderRadius: 4, lineHeight: 1.6 }}>
                                    <div style={{ fontWeight: 600, marginBottom: 2, color: '#aaa' }}>层级结构预览：</div>
                                    {advancedLevels.map((lvl, lvlIdx) => {
                                        const rulesInLevel = advancedRules.filter(r => r.level.trim() === lvl);
                                        return (
                                            <div key={lvl} style={{ paddingLeft: lvlIdx * 12, display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                                                <span style={{ color: '#3b82f6', fontWeight: 500 }}>{lvl}:</span>
                                                {rulesInLevel.map(r => (
                                                    <span key={r.id} style={{ color: r.parentCategory ? '#f59e0b' : '#e4e4e7' }}>
                                                        {r.name}{r.parentCategory ? ` ←${r.parentCategory}` : ''}
                                                    </span>
                                                ))}
                                            </div>
                                        );
                                    })}
                                </div>
                            )}
                        </div>
                    )}

                    {/* ===== 基础分类模式（原有维度配置）===== */}
                    {classifyMode === 'basic' && dimensions.map((dim, dimIdx) => {
                        const isCollapsed = collapsedDims[dim.id] || false;
                        const toggleCollapse = () => setCollapsedDims(prev => ({ ...prev, [dim.id]: !isCollapsed }));

                        return (
                            <div key={dim.id} style={{ marginBottom: 12, border: '1px solid rgba(255,255,255,0.08)', borderRadius: 8, background: 'rgba(0,0,0,0.2)', padding: '8px 10px' }}>
                                {/* Header / Toggle */}
                                <div
                                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer' }}
                                    onClick={toggleCollapse}
                                >
                                    <div className="is-dim-header-main">
                                        <span style={{ fontSize: 10, opacity: 0.5, userSelect: 'none', width: 12 }}>{isCollapsed ? '▶' : '▼'}</span>
                                        <input
                                            className="is-chips-input"
                                            style={{ width: 120, minWidth: 72, flexShrink: 1, fontWeight: 600, fontSize: 12, background: 'transparent', border: '1px solid transparent', padding: '2px 4px', borderRadius: 4, transition: 'all 0.2s', ...(!isCollapsed ? { borderBottom: '1px solid rgba(167, 139, 250, 0.4)' } : {}) }}
                                            placeholder="维度/属性名"
                                            value={dim.name}
                                            disabled={classifying}
                                            title="点击编辑维度名"
                                            onClick={e => e.stopPropagation()}
                                            onChange={e => {
                                                setDimensions(prev => prev.map((d, i) => i === dimIdx ? { ...d, name: e.target.value } : d));
                                            }}
                                        />
                                        {isCollapsed && (
                                            <span style={{ fontSize: 10, opacity: 0.4, marginLeft: 8 }}>共 {dim.categories.length} 个分类</span>
                                        )}
                                        {!isCollapsed && (
                                            <select
                                                className="is-dim-preset-select"
                                                value=""
                                                onClick={e => e.stopPropagation()}
                                                onChange={e => {
                                                    const val = e.target.value;
                                                    if (!val) return;
                                                    const [presetId, tempIdx] = val.split('|');
                                                    const preset = DIMENSION_PRESETS.find(p => p.id === presetId);
                                                    if (!preset) return;
                                                    const template = preset.dimensions[parseInt(tempIdx, 10)];
                                                    if (!template) return;

                                                    setDimensions(prev => prev.map((d, i) => {
                                                        if (i !== dimIdx) return d;
                                                        return {
                                                            ...d,
                                                            name: template.name,
                                                            description: template.description || '',
                                                            categories: [...template.categories],
                                                            categoryCriteria: template.categoryCriteria ? { ...template.categoryCriteria } : undefined
                                                        };
                                                    }));
                                                    e.target.value = '';
                                                }}
                                                disabled={classifying}
                                                style={{
                                                    fontSize: 9,
                                                    padding: '2px 12px 2px 4px',
                                                    borderRadius: 4,
                                                    border: '1px solid rgba(255,255,255,0.1)',
                                                    background: 'rgba(255,255,255,0.05)',
                                                    color: '#aaa',
                                                    cursor: 'pointer',
                                                    appearance: 'none',
                                                    WebkitAppearance: 'none',
                                                    colorScheme: 'dark',
                                                    backgroundImage: `url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='8' height='8' viewBox='0 0 24 24' fill='none' stroke='%23999' stroke-width='2'%3E%3Cpath d='M6 9l6 6 6-6'/%3E%3C/svg%3E")`,
                                                    backgroundRepeat: 'no-repeat',
                                                    backgroundPosition: 'right 4px center',
                                                    marginLeft: 4,
                                                }}
                                            >
                                                <option value="" disabled hidden>预设</option>
                                                {DIMENSION_PRESETS.map(preset => (
                                                    <optgroup key={preset.id} label={`${preset.emoji} ${preset.label}`}>
                                                        {preset.dimensions.map((d, i) => (
                                                            <option key={`${preset.id}|${i}`} value={`${preset.id}|${i}`}>
                                                                {d.name} ({d.categories.length})
                                                            </option>
                                                        ))}
                                                    </optgroup>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                    <button
                                        className="is-chip-remove"
                                        style={{ fontSize: 14, opacity: 0.5, padding: '2px 6px' }}
                                        onClick={(e) => { e.stopPropagation(); setDimensions(prev => prev.filter((_, i) => i !== dimIdx)); }}
                                        disabled={classifying}
                                        title="删除此维度"
                                    >×</button>
                                </div>

                                {/* Body */}
                                {!isCollapsed && (
                                    <div style={{ marginTop: 10, paddingLeft: 18 }}>
                                        <div className="is-chips-wrapper" style={{ flexDirection: 'column', alignItems: 'stretch', background: 'transparent', border: 'none', padding: 0 }}>
                                            <div style={{ fontSize: 9, color: '#a78bfa', marginBottom: 2, display: 'flex', justifyContent: 'space-between' }}>
                                                <span style={{ opacity: 0.8 }}>可选项及判定配置表：</span>
                                            </div>
                                            {dim.categories.map((cat, catIdx) => (
                                                <div key={catIdx} style={{ display: 'flex', alignItems: 'center', gap: 4, width: '100%', padding: '2px 0' }}>
                                                    <span style={{ fontSize: 10, minWidth: 60, maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', opacity: 0.9 }}>{cat}</span>
                                                    <input
                                                        className="is-chips-input"
                                                        style={{ flex: 1, padding: '3px 6px', fontSize: 10, background: 'rgba(251, 191, 36, 0.08)', border: '1px solid rgba(251, 191, 36, 0.2)', borderRadius: 4, color: '#fbbf24' }}
                                                        placeholder="独立判定要求/依据（可选）..."
                                                        value={dim.categoryCriteria?.[cat] || ''}
                                                        disabled={classifying}
                                                        onChange={e => setDimensions(prev => prev.map((d, i) => {
                                                            if (i !== dimIdx) return d;
                                                            const newCrit = { ...(d.categoryCriteria || {}) };
                                                            newCrit[cat] = e.target.value;
                                                            return { ...d, categoryCriteria: newCrit };
                                                        }))}
                                                    />
                                                    <button
                                                        className="is-chip-remove"
                                                        onClick={() => setDimensions(prev => prev.map((d, i) => {
                                                            if (i !== dimIdx) return d;
                                                            const newCats = d.categories.filter((_, ci) => ci !== catIdx);
                                                            const newCrit = { ...d.categoryCriteria };
                                                            delete newCrit[cat];
                                                            return { ...d, categories: newCats, categoryCriteria: newCrit };
                                                        }))}
                                                        disabled={classifying}
                                                    >×</button>
                                                </div>
                                            ))}
                                            <input
                                                className="is-chips-input"
                                                style={{ flex: 1, marginTop: 4, background: 'rgba(255,255,255,0.03)', borderRadius: 4, padding: '4px 6px' }}
                                                placeholder={dim.categories.length === 0 ? '添加分类或直接粘贴两列Excel(分类名+依据)...' : '继续添加分类...'}
                                                value={dim.inputValue}
                                                onChange={e => setDimensions(prev => prev.map((d, i) => i === dimIdx ? { ...d, inputValue: e.target.value } : d))}
                                                disabled={classifying}
                                                onKeyDown={e => {
                                                    if (e.key === 'Enter' && dim.inputValue.trim()) {
                                                        e.preventDefault();
                                                        const newCats = dim.inputValue.split(/[,，、\t\n]/).map(s => s.trim()).filter(Boolean);
                                                        setDimensions(prev => prev.map((d, i) => i === dimIdx ? { ...d, categories: [...d.categories, ...newCats.filter(c => !d.categories.includes(c))], inputValue: '' } : d));
                                                    } else if (e.key === 'Backspace' && !dim.inputValue && dim.categories.length > 0) {
                                                        setDimensions(prev => prev.map((d, i) => {
                                                            if (i !== dimIdx) return d;
                                                            const droppedCat = d.categories[d.categories.length - 1];
                                                            const newCrit = { ...d.categoryCriteria };
                                                            delete newCrit[droppedCat];
                                                            return { ...d, categories: d.categories.slice(0, -1), categoryCriteria: newCrit };
                                                        }));
                                                    }
                                                }}
                                                onPaste={e => {
                                                    const text = e.clipboardData.getData('text/plain');
                                                    if (!text.trim()) return;

                                                    if (text.includes('\t') || text.includes('\n')) {
                                                        e.preventDefault();
                                                        const lines = text.split(/\r?\n/).filter((l: string) => l.trim());

                                                        const cats: string[] = [];
                                                        const newCriteria: Record<string, string> = {};
                                                        for (const line of lines) {
                                                            const cols = line.split('\t');
                                                            const catName = cols[0]?.trim();
                                                            if (!catName) continue;

                                                            if (cols.length >= 3) {
                                                                const subCats = cols[1]?.trim().split(/[,，、;；]/).map(c => c.trim()).filter(Boolean) || [];
                                                                cats.push(...subCats);
                                                                const desc = cols[2]?.trim();
                                                                if (desc) {
                                                                    subCats.forEach(sc => newCriteria[sc] = desc);
                                                                }
                                                            } else {
                                                                cats.push(catName);
                                                                const desc = cols[1]?.trim();
                                                                if (desc) newCriteria[catName] = desc;
                                                            }
                                                        }

                                                        if (cats.length > 0) {
                                                            setDimensions(prev => prev.map((d, i) => {
                                                                if (i !== dimIdx) return d;
                                                                const mergedCats = [...d.categories, ...cats.filter(c => !d.categories.includes(c))];
                                                                const mergedCrit = { ...(d.categoryCriteria || {}), ...newCriteria };
                                                                return { ...d, categories: mergedCats, categoryCriteria: mergedCrit, inputValue: '' };
                                                            }));
                                                        }
                                                    } else if (text.includes(',') || text.includes('，') || text.includes('、')) {
                                                        e.preventDefault();
                                                        const newCats = text.split(/[,，、]/).map(s => s.trim()).filter(Boolean);
                                                        setDimensions(prev => prev.map((d, i) => i === dimIdx ? { ...d, categories: [...d.categories, ...newCats.filter(c => !d.categories.includes(c))], inputValue: '' } : d));
                                                    }
                                                }}
                                            />
                                        </div>

                                        <input
                                            className="is-chips-input"
                                            style={{ width: '100%', marginTop: 8, fontSize: 10, color: '#aaa', padding: '4px 6px', background: 'rgba(255,255,255,0.02)', borderRadius: 4, border: '1px solid rgba(255,255,255,0.03)' }}
                                            placeholder={dim.categories.length === 0 ? '问题/要求（如：这是哪类服装？）' : '当前维度统筹判断标准（如：所有人脸清晰的算有效）'}
                                            value={dim.description}
                                            disabled={classifying}
                                            onChange={e => setDimensions(prev => prev.map((d, i) => i === dimIdx ? { ...d, description: e.target.value } : d))}
                                        />
                                    </div>
                                )}
                            </div>
                        );
                    })}
                    {classifyMode === 'basic' && dimensions.length === 0 && (
                        <div className="is-config-row">
                            <span className="is-config-hint" style={{ opacity: 0.6, fontSize: 11 }}>🤖 未配置维度，AI 将自动判断</span>
                        </div>
                    )}
                    {classifyMode === 'basic' && (<>
                        <div style={{ display: 'flex', justifyContent: 'flex-start', padding: '4px 0', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                            <button
                                className="is-btn is-btn-sm"
                                onClick={() => setDimensions(prev => [...prev, { id: `dim-${Date.now()}`, name: '', description: '', categories: [], inputValue: '' }])}
                                disabled={classifying}
                                style={{ fontSize: 11 }}
                            >
                                <Plus size={12} /> 添加分类维度
                            </button>
                        </div>
                        {/* Batch paste: 1col=categories, 2col=category+desc, 3col=dim+categories+desc */}
                        <div style={{ marginTop: 2 }}>
                            <div style={{ fontSize: 10, color: '#666', marginBottom: 3 }}>📋 批量粘贴（1列=分类名 · 2列=分类+说明 · 3列=维度名+分类+说明）</div>
                            <textarea
                                className="is-chips-input is-batch-paste-input"
                                style={{ width: '100%', minHeight: 28, maxHeight: 80, resize: 'vertical', fontSize: 10, lineHeight: 1.4, padding: '4px 6px' }}
                                placeholder="粘贴分类名 / 分类[TAB]说明 / 维度名[TAB]分类1,分类2[TAB]说明"
                                disabled={classifying}
                                onPaste={e => {
                                    const text = e.clipboardData.getData('text/plain');
                                    if (!text.trim()) return;
                                    e.preventDefault();

                                    const lines = text.split(/\r?\n/).filter((l: string) => l.trim());
                                    if (lines.length === 0) return;

                                    // Detect mode by max column count
                                    const maxCols = Math.max(...lines.map(l => l.split('\t').length));

                                    if (maxCols >= 3) {
                                        // ===== 3 columns: each row = a new dimension =====
                                        // col1=dimension name, col2=categories (comma-separated), col3=description
                                        const newDims: ClassificationDimension[] = [];
                                        for (const line of lines) {
                                            const cols = line.split('\t');
                                            const dimName = cols[0]?.trim();
                                            if (!dimName) continue;
                                            const catStr = cols[1]?.trim() || '';
                                            const desc = cols[2]?.trim() || '';
                                            const cats = catStr.split(/[,，、;；]/).map(c => c.trim()).filter(Boolean);
                                            newDims.push({ id: `dim-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`, name: dimName, description: desc, categories: cats, inputValue: '' });
                                        }
                                        if (newDims.length > 0) {
                                            setDimensions(prev => [...prev, ...newDims]);
                                        }
                                    } else {
                                        // ===== 1 or 2 columns: all rows → categories of ONE dimension =====
                                        // col1=category name, col2=description (optional)
                                        const cats: string[] = [];
                                        const newCriteria: Record<string, string> = {};
                                        for (const line of lines) {
                                            const cols = line.split('\t');
                                            const catName = cols[0]?.trim();
                                            if (!catName) continue;
                                            cats.push(catName);
                                            const desc = cols[1]?.trim();
                                            if (desc) newCriteria[catName] = desc;
                                        }
                                        if (cats.length > 0) {
                                            // Add to the last dimension, or create a new one
                                            setDimensions(prev => {
                                                if (prev.length === 0 || (prev[prev.length - 1].categories.length > 0 && prev[prev.length - 1].name)) {
                                                    // Create a new dimension
                                                    return [...prev, {
                                                        id: `dim-${Date.now()}`,
                                                        name: '',
                                                        description: '',
                                                        categories: cats,
                                                        inputValue: '',
                                                        categoryCriteria: newCriteria,
                                                    }];
                                                }
                                                // Add to the last empty dimension
                                                const last = prev[prev.length - 1];
                                                const merged = [...last.categories, ...cats.filter(c => !last.categories.includes(c))];
                                                const mergedCrit = { ...(last.categoryCriteria || {}), ...newCriteria };
                                                return prev.map((d, i) => i === prev.length - 1 ? { ...d, categories: merged, categoryCriteria: mergedCrit } : d);
                                            });
                                        }
                                    }
                                    (e.target as HTMLTextAreaElement).value = '';
                                }}
                            />
                        </div>
                    </>)}
                </div>

                {/* Ignore text content toggle */}
                <div className="is-config-panel" style={{ paddingTop: 8, paddingBottom: 8 }}>
                    <button
                        className={`is-btn is-btn-sm`}
                        style={{
                            width: '100%',
                            justifyContent: 'flex-start',
                            fontSize: 11,
                            gap: 8,
                            background: ignoreTextContent ? 'rgba(167, 139, 250, 0.12)' : 'transparent',
                            borderColor: ignoreTextContent ? 'rgba(167, 139, 250, 0.4)' : 'var(--border-color, #333)',
                            color: ignoreTextContent ? '#c4b5fd' : 'var(--text-secondary, #aaa)',
                        }}
                        onClick={() => setIgnoreTextContent(prev => !prev)}
                        disabled={classifying}
                        title={ignoreTextContent ? '当前：根据画面视觉分类（忽略文字含义）' : '当前：会读取文字内容辅助分类'}
                    >
                        {ignoreTextContent ? <EyeOff size={13} /> : <Eye size={13} />}
                        {ignoreTextContent ? '忽略文字内容（按画面分类）' : '读取文字内容（辅助分类）'}
                    </button>
                    <div style={{ fontSize: 10, color: '#666', marginTop: 4, lineHeight: 1.4 }}>
                        {ignoreTextContent
                            ? '根据背景、构图、版式设计分类，不读取文字含义'
                            : 'AI 会阅读图片中的文字来辅助分类判断'
                        }
                    </div>
                </div>

                {/* Custom instructions + Prompt preview */}
                <div className="is-config-panel" style={{ paddingTop: 8 }}>
                    <div
                        style={{
                            fontSize: 11,
                            color: '#888',
                            marginBottom: 6,
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            gap: 8,
                        }}
                    >
                        <span>📝 自定义指令 <span style={{ opacity: 0.6 }}>(可选，会附加到分类 prompt)</span></span>
                        <button
                            className="is-btn is-btn-sm"
                            style={{ fontSize: 10, padding: '2px 6px' }}
                            onClick={() => setCustomInstructions('')}
                            disabled={classifying || !customInstructions}
                            title="清空自定义指令"
                        >
                            清空
                        </button>
                    </div>
                    <textarea
                        className="is-chips-input"
                        style={{
                            width: '100%',
                            minHeight: 40,
                            maxHeight: 120,
                            resize: 'vertical',
                            fontSize: 11,
                            lineHeight: 1.5,
                            padding: '6px 8px',
                            borderRadius: 6,
                            border: '1px solid var(--border-color, #333)',
                            background: 'var(--bg-primary, #0f0f0f)',
                            color: 'var(--text-primary, #e0e0e0)',
                        }}
                        placeholder="例如：这些是电商产品图，请按产品类型分类..."
                        title="双击放大编辑"
                        value={customInstructions}
                        onChange={e => setCustomInstructions(e.target.value)}
                        onDoubleClick={() => setEnlargedInput({ title: '📝 自定义指令', value: customInstructions, onChange: setCustomInstructions })}
                        disabled={classifying}
                    />
                    <div
                        style={{ fontSize: 10, color: '#666', cursor: 'pointer', marginTop: 6, userSelect: 'none', display: 'flex', alignItems: 'center', gap: 4 }}
                        onClick={() => setShowPromptPreview(!showPromptPreview)}
                    >
                        {showPromptPreview ? '▾' : '▸'} 查看最终指令 {lastSentPrompt && <span style={{ color: '#a78bfa', fontSize: 9 }}>● 已发送</span>}
                    </div>
                    {showPromptPreview && (() => {
                        // Build live preview from current config
                        const activeDims = dimensions.filter(d => d.name.trim());
                        const userCats = activeDims.length === 0 && dimensions.length > 0 ? dimensions[0]?.categories || [] : [];
                        let preview = `你是一个图片分类标签专家。请分析以下 N 张图片。\n\n`;

                        if (classifyMode === 'advanced' && advancedRules.length > 0) {
                            // ===== 高级分类预览 =====
                            preview += `请按以下层级分类体系对图片进行分类：\n\n`;
                            for (const lvl of advancedLevels) {
                                const rulesInLevel = advancedRules.filter(r => r.level.trim() === lvl);
                                const byParent = new Map<string, AdvancedClassifyRule[]>();
                                for (const r of rulesInLevel) {
                                    const p = r.parentCategory.trim() || '';
                                    if (!byParent.has(p)) byParent.set(p, []);
                                    byParent.get(p)!.push(r);
                                }
                                preview += `【${lvl}】`;
                                if (byParent.size === 1 && byParent.has('')) {
                                    const items = byParent.get('')!;
                                    preview += `从以下选项中选一个：\n`;
                                    preview += items.map(r => r.criteria ? `"${r.name}" (${r.criteria})` : `"${r.name}"`).join('、') + '\n';
                                } else {
                                    preview += `根据上一层的分类结果，从对应子类中选择：\n`;
                                    for (const [parent, items] of Array.from(byParent)) {
                                        if (parent) {
                                            preview += `  若上级="${parent}" → `;
                                            preview += items.map(r => r.criteria ? `"${r.name}" (${r.criteria})` : `"${r.name}"`).join('、') + '\n';
                                        } else {
                                            preview += `  通用选项：`;
                                            preview += items.map(r => r.criteria ? `"${r.name}" (${r.criteria})` : `"${r.name}"`).join('、') + '\n';
                                        }
                                    }
                                }
                                preview += `不匹配时返回"其他"。\n\n`;
                            }
                            if (disambiguationHints.trim()) {
                                preview += `【判断提示】${disambiguationHints.trim()}\n\n`;
                            }
                            preview += `【标签】同时为每张图片生成 3-5 个描述性标签。\n\n`;
                            if (customInstructions.trim()) {
                                preview += `【额外要求】${customInstructions.trim()}\n\n`;
                            }
                            const dimFieldsExample = advancedLevels.map(l => `"${l}":"分类名"`).join(',');
                            preview += `请严格按以下 JSON 格式返回：\n[{"index":1,"ref":"REF_1_xxxx","categories":{${dimFieldsExample}},"tags":["标签1","标签2"]},...]`;
                        } else if (activeDims.length > 0) {
                            preview += `请按以下 ${activeDims.length} 个维度分别分类：\n\n`;
                            activeDims.forEach((dim, i) => {
                                preview += `【维度${i + 1}: ${dim.name}】`;
                                if (dim.description?.trim()) {
                                    preview += `\n判断标准：${dim.description.trim()}\n`;
                                }
                                if (dim.categories.length > 0) {
                                    preview += `请将每张图片归入以下分类之一（必须严格使用下面给出的原始名称，禁止使用同义词、近义词或改写）：\n`;
                                    if (dim.categoryCriteria && Object.keys(dim.categoryCriteria).length > 0) {
                                        preview += dim.categories.map(c => dim.categoryCriteria![c] ? `"${c}" (判定条件: ${dim.categoryCriteria![c]})` : `"${c}"`).join('、') + '\n';
                                    } else {
                                        preview += dim.categories.map(c => `"${c}"`).join('、') + '\n';
                                    }
                                    preview += `⚠️ 分类名必须与上面完全一致，逐字匹配。不属于以上任何分类，使用"其他"。\n\n`;
                                } else {
                                    preview += `请根据图片内容自动判断一个最合适的分类。\n\n`;
                                }
                            });
                        } else if (userCats.length > 0) {
                            preview += `【主分类】请将每张图片归入以下分类之一（必须严格使用下面给出的原始名称，禁止使用同义词、近义词或改写）：\n`;
                            preview += userCats.map(c => `"${c}"`).join('、') + '\n';
                            preview += `⚠️ 分类名必须与上面完全一致，逐字匹配。如果图片不属于以上任何分类，使用"其他"。\n\n`;
                        } else {
                            preview += `【主分类】请根据图片内容自动判断一个最合适的主分类（如：人物、风景、产品、食物、建筑、动物、插画、抽象等）。\n\n`;
                        }
                        preview += `【标签】同时为每张图片生成 3-5 个描述性标签（必须使用中文），涵盖：内容主体、色调/配色、构图风格、情绪氛围等。\n\n`;
                        if (customInstructions.trim()) {
                            preview += `【额外要求】${customInstructions.trim()}\n\n`;
                        }
                        if (activeDims.length > 0) {
                            const dimFieldsExample = activeDims.map(d => `"${d.name}":"分类名"`).join(',');
                            preview += `请严格按以下 JSON 格式返回：\n[{"index":1,"ref":"REF_1_xxxx","categories":{${dimFieldsExample}},"tags":["标签1","标签2"]},...]`;
                        } else {
                            preview += `请严格按以下 JSON 格式返回：\n[{"index":1,"ref":"REF_1_xxxx","category":"分类名","tags":["标签1","标签2","标签3"]},...]`;
                        }
                        return (
                            <pre style={{
                                fontSize: 10,
                                lineHeight: 1.5,
                                color: '#ccc',
                                background: 'rgba(0,0,0,0.3)',
                                padding: 8,
                                borderRadius: 6,
                                marginTop: 6,
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                                maxHeight: 300,
                                overflowY: 'auto',
                                scrollbarWidth: 'thin' as any,
                            }}>
                                {preview}
                            </pre>
                        );
                    })()}
                </div>

                {Array.from(allCategoriesByDim.entries()).map(([dimName, catMap]) => (
                    <div key={dimName} className="is-filter-bar">
                        <span style={{ color: '#888', flexShrink: 0, fontSize: '11px', fontWeight: 600, marginRight: 2 }}>📁 {dimName}</span>
                        <div className="is-filter-tags-wrap">
                            <button
                                className={`is-filter-tab ${!activeFilters[dimName] ? 'active' : ''}`}
                                onClick={() => setActiveFilters(prev => ({ ...prev, [dimName]: null }))}
                            >
                                全部 <span className="is-tab-count">({images.length})</span>
                            </button>
                            {Array.from(catMap.entries()).map(([cat, count]) => {
                                const isPending = pendingAssignItems.some(p => p.source === dimName && p.value === cat);
                                return (
                                    <span key={cat} style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
                                        <button
                                            className={`is-filter-tab ${activeFilters[dimName] === cat ? 'active' : ''}`}
                                            onClick={() => setActiveFilters(prev => ({ ...prev, [dimName]: prev[dimName] === cat ? null : cat }))}
                                        >
                                            {cat} <span className="is-tab-count">({count})</span>
                                        </button>
                                        <button
                                            className="is-chip-remove"
                                            style={{ fontSize: 10, opacity: isPending ? 1 : 0.4, padding: '0 2px', marginLeft: -4, color: isPending ? '#a78bfa' : undefined }}
                                            title={isPending ? `取消选择「${cat}」` : `将「${cat}」下的 ${count} 张图片指定到维度`}
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                togglePendingAssign(dimName, cat);
                                            }}
                                        >{isPending ? '✓' : '→'}</button>
                                    </span>
                                );
                            })}
                        </div>
                    </div>
                ))}

                {/* Assignment panel - appears when items are pending */}
                {pendingAssignItems.length > 0 && (
                    <div className="is-filter-bar" style={{ gap: 6, background: 'rgba(100,80,255,0.08)', borderLeft: '3px solid rgba(100,80,255,0.4)' }}>
                        <span style={{ color: '#aaa', fontSize: 11, whiteSpace: 'nowrap' }}>
                            已选 {pendingAssignItems.length} 个:
                        </span>
                        <div className="is-filter-tags-wrap">
                            {pendingAssignItems.map((item, i) => (
                                <span key={i} className="is-chip" style={{ fontSize: 10, padding: '1px 6px' }}>
                                    {item.source === '__tag__' ? `🏷${item.value}` : item.value}
                                    <button className="is-chip-remove" onClick={() => togglePendingAssign(item.source, item.value)}>×</button>
                                </span>
                            ))}
                        </div>
                        <span style={{ color: '#888', fontSize: 11 }}>→ 维度:</span>
                        <select
                            className="is-batch-control-select"
                            style={{ fontSize: 11, minWidth: 70, width: '100%' }}
                            value={assignIsNewDim ? '__new__' : assignTargetDim}
                            onChange={e => {
                                if (e.target.value === '__new__') {
                                    setAssignIsNewDim(true);
                                    setAssignTargetDim('');
                                } else {
                                    setAssignIsNewDim(false);
                                    setAssignTargetDim(e.target.value);
                                }
                            }}
                        >
                            <option value="__new__">+ 新维度...</option>
                            {dimensions.map(d => (
                                <option key={d.id} value={d.name}>{d.name}</option>
                            ))}
                        </select>
                        {assignIsNewDim && (
                            <input
                                className="is-chips-input"
                                style={{ width: '100%', padding: '2px 6px', fontSize: 11 }}
                                value={assignTargetDim}
                                onChange={e => setAssignTargetDim(e.target.value)}
                                placeholder="维度名"
                                autoFocus
                                onKeyDown={e => {
                                    if (e.key === 'Enter' && assignTargetDim.trim()) {
                                        applyAssignToDimension(assignTargetDim);
                                    } else if (e.key === 'Escape') {
                                        setPendingAssignItems([]);
                                    }
                                }}
                            />
                        )}
                        <div style={{ display: 'flex', gap: 4, width: '100%' }}>
                            <button
                                className="is-btn is-btn-sm is-btn-primary"
                                onClick={() => applyAssignToDimension(assignTargetDim)}
                                disabled={!assignTargetDim.trim()}
                                style={{ fontSize: 11, flex: 1 }}
                            >
                                <Check size={12} /> 确定
                            </button>
                            <button
                                className="is-btn is-btn-sm"
                                onClick={() => setPendingAssignItems([])}
                                style={{ fontSize: 11 }}
                            >
                                取消
                            </button>
                        </div>
                    </div>
                )}

                {/* Aspect ratio filter */}
                {allRatios.size > 1 && (
                    <div className="is-filter-bar">
                        <span style={{ color: '#888', flexShrink: 0, fontSize: '11px', fontWeight: 600 }}>📐 比例</span>
                        <div className="is-filter-tags-wrap">
                            <button
                                className={`is-filter-tab ${activeRatio === null ? 'active' : ''}`}
                                onClick={() => setActiveRatio(null)}
                            >
                                全部
                            </button>
                            {Array.from(allRatios.entries()).map(([ratio, count]) => (
                                <button
                                    key={ratio}
                                    className={`is-filter-tab ${activeRatio === ratio ? 'active' : ''}`}
                                    onClick={() => setActiveRatio(activeRatio === ratio ? null : ratio)}
                                >
                                    {ratio} <span className="is-tab-count">({count})</span>
                                </button>
                            ))}
                        </div>
                    </div>
                )}

                {/* Tag cloud */}
                {allTags.size > 0 && (
                    <div className="is-tag-cloud">
                        <span style={{ color: '#888', fontSize: '11px', fontWeight: 600, width: '100%', marginBottom: 4 }}>🏷️ 标签</span>
                        {Array.from(allTags.entries()).slice(0, 50).map(([tag, count]) => {
                            const isPending = pendingAssignItems.some(p => p.source === '__tag__' && p.value === tag);
                            return (
                                <span key={tag} style={{ display: 'inline-flex', alignItems: 'center', gap: 0 }}>
                                    <button
                                        className={`is-tag ${activeTags.has(tag) ? 'active' : ''}`}
                                        onClick={() => toggleTag(tag)}
                                    >
                                        {tag} <span className="is-tag-count">({count})</span>
                                    </button>
                                    <button
                                        className="is-chip-remove"
                                        style={{ fontSize: 9, opacity: isPending ? 1 : 0.3, padding: '0 1px', marginLeft: -2, color: isPending ? '#a78bfa' : undefined }}
                                        title={isPending ? `取消选择「${tag}」` : `将带「${tag}」标签的 ${count} 张图片指定到维度`}
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            togglePendingAssign('__tag__', tag);
                                        }}
                                    >{isPending ? '✓' : '→'}</button>
                                </span>
                            );
                        })}
                    </div>
                )}
            </div>

            <div
                className="is-sidebar-resizer"
                onMouseDown={startSidebarResize}
                title="拖拽调整左侧宽度"
            />

            {/* ===== RIGHT MAIN AREA ===== */}
            <div className="is-main-area">
                {/* Toolbar */}
                <div className="is-toolbar">
                    <div className="is-toolbar-title">
                        <Grid3x3 size={18} />
                        图片智能分拣
                    </div>

                    <div className="is-toolbar-stats">
                        <span>📷 {images.length} 张</span>
                        {classifiedCount > 0 && <span>✅ {classifiedCount} 已分类</span>}
                        {apiCallCount > 0 && <span style={{ marginLeft: 8, color: 'var(--color-primary, #7c3aed)', fontWeight: 600 }}>📡 {apiCallCount} 次 API 调用</span>}
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

                        <button
                            type="button"
                            onClick={() => setTurboMode(!turboMode)}
                            disabled={classifying}
                            className={`is-btn is-btn-sm`}
                            style={turboMode ? {
                                background: 'rgba(245, 158, 11, 0.15)',
                                color: '#f59e0b',
                                border: '1px solid rgba(245, 158, 11, 0.4)',
                                borderRadius: '9999px',
                                fontSize: '11px',
                                padding: '2px 8px',
                            } : {
                                background: 'rgba(100, 116, 139, 0.1)',
                                color: '#94a3b8',
                                border: '1px solid rgba(100, 116, 139, 0.3)',
                                borderRadius: '9999px',
                                fontSize: '11px',
                                padding: '2px 8px',
                            }}
                            title={turboMode
                                ? `Turbo: ${turboModel} + ${turboConcurrency}并发`
                                : `标准: ${textModel || DEFAULT_MODEL} + ${standardConcurrency}并发`}
                        >
                            ⚡ {turboMode ? 'Turbo' : '标准'}
                        </button>

                        {/* 模型选择 */}
                        {turboMode && (
                            <select
                                className="is-batch-control-select"
                                value={turboModel}
                                disabled={classifying}
                                onChange={(e) => setTurboModel(e.target.value)}
                                style={{ fontSize: '10px', maxWidth: '130px' }}
                                title="Turbo 模型"
                            >
                                {ALL_MODELS.map(m => (
                                    <option key={m.value} value={m.value}>{m.label}</option>
                                ))}
                            </select>
                        )}

                        {/* 并发数 */}
                        <div className="is-batch-control" title="并发 worker 数量">
                            <span className="is-batch-control-label">并发</span>
                            <select
                                className="is-batch-control-select"
                                value={turboMode ? turboConcurrency : standardConcurrency}
                                disabled={classifying}
                                onChange={(e) => {
                                    const val = Number(e.target.value);
                                    if (turboMode) setTurboConcurrency(val);
                                    else setStandardConcurrency(val);
                                }}
                            >
                                {CONCURRENCY_OPTIONS.map(n => (
                                    <option key={n} value={n}>{n}</option>
                                ))}
                            </select>
                        </div>

                        <div className="is-batch-control" title="每次 API 请求包含的图片数量">
                            <span className="is-batch-control-label">批次</span>
                            <select
                                className="is-batch-control-select"
                                value={imageBatchSize}
                                disabled={classifying}
                                onChange={(e) => {
                                    const val = Number(e.target.value);
                                    setImageBatchSize(val);
                                }}
                            >
                                {BATCH_SIZE_OPTIONS.map(size => (
                                    <option key={size} value={size}>{size}</option>
                                ))}
                            </select>
                        </div>
                        <div className="is-batch-control" title="粘贴时如何解析数据结构">
                            <span className="is-batch-control-label">粘贴源</span>
                            <select
                                className="is-batch-control-select"
                                value={dataInputMode}
                                onChange={(e) => {
                                    const mode = e.target.value as 'standard' | 'matrix';
                                    setDataInputMode(mode);
                                    setDataExportMode(mode);
                                }}
                            >
                                <option value="standard">默认结构</option>
                                <option value="matrix">横版结构提取 (包含其他数据行)</option>
                            </select>
                        </div>

                        <div className="is-batch-control" title="复制时输出的数据结构">
                            <span className="is-batch-control-label">导出</span>
                            <select
                                className="is-batch-control-select"
                                value={dataExportMode}
                                onChange={(e) => {
                                    const mode = e.target.value as 'standard' | 'matrix';
                                    setDataExportMode(mode);
                                    setDataInputMode(mode);
                                }}
                            >
                                <option value="standard">垂直 (标准)</option>
                                <option value="matrix">水平 (Matrix)</option>
                            </select>
                        </div>

                        <button
                            className="is-btn"
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <ImagePlus size={14} /> 添加图片
                        </button>

                        <button
                            className="is-btn"
                            onClick={() => folderInputRef.current?.click()}
                            title="选择文件夹 — 自动按子目录结构分类"
                        >
                            <FolderOpen size={14} /> 添加文件夹
                        </button>

                        {!classifying ? (
                            <>
                                {images.length - classifiedCount > 0 && (
                                    <button
                                        className="is-btn is-btn-primary"
                                        onClick={handleClassify}
                                        disabled={images.length === 0}
                                    >
                                        <Sparkles size={14} />
                                        {classifiedCount > 0
                                            ? `重试失败 (${images.length - classifiedCount} 张)`
                                            : `开始 AI 分类 (${images.length} 张)`
                                        }
                                    </button>
                                )}
                                {classifiedCount > 0 && (
                                    <button
                                        className="is-btn"
                                        onClick={handleReclassifyAll}
                                        style={{ background: 'rgba(255,255,255,0.08)', color: '#eee' }}
                                    >
                                        <RotateCw size={14} /> 全部重新分类
                                    </button>
                                )}
                            </>
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
                        {/* @ts-ignore — webkitdirectory is a non-standard attribute */}
                        <input
                            ref={folderInputRef}
                            type="file"
                            // @ts-ignore
                            webkitdirectory=""
                            // @ts-ignore
                            directory=""
                            multiple
                            style={{ display: 'none' }}
                            onChange={handleFolderSelect}
                        />
                    </div>
                </div>

                {/* Progress bar */}
                {progress.total > 0 && (
                    <div className="is-progress-panel">
                        <div className="is-progress-bar-track">
                            <div
                                className="is-progress-bar-fill"
                                style={{ width: `${progress.total > 0 ? (progress.done / progress.total) * 100 : 0}%` }}
                            />
                        </div>
                        <div className="is-progress-text">
                            <span><Loader2 size={12} className="animate-spin" style={{ display: 'inline', marginRight: 4 }} /> {classifying ? '正在分类...' : '正在加载图片...'} {apiCallCount > 0 && <span style={{ marginLeft: 8, color: '#f43f5e', fontWeight: 500, fontSize: '11px' }}>({apiCallCount} 次 API 调用)</span>}</span>
                            <span>{progress.done} / {progress.total}</span>
                        </div>
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
                            {img.isBlankRow ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', padding: '20px', textAlign: 'center', color: '#666', fontSize: '12px', border: '1px dashed #444', borderRadius: 6, background: 'rgba(255,255,255,0.02)' }}>
                                    <div style={{ opacity: 0.5 }}>空白行</div>
                                    <div style={{ fontSize: '9px', opacity: 0.3, marginTop: '4px' }}>保持原始表格行结构</div>
                                </div>
                            ) : (
                                <>
                                    <img src={img.src} alt={img.name} loading="lazy" />

                                    <span className="is-gallery-index">
                                        #{img.originalIndex + 1}
                                        {img.metadataRows && img.metadataRows.length > 0 && (
                                            <span style={{ marginLeft: 4, background: 'rgba(236,72,153,0.3)', color: '#fbcfe8', padding: '1px 4px', borderRadius: 4, fontSize: '9px' }} title={`${img.metadataRows.length} 行附属文本数据`}>
                                                M
                                            </span>
                                        )}
                                    </span>

                                    {img.aspectRatio && (
                                        <span className="is-gallery-ratio">
                                            {img.aspectRatio}
                                            {img.width && img.height && (
                                                <span style={{ opacity: 0.7, marginLeft: 3, fontSize: '8px' }}>{img.width}×{img.height}</span>
                                            )}
                                        </span>
                                    )}

                                    {img.folderPath && (
                                        <span
                                            style={{
                                                position: 'absolute', top: 4, left: 4, zIndex: 3,
                                                background: 'rgba(59,130,246,0.75)', color: '#fff',
                                                padding: '1px 6px', borderRadius: 4, fontSize: '9px',
                                                maxWidth: '80%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                backdropFilter: 'blur(4px)',
                                            }}
                                            title={`📂 ${img.folderPath}`}
                                        >
                                            📂 {img.folderPath}
                                        </span>
                                    )}

                                    <div className="is-gallery-check">
                                        {selectedIds.has(img.id) && <Check size={12} />}
                                    </div>

                                    <div className="is-gallery-actions">
                                        <button
                                            className="is-gallery-action-btn"
                                            title="重新分类"
                                            onClick={(e) => { e.stopPropagation(); handleSingleReclassify(img.id); }}
                                        >
                                            <RefreshCw size={12} />
                                        </button>
                                        <button
                                            className="is-gallery-action-btn"
                                            title="修改分类"
                                            onClick={(e) => { e.stopPropagation(); setEditingImage(img); }}
                                        >
                                            <Edit3 size={12} />
                                        </button>
                                    </div>

                                    {/* Gyazo uploading overlay */}
                                    {img.isGyazoUploading && (
                                        <div style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', color: '#fff', fontSize: '10px', zIndex: 5, borderRadius: 'inherit' }}>
                                            <Loader2 className="animate-spin" size={18} style={{ marginBottom: '4px' }} />
                                            <span>上传中</span>
                                        </div>
                                    )}

                                    {img.classified && !img.isBlankRow && (
                                        <div className="is-gallery-overlay">
                                            {img.categories && Object.keys(img.categories).length > 0 ? (
                                                <div className="is-gallery-category" style={{ display: 'flex', flexWrap: 'wrap', gap: 3 }}>
                                                    {Object.entries(img.categories).map(([dimName, catVal]) => (
                                                        <span key={dimName} style={{ display: 'inline-flex', alignItems: 'center', gap: 2 }}>
                                                            <span style={{ opacity: 0.7, fontSize: '9px' }}>{dimName}:</span>{catVal}
                                                        </span>
                                                    ))}
                                                </div>
                                            ) : img.category ? (
                                                <div className="is-gallery-category">{img.category}</div>
                                            ) : null}
                                            {img.tags && img.tags.length > 0 && (
                                                <div className="is-gallery-tags">
                                                    {img.tags.slice(0, 4).map((tag, i) => (
                                                        <span key={i} className="is-gallery-tag">{tag}</span>
                                                    ))}
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </>
                            )}
                        </div>
                    ))}
                </div>

                {/* Bottom action bar */}
                <div className="is-action-bar">
                    <span className="is-action-bar-info" style={{ whiteSpace: 'nowrap', display: 'flex', alignItems: 'center', flexShrink: 0 }}>
                        <span>显示 {filteredImages.length} 张</span>
                        {selectedIds.size > 0 && <span>&nbsp;· 已选 {selectedIds.size} 张</span>}
                        {images.some(img => img.isGyazoUploading) && (
                            <span style={{ color: '#a78bfa', marginLeft: 8, display: 'flex', alignItems: 'center' }}>
                                <Loader2 className="animate-spin" size={11} style={{ marginRight: 3 }} />
                                当前上传中 {images.filter(img => img.isGyazoUploading).length} 张
                            </span>
                        )}
                    </span>

                    <button className="is-btn is-btn-sm" onClick={selectAll}>
                        <CheckSquare size={12} /> 全选
                    </button>
                    <button className="is-btn is-btn-sm" onClick={selectNone}>
                        <X size={12} /> 取消
                    </button>
                    {selectedIds.size > 0 && (
                        <button
                            className="is-btn is-btn-sm"
                            style={{ background: 'rgba(251, 146, 60, 0.2)', color: '#fb923c' }}
                            onClick={() => handleBatchReclassify(selectedIds)}
                            disabled={classifying}
                        >
                            <RefreshCw size={12} /> 重新分类选中 ({selectedIds.size})
                        </button>
                    )}

                    <button
                        className="is-btn is-btn-primary"
                        onClick={() => copyToSheets({ withImage: false })}
                        disabled={images.length === 0}
                    >
                        <Copy size={14} /> {selectedIds.size > 0 ? `仅复制分类结果 (${selectedIds.size})` : `仅复制分类结果 (${images.length})`}
                    </button>
                    <button
                        className="is-btn is-btn-primary"
                        onClick={() => handleDownloadClick(selectedIds.size > 0)}
                        disabled={images.length === 0}
                    >
                        <Download size={14} /> {selectedIds.size > 0 ? `下载选中图片 (${selectedIds.size})` : `下载全部图片 (${images.filter(i => !i.isBlankRow && !i.loadFailed).length})`}
                    </button>
                    <button
                        className="is-btn is-btn-primary"
                        onClick={() => copyToSheets({ withImage: true, uploadGyazo: true })}
                        disabled={images.length === 0}
                    >
                        <Copy size={14} /> {selectedIds.size > 0 ? `上传全部并复制 (${selectedIds.size})` : `上传全部并复制 (${images.length})`}
                    </button>
                    <button
                        className="is-btn is-btn-primary"
                        style={{ background: 'linear-gradient(135deg, #059669, #10b981)' }}
                        onClick={() => copyToSheets({ withImage: true, uploadGyazo: true, classifiedOnly: true })}
                        disabled={images.filter(i => i.classified).length === 0}
                    >
                        <Copy size={14} /> 仅上传已分类 ({images.filter(i => i.classified).length})
                    </button>
                </div>
            </div>
            {uploadingGyazo && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#222', padding: 24, borderRadius: 12, color: '#fff', textAlign: 'center', minWidth: 280 }}>
                        <Loader2 className="animate-spin" size={32} style={{ margin: '0 auto 10px' }} />
                        <div>正在上传到 Gyazo ({uploadingGyazo.done}/{uploadingGyazo.total})</div>
                        <div style={{ width: '100%', height: 4, background: '#444', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
                            <div style={{ width: `${(uploadingGyazo.done / uploadingGyazo.total) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #7c3aed, #a78bfa)', borderRadius: 2, transition: 'width 0.3s ease' }} />
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>速度取决于图片大小和网络</div>
                        <button
                            className="is-btn"
                            style={{ marginTop: 12, background: '#dc2626', border: 'none', color: '#fff', padding: '6px 20px' }}
                            onClick={() => { gyazoAbortRef.current = true; }}
                        >
                            <X size={14} /> 停止上传
                        </button>
                    </div>
                </div>
            )}

            {/* Loading local images overlay */}
            {loadingImages && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#222', padding: 24, borderRadius: 12, color: '#fff', textAlign: 'center', minWidth: 280 }}>
                        <Loader2 className="animate-spin" size={32} style={{ margin: '0 auto 10px' }} />
                        <div>正在加载本地图片 ({loadingImages.done}/{loadingImages.total})</div>
                        <div style={{ width: '100%', height: 4, background: '#444', borderRadius: 2, marginTop: 10, overflow: 'hidden' }}>
                            <div style={{ width: `${(loadingImages.done / loadingImages.total) * 100}%`, height: '100%', background: 'linear-gradient(90deg, #7c3aed, #a78bfa)', borderRadius: 2, transition: 'width 0.3s ease' }} />
                        </div>
                        <div style={{ fontSize: 12, opacity: 0.7, marginTop: 8 }}>请等待加载完成后再进行操作...</div>
                    </div>
                </div>
            )}

            {/* Custom Confirm Download Modal */}
            {confirmDownloadState && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#1c1c1c', padding: '24px', borderRadius: '12px', color: '#fff', textAlign: 'center', width: '320px', boxShadow: '0 10px 30px rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.05)' }}>
                        <div style={{ fontSize: '18px', fontWeight: 600, marginBottom: '12px' }}>确认打包下载</div>
                        <div style={{ fontSize: '14px', opacity: 0.8, color: '#ccc', marginBottom: '24px', lineHeight: '1.5' }}>
                            即将下载 {confirmDownloadState.total} 张{confirmDownloadState.onlySelected ? '选中的' : '全部'}图片并打包为本地 ZIP 文件。
                        </div>
                        <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                            <button
                                style={{ flex: 1, padding: '10px 0', borderRadius: '8px', background: 'rgba(255,255,255,0.08)', color: '#fff', border: 'none', cursor: 'pointer', fontSize: '14px', transition: 'background 0.2s' }}
                                onClick={() => setConfirmDownloadState(null)}
                                onMouseOver={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.12)'}
                                onMouseOut={(e) => e.currentTarget.style.background = 'rgba(255,255,255,0.08)'}
                            >
                                取消
                            </button>
                            <button
                                style={{ flex: 1, padding: '10px 0', borderRadius: '8px', background: '#a78bfa', color: '#111', border: 'none', cursor: 'pointer', fontSize: '14px', fontWeight: 600, transition: 'background 0.2s' }}
                                onClick={executeDownload}
                                onMouseOver={(e) => e.currentTarget.style.background = '#b79bfb'}
                                onMouseOut={(e) => e.currentTarget.style.background = '#a78bfa'}
                            >
                                确定下载
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Download Progress Modal */}
            {downloadProgress && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.5)', zIndex: 9999, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: '#222', padding: '24px', borderRadius: '12px', color: '#fff', textAlign: 'center', width: '320px', boxShadow: '0 10px 25px rgba(0,0,0,0.5)' }}>
                        <Loader2 className="animate-spin" size={36} style={{ margin: '0 auto 16px', color: '#a78bfa' }} />
                        <div style={{ fontSize: '16px', fontWeight: 600, marginBottom: '8px' }}>{downloadProgress.status}</div>
                        <div style={{ width: '100%', height: '6px', background: 'rgba(255,255,255,0.1)', borderRadius: '3px', overflow: 'hidden', margin: '16px 0' }}>
                            <div style={{
                                height: '100%',
                                background: '#a78bfa',
                                width: `${downloadProgress.total > 0 ? (downloadProgress.current / downloadProgress.total) * 100 : 0}%`,
                                transition: 'width 0.2s ease-out'
                            }} />
                        </div>
                        <div style={{ fontSize: '13px', opacity: 0.7 }}>打包过程可能需要一段时间请勿关闭窗口</div>
                    </div>
                </div>
            )}

            {/* Edit Image Category Modal */}
            {editingImage && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }}>
                    <div style={{ background: '#1e1e1e', padding: 24, borderRadius: 12, width: '100%', maxWidth: 500, color: '#eee', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }}>
                        <h3 style={{ margin: '0 0 16px', fontSize: 16 }}>修改分类结果</h3>

                        <div style={{ display: 'flex', gap: 16, marginBottom: 20 }}>
                            <img src={editingImage.src} alt="preview" style={{ width: 120, height: 120, objectFit: 'contain', background: '#000', borderRadius: 8 }} />
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 12 }}>

                                {classifyMode === 'advanced' && advancedLevels.length > 0 ? (
                                    advancedLevels.map(lvl => (
                                        <div key={lvl}>
                                            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{lvl}</div>
                                            <input
                                                className="is-input"
                                                style={{ width: '100%', padding: '6px 10px' }}
                                                defaultValue={editingImage.categories?.[lvl] || ''}
                                                id={`edit-cat-${lvl}`}
                                            />
                                        </div>
                                    ))
                                ) : dimensions.filter(d => d.name.trim()).length > 0 ? (
                                    dimensions.filter(d => d.name.trim()).map(dim => (
                                        <div key={dim.name}>
                                            <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>{dim.name}</div>
                                            <input
                                                className="is-input"
                                                style={{ width: '100%', padding: '6px 10px' }}
                                                defaultValue={editingImage.categories?.[dim.name] || ''}
                                                id={`edit-cat-${dim.name}`}
                                            />
                                        </div>
                                    ))
                                ) : (
                                    <div>
                                        <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>主分类</div>
                                        <input
                                            className="is-input"
                                            style={{ width: '100%', padding: '6px 10px' }}
                                            defaultValue={editingImage.category || ''}
                                            id="edit-cat-primary"
                                        />
                                    </div>
                                )}

                                <div>
                                    <div style={{ fontSize: 12, opacity: 0.7, marginBottom: 4 }}>标签 (用逗号分隔)</div>
                                    <input
                                        className="is-input"
                                        style={{ width: '100%', padding: '6px 10px' }}
                                        defaultValue={(editingImage.tags || []).join(', ')}
                                        id="edit-tags"
                                    />
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 12 }}>
                            <button className="is-btn" onClick={() => setEditingImage(null)}>取消</button>
                            <button className="is-btn is-btn-primary" onClick={() => {
                                const newCategories: Record<string, string> = {};
                                let primaryCat = editingImage.category || '';
                                const adims = dimensions.filter(d => d.name.trim());

                                if (classifyMode === 'advanced' && advancedLevels.length > 0) {
                                    advancedLevels.forEach(lvl => {
                                        const val = (document.getElementById(`edit-cat-${lvl}`) as HTMLInputElement)?.value.trim();
                                        if (val) newCategories[lvl] = val;
                                    });
                                    primaryCat = newCategories[advancedLevels[0]] || '其他';
                                } else if (adims.length > 0) {
                                    adims.forEach(dim => {
                                        const val = (document.getElementById(`edit-cat-${dim.name}`) as HTMLInputElement)?.value.trim();
                                        if (val) newCategories[dim.name] = val;
                                    });
                                    primaryCat = newCategories[adims[0].name] || '其他';
                                } else {
                                    primaryCat = (document.getElementById('edit-cat-primary') as HTMLInputElement)?.value.trim() || '其他';
                                }

                                const tagsStr = (document.getElementById('edit-tags') as HTMLInputElement)?.value || '';
                                const newTags = tagsStr.split(/[,，、]/).map(t => t.trim()).filter(Boolean);

                                handleSaveEdit(primaryCat, newCategories, newTags);
                            }}>保存修改</button>
                        </div>
                    </div>
                </div>
            )}

            {/* Enlarged Textarea Modal */}
            {enlargedInput && (
                <div style={{ position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, background: 'rgba(0,0,0,0.6)', zIndex: 10000, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 20 }} onClick={() => setEnlargedInput(null)}>
                    <div style={{ background: '#1e1e1e', padding: 24, borderRadius: 12, width: '100%', maxWidth: 700, height: '80vh', display: 'flex', flexDirection: 'column', color: '#eee', boxShadow: '0 10px 30px rgba(0,0,0,0.5)' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
                            <h3 style={{ margin: 0, fontSize: 16 }}>{enlargedInput.title}</h3>
                            <button className="is-btn" style={{ padding: '4px 8px' }} onClick={() => setEnlargedInput(null)}><X size={16} /></button>
                        </div>

                        <textarea
                            style={{
                                flex: 1,
                                width: '100%',
                                background: '#111',
                                border: '1px solid #333',
                                borderRadius: 8,
                                color: '#fff',
                                padding: 16,
                                fontSize: 13,
                                lineHeight: 1.6,
                                resize: 'none',
                                fontFamily: 'monospace'
                            }}
                            autoFocus
                            value={enlargedInput.value}
                            onChange={e => setEnlargedInput({ ...enlargedInput, value: e.target.value })}
                            onKeyDown={e => {
                                // Cmd+Enter / Ctrl+Enter to save and close
                                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                                    enlargedInput.onChange(enlargedInput.value);
                                    setEnlargedInput(null);
                                }
                            }}
                        />

                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 16 }}>
                            <span style={{ fontSize: 12, color: '#666' }}>提示：支持使用快捷键 (⌘+Enter / Ctrl+Enter) 保存</span>
                            <div style={{ display: 'flex', gap: 12 }}>
                                <button className="is-btn" onClick={() => setEnlargedInput(null)}>取消</button>
                                <button className="is-btn is-btn-primary" onClick={() => {
                                    enlargedInput.onChange(enlargedInput.value);
                                    setEnlargedInput(null);
                                }}>保存</button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default ImageSorterApp;
