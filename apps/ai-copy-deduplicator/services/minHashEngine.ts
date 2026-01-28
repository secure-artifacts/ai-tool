/**
 * MinHash + LSH 查重引擎
 * 
 * 商业级文本查重算法，支持：
 * - 批次内互查
 * - 新文案 vs 历史库
 * - 毫秒级处理数万条文案
 */

// ==================== 类型定义 ====================

export interface TextItem {
    id: string;
    text: string;           // 原始文本（英文）
    chineseText?: string;   // 中文翻译（可选，用于显示）
}

export interface MinHashSignature {
    id: string;
    signature: number[];    // MinHash 签名（固定长度数组）
    shingles: Set<string>;  // 原始 shingles（用于精确计算）
}

export interface SimilarPair {
    id1: string;
    id2: string;
    similarity: number;     // Jaccard 相似度 (0-1)
}

export interface DedupResult {
    uniqueItems: TextItem[];           // 独特文案
    duplicateGroups: DuplicateGroup[]; // 重复组
    libraryMatches: LibraryMatch[];    // 库中已存在的
    stats: {
        totalInput: number;
        uniqueCount: number;
        duplicateCount: number;
        libraryMatchCount: number;
        processingTimeMs: number;
    };
}

export interface DuplicateGroup {
    representative: TextItem;          // 代表文案（保留的）
    duplicates: Array<{
        item: TextItem;
        similarity: number;
    }>;
}

export interface LibraryMatch {
    newItem: TextItem;
    libraryItem: TextItem;
    similarity: number;
    matchCount: number;  // 库中有多少条相似的
}

// ==================== 配置 ====================

const DEFAULT_CONFIG = {
    numHashFunctions: 128,   // MinHash 签名长度（越大越精确，但更慢）
    shingleSize: 3,          // N-gram 大小（3-5 适合英文）
    numBands: 16,            // LSH 分段数（越大越敏感）
    similarityThreshold: 0.7 // 相似度阈值 (0-1)
};

// ==================== 工具函数 ====================

/**
 * 常见的全大写标题模式（会被移除）
 */
const TITLE_PATTERNS = [
    /^[A-Z\s\-!?.,:]+(?=\s+[A-Z][a-z])/,  // 开头全大写直到第一个正常单词
    /^(THE\s+)?MOST\s+POWERFUL\s+PRAYER[^\n]*/i,
    /^(PRAYER|BLESSING|MESSAGE|ANNOUNCEMENT)[^\n]*/i,
    /^DEAR\s+(GOD|LORD|JESUS|FATHER)[,:]?\s*/i,
];

/**
 * 常见的结尾互动语模式（会被移除）
 */
