import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { Search, Upload, Sparkles, ExternalLink, Loader2, Tag, X, RotateCcw, Copy, Check, FolderOpen, ChevronRight, Grid3X3, List, BookOpen, Link2, RefreshCw, Zap, Sun, Moon, Leaf, Download, FileUp } from 'lucide-react';
import type { GoogleGenAI } from '@google/genai';
import { DEFAULT_TUTORIAL_CATEGORIES } from './defaultCategories';
import { getGlobalTextModel } from '@/utils/getTextModel';

// ===== localStorage keys =====
const LS_KEY_URL = 'tutorial_hub_sheet_url';
const LS_KEY_ENTRIES = 'tutorial_hub_entries';
const LS_KEY_VIEW = 'tutorial_hub_view_mode';
const LS_KEY_THEME = 'tutorial_hub_theme';

// ===== 主题系统 =====
type ThemeMode = 'dark' | 'light' | 'eye-care';
interface ThemeTokens {
    bg: string; bgAlt: string; bgCard: string; bgInput: string; bgHover: string;
    border: string; borderLight: string; borderHover: string;
    text: string; textSecondary: string; textMuted: string; textDim: string; textSubtle: string; textFaint: string;
    accent: string; accentBg: string; accentText: string;
    dangerBg: string; dangerBorder: string;
    progressBg: string; progressBorder: string;
    sidebarBg: string;
    shadow: string;
    searchBorder: string;
}
const THEMES: Record<ThemeMode, ThemeTokens> = {
    dark: {
        bg: '#09090b', bgAlt: '#0c0c0f', bgCard: '#111114', bgInput: '#18181b', bgHover: '#1a1a1f',
        border: '#1f1f23', borderLight: '#27272a', borderHover: '#2f2f35',
        text: '#fafafa', textSecondary: '#e4e4e7', textMuted: '#a1a1aa', textDim: '#71717a', textSubtle: '#52525b', textFaint: '#3f3f46',
        accent: '#4338ca', accentBg: 'rgba(99,102,241,0.06)', accentText: '#818cf8',
        dangerBg: '#450a0a', dangerBorder: '#7f1d1d',
        progressBg: 'rgba(99,102,241,0.06)', progressBorder: 'rgba(99,102,241,0.15)',
        sidebarBg: '#0c0c0f',
        shadow: 'rgba(0,0,0,0.3)',
        searchBorder: '#27272a',
    },
    light: {
        bg: '#f8f9fa', bgAlt: '#f0f1f3', bgCard: '#ffffff', bgInput: '#e9ecef', bgHover: '#e2e5e9',
        border: '#dee2e6', borderLight: '#ced4da', borderHover: '#adb5bd',
        text: '#212529', textSecondary: '#343a40', textMuted: '#495057', textDim: '#6c757d', textSubtle: '#868e96', textFaint: '#adb5bd',
        accent: '#4338ca', accentBg: 'rgba(67,56,202,0.06)', accentText: '#4338ca',
        dangerBg: '#fff5f5', dangerBorder: '#fca5a5',
        progressBg: 'rgba(67,56,202,0.06)', progressBorder: 'rgba(67,56,202,0.15)',
        sidebarBg: '#f0f1f3',
        shadow: 'rgba(0,0,0,0.08)',
        searchBorder: '#ced4da',
    },
    'eye-care': {
        bg: '#f5f0e8', bgAlt: '#efe9dd', bgCard: '#faf6ee', bgInput: '#e8e2d6', bgHover: '#e2dbd0',
        border: '#d6cebe', borderLight: '#cbc3b0', borderHover: '#b5ac9a',
        text: '#2d2820', textSecondary: '#3d3528', textMuted: '#5a5248', textDim: '#8a7e72', textSubtle: '#a0947e', textFaint: '#b5ac9a',
        accent: '#5a8a6a', accentBg: 'rgba(90,138,106,0.08)', accentText: '#5a8a6a',
        dangerBg: '#faf0e8', dangerBorder: '#d4a088',
        progressBg: 'rgba(90,138,106,0.08)', progressBorder: 'rgba(90,138,106,0.15)',
        sidebarBg: '#efe9dd',
        shadow: 'rgba(74,66,56,0.1)',
        searchBorder: '#cbc3b0',
    },
};

// ===== 类型定义 =====
interface TutorialLink {
    url: string;
    type: 'youtube' | 'drive-file' | 'drive-folder' | 'google-doc' | 'google-sheet' | 'google-slides' | 'video-file' | 'generic';
    label: string;
}

interface TutorialEntry {
    id: string;
    name: string;
    date: string;
    links: TutorialLink[];
    description: string;
    mainCategory: string;  // 大类: 视频类/生图类/设计类/小技巧/其他
    subCategory: string;   // AI 细分类
    source: string;
    rawRow: string[];
}

// ===== 固定大类 =====
const MAIN_CATEGORIES = [
    { key: '视频类', icon: '🎬', color: '#f43f5e', bg: 'rgba(244,63,94,0.15)' },
    { key: '生图类', icon: '🎨', color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)' },
    { key: '设计类', icon: '✂️', color: '#3b82f6', bg: 'rgba(59,130,246,0.15)' },
    { key: '小技巧', icon: '💡', color: '#eab308', bg: 'rgba(234,179,8,0.15)' },
    { key: '其他', icon: '📦', color: '#71717a', bg: 'rgba(113,113,122,0.15)' },
] as const;

const getMainCategoryStyle = (key: string) => {
    return MAIN_CATEGORIES.find(c => c.key === key) || MAIN_CATEGORIES[MAIN_CATEGORIES.length - 1];
};

interface Props {
    getAiInstance: () => GoogleGenAI;
    isKeySet?: boolean;
}

// ===== 链接类型检测 =====
const detectLinkType = (text: string): TutorialLink | null => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    if (trimmed.includes('youtube.com/watch') || trimmed.includes('youtu.be/') || trimmed.includes('youtube.com/shorts')) {
        return { url: trimmed, type: 'youtube', label: 'YouTube' };
    }
    if (trimmed.includes('drive.google.com/drive/folders')) {
        return { url: trimmed, type: 'drive-folder', label: 'Drive 文件夹' };
    }
    if (trimmed.includes('drive.google.com/file') || trimmed.includes('drive.google.com/open')) {
        return { url: trimmed, type: 'drive-file', label: 'Drive 文件' };
    }
    if (trimmed.includes('docs.google.com/document')) {
        return { url: trimmed, type: 'google-doc', label: 'Google 文档' };
    }
    if (trimmed.includes('docs.google.com/spreadsheets')) {
        return { url: trimmed, type: 'google-sheet', label: 'Google 表格' };
    }
    if (trimmed.includes('docs.google.com/presentation')) {
        return { url: trimmed, type: 'google-slides', label: 'Google 幻灯片' };
    }
    if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) {
        return { url: trimmed, type: 'generic', label: '链接' };
    }
    return null;
};

const isVideoFileName = (text: string): boolean => {
    const ext = text.trim().toLowerCase();
    return ext.endsWith('.mp4') || ext.endsWith('.webm') || ext.endsWith('.mov') || ext.endsWith('.avi') || ext.endsWith('.mkv');
};

// 链接类型配置
const LINK_CONFIG: Record<TutorialLink['type'], { icon: string; color: string; bg: string; label: string }> = {
    youtube: { icon: '▶️', color: '#ff4444', bg: 'rgba(255,68,68,0.12)', label: 'YouTube' },
    'drive-file': { icon: '☁️', color: '#4285f4', bg: 'rgba(66,133,244,0.12)', label: 'Drive 文件' },
    'drive-folder': { icon: '📂', color: '#0f9d58', bg: 'rgba(15,157,88,0.12)', label: 'Drive 文件夹' },
    'google-doc': { icon: '📝', color: '#4285f4', bg: 'rgba(66,133,244,0.12)', label: '文档' },
    'google-sheet': { icon: '📊', color: '#0f9d58', bg: 'rgba(15,157,88,0.12)', label: '表格' },
    'google-slides': { icon: '📽️', color: '#f4b400', bg: 'rgba(244,180,0,0.12)', label: '幻灯片' },
    'video-file': { icon: '🎞️', color: '#a855f7', bg: 'rgba(168,85,247,0.12)', label: '视频文件' },
    generic: { icon: '🔗', color: '#71717a', bg: 'rgba(113,113,122,0.12)', label: '链接' },
};

// 分类颜色方案
const CATEGORY_PALETTE = [
    { color: '#f43f5e', bg: 'rgba(244,63,94,0.15)', icon: '🎬' },
    { color: '#8b5cf6', bg: 'rgba(139,92,246,0.15)', icon: '🎙️' },
    { color: '#3b82f6', bg: 'rgba(59,130,246,0.15)', icon: '✂️' },
    { color: '#06b6d4', bg: 'rgba(6,182,212,0.15)', icon: '🎨' },
    { color: '#22c55e', bg: 'rgba(34,197,94,0.15)', icon: '🔧' },
    { color: '#f97316', bg: 'rgba(249,115,22,0.15)', icon: '📚' },
    { color: '#eab308', bg: 'rgba(234,179,8,0.15)', icon: '💡' },
    { color: '#ec4899', bg: 'rgba(236,72,153,0.15)', icon: '🎯' },
    { color: '#14b8a6', bg: 'rgba(20,184,166,0.15)', icon: '🌐' },
    { color: '#6366f1', bg: 'rgba(99,102,241,0.15)', icon: '⚡' },
    { color: '#0ea5e9', bg: 'rgba(14,165,233,0.15)', icon: '📐' },
    { color: '#84cc16', bg: 'rgba(132,204,22,0.15)', icon: '🎶' },
];
const categoryStyleMap: Record<string, typeof CATEGORY_PALETTE[0]> = {};
const getCategoryStyle = (cat: string) => {
    if (!categoryStyleMap[cat]) {
        const idx = Object.keys(categoryStyleMap).length % CATEGORY_PALETTE.length;
        categoryStyleMap[cat] = CATEGORY_PALETTE[idx];
    }
    return categoryStyleMap[cat];
};

