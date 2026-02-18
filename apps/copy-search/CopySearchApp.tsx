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
    Sparkles, Bot,
} from 'lucide-react';

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
    useAi?: boolean;         // 是否使用 AI 搜索
    threshold?: number;      // 单独相似度阈值（优先于全局，undefined 则跟随全局）
}

interface TableState {
    headers: string[];
    rows: CellData[][];
    noteColumnVisible: boolean;
}

// ===== MinHash + LSH 算法（复用 minHashEngine 核心逻辑） =====

const SHINGLE_SIZE = 3;

/** 文本预处理：小写、去标点、规范化空格 */
function preprocessText(text: string): string {
    return text
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

/** 生成 N-gram Shingles */
function generateShingles(text: string, n: number = SHINGLE_SIZE): Set<string> {
    const processed = preprocessText(text);
    const shingles = new Set<string>();
    if (processed.length < n) {
        shingles.add(processed);
        return shingles;
    }
    for (let i = 0; i <= processed.length - n; i++) {
        shingles.add(processed.substring(i, i + n));
    }
    return shingles;
}

/** 精确 Jaccard 相似度 */
function exactJaccard(set1: Set<string>, set2: Set<string>): number {
    if (set1.size === 0 && set2.size === 0) return 0;
    let intersection = 0;
    for (const item of set1) {
        if (set2.has(item)) intersection++;
    }
    const union = set1.size + set2.size - intersection;
    return union > 0 ? intersection / union : 0;
}

// ===== 预设颜色 =====
const PRESET_COLORS = [
    '#ff6b6b', '#ffa94d', '#ffd43b', '#69db7c', '#38d9a9',
    '#4dabf7', '#748ffc', '#da77f2', '#f783ac', '#e599f7',
    '#ff8787', '#ffc078', '#ffe066', '#8ce99a', '#63e6be',
    '#74c0fc', '#91a7ff', '#e599f7', '#faa2c1', '#c0eb75',
];

// ===== 解析粘贴数据（Google Sheets / Excel 标准 TSV 格式） =====
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
                if (currentRow.some(c => c !== '')) {
                    allRows.push(currentRow);
                }
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
    if (currentRow.some(c => c !== '')) {
        allRows.push(currentRow);
    }

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
        const rows = allRows.slice(1).map(padRow).filter(r => r.some(c => c.trim()));
        return { headers, rows };
    } else {
        const headers = Array.from({ length: maxCols }, (_, i) => `列${i + 1}`);
        const rows = allRows.map(padRow).filter(r => r.some(c => c.trim()));
        return { headers, rows };
    }
}

// ===== AI 搜索结果类型 =====
interface AiSearchResult {
    rowIndex: number;
    reason: string;
    relevance: number; // 1-100
}

// ===== 组件 =====
interface Props {
    getAiInstance?: () => any;
}

interface ExpandedModalState {
    text: string;
    title: string;
    editable?: boolean;
    queryId?: string;
    noteRowIndex?: number;
    accentColor?: string;
}

