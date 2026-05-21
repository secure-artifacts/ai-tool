import React, { useState, useEffect, useCallback } from 'react';

const DEITY_TERMS_KEY = 'smart_translate_deity_terms';
const APPLY_DEITY_ALL_KEY = 'smart_translate_apply_deity_all';
const SCRIPTURE_DETECTION_KEY = 'smart_translate_scripture_detection';
const SCRIPTURE_VERSION_KEY = 'smart_translate_scripture_version';

const DEFAULT_DEITY_TERMS = ['God', 'the Lord', 'Yahweh', 'the Lord God', 'Jesus', 'the Lord Jesus', 'Christ', 'Jesus Christ', 'the Christ of the last days', 'Almighty God', 'He', 'Him', 'Heavenly Father', 'God the Father', 'Father', 'the Almighty God', 'the Creator', 'the Most High', 'King of kings', 'Lord of lords', 'Redeemer', 'the Son of God', 'the Lamb of God'];

export function useScriptureDeitySettings() {
    const [deityTerms, setLocalDeityTerms] = useState<string[]>(DEFAULT_DEITY_TERMS);
    const [applyDeityCapitalizationToAll, setLocalApplyDeityCapitalizationToAll] = useState<boolean>(false);
    const [enableScriptureDetection, setLocalEnableScriptureDetection] = useState<boolean>(false);
    const [scriptureVersion, setLocalScriptureVersion] = useState<string>('King James Version (KJV)');

    useEffect(() => {
        if (typeof localStorage === 'undefined') return;

        try {
            const rawDeity = localStorage.getItem(DEITY_TERMS_KEY);
            if (rawDeity) {
                const parsed = JSON.parse(rawDeity);
                if (Array.isArray(parsed)) setLocalDeityTerms(parsed);
            }
        } catch (e) { }

        try {
            const rawApplyAll = localStorage.getItem(APPLY_DEITY_ALL_KEY);
            if (rawApplyAll) setLocalApplyDeityCapitalizationToAll(JSON.parse(rawApplyAll) === true);
        } catch (e) { }

        try {
            const rawDetection = localStorage.getItem(SCRIPTURE_DETECTION_KEY);
            if (rawDetection) setLocalEnableScriptureDetection(JSON.parse(rawDetection) === true);
        } catch (e) { }

        try {
            const rawVersion = localStorage.getItem(SCRIPTURE_VERSION_KEY);
            if (rawVersion) setLocalScriptureVersion(rawVersion === 'KJV' ? 'King James Version (KJV)' : rawVersion);
        } catch (e) { }
    }, []);

    const setDeityTerms = useCallback((val: string[] | ((prev: string[]) => string[])) => {
        setLocalDeityTerms(prev => {
            const next = typeof val === 'function' ? val(prev) : val;
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(DEITY_TERMS_KEY, JSON.stringify(next));
            }
            return next;
        });
    }, []);

    const setApplyDeityCapitalizationToAll = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
        setLocalApplyDeityCapitalizationToAll(prev => {
            const next = typeof val === 'function' ? val(prev) : val;
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(APPLY_DEITY_ALL_KEY, JSON.stringify(next));
            }
            return next;
        });
    }, []);

    const setEnableScriptureDetection = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
        setLocalEnableScriptureDetection(prev => {
            const next = typeof val === 'function' ? val(prev) : val;
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(SCRIPTURE_DETECTION_KEY, JSON.stringify(next));
            }
            return next;
        });
    }, []);

    const setScriptureVersion = useCallback((val: string | ((prev: string) => string)) => {
        setLocalScriptureVersion(prev => {
            const next = typeof val === 'function' ? val(prev) : val;
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(SCRIPTURE_VERSION_KEY, next);
            }
            return next;
        });
    }, []);

    return {
        deityTerms, setDeityTerms,
        applyDeityCapitalizationToAll, setApplyDeityCapitalizationToAll,
        enableScriptureDetection, setEnableScriptureDetection,
        scriptureVersion, setScriptureVersion
    };
}

interface ScriptureDeitySettingsPanelProps {
    settings: ReturnType<typeof useScriptureDeitySettings>;
}