const ENDING_PATTERNS = [
    /\b(amen|hallelujah)\b\.?\s*$/i,
    /\b(share|like|comment|subscribe|follow)\s+(this|if|and)\b.*$/i,
    /\bput\s+(a\s+)?(strong\s+)?["']?amen["']?.*$/i,
    /\bwatch\s+what\s+(he|god|the\s+lord)\s+will\s+do.*$/i,
    /\bif\s+you\s+(love|believe|agree|are\s+grateful).*$/i,
    /\bdon['']t\s+forget\s+to\s+(send|share|like).*$/i,
    /\bto\s+shame\s+satan.*$/i,
    /\btype\s+["']?amen["']?.*$/i,
    /\bsay\s+["']?amen["']?.*$/i,
];

/**
 * 移除标题部分
 */
function removeTitle(text: string): string {
    let result = text;

    for (const pattern of TITLE_PATTERNS) {
        result = result.replace(pattern, '');
    }

    return result.trim();
}

/**
 * 移除结尾互动语
 */
function removeEnding(text: string): string {
    let result = text;
    let prevLength = 0;

    // 循环移除，直到没有更多匹配
    while (result.length !== prevLength) {
        prevLength = result.length;
        for (const pattern of ENDING_PATTERNS) {
            result = result.replace(pattern, '').trim();
        }
    }

    return result;
}

/**
 * 文本预处理：去标题、去结尾互动语、小写、去标点、规范化空格
 */
function preprocessText(text: string): string {
    // 1. 移除标题
    let processed = removeTitle(text);

    // 2. 移除结尾互动语
    processed = removeEnding(processed);

    // 3. 标准化处理
    return processed
        .toLowerCase()
        .replace(/[^\w\s]/g, ' ')  // 去除标点
        .replace(/\s+/g, ' ')       // 规范化空格
        .trim();
}

/**
 * 生成 Shingles (N-grams)
 * 例如: "hello world" with n=3 → {"hel", "ell", "llo", "lo ", "o w", " wo", "wor", "orl", "rld"}
 */
function generateShingles(text: string, n: number = DEFAULT_CONFIG.shingleSize): Set<string> {
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

/**
 * 简单的哈希函数生成器
 * 使用不同的参数生成多个哈希函数
 */
function createHashFunction(a: number, b: number, prime: number): (x: number) => number {
    return (x: number) => ((a * x + b) % prime);
}

/**
 * 字符串转数字哈希
 */
function stringHash(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
        const char = str.charCodeAt(i);
        hash = ((hash << 5) - hash) + char;
        hash = hash & hash; // Convert to 32bit integer
    }
    return Math.abs(hash);
}

// ==================== MinHash 核心 ====================

/**
 * 生成 MinHash 签名
 */
function generateMinHashSignature(
    shingles: Set<string>,
    numHashFunctions: number = DEFAULT_CONFIG.numHashFunctions
): number[] {
    const LARGE_PRIME = 2147483647; // 2^31 - 1
    const signature: number[] = new Array(numHashFunctions).fill(Infinity);

    // 预生成哈希函数参数
    const hashParams: Array<{ a: number; b: number }> = [];
    for (let i = 0; i < numHashFunctions; i++) {
        hashParams.push({
            a: (i * 1103515245 + 12345) % LARGE_PRIME,
            b: (i * 134775813 + 1) % LARGE_PRIME
        });
    }

    // 对每个 shingle 计算所有哈希，保留最小值
    shingles.forEach(shingle => {
        const shingleHash = stringHash(shingle);

        for (let i = 0; i < numHashFunctions; i++) {
            const { a, b } = hashParams[i];
            const hashValue = ((a * shingleHash + b) % LARGE_PRIME);
            if (hashValue < signature[i]) {
                signature[i] = hashValue;
            }
        }
    });

    return signature;
}

/**
 * 计算两个 MinHash 签名的 Jaccard 相似度估计
 */
function estimateJaccardFromSignatures(sig1: number[], sig2: number[]): number {
    if (sig1.length !== sig2.length) {
        throw new Error('Signatures must have same length');
    }

    let matches = 0;
    for (let i = 0; i < sig1.length; i++) {
        if (sig1[i] === sig2[i]) {
            matches++;
        }
    }

    return matches / sig1.length;
}

/**
 * 精确计算 Jaccard 相似度（用于验证）
 */
function exactJaccard(set1: Set<string>, set2: Set<string>): number {
    const intersection = new Set([...set1].filter(x => set2.has(x)));
    const union = new Set([...set1, ...set2]);

    if (union.size === 0) return 0;
    return intersection.size / union.size;
}

// ==================== LSH (局部敏感哈希) ====================

type BandHash = string;
type LSHIndex = Map<BandHash, string[]>; // bandHash → item IDs

/**
 * 构建 LSH 索引
 */
function buildLSHIndex(
    signatures: Map<string, number[]>,
    numBands: number = DEFAULT_CONFIG.numBands
): LSHIndex[] {
    const rowsPerBand = Math.floor(DEFAULT_CONFIG.numHashFunctions / numBands);
    const bandIndices: LSHIndex[] = [];

    // 初始化每个 band 的索引
    for (let b = 0; b < numBands; b++) {
        bandIndices.push(new Map());
    }

    // 将每个签名分割到各个 band
    signatures.forEach((signature, id) => {
        for (let b = 0; b < numBands; b++) {
            const start = b * rowsPerBand;
            const end = start + rowsPerBand;
            const bandSlice = signature.slice(start, end);

            // 将 band 片段转为哈希键
            const bandHash = bandSlice.join(',');

            const bucket = bandIndices[b].get(bandHash) || [];
            bucket.push(id);
            bandIndices[b].set(bandHash, bucket);
        }
    });

    return bandIndices;
}

/**
 * 使用 LSH 索引查找候选相似对
 */
function findCandidatePairs(bandIndices: LSHIndex[]): Set<string> {
    const candidatePairs = new Set<string>();

    for (const bandIndex of bandIndices) {
        bandIndex.forEach((ids) => {
            if (ids.length > 1) {
                // 同一个桶中的所有 ID 两两配对
                for (let i = 0; i < ids.length; i++) {
                    for (let j = i + 1; j < ids.length; j++) {
                        // 用排序后的 ID 组合作为键，避免重复
                        const pair = [ids[i], ids[j]].sort().join('|||');
                        candidatePairs.add(pair);
                    }
                }
            }
        });
    }

    return candidatePairs;
}

// ==================== 查重引擎 ====================

export class MinHashDedupEngine {
    private config: typeof DEFAULT_CONFIG;
    private librarySignatures: Map<string, MinHashSignature> = new Map();
    private libraryItems: Map<string, TextItem> = new Map();

    constructor(config: Partial<typeof DEFAULT_CONFIG> = {}) {
        this.config = { ...DEFAULT_CONFIG, ...config };
    }

    /**
     * 获取当前库中的项目数量
     */
    getLibrarySize(): number {
        return this.libraryItems.size;
    }

    /**
     * 添加文案到库中
     */
    addToLibrary(items: TextItem[]): void {
        for (const item of items) {
            if (this.libraryItems.has(item.id)) continue;

            const shingles = generateShingles(item.text, this.config.shingleSize);
            const signature = generateMinHashSignature(shingles, this.config.numHashFunctions);

            this.librarySignatures.set(item.id, {
                id: item.id,
                signature,
                shingles
            });
            this.libraryItems.set(item.id, item);
        }
    }

    /**
     * 从库中移除文案
     */
    removeFromLibrary(ids: string[]): void {
        for (const id of ids) {
            this.librarySignatures.delete(id);
            this.libraryItems.delete(id);
        }
    }

    /**
     * 清空库
     */
    clearLibrary(): void {
        this.librarySignatures.clear();
        this.libraryItems.clear();
    }

    /**
     * 搜索库中与查询文本相似的项目（使用 MinHash 算法，与查重一致）
     */
    searchLibrary(
        queryTexts: string[],
        options: { threshold?: number; maxResults?: number } = {}
    ): Array<{
        query: string;
        matches: Array<{ item: TextItem; similarity: number }>;
    }> {
        const threshold = options.threshold ?? this.config.similarityThreshold;
        const maxResults = options.maxResults ?? 20;

        return queryTexts.map(queryText => {
            // 预处理查询文本
            const processed = preprocessText(queryText);
            if (!processed) {
                return { query: queryText, matches: [] };
            }

            // 生成查询的 shingles（与查重库匹配使用相同算法）
            const queryShingles = generateShingles(processed, this.config.shingleSize);
            if (queryShingles.size === 0) {
                return { query: queryText, matches: [] };
            }

            // 与库中每个项目比较（使用精确 Jaccard，与查重库匹配一致）
            const matches: Array<{ item: TextItem; similarity: number }> = [];

            for (const [id, libSig] of this.librarySignatures) {
                // 精确计算 Jaccard 相似度（与查重库匹配算法完全一致）
                const similarity = exactJaccard(queryShingles, libSig.shingles);

                if (similarity >= threshold) {
                    const item = this.libraryItems.get(id);
                    if (item) {
                        matches.push({ item, similarity });
                    }
                }
            }

            // 按相似度排序，取前 N 个
            matches.sort((a, b) => b.similarity - a.similarity);
            return {
                query: queryText,
                matches: matches.slice(0, maxResults)
            };
        });
    }

    /**
     * 导出库数据（用于持久化）
     */
    exportLibrary(): TextItem[] {
        return Array.from(this.libraryItems.values());
    }

    /**
     * 导入库数据
     */
    importLibrary(items: TextItem[]): void {
        this.clearLibrary();
        this.addToLibrary(items);
    }

    /**
     * 执行查重
     */
    dedup(
        newItems: TextItem[],
        options: {
            threshold?: number;
            checkLibrary?: boolean;
        } = {}
    ): DedupResult {
        const startTime = performance.now();
        const threshold = options.threshold ?? this.config.similarityThreshold;
        const checkLibrary = options.checkLibrary ?? true;

        // 1. 为新项目生成签名
        const newSignatures = new Map<string, MinHashSignature>();
        const newItemsMap = new Map<string, TextItem>();

        for (const item of newItems) {
            const shingles = generateShingles(item.text, this.config.shingleSize);
            const signature = generateMinHashSignature(shingles, this.config.numHashFunctions);

            newSignatures.set(item.id, {
                id: item.id,
                signature,
                shingles
            });
            newItemsMap.set(item.id, item);
        }

        // 2. 批次内互查 - 使用 LSH 加速
        const batchSignatures = new Map<string, number[]>();
        newSignatures.forEach((sig, id) => batchSignatures.set(id, sig.signature));

        const bandIndices = buildLSHIndex(batchSignatures, this.config.numBands);
        const candidatePairs = findCandidatePairs(bandIndices);

        // 3. 验证候选对的实际相似度
        const similarPairs: SimilarPair[] = [];

        candidatePairs.forEach(pairKey => {
            const [id1, id2] = pairKey.split('|||');
            const sig1 = newSignatures.get(id1);
            const sig2 = newSignatures.get(id2);

            if (sig1 && sig2) {
                // 使用精确 Jaccard 计算
                const similarity = exactJaccard(sig1.shingles, sig2.shingles);

                if (similarity >= threshold) {
                    similarPairs.push({ id1, id2, similarity });
                }
            }
        });

        // 4. 构建重复组（使用 Union-Find）
        const duplicateGroups = this.buildDuplicateGroups(similarPairs, newItemsMap);

        // 5. 获取独特项目（不在任何重复组中）
        const duplicatedIds = new Set<string>();
        duplicateGroups.forEach(group => {
            duplicatedIds.add(group.representative.id);
            group.duplicates.forEach(d => duplicatedIds.add(d.item.id));
        });

        const uniqueFromBatch: TextItem[] = [];
        newItems.forEach(item => {
            if (!duplicatedIds.has(item.id)) {
                uniqueFromBatch.push(item);
            }
        });

        // 6. 与库比对
        const libraryMatches: LibraryMatch[] = [];

        if (checkLibrary && this.librarySignatures.size > 0) {
            // 获取需要与库比对的项目（独特项 + 每个重复组的代表）
            const itemsToCheck = [
                ...uniqueFromBatch,
                ...duplicateGroups.map(g => g.representative)
            ];

            for (const item of itemsToCheck) {
                const newSig = newSignatures.get(item.id);
                if (!newSig) continue;

                let bestMatch: { libraryItem: TextItem; similarity: number } | null = null;
                let matchCount = 0;  // 统计库中有多少条相似的

                // 和库中每个项目比对
                this.librarySignatures.forEach((libSig, libId) => {
                    const similarity = exactJaccard(newSig.shingles, libSig.shingles);

                    if (similarity >= threshold) {
                        matchCount++;  // 统计相似数量
                        if (!bestMatch || similarity > bestMatch.similarity) {
                            const libraryItem = this.libraryItems.get(libId);
                            if (libraryItem) {
                                bestMatch = { libraryItem, similarity };
                            }
                        }
                    }
                });

                if (bestMatch) {
                    libraryMatches.push({
                        newItem: item,
                        libraryItem: bestMatch.libraryItem,
                        similarity: bestMatch.similarity,
                        matchCount  // 库中实际匹配到的相似数量
                    });
                }
            }
        }

        // 7. 过滤掉库中已存在的
        const libraryMatchedIds = new Set(libraryMatches.map(m => m.newItem.id));
        const finalUniqueItems = uniqueFromBatch.filter(item => !libraryMatchedIds.has(item.id));

        // 也过滤重复组中库已存在的代表
        const finalDuplicateGroups = duplicateGroups.filter(g => !libraryMatchedIds.has(g.representative.id));

        const endTime = performance.now();

        return {
            uniqueItems: finalUniqueItems,
            duplicateGroups: finalDuplicateGroups,
            libraryMatches,
            stats: {
                totalInput: newItems.length,
                uniqueCount: finalUniqueItems.length,
                duplicateCount: duplicateGroups.reduce((sum, g) => sum + g.duplicates.length, 0),
                libraryMatchCount: libraryMatches.length,
                processingTimeMs: Math.round(endTime - startTime)
            }
        };
    }

    /**
     * 使用 Union-Find 构建重复组
     */
    private buildDuplicateGroups(
        pairs: SimilarPair[],
        itemsMap: Map<string, TextItem>
    ): DuplicateGroup[] {
        // Union-Find 数据结构
        const parent = new Map<string, string>();
        const rank = new Map<string, number>();

        const find = (x: string): string => {
            if (!parent.has(x)) {
                parent.set(x, x);
                rank.set(x, 0);
            }
            if (parent.get(x) !== x) {
                parent.set(x, find(parent.get(x)!));
            }
            return parent.get(x)!;
        };

        const union = (x: string, y: string): void => {
            const px = find(x);
            const py = find(y);

            if (px === py) return;

            const rx = rank.get(px) || 0;
            const ry = rank.get(py) || 0;

            if (rx < ry) {
                parent.set(px, py);
            } else if (rx > ry) {
                parent.set(py, px);
            } else {
                parent.set(py, px);
                rank.set(px, rx + 1);
            }
        };

        // 构建相似度映射
        const similarityMap = new Map<string, number>();

        for (const pair of pairs) {
            union(pair.id1, pair.id2);
            const key = [pair.id1, pair.id2].sort().join('|||');
            similarityMap.set(key, pair.similarity);
        }

        // 按组分类
        const groups = new Map<string, string[]>();
        pairs.forEach(pair => {
            const root = find(pair.id1);
            const group = groups.get(root) || [];
            if (!group.includes(pair.id1)) group.push(pair.id1);
            if (!group.includes(pair.id2)) group.push(pair.id2);
            groups.set(root, group);
        });

        // 构建结果
        const result: DuplicateGroup[] = [];

        groups.forEach((ids) => {
            if (ids.length < 2) return;

            // 选择第一个作为代表
            const representativeId = ids[0];
            const representative = itemsMap.get(representativeId);

            if (!representative) return;

            const duplicates = ids.slice(1).map(id => {
                const item = itemsMap.get(id);
                const key = [representativeId, id].sort().join('|||');
                const similarity = similarityMap.get(key) || 0;

                return {
                    item: item!,
                    similarity
                };
            }).filter(d => d.item);

            if (duplicates.length > 0) {
                result.push({
                    representative,
                    duplicates: duplicates.sort((a, b) => b.similarity - a.similarity)
                });
            }
        });

        return result;
    }
}

// 导出默认实例
export const dedupEngine = new MinHashDedupEngine();