const CopySearchApp: React.FC<Props> = ({ getAiInstance }) => {
    // 表格状态
    const [table, setTable] = useState<TableState>({ headers: [], rows: [], noteColumnVisible: true });
    const [pasteInput, setPasteInput] = useState('');
    const [showPasteArea, setShowPasteArea] = useState(true);

    // 搜索项
    const [queries, setQueries] = useState<SearchQuery[]>([
        { id: uuidv4(), text: '', noteText: '', color: PRESET_COLORS[0], enabled: true, isSearching: false, resultCount: 0 },
    ]);

    // 配置
    const [threshold, setThreshold] = useState(0.45); // MinHash Jaccard 阈值默认 0.45
    const [searchCol, setSearchCol] = useState<number>(0); // 默认搜索第一列（指定列）
    const [searchMode, setSearchMode] = useState<'contains' | 'similar'>('similar'); // 默认相似模式
    const [showSettings, setShowSettings] = useState(false);
    const [searchQueriesCollapsed, setSearchQueriesCollapsed] = useState(false);
    const [globalProgress, setGlobalProgress] = useState('');
    const [expandedModal, setExpandedModal] = useState<ExpandedModalState | null>(null);
    const [expandedDraft, setExpandedDraft] = useState('');

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

    useEffect(() => {
        tableRef.current = table;
    }, [table]);

    // ===== 粘贴数据 =====
    const handlePaste = useCallback(() => {
        if (!pasteInput.trim()) return;
        const { headers, rows: rawRows } = parseTableData(pasteInput);
        if (headers.length === 0) return;

        const rows: CellData[][] = rawRows.map(row =>
            row.map(val => ({ value: val, highlights: [], note: '' }))
        );
        setTable({ headers, rows, noteColumnVisible: true });
        setShowPasteArea(false);
        setPasteInput('');
        shingleCache.current.clear();
    }, [pasteInput]);

    // ===== 搜索项管理 =====
    const addQuery = () => {
        const usedColors = new Set(queries.map(q => q.color));
        const nextColor = PRESET_COLORS.find(c => !usedColors.has(c)) || PRESET_COLORS[queries.length % PRESET_COLORS.length];
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
        mode: 'contains' | 'similar',
        similarityPercent?: number,
    ) => {
        const label = getQueryLabel(queryLike);
        if (mode === 'contains') {
            return `🔍 命中 ${label}`;
        }
        if (typeof similarityPercent === 'number') {
            return `🔍 相似 ${similarityPercent}% - ${label}`;
        }
        return `🔍 相似 - ${label}`;
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
        if (manualNote && matchSummary) return `${manualNote} | ${matchSummary}`;
        return manualNote || matchSummary;
    }, [getRowManualNote, getRowMatchSummary]);

    // ===== 执行搜索 =====
    const executeSearch = (query: SearchQuery) => {
        if (!query.text.trim() || tableRef.current.rows.length === 0) return;

        updateQuery(query.id, { isSearching: true, resultCount: 0 });
        const startTime = performance.now();

        // 异步执行以免阻塞 UI
        setTimeout(() => {
            try {
                // 先基于 ref 同步计算新行和匹配数，避免 setTable updater 时序问题
                const prev = tableRef.current;
                const matchedRows = new Set<number>();

                // 先清理该搜索项旧高亮，避免重复
                const updatedRows = prev.rows.map(row => row.map(cell => ({
                    ...cell,
                    highlights: cell.highlights.filter(h => h.queryId !== query.id),
                })));

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
                    if (searchMode === 'contains') {
                        // ===== 包含搜索：大小写不敏感的子串匹配 =====
                        const queryLower = query.text.toLowerCase();

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
                        const queryShingles = generateShingles(query.text);

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
                                similarity: Math.round(similarity * 100),
                                queryText: query.text,
                            });
                            const similarityPercent = Math.round(similarity * 100);
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
                const modeLabel = searchMode === 'contains' ? '包含搜索' : 'MinHash + Jaccard';
                updateQuery(query.id, { isSearching: false, resultCount: matchedRowCount });
                setGlobalProgress(`✅ ${matchedRowCount} 行匹配 (${elapsed}ms, ${modeLabel})`);
                setTimeout(() => setGlobalProgress(''), 3000);
            } catch (err: any) {
                console.error('搜索失败:', err);
                setGlobalProgress(`搜索失败: ${err.message || '未知错误'}`);
                updateQuery(query.id, { isSearching: false });
            }
        }, 10);
    };

    // ===== 单个搜索项的 AI 搜索 =====
    const executeAiQuerySearch = async (query: SearchQuery) => {
        if (!query.text.trim() || tableRef.current.rows.length === 0) return;
        if (!getAiInstance) {
            setGlobalProgress('⚠️ AI 搜索需要配置 API Key');
            setTimeout(() => setGlobalProgress(''), 3000);
            return;
        }

        updateQuery(query.id, { isSearching: true, resultCount: 0 });
        setGlobalProgress(`🤖 AI 搜索中: ${query.text.substring(0, 30)}...`);

        try {
            const ai = getAiInstance();
            if (!ai) {
                updateQuery(query.id, { isSearching: false });
                setGlobalProgress('⚠️ 请先配置 API Key');
                setTimeout(() => setGlobalProgress(''), 3000);
                return;
            }

            const prev = tableRef.current;
            const rows = prev.rows;
            const col = searchCol >= 0 ? searchCol : -1;

            // 先清除该搜索项旧高亮
            const updatedRows = rows.map(row => row.map(cell => ({
                ...cell,
                highlights: cell.highlights.filter(h => h.queryId !== query.id),
            })));

            // 收集文本
            const rowTexts: { idx: number; text: string }[] = [];
            updatedRows.forEach((row, ri) => {
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
                setGlobalProgress('⚠️ 表格中没有可搜索的内容');
                setTimeout(() => setGlobalProgress(''), 3000);
                return;
            }

            const BATCH = 50;
            let matchedCount = 0;

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
                    model: 'gemini-2.5-flash',
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
                                    if (!cell.note) {
                                        cell.note = noteContent;
                                    } else if (!cell.note.includes(noteContent)) {
                                        cell.note += ` | ${noteContent}`;
                                    }
                                });
                            }
                        });
                    } catch (parseErr) {
                        console.warn('AI 返回 JSON 解析失败:', parseErr);
                    }
                }
            }

            setTable({ ...prev, rows: updatedRows });
            updateQuery(query.id, { isSearching: false, resultCount: matchedCount });
            setGlobalProgress(`✅ AI 搜索完成: ${matchedCount} 行匹配`);
            setTimeout(() => setGlobalProgress(''), 3000);
        } catch (err: any) {
            console.error('AI 搜索失败:', err);
            updateQuery(query.id, { isSearching: false });
            setGlobalProgress(`❌ AI 搜索失败: ${err.message || '未知错误'}`);
            setTimeout(() => setGlobalProgress(''), 4000);
        }
    };

    // ===== 全部搜索 =====
    const executeAllSearches = () => {
        const activeQueries = queries.filter(q => q.enabled && q.text.trim());
        if (activeQueries.length === 0 || tableRef.current.rows.length === 0) return;

        const activeIds = new Set(activeQueries.map(q => q.id));
        setQueries(prev => prev.map(q =>
            activeIds.has(q.id) ? { ...q, isSearching: true, resultCount: 0 } : q
        ));
        const startTime = performance.now();

        setTimeout(() => {
            try {
                const resultCounts = new Map<string, number>();

                // 基于 ref 同步计算，避免 setTable updater 时序问题
                const prev = tableRef.current;

                // 先清除所有将要重新搜索项的旧高亮，避免重复/串色
                const updatedRows = prev.rows.map(row => row.map(cell => ({
                    ...cell,
                    highlights: cell.highlights.filter(h => !activeIds.has(h.queryId)),
                })));

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
                } else {
                    activeQueries.forEach(query => {
                        const matchedRows = new Set<number>();
                        if (searchMode === 'contains') {
                            const queryLower = query.text.toLowerCase();
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
                                const noteKey = getQueryLabel(query);
                                if (!cell.note) {
                                    cell.note = noteContent;
                                } else if (!cell.note.includes(noteKey)) {
                                    cell.note += ` | ${noteContent}`;
                                }
                            });
                        } else {
                            const queryShingles = generateShingles(query.text);
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
                                    similarity: Math.round(similarity * 100),
                                    queryText: query.text,
                                });
                                const similarityPercent = Math.round(similarity * 100);
                                const noteContent = buildQueryNoteContent(query, 'similar', similarityPercent);
                                const noteKey = getQueryLabel(query);
                                if (!cell.note) {
                                    cell.note = noteContent;
                                } else if (!cell.note.includes(noteKey)) {
                                    cell.note += ` | ${noteContent}`;
                                }
                            });
                        }
                        resultCounts.set(query.id, matchedRows.size);
                    });
                }

                // 同步设置 table 和 query 状态
                setTable({ ...prev, rows: updatedRows });

                setQueries(prev => prev.map(q =>
                    activeIds.has(q.id)
                        ? { ...q, isSearching: false, resultCount: resultCounts.get(q.id) || 0 }
                        : q
                ));

                const totalRows = Array.from(resultCounts.values()).reduce((a, b) => a + b, 0);
                const elapsed = Math.round(performance.now() - startTime);
                const modeLabel = searchMode === 'contains' ? '包含搜索' : 'MinHash + Jaccard';
                setGlobalProgress(`✅ 已完成 ${activeQueries.length} 项搜索，合计 ${totalRows} 行匹配 (${elapsed}ms, ${modeLabel})`);
                setTimeout(() => setGlobalProgress(''), 3000);
            } catch (err: any) {
                console.error('全部搜索失败:', err);
                setGlobalProgress(`全部搜索失败: ${err.message || '未知错误'}`);
                setQueries(prev => prev.map(q =>
                    activeIds.has(q.id) ? { ...q, isSearching: false } : q
                ));
            }
        }, 10);
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

    // ===== 复制 HTML 到剪贴板（兼容 Google Sheets） =====
    const copyHtmlToClipboard = (html: string, plainText: string, successMsg: string) => {
        const richHtml = `<!doctype html><html><body>${html}</body></html>`;
        // 方案1: ClipboardItem API（现代浏览器直接写入 HTML）
        if (typeof ClipboardItem !== 'undefined') {
            const htmlBlob = new Blob([richHtml], { type: 'text/html' });
            const textBlob = new Blob([plainText], { type: 'text/plain' });
            navigator.clipboard.write([
                new ClipboardItem({ 'text/html': htmlBlob, 'text/plain': textBlob }),
            ]).then(() => {
                setGlobalProgress(successMsg);
                setTimeout(() => setGlobalProgress(''), 3000);
            }).catch(() => {
                // fallback
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
        const { headers, rows, noteColumnVisible } = table;
        // 筛选出该搜索项命中的行
        const matchedRows = rows.filter(row =>
            row.some(cell => cell.highlights.some(h => h.queryId === queryId))
        );
        if (matchedRows.length === 0) return;

        const query = queries.find(q => q.id === queryId);
        const qColor = query?.color || '#fbbf24';

        // HTML
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
                const hit = cell.highlights.find(h => h.queryId === queryId);
                const bg = hit ? qColor : '';
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

        // TSV
        let tsv = headers.join('\t') + (noteColumnVisible ? '\t备注' : '') + '\n';
        matchedRows.forEach(row => {
            tsv += row.map(c => c.value).join('\t');
            if (noteColumnVisible) {
                const notes = getRowNoteWithSummary(row);
                tsv += '\t' + notes;
            }
            tsv += '\n';
        });

        copyHtmlToClipboard(html, tsv, `✅ 已复制 ${matchedRows.length} 行匹配结果`);
    }, [table, queries, getRowNoteWithSummary]);

    // ===== 复制表格（支持筛选模式） =====
    const copyFilteredTable = useCallback((mode: 'all' | 'highlighted' | 'unhighlighted') => {
        const { headers, rows, noteColumnVisible } = table;
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

        // 构建 HTML 表格（Excel/Sheets 可识别内联样式）
        let html = '<table>';
        // 表头
        html += '<tr>';
        headers.forEach(h => {
            html += `<td style="font-weight:bold;background-color:#333333;color:#ffffff;padding:4px 8px;border:1px solid #cccccc;">${escHtml(h)}</td>`;
        });
        if (noteColumnVisible) {
            html += '<td style="font-weight:bold;background-color:#333333;color:#ffffff;padding:4px 8px;border:1px solid #cccccc;">备注</td>';
        }
        html += '</tr>';

        // 数据行
        filteredRows.forEach(row => {
            html += '<tr>';
            row.forEach(cell => {
                const bg = cell.highlights.length > 0 ? cell.highlights[0].color : '';
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
        filteredRows.forEach(row => {
            tsv += row.map(c => c.value).join('\t');
            if (noteColumnVisible) {
                const notes = getRowNoteWithSummary(row);
                tsv += '\t' + notes;
            }
            tsv += '\n';
        });

        const labels = { all: '全部', highlighted: '高亮', unhighlighted: '未高亮' };
        copyHtmlToClipboard(html, tsv, `✅ 已复制 ${filteredRows.length} 行${labels[mode]}数据`);
    }, [table, getRowNoteWithSummary]);

    const copyTableWithColors = useCallback(() => copyFilteredTable('all'), [copyFilteredTable]);
    const copyHighlightedOnly = useCallback(() => copyFilteredTable('highlighted'), [copyFilteredTable]);
    const copyUnhighlightedOnly = useCallback(() => copyFilteredTable('unhighlighted'), [copyFilteredTable]);

    // ===== 自动查重：用 Union-Find 聚类相似文案 =====
    const autoDedup = useCallback(() => {
        const { rows } = table;
        if (rows.length === 0) return;

        setGlobalProgress('🔍 正在自动查重...');
        // 延迟执行以让 UI 更新
        setTimeout(() => {
            const col = searchCol;
            // 1. 收集每行的文本和 shingles
            const texts: { text: string; shingles: Set<string>; rowIdx: number }[] = [];
            rows.forEach((row, ri) => {
                const cellVal = row[col]?.value || '';
                if (cellVal.trim()) {
                    const key = `auto_${ri}_${col}`;
                    if (!shingleCache.current.has(key)) {
                        shingleCache.current.set(key, generateShingles(cellVal));
                    }
                    texts.push({ text: cellVal, shingles: shingleCache.current.get(key)!, rowIdx: ri });
                }
            });

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

            // 3. 两两比较
            for (let i = 0; i < texts.length; i++) {
                for (let j = i + 1; j < texts.length; j++) {
                    const sim = exactJaccard(texts[i].shingles, texts[j].shingles);
                    if (sim >= threshold) {
                        union(texts[i].rowIdx, texts[j].rowIdx);
                    }
                }
            }

            // 4. 分组
            const groups = new Map<number, number[]>();
            texts.forEach(t => {
                const root = find(t.rowIdx);
                if (!groups.has(root)) groups.set(root, []);
                groups.get(root)!.push(t.rowIdx);
            });

            // 5. 过滤出有重复的组（>1条），分配颜色
            const dupGroups = Array.from(groups.values()).filter(g => g.length > 1);
            if (dupGroups.length === 0) {
                setGlobalProgress('✅ 没有发现重复文案');
                setTimeout(() => setGlobalProgress(''), 3000);
                return;
            }

            // 6. 清除旧高亮，分配颜色
            const newRows = rows.map(row => row.map(cell => ({ ...cell, highlights: [], note: '' })));
            dupGroups.forEach((group, gi) => {
                const color = PRESET_COLORS[gi % PRESET_COLORS.length];
                group.forEach(rowIdx => {
                    const cell = newRows[rowIdx][col];
                    cell.highlights = [{ queryId: `auto_group_${gi}`, color, similarity: 100, queryText: `重复组${gi + 1}` }];
                    cell.note = `🔁 重复组 ${gi + 1}（共 ${group.length} 条）`;
                });
            });

            setTable(prev => ({ ...prev, rows: newRows }));
            const totalDups = dupGroups.reduce((a, g) => a + g.length, 0);
            setGlobalProgress(`✅ 发现 ${dupGroups.length} 组重复，共 ${totalDups} 条文案`);
            setTimeout(() => setGlobalProgress(''), 4000);
        }, 50);
    }, [table, searchCol, threshold]);

    // ===== 排序功能 =====
    const sortTable = useCallback((mode: 'color' | 'match') => {
        setTable(prev => {
            const sorted = [...prev.rows];
            if (mode === 'color') {
                // 按颜色分组排序：同颜色的排在一起，有高亮的在前
                sorted.sort((a, b) => {
                    const aColor = a.find(c => c.highlights.length > 0)?.highlights[0].color || '';
                    const bColor = b.find(c => c.highlights.length > 0)?.highlights[0].color || '';
                    if (aColor && !bColor) return -1;
                    if (!aColor && bColor) return 1;
                    if (aColor !== bColor) return aColor.localeCompare(bColor);
                    return 0;
                });
            } else {
                // 按匹配度排序：最高相似度降序
                sorted.sort((a, b) => {
                    const aMax = Math.max(0, ...a.flatMap(c => c.highlights.map(h => h.similarity)));
                    const bMax = Math.max(0, ...b.flatMap(c => c.highlights.map(h => h.similarity)));
                    return bMax - aMax;
                });
            }
            return { ...prev, rows: sorted };
        });
        setGlobalProgress(mode === 'color' ? '✅ 已按颜色分组排序' : '✅ 已按匹配度排序');
        setTimeout(() => setGlobalProgress(''), 2000);
    }, []);

    // ===== AI 智能搜索 =====
    const executeAiSearch = useCallback(async () => {
        if (!aiSearchQuery.trim()) return;
        if (!getAiInstance) {
            setAiSearchError('AI 搜索需要配置 API Key');
            return;
        }

        const { rows } = table;
        if (rows.length === 0) return;

        setAiSearching(true);
        setAiSearchError('');
        setAiSearchResults([]);
        setGlobalProgress('🤖 AI 正在分析表格数据...');

        try {
            const ai = getAiInstance();
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
                    model: 'gemini-2.5-flash',
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
    const escHtml = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

    const getContrastColor = (hex: string): string => {
        const r = parseInt(hex.slice(1, 3), 16);
        const g = parseInt(hex.slice(3, 5), 16);
        const b = parseInt(hex.slice(5, 7), 16);
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

                    <div style={{ display: 'flex', gap: '4px' }}>
                        {table.rows.length > 0 && (
                            <>
                                <button onClick={() => setShowPasteArea(!showPasteArea)}
                                    style={btnStyle('#27272a')} data-tip="重新导入表格数据">
                                    <Upload size={14} /> 重新粘贴
                                </button>
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
                                <button onClick={autoDedup} style={btnStyle('#5b21b6')} data-tip="自动比对所有行，将相似文案按颜色分组">
                                    <Search size={14} /> 自动查重
                                </button>
                                <button onClick={() => sortTable('color')} style={btnStyle('#374151')} data-tip="按高亮颜色分组排列，同色放一起">
                                    ↕ 按颜色排序
                                </button>
                                <button onClick={() => sortTable('match')} style={btnStyle('#374151')} data-tip="按匹配相似度从高到低排序">
                                    ↕ 按匹配排序
                                </button>
                                <span style={{ width: '1px', height: '20px', background: '#3f3f46' }} />
                                <button onClick={clearAllHighlights} style={btnStyle('#7f1d1d')} data-tip="清除所有搜索项的高亮标记，保留数据">
                                    <RotateCcw size={14} /> 清除高亮
                                </button>
                                <button onClick={() => {
                                    setQueries([{ id: uuidv4(), text: '', noteText: '', color: PRESET_COLORS[0], enabled: true, isSearching: false, resultCount: 0 }]);
                                    setTable({ headers: [], rows: [], noteColumnVisible: false });
                                    setShowPasteArea(true);
                                    setPasteInput('');
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

                {/* 粘贴区域 */}
                {showPasteArea && (
                    <div style={{ padding: '16px', borderBottom: '1px solid #27272a' }}>
                        <div style={{ marginBottom: '8px', fontSize: '13px', color: '#a1a1aa' }}>
                            从 Excel / Google Sheets 粘贴表格数据（Tab 分隔）：
                        </div>
                        <textarea
                            value={pasteInput}
                            onChange={e => setPasteInput(e.target.value)}
                            placeholder="在此粘贴表格数据…&#10;支持 Tab 分隔的多列数据&#10;第一行会被自动识别为表头"
                            style={{
                                width: '100%', minHeight: '120px', resize: 'vertical',
                                background: '#18181b', border: '1px solid #3f3f46',
                                borderRadius: '8px', padding: '12px', color: '#e4e4e7',
                                fontSize: '13px', fontFamily: 'monospace', outline: 'none',
                            }}
                            onPaste={e => {
                                e.preventDefault();
                                const text = e.clipboardData.getData('text/plain');
                                if (text) {
                                    setPasteInput(text);
                                }
                            }}
                        />
                        <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
                            <button onClick={handlePaste} style={{ ...btnStyle('#854d0e'), padding: '8px 20px' }}>
                                <Check size={14} /> 载入数据
                            </button>
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
                                    data-tip="模糊匹配：搜索与关键词语义相似的文案"
                                    style={{
                                        padding: '3px 10px', borderRadius: '4px', fontSize: '11px', fontWeight: 600,
                                        border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                                        background: searchMode === 'similar' ? 'rgba(139,92,246,0.2)' : 'transparent',
                                        color: searchMode === 'similar' ? '#c4b5fd' : '#71717a',
                                    }}
                                >
                                    相似
                                </button>
                            </div>
                            <button onClick={() => setShowSettings(!showSettings)} style={{ ...btnSmStyle, color: '#71717a' }} data-tip="搜索设置（相似度阈值、搜索列）">
                                <Settings2 size={13} />
                            </button>
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
                        </div>

                        {!searchQueriesCollapsed && (
                            <>
                                {/* 设置面板 */}
                                {showSettings && (
                                    <div style={{
                                        padding: '10px 12px', background: '#18181b', borderRadius: '8px',
                                        border: '1px solid #3f3f46', marginBottom: '10px',
                                        display: 'flex', gap: '16px', alignItems: 'center', flexWrap: 'wrap',
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '12px' }}>
                                            <span style={{ color: '#a1a1aa' }}>相似度阈值:</span>
                                            <input
                                                type="range" min={0.2} max={0.8} step={0.05} value={threshold}
                                                onChange={e => setThreshold(Number(e.target.value))}
                                                style={{ width: '100px' }}
                                            />
                                            <span style={{ color: '#fbbf24', fontWeight: 600 }}>{Math.round(threshold * 100)}%</span>
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
                                    </div>
                                )}

                                {/* 搜索项列表 */}
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '6px' }}>
                                    {queries.map((q, idx) => (
                                        <div key={q.id} style={{
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

                                                    if (bulkQueries.length <= 1) return; // 单个值，正常粘贴

                                                    e.preventDefault();
                                                    const usedColors = new Set(queries.map(qq => qq.color));
                                                    let colorIdx = queries.length;
                                                    const newQueries = bulkQueries.map(item => {
                                                        let nextColor = PRESET_COLORS[colorIdx % PRESET_COLORS.length];
                                                        while (usedColors.has(nextColor) && colorIdx < queries.length + PRESET_COLORS.length) {
                                                            colorIdx++;
                                                            nextColor = PRESET_COLORS[colorIdx % PRESET_COLORS.length];
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
                                            {/* 单独相似度阈值 */}
                                            {searchMode === 'similar' && (
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
                                                onClick={() => q.useAi ? executeAiQuerySearch(q) : executeSearch(q)}
                                                disabled={!q.text.trim() || q.isSearching}
                                                style={{ ...btnSmStyle, color: q.isSearching ? '#71717a' : (q.useAi ? '#a78bfa' : '#fbbf24') }}
                                                data-tip={q.useAi ? 'AI 智能搜索' : '搜索'}
                                            >
                                                {q.isSearching ? <Loader2 size={14} className="animate-spin" /> : (q.useAi ? <Bot size={14} /> : <Search size={14} />)}
                                            </button>
                                            {q.resultCount > 0 && (
                                                <>
                                                    <span
                                                        onClick={() => {
                                                            const firstMatch = table.rows.findIndex(row =>
                                                                row.some(cell => cell.highlights.some(h => h.queryId === q.id))
                                                            );
                                                            if (firstMatch >= 0) {
                                                                const navIdx = matchedRowIndices.indexOf(firstMatch);
                                                                if (navIdx >= 0) setFocusedMatchIdx(navIdx);
                                                                const el = tableContainerRef.current?.querySelector(`[data-row-idx="${firstMatch}"]`);
                                                                el?.scrollIntoView({ behavior: 'smooth', block: 'center' });
                                                                if (el instanceof HTMLElement) {
                                                                    el.style.outline = `2px solid ${q.color}`;
                                                                    setTimeout(() => { el.style.outline = ''; }, 1500);
                                                                }
                                                            }
                                                        }}
                                                        style={{
                                                            fontSize: '11px', padding: '2px 8px', borderRadius: '10px',
                                                            background: `${q.color}22`, color: q.color, fontWeight: 600,
                                                            cursor: 'pointer',
                                                        }}
                                                        data-tip="点击定位到第一条匹配"
                                                    >
                                                        {q.resultCount}
                                                    </span>
                                                    <button
                                                        onClick={() => copyQueryResults(q.id)}
                                                        style={{ ...btnSmStyle, color: q.color }}
                                                        data-tip={`复制该搜索项的 ${q.resultCount} 条匹配结果`}
                                                    >
                                                        <Copy size={13} />
                                                    </button>
                                                </>
                                            )}
                                            {queries.length > 1 && (
                                                <button onClick={() => removeQuery(q.id)} style={{ ...btnSmStyle, color: '#ef4444' }} data-tip="删除">
                                                    <Trash2 size={13} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            </>
                        )}
                    </div>
                )}

                {/* AI 智能搜索区域 */}
                {table.rows.length > 0 && (
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
                                            tsv += row.map(c => c.value).join('\t');
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
                                {table.rows.map((row, ri) => {
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
                                })}
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
