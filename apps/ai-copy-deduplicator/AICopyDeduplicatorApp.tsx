// 文案去重主应用组件
import React, { useState, useEffect, useCallback, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import {
    FileText,
    Search,
    Database,
    Download,
    Trash2,
    Settings,
    ChevronDown,
    ChevronRight,
    AlertCircle,
    CheckCircle,
    Loader2,
    Copy,
    X
} from 'lucide-react';
import {
    CopyItem,
    SimilarGroup,
    DeduplicationResult,
    CopyDedupState,
    initialCopyDedupState,
    ExcludePatterns,
    DEFAULT_JUDGE_PROMPT
} from './types';
import {
    parseInputText,
    batchPreprocessTexts,
    batchGetEmbeddings,
    findSimilarGroups,
    findLibraryMatches,
} from './services/similarityService';
import {
    judgeWithAI,
    CopyItemForJudge,
    AIJudgeResult,
} from './services/aiJudgeService';
import {
    loadLibrary,
    saveLibrary,
    addToLibrary,
    clearLibrary,
    getLibraryStats,
} from './services/libraryService';

/**
 * 高亮显示两段文本中完全相同的短句
 * @param text 当前文本
 * @param compareText 与之对比的文本
 * @returns React 元素，完全相同的短句用高亮样式标记
 */
function highlightSimilarWords(text: string, compareText: string): React.ReactNode {
    if (!text || !compareText) return text || '';

    // 按标点符号分割成短句（保留分隔符）
    const splitPattern = /([.,!?;:，。！？；：]+)/;
    const phrases1 = text.split(splitPattern);
    const phrases2 = compareText.toLowerCase().split(splitPattern);

    // 创建对比短句集合（小写，去除首尾空格）
    const compareSet = new Set(
        phrases2
            .filter(p => p.trim().length > 3 && !/^[.,!?;:，。！？；：]+$/.test(p))
            .map(p => p.toLowerCase().trim())
    );

    const result: React.ReactNode[] = [];

    for (let i = 0; i < phrases1.length; i++) {
        const phrase = phrases1[i];
        const phraseLower = phrase.toLowerCase().trim();

        // 如果是标点符号，直接添加
        if (/^[.,!?;:，。！？；：]+$/.test(phrase) || phraseLower.length <= 3) {
            result.push(phrase);
        } else if (compareSet.has(phraseLower)) {
            // 完全相同的短句 - 高亮
            result.push(
                <span key={`phrase-${i}`} className="highlight-similar">
                    {phrase}
                </span>
            );
        } else {
            // 不同的短句 - 普通显示
            result.push(phrase);
        }
    }

    return result;
}

interface AICopyDeduplicatorAppProps {
    getAiInstance: () => GoogleGenAI;
    textModel?: string;
}

export default function AICopyDeduplicatorApp({ getAiInstance, textModel = 'gemini-2.0-flash' }: AICopyDeduplicatorAppProps) {
    const [state, setState] = useState<CopyDedupState>(() => {
        const saved = initialCopyDedupState;
        saved.library = loadLibrary();
        return saved;
    });
    const [toast, setToast] = useState<string | null>(null);

    const processingRef = useRef(false);

    // Toast 提示
    const showToast = useCallback((msg: string) => {
        setToast(msg);
        setTimeout(() => setToast(null), 2000);
    }, []);

    // 更新状态的辅助函数
    const updateState = useCallback((updates: Partial<CopyDedupState>) => {
        setState(prev => ({ ...prev, ...updates }));
    }, []);

    // 核心处理流程
    const processDeduplication = async () => {
        if (processingRef.current || !state.inputText.trim()) return;

        processingRef.current = true;
        const startTime = Date.now();

        try {
            updateState({
                isProcessing: true,
                processingProgress: 0,
                processingStatus: '解析输入文案...',
                result: null,
            });

            const ai = getAiInstance();

            // 1. 解析输入（支持两列：中文+外文）
            const parsedItems = parseInputText(state.inputText);

            // 调试：打印原始输入和解析结果

            if (parsedItems.length === 0) {
                throw new Error('未检测到有效文案');
            }

            // 检测是否是双列模式
            const hasChinese = parsedItems.some(item => item.chinese);

            updateState({
                processingProgress: 10,
                processingStatus: `解析到 ${parsedItems.length} 条文案，正在预处理...`,
            });

            // 2. 预处理：只处理外文部分
            const foreignTexts = parsedItems.map(item => item.foreign);
            const processedTexts = await batchPreprocessTexts(foreignTexts, state.excludePatterns);

            // 3. 创建 CopyItem 数组（外文用于对比，中文用于显示）
            const items: CopyItem[] = parsedItems.map((parsed, i) => ({
                id: uuidv4(),
                originalText: parsed.foreign,        // 外文用于对比
                chineseText: parsed.chinese,         // 中文用于显示
                processedText: processedTexts[i],
                addedAt: Date.now(),
                source: `batch-${Date.now()}`,
            }));

            updateState({
                processingProgress: 20,
                processingStatus: 'AI 正在分析文案相似度...',
            });

            // 4. 使用 AI 判断相似度（核心改变！）
            const aiItems: CopyItemForJudge[] = items.map((item, i) => ({
                id: item.id,
                index: i,
                text: item.originalText,
                chineseText: item.chineseText,
            }));

            const aiResult = await judgeWithAI(
                aiItems,
                ai,
                textModel,
                state.customPrompt,
                (current, total, status) => {
                    const progress = 20 + Math.round((current / total) * 60);
                    updateState({
                        processingProgress: progress,
                        processingStatus: status,
                    });
                }
            );

            updateState({
                processingProgress: 85,
                processingStatus: '正在整理结果...',
            });

            // 5. 根据 AI 结果构建相似组
            const similarGroups: SimilarGroup[] = [];

            // 处理重复组
            for (const group of aiResult.duplicateGroups) {
                const keepItem = items[group.keepIndex];
                const removeItems = group.removeIndices.map(idx => ({
                    ...items[idx],
                    similarity: 0.9, // AI 判定为重复
                }));

                similarGroups.push({
                    id: uuidv4(),
                    representative: keepItem,
                    similarItems: removeItems,
                    maxSimilarity: 0.9,
                    aiReason: group.reason,
                });
            }

            // 处理独特文案（每个独立成一组，没有相似项）
            // 优先使用 uniqueItems（带原因），否则使用 uniqueIndices
            const uniqueItemsWithReason = aiResult.uniqueItems || [];
            const uniqueIndicesSet = new Set(aiResult.uniqueIndices);

            // 从 uniqueItems 获取原因的映射
            const uniqueReasonMap = new Map<number, string>();
            uniqueItemsWithReason.forEach(item => {
                uniqueReasonMap.set(item.index, item.reason);
            });

            for (const idx of uniqueIndicesSet) {
                // 检查这个索引是否已经在某个重复组中作为 keepIndex
                const alreadyInGroup = aiResult.duplicateGroups.some(g => g.keepIndex === idx);
                if (!alreadyInGroup) {
                    similarGroups.push({
                        id: uuidv4(),
                        representative: items[idx],
                        similarItems: [],
                        maxSimilarity: 0,
                        aiReason: uniqueReasonMap.get(idx) || '独特文案',
                    });
                }
            }

            // 6. 收集代表文案
            const representativeItems = similarGroups.map(g => g.representative);

            updateState({
                processingProgress: 90,
                processingStatus: '正在与文案库对比...',
            });

            // 7. 与文案库对比（简化版，不用 embedding）
            const libraryMatchResult: { newItemId: string; libraryItem: CopyItem; similarity: number }[] = [];
            const newUnique = representativeItems; // 暂时不做库对比

            const result: DeduplicationResult = {
                similarGroups: similarGroups,
                libraryMatches: libraryMatchResult,
                newUniqueItems: newUnique,
                stats: {
                    totalInput: parsedItems.length,
                    uniqueNew: newUnique.length,
                    batchSimilarGroups: similarGroups.filter(g => g.similarItems.length > 0).length,
                    libraryExists: libraryMatchResult.length,
                    processingTime: Date.now() - startTime,
                },
            };

            updateState({
                processingProgress: 100,
                processingStatus: '处理完成！',
                result,
                isProcessing: false,
            });

        } catch (error) {
            console.error('处理失败:', error);
            updateState({
                isProcessing: false,
                processingStatus: `处理失败: ${error instanceof Error ? error.message : '未知错误'}`,
            });
        } finally {
            processingRef.current = false;
        }
    };

    // 保存新文案到库
    const saveToLibrary = () => {
        if (!state.result) return;

        // 只保存不在库中的代表文案
        const newItems = state.result.newUniqueItems;
        if (newItems.length === 0) {
            showToast('没有新的独特文案需要保存');
            return;
        }

        const newLibrary = addToLibrary(state.library, newItems);
        updateState({ library: newLibrary });
        showToast(`已保存 ${newItems.length} 条新文案到文案库`);
    };

    // 转义表格内容（处理换行、Tab、引号）
    const escapeForSheet = (text: string): string => {
        const t = text || '';
        if (t.includes('\t') || t.includes('\n') || t.includes('\r') || t.includes('"')) {
            return `"${t.replace(/"/g, '""')}"`;
        }
        return t;
    };

    // 导出结果为表格格式（所有文案：英文一列、中文一列）
    const exportAsTable = () => {
        if (!state.result) return;

        const { similarGroups } = state.result;
        if (similarGroups.length === 0) {
            showToast('没有数据可导出');
            return;
        }

        // 表头：英文 + 中文
        const headers = ['英文', '中文'];

        // 数据行：所有文案（代表 + 相似的）
        const rows: string[][] = [];
        similarGroups.forEach(group => {
            // 代表文案
            rows.push([
                escapeForSheet(group.representative.originalText),
                escapeForSheet(group.representative.chineseText || '')
            ]);
            // 相似文案
            group.similarItems.forEach(item => {
                rows.push([
                    escapeForSheet(item.originalText),
                    escapeForSheet(item.chineseText || '')
                ]);
            });
        });

        // 转换为 TSV 格式
        const tsv = [headers.join('\t'), ...rows.map(row => row.join('\t'))].join('\n');

        // 复制到剪贴板
        navigator.clipboard.writeText(tsv).then(() => {
            showToast(`已复制 ${rows.length} 条文案`);
        });
    };

    // 只导出英文（独特文案）
    const exportUniqueOnly = () => {
        if (!state.result) return;

        const uniqueTexts = state.result.similarGroups.map(g => escapeForSheet(g.representative.originalText));
        const text = uniqueTexts.join('\n');

        navigator.clipboard.writeText(text).then(() => {
            showToast(`已复制 ${uniqueTexts.length} 条文案`);
        });
    };

    // 切换某组的代表文案
    const swapRepresentative = (groupId: string, newRepId: string) => {
        if (!state.result) return;

        const newGroups = state.result.similarGroups.map(group => {
            if (group.id !== groupId) return group;

            // 找到要交换的项
            const newRepIndex = group.similarItems.findIndex(item => item.id === newRepId);
            if (newRepIndex === -1) return group;

            const newRep = group.similarItems[newRepIndex];
            const oldRep = group.representative;

            // 交换
            const newSimilarItems = [...group.similarItems];
            newSimilarItems[newRepIndex] = {
                ...oldRep,
                similarity: newRep.similarity, // 保持相似度不变
            };

            return {
                ...group,
                representative: {
                    id: newRep.id,
                    originalText: newRep.originalText,
                    chineseText: newRep.chineseText,  // 保留中文
                    processedText: newRep.processedText,
                    embedding: newRep.embedding,
                    addedAt: newRep.addedAt,
                    source: newRep.source,
                },
                similarItems: newSimilarItems,
            };
        });

        updateState({
            result: {
                ...state.result,
                similarGroups: newGroups,
            },
        });
    };

    // 删除整组
    const deleteGroup = (groupId: string) => {
        if (!state.result) return;

        const newGroups = state.result.similarGroups.filter(g => g.id !== groupId);
        updateState({
            result: {
                ...state.result,
                similarGroups: newGroups,
            },
        });
    };

    // 清空文案库
    const handleClearLibrary = () => {
        if (!confirm('确定要清空文案库吗？此操作不可恢复。')) return;
        clearLibrary();
        updateState({ library: [] });
    };

    const libraryStats = getLibraryStats(state.library);

    return (
        <div className="copy-dedup-app">
            {/* 头部 */}
            <div className="copy-dedup-header">
                <div className="copy-dedup-title">
                    <FileText size={24} />
                    <h2>文案去重工具</h2>
                </div>
                <div className="copy-dedup-header-actions">
                    <button
                        className="copy-dedup-btn secondary"
                        onClick={() => updateState({ showLibraryPanel: !state.showLibraryPanel })}
                    >
                        <Database size={16} />
                        文案库 ({state.library.length})
                    </button>
                </div>
            </div>

            {/* 文案库面板 */}
            {state.showLibraryPanel && (
                <div className="copy-dedup-library-panel">
                    <div className="library-panel-header">
                        <h3>文案库管理</h3>
                        <button
                            className="close-btn"
                            onClick={() => updateState({ showLibraryPanel: false })}
                        >
                            <X size={16} />
                        </button>
                    </div>
                    <div className="library-stats">
                        <div className="stat-item">
                            <span className="stat-label">总数</span>
                            <span className="stat-value">{libraryStats.totalCount}</span>
                        </div>
                        <div className="stat-item">
                            <span className="stat-label">平均长度</span>
                            <span className="stat-value">{libraryStats.averageLength} 字</span>
                        </div>
                        {libraryStats.newestDate && (
                            <div className="stat-item">
                                <span className="stat-label">最新入库</span>
                                <span className="stat-value">
                                    {libraryStats.newestDate.toLocaleDateString()}
                                </span>
                            </div>
                        )}
                    </div>
                    <div className="library-actions">
                        <button
                            className="copy-dedup-btn danger"
                            onClick={handleClearLibrary}
                            disabled={state.library.length === 0}
                        >
                            <Trash2 size={14} />
                            清空文案库
                        </button>
                    </div>
                </div>
            )}

            {/* AI 指令设置弹框 */}
            {state.showSettings && (
                <div className="copy-dedup-modal-overlay" onClick={() => updateState({ showSettings: false })}>
                    <div className="copy-dedup-modal" onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3>AI 判断指令</h3>
                            <button className="close-btn" onClick={() => updateState({ showSettings: false })}>
                                <X size={16} />
                            </button>
                        </div>
                        <textarea
                            className="prompt-editor"
                            value={state.customPrompt}
                            onChange={(e) => updateState({ customPrompt: e.target.value })}
                            placeholder="输入 AI 判断指令..."
                            rows={12}
                        />
                        <div className="modal-footer">
                            <button
                                className="copy-dedup-btn secondary"
                                onClick={() => { updateState({ customPrompt: DEFAULT_JUDGE_PROMPT }); showToast('已恢复默认'); }}
                            >
                                恢复默认
                            </button>
                            <button
                                className="copy-dedup-btn primary"
                                onClick={() => updateState({ showSettings: false })}
                            >
                                确定
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 紧凑输入区域 */}
            <div className="copy-dedup-compact-input">
                <div className="compact-input-row">
                    {/* 左侧：AI 指令按钮 */}
                    <button
                        className="copy-dedup-btn secondary compact"
                        onClick={() => updateState({ showSettings: true })}
                    >
                        <Settings size={14} />
                        AI 指令
                    </button>

                    {/* 中间：输入框 */}
                    <div className="compact-textarea-wrapper">
                        <textarea
                            className="compact-textarea"
                            placeholder="粘贴文案（每行一条 或 从表格复制）"
                            value={state.inputText}
                            onChange={(e) => updateState({ inputText: e.target.value })}
                            disabled={state.isProcessing}
                            rows={2}
                        />
                        {state.inputText.trim() && (
                            <span className="input-count">
                                约 {state.inputText.trim().split('\n').filter(l => l.trim()).length} 条
                            </span>
                        )}
                    </div>

                    {/* 右侧：开始按钮 */}
                    <button
                        className="copy-dedup-btn primary compact"
                        onClick={processDeduplication}
                        disabled={state.isProcessing || !state.inputText.trim()}
                    >
                        {state.isProcessing ? (
                            <>
                                <Loader2 size={14} className="spinning" />
                                {state.processingProgress}%
                            </>
                        ) : (
                            <>
                                <Search size={14} />
                                开始检测
                            </>
                        )}
                    </button>
                </div>

                {/* 进度状态（紧凑） */}
                {state.isProcessing && (
                    <div className="compact-progress">
                        <div className="compact-progress-bar">
                            <div className="compact-progress-fill" style={{ width: `${state.processingProgress}%` }} />
                        </div>
                        <span className="compact-progress-text">{state.processingStatus}</span>
                    </div>
                )}
            </div>

            {/* 结果区域 */}
            {state.result && (
                <div className="copy-dedup-results">
                    {/* 统计 + 操作放一行 */}
                    <div className="results-header-row">
                        <div className="results-stats">
                            <div className="stat-card">
                                <span className="stat-number">{state.result.stats.totalInput}</span>
                                <span className="stat-label">输入</span>
                            </div>
                            <div className="stat-card success">
                                <span className="stat-number">{state.result.stats.uniqueNew}</span>
                                <span className="stat-label">独特</span>
                            </div>
                            <div className="stat-card warning">
                                <span className="stat-number">{state.result.stats.batchSimilarGroups}</span>
                                <span className="stat-label">相似</span>
                            </div>
                            <div className="stat-card danger">
                                <span className="stat-number">{state.result.stats.libraryExists}</span>
                                <span className="stat-label">已存在</span>
                            </div>
                            <div className="stat-card info">
                                <span className="stat-number">{(state.result.stats.processingTime / 1000).toFixed(1)}s</span>
                                <span className="stat-label">耗时</span>
                            </div>
                        </div>
                        <div className="results-actions">
                            <button className="copy-dedup-btn primary compact" onClick={exportAsTable}>
                                <Download size={12} /> 导出表格
                            </button>
                            <button className="copy-dedup-btn secondary compact" onClick={exportUniqueOnly}>
                                <Copy size={12} /> 只导出独特
                            </button>
                            <button className="copy-dedup-btn success compact" onClick={saveToLibrary}>
                                <Database size={12} /> 保存到库
                            </button>
                        </div>
                    </div>

                    {/* 结果表格 */}
                    <div className="results-table-container">
                        <table className="results-table">
                            <thead>
                                <tr>
                                    <th className="col-index">#</th>
                                    <th className="col-reason">判定原因</th>
                                    <th className="col-representative">保留文案 ✅</th>
                                    {Array.from({ length: Math.max(...state.result.similarGroups.map(g => g.similarItems.length), 0) }).map((_, i) => (
                                        <th key={i} className="col-similar">
                                            相似文案 {i + 1}
                                        </th>
                                    ))}
                                    <th className="col-actions">操作</th>
                                </tr>
                            </thead>
                            <tbody>
                                {state.result.similarGroups.map((group, index) => {
                                    // 使用 AI 判断的理由
                                    const isUnique = group.similarItems.length === 0;
                                    let reasonText = '';
                                    let reasonClass = '';

                                    if (isUnique) {
                                        reasonText = '✅ 独特文案';
                                        reasonClass = 'reason-unique';
                                    } else {
                                        reasonText = `⚠️ 有${group.similarItems.length}条重复`;
                                        reasonClass = 'reason-similar';
                                    }

                                    return (
                                        <tr key={group.id} className={group.similarItems.length > 0 ? 'has-similar' : ''}>
                                            <td className="col-index">{index + 1}</td>
                                            <td className="col-reason">
                                                <div className={`reason-badge ${reasonClass}`}>
                                                    {reasonText}
                                                </div>
                                                {group.aiReason && group.aiReason !== '独特文案' && (
                                                    <div className="reason-detail">
                                                        {group.aiReason}
                                                    </div>
                                                )}
                                            </td>
                                            <td className="col-representative">
                                                <div className="copy-row">
                                                    <div className="copy-text">
                                                        {group.similarItems.length > 0
                                                            ? highlightSimilarWords(
                                                                group.representative.originalText,
                                                                group.similarItems[0].originalText
                                                            )
                                                            : group.representative.originalText
                                                        }
                                                    </div>
                                                    {group.representative.chineseText && (
                                                        <div className="copy-chinese">
                                                            {group.similarItems.length > 0
                                                                ? highlightSimilarWords(
                                                                    group.representative.chineseText,
                                                                    group.similarItems[0].chineseText || ''
                                                                )
                                                                : group.representative.chineseText
                                                            }
                                                        </div>
                                                    )}
                                                </div>
                                            </td>
                                            {Array.from({ length: Math.max(...state.result!.similarGroups.map(g => g.similarItems.length), 0) }).map((_, i) => {
                                                const similarItem = group.similarItems[i];
                                                return (
                                                    <td key={i} className="col-similar">
                                                        {similarItem ? (
                                                            <div
                                                                className="similar-item"
                                                                onClick={() => swapRepresentative(group.id, similarItem.id)}
                                                                title="点击设为保留文案"
                                                            >
                                                                <div className="copy-row">
                                                                    <div className="copy-text">
                                                                        {highlightSimilarWords(
                                                                            similarItem.originalText,
                                                                            group.representative.originalText
                                                                        )}
                                                                    </div>
                                                                    {similarItem.chineseText && (
                                                                        <div className="copy-chinese">
                                                                            {highlightSimilarWords(
                                                                                similarItem.chineseText,
                                                                                group.representative.chineseText || ''
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </div>
                                                                <span className="similarity-badge">
                                                                    {Math.round(similarItem.similarity * 100)}%
                                                                </span>
                                                            </div>
                                                        ) : null}
                                                    </td>
                                                );
                                            })}
                                            <td className="col-actions">
                                                <button
                                                    className="delete-btn"
                                                    onClick={() => deleteGroup(group.id)}
                                                    title="删除整组"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </td>
                                        </tr>
                                    );
                                })}
                            </tbody>
                        </table>
                    </div>

                    {/* 库中已存在的提示 */}
                    {state.result.libraryMatches.length > 0 && (
                        <div className="library-matches-section">
                            <h4>
                                <AlertCircle size={16} />
                                以下 {state.result.libraryMatches.length} 条文案与库中已有文案相似，已自动排除：
                            </h4>
                            <div className="library-matches-list">
                                {state.result.libraryMatches.slice(0, 10).map(match => (
                                    <div key={match.newItemId} className="library-match-item">
                                        <span className="similarity-badge danger">
                                            {Math.round(match.similarity * 100)}%
                                        </span>
                                        <span className="match-text" title={match.libraryItem.originalText}>
                                            匹配库文案: {match.libraryItem.originalText.slice(0, 50)}...
                                        </span>
                                    </div>
                                ))}
                                {state.result.libraryMatches.length > 10 && (
                                    <div className="more-hint">
                                        还有 {state.result.libraryMatches.length - 10} 条...
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>
            )}

            {/* Toast 提示 */}
            {toast && (
                <div className="copy-dedup-toast">{toast}</div>
            )}
        </div>
    );
}
