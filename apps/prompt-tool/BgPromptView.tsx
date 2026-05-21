/**
 * BgPromptView.tsx — 背景提取 + 文案拼装（双语版）
 * 支持: 粘贴图片/拖入/文件选择/URL粘贴/Google Sheets =IMAGE() 公式
 * 输出: 英文+中文双语背景描述 + 文案拼装
 */
import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import { ImageIcon, Loader2, Copy, Check, Trash2, Edit3, RotateCw, Settings2, ChevronDown, ChevronUp } from 'lucide-react';
import { useScriptureDeitySettings, ScriptureDeitySettingsPanel } from './components/ScriptureDeitySettings';
import { parsePasteInput, extractUrlsFromHtml, fetchImageBlob, convertBlobToBase64 } from '../ai-image-recognition/utils';

interface BgResult {
    id: string;
    imageDataUrl: string;
    bgEn: string;
    bgZh: string;
    userText: string;
    finalEn: string;
    finalZh: string;
    status: 'idle' | 'extracting' | 'success' | 'error';
    error?: string;
    createdAt: number;
}

interface BgPromptViewProps {
    getAiInstance: () => GoogleGenAI;
    textModel: string;
}

const toBase64DataUrl = (blob: Blob): Promise<string> =>
    new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onloadend = () => resolve(r.result as string);
        r.onerror = reject;
        r.readAsDataURL(blob);
    });

const asmEn = (bg: string, text: string): string => {
    if (!bg) return '';
    const t = bg.trim().replace(/\.?$/, '');
    return text.trim() ? `${t}, with elegant text overlay that reads: "${text.trim()}"` : t + '.';
};
const asmZh = (bg: string, text: string): string => {
    if (!bg) return '';
    const t = bg.trim().replace(/[。.]?$/, '');
    return text.trim() ? `${t}，画面上叠加优雅的文字："${text.trim()}"` : t + '。';
};
const parseBi = (raw: string) => {
    const i = raw.indexOf('|||');
    return i === -1 ? { en: raw.trim(), zh: '' } : { en: raw.slice(0, i).trim(), zh: raw.slice(i + 3).trim() };
};

const STORAGE_KEY = 'bg_prompt_view_v2';
const SYSPROMPT_KEY = 'bg_prompt_system_v1';

const DEFAULT_SYSTEM_PROMPT = `You are an expert at describing images for AI image generation.
When given an image, describe ONLY the background scene in detail.
Include: what is depicted (scene, objects, environment), colors, lighting, mood, composition, and layout style.
Minimize unnecessary decorative elements, ornamental patterns, and floral borders — keep the background clean and elegant unless such elements are a core part of the original image's style.
Do NOT describe any text, words, or letters visible in the image.

Output format (CRITICAL): Output exactly two paragraphs separated by |||:
English description|||中文描述

- English: 30-80 words, suitable as AI image generation prompt.
- Chinese: corresponding Chinese translation of the English description, 30-80 字.
- No labels, numbers, or extra text. Just two paragraphs separated by |||.`;

