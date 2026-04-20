import React from 'react';
import { IAgentService } from '../types/agent';
import { Columns, Plus, X } from 'lucide-react';
import { SPLIT_COLUMN_PRESETS } from '../../prompt-tool/CopywritingView';
import { MODEL_OPTIONS, INHERIT_VALUE } from './modelOptions';

const SplitColumnConfig: React.FC<{ value: Record<string, any>; onChange: (val: Record<string, any>) => void }> = ({ value, onChange }) => {
    const config = {
        presetId: value?.presetId || SPLIT_COLUMN_PRESETS[0].id,
        isCustom: value?.isCustom ?? false,
        customColumns: value?.customColumns || SPLIT_COLUMN_PRESETS[0].columns.map(c => ({...c})),
        model: value?.model || INHERIT_VALUE,
    };

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
            <div style={{ fontSize: 13, color: 'var(--text-muted-color)' }}>
                调用“文案结构拆分”引擎。根据预设指令，将一段内容智能拆解并提取到多个具体列中。
            </div>
            
            <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <div style={{ fontSize: 13, fontWeight: 600 }}>选择拆分方案</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
                    {SPLIT_COLUMN_PRESETS.map((p, i) => (
                        <div 
                           key={i} 
                           onClick={() => onChange({ ...config, presetId: p.id, isCustom: false })}
                           style={{ 
                               fontSize: 13, background: 'var(--bg-color-secondary)', padding: '8px 12px', 
                               borderRadius: 6, cursor: 'pointer', color: 'var(--text-color)',
                               border: !config.isCustom && config.presetId === p.id ? '1.5px solid var(--primary-color)' : '1.5px solid transparent',
                               transition: 'all 0.2s ease', userSelect: 'none'
                           }}>
                            {p.name}
                        </div>
                    ))}
                    <div 
                       onClick={() => onChange({ ...config, isCustom: true })}
                       style={{ 
                           fontSize: 13, background: 'var(--bg-color-secondary)', padding: '8px 12px', 
                           borderRadius: 6, cursor: 'pointer', color: 'var(--text-color)',
                           border: config.isCustom ? '1.5px solid var(--primary-color)' : '1.5px solid transparent',
                           transition: 'all 0.2s ease', userSelect: 'none'
                       }}>
                        自定义拆分
                    </div>
                </div>
            </div>

            {config.isCustom && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, background: 'var(--bg-color-secondary)', borderRadius: 8 }}>
                    <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted-color)', marginBottom: 4 }}>自定义列与规则</div>
                    {config.customColumns.map((col: any, idx: number) => (
                        <div key={col.id || idx} style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-color)', padding: 8, borderRadius: 6, border: '1px solid var(--border-color)' }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary-color)' }}>{idx + 1}.</span>
                                <input 
                                    type="text" 
                                    value={col.name} 
                                    onChange={e => {
                                        const newCols = [...config.customColumns];
                                        newCols[idx] = { ...newCols[idx], name: e.target.value };
                                        onChange({ ...config, customColumns: newCols });
                                    }}
                                    placeholder="列名（如：钩子）"
                                    className="dp-input"
                                    style={{ fontSize: 12, padding: '2px 6px', flex: 1 }}
                                />
                                {config.customColumns.length > 1 && (
                                    <button onClick={() => {
                                        const newCols = config.customColumns.filter((_: any, i: number) => i !== idx);
                                        onChange({ ...config, customColumns: newCols });
                                    }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--error-color)', padding: 0 }}>
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                            <textarea 
                                value={col.description} 
                                onChange={e => {
                                    const newCols = [...config.customColumns];
                                    newCols[idx] = { ...newCols[idx], description: e.target.value };
                                    onChange({ ...config, customColumns: newCols });
                                }}
                                placeholder="提取要求（如：开头吸引注意力的句子）"
                                className="dp-input"
                                style={{ fontSize: 12, padding: '4px 6px', minHeight: 40, resize: 'vertical' }}
                            />
                        </div>
                    ))}
                    <button 
                        onClick={() => {
                            const newCols = [...config.customColumns, { id: Date.now().toString(), name: '', description: '' }];
                            onChange({ ...config, customColumns: newCols });
                        }}
                        style={{ 
                            background: 'transparent', border: '1px dashed var(--primary-color)', color: 'var(--text-color)', 
                            padding: '6px', borderRadius: 6, cursor: 'pointer', fontSize: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 4
                        }}>
                        <Plus size={12} /> 添加列
                    </button>
                </div>
            )}

            {!config.isCustom && (() => {
                const preset = SPLIT_COLUMN_PRESETS.find(p => p.id === config.presetId) || SPLIT_COLUMN_PRESETS[0];
                return (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: 12, background: 'var(--bg-color-secondary)', borderRadius: 8 }}>
                        <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted-color)', marginBottom: 4 }}>预设详情预览 (只读)</div>
                        {preset.columns.map((col, idx) => (
                            <div key={idx} style={{ display: 'flex', flexDirection: 'column', gap: 4, background: 'var(--bg-color)', padding: 8, borderRadius: 6, border: '1px solid var(--border-color)', opacity: 0.8 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--primary-color)' }}>{idx + 1}.</span>
                                    <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-color)' }}>{col.name}</span>
                                </div>
                                <div style={{ fontSize: 11, color: 'var(--text-muted-color)', paddingLeft: 18 }}>
                                    {col.description || '无特殊要求'}
                                </div>
                            </div>
                        ))}
                    </div>
                );
            })()}

            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, marginTop: 8 }}>
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

