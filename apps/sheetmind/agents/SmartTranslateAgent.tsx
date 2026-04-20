import React from 'react';
import { IAgentService } from '../types/agent';
import { Globe } from 'lucide-react';
import { allLanguages } from '../../smart-translate/constants';
import { smartTranslateSingleItem } from '../../smart-translate/services/smartTranslateCore';
import { BatchLanguageConfigPanel } from '../../smart-translate/services/BatchLanguageConfigPanel';

const normalizeBatchLanguages = (languages?: string[] | null): string[] => {
    const validCodes = new Set(allLanguages.map(l => l.code));
    const cleaned: string[] = [];

    (languages || []).forEach(code => {
        if (!validCodes.has(code)) return;
        if (code === 'smart_auto' || code === 'zh') return;
        if (cleaned.includes(code)) return;
        cleaned.push(code);
    });

    if (cleaned.length === 0) {
        return ['en'];
    }

    return cleaned;
};

// Config Component: 直接复用独立智能翻译工具的配置面板
const SmartTranslateConfig: React.FC<{ value: Record<string, any>; onChange: (val: Record<string, any>) => void }> = ({ value, onChange }) => {
    return (
        <BatchLanguageConfigPanel
            value={{
                languages: value?.languages || ['en'],
                onlyChinese: value?.onlyChinese || false,
                cleanupMode: value?.cleanupMode || false,
                customInstruction: value?.customInstruction || '',
            }}
            onChange={onChange}
            compact={true}
        />
    );
};

export const SmartTranslateAgent: IAgentService = {
  id: 'agent_smart_translate',
  name: '智能批量翻译',
  icon: <Globe size={14} />,
  description: '将文案智能翻译为指定的多国语言并自动分列。自带中文修正。',
  ConfigComponent: SmartTranslateConfig,
  predictOutputColumns: (config, sourceCol, customName) => {
    const base = customName || sourceCol;
    const cols = [`${base}_中文`];
    if (!config.onlyChinese) {
        const langs = normalizeBatchLanguages(config.languages);
        for (const l of langs) {
            cols.push(`${base}_翻译_${l.toUpperCase()}`);
        }
    }
    return cols;
  },
  compileMergedInstruction: (config, sourceCol, outputCols) => {
    const batchOnlyChinese = config.onlyChinese || false;
    const requirements = config.customInstruction ? `附加要求：${config.customInstruction}` : '';
    const langs = outputCols.join('", "');
    if (batchOnlyChinese) {
        return `检测其源语言。无论源语言是什么，将其精确、完整地翻译为简体中文，写入 "${outputCols[0]}" 列。${requirements}`;
    }
    return `精确地翻译为对应的多种语言，分别填充到各自的列名中 ("${langs}")。若源数据并非中文，必须将其翻译为中文并写入 "${outputCols[0]}" 列。${requirements}`;
  },
  executeBatch: async (data, config, getAiInstance, sourceCol, onProgress, customName) => {
    const ai = getAiInstance();
    const batchOnlyChinese = config.onlyChinese || false;
    const effectiveBatchLanguages = batchOnlyChinese ? [] : normalizeBatchLanguages(config.languages);
    
    let results: any[] = [];
    const selectedModel = config.model;
    const textModel = (!selectedModel || selectedModel === '__global__') ? 'gemini-2.5-flash' : selectedModel;

    // To prevent overwhelming rate limits, we process concurrently with a bound
    const CONCURRENCY = 3;
    
    for (let i = 0; i < data.length; i += CONCURRENCY) {
        const chunk = data.slice(i, i + CONCURRENCY);
        
        const chunkPromises = chunk.map(async (textToTranslate) => {
            try {
                return await smartTranslateSingleItem(
                    ai,
                    textModel,
                    textToTranslate,
                    effectiveBatchLanguages,
                    config.cleanupMode || false,
                    config.customInstruction || ''
                );
            } catch (err) {
                console.error('Translation Agent Item Error', err);
                return { error: true };
            }
        });
        
        const chunkResults = await Promise.all(chunkPromises);
        results.push(...chunkResults);
        
        if (onProgress) onProgress(results.length, data.length);
    }

    const base = customName || sourceCol;
    return results.map((res: any) => {
        const out: Record<string, string> = {};
        if (res.error) {
            out[`${base}_中文`] = '[处理失败 / API 限制]';
            if (!batchOnlyChinese) {
                for (const l of effectiveBatchLanguages) {
                    out[`${base}_翻译_${l.toUpperCase()}`] = '[处理失败 / API 限制]';
                }
            }
            return out;
        }
        out[`${base}_中文`] = res.chineseText || '';
        if (!batchOnlyChinese) {
            for (const l of effectiveBatchLanguages) {
                out[`${base}_翻译_${l.toUpperCase()}`] = res.translations?.[l] || '';
            }
        }
        return out; 
    });
  }
};