export function BgPromptView({ getAiInstance, textModel }: BgPromptViewProps) {
    const [results, setResults] = useState<BgResult[]>(() => {
        try { const s = localStorage.getItem(STORAGE_KEY); return s ? JSON.parse(s).results || [] : []; } catch { return []; }
    });
    const [userText, setUserText] = useState('');
    const [isExtracting, setIsExtracting] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [editingBgId, setEditingBgId] = useState<string | null>(null);
    const [editingLang, setEditingLang] = useState<'en' | 'zh'>('en');
    const [showSettings, setShowSettings] = useState(false);
    const [noImageMode, setNoImageMode] = useState(false);
    const [showSystemPrompt, setShowSystemPrompt] = useState(false);
    const [customSystemPrompt, setCustomSystemPrompt] = useState(() => {
        try { const s = localStorage.getItem(SYSPROMPT_KEY); return s || DEFAULT_SYSTEM_PROMPT; } catch { return DEFAULT_SYSTEM_PROMPT; }
    });
    const fileInputRef = useRef<HTMLInputElement>(null);
    const settings = useScriptureDeitySettings();

    // Deity rules for system prompt
    const deityRules = useMemo(() => {
        if (!settings.deityTerms?.length) return '';
        const terms = settings.deityTerms.join(', ');
        return `\n\n【CRITICAL - Faith Word Rules】The following faith-related words require special treatment: [${terms}].
1. Capitalization: These words MUST always have their first letter capitalized in English. In Chinese output, use the standard capitalized English form or established Chinese translation.
2. Text Color: When describing text overlays, these faith-related words must NEVER be rendered in black. They should appear in white, gold, warm light, or other bright/luminous colors to convey reverence and visibility. Explicitly mention the text color in the prompt (e.g. "white text", "golden lettering").
These rules apply to BOTH English and Chinese output.`;
    }, [settings.deityTerms]);

    // Persist system prompt
    useEffect(() => {
        try { localStorage.setItem(SYSPROMPT_KEY, customSystemPrompt); } catch { }
    }, [customSystemPrompt]);

    const buildSystemPrompt = useCallback(() => {
        return customSystemPrompt + deityRules;
    }, [customSystemPrompt, deityRules]);

    // Persist (without bloating storage with base64)
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                results: results.map(r => ({ ...r, imageDataUrl: r.imageDataUrl?.slice(0, 200) + '…' }))
            }));
        } catch { }
    }, [results]);

    // --- Core: extract background from image dataUrl ---
    const extractFromDataUrl = useCallback(async (imageDataUrl: string) => {
        const id = uuidv4();
        const newResult: BgResult = {
            id, imageDataUrl, bgEn: '', bgZh: '', userText,
            finalEn: '', finalZh: '', status: 'extracting', createdAt: Date.now(),
        };
        setResults(prev => [newResult, ...prev]);
        setIsExtracting(true);

        try {
            const ai = getAiInstance();
            const base64 = imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
            const mime = imageDataUrl.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';

            let res: any;
            for (let i = 0; i <= 3; i++) {
                try {
                    res = await ai.models.generateContent({
                        model: textModel || 'gemini-2.0-flash',
                        contents: { role: 'user', parts: [
                            { inlineData: { data: base64, mimeType: mime } },
                            { text: 'Describe this image\'s background scene. Follow system instructions exactly.' },
                        ]},
                        config: { systemInstruction: buildSystemPrompt(), temperature: 0.7, maxOutputTokens: 1024 },
                    });
                    break;
                } catch (e: any) {
                    if ((e?.message?.includes('429') || e?.message?.includes('RESOURCE_EXHAUSTED')) && i < 3) {
                        await new Promise(r => setTimeout(r, Math.pow(2, i + 1) * 2000));
                        continue;
                    }
                    throw e;
                }
            }

            const raw = (res?.text || '').trim();
            const { en, zh } = parseBi(raw);
            setResults(prev => prev.map(r => r.id === id
                ? { ...r, bgEn: en, bgZh: zh, finalEn: asmEn(en, userText), finalZh: asmZh(zh, userText), status: 'success' } : r
            ));
        } catch (e: any) {
            setResults(prev => prev.map(r => r.id === id ? { ...r, status: 'error', error: e?.message || '提取失败' } : r));
        }
        setIsExtracting(false);
    }, [getAiInstance, textModel, userText, buildSystemPrompt]);

    // --- Paste: images, URLs, Google Sheets ---
    const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
        const clip = e.clipboardData;
        if (!clip) return;

        // 1. Direct image files
        for (const item of Array.from(clip.items)) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                if (blob) { const du = await toBase64DataUrl(blob); extractFromDataUrl(du); }
                return;
            }
        }

        // 2. HTML with images (Google Sheets)
        const html = clip.getData('text/html');
        if (html && (html.includes('<img') || html.includes('IMAGE(') || html.includes('data-sheets'))) {
            const urls = extractUrlsFromHtml(html);
            if (urls.length > 0) {
                e.preventDefault();
                for (const u of urls) {
                    try {
                        const { blob } = await fetchImageBlob(u.fetchUrl);
                        const du = await toBase64DataUrl(blob);
                        extractFromDataUrl(du);
                    } catch (err: any) {
                        const id = uuidv4();
                        setResults(prev => [{ id, imageDataUrl: '', bgEn: '', bgZh: '', userText, finalEn: '', finalZh: '', status: 'error', error: `URL加载失败: ${err?.message}`, createdAt: Date.now() }, ...prev]);
                    }
                }
                return;
            }
        }

        // 3. Plain text with URLs / =IMAGE() formulas
        const text = clip.getData('text/plain');
        if (text) {
            const parsed = parsePasteInput(text);
            if (parsed.length > 0) {
                e.preventDefault();
                for (const p of parsed) {
                    try {
                        const { blob } = await fetchImageBlob(p.url);
                        const du = await toBase64DataUrl(blob);
                        extractFromDataUrl(du);
                    } catch (err: any) {
                        const id = uuidv4();
                        setResults(prev => [{ id, imageDataUrl: '', bgEn: '', bgZh: '', userText, finalEn: '', finalZh: '', status: 'error', error: `URL加载失败: ${err?.message}`, createdAt: Date.now() }, ...prev]);
                    }
                }
                return;
            }
        }
    }, [extractFromDataUrl, userText]);

    // --- File & Drop ---
    const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
        if (!e.target.files) return;
        for (const f of Array.from(e.target.files)) {
            if (f.type.startsWith('image/')) { const du = await toBase64DataUrl(f); extractFromDataUrl(du); }
        }
        e.target.value = '';
    }, [extractFromDataUrl]);

    const [dragOver, setDragOver] = useState(false);
    const handleDrop = useCallback(async (e: React.DragEvent) => {
        e.preventDefault(); setDragOver(false);
        if (!e.dataTransfer?.files) return;
        for (const f of Array.from(e.dataTransfer.files)) {
            if (f.type.startsWith('image/')) { const du = await toBase64DataUrl(f); extractFromDataUrl(du); }
        }
    }, [extractFromDataUrl]);

    // --- Update helpers ---
    const updateText = (id: string, text: string) => {
        setResults(prev => prev.map(r => r.id === id ? { ...r, userText: text, finalEn: asmEn(r.bgEn, text), finalZh: asmZh(r.bgZh, text) } : r));
    };
    const updateBg = (id: string, lang: 'en' | 'zh', val: string) => {
        setResults(prev => prev.map(r => {
            if (r.id !== id) return r;
            const bgEn = lang === 'en' ? val : r.bgEn;
            const bgZh = lang === 'zh' ? val : r.bgZh;
            return { ...r, bgEn, bgZh, finalEn: asmEn(bgEn, r.userText), finalZh: asmZh(bgZh, r.userText) };
        }));
    };
    const applyTextToAll = () => {
        setResults(prev => prev.map(r => ({ ...r, userText, finalEn: asmEn(r.bgEn, userText), finalZh: asmZh(r.bgZh, userText) })));
    };

    // --- Re-extract ---
    const reExtract = useCallback(async (result: BgResult) => {
        if (isExtracting || !result.imageDataUrl || result.imageDataUrl.endsWith('…')) return;
        setIsExtracting(true);
        setResults(prev => prev.map(r => r.id === result.id ? { ...r, status: 'extracting', error: undefined } : r));
        try {
            const ai = getAiInstance();
            const base64 = result.imageDataUrl.replace(/^data:image\/\w+;base64,/, '');
            const mime = result.imageDataUrl.match(/^data:(image\/\w+);base64,/)?.[1] || 'image/jpeg';
            const res = await ai.models.generateContent({
                model: textModel || 'gemini-2.0-flash',
                contents: { role: 'user', parts: [{ inlineData: { data: base64, mimeType: mime } }, { text: 'Describe background scene.' }] },
                config: { systemInstruction: buildSystemPrompt(), temperature: 0.8, maxOutputTokens: 1024 },
            });
            const { en, zh } = parseBi((res?.text || '').trim());
            setResults(prev => prev.map(r => r.id === result.id ? { ...r, bgEn: en, bgZh: zh, finalEn: asmEn(en, r.userText), finalZh: asmZh(zh, r.userText), status: 'success' } : r));
        } catch (e: any) {
            setResults(prev => prev.map(r => r.id === result.id ? { ...r, status: 'error', error: e?.message || '失败' } : r));
        }
        setIsExtracting(false);
    }, [isExtracting, getAiInstance, textModel, buildSystemPrompt]);

    // --- Manual (no-image) add ---
    const addManualResult = () => {
        if (!userText.trim()) return;
        const id = uuidv4();
        const enPrompt = `Generate a clean, minimalist background image with elegant text overlay that reads: "${userText.trim()}"`;
        const zhPrompt = `生成一个干净简约的背景图片，画面上叠加优雅的文字："${userText.trim()}"`;
        const r: BgResult = {
            id, imageDataUrl: '', bgEn: '', bgZh: '', userText,
            finalEn: enPrompt, finalZh: zhPrompt,
            status: 'success', createdAt: Date.now(),
        };
        setResults(prev => [r, ...prev]);
    };

    // --- Copy ---
    const copy = async (text: string, id: string) => {
        try { await navigator.clipboard.writeText(text); setCopiedId(id); setTimeout(() => setCopiedId(null), 2000); } catch { }
    };
    const CopyBtn = ({ text, cid, label }: { text: string; cid: string; label?: string }) => (
        <button onClick={() => copy(text, cid)} className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] bg-teal-500/15 text-teal-400 hover:bg-teal-500/25 border border-teal-500/20 transition-colors">
            {copiedId === cid ? <><Check size={10} /> 已复制</> : <><Copy size={10} /> {label || '复制'}</>}
        </button>
    );

    const successResults = results.filter(r => r.status === 'success');

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto" style={{ scrollBehavior: 'smooth' }}>
                <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

                    {/* Title */}
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <div className="bg-gradient-to-br from-teal-500/30 to-emerald-500/30 p-2 rounded-xl">
                                    <ImageIcon className="w-5 h-5 text-teal-400" />
                                </div>
                                背景提取 + 文案拼装
                            </h2>
                            <p className="text-xs text-zinc-500 mt-1">从参考图中提取中英双语背景描述，自动拼装 AI 图片生成 prompt · 支持粘贴图片/URL/Google Sheets</p>
                        </div>
                        <button onClick={() => setShowSettings(!showSettings)} className={`p-1.5 rounded-lg transition-colors ${showSettings ? 'bg-teal-500/20 text-teal-400' : 'text-zinc-500 hover:text-zinc-300'}`}>
                            <Settings2 size={16} />
                        </button>
                    </div>

                    {/* Settings Panel */}
                    {showSettings && (
                        <div className="space-y-3">
                            <ScriptureDeitySettingsPanel settings={settings} />
                            {/* System Prompt Editor */}
                            <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden">
                                <button onClick={() => setShowSystemPrompt(!showSystemPrompt)} className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/30 transition-colors">
                                    <div className="flex items-center gap-2">
                                        <Settings2 className="w-4 h-4 text-teal-400" />
                                        <span className="text-xs font-medium text-zinc-300">系统指令</span>
                                        {customSystemPrompt !== DEFAULT_SYSTEM_PROMPT && (
                                            <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-400">已修改</span>
                                        )}
                                    </div>
                                    {showSystemPrompt ? <ChevronUp size={14} className="text-zinc-500" /> : <ChevronDown size={14} className="text-zinc-500" />}
                                </button>
                                {showSystemPrompt && (
                                    <div className="px-4 pb-4 space-y-2">
                                        <textarea
                                            value={customSystemPrompt}
                                            onChange={e => setCustomSystemPrompt(e.target.value)}
                                            className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-300 text-xs font-mono resize-y focus:outline-none focus:ring-1 focus:ring-teal-500/50"
                                            rows={10}
                                        />
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={() => setCustomSystemPrompt(DEFAULT_SYSTEM_PROMPT)}
                                                disabled={customSystemPrompt === DEFAULT_SYSTEM_PROMPT}
                                                className="px-2.5 py-1 rounded-lg text-[10px] bg-zinc-800 border border-zinc-700 text-zinc-400 hover:text-amber-400 hover:border-amber-500/30 disabled:opacity-30 transition-colors"
                                            >恢复默认</button>
                                            <span className="text-[10px] text-zinc-600">信仰词汇规则会自动附加到指令末尾</span>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* Input Area */}
                    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl p-4 space-y-4">
                        {/* Mode Toggle */}
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setNoImageMode(false)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${!noImageMode ? 'bg-teal-600 text-white' : 'text-zinc-400 hover:text-zinc-200 bg-zinc-800'}`}
                            >🖼 图片提取模式</button>
                            <button
                                onClick={() => setNoImageMode(true)}
                                className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${noImageMode ? 'bg-purple-600 text-white' : 'text-zinc-400 hover:text-zinc-200 bg-zinc-800'}`}
                            >✏️ 无背景模式</button>
                            <span className="text-[10px] text-zinc-600">{noImageMode ? '直接输入文案，一键生成 prompt' : '上传参考图，AI 自动提取'}</span>
                        </div>

                        {/* User Text */}
                        <div>
                            <label className="text-xs font-medium text-zinc-400 mb-1.5 block">{noImageMode ? '输入文案内容' : '要叠加的文案（拼接到背景描述后）'}</label>
                            <textarea value={userText} onChange={e => setUserText(e.target.value)}
                                placeholder='例如: GOD LOVES YOU — GIVE GOD 10 SECONDS...'
                                className="w-full px-3 py-2.5 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-100 text-sm resize-none focus:outline-none focus:ring-2 focus:ring-teal-500/50 placeholder:text-zinc-600" rows={3} />
                            {!noImageMode && results.length > 0 && userText.trim() && (
                                <button onClick={applyTextToAll} className="mt-1.5 text-[10px] text-teal-400 hover:text-teal-300">将此文案应用到所有结果 ↓</button>
                            )}
                        </div>

                        {noImageMode ? (
                            <button
                                onClick={addManualResult}
                                disabled={!userText.trim()}
                                className="w-full py-2.5 rounded-lg text-sm font-medium transition-all bg-gradient-to-r from-purple-600 to-teal-600 text-white hover:from-purple-500 hover:to-teal-500 disabled:opacity-30 disabled:cursor-not-allowed"
                            >生成 Prompt</button>
                        ) : (
                            /* Drop Zone */
                            <div onPaste={handlePaste}
                                onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                                onDragLeave={() => setDragOver(false)}
                                onDrop={handleDrop} tabIndex={0}
                                className={`relative border-2 border-dashed rounded-xl p-8 text-center transition-all cursor-pointer ${dragOver ? 'border-teal-400 bg-teal-500/10' : 'border-zinc-700 hover:border-zinc-500 bg-zinc-800/30'}`}
                                onClick={() => fileInputRef.current?.click()}>
                                <input ref={fileInputRef} type="file" accept="image/*" multiple className="hidden" onChange={handleFileSelect} />
                                {isExtracting ? (
                                    <div className="flex flex-col items-center gap-2 text-teal-400">
                                        <Loader2 size={28} className="animate-spin" /><span className="text-sm">正在提取背景描述...</span>
                                    </div>
                                ) : (
                                    <div className="flex flex-col items-center gap-2 text-zinc-500">
                                        <ImageIcon size={32} />
                                        <span className="text-sm">拖入图片 / 点击选择 / Ctrl+V 粘贴图片或URL</span>
                                        <span className="text-[10px] text-zinc-600">支持: 直接粘贴图片、图片URL、Google Sheets =IMAGE() 公式</span>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Batch Actions */}
                    {successResults.length > 1 && (
                        <div className="flex items-center gap-2 text-xs flex-wrap">
                            <span className="text-zinc-500">{successResults.length} 条结果</span>
                            <CopyBtn text={successResults.map(r => r.finalEn).join('\n')} cid="batch-en" label="批量复制英文" />
                            <CopyBtn text={successResults.map(r => r.finalZh).join('\n')} cid="batch-zh" label="批量复制中文" />
                            <CopyBtn text={successResults.map(r => `${r.finalEn}\n${r.finalZh}`).join('\n\n')} cid="batch-both" label="批量复制双语" />
                            <button onClick={() => setResults([])} className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-red-500/10 transition-colors">
                                <Trash2 size={12} /> 清空
                            </button>
                        </div>
                    )}

                    {/* Results */}
                    {results.map(result => (
                        <div key={result.id} className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden">
                            <div className="flex gap-4 p-4">
                                {/* Thumbnail */}
                                {result.imageDataUrl && !result.imageDataUrl.endsWith('…') && (
                                    <div className="shrink-0">
                                        <img src={result.imageDataUrl} alt="ref" className="w-24 h-24 rounded-lg object-cover border border-zinc-700" />
                                    </div>
                                )}

                                <div className="flex-1 min-w-0 space-y-3">
                                    {result.status === 'extracting' && (
                                        <div className="flex items-center gap-2 text-teal-400 text-sm"><Loader2 size={14} className="animate-spin" /> 提取中...</div>
                                    )}
                                    {result.status === 'error' && (
                                        <div className="text-red-400 text-xs bg-red-500/10 px-3 py-2 rounded-lg">❌ {result.error}</div>
                                    )}
                                    {result.status === 'success' && (<>
                                        {/* EN Background */}
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[10px] font-medium text-blue-400 uppercase tracking-wider">🇺🇸 English Background</span>
                                                <button onClick={() => { setEditingBgId(editingBgId === result.id && editingLang === 'en' ? null : result.id); setEditingLang('en'); }} className="text-zinc-500 hover:text-teal-400"><Edit3 size={11} /></button>
                                                <button onClick={() => reExtract(result)} className="text-zinc-500 hover:text-teal-400"><RotateCw size={11} /></button>
                                                <CopyBtn text={result.bgEn} cid={`bgen-${result.id}`} />
                                            </div>
                                            {editingBgId === result.id && editingLang === 'en' ? (
                                                <textarea value={result.bgEn} onChange={e => updateBg(result.id, 'en', e.target.value)} className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-teal-500/40 text-zinc-200 text-xs resize-none focus:outline-none" rows={3} autoFocus />
                                            ) : (
                                                <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-800/50 px-3 py-2 rounded-lg">{result.bgEn}</p>
                                            )}
                                        </div>
                                        {/* ZH Background */}
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[10px] font-medium text-amber-400 uppercase tracking-wider">🇨🇳 中文背景描述</span>
                                                <button onClick={() => { setEditingBgId(editingBgId === result.id && editingLang === 'zh' ? null : result.id); setEditingLang('zh'); }} className="text-zinc-500 hover:text-teal-400"><Edit3 size={11} /></button>
                                                <CopyBtn text={result.bgZh} cid={`bgzh-${result.id}`} />
                                            </div>
                                            {editingBgId === result.id && editingLang === 'zh' ? (
                                                <textarea value={result.bgZh} onChange={e => updateBg(result.id, 'zh', e.target.value)} className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-amber-500/40 text-zinc-200 text-xs resize-none focus:outline-none" rows={3} autoFocus />
                                            ) : (
                                                <p className="text-xs text-zinc-300 leading-relaxed bg-zinc-800/50 px-3 py-2 rounded-lg">{result.bgZh || <span className="text-zinc-600 italic">无中文描述</span>}</p>
                                            )}
                                        </div>
                                        {/* User Text */}
                                        <div>
                                            <span className="text-[10px] font-medium text-zinc-500 uppercase tracking-wider block mb-1">叠加文案</span>
                                            <textarea value={result.userText} onChange={e => updateText(result.id, e.target.value)} placeholder="输入要叠加的文案..."
                                                className="w-full px-3 py-2 rounded-lg bg-zinc-800 border border-zinc-700 text-zinc-200 text-xs resize-none focus:outline-none focus:ring-1 focus:ring-teal-500/50" rows={2} />
                                        </div>
                                        {/* Final EN */}
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[10px] font-medium text-teal-400 uppercase tracking-wider">✨ English Prompt</span>
                                                <CopyBtn text={result.finalEn} cid={`fen-${result.id}`} />
                                            </div>
                                            <div className="text-sm text-white bg-zinc-800 px-3 py-2.5 rounded-lg border border-teal-500/20 leading-relaxed font-mono">
                                                {result.finalEn || <span className="text-zinc-500 italic">输入文案后自动生成</span>}
                                            </div>
                                        </div>
                                        {/* Final ZH */}
                                        <div>
                                            <div className="flex items-center gap-2 mb-1">
                                                <span className="text-[10px] font-medium text-amber-400 uppercase tracking-wider">✨ 中文 Prompt</span>
                                                <CopyBtn text={result.finalZh} cid={`fzh-${result.id}`} />
                                            </div>
                                            <div className="text-sm text-white bg-zinc-800 px-3 py-2.5 rounded-lg border border-amber-500/20 leading-relaxed font-mono">
                                                {result.finalZh || <span className="text-zinc-500 italic">输入文案后自动生成</span>}
                                            </div>
                                        </div>
                                        {/* Copy Both */}
                                        <div className="flex gap-2">
                                            <CopyBtn text={`${result.finalEn}\n\n${result.finalZh}`} cid={`both-${result.id}`} label="复制双语" />
                                        </div>
                                    </>)}
                                </div>
                                <button onClick={() => setResults(prev => prev.filter(r => r.id !== result.id))} className="shrink-0 self-start p-1.5 text-zinc-600 hover:text-red-400 rounded-lg hover:bg-red-500/10"><Trash2 size={14} /></button>
                            </div>
                        </div>
                    ))}

                    {/* Empty */}
                    {results.length === 0 && (
                        <div className="text-center py-16 text-zinc-600">
                            <ImageIcon size={40} className="mx-auto mb-3 opacity-40" />
                            <p className="text-sm">粘贴或拖入参考图片开始</p>
                            <p className="text-xs mt-1">支持: 直接粘贴图片、图片URL、Google Sheets =IMAGE() 公式</p>
                            <p className="text-xs mt-0.5">AI 会提取中英双语背景描述，并与文案拼装成完整 prompt</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
}
