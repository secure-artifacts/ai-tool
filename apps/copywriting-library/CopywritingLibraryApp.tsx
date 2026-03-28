/**
 * 超级文案库 - 从海量文案库中检索相似文案，分析规律，生成新文案
 * 
 * 核心流程：
 * 1. 从 Google Sheets 加载文案库 → MinHash 索引
 * 2. 用户输入文案 → MinHash 本地检索相似文案
 * 3. AI 分析规律 → AI 生成 N 条新文案
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { GoogleGenAI } from '@google/genai';
import { v4 as uuidv4 } from 'uuid';
import { MinHashDedupEngine, TextItem } from '../ai-copy-deduplicator/services/minHashEngine';
import { SheetLibraryService, extractSpreadsheetId, CategoryItem } from '../ai-copy-deduplicator/services/sheetLibraryService';
import './CopywritingLibraryApp.css';

// ==================== 类型定义 ====================

interface MatchedCopy {
    id: string;
    text: string;
    chineseText?: string;
    category?: string;
    similarity: number;
    selected: boolean;
}

interface GeneratedCopy {
    id: string;
    text: string;
    chineseText?: string;
}

interface PatternAnalysis {
    summary: string;
    patterns: string[];
}

type AppStep = 'idle' | 'searching' | 'results' | 'analyzing' | 'generating' | 'done';

// ==================== Props ====================

interface CopywritingLibraryAppProps {
    getAiInstance: () => GoogleGenAI;
    textModel: string;
}

// ==================== 组件 ====================

const CopywritingLibraryApp: React.FC<CopywritingLibraryAppProps> = ({ getAiInstance, textModel }) => {
    // --- 状态 ---
    const [step, setStep] = useState<AppStep>('idle');
    const [inputText, setInputText] = useState('');
    const [sheetUrl, setSheetUrl] = useState(() => localStorage.getItem('copyLibrary_sheetUrl') || '');
    const [sheetConnected, setSheetConnected] = useState(false);
    const [sheetTitle, setSheetTitle] = useState('');
    const [categories, setCategories] = useState<string[]>([]);
    const [selectedCategories, setSelectedCategories] = useState<Set<string>>(new Set());
    const [librarySize, setLibrarySize] = useState(0);
    const [loadingLibrary, setLoadingLibrary] = useState(false);
    const [loadProgress, setLoadProgress] = useState('');

    const [matches, setMatches] = useState<MatchedCopy[]>([]);
    const [noMatchMode, setNoMatchMode] = useState(false);
    const [threshold, setThreshold] = useState(0.3);
    const [maxResults, setMaxResults] = useState(20);

    const [analysis, setAnalysis] = useState<PatternAnalysis | null>(null);
    const [generateCount, setGenerateCount] = useState(5);
    const [generatedCopies, setGeneratedCopies] = useState<GeneratedCopy[]>([]);

    const [toast, setToast] = useState<string | null>(null);
    const [error, setError] = useState<string | null>(null);

    // --- Refs ---
    const engineRef = useRef<MinHashDedupEngine>(new MinHashDedupEngine({
        similarityThreshold: 0.3,
        shingleSize: 3,
        numHashFunctions: 128,
        numBands: 16
    }));
    const sheetServiceRef = useRef<SheetLibraryService | null>(null);

    // --- Toast ---
    const showToast = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 3000);
    }, []);

    // --- 连接 Google Sheets ---
    const connectSheet = useCallback(async () => {
        if (!sheetUrl.trim()) {
            setError('请输入 Google Sheets URL');
            return;
        }

        const spreadsheetId = extractSpreadsheetId(sheetUrl.trim());
        if (!spreadsheetId) {
            setError('无效的 Google Sheets URL');
            return;
        }

        setError(null);
        setLoadProgress('正在连接...');

        try {
            const service = new SheetLibraryService(spreadsheetId, 'apiKey');
            const info = await service.checkConnection();
            sheetServiceRef.current = service;

            setSheetTitle(info.title);
            const cats = await service.loadCategories();
            setCategories(cats);
            setSelectedCategories(new Set(cats));
            setSheetConnected(true);
            localStorage.setItem('copyLibrary_sheetUrl', sheetUrl.trim());
            setLoadProgress('');
            showToast(`✅ 已连接「${info.title}」，共 ${cats.length} 个分类`);
        } catch (e: any) {
            setError(`连接失败: ${e.message}`);
            setLoadProgress('');
        }
    }, [sheetUrl, showToast]);

    // --- 加载文案库到 MinHash 引擎 ---
    const loadLibrary = useCallback(async () => {
        if (!sheetServiceRef.current) return;
        if (selectedCategories.size === 0) {
            setError('请至少选择一个分类');
            return;
        }

        setLoadingLibrary(true);
        setError(null);
        engineRef.current.clearLibrary();

        const catsToLoad = Array.from(selectedCategories);
        let totalItems = 0;

        try {
            for (let i = 0; i < catsToLoad.length; i++) {
                const cat = catsToLoad[i];
                setLoadProgress(`正在加载分类 (${i + 1}/${catsToLoad.length}): ${cat}...`);

                const items = await sheetServiceRef.current.loadCategory(cat);

                // 转换为 TextItem 格式
                const textItems: TextItem[] = items
                    .filter(item => item.text?.trim())
                    .map(item => ({
                        id: item.id,
                        text: item.text,
                        chineseText: item.chineseText
                    }));

                if (textItems.length > 0) {
                    engineRef.current.addToLibrary(textItems);
                    totalItems += textItems.length;
                }

                setLibrarySize(totalItems);
            }

            setLoadProgress('');
            showToast(`✅ 文案库加载完成，共 ${totalItems.toLocaleString()} 条`);
        } catch (e: any) {
            setError(`加载失败: ${e.message}`);
            setLoadProgress('');
        } finally {
            setLoadingLibrary(false);
        }
    }, [selectedCategories, showToast]);

    // --- 搜索相似文案 ---
    const searchSimilar = useCallback(() => {
        if (!inputText.trim()) {
            setError('请输入要搜索的文案');
            return;
        }

        setError(null);
        setStep('searching');
        setMatches([]);
        setAnalysis(null);
        setGeneratedCopies([]);
        setNoMatchMode(false);

        // 如果没有加载文案库，直接进入无匹配模式
        if (librarySize === 0) {
            setNoMatchMode(true);
            setStep('results');
            showToast('文案库未加载，可直接使用 AI 分析生成');
            return;
        }

        // 使用 setTimeout 让 UI 有机会更新
        setTimeout(() => {
            try {
                const results = engineRef.current.searchLibrary(
                    [inputText.trim()],
                    { threshold, maxResults }
                );

                const searchResults = results[0];
                if (!searchResults || searchResults.matches.length === 0) {
                    setNoMatchMode(true);
                    setStep('results');
                    showToast('未找到相似文案，可直接使用 AI 分析生成');
                    return;
                }

                const matchedCopies: MatchedCopy[] = searchResults.matches.map(m => ({
                    id: m.item.id,
                    text: m.item.text,
                    chineseText: m.item.chineseText,
                    similarity: m.similarity,
                    selected: true
                }));

                setMatches(matchedCopies);
                setStep('results');
                showToast(`找到 ${matchedCopies.length} 条相似文案`);
            } catch (e: any) {
                setError(`搜索失败: ${e.message}`);
                setStep('idle');
            }
        }, 50);
    }, [inputText, librarySize, threshold, maxResults, showToast]);

    // --- AI 分析规律（通用：支持库匹配和无匹配模式）---
    const analyzePatterns = useCallback(async () => {
        const selectedMatches = matches.filter(m => m.selected);
        const isDirectMode = noMatchMode || selectedMatches.length === 0;

        if (!isDirectMode && selectedMatches.length === 0) {
            setError('请至少选择一条相似文案');
            return;
        }
        if (isDirectMode && !inputText.trim()) {
            setError('请输入要分析的文案');
            return;
        }

        setError(null);
        setStep('analyzing');

        try {
            const ai = getAiInstance();

            let prompt: string;
            if (isDirectMode) {
                // 无匹配模式：直接分析用户输入的文案
                prompt = `分析以下文案的写作风格、结构和特征，并总结出可复用的写作规律。

文案：
${inputText.trim()}

请分析并输出：
1. 【总结】一段话概括这条文案的风格、主题和特点
2. 【规律】逐条列出具体的写作规律（至少5条），包括：
   - 开头方式（如何吸引注意力）
   - 句式结构（排比、反问、短句等）
   - 情感基调
   - 修辞手法
   - 结尾方式
   - 用词特色
   - 节奏和韵律

输出格式：
总结: [一段话]
规律1: [具体规律]
规律2: [具体规律]
...`;
            } else {
                const copiesText = selectedMatches.map((m, i) => `[${i + 1}] ${m.text}`).join('\n\n');
                prompt = `分析以下 ${selectedMatches.length} 条同类文案的共同规律和特征。

文案列表：
${copiesText}

请分析并输出：
1. 【总结】一段话概括这些文案的共同风格、主题和特点
2. 【规律】逐条列出具体的写作规律（至少5条），包括：
   - 开头方式（如何吸引注意力）
   - 句式结构（排比、反问、短句等）
   - 情感基调
   - 修辞手法
   - 结尾方式
   - 用词特色
   - 节奏和韵律

输出格式：
总结: [一段话]
规律1: [具体规律]
规律2: [具体规律]
...`;
            }

            const result = await ai.models.generateContent({
                model: textModel,
                contents: { role: 'user', parts: [{ text: prompt }] },
                config: {
                    systemInstruction: '你是一个文案分析专家，善于从文案中提取写作规律和模式。请用中文回答。'
                }
            });

            const responseText = result.text?.trim() || '';

            // 解析结果
            const summaryMatch = responseText.match(/总结[:：]\s*(.+?)(?=\n规律|\n\*|$)/s);
            const patternMatches = responseText.match(/规律\d+[:：]\s*(.+)/g);

            const patterns: string[] = [];
            if (patternMatches) {
                for (const pm of patternMatches) {
                    const cleaned = pm.replace(/^规律\d+[:：]\s*/, '').trim();
                    if (cleaned) patterns.push(cleaned);
                }
            }

            // 如果没有按格式输出，就按行分割
            if (patterns.length === 0) {
                const lines = responseText.split('\n').filter(l => l.trim() && !l.startsWith('总结'));
                patterns.push(...lines.slice(0, 10));
            }

            setAnalysis({
                summary: summaryMatch ? summaryMatch[1].trim() : responseText.split('\n')[0],
                patterns
            });

            setStep('results');
            showToast('✅ 规律分析完成');
        } catch (e: any) {
            setError(`分析失败: ${e.message}`);
            setStep('results');
        }
    }, [matches, noMatchMode, inputText, getAiInstance, textModel, showToast]);

    // --- AI 生成新文案 ---
    const generateNewCopies = useCallback(async () => {
        if (!analysis) {
            setError('请先分析规律');
            return;
        }

        const selectedMatches = matches.filter(m => m.selected);
        setError(null);
        setStep('generating');

        try {
            const ai = getAiInstance();

            const examplesText = selectedMatches.length > 0 
                ? selectedMatches.slice(0, 5).map((m, i) => `示例${i + 1}: ${m.text}`).join('\n\n')
                : `原始文案: ${inputText.trim()}`;
            const patternsText = analysis.patterns.map((p, i) => `${i + 1}. ${p}`).join('\n');

            const prompt = `基于以下分析的文案规律，生成 ${generateCount} 条全新的同类文案。

【文案风格总结】
${analysis.summary}

【写作规律】
${patternsText}

【参考示例】
${examplesText}

【要求】
1. 严格遵循上述写作规律
2. 内容必须全新，不能抄袭示例
3. 保持与示例相同的语言（如果示例是英文就写英文，中文就写中文）
4. 每条文案都要有独特的主题和角度
5. 保持相似的长度和节奏

【输出格式】
每条文案用 === 分隔，只输出文案内容，不要编号和解释：
文案内容1
===
文案内容2
===
...`;

            const result = await ai.models.generateContent({
                model: textModel,
                contents: { role: 'user', parts: [{ text: prompt }] },
                config: {
                    systemInstruction: '你是一个顶尖文案创作专家，善于根据规律批量创作高质量文案。只输出文案本身，不要任何解释。'
                }
            });

            const responseText = result.text?.trim() || '';
            const copies = responseText
                .split('===')
                .map(s => s.trim())
                .filter(s => s.length > 10)
                .map(text => ({
                    id: uuidv4(),
                    text,
                    chineseText: undefined
                }));

            setGeneratedCopies(copies);
            setStep('done');
            showToast(`✅ 已生成 ${copies.length} 条新文案`);
        } catch (e: any) {
            setError(`生成失败: ${e.message}`);
            setStep('results');
        }
    }, [analysis, matches, generateCount, getAiInstance, textModel, showToast]);

    // --- 复制到剪贴板 ---
    const copyToClipboard = useCallback((text: string) => {
        navigator.clipboard.writeText(text);
        showToast('✅ 已复制');
    }, [showToast]);

    const copyAllGenerated = useCallback(() => {
        const text = generatedCopies.map(c => c.text).join('\n\n---\n\n');
        navigator.clipboard.writeText(text);
        showToast(`✅ 已复制 ${generatedCopies.length} 条文案`);
    }, [generatedCopies, showToast]);

    // --- 切换匹配项选中 ---
    const toggleMatchSelection = useCallback((id: string) => {
        setMatches(prev => prev.map(m =>
            m.id === id ? { ...m, selected: !m.selected } : m
        ));
    }, []);

    const selectAllMatches = useCallback((selected: boolean) => {
        setMatches(prev => prev.map(m => ({ ...m, selected })));
    }, []);

    // --- 渲染 ---
    return (
        <div className="copylib-app">
            {/* Header */}
            <div className="copylib-header">
                <div className="copylib-header-left">
                    <span className="material-symbols-outlined copylib-header-icon">library_books</span>
                    <h1>超级文案库</h1>
                    {librarySize > 0 && (
                        <span className="copylib-badge">{librarySize.toLocaleString()} 条</span>
                    )}
                </div>
            </div>

            <div className="copylib-content">
                {/* 左侧：设置 + 输入 */}
                <div className="copylib-sidebar">
                    {/* Google Sheets 连接 */}
                    <div className="copylib-section">
                        <h3>
                            <span className="material-symbols-outlined">cloud_sync</span>
                            文案库连接
                        </h3>
                        <div className="copylib-input-group">
                            <input
                                type="text"
                                value={sheetUrl}
                                onChange={e => setSheetUrl(e.target.value)}
                                placeholder="Google Sheets URL 或 ID"
                                className="copylib-input"
                            />
                            <button
                                onClick={connectSheet}
                                className="copylib-btn copylib-btn-secondary"
                                disabled={loadingLibrary}
                            >
                                {sheetConnected ? '重连' : '连接'}
                            </button>
                        </div>
                        {sheetConnected && (
                            <div className="copylib-connected-info">
                                <span className="copylib-connected-dot" />
                                {sheetTitle}
                            </div>
                        )}
                    </div>

                    {/* 分类选择 */}
                    {categories.length > 0 && (
                        <div className="copylib-section">
                            <h3>
                                <span className="material-symbols-outlined">category</span>
                                分类选择
                                <span className="copylib-section-count">{selectedCategories.size}/{categories.length}</span>
                            </h3>
                            <div className="copylib-categories">
                                <div className="copylib-cat-actions">
                                    <button onClick={() => setSelectedCategories(new Set(categories))} className="copylib-link-btn">全选</button>
                                    <button onClick={() => setSelectedCategories(new Set())} className="copylib-link-btn">取消</button>
                                </div>
                                {categories.map(cat => (
                                    <label key={cat} className="copylib-cat-item">
                                        <input
                                            type="checkbox"
                                            checked={selectedCategories.has(cat)}
                                            onChange={() => {
                                                setSelectedCategories(prev => {
                                                    const next = new Set(prev);
                                                    if (next.has(cat)) next.delete(cat);
                                                    else next.add(cat);
                                                    return next;
                                                });
                                            }}
                                        />
                                        {cat}
                                    </label>
                                ))}
                            </div>
                            <button
                                onClick={loadLibrary}
                                className="copylib-btn copylib-btn-primary copylib-btn-full"
                                disabled={loadingLibrary || selectedCategories.size === 0}
                            >
                                {loadingLibrary ? '加载中...' : `加载文案库 (${selectedCategories.size} 个分类)`}
                            </button>
                        </div>
                    )}

                    {/* 搜索参数 */}
                    <div className="copylib-section">
                        <h3>
                            <span className="material-symbols-outlined">tune</span>
                            搜索参数
                        </h3>
                        <div className="copylib-param">
                            <label>相似度阈值: {(threshold * 100).toFixed(0)}%</label>
                            <input
                                type="range"
                                min="0.1" max="0.9" step="0.05"
                                value={threshold}
                                onChange={e => setThreshold(parseFloat(e.target.value))}
                            />
                        </div>
                        <div className="copylib-param">
                            <label>最大结果数</label>
                            <input
                                type="number"
                                min="5" max="50"
                                value={maxResults}
                                onChange={e => setMaxResults(parseInt(e.target.value))}
                                className="copylib-input copylib-input-sm"
                            />
                        </div>
                        <div className="copylib-param">
                            <label>生成数量</label>
                            <input
                                type="number"
                                min="1" max="20"
                                value={generateCount}
                                onChange={e => setGenerateCount(parseInt(e.target.value))}
                                className="copylib-input copylib-input-sm"
                            />
                        </div>
                    </div>
                </div>

                {/* 右侧：主内容区 */}
                <div className="copylib-main">
                    {/* 输入区 */}
                    <div className="copylib-input-area">
                        <textarea
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            placeholder="粘贴一条文案，系统会从文案库中找出相似的文案，分析写作规律，并生成同类新文案..."
                            className="copylib-textarea"
                            rows={4}
                        />
                        <div className="copylib-input-actions">
                            <button
                                onClick={searchSimilar}
                                className="copylib-btn copylib-btn-primary"
                                disabled={step === 'searching' || step === 'analyzing' || step === 'generating'}
                            >
                                <span className="material-symbols-outlined">search</span>
                                {step === 'searching' ? '搜索中...' : (librarySize > 0 ? '搜索相似文案' : '开始分析')}
                            </button>
                            {(matches.length > 0 || noMatchMode) && (
                                <>
                                    <button
                                        onClick={analyzePatterns}
                                        className="copylib-btn copylib-btn-accent"
                                        disabled={step === 'analyzing' || step === 'generating'}
                                    >
                                        <span className="material-symbols-outlined">psychology</span>
                                        {step === 'analyzing' ? '分析中...' : (noMatchMode && matches.length === 0 ? 'AI 直接分析' : '分析规律')}
                                    </button>
                                    {analysis && (
                                        <button
                                            onClick={generateNewCopies}
                                            className="copylib-btn copylib-btn-success"
                                            disabled={step === 'generating'}
                                        >
                                            <span className="material-symbols-outlined">auto_awesome</span>
                                            {step === 'generating' ? '生成中...' : `生成 ${generateCount} 条`}
                                        </button>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {/* 进度提示 */}
                    {loadProgress && (
                        <div className="copylib-progress">
                            <span className="copylib-spinner" />
                            {loadProgress}
                        </div>
                    )}

                    {/* 错误提示 */}
                    {error && (
                        <div className="copylib-error">
                            <span className="material-symbols-outlined">error</span>
                            {error}
                            <button onClick={() => setError(null)} className="copylib-error-close">×</button>
                        </div>
                    )}

                    {/* 无匹配提示 */}
                    {noMatchMode && matches.length === 0 && step === 'results' && !analysis && (
                        <div className="copylib-no-match-info">
                            <span className="material-symbols-outlined">info</span>
                            {librarySize === 0
                                ? '未加载文案库 — 将直接使用 AI 分析你的文案并生成同类新文案'
                                : '文案库中未找到相似文案 — 可直接使用 AI 分析你的文案并生成同类新文案'
                            }
                        </div>
                    )}

                    {/* 相似文案结果 */}
                    {matches.length > 0 && (
                        <div className="copylib-results-section">
                            <div className="copylib-results-header">
                                <h3>
                                    <span className="material-symbols-outlined">content_paste_search</span>
                                    相似文案 ({matches.filter(m => m.selected).length}/{matches.length} 已选)
                                </h3>
                                <div className="copylib-results-actions">
                                    <button onClick={() => selectAllMatches(true)} className="copylib-link-btn">全选</button>
                                    <button onClick={() => selectAllMatches(false)} className="copylib-link-btn">取消</button>
                                </div>
                            </div>
                            <div className="copylib-matches-list">
                                {matches.map((m, idx) => (
                                    <div
                                        key={m.id}
                                        className={`copylib-match-item ${m.selected ? 'selected' : ''}`}
                                        onClick={() => toggleMatchSelection(m.id)}
                                    >
                                        <div className="copylib-match-header">
                                            <input
                                                type="checkbox"
                                                checked={m.selected}
                                                onChange={() => toggleMatchSelection(m.id)}
                                                onClick={e => e.stopPropagation()}
                                            />
                                            <span className="copylib-match-rank">#{idx + 1}</span>
                                            <span className="copylib-match-sim">{(m.similarity * 100).toFixed(0)}%</span>
                                            <button
                                                className="copylib-icon-btn"
                                                onClick={e => { e.stopPropagation(); copyToClipboard(m.text); }}
                                                title="复制"
                                            >
                                                <span className="material-symbols-outlined">content_copy</span>
                                            </button>
                                        </div>
                                        <div className="copylib-match-text">{m.text}</div>
                                        {m.chineseText && (
                                            <div className="copylib-match-chinese">{m.chineseText}</div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 规律分析 */}
                    {analysis && (
                        <div className="copylib-analysis-section">
                            <h3>
                                <span className="material-symbols-outlined">insights</span>
                                文案规律分析
                            </h3>
                            <div className="copylib-analysis-summary">{analysis.summary}</div>
                            <div className="copylib-analysis-patterns">
                                {analysis.patterns.map((p, i) => (
                                    <div key={i} className="copylib-pattern-item">
                                        <span className="copylib-pattern-num">{i + 1}</span>
                                        {p}
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 生成结果 */}
                    {generatedCopies.length > 0 && (
                        <div className="copylib-generated-section">
                            <div className="copylib-generated-header">
                                <h3>
                                    <span className="material-symbols-outlined">auto_awesome</span>
                                    生成结果 ({generatedCopies.length} 条)
                                </h3>
                                <button onClick={copyAllGenerated} className="copylib-btn copylib-btn-secondary copylib-btn-sm">
                                    <span className="material-symbols-outlined">copy_all</span>
                                    复制全部
                                </button>
                            </div>
                            <div className="copylib-generated-list">
                                {generatedCopies.map((c, idx) => (
                                    <div key={c.id} className="copylib-generated-item">
                                        <div className="copylib-generated-num">{idx + 1}</div>
                                        <div className="copylib-generated-text">{c.text}</div>
                                        <button
                                            className="copylib-icon-btn"
                                            onClick={() => copyToClipboard(c.text)}
                                            title="复制"
                                        >
                                            <span className="material-symbols-outlined">content_copy</span>
                                        </button>
                                    </div>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 空状态 */}
                    {step === 'idle' && matches.length === 0 && (
                        <div className="copylib-empty">
                            <span className="material-symbols-outlined copylib-empty-icon">library_books</span>
                            <p className="copylib-empty-title">超级文案库</p>
                            <p className="copylib-empty-desc">
                                {librarySize === 0
                                    ? '请先连接 Google Sheets 并加载文案库'
                                    : '粘贴一条文案，从库中找到相似文案，AI 分析规律并生成新文案'
                                }
                            </p>
                        </div>
                    )}
                </div>
            </div>

            {/* Toast */}
            {toast && <div className="copylib-toast">{toast}</div>}
        </div>
    );
};

export default CopywritingLibraryApp;
