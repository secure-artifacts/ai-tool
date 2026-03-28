/**
 * SuperRewriteView.tsx
 * 超级文案改写 - 三指令并行 + 智能配对
 * 
 * 功能:
 * 1. 三条独立指令（标题/正文/结尾）基于原始文案并行生成
 * 2. 正文改写可选（开关控制），关闭时直接用原文
 * 3. 标题/结尾支持不固定数量和类型（[类型标签] 内容 格式）
 * 4. AI智能配对 / 顺序配对 / 全组合 三种配对模式
 * 5. 四列输出：标题 | 正文 | 结尾 | 完整文案
 * 6. 指令预设管理、历史记录持久化
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import {
    Play,
    Loader2,
    Copy,
    Check,
    Trash2,
    ChevronDown,
    ChevronUp,
    Sparkles,
    RotateCw,
    X,
    Clock,
    Settings2,
    RotateCcw,
    FileText,
    Type,
    AlignLeft,
    MessageSquareQuote,
    Columns,
    Shuffle,
    ArrowDownUp,
    Grid3X3,
    Zap,
    ToggleLeft,
    ToggleRight,
    List
} from 'lucide-react';

// --- Types ---

interface TitleItem {
    type: string;     // 类型标签：悬念/数字/反问/痛点...
    content: string;  // 标题文本
}

interface EndingItem {
    type: string;     // 类型标签：互动/情感/祝福...
    content: string;  // 结尾文本
}

interface RewriteGroup {
    titleIndex: number;
    endingIndex: number;
    title: string;
    titleType: string;
    body: string;
    ending: string;
    endingType: string;
    fullText: string;
}

interface SuperRewriteResult {
    id: string;
    originalText: string;

    bodyContent: string;
    bodyStatus: 'idle' | 'processing' | 'success' | 'error' | 'skipped';
    bodyError?: string;

    titles: TitleItem[];
    titlesStatus: 'idle' | 'processing' | 'success' | 'error';
    titlesError?: string;

    endings: EndingItem[];
    endingsStatus: 'idle' | 'processing' | 'success' | 'error';
    endingsError?: string;

    groups: RewriteGroup[];
    groupsStatus: 'idle' | 'processing' | 'success' | 'error';
    groupsError?: string;

    rawOutputs: {
        extractBody?: string;
        body: string;
        titles: string;
        endings: string;
        groups?: string;
    };
    rawPrompts?: {
        extractBody?: string;
        body: string;
        titles: string;
        endings: string;
        groups?: string;
    };
    viewMode?: 'rendered' | 'prompts' | 'outputs';
    createdAt: number;
    collapsed?: boolean;
}

type PairMode = 'ai' | 'sequential' | 'cartesian';

interface SuperRewriteViewProps {
    getAiInstance: () => GoogleGenAI;
    textModel: string;
}

// --- Default Instructions ---

const DEFAULT_TITLE_INSTRUCTION = `你是一名短视频标题专家。请根据以下原始文案生成标题。

## 输出要求
- 悬念型标题：5个
- 数字型标题：3个
- 反问型标题：3个
- 痛点型标题：3个

## 输出格式（严格遵守）
每个标题独占一行，格式如下：
[类型标签] 标题内容

示例：
[悬念] 这个秘密，99%的人不知道
[数字] 3个改变人生的习惯
[反问] 你真的以为努力就够了吗？
[痛点] 焦虑到失眠？试试这个方法

不要输出任何其他内容，只输出标题列表。

## 原始文案
{{ORIGINAL_TEXT}}`;

const DEFAULT_BODY_INSTRUCTION = `你是一名专业短视频文案改写人。请改写以下原始文案。

## 改写规则
- 口语化、适合短视频口播
- 150-300字
- 保留核心信息，重新组织表达
- 语气温暖、有力

## 输出格式（严格遵守）
直接输出改写后的正文，不要包含标题、结尾、序号或任何标记。

## 原始文案
{{ORIGINAL_TEXT}}`;

const DEFAULT_ENDING_INSTRUCTION = `你是一名短视频结尾文案专家。请根据以下原始文案生成结尾。

## 输出要求
- 互动型结尾：3个
- 情感共鸣结尾：3个

## 输出格式（严格遵守）
每个结尾独占一行，格式如下：
[类型标签] 结尾内容

示例：
[互动] 如果你也有同感，请留下"阿们"。
[情感] 无论多难，你不是一个人在走。

不要输出任何其他内容，只输出结尾列表。

## 原始文案
{{ORIGINAL_TEXT}}`;

// --- Storage Keys ---
const STORAGE_KEY = 'super_rewrite_state_v1';
const TITLE_INSTRUCTION_KEY = 'super_rewrite_title_instruction_v1';
const BODY_INSTRUCTION_KEY = 'super_rewrite_body_instruction_v1';
const ENDING_INSTRUCTION_KEY = 'super_rewrite_ending_instruction_v1';
const SETTINGS_KEY = 'super_rewrite_settings_v1';

// --- Parsers ---

/** 解析 [类型标签] 内容 格式 */
function parseTaggedItems(raw: string): { type: string; content: string }[] {
    const items: { type: string; content: string }[] = [];
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
        // Primary: [Tag] Content
        const tagMatch = line.match(/^\[(.+?)\]\s*(.+)$/);
        if (tagMatch) {
            items.push({ type: tagMatch[1].trim(), content: tagMatch[2].trim() });
            continue;
        }
        // Fallback: "1. Content" or "- Content"
        const numMatch = line.match(/^\d+[\.\)]\s*(.+)$/);
        if (numMatch) {
            items.push({ type: '通用', content: numMatch[1].trim() });
            continue;
        }
        const dashMatch = line.match(/^[-•]\s*(.+)$/);
        if (dashMatch) {
            items.push({ type: '通用', content: dashMatch[1].trim() });
            continue;
        }
        // Last resort: non-empty lines that look like content
        if (line.length > 3 && !line.startsWith('#') && !line.startsWith('示例') && !line.startsWith('输出')) {
            items.push({ type: '通用', content: line });
        }
    }
    return items;
}

/** 解析配对输出 (序号,序号 格式) */
function parsePairings(raw: string, titleCount: number, endingCount: number): { titleIdx: number; endingIdx: number }[] {
    const pairs: { titleIdx: number; endingIdx: number }[] = [];
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
        const match = line.match(/(\d+)\s*[,，]\s*(\d+)/);
        if (match) {
            const tIdx = parseInt(match[1]) - 1; // 1-based → 0-based
            const eIdx = parseInt(match[2]) - 1;
            if (tIdx >= 0 && tIdx < titleCount && eIdx >= 0 && eIdx < endingCount) {
                pairs.push({ titleIdx: tIdx, endingIdx: eIdx });
            }
        }
    }
    return pairs;
}

/** Apply placeholder replacement */
function applyPlaceholders(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replaceAll(`{{${key}}}`, value);
    }
    return result;
}

