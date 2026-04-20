import React from 'react';
import { IAgentService } from '../types/agent';
import { Layers } from 'lucide-react';
import { classifyWithAI, AiClassifyItem } from '../../ai-copy-deduplicator/services/aiClassifyService';
import { localEmbeddingService } from '../../ai-copy-deduplicator/services/localEmbeddingService';
import { cosineSimilarity } from '../../ai-copy-deduplicator/services/similarityService';
import { ClassifyConfigPanel, ClassifyConfigValue, CustomClassifyRule } from '../../ai-copy-deduplicator/services/ClassifyConfigPanel';

// Config Component: 直接复用专业查重工具的配置面板
const DedupAgentConfig: React.FC<{ value: Record<string, any>; onChange: (val: Record<string, any>) => void }> = ({ value, onChange }) => {
    return (
        <ClassifyConfigPanel
            value={{
                ...value,
                depth: 'major',
                batchSize: value?.batchSize ?? 999,
                customRules: [],
                enableDedup: true,
                dedupMode: value?.dedupMode || 'fingerprint',
                dedupSource: value?.dedupSource || 'self',
                taskMode: 'dedup_only',
                systemPromptOverride: '',
            }}
            onChange={(val) => {
                onChange({ ...val, enableDedup: true, taskMode: 'dedup_only' });
            }}
            compact={true}
            panelMode="dedup"
        />
    );
};

/**
 * 将结构化自定义规则转为 AI 可读的文本 (与 ProDedupApp 逻辑完全一致)
 */
function buildRulesText(rules: CustomClassifyRule[]): string | undefined {
    if (!rules || rules.length === 0) return undefined;
    return rules.map(r => {
        const levelLabel = r.level === 'major' ? '大类' : r.level === 'middle' ? '中类' : r.level === 'minor' ? '小类' : r.level;
        const parentHint = r.parentCategory ? ` → 归属「${r.parentCategory}」` : '';
        return `${levelLabel}「${r.name}」${parentHint} | 判断标准：${r.criteria}`;
    }).join('\n');
}

/**
 * 从规则中提取唯一的层级维度名 (与 ProDedupApp 逻辑完全一致)
 */
function buildCustomLevels(rules: CustomClassifyRule[]): string[] | undefined {
    if (!rules || rules.length === 0) return undefined;
    return Array.from(new Set(rules.map(r =>
        r.level === 'major' ? '大类' : r.level === 'middle' ? '中类' : r.level === 'minor' ? '小类' : r.level
    )));
}