// ===== 解析分隔文本（支持 TSV 和 CSV） =====
const parseDelimited = (text: string, delimiter: string = '\t'): string[][] => {
    const rows: string[][] = [];
    let currentRow: string[] = [];
    let currentCell = '';
    let inQuote = false;
    let i = 0;
    while (i < text.length) {
        const ch = text[i];
        if (inQuote) {
            if (ch === '"') {
                if (i + 1 < text.length && text[i + 1] === '"') { currentCell += '"'; i += 2; }
                else { inQuote = false; i++; }
            } else { currentCell += ch; i++; }
        } else if (ch === '"' && currentCell === '') { inQuote = true; i++; }
        else if (ch === delimiter) { currentRow.push(currentCell); currentCell = ''; i++; }
        else if (ch === '\n' || ch === '\r') {
            currentRow.push(currentCell); currentCell = '';
            if (currentRow.some(c => c.trim() !== '')) rows.push(currentRow);
            currentRow = [];
            if (ch === '\r' && i + 1 < text.length && text[i + 1] === '\n') i++;
            i++;
        } else { currentCell += ch; i++; }
    }
    currentRow.push(currentCell);
    if (currentRow.some(c => c.trim() !== '')) rows.push(currentRow);
    return rows;
};

// ===== 从 Google Sheets URL 提取 Sheet ID =====
const extractSheetId = (url: string): string | null => {
    // 支持格式:
    // https://docs.google.com/spreadsheets/d/SHEET_ID/edit...
    // https://docs.google.com/spreadsheets/d/SHEET_ID
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/);
    return match ? match[1] : null;
};

// ===== 从 URL 中提取 sheet name (gid) =====
const extractSheetGid = (url: string): string | null => {
    const match = url.match(/gid=(\d+)/);
    return match ? match[1] : null;
};

// ===== 从 Google Sheets 获取数据（支持超链接提取） =====
const GOOGLE_API_KEY = ['AIzaSy', 'BsSspB57hO83LQhAGZ_71cJeOouZzONsQ'].join('');

// 单元格数据：包含显示值和超链接
interface CellData {
    value: string;
    hyperlink?: string; // 通过"插入链接"或 HYPERLINK 公式附加的 URL
}

const fetchGoogleSheet = async (sheetUrl: string): Promise<CellData[][]> => {
    const sheetId = extractSheetId(sheetUrl);
    if (!sheetId) throw new Error('无法识别 Google Sheets 链接');

    const gid = extractSheetGid(sheetUrl);

    // 1. 先获取 sheet 元数据以确定 sheet 名称
    let sheetName = '总表';
    try {
        const metaUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?fields=sheets.properties&key=${GOOGLE_API_KEY}`;
        const metaRes = await fetch(metaUrl);
        if (metaRes.ok) {
            const metaData = await metaRes.json();
            const sheets = metaData.sheets || [];
            if (gid && gid !== '0') {
                // 根据 gid 找到对应 sheet
                const target = sheets.find((s: any) => String(s.properties.sheetId) === gid);
                if (target) sheetName = target.properties.title;
            } else {
                // 默认找"总表"，没有就用第一个 sheet
                const zongbiao = sheets.find((s: any) => s.properties.title === '总表');
                sheetName = zongbiao ? '总表' : (sheets[0]?.properties.title || 'Sheet1');
            }
        }
    } catch (e) {
        console.warn('获取 sheet 元数据失败，回退到总表:', e);
    }

    // 2. 使用 spreadsheets.get 获取单元格数据（包含 hyperlink）
    const range = encodeURIComponent(sheetName);
    const apiUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?ranges=${range}&fields=sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue)&key=${GOOGLE_API_KEY}`;

    let response = await fetch(apiUrl);

    // 如果失败，回退到第一个 sheet
    if (!response.ok && sheetName === '总表') {
        const fallbackUrl = `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}?ranges=Sheet1&fields=sheets.data.rowData.values(formattedValue,hyperlink,userEnteredValue)&key=${GOOGLE_API_KEY}`;
        response = await fetch(fallbackUrl);
    }

    if (!response.ok) {
        // 最终回退到 CSV 方式
        console.warn('Sheets API 失败，回退到 CSV 模式');
        return await fetchGoogleSheetCSV(sheetUrl);
    }

    const data = await response.json();
    const rowData = data.sheets?.[0]?.data?.[0]?.rowData || [];

    const result: CellData[][] = [];
    for (const row of rowData) {
        const cells: CellData[] = [];
        const values = row.values || [];
        for (const cell of values) {
            const displayValue = cell.formattedValue || '';
            let hyperlink = cell.hyperlink || '';

            // 如果没有 hyperlink 属性，检查 userEnteredValue 是否为 HYPERLINK 公式
            if (!hyperlink && cell.userEnteredValue?.formulaValue) {
                const formula = cell.userEnteredValue.formulaValue;
                // 匹配 =HYPERLINK("url", "text") 或 =HYPERLINK("url")
                const hMatch = formula.match(/=\s*HYPERLINK\s*\(\s*"([^"]+)"/i);
                if (hMatch) hyperlink = hMatch[1];
            }

            cells.push({ value: displayValue, hyperlink: hyperlink || undefined });
        }
        result.push(cells);
    }

    return result;
};

// CSV 回退方案
const fetchGoogleSheetCSV = async (sheetUrl: string): Promise<CellData[][]> => {
    const sheetId = extractSheetId(sheetUrl)!;
    const gid = extractSheetGid(sheetUrl);
    let csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&_=${Date.now()}`;
    if (gid && gid !== '0') {
        csvUrl += `&gid=${gid}`;
    } else {
        csvUrl += `&sheet=总表`;
    }

    let response = await fetch(csvUrl);
    if (!response.ok && !gid) {
        csvUrl = `https://docs.google.com/spreadsheets/d/${sheetId}/gviz/tq?tqx=out:csv&_=${Date.now()}`;
        response = await fetch(csvUrl);
    }

    if (!response.ok) {
        if (response.status === 401 || response.status === 403) {
            throw new Error('表格未公开，请将共享设置为「知道链接的人可查看」');
        }
        throw new Error(`获取失败: HTTP ${response.status}`);
    }

    const text = await response.text();
    if (!text.trim()) throw new Error('表格为空或无法访问');

    return parseDelimited(text, ',').map(row => row.map(cell => ({ value: cell })));
};

// ===== 从文本中提取嵌入的 URL =====
const extractEmbeddedUrls = (text: string): { cleanText: string; links: TutorialLink[] } => {
    const urlRegex = /https?:\/\/[^\s,，、;；\]）)]+/gi;
    const links: TutorialLink[] = [];
    let cleanText = text;
    const matches = text.match(urlRegex);
    if (matches) {
        for (const url of matches) {
            const link = detectLinkType(url.trim());
            if (link) links.push(link);
            cleanText = cleanText.replace(url, '');
        }
        cleanText = cleanText.replace(/\s{2,}/g, ' ').replace(/[|｜,，]\s*$/g, '').replace(/^\s*[|｜,，]/g, '').trim();
    }
    return { cleanText, links };
};

// ===== 智能解析表格 =====
const smartParse = (rawRows: CellData[][]): TutorialEntry[] => {
    if (rawRows.length === 0) return [];
    const headerKeywords = ['国家', '日期', '录屏', '文档', '概述', '交流', '内容', '说明', '链接', '标题', '名称'];
    let headerRowIdx = -1;
    for (let i = 0; i < Math.min(3, rawRows.length); i++) {
        const row = rawRows[i];
        const matchCount = row.filter(cell => headerKeywords.some(kw => cell.value.includes(kw))).length;
        if (matchCount >= 2) { headerRowIdx = i; break; }
    }
    const headers = headerRowIdx >= 0 ? rawRows[headerRowIdx].map(c => c.value) : [];
    const dataRows = headerRowIdx >= 0 ? rawRows.slice(headerRowIdx + 1) : rawRows;

    let currentSource = '';
    const entries: TutorialEntry[] = [];
    let idCounter = 0;

    for (const row of dataRows) {
        const nonEmptyCells = row.filter(c => c.value.trim() !== '');
        if (nonEmptyCells.length === 0) continue;
        if (nonEmptyCells.length === 1) {
            const val = nonEmptyCells[0].value.trim();
            if (!val.startsWith('http') && !isVideoFileName(val) && val.length < 30 && !nonEmptyCells[0].hyperlink) {
                currentSource = val; continue;
            }
        }

        const links: TutorialLink[] = [];
        let name = '', date = '', description = '';

        row.forEach((cell, ci) => {
            const trimmed = cell.value.trim();
            if (!trimmed) return;
            const header = (headers[ci] || '').toLowerCase();

            if (header.includes('日期') || /^\d{4,6}$/.test(trimmed) || /^\d{4}[-/]\d{1,2}([-/]\d{1,2})?$/.test(trimmed)) {
                if (!date) date = trimmed; return;
            }

            // 检查单元格自带超链接（Google Sheets "插入链接" 或 HYPERLINK 公式）
            if (cell.hyperlink) {
                const link = detectLinkType(cell.hyperlink);
                if (link) {
                    // 根据列头决定链接类型：录屏列的链接强制为视频类型
                    if (header.includes('录屏')) {
                        link.type = 'video-file';
                        link.label = trimmed || link.label;
                    } else {
                        link.label = trimmed || link.label;
                    }
                    links.push(link);
                }
                // 显示文本用作名称/描述（不在"文档"列重复设为 name）
                if (isVideoFileName(trimmed) || header.includes('录屏')) {
                    if (!name) name = trimmed;
                } else if (!trimmed.startsWith('http')) {
                    if (header.includes('名称') || header.includes('标题')) {
                        if (!name) name = trimmed;
                        else description = description ? description + ' | ' + trimmed : trimmed;
                    } else if (header.includes('概述') || header.includes('交流') || header.includes('内容') || header.includes('说明')) {
                        description = description ? description + ' | ' + trimmed : trimmed;
                    } else if (header.includes('文档')) {
                        // 文档列：文字不作为 name，避免和录屏名冲突
                        if (!description) description = trimmed;
                        else description += ' | ' + trimmed;
                    } else {
                        if (!name) name = trimmed;
                        else if (!description) description = trimmed;
                        else description += ' | ' + trimmed;
                    }
                }
                return;
            }

            // 先检测整个格子是否为纯链接
            const link = detectLinkType(trimmed);
            if (link) { links.push(link); return; }
            if (isVideoFileName(trimmed)) {
                if (!name) name = trimmed;
                else links.push({ url: '', type: 'video-file', label: trimmed });
                return;
            }
            if (header.includes('国家') || header.includes('来源') || header.includes('地区') || header.includes('小区')) {
                currentSource = trimmed; return;
            }
            // 对非纯链接的文本，提取其中嵌入的 URL
            const { cleanText, links: embeddedLinks } = extractEmbeddedUrls(trimmed);
            if (embeddedLinks.length > 0) links.push(...embeddedLinks);
            const textContent = cleanText || '';

            if (header.includes('录屏') || header.includes('名称') || header.includes('标题') || header.includes('文档')) {
                if (textContent) {
                    if (!name) name = textContent;
                    else description = description ? description + ' | ' + textContent : textContent;
                }
            }
            else if (header.includes('概述') || header.includes('交流') || header.includes('内容') || header.includes('说明')) {
                if (textContent) description = description ? description + ' | ' + textContent : textContent;
            }
            else {
                if (textContent) {
                    if (!name) name = textContent;
                    else if (!description) description = textContent;
                    else description += ' | ' + textContent;
                }
            }
        });

        // 去重链接（相同 URL 只保留一个）
        const seenUrls = new Set<string>();
        const deduped: TutorialLink[] = [];
        for (const l of links) {
            const key = l.url || l.label;
            if (!seenUrls.has(key)) { seenUrls.add(key); deduped.push(l); }
        }

        // 智能确定标题：优先用录屏名/文档名，其次用描述，最后才用链接标签
        if (!name && description) {
            name = description;
            description = '';
        }
        if (!name && deduped.length > 0) {
            name = deduped[0].label;
        }
        if (!name) continue;

        entries.push({
            id: `t_${idCounter++}`, name, date, links: deduped, description,
            mainCategory: '', subCategory: '', source: currentSource, rawRow: row.map(c => c.value),
        });
    }
    return entries;
};