export const SplitColumnAgent: IAgentService = {
  id: 'agent_split_column',
  name: '文案结构拆分',
  icon: <Columns size={14} />,
  description: '将文案拆散并输出到多列 (基于预设拆分方案)',
  ConfigComponent: SplitColumnConfig,
  getSummary: (config) => {
    if (config.isCustom && config.customColumns) {
      return `自定义: ${config.customColumns.length}列`;
    }
    const preset = SPLIT_COLUMN_PRESETS.find(p => p.id === (config.presetId || SPLIT_COLUMN_PRESETS[0].id)) || SPLIT_COLUMN_PRESETS[0];
    return `预设: ${preset.name}`;
  },
  predictOutputColumns: (config, sourceCol, customName) => {
    let columns = [];
    if (config.isCustom && config.customColumns) {
        columns = config.customColumns.map((c: any) => c.name || '未命名');
    } else {
        const preset = SPLIT_COLUMN_PRESETS.find(p => p.id === (config.presetId || SPLIT_COLUMN_PRESETS[0].id)) || SPLIT_COLUMN_PRESETS[0];
        columns = preset.columns.map(c => c.name);
    }
    
    if (customName && customName.trim() !== '') {
        return columns.map(c => `${customName}_${c}`);
    }
    return columns;
  },
  executeBatch: async (data, config, getAiInstance, sourceCol, onProgress, customName) => {
    const ai = getAiInstance();
    const isCustom = config.isCustom ?? false;
    let actualColumns: { name: string; description: string }[] = [];
    
    if (isCustom && config.customColumns) {
        actualColumns = config.customColumns.map((c: any) => ({ name: c.name || '未命名', description: c.description || '' }));
    } else {
        const preset = SPLIT_COLUMN_PRESETS.find(p => p.id === (config.presetId || SPLIT_COLUMN_PRESETS[0].id)) || SPLIT_COLUMN_PRESETS[0];
        actualColumns = preset.columns;
    }

    const outCols = SplitColumnAgent.predictOutputColumns!(config, sourceCol, customName);
    
    const textModel = config.model === INHERIT_VALUE || !config.model ? 'gemini-2.5-flash' : config.model;

    const CONCURRENCY = 15;
    let finalResults: any[] = [];
    
    for (let i = 0; i < data.length; i += CONCURRENCY) {
        const chunk = data.slice(i, i + CONCURRENCY);
        
        try {
            const columnsDesc = actualColumns.map((col, idx) =>
                `第${idx + 1}列【${col.name}】：${col.description || '无特殊要求'}`
            ).join('\n');

            const batchInput = chunk.map((item: any, idx: number) =>
                `[${idx + 1}] ${(item[sourceCol] || '').replace(/\n/g, ' ')}`
            ).join('\n');

            const systemPrompt = `你是一个内容梳理专家。

【处理列定义】
${columnsDesc}

【输出格式】
对每条文案，严格按照 ${actualColumns.length} 列输出，列之间用 ||| 分隔。
每条结果以 [编号] 开头。
示例：
[1] 第1列内容|||第2列内容|||第3列内容`;

            const userPrompt = `请按照列定义分别处理以下 ${chunk.length} 条文案，每条输出 ${actualColumns.length} 列结果：

${batchInput}

每条结果以 [编号] 开头，列之间用 ||| 分隔：`;

            let apiResult: any;
            for (let attempt = 0; attempt <= 3; attempt++) {
                try {
                    apiResult = await ai.models.generateContent({
                        model: textModel,
                        contents: { role: 'user', parts: [{ text: userPrompt }] },
                        config: { systemInstruction: systemPrompt }
                    });
                    break;
                } catch (retryError: any) {
                    const msg = retryError?.message || '';
                    if ((msg.includes('429') || msg.includes('quota')) && attempt < 3) {
                        await new Promise(resolve => setTimeout(resolve, Math.pow(2, attempt + 1) * 2500));
                        continue;
                    }
                    throw retryError;
                }
            }

            const responseText = apiResult.text?.trim() || '';
            const itemRegex = /\[(\d+)\]\s*/g;
            const markers: { idx: number; pos: number }[] = [];
            let m;
            while ((m = itemRegex.exec(responseText)) !== null) {
                markers.push({ idx: parseInt(m[1]) - 1, pos: m.index });
            }

            const chunkResults = new Map<number, string[]>();
            for (let j = 0; j < markers.length; j++) {
                const current = markers[j];
                const nextPos = j + 1 < markers.length ? markers[j + 1].pos : responseText.length;
                let chunkText = responseText.substring(current.pos, nextPos);
                chunkText = chunkText.substring(chunkText.indexOf(']') + 1).trim();
                chunkResults.set(current.idx, chunkText.split('|||').map((s: string) => s.trim()));
            }

            const rowResults = chunk.map((item: any, idx: number) => {
                const out: Record<string, string> = { _original_id: item._original_id || '' };
                const splits = chunkResults.get(idx) || [];
                outCols.forEach((colName, cidx) => {
                    out[colName] = splits[cidx] || '';
                });
                return out;
            });

            finalResults.push(...rowResults);
        } catch (err: any) {
            console.error('SplitColumnAgent execution failed:', err);
            finalResults.push(...chunk.map((item: any) => ({ _original_id: item._original_id || '' })));
        }
        
        if (onProgress) onProgress(finalResults.length, data.length);
    }
    
    return finalResults;
  }
};