export const SemanticDedupAgent: IAgentService = {
  id: 'agent_semantic_dedup',
  name: '🔎 高级语义查重',
  icon: <Layers size={14} />,
  description: '纯本地或库内的语义/指纹精确排重',
  ConfigComponent: DedupAgentConfig,
  getSummary: (config) => {
    const dedupMode = config.dedupMode === 'fingerprint' ? '指纹' : '相似度';
    const dedupSource = config.dedupSource === 'self' ? '自我查重' : '库内查重';
    return `模式: 高级查重 (${dedupMode} | ${dedupSource})`;
  },
  predictOutputColumns: (config, sourceCol, customName) => {
    const base = customName || sourceCol;
    const cols: string[] = [];

    const isSelfDedup = config.dedupSource === 'self';
    const dedupColName = isSelfDedup ? `${base}_内部查重` : `${base}_库内查重`;
    const dedupDetailColName = `${base}_查重明细`;

    cols.push(dedupColName);
    if (isSelfDedup) {
        cols.push(dedupDetailColName);
    }

    return cols;
  },
  executeBatch: async (data: string[], config: Record<string, any>, getAiInstance: () => any, sourceCol: string, onProgress?: (index: number, max: number) => void, customName?: string) => {
    const base = customName || sourceCol;
    const output: Record<string, string>[] = new Array(data.length).fill(0).map(() => ({}));

    if (data.length === 0) return output;
    if (onProgress) onProgress(data.length, data.length);

    try {
        // 本地指纹/查重提取
        const dedupMode = config.dedupMode === 'semantic' ? 'semantic' : 'fingerprint';
        const isSelfDedup = config.dedupSource === 'self';
        const dedupColName = isSelfDedup ? `${base}_内部查重` : `${base}_库内查重`;
        const dedupDetailColName = `${base}_查重明细`;
        
        let libItems: {id:string, text:string}[] = [];
        
        if (isSelfDedup) {
            // 自己内部查重
            libItems = data.map((text, idx) => ({ id: `row_${idx}`, text }));
        } else {
            const savedLib = typeof window !== 'undefined' ? localStorage.getItem('pro_dedup_library') : null;
            if (savedLib) {
                try { libItems = JSON.parse(savedLib); } catch (e) {}
            }
        }

        if (libItems.length > 0) {
            // 并查集：用于将内部相似项合并为同一个组
            const parent = new Array(data.length).fill(0).map((_, i) => i);
            const find = (i: number): number => {
                    if (parent[i] === i) return i;
                    return parent[i] = find(parent[i]);
                };
                const union = (i: number, j: number) => {
                    const rootI = find(i);
                    const rootJ = find(j);
                    if (rootI !== rootJ) parent[rootI] = rootJ;
                };

                const condition = config.autoDeleteCondition || 'none';
                const threshold = (config.autoDeleteThreshold ?? 95) / 100;
                
                if (dedupMode === 'semantic') {
                    await localEmbeddingService.initEngine(undefined as any);
                    const queryEmbs = await localEmbeddingService.extractEmbeddings(data);
                    const libTexts = libItems.map(l => l.text);
                    const libEmbs = await localEmbeddingService.extractEmbeddings(libTexts);

                    for (let i = 0; i < data.length; i++) {
                        let maxSim = 0;
                        let matchedIdx = -1;
                        if (queryEmbs[i]) {
                            for (let j = 0; j < libEmbs.length; j++) {
                                // 如果是内部查重，跳过自己
                                if (isSelfDedup && i === j) continue;
                                
                                if (libEmbs[j]) {
                                    const sim = cosineSimilarity(queryEmbs[i], libEmbs[j]);
                                    if (sim > maxSim) {
                                        maxSim = sim;
                                        matchedIdx = j;
                                    }
                                }
                            }
                        }
                        
                        if (isSelfDedup) {
                            // 语义相似度普遍偏高(>0.7)，因此需要使用较高的阈值(>>0.85)来判定为“同属一个重复组”，否则全部连通
                            if (maxSim >= 0.85 && matchedIdx >= 0) {
                                union(i, matchedIdx);
                                output[i][dedupColName] = `与第${matchedIdx + 1}行相似: ${(maxSim * 100).toFixed(1)}%`;
                            } else {
                                output[i][dedupColName] = '无重复';
                            }
                        } else {
                            if (maxSim > 0.05) { 
                                output[i][dedupColName] = `相似度:${(maxSim * 100).toFixed(1)}%`;
                            } else {
                                output[i][dedupColName] = '无重复';
                            }
                        }
                        
                        if (condition === 'gt' && maxSim > threshold) {
                            output[i]['__remove__'] = 'true';
                        } else if (condition === 'lt' && maxSim < threshold) {
                            output[i]['__remove__'] = 'true';
                        }
                    }
                } else {
                    const { dedupEngine } = await import('../../ai-copy-deduplicator/services/minHashEngine');
                    dedupEngine.clearLibrary();
                    dedupEngine.addToLibrary(libItems);
                    
                    // 获取 maxResults: 2，以防 top1 是自己
                    const matches = dedupEngine.searchLibrary(data, { threshold: 0.05, maxResults: isSelfDedup ? 2 : 1 });
                    
                    for (let i = 0; i < data.length; i++) {
                        let bestMatch = matches[i]?.matches[0];
                        if (isSelfDedup && bestMatch?.item?.id === `row_${i}`) {
                            // 自己排除自己
                            bestMatch = matches[i]?.matches[1];
                        }
                        
                        const maxSim = bestMatch?.similarity || 0;
                        if (isSelfDedup) {
                            if (maxSim > 0.05 && bestMatch) {
                                const matchedIdx = parseInt(bestMatch.item.id.split('_')[1]);
                                union(i, matchedIdx);
                                output[i][dedupColName] = `与第${matchedIdx + 1}行相似: ${(maxSim * 100).toFixed(1)}%`;
                            } else {
                                output[i][dedupColName] = '无重复';
                            }
                        } else {
                            if (maxSim > 0) {
                                output[i][dedupColName] = `指纹相似:${(maxSim * 100).toFixed(1)}%`;
                            } else {
                                output[i][dedupColName] = '无重复';
                            }
                        }
                        
                        if (condition === 'gt' && maxSim > threshold) {
                            output[i]['__remove__'] = 'true';
                        } else if (condition === 'lt' && maxSim < threshold) {
                            output[i]['__remove__'] = 'true';
                        }
                    }
                }

                // 计算内部自我查重的分组标签
                if (isSelfDedup) {
                    const groupSizes = new Map<number, number>();
                    for (let i = 0; i < data.length; i++) {
                        const root = find(i);
                        groupSizes.set(root, (groupSizes.get(root) || 0) + 1);
                    }
                    
                    let groupCounter = 1;
                    const rootToGroupName = new Map<number, string>();
                    
                    for (const [root, size] of groupSizes.entries()) {
                        if (size > 1) {
                            rootToGroupName.set(root, `重复组_${groupCounter++}`);
                        }
                    }
                    
                    for (let i = 0; i < data.length; i++) {
                        const root = find(i);
                        if (groupSizes.get(root)! > 1) {
                            output[i][dedupDetailColName] = output[i][dedupColName]; // 把之前存的比如 "与第X行相似" 挪到明细里
                            output[i][dedupColName] = rootToGroupName.get(root)!;
                        } else {
                            output[i][dedupDetailColName] = output[i][dedupColName];
                            output[i][dedupColName] = '无重复';
                        }
                    }
                }
            } else {
                for (let i = 0; i < data.length; i++) {
                    output[i][dedupColName] = isSelfDedup ? '数据不足' : '库为空';
                    if (isSelfDedup) output[i][dedupDetailColName] = '-';
                }
            }

        return output;
    } catch (err: any) {
        console.error('SemanticDedupAgent execution failed:', err);
        return data.map(() => ({}));
    }
  }
};
