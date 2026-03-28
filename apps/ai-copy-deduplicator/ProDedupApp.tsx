/**
 * 文案相似度检查工具 - 基于 MinHash + LSH 算法
 * 
 * 使用和 AI 查重完全相同的 UI，但底层用专业的 MinHash 算法
 * - 毫秒级处理数万条文案
 * - 纯本地运算，零 API 成本
 * - 支持 Google Sheets 分类库
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import {
    Zap, Database, Download, Copy, Trash2, Search, Settings, X, Check, Link,
    Cloud, CloudOff, Loader2, FolderPlus, Edit2, Plus, FileCode, Tag, ArrowUpDown,
    ChevronDown, ChevronUp, Sparkles, Eye, Brain
} from 'lucide-react';
import { appendToSheet, getSheetsSyncConfig } from '@/services/sheetsSyncService';
import { dedupEngine, TextItem, DedupResult, DuplicateGroup } from './services/minHashEngine';
import { parseInputText, parseInputFromHtml, getTextEmbedding, batchEmbedTexts } from './services/similarityService';
import type { GoogleGenAI } from '@google/genai';
import {
    classifyWithAI,
    AiClassifyResult,
    AiClassifyProgress,
    ClassifyStats,
    computeClassifyStats,
    sortedEntries,
    MAJOR_CATEGORY_COLORS,
    CLASSIFY_SYSTEM_PROMPT,
} from './services/aiClassifyService';
import {
    SheetLibraryService,
    getSheetLibraryService,
    setSheetLibraryService,
    extractSpreadsheetId,
    CategoryItem,
    AuthMode,
    getServiceAccountEmail
} from './services/sheetLibraryService';
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '@/contexts/AuthContext';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db } from '@/firebase/index';

// 复用 SheetsAuthConfig 的 GAS 样式
import '../../components/SheetsAuthConfig.css';

// ==================== 类型 ====================

interface ProDedupState {
    inputText: string;
    result: DedupResult | null;
    isProcessing: boolean;
    threshold: number;
    showSettings: boolean;
    librarySize: number;
    showLibrary: boolean;
    manuallyMarkedUnique: Set<string>;
    selectedForMerge: string | null;
    // Sheets 配置
    sheetUrl: string;
    isSheetConnected: boolean;
    isLoadingSheet: boolean;
    sheetError: string | null;
    categories: string[];
    selectedCategory: string | null;
    sheetLibraryItems: CategoryItem[];
    authMode: AuthMode;
    gasWebAppUrl: string;  // GAS Web App URL
    // 模式
    mode: 'check' | 'search' | 'classify' | 'ai-classify';
    searchQuery: string;
    // 搜索结果分组：每个原始文案对应一组相似结果
    searchGroups: Array<{
        query: string;          // 英文
        queryChinese?: string;  // 中文（如果有）
        matches: Array<{
            text: string;
            chineseText?: string;
            similarity: number;
            source: 'batch' | 'library';
            category?: string;
        }>;
    }>;
    selectedSearchItems: Set<string>; // "groupIdx-matchIdx" 格式
    // 分类模式
    classifyRulesText: string; // 用户粘贴的关键词→分类规则
    classifyInputText: string; // 待分类文案
    classifyResults: Array<{
        rowIndex: number; // 原始行号（0-based）
        text: string;  // 原始文案（空字符串 = 空行）
        zhText: string; // 中文文案列（可空）
        enText: string; // 英文文案列（可空）
        category: string; // 匹配到的分类（空 = 空行保留）
        mainCategory: string; // 主类别
        subCategory: string; // 子类别
        matchedKeyword: string; // 命中的关键词
        matchedKeywordLang: 'zh' | 'en' | 'mixed' | 'unknown' | ''; // 命中关键词语言
    }>;
    classifyActiveCategories: Set<string>; // 结果筛选（多选）
    classifySortBy: 'original' | 'category'; // 排序
    classifyContextMenu: { x: number; y: number; selectedText: string } | null; // 右键菜单
    classifyNewCategoryInput: string; // 新分类输入
    classifyInputCollapsed: boolean; // 输入区折叠
    classifyAddKeyword: string; // 内联添加关键词
    classifyAddCategory: string; // 内联添加分类
    // AI 语义分类模式
    aiClassifyInputText: string;
    aiClassifyResults: AiClassifyResult[];
    aiClassifyBatchSize: number;
    aiClassifyDepth: 'full' | 'major';
    aiClassifyProgress: AiClassifyProgress | null;
    aiClassifyActiveCategories: Set<string>;
    aiClassifySortBy: 'original' | 'major' | 'middle' | 'minor' | 'chars-asc' | 'chars-desc';
    aiClassifyStats: ClassifyStats | null;
    aiClassifyInputCollapsed: boolean;
    aiClassifyCustomRules: CustomClassifyRule[];
    aiClassifyShowCustomRules: boolean;
    aiClassifyShowSystemPrompt: boolean;
    aiClassifySystemPromptEdit: string;
}

interface CustomClassifyRule {
    id: string;
    name: string;
    level: 'major' | 'middle' | 'minor';
    criteria: string;
    parentCategory: string; // 归属哪个上级类别 (中类需指定大类，小类需指定中类)
}

const LIBRARY_STORAGE_KEY = 'pro_dedup_library';
const SHEET_CONFIG_KEY = 'pro_dedup_sheet_config';

const getPrimaryCount = (items: CategoryItem[]): number => {
    const primaryItems = items.filter(item => item.isPrimary);
    return primaryItems.length > 0 ? primaryItems.length : items.length;
};

// ==================== 文案清理函数 ====================

/**
 * AI 署名模式（会被移除）
 */
const AI_SIGNATURE_PATTERNS = [
    // ChatGPT / OpenAI 相关
    /\b(generated|created|written|made|produced)\s+(by|with|using)\s+(chatgpt|gpt|openai|ai|artificial\s+intelligence|claude|gemini|copilot)\b/gi,
    /\b(chatgpt|gpt-?\d?|openai|claude|gemini|copilot|bard)\s+(generated|created|wrote|made)\b/gi,
    /\b(this|content)\s+(was|is)\s+(generated|created|written)\s+(by|with)\s+ai\b/gi,
    /\[?(ai|chatgpt|gpt)\s*(generated|content|text|image)\]?/gi,
    // 常见的 AI 水印
    /\bpowered\s+by\s+(ai|chatgpt|openai|gpt)\b/gi,
    /\bvia\s+(chatgpt|ai|openai)\b/gi,
    // 版权声明类
    /©\s*(chatgpt|openai|ai|gpt)[^.]*\.?/gi,
];

/**
 * @ 乱文字模式（会被移除）
 */
const SPAM_AT_PATTERNS = [
    // 多个 @ 符号
    /@{2,}/g,
    // @ 后跟乱码或无意义字符串
    /@[a-z0-9_]{20,}/gi,  // 超长用户名
    /@[^a-zA-Z0-9\s]{2,}/g,  // @ 后跟特殊字符
    // 行首或行尾的 @ 提及（通常是水印）
    /^@\w+\s*/gm,
    /\s*@\w+$/gm,
];

/**
 * 清理文案：移除 AI 署名和 @ 乱文字
 */
function cleanTextForLibrary(text: string): string {
    if (!text) return '';

    let cleaned = text;

    // 移除 AI 署名
    AI_SIGNATURE_PATTERNS.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '');
    });

    // 移除 @ 乱文字
    SPAM_AT_PATTERNS.forEach(pattern => {
        cleaned = cleaned.replace(pattern, '');
    });

    // 清理多余空白
    cleaned = cleaned.replace(/\s{3,}/g, '  ').trim();

    return cleaned;
}

// ==================== 辅助函数 ====================

// 高亮相似词（支持中文等非空格分词语言）
function highlightSimilarWords(text1: string, text2: string): React.ReactNode {
    if (!text2) return text1;

    // 检测是否包含 CJK 字符
    const hasCJK = /[\u4e00-\u9fff\u3400-\u4dbf]/.test(text1);

    if (hasCJK) {
        // CJK 模式：按字符级别高亮
        const chars2Set = new Set(text2.toLowerCase().split(''));
        return text1.split('').map((char, i) => {
            if (chars2Set.has(char.toLowerCase()) && /[\u4e00-\u9fff\u3400-\u4dbf]/.test(char)) {
                return <span key={i} className="highlight-similar">{char}</span>;
            }
            return char;
        });
    }

    // 拉丁/西里尔等空格分词语言
    const words2Set = new Set(text2.toLowerCase().split(/\s+/));
    const originalWords = text1.split(/(\s+)/);

    return originalWords.map((word, i) => {
        if (/^\s+$/.test(word)) return word;
        if (words2Set.has(word.toLowerCase().replace(/[^\p{L}\p{N}]/gu, ''))) {
            return <span key={i} className="highlight-similar">{word}</span>;
        }
        return word;
    });
}

// ==================== 模型选择常量 ====================
const CLASSIFY_MODEL_KEY = 'pro_dedup_classify_model';
const INHERIT_VALUE = '__global__';

