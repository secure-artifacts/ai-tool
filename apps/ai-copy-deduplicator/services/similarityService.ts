// 相似度检测服务
import { GoogleGenAI } from "@google/genai";
import { CopyItem, SimilarCopyItem, SimilarGroup, ExcludePatterns } from '../types';
import { v4 as uuidv4 } from 'uuid';

// Embedding 模型
const EMBEDDING_MODEL = 'text-embedding-004';

// 批量处理配置
const BATCH_SIZE = 100;        // 每批处理数量
const BATCH_DELAY_MS = 1000;   // 批次间延迟（避免 API 限流）

/**
 * 获取单个文本的 Embedding
 */
export async function getTextEmbedding(
    text: string,
    ai: GoogleGenAI
): Promise<number[]> {
    try {
        const result = await ai.models.embedContent({
            model: EMBEDDING_MODEL,
            contents: text,
        });
        return result.embeddings?.[0]?.values || [];
    } catch (error) {
        console.error('获取 Embedding 失败:', error);
        throw error;
    }
}

/**
 * 批量获取文本的 Embedding
 */
export async function batchGetEmbeddings(
    texts: string[],
    ai: GoogleGenAI,
    onProgress?: (current: number, total: number) => void
): Promise<number[][]> {
    const embeddings: number[][] = [];

    for (let i = 0; i < texts.length; i += BATCH_SIZE) {
        const batch = texts.slice(i, i + BATCH_SIZE);

        // 并行获取当前批次的 embeddings
        const batchPromises = batch.map(text => getTextEmbedding(text, ai));
        const batchResults = await Promise.all(batchPromises);
        embeddings.push(...batchResults);

        // 报告进度
        if (onProgress) {
            onProgress(Math.min(i + BATCH_SIZE, texts.length), texts.length);
        }

        // 批次间延迟，避免 API 限流
        if (i + BATCH_SIZE < texts.length) {
            await new Promise(resolve => setTimeout(resolve, BATCH_DELAY_MS));
        }
    }

    return embeddings;
}

/**
 * 计算两个向量的余弦相似度
 */
export function cosineSimilarity(vecA: number[], vecB: number[]): number {
    if (vecA.length !== vecB.length || vecA.length === 0) {
        return 0;
    }

    let dotProduct = 0;
    let normA = 0;
    let normB = 0;

    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }

    const denominator = Math.sqrt(normA) * Math.sqrt(normB);
    if (denominator === 0) return 0;

    return dotProduct / denominator;
}

/**
 * 预处理文本：使用关键词规则去除标题和互动语
 */
export function preprocessTextWithRules(
    text: string,
    patterns: ExcludePatterns
): string {
    let processed = text.trim();

    // 分割成行
    const lines = processed.split(/\n+/).map(line => line.trim()).filter(Boolean);
    if (lines.length === 0) return processed;

    // 检测并移除标题（第一行如果包含标题关键词）
    const firstLine = lines[0];
    const hasTitle = patterns.titleKeywords.some(kw => firstLine.includes(kw));
    if (hasTitle && lines.length > 1) {
        lines.shift();
    }

    // 检测并移除结尾互动语
    // 从最后一行开始向前检测，移除包含互动关键词的行
    while (lines.length > 1) {
        const lastLine = lines[lines.length - 1];
        const hasEnding = patterns.endingKeywords.some(kw => lastLine.includes(kw));
        if (hasEnding) {
            lines.pop();
        } else {
            break;
        }
    }

    return lines.join('\n');
}

/**
 * 使用 AI 智能预处理文本：识别并去除标题和互动语
 */
export async function preprocessTextWithAI(
    text: string,
    ai: GoogleGenAI
): Promise<string> {
    const prompt = `请分析以下文案，识别并去除其中的标题和结尾互动语，只保留核心内容。

规则：
1. 标题：通常在开头，可能有特殊符号包围（如【】、##等），或者是简短的主题概述
2. 结尾互动语：如"关注"、"点赞"、"收藏"、"转发"等引导互动的内容

请直接返回处理后的核心内容，不要有任何解释。

原始文案：
${text}`;

    try {
        const result = await ai.models.generateContent({
            model: 'gemini-2.0-flash',
            contents: prompt,
        });
        return result.text?.trim() || text;
    } catch (error) {
        console.error('AI 预处理失败，使用原文:', error);
        return text;
    }
}