const DebugPanel = ({ title, content }: { title: string; content?: string }) => {
    if (!content) return null;
    return (
        <div className="space-y-1.5">
            <h4 className="text-[11px] font-medium text-zinc-400">{title}</h4>
            <pre className="text-[10px] text-zinc-300 bg-zinc-900/80 p-3 rounded-lg border border-zinc-800/50 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto w-full">
                {content}
            </pre>
        </div>
    );
};

// --- Component ---
export function SuperRewriteView({ getAiInstance, textModel }: SuperRewriteViewProps) {
    // --- State ---
    const [inputText, setInputText] = useState('');
    const [pendingInputs, setPendingInputs] = useState<string[]>([]);
    const [results, setResults] = useState<SuperRewriteResult[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) return JSON.parse(saved).results || [];
        } catch { /* ignore */ }
        return [];
    });
    const [isProcessing, setIsProcessing] = useState(false);
    const [batchProgress, setBatchProgress] = useState<{ current: number, total: number } | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [copiedBatchType, setCopiedBatchType] = useState<string | null>(null);

    // Instructions
    const [titleInstruction, setTitleInstruction] = useState(() => {
        try { const s = localStorage.getItem(TITLE_INSTRUCTION_KEY); if (s) return s; } catch { }
        return DEFAULT_TITLE_INSTRUCTION;
    });
    const [bodyInstruction, setBodyInstruction] = useState(() => {
        try { const s = localStorage.getItem(BODY_INSTRUCTION_KEY); if (s) return s; } catch { }
        return DEFAULT_BODY_INSTRUCTION;
    });
    const [endingInstruction, setEndingInstruction] = useState(() => {
        try { const s = localStorage.getItem(ENDING_INSTRUCTION_KEY); if (s) return s; } catch { }
        return DEFAULT_ENDING_INSTRUCTION;
    });

    // Settings
    const [enableBodyRewrite, setEnableBodyRewrite] = useState(() => {
        try { const s = localStorage.getItem(SETTINGS_KEY); if (s) { return JSON.parse(s).enableBodyRewrite ?? true; } } catch { }
        return true;
    });
    const [pairMode, setPairMode] = useState<PairMode>(() => {
        try { const s = localStorage.getItem(SETTINGS_KEY); if (s) { return JSON.parse(s).pairMode || 'ai'; } } catch { }
        return 'ai';
    });

    // UI state
    const [showTitleInstruction, setShowTitleInstruction] = useState(false);
    const [showBodyInstruction, setShowBodyInstruction] = useState(false);
    const [showEndingInstruction, setShowEndingInstruction] = useState(false);

    const stopRef = useRef(false);

    // Persist
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                results: results.map(r => ({
                    ...r,
                    originalText: r.originalText.slice(0, 5000)
                }))
            }));
        } catch { }
    }, [results]);

    useEffect(() => {
        try { localStorage.setItem(TITLE_INSTRUCTION_KEY, titleInstruction); } catch { }
    }, [titleInstruction]);
    useEffect(() => {
        try { localStorage.setItem(BODY_INSTRUCTION_KEY, bodyInstruction); } catch { }
    }, [bodyInstruction]);
    useEffect(() => {
        try { localStorage.setItem(ENDING_INSTRUCTION_KEY, endingInstruction); } catch { }
    }, [endingInstruction]);
    useEffect(() => {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enableBodyRewrite, pairMode }));
        } catch { }
    }, [enableBodyRewrite, pairMode]);

    // --- API call with retry ---
    const callAI = async (ai: GoogleGenAI, prompt: string, systemPrompt?: string): Promise<string> => {
        let result: any;
        for (let attempt = 0; attempt <= 3; attempt++) {
            try {
                result = await ai.models.generateContent({
                    model: textModel || 'gemini-2.5-flash',
                    contents: prompt,
                    config: {
                        temperature: 0.85,
                        topP: 0.95,
                        maxOutputTokens: 8192,
                        ...(systemPrompt ? { systemInstruction: systemPrompt } : {})
                    }
                });
                break;
            } catch (err: any) {
                const errMsg = err?.message || '';
                const is429 = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota');
                if (is429 && attempt < 3) {
                    const waitSec = Math.pow(2, attempt + 1) * 2.5;
                    await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
                    continue;
                }
                throw err;
            }
        }
        return result?.text?.trim() || '';
    };

    // --- Google Sheets 粘贴处理 (批量输入 - 高保真解析) ---
    const parseHtmlTable = (html: string): string[] => {
        const results: string[] = [];
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const rows = doc.querySelectorAll('tr');

            // 获取单元格文本，保留 <br> 为换行符
            const getCellText = (cell: Element): string => {
                const clone = cell.cloneNode(true) as Element;
                // Google Sheets 的 <br> 代表单元格内换行
                clone.querySelectorAll('br').forEach(br => {
                    br.replaceWith('\n');
                });
                // 处理 <p> 标签（某些 Sheets 版本用 <p> 包裹段落）
                clone.querySelectorAll('p').forEach(p => {
                    if (p.nextSibling) {
                        p.after('\n');
                    }
                });
                return (clone.textContent || '').trim();
            };

            if (rows.length === 0) {
                // 没有 tr 标签，尝试直接查找 td
                const cells = doc.querySelectorAll('td');
                if (cells.length > 0) {
                    const cellText = getCellText(cells[0]);
                    if (cellText) results.push(cellText);
                }
                return results;
            }

            rows.forEach(row => {
                const cells = row.querySelectorAll('td, th');
                if (cells.length === 0) return;

                // 取第一列作为文案内容
                const text = getCellText(cells[0]);
                if (text) results.push(text);
            });
        } catch (e) {
            console.error('[SuperRewrite] parseHtmlTable error:', e);
        }
        return results;
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        const htmlData = clipboardData.getData('text/html');

        if (htmlData && (htmlData.includes('<table') || htmlData.includes('<tr'))) {
            e.preventDefault();
            const parsed = parseHtmlTable(htmlData);
            if (parsed.length > 0) {
                setPendingInputs(parsed);
                setInputText(`已从表格粘贴 ${parsed.length} 条文案`);
                return;
            }
        }
        // 非表格粘贴，清除 pending 状态
        setPendingInputs([]);
    };

    const handleRemovePendingItem = (index: number) => {
        setPendingInputs(prev => {
            const next = prev.filter((_, i) => i !== index);
            if (next.length === 0) {
                setInputText('');
            } else {
                setInputText(`已从表格粘贴 ${next.length} 条文案`);
            }
            return next;
        });
    };

    const handleClearPendingInputs = () => {
        setPendingInputs([]);
        setInputText('');
    };

    // --- Generate handler ---
    const handleGenerate = useCallback(async () => {
        if ((!inputText.trim() && pendingInputs.length === 0) || isProcessing) return;

        stopRef.current = false;
        setIsProcessing(true);

        let items: string[];
        if (pendingInputs.length > 0) {
            items = pendingInputs;
        } else {
            // 支持批量：按至少三个换行或 \n---\n 分割
            const texts = inputText.trim().split(/\n{3,}|\n---\n/).map(s => s.trim()).filter(Boolean);
            items = texts.length > 0 ? texts : [inputText.trim()];
        }

        try {
            const ai = getAiInstance();
            setBatchProgress({ current: 0, total: items.length });

            for (let i = 0; i < items.length; i++) {
                const rawText = items[i];
                if (stopRef.current) break;

                setBatchProgress({ current: i + 1, total: items.length });

                const originalText = rawText.trim();
                
                const newResult: SuperRewriteResult = {
                    id: uuidv4(),
                    originalText,
                    bodyContent: '',
                    bodyStatus: enableBodyRewrite ? 'processing' : 'skipped',
                    titles: [],
                    titlesStatus: 'processing',
                    endings: [],
                    endingsStatus: 'processing',
                    groups: [],
                    groupsStatus: 'idle',
                    rawOutputs: { body: '', titles: '', endings: '', groups: '' },
                    rawPrompts: { body: '', titles: '', endings: '', groups: '' },
                    viewMode: 'rendered',
                    createdAt: Date.now(),
                };

                setResults(prev => [newResult, ...prev]);

                try {
                    // --- 合并为单次 API 调用（JSON返回） ---
                    const systemPrompt = `你是一名专业的短视频文案大师。
任务：请根据用户提供的原文，分别结合【标题指令】、【结尾指令】${enableBodyRewrite ? '以及【正文指令】' : ''}进行协同创作！

注意事项：
1. 仔细阅读【原始文案】
2. 执行【标题指令】，提炼或生成出所有满足要求的标题（需包含对应的分类标签）
${enableBodyRewrite ? '3. 执行【正文指令】，对原始文案的主体部分进行改写（不包含标题和结尾）' : '3. 【正文智能提取】：请仔细分析原始文案结构，智能识别并提取出"纯正文主体"部分。你需要去除以下内容：\n   - 开头的标题行（通常是第一行或前几行的简短句子，具有标题特征如吸引注意力、悬念、号召停留等）\n   - 结尾的互动语/号召语（如"写下阿们""分享给你爱的人""请留言""点赞转发"等引导互动的句子）\n   - 结尾的祝福/收尾短句（如"愿主保佑你""阿们"等结束性语句）\n   注意：只去除明显的标题和结尾互动语，正文中间的祷告内容、叙述内容要完整保留，不要删改任何正文段落。\n   ⚠️ 语言一致性要求：提取后的正文必须与你生成的标题和结尾使用相同的语言！请根据【标题指令】和【结尾指令】中要求的输出语言，将正文也翻译为对应语言。翻译时保留原文的语义、语气和段落结构，只改变语言，不改变内容'}
4. 执行【结尾指令】，生成出所有满足要求的结尾文案（需包含对应的分类标签）

【输出格式：强制 JSON】
为了便于前后端系统解析，无论用户在其自定义的局部指令中要求了何种纯文本格式或排版，最终你都必须将结果统一归纳为以下结构的 JSON 字符串进行返回。必须保证 JSON 格式合法。
不要输出任何分析过程，不要输出 \`\`\`json 标记。

{
  "titles": [
    { "type": "类型名称（如：悬念、反问等，不带中括号）", "content": "标题文本内容" }
  ],
  "body": "${enableBodyRewrite ? '这里填入改写后的完整正文内容，注意保留段落换行和语气' : '这里填入从原文中提取的纯正文主体（去除标题和结尾互动语后的内容），并翻译为与标题和结尾相同的语言。必须保留原文的段落换行和完整表达'}",
  "endings": [
    { "type": "类型名称（如：互动、转化等，不带中括号）", "content": "结尾文本内容" }
  ]
}`;

                    const userPrompt = `【标题指令】
${titleInstruction}

${enableBodyRewrite ? '【正文指令】\n' + bodyInstruction + '\n\n' : ''}【结尾指令】
${endingInstruction}

【原始文案】
${originalText}`;

                    setResults(prev => prev.map(r => r.id === newResult.id ? {
                        ...r,
                        rawPrompts: { extractBody: '', body: '', titles: userPrompt, endings: systemPrompt, groups: '' }
                    } : r));

                    let parsedTitles: TitleItem[] = [];
                    let parsedEndings: EndingItem[] = [];
                    let bodyContent = originalText;
                    let titleOk = false;
                    let endingOk = false;
                    let bodyOk = false;
                    
                    let rawOutput = '';

                    try {
                        rawOutput = await callAI(ai, userPrompt, systemPrompt);
                        
                        if (stopRef.current) {
                            setResults(prev => prev.map(r =>
                                r.id === newResult.id ? { ...r, titlesStatus: 'error', endingsStatus: 'error', bodyStatus: 'error', titlesError: '已取消', endingsError: '已取消', bodyError: '已取消' } : r
                            ));
                            break;
                        }

                        let cleanedOutput = rawOutput.trim();
                        if (cleanedOutput.startsWith('```json')) cleanedOutput = cleanedOutput.slice(7);
                        if (cleanedOutput.startsWith('```')) cleanedOutput = cleanedOutput.slice(3);
                        if (cleanedOutput.endsWith('```')) cleanedOutput = cleanedOutput.slice(0, -3);
                        cleanedOutput = cleanedOutput.trim();

                        const parsedObj = JSON.parse(cleanedOutput);
                        
                        if (parsedObj.titles && Array.isArray(parsedObj.titles)) {
                            parsedTitles = parsedObj.titles;
                            titleOk = parsedTitles.length > 0;
                        }
                        if (parsedObj.endings && Array.isArray(parsedObj.endings)) {
                            parsedEndings = parsedObj.endings;
                            endingOk = parsedEndings.length > 0;
                        }
                        if (parsedObj.body && typeof parsedObj.body === 'string' && parsedObj.body.trim().length > 0) {
                            bodyContent = parsedObj.body;
                            bodyOk = true;
                        } else if (!enableBodyRewrite) {
                            // Fallback: if AI didn't return extracted body, use original
                            bodyContent = originalText;
                            bodyOk = true;
                            console.warn('[SuperRewrite] AI未返回提取的正文，回退使用原文');
                        }
                        
                        // Fail fallback if user prompts somehow caused the AI to abandon the JSON constraint
                        if (!titleOk || !endingOk) {
                             throw new Error('AI未能按JSON格式或未能返回足够的标题和结尾');
                        }

                    } catch (generationError: any) {
                        console.error('[SuperRewrite] Unified Generation Error:', generationError);
                        titleOk = false;
                        endingOk = false;
                        if (!enableBodyRewrite) {
                            bodyContent = originalText;
                            bodyOk = true;
                        } else {
                            bodyOk = false;
                        }
                    }

                    // Update intermediate state
                    setResults(prev => prev.map(r =>
                        r.id === newResult.id ? {
                            ...r,
                            titles: parsedTitles,
                            titlesStatus: titleOk ? 'success' : 'error',
                            titlesError: titleOk ? undefined : '未解析到标题/格式错误',
                            endings: parsedEndings,
                            endingsStatus: endingOk ? 'success' : 'error',
                            endingsError: endingOk ? undefined : '未解析到结尾/格式错误',
                            bodyContent,
                            bodyStatus: bodyOk ? (enableBodyRewrite ? 'success' : 'skipped') : 'error',
                            bodyError: bodyOk ? undefined : 'JSON中未包含正文或失败',
                            rawOutputs: { ...r.rawOutputs, body: '', titles: rawOutput, endings: '' },
                            groupsStatus: (titleOk && endingOk) ? 'processing' : 'error',
                        } : r
                    ));

            // --- 配对阶段 ---
            if (titleOk && endingOk) {
                let groups: RewriteGroup[] = [];

                if (pairMode === 'sequential') {
                    // 顺序配对：1→1, 2→2, 循环较少的一方
                    const maxLen = Math.max(parsedTitles.length, parsedEndings.length);
                    for (let i = 0; i < maxLen; i++) {
                        const tIdx = i % parsedTitles.length;
                        const eIdx = i % parsedEndings.length;
                        const title = parsedTitles[tIdx];
                        const ending = parsedEndings[eIdx];
                        groups.push({
                            titleIndex: tIdx,
                            endingIndex: eIdx,
                            title: title.content,
                            titleType: title.type,
                            body: bodyContent,
                            ending: ending.content,
                            endingType: ending.type,
                            fullText: `${title.content}\n${bodyContent}\n${ending.content}`,
                        });
                    }
                } else if (pairMode === 'cartesian') {
                    // 全组合
                    for (let t = 0; t < parsedTitles.length; t++) {
                        for (let e = 0; e < parsedEndings.length; e++) {
                            groups.push({
                                titleIndex: t,
                                endingIndex: e,
                                title: parsedTitles[t].content,
                                titleType: parsedTitles[t].type,
                                body: bodyContent,
                                ending: parsedEndings[e].content,
                                endingType: parsedEndings[e].type,
                                fullText: `${parsedTitles[t].content}\n${bodyContent}\n${parsedEndings[e].content}`,
                            });
                        }
                    }
                } else {
                    // AI 智能配对
                    try {
                        const titleList = parsedTitles.map((t, i) => `${i + 1}. [${t.type}] ${t.content}`).join('\n');
                        const endingList = parsedEndings.map((e, i) => `${i + 1}. [${e.type}] ${e.content}`).join('\n');

                        const pairPrompt = `你是一名文案编辑。请将以下标题和结尾进行最佳配对。

## 配对规则
1. 风格匹配：同类型标题和结尾优先配对
2. 语气一致：标题和结尾的情感强度要匹配
3. 主题呼应：标题引出的话题，结尾要有回应
4. 每个标题必须配一个结尾
5. 如果标题数 > 结尾数，结尾可以重复使用

## 标题列表
${titleList}

## 结尾列表
${endingList}

## 输出格式（严格遵守）
每组一行，格式：标题序号,结尾序号
只输出数字对，不要任何解释。`;

                        const pairRaw = await callAI(ai, pairPrompt);
                        
                        setResults(prev => prev.map(r => r.id === newResult.id ? {
                            ...r,
                            rawPrompts: r.rawPrompts ? { ...r.rawPrompts, groups: pairPrompt } : undefined,
                            rawOutputs: { ...r.rawOutputs, groups: pairRaw }
                        } : r));

                        const pairings = parsePairings(pairRaw, parsedTitles.length, parsedEndings.length);

                        if (pairings.length > 0) {
                            groups = pairings.map(p => ({
                                titleIndex: p.titleIdx,
                                endingIndex: p.endingIdx,
                                title: parsedTitles[p.titleIdx].content,
                                titleType: parsedTitles[p.titleIdx].type,
                                body: bodyContent,
                                ending: parsedEndings[p.endingIdx].content,
                                endingType: parsedEndings[p.endingIdx].type,
                                fullText: `${parsedTitles[p.titleIdx].content}\n${bodyContent}\n${parsedEndings[p.endingIdx].content}`,
                            }));
                        } else {
                            // Fallback to sequential
                            const maxLen = Math.max(parsedTitles.length, parsedEndings.length);
                            for (let i = 0; i < maxLen; i++) {
                                const tIdx = i % parsedTitles.length;
                                const eIdx = i % parsedEndings.length;
                                groups.push({
                                    titleIndex: tIdx,
                                    endingIndex: eIdx,
                                    title: parsedTitles[tIdx].content,
                                    titleType: parsedTitles[tIdx].type,
                                    body: bodyContent,
                                    ending: parsedEndings[eIdx].content,
                                    endingType: parsedEndings[eIdx].type,
                                    fullText: `${parsedTitles[tIdx].content}\n${bodyContent}\n${parsedEndings[eIdx].content}`,
                                });
                            }
                        }
                    } catch (pairErr: any) {
                        // Fallback to sequential on error
                        const maxLen = Math.max(parsedTitles.length, parsedEndings.length);
                        for (let i = 0; i < maxLen; i++) {
                            const tIdx = i % parsedTitles.length;
                            const eIdx = i % parsedEndings.length;
                            groups.push({
                                titleIndex: tIdx,
                                endingIndex: eIdx,
                                title: parsedTitles[tIdx].content,
                                titleType: parsedTitles[tIdx].type,
                                body: bodyContent,
                                ending: parsedEndings[eIdx].content,
                                endingType: parsedEndings[eIdx].type,
                                fullText: `${parsedTitles[tIdx].content}\n${bodyContent}\n${parsedEndings[eIdx].content}`,
                            });
                        }
                    }
                }

                setResults(prev => prev.map(r =>
                    r.id === newResult.id ? {
                        ...r,
                        groups,
                        groupsStatus: groups.length > 0 ? 'success' : 'error',
                    } : r
                ));
            }

                } catch (error: any) {
                    console.error('[SuperRewrite] Error:', error);
                    setResults(prev => prev.map(r =>
                        r.id === newResult.id ? {
                            ...r,
                            titlesStatus: r.titlesStatus === 'processing' ? 'error' : r.titlesStatus,
                            endingsStatus: r.endingsStatus === 'processing' ? 'error' : r.endingsStatus,
                            bodyStatus: r.bodyStatus === 'processing' ? 'error' : r.bodyStatus,
                            groupsStatus: 'error',
                            titlesError: error?.message,
                            endingsError: error?.message,
                            bodyError: error?.message,
                        } : r
                    ));
                } // End inner try
            } // End for loop
        } catch (globalError) {
            console.error('[SuperRewrite] Global Error:', globalError);
        } finally {
            setIsProcessing(false);
            setBatchProgress(null);
        }
    }, [inputText, pendingInputs, isProcessing, getAiInstance, textModel, titleInstruction, bodyInstruction, endingInstruction, enableBodyRewrite, pairMode]);

    // Status helper
    const getOverallStatus = (result: SuperRewriteResult) => {
        if (result.groupsStatus === 'success') return 'success';
        if ([result.titlesStatus, result.endingsStatus, result.bodyStatus, result.groupsStatus].some(s => s === 'processing')) return 'processing';
        if ([result.titlesStatus, result.endingsStatus].some(s => s === 'error')) return 'error';
        return 'idle';
    };

    const handleStop = () => { stopRef.current = true; };

    // --- 重试失败项 ---
    const handleRetryFailed = useCallback(() => {
        const failedItems = results.filter(r => getOverallStatus(r) === 'error');
        if (failedItems.length === 0 || isProcessing) return;
        const texts = failedItems.map(r => r.originalText);
        // 移除失败项
        setResults(prev => prev.filter(r => getOverallStatus(r) !== 'error'));
        // 设置为 pending 并触发生成
        setPendingInputs(texts);
        setInputText(`重试 ${texts.length} 条失败文案`);
    }, [results, isProcessing]);

    // --- 全部重做 ---
    const handleRedoAll = useCallback(() => {
        if (results.length === 0 || isProcessing) return;
        const texts = results.map(r => r.originalText);
        setResults([]);
        setPendingInputs(texts);
        setInputText(`重做全部 ${texts.length} 条文案`);
    }, [results, isProcessing]);

    const handleDelete = (id: string) => {
        setResults(prev => prev.filter(r => r.id !== id));
    };

    const handleRetrySingle = (id: string) => {
        const item = results.find(r => r.id === id);
        if (!item || isProcessing) return;
        setResults(prev => prev.filter(r => r.id !== id));
        setPendingInputs([item.originalText]);
        setInputText(`重试 1 条文案`);
    };

    const handleClearAll = () => { setResults([]); };

    const handleToggleCollapse = (id: string) => {
        setResults(prev => prev.map(r =>
            r.id === id ? { ...r, collapsed: !r.collapsed } : r
        ));
    };

    const handleSetViewMode = (id: string, mode: 'rendered' | 'prompts' | 'outputs') => {
        setResults(prev => prev.map(r =>
            r.id === id ? { ...r, viewMode: mode } : r
        ));
    };

    const handleCopy = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch { /* ignore */ }
    };

    // --- Batch copy ---
    // TSV 引号包裹：保留单元格内的换行，粘贴到 Google Sheets 时每个换行仍在同一个单元格内
    const quoteForTsv = (text: string): string => {
        if (!text) return '';
        // 标准 TSV/CSV 引号规则：内容含换行或引号时，用双引号包裹，内部引号转义为 ""
        const trimmed = text.trim();
        if (trimmed.includes('\n') || trimmed.includes('\t') || trimmed.includes('"')) {
            return `"${trimmed.replace(/"/g, '""')}"`;
        }
        return trimmed;
    };

    const handleBatchCopy = async (type: 'titles' | 'body' | 'endings' | 'tsv' | 'tsv_with_original') => {
        const successResults = results.filter(r => r.groupsStatus === 'success' && r.groups.length > 0);
        if (successResults.length === 0) return;

        let text = '';

        switch (type) {
            case 'titles':
                text = successResults.flatMap(r => r.titles.map(t => `[${t.type}] ${t.content}`)).join('\n');
                break;
            case 'body':
                text = successResults.map(r => r.bodyContent).join('\n\n---\n\n');
                break;
            case 'endings':
                text = successResults.flatMap(r => r.endings.map(e => `[${e.type}] ${e.content}`)).join('\n');
                break;
            case 'tsv':
                text = successResults.flatMap(r => r.groups.map(g =>
                    `${quoteForTsv(g.title)}\t${quoteForTsv(g.body)}\t${quoteForTsv(g.ending)}\t${quoteForTsv(g.fullText)}`
                )).join('\n');
                break;
            case 'tsv_with_original':
                text = successResults.flatMap(r => r.groups.map(g =>
                    `${quoteForTsv(r.originalText)}\t${quoteForTsv(g.title)}\t${quoteForTsv(g.body)}\t${quoteForTsv(g.ending)}\t${quoteForTsv(g.fullText)}`
                )).join('\n');
                break;
        }

        try {
            await navigator.clipboard.writeText(text);
            setCopiedBatchType(type);
            setTimeout(() => setCopiedBatchType(null), 2000);
        } catch { }
    };



    const successResults = results.filter(r => r.groupsStatus === 'success');
    const totalGroups = successResults.reduce((sum, r) => sum + r.groups.length, 0);

    // --- Instruction panel component ---
    const InstructionPanel = ({
        title, icon, color, value, onChange, defaultValue,
        isOpen, onToggle
    }: {
        title: string;
        icon: React.ReactNode;
        color: string;
        value: string;
        onChange: (v: string) => void;
        defaultValue: string;
        isOpen: boolean;
        onToggle: () => void;
    }) => (
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/30 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <span className={color}>{icon}</span>
                    <span className="text-xs font-medium text-zinc-300">{title}</span>
                    {value !== defaultValue && (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-400">已修改</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    <span className="text-[10px] text-zinc-600">{value.length} 字符</span>
                    {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                </div>
            </button>
            {isOpen && (
                <div className="px-4 pb-4 space-y-2 border-t border-zinc-800/50">
                    <div className="flex items-center justify-between pt-2">
                        <span className="text-[10px] text-zinc-500">
                            使用 {'{{ORIGINAL_TEXT}}'} 占位符引用原始文案
                        </span>
                        <button
                            onClick={() => onChange(defaultValue)}
                            className="text-[10px] text-zinc-500 hover:text-amber-400 flex items-center gap-1 transition-colors"
                        >
                            <RotateCcw className="w-3 h-3" />
                            重置默认
                        </button>
                    </div>
                    <textarea
                        value={value}
                        onChange={e => onChange(e.target.value)}
                        rows={12}
                        className={`w-full bg-zinc-950/50 border border-zinc-700/50 rounded-lg px-3 py-2.5 text-xs text-zinc-300 placeholder:text-zinc-600 resize-y focus:outline-none focus:ring-1 focus:ring-${color.includes('amber') ? 'amber' : color.includes('emerald') ? 'emerald' : 'violet'}-500/30 font-mono leading-relaxed`}
                        style={{ minHeight: '180px' }}
                    />
                </div>
            )}
        </div>
    );

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto" style={{ scrollBehavior: 'smooth' }}>
                <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

                    {/* === 标题区 === */}
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <div className="bg-gradient-to-br from-orange-500/30 to-rose-500/30 p-2 rounded-xl">
                                    <Zap className="w-5 h-5 text-orange-400" />
                                </div>
                                超级文案改写
                            </h2>
                            <p className="text-xs text-zinc-500 mt-1">
                                三指令并行：标题 + 正文 + 结尾 → 智能配对 → 四列输出
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            {results.length > 0 && (
                                <button
                                    onClick={handleClearAll}
                                    className="text-xs text-zinc-500 hover:text-red-400 transition-colors flex items-center gap-1"
                                    title="清空所有历史"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    清空
                                </button>
                            )}
                        </div>
                    </div>

                    {/* === 三指令编辑区 === */}
                    <div className="space-y-2">
                        <InstructionPanel
                            title="标题指令"
                            icon={<Type className="w-4 h-4" />}
                            color="text-amber-400"
                            value={titleInstruction}
                            onChange={setTitleInstruction}
                            defaultValue={DEFAULT_TITLE_INSTRUCTION}
                            isOpen={showTitleInstruction}
                            onToggle={() => setShowTitleInstruction(!showTitleInstruction)}
                        />

                        {/* 正文指令 - 带开关 */}
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden">
                            <div className="flex items-center justify-between px-4 py-2.5">
                                <button
                                    onClick={() => setShowBodyInstruction(!showBodyInstruction)}
                                    className="flex items-center gap-2 hover:opacity-80 transition-opacity flex-1"
                                >
                                    <AlignLeft className="w-4 h-4 text-emerald-400" />
                                    <span className="text-xs font-medium text-zinc-300">正文指令</span>
                                    {!enableBodyRewrite && (
                                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-zinc-700 text-zinc-400">已跳过·用原文</span>
                                    )}
                                    {enableBodyRewrite && bodyInstruction !== DEFAULT_BODY_INSTRUCTION && (
                                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-400">已修改</span>
                                    )}
                                </button>
                                <div className="flex items-center gap-3">
                                    <div className="flex items-center gap-1.5">
                                        <span className="text-[10px] text-zinc-500">改写正文</span>
                                        <button
                                            onClick={() => setEnableBodyRewrite(!enableBodyRewrite)}
                                            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enableBodyRewrite ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                                        >
                                            <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${enableBodyRewrite ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                                        </button>
                                    </div>
                                    {showBodyInstruction
                                        ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500 cursor-pointer" onClick={() => setShowBodyInstruction(false)} />
                                        : <ChevronDown className="w-3.5 h-3.5 text-zinc-500 cursor-pointer" onClick={() => setShowBodyInstruction(true)} />
                                    }
                                </div>
                            </div>
                            {showBodyInstruction && enableBodyRewrite && (
                                <div className="px-4 pb-4 space-y-2 border-t border-zinc-800/50">
                                    <div className="flex items-center justify-between pt-2">
                                        <span className="text-[10px] text-zinc-500">
                                            使用 {'{{ORIGINAL_TEXT}}'} 占位符引用原始文案
                                        </span>
                                        <button
                                            onClick={() => setBodyInstruction(DEFAULT_BODY_INSTRUCTION)}
                                            className="text-[10px] text-zinc-500 hover:text-amber-400 flex items-center gap-1 transition-colors"
                                        >
                                            <RotateCcw className="w-3 h-3" />
                                            重置默认
                                        </button>
                                    </div>
                                    <textarea
                                        value={bodyInstruction}
                                        onChange={e => setBodyInstruction(e.target.value)}
                                        rows={10}
                                        className="w-full bg-zinc-950/50 border border-zinc-700/50 rounded-lg px-3 py-2.5 text-xs text-zinc-300 placeholder:text-zinc-600 resize-y focus:outline-none focus:ring-1 focus:ring-emerald-500/30 font-mono leading-relaxed"
                                        style={{ minHeight: '150px' }}
                                    />
                                </div>
                            )}
                        </div>

                        <InstructionPanel
                            title="结尾指令"
                            icon={<MessageSquareQuote className="w-4 h-4" />}
                            color="text-violet-400"
                            value={endingInstruction}
                            onChange={setEndingInstruction}
                            defaultValue={DEFAULT_ENDING_INSTRUCTION}
                            isOpen={showEndingInstruction}
                            onToggle={() => setShowEndingInstruction(!showEndingInstruction)}
                        />
                    </div>

                    {/* === 配对模式 === */}
                    <div className="flex items-center gap-4 px-1">
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-500 font-medium">配对模式:</span>
                            <div className="flex bg-zinc-900 border border-zinc-700 rounded-lg p-0.5">
                                {[
                                    { value: 'sequential' as PairMode, label: '顺序配对', icon: <ArrowDownUp className="w-3 h-3" /> },
                                    { value: 'ai' as PairMode, label: 'AI智能', icon: <Sparkles className="w-3 h-3" /> },
                                    { value: 'cartesian' as PairMode, label: '全组合', icon: <Grid3X3 className="w-3 h-3" /> },
                                ].map(mode => (
                                    <button
                                        key={mode.value}
                                        onClick={() => setPairMode(mode.value)}
                                        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${pairMode === mode.value
                                            ? 'bg-orange-600 text-white'
                                            : 'text-zinc-400 hover:text-zinc-200'
                                            }`}
                                    >
                                        {mode.icon}
                                        {mode.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* === 输入区 === */}
                    <div className="space-y-3">
                        <div className="relative">
                            <textarea
                                value={inputText}
                                onChange={e => {
                                    setInputText(e.target.value);
                                    if (pendingInputs.length > 0) setPendingInputs([]);
                                }}
                                onPaste={handlePaste}
                                placeholder={pendingInputs.length > 0 ? '已解析表格数据，点击「开始改写」处理' : '支持多行批量，或直接从 Google Sheets 粘贴内容...'}
                                rows={pendingInputs.length > 0 ? 2 : 6}
                                className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 resize-y focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500/30 transition-all"
                                disabled={isProcessing || pendingInputs.length > 0}
                            />
                            <div className="absolute bottom-3 right-3 flex items-center gap-2">
                                {pendingInputs.length > 0 ? (
                                    <span className="text-[10px] text-orange-400 font-medium">
                                        📋 {pendingInputs.length} 条文案已就绪
                                    </span>
                                ) : (
                                    <span className="text-[10px] text-zinc-600">
                                        {inputText.length} 字
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* === 粘贴解析列表 === */}
                        {pendingInputs.length > 0 && (
                            <div className="bg-zinc-900/60 border border-orange-500/20 rounded-xl overflow-hidden">
                                <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/50">
                                    <div className="flex items-center gap-2">
                                        <List className="w-3.5 h-3.5 text-orange-400" />
                                        <span className="text-xs font-medium text-orange-400">已解析 {pendingInputs.length} 条文案</span>
                                    </div>
                                    <button
                                        onClick={handleClearPendingInputs}
                                        className="text-[10px] text-zinc-500 hover:text-red-400 flex items-center gap-1 transition-colors"
                                    >
                                        <X className="w-3 h-3" />
                                        清除
                                    </button>
                                </div>
                                <div className="max-h-60 overflow-y-auto custom-scrollbar divide-y divide-zinc-800/30">
                                    {pendingInputs.map((item, index) => (
                                        <div key={index} className="group flex items-start gap-3 px-4 py-2.5 hover:bg-zinc-800/20 transition-colors">
                                            <span className="shrink-0 text-[10px] text-zinc-600 font-mono mt-0.5 min-w-[24px] text-right">
                                                {index + 1}.
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed line-clamp-4">
                                                    {item}
                                                </p>
                                                {item.length > 200 && (
                                                    <span className="text-[9px] text-zinc-600 mt-0.5 inline-block">
                                                        {item.length} 字
                                                    </span>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => handleRemovePendingItem(index)}
                                                className="shrink-0 p-1 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                                                title="移除此条"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex items-center gap-2 flex-wrap">
                            {isProcessing ? (
                                <>
                                    <button
                                        onClick={handleStop}
                                        className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium text-sm transition-all"
                                    >
                                        <X className="w-4 h-4" />
                                        停止
                                    </button>
                                    {batchProgress && batchProgress.total > 1 && (
                                        <span className="text-[10px] text-amber-500/80 font-medium">
                                            {batchProgress.current}/{batchProgress.total}
                                        </span>
                                    )}
                                </>
                            ) : (
                                <button
                                    onClick={handleGenerate}
                                    disabled={!inputText.trim() && pendingInputs.length === 0}
                                    className={`flex items-center gap-2 px-5 py-2 rounded-xl font-medium text-sm transition-all ${(inputText.trim() || pendingInputs.length > 0)
                                        ? 'bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white shadow-lg shadow-orange-500/20'
                                        : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                        }`}
                                >
                                    <Sparkles className="w-4 h-4" />
                                    开始改写{pendingInputs.length > 0 ? ` (${pendingInputs.length})` : ''}
                                </button>
                            )}

                            {results.length > 0 && !isProcessing && (
                                <>
                                    <span className="text-zinc-700 mx-0.5">|</span>
                                    <button
                                        onClick={handleRedoAll}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
                                    >
                                        <RotateCw className="w-3 h-3" />
                                        重做 ({results.length})
                                    </button>
                                    {results.some(r => getOverallStatus(r) === 'error') && (
                                        <button
                                            onClick={handleRetryFailed}
                                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 transition-colors"
                                        >
                                            <RotateCw className="w-3 h-3" />
                                            重试失败 ({results.filter(r => getOverallStatus(r) === 'error').length})
                                        </button>
                                    )}
                                    <button
                                        onClick={handleClearAll}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] bg-zinc-800 hover:bg-red-900/30 text-zinc-500 hover:text-red-400 border border-zinc-700 transition-colors"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                        清除
                                    </button>
                                </>
                            )}

                            {totalGroups > 0 && !isProcessing && (
                                <>
                                    <span className="text-zinc-700 mx-0.5">|</span>
                                    <span className="text-[10px] text-zinc-500">复制:</span>
                                    {[
                                        { type: 'tsv' as const, label: `TSV (${totalGroups})` },
                                        { type: 'tsv_with_original' as const, label: '含原文' },
                                        { type: 'titles' as const, label: '标题' },
                                        { type: 'body' as const, label: '正文' },
                                        { type: 'endings' as const, label: '结尾' },
                                    ].map(btn => (
                                        <button
                                            key={btn.type}
                                            onClick={() => handleBatchCopy(btn.type)}
                                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
                                        >
                                            {copiedBatchType === btn.type ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                            {copiedBatchType === btn.type ? '已复制' : btn.label}
                                        </button>
                                    ))}
                                </>
                            )}
                        </div>
                    </div>

                    {/* === 结果列表 === */}
                    {results.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                                <Clock className="w-4 h-4 text-zinc-500" />
                                生成结果
                                <span className="text-xs text-zinc-500">({successResults.length})</span>
                            </h3>

                            {results.map(result => {
                                const status = getOverallStatus(result);
                                return (
                                    <div key={result.id} className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden transition-all">
                                        {/* Header */}
                                        <div
                                            className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-zinc-800/30 transition-colors"
                                            onClick={() => handleToggleCollapse(result.id)}
                                        >
                                            <div className={`shrink-0 p-1.5 rounded-lg ${status === 'processing' ? 'bg-orange-500/20'
                                                : status === 'success' ? 'bg-emerald-500/20'
                                                    : status === 'error' ? 'bg-red-500/20'
                                                        : 'bg-zinc-800'
                                                }`}>
                                                {status === 'processing' ? (
                                                    <Loader2 className="w-4 h-4 text-orange-400 animate-spin" />
                                                ) : status === 'success' ? (
                                                    <Check className="w-4 h-4 text-emerald-400" />
                                                ) : status === 'error' ? (
                                                    <X className="w-4 h-4 text-red-400" />
                                                ) : (
                                                    <FileText className="w-4 h-4 text-zinc-500" />
                                                )}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {/* Progress badges */}
                                                    <StatusBadge label="标题" status={result.titlesStatus} count={result.titles.length} />
                                                    <StatusBadge label="正文" status={result.bodyStatus} />
                                                    <StatusBadge label="结尾" status={result.endingsStatus} count={result.endings.length} />
                                                    <StatusBadge label="配对" status={result.groupsStatus} count={result.groups.length} />
                                                    <span className="text-[10px] text-zinc-600">
                                                        {new Date(result.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-zinc-500 truncate mt-0.5">
                                                    {result.originalText.slice(0, 100)}...
                                                </p>
                                            </div>

                                            <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                                <button
                                                    onClick={() => handleSetViewMode(result.id, result.viewMode === 'prompts' ? 'rendered' : 'prompts')}
                                                    className={`px-2 py-1 text-[10px] rounded border transition-colors ${result.viewMode === 'prompts' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'text-zinc-500 border-zinc-700/50 hover:text-zinc-300 hover:bg-zinc-800'}`}
                                                >
                                                    查看指令
                                                </button>
                                                <button
                                                    onClick={() => handleSetViewMode(result.id, result.viewMode === 'outputs' ? 'rendered' : 'outputs')}
                                                    className={`px-2 py-1 text-[10px] rounded border transition-colors ${result.viewMode === 'outputs' ? 'bg-orange-500/20 text-orange-400 border-orange-500/30' : 'text-zinc-500 border-zinc-700/50 hover:text-zinc-300 hover:bg-zinc-800'}`}
                                                >
                                                    查看返回
                                                </button>
                                                <div className="w-px h-3 bg-zinc-800 mx-1"></div>
                                                <button
                                                    onClick={() => handleRetrySingle(result.id)}
                                                    className="p-1.5 rounded-lg text-zinc-500 hover:text-orange-400 hover:bg-zinc-800 transition-colors"
                                                    title="重新生成"
                                                >
                                                    <RotateCw className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(result.id)}
                                                    className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                                                    title="删除"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Result Content */}
                                        {!result.collapsed && (
                                            <div className="border-t border-zinc-800/50 overflow-x-auto pb-4">
                                                {result.viewMode === 'prompts' && (
                                                    <div className="p-4 grid gap-4 grid-cols-1">
                                                        {result.rawPrompts?.extractBody ? (
                                                            <>
                                                                <DebugPanel title="正文提取指令" content={result.rawPrompts.extractBody} />
                                                                <DebugPanel title="标题生成指令" content={result.rawPrompts.titles} />
                                                                {result.rawPrompts.body && <DebugPanel title="正文改写指令" content={result.rawPrompts.body} />}
                                                                <DebugPanel title="结尾生成指令" content={result.rawPrompts.endings} />
                                                            </>
                                                        ) : (
                                                            <>
                                                                <DebugPanel title="用户指令 (User Prompt)" content={result.rawPrompts?.titles || ''} />
                                                                <DebugPanel title="系统指令 (System Prompt)" content={result.rawPrompts?.endings || ''} />
                                                            </>
                                                        )}
                                                        {result.rawPrompts?.groups && <DebugPanel title="智能配对指令" content={result.rawPrompts.groups} />}
                                                    </div>
                                                )}
                                                {result.viewMode === 'outputs' && (
                                                    <div className="p-4 grid gap-4 grid-cols-1">
                                                        {result.rawOutputs?.extractBody ? (
                                                            <>
                                                                <DebugPanel title="正文提取返回" content={result.rawOutputs.extractBody} />
                                                                <DebugPanel title="标题生成返回" content={result.rawOutputs.titles} />
                                                                {result.rawOutputs.body && <DebugPanel title="正文改写返回" content={result.rawOutputs.body} />}
                                                                <DebugPanel title="结尾生成返回" content={result.rawOutputs.endings} />
                                                            </>
                                                        ) : (
                                                            <DebugPanel title="核心生成返回 (JSON)" content={result.rawOutputs?.titles || ''} />
                                                        )}
                                                        {result.rawOutputs?.groups && <DebugPanel title="智能配对返回" content={result.rawOutputs.groups} />}
                                                    </div>
                                                )}
                                                {(!result.viewMode || result.viewMode === 'rendered') && result.groups.length > 0 && (
                                                <table className="w-full text-xs mt-2">
                                                    <thead>
                                                        <tr className="bg-zinc-800/50">
                                                            <th className="px-3 py-2 text-left text-zinc-400 font-medium w-8">#</th>
                                                            <th className="px-3 py-2 text-left text-zinc-400 font-medium">标题</th>
                                                            <th className="px-3 py-2 text-left text-zinc-400 font-medium">正文</th>
                                                            <th className="px-3 py-2 text-left text-zinc-400 font-medium">结尾</th>
                                                            <th className="px-3 py-2 text-left text-zinc-400 font-medium">完整文案</th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {result.groups.map((group, idx) => (
                                                            <tr key={idx} className="border-t border-zinc-800/30 hover:bg-zinc-800/20 transition-colors">
                                                                <td className="px-3 py-2.5 text-zinc-600 align-top">{idx + 1}</td>
                                                                <td className="px-3 py-2.5 align-top" style={{ minWidth: '180px', maxWidth: '250px' }}>
                                                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-medium mb-1 ${getTypeColor(group.titleType)}`}>
                                                                        {group.titleType}
                                                                    </span>
                                                                    <div className="text-zinc-200 whitespace-pre-wrap leading-relaxed">{group.title}</div>
                                                                    <CopyBtn text={group.title} id={`t-${result.id}-${idx}`} copiedId={copiedId} onCopy={handleCopy} />
                                                                </td>
                                                                <td className="px-3 py-2.5 align-top" style={{ minWidth: '200px', maxWidth: '300px' }}>
                                                                    <div className="text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto custom-scrollbar">
                                                                        {idx === 0 ? group.body : (
                                                                            <span className="text-zinc-600 italic">同上</span>
                                                                        )}
                                                                    </div>
                                                                    {idx === 0 && (
                                                                        <CopyBtn text={group.body} id={`b-${result.id}`} copiedId={copiedId} onCopy={handleCopy} />
                                                                    )}
                                                                </td>
                                                                <td className="px-3 py-2.5 align-top" style={{ minWidth: '180px', maxWidth: '250px' }}>
                                                                    <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-medium mb-1 ${getTypeColor(group.endingType)}`}>
                                                                        {group.endingType}
                                                                    </span>
                                                                    <div className="text-zinc-200 whitespace-pre-wrap leading-relaxed">{group.ending}</div>
                                                                    <CopyBtn text={group.ending} id={`e-${result.id}-${idx}`} copiedId={copiedId} onCopy={handleCopy} />
                                                                </td>
                                                                <td className="px-3 py-2.5 align-top" style={{ minWidth: '250px', maxWidth: '400px' }}>
                                                                    <div className="text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto custom-scrollbar text-[11px]">
                                                                        {group.fullText}
                                                                    </div>
                                                                    <CopyBtn text={group.fullText} id={`f-${result.id}-${idx}`} copiedId={copiedId} onCopy={handleCopy} />
                                                                </td>
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                                )}
                                            </div>
                                        )}

                                        {/* Error details */}
                                        {!result.collapsed && status === 'error' && (
                                            <div className="border-t border-zinc-800/50 px-4 py-3">
                                                {result.titlesError && <p className="text-xs text-red-400">标题: {result.titlesError}</p>}
                                                {result.bodyError && <p className="text-xs text-red-400">正文: {result.bodyError}</p>}
                                                {result.endingsError && <p className="text-xs text-red-400">结尾: {result.endingsError}</p>}
                                                {result.groupsError && <p className="text-xs text-red-400">配对: {result.groupsError}</p>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}

// --- Sub-components ---

function StatusBadge({ label, status, count }: { label: string; status: string; count?: number }) {
    const colors: Record<string, string> = {
        idle: 'bg-zinc-800 text-zinc-500 border-zinc-700',
        processing: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
        success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
        error: 'bg-red-500/15 text-red-400 border-red-500/20',
        skipped: 'bg-zinc-700/50 text-zinc-400 border-zinc-600',
    };
    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium border ${colors[status] || colors.idle}`}>
            {status === 'processing' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
            {status === 'success' && <Check className="w-2.5 h-2.5" />}
            {status === 'error' && <X className="w-2.5 h-2.5" />}
            {label}
            {count !== undefined && count > 0 && <span>({count})</span>}
            {status === 'skipped' && <span>跳过</span>}
        </span>
    );
}

function CopyBtn({ text, id, copiedId, onCopy }: { text: string; id: string; copiedId: string | null; onCopy: (text: string, id: string) => void }) {
    return (
        <button
            onClick={() => onCopy(text, id)}
            className="mt-1 flex items-center gap-1 text-[9px] text-zinc-600 hover:text-zinc-300 transition-colors"
        >
            {copiedId === id ? <Check className="w-2.5 h-2.5 text-emerald-400" /> : <Copy className="w-2.5 h-2.5" />}
            {copiedId === id ? '已复制' : '复制'}
        </button>
    );
}

function getTypeColor(type: string): string {
    const map: Record<string, string> = {
        '悬念': 'bg-amber-500/20 text-amber-300',
        '数字': 'bg-blue-500/20 text-blue-300',
        '反问': 'bg-purple-500/20 text-purple-300',
        '痛点': 'bg-red-500/20 text-red-300',
        '互动': 'bg-emerald-500/20 text-emerald-300',
        '情感': 'bg-rose-500/20 text-rose-300',
        '祝福': 'bg-sky-500/20 text-sky-300',
        '警示': 'bg-orange-500/20 text-orange-300',
        '共鸣': 'bg-pink-500/20 text-pink-300',
        '对比': 'bg-indigo-500/20 text-indigo-300',
    };
    return map[type] || 'bg-zinc-700/50 text-zinc-300';
}

export default SuperRewriteView;