export const ScriptureDeitySettingsPanel: React.FC<ScriptureDeitySettingsPanelProps> = ({ settings }) => {
    const {
        deityTerms, setDeityTerms,
        applyDeityCapitalizationToAll, setApplyDeityCapitalizationToAll,
        enableScriptureDetection, setEnableScriptureDetection,
        scriptureVersion, setScriptureVersion
    } = settings;

    return (
        <div className="flex flex-col gap-4 p-4 bg-zinc-900 border border-zinc-800 rounded-xl">
            <div className="flex flex-col gap-2">
                <div className="flex justify-between items-start">
                    <div className="flex flex-col gap-1">
                        <span className="text-sm font-semibold text-zinc-200">信仰词汇首字母大写保护</span>
                        <span className="text-xs text-zinc-500">以下英文词块及其对应翻译将强制首字母大写。点击可删除，输入回车添加。</span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer text-xs bg-zinc-800 px-2 py-1 rounded border border-zinc-700">
                        <input
                            type="checkbox"
                            checked={applyDeityCapitalizationToAll}
                            onChange={e => setApplyDeityCapitalizationToAll(e.target.checked)}
                            className="accent-purple-500"
                        />
                        <span className="text-zinc-300">非英语语种也强制大写对应词</span>
                    </label>
                </div>
                <div className="flex flex-wrap gap-2 p-2 bg-zinc-950 border border-zinc-800 rounded-lg min-h-[40px]">
                    {deityTerms.map(term => (
                        <div key={term} className="flex items-center gap-1 px-2 py-0.5 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300">
                            <span>{term}</span>
                            <button
                                onClick={() => setDeityTerms(prev => prev.filter(t => t !== term))}
                                className="text-red-400 hover:text-red-300 ml-1"
                                title="删除"
                            >×</button>
                        </div>
                    ))}
                    <input
                        type="text"
                        placeholder="输入新词 (支持逗号分隔批量添加)..."
                        className="bg-transparent border-none outline-none text-zinc-300 text-xs min-w-[200px] flex-1"
                        onKeyDown={e => {
                            if (e.key === 'Enter') {
                                const val = (e.currentTarget.value);
                                if (val.trim()) {
                                    const newTerms = val.split(/[,，]/).map(t => t.trim()).filter(Boolean);
                                    setDeityTerms(prev => Array.from(new Set([...prev, ...newTerms])));
                                    e.currentTarget.value = '';
                                }
                            }
                        }}
                    />
                </div>
            </div>

            <div className="flex flex-col gap-2 pt-2 border-t border-zinc-800">
                <div className="flex items-center gap-3 flex-wrap">
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={enableScriptureDetection}
                            onChange={e => setEnableScriptureDetection(e.target.checked)}
                            className="accent-purple-500"
                        />
                        <span className="text-sm font-semibold text-zinc-200">开启经文引用检测</span>
                    </label>

                    {enableScriptureDetection && (
                        <div className="flex items-center gap-2">
                            <span className="text-xs text-zinc-500">指定版本:</span>
                            <select
                                value={['King James Version (KJV)', 'American Standard Version (ASV)', 'World English Bible (WEB)'].includes(scriptureVersion) ? scriptureVersion : 'custom'}
                                onChange={e => {
                                    if (e.target.value === 'custom') {
                                        setScriptureVersion('');
                                    } else {
                                        setScriptureVersion(e.target.value);
                                    }
                                }}
                                className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 outline-none"
                            >
                                <option value="King James Version (KJV)">King James Version (KJV)</option>
                                <option value="American Standard Version (ASV)">American Standard Version (ASV)</option>
                                <option value="World English Bible (WEB)">World English Bible (WEB)</option>
                                <option value="custom">自定义输入...</option>
                            </select>
                            {!['King James Version (KJV)', 'American Standard Version (ASV)', 'World English Bible (WEB)'].includes(scriptureVersion) && (
                                <input
                                    type="text"
                                    value={scriptureVersion}
                                    onChange={e => setScriptureVersion(e.target.value)}
                                    placeholder="手动输入版本"
                                    autoFocus
                                    className="bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-300 outline-none w-32"
                                />
                            )}
                        </div>
                    )}
                </div>
                {enableScriptureDetection && (
                    <div className="text-xs text-amber-500/80">
                        ⚠️ 开启经文检测后，AI 若识别到经文将强制使用指定版本的原文，禁止自行翻译以避免版权争议。
                    </div>
                )}
            </div>
        </div>
    );
};
