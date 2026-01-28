/**
 * ColumnAlignPanel - 列对齐/行匹配工具
 * 用于解决翻译结果错位问题，支持两种匹配模式：
 * 1. 精确匹配：有原文列作为对照，根据原文内容匹配调整其他列的行顺序
 * 2. AI语义匹配：没有原文列，根据翻译内容的语义关系进行匹配
 */

import React, { useState, useCallback, useMemo } from 'react';
import {
    AlignLeft, Copy, Check, AlertCircle, Loader2,
    ArrowRight, Sparkles, Table2, RefreshCw, Download,
    Columns, MoveVertical
} from 'lucide-react';
import { GoogleGenAI } from "@google/genai";

interface ColumnAlignPanelProps {
    getAiInstance?: () => GoogleGenAI;
}

type MatchMode = 'exact' | 'ai';

export default function ColumnAlignPanel({ getAiInstance }: ColumnAlignPanelProps) {
    // 基准列（原始数据）
    const [baseColumn, setBaseColumn] = useState<string>('');

    // 待匹配数据
    const [matchInput, setMatchInput] = useState<string>('');

    // 匹配模式
    const [matchMode, setMatchMode] = useState<MatchMode>('exact');
    const [matchKeyColumn, setMatchKeyColumn] = useState<string>('0');

    // 状态
    const [isProcessing, setIsProcessing] = useState(false);
    const [progress, setProgress] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [copied, setCopied] = useState(false);

    // 结果
    const [result, setResult] = useState<string[][]>([]);
    const [unmatchedBase, setUnmatchedBase] = useState<string[]>([]);
    const [unmatchedMatch, setUnmatchedMatch] = useState<string[]>([]);

    // 解析 HTML 表格数据（从 Google Sheets/Excel 复制时使用）
    const parseHtmlTable = (html: string): string[][] | null => {
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const rows = doc.querySelectorAll('tr');
            if (rows.length === 0) return null;

            const result: string[][] = [];
            rows.forEach(row => {
                const cells = row.querySelectorAll('td, th');
                if (cells.length > 0) {
                    const rowData: string[] = [];
                    cells.forEach(cell => {
                        rowData.push((cell.textContent || '').trim());
                    });
                    result.push(rowData);
                }
            });
            return result.length > 0 ? result : null;
        } catch {
            return null;
        }
    };

    // 处理粘贴事件 - 优先解析 HTML 表格格式
    const handlePaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>, target: 'base' | 'match') => {
        const htmlData = e.clipboardData.getData('text/html');

        if (htmlData) {
            const htmlRows = parseHtmlTable(htmlData);
            if (htmlRows && htmlRows.length > 0) {
                e.preventDefault();
                if (target === 'base') {
                    setBaseColumn(htmlRows.map(row => row[0] || '').join('\n'));
                } else {
                    setMatchInput(htmlRows.map(row => row.join('\t')).join('\n'));
                }
                return;
            }
        }
    }, []);

    // 解析粘贴的数据 - 保留空行以确保行对齐
    const parseData = (text: string): string[][] => {
        if (!text.trim()) return [];
        const lines = text.split('\n');  // 不 trim，保留空行
        return lines.map(line => line.split('\t'));
    };

    // 获取基准列的行数据 - 保留空行以确保行对齐
    const baseRows = useMemo(() => {
        if (!baseColumn.trim()) return [];
        return baseColumn.split('\n');  // 不过滤空行，保持行对齐
    }, [baseColumn]);

    // 解析待匹配数据 - 保留空行
    const matchData = useMemo(() => {
        if (!matchInput.trim()) return { columns: 0, rows: [] as string[][] };
        const lines = matchInput.split('\n');  // 不 trim，保留空行
        const parsed = lines.map(line => line.split('\t'));
        if (parsed.length === 0) return { columns: 0, rows: [] as string[][] };
        // 获取最大列数
        const maxCols = Math.max(...parsed.map(row => row.length), 1);
        return {
            columns: maxCols,
            rows: parsed
        };
    }, [matchInput]);

    // 精确匹配
    const executeExactMatch = useCallback(() => {
        if (baseRows.length === 0 || matchData.rows.length === 0) {
            setError('请先输入基准列和待匹配数据');
            return;
        }

        const keyColIndex = parseInt(matchKeyColumn);
        if (keyColIndex >= matchData.columns) {
            setError('匹配列索引超出范围');
            return;
        }

        setIsProcessing(true);
        setProgress('正在进行精确匹配...');
        setError(null);

        try {
            const matchMap = new Map<string, string[]>();
            const matchedKeys = new Set<string>();

            matchData.rows.forEach(row => {
                const key = row[keyColIndex]?.trim().toLowerCase() || '';
                if (key && !matchMap.has(key)) {
                    matchMap.set(key, row);
                }
            });

            const alignedResult: string[][] = [];
            const unmatched: string[] = [];

            baseRows.forEach(baseRow => {
                const key = baseRow.trim().toLowerCase();
                if (matchMap.has(key)) {
                    alignedResult.push(matchMap.get(key)!);
                    matchedKeys.add(key);
                } else {
                    alignedResult.push(new Array(matchData.columns).fill(''));
                    unmatched.push(baseRow);
                }
            });

            const unmatchedFromMatch: string[] = [];
            matchData.rows.forEach(row => {
                const key = row[keyColIndex]?.trim().toLowerCase() || '';
                if (!matchedKeys.has(key)) {
                    unmatchedFromMatch.push(row.join('\t'));
                }
            });

            setResult(alignedResult);
            setUnmatchedBase(unmatched);
            setUnmatchedMatch(unmatchedFromMatch);
            setProgress(`匹配完成！成功匹配 ${baseRows.length - unmatched.length}/${baseRows.length} 行`);
        } catch (e) {
            setError(e instanceof Error ? e.message : '匹配出错');
        } finally {
            setIsProcessing(false);
        }
    }, [baseRows, matchData, matchKeyColumn]);

    // AI 语义匹配
    const executeAiMatch = useCallback(async () => {
        if (!getAiInstance) {
            setError('AI 功能不可用，请确保已配置 API Key');
            return;
        }

        if (baseRows.length === 0 || matchData.rows.length === 0) {
            setError('请先输入基准列和待匹配数据');
            return;
        }

        setIsProcessing(true);
        setError(null);

        try {
            const ai = getAiInstance();
            const batchSize = 20;
            const alignedResult: string[][] = [];
            const unmatched: string[] = [];
            const usedIndices = new Set<number>();

            for (let i = 0; i < baseRows.length; i += batchSize) {
                const batch = baseRows.slice(i, Math.min(i + batchSize, baseRows.length));
                setProgress(`AI 正在分析... (${i + 1}-${Math.min(i + batchSize, baseRows.length)}/${baseRows.length})`);

                const availableMatches = matchData.rows
                    .map((row, idx) => ({ row, idx }))
                    .filter(({ idx }) => !usedIndices.has(idx));

                if (availableMatches.length === 0) {
                    batch.forEach(baseRow => {
                        alignedResult.push(new Array(matchData.columns).fill(''));
                        unmatched.push(baseRow);
                    });
                    continue;
                }

                const prompt = `你是一个翻译匹配专家。我需要你将原文与其对应的翻译匹配起来。

原文列表（需要按此顺序输出）：
${batch.map((row, idx) => `${i + idx + 1}. "${row}"`).join('\n')}

待匹配的翻译数据（第一列是翻译，可能有多列）：
${availableMatches.slice(0, 50).map(({ row, idx }) => `[${idx}] ${row.join(' | ')}`).join('\n')}

请分析内容的语义对应关系，为每个原文找到最匹配的翻译行。

返回 JSON 格式（不要 markdown 代码块）：
{"matches": [{"baseIndex": 原文序号, "matchIndex": 匹配行的索引号, "confidence": 置信度0-1}, ...]}

如果某个原文找不到匹配，matchIndex 设为 -1。`;

                try {
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.0-flash',
                        contents: prompt
                    });

                    let responseText = response.text || '';
                    if (responseText.startsWith('```')) {
                        responseText = responseText.replace(/^```json?\s*/, '').replace(/```\s*$/, '');
                    }

                    const parsed = JSON.parse(responseText);

                    if (parsed.matches && Array.isArray(parsed.matches)) {
                        batch.forEach((baseRow, batchIdx) => {
                            const match = parsed.matches.find((m: { baseIndex: number }) => m.baseIndex === i + batchIdx + 1);
                            if (match && match.matchIndex >= 0 && !usedIndices.has(match.matchIndex)) {
                                const matchRow = matchData.rows[match.matchIndex];
                                if (matchRow) {
                                    alignedResult.push(matchRow);
                                    usedIndices.add(match.matchIndex);
                                } else {
                                    alignedResult.push(new Array(matchData.columns).fill(''));
                                    unmatched.push(baseRow);
                                }
                            } else {
                                alignedResult.push(new Array(matchData.columns).fill(''));
                                unmatched.push(baseRow);
                            }
                        });
                    }
                } catch (parseError) {
                    console.error('AI 匹配解析失败:', parseError);
                    batch.forEach(baseRow => {
                        alignedResult.push(new Array(matchData.columns).fill(''));
                        unmatched.push(baseRow);
                    });
                }
            }

            const unmatchedFromMatch = matchData.rows
                .filter((_, idx) => !usedIndices.has(idx))
                .map(row => row.join('\t'));

            setResult(alignedResult);
            setUnmatchedBase(unmatched);
            setUnmatchedMatch(unmatchedFromMatch);
            setProgress(`AI 匹配完成！成功匹配 ${baseRows.length - unmatched.length}/${baseRows.length} 行`);
        } catch (e) {
            setError(e instanceof Error ? e.message : 'AI 匹配出错');
        } finally {
            setIsProcessing(false);
        }
    }, [baseRows, matchData, getAiInstance]);

    const executeMatch = () => {
        if (matchMode === 'exact') {
            executeExactMatch();
        } else {
            executeAiMatch();
        }
    };

    const copyResult = () => {
        if (result.length === 0) return;
        const text = result.map(row => row.join('\t')).join('\n');
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const copyResultWithBase = () => {
        if (result.length === 0) return;
        const text = result.map((row, idx) => {
            const baseRow = baseRows[idx] || '';
            return [baseRow, ...row].join('\t');
        }).join('\n');
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const clearAll = () => {
        setBaseColumn('');
        setMatchInput('');
        setResult([]);
        setUnmatchedBase([]);
        setUnmatchedMatch([]);
        setError(null);
        setProgress('');
    };

    return (
        <div className="h-full flex flex-col bg-slate-50 overflow-hidden">
            {/* 头部 */}
            <div className="bg-white border-b border-slate-200 px-4 py-3">
                <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                        <div className="bg-indigo-100 p-1.5 rounded-lg">
                            <MoveVertical className="w-5 h-5 text-indigo-600" />
                        </div>
                        <div>
                            <h2 className="font-bold text-slate-800">列对齐工具</h2>
                            <p className="text-xs text-slate-500">修复翻译错位，自动匹配对应行</p>
                        </div>
                    </div>
                    <button
                        onClick={clearAll}
                        className="px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-100 rounded-lg flex items-center gap-1"
                    >
                        <RefreshCw size={14} />
                        清空
                    </button>
                </div>

                {/* 匹配模式选择 */}
                <div className="mt-3 flex items-center gap-4">
                    <span className="text-xs text-slate-500">匹配模式：</span>
                    <div className="flex bg-slate-100 p-0.5 rounded-lg">
                        <button
                            onClick={() => setMatchMode('exact')}
                            className={`px-3 py-1 text-xs rounded-md transition-all flex items-center gap-1 ${matchMode === 'exact' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <AlignLeft size={12} />
                            精确匹配
                        </button>
                        <button
                            onClick={() => setMatchMode('ai')}
                            className={`px-3 py-1 text-xs rounded-md transition-all flex items-center gap-1 ${matchMode === 'ai' ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'}`}
                        >
                            <Sparkles size={12} />
                            AI 语义匹配
                        </button>
                    </div>
                    {matchMode === 'exact' && matchData.columns > 1 && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-slate-500">匹配列：</span>
                            <select
                                value={matchKeyColumn}
                                onChange={(e) => setMatchKeyColumn(e.target.value)}
                                className="text-xs border border-slate-200 rounded px-2 py-1 bg-white"
                            >
                                {Array.from({ length: matchData.columns }, (_, i) => (
                                    <option key={i} value={i}>第 {i + 1} 列</option>
                                ))}
                            </select>
                        </div>
                    )}
                </div>
            </div>

            {/* 主体内容 */}
            <div className="flex-1 flex overflow-hidden p-4 gap-4">
                {/* 左侧：输入区 */}
                <div className="flex-1 flex flex-col gap-4 min-w-0">
                    {/* 基准列 */}
                    <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Table2 size={14} className="text-green-600" />
                                <span className="text-sm font-medium text-slate-700">基准列（原始数据）</span>
                            </div>
                            <span className="text-xs text-slate-400">{baseRows.length} 行</span>
                        </div>
                        <textarea
                            value={baseColumn}
                            onChange={(e) => setBaseColumn(e.target.value)}
                            onPaste={(e) => handlePaste(e, 'base')}
                            placeholder="粘贴基准列数据（每行一条）&#10;支持从 Google Sheets 直接粘贴..."
                            className="flex-1 p-3 text-sm resize-none focus:outline-none font-mono"
                        />
                    </div>

                    {/* 待匹配数据 */}
                    <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 overflow-hidden">
                        <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Columns size={14} className="text-blue-600" />
                                <span className="text-sm font-medium text-slate-700">待匹配数据</span>
                            </div>
                            <span className="text-xs text-slate-400">
                                {matchData.rows.length} 行 × {matchData.columns} 列
                            </span>
                        </div>
                        <textarea
                            value={matchInput}
                            onChange={(e) => setMatchInput(e.target.value)}
                            onPaste={(e) => handlePaste(e, 'match')}
                            placeholder="粘贴待匹配的数据（支持多列，从 Google Sheets 直接粘贴）&#10;可以是原文+翻译，或者只有翻译..."
                            className="flex-1 p-3 text-sm resize-none focus:outline-none font-mono"
                        />
                    </div>
                </div>

                {/* 中间：操作按钮 */}
                <div className="flex flex-col items-center justify-center gap-3 px-2">
                    <button
                        onClick={executeMatch}
                        disabled={isProcessing || baseRows.length === 0 || matchData.rows.length === 0}
                        className={`p-3 rounded-full transition-all ${isProcessing ? 'bg-slate-200 text-slate-400' : 'bg-indigo-600 text-white hover:bg-indigo-700 shadow-lg hover:shadow-xl'}`}
                    >
                        {isProcessing ? <Loader2 size={20} className="animate-spin" /> : <ArrowRight size={20} />}
                    </button>
                    <span className="text-xs text-slate-400 text-center">
                        {isProcessing ? '处理中' : '开始匹配'}
                    </span>
                </div>

                {/* 右侧：结果区 */}
                <div className="flex-1 flex flex-col bg-white rounded-xl border border-slate-200 overflow-hidden min-w-0">
                    <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between">
                        <div className="flex items-center gap-2">
                            <Check size={14} className="text-green-600" />
                            <span className="text-sm font-medium text-slate-700">对齐结果</span>
                        </div>
                        {result.length > 0 && (
                            <div className="flex items-center gap-1">
                                <button
                                    onClick={copyResult}
                                    className={`px-2 py-1 text-xs rounded flex items-center gap-1 transition-colors ${copied ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-600 hover:bg-slate-200'}`}
                                >
                                    {copied ? <Check size={12} /> : <Copy size={12} />}
                                    复制结果
                                </button>
                                <button
                                    onClick={copyResultWithBase}
                                    className="px-2 py-1 text-xs rounded bg-indigo-100 text-indigo-700 hover:bg-indigo-200 flex items-center gap-1"
                                >
                                    <Download size={12} />
                                    含基准列
                                </button>
                            </div>
                        )}
                    </div>

                    <div className="flex-1 overflow-auto p-3">
                        {(progress || error) && (
                            <div className={`mb-3 px-3 py-2 rounded-lg text-sm flex items-center gap-2 ${error ? 'bg-red-50 text-red-700 border border-red-200' : 'bg-blue-50 text-blue-700 border border-blue-200'}`}>
                                {error ? <AlertCircle size={14} /> : <Check size={14} />}
                                {error || progress}
                            </div>
                        )}

                        {result.length > 0 ? (
                            <div className="space-y-1">
                                {result.map((row, idx) => (
                                    <div
                                        key={idx}
                                        className={`px-2 py-1 text-xs font-mono rounded ${row.every(cell => !cell) ? 'bg-red-50 text-red-400' : 'bg-slate-50 text-slate-700'}`}
                                    >
                                        <span className="text-slate-400 mr-2">{idx + 1}.</span>
                                        {row.every(cell => !cell)
                                            ? <span className="italic">未匹配: {baseRows[idx]}</span>
                                            : row.join(' | ')
                                        }
                                    </div>
                                ))}
                            </div>
                        ) : (
                            <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                <MoveVertical size={40} className="mb-3 opacity-30" />
                                <p className="text-sm">匹配结果将显示在这里</p>
                                <p className="text-xs mt-1">
                                    {matchMode === 'exact' ? '精确匹配：根据内容完全一致进行匹配' : 'AI 匹配：根据语义相似度智能匹配'}
                                </p>
                            </div>
                        )}
                    </div>

                    {(unmatchedBase.length > 0 || unmatchedMatch.length > 0) && (
                        <div className="border-t border-slate-100 px-3 py-2 bg-amber-50">
                            <div className="text-xs text-amber-700">
                                <span className="font-medium">⚠️ 未匹配项：</span>
                                {unmatchedBase.length > 0 && <span className="ml-2">基准列 {unmatchedBase.length} 行未找到匹配</span>}
                                {unmatchedMatch.length > 0 && <span className="ml-2">待匹配列 {unmatchedMatch.length} 行未被使用</span>}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* 使用说明 */}
            <div className="bg-white border-t border-slate-200 px-4 py-2">
                <div className="text-xs text-slate-500">
                    <span className="font-medium text-slate-600">使用说明：</span>
                    <span className="ml-2">
                        {matchMode === 'exact'
                            ? '1. 粘贴基准列（原始顺序） 2. 粘贴待匹配数据（从 Google Sheets 直接粘贴，支持多列） 3. 选择用于匹配的列 4. 点击匹配'
                            : '1. 粘贴基准列（原文） 2. 粘贴待匹配数据（翻译结果） 3. AI 会根据语义自动匹配对应关系'
                        }
                    </span>
                </div>
            </div>
        </div>
    );
}