/**
 * 预处理文本（根据配置选择规则或 AI）
 */
export async function preprocessText(
    text: string,
    patterns: ExcludePatterns,
    ai?: GoogleGenAI
): Promise<string> {
    // 先用规则预处理
    const ruleProcessed = preprocessTextWithRules(text, patterns);

    // 如果启用 AI 检测且提供了 AI 实例，进一步用 AI 处理
    // 注意：为了性能，批量处理时不建议每条都用 AI
    // 这里只在规则处理效果不明显时使用 AI
    if (patterns.useAiDetection && ai && ruleProcessed === text.trim()) {
        return preprocessTextWithAI(text, ai);
    }

    return ruleProcessed;
}

/**
 * 批量预处理文本
 */
export async function batchPreprocessTexts(
    texts: string[],
    patterns: ExcludePatterns
): Promise<string[]> {
    // 批量处理时只使用规则，不使用 AI（性能考虑）
    return texts.map(text => preprocessTextWithRules(text, patterns));
}

/**
 * 批次内去重：找出相似组
 * 使用 Union-Find 算法进行聚类
 * 
 * 相似度判定标准（三重验证）：
 * 1. 语义相似度（embedding 余弦相似度）- 意思是否相近
 * 2. 词汇重叠度（Jaccard）- 具体用词是否大量重复
 * 3. 长度差异惩罚 - 长度差异过大降低相似度
 * 
 * 只有三项都通过才判定为相似
 */

// 配置参数
const LENGTH_PENALTY_THRESHOLD = 0.3;  // 长度差异超过30%开始惩罚
const LENGTH_PENALTY_MAX = 0.6;        // 长度差异超过60%大幅惩罚
const LENGTH_PENALTY_WEIGHT = 0.5;     // 长度惩罚权重

const WORD_OVERLAP_MIN = 0.4;          // 词汇重叠度最少要40%才算相似
const WORD_OVERLAP_WEIGHT = 0.3;       // 词汇重叠度对最终相似度的影响权重

// 停用词（常见词，不参与重叠度计算）
const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
    'may', 'might', 'must', 'shall', 'can', 'need', 'dare', 'ought', 'used',
    'to', 'of', 'in', 'for', 'on', 'with', 'at', 'by', 'from', 'as', 'into',
    'through', 'during', 'before', 'after', 'above', 'below', 'between',
    'and', 'but', 'or', 'nor', 'so', 'yet', 'both', 'either', 'neither',
    'not', 'only', 'own', 'same', 'than', 'too', 'very', 'just', 'also',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'him', 'his', 'she', 'her',
    'it', 'its', 'they', 'them', 'their', 'this', 'that', 'these', 'those',
    'what', 'which', 'who', 'whom', 'whose', 'when', 'where', 'why', 'how',
    'all', 'each', 'every', 'any', 'some', 'no', 'none', 'one', 'two', 'three',
    'thank', 'thanks', 'god', 'jesus', 'lord', 'father', 'amen', 'pray', 'prayer' // 宗教通用词
]);

/**
 * 提取有意义的词汇（去除停用词和短词）
 */
function extractMeaningfulWords(text: string): Set<string> {
    const words = text.toLowerCase()
        .replace(/[^\w\s]/g, ' ')  // 移除标点
        .split(/\s+/)
        .filter(w => w.length > 3 && !STOP_WORDS.has(w));  // 只保留4字符以上且非停用词
    return new Set(words);
}

/**
 * 计算词汇重叠度（Jaccard 相似度）
 */
function calculateWordOverlap(text1: string, text2: string): number {
    const words1 = extractMeaningfulWords(text1);
    const words2 = extractMeaningfulWords(text2);

    if (words1.size === 0 || words2.size === 0) return 0;

    // 计算交集
    let intersection = 0;
    for (const word of words1) {
        if (words2.has(word)) intersection++;
    }

    // Jaccard: 交集 / 并集
    const union = words1.size + words2.size - intersection;
    return union > 0 ? intersection / union : 0;
}

/**
 * 计算综合相似度（语义 + 词汇重叠 + 长度）
 */
