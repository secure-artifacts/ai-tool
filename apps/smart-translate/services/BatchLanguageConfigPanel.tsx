/**
 * BatchLanguageConfigPanel — 可复用的翻译配置面板
 * 
 * 由独立智能翻译工具提供，数据整理的 SmartTranslateAgent 直接调用此组件。
 * 任何 UI/功能更新只需改这一个文件，两边同步。
 */
import React, { useState, useMemo, useRef, useEffect } from 'react';
import { allLanguages, getLanguageName } from '../constants';

const zhDisplayNames = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['zh-CN'], { type: 'language' })
    : null;

const getChineseLanguageLabel = (code: string) => {
    if (!zhDisplayNames) return '';
    if (!code || code === 'smart_auto') return '';
    const normalized = code.replace('_', '-');
    return zhDisplayNames.of(normalized) || '';
};

const getDisplayName = (code: string) => {
    const fallbackName = allLanguages.find(l => l.code === code)?.name || '';
    const zhName = getChineseLanguageLabel(code);
    if (zhName) {
        if (fallbackName && !fallbackName.includes(zhName)) {
            return `${zhName} (${fallbackName})`;
        }
        return zhName;
    }
    return fallbackName || code;
};

export interface BatchLanguageConfigValue {
    languages: string[];
    onlyChinese: boolean;
    cleanupMode: boolean;
    customInstruction: string;
    /** AI 模型 ('__global__' = 继承全局设置) */
    model?: string;
}

const INHERIT_VALUE = '__global__';

