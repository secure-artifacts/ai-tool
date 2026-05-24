/**
 * 专业文案查重搜索工具（英文专用）
 * - 粘贴表格数据 → 表格显示
 * - 多搜索项，每项可独立高亮颜色
 * - MinHash + LSH 算法（纯本地，毫秒级，零 API 成本）
 * - 高亮结果可连同颜色信息复制回 Excel/Sheets
 * - 备注列与搜索项挂钩
 */
import React, { useState, useRef, useCallback, useMemo, useEffect } from 'react';
import { v4 as uuidv4 } from 'uuid';
import {
    Search, Plus, Trash2, Copy, Download, Upload, Loader2,
    Palette, MessageSquare, X, ChevronDown, ChevronUp, Check,
    RotateCcw, Settings2, Eye, EyeOff, Columns, AlertCircle,
    Sparkles, Bot, Brain, Languages,
} from 'lucide-react';
import { localEmbeddingService, embeddingDB } from '../ai-copy-deduplicator/services/localEmbeddingService';

// ===== 类型 =====
interface CellData {
    value: string;
    highlights: HighlightMark[]; // 当前命中的搜索项
    note: string;                // 备注
}

interface HighlightMark {
    queryId: string;
    color: string;
    similarity: number;
    queryText: string;
}

interface SearchQuery {
    id: string;
    text: string;
    noteText: string;        // 备注文字（与搜索项挂钩）
    color: string;
    enabled: boolean;
    isSearching: boolean;
    resultCount: number;
    searchDone?: boolean;    // 搜索是否已完成（用于 UI 状态标记）
    useAi?: boolean;         // 是否使用 AI 搜索
    threshold?: number;      // MinHash 单独相似度阈值
    embeddingThreshold?: number; // AI 语义单独阈值（优先于全局，undefined 则跟随全局）
    searchMode?: 'contains' | 'similar' | 'embedding';  // 单独搜索模式（不设则跟随全局）
    translatedText?: string; // 翻译后的搜索文本（用于显示）
}

// ===== 翻译搜索语言列表 =====
const TRANSLATE_LANGUAGES = [
    { code: '', label: '跟从原文', en: 'Original', native: '' },
    { code: 'zh', label: '中文', en: 'Chinese', native: '中文' },
    { code: 'zh-TW', label: '繁体中文', en: 'Traditional Chinese', native: '繁體中文' },
    { code: 'en', label: '英文', en: 'English', native: 'English' },
    { code: 'es', label: '西班牙语', en: 'Spanish', native: 'Español' },
    { code: 'fr', label: '法语', en: 'French', native: 'Français' },
    { code: 'de', label: '德语', en: 'German', native: 'Deutsch' },
    { code: 'ja', label: '日语', en: 'Japanese', native: '日本語' },
    { code: 'ko', label: '韩语', en: 'Korean', native: '한국어' },
    { code: 'pt', label: '葡萄牙语', en: 'Portuguese', native: 'Português' },
    { code: 'pt-BR', label: '巴西葡语', en: 'Brazilian Portuguese', native: 'Português Brasileiro' },
    { code: 'ru', label: '俄语', en: 'Russian', native: 'Русский' },
    { code: 'ar', label: '阿拉伯语', en: 'Arabic', native: 'العربية' },
    { code: 'hi', label: '印地语', en: 'Hindi', native: 'हिन्दी' },
    { code: 'bn', label: '孟加拉语', en: 'Bengali', native: 'বাংলা' },
    { code: 'id', label: '印尼语', en: 'Indonesian', native: 'Bahasa Indonesia' },
    { code: 'ms', label: '马来语', en: 'Malay', native: 'Bahasa Melayu' },
    { code: 'th', label: '泰语', en: 'Thai', native: 'ไทย' },
    { code: 'vi', label: '越南语', en: 'Vietnamese', native: 'Tiếng Việt' },
    { code: 'tl', label: '菲律宾语', en: 'Filipino', native: 'Tagalog' },
    { code: 'tr', label: '土耳其语', en: 'Turkish', native: 'Türkçe' },
    { code: 'it', label: '意大利语', en: 'Italian', native: 'Italiano' },
    { code: 'nl', label: '荷兰语', en: 'Dutch', native: 'Nederlands' },
    { code: 'pl', label: '波兰语', en: 'Polish', native: 'Polski' },
    { code: 'uk', label: '乌克兰语', en: 'Ukrainian', native: 'Українська' },
    { code: 'ro', label: '罗马尼亚语', en: 'Romanian', native: 'Română' },
    { code: 'el', label: '希腊语', en: 'Greek', native: 'Ελληνικά' },
    { code: 'cs', label: '捷克语', en: 'Czech', native: 'Čeština' },
    { code: 'hu', label: '匈牙利语', en: 'Hungarian', native: 'Magyar' },
    { code: 'sv', label: '瑞典语', en: 'Swedish', native: 'Svenska' },
    { code: 'da', label: '丹麦语', en: 'Danish', native: 'Dansk' },
    { code: 'fi', label: '芬兰语', en: 'Finnish', native: 'Suomi' },
    { code: 'no', label: '挪威语', en: 'Norwegian', native: 'Norsk' },
    { code: 'he', label: '希伯来语', en: 'Hebrew', native: 'עברית' },
    { code: 'fa', label: '波斯语', en: 'Persian', native: 'فارسی' },
    { code: 'ur', label: '乌尔都语', en: 'Urdu', native: 'اردو' },
    { code: 'sw', label: '斯瓦希里语', en: 'Swahili', native: 'Kiswahili' },
    { code: 'zu', label: '祖鲁语', en: 'Zulu', native: 'isiZulu' },
    { code: 'af', label: '南非荷兰语', en: 'Afrikaans', native: 'Afrikaans' },
    { code: 'am', label: '阿姆哈拉语', en: 'Amharic', native: 'አማርኛ' },
    { code: 'my', label: '缅甸语', en: 'Burmese', native: 'မြန်မာ' },
    { code: 'km', label: '高棉语', en: 'Khmer', native: 'ខ្មែរ' },
    { code: 'ne', label: '尼泊尔语', en: 'Nepali', native: 'नेपाली' },
    { code: 'si', label: '僧伽罗语', en: 'Sinhala', native: 'සිංහල' },
    { code: 'ta', label: '泰米尔语', en: 'Tamil', native: 'தமிழ்' },
    { code: 'te', label: '泰卢固语', en: 'Telugu', native: 'తెలుగు' },
    { code: 'mr', label: '马拉地语', en: 'Marathi', native: 'मराठी' },
    { code: 'gu', label: '古吉拉特语', en: 'Gujarati', native: 'ગુજરાતી' },
    { code: 'kn', label: '卡纳达语', en: 'Kannada', native: 'ಕನ್ನಡ' },
    { code: 'ml', label: '马拉雅拉姆语', en: 'Malayalam', native: 'മലയാളം' },
    { code: 'pa', label: '旁遮普语', en: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
    { code: 'yo', label: '约鲁巴语', en: 'Yoruba', native: 'Yorùbá' },
    { code: 'ig', label: '伊博语', en: 'Igbo', native: 'Igbo' },
    { code: 'ha', label: '豪萨语', en: 'Hausa', native: 'Hausa' },
    { code: 'bg', label: '保加利亚语', en: 'Bulgarian', native: 'Български' },
    { code: 'hr', label: '克罗地亚语', en: 'Croatian', native: 'Hrvatski' },
    { code: 'sr', label: '塞尔维亚语', en: 'Serbian', native: 'Српски' },
    { code: 'sk', label: '斯洛伐克语', en: 'Slovak', native: 'Slovenčina' },
    { code: 'sl', label: '斯洛文尼亚语', en: 'Slovenian', native: 'Slovenščina' },
    { code: 'lt', label: '立陶宛语', en: 'Lithuanian', native: 'Lietuvių' },
    { code: 'lv', label: '拉脱维亚语', en: 'Latvian', native: 'Latviešu' },
    { code: 'et', label: '爱沙尼亚语', en: 'Estonian', native: 'Eesti' },
    { code: 'ka', label: '格鲁吉亚语', en: 'Georgian', native: 'ქართული' },
    { code: 'hy', label: '亚美尼亚语', en: 'Armenian', native: 'Հայերեն' },
    { code: 'az', label: '阿塞拜疆语', en: 'Azerbaijani', native: 'Azərbaycan' },
    { code: 'uz', label: '乌兹别克语', en: 'Uzbek', native: "O'zbek" },
    { code: 'kk', label: '哈萨克语', en: 'Kazakh', native: 'Қазақ' },
    { code: 'mn', label: '蒙古语', en: 'Mongolian', native: 'Монгол' },
];

interface TableState {
    headers: string[];
    rows: CellData[][];
    noteColumnVisible: boolean;
}

// ===== MinHash + LSH 算法（复用 minHashEngine 核心逻辑） =====

const SHINGLE_SIZE = 3;

/** 文本预处理：小写、去标点、规范化空格（支持中文/俄语等多语言） */
function preprocessText(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\p{L}\p{N}\s]/gu, ' ')  // 保留所有 Unicode 字母和数字，去除标点
        .replace(/\s+/g, ' ')
        .trim();
}

// CJK Unicode 范围检测
const CJK_REGEX = /[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]/;

// 惰性初始化中文分词器（浏览器原生 API，零依赖）
let _zhSegmenter: Intl.Segmenter | null = null;
function getZhSegmenter(): Intl.Segmenter | null {
    if (_zhSegmenter) return _zhSegmenter;
    try {
        _zhSegmenter = new Intl.Segmenter('zh', { granularity: 'word' });
        return _zhSegmenter;
    } catch {
        return null;
    }
}

/** 中文分词：使用 Intl.Segmenter 提取有意义的词 */
function segmentCJKText(text: string): string[] {
    const segmenter = getZhSegmenter();
    if (!segmenter) return [];
    return [...segmenter.segment(text)]
        .filter(s => s.isWordLike)
        .map(s => s.segment);
}

/** 生成特征集合 — 混合策略（同 minHashEngine）
 *  - 英文/拉丁文：字符级 N-gram
 *  - 中日韩文：词级 N-gram（Intl.Segmenter 分词后，单词 + bi-gram + tri-gram）
 */
function generateShingles(text: string, n: number = SHINGLE_SIZE): Set<string> {
    const processed = preprocessText(text);
    const shingles = new Set<string>();

    if (!processed) return shingles;

    // === 1. 提取非 CJK 部分 → 字符级 N-gram ===
    const nonCJKParts = processed.replace(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]+/g, ' ').replace(/\s+/g, ' ').trim();
    if (nonCJKParts.length >= n) {
        for (let i = 0; i <= nonCJKParts.length - n; i++) {
            shingles.add(nonCJKParts.substring(i, i + n));
        }
    } else if (nonCJKParts.length > 0) {
        shingles.add(nonCJKParts);
    }

    // === 2. 提取 CJK 部分 → 词级 N-gram（Intl.Segmenter 分词）===
    const cjkParts = processed.match(/[\u4e00-\u9fff\u3400-\u4dbf\u3040-\u30ff\uac00-\ud7af]+/g);
    if (cjkParts) {
        const cjkText = cjkParts.join('');
        const words = segmentCJKText(cjkText).filter(w => w.length > 0);
        if (words.length > 0) {
            // 单词本身作为特征
            words.forEach(w => shingles.add(w));
            // 词级 bi-gram 作为短语特征
            for (let i = 0; i < words.length - 1; i++) {
                shingles.add(words[i] + words[i + 1]);
            }
            // 词级 tri-gram（更长的语义特征）
            for (let i = 0; i < words.length - 2; i++) {
                shingles.add(words[i] + words[i + 1] + words[i + 2]);
            }
        } else {
            // Segmenter 回退：用字符 bi-gram
            const chars = [...cjkText];
            for (let i = 0; i < chars.length - 1; i++) {
                shingles.add(chars[i] + chars[i + 1]);
            }
        }
    }

    return shingles;
}

/** 查重匹配：计算查询词在高亮单元格中的覆盖度（Overlap Coefficient / Recall）
 * 解决了“短查询词在大段文字中由于分母(Union)过大导致相似度被稀释为0”的问题。
 */
function exactCoverage(querySet: Set<string>, cellSet: Set<string>): number {
    if (querySet.size === 0 && cellSet.size === 0) return 0;
    if (querySet.size === 0) return 0;
    let intersection = 0;
    for (const item of querySet) {
        if (cellSet.has(item)) intersection++;
    }
    // 计算查询特征被覆盖的比例
    return intersection / querySet.size;
}

/** 精确 Jaccard 相似度（用于表格内部两两查重） */
function exactJaccard(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 && set2.size === 0) return 0;
    let intersection = 0;
    for (const item of set1) {
        if (set2.has(item)) intersection++;
    }
    const union = set1.size + set2.size - intersection;
    return union > 0 ? intersection / union : 0;
}

// ===== 动态颜色生成算法 (黄金分割确保最大色差) =====
const getQueryColor = (index: number): string => {
    // 预设前几个最经典的高对比度颜色，后续则动态生成
    const baseColors = [
        '#ef4444', '#3b82f6', '#22c55e', '#a855f7', '#f97316', '#06b6d4',
        '#ec4899', '#eab308', '#14b8a6', '#6366f1', '#84cc16', '#d946ef'
    ];
    if (index < baseColors.length) return baseColors[index];

    // 黄金角度约为 137.5 度
    const hue = (index * 137.508) % 360;
    // 饱和度 70%，亮度 55%，确保颜色鲜艳且文字清晰
    return `hsl(${hue}, 70%, 55%)`;
};

// ===== 中文检测 =====
/** 判断文本是否主要为中文（CJK 字符占比 > 20%） */
function isMostlyChinese(text: string): boolean {
    if (!text.trim()) return false;
    const cjkMatches = text.match(/[\u4e00-\u9fff\u3400-\u4dbf\uf900-\ufaff]/g);
    const cjkCount = cjkMatches ? cjkMatches.length : 0;
    // 去掉空格和标点后的总字符数
    const meaningful = text.replace(/[\s\p{P}]/gu, '');
    if (meaningful.length === 0) return false;
    return cjkCount / meaningful.length > 0.2;
}

// ===== 解析 HTML 表格数据（Google Sheets / Excel 粘贴优先使用） =====
// Google Sheets 复制时剪贴板同时包含 text/html 和 text/plain
// HTML 格式中每个单元格由 <td> 标签明确界定，完美解决换行问题
function parseHtmlTable(html: string): { headers: string[]; rows: string[][] } | null {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const table = doc.querySelector('table');
        if (!table) return null;

        const allRows: string[][] = [];
        const trs = table.querySelectorAll('tr');
        if (trs.length === 0) return null;

        trs.forEach(tr => {
            const row: string[] = [];
            tr.querySelectorAll('td, th').forEach(cell => {
                // 获取单元格文本，保留内部换行
                // 将 <br> 转为换行，然后取 textContent
                const clone = cell.cloneNode(true) as HTMLElement;
                clone.querySelectorAll('br').forEach(br => br.replaceWith('\n'));
                // Google Sheets 用 <p> 包裹多行内容
                clone.querySelectorAll('p').forEach((p, idx) => {
                    if (idx > 0) p.insertBefore(document.createTextNode('\n'), p.firstChild);
                });
                const text = (clone.textContent || '').trim();
                row.push(text);
            });
            if (row.length > 0) {
                allRows.push(row);
            }
        });

        if (allRows.length === 0) return null;

        // 补齐列数
        const maxCols = Math.max(...allRows.map(r => r.length));
        const padRow = (row: string[]) => {
            while (row.length < maxCols) row.push('');
            return row;
        };

        // 判断表头
        const firstLine = allRows[0];
        const isHeader = firstLine.every(c => c.length < 100 && !/^\d+$/.test(c));

        if (isHeader && allRows.length > 1) {
            const headers = padRow(firstLine);
            const rows = allRows.slice(1).map(padRow);
            return { headers, rows };
        } else {
            const headers = Array.from({ length: maxCols }, (_, i) => `列${i + 1}`);
            const rows = allRows.map(padRow);
            return { headers, rows };
        }
    } catch {
        return null;
    }
}

// ===== 解析粘贴数据（Google Sheets / Excel 标准 TSV 格式，HTML 不可用时的后备） =====
// Google Sheets 复制出来的 TSV：
//   - 单元格内含换行时，整个格子用双引号包裹
//   - 格子内的引号转义为 ""
//   - 列之间用 Tab 分隔
//   - 行之间用换行分隔（但引号内的换行不算行分隔）
function parseTableData(text: string): { headers: string[]; rows: string[][] } {
    const raw = text.trim();
    if (!raw) return { headers: [], rows: [] };

    // 第一步：逐字符解析，正确处理引号包裹的单元格
    const allRows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuote = false;
    let i = 0;

    while (i < raw.length) {
        const ch = raw[i];

        if (inQuote) {
            if (ch === '"') {
                if (i + 1 < raw.length && raw[i + 1] === '"') {
                    // 转义引号 "" → "
                    currentCell += '"';
                    i += 2;
                } else {
                    // 引号结束
                    inQuote = false;
                    i++;
                }
            } else {
                // 引号内的任何字符（包括换行和 Tab）都属于当前单元格
                currentCell += ch;
                i++;
            }
        } else {
            if (ch === '"' && currentCell === '') {
                // 单元格以引号开头 → 进入引号模式
                inQuote = true;
                i++;
            } else if (ch === '\t') {
                // Tab → 列分隔
                currentRow.push(currentCell.trim());
                currentCell = '';
                i++;
            } else if (ch === '\r' || ch === '\n') {
                // 换行 → 行分隔
                currentRow.push(currentCell.trim());
                currentCell = '';
                allRows.push(currentRow);
                currentRow = [];
                // 跳过 \r\n 组合
                if (ch === '\r' && i + 1 < raw.length && raw[i + 1] === '\n') i++;
                i++;
            } else {
                currentCell += ch;
                i++;
            }
        }
    }
    // 处理最后一个单元格和行
    currentRow.push(currentCell.trim());
    allRows.push(currentRow);

    if (allRows.length === 0) return { headers: [], rows: [] };

    // 第二步：判断是否有表头
    const firstLine = allRows[0];
    const isHeader = firstLine.every(c => c.length < 100 && !/^\d+$/.test(c));
    const maxCols = Math.max(...allRows.map(r => r.length));

    // 补齐每行列数
    const padRow = (row: string[]) => {
        while (row.length < maxCols) row.push('');
        return row;
    };

    if (isHeader && allRows.length > 1) {
        const headers = padRow(firstLine);
        const rows = allRows.slice(1).map(padRow);
        return { headers, rows };
    } else {
        const headers = Array.from({ length: maxCols }, (_, i) => `列${i + 1}`);
        const rows = allRows.map(padRow);
        return { headers, rows };
    }
}

// ===== AI 搜索结果类型 =====
interface AiSearchResult {
    rowIndex: number;
    reason: string;
    relevance: number; // 1-100
}

// ===== 模型选择常量 =====
const LOCAL_MODEL_KEY_CS = 'copy_search_local_model';
const INHERIT_VALUE = '__global__';