// ===== 主组件 =====
const TutorialHubApp: React.FC<Props> = ({ getAiInstance, isKeySet = false }) => {
    const [entries, setEntries] = useState<TutorialEntry[]>([]);
    const [pasteInput, setPasteInput] = useState('');
    const [sheetUrl, setSheetUrl] = useState('');
    const [showPasteArea, setShowPasteArea] = useState(true);
    const [importMode, setImportMode] = useState<'paste' | 'url'>('url');
    const [searchText, setSearchText] = useState('');
    const [isSearchFocused, setIsSearchFocused] = useState(false);
    const [searchMode, setSearchMode] = useState<'normal' | 'ai'>('normal');
    const [searchScope, setSearchScope] = useState<'category' | 'global'>('category');
    const [aiSearchResults, setAiSearchResults] = useState<Set<string> | null>(null);
    const [isAiSearching, setIsAiSearching] = useState(false);
    const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
    const [isClassifying, setIsClassifying] = useState(false);
    const [showClassifyModal, setShowClassifyModal] = useState(false);
    const [isFetching, setIsFetching] = useState(false);
    const [progress, setProgress] = useState('');
    const [copied, setCopied] = useState(false);
    const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
    const [sidebarCollapsed, setSidebarCollapsed] = useState(false);
    const [theme, setTheme] = useState<ThemeMode>('dark');
    const c = THEMES[theme];

    const [selectedMainCategory, setSelectedMainCategory] = useState<string | null>(null);
    const [expandedMains, setExpandedMains] = useState<Set<string>>(new Set());

    const aiSearchTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // ===== localStorage 加载 =====
    const autoFetchUrlRef = useRef<string | null>(null);
    useEffect(() => {
        try {
            const savedUrl = localStorage.getItem(LS_KEY_URL);
            if (savedUrl) {
                setSheetUrl(savedUrl);
                autoFetchUrlRef.current = savedUrl; // 标记需要自动刷新
            }
            const savedEntries = localStorage.getItem(LS_KEY_ENTRIES);
            if (savedEntries) {
                const parsed = JSON.parse(savedEntries) as TutorialEntry[];
                if (parsed.length > 0) {
                    setEntries(parsed);
                    setShowPasteArea(false);
                    // 恢复分类颜色映射
                    const validMains = MAIN_CATEGORIES.map(c => c.key) as string[];
                    const mains = new Set<string>();
                    parsed.forEach(e => { if (e.mainCategory && validMains.includes(e.mainCategory)) mains.add(e.mainCategory); });
                    setExpandedMains(mains);
                }
            }
            const savedView = localStorage.getItem(LS_KEY_VIEW);
            if (savedView === 'grid' || savedView === 'list') setViewMode(savedView);
            const savedTheme = localStorage.getItem(LS_KEY_THEME);
            if (savedTheme === 'dark' || savedTheme === 'light' || savedTheme === 'eye-care') setTheme(savedTheme);
        } catch { } // ignore errors
    }, []);

    // ===== localStorage 保存 =====
    useEffect(() => {
        if (sheetUrl) localStorage.setItem(LS_KEY_URL, sheetUrl);
    }, [sheetUrl]);

    useEffect(() => {
        if (entries.length > 0) {
            localStorage.setItem(LS_KEY_ENTRIES, JSON.stringify(entries));
        }
    }, [entries]);

    useEffect(() => {
        localStorage.setItem(LS_KEY_VIEW, viewMode);
    }, [viewMode]);

    useEffect(() => {
        localStorage.setItem(LS_KEY_THEME, theme);
    }, [theme]);

    // 两级分类统计
    const categoryTree = useMemo(() => {
        const tree = new Map<string, Map<string, number>>();
        entries.forEach(e => {
            const main = e.mainCategory || '未分类';
            const sub = e.subCategory || '';
            if (!tree.has(main)) tree.set(main, new Map());
            const subMap = tree.get(main)!;
            if (sub) subMap.set(sub, (subMap.get(sub) || 0) + 1);
        });
        // 按固定大类顺序排列
        const ordered: { main: string; count: number; subs: [string, number][] }[] = [];
        const mainKeys = [...MAIN_CATEGORIES.map(c => c.key), '未分类'];
        for (const mk of mainKeys) {
            if (!tree.has(mk)) continue;
            const subMap = tree.get(mk)!;
            const count = entries.filter(e => (e.mainCategory || '未分类') === mk).length;
            const subs = Array.from(subMap.entries()).sort((a, b) => b[1] - a[1]);
            ordered.push({ main: mk, count, subs });
        }
        // 添加不在预定义列表中的大类
        for (const [mk, subMap] of tree) {
            if (mainKeys.includes(mk)) continue;
            const count = entries.filter(e => e.mainCategory === mk).length;
            ordered.push({ main: mk, count, subs: Array.from(subMap.entries()).sort((a, b) => b[1] - a[1]) });
        }
        return ordered;
    }, [entries]);

    // 搜索过滤
    const filteredEntries = useMemo(() => {
        let result = entries;
        const hasActiveSearch = (searchMode === 'ai' && aiSearchResults) || (searchMode === 'normal' && searchText.trim());
        // 分类过滤（全局搜索时跳过）
        if (!(hasActiveSearch && searchScope === 'global')) {
            if (selectedMainCategory) {
                result = result.filter(e => (e.mainCategory || '未分类') === selectedMainCategory);
            }
            if (selectedCategory) {
                result = result.filter(e => e.subCategory === selectedCategory);
            }
        }
        // AI 搜索结果过滤
        if (searchMode === 'ai' && aiSearchResults) {
            result = result.filter(e => aiSearchResults.has(e.id));
        }
        // 普通搜索
        if (searchMode === 'normal' && searchText.trim()) {
            const q = searchText.toLowerCase();
            result = result.filter(e =>
                e.name.toLowerCase().includes(q) ||
                e.description.toLowerCase().includes(q) ||
                e.subCategory.toLowerCase().includes(q) ||
                e.mainCategory.toLowerCase().includes(q) ||
                e.source.toLowerCase().includes(q)
            );
        }
        return result;
    }, [entries, selectedMainCategory, selectedCategory, searchText, searchMode, aiSearchResults, searchScope]);

    // 粘贴导入
    const handlePasteImport = useCallback(() => {
        if (!pasteInput.trim()) return;
        const raw = parseDelimited(pasteInput, '\t');
        const parsed = smartParse(raw.map(row => row.map(cell => ({ value: cell }))));
        if (parsed.length === 0) {
            setProgress('❌ 未检测到有效数据');
            setTimeout(() => setProgress(''), 3000);
            return;
        }
        setEntries(parsed);
        setShowPasteArea(false);
        setPasteInput('');
        setProgress(`✅ 已导入 ${parsed.length} 条教程`);
        setTimeout(() => setProgress(''), 3000);
    }, [pasteInput]);

    // Google Sheets URL 导入 / 刷新
    const fetchFromUrl = useCallback(async (url?: string) => {
        const targetUrl = url || sheetUrl;
        if (!targetUrl.trim()) return;
        if (!extractSheetId(targetUrl)) {
            setProgress('❌ 请输入有效的 Google Sheets 链接');
            setTimeout(() => setProgress(''), 3000);
            return;
        }
        setIsFetching(true);
        setProgress('📡 正在从 Google Sheets 获取数据...');
        try {
            const raw = await fetchGoogleSheet(targetUrl);
            const parsed = smartParse(raw);
            if (parsed.length === 0) {
                setProgress('❌ 表格中未检测到有效教程数据');
                setTimeout(() => setProgress(''), 3000);
                return;
            }
            // 刷新时保留已有分类
            if (entries.length > 0) {
                const oldMap = new Map(entries.map(e => [e.name + '|' + e.date, e]));
                const merged = parsed.map(p => {
                    const old = oldMap.get(p.name + '|' + p.date);
                    if (old && old.mainCategory) {
                        return { ...p, mainCategory: old.mainCategory, subCategory: old.subCategory };
                    }
                    return p;
                });
                setEntries(merged);
            } else {
                setEntries(parsed);
            }
            setShowPasteArea(false);
            setProgress(`✅ 已从 Google Sheets 导入 ${parsed.length} 条教程`);
            setTimeout(() => setProgress(''), 4000);
        } catch (err: any) {
            console.error('Sheets 导入失败:', err);
            setProgress(`❌ ${err.message || '获取失败'}`);
            setTimeout(() => setProgress(''), 5000);
        } finally {
            setIsFetching(false);
        }
    }, [sheetUrl, entries]);

    const handleUrlImport = useCallback(() => fetchFromUrl(), [fetchFromUrl]);

    // 页面加载时自动从 Google Sheets 刷新数据
    useEffect(() => {
        if (autoFetchUrlRef.current) {
            const url = autoFetchUrlRef.current;
            autoFetchUrlRef.current = null; // 只执行一次
            fetchFromUrl(url);
        }
    }, [fetchFromUrl]);

    // AI 智能搜索
    const handleAiSearch = useCallback(async (query: string) => {
        if (!query.trim() || entries.length === 0) {
            setAiSearchResults(null);
            return;
        }
        setIsAiSearching(true);
        try {
            const ai = getAiInstance();
            const entryTexts = entries.map((e, i) =>
                `${i + 1}. ${e.name}${e.description ? ' - ' + e.description : ''}${e.subCategory ? ' [' + e.subCategory + ']' : ''}`
            ).join('\n');

            const prompt = `你是一个教程搜索助手。用户搜索“${query}”，请从以下教程列表中找出所有相关的教程。
请综合考虑名称、描述和分类来判断相关性。包括直接匹配和语义相关的结果。

教程列表：
${entryTexts}

请只返回相关教程的序号，用逗号分隔。如果没有相关的，返回“无”。
示例：1,3,5,8`;

            const response = await ai.models.generateContent({ model: getGlobalTextModel(), contents: prompt });
            const text = (response.text || '').trim();
            if (text === '无' || !text) {
                setAiSearchResults(new Set());
                setProgress('🔍 AI 搜索无结果');
                setTimeout(() => setProgress(''), 3000);
            } else {
                const indices = text.match(/\d+/g)?.map(n => parseInt(n) - 1).filter(i => i >= 0 && i < entries.length) || [];
                setAiSearchResults(new Set(indices.map(i => entries[i].id)));
                setProgress(`🔍 AI 找到 ${indices.length} 条相关教程`);
                setTimeout(() => setProgress(''), 3000);
            }
        } catch (err: any) {
            console.error('AI 搜索失败:', err);
            setProgress(`❌ AI 搜索失败`);
            setTimeout(() => setProgress(''), 3000);
        } finally {
            setIsAiSearching(false);
        }
    }, [entries, getAiInstance]);

    // 搜索框变化处理
    const handleSearchChange = useCallback((value: string) => {
        setSearchText(value);
        if (searchMode === 'ai') {
            // AI 搜索防抖
            if (aiSearchTimer.current) clearTimeout(aiSearchTimer.current);
            if (!value.trim()) {
                setAiSearchResults(null);
                return;
            }
            aiSearchTimer.current = setTimeout(() => handleAiSearch(value), 800);
        }
    }, [searchMode, handleAiSearch]);

    // 切换搜索模式
    const toggleSearchMode = useCallback(() => {
        if (searchMode === 'normal') {
            setSearchMode('ai');
            if (searchText.trim()) handleAiSearch(searchText);
        } else {
            setSearchMode('normal');
            setAiSearchResults(null);
        }
    }, [searchMode, searchText, handleAiSearch]);

    // 应用预设分类
    const applyPresetCategories = useCallback(() => {
        if (entries.length === 0) return;
        setShowClassifyModal(false);
        setIsClassifying(true);
        setProgress('📂 正在应用预设分类...');
        try {
            Object.keys(categoryStyleMap).forEach(k => delete categoryStyleMap[k]);
            let matched = 0;
            const validMains = MAIN_CATEGORIES.map(c => c.key);
            setEntries(prev => prev.map(e => {
                const name = e.name.trim();
                let cat = DEFAULT_TUTORIAL_CATEGORIES[name];
                if (!cat) {
                    const nameNoExt = name.replace(/\.(mp4|mkv|mov|webm|avi)$/i, '').trim();
                    cat = DEFAULT_TUTORIAL_CATEGORIES[nameNoExt];
                }
                if (!cat) {
                    for (const [key, val] of Object.entries(DEFAULT_TUTORIAL_CATEGORIES)) {
                        const keyClean = key.replace(/\.(mp4|mkv|mov|webm|avi)$/i, '').trim();
                        if (name.includes(keyClean) || keyClean.includes(name)) {
                            cat = val;
                            break;
                        }
                    }
                }
                if (cat) {
                    matched++;
                    let main = cat[0];
                    if (!(validMains as string[]).includes(main)) main = '其他';
                    return { ...e, mainCategory: main, subCategory: cat[1] };
                }
                return { ...e, mainCategory: e.mainCategory || '其他', subCategory: e.subCategory || '' };
            }));
            setExpandedMains(new Set(validMains));
            setProgress(`✅ 预设分类已应用，匹配 ${matched}/${entries.length} 条`);
            setTimeout(() => setProgress(''), 4000);
        } finally {
            setIsClassifying(false);
        }
    }, [entries]);

    // AI 自动分类（两级）
    const classifyWithAI = useCallback(async () => {
        if (entries.length === 0) return;
        setShowClassifyModal(false);
        setIsClassifying(true);
        setProgress('🤖 AI 正在分析教程内容...');
        try {
            const ai = getAiInstance();
            const tutorialList = entries.map((e, i) => {
                const parts = [`${i + 1}. 名称: ${e.name}`];
                if (e.description) parts.push(`描述: ${e.description}`);
                if (e.links.length > 0) {
                    const linkTypes = e.links.map(l => l.type === 'youtube' ? 'YouTube视频' : l.type === 'video-file' ? '视频文件' : l.label).join(', ');
                    parts.push(`资源: ${linkTypes}`);
                }
                return parts.join(' | ');
            }).join('\n');

            const prompt = `你是一个教程内容分类专家。请为以下教程列表中的每一条进行两级分类。

**大类（必须从以下5个中选一个）：**
- 视频类：与AI视频生成、视频剪辑、视频特效、视频素材有关
- 生图类：与AI图片生成、图片编辑、图片特效、图片素材有关
- 设计类：与设计工具（如Canva）、排版、UI、品牌、模板有关
- 小技巧：与工具注册、软件使用技巧、效率提升、设置调整有关
- 其他：不属于以上任何类别

**子分类（2-4个字的中文标签）：**
基于教程的具体主题内容，给出更精细的分类，例如：AI换脸、字幕制作、Canva技巧、调色技巧、3D效果、素材查找 等。
相似主题应归入相同的子分类，总共控制在 8-15 个子分类。

请根据教程名称、描述和资源类型综合判断分类。

教程列表：
${tutorialList}

请严格按以下格式返回，每行一个，用竖线分隔：
序号|大类|子分类
例如：
1|视频类|AI换脸
2|设计类|Canva技巧
3|小技巧|工具注册
...
只返回序号、大类和子分类，不要返回其他内容。`;

            const response = await ai.models.generateContent({ model: getGlobalTextModel(), contents: prompt });
            const text = response.text || '';
            const lines = text.trim().split('\n');
            const categoryMap = new Map<number, { main: string; sub: string }>();
            const validMains = MAIN_CATEGORIES.map(c => c.key);
            lines.forEach(line => {
                const match = line.trim().match(/^(\d+)\s*[|｜]\s*(.+?)\s*[|｜]\s*(.+)$/);
                if (match) {
                    let main = match[2].trim();
                    const sub = match[3].trim();
                    if (!(validMains as string[]).includes(main)) main = '其他';
                    categoryMap.set(parseInt(match[1]) - 1, { main, sub });
                }
            });

            Object.keys(categoryStyleMap).forEach(k => delete categoryStyleMap[k]);

            setEntries(prev => prev.map((e, i) => {
                const cat = categoryMap.get(i);
                return {
                    ...e,
                    mainCategory: cat?.main || e.mainCategory || '其他',
                    subCategory: cat?.sub || e.subCategory || '',
                };
            }));
            setExpandedMains(new Set(validMains));
            setProgress(`✅ AI 已分类 ${categoryMap.size}/${entries.length} 条教程`);
            setTimeout(() => setProgress(''), 4000);
        } catch (err: any) {
            console.error('AI 分类失败:', err);
            setProgress(`❌ 分类失败: ${err.message || '未知错误'}`);
            setTimeout(() => setProgress(''), 5000);
        } finally {
            setIsClassifying(false);
        }
    }, [entries, getAiInstance]);

    // 检测用户是否手动配置了 API Key（不算内置的 process.env）
    const hasApiKey = useMemo(() => {
        const manualKey = localStorage.getItem('user_api_key') || '';
        const usePool = localStorage.getItem('use_api_pool') === 'true';
        return !!manualKey.trim() || usePool;
    }, []);

    // 复制
    const copyAllAsText = useCallback(() => {
        const lines = filteredEntries.map(e => {
            const parts = [e.name];
            if (e.mainCategory) parts.push(`[${e.mainCategory}]`);
            if (e.subCategory) parts.push(`[${e.subCategory}]`);
            if (e.date) parts.push(e.date);
            if (e.description) parts.push(e.description);
            e.links.forEach(l => parts.push(l.url || l.label));
            return parts.join('\t');
        });
        navigator.clipboard.writeText(lines.join('\n'));
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    }, [filteredEntries]);

    // 导出分类配置
    const exportCategories = useCallback(() => {
        const config = entries
            .filter(e => e.mainCategory || e.subCategory)
            .map(e => ({ name: e.name, mainCategory: e.mainCategory, subCategory: e.subCategory }));
        const blob = new Blob([JSON.stringify(config, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `tutorial_categories_${new Date().toISOString().slice(0, 10)}.json`;
        a.click(); URL.revokeObjectURL(url);
        setProgress('✅ 分类配置已导出');
        setTimeout(() => setProgress(''), 3000);
    }, [entries]);

    // 导入分类配置
    const importCategories = useCallback(() => {
        const input = document.createElement('input');
        input.type = 'file'; input.accept = '.json';
        input.onchange = async (ev) => {
            const file = (ev.target as HTMLInputElement).files?.[0];
            if (!file) return;
            try {
                const text = await file.text();
                const config = JSON.parse(text) as { name: string; mainCategory: string; subCategory: string }[];
                const nameMap = new Map(config.map(c => [c.name, c]));
                let matched = 0;
                setEntries(prev => prev.map(e => {
                    const cfg = nameMap.get(e.name);
                    if (cfg) { matched++; return { ...e, mainCategory: cfg.mainCategory, subCategory: cfg.subCategory }; }
                    return e;
                }));
                const validMains = MAIN_CATEGORIES.map(c => c.key) as string[];
                const mains = new Set<string>();
                config.forEach(c => { if (c.mainCategory && validMains.includes(c.mainCategory)) mains.add(c.mainCategory); });
                setExpandedMains(mains);
                setProgress(`✅ 已导入分类配置，匹配 ${matched}/${entries.length} 条`);
                setTimeout(() => setProgress(''), 4000);
            } catch (err: any) {
                setProgress(`❌ 导入失败: ${err.message}`);
                setTimeout(() => setProgress(''), 5000);
            }
        };
        input.click();
    }, [entries]);

    const hasCategories = categoryTree.length > 0 && categoryTree.some(g => g.main !== '未分类');

    // ===== 渲染 =====
    return (
        <div style={{
            display: 'flex', height: '100%', width: '100%',
            background: c.bg, color: c.textSecondary, fontFamily: 'Inter, system-ui, sans-serif',
        }}>
            {/* ===== 左侧边栏（两级分类树） ===== */}
            {entries.length > 0 && hasCategories && (
                <div style={{
                    width: sidebarCollapsed ? '48px' : '240px',
                    borderRight: `1px solid ${c.border}`,
                    background: c.sidebarBg,
                    display: 'flex', flexDirection: 'column',
                    transition: 'width 0.2s ease',
                    flexShrink: 0,
                    overflow: 'hidden',
                }}>
                    {/* sidebar header */}
                    <div style={{
                        padding: sidebarCollapsed ? '12px 8px' : '14px 16px',
                        borderBottom: `1px solid ${c.border}`,
                        display: 'flex', alignItems: 'center', justifyContent: sidebarCollapsed ? 'center' : 'space-between',
                    }}>
                        {!sidebarCollapsed && (
                            <span style={{ fontSize: '11px', fontWeight: 700, color: c.textSubtle, textTransform: 'uppercase', letterSpacing: '1px' }}>
                                分类目录
                            </span>
                        )}
                        <button onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
                            data-tip={sidebarCollapsed ? '展开分类侧栏' : '收起分类侧栏'}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.textSubtle, padding: '2px', display: 'flex' }}>
                            <ChevronRight size={14} style={{ transform: sidebarCollapsed ? 'rotate(0)' : 'rotate(180deg)', transition: 'transform 0.2s' }} />
                        </button>
                    </div>

                    <div style={{ flex: 1, overflow: 'auto', padding: '8px' }}>
                        {/* 全部 */}
                        <button
                            onClick={() => { setSelectedCategory(null); setSelectedMainCategory(null); }}
                            data-tip="查看全部教程"
                            style={{
                                width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                                padding: '8px 12px',
                                borderRadius: '8px', border: 'none', cursor: 'pointer',
                                background: (!selectedCategory && !selectedMainCategory) ? 'rgba(59,130,246,0.1)' : 'transparent',
                                color: (!selectedCategory && !selectedMainCategory) ? '#60a5fa' : c.textDim,
                                fontSize: '12px', fontWeight: 600, textAlign: 'left',
                                transition: 'all 0.15s',
                            }}
                        >
                            <FolderOpen size={14} />
                            {!sidebarCollapsed && <span style={{ flex: 1 }}>全部</span>}
                            {!sidebarCollapsed && <span style={{ fontSize: '11px', opacity: 0.6 }}>{entries.length}</span>}
                        </button>

                        {/* 两级分类树 */}
                        {!sidebarCollapsed && categoryTree.map(group => {
                            const mainStyle = getMainCategoryStyle(group.main);
                            const isMainActive = selectedMainCategory === group.main && !selectedCategory;
                            const isExpanded = expandedMains.has(group.main);
                            return (
                                <div key={group.main} style={{ marginBottom: '2px' }}>
                                    {/* 大类 */}
                                    <button
                                        onClick={() => {
                                            setSelectedMainCategory(isMainActive ? null : group.main);
                                            setSelectedCategory(null);
                                            setExpandedMains(prev => {
                                                const next = new Set(prev);
                                                if (next.has(group.main)) next.delete(group.main);
                                                else next.add(group.main);
                                                return next;
                                            });
                                        }}
                                        data-tip={`${group.main}（点击筛选并展开/收起子分类）`}
                                        style={{
                                            width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                                            padding: '7px 10px',
                                            borderRadius: '8px', border: 'none', cursor: 'pointer',
                                            background: isMainActive ? mainStyle.bg : 'transparent',
                                            color: isMainActive ? mainStyle.color : '#a1a1aa',
                                            fontSize: '13px', fontWeight: 700, textAlign: 'left',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        <ChevronRight size={12} style={{
                                            transform: isExpanded ? 'rotate(90deg)' : 'rotate(0)',
                                            transition: 'transform 0.15s', color: '#52525b', flexShrink: 0,
                                        }} />
                                        <span style={{ fontSize: '14px' }}>{mainStyle.icon}</span>
                                        <span style={{ flex: 1 }}>{group.main}</span>
                                        <span style={{ fontSize: '11px', opacity: 0.4 }}>{group.count}</span>
                                    </button>

                                    {/* 子分类 */}
                                    {isExpanded && group.subs.length > 0 && (
                                        <div style={{ paddingLeft: '20px', marginTop: '1px' }}>
                                            {group.subs.map(([sub, count]) => {
                                                const subStyle = getCategoryStyle(sub);
                                                const isSubActive = selectedCategory === sub;
                                                return (
                                                    <button
                                                        key={sub}
                                                        onClick={() => {
                                                            setSelectedCategory(isSubActive ? null : sub);
                                                            setSelectedMainCategory(isSubActive ? null : group.main);
                                                        }}
                                                        data-tip={`按「${sub}」筛选`}
                                                        style={{
                                                            width: '100%', display: 'flex', alignItems: 'center', gap: '8px',
                                                            padding: '5px 10px',
                                                            borderRadius: '6px', border: 'none', cursor: 'pointer',
                                                            background: isSubActive ? subStyle.bg : 'transparent',
                                                            color: isSubActive ? subStyle.color : c.textMuted,
                                                            fontSize: '12px', fontWeight: 500, textAlign: 'left',
                                                            transition: 'all 0.15s', marginBottom: '1px',
                                                        }}
                                                    >
                                                        <span style={{ width: '4px', height: '4px', borderRadius: '50%', background: subStyle.color, flexShrink: 0, opacity: isSubActive ? 1 : 0.4 }} />
                                                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{sub}</span>
                                                        <span style={{ fontSize: '10px', opacity: 0.4 }}>{count}</span>
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    )}
                                </div>
                            );
                        })}
                        {/* 折叠模式只显示大类图标 */}
                        {sidebarCollapsed && categoryTree.map(group => {
                            const mainStyle = getMainCategoryStyle(group.main);
                            const isActive = selectedMainCategory === group.main;
                            return (
                                <button key={group.main}
                                    onClick={() => { setSelectedMainCategory(isActive ? null : group.main); setSelectedCategory(null); }}
                                    style={{
                                        width: '100%', display: 'flex', justifyContent: 'center',
                                        padding: '8px 4px', borderRadius: '8px', border: 'none', cursor: 'pointer',
                                        background: isActive ? mainStyle.bg : 'transparent',
                                        fontSize: '16px', transition: 'all 0.15s', marginBottom: '2px',
                                    }}
                                    data-tip={group.main}
                                >{mainStyle.icon}</button>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ===== 主内容区 ===== */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                {/* 顶部工具栏 */}
                <div style={{
                    padding: '10px 16px', borderBottom: `1px solid ${c.border}`,
                    background: `${c.bg}f2`, backdropFilter: 'blur(8px)',
                    display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <div style={{ background: 'linear-gradient(135deg, rgba(99,102,241,0.2), rgba(168,85,247,0.2))', padding: '6px', borderRadius: '8px' }}>
                            <BookOpen size={18} style={{ color: '#a78bfa' }} />
                        </div>
                        <h2 style={{ margin: 0, fontSize: '15px', fontWeight: 700, color: c.text }}>教程检索台</h2>
                        {entries.length > 0 && (
                            <span style={{ fontSize: '11px', color: c.textSubtle, background: c.bgInput, padding: '2px 8px', borderRadius: '10px', border: `1px solid ${c.borderLight}` }}>
                                {filteredEntries.length === entries.length ? entries.length : `${filteredEntries.length}/${entries.length}`}
                            </span>
                        )}
                    </div>

                    {/* 搜索框 */}
                    {entries.length > 0 && (
                        (() => {
                            const shouldExpandSearch = isSearchFocused || !!searchText || searchMode === 'ai';
                            return (
                                <div style={{
                                    flex: `0 1 ${shouldExpandSearch ? '210px' : '140px'}`,
                                    minWidth: '140px',
                                    maxWidth: '240px',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '0',
                                    transition: 'all 0.2s ease',
                                }}>
                                    {/* 搜索模式切换 - 更醒目 */}
                                    <button onClick={toggleSearchMode} data-tip={searchMode === 'normal' ? '切换到 AI 智能搜索' : '切换到普通搜索'}
                                        style={{
                                            width: '34px', height: '34px', padding: '0', border: '1px solid', cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            background: searchMode === 'ai' ? 'linear-gradient(135deg, #4338ca, #6d28d9)' : c.bgInput,
                                            color: searchMode === 'ai' ? '#e0e7ff' : c.textDim,
                                            borderColor: searchMode === 'ai' ? '#6366f1' : c.borderLight,
                                            borderRadius: '8px 0 0 8px', borderRight: 'none',
                                            transition: 'all 0.2s',
                                            boxShadow: searchMode === 'ai' ? '0 0 12px rgba(99,102,241,0.3)' : 'none',
                                        }}>
                                        {searchMode === 'ai' ? <Zap size={13} /> : <Search size={13} />}
                                    </button>
                                    <div style={{
                                        flex: 1, minWidth: 0, display: 'flex', alignItems: 'center', gap: '6px', height: '34px',
                                        background: c.bgInput, borderRadius: '0 8px 8px 0', padding: '0 12px',
                                        border: '1px solid',
                                        borderColor: searchMode === 'ai' ? '#6366f1' : c.borderLight,
                                        boxShadow: searchMode === 'ai' ? '0 0 8px rgba(99,102,241,0.15)' : 'none',
                                        transition: 'all 0.2s',
                                    }}>
                                        <input
                                            type="text" value={searchText}
                                            onChange={e => handleSearchChange(e.target.value)}
                                            onFocus={() => setIsSearchFocused(true)}
                                            onBlur={() => setIsSearchFocused(false)}
                                            onKeyDown={e => { if (e.key === 'Enter' && searchMode === 'ai') handleAiSearch(searchText); }}
                                            placeholder={searchMode === 'ai' ? 'AI 语义搜索（回车或自动）...' : '关键词搜索...'}
                                            className="tutorial-hub-search-input"
                                            style={{
                                                flex: 1,
                                                minWidth: '48px',
                                                height: '100%',
                                                background: 'transparent',
                                                border: 'none',
                                                color: c.text,
                                                WebkitTextFillColor: c.text,
                                                caretColor: c.text,
                                                opacity: 1,
                                                fontSize: '13px',
                                                lineHeight: '1.25',
                                                padding: 0,
                                                margin: 0,
                                                outline: 'none',
                                            }}
                                        />
                                        {searchMode === 'ai' && (
                                            <span style={{
                                                fontSize: '10px',
                                                fontWeight: 700,
                                                color: '#c4b5fd',
                                                background: 'rgba(99,102,241,0.15)',
                                                border: '1px solid rgba(99,102,241,0.35)',
                                                borderRadius: '999px',
                                                padding: '2px 6px',
                                                flexShrink: 0,
                                            }}>
                                                AI
                                            </span>
                                        )}
                                        {isAiSearching && <Loader2 size={13} style={{ color: '#818cf8', animation: 'spin 1s linear infinite', flexShrink: 0 }} />}
                                        {/* 搜索范围切换（嵌入搜索框内） */}
                                        {(selectedMainCategory || selectedCategory) && (
                                            <button onClick={() => setSearchScope(searchScope === 'category' ? 'global' : 'category')}
                                                data-tip={searchScope === 'category' ? '当前：分类内搜索，点击切换全局' : '当前：全局搜索，点击切换分类内'}
                                                style={{
                                                    fontSize: '10px', fontWeight: 600, padding: '1px 6px', border: '1px solid',
                                                    borderRadius: '999px', cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                                                    background: searchScope === 'global' ? 'rgba(99,102,241,0.15)' : 'transparent',
                                                    color: searchScope === 'global' ? '#818cf8' : c.textDim,
                                                    borderColor: searchScope === 'global' ? 'rgba(99,102,241,0.35)' : c.borderLight,
                                                    transition: 'all 0.15s',
                                                }}>
                                                {searchScope === 'global' ? '🌐' : '📂'}
                                            </button>
                                        )}
                                        {searchText && !isAiSearching && (
                                            <button onClick={() => { setSearchText(''); setAiSearchResults(null); }}
                                                data-tip="清空搜索词"
                                                style={{ background: 'none', border: 'none', cursor: 'pointer', color: c.textSubtle, padding: '2px', display: 'flex' }}>
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                </div>
                            );
                        })()
                    )}

                    {/* 操作按钮 */}
                    {entries.length > 0 && (
                        <div style={{ display: 'flex', gap: '4px', alignItems: 'center', marginLeft: 'auto', flexWrap: 'wrap' }}>
                            {/* 视图切换 */}
                            {/* 主题切换 */}
                            <button onClick={() => {
                                const cycle: ThemeMode[] = ['dark', 'light', 'eye-care'];
                                const idx = cycle.indexOf(theme);
                                setTheme(cycle[(idx + 1) % cycle.length]);
                            }}
                                data-tip={theme === 'dark' ? '切换到亮色模式' : theme === 'light' ? '切换到护眼模式' : '切换到暗色模式'}
                                style={{ padding: '5px 8px', borderRadius: '6px', border: `1px solid ${c.borderLight}`, cursor: 'pointer', display: 'flex', background: c.bgInput, color: c.textDim, transition: 'all 0.15s' }}>
                                {theme === 'dark' ? <Sun size={14} /> : theme === 'light' ? <Leaf size={14} /> : <Moon size={14} />}
                            </button>
                            <div style={{ display: 'flex', background: c.bgInput, borderRadius: '6px', border: `1px solid ${c.borderLight}`, overflow: 'hidden' }}>
                                <button onClick={() => setViewMode('grid')}
                                    data-tip="网格视图"
                                    style={{
                                        padding: '5px 8px', border: 'none', cursor: 'pointer', display: 'flex',
                                        background: viewMode === 'grid' ? c.borderLight : 'transparent', color: viewMode === 'grid' ? c.textSecondary : c.textSubtle
                                    }}>
                                    <Grid3X3 size={14} />
                                </button>
                                <button onClick={() => setViewMode('list')}
                                    data-tip="列表视图"
                                    style={{
                                        padding: '5px 8px', border: 'none', cursor: 'pointer', display: 'flex',
                                        background: viewMode === 'list' ? c.borderLight : 'transparent', color: viewMode === 'list' ? c.textSecondary : c.textSubtle
                                    }}>
                                    <List size={14} />
                                </button>
                            </div>
                            <button onClick={() => setShowPasteArea(!showPasteArea)}
                                data-tip={showPasteArea ? '收起导入面板' : '展开导入面板'}
                                style={{ ...toolbarBtn, background: c.bgInput, borderColor: c.borderLight, color: c.textMuted }}><Upload size={13} /> 导入教程</button>
                            {/* 刷新按钮 */}
                            {sheetUrl && extractSheetId(sheetUrl) && (
                                <button onClick={() => fetchFromUrl()} disabled={isFetching}
                                    style={{ ...toolbarBtn, background: c.bgInput, borderColor: c.borderLight, color: c.textMuted }} data-tip="从 Google Sheets 重新读取">
                                    <RefreshCw size={13} style={isFetching ? { animation: 'spin 1s linear infinite' } : undefined} /> 刷新
                                </button>
                            )}
                            <button onClick={() => setShowClassifyModal(true)} disabled={isClassifying}
                                data-tip="选择分类方式"
                                style={{ ...toolbarBtn, background: '#4338ca', borderColor: '#4338ca' }}>
                                {isClassifying ? <Loader2 size={13} style={{ animation: 'spin 1s linear infinite' }} /> : <Sparkles size={13} />}
                                {entries.some(e => e.mainCategory) ? ' 重新分类' : ' 分类'}
                            </button>
                            <button onClick={copyAllAsText} data-tip="复制当前筛选结果（制表符分隔）" style={{ ...toolbarBtn, background: c.bgInput, borderColor: c.borderLight, color: c.textMuted }}>
                                {copied ? <Check size={13} /> : <Copy size={13} />}
                            </button>
                            {/* 导出/导入分类 */}
                            {hasCategories && (
                                <button onClick={exportCategories} style={{ ...toolbarBtn, background: c.bgInput, borderColor: c.borderLight, color: c.textMuted }} data-tip="导出分类配置为 JSON">
                                    <Download size={13} />
                                </button>
                            )}
                            <button onClick={importCategories} style={{ ...toolbarBtn, background: c.bgInput, borderColor: c.borderLight, color: c.textMuted }} data-tip="从 JSON 导入分类配置">
                                <FileUp size={13} />
                            </button>
                            <button onClick={() => {
                                const confirmed = window.confirm('确定要清空当前教程数据吗？\n\n这会移除已导入数据和分类结果。');
                                if (!confirmed) return;
                                setEntries([]); setShowPasteArea(true); setPasteInput('');
                                setSelectedCategory(null); setSelectedMainCategory(null); setSearchText('');
                                setAiSearchResults(null);
                                Object.keys(categoryStyleMap).forEach(k => delete categoryStyleMap[k]);
                                localStorage.removeItem(LS_KEY_ENTRIES);
                            }} data-tip="清空当前教程数据（会二次确认）" style={{ ...toolbarBtn, background: c.dangerBg, borderColor: c.dangerBorder, color: c.textMuted }}>
                                <RotateCcw size={13} /> 清空
                            </button>
                        </div>
                    )}
                </div>

                {/* 进度 */}
                {progress && (
                    <div style={{
                        padding: '6px 16px', background: c.progressBg,
                        borderBottom: `1px solid ${c.progressBorder}`,
                        fontSize: '12px', color: c.accentText, display: 'flex', alignItems: 'center', gap: '8px',
                    }}>
                        {progress}
                    </div>
                )}

                {/* 分类 pills（侧边栏折叠时显示） */}
                {entries.length > 0 && hasCategories && sidebarCollapsed && (
                    <div style={{ padding: '8px 16px', borderBottom: `1px solid ${c.border}`, display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                        <button onClick={() => { setSelectedCategory(null); setSelectedMainCategory(null); }}
                            data-tip="查看全部教程"
                            style={{ ...pillStyle, borderColor: c.borderLight, background: (!selectedCategory && !selectedMainCategory) ? 'rgba(59,130,246,0.15)' : c.bgInput, color: (!selectedCategory && !selectedMainCategory) ? '#60a5fa' : c.textDim }}>
                            全部 {entries.length}
                        </button>
                        {categoryTree.map(group => {
                            const ms = getMainCategoryStyle(group.main);
                            const isActive = selectedMainCategory === group.main;
                            return (
                                <button key={group.main} onClick={() => { setSelectedMainCategory(isActive ? null : group.main); setSelectedCategory(null); }}
                                    data-tip={`按「${group.main}」筛选`}
                                    style={{ ...pillStyle, borderColor: c.borderLight, background: isActive ? ms.bg : c.bgInput, color: isActive ? ms.color : c.textDim }}>
                                    {ms.icon} {group.main} {group.count}
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* 导入区域 */}
                {showPasteArea && (
                    <div style={{ padding: '16px', borderBottom: `1px solid ${c.border}` }}>
                        {/* 导入模式切换 */}
                        <div style={{ display: 'flex', gap: '0', marginBottom: '12px' }}>
                            <button onClick={() => setImportMode('url')}
                                data-tip="切换到链接导入"
                                style={{
                                    padding: '7px 16px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                                    borderRadius: '8px 0 0 8px', border: `1px solid ${c.borderLight}`,
                                    background: importMode === 'url' ? '#4338ca' : c.bgInput,
                                    color: importMode === 'url' ? '#e4e4e7' : c.textDim,
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    borderRight: importMode === 'url' ? '1px solid #4338ca' : 'none',
                                }}>
                                <Link2 size={13} /> Google Sheets 链接
                            </button>
                            <button onClick={() => setImportMode('paste')}
                                data-tip="切换到粘贴导入"
                                style={{
                                    padding: '7px 16px', fontSize: '12px', fontWeight: 600, cursor: 'pointer',
                                    borderRadius: '0 8px 8px 0', border: `1px solid ${c.borderLight}`,
                                    background: importMode === 'paste' ? '#4338ca' : c.bgInput,
                                    color: importMode === 'paste' ? '#e4e4e7' : c.textDim,
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    borderLeft: importMode === 'paste' ? '1px solid #4338ca' : 'none',
                                }}>
                                <Upload size={13} /> 粘贴数据
                            </button>
                        </div>

                        {importMode === 'url' ? (
                            /* URL 导入 */
                            <div>
                                <div style={{ marginBottom: '8px', fontSize: '12px', color: c.textSubtle, lineHeight: '1.5' }}>
                                    粘贴 Google Sheets 链接，默认读取「总表」分页（表格需设为「知道链接的人可查看」）
                                    <br />
                                    <span style={{ color: c.textFaint }}>表格格式：日期 | 国家/小区 | 录屏名/文档名 | 链接(YouTube/Drive) | 概述/交流内容</span>
                                </div>
                                <div style={{ display: 'flex', gap: '8px' }}>
                                    <div style={{
                                        flex: 1, display: 'flex', alignItems: 'center', gap: '8px',
                                        background: c.bgAlt, border: `1px solid ${c.borderLight}`,
                                        borderRadius: '10px', padding: '8px 12px',
                                    }}>
                                        <Link2 size={14} style={{ color: c.textSubtle, flexShrink: 0 }} />
                                        <input
                                            type="text" value={sheetUrl}
                                            onChange={e => setSheetUrl(e.target.value)}
                                            placeholder="https://docs.google.com/spreadsheets/d/..."
                                            style={{
                                                flex: 1, background: 'transparent', border: 'none',
                                                color: c.textSecondary, fontSize: '13px', outline: 'none',
                                            }}
                                            onKeyDown={e => { if (e.key === 'Enter') handleUrlImport(); }}
                                        />
                                        {sheetUrl && extractSheetId(sheetUrl) && (
                                            <span style={{ fontSize: '10px', color: '#22c55e', flexShrink: 0 }}>✓ 链接有效</span>
                                        )}
                                    </div>
                                    <button onClick={handleUrlImport} disabled={isFetching}
                                        data-tip="读取当前 Google Sheets 链接"
                                        style={{ ...toolbarBtn, padding: '8px 20px', background: '#4338ca', borderColor: '#4338ca' }}>
                                        {isFetching ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
                                        {isFetching ? '读取中...' : '读取表格'}
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* 粘贴导入 */
                            <div>
                                <div style={{ marginBottom: '8px', fontSize: '12px', color: c.textSubtle }}>
                                    从 Google Sheets 复制表格内容后粘贴到这里：
                                </div>
                                <textarea
                                    value={pasteInput}
                                    onChange={e => setPasteInput(e.target.value)}
                                    placeholder={"在此粘贴教程表格数据…\n支持格式：日期 | 录屏名 | 文档链接 | 概述/交流内容\n自动识别 YouTube、Google Drive、文档等链接类型"}
                                    style={{
                                        width: '100%', minHeight: '120px', resize: 'vertical',
                                        background: c.bgAlt, border: `1px solid ${c.borderLight}`,
                                        borderRadius: '10px', padding: '12px', color: c.textSecondary,
                                        fontSize: '13px', fontFamily: 'monospace', outline: 'none',
                                    }}
                                    onPaste={e => { e.preventDefault(); const text = e.clipboardData.getData('text/plain'); if (text) setPasteInput(text); }}
                                />
                                <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                                    <button onClick={handlePasteImport}
                                        data-tip="从粘贴内容载入教程数据"
                                        style={{ ...toolbarBtn, padding: '8px 20px', background: '#4338ca', borderColor: '#4338ca' }}>
                                        <Check size={14} /> 载入数据
                                    </button>
                                </div>
                            </div>
                        )}

                        {entries.length > 0 && (
                            <div style={{ marginTop: '8px' }}>
                                <button onClick={() => { setShowPasteArea(false); setPasteInput(''); }}
                                    data-tip="关闭导入面板"
                                    style={{ ...toolbarBtn, background: c.bgInput, borderColor: c.borderLight, color: c.textMuted }}>取消</button>
                            </div>
                        )}
                    </div>
                )}

                {/* ===== 内容区 ===== */}
                <div style={{ flex: 1, overflow: 'auto', padding: entries.length > 0 ? '16px' : '0' }}>
                    {/* 空状态 */}
                    {entries.length === 0 && !showPasteArea && (
                        <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100%', color: c.textFaint, gap: '16px' }}>
                            <BookOpen size={48} strokeWidth={1} />
                            <div style={{ fontSize: '15px' }}>还没有导入教程数据</div>
                            <button onClick={() => setShowPasteArea(true)}
                                data-tip="打开导入面板"
                                style={{ ...toolbarBtn, padding: '10px 24px', fontSize: '14px', background: c.bgInput, borderColor: c.borderLight, color: c.textMuted }}>
                                <Upload size={16} /> 粘贴导入
                            </button>
                        </div>
                    )}

                    {/* 无匹配 */}
                    {filteredEntries.length === 0 && entries.length > 0 && (
                        <div style={{ textAlign: 'center', padding: '60px 0', color: c.textFaint }}>
                            <Search size={32} strokeWidth={1} style={{ marginBottom: '12px' }} />
                            <div>没有匹配的教程</div>
                        </div>
                    )}

                    {/* 卡片网格 */}
                    {viewMode === 'grid' ? (
                        <div style={{
                            display: 'grid',
                            gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))',
                            gap: '12px',
                        }}>
                            {filteredEntries.map((entry, idx) => {
                                const catStyle = entry.subCategory ? getCategoryStyle(entry.subCategory) : null;
                                // 分类链接
                                const videoLinks = entry.links.filter(l => l.type === 'youtube' || l.type === 'video-file');
                                const docLinks = entry.links.filter(l => l.type === 'google-doc' || l.type === 'google-sheet' || l.type === 'google-slides' || l.type === 'drive-file' || l.type === 'drive-folder');
                                const otherLinks = entry.links.filter(l => l.type === 'generic');
                                const fieldLabelStyle: React.CSSProperties = { fontSize: '10px', color: c.textSubtle, fontWeight: 700, minWidth: '52px', flexShrink: 0 };
                                const fieldValueStyle: React.CSSProperties = { fontSize: '12px', color: c.textMuted, lineHeight: '1.5', flex: 1, minWidth: 0 };
                                const noValueStyle: React.CSSProperties = { fontSize: '11px', color: c.textSubtle, fontStyle: 'italic' };
                                const linkInlineStyle: React.CSSProperties = { color: '#60a5fa', textDecoration: 'none', fontSize: '11px', display: 'inline-flex', alignItems: 'center', gap: '3px', transition: 'color 0.15s' };
                                const cardBg = idx % 2 === 0 ? c.bgCard : c.bgAlt;
                                return (
                                    <div key={entry.id} style={{
                                        background: cardBg,
                                        border: `1px solid ${c.border}`,
                                        borderRadius: '12px',
                                        padding: '14px',
                                        display: 'flex', flexDirection: 'column', gap: '0',
                                        transition: 'all 0.2s',
                                        cursor: 'default',
                                    }}
                                        onMouseEnter={e => {
                                            (e.currentTarget as HTMLDivElement).style.borderColor = c.borderHover;
                                            (e.currentTarget as HTMLDivElement).style.boxShadow = `0 4px 20px ${c.shadow}`;
                                        }}
                                        onMouseLeave={e => {
                                            (e.currentTarget as HTMLDivElement).style.borderColor = c.border;
                                            (e.currentTarget as HTMLDivElement).style.boxShadow = 'none';
                                        }}
                                    >
                                        {/* 顶部：大类 + 子分类 */}
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', flexWrap: 'wrap', marginBottom: '8px' }}>
                                            {entry.mainCategory && (() => {
                                                const ms = getMainCategoryStyle(entry.mainCategory);
                                                return (
                                                    <span
                                                        onClick={() => { setSelectedMainCategory(entry.mainCategory === selectedMainCategory ? null : entry.mainCategory); setSelectedCategory(null); }}
                                                        style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', background: ms.bg, color: ms.color, cursor: 'pointer', border: `1px solid ${ms.color}22` }}
                                                    >{ms.icon} {entry.mainCategory}</span>
                                                );
                                            })()}
                                            {catStyle && entry.subCategory && (
                                                <span onClick={() => { setSelectedCategory(entry.subCategory === selectedCategory ? null : entry.subCategory); setSelectedMainCategory(entry.mainCategory); }}
                                                    style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', background: catStyle.bg, color: catStyle.color, cursor: 'pointer' }}>
                                                    {entry.subCategory}
                                                </span>
                                            )}
                                        </div>

                                        {/* 标题 */}
                                        <div style={{
                                            fontSize: '14px', fontWeight: 700, color: c.text, lineHeight: '1.4', marginBottom: '10px',
                                            display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden'
                                        }}>
                                            {entry.name}
                                        </div>

                                        {/* 结构化字段 */}
                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', borderTop: `1px solid ${c.bgHover}`, paddingTop: '10px' }}>
                                            {/* 录屏 */}
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                                <span style={fieldLabelStyle}>🎬 录屏</span>
                                                <div style={fieldValueStyle}>
                                                    {videoLinks.length > 0 ? videoLinks.map((link, li) => {
                                                        const cfg = LINK_CONFIG[link.type];
                                                        return link.url ? (
                                                            <a key={li} href={link.url} target="_blank" rel="noopener noreferrer" style={{ ...linkInlineStyle, color: cfg.color, marginRight: '8px' }}
                                                                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.7'; }}
                                                                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1'; }}>
                                                                {cfg.icon} {cfg.label} <ExternalLink size={9} style={{ opacity: 0.5 }} />
                                                            </a>
                                                        ) : <span key={li} style={{ fontSize: '11px', color: c.textSubtle, marginRight: '8px' }}>{cfg.icon} {link.label}</span>;
                                                    }) : <span style={noValueStyle}>无</span>}
                                                </div>
                                            </div>
                                            {/* 文档 */}
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                                <span style={fieldLabelStyle}>📄 文档</span>
                                                <div style={fieldValueStyle}>
                                                    {docLinks.length > 0 ? docLinks.map((link, li) => {
                                                        const cfg = LINK_CONFIG[link.type];
                                                        return link.url ? (
                                                            <a key={li} href={link.url} target="_blank" rel="noopener noreferrer" style={{ ...linkInlineStyle, color: cfg.color, marginRight: '8px' }}
                                                                onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.7'; }}
                                                                onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1'; }}>
                                                                {cfg.icon} {cfg.label} <ExternalLink size={9} style={{ opacity: 0.5 }} />
                                                            </a>
                                                        ) : <span key={li} style={{ fontSize: '11px', color: c.textSubtle, marginRight: '8px' }}>{cfg.icon} {link.label}</span>;
                                                    }) : <span style={noValueStyle}>无</span>}
                                                </div>
                                            </div>
                                            {/* 其他链接 */}
                                            {otherLinks.length > 0 && (
                                                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                                    <span style={fieldLabelStyle}>🔗 链接</span>
                                                    <div style={fieldValueStyle}>
                                                        {otherLinks.map((link, li) => {
                                                            const cfg = LINK_CONFIG[link.type];
                                                            return link.url ? (
                                                                <a key={li} href={link.url} target="_blank" rel="noopener noreferrer" style={{ ...linkInlineStyle, marginRight: '8px' }}
                                                                    onMouseEnter={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '0.7'; }}
                                                                    onMouseLeave={e => { (e.currentTarget as HTMLAnchorElement).style.opacity = '1'; }}>
                                                                    {cfg.icon} 链接 <ExternalLink size={9} style={{ opacity: 0.5 }} />
                                                                </a>
                                                            ) : null;
                                                        })}
                                                    </div>
                                                </div>
                                            )}
                                            {/* 概述 */}
                                            <div style={{ display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
                                                <span style={fieldLabelStyle}>📝 概述</span>
                                                <div style={{ ...fieldValueStyle, display: '-webkit-box', WebkitLineClamp: 3, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                                                    {entry.description || <span style={noValueStyle}>无</span>}
                                                </div>
                                            </div>
                                            {/* 底部信息 */}
                                            <div style={{ display: 'flex', gap: '16px', marginTop: '2px' }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <span style={{ fontSize: '10px', color: c.textFaint }}>🌍</span>
                                                    <span style={{ fontSize: '10px', color: c.textSubtle }}>{entry.source || '无'}</span>
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                                    <span style={{ fontSize: '10px', color: c.textFaint }}>📅</span>
                                                    <span style={{ fontSize: '10px', color: c.textSubtle }}>{entry.date || '无'}</span>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        /* 列表视图 */
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
                            {filteredEntries.map((entry, idx) => {
                                const catStyle = entry.subCategory ? getCategoryStyle(entry.subCategory) : null;
                                const videoLinks = entry.links.filter(l => l.type === 'youtube' || l.type === 'video-file');
                                const docLinks = entry.links.filter(l => l.type === 'google-doc' || l.type === 'google-sheet' || l.type === 'google-slides' || l.type === 'drive-file' || l.type === 'drive-folder');
                                const otherLinks = entry.links.filter(l => l.type === 'generic');
                                const allTypedLinks = [...videoLinks.map(l => ({ ...l, cat: '录屏' })), ...docLinks.map(l => ({ ...l, cat: '文档' })), ...otherLinks.map(l => ({ ...l, cat: '链接' }))];
                                return (
                                    <div key={entry.id} style={{
                                        display: 'flex', alignItems: 'center', gap: '12px',
                                        padding: '10px 14px', borderRadius: '10px',
                                        background: idx % 2 === 0 ? c.bgCard : c.bgAlt, border: `1px solid ${c.border}`,
                                        transition: 'all 0.15s',
                                    }}
                                        onMouseEnter={e => { (e.currentTarget as HTMLDivElement).style.borderColor = c.borderHover; }}
                                        onMouseLeave={e => { (e.currentTarget as HTMLDivElement).style.borderColor = c.border; }}
                                    >
                                        <span style={{ fontSize: '11px', color: c.textFaint, minWidth: '24px', textAlign: 'center', flexShrink: 0 }}>
                                            {idx + 1}
                                        </span>
                                        {entry.mainCategory && (() => {
                                            const ms = getMainCategoryStyle(entry.mainCategory);
                                            return (
                                                <span onClick={() => { setSelectedMainCategory(entry.mainCategory === selectedMainCategory ? null : entry.mainCategory); setSelectedCategory(null); }}
                                                    style={{ fontSize: '10px', fontWeight: 700, padding: '2px 8px', borderRadius: '10px', background: ms.bg, color: ms.color, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0, border: `1px solid ${ms.color}22` }}>
                                                    {ms.icon} {entry.mainCategory}
                                                </span>
                                            );
                                        })()}
                                        {catStyle && entry.subCategory && (
                                            <span onClick={() => { setSelectedCategory(entry.subCategory === selectedCategory ? null : entry.subCategory); setSelectedMainCategory(entry.mainCategory); }}
                                                style={{ fontSize: '10px', fontWeight: 600, padding: '2px 8px', borderRadius: '10px', background: catStyle.bg, color: catStyle.color, cursor: 'pointer', whiteSpace: 'nowrap', flexShrink: 0 }}>
                                                {entry.subCategory}
                                            </span>
                                        )}
                                        <div style={{ flex: 1, minWidth: 0 }}>
                                            <div style={{ fontSize: '13px', fontWeight: 600, color: c.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                {entry.name}
                                            </div>
                                            {entry.description && (
                                                <div style={{ fontSize: '11px', color: c.textSubtle, marginTop: '2px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                    {entry.description}
                                                </div>
                                            )}
                                        </div>
                                        {entry.source && <span style={{ fontSize: '10px', color: c.textFaint, flexShrink: 0 }}>🌍 {entry.source}</span>}
                                        {entry.date && <span style={{ fontSize: '10px', color: c.textFaint, flexShrink: 0 }}>📅 {entry.date}</span>}
                                        <div style={{ display: 'flex', gap: '4px', flexShrink: 0 }}>
                                            {allTypedLinks.map((link, li) => {
                                                const cfg = LINK_CONFIG[link.type];
                                                return link.url ? (
                                                    <a key={li} href={link.url} target="_blank" rel="noopener noreferrer" data-tip={`${link.cat}: ${link.url}`}
                                                        style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '8px', background: cfg.bg, border: `1px solid ${cfg.color}22`, textDecoration: 'none', fontSize: '14px', transition: 'all 0.15s' }}>
                                                        {cfg.icon}
                                                    </a>
                                                ) : (
                                                    <span key={li} style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '8px', background: cfg.bg, fontSize: '14px' }}>
                                                        {cfg.icon}
                                                    </span>
                                                );
                                            })}
                                            {allTypedLinks.length === 0 && <span style={{ fontSize: '10px', color: c.borderLight }}>无链接</span>}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>

            {/* CSS for spin animation */}
            <style>{`
                @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
                [data-tip] { position: relative; }
                [data-tip]::after {
                    content: attr(data-tip);
                    position: absolute;
                    top: calc(100% + 6px);
                    bottom: auto;
                    left: 50%;
                    transform: translateX(-50%);
                    padding: 5px 10px;
                    background: #27272a;
                    color: #e4e4e7;
                    font-size: 11px;
                    font-weight: 500;
                    white-space: normal;
                    width: max-content;
                    max-width: 360px;
                    text-align: center;
                    word-break: break-word;
                    border-radius: 6px;
                    border: 1px solid #3f3f46;
                    pointer-events: none;
                    opacity: 0;
                    transition: opacity 0.15s;
                    z-index: 999;
                    box-shadow: 0 4px 12px rgba(0,0,0,0.35);
                }
                [data-tip]:hover::after {
                    opacity: 1;
                    transition-delay: 0.25s;
                }
                .tutorial-hub-search-input {
                    -webkit-text-fill-color: currentColor !important;
                    -webkit-text-stroke: 0 !important;
                    text-shadow: none !important;
                    opacity: 1 !important;
                    font-weight: 500;
                    box-shadow: none !important;
                    appearance: none;
                }
                .tutorial-hub-search-input::placeholder {
                    color: #71717a;
                    opacity: 1;
                    -webkit-text-fill-color: #71717a;
                }
            `}</style>

            {/* 分类方式选择弹框 */}
            {showClassifyModal && (
                <div onClick={() => setShowClassifyModal(false)} style={{
                    position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999,
                }}>
                    <div onClick={e => e.stopPropagation()} style={{
                        background: c.bgCard, border: `1px solid ${c.borderLight}`, borderRadius: '16px',
                        padding: '28px 32px', minWidth: '340px', maxWidth: '420px',
                        boxShadow: `0 20px 60px ${c.shadow}`,
                    }}>
                        <h3 style={{ margin: '0 0 6px', fontSize: '16px', fontWeight: 700, color: c.text }}>选择分类方式</h3>
                        <p style={{ margin: '0 0 20px', fontSize: '12px', color: c.textDim, lineHeight: 1.5 }}>
                            为 {entries.length} 条教程选择分类方法
                        </p>
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                            <button
                                onClick={classifyWithAI}
                                disabled={!hasApiKey}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px',
                                    borderRadius: '12px', border: `1px solid ${hasApiKey ? '#6366f1' : c.borderLight}`,
                                    background: hasApiKey ? 'linear-gradient(135deg, rgba(67,56,202,0.15), rgba(99,102,241,0.08))' : c.bgInput,
                                    cursor: hasApiKey ? 'pointer' : 'not-allowed',
                                    opacity: hasApiKey ? 1 : 0.5,
                                    textAlign: 'left', transition: 'all 0.15s',
                                }}>
                                <div style={{
                                    width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
                                    background: hasApiKey ? 'linear-gradient(135deg, #4338ca, #6d28d9)' : c.bgHover,
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <Sparkles size={18} style={{ color: hasApiKey ? '#e0e7ff' : c.textFaint }} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '13px', fontWeight: 700, color: hasApiKey ? c.text : c.textDim }}>✨ AI 智能分类</div>
                                    <div style={{ fontSize: '11px', color: c.textDim, marginTop: '2px' }}>
                                        使用 Gemini AI 分析内容自动分类（需要 API Key）
                                    </div>
                                    <div style={{ fontSize: '10px', marginTop: '3px', color: hasApiKey ? '#22c55e' : '#ef4444' }}>
                                        {hasApiKey ? '✓ 已检测到 API Key' : '✗ 未检测到 API Key，请先在设置中配置'}
                                    </div>
                                </div>
                            </button>
                            <button
                                onClick={applyPresetCategories}
                                style={{
                                    display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px',
                                    borderRadius: '12px', border: `1px solid ${c.borderLight}`,
                                    background: c.bgInput, cursor: 'pointer',
                                    textAlign: 'left', transition: 'all 0.15s',
                                }}>
                                <div style={{
                                    width: '36px', height: '36px', borderRadius: '10px', flexShrink: 0,
                                    background: 'linear-gradient(135deg, rgba(34,197,94,0.2), rgba(16,185,129,0.1))',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    <FolderOpen size={18} style={{ color: '#22c55e' }} />
                                </div>
                                <div>
                                    <div style={{ fontSize: '13px', fontWeight: 700, color: c.text }}>📂 预设分类</div>
                                    <div style={{ fontSize: '11px', color: c.textDim, marginTop: '2px' }}>使用内置的 272 条分类规则匹配</div>
                                </div>
                            </button>
                        </div>
                        <button onClick={() => setShowClassifyModal(false)} style={{
                            width: '100%', marginTop: '16px', padding: '8px', borderRadius: '8px',
                            border: `1px solid ${c.borderLight}`, background: 'transparent',
                            color: c.textDim, fontSize: '12px', cursor: 'pointer', transition: 'all 0.15s',
                        }}>取消</button>
                    </div>
                </div>
            )}
        </div>
    );
};

// 通用按钮样式
const toolbarBtn: React.CSSProperties = {
    display: 'inline-flex', alignItems: 'center', gap: '5px',
    padding: '5px 12px', borderRadius: '7px', fontSize: '12px', fontWeight: 600,
    border: '1px solid #27272a', cursor: 'pointer',
    background: '#18181b', color: '#a1a1aa', whiteSpace: 'nowrap',
    transition: 'all 0.15s',
};

const pillStyle: React.CSSProperties = {
    padding: '4px 12px', borderRadius: '20px', fontSize: '11px', fontWeight: 600,
    border: '1px solid #27272a', cursor: 'pointer', transition: 'all 0.15s',
    whiteSpace: 'nowrap',
};

export default TutorialHubApp;
