import React from 'react';
import { IAgentService } from '../types/agent';
import { Feather } from 'lucide-react';
import { BUILTIN_PRESETS, DEFAULT_SYSTEM_INSTRUCTION } from '../../prompt-tool/CopywritingView';
import { promptToolBatchExecute } from '../../prompt-tool/services/promptToolCore';
import { MODEL_OPTIONS, INHERIT_VALUE, resolveModel } from './modelOptions';

const PromptToolConfig: React.FC<{ value: Record<string, any>; onChange: (val: Record<string, any>) => void }> = ({ value, onChange }) => {
    const config = {
        instruction: value?.instruction || '',
        autoTranslate: value?.autoTranslate !== undefined ? value.autoTranslate : true,
        model: value?.model || INHERIT_VALUE,
    };

    const PRESETS = BUILTIN_PRESETS.filter(p => p.presetCategory === '改写预设');

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted-color)' }}>
                调用您的专属“提示词工具”引擎。底层大模型参数与独立界面版 100% 同步一致。
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>改写指令 (Prompt)</div>
                <textarea 
                  className="dp-input" 
                  style={{ minHeight: 80, resize: 'vertical', fontSize: 13 }}
                  placeholder="例如：将以下句子改写为更短、更有悬念的内容。" 
                  value={config.instruction} 
                  onChange={(e) => onChange({ ...config, instruction: e.target.value })} 
                />
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 8 }}>
                    {Array.from(new Set(BUILTIN_PRESETS.map(p => p.presetCategory || '改写预设'))).map(category => (
                        <div key={category} style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                            <div style={{ fontSize: 13, color: 'var(--text-muted-color)', fontWeight: 600 }}>{category}</div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                {BUILTIN_PRESETS.filter(p => (p.presetCategory || '改写预设') === category).map((p, i) => (
                                    <div 
                                       key={i} 
                                       title={p.instruction}
                                       onClick={() => onChange({ ...config, instruction: p.instruction })}
                                       style={{ 
                                           fontSize: 13, background: 'var(--bg-color-secondary)', padding: '8px 12px', 
                                           borderRadius: 6, cursor: 'pointer', color: 'var(--text-color)',
                                           border: config.instruction === p.instruction ? '1.5px solid var(--primary-color)' : '1.5px solid transparent',
                                           transition: 'all 0.2s ease', userSelect: 'none'
                                       }}>
                                        {p.name}
                                    </div>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                <input type="checkbox" checked={config.autoTranslate} onChange={(e) => onChange({ ...config, autoTranslate: e.target.checked })} />
                自动配上中文翻译行 (如果有 ||| 指令则自动忽略)
            </label>

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                AI 模型:
                <select
                    value={config.model}
                    onChange={(e) => onChange({ ...config, model: e.target.value })}
                    className="dp-input"
                    style={{ fontSize: 13, padding: '4px 8px', maxWidth: 220 }}
                >
                    {MODEL_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </label>
        </div>
    );
};

export const PromptToolAgent: IAgentService = {
  id: 'agent_prompt_tool',
  name: '提示词精修改写',
  icon: <Feather size={14} />,
  description: '强大的文案改写与润色（调用您主工具逻辑）',
  ConfigComponent: PromptToolConfig,
  predictOutputColumns: (config, sourceCol, customName) => {
    const base = customName || sourceCol;
    return [`${base}_改写外文`, `${base}_中文大意`];
  },
  compileMergedInstruction: (config, sourceCol, outputCols) => {
    const instruction = config.instruction || '请根据原文重新润色，使其更加流畅生动';
    return `执行改写润色：${instruction}。同时生成改写后文案（通常为外文，写入字段："${outputCols[0]}"）和大致的中文释义（写入字段: "${outputCols[1]}"）。`;
  },
  executeBatch: async (data, config, getAiInstance, sourceCol, onProgress, customName) => {
    const ai = getAiInstance();
    const instruction = config.instruction || '请根据原文重新润色，使其更加流畅生动';
    const autoTranslate = config.autoTranslate !== undefined ? config.autoTranslate : true;
    const textModel = resolveModel(config.model, 'gemini-2.5-flash');
    
    const CONCURRENCY = 15;
    let finalResults: any[] = [];
    
    for (let i = 0; i < data.length; i += CONCURRENCY) {
        const chunk = data.slice(i, i + CONCURRENCY);
        
        try {
            const chunkResults = await promptToolBatchExecute(ai, chunk, {
                textModel: textModel,
                inst: instruction,
                autoTranslate: autoTranslate,
                systemInstruction: DEFAULT_SYSTEM_INSTRUCTION
            });
            finalResults.push(...chunkResults);
        } catch (err: any) {
            console.error('PromptToolAgent execution failed:', err);
            finalResults.push(...chunk.map(() => ({ foreign: '', chinese: '', rawResponse: '' })));
        }
        
        if (onProgress) onProgress(finalResults.length, data.length);
    }
    const base = customName || sourceCol;
    return finalResults.map(res => ({
        [`${base}_改写外文`]: res.foreign || '',
        [`${base}_中文大意`]: res.chinese || ''
    }));
  }
};