function calculateAdjustedSimilarity(
    semanticSim: number,
    text1: string,
    text2: string
): number {
    // 1. 计算词汇重叠度
    const wordOverlap = calculateWordOverlap(text1, text2);

    // 如果词汇重叠度太低，即使语义相似也不算相似
    if (wordOverlap < WORD_OVERLAP_MIN) {
        // 大幅降低相似度
        return semanticSim * (wordOverlap / WORD_OVERLAP_MIN) * 0.6;
    }

    // 2. 计算长度差异
    const len1 = text1.length;
    const len2 = text2.length;
    const maxLen = Math.max(len1, len2);
    const minLen = Math.min(len1, len2);

    let lengthPenalty = 1.0;
    if (maxLen > 0) {
        const lengthDiffRatio = (maxLen - minLen) / maxLen;

        if (lengthDiffRatio > LENGTH_PENALTY_MAX) {
            lengthPenalty = 0.5;
        } else if (lengthDiffRatio > LENGTH_PENALTY_THRESHOLD) {
            lengthPenalty = 1 - (lengthDiffRatio - LENGTH_PENALTY_THRESHOLD) /
                (LENGTH_PENALTY_MAX - LENGTH_PENALTY_THRESHOLD) * LENGTH_PENALTY_WEIGHT;
        }
    }

    // 3. 综合计算：语义相似度 * 长度惩罚，并加入词汇重叠度的加成
    const baseSim = semanticSim * lengthPenalty;

    // 词汇重叠度越高，给予一定加成（但不超过1）
    const overlapBonus = (wordOverlap - WORD_OVERLAP_MIN) / (1 - WORD_OVERLAP_MIN) * WORD_OVERLAP_WEIGHT;

    return Math.min(baseSim + overlapBonus * baseSim, 1.0);
}

export function findSimilarGroups(
    items: CopyItem[],
    threshold: number
): SimilarGroup[] {
    const n = items.length;
    if (n === 0) return [];

    // Union-Find 数据结构
    const parent: number[] = Array.from({ length: n }, (_, i) => i);
    const rank: number[] = new Array(n).fill(0);

    function find(x: number): number {
        if (parent[x] !== x) {
            parent[x] = find(parent[x]); // 路径压缩
        }
        return parent[x];
    }

    function union(x: number, y: number): void {
        const px = find(x);
        const py = find(y);
        if (px === py) return;

        if (rank[px] < rank[py]) {
            parent[px] = py;
        } else if (rank[px] > rank[py]) {
            parent[py] = px;
        } else {
            parent[py] = px;
            rank[px]++;
        }
    }

    // 记录每对的相似度
    const similarities: Map<string, number> = new Map();

    // 两两比较，相似的合并
    for (let i = 0; i < n; i++) {
        for (let j = i + 1; j < n; j++) {
            if (!items[i].embedding || !items[j].embedding) continue;

            // 1. 计算语义相似度
            const semanticSim = cosineSimilarity(items[i].embedding, items[j].embedding);

            // 2. 计算综合相似度（考虑长度差异）
            const adjustedSim = calculateAdjustedSimilarity(
                semanticSim,
                items[i].originalText,
                items[j].originalText
            );

            if (adjustedSim >= threshold) {
                union(i, j);
                similarities.set(`${i}-${j}`, adjustedSim);
                similarities.set(`${j}-${i}`, adjustedSim);
            }
        }
    }

    // 按根节点分组
    const groups: Map<number, number[]> = new Map();
    for (let i = 0; i < n; i++) {
        const root = find(i);
        if (!groups.has(root)) {
            groups.set(root, []);
        }
        groups.get(root)!.push(i);
    }

    // 构建相似组（只返回有多个成员的组）
    const result: SimilarGroup[] = [];

    for (const [rootIdx, memberIndices] of groups) {
        if (memberIndices.length === 1) {
            // 独特文案，也作为一个单独的组（只有代表文案，无相似项）
            result.push({
                id: uuidv4(),
                representative: items[memberIndices[0]],
                similarItems: [],
                maxSimilarity: 0,
            });
        } else {
            // 选择第一个作为代表（也可以选择最长的）
            const repIndex = memberIndices[0];
            const representative = items[repIndex];

            // 其他成员作为相似项
            const similarItems: SimilarCopyItem[] = memberIndices.slice(1).map(idx => {
                const sim = similarities.get(`${repIndex}-${idx}`) ||
                    similarities.get(`${idx}-${repIndex}`) ||
                    threshold;
                return {
                    ...items[idx],
                    similarity: sim,
                };
            });

            // 按相似度降序排列
            similarItems.sort((a, b) => b.similarity - a.similarity);

            result.push({
                id: uuidv4(),
                representative,
                similarItems,
                maxSimilarity: similarItems.length > 0 ? similarItems[0].similarity : 0,
            });
        }
    }

    // 按相似项数量降序排列（相似项多的排前面）
    result.sort((a, b) => b.similarItems.length - a.similarItems.length);

    return result;
}