const MODEL_OPTIONS = [
    { value: INHERIT_VALUE, label: '继承全局设置' },
    { value: 'gemini-3.5-flash', label: '🚀 gemini-3.5-flash (GA·新)' },
    { value: 'gemini-2.5-flash', label: '⚡ gemini-2.5-flash (GA)' },
    { value: 'gemini-2.5-flash-lite', label: '⚡ gemini-2.5-flash-lite (GA·最快)' },
    { value: 'gemini-2.5-pro', label: '🧠 gemini-2.5-pro (GA·强推理)' },
    { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (Preview)' },
    { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview (Preview·最新)' },
];

interface BatchLanguageConfigPanelProps {
    value: BatchLanguageConfigValue;
    onChange: (val: BatchLanguageConfigValue) => void;
    /** 是否以紧凑模式展示 (DataPipeline Agent 模式) */
    compact?: boolean;
}

/**
 * 完整的翻译配置面板：语言多选（带搜索/排序）、仅中文、水印清理、自定义翻译要求
 * 与独立智能翻译工具的设置界面完全一致。
 */
export const BatchLanguageConfigPanel: React.FC<BatchLanguageConfigPanelProps> = ({ value, onChange, compact = false }) => {
    const config: BatchLanguageConfigValue = {
        languages: value?.languages || ['en'],
        onlyChinese: value?.onlyChinese || false,
        cleanupMode: value?.cleanupMode || false,
        customInstruction: value?.customInstruction || '',
        model: value?.model || INHERIT_VALUE,
    };

    const update = (partial: Partial<BatchLanguageConfigValue>) => {
        onChange({ ...config, ...partial });
    };

    const [languageSearch, setLanguageSearch] = useState('');
    const [showCustomInstruction, setShowCustomInstruction] = useState(!!config.customInstruction?.trim());
    const searchRef = useRef<HTMLInputElement>(null);

    const selectableLanguages = useMemo(() => {
        return allLanguages.filter(lang => lang.code !== 'smart_auto' && lang.code !== 'zh');
    }, []);

    const filteredLanguages = useMemo(() => {
        const keyword = languageSearch.trim().toLowerCase();
        if (!keyword) return selectableLanguages;
        return selectableLanguages.filter(lang =>
            getDisplayName(lang.code).toLowerCase().includes(keyword) ||
            lang.name.toLowerCase().includes(keyword) ||
            lang.code.toLowerCase().includes(keyword)
        );
    }, [languageSearch, selectableLanguages]);

    const sortedLanguages = useMemo(() => {
        const selected: typeof filteredLanguages = [];
        const unselected: typeof filteredLanguages = [];
        filteredLanguages.forEach(lang => {
            if (config.languages.includes(lang.code)) {
                selected.push(lang);
            } else {
                unselected.push(lang);
            }
        });
        return [...selected, ...unselected];
    }, [filteredLanguages, config.languages]);

    const selectedLanguageNames = useMemo(() => {
        return config.languages.map(code => getDisplayName(code)).filter(Boolean);
    }, [config.languages]);

    const toggleLanguage = (code: string) => {
        const newLangs = config.languages.includes(code)
            ? config.languages.filter(c => c !== code)
            : [...config.languages, code];
        update({ languages: newLangs });
    };

    // 预设翻译指令快捷按钮
    const instructionPresets = [
        { label: '🔠 标题全大写', text: 'The first sentence or title of each translation MUST use ALL UPPERCASE LETTERS.' },
        { label: '✂️ 去掉@内容', text: 'Remove all @username handles and any content after @ symbols (e.g. @someone).' },
        { label: '✨ 正式语气', text: 'Use formal and professional tone in all translations.' },
        { label: '💬 口语化', text: 'Use casual, conversational tone in all translations.' },
    ];

    const panelStyle: React.CSSProperties = {
        display: 'flex', flexDirection: 'column', gap: compact ? 10 : 14,
        fontSize: compact ? 12 : 13,
    };

    const sectionBg: React.CSSProperties = {
        background: 'var(--bg-color-secondary, var(--control-bg-color, rgba(128,128,128,0.1)))',
        borderRadius: 8,
        padding: compact ? '8px 10px' : '10px 14px',
    };

    return (
        <div style={panelStyle}>
            {/* ── 仅中文 ── */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontWeight: 500, cursor: 'pointer', fontSize: compact ? 13 : 14 }}>
                <input type="checkbox" checked={config.onlyChinese} onChange={(e) => update({ onlyChinese: e.target.checked })} />
                仅翻译为中文 (自动识别并忽略其他语言)
            </label>

            {/* ── 语言选择 ── */}
            {!config.onlyChinese && (
                <div style={{ ...sectionBg, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: compact ? 13 : 14 }}>
                        批量翻译语种
                        <span style={{ fontWeight: 400, color: 'var(--text-muted-color)', marginLeft: 8, fontSize: compact ? 12 : 13 }}>
                            中文（简体）始终包含
                        </span>
                    </div>

                    {/* 已选摘要 */}
                    <div style={{ fontSize: compact ? 12 : 13, color: 'var(--text-muted-color)' }}>
                        已选: <span style={{ color: 'var(--brand-color, #2196F3)', fontWeight: 500 }}>
                            {selectedLanguageNames.length > 0 ? selectedLanguageNames.join(' / ') : '暂无额外语种'}
                        </span>
                    </div>

                    {/* 搜索 */}
                    <input
                        ref={searchRef}
                        type="text"
                        placeholder="搜索语言..."
                        value={languageSearch}
                        onChange={(e) => setLanguageSearch(e.target.value)}
                        className="dp-input"
                        style={{ fontSize: compact ? 12 : 13, padding: '4px 8px' }}
                    />

                    {/* 语言列表 */}
                    <div style={{
                        maxHeight: compact ? 160 : 220,
                        overflowY: 'auto',
                        display: 'grid',
                        gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
                        gap: 4,
                    }}>
                        {sortedLanguages.map(lang => {
                            const isSelected = config.languages.includes(lang.code);
                            return (
                                <label key={lang.code} style={{
                                    display: 'flex', alignItems: 'center', gap: 5, fontSize: compact ? 12 : 13,
                                    cursor: 'pointer', padding: '3px 6px', borderRadius: 4,
                                    background: isSelected ? 'rgba(33, 150, 243, 0.15)' : 'transparent',
                                    transition: 'background 0.15s',
                                }}>
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        onChange={() => toggleLanguage(lang.code)}
                                    />
                                    <span style={{
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                        fontWeight: isSelected ? 600 : 400,
                                    }}>{getDisplayName(lang.code)}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>
            )}

            {/* ── 水印清理 ── */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: compact ? 13 : 14 }}>
                <input type="checkbox" checked={config.cleanupMode} onChange={(e) => update({ cleanupMode: e.target.checked })} />
                水印清理模式 (智能移除 AI 生成的推广后缀等)
            </label>
            {config.cleanupMode && (
                <div style={{ fontSize: compact ? 11 : 12, color: '#f59e0b', marginTop: -6, paddingLeft: 24 }}>
                    ⚠️ 仅移除确认的"AI 工具水印签名"（如 Made with ChatGPT），不会删除正文内容。
                </div>
            )}

            {/* ── 自定义翻译要求 ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                    type="button"
                    onClick={() => setShowCustomInstruction(!showCustomInstruction)}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: compact ? 13 : 14,
                        fontWeight: 600, color: 'var(--text-color)',
                    }}
                >
                    <span style={{ transform: showCustomInstruction ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', fontSize: 11 }}>▶</span>
                    <span>📝 翻译指令</span>
                    {config.customInstruction?.trim() && !showCustomInstruction && (
                        <span style={{ fontSize: compact ? 11 : 12, color: 'var(--brand-color, #2196F3)', fontWeight: 400 }}>
                            {config.customInstruction.trim().slice(0, 30)}...
                        </span>
                    )}
                </button>

                {showCustomInstruction && (
                    <div style={{ ...sectionBg, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* 快捷预设 */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {instructionPresets.map(preset => {
                                const isActive = config.customInstruction?.includes(preset.text);
                                return (
                                    <button
                                        key={preset.label}
                                        type="button"
                                        onClick={() => {
                                            if (isActive) {
                                                const updated = config.customInstruction.replace(preset.text, '').replace(/\n{2,}/g, '\n').trim();
                                                update({ customInstruction: updated });
                                            } else {
                                                const updated = config.customInstruction?.trim()
                                                    ? config.customInstruction.trim() + '\n' + preset.text
                                                    : preset.text;
                                                update({ customInstruction: updated });
                                            }
                                        }}
                                        style={{
                                            fontSize: 10, padding: '3px 8px', borderRadius: 12,
                                            border: `1px solid ${isActive ? 'var(--brand-color, #2196F3)' : 'var(--border-color, rgba(128,128,128,0.3))'}`,
                                            background: isActive ? 'rgba(33, 150, 243, 0.15)' : 'transparent',
                                            cursor: 'pointer', color: 'var(--text-color)',
                                            fontWeight: isActive ? 600 : 400,
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        {preset.label}
                                    </button>
                                );
                            })}
                        </div>

                        <textarea
                            className="dp-input"
                            placeholder="可选：添加翻译要求，也可以点击上方预设快速添加..."
                            value={config.customInstruction}
                            onChange={(e) => update({ customInstruction: e.target.value })}
                            rows={compact ? 2 : 3}
                            style={{ fontSize: 11, lineHeight: 1.5, resize: 'vertical', minHeight: 40 }}
                        />

                        {config.customInstruction?.trim() && (
                            <button
                                type="button"
                                onClick={() => update({ customInstruction: '' })}
                                style={{
                                    background: 'none', border: 'none', cursor: 'pointer',
                                    fontSize: 10, color: 'var(--text-muted-color)', alignSelf: 'flex-start',
                                }}
                            >
                                ✕ 清除要求
                            </button>
                        )}
                    </div>
                )}
            </div>
            {/* ── AI 模型选择 ── */}
            <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: compact ? 13 : 14 }}>
                AI 模型:
                <select
                    value={config.model || INHERIT_VALUE}
                    onChange={(e) => update({ model: e.target.value })}
                    className="dp-input"
                    style={{ fontSize: compact ? 13 : 14, padding: '4px 8px', maxWidth: 220 }}
                >
                    {MODEL_OPTIONS.map(o => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                    ))}
                </select>
            </label>
        </div>
    );
};
