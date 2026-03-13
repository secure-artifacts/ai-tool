import React, { useState, useMemo, useCallback, useRef } from 'react';
import { MapPin, Copy, Check, Trash2, BarChart3, Globe, ChevronLeft, ChevronRight, ChevronsLeft, ChevronsRight, Search, Download, X, Sparkles, Loader2 } from 'lucide-react';
import { classifyBatch, getStats, GeoResult } from './geoDict';
import { GoogleGenAI } from '@google/genai';

const PAGE_SIZE = 200;

const CONFIDENCE_LABELS: Record<string, { label: string; color: string }> = {
    high: { label: '高', color: 'text-emerald-400' },
    medium: { label: '中', color: 'text-amber-400' },
    low: { label: '低', color: 'text-orange-400' },
    ai: { label: 'AI', color: 'text-purple-400' },
    unknown: { label: '未识别', color: 'text-red-400' },
};

interface Props {
    getAiInstance?: () => GoogleGenAI;
}

export default function RegionClassifierApp({ getAiInstance }: Props) {
    const [results, setResults] = useState<GeoResult[]>([]);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAiProcessing, setIsAiProcessing] = useState(false);
    const [aiProgress, setAiProgress] = useState({ done: 0, total: 0 });
    const [progress, setProgress] = useState({ done: 0, total: 0 });
    const [currentPage, setCurrentPage] = useState(0);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [filterContinent, setFilterContinent] = useState<string | null>(null);
    const [filterCountry, setFilterCountry] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [showStats, setShowStats] = useState(true);
    const aiAbortRef = useRef(false);

    // AI 补全未识别地址
    const aiClassifyUnknowns = useCallback(async (allResults: GeoResult[]) => {
        if (!getAiInstance) return;
        const unknowns = allResults.filter(r => r.confidence === 'unknown');
        if (unknowns.length === 0) return;

        setIsAiProcessing(true);
        setAiProgress({ done: 0, total: unknowns.length });
        aiAbortRef.current = false;

        const BATCH = 500; // AI 每批 500 个
        const CONCURRENCY = 20; // 付费 API: 同时 20 个请求
        let doneCount = 0;

        const processBatch = async (batch: GeoResult[], ai: any) => {
            const prompt = `For each address, return [index, country, continent] as JSON array.

Rules:
- country: simplified Chinese ONLY, single name, e.g. "法国", "美国", "菲律宾", "日本"
- continent: use EXACTLY one of: "亚洲", "欧洲", "北美洲", "南美洲", "非洲", "大洋洲"
- unknown: use "未知" for both
- NO English, NO traditional Chinese, NO duplicates in names

Example output: [[0,"法国","欧洲"],[1,"美国","北美洲"]]

Addresses:
${batch.map((r, idx) => `${idx}: ${r.original}`).join('\n')}`;

            const batchMap = new Map<string, { country: string; continent: string }>();
            try {
                const response = await ai.models.generateContent({
                    model: 'gemini-3.1-flash-lite-preview',
                    contents: prompt,
                });
                const text = response.text || '';
                const jsonMatch = text.match(/\[[\s\S]*\]/);
                if (jsonMatch) {
                    const parsed = JSON.parse(jsonMatch[0]) as [number, string, string][];
                    // 洲名标准化映射
                    const continentMap: Record<string, string> = {
                        '亚洲': '亚洲', '欧洲': '欧洲',
                        '北美洲': '北美洲', '南美洲': '南美洲',
                        '非洲': '非洲', '大洋洲': '大洋洲',
                    };
                    for (const [idx, rawCountry, rawContinent] of parsed) {
                        if (idx >= 0 && idx < batch.length && rawCountry !== '未知') {
                            // 清理国家名：只取第一个中文词
                            const country = rawCountry.replace(/\s*([\u4e00-\u9fff]+).*/, '$1').trim();
                            const continent = continentMap[rawContinent] || rawContinent;
                            batchMap.set(batch[idx].original, { country, continent });
                        }
                    }
                }
            } catch (err) {
                console.warn('[AI Classify] Batch error:', err);
            }
            doneCount += batch.length;
            setAiProgress({ done: Math.min(doneCount, unknowns.length), total: unknowns.length });

            // 每批完成立即更新表格
            if (batchMap.size > 0) {
                setResults(prev => prev.map(r => {
                    const aiResult = batchMap.get(r.original);
                    if (aiResult && r.confidence === 'unknown') {
                        return { ...r, country: aiResult.country, continent: aiResult.continent, confidence: 'ai' as const };
                    }
                    return r;
                }));
            }
        };

        try {
            const ai = getAiInstance();
            const batches: GeoResult[][] = [];
            for (let i = 0; i < unknowns.length; i += BATCH) {
                batches.push(unknowns.slice(i, i + BATCH));
            }

            for (let i = 0; i < batches.length; i += CONCURRENCY) {
                if (aiAbortRef.current) break;
                const concurrent = batches.slice(i, i + CONCURRENCY);
                await Promise.all(concurrent.map(batch => processBatch(batch, ai)));
            }
        } catch (err) {
            console.error('[AI Classify] Error:', err);
        }

        setIsAiProcessing(false);
    }, [getAiInstance]);

    const handlePaste = useCallback(async (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        e.preventDefault();
        const plain = e.clipboardData.getData('text/plain');
        if (!plain.trim()) return;

        // 检测是否为三列数据（表头模式或数据模式）
        const lines = plain.split(/\r?\n/).filter(l => l.trim());
        let imported: GeoResult[] = [];
        let isThreeColumn = false;

        // 采样前 5 行，看看是否有大部分行包含至少 2 个 Tab
        const sampleSize = Math.min(lines.length, 5);
        let tabbedLines = 0;
        for (let i = 0; i < sampleSize; i++) {
            if ((lines[i].match(/\t/g) || []).length >= 2) tabbedLines++;
        }

        if (tabbedLines > sampleSize / 2) {
            isThreeColumn = true;
            for (const line of lines) {
                const parts = line.split('\t');
                if (parts.length >= 3) {
                    const original = parts[0].trim();
                    const country = parts[1].trim();
                    const continent = parts[2].trim();

                    // 跳过表头
                    if (original === '原始地址' || original === 'original') continue;

                    if (original) {
                        const cleanCountry = country.match(/[\u4e00-\u9fff]+/)?.[0] || country;
                        const cleanContinent = continent.match(/[\u4e00-\u9fff]+/)?.[0] || continent;
                        imported.push({
                            original,
                            country: cleanCountry,
                            countryCode: '',
                            continent: cleanContinent,
                            confidence: country && country !== '未知' ? 'ai' : 'unknown',
                        });
                    }
                }
            }
        }

        if (isThreeColumn && imported.length > 0) {
            // 合并时去重：保留已有的，加入新的
            setResults(prev => {
                const existingSet = new Set(prev.map(r => r.original));
                const newItems = imported.filter(r => !existingSet.has(r.original));
                return [...prev, ...newItems];
            });
            setCurrentPage(0);
            return;
        }

        // 单列格式：更鲁棒的行分割提取
        // 如果文本里有偶数个双引号，可能是 Excel 原生格式，用字符级解析
        // 否则（引号不匹配）直接按行分割，防止整个文本被吞掉
        const addresses: string[] = [];
        const quoteCount = (plain.match(/"/g) || []).length;

        if (quoteCount % 2 === 0) {
            let current = '';
            let inQuote = false;
            for (let i = 0; i < plain.length; i++) {
                const char = plain[i];
                const next = plain[i + 1];
                if (char === '"') {
                    if (inQuote && next === '"') { current += '"'; i++; }
                    else { inQuote = !inQuote; }
                } else if (!inQuote && (char === '\t' || char === '\n' || char === '\r')) {
                    if (current.trim()) addresses.push(current.trim());
                    current = '';
                    if (char === '\r' && next === '\n') i++;
                } else {
                    current += char;
                }
            }
            if (current.trim()) addresses.push(current.trim());
        } else {
            // 引号不匹配时，直接按换行符和 Tab 拆分
            const rawParts = plain.split(/[\r\n\t]+/);
            for (const part of rawParts) {
                if (part.trim()) addresses.push(part.trim());
            }
        }

        if (addresses.length === 0) return;

        setIsProcessing(true);
        setProgress({ done: 0, total: addresses.length });
        setCurrentPage(0);

        // 获取当前已有结果（用于去重）
        let currentResults: GeoResult[] = [];
        setResults(prev => {
            currentResults = prev;
            return prev;
        });

        // 对剪贴板提取出来的地址列表自身去重
        const uniqueAddresses = Array.from(new Set(addresses));

        // 过滤掉已经在表格里的结果
        const existingOriginals = new Set(currentResults.map(r => r.original));
        const newAddresses = uniqueAddresses.filter(a => !existingOriginals.has(a));

        if (newAddresses.length === 0) {
            setIsProcessing(false);
            return;
        }

        // 把进度条总数设置为实际要处理的新地址数量
        setProgress({ done: 0, total: newAddresses.length });

        const classified = await classifyBatch(newAddresses, (done, total) => {
            setProgress({ done, total });
        });

        setResults(prev => [...prev, ...classified]);
        setIsProcessing(false);

        // 自动触发 AI 补全 (仅对未知项)
        const unknownCount = classified.filter(r => r.confidence === 'unknown').length;
        if (unknownCount > 0 && getAiInstance) {
            requestAnimationFrame(() => {
                // 读取完整的新 state 再传给 AI
                setResults(latestResults => {
                    aiClassifyUnknowns(latestResults);
                    return latestResults;
                });
            });
        }
    }, [aiClassifyUnknowns, getAiInstance]);

    // 手动触发 AI 补全
    const handleAiClassify = useCallback(() => {
        aiClassifyUnknowns(results);
    }, [results, aiClassifyUnknowns]);

    // 统计
    const stats = useMemo(() => results.length > 0 ? getStats(results) : null, [results]);
    const unknownCount = useMemo(() => results.filter(r => r.confidence === 'unknown').length, [results]);

    // 过滤
    const filteredResults = useMemo(() => {
        let r = results;
        if (filterContinent) r = r.filter(item => item.continent === filterContinent);
        if (filterCountry) r = r.filter(item => item.country === filterCountry);
        if (searchQuery) {
            const q = searchQuery.toLowerCase();
            r = r.filter(item => item.original.toLowerCase().includes(q) || item.country.toLowerCase().includes(q));
        }
        return r;
    }, [results, filterContinent, filterCountry, searchQuery]);

    const totalPages = Math.ceil(filteredResults.length / PAGE_SIZE);
    const pageResults = filteredResults.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

    const handleCopy = useCallback((text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 1500);
    }, []);

    // 复制：三列格式 (原始数据 \t 国家 \t 洲)
    const handleCopyAll = useCallback((mode: 'tsv' | 'countries' | 'continents') => {
        let text = '';
        const data = filteredResults.length > 0 ? filteredResults : results;
        if (mode === 'tsv') {
            text = data.map(r => `${r.original}\t${r.country}\t${r.continent}`).join('\n');
        } else if (mode === 'countries') {
            const cs = new Map<string, number>();
            data.forEach(r => { if (r.confidence !== 'unknown') cs.set(r.country, (cs.get(r.country) || 0) + 1); });
            text = Array.from(cs.entries()).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}\t${n}`).join('\n');
        } else {
            const cs = new Map<string, number>();
            data.forEach(r => { if (r.confidence !== 'unknown') cs.set(r.continent, (cs.get(r.continent) || 0) + 1); });
            text = Array.from(cs.entries()).sort((a, b) => b[1] - a[1]).map(([c, n]) => `${c}\t${n}`).join('\n');
        }
        handleCopy(text, `copy-${mode}`);
    }, [filteredResults, results, handleCopy]);

    // 清理国名（不重新跑 AI）
    const handleCleanNames = useCallback(() => {
        const continentMap: Record<string, string> = {
            '亚洲': '亚洲', '欧洲': '欧洲',
            '北美洲': '北美洲', '南美洲': '南美洲',
            '非洲': '非洲', '大洋洲': '大洋洲',
        };
        setResults(prev => prev.map(r => {
            if (r.confidence === 'unknown') return r;
            // 清理国家名：提取第一个中文词组
            let country = r.country;
            const cnMatch = country.match(/[\u4e00-\u9fff]+/);
            if (cnMatch) country = cnMatch[0];
            // 清理洲名
            let continent = r.continent;
            const cnContinentMatch = continent.match(/[\u4e00-\u9fff]+/);
            if (cnContinentMatch) {
                continent = continentMap[cnContinentMatch[0]] || continent;
            }
            return { ...r, country, continent };
        }));
    }, []);

    const handleClear = useCallback(() => {
        setResults([]);
        setCurrentPage(0);
        setFilterContinent(null);
        setFilterCountry(null);
        setSearchQuery('');
        aiAbortRef.current = true;
    }, []);

    const handleExportCSV = useCallback(() => {
        const data = filteredResults.length > 0 ? filteredResults : results;
        const csv = '\uFEFF原始地址,国家,洲\n' + data.map(r =>
            `"${r.original.replace(/"/g, '""')}","${r.country}","${r.continent}"`
        ).join('\n');
        const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = `地区分类_${new Date().toISOString().split('T')[0]}.csv`;
        a.click();
    }, [filteredResults, results]);

    return (
        <div className="h-full flex flex-col bg-zinc-950 text-zinc-200 overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/50 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="p-2 bg-gradient-to-br from-cyan-500/20 to-blue-500/20 rounded-lg border border-cyan-500/20">
                        <Globe size={20} className="text-cyan-400" />
                    </div>
                    <div>
                        <h1 className="text-base font-bold text-zinc-100">地区分类工具</h1>
                        <p className="text-[0.6875rem] text-zinc-500">粘贴地址 → 字典秒级识别 + AI 自动补全未识别</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {/* AI 补全状态 */}
                    {isAiProcessing && (
                        <div className="flex items-center gap-2 px-3 py-1.5 text-xs bg-purple-500/10 border border-purple-500/20 rounded-lg text-purple-400">
                            <Loader2 size={12} className="animate-spin" />
                            AI 补全中 {aiProgress.done}/{aiProgress.total}
                            <button onClick={() => { aiAbortRef.current = true; }} className="ml-1 hover:text-red-400"><X size={12} /></button>
                        </div>
                    )}
                    {/* 手动 AI 补全按钮 */}
                    {!isAiProcessing && unknownCount > 0 && getAiInstance && (
                        <button onClick={handleAiClassify}
                            className="px-3 py-1.5 text-xs bg-purple-500/10 hover:bg-purple-500/20 text-purple-400 rounded-lg border border-purple-500/20 transition-colors flex items-center gap-1.5">
                            <Sparkles size={14} /> AI 补全 ({unknownCount})
                        </button>
                    )}
                    {results.length > 0 && (
                        <>
                            <button onClick={() => setShowStats(!showStats)}
                                className={`px-3 py-1.5 text-xs rounded-lg border transition-colors flex items-center gap-1.5 ${showStats ? 'bg-cyan-500/10 border-cyan-500/30 text-cyan-400' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'}`}>
                                <BarChart3 size={14} /> 统计
                            </button>
                            <button onClick={handleClear}
                                className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-red-900/30 text-zinc-400 hover:text-red-400 rounded-lg border border-zinc-700 transition-colors flex items-center gap-1.5">
                                <Trash2 size={14} /> 清空
                            </button>
                        </>
                    )}
                </div>
            </div>

            {/* Paste Area */}
            {results.length === 0 && !isProcessing && (
                <div className="flex-1 flex items-center justify-center p-8">
                    <div className="w-full max-w-2xl">
                        <div className="border-2 border-dashed border-zinc-700 hover:border-cyan-500/50 rounded-2xl p-12 text-center transition-colors">
                            <MapPin size={48} className="mx-auto mb-4 text-zinc-600" />
                            <h2 className="text-lg font-bold text-zinc-300 mb-2">粘贴地址数据</h2>
                            <p className="text-sm text-zinc-500 mb-6">从 Google Sheets/Excel 复制地址列，直接在此粘贴</p>
                            <textarea
                                className="w-full h-32 bg-zinc-900 border border-zinc-700 rounded-xl p-4 text-sm text-zinc-200 focus:outline-none focus:border-cyan-500 resize-none placeholder-zinc-600"
                                placeholder={"在这里粘贴... 支持 Tab/换行 分隔的批量地址\n例如:\nNew York, USA\n东京都 港区\nLondon, UK"}
                                onPaste={handlePaste}
                                readOnly
                            />
                            <div className="flex items-center justify-center gap-4 mt-4 text-xs text-zinc-600">
                                <span>📖 本地字典秒级识别</span>
                                <span>✨ AI 自动补全未匹配项</span>
                                <span>📋 结果三列：原始数据 | 国家 | 洲</span>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Processing */}
            {isProcessing && (
                <div className="flex-1 flex items-center justify-center">
                    <div className="text-center">
                        <div className="w-48 h-2 bg-zinc-800 rounded-full overflow-hidden mb-3">
                            <div className="h-full bg-gradient-to-r from-cyan-500 to-blue-500 rounded-full transition-all duration-150"
                                style={{ width: `${progress.total > 0 ? (progress.done / progress.total * 100) : 0}%` }} />
                        </div>
                        <p className="text-sm text-zinc-400">字典匹配中... {progress.done.toLocaleString()} / {progress.total.toLocaleString()}</p>
                    </div>
                </div>
            )}

            {/* Results */}
            {results.length > 0 && !isProcessing && (
                <div className="flex-1 flex flex-col overflow-hidden">
                    {/* Stats */}
                    {showStats && stats && (
                        <div className="shrink-0 px-4 py-3 border-b border-zinc-800 bg-zinc-900/30">
                            <div className="grid grid-cols-2 gap-4">
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wide">按洲分布</h3>
                                        <button onClick={() => handleCopyAll('continents')}
                                            className="text-[0.625rem] text-zinc-500 hover:text-cyan-400 flex items-center gap-1 transition-colors">
                                            {copiedId === 'copy-continents' ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />} 复制
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {stats.byContinent.map(([name, count]) => (
                                            <button key={name}
                                                onClick={() => { setFilterContinent(filterContinent === name ? null : name); setFilterCountry(null); setCurrentPage(0); }}
                                                className={`px-2 py-1 text-[0.625rem] rounded-md border transition-colors ${filterContinent === name ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'}`}>
                                                {name.split(' ')[0]} <span className="font-mono ml-1">{count.toLocaleString()}</span>
                                            </button>
                                        ))}
                                        {stats.unknown > 0 && (
                                            <span className="px-2 py-1 text-[0.625rem] rounded-md bg-red-900/20 border border-red-900/30 text-red-400">
                                                未识别 <span className="font-mono ml-1">{stats.unknown.toLocaleString()}</span>
                                            </span>
                                        )}
                                    </div>
                                </div>
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <h3 className="text-xs font-bold text-zinc-400 uppercase tracking-wide">按国家 Top 15</h3>
                                        <button onClick={() => handleCopyAll('countries')}
                                            className="text-[0.625rem] text-zinc-500 hover:text-cyan-400 flex items-center gap-1 transition-colors">
                                            {copiedId === 'copy-countries' ? <Check size={10} className="text-emerald-400" /> : <Copy size={10} />} 复制
                                        </button>
                                    </div>
                                    <div className="flex flex-wrap gap-1.5">
                                        {stats.byCountry.slice(0, 15).map(([name, count]) => (
                                            <button key={name}
                                                onClick={() => { setFilterCountry(filterCountry === name ? null : name); setFilterContinent(null); setCurrentPage(0); }}
                                                className={`px-2 py-1 text-[0.625rem] rounded-md border transition-colors ${filterCountry === name ? 'bg-cyan-500/20 border-cyan-500/40 text-cyan-300' : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:bg-zinc-700'}`}>
                                                {name.split(' ')[0]} <span className="font-mono ml-1">{count.toLocaleString()}</span>
                                            </button>
                                        ))}
                                    </div>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* Toolbar */}
                    <div className="shrink-0 flex items-center justify-between px-4 py-2 border-b border-zinc-800 bg-zinc-900/20">
                        <div className="flex items-center gap-3">
                            {(filterContinent || filterCountry) && (
                                <div className="flex items-center gap-1.5 text-xs text-cyan-400">
                                    <span>过滤:</span>
                                    {filterContinent && <span className="bg-cyan-500/15 px-2 py-0.5 rounded border border-cyan-500/30">{filterContinent.split(' ')[0]}</span>}
                                    {filterCountry && <span className="bg-cyan-500/15 px-2 py-0.5 rounded border border-cyan-500/30">{filterCountry.split(' ')[0]}</span>}
                                    <button onClick={() => { setFilterContinent(null); setFilterCountry(null); setCurrentPage(0); }}
                                        className="p-0.5 hover:bg-zinc-700 rounded"><X size={12} /></button>
                                </div>
                            )}
                            <div className="relative">
                                <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-zinc-500" />
                                <input type="text" value={searchQuery}
                                    onChange={e => { setSearchQuery(e.target.value); setCurrentPage(0); }}
                                    placeholder="搜索地址..."
                                    className="pl-7 pr-2 py-1 text-xs bg-zinc-800 border border-zinc-700 rounded text-zinc-300 w-40 focus:outline-none focus:border-cyan-500" />
                            </div>
                            <span className="text-xs text-zinc-500">
                                {filteredResults.length === results.length
                                    ? `共 ${results.length.toLocaleString()} 条`
                                    : `筛选 ${filteredResults.length.toLocaleString()} / ${results.length.toLocaleString()} 条`}
                            </span>
                        </div>
                        <div className="flex items-center gap-2">
                            <div className="relative">
                                <textarea className="absolute inset-0 w-full h-full opacity-0 cursor-pointer" onPaste={handlePaste} readOnly />
                                <button className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg border border-zinc-700 transition-colors flex items-center gap-1.5">
                                    <MapPin size={12} /> 粘贴更多
                                </button>
                            </div>
                            <button onClick={() => handleCopyAll('tsv')}
                                className="px-3 py-1.5 text-xs bg-cyan-500/10 hover:bg-cyan-500/20 text-cyan-400 rounded-lg border border-cyan-500/20 transition-colors flex items-center gap-1.5">
                                {copiedId === 'copy-tsv' ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                                复制三列结果
                            </button>
                            <button onClick={handleExportCSV}
                                className="px-3 py-1.5 text-xs bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-lg border border-zinc-700 transition-colors flex items-center gap-1.5">
                                <Download size={12} /> CSV
                            </button>
                        </div>
                    </div>

                    {/* Table */}
                    <div className="flex-1 overflow-auto custom-scrollbar">
                        <table className="w-full text-sm">
                            <thead className="sticky top-0 bg-zinc-900 z-10">
                                <tr className="border-b border-zinc-800">
                                    <th className="text-left py-2 px-3 text-zinc-500 font-medium text-xs w-12">#</th>
                                    <th className="text-left py-2 px-3 text-zinc-500 font-medium text-xs">原始数据</th>
                                    <th className="text-left py-2 px-3 text-zinc-500 font-medium text-xs w-44">国家</th>
                                    <th className="text-left py-2 px-3 text-zinc-500 font-medium text-xs w-36">洲</th>
                                    <th className="text-left py-2 px-3 text-zinc-500 font-medium text-xs w-16">来源</th>
                                </tr>
                            </thead>
                            <tbody>
                                {pageResults.map((r, i) => {
                                    const globalIdx = currentPage * PAGE_SIZE + i;
                                    const conf = CONFIDENCE_LABELS[r.confidence] || CONFIDENCE_LABELS.unknown;
                                    return (
                                        <tr key={globalIdx} className="border-b border-zinc-800/50 hover:bg-zinc-800/30 transition-colors">
                                            <td className="py-1.5 px-3 text-zinc-600 font-mono text-xs">{globalIdx + 1}</td>
                                            <td className="py-1.5 px-3 text-zinc-300 text-xs truncate max-w-[400px]" title={r.original}>{r.original}</td>
                                            <td className="py-1.5 px-3 text-zinc-300 text-xs font-medium">{r.country}</td>
                                            <td className="py-1.5 px-3 text-zinc-400 text-xs">{r.continent}</td>
                                            <td className={`py-1.5 px-3 text-xs font-medium ${conf.color}`}>{conf.label}</td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* Pagination */}
                    {totalPages > 1 && (
                        <div className="shrink-0 flex items-center justify-center gap-2 py-2 px-4 border-t border-zinc-800 bg-zinc-900/30">
                            <button onClick={() => setCurrentPage(0)} disabled={currentPage === 0}
                                className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded disabled:opacity-20 transition-colors">
                                <ChevronsLeft size={14} />
                            </button>
                            <button onClick={() => setCurrentPage(p => Math.max(0, p - 1))} disabled={currentPage === 0}
                                className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded disabled:opacity-20 transition-colors">
                                <ChevronLeft size={14} />
                            </button>
                            <span className="text-xs text-zinc-400 font-mono px-3">
                                {currentPage + 1} / {totalPages}
                                <span className="text-zinc-600 ml-2">
                                    ({(currentPage * PAGE_SIZE + 1).toLocaleString()}-{Math.min((currentPage + 1) * PAGE_SIZE, filteredResults.length).toLocaleString()})
                                </span>
                            </span>
                            <button onClick={() => setCurrentPage(p => Math.min(totalPages - 1, p + 1))} disabled={currentPage >= totalPages - 1}
                                className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded disabled:opacity-20 transition-colors">
                                <ChevronRight size={14} />
                            </button>
                            <button onClick={() => setCurrentPage(totalPages - 1)} disabled={currentPage >= totalPages - 1}
                                className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded disabled:opacity-20 transition-colors">
                                <ChevronsRight size={14} />
                            </button>
                        </div>
                    )}
                </div>
            )}
        </div>
    );
}
