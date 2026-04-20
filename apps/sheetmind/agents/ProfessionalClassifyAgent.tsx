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
                depth: value?.depth || 'full',
                batchSize: value?.batchSize ?? 999,
                customRules: value?.customRules || [],
                enableDedup: false,
                dedupMode: 'semantic',
                taskMode: 'classify_only',
                systemPromptOverride: value?.systemPromptOverride || '',
            }}
            onChange={(val) => {
                // Ignore dedup-related updates by keeping it forced to classify
                onChange({ ...val, enableDedup: false, taskMode: 'classify_only' });
            }}
            compact={true}
            panelMode="classify"
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

export const ProfessionalClassifyAgent: IAgentService = {
  id: 'agent_professional_classify',
  name: '🗂️ 智能分类 Agent',
  icon: <Layers size={14} />,
  description: '强大的三级行业分类引擎',
  ConfigComponent: DedupAgentConfig,
  predictOutputColumns: (config, sourceCol, customName) => {
    const depth = config.depth || 'full';
    const customRules: CustomClassifyRule[] = config.customRules || [];
    const base = customName || sourceCol;

    const cols: string[] = [];
    if (depth === 'custom') {
        customRules.forEach(r => {
            const levelLabel = r.level === 'major' ? '大类' : r.level === 'middle' ? '中类' : r.level === 'minor' ? '小类' : r.level;
            cols.push(`${base}_分类_${levelLabel}`);
        });
    } else {
        cols.push(`${base}_大类`, `${base}_中类`, `${base}_小类`);
    }

    return cols;
  },
  compileMergedInstruction: (config, sourceCol, outputCols) => {
    const depth = config.depth || 'full';
    const customRules: CustomClassifyRule[] = config.customRules || [];
    const rules = customRules.map((r: any) => `${r.name}(${r.criteria})`).join('、');
    if (depth === 'custom') {
       return `根据以下标准进行分类: ${rules}。将结果填入对应的各自列中: ${outputCols.join(', ')}。`;
    }
    return `请对内容所属行业类别进行专业分类，填入对应的三级类目列: ${outputCols.join(', ')}。如果有没对齐或者无法匹配的层级请留空。`;
  },
  getSummary: (config) => {
    return `模式: AI智能分类 (${config.depth === 'custom' ? '自定义' : config.depth === 'major' ? '仅大类' : '全三级'})`;
  },
  executeBatch: async (data: string[], config: Record<string, any>, getAiInstance: () => any, sourceCol: string, onProgress?: (index: number, max: number) => void, customName?: string) => {
    const depth = config.depth || 'full';
    const customRules: CustomClassifyRule[] = config.customRules || [];
    const batchSize = config.batchSize ?? 999;
    const base = customName || sourceCol;

    const output: Record<string, string>[] = new Array(data.length).fill(0).map(() => ({}));

    if (data.length === 0) return output;

    const validData = data.filter(t => t.trim().length > 0);
    if (validData.length === 0) return output;

    // Use specific model if configured
    const effectiveModel = config.model && config.model !== 'inherit'
        ? config.model
        : undefined;

    const itemsToClassify = data.map((t, index) => ({ 
        index, 
        text: t,
        zhText: '',
        enText: ''
    }));
    
    const rulesText = buildRulesText(customRules);
    const customLevels = buildCustomLevels(customRules);

    try {
        const results = await classifyWithAI(itemsToClassify, {
            depth: depth as 'full' | 'major' | 'custom',
            batchSize,
            concurrency: 3,
            customRules: rulesText,
            customLevels,
            model: effectiveModel,
            systemPromptOverride: config.systemPromptOverride || undefined,
            onProgress: (p) => {
                if (onProgress) onProgress(p.current, p.total);
            }
        });

        for (const res of results) {
            if (res.index >= 0 && res.index < data.length) {
                if (depth === 'custom' && res.customCategories) {
                    for (const [key, val] of Object.entries(res.customCategories)) {
                        output[res.index][`${base}_分类_${key}`] = val;
                    }
                } else {
                    output[res.index][`${base}_大类`] = res.major || '';
                    output[res.index][`${base}_中类`] = res.middle || '';
                    output[res.index][`${base}_小类`] = res.minor || '';
                }
            }
        }
        
        return output;
    } catch (err: any) {
        console.error('ProfessionalClassifyAgent execution failed:', err);
        return data.map(() => ({}));
    }
  }
};