const CLASSIFY_MODEL_OPTIONS = [
  { value: INHERIT_VALUE, label: '继承全局设置' },
  { value: 'gemini-2.5-flash', label: '⚡ gemini-2.5-flash (GA)' },
  { value: 'gemini-2.5-flash-lite', label: '⚡ gemini-2.5-flash-lite (GA·最快)' },
  { value: 'gemini-2.5-pro', label: '🧠 gemini-2.5-pro (GA·强推理)' },
  { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (Preview)' },
  { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview (Preview·最新)' },
];

// ==================== 组件 ====================

interface ProDedupAppProps {
    textModel?: string;
    getAiInstance?: () => GoogleGenAI | null;
}

export function ProDedupApp({ textModel = 'gemini-3-flash-preview', getAiInstance }: ProDedupAppProps) {
    const { user } = useAuth();

    // AI 分类本地模型选择（默认继承全局）
    const [classifyLocalModel, setClassifyLocalModel] = useState<string>(() => {
        try { return localStorage.getItem(CLASSIFY_MODEL_KEY) || INHERIT_VALUE; } catch { return INHERIT_VALUE; }
    });
    const classifyEffectiveModel = classifyLocalModel === INHERIT_VALUE ? textModel : classifyLocalModel;

    const [state, setState] = useState<ProDedupState>({
        inputText: '',
        result: null,
        isProcessing: false,
        threshold: 0.5,
        showSettings: false,
        librarySize: 0,
        showLibrary: false,
        manuallyMarkedUnique: new Set(),
        selectedForMerge: null,
        // Sheets 配置
        sheetUrl: '',
        isSheetConnected: false,
        isLoadingSheet: false,
        sheetError: null,
        categories: [],
        selectedCategory: null,
        sheetLibraryItems: [],
        authMode: 'apiKey',
        gasWebAppUrl: '',
        // 搜索模式
        mode: 'check',
        searchQuery: '',
        searchGroups: [],
        selectedSearchItems: new Set(),
        // 分类模式
        classifyRulesText: '',
        classifyInputText: '',
        classifyResults: [],
        classifyActiveCategories: new Set<string>(),
        classifySortBy: 'original',
        classifyContextMenu: null,
        classifyNewCategoryInput: '',
        classifyInputCollapsed: false,
        classifyAddKeyword: '',
        classifyAddCategory: '',
        // AI 语义分类
        aiClassifyInputText: '',
        aiClassifyResults: [],
        aiClassifyBatchSize: 999, // 999 = 自动（仅受 token 预算控制）
        aiClassifyDepth: 'full',
        aiClassifyProgress: null,
        aiClassifyActiveCategories: new Set<string>(),
        aiClassifySortBy: 'original',
        aiClassifyStats: null,
        aiClassifyInputCollapsed: false,
        aiClassifyCustomRules: (() => {
            try {
                const stored = typeof window !== 'undefined' ? localStorage.getItem('ai_classify_custom_rules') : null;
                return stored ? JSON.parse(stored) : [];
            } catch { return []; }
        })(),
        aiClassifyShowCustomRules: false,
        aiClassifyShowSystemPrompt: false,
        aiClassifySystemPromptEdit: '',
    });

    const [toast, setToast] = useState<string | null>(null);

    // 右键菜单状态
    const [contextMenu, setContextMenu] = useState<{
        x: number;
        y: number;
        type: 'keep' | 'dup';
        groupIdx: number;
        dupIdx?: number;
        text: string;
        chineseText?: string;
    } | null>(null);

    // 编辑分类弹框状态
    const [editCategoryModal, setEditCategoryModal] = useState<{
        oldName: string;
        newName: string;
        type: 'rename' | 'create';
    } | null>(null);

    // 删除确认弹框状态
    const [deleteConfirmModal, setDeleteConfirmModal] = useState<string | null>(null);

    // GAS 部署指南弹窗
    const [showGasGuide, setShowGasGuide] = useState(false);

    // AI 分类 AbortController
    const aiClassifyAbortRef = useRef<AbortController | null>(null);

    // HTML 剪贴板数据（用于 Google Sheets 粘贴优化）
    const [checkPasteHtml, setCheckPasteHtml] = useState('');
    const [searchPasteHtml, setSearchPasteHtml] = useState('');

    // ==================== AI Embedding 语义搜索 ====================
    // 缓存: itemId -> embedding vector
    const embeddingCacheRef = useRef<Map<string, number[]>>(new Map());
    const [embeddingProgress, setEmbeddingProgress] = useState<string>('');
    const [isEmbeddingSearching, setIsEmbeddingSearching] = useState(false);

    // 余弦相似度
    const cosineSimilarity = (a: number[], b: number[]): number => {
        if (a.length !== b.length || a.length === 0) return 0;
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
    };

    // AI 语义搜索
    const handleEmbeddingSearch = useCallback(async () => {
        if (!state.searchQuery.trim()) {
            showToast('请输入要搜索的文案');
            return;
        }
        if (!getAiInstance) {
            showToast('AI 语义搜索需要配置 API Key');
            return;
        }
        const ai = getAiInstance();
        if (!ai) {
            showToast('请先配置 API Key');
            return;
        }

        const libraryItems = dedupEngine.exportLibrary();
        if (libraryItems.length === 0) {
            showToast('库中没有文案，请先导入');
            return;
        }

        setIsEmbeddingSearching(true);
        try {
            // 1. 获取查询文本的 embedding
            setEmbeddingProgress('正在分析查询文案...');
            // 优先用中文搜索（如果输入含中文），也合并英文
            const queryEmb = await getTextEmbedding(state.searchQuery, ai);

            // 2. 批量获取库中文案的 embedding（有缓存就跳过）
            const cache = embeddingCacheRef.current;
            const needEmbed: { id: string; text: string }[] = [];
            for (const item of libraryItems) {
                if (!cache.has(item.id)) {
                    // 合并英文和中文，让 embedding 覆盖两种语言的语义
                    const fullText = item.chineseText ? `${item.text}\n${item.chineseText}` : item.text;
                    needEmbed.push({ id: item.id, text: fullText });
                }
            }

            if (needEmbed.length > 0) {
                setEmbeddingProgress(`正在建立语义索引 (0/${needEmbed.length})...`);
                // 一次请求100条，极大加速
                const texts = needEmbed.map(item => item.text);
                const embeddings = await batchEmbedTexts(texts, ai, (done, total) => {
                    setEmbeddingProgress(`正在建立语义索引 (${done}/${total})...`);
                });
                embeddings.forEach((emb, idx) => {
                    cache.set(needEmbed[idx].id, emb);
                });
            }

            // 3. 计算余弦相似度
            setEmbeddingProgress('正在计算语义相似度...');
            const results: Array<{ item: TextItem; similarity: number }> = [];
            for (const item of libraryItems) {
                const itemEmb = cache.get(item.id);
                if (!itemEmb) continue;
                const sim = cosineSimilarity(queryEmb, itemEmb);
                if (sim >= state.threshold) {
                    results.push({ item, similarity: sim });
                }
            }
            results.sort((a, b) => b.similarity - a.similarity);
            const topResults = results.slice(0, 50);

            // 4. 转换为搜索组格式
            const searchGroups: typeof state.searchGroups = [{
                query: state.searchQuery,
                matches: topResults.map(r => ({
                    text: r.item.text,
                    chineseText: r.item.chineseText,
                    similarity: r.similarity,
                    source: 'library' as const,
                    category: (r.item as any).category
                }))
            }];

            updateState({
                searchGroups,
                isProcessing: false,
                selectedSearchItems: new Set()
            });

            setEmbeddingProgress('');
            showToast(`🧠 AI 语义搜索完成，找到 ${topResults.length} 条相似文案`);
        } catch (e: any) {
            console.error('Embedding search failed:', e);
            showToast('AI 语义搜索失败: ' + (e.message || '未知错误'));
            setEmbeddingProgress('');
        } finally {
            setIsEmbeddingSearching(false);
        }
    }, [state.searchQuery, state.threshold, getAiInstance]);

    // 相似文案弹框状态
    const [similarModal, setSimilarModal] = useState<{
        queryText: string;
        matches: Array<{ text: string; chineseText?: string; similarity: number }>;
        selected: Set<number>;
    } | null>(null);

    const showToast = (msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 4000);
    };

    const updateState = (updates: Partial<ProDedupState>) => {
        setState(s => ({ ...s, ...updates }));
    };

    // 右键菜单处理
    const handleContextMenu = (
        e: React.MouseEvent,
        type: 'keep' | 'dup',
        groupIdx: number,
        text: string,
        chineseText?: string,
        dupIdx?: number
    ) => {
        e.preventDefault();
        setContextMenu({
            x: e.clientX,
            y: e.clientY,
            type,
            groupIdx,
            dupIdx,
            text,
            chineseText
        });
    };

    // 关闭右键菜单
    const closeContextMenu = () => setContextMenu(null);

    // 右键菜单 - 复制文案
    const handleContextCopy = () => {
        if (!contextMenu) return;
        const text = contextMenu.chineseText
            ? `${contextMenu.text}\n${contextMenu.chineseText}`
            : contextMenu.text;
        navigator.clipboard.writeText(text);
        showToast('已复制');
        closeContextMenu();
    };

    // 右键菜单 - 删除
    const handleContextDelete = () => {
        if (!contextMenu) return;
        if (contextMenu.type === 'keep') {
            // 删除整组
            deleteGroup(contextMenu.groupIdx);
        } else if (contextMenu.dupIdx !== undefined) {
            // 删除单个相似项（标记为独特）
            markAsUnique(contextMenu.groupIdx, contextMenu.dupIdx);
        }
        closeContextMenu();
    };

    // 右键菜单 - 保留为独特
    const handleContextMarkUnique = () => {
        if (!contextMenu) return;
        if (contextMenu.type === 'dup' && contextMenu.dupIdx !== undefined) {
            markAsUnique(contextMenu.groupIdx, contextMenu.dupIdx);
        }
        closeContextMenu();
    };

    // 加载库
    useEffect(() => {
        try {
            const saved = localStorage.getItem(LIBRARY_STORAGE_KEY);
            if (saved) {
                const items: TextItem[] = JSON.parse(saved);
                dedupEngine.importLibrary(items);
                setState(s => ({ ...s, librarySize: dedupEngine.getLibrarySize() }));
            }
        } catch (e) {
            console.error('Failed to load library:', e);
        }
    }, []);

    // 保存库
    const saveLibrary = useCallback(() => {
        try {
            const items = dedupEngine.exportLibrary();
            localStorage.setItem(LIBRARY_STORAGE_KEY, JSON.stringify(items));
            setState(s => ({ ...s, librarySize: dedupEngine.getLibrarySize() }));
        } catch (e) {
            console.error('Failed to save library:', e);
        }
    }, []);

    // 解析输入 - 优先使用 HTML 解析（Google Sheets 粘贴时完美保留单元格边界）
    const parseInput = (text: string, html?: string): TextItem[] => {
        let parsed: ReturnType<typeof parseInputText> | null = null;
        if (html?.trim()) {
            parsed = parseInputFromHtml(html);
        }
        if (!parsed || parsed.length === 0) {
            parsed = parseInputText(text);
        }
        return parsed.map(item => ({
            id: uuidv4(),
            text: item.foreign,
            chineseText: item.chinese
        }));
    };

    // 执行查重
    const handleDedup = useCallback(() => {
        if (!state.inputText.trim()) {
            showToast('请先输入文案');
            return;
        }

        updateState({ isProcessing: true });

        setTimeout(() => {
            try {
                const items = parseInput(state.inputText, checkPasteHtml);
                // 清空 HTML 缓存
                setCheckPasteHtml('');

                if (items.length === 0) {
                    showToast('没有解析到有效文案');
                    updateState({ isProcessing: false });
                    return;
                }

                const result = dedupEngine.dedup(items, {
                    threshold: state.threshold,
                    checkLibrary: true
                });

                updateState({ result, isProcessing: false });
                const libSize = state.librarySize;
                showToast(`查重完成！${result.stats.processingTimeMs}ms 处理 ${items.length} 条，库中 ${libSize} 条`);
            } catch (e) {
                console.error('Dedup failed:', e);
                showToast('查重失败: ' + (e as Error).message);
                updateState({ isProcessing: false });
            }
        }, 10);
    }, [state.inputText, state.threshold, state.librarySize]);

    // 搜索库中相似文案（使用 MinHash 算法，更专业更准确）
    const handleSearch = useCallback(() => {
        if (!state.searchQuery.trim()) {
            showToast('请输入要搜索的文案');
            return;
        }

        updateState({ isProcessing: true });

        setTimeout(() => {
            try {
                // 优先使用 HTML 解析
                let parsed: ReturnType<typeof parseInputText> | null = null;
                if (searchPasteHtml.trim()) {
                    parsed = parseInputFromHtml(searchPasteHtml);
                }
                if (!parsed || parsed.length === 0) {
                    parsed = parseInputText(state.searchQuery);
                }
                // 清空 HTML 缓存
                setSearchPasteHtml('');

                // 过滤空的
                const validParsed = parsed.filter(item => item.foreign.length > 0);

                if (validParsed.length === 0) {
                    showToast('请输入要搜索的文案');
                    updateState({ isProcessing: false });
                    return;
                }

                // 使用 MinHash 引擎搜索库（合并中英文作为查询，确保中文也能匹配）
                const queries = validParsed.map(item =>
                    item.chinese ? `${item.foreign} ${item.chinese}` : item.foreign
                );
                const engineResults = dedupEngine.searchLibrary(queries, {
                    threshold: state.threshold,
                    maxResults: 50
                });

                // 转换为搜索组格式（保留用户输入的中文）
                const searchGroups: typeof state.searchGroups = engineResults.map((result, i) => ({
                    query: result.query,
                    queryChinese: validParsed[i]?.chinese,  // 用户输入的中文
                    matches: result.matches.map(m => ({
                        text: m.item.text,
                        chineseText: m.item.chineseText,
                        similarity: m.similarity,
                        source: 'library' as const,
                        category: (m.item as any).category
                    }))
                }));

                updateState({
                    searchGroups,
                    isProcessing: false,
                    selectedSearchItems: new Set()
                });

                const totalMatches = searchGroups.reduce((sum, g) => sum + g.matches.length, 0);
                showToast(`搜索 ${queries.length} 条，找到 ${totalMatches} 条相似文案（MinHash 算法）`);
            } catch (e) {
                console.error('Search failed:', e);
                showToast('搜索失败');
                updateState({ isProcessing: false });
            }
        }, 10);
    }, [state.searchQuery, state.threshold]);

    // ==================== 分类模式 ====================

    // 通用 TSV 解析（支持 Google Sheets 引号单元格、保留空行）
    const parseTsvTable = useCallback((raw: string): string[][] => {
        if (!raw) return [];
        const rows: string[][] = [];
        let i = 0;
        const len = raw.length;

        while (i < len) {
            const row: string[] = [];
            let cell = '';
            let inQuotes = false;

            while (i < len) {
                const ch = raw[i];
                if (inQuotes) {
                    if (ch === '"') {
                        if (i + 1 < len && raw[i + 1] === '"') {
                            cell += '"';
                            i += 2;
                            continue;
                        }
                        inQuotes = false;
                        i++;
                        continue;
                    }
                    cell += ch;
                    i++;
                    continue;
                }

                if (ch === '"') {
                    inQuotes = true;
                    i++;
                    continue;
                }
                if (ch === '\t') {
                    row.push(cell);
                    cell = '';
                    i++;
                    continue;
                }
                if (ch === '\n' || ch === '\r') {
                    row.push(cell);
                    if (ch === '\r' && i + 1 < len && raw[i + 1] === '\n') i += 2;
                    else i++;
                    break;
                }
                cell += ch;
                i++;
            }

            if (i >= len) row.push(cell);
            rows.push(row);
        }

        if (raw.endsWith('\n') || raw.endsWith('\r')) {
            rows.push(['']);
        }
        return rows;
    }, []);

    const detectTextLang = useCallback((text: string): 'zh' | 'en' | 'mixed' | 'unknown' => {
        if (!text.trim()) return 'unknown';
        const hasZh = /[\u4e00-\u9fff]/.test(text);
        const hasEn = /[A-Za-z]/.test(text);
        if (hasZh && hasEn) return 'mixed';
        if (hasZh) return 'zh';
        if (hasEn) return 'en';
        return 'unknown';
    }, []);

    const splitKeywordCell = useCallback((value: string): string[] => {
        return value.split(/[、\n\r]/).map(v => v.trim()).filter(Boolean);
    }, []);

    const looksKeywordCell = useCallback((value: string): boolean => {
        const v = value.trim();
        if (!v) return false;
        return /[、+\n\r]/.test(v) || v.length >= 10 || /\s/.test(v);
    }, []);

    // 解析分类规则：支持 1~4 列（主类/子类/中文关键词/英文关键词），兼容老的 2 列关键词→分类
    const parseClassifyRules = useCallback((text: string): Array<{
        keyword: string;
        category: string;
        mainCategory: string;
        subCategory: string;
        keywordLang: 'zh' | 'en' | 'mixed' | 'unknown';
    }> => {
        const table = parseTsvTable(text);
        if (table.length === 0) return [];

        const normalizeHeader = (v: string) => v.replace(/\s+/g, '').toLowerCase();
        const header = table[0].map(normalizeHeader);
        const headerIdx = {
            main: header.findIndex(h => ['主类别', '主分类', '大类', '一级', '一级分类', 'main', 'parent'].includes(h)),
            sub: header.findIndex(h => ['子类别', '子分类', '分类', '二级', '二级分类', 'sub', 'child', 'category'].includes(h)),
            zh: header.findIndex(h => ['中文关键词', '中文关键字', '中文', '关键词中文', 'zh关键词', 'cn关键词', 'zhkeyword', 'chinesekeyword'].includes(h)),
            en: header.findIndex(h => ['英文关键词', '英文关键字', '英文', '关键词英文', 'en关键词', 'enkeyword', 'englishkeyword'].includes(h)),
            keyword: header.findIndex(h => ['关键词', '关键字', 'keyword', 'keywords'].includes(h)),
        };
        const hasHeader = Object.values(headerIdx).some(idx => idx >= 0);

        const dataRows = hasHeader ? table.slice(1) : table;
        const rules: Array<{
            keyword: string;
            category: string;
            mainCategory: string;
            subCategory: string;
            keywordLang: 'zh' | 'en' | 'mixed' | 'unknown';
        }> = [];

        for (const rawRow of dataRows) {
            const row = rawRow.map(c => c.trim());
            if (row.every(c => !c)) continue;

            let mainCategory = '';
            let subCategory = '';
            let zhPart = '';
            let enPart = '';
            let mixedPart = '';

            if (hasHeader) {
                if (headerIdx.main >= 0) mainCategory = row[headerIdx.main] || '';
                if (headerIdx.sub >= 0) subCategory = row[headerIdx.sub] || '';
                if (headerIdx.zh >= 0) zhPart = row[headerIdx.zh] || '';
                if (headerIdx.en >= 0) enPart = row[headerIdx.en] || '';
                if (headerIdx.keyword >= 0 && !zhPart && !enPart) mixedPart = row[headerIdx.keyword] || '';
            } else {
                if (row.length >= 4) {
                    [mainCategory, subCategory, zhPart, enPart] = row;
                } else if (row.length === 3) {
                    const [c0, c1, c2] = row;
                    if (!looksKeywordCell(c0) && !looksKeywordCell(c1) && looksKeywordCell(c2)) {
                        mainCategory = c0;
                        subCategory = c1;
                        mixedPart = c2;
                    } else {
                        subCategory = c0;
                        zhPart = c1;
                        enPart = c2;
                    }
                } else if (row.length === 2) {
                    const [c0, c1] = row;
                    const firstIsKeyword = looksKeywordCell(c0);
                    const secondIsKeyword = looksKeywordCell(c1);
                    if (firstIsKeyword && !secondIsKeyword) {
                        mixedPart = c0;
                        subCategory = c1;
                    } else if (!firstIsKeyword && secondIsKeyword) {
                        subCategory = c0;
                        mixedPart = c1;
                    } else {
                        // 兼容旧格式：关键词在前，分类在后
                        mixedPart = c0;
                        subCategory = c1;
                    }
                } else {
                    mixedPart = row[0] || '';
                }
            }

            const finalCategory = subCategory || mainCategory || '其他';
            const pushRule = (kw: string, lang: 'zh' | 'en' | 'mixed' | 'unknown') => {
                const keyword = kw.trim();
                if (!keyword) return;
                rules.push({
                    keyword,
                    category: finalCategory,
                    mainCategory,
                    subCategory: subCategory || finalCategory,
                    keywordLang: lang,
                });
            };

            splitKeywordCell(zhPart).forEach(kw => pushRule(kw, 'zh'));
            splitKeywordCell(enPart).forEach(kw => pushRule(kw, 'en'));
            splitKeywordCell(mixedPart).forEach(kw => pushRule(kw, detectTextLang(kw)));
        }

        return rules;
    }, [parseTsvTable, splitKeywordCell, looksKeywordCell, detectTextLang]);

    // 解析待分类输入：支持 1~2 列（中文/英文），可自动识别中英文列
    const parseClassifyInputRows = useCallback((text: string): Array<{
        rowIndex: number;
        text: string;
        zhText: string;
        enText: string;
    }> => {
        const table = parseTsvTable(text);
        if (table.length === 0) return [];

        const normalizeHeader = (v: string) => v.replace(/\s+/g, '').toLowerCase();
        const firstRow = table[0].map(normalizeHeader);
        const hasInputHeader = firstRow.some(h => ['中文', '中文文案', 'zh', 'cn', '英文', '英文文案', 'en', 'english'].includes(h));

        const rows = (hasInputHeader ? table.slice(1) : table).map((rawRow, idx) => {
            const row = rawRow.map(c => c.trim());
            const c0 = row[0] || '';
            const c1 = row[1] || '';

            let zhText = '';
            let enText = '';

            if (row.length >= 2) {
                const l0 = detectTextLang(c0);
                const l1 = detectTextLang(c1);
                if (l0 === 'zh' && (l1 === 'en' || l1 === 'mixed' || l1 === 'unknown')) {
                    zhText = c0;
                    enText = c1;
                } else if (l1 === 'zh' && (l0 === 'en' || l0 === 'mixed' || l0 === 'unknown')) {
                    zhText = c1;
                    enText = c0;
                } else {
                    // 无法明确判断时，保留原顺序：第一列作为主显示，第二列作为补充
                    zhText = c0;
                    enText = c1;
                }
            } else {
                const lang = detectTextLang(c0);
                if (lang === 'en') enText = c0;
                else zhText = c0;
            }

            const textDisplay = zhText && enText ? `${zhText} ｜ ${enText}` : (zhText || enText);
            return { rowIndex: idx, text: textDisplay, zhText, enText };
        });

        return rows;
    }, [parseTsvTable, detectTextLang]);

    // 分类匹配归一化：忽略半角/全角空格、换行、Tab 等空白差异
    const normalizeForClassifyMatch = useCallback((value: string): string => {
        return value.replace(/[\s\u3000]+/g, '').toLowerCase();
    }, []);

    // 执行分类
    const handleClassify = useCallback(() => {
        const rules = parseClassifyRules(state.classifyRulesText);
        if (rules.length === 0) {
            showToast('\u8bf7\u5148\u8f93\u5165\u5206\u7c7b\u89c4\u5219\uff08\u5173\u952e\u8bcd + \u5206\u7c7b\u540d\uff09');
            return;
        }
        if (!state.classifyInputText.trim()) {
            showToast('\u8bf7\u5148\u7c98\u8d34\u5f85\u5206\u7c7b\u6587\u6848');
            return;
        }

        const inputRows = parseClassifyInputRows(state.classifyInputText);

        const results: typeof state.classifyResults = inputRows.map((row) => {
            const text = row.text.trim();
            if (!text) {
                // Empty cell -> preserve as empty row
                return {
                    rowIndex: row.rowIndex,
                    text: '',
                    zhText: '',
                    enText: '',
                    category: '',
                    mainCategory: '',
                    subCategory: '',
                    matchedKeyword: '',
                    matchedKeywordLang: '',
                };
            }

            const normalizedZh = normalizeForClassifyMatch(row.zhText);
            const normalizedEn = normalizeForClassifyMatch(row.enText);
            const normalizedText = normalizeForClassifyMatch(text);

            // First matching rule wins
            // keyword may contain + for AND logic: "a+b" means text must contain both "a" and "b"
            for (const rule of rules) {
                const parts = rule.keyword.split('+').map(p => p.trim()).filter(p => p);
                const matchTarget = rule.keywordLang === 'zh'
                    ? (normalizedZh || normalizedText)
                    : rule.keywordLang === 'en'
                        ? (normalizedEn || normalizedText)
                        : normalizedText;

                if (parts.length > 1) {
                    // AND: all parts must match
                    const normalizedParts = parts.map(p => normalizeForClassifyMatch(p)).filter(Boolean);
                    if (normalizedParts.length > 0 && normalizedParts.every(p => matchTarget.includes(p))) {
                        return {
                            rowIndex: row.rowIndex,
                            text,
                            zhText: row.zhText,
                            enText: row.enText,
                            category: rule.category,
                            mainCategory: rule.mainCategory,
                            subCategory: rule.subCategory || rule.category,
                            matchedKeyword: rule.keyword,
                            matchedKeywordLang: rule.keywordLang,
                        };
                    }
                } else {
                    // Single keyword (OR is handled by multiple rules)
                    const normalizedKeyword = normalizeForClassifyMatch(rule.keyword);
                    if (normalizedKeyword && matchTarget.includes(normalizedKeyword)) {
                        return {
                            rowIndex: row.rowIndex,
                            text,
                            zhText: row.zhText,
                            enText: row.enText,
                            category: rule.category,
                            mainCategory: rule.mainCategory,
                            subCategory: rule.subCategory || rule.category,
                            matchedKeyword: rule.keyword,
                            matchedKeywordLang: rule.keywordLang,
                        };
                    }
                }
            }

            // No match
            return {
                rowIndex: row.rowIndex,
                text,
                zhText: row.zhText,
                enText: row.enText,
                category: '\u5176\u4ed6',
                mainCategory: '',
                subCategory: '\u5176\u4ed6',
                matchedKeyword: '',
                matchedKeywordLang: '',
            };
        });

        updateState({
            classifyResults: results,
            classifyActiveCategories: new Set<string>(),
        });

        const nonEmpty = results.filter(r => r.text);
        const classified = nonEmpty.filter(r => r.category && r.category !== '\u5176\u4ed6');
        const cats = new Set(results.filter(r => r.category).map(r => r.category));
        showToast(`\u5206\u7c7b\u5b8c\u6210\uff01${nonEmpty.length} \u6761\u6587\u6848 \u2192 ${cats.size} \u4e2a\u5206\u7c7b\uff08${classified.length} \u6761\u5339\u914d\uff0c${nonEmpty.length - classified.length} \u6761\u5176\u4ed6\uff09`);
    }, [state.classifyRulesText, state.classifyInputText, parseClassifyRules, parseClassifyInputRows, normalizeForClassifyMatch]);

    // ==================== AI 语义分类模式 ====================

    // AI 分类: 粘贴处理 — 优先用 HTML 解析 Google Sheets 剪贴板
    // 这样单元格内部的换行、引号等内容不会导致拆行错误
    const handleAiClassifyPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const html = e.clipboardData.getData('text/html');
        if (!html) return; // 没有 HTML，走默认 text/plain

        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const table = doc.querySelector('table');
            if (!table) return; // 不是表格格式，走默认

            const trs = table.querySelectorAll('tr');
            if (trs.length === 0) return;

            // 提取单元格文本（保留内部换行，但不会被当作 TSV 行分隔符）
            const getCellText = (cell: Element): string => {
                const clone = cell.cloneNode(true) as HTMLElement;
                clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                clone.querySelectorAll('p').forEach((p, idx) => {
                    if (idx > 0) p.insertBefore(document.createTextNode('\n'), p.firstChild);
                });
                return (clone.textContent || '').trim();
            };

            // 将每个 <tr> 转换为 TSV 行
            // 单元格内部的换行符替换为 ⏎，避免被 parseTsvTable 当作行分隔
            // 但在发送给 AI 时会还原
            const tsvEscapeCell = (text: string): string => {
                // 如果单元格内容包含 Tab 或换行，用引号包裹（Google Sheets TSV 标准）
                if (text.includes('\t') || text.includes('\n') || text.includes('"')) {
                    return '"' + text.replace(/"/g, '""') + '"';
                }
                return text;
            };

            const rows: string[] = [];
            trs.forEach(tr => {
                const cells = tr.querySelectorAll('td, th');
                if (cells.length === 0) return;
                const cellTexts = Array.from(cells).map(c => tsvEscapeCell(getCellText(c)));
                rows.push(cellTexts.join('\t'));
            });

            if (rows.length > 0) {
                e.preventDefault(); // 阻止默认粘贴
                const tsvText = rows.join('\n');
                updateState({ aiClassifyInputText: state.aiClassifyInputText + tsvText });
                showToast(`已从表格粘贴 ${rows.length} 条文案`);
            }
        } catch {
            // 解析失败，走默认粘贴
        }
    }, [state.aiClassifyInputText]);

    const handleAiClassify = useCallback(async () => {
        if (!state.aiClassifyInputText.trim()) {
            showToast('请先粘贴待分类文案');
            return;
        }

        // 解析输入
        const inputRows = parseClassifyInputRows(state.aiClassifyInputText);
        const validRows = inputRows.filter(r => r.text.trim());
        if (validRows.length === 0) {
            showToast('没有解析到有效文案');
            return;
        }

        // 取消之前的请求
        aiClassifyAbortRef.current?.abort();
        const controller = new AbortController();
        aiClassifyAbortRef.current = controller;

        updateState({
            isProcessing: true,
            aiClassifyResults: [],
            aiClassifyStats: null,
            aiClassifyActiveCategories: new Set<string>(),
            aiClassifyProgress: { current: 0, total: 1, status: '准备中…' },
        });

        try {
            const totalInputRows = inputRows.length; // 含空行的总行数
            const items = validRows.map((r, i) => ({
                index: i + 1,
                originalRowIndex: r.rowIndex, // 保留原始行号，用于对齐复制
                text: r.text,
                zhText: r.zhText,
                enText: r.enText,
            }));

            // 将结构化规则转为文本
            const rulesText = state.aiClassifyCustomRules.length > 0
                ? state.aiClassifyCustomRules.map(r => {
                    const levelLabel = r.level === 'major' ? '大类' : r.level === 'middle' ? '中类' : '小类';
                    const parentHint = r.parentCategory ? ` → 归属「${r.parentCategory}」` : '';
                    return `${levelLabel}「${r.name}」${parentHint} | 判断标准：${r.criteria}`;
                }).join('\n')
                : undefined;

            const results = await classifyWithAI(items, {
                depth: state.aiClassifyDepth,
                batchSize: state.aiClassifyBatchSize,
                concurrency: 2,
                customRules: rulesText,
                systemPromptOverride: state.aiClassifySystemPromptEdit || undefined,
                model: classifyEffectiveModel,
                signal: controller.signal,
                onProgress: (progress) => {
                    updateState({ aiClassifyProgress: progress });
                },
                onBatchDone: (batchResults) => {
                    // 流式：每批完成立即追加到结果表
                    setState(prev => {
                        const merged = [...prev.aiClassifyResults, ...batchResults];
                        return { ...prev, aiClassifyResults: merged, aiClassifyStats: computeClassifyStats(merged) };
                    });
                },
            });

            const stats = computeClassifyStats(results);
            updateState({
                aiClassifyResults: results,
                aiClassifyStats: stats,
                aiClassifyActiveCategories: new Set<string>(),
                isProcessing: false,
                aiClassifyProgress: null,
            });
            const failCount = results.filter(r => r.major === '❌ 失败').length;
            if (failCount > 0) {
                showToast(`分类完成（${results.length - failCount} 成功，${failCount} 失败 — 可点击"重试失败"）`);
            } else {
                showToast(`AI 分类完成！${results.length} 条文案 → ${Object.keys(stats.majorCounts).length} 个大类`);
            }
        } catch (error: any) {
            if (controller.signal.aborted) {
                // 用户主动停止
                const currentResults = state.aiClassifyResults;
                updateState({
                    isProcessing: false,
                    aiClassifyProgress: null,
                    aiClassifyStats: currentResults.length > 0 ? computeClassifyStats(currentResults) : null,
                });
                showToast(`已停止 · ${currentResults.length} 条已分类`);
                return;
            }
            console.error('AI classify failed:', error);
            showToast('AI 分类失败: ' + (error?.message || '未知错误'));
            updateState({ isProcessing: false, aiClassifyProgress: null });
        }
    }, [state.aiClassifyInputText, state.aiClassifyDepth, state.aiClassifyBatchSize, state.aiClassifyCustomRules, parseClassifyInputRows]);

    // AI 分类: 停止
    const handleAiClassifyStop = useCallback(() => {
        aiClassifyAbortRef.current?.abort();
        aiClassifyAbortRef.current = null;
    }, []);

    // AI 分类: 重试失败项
    const handleAiClassifyRetryFailed = useCallback(async () => {
        const failedItems = state.aiClassifyResults.filter(r => r.major === '❌ 失败');
        if (failedItems.length === 0) {
            showToast('没有失败的项目');
            return;
        }

        const controller = new AbortController();
        aiClassifyAbortRef.current = controller;

        updateState({
            isProcessing: true,
            aiClassifyProgress: { current: 0, total: 1, status: `重试 ${failedItems.length} 条失败项…` },
        });

        try {
            const rulesText = state.aiClassifyCustomRules.length > 0
                ? state.aiClassifyCustomRules.map(r => {
                    const levelLabel = r.level === 'major' ? '大类' : r.level === 'middle' ? '中类' : '小类';
                    const parentHint = r.parentCategory ? ` → 归属「${r.parentCategory}」` : '';
                    return `${levelLabel}「${r.name}」${parentHint} | 判断标准：${r.criteria}`;
                }).join('\n')
                : undefined;

            const retryResults = await classifyWithAI(failedItems, {
                depth: state.aiClassifyDepth,
                batchSize: Math.min(state.aiClassifyBatchSize, failedItems.length),
                concurrency: 1, // 重试用较低并发
                customRules: rulesText,
                systemPromptOverride: state.aiClassifySystemPromptEdit || undefined,
                signal: controller.signal,
                onProgress: (progress) => {
                    updateState({ aiClassifyProgress: progress });
                },
                onBatchDone: (batchResults) => {
                    // 替换已有的失败项
                    setState(prev => {
                        const successIndexes = new Set(batchResults.filter(r => r.major !== '❌ 失败').map(r => r.index));
                        const updated = prev.aiClassifyResults.map((existing: AiClassifyResult) => {
                            if (successIndexes.has(existing.index)) {
                                return batchResults.find(r => r.index === existing.index) || existing;
                            }
                            return existing;
                        });
                        return { ...prev, aiClassifyResults: updated, aiClassifyStats: computeClassifyStats(updated) };
                    });
                },
            });

            // 最终合并
            setState(prev => {
                const retryMap = new Map(retryResults.map(r => [r.index, r]));
                const merged = prev.aiClassifyResults.map((existing: AiClassifyResult) =>
                    retryMap.has(existing.index) ? retryMap.get(existing.index)! : existing
                );
                const stats = computeClassifyStats(merged);
                return { ...prev, aiClassifyResults: merged, aiClassifyStats: stats, isProcessing: false, aiClassifyProgress: null };
            });

            const stillFailed = retryResults.filter(r => r.major === '❌ 失败').length;
            showToast(stillFailed > 0
                ? `重试完成（${failedItems.length - stillFailed} 成功，${stillFailed} 仍失败）`
                : `重试完成！全部 ${failedItems.length} 条已成功分类`
            );
        } catch (error: any) {
            updateState({ isProcessing: false, aiClassifyProgress: null });
            showToast('重试失败: ' + (error?.message || '未知错误'));
        }
    }, [state.aiClassifyResults, state.aiClassifyDepth, state.aiClassifyBatchSize, state.aiClassifyCustomRules]);

    // AI 分类: 获取筛选后的结果
    const getFilteredAiResults = useCallback(() => {
        let results = state.aiClassifyResults;
        if (state.aiClassifyActiveCategories.size > 0) {
            results = results.filter(r => state.aiClassifyActiveCategories.has(r.major));
        }
        if (state.aiClassifySortBy === 'major') {
            results = [...results].sort((a, b) => {
                if (a.major !== b.major) return a.major.localeCompare(b.major);
                return a.index - b.index;
            });
        } else if (state.aiClassifySortBy === 'middle') {
            results = [...results].sort((a, b) => {
                if (a.middle !== b.middle) return a.middle.localeCompare(b.middle);
                if (a.major !== b.major) return a.major.localeCompare(b.major);
                return a.index - b.index;
            });
        } else if (state.aiClassifySortBy === 'minor') {
            results = [...results].sort((a, b) => {
                if (a.minor !== b.minor) return a.minor.localeCompare(b.minor);
                if (a.middle !== b.middle) return a.middle.localeCompare(b.middle);
                if (a.major !== b.major) return a.major.localeCompare(b.major);
                return a.index - b.index;
            });
        } else if (state.aiClassifySortBy === 'chars-asc') {
            results = [...results].sort((a, b) => a.text.length - b.text.length);
        } else if (state.aiClassifySortBy === 'chars-desc') {
            results = [...results].sort((a, b) => b.text.length - a.text.length);
        }
        return results;
    }, [state.aiClassifyResults, state.aiClassifyActiveCategories, state.aiClassifySortBy]);

    // AI 分类: 复制全部原始 (TSV) — 不受筛选排序影响，按原始输入顺序导出并保留空行
    const copyAiClassifyAllTSV = useCallback(() => {
        if (state.aiClassifyResults.length === 0) return;
        const esc = (t: string) => {
            if (!t) return '';
            if (t.includes('\t') || t.includes('\n') || t.includes('"')) return `"${t.replace(/"/g, '""')}"`;
            return t;
        };
        const header = '文案\t大类\t中类\t小类';
        const inputRows = parseClassifyInputRows(state.aiClassifyInputText);

        const rows: string[] = [];
        if (inputRows.length > 0) {
            // 按原始输入行导出：有结果写结果，空行保留空，未完成行保留文案+空分类
            const resultMap = new Map<number, typeof state.aiClassifyResults[0]>();
            const nonEmptyRowIndexes = inputRows
                .filter(row => (row.text || '').trim())
                .map(row => row.rowIndex);
            let fallbackPtr = 0;
            for (const r of [...state.aiClassifyResults].sort((a, b) => a.index - b.index)) {
                const originalRowIndex = (r as any).originalRowIndex;
                if (typeof originalRowIndex === 'number') {
                    resultMap.set(originalRowIndex, r);
                    continue;
                }
                while (fallbackPtr < nonEmptyRowIndexes.length && resultMap.has(nonEmptyRowIndexes[fallbackPtr])) {
                    fallbackPtr++;
                }
                if (fallbackPtr < nonEmptyRowIndexes.length) {
                    resultMap.set(nonEmptyRowIndexes[fallbackPtr], r);
                    fallbackPtr++;
                }
            }
            for (const row of inputRows) {
                const r = resultMap.get(row.rowIndex);
                if (r) {
                    rows.push(`${esc(r.text)}\t${esc(r.major)}\t${esc(r.middle)}\t${esc(r.minor)}`);
                } else if ((row.text || '').trim()) {
                    rows.push(`${esc(row.text)}\t\t\t`);
                } else {
                    rows.push('\t\t\t');
                }
            }
        } else {
            // 兜底：无输入文本时仍按结果序号导出
            const sorted = [...state.aiClassifyResults].sort((a, b) => a.index - b.index);
            for (const r of sorted) {
                rows.push(`${esc(r.text)}\t${esc(r.major)}\t${esc(r.middle)}\t${esc(r.minor)}`);
            }
        }

        navigator.clipboard.writeText([header, ...rows].join('\n'));
        showToast(`已复制全部 ${rows.length} 行（含空行，原始顺序）`);
    }, [state.aiClassifyResults, state.aiClassifyInputText, parseClassifyInputRows]);

    // AI 分类: 复制当前视图 (TSV) — 受筛选+排序影响
    const copyAiClassifyCurrentView = useCallback(() => {
        const results = getFilteredAiResults();
        if (results.length === 0) return;
        const esc = (t: string) => {
            if (!t) return '';
            if (t.includes('\t') || t.includes('\n') || t.includes('"')) return `"${t.replace(/"/g, '""')}"`;
            return t;
        };
        const header = '文案\t大类\t中类\t小类';
        const rows = results.map(r =>
            `${esc(r.text)}\t${esc(r.major)}\t${esc(r.middle)}\t${esc(r.minor)}`
        );
        navigator.clipboard.writeText([header, ...rows].join('\n'));
        const isFiltered = state.aiClassifyActiveCategories.size > 0;
        const isSorted = state.aiClassifySortBy !== 'original';
        const hint = isFiltered ? '（已筛选）' : isSorted ? '（已排序）' : '';
        showToast(`已复制 ${rows.length} 条${hint}`);
    }, [getFilteredAiResults, state.aiClassifyActiveCategories, state.aiClassifySortBy]);

    // AI 分类: 仅复制分类列 — 受筛选+排序影响
    const copyAiClassifyColumnsOnly = useCallback(() => {
        const results = getFilteredAiResults();
        if (results.length === 0) return;
        const header = '大类\t中类\t小类';
        const rows = results.map(r =>
            `${r.major}\t${r.middle}\t${r.minor}`
        );
        navigator.clipboard.writeText([header, ...rows].join('\n'));
        showToast(`已复制分类列 ${rows.length} 条`);
    }, [getFilteredAiResults]);

    // AI 分类: 粘贴解析结果（供预览表和输入区共用）
    const aiClassifyParsedItems = React.useMemo(() => {
        if (!state.aiClassifyInputText.trim()) return [];
        return parseClassifyInputRows(state.aiClassifyInputText).filter(r => r.text.trim());
    }, [state.aiClassifyInputText]);

    // 复制分类结果（保持原始行对齐，空行=空行）
    const copyClassifyResults = useCallback(() => {
        if (state.classifyResults.length === 0) {
            showToast('\u8bf7\u5148\u6267\u884c\u5206\u7c7b');
            return;
        }
        const hasFilter = state.classifyActiveCategories.size > 0;
        // 即使筛选，也保留原始行对齐：未选中分类输出空单元格
        const lines = state.classifyResults.map(r => {
            if (!r.text) return '';
            if (!hasFilter) return r.subCategory || r.category;
            return state.classifyActiveCategories.has(r.category) ? (r.subCategory || r.category) : '';
        });
        navigator.clipboard.writeText(lines.join('\n')).then(() => {
            const nonEmpty = lines.filter(v => v !== '').length;
            showToast(`\u5df2\u590d\u5236 ${nonEmpty} \u6761\u5206\u7c7b${hasFilter ? '\uff08\u5df2\u7b5b\u9009\uff09' : '\uff08\u5168\u90e8\uff09'}`);
        });
    }, [state.classifyResults, state.classifyActiveCategories]);

    // 复制分类结果带文案（原始顺序）
    const copyClassifyResultsFull = useCallback(() => {
        if (state.classifyResults.length === 0) {
            showToast('\u8bf7\u5148\u6267\u884c\u5206\u7c7b');
            return;
        }
        const escapeForSheet = (text: string): string => {
            if (!text) return '';
            if (text.includes('\t') || text.includes('\n') || text.includes('"')) {
                return `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        };
        const hasFilter = state.classifyActiveCategories.size > 0;
        // 原始顺序复制：始终保留行对齐；筛选时未命中行置空
        const lines = state.classifyResults.map(r => {
            if (!r.text) return '\t\t\t\t\t';
            if (hasFilter && !state.classifyActiveCategories.has(r.category)) return '\t\t\t\t\t';
            const zh = r.zhText || '';
            const en = r.enText || '';
            const main = r.mainCategory || '';
            const sub = r.subCategory || r.category || '';
            return `${escapeForSheet(zh)}\t${escapeForSheet(en)}\t${escapeForSheet(main)}\t${escapeForSheet(sub)}\t${r.matchedKeyword}\t${r.matchedKeywordLang || ''}`;
        });
        navigator.clipboard.writeText(lines.join('\n')).then(() => {
            const nonEmpty = lines.filter(v => v !== '\t\t\t\t\t').length;
            showToast(`\u5df2\u590d\u5236 ${nonEmpty} \u6761\uff08\u539f\u59cb\u987a\u5e8f${hasFilter ? '\uff0c\u5df2\u7b5b\u9009' : ''}\uff09`);
        });
    }, [state.classifyResults, state.classifyActiveCategories]);

    // 复制排序后的分类结果（按分类名排序）
    const copyClassifyResultsSorted = useCallback(() => {
        if (state.classifyResults.length === 0) {
            showToast('\u8bf7\u5148\u6267\u884c\u5206\u7c7b');
            return;
        }
        const escapeForSheet = (text: string): string => {
            if (!text) return '';
            if (text.includes('\t') || text.includes('\n') || text.includes('"')) {
                return `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        };
        const hasFilter = state.classifyActiveCategories.size > 0;
        const sorted = [...state.classifyResults]
            .filter(r => r.text && (hasFilter ? state.classifyActiveCategories.has(r.category) : true))
            .sort((a, b) => {
                if (a.category !== b.category) return a.category.localeCompare(b.category);
                return a.rowIndex - b.rowIndex;
            });
        const lines = sorted.map(r =>
            `${escapeForSheet(r.zhText || '')}\t${escapeForSheet(r.enText || '')}\t${escapeForSheet(r.mainCategory || '')}\t${escapeForSheet(r.subCategory || r.category || '')}\t${r.matchedKeyword}\t${r.matchedKeywordLang || ''}`
        );
        navigator.clipboard.writeText(lines.join('\n')).then(() => {
            showToast(`\u5df2\u590d\u5236 ${sorted.length} \u6761\uff08\u6309\u5206\u7c7b\u6392\u5e8f${hasFilter ? '\uff0c\u5df2\u7b5b\u9009' : ''}\uff09`);
        });
    }, [state.classifyResults, state.classifyActiveCategories]);

    // 高亮关键词（支持 + 连接的 AND 关键词，高亮所有匹配部分）
    const highlightKeywordInText = useCallback((text: string, keyword: string): React.ReactNode => {
        if (!keyword || !text) return text;
        // Split by + for AND keywords
        const parts = keyword.split('+').map(p => p.trim()).filter(p => p);
        if (parts.length === 0) return text;

        // Collect all match ranges
        const ranges: Array<[number, number]> = [];
        const lower = text.toLowerCase();
        for (const part of parts) {
            const idx = lower.indexOf(part.toLowerCase());
            if (idx >= 0) {
                ranges.push([idx, idx + part.length]);
            }
        }
        if (ranges.length === 0) return text;

        // Sort ranges by start position and merge overlapping
        ranges.sort((a, b) => a[0] - b[0]);
        const merged: Array<[number, number]> = [ranges[0]];
        for (let i = 1; i < ranges.length; i++) {
            const last = merged[merged.length - 1];
            if (ranges[i][0] <= last[1]) {
                last[1] = Math.max(last[1], ranges[i][1]);
            } else {
                merged.push(ranges[i]);
            }
        }

        // Build React nodes
        const nodes: React.ReactNode[] = [];
        let pos = 0;
        for (const [start, end] of merged) {
            if (pos < start) nodes.push(text.substring(pos, start));
            nodes.push(
                <span key={start} style={{ background: 'rgba(250, 204, 21, 0.25)', color: '#fde68a', borderRadius: '2px', padding: '0 2px' }}>
                    {text.substring(start, end)}
                </span>
            );
            pos = end;
        }
        if (pos < text.length) nodes.push(text.substring(pos));
        return <>{nodes}</>;
    }, []);

    // 右键菜单：选中文字设为关键词
    const handleClassifyContextMenu = useCallback((e: React.MouseEvent) => {
        const sel = window.getSelection();
        const selectedText = sel?.toString().trim();
        if (!selectedText) return; // no selection → use default menu
        e.preventDefault();
        updateState({
            classifyContextMenu: { x: e.clientX, y: e.clientY, selectedText },
            classifyNewCategoryInput: '',
        });
    }, []);

    // 关闭右键菜单
    const closeClassifyContextMenu = useCallback(() => {
        updateState({ classifyContextMenu: null, classifyNewCategoryInput: '' });
    }, []);

    // 添加关键词到分类（修改规则文本）
    const addKeywordToCategory = useCallback((keyword: string, category: string) => {
        if (!keyword || !category) return;
        // Check if this keyword already exists for this category
        const rules = parseClassifyRules(state.classifyRulesText);
        const exists = rules.some(r => r.keyword.toLowerCase() === keyword.toLowerCase() && r.category === category);
        if (exists) {
            showToast(`关键词「${keyword}」已在分类「${category}」中`);
            closeClassifyContextMenu();
            return;
        }
        // Append new rule line
        const newLine = `${keyword}\t${category}`;
        const newText = state.classifyRulesText.trim()
            ? state.classifyRulesText.trimEnd() + '\n' + newLine
            : newLine;
        updateState({ classifyRulesText: newText, classifyContextMenu: null, classifyNewCategoryInput: '' });
        showToast(`已添加关键词「${keyword}」→「${category}」`);
    }, [state.classifyRulesText, parseClassifyRules, closeClassifyContextMenu]);

    // 删除单条分类（移除该分类下所有关键词）
    const removeClassifyCategory = useCallback((category: string) => {
        // 多列高级规则不做自动重写，避免丢失主/子类及中英文关键词列结构
        const table = parseTsvTable(state.classifyRulesText);
        const normalizeHeader = (v: string) => v.replace(/\s+/g, '').toLowerCase();
        const firstRow = table[0]?.map(normalizeHeader) || [];
        const hasAdvancedHeader = firstRow.some(h => ['主类别', '主分类', '子类别', '子分类', '中文关键词', '英文关键词'].includes(h));
        const hasWideRows = table.some(row => row.filter(c => c.trim()).length > 2);
        if (hasAdvancedHeader || hasWideRows) {
            showToast('多列规则请直接在表格中编辑；当前删除按钮仅用于旧版两列表');
            return;
        }

        const rules = parseClassifyRules(state.classifyRulesText);
        const remaining = rules.filter(r => r.category !== category);
        if (remaining.length === 0) {
            updateState({ classifyRulesText: '' });
        } else {
            // Group by category and rebuild
            const catMap = new Map<string, string[]>();
            remaining.forEach(r => {
                const arr = catMap.get(r.category) || [];
                arr.push(r.keyword);
                catMap.set(r.category, arr);
            });
            const newText = [...catMap.entries()]
                .map(([cat, kws]) => kws.map(kw => `${kw}\t${cat}`).join('\n'))
                .join('\n');
            updateState({ classifyRulesText: newText });
        }
        showToast(`已删除分类「${category}」`);
    }, [state.classifyRulesText, parseClassifyRules, parseTsvTable]);

    // 切换选中搜索结果
    const toggleSearchItem = useCallback((key: string) => {
        const newSet = new Set(state.selectedSearchItems);
        if (newSet.has(key)) {
            newSet.delete(key);
        } else {
            newSet.add(key);
        }
        updateState({ selectedSearchItems: newSet });
    }, [state.selectedSearchItems]);

    // 复制选中的搜索结果（可粘贴到表格）
    const copySelectedSearchItems = useCallback(() => {
        // 转义函数，确保可以粘贴到 Google Sheets
        const escapeForSheet = (text: string): string => {
            if (!text) return '';
            // 如果包含 Tab、换行或引号，用引号包围并转义内部引号
            if (text.includes('\t') || text.includes('\n') || text.includes('"')) {
                return `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        };

        const selectedTexts: string[] = [];
        state.searchGroups.forEach((group, gi) => {
            group.matches.forEach((match, mi) => {
                if (state.selectedSearchItems.has(`${gi}-${mi}`)) {
                    selectedTexts.push(`${escapeForSheet(match.text)}\t${escapeForSheet(match.chineseText || '')}`);
                }
            });
        });

        if (selectedTexts.length === 0) {
            showToast('请先选择要复制的文案');
            return;
        }

        navigator.clipboard.writeText(selectedTexts.join('\n'));
        showToast(`已复制 ${selectedTexts.length} 条文案（可粘贴到表格）`);
    }, [state.searchGroups, state.selectedSearchItems]);

    // 添加到库
    const handleAddToLibrary = useCallback(() => {
        if (!state.result) return;

        const itemsToAdd = [
            ...state.result.uniqueItems,
            ...state.result.duplicateGroups.map(g => g.representative)
        ];

        if (itemsToAdd.length === 0) {
            showToast('没有可添加的文案');
            return;
        }

        dedupEngine.addToLibrary(itemsToAdd);
        saveLibrary();
        showToast(`已添加 ${itemsToAdd.length} 条到库中`);
    }, [state.result, saveLibrary]);

    // 清空库
    const handleClearLibrary = useCallback(() => {
        if (!confirm('确定要清空文案库吗？')) return;
        dedupEngine.clearLibrary();
        saveLibrary();
        showToast('已清空文案库');
    }, [saveLibrary]);

    // 查看库中所有相似文案
    const viewSimilarInLibrary = useCallback((queryText: string) => {
        const results = dedupEngine.searchLibrary([queryText], {
            threshold: state.threshold,
            maxResults: 100
        });

        if (results.length > 0 && results[0].matches.length > 0) {
            setSimilarModal({
                queryText,
                matches: results[0].matches.map(m => ({
                    text: m.item.text,
                    chineseText: m.item.chineseText,
                    similarity: m.similarity
                })),
                selected: new Set()
            });
        } else {
            showToast('未找到更多相似文案');
        }
    }, [state.threshold]);

    // 导出表格
    const exportAsTable = useCallback(() => {
        if (!state.result) return;

        const escapeForSheet = (text: string): string => {
            if (!text) return '';
            if (text.includes('\t') || text.includes('\n') || text.includes('"')) {
                return `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        };

        // 格式: 保留英文\t保留中文\t相似1英文\t相似1中文\t...
        const lines: string[] = [];

        // 计算最大相似数量（用于表头）
        let maxSimilarCount = 0;
        for (const group of state.result.duplicateGroups) {
            maxSimilarCount = Math.max(maxSimilarCount, group.duplicates.length);
        }

        // 表头
        const header: string[] = ['保留英文', '保留中文'];
        for (let i = 1; i <= maxSimilarCount; i++) {
            header.push(`相似${i}英文`, `相似${i}中文`);
        }
        lines.push(header.join('\t'));

        // 独特文案（无相似的）
        for (const item of state.result.uniqueItems) {
            lines.push(`${escapeForSheet(item.text)}\t${escapeForSheet(item.chineseText || '')}`);
        }

        // 重复组（保留的 + 其相似文案在同一行不同列）
        for (const group of state.result.duplicateGroups) {
            const row: string[] = [
                escapeForSheet(group.representative.text),
                escapeForSheet(group.representative.chineseText || '')
            ];
            for (const dup of group.duplicates) {
                row.push(escapeForSheet(dup.item.text));
                row.push(escapeForSheet(dup.item.chineseText || ''));
            }
            lines.push(row.join('\t'));
        }

        navigator.clipboard.writeText(lines.join('\n')).then(() => {
            showToast(`已复制 ${lines.length - 1} 条文案（含相似文案列）`);
        });
    }, [state.result]);

    // 只导出独特
    const exportUniqueOnly = useCallback(() => {
        if (!state.result) return;

        const escapeForSheet = (text: string): string => {
            if (!text) return '';
            if (text.includes('\t') || text.includes('\n') || text.includes('"')) {
                return `"${text.replace(/"/g, '""')}"`;
            }
            return text;
        };

        const lines: string[] = ['英文\t中文'];

        for (const item of state.result.uniqueItems) {
            lines.push(`${escapeForSheet(item.text)}\t${escapeForSheet(item.chineseText || '')}`);
        }

        for (const group of state.result.duplicateGroups) {
            lines.push(`${escapeForSheet(group.representative.text)}\t${escapeForSheet(group.representative.chineseText || '')}`);
        }

        navigator.clipboard.writeText(lines.join('\n')).then(() => {
            showToast(`已复制 ${lines.length - 1} 条独特文案`);
        });
    }, [state.result]);

    // 删除组
    const deleteGroup = useCallback((groupIndex: number) => {
        if (!state.result) return;
        const newGroups = [...state.result.duplicateGroups];
        newGroups.splice(groupIndex, 1);
        updateState({
            result: {
                ...state.result,
                duplicateGroups: newGroups
            }
        });
    }, [state.result]);

    // 换选代表
    const swapRepresentative = useCallback((groupIndex: number, dupIndex: number) => {
        if (!state.result) return;
        const newGroups = [...state.result.duplicateGroups];
        const group = { ...newGroups[groupIndex] };
        const oldRep = group.representative;
        const newRep = group.duplicates[dupIndex].item;

        group.representative = newRep;
        group.duplicates = [
            ...group.duplicates.slice(0, dupIndex),
            { item: oldRep, similarity: group.duplicates[dupIndex].similarity },
            ...group.duplicates.slice(dupIndex + 1)
        ];

        newGroups[groupIndex] = group;
        updateState({
            result: {
                ...state.result,
                duplicateGroups: newGroups
            }
        });
    }, [state.result]);

    // 标记为不重复（将相似项移到独特列表）
    const markAsUnique = useCallback((groupIndex: number, dupIndex: number) => {
        if (!state.result) return;

        const newGroups = [...state.result.duplicateGroups];
        const group = { ...newGroups[groupIndex] };
        const itemToMove = group.duplicates[dupIndex].item;

        // 从重复组中移除
        group.duplicates = group.duplicates.filter((_, i) => i !== dupIndex);

        // 如果组中只剩代表，也把代表移到独特列表，删除整组
        let newUniqueItems = [...state.result.uniqueItems];

        if (group.duplicates.length === 0) {
            // 组变空了，把代表也移到独特
            newUniqueItems.push(group.representative);
            newGroups.splice(groupIndex, 1);
        } else {
            newGroups[groupIndex] = group;
        }

        // 将移出的项添加到独特列表
        newUniqueItems.push(itemToMove);

        updateState({
            result: {
                ...state.result,
                uniqueItems: newUniqueItems,
                duplicateGroups: newGroups,
                stats: {
                    ...state.result.stats,
                    uniqueCount: newUniqueItems.length
                }
            }
        });

        showToast('已标记为不重复');

        // 记录手动标记
        const newMarked = new Set(state.manuallyMarkedUnique);
        newMarked.add(itemToMove.id);
        updateState({ manuallyMarkedUnique: newMarked });
    }, [state.result, state.manuallyMarkedUnique]);

    // 手动标记为重复（将两个独特项合并为一组）
    const markAsDuplicate = useCallback((itemIndex: number) => {
        if (!state.result) return;

        const item = state.result.uniqueItems[itemIndex];

        if (state.selectedForMerge === null) {
            // 第一次点击，选中第一个
            updateState({ selectedForMerge: item.id });
            showToast('已选中，请点击另一个文案标记为重复');
        } else if (state.selectedForMerge === item.id) {
            // 取消选中
            updateState({ selectedForMerge: null });
        } else {
            // 第二次点击，合并为重复组
            const firstItem = state.result.uniqueItems.find(i => i.id === state.selectedForMerge);
            if (!firstItem) return;

            // 创建新的重复组
            const newGroup: DuplicateGroup = {
                representative: firstItem,
                duplicates: [{ item, similarity: 1.0 }]  // 手动标记为 100%
            };

            // 从独特列表中移除这两个
            const newUniqueItems = state.result.uniqueItems.filter(
                i => i.id !== state.selectedForMerge && i.id !== item.id
            );

            updateState({
                result: {
                    ...state.result,
                    uniqueItems: newUniqueItems,
                    duplicateGroups: [...state.result.duplicateGroups, newGroup],
                    stats: {
                        ...state.result.stats,
                        uniqueCount: newUniqueItems.length
                    }
                },
                selectedForMerge: null
            });

            showToast('已标记为重复');
        }
    }, [state.result, state.selectedForMerge]);

    // ==================== Sheets 相关 ====================

    // 加载保存的 Sheet 配置（从 Firebase 或 localStorage）
    useEffect(() => {
        const loadSheetConfig = async () => {
            let config: { sheetUrl?: string; authMode?: AuthMode; gasWebAppUrl?: string } | null = null;

            // 优先从 Firebase 加载（需要登录）
            if (user?.uid) {
                try {
                    const docRef = doc(db, 'copydedup_config', user.uid);
                    const docSnap = await getDoc(docRef);
                    if (docSnap.exists()) {
                        config = docSnap.data() as { sheetUrl?: string; authMode?: AuthMode; gasWebAppUrl?: string };
                    }
                } catch (e) {
                    console.error('从 Firebase 加载配置失败:', e);
                }
            }

            // 如果 Firebase 没有，从 localStorage 加载
            if (!config) {
                const saved = localStorage.getItem(SHEET_CONFIG_KEY);
                if (saved) {
                    try {
                        config = JSON.parse(saved);
                    } catch (e) {
                        console.error('解析本地配置失败:', e);
                    }
                }
            }

            // 如果有配置，恢复设置但不自动连接（避免加载大量数据导致卡顿）
            if (config?.sheetUrl || config?.gasWebAppUrl) {
                updateState({
                    sheetUrl: config.sheetUrl || '',
                    authMode: config.authMode || 'apiKey',
                    gasWebAppUrl: config.gasWebAppUrl || ''
                });
            }
        };

        loadSheetConfig();
    }, [user?.uid]);

    // 连接到 Sheet
    const connectToSheet = async (url: string) => {
        // GAS 模式不需要 spreadsheetId
        if (state.authMode === 'gas') {
            if (!state.gasWebAppUrl.trim()) {
                updateState({ sheetError: '请输入 GAS Web App URL' });
                return;
            }
        } else {
            const spreadsheetId = extractSpreadsheetId(url);
            if (!spreadsheetId) {
                updateState({ sheetError: '无效的表格链接' });
                return;
            }
        }

        updateState({ isLoadingSheet: true, sheetError: null });

        try {
            // 创建服务时传入认证模式和 GAS URL
            const spreadsheetId = state.authMode === 'gas' ? 'gas' : extractSpreadsheetId(url) || '';
            const service = new SheetLibraryService(spreadsheetId, state.authMode, state.gasWebAppUrl);
            setSheetLibraryService(service);

            // 检查连接
            await service.checkConnection();

            // 加载分类
            const categories = await service.loadCategories();

            // 加载全部文案用于查重
            const allItems = await service.loadAllCategories();
            if (allItems.length > 0) {
            }

            // 保存配置到 localStorage
            const configData = {
                sheetUrl: url,
                authMode: state.authMode,
                gasWebAppUrl: state.gasWebAppUrl
            };
            localStorage.setItem(SHEET_CONFIG_KEY, JSON.stringify(configData));

            // 同时保存到 Firebase（如果已登录）
            if (user?.uid) {
                try {
                    await setDoc(doc(db, 'copydedup_config', user.uid), configData);
                } catch (e) {
                    console.error('保存配置到 Firebase 失败:', e);
                }
            }

            const primaryCount = getPrimaryCount(allItems);
            updateState({
                isSheetConnected: true,
                isLoadingSheet: false,
                categories,
                sheetLibraryItems: allItems,
                librarySize: primaryCount
            });

            // 同步到查重引擎
            dedupEngine.clearLibrary();
            dedupEngine.addToLibrary(allItems.map(item => ({
                id: item.id,
                text: item.text,
                chineseText: item.chineseText
            })));

            const engineSize = dedupEngine.getLibrarySize();
            showToast(`已连接！${categories.length} 个分类，引擎 ${engineSize} 条`);
        } catch (e) {
            console.error('连接失败:', e);
            updateState({
                isLoadingSheet: false,
                sheetError: (e as Error).message
            });
        }
    };

    // 断开连接（保留链接，方便重连）
    const disconnectSheet = () => {
        // 不删除 localStorage，保留链接
        updateState({
            isSheetConnected: false,
            categories: [],
            selectedCategory: null,
            sheetLibraryItems: [],
            librarySize: 0
        });
        dedupEngine.clearLibrary();
        showToast('已断开连接');
    };

    // 创建新分类
    const handleCreateCategory = () => {
        setEditCategoryModal({ oldName: '', newName: '', type: 'create' });
    };

    // 重命名分类
    const handleRenameCategory = (oldName: string) => {
        setEditCategoryModal({ oldName, newName: oldName, type: 'rename' });
    };

    // 执行创建/重命名分类
    const [isSubmitting, setIsSubmitting] = useState(false);

    const confirmEditCategory = async () => {
        if (!editCategoryModal || isSubmitting) return;
        const { oldName, newName, type } = editCategoryModal;
        if (!newName.trim()) {
            showToast('名称不能为空');
            return;
        }

        // 检查重复分类名
        if (type === 'create' && state.categories.includes(newName.trim())) {
            showToast(`分类 "${newName.trim()}" 已存在`);
            return;
        }

        const service = getSheetLibraryService();
        if (!service) {
            showToast('未连接表格');
            return;
        }

        setIsSubmitting(true);
        showToast(type === 'create' ? '创建中...' : '重命名中...');

        try {
            if (type === 'create') {
                await service.createCategory(newName.trim());
                updateState({
                    categories: [...state.categories, newName.trim()]
                });
                showToast(`分类 "${newName.trim()}" 创建成功`);
            } else {
                if (newName.trim() === oldName) {
                    setEditCategoryModal(null);
                    setIsSubmitting(false);
                    return;
                }
                // 检查新名称是否已存在
                if (state.categories.includes(newName.trim())) {
                    showToast(`分类 "${newName.trim()}" 已存在`);
                    setIsSubmitting(false);
                    return;
                }
                await service.renameCategory(oldName, newName.trim());
                // 同时更新 sheetLibraryItems 中的 category 字段
                const updatedItems = state.sheetLibraryItems.map(item =>
                    item.category === oldName ? { ...item, category: newName.trim() } : item
                );
                updateState({
                    categories: state.categories.map(c => c === oldName ? newName.trim() : c),
                    selectedCategory: state.selectedCategory === oldName ? newName.trim() : state.selectedCategory,
                    sheetLibraryItems: updatedItems
                });
                showToast(`分类已重命名为 "${newName.trim()}"`);
            }
            setEditCategoryModal(null);
        } catch (e) {
            showToast('操作失败: ' + (e as Error).message);
        } finally {
            setIsSubmitting(false);
        }
    };

    // 删除分类
    const handleDeleteCategory = (categoryName: string) => {
        setDeleteConfirmModal(categoryName);
    };

    // 确认删除分类
    const confirmDeleteCategory = async () => {
        if (!deleteConfirmModal) return;
        const categoryName = deleteConfirmModal;

        const service = getSheetLibraryService();
        if (!service) {
            showToast('未连接表格');
            return;
        }

        try {
            await service.deleteCategory(categoryName);
            updateState({
                categories: state.categories.filter(c => c !== categoryName),
                selectedCategory: state.selectedCategory === categoryName ? null : state.selectedCategory
            });
            showToast(`分类 "${categoryName}" 已删除`);
            setDeleteConfirmModal(null);
        } catch (e) {
            showToast('删除失败: ' + (e as Error).message);
        }
    };

    // 添加到分类
    const [isAddingToCategory, setIsAddingToCategory] = useState(false);

    // 保存到表格状态
    const [sheetSaveStatus, setSheetSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
    const [sheetSaveError, setSheetSaveError] = useState('');

    // 保存到表格函数
    const handleSaveToSheet = async () => {
        if (!state.result || sheetSaveStatus === 'saving') return;

        const config = getSheetsSyncConfig();
        if (!config.webAppUrl) {
            showToast('请先在设置中配置表格同步');
            return;
        }

        setSheetSaveStatus('saving');
        setSheetSaveError('');

        try {
            const now = new Date().toLocaleString('zh-CN');
            const rows: (string | number)[][] = [];

            // 添加独特文案
            state.result.uniqueItems.forEach(item => {
                rows.push([now, item.text, item.chineseText || '', '独特']);
            });

            // 添加相似组的代表
            state.result.duplicateGroups.forEach(group => {
                rows.push([now, group.representative.text, group.representative.chineseText || '', `${group.duplicates.length + 1}条相似`]);
            });

            if (rows.length === 0) {
                showToast('没有可保存的数据');
                setSheetSaveStatus('idle');
                return;
            }

            const result = await appendToSheet('deduplicator', rows, config);

            if (result.success) {
                setSheetSaveStatus('success');
                showToast(`已保存 ${rows.length} 条到表格`);
                setTimeout(() => setSheetSaveStatus('idle'), 3000);
            } else {
                setSheetSaveStatus('error');
                setSheetSaveError(result.error || '保存失败');
                showToast(`保存失败: ${result.error}`);
            }
        } catch (e) {
            setSheetSaveStatus('error');
            setSheetSaveError(e instanceof Error ? e.message : '未知错误');
            showToast(`保存失败: ${e instanceof Error ? e.message : '未知错误'}`);
        }
    };

    const addToCategory = async (category: string) => {
        if (!state.result || isAddingToCategory) return;

        setIsAddingToCategory(true);
        showToast('入库中...');

        const service = getSheetLibraryService();
        if (!service) {
            // 根据不同情况给出不同提示
            if (state.isSheetConnected) {
                // 连接了但 service 丢失，可能是页面刷新导致
                showToast('表格连接已失效，请重新连接表格');
            } else {
                // 没有连接表格
                showToast('请先在左侧连接 Google Sheets 表格');
            }
            setIsAddingToCategory(false);
            return;
        }

        // 检查是否有写入权限（API Key 模式只读）
        if (state.authMode === 'apiKey') {
            showToast('当前模式无法写入表格，请切换登录方式重新登录邮箱并连接表格');
            setIsAddingToCategory(false);
            return;
        }

        // 构建入库数据：每行是一个保留文案 + 其相似文案
        // 格式: [保留英文, 保留中文, 相似1英文, 相似1中文, 相似2英文, 相似2中文, ...]
        let rowsToAdd: string[][] = [];

        // 1. 独特文案（无相似的）- 清理后入库
        for (const item of state.result.uniqueItems) {
            const cleanedText = cleanTextForLibrary(item.text);
            const cleanedChinese = cleanTextForLibrary(item.chineseText || '');
            if (cleanedText) {  // 确保清理后还有内容
                rowsToAdd.push([cleanedText, cleanedChinese]);
            }
        }

        // 2. 重复组（保留的 + 其相似文案）- 清理后入库
        // 100% 相似度的不添加到相似列，只保留一条
        let skipped100Percent = 0;

        for (const group of state.result.duplicateGroups) {
            const cleanedRepText = cleanTextForLibrary(group.representative.text);
            const cleanedRepChinese = cleanTextForLibrary(group.representative.chineseText || '');

            if (!cleanedRepText) continue;  // 清理后为空则跳过

            const row: string[] = [cleanedRepText, cleanedRepChinese];

            // 添加相似的文案（跳过 100% 完全一致的）
            for (const dup of group.duplicates) {
                if (dup.similarity >= 1.0) {
                    // 100% 完全一致，跳过不添加
                    skipped100Percent++;
                } else {
                    const cleanedDupText = cleanTextForLibrary(dup.item.text);
                    const cleanedDupChinese = cleanTextForLibrary(dup.item.chineseText || '');
                    if (cleanedDupText) {
                        row.push(cleanedDupText);
                        row.push(cleanedDupChinese);
                    }
                }
            }
            rowsToAdd.push(row);
        }

        if (rowsToAdd.length === 0) {
            showToast('没有可添加的文案');
            setIsAddingToCategory(false);
            return;
        }

        // 检查是否有重复：对比库中已有的文案（只检查保留英文列 A 列）
        const existingTexts = new Set(state.sheetLibraryItems.map(item => item.text.trim().toLowerCase()));
        const originalCount = rowsToAdd.length;
        rowsToAdd = rowsToAdd.filter(row => {
            const text = (row[0] || '').trim().toLowerCase();
            return text && !existingTexts.has(text);
        });

        if (rowsToAdd.length === 0) {
            showToast(`这 ${originalCount} 条文案已全部存在于库中，无需重复添加`);
            setIsAddingToCategory(false);
            return;
        }

        const skippedCount = originalCount - rowsToAdd.length;

        try {
            await service.addToCategoryRows(category, rowsToAdd);

            // 重新加载该分类
            await service.loadCategory(category);
            const allItems = service.getAllCachedItems();
            const primaryCount = getPrimaryCount(allItems);

            updateState({
                sheetLibraryItems: allItems,
                librarySize: primaryCount
            });

            // Toast 提示入库结果
            const skip100Msg = skipped100Percent > 0 ? `，跳过${skipped100Percent}条完全重复` : '';
            const skipExistMsg = skippedCount > 0 ? `，跳过${skippedCount}条已存在` : '';
            showToast(`✅ 已添加 ${rowsToAdd.length} 行到 "${category}"${skipExistMsg}${skip100Msg}`);
        } catch (e) {
            showToast('添加失败: ' + (e as Error).message);
        } finally {
            setIsAddingToCategory(false);
        }
    };

    return (
        <div className="pro-dedup-layout">
            {/* 左侧边栏 - 分类 */}
            <aside className={`pro-dedup-sidebar ${state.showLibrary ? 'open' : ''}`}>
                <div className="sidebar-header">
                    <Database size={16} />
                    <span>文案库</span>
                    <span className="lib-count">{state.librarySize}</span>
                </div>

                {/* Sheet 连接 */}
                <div className="sidebar-section">
                    {state.isSheetConnected ? (
                        <div className="sheet-status connected">
                            <Cloud size={14} />
                            <span>
                                已连接 ({state.authMode === 'apiKey' ? 'API Key 只读' :
                                    state.authMode === 'serviceAccount' ? '服务账号 读写' :
                                        'OAuth 读写'})
                            </span>
                            <button onClick={disconnectSheet} className="disconnect-btn">断开</button>
                        </div>
                    ) : (
                        <>
                            {/* 认证模式选择 */}
                            <div className="auth-mode-selector">
                                <label>
                                    <input
                                        type="radio"
                                        name="authMode"
                                        checked={state.authMode === 'apiKey'}
                                        onChange={() => updateState({ authMode: 'apiKey' })}
                                    />
                                    API Key（只读公开表格）
                                </label>
                                <label>
                                    <input
                                        type="radio"
                                        name="authMode"
                                        checked={state.authMode === 'serviceAccount'}
                                        onChange={() => updateState({ authMode: 'serviceAccount' })}
                                    />
                                    服务账号（可读写）
                                </label>
                                <label>
                                    <input
                                        type="radio"
                                        name="authMode"
                                        checked={state.authMode === 'gas'}
                                        onChange={() => updateState({ authMode: 'gas' })}
                                    />
                                    GAS Web App（可读写）⭐
                                </label>
                            </div>

                            {/* API Key 提示 */}
                            {state.authMode === 'apiKey' && (
                                <div className="auth-mode-tip">
                                    💡 表格需设为"任何人可查看"
                                </div>
                            )}

                            {/* 服务账号提示 */}
                            {state.authMode === 'serviceAccount' && (
                                <div className="auth-mode-tip">
                                    💡 需将表格共享给：ai-257@ai-toolkit-b2b78.iam.gserviceaccount.com
                                </div>
                            )}

                            {/* GAS 模式 */}
                            {state.authMode === 'gas' && (
                                <div className="gas-config">
                                    <div className="auth-mode-tip mb-2">
                                        📖 <strong>部署步骤：</strong>
                                        <ol className="gas-sidebar-steps">
                                            <li>在 Google Sheets 中打开 扩展程序 → Apps Script</li>
                                            <li>粘贴 GAS 脚本代码（见项目 docs/gas 目录）</li>
                                            <li>部署 → 新建部署 → Web 应用（任何人可访问）</li>
                                            <li>复制生成的 Web App URL 粘贴到下方</li>
                                        </ol>
                                        <button
                                            onClick={() => setShowGasGuide(true)}
                                            className="gas-tip-btn mt-2"
                                        >
                                            📖 查看详细部署指南
                                        </button>
                                    </div>
                                    <input
                                        type="text"
                                        placeholder="GAS Web App URL"
                                        value={state.gasWebAppUrl}
                                        onChange={e => updateState({ gasWebAppUrl: e.target.value })}
                                        className="gas-url-input"
                                    />
                                </div>
                            )}

                            {/* Sheet URL (非 GAS 模式) */}
                            {state.authMode !== 'gas' && (
                                <div className="sheet-connect-compact">
                                    <input
                                        type="text"
                                        placeholder="Sheets 链接..."
                                        value={state.sheetUrl}
                                        onChange={e => updateState({ sheetUrl: e.target.value })}
                                    />
                                    <button
                                        onClick={() => connectToSheet(state.sheetUrl)}
                                        disabled={state.isLoadingSheet || !state.sheetUrl.trim()}
                                    >
                                        {state.isLoadingSheet ? <Loader2 size={12} className="spinning" /> : '连接'}
                                    </button>
                                </div>
                            )}

                            {/* GAS 连接按钮 */}
                            {state.authMode === 'gas' && (
                                <button
                                    className="gas-connect-btn"
                                    onClick={() => connectToSheet('')}
                                    disabled={state.isLoadingSheet || !state.gasWebAppUrl.trim()}
                                >
                                    {state.isLoadingSheet ? <Loader2 size={12} className="spinning" /> : '连接 GAS'}
                                </button>
                            )}
                        </>
                    )}
                    {state.sheetError && <div className="sidebar-error">{state.sheetError}</div>}
                </div>

                {/* 分类列表 */}
                {state.isSheetConnected && (
                    <div className="sidebar-categories">
                        <div className="categories-header">
                            <span>分类</span>
                            <button
                                className="cat-add-btn tooltip-bottom"
                                onClick={handleCreateCategory}
                                data-tip="添加分类"
                            >
                                <Plus size={12} />
                            </button>
                        </div>
                        {state.categories.map(cat => {
                            const categoryItems = state.sheetLibraryItems.filter(i => i.category === cat);
                            const count = getPrimaryCount(categoryItems);
                            return (
                                <div
                                    key={cat}
                                    className={`sidebar-cat ${state.selectedCategory === cat ? 'active' : ''}`}
                                >
                                    <span
                                        className="cat-name"
                                        onClick={() => updateState({
                                            selectedCategory: state.selectedCategory === cat ? null : cat
                                        })}
                                    >
                                        {cat}
                                    </span>
                                    <span className="cat-count">{count}</span>
                                    <div className="cat-actions">
                                        <button
                                            className="cat-action-btn tooltip-bottom"
                                            onClick={() => handleRenameCategory(cat)}
                                            data-tip="重命名"
                                        >
                                            <Edit2 size={10} />
                                        </button>
                                        <button
                                            className="cat-action-btn danger tooltip-bottom"
                                            onClick={() => handleDeleteCategory(cat)}
                                            data-tip="删除"
                                        >
                                            <Trash2 size={10} />
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {!state.isSheetConnected && (
                    <button className="sidebar-clear-btn" onClick={handleClearLibrary}>
                        <Trash2 size={12} /> 清空本地库
                    </button>
                )}
            </aside>

            {/* 主区域 */}
            <main className="pro-dedup-main">
                {/* 顶部输入栏 */}
                <div className="pro-dedup-topbar">
                    <button
                        className="topbar-btn sidebar-toggle"
                        onClick={() => updateState({ showLibrary: !state.showLibrary })}
                    >
                        <Database size={14} />
                    </button>

                    {/* 模式切换 */}
                    <div className="mode-tabs">
                        <button
                            className={`mode-tab ${state.mode === 'check' ? 'active' : ''}`}
                            onClick={() => updateState({ mode: 'check' })}
                        >
                            <Zap size={12} /> 查重
                        </button>
                        <button
                            className={`mode-tab ${state.mode === 'search' ? 'active' : ''}`}
                            onClick={() => updateState({ mode: 'search' })}
                        >
                            <Search size={12} /> 搜索
                        </button>
                        <button
                            className={`mode-tab ${state.mode === 'classify' ? 'active' : ''}`}
                            onClick={() => updateState({ mode: 'classify' })}
                        >
                            <Tag size={12} /> 分类
                        </button>
                        <button
                            className={`mode-tab ${state.mode === 'ai-classify' ? 'active' : ''}`}
                            onClick={() => updateState({ mode: 'ai-classify' })}
                        >
                            <Sparkles size={12} /> AI分类
                        </button>
                    </div>

                    {state.mode === 'check' ? (
                        <>
                            <div className="topbar-input">
                                <textarea
                                    placeholder="粘贴文案（每行一条 或 从表格复制）"
                                    value={state.inputText}
                                    onChange={(e) => updateState({ inputText: e.target.value })}
                                    onPaste={(e) => {
                                        const html = e.clipboardData.getData('text/html');
                                        if (html) setCheckPasteHtml(html);
                                    }}
                                    disabled={state.isProcessing}
                                    rows={1}
                                />
                                {state.inputText.trim() && (
                                    <span className="input-hint">约 {parseInputText(state.inputText).length} 条</span>
                                )}
                            </div>
                            <button
                                className="topbar-btn primary"
                                onClick={handleDedup}
                                disabled={state.isProcessing || !state.inputText.trim()}
                            >
                                <Zap size={14} />
                                查重
                            </button>
                            {(state.inputText.trim() || state.result) && (
                                <button
                                    className="topbar-btn"
                                    onClick={() => updateState({ inputText: '', result: null })}
                                    title="清空"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </>
                    ) : state.mode === 'search' ? (
                        <>
                            <div className="topbar-input">
                                <textarea
                                    placeholder="输入一条文案，从库中搜索相似的"
                                    value={state.searchQuery}
                                    onChange={(e) => updateState({ searchQuery: e.target.value })}
                                    onPaste={(e) => {
                                        const html = e.clipboardData.getData('text/html');
                                        if (html) setSearchPasteHtml(html);
                                    }}
                                    disabled={state.isProcessing}
                                    rows={1}
                                    onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && (e.preventDefault(), handleSearch())}
                                />
                            </div>
                            <button
                                className="topbar-btn primary"
                                onClick={handleSearch}
                                disabled={state.isProcessing || isEmbeddingSearching || !state.searchQuery.trim()}
                            >
                                <Search size={14} />
                                搜索
                            </button>
                            {getAiInstance && (
                                <button
                                    className="topbar-btn"
                                    onClick={handleEmbeddingSearch}
                                    disabled={state.isProcessing || isEmbeddingSearching || !state.searchQuery.trim()}
                                    title="使用 AI Embedding 语义搜索，理解文案含义而非仅匹配关键词"
                                    style={{
                                        background: isEmbeddingSearching ? 'rgba(168,85,247,0.3)' : 'rgba(168,85,247,0.15)',
                                        color: '#c084fc',
                                        borderColor: 'rgba(168,85,247,0.3)',
                                    }}
                                >
                                    {isEmbeddingSearching ? <Loader2 size={14} className="animate-spin" /> : <Brain size={14} />}
                                    {isEmbeddingSearching ? (embeddingProgress || 'AI 搜索中...') : 'AI 语义搜索'}
                                </button>
                            )}
                            {(state.searchQuery.trim() || state.searchGroups.length > 0) && (
                                <button
                                    className="topbar-btn"
                                    onClick={() => updateState({ searchQuery: '', searchGroups: [], selectedSearchItems: new Set() })}
                                    title="清空"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </>
                    ) : state.mode === 'ai-classify' ? (
                        /* AI 语义分类模式 - 顶栏 */
                        <>
                            {state.isProcessing ? (
                                <button
                                    className="topbar-btn"
                                    onClick={handleAiClassifyStop}
                                    style={{ color: '#ef4444' }}
                                >
                                    <X size={14} />
                                    停止
                                </button>
                            ) : (
                                <button
                                    className="topbar-btn primary"
                                    onClick={handleAiClassify}
                                    disabled={!state.aiClassifyInputText.trim()}
                                >
                                    <Sparkles size={14} />
                                    开始分类
                                </button>
                            )}
                            <button
                                className={`topbar-btn${state.aiClassifySystemPromptEdit ? ' active' : ''}`}
                                onClick={() => updateState({
                                    aiClassifyShowSystemPrompt: true,
                                    // 首次打开时加载默认 prompt（若没有自定义过）
                                    aiClassifySystemPromptEdit: state.aiClassifySystemPromptEdit || ''
                                })}
                                title="查看/编辑系统指令"
                            >
                                <Eye size={14} />
                                指令{state.aiClassifySystemPromptEdit ? ' ✦' : ''}
                            </button>
                            {!state.isProcessing && state.aiClassifyResults.some(r => r.major === '❌ 失败') && (
                                <button
                                    className="topbar-btn"
                                    onClick={handleAiClassifyRetryFailed}
                                    style={{ color: '#f59e0b' }}
                                >
                                    <Loader2 size={14} />
                                    重试失败({state.aiClassifyResults.filter(r => r.major === '❌ 失败').length})
                                </button>
                            )}
                            {state.aiClassifyResults.length > 0 && (
                                <>
                                    <div style={{ position: 'relative' }}>
                                        <button
                                            className={`topbar-btn ${state.aiClassifySortBy !== 'original' ? 'active' : ''}`}
                                            onClick={(e) => {
                                                const menu = (e.currentTarget.nextElementSibling as HTMLElement);
                                                if (menu) menu.style.display = menu.style.display === 'block' ? 'none' : 'block';
                                            }}
                                        >
                                            <ArrowUpDown size={14} />
                                            {{ 'original': '排序', 'major': '大分类', 'middle': '中分类', 'minor': '小分类', 'chars-asc': '字数↑', 'chars-desc': '字数↓' }[state.aiClassifySortBy]}
                                            <ChevronDown size={12} />
                                        </button>
                                        <div style={{
                                            display: 'none', position: 'absolute', top: '100%', left: 0, marginTop: 4,
                                            background: 'var(--card-bg-color, #1e293b)', border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
                                            borderRadius: 6, boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 100, minWidth: 140, overflow: 'hidden',
                                        }}>
                                            {([
                                                ['original', '原始顺序'],
                                                ['major', '按大分类'],
                                                ['middle', '按中分类'],
                                                ['minor', '按小分类'],
                                                ['chars-asc', '字数 ↑'],
                                                ['chars-desc', '字数 ↓'],
                                            ] as [typeof state.aiClassifySortBy, string][]).map(([key, label]) => (
                                                <button
                                                    key={key}
                                                    style={{
                                                        display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                                                        padding: '7px 12px', border: 'none', background: state.aiClassifySortBy === key ? 'rgba(99,102,241,0.15)' : 'transparent',
                                                        color: state.aiClassifySortBy === key ? '#818cf8' : 'var(--text-color, #e2e8f0)',
                                                        fontSize: 13, cursor: 'pointer', textAlign: 'left',
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget.style.background = state.aiClassifySortBy === key ? 'rgba(99,102,241,0.2)' : 'rgba(255,255,255,0.06)')}
                                                    onMouseLeave={e => (e.currentTarget.style.background = state.aiClassifySortBy === key ? 'rgba(99,102,241,0.15)' : 'transparent')}
                                                    onClick={(e) => {
                                                        updateState({ aiClassifySortBy: key });
                                                        const menu = (e.currentTarget.parentElement as HTMLElement);
                                                        if (menu) menu.style.display = 'none';
                                                    }}
                                                >
                                                    <span style={{ width: 16, textAlign: 'center' }}>{state.aiClassifySortBy === key ? '✓' : ''}</span>
                                                    {label}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                    <button className="topbar-btn" onClick={copyAiClassifyCurrentView} title="复制当前显示的结果（文案+分类，受筛选+排序影响）">
                                        <Copy size={14} /> 复制结果{state.aiClassifyActiveCategories.size > 0 ? `(${getFilteredAiResults().length})` : ''}
                                    </button>
                                    <button className="topbar-btn" onClick={copyAiClassifyColumnsOnly} title="仅复制分类列（大类/中类/小类，受筛选+排序影响）">
                                        <Copy size={14} /> 仅分类
                                    </button>
                                    <button className="topbar-btn" onClick={copyAiClassifyAllTSV} title="复制全部结果（文案+分类，原始顺序，保留空行）">
                                        <Download size={14} /> 复制全部
                                    </button>
                                </>
                            )}
                            {(state.aiClassifyInputText.trim() || state.aiClassifyResults.length > 0) && (
                                <button
                                    className="topbar-btn"
                                    onClick={() => updateState({ aiClassifyInputText: '', aiClassifyResults: [], aiClassifyStats: null, aiClassifyActiveCategories: new Set<string>(), aiClassifyProgress: null })}
                                    title="清空"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </>
                    ) : (
                        /* 分类模式 - 顶栏只显示按钮 */
                        <>
                            <button
                                className="topbar-btn primary"
                                onClick={handleClassify}
                                disabled={!state.classifyRulesText.trim() || !state.classifyInputText.trim()}
                            >
                                <Tag size={14} />
                                开始分类
                            </button>
                            {state.classifyResults.length > 0 && (
                                <>
                                    <button
                                        className={`topbar-btn ${state.classifySortBy === 'category' ? 'active' : ''}`}
                                        onClick={() => updateState({ classifySortBy: state.classifySortBy === 'original' ? 'category' : 'original' })}
                                        title={state.classifySortBy === 'original' ? '按分类排序' : '恢复原始顺序'}
                                    >
                                        <ArrowUpDown size={14} />
                                        {state.classifySortBy === 'original' ? '排序' : '已排序'}
                                    </button>
                                    <button className="topbar-btn" onClick={copyClassifyResults}>
                                        <Copy size={14} /> 复制分类列
                                    </button>
                                    <button className="topbar-btn" onClick={copyClassifyResultsFull}>
                                        <Download size={14} /> 原始顺序
                                    </button>
                                    <button className="topbar-btn" onClick={copyClassifyResultsSorted}>
                                        <Download size={14} /> 按分类复制
                                    </button>
                                </>
                            )}
                            {(state.classifyRulesText.trim() || state.classifyInputText.trim() || state.classifyResults.length > 0) && (
                                <button
                                    className="topbar-btn"
                                    onClick={() => updateState({ classifyRulesText: '', classifyInputText: '', classifyResults: [], classifyActiveCategories: new Set<string>() })}
                                    title="清空"
                                >
                                    <Trash2 size={14} />
                                </button>
                            )}
                        </>
                    )}

                    <button
                        className="topbar-btn settings"
                        onClick={() => updateState({ showSettings: true })}
                        title="设置"
                    >
                        <Settings size={14} />
                    </button>
                </div>

                {/* 结果区域 - 根据模式显示 */}
                {state.mode === 'ai-classify' ? (
                    /* AI 语义分类模式 - 结果区域 */
                    <div className="pro-dedup-results" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        {/* 折叠标题栏 */}
                        <div
                            style={{ display: 'flex', alignItems: 'center', padding: '4px 12px', borderBottom: '1px solid var(--border-color, #333)', cursor: 'pointer', flexShrink: 0, gap: '8px', fontSize: '11px', color: 'var(--text-muted, #888)', userSelect: 'none' }}
                            onClick={() => updateState({ aiClassifyInputCollapsed: !state.aiClassifyInputCollapsed })}
                        >
                            {state.aiClassifyInputCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                            <span>规则 内置 8大类+68中类{state.aiClassifyCustomRules.length > 0 ? ` + ${state.aiClassifyCustomRules.length}条自定义` : ''}</span>
                            <span style={{ color: 'var(--border-color, #444)' }}>|</span>
                            <span>文案 {aiClassifyParsedItems.length > 0 ? aiClassifyParsedItems.length + ' 条' : '未粘贴'}</span>
                            <span style={{ color: 'var(--border-color, #444)' }}>|</span>
                            <span>批量 {state.aiClassifyBatchSize >= 999 ? '自动' : state.aiClassifyBatchSize + '条/批'} · {state.aiClassifyDepth === 'full' ? '三层分类' : '仅大类'}</span>
                            <div style={{ flex: 1 }} />
                            <span style={{ fontSize: '10px' }}>{state.aiClassifyInputCollapsed ? '展开' : '折叠'}</span>
                        </div>

                        {/* 文案输入（可折叠） */}
                        {!state.aiClassifyInputCollapsed && (() => {
                            const parsedItems = aiClassifyParsedItems;
                            return (
                            <div style={{ display: 'flex', flexDirection: 'column', borderBottom: '1px solid var(--border-color, #333)', flexShrink: 0 }}>
                                {/* 上部：文本框 */}
                                <div style={{ display: 'flex', minHeight: '60px', maxHeight: '160px' }}>
                                    {/* 粘贴区 */}
                                    <textarea
                                        style={{ flex: 1, border: 'none', background: 'transparent', color: 'var(--text-color, #e4e4e7)', padding: '8px 12px', fontSize: '12px', resize: 'none', minHeight: '60px' }}
                                        placeholder="粘贴文案（每行一条 或 从表格复制中英文两列）"
                                        value={state.aiClassifyInputText}
                                        onChange={(e) => updateState({ aiClassifyInputText: e.target.value })}
                                        onPaste={handleAiClassifyPaste}
                                        disabled={state.isProcessing}
                                    />
                                    {parsedItems.length > 0 && (
                                        <div style={{ display: 'flex', alignItems: 'center', padding: '0 12px', fontSize: '11px', color: '#22c55e', fontWeight: 600, whiteSpace: 'nowrap', borderLeft: '1px solid var(--border-color, #333)' }}>
                                            ✅ {parsedItems.length} 条文案
                                        </div>
                                    )}
                                </div>
                                {/* 设置行 */}
                                <div style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '4px 12px', fontSize: '11px', color: 'var(--text-muted, #888)', borderTop: '1px solid var(--border-color, #333)' }}>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        批量大小:
                                        <select
                                            value={state.aiClassifyBatchSize}
                                            onChange={e => updateState({ aiClassifyBatchSize: parseInt(e.target.value) })}
                                            style={{ background: 'var(--control-bg-color, #27272a)', color: 'var(--text-color, #e4e4e7)', border: '1px solid var(--border-color, #333)', borderRadius: '4px', padding: '1px 4px', fontSize: '11px' }}
                                        >
                                            <option value="999">自动（智能分批）</option>
                                            <option value="20">20条/批</option>
                                            <option value="50">50条/批</option>
                                            <option value="100">100条/批</option>
                                        </select>
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                        <input type="radio" name="aiDepth" checked={state.aiClassifyDepth === 'full'} onChange={() => updateState({ aiClassifyDepth: 'full' })} />
                                        三层(大+中+小)
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer' }}>
                                        <input type="radio" name="aiDepth" checked={state.aiClassifyDepth === 'major'} onChange={() => updateState({ aiClassifyDepth: 'major' })} />
                                        仅大类
                                    </label>
                                    <label style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        AI模型:
                                        <select
                                            value={classifyLocalModel}
                                            onChange={e => {
                                                const v = e.target.value;
                                                setClassifyLocalModel(v);
                                                try { localStorage.setItem(CLASSIFY_MODEL_KEY, v); } catch {}
                                            }}
                                            style={{ background: 'var(--control-bg-color, #27272a)', color: 'var(--text-color, #e4e4e7)', border: '1px solid var(--border-color, #333)', borderRadius: '4px', padding: '1px 4px', fontSize: '11px', maxWidth: '200px' }}
                                        >
                                            {CLASSIFY_MODEL_OPTIONS.map(o => (
                                                <option key={o.value} value={o.value}>
                                                    {o.value === INHERIT_VALUE ? `${o.label} (${textModel})` : o.label}
                                                </option>
                                            ))}
                                        </select>
                                    </label>
                                    <div style={{ flex: 1 }} />
                                    <button
                                        style={{
                                            background: state.aiClassifyCustomRules.length > 0 ? '#22c55e22' : 'transparent',
                                            color: state.aiClassifyCustomRules.length > 0 ? '#22c55e' : 'var(--text-muted, #888)',
                                            border: `1px solid ${state.aiClassifyCustomRules.length > 0 ? '#22c55e44' : 'var(--border-color, #333)'}`,
                                            borderRadius: '4px', padding: '1px 8px', fontSize: '10px', cursor: 'pointer',
                                        }}
                                        onClick={() => updateState({ aiClassifyShowCustomRules: !state.aiClassifyShowCustomRules })}
                                    >
                                        ✏️ 自定义规则 {state.aiClassifyCustomRules.length > 0 ? `(${state.aiClassifyCustomRules.length})` : ''}
                                    </button>
                                </div>
                                {/* 自定义分类规则（结构化表单） */}
                                {state.aiClassifyShowCustomRules && (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '4px', padding: '6px 12px', borderTop: '1px solid var(--border-color, #333)', fontSize: '11px' }}>
                                    {state.aiClassifyCustomRules.map((rule, idx) => (
                                        <div key={rule.id} style={{ display: 'flex', gap: '6px', alignItems: 'center', padding: '3px 0', borderBottom: '1px solid var(--border-color, #222)' }}>
                                            <select
                                                value={rule.level}
                                                onChange={e => {
                                                    const updated = [...state.aiClassifyCustomRules];
                                                    updated[idx] = { ...rule, level: e.target.value as 'major' | 'middle' | 'minor' };
                                                    updateState({ aiClassifyCustomRules: updated });
                                                    localStorage.setItem('ai_classify_custom_rules', JSON.stringify(updated));
                                                }}
                                                style={{ background: 'var(--control-bg-color, #27272a)', color: 'var(--text-color, #e4e4e7)', border: '1px solid var(--border-color, #333)', borderRadius: '4px', padding: '2px 4px', fontSize: '10px', width: '60px' }}
                                            >
                                                <option value="major">大类</option>
                                                <option value="middle">中类</option>
                                                <option value="minor">小类</option>
                                            </select>
                                            <input
                                                type="text"
                                                placeholder="类别名称"
                                                value={rule.name}
                                                onChange={e => {
                                                    const updated = [...state.aiClassifyCustomRules];
                                                    updated[idx] = { ...rule, name: e.target.value };
                                                    updateState({ aiClassifyCustomRules: updated });
                                                    localStorage.setItem('ai_classify_custom_rules', JSON.stringify(updated));
                                                }}
                                                style={{ background: 'var(--control-bg-color, #27272a)', color: 'var(--text-color, #e4e4e7)', border: '1px solid var(--border-color, #333)', borderRadius: '4px', padding: '2px 6px', fontSize: '11px', width: '90px' }}
                                            />
                                            {rule.level !== 'major' && (
                                                <input
                                                    type="text"
                                                    placeholder={rule.level === 'middle' ? '归属大类' : '归属中类'}
                                                    value={rule.parentCategory}
                                                    onChange={e => {
                                                        const updated = [...state.aiClassifyCustomRules];
                                                        updated[idx] = { ...rule, parentCategory: e.target.value };
                                                        updateState({ aiClassifyCustomRules: updated });
                                                        localStorage.setItem('ai_classify_custom_rules', JSON.stringify(updated));
                                                    }}
                                                    style={{ background: 'var(--control-bg-color, #27272a)', color: '#f59e0b', border: '1px solid var(--border-color, #333)', borderRadius: '4px', padding: '2px 6px', fontSize: '11px', width: '80px' }}
                                                />
                                            )}
                                            <input
                                                type="text"
                                                placeholder="判断标准（什么内容属于这个类别）"
                                                value={rule.criteria}
                                                onChange={e => {
                                                    const updated = [...state.aiClassifyCustomRules];
                                                    updated[idx] = { ...rule, criteria: e.target.value };
                                                    updateState({ aiClassifyCustomRules: updated });
                                                    localStorage.setItem('ai_classify_custom_rules', JSON.stringify(updated));
                                                }}
                                                style={{ flex: 1, background: 'var(--control-bg-color, #27272a)', color: 'var(--text-color, #e4e4e7)', border: '1px solid var(--border-color, #333)', borderRadius: '4px', padding: '2px 6px', fontSize: '11px' }}
                                            />
                                            <button
                                                onClick={() => {
                                                    const updated = state.aiClassifyCustomRules.filter((_, i) => i !== idx);
                                                    updateState({ aiClassifyCustomRules: updated });
                                                    localStorage.setItem('ai_classify_custom_rules', JSON.stringify(updated));
                                                }}
                                                style={{ background: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer', padding: '2px', fontSize: '14px', lineHeight: 1 }}
                                                title="删除此规则"
                                            >×</button>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => {
                                            const newRule: CustomClassifyRule = { id: Date.now().toString(), name: '', level: 'middle', criteria: '', parentCategory: '' };
                                            const updated = [...state.aiClassifyCustomRules, newRule];
                                            updateState({ aiClassifyCustomRules: updated });
                                            localStorage.setItem('ai_classify_custom_rules', JSON.stringify(updated));
                                        }}
                                        style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'transparent', color: '#22c55e', border: '1px dashed #22c55e44', borderRadius: '4px', padding: '4px 8px', fontSize: '10px', cursor: 'pointer', justifyContent: 'center' }}
                                    >
                                        <Plus size={12} /> 添加自定义分类
                                    </button>
                                </div>
                                )}
                            </div>
                            );
                        })()}

                        {/* 进度条 */}
                        {state.aiClassifyProgress && (
                            <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-color, #333)', fontSize: '11px', color: '#22c55e', display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <div style={{ flex: 1, height: '4px', background: 'var(--control-bg-color, #27272a)', borderRadius: '2px', overflow: 'hidden' }}>
                                    <div style={{ width: `${Math.round((state.aiClassifyProgress.current / Math.max(1, state.aiClassifyProgress.total)) * 100)}%`, height: '100%', background: '#22c55e', borderRadius: '2px', transition: 'width 0.3s' }} />
                                </div>
                                <span>{state.aiClassifyProgress.status}</span>
                            </div>
                        )}

                        {/* 统计概览 + 分类切换 */}
                        {state.aiClassifyStats && state.aiClassifyResults.length > 0 && (
                            <div style={{ padding: '6px 12px', borderBottom: '1px solid var(--border-color, #333)', fontSize: '11px' }}>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '4px' }}>
                                    <button
                                        className={`mode-tab ${state.aiClassifyActiveCategories.size === 0 ? 'active' : ''}`}
                                        style={{
                                            display: 'inline-flex', alignItems: 'center', gap: '4px',
                                            padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                                            background: state.aiClassifyActiveCategories.size === 0 ? '#22c55e22' : 'transparent',
                                            color: state.aiClassifyActiveCategories.size === 0 ? '#22c55e' : 'var(--text-muted, #888)',
                                            border: `1px solid ${state.aiClassifyActiveCategories.size === 0 ? '#22c55e44' : 'var(--border-color, #333)'}`,
                                            whiteSpace: 'nowrap',
                                        }}
                                        onClick={() => updateState({ aiClassifyActiveCategories: new Set<string>() })}
                                    >
                                        全部 {state.aiClassifyResults.length}
                                    </button>
                                    {sortedEntries(state.aiClassifyStats.majorCounts).map(([cat, count]) => (
                                        <button
                                            key={cat}
                                            className={`mode-tab ${state.aiClassifyActiveCategories.has(cat) ? 'active' : ''}`}
                                            style={{
                                                display: 'inline-flex', alignItems: 'center', gap: '4px',
                                                padding: '2px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                                                background: state.aiClassifyActiveCategories.has(cat) ? `${MAJOR_CATEGORY_COLORS[cat] || '#6b7280'}22` : 'transparent',
                                                color: state.aiClassifyActiveCategories.has(cat) ? (MAJOR_CATEGORY_COLORS[cat] || '#6b7280') : 'var(--text-muted, #888)',
                                                border: `1px solid ${state.aiClassifyActiveCategories.has(cat) ? `${MAJOR_CATEGORY_COLORS[cat] || '#6b7280'}44` : 'var(--border-color, #333)'}`,
                                                whiteSpace: 'nowrap',
                                            }}
                                            onClick={() => {
                                                if (state.aiClassifyActiveCategories.has(cat)) {
                                                    updateState({ aiClassifyActiveCategories: new Set<string>() });
                                                } else {
                                                    updateState({ aiClassifyActiveCategories: new Set<string>([cat]) });
                                                }
                                            }}
                                        >
                                            {cat} {count}
                                        </button>
                                    ))}
                                </div>
                                {Object.keys(state.aiClassifyStats.middleCounts).length > 0 && (
                                    <div style={{ fontSize: '10px', color: 'var(--text-muted, #888)' }}>
                                        中类Top5: {sortedEntries(state.aiClassifyStats.middleCounts).slice(0, 5).map(([cat, count]) => `${cat} ${count}`).join(' · ')}
                                    </div>
                                )}
                            </div>
                        )}

                        {/* 结果表格 */}
                        {state.aiClassifyResults.length > 0 ? (
                            <div style={{ flex: 1, overflow: 'auto' }}>
                                <table className="results-table" style={{ fontSize: '12px' }}>
                                    <thead>
                                        <tr>
                                            <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                                            <th style={{ minWidth: '200px' }}>文案</th>
                                            <th style={{ width: '50px', textAlign: 'center' }}>字数</th>
                                            <th style={{ width: '90px' }}>大类</th>
                                            <th style={{ width: '130px' }}>中类</th>
                                            <th style={{ width: '160px' }}>小类</th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {getFilteredAiResults().map((r, i) => (
                                            <tr key={r.index} onContextMenu={(e) => {
                                                e.preventDefault();
                                                // 右键修改分类 (simplified: copy text)
                                                const text = `${r.text}\t${r.major}\t${r.middle}\t${r.minor}`;
                                                navigator.clipboard.writeText(text);
                                                showToast('已复制该行');
                                            }}>
                                                <td style={{ textAlign: 'center', color: 'var(--text-muted, #666)' }}>{r.index}</td>
                                                <td>
                                                    {r.zhText && r.enText ? (
                                                        <>
                                                            <div style={{ fontSize: '12px', marginBottom: '2px', lineHeight: 1.4 }}>{r.zhText.length > 80 ? r.zhText.slice(0, 80) + '…' : r.zhText}</div>
                                                            <div style={{ fontSize: '10px', color: 'var(--text-muted, #888)', lineHeight: 1.3 }}>{r.enText.length > 100 ? r.enText.slice(0, 100) + '…' : r.enText}</div>
                                                        </>
                                                    ) : (
                                                        <div style={{ fontSize: '12px', lineHeight: 1.4 }}>{r.text.length > 120 ? r.text.slice(0, 120) + '…' : r.text}</div>
                                                    )}
                                                </td>
                                                <td style={{ textAlign: 'center', fontSize: '10px', color: 'var(--text-muted, #888)', fontVariantNumeric: 'tabular-nums' }}>{r.text.length}</td>
                                                <td>
                                                    <span style={{
                                                        display: 'inline-block', padding: '2px 6px', borderRadius: '4px',
                                                        fontSize: '11px', fontWeight: 600,
                                                        background: `${MAJOR_CATEGORY_COLORS[r.major] || '#6b7280'}22`,
                                                        color: MAJOR_CATEGORY_COLORS[r.major] || '#6b7280',
                                                        border: `1px solid ${MAJOR_CATEGORY_COLORS[r.major] || '#6b7280'}44`,
                                                    }}>
                                                        {r.major}
                                                    </span>
                                                </td>
                                                <td style={{ fontSize: '11px', color: 'var(--text-color, #ddd)' }}>{r.middle}</td>
                                                <td style={{ fontSize: '11px' }}>
                                                    {r.minor}
                                                    {r.isManual && (
                                                        <span style={{ marginLeft: '4px', padding: '1px 4px', borderRadius: '3px', fontSize: '9px', background: '#22c55e22', color: '#22c55e', fontWeight: 600 }}>人工</span>
                                                    )}
                                                </td>
                                            </tr>
                                        ))}
                                    </tbody>
                                </table>
                            </div>
                        ) : aiClassifyParsedItems.length > 0 ? (
                                /* 粘贴预览 或 处理中等待结果：显示预览表格 */
                                <div style={{ flex: 1, overflow: 'auto' }}>
                                    <table className="results-table" style={{ fontSize: '12px' }}>
                                        <thead>
                                            <tr>
                                                <th style={{ width: '40px', textAlign: 'center' }}>#</th>
                                                <th>文案</th>
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {aiClassifyParsedItems.map((item, i) => (
                                                <tr key={i}>
                                                    <td style={{ textAlign: 'center', color: 'var(--text-muted, #666)' }}>{i + 1}</td>
                                                    <td>
                                                        {item.zhText && item.enText ? (
                                                            <>
                                                                <div style={{ fontSize: '12px', marginBottom: '2px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{item.zhText}</div>
                                                                <div style={{ fontSize: '10px', color: 'var(--text-muted, #888)', lineHeight: 1.4, whiteSpace: 'pre-wrap' }}>{item.enText}</div>
                                                            </>
                                                        ) : (
                                                            <div style={{ fontSize: '12px', lineHeight: 1.5, whiteSpace: 'pre-wrap' }}>{item.text}</div>
                                                        )}
                                                    </td>
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            ) : !state.isProcessing ? (
                                <div className="pro-dedup-empty">
                                    <Sparkles size={48} />
                                    <h3>AI 语义分类</h3>
                                    <p>内置 8大类 + 68中类 分类体系 · 基于 Gemini AI 语义理解</p>
                                    <p style={{ fontSize: '0.7rem', color: 'var(--text-muted, #888)' }}>粘贴文案后点击「开始分类」（会消耗 API Token）</p>
                                </div>
                        ) : null}
                    </div>
                ) : state.mode === 'classify' ? (
                    /* 分类模式 - 粘贴即显示表格 */
                    <div className="pro-dedup-results" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
                        {/* 折叠标题栏 */}
                        <div
                            style={{ display: 'flex', alignItems: 'center', padding: '4px 12px', borderBottom: '1px solid var(--border-color, #333)', cursor: 'pointer', flexShrink: 0, gap: '8px', fontSize: '11px', color: 'var(--text-muted, #888)', userSelect: 'none' }}
                            onClick={() => updateState({ classifyInputCollapsed: !state.classifyInputCollapsed })}
                        >
                            {state.classifyInputCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                            <span>规则 {parseClassifyRules(state.classifyRulesText).length} 条</span>
                            <span style={{ color: 'var(--border-color, #444)' }}>|</span>
                            <span>文案 {state.classifyInputText.trim() ? parseClassifyInputRows(state.classifyInputText).length + ' 条' : '未粘贴'}</span>
                            <div style={{ flex: 1 }} />
                            <span style={{ fontSize: '10px' }}>{state.classifyInputCollapsed ? '展开' : '折叠'}</span>
                        </div>

                        {/* 规则 + 文案输入条（可折叠） */}
                        {!state.classifyInputCollapsed && (
                            <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border-color, #333)', flexShrink: 0, minHeight: '80px', maxHeight: '200px' }}>
                                {/* 左：规则表格 */}
                                <div style={{ flex: 3, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border-color, #333)', overflow: 'hidden' }}>
                                    {(() => {
                                        const rules = parseClassifyRules(state.classifyRulesText);
                                        if (rules.length === 0) {
                                            return (
                                                <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                                                    <textarea
                                                        style={{ flex: 1, width: '100%', padding: '6px 10px', border: 'none', background: 'transparent', color: 'var(--text-primary, #e0e0e0)', fontSize: '11px', fontFamily: 'monospace', resize: 'none', boxSizing: 'border-box' }}
                                                        placeholder={"支持 2~4 列规则（表头可选）\n主类别\t子类别\t中文关键词\t英文关键词\n信仰\t是否去教堂\t去教堂、礼拜\tchurch、worship\n\t上帝知你累\t上帝知你累、争战\tgod knows you're tired"}
                                                        value={state.classifyRulesText}
                                                        onChange={e => updateState({ classifyRulesText: e.target.value })}
                                                    />
                                                </div>
                                            );
                                        }
                                        // Group by main/sub category for display
                                        const groupMap = new Map<string, { main: string; sub: string; keywords: string[] }>();
                                        rules.forEach(r => {
                                            const main = (r.mainCategory || '').trim();
                                            const sub = (r.subCategory || r.category || '').trim();
                                            const key = `${main}|||${sub}`;
                                            const group = groupMap.get(key) || { main, sub, keywords: [] };
                                            if (!group.keywords.includes(r.keyword)) group.keywords.push(r.keyword);
                                            groupMap.set(key, group);
                                        });
                                        return (
                                            <div style={{ flex: 1, overflow: 'auto' }}>
                                                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px' }}>
                                                    <thead>
                                                        <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary, #1a1a1a)', zIndex: 1 }}>
                                                            <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border-color, #333)', color: 'var(--text-muted, #888)', fontWeight: 500 }}>关键词</th>
                                                            <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border-color, #333)', color: 'var(--text-muted, #888)', fontWeight: 500, width: '88px' }}>主类别</th>
                                                            <th style={{ padding: '4px 8px', textAlign: 'left', borderBottom: '1px solid var(--border-color, #333)', color: 'var(--text-muted, #888)', fontWeight: 500, width: '96px' }}>子类别</th>
                                                            <th style={{ padding: '4px 8px', borderBottom: '1px solid var(--border-color, #333)', width: '24px' }}>
                                                                <button
                                                                    style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted, #666)' }}
                                                                    onClick={() => updateState({ classifyRulesText: '' })}
                                                                    title="清空规则"
                                                                >
                                                                    <X size={10} />
                                                                </button>
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {[...groupMap.entries()].map(([groupKey, group]) => (
                                                            <tr key={groupKey} style={{ borderBottom: '1px solid var(--border-color, #222)' }}>
                                                                <td style={{ padding: '3px 8px', color: 'var(--text-primary, #e0e0e0)', fontFamily: 'monospace', verticalAlign: 'top', lineHeight: '1.6' }}>
                                                                    {group.keywords.map((kw, i) => {
                                                                        const isAnd = kw.includes('+');
                                                                        const andParts = isAnd ? kw.split('+').map(p => p.trim()).filter(p => p) : [kw];
                                                                        return (
                                                                            <span key={i}>
                                                                                {i > 0 && <span style={{ color: 'var(--text-muted, #555)', margin: '0 3px', fontSize: '10px' }}>或</span>}
                                                                                {andParts.map((part, j) => (
                                                                                    <span key={j}>
                                                                                        {j > 0 && <span style={{ color: '#f97316', margin: '0 1px', fontSize: '9px', fontWeight: 600 }}>+</span>}
                                                                                        <span style={{ background: 'rgba(250, 204, 21, 0.1)', padding: '0 3px', borderRadius: '2px' }}>{part}</span>
                                                                                    </span>
                                                                                ))}
                                                                            </span>
                                                                        );
                                                                    })}
                                                                </td>
                                                                <td style={{ padding: '3px 8px', verticalAlign: 'top', color: 'var(--text-muted, #9aa0a6)', fontSize: '10px' }}>
                                                                    {group.main || '-'}
                                                                </td>
                                                                <td style={{ padding: '3px 8px', verticalAlign: 'top' }}>
                                                                    <span style={{
                                                                        padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 500,
                                                                        background: 'rgba(124, 58, 237, 0.15)', color: '#c4b5fd',
                                                                        border: '1px solid rgba(124, 58, 237, 0.3)',
                                                                    }}>
                                                                        {group.sub || '未分类'}
                                                                    </span>
                                                                </td>
                                                                <td style={{ padding: '2px', verticalAlign: 'top' }}>
                                                                    <button
                                                                        style={{ background: 'none', border: 'none', cursor: 'pointer', padding: '2px', color: 'var(--text-muted, #555)', opacity: 0.5 }}
                                                                        onMouseEnter={e => (e.currentTarget.style.opacity = '1')}
                                                                        onMouseLeave={e => (e.currentTarget.style.opacity = '0.5')}
                                                                        onClick={() => removeClassifyCategory(group.sub)}
                                                                        title={`删除分类「${group.main ? `${group.main} / ` : ''}${group.sub}」`}
                                                                    >
                                                                        <X size={10} />
                                                                    </button>
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                                {/* Hidden textarea for re-pasting */}
                                                <textarea
                                                    style={{ position: 'absolute', opacity: 0, height: 0, width: 0, overflow: 'hidden' }}
                                                    value={state.classifyRulesText}
                                                    onChange={e => updateState({ classifyRulesText: e.target.value })}
                                                    tabIndex={-1}
                                                />
                                            </div>
                                        );
                                    })()}
                                    {/* 内联添加规则 */}
                                    <div style={{ padding: '3px 6px', borderTop: '1px solid var(--border-color, #222)', flexShrink: 0, display: 'flex', gap: '4px', alignItems: 'center' }}>
                                        <input
                                            type="text"
                                            placeholder="关键词"
                                            value={state.classifyAddKeyword}
                                            onChange={e => updateState({ classifyAddKeyword: e.target.value })}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && state.classifyAddKeyword.trim() && state.classifyAddCategory.trim()) {
                                                    addKeywordToCategory(state.classifyAddKeyword.trim(), state.classifyAddCategory.trim());
                                                    updateState({ classifyAddKeyword: '' });
                                                }
                                            }}
                                            style={{ flex: 1, padding: '3px 6px', borderRadius: '3px', fontSize: '10px', border: '1px solid var(--border-color, #333)', background: 'var(--bg-primary, #111)', color: 'var(--text-primary, #e0e0e0)', outline: 'none', minWidth: 0 }}
                                        />
                                        <input
                                            type="text"
                                            placeholder="分类"
                                            value={state.classifyAddCategory}
                                            onChange={e => updateState({ classifyAddCategory: e.target.value })}
                                            list="classify-categories-datalist"
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && state.classifyAddKeyword.trim() && state.classifyAddCategory.trim()) {
                                                    addKeywordToCategory(state.classifyAddKeyword.trim(), state.classifyAddCategory.trim());
                                                    updateState({ classifyAddKeyword: '' });
                                                }
                                            }}
                                            style={{ width: '70px', padding: '3px 6px', borderRadius: '3px', fontSize: '10px', border: '1px solid var(--border-color, #333)', background: 'var(--bg-primary, #111)', color: 'var(--text-primary, #e0e0e0)', outline: 'none' }}
                                        />
                                        {/* Datalist for existing categories */}
                                        <datalist id="classify-categories-datalist">
                                            {[...new Set(parseClassifyRules(state.classifyRulesText).map(r => r.category))].map(cat => (
                                                <option key={cat} value={cat} />
                                            ))}
                                        </datalist>
                                        <button
                                            style={{ padding: '3px 6px', borderRadius: '3px', fontSize: '10px', border: 'none', background: 'rgba(124, 58, 237, 0.25)', color: '#c4b5fd', cursor: 'pointer', whiteSpace: 'nowrap', opacity: (state.classifyAddKeyword.trim() && state.classifyAddCategory.trim()) ? 1 : 0.4 }}
                                            disabled={!state.classifyAddKeyword.trim() || !state.classifyAddCategory.trim()}
                                            onClick={() => {
                                                if (state.classifyAddKeyword.trim() && state.classifyAddCategory.trim()) {
                                                    addKeywordToCategory(state.classifyAddKeyword.trim(), state.classifyAddCategory.trim());
                                                    updateState({ classifyAddKeyword: '' });
                                                }
                                            }}
                                        >
                                            <Plus size={10} />
                                        </button>
                                    </div>
                                </div>
                                {/* 右：文案输入 */}
                                <div style={{ flex: 2, position: 'relative', display: 'flex', flexDirection: 'column' }}>
                                    <textarea
                                        style={{ flex: 1, width: '100%', padding: '6px 10px', border: 'none', background: 'transparent', color: 'var(--text-primary, #e0e0e0)', fontSize: '11px', resize: 'none', boxSizing: 'border-box' }}
                                        placeholder="粘贴待分类文案（支持 1~2 列：中文/英文，支持 Google Sheets 格式）"
                                        value={state.classifyInputText}
                                        onChange={e => updateState({ classifyInputText: e.target.value, classifyResults: [] })}
                                    />
                                    {state.classifyInputText.trim() && (
                                        <div style={{ padding: '2px 10px', fontSize: '10px', color: 'var(--text-muted, #555)', borderTop: '1px solid var(--border-color, #222)', flexShrink: 0 }}>
                                            {parseClassifyInputRows(state.classifyInputText).length} 个单元格
                                        </div>
                                    )}
                                </div>
                            </div>
                        )}

                        {/* 分类标签筛选（分类后显示） */}
                        {state.classifyResults.length > 0 && (
                            <div style={{ display: 'flex', gap: '6px', padding: '6px 16px', borderBottom: '1px solid var(--border-color, #333)', flexWrap: 'wrap', alignItems: 'center', flexShrink: 0 }}>
                                {(() => {
                                    const cats = new Map<string, number>();
                                    state.classifyResults.filter(r => r.text).forEach(r => {
                                        cats.set(r.category, (cats.get(r.category) || 0) + 1);
                                    });
                                    return (
                                        <>
                                            <button
                                                className={`mode-tab ${state.classifyActiveCategories.size === 0 ? 'active' : ''}`}
                                                style={{ padding: '2px 8px', fontSize: '11px' }}
                                                onClick={() => updateState({ classifyActiveCategories: new Set<string>() })}
                                            >
                                                全部 ({state.classifyResults.filter(r => r.text).length})
                                            </button>
                                            {[...cats.entries()].map(([cat, count]) => {
                                                const isActive = state.classifyActiveCategories.has(cat);
                                                return (
                                                    <button
                                                        key={cat}
                                                        className={`mode-tab ${isActive ? 'active' : ''}`}
                                                        style={{ padding: '2px 8px', fontSize: '11px' }}
                                                        onClick={() => {
                                                            const next = new Set(state.classifyActiveCategories);
                                                            if (isActive) next.delete(cat); else next.add(cat);
                                                            updateState({ classifyActiveCategories: next });
                                                        }}
                                                    >
                                                        {cat} ({count})
                                                    </button>
                                                );
                                            })}
                                        </>
                                    );
                                })()}
                            </div>
                        )}

                        {/* 表格 - 粘贴即显示，分类后补上分类列 */}
                        {(() => {
                            const isClassified = state.classifyResults.length > 0;
                            let rows = isClassified
                                ? state.classifyResults.filter(r => state.classifyActiveCategories.size === 0 || state.classifyActiveCategories.has(r.category))
                                : (state.classifyInputText.trim()
                                    ? parseClassifyInputRows(state.classifyInputText).map((row) => ({
                                        rowIndex: row.rowIndex,
                                        text: row.text.trim(),
                                        zhText: row.zhText,
                                        enText: row.enText,
                                        category: '',
                                        mainCategory: '',
                                        subCategory: '',
                                        matchedKeyword: '',
                                        matchedKeywordLang: '',
                                    }))
                                    : []);

                            // Apply sorting
                            if (isClassified && state.classifySortBy === 'category') {
                                rows = [...rows].sort((a, b) => {
                                    if (a.category !== b.category) return a.category.localeCompare(b.category);
                                    return a.rowIndex - b.rowIndex;
                                });
                            }

                            if (rows.length === 0) {
                                return (
                                    <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted, #666)', fontSize: '13px', flexDirection: 'column', gap: '8px' }}>
                                        <Tag size={32} style={{ opacity: 0.3 }} />
                                        <span>粘贴文案列 → 立即显示清单 → 点击分类</span>
                                    </div>
                                );
                            }

                            return (
                                <div style={{ flex: 1, overflow: 'auto' }}>
                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                        <thead>
                                            <tr style={{ position: 'sticky', top: 0, background: 'var(--bg-secondary, #1a1a1a)', zIndex: 1 }}>
                                                <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-color, #333)', width: '40px', color: 'var(--text-muted, #888)' }}>#</th>
                                                <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-color, #333)', color: 'var(--text-muted, #888)' }}>文案</th>
                                                {isClassified && (
                                                    <>
                                                        <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-color, #333)', width: '110px', color: 'var(--text-muted, #888)' }}>分类</th>
                                                        <th style={{ padding: '6px 10px', textAlign: 'left', borderBottom: '1px solid var(--border-color, #333)', width: '110px', color: 'var(--text-muted, #888)' }}>命中关键词</th>
                                                    </>
                                                )}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {rows.map(r => (
                                                <tr key={r.rowIndex} style={{ borderBottom: '1px solid var(--border-color, #222)', opacity: r.text ? 1 : 0.3 }}>
                                                    <td style={{ padding: '5px 10px', color: 'var(--text-muted, #666)', fontFamily: 'monospace', fontSize: '11px' }}>{r.rowIndex + 1}</td>
                                                    <td onContextMenu={handleClassifyContextMenu} style={{ padding: '5px 10px', color: 'var(--text-primary, #e0e0e0)', maxWidth: '500px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', cursor: 'text' }}>
                                                        {r.text
                                                            ? (isClassified && r.matchedKeyword
                                                                ? highlightKeywordInText(r.text, r.matchedKeyword)
                                                                : r.text)
                                                            : <span style={{ fontStyle: 'italic', color: 'var(--text-muted, #555)' }}>（空）</span>}
                                                    </td>
                                                    {isClassified && (
                                                        <>
                                                            <td style={{ padding: '5px 10px' }}>
                                                                {r.category && (
                                                                    <span style={{
                                                                        padding: '2px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 500,
                                                                        background: r.category === '其他' ? 'rgba(255,255,255,0.05)' : 'rgba(124, 58, 237, 0.15)',
                                                                        color: r.category === '其他' ? 'var(--text-muted, #888)' : '#c4b5fd',
                                                                        border: `1px solid ${r.category === '其他' ? 'var(--border-color, #333)' : 'rgba(124, 58, 237, 0.3)'}`,
                                                                    }}>
                                                                        {r.mainCategory && r.subCategory && r.mainCategory !== r.subCategory
                                                                            ? `${r.mainCategory} / ${r.subCategory}`
                                                                            : (r.subCategory || r.category)}
                                                                    </span>
                                                                )}
                                                            </td>
                                                            <td style={{ padding: '5px 10px', color: 'var(--text-muted, #888)', fontFamily: 'monospace', fontSize: '11px' }}>
                                                                {r.matchedKeyword}
                                                                {r.matchedKeywordLang && (
                                                                    <span style={{ marginLeft: '6px', fontSize: '10px', opacity: 0.7 }}>
                                                                        ({r.matchedKeywordLang.toUpperCase()})
                                                                    </span>
                                                                )}
                                                            </td>
                                                        </>
                                                    )}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                            );
                        })()}

                        {/* 右键菜单：选中文字 → 设为关键词 */}
                        {state.classifyContextMenu && (
                            <>
                                {/* 背景遮罩 */}
                                <div
                                    style={{ position: 'fixed', inset: 0, zIndex: 999 }}
                                    onClick={closeClassifyContextMenu}
                                    onContextMenu={e => { e.preventDefault(); closeClassifyContextMenu(); }}
                                />
                                {/* 菜单 */}
                                <div style={{
                                    position: 'fixed',
                                    left: state.classifyContextMenu.x,
                                    top: state.classifyContextMenu.y,
                                    zIndex: 1000,
                                    background: 'var(--bg-secondary, #1e1e1e)',
                                    border: '1px solid var(--border-color, #444)',
                                    borderRadius: '8px',
                                    boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                                    minWidth: '200px',
                                    maxWidth: '280px',
                                    overflow: 'hidden',
                                    fontSize: '12px',
                                }}>
                                    {/* 标题 */}
                                    <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--border-color, #333)', color: 'var(--text-muted, #888)', fontSize: '11px' }}>
                                        添加关键词：<span style={{ color: '#fde68a', fontWeight: 600 }}>「{state.classifyContextMenu.selectedText}」</span>
                                    </div>
                                    {/* 已有分类列表 */}
                                    {(() => {
                                        const rules = parseClassifyRules(state.classifyRulesText);
                                        const categories = [...new Set(rules.map(r => r.category))];
                                        if (categories.length === 0) return null;
                                        return (
                                            <div style={{ maxHeight: '180px', overflow: 'auto' }}>
                                                {categories.map(cat => (
                                                    <div
                                                        key={cat}
                                                        style={{ padding: '6px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}
                                                        className="mode-tab-hover"
                                                        onMouseEnter={e => (e.currentTarget.style.background = 'rgba(124, 58, 237, 0.15)')}
                                                        onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                                        onClick={() => addKeywordToCategory(state.classifyContextMenu!.selectedText, cat)}
                                                    >
                                                        <span style={{
                                                            padding: '1px 6px', borderRadius: '3px', fontSize: '10px', fontWeight: 500,
                                                            background: 'rgba(124, 58, 237, 0.15)', color: '#c4b5fd',
                                                            border: '1px solid rgba(124, 58, 237, 0.3)',
                                                        }}>
                                                            {cat}
                                                        </span>
                                                        <span style={{ color: 'var(--text-muted, #666)', fontSize: '10px' }}>
                                                            ({rules.filter(r => r.category === cat).length} 个关键词)
                                                        </span>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()}
                                    {/* 新建分类 */}
                                    <div style={{ padding: '6px 12px', borderTop: '1px solid var(--border-color, #333)', display: 'flex', gap: '4px', alignItems: 'center' }}>
                                        <input
                                            type="text"
                                            placeholder="新分类名..."
                                            value={state.classifyNewCategoryInput}
                                            onChange={e => updateState({ classifyNewCategoryInput: e.target.value })}
                                            onKeyDown={e => {
                                                if (e.key === 'Enter' && state.classifyNewCategoryInput.trim()) {
                                                    addKeywordToCategory(state.classifyContextMenu!.selectedText, state.classifyNewCategoryInput.trim());
                                                }
                                            }}
                                            autoFocus
                                            style={{
                                                flex: 1, padding: '4px 8px', borderRadius: '4px', fontSize: '11px',
                                                border: '1px solid var(--border-color, #444)', background: 'var(--bg-primary, #111)',
                                                color: 'var(--text-primary, #e0e0e0)', outline: 'none',
                                            }}
                                        />
                                        <button
                                            style={{
                                                padding: '4px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 500,
                                                border: 'none', background: 'rgba(124, 58, 237, 0.3)', color: '#c4b5fd',
                                                cursor: 'pointer', whiteSpace: 'nowrap',
                                            }}
                                            disabled={!state.classifyNewCategoryInput.trim()}
                                            onClick={() => {
                                                if (state.classifyNewCategoryInput.trim()) {
                                                    addKeywordToCategory(state.classifyContextMenu!.selectedText, state.classifyNewCategoryInput.trim());
                                                }
                                            }}
                                        >
                                            <Plus size={10} /> 新建
                                        </button>
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                ) : state.mode === 'search' ? (
                    /* 搜索结果 - 分组显示 */
                    <div className="pro-dedup-results search-results">
                        {state.searchGroups.length > 0 ? (
                            <>
                                <div className="results-toolbar">
                                    <div className="toolbar-stats">
                                        <div className="stat-pill">
                                            <span className="stat-val">{state.searchGroups.length}</span>
                                            <span className="stat-lbl">组</span>
                                        </div>
                                        <div className="stat-pill success">
                                            <span className="stat-val">{state.searchGroups.reduce((sum, g) => sum + g.matches.length, 0)}</span>
                                            <span className="stat-lbl">相似</span>
                                        </div>
                                        <div className="stat-pill">
                                            <span className="stat-val">{state.selectedSearchItems.size}</span>
                                            <span className="stat-lbl">已选</span>
                                        </div>
                                    </div>
                                    <div className="toolbar-actions">
                                        <button
                                            className="toolbar-btn"
                                            onClick={() => {
                                                const newSet = new Set<string>();
                                                state.searchGroups.forEach((g, gi) => {
                                                    g.matches.forEach((_, mi) => newSet.add(`${gi}-${mi}`));
                                                });
                                                updateState({ selectedSearchItems: newSet });
                                            }}
                                        >
                                            全选
                                        </button>
                                        <button
                                            className="toolbar-btn"
                                            onClick={() => {
                                                const newSet = new Set<string>();
                                                state.searchGroups.forEach((g, gi) => {
                                                    g.matches.forEach((_, mi) => {
                                                        const key = `${gi}-${mi}`;
                                                        if (!state.selectedSearchItems.has(key)) newSet.add(key);
                                                    });
                                                });
                                                updateState({ selectedSearchItems: newSet });
                                            }}
                                        >
                                            反选
                                        </button>
                                        <button
                                            className="toolbar-btn"
                                            onClick={() => updateState({ selectedSearchItems: new Set() })}
                                        >
                                            取消
                                        </button>
                                        <button
                                            className="toolbar-btn success"
                                            onClick={copySelectedSearchItems}
                                            disabled={state.selectedSearchItems.size === 0}
                                        >
                                            <Copy size={12} /> 复制选中
                                        </button>
                                    </div>
                                </div>
                                <div className="search-groups">
                                    {state.searchGroups.map((group, gi) => {
                                        // 计算该行选中的数量
                                        const selectedInGroup = group.matches.filter((_, mi) =>
                                            state.selectedSearchItems.has(`${gi}-${mi}`)
                                        ).length;

                                        // 行操作函数
                                        const selectAllInGroup = () => {
                                            const newSet = new Set(state.selectedSearchItems);
                                            group.matches.forEach((_, mi) => newSet.add(`${gi}-${mi}`));
                                            updateState({ selectedSearchItems: newSet });
                                        };
                                        const invertInGroup = () => {
                                            const newSet = new Set(state.selectedSearchItems);
                                            group.matches.forEach((_, mi) => {
                                                const key = `${gi}-${mi}`;
                                                if (newSet.has(key)) newSet.delete(key);
                                                else newSet.add(key);
                                            });
                                            updateState({ selectedSearchItems: newSet });
                                        };
                                        const cancelInGroup = () => {
                                            const newSet = new Set(state.selectedSearchItems);
                                            group.matches.forEach((_, mi) => newSet.delete(`${gi}-${mi}`));
                                            updateState({ selectedSearchItems: newSet });
                                        };
                                        const copyGroup = () => {
                                            const escapeForSheet = (text: string): string => {
                                                if (!text) return '';
                                                if (text.includes('\t') || text.includes('\n') || text.includes('"')) {
                                                    return `"${text.replace(/"/g, '""')}"`;
                                                }
                                                return text;
                                            };
                                            const texts = group.matches
                                                .filter((_, mi) => state.selectedSearchItems.has(`${gi}-${mi}`))
                                                .map(m => `${escapeForSheet(m.text)}\t${escapeForSheet(m.chineseText || '')}`);
                                            if (texts.length === 0) {
                                                showToast('请先选择要复制的文案');
                                                return;
                                            }
                                            navigator.clipboard.writeText(texts.join('\n'));
                                            showToast(`已复制 ${texts.length} 条`);
                                        };
                                        const referenceText = group.matches[0]?.text || '';
                                        const queryDisplay = referenceText
                                            ? highlightSimilarWords(group.query, referenceText)
                                            : group.query;

                                        return (
                                            <div key={gi} className="search-group">
                                                {/* 行操作按钮 - 在顶部 */}
                                                {group.matches.length > 0 && (
                                                    <div className="search-group-toolbar">
                                                        <button onClick={selectAllInGroup} className="tooltip-bottom" data-tip="全选">全选</button>
                                                        <button onClick={invertInGroup} className="tooltip-bottom" data-tip="反选">反选</button>
                                                        <button onClick={cancelInGroup} className="tooltip-bottom" data-tip="取消">取消</button>
                                                        <button onClick={copyGroup} className="tooltip-bottom" data-tip="复制选中"><Copy size={12} /> 复制选中</button>
                                                        <span className="group-count">已选 {selectedInGroup} / {group.matches.length}</span>
                                                    </div>
                                                )}
                                                <div className="similar-group-row search-group-row">
                                                    <div className="similar-item keep">
                                                        <div className="similar-item-text">{queryDisplay}</div>
                                                        {group.queryChinese && (
                                                            <div className="similar-item-chinese">{group.queryChinese}</div>
                                                        )}
                                                        <div className="similar-item-badge">输入</div>
                                                    </div>
                                                    {group.matches.length > 0 ? (
                                                        group.matches.map((match, mi) => {
                                                            const key = `${gi}-${mi}`;
                                                            const isSelected = state.selectedSearchItems.has(key);
                                                            return (
                                                                <div
                                                                    key={mi}
                                                                    className={`similar-item dup ${isSelected ? 'selected' : ''}`}
                                                                    onClick={() => toggleSearchItem(key)}
                                                                >
                                                                    <div className="similar-item-actions">
                                                                        <span className="sim-checkbox">
                                                                            {isSelected ? <Check size={10} /> : null}
                                                                        </span>
                                                                        <span className="sim-percent">{Math.round(match.similarity * 100)}%</span>
                                                                        <span className={`sim-source ${match.source}`}>
                                                                            {match.source === 'batch' ? '本批次' : match.category || '库'}
                                                                        </span>
                                                                    </div>
                                                                    <div className="similar-item-text">
                                                                        {highlightSimilarWords(match.text, group.query)}
                                                                    </div>
                                                                    {match.chineseText && (
                                                                        <div className="similar-item-chinese">{match.chineseText}</div>
                                                                    )}
                                                                </div>
                                                            );
                                                        })
                                                    ) : (
                                                        <div className="similar-item dup no-similar-item">
                                                            <span className="no-similar">无相似</span>
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </>
                        ) : (
                            <div className="empty-state">
                                <Search size={48} />
                                <p>输入文案，从库中搜索相似的</p>
                                <p className="hint">支持多条，每行一条；找到的可选择复制使用</p>
                            </div>
                        )}
                    </div>
                ) : state.result ? (
                    <div className="pro-dedup-results">
                        {/* 工具栏 + 统计 */}
                        <div className="results-toolbar">
                            <div className="toolbar-stats">
                                <div className="stat-pill">
                                    <span className="stat-val">{state.result.stats.totalInput}</span>
                                    <span className="stat-lbl">输入</span>
                                </div>
                                <div className="stat-pill success">
                                    <span className="stat-val">{state.result.stats.uniqueCount}</span>
                                    <span className="stat-lbl">独特</span>
                                </div>
                                <div className="stat-pill warning">
                                    <span className="stat-val">{state.result.duplicateGroups.length}</span>
                                    <span className="stat-lbl">相似组</span>
                                </div>
                                <div className="stat-pill danger">
                                    <span className="stat-val">{state.result.stats.libraryMatchCount}</span>
                                    <span className="stat-lbl">已有</span>
                                </div>
                                <div className="stat-pill info">
                                    <span className="stat-val">{state.result.stats.processingTimeMs}ms</span>
                                </div>
                            </div>
                            <div className="toolbar-actions">
                                <button className="toolbar-btn" onClick={exportAsTable}>
                                    <Copy size={12} /> 复制全部
                                </button>
                                <button className="toolbar-btn" onClick={exportUniqueOnly}>
                                    <Copy size={12} /> 只复制独特
                                </button>
                                <button
                                    className={`toolbar-btn ${sheetSaveStatus === 'success' ? 'success' : sheetSaveStatus === 'error' ? 'danger' : ''}`}
                                    onClick={handleSaveToSheet}
                                    disabled={sheetSaveStatus === 'saving'}
                                    title={sheetSaveStatus === 'error' ? sheetSaveError : '保存到 Google Sheets'}
                                >
                                    {sheetSaveStatus === 'saving' ? <Loader2 size={12} className="spinning" /> : <FileCode size={12} />}
                                    {sheetSaveStatus === 'saving' ? '...' : sheetSaveStatus === 'success' ? '✓' : '表格'}
                                </button>

                                {state.isSheetConnected && state.categories.length > 0 ? (
                                    <>
                                        <select
                                            className="toolbar-select"
                                            value={state.selectedCategory || ''}
                                            onChange={e => updateState({ selectedCategory: e.target.value || null })}
                                        >
                                            <option value="">选择分类...</option>
                                            {state.categories.map(cat => (
                                                <option key={cat} value={cat}>{cat}</option>
                                            ))}
                                        </select>
                                        <button
                                            className="toolbar-btn success"
                                            onClick={() => state.selectedCategory && addToCategory(state.selectedCategory)}
                                            disabled={!state.selectedCategory || isAddingToCategory}
                                        >
                                            <FolderPlus size={12} /> {isAddingToCategory ? '入库中...' : '入库'}
                                        </button>
                                    </>
                                ) : (
                                    <button className="toolbar-btn success" onClick={handleAddToLibrary}>
                                        <Database size={12} /> 入库
                                    </button>
                                )}
                            </div>
                        </div>

                        {/* 结果表格 */}
                        <div className="pro-results-table-wrap">
                            <table className="pro-results-table">
                                <thead>
                                    <tr>
                                        <th className="th-status">状态</th>
                                        <th>保留的文案</th>
                                        <th>相似文案</th>
                                        <th className="th-actions">操作</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {/* 相似组（排在最前面） */}
                                    {state.result.duplicateGroups.map((group, groupIdx) => (
                                        <tr key={`group-${groupIdx}`} className="row-similar">
                                            <td>
                                                <div className="status-with-delete">
                                                    <span className="badge badge-similar">{group.duplicates.length + 1}条</span>
                                                    <button
                                                        className="action-btn danger tooltip-bottom"
                                                        onClick={() => deleteGroup(groupIdx)}
                                                        data-tip="删除整组"
                                                    >
                                                        <Trash2 size={11} />
                                                    </button>
                                                </div>
                                            </td>
                                            <td colSpan={3}>
                                                <div className="similar-group-row">
                                                    {/* 保留的文案（第一个） */}
                                                    <div
                                                        className="similar-item keep"
                                                        onContextMenu={(e) => handleContextMenu(
                                                            e, 'keep', groupIdx,
                                                            group.representative.text,
                                                            group.representative.chineseText
                                                        )}
                                                    >
                                                        <div className="similar-item-text">
                                                            {highlightSimilarWords(group.representative.text, group.duplicates[0]?.item.text || '')}
                                                        </div>
                                                        {group.representative.chineseText && (
                                                            <div className="similar-item-chinese">{group.representative.chineseText}</div>
                                                        )}
                                                        <div className="similar-item-badge">保留</div>
                                                    </div>

                                                    {/* 相似文案（后面的列） */}
                                                    {group.duplicates.map((dup, dupIdx) => (
                                                        <div
                                                            key={dupIdx}
                                                            className="similar-item dup"
                                                            onContextMenu={(e) => handleContextMenu(
                                                                e, 'dup', groupIdx,
                                                                dup.item.text,
                                                                dup.item.chineseText,
                                                                dupIdx
                                                            )}
                                                        >
                                                            <div
                                                                className="similar-item-text tooltip-bottom"
                                                                onDoubleClick={() => swapRepresentative(groupIdx, dupIdx)}
                                                                data-tip="双击设为保留"
                                                            >
                                                                {highlightSimilarWords(dup.item.text, group.representative.text)}
                                                            </div>
                                                            {dup.item.chineseText && (
                                                                <div className="similar-item-chinese">{dup.item.chineseText}</div>
                                                            )}
                                                            <div className="similar-item-actions">
                                                                <span className="sim-pct">{Math.round(dup.similarity * 100)}%</span>
                                                                <button
                                                                    className="action-btn success tooltip-bottom"
                                                                    onClick={() => markAsUnique(groupIdx, dupIdx)}
                                                                    data-tip="标为不重复"
                                                                >
                                                                    <Check size={10} />
                                                                </button>
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            </td>
                                        </tr>
                                    ))}

                                    {/* 库中已存在 */}
                                    {state.result.libraryMatches.map((match, i) => (
                                        <tr key={`lib-${i}`} className="row-exists">
                                            <td>
                                                <div className="badge-stack">
                                                    <span className="badge badge-exists">已有 {match.matchCount}条</span>
                                                    <button
                                                        className="action-btn view-similar-btn tooltip-bottom"
                                                        onClick={() => viewSimilarInLibrary(match.newItem.text)}
                                                        data-tip="查看库中所有相似文案"
                                                    >
                                                        <Search size={11} />
                                                    </button>
                                                </div>
                                            </td>
                                            <td>
                                                <div className="cell-text">{match.newItem.text}</div>
                                                {match.newItem.chineseText && (
                                                    <div className="cell-chinese">{match.newItem.chineseText}</div>
                                                )}
                                            </td>
                                            <td>
                                                <div className="match-info">
                                                    <span className="match-label">库中:</span>
                                                    <span className="match-text">{match.libraryItem.text.slice(0, 50)}...</span>
                                                    <span className="sim-pct">{Math.round(match.similarity * 100)}%</span>
                                                </div>
                                            </td>
                                            <td></td>
                                        </tr>
                                    ))}

                                    {/* 独特文案（排在最后） */}
                                    {state.result.uniqueItems.slice(0, 100).map((item, i) => {
                                        const isManuallyMarked = state.manuallyMarkedUnique.has(item.id);
                                        const isSelected = state.selectedForMerge === item.id;

                                        return (
                                            <tr
                                                key={`unique-${i}`}
                                                className={`${isManuallyMarked ? 'row-manual' : 'row-unique'} ${isSelected ? 'row-selected' : ''}`}
                                            >
                                                <td>
                                                    <span className={`badge ${isManuallyMarked ? 'badge-manual' : 'badge-unique'}`}>
                                                        {isManuallyMarked ? '人工' : '独特'}
                                                    </span>
                                                </td>
                                                <td>
                                                    <div className="cell-text">{item.text}</div>
                                                    {item.chineseText && <div className="cell-chinese">{item.chineseText}</div>}
                                                </td>
                                                <td></td>
                                                <td>
                                                    <button
                                                        className={`action-btn ${isSelected ? 'active' : ''} tooltip-bottom`}
                                                        onClick={() => markAsDuplicate(i)}
                                                        data-tip="标记为重复"
                                                    >
                                                        <Link size={11} />
                                                    </button>
                                                </td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                    </div>
                ) : (
                    <div className="pro-dedup-empty">
                        <Zap size={48} />
                        <h3>专业文案查重搜索工具</h3>
                        <p>MinHash + LSH 算法 · 毫秒级处理 · 支持中英文</p>
                        <p className="pro-dedup-hint">粘贴文案开始查重或搜索</p>
                    </div>
                )
                }
            </main >

            {/* 设置弹窗 */}
            {
                state.showSettings && (
                    <div className="pro-modal-overlay" onClick={() => updateState({ showSettings: false })}>
                        <div className="pro-modal" onClick={e => e.stopPropagation()}>
                            <div className="pro-modal-header">
                                <h3>查重设置</h3>
                                <button onClick={() => updateState({ showSettings: false })}><X size={16} /></button>
                            </div>
                            <div className="pro-modal-body">
                                <label>
                                    <span>相似度阈值: {Math.round(state.threshold * 100)}%</span>
                                    <input
                                        type="range"
                                        min="0.3"
                                        max="0.8"
                                        step="0.05"
                                        value={state.threshold}
                                        onChange={e => updateState({ threshold: parseFloat(e.target.value) })}
                                    />
                                </label>
                            </div>
                            <div className="pro-modal-footer">
                                <button onClick={() => updateState({ showSettings: false })}>确定</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* 右键菜单 */}
            {
                contextMenu && (
                    <>
                        <div className="context-menu-overlay" onClick={closeContextMenu} />
                        <div
                            className="context-menu"
                            style={{ left: contextMenu.x, top: contextMenu.y }}
                        >
                            <button onClick={handleContextCopy}>
                                <Copy size={12} /> 复制文案
                            </button>
                            {contextMenu.type === 'dup' && (
                                <button onClick={handleContextMarkUnique}>
                                    <Check size={12} /> 保留为独特
                                </button>
                            )}
                            <button className="danger" onClick={handleContextDelete}>
                                <Trash2 size={12} /> {contextMenu.type === 'keep' ? '删除整组' : '移除此项'}
                            </button>
                        </div>
                    </>
                )
            }

            {/* 编辑分类弹框 */}
            {
                editCategoryModal && (
                    <div className="pro-modal-overlay" onClick={() => setEditCategoryModal(null)}>
                        <div className="pro-modal" onClick={e => e.stopPropagation()}>
                            <div className="pro-modal-header">
                                <h3>{editCategoryModal.type === 'create' ? '新建分类' : '重命名分类'}</h3>
                                <button onClick={() => setEditCategoryModal(null)}><X size={16} /></button>
                            </div>
                            <div className="pro-modal-body">
                                <input
                                    type="text"
                                    value={editCategoryModal.newName}
                                    onChange={(e) => setEditCategoryModal({ ...editCategoryModal, newName: e.target.value })}
                                    placeholder="请输入分类名称"
                                    autoFocus
                                    onKeyDown={(e) => e.key === 'Enter' && confirmEditCategory()}
                                />
                            </div>
                            <div className="pro-modal-footer">
                                <button onClick={() => setEditCategoryModal(null)} disabled={isSubmitting}>取消</button>
                                <button
                                    className="btn btn-primary"
                                    onClick={confirmEditCategory}
                                    disabled={isSubmitting || !editCategoryModal.newName.trim()}
                                >
                                    {isSubmitting ? (editCategoryModal.type === 'create' ? '创建中...' : '重命名中...') : '确定'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* GAS 部署指南弹窗 */}
            {
                showGasGuide && (
                    <div className="gas-guide-overlay" onClick={() => setShowGasGuide(false)}>
                        <div className="gas-guide-modal" onClick={e => e.stopPropagation()}>
                            <div className="gas-guide-header">
                                <h3 className="gas-guide-title">📖 GAS (Google Apps Script) 部署指南</h3>
                                <button onClick={() => setShowGasGuide(false)} className="gas-guide-close-btn"><X size={16} /></button>
                            </div>
                            <div className="gas-guide-content">
                                <div className="gas-advantage-box">
                                    <strong className="gas-advantage-label">✅ GAS 优势：</strong>
                                    <span className="gas-advantage-text">无需复杂认证配置，支持读写，适合个人使用</span>
                                </div>

                                <h4 className="gas-section-title">🔧 部署步骤</h4>
                                <ol className="gas-steps-list">
                                    <li className="mb-2">在 Google Sheets 中点击 <code className="gas-code-highlight">扩展程序</code> → <code className="gas-code-highlight">Apps Script</code></li>
                                    <li className="mb-2">删除默认代码，<strong className="text-white">粘贴下方脚本代码</strong></li>
                                    <li className="mb-2">点击 <code className="gas-code-highlight">部署</code> → <code className="gas-code-highlight">新建部署</code> → <code className="gas-code-highlight">Web 应用</code></li>
                                    <li className="mb-2"><span className="gas-warning-text">⚠️ 「谁可以访问」必须选择「任何人」</span></li>
                                    <li className="mb-2">首次需授权：高级 → 转至 xxx → 允许</li>
                                    <li>复制 Web App URL，粘贴到上方输入框</li>
                                </ol>

                                <h4 className="gas-section-title gas-section-title-flex">
                                    📋 GAS 脚本代码
                                    <button
                                        onClick={() => {
                                            const code = `/**
 * ITEN 文本库 GAS 服务 - 精简版
 * 部署为 Web App 后，将 URL 粘贴到文案查重中使用
 */

function doGet(e) {
  try {
    const action = e.parameter.action || 'read';
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let result;
    
    if (action === 'list') {
      result = { success: true, data: { sheets: ss.getSheets().map(s => ({ name: s.getName(), rowCount: s.getLastRow() })) } };
    } else if (action === 'info') {
      result = { success: true, data: { id: ss.getId(), name: ss.getName(), sheets: ss.getSheets().map(s => s.getName()) } };
    } else {
      const sheetName = e.parameter.sheetName;
      const sheet = sheetName ? ss.getSheetByName(sheetName) : ss.getSheets()[0];
      if (!sheet) return ContentService.createTextOutput(JSON.stringify({ success: false, error: '找不到工作表' })).setMimeType(ContentService.MimeType.JSON);
      const values = sheet.getDataRange().getValues();
      const headers = values[0] || [];
      const rows = values.slice(1).map((row, idx) => {
        const obj = { _rowIndex: idx + 2 };
        headers.forEach((h, i) => obj[h] = row[i]);
        return obj;
      });
      result = { success: true, data: { headers, rows } };
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: e.message })).setMimeType(ContentService.MimeType.JSON);
  }
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const action = data.action;
    let result;
    
    if (action === 'append') {
      let sheet = ss.getSheetByName(data.sheetName);
      if (!sheet) sheet = ss.insertSheet(data.sheetName);
      const lastRow = sheet.getLastRow();
      if (data.values && data.values.length > 0) {
        sheet.getRange(lastRow + 1, 1, data.values.length, data.values[0].length).setValues(data.values);
      }
      result = { success: true, message: '已追加 ' + data.values.length + ' 行' };
    } else if (action === 'createSheet') {
      if (ss.getSheetByName(data.sheetName)) return ContentService.createTextOutput(JSON.stringify({ success: false, error: '已存在' })).setMimeType(ContentService.MimeType.JSON);
      const sheet = ss.insertSheet(data.sheetName);
      if (data.headers) sheet.getRange(1, 1, 1, data.headers.length).setValues([data.headers]);
      result = { success: true, message: '已创建' };
    } else if (action === 'renameSheet') {
      const sheet = ss.getSheetByName(data.oldName);
      if (!sheet) return ContentService.createTextOutput(JSON.stringify({ success: false, error: '找不到' })).setMimeType(ContentService.MimeType.JSON);
      sheet.setName(data.newName);
      result = { success: true, message: '已重命名' };
    } else if (action === 'deleteSheet') {
      const sheet = ss.getSheetByName(data.sheetName);
      if (sheet && ss.getSheets().length > 1) ss.deleteSheet(sheet);
      result = { success: true, message: '已删除' };
    } else if (action === 'deleteRows') {
      const sheet = ss.getSheetByName(data.sheetName);
      if (sheet && data.rowIndexes) {
        data.rowIndexes.sort((a,b) => b-a).forEach(idx => { if (idx > 0) sheet.deleteRow(idx); });
      }
      result = { success: true, message: '已删除行' };
    } else {
      result = { success: false, error: '未知操作' };
    }
    return ContentService.createTextOutput(JSON.stringify(result)).setMimeType(ContentService.MimeType.JSON);
  } catch (e) {
    return ContentService.createTextOutput(JSON.stringify({ success: false, error: e.message })).setMimeType(ContentService.MimeType.JSON);
  }
}`;
                                            navigator.clipboard.writeText(code);
                                            showToast('✅ 脚本代码已复制到剪贴板！');
                                        }}
                                        className="gas-copy-btn"
                                    >
                                        复制代码
                                    </button>
                                </h4>
                                <pre className="gas-code-block">
                                    {`/**
 * ITEN 文本库 GAS 服务 - 精简版
 */
function doGet(e) {
  const action = e.parameter.action || 'read';
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  if (action === 'list') {
    return ContentService.createTextOutput(JSON.stringify({ 
      success: true, 
      data: { sheets: ss.getSheets().map(s => ({ name: s.getName() })) } 
    })).setMimeType(ContentService.MimeType.JSON);
  } else if (action === 'info') {
    return ContentService.createTextOutput(JSON.stringify({ 
      success: true, 
      data: { name: ss.getName(), sheets: ss.getSheets().map(s => s.getName()) } 
    })).setMimeType(ContentService.MimeType.JSON);
  }
  // ... 点击复制获取完整代码
}`}
                                </pre>

                                <div className="gas-warning-box">
                                    ⚠️ 点击「复制代码」获取完整脚本，上方仅显示部分代码
                                </div>
                            </div>
                            <div className="pro-modal-footer">
                                <button onClick={() => setShowGasGuide(false)}>关闭</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* 删除确认弹框 */}
            {
                deleteConfirmModal && (
                    <div className="pro-modal-overlay" onClick={() => setDeleteConfirmModal(null)}>
                        <div className="pro-modal" onClick={e => e.stopPropagation()}>
                            <div className="pro-modal-header">
                                <h3>确认删除</h3>
                                <button onClick={() => setDeleteConfirmModal(null)}><X size={16} /></button>
                            </div>
                            <div className="pro-modal-body">
                                <p className="m-0">确定删除分类 "<strong>{deleteConfirmModal}</strong>"？此操作不可恢复！</p>
                            </div>
                            <div className="pro-modal-footer">
                                <button onClick={() => setDeleteConfirmModal(null)}>取消</button>
                                <button className="danger" onClick={confirmDeleteCategory}>删除</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* 相似文案弹框 */}
            {
                similarModal && (
                    <div className="pro-modal-overlay" onClick={() => setSimilarModal(null)}>
                        <div className="pro-modal similar-modal" onClick={e => e.stopPropagation()}>
                            <div className="pro-modal-header">
                                <span>库中相似文案 ({similarModal.matches.length} 条)</span>
                                <button onClick={() => setSimilarModal(null)}>×</button>
                            </div>
                            <div className="pro-modal-body">
                                <div className="similar-query">
                                    <span className="query-label">查询:</span>
                                    <span className="query-text">{similarModal.queryText.slice(0, 100)}...</span>
                                </div>
                                <div className="similar-grid">
                                    {similarModal.matches.map((m, i) => (
                                        <div
                                            key={i}
                                            className={`similar-grid-item ${similarModal.selected.has(i) ? 'selected' : ''}`}
                                            onClick={() => {
                                                setSimilarModal(prev => {
                                                    if (!prev) return null;
                                                    const newSet = new Set(prev.selected);
                                                    if (newSet.has(i)) {
                                                        newSet.delete(i);
                                                    } else {
                                                        newSet.add(i);
                                                    }
                                                    return { ...prev, selected: newSet };
                                                });
                                            }}
                                        >
                                            <div className="grid-checkbox">
                                                {similarModal.selected.has(i) ? <Check size={12} /> : null}
                                            </div>
                                            <div className="grid-english">{highlightSimilarWords(m.text, similarModal.queryText)}</div>
                                            <div className="grid-chinese">{m.chineseText || '-'}</div>
                                            <div className="grid-sim">{Math.round(m.similarity * 100)}%</div>
                                        </div>
                                    ))}
                                </div>
                            </div>
                            <div className="pro-modal-footer">
                                <button onClick={() => {
                                    // 全选
                                    setSimilarModal(prev => prev ? {
                                        ...prev,
                                        selected: new Set(prev.matches.map((_, i) => i))
                                    } : null);
                                }}>
                                    全选
                                </button>
                                <button onClick={() => {
                                    // 反选
                                    setSimilarModal(prev => prev ? {
                                        ...prev,
                                        selected: new Set(prev.matches.map((_, i) => i).filter(i => !prev.selected.has(i)))
                                    } : null);
                                }}>
                                    反选
                                </button>
                                <button onClick={() => {
                                    // 取消
                                    setSimilarModal(prev => prev ? { ...prev, selected: new Set() } : null);
                                }}>
                                    取消
                                </button>
                                <span className="select-count">已选 {similarModal.selected.size} / {similarModal.matches.length}</span>
                                <button
                                    onClick={() => {
                                        // 转义函数
                                        const esc = (t: string) => {
                                            if (!t) return '';
                                            if (t.includes('\t') || t.includes('\n') || t.includes('"')) {
                                                return `"${t.replace(/"/g, '""')}"`;
                                            }
                                            return t;
                                        };
                                        // 复制选中的文案
                                        const selected = similarModal.matches.filter((_, i) => similarModal.selected.has(i));
                                        if (selected.length === 0) {
                                            showToast('请先选择要复制的文案');
                                            return;
                                        }
                                        const text = selected.map(m => `${esc(m.text)}\t${esc(m.chineseText || '')}`).join('\n');
                                        navigator.clipboard.writeText(text);
                                        showToast(`已复制 ${selected.length} 条文案（可粘贴到表格）`);
                                    }}
                                    disabled={similarModal.selected.size === 0}
                                >
                                    <Copy size={12} /> 复制选中
                                </button>
                                <button onClick={() => {
                                    // 转义函数
                                    const esc = (t: string) => {
                                        if (!t) return '';
                                        if (t.includes('\t') || t.includes('\n') || t.includes('"')) {
                                            return `"${t.replace(/"/g, '""')}"`;
                                        }
                                        return t;
                                    };
                                    // 复制全部
                                    const text = similarModal.matches.map(m => `${esc(m.text)}\t${esc(m.chineseText || '')}`).join('\n');
                                    navigator.clipboard.writeText(text);
                                    showToast('已复制所有相似文案（可粘贴到表格）');
                                }}>
                                    复制全部
                                </button>
                                <button onClick={() => setSimilarModal(null)}>关闭</button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* 系统指令查看/编辑 Modal */}
            {state.aiClassifyShowSystemPrompt && (
                <div className="modal-overlay" onClick={() => updateState({ aiClassifyShowSystemPrompt: false })}>
                    <div className="modal-content" style={{ width: '80vw', maxWidth: 900, maxHeight: '85vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12, flexShrink: 0 }}>
                            <h3 style={{ margin: 0, fontSize: 15 }}>
                                系统指令 {state.aiClassifySystemPromptEdit ? <span style={{ color: '#f59e0b', fontSize: 12 }}>（已自定义）</span> : <span style={{ color: '#888', fontSize: 12 }}>（默认）</span>}
                            </h3>
                            <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                                <span style={{ fontSize: 12, color: '#888' }}>
                                    {(state.aiClassifySystemPromptEdit || CLASSIFY_SYSTEM_PROMPT).length.toLocaleString()} 字符
                                </span>
                                {state.aiClassifySystemPromptEdit && (
                                    <button
                                        className="topbar-btn"
                                        style={{ fontSize: 12, padding: '2px 8px' }}
                                        onClick={() => {
                                            updateState({ aiClassifySystemPromptEdit: '' });
                                            showToast('已恢复默认指令');
                                        }}
                                    >
                                        恢复默认
                                    </button>
                                )}
                                <button
                                    className="topbar-btn"
                                    style={{ fontSize: 12, padding: '2px 8px' }}
                                    onClick={() => {
                                        navigator.clipboard.writeText(state.aiClassifySystemPromptEdit || CLASSIFY_SYSTEM_PROMPT);
                                        showToast('已复制指令内容');
                                    }}
                                >
                                    <Copy size={12} /> 复制
                                </button>
                                <button onClick={() => updateState({ aiClassifyShowSystemPrompt: false })} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#888', padding: 4 }}>
                                    <X size={16} />
                                </button>
                            </div>
                        </div>
                        <textarea
                            value={state.aiClassifySystemPromptEdit || CLASSIFY_SYSTEM_PROMPT}
                            onChange={e => updateState({ aiClassifySystemPromptEdit: e.target.value })}
                            style={{
                                flex: 1,
                                width: '100%',
                                minHeight: 400,
                                fontFamily: 'ui-monospace, "SF Mono", Menlo, Monaco, monospace',
                                fontSize: 12.5,
                                lineHeight: 1.6,
                                padding: 12,
                                border: '1px solid rgba(255,255,255,0.15)',
                                borderRadius: 6,
                                background: 'rgba(0,0,0,0.3)',
                                color: '#e2e8f0',
                                resize: 'vertical',
                                whiteSpace: 'pre-wrap',
                                wordBreak: 'break-all',
                            }}
                            spellCheck={false}
                        />
                        <div style={{ marginTop: 8, fontSize: 12, color: '#888', flexShrink: 0 }}>
                            💡 编辑后保存在当前会话。修改默认指令：编辑清空后自动恢复默认。刷新页面会重置为默认。
                        </div>
                    </div>
                </div>
            )}

            {/* Toast — 通过 portal 渲染到 body，避免父容器 transform 影响定位 */}
            {toast && createPortal(<div className="pro-toast">{toast}</div>, document.body)}
        </div >
    );
}

export default ProDedupApp;
