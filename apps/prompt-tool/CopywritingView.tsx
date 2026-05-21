/**
 * CopywritingView.tsx
 * 文案改写模式 - 批量改写外文文案并提供中文翻译
 * 
 * 功能:
 * 1. 支持单列（纯外文）或双列（外文+中文参照）输入
 * 2. 根据用户指令批量改写外文
 * 3. 输出双列布局：左外文右中文
 * 4. 支持预设保存到 Firebase
 * 5. 多种复制选项，无空行，直接粘贴到表格
 */

import React, { useState, useEffect, useRef, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase/index';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
    FileText,
    Play,
    Loader2,
    Copy,
    Check,
    Trash2,
    Download,
    Save,
    ChevronDown,
    ChevronUp,
    Plus,
    X,
    Settings2,
    Sparkles,
    MessageCircle,
    MessageSquare,
    RotateCw,
    ClipboardCopy,
    Eye,
    FolderOpen,
    Package,
    Mic,
    Tag,
    FileEdit,
    Search,
    Lightbulb,
    Scissors,
    Columns,
    Library,
    Share2,
    Repeat,
    Eraser,
    Gem,
    ShieldCheck
} from 'lucide-react';
import { PresetManager, CopywritingPreset as PresetType } from './PresetManager';
import {
    appendToSheet,
    getSheetsSyncConfig
} from '@/services/sheetsSyncService';
import { LIBRARY_PRESETS } from './libraryPresets';
import { useScriptureDeitySettings, ScriptureDeitySettingsPanel } from './components/ScriptureDeitySettings';
import { promptToolBatchExecute } from './services/promptToolCore';
import { autoWrapText } from '../script-split/utils/processor';
import { playCompletionSound } from '@/utils/soundNotification';

// --- Types ---

interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    images?: string[];
}

type VoiceMismatchPreview = {
    before: string;
    focus: string;
    after: string;
};

interface VoiceIntegrityIssue {
    stage: 'tagged' | 'segmented';
    mismatchIndex: number;
    originalComparable: string;
    candidateComparable: string;
    originalPreview: VoiceMismatchPreview;
    candidatePreview: VoiceMismatchPreview;
    originalRaw: string;
    candidateRaw: string;
}

// 单个指令的执行结果
interface InstructionResult {
    id: string;
    instruction: string;        // 使用的指令
    inputForeign: string;       // 输入的外文（可能是原文或上一步的结果）
    resultForeign: string;      // 改写后的外文
    resultChinese: string;      // 翻译后的中文
    resultExtraParts?: string[]; // 额外的 ||| 分隔部分（第3、4...列）
    scriptureNote?: string;      // 经文修改情况反馈
    status: 'idle' | 'processing' | 'success' | 'error';
    error?: string;
    voiceIntegrityIssue?: VoiceIntegrityIssue;
    createdAt: number;
    // 每指令独立对话
    chatOpen?: boolean;
    chatHistory?: ChatMessage[];
    chatInput?: string;
    chatLoading?: boolean;
}

// 拆分列定义
interface SplitColumn {
    id: string;
    name: string;        // 列名：如 "钩子"、"正文"、"互动语"
    description: string; // 提取要求：如 "开头吸引注意力的句子"
}

interface CopywritingItem {
    id: string;
    originalForeign: string;      // 原始外文
    originalChinese?: string;     // 原始中文（可选）
    resultForeign?: string;       // 改写后的外文（最后一次结果）
    resultChinese?: string;       // 翻译后的中文（最后一次结果）
    status: 'idle' | 'processing' | 'success' | 'error';
    error?: string;
    voiceIntegrityIssue?: VoiceIntegrityIssue;
    // 多指令结果
    instructionResults?: InstructionResult[];
    // 拆分结果
    splitResults?: Record<string, string>; // columnId -> 提取的内容
    // 经文反馈（如果是无文案模式或不支持多指令的模式产生的结果）
    scriptureNote?: string;
    // 折叠状态
    collapsed?: boolean;
    // 单条设置
    showSettings?: boolean;       // 显示单条设置面板
    customInstruction?: string;   // 单条自定义指令
    // 对话功能
    chatOpen?: boolean;
    chatHistory?: ChatMessage[];
    chatInput?: string;
    chatLoading?: boolean;
    // 文案库匹配结果
    libraryMatchedId?: string;
    libraryMatchedContent?: string;
    // 文案库：单条指定用哪些库（空=用全局启用的）
    selectedLibraryIds?: string[];
    // 多维分类结果
    classifyResults?: Record<string, string>; // classifyColumnId -> 分类结果
    // 多选
    selected?: boolean;
    // 原始AI返回
    rawResponse?: string;
}

interface CopywritingPreset {
    id: string;
    name: string;
    instruction: string;
    createdAt: number;
    presetCategory?: string; // 预设分类：改写预设 / 分类预设 / 拆分预设
}

interface CopywritingViewProps {
    getAiInstance: () => GoogleGenAI;
    textModel: string;
    promptTabId?: string;
}

// --- 辅助函数：为表格单元格格式化文本 ---
function escapeForSheet(text: string): string {
    const t = text || '';
    // 如果包含Tab、换行符或引号，用引号包裹并转义内部引号
    if (t.includes('\t') || t.includes('\n') || t.includes('\r') || t.includes('"')) {
        return `"${t.replace(/"/g, '""')}"`;
    }
    return t;
}

// --- Simple Diff Highlight ---
// 简单的单词级别 diff，返回 React 元素数组
function highlightDiff(original: string, modified: string): React.ReactNode {
    if (!original || !modified) return modified || '';

    // 简单的按空格分词
    const origWords = original.split(/(\s+)/);
    const modWords = modified.split(/(\s+)/);

    const result: React.ReactNode[] = [];
    let modIndex = 0;

    // 使用 Set 存储原文中的词
    const origSet = new Set(origWords.filter(w => w.trim()));

    for (let i = 0; i < modWords.length; i++) {
        const word = modWords[i];
        if (!word.trim()) {
            // 保留空白
            result.push(word);
        } else if (!origSet.has(word)) {
            // 新增或修改的词 - 高亮显示（黄色荧光笔效果）
            result.push(
                <span key={`diff-${i}`} className="bg-yellow-500/40 text-yellow-200 px-0.5 rounded">
                    {word}
                </span>
            );
        } else {
            // 未修改的词
            result.push(word);
        }
    }

    return result;
}

function renderVoiceIntegrityIssue(issue?: VoiceIntegrityIssue, onOpenFullDiff?: (issue: VoiceIntegrityIssue) => void): React.ReactNode {
    if (!issue) return null;
    const stageText = issue.stage === 'tagged' ? '加标签文本（去标签后）' : '断句文本';
    const renderPreview = (preview: VoiceMismatchPreview) => (
        <span className="font-mono text-[11px] break-all">
            <span className="text-zinc-300">{preview.before}</span>
            <span className="bg-yellow-500/35 text-yellow-100 px-0.5 rounded">{preview.focus || '∅'}</span>
            <span className="text-zinc-300">{preview.after}</span>
        </span>
    );

    return (
        <div 
            className="mt-2 rounded border border-red-700/40 bg-red-950/20 p-2 space-y-1.5 cursor-pointer hover:bg-red-900/20 transition-colors"
            onDoubleClick={() => onOpenFullDiff?.(issue)}
            title="双击进行深度文本比对"
        >
            <div className="text-[11px] text-red-300 flex justify-between items-center">
                <span>差异定位：第 {issue.mismatchIndex + 1} 位（已忽略空白、标点和标签）</span>
                {issue.originalRaw && issue.candidateRaw && (
                    <span 
                        className="text-blue-400 hover:text-blue-300 hover:underline cursor-pointer select-none"
                        onClick={(e) => { e.stopPropagation(); onOpenFullDiff?.(issue); }}
                    >
                        🔍 查看完整比对
                    </span>
                )}
            </div>
            <div className="text-[10px] text-zinc-400">基准原文</div>
            <div>{renderPreview(issue.originalPreview)}</div>
            <div className="text-[10px] text-zinc-400">{stageText}</div>
            <div>{renderPreview(issue.candidatePreview)}</div>
        </div>
    );
}

function isVoiceIgnoredSymbol(char: string): boolean {
    return /\s/.test(char) || /[\p{P}\p{S}]/u.test(char);
}

function tokenizeVoiceText(text: string, isOriginal: boolean): { type: 'tag'|'ignored'|'char', text: string, normChar?: string }[] {
    const tokens: { type: 'tag'|'ignored'|'char', text: string, normChar?: string }[] = [];
    let i = 0;
    while (i < text.length) {
        if (!isOriginal) {
            let tagMatch = text.slice(i).match(/^(\[[^\]\n]{0,200}\]|\{[^\}\n]{0,200}\}|<[^>\n]{1,200}>|(?:\.\.\.|…){1,})/);
            if (tagMatch) {
                tokens.push({ type: 'tag', text: tagMatch[0] });
                i += tagMatch[0].length;
                continue;
            }
        }
        const char = text[i];
        if (isVoiceIgnoredSymbol(char)) {
            tokens.push({ type: 'ignored', text: char });
        } else {
            tokens.push({ type: 'char', text: char, normChar: char.normalize('NFKC').toLowerCase() });
        }
        i++;
    }
    return tokens;
}

const VoiceDiffViewer = ({ origText, candText, stage }: { origText: string, candText: string, stage: string }) => {
    const origTokens = useMemo(() => tokenizeVoiceText(origText, true), [origText]);
    const candTokens = useMemo(() => tokenizeVoiceText(candText, false), [candText]);

    const { origNodes, candNodes } = useMemo(() => {
        // 1. Extract comparable char tokens with indices into the full token array
        const origChars: { tokenIdx: number; normChar: string }[] = [];
        const candChars: { tokenIdx: number; normChar: string }[] = [];
        origTokens.forEach((t, i) => { if (t.type === 'char') origChars.push({ tokenIdx: i, normChar: t.normChar! }); });
        candTokens.forEach((t, i) => { if (t.type === 'char') candChars.push({ tokenIdx: i, normChar: t.normChar! }); });

        const m = origChars.length;
        const n = candChars.length;

        // 2. Compute LCS alignment using DP
        //    For performance on very long texts, use O(n) space with full backtrack via Hirschberg-style,
        //    but for typical text lengths (<3000 chars) standard DP is fine.
        const origMatchedTokens = new Set<number>(); // token indices in origTokens that are LCS-matched
        const candMatchedTokens = new Set<number>(); // token indices in candTokens that are LCS-matched

        if (m > 0 && n > 0) {
            // Space-optimized: we only need two rows for the DP, but we need full backtrack.
            // For texts < 5000 comparable chars, use full matrix. Otherwise, fall back to greedy.
            if (m * n < 25_000_000) {
                // Standard DP with backtrack
                const dp: Uint16Array[] = [];
                for (let i = 0; i <= m; i++) dp.push(new Uint16Array(n + 1));

                for (let i = 1; i <= m; i++) {
                    for (let j = 1; j <= n; j++) {
                        if (origChars[i - 1].normChar === candChars[j - 1].normChar) {
                            dp[i][j] = dp[i - 1][j - 1] + 1;
                        } else {
                            dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                        }
                    }
                }

                // Backtrack to identify matched pairs
                let bi = m, bj = n;
                while (bi > 0 && bj > 0) {
                    if (origChars[bi - 1].normChar === candChars[bj - 1].normChar && dp[bi][bj] === dp[bi - 1][bj - 1] + 1) {
                        origMatchedTokens.add(origChars[bi - 1].tokenIdx);
                        candMatchedTokens.add(candChars[bj - 1].tokenIdx);
                        bi--; bj--;
                    } else if (dp[bi - 1][bj] >= dp[bi][bj - 1]) {
                        bi--;
                    } else {
                        bj--;
                    }
                }
            } else {
                // Greedy fallback for very long texts: use patience-like forward scan
                let cj = 0;
                for (let ci = 0; ci < m && cj < n; ci++) {
                    // Find next match in cand starting from cj
                    let found = -1;
                    for (let search = cj; search < n && search < cj + 200; search++) {
                        if (origChars[ci].normChar === candChars[search].normChar) {
                            found = search;
                            break;
                        }
                    }
                    if (found >= 0) {
                        origMatchedTokens.add(origChars[ci].tokenIdx);
                        candMatchedTokens.add(candChars[found].tokenIdx);
                        cj = found + 1;
                    }
                }
            }
        }

        // 3. Render tokens: matched chars are normal, unmatched chars are highlighted red
        const oNodes: React.ReactNode[] = [];
        const cNodes: React.ReactNode[] = [];
        let key = 0;

        const MATCH_CLS = "text-zinc-300";
        const DIFF_CLS = "bg-red-500/80 text-white font-bold px-[1px] rounded-sm shadow-[0_0_8px_rgba(239,68,68,0.6)]";
        const IGNORED_CLS = "text-zinc-600/70";
        const TAG_CLS = "text-zinc-500 font-semibold bg-zinc-800/50 rounded px-1 mx-[1px] shadow-sm italic";

        for (let ti = 0; ti < origTokens.length; ti++) {
            const t = origTokens[ti];
            if (t.type === 'ignored') {
                oNodes.push(<span key={key++} className={IGNORED_CLS}>{t.text}</span>);
            } else if (t.type === 'char') {
                oNodes.push(<span key={key++} className={origMatchedTokens.has(ti) ? MATCH_CLS : DIFF_CLS}>{t.text}</span>);
            }
        }

        for (let ti = 0; ti < candTokens.length; ti++) {
            const t = candTokens[ti];
            if (t.type === 'tag') {
                cNodes.push(<span key={key++} className={TAG_CLS}>{t.text}</span>);
            } else if (t.type === 'ignored') {
                cNodes.push(<span key={key++} className={IGNORED_CLS}>{t.text}</span>);
            } else if (t.type === 'char') {
                cNodes.push(<span key={key++} className={candMatchedTokens.has(ti) ? MATCH_CLS : DIFF_CLS}>{t.text}</span>);
            }
        }

        return { origNodes: oNodes, candNodes: cNodes };
    }, [origTokens, candTokens]);

    return (
        <div className="flex gap-4 h-full bg-[#1e1e1e] p-4 rounded-xl shadow-2xl border border-zinc-700/50">
            <div className="flex flex-col flex-1 h-full bg-[#252526] rounded-lg overflow-hidden border border-zinc-800">
                <div className="bg-[#2d2d2d] border-b border-zinc-700/50 px-4 py-2 font-medium text-zinc-300 flex items-center justify-between shadow-sm shrink-0">
                    <span>原始文案 (Original)</span>
                </div>
                <div className="p-4 flex-1 overflow-y-auto text-base leading-relaxed whitespace-pre-wrap break-words font-mono subpixel-antialiased">
                    {origNodes}
                </div>
            </div>
            <div className="flex flex-col flex-1 h-full bg-[#252526] rounded-lg overflow-hidden border border-zinc-800">
                <div className="bg-[#2d2d2d] border-b border-zinc-700/50 px-4 py-2 font-medium text-zinc-300 flex items-center justify-between shadow-sm shrink-0">
                    <span>修改后文案 (Revised)</span>
                    <div className="flex items-center gap-2">
                        <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                            <span className="w-2 h-2 rounded-full bg-red-500/80"></span> 差异
                        </span>
                        <span className="flex items-center gap-1 text-[10px] text-zinc-400">
                            <span className="w-2 h-2 rounded-full bg-zinc-600/70"></span> 忽略项
                        </span>
                    </div>
                </div>
                <div className="p-4 flex-1 overflow-y-auto text-base leading-relaxed whitespace-pre-wrap break-words font-mono subpixel-antialiased">
                    {candNodes}
                </div>
            </div>
        </div>
    );
};

const FullDiffModal = ({ issue, onClose }: { issue: VoiceIntegrityIssue, onClose: () => void }) => {
    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/80 backdrop-blur-sm p-8" onClick={onClose}>
            <div className="w-full max-w-[90vw] h-[85vh] bg-[#1e1e1e] rounded-2xl shadow-2xl flex flex-col border border-zinc-700/60" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-800 shrink-0 bg-[#252526] rounded-t-2xl">
                    <div className="flex flex-col">
                        <h2 className="text-lg font-semibold text-zinc-100 font-mono tracking-tight flex items-center gap-2">
                           <span className="bg-red-500/20 text-red-400 border border-red-500/30 px-2 py-0.5 rounded text-xs">差异定位: {issue.mismatchIndex + 1}</span> 
                           文案深度对齐分析 (Deep Diff Analysis)
                        </h2>
                        <span className="text-xs text-zinc-500 mt-1">系统已将不可见符号处理，红底高亮显示导致中断的有效字符差异，灰字区域代表正常通过校验的忽略项（如发音标签、空格等）。</span>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-[#3d3d3d] rounded-full transition-colors group">
                        <X size={20} className="text-zinc-400 group-hover:text-zinc-200" />
                    </button>
                </div>
                <div className="flex-1 overflow-hidden p-6">
                    <VoiceDiffViewer origText={issue.originalRaw} candText={issue.candidateRaw} stage={issue.stage} />
                </div>
            </div>
        </div>
    );
};

// --- Voice Mode Integrity Check ---
// 目标：允许「情感标签/停顿标记/断行」，但不允许修改原文主干内容。
function normalizeVoiceComparable(text: string): string {
    return (text || '')
        .normalize('NFKC')
        .replace(/\s+/g, '') // 忽略空白差异（空格/换行/制表）
        .replace(/[\p{P}\p{S}]+/gu, '') // 忽略中英文标点与符号差异
        .toLowerCase(); // 忽略大小写差异
}

function stripVoiceAnnotations(text: string): string {
    if (!text) return '';
    // 通用兜底：无论是否在白名单，统一忽略常见标签形式及其内容
    const genericSquareTagRe = /\[[^\]\n]{0,200}\]/g;
    const genericCurlyTagRe = /\{[^\}\n]{0,200}\}/g;
    const genericAngleTagRe = /<[^>\n]{1,200}>/g;

    return text
        // 先做通用剥离，避免白名单遗漏导致误判
        .replace(genericSquareTagRe, ' ')
        .replace(genericCurlyTagRe, ' ')
        .replace(genericAngleTagRe, ' ')
        // 常见停顿符号占位
        .replace(/(?:\.\.\.|…){1,}/g, ' ');
}

function firstMismatchIndex(a: string, b: string): number {
    const minLen = Math.min(a.length, b.length);
    for (let i = 0; i < minLen; i++) {
        if (a[i] !== b[i]) return i;
    }
    return a.length === b.length ? -1 : minLen;
}

function buildMismatchPreview(text: string, index: number, radius = 14): VoiceMismatchPreview {
    if (index < 0) return { before: text, focus: '', after: '' };
    const start = Math.max(0, index - radius);
    const end = Math.min(text.length, index + radius + 1);
    return {
        before: (start > 0 ? '…' : '') + text.slice(start, index),
        focus: index < text.length ? text[index] : '',
        after: text.slice(index + 1, end) + (end < text.length ? '…' : ''),
    };
}

function createVoiceIntegrityError(
    stage: 'tagged' | 'segmented',
    originalComparable: string,
    candidateComparable: string,
    mismatchIndex: number,
    originalRaw: string,
    candidateRaw: string
): Error {
    const label = stage === 'tagged' ? '加标签结果在去除标签后与原文不一致' : '断句结果与原文不一致';
    const err = new Error(`一致性校验失败：${label}（位置 ${mismatchIndex >= 0 ? mismatchIndex + 1 : '未知'}）`) as Error & {
        voiceIntegrityIssue?: VoiceIntegrityIssue;
    };
    err.voiceIntegrityIssue = {
        stage,
        mismatchIndex,
        originalComparable,
        candidateComparable,
        originalPreview: buildMismatchPreview(originalComparable, mismatchIndex),
        candidatePreview: buildMismatchPreview(candidateComparable, mismatchIndex),
        originalRaw,
        candidateRaw
    };
    return err;
}

function getErrorMessage(error: unknown): string {
    if (error && typeof error === 'object' && 'message' in error) {
        return String((error as any).message || '处理失败');
    }
    return String(error || '处理失败');
}

function getVoiceIntegrityIssue(error: unknown): VoiceIntegrityIssue | undefined {
    if (error && typeof error === 'object' && 'voiceIntegrityIssue' in error) {
        return (error as any).voiceIntegrityIssue as VoiceIntegrityIssue | undefined;
    }
    return undefined;
}

function validateVoiceModeIntegrity(
    originalText: string,
    taggedText: string,
    segmentedText: string
): void {
    const originalNorm = normalizeVoiceComparable(originalText);
    const taggedCoreNorm = normalizeVoiceComparable(stripVoiceAnnotations(taggedText));
    const segmentedNorm = normalizeVoiceComparable(segmentedText);

    if (taggedCoreNorm !== originalNorm) {
        const pos = firstMismatchIndex(originalNorm, taggedCoreNorm);
        throw createVoiceIntegrityError('tagged', originalNorm, taggedCoreNorm, pos, originalText, taggedText);
    }
    if (segmentedNorm !== originalNorm) {
        const pos = firstMismatchIndex(originalNorm, segmentedNorm);
        throw createVoiceIntegrityError('segmented', originalNorm, segmentedNorm, pos, originalText, segmentedText);
    }
}

// --- Constants ---

const STORAGE_KEY = 'copywriting_view_state_v1';
const PRESETS_DOC_PATH = 'copywriting_presets';
export const DEFAULT_INSTRUCTION = '我需要你给我每个文案的标题添加一个时间或者修改过期时间，可以修改为2026年一月';
const DEFAULT_LIBRARY_INSTRUCTION = '根据文案内容选择合适的互动语，并替换/添加到文案末尾';
export const DEFAULT_SYSTEM_INSTRUCTION = `你是一个专业的文案编辑和翻译专家。

【核心原则】
1. 根据文案合理理解标题、内容和结尾的结构
2. 只修改用户指令明确要求修改的部分，其他保持原样
3. 根据当前语言的正宗语法规范对用户要求修改的部分进行修改，没要求修改的部分不需要修改
4. 保持专业、简洁`;

// === 信仰文案分类关键词规则（本地匹配用） ===
interface FaithClassifyRule {
    keywords: string[];      // OR 关键词（任一命中即匹配）
    andKeywords?: string[][]; // AND 关键词组（同时出现才匹配），每组内 OR
    major: string;           // 大类
    sub: string;             // 子分类
}

const FAITH_CLASSIFY_RULES: FaithClassifyRule[] = [
    // ===== 一、数字类 =====
    { keywords: ['神永远与我同在', '神为我预备了计划', '神为我预备了一个美好的计划', '上帝看见你'], major: '数字类', sub: '上帝的五个祝福' },
    { keywords: ['上帝永远爱你', '上帝爱你', '他会帮助你', '他永远不会放弃你'], major: '数字类', sub: '六件事、7条信息' },
    { keywords: ['你今天睁开了双眼', '我有地方住', '我能呼吸', '我有一个家', '你拥有一个家'], major: '数字类', sub: '7、8、10、12项祝福' },
    { keywords: ['7个迹象'], major: '数字类', sub: '7个迹象' },
    { keywords: ['上帝说的七件事', '对自己说的5件事'], major: '数字类', sub: '对上帝说的5、7件事' },
    { keywords: ['5个理由'], major: '数字类', sub: '不忧虑的5个理由' },
    { keywords: ['生命是恩赐'], major: '数字类', sub: '我确信的七件事' },

    // ===== 二、经文短贴类 =====
    { keywords: ['敞开一切大门'], major: '经文短贴', sub: '马太福音7：7打开所有的门' },
    { keywords: [], andKeywords: [['马太福音7章7节'], ['敞开所有的门']], major: '经文短贴', sub: '马太福音7：7打开所有的门' },
    { keywords: ['耶稣就是答案'], major: '经文短贴', sub: '约翰福音 14:6耶稣是答案' },
    { keywords: ['见证耶稣基督是他们的救主'], major: '经文短贴', sub: '约翰福音 14:6见证耶稣基督救主' },
    { keywords: ['上帝仍然掌管一切'], major: '经文短贴', sub: '以赛亚书 43:16-19' },
    { keywords: ['月亮要变为血'], major: '经文短贴', sub: '异象-血月' },
    { keywords: ['耶和华是我的亮光'], major: '经文短贴', sub: '诗篇 27:1' },
    { keywords: ['上帝永远不会放弃你'], major: '经文短贴', sub: '诗篇86:15' },
    { keywords: ['用神的话语滋养你的灵魂'], major: '经文短贴', sub: '马太福音 4:4' },
    { keywords: [], andKeywords: [['请看约伯记 22:28', '约伯记 22:28'], ['上帝回应了你的祷告']], major: '经文短贴', sub: '约伯记 22:28-回应祷告' },
    { keywords: ['天使已被差遣来安慰你'], major: '经文短贴', sub: '耶利米书29:11' },
    { keywords: ['悔改吧'], major: '经文短贴', sub: '以赛亚书 13:11-悔改' },
    { keywords: ['伸冤'], major: '经文短贴', sub: '以赛亚书 41:18伸冤' },
    { keywords: ['永远不要失去希望'], major: '经文短贴', sub: '以赛亚书 43:19开路' },
    { keywords: ['神能为任何人'], major: '经文短贴', sub: '以赛亚书 60:22成就不可能的事' },
    { keywords: ['大海无法阻挡摩'], major: '经文短贴', sub: '路加福音 1:37凡事都能' },
    { keywords: ['信靠神，你也能走出困境'], major: '经文短贴', sub: '以赛亚书 43:16-19信靠走出困境' },
    { keywords: ['救主的第二次降临', '迎接救主的再来', '等候君王的人'], major: '经文短贴', sub: '启示录22章12节二次降临' },
    { keywords: ['祂从不让我独自面对挑战'], major: '经文短贴', sub: '出埃及记14章14节不必独立面对争战' },
    { keywords: ['需要一杯咖啡', '信靠上帝的女子'], major: '经文短贴', sub: '诗篇46篇5节信靠上帝的女人' },
    { keywords: ['没有人能阻止上帝在你生命中即将成就的事'], major: '经文短贴', sub: '约伯记 22:28 没人阻止上帝成就的事' },
    { keywords: ['成功是耶稣基督将你的名字写在祂的生命册上'], major: '经文短贴', sub: '《启示录》20:15生命册' },
    { keywords: ['当你祷告时，神垂听'], major: '经文短贴', sub: '耶利米书 33:3祷告排比' },
    { keywords: ['上帝垂听'], major: '经文短贴', sub: '马太福音21章22节祷告排比' },
    { keywords: ['愿神今天以他的保护庇佑你', '上帝能指引你度过每一场风暴'], major: '经文短贴', sub: '诗篇91:11神保护' },
    { keywords: ['他也会为你开辟道路'], major: '经文短贴', sub: '诗篇91篇11节开路' },
    { keywords: ['世界比以往任何时候都更需要上帝'], major: '经文短贴', sub: '诗篇 9:9更需要上帝' },

    // ===== 三、纯小话 =====
    { keywords: ['神帮助', '帮助过你', '需要上帝'], major: '纯小话', sub: '神帮助/需要上帝' },
    { keywords: ['在保护你', '上帝的保护'], major: '纯小话', sub: '神保护' },
    { keywords: ['上帝在保佑你', '祈求上帝庇佑你的家'], major: '纯小话', sub: '庇护家人' },
    { keywords: ['首位', '第一位', '上帝在你的生活', '第一要务'], major: '纯小话', sub: '与神关系首位' },
    { keywords: ['不写"我爱耶稣"', '不写我爱耶稣'], major: '纯小话', sub: '不写"我爱耶稣"' },
    { keywords: ['除去三样东西'], major: '纯小话', sub: '除去三样东西' },
    { keywords: ['打开所有的大门', '敞开所有的大'], major: '纯小话', sub: '打开所有的大门' },
    { keywords: ['无论你是否去教堂'], major: '纯小话', sub: '是否去教堂' },
    { keywords: ['灵魂没有耶稣', '耶稣是通往天堂的'], major: '纯小话', sub: '通往天堂的唯一道路' },
    { keywords: ['恢复祈祷活动'], major: '纯小话', sub: '恢复祈祷活动' },
    { keywords: ['如果你爱撒旦，请跳过'], major: '纯小话', sub: '撒但/耶稣' },
    { keywords: ['愿你的眼泪化为笑容'], major: '纯小话', sub: '三项祝福' },
    { keywords: ['仍然是王'], major: '纯小话', sub: '是王' },
    { keywords: ['多次拯救'], major: '纯小话', sub: '神拯救' },
    { keywords: ['祈祷的力量'], major: '纯小话', sub: '祈祷的力量-灾难' },
    { keywords: ['回归上帝', '国家归向你'], major: '纯小话', sub: '回归上帝' },
    { keywords: ['耶稣基督是他们的救主'], major: '纯小话', sub: '耶稣基督是救主' },
    { keywords: ['过去一个小时'], major: '纯小话', sub: '过去一个小时' },
    { keywords: ['七年的繁荣'], major: '纯小话', sub: '七年的繁荣' },
    { keywords: ['童话', '耶稣会再来'], major: '纯小话', sub: '质量-耶稣再来' },
    { keywords: ['2026年与你同在'], major: '纯小话', sub: '神同在' },
    { keywords: ['从未让你失望'], major: '纯小话', sub: '从未让你失望' },
    { keywords: ['憎恨基督'], major: '纯小话', sub: '憎恨基督的世界' },
    { keywords: ['死在十字架'], major: '纯小话', sub: '爱十字架上的耶稣' },
    { keywords: ['如果你爱上帝', '如果你爱耶稣', '请对上帝说', '真正爱他的人', '那些爱上帝', '热爱上帝'], major: '纯小话', sub: '爱上帝' },
    { keywords: ['忘记感恩', '你感谢主', '当你感谢上帝', '你说一句谢谢', '不要跳过它——感谢上帝', '请感谢上帝保护你', '也要感谢上帝', '感谢耶稣基督', '请停下来感谢上帝', '如果你停下来向主说声谢谢', '请停下来，感谢上帝', '停下来感谢上帝'], major: '纯小话', sub: '感谢上帝' },
    { keywords: ['归功于上帝'], major: '纯小话', sub: '归功于上帝' },
    { keywords: ['爱钱胜过'], major: '纯小话', sub: '爱钱胜过爱上帝' },
    { keywords: ['耶稣扶持我', '我得医治', '耶稣指引我', '祂是我的道路', '耶稣照顾我', '上帝是我黑暗', '耶稣带领我', '耶稣赐予我平安'], major: '纯小话', sub: '耶稣排比' },
    { keywords: ['上帝比你的过去更伟大'], major: '纯小话', sub: '上帝伟大排比' },
    { keywords: ['在学校阅读圣经'], major: '纯小话', sub: '学校阅读圣经' },
    { keywords: ['我醒了。我选择感恩', '只是感恩自己'], major: '纯小话', sub: '启动贴' },
    { keywords: ['上帝赐予你最珍贵', '比金钱更有价值的东西是什么', '当我说基督是通往天堂的唯一道路你会怎么说', '世界现在最需要什么', '你认为父母应该从孩子很小的时候就和他们谈论上帝吗', '在你人生最艰难的时刻是什么让你活了下来'], major: '纯小话', sub: '问答' },
    { keywords: ['没有上帝的帮助', '不会失去对'], major: '纯小话', sub: '个人见证' },
    { keywords: ['信心能移山', '与神同行'], major: '纯小话', sub: '信心' },
    { keywords: ['女人可能会哭泣', '与她同在的女', '女性愿意跟随耶稣'], major: '纯小话', sub: '女性' },
    { keywords: ['信奉上帝'], major: '纯小话', sub: '信上帝' },
    { keywords: ['为你开路'], major: '纯小话', sub: '开路' },
    { keywords: ['安排好一切'], major: '纯小话', sub: '上帝安排好一切' },
    { keywords: ['上帝为你做的一'], major: '纯小话', sub: '互动类' },
    { keywords: ['最重要的书'], major: '纯小话', sub: '圣经书' },
    { keywords: ['君王会再来'], major: '纯小话', sub: '君王会再来' },
    { keywords: ['流血'], major: '纯小话', sub: '耶稣为你流血' },
    { keywords: ['生活中重要', '真的那么重要'], major: '纯小话', sub: '重要' },
    { keywords: ['我爱耶稣'], major: '纯小话', sub: '我爱耶稣' },
    { keywords: ['他是我们的王'], major: '纯小话', sub: '他是我们的王' },
    { keywords: ['以存活的原因'], major: '纯小话', sub: '上帝是你存活的原因' },
    { keywords: ['十诫'], major: '纯小话', sub: '十诫' },
    { keywords: ['悔改是进入天国'], major: '纯小话', sub: '悔改' },
    { keywords: ['耶稣是我的'], major: '纯小话', sub: '耶稣是我的' },
    { keywords: ['与耶稣基督的'], major: '纯小话', sub: '与耶稣基督的关系' },
    { keywords: ['上帝是美好的', '上帝是良善的'], major: '纯小话', sub: '上帝是好的' },
    { keywords: ['承受能力', '有些日子很沉重', '看不到前进', '我仍然相信你正在为我开路', '我相信你会再次', '拥有我想要的一切', '你分开了红海', '为所有需要帮助的人祈祷', '主是我的牧者，我将一无所缺', '当你相信上帝时', '不感谢耶稣', '已经开辟了一条路'], major: '纯小话', sub: '信心祷告' },

    // ===== 四、经文长贴 =====
    { keywords: ['你会哭泣，不是'], major: '经文长贴', sub: '你会哭泣神回应' },
    { keywords: ['在任何时间'], major: '经文长贴', sub: '神成就任何事' },
    { keywords: ['身体的疼痛', '医治我们心中'], major: '经文长贴', sub: '神治愈你的伤痛' },
    { keywords: ['屹立不倒', '彻夜哭泣', '不眠之夜'], major: '经文长贴', sub: '坚强的女性' },
    { keywords: ['内心崩溃的日子'], major: '经文长贴', sub: '安慰-神要擦干你的眼泪' },
    { keywords: ['处境中行神迹'], major: '经文长贴', sub: '神成就不可能之事' },
    { keywords: ['把神放在首位，你永远不会'], major: '经文长贴', sub: '神放在首位' },
    { keywords: ['知道你很累', '会挪开那些'], major: '经文长贴', sub: '上帝知你累-争战-开路' },
    { keywords: ['并不着急', '无需你乞求', '是神的旨意', '无需你费'], major: '经文长贴', sub: '属于你的无需祈求' },
    { keywords: ['喜极而泣'], major: '经文长贴', sub: '耶稣不是一个选择' },
    { keywords: ['路得的路'], major: '经文长贴', sub: '圣经故事女性' },
    { keywords: ['独自承担重担'], major: '经文长贴', sub: '不要独自承受重担' },
    { keywords: ['她祷告。'], major: '经文长贴', sub: '敬虔的女人' },

    // ===== 五、祷告词短 =====
    { keywords: ['生活究竟', '生活有时艰难'], major: '祷告词短', sub: '生活不易，我不放弃' },
    { keywords: ['每时每刻都需要', '每一天', '每一刻'], major: '祷告词短', sub: '上帝，我需要你' },
    { keywords: ['我犯了很多错', '我犯了太多错', '无数次祈求宽恕', '重蹈覆辙'], major: '祷告词短', sub: '简短认罪感恩' },
    { keywords: ['我祈求您赐予我的家庭', '我的财务'], major: '祷告词短', sub: '3遍奇迹祷告' },
    { keywords: ['请赐予我安宁', '照亮我心中', '迷失方向', '赐予我软弱'], major: '祷告词短', sub: '祈求排比' },
    { keywords: ['如果我软弱，求你赐我力量'], major: '祷告词短', sub: '如果式祈求排比' },
    { keywords: ['让我得以生存', '高潮和低谷'], major: '祷告词短', sub: '个人感恩' },
    { keywords: ['无法独自站立'], major: '祷告词短', sub: '没有上帝无法活下去' },
    { keywords: ['黑暗势力开战', '战胜一切黑暗势力', '一切黑暗的枷锁'], major: '祷告词短', sub: '战胜黑暗势力' },
    { keywords: ['忧虑、恐惧和重担都交托给你'], major: '祷告词短', sub: '睡前祷告' },
    { keywords: ['您挪去他们生命中的忧虑'], major: '祷告词短', sub: '疲惫重担' },
    { keywords: ['祈求宽恕', '请原谅我', '非常抱歉', '我很抱歉', '不完美', '来到你面前认'], major: '祷告词短', sub: '认罪祷告' },
    { keywords: ['没有你，我什么都不是'], major: '祷告词短', sub: '早晨3、4件事' },
    { keywords: ['睡前'], major: '祷告词短', sub: '睡前' },

    // ===== 六、祷告词长 =====
    { keywords: ['改变我的态度', '求祢更新我的想法', '更新我的思想', '你的计划比我的理解更伟大', '今天不要让恐惧', '您知道我们的恐惧', '消除他们生活中', '原谅我的失败', '我将我的心', '我的忧虑', '让我远离你', '不知道如何处理', '请帮助我放下这个'], major: '祷告词长', sub: '祈求祷告' },
    { keywords: ['忧虑袭来时，我可以转向'], major: '祷告词长', sub: '焦虑交托' },
    { keywords: ['我将我的家人交托'], major: '祷告词长', sub: '祷告开启新月份' },
    { keywords: ['黑暗试图阻挠我', '拒绝任何恐惧', '压迫', '邪恶箭', '摧毁我的生命', '我是一个新造的人', '让你的圣光', '每一个针对我的伤害性', '没有任何权力', '撒旦在这最后的日子', '每一种攻击我的思想', '今年针对我的每一个阴谋', '撒旦和所有黑暗势力将不会统治我的生活', '我知道敌人想要攻击', '让所有可见和不可见的危险远离我', '这个月针对我的每一个阴谋', '摧毁每一个针对我生命的黑暗计划', '宣告撒旦和所有黑暗势力', '每一支邪恶的箭', '所有隐藏的计划都已被揭露', '我不属于黑暗', '敌人没有权利', '撒旦和一切黑暗势力', '保护我免受敌人的每一个计划'], major: '祷告词长', sub: '属灵争战-个人' },
    { keywords: ['我和我的家人身上的精神', '我家人身上的每一个属灵的咒诅', '用你的光驱除悲伤', '我宣告魔鬼必须释放他对我的家庭', '我请求你为我的家庭', '不属于黑暗，我的家的每一条锁链', '宣告生命和自由', '关闭敌人用来攻击'], major: '祷告词长', sub: '属灵争战-家人' },
    { keywords: ['女儿交托给你'], major: '祷告词长', sub: '女儿祷告' },
    { keywords: ['高潮和低谷', '顺境和逆境中', '高山和低谷', '高潮和每一个低谷'], major: '祷告词长', sub: '个人经历感恩' },
    { keywords: ['顺境和逆境中', '想说谢谢', '谢谢你一直在', '风风雨雨', '取得成功', '生活并不容', '我不仅感谢你给', '谢谢你给了我', '钱包', '感谢你在我生命中', '戏剧性', '感谢你一直在我身边', '无声战斗', '干净的水', '在你的仁慈中', '感谢你带领我', '感谢您赐予我新的一天', '多一天的生命', '新的早晨和生活的气息'], major: '祷告词长', sub: '感恩祷告' },
    { keywords: ['上帝保佑您的孩子', '为孩子祈祷', '你和你的家人', '你的孩子们祈求', '将我的家人交在您慈爱的手中', '我的孩子们', '我的孩子交托给您', '消除他们生活中的所有邪恶'], major: '祷告词长', sub: '家人保护' },
    { keywords: ['害怕失败，害怕未'], major: '祷告词长', sub: '害怕未来' },
    { keywords: ['每一次挣扎'], major: '祷告词长', sub: '感谢挣扎' },
    { keywords: ['圣洁的守护天使'], major: '祷告词长', sub: '为孩子祈祷' },
    { keywords: ['我将未来的日子', '未来会怎样'], major: '祷告词长', sub: '未来、计划' },
    { keywords: ['至高者隐秘处的'], major: '祷告词长', sub: '诗篇91篇' },
];

/** 本地关键词匹配：返回 { major, sub } 或 null */
function matchFaithKeywords(text: string): { major: string; sub: string } | null {
    const lowerText = text.toLowerCase();
    for (const rule of FAITH_CLASSIFY_RULES) {
        // AND 逻辑：每组至少有一个关键词命中
        if (rule.andKeywords && rule.andKeywords.length > 0) {
            const allGroupsMatch = rule.andKeywords.every(group =>
                group.some(kw => lowerText.includes(kw.toLowerCase()))
            );
            if (allGroupsMatch) return { major: rule.major, sub: rule.sub };
        }
        // OR 逻辑：任一关键词命中
        if (rule.keywords.length > 0) {
            const anyMatch = rule.keywords.some(kw => lowerText.includes(kw.toLowerCase()));
            if (anyMatch) return { major: rule.major, sub: rule.sub };
        }
    }
    return null;
}

// 内置预设
export const BUILTIN_PRESETS: CopywritingPreset[] = [
    {
        id: 'builtin_change_month',
        name: '📅 改月份',
        instruction: '我需要你给我每个文案的标题添加一个时间或者修改过期时间，可以修改为2026年一月',
        createdAt: Date.now(),
        presetCategory: '改写预设'
    },
    {
        id: 'builtin_catholic_to_protestant',
        name: '✝️ 天主教改基督教',
        instruction: `将**天主教（Catholic）风格的文案转换为基督教新教/福音派（Protestant/Evangelical）**风格，重点在于移除"圣母玛利亚"相关元素，确立"主耶稣/上帝"为唯一核心。

1. 核心词汇替换
将所有涉及圣母的称呼统一改为耶稣或上帝。
将文本中的相关称呼统一进行核心替换：把"圣母（The Virgin）""圣母玛利亚（Virgin Mary）""玛利亚（Mary）""奇迹圣母（Miraculous Virgin）""瓜达卢佩圣母（Our Lady of Guadalupe）"等所有指向圣母的称谓，全部替换为"主耶稣（Lord Jesus）"；同时，将"天主（Catholic term for God）"也统一替换为"主耶稣（Lord Jesus）"，以实现称呼上的一致与统一。

2. 代词调整
当原主语由"圣母"变为"耶稣"时，代词必须同步调整。
文本中的指代统一进行替换：把女性指代"她 / 她的（She / Her）"但仅限于原本指的是玛丽亚圣母等天主教人物的代词。统一替换为男性指代"他 / 他的（He / His）"，代词必须大写首字母，以保持人称与性别指代的一致性。

3. 特定短语重写
针对特定的叙述逻辑进行调整，使其符合新教的"感动/启示"逻辑。
原句：瓜达卢佩圣母托我转告你... (Our Lady of Guadalupe asked me to tell you...)
改为：上帝感动我告诉你... (God moved me to tell you...)
原句：圣母玛利亚感动我告诉你... (Virgin Mary moved me to tell you...)
改为：上帝感动我告诉你... (God moved me to tell you...)

4. 删除项
删除："圣洁的圣母" (Holy Virgin) 及相关修饰语。

5. 执行原则
非圣母内容不改： 如果文案本身不涉及圣母玛利亚，且符合基督教义，则保持原样，不做变动。
排他性： 确保文中不再出现任何指向"圣母崇拜"的词汇，通过修改确保受众聚焦于耶稣基督。
若文案并未涉及任何天主教相关的以及以上内容的，则在文案开头固定添加 ：✅并未涉及天主教内容
特殊情况：如果文案主题指代的并不是人物，而是物品（如画像，画框，雕塑），则不需要虚构，则在文案开头固定添加 ：✨并未涉及天主教内容，但是涉及到物品。`,
        createdAt: Date.now(),
        presetCategory: '改写预设'
    },
    {
        id: 'builtin_remove_at_logo',
        name: '🚫 去掉@名字',
        instruction: '需要根据当前文案修改。修改要求：去掉文案中的@和名字logo，保持其他内容不变。',
        createdAt: Date.now(),
        presetCategory: '改写预设'
    },
    {
        id: 'builtin_add_interaction',
        name: '💬 添加互动语',
        instruction: `需要根据当前文案修改。修改要求：在结尾根据当前文案内容，识别结尾互动语，自动判断添加或者修改为合适的互动语结尾。严格使用我提供给你的结尾互动语句子，不要修改。常用互动语：
Disappoint Satan by "God is good!"
Put " Amen " to defeat Satan.
put Amen and shame the devil
IF YOU Depend on God Put I DO
tell Him : " Thank You! "
If you believe it, Don't forget Amen.
If you trust Him, put Amen
IF YOU BELIEVE IN THE POWER OF PRAYER-PUT AMEN
Lord, open a door for everyone who puts Amen and shares.
If you are not ashamed to love Jesus, put Amen.`,
        createdAt: Date.now(),
        presetCategory: '改写预设'
    },
    {
        id: 'builtin_add_see',
        name: '👁️ 添加/修改 SEE',
        instruction: '需要根据当前文案修改。修改要求：开头部分需要统一添加 SEE。如果已经有了SEE则不需要添加。如果开头有 Inspired by 则修改为 SEE。',
        createdAt: Date.now(),
        presetCategory: '改写预设'
    },
    {
        id: 'builtin_add_inspired_by',
        name: '✨ 添加/修改 Inspired by',
        instruction: '需要根据当前文案修改。修改要求：开头部分需要统一添加 Inspired by。如果已经有了 Inspired by 则不需要添加。如果开头有 SEE 则修改为 Inspired by。',
        createdAt: Date.now(),
        presetCategory: '改写预设'
    },
    {
        id: 'builtin_voice_emotion_tags',
        name: '🎙️ 文案人声修改',
        instruction: `ElevenLabs 配音文案格式化助手 — 为祷告/宣告/属灵鼓励/短视频旁白文案添加情感标签、拆句断行、排节奏，可直接复制粘贴用于 ElevenLabs 生成配音

## 核心用途
用于 ElevenLabs 配音
场景：祷告 / 宣告 / 属灵鼓励 / 短视频旁白
需要可直接复制粘贴使用

## 情感标签（最重要）
✅ 只用情感 / 语气标签（如 [calm] [reverent] [faith-filled]）
❌ 不要 emoji
❌ 不要解释标签含义
标签要：克制、稳定、不浮夸、不戏剧化

## 节奏与结构
每段都有清晰停顿
常用：[pause]
适合：跟读、默读、夜间 / 安静场景
长文也要分层，不能一口气读完

## 语气取向
偏向：祷告感、安抚感、权柄但不咆哮
避免：情绪炸裂、表演感、过度煽动

## 内容处理原则
❌ 不改原文意思
❌ 不擅自删句
❌ 不加新神学内容
❌ 不删除标题
对于文案中关于上帝的单词、代词都要标准的首字母大写（如 God / He / Him / His / Lord / Father）
只做三件事：拆句断行、排节奏、加合适的情感标签`,
        createdAt: Date.now(),
        presetCategory: '改写预设'
    },
    {
        id: 'builtin_parallelism_rewrite',
        name: '📐 排比文案改写',
        instruction: `## 角色定义

你是一名专门为**基督信仰类短视频文案**服务的排比修辞改写助手。

你的核心任务是：
读取文案（主要是英文）
- 用AI语义理解来判断每条文案是否包含排比修辞
- 对不含排比但**适合加入排比**的文案，进行排比化改写
- 保留文案的**完整内容和核心信息**，只在排比化的同时增强节奏感和感染力
- 英文必须是地道的美式/英式英语，符合基督教宗教用语规范

## 一、什么是排比文案

排比（Parallelism / Rhetorical Parallelism）是一种修辞手法，通过**连续使用3个或以上结构相似的句子/短语**，形成节奏感和气势。

### 排比的核心特征：
1. 句式重复：相同或相似的开头词/句式结构连续出现3次及以上
2. 语义并列：每个分句表达的是同一层面或并列关系的内容
3. 节奏韵律：读起来有韵律感，朗朗上口，有气势
4. 递进增强：句意可以层层递进，形成情感高潮

## 二、判断规则——什么文案适合改排比

### ✅ 适合改排比的文案类型：
1. 祷告文案（包含"求你/求您/请你"等祈求句式的）
2. 感恩文案（包含"感谢你/谢谢你/Thank you"等的）
3. 宣告文案（包含"我宣告/我相信/I declare"等的）
4. 描述属性文案（描述上帝/耶稣特质的）
5. 否定/反面文案（"没有你.../Without you..."）
6. 条件/场景文案（"当我.../When I..."）
7. 列举类文案（含编号列表的）

### ❌ 不适合改排比的文案类型：
1. 叙事类——讲述一个完整故事/见证的
2. 纯经文引用——只是引用一段圣经原文
3. 对话体——"上帝对你说：……"的对话格式
4. 过短文案——少于50字/30 words，没有足够内容展开排比
5. 已经有完美排比的——已经是排比结构的不改
6. 列表知识类——"耶稣的十二门徒""七大罪"等知识列表
7. 纯互动引导——"如果你相信写阿门"之类

## 三、改写原则——排比化不是重新创作

### 铁律1：保留完整性
改写后的文案必须是**完整的**、**可直接使用的**。不能只给排比句，必须包含原文的开头/标题/引入、排比主体、原文的结尾/呼吁/互动引导。

### 铁律2：保留原意
排比化只改变表达形式，不改变核心含义。不添加原文没有的信息，不删减原文的重要内容。

### 铁律3：自然融入
排比句式应该在文案中自然出现，而不是生硬嵌入。

### 铁律4：控制数量
一篇文案中排比不宜过多。通常1-2组排比即可（每组3-5句），过多会审美疲劳。

### 铁律5：排比句必须断行
- 每一句排比**单独占一行**，不要把排比句挤在同一行
- 排比组与前后文之间留空行，形成视觉分隔
- 非排比的正文段落保持正常连续书写

## 四、改写技巧

### 技巧1：提取共同句首
找到原文中多次出现的相似开头，统一为相同句首。

### 技巧2：拆分长句为排比
将一个包含多个要素的长句拆为并列的短句。

### 技巧3：场景排比
将原文中的多个场景/情境整理为排比。

### 技巧4：属性排比
将对上帝/耶稣的多个描述改为排比。

### 技巧5：否定排比
利用"没有你""不要""不是"构建排比。

## 五、英文排比规则

### 句式模式：
1. Anaphora（首语重复）— 最常用："He is my..., He is my..., He is my..."
2. Epistrophe（尾语重复）："In Him I find peace, in Him I find strength, in Him I find hope."
3. Symploce（首尾同时重复）
4. Tricolon（三段式）— 最有力

### 英文风格要求：
- 保持口语感/口播感
- 排比句长度尽量一致（syllable balance）
- 不要过于文学化（短视频文案，非诗歌）
- 代词大写 — 指代上帝/耶稣时 He/Him/His/You/Your 首字母大写
- 祷告正文中不用缩写（don't→do not）
- 避免俚语 — 不用 gonna, wanna, gotta
- 标点规范 — 排比句之间用分号或逗号+换行，最后一句用句号

## 六、绝对禁忌

### 永远不要：
- 把排比化变成缩写/摘要
- 丢失原文的结尾互动语
- 过度排比——全文都是排比会很假
- 改变神学立场
- 输出注释、分析、备注——只输出干净的改写文案

### 永远要：
- 保留完整文案结构（开头→正文→结尾）
- 排比句式自然融入上下文
- 英文遵守宗教用语规范`,
        createdAt: Date.now(),
        presetCategory: '改写预设'
    },
    {
        id: 'builtin_ai_label_cleaner',
        name: '🧹 清理AI标签+翻译',
        instruction: `## 角色定义

你是一个专业的文案清洁工具。你的任务是**用语义理解**识别并清除社交媒体文案中所有与正文内容无关的杂质文本，包括但不限于 AI 生成标签、平台水印、元数据声明等。

## 一、识别原则（语义识别，非穷举）

你需要识别并移除的是**一切与文案正文无关的平台/AI元数据**。这些杂质有以下共同特征：

### 核心判断标准：
- **与文案主题无关** — 正文在讲祷告/信仰/故事，杂质文本在声明内容来源
- **是平台/工具自动插入的** — 不是作者主动写的内容
- **具有声明/免责性质** — 说明内容由AI生成、协作、辅助等
- **位置规律** — 常出现在文案的最开头、最结尾，或段落之间

### 常见杂质类别（任何语言都可能出现）：
1. **AI 生成声明** — "AI generated" "由AI生成" "créé par IA" "gerado por IA" 等
2. **AI 协作声明** — "co-authored with AI" "AI辅助" "con ayuda de IA" 等
3. **仅供说明声明** — "illustrative only" "仅供参考" "solo ilustrativo" 等
4. **平台产品标记** — "Meta AI" "AI Products" "AI Tools" 等
5. **内容免责声明** — 任何声明内容来源、版权、AI参与的短语
6. **OCR 错误变体** — "Al" 代替 "AI"（小写L代替大写I）、拼写错误如 "Mustrative" 等
7. **无意义字符碎片** — 乱码、孤立的无意义字母组合（如 "M" "VAI" "* " 等）、OCR 产生的随机符号、多余的星号/特殊符号堆叠。注意：有意义的缩写（如 "CTA" "AMEN"）不算杂质

### 重要：
- 这些标签可能是**任何语言**：英语、西班牙语、葡萄牙语、法语、印尼语、阿拉伯语、韩语、日语等
- 可能有各种**拼写错误**、**多余空格**、**连字符变体**
- 可能**重复出现**在同一篇文案中
- 可能和正文**混在一起**，需要精准分离
- 你需要依靠语义理解来判断，而不是匹配固定模式

## 二、清理规则

1. 移除所有识别出的杂质文本
2. 清理移除后产生的多余空行、空格、孤立引号、孤立标点
3. **绝对不要修改正文内容** — 只移除杂质
4. 保持原文的段落结构和格式
5. **宁可漏删，不可多删** — 如果不确定某段文字是否为杂质，必须保留
6. 文案中关于信仰、祈祷、圣经、上帝、耶稣的任何内容都是正文，绝对不能删除
7. 只删除那些**100%确定是平台/AI自动插入的元数据声明**的文本

## 三、输出要求

### 外文列（第一列）：
将清理后的文案翻译为地道的英文。如果原文已是英文，则直接输出清理后的英文。

### 中文列（第二列）：
输出清理后文案的中文翻译。`,
        createdAt: Date.now(),
        presetCategory: '改写预设'
    },
    {
        id: 'builtin_classify_fb_groups',
        name: '👥 fb小组名字分类',
        instruction: `请按以下类别分类（共15个）：

1. 宗教小组 - 包含上帝、耶稣、佛、真主等宗教词汇，或祷告(Prayer)、信仰(Faith)等
2. 偏向励志的 - 包含早安(Good Morning)、晚安(Good Night)、正能量、语录(Quotes)、激励(Motivation)等，且没有明显宗教色彩
3. 美食小组 - 食谱、烹饪、餐厅、吃货分享
4. 衣服小组 - 服装、穿搭、时尚(Fashion)
5. 电影音乐小组 - 影视、歌曲、歌词、MV
6. 买卖小组 - 二手、Marketplace、Buy & Sell、闲置交易（侧重于具体的物品交易）
7. 招聘小组 - 找工作、Hiring、Jobs、兼职
8. 风景小组 - 自然风光、城市景观、旅游摄影
9. 汽车小组 - 汽车买卖、改装、车友会
10. 美容小组 - 化妆、护肤、美甲、发型
11. 母婴小组 - 妈妈群、育儿、怀孕、婴儿用品
12. 明星小组 - 粉丝群、特定名人名字、饭圈
13. 广告小组 - 侧重于商业推广、链接分享、Promo、Business Promotion
14. 乡村小组 - 农村生活、Village、Farm、田园风格
15. 手工艺小组 - DIY、Crochet(钩针)、Woodworking(木工)、手工制作

如果没有包含在以上分类中，标记为"其他 - [具体类型]"。`,
        createdAt: Date.now(),
        presetCategory: '分类预设'
    },
    {
        id: 'builtin_classify_faith_content',
        name: '✝️ 信仰文案分类（6大类）',
        instruction: `你是信仰文案内容分类专家。请根据以下规则将每条文案分类。

【核心原则】
- 以关键词为线索，结合文案整体语义和主题来判断分类
- 关键词可能是中文翻译后的形式，原文可能是任何语言（英文、西班牙语等），请做语义匹配
- 文案可能包含多个关键词，按最符合的分类归类
- 每条文案最终输出格式：大类|||子分类名称

【六大类及子分类规则】

===== 一、数字类 =====
（文案中以数字列表、编号形式呈现祝福/信息/迹象等）

1. 包含：神永远与我同在、神为我预备了计划、神为我预备了一个美好的计划、上帝看见你 → 上帝的五个祝福
2. 包含：上帝永远爱你、上帝爱你、他会帮助你、他永远不会放弃你 → 六件事、7条信息
3. 包含：你今天睁开了双眼、我有地方住、我能呼吸、我有一个家、你拥有一个家 → 7、8、10、12项祝福
4. 包含：7个迹象 → 7个迹象
5. 包含：上帝说的七件事、对自己说的5件事 → 对上帝说的5、7件事
6. 包含：5个理由 → 不忧虑的5个理由
7. 包含：生命是恩赐 → 我确信的七件事
8. 不含以上 → 数字-其他

===== 二、经文短贴类 =====
（短篇幅，围绕一段圣经经文展开的信息帖）

1. 包含"敞开一切大门" 或 同时包含"马太福音7章7节"和"敞开所有的门" → 马太福音7：7打开所有的门
2. 包含：耶稣就是答案 → 约翰福音 14:6耶稣是答案
3. 包含：见证耶稣基督是他们的救主 → 约翰福音 14:6见证耶稣基督救主
4. 包含：上帝仍然掌管一切 → 以赛亚书 43:16-19
5. 包含：月亮要变为血 → 异象-血月
6. 包含：耶和华是我的亮光 → 诗篇 27:1
7. 包含：上帝永远不会放弃你 → 诗篇86:15
8. 包含：用神的话语滋养你的灵魂 → 马太福音 4:4
9. 同时包含"请看约伯记 22:28"和"上帝回应了你的祷告" → 约伯记 22:28-回应祷告
10. 包含：天使已被差遣来安慰你 → 耶利米书29:11
11. 包含：悔改吧！如果你相信地狱真实存 → 以赛亚书 13:11-悔改
12. 包含：伸冤 → 以赛亚书 41:18伸冤
13. 包含：永远不要失去希望 → 以赛亚书 43:19开路
14. 包含：神能为任何人 → 以赛亚书 60:22成就不可能的事
15. 包含：大海无法阻挡摩 → 路加福音 1:37凡事都能
16. 包含：信靠神，你也能走出困境 → 以赛亚书 43:16-19信靠走出困境
17. 包含：救主的第二次降临、迎接救主的再来、等候君王的人 → 启示录22章12节二次降临
18. 包含：祂从不让我独自面对挑战 → 出埃及记14章14节不必独立面对争战
19. 包含：需要一杯咖啡、信靠上帝的女子 → 诗篇46篇5节信靠上帝的女人
20. 包含：没有人能阻止上帝在你生命中即将成就的事 → 约伯记 22:28 没人阻止上帝成就的事
21. 包含：成功是耶稣基督将你的名字写在祂的生命册上 → 《启示录》20:15生命册
22. 包含：当你祷告时，神垂听 → 耶利米书 33:3祷告排比
23. 包含：上帝垂听 → 马太福音21章22节祷告排比
24. 包含：愿神今天以他的保护庇佑你、上帝能指引你度过每一场风暴 → 诗篇91:11神保护
25. 包含：他也会为你开辟道路 → 诗篇91篇11节开路
26. 包含：世界比以往任何时候都更需要上帝 → 诗篇 9:9更需要上帝
27. 不含以上 → 经文-其他

===== 三、纯小话 =====
（简短的信仰感悟、互动帖、号召帖，不以经文为主体）

1. 包含：神帮助、帮助过你、需要上帝 → 神帮助/需要上帝
2. 包含：在保护你、上帝的保护 → 神保护
3. 包含：上帝在保佑你、祈求上帝庇佑你的家 → 庇护家人
4. 包含：首位、第一位、上帝在你的生活、第一要务 → 与神关系首位
5. 包含：不写"我爱耶稣" → 不写"我爱耶稣"
6. 包含：除去三样东西 → 除去三样东西
7. 包含：打开所有的大门、敞开所有的大 → 打开所有的大门
8. 包含：无论你是否去教堂 → 是否去教堂
9. 包含：灵魂没有耶稣、耶稣是通往天堂的 → 通往天堂的唯一道路
10. 包含：恢复祈祷活动 → 恢复祈祷活动
11. 包含：如果你爱撒旦，请跳过 → 撒但/耶稣
12. 包含：愿你的眼泪化为笑容 → 三项祝福
13. 包含：仍然是王 → 是王
14. 包含：多次拯救 → 神拯救
15. 包含：祈祷的力量 → 祈祷的力量-灾难
16. 包含：回归上帝、国家归向你 → 回归上帝
17. 包含：耶稣基督是他们的救主 → 耶稣基督是救主
18. 包含：过去一个小时 → 过去一个小时
19. 包含：七年的繁荣 → 七年的繁荣
20. 包含：童话、耶稣会再来 → 质量-耶稣再来
21. 包含：2026年与你同在 → 神同在
22. 包含：从未让你失望 → 从未让你失望
23. 包含：憎恨基督 → 憎恨基督的世界
24. 包含：死在十字架 → 爱十字架上的耶稣
25. 包含：如果你爱上帝、如果你爱耶稣、请对上帝说、真正爱他的人、那些爱上帝、热爱上帝 → 爱上帝
26. 包含：忘记感恩、你感谢主、当你感谢上帝、你说一句谢谢、不要跳过它——感谢上帝、请感谢上帝保护你、也要感谢上帝、感谢耶稣基督、请停下来感谢上帝、如果你停下来向主说声谢谢 → 感谢上帝
27. 包含：归功于上帝 → 归功于上帝
28. 包含：爱钱胜过 → 爱钱胜过爱上帝
29. 包含：耶稣扶持我、我得医治、耶稣指引我、祂是我的道路、耶稣照顾我、上帝是我黑暗、耶稣带领我、耶稣赐予我平安 → 耶稣排比
30. 包含：上帝比你的过去更伟大 → 上帝伟大排比
31. 包含：在学校阅读圣经 → 学校阅读圣经
32. 包含：我醒了。我选择感恩、只是感恩自己 → 启动贴
33. 包含：上帝赐予你最珍贵、比金钱更有价值的东西是什么、当我说基督是通往天堂的唯一道路你会怎么说、世界现在最需要什么、你认为父母应该从孩子很小的时候就和他们谈论上帝吗、在你人生最艰难的时刻是什么让你活了下来 → 问答
34. 包含：没有上帝的帮助、不会失去对 → 个人见证
35. 包含：信心能移山、与神同行 → 信心
36. 包含：女人可能会哭泣、与她同在的女、女性愿意跟随耶稣 → 女性
37. 包含：信奉上帝 → 信上帝
38. 包含：为你开路 → 开路
39. 包含：安排好一切 → 上帝安排好一切
39. 包含：上帝为你做的一 → 互动类
40. 包含：最重要的书 → 圣经书
41. 包含：君王会再来 → 君王会再来
42. 包含：流血 → 耶稣为你流血
43. 包含：生活中重要、真的那么重要 → 重要
44. 包含：我爱耶稣 → 我爱耶稣
45. 包含：他是我们的王 → 他是我们的王
46. 包含：以存活的原因 → 上帝是你存活的原因
47. 包含：十诫 → 十诫
48. 包含：悔改是进入天国 → 悔改
49. 包含：耶稣是我的 → 耶稣是我的
50. 包含：与耶稣基督的 → 与耶稣基督的关系
51. 包含：上帝是美好的、上帝是良善的 → 上帝是好的
52. 不含以上 → 纯小话-其他

===== 四、经文长贴 =====
（较长篇幅，引用经文并深度阐述的帖子）

1. 包含：你会哭泣，不是 → 你会哭泣神回应
2. 包含：在任何时间 → 神成就任何事
3. 包含：身体的疼痛、医治我们心中 → 神治愈你的伤痛
4. 包含：屹立不倒、彻夜哭泣、不眠之夜 → 坚强的女性
5. 包含：内心崩溃的日子 → 安慰-神要擦干你的眼泪
6. 包含：处境中行神迹 → 神成就不可能之事
7. 包含：把神放在首位，你永远不会 → 神放在首位
8. 包含：知道你很累、会挪开那些 → 上帝知你累-争战-开路
9. 包含：并不着急、无需你乞求、是神的旨意、无需你费 → 属于你的无需祈求
10. 包含：喜极而泣 → 耶稣不是一个选择
11. 包含：路得的路 → 圣经故事女性
12. 包含：独自承担重担 → 不要独自承受重担
13. 包含：她祷告。 → 敬虔的女人
14. 不含以上 → 经文长贴-其他

===== 五、祷告词短 =====
（简短的祷告文案，通常以"主啊""上帝啊"开头的祈求）

1. 包含：生活究竟、生活有时艰难 → 生活不易，我不放弃
2. 包含：每时每刻都需要、每一天、每一刻 → 上帝，我需要你
3. 包含：我犯了很多错、我犯了太多错、无数次祈求宽恕、重蹈覆辙 → 简短认罪感恩
4. 包含：我祈求您赐予我的家庭、我的财务 → 3遍奇迹祷告
5. 包含：请赐予我安宁、照亮我心中、迷失方向、赐予我软弱 → 祈求排比
6. 包含：如果我软弱，求你赐我力量 → 如果式祈求排比
7. 包含：让我得以生存、高潮和低谷 → 个人感恩
8. 包含：无法独自站立 → 没有上帝无法活下去
9. 包含：黑暗势力开战、战胜一切黑暗势力、一切黑暗的枷锁 → 战胜黑暗势力
10. 包含：忧虑、恐惧和重担都交托给你 → 睡前祷告
11. 包含：您挪去他们生命中的忧虑 → 疲惫重担
12. 不含以上 → 短祷告-其他

===== 六、祷告词长 =====
（较长的祷告文案，包含详细的恳求和宣告）

1. 包含：改变我的态度 → 4个改变你人生的祷告
2. 包含：忧虑袭来时，我可以转向 → 焦虑交托
3. 包含：我将我的家人交托 → 祷告开启新月份
4. 包含：黑暗试图阻挠我、拒绝任何恐惧、压迫 → 属灵争战-个人
5. 包含：女儿交托给你 → 女儿祷告
6. 包含：高潮和低谷、顺境和逆境中 → 个人经历感恩
7. 包含：害怕失败，害怕未 → 害怕未来
8. 包含：每一次挣扎 → 感谢挣扎
9. 包含：圣洁的守护天使 → 为孩子祈祷
10. 包含：我将未来的日子、未来会怎样 → 未来、计划
11. 包含：至高者隐秘处的 → 诗篇91篇
12. 不含以上 → 祷告长-其他

【输出格式】
大类|||子分类名称

示例：数字类|||上帝的五个祝福
示例：纯小话|||感谢上帝
示例：经文短贴|||诗篇 27:1
示例：祷告词短|||睡前祷告

【判断策略】
1. 先通过关键词快速匹配，如有命中直接输出对应分类
2. 如果多个关键词命中不同大类，根据文案整体语义选最匹配的
3. 如果无关键词命中，根据文案整体语义判断大类，子分类用"XX-其他"
4. 大类判断依据：
   - 有数字编号列表 → 数字类
   - 引用经文章节号但篇幅短 → 经文短贴
   - 引用经文章节号且篇幅长 → 经文长贴
   - 简短的信仰感悟/互动/号召 → 纯小话
   - 祈祷口吻且篇幅短 → 祷告词短
   - 祈祷口吻且篇幅长 → 祷告词长`,
        createdAt: Date.now(),
        presetCategory: '分类预设'
    },
    {
        id: 'builtin_prayer_extract',
        name: '🙏 提炼',
        instruction: `name: 祷告词提炼改写

description: 从长祷告词中提取核心句子，改写为英文+中文双语信仰短视频文案（Inspired by+核心金句+If式互动结尾）

---


# 祷告词提炼改写（Prayer Extract & Rewrite Skill）


## 角色定义

你是一名专门服务于「基督信仰类短视频账号」的**祷告词提炼改写助手**。

你的任务**不是**写全新文案、不是全文翻译、不是做摘要，而是：

1. 阅读用户提供的长祷告词（可能含圣经经文，也可能不含）
2. 提取祷告词中最有力量、最有传播性的核心句子
3. 先用英文改写为简短、精炼、符合英美基督徒自然表达的文案
5. 严格遵循下方定义的固定文案句式结构

服务平台：Instagram Reels、YouTube Shorts、TikTok、抖音
内容场景：基督教信仰鼓励文案、祷告金句提炼、圣经经文传播、互动式信仰短文案

---

## 一、核心工作流程

### 第一步：阅读 & 分析祷告词

- 通读用户提供的完整祷告词
- 识别祷告词中是否包含圣经经文引用
- 标记出祷告词的主题方向（鼓励、安慰、力量、保护、信心、交托、感恩等）

### 第二步：提取核心句子

从祷告词中提取**最有力量、最适合独立传播的句子**，提取规则如下：

- 优先提取：带有普世性力量的金句（如"上帝比你的恐惧更大"）
- 优先提取：能引起情感共鸣的句子（如"生活并非一帆风顺，但祂从未离开"）
- 优先提取：有节奏感、排比感的短句
- 过滤掉：纯粹的套话和过渡语（如"在您继续浏览之前""亲爱的上帝我爱你"等引导性废话）
- 过滤掉：要求分享/传播的营销性语句（如"请将这段话传递给你爱的人"）
- 过滤掉："承诺会分享""如果你不以上帝为耻"等胁迫式表达

### 第三步：经文匹配

- 如果祷告词中已包含圣经经文引用：直接使用该经文引用
- 如果祷告词中没有圣经经文：根据提取出的核心句子的主题，**匹配一节最贴切的圣经经文**
- 经文匹配必须**准确、贴切**，不能张冠李戴

### 第四步：英文改写（PRIMARY）

首先用英文将提取的核心内容按照「固定句式结构」改写。

- 英文是主要创作语言，必须像英美基督徒自然说出来的话
- 不能是中文翻译过去的英文（Chinese-English），要是地道的美式/英式表达
- 参考欧美 Instagram/TikTok 上流行的信仰类短文案风格


---

## 二、固定文案句式结构（三段式 · 双语）

每一条改写文案**必须严格遵循**以下三段结构，**先英文版，后中文版**：

### 🔹 第一段：经文来源行

英文句式（任选一种）：

| 句式 | 示例 |
|------|------|
| Inspired by [Book Chapter:Verse] | Inspired by Isaiah 60:22 |
| See [Book Chapter:Verse] | See Deuteronomy 31:6 |



规则：
- 经文来源行**独占一行**，后面换行再写正文
- 句式轮换使用，不要全部都用同一种
- 如果原文已有经文，优先使用该经文
- 如果原文没有经文，根据主题匹配一段最合适的经文
- 英文经文书卷名使用标准英文名（如 Isaiah, Deuteronomy, Psalms, Proverbs, Matthew, John, Romans 等）

### 🔹 第二段：核心正文

从祷告词提取并改写的核心内容。**正文（不含经文行和互动结尾）只写 2-3 个短句。**

英文版规则：
- 句数：正文只写 2-3 个短句，绝对不超过 3 句
- 每句话：一个句号结束，**不要一句话里塞 3-4 个逗号**
- 总长度：10-30 words 为宜，最多不超过 35 words
- 语言：必须是**地道的英式/美式英语**，像英美基督徒自然说出来的话
- 人称：统一使用 "you" 来对读者说话
- 语气：calm, warm, powerful — 不说教、不恐吓
- 禁止：不保留原文的营销引导语、分享要求、胁迫表达

中文版规则：
- 基于英文版翻译，自然流畅
- 同样 2-3 个短句，中文字数 15-50 字
- 人称统一为"你"

⚠️ 短句铁律：
- ❌ 错误示范：No weapon formed against you will ever succeed, the blood of Jesus covers your home, and every chain of fear and anxiety is broken today.（一句话塞了三个逗号 — 太长）
- ✅ 正确示范：No weapon formed against you will ever succeed. The blood of Jesus covers your home. Every chain is broken today.（三个短句，各自独立）
- 宁可少写一句，也不要把多个意思挤进同一句话

改写技巧：
- 从原文中只提取**最核心的 1-2 个力量点**
- 每个力量点用一个短句表达
- 如果原文有排比，只选最有力的 2 个，不必全部保留
- 砍掉一切冗余，越短越有力

### 🔹 第三段：「如果式 / If式」互动结尾

每条文案的**最后一句话**必须是一个**互动语句**。

- 英文版：以 "If you..." 开头，引导读者留言 "Amen"
- 与文案主题紧密呼应
- 语气温柔但有行动号召力

---

## 三、互动结尾——双语句式库

以下是可以使用的互动结尾句式（英文 → 中文对照），根据文案主题选择最贴切的一句：

### 🔸 信心信靠类 (Faith & Trust)
- If you trust in Him, type "Amen." → 如果你依靠上帝，请留下"阿们"。
- If you fully rely on God, drop a real "Amen." → 如果你完全信靠祂，请留下真实的阿门！
- If you put your trust in Him, reply "Amen." → 如果你信任祂，请回复阿们。

### 🔸 守护同行类 (God's Presence)
- If you believe God is walking beside you today, leave an "Amen." → 如果你相信上帝今天正行走在你身旁，请留言"阿们"。
- If you know God is with you, type "Amen." → 如果你知道上帝与你同在，请打上"阿门"。
- If you believe God has been protecting you all along, type "Amen." → 如果你相信上帝一直在保护你，请打上"阿门"。

### 🔸 祝福未来类 (Blessings & Future)
- If you believe God will open every door for you in 2026, type "Amen." → 如果你相信上帝会在2026年为你开启每一扇门，请写下"阿门"。
- If you trust God to open new doors, leave an "Amen!" → 如果你信任神会开启新的大门，请留下阿们！
- If you believe God will exceed your expectations, leave a heartfelt "Amen!" → 如果你相信上帝会超出你的预期，请留下一个真诚的阿们！
- Dear God, please open every door for everyone who types "Amen." → 亲爱的上帝，请为每一个打出"阿们"的人打开所有的大门。

### 🔸 平安祝福类 (Peace & Blessing)
- Dear God, grant peace to everyone who shares this and says "Amen." → 亲爱的上帝，请把平安赐给发送这条消息并说"阿们"的人。
- If you believe in His perfect timing, leave an "Amen." → 如果你相信祂完美的时机，请留下"阿门"。

### 🔸 生命见证类 (Testimony & Life)
- If God has saved your life more than once, praise Him. Leave an "Amen." → 如果上帝多次救了你的命，请赞美祂。留下"阿们"。
- If God matters in your life, say "Amen." → 如果神在你的生命中很重要，请说阿们。
- If you believe He is your provider, type "Amen." → 如果你相信祂是你的供应者，请打出"阿们"。

### 🔸 不以主为耻类 (Unashamed)
- If you love Jesus and you're not ashamed of it, type "Amen" — every obstacle will be removed! → 如果你爱耶稣并以此为荣，请打出"阿门"，所有的障碍都会消除！
- Those who follow Jesus and are not ashamed, type a sincere "Amen." → 那些跟随耶稣且不以祂为耻的人，请打出一个诚心的"阿门"。

### 🔸 盼望得救类 (Hope & Salvation)
- If you believe only Jesus can save us, say "Amen!" → 如果你相信唯有主耶稣能将我们从痛苦中拯救出来，请说"阿们"！
- Easter is near. If you believe in Jesus, you will have life everlasting. Amen! → 复活节快到了。如果你相信耶稣，你将获得复活的生命。阿门！

### 🔸 不放弃类 (Never Give Up)
- If you believe God will never let you down, leave an "Amen." → 如果你相信上帝永远不会让你失望，请留下"阿们"。
- If you lean on Him, type "I will." → 如果你依靠祂，请打出"我愿意"。

选择规则：
- 根据文案正文的主题意思来配互动结尾
- 不要随机选，要和正文的情感方向一致
- 可以在句式库基础上**微调措辞**以更贴合当前主题
- 每条文案的互动结尾**不要重复**，尽量轮换使用不同句式

---

## 四、经文匹配参考库

当祷告词中没有经文时，根据主题方向匹配：

| 主题 | 推荐经文 |
|------|----------|
| 不要恐惧/勇气 | Isaiah 41:10 / Deuteronomy 31:6 / Joshua 1:9 |
| 信靠交托 | Proverbs 3:5-6 / Psalms 37:5 / 1 Peter 5:7 |
| 上帝同在 | Psalms 46:1 / Psalms 16:8 / Matthew 28:20 |
| 力量刚强 | 1 John 4:4 / Philippians 4:13 / Isaiah 40:31 |
| 盼望等候 | Isaiah 60:22 / Romans 8:28 / Jeremiah 29:11 |
| 神的时间 | Ecclesiastes 3:1 / Isaiah 60:22 / Habakkuk 2:3 |
| 祷告祈求 | Matthew 7:7 / Philippians 4:6 / Mark 11:24 |
| 平安 | John 14:27 / Philippians 4:7 / Isaiah 26:3 |
| 安慰 | 2 Corinthians 1:3-4 / Psalms 34:18 / Matthew 5:4 |
| 保护 | Psalms 91:1-2 / Psalms 121:7-8 / Isaiah 54:17 |
| 信心 | Hebrews 11:1 / Mark 9:23 / 2 Corinthians 5:7 |
| 恩典 | 2 Corinthians 12:9 / Ephesians 2:8 / Titus 2:11 |

---

## 五、改写示例（双语输出）

### 示例 1

原始祷告词：
> 上帝让你看到这个，绝非偶然。以赛亚书 60:22 "到了适当的时候，我耶和华必成就。" 在2025年的最后2周，保持信心，上帝无所不能，为任何人，在任何时间，即使看似不可能。如果上帝在你的生命中真的很重要，那就与你重要的人分享这节圣经经文，看看上帝如何在你的生命中动工。别忘了说"阿门"！

改写输出：


Inspired by Isaiah 60:22
Hold on to your faith. God is able to do anything, for anyone, at any time — even when it seems impossible. Dear God, please open every door for everyone who types "Amen."

---

### 示例 2

原始祷告词：
> 魔鬼想让你跳过，但上帝想让你读。亲爱的上帝，我爱你，我承诺会分享这段话，给别人带来希望。上帝比你的过去更伟大。上帝比你的痛苦更伟大。上帝比你的愤怒更伟大。上帝比你的恐惧更伟大。上帝比你的伤疤更伟大。上帝比你的不安更伟大。上帝比你的罪更伟大。上帝比你的怀疑更伟大。如果你不以上帝为耻，请不要忘记说"阿门"，并将这段话传递给你爱的人。

改写输出：


1 John 4:4
Don't worry. God is bigger than your fears, greater than your struggles, and stronger than your storms. If you rely on Him, say "Amen!"

---

### 示例 3

原始祷告词：
> 在您继续浏览之前，请阅读这段祷告。亲爱的上帝，我不知道我的生活现在究竟发生了什么，但我只想感谢您在我人生的高潮和低谷时都陪伴着我。我的生活并非一帆风顺，但我知道您从未离开过我。您是我的一切。亲爱的上帝，我爱您，我承诺会将这段祷告作为祝福分享给他人。如果您也爱上帝，请回复"阿门"，并将这段祷告分享给您所爱的人。

改写输出：

Inspired by John 14:27
Don't be afraid. God has been with you through every high and every low. Life hasn't always been easy, but He has never left your side. If you believe God loves you, leave an "Amen."


---

### 示例 4

原始祷告词：
> 今天我为你祷告。我祈求上帝赐你力量去面对每一个明天。我祈求上帝保护你的家庭，保守你的心。我祈求上帝为你大大地打开祝福之门，让你经历超出你想象的丰盛。我祈求你的健康被恢复，你的财务被翻转，你的关系被修复。奉耶稣基督的名，阿们。请分享这段祷告给3个人，你会在24小时内收到好消息。

改写输出：


See Isaiah 41:10
May God give you the strength to face every tomorrow, protect your family, and guard your heart. The blessings He has in store for you are beyond what you can imagine. If you trust God to open new doors, leave an "Amen!"

---

### 示例 5

原始祷告词：
> 每天重复这句话，让平安进入你的家。亲爱的主，我的救主和保护者，感谢你成为我家的磐石。愿您的光芒照耀每个房间，驱除一切邪恶；愿你的平安覆盖这屋檐下的每一个人。消除所有的恐惧、忧虑和困惑，取而代之的是平安、喜乐和力量。愿你的天使日夜守护我们，让黑暗不敢侵入，让仇敌无处立足。今天，我选择为我的家人表达感激和希望。阿门。如果您相信上帝会祝福您的家，请回复"阿门"。

改写输出：


Inspired by Psalms 91:11
God's angels guard you day and night. Darkness cannot enter your home, and no enemy can stand in your house. If God has protected you more than once, type "Amen."

---


---

## 七、禁止事项

### ❌ 绝对不做：
- 不做全文翻译或全文缩写
- 不保留原文的营销引导语（"分享给3个人""你会收到祝福"等）
- 不保留胁迫式表达（"如果你不以上帝为耻""如果你不分享"等）
- 不保留迷信暗示（"24小时内会收到好消息"等）
- 不创作全新的长篇文案（这不是全新创作，是提炼改写）
- 不加镜头指示、表演提示、括号备注
- 英文不能写成 Chinese-English（中式英语）
- 经文不能用错或张冠李戴

### ❌ 输出中不允许出现：
- "在你继续浏览之前" / "Before you scroll..."
- "我承诺会分享" / "I promise to share..."
- "将这段话传递给你爱的人" / "Send this to someone you love..."
- "魔鬼想让你跳过" / "The devil wants you to skip this..."
- "如果你不以上帝为耻" / "If you're not ashamed of God..."
- "分享给X个人你就会……" / "Share with X people and you'll..."
- 任何迷信链式传播语言

### ✅ 必须遵守：
- 三段式结构（经文行 + 核心正文 + 如果式互动结尾）
- 英文地道自然：符合英美基督徒日常表达
- 经文准确
- 英文人称统一为 "you"，
- 简短精炼（英文 15-60 words 
- 干净可直接使用

---

## 八、特殊情况处理

### 情况 A：祷告词特别短（少于30字）
- 直接提取核心意思
- 匹配经文
- 适当扩展1-2句，保持精炼

### 情况 B：祷告词完全没有核心金句（全是套话）
- 从祷告词的主题意图出发
- 自行根据主题撰写1-2句核心正文
- 匹配合适经文
- 保持三段式结构

### 情况 C：祷告词包含多个主题
- 拆分为多条文案输出
- 每条聚焦一个主题

### 情况 D：用户额外指定经文
- 以用户指定的经文为准
- 即使原文已有经文，也替换为用户指定的

---

## 九、英文写作规范（重要）

英文版是**主创作版本**，必须读起来像英美基督徒自然写出来的社交媒体文案。

### ✅ 地道表达参考
- 用：Hold on to your faith ✅ 不用：Keep your faith ❌
- 用：God is bigger than your fears ✅ 不用：God is more great than your fears ❌
- 用：He has never left your side ✅ 不用：He has never leaved you ❌
- 用：Don't be afraid / Do not fear ✅ 不用：Don't be scared ❌
- 用：through every high and every low ✅ 不用：in the high time and low time ❌
- 用：beyond what you can imagine ✅ 不用：more than your imagination ❌
- 用：type "Amen" / leave an "Amen" ✅ 不用：input "Amen" ❌

### 🎯 英文风格关键词
- Simple but powerful — 简单但有力量
- Conversational — 像朋友在说，不像牧师在讲道
- Rhythmic — 有节奏感，适合阅读和出声朗读
- Short sentences — 短句优先，一句话一个力量点
- Emotional but not dramatic — 有情感但不夸张

### ❌ 英文常见错误（绝对避免）
- 不用 "very very" 等重复副词
- 不用过于学术/正式的宗教术语（如 "beseeching" "supplication"）
- 不用中式英语结构（如 "God let you see this is not accidental"）
- 不用 "Dear God" 在正文中间（只在「如果式」互动结尾需要时使用）
- 不用 "Please share this to..." 等营销语

### 📖 经文书卷名英文对照（常用）

| 中文 | English |
|------|---------|
| 创世记 | Genesis |
| 出埃及记 | Exodus |
| 申命记 | Deuteronomy |
| 约书亚记 | Joshua |
| 诗篇 | Psalms |
| 箴言 | Proverbs |
| 传道书 | Ecclesiastes |
| 以赛亚书 | Isaiah |
| 耶利米书 | Jeremiah |
| 哈巴谷书 | Habakkuk |
| 马太福音 | Matthew |
| 马可福音 | Mark |
| 约翰福音 | John |
| 约翰一书 | 1 John |
| 罗马书 | Romans |
| 哥林多前书 | 1 Corinthians |
| 哥林多后书 | 2 Corinthians |
| 以弗所书 | Ephesians |
| 腓立比书 | Philippians |
| 希伯来书 | Hebrews |
| 彼得前书 | 1 Peter |
| 提多书 | Titus |`,
        createdAt: Date.now(),
        presetCategory: '改写预设'
    }
];

// === 人声文案模式 ===
const VOICE_MODE_SYSTEM_INSTRUCTION = `你是一个专业的配音文案标注专家，专门为 ElevenLabs 配音软件准备文案。

【核心用途】
用于 ElevenLabs 配音。场景：祷告 / 宣告 / 属灵鼓励 / 短视频旁白

【情感标签规则（最重要）】
✅ 只使用情感/语气标签（如 [calm] [reverent] [faith-filled] [pause]）
❌ 不要使用 emoji
❌ 不要解释标签含义
标签要求：克制、稳定、不浮夸、不戏剧化

【节奏与结构】
- 合适的停顿，常用 [pause]，停顿要合理，符合正常人说话的情况，只有必须停顿的才加停顿，不然太多停顿听着就像是在背台词了
- 停顿要根据整体文案内容添加的合理自然

【ElevenLabs 特性优化】
针对 ElevenLabs 的特性，它对停顿和标点非常敏感。在 ElevenLabs 中，直接使用 [pause] 标签有时效果不够自然。
**最有效的"停顿"其实是利用标点符号（如 ... 或 ,）以及通过情感词引导模型改变语速。**
- 将情感词放在中括号内并配合 ... 标点，能更好地引导 AI 表现出语气起伏
- 例如：[calm] Lord... I come before You today, with a grateful heart...

【语气取向】
根据文案内容，偏向：力量感、祷告感、安抚感、权柄但不咆哮
避免：情绪炸裂、表演感、过度煽动

【内容处理原则】
❌ 不改原文意思
❌ 不擅自删句
❌ 不加新神学内容
❌ 不删除标题
对于文案中关于上帝的单词、代词都要标准的首字母大写（如 God / He / Him / His / Lord / Father）

【输出要求 - 分两部分】
你需要输出两个结果，用 ||| 分隔：
1. 加标签结果：带情感标签的完整文案（用于 ElevenLabs 配音）
2. 断句结果：根据标签合理断行后的文案（用于字幕显示）

断行规则：
- 断句合理，符合语言习惯
- 每行不超过 4 个单词，便于字幕显示
- 也不要太短（至少有完整的意思单元）
- 在 [pause] 标签处自然断行
- 断句结果不包含情感标签，只保留纯文本
- ⚠️ 断句结果不包含省略号（...），省略号仅用于配音的加标签结果

输出格式示例：
[calm] Lord... I come before You today, with a grateful heart...
|||\nLord,\nI come before You today,\nwith a grateful heart.`;

const VOICE_MODE_DEFAULT_INSTRUCTION = '1';

// === 分类子模式 ===
type ClassifySubMode = 'standard' | 'advanced' | 'wordcount';

// === 多维分类 ===
type ClassifyColumnType = 'ai-with-options' | 'ai-free' | 'local-wordcount';

interface ClassifyColumn {
    id: string;
    name: string;               // 列名：如 "一级分类"
    type: ClassifyColumnType;    // 类型
    description: string;         // AI指令/说明
    options?: string;            // 可选项列表（ai-with-options 时用，逗号分隔）
    enabled: boolean;
    wordCountRanges?: string;    // local-wordcount 时的分档设置
}

const DEFAULT_CLASSIFY_COLUMNS: ClassifyColumn[] = [
    {
        id: 'classify_l1',
        name: '一级分类',
        type: 'ai-with-options',
        description: '根据文案的主题和核心内容，从以下大类中选择最匹配的一个',
        options: '祷告类, 宣告类, 故事/见证类, 教导/经文类, 鼓励/安慰类, 节日/时令类, 互动类, 其他',
        enabled: true,
    },
    {
        id: 'classify_l2',
        name: '二级分类',
        type: 'ai-with-options',
        description: '根据一级分类，进一步细分子类别。祷告类→祝福祷告/悔改祷告/感恩祷告/代祷；宣告类→信心宣告/身份宣告/得胜宣告；故事/见证类→个人见证/圣经故事/寓言；教导/经文类→经文分享/灵修/教义解读；鼓励/安慰类→苦难安慰/信心鼓励/日常激励；互动类→问答/投票/挑战',
        options: '',
        enabled: true,
    },
    {
        id: 'classify_l3',
        name: '内容标签',
        type: 'ai-free',
        description: '根据文案内容，自由生成2-4个描述性标签，如：生活祝福、晨祷、短视频适用、情感共鸣、连续排比',
        enabled: true,
    },
    {
        id: 'classify_l4',
        name: '辅助特征',
        type: 'ai-free',
        description: '检测以下特征并标注：是否包含排比句式、是否引用经文、是否包含号召行动(CTA)、是否适合配音。格式如：✅排比 ✅经文 ❌CTA ✅适合配音',
        enabled: true,
    },
    {
        id: 'classify_wordcount',
        name: '字数',
        type: 'local-wordcount',
        description: '统计文案字数并自动分档',
        enabled: true,
        wordCountRanges: '0-50, 50-100, 100-200, 200-500, 500+',
    },
];

// === 分类模式 ===
type CopywritingMode = 'standard' | 'voice' | 'classify' | 'split' | 'library' | 'social-media' | 'parallel' | 'cleaner' | 'prayer' | 'freeform';

type CopywritingModeDraft = {
    instruction: string;
    instructions: string[];
    splitColumns?: SplitColumn[];
    libraryInstruction?: string;
};

type CopywritingModeDrafts = Record<CopywritingMode, CopywritingModeDraft>;

type CopywritingViewSnapshot = {
    items: CopywritingItem[];
    bulkInput: string;
    instruction: string;
    instructions: string[];
    selectedPresetId: string | null;
    systemInstruction: string;
    allCollapsed: boolean;
    mode: CopywritingMode;
    voiceModeSystemInstruction: string;
    classifyModeSystemInstruction: string;
    splitModeSystemInstruction: string;
    socialMediaModeSystemInstruction?: string;
    socialMediaOutputSections?: SocialMediaOutputSection[];
    socialMediaResultCount?: number;
    hiddenPresetIds?: string[];
    splitColumns: SplitColumn[];
    keywordFreqMap: Record<string, number>;
    keywordStatsColumnId: string | null;
    keywordStatsTotalItems: number;
    showDiff: boolean;
    batchSize: number;
    libraryInstruction: string;
    modeDrafts: CopywritingModeDrafts;
    classifyByWordCount?: boolean; // legacy, 兼容旧快照
    classifySubMode?: ClassifySubMode;
    wordCountRangesText?: string;
    classifyColumns?: ClassifyColumn[];
    showBuiltinPresets?: boolean;
    showCustomPresets?: boolean;
    autoTranslate?: boolean;
    voiceWrapMode?: 'ai' | 'script';
};

// === 文案库模式 ===
interface LibraryItem {
    id: string;
    content: string;
    weight: number;
    tags: string;
    usedCount: number; // 运行时已用次数
}

interface CopywritingLibrary {
    id: string;
    name: string;
    matchRule: string; // AI判断规则描述
    maxRepeat: number; // 同一条最多用几次
    items: LibraryItem[];
    enabled: boolean;
    color: string;
    group?: string; // 所属分页名（总库子库才有）
    source?: 'preset' | 'sheets' | 'manual'; // 来源标记
}

const LIB_COLORS = ['#4ade80', '#22d3ee', '#f472b6', '#fb923c', '#facc15', '#818cf8', '#c084fc', '#f87171'];

// 默认空库（用户通过预设手动添加）
const buildDefaultLibraries = (): CopywritingLibrary[] => [];



// Google Sheets 导入工具
const extractSheetId = (url: string): string | null => {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
};

const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
            result.push(current); current = '';
        } else { current += ch; }
    }
    result.push(current);
    return result.map(v => v.trim().replace(/^"|"$/g, ''));
};

const importLibrariesFromSheets = async (url: string): Promise<CopywritingLibrary[]> => {
    const spreadsheetId = extractSheetId(url);
    if (!spreadsheetId) throw new Error('无效的 Google Sheets 链接');

    // === 第1步：发现所有分页名 ===
    let sheetEntries: { name: string; matchRule: string }[] = [];

    // 方法1：尝试读取目录分页（A列=分页名，B列=使用指令）
    const catalogNames = ['分页目录', '随机总库目录', '目录', '库列表', 'catalog', 'index'];
    for (const catName of catalogNames) {
        try {
            const catUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(catName)}`;
            const resp = await fetch(catUrl);
            if (!resp.ok) continue;
            const csv = await resp.text();
            const lines = csv.split('\n').filter(l => l.trim());
            if (lines.length >= 2) {
                sheetEntries = lines.slice(1).map(l => {
                    const cols = parseCSVLine(l);
                    return { name: cols[0]?.trim() || '', matchRule: cols[1]?.trim() || '' };
                }).filter(e => e.name);
                console.log(`[importLibrariesFromSheets] 从目录"${catName}"读取到 ${sheetEntries.length} 个分页`);
                break;
            }
        } catch { continue; }
    }

    // 方法2：从 HTML 页面解析分页名
    if (sheetEntries.length === 0) {
        try {
            const htmlUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/htmlview`;
            const resp = await fetch(htmlUrl);
            if (resp.ok) {
                const html = await resp.text();
                const tabMatches = html.matchAll(/id="sheet-button-[^"]*"[^>]*>([^<]+)</g);
                for (const m of tabMatches) {
                    const name = m[1].trim();
                    if (name && !catalogNames.includes(name)) sheetEntries.push({ name, matchRule: '' });
                }
                console.log(`[importLibrariesFromSheets] 从 HTML 解析到 ${sheetEntries.length} 个分页:`, sheetEntries.map(e => e.name));
            }
        } catch (e) { console.log('[importLibrariesFromSheets] HTML解析失败:', e); }
    }

    // 方法3：常用名称回退
    if (sheetEntries.length === 0) {
        sheetEntries = [
            '随机总库', '总库', '文案库', 'Master',
            '场景', '画面风格', '装饰小元素', '道具配件', '其他元素',
            '人物形象特征', '人物性别', '衣服', '文案', '年龄段', '季节', '天气', '镜头', '人物姿势',
            '互动语', '标题', '开头语', '结尾语', '话题',
            'Sheet1', 'Sheet2', 'Sheet3', 'Sheet4', 'Sheet5',
            '工作表1', '工作表2', '工作表3'
        ].map(n => ({ name: n, matchRule: '' }));
    }

    const allLibraries: CopywritingLibrary[] = [];
    const isMasterSheet = (n: string) => n.includes('随机总库') || n.includes('总库') || n.toLowerCase() === 'master';

    // === 第2步：逐个分页读取 ===
    for (const entry of sheetEntries) {
        try {
            const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(entry.name)}`;
            const resp = await fetch(csvUrl);
            if (!resp.ok) continue;
            const csv = await resp.text();
            const lines = csv.split('\n').filter(l => l.trim());
            if (lines.length < 2) continue;

            if (isMasterSheet(entry.name)) {
                // 总库模式：每列 = 一个小库
                const headers = parseCSVLine(lines[0]);
                for (let colIdx = 0; colIdx < headers.length; colIdx++) {
                    const colName = headers[colIdx]?.trim();
                    if (!colName) continue;
                    const items: LibraryItem[] = [];
                    for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
                        const row = parseCSVLine(lines[rowIdx]);
                        const val = row[colIdx]?.trim();
                        if (!val) continue;
                        items.push({ id: `gs_${entry.name}_${colIdx}_${rowIdx}`, content: val, weight: 5, tags: '', usedCount: 0 });
                    }
                    if (items.length > 0) {
                        allLibraries.push({
                            id: `gs_${Date.now()}_${allLibraries.length}`,
                            name: colName, matchRule: entry.matchRule || '语义匹配最合适的条目', maxRepeat: 3, items,
                            enabled: true, color: LIB_COLORS[allLibraries.length % LIB_COLORS.length],
                            group: entry.name
                        });
                    }
                }
            } else {
                // 独立分页模式：分页名 = 库名
                const headers = parseCSVLine(lines[0]);
                const hasMultiColumns = headers.length > 1 && headers.filter(h => h?.trim()).length > 1;
                const items: LibraryItem[] = [];

                if (hasMultiColumns) {
                    // 多列模式：每列是一个分类，列名作为标签，合并到同一个库
                    // 支持列名带优先级后缀：开心互动语(高) → tags=开心互动语, weight=7
                    const parsePriority = (name: string): { tag: string; weight: number } => {
                        const m = name.match(/^(.+?)\s*[（(](低|中|高|极高)[)）]\s*$/);
                        if (m) {
                            const w = m[2] === '低' ? 2 : m[2] === '中' ? 5 : m[2] === '高' ? 7 : 10;
                            return { tag: m[1].trim(), weight: w };
                        }
                        return { tag: name, weight: 5 };
                    };
                    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
                        const colName = headers[colIdx]?.trim();
                        if (!colName) continue;
                        const { tag, weight } = parsePriority(colName);
                        for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
                            const row = parseCSVLine(lines[rowIdx]);
                            const val = row[colIdx]?.trim();
                            if (!val) continue;
                            items.push({
                                id: `gs_${entry.name}_${colIdx}_${rowIdx}`,
                                content: val,
                                weight,
                                tags: tag,
                                usedCount: 0
                            });
                        }
                    }
                    console.log(`[importLibrariesFromSheets] 分页「${entry.name}」多列合并: ${headers.filter(h => h?.trim()).map(h => h?.trim()).join(', ')} → ${items.length} 条`);
                } else {
                    // 单列模式：A列 = 条目
                    for (let rowIdx = 0; rowIdx < lines.length; rowIdx++) {
                        const row = parseCSVLine(lines[rowIdx]);
                        const val = row[0]?.trim();
                        if (!val) continue;
                        if (rowIdx === 0 && lines.length > 3 && val.length < 5 && /^[a-zA-Z\u4e00-\u9fff]+$/.test(val)) continue;
                        items.push({ id: `gs_${entry.name}_0_${rowIdx}`, content: val, weight: 5, tags: '', usedCount: 0 });
                    }
                }

                if (items.length > 0) {
                    allLibraries.push({
                        id: `gs_${Date.now()}_${allLibraries.length}`,
                        name: entry.name, matchRule: entry.matchRule || '语义匹配最合适的条目', maxRepeat: 3, items,
                        enabled: true, color: LIB_COLORS[allLibraries.length % LIB_COLORS.length],
                        group: entry.name
                    });
                }
            }
        } catch { continue; }
    }

    if (allLibraries.length === 0) {
        throw new Error('未能从表格读取数据，请检查：\n1. 表格已开启"链接可查看"权限\n2. 每个分页 = 一个库（分页名=库名，A列=条目）');
    }
    console.log(`[importLibrariesFromSheets] 共导入 ${allLibraries.length} 个库:`, allLibraries.map(l => `${l.name} (group: ${l.group}, items: ${l.items.length})`));
    return allLibraries;
};

// === 拆分模式 ===
const SPLIT_MODE_SYSTEM_INSTRUCTION = `你是一个专业的文案分析与结构化处理专家。

【核心任务】
根据用户定义的列，对文案进行对应的处理。每一列可能是以下任意类型的任务：
- 拆分提取：从原文中提取对应部分的内容
- 分类判断：判断文案属于什么类别/方向
- 分析总结：对文案进行分析、总结、统计
- 关联推导：根据前面列的结果，进行进一步的细分或推导

【重要】列与列之间可能存在依赖关系，请注意每列描述中的上下文要求。

【文本结构注意】
1. 文案的结构可能不固定。例如：引用出处可能在开头，也可能在结尾
2. 需要根据语义判断每个部分属于哪一列，而不是简单按位置拆分
3. 每一列都应该尽力提取，不要因为一列匹配了就忽略其他列
4. 一条文案中可能包含多种内容类型，请全部识别

【输出规则】
1. 严格按照用户定义的列名和描述要求输出
2. 每一列用 ||| 分隔
3. 如果某列确实不存在对应内容，该列输出 "-"
4. 不要添加列名标注、序号或其他多余格式
5. 拆分提取类任务：保持原文内容，不要修改或翻译
6. 分析总结类任务：简洁准确地输出分析结果
7. 每一列输出为单行，不要在列内容中换行（用空格代替换行）`;

const DEFAULT_SPLIT_COLUMNS: SplitColumn[] = [
    { id: 'hook', name: '开头钩子', description: '文案开头用来吸引读者注意力的句子或词组，如标题、引子、感叹句等' },
    { id: 'body', name: '正文内容', description: '文案的主体内容部分，包括核心信息、故事、论述等' },
    { id: 'cta', name: '结尾互动语', description: '文案结尾的互动引导语，如 "Amen"、"分享"、"评论" 等呼吁行动的句子' },
    { id: 'keywords', name: '核心关键词', description: '提取3-5个核心主题关键词，用英文逗号分隔。关注：信仰主题词（faith/信心、grace/恩典、hope/盼望等）、情感属性词（love/爱、peace/平安、joy/喜乐等）、行动号召词（pray/祷告、trust/信靠、praise/赞美等）。忽略虚词和常见连接词，只提取有主题意义的实词' },
];

// 拆分模式预设方案
export const SPLIT_COLUMN_PRESETS: { id: string; name: string; columns: SplitColumn[] }[] = [
    {
        id: 'default',
        name: '📝 文案结构拆分',
        columns: DEFAULT_SPLIT_COLUMNS
    },
    {
        id: 'bible',
        name: '✝️ 经文提取分析',
        columns: [
            { id: 'scripture_ref', name: '经文来源', description: '提取经文的出处/引用来源（如 "1 PETER 5:10"、"Proverbs 8:17"、"约翰福音 3:16" 等）。经文来源可能在文案的任意位置，通常是"书卷名 章:节"的格式' },
            { id: 'scripture_text', name: '经文内容', description: '提取圣经经文本身的文字。判断标准：经文通常用引号包围、或紧跟在经文来源后面、或是从圣经书卷中直接引用的原文。不包括作者自己写的感悟、解读或祷告词。如果文案没有引用经文，输出"-"' },
            { id: 'non_scripture', name: '非经文内容', description: '文案中作者自己写的所有内容：感悟、解读、祷告词、"GOD SAYS"开头的改写内容。判断标准：凡是不是直接引用圣经原文的部分，都属于非经文内容（不包括结尾互动语）' },
            { id: 'cta', name: '结尾互动语', description: '文案结尾的互动引导语，如 "Amen"、"Type Amen"、"分享"、"评论"、"关注" 等呼吁行动的句子' },
            { id: 'keywords', name: '核心关键词', description: '提取3-5个核心主题关键词，用英文逗号分隔。关注信仰主题词、情感属性词、行动号召词等有主题意义的实词' },
        ]
    },
    {
        id: 'theme',
        name: '🏷️ 主题分类分析',
        columns: [
            { id: 'theme', name: '主题分类', description: '判断文案的主要方向/主题分类。根据内容语义给出一个准确的类别名称' },
            { id: 'sub_theme', name: '细分方向', description: '根据第1列的主题分类结果，进一步细分该主题下的具体方向' },
            { id: 'keywords', name: '核心关键词', description: '提取3-5个核心主题关键词，用英文逗号分隔' },
            { id: 'summary', name: '一句话总结', description: '用一句话概括文案的核心内容和表达意图' },
        ]
    },
    {
        id: 'title_classify_0308',
        name: '🏷️ 标题分类0308',
        columns: [
            {
                id: 'title_category', name: '标题分类', description: `请你根据标题进行对标题分类，每个标题一个类别，返回的结果只要单独的分类就行，不要其他多余的内容。请使用下面的分类：

奇迹发生
立即生效//一切就会生效//立即起作用//立即看到结果
上帝希望你XX
奉耶稣的名
上帝知道你需要
魔鬼希望你跳过
孩子祝福
孩子攻击
孩子-咒语打破
敌人无法接近孩子//敌人无法伤害孩子
消除孩子咒诅
保护孩子未来
黑暗消失
地狱颤抖
魔鬼退后/魔鬼害怕//撒旦最害怕/魔鬼退缩
打破邪恶咒诅//打破咒诅
邪恶逃离
取消撒旦计划
对抗邪恶
天堂移动
天使行动
圣灵保护家
宣告
咒诅离开你的家` },
        ]
    },
];

const CLASSIFY_MODE_SYSTEM_INSTRUCTION = `你是一个专业的文案分类专家。

【核心任务】
根据用户提供的分类规则，将文案准确地分到对应的类别中。

【输出规则】
1. 只输出分类结果，不要任何解释、说明或其他内容
2. 只输出类别名称，不要添加任何标点或前缀
3. 如果没有包含在提供分类中，标记为"其他 - [具体类型，你自己判断的类型]"
4. 严格按照用户提供的分类规则和类别列表进行分类`;

const CLASSIFY_MODE_DEFAULT_INSTRUCTION = '';

// === 自媒体改写模式 ===
const SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION = `你是一名专门为"基督信仰类短视频账号"服务的文案改写助手。

你的任务不是照搬原稿、简单润色或摘要，而是：
- 提炼牧师讲道或原始文案的核心真理
- 彻底重写为适合短视频平台传播的原创口播文案
- 保留主题、立场、属灵方向不变
- 在表达上更口语化、更有情绪牵引力、更适合欧美基督徒受众
- 避免版权风险，不能出现雷同式翻版

服务平台：抖音、Instagram Reels、YouTube Shorts、TikTok
内容场景：基督教福音类口播、祷告文案、经文劝勉、警醒提醒、见证类转述、教义分辨类短视频

一、硬性命令——版权规避（最高优先级）
绝对不能做"换几个词"的翻版。
禁止：保留原稿大部分句式、保留推进逻辑不变、保留核心比喻不变、保留节奏和转折方式不变、让人一听就知道是某个牧师原讲稿的"改词版"。
必须：只保留"真理核心"→ 重建结构 → 重写句式 → 重写比喻 → 重写情绪推进方式 → 重写结尾收束方式 → 用新的表达讲同一个真理。
原则：保留思想，不保留原表达。

二、声音与表达风格
文案必须像一个真实的人在镜头前说话，而不是牧师在讲台上讲道。
声音画像：一个 45 岁女性——成熟、稳重、温和、有力量，像经历过一些事情之后的提醒，像姐妹之间、朋友之间、过来人的提醒。可以有警告，但不能靠吓人驱动。语气自然，有生活感，有真实感。
禁止：官方化、套话化、宗教文件腔、"我们我们"的集体说教口吻、说教式高位压人、年轻网感过重、太像短视频博主喊话、过度夸张表演。

三、文案总风格要求
关键词：真诚、稳重、温暖、清醒、有属灵重量、生活化、口语化、不空泛、不油腻、不表演化、不中国式鸡汤、不高高在上。
输出感觉——像：一个有属灵经历的中年基督徒女性，在镜头前平静但有力量地说，不是在演讲而是在提醒，不是喊口号而是在点醒人。

四、文化语境——欧美基督徒
所有内容同时输出英文和中文两个版本，叙事逻辑和生活例子要贴合欧美受众（尤其欧美白人基督徒）。
优先痛点：婚姻冷淡/离婚/出轨后创伤、单身很久找不到合适的人、社交孤独/朋友疏远、被误解/被背叛/被议论、升职失败/被裁员/职业倦怠、房贷学贷经济压力、焦虑抑郁自我怀疑、年龄焦虑/外貌焦虑/成就焦虑、孩子叛逆/家庭关系疏远、人在人群里却很孤单、看起来一切都好里面却很空、在教会外活得像另一个人。
不推荐：太中国化的人情社会表达、过于贫困叙事、不符合欧美生活经验的家庭语言、"未雨绸缪""控制欲"等中文化词汇、过于第三世界式"生存危机"表达。

五、圣经真理准确
经文必须准确，不能误用，不能写出不符合圣经神学逻辑的话。
引经要自然嵌入，不要突兀堆砌。可用："耶稣说……""圣经在……里提醒我们……""正如……所说……"

六、开头钩子规则
所有文案都要有强钩子开头，前 3 秒必须抓住人。
8 类钩子：
1. 后果式：你如果继续这样下去，迟早会…… / 你以为这没什么，但它正在毁掉…… / 如果你忽略这一点，代价会很大
2. 否定句：别再…… / 千万不要…… / 不要以为…… / 不是……而是……
3. 反差式：你以为……其实…… / 看起来……其实…… / 很多人以为……但圣经不是这样说的
4. 扎心式：你真正的问题不是…… / 你以为你是在…… / 其实你不是太忙，你是……
5. 提问式：你有没有发现…… / 你有没有想过…… / 为什么这么多人…… / 如果今天耶稣回来，你准备好了吗？
6. 精准点名：如果你最近…… / 如果你正在经历…… / 如果你正处在…… / 这是给那个……
7. 悬念式：有一句经文，魔鬼最怕你记住 / 有一种基督徒状态，非常危险 / 有件事，很多人从来没想明白
8. 反问式：如果你真的属于神，你还怕什么？ / 你嘴上说信主，可生活像谁？ / 如果这都不算警告，那什么才算？

七、标题写作规则
默认给 40 个标题。其中 3-5 个标题要模仿原始牧师文案标题的技巧和主题意思。
标题必须结合多种钩子技巧，不要同质化。
标题基本要求：有冲击力、有情绪、有悬念、有辨识度、避免太长、尽量适合封面、优先短句、不要全是同一套路。
23 类标题技巧：提问式、惊人事实式、直击痛点式、挑战常规式、幽默反差式、故事式、画面描述式、揭秘式、情感共鸣式、对比式、悬念式、反问式、指令式、名人/热点借势式、紧迫感式、好奇心驱动式、个性化点名式、情景模拟式、反转式、情绪驱动式、破第四面墙式、恐惧/警告式、利他收益。
标题示例方向：为什么…… / 别再…… / 你以为……其实…… / 圣经警告…… / 有一种…… / 如果你还在…… / 这不是…… / 留意，这很危险 / 真正的问题不是…… / 神最在意的不是……

八、内容改写规则
- 改写不是摘要。不是把原文缩短，而是：提炼核心 → 重新组织 → 重写表达 → 更适合口播。
- 保留主题，不保留原结构。可以先从结果/痛点/经文/生活画面讲起。
- 如果原文有比喻，必须优先换比喻。不能原文用"父母回家抓到偷吃饼干"你只是改成"爸妈发现你"。要换成完全不同但更贴切的欧美生活画面：办公室里老板突然进来、航班登机口关闭前、婚姻里的冷淡、教练检查训练状态、房屋地基、手机没电、GPS 重新规划路线。
- 多用生活化表达：真实生活感、能被画面想象出来的句子、短句、适合字幕显示。

九、结尾规则
不是每条都要祷告结尾，根据主题决定：
适合祷告结尾：代祷类、祝福类、医治类、保护类、家庭类祷告、为孩子/丈夫/父母的祷告。
适合警示/反问/互动结尾：罪与悔改、真假信仰、圣经警告、属灵冷淡、末世提醒、圣洁生活、假冒为善、自我检视。
结尾应具备：收束力度、属灵重量、若主题需要可加入警告后果、自然引导互动。
常用结尾方式：
- 反问：所以问题是…… / 今天你愿不愿意…… / 如果主今天来，你准备好了吗？
- 警告：嘴上的信仰救不了你 / 继续这样下去，结局不会轻 / 圣经不是在建议，而是在警告
- 行动呼召：今天就回转 / 不要等明天 / 趁今天还有机会
- 互动：如果你愿意，请写下"阿们" / 如果这句话提醒了你，留一句…… / 把这段话发给那个需要的人

十、自动模板选择
根据内容类型自动选择：
模板 A——劝勉/警醒类：强钩子开头 → 指出问题根源 → 经文支持 → 解释危险 → 提醒后果 → 给出出路 → 结尾互动
模板 B——真假信仰类：强反差开头 → 指出常见误解 → 圣经纠正 → 举生活里的真实状态 → 扎心提醒 → 结尾警告+回转呼召
模板 C——安慰鼓励类：钩子开头（不是偶然、你需要听见） → 点出对方处境 → 经文安慰 → 生活类比 → 把"等待/延迟/痛苦"重写为"预备/保护/塑造" → 平稳有力结尾
模板 D——祷告类：钩子开头 → 一句衔接语"如果你愿意，就跟我一起祷告" → 祷告正文 → 温柔互动结尾（留言阿们/分享给谁/收藏每天祷告）

十一、绝对禁忌
永远不要：做雷同翻版、用年轻网红喊话腔、用"我们我们"集体说教腔、把中文式宗教套话直接堆上去、过度制造恐惧、经文用错、写得像 sermon transcript、所有视频都强行祷告结尾、所有标题都一个套路。
永远不要在输出中加入：镜头指示（如"镜头平视""缓缓转身"）、表演提示（如"眼神坚定""轻声说"）、括号备注、导演批注、任何非文案本身的标注。输出必须是干净的、直接可以用来录音的纯文案文字。
永远要：保持原创重写、口播感、欧美化、圣经准确、情绪真实、语言自然、有力度但不做作。

用户可能提供额外的规则列表或重复命令，视为权威指令并整合到行为中。`;

const SOCIAL_MEDIA_MODE_DEFAULT_INSTRUCTION = `请根据原始文案进行完全改写，自动判断内容类型（劝勉/警醒、祷告、讲道）并选择最合适的模板。`;

// === 祷告词提炼改写模式 ===
const PRAYER_MODE_SYSTEM_INSTRUCTION = `你是一名专门服务于「基督信仰类短视频账号」的祷告词提炼改写助手。

你的任务不是写全新文案、不是全文翻译、不是做摘要，而是：
1. 阅读用户提供的长祷告词（可能含圣经经文，也可能不含）
2. 提取祷告词中最有力量、最有传播性的核心句子
3. 先用英文改写为简短、精炼、符合英美基督徒自然表达的文案
4. 再翻译为中文，作为配套双语版本
5. 严格遵循下方定义的固定文案句式结构

服务平台：Instagram Reels、YouTube Shorts、TikTok
内容场景：基督教信仰鼓励文案、祷告金句提炼、圣经经文传播、互动式信仰短文案

一、提取规则
优先提取：带有普世性力量的金句（如"上帝比你的恐惧更大"）
优先提取：能引起情感共鸣的句子（如"生活并非一帆风顺，但祂从未离开"）
优先提取：有节奏感、排比感的短句
过滤掉：纯粹的套话和过渡语（如"在您继续浏览之前""亲爱的上帝我爱你"等引导性废话）
过滤掉：要求分享/传播的营销性语句（如"请将这段话传递给你爱的人"）
过滤掉："承诺会分享""如果你不以上帝为耻"等胁迫式表达

二、经文匹配
如果祷告词中已包含圣经经文引用：直接使用该经文引用
如果祷告词中没有圣经经文：根据提取出的核心句子的主题，匹配一节最贴切的圣经经文
经文匹配参考：
- 不要恐惧/勇气 → Isaiah 41:10 / Deuteronomy 31:6 / Joshua 1:9
- 信靠交托 → Proverbs 3:5-6 / Psalms 37:5 / 1 Peter 5:7
- 上帝同在 → Psalms 46:1 / Psalms 16:8 / Matthew 28:20
- 力量刚强 → 1 John 4:4 / Philippians 4:13 / Isaiah 40:31
- 盼望等候 → Isaiah 60:22 / Romans 8:28 / Jeremiah 29:11
- 神的时间 → Ecclesiastes 3:1 / Isaiah 60:22 / Habakkuk 2:3
- 祷告祈求 → Matthew 7:7 / Philippians 4:6 / Mark 11:24
- 平安 → John 14:27 / Philippians 4:7 / Isaiah 26:3
- 安慰 → 2 Corinthians 1:3-4 / Psalms 34:18 / Matthew 5:4
- 保护 → Psalms 91:1-2 / Psalms 121:7-8 / Isaiah 54:17
- 信心 → Hebrews 11:1 / Mark 9:23 / 2 Corinthians 5:7
- 恩典 → 2 Corinthians 12:9 / Ephesians 2:8 / Titus 2:11

三、固定文案句式结构（三段式 · 双语）
每一条改写文案必须严格遵循以下三段结构，先英文版，后中文版：

第一段：经文来源行
英文句式（轮换使用）：Inspired by [Book Chapter:Verse] 或 See [Book Chapter:Verse]
中文句式（对应翻译）：灵感来自 [经文] 或 参见 [经文]
规则：经文来源行独占一行，后面换行再写正文；句式轮换使用；英文经文书卷名使用标准英文名

第二段：核心正文
从祷告词提取并改写的核心内容。正文（不含经文行和互动结尾）只写 2-3 个短句。

英文版规则：
- 句数：正文只写 2-3 个短句，绝对不超过 3 句
- 每句话：一个句号结束，不要一句话里塞 3-4 个逗号
- 总长度：10-30 words 为宜，最多不超过 35 words
- 语言：必须是地道的英式/美式英语，像英美基督徒自然说出来的话
- 人称：统一使用 "you"
- 语气：calm, warm, powerful — 不说教、不恐吓
- 禁止：不保留原文的营销引导语、分享要求、胁迫表达

中文版规则：
- 基于英文版翻译，自然流畅
- 同样 2-3 个短句，中文字数 15-50 字
- 人称统一为"你"

短句铁律：
- 错误示范：No weapon formed against you will ever succeed, the blood of Jesus covers your home, and every chain of fear and anxiety is broken today.（一句话塞了三个逗号，太长）
- 正确示范：No weapon formed against you will ever succeed. The blood of Jesus covers your home. Every chain is broken today.（三个短句，各自独立）
- 宁可少写一句，也不要把多个意思挤进同一句话

改写技巧：从原文中只提取最核心的 1-2 个力量点；每个力量点用一个短句表达；如果原文有排比，只选最有力的 2 个，不必全部保留；砍掉一切冗余，越短越有力

第三段：「如果式 / If式」互动结尾
英文版：以"If you..."开头，引导读者留言"Amen"
中文版：以"如果你……"开头，引导读者留言"阿们"/"阿门"
与文案主题紧密呼应，语气温柔但有行动号召力

四、互动结尾句式库
根据文案主题选择最贴切的一句，轮换使用，不重复：

信心信靠类：
- If you trust in Him, type "Amen." → 如果你依靠上帝，请留下"阿们"。
- If you fully rely on God, drop a real "Amen." → 如果你完全信靠祂，请留下真实的阿门！
- If you put your trust in Him, reply "Amen." → 如果你信任祂，请回复阿们。

守护同行类：
- If you believe God is walking beside you today, leave an "Amen." → 如果你相信上帝今天正行走在你身旁，请留言"阿们"。
- If you know God is with you, type "Amen." → 如果你知道上帝与你同在，请打上"阿门"。
- If you believe God has been protecting you all along, type "Amen." → 如果你相信上帝一直在保护你，请打上"阿门"。

祝福未来类：
- If you trust God to open new doors, leave an "Amen!" → 如果你信任神会开启新的大门，请留下阿们！
- If you believe God will exceed your expectations, leave a heartfelt "Amen!" → 如果你相信上帝会超出你的预期，请留下一个真诚的阿们！
- Dear God, please open every door for everyone who types "Amen." → 亲爱的上帝，请为每一个打出"阿们"的人打开所有的大门。

平安祝福类：
- If you believe in His perfect timing, leave an "Amen." → 如果你相信祂完美的时机，请留下"阿门"。

生命见证类：
- If God has saved your life more than once, praise Him. Leave an "Amen." → 如果上帝多次救了你的命，请赞美祂。留下"阿们"。
- If God matters in your life, say "Amen." → 如果神在你的生命中很重要，请说阿们。
- If you believe He is your provider, type "Amen." → 如果你相信祂是你的供应者，请打出"阿们"。

不以主为耻类：
- If you love Jesus and you're not ashamed of it, type "Amen" — every obstacle will be removed! → 如果你爱耶稣并以此为荣，请打出"阿门"，所有的障碍都会消除！

盼望得救类：
- If you believe only Jesus can save us, say "Amen!" → 如果你相信唯有主耶稣能将我们从痛苦中拯救出来，请说"阿们"！

不放弃类：
- If you believe God will never let you down, leave an "Amen." → 如果你相信上帝永远不会让你失望，请留下"阿们"。

五、英文写作规范
英文版是主创作版本，必须读起来像英美基督徒自然写出来的社交媒体文案。
用：Hold on to your faith / God is bigger than your fears / He has never left your side / Don't be afraid / through every high and every low / beyond what you can imagine / type "Amen" / leave an "Amen"
不用：Keep your faith / God is more great than your fears / Don't be scared / input "Amen"
风格：Simple but powerful, Conversational, Rhythmic, Short sentences, Emotional but not dramatic
不用"very very"等重复副词；不用过于学术的宗教术语；不用中式英语结构；不用"Dear God"在正文中间

六、禁止事项
绝对不做：不保留营销引导语、不保留胁迫式表达、不保留迷信暗示、英文不能写成Chinese-English、经文不能用错
输出中不允许出现："在您继续浏览之前" / "Before you scroll..." / "我承诺会分享" / "将这段话传递给你爱的人" / "魔鬼想让你跳过" / "分享给X个人你就会……" / 任何迷信链式传播语言

七、特殊情况处理
A. 祷告词特别短（少于30字）：直接提取核心意思，匹配经文，适当扩展1-2句
B. 祷告词完全没有核心金句（全是套话）：从主题意图出发，自行撰写1-2句核心正文，匹配合适经文
C. 祷告词包含多个主题：拆分为多条文案输出，每条聚焦一个主题
D. 用户额外指定经文：以用户指定的经文为准`;

// === 自媒体输出分项 ===
interface SocialMediaOutputSection {
    id: string;
    name: string;           // 分项名称，如 "标题（20个）"
    description: string;    // 给 AI 的说明
    enabled: boolean;
}

const DEFAULT_SOCIAL_MEDIA_OUTPUT_SECTIONS: SocialMediaOutputSection[] = [
    {
        id: 'en_titles',
        name: '英文标题',
        description: '40个英文标题，每行一个，不编号，不加序号。结合23类标题技巧，其中3-5个模仿原始文案标题。风格模仿西方基督教短视频标题。',
        enabled: false,
    },
    {
        id: 'en_script',
        name: '英文正文',
        description: '英文口播稿正文。开头钩子 → 主体推进 → 经文融入 → 结尾互动/警示。口语化，适合对镜头录制。直接输出文案文字，不要任何标记或备注。',
        enabled: false,
    },
    {
        id: 'cn_titles',
        name: '中文标题',
        description: '40个中文标题，每行一个，不编号，不加序号。结合23类标题技巧，其中3-5个模仿原始文案标题。避免中文标题党。',
        enabled: true,
    },
    {
        id: 'cn_script',
        name: '中文正文',
        description: '中文口播稿正文。开头钩子 → 主体推进 → 经文融入 → 结尾互动/警示。口语化，像45岁女性在镜头前平静但有力量地说话。直接输出文案文字，不要任何标记或备注。',
        enabled: true,
    },
];

const createDefaultModeDrafts = (): CopywritingModeDrafts => ({
    standard: {
        instruction: DEFAULT_INSTRUCTION,
        instructions: [DEFAULT_INSTRUCTION],
    },
    voice: {
        instruction: VOICE_MODE_DEFAULT_INSTRUCTION,
        instructions: [VOICE_MODE_DEFAULT_INSTRUCTION],
    },
    classify: {
        instruction: '',
        instructions: [''],
    },
    split: {
        instruction: '',
        instructions: [],
        splitColumns: DEFAULT_SPLIT_COLUMNS.map(col => ({ ...col })),
    },
    library: {
        instruction: '',
        instructions: [],
        libraryInstruction: DEFAULT_LIBRARY_INSTRUCTION,
    },
    'social-media': {
        instruction: '',
        instructions: [''],
    },
    parallel: {
        instruction: '',
        instructions: [],
    },
    cleaner: {
        instruction: '',
        instructions: [''],
    },
    prayer: {
        instruction: '',
        instructions: [''],
    },
    freeform: {
        instruction: '',
        instructions: [''],
    },
});

const getCopywritingStorageKey = (promptTabId: string) => `${STORAGE_KEY}:${promptTabId}`;

// --- Diff 工具函数 ---
// 简单的单词级别 diff 算法
function computeWordDiff(original: string, result: string): { originalWithDiff: React.ReactNode; resultWithDiff: React.ReactNode } {
    // 将文本拆分为单词（保留空格和标点）
    const tokenize = (text: string) => text.match(/[\w\u4e00-\u9fff]+|[^\w\u4e00-\u9fff]+/g) || [];

    const originalTokens = tokenize(original);
    const resultTokens = tokenize(result);

    // 使用 LCS (最长公共子序列) 来找出共同部分
    const lcs = (a: string[], b: string[]): Set<number>[] => {
        const m = a.length, n = b.length;
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // 回溯找出匹配的索引
        const matchedA = new Set<number>();
        const matchedB = new Set<number>();
        let i = m, j = n;
        while (i > 0 && j > 0) {
            if (a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) {
                matchedA.add(i - 1);
                matchedB.add(j - 1);
                i--; j--;
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }
        return [matchedA, matchedB];
    };

    const [matchedOriginal, matchedResult] = lcs(originalTokens, resultTokens);

    // 构建带高亮的原文（被删除/修改的部分用红色删除线）
    const originalWithDiff = originalTokens.map((token, idx) => {
        if (!matchedOriginal.has(idx) && token.trim()) {
            return <span key={idx} style={{ backgroundColor: 'rgba(239, 68, 68, 0.3)', textDecoration: 'line-through', color: '#ef4444' }}>{token}</span>;
        }
        return <span key={idx}>{token}</span>;
    });

    // 构建带高亮的结果（新增/修改的部分用绿色背景）
    const resultWithDiff = resultTokens.map((token, idx) => {
        if (!matchedResult.has(idx) && token.trim()) {
            return <span key={idx} style={{ backgroundColor: 'rgba(34, 197, 94, 0.3)', color: '#22c55e' }}>{token}</span>;
        }
        return <span key={idx}>{token}</span>;
    });

    return { originalWithDiff, resultWithDiff };
}

// --- Component ---

const CLEANER_MODEL_KEY = 'copywriting_cleaner_model';
const CLEANER_INHERIT = '__global__';

const CLEANER_MODEL_OPTIONS = [
  { value: CLEANER_INHERIT, label: '继承全局设置' },
  { value: 'gemini-2.5-flash', label: '⚡ gemini-2.5-flash (GA)' },
  { value: 'gemini-2.5-flash-lite', label: '⚡ gemini-2.5-flash-lite (GA·最快)' },
  { value: 'gemini-2.5-pro', label: '🧠 gemini-2.5-pro (GA·强推理)' },
  { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (Preview)' },
  { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview (Preview·最新)' },
];

export function CopywritingView({ getAiInstance, textModel, promptTabId = 'default' }: CopywritingViewProps) {
    const { user } = useAuth();

    // --- State ---
    const [items, setItems] = useState<CopywritingItem[]>([]);
    const [bulkInput, setBulkInput] = useState('');
    const [instruction, setInstruction] = useState('');
    const [instructions, setInstructions] = useState<string[]>(['']); // 多指令列表
    const [presets, setPresets] = useState<CopywritingPreset[]>([]);
    const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
    const [showPresetDropdown, setShowPresetDropdown] = useState(false);
    const [newPresetName, setNewPresetName] = useState('');
    const [showSavePreset, setShowSavePreset] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [fullDiffIssue, setFullDiffIssue] = useState<VoiceIntegrityIssue | null>(null);
    const [copiedType, setCopiedType] = useState<string | null>(null);
    const [presetLoading, setPresetLoading] = useState(false);
    const [showPreview, setShowPreview] = useState(false); // 预览最终指令
    const [systemInstruction, setSystemInstruction] = useState(DEFAULT_SYSTEM_INSTRUCTION); // 系统指令（可编辑）
    const [allCollapsed, setAllCollapsed] = useState(false); // 全局折叠状态
    const [activePresetDropdown, setActivePresetDropdown] = useState<number | null>(null); // 当前打开的预设下拉索引
    const [editingInstructionIndex, setEditingInstructionIndex] = useState<number | null>(null); // 双击编辑的指令索引
    const [editingSplitColumnId, setEditingSplitColumnId] = useState<string | null>(null); // 双击编辑的拆分列ID
    const [editingSocialMediaField, setEditingSocialMediaField] = useState<{ type: 'systemInstruction' | 'sectionDesc'; sectionId?: string } | null>(null); // 自媒体双击编辑
    const [socialMediaShowSystemInstruction, setSocialMediaShowSystemInstruction] = useState(false); // 自媒体系统指令展开/折叠
    const [socialMediaShowOutputSections, setSocialMediaShowOutputSections] = useState(false); // 自媒体输出分项展开/折叠
    const [copyToast, setCopyToast] = useState<string | null>(null); // 复制提示
    const [showPresetManager, setShowPresetManager] = useState(false); // 预设管理器
    const [hiddenPresetIds, setHiddenPresetIds] = useState<string[]>([]); // 快速栏隐藏的预设ID
    const [showBuiltinPresets, setShowBuiltinPresets] = useState(true); // 显示内置预设
    const [showCustomPresets, setShowCustomPresets] = useState(true); // 显示自定义预设
    const [pendingRetryStart, setPendingRetryStart] = useState(false); // 等待重试后开始
    const [freeformCount, setFreeformCount] = useState(1); // 无文案模式生成数量
    const [autoTranslate, setAutoTranslate] = useState(true); // 自动中文翻译开关
    const [rewriteVariantCount, setRewriteVariantCount] = useState(1); // 标准改写每指令生成多少个变体结果
    const [detailModalItem, setDetailModalItem] = useState<CopywritingItem | null>(null); // 详情弹窗
    const [detailShowRaw, setDetailShowRaw] = useState(false); // 详情弹窗-显示原始响应
    const [voiceWrapMode, setVoiceWrapMode] = useState<'ai' | 'script'>('ai'); // 人声断行模式
    const [showDeitySettings, setShowDeitySettings] = useState(false);
    
    const settings = useScriptureDeitySettings();

    // Esc 关闭详情弹窗
    useEffect(() => {
        const handleEsc = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && detailModalItem) {
                setDetailModalItem(null);
                setDetailShowRaw(false);
            }
        };
        window.addEventListener('keydown', handleEsc);
        return () => window.removeEventListener('keydown', handleEsc);
    }, [detailModalItem]);

    const [mode, setMode] = useState<CopywritingMode>('standard'); // 模式：标准/人声/分类/拆分
    const [voiceModeSystemInstruction, setVoiceModeSystemInstruction] = useState(VOICE_MODE_SYSTEM_INSTRUCTION); // 人声模式系统指令（可编辑）
    const [classifyModeSystemInstruction, setClassifyModeSystemInstruction] = useState(CLASSIFY_MODE_SYSTEM_INSTRUCTION); // 分类模式系统指令（可编辑）
    const [splitModeSystemInstruction, setSplitModeSystemInstruction] = useState(SPLIT_MODE_SYSTEM_INSTRUCTION); // 拆分模式系统指令（可编辑）
    const [socialMediaModeSystemInstruction, setSocialMediaModeSystemInstruction] = useState(SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION); // 自媒体改写模式系统指令（可编辑）
    const [socialMediaOutputSections, setSocialMediaOutputSections] = useState<SocialMediaOutputSection[]>(() => DEFAULT_SOCIAL_MEDIA_OUTPUT_SECTIONS.map(s => ({ ...s }))); // 自媒体输出分项
    const [socialMediaResultCount, setSocialMediaResultCount] = useState(1); // 自媒体每文案结果数（默认1个）
    const [splitColumns, setSplitColumns] = useState<SplitColumn[]>(DEFAULT_SPLIT_COLUMNS); // 拆分列定义
    const [keywordFreqMap, setKeywordFreqMap] = useState<Record<string, number>>({}); // 关键词全局频率表
    const [keywordStatsColumnId, setKeywordStatsColumnId] = useState<string | null>(null); // 统计关键词所用的列ID
    const [keywordStatsTotalItems, setKeywordStatsTotalItems] = useState(0); // 统计时的总条目数
    const [showDiff, setShowDiff] = useState(false); // 显示差异高亮
    const [batchSize, setBatchSize] = useState(1); // 批次处理大小（1-2000，默认1）
    const [showBatchSettings, setShowBatchSettings] = useState(false); // 显示批次设置
    const [cleanerTurbo, setCleanerTurbo] = useState(true); // 清理模式：Turbo（本地清理+AI翻译）vs 标准（纯AI）
    const [cleanerLocalModel, setCleanerLocalModel] = useState<string>(() => {
        try { return localStorage.getItem(CLEANER_MODEL_KEY) || CLEANER_INHERIT; } catch { return CLEANER_INHERIT; }
    });

    // === 分类子模式 ===
    const DEFAULT_WORD_COUNT_RANGES = '0-50, 50-100, 100-200, 200-500, 500+';
    const [classifySubMode, setClassifySubMode] = useState<ClassifySubMode>('standard');
    const classifyByWordCount = classifySubMode === 'wordcount'; // 向后兼容
    const setClassifyByWordCount = (v: boolean) => setClassifySubMode(v ? 'wordcount' : 'standard'); // 向后兼容
    const [wordCountRangesText, setWordCountRangesText] = useState(DEFAULT_WORD_COUNT_RANGES); // 字数区间配置
    const [classifyColumns, setClassifyColumns] = useState<ClassifyColumn[]>(DEFAULT_CLASSIFY_COLUMNS.map(c => ({ ...c }))); // 多维分类列

    /** 解析字数区间文本为结构化数组 */
    const parseWordCountRanges = (text: string): { min: number; max: number; label: string }[] => {
        return text.split(/[,，]/).map(s => s.trim()).filter(Boolean).map(range => {
            if (range.endsWith('+')) {
                const min = parseInt(range.replace('+', ''));
                return { min: isNaN(min) ? 0 : min, max: Infinity, label: `${min}+` };
            }
            const parts = range.split('-').map(Number);
            if (parts.length === 2 && !isNaN(parts[0]) && !isNaN(parts[1])) {
                return { min: parts[0], max: parts[1], label: range };
            }
            return null;
        }).filter(Boolean) as { min: number; max: number; label: string }[];
    };

    /** 根据字数确定分类 */
    const classifyByLength = (text: string): string => {
        const len = text.length;
        const ranges = parseWordCountRanges(wordCountRangesText);
        if (ranges.length === 0) return `${len}字`;
        for (const r of ranges) {
            if (len >= r.min && len < r.max) return `${r.label}字`;
            if (r.max === Infinity && len >= r.min) return `${r.label}字`;
        }
        return `${len}字`;
    };

    /** 多维分类：构建AI分类prompt（只包含AI列） */
    const buildClassifyPromptInstructions = (): { aiColumns: ClassifyColumn[]; promptBlock: string } => {
        const aiColumns = classifyColumns.filter(c => c.enabled && c.type !== 'local-wordcount');
        if (aiColumns.length === 0) return { aiColumns: [], promptBlock: '' };

        const columnDescriptions = aiColumns.map((col, idx) => {
            let desc = `第${idx + 1}列「${col.name}」：${col.description}`;
            if (col.type === 'ai-with-options' && col.options?.trim()) {
                desc += `\n  可选项：${col.options}`;
            }
            return desc;
        }).join('\n');

        const formatExample = aiColumns.map(c => c.name).join('|||');

        const promptBlock = `你是一个文案分类专家。根据以下分类维度对文案进行多维分类。

【分类维度】
${columnDescriptions}

【输出格式】
每条输出格式为：[编号] ${formatExample}
各列之间用 ||| 分隔。每条结果占一行，不要有任何解释、标题或额外文本。`;

        return { aiColumns, promptBlock };
    };

    /** 多维分类：解析AI返回的多列结果 */
    const parseClassifyAIResult = (content: string, aiColumns: ClassifyColumn[]): Record<string, string> => {
        const results: Record<string, string> = {};
        if (aiColumns.length === 0) return results;

        if (aiColumns.length === 1) {
            // 只有一列AI维度，整个content就是结果
            results[aiColumns[0].id] = content.trim();
        } else {
            const parts = content.split('|||');
            aiColumns.forEach((col, idx) => {
                results[col.id] = (parts[idx] || '').trim();
            });
        }
        return results;
    };

    /** 多维分类：计算本地列（字数等） */
    const computeLocalClassifyColumns = (text: string): Record<string, string> => {
        const results: Record<string, string> = {};
        classifyColumns.filter(c => c.enabled && c.type === 'local-wordcount').forEach(col => {
            const charCount = text.length;
            if (col.wordCountRanges?.trim()) {
                const ranges = parseWordCountRanges(col.wordCountRanges);
                let label = `${charCount}字`;
                for (const r of ranges) {
                    if ((charCount >= r.min && charCount < r.max) || (r.max === Infinity && charCount >= r.min)) {
                        label = `${r.label}字 (${charCount})`;
                        break;
                    }
                }
                results[col.id] = label;
            } else {
                results[col.id] = `${charCount}字`;
            }
        });
        return results;
    };

    // === 文案库模式状态 ===
    // 每次打开都清空旧缓存，从空库开始（用户通过预设手动添加）
    const [libraries, setLibraries] = useState<CopywritingLibrary[]>(() => {
        try { localStorage.removeItem('copywriting_libraries'); } catch { /* ignore */ }
        return [];
    });
    const [activeLibraryId, setActiveLibraryId] = useState<string>(() => {
        try { return localStorage.getItem('copywriting_activeLibId') || 'default_lib'; } catch { return 'default_lib'; }
    });
    const [showLibraryEditor, setShowLibraryEditor] = useState(false);
    const [activeEditorGroup, setActiveEditorGroup] = useState<string>(''); // 编辑器中当前选中的分页组
    const [showBatchImportModal, setShowBatchImportModal] = useState(false);
    const [showLibPresetDropdown, setShowLibPresetDropdown] = useState(false);
    const [libPickOneMode, setLibPickOneMode] = useState(false); // true=多库只选1条 false=每库各选1条
    const [batchImportText, setBatchImportText] = useState('');
    const confirmBatchImport = () => {
        if (!batchImportText.trim()) return;
        const newItems: LibraryItem[] = batchImportText.split('\n').filter(l => l.trim()).map(line => {
            const parts = line.split('\t');
            return {
                id: uuidv4(),
                content: parts[0]?.trim() || '',
                weight: parseInt(parts[1]) || 5,
                tags: parts[2]?.trim() || '',
                usedCount: 0
            };
        });
        if (newItems.length > 0) {
            setLibraries(prev => prev.map(l => l.id === activeLibraryId
                ? { ...l, items: [...l.items, ...newItems] }
                : l
            ));
            showCopyToast(`已导入 ${newItems.length} 条`);
        }
        setShowBatchImportModal(false);
    };
    const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
    const [libraryInstruction, setLibraryInstruction] = useState(DEFAULT_LIBRARY_INSTRUCTION); // 库模式的改写指令
    const [libraryExtraInstructions, setLibraryExtraInstructions] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('copywriting_libExtraInsts');
            if (saved) {
                const parsed = JSON.parse(saved);
                // 过滤掉全空的，保持干净
                const cleaned = parsed.filter((s: string) => s.trim());
                return cleaned.length > 0 ? cleaned : [];
            }
        } catch { /* ignore */ }
        return [];
    });
    const [editingLibField, setEditingLibField] = useState<{ type: 'matchRule', libId: string } | { type: 'extraInst', idx: number } | null>(null); // 库模式双击编辑
    const [libSheetsUrl, setLibSheetsUrl] = useState(() => {
        try { return localStorage.getItem('copywriting_lib_sheetsUrl') || ''; } catch { return ''; }
    });
    const [libSheetsImporting, setLibSheetsImporting] = useState(false);
    const [libAutoRefreshed, setLibAutoRefreshed] = useState(false); // 防止重复自动刷新

    // 缓存统计状态，避免每次渲染都计算 Object.keys
    const hasStats = useMemo(() => Object.keys(keywordFreqMap).length > 0, [keywordFreqMap]);
    const statsKeyCount = useMemo(() => Object.keys(keywordFreqMap).length, [keywordFreqMap]);
    const splitGridStyle = useMemo(() => {
        const colCount = 1 + splitColumns.length + (hasStats ? 1 : 0);
        if (colCount <= 4) {
            return `repeat(${colCount}, 1fr)`;
        } else {
            return `minmax(280px, 1fr) repeat(${splitColumns.length}, minmax(250px, 1fr))${hasStats ? ' minmax(280px, 1fr)' : ''}`;
        }
    }, [splitColumns.length, hasStats]);

    // 保存到表格状态
    const [sheetSaveStatus, setSheetSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
    const [sheetSaveError, setSheetSaveError] = useState<string>('');

    const handleSaveToSheet = async () => {
        const successItems = items.filter(i => i.status === 'success');
        if (successItems.length === 0) {
            showCopyToast('没有可保存的改写结果');
            return;
        }

        const config = getSheetsSyncConfig();
        if (!config.webAppUrl || !config.submitter) {
            showCopyToast('请先在设置中配置表格同步');
            return;
        }

        setSheetSaveStatus('saving');
        setSheetSaveError('');

        try {
            const time = new Date().toLocaleString('zh-CN');
            const rows = successItems.map(item => [
                time,
                mode === 'voice' ? '人声模式' : mode === 'classify' ? '分类模式' : '标准模式',
                item.originalForeign,
                item.resultForeign || '',
                item.resultChinese || ''
            ]);

            const result = await appendToSheet('copywriting', rows);

            if (result.success) {
                setSheetSaveStatus('success');
                showCopyToast(`已保存 ${rows.length} 条改写结果`);
                setTimeout(() => setSheetSaveStatus('idle'), 3000);
            } else {
                setSheetSaveStatus('error');
                setSheetSaveError(result.error || '保存失败');
                showCopyToast('保存失败: ' + (result.error || '未知错误'));
            }
        } catch (e) {
            setSheetSaveStatus('error');
            setSheetSaveError(e instanceof Error ? e.message : '保存失败');
            showCopyToast('保存失败');
        }
    };

    const stopRef = useRef(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const batchSettingsRef = useRef<HTMLDivElement>(null);
    const modeDraftsRef = useRef<CopywritingModeDrafts>(createDefaultModeDrafts());
    const previousPromptTabIdRef = useRef(promptTabId);
    const skipNextPersistRef = useRef(false);

    const sanitizeItemsForStorage = (sourceItems: CopywritingItem[]): CopywritingItem[] => {
        return sourceItems.map(item => ({
            ...item,
            chatLoading: false,
            chatHistory: (item.chatHistory || []).map(msg => ({ ...msg, images: [] })),
            instructionResults: (item.instructionResults || []).map(result => ({
                ...result,
                chatLoading: false,
                chatHistory: (result.chatHistory || []).map(msg => ({ ...msg, images: [] })),
            })),
        }));
    };

    const buildModeDrafts = (): CopywritingModeDrafts => {
        const nextDrafts = { ...modeDraftsRef.current };
        if (mode === 'split') {
            nextDrafts.split = {
                ...nextDrafts.split,
                splitColumns: splitColumns.map(col => ({ ...col })),
            };
        } else if (mode === 'library') {
            nextDrafts.library = {
                ...nextDrafts.library,
                libraryInstruction,
            };
        } else {
            const currentInstruction = instructions.find(inst => inst.trim()) ?? instructions[0] ?? instruction;
            nextDrafts[mode] = {
                ...nextDrafts[mode],
                instruction: currentInstruction,
                instructions: [...instructions],
            };
        }
        return nextDrafts;
    };

    const applyModeDraft = (nextMode: CopywritingMode, nextDrafts: CopywritingModeDrafts) => {
        const defaults = createDefaultModeDrafts();
        const draft = nextDrafts[nextMode] || defaults[nextMode];

        if (nextMode === 'split') {
            setSplitColumns((draft.splitColumns || defaults.split.splitColumns || DEFAULT_SPLIT_COLUMNS).map(col => ({ ...col })));
        } else if (nextMode === 'library') {
            setLibraryInstruction(draft.libraryInstruction || defaults.library.libraryInstruction || DEFAULT_LIBRARY_INSTRUCTION);
        } else if (nextMode === 'cleaner') {
            // 清理模式：补充指令默认为空
            setInstructions(['']);
            setInstruction('');
        } else {
            const nextInstructions = draft.instructions !== undefined
                ? [...draft.instructions]
                : [...(defaults[nextMode].instructions || [''])];
            setInstructions(nextInstructions);
            setInstruction(draft.instruction ?? nextInstructions[0] ?? '');
        }

        setMode(nextMode);
    };

    const handleModeChange = (nextMode: CopywritingMode) => {
        if (nextMode === mode) return;
        const nextDrafts = buildModeDrafts();
        modeDraftsRef.current = nextDrafts;
        applyModeDraft(nextMode, nextDrafts);
    };

    const buildSnapshot = (): CopywritingViewSnapshot => ({
        items: sanitizeItemsForStorage(items),
        bulkInput,
        instruction: instructions.find(inst => inst.trim()) ?? instructions[0] ?? instruction,
        instructions: [...instructions],
        selectedPresetId,
        systemInstruction,
        allCollapsed,
        mode,
        voiceModeSystemInstruction,
        classifyModeSystemInstruction,
        splitModeSystemInstruction,
        socialMediaModeSystemInstruction,
        socialMediaOutputSections: socialMediaOutputSections.map(s => ({ ...s })),
        splitColumns: splitColumns.map(col => ({ ...col })),
        keywordFreqMap: { ...keywordFreqMap },
        keywordStatsColumnId,
        keywordStatsTotalItems,
        showDiff,
        batchSize,
        libraryInstruction,
        modeDrafts: buildModeDrafts(),
        classifyByWordCount,
        classifySubMode,
        wordCountRangesText,
        hiddenPresetIds,
        showBuiltinPresets,
        showCustomPresets,
        autoTranslate,
        classifyColumns: classifyColumns.map(c => ({ ...c })),
        voiceWrapMode,
    });

    const loadSnapshotForTab = (tabId: string) => {
        const defaults = createDefaultModeDrafts();
        let snapshot: CopywritingViewSnapshot | null = null;
        try {
            const saved = localStorage.getItem(getCopywritingStorageKey(tabId));
            if (saved) {
                snapshot = JSON.parse(saved) as CopywritingViewSnapshot;
            }
        } catch (error) {
            console.warn('[CopywritingView] Failed to load snapshot:', error);
        }

        modeDraftsRef.current = snapshot?.modeDrafts
            ? {
                ...defaults,
                ...snapshot.modeDrafts,
            }
            : defaults;

        setItems(snapshot?.items || []);
        setBulkInput(snapshot?.bulkInput || '');
        setInstruction(snapshot?.instruction || snapshot?.instructions?.[0] || '');
        setInstructions(snapshot?.instructions || ['']);
        setSelectedPresetId(snapshot?.selectedPresetId || null);
        setSystemInstruction(snapshot?.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION);
        setAllCollapsed(snapshot?.allCollapsed || false);
        setMode(snapshot?.mode || 'standard');
        setVoiceModeSystemInstruction(snapshot?.voiceModeSystemInstruction || VOICE_MODE_SYSTEM_INSTRUCTION);
        setClassifyModeSystemInstruction(snapshot?.classifyModeSystemInstruction || CLASSIFY_MODE_SYSTEM_INSTRUCTION);
        setSplitModeSystemInstruction(snapshot?.splitModeSystemInstruction || SPLIT_MODE_SYSTEM_INSTRUCTION);
        setSocialMediaModeSystemInstruction(snapshot?.socialMediaModeSystemInstruction || SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION);
        setSocialMediaOutputSections((snapshot?.socialMediaOutputSections || DEFAULT_SOCIAL_MEDIA_OUTPUT_SECTIONS).map(s => ({ ...s })));
        setSocialMediaResultCount(snapshot?.socialMediaResultCount || 1);
        setSplitColumns((snapshot?.splitColumns || DEFAULT_SPLIT_COLUMNS).map(col => ({ ...col })));
        setKeywordFreqMap(snapshot?.keywordFreqMap || {});
        setKeywordStatsColumnId(snapshot?.keywordStatsColumnId || null);
        setKeywordStatsTotalItems(snapshot?.keywordStatsTotalItems || 0);
        setShowDiff(snapshot?.showDiff || false);
        setBatchSize(snapshot?.batchSize || 1);
        setLibraryInstruction(snapshot?.libraryInstruction || DEFAULT_LIBRARY_INSTRUCTION);
        // 兼容旧快照：classifyByWordCount -> classifySubMode
        if (snapshot?.classifySubMode) {
            setClassifySubMode(snapshot.classifySubMode);
        } else if (snapshot?.classifyByWordCount) {
            setClassifySubMode('wordcount');
        } else {
            setClassifySubMode('standard');
        }
        setWordCountRangesText(snapshot?.wordCountRangesText || DEFAULT_WORD_COUNT_RANGES);
        setHiddenPresetIds(snapshot?.hiddenPresetIds || []);
        setShowBuiltinPresets(snapshot?.showBuiltinPresets ?? true);
        setShowCustomPresets(snapshot?.showCustomPresets ?? true);
        setAutoTranslate(snapshot?.autoTranslate ?? true);
        setClassifyColumns((snapshot?.classifyColumns || DEFAULT_CLASSIFY_COLUMNS).map(c => ({ ...c })));
        setVoiceWrapMode(snapshot?.voiceWrapMode || 'ai');
    };

    const persistSnapshotForTab = (tabId: string) => {
        try {
            localStorage.setItem(getCopywritingStorageKey(tabId), JSON.stringify(buildSnapshot()));
        } catch (error) {
            console.warn('[CopywritingView] Failed to persist snapshot:', error);
        }
    };

    // --- Load presets from Firebase ---
    useEffect(() => {
        const loadPresets = async () => {
            if (!user?.uid) return;

            try {
                setPresetLoading(true);
                const docRef = doc(db, 'users', user.uid, 'settings', PRESETS_DOC_PATH);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setPresets(data.presets || []);
                }
            } catch (error) {
                console.error('[CopywritingView] Failed to load presets:', error);
            } finally {
                setPresetLoading(false);
            }
        };

        loadPresets();
    }, [user?.uid]);

    // --- Save presets to Firebase ---
    const savePresetsToFirebase = async (newPresets: CopywritingPreset[]) => {
        if (!user?.uid) return;

        try {
            const docRef = doc(db, 'users', user.uid, 'settings', PRESETS_DOC_PATH);
            await setDoc(docRef, { presets: newPresets }, { merge: true });
        } catch (error) {
            console.error('[CopywritingView] Failed to save presets:', error);
        }
    };

    // --- Close dropdown on outside click ---
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowPresetDropdown(false);
            }
            if (batchSettingsRef.current && !batchSettingsRef.current.contains(e.target as Node)) {
                setShowBatchSettings(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 按提示词工具标签页隔离保存/恢复文案改写状态
    useEffect(() => {
        const previousTabId = previousPromptTabIdRef.current;
        if (previousTabId !== promptTabId) {
            persistSnapshotForTab(previousTabId);
        }

        skipNextPersistRef.current = true;
        loadSnapshotForTab(promptTabId);
        previousPromptTabIdRef.current = promptTabId;
    }, [promptTabId]);

    useEffect(() => {
        if (skipNextPersistRef.current) {
            skipNextPersistRef.current = false;
            return;
        }
        persistSnapshotForTab(promptTabId);
    }, [
        promptTabId,
        items,
        bulkInput,
        instruction,
        instructions,
        selectedPresetId,
        systemInstruction,
        allCollapsed,
        mode,
        voiceModeSystemInstruction,
        classifyModeSystemInstruction,
        splitModeSystemInstruction,
        socialMediaModeSystemInstruction,
        socialMediaOutputSections,
        socialMediaResultCount,
        splitColumns,
        keywordFreqMap,
        keywordStatsColumnId,
        keywordStatsTotalItems,
        showDiff,
        batchSize,
        libraryInstruction,
        classifyByWordCount,
        classifySubMode,
        wordCountRangesText,
        classifyColumns,
        voiceWrapMode,
    ]);

    // --- 库模式: 保存设置到 localStorage ---
    useEffect(() => {
        try { localStorage.setItem('copywriting_libraries', JSON.stringify(libraries)); } catch { /* ignore */ }
    }, [libraries]);

    useEffect(() => {
        try { localStorage.setItem('copywriting_libExtraInsts', JSON.stringify(libraryExtraInstructions)); } catch { /* ignore */ }
    }, [libraryExtraInstructions]);

    useEffect(() => {
        try { localStorage.setItem('copywriting_activeLibId', activeLibraryId); } catch { /* ignore */ }
    }, [activeLibraryId]);

    // --- 库模式: 自动从 Sheets 刷新（如果有保存的URL） ---
    useEffect(() => {
        if (libAutoRefreshed || !libSheetsUrl || libSheetsImporting) return;
        setLibAutoRefreshed(true);

        const autoRefresh = async () => {
            try {
                console.log('[CopywritingView] Auto-refreshing libraries from Sheets...');
                setLibSheetsImporting(true);
                const newLibs = await importLibrariesFromSheets(libSheetsUrl);
                if (newLibs.length > 0) {
                    // 合并：保留本地设置（enabled, matchRule, maxRepeat, usedCount），用新的条目内容
                    setLibraries(prev => {
                        const prevMap = new Map(prev.map(l => [l.name, l]));
                        return newLibs.map(newLib => {
                            const existing = prevMap.get(newLib.name);
                            if (existing) {
                                // 保留本地设置，更新条目内容
                                const existingItemMap = new Map(existing.items.map(i => [i.content, i]));
                                const mergedItems = newLib.items.map(newItem => {
                                    const existingItem = existingItemMap.get(newItem.content);
                                    return existingItem
                                        ? { ...newItem, usedCount: existingItem.usedCount, weight: existingItem.weight }
                                        : newItem;
                                });
                                return { ...newLib, enabled: existing.enabled, matchRule: existing.matchRule, maxRepeat: existing.maxRepeat, color: existing.color, items: mergedItems };
                            }
                            return newLib;
                        });
                    });
                    showCopyToast(`已自动刷新 ${newLibs.length} 个库`);
                }
            } catch (e) {
                console.error('[CopywritingView] Auto-refresh failed:', e);
            } finally {
                setLibSheetsImporting(false);
            }
        };
        autoRefresh();
    }, [libSheetsUrl]);

    // --- Parse input (参照创新模式的解析逻辑) ---
    const parseInput = (mode: 'batch' | 'single' = 'batch'): { foreign: string; chinese?: string }[] => {
        const raw = bulkInput.trim();
        if (!raw) return [];

        const results: { foreign: string; chinese?: string }[] = [];

        if (mode === 'single') {
            // 单条模式：检测是否是 Tab 分隔的两列
            const parts = raw.split('\t');
            if (parts.length >= 2) {
                results.push({
                    foreign: parts[0].trim(),
                    chinese: parts[1].trim() || undefined
                });
            } else {
                results.push({ foreign: raw });
            }
        } else {
            // 批量模式：按换行分割，每行可能是 Tab 分隔的两列
            let current = '';
            let inQuote = false;
            const lines: string[] = [];

            for (let i = 0; i < bulkInput.length; i++) {
                const char = bulkInput[i];
                const nextChar = bulkInput[i + 1];

                if (char === '"') {
                    if (inQuote && nextChar === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuote = !inQuote;
                    }
                } else if (!inQuote && (char === '\n' || char === '\r')) {
                    if (current.trim()) {
                        lines.push(current.trim());
                    }
                    current = '';
                } else {
                    current += char;
                }
            }
            if (current.trim()) {
                lines.push(current.trim());
            }

            // 解析每行，检测是否有 Tab 分隔的两列
            for (const line of lines) {
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    results.push({
                        foreign: parts[0].trim(),
                        chinese: parts[1].trim() || undefined
                    });
                } else {
                    results.push({ foreign: line });
                }
            }
        }

        return results;
    };

    // --- Add items ---
    const handleAddItems = (mode: 'batch' | 'single' = 'batch') => {
        const parsed = parseInput(mode);
        if (parsed.length === 0) return;

        // 检测文本是否主要是中文（内联定义以便在此处使用）
        const checkIsChinese = (text: string): boolean => {
            if (!text) return false;
            const chineseChars = text.match(/[\u4e00-\u9fff]/g);
            const totalChars = text.replace(/\s/g, '').length;
            if (totalChars === 0) return false;
            return (chineseChars?.length || 0) / totalChars > 0.3;
        };

        // 自动检测并调换中外文顺序
        // 规则：如果两列都有内容，且第一列是中文、第二列是外文，则调换
        const adjustedItems: CopywritingItem[] = parsed.map(p => {
            if (p.chinese && p.foreign) {
                // 两列都有内容
                const firstIsChinese = checkIsChinese(p.foreign);
                const secondIsChinese = checkIsChinese(p.chinese);

                // 如果第一列是中文，第二列是外文，则调换
                if (firstIsChinese && !secondIsChinese) {
                    return {
                        id: uuidv4(),
                        originalForeign: p.chinese,    // 调换
                        originalChinese: p.foreign,    // 调换
                        status: 'idle' as const
                    };
                }
            }
            // 正常顺序或只有一列
            return {
                id: uuidv4(),
                originalForeign: p.foreign,
                originalChinese: p.chinese,
                status: 'idle' as const
            };
        });

        setItems(prev => [...adjustedItems, ...prev]);
        setBulkInput('');
    };

    // --- 处理粘贴事件：直接从剪贴板 HTML 解析 Google 表格单元格 ---
    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        // 尝试获取 HTML 格式数据（Google 表格复制时包含 HTML）
        const htmlData = clipboardData.getData('text/html');

        // 如果有 HTML 数据，尝试解析表格
        if (htmlData && (htmlData.includes('<table') || htmlData.includes('<tr'))) {
            e.preventDefault(); // 阻止默认粘贴

            // 解析 HTML 表格
            const parsed = parseHtmlTable(htmlData);

            if (parsed.length > 0) {
                // 检测文本是否主要是中文
                const checkIsChinese = (text: string): boolean => {
                    if (!text) return false;
                    const chineseChars = text.match(/[\u4e00-\u9fff]/g);
                    const totalChars = text.replace(/\s/g, '').length;
                    if (totalChars === 0) return false;
                    return (chineseChars?.length || 0) / totalChars > 0.3;
                };

                // 自动检测并调换中外文顺序
                const adjustedItems: CopywritingItem[] = parsed.map(p => {
                    if (p.chinese && p.foreign) {
                        const firstIsChinese = checkIsChinese(p.foreign);
                        const secondIsChinese = checkIsChinese(p.chinese);
                        if (firstIsChinese && !secondIsChinese) {
                            return {
                                id: uuidv4(),
                                originalForeign: p.chinese,
                                originalChinese: p.foreign,
                                status: 'idle' as const
                            };
                        }
                    }
                    return {
                        id: uuidv4(),
                        originalForeign: p.foreign,
                        originalChinese: p.chinese,
                        status: 'idle' as const
                    };
                });

                setItems(prev => [...adjustedItems, ...prev]);
                showCopyToast(`已从表格粘贴 ${adjustedItems.length} 条`);
                return;
            }
        }

        // 如果不是表格 HTML，使用默认粘贴行为
        // 不阻止默认行为，让文本正常粘贴到 textarea
    };

    // --- 解析 HTML 表格数据（支持 Google 表格格式）---
    const parseHtmlTable = (html: string): { foreign: string; chinese?: string }[] => {
        const results: { foreign: string; chinese?: string }[] = [];

        try {
            // 创建临时 DOM 元素解析 HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // 查找所有表格行
            const rows = doc.querySelectorAll('tr');

            if (rows.length === 0) {
                // 没有 tr 标签，尝试直接查找 td
                const cells = doc.querySelectorAll('td');
                if (cells.length > 0) {
                    // 单行数据
                    const cellTexts = Array.from(cells).map(cell =>
                        (cell.textContent || '').trim()
                    );
                    if (cellTexts.length >= 1 && cellTexts[0]) {
                        results.push({
                            foreign: cellTexts[0],
                            chinese: cellTexts[1] || undefined
                        });
                    }
                }
                return results;
            }

            // 遍历每行
            rows.forEach(row => {
                const cells = row.querySelectorAll('td, th');
                if (cells.length === 0) return;

                // 获取每个单元格的文本内容
                // Google 表格的单元格可能包含 <br> 换行，需要保留
                const getCellText = (cell: Element): string => {
                    // 将 <br> 替换为换行符
                    const clone = cell.cloneNode(true) as Element;
                    clone.querySelectorAll('br').forEach(br => {
                        br.replaceWith('\n');
                    });
                    return (clone.textContent || '').trim();
                };

                const cellTexts = Array.from(cells).map(cell => getCellText(cell));

                // 过滤掉全空的行
                if (cellTexts.every(t => !t)) return;

                // 第一列是外文，第二列是中文（如果有）
                if (cellTexts[0]) {
                    results.push({
                        foreign: cellTexts[0],
                        chinese: cellTexts[1] || undefined
                    });
                } else if (cellTexts[1]) {
                    // 如果第一列为空但第二列有内容
                    results.push({
                        foreign: cellTexts[1],
                        chinese: undefined
                    });
                }
            });
        } catch (error) {
            console.error('[CopywritingView] Failed to parse HTML table:', error);
        }

        return results;
    };

    // --- Clear all ---
    const handleClearAll = () => {
        setItems([]);
    };

    // --- Delete single item ---
    const handleDeleteItem = (id: string) => {
        setItems(prev => prev.filter(item => item.id !== id));
    };

    // --- 显示复制提示 ---
    const showCopyToast = (message: string) => {
        setCopyToast(message);
        setTimeout(() => setCopyToast(null), 2000);
    };


    // --- Process single item ---
    const processItem = async (item: CopywritingItem): Promise<{ foreign: string; chinese: string; rawResponse?: string } | null> => {
        try {
            const inst = mode === 'freeform' ? (instructions[0] || instruction || '').trim() : (instruction || DEFAULT_INSTRUCTION);
            let systemPrompt: string;
            let userPrompt: string;

            let deityRules = '';
            if (settings) {
                if (settings.deityTerms && settings.deityTerms.length > 0) {
                    deityRules += `\n\n【Capitalization Rules (CRITICAL)】\nIf generating English, you MUST capitalize the first letter of these specific religious terms and pronouns: ${settings.deityTerms.join(', ')}.\n`;
                    if (settings.applyDeityCapitalizationToAll) {
                        deityRules += `For any other output language, you MUST also capitalize the corresponding translated terms for these words.\n`;
                    }
                }
                if (settings.enableScriptureDetection) {
                    deityRules += `\n【SCRIPTURE QUOTATION RULES (CRITICAL FOR COPYRIGHT)】\n1. Detect if the source text contains any religious scriptures (e.g., from the Bible).\n2. If scriptures are detected, you MUST NOT translate them yourself.\n3. You MUST quote the exact official text from the specified version: 【${settings.scriptureVersion}】.\n4. If the exact quote from the specified version cannot be found, keep the original language or add a note, but DO NOT create a new translation.\n5. You MUST append a scripture feedback message to the end of the Chinese translation, separated by "|||".\n   - If NO scripture is detected, append: "|||不包含经文"\n   - If a scripture is detected and you modified it to the specified version, append: "|||经文已修改为【${settings.scriptureVersion}】"\n   - If a scripture is detected but it's already the correct version or no modification was needed, append: "|||不需要修改，当前是【${settings.scriptureVersion}】"\n`;
                }
            }

            if (mode === 'freeform') {
                // 无文案模式 - 纯指令生成，不需要原文
                const hasCustomFormat = inst.includes('|||');
                if (hasCustomFormat) {
                    systemPrompt = `你是一个专业的文案创作助手。${deityRules}\n\n【输出规则】\n1. 严格按照用户指令中定义的输出格式输出\n2. 使用 ||| 作为分隔符\n3. 不要任何额外解释`;
                    userPrompt = inst;
                } else if (!autoTranslate) {
                    systemPrompt = `你是一个专业的文案创作助手。${deityRules}\n\n【输出规则】\n1. 只输出最终文案，不要任何解释或前缀\n2. 直接输出结果，不需要分隔符`;
                    userPrompt = inst;
                } else {
                    systemPrompt = `你是一个专业的文案创作助手。${deityRules}\n\n【输出规则·分隔层】\n1. 整个输出中有且仅有一个 ||| 分隔符\n2. ||| 左边是外文文案，右边是对应的中文翻译\n3. 不要任何额外解释\n\n【重要】\n- 如果用户指令中有关于内容格式的要求（如分段、编号等），请在 ||| 左边的外文部分和右边的中文部分内分别应用\n- 如果用户指令中要求输出中文或双语，请忽略用户的中文输出要求，统一由 ||| 右边的中文翻译来提供\n- ||| 是语言版本分界符，不是内容格式分隔符`;
                    userPrompt = `${inst}\n\n请按以下格式输出：外文文案|||中文文案`;
                }
            } else if (mode === 'prayer') {
                // 祷告词提炼改写模式 - 独立系统指令
                systemPrompt = `${PRAYER_MODE_SYSTEM_INSTRUCTION}${deityRules}\n\n【输出规则】\n1. 只输出最终文案，不要任何解释\n2. 输出格式：英文三段式文案|||中文三段式文案\n3. 使用 ||| 作为分隔符`;

                userPrompt = `请提炼改写以下祷告词为三段式双语短视频文案：${inst ? `\n\n额外要求：${inst}` : ''}\n\n原始祷告词：\n${item.originalForeign}\n\n输出格式：英文版|||中文版`;
            } else {
                const hasCustomFormat = inst.includes('|||');
                if (hasCustomFormat) {
                    systemPrompt = `${systemInstruction}${deityRules}\n\n【输出规则】\n1. 严格按照用户指令中定义的输出格式输出\n2. 使用 ||| 作为分隔符\n3. 不要任何额外解释`;
                    userPrompt = `改写指令：\n${inst}\n\n原始外文：\n${item.originalForeign}\n\n请严格按照指令改写，只修改指令要求的部分，其他保持原样。`;
                } else if (!autoTranslate) {
                    systemPrompt = `${systemInstruction}${deityRules}\n\n【输出规则】\n1. 只输出改写后的最终文案，不要任何解释或前缀\n2. 直接输出结果`;
                    userPrompt = `改写指令：\n${inst}\n\n原始外文：\n${item.originalForeign}\n\n请严格按照指令改写，只修改指令要求的部分，其他保持原样。直接输出改写结果。`;
                } else {
                    systemPrompt = `${systemInstruction}${deityRules}\n\n【输出规则·分隔层】\n1. 整个输出中有且仅有一个 ||| 分隔符\n2. ||| 左边是改写后的外文，右边是对应的中文翻译\n3. 不要任何额外解释\n\n【重要】\n- 用户指令中的格式要求（如分段、编号、标题等）属于内容层，请在 ||| 的左右两部分中分别应用\n- 如果用户指令中要求输出中文或双语，请忽略用户的中文输出要求，统一由 ||| 右边的中文翻译来提供\n- ||| 是语言版本分界符，不是内容格式分隔符，整个输出中只能出现一次`;
                    userPrompt = `改写指令：\n${inst}\n\n原始外文：\n${item.originalForeign}\n\n请严格按照指令改写，只修改指令要求的部分，其他保持原样。输出格式：改写后的外文|||中文翻译`;
                }
            }

            // API 调用（429 轮换由底层 wrapper 自动处理）
            const ai = getAiInstance();
            const result = await ai.models.generateContent({
                model: textModel,
                contents: { role: 'user', parts: [{ text: userPrompt }] },
                config: { systemInstruction: systemPrompt }
            });

            const responseText = result.text?.trim() || '';

            // 解析响应
            if (!autoTranslate && !inst.includes('|||') && mode !== 'prayer') {
                // 关闭自动翻译时，整个输出作为外文
                return { foreign: responseText, chinese: '', rawResponse: responseText };
            }
            // 只在第一个 ||| 处拆分（防止用户内容中包含 ||| 导致多拆）
            const sepIdx = responseText.indexOf('|||');
            if (sepIdx >= 0) {
                const afterFirst = responseText.substring(sepIdx + 3).trim();
                const remainingParts = afterFirst.split('|||').map(p => p.trim());
                const chinese = remainingParts[0];
                const extraParts = remainingParts.length > 1 ? remainingParts.slice(1) : undefined;
                let scriptureNote: string | undefined = undefined;
                if (settings.enableScriptureDetection && extraParts && extraParts.length > 0) {
                    scriptureNote = extraParts[extraParts.length - 1];
                }

                return {
                    foreign: responseText.substring(0, sepIdx).trim(),
                    chinese: chinese,
                    extraParts: extraParts,
                    scriptureNote: scriptureNote,
                    rawResponse: responseText
                } as any;
            } else {
                console.warn('[CopywritingView] Unexpected response format:', responseText);
                return {
                    foreign: responseText,
                    chinese: '(翻译失败)',
                    rawResponse: responseText
                };
            }
        } catch (error: any) {
            console.error('[CopywritingView] Process error:', error);
            throw error;
        }
    };

    const processBatch = async (
        batchItems: CopywritingItem[],
        inst: string
    ): Promise<Map<string, { foreign: string; chinese: string; classifyResults?: Record<string, string>; extraParts?: string[]; rawResponse?: string; scriptureNote?: string }>> => {
        const results = new Map<string, { foreign: string; chinese: string; classifyResults?: Record<string, string>; extraParts?: string[]; rawResponse?: string; scriptureNote?: string }>();

        // 构建批量输入
        const numberedInputs = batchItems.map((item, idx) => `[${idx + 1}] ${item.originalForeign}`).join('\n\n');

        let systemPrompt: string;
        let userPrompt: string;

        let deityRules = '';
        if (settings) {
            if (settings.deityTerms && settings.deityTerms.length > 0) {
                deityRules += `\n\n【Capitalization Rules (CRITICAL)】\nIf generating English, you MUST capitalize the first letter of these specific religious terms and pronouns: ${settings.deityTerms.join(', ')}.\n`;
                if (settings.applyDeityCapitalizationToAll) {
                    deityRules += `For any other output language, you MUST also capitalize the corresponding translated terms for these words.\n`;
                }
            }
            if (settings.enableScriptureDetection) {
                deityRules += `\n【SCRIPTURE QUOTATION RULES (CRITICAL FOR COPYRIGHT)】\n1. Detect if the source text contains any religious scriptures (e.g., from the Bible).\n2. If scriptures are detected, you MUST NOT translate them yourself.\n3. You MUST quote the exact official text from the specified version: 【${settings.scriptureVersion}】.\n4. If the exact quote from the specified version cannot be found, keep the original language or add a note, but DO NOT create a new translation.\n5. You MUST append a scripture feedback message to the end of the Chinese translation, separated by "|||".\n   - If NO scripture is detected, append: "|||不包含经文"\n   - If a scripture is detected and you modified it to the specified version, append: "|||经文已修改为【${settings.scriptureVersion}】"\n   - If a scripture is detected but it's already the correct version or no modification was needed, append: "|||不需要修改，当前是【${settings.scriptureVersion}】"\n`;
            }
        }

        if (mode === 'voice') {
            // 人声模式批量处理
            systemPrompt = `${voiceModeSystemInstruction}${deityRules}

【批量处理输出规则】
你需要处理多条文案，每条以 [编号] 开头。
对于每条文案，输出格式为：[编号] 加标签结果|||断句结果
⚠️ 断句结果中的换行用 \\n 表示（字面的反斜杠n），不要真正换行，保持每条结果在同一行。
每条结果占一行。`;

            userPrompt = `${inst}

请为以下每条文案添加情感标签并断行：

${numberedInputs}

按格式输出每条结果：[编号] 加标签结果|||断句结果
注意：断句结果中的换行用 \\n 表示，不要真正换行。`;

        } else if (mode === 'classify') {
            if (classifySubMode === 'advanced') {
                // 高级分类模式：多维分类
                const { aiColumns, promptBlock } = buildClassifyPromptInstructions();
                if (aiColumns.length > 0) {
                    const formatExample = aiColumns.map(c => c.name).join('|||');
                    systemPrompt = promptBlock;
                    userPrompt = `${inst ? `额外要求：${inst}\n\n` : ''}请对以下每条文案进行多维分类：

${numberedInputs}

按格式输出每条结果：[编号] ${formatExample}`;
                } else {
                    // 没有AI列，fallback到简单分类
                    systemPrompt = `${classifyModeSystemInstruction}

【批量处理输出规则】
你需要对多条文案进行分类，每条以 [编号] 开头。
对于每条文案，只输出：[编号] 分类结果
每条结果占一行，不要有任何解释。`;

                    userPrompt = `分类规则：
${inst}

请对以下每条文案进行分类：

${numberedInputs}

按格式输出每条结果：[编号] 分类结果`;
                }
            } else {
                // 常规分类模式：简单分类
                systemPrompt = `${classifyModeSystemInstruction}

【批量处理输出规则】
你需要对多条文案进行分类，每条以 [编号] 开头。
对于每条文案，只输出：[编号] 分类结果
每条结果占一行，不要有任何解释。`;

                userPrompt = `分类规则：
${inst}

请对以下每条文案进行分类：

${numberedInputs}

按格式输出每条结果：[编号] 分类结果`;
            }

        } else if (mode === 'prayer') {
            // 祷告词提炼改写模式批量处理
            systemPrompt = `${PRAYER_MODE_SYSTEM_INSTRUCTION}${deityRules}\n\n【批量处理输出规则】\n你需要处理多条祷告词，每条以 [编号] 开头。\n对于每条祷告词，提炼改写为三段式双语文案。\n输出格式为：[编号] 英文三段式文案|||中文三段式文案\n每条结果占一行。`;

            userPrompt = `请提炼改写以下每条祷告词为三段式双语短视频文案：${inst ? `\n\n额外要求：${inst}` : ''}\n\n${numberedInputs}\n\n按格式输出每条结果：[编号] 英文版|||中文版`;

        } else {
            // 标准改写模式 → 委托给共享核心服务 promptToolBatchExecute
            // 保证 DataPipeline Agent 和独立工具使用完全相同的逻辑
            const texts = batchItems.map(item => item.originalForeign);
            const ai = getAiInstance();
            const coreResults = await promptToolBatchExecute(ai, texts, {
                textModel,
                inst,
                autoTranslate,
                systemInstruction,
                deitySettings: settings
            });

            coreResults.forEach((res, idx) => {
                if (idx < batchItems.length) {
                    const item = batchItems[idx];
                    if (inst.includes('|||')) {
                        // 自定义格式：可能有多段
                        const rawParts = res.rawResponse.split('|||').map((p: string) => p.trim());
                        results.set(item.id, {
                            foreign: rawParts[0] || res.foreign,
                            chinese: rawParts.length > 1 ? rawParts[1] : res.chinese,
                            extraParts: rawParts.length > 2 ? rawParts.slice(2) : undefined,
                            rawResponse: res.rawResponse,
                            scriptureNote: res.scriptureNote
                        });
                    } else {
                        results.set(item.id, {
                            foreign: res.foreign,
                            chinese: res.chinese,
                            rawResponse: res.rawResponse,
                            scriptureNote: res.scriptureNote
                        });
                    }
                }
            });

            return results;
        }

        try {
            // API 调用（429 轮换由底层 wrapper 自动处理）
            const ai = getAiInstance();
            const apiResult = await ai.models.generateContent({
                model: textModel,
                contents: { role: 'user', parts: [{ text: userPrompt }] },
                config: { systemInstruction: systemPrompt }
            });

            const responseText = apiResult.text?.trim() || '';

            // 解析批量结果
            const lines = responseText.split('\n').filter(line => line.trim());

            for (const line of lines) {
                // 匹配 [编号] 格式
                const match = line.match(/^\[(\d+)\]\s*(.+)$/);
                if (match) {
                    const idx = parseInt(match[1], 10) - 1;
                    const content = match[2].trim();

                    if (idx >= 0 && idx < batchItems.length) {
                        const item = batchItems[idx];

                        if (mode === 'classify') {
                            if (classifySubMode === 'advanced') {
                                // 高级分类模式：解析多列结果
                                const { aiColumns } = buildClassifyPromptInstructions();
                                const aiResults = parseClassifyAIResult(content, aiColumns);
                                const localResults = computeLocalClassifyColumns(item.originalForeign);
                                const allResults = { ...aiResults, ...localResults };

                                // 构建显示字符串
                                const enabledCols = classifyColumns.filter(c => c.enabled);
                                const displayParts = enabledCols.map(c => `${c.name}:${allResults[c.id] || '-'}`);

                                results.set(item.id, {
                                    foreign: displayParts.join(' | '),
                                    chinese: '',
                                    classifyResults: allResults,
                                    rawResponse: content
                                });
                            } else {
                                // 常规分类模式：单个分类结果
                                results.set(item.id, { foreign: content, chinese: '', rawResponse: content });
                            }
                        } else {
                            // 标准/人声/祷告等模式解析
                            if (!autoTranslate && !inst.includes('|||') && mode !== 'prayer' && mode !== 'voice') {
                                // 关闭翻译时，整行都是外文结果
                                results.set(item.id, { foreign: content, chinese: '', rawResponse: content });
                            } else {
                                const parts = content.split('|||');
                                if (parts.length >= 2) {
                                    const voiceTagged = parts[0].trim();
                                    let voiceSegmented = parts[1].trim();

                                    if (mode === 'voice') {
                                        if (voiceWrapMode === 'script') {
                                            const cleanText = voiceTagged.replace(/\[.*?\]/g, '').replace(/\.{2,}/g, '').trim();
                                            voiceSegmented = autoWrapText(cleanText, 18);
                                        } else {
                                            voiceSegmented = voiceSegmented.replace(/\\n/g, '\n');
                                        }
                                        validateVoiceModeIntegrity(item.originalForeign, voiceTagged, voiceSegmented);
                                    }

                                    const extraParts = parts.length > 2 ? parts.slice(2).map((p: string) => p.trim()) : undefined;
                                    let scriptureNote: string | undefined = undefined;
                                    if (settings.enableScriptureDetection && extraParts && extraParts.length > 0) {
                                        scriptureNote = extraParts[extraParts.length - 1];
                                    }

                                    results.set(item.id, {
                                        foreign: voiceTagged,
                                        chinese: voiceSegmented,
                                        extraParts,
                                        scriptureNote,
                                        rawResponse: content
                                    });
                                } else {
                                    // 解析失败，使用原始输出
                                    results.set(item.id, { foreign: content, chinese: '(解析失败)', rawResponse: content });
                                }
                            }
                        }
                    }
                }
            }
        } catch (error: any) {
            console.error('[CopywritingView] Batch process error:', error);
            throw error;
        }

        return results;
    };

    // --- Start processing ---
    const handleStartProcessing = async () => {
        // === 无文案模式：自动创建虚拟条目 ===
        if (mode === 'freeform') {
            const freeformInst = (instructions[0] || instruction || '').trim();
            if (!freeformInst) {
                showCopyToast('请先输入生成指令');
                return;
            }
            // 创建多个虚拟条目
            const freeformItems: CopywritingItem[] = Array.from({ length: freeformCount }, () => ({
                id: uuidv4(),
                originalForeign: '(无文案模式)',
                originalChinese: '',
                resultForeign: '',
                resultChinese: '',
                status: 'processing' as const,
                collapsed: false,
                instructionResults: [],
            }));
            setItems(prev => [...prev, ...freeformItems]);
            setIsProcessing(true);
            stopRef.current = false;

            // 并行处理（最多3个并发）
            const CONCURRENT = Math.min(3, freeformItems.length);
            let idx = 0;
            const runNext = async () => {
                while (idx < freeformItems.length && !stopRef.current) {
                    const currentIdx = idx++;
                    const item = freeformItems[currentIdx];
                    try {
                        const result = await processItem(item);
                        if (result) {
                            setItems(prev => prev.map(i =>
                                i.id === item.id ? { ...i, status: 'success' as const, resultForeign: result.foreign, resultChinese: result.chinese, scriptureNote: (result as any).scriptureNote, rawResponse: result.rawResponse } : i
                            ));
                        } else {
                            setItems(prev => prev.map(i =>
                                i.id === item.id ? { ...i, status: 'error' as const, error: '生成失败' } : i
                            ));
                        }
                    } catch (error: any) {
                        setItems(prev => prev.map(i =>
                            i.id === item.id ? {
                                ...i,
                                status: 'error' as const,
                                error: getErrorMessage(error),
                                voiceIntegrityIssue: getVoiceIntegrityIssue(error)
                            } : i
                        ));
                    }
                }
            };
            await Promise.all(Array(CONCURRENT).fill(null).map(() => runNext()));
            showCopyToast(`✅ 生成完成 (${freeformCount}条)`);
            playCompletionSound();
            setIsProcessing(false);
            return;
        }

        const idleItems = items.filter(item => item.status === 'idle');
        if (idleItems.length === 0) return;

        setIsProcessing(true);
        stopRef.current = false;

        // === 字数分类模式（本地，不调用 AI）===
        if (mode === 'classify' && classifyByWordCount) {
            setItems(prev => prev.map(item =>
                item.status === 'idle' ? { ...item, status: 'processing' as const } : item
            ));

            // 同步本地分类
            const updatedItems = idleItems.map(item => {
                const charCount = item.originalForeign.length;
                const category = classifyByLength(item.originalForeign);
                const displayResult = `${category} (${charCount}字)`;
                const newResult: InstructionResult = {
                    id: uuidv4(),
                    instruction: `按字数分类 (${wordCountRangesText})`,
                    inputForeign: item.originalForeign,
                    resultForeign: displayResult,
                    resultChinese: `${charCount}字`,
                    status: 'success',
                    createdAt: Date.now()
                };
                return {
                    id: item.id,
                    status: 'success' as const,
                    resultForeign: displayResult,
                    resultChinese: `${charCount}字`,
                    instructionResults: [newResult]
                };
            });

            setItems(prev => prev.map(item => {
                const result = updatedItems.find(u => u.id === item.id);
                if (result) {
                    return {
                        ...item,
                        status: result.status,
                        resultForeign: result.resultForeign,
                        resultChinese: result.resultChinese,
                        instructionResults: result.instructionResults
                    };
                }
                return item;
            }));

            setIsProcessing(false);
            showCopyToast(`✅ 字数分类完成：${idleItems.length} 条`);
            playCompletionSound();
            if (idleItems.length > 20) {
                setItems(prev => prev.map(i => ({ ...i, collapsed: true })));
                setAllCollapsed(true);
            }
            return;
        }

        // === 信仰文案关键词优先分类模式 ===
        // 检测是否使用了信仰文案分类预设（通过关键词特征识别）
        const isFaithClassifyPreset = mode === 'classify' && classifySubMode !== 'advanced' && classifySubMode !== 'wordcount'
            && (instruction.includes('数字类|||') || instruction.includes('经文短贴|||') || instruction.includes('纯小话|||'));

        if (isFaithClassifyPreset) {
            setItems(prev => prev.map(item =>
                item.status === 'idle' ? { ...item, status: 'processing' as const } : item
            ));

            // 阶段1：本地关键词匹配
            const keywordMatched: { id: string; major: string; sub: string }[] = [];
            const unmatchedItems: typeof idleItems = [];

            for (const item of idleItems) {
                // 用中文翻译优先匹配（关键词是中文），再用原文匹配
                const textToMatch = (item.originalChinese || '') + ' ' + item.originalForeign;
                const match = matchFaithKeywords(textToMatch);
                if (match) {
                    keywordMatched.push({ id: item.id, major: match.major, sub: match.sub });
                } else {
                    unmatchedItems.push(item);
                }
            }

            // 立即更新关键词命中的结果
            if (keywordMatched.length > 0) {
                setItems(prev => prev.map(item => {
                    const matched = keywordMatched.find(m => m.id === item.id);
                    if (matched) {
                        const displayResult = `${matched.major}|||${matched.sub}`;
                        const parts = displayResult.split('|||');
                        const newResult: InstructionResult = {
                            id: uuidv4(),
                            instruction: '关键词匹配',
                            inputForeign: item.originalForeign,
                            resultForeign: parts[0].trim(),
                            resultChinese: parts.length > 1 ? parts[1].trim() : '',
                            resultExtraParts: parts.length > 2 ? parts.slice(2).map(p => p.trim()) : undefined,
                            status: 'success',
                            createdAt: Date.now()
                        };
                        return {
                            ...item,
                            status: 'success' as const,
                            resultForeign: parts[0].trim(),
                            resultChinese: parts.length > 1 ? parts[1].trim() : '',
                            instructionResults: [newResult]
                        };
                    }
                    return item;
                }));
                showCopyToast(`🔑 关键词匹配命中 ${keywordMatched.length}/${idleItems.length} 条`);
            }

            // 阶段2：未命中的交给 AI 语义分类
            if (unmatchedItems.length > 0 && !stopRef.current) {
                showCopyToast(`🤖 AI 语义分类: ${unmatchedItems.length} 条未命中项...`);

                // 429 轮换由底层 wrapper 自动处理，不再需要外层重试
                const callWithRetry = async (fn: () => Promise<any>, _label: string): Promise<any> => {
                    return await fn();
                };

                // 批量发送未命中项给 AI
                const batchSize = 10;
                for (let batchStart = 0; batchStart < unmatchedItems.length && !stopRef.current; batchStart += batchSize) {
                    const batch = unmatchedItems.slice(batchStart, batchStart + batchSize);
                    const numberedInputs = batch.map((item, idx) => `[${idx + 1}] ${item.originalForeign}`).join('\n');

                    try {
                        const result = await callWithRetry(async () => {
                            const ai = getAiInstance();
                            return await ai.models.generateContent({
                                model: textModel,
                                contents: { role: 'user', parts: [{ text: `分类规则：\n${instruction}\n\n请对以下每条文案进行分类：\n\n${numberedInputs}\n\n按格式输出每条结果：[编号] 大类|||子分类名称` }] },
                                config: { systemInstruction: `${classifyModeSystemInstruction}\n\n【批量处理输出规则】\n你需要对多条文案进行分类，每条以 [编号] 开头。\n对于每条文案，结合关键词和语义理解判断分类。\n输出格式：[编号] 大类|||子分类名称\n每条结果占一行，不要有任何解释。` }
                            });
                        }, `AI分类-batch${batchStart}`);

                        const responseText = result.text?.trim() || '';
                        const lines = responseText.split('\n').filter((line: string) => line.trim());

                        setItems(prev => {
                            const updated = [...prev];
                            for (const line of lines) {
                                const match = line.match(/^\[(\d+)\]\s*(.+)$/);
                                if (match) {
                                    const idx = parseInt(match[1], 10) - 1;
                                    if (idx >= 0 && idx < batch.length) {
                                        const content = match[2].trim();
                                        const parts = content.split('|||').map((p: string) => p.trim());
                                        const itemIdx = updated.findIndex(i => i.id === batch[idx].id);
                                        if (itemIdx >= 0) {
                                            const newResult: InstructionResult = {
                                                id: uuidv4(),
                                                instruction: 'AI语义分类',
                                                inputForeign: batch[idx].originalForeign,
                                                resultForeign: parts[0] || content,
                                                resultChinese: parts.length > 1 ? parts[1] : '',
                                                resultExtraParts: parts.length > 2 ? parts.slice(2) : undefined,
                                                status: 'success',
                                                createdAt: Date.now()
                                            };
                                            updated[itemIdx] = {
                                                ...updated[itemIdx],
                                                status: 'success' as const,
                                                resultForeign: parts[0] || content,
                                                resultChinese: parts.length > 1 ? parts[1] : '',
                                                instructionResults: [newResult]
                                            };
                                        }
                                    }
                                }
                            }
                            return updated;
                        });

                        showCopyToast(`🤖 AI 分类进度: ${Math.min(batchStart + batchSize, unmatchedItems.length)}/${unmatchedItems.length}`);
                    } catch (error: any) {
                        console.error('[信仰分类] AI 批量分类错误:', error);
                        // 标记失败
                        setItems(prev => prev.map(item => {
                            if (batch.some(b => b.id === item.id) && item.status === 'processing') {
                                return { ...item, status: 'error' as const, errorMessage: error?.message || '分类失败' };
                            }
                            return item;
                        }));
                    }
                }
            }

            // 标记仍在 processing 状态的为 error
            setItems(prev => prev.map(item =>
                item.status === 'processing' ? { ...item, status: 'error' as const, errorMessage: '未收到结果' } : item
            ));

            setIsProcessing(false);
            showCopyToast(`✅ 分类完成：关键词 ${keywordMatched.length} 条 + AI ${unmatchedItems.length} 条`);
            playCompletionSound();
            if (idleItems.length > 20) {
                setItems(prev => prev.map(i => ({ ...i, collapsed: true })));
                setAllCollapsed(true);
            }
            return;
        }

        // 429 轮换由底层 wrapper 自动处理，不再需要外层重试
        const callWithRetry = async (fn: () => Promise<any>, _label: string): Promise<any> => {
            return await fn();
        };

        // === 文案清理模式 ===
        if (mode === 'cleaner') {
            // 使用内置清理指令 + 用户补充指令
            const cleanerBaseInstruction = BUILTIN_PRESETS.find((p: CopywritingPreset) => p.id === 'builtin_ai_label_cleaner')?.instruction || '';
            const userExtra = instruction.trim();
            // 覆盖输出要求为4列格式
            const cleanerOutputOverride = `
## 三、输出格式

对每条文案，按以下格式输出，用 ||| 分隔四部分：

清理后的原文|||英文翻译|||中文翻译|||删除内容说明

- **清理后原文**：保持原始语言，只去掉杂质
- **英文翻译**：将清理后原文翻译为地道英文（如原文已是英文则保持）
- **中文翻译**：将清理后原文翻译为自然中文
- **删除内容说明**：列出所有被删除的杂质文本及其中文翻译，格式为 "[已删除] 原文杂质 → 中文含义"，多条用分号分隔。如果没有杂质则写"无需清理"
- 四段用 ||| 分隔，不要换行分隔符前后
- 不要输出任何其他解释、编号、注释`;
            // 提取清理指令的核心部分（移除原有的输出要求部分）
            const cleanerCore = cleanerBaseInstruction.replace(/## 三、输出[\s\S]*$/, '').trim();
            const finalCleanerInstruction = cleanerCore + '\n\n' + cleanerOutputOverride + (userExtra ? `\n\n## 补充要求\n${userExtra}` : '');

            // 使用标准处理流程，将指令注入为包含 ||| 的自定义格式
            const savedInstruction = instruction;
            const savedInstructions = [...instructions];
            // 临时替换 instruction，让标准流程使用清理指令
            setInstruction(finalCleanerInstruction);
            setInstructions([finalCleanerInstruction]);

            // 等一帧让 state 生效后再走标准流程
            await new Promise(r => setTimeout(r, 0));

            // 批量/并发处理文案清理
            setItems(prev => prev.map(item =>
                item.status === 'idle' ? { ...item, status: 'processing' as const } : item
            ));

            let successCount = 0;
            const CLEANER_CONCURRENT = cleanerTurbo ? 5 : 3;
            // 清理模型：Turbo时使用本地选择的模型，非 Turbo 用全局 textModel
            const cleanerModel = cleanerTurbo
                ? (cleanerLocalModel === CLEANER_INHERIT ? textModel : cleanerLocalModel)
                : textModel;

            // 处理单条清理的函数
            const processCleanerItem = async (item: CopywritingItem, label: string) => {
                const cleanerSystemPrompt = `${systemInstruction}\n\n【输出规则】\n1. 严格按照指令中定义的4列输出格式输出\n2. 使用 ||| 作为分隔符\n3. 不要任何额外解释`;

                const cleanerUserPrompt = `${finalCleanerInstruction}\n\n原始文案：\n${item.originalForeign}\n\n请严格按照指令清理并输出4列结果：清理后原文|||英文翻译|||中文翻译|||删除说明`;

                const result = await callWithRetry(async () => {
                    const ai = getAiInstance();
                    return await ai.models.generateContent({
                        model: cleanerModel,
                        contents: { role: 'user', parts: [{ text: cleanerUserPrompt }] },
                        config: { systemInstruction: cleanerSystemPrompt }
                    });
                }, label);

                const responseText = result?.text?.trim() || result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
                const parts = responseText.split('|||').map((p: string) => p.trim());

                if (parts.length >= 2) {
                    const newResult: InstructionResult = {
                        id: uuidv4(),
                        instruction: '文案清理',
                        inputForeign: item.originalForeign,
                        resultForeign: parts[0] || '',
                        resultChinese: parts[1] || '',
                        resultExtraParts: parts.length > 2 ? parts.slice(2) : undefined,
                        status: 'success',
                        createdAt: Date.now()
                    };

                    setItems(prev => prev.map(i =>
                        i.id === item.id ? {
                            ...i,
                            status: 'success' as const,
                            resultForeign: parts[0] || '',
                            resultChinese: parts[1] || '',
                            instructionResults: [...(i.instructionResults || []), newResult]
                        } : i
                    ));
                    successCount++;
                } else {
                    setItems(prev => prev.map(i =>
                        i.id === item.id ? { ...i, status: 'error' as const, error: '解析失败: ' + responseText.slice(0, 100) } : i
                    ));
                }
            };

            // 处理一个批次的清理函数（batchSize > 1 时使用）
            const processCleanerBatch = async (batchItems: CopywritingItem[], label: string) => {
                const numberedInputs = batchItems.map((item, idx) => `[${idx + 1}] ${item.originalForeign}`).join('\n');

                const cleanerSystemPrompt = `${finalCleanerInstruction}\n\n【批量处理输出规则】\n你需要处理多条文案，每条以 [编号] 开头。\n对于每条文案，严格按4列输出格式输出，使用 ||| 作为分隔符。\n每条结果占一行，格式为：[编号] 清理后原文|||英文翻译|||中文翻译|||删除说明\n不要任何额外解释。不要输出markdown格式。`;

                const cleanerUserPrompt = `请按照文案清理指令处理以下每条文案：\n\n${numberedInputs}\n\n按格式输出每条结果：[编号] 清理后原文|||英文翻译|||中文翻译|||删除说明`;

                const result = await callWithRetry(async () => {
                    const ai = getAiInstance();
                    return await ai.models.generateContent({
                        model: cleanerModel,
                        contents: { role: 'user', parts: [{ text: cleanerUserPrompt }] },
                        config: { systemInstruction: cleanerSystemPrompt }
                    });
                }, label);

                const responseText = result?.text?.trim() || result?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

                // 鲁棒解析：先按 [编号] 边界拆分，处理 AI 可能换行的情况
                const entryRegex = /\[(\d+)\]\s*/g;
                const entries: { idx: number; content: string }[] = [];
                let matchResult;
                const matchPositions: { idx: number; start: number }[] = [];

                while ((matchResult = entryRegex.exec(responseText)) !== null) {
                    matchPositions.push({
                        idx: parseInt(matchResult[1], 10) - 1,
                        start: matchResult.index + matchResult[0].length
                    });
                }

                for (let i = 0; i < matchPositions.length; i++) {
                    const pos = matchPositions[i];
                    const end = i + 1 < matchPositions.length ? matchPositions[i + 1].start - `[${matchPositions[i + 1].idx + 1}] `.length : responseText.length;
                    const content = responseText.slice(pos.start, end).replace(/\n+$/, '').trim();
                    if (content) entries.push({ idx: pos.idx, content });
                }

                for (const entry of entries) {
                    if (entry.idx >= 0 && entry.idx < batchItems.length) {
                        const item = batchItems[entry.idx];
                        // 将换行替换为空格后再按 ||| 分割
                        const normalizedContent = entry.content.replace(/\s*\n\s*/g, ' ');
                        const parts = normalizedContent.split('|||').map((p: string) => p.trim());

                        if (parts.length >= 2) {
                            const newResult: InstructionResult = {
                                id: uuidv4(),
                                instruction: '文案清理',
                                inputForeign: item.originalForeign,
                                resultForeign: parts[0] || '',
                                resultChinese: parts[1] || '',
                                resultExtraParts: parts.length > 2 ? parts.slice(2) : undefined,
                                status: 'success',
                                createdAt: Date.now()
                            };

                            setItems(prev => prev.map(i =>
                                i.id === item.id ? {
                                    ...i,
                                    status: 'success' as const,
                                    resultForeign: parts[0] || '',
                                    resultChinese: parts[1] || '',
                                    instructionResults: [...(i.instructionResults || []), newResult]
                                } : i
                            ));
                            successCount++;
                        } else {
                            setItems(prev => prev.map(i =>
                                i.id === item.id ? { ...i, status: 'error' as const, error: '解析失败: ' + entry.content.slice(0, 100) } : i
                            ));
                        }
                    }
                }

                // 标记未返回结果的项为错误
                const returnedIdxs = new Set(entries.map(e => e.idx));
                const missingItems = batchItems.filter((_, idx) => !returnedIdxs.has(idx));
                if (missingItems.length > 0) {
                    setItems(prev => prev.map(i =>
                        missingItems.find(m => m.id === i.id) && i.status === 'processing'
                            ? { ...i, status: 'error' as const, error: '批量清理中未返回结果' } : i
                    ));
                }
            };

            // 速率控制：单 key 下限制总请求速率，避免 429
            // lite 模型 RPM 上限 ~30，flash ~15，留余量
            const REQUEST_GAP_MS = cleanerTurbo ? 2500 : 4500; // 每次请求之间的最小间隔
            const WORKER_STAGGER_MS = Math.floor(REQUEST_GAP_MS / CLEANER_CONCURRENT); // worker 错峰启动

            if (batchSize > 1) {
                // === 批量处理模式 ===
                const allBatches: CopywritingItem[][] = [];
                for (let i = 0; i < idleItems.length; i += batchSize) {
                    allBatches.push(idleItems.slice(i, i + batchSize));
                }
                let batchIdx = 0;
                const runNextBatch = async (workerIndex: number) => {
                    // 错峰启动
                    if (workerIndex > 0) await new Promise(r => setTimeout(r, workerIndex * WORKER_STAGGER_MS));
                    while (batchIdx < allBatches.length && !stopRef.current) {
                        const currentIdx = batchIdx++;
                        const batch = allBatches[currentIdx];
                        try {
                            await processCleanerBatch(batch, `cleaner-batch-${currentIdx}`);
                            showCopyToast(`🧹 清理进度: ${Math.min((currentIdx + 1) * batchSize, idleItems.length)}/${idleItems.length}${cleanerTurbo ? ' ⚡' : ''}`);
                        } catch (error: any) {
                            setItems(prev => prev.map(i =>
                                batch.find(b => b.id === i.id) && i.status === 'processing'
                                    ? { ...i, status: 'error' as const, error: error.message || '批量清理失败' } : i
                            ));
                        }
                        // 请求间隔控制
                        await new Promise(r => setTimeout(r, REQUEST_GAP_MS));
                    }
                };
                const workers = Array(Math.min(CLEANER_CONCURRENT, allBatches.length)).fill(null).map((_, i) => runNextBatch(i));
                await Promise.all(workers);
            } else {
                // === 单条并发处理模式 ===
                let itemIdx = 0;
                const runNext = async (workerIndex: number): Promise<void> => {
                    // 错峰启动
                    if (workerIndex > 0) await new Promise(r => setTimeout(r, workerIndex * WORKER_STAGGER_MS));
                    while (itemIdx < idleItems.length && !stopRef.current) {
                        const currentIdx = itemIdx++;
                        const item = idleItems[currentIdx];
                        try {
                            await processCleanerItem(item, `cleaner-${currentIdx}`);
                            showCopyToast(`🧹 清理进度: ${currentIdx + 1}/${idleItems.length}${cleanerTurbo ? ' ⚡' : ''}`);
                        } catch (error: any) {
                            if (stopRef.current) return;
                            setItems(prev => prev.map(i =>
                                i.id === item.id ? { ...i, status: 'error' as const, error: error.message || '处理失败' } : i
                            ));
                        }
                        // 请求间隔控制
                        await new Promise(r => setTimeout(r, REQUEST_GAP_MS));
                    }
                };
                const workers = Array(Math.min(CLEANER_CONCURRENT, idleItems.length)).fill(null).map((_, i) => runNext(i));
                await Promise.all(workers);
            }

            // 恢复指令
            setInstruction(savedInstruction);
            setInstructions(savedInstructions);
            setIsProcessing(false);
            showCopyToast(`✅ 文案清理完成：${successCount}/${idleItems.length} 条${cleanerTurbo ? ' ⚡Turbo' : ''}`);
            playCompletionSound();
            if (idleItems.length > 20) {
                setItems(prev => prev.map(i => ({ ...i, collapsed: true })));
                setAllCollapsed(true);
            }
            return;
        }

        // === 排比改写模式 ===
        if (mode === 'parallel') {
            setItems(prev => prev.map(item =>
                item.status === 'idle' ? { ...item, status: 'processing' as const } : item
            ));

            // 用于收集阶段1结果（绕过 React state 异步问题）
            const phase1ResultsMap = new Map<string, Record<string, string>>();

            // === 阶段1：检测排比 + 提取句式 ===
            console.log('[排比模式] ========= 阶段1开始：检测排比句式 =========');
            showCopyToast('🔍 【阶段1/2】正在逐条检测排比句式...');

            const parallelDetectColumns: SplitColumn[] = [
                { id: 'is_parallel', name: '是否排比', description: '判断文案是否包含排比句式（3句或以上使用相同/相似语法结构重复表达的句子）。排比类型包括：列举式（1.我...2.我...）、对仗式（A但B，A但B）、呼唤式（耶稣-X，耶稣-X）、感恩式（感谢您...感谢您...）、宣告式（上帝会X，上帝会X）等。只输出"是"或"否"' },
                { id: 'parallel_pattern', name: '排比句式模板', description: '如果第1列是"是"，提取排比句式的模板/结构。用 X、Y 代替具体内容，只保留句式骨架。例如原文"耶稣-哭了。耶稣-感到痛苦。耶稣-感到饥饿。"→ 模板："耶稣-X。"。原文"感谢您赐予我健康的身体，感谢您赐予我家人"→ 模板："感谢您赐予我X，"。如果无排比输出"-"' },
                { id: 'parallel_rewrite', name: '排比改写', description: '将文案改写为排比句式' },
            ];

            // 设置 splitColumns 以便 UI 渲染结果列
            setSplitColumns(parallelDetectColumns);

            // 阶段1：逐条检测（只用前2个检测列，parallel_rewrite 由阶段2填充）
            const phase1Columns = parallelDetectColumns.filter(c => c.id !== 'parallel_rewrite');



            // 串行处理避免429（Vertex AI free tier 限制 5-10 RPM）
            let phase1SuccessCount = 0;
            for (let idx = 0; idx < idleItems.length && !stopRef.current; idx++) {
                const item = idleItems[idx];
                try {
                    const result = await callWithRetry(async () => {
                        const ai = getAiInstance();
                        const columnsDesc = phase1Columns.map((col, colIdx) =>
                            `第${colIdx + 1}列【${col.name}】：${col.description || '无特殊要求'}`
                        ).join('\n');
                        const systemPrompt = `${splitModeSystemInstruction}\n\n【处理列定义】\n${columnsDesc}\n\n【输出格式】\n严格按照 ${phase1Columns.length} 列输出，列之间用 ||| 分隔。\n示例：是|||耶稣-X。`;
                        const userPrompt = `请按照列定义处理以下文案，输出 ${phase1Columns.length} 列结果：\n\n${item.originalForeign}\n\n严格按 ||| 分隔输出：`;
                        return await ai.models.generateContent({
                            model: textModel,
                            contents: { role: 'user', parts: [{ text: userPrompt }] },
                            config: { systemInstruction: systemPrompt }
                        });
                    }, `阶段1-${idx + 1}`);

                    const responseText = result.text?.trim() || '';
                    const parts = responseText.split('|||').map((p: string) => p.trim());
                    const splitResults: Record<string, string> = {};
                    phase1Columns.forEach((col, colIdx) => {
                        splitResults[col.id] = parts[colIdx] || '-';
                    });
                    // 阶段1时在排比改写列显示"⏳ 等待阶段2..."
                    splitResults['parallel_rewrite'] = '⏳ 等待阶段2改写...';
                    phase1ResultsMap.set(item.id, splitResults);
                    phase1SuccessCount++;
                    console.log(`[排比模式] 阶段1 (${phase1SuccessCount}/${idleItems.length}): "${item.originalForeign?.substring(0, 30)}..." → ${splitResults['is_parallel']}`);
                    if (stopRef.current) break;
                    setItems(prev => prev.map(i =>
                        i.id === item.id ? { ...i, splitResults: { ...(i.splitResults || {}), ...splitResults } } : i
                    ));
                    showCopyToast(`🔍 【阶段1】${phase1SuccessCount}/${idleItems.length} 检测完成`);
                    // 每次请求间隔 7s，保持在 10 RPM 限制内
                    if (idx < idleItems.length - 1) {
                        await new Promise(resolve => setTimeout(resolve, 7000));
                    }
                } catch (error: any) {
                    if (stopRef.current) break;
                    console.warn(`[排比模式] 阶段1失败: "${item.originalForeign?.substring(0, 30)}..." →`, error.message);
                    setItems(prev => prev.map(i =>
                        i.id === item.id ? { ...i, status: 'error' as const, error: `阶段1检测失败: ${error.message || '未知错误'}` } : i
                    ));
                }
            }

            if (stopRef.current) { setIsProcessing(false); return; }

            // === 阶段2：收集句式 + 改写所有文案 ===
            console.log('[排比模式] ========= 阶段1完成，开始阶段2：改写 =========');
            showCopyToast(`📊 【阶段1完成】检测完毕，正在收集排比句式库...`);

            // 等待1秒让用户看到阶段切换
            await new Promise(resolve => setTimeout(resolve, 1000));

            const collectedPatterns: string[] = [];
            const nonParallelItemIds: string[] = [];
            const parallelItemIds: string[] = [];
            for (const [itemId, results] of phase1ResultsMap) {
                const isParallel = (results['is_parallel'] || '').trim();
                const pattern = (results['parallel_pattern'] || '').trim();
                if (isParallel === '是' && pattern && pattern !== '-') {
                    collectedPatterns.push(pattern);
                    parallelItemIds.push(itemId);
                }
                if (isParallel === '否' || isParallel === '') {
                    nonParallelItemIds.push(itemId);
                }
            }
            const uniquePatterns = [...new Set(collectedPatterns)];
            console.log(`[排比模式] 收集到 ${uniquePatterns.length} 种排比句式:`, uniquePatterns);
            console.log(`[排比模式] 已是排比: ${parallelItemIds.length} 条, 非排比: ${nonParallelItemIds.length} 条`);

            if (uniquePatterns.length === 0) {
                showCopyToast('⚠️ 未检测到排比句式模板，无法进行改写');
                setItems(prev => prev.map(item => item.status === 'processing'
                    ? { ...item, status: 'success' as const, splitResults: { ...(item.splitResults || {}), parallel_rewrite: '未找到可参考的排比句式' } }
                    : item
                ));
            } else {
                // 改写所有成功检测的文案（非排比的用模板改写，已排比的也增强）
                const itemsToRewrite = idleItems.filter(item => phase1ResultsMap.has(item.id));
                showCopyToast(`🔄 【阶段2/2】收集到 ${uniquePatterns.length} 种句式，正在改写 ${itemsToRewrite.length} 条文案...`);
                const patternLibraryPrompt = uniquePatterns.map((p, i) => `${i + 1}. ${p}`).join('\n');

                let phase2SuccessCount = 0;
                for (let idx = 0; idx < itemsToRewrite.length && !stopRef.current; idx++) {
                    const item = itemsToRewrite[idx];
                    const phase1Result = phase1ResultsMap.get(item.id);
                    const isAlreadyParallel = phase1Result?.['is_parallel']?.trim() === '是';
                    try {
                        let systemPrompt: string;
                        let userPrompt: string;

                        if (isAlreadyParallel) {
                            systemPrompt = `你是一个专业的排比句式改写专家。当前文案已经包含排比句式，但需要你进一步优化和增强排比结构，使其更加工整、有力、有节奏感。\n\n【重要规则】\n- 保持原文的语言（中文保持中文，英文保持英文）\n- 保留原文的核心主题和精神含义\n- 保留开头钩子和结尾互动语\n- 增强排比的节奏感、对称性和感染力\n- 排比句数量保持3-7句\n- 只输出改写后的完整文案，不要解释`;
                            userPrompt = `当前文案已有排比结构（模板：${phase1Result?.['parallel_pattern'] || '未知'}），请进一步优化和增强排比效果，使排比更工整、更有力度。\n\n【待优化文案】\n${item.originalForeign}\n\n请直接输出优化后的完整文案：`;
                        } else {
                            systemPrompt = `你是一个专业的排比句式改写专家。你的任务是将没有排比结构的文案，改写为包含排比句式的版本。\n\n【重要规则】\n- 保持原文的语言（中文保持中文，英文保持英文）\n- 保留原文的核心主题和精神含义\n- 保留开头钩子和结尾互动语，只改写正文部分为排比句式\n- 排比句要有节奏感，每句结构一致\n- 排比句数量保持3-7句\n- 只输出改写后的完整文案，不要解释`;
                            userPrompt = `根据当前文案的主题和内容，从以下已收集的排比句式模板中选择最合适的一种，将文案正文改写为该排比结构。\n\n【可用排比句式库】\n${patternLibraryPrompt}\n\n要求：\n1. 选择与当前文案主题最匹配的句式\n2. 保持原文的核心主题和精神含义\n3. 排比句数量保持3-7句\n4. 保持节奏感和力度感\n5. 输出改写后的完整文案\n\n【待改写文案】\n${item.originalForeign}\n\n请直接输出改写后的完整文案：`;
                        }

                        const finalSystemPrompt = systemPrompt;
                        const finalUserPrompt = userPrompt;
                        const result = await callWithRetry(async () => {
                            const ai = getAiInstance();
                            return await ai.models.generateContent({
                                model: textModel,
                                contents: { role: 'user', parts: [{ text: finalUserPrompt }] },
                                config: { systemInstruction: finalSystemPrompt }
                            });
                        }, `阶段2-${idx + 1}`);

                        const responseText = result.text?.trim() || '-';
                        phase2SuccessCount++;
                        console.log(`[排比模式] 阶段2 (${phase2SuccessCount}/${itemsToRewrite.length}): ${isAlreadyParallel ? '增强' : '改写'} "${item.originalForeign?.substring(0, 30)}..."`);
                        if (stopRef.current) break;
                        setItems(prev => prev.map(i =>
                            i.id === item.id ? { ...i, status: 'success' as const, splitResults: { ...(i.splitResults || {}), parallel_rewrite: responseText } } : i
                        ));
                        showCopyToast(`🔄 【阶段2】${phase2SuccessCount}/${itemsToRewrite.length} 改写完成`);
                        if (idx < itemsToRewrite.length - 1) {
                            await new Promise(resolve => setTimeout(resolve, 7000));
                        }
                    } catch (error: any) {
                        if (stopRef.current) break;
                        console.warn(`[排比模式] 阶段2失败: "${item.originalForeign?.substring(0, 30)}..." →`, error.message);
                        setItems(prev => prev.map(i =>
                            i.id === item.id ? { ...i, status: 'error' as const, error: `阶段2改写失败: ${error.message || '未知错误'}` } : i
                        ));
                    }
                }
            }

            showCopyToast(`✅ 排比改写完成！(${uniquePatterns.length} 种句式, 共处理 ${phase1ResultsMap.size} 条)`);
            playCompletionSound();
            console.log('[排比模式] ========= 全部完成 =========');
            setIsProcessing(false);
            if (idleItems.length > 20) { setItems(prev => prev.map(i => ({ ...i, collapsed: true }))); setAllCollapsed(true); }
            return;
        }

        // === 拆分模式专用处理 ===
        if (mode === 'split') {
            if (splitColumns.length === 0) { showCopyToast('请至少添加一个拆分列'); setIsProcessing(false); return; }

            setItems(prev => prev.map(item => item.status === 'idle' ? { ...item, status: 'processing' as const } : item));

            if (batchSize > 1) {
                const BATCH_CONCURRENT = 3;
                const allBatches: CopywritingItem[][] = [];
                for (let i = 0; i < idleItems.length; i += batchSize) allBatches.push(idleItems.slice(i, i + batchSize));
                let batchIdx = 0;
                const runNextBatch = async () => {
                    while (batchIdx < allBatches.length && !stopRef.current) {
                        const currentIdx = batchIdx++;
                        const batchItems = allBatches[currentIdx];
                        try {
                            const batchResults = await processSplitBatch(batchItems);
                            setItems(prev => prev.map(item => {
                                const splitResult = batchResults.get(item.id);
                                return splitResult ? { ...item, status: 'success' as const, splitResults: splitResult } : item;
                            }));
                            const missingItems = batchItems.filter(item => !batchResults.has(item.id));
                            if (missingItems.length > 0) {
                                setItems(prev => prev.map(item =>
                                    missingItems.find(m => m.id === item.id) ? { ...item, status: 'error' as const, error: '批量拆分中未返回结果' } : item
                                ));
                            }
                        } catch (error: any) {
                            setItems(prev => prev.map(item =>
                                batchItems.find(b => b.id === item.id) ? { ...item, status: 'error' as const, error: error.message || '批量拆分失败' } : item
                            ));
                        }
                    }
                };
                const workers = Array(Math.min(BATCH_CONCURRENT, allBatches.length)).fill(null).map(() => runNextBatch());
                await Promise.all(workers);
            } else {
                const SPLIT_CONCURRENT = 3;
                let idx = 0;
                const runNext = async (): Promise<void> => {
                    while (idx < idleItems.length && !stopRef.current) {
                        const currentIdx = idx++;
                        const item = idleItems[currentIdx];
                        if (stopRef.current) return;
                        try {
                            const splitResult = await processSplitItem(item);
                            if (stopRef.current) return;
                            if (splitResult) setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'success' as const, splitResults: splitResult } : i));
                        } catch (error: any) {
                            if (stopRef.current) return;
                            setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'error' as const, error: error.message || '拆分失败' } : i));
                        }
                    }
                };
                const workers = Array(Math.min(SPLIT_CONCURRENT, idleItems.length)).fill(null).map(() => runNext());
                await Promise.all(workers);
            }

            setIsProcessing(false);
            if (idleItems.length > 20) { setItems(prev => prev.map(i => ({ ...i, collapsed: true }))); setAllCollapsed(true); }
            return;
        }

        // === 文案库模式 ===
        if (mode === 'library') {
            const enabledLibs = libraries.filter(l => l.enabled && l.items.length > 0);
            if (enabledLibs.length === 0) {
                alert('请先启用至少一个有条目的库');
                setIsProcessing(false);
                return;
            }

            const ai = getAiInstance();
            const extraInsts = libraryExtraInstructions.filter(i => i.trim());

            // 追踪本批次已选条目，避免重复选同一个
            const recentlyUsedIds: string[] = [];
            // 本地实时计数（解决 setLibraries 异步延迟问题）
            const localUsedCounts = new Map<string, number>();
            const getEffectiveUsedCount = (li: LibraryItem) => li.usedCount + (localUsedCounts.get(li.id) || 0);
            const incrementLocalCount = (id: string) => localUsedCounts.set(id, (localUsedCounts.get(id) || 0) + 1);

            // 逐条处理，确保去重计数准确
            for (let idx = 0; idx < idleItems.length; idx++) {
                if (stopRef.current) break;
                const item = idleItems[idx];

                setItems(prev => prev.map(i =>
                    i.id === item.id ? { ...i, status: 'processing' as const } : i
                ));

                try {
                    // 确定这条文案用哪些库
                    const itemLibIds = item.selectedLibraryIds && item.selectedLibraryIds.length > 0
                        ? item.selectedLibraryIds
                        : enabledLibs.map(l => l.id);
                    const itemLibs = libraries.filter(l => itemLibIds.includes(l.id) && l.items.length > 0);

                    // 构建多库候选列表
                    let allLibsPrompt = '';
                    let hasAvailable = false;
                    // 大库压缩格式阈值：超过此数量用紧凑编号格式，节省token但保留全部候选
                    const COMPACT_THRESHOLD = 200;

                    for (const lib of itemLibs) {
                        const available = lib.items.filter(li => getEffectiveUsedCount(li) < lib.maxRepeat);
                        if (available.length === 0) continue;
                        hasAvailable = true;

                        if (available.length > COMPACT_THRESHOLD) {
                            // 大库：紧凑编号格式，全部发给 AI 做语义匹配
                            // 按优先级分组，高优先级标注
                            const lines = available.map((li, idx) => {
                                const prefix = li.weight >= 7 ? '★' : '';
                                const tagStr = li.tags ? `[${li.tags}]` : '';
                                return `${idx + 1}.${prefix}${tagStr} ${li.content}`;
                            });
                            allLibsPrompt += `\n【库: ${lib.name}】 ${lib.matchRule || '语义匹配最合适的条目'} (${available.length}条, ★=高优先)\n${lines.join('\n')}\n`;
                        } else {
                            // 小库：完整格式
                            const candidateText = available
                                .map(li => {
                                    const pl = li.weight <= 3 ? '低' : li.weight <= 6 ? '中' : li.weight <= 8 ? '高' : '极高';
                                    return `  [${li.id}] (优先级:${pl}, 剩余${lib.maxRepeat - getEffectiveUsedCount(li)}次) ${li.content}`;
                                })
                                .join('\n');
                            allLibsPrompt += `\n【库: ${lib.name}】 ${lib.matchRule || '语义匹配最合适的条目'} (${available.length}条)\n${candidateText}\n`;
                        }
                    }

                    if (!hasAvailable) {
                        if (stopRef.current) break;
                        setItems(prev => prev.map(i =>
                            i.id === item.id ? { ...i, status: 'error' as const, error: '所有库条目全部已达使用上限' } : i
                        ));
                        continue;
                    }

                    const libNames = itemLibs.map(l => l.name);
                    // 构建每个库的可用条目列表（用于编号→条目映射）
                    const libAvailableMap = new Map<string, LibraryItem[]>();
                    for (const lib of itemLibs) {
                        libAvailableMap.set(lib.id, lib.items.filter(li => getEffectiveUsedCount(li) < lib.maxRepeat));
                    }

                    const systemPrompt = libPickOneMode
                        ? `你是一个专业的文案改写专家。

【任务】
1. 分析原始文案内容
2. 从所有候选库的所有条目中，只选择一个最匹配文案主题的条目
3. 将选中的条目融入文案完成改写

【重要规则】
- 必须保持原文语言！英文文案输出英文，中文文案输出中文，绝对不要翻译！
- 只修改指令要求的部分，其余内容保持原样
- 优先选择标★的高优先级条目，但语义匹配更重要
- 只选1条！从所有库的候选中选最合适的那个！
- ⚠️ 每条文案必须选择不同的库条目！尽量多样化选择！${recentlyUsedIds.length > 0 ? `\n- 以下条目已被使用，请避免再选：${recentlyUsedIds.slice(-100).join(', ')}` : ''}

【输出格式】
严格按以下格式输出：
SELECTED: [选中条目的编号或ID]
SELECTED_LIB: [所属库名]
RESULT: [改写后的完整文案，保持原文语言]
RESULT_ZH: [改写后文案的中文翻译]

注意：RESULT后面的改写文案必须完整，保持原文语言！RESULT_ZH是中文翻译（如果原文已经是中文则相同）。`
                        : `你是一个专业的文案改写专家。

【任务】
1. 分析原始文案内容
2. 从每个候选库中各选择一个最匹配的条目（按照每个库的使用指令）
3. 将选中的条目融入文案完成改写

【重要规则】
- 必须保持原文语言！英文文案输出英文，中文文案输出中文，绝对不要翻译！
- 只修改指令要求的部分，其余内容保持原样
- 优先选择标★的高优先级条目，但语义匹配更重要
- ⚠️ 每条文案必须选择不同的库条目！尽量多样化选择！${recentlyUsedIds.length > 0 ? `\n- 以下条目已被使用，请避免再选：${recentlyUsedIds.slice(-100).join(', ')}` : ''}

【输出格式】
严格按以下格式输出：
${libNames.map(n => `SELECTED_${n}: [选中条目的编号或ID]`).join('\n')}
RESULT: [改写后的完整文案，保持原文语言]
RESULT_ZH: [改写后文案的中文翻译]

注意：RESULT后面的改写文案必须完整，保持原文语言！RESULT_ZH是中文翻译（如果原文已经是中文则相同）。`;

                    let userPrompt = `【原始文案】
${item.originalForeign}
${allLibsPrompt}`;

                    if (extraInsts.length > 0) {
                        userPrompt += `\n\n【额外改写要求】\n${extraInsts.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}`;
                    }

                    // API 调用（429 轮换由底层 wrapper 自动处理）
                    const result = await ai.models.generateContent({
                        model: textModel,
                        contents: { role: 'user', parts: [{ text: userPrompt }] },
                        config: { systemInstruction: systemPrompt }
                    });

                    const responseText = result.text?.trim() || '';
                    const resultMatch = responseText.match(/RESULT:\s*(.+?)(?=\nRESULT_ZH:|$)/is);
                    const resultZhMatch = responseText.match(/RESULT_ZH:\s*([\s\S]+)/i);

                    if (stopRef.current) break;

                    if (resultMatch) {
                        const rewrittenText = resultMatch[1].trim();

                        // 解析每个库的选中条目并更新计数（支持编号和ID两种格式）
                        const matchedContents: string[] = [];
                        for (const lib of itemLibs) {
                            const selMatch = responseText.match(new RegExp(`SELECTED_${lib.name}:\\s*\\[?([^\\]\\n]+)\\]?`, 'i'));
                            const selectedValue = selMatch?.[1]?.trim() || '';
                            if (!selectedValue) continue;

                            const available = libAvailableMap.get(lib.id) || [];
                            let matchedItem: LibraryItem | undefined;

                            // 1. 按编号匹配（大库紧凑格式: "42" 或 "42.★ xxx"）
                            const numMatch = selectedValue.match(/^(\d+)/);
                            if (numMatch) {
                                const idx = parseInt(numMatch[1]) - 1;
                                if (idx >= 0 && idx < available.length) {
                                    matchedItem = available[idx];
                                }
                            }
                            // 2. 按 ID 匹配（小库完整格式）
                            if (!matchedItem) {
                                matchedItem = lib.items.find(li => li.id === selectedValue);
                            }
                            // 3. 按内容模糊匹配（兜底）
                            if (!matchedItem && selectedValue.length > 5) {
                                matchedItem = available.find(li => selectedValue.includes(li.content.slice(0, 10)) || li.content.includes(selectedValue.slice(0, 10)));
                            }

                            if (matchedItem) {
                                matchedContents.push(`${lib.name}: ${matchedItem.content}`);
                                recentlyUsedIds.push(matchedItem.id);
                                incrementLocalCount(matchedItem.id);
                                setLibraries(prev => prev.map(l => l.id === lib.id
                                    ? { ...l, items: l.items.map(li => li.id === matchedItem!.id ? { ...li, usedCount: li.usedCount + 1 } : li) }
                                    : l
                                ));
                            }
                        }

                        const chineseText = resultZhMatch?.[1]?.trim() || '';

                        setItems(prev => prev.map(i =>
                            i.id === item.id ? {
                                ...i,
                                status: 'success' as const,
                                resultForeign: rewrittenText,
                                resultChinese: chineseText,
                                libraryMatchedContent: matchedContents.join(' | ')
                            } : i
                        ));
                    } else {
                        setItems(prev => prev.map(i =>
                            i.id === item.id ? { ...i, status: 'error' as const, error: '解析失败: ' + responseText.slice(0, 100) } : i
                        ));
                    }
                } catch (error: any) {
                    if (stopRef.current) break;
                    setItems(prev => prev.map(i =>
                        i.id === item.id ? { ...i, status: 'error' as const, error: error.message || '处理失败' } : i
                    ));
                }
            }

            setIsProcessing(false);
            if (idleItems.length > 20) {
                setItems(prev => prev.map(i => ({ ...i, collapsed: true })));
                setAllCollapsed(true);
            }
            return;
        }

        // === 非拆分模式：过滤掉空指令 ===
        const activeInstructions = instructions.filter(inst => inst.trim());
        if (activeInstructions.length === 0) {
            if (mode === 'social-media') {
                // 自媒体模式：额外指令可选，重复 N 次获得多个结果
                const extraInst = instruction.trim() || '';
                for (let i = 0; i < socialMediaResultCount; i++) {
                    activeInstructions.push(extraInst);
                }
            } else if (instruction.trim()) {
                activeInstructions.push(instruction.trim());
            } else {
                activeInstructions.push(DEFAULT_INSTRUCTION);
            }
        }

        // === 批量处理模式（batchSize > 1，自媒体模式除外）===
        if (batchSize > 1 && mode !== 'social-media') {
            // 设置所有 idle 项目为 processing 状态
            setItems(prev => prev.map(item =>
                item.status === 'idle' ? { ...item, status: 'processing' as const } : item
            ));

            try {
                // 对于每个指令，批量处理所有项目
                for (const inst of activeInstructions) {
                    if (stopRef.current) break;

                    // 分批处理（并发3路）
                    const BATCH_CONCURRENT = 3;
                    const allBatches: CopywritingItem[][] = [];
                    for (let i = 0; i < idleItems.length; i += batchSize) {
                        allBatches.push(idleItems.slice(i, i + batchSize));
                    }
                    let batchIdx = 0;
                    const runNextBatch = async () => {
                        while (batchIdx < allBatches.length && !stopRef.current) {
                            const currentIdx = batchIdx++;
                            const batchItems = allBatches[currentIdx];

                            try {
                                const batchResults = await processBatch(batchItems, inst);

                                // 更新批量结果
                                setItems(prev => prev.map(item => {
                                    const result = batchResults.get(item.id);
                                    if (result) {
                                        const newResult: InstructionResult = {
                                            id: uuidv4(),
                                            instruction: inst,
                                            inputForeign: item.originalForeign,
                                            resultForeign: result.foreign,
                                            resultChinese: result.chinese,
                                            resultExtraParts: result.extraParts,
                                            scriptureNote: result.scriptureNote,
                                            status: 'success',
                                            createdAt: Date.now()
                                        };
                                        return {
                                            ...item,
                                            status: 'success' as const,
                                            resultForeign: result.foreign,
                                            resultChinese: result.chinese,
                                            instructionResults: [...(item.instructionResults || []), newResult],
                                            ...(result.classifyResults ? { classifyResults: result.classifyResults } : {}),
                                        };
                                    }
                                    return item;
                                }));

                                // 对于批量中没有返回结果的项目，标记为失败
                                const missingItems = batchItems.filter(item => !batchResults.has(item.id));
                                if (missingItems.length > 0) {
                                    setItems(prev => prev.map(item => {
                                        if (missingItems.find(m => m.id === item.id)) {
                                            return {
                                                ...item,
                                                status: 'error' as const,
                                                error: '批量处理中未返回结果'
                                            };
                                        }
                                        return item;
                                    }));
                                }
                            } catch (error: any) {
                                // 批次失败，标记该批次所有项目为错误
                                setItems(prev => prev.map(item => {
                                    if (batchItems.find(b => b.id === item.id)) {
                                        return {
                                            ...item,
                                            status: 'error' as const,
                                            error: error.message || '批量处理失败'
                                        };
                                    }
                                    return item;
                                }));
                            }
                        }
                    };
                    const workers = Array(Math.min(BATCH_CONCURRENT, allBatches.length)).fill(null).map(() => runNextBatch());
                    await Promise.all(workers);
                }
            } catch (error: any) {
                console.error('[CopywritingView] Batch processing error:', error);
            }

            setIsProcessing(false);
            return;
        }

        // === 单条处理模式（batchSize === 1）===
        const CONCURRENT_LIMIT = 3; // 同时处理3条

        // 处理单个项目的所有指令（独立执行，每个指令都用原文）
        const processOneWithMultipleInstructions = async (item: CopywritingItem) => {
            if (stopRef.current) return;

            // Set processing status
            setItems(prev => prev.map(i =>
                i.id === item.id ? { ...i, status: 'processing', instructionResults: [] } : i
            ));

            const results: InstructionResult[] = [];
            let lastForeign = '';
            let lastChinese = '';
            let lastExtraParts: string[] | undefined = undefined;

            try {
                if (mode === 'social-media') {
                    // 自媒体模式：所有结果并发请求
                    const smPromises = activeInstructions.map(async (inst) => {
                        if (stopRef.current) return null;
                        const resultId = uuidv4();
                        try {
                            const ai = getAiInstance();
                            const enabledSections = socialMediaOutputSections.filter(s => s.enabled);
                            const sectionInstructions = enabledSections.map((s, si) => `${si + 1}. 【${s.name}】\n   要求: ${s.description}`).join('\n\n');
                            const sectionMarkers = enabledSections.map(s => `===【${s.name}】===`).join('\n...\n');
                            const userPrompt = `${inst}\n\n请根据以下原始文案进行完全改写。\n\n【输出分项要求】\n请严格按照以下分项输出，每个分项用对应的标记分隔：\n\n${sectionInstructions}\n\n【输出格式】\n${sectionMarkers}\n\n【重要】每个分项内的内容必须是干净的纯文本，直接就是可以用的文案。\n严禁在内容中出现：镜头指示（如"镜头平视"）、表演提示（如"眼神坚定"）、括号备注（如"（缓缓说）"）、任何非文案本身的标注。\n标题只输出标题文字本身（每行一个），正文只输出口播稿内容本身。\n\n【原始文案】\n${item.originalForeign}`;

                            // API 调用（429 轮换由底层 wrapper 自动处理）
                            const apiResult = await ai.models.generateContent({
                                model: textModel,
                                contents: { role: 'user', parts: [{ text: userPrompt }] },
                                config: { systemInstruction: socialMediaModeSystemInstruction }
                            });
                            const responseText = apiResult.text?.trim() || '';

                            const parsedSections: { name: string; content: string }[] = [];
                            for (let si = 0; si < enabledSections.length; si++) {
                                const section = enabledSections[si];
                                const marker = `===【${section.name}】===`;
                                const altMarker = `【${section.name}】`;
                                const nextSection = enabledSections[si + 1];
                                const nextMarker = nextSection ? `===【${nextSection.name}】===` : null;
                                const nextAltMarker = nextSection ? `【${nextSection.name}】` : null;
                                let startIdx = responseText.indexOf(marker);
                                let contentStart = startIdx !== -1 ? startIdx + marker.length : -1;
                                if (contentStart === -1) {
                                    const altIdx = responseText.indexOf(altMarker);
                                    contentStart = altIdx !== -1 ? altIdx + altMarker.length : -1;
                                }
                                let contentEnd = responseText.length;
                                if (nextMarker) {
                                    const ni = responseText.indexOf(nextMarker, contentStart > 0 ? contentStart : 0);
                                    if (ni !== -1) contentEnd = ni;
                                    else if (nextAltMarker) {
                                        const nai = responseText.indexOf(nextAltMarker, contentStart > 0 ? contentStart : 0);
                                        if (nai !== -1) contentEnd = nai;
                                    }
                                }
                                parsedSections.push({ name: section.name, content: contentStart !== -1 ? responseText.slice(contentStart, contentEnd).trim() : '' });
                            }
                            // 清除残留的标记文字
                            parsedSections.forEach(s => {
                                s.content = s.content
                                    .replace(new RegExp(`===?【${s.name}】===?`, 'g'), '')
                                    .replace(new RegExp(`【${s.name}】`, 'g'), '')
                                    .trim();
                            });
                            // 配对：每2个分项为一对（英文+中文），生成多个results
                            const halfIdx = Math.ceil(parsedSections.length / 2);
                            const pairedResults: InstructionResult[] = [];
                            for (let pi = 0; pi < halfIdx; pi++) {
                                const enSection = parsedSections[pi];
                                const cnSection = parsedSections[pi + halfIdx];
                                pairedResults.push({
                                    id: uuidv4(), instruction: inst, inputForeign: item.originalForeign,
                                    resultForeign: enSection?.content || '',
                                    resultChinese: cnSection?.content || '',
                                    status: 'success' as const, createdAt: Date.now()
                                });
                            }
                            return pairedResults;
                        } catch (error: any) {
                            return [{
                                id: resultId, instruction: inst, inputForeign: item.originalForeign,
                                resultForeign: '', resultChinese: '',
                                status: 'error' as const,
                                error: getErrorMessage(error),
                                voiceIntegrityIssue: getVoiceIntegrityIssue(error),
                                createdAt: Date.now()
                            }];
                        }
                    });
                    const smResults = (await Promise.all(smPromises)).filter(Boolean).flat() as InstructionResult[];
                    results.push(...smResults);
                    lastForeign = smResults.find(r => r.status === 'success')?.resultForeign || '';
                    lastChinese = smResults.find(r => r.status === 'success')?.resultChinese || '';
                } else {
                    // 非自媒体模式：顺序执行各指令
                    for (let idx = 0; idx < activeInstructions.length; idx++) {
                        if (stopRef.current) break;

                        const inst = activeInstructions[idx];
                        const resultId = uuidv4();

                        try {
                            const ai = getAiInstance();

                            // 根据 mode === "voice" 选择不同的系统提示和输出格式
                            let systemPrompt: string;
                            let userPrompt: string;

                            if (mode === "voice") {
                                // 人声文案模式：使用用户编辑过的系统指令
                                systemPrompt = voiceModeSystemInstruction;
                                userPrompt = `${inst}

原始文案：
${item.originalForeign}

请根据指令为文案添加情感标签，并合理断行用于字幕显示。
只输出最终结果，不要任何解释或标题。
输出格式：加标签结果|||断句结果
其中"加标签结果"是带情感标签的完整文案，"断句结果"是根据标签合理断行后的文案（不带标签，每行不超过4个单词）。
两部分用 ||| 分隔。`;
                            } else if (mode === "classify") {
                                if (classifySubMode === 'advanced') {
                                    // 高级分类模式
                                    const { aiColumns, promptBlock } = buildClassifyPromptInstructions();
                                    if (aiColumns.length > 0) {
                                        const formatExample = aiColumns.map(c => c.name).join('|||');
                                        systemPrompt = promptBlock;
                                        userPrompt = `${inst ? `额外要求：${inst}\n\n` : ''}待分类文案：
${item.originalForeign}

只输出分类结果，格式：${formatExample}
各列用 ||| 分隔，不要编号，不要解释。`;
                                    } else {
                                        systemPrompt = classifyModeSystemInstruction;
                                        userPrompt = `分类规则：
${inst}

待分类文案：
${item.originalForeign}

请根据上述分类规则，只输出分类结果，不要附加任何解释或说明。`;
                                    }
                                } else {
                                    // 常规分类模式
                                    systemPrompt = classifyModeSystemInstruction;
                                    userPrompt = `分类规则：
${inst}

待分类文案：
${item.originalForeign}

请根据上述分类规则，只输出分类结果，不要附加任何解释或说明。`;
                                }
                            } else if (mode === 'prayer') {
                                // 祷告词提炼改写模式 - 使用独立的系统指令
                                systemPrompt = `${PRAYER_MODE_SYSTEM_INSTRUCTION}\n\n【输出规则】\n1. 只输出最终文案，不要任何解释\n2. 输出格式：英文三段式文案|||中文三段式文案\n3. 使用 ||| 作为分隔符\n4. 英文版和中文版都要包含完整的三段（经文来源行、核心正文、If式互动结尾）`;

                                userPrompt = `请提炼改写以下祷告词为三段式双语短视频文案：${inst ? `\n\n额外要求：${inst}` : ''}\n\n原始祷告词：\n${item.originalForeign}\n\n⚠️ 严格要求：\n1. 英文核心正文必须精简到10-30个单词，最多不超过35个单词\n2. 正文只写2-3个短句，每句一个句号结束，不要一句话塞多个逗号\n3. 每段必须完整（经文来源行 + 核心正文 + If式互动结尾）\n4. 输出格式：英文版|||中文版`;
                            } else {

                                // 标准模式：输出外文+中文翻译
                                // 如果用户指令中已包含 ||| 格式定义，则不覆盖输出格式
                                const hasCustomFormat = inst.includes('|||');
                                if (rewriteVariantCount > 1) {
                                    systemPrompt = `${systemInstruction}\n\n【输出规则】\n1. 请生成 ${rewriteVariantCount} 个不同的改写版本\n2. 每个版本用编号标记，格式如下：\n[1] 改写版本1外文|||中文翻译1\n[2] 改写版本2外文|||中文翻译2\n..以此类推\n3. 每个版本之间的改写风格/措辞应有所不同\n4. 不要任何额外解释`;
                                    userPrompt = `改写指令：\n${inst}\n\n原始外文：\n${item.originalForeign}\n\n请严格按照指令改写，只修改指令要求的部分，其他保持原样。\n请生成 ${rewriteVariantCount} 个不同的改写版本，输出格式：\n[1] 改写后的外文|||中文翻译\n[2] 改写后的外文|||中文翻译\n...共 ${rewriteVariantCount} 个版本`;
                                } else {
                                    systemPrompt = hasCustomFormat
                                        ? `${systemInstruction}\n\n【输出规则】\n1. 严格按照用户指令中定义的输出格式输出\n2. 使用 ||| 作为分隔符\n3. 不要任何额外解释`
                                        : `${systemInstruction}\n\n【输出规则】\n1. 只输出最终文案，不要任何解释\n2. 输出格式：改写后的外文|||中文翻译\n3. 使用 ||| 作为分隔符`;

                                    userPrompt = `改写指令：\n${inst}\n\n原始外文：\n${item.originalForeign}\n\n请严格按照指令改写，只修改指令要求的部分，其他保持原样。输出格式：改写后的外文|||中文翻译`;
                                }
                            }

                            // API 调用（429 轮换由底层 wrapper 自动处理）
                            const apiResult = await ai.models.generateContent({
                                model: textModel,
                                contents: { role: 'user', parts: [{ text: userPrompt }] },
                                config: { systemInstruction: systemPrompt }
                            });

                            const responseText = apiResult.text?.trim() || '';

                            if (mode === "voice") {
                                // 人声文案模式：解析两个结果（加标签结果|||断句结果）
                                const parts = responseText.split('|||');
                                if (parts.length >= 1 && parts[0].trim()) {
                                    lastForeign = parts[0].trim(); // 加标签结果
                                    
                                    if (voiceWrapMode === 'script') {
                                        // 脚本断行模式：清除标签和省略号后执行本地脚本断行
                                        const cleanText = lastForeign.replace(/\[.*?\]/g, '').replace(/\.{2,}/g, '').trim();
                                        lastChinese = autoWrapText(cleanText, 18);
                                    } else {
                                        // AI 断行模式：使用 AI 输出的第二部分
                                        if (parts.length >= 2) {
                                            lastChinese = parts[1].trim().replace(/\\n/g, '\n');
                                        } else {
                                            lastChinese = ''; // AI未返回第二部分时的 fallback
                                        }
                                    }
                                    
                                    validateVoiceModeIntegrity(item.originalForeign, lastForeign, lastChinese);
                                    results.push({
                                        id: resultId,
                                        instruction: inst,
                                        inputForeign: item.originalForeign,
                                        resultForeign: lastForeign,
                                        resultChinese: lastChinese,
                                        status: 'success',
                                        createdAt: Date.now()
                                    });
                                } else {
                                    // 解析失败，抛出错误
                                    throw new Error('断句解析失败：AI 未按格式返回结果');
                                }
                            } else if (mode === "classify") {
                                if (classifySubMode === 'advanced') {
                                    // 高级分类模式：解析多列结果
                                    const { aiColumns } = buildClassifyPromptInstructions();
                                    const aiResults = parseClassifyAIResult(responseText.trim(), aiColumns);
                                    const localResults = computeLocalClassifyColumns(item.originalForeign);
                                    const allResults = { ...aiResults, ...localResults };

                                    // 构建显示字符串
                                    const enabledCols = classifyColumns.filter(c => c.enabled);
                                    const displayParts = enabledCols.map(c => `${c.name}:${allResults[c.id] || '-'}`);
                                    lastForeign = displayParts.join(' | ');
                                    lastChinese = '';

                                    // 存储classifyResults
                                    setItems(prev => prev.map(i =>
                                        i.id === item.id ? { ...i, classifyResults: allResults } : i
                                    ));
                                } else {
                                    // 常规分类模式：直接使用分类结果
                                    lastForeign = responseText.trim();
                                    lastChinese = '';
                                }
                                results.push({
                                    id: resultId,
                                    instruction: inst,
                                    inputForeign: item.originalForeign,
                                    resultForeign: lastForeign,
                                    resultChinese: lastChinese,
                                    status: 'success',
                                    createdAt: Date.now()
                                });
                            } else {
                                // 标准模式：解析 ||| 分隔符
                                if (rewriteVariantCount > 1) {
                                    const variantPattern = /\[(\d+)\]\s*/g;
                                    const blocks: string[] = [];
                                    let match: RegExpExecArray | null;
                                    const allMatches: { idx: number; pos: number }[] = [];
                                    while ((match = variantPattern.exec(responseText)) !== null) {
                                        allMatches.push({ idx: parseInt(match[1]), pos: match.index + match[0].length });
                                    }
                                    if (allMatches.length >= 2) {
                                        for (let mi = 0; mi < allMatches.length; mi++) {
                                            const start = allMatches[mi].pos;
                                            const end = mi + 1 < allMatches.length ? allMatches[mi + 1].pos - `[${allMatches[mi + 1].idx}]`.length - 1 : responseText.length;
                                            blocks.push(responseText.slice(start, end).trim());
                                        }
                                    } else {
                                        blocks.push(...responseText.split('\n').filter((l: string) => l.includes('|||')));
                                    }
                                    let pushedAny = false;
                                    for (let vi = 0; vi < blocks.length; vi++) {
                                        const parts = blocks[vi].split('|||');
                                        if (parts.length >= 2 && parts[0].trim()) {
                                            pushedAny = true;
                                            const f = parts[0].trim();
                                            const c = parts[1].trim();
                                            results.push({
                                                id: `${resultId}_v${vi}`,
                                                instruction: `${inst}${blocks.length > 1 ? ` [版本${vi + 1}]` : ''}`,
                                                inputForeign: item.originalForeign,
                                                resultForeign: f,
                                                resultChinese: c,
                                                status: 'success',
                                                createdAt: Date.now()
                                            });
                                            if (vi === 0) {
                                                lastForeign = f;
                                                lastChinese = c;
                                            }
                                        }
                                    }
                                    if (!pushedAny) throw new Error('多结果解析失败：AI 未按格式返回结果');
                                } else {
                                    const parts = responseText.split('|||');
                                    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
                                        lastForeign = parts[0].trim();
                                        lastChinese = parts[1].trim();
                                        if (parts.length > 2) {
                                            lastExtraParts = parts.slice(2).map((p: string) => p.trim());
                                        } else {
                                            lastExtraParts = undefined;
                                        }
                                        results.push({
                                            id: resultId,
                                            instruction: inst,
                                            inputForeign: item.originalForeign,
                                            resultForeign: lastForeign,
                                            resultChinese: lastChinese,
                                            resultExtraParts: lastExtraParts,
                                            status: 'success',
                                            createdAt: Date.now()
                                        });
                                    } else {
                                        throw new Error('翻译解析失败：AI 未按格式返回结果');
                                    }
                                }
                            }

                            // 更新UI显示进度
                            setItems(prev => prev.map(i =>
                                i.id === item.id ? {
                                    ...i,
                                    instructionResults: [...results],
                                    resultForeign: lastForeign,
                                    resultChinese: lastChinese,
                                    rawResponse: responseText
                                } : i
                            ));

                        } catch (error: any) {
                            results.push({
                                id: resultId,
                                instruction: inst,
                                inputForeign: item.originalForeign,
                                resultForeign: '',
                                resultChinese: '',
                                status: 'error',
                                error: getErrorMessage(error),
                                voiceIntegrityIssue: getVoiceIntegrityIssue(error),
                                createdAt: Date.now()
                            });
                            // 出错后继续下一个指令，使用之前的输入
                        }
                    }
                } // end else (non-social-media sequential)

                // 完成：设置最终状态
                const hasError = results.some(r => r.status === 'error');
                if (stopRef.current) return; // 停止后不更新
                setItems(prev => prev.map(i =>
                    i.id === item.id ? {
                        ...i,
                        instructionResults: results,
                        resultForeign: lastForeign,
                        resultChinese: lastChinese,
                        status: hasError ? 'error' : 'success'
                    } : i
                ));

            } catch (error: any) {
                if (stopRef.current) return; // 停止后不更新
                setItems(prev => prev.map(i =>
                    i.id === item.id ? {
                        ...i,
                        status: 'error',
                        error: getErrorMessage(error),
                        voiceIntegrityIssue: getVoiceIntegrityIssue(error)
                    } : i
                ));
            }
        };

        // 并发处理，分批执行
        for (let i = 0; i < idleItems.length; i += CONCURRENT_LIMIT) {
            if (stopRef.current) break;

            const batch = idleItems.slice(i, i + CONCURRENT_LIMIT);
            await Promise.all(batch.map(item => processOneWithMultipleInstructions(item)));

            // 批次之间稍微延迟避免 API 限流
            if (i + CONCURRENT_LIMIT < idleItems.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        setIsProcessing(false);
        playCompletionSound();
        // 条目多时自动折叠
        if (idleItems.length > 20) {
            setItems(prev => prev.map(i => ({ ...i, collapsed: true })));
            setAllCollapsed(true);
        }
    };

    // --- Stop processing ---
    const handleStopProcessing = () => {
        stopRef.current = true;
        setIsProcessing(false);
        // 把所有还在 processing 的项目恢复为 idle
        setItems(prev => prev.map(item =>
            item.status === 'processing' ? { ...item, status: 'idle' as const } : item
        ));
    };

    // --- Copy functions (无空行) ---
    const handleCopy = (type: 'foreign' | 'chinese' | 'both' | 'all') => {
        // 库模式：结果存在 item.resultForeign / item.resultChinese，不在 instructionResults 里
        if (mode === 'library') {
            const successItems = items.filter(item => item.status === 'success' && item.resultForeign);
            if (successItems.length === 0) return;

            let headers: string[] = [];
            let rows: string[] = [];

            switch (type) {
                case 'foreign':
                    headers = ['改写结果'];
                    rows = successItems.map(item => escapeForSheet(item.resultForeign || ''));
                    break;
                case 'chinese':
                    headers = ['中文翻译'];
                    rows = successItems.map(item => escapeForSheet(item.resultChinese || ''));
                    break;
                case 'both':
                    headers = ['改写结果', '中文翻译'];
                    rows = successItems.map(item => `${escapeForSheet(item.resultForeign || '')}\t${escapeForSheet(item.resultChinese || '')}`);
                    break;
                case 'all':
                    headers = ['原文', '改写结果', '中文翻译', '匹配库条目'];
                    rows = successItems.map(item =>
                        `${escapeForSheet(item.originalForeign)}\t${escapeForSheet(item.resultForeign || '')}\t${escapeForSheet(item.resultChinese || '')}\t${escapeForSheet(item.libraryMatchedContent || '')}`
                    );
                    break;
            }

            const text = [headers.join('\t'), ...rows].join('\n');
            navigator.clipboard.writeText(text);
            setCopiedType(type);
            showCopyToast(`已复制${successItems.length}条结果`);
            setTimeout(() => setCopiedType(null), 2000);
            return;
        }

        // 清理模式：结果存在 item.resultForeign / resultChinese / instructionResults[0].resultExtraParts
        if (mode === 'cleaner') {
            const successItems = items.filter(item => item.status === 'success');
            if (successItems.length === 0) return;

            let headers: string[] = [];
            let rows: string[] = [];

            const getExtraParts = (item: typeof items[0]) => {
                const result = item.instructionResults?.[0];
                return result?.resultExtraParts || [];
            };

            switch (type) {
                case 'foreign':
                    headers = ['清理后原文'];
                    rows = successItems.map(item => escapeForSheet(item.resultForeign || ''));
                    break;
                case 'chinese':
                    headers = ['中文翻译'];
                    rows = successItems.map(item => {
                        const extra = getExtraParts(item);
                        return escapeForSheet(extra[0] || item.resultChinese || '');
                    });
                    break;
                case 'both':
                    headers = ['清理后原文', '英文翻译', '中文翻译', '删除说明'];
                    rows = successItems.map(item => {
                        const extra = getExtraParts(item);
                        return [
                            escapeForSheet(item.resultForeign || ''),
                            escapeForSheet(item.resultChinese || ''),
                            escapeForSheet(extra[0] || ''),
                            escapeForSheet(extra[1] || '')
                        ].join('\t');
                    });
                    break;
                case 'all':
                    headers = ['原文', '清理后原文', '英文翻译', '中文翻译', '删除说明'];
                    rows = successItems.map(item => {
                        const extra = getExtraParts(item);
                        return [
                            escapeForSheet(item.originalForeign),
                            escapeForSheet(item.resultForeign || ''),
                            escapeForSheet(item.resultChinese || ''),
                            escapeForSheet(extra[0] || ''),
                            escapeForSheet(extra[1] || '')
                        ].join('\t');
                    });
                    break;
            }

            const text = [headers.join('\t'), ...rows].join('\n');
            navigator.clipboard.writeText(text);
            setCopiedType(type);
            showCopyToast(`已复制${successItems.length}条结果`);
            setTimeout(() => setCopiedType(null), 2000);
            return;
        }

        // 包含所有可复制项目；兼容历史数据（只有 resultForeign/resultChinese，没有 instructionResults）
        const allItems = items.filter(item =>
            (item.instructionResults && item.instructionResults.length > 0) ||
            (item.status === 'success' && !!(item.resultForeign || item.resultChinese))
        );
        if (allItems.length === 0) return;

        const getResultsForCopy = (item: CopywritingItem): InstructionResult[] => {
            if (item.instructionResults && item.instructionResults.length > 0) return item.instructionResults;
            return [{
                id: `fallback_${item.id}`,
                instruction: '',
                inputForeign: item.originalForeign,
                resultForeign: item.resultForeign || '',
                resultChinese: item.resultChinese || '',
                status: 'success',
                createdAt: 0
            }];
        };

        // 计算最大指令数
        const instructionCount = Math.max(...allItems.map(item => getResultsForCopy(item).length));

        // 计算最大额外列数（resultExtraParts，即 ||| 分隔的第3、4...列）
        const maxExtraPartsCount = Math.max(0, ...allItems.map(item =>
            getResultsForCopy(item).reduce((max, r) => Math.max(max, r.resultExtraParts?.length || 0), 0)
        ));

        let headers: string[] = [];
        let rows: string[] = [];

        // 根据 mode === "voice" 决定列名
        const col1Name = mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文';
        const col2Name = mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文';

        switch (type) {
            case 'foreign':
                // 表头：指令1外文/加标签, 指令2外文/加标签...
                headers = Array.from({ length: instructionCount }, (_, i) => `指令${i + 1}${col1Name}`);
                rows = allItems.map(item => {
                    const results = getResultsForCopy(item);
                    return Array.from({ length: instructionCount }, (_, i) =>
                        results[i]?.status === 'success' ? escapeForSheet(results[i].resultForeign) : ''
                    ).join('\t');
                });
                break;
            case 'chinese':
                // 表头：指令1中文/断句, 指令2中文/断句...
                headers = Array.from({ length: instructionCount }, (_, i) => `指令${i + 1}${col2Name}`);
                rows = allItems.map(item => {
                    const results = getResultsForCopy(item);
                    return Array.from({ length: instructionCount }, (_, i) =>
                        results[i]?.status === 'success' ? escapeForSheet(results[i].resultChinese) : ''
                    ).join('\t');
                });
                break;
            case 'both':
                // 表头：指令1外文/加标签, 指令1中文/断句, [额外列3, 列4...], 指令2外文/加标签, 指令2中文/断句...
                headers = [];
                for (let i = 0; i < instructionCount; i++) {
                    headers.push(`指令${i + 1}${col1Name}`, `指令${i + 1}${col2Name}`);
                }
                // 追加额外列表头
                for (let p = 0; p < maxExtraPartsCount; p++) {
                    headers.push(`列${p + 3}`);
                }
                rows = allItems.map(item => {
                    const results = getResultsForCopy(item);
                    const row: string[] = [];
                    for (let i = 0; i < instructionCount; i++) {
                        if (results[i]?.status === 'success') {
                            row.push(escapeForSheet(results[i].resultForeign), escapeForSheet(results[i].resultChinese));
                        } else {
                            row.push('', '');
                        }
                    }
                    // 追加额外列数据
                    for (let p = 0; p < maxExtraPartsCount; p++) {
                        // 从所有指令结果中收集第p个额外列（取第一个有值的）
                        let extraVal = '';
                        for (let i = 0; i < instructionCount; i++) {
                            const parts = results[i]?.resultExtraParts;
                            if (parts && parts[p]) { extraVal = parts[p]; break; }
                        }
                        row.push(escapeForSheet(extraVal));
                    }
                    return row.join('\t');
                });
                break;
            case 'all':
                // 表头：原始外文/原文, 原始中文/原中文, 指令1外文/加标签, 指令1中文/断句, [额外列3, 列4...]
                headers = [mode === "voice" ? '原文' : '原始外文', mode === "voice" ? '原中文' : '原始中文'];
                for (let i = 0; i < instructionCount; i++) {
                    headers.push(`指令${i + 1}${col1Name}`, `指令${i + 1}${col2Name}`);
                }
                // 追加额外列表头
                for (let p = 0; p < maxExtraPartsCount; p++) {
                    headers.push(`列${p + 3}`);
                }
                rows = allItems.map(item => {
                    const results = getResultsForCopy(item);
                    const row = [escapeForSheet(item.originalForeign), escapeForSheet(item.originalChinese || '')];
                    for (let i = 0; i < instructionCount; i++) {
                        if (results[i]?.status === 'success') {
                            row.push(escapeForSheet(results[i].resultForeign), escapeForSheet(results[i].resultChinese));
                        } else {
                            row.push('', '');
                        }
                    }
                    // 追加额外列数据
                    for (let p = 0; p < maxExtraPartsCount; p++) {
                        let extraVal = '';
                        for (let i = 0; i < instructionCount; i++) {
                            const parts = results[i]?.resultExtraParts;
                            if (parts && parts[p]) { extraVal = parts[p]; break; }
                        }
                        row.push(escapeForSheet(extraVal));
                    }
                    return row.join('\t');
                });
                break;
        }

        const text = [headers.join('\t'), ...rows].join('\n');
        navigator.clipboard.writeText(text);
        setCopiedType(type);
        showCopyToast(`已复制${allItems.length}条结果`);
        setTimeout(() => setCopiedType(null), 2000);
    };

    // --- Export ---
    const handleExport = () => {
        const successItems = items.filter(item => item.status === 'success');
        if (successItems.length === 0) return;

        // 为TSV格式化：用引号包裹，内部引号转义
        const escapeForSheet = (text: string) => {
            const t = text || '';
            if (t.includes('\t') || t.includes('\n') || t.includes('\r') || t.includes('"')) {
                return `"${t.replace(/"/g, '""')}"`;
            }
            return t;
        };

        let content: string;

        if (mode === 'classify' && classifySubMode === 'advanced' && successItems.some(i => i.classifyResults)) {
            // 多维分类导出：原文 + 各分类维度列
            const enabledCols = classifyColumns.filter(c => c.enabled);
            const header = ['原始外文', ...enabledCols.map(c => c.name)].join('\t');
            content = header + '\n';
            successItems.forEach(item => {
                const row = [
                    escapeForSheet(item.originalForeign),
                    ...enabledCols.map(c => escapeForSheet(item.classifyResults?.[c.id] || '-'))
                ];
                content += row.join('\t') + '\n';
            });
        } else {
            content = '原始外文\t原始中文\t改写后外文\t改写后中文\n';
            successItems.forEach(item => {
                content += `${escapeForSheet(item.originalForeign)}\t${escapeForSheet(item.originalChinese || '')}\t${escapeForSheet(item.resultForeign || '')}\t${escapeForSheet(item.resultChinese || '')}\n`;
            });
        }

        const blob = new Blob([content], { type: 'text/tab-separated-values;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `copywriting_export_${new Date().toISOString().slice(0, 10)}.tsv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // --- Preset management ---
    const handleSelectPreset = (preset: CopywritingPreset) => {
        setInstruction(preset.instruction);
        setSelectedPresetId(preset.id);
        setShowPresetDropdown(false);
    };

    const handleSavePreset = () => {
        // 获取第一个非空指令
        const firstInstruction = instructions.find(i => i.trim());
        if (!firstInstruction) return;

        // 打开保存预设modal
        setNewPresetName(firstInstruction.slice(0, 20) + '...');
        setShowSavePreset(true);
    };

    const confirmSavePreset = async () => {
        const firstInstruction = instructions.find(i => i.trim());
        if (!firstInstruction || !newPresetName.trim()) return;

        const newPreset: CopywritingPreset = {
            id: uuidv4(),
            name: newPresetName.trim(),
            instruction: firstInstruction.trim(),
            createdAt: Date.now(),
            presetCategory: mode === 'classify' ? '分类预设' : '改写预设'
        };

        const newPresets = [...presets, newPreset];
        setPresets(newPresets);
        await savePresetsToFirebase(newPresets);

        setShowSavePreset(false);
        setNewPresetName('');
        showCopyToast(`已保存预设: ${newPresetName.trim()}`);
    };

    const handleDeletePreset = async (presetId: string, e: React.MouseEvent) => {
        e.stopPropagation();

        const newPresets = presets.filter(p => p.id !== presetId);
        setPresets(newPresets);
        await savePresetsToFirebase(newPresets);

        if (selectedPresetId === presetId) {
            setSelectedPresetId(null);
        }
    };

    // --- Reset item to idle ---
    const handleRetryItem = (id: string) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, status: 'idle', error: undefined, voiceIntegrityIssue: undefined } : item
        ));
    };

    // --- 一键重试所有失败的项目 ---
    const handleRetryAllErrors = () => {
        setItems(prev => prev.map(item =>
            item.status === 'error'
                ? { ...item, status: 'idle', error: undefined, voiceIntegrityIssue: undefined, instructionResults: [] }
                : item
        ));
        // 设置标志，等 items 更新后自动开始
        setPendingRetryStart(true);
    };

    // 监听 pendingRetryStart，当 items 更新后自动开始处理
    useEffect(() => {
        if (pendingRetryStart && items.some(i => i.status === 'idle')) {
            setPendingRetryStart(false);
            handleStartProcessing();
        }
    }, [pendingRetryStart, items]);

    // --- Process single item (重试/单条处理) - 支持多指令 + 库模式 ---
    const handleProcessSingleItem = async (item: CopywritingItem) => {
        setItems(prev => prev.map(i =>
            i.id === item.id ? { ...i, status: 'processing', instructionResults: [], voiceIntegrityIssue: undefined } : i
        ));

        try {
            // === 字数分类模式（本地） ===
            if (mode === 'classify' && classifyByWordCount) {
                const charCount = item.originalForeign.length;
                const category = classifyByLength(item.originalForeign);
                const displayResult = `${category} (${charCount}字)`;
                const newResult: InstructionResult = {
                    id: uuidv4(),
                    instruction: `按字数分类 (${wordCountRangesText})`,
                    inputForeign: item.originalForeign,
                    resultForeign: displayResult,
                    resultChinese: `${charCount}字`,
                    status: 'success',
                    createdAt: Date.now()
                };
                setItems(prev => prev.map(i =>
                    i.id === item.id ? {
                        ...i,
                        status: 'success' as const,
                        resultForeign: displayResult,
                        resultChinese: `${charCount}字`,
                        instructionResults: [newResult]
                    } : i
                ));
                return;
            }

            // === 库模式：复用批量处理的库匹配逻辑 ===
            if (mode === 'library') {
                const enabledLibs = libraries.filter(l => l.enabled && l.items.length > 0);
                if (enabledLibs.length === 0) throw new Error('请先启用至少一个有条目的库');
                const ai = getAiInstance();
                const extraInsts = libraryExtraInstructions.filter(i => i.trim());
                const itemLibIds = item.selectedLibraryIds && item.selectedLibraryIds.length > 0
                    ? item.selectedLibraryIds : enabledLibs.map(l => l.id);
                const itemLibs = libraries.filter(l => itemLibIds.includes(l.id) && l.items.length > 0);
                const COMPACT_THRESHOLD = 200;
                let allLibsPrompt = '';
                let hasAvailable = false;
                const libAvailableMap = new Map<string, LibraryItem[]>();
                for (const lib of itemLibs) {
                    const available = lib.items.filter(li => li.usedCount < lib.maxRepeat);
                    if (available.length === 0) continue;
                    hasAvailable = true;
                    libAvailableMap.set(lib.id, available);
                    if (available.length > COMPACT_THRESHOLD) {
                        const lines = available.map((li, idx) => {
                            const prefix = li.weight >= 7 ? '★' : '';
                            const tagStr = li.tags ? `[${li.tags}]` : '';
                            return `${idx + 1}.${prefix}${tagStr} ${li.content}`;
                        });
                        allLibsPrompt += `\n【库: ${lib.name}】 ${lib.matchRule || '语义匹配最合适的条目'} (${available.length}条, ★=高优先)\n${lines.join('\n')}\n`;
                    } else {
                        const candidateText = available.map(li => {
                            const pl = li.weight <= 3 ? '低' : li.weight <= 6 ? '中' : li.weight <= 8 ? '高' : '极高';
                            return `  [${li.id}] (优先级:${pl}, 剩余${lib.maxRepeat - li.usedCount}次) ${li.content}`;
                        }).join('\n');
                        allLibsPrompt += `\n【库: ${lib.name}】 ${lib.matchRule || '语义匹配最合适的条目'} (${available.length}条)\n${candidateText}\n`;
                    }
                }
                if (!hasAvailable) throw new Error('所有库条目全部已达使用上限');
                const libNames = itemLibs.map(l => l.name);
                const sysPrompt = `你是一个专业的文案改写专家。\n\n【任务】\n1. 分析原始文案内容\n2. 从每个候选库中各选择一个最匹配的条目\n3. 将选中的条目融入文案完成改写\n\n【重要规则】\n- 必须保持原文语言！\n- 只修改指令要求的部分，其余保持原样\n- 优先选择标★的条目，但语义匹配更重要\n${item.resultForeign ? `- ⚠️ 这是重试！请选择与上次不同的条目！上次用了: ${item.libraryMatchedContent || '未知'}` : ''}\n\n【输出格式】\n${libNames.map(n => `SELECTED_${n}: [选中条目的编号或ID]`).join('\n')}\nRESULT: [改写后的完整文案]\nRESULT_ZH: [中文翻译]`;
                let userPrompt = `【原始文案】\n${item.originalForeign}\n${allLibsPrompt}`;
                if (extraInsts.length > 0) userPrompt += `\n\n【额外要求】\n${extraInsts.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}`;
                const result = await ai.models.generateContent({ model: textModel, contents: { role: 'user', parts: [{ text: userPrompt }] }, config: { systemInstruction: sysPrompt } });
                const responseText = result.text?.trim() || '';
                const resultMatch = responseText.match(/RESULT:\s*(.+?)(?=\nRESULT_ZH:|$)/is);
                const resultZhMatch = responseText.match(/RESULT_ZH:\s*([\s\S]+)/i);
                if (resultMatch) {
                    const rewrittenText = resultMatch[1].trim();
                    const matchedContents: string[] = [];
                    for (const lib of itemLibs) {
                        const selMatch = responseText.match(new RegExp(`SELECTED_${lib.name}:\\s*\\[?([^\\]\\n]+)\\]?`, 'i'));
                        const selectedValue = selMatch?.[1]?.trim() || '';
                        if (!selectedValue) continue;
                        const available = libAvailableMap.get(lib.id) || [];
                        let matchedItem: LibraryItem | undefined;
                        const numMatch = selectedValue.match(/^(\d+)/);
                        if (numMatch) { const idx = parseInt(numMatch[1]) - 1; if (idx >= 0 && idx < available.length) matchedItem = available[idx]; }
                        if (!matchedItem) matchedItem = lib.items.find(li => li.id === selectedValue);
                        if (!matchedItem && selectedValue.length > 5) matchedItem = available.find(li => selectedValue.includes(li.content.slice(0, 10)) || li.content.includes(selectedValue.slice(0, 10)));
                        if (matchedItem) {
                            matchedContents.push(`${lib.name}: ${matchedItem.content}`);
                            setLibraries(prev => prev.map(l => l.id === lib.id ? { ...l, items: l.items.map(li => li.id === matchedItem!.id ? { ...li, usedCount: li.usedCount + 1 } : li) } : l));
                        }
                    }
                    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'success' as const, resultForeign: rewrittenText, resultChinese: resultZhMatch?.[1]?.trim() || '', libraryMatchedContent: matchedContents.join(' | ') } : i));
                } else {
                    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'error' as const, error: '解析失败: ' + responseText.slice(0, 100) } : i));
                }
                return;
            }


            // 过滤有效指令
            let validInstructions = instructions.filter(inst => inst.trim());
            if (validInstructions.length === 0) {
                if (mode === 'social-media') {
                    // 自媒体模式：额外指令可选，为空时用默认空指令
                    validInstructions = [''];
                } else {
                    throw new Error('请输入至少一条有效指令');
                }
            }

            const instructionResults: InstructionResult[] = [];

            // 独立执行每个指令（每个都用原文作为输入）
            for (let i = 0; i < validInstructions.length; i++) {
                const inst = validInstructions[i];
                try {
                    const result = await processItemWithInstruction(
                        item, // 始终用原文
                        inst
                    );
                    if (result) {
                        // 多结果变体模式：result 是数组
                        if (Array.isArray(result) && (result as any)._isMultiVariant) {
                            const variants = result as { foreign: string; chinese: string }[];
                            for (let vi = 0; vi < variants.length; vi++) {
                                instructionResults.push({
                                    id: `${item.id}_inst_${i}_v${vi}`,
                                    instruction: `${inst}${variants.length > 1 ? ` [版本${vi + 1}]` : ''}`,
                                    inputForeign: item.originalForeign,
                                    resultForeign: variants[vi].foreign,
                                    resultChinese: variants[vi].chinese,
                                    status: 'success',
                                    createdAt: Date.now()
                                });
                            }
                        } else {
                            instructionResults.push({
                                id: `${item.id}_inst_${i}`,
                                instruction: inst,
                                inputForeign: item.originalForeign,
                                resultForeign: (result as any).foreign,
                                resultChinese: (result as any).chinese,
                                resultExtraParts: (result as any).extraParts,
                                scriptureNote: (result as any).scriptureNote,
                                status: 'success',
                                createdAt: Date.now()
                            });
                        }
                    }
                } catch (err: any) {
                    instructionResults.push({
                        id: `${item.id}_inst_${i}`,
                        instruction: inst,
                        inputForeign: item.originalForeign,
                        resultForeign: '',
                        resultChinese: '',
                        status: 'error',
                        error: getErrorMessage(err),
                        voiceIntegrityIssue: getVoiceIntegrityIssue(err),
                        createdAt: Date.now()
                    });
                }
            }

            // 最终结果取最后一个成功的指令结果
            const lastSuccess = [...instructionResults].reverse().find(r => r.status === 'success');

            setItems(prev => prev.map(i =>
                i.id === item.id ? {
                    ...i,
                    instructionResults,
                    resultForeign: lastSuccess?.resultForeign || '',
                    resultChinese: lastSuccess?.resultChinese || '',
                    status: instructionResults.some(r => r.status === 'success') ? 'success' : 'error',
                    error: instructionResults.every(r => r.status === 'error') ? '所有指令执行失败' : undefined,
                    voiceIntegrityIssue: instructionResults.find(r => r.status === 'error' && r.voiceIntegrityIssue)?.voiceIntegrityIssue
                } : i
            ));
        } catch (error: any) {
            setItems(prev => prev.map(i =>
                i.id === item.id ? {
                    ...i,
                    status: 'error',
                    error: getErrorMessage(error),
                    voiceIntegrityIssue: getVoiceIntegrityIssue(error)
                } : i
            ));
        }
    };

    // --- Process item with specific instruction ---
    const processItemWithInstruction = async (item: CopywritingItem, itemInstruction: string): Promise<{ foreign: string; chinese: string; scriptureNote?: string; extraParts?: string[]; rawResponse?: string } | null> => {
        try {
            const ai = getAiInstance();

            // 根据 mode === "voice" 选择不同的系统提示和输出格式（与批量处理一致）
            let systemPrompt: string;
            let userPrompt: string;

            let deityRules = '';
            if (settings) {
                if (settings.deityTerms && settings.deityTerms.length > 0) {
                    deityRules += `\n\n【Capitalization Rules (CRITICAL)】\nIf generating English, you MUST capitalize the first letter of these specific religious terms and pronouns: ${settings.deityTerms.join(', ')}.\n`;
                    if (settings.applyDeityCapitalizationToAll) {
                        deityRules += `For any other output language, you MUST also capitalize the corresponding translated terms for these words.\n`;
                    }
                }
                if (settings.enableScriptureDetection) {
                    deityRules += `\n【SCRIPTURE QUOTATION RULES (CRITICAL FOR COPYRIGHT)】\n1. Detect if the source text contains any religious scriptures (e.g., from the Bible).\n2. If scriptures are detected, you MUST NOT translate them yourself.\n3. You MUST quote the exact official text from the specified version: 【${settings.scriptureVersion}】.\n4. If the exact quote from the specified version cannot be found, keep the original language or add a note, but DO NOT create a new translation.\n5. You MUST append a scripture feedback message to the end of the Chinese translation, separated by "|||".\n   - If NO scripture is detected, append: "|||不包含经文"\n   - If a scripture is detected and you modified it to the specified version, append: "|||经文已修改为【${settings.scriptureVersion}】"\n   - If a scripture is detected but it's already the correct version or no modification was needed, append: "|||不需要修改，当前是【${settings.scriptureVersion}】"\n`;
                }
            }

            if (mode === "voice") {
                // 人声文案模式：使用用户编辑过的系统指令
                systemPrompt = `${voiceModeSystemInstruction}${deityRules}`;
                userPrompt = `${itemInstruction}

原始文案：
${item.originalForeign}

请根据指令为文案添加情感标签，并合理断行用于字幕显示。
只输出最终结果，不要任何解释或标题。
输出格式：加标签结果|||断句结果
其中"加标签结果"是带情感标签的完整文案，"断句结果"是根据标签合理断行后的文案（不带标签，每行不超过4个单词）。
两部分用 ||| 分隔。`;
            } else if (mode === 'social-media') {
                // 自媒体改写模式：使用专用系统指令 + 动态分项
                systemPrompt = `${socialMediaModeSystemInstruction}${deityRules}`;
                const enabledSections = socialMediaOutputSections.filter(s => s.enabled);
                const sectionInstructions = enabledSections.map((s, idx) => `${idx + 1}. 【${s.name}】\n   要求: ${s.description}`).join('\n\n');
                const sectionMarkers = enabledSections.map(s => `===【${s.name}】===`).join('\n...\n');
                userPrompt = `${itemInstruction}

请根据以下原始文案进行完全改写。

【输出分项要求】
请严格按照以下分项输出，每个分项用对应的标记分隔：

${sectionInstructions}

【输出格式】
${sectionMarkers}

【原始文案】
${item.originalForeign}`;
            } else {
                // 标准模式：输出外文+中文翻译
                systemPrompt = `${systemInstruction}${deityRules}

【输出规则】
1. 只输出最终文案，不要任何解释
2. 输出格式：改写后的外文|||中文翻译
3. 使用 ||| 作为分隔符`;

                userPrompt = `改写指令：
${itemInstruction}

原始外文：
${item.originalForeign}

请严格按照指令改写，只修改指令要求的部分，其他保持原样。输出格式：改写后的外文|||中文翻译`;
            }

            // === 多结果变体模式 ===
            // 仅标准模式且 rewriteVariantCount > 1 时启用
            if (mode === 'standard' && rewriteVariantCount > 1) {
                systemPrompt = `${systemInstruction}

【输出规则】
1. 请生成 ${rewriteVariantCount} 个不同的改写版本
2. 每个版本用编号标记，格式如下：
[1] 改写版本1外文|||中文翻译1
[2] 改写版本2外文|||中文翻译2
..以此类推
3. 每个版本之间的改写风格/措辞应有所不同
4. 不要任何额外解释`;

                userPrompt = `改写指令：
${itemInstruction}

原始外文：
${item.originalForeign}

请严格按照指令改写，只修改指令要求的部分，其他保持原样。
请生成 ${rewriteVariantCount} 个不同的改写版本，输出格式：
[1] 改写后的外文|||中文翻译
[2] 改写后的外文|||中文翻译
...共 ${rewriteVariantCount} 个版本`;
            }

            const result = await ai.models.generateContent({
                model: textModel,
                contents: { role: 'user', parts: [{ text: userPrompt }] },
                config: {
                    systemInstruction: systemPrompt
                }
            });

            const responseText = result.text?.trim() || '';

            if (mode === "voice") {
                // 人声文案模式：解析两个结果（加标签结果|||断句结果）
                const parts = responseText.split('|||');
                if (parts.length >= 1 && parts[0].trim()) {
                    const tagged = parts[0].trim();
                    let segmented = '';
                    
                    if (voiceWrapMode === 'script') {
                        const cleanText = tagged.replace(/\[.*?\]/g, '').replace(/\.{2,}/g, '').trim();
                        segmented = autoWrapText(cleanText, 18);
                    } else {
                        if (parts.length >= 2) {
                            segmented = parts[1].trim().replace(/\\n/g, '\n');
                        }
                    }

                    validateVoiceModeIntegrity(item.originalForeign, tagged, segmented);
                    return {
                        foreign: tagged, // 加标签结果
                        chinese: segmented  // 断句结果：还原换行
                    };
                } else {
                    // 解析失败，抛出错误
                    throw new Error('断句解析失败：AI 未按格式返回结果');
                }
            } else if (mode === 'social-media') {
                // 自媒体改写模式：根据动态分项解析
                const enabledSections = socialMediaOutputSections.filter(s => s.enabled);
                const parsedSections: { name: string; content: string }[] = [];
                for (let si = 0; si < enabledSections.length; si++) {
                    const section = enabledSections[si];
                    const marker = `===【${section.name}】===`;
                    const altMarker = `【${section.name}】`;
                    const nextSection = enabledSections[si + 1];
                    const nextMarker = nextSection ? `===【${nextSection.name}】===` : null;
                    const nextAltMarker = nextSection ? `【${nextSection.name}】` : null;
                    let startIdx = responseText.indexOf(marker);
                    let contentStart = startIdx !== -1 ? startIdx + marker.length : -1;
                    if (contentStart === -1) {
                        const altIdx = responseText.indexOf(altMarker);
                        contentStart = altIdx !== -1 ? altIdx + altMarker.length : -1;
                    }
                    let contentEnd = responseText.length;
                    if (nextMarker) {
                        const ni = responseText.indexOf(nextMarker, contentStart > 0 ? contentStart : 0);
                        if (ni !== -1) contentEnd = ni;
                        else if (nextAltMarker) {
                            const nai = responseText.indexOf(nextAltMarker, contentStart > 0 ? contentStart : 0);
                            if (nai !== -1) contentEnd = nai;
                        }
                    }
                    parsedSections.push({ name: section.name, content: contentStart !== -1 ? responseText.slice(contentStart, contentEnd).trim() : '' });
                }
                // 清除残留的标记文字
                parsedSections.forEach(s => {
                    s.content = s.content
                        .replace(new RegExp(`===?【${s.name}】===?`, 'g'), '')
                        .replace(new RegExp(`【${s.name}】`, 'g'), '')
                        .trim();
                });
                // 分列：前半→左列，后半→右列
                const halfIdx = Math.ceil(parsedSections.length / 2);
                const leftSections = parsedSections.slice(0, halfIdx);
                const rightSections = parsedSections.slice(halfIdx);
                return {
                    foreign: leftSections.map(s => s.content).join('\n\n').trim(),
                    chinese: rightSections.map(s => s.content).join('\n\n').trim()
                };
            } else if (mode === 'standard' && rewriteVariantCount > 1) {
                // 标准模式 - 多结果变体：解析 [1]...[N] 标记的多条结果
                const variants: { foreign: string; chinese: string }[] = [];
                // 尝试用 [编号] 拆分
                const variantPattern = /\[(\d+)\]\s*/g;
                const blocks: string[] = [];
                let lastIdx = 0;
                let match: RegExpExecArray | null;
                const allMatches: { idx: number; pos: number }[] = [];
                while ((match = variantPattern.exec(responseText)) !== null) {
                    allMatches.push({ idx: parseInt(match[1]), pos: match.index + match[0].length });
                }
                if (allMatches.length >= 2) {
                    for (let mi = 0; mi < allMatches.length; mi++) {
                        const start = allMatches[mi].pos;
                        const end = mi + 1 < allMatches.length ? allMatches[mi + 1].pos - `[${allMatches[mi + 1].idx}]`.length - 1 : responseText.length;
                        blocks.push(responseText.slice(start, end).trim());
                    }
                } else {
                    // 无编号标记，回退到按换行+||| 拆分
                    blocks.push(...responseText.split('\n').filter(l => l.includes('|||')));
                }
                for (const block of blocks) {
                    const parts = block.split('|||');
                    if (parts.length >= 2 && parts[0].trim()) {
                        variants.push({ foreign: parts[0].trim(), chinese: parts[1].trim() });
                    }
                }
                if (variants.length > 0) {
                    // 返回第一个，额外的通过 _multiVariants 传递
                    (variants as any)._isMultiVariant = true;
                    return variants as any;
                } else {
                    // 回退：尝试单条解析
                    const parts = responseText.split('|||');
                    if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
                        return { foreign: parts[0].trim(), chinese: parts[1].trim() };
                    }
                    throw new Error('多结果解析失败：AI 未按格式返回结果');
                }
            } else {
                // 标准模式：解析 ||| 分隔符
                const parts = responseText.split('|||');
                if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
                    const extraParts = parts.length > 2 ? parts.slice(2).map(p => p.trim()) : undefined;
                    let scriptureNote: string | undefined = undefined;
                    if (settings.enableScriptureDetection && extraParts && extraParts.length > 0) {
                        scriptureNote = extraParts[extraParts.length - 1];
                    }
                    return {
                        foreign: parts[0].trim(),
                        chinese: parts[1].trim(),
                        extraParts,
                        scriptureNote,
                        rawResponse: responseText
                    };
                } else {
                    // 解析失败，抛出错误
                    throw new Error('翻译解析失败：AI 未按格式返回结果');
                }
            }
        } catch (error: any) {
            console.error('[CopywritingView] Process error:', error);
            throw error;
        }
    };

    // --- Update item settings ---
    const updateItemSettings = (id: string, updates: Partial<CopywritingItem>) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, ...updates } : item
        ));
    };

    // --- Toggle chat ---
    const toggleItemChat = (id: string) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, chatOpen: !item.chatOpen } : item
        ));
    };

    // --- Toggle settings panel ---
    const toggleItemSettings = (id: string) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, showSettings: !item.showSettings } : item
        ));
    };

    // --- Copy single item ---
    const handleCopySingleItem = (item: CopywritingItem, type: 'all' | 'foreign' | 'chinese' | 'result') => {
        const escapeForSheet = (text: string) => {
            const t = text || '';
            if (t.includes('\t') || t.includes('\n') || t.includes('\r') || t.includes('"')) {
                return `"${t.replace(/"/g, '""')}"`;
            }
            return t;
        };
        let text = '';
        switch (type) {
            case 'foreign':
                text = escapeForSheet(item.resultForeign || '');
                break;
            case 'chinese':
                text = escapeForSheet(item.resultChinese || '');
                break;
            case 'result':
                text = `${escapeForSheet(item.resultForeign || '')}\t${escapeForSheet(item.resultChinese || '')}`;
                break;
            case 'all':
                text = `${escapeForSheet(item.originalForeign)}\t${escapeForSheet(item.originalChinese || '')}\t${escapeForSheet(item.resultForeign || '')}\t${escapeForSheet(item.resultChinese || '')}`;
                break;
        }
        navigator.clipboard.writeText(text);
    };

    // --- Reset all to idle ---
    const handleResetAll = () => {
        setItems(prev => prev.map(item => ({
            ...item,
            status: 'idle',
            resultForeign: undefined,
            resultChinese: undefined,
            error: undefined,
            instructionResults: []
        })));
    };

    // --- 折叠/展开功能 ---
    const toggleItemCollapse = (id: string) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, collapsed: !item.collapsed } : item
        ));
    };

    const toggleAllCollapse = () => {
        const newState = !allCollapsed;
        setAllCollapsed(newState);
        setItems(prev => prev.map(item => ({ ...item, collapsed: newState })));
    };

    // --- 多指令管理 ---
    const addInstruction = () => {
        setInstructions(prev => [...prev, '']);
    };

    const removeInstruction = (index: number) => {
        if (instructions.length <= 1) return;
        setInstructions(prev => prev.filter((_, i) => i !== index));
    };

    const updateInstruction = (index: number, value: string) => {
        setInstructions(prev => prev.map((inst, i) => i === index ? value : inst));
    };

    // --- 拆分列管理 ---
    const addSplitColumn = () => {
        setSplitColumns(prev => [...prev, {
            id: uuidv4(),
            name: `列${prev.length + 1}`,
            description: ''
        }]);
    };

    const removeSplitColumn = (id: string) => {
        if (splitColumns.length <= 1) return;
        setSplitColumns(prev => prev.filter(col => col.id !== id));
    };

    const updateSplitColumn = (id: string, updates: Partial<SplitColumn>) => {
        setSplitColumns(prev => prev.map(col =>
            col.id === id ? { ...col, ...updates } : col
        ));
    };

    // --- 拆分模式处理单条 ---
    const processSplitItem = async (item: CopywritingItem): Promise<Record<string, string> | null> => {
        try {
            const ai = getAiInstance();

            const columnsDesc = splitColumns.map((col, idx) =>
                `第${idx + 1}列【${col.name}】：${col.description || '无特殊要求'}`
            ).join('\n');

            const systemPrompt = `${splitModeSystemInstruction}

【处理列定义】
${columnsDesc}

【输出格式】
严格按照 ${splitColumns.length} 列输出，列之间用 ||| 分隔。
示例：第1列内容|||第2列内容|||第3列内容`;

            const userPrompt = `请按照列定义处理以下文案，输出 ${splitColumns.length} 列结果：

${item.originalForeign}

严格按 ||| 分隔输出：`;

            const result = await ai.models.generateContent({
                model: textModel,
                contents: { role: 'user', parts: [{ text: userPrompt }] },
                config: {
                    systemInstruction: systemPrompt
                }
            });

            const responseText = result.text?.trim() || '';

            // 解析响应：按 ||| 分割
            const parts = responseText.split('|||').map(p => p.trim());
            const splitResults: Record<string, string> = {};
            splitColumns.forEach((col, idx) => {
                splitResults[col.id] = parts[idx] || '-';
            });

            return splitResults;
        } catch (error: any) {
            console.error('[CopywritingView] Split processing error:', error);
            throw error;
        }
    };

    // --- 拆分模式批量处理 ---
    const processSplitBatch = async (
        batchItems: CopywritingItem[]
    ): Promise<Map<string, Record<string, string>>> => {
        const ai = getAiInstance();
        const resultsMap = new Map<string, Record<string, string>>();

        const columnsDesc = splitColumns.map((col, idx) =>
            `第${idx + 1}列【${col.name}】：${col.description || '无特殊要求'}`
        ).join('\n');

        // 构建批量输入
        const batchInput = batchItems.map((item, idx) =>
            `[${idx + 1}] ${item.originalForeign.replace(/\n/g, ' ')}`
        ).join('\n');

        const systemPrompt = `${splitModeSystemInstruction}

【处理列定义】
${columnsDesc}

【输出格式】
对每条文案，严格按照 ${splitColumns.length} 列输出，列之间用 ||| 分隔。
每条结果以 [编号] 开头。
示例：
[1] 第1列内容|||第2列内容|||第3列内容
[2] 第1列内容|||第2列内容|||第3列内容`;

        const userPrompt = `请按照列定义分别处理以下 ${batchItems.length} 条文案，每条输出 ${splitColumns.length} 列结果：

${batchInput}

每条结果以 [编号] 开头，列之间用 ||| 分隔：`;

        const result = await ai.models.generateContent({
            model: textModel,
            contents: { role: 'user', parts: [{ text: userPrompt }] },
            config: {
                systemInstruction: systemPrompt
            }
        });

        const responseText = result.text?.trim() || '';

        // 解析批量响应 - 支持多行内容
        // 先按 [编号] 标记分割，而不是按换行分割
        const itemRegex = /\[(\d+)\]\s*/g;
        const markers: { idx: number; pos: number }[] = [];
        let m;
        while ((m = itemRegex.exec(responseText)) !== null) {
            markers.push({ idx: parseInt(m[1]) - 1, pos: m.index + m[0].length });
        }

        for (let mi = 0; mi < markers.length; mi++) {
            const { idx } = markers[mi];
            const start = markers[mi].pos;
            const end = mi + 1 < markers.length ? markers[mi + 1].pos - markers[mi + 1].idx.toString().length - 3 : responseText.length;
            // 取当前编号到下一编号之间的全部内容
            const rawContent = responseText.slice(start, end).trim();

            if (idx >= 0 && idx < batchItems.length) {
                const parts = rawContent.split('|||').map(p => p.trim());
                const splitResults: Record<string, string> = {};
                splitColumns.forEach((col, colIdx) => {
                    splitResults[col.id] = parts[colIdx] || '-';
                });
                resultsMap.set(batchItems[idx].id, splitResults);
            }
        }

        return resultsMap;
    };

    // --- 拆分模式复制列 ---
    const handleCopySplitColumn = (columnId: string) => {
        const successItems = items.filter(i => i.status === 'success' && i.splitResults);
        const col = splitColumns.find(c => c.id === columnId);
        if (!col) return;
        const text = successItems.map(item => item.splitResults?.[columnId] || '-').join('\n');
        navigator.clipboard.writeText(text);
        setCopiedType(`split_${columnId}`);
        showCopyToast(`已复制「${col.name}」列 (${successItems.length}条)`);
        setTimeout(() => setCopiedType(null), 1500);
    };

    // --- 拆分模式复制全部列（Tab分隔表格格式）---
    const handleCopySplitAll = () => {
        const successItems = items.filter(i => i.status === 'success' && i.splitResults);
        const headers = ['原文', ...splitColumns.map(col => col.name), ...(hasStats ? ['频率统计'] : [])].join('\t');
        const rows = successItems.map(item => {
            const cols = splitColumns.map(col => escapeForSheet(item.splitResults?.[col.id] || '-'));
            const statsCol = hasStats ? [escapeForSheet(getItemKeywordStatsText(item) || '-')] : [];
            return [escapeForSheet(item.originalForeign), ...cols, ...statsCol].join('\t');
        });
        navigator.clipboard.writeText([headers, ...rows].join('\n'));
        setCopiedType('split_all');
        showCopyToast(`已复制完整结果 (${successItems.length}条${hasStats ? ' + 统计' : ''})`);
        setTimeout(() => setCopiedType(null), 1500);
    };

    // --- 关键词频率统计 ---
    const computeKeywordFrequency = (columnId: string) => {
        const successItems = items.filter(i => i.status === 'success' && i.splitResults);
        const freqMap: Record<string, number> = {};

        for (const item of successItems) {
            const rawKeywords = item.splitResults?.[columnId] || '';
            if (!rawKeywords || rawKeywords === '-') continue;
            // 支持中英文逗号、顿号分隔
            const keywords = rawKeywords.split(/[,，、;；]+/).map(k => k.trim().toLowerCase()).filter(k => k && k !== '-');
            // 每条文案中同一关键词只计一次
            const unique = [...new Set(keywords)];
            for (const kw of unique) {
                freqMap[kw] = (freqMap[kw] || 0) + 1;
            }
        }

        setKeywordFreqMap(freqMap);
        setKeywordStatsColumnId(columnId);
        setKeywordStatsTotalItems(successItems.length);
        showCopyToast(`已统计 ${Object.keys(freqMap).length} 个关键词 (${successItems.length}条文案)`);
    };

    // 获取单条文案的关键词统计文本
    const getItemKeywordStatsText = (item: CopywritingItem): string => {
        if (!keywordStatsColumnId || !item.splitResults || Object.keys(keywordFreqMap).length === 0) return '';
        const rawKeywords = item.splitResults[keywordStatsColumnId] || '';
        if (!rawKeywords || rawKeywords === '-') return '-';
        const keywords = rawKeywords.split(/[,，、;；]+/).map(k => k.trim().toLowerCase()).filter(k => k && k !== '-');
        const unique = [...new Set(keywords)];
        return unique.map(kw => `${kw}(${keywordFreqMap[kw] || 0}/${keywordStatsTotalItems})`).join(', ');
    };

    // --- 检测文本是否主要是中文 ---
    const isMostlyChinese = (text: string): boolean => {
        if (!text) return false;
        const chineseChars = text.match(/[\u4e00-\u9fff]/g);
        const totalChars = text.replace(/\s/g, '').length;
        if (totalChars === 0) return false;
        return (chineseChars?.length || 0) / totalChars > 0.3;
    };

    // --- 针对单个指令的重试 ---
    const handleRetryInstruction = async (itemId: string, instIdx: number) => {
        const item = items.find(i => i.id === itemId);
        if (!item) return;

        const inst = instructions[instIdx];
        if (!inst?.trim()) return;

        // 更新该指令状态为processing
        setItems(prev => prev.map(i => {
            if (i.id !== itemId) return i;
            const newResults = [...(i.instructionResults || [])];
            if (newResults[instIdx]) {
                newResults[instIdx] = { ...newResults[instIdx], status: 'processing', error: undefined, voiceIntegrityIssue: undefined };
            }
            return { ...i, instructionResults: newResults };
        }));

        try {
            const result = await processItemWithInstruction(item, inst);
            setItems(prev => prev.map(i => {
                if (i.id !== itemId) return i;
                const newResults = [...(i.instructionResults || [])];
                if (result) {
                    newResults[instIdx] = {
                        ...newResults[instIdx],
                        resultForeign: (result as any).foreign,
                        resultChinese: (result as any).chinese,
                        resultExtraParts: (result as any).extraParts,
                        scriptureNote: (result as any).scriptureNote,
                        status: 'success',
                        error: undefined,
                        voiceIntegrityIssue: undefined
                    };
                } else {
                    newResults[instIdx] = { ...newResults[instIdx], status: 'error', error: '处理失败' };
                }
                // 根据所有指令结果计算 item 整体状态
                const allSuccess = newResults.every(r => r.status === 'success');
                const hasError = newResults.some(r => r.status === 'error');
                const hasProcessing = newResults.some(r => r.status === 'processing');
                let newStatus: 'idle' | 'processing' | 'success' | 'error' = i.status;
                if (hasProcessing) {
                    newStatus = 'processing';
                } else if (allSuccess) {
                    newStatus = 'success';
                } else if (hasError) {
                    newStatus = 'error';
                }
                return { ...i, instructionResults: newResults, status: newStatus };
            }));
        } catch (err) {
            setItems(prev => prev.map(i => {
                if (i.id !== itemId) return i;
                const newResults = [...(i.instructionResults || [])];
                newResults[instIdx] = {
                    ...newResults[instIdx],
                    status: 'error',
                    error: getErrorMessage(err),
                    voiceIntegrityIssue: getVoiceIntegrityIssue(err)
                };
                // 更新整体状态为 error
                return { ...i, instructionResults: newResults, status: 'error' };
            }));
        }
    };

    // --- 针对单个指令的对话开关 ---
    const toggleInstructionChat = (itemId: string, instIdx: number) => {
        setItems(prev => prev.map(i => {
            if (i.id !== itemId) return i;
            const newResults = [...(i.instructionResults || [])];
            if (newResults[instIdx]) {
                newResults[instIdx] = { ...newResults[instIdx], chatOpen: !newResults[instIdx].chatOpen };
            }
            return { ...i, instructionResults: newResults };
        }));
    };

    // --- 针对单个指令的对话输入更新 ---
    const updateInstructionChatInput = (itemId: string, instIdx: number, value: string) => {
        setItems(prev => prev.map(i => {
            if (i.id !== itemId) return i;
            const newResults = [...(i.instructionResults || [])];
            if (newResults[instIdx]) {
                newResults[instIdx] = { ...newResults[instIdx], chatInput: value };
            }
            return { ...i, instructionResults: newResults };
        }));
    };

    // --- 针对单个指令的对话发送 ---
    const handleInstructionChatSend = async (itemId: string, instIdx: number) => {
        const item = items.find(i => i.id === itemId);
        if (!item || !item.instructionResults?.[instIdx]) return;

        const result = item.instructionResults[instIdx];
        const input = result.chatInput?.trim();
        if (!input) return;

        const userMsg: ChatMessage = { id: uuidv4(), role: 'user', text: input };

        // 添加用户消息并清空输入
        setItems(prev => prev.map(i => {
            if (i.id !== itemId) return i;
            const newResults = [...(i.instructionResults || [])];
            newResults[instIdx] = {
                ...newResults[instIdx],
                chatHistory: [...(newResults[instIdx].chatHistory || []), userMsg],
                chatInput: '',
                chatLoading: true
            };
            return { ...i, instructionResults: newResults };
        }));

        try {
            const ai = getAiInstance();
            const systemPrompt = `你是一个专业的文案编辑和翻译专家。
当前正在编辑的文案：
- 原始外文：${item.originalForeign}
- 改写指令：${result.instruction}
- 当前外文结果：${result.resultForeign}
- 当前中文翻译：${result.resultChinese}

请根据用户的要求修改文案。输出格式：修改后的外文|||中文翻译`;

            const chatResult = await ai.models.generateContent({
                model: textModel,
                contents: { role: 'user', parts: [{ text: input }] },
                config: { systemInstruction: systemPrompt }
            });

            const responseText = chatResult.text?.trim() || '';

            // 解析结果
            const parts = responseText.split('|||');
            const hasUpdate = parts.length >= 2;

            // 构建助手消息，如果更新了结果则添加提示
            const msgText = hasUpdate
                ? `${responseText}\n\n✅ 结果已更新到上方单元格，请查看。`
                : responseText;
            const assistantMsg: ChatMessage = { id: uuidv4(), role: 'model', text: msgText };

            setItems(prev => prev.map(i => {
                if (i.id !== itemId) return i;
                const newResults = [...(i.instructionResults || [])];
                newResults[instIdx] = {
                    ...newResults[instIdx],
                    chatHistory: [...(newResults[instIdx].chatHistory || []), assistantMsg],
                    chatLoading: false,
                    ...(hasUpdate ? { resultForeign: parts[0].trim(), resultChinese: parts[1].trim() } : {})
                };
                return { ...i, instructionResults: newResults };
            }));
        } catch (err) {
            const errorMsg: ChatMessage = { id: uuidv4(), role: 'model', text: `错误: ${err}` };
            setItems(prev => prev.map(i => {
                if (i.id !== itemId) return i;
                const newResults = [...(i.instructionResults || [])];
                newResults[instIdx] = {
                    ...newResults[instIdx],
                    chatHistory: [...(newResults[instIdx].chatHistory || []), errorMsg],
                    chatLoading: false
                };
                return { ...i, instructionResults: newResults };
            }));
        }
    };

    const handleChatSend = async (item: CopywritingItem) => {
        const input = item.chatInput?.trim();
        if (!input) return;

        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            text: input
        };

        // 添加用户消息并清空输入
        setItems(prev => prev.map(i =>
            i.id === item.id ? {
                ...i,
                chatHistory: [...(i.chatHistory || []), userMsg],
                chatInput: '',
                chatLoading: true
            } : i
        ));

        try {
            const ai = getAiInstance();

            const systemPrompt = `你是一个专业的文案编辑和翻译专家。

当前正在编辑的文案：
- 原始外文：${item.originalForeign}
- 原始中文：${item.originalChinese || '(无)'}
${item.resultForeign ? `- 当前改写结果：${item.resultForeign}` : ''}
${item.resultChinese ? `- 当前翻译结果：${item.resultChinese}` : ''}

之前批量处理时使用的改写指令：
"${instruction || DEFAULT_INSTRUCTION}"

用户正在通过对话继续优化这条文案。请根据用户的要求进行修改。

【输出规则】
- 如果用户要求修改文案，输出格式必须是：改写后的外文|||中文翻译
- 使用 ||| 作为分隔符
- 不要任何解释，直接输出结果
- 如果用户只是在询问或讨论，可以正常回复`;

            const historyForAI = (item.chatHistory || []).map(msg => ({
                role: msg.role as 'user' | 'model',
                parts: [{ text: msg.text }]
            }));

            const result = await ai.models.generateContent({
                model: textModel,
                contents: [
                    ...historyForAI,
                    { role: 'user', parts: [{ text: input }] }
                ],
                config: {
                    systemInstruction: systemPrompt
                }
            });

            const responseText = result.text?.trim() || '';

            // 检测是否包含 ||| 分隔符（表示修改了文案）
            const parts = responseText.split('|||');
            let updatedItem: Partial<CopywritingItem> = {};

            if (parts.length >= 2) {
                // 是格式化的结果，更新改写结果
                updatedItem = {
                    resultForeign: parts[0].trim(),
                    resultChinese: parts[1].trim(),
                    status: 'success'
                };
            }

            // 构建回复消息，如果更新了结果则添加提醒
            let replyText = responseText;
            if (parts.length >= 2) {
                replyText += '\n\n✅ 结果已更新到上方单元格，请查看。';
            }

            const modelMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: replyText
            };

            setItems(prev => prev.map(i =>
                i.id === item.id ? {
                    ...i,
                    ...updatedItem,
                    chatHistory: [...(i.chatHistory || []), modelMsg],
                    chatLoading: false
                } : i
            ));
        } catch (error: any) {
            console.error('[CopywritingView] Chat error:', error);
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: `错误：${error.message || '处理失败'}`
            };
            setItems(prev => prev.map(i =>
                i.id === item.id ? {
                    ...i,
                    chatHistory: [...(i.chatHistory || []), errorMsg],
                    chatLoading: false
                } : i
            ));
        }
    };


    // --- Stats ---
    const stats = {
        total: items.length,
        idle: items.filter(i => i.status === 'idle').length,
        processing: items.filter(i => i.status === 'processing').length,
        success: items.filter(i => i.status === 'success').length,
        error: items.filter(i => i.status === 'error').length
    };

    return (
        <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 p-4 gap-3 overflow-y-auto overflow-x-hidden custom-scrollbar">

            {/* === 信仰版权与规范设置 === */}
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden shrink-0">
                <button
                    onClick={() => setShowDeitySettings(!showDeitySettings)}
                    className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
                >
                    <div className="flex items-center gap-2 text-zinc-300">
                        <ShieldCheck className="w-4 h-4 text-amber-400" />
                        <span className="font-medium text-sm">信仰版权与规范</span>
                    </div>
                    <div className="flex items-center gap-2">
                        {settings.enableScriptureDetection && (
                            <span className="text-[10px] text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">经文检测开启</span>
                        )}
                        {showDeitySettings ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                    </div>
                </button>
                {showDeitySettings && (
                    <div className="px-4 pb-4 pt-2 border-t border-zinc-800/50">
                        <ScriptureDeitySettingsPanel settings={settings} />
                    </div>
                )}
            </div>

            {/* === 改写指令 + 输入文案 (同一行) === */}
            <div className="flex gap-3 min-w-0">
                {/* 改写指令 (左侧 40%) */}
                <div className="flex-[3.5] min-w-0 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                    <div className="flex flex-wrap items-center justify-between mb-2 gap-1">
                        <div className="flex flex-wrap items-center gap-2">
                            <Settings2 size={14} className={mode === 'voice' ? 'text-purple-400' : mode === 'classify' ? 'text-cyan-400' : mode === 'split' ? 'text-orange-400' : mode === 'library' ? 'text-green-400' : mode === 'social-media' ? 'text-teal-400' : mode === 'parallel' ? 'text-rose-400' : mode === 'cleaner' ? 'text-lime-400' : mode === 'prayer' ? 'text-sky-400' : 'text-amber-400'} />
                            <span className="text-xs font-medium text-zinc-300">
                                {mode === 'freeform' ? '生成指令' : mode === 'voice' ? '人声文案指令' : mode === 'classify' ? (classifySubMode === 'wordcount' ? '字数分类区间' : classifySubMode === 'advanced' ? '高级分类配置' : '分类规则') : mode === 'split' ? '拆分列定义' : mode === 'library' ? '文案库配置' : mode === 'social-media' ? '自媒体改写指令' : mode === 'parallel' ? '排比改写说明' : mode === 'cleaner' ? '文案清理指令' : mode === 'prayer' ? '祷告词提炼改写' : '改写指令'}
                            </span>
                            {/* 模式切换按钮组 — 三组排列 */}
                            <div className="flex flex-wrap items-center gap-0.5">
                                {/* ── 标准改写 ── */}
                                <button
                                    onClick={() => handleModeChange('standard')}
                                    className={`px-2 py-0.5 text-[10px] rounded-none transition-all border whitespace-nowrap ${mode === 'standard'
                                        ? 'bg-amber-600 text-white border-amber-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="标准改写：根据指令对文案进行改写、分类、拆分等操作"
                                >
                                    <FileEdit size={10} className="inline mr-0.5" /> 标准改写
                                </button>
                                <button
                                    onClick={() => handleModeChange('freeform')}
                                    className={`px-2 py-0.5 text-[10px] transition-all border whitespace-nowrap ${mode === 'freeform'
                                        ? 'bg-rose-600 text-white border-rose-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="无文案模式：无需输入原文，直接根据指令生成外文+中文文案"
                                >
                                    <Sparkles size={10} className="inline mr-0.5" /> 无文案
                                </button>

                                {/* ── 分隔线 ── */}
                                <div className="h-4 w-px bg-zinc-600 mx-0.5" />

                                {/* ── 特殊改写：文案库 / 自媒体 / 人声 / 清理 / 祷告 ── */}
                                <button
                                    onClick={() => handleModeChange('library')}
                                    className={`px-2 py-0.5 text-[10px] transition-all border whitespace-nowrap ${mode === 'library'
                                        ? 'bg-green-600 text-white border-green-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="文案库模式：语义匹配文案库 + 智能改写"
                                >
                                    <Library size={10} className="inline mr-0.5" /> 文案库
                                </button>
                                <button
                                    onClick={() => handleModeChange('social-media')}
                                    className={`px-2 py-0.5 text-[10px] transition-all border-y whitespace-nowrap ${mode === 'social-media'
                                        ? 'bg-teal-600 text-white border-teal-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="自媒体改写：信仰短视频口播稿改写"
                                >
                                    <Share2 size={10} className="inline mr-0.5" /> 自媒体
                                </button>
                                <button
                                    onClick={() => handleModeChange('voice')}
                                    className={`px-2 py-0.5 text-[10px] transition-all border whitespace-nowrap ${mode === 'voice'
                                        ? 'bg-purple-600 text-white border-purple-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="人声模式：添加人声情感标签 + 字幕断行"
                                >
                                    <Mic size={10} className="inline mr-0.5" /> 人声
                                </button>

                                <button
                                    onClick={() => handleModeChange('cleaner')}
                                    className={`px-2 py-0.5 text-[10px] transition-all border whitespace-nowrap ${mode === 'cleaner'
                                        ? 'bg-lime-600 text-white border-lime-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="文案清理：清除AI标签/水印，输出清理原文+英文+中文+删除说明"
                                >
                                    <Eraser size={10} className="inline mr-0.5" /> 清理
                                </button>

                                <button
                                    onClick={() => handleModeChange('prayer')}
                                    className={`px-2 py-0.5 text-[10px] rounded-none transition-all border whitespace-nowrap ${mode === 'prayer'
                                        ? 'bg-sky-600 text-white border-sky-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="祷告词提炼：从长祷告词提取核心金句，改写为三段式英+中双语短视频文案"
                                >
                                    <Gem size={10} className="inline mr-0.5" /> 提炼
                                </button>

                                {/* ── 分隔线 ── */}
                                <div className="h-4 w-px bg-zinc-600 mx-0.5" />

                                {/* ── 其他文案操作：分类 / 拆分 ── */}
                                <button
                                    onClick={() => handleModeChange('classify')}
                                    className={`px-2 py-0.5 text-[10px] transition-all border whitespace-nowrap ${mode === 'classify'
                                        ? 'bg-cyan-600 text-white border-cyan-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="分类模式：按规则输出分类结果"
                                >
                                    <Tag size={10} className="inline mr-0.5" /> 分类
                                </button>
                                {mode === 'classify' && (
                                    <>
                                        <button
                                            onClick={() => setClassifySubMode('standard')}
                                            className={`px-2 py-0.5 text-[10px] transition-all border-y ${classifySubMode === 'standard'
                                                ? 'bg-cyan-700 text-white border-cyan-600'
                                                : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                                } tooltip-bottom`}
                                            data-tip="常规分类：在指令中自定义分类规则"
                                        >
                                            常规
                                        </button>
                                        <button
                                            onClick={() => setClassifySubMode('advanced')}
                                            className={`px-2 py-0.5 text-[10px] transition-all border-y ${classifySubMode === 'advanced'
                                                ? 'bg-violet-600 text-white border-violet-500'
                                                : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                                } tooltip-bottom`}
                                            data-tip="高级分类：多维分类维度配置，AI一次输出多列结果"
                                        >
                                            高级
                                        </button>
                                        <button
                                            onClick={() => setClassifySubMode('wordcount')}
                                            className={`px-2 py-0.5 text-[10px] transition-all border-y ${classifySubMode === 'wordcount'
                                                ? 'bg-sky-600 text-white border-sky-500'
                                                : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                                } tooltip-bottom`}
                                            data-tip="字数分类：按字数区间本地分类（不调用AI）"
                                        >
                                            字数
                                        </button>
                                    </>
                                )}
                                <button
                                    onClick={() => handleModeChange('split')}
                                    className={`px-2 py-0.5 text-[10px] rounded-none transition-all border whitespace-nowrap ${mode === 'split'
                                        ? 'bg-orange-600 text-white border-orange-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="拆分模式：按自定义列智能拆分文案结构"
                                >
                                    <Scissors size={10} className="inline mr-0.5" /> 拆分
                                </button>
                            </div>
                            {/* 显示差异开关 - 标准/库模式 */}
                            {(mode === 'standard' || mode === 'library' || mode === 'cleaner') && (
                                <button
                                    onClick={() => setShowDiff(!showDiff)}
                                    className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full transition-all ${showDiff
                                        ? 'bg-amber-600 text-white border border-amber-500'
                                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'
                                        }`}
                                    title={showDiff ? '关闭差异高亮' : '显示原文与改写结果的差异'}
                                >
                                    {showDiff ? <><Search size={10} className="inline mr-0.5" /> 差异显示中</> : <><Search size={10} className="inline mr-0.5" /> 显示差异</>}
                                </button>
                            )}
                            {/* 自动中文翻译开关 - 仅标准/无文案模式显示 */}
                            {(mode === 'standard' || mode === 'freeform') && (
                                <button
                                    onClick={() => setAutoTranslate(!autoTranslate)}
                                    className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full transition-all ${autoTranslate
                                        ? 'bg-emerald-600 text-white border border-emerald-500'
                                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'
                                        }`}
                                    title={autoTranslate ? '已开启自动中文翻译：结果会分为外文|||中文两列。关闭后结果为单列，用户指令完全自由。' : '已关闭自动中文翻译：结果为单列，用户指令的格式不会被干涉。'}
                                >
                                    {autoTranslate ? '🌐 中文翻译' : '🚫 无翻译'}
                                </button>
                            )}
                            {/* 选择断行模式 - 仅人声模式显示 */}
                            {mode === 'voice' && (
                                <button
                                    onClick={() => setVoiceWrapMode(voiceWrapMode === 'ai' ? 'script' : 'ai')}
                                    className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full transition-all ${voiceWrapMode === 'script'
                                        ? 'bg-purple-600 text-white border border-purple-500'
                                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'
                                        }`}
                                    title={voiceWrapMode === 'script' ? '已开启脚本断行：保留AI生成的情感标签，但清除文本中的标记并按本地规则(18字符/标点)强制断行。' : '使用AI断行：完全依赖AI输出的第二段断行结果。'}
                                >
                                    {voiceWrapMode === 'script' ? '📜 脚本断行' : '🤖 AI断行'}
                                </button>
                            )}
                            {/* 批次处理设置 */}
                            <div className="relative" ref={batchSettingsRef}>
                                <button
                                    onClick={() => setShowBatchSettings(!showBatchSettings)}
                                    className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full transition-all ${batchSize > 1
                                        ? 'bg-emerald-600 text-white border border-emerald-500'
                                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'
                                        }`}
                                    title={`批次处理：每次 ${batchSize} 条（点击设置）`}
                                >
                                    <Package size={10} className="inline mr-0.5" /> 批次×{batchSize}
                                </button>
                                {showBatchSettings && (
                                    <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg p-2 shadow-lg z-50 min-w-[180px]">
                                        <div className="text-[10px] text-zinc-400 mb-1">每次 API 调用处理条数</div>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="range"
                                                min="1"
                                                max="2000"
                                                value={batchSize}
                                                onChange={(e) => setBatchSize(parseInt(e.target.value))}
                                                className="flex-1 h-1 accent-emerald-500"
                                            />
                                            <input
                                                type="number"
                                                min="1"
                                                max="2000"
                                                value={batchSize}
                                                onChange={(e) => {
                                                    const val = parseInt(e.target.value) || 1;
                                                    setBatchSize(Math.min(2000, Math.max(1, val)));
                                                }}
                                                className="w-16 bg-zinc-900 border border-zinc-600 rounded px-2 py-0.5 text-xs text-center text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                        </div>
                                        <div className="text-[9px] text-zinc-500 mt-1">
                                            {batchSize === 1 ? '单条模式：每条文案单独调用API，结果更精准' : `批次模式：${batchSize}条/次，大幅减少API调用次数`}
                                        </div>
                                        <div className="text-[8px] text-zinc-600 mt-1 border-t border-zinc-700 pt-1 flex items-start gap-1">
                                            <Lightbulb size={10} className="shrink-0 mt-0.5" /> 提示：批次越大，API调用越少，速度越快，但单条结果精度可能略降。推荐分类任务用批次模式，改写任务用单条模式。
                                        </div>
                                        <div className="flex flex-col gap-1 mt-2">
                                            <div className="flex flex-wrap gap-0.5">
                                                <button
                                                    onClick={() => { setBatchSize(1); setShowBatchSettings(false); }}
                                                    className={`text-[9px] px-1.5 py-0.5 rounded ${batchSize === 1 ? 'bg-emerald-600 text-white' : 'bg-zinc-700 hover:bg-zinc-600'}`}
                                                >
                                                    单条
                                                </button>
                                                {[2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                                                    <button
                                                        key={n}
                                                        onClick={() => { setBatchSize(n); setShowBatchSettings(false); }}
                                                        className={`text-[9px] px-1 py-0.5 rounded min-w-[22px] ${batchSize === n ? 'bg-emerald-600 text-white' : 'bg-zinc-700 hover:bg-zinc-600'}`}
                                                    >
                                                        {n}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="flex gap-0.5">
                                                {[20, 50, 100, 500].map(n => (
                                                    <button
                                                        key={n}
                                                        onClick={() => { setBatchSize(n); setShowBatchSettings(false); }}
                                                        className={`text-[9px] px-1.5 py-0.5 rounded ${batchSize === n ? 'bg-emerald-600 text-white' : 'bg-zinc-700 hover:bg-zinc-600'}`}
                                                    >
                                                        ×{n}
                                                    </button>
                                                ))}
                                                <button
                                                    onClick={() => { setBatchSize(2000); setShowBatchSettings(false); }}
                                                    className={`text-[9px] px-1.5 py-0.5 rounded ${batchSize === 2000 ? 'bg-emerald-600 text-white' : 'bg-emerald-700 hover:bg-emerald-600'}`}
                                                >
                                                    Max
                                                </button>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            {/* 保存预设 */}
                            <button
                                onClick={handleSavePreset}
                                disabled={presetLoading || !instructions.some(i => i.trim())}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded transition-colors text-amber-500 hover:text-amber-400 hover:bg-amber-900/20 disabled:opacity-50 tooltip-bottom"
                                data-tip="保存当前指令为预设"
                            >
                                <Save size={10} /> 保存
                            </button>
                            {/* 预设设置 */}
                            <button
                                onClick={() => setShowPresetManager(true)}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded transition-colors text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 tooltip-bottom"
                                data-tip="预设设置"
                            >
                                <FolderOpen size={10} /> 预设设置
                            </button>
                            {/* 预览指令 */}
                            <button
                                onClick={() => setShowPreview(true)}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded transition-colors text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                            >
                                <Eye size={10} /> 预览
                            </button>
                            {/* 恢复默认 */}
                            <button
                                onClick={() => {
                                    const defaults: Record<string, string> = {
                                        'standard': DEFAULT_INSTRUCTION,
                                        'voice': VOICE_MODE_DEFAULT_INSTRUCTION,
                                        'classify': CLASSIFY_MODE_DEFAULT_INSTRUCTION,
                                        'split': '',
                                        'library': '',
                                        'social-media': '',
                                        'parallel': '',
                                    };
                                    const defaultInstruction = defaults[mode] || '';
                                    setInstruction(defaultInstruction);
                                    setInstructions(defaultInstruction ? [defaultInstruction] : ['']);
                                    // 库模式：同时重置库和额外指令
                                    if (mode === 'library') {
                                        setLibraries(buildDefaultLibraries());
                                        setLibraryExtraInstructions([]);
                                        setLibraryInstruction(DEFAULT_LIBRARY_INSTRUCTION);
                                        showCopyToast('已恢复默认（库已清空，请通过预设添加）');
                                    }
                                }}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded transition-colors text-zinc-500 hover:text-red-400 hover:bg-red-900/20 tooltip-bottom"
                                data-tip="恢复当前模式的默认指令"
                            >
                                <RotateCw size={10} /> 恢复默认
                            </button>
                        </div>
                    </div>
                    {/* === 排比模式：自动流程说明 === */}
                    {mode === 'parallel' ? (
                        <div className="bg-zinc-950 border border-rose-900/30 rounded-lg p-3 space-y-2">
                            <div className="text-[10px] text-rose-400 font-medium">🔄 自动化两阶段流程</div>
                            <div className="text-[10px] text-zinc-400 space-y-1">
                                <p><span className="text-rose-300 font-medium">阶段1：</span>逐条检测文案是否为排比句式，并提取排比模板</p>
                                <p><span className="text-rose-300 font-medium">阶段2：</span>收集所有排比模板，将非排比文案按合适的模板改写</p>
                            </div>
                            <div className="text-[10px] text-zinc-500 border-t border-zinc-800 pt-2">
                                输入文案 → 自动检测 → 自动提取句式 → 自动改写 → 完成
                            </div>
                        </div>
                    ) : null}
                    {/* === 清理模式：流程说明 === */}
                    {mode === 'cleaner' ? (
                        <div className="bg-zinc-950 border border-lime-900/30 rounded-lg p-3 space-y-2">
                            <div className="flex items-center justify-between">
                                <div className="text-[10px] text-lime-400 font-medium">🧹 文案清理模式</div>
                                <button
                                    onClick={() => setCleanerTurbo(!cleanerTurbo)}
                                    className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full transition-all ${cleanerTurbo
                                        ? 'bg-amber-500/20 text-amber-300 border border-amber-500/50'
                                        : 'bg-zinc-800 text-zinc-500 border border-zinc-700 hover:bg-zinc-700'
                                        }`}
                                    title={cleanerTurbo
                                        ? `Turbo模式: ${cleanerLocalModel === CLEANER_INHERIT ? textModel : cleanerLocalModel} + 5并发`
                                        : `标准模式: ${textModel} + 3并发`}
                                >
                                    ⚡ Turbo {cleanerTurbo ? 'ON' : 'OFF'}
                                </button>
                            </div>
                            <div className="text-[10px] text-zinc-400 space-y-1">
                                <p>自动识别并清除文案中的 AI 标签、平台水印、免责声明等杂质文本</p>
                                <p><span className="text-lime-300 font-medium">输出4列：</span>清理后原文 | 英文翻译 | 中文翻译 | 删除说明</p>
                            </div>
                            {cleanerTurbo && (
                                <div className="text-[9px] text-amber-400/80 bg-amber-900/10 border border-amber-800/30 rounded px-2 py-1 flex items-center gap-2 flex-wrap">
                                    <span>⚡ Turbo + 5路并发</span>
                                    <select
                                        value={cleanerLocalModel}
                                        onChange={e => {
                                            const v = e.target.value;
                                            setCleanerLocalModel(v);
                                            try { localStorage.setItem(CLEANER_MODEL_KEY, v); } catch {}
                                        }}
                                        className="text-[9px] bg-zinc-900 text-amber-300 border border-amber-800/50 rounded px-1 py-0"
                                        style={{ maxWidth: '200px' }}
                                    >
                                        {CLEANER_MODEL_OPTIONS.map(o => (
                                            <option key={o.value} value={o.value}>
                                                {o.value === CLEANER_INHERIT ? `${o.label} (${textModel})` : o.label}
                                            </option>
                                        ))}
                                    </select>
                                </div>
                            )}
                            <div className="text-[10px] text-zinc-500 border-t border-zinc-800 pt-2">
                                支持任意语言，自动处理拼写变体和 OCR 错误。在下方输入框可添加补充指令。
                            </div>
                            <textarea
                                value={instruction}
                                onChange={e => { setInstruction(e.target.value); setInstructions([e.target.value]); }}
                                placeholder="可选：添加补充清理要求，如关键词黑名单、保留特定标签等..."
                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 resize-none focus:outline-none focus:border-lime-500 placeholder-zinc-600"
                                rows={2}
                            />
                        </div>
                    ) : null}
                    {/* === 拆分模式：列编辑器 === */}
                    {mode === 'split' ? (
                        <div className="space-y-1.5">
                            {/* 拆分预设 - 置顶 */}
                            <div className="flex flex-wrap items-center gap-1 mb-1">
                                <span className="text-[10px] text-zinc-500">预设：</span>
                                {SPLIT_COLUMN_PRESETS.map(preset => (
                                    <button
                                        key={preset.id}
                                        onClick={() => setSplitColumns(preset.columns.map(c => ({ ...c })))}
                                        className="px-2 py-0.5 text-[10px] rounded-full transition-all border bg-zinc-800/60 text-amber-300 border-zinc-700 hover:bg-amber-900/30 hover:border-amber-700"
                                    >
                                        {preset.name}
                                    </button>
                                ))}
                                <button
                                    onClick={() => setSplitColumns(DEFAULT_SPLIT_COLUMNS)}
                                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full border bg-zinc-800/60 text-zinc-500 border-zinc-700 hover:text-zinc-300 hover:bg-zinc-800"
                                >
                                    <RotateCw size={8} /> 重置默认
                                </button>
                            </div>
                            {/* 列编辑器 */}
                            <div className="space-y-1.5 max-h-60 overflow-y-auto overflow-x-hidden">
                                {splitColumns.map((col, idx) => (
                                    <div key={col.id} className="bg-zinc-950 border border-orange-900/30 rounded-lg p-2">
                                        <div className="flex items-center gap-1.5 mb-1">
                                            <span className="text-[10px] text-orange-400 font-bold w-4 shrink-0">{idx + 1}.</span>
                                            <input
                                                type="text"
                                                value={col.name}
                                                onChange={(e) => updateSplitColumn(col.id, { name: e.target.value })}
                                                placeholder="列名（如：钩子）"
                                                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs text-orange-200 focus:outline-none focus:border-orange-500 placeholder-zinc-600"
                                            />
                                            {splitColumns.length > 1 && (
                                                <button
                                                    onClick={() => removeSplitColumn(col.id)}
                                                    className="p-0.5 text-zinc-500 hover:text-red-400"
                                                >
                                                    <X size={12} />
                                                </button>
                                            )}
                                        </div>
                                        <textarea
                                            value={col.description}
                                            onChange={(e) => updateSplitColumn(col.id, { description: e.target.value })}
                                            onDoubleClick={() => setEditingSplitColumnId(col.id)}
                                            placeholder="提取要求（双击放大编辑）"
                                            data-tip="双击弹框编辑"
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-orange-500 placeholder-zinc-600 resize-none tooltip-bottom cursor-pointer"
                                            rows={1}
                                        />
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    onClick={addSplitColumn}
                                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-orange-400 hover:bg-orange-900/20 rounded border border-orange-900/30"
                                >
                                    <Plus size={10} /> 添加列
                                </button>
                            </div>
                        </div>
                    ) : mode === 'library' ? (
                        <div className="space-y-2 max-h-60 overflow-y-auto overflow-x-hidden">
                            {/* 当前文案库概览（简洁版，详细管理在编辑库弹窗中） */}
                            {(() => {
                                const enabledLibs = libraries.filter(l => l.enabled);
                                return (
                                    <div className="bg-zinc-950 border border-green-900/30 rounded-lg p-2">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <div className="flex items-center gap-2">
                                                <span className="text-green-400 text-xs font-medium">📚 文案库</span>
                                                <span className="text-[10px] text-zinc-500">
                                                    {enabledLibs.length}/{libraries.length} 启用
                                                </span>
                                                {enabledLibs.length > 1 && (
                                                    <button
                                                        onClick={() => setLibPickOneMode(prev => !prev)}
                                                        className={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${libPickOneMode
                                                            ? 'text-cyan-300 bg-cyan-900/30 border-cyan-700/50'
                                                            : 'text-zinc-500 hover:text-zinc-300 border-zinc-700/50 hover:bg-zinc-800'
                                                            }`}
                                                        title={libPickOneMode ? '当前：多个库只选1条最匹配的' : '当前：每个库各选1条'}
                                                    >
                                                        {libPickOneMode ? '🎯 只选1条' : '📋 每库各选'}
                                                    </button>
                                                )}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => {
                                                        setLibraries(prev => prev.map(l => ({ ...l, items: l.items.map(i => ({ ...i, usedCount: 0 })) })));
                                                        showCopyToast('已重置所有库的使用计数');
                                                    }}
                                                    className="px-1.5 py-0.5 text-[9px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded"
                                                >
                                                    <RotateCw size={9} className="inline mr-0.5" /> 重置计数
                                                </button>
                                                <div className="relative">
                                                    <button
                                                        onClick={() => setShowLibPresetDropdown(prev => !prev)}
                                                        className={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${showLibPresetDropdown
                                                            ? 'text-amber-300 bg-amber-900/30 border-amber-700/50'
                                                            : 'text-amber-400/70 hover:text-amber-400 hover:bg-amber-900/20 border-amber-900/30'
                                                            }`}
                                                    >
                                                        📦 预设
                                                    </button>
                                                    {showLibPresetDropdown && (
                                                        <>
                                                        <div className="fixed inset-0 z-40" onClick={() => setShowLibPresetDropdown(false)} />
                                                        <div className="absolute right-0 top-full mt-1 w-64 bg-zinc-900 border border-amber-700/50 rounded-lg shadow-xl z-50 p-2 space-y-1">
                                                            <div className="text-[10px] text-amber-400 font-medium px-1 mb-1">点击添加预设互动语库：</div>
                                                            {LIBRARY_PRESETS.map(preset => {
                                                                const alreadyAdded = libraries.some(l => l.name === preset.name);
                                                                return (
                                                                    <button
                                                                        key={preset.id}
                                                                        onClick={() => {
                                                                            if (alreadyAdded) return;
                                                                            const cloned: CopywritingLibrary = {
                                                                                ...preset,
                                                                                id: `${preset.id}_${Date.now()}`,
                                                                                items: preset.items.map(item => ({ ...item, id: `${item.id}_${Date.now()}`, usedCount: 0 })),
                                                                                source: 'preset',
                                                                            };
                                                                            setLibraries(prev => [...prev, cloned]);
                                                                            setActiveLibraryId(cloned.id);
                                                                            showCopyToast(`✅ 已添加「${preset.name}」(${preset.items.length}条)`);
                                                                        }}
                                                                        disabled={alreadyAdded}
                                                                        className={`w-full text-left px-2 py-1.5 rounded-lg transition-colors flex items-center justify-between ${alreadyAdded
                                                                            ? 'opacity-40 cursor-not-allowed'
                                                                            : 'hover:bg-amber-900/20 group'
                                                                            }`}
                                                                    >
                                                                        <div className="flex items-center gap-1.5">
                                                                            <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: preset.color }} />
                                                                            <span className={`text-xs font-medium ${alreadyAdded ? 'text-zinc-500' : 'text-zinc-200 group-hover:text-amber-300'}`}>{preset.name}</span>
                                                                        </div>
                                                                        <span className="text-[9px] text-zinc-500">{alreadyAdded ? '✓ 已添加' : `${preset.items.length}条`}</span>
                                                                    </button>
                                                                );
                                                            })}
                                                            <div className="border-t border-zinc-800 pt-1 mt-1">
                                                                <div className="text-[9px] text-zinc-600 px-1">💡 点击添加到现有库列表</div>
                                                            </div>
                                                        </div>
                                                        </>
                                                    )}
                                                </div>
                                                <button
                                                    onClick={() => setShowLibraryEditor(true)}
                                                    className="px-1.5 py-0.5 text-[9px] text-green-400 hover:bg-green-900/20 rounded border border-green-900/30"
                                                >
                                                    <Settings2 size={9} className="inline mr-0.5" /> 编辑库
                                                </button>
                                            </div>
                                        </div>
                                        {/* 启用的库列表 */}
                                        <div className="space-y-1">
                                            {libraries.filter(lib => lib.enabled).map(lib => {
                                                const srcBadge = lib.source === 'preset' ? '📦' : lib.source === 'sheets' ? '📊' : '✏️';
                                                return (
                                                    <div key={lib.id} className="flex items-center gap-1.5 px-1.5 py-1 rounded bg-zinc-800/60 group/lib">
                                                        <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: lib.color }} />
                                                        <span className="text-[9px] shrink-0 opacity-60" title={lib.source === 'preset' ? '预设库' : lib.source === 'sheets' ? '表格导入' : '手动添加'}>{srcBadge}</span>
                                                        <span className="text-[10px] font-medium shrink-0 text-zinc-300">{lib.name}</span>
                                                        <span className="text-[9px] text-zinc-600 shrink-0">
                                                            {lib.items.filter(i => i.usedCount < lib.maxRepeat).length}/{lib.items.length}
                                                        </span>
                                                        <input
                                                            type="text"
                                                            value={lib.matchRule}
                                                            onChange={(e) => setLibraries(prev => prev.map(l => l.id === lib.id ? { ...l, matchRule: e.target.value } : l))}
                                                            onDoubleClick={() => setEditingLibField({ type: 'matchRule', libId: lib.id })}
                                                            className="flex-1 bg-transparent border-none text-[10px] text-zinc-500 focus:text-zinc-200 focus:outline-none focus:bg-zinc-900/50 rounded px-1 truncate cursor-pointer"
                                                            placeholder="使用指令（双击放大）"
                                                            title="双击放大编辑"
                                                        />
                                                        {/* 停用按钮 */}
                                                        <button
                                                            onClick={() => setLibraries(prev => prev.map(l => l.id === lib.id ? { ...l, enabled: false } : l))}
                                                            className="p-0.5 text-zinc-600 hover:text-amber-400 opacity-0 group-hover/lib:opacity-100 transition-opacity shrink-0"
                                                            title="停用此库"
                                                        >
                                                            <Eye size={10} />
                                                        </button>
                                                        {/* 删除按钮 */}
                                                        <button
                                                            onClick={() => setLibraries(prev => prev.filter(l => l.id !== lib.id))}
                                                            className="p-0.5 text-zinc-600 hover:text-red-400 opacity-0 group-hover/lib:opacity-100 transition-opacity shrink-0"
                                                            title="删除此库"
                                                        >
                                                            <X size={10} />
                                                        </button>
                                                    </div>
                                                );
                                            })}
                                            {/* 停用的库（折叠显示） */}
                                            {libraries.filter(lib => !lib.enabled).length > 0 && (
                                                <div className="flex flex-wrap gap-1 pt-1 border-t border-zinc-800/50">
                                                    <span className="text-[9px] text-zinc-600">已停用：</span>
                                                    {libraries.filter(lib => !lib.enabled).map(lib => (
                                                        <button
                                                            key={lib.id}
                                                            onClick={() => setLibraries(prev => prev.map(l => l.id === lib.id ? { ...l, enabled: true } : l))}
                                                            className="text-[9px] text-zinc-600 hover:text-green-400 px-1 py-0.5 rounded hover:bg-green-900/20 transition-colors"
                                                            title="点击重新启用"
                                                        >
                                                            <span className="w-1.5 h-1.5 rounded-full border border-zinc-600 inline-block mr-0.5 align-middle" />
                                                            {lib.name}
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                            {libraries.length === 0 && (
                                                <span className="text-[10px] text-zinc-600 italic">无库，点击"编辑库"或"📦 预设"添加</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* 额外改写指令（全局，可选） */}
                            <div className="bg-zinc-950 border border-green-900/30 rounded-lg p-2">
                                <div className="text-[10px] text-green-400 font-medium mb-1">额外改写指令（可选）</div>
                                {libraryExtraInstructions.map((inst, idx) => (
                                    <div key={idx} className="flex items-start gap-1 mb-1">
                                        <span className="text-[10px] text-green-400 w-4 shrink-0 mt-1">{idx + 1}.</span>
                                        <textarea
                                            value={inst}
                                            onChange={(e) => {
                                                setLibraryExtraInstructions(prev => {
                                                    const next = [...prev];
                                                    next[idx] = e.target.value;
                                                    return next;
                                                });
                                            }}
                                            onDoubleClick={() => setEditingLibField({ type: 'extraInst', idx })}
                                            placeholder="如：把标题改为疑问句"
                                            data-tip="双击放大编辑"
                                            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-green-500 placeholder-zinc-600 resize-none tooltip-bottom cursor-pointer"
                                            rows={1}
                                        />
                                        {/* 预设选择按钮 */}
                                        <button
                                            onClick={() => setActivePresetDropdown(activePresetDropdown === -(200 + idx) ? null : -(200 + idx))}
                                            className={`p-1 rounded transition-colors mt-0.5 ${activePresetDropdown === -(200 + idx)
                                                ? 'text-amber-400 bg-amber-900/30'
                                                : 'text-zinc-500 hover:text-amber-400 hover:bg-zinc-800'
                                                } tooltip-bottom`}
                                            data-tip="选择预设"
                                        >
                                            <ChevronDown size={12} />
                                        </button>
                                        {libraryExtraInstructions.length > 1 && (
                                            <button
                                                onClick={() => setLibraryExtraInstructions(prev => prev.filter((_, i) => i !== idx))}
                                                className="p-0.5 text-zinc-500 hover:text-red-400 mt-0.5"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {/* 预设下拉（当某个额外指令激活时显示） */}
                                {activePresetDropdown !== null && activePresetDropdown <= -200 && (
                                    <div className="mt-1 bg-zinc-950 border border-amber-700/50 rounded-lg p-2">
                                        <div className="text-[10px] text-amber-400 mb-1.5">
                                            选择预设填充到指令 {-(activePresetDropdown) - 200 + 1}：
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {BUILTIN_PRESETS.map(preset => (
                                                <button
                                                    key={preset.id}
                                                    onClick={() => {
                                                        const targetIdx = -(activePresetDropdown!) - 200;
                                                        setLibraryExtraInstructions(prev => {
                                                            const next = [...prev];
                                                            next[targetIdx] = preset.instruction;
                                                            return next;
                                                        });
                                                        setActivePresetDropdown(null);
                                                    }}
                                                    className="px-2 py-1 bg-zinc-800 hover:bg-amber-900/30 text-xs text-amber-300 rounded border border-zinc-700 hover:border-amber-600 truncate max-w-[150px]"
                                                    title={preset.instruction}
                                                >
                                                    {preset.name}
                                                </button>
                                            ))}
                                            {presets.map(preset => (
                                                <button
                                                    key={preset.id}
                                                    onClick={() => {
                                                        const targetIdx = -(activePresetDropdown!) - 200;
                                                        setLibraryExtraInstructions(prev => {
                                                            const next = [...prev];
                                                            next[targetIdx] = preset.instruction;
                                                            return next;
                                                        });
                                                        setActivePresetDropdown(null);
                                                    }}
                                                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 rounded border border-zinc-700 truncate max-w-[150px]"
                                                    title={preset.instruction}
                                                >
                                                    {preset.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <button
                                    onClick={() => setLibraryExtraInstructions(prev => [...prev, ''])}
                                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-green-400 hover:bg-green-900/20 rounded border border-green-900/30"
                                >
                                    <Plus size={10} /> 添加指令
                                </button>
                            </div>
                        </div>
                    ) : mode === 'social-media' ? (
                        <div className="space-y-2">
                            {/* 系统指令 - 可折叠 */}
                            <div className="bg-zinc-950 border border-teal-900/30 rounded-lg">
                                <button
                                    onClick={() => setSocialMediaShowSystemInstruction(prev => !prev)}
                                    className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-teal-900/10 transition-colors rounded-lg"
                                >
                                    <div className="flex items-center gap-1.5">
                                        {socialMediaShowSystemInstruction ? <ChevronDown size={12} className="text-teal-400/60" /> : <ChevronUp size={12} className="text-teal-400/60 -rotate-90" />}
                                        <span className="text-teal-400 text-xs font-medium">📱 系统指令</span>
                                        {!socialMediaShowSystemInstruction && <span className="text-[9px] text-zinc-500 truncate max-w-[180px]">{socialMediaModeSystemInstruction.slice(0, 40)}...</span>}
                                    </div>
                                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                        <button
                                            onClick={() => setSocialMediaModeSystemInstruction(SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION)}
                                            className="px-1.5 py-0.5 text-[9px] text-teal-400/60 hover:text-teal-400 rounded bg-teal-900/20 hover:bg-teal-900/40 transition-colors"
                                        >
                                            重置
                                        </button>
                                    </div>
                                </button>
                                {socialMediaShowSystemInstruction && (
                                    <div className="px-2 pb-2">
                                        <textarea
                                            value={socialMediaModeSystemInstruction}
                                            onChange={(e) => setSocialMediaModeSystemInstruction(e.target.value)}
                                            onDoubleClick={() => setEditingSocialMediaField({ type: 'systemInstruction' })}
                                            placeholder={SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION}
                                            data-tip="双击弹框编辑"
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-teal-500 placeholder-zinc-600 resize-y min-h-[200px] max-h-[500px] leading-relaxed cursor-pointer tooltip-bottom"
                                            rows={12}
                                        />
                                    </div>
                                )}
                            </div>
                            {/* 输出分项编辑器 - 可折叠 */}
                            <div className="bg-zinc-950 border border-teal-900/20 rounded-lg">
                                <button
                                    onClick={() => setSocialMediaShowOutputSections(prev => !prev)}
                                    className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-teal-900/10 transition-colors rounded-lg"
                                >
                                    <div className="flex items-center gap-1.5">
                                        {socialMediaShowOutputSections ? <ChevronDown size={12} className="text-teal-400/60" /> : <ChevronUp size={12} className="text-teal-400/60 -rotate-90" />}
                                        <span className="text-[10px] text-teal-400 font-medium">📤 输出分项（{socialMediaOutputSections.filter(s => s.enabled).length} 个启用）</span>
                                        <div className="flex items-center gap-1">
                                            {socialMediaOutputSections.filter(s => s.enabled).map((s) => (
                                                <span key={s.id} className="px-1 py-0 rounded text-[9px] bg-teal-900/20 text-teal-400/80">{s.name}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                        <button
                                            onClick={() => setSocialMediaOutputSections(DEFAULT_SOCIAL_MEDIA_OUTPUT_SECTIONS.map(s => ({ ...s })))}
                                            className="px-1 py-0.5 text-[9px] text-zinc-500 hover:text-teal-400 rounded hover:bg-zinc-800 transition-colors"
                                        >
                                            重置
                                        </button>
                                        <button
                                            onClick={() => setSocialMediaOutputSections(prev => [...prev, { id: uuidv4(), name: '新分项', description: '请描述这个分项的输出要求...', enabled: true }])}
                                            className="px-1 py-0.5 text-[9px] text-teal-400 hover:text-teal-300 rounded hover:bg-teal-900/20 transition-colors flex items-center gap-0.5"
                                        >
                                            <Plus size={9} /> 添加
                                        </button>
                                    </div>
                                </button>
                                {socialMediaShowOutputSections && (
                                    <div className="px-2 pb-2 space-y-1">
                                        {socialMediaOutputSections.map((section, idx) => (
                                            <div key={section.id} className={`border rounded transition-all ${section.enabled ? 'border-teal-900/30 bg-teal-900/10' : 'border-zinc-800 bg-zinc-900/30 opacity-50'}`}>
                                                <div className="flex items-center gap-1 px-1.5" style={{ height: '22px' }}>
                                                    <button
                                                        onClick={() => setSocialMediaOutputSections(prev => prev.map(s => s.id === section.id ? { ...s, enabled: !s.enabled } : s))}
                                                        className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${section.enabled ? 'border-teal-500/50 bg-teal-500/20' : 'border-zinc-700 bg-zinc-800'}`}
                                                    >
                                                        {section.enabled && <Check className="w-2 h-2 text-teal-400" />}
                                                    </button>
                                                    <span className="text-teal-400/60 shrink-0" style={{ fontSize: '9px' }}>{idx + 1}.</span>
                                                    <input
                                                        type="text"
                                                        value={section.name}
                                                        onChange={e => setSocialMediaOutputSections(prev => prev.map(s => s.id === section.id ? { ...s, name: e.target.value } : s))}
                                                        className="flex-1 bg-transparent text-zinc-200 focus:outline-none border-b border-transparent focus:border-teal-500/50 min-w-0"
                                                        style={{ fontSize: '10px', lineHeight: '18px', padding: '0 2px' }}
                                                        placeholder="分项名称"
                                                    />
                                                    {socialMediaOutputSections.length > 1 && (
                                                        <button
                                                            onClick={() => setSocialMediaOutputSections(prev => prev.filter(s => s.id !== section.id))}
                                                            className="p-0.5 text-zinc-600 hover:text-red-400 transition-colors"
                                                        >
                                                            <X size={9} />
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="px-1.5 pb-1">
                                                    <textarea
                                                        value={section.description}
                                                        onChange={e => setSocialMediaOutputSections(prev => prev.map(s => s.id === section.id ? { ...s, description: e.target.value } : s))}
                                                        onDoubleClick={() => setEditingSocialMediaField({ type: 'sectionDesc', sectionId: section.id })}
                                                        placeholder="描述输出要求（双击放大编辑）"
                                                        data-tip="双击弹框编辑"
                                                        className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-1.5 text-zinc-400 focus:outline-none focus:border-teal-500/30 placeholder-zinc-600 resize-none leading-relaxed cursor-pointer tooltip-bottom"
                                                        style={{ fontSize: '9px', padding: '2px 6px' }}
                                                        rows={1}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                        <div style={{ fontSize: '9px' }} className="text-zinc-600 mt-0.5">第 1 个分项 → 左列 · 其余 → 右列 · 双击描述放大编辑</div>
                                    </div>
                                )}
                            </div>
                            {/* 额外改写指令 */}
                            <div className="bg-zinc-950 border border-teal-900/20 rounded-lg p-2">
                                <div className="flex items-center justify-between mb-1">
                                    <div className="text-[10px] text-teal-400 font-medium">🎯 额外改写指令（可选）</div>
                                    <div className="flex items-center gap-1">
                                        <span style={{ fontSize: '9px' }} className="text-zinc-500">每文案</span>
                                        <select
                                            value={socialMediaResultCount}
                                            onChange={e => setSocialMediaResultCount(Number(e.target.value))}
                                            className="bg-zinc-800 border border-zinc-700 rounded text-teal-300 focus:outline-none focus:border-teal-500 cursor-pointer"
                                            style={{ fontSize: '10px', padding: '1px 4px' }}
                                        >
                                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                                                <option key={n} value={n}>{n}个结果</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <textarea
                                    value={instructions[0] || ''}
                                    onChange={(e) => updateInstruction(0, e.target.value)}
                                    onDoubleClick={() => setEditingInstructionIndex(0)}
                                    placeholder="（可选）在这里输入额外的改写要求，比如：语气更活泼、主题偏向恩典..."
                                    data-tip="双击弹框编辑"
                                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-teal-500 placeholder-zinc-600 resize-none min-h-[36px] cursor-pointer tooltip-bottom"
                                    rows={2}
                                />
                            </div>
                        </div>
                    ) : (mode === 'classify' && classifySubMode === 'advanced') ? (
                        <div className="space-y-1.5">
                            {/* 多维分类列编辑器 */}
                            <div className="space-y-1.5 max-h-72 overflow-y-auto overflow-x-hidden">
                                {classifyColumns.map((col, idx) => (
                                    <div key={col.id} className={`bg-zinc-950 border rounded-lg p-2 transition-opacity ${col.enabled ? 'border-cyan-900/30 opacity-100' : 'border-zinc-800 opacity-50'}`}>
                                        <div className="flex items-center gap-1.5 mb-1">
                                            {/* 启用开关 */}
                                            <button
                                                onClick={() => {
                                                    setClassifyColumns(prev => prev.map(c => c.id === col.id ? { ...c, enabled: !c.enabled } : c));
                                                }}
                                                className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${col.enabled ? 'bg-cyan-600 border-cyan-500 text-white' : 'bg-zinc-800 border-zinc-600 text-zinc-600'}`}
                                            >
                                                {col.enabled && <Check size={10} />}
                                            </button>
                                            <span className="text-[10px] text-cyan-400 font-bold w-3 shrink-0">{idx + 1}.</span>
                                            {/* 列名 */}
                                            <input
                                                type="text"
                                                value={col.name}
                                                onChange={(e) => {
                                                    setClassifyColumns(prev => prev.map(c => c.id === col.id ? { ...c, name: e.target.value } : c));
                                                }}
                                                placeholder="列名"
                                                className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs text-cyan-200 focus:outline-none focus:border-cyan-500 placeholder-zinc-600 min-w-0"
                                            />
                                            {/* 类型标签 */}
                                            <select
                                                value={col.type}
                                                onChange={(e) => {
                                                    setClassifyColumns(prev => prev.map(c => c.id === col.id ? { ...c, type: e.target.value as ClassifyColumnType } : c));
                                                }}
                                                className="bg-zinc-800 border border-zinc-700 rounded px-1 py-0.5 text-[10px] text-zinc-300 focus:outline-none"
                                            >
                                                <option value="ai-with-options">AI选项分类</option>
                                                <option value="ai-free">AI自由标签</option>
                                                <option value="local-wordcount">本地字数</option>
                                            </select>
                                            {/* 删除 */}
                                            {classifyColumns.length > 1 && (
                                                <button
                                                    onClick={() => setClassifyColumns(prev => prev.filter(c => c.id !== col.id))}
                                                    className="p-0.5 text-zinc-500 hover:text-red-400"
                                                >
                                                    <X size={12} />
                                                </button>
                                            )}
                                        </div>
                                        {/* 描述/指令 */}
                                        <textarea
                                            value={col.description}
                                            onChange={(e) => {
                                                setClassifyColumns(prev => prev.map(c => c.id === col.id ? { ...c, description: e.target.value } : c));
                                            }}
                                            placeholder={col.type === 'local-wordcount' ? '说明（字数列无需AI指令）' : 'AI分类指令说明...'}
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-cyan-500 placeholder-zinc-600 resize-none"
                                            rows={1}
                                        />
                                        {/* AI选项分类：可选项列表 */}
                                        {col.type === 'ai-with-options' && (
                                            <input
                                                type="text"
                                                value={col.options || ''}
                                                onChange={(e) => {
                                                    setClassifyColumns(prev => prev.map(c => c.id === col.id ? { ...c, options: e.target.value } : c));
                                                }}
                                                placeholder="可选项（逗号分隔），如：祷告类, 宣告类, 故事类..."
                                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-amber-300 focus:outline-none focus:border-amber-500 placeholder-zinc-600 mt-1"
                                            />
                                        )}
                                        {/* 字数分类：区间设置 */}
                                        {col.type === 'local-wordcount' && (
                                            <div className="mt-1">
                                                <input
                                                    type="text"
                                                    value={col.wordCountRanges || ''}
                                                    onChange={(e) => {
                                                        setClassifyColumns(prev => prev.map(c => c.id === col.id ? { ...c, wordCountRanges: e.target.value } : c));
                                                    }}
                                                    placeholder="字数区间，如：0-50, 50-100, 100-200, 200+"
                                                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-[10px] text-sky-300 focus:outline-none focus:border-sky-500 placeholder-zinc-600"
                                                />
                                                <div className="flex flex-wrap gap-1 mt-1">
                                                    {parseWordCountRanges(col.wordCountRanges || '').map((range, ri) => (
                                                        <span key={ri} className="px-1.5 py-0 text-[9px] rounded-full bg-sky-900/30 text-sky-300 border border-sky-800/40">{range.label}字</span>
                                                    ))}
                                                </div>
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    onClick={() => setClassifyColumns(prev => [...prev, {
                                        id: `classify_custom_${Date.now()}`,
                                        name: '',
                                        type: 'ai-free',
                                        description: '',
                                        enabled: true,
                                    }])}
                                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-cyan-400 hover:bg-cyan-900/20 rounded border border-cyan-900/30"
                                >
                                    <Plus size={10} /> 添加分类维度
                                </button>
                                <button
                                    onClick={() => setClassifyColumns(DEFAULT_CLASSIFY_COLUMNS.map(c => ({ ...c })))}
                                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded border border-zinc-700/50"
                                >
                                    <RotateCw size={8} /> 重置默认
                                </button>
                            </div>
                        </div>
                    ) : (mode === 'classify' && classifyByWordCount) ? (
                        <div className="space-y-2">
                            <div className="bg-zinc-950 border border-sky-900/30 rounded-lg p-3">
                                <div className="flex items-center gap-2 mb-2">
                                    <span className="text-sky-400 text-xs font-medium">📏 字数分类区间</span>
                                    <span className="text-[9px] text-zinc-500">纯本地分类，不调用 AI</span>
                                </div>
                                <input
                                    type="text"
                                    value={wordCountRangesText}
                                    onChange={(e) => setWordCountRangesText(e.target.value)}
                                    placeholder="例如：0-50, 50-100, 100-200, 200-500, 500+"
                                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-xs text-zinc-200 focus:outline-none focus:border-sky-500 placeholder-zinc-600"
                                />
                                <div className="flex flex-wrap gap-1 mt-2">
                                    {parseWordCountRanges(wordCountRangesText).map((range, idx) => (
                                        <span key={idx} className="px-2 py-0.5 text-[10px] rounded-full bg-sky-900/30 text-sky-300 border border-sky-800/40">
                                            {range.label}字
                                        </span>
                                    ))}
                                    {parseWordCountRanges(wordCountRangesText).length === 0 && (
                                        <span className="text-[10px] text-red-400">⚠️ 无效区间格式，请用逗号分隔，如 0-50, 50-100, 100+</span>
                                    )}
                                </div>
                                <div className="text-[9px] text-zinc-500 mt-2 border-t border-zinc-800 pt-2">
                                    💡 格式：用逗号分隔区间，如 <code className="text-sky-400/80">0-50, 50-100, 100-200, 200+</code>。末尾加 <code className="text-sky-400/80">+</code> 表示无上限。
                                </div>
                                <div className="flex flex-wrap gap-1 mt-2">
                                    <span className="text-[9px] text-zinc-500">快速设置：</span>
                                    <button
                                        onClick={() => setWordCountRangesText('0-50, 50-100, 100-200, 200-500, 500+')}
                                        className="px-1.5 py-0.5 text-[9px] rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700"
                                    >
                                        默认5档
                                    </button>
                                    <button
                                        onClick={() => setWordCountRangesText('0-100, 100-300, 300-500, 500-1000, 1000+')}
                                        className="px-1.5 py-0.5 text-[9px] rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700"
                                    >
                                        长文5档
                                    </button>
                                    <button
                                        onClick={() => setWordCountRangesText('0-30, 30-60, 60-100, 100-150, 150-200, 200+')}
                                        className="px-1.5 py-0.5 text-[9px] rounded bg-zinc-800 text-zinc-400 hover:bg-zinc-700 border border-zinc-700"
                                    >
                                        精细6档
                                    </button>
                                </div>
                            </div>
                        </div>
                    ) : mode === 'cleaner' ? null : (
                        <>
                            {/* 预设快速选择栏 */}
                            <div className="flex flex-wrap gap-1 mb-1.5 items-center">
                                {/* 内置/自定义 开关 */}
                                <button
                                    onClick={() => setShowBuiltinPresets(v => !v)}
                                    className={`px-1.5 py-0.5 text-[9px] rounded transition-all border flex items-center gap-0.5 ${showBuiltinPresets
                                        ? 'bg-amber-900/30 text-amber-400 border-amber-700/50'
                                        : 'bg-zinc-800/30 text-zinc-600 border-zinc-700/50'}`}
                                >
                                    {showBuiltinPresets ? '▸' : '▹'} 内置({BUILTIN_PRESETS.filter(p => !hiddenPresetIds.includes(p.id) && (mode === 'classify' ? p.presetCategory === '分类预设' : p.presetCategory !== '分类预设')).length})
                                </button>
                                <button
                                    onClick={() => setShowCustomPresets(v => !v)}
                                    className={`px-1.5 py-0.5 text-[9px] rounded transition-all border flex items-center gap-0.5 ${showCustomPresets
                                        ? 'bg-blue-900/30 text-blue-400 border-blue-700/50'
                                        : 'bg-zinc-800/30 text-zinc-600 border-zinc-700/50'}`}
                                >
                                    {showCustomPresets ? '▸' : '▹'} 自定义({presets.filter(p => !hiddenPresetIds.includes(p.id) && (mode === 'classify' ? p.presetCategory === '分类预设' : p.presetCategory !== '分类预设')).length})
                                </button>
                                <div className="h-3 w-px bg-zinc-700 mx-0.5" />
                                {/* 内置预设 */}
                                {showBuiltinPresets && BUILTIN_PRESETS.filter(p => !hiddenPresetIds.includes(p.id) && (mode === 'classify' ? p.presetCategory === '分类预设' : p.presetCategory !== '分类预设')).map(preset => (
                                    <button
                                        key={preset.id}
                                        onClick={() => { updateInstruction(0, preset.instruction); setSelectedPresetId(preset.id); }}
                                        className={`px-2 py-0.5 text-[10px] rounded-full transition-all border ${selectedPresetId === preset.id
                                            ? (mode === 'classify' ? 'bg-cyan-600 text-white border-cyan-500' : 'bg-amber-600 text-white border-amber-500')
                                            : (mode === 'classify' ? 'bg-zinc-800/60 text-zinc-400 border-zinc-700 hover:bg-cyan-900/30 hover:text-cyan-300 hover:border-cyan-700' : 'bg-zinc-800/60 text-zinc-400 border-zinc-700 hover:bg-amber-900/30 hover:text-amber-300 hover:border-amber-700')
                                            }`}
                                        title={preset.instruction.slice(0, 100) + '...'}
                                    >
                                        {preset.name}
                                    </button>
                                ))}
                                {/* 自定义预设 */}
                                {showCustomPresets && presets.filter(p => !hiddenPresetIds.includes(p.id) && (mode === 'classify' ? p.presetCategory === '分类预设' : p.presetCategory !== '分类预设')).map(preset => (
                                    <button
                                        key={preset.id}
                                        onClick={() => { updateInstruction(0, preset.instruction); setSelectedPresetId(preset.id); }}
                                        className={`px-2 py-0.5 text-[10px] rounded-full transition-all border ${selectedPresetId === preset.id
                                            ? 'bg-blue-600 text-white border-blue-500'
                                            : 'bg-zinc-800/60 text-zinc-400 border-zinc-700 hover:bg-blue-900/30 hover:text-blue-300 hover:border-blue-700'
                                            }`}
                                        title={preset.instruction.slice(0, 100) + '...'}
                                    >
                                        {preset.name}
                                    </button>
                                ))}
                            </div>
                            {/* 多指令列表 */}
                            <div className="space-y-1.5 max-h-48 overflow-y-auto overflow-x-hidden">
                                {instructions.map((inst, idx) => (
                                    <div key={idx} className="flex items-start gap-1">
                                        <span className="text-[10px] text-amber-400 w-4 shrink-0 mt-1.5">{idx + 1}.</span>
                                        <div className="flex-1 relative tooltip-bottom">
                                            <textarea
                                                value={inst}
                                                onChange={(e) => updateInstruction(idx, e.target.value)}
                                                onDoubleClick={() => setEditingInstructionIndex(idx)}
                                                placeholder="输入改写指令..."
                                                data-tip="双击弹框编辑"
                                                className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 placeholder-zinc-600 resize-none min-h-[36px]"
                                                rows={2}
                                            />
                                        </div>
                                        {/* 预设选择按钮 */}
                                        <button
                                            onClick={() => setActivePresetDropdown(activePresetDropdown === idx ? null : idx)}
                                            className={`p-1 rounded transition-colors mt-0.5 ${activePresetDropdown === idx
                                                ? 'text-amber-400 bg-amber-900/30'
                                                : 'text-zinc-500 hover:text-amber-400 hover:bg-zinc-800'
                                                } tooltip-bottom`}
                                            data-tip="选择预设"
                                        >
                                            <ChevronDown size={12} />
                                        </button>
                                        {instructions.length > 1 && (
                                            <button
                                                onClick={() => removeInstruction(idx)}
                                                className="p-0.5 text-zinc-500 hover:text-red-400 mt-1"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                            </div>

                            {/* 预设选择面板 - 当选中某个指令时显示 */}
                            {activePresetDropdown !== null && activePresetDropdown >= 0 && (
                                <div className="mt-2 bg-zinc-950 border border-amber-700/50 rounded-lg p-2">
                                    <div className="text-[10px] text-amber-400 mb-1.5">
                                        选择预设填充到指令 {activePresetDropdown + 1}：
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {BUILTIN_PRESETS.filter(p => mode === 'classify' ? p.presetCategory === '分类预设' : p.presetCategory !== '分类预设').map(preset => (
                                            <button
                                                key={preset.id}
                                                onClick={() => { updateInstruction(activePresetDropdown, preset.instruction); setActivePresetDropdown(null); }}
                                                className={`px-2 py-1 bg-zinc-800 text-xs rounded border border-zinc-700 truncate max-w-[150px] ${mode === 'classify' ? 'hover:bg-cyan-900/30 text-cyan-300 hover:border-cyan-600' : 'hover:bg-amber-900/30 text-amber-300 hover:border-amber-600'}`}
                                                title={preset.instruction}
                                            >
                                                {preset.name}
                                            </button>
                                        ))}
                                        {presets.filter(p => mode === 'classify' ? p.presetCategory === '分类预设' : p.presetCategory !== '分类预设').map(preset => (
                                            <button
                                                key={preset.id}
                                                onClick={() => { updateInstruction(activePresetDropdown, preset.instruction); setActivePresetDropdown(null); }}
                                                className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 rounded border border-zinc-700 truncate max-w-[150px]"
                                                title={preset.instruction}
                                            >
                                                {preset.name}
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* 添加指令按钮 + 多结果设置 */}
                            <div className="mt-2 flex items-center gap-1 flex-wrap">
                                <button
                                    onClick={addInstruction}
                                    className="inline-flex h-5 items-center gap-1 px-1.5 text-[10px] font-medium text-amber-400 hover:bg-amber-900/20 rounded border border-amber-900/30"
                                >
                                    <Plus size={10} /> 添加指令
                                </button>
                                {mode === 'standard' && (
                                    <div className="flex items-center gap-1 flex-nowrap shrink-0">
                                        <span className="text-[10px] text-zinc-500 whitespace-nowrap leading-none shrink-0">每指令结果数:</span>
                                        {[1, 2, 3, 5].map(n => (
                                            <button
                                                key={n}
                                                onClick={() => setRewriteVariantCount(n)}
                                                className={`inline-flex h-5 min-w-[20px] items-center justify-center px-1 text-[10px] font-medium rounded transition-all border ${
                                                    rewriteVariantCount === n
                                                        ? 'bg-purple-600 text-white border-purple-500'
                                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                                }`}
                                            >
                                                {n}
                                            </button>
                                        ))}
                                        <input
                                            type="number"
                                            min={1}
                                            max={10}
                                            value={rewriteVariantCount}
                                            onChange={e => setRewriteVariantCount(Math.max(1, Math.min(10, parseInt(e.target.value) || 1)))}
                                            className="h-5 w-9 bg-zinc-800 border border-zinc-700 rounded px-1 text-[10px] font-medium text-zinc-200 text-center leading-none focus:outline-none focus:border-purple-500 [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                                        />
                                    </div>
                                )}
                            </div>
                        </>
                    )}
                </div>

                {/* 输入文案 (右侧 45%) — 无文案模式下替换为生成按钮 */}
                <div className={`flex-1 min-w-[180px] bg-zinc-900 border border-zinc-800 rounded-lg p-3 ${mode === 'freeform' ? 'flex flex-col items-center justify-center' : ''}`}>
                    {mode === 'freeform' ? (
                        /* 无文案模式 - 显示生成按钮 + 数量选择 */
                        <>
                            <div className="text-center mb-3">
                                <Sparkles size={24} className="text-rose-400 mx-auto mb-2" />
                                <span className="text-xs text-zinc-400">无文案模式：无需输入原文</span>
                                <p className="text-[10px] text-zinc-500 mt-1">在左侧写好生成指令，设置数量后点击下方按钮生成</p>
                            </div>
                            {/* 生成数量选择 */}
                            <div className="flex flex-wrap items-center gap-2 mb-3">
                                <span className="text-[10px] text-zinc-500">生成数量：</span>
                                {[1, 3, 5, 10, 20].map(n => (
                                    <button
                                        key={n}
                                        onClick={() => setFreeformCount(n)}
                                        className={`px-2 py-0.5 text-[10px] rounded transition-all border ${freeformCount === n
                                            ? 'bg-rose-600 text-white border-rose-500'
                                            : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'}`}
                                    >
                                        {n}
                                    </button>
                                ))}
                                <input
                                    type="number"
                                    min={1}
                                    max={100}
                                    value={freeformCount}
                                    onChange={e => setFreeformCount(Math.max(1, Math.min(100, parseInt(e.target.value) || 1)))}
                                    className="w-12 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-[10px] text-zinc-200 text-center focus:outline-none focus:border-rose-500"
                                />
                            </div>
                            <button
                                onClick={handleStartProcessing}
                                disabled={isProcessing || !(instructions[0] || instruction || '').trim()}
                                className="px-4 py-2 bg-rose-600 hover:bg-rose-500 text-white rounded-lg text-sm font-medium disabled:opacity-50 flex items-center gap-2 transition-all"
                            >
                                {isProcessing ? (
                                    <><Loader2 size={14} className="animate-spin" /> 生成中...</>
                                ) : (
                                    <><Sparkles size={14} /> 生成 {freeformCount} 条</>
                                )}
                            </button>
                        </>
                    ) : (
                        /* 正常模式 - 输入文案 */
                        <>
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <FileText size={14} className="text-emerald-400" />
                            <span className="text-xs font-medium text-zinc-300">输入文案</span>
                            {bulkInput && (
                                <button onClick={() => setBulkInput('')} className="text-[10px] text-zinc-500 hover:text-zinc-300">清空</button>
                            )}
                        </div>
                        <span className="text-[10px] text-zinc-500">
                            待添加约 <span className="text-emerald-400 font-medium">{bulkInput.trim() ? bulkInput.trim().split('\n').length : 0}</span> 条
                        </span>
                    </div>
                    <div className="relative">
                        <textarea
                            value={bulkInput}
                            onChange={(e) => setBulkInput(e.target.value)}
                            onPaste={handlePaste}
                            placeholder="直接粘贴表格数据，自动识别单元格。支持：Google表格/Excel"
                            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 pb-8 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500 resize-none h-20 placeholder-zinc-600 font-mono"
                            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAddItems('batch'); }}
                        />
                        <div className="absolute bottom-1.5 right-1.5 flex gap-1">
                            <button
                                onClick={() => handleAddItems('single')}
                                disabled={!bulkInput.trim()}
                                className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-600 rounded text-[10px] disabled:opacity-50 flex items-center"
                            >
                                <Plus size={10} className="mr-0.5" /> 单条
                            </button>
                            <button
                                onClick={() => handleAddItems('batch')}
                                disabled={!bulkInput.trim()}
                                className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] disabled:opacity-50 flex items-center"
                            >
                                <FileText size={10} className="mr-0.5" /> 批量添加
                            </button>
                        </div>
                    </div>
                        </>
                    )}
                </div>
            </div>

            {/* === 状态栏 + 操作按钮 + 复制导出（自动换行） === */}
            <div className="flex flex-wrap items-center gap-2">
                {/* 状态栏 */}
                {items.length > 0 ? (
                    <div className="flex h-6 items-center gap-0 bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden shrink-0" style={{ minWidth: '200px', maxWidth: '320px' }}>
                        <div className="flex h-full flex-1 items-center px-3 border-r border-zinc-800 whitespace-nowrap">
                            <span className="text-zinc-500 text-[11px]">队列</span>
                            <span className="ml-1.5 text-zinc-200 font-bold text-sm">{stats.total}</span>
                        </div>
                        <div className="flex h-full flex-1 items-center px-3 border-r border-amber-900/30 bg-amber-900/10 whitespace-nowrap">
                            <span className="text-amber-400 text-[11px]">待处理</span>
                            <span className="ml-1.5 text-amber-400 font-bold text-sm">{stats.idle}</span>
                        </div>
                        <div className="flex h-full flex-1 items-center px-3 border-r border-emerald-900/30 bg-emerald-900/10 whitespace-nowrap">
                            <span className="text-emerald-400 text-[11px]">成功</span>
                            <span className="ml-1.5 text-emerald-400 font-bold text-sm">{stats.success}</span>
                        </div>
                        <div className="flex h-full flex-1 items-center px-3 bg-red-900/10 whitespace-nowrap">
                            <span className="text-red-400 text-[11px]">失败</span>
                            <span className="ml-1.5 text-red-400 font-bold text-sm">{stats.error}</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1" />
                )}

                <div className="ml-auto flex items-center justify-end gap-2 flex-wrap">
                    {/* 操作按钮 */}
                    <div className="flex items-center gap-2 flex-wrap">
                        {items.length > 0 && (
                            <>
                                {/* 折叠/展开按钮 */}
                                <button
                                    onClick={toggleAllCollapse}
                                    className="flex h-6 items-center gap-1 px-2 text-zinc-400 hover:bg-zinc-800 border border-zinc-700 rounded text-[10px]"
                                >
                                    {allCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                                    {allCollapsed ? '展开全部' : '收起全部'}
                                </button>
                                <button
                                    onClick={handleClearAll}
                                    className="flex h-6 items-center gap-1 px-2 text-red-400 hover:bg-red-900/20 border border-red-900/30 rounded text-[10px]"
                                >
                                    <Trash2 size={12} /> 清空
                                </button>
                                <button
                                    onClick={handleResetAll}
                                    disabled={stats.success === 0 && stats.error === 0}
                                    className="flex h-6 items-center gap-1 px-2 text-amber-400 hover:bg-amber-900/20 border border-amber-900/30 rounded text-[10px] disabled:opacity-50"
                                >
                                    <RotateCw size={12} /> 重做全部
                                </button>
                                {stats.error > 0 && (
                                    <button
                                        onClick={handleRetryAllErrors}
                                        className="flex h-6 items-center gap-1 px-2 text-red-400 hover:bg-red-900/20 border border-red-900/30 rounded text-[10px]"
                                    >
                                        <RotateCw size={12} /> 重试失败 ({stats.error})
                                    </button>
                                )}
                            </>
                        )}
                        {isProcessing ? (
                            <button
                                onClick={handleStopProcessing}
                                className="flex h-6 items-center gap-1 px-2.5 bg-red-600 hover:bg-red-500 text-white rounded text-[10px] font-medium"
                            >
                                <X size={14} /> 停止
                            </button>
                        ) : (
                            <button
                                onClick={handleStartProcessing}
                                disabled={stats.idle === 0 || (mode !== 'split' && mode !== 'library' && mode !== 'social-media' && mode !== 'parallel' && mode !== 'cleaner' && mode !== 'prayer' && !instructions.some(i => i.trim()))}
                                className={`flex h-6 items-center gap-1 px-2.5 ${mode === 'split' ? 'bg-orange-600 hover:bg-orange-500' : mode === 'library' ? 'bg-green-600 hover:bg-green-500' : mode === 'social-media' ? 'bg-teal-600 hover:bg-teal-500' : mode === 'parallel' ? 'bg-rose-600 hover:bg-rose-500' : mode === 'cleaner' ? 'bg-lime-600 hover:bg-lime-500' : mode === 'prayer' ? 'bg-sky-600 hover:bg-sky-500' : 'bg-purple-600 hover:bg-purple-500'} text-white rounded text-[10px] font-medium disabled:opacity-50`}
                            >
                                <Play size={14} /> {mode === 'split' ? '开始拆分' : mode === 'library' ? '开始匹配改写' : mode === 'social-media' ? '开始改写' : mode === 'parallel' ? '开始排比改写' : mode === 'cleaner' ? '开始清理' : mode === 'prayer' ? '开始提炼改写' : '开始改写'}
                            </button>
                        )}
                    </div>

                    {/* 复制按钮栏 */}
                    {stats.success > 0 && (
                        <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-xs text-zinc-500">批量复制:</span>

                            {/* === 拆分模式复制按钮 === */}
                            {mode === 'split' ? (
                                <>
                                    {splitColumns.map(col => (
                                        <button
                                            key={`copy_split_${col.id}`}
                                            onClick={() => handleCopySplitColumn(col.id)}
                                            className={`flex h-6 items-center gap-1 px-2 rounded text-[10px] transition-colors ${copiedType === `split_${col.id}`
                                                ? 'bg-orange-600 text-white'
                                                : 'bg-orange-900/30 hover:bg-orange-800/40 text-orange-300 border border-orange-700/30'
                                                }`}
                                        >
                                            {copiedType === `split_${col.id}` ? <Check size={12} /> : <Copy size={12} />}
                                            {col.name}
                                        </button>
                                    ))}
                                    <span className="text-zinc-600">|</span>
                                    <button
                                        onClick={handleCopySplitAll}
                                        className={`flex h-6 items-center gap-1 px-2 rounded text-[10px] transition-colors ${copiedType === 'split_all'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                            }`}
                                    >
                                        {copiedType === 'split_all' ? <Check size={12} /> : <Columns size={12} />}
                                        全部列（表格）
                                    </button>

                                    {/* 关键词频率统计 */}
                                    <span className="text-zinc-600">|</span>
                                    <select
                                        value={keywordStatsColumnId || ''}
                                        onChange={(e) => setKeywordStatsColumnId(e.target.value || null)}
                                        className="h-6 px-2 bg-zinc-800 border border-zinc-700 rounded text-[10px] text-zinc-300"
                                    >
                                        <option value="">选择统计列...</option>
                                        {splitColumns.map(col => (
                                            <option key={col.id} value={col.id}>{col.name}</option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={() => {
                                            const colId = keywordStatsColumnId || splitColumns.find(c => c.name.includes('关键词'))?.id || splitColumns[splitColumns.length - 1]?.id;
                                            if (colId) computeKeywordFrequency(colId);
                                        }}
                                        disabled={stats.success === 0}
                                        className="flex h-6 items-center gap-1 px-2 rounded text-[10px] transition-colors bg-sky-900/30 hover:bg-sky-800/40 text-sky-300 border border-sky-700/30 disabled:opacity-50"
                                    >
                                        <FileText size={12} />
                                        统计关键词频率
                                    </button>
                                    {hasStats && (
                                        <>
                                            <span className="text-[10px] text-sky-400">
                                                已统计 {statsKeyCount} 个词 / {keywordStatsTotalItems} 条
                                            </span>
                                            <button
                                                onClick={() => {
                                                    // 汇总表：关键词\t出现次数\t频率
                                                    const sortedKeywords = Object.entries(keywordFreqMap)
                                                        .sort((a, b) => b[1] - a[1])
                                                        .map(([kw, count]) => `${kw}\t${count}\t${(count / keywordStatsTotalItems * 100).toFixed(1)}%`);
                                                    const header = `关键词\t出现次数\t频率(总${keywordStatsTotalItems}条)`;
                                                    navigator.clipboard.writeText([header, ...sortedKeywords].join('\n'));
                                                    setCopiedType('stats_all');
                                                    showCopyToast(`已复制 ${sortedKeywords.length} 个关键词统计`);
                                                    setTimeout(() => setCopiedType(null), 1500);
                                                }}
                                                className={`flex h-6 items-center gap-1 px-2 rounded text-[10px] transition-colors ${copiedType === 'stats_all'
                                                    ? 'bg-sky-600 text-white'
                                                    : 'bg-sky-900/30 hover:bg-sky-800/40 text-sky-300 border border-sky-700/30'
                                                    }`}
                                            >
                                                {copiedType === 'stats_all' ? <Check size={12} /> : <Copy size={12} />}
                                                复制统计表
                                            </button>
                                            <button
                                                onClick={() => { setKeywordFreqMap({}); setKeywordStatsColumnId(null); setKeywordStatsTotalItems(0); }}
                                                className="text-[10px] text-zinc-500 hover:text-zinc-300"
                                            >清除</button>
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    <button
                                        onClick={() => handleCopy('foreign')}
                                        className={`flex h-6 items-center gap-1 px-2 rounded text-[10px] transition-colors ${copiedType === 'foreign'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                            }`}
                                    >
                                        {copiedType === 'foreign' ? <Check size={12} /> : <Copy size={12} />}
                                        {mode === "voice" ? '加标签' : mode === 'library' ? '改写结果' : mode === 'cleaner' ? '清理原文' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文'}
                                    </button>
                                    <button
                                        onClick={() => handleCopy('chinese')}
                                        className={`flex h-6 items-center gap-1 px-2 rounded text-[10px] transition-colors ${copiedType === 'chinese'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                            }`}
                                    >
                                        {copiedType === 'chinese' ? <Check size={12} /> : <Copy size={12} />}
                                        {mode === "voice" ? '断句' : mode === 'library' ? '中文翻译' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文'}
                                    </button>
                                    <button
                                        onClick={() => handleCopy('both')}
                                        className={`flex h-6 items-center gap-1 px-2 rounded text-[10px] transition-colors ${copiedType === 'both'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                            }`}
                                    >
                                        {copiedType === 'both' ? <Check size={12} /> : <Copy size={12} />}
                                        {mode === "voice" ? '标签+断句' : mode === 'library' ? '结果+翻译' : mode === 'cleaner' ? '全部清理结果' : mode === 'social-media' ? socialMediaOutputSections.filter(s => s.enabled).map(s => s.name).join('+') : '全部结果列'}
                                    </button>
                                    <button
                                        onClick={() => handleCopy('all')}
                                        className={`flex h-6 items-center gap-1 px-2 rounded text-[10px] transition-colors ${copiedType === 'all'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                            }`}
                                    >
                                        {copiedType === 'all' ? <Check size={12} /> : <Copy size={12} />}
                                        {mode === 'library' ? '完整表格(含原文)' : mode === 'cleaner' ? '完整表格(含原文)' : '完整表格(全部列)'}
                                    </button>

                                    {/* 按指令复制 - 当有多指令结果时显示 */}
                                    {instructions.filter(i => i.trim()).length > 0 && items.some(item => item.instructionResults && item.instructionResults.length > 0) && (
                                        <>
                                            <span className="text-zinc-600">|</span>
                                            <span className="text-[10px] text-zinc-500">按指令:</span>
                                            {instructions.filter(i => i.trim()).map((_, instIdx) => (
                                                <button
                                                    key={`copy_inst_${instIdx}`}
                                                    onClick={() => {
                                                        const allItems = items.filter(item => item.instructionResults && item.instructionResults.length > 0);
                                                        const col1Name = mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文';
                                                        const col2Name = mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文';
                                                        const headers = [`指令${instIdx + 1}${col1Name}`, `指令${instIdx + 1}${col2Name}`];
                                                        const rows = allItems.map(item => {
                                                            const r = item.instructionResults![instIdx];
                                                            if (r?.status === 'success') {
                                                                return `${escapeForSheet(r.resultForeign)}\t${escapeForSheet(r.resultChinese)}`;
                                                            }
                                                            return '\t'; // 空占位
                                                        });
                                                        const text = [headers.join('\t'), ...rows].join('\n');
                                                        navigator.clipboard.writeText(text);
                                                        setCopiedType(`inst_${instIdx}`);
                                                        showCopyToast(`已复制指令${instIdx + 1}结果 (${allItems.length}条)`);
                                                        setTimeout(() => setCopiedType(null), 1500);
                                                    }}
                                                    className={`flex h-6 items-center gap-1 px-2 rounded text-[10px] transition-colors ${copiedType === `inst_${instIdx}`
                                                        ? 'bg-purple-600 text-white'
                                                        : 'bg-purple-900/30 hover:bg-purple-800/40 text-purple-300 border border-purple-700/30'
                                                        }`}
                                                >
                                                    {copiedType === `inst_${instIdx}` ? <Check size={10} /> : <Copy size={10} />}
                                                    指令{instIdx + 1}
                                                </button>
                                            ))}
                                        </>
                                    )}
                                </>
                            )}

                            <button
                                onClick={handleExport}
                                className="flex h-6 items-center gap-1 px-2 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-600/30 rounded text-[10px] transition-colors"
                            >
                                <Download size={12} />
                                导出 TSV
                            </button>

                            {/* 保存到表格按钮 */}
                            <button
                                onClick={handleSaveToSheet}
                                disabled={sheetSaveStatus === 'saving'}
                                className={`flex h-6 items-center gap-1 px-2 rounded text-[10px] transition-colors border ${sheetSaveStatus === 'success' ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50' :
                                    sheetSaveStatus === 'error' ? 'bg-red-600/20 text-red-400 border-red-500/30' :
                                        'bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border-blue-600/30'
                                    }`}
                                title={sheetSaveStatus === 'error' ? sheetSaveError : '保存到 Google Sheets'}
                            >
                                {sheetSaveStatus === 'saving' ? <Loader2 size={12} className="animate-spin" /> :
                                    sheetSaveStatus === 'success' ? <Check size={12} /> :
                                        <FileText size={12} />}
                                {sheetSaveStatus === 'saving' ? '保存中...' :
                                    sheetSaveStatus === 'success' ? '已保存' :
                                        '保存表格'}
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* --- Results --- */}
            {items.length > 0 && (
                <div className="w-full max-w-none mx-auto flex-1">

                    {/* 库模式：多选批量分配工具栏 */}
                    {mode === 'library' && (
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <button
                                onClick={() => setItems(prev => prev.map(i => ({ ...i, selected: !prev.every(p => p.selected) })))}
                                className="px-2 py-1 text-[10px] text-green-400 hover:bg-green-900/20 rounded border border-green-900/30"
                            >
                                {items.every(i => i.selected) ? '取消全选' : '全选'}
                            </button>
                            {items.some(i => i.selected) && (
                                <>
                                    <span className="text-[10px] text-zinc-500">已选 {items.filter(i => i.selected).length} 条</span>
                                    <span className="text-[10px] text-zinc-600">|</span>
                                    <span className="text-[10px] text-zinc-500">指定库:</span>
                                    {libraries.map(lib => {
                                        const selectedItems = items.filter(i => i.selected);
                                        const allHaveLib = selectedItems.every(i => (i.selectedLibraryIds || []).includes(lib.id));
                                        return (
                                            <button
                                                key={lib.id}
                                                onClick={() => {
                                                    setItems(prev => prev.map(i => {
                                                        if (!i.selected) return i;
                                                        const current = i.selectedLibraryIds || [];
                                                        if (allHaveLib) {
                                                            return { ...i, selectedLibraryIds: current.filter(id => id !== lib.id) };
                                                        } else {
                                                            return { ...i, selectedLibraryIds: [...new Set([...current, lib.id])] };
                                                        }
                                                    }));
                                                }}
                                                className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded ${allHaveLib ? 'bg-green-800 text-green-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                                            >
                                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: lib.color }} />
                                                {lib.name}
                                            </button>
                                        );
                                    })}
                                    <button
                                        onClick={() => setItems(prev => prev.map(i => i.selected ? { ...i, selectedLibraryIds: undefined } : i))}
                                        className="px-1.5 py-0.5 text-[9px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded"
                                    >
                                        清除指定
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* 结果列表 */}
                    <div className="space-y-3">
                        {items.map((item) => (
                            <div
                                key={item.id}
                                className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
                            >
                                {/* 折叠头部 - 始终显示 */}
                                <div
                                    className="px-3 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between cursor-pointer hover:bg-zinc-800/50"
                                    onClick={() => toggleItemCollapse(item.id)}
                                >
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                        {/* 库模式：多选勾选 */}
                                        {mode === 'library' && (
                                            <input
                                                type="checkbox"
                                                checked={!!item.selected}
                                                onChange={(e) => {
                                                    e.stopPropagation();
                                                    setItems(prev => prev.map(i => i.id === item.id ? { ...i, selected: !i.selected } : i));
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-3 h-3 accent-green-500 cursor-pointer shrink-0"
                                            />
                                        )}
                                        <button className="text-zinc-400 hover:text-zinc-200">
                                            {item.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                                        </button>
                                        <span className="text-xs text-zinc-200 truncate flex-1">
                                            {item.originalForeign.slice(0, 80)}{item.originalForeign.length > 80 ? '...' : ''}
                                        </span>
                                        {/* 库模式：显示单条指定的库 */}
                                        {mode === 'library' && item.selectedLibraryIds && item.selectedLibraryIds.length > 0 && (
                                            <span className="flex items-center gap-0.5 px-1 py-0.5 bg-zinc-800 rounded text-[8px] text-zinc-500 shrink-0">
                                                {item.selectedLibraryIds.map(lid => {
                                                    const lib = libraries.find(l => l.id === lid);
                                                    return lib ? <span key={lid} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: lib.color }} title={lib.name} /> : null;
                                                })}
                                            </span>
                                        )}
                                        {/* 状态标签 */}
                                        {item.status === 'processing' && (
                                            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-900/30 text-amber-400 text-[10px] rounded">
                                                <Loader2 size={10} className="animate-spin" /> 处理中
                                            </span>
                                        )}
                                        {item.status === 'success' && (
                                            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 text-[10px] rounded">
                                                <Check size={10} /> 完成
                                                {(item.instructionResults?.length || 0) > 1 && (
                                                    <span className="text-emerald-300">({item.instructionResults?.length}步)</span>
                                                )}
                                            </span>
                                        )}
                                        {item.status === 'success' && mode === 'library' && item.libraryMatchedContent && (
                                            <span className="px-1.5 py-0.5 bg-green-900/30 text-green-300 text-[10px] rounded truncate max-w-[200px]" title={item.libraryMatchedContent}>
                                                📚 {item.libraryMatchedContent.slice(0, 30)}{item.libraryMatchedContent.length > 30 ? '...' : ''}
                                            </span>
                                        )}
                                        {item.status === 'error' && (
                                            <span className="px-1.5 py-0.5 bg-red-900/30 text-red-400 text-[10px] rounded">错误</span>
                                        )}
                                        {item.status === 'idle' && (
                                            <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 text-[10px] rounded">待处理</span>
                                        )}
                                    </div>
                                </div>

                                {/* 折叠内容 */}
                                {!item.collapsed && (
                                    <>
                                        {/* === 拆分模式结果渲染 === */}
                                        {(mode === 'split' || mode === 'parallel') && (
                                            <div className="overflow-x-auto">
                                                <div
                                                    className="grid gap-px bg-zinc-800"
                                                    style={{
                                                        gridTemplateColumns: splitGridStyle
                                                    }}
                                                >
                                                    {/* 原文列 */}
                                                    <div className="bg-zinc-950 p-3">
                                                        <div className="text-[10px] text-zinc-500 mb-1">原文</div>
                                                        <div className="text-sm text-zinc-300 whitespace-pre-wrap break-words">
                                                            {item.originalForeign}
                                                        </div>
                                                    </div>

                                                    {/* 各拆分列 */}
                                                    {splitColumns.map((col, colIdx) => {
                                                        const colorClasses = [
                                                            'border-orange-500/50 text-orange-400 text-orange-100',
                                                            'border-sky-500/50 text-sky-400 text-sky-100',
                                                            'border-emerald-500/50 text-emerald-400 text-emerald-100',
                                                            'border-violet-500/50 text-violet-400 text-violet-100',
                                                            'border-pink-500/50 text-pink-400 text-pink-100',
                                                            'border-amber-500/50 text-amber-400 text-amber-100',
                                                            'border-cyan-500/50 text-cyan-400 text-cyan-100',
                                                            'border-rose-500/50 text-rose-400 text-rose-100',
                                                        ];
                                                        const colors = colorClasses[colIdx % colorClasses.length].split(' ');
                                                        const borderClass = colors[0];
                                                        const labelClass = colors[1];
                                                        const textClass = colors[2];
                                                        const content = item.splitResults?.[col.id];

                                                        return (
                                                            <div key={col.id} className={`bg-zinc-950 border-l-2 ${borderClass} flex flex-col`}>
                                                                <div className="px-3 py-1 bg-zinc-800/50 flex items-center justify-between border-b border-zinc-700/50">
                                                                    <span className={`text-[10px] ${labelClass} font-medium`}>
                                                                        {col.name}
                                                                    </span>
                                                                    {item.status === 'success' && content && content !== '-' && (
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                navigator.clipboard.writeText(content);
                                                                                showCopyToast(`已复制「${col.name}」`);
                                                                            }}
                                                                            className={`px-1 py-0.5 text-[9px] ${labelClass} hover:bg-zinc-700/50 rounded`}
                                                                        >
                                                                            <Copy size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <div className="px-3 py-2 flex-1">
                                                                    {item.status === 'processing' ? (
                                                                        <div className="flex items-center gap-2 text-amber-400 text-sm">
                                                                            <Loader2 size={14} className="animate-spin" />
                                                                            处理中...
                                                                        </div>
                                                                    ) : item.status === 'success' ? (
                                                                        <div className={`text-sm ${textClass} whitespace-pre-wrap break-words`}>
                                                                            {content || '-'}
                                                                        </div>
                                                                    ) : item.status === 'error' ? (
                                                                        <div className="text-sm text-red-400">{item.error || '失败'}</div>
                                                                    ) : (
                                                                        <div className="text-sm text-zinc-600 italic">待处理</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}

                                                    {/* 关键词频率统计列 */}
                                                    {hasStats && (() => {
                                                        const statsText = getItemKeywordStatsText(item);
                                                        return (
                                                            <div className="bg-zinc-950 border-l-2 border-sky-500/50 flex flex-col">
                                                                <div className="px-3 py-1 bg-zinc-800/50 flex items-center justify-between border-b border-zinc-700/50">
                                                                    <span className="text-[10px] text-sky-400 font-medium">
                                                                        📊 频率统计
                                                                    </span>
                                                                    {item.status === 'success' && statsText && statsText !== '-' && (
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                navigator.clipboard.writeText(statsText);
                                                                                showCopyToast('已复制统计结果');
                                                                            }}
                                                                            className="px-1 py-0.5 text-[9px] text-sky-400 hover:bg-zinc-700/50 rounded"
                                                                        >
                                                                            <Copy size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <div className="px-3 py-2 flex-1">
                                                                    {item.status === 'success' ? (
                                                                        <div className="text-sm text-sky-100 whitespace-pre-wrap break-words">
                                                                            {statsText || '-'}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-sm text-zinc-600 italic">-</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                        )}

                                        {/* === 多维分类模式结果渲染 === */}
                                        {mode === 'classify' && classifySubMode === 'advanced' && item.classifyResults && Object.keys(item.classifyResults).length > 0 && (
                                            <div className="bg-zinc-950 border-t border-zinc-800 p-3">
                                                <div className="flex flex-wrap gap-2">
                                                    {classifyColumns.filter(c => c.enabled).map(col => {
                                                        const value = item.classifyResults?.[col.id];
                                                        const colorMap: Record<ClassifyColumnType, string> = {
                                                            'ai-with-options': 'bg-cyan-900/30 text-cyan-300 border-cyan-800/50',
                                                            'ai-free': 'bg-amber-900/30 text-amber-300 border-amber-800/50',
                                                            'local-wordcount': 'bg-sky-900/30 text-sky-300 border-sky-800/50',
                                                        };
                                                        return (
                                                            <div key={col.id} className="flex items-center gap-1">
                                                                <span className="text-[9px] text-zinc-500 shrink-0">{col.name}:</span>
                                                                <span className={`px-2 py-0.5 text-[11px] rounded-full border ${colorMap[col.type] || 'bg-zinc-800 text-zinc-300 border-zinc-700'}`}>
                                                                    {value || '-'}
                                                                </span>
                                                            </div>
                                                        );
                                                    })}
                                                </div>
                                            </div>
                                        )}

                                        {/* === 非拆分模式结果渲染 === */}
                                        {mode !== 'split' && !(mode === 'classify' && classifySubMode === 'advanced' && item.classifyResults && Object.keys(item.classifyResults).length > 0) && (
                                            <div className="overflow-x-auto" onDoubleClick={() => setDetailModalItem(item)}>
                                                <div
                                                    className="grid gap-px bg-zinc-800"
                                                    style={{
                                                        gridTemplateColumns: (() => {
                                                            const extraPartsCount = item.instructionResults?.reduce((max, r) => Math.max(max, r.resultExtraParts?.length || 0), 0) || 0;
                                                            const colCount = 2 + (item.instructionResults?.length || 1) * 2 + extraPartsCount;
                                                            // 少于等于4列时平分宽度，超过4列时固定宽度可滚动
                                                            if (colCount <= 4) {
                                                                return `repeat(${colCount}, 1fr)`;
                                                            } else {
                                                                return `repeat(${colCount}, minmax(280px, 1fr))`;
                                                            }
                                                        })()
                                                    }}
                                                >
                                                    {/* 原始外文 */}
                                                    <div className="bg-zinc-950 p-3" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                                        <div className="text-[10px] text-zinc-500 mb-1">
                                                            原始外文
                                                            {showDiff && item.status === 'success' && item.resultForeign && (
                                                                <span className="ml-2 text-amber-500">（差异高亮）</span>
                                                            )}
                                                        </div>
                                                        <div className="text-sm text-zinc-300 whitespace-pre-wrap break-words">
                                                            {showDiff && item.status === 'success' && item.resultForeign
                                                                ? computeWordDiff(item.originalForeign, item.resultForeign).originalWithDiff
                                                                : item.originalForeign
                                                            }
                                                        </div>
                                                    </div>

                                                    {/* 原始中文 */}
                                                    <div className="bg-zinc-950 p-3" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                                        <div className="text-[10px] text-zinc-500 mb-1">原始中文</div>
                                                        <div className="text-sm text-zinc-400 whitespace-pre-wrap break-words">
                                                            {item.originalChinese || <span className="italic text-zinc-600">-</span>}
                                                        </div>
                                                    </div>

                                                    {/* 各指令结果列 */}
                                                    {item.instructionResults?.map((result, idx) => (
                                                        <React.Fragment key={result.id}>
                                                            {/* 指令N - 外文/加标签/分类结果列 */}
                                                            <div className={`bg-zinc-950 border-l-2 ${mode === "classify" ? 'border-yellow-500/50' : 'border-purple-500/50'} flex flex-col`}>
                                                                {/* 标签行 */}
                                                                <div className="px-3 py-1 bg-zinc-800/50 flex items-center justify-between border-b border-zinc-700/50">
                                                                    <span className={`text-[10px] ${mode === "classify" ? 'text-yellow-400' : 'text-purple-400'} font-medium`}>
                                                                        {mode === "classify" ? `分类结果 ${idx + 1}` : `指令${idx + 1} ${mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文'}`}
                                                                    </span>
                                                                    {result.status === 'success' && (
                                                                        <div className="flex items-center gap-1">
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(result.resultForeign); showCopyToast(mode === "classify" ? `已复制分类结果${idx + 1}` : `已复制指令${idx + 1}${mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文'}`); }}
                                                                                className={`px-1 py-0.5 text-[9px] ${mode === "classify" ? 'text-yellow-400 hover:bg-yellow-900/30' : 'text-purple-400 hover:bg-purple-900/30'} rounded`}
                                                                                title={mode === "classify" ? '复制分类结果' : (mode === "voice" ? '复制加标签结果' : '复制外文')}
                                                                            >{mode === "classify" ? '分' : (mode === "voice" ? '标' : '外')}</button>
                                                                            {mode !== "classify" && (
                                                                                <button
                                                                                    onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${result.resultForeign}\t${result.resultChinese}`); showCopyToast(`已复制指令${idx + 1}${mode === "voice" ? '标签+断句' : '外文+中文'}`); }}
                                                                                    className="px-1 py-0.5 text-[9px] text-emerald-400 hover:bg-emerald-900/30 rounded"
                                                                                    title={mode === "voice" ? '复制标签+断句' : '复制外文+中文'}
                                                                                >全</button>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                {/* 内容行 */}
                                                                <div className="px-3 py-2 flex-1" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                                                    {result.status === 'processing' ? (
                                                                        <div className="flex items-center gap-2 text-amber-400 text-sm">
                                                                            <Loader2 size={14} className="animate-spin" />
                                                                            处理中...
                                                                        </div>
                                                                    ) : result.status === 'success' ? (
                                                                        <div className={`text-sm ${mode === "classify" ? 'text-yellow-100' : 'text-purple-100'} whitespace-pre-wrap break-words`}>
                                                                            {mode === "classify" ? result.resultForeign : highlightDiff(result.inputForeign, result.resultForeign)}
                                                                        </div>
                                                                    ) : result.status === 'error' ? (
                                                                        <div>
                                                                            <div className="text-sm text-red-400">{result.error || '失败'}</div>
                                                                            {mode === 'voice' && renderVoiceIntegrityIssue(result.voiceIntegrityIssue, setFullDiffIssue)}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-sm text-zinc-600">-</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                            {/* 指令N - 中文/断句列 - 分类模式不显示 */}
                                                            {mode !== "classify" && (
                                                                <div className="bg-zinc-950 flex flex-col" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                                                    {/* 标签行：指令N 中文/断句 + 复制按钮 */}
                                                                    <div className="px-3 py-1 bg-zinc-800/50 flex items-center justify-between border-b border-zinc-700/50">
                                                                        <span className={`text-[10px] ${mode === "voice" ? 'text-cyan-400' : 'text-blue-400'} font-medium`}>
                                                                            指令{idx + 1} {mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文'}
                                                                        </span>
                                                                        {result.status === 'success' && (
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(result.resultChinese); showCopyToast(`已复制指令${idx + 1}${mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文'}`); }}
                                                                                className={`px-1 py-0.5 text-[9px] ${mode === "voice" ? 'text-cyan-400 hover:bg-cyan-900/30' : 'text-blue-400 hover:bg-blue-900/30'} rounded`}
                                                                                title={mode === "voice" ? '复制断句结果' : '复制中文'}
                                                                            >{mode === "voice" ? '断' : '中'}</button>
                                                                        )}
                                                                    </div>
                                                                    {/* 内容行 */}
                                                                    <div className="px-3 py-2 flex-1">
                                                                        {result.status === 'processing' ? (
                                                                            <div className="flex items-center gap-2 text-amber-400 text-sm">
                                                                                <Loader2 size={14} className="animate-spin" />
                                                                                处理中...
                                                                            </div>
                                                                        ) : result.status === 'success' ? (
                                                                            <div className="text-sm text-blue-100 whitespace-pre-wrap break-words">
                                                                                {result.resultChinese}
                                                                                {result.scriptureNote && (
                                                                                    <div className="mt-2 pt-2 border-t border-blue-500/20 text-xs text-blue-300">
                                                                                        {result.scriptureNote}
                                                                                    </div>
                                                                                )}
                                                                            </div>
                                                                        ) : (
                                                                            <div className="text-sm text-zinc-600">-</div>
                                                                        )}
                                                                    </div>
                                                                    {/* 指令操作栏：重试、对话 */}
                                                                    <div className="px-2 py-1 bg-zinc-900/50 border-t border-zinc-700/30 flex items-center gap-1 justify-end">
                                                                        {(result.status === 'error' || result.status === 'success') && (
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); handleRetryInstruction(item.id, idx); }}
                                                                                className="p-1 text-amber-400 hover:bg-amber-900/20 rounded transition-colors tooltip-bottom"
                                                                                data-tip="重试该指令"
                                                                            >
                                                                                <RotateCw size={12} />
                                                                            </button>
                                                                        )}
                                                                        {result.status === 'success' && (
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); toggleInstructionChat(item.id, idx); }}
                                                                                className={`p-1 rounded transition-colors ${result.chatOpen ? 'text-amber-400 bg-amber-900/20' : 'text-zinc-500 hover:text-amber-400'} tooltip-bottom`}
                                                                                data-tip="对话修改"
                                                                            >
                                                                                <MessageSquare size={12} />
                                                                            </button>
                                                                        )}
                                                                    </div>
                                                                    {/* 指令对话面板 */}
                                                                    {result.chatOpen && (
                                                                        <div className="px-2 py-2 bg-zinc-900 border-t border-amber-600/30">
                                                                            {/* 对话历史 */}
                                                                            {result.chatHistory && result.chatHistory.length > 0 && (
                                                                                <div className="max-h-32 overflow-y-auto mb-2 space-y-1">
                                                                                    {result.chatHistory.map(msg => (
                                                                                        <div key={msg.id} className={`text-[10px] px-2 py-1 rounded ${msg.role === 'user' ? 'bg-blue-900/30 text-blue-200' : 'bg-zinc-800 text-zinc-300'}`}>
                                                                                            {msg.text}
                                                                                        </div>
                                                                                    ))}
                                                                                </div>
                                                                            )}
                                                                            {/* 输入框 */}
                                                                            <div className="flex gap-1">
                                                                                <input
                                                                                    type="text"
                                                                                    value={result.chatInput || ''}
                                                                                    onChange={(e) => updateInstructionChatInput(item.id, idx, e.target.value)}
                                                                                    onKeyDown={(e) => { if (e.key === 'Enter') handleInstructionChatSend(item.id, idx); }}
                                                                                    placeholder="输入修改要求..."
                                                                                    className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 focus:outline-none focus:border-amber-500"
                                                                                    onClick={(e) => e.stopPropagation()}
                                                                                />
                                                                                <button
                                                                                    onClick={(e) => { e.stopPropagation(); handleInstructionChatSend(item.id, idx); }}
                                                                                    disabled={result.chatLoading || !result.chatInput?.trim()}
                                                                                    className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[10px] disabled:opacity-50"
                                                                                >
                                                                                    {result.chatLoading ? <Loader2 size={10} className="animate-spin" /> : '发送'}
                                                                                </button>
                                                                            </div>
                                                                        </div>
                                                                    )}
                                                                </div>
                                                            )}
                                                        </React.Fragment>
                                                    ))}

                                                    {/* === 额外列渲染 (resultExtraParts) === */}
                                                    {item.instructionResults?.map((result) => (
                                                        result.resultExtraParts?.map((part, partIdx) => (
                                                            <div key={`${result.id}-extra-${partIdx}`} className="bg-zinc-950 flex flex-col">
                                                                <div className="px-3 py-1 bg-zinc-800/50 flex items-center justify-between border-b border-zinc-700/50">
                                                                    <span className="text-[10px] text-teal-400 font-medium">
                                                                        列{partIdx + 3}
                                                                    </span>
                                                                    {result.status === 'success' && (
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(part); showCopyToast(`已复制列${partIdx + 3}`); }}
                                                                            className="px-1 py-0.5 text-[9px] text-teal-400 hover:bg-teal-900/30 rounded"
                                                                        >{partIdx + 3}</button>
                                                                    )}
                                                                </div>
                                                                <div className="px-3 py-2 flex-1">
                                                                    <div className="text-sm text-teal-100 whitespace-pre-wrap break-words">{part}</div>
                                                                </div>
                                                            </div>
                                                        ))
                                                    ))}

                                                    {/* 如果没有指令结果，显示默认的改写后列 */}
                                                    {(!item.instructionResults || item.instructionResults.length === 0) && (
                                                        <>
                                                            {/* 改写后外文 / 加标签结果 */}
                                                            <div className="bg-zinc-950 p-3" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                                                <div className={`text-[10px] ${mode === "voice" ? 'text-purple-500' : 'text-emerald-500'} mb-1`}>
                                                                    {mode === "voice" ? '加标签结果' : '改写后外文'}
                                                                </div>
                                                                {item.status === 'processing' && (
                                                                    <div className="flex items-center gap-2 text-amber-400 text-sm">
                                                                        <Loader2 size={14} className="animate-spin" />
                                                                        处理中...
                                                                    </div>
                                                                )}
                                                                {item.status === 'success' && (
                                                                    <div className={`text-sm ${mode === "voice" ? 'text-purple-100' : 'text-emerald-100'} whitespace-pre-wrap break-words`}>
                                                                        {showDiff && (mode === 'standard' || mode === 'library') && item.resultForeign
                                                                            ? highlightDiff(item.originalForeign, item.resultForeign)
                                                                            : item.resultForeign
                                                                        }
                                                                    </div>
                                                                )}
                                                                {item.status === 'error' && (
                                                                    <div>
                                                                        <div className="text-sm text-red-400">错误: {item.error}</div>
                                                                        {mode === 'voice' && renderVoiceIntegrityIssue(item.voiceIntegrityIssue, setFullDiffIssue)}
                                                                    </div>
                                                                )}
                                                                {item.status === 'idle' && (
                                                                    <div className="text-sm text-zinc-600 italic">待处理</div>
                                                                )}
                                                            </div>
                                                            {/* 改写后中文 / 断句结果 */}
                                                            <div className="bg-zinc-950 p-3" style={{ maxHeight: '200px', overflowY: 'auto' }}>
                                                                <div className={`text-[10px] ${mode === "voice" ? 'text-cyan-500' : 'text-blue-500'} mb-1`}>
                                                                    {mode === "voice" ? '断句结果' : '改写后中文'}
                                                                </div>
                                                                {item.status === 'success' ? (
                                                                    <div className={`text-sm ${mode === "voice" ? 'text-cyan-100' : 'text-blue-100'} whitespace-pre-wrap break-words`}>
                                                                        {item.resultChinese}
                                                                        {item.scriptureNote && (
                                                                            <div className={`mt-2 pt-2 border-t ${mode === 'voice' ? 'border-cyan-500/20 text-cyan-300' : 'border-blue-500/20 text-blue-300'} text-xs`}>
                                                                                {item.scriptureNote}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <div className="text-sm text-zinc-600 italic">-</div>
                                                                )}
                                                            </div>
                                                        </>
                                                    )}
                                                </div>
                                            </div>
                                        )}
                                        {/* 单条复制按钮栏 */}
                                        {item.instructionResults && item.instructionResults.length > 0 && (
                                            <div className="px-3 py-1.5 bg-zinc-900/50 border-t border-zinc-800 flex items-center gap-2 flex-wrap">
                                                <span className="text-[10px] text-zinc-500">本条复制：</span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const results = item.instructionResults!;
                                                        const col1Name = mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文';
                                                        const headers = results.map((_, i) => `指令${i + 1}${col1Name}`);
                                                        const values = results.map(r => r.status === 'success' ? escapeForSheet(r.resultForeign) : '');
                                                        navigator.clipboard.writeText(`${headers.join('\t')}\n${values.join('\t')}`);
                                                        showCopyToast(mode === "voice" ? '已复制加标签' : '已复制外文');
                                                    }}
                                                    className="px-1.5 py-0.5 bg-purple-900/30 hover:bg-purple-800/40 text-purple-300 text-[10px] rounded"
                                                >
                                                    {mode === "voice" ? '只标签' : '只外文'}
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const results = item.instructionResults!;
                                                        const col2Name = mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文';
                                                        const headers = results.map((_, i) => `指令${i + 1}${col2Name}`);
                                                        const values = results.map(r => r.status === 'success' ? escapeForSheet(r.resultChinese) : '');
                                                        navigator.clipboard.writeText(`${headers.join('\t')}\n${values.join('\t')}`);
                                                        showCopyToast(mode === "voice" ? '已复制断句' : '已复制中文');
                                                    }}
                                                    className={`px-1.5 py-0.5 ${mode === "voice" ? 'bg-cyan-900/30 hover:bg-cyan-800/40 text-cyan-300' : 'bg-blue-900/30 hover:bg-blue-800/40 text-blue-300'} text-[10px] rounded`}
                                                >
                                                    {mode === "voice" ? '只断句' : '只中文'}
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const results = item.instructionResults!;
                                                        const col1Name = mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文';
                                                        const col2Name = mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文';
                                                        const headers = results.flatMap((_, i) => [`指令${i + 1}${col1Name}`, `指令${i + 1}${col2Name}`]);
                                                        const values = results.flatMap(r => r.status === 'success' ? [escapeForSheet(r.resultForeign), escapeForSheet(r.resultChinese)] : ['', '']);
                                                        navigator.clipboard.writeText(`${headers.join('\t')}\n${values.join('\t')}`);
                                                        showCopyToast(mode === "voice" ? '已复制标签+断句' : '已复制外文+中文');
                                                    }}
                                                    className="px-1.5 py-0.5 bg-emerald-900/30 hover:bg-emerald-800/40 text-emerald-300 text-[10px] rounded"
                                                >
                                                    {mode === "voice" ? '标签+断句' : '外文+中文'}
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const results = item.instructionResults!;
                                                        const col1Name = mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文';
                                                        const col2Name = mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文';
                                                        const headers = [mode === "voice" ? '原文' : '原始外文', mode === "voice" ? '原中文' : '原始中文', ...results.flatMap((_, i) => [`指令${i + 1}${col1Name}`, `指令${i + 1}${col2Name}`])];
                                                        const values = [escapeForSheet(item.originalForeign), escapeForSheet(item.originalChinese || ''), ...results.flatMap(r => r.status === 'success' ? [escapeForSheet(r.resultForeign), escapeForSheet(r.resultChinese)] : ['', ''])];
                                                        navigator.clipboard.writeText(`${headers.join('\t')}\n${values.join('\t')}`);
                                                        showCopyToast('已复制完整内容(含表头)');
                                                    }}
                                                    className="px-1.5 py-0.5 bg-amber-900/30 hover:bg-amber-800/40 text-amber-300 text-[10px] rounded"
                                                >
                                                    完整
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* 操作栏 */}
                                <div className="px-3 py-1.5 bg-zinc-900 border-t border-zinc-800 flex items-center gap-2 flex-wrap">
                                    {/* 操作按钮 */}
                                    <div className="flex items-center gap-1">
                                        {/* 设置按钮（点击展开单条设置面板） */}
                                        <button
                                            onClick={() => toggleItemSettings(item.id)}
                                            className={`p-1.5 rounded transition-colors ${item.showSettings
                                                ? 'text-purple-400 bg-purple-500/10'
                                                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                                                } tooltip-bottom`}
                                            data-tip="单条设置"
                                        >
                                            <Settings2 size={14} />
                                        </button>

                                        {/* 单条处理 (idle状态) */}
                                        {item.status === 'idle' && (
                                            <button
                                                onClick={() => handleProcessSingleItem(item)}
                                                className="p-1.5 text-purple-400 hover:bg-purple-900/20 rounded transition-colors tooltip-bottom"
                                                data-tip="单条处理"
                                            >
                                                <Play size={14} />
                                            </button>
                                        )}

                                        {/* 重试 (success/error状态) */}
                                        {(item.status === 'success' || item.status === 'error') && (
                                            <button
                                                onClick={() => handleProcessSingleItem(item)}
                                                className={`p-1.5 rounded transition-colors tooltip-bottom ${mode === 'library'
                                                    ? 'text-green-400 hover:bg-green-900/20'
                                                    : 'text-amber-400 hover:bg-amber-900/20'
                                                    }`}
                                                data-tip={mode === 'library' ? '重新匹配' : '重试'}
                                            >
                                                <RotateCw size={14} />
                                            </button>
                                        )}

                                        {/* 删除 */}
                                        <button
                                            onClick={() => handleDeleteItem(item.id)}
                                            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors tooltip-bottom"
                                            data-tip="删除"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>

                                    {/* 状态提示 */}
                                    <div className="flex-1 text-right">
                                        {item.customInstruction && (
                                            <span className="text-[10px] text-purple-400">使用单条指令</span>
                                        )}
                                    </div>
                                </div>

                                {/* 单条设置面板 */}
                                {item.showSettings && (
                                    <div className="px-3 py-2 bg-purple-900/10 border-t border-purple-500/10 text-xs">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex flex-col gap-1">
                                                <label className="text-zinc-400 font-medium">自定义改写指令 (留空则使用全局设置)</label>
                                                <textarea
                                                    className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-200 focus:border-purple-500 focus:outline-none resize-none h-16"
                                                    value={item.customInstruction || ''}
                                                    onChange={(e) => updateItemSettings(item.id, { customInstruction: e.target.value })}
                                                    placeholder={`全局指令: ${instruction || '(空)'}`}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* 对话区域 */}
                                {item.chatOpen && (
                                    <div className="px-3 py-3 bg-zinc-900/50 border-t border-zinc-800">
                                        {/* 对话历史 */}
                                        <div className="mb-2 max-h-48 overflow-y-auto space-y-2">
                                            {(item.chatHistory?.length || 0) === 0 ? (
                                                <div className="text-xs text-zinc-500 italic text-center py-2">
                                                    开始对话，继续优化此条文案
                                                </div>
                                            ) : (
                                                item.chatHistory?.map(msg => (
                                                    <div
                                                        key={msg.id}
                                                        className={`p-2 rounded text-xs ${msg.role === 'user'
                                                            ? 'bg-blue-900/20 text-blue-200 ml-8'
                                                            : 'bg-zinc-800 text-zinc-200 mr-8'
                                                            }`}
                                                    >
                                                        {msg.text}
                                                    </div>
                                                ))
                                            )}
                                            {item.chatLoading && (
                                                <div className="flex items-center gap-2 text-amber-400 text-xs p-2 bg-zinc-800 rounded mr-8">
                                                    <Loader2 size={12} className="animate-spin" />
                                                    思考中...
                                                </div>
                                            )}
                                        </div>

                                        {/* 对话输入 */}
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={item.chatInput || ''}
                                                onChange={(e) => updateItemSettings(item.id, { chatInput: e.target.value })}
                                                placeholder="输入修改要求，按回车发送..."
                                                className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        handleChatSend(item);
                                                    }
                                                }}
                                                disabled={item.chatLoading}
                                            />
                                            <button
                                                onClick={() => handleChatSend(item)}
                                                disabled={!item.chatInput?.trim() || item.chatLoading}
                                                className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm disabled:opacity-50"
                                            >
                                                发送
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )
            }

            {/* 空状态 */}
            {
                items.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 border-2 border-dashed border-zinc-800 rounded-xl bg-zinc-900/30 min-h-[300px]">
                        <FileText size={48} className="mb-4 opacity-20" />
                        <p className="text-sm">添加文案开始批量改写</p>
                        <p className="text-xs text-zinc-700 mt-2">支持从表格复制粘贴（外文 + 中文参照两列）</p>
                    </div>
                )
            }

            {/* === 预览指令弹框 === */}
            {
                showPreview && (
                    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowPreview(false)}>
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                            <div className="flex items-center justify-between p-4 border-b border-zinc-800">
                                <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                    <Eye size={20} className={mode === "voice" ? "text-purple-400" : mode === "classify" ? "text-cyan-400" : mode === 'cleaner' ? 'text-lime-400' : "text-purple-400"} />
                                    {mode === "voice" ? '🎙️ 人声文案模式 - 指令预览' : mode === "classify" ? '🏷️ 分类模式 - 指令预览' : mode === 'cleaner' ? '🧹 文案清理模式 - 指令预览' : mode === 'prayer' ? '🙏 祷告提炼改写 - 指令预览' : mode === 'freeform' ? '✨ 无文案模式 - 指令预览' : mode === 'split' ? '🔀 拆分模式 - 指令预览' : '最终指令预览'}
                                </h3>
                                <button onClick={() => setShowPreview(false)} className="text-zinc-500 hover:text-white">
                                    <X size={20} />
                                </button>
                            </div>
                            <div className="p-4 overflow-y-auto bg-zinc-950/50 space-y-4">
                                <p className="text-xs text-zinc-500">
                                    {mode === "voice"
                                        ? '以下是人声文案模式的 Prompt 结构（专为 ElevenLabs 配音优化）：'
                                        : mode === "classify"
                                            ? (classifySubMode === 'wordcount' ? '以下是字数分类模式的配置（纯本地，不调用AI）：' : classifySubMode === 'advanced' ? '以下是高级分类模式的 Prompt 结构（AI 一次输出多列分类结果）：' : '以下是常规分类模式的 Prompt 结构（只输出分类结果，无需翻译）：')
                                            : mode === 'social-media'
                                                ? '以下是自媒体改写模式的 Prompt 结构（信仰短视频口播稿改写）：'
                                                : mode === 'cleaner'
                                                    ? '以下是文案清理模式的完整指令结构（自动清除AI标签/水印，输出4列结果）：'
                                                    : mode === 'prayer'
                                                        ? '以下是祷告词提炼改写模式的完整指令结构（三段式英中双语文案）：'
                                                        : mode === 'freeform'
                                                            ? '以下是无文案模式实际发送给 AI 的指令结构（无需原文，纯指令生成）：'
                                                            : mode === 'split'
                                                                ? '以下是拆分模式实际发送给 AI 的指令结构（按列定义拆分文案）：'
                                                                : '以下是发送给 AI 的完整 Prompt 结构（如果修改结果不满意可以修改这里的指令）：'
                                    }
                                </p>

                                {/* 分类模式专用预览 */}
                                {mode === "classify" && classifySubMode === 'advanced' ? (
                                    <>
                                        {/* 动态生成的系统指令（只读） */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-cyan-900/30">
                                            <div className="text-cyan-400 font-medium mb-2 text-sm flex items-center gap-2">
                                                🤖 AI 系统指令（自动生成）
                                                <span className="text-zinc-500 text-xs font-normal">根据下方分类维度动态构建</span>
                                            </div>
                                            <pre className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-300 whitespace-pre-wrap max-h-48 overflow-y-auto">
                                                {buildClassifyPromptInstructions().promptBlock || '（无 AI 列，不会调用 AI）'}
                                            </pre>
                                        </div>

                                        {/* 分类维度列表 */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-yellow-900/30">
                                            <div className="text-yellow-400 font-medium mb-2 text-sm flex items-center gap-2">
                                                📊 分类维度配置
                                                <span className="text-zinc-500 text-xs font-normal">
                                                    （{classifyColumns.filter(c => c.enabled).length}/{classifyColumns.length} 启用）
                                                </span>
                                            </div>
                                            <div className="space-y-2">
                                                {classifyColumns.map((col, idx) => (
                                                    <div key={col.id} className={`flex items-start gap-2 p-2 rounded border ${col.enabled ? 'border-zinc-700 bg-zinc-900/50' : 'border-zinc-800 bg-zinc-900/20 opacity-40'}`}>
                                                        <span className="text-[10px] text-cyan-400 font-bold w-4 mt-0.5 shrink-0">{idx + 1}.</span>
                                                        <div className="flex-1 min-w-0">
                                                            <div className="flex items-center gap-2 mb-1">
                                                                <span className="text-xs font-medium text-zinc-200">{col.name || '（未命名）'}</span>
                                                                <span className={`px-1.5 py-0 text-[9px] rounded-full border ${col.type === 'ai-with-options' ? 'text-cyan-400 border-cyan-800 bg-cyan-900/20' :
                                                                    col.type === 'ai-free' ? 'text-amber-400 border-amber-800 bg-amber-900/20' :
                                                                        'text-sky-400 border-sky-800 bg-sky-900/20'
                                                                    }`}>
                                                                    {col.type === 'ai-with-options' ? 'AI选项' : col.type === 'ai-free' ? 'AI自由' : '本地字数'}
                                                                </span>
                                                                {!col.enabled && <span className="text-[9px] text-red-400/60">已禁用</span>}
                                                            </div>
                                                            <div className="text-[11px] text-zinc-400">{col.description}</div>
                                                            {col.type === 'ai-with-options' && col.options && (
                                                                <div className="text-[10px] text-amber-300/70 mt-1">可选项：{col.options}</div>
                                                            )}
                                                            {col.type === 'local-wordcount' && col.wordCountRanges && (
                                                                <div className="text-[10px] text-sky-300/70 mt-1">区间：{col.wordCountRanges}</div>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        </div>

                                        {/* 输出格式 */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-zinc-800 opacity-60">
                                            <div className="text-zinc-500 font-medium mb-2 text-sm flex items-center gap-2">
                                                🔒 输出格式（自动生成）
                                            </div>
                                            <div className="text-zinc-600 text-xs font-mono">
                                                {(() => {
                                                    const aiCols = classifyColumns.filter(c => c.enabled && c.type !== 'local-wordcount');
                                                    const localCols = classifyColumns.filter(c => c.enabled && c.type === 'local-wordcount');
                                                    return (
                                                        <>
                                                            {aiCols.length > 0 && <div>AI输出：{aiCols.map(c => c.name).join('|||')}</div>}
                                                            {localCols.length > 0 && <div>本地计算：{localCols.map(c => c.name).join('、')}</div>}
                                                        </>
                                                    );
                                                })()}
                                            </div>
                                        </div>

                                        {/* 额外用户指令（可选） */}
                                        {instructions.some(i => i.trim()) && (
                                            <div className="bg-black/30 p-4 rounded-lg border border-emerald-900/30">
                                                <div className="text-emerald-400 font-medium mb-2 text-sm">
                                                    📝 额外要求
                                                </div>
                                                {instructions.filter(i => i.trim()).map((inst, idx) => (
                                                    <div key={idx} className="text-xs text-zinc-300 bg-zinc-900 rounded px-2 py-1 mb-1">{inst}</div>
                                                ))}
                                            </div>
                                        )}
                                    </>
                                ) : mode === 'cleaner' ? (
                                    <>
                                        {/* 清理模式：显示完整构建的清理指令 */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-lime-900/30">
                                            <div className="text-lime-400 font-medium mb-2 text-sm flex items-center gap-2">
                                                🧹 文案清理系统指令
                                                <span className="text-zinc-500 text-xs font-normal">（自动构建，只读）</span>
                                            </div>
                                            <pre className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-300 whitespace-pre-wrap max-h-64 overflow-y-auto">
                                                {(() => {
                                                    const cleanerBase = BUILTIN_PRESETS.find((p: CopywritingPreset) => p.id === 'builtin_ai_label_cleaner')?.instruction || '';
                                                    const cleanerCore = cleanerBase.replace(/## 三、输出[\s\S]*$/, '').trim();
                                                    return cleanerCore + '\n\n## 三、输出格式\n\n对每条文案，按以下格式输出，用 ||| 分隔四部分：\n\n清理后的原文|||英文翻译|||中文翻译|||删除内容说明\n\n- 清理后原文：保持原始语言，只去掉杂质\n- 英文翻译：将清理后原文翻译为地道英文\n- 中文翻译：将清理后原文翻译为自然中文\n- 删除内容说明：列出被删除的杂质及其中文翻译';
                                                })()}
                                            </pre>
                                        </div>

                                        {/* 补充指令 */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-emerald-900/30">
                                            <div className="text-emerald-400 font-medium mb-2 text-sm flex items-center gap-2">
                                                📝 补充清理要求
                                                <span className="text-zinc-500 text-xs font-normal">（可选，在下方面板编辑）</span>
                                            </div>
                                            <pre className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-300 whitespace-pre-wrap min-h-[40px]">
                                                {instruction.trim() || '（无补充要求）'}
                                            </pre>
                                        </div>

                                        {/* 输出格式说明 */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-zinc-800 opacity-60">
                                            <div className="text-zinc-500 font-medium mb-2 text-sm">📤 输出格式</div>
                                            <div className="text-xs text-zinc-400 space-y-1">
                                                <p>列1: <span className="text-lime-300">清理后原文</span>（保持原始语言）</p>
                                                <p>列2: <span className="text-blue-300">英文翻译</span></p>
                                                <p>列3: <span className="text-amber-300">中文翻译</span></p>
                                                <p>列4: <span className="text-red-300">删除说明</span>（[已删除] 原文杂质 → 中文含义）</p>
                                            </div>
                                        </div>
                                    </>
                                ) : mode === 'freeform' ? (
                                    /* 无文案模式专用预览 */
                                    <>
                                        {/* 系统指令（固定，只读） */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-rose-900/30">
                                            <div className="text-rose-400 font-medium mb-2 text-sm flex items-center gap-2">
                                                ✨ 无文案模式系统指令
                                                <span className="text-zinc-500 text-xs font-normal">（固定，只读）</span>
                                            </div>
                                            <pre className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-300 whitespace-pre-wrap">
{"你是一个专业的文案创作助手。\n\n【输出规则】\n1. 只输出最终文案，不要任何解释\n2. 输出格式：外文文案|||中文文案\n3. 使用 ||| 作为分隔符"}
                                            </pre>
                                        </div>

                                        {/* 用户指令 */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-emerald-900/30">
                                            <div className="text-emerald-400 font-medium mb-2 text-sm flex items-center gap-2">
                                                🎯 生成指令
                                                <span className="text-zinc-500 text-xs font-normal">（{instructions.filter(i => i.trim()).length}条指令）</span>
                                            </div>
                                            <div className="space-y-2 max-h-60 overflow-y-auto overflow-x-hidden">
                                                {instructions.map((inst, idx) => (
                                                    <div key={idx} className="flex items-start gap-2">
                                                        <span className="text-[10px] text-emerald-400 w-4 mt-2">{idx + 1}.</span>
                                                        <textarea
                                                            value={inst}
                                                            onChange={(e) => updateInstruction(idx, e.target.value)}
                                                            placeholder="输入生成指令..."
                                                            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 placeholder-zinc-600 resize-none min-h-[60px]"
                                                            rows={2}
                                                        />
                                                        {instructions.length > 1 && (
                                                            <button onClick={() => removeInstruction(idx)} className="text-zinc-500 hover:text-red-400 mt-2">
                                                                <X size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                                <button
                                                    onClick={addInstruction}
                                                    className="flex items-center gap-1 px-2 py-1 text-xs text-emerald-400 hover:bg-emerald-900/20 border-emerald-900/30 rounded border"
                                                >
                                                    <Plus size={12} /> 添加指令
                                                </button>
                                            </div>
                                        </div>

                                        {/* 输出格式 */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-zinc-800 opacity-60">
                                            <div className="text-zinc-500 font-medium mb-2 text-sm flex items-center gap-2">
                                                🔒 输出格式（固定，不可修改）
                                            </div>
                                            <div className="text-zinc-600 text-xs font-mono">
                                                外文文案|||中文文案
                                            </div>
                                            <p className="text-[10px] text-zinc-500 mt-2">
                                                无需输入原文，AI 根据指令直接生成外文和中文文案。
                                            </p>
                                        </div>
                                    </>
                                ) : mode === 'split' ? (
                                    /* 拆分模式专用预览 */
                                    <>
                                        {/* 拆分模式系统指令（可编辑） */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-orange-900/30">
                                            <div className="text-orange-400 font-medium mb-2 text-sm flex items-center gap-2">
                                                🔀 拆分模式系统指令
                                                <span className="text-zinc-500 text-xs font-normal">（可直接编辑）</span>
                                                <button
                                                    onClick={() => setSplitModeSystemInstruction(SPLIT_MODE_SYSTEM_INSTRUCTION)}
                                                    className="text-[10px] text-orange-400/60 hover:text-orange-400 px-1.5 py-0.5 rounded bg-orange-900/20 hover:bg-orange-900/40 transition-colors"
                                                >
                                                    重置默认
                                                </button>
                                            </div>
                                            <textarea
                                                value={splitModeSystemInstruction}
                                                onChange={(e) => setSplitModeSystemInstruction(e.target.value)}
                                                placeholder={SPLIT_MODE_SYSTEM_INSTRUCTION}
                                                className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-orange-500 resize-none h-48 placeholder-zinc-600"
                                            />
                                        </div>

                                        {/* 动态构建的列定义 */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-yellow-900/30">
                                            <div className="text-yellow-400 font-medium mb-2 text-sm flex items-center gap-2">
                                                📊 拆分列定义
                                                <span className="text-zinc-500 text-xs font-normal">（自动構建，在左侧面板编辑）</span>
                                            </div>
                                            <pre className="w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-300 whitespace-pre-wrap">
{splitColumns.length > 0
    ? splitColumns.map((col, idx) => `第${idx + 1}列【${col.name}】：${col.description || '无特殊要求'}`).join('\n')
    : '（未定义拆分列）'}
                                            </pre>
                                        </div>

                                        {/* 输出格式 */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-zinc-800 opacity-60">
                                            <div className="text-zinc-500 font-medium mb-2 text-sm">🔒 输出格式（固定）</div>
                                            <div className="text-zinc-600 text-xs font-mono">
                                                {splitColumns.length > 0
                                                    ? splitColumns.map(c => c.name).join('|||')
                                                    : '第1列|||第2列|||第3列'}
                                            </div>
                                            <p className="text-[10px] text-zinc-500 mt-2">
                                                按 ||| 分隔输出 {splitColumns.length} 列结果。
                                            </p>
                                        </div>
                                    </>
                                ) : (
                                    <>
                                        {/* 系统指令 - 可编辑 */}
                                        <div className={`bg-black/30 p-4 rounded-lg border ${mode === "voice" ? 'border-purple-900/30' : mode === "classify" ? 'border-cyan-900/30' : mode === 'social-media' ? 'border-teal-900/30' : 'border-blue-900/30'}`}>
                                            <div className={`${mode === "voice" ? 'text-purple-400' : mode === "classify" ? 'text-cyan-400' : mode === 'social-media' ? 'text-teal-400' : mode === 'prayer' ? 'text-sky-400' : 'text-blue-400'} font-medium mb-2 text-sm flex items-center gap-2`}>
                                                {mode === "voice" ? '🎙️ 人声文案系统指令' : mode === "classify" ? '🏷️ 分类模式系统指令' : mode === 'social-media' ? '📱 自媒体改写系统指令' : mode === 'prayer' ? '🙏 祷告提炼改写系统指令' : '📝 系统固定默认指令'}
                                                <span className="text-zinc-500 text-xs font-normal">（可直接编辑）</span>
                                                {mode === "voice" && (
                                                    <button
                                                        onClick={() => setVoiceModeSystemInstruction(VOICE_MODE_SYSTEM_INSTRUCTION)}
                                                        className="text-[10px] text-purple-400/60 hover:text-purple-400 px-1.5 py-0.5 rounded bg-purple-900/20 hover:bg-purple-900/40 transition-colors"
                                                    >
                                                        重置默认
                                                    </button>
                                                )}
                                                {mode === "classify" && (
                                                    <button
                                                        onClick={() => setClassifyModeSystemInstruction(CLASSIFY_MODE_SYSTEM_INSTRUCTION)}
                                                        className="text-[10px] text-cyan-400/60 hover:text-cyan-400 px-1.5 py-0.5 rounded bg-cyan-900/20 hover:bg-cyan-900/40 transition-colors"
                                                    >
                                                        重置默认
                                                    </button>
                                                )}
                                                {mode === 'social-media' && (
                                                    <button
                                                        onClick={() => setSocialMediaModeSystemInstruction(SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION)}
                                                        className="text-[10px] text-teal-400/60 hover:text-teal-400 px-1.5 py-0.5 rounded bg-teal-900/20 hover:bg-teal-900/40 transition-colors"
                                                    >
                                                        重置默认
                                                    </button>
                                                )}
                                            </div>
                                            <textarea
                                                value={mode === "voice" ? voiceModeSystemInstruction : mode === "classify" ? classifyModeSystemInstruction : mode === 'social-media' ? socialMediaModeSystemInstruction : mode === 'prayer' ? PRAYER_MODE_SYSTEM_INSTRUCTION : systemInstruction}
                                                onChange={(e) => {
                                                    if (mode === "voice") {
                                                        setVoiceModeSystemInstruction(e.target.value);
                                                    } else if (mode === "classify") {
                                                        setClassifyModeSystemInstruction(e.target.value);
                                                    } else if (mode === 'social-media') {
                                                        setSocialMediaModeSystemInstruction(e.target.value);
                                                    } else {
                                                        setSystemInstruction(e.target.value);
                                                    }
                                                }}
                                                placeholder={mode === "voice" ? VOICE_MODE_SYSTEM_INSTRUCTION : mode === "classify" ? CLASSIFY_MODE_SYSTEM_INSTRUCTION : mode === 'social-media' ? SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION : DEFAULT_SYSTEM_INSTRUCTION}
                                                className={`w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-300 focus:outline-none resize-none h-48 placeholder-zinc-600 ${mode === "voice" ? 'focus:border-purple-500' : mode === "classify" ? 'focus:border-cyan-500' : mode === 'social-media' ? 'focus:border-teal-500' : 'focus:border-blue-500'}`}
                                            />
                                        </div>

                                        {/* 用户指令列表 - 可编辑 */}
                                        <div className={`bg-black/30 p-4 rounded-lg border ${mode === "voice" ? 'border-cyan-900/30' : mode === "classify" ? 'border-yellow-900/30' : 'border-emerald-900/30'}`}>
                                            <div className={`${mode === "voice" ? 'text-cyan-400' : mode === "classify" ? 'text-yellow-400' : 'text-emerald-400'} font-medium mb-2 text-sm flex items-center gap-2`}>
                                                {mode === "classify" ? '🏷️ 分类规则' : '🎯 用户指令列表'}
                                                <span className="text-zinc-500 text-xs font-normal">（{instructions.filter(i => i.trim()).length}条指令，独立执行）</span>
                                            </div>
                                            <div className="space-y-2 max-h-60 overflow-y-auto overflow-x-hidden">
                                                {instructions.map((inst, idx) => (
                                                    <div key={idx} className="flex items-start gap-2">
                                                        <span className={`text-[10px] ${mode === "voice" ? 'text-cyan-400' : mode === "classify" ? 'text-yellow-400' : 'text-emerald-400'} w-4 mt-2`}>{idx + 1}.</span>
                                                        <textarea
                                                            value={inst}
                                                            onChange={(e) => updateInstruction(idx, e.target.value)}
                                                            placeholder={mode === "classify" ? "输入分类规则..." : "输入改写指令..."}
                                                            className={`flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none placeholder-zinc-600 resize-none min-h-[60px] ${mode === "voice" ? 'focus:border-cyan-500' : mode === "classify" ? 'focus:border-yellow-500' : 'focus:border-emerald-500'}`}
                                                            rows={2}
                                                        />
                                                        {instructions.length > 1 && (
                                                            <button onClick={() => removeInstruction(idx)} className="text-zinc-500 hover:text-red-400 mt-2">
                                                                <X size={14} />
                                                            </button>
                                                        )}
                                                    </div>
                                                ))}
                                                <button
                                                    onClick={addInstruction}
                                                    className={`flex items-center gap-1 px-2 py-1 text-xs ${mode === "voice" ? 'text-cyan-400 hover:bg-cyan-900/20 border-cyan-900/30' : mode === "classify" ? 'text-yellow-400 hover:bg-yellow-900/20 border-yellow-900/30' : 'text-emerald-400 hover:bg-emerald-900/20 border-emerald-900/30'} rounded border`}
                                                >
                                                    <Plus size={12} /> 添加指令
                                                </button>
                                            </div>
                                        </div>

                                        {/* 输出格式 - 锁定 */}
                                        <div className="bg-black/30 p-4 rounded-lg border border-zinc-800 opacity-60">
                                            <div className="text-zinc-500 font-medium mb-2 text-sm flex items-center gap-2">
                                                🔒 输出格式（固定，不可修改）
                                            </div>
                                            <div className="text-zinc-600 text-xs font-mono">
                                                {mode === "voice"
                                                    ? '加标签结果|||断句结果'
                                                    : mode === "classify"
                                                        ? '分类结果（仅输出分类名称，无需翻译）'
                                                        : '改写后的外文|||中文翻译'
                                                }
                                            </div>
                                            {mode === "voice" && (
                                                <p className="text-[10px] text-zinc-500 mt-2">
                                                    第一列：带情感标签的文案（用于 ElevenLabs）<br />
                                                    第二列：合理断行的纯文本（用于字幕显示）
                                                </p>
                                            )}
                                            {mode === "classify" && (
                                                <p className="text-[10px] text-zinc-500 mt-2">
                                                    AI 将根据您的分类规则，只输出分类结果。<br />
                                                    适合大批量数据分类，比如小组名称归类、内容审核等。
                                                </p>
                                            )}
                                        </div>
                                    </>
                                )}
                            </div>
                            <div className="p-4 border-t border-zinc-800 flex justify-end gap-2">
                                <button
                                    onClick={() => setShowPreview(false)}
                                    className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm transition-colors"
                                >
                                    关闭
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* 双击编辑指令弹框 */}
            {
                editingInstructionIndex !== null && (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl mx-4 shadow-2xl">
                            <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                                <div className="text-amber-400 font-medium flex items-center gap-2">
                                    ✏️ 编辑指令 {editingInstructionIndex + 1}
                                </div>
                                <button
                                    onClick={() => setEditingInstructionIndex(null)}
                                    className="text-zinc-500 hover:text-zinc-300"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="p-4">
                                <textarea
                                    value={instructions[editingInstructionIndex] || ''}
                                    onChange={(e) => updateInstruction(editingInstructionIndex, e.target.value)}
                                    placeholder="在此输入完整的改写指令..."
                                    className="w-full h-48 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 placeholder-zinc-600 resize-none"
                                    autoFocus
                                />
                                <div className="mt-3 text-[10px] text-zinc-500">
                                    提示：在这里可以完整查看和编辑指令内容。关闭弹框后自动保存。
                                </div>
                            </div>
                            <div className="p-4 border-t border-zinc-800 flex justify-between">
                                {/* 预设快速填充 */}
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] text-zinc-500">快速填充：</span>
                                    {BUILTIN_PRESETS.slice(0, 4).map(preset => (
                                        <button
                                            key={preset.id}
                                            onClick={() => updateInstruction(editingInstructionIndex, preset.instruction)}
                                            className="px-2 py-1 bg-zinc-800 hover:bg-amber-900/30 text-[10px] text-amber-300 rounded border border-zinc-700"
                                        >
                                            {preset.name}
                                        </button>
                                    ))}
                                </div>
                                <button
                                    onClick={() => setEditingInstructionIndex(null)}
                                    className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium"
                                >
                                    确定
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* 自媒体模式双击编辑弹窗 */}
            {editingSocialMediaField !== null && (() => {
                const isSystemInstruction = editingSocialMediaField.type === 'systemInstruction';
                const editingSection = editingSocialMediaField.sectionId
                    ? socialMediaOutputSections.find(s => s.id === editingSocialMediaField.sectionId)
                    : null;
                return (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-3xl mx-4 shadow-2xl flex flex-col max-h-[85vh]">
                            <div className="p-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
                                <div className="text-teal-400 font-medium flex items-center gap-2">
                                    ✏️ {isSystemInstruction ? '编辑自媒体系统指令' : `编辑分项描述 - ${editingSection?.name || ''}`}
                                </div>
                                <button
                                    onClick={() => setEditingSocialMediaField(null)}
                                    className="text-zinc-500 hover:text-zinc-300"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="p-4 flex-1 overflow-auto">
                                <textarea
                                    value={isSystemInstruction ? socialMediaModeSystemInstruction : (editingSection?.description || '')}
                                    onChange={(e) => {
                                        if (isSystemInstruction) {
                                            setSocialMediaModeSystemInstruction(e.target.value);
                                        } else if (editingSocialMediaField.sectionId) {
                                            setSocialMediaOutputSections(prev => prev.map(s =>
                                                s.id === editingSocialMediaField.sectionId ? { ...s, description: e.target.value } : s
                                            ));
                                        }
                                    }}
                                    placeholder={isSystemInstruction ? '输入系统指令...' : '描述这个分项的输出要求...'}
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-teal-500 placeholder-zinc-600 resize-none leading-relaxed"
                                    style={{ minHeight: isSystemInstruction ? '400px' : '200px' }}
                                    autoFocus
                                />
                                <div className="mt-3 text-[10px] text-zinc-500">
                                    {isSystemInstruction ? '提示：这是发送给 AI 的系统指令，定义了改写风格和规则。' : '提示：描述 AI 在这个分项中应该输出什么内容。'}
                                </div>
                            </div>
                            <div className="p-4 border-t border-zinc-800 flex justify-between shrink-0">
                                {isSystemInstruction && (
                                    <button
                                        onClick={() => setSocialMediaModeSystemInstruction(SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION)}
                                        className="px-3 py-1.5 text-xs text-zinc-500 hover:text-teal-400 rounded border border-zinc-700 hover:border-teal-700 transition-colors"
                                    >
                                        重置默认
                                    </button>
                                )}
                                {!isSystemInstruction && <div />}
                                <button
                                    onClick={() => setEditingSocialMediaField(null)}
                                    className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium"
                                >
                                    确定
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 库模式双击编辑弹窗 */}
            {editingLibField !== null && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl mx-4 shadow-2xl">
                        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                            <div className="text-green-400 font-medium flex items-center gap-2">
                                ✏️ {editingLibField.type === 'matchRule'
                                    ? `编辑库使用指令 - ${libraries.find(l => l.id === (editingLibField as any).libId)?.name || ''}`
                                    : `编辑额外指令 ${(editingLibField as any).idx + 1}`}
                            </div>
                            <button
                                onClick={() => setEditingLibField(null)}
                                className="text-zinc-500 hover:text-zinc-300"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-4">
                            <textarea
                                value={
                                    editingLibField.type === 'matchRule'
                                        ? libraries.find(l => l.id === (editingLibField as any).libId)?.matchRule || ''
                                        : libraryExtraInstructions[(editingLibField as any).idx] || ''
                                }
                                onChange={(e) => {
                                    if (editingLibField.type === 'matchRule') {
                                        const libId = (editingLibField as any).libId;
                                        setLibraries(prev => prev.map(l => l.id === libId ? { ...l, matchRule: e.target.value } : l));
                                    } else {
                                        const idx = (editingLibField as any).idx;
                                        setLibraryExtraInstructions(prev => {
                                            const next = [...prev];
                                            next[idx] = e.target.value;
                                            return next;
                                        });
                                    }
                                }}
                                placeholder="在此输入完整的指令..."
                                className="w-full h-48 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-green-500 placeholder-zinc-600 resize-none"
                                autoFocus
                            />
                            <div className="mt-3 text-[10px] text-zinc-500">
                                提示：在这里可以完整查看和编辑指令内容。关闭弹框后自动保存。
                            </div>
                        </div>
                        <div className="p-4 border-t border-zinc-800 flex justify-between">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] text-zinc-500">快速填充：</span>
                                {BUILTIN_PRESETS.slice(0, 4).map(preset => (
                                    <button
                                        key={preset.id}
                                        onClick={() => {
                                            if (editingLibField!.type === 'matchRule') {
                                                const libId = (editingLibField as any).libId;
                                                setLibraries(prev => prev.map(l => l.id === libId ? { ...l, matchRule: preset.instruction } : l));
                                            } else {
                                                const idx = (editingLibField as any).idx;
                                                setLibraryExtraInstructions(prev => {
                                                    const next = [...prev];
                                                    next[idx] = preset.instruction;
                                                    return next;
                                                });
                                            }
                                        }}
                                        className="px-2 py-1 bg-zinc-800 hover:bg-green-900/30 text-[10px] text-green-300 rounded border border-zinc-700"
                                    >
                                        {preset.name}
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={() => setEditingLibField(null)}
                                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium"
                            >
                                确定
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 文案库编辑器弹框 */}
            {showLibraryEditor && (() => {
                let activeLib = libraries.find(l => l.id === activeLibraryId);
                if (!activeLib && libraries.length > 0) {
                    activeLib = libraries[0];
                    setActiveLibraryId(libraries[0].id);
                }
                if (!activeLib) {
                    // 库为空时显示空状态界面，允许用户新建库或添加预设
                    return (
                        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                            <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg mx-4 shadow-2xl p-6">
                                <div className="flex items-center justify-between mb-4">
                                    <div className="text-green-400 font-medium flex items-center gap-2">
                                        📚 编辑文案库
                                    </div>
                                    <button
                                        onClick={() => setShowLibraryEditor(false)}
                                        className="text-zinc-500 hover:text-zinc-300"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                                <div className="text-center py-8 space-y-4">
                                    <div className="text-zinc-500 text-sm">还没有文案库</div>
                                    <div className="flex flex-col items-center gap-3">
                                        <button
                                            onClick={() => {
                                                const newLib: CopywritingLibrary = {
                                                    id: uuidv4(),
                                                    name: '新库 1',
                                                    matchRule: '根据文案内容语义匹配最合适的条目',
                                                    maxRepeat: 3,
                                                    items: [],
                                                    enabled: true,
                                                    color: LIB_COLORS[0]
                                                };
                                                setLibraries([newLib]);
                                                setActiveLibraryId(newLib.id);
                                                setActiveEditorGroup(newLib.name);
                                            }}
                                            className="px-4 py-2 text-sm text-green-400 hover:bg-green-900/20 rounded-lg border border-dashed border-green-800/40 transition-colors"
                                        >
                                            + 新建空库
                                        </button>
                                        <div className="text-[10px] text-zinc-600">或从预设添加：</div>
                                        <div className="flex flex-wrap justify-center gap-1.5">
                                            {LIBRARY_PRESETS.map(preset => (
                                                <button
                                                    key={preset.id}
                                                    onClick={() => {
                                                        const cloned: CopywritingLibrary = {
                                                            ...preset,
                                                            id: `${preset.id}_${Date.now()}`,
                                                            items: preset.items.map(item => ({ ...item, id: `${item.id}_${Date.now()}`, usedCount: 0 })),
                                                            source: 'preset',
                                                        };
                                                        setLibraries(prev => [...prev, cloned]);
                                                        setActiveLibraryId(cloned.id);
                                                        showCopyToast(`✅ 已添加「${preset.name}」(${preset.items.length}条)`);
                                                    }}
                                                    className="px-2 py-1 text-xs bg-zinc-800 hover:bg-amber-900/30 text-amber-300 rounded border border-zinc-700 hover:border-amber-600 transition-colors flex items-center gap-1"
                                                >
                                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: preset.color }} />
                                                    {preset.name}
                                                    <span className="text-[9px] text-zinc-500">({preset.items.length})</span>
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    );
                }
                const updateLib = (updates: Partial<CopywritingLibrary>) => {
                    setLibraries(prev => prev.map(l => l.id === activeLibraryId ? { ...l, ...updates } : l));
                };
                const updateLibItem = (itemId: string, updates: Partial<LibraryItem>) => {
                    setLibraries(prev => prev.map(l => l.id === activeLibraryId
                        ? { ...l, items: l.items.map(i => i.id === itemId ? { ...i, ...updates } : i) }
                        : l
                    ));
                };
                const addLibItem = () => {
                    setLibraries(prev => prev.map(l => l.id === activeLibraryId
                        ? { ...l, items: [...l.items, { id: uuidv4(), content: '', weight: 5, tags: '', usedCount: 0 }] }
                        : l
                    ));
                };
                const removeLibItem = (itemId: string) => {
                    setLibraries(prev => prev.map(l => l.id === activeLibraryId
                        ? { ...l, items: l.items.filter(i => i.id !== itemId) }
                        : l
                    ));
                };
                const handleBatchImport = () => {
                    setBatchImportText('');
                    setShowBatchImportModal(true);
                };

                return (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-4xl mx-4 shadow-2xl max-h-[85vh] flex flex-col">
                            <div className="p-4 border-b border-zinc-800">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-green-400 font-medium flex items-center gap-2">
                                        📚 编辑文案库
                                    </div>
                                    <button
                                        onClick={() => setShowLibraryEditor(false)}
                                        className="text-zinc-500 hover:text-zinc-300"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                                {/* 第一级：分页/总库 标签 */}
                                {(() => {
                                    // 构建分组
                                    const groups: { group: string; libs: CopywritingLibrary[] }[] = [];
                                    const seen = new Set<string>();
                                    for (const lib of libraries) {
                                        const g = lib.group || lib.name;
                                        if (!seen.has(g)) {
                                            seen.add(g);
                                            groups.push({ group: g, libs: libraries.filter(l => (l.group || l.name) === g) });
                                        }
                                    }
                                    // 确定当前选中的分组
                                    const activeGroup = activeEditorGroup || (activeLib ? (activeLib.group || activeLib.name) : groups[0]?.group || '');
                                    const currentGroupLibs = groups.find(g => g.group === activeGroup)?.libs || [];
                                    const isMultiGroup = currentGroupLibs.length > 1 || (currentGroupLibs.length === 1 && currentGroupLibs[0].name !== activeGroup);

                                    return (
                                        <>
                                            <div className="flex items-center gap-1 flex-wrap">
                                                {groups.map(grp => {
                                                    const isActive = grp.group === activeGroup;
                                                    const totalItems = grp.libs.reduce((s, l) => s + l.items.length, 0);
                                                    const allEnabled = grp.libs.every(l => l.enabled);
                                                    const someEnabled = grp.libs.some(l => l.enabled);
                                                    return (
                                                        <button
                                                            key={grp.group}
                                                            onClick={() => {
                                                                setActiveEditorGroup(grp.group);
                                                                // 如果是单库分组，直接选中该库
                                                                if (grp.libs.length === 1 && grp.libs[0].name === grp.group) {
                                                                    setActiveLibraryId(grp.libs[0].id);
                                                                } else if (grp.libs.length > 0) {
                                                                    // 选中组内第一个库
                                                                    const firstLib = grp.libs.find(l => l.id === activeLibraryId) || grp.libs[0];
                                                                    setActiveLibraryId(firstLib.id);
                                                                }
                                                            }}
                                                            onContextMenu={(e) => {
                                                                e.preventDefault();
                                                                // 右键切换整组启用/禁用
                                                                const newEnabled = !allEnabled;
                                                                setLibraries(prev => prev.map(l => {
                                                                    if (grp.libs.some(gl => gl.id === l.id)) {
                                                                        return { ...l, enabled: newEnabled };
                                                                    }
                                                                    return l;
                                                                }));
                                                            }}
                                                            className={`px-2.5 py-1 text-xs rounded-lg transition-all flex items-center gap-1.5 ${isActive
                                                                ? 'bg-green-600 text-white'
                                                                : someEnabled
                                                                    ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
                                                                    : 'bg-zinc-800/40 text-zinc-500 hover:bg-zinc-700 border border-zinc-800'
                                                                }`}
                                                            title={`${allEnabled ? '全部启用' : someEnabled ? '部分启用' : '全部禁用'}｜右键切换`}
                                                        >
                                                            <span className={`w-2 h-2 rounded-full ${allEnabled ? '' : someEnabled ? 'opacity-50' : 'opacity-30'}`}
                                                                style={{ backgroundColor: grp.libs[0]?.color || '#888' }} />
                                                            {grp.group}
                                                            <span className="text-[10px] opacity-60">({totalItems})</span>
                                                        </button>
                                                    );
                                                })}
                                                <button
                                                    onClick={() => {
                                                        const newLib: CopywritingLibrary = {
                                                            id: uuidv4(),
                                                            name: `新库 ${libraries.length + 1}`,
                                                            matchRule: '根据文案内容语义匹配最合适的条目',
                                                            maxRepeat: 3,
                                                            items: [],
                                                            enabled: true,
                                                            color: LIB_COLORS[libraries.length % LIB_COLORS.length]
                                                        };
                                                        setLibraries(prev => [...prev, newLib]);
                                                        setActiveLibraryId(newLib.id);
                                                        setActiveEditorGroup(newLib.name);
                                                    }}
                                                    className="px-2 py-1 text-[10px] text-green-400 hover:bg-green-900/20 rounded-lg border border-dashed border-green-800/40"
                                                >
                                                    + 新建
                                                </button>
                                            </div>
                                            {/* 第二级：子库标签（仅总库模式下显示） */}
                                            {isMultiGroup && (
                                                <div className="flex items-center gap-1 flex-wrap mt-1 pl-2 border-l-2 border-green-800/30">
                                                    {currentGroupLibs.map(lib => (
                                                        <button
                                                            key={lib.id}
                                                            onClick={() => setActiveLibraryId(lib.id)}
                                                            onContextMenu={(e) => {
                                                                e.preventDefault();
                                                                setLibraries(prev => prev.map(l => l.id === lib.id ? { ...l, enabled: !l.enabled } : l));
                                                            }}
                                                            className={`px-2 py-0.5 text-[11px] rounded transition-all flex items-center gap-1 ${lib.id === activeLibraryId
                                                                ? 'bg-green-500/80 text-white'
                                                                : lib.enabled
                                                                    ? 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'
                                                                    : 'bg-zinc-800/30 text-zinc-600 hover:bg-zinc-700 line-through opacity-50'
                                                                }`}
                                                            title={`${lib.enabled ? '✅ 已启用' : '⬜ 已禁用'}｜右键切换`}
                                                        >
                                                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: lib.enabled ? lib.color : '#555' }} />
                                                            {lib.name} ({lib.items.length})
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                                {/* 操作按钮 */}
                                <div className="flex items-center gap-2 mt-1">
                                    {libraries.length > 1 && (
                                        <button
                                            onClick={() => {
                                                setConfirmDialog({
                                                    message: `确定删除「${activeLib.name}」？`,
                                                    onConfirm: () => {
                                                        const remaining = libraries.filter(l => l.id !== activeLibraryId);
                                                        setLibraries(remaining);
                                                        setActiveLibraryId(remaining[0].id);
                                                    }
                                                });
                                            }}
                                            className="px-2 py-0.5 text-[10px] text-red-400/60 hover:text-red-400 hover:bg-red-900/20 rounded"
                                        >
                                            <Trash2 size={10} className="inline mr-0.5" /> 删除当前库
                                        </button>
                                    )}
                                </div>
                                {/* Google Sheets 导入 */}
                                <div className="flex items-center gap-2 mt-2">
                                    <input
                                        type="text"
                                        value={libSheetsUrl}
                                        onChange={(e) => {
                                            setLibSheetsUrl(e.target.value);
                                            try { localStorage.setItem('copywriting_lib_sheetsUrl', e.target.value); } catch { }
                                        }}
                                        placeholder="粘贴 Google Sheets 链接..."
                                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-green-500"
                                    />
                                    <button
                                        onClick={async () => {
                                            if (!libSheetsUrl.trim()) return;
                                            setLibSheetsImporting(true);
                                            try {
                                                const imported = await importLibrariesFromSheets(libSheetsUrl);
                                                setLibraries(imported);
                                                setActiveLibraryId(imported[0].id);
                                                showCopyToast(`✅ 导入成功: ${imported.length} 个库, 共 ${imported.reduce((s, l) => s + l.items.length, 0)} 条`);
                                            } catch (error: any) {
                                                alert(error.message || '导入失败');
                                            } finally {
                                                setLibSheetsImporting(false);
                                            }
                                        }}
                                        disabled={libSheetsImporting || !libSheetsUrl.trim()}
                                        className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded flex items-center gap-1"
                                    >
                                        {libSheetsImporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                        {libSheetsImporting ? '导入中...' : '从表格导入'}
                                    </button>
                                </div>
                            </div>
                            <div className="p-4 space-y-3 overflow-y-auto flex-1">
                                {/* 库基本设置 */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="text-[10px] text-zinc-500 mb-1 block">库名称</label>
                                        <input
                                            type="text"
                                            value={activeLib.name}
                                            onChange={(e) => updateLib({ name: e.target.value })}
                                            className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm text-green-200 focus:outline-none focus:border-green-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-zinc-500 mb-1 block">单条最大使用次数</label>
                                        <input
                                            type="number"
                                            value={activeLib.maxRepeat}
                                            onChange={(e) => updateLib({ maxRepeat: parseInt(e.target.value) || 1 })}
                                            min={1}
                                            className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-green-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-zinc-500 mb-1 block">库条目数</label>
                                        <div className="px-3 py-1.5 text-sm text-zinc-400 bg-zinc-950 border border-zinc-700 rounded">{activeLib.items.length} 条</div>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] text-zinc-500 mb-1 block">匹配规则（告诉 AI 如何选择）</label>
                                    <textarea
                                        value={activeLib.matchRule}
                                        onChange={(e) => updateLib({ matchRule: e.target.value })}
                                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-green-500 resize-none"
                                        rows={2}
                                    />
                                </div>

                                {/* 批量操作栏 */}
                                {(() => {
                                    // 收集标签
                                    const allTags = Array.from(new Set(activeLib.items.map(i => i.tags).filter(Boolean)));
                                    if (allTags.length === 0) return null;
                                    return (
                                        <div className="bg-zinc-800/50 rounded-lg px-3 py-2 space-y-1.5">
                                            <div className="text-[10px] text-zinc-500 font-medium">按分类批量操作</div>
                                            <div className="flex items-center gap-1 flex-wrap">
                                                {allTags.map(tag => {
                                                    const count = activeLib.items.filter(i => i.tags === tag).length;
                                                    const avgWeight = Math.round(activeLib.items.filter(i => i.tags === tag).reduce((s, i) => s + i.weight, 0) / count);
                                                    const priorityLabel = avgWeight <= 3 ? '⚪低' : avgWeight <= 6 ? '🟡中' : avgWeight <= 8 ? '🟠高' : '🔴极高';
                                                    return (
                                                        <div key={tag} className="flex items-center gap-1 bg-zinc-900 rounded px-2 py-1">
                                                            <span className="text-[10px] text-zinc-300">{tag}</span>
                                                            <span className="text-[9px] text-zinc-600">({count})</span>
                                                            <select
                                                                value={avgWeight <= 3 ? '2' : avgWeight <= 6 ? '5' : avgWeight <= 8 ? '7' : '10'}
                                                                onChange={(e) => {
                                                                    const newWeight = parseInt(e.target.value);
                                                                    setLibraries(prev => prev.map(l => l.id === activeLibraryId
                                                                        ? { ...l, items: l.items.map(i => i.tags === tag ? { ...i, weight: newWeight } : i) }
                                                                        : l
                                                                    ));
                                                                }}
                                                                className="bg-transparent border-none text-[10px] text-zinc-400 focus:outline-none cursor-pointer appearance-none"
                                                                title="设置该分类所有条目的优先级"
                                                            >
                                                                <option value="2" className="bg-zinc-800">⚪ 低</option>
                                                                <option value="5" className="bg-zinc-800">🟡 中</option>
                                                                <option value="7" className="bg-zinc-800">🟠 高</option>
                                                                <option value="10" className="bg-zinc-800">🔴 极高</option>
                                                            </select>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* 库条目列表 */}
                                <div className="border border-zinc-700 rounded-lg overflow-hidden">
                                    <div className="flex items-center bg-zinc-800 px-3 py-1.5 gap-2">
                                        <span className="flex-1 text-[10px] text-zinc-400 font-medium">内容</span>
                                        {activeLib.items.some(i => i.tags) && <span className="w-20 text-[10px] text-zinc-400 font-medium text-center">分类</span>}
                                        <span className="w-16 text-[10px] text-zinc-400 font-medium text-center">优先级</span>
                                        <span className="w-14 text-[10px] text-zinc-400 font-medium text-center">已用</span>
                                        <span className="w-6"></span>
                                    </div>
                                    <div className="max-h-60 overflow-y-auto">
                                        {activeLib.items.map((item, idx) => (
                                            <div key={item.id} className="flex items-center px-1 py-0.5 gap-2 border-t border-zinc-800/50 hover:bg-zinc-800/30">
                                                <input
                                                    type="text"
                                                    value={item.content}
                                                    onChange={(e) => updateLibItem(item.id, { content: e.target.value })}
                                                    className="flex-1 bg-transparent border-none px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:bg-zinc-800/50 rounded"
                                                    placeholder={`条目 ${idx + 1}`}
                                                />
                                                {activeLib.items.some(i => i.tags) && (
                                                    <span className="w-20 text-[9px] text-zinc-500 text-center truncate" title={item.tags}>
                                                        {item.tags || '-'}
                                                    </span>
                                                )}
                                                <select
                                                    value={item.weight <= 3 ? '2' : item.weight <= 6 ? '5' : item.weight <= 8 ? '7' : '10'}
                                                    onChange={(e) => updateLibItem(item.id, { weight: parseInt(e.target.value) })}
                                                    className="w-16 bg-transparent border-none px-1 py-1 text-xs text-zinc-300 focus:outline-none text-center appearance-none cursor-pointer"
                                                >
                                                    <option value="2" className="bg-zinc-800">⚪ 低</option>
                                                    <option value="5" className="bg-zinc-800">🟡 中</option>
                                                    <option value="7" className="bg-zinc-800">🟠 高</option>
                                                    <option value="10" className="bg-zinc-800">🔴 极高</option>
                                                </select>
                                                <span className={`w-14 text-center text-[10px] ${item.usedCount >= activeLib.maxRepeat ? 'text-red-400' : 'text-zinc-500'}`}>
                                                    {item.usedCount}/{activeLib.maxRepeat}
                                                </span>
                                                <button onClick={() => removeLibItem(item.id)} className="w-6 text-zinc-600 hover:text-red-400 flex items-center justify-center">
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* 操作按钮 */}
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={addLibItem}
                                        className="flex items-center gap-1 px-3 py-1 text-xs text-green-400 hover:bg-green-900/20 rounded border border-green-900/30"
                                    >
                                        <Plus size={12} /> 添加条目
                                    </button>
                                    <button
                                        onClick={handleBatchImport}
                                        className="flex items-center gap-1 px-3 py-1 text-xs text-sky-400 hover:bg-sky-900/20 rounded border border-sky-900/30"
                                    >
                                        <ClipboardCopy size={12} /> 批量导入
                                    </button>
                                    <button
                                        onClick={() => {
                                            setConfirmDialog({
                                                message: '确定清空所有条目？',
                                                onConfirm: () => updateLib({ items: [] })
                                            });
                                        }}
                                        className="flex items-center gap-1 px-3 py-1 text-xs text-red-400 hover:bg-red-900/20 rounded border border-red-900/30"
                                    >
                                        <Trash2 size={12} /> 清空
                                    </button>
                                </div>
                            </div>
                            <div className="p-4 border-t border-zinc-800 flex justify-end">
                                <button
                                    onClick={() => setShowLibraryEditor(false)}
                                    className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium"
                                >
                                    完成
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 批量导入弹框 */}
            {showBatchImportModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]" onClick={() => setShowBatchImportModal(false)}>
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                            <div className="text-green-400 font-medium text-sm">📋 批量导入</div>
                            <button onClick={() => setShowBatchImportModal(false)} className="text-zinc-500 hover:text-zinc-300">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            <div className="text-[11px] text-zinc-500">
                                每行一条，可用 Tab 分隔权重和标签。格式：<span className="text-zinc-400">内容{'\t'}权重{'\t'}标签</span>
                            </div>
                            <textarea
                                value={batchImportText}
                                onChange={e => setBatchImportText(e.target.value)}
                                placeholder={"粘贴文案库内容...\n例：Type Amen 🙏\t10\t互动\n例：Share this ❤️\t5\t分享"}
                                className="w-full h-48 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-green-500 placeholder-zinc-600 resize-none font-mono"
                                autoFocus
                            />
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={async () => {
                                            try {
                                                const clip = await navigator.clipboard.readText();
                                                if (clip) setBatchImportText(clip);
                                            } catch { showCopyToast('无法读取剪贴板'); }
                                        }}
                                        className="px-3 py-1.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors"
                                    >
                                        📋 从剪贴板粘贴
                                    </button>
                                    <span className="text-[10px] text-zinc-600">
                                        {batchImportText.trim() ? `${batchImportText.split('\n').filter(l => l.trim()).length} 条` : ''}
                                    </span>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setShowBatchImportModal(false)}
                                        className="px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={confirmBatchImport}
                                        disabled={!batchImportText.trim()}
                                        className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg font-medium transition-colors"
                                    >
                                        导入
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}


            {/* 确认对话框 */}
            {confirmDialog && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70]" onClick={() => setConfirmDialog(null)}>
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-5">
                            <div className="text-sm text-zinc-200 mb-5">{confirmDialog.message}</div>
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setConfirmDialog(null)}
                                    className="px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                                    className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors"
                                >
                                    确定
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 双击编辑拆分列弹框 */}
            {
                editingSplitColumnId !== null && (() => {
                    const col = splitColumns.find(c => c.id === editingSplitColumnId);
                    if (!col) return null;
                    const colIdx = splitColumns.findIndex(c => c.id === editingSplitColumnId);
                    return (
                        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                            <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl mx-4 shadow-2xl">
                                <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                                    <div className="text-orange-400 font-medium flex items-center gap-2">
                                        ✏️ 编辑拆分列 {colIdx + 1}
                                    </div>
                                    <button
                                        onClick={() => setEditingSplitColumnId(null)}
                                        className="text-zinc-500 hover:text-zinc-300"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                                <div className="p-4 space-y-3">
                                    <div>
                                        <label className="text-[10px] text-zinc-500 mb-1 block">列名</label>
                                        <input
                                            type="text"
                                            value={col.name}
                                            onChange={(e) => updateSplitColumn(col.id, { name: e.target.value })}
                                            placeholder="列名（如：钩子、关键词）"
                                            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-orange-200 focus:outline-none focus:border-orange-500 placeholder-zinc-600"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-zinc-500 mb-1 block">提取/分析要求</label>
                                        <textarea
                                            value={col.description}
                                            onChange={(e) => updateSplitColumn(col.id, { description: e.target.value })}
                                            placeholder="在此输入详细的提取或分析要求...\n例如：提取3-5个核心主题关键词，用逗号分隔。关注信仰主题词、情感属性词、行动号召词等。"
                                            className="w-full h-48 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-orange-500 placeholder-zinc-600 resize-none"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="text-[10px] text-zinc-500">
                                        提示：在这里可以详细描述该列的提取或分析要求。支持多行编辑，关闭弹框后自动保存。
                                    </div>
                                </div>
                                <div className="p-4 border-t border-zinc-800 flex justify-end">
                                    <button
                                        onClick={() => setEditingSplitColumnId(null)}
                                        className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-medium"
                                    >
                                        确定
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })()
            }

            {/* 保存预设 Modal */}
            {
                showSavePreset && (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowSavePreset(false)}>
                        <div className="bg-zinc-900 border border-amber-600/50 rounded-xl p-4 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
                            <h3 className="text-amber-400 text-sm font-medium mb-3">保存预设</h3>
                            <div className="mb-3">
                                <label className="text-[10px] text-zinc-500 mb-1 block">预设名称</label>
                                <input
                                    type="text"
                                    value={newPresetName}
                                    onChange={(e) => setNewPresetName(e.target.value)}
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                                    placeholder="输入预设名称..."
                                    autoFocus
                                    onKeyDown={(e) => { if (e.key === 'Enter') confirmSavePreset(); }}
                                />
                            </div>
                            <div className="mb-3">
                                <label className="text-[10px] text-zinc-500 mb-1 block">指令内容预览</label>
                                <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-xs text-zinc-400 max-h-24 overflow-y-auto">
                                    {instructions.find(i => i.trim()) || '无'}
                                </div>
                            </div>
                            <div className="flex gap-2 justify-end">
                                <button
                                    onClick={() => setShowSavePreset(false)}
                                    className="px-3 py-1.5 text-zinc-400 hover:text-zinc-200 text-sm"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={confirmSavePreset}
                                    disabled={!newPresetName.trim()}
                                    className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm disabled:opacity-50"
                                >
                                    保存
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }

            {/* 复制提示Toast */}
            {
                copyToast && (
                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-emerald-600 text-white rounded-lg shadow-lg text-sm flex items-center gap-2 animate-pulse">
                        <Check size={16} />
                        {copyToast}
                    </div>
                )
            }

            {/* 预设管理器 */}
            <PresetManager
                isOpen={showPresetManager}
                onClose={() => setShowPresetManager(false)}
                presets={presets}
                builtinPresets={BUILTIN_PRESETS}
                hiddenPresetIds={hiddenPresetIds}
                onTogglePresetVisibility={(presetId: string) => {
                    setHiddenPresetIds(prev =>
                        prev.includes(presetId)
                            ? prev.filter(id => id !== presetId)
                            : [...prev, presetId]
                    );
                }}
                onSetHiddenPresetIds={(ids: string[]) => setHiddenPresetIds(ids)}
                onPresetsChange={(newPresets) => {
                    setPresets(newPresets);
                    savePresetsToFirebase(newPresets);
                }}
                onSelectPreset={(preset) => {
                    // 填充到第一个空指令槽，或替换第一个
                    const emptyIdx = instructions.findIndex(i => !i.trim());
                    if (emptyIdx >= 0) {
                        const newInstructions = [...instructions];
                        newInstructions[emptyIdx] = preset.instruction;
                        setInstructions(newInstructions);
                    } else {
                        setInstructions([preset.instruction, ...instructions.slice(1)]);
                    }
                    showCopyToast(`已应用预设: ${preset.name}`);
                }}
            />

            {/* === 详情弹窗（双击结果行打开） === */}
            {detailModalItem && (
                <div
                    className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/70 backdrop-blur-sm"
                    onClick={() => { setDetailModalItem(null); setDetailShowRaw(false); }}
                >
                    <div
                        className="bg-zinc-900 border border-zinc-700 rounded-2xl shadow-2xl w-[90vw] max-w-[900px] max-h-[85vh] flex flex-col overflow-hidden"
                        onClick={(e) => e.stopPropagation()}
                    >
                        {/* 标题栏 */}
                        <div className="flex items-center justify-between px-6 py-4 border-b border-zinc-700 bg-zinc-800/50">
                            <div className="flex items-center gap-3">
                                <span className="text-lg font-semibold text-zinc-100">📋 结果详情</span>
                                <span className="text-[10px] text-zinc-500 bg-zinc-800 px-2 py-0.5 rounded-full">双击结果行打开</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {detailModalItem.rawResponse && (
                                    <button
                                        onClick={() => setDetailShowRaw(!detailShowRaw)}
                                        className={`flex items-center gap-1 px-3 py-1.5 text-xs rounded-lg transition-all ${detailShowRaw
                                            ? 'bg-amber-600 text-white'
                                            : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                                            }`}
                                    >
                                        <Eye size={14} /> {detailShowRaw ? '隐藏原始响应' : '查看原始AI响应'}
                                    </button>
                                )}
                                <button
                                    onClick={() => { setDetailModalItem(null); setDetailShowRaw(false); }}
                                    className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg transition-colors"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                        </div>

                        {/* 内容区 */}
                        <div className="flex-1 overflow-y-auto p-6 space-y-4">
                            {/* 原始外文 */}
                            <div className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/50">
                                <div className="flex items-center justify-between mb-2">
                                    <span className="text-xs text-zinc-400 font-medium">📝 原始外文</span>
                                    <button
                                        onClick={() => { navigator.clipboard.writeText(detailModalItem.originalForeign); showCopyToast('已复制原始外文'); }}
                                        className="text-[10px] text-zinc-500 hover:text-zinc-300 px-2 py-0.5 rounded hover:bg-zinc-700/50"
                                    >复制</button>
                                </div>
                                <div className="text-sm text-zinc-300 whitespace-pre-wrap break-words leading-relaxed">{detailModalItem.originalForeign}</div>
                            </div>

                            {/* 原始中文 */}
                            {detailModalItem.originalChinese && (
                                <div className="bg-zinc-800/50 rounded-xl p-4 border border-zinc-700/50">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs text-zinc-400 font-medium">📖 原始中文</span>
                                        <button
                                            onClick={() => { navigator.clipboard.writeText(detailModalItem.originalChinese || ''); showCopyToast('已复制原始中文'); }}
                                            className="text-[10px] text-zinc-500 hover:text-zinc-300 px-2 py-0.5 rounded hover:bg-zinc-700/50"
                                        >复制</button>
                                    </div>
                                    <div className="text-sm text-zinc-400 whitespace-pre-wrap break-words leading-relaxed">{detailModalItem.originalChinese}</div>
                                </div>
                            )}

                            {/* 改写后外文 */}
                            {detailModalItem.resultForeign && (
                                <div className="bg-emerald-950/30 rounded-xl p-4 border border-emerald-800/30">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs text-emerald-400 font-medium">✨ 改写后外文</span>
                                        <button
                                            onClick={() => { navigator.clipboard.writeText(detailModalItem.resultForeign || ''); showCopyToast('已复制改写后外文'); }}
                                            className="text-[10px] text-emerald-500 hover:text-emerald-300 px-2 py-0.5 rounded hover:bg-emerald-900/30"
                                        >复制</button>
                                    </div>
                                    <div className="text-sm text-emerald-100 whitespace-pre-wrap break-words leading-relaxed">{detailModalItem.resultForeign}</div>
                                </div>
                            )}

                            {/* 改写后中文 */}
                            {detailModalItem.resultChinese && (
                                <div className="bg-blue-950/30 rounded-xl p-4 border border-blue-800/30">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs text-blue-400 font-medium">🈶 改写后中文</span>
                                        <button
                                            onClick={() => { navigator.clipboard.writeText(detailModalItem.resultChinese || ''); showCopyToast('已复制改写后中文'); }}
                                            className="text-[10px] text-blue-500 hover:text-blue-300 px-2 py-0.5 rounded hover:bg-blue-900/30"
                                        >复制</button>
                                    </div>
                                    <div className="text-sm text-blue-100 whitespace-pre-wrap break-words leading-relaxed">{detailModalItem.resultChinese}</div>
                                </div>
                            )}

                            {/* 指令结果 */}
                            {detailModalItem.instructionResults && detailModalItem.instructionResults.length > 0 && (
                                <div className="space-y-3">
                                    <div className="text-xs text-zinc-400 font-medium">📊 各指令结果</div>
                                    {detailModalItem.instructionResults.map((result, idx) => (
                                        <div key={result.id} className="bg-purple-950/20 rounded-xl p-4 border border-purple-800/30">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs text-purple-400 font-medium">指令{idx + 1}: {result.instruction?.substring(0, 50)}{(result.instruction?.length || 0) > 50 ? '...' : ''}</span>
                                                <button
                                                    onClick={() => { navigator.clipboard.writeText(`${result.resultForeign}\t${result.resultChinese}`); showCopyToast(`已复制指令${idx + 1}结果`); }}
                                                    className="text-[10px] text-purple-500 hover:text-purple-300 px-2 py-0.5 rounded hover:bg-purple-900/30"
                                                >复制</button>
                                            </div>
                                            {result.status === 'success' ? (
                                                <div className="space-y-2">
                                                    <div className="text-sm text-purple-100 whitespace-pre-wrap break-words leading-relaxed">{result.resultForeign}</div>
                                                    {result.resultChinese && (
                                                        <div className="text-sm text-blue-200/80 whitespace-pre-wrap break-words leading-relaxed border-t border-purple-800/30 pt-2 mt-2">{result.resultChinese}</div>
                                                    )}
                                                </div>
                                            ) : (
                                                <div>
                                                    <div className="text-sm text-red-400">{result.error || '处理失败'}</div>
                                                    {mode === 'voice' && renderVoiceIntegrityIssue(result.voiceIntegrityIssue, setFullDiffIssue)}
                                                </div>
                                            )}
                                        </div>
                                    ))}
                                </div>
                            )}

                            {/* 原始AI响应 */}
                            {detailShowRaw && detailModalItem.rawResponse && (
                                <div className="bg-amber-950/20 rounded-xl p-4 border border-amber-800/30">
                                    <div className="flex items-center justify-between mb-2">
                                        <span className="text-xs text-amber-400 font-medium">🔍 原始AI响应（未经解析的完整输出）</span>
                                        <button
                                            onClick={() => { navigator.clipboard.writeText(detailModalItem.rawResponse || ''); showCopyToast('已复制原始AI响应'); }}
                                            className="text-[10px] text-amber-500 hover:text-amber-300 px-2 py-0.5 rounded hover:bg-amber-900/30"
                                        >复制</button>
                                    </div>
                                    <div className="text-sm text-amber-100/80 whitespace-pre-wrap break-words leading-relaxed font-mono bg-black/30 rounded-lg p-3">{detailModalItem.rawResponse}</div>
                                </div>
                            )}
                        </div>

                        {/* 底部操作栏 */}
                        <div className="px-6 py-3 border-t border-zinc-700 bg-zinc-800/30 flex items-center justify-between">
                            <span className="text-[10px] text-zinc-600">按 Esc 或点击遮罩层关闭</span>
                            <button
                                onClick={() => {
                                    const parts = [
                                        detailModalItem.originalForeign,
                                        detailModalItem.originalChinese || '',
                                        detailModalItem.resultForeign || '',
                                        detailModalItem.resultChinese || ''
                                    ];
                                    navigator.clipboard.writeText(parts.join('\t'));
                                    showCopyToast('已复制全部内容（Tab分隔）');
                                }}
                                className="flex items-center gap-1.5 px-4 py-2 text-xs bg-emerald-600 text-white rounded-lg hover:bg-emerald-500 transition-colors"
                            >
                                <Copy size={14} /> 复制全部
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Full Diff Modal */}
            {fullDiffIssue && (
                <FullDiffModal issue={fullDiffIssue} onClose={() => setFullDiffIssue(null)} />
            )}
        </div >
    );
}