/**
 * 与文案库比较，找出已存在的文案
 */
export function findLibraryMatches(
    newItems: CopyItem[],
    library: CopyItem[],
    threshold: number
): { matches: Map<string, { libraryItem: CopyItem; similarity: number }>; newUnique: CopyItem[] } {
    const matches: Map<string, { libraryItem: CopyItem; similarity: number }> = new Map();
    const newUnique: CopyItem[] = [];

    for (const item of newItems) {
        if (!item.embedding) {
            newUnique.push(item);
            continue;
        }

        let bestMatch: { libraryItem: CopyItem; similarity: number } | null = null;

        for (const libItem of library) {
            if (!libItem.embedding) continue;

            const sim = cosineSimilarity(item.embedding, libItem.embedding);
            if (sim >= threshold) {
                if (!bestMatch || sim > bestMatch.similarity) {
                    bestMatch = { libraryItem: libItem, similarity: sim };
                }
            }
        }

        if (bestMatch) {
            matches.set(item.id, bestMatch);
        } else {
            newUnique.push(item);
        }
    }

    return { matches, newUnique };
}

/**
 * 解析输入文本为文案数组
 * 
 * 支持两种输入格式：
 * 1. 单列：只有外文，每行一条
 * 2. 两列：第一列中文，第二列外文（用制表符分隔）
 * 
 * 使用正确的 CSV/TSV 解析逻辑处理：
 * - 引号包围的单元格（可能包含内部换行）
 * - 转义的引号 ""
 */
export interface ParsedCopyItem {
    chinese?: string;  // 中文（可选）
    foreign: string;   // 外文（用于对比）
}

export function parseInputText(text: string): ParsedCopyItem[] {
    const raw = text.trim();
    if (!raw) return [];

    // 使用正确的 CSV 解析逻辑（与 CopywritingView 相同）
    // 处理引号包围的单元格内换行
    let current = '';
    let inQuote = false;
    const lines: string[] = [];

    for (let i = 0; i < raw.length; i++) {
        const char = raw[i];
        const nextChar = raw[i + 1];

        if (char === '"') {
            if (inQuote && nextChar === '"') {
                // 转义的引号 "" -> "
                current += '"';
                i++;
            } else {
                // 切换引号状态
                inQuote = !inQuote;
            }
        } else if (!inQuote && (char === '\n' || char === '\r')) {
            // 不在引号内的换行符 - 行分隔
            if (current.trim()) {
                lines.push(current.trim());
            }
            current = '';
            // 跳过 \r\n 组合
            if (char === '\r' && nextChar === '\n') {
                i++;
            }
        } else {
            current += char;
        }
    }
    // 处理最后一行
    if (current.trim()) {
        lines.push(current.trim());
    }

    // 解析每行，检测是否有 Tab 分隔的两列
    const results: ParsedCopyItem[] = [];

    // 检测文本是否主要是中文
    const isChinese = (text: string): boolean => {
        if (!text) return false;
        const chineseChars = text.match(/[\u4e00-\u9fff]/g);
        const totalChars = text.replace(/\s/g, '').length;
        if (totalChars === 0) return false;
        return (chineseChars?.length || 0) / totalChars > 0.3;
    };

    for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 2) {
            const col1 = parts[0].trim();
            const col2 = parts[1].trim();
            if (col1.length > 0) {
                // 自动检测：如果第一列是中文、第二列是外文，则调换
                const firstIsChinese = isChinese(col1);
                const secondIsChinese = isChinese(col2);
                if (firstIsChinese && !secondIsChinese && col2.length > 0) {
                    // 调换：外文在前，中文在后
                    results.push({ foreign: col2, chinese: col1 });
                } else {
                    // 正常顺序
                    results.push({ foreign: col1, chinese: col2 });
                }
            }
        } else if (parts.length === 1 && parts[0].trim()) {
            // 单列：外文
            results.push({ foreign: parts[0].trim() });
        }
    }

    return results;
}