const CS_MODEL_OPTIONS = [
  { value: INHERIT_VALUE, label: '继承全局设置' },
  { value: 'gemini-3.5-flash', label: '🚀 gemini-3.5-flash (GA·新)' },
  { value: 'gemini-2.5-flash', label: '⚡ gemini-2.5-flash (GA)' },
  { value: 'gemini-2.5-flash-lite', label: '⚡ gemini-2.5-flash-lite (GA·最快)' },
  { value: 'gemini-2.5-pro', label: '🧠 gemini-2.5-pro (GA·强推理)' },
  { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (Preview)' },
  { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview (Preview·最新)' },
];

// ===== 组件 =====
interface Props {
    getAiInstance?: () => any;
    textModel?: string;
}

interface ExpandedModalState {
    text: string;
    title: string;
    editable?: boolean;
    queryId?: string;
    noteRowIndex?: number;
    accentColor?: string;
}

const CopySearchApp: React.FC<Props> = ({ getAiInstance, textModel = 'gemini-2.5-flash' }) => {
    // 本地模型选择（默认继承全局）
    const [localModel, setLocalModel] = useState<string>(() => {
        try { return localStorage.getItem(LOCAL_MODEL_KEY_CS) || INHERIT_VALUE; } catch { return INHERIT_VALUE; }
    });
    const effectiveModel = localModel === INHERIT_VALUE ? textModel : localModel;

    // 表格状态
    const [table, setTable] = useState<TableState>({ headers: [], rows: [], noteColumnVisible: true });
    const [pasteInput, setPasteInput] = useState('');
    const [pasteHtml, setPasteHtml] = useState(''); // 保存 HTML 剪贴板数据
    const [showPasteArea, setShowPasteArea] = useState(true);
    const [appendMode, setAppendMode] = useState(false);  // 追加粘贴模式
    const [sortMode, setSortMode] = useState<'original' | 'color' | 'match' | 'query'>('original');
    const originalRowsRef = useRef<CellData[][] | null>(null);  // 存储原始行顺序

    // 搜索项
    const [queries, setQueries] = useState<SearchQuery[]>([
        { id: uuidv4(), text: '', noteText: '', color: getQueryColor(0), enabled: true, isSearching: false, resultCount: 0 },
    ]);

    // 配置
    const [threshold, setThreshold] = useState(0.45); // MinHash Jaccard 阈值默认 0.45
    const [embeddingThreshold, setEmbeddingThreshold] = useState(0.90); // AI 语义搜索阈值默认 0.90（余弦相似度量纲远高于 Jaccard）
    const [searchCol, setSearchCol] = useState<number>(-1); // 默认搜索全部列
    const [searchMode, setSearchMode] = useState<'contains' | 'similar' | 'embedding' | 'llm'>('similar'); // 默认相似模式
    const [showSettings, setShowSettings] = useState(false);
    const [maxBatchChars, setMaxBatchChars] = useState(3000);
    const [searchQueriesCollapsed, setSearchQueriesCollapsed] = useState(false);
    const [globalProgress, setGlobalProgress] = useState('');

    // ===== 翻译搜索状态 =====
    const [translateEnabled, setTranslateEnabled] = useState<boolean>(() => {
        try { return localStorage.getItem('copy-search-translate-enabled') === 'true'; } catch { return false; }
    });
    const [translateLang, setTranslateLang] = useState<string>(() => {
        try { return localStorage.getItem('copy-search-translate-lang') || 'en'; } catch { return 'en'; }
    });
    const [translateLangSearch, setTranslateLangSearch] = useState('');
    const [translateDropdownOpen, setTranslateDropdownOpen] = useState(false);
    const translateDropdownRef = useRef<HTMLDivElement>(null);
    const [isTranslating, setIsTranslating] = useState(false);

    // 持久化翻译设置
    useEffect(() => {
        try {
            localStorage.setItem('copy-search-translate-enabled', translateEnabled ? 'true' : 'false');
            localStorage.setItem('copy-search-translate-lang', translateLang);
        } catch {}
    }, [translateEnabled, translateLang]);

    // 点击外部关闭翻译语言下拉
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (translateDropdownRef.current && !translateDropdownRef.current.contains(e.target as Node)) {
                setTranslateDropdownOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 过滤翻译语言列表
    const filteredTranslateLangs = useMemo(() => {
        if (!translateLangSearch.trim()) return TRANSLATE_LANGUAGES;
        const s = translateLangSearch.toLowerCase();
        return TRANSLATE_LANGUAGES.filter(l =>
            l.label.toLowerCase().includes(s) ||
            l.en.toLowerCase().includes(s) ||
            l.native.toLowerCase().includes(s) ||
            l.code.toLowerCase().includes(s)
        );
    }, [translateLangSearch]);

    // AI 翻译函数
    const translateText = useCallback(async (text: string, targetLang: string): Promise<string> => {
        if (!text.trim() || !targetLang) return text;
        const ai = getAiInstance?.();
        if (!ai) throw new Error('请先设置 API 密钥');
        const langObj = TRANSLATE_LANGUAGES.find(l => l.code === targetLang);
        const langName = langObj ? `${langObj.en} (${langObj.label})` : targetLang;
        const result = await ai.models.generateContent({
            model: effectiveModel,
            contents: `Translate the following text to ${langName}. Return ONLY the translated text, no explanations or quotes:\n\n${text}`,
            config: { temperature: 0.1 },
        });
        const translated = (result?.text || '').trim();
        return translated || text;
    }, [getAiInstance, effectiveModel]);
    const [clearConfirm, setClearConfirm] = useState<{ step: number; count: number; countdown: number } | null>(null);

    // Embedding 缓存: cellText -> embedding vector
    const embeddingCacheRef = useRef<Map<string, number[]>>(new Map());
    const [embeddingIndexInfo, setEmbeddingIndexInfo] = useState<{ cached: number; total: number } | null>(null);

    // 重新统计 embedding 索引覆盖率
    const recountEmbeddingIndex = useCallback(() => {
        const { rows } = table;
        if (rows.length === 0) { setEmbeddingIndexInfo(null); return; }
        const col = searchCol;
        const allCols = col < 0;
        const uniqueTexts = new Set<string>();
        rows.forEach(row => {
            if (allCols) {
                row.forEach(cell => { if (cell.value.trim()) uniqueTexts.add(cell.value.trim()); });
            } else {
                const val = row[col]?.value?.trim();
                if (val) uniqueTexts.add(val);
            }
        });
        const total = uniqueTexts.size;
        const cache = embeddingCacheRef.current;
        let cached = 0;
        uniqueTexts.forEach(t => { if (cache.has(t)) cached++; });
        setEmbeddingIndexInfo({ cached, total });
    }, [table, searchCol]);

    // 提前建立语义索引
    const [isPrebuilding, setIsPrebuilding] = useState(false);
    const prebuildEmbeddingIndex = useCallback(async () => {
        const { rows } = table;
        if (rows.length === 0) return;
        setIsPrebuilding(true);
        try {
            // 初始化引擎
            if (!localEmbeddingService.isReady()) {
                setGlobalProgress('🧠 加载语义模型...');
                await localEmbeddingService.initEngine((progress) => {
                    setGlobalProgress(`🧠 加载模型: ${progress}`);
                });
            }
            // 收集所有需要建索引的文本
            const col = searchCol;
            const allCols = col < 0;
            const uniqueTexts = new Set<string>();
            rows.forEach(row => {
                if (allCols) {
                    row.forEach(cell => { if (cell.value.trim()) uniqueTexts.add(cell.value.trim()); });
                } else {
                    const val = row[col]?.value?.trim();
                    if (val) uniqueTexts.add(val);
                }
            });
            const cache = embeddingCacheRef.current;
            const needEmbed = Array.from(uniqueTexts).filter(t => !cache.has(t));
            if (needEmbed.length === 0) {
                setGlobalProgress('✅ 所有文案均已有索引，无需重建');
                setTimeout(() => setGlobalProgress(''), 3000);
                setIsPrebuilding(false);
                return;
            }
            setGlobalProgress(`🧠 建立语义索引 (0/${needEmbed.length})...`);
            const embeddings = await localEmbeddingService.extractEmbeddings(needEmbed, (done, total) => {
                setGlobalProgress(`🧠 建立语义索引 (${done}/${total})，剩余 ${total - done} 条...`);
            });
            embeddings.forEach((emb: number[], idx: number) => {
                cache.set(needEmbed[idx], emb);
            });
            setGlobalProgress(`✅ 索引建立完成！共 ${uniqueTexts.size} 条文案全部就绪`);
            // 自动保存到文件夹
            if (autoSaveIndex && dirHandleRef.current) {
                await saveIndexToDir();
                setGlobalProgress(`✅ 索引已建立并自动保存到 ${dirHandleRef.current.name}/`);
            }
            setTimeout(() => setGlobalProgress(''), 3000);
        } catch (err: any) {
            setGlobalProgress(`❌ 索引建立失败: ${err.message || err}`);
            setTimeout(() => setGlobalProgress(''), 5000);
        } finally {
            setIsPrebuilding(false);
        }
    }, [table, searchCol]);

    // 导出语义索引到 JSON 文件
    const exportEmbeddingIndex = useCallback(async () => {
        const cache = embeddingCacheRef.current;
        if (cache.size === 0) {
            setGlobalProgress('⚠️ 没有可导出的索引');
            setTimeout(() => setGlobalProgress(''), 3000);
            return;
        }
        setGlobalProgress('📦 正在导出索引...');
        const entries: { t: string; e: number[] }[] = [];
        cache.forEach((emb, text) => { entries.push({ t: text, e: emb }); });
        const json = JSON.stringify({ version: 1, count: entries.length, entries });
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `embedding-index-${new Date().toISOString().slice(0, 10)}-${entries.length}条.json`;
        a.click();
        URL.revokeObjectURL(url);
        setGlobalProgress(`✅ 已导出 ${entries.length} 条索引`);
        setTimeout(() => setGlobalProgress(''), 3000);
    }, []);

    // 导入语义索引（从 JSON 文件）
    const importEmbeddingIndexRef = useRef<HTMLInputElement | null>(null);
    const handleImportEmbeddingFile = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        e.target.value = ''; // 允许重复选择同一文件
        setGlobalProgress('📥 正在读取索引文件...');
        try {
            const text = await file.text();
            const data = JSON.parse(text);
            const entries: { t: string; e: number[] }[] = data.entries || [];
            if (entries.length === 0) {
                setGlobalProgress('⚠️ 索引文件为空');
                setTimeout(() => setGlobalProgress(''), 3000);
                return;
            }
            const cache = embeddingCacheRef.current;
            let newCount = 0;
            for (const item of entries) {
                if (item.t && item.e && Array.isArray(item.e)) {
                    if (!cache.has(item.t)) newCount++;
                    cache.set(item.t, item.e);
                    // 同时写入 IndexedDB 持久化
                    embeddingDB.set(item.t, item.e).catch(() => {});
                }
            }
            setGlobalProgress(`✅ 已导入 ${entries.length} 条索引（新增 ${newCount} 条）`);
            setTimeout(() => setGlobalProgress(''), 4000);
        } catch (err: any) {
            setGlobalProgress(`❌ 导入失败: ${err.message || '文件格式错误'}`);
            setTimeout(() => setGlobalProgress(''), 5000);
        }
    }, []);

    // 余弦相似度
    const cosineSimilarity = useCallback((a: number[], b: number[]): number => {
        if (a.length !== b.length || a.length === 0) return 0;
        let dot = 0, magA = 0, magB = 0;
        for (let i = 0; i < a.length; i++) {
            dot += a[i] * b[i];
            magA += a[i] * a[i];
            magB += b[i] * b[i];
        }
        return dot / (Math.sqrt(magA) * Math.sqrt(magB) || 1);
    }, []);
    const [expandedModal, setExpandedModal] = useState<ExpandedModalState | null>(null);
    const [expandedDraft, setExpandedDraft] = useState('');

    // 分页（避免大数据量卡死）
    const PAGE_SIZE = 500;
    const [currentPage, setCurrentPage] = useState(0);

    // AI 搜索状态
    const [aiSearchQuery, setAiSearchQuery] = useState('');
    const [aiSearching, setAiSearching] = useState(false);
    const [aiSearchResults, setAiSearchResults] = useState<AiSearchResult[]>([]);
    const [showAiSearch, setShowAiSearch] = useState(false);
    const [aiSearchError, setAiSearchError] = useState('');

    // Shingles 缓存（本地计算，非常快）
    const shingleCache = useRef<Map<string, Set<string>>>(new Map());

    // 表格容器
    const tableContainerRef = useRef<HTMLDivElement>(null);
    const tableRef = useRef<TableState>(table);
    const searchLockRef = useRef<boolean>(false);

    useEffect(() => {
        tableRef.current = table;
    }, [table]);

    // ===== 语义索引持久化（File System Access API + IndexedDB 双保险）=====
    const [autoSaveIndex, setAutoSaveIndex] = useState(() => localStorage.getItem('copy-search-auto-save-index') !== 'false');
    const [indexLoadStatus, setIndexLoadStatus] = useState<string>('');
    const [indexSavePath, setIndexSavePath] = useState<string>(''); // 显示用的路径
    const dirHandleRef = useRef<FileSystemDirectoryHandle | null>(null);
    const INDEX_FILE_NAME = 'copy-search-embedding-index.json';

    // 从 IndexedDB 恢复目录句柄
    const loadDirHandle = useCallback(async (): Promise<FileSystemDirectoryHandle | null> => {
        try {
            const dbReq = indexedDB.open('CopySearchFS', 1);
            return new Promise((resolve) => {
                dbReq.onupgradeneeded = (e: any) => {
                    e.target.result.createObjectStore('handles');
                };
                dbReq.onsuccess = async (e: any) => {
                    const db = e.target.result;
                    const tx = db.transaction('handles', 'readonly');
                    const req = tx.objectStore('handles').get('indexDir');
                    req.onsuccess = async () => {
                        const handle = req.result as FileSystemDirectoryHandle | undefined;
                        if (!handle) { resolve(null); return; }
                        // 检查权限
                        const perm = await (handle as any).queryPermission?.({ mode: 'readwrite' });
                        if (perm === 'granted') {
                            resolve(handle);
                        } else {
                            resolve(null); // 需要重新授权
                        }
                    };
                    req.onerror = () => resolve(null);
                };
                dbReq.onerror = () => resolve(null);
            });
        } catch { return null; }
    }, []);

    // 保存目录句柄到 IndexedDB
    const saveDirHandle = useCallback(async (handle: FileSystemDirectoryHandle) => {
        try {
            const dbReq = indexedDB.open('CopySearchFS', 1);
            dbReq.onupgradeneeded = (e: any) => {
                if (!e.target.result.objectStoreNames.contains('handles'))
                    e.target.result.createObjectStore('handles');
            };
            dbReq.onsuccess = (e: any) => {
                const db = e.target.result;
                const tx = db.transaction('handles', 'readwrite');
                tx.objectStore('handles').put(handle, 'indexDir');
            };
        } catch {}
    }, []);

    // 选择保存位置
    const pickSaveDirectory = useCallback(async () => {
        try {
            const handle = await (window as any).showDirectoryPicker({ mode: 'readwrite' });
            dirHandleRef.current = handle;
            setIndexSavePath(handle.name);
            await saveDirHandle(handle);
            setGlobalProgress(`✅ 索引保存位置已设为: ${handle.name}/`);
            setTimeout(() => setGlobalProgress(''), 3000);
            // 如果已有缓存，立刻保存一份
            if (embeddingCacheRef.current.size > 0) {
                await saveIndexToDir(handle);
            }
        } catch (err: any) {
            if (err.name !== 'AbortError') {
                setGlobalProgress(`❌ 选择文件夹失败: ${err.message}`);
                setTimeout(() => setGlobalProgress(''), 4000);
            }
        }
    }, []);

    // 保存索引到指定目录
    const saveIndexToDir = useCallback(async (handle?: FileSystemDirectoryHandle) => {
        const dir = handle || dirHandleRef.current;
        if (!dir) return;
        const cache = embeddingCacheRef.current;
        if (cache.size === 0) return;
        try {
            const entries: { t: string; e: number[] }[] = [];
            cache.forEach((emb, text) => entries.push({ t: text, e: emb }));
            const json = JSON.stringify({ version: 1, count: entries.length, ts: Date.now(), entries });
            const fileHandle = await dir.getFileHandle(INDEX_FILE_NAME, { create: true });
            const writable = await (fileHandle as any).createWritable();
            await writable.write(json);
            await writable.close();
        } catch (err) {
            console.warn('保存索引文件失败:', err);
        }
    }, []);

    // 从目录加载索引
    const loadIndexFromDir = useCallback(async (handle: FileSystemDirectoryHandle): Promise<number> => {
        try {
            const fileHandle = await handle.getFileHandle(INDEX_FILE_NAME);
            const file = await fileHandle.getFile();
            const text = await file.text();
            const data = JSON.parse(text);
            const entries: { t: string; e: number[] }[] = data.entries || [];
            const cache = embeddingCacheRef.current;
            let loaded = 0;
            for (const item of entries) {
                if (item.t && item.e && Array.isArray(item.e)) {
                    cache.set(item.t, item.e);
                    loaded++;
                }
            }
            return loaded;
        } catch {
            return 0; // 文件不存在或读取失败
        }
    }, []);

    // 启动时自动恢复索引
    useEffect(() => {
        if (!autoSaveIndex) return;
        let cancelled = false;
        (async () => {
            // 1. 尝试从自定义文件夹恢复
            const handle = await loadDirHandle();
            if (handle && !cancelled) {
                dirHandleRef.current = handle;
                setIndexSavePath(handle.name);
                setIndexLoadStatus(`📂 正在从 ${handle.name}/ 恢复索引...`);
                const loaded = await loadIndexFromDir(handle);
                if (loaded > 0 && !cancelled) {
                    setIndexLoadStatus(`✅ 已从 ${handle.name}/ 恢复 ${loaded} 条语义索引`);
                    setTimeout(() => setIndexLoadStatus(''), 4000);
                    return; // 文件夹优先，成功就不查 IndexedDB 了
                }
            }
            // 2. 回退：从 IndexedDB 恢复
            if (cancelled) return;
            try {
                const count = await embeddingDB.count();
                if (count === 0 || cancelled) return;
                setIndexLoadStatus(`📥 正在从浏览器缓存恢复 ${count} 条索引...`);
                const entries = await embeddingDB.exportAll();
                if (cancelled) return;
                const cache = embeddingCacheRef.current;
                let loaded = 0;
                for (const item of entries) {
                    if (item.text && item.embedding) {
                        cache.set(item.text, item.embedding);
                        loaded++;
                    }
                }
                if (loaded > 0) {
                    setIndexLoadStatus(`✅ 已从浏览器缓存恢复 ${loaded} 条索引`);
                    setTimeout(() => setIndexLoadStatus(''), 4000);
                }
            } catch (err) {
                console.warn('从 IndexedDB 加载索引失败:', err);
                setIndexLoadStatus('');
            }
        })();
        return () => { cancelled = true; };
    }, []); // 只在挂载时执行一次

    // 持久化 autoSaveIndex 开关
    useEffect(() => {
        localStorage.setItem('copy-search-auto-save-index', autoSaveIndex ? 'true' : 'false');
    }, [autoSaveIndex]);

    // ===== 粘贴数据 =====
    const handlePaste = useCallback((append = false) => {
        if (!pasteInput.trim() && !pasteHtml.trim()) return;

        // 优先使用 HTML 解析（Google Sheets 粘贴时完美保留单元格边界）
        let parsedHtml: { headers: string[]; rows: string[][] } | null = null;
        let parsedTsv: { headers: string[]; rows: string[][] } | null = null;

        if (pasteHtml.trim()) {
            parsedHtml = parseHtmlTable(pasteHtml);
        }
        if (pasteInput.trim()) {
            parsedTsv = parseTableData(pasteInput);
        }

        // 选择解析结果：如果 HTML 丢了空行（行数少于 TSV），用 TSV 保留原始行位置
        let parsed: { headers: string[]; rows: string[][] } | null = null;
        const htmlRows = parsedHtml?.rows?.length || 0;
        const tsvRows = parsedTsv?.rows?.length || 0;
        if (parsedHtml && parsedTsv && tsvRows > htmlRows) {
            parsed = parsedTsv;
        } else if (parsedHtml && parsedHtml.headers.length > 0) {
            parsed = parsedHtml;
        } else {
            parsed = parsedTsv;
        }
        if (!parsed || parsed.headers.length === 0) return;

        const newRows: CellData[][] = parsed.rows.map(row =>
            row.map(val => ({ value: val, highlights: [], note: '' }))
        );

        if (append && table.rows.length > 0) {
            // 追加模式：合并到现有表格
            const existingColCount = table.headers.length;
            const newColCount = parsed.headers.length;
            // 对齐列数：新数据列不够则补空，多了则截断
            const alignedRows = newRows.map(row => {
                if (row.length < existingColCount) {
                    return [...row, ...Array(existingColCount - row.length).fill({ value: '', highlights: [], note: '' })];
                }
                return row.slice(0, existingColCount);
            });
            setTable(prev => {
                const merged = [...prev.rows, ...alignedRows];
                originalRowsRef.current = merged.map(r => r.map(c => ({ ...c })));
                return { ...prev, rows: merged };
            });
            setSortMode('original');
            setGlobalProgress(`✅ 已追加 ${alignedRows.length} 行数据（总计 ${table.rows.length + alignedRows.length} 行）`);
            setTimeout(() => setGlobalProgress(''), 3000);
        } else {
            // 替换模式
            setTable({ headers: parsed.headers, rows: newRows, noteColumnVisible: true });
            originalRowsRef.current = newRows.map(r => r.map(c => ({ ...c })));
            setSortMode('original');
            shingleCache.current.clear();
        }
        setShowPasteArea(false);
        setPasteInput('');
        setPasteHtml('');
        setCurrentPage(0);
    }, [pasteInput, pasteHtml, table]);

    // ===== 搜索项管理 =====
    const addQuery = () => {
        const nextColor = getQueryColor(queries.length);
        setQueries(prev => [...prev, {
            id: uuidv4(), text: '', noteText: '', color: nextColor,
            enabled: true, isSearching: false, resultCount: 0, useAi: false,
        }]);
    };

    const removeQuery = (id: string) => {
        setQueries(prev => prev.filter(q => q.id !== id));
        // 清除该搜索项的高亮
        setTable(prev => ({
            ...prev,
            rows: prev.rows.map(row => row.map(cell => ({
                ...cell,
                highlights: cell.highlights.filter(h => h.queryId !== id),
                note: cell.highlights.some(h => h.queryId === id) && cell.highlights.length <= 1 ? '' : cell.note,
            }))),
        }));
    };

    const updateQuery = (id: string, updates: Partial<SearchQuery>) => {
        setQueries(prev => prev.map(q => q.id === id ? { ...q, ...updates } : q));
    };

    // 批量翻译多个搜索项
    const translateQueries = useCallback(async (queriesToTranslate: SearchQuery[]): Promise<Map<string, string>> => {
        const translationMap = new Map<string, string>();
        if (!translateEnabled || !translateLang) return translationMap;
        
        setIsTranslating(true);
        try {
            for (let i = 0; i < queriesToTranslate.length; i++) {
                const q = queriesToTranslate[i];
                if (!q.text.trim()) continue;
                setGlobalProgress(`🌐 翻译中 (${i + 1}/${queriesToTranslate.length}): ${q.text.substring(0, 30)}...`);
                const translated = await translateText(q.text, translateLang);
                translationMap.set(q.id, translated);
                // 更新搜索项显示翻译结果
                updateQuery(q.id, { translatedText: translated });
            }
            return translationMap;
        } finally {
            setIsTranslating(false);
        }
    }, [translateEnabled, translateLang, translateText]);

    const updateRowNote = useCallback((rowIndex: number, noteValue: string) => {
        setTable(prev => {
            if (rowIndex < 0 || rowIndex >= prev.rows.length) return prev;
            const newRows = [...prev.rows];
            const newRow = [...newRows[rowIndex]];
            // 备注写到第一个有高亮的单元格或第一个
            const targetCol = newRow.findIndex(c => c.highlights.length > 0);
            const idx = targetCol >= 0 ? targetCol : 0;
            newRow[idx] = { ...newRow[idx], note: noteValue };
            // 清除其他列的备注
            for (let c = 0; c < newRow.length; c++) {
                if (c !== idx) newRow[c] = { ...newRow[c], note: '' };
            }
            newRows[rowIndex] = newRow;
            return { ...prev, rows: newRows };
        });
    }, []);

    const openExpandedViewer = useCallback((text: string, title = '完整内容') => {
        if (!text) return;
        setExpandedModal({ text, title, editable: false });
        setExpandedDraft(text);
    }, []);

    const openQueryEditor = useCallback((query: SearchQuery) => {
        if (!query.text) return;
        setExpandedModal({
            text: query.text,
            title: '编辑搜索项',
            editable: true,
            queryId: query.id,
            accentColor: query.color,
        });
        setExpandedDraft(query.text);
    }, []);

    const openNoteEditor = useCallback((rowIndex: number, noteText: string) => {
        setExpandedModal({
            text: noteText,
            title: '编辑备注',
            editable: true,
            noteRowIndex: rowIndex,
            accentColor: '#fbbf24',
        });
        setExpandedDraft(noteText);
    }, []);

    const closeExpandedModal = useCallback(() => {
        setExpandedModal(null);
        setExpandedDraft('');
    }, []);

    const saveExpandedModal = useCallback(() => {
        if (!expandedModal?.editable) {
            closeExpandedModal();
            return;
        }
        if (expandedModal.queryId) {
            updateQuery(expandedModal.queryId, { text: expandedDraft });
            setGlobalProgress('✅ 已更新搜索项');
        } else if (typeof expandedModal.noteRowIndex === 'number') {
            updateRowNote(expandedModal.noteRowIndex, expandedDraft);
            setGlobalProgress('✅ 已更新备注');
        }
        setTimeout(() => setGlobalProgress(''), 2000);
        closeExpandedModal();
    }, [expandedModal, expandedDraft, closeExpandedModal, updateRowNote]);

    const getRowManualNote = useCallback((row: CellData[]) => (
        row.map(c => c.note).filter(Boolean).join(' | ')
    ), []);

    const getQueryLabel = useCallback((queryLike: { text?: string; noteText?: string }, fallback = '未命名搜索项') => {
        const en = (queryLike.text || '').trim();
        const zh = (queryLike.noteText || '').trim();
        if (en && zh) return `EN:${en} | 中文:${zh}`;
        return en || zh || fallback;
    }, []);

    const buildQueryNoteContent = useCallback((
        queryLike: { text?: string; noteText?: string },
        mode: 'contains' | 'similar' | 'embedding',
        similarityPercent?: number,
    ) => {
        const label = getQueryLabel(queryLike);
        const prefix = `[组: ${label}]`;
        if (mode === 'contains') {
            return `${prefix} 🔍 命中`;
        }
        if (mode === 'embedding') {
            if (typeof similarityPercent === 'number') {
                return `${prefix} 🧠 语义 ${similarityPercent}%`;
            }
            return `${prefix} 🧠 语义`;
        }
        if (typeof similarityPercent === 'number') {
            return `${prefix} 🔍 相似 ${similarityPercent}%`;
        }
        return `${prefix} 🔍 相似`;
    }, [getQueryLabel]);

    const getRowMatchSummary = useCallback((row: CellData[]) => {
        const matchedMap = new Map<string, { index?: number; text: string }>();
        row.forEach(cell => {
            cell.highlights.forEach(h => {
                if (matchedMap.has(h.queryId)) return;
                const idx = queries.findIndex(q => q.id === h.queryId);
                const text = idx >= 0
                    ? getQueryLabel(queries[idx], h.queryText || '未命名搜索项')
                    : getQueryLabel({ text: h.queryText }, '未命名搜索项');
                matchedMap.set(h.queryId, { index: idx >= 0 ? idx + 1 : undefined, text });
            });
        });

        const matched = Array.from(matchedMap.values());
        if (matched.length <= 1) return '';
        const labels = matched.map(item =>
            item.index ? `#${item.index}「${item.text}」` : `「${item.text}」`
        );
        return `⚠️ 同时命中 ${matched.length} 个搜索项：${labels.join('、')}`;
    }, [queries, getQueryLabel]);

    const getRowNoteWithSummary = useCallback((row: CellData[]) => {
        const manualNote = getRowManualNote(row);
        const matchSummary = getRowMatchSummary(row);
        const raw = (manualNote && matchSummary) ? `${manualNote} | ${matchSummary}` : (manualNote || matchSummary);
        // 正则剥离所有后台专用的 [QID:xxxxx] 标签
        return raw.replace(/\[QID:[^\]]+\]/g, '').trim();
    }, [getRowManualNote, getRowMatchSummary]);

    // ===== 执行搜索 =====
    const executeSearch = (query: SearchQuery) => {
        if (!query.text.trim() || tableRef.current.rows.length === 0) return;
        if (searchLockRef.current) {
            setGlobalProgress('请等待当前搜索任务完成...');
            setTimeout(() => setGlobalProgress(''), 2000);
            return;
        }

        searchLockRef.current = true;
        updateQuery(query.id, { isSearching: true, resultCount: 0, searchDone: false });
        const startTime = performance.now();

        // 异步执行以免阻塞 UI
        setTimeout(async () => {
            try {
                // ===== 翻译搜索：先翻译查询词 =====
                let effectiveQueryText = query.text;
                if (translateEnabled && translateLang) {
                    try {
                        setGlobalProgress(`🌐 翻译搜索项: ${query.text.substring(0, 30)}...`);
                        effectiveQueryText = await translateText(query.text, translateLang);
                        updateQuery(query.id, { translatedText: effectiveQueryText });
                        setGlobalProgress(`🌐 翻译完成: ${effectiveQueryText.substring(0, 40)}`);
                    } catch (err: any) {
                        setGlobalProgress(`⚠️ 翻译失败: ${err.message || '未知'}, 使用原文搜索`);
                    }
                }

                // 先基于 ref 同步计算新行和匹配数，避免 setTable updater 时序问题
                const prev = tableRef.current;
                const matchedRows = new Set<number>();

                // 先清理该搜索项旧高亮及旧备注，避免重复堆叠
                const noteKeyToClear = getQueryLabel(query);
                const updatedRows = prev.rows.map(row => row.map(cell => {
                    let newNote = cell.note;
                    if (newNote && newNote.includes(noteKeyToClear)) {
                        newNote = newNote.split('|')
                            .map(s => s.trim())
                            .filter(s => !s.includes(noteKeyToClear))
                            .join(' | ')
                            .trim();
                    }
                    return {
                        ...cell,
                        note: newNote,
                        highlights: cell.highlights.filter(h => h.queryId !== query.id),
                    };
                }));

                // 收集要搜索的单元格
                const cellsToSearch: { row: number; col: number; text: string }[] = [];
                updatedRows.forEach((row, ri) => {
                    row.forEach((cell, ci) => {
                        if (searchCol >= 0 && ci !== searchCol) return;
                        const text = cell.value.trim();
                        if (text) cellsToSearch.push({ row: ri, col: ci, text });
                    });
                });

                if (cellsToSearch.length > 0) {
                    if (searchMode === 'llm') {
                        // ===== LLM 精判模式：调用 AI 直接判断 =====
                        executeAiQuerySearch(query);
                        return; // executeAiQuerySearch 自行处理状态
                    } else if (searchMode === 'embedding') {
                        // ===== 本地 AI 语义搜索：Web Worker Embedding + 余弦相似度 =====
                        if (!localEmbeddingService.isReady()) {
                            setGlobalProgress('正在初始化本地 AI 引擎，首次下载需等待...');
                            await localEmbeddingService.initEngine((progress) => {
                                if (progress.status === 'progress') {
                                    setGlobalProgress(`下载 AI 模型中: ${progress.file} - ${Math.round(progress.progress || 0)}%`);
                                } else if (progress.status === 'done') {
                                    setGlobalProgress(`加载完成: ${progress.file}`);
                                }
                            });
                        }

                        setGlobalProgress('🧠 正在分析查询文案...');
                        const queryEmbArray = await localEmbeddingService.extractEmbeddings([effectiveQueryText]);
                        const queryEmb = queryEmbArray[0];

                        // 批量获取单元格 embedding（有缓存就跳过）
                        const cache = embeddingCacheRef.current;
                        const needEmbed = cellsToSearch.filter(c => !cache.has(c.text));
                        if (needEmbed.length > 0) {
                            setGlobalProgress(`使用本地 GPU/CPU 建立语义索引 (共 ${needEmbed.length} 条缺失索引，已有 ${cellsToSearch.length - needEmbed.length} 条命中缓存)...`);
                            const texts = needEmbed.map(c => c.text);
                            const embeddings = await localEmbeddingService.extractEmbeddings(texts, (done, total) => {
                                setGlobalProgress(`建立语义索引 (${done}/${total})，缺失 ${total - done} 条...`);
                            });
                            embeddings.forEach((emb: number[], idx: number) => {
                                cache.set(needEmbed[idx].text, emb);
                            });
                            setGlobalProgress(`✅ 索引建立完成！共 ${cellsToSearch.length} 条全部就绪，正在计算相似度...`);
                        } else {
                            setGlobalProgress(`✅ 全部 ${cellsToSearch.length} 条索引均命中缓存，跳过建立，直接计算相似度...`);
                        }

                        setGlobalProgress('🧠 正在计算语义相似度...');
                        cellsToSearch.forEach(c => {
                            const cellEmb = cache.get(c.text);
                            if (!cellEmb) return;
                            const similarity = cosineSimilarity(queryEmb, cellEmb);
                            const effectiveThreshold = query.embeddingThreshold ?? embeddingThreshold;
                            if (similarity < effectiveThreshold) return;
                            matchedRows.add(c.row);
                            const cell = updatedRows[c.row][c.col];
                            cell.highlights.push({
                                queryId: query.id,
                                color: query.color,
                                similarity: Math.floor(similarity * 1000) / 10,
                                queryText: query.text,
                            });
                            const similarityPercent = Math.floor(similarity * 1000) / 10;
                            const noteContent = buildQueryNoteContent(query, 'embedding', similarityPercent);
                            const noteKey = getQueryLabel(query);
                            if (!cell.note) {
                                cell.note = noteContent;
                            } else if (!cell.note.includes(noteKey)) {
                                cell.note += ` | ${noteContent}`;
                            }
                        });
                    } else if (searchMode === 'contains') {
                        // ===== 包含搜索：大小写不敏感的子串匹配 =====
                        const queryLower = effectiveQueryText.toLowerCase();

                        cellsToSearch.forEach(c => {
                            if (!c.text.toLowerCase().includes(queryLower)) return;
                            matchedRows.add(c.row);
                            const cell = updatedRows[c.row][c.col];
                            cell.highlights.push({
                                queryId: query.id,
                                color: query.color,
                                similarity: 100, // 包含=100%
                                queryText: query.text,
                            });
                            const noteContent = buildQueryNoteContent(query, 'contains');
                            const noteKey = getQueryLabel(query);
                            if (!cell.note) {
                                cell.note = noteContent;
                            } else if (!cell.note.includes(noteKey)) {
                                cell.note += ` | ${noteContent}`;
                            }
                        });
                    } else {
                        // ===== 相似匹配：MinHash + Jaccard =====
                        const queryShingles = generateShingles(effectiveQueryText);

                        // 为每个单元格计算 Shingles（缓存）
                        cellsToSearch.forEach(c => {
                            if (!shingleCache.current.has(c.text)) {
                                shingleCache.current.set(c.text, generateShingles(c.text));
                            }
                        });

                        cellsToSearch.forEach(c => {
                            const cellShingles = shingleCache.current.get(c.text);
                            if (!cellShingles) return;

                            const similarity = exactJaccard(queryShingles, cellShingles);
                            const effectiveThreshold = query.threshold ?? threshold;
                            if (similarity < effectiveThreshold) return;

                            matchedRows.add(c.row);
                            const cell = updatedRows[c.row][c.col];
                            cell.highlights.push({
                                queryId: query.id,
                                color: query.color,
                                similarity: Math.floor(similarity * 1000) / 10,
                                queryText: query.text,
                            });
                            const similarityPercent = Math.floor(similarity * 1000) / 10;
                            const noteContent = buildQueryNoteContent(query, 'similar', similarityPercent);
                            const noteKey = getQueryLabel(query);
                            if (!cell.note) {
                                cell.note = noteContent;
                            } else if (!cell.note.includes(noteKey)) {
                                cell.note += ` | ${noteContent}`;
                            }
                        });
                    }
                }

                const matchedRowCount = matchedRows.size;

                // 同步设置 table 和 query 状态，确保 resultCount 正确
                setTable({ ...prev, rows: updatedRows });

                const elapsed = Math.round(performance.now() - startTime);
                const modeLabel = searchMode === 'contains' ? '包含搜索' : searchMode === 'embedding' ? 'AI 语义搜索' : searchMode === 'llm' ? 'AI 精判' : 'MinHash + Jaccard';
                updateQuery(query.id, { isSearching: false, resultCount: matchedRowCount, searchDone: true });
                setGlobalProgress(`✅ ${matchedRowCount} 行匹配 (${elapsed}ms, ${modeLabel})`);
                setTimeout(() => setGlobalProgress(''), 3000);
            } catch (err: any) {
                if (err.message !== 'CANCELLED_BY_USER') {
                    console.error('搜索失败:', err);
                    setGlobalProgress(`搜索失败: ${err.message || '未知错误'}`);
                }
                updateQuery(query.id, { isSearching: false });
            } finally {
                searchLockRef.current = false;
            }
        }, 10);
    };

    // ===== 单个搜索项的 AI 搜索 =====
    const executeAiQuerySearch = async (query: SearchQuery) => {
        if (!query.text.trim() || tableRef.current.rows.length === 0) return;

        updateQuery(query.id, { isSearching: true, resultCount: 0 });
        setGlobalProgress(`🤖 AI 搜索中: ${query.text.substring(0, 30)}...`);

        try {
            // 使用全局 AI 实例（与 AI 分类一致，支持 key 轮换）
            let ai: any;
            if (typeof window !== 'undefined' && (window as any).__app_get_ai_instance) {
                ai = (window as any).__app_get_ai_instance();
            } else if (getAiInstance) {
                ai = getAiInstance();
            }
            if (!ai) {
                updateQuery(query.id, { isSearching: false });
                setGlobalProgress('⚠️ 请先配置 API Key');
                setTimeout(() => setGlobalProgress(''), 3000);
                return;
            }

            const prev = tableRef.current;
            const rows = prev.rows;
            const col = searchCol >= 0 ? searchCol : -1;

            // 断点续搜：不清除旧高亮，保留已有结果
            const updatedRows = rows.map(row => row.map(cell => ({ ...cell })));

            // 找出已经有该 query 高亮的行（跳过不重复搜索）
            const alreadyMatchedRows = new Set<number>();
            updatedRows.forEach((row, ri) => {
                if (row.some(cell => cell.highlights.some(h => h.queryId === query.id))) {
                    alreadyMatchedRows.add(ri);
                }
            });

            // 只收集还没搜过的行
            const rowTexts: { idx: number; text: string }[] = [];
            updatedRows.forEach((row, ri) => {
                if (alreadyMatchedRows.has(ri)) return; // 跳过已匹配行
                const texts: string[] = [];
                row.forEach((cell, ci) => {
                    if (col >= 0 && ci !== col) return;
                    if (cell.value.trim()) texts.push(cell.value.trim());
                });
                if (texts.length > 0) {
                    rowTexts.push({ idx: ri, text: texts.join(' | ') });
                }
            });

            if (rowTexts.length === 0) {
                updateQuery(query.id, { isSearching: false });
                const msg = alreadyMatchedRows.size > 0
                    ? `✅ 所有行已搜索完毕（${alreadyMatchedRows.size} 行匹配）`
                    : '⚠️ 表格中没有可搜索的内容';
                setGlobalProgress(msg);
                setTimeout(() => setGlobalProgress(''), 3000);
                return;
            }

            const BATCH = 50;
            let matchedCount = alreadyMatchedRows.size; // 从已有结果开始计数
            const totalRows = rowTexts.length + alreadyMatchedRows.size;

            if (alreadyMatchedRows.size > 0) {
                setGlobalProgress(`🤖 断点续搜（已有 ${alreadyMatchedRows.size} 行，剩余 ${rowTexts.length} 行）...`);
            }

            for (let bStart = 0; bStart < rowTexts.length; bStart += BATCH) {
                const batch = rowTexts.slice(bStart, bStart + BATCH);
                const batchNum = Math.floor(bStart / BATCH) + 1;
                const totalBatches = Math.ceil(rowTexts.length / BATCH);

                if (totalBatches > 1) {
                    setGlobalProgress(`🤖 AI 分析中... (批次 ${batchNum}/${totalBatches})`);
                }

                const dataBlock = batch.map(r => `[ROW ${r.idx + 1}] ${r.text.substring(0, 300)}`).join('\n');

                const prompt = `You are a professional text search assistant. The user wants to find rows that match the search intent.

Search query: "${query.text}"

Table data (each line is a row):
${dataBlock}

INSTRUCTIONS:
- Find ALL rows that are semantically related to the search query
- Consider synonyms, related concepts, similar meanings, and contextual relevance
- For each matching row, provide: row number, a brief reason (in Chinese), and relevance score (1-100)
- If no rows match, return an empty array
- Be thorough - include partial matches with lower relevance scores

Return ONLY a JSON array in this exact format:
[{"row": 1, "reason": "包含相关内容", "relevance": 85}]

If no matches: []`;

                const response = await ai.models.generateContent({
                    model: effectiveModel,
                    contents: prompt,
                });

                const resultText = (response as any).text || '';
                const jsonMatch = resultText.match(/\[[\s\S]*?\]/);
                if (jsonMatch) {
                    try {
                        const parsed: Array<{ row: number; reason: string; relevance: number }> = JSON.parse(jsonMatch[0]);
                        parsed.forEach(item => {
                            const actualIdx = item.row - 1;
                            if (actualIdx >= 0 && actualIdx < rows.length) {
                                matchedCount++;
                                const rowCells = updatedRows[actualIdx];
                                rowCells.forEach((cell, ci) => {
                                    if (col >= 0 && ci !== col) return;
                                    if (!cell.value.trim()) return;
                                    cell.highlights.push({
                                        queryId: query.id,
                                        color: query.color,
                                        similarity: Math.min(100, Math.max(1, item.relevance || 50)),
                                        queryText: query.text,
                                    });
                                    const noteContent = `🤖 AI ${item.relevance}% - ${item.reason || '匹配'}`;
                                    const noteIdTag = `[QID:${query.id}]`;
                                    const fullNote = `${noteIdTag}${noteContent}`;
                                    if (!cell.note) {
                                        cell.note = fullNote;
                                    } else if (!cell.note.includes(noteIdTag)) {
                                        cell.note += ` | ${fullNote}`;
                                    }
                                });
                            }
                        });
                    } catch (parseErr) {
                        console.warn('AI 返回 JSON 解析失败:', parseErr);
                    }
                }

                // ✅ 每批完成后立即更新表格和计数（实时反馈，防止中途失败丢失结果）
                setTable({ ...prev, rows: updatedRows });
                updateQuery(query.id, { isSearching: true, resultCount: matchedCount });
                if (totalBatches > 1) {
                    setGlobalProgress(`🤖 AI 分析中... (${batchNum}/${totalBatches}，已匹配 ${matchedCount} 行)`);
                }
            }

            updateQuery(query.id, { isSearching: false, resultCount: matchedCount });
            setGlobalProgress(`✅ AI 搜索完成: ${matchedCount} 行匹配`);
            setTimeout(() => setGlobalProgress(''), 3000);
        } catch (err: any) {
            const errMsg = err?.message || JSON.stringify(err?.error) || '未知错误';
            const errCode = err?.status || err?.error?.code || '';
            console.error('AI 搜索失败:', errCode, errMsg);

            // 403 / PERMISSION_DENIED → 尝试轮换 key 重试
            if ((errCode === 403 || errMsg.includes('PERMISSION_DENIED') || errMsg.includes('SERVICE_BLOCKED')) 
                && typeof window !== 'undefined' && (window as any).__app_rotate_api_key) {
                console.warn('[AI精判] 403 错误，尝试轮换 API Key...');
                (window as any).__app_rotate_api_key();
                // 不标记失败，让用户重新点击
            }

            updateQuery(query.id, { isSearching: false });
            setGlobalProgress(`❌ AI 搜索失败: ${errMsg.substring(0, 100)}`);
            setTimeout(() => setGlobalProgress(''), 5000);
        }
    };

    // ===== 全部搜索 =====
    const executeAllSearches = () => {
        const activeQueries = queries.filter(q => q.enabled && q.text.trim());
        if (activeQueries.length === 0 || tableRef.current.rows.length === 0) return;
        if (searchLockRef.current) {
            setGlobalProgress('请等待当前搜索任务完成...');
            setTimeout(() => setGlobalProgress(''), 2000);
            return;
        }

        searchLockRef.current = true;
        const activeIds = new Set(activeQueries.map(q => q.id));
        setQueries(prev => prev.map(q =>
            activeIds.has(q.id) ? { ...q, isSearching: true, resultCount: 0, searchDone: false } : q
        ));
        const startTime = performance.now();

        setTimeout(async () => {
            try {
                const resultCounts = new Map<string, number>();

                // ===== 翻译搜索：批量翻译所有搜索项 =====
                const translationMap = new Map<string, string>();
                if (translateEnabled && translateLang) {
                    try {
                        const tm = await translateQueries(activeQueries);
                        tm.forEach((v, k) => translationMap.set(k, v));
                    } catch (err: any) {
                        setGlobalProgress(`⚠️ 翻译失败: ${err.message || '未知'}，使用原文搜索`);
                    }
                }
                // 获取单条查询的有效搜索文本（翻译后或原文）
                const getEffText = (q: SearchQuery) => translationMap.get(q.id) || q.text;
                const prev = tableRef.current;

                // 先清除所有将要重新搜索项的旧高亮及包含它们 ID 的旧备注
                const activeIdTags = activeQueries.map(q => `[QID:${q.id}]`);
                const updatedRows = prev.rows.map(row => row.map(cell => {
                    let newNote = cell.note;
                    if (newNote) {
                        newNote = newNote.split('|')
                            .map(s => s.trim())
                            .filter(s => !activeIdTags.some(tag => s.includes(tag)))
                            .join(' | ')
                            .trim();
                    }
                    return {
                        ...cell,
                        note: newNote,
                        highlights: cell.highlights.filter(h => !activeIds.has(h.queryId)),
                    };
                }));

                // 收集可搜索单元格（所有 query 共用）
                const cellsToSearch: { row: number; col: number; text: string }[] = [];
                updatedRows.forEach((row, ri) => {
                    row.forEach((cell, ci) => {
                        if (searchCol >= 0 && ci !== searchCol) return;
                        const text = cell.value.trim();
                        if (text) cellsToSearch.push({ row: ri, col: ci, text });
                    });
                });

                if (cellsToSearch.length === 0) {
                    activeQueries.forEach(q => resultCounts.set(q.id, 0));
                } else if (searchMode === 'llm') {
                    // LLM 精判模式：逐个查询调用 AI
                    for (const query of activeQueries) {
                        await executeAiQuerySearch(query);
                    }
                    const elapsed = Math.round(performance.now() - startTime);
                    setGlobalProgress(`✅ AI 精判完成 ${activeQueries.length} 项搜索 (${elapsed}ms)`);
                    setTimeout(() => setGlobalProgress(''), 3000);
                    return;
                } else {
                    // Embedding 模式需要异步获取向量
                    if (searchMode === 'embedding') {
                        if (!localEmbeddingService.isReady()) {
                            setGlobalProgress('正在初始化本地 AI 引擎，首次下载需等待...');
                            await localEmbeddingService.initEngine((progress) => {
                                if (progress.status === 'progress') {
                                    setGlobalProgress(`下载 AI 模型中: ${progress.file} - ${Math.round(progress.progress || 0)}%`);
                                } else if (progress.status === 'done') {
                                    setGlobalProgress(`加载完成: ${progress.file}`);
                                }
                            });
                        }

                        // 批量获取单元格 embedding
                        const cache = embeddingCacheRef.current;
                        const needEmbed = cellsToSearch.filter(c => !cache.has(c.text));
                        if (needEmbed.length > 0) {
                            setGlobalProgress(`建立语义索引: ${needEmbed.length} 条缺失索引，已有 ${cellsToSearch.length - needEmbed.length} 条命中缓存...`);
                            const texts = needEmbed.map(c => c.text);
                            const embeddings = await localEmbeddingService.extractEmbeddings(texts, (done, total) => {
                                setGlobalProgress(`建立语义索引 (${done}/${total})，缺失 ${total - done} 条...`);
                            }, { maxBatchChars });
                            embeddings.forEach((emb: number[], idx: number) => {
                                cache.set(needEmbed[idx].text, emb);
                            });
                            setGlobalProgress(`✅ 索引建立完成！全部 ${cellsToSearch.length} 条就绪，开始语义匹配...`);
                        } else {
                            setGlobalProgress(`✅ 全部 ${cellsToSearch.length} 条索引均命中缓存，直接匹配...`);
                        }

                        // 逐个查询搜索
                        for (const query of activeQueries) {
                            const matchedRows = new Set<number>();
                            setGlobalProgress(`🧠 ${query.text.substring(0, 20)}... 语义分析中...`);
                            const effText = getEffText(query);
                            const queryEmbArray = await localEmbeddingService.extractEmbeddings([effText]);
                            const queryEmb = queryEmbArray[0];
                            cellsToSearch.forEach(c => {
                                const cellEmb = cache.get(c.text);
                                if (!cellEmb) return;
                                const similarity = cosineSimilarity(queryEmb, cellEmb);
                                const effectiveThreshold = query.embeddingThreshold ?? embeddingThreshold;
                                if (similarity < effectiveThreshold) return;
                                matchedRows.add(c.row);
                                const cell = updatedRows[c.row][c.col];
                                cell.highlights.push({
                                    queryId: query.id,
                                    color: query.color,
                                    similarity: Math.floor(similarity * 1000) / 10,
                                    queryText: query.text,
                                });
                                const similarityPercent = Math.floor(similarity * 1000) / 10;
                                const noteContent = buildQueryNoteContent(query, 'embedding', similarityPercent);
                                const noteKey = getQueryLabel(query);
                                if (!cell.note) {
                                    cell.note = noteContent;
                                } else if (!cell.note.includes(noteKey)) {
                                    cell.note += ` | ${noteContent}`;
                                }
                            });
                            resultCounts.set(query.id, matchedRows.size);
                        }
                    } else {
                        activeQueries.forEach(query => {
                            const matchedRows = new Set<number>();
                            if (searchMode === 'contains') {
                                const effText = getEffText(query);
                                const queryLower = effText.toLowerCase();
                                cellsToSearch.forEach(c => {
                                    if (!c.text.toLowerCase().includes(queryLower)) return;
                                    matchedRows.add(c.row);
                                    const cell = updatedRows[c.row][c.col];
                                    cell.highlights.push({
                                        queryId: query.id,
                                        color: query.color,
                                        similarity: 100,
                                        queryText: query.text,
                                    });
                                    const noteContent = buildQueryNoteContent(query, 'contains');
                                    const noteIdTag = `[QID:${query.id}]`;
                                    const fullNote = `${noteIdTag}${noteContent}`;
                                    if (!cell.note) {
                                        cell.note = fullNote;
                                    } else if (!cell.note.includes(noteIdTag)) {
                                        cell.note += ` | ${fullNote}`;
                                    }
                                });
                            } else {
                                const effText = getEffText(query);
                                const queryShingles = generateShingles(effText);
                                cellsToSearch.forEach(c => {
                                    if (!shingleCache.current.has(c.text)) {
                                        shingleCache.current.set(c.text, generateShingles(c.text));
                                    }
                                    const cellShingles = shingleCache.current.get(c.text);
                                    if (!cellShingles) return;
                                    const similarity = exactJaccard(queryShingles, cellShingles);
                                    const effectiveThreshold = query.threshold ?? threshold;
                                    if (similarity < effectiveThreshold) return;
                                    matchedRows.add(c.row);
                                    const cell = updatedRows[c.row][c.col];
                                    cell.highlights.push({
                                        queryId: query.id,
                                        color: query.color,
                                        similarity: Math.floor(similarity * 1000) / 10,
                                        queryText: query.text,
                                    });
                                    const similarityPercent = Math.floor(similarity * 1000) / 10;
                                    const noteContent = buildQueryNoteContent(query, 'similar', similarityPercent);
                                    const noteIdTag = `[QID:${query.id}]`;
                                    const fullNote = `${noteIdTag}${noteContent}`;
                                    if (!cell.note) {
                                        cell.note = fullNote;
                                    } else if (!cell.note.includes(noteIdTag)) {
                                        cell.note += ` | ${fullNote}`;
                                    }
                                });
                            }
                            resultCounts.set(query.id, matchedRows.size);
                        });
                    }
                }

                // 同步设置 table 和 query 状态
                setTable({ ...prev, rows: updatedRows });

                setQueries(prev => prev.map(q =>
                    activeIds.has(q.id)
                        ? { ...q, isSearching: false, resultCount: resultCounts.get(q.id) || 0, searchDone: true }
                        : q
                ));

                const totalRows = Array.from(resultCounts.values()).reduce((a, b) => a + b, 0);
                const elapsed = Math.round(performance.now() - startTime);
                const modeLabel = searchMode === 'contains' ? '包含搜索' : searchMode === 'embedding' ? 'AI 语义搜索' : searchMode === 'llm' ? 'AI 精判' : 'MinHash + Jaccard';
                setGlobalProgress(`✅ 已完成 ${activeQueries.length} 项搜索，合计 ${totalRows} 行匹配 (${elapsed}ms, ${modeLabel})`);
                setTimeout(() => setGlobalProgress(''), 3000);
            } catch (err: any) {
                if (err.message === 'CANCELLED_BY_USER') {
                    setGlobalProgress('⏸️ 搜索已被中断！由于开启了【断点续传】，目前的进度已持久化到浏览器硬盘。');
                    setQueries(prev => prev.map(q =>
                        activeIds.has(q.id) ? { ...q, isSearching: false } : q
                    ));
                    setTimeout(() => setGlobalProgress(''), 5000);
                } else {
                    console.error('全部搜索失败:', err);
                    setGlobalProgress(`全部搜索失败: ${err.message || '未知错误'}`);
                    setQueries(prev => prev.map(q =>
                        activeIds.has(q.id) ? { ...q, isSearching: false } : q
                    ));
                }
            } finally {
                searchLockRef.current = false;
            }
        }, 10);
    };

    // ===== 强制中断搜索 =====
    const cancelAllSearches = async () => {
        const isAnySearching = queries.some(q => q.isSearching);
        if (!isAnySearching) return;
        setGlobalProgress('⏸️ 正在强制刹车关停 AI 引擎...');
        await localEmbeddingService.cancelSearch();
        setQueries(prev => prev.map(q => ({ ...q, isSearching: false })));
    };

    // ===== 清除所有高亮 =====
    const clearAllHighlights = () => {
        setTable(prev => ({
            ...prev,
            rows: prev.rows.map(row => row.map(cell => ({
                ...cell, highlights: [], note: '',
            }))),
        }));
        setQueries(prev => prev.map(q => ({ ...q, resultCount: 0 })));
    };

    // TSV 单元格编码：含换行/Tab/引号的文本用引号包裹，保留原始格式
    const tsvCell = (val: string): string => {
        if (val.includes('\n') || val.includes('\r') || val.includes('\t') || val.includes('"')) {
            return '"' + val.replace(/"/g, '""') + '"';
        }
        return val;
    };

    // ===== 复制 HTML 到剪贴板（兼容 Google Sheets） =====
    const copyHtmlToClipboard = (html: string, plainText: string, successMsg: string) => {
        // 对于 Google Sheets 等现代表格，直接传输 Table 片段兼容性更好
        const richHtml = html; 
        if (typeof ClipboardItem !== 'undefined') {
            const htmlBlob = new Blob([richHtml], { type: 'text/html' });
            const textBlob = new Blob([plainText], { type: 'text/plain' });
            navigator.clipboard.write([
                new ClipboardItem({ 
                    'text/html': htmlBlob,
                    'text/plain': textBlob 
                }),
            ]).then(() => {
                setGlobalProgress(successMsg);
                setTimeout(() => setGlobalProgress(''), 3000);
            }).catch(() => {
                execCommandCopy(richHtml, successMsg);
            });
        } else {
            execCommandCopy(richHtml, successMsg);
        }
    };
    const execCommandCopy = (html: string, successMsg: string) => {
        const container = document.createElement('div');
        container.innerHTML = html;
        container.style.position = 'fixed';
        container.style.left = '-9999px';
        container.style.top = '0';
        document.body.appendChild(container);
        const range = document.createRange();
        range.selectNodeContents(container);
        const selection = window.getSelection();
        selection?.removeAllRanges();
        selection?.addRange(range);
        try {
            document.execCommand('copy');
            setGlobalProgress(successMsg);
            setTimeout(() => setGlobalProgress(''), 3000);
        } catch (err) {
            console.error('复制失败:', err);
            setGlobalProgress('复制失败');
        }
        selection?.removeAllRanges();
        document.body.removeChild(container);
    };

    // ===== 复制单个搜索项的匹配结果（仅该搜索项命中的行，整行内容） =====
    const copyQueryResults = useCallback((queryId: string) => {
        const { headers, rows } = table;
        const query = queries.find(q => q.id === queryId);
        const queryLabel = query ? getQueryLabel(query) : '未命名搜索';
        const qColor = query?.color || '#fbbf24';

        // 筛选出该搜索项命中的行
        const matchedRows = rows.filter(row =>
            row.some(cell => cell.highlights.some(h => h.queryId === queryId))
        );
        if (matchedRows.length === 0) return;

        // HTML
        let html = '<table border="1" style="border-collapse:collapse; font-family: sans-serif;">';
        html += '<tr>';
        html += `<th bgcolor="#444444" style="background-color:#444444; color:#ffffff; padding:6px 12px; border:1px solid #999999;"><b>所属搜索组</b></th>`;
        headers.forEach(h => {
            html += `<th bgcolor="#444444" style="background-color:#444444; color:#ffffff; padding:6px 12px; border:1px solid #999999;">${escHtml(h)}</th>`;
        });
        html += '<th bgcolor="#444444" style="background-color:#444444; color:#ffffff; padding:6px 12px; border:1px solid #999999;">备注</th>';
        html += '</tr>';

        matchedRows.forEach(row => {
            html += '<tr>';
            html += `<td bgcolor="#f0f7ff" style="background-color:#f0f7ff; padding:6px 12px; border:1px solid #cccccc; color:#1e40af;"><b>${escHtml(queryLabel)}</b></td>`;
            
            row.forEach(cell => {
                const hit = cell.highlights.find(h => h.queryId === queryId);
                const bg = hit ? qColor : '';
                const textColor = bg ? getContrastColor(bg) : '#000000';
                const style = bg
                    ? `background-color:${bg}; color:${textColor}; padding:6px 12px; border:1px solid #cccccc;`
                    : `padding:6px 12px; border:1px solid #cccccc; color:#000000;`;
                const bgColorAttr = bg ? `bgcolor="${bg}"` : '';
                html += `<td ${bgColorAttr} style="${style}">${escHtml(cell.value)}</td>`;
            });
            const notes = getRowNoteWithSummary(row);
            html += `<td style="padding:6px 12px; border:1px solid #cccccc; color:#666666;">${escHtml(notes)}</td>`;
            html += '</tr>';
        });
        html += '</table>';

        // TSV
        let tsvHeader = '所属搜索组\t' + headers.join('\t') + '\t备注\n';
        let tsvBody = '';
        matchedRows.forEach(row => {
            tsvBody += queryLabel + '\t';
            tsvBody += row.map(c => tsvCell(c.value)).join('\t');
            tsvBody += '\t' + getRowNoteWithSummary(row) + '\n';
        });

        copyHtmlToClipboard(html, tsvHeader + tsvBody, `✅ 已按照搜索组“${queryLabel}”复制 ${matchedRows.length} 行结果`);
    }, [table, queries, getRowNoteWithSummary]);

    // ===== 复制表格（支持筛选模式） =====
    const copyFilteredTable = useCallback((mode: 'all' | 'highlighted' | 'unhighlighted') => {
        const { headers, rows } = table;
        if (rows.length === 0) return;

        // 根据模式筛选行
        const filteredRows = mode === 'all' ? rows
            : mode === 'highlighted' ? rows.filter(row => row.some(cell => cell.highlights.length > 0))
                : rows.filter(row => row.every(cell => cell.highlights.length === 0));

        if (filteredRows.length === 0) {
            setGlobalProgress(mode === 'highlighted' ? '⚠️ 没有高亮行' : '⚠️ 没有未高亮行');
            setTimeout(() => setGlobalProgress(''), 2000);
            return;
        }

        // 检测是否存在 DUP- 编号
        const hasDups = filteredRows.some(row => row.some(c => c.note && c.note.includes('DUP-')));
        // 检测是否有搜素匹配结果（用于生成组列）
        const hasHighlights = filteredRows.some(row => row.some(c => c.highlights.length > 0));

        // 构建 HTML 表格（Excel/Sheets 可识别内联样式）
        let html = '<table border="1" style="border-collapse:collapse; font-family: sans-serif;">';
        // 表头
        html += '<tr>';
        if (hasDups || hasHighlights) {
            html += `<th bgcolor="#444444" style="background-color:#444444; color:#ffffff; padding:6px 12px; border:1px solid #999999;"><b>标注分组/查重号</b></th>`;
        }
        headers.forEach(h => {
            html += `<th bgcolor="#444444" style="background-color:#444444; color:#ffffff; padding:6px 12px; border:1px solid #999999;">${escHtml(h)}</th>`;
        });
        html += `<th bgcolor="#444444" style="background-color:#444444; color:#ffffff; padding:6px 12px; border:1px solid #999999;">备注</th>`;
        html += '</tr>';

        // 数据行
        filteredRows.forEach(row => {
            html += '<tr>';
            if (hasDups || hasHighlights) {
                const marks: string[] = [];
                const dupMatch = row.find(c => c.note && c.note.includes('DUP-'))?.note?.match(/DUP-\d+/);
                if (dupMatch) marks.push(dupMatch[0]);
                const matchedQueryIds = new Set<string>();
                row.forEach(c => c.highlights.forEach(h => matchedQueryIds.add(h.queryId)));
                matchedQueryIds.forEach(id => {
                    const q = queries.find(q => q.id === id);
                    const qLabel = q ? getQueryLabel(q) : undefined;
                    if (qLabel) marks.push(qLabel);
                });
                const groupVal = marks.join(' | ');
                html += `<td bgcolor="#fffbeb" style="background-color:#fffbeb; padding:6px 12px; border:1px solid #cccccc; color:#b45309;"><b>${escHtml(groupVal)}</b></td>`;
            }
            row.forEach(cell => {
                const bg = cell.highlights.length > 0 ? cell.highlights[0].color : '';
                const textColor = bg ? getContrastColor(bg) : '#000000';
                const style = bg
                    ? `background-color:${bg}; color:${textColor}; padding:6px 12px; border:1px solid #cccccc;`
                    : `padding:6px 12px; border:1px solid #cccccc; color:#000000;`;
                const bgColorAttr = bg ? `bgcolor="${bg}"` : '';
                html += `<td ${bgColorAttr} style="${style}">${escHtml(cell.value)}</td>`;
            });
            const notes = getRowNoteWithSummary(row);
            html += `<td style="padding:6px 12px; border:1px solid #cccccc; color:#666666;">${escHtml(notes)}</td>`;
            html += '</tr>';
        });
        html += '</table>';

        // TSV
        let tsvHeader = (hasDups || hasHighlights ? '标注分组/查重号\t' : '') + headers.join('\t') + '\t备注\n';
        let tsvBody = '';
        filteredRows.forEach(row => {
            if (hasDups || hasHighlights) {
                const marks: string[] = [];
                const dupMatch = row.find(c => c.note && c.note.includes('DUP-'))?.note?.match(/DUP-\d+/);
                if (dupMatch) marks.push(dupMatch[0]);
                const matchedQueryIds = new Set<string>();
                row.forEach(c => c.highlights.forEach(h => matchedQueryIds.add(h.queryId)));
                matchedQueryIds.forEach(id => {
                    const q = queries.find(q => q.id === id);
                    const qLabel = q ? getQueryLabel(q) : undefined;
                    if (qLabel) marks.push(qLabel);
                });
                tsvBody += marks.join(' | ') + '\t';
            }
            tsvBody += row.map(c => tsvCell(c.value)).join('\t');
            tsvBody += '\t' + getRowNoteWithSummary(row) + '\n';
        });

        const labels = { all: '全部', highlighted: '高亮', unhighlighted: '未高亮' };
        copyHtmlToClipboard(html, tsvHeader + tsvBody, `✅ 已复制 ${filteredRows.length} 行${labels[mode]}数据`);
    }, [table, queries, getRowNoteWithSummary]);

    const copyTableWithColors = useCallback(() => copyFilteredTable('all'), [copyFilteredTable]);
    const copyHighlightedOnly = useCallback(() => copyFilteredTable('highlighted'), [copyFilteredTable]);
    const copyUnhighlightedOnly = useCallback(() => copyFilteredTable('unhighlighted'), [copyFilteredTable]);

    // ===== 自动查重：用 Union-Find 聚类相似文案（支持 Jaccard / Embedding 两种模式）=====
    const autoDedup = useCallback(async () => {
        const { rows } = table;
        if (rows.length === 0) return;

        const useEmbedding = searchMode === 'embedding';
        const col = searchCol;
        const allCols = col < 0;

        // 1. 收集每行的文本
        const texts: { text: string; rowIdx: number; highlightCol: number }[] = [];
        rows.forEach((row, ri) => {
            let cellVal = '';
            let firstNonEmptyCol = 0;
            if (allCols) {
                const parts: string[] = [];
                row.forEach((cell, ci) => {
                    if (cell.value.trim()) {
                        parts.push(cell.value.trim());
                        if (firstNonEmptyCol === 0 && parts.length === 1) firstNonEmptyCol = ci;
                    }
                });
                cellVal = parts.join(' ');
            } else {
                cellVal = row[col]?.value || '';
                firstNonEmptyCol = col;
            }
            if (cellVal.trim()) {
                texts.push({ text: cellVal, rowIdx: ri, highlightCol: firstNonEmptyCol });
            }
        });

        if (texts.length < 2) {
            setGlobalProgress('⚠️ 至少需要 2 行非空文本才能查重');
            setTimeout(() => setGlobalProgress(''), 3000);
            return;
        }

        // 2. Union-Find
        const parent = new Map<number, number>();
        const find = (x: number): number => {
            if (!parent.has(x)) parent.set(x, x);
            if (parent.get(x) !== x) parent.set(x, find(parent.get(x)!));
            return parent.get(x)!;
        };
        const union = (a: number, b: number) => {
            const ra = find(a), rb = find(b);
            if (ra !== rb) parent.set(ra, rb);
        };

        if (useEmbedding) {
            // ===== 语义查重模式 =====
            setGlobalProgress('🧠 初始化语义引擎...');
            if (!localEmbeddingService.isReady()) {
                await localEmbeddingService.initEngine((progress) => {
                    setGlobalProgress(`🧠 加载模型: ${progress}`);
                });
            }

            // 计算 embeddings
            const cache = embeddingCacheRef.current;
            const needEmbed = texts.filter(t => !cache.has(t.text));
            if (needEmbed.length > 0) {
                setGlobalProgress(`🧠 建立语义索引 (${needEmbed.length} 条)...`);
                const embTexts = needEmbed.map(t => t.text);
                const embeddings = await localEmbeddingService.extractEmbeddings(embTexts, (done, total) => {
                    setGlobalProgress(`🧠 建立语义索引 (${done}/${total})...`);
                });
                embeddings.forEach((emb: number[], idx: number) => {
                    cache.set(needEmbed[idx].text, emb);
                });
            }

            setGlobalProgress(`🧠 正在两两比对语义相似度 (${texts.length} 条)...`);
            const effThreshold = embeddingThreshold;

            // 两两比较 cosine similarity
            for (let i = 0; i < texts.length; i++) {
                const embA = cache.get(texts[i].text);
                if (!embA) continue;
                for (let j = i + 1; j < texts.length; j++) {
                    const embB = cache.get(texts[j].text);
                    if (!embB) continue;
                    const sim = cosineSimilarity(embA, embB);
                    if (sim >= effThreshold) {
                        union(texts[i].rowIdx, texts[j].rowIdx);
                    }
                }
                // 每 50 行更新进度
                if (i % 50 === 0) {
                    setGlobalProgress(`🧠 语义比对中 (${i}/${texts.length})...`);
                    await new Promise(r => setTimeout(r, 0));
                }
            }
        } else {
            // ===== Jaccard 查重模式 =====
            setGlobalProgress('🔍 正在自动查重 (Jaccard)...');

            // 生成 shingles
            const shingleList: Set<string>[] = texts.map((t, idx) => {
                const key = `auto_${t.rowIdx}_${allCols ? 'all' : col}`;
                if (!shingleCache.current.has(key)) {
                    shingleCache.current.set(key, generateShingles(t.text));
                }
                return shingleCache.current.get(key)!;
            });

            for (let i = 0; i < texts.length; i++) {
                for (let j = i + 1; j < texts.length; j++) {
                    const sim = exactJaccard(shingleList[i], shingleList[j]);
                    if (sim >= threshold) {
                        union(texts[i].rowIdx, texts[j].rowIdx);
                    }
                }
            }
        }

        // 3. 分组
        const groups = new Map<number, number[]>();
        texts.forEach(t => {
            const root = find(t.rowIdx);
            if (!groups.has(root)) groups.set(root, []);
            groups.get(root)!.push(t.rowIdx);
        });

        // 4. 过滤出有重复的组
        const dupGroups = Array.from(groups.values()).filter(g => g.length > 1);
        if (dupGroups.length === 0) {
            setGlobalProgress('✅ 没有发现重复文案');
            setTimeout(() => setGlobalProgress(''), 3000);
            return;
        }

        // 5. 清除旧高亮，分配颜色
        const rowHighlightColMap = new Map<number, number>();
        texts.forEach(t => rowHighlightColMap.set(t.rowIdx, t.highlightCol));

        const modeLabel = useEmbedding ? '🧠 语义重复' : '🔁 重复';
        const newRows = rows.map(row => row.map(cell => ({ ...cell, highlights: [], note: '' })));
        dupGroups.forEach((group, gi) => {
            const color = getQueryColor(gi);
            group.forEach(rowIdx => {
                const targetCol = allCols ? (rowHighlightColMap.get(rowIdx) ?? 0) : col;
                const cell = newRows[rowIdx][targetCol];
                if (cell) {
                    cell.highlights = [{ queryId: `auto_group_${gi}`, color, similarity: 100, queryText: `重复组${gi + 1}` }];
                    const tag = `DUP-${String(gi + 1).padStart(3, '0')}`;
                    cell.note = `${tag} | ${modeLabel}组 ${gi + 1}（共 ${group.length} 条）`;
                }
            });
        });

        setTable(prev => ({ ...prev, rows: newRows }));
        const totalDups = dupGroups.reduce((a, g) => a + g.length, 0);
        const modeStr = useEmbedding ? '语义' : 'Jaccard';
        setGlobalProgress(`✅ [${modeStr}] 发现 ${dupGroups.length} 组重复，共 ${totalDups} 条文案`);
        setTimeout(() => setGlobalProgress(''), 4000);
    }, [table, searchCol, threshold, searchMode, embeddingThreshold]);

    const sortTable = useCallback((mode: 'original' | 'color' | 'match' | 'query') => {
        setSortMode(mode);
        if (mode === 'original') {
            if (originalRowsRef.current) {
                setTable(prev => {
                    const restored: CellData[][] = [];
                    const used = new Set<number>();
                    for (const origRow of originalRowsRef.current!) {
                        const key = origRow.map(c => c.value).join('\t');
                        const idx = prev.rows.findIndex((r, i) => !used.has(i) && r.map(c => c.value).join('\t') === key);
                        if (idx >= 0) { restored.push(prev.rows[idx]); used.add(idx); }
                    }
                    prev.rows.forEach((r, i) => { if (!used.has(i)) restored.push(r); });
                    return { ...prev, rows: restored };
                });
            }
            setGlobalProgress('\u2705 \u5df2\u6062\u590d\u539f\u59cb\u987a\u5e8f');
        } else {
            setTable(prev => {
                const sorted = [...prev.rows];
                if (mode === 'color') {
                    sorted.sort((a, b) => {
                        const aColor = a.find(c => c.highlights.length > 0)?.highlights[0].color || '';
                        const bColor = b.find(c => c.highlights.length > 0)?.highlights[0].color || '';
                        if (aColor && !bColor) return -1;
                        if (!aColor && bColor) return 1;
                        if (aColor !== bColor) return aColor.localeCompare(bColor);
                        return 0;
                    });
                } else if (mode === 'match') {
                    sorted.sort((a, b) => {
                        const aMax = Math.max(0, ...a.flatMap(c => c.highlights.map(h => h.similarity)));
                        const bMax = Math.max(0, ...b.flatMap(c => c.highlights.map(h => h.similarity)));
                        return bMax - aMax;
                    });
                } else if (mode === 'query') {
                    const queryOrder = queries.map(q => q.id);
                    sorted.sort((a, b) => {
                        const aFirst = Math.min(...a.flatMap(c => c.highlights.map(h => {
                            const idx = queryOrder.indexOf(h.queryId);
                            return idx >= 0 ? idx : 999;
                        })), 999);
                        const bFirst = Math.min(...b.flatMap(c => c.highlights.map(h => {
                            const idx = queryOrder.indexOf(h.queryId);
                            return idx >= 0 ? idx : 999;
                        })), 999);
                        if (aFirst !== bFirst) return aFirst - bFirst;
                        const aMax = Math.max(0, ...a.flatMap(c => c.highlights.map(h => h.similarity)));
                        const bMax = Math.max(0, ...b.flatMap(c => c.highlights.map(h => h.similarity)));
                        return bMax - aMax;
                    });
                }
                return { ...prev, rows: sorted };
            });
            const labels: Record<string, string> = { color: '\u2705 \u5df2\u6309\u989c\u8272\u5206\u7ec4\u6392\u5e8f', match: '\u2705 \u5df2\u6309\u5339\u914d\u5ea6\u6392\u5e8f', query: '\u2705 \u5df2\u6309\u641c\u7d22\u9879\u987a\u5e8f\u6392\u5e8f' };
            setGlobalProgress(labels[mode] || '');
        }
        setTimeout(() => setGlobalProgress(''), 2000);
    }, [queries]);

    // ===== AI 智能搜索 =====
    const executeAiSearch = useCallback(async () => {
        if (!aiSearchQuery.trim()) return;

        const { rows } = table;
        if (rows.length === 0) return;

        setAiSearching(true);
        setAiSearchError('');
        setAiSearchResults([]);
        setGlobalProgress('🤖 AI 正在分析表格数据...');

        try {
            // 使用全局 AI 实例（与 AI 分类一致，支持 key 轮换）
            let ai: any;
            if (typeof window !== 'undefined' && (window as any).__app_get_ai_instance) {
                ai = (window as any).__app_get_ai_instance();
            } else if (getAiInstance) {
                ai = getAiInstance();
            }
            if (!ai) {
                setAiSearchError('请先在设置中配置 API Key');
                setAiSearching(false);
                setGlobalProgress('');
                return;
            }

            // 收集搜索列的文本
            const col = searchCol >= 0 ? searchCol : -1;
            const rowTexts: { idx: number; text: string }[] = [];
            rows.forEach((row, ri) => {
                const texts: string[] = [];
                row.forEach((cell, ci) => {
                    if (col >= 0 && ci !== col) return;
                    if (cell.value.trim()) texts.push(cell.value.trim());
                });
                if (texts.length > 0) {
                    rowTexts.push({ idx: ri, text: texts.join(' | ') });
                }
            });

            if (rowTexts.length === 0) {
                setAiSearchError('表格中没有可搜索的内容');
                setAiSearching(false);
                setGlobalProgress('');
                return;
            }

            // 分批处理（每批最多 50 行）
            const BATCH = 50;
            const allResults: AiSearchResult[] = [];

            for (let bStart = 0; bStart < rowTexts.length; bStart += BATCH) {
                const batch = rowTexts.slice(bStart, bStart + BATCH);
                const batchNum = Math.floor(bStart / BATCH) + 1;
                const totalBatches = Math.ceil(rowTexts.length / BATCH);

                if (totalBatches > 1) {
                    setGlobalProgress(`🤖 AI 分析中... (批次 ${batchNum}/${totalBatches})`);
                }

                const dataBlock = batch.map(r => `[ROW ${r.idx + 1}] ${r.text.substring(0, 300)}`).join('\n');

                const prompt = `You are a professional text search assistant. The user wants to find rows that match the search intent.

Search query: "${aiSearchQuery}"

Table data (each line is a row):
${dataBlock}

INSTRUCTIONS:
- Find ALL rows that are semantically related to the search query
- Consider synonyms, related concepts, similar meanings, and contextual relevance
- For each matching row, provide: row number, a brief reason (in Chinese), and relevance score (1-100)
- If no rows match, return an empty array
- Be thorough - include partial matches with lower relevance scores

Return ONLY a JSON array in this exact format:
[{"row": 1, "reason": "包含相关内容", "relevance": 85}]

If no matches: []`;

                const response = await ai.models.generateContent({
                    model: effectiveModel,
                    contents: prompt,
                });

                const resultText = (response as any).text || '';
                const jsonMatch = resultText.match(/\[[\s\S]*?\]/);
                if (jsonMatch) {
                    try {
                        const parsed: Array<{ row: number; reason: string; relevance: number }> = JSON.parse(jsonMatch[0]);
                        parsed.forEach(item => {
                            // AI 返回的是 1-based row number
                            const actualIdx = item.row - 1;
                            if (actualIdx >= 0 && actualIdx < rows.length) {
                                allResults.push({
                                    rowIndex: actualIdx,
                                    reason: item.reason || '匹配',
                                    relevance: Math.min(100, Math.max(1, item.relevance || 50)),
                                });
                            }
                        });
                    } catch (parseErr) {
                        console.warn('AI 返回 JSON 解析失败:', parseErr);
                    }
                }
            }

            // 按相关度排序
            allResults.sort((a, b) => b.relevance - a.relevance);
            setAiSearchResults(allResults);

            // 高亮匹配的行
            if (allResults.length > 0) {
                const aiColor = '#a78bfa'; // 紫色
                const aiQueryId = `ai_search_${Date.now()}`;

                setTable(prev => {
                    const newRows = prev.rows.map((row, ri) => {
                        const match = allResults.find(r => r.rowIndex === ri);
                        if (!match) return row;

                        return row.map(cell => {
                            // 只给搜索列的单元格添加高亮
                            const col = searchCol >= 0 ? searchCol : -1;
                            if (col >= 0 && row.indexOf(cell) !== col) return cell;
                            if (!cell.value.trim()) return cell;

                            return {
                                ...cell,
                                highlights: [
                                    ...cell.highlights.filter(h => !h.queryId.startsWith('ai_search_')),
                                    {
                                        queryId: aiQueryId,
                                        color: aiColor,
                                        similarity: match.relevance,
                                        queryText: `AI: ${aiSearchQuery}`,
                                    },
                                ],
                                note: cell.note
                                    ? (cell.note.includes('🤖') ? cell.note : `${cell.note} | 🤖 ${match.reason} (${match.relevance}%)`)
                                    : `🤖 ${match.reason} (${match.relevance}%)`,
                            };
                        });
                    });
                    return { ...prev, rows: newRows };
                });
            }

            setGlobalProgress(
                allResults.length > 0
                    ? `🤖 AI 搜索完成！找到 ${allResults.length} 条相关结果`
                    : '🤖 AI 搜索完成，未找到相关内容'
            );
            setTimeout(() => setGlobalProgress(''), 4000);
        } catch (err: any) {
            console.error('AI 搜索失败:', err);
            const errMsg = err.message || '未知错误';
            setAiSearchError(`AI 搜索失败: ${errMsg}`);
            setGlobalProgress(`❌ AI 搜索失败: ${errMsg}`);
            setTimeout(() => setGlobalProgress(''), 4000);
        } finally {
            setAiSearching(false);
        }
    }, [aiSearchQuery, table, searchCol, getAiInstance]);

    // 清除 AI 搜索结果
    const clearAiSearch = useCallback(() => {
        setAiSearchResults([]);
        setAiSearchQuery('');
        setAiSearchError('');
        // 清除 AI 高亮
        setTable(prev => ({
            ...prev,
            rows: prev.rows.map(row => row.map(cell => ({
                ...cell,
                highlights: cell.highlights.filter(h => !h.queryId.startsWith('ai_search_')),
                note: cell.note.replace(/\s*\|?\s*🤖[^|]*/g, '').trim(),
            }))),
        }));
    }, []);

    // 导航到 AI 搜索结果
    const navigateToAiResult = useCallback((rowIdx: number) => {
        const el = tableContainerRef.current?.querySelector(`[data-row-idx="${rowIdx}"]`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
            if (el instanceof HTMLElement) {
                el.style.outline = '2px solid #a78bfa';
                setTimeout(() => { el.style.outline = ''; }, 2000);
            }
        }
    }, []);

    // ===== 辅助 =====
    const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '&#10;');

    const getContrastColor = (color: string): string => {
        if (!color) return '#18181b';
        if (color.startsWith('hsl')) {
            // 解析 hsl(hue, sat%, light%)
            const match = color.match(/hsl\(.*,\s*.*,\s*(\d+)%\)/);
            const lightness = match ? parseInt(match[1]) : 50;
            // 亮度大于 60% 用黑字，否则用白字
            return lightness > 60 ? '#18181b' : '#ffffff';
        }
        // 处理 HEX
        const r = parseInt(color.slice(1, 3), 16);
        const g = parseInt(color.slice(3, 5), 16);
        const b = parseInt(color.slice(5, 7), 16);
        return (r * 299 + g * 587 + b * 114) / 1000 > 128 ? '#18181b' : '#ffffff';
    };

    // 统计高亮数
    // 匹配行索引列表（用于导航）
    const matchedRowIndices = useMemo(() => {
        const indices: number[] = [];
        table.rows.forEach((row, ri) => {
            if (row.some(c => c.highlights.length > 0)) indices.push(ri);
        });
        return indices;
    }, [table.rows]);
    const totalHighlights = matchedRowIndices.length;

    // 当前聚焦的匹配项索引
    const [focusedMatchIdx, setFocusedMatchIdx] = useState(-1);

    // 导航到下一个匹配
    const navigateMatch = useCallback((direction: 'next' | 'prev') => {
        if (matchedRowIndices.length === 0) return;
        let newIdx: number;
        if (direction === 'next') {
            newIdx = focusedMatchIdx < matchedRowIndices.length - 1 ? focusedMatchIdx + 1 : 0;
        } else {
            newIdx = focusedMatchIdx > 0 ? focusedMatchIdx - 1 : matchedRowIndices.length - 1;
        }
        setFocusedMatchIdx(newIdx);
        // 滚动到目标行
        const rowIdx = matchedRowIndices[newIdx];
        const el = tableContainerRef.current?.querySelector(`[data-row-idx="${rowIdx}"]`);
        if (el) {
            el.scrollIntoView({ behavior: 'smooth', block: 'center' });
        }
    }, [matchedRowIndices, focusedMatchIdx]);

    // ===== 渲染 =====
    return (
        <>
            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 6px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #3f3f46;
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #52525b;
                }
            [data-tip] { position: relative; }
            [data-tip]::after {
                content: attr(data-tip);
                position: absolute;
                top: calc(100% + 6px);
                bottom: auto;
                left: 50%;
                transform: translateX(-50%);
                margin-top: 0;
                padding: 5px 10px;
                background: #27272a;
                color: #e4e4e7;
                font-size: 11px;
                font-weight: 500;
                white-space: normal;
                width: max-content;
                max-width: 400px;
                text-align: center;
                word-break: break-word;
                border-radius: 6px;
                border: 1px solid #3f3f46;
                pointer-events: none;
                opacity: 0;
                transition: opacity 0.15s;
                z-index: 999;
                box-shadow: 0 4px 12px rgba(0,0,0,0.4);
            }
            [data-tip]:hover::after {
                opacity: 1;
                transition-delay: 0.4s;
            }
        `}</style>
            <div style={{
                display: 'flex', flexDirection: 'column', height: '100%', width: '100%',
                background: '#09090b', color: '#e4e4e7', fontFamily: 'Inter, system-ui, sans-serif',
            }}>
                {/* 头部 */}
                <div style={{
                    padding: '12px 16px', borderBottom: '1px solid #27272a',
                    background: 'rgba(9,9,11,0.95)', backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ background: 'rgba(251,191,36,0.15)', padding: '6px', borderRadius: '8px' }}>
                            <Search size={18} style={{ color: '#fbbf24' }} />
                        </div>
                        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: '#fafafa' }}>
                            专业文案查重搜索
                        </h2>
                        <span style={{ fontSize: '11px', color: '#71717a', background: '#27272a', padding: '2px 8px', borderRadius: '4px' }}>
                            MinHash + LSH
                        </span>
                    </div>

                    <div style={{ flex: 1 }} />

                    {table.rows.length > 0 && (
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px', color: '#a1a1aa' }}>
                            <span>{table.rows.length} 行 × {table.headers.length} 列</span>
                            {totalHighlights > 0 && (
                                <>
                                    <span style={{ color: '#fbbf24', fontWeight: 600 }}>
                                        | {focusedMatchIdx >= 0 ? `${focusedMatchIdx + 1}/${totalHighlights}` : `${totalHighlights} 匹配`}
                                    </span>
                                    <button onClick={() => navigateMatch('prev')}
                                        style={{ ...btnSmStyle, color: '#fbbf24', padding: '2px' }} data-tip="上一个">
                                        <ChevronUp size={14} />
                                    </button>
                                    <button onClick={() => navigateMatch('next')}
                                        style={{ ...btnSmStyle, color: '#fbbf24', padding: '2px' }} data-tip="下一个">
                                        <ChevronDown size={14} />
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                        {table.rows.length > 0 && (
                            <>
                                <button onClick={() => { setShowPasteArea(!showPasteArea); setAppendMode(false); }}
                                    style={btnStyle('#27272a')} data-tip={'重新导入表格数据（替换现有）'}>
                                    <Upload size={14} /> {'重新粘贴'}
                                </button>
                                <button onClick={() => { setShowPasteArea(true); setAppendMode(true); }}
                                    style={btnStyle('#1e3a5f')} data-tip={'在现有数据后追加新数据（不清空已有行）'}>
                                    <Plus size={14} /> {'补充粘贴'}
                                </button>
                                {table.headers.length >= 2 && (
                                    <button onClick={() => {
                                        // 自动整理列顺序：英文→列1，中文→列2
                                        setTable(prev => {
                                            let swapCount = 0;
                                            let totalChecked = 0;
                                            const newRows = prev.rows.map(row => {
                                                if (row.length < 2) return row;
                                                const col0 = row[0].value.trim();
                                                const col1 = row[1].value.trim();
                                                if (!col0 && !col1) return row;
                                                totalChecked++;
                                                // 如果第一列是中文、第二列不是中文 → 交换
                                                const col0IsChinese = isMostlyChinese(col0);
                                                const col1IsChinese = isMostlyChinese(col1);
                                                if (col0IsChinese && !col1IsChinese && col1) {
                                                    swapCount++;
                                                    const newRow = [...row];
                                                    newRow[0] = { ...row[1] };
                                                    newRow[1] = { ...row[0] };
                                                    return newRow;
                                                }
                                                return row;
                                            });
                                            setGlobalProgress(`✅ 列顺序整理完成：${swapCount}/${totalChecked} 行已交换（英文→列1，中文→列2）`);
                                            setTimeout(() => setGlobalProgress(''), 3000);
                                            shingleCache.current.clear();
                                            return { ...prev, rows: newRows };
                                        });
                                    }} style={btnStyle('#1e40af')} data-tip="自动检测中英文，确保英文在第一列、中文在第二列">
                                        <Columns size={14} /> 整理列顺序
                                    </button>
                                )}
                                <button onClick={() => setTable(prev => ({ ...prev, noteColumnVisible: !prev.noteColumnVisible }))}
                                    style={btnStyle('#27272a')}
                                    data-tip={table.noteColumnVisible ? '隐藏备注列' : '显示备注列'}
                                >
                                    {table.noteColumnVisible ? <EyeOff size={14} /> : <Eye size={14} />}
                                    备注列
                                </button>
                                <button onClick={copyTableWithColors} style={btnStyle('#854d0e')} data-tip="复制整个表格到 Excel/Sheets，匹配行带有背景色">
                                    <Copy size={14} /> 复制整表（含颜色）
                                </button>
                                <button onClick={copyHighlightedOnly} style={btnStyle('#166534')} data-tip="仅复制有搜索匹配的行，带背景色">
                                    <Copy size={14} /> 仅高亮
                                </button>
                                <button onClick={copyUnhighlightedOnly} style={btnStyle('#1e3a5f')} data-tip="仅复制没有被任何搜索项匹配到的行">
                                    <Copy size={14} /> 仅未高亮
                                </button>
                                <span style={{ width: '1px', height: '20px', background: '#3f3f46' }} />
                                <button onClick={autoDedup} style={btnStyle('#5b21b6')} data-tip={searchMode === 'embedding' ? '使用语义相似度自动查重（基于 Embedding 余弦相似度）' : '自动比对所有行，将相似文案按颜色分组（基于 Jaccard）'}>
                                    <Search size={14} /> {searchMode === 'embedding' ? '🧠 语义查重' : '自动查重'}
                                </button>
                                <select
                                    value={sortMode}
                                    onChange={e => sortTable(e.target.value as 'original' | 'color' | 'match' | 'query')}
                                    style={{
                                        background: '#27272a', color: '#e4e4e7',
                                        border: '1px solid #3f3f46', borderRadius: '6px',
                                        padding: '5px 8px', fontSize: '12px', fontWeight: 600,
                                        cursor: 'pointer', outline: 'none',
                                    }}
                                >
                                    <option value="original">{'↕ 原始顺序'}</option>
                                    <option value="color">{'🎨 按颜色排序'}</option>
                                    <option value="match">{'🎯 按匹配度排序'}</option>
                                    <option value="query">{'📝 按搜索项顺序'}</option>
                                </select>
                                <span style={{ width: '1px', height: '20px', background: '#3f3f46' }} />
                                <button onClick={clearAllHighlights} style={btnStyle('#7f1d1d')} data-tip="清除所有搜索项的高亮标记，保留数据">
                                    <RotateCcw size={14} /> 清除高亮
                                </button>
                                <button onClick={() => {
                                    setQueries([{ id: uuidv4(), text: '', noteText: '', color: getQueryColor(0), enabled: true, isSearching: false, resultCount: 0 }]);
                                    setTable({ headers: [], rows: [], noteColumnVisible: false });
                                    setShowPasteArea(true);
                                    setPasteInput('');
                                    setPasteHtml('');
                                    shingleCache.current.clear();
                                }} style={btnStyle('#450a0a')} data-tip="清空所有搜索项和导入数据">
                                    <Trash2 size={14} /> 清空全部
                                </button>
                            </>
                        )}
                    </div>
                </div>

                {/* 进度条 */}
                {globalProgress && (
                    <div style={{
                        padding: '6px 16px', background: 'rgba(251,191,36,0.08)',
                        borderBottom: '1px solid rgba(251,191,36,0.2)',
                        fontSize: '12px', color: '#fbbf24', display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                        {globalProgress.includes('...') && <Loader2 size={14} className="animate-spin" />}
                        {globalProgress}
                    </div>
                )}

                {/* 语义索引状态 - 固定显示 */}
                {searchMode === 'embedding' && table.rows.length > 0 && (() => {
                    const cache = embeddingCacheRef.current;
                    const col = searchCol;
                    const allCols = col < 0;
                    const uniqueTexts = new Set<string>();
                    table.rows.forEach(row => {
                        if (allCols) {
                            row.forEach(cell => { if (cell.value.trim()) uniqueTexts.add(cell.value.trim()); });
                        } else {
                            const val = row[col]?.value?.trim();
                            if (val) uniqueTexts.add(val);
                        }
                    });
                    const total = uniqueTexts.size;
                    let cached = 0;
                    uniqueTexts.forEach(t => { if (cache.has(t)) cached++; });
                    const percent = total > 0 ? Math.round(cached / total * 100) : 0;
                    const isFull = cached === total && total > 0;
                    const isEmpty = cached === 0;
                    return (
                        <div style={{
                            padding: '4px 16px',
                            background: isFull ? 'rgba(52,211,153,0.06)' : isEmpty ? 'rgba(113,113,122,0.06)' : 'rgba(251,191,36,0.06)',
                            borderBottom: `1px solid ${isFull ? 'rgba(52,211,153,0.15)' : isEmpty ? 'rgba(113,113,122,0.1)' : 'rgba(251,191,36,0.15)'}`,
                            fontSize: '11px',
                            color: isFull ? '#34d399' : isEmpty ? '#71717a' : '#fbbf24',
                            display: 'flex', alignItems: 'center', gap: '8px',
                        }}>
                            <span style={{
                                display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%',
                                background: isFull ? '#34d399' : isEmpty ? '#52525b' : '#fbbf24',
                                boxShadow: isFull ? '0 0 6px rgba(52,211,153,0.5)' : 'none',
                            }} />
                            <span>
                                {isFull
                                    ? `✅ 语义索引已就绪（${cached} 条全部缓存）`
                                    : isEmpty
                                        ? `⚠️ 尚未建立语义索引（共 ${total} 条文案）— 搜索时自动建立`
                                        : `🟡 语义索引: ${cached}/${total} 条已缓存（${percent}%）— 缺少 ${total - cached} 条`
                                }
                            </span>
                            {/* 进度条 */}
                            {!isEmpty && (
                                <div style={{
                                    flex: 1, maxWidth: '120px', height: '3px', borderRadius: '2px',
                                    background: 'rgba(255,255,255,0.06)',
                                    overflow: 'hidden',
                                }}>
                                    <div style={{
                                        width: `${percent}%`, height: '100%', borderRadius: '2px',
                                        background: isFull ? '#34d399' : '#fbbf24',
                                        transition: 'width 0.3s',
                                    }} />
                                </div>
                            )}
                            {/* 建立索引按钮 */}
                            {!isFull && (
                                <button
                                    onClick={prebuildEmbeddingIndex}
                                    disabled={isPrebuilding}
                                    style={{
                                        padding: '2px 10px', fontSize: '11px', fontWeight: 600,
                                        background: isPrebuilding ? '#27272a' : 'rgba(52,211,153,0.15)',
                                        color: isPrebuilding ? '#71717a' : '#34d399',
                                        border: `1px solid ${isPrebuilding ? '#3f3f46' : 'rgba(52,211,153,0.3)'}`,
                                        borderRadius: '4px', cursor: isPrebuilding ? 'not-allowed' : 'pointer',
                                        whiteSpace: 'nowrap', flexShrink: 0,
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    {isPrebuilding ? '⚙️ 建立中...' : `🚀 建立索引${!isEmpty ? ` (剩余 ${total - cached})` : ''}`}
                                </button>
                            )}
                            {/* 导出/导入索引 */}
                            <span style={{ width: '1px', height: '12px', background: '#3f3f46', flexShrink: 0 }} />
                            {cached > 0 && (
                                <button onClick={exportEmbeddingIndex} style={{
                                    padding: '2px 8px', fontSize: '10px', fontWeight: 500,
                                    background: 'transparent', color: '#71717a',
                                    border: '1px solid #3f3f46', borderRadius: '3px',
                                    cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                                }}>
                                    {'💾 导出索引'}
                                </button>
                            )}
                            <button onClick={() => importEmbeddingIndexRef.current?.click()} style={{
                                padding: '2px 8px', fontSize: '10px', fontWeight: 500,
                                background: 'transparent', color: '#71717a',
                                border: '1px solid #3f3f46', borderRadius: '3px',
                                cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                            }}>
                                {'📂 导入索引'}
                            </button>
                            <input
                                ref={importEmbeddingIndexRef}
                                type="file" accept=".json"
                                onChange={handleImportEmbeddingFile}
                                style={{ display: 'none' }}
                            />
                            {/* 自动保存开关 */}
                            <span style={{ width: '1px', height: '12px', background: '#3f3f46', flexShrink: 0 }} />
                            <label
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    fontSize: '10px', color: autoSaveIndex ? '#34d399' : '#52525b',
                                    cursor: 'pointer', flexShrink: 0, userSelect: 'none',
                                }}
                                data-tip={autoSaveIndex ? '已开启：索引自动保存到浏览器，下次打开自动恢复' : '已关闭：索引不会持久化，刷新后丢失'}
                            >
                                <input
                                    type="checkbox" checked={autoSaveIndex}
                                    onChange={e => setAutoSaveIndex(e.target.checked)}
                                    style={{ accentColor: '#34d399', width: '12px', height: '12px' }}
                                />
                                {'自动保存'}
                            </label>
                            <button onClick={pickSaveDirectory} style={{
                                padding: '2px 8px', fontSize: '10px', fontWeight: 500,
                                background: indexSavePath ? 'rgba(52,211,153,0.1)' : 'transparent',
                                color: indexSavePath ? '#34d399' : '#71717a',
                                border: `1px solid ${indexSavePath ? 'rgba(52,211,153,0.2)' : '#3f3f46'}`,
                                borderRadius: '3px', cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0,
                            }}
                                data-tip={indexSavePath ? `当前保存位置: ${indexSavePath}/\n点击更换` : '选择一个本地文件夹保存索引，清理浏览器缓存也不会丢失'}
                            >
                                {indexSavePath ? `📁 ${indexSavePath}` : '📁 选择保存位置'}
                            </button>
                        </div>
                    );
                })()}

                {/* 索引加载状态 */}
                {indexLoadStatus && (
                    <div style={{
                        padding: '3px 16px', fontSize: '11px', color: '#71717a',
                        background: 'rgba(113,113,122,0.04)',
                        borderBottom: '1px solid rgba(113,113,122,0.08)',
                        display: 'flex', alignItems: 'center', gap: '6px',
                    }}>
                        {indexLoadStatus.includes('...') && <Loader2 size={12} className="animate-spin" />}
                        {indexLoadStatus}
                    </div>
                )}

                {/* 粘贴区域 */}
                {showPasteArea && (
                    <div style={{ padding: '16px', borderBottom: '1px solid #27272a' }}>
                        <div style={{ marginBottom: '8px', fontSize: '13px', color: '#a1a1aa' }}>
                            从 Excel / Google Sheets 粘贴表格数据（Tab 分隔）：
                        </div>
                        <textarea
                            value={pasteInput}
                            onChange={e => setPasteInput(e.target.value)}
                            placeholder={"在此粘贴表格数据…\n支持 Tab 分隔的多列数据\n第一行会被自动识别为表头"}
                            style={{
                                width: '100%', minHeight: '120px', resize: 'vertical',
                                background: '#18181b', border: '1px solid #3f3f46',
                                borderRadius: '8px', padding: '12px', color: '#e4e4e7',
                                fontSize: '13px', fontFamily: 'monospace', outline: 'none',
                            }}
                            onPaste={e => {
                                e.preventDefault();
                                const text = e.clipboardData.getData('text/plain');
                                const html = e.clipboardData.getData('text/html');
                                if (text) { setPasteInput(text); }
                                if (html) { setPasteHtml(html); }
                            }}
                        />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px', alignItems: 'center' }}>
                            {appendMode && table.rows.length > 0 ? (
                                <button onClick={() => handlePaste(true)} style={{ ...btnStyle('#1e3a5f'), padding: '8px 20px' }}>
                                    <Plus size={14} /> {`追加到现有 ${table.rows.length} 行后`}
                                </button>
                            ) : (
                                <button onClick={() => handlePaste(false)} style={{ ...btnStyle('#854d0e'), padding: '8px 20px' }}>
                                    <Check size={14} /> {'载入数据'}
                                </button>
                            )}
                            {table.rows.length > 0 && (
                                <button onClick={() => { setShowPasteArea(false); setPasteInput(''); }}
                                    style={btnStyle('#27272a')}>
                                    取消
                                </button>
                            )}
                        </div>
                    </div>
                )}

                {/* 搜索项区域 */}
                {table.rows.length > 0 && (
                    <div style={{
                        padding: '12px 16px', borderBottom: '1px solid #27272a',
                        background: '#0a0a0c',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: searchQueriesCollapsed ? '0' : '8px' }}>
                            <button
                                onClick={() => setSearchQueriesCollapsed(prev => !prev)}
                                style={{
                                    background: 'transparent', border: 'none', cursor: 'pointer',
                                    color: '#fafafa', display: 'flex', alignItems: 'center', gap: '4px',
                                    fontSize: '13px', fontWeight: 600, padding: 0,
                                }}
                            >
                                <ChevronDown size={14} style={{ transform: searchQueriesCollapsed ? 'rotate(-90deg)' : 'rotate(0)', transition: 'transform 0.2s' }} />
                                🔍 搜索项 ({queries.length})
                            </button>
                            {/* 搜索模式切换 */}
                            <div style={{ display: 'flex', background: '#27272a', borderRadius: '6px', padding: '2px', gap: '2px' }}>
                                <button
                                    onClick={() => setSearchMode('contains')}
                                    data-tip="精确匹配：搜索包含关键词的文案"
                                    style={{
                                        padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                                        border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                                        background: searchMode === 'contains' ? 'rgba(251,191,36,0.2)' : 'transparent',
                                        color: searchMode === 'contains' ? '#fbbf24' : '#71717a',
                                    }}
                                >
                                    包含
                                </button>
                                <button
                                    onClick={() => setSearchMode('similar')}
                                    data-tip="本地词汇匹配：MinHash + Jaccard（免费，速度快）"
                                    style={{
                                        padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                                        border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                                        background: searchMode === 'similar' ? 'rgba(139,92,246,0.2)' : 'transparent',
                                        color: searchMode === 'similar' ? '#c4b5fd' : '#71717a',
                                    }}
                                >
                                    相似
                                </button>
                                {getAiInstance && (
                                    <button
                                        onClick={() => setSearchMode('embedding')}
                                        data-tip="AI 语义匹配：使用本地 Embedding 理解文案含义（中文精准度最高）"
                                        style={{
                                            padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                                            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                                            background: searchMode === 'embedding' ? 'rgba(168,85,247,0.2)' : 'transparent',
                                            color: searchMode === 'embedding' ? '#c084fc' : '#71717a',
                                            display: 'flex', alignItems: 'center', gap: '3px',
                                        }}
                                    >
                                        <Brain size={11} /> AI语义
                                    </button>
                                )}
                                {getAiInstance && (
                                    <button
                                        onClick={() => setSearchMode('llm')}
                                        data-tip="AI 精判：使用 Gemini 直接判断语义是否重复（最精确，较慢）"
                                        style={{
                                            padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                                            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                                            background: searchMode === 'llm' ? 'rgba(34,197,94,0.2)' : 'transparent',
                                            color: searchMode === 'llm' ? '#4ade80' : '#71717a',
                                            display: 'flex', alignItems: 'center', gap: '3px',
                                        }}
                                    >
                                        <Bot size={11} /> AI精判
                                    </button>
                                )}
                            </div>
                            <button onClick={() => setShowSettings(!showSettings)} style={{ ...btnSmStyle, color: '#71717a' }} data-tip="搜索设置（相似度阈值、搜索列）">
                                <Settings2 size={13} />
                            </button>

                            {/* ===== 翻译搜索开关 + 语言选择 ===== */}
                            {getAiInstance && (
                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px', marginLeft: '4px' }}>
                                    <button
                                        onClick={() => setTranslateEnabled(!translateEnabled)}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '3px',
                                            padding: '3px 8px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                                            border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                                            background: translateEnabled ? 'rgba(59,130,246,0.2)' : 'transparent',
                                            color: translateEnabled ? '#60a5fa' : '#52525b',
                                        }}
                                        data-tip={translateEnabled ? '翻译搜索已开启（点击关闭）' : '开启翻译搜索：搜索前先将查询词翻译为目标语言'}
                                    >
                                        <Languages size={12} />
                                        {translateEnabled ? '翻译搜索' : '翻译'}
                                    </button>
                                    {translateEnabled && (
                                        <div ref={translateDropdownRef} style={{ position: 'relative' }}>
                                            <button
                                                onClick={() => { setTranslateDropdownOpen(!translateDropdownOpen); setTranslateLangSearch(''); }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: '3px',
                                                    padding: '2px 8px', borderRadius: '4px', fontSize: '11px',
                                                    border: '1px solid rgba(59,130,246,0.3)', cursor: 'pointer',
                                                    background: 'rgba(59,130,246,0.1)', color: '#93c5fd',
                                                    fontWeight: 500, whiteSpace: 'nowrap',
                                                }}
                                                data-tip="选择翻译目标语言"
                                            >
                                                {TRANSLATE_LANGUAGES.find(l => l.code === translateLang)?.label || '英文'}
                                                <ChevronDown size={10} />
                                            </button>
                                            {translateDropdownOpen && (
                                                <div style={{
                                                    position: 'absolute', top: '100%', left: 0, marginTop: '4px',
                                                    background: '#1e1e24', border: '1px solid #333', borderRadius: '8px',
                                                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 999,
                                                    width: '220px', maxHeight: '320px', overflow: 'hidden',
                                                    display: 'flex', flexDirection: 'column',
                                                }}>
                                                    {/* 搜索框 */}
                                                    <div style={{ padding: '6px 8px', borderBottom: '1px solid #333' }}>
                                                        <input
                                                            type="text" autoFocus
                                                            value={translateLangSearch}
                                                            onChange={e => setTranslateLangSearch(e.target.value)}
                                                            placeholder="搜索语言 (中/英/本语)..."
                                                            style={{
                                                                width: '100%', padding: '5px 8px', borderRadius: '4px',
                                                                border: '1px solid #444', background: '#111', color: '#e5e5e5',
                                                                fontSize: '12px', outline: 'none',
                                                            }}
                                                        />
                                                    </div>
                                                    {/* 语言列表 */}
                                                    <div style={{ overflowY: 'auto', maxHeight: '260px', padding: '4px 0' }}>
                                                        {filteredTranslateLangs.map(lang => (
                                                            <button
                                                                key={lang.code}
                                                                onClick={() => { setTranslateLang(lang.code); setTranslateDropdownOpen(false); }}
                                                                style={{
                                                                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                                                                    width: '100%', padding: '6px 12px', border: 'none', cursor: 'pointer',
                                                                    background: translateLang === lang.code ? 'rgba(59,130,246,0.15)' : 'transparent',
                                                                    color: translateLang === lang.code ? '#60a5fa' : '#d4d4d8',
                                                                    fontSize: '12px', textAlign: 'left', transition: 'background 0.1s',
                                                                }}
                                                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.06)')}
                                                                onMouseLeave={e => (e.currentTarget.style.background = translateLang === lang.code ? 'rgba(59,130,246,0.15)' : 'transparent')}
                                                            >
                                                                <span>{lang.label} <span style={{ color: '#71717a', fontSize: '10px' }}>{lang.native && `(${lang.native})`}</span></span>
                                                                {translateLang === lang.code && <Check size={12} style={{ color: '#60a5fa' }} />}
                                                            </button>
                                                        ))}
                                                        {filteredTranslateLangs.length === 0 && (
                                                            <div style={{ padding: '12px', textAlign: 'center', color: '#52525b', fontSize: '11px' }}>
                                                                未找到匹配语言
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                    {isTranslating && <Loader2 size={12} className="animate-spin" style={{ color: '#60a5fa' }} />}
                                </div>
                            )}

                            <div style={{ flex: 1 }} />
                            <button onClick={addQuery} style={btnSmStyle} data-tip="添加搜索项">
                                <Plus size={14} /> 新增
                            </button>
                            <button
                                onClick={executeAllSearches}
                                disabled={queries.every(q => !q.text.trim() || q.isSearching)}
                                style={{ ...btnStyle('#854d0e'), padding: '5px 14px', fontSize: '12px' }}
                                data-tip="同时执行所有搜索项的搜索"
                            >
                                <Search size={14} /> 全部搜索
                            </button>
                            {queries.some(q => q.isSearching) && (
                                <button
                                    onClick={cancelAllSearches}
                                    style={{ ...btnStyle('#991b1b'), padding: '5px 14px', fontSize: '12px' }}
                                    data-tip="强行中断并且保存断点记录（只对 AI 模型有效）"
                                >
                                    <Trash2 size={14} /> 停止搜索
                                </button>
                            )}
                            {queries.some(q => q.text.trim() || q.resultCount > 0) && (
                                <button
                                    onClick={() => {
                                        clearAllHighlights();
                                        setQueries([{ id: uuidv4(), text: '', noteText: '', color: getQueryColor(0), enabled: true, isSearching: false, resultCount: 0 }]);
                                    }}
                                    style={{ ...btnSmStyle, color: '#ef4444' }}
                                    data-tip="清空所有搜索项和高亮（保留表格数据）"
                                >
                                    <RotateCcw size={14} /> 清空搜索
                                </button>
                            )}
                        </div>

                        {!searchQueriesCollapsed && (
                            <>
                                {/* 设置面板 - 根据搜索模式自动切换阈值 */}
                                {showSettings && (
                                    <div style={{
                                        padding: '10px 12px', background: '#18181b', borderRadius: '8px',
                                        border: '1px solid #3f3f46', marginBottom: '10px',
                                        display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap',
                                    }}>
                                        {searchMode === 'similar' && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                                                <span style={{ color: '#a1a1aa' }}>MinHash阈值:</span>
                                                <input
                                                    type="range" min={0.2} max={0.8} step={0.05} value={threshold}
                                                    onChange={e => setThreshold(Number(e.target.value))}
                                                    style={{ width: '100px' }}
                                                />
                                                <span style={{ color: '#fbbf24', fontWeight: 600 }}>{Math.round(threshold * 100)}%</span>
                                            </div>
                                        )}
                                        {searchMode === 'embedding' && (
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                                                <span style={{ color: '#a1a1aa' }}>🧠AI语义阈值:</span>
                                                <input
                                                    type="range" min={0.70} max={0.999} step={0.001} value={embeddingThreshold}
                                                    onChange={e => setEmbeddingThreshold(Number(e.target.value))}
                                                    style={{ width: '120px' }}
                                                />
                                                <input
                                                    type="number" min={70} max={99.9} step={0.1}
                                                    value={(embeddingThreshold * 100).toFixed(1)}
                                                    onChange={e => {
                                                        const v = Number(e.target.value);
                                                        if (!isNaN(v) && v >= 0 && v <= 100) setEmbeddingThreshold(v / 100);
                                                    }}
                                                    style={{
                                                        width: '58px', background: '#27272a', color: '#34d399', border: '1px solid #3f3f46',
                                                        borderRadius: '4px', padding: '1px 4px', fontSize: '12px', fontWeight: 600, textAlign: 'center',
                                                    }}
                                                />
                                                <span style={{ color: '#34d399', fontSize: '12px' }}>%</span>
                                            </div>
                                        )}
                                        {searchMode === 'contains' && (
                                            <div style={{ fontSize: '12px', color: '#a1a1aa' }}>包含模式无需设置阈值</div>
                                        )}
                                        {searchMode === 'llm' && (
                                            <div style={{ fontSize: '12px', color: '#a1a1aa' }}>AI精判模式由模型自行判断，无需阈值</div>
                                        )}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                                            <span style={{ color: '#a1a1aa' }}>并发单批字符:</span>
                                            <input
                                                type="range" min={1000} max={200000} step={500} value={maxBatchChars}
                                                onChange={e => setMaxBatchChars(Number(e.target.value))}
                                                style={{ width: '100px' }}
                                            />
                                            <span style={{ color: '#a1a1aa' }}>{maxBatchChars.toLocaleString()}</span>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                                            <span style={{ color: '#a1a1aa' }}>搜索列:</span>
                                            <select
                                                value={searchCol}
                                                onChange={e => setSearchCol(Number(e.target.value))}
                                                style={{
                                                    background: '#27272a', color: '#e4e4e7', border: '1px solid #3f3f46',
                                                    borderRadius: '4px', padding: '2px 6px', fontSize: '12px',
                                                }}
                                            >
                                                <option value={-1}>所有列</option>
                                                {table.headers.map((h, i) => (
                                                    <option key={i} value={i}>{h}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                                            <span style={{ color: '#a1a1aa' }}>AI模型:</span>
                                            <select
                                                value={localModel}
                                                onChange={e => {
                                                    const v = e.target.value;
                                                    setLocalModel(v);
                                                    try { localStorage.setItem(LOCAL_MODEL_KEY_CS, v); } catch {}
                                                }}
                                                style={{
                                                    background: '#27272a', color: '#e4e4e7', border: '1px solid #3f3f46',
                                                    borderRadius: '4px', padding: '2px 6px', fontSize: '12px', maxWidth: '200px',
                                                }}
                                            >
                                                {CS_MODEL_OPTIONS.map(o => (
                                                    <option key={o.value} value={o.value}>
                                                        {o.value === INHERIT_VALUE ? `${o.label} (${textModel})` : o.label}
                                                    </option>
                                                ))}
                                            </select>
                                        </div>
                                    </div>
                                )}
                                {/* 搜索项列表 */}
                                <div 
                                    className="custom-scrollbar"
                                    style={{ 
                                        display: 'flex', 
                                        flexDirection: 'column', 
                                        gap: '8px',
                                        maxHeight: '320px',
                                        overflowY: 'auto',
                                        paddingRight: '6px',
                                        marginRight: '-4px', // 抵消纵向滚动条带来的空隙偏移
                                    }}
                                >
                                    {queries.map((q, idx) => (
                                        <React.Fragment key={q.id}>
                                        <div style={{
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            padding: '6px 8px', background: '#18181b',
                                            borderRadius: '8px', border: `1px solid ${q.color}33`,
                                        }}>
                                            {/* 颜色选择 */}
                                            <input
                                                type="color" value={q.color}
                                                onChange={e => updateQuery(q.id, { color: e.target.value })}
                                                style={{
                                                    width: '28px', height: '28px', border: 'none', borderRadius: '6px',
                                                    cursor: 'pointer', padding: 0, background: 'transparent',
                                                }}
                                                data-tip="选择高亮颜色"
                                            />
                                            <span style={{ fontSize: '11px', color: '#71717a', minWidth: '24px' }}>#{idx + 1}</span>
                                            <input
                                                type="text"
                                                value={q.text}
                                                onChange={e => updateQuery(q.id, { text: e.target.value })}
                                                placeholder="输入要搜索的文案内容...（支持批量粘贴；可粘贴 Google Sheets 两列：英文 + 中文备注）"
                                                onKeyDown={e => { if (e.key === 'Enter') executeSearch(q); }}
                                                onPaste={e => {
                                                    const text = e.clipboardData.getData('text/plain');
                                                    if (!text) return;

                                                    // 解析 Google Sheets TSV（支持引号包裹换行）
                                                    const parsedRows: string[][] = [];
                                                    let currentRow: string[] = [];
                                                    let currentCell = '';
                                                    let inQuote = false;
                                                    let i = 0;
                                                    while (i < text.length) {
                                                        const ch = text[i];
                                                        if (inQuote) {
                                                            if (ch === '"') {
                                                                if (i + 1 < text.length && text[i + 1] === '"') {
                                                                    currentCell += '"';
                                                                    i += 2;
                                                                } else {
                                                                    inQuote = false;
                                                                    i++;
                                                                }
                                                            } else {
                                                                currentCell += ch;
                                                                i++;
                                                            }
                                                        } else if (ch === '"' && currentCell === '') {
                                                            inQuote = true;
                                                            i++;
                                                        } else if (ch === '\t') {
                                                            currentRow.push(currentCell.trim());
                                                            currentCell = '';
                                                            i++;
                                                        } else if (ch === '\n' || ch === '\r') {
                                                            currentRow.push(currentCell.trim());
                                                            currentCell = '';
                                                            if (currentRow.some(c => c !== '')) {
                                                                parsedRows.push(currentRow);
                                                            }
                                                            currentRow = [];
                                                            if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++;
                                                            i++;
                                                        } else {
                                                            currentCell += ch;
                                                            i++;
                                                        }
                                                    }
                                                    currentRow.push(currentCell.trim());
                                                    if (currentRow.some(c => c !== '')) parsedRows.push(currentRow);

                                                    if (parsedRows.length <= 1 && parsedRows[0]?.filter(Boolean).length <= 1) return; // 单个值，正常粘贴

                                                    const hasSecondColumn = parsedRows.some(r => (r[1] || '').trim());
                                                    const bulkQueries: Omit<SearchQuery, 'id' | 'color' | 'enabled' | 'isSearching' | 'resultCount'>[] = hasSecondColumn
                                                        // 两列模式：第一列=搜索词（英文），第二列=备注（中文）
                                                        ? parsedRows
                                                            .map(r => ({
                                                                text: (r[0] || '').trim(),
                                                                noteText: (r[1] || '').trim(),
                                                            }))
                                                            .filter(item => item.text)
                                                        // 单列模式：每个非空单元格都作为一个搜索词
                                                        : parsedRows
                                                            .flatMap(r => r)
                                                            .map(cell => cell.trim())
                                                            .filter(Boolean)
                                                            .map(cell => ({ text: cell, noteText: '' }));

                                                    // 单行两列特殊处理：直接更新当前搜索项的文本和备注
                                                    if (bulkQueries.length === 1 && hasSecondColumn) {
                                                        e.preventDefault();
                                                        updateQuery(q.id, {
                                                            text: bulkQueries[0].text,
                                                            noteText: bulkQueries[0].noteText,
                                                        });
                                                        setGlobalProgress(`\u2705 \u5df2\u81ea\u52a8\u586b\u5145: \u641c\u7d22\u8bcd + \u4e2d\u6587\u5907\u6ce8`);
                                                        setTimeout(() => setGlobalProgress(''), 2000);
                                                        return;
                                                    }
                                                    if (bulkQueries.length <= 1) return; // 单个值，正常粘贴

                                                    e.preventDefault();
                                                    const usedColors = new Set(queries.map(qq => qq.color));
                                                    let colorIdx = queries.length;
                                                    const newQueries = bulkQueries.map(item => {
                                                        let nextColor = getQueryColor(colorIdx);
                                                        while (usedColors.has(nextColor) && colorIdx < queries.length + 20) {
                                                            colorIdx++;
                                                            nextColor = getQueryColor(colorIdx);
                                                        }
                                                        usedColors.add(nextColor);
                                                        colorIdx++;
                                                        return {
                                                            id: uuidv4(), text: item.text, noteText: item.noteText, color: nextColor,
                                                            enabled: true, isSearching: false, resultCount: 0,
                                                        };
                                                    });
                                                    // 如果当前搜索项为空，替换它；否则追加
                                                    if (!q.text.trim()) {
                                                        setQueries(prev => [...prev.filter(qq => qq.id !== q.id), ...newQueries]);
                                                    } else {
                                                        setQueries(prev => [...prev, ...newQueries]);
                                                    }
                                                    setGlobalProgress(
                                                        hasSecondColumn
                                                            ? `✅ 已批量添加 ${newQueries.length} 个搜索项（英文搜索 + 中文备注）`
                                                            : `✅ 已批量添加 ${newQueries.length} 个搜索项`
                                                    );
                                                    setTimeout(() => setGlobalProgress(''), 3000);
                                                }}
                                                onDoubleClick={() => openQueryEditor(q)}
                                                style={{
                                                    flex: 1, background: '#27272a', border: '1px solid #3f3f46',
                                                    borderRadius: '6px', padding: '6px 10px', color: '#e4e4e7',
                                                    fontSize: '13px', outline: 'none',
                                                }}
                                            />
                                            <input
                                                type="text"
                                                value={q.noteText}
                                                onChange={e => updateQuery(q.id, { noteText: e.target.value })}
                                                placeholder="备注文字（可选）"
                                                style={{
                                                    width: '130px', background: '#27272a', border: '1px solid #3f3f46',
                                                    borderRadius: '6px', padding: '6px 8px', color: '#fbbf24',
                                                    fontSize: '12px', outline: 'none', flexShrink: 0,
                                                }}
                                            />
                                            {/* 每条搜索项的独立模式选择 */}
                                            <select
                                                value={q.searchMode || searchMode}
                                                onChange={e => updateQuery(q.id, { searchMode: e.target.value as any })}
                                                style={{
                                                    background: q.searchMode ? 'rgba(139,92,246,0.1)' : '#27272a',
                                                    color: q.searchMode ? '#c4b5fd' : '#71717a',
                                                    border: `1px solid ${q.searchMode ? 'rgba(139,92,246,0.3)' : '#3f3f46'}`,
                                                    borderRadius: '5px', padding: '4px 4px', fontSize: '11px',
                                                    cursor: 'pointer', outline: 'none', flexShrink: 0,
                                                }}
                                                data-tip={q.searchMode ? `单独模式: ${q.searchMode}` : `跟随全局: ${searchMode}`}
                                            >
                                                <option value="contains">{'🔍 包含'}</option>
                                                <option value="similar">{'✨ 相似'}</option>
                                                <option value="embedding">{'🧠 语义'}</option>
                                            </select>
                                            {/* 单独 MinHash 阈值 */}
                                            {(q.searchMode || searchMode) === 'similar' && (
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: '3px',
                                                    background: q.threshold !== undefined ? 'rgba(251,191,36,0.08)' : 'transparent',
                                                    border: q.threshold !== undefined ? '1px solid rgba(251,191,36,0.2)' : '1px solid transparent',
                                                    borderRadius: '6px', padding: '2px 6px', flexShrink: 0,
                                                    transition: 'all 0.15s',
                                                }}
                                                    data-tip={q.threshold !== undefined
                                                        ? `单独阈值: ${Math.round(q.threshold * 100)}%（点击百分比重置为跟随全局）`
                                                        : `跟随全局阈值: ${Math.round(threshold * 100)}%（拖动滑块设置单独阈值）`
                                                    }
                                                >
                                                    <input
                                                        type="range" min={0.1} max={0.9} step={0.05}
                                                        value={q.threshold ?? threshold}
                                                        onChange={e => updateQuery(q.id, { threshold: Number(e.target.value) })}
                                                        style={{ width: '50px', accentColor: q.threshold !== undefined ? '#fbbf24' : '#52525b' }}
                                                    />
                                                    <span
                                                        onClick={() => updateQuery(q.id, { threshold: undefined })}
                                                        style={{
                                                            fontSize: '10px', fontWeight: 600, minWidth: '28px', textAlign: 'center',
                                                            color: q.threshold !== undefined ? '#fbbf24' : '#52525b',
                                                            cursor: q.threshold !== undefined ? 'pointer' : 'default',
                                                        }}
                                                    >
                                                        {Math.round((q.threshold ?? threshold) * 100)}%
                                                    </span>
                                                </div>
                                            )}
                                            {/* 单独 AI 语义阈值 */}
                                            {(q.searchMode || searchMode) === 'embedding' && (
                                                <div style={{
                                                    display: 'flex', alignItems: 'center', gap: '3px',
                                                    background: q.embeddingThreshold !== undefined ? 'rgba(52,211,153,0.08)' : 'transparent',
                                                    border: q.embeddingThreshold !== undefined ? '1px solid rgba(52,211,153,0.2)' : '1px solid transparent',
                                                    borderRadius: '6px', padding: '2px 6px', flexShrink: 0,
                                                    transition: 'all 0.15s',
                                                }}
                                                    data-tip={q.embeddingThreshold !== undefined
                                                        ? `单独语义阈值: ${(q.embeddingThreshold * 100).toFixed(1)}%（点击百分比重置为跟随全局）`
                                                        : `跟随全局语义阈值: ${(embeddingThreshold * 100).toFixed(1)}%（拖动设置单独阈值）`
                                                    }
                                                >
                                                    <input
                                                        type="range" min={0.70} max={0.999} step={0.001}
                                                        value={q.embeddingThreshold ?? embeddingThreshold}
                                                        onChange={e => updateQuery(q.id, { embeddingThreshold: Number(e.target.value) })}
                                                        style={{ width: '55px', accentColor: q.embeddingThreshold !== undefined ? '#34d399' : '#52525b' }}
                                                    />
                                                    <span
                                                        onClick={() => updateQuery(q.id, { embeddingThreshold: undefined })}
                                                        style={{
                                                            fontSize: '10px', fontWeight: 600, minWidth: '36px', textAlign: 'center',
                                                            color: q.embeddingThreshold !== undefined ? '#34d399' : '#52525b',
                                                            cursor: q.embeddingThreshold !== undefined ? 'pointer' : 'default',
                                                        }}
                                                    >
                                                        {((q.embeddingThreshold ?? embeddingThreshold) * 100).toFixed(1)}%
                                                    </span>
                                                </div>
                                            )}
                                            {/* 结果数量指示器 */}
                                            {q.text.trim() !== '' && (
                                                <div style={{
                                                    fontSize: '11px', flexShrink: 0,
                                                    color: q.isSearching ? '#fbbf24' : (q.searchDone ? (q.resultCount > 0 ? '#10b981' : '#ef4444') : '#71717a'),
                                                    background: q.isSearching ? 'rgba(251,191,36,0.1)' : (q.searchDone ? (q.resultCount > 0 ? 'rgba(16,185,129,0.15)' : 'rgba(239,68,68,0.1)') : 'rgba(255,255,255,0.05)'),
                                                    padding: '2px 8px', borderRadius: '4px',
                                                    minWidth: '50px', textAlign: 'center',
                                                    border: q.isSearching ? '1px solid rgba(251,191,36,0.3)' : (q.searchDone && q.resultCount > 0 ? '1px solid rgba(16,185,129,0.3)' : '1px solid transparent'),
                                                    transition: 'all 0.3s',
                                                }}>
                                                    {q.isSearching ? '⚙️ 搜索中...' : (q.searchDone ? (q.resultCount > 0 ? `✅ ${q.resultCount} 行` : '✅ 0 行') : `${q.resultCount} 行`)}
                                                </div>
                                            )}
                                            <button
                                                onClick={() => updateQuery(q.id, { useAi: !q.useAi })}
                                                style={{
                                                    ...btnSmStyle,
                                                    color: q.useAi ? '#a78bfa' : '#52525b',
                                                    background: q.useAi ? 'rgba(139,92,246,0.15)' : 'transparent',
                                                    borderRadius: '4px', padding: '3px 5px',
                                                    transition: 'all 0.15s',
                                                }}
                                                data-tip={q.useAi ? 'AI 智能搜索已开启（点击关闭）' : '点击开启 AI 智能搜索'}
                                            >
                                                <Sparkles size={13} />
                                            </button>
                                            <button
                                                onClick={() => (searchMode === 'llm' || q.useAi) ? executeAiQuerySearch(q) : executeSearch(q)}
                                                disabled={!q.text.trim() || q.isSearching}
                                                style={{ ...btnSmStyle, color: q.isSearching ? '#71717a' : (searchMode === 'llm' || q.useAi ? '#4ade80' : '#fbbf24') }}
                                                data-tip={searchMode === 'llm' ? 'AI 精判搜索' : (q.useAi ? 'AI 智能搜索' : '搜索')}
                                            >
                                                {q.isSearching ? <Loader2 size={14} className="animate-spin" /> : (searchMode === 'llm' || q.useAi ? <Bot size={14} /> : <Search size={14} />)}
                                            </button>
                                            {q.resultCount > 0 && (() => {
                                                // 该搜索项的匹配行索引列表
                                                const qMatchRows: number[] = [];
                                                table.rows.forEach((row, ri) => {
                                                    if (row.some(cell => cell.highlights.some(h => h.queryId === q.id))) qMatchRows.push(ri);
                                                });
                                                return (
                                                    <>
                                                        <span style={{
                                                            fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                                                            background: `${q.color}22`, color: q.color, fontWeight: 600,
                                                        }}>
                                                            {q.resultCount}
                                                        </span>
                                                        <button
                                                            onClick={() => {
                                                                // 往上跳
                                                                const curFocus = focusedMatchIdx >= 0 ? matchedRowIndices[focusedMatchIdx] : -1;
                                                                const curQIdx = qMatchRows.indexOf(curFocus);
                                                                const prevIdx = curQIdx > 0 ? curQIdx - 1 : qMatchRows.length - 1;
                                                                const targetRow = qMatchRows[prevIdx];
                                                                const globalIdx = matchedRowIndices.indexOf(targetRow);
                                                                if (globalIdx >= 0) setFocusedMatchIdx(globalIdx);
                                                                const el = tableContainerRef.current?.querySelector(`[data-row-idx="${targetRow}"]`);
                                                                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                if (el instanceof HTMLElement) {
                                                                    el.style.outline = `2px solid ${q.color}`;
                                                                    setTimeout(() => { el.style.outline = ''; }, 1500);
                                                                }
                                                            }}
                                                            style={{ ...btnSmStyle, color: q.color, padding: '1px' }}
                                                            data-tip="上一个匹配"
                                                        >
                                                            <ChevronUp size={13} />
                                                        </button>
                                                        <button
                                                            onClick={() => {
                                                                // 往下跳
                                                                const curFocus = focusedMatchIdx >= 0 ? matchedRowIndices[focusedMatchIdx] : -1;
                                                                const curQIdx = qMatchRows.indexOf(curFocus);
                                                                const nextIdx = curQIdx < qMatchRows.length - 1 ? curQIdx + 1 : 0;
                                                                const targetRow = qMatchRows[nextIdx];
                                                                const globalIdx = matchedRowIndices.indexOf(targetRow);
                                                                if (globalIdx >= 0) setFocusedMatchIdx(globalIdx);
                                                                const el = tableContainerRef.current?.querySelector(`[data-row-idx="${targetRow}"]`);
                                                                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                if (el instanceof HTMLElement) {
                                                                    el.style.outline = `2px solid ${q.color}`;
                                                                    setTimeout(() => { el.style.outline = ''; }, 1500);
                                                                }
                                                            }}
                                                            style={{ ...btnSmStyle, color: q.color, padding: '1px' }}
                                                            data-tip="下一个匹配"
                                                        >
                                                            <ChevronDown size={13} />
                                                        </button>
                                                        <button
                                                            onClick={() => copyQueryResults(q.id)}
                                                            style={{ ...btnSmStyle, color: q.color }}
                                                            data-tip={`复制该搜索项的 ${q.resultCount} 条匹配结果`}
                                                        >
                                                            <Copy size={13} />
                                                        </button>
                                                    </>
                                                );
                                            })()}
                                            {queries.length > 1 && (
                                                <button onClick={() => removeQuery(q.id)} style={{ ...btnSmStyle, color: '#ef4444' }} data-tip="删除">
                                                    <Trash2 size={13} />
                                                </button>
                                            )}
                                        </div>
                                        {/* 翻译结果显示 */}
                                        {translateEnabled && q.translatedText && q.translatedText !== q.text && (
                                            <div style={{
                                                display: 'flex', alignItems: 'center', gap: '6px',
                                                padding: '3px 8px 3px 62px', fontSize: '11px',
                                                color: '#60a5fa', background: 'rgba(59,130,246,0.04)',
                                                borderRadius: '0 0 8px 8px', marginTop: '-4px',
                                                border: '1px solid rgba(59,130,246,0.1)',
                                                borderTop: 'none',
                                            }}>
                                                <Languages size={10} style={{ flexShrink: 0, opacity: 0.6 }} />
                                                <span style={{ opacity: 0.7 }}>→</span>
                                                <span style={{ color: '#93c5fd', fontWeight: 500 }}>{q.translatedText}</span>
                                                <button
                                                    onClick={() => updateQuery(q.id, { translatedText: undefined })}
                                                    style={{ ...btnSmStyle, color: '#52525b', padding: '1px', marginLeft: 'auto' }}
                                                    data-tip="清除翻译缓存"
                                                >
                                                    <X size={10} />
                                                </button>
                                            </div>
                                        )}
                                        </React.Fragment>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* AI 智能搜索区域 - 暂时隐藏 */}
                {false && table.rows.length > 0 && (
                    <div style={{
                        borderBottom: '1px solid #27272a',
                        background: showAiSearch ? '#0c0a14' : '#09090b',
                    }}>
                        <div
                            onClick={() => setShowAiSearch(!showAiSearch)}
                            style={{
                                padding: '8px 16px',
                                display: 'flex', alignItems: 'center', gap: '8px',
                                cursor: 'pointer', userSelect: 'none',
                                transition: 'background 0.15s',
                            }}
                        >
                            <div style={{
                                background: 'linear-gradient(135deg, rgba(167,139,250,0.2), rgba(139,92,246,0.15))',
                                padding: '4px', borderRadius: '6px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}>
                                <Sparkles size={14} style={{ color: '#a78bfa' }} />
                            </div>
                            <span style={{
                                fontSize: '13px', fontWeight: 600,
                                background: 'linear-gradient(90deg, #a78bfa, #c4b5fd)',
                                WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent',
                            }}>
                                🤖 AI 智能搜索
                            </span>
                            <span style={{
                                fontSize: '10px', color: '#6d28d9', background: 'rgba(139,92,246,0.15)',
                                padding: '1px 8px', borderRadius: '10px', fontWeight: 500,
                            }}>
                                Gemini
                            </span>
                            {aiSearchResults.length > 0 && (
                                <span style={{
                                    fontSize: '11px', color: '#a78bfa', fontWeight: 600,
                                    background: 'rgba(167,139,250,0.15)', padding: '1px 8px', borderRadius: '10px',
                                }}>
                                    {aiSearchResults.length} 结果
                                </span>
                            )}
                            {aiSearchResults.length > 0 && (
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        // 复制 AI 搜索结果
                                        const { headers, rows, noteColumnVisible } = table;
                                        const matchedRows = rows.filter((_row, ri) =>
                                            aiSearchResults.some(r => r.rowIndex === ri)
                                        );
                                        if (matchedRows.length === 0) return;

                                        const aiColor = '#a78bfa';
                                        let html = '<table>';
                                        html += '<tr>';
                                        headers.forEach(h => {
                                            html += `<td style="font-weight:bold;background-color:#333333;color:#ffffff;padding:4px 8px;border:1px solid #cccccc;">${escHtml(h)}</td>`;
                                        });
                                        if (noteColumnVisible) {
                                            html += '<td style="font-weight:bold;background-color:#333333;color:#ffffff;padding:4px 8px;border:1px solid #cccccc;">备注</td>';
                                        }
                                        html += '</tr>';

                                        matchedRows.forEach(row => {
                                            html += '<tr>';
                                            row.forEach(cell => {
                                                const hit = cell.highlights.find(h => h.queryId.startsWith('ai_search_'));
                                                const bg = hit ? aiColor : '';
                                                const textColor = bg ? getContrastColor(bg) : '#000000';
                                                const style = bg
                                                    ? `background-color:${bg};color:${textColor};padding:4px 8px;border:1px solid #cccccc;`
                                                    : `padding:4px 8px;border:1px solid #cccccc;color:#000000;`;
                                                html += `<td style="${style}">${escHtml(cell.value)}</td>`;
                                            });
                                            if (noteColumnVisible) {
                                                const notes = getRowNoteWithSummary(row);
                                                html += `<td style="padding:4px 8px;border:1px solid #cccccc;color:#333333;font-size:12px;">${escHtml(notes)}</td>`;
                                            }
                                            html += '</tr>';
                                        });
                                        html += '</table>';

                                        let tsv = headers.join('\t') + (noteColumnVisible ? '\t备注' : '') + '\n';
                                        matchedRows.forEach(row => {
                                            tsv += row.map(c => tsvCell(c.value)).join('\t');
                                            if (noteColumnVisible) tsv += '\t' + getRowNoteWithSummary(row);
                                            tsv += '\n';
                                        });

                                        copyHtmlToClipboard(html, tsv, `✅ 已复制 AI 搜索的 ${matchedRows.length} 行结果`);
                                    }}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                        padding: '3px 10px', borderRadius: '6px',
                                        fontSize: '11px', fontWeight: 600,
                                        background: 'rgba(167,139,250,0.15)',
                                        color: '#a78bfa',
                                        border: '1px solid rgba(167,139,250,0.25)',
                                        cursor: 'pointer',
                                        transition: 'all 0.15s',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(167,139,250,0.25)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(167,139,250,0.15)'; }}
                                    data-tip="复制 AI 搜索结果（带颜色）"
                                >
                                    <Copy size={12} /> 复制结果
                                </button>
                            )}
                            <div style={{ flex: 1 }} />
                            <ChevronDown size={14} style={{
                                color: '#71717a',
                                transform: showAiSearch ? 'rotate(0)' : 'rotate(-90deg)',
                                transition: 'transform 0.2s',
                            }} />
                        </div>

                        {showAiSearch && (
                            <div style={{ padding: '0 16px 12px' }}>
                                <div style={{
                                    display: 'flex', gap: '8px', alignItems: 'center',
                                }}>
                                    <div style={{
                                        flex: 1, position: 'relative',
                                        display: 'flex', alignItems: 'center',
                                    }}>
                                        <Bot size={16} style={{
                                            position: 'absolute', left: '10px',
                                            color: '#7c3aed', zIndex: 1,
                                        }} />
                                        <input
                                            type="text"
                                            value={aiSearchQuery}
                                            onChange={e => setAiSearchQuery(e.target.value)}
                                            onKeyDown={e => { if (e.key === 'Enter' && !aiSearching) executeAiSearch(); }}
                                            placeholder="输入自然语言搜索，AI 会理解语义帮你找到相关内容..."
                                            disabled={aiSearching}
                                            style={{
                                                width: '100%',
                                                background: '#18181b',
                                                border: '1px solid rgba(139,92,246,0.3)',
                                                borderRadius: '8px',
                                                padding: '9px 12px 9px 34px',
                                                color: '#e4e4e7',
                                                fontSize: '13px',
                                                outline: 'none',
                                                transition: 'border-color 0.2s, box-shadow 0.2s',
                                            }}
                                            onFocus={e => {
                                                e.target.style.borderColor = 'rgba(139,92,246,0.6)';
                                                e.target.style.boxShadow = '0 0 0 3px rgba(139,92,246,0.1)';
                                            }}
                                            onBlur={e => {
                                                e.target.style.borderColor = 'rgba(139,92,246,0.3)';
                                                e.target.style.boxShadow = 'none';
                                            }}
                                        />
                                    </div>
                                    <button
                                        onClick={executeAiSearch}
                                        disabled={aiSearching || !aiSearchQuery.trim() || !getAiInstance}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            padding: '8px 16px', borderRadius: '8px',
                                            fontSize: '12px', fontWeight: 600,
                                            background: aiSearching
                                                ? 'rgba(139,92,246,0.15)'
                                                : 'linear-gradient(135deg, #7c3aed, #6d28d9)',
                                            color: aiSearching ? '#a78bfa' : '#ffffff',
                                            border: 'none', cursor: aiSearching ? 'wait' : 'pointer',
                                            transition: 'all 0.2s',
                                            opacity: (!aiSearchQuery.trim() || !getAiInstance) ? 0.5 : 1,
                                            whiteSpace: 'nowrap',
                                        }}
                                    >
                                        {aiSearching
                                            ? <><Loader2 size={14} className="animate-spin" /> 搜索中...</>
                                            : <><Sparkles size={14} /> AI 搜索</>}
                                    </button>
                                    {(aiSearchResults.length > 0 || aiSearchQuery) && (
                                        <button
                                            onClick={clearAiSearch}
                                            style={{
                                                ...btnSmStyle,
                                                color: '#a78bfa',
                                                padding: '8px',
                                            }}
                                            data-tip="清除 AI 搜索结果"
                                        >
                                            <RotateCcw size={14} />
                                        </button>
                                    )}
                                </div>

                                {/* AI 搜索错误提示 */}
                                {aiSearchError && (
                                    <div style={{
                                        marginTop: '8px', padding: '6px 12px',
                                        background: 'rgba(239,68,68,0.1)', borderRadius: '6px',
                                        border: '1px solid rgba(239,68,68,0.2)',
                                        fontSize: '12px', color: '#fca5a5',
                                        display: 'flex', alignItems: 'center', gap: '6px',
                                    }}>
                                        <AlertCircle size={14} />
                                        {aiSearchError}
                                    </div>
                                )}

                                {!getAiInstance && (
                                    <div style={{
                                        marginTop: '8px', padding: '6px 12px',
                                        background: 'rgba(251,191,36,0.08)', borderRadius: '6px',
                                        border: '1px solid rgba(251,191,36,0.2)',
                                        fontSize: '12px', color: '#fbbf24',
                                        display: 'flex', alignItems: 'center', gap: '6px',
                                    }}>
                                        <AlertCircle size={14} />
                                        请先配置 API Key 才能使用 AI 搜索功能
                                    </div>
                                )}

                                {/* AI 搜索结果列表 */}
                                {aiSearchResults.length > 0 && (
                                    <div style={{
                                        marginTop: '10px',
                                        maxHeight: '180px', overflow: 'auto',
                                        borderRadius: '8px',
                                        border: '1px solid rgba(139,92,246,0.15)',
                                        background: '#111015',
                                    }}>
                                        <div style={{
                                            padding: '6px 12px',
                                            background: 'rgba(139,92,246,0.08)',
                                            borderBottom: '1px solid rgba(139,92,246,0.1)',
                                            fontSize: '11px', color: '#a78bfa', fontWeight: 600,
                                            display: 'flex', alignItems: 'center', gap: '6px',
                                            position: 'sticky', top: 0,
                                        }}>
                                            <Bot size={12} />
                                            找到 {aiSearchResults.length} 条相关结果
                                            <span style={{ color: '#71717a', fontWeight: 400 }}>（点击跳转）</span>
                                        </div>
                                        {aiSearchResults.map((res, idx) => {
                                            const rowData = table.rows[res.rowIndex];
                                            const previewText = rowData
                                                ? rowData.map(c => c.value).filter(Boolean).join(' | ').substring(0, 120)
                                                : '';
                                            return (
                                                <div
                                                    key={`${res.rowIndex}-${idx}`}
                                                    onClick={() => navigateToAiResult(res.rowIndex)}
                                                    style={{
                                                        padding: '6px 12px',
                                                        borderBottom: '1px solid rgba(139,92,246,0.06)',
                                                        cursor: 'pointer',
                                                        transition: 'background 0.15s',
                                                        display: 'flex', alignItems: 'center', gap: '8px',
                                                    }}
                                                    onMouseEnter={e => (e.currentTarget.style.background = 'rgba(139,92,246,0.08)')}
                                                    onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                                >
                                                    <span style={{
                                                        fontSize: '10px', color: '#52525b', minWidth: '36px', textAlign: 'right',
                                                    }}>
                                                        行 {res.rowIndex + 1}
                                                    </span>
                                                    <span style={{
                                                        fontSize: '10px', padding: '1px 6px', borderRadius: '8px',
                                                        background: res.relevance >= 80 ? 'rgba(167,139,250,0.3)'
                                                            : res.relevance >= 50 ? 'rgba(167,139,250,0.15)'
                                                                : 'rgba(113,113,122,0.15)',
                                                        color: res.relevance >= 80 ? '#c4b5fd'
                                                            : res.relevance >= 50 ? '#a78bfa' : '#a1a1aa',
                                                        fontWeight: 600, minWidth: '38px', textAlign: 'center',
                                                    }}>
                                                        {res.relevance}%
                                                    </span>
                                                    <span style={{
                                                        flex: 1, fontSize: '12px', color: '#a1a1aa',
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    }}>
                                                        {previewText || '(空行)'}
                                                    </span>
                                                    <span style={{
                                                        fontSize: '10px', color: '#71717a', maxWidth: '200px',
                                                        overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                                    }}>
                                                        {res.reason}
                                                    </span>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}

                {/* 表格区域 */}
                {table.rows.length > 0 ? (
                    <div ref={tableContainerRef} style={{ flex: 1, overflow: 'auto', padding: '0' }}>
                        <table style={{
                            width: '100%', borderCollapse: 'collapse', fontSize: '13px',
                        }}>
                            <thead>
                                <tr>
                                    <th style={thStyle}>#</th>
                                    {table.headers.map((h, i) => (
                                        <th key={i} style={thStyle}>
                                            {h}
                                            {searchCol === i && <span style={{ color: '#fbbf24', marginLeft: '4px' }}>🔍</span>}
                                        </th>
                                    ))}
                                    {table.noteColumnVisible && (
                                        <th style={{ ...thStyle, color: '#fbbf24', minWidth: '200px' }}>
                                            📝 备注
                                        </th>
                                    )}
                                </tr>
                            </thead>
                            <tbody>
                                {(() => {
                                    const totalPages = Math.ceil(table.rows.length / PAGE_SIZE);
                                    const startIdx = currentPage * PAGE_SIZE;
                                    const endIdx = Math.min(startIdx + PAGE_SIZE, table.rows.length);
                                    const visibleRows = table.rows.slice(startIdx, endIdx);
                                    return visibleRows.map((row, pageRowIdx) => {
                                        const ri = startIdx + pageRowIdx;
                                        const isFocused = focusedMatchIdx >= 0 && matchedRowIndices[focusedMatchIdx] === ri;
                                        return (
                                            <tr key={ri} data-row-idx={ri} style={{
                                                borderBottom: '1px solid #1f1f23',
                                                outline: isFocused ? '2px solid #fbbf24' : 'none',
                                                outlineOffset: '-1px',
                                                transition: 'outline 0.2s',
                                            }}>
                                                <td style={{ ...tdStyle, color: '#52525b', fontSize: '11px', textAlign: 'center', minWidth: '40px' }}>
                                                    {ri + 1}
                                                </td>
                                                {row.map((cell, ci) => {
                                                    const highlight = cell.highlights[0];
                                                    const bg = highlight ? highlight.color + '33' : 'transparent';
                                                    const borderLeft = highlight ? `3px solid ${highlight.color}` : '0';
                                                    return (
                                                        <td key={ci} style={{
                                                            ...tdStyle,
                                                            background: bg,
                                                            borderLeft,
                                                            position: 'relative',
                                                        }}>
                                                            <div style={{ maxHeight: '80px', overflow: 'auto', lineHeight: '1.5' }}>
                                                                {cell.value}
                                                            </div>
                                                            {cell.highlights.length > 0 && (
                                                                <div style={{
                                                                    display: 'flex', gap: '3px', marginTop: '4px', flexWrap: 'wrap',
                                                                }}>
                                                                    {cell.highlights.map((h, hi) => (
                                                                        <span key={hi} title={`🔍 ${h.queryText} (${h.similarity}%)`} style={{
                                                                            fontSize: '10px', padding: '1px 6px',
                                                                            borderRadius: '8px', background: h.color + '44',
                                                                            color: h.color, fontWeight: 600,
                                                                        }}>
                                                                            {h.similarity}%
                                                                        </span>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </td>
                                                    );
                                                })}
                                                {table.noteColumnVisible && (
                                                    <td style={{ ...tdStyle, minWidth: '200px' }}>
                                                        <input
                                                            type="text"
                                                            value={getRowManualNote(row)}
                                                            onChange={e => {
                                                                updateRowNote(ri, e.target.value);
                                                            }}
                                                            onDoubleClick={() => {
                                                                const notes = getRowManualNote(row);
                                                                openNoteEditor(ri, notes);
                                                            }}
                                                            style={{
                                                                width: '100%', background: 'transparent', border: 'none',
                                                                color: '#fbbf24', fontSize: '12px', outline: 'none',
                                                                padding: '2px',
                                                            }}
                                                            placeholder="添加备注..."
                                                        />
                                                        {getRowMatchSummary(row) && (
                                                            <div style={{
                                                                marginTop: '4px',
                                                                fontSize: '11px',
                                                                lineHeight: 1.5,
                                                                color: '#93c5fd',
                                                            }}>
                                                                {getRowMatchSummary(row)}
                                                            </div>
                                                        )}
                                                    </td>
                                                )}
                                            </tr>
                                        );
                                    });
                                })()}
                                {/* 分页控件 */}
                                {table.rows.length > PAGE_SIZE && (
                                    <tr>
                                        <td colSpan={table.headers.length + (table.noteColumnVisible ? 2 : 1)} style={{
                                            padding: '12px', textAlign: 'center',
                                            background: '#0a0a0c', borderTop: '1px solid #27272a',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', flexWrap: 'wrap' }}>
                                                <button
                                                    onClick={() => setCurrentPage(0)}
                                                    disabled={currentPage === 0}
                                                    style={{ padding: '4px 10px', background: currentPage === 0 ? '#1f1f23' : '#27272a', color: currentPage === 0 ? '#52525b' : '#e4e4e7', border: '1px solid #3f3f46', borderRadius: '4px', cursor: currentPage === 0 ? 'default' : 'pointer', fontSize: '12px' }}
                                                >首页</button>
                                                <button
                                                    onClick={() => setCurrentPage(p => Math.max(0, p - 1))}
                                                    disabled={currentPage === 0}
                                                    style={{ padding: '4px 10px', background: currentPage === 0 ? '#1f1f23' : '#27272a', color: currentPage === 0 ? '#52525b' : '#e4e4e7', border: '1px solid #3f3f46', borderRadius: '4px', cursor: currentPage === 0 ? 'default' : 'pointer', fontSize: '12px' }}
                                                >← 上一页</button>
                                                <span style={{ color: '#a1a1aa', fontSize: '12px' }}>
                                                    第 {currentPage + 1} / {Math.ceil(table.rows.length / PAGE_SIZE)} 页
                                                    （显示 {currentPage * PAGE_SIZE + 1}-{Math.min((currentPage + 1) * PAGE_SIZE, table.rows.length)} / {table.rows.length} 行）
                                                </span>
                                                <button
                                                    onClick={() => setCurrentPage(p => Math.min(Math.ceil(table.rows.length / PAGE_SIZE) - 1, p + 1))}
                                                    disabled={currentPage >= Math.ceil(table.rows.length / PAGE_SIZE) - 1}
                                                    style={{ padding: '4px 10px', background: currentPage >= Math.ceil(table.rows.length / PAGE_SIZE) - 1 ? '#1f1f23' : '#27272a', color: currentPage >= Math.ceil(table.rows.length / PAGE_SIZE) - 1 ? '#52525b' : '#e4e4e7', border: '1px solid #3f3f46', borderRadius: '4px', cursor: currentPage >= Math.ceil(table.rows.length / PAGE_SIZE) - 1 ? 'default' : 'pointer', fontSize: '12px' }}
                                                >下一页 →</button>
                                                <button
                                                    onClick={() => setCurrentPage(Math.ceil(table.rows.length / PAGE_SIZE) - 1)}
                                                    disabled={currentPage >= Math.ceil(table.rows.length / PAGE_SIZE) - 1}
                                                    style={{ padding: '4px 10px', background: currentPage >= Math.ceil(table.rows.length / PAGE_SIZE) - 1 ? '#1f1f23' : '#27272a', color: currentPage >= Math.ceil(table.rows.length / PAGE_SIZE) - 1 ? '#52525b' : '#e4e4e7', border: '1px solid #3f3f46', borderRadius: '4px', cursor: currentPage >= Math.ceil(table.rows.length / PAGE_SIZE) - 1 ? 'default' : 'pointer', fontSize: '12px' }}
                                                >末页</button>
                                            </div>
                                        </td>
                                    </tr>
                                )}
                            </tbody>
                        </table>
                    </div>
                ) : !showPasteArea ? (
                    <div style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        flexDirection: 'column', gap: '12px', color: '#52525b',
                    }}>
                        <Upload size={40} />
                        <span>点击上方「重新粘贴」按钮导入数据</span>
                    </div>
                ) : null}
            </div>

            {/* 双击查看完整内容弹窗 */}
            {expandedModal !== null && (
                <div
                    onClick={closeExpandedModal}
                    style={{
                        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.75)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                        backdropFilter: 'blur(4px)',
                    }}
                >
                    <div
                        onClick={e => e.stopPropagation()}
                        style={{
                            background: '#18181b', border: '1px solid #3f3f46', borderRadius: '12px',
                            padding: '20px', maxWidth: '600px', width: '90%', maxHeight: '70vh',
                            overflow: 'auto', position: 'relative',
                        }}
                    >
                        <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '12px' }}>
                            <span style={{ fontSize: '13px', color: '#71717a' }}>{expandedModal.title}</span>
                            <button
                                onClick={closeExpandedModal}
                                style={{
                                    background: 'transparent', border: 'none', color: '#71717a',
                                    cursor: 'pointer', fontSize: '18px', padding: '0 4px',
                                }}
                            >✕</button>
                        </div>
                        {expandedModal.editable ? (
                            <>
                                <textarea
                                    value={expandedDraft}
                                    onChange={e => setExpandedDraft(e.target.value)}
                                    style={{
                                        width: '100%', minHeight: '220px', resize: 'vertical',
                                        background: '#0f0f12',
                                        border: `1px solid ${expandedModal.accentColor || '#3f3f46'}`,
                                        borderRadius: '8px', padding: '10px 12px',
                                        color: '#e4e4e7', fontSize: '13px', lineHeight: 1.6,
                                        outline: 'none',
                                    }}
                                />
                                <div style={{ marginTop: '10px', display: 'flex', justifyContent: 'flex-end', gap: '8px' }}>
                                    <button onClick={closeExpandedModal} style={btnStyle('#27272a')}>
                                        取消
                                    </button>
                                    <button onClick={saveExpandedModal} style={btnStyle('#854d0e')}>
                                        保存
                                    </button>
                                </div>
                            </>
                        ) : (
                            <div style={{
                                color: '#fbbf24', fontSize: '14px', lineHeight: '1.8',
                                whiteSpace: 'pre-wrap', wordBreak: 'break-word',
                            }}>
                                {expandedModal.text}
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* ===== 清空索引确认弹窗 ===== */}
            {clearConfirm && (
                <div style={{
                    position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
                    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                }} onClick={() => setClearConfirm(null)}>
                    <div style={{
                        background: '#1c1c1e', border: '2px solid #dc2626', borderRadius: '16px',
                        padding: '28px 32px', maxWidth: '420px', width: '90%',
                        boxShadow: '0 20px 60px rgba(220,38,38,0.3)',
                    }} onClick={e => e.stopPropagation()}>
                        {clearConfirm.step === 1 ? (
                            <>
                                <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>⚠️</div>
                                <h3 style={{ color: '#fca5a5', fontSize: '18px', fontWeight: 700, textAlign: 'center', margin: '0 0 16px' }}>
                                    {'\u4e25\u91cd\u8b66\u544a'}
                                </h3>
                                <p style={{ color: '#d4d4d8', fontSize: '14px', lineHeight: 1.7, margin: '0 0 8px' }}>
                                    {'\u4f60\u5373\u5c06\u6c38\u4e45\u5220\u9664'} <span style={{ color: '#f87171', fontWeight: 700, fontSize: '20px' }}>{clearConfirm.count}</span> {'\u6761\u5411\u91cf\u7d22\u5f15\u6570\u636e\uff01'}
                                </p>
                                <p style={{ color: '#a1a1aa', fontSize: '13px', lineHeight: 1.6, margin: '0 0 20px' }}>
                                    {'\u8fd9\u4e9b\u6570\u636e\u662f AI \u5f15\u64ce\u82b1\u8d39\u5927\u91cf\u65f6\u95f4\u8ba1\u7b97\u51fa\u6765\u7684\uff0c\u6e05\u7a7a\u540e\u5fc5\u987b\u4ece\u96f6\u91cd\u65b0\u8dd1\u3002\u5efa\u8bae\u5148\u70b9 \u300c\ud83d\udce4 \u5bfc\u51fa\u7d22\u5f15\u300d \u5907\u4efd\uff01'}
                                </p>
                                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                                    <button onClick={() => setClearConfirm(null)} style={{
                                        padding: '8px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: 600,
                                        background: '#27272a', color: '#e4e4e7', border: '1px solid #3f3f46', cursor: 'pointer',
                                    }}>{'\u53d6\u6d88'}</button>
                                    <button disabled={clearConfirm.countdown > 0} onClick={() => {
                                        setClearConfirm(prev => prev ? { ...prev, step: 2, countdown: 3 } : null);
                                        let t = 3;
                                        const iv = setInterval(() => {
                                            t--;
                                            setClearConfirm(prev => prev ? { ...prev, countdown: t } : null);
                                            if (t <= 0) clearInterval(iv);
                                        }, 1000);
                                    }} style={{
                                        padding: '8px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: 600,
                                        background: clearConfirm.countdown > 0 ? '#3f3f46' : '#991b1b', color: clearConfirm.countdown > 0 ? '#71717a' : '#fca5a5',
                                        border: '1px solid #dc2626', cursor: clearConfirm.countdown > 0 ? 'not-allowed' : 'pointer',
                                        transition: 'all 0.3s',
                                    }}>
                                        {clearConfirm.countdown > 0 ? `${'\u8bf7\u7b49\u5f85'} ${clearConfirm.countdown}s` : '\u786e\u8ba4\u5220\u9664'}
                                    </button>
                                </div>
                            </>
                        ) : (
                            <>
                                <div style={{ fontSize: '32px', textAlign: 'center', marginBottom: '12px' }}>🔴</div>
                                <h3 style={{ color: '#f87171', fontSize: '18px', fontWeight: 700, textAlign: 'center', margin: '0 0 16px' }}>
                                    {'\u6700\u7ec8\u786e\u8ba4'}
                                </h3>
                                <p style={{ color: '#d4d4d8', fontSize: '14px', textAlign: 'center', margin: '0 0 20px' }}>
                                    {'\u518d\u6b21\u786e\u8ba4\uff1a\u5220\u9664\u5168\u90e8'} <span style={{ color: '#f87171', fontWeight: 700 }}>{clearConfirm.count}</span> {'\u6761\u7d22\u5f15\uff0c\u6b64\u64cd\u4f5c\u4e0d\u53ef\u64a4\u9500\uff01'}
                                </p>
                                <div style={{ display: 'flex', gap: '12px', justifyContent: 'center' }}>
                                    <button onClick={() => setClearConfirm(null)} style={{
                                        padding: '8px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: 600,
                                        background: '#27272a', color: '#e4e4e7', border: '1px solid #3f3f46', cursor: 'pointer',
                                    }}>{'\u53d6\u6d88'}</button>
                                    <button disabled={clearConfirm.countdown > 0} onClick={async () => {
                                        try {
                                            await embeddingDB.clearAll();
                                            embeddingCacheRef.current.clear();
                                            setClearConfirm(null);
                                            setGlobalProgress('\ud83d\uddd1\ufe0f \u5411\u91cf\u7d22\u5f15\u5df2\u5168\u90e8\u6e05\u7a7a\uff01');
                                            setTimeout(() => setGlobalProgress(''), 3000);
                                        } catch (e: any) {
                                            setGlobalProgress(`\u6e05\u9664\u5931\u8d25: ${e.message}`);
                                            setClearConfirm(null);
                                        }
                                    }} style={{
                                        padding: '8px 24px', borderRadius: '8px', fontSize: '14px', fontWeight: 700,
                                        background: clearConfirm.countdown > 0 ? '#3f3f46' : '#b91c1c', color: clearConfirm.countdown > 0 ? '#71717a' : '#ffffff',
                                        border: '2px solid #ef4444', cursor: clearConfirm.countdown > 0 ? 'not-allowed' : 'pointer',
                                        transition: 'all 0.3s',
                                    }}>
                                        {clearConfirm.countdown > 0 ? `${'\u8bf7\u7b49\u5f85'} ${clearConfirm.countdown}s` : '\u2757 \u6c38\u4e45\u5220\u9664'}
                                    </button>
                                </div>
                            </>
                        )}
                    </div>
                </div>
            )}
        </>
    );
};

// ===== 样式辅助 =====
const btnStyle = (bg: string): React.CSSProperties => ({
    display: 'flex', alignItems: 'center', gap: '4px',
    padding: '5px 10px', borderRadius: '6px', fontSize: '12px',
    background: bg, color: '#e4e4e7', border: 'none', cursor: 'pointer',
    transition: 'opacity 0.15s', whiteSpace: 'nowrap',
});

const btnSmStyle: React.CSSProperties = {
    display: 'flex', alignItems: 'center', padding: '4px',
    background: 'none', border: 'none', cursor: 'pointer',
    borderRadius: '4px', color: '#a1a1aa', fontSize: '12px', gap: '4px',
};

const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontWeight: 600,
    fontSize: '12px', color: '#a1a1aa', background: '#18181b',
    borderBottom: '2px solid #27272a', position: 'sticky', top: 0,
    zIndex: 1, whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
    padding: '8px 12px', verticalAlign: 'top',
    borderBottom: '1px solid #1f1f23', maxWidth: '500px',
    wordBreak: 'break-word',
};

export default CopySearchApp;
