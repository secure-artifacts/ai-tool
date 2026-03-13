/**
 * SocialMediaRewriteView.tsx
 * 自媒体文案改写模式 - 将讲道/祷告/灵修内容改写为短视频口播稿
 * 
 * 功能:
 * 1. 粘贴原始文案（讲道/祷告/灵修/信仰反思）
 * 2. AI 自动识别内容类型并选择合适模板（A-劝勉警醒/B-祷告/C-讲道翻版）
 * 3. 系统指令完全可编辑
 * 4. 输出分项可自定义（用户可增/删/改输出结构）
 * 5. 支持复制/导出、历史记录
 */

import React, { useState, useRef, useMemo, useCallback, useEffect } from 'react';
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import {
    Play,
    Loader2,
    Copy,
    Check,
    Trash2,
    ChevronDown,
    ChevronUp,
    Sparkles,
    RotateCw,
    FileText,
    Mic,
    BookOpen,
    Church,
    Heart,
    Flame,
    X,
    Clock,
    Hash,
    Plus,
    Settings2,
    Eye,
    EyeOff,
    GripVertical,
    Save,
    RotateCcw
} from 'lucide-react';

// --- Types ---

/** 输出分项定义（用户可自定义） */
interface OutputSection {
    id: string;
    name: string;           // 分项名称，如 "标题（20个）"
    description: string;    // 给 AI 的说明，如 "生成20个适合短视频的标题"
    enabled: boolean;
}

interface RewriteResult {
    id: string;
    originalText: string;
    detectedTemplate: string;       // AI 自动检测到的模板类型
    sections: { name: string; content: string }[];  // 按分项输出
    rawOutput: string;              // 原始输出
    status: 'idle' | 'processing' | 'success' | 'error';
    error?: string;
    createdAt: number;
    collapsed?: boolean;
}

interface SocialMediaRewriteViewProps {
    getAiInstance: () => GoogleGenAI;
    textModel: string;
}

// --- 默认系统指令 ---

const DEFAULT_SYSTEM_INSTRUCTION = `You are a rewriting assistant designed for creators who run Christian faith social media accounts. You transform user-provided sermons, prayers, devotionals, reminders, or faith reflections into engaging short-video narration scripts and social media posts.

You do NOT invent new theology or doctrinal arguments. Your responsibility is to preserve the core spiritual truth while completely rewriting wording, structure, and narrative flow so the result becomes a new piece of content suitable for social media.

All outputs must be written in Chinese, but the communication style should resemble how Christians in Europe and North America commonly speak in testimonies, encouragement, and devotional reflections: sincere, direct, conversational, and grounded in everyday life.

ABSOLUTE REWRITING RULES
- Avoid copyright risk at all costs.
- Do NOT copy the original structure.
- Do NOT mirror original sentence patterns.
- Do NOT keep the same metaphor order.
- Do NOT keep the original sermon pacing.
- Do NOT perform sentence-by-sentence synonym replacement.
- Only retain the core spiritual truth or theme.
- Rebuild the message with new logic, examples, flow, and tone.
- Memorable ideas may remain, but wording must be completely new.

VOICE AND DELIVERY STYLE
The script must sound like a personal spoken reflection rather than a sermon manuscript. Voice profile resembles a calm 45-year-old woman speaking: mature, warm, thoughtful, gentle but firm, emotionally steady, reflective and sincere, speaking to one person rather than preaching to a crowd.

LANGUAGE STYLE
- sincere, warm, emotionally engaging
- conversational like talking with a friend
- suitable for spoken delivery
- clear for fast subtitle reading

Avoid: Chinese-style preaching rhetoric, official language, empty encouragement, lecturing phrases like "我们都应该", exaggerated fear tactics, overly young internet slang, or high-position scolding tone.

CULTURAL EXPRESSION STYLE
Although written in Chinese, narrative logic should resemble Western Christian short-video communication: authentic, conversational, grounded in daily life, using simple scenes or metaphors.

CONTENT GOALS
Scripts should include a strong 3-second hook, clear progression, memorable punchlines, subtitle-friendly rhythm, emotional resonance, and be ready for recording on platforms like TikTok, Reels, Shorts, Instagram, and YouTube Shorts.

HOOK SYSTEM
Use mixed hook techniques such as consequence hooks, precise targeting hooks, and negative disruption hooks, and draw from 23 hook styles including questions, contrast, suspense, pain points, curiosity, reversal, emotional triggers, and targeted addressing.

TITLE RULES
Each response provides 20 titles combining elements such as numbers, contrast, warnings, questions, suspense, targeting, pain points, and consequence framing. Titles should resemble Western Christian short-video titles: direct, emotionally clear, and theme-focused, avoiding exaggerated Chinese clickbait.

BIBLE VERSE HANDLING
Scripture must be accurate, integrated naturally, introduced with phrases like "圣经说""耶稣说""经上提醒我们", and not stacked or quoted excessively.

NON-NEGOTIABLE BOUNDARIES
Never produce near-duplicate rewrites, synonym swaps, influencer-style youth tone, official sermon manuscripts, overly Chinese rhetorical style, forced scripture, or collective "我们" preaching. Never ignore the user's requested format.

Always ensure copyright-safe rewriting, natural spoken delivery, mature tone, Western Christian communication style, strong hooks, strong titles, clear logic, and engaging endings.

AUTO TEMPLATE SELECTION
You must automatically detect the content type and apply the appropriate template:

Template A — 劝勉/警醒类：开头钩子 → 主题展开 → 经文支撑 → 警示提醒 → 互动结尾
Template B — 祷告类：开头钩子 → 祷告前衔接语 → 祷告正文 → 温柔互动结尾
Template C — 讲道翻版类：强钩子 → 全新比喻或生活场景 → 保留主题真理 → 口语化展开 → 结尾呼召

WESTERN CHRISTIAN LIFE PAIN-POINT LIBRARY
Examples should prioritize situations common among Western Christians such as marriage struggles, divorce recovery, relational loneliness, career burnout, layoffs, mortgage or student-loan pressure, parenting conflict, anxiety, depression, self-doubt, comparison pressure, and uncertainty about the future.

The user may provide additional rule lists or repeat commands; treat them as authoritative instructions and integrate them into behavior when appropriate.`;

// --- 默认输出分项 ---

const DEFAULT_OUTPUT_SECTIONS: OutputSection[] = [
    {
        id: 'titles',
        name: '标题（20个）',
        description: '生成20个适合短视频平台的标题，结合数字、对比、警示、提问、悬念、痛点、后果框架等元素。风格模仿西方基督教短视频标题：直接、情感清晰、主题聚焦，避免夸张的中文标题党。',
        enabled: true,
    },
    {
        id: 'script',
        name: '正文口播稿',
        description: '完整的口播稿正文，结构：开头钩子（3秒内抓住注意力） → 主体推进 → 经文自然融入 → 情绪递进 → 结尾互动。口语化、适合对镜头录制，节奏感强，适合快速字幕阅读。结尾互动语直接融入正文末尾。',
        enabled: true,
    },
];

// --- Build User Prompt ---
const buildUserPrompt = (text: string, sections: OutputSection[]) => {
    const enabledSections = sections.filter(s => s.enabled);

    const sectionInstructions = enabledSections.map((s, idx) => {
        return `${idx + 1}. 【${s.name}】\n   要求: ${s.description}`;
    }).join('\n\n');

    const sectionMarkers = enabledSections.map(s => `===【${s.name}】===`).join('\n...\n');

    return `请根据以下原始文案进行完全改写。

【自动模板选择】
请先判断这段文案的类型（劝勉/警醒、祷告、讲道），然后自动选择最合适的模板进行改写。
在输出开头标注你选择的模板：===TEMPLATE=== [模板名称]

【输出分项要求】
请严格按照以下分项输出，每个分项用对应的标记分隔：

${sectionInstructions}

【输出格式】
===TEMPLATE=== [你自动选择的模板名称]

${sectionMarkers}

【原始文案】
${text}`;
};

// --- Parse Response ---
const parseResponse = (response: string, sections: OutputSection[]): { detectedTemplate: string; parsedSections: { name: string; content: string }[] } => {
    let detectedTemplate = '自动';

    // Extract template
    const templateMatch = response.match(/===TEMPLATE===\s*(.+?)(?:\n|$)/);
    if (templateMatch) {
        detectedTemplate = templateMatch[1].trim();
    }

    const enabledSections = sections.filter(s => s.enabled);
    const parsedSections: { name: string; content: string }[] = [];

    // Try to parse each section by looking for ===【name】=== markers
    for (let i = 0; i < enabledSections.length; i++) {
        const section = enabledSections[i];
        const marker = `===【${section.name}】===`;
        const nextSection = enabledSections[i + 1];
        const nextMarker = nextSection ? `===【${nextSection.name}】===` : null;

        const startIdx = response.indexOf(marker);
        if (startIdx === -1) {
            // Try without === wrapper
            const altMarker = `【${section.name}】`;
            const altStartIdx = response.indexOf(altMarker);
            if (altStartIdx !== -1) {
                const contentStart = altStartIdx + altMarker.length;
                let contentEnd = response.length;
                if (nextMarker) {
                    const nextIdx = response.indexOf(nextMarker, contentStart);
                    const nextAltIdx = response.indexOf(`【${nextSection!.name}】`, contentStart);
                    if (nextIdx !== -1) contentEnd = nextIdx;
                    else if (nextAltIdx !== -1) contentEnd = nextAltIdx;
                }
                parsedSections.push({
                    name: section.name,
                    content: response.slice(contentStart, contentEnd).trim()
                });
            } else {
                parsedSections.push({ name: section.name, content: '' });
            }
            continue;
        }

        const contentStart = startIdx + marker.length;
        let contentEnd = response.length;
        if (nextMarker) {
            const nextIdx = response.indexOf(nextMarker, contentStart);
            const nextAltIdx = response.indexOf(`【${nextSection!.name}】`, contentStart);
            if (nextIdx !== -1) contentEnd = nextIdx;
            else if (nextAltIdx !== -1) contentEnd = nextAltIdx;
        }

        parsedSections.push({
            name: section.name,
            content: response.slice(contentStart, contentEnd).trim()
        });
    }

    // If nothing parsed well, put everything in first section
    if (parsedSections.every(s => !s.content) && enabledSections.length > 0) {
        // Remove template line and use the rest
        const cleanedResponse = response.replace(/===TEMPLATE===.*?\n/, '').trim();
        parsedSections[0] = { name: enabledSections[0].name, content: cleanedResponse };
    }

    return { detectedTemplate, parsedSections };
};

// --- Storage ---
const STORAGE_KEY = 'social_media_rewrite_state_v2';
const SECTIONS_STORAGE_KEY = 'social_media_rewrite_sections_v1';
const SYSTEM_PROMPT_STORAGE_KEY = 'social_media_rewrite_system_prompt_v1';

// --- Component ---

export function SocialMediaRewriteView({ getAiInstance, textModel }: SocialMediaRewriteViewProps) {
    // --- State ---
    const [inputText, setInputText] = useState('');
    const [results, setResults] = useState<RewriteResult[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) return JSON.parse(saved).results || [];
        } catch { /* ignore */ }
        return [];
    });
    const [isProcessing, setIsProcessing] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // 系统指令（可编辑）
    const [systemPrompt, setSystemPrompt] = useState(() => {
        try {
            const saved = localStorage.getItem(SYSTEM_PROMPT_STORAGE_KEY);
            if (saved) return saved;
        } catch { /* ignore */ }
        return DEFAULT_SYSTEM_INSTRUCTION;
    });
    const [showSystemPrompt, setShowSystemPrompt] = useState(false);
    const [systemPromptDirty, setSystemPromptDirty] = useState(false);

    // 输出分项（可自定义）
    const [outputSections, setOutputSections] = useState<OutputSection[]>(() => {
        try {
            const saved = localStorage.getItem(SECTIONS_STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch { /* ignore */ }
        return DEFAULT_OUTPUT_SECTIONS.map(s => ({ ...s }));
    });
    const [showSectionEditor, setShowSectionEditor] = useState(false);
    const [editingSectionId, setEditingSectionId] = useState<string | null>(null);

    const stopRef = useRef(false);
    const resultsEndRef = useRef<HTMLDivElement>(null);

    // Persist state
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                results: results.map(r => ({
                    ...r,
                    originalText: r.originalText.slice(0, 5000)
                }))
            }));
        } catch { /* ignore */ }
    }, [results]);

    // Persist sections config
    useEffect(() => {
        try {
            localStorage.setItem(SECTIONS_STORAGE_KEY, JSON.stringify(outputSections));
        } catch { /* ignore */ }
    }, [outputSections]);

    // Persist system prompt
    useEffect(() => {
        try {
            localStorage.setItem(SYSTEM_PROMPT_STORAGE_KEY, systemPrompt);
        } catch { /* ignore */ }
    }, [systemPrompt]);

    // --- Handlers ---

    const handleGenerate = useCallback(async () => {
        if (!inputText.trim() || isProcessing) return;

        const enabledSections = outputSections.filter(s => s.enabled);
        if (enabledSections.length === 0) return;

        stopRef.current = false;
        setIsProcessing(true);

        const newResult: RewriteResult = {
            id: uuidv4(),
            originalText: inputText.trim(),
            detectedTemplate: '',
            sections: [],
            rawOutput: '',
            status: 'processing',
            createdAt: Date.now(),
        };

        setResults(prev => [newResult, ...prev]);

        try {
            const ai = getAiInstance();
            const userPrompt = buildUserPrompt(inputText.trim(), outputSections);

            const response = await ai.models.generateContent({
                model: textModel || 'gemini-3-flash-preview',
                contents: userPrompt,
                config: {
                    systemInstruction: systemPrompt,
                    temperature: 0.9,
                    topP: 0.95,
                    maxOutputTokens: 8192,
                }
            });

            if (stopRef.current) {
                setResults(prev => prev.map(r =>
                    r.id === newResult.id ? { ...r, status: 'error', error: '已取消' } : r
                ));
                setIsProcessing(false);
                return;
            }

            const text = response?.text || '';
            const { detectedTemplate, parsedSections } = parseResponse(text, outputSections);

            setResults(prev => prev.map(r =>
                r.id === newResult.id
                    ? { ...r, detectedTemplate, sections: parsedSections, rawOutput: text, status: 'success' }
                    : r
            ));
        } catch (error: any) {
            console.error('[SocialMediaRewrite] Error:', error);
            setResults(prev => prev.map(r =>
                r.id === newResult.id
                    ? { ...r, status: 'error', error: error?.message || '生成失败' }
                    : r
            ));
        } finally {
            setIsProcessing(false);
        }
    }, [inputText, isProcessing, getAiInstance, textModel, systemPrompt, outputSections]);

    const handleStop = () => { stopRef.current = true; };

    const handleDelete = (id: string) => {
        setResults(prev => prev.filter(r => r.id !== id));
    };

    const handleClearAll = () => { setResults([]); };

    const handleToggleCollapse = (id: string) => {
        setResults(prev => prev.map(r =>
            r.id === id ? { ...r, collapsed: !r.collapsed } : r
        ));
    };

    const handleCopy = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch { /* ignore */ }
    };

    const handleCopyAll = async (result: RewriteResult) => {
        const fullText = result.sections.map(s => `【${s.name}】\n${s.content}`).join('\n\n');
        await handleCopy(fullText, `all-${result.id}`);
    };

    const handleRegenerate = (result: RewriteResult) => {
        setInputText(result.originalText);
        window.scrollTo({ top: 0, behavior: 'smooth' });
    };

    // --- Section Editor Handlers ---

    const handleAddSection = () => {
        const newSection: OutputSection = {
            id: uuidv4(),
            name: '新分项',
            description: '请在此描述这个分项的输出要求...',
            enabled: true,
        };
        setOutputSections(prev => [...prev, newSection]);
        setEditingSectionId(newSection.id);
    };

    const handleDeleteSection = (id: string) => {
        setOutputSections(prev => prev.filter(s => s.id !== id));
    };

    const handleToggleSection = (id: string) => {
        setOutputSections(prev => prev.map(s =>
            s.id === id ? { ...s, enabled: !s.enabled } : s
        ));
    };

    const handleUpdateSection = (id: string, field: 'name' | 'description', value: string) => {
        setOutputSections(prev => prev.map(s =>
            s.id === id ? { ...s, [field]: value } : s
        ));
    };

    const handleResetSections = () => {
        setOutputSections(DEFAULT_OUTPUT_SECTIONS.map(s => ({ ...s })));
        setEditingSectionId(null);
    };

    const handleResetSystemPrompt = () => {
        setSystemPrompt(DEFAULT_SYSTEM_INSTRUCTION);
        setSystemPromptDirty(false);
    };

    const enabledSectionCount = outputSections.filter(s => s.enabled).length;

    // --- Section color mapping ---
    const sectionColors = [
        { border: 'border-amber-500/30', bg: 'bg-amber-500/10', text: 'text-amber-400', icon: <Hash className="w-3.5 h-3.5" /> },
        { border: 'border-emerald-500/30', bg: 'bg-emerald-500/10', text: 'text-emerald-400', icon: <Mic className="w-3.5 h-3.5" /> },
        { border: 'border-sky-500/30', bg: 'bg-sky-500/10', text: 'text-sky-400', icon: <Heart className="w-3.5 h-3.5" /> },
        { border: 'border-violet-500/30', bg: 'bg-violet-500/10', text: 'text-violet-400', icon: <Sparkles className="w-3.5 h-3.5" /> },
        { border: 'border-rose-500/30', bg: 'bg-rose-500/10', text: 'text-rose-400', icon: <Flame className="w-3.5 h-3.5" /> },
        { border: 'border-teal-500/30', bg: 'bg-teal-500/10', text: 'text-teal-400', icon: <BookOpen className="w-3.5 h-3.5" /> },
    ];

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto" style={{ scrollBehavior: 'smooth' }}>
                <div className="max-w-6xl mx-auto px-4 py-6 space-y-5">

                    {/* === 标题区 === */}
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <div className="bg-gradient-to-br from-teal-500/30 to-cyan-500/30 p-2 rounded-xl">
                                    <Church className="w-5 h-5 text-teal-400" />
                                </div>
                                自媒体文案改写
                            </h2>
                            <p className="text-xs text-zinc-500 mt-1">
                                AI 自动识别内容类型，改写为 TikTok / Reels / Shorts 口播稿
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                            {results.length > 0 && (
                                <button
                                    onClick={handleClearAll}
                                    className="text-xs text-zinc-500 hover:text-red-400 transition-colors flex items-center gap-1"
                                    title="清空所有历史"
                                >
                                    <Trash2 className="w-3.5 h-3.5" />
                                    清空
                                </button>
                            )}
                        </div>
                    </div>

                    {/* === 设置区：系统指令 + 输出分项 === */}
                    <div className="grid grid-cols-1 gap-3">

                        {/* 系统指令 - 折叠面板 */}
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden">
                            <button
                                onClick={() => setShowSystemPrompt(!showSystemPrompt)}
                                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/30 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <Settings2 className="w-4 h-4 text-teal-400" />
                                    <span className="text-xs font-medium text-zinc-300">系统指令</span>
                                    {systemPrompt !== DEFAULT_SYSTEM_INSTRUCTION && (
                                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-400">已修改</span>
                                    )}
                                </div>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-zinc-600">{systemPrompt.length} 字符</span>
                                    {showSystemPrompt ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                                </div>
                            </button>
                            {showSystemPrompt && (
                                <div className="px-4 pb-4 space-y-2 border-t border-zinc-800/50">
                                    <div className="flex items-center justify-between pt-2">
                                        <span className="text-[10px] text-zinc-500">编辑系统指令以调整改写风格、规则和行为</span>
                                        <button
                                            onClick={handleResetSystemPrompt}
                                            className="text-[10px] text-zinc-500 hover:text-amber-400 flex items-center gap-1 transition-colors"
                                        >
                                            <RotateCcw className="w-3 h-3" />
                                            重置默认
                                        </button>
                                    </div>
                                    <textarea
                                        value={systemPrompt}
                                        onChange={e => setSystemPrompt(e.target.value)}
                                        rows={16}
                                        className="w-full bg-zinc-950/50 border border-zinc-700/50 rounded-lg px-3 py-2.5 text-xs text-zinc-300 placeholder:text-zinc-600 resize-y focus:outline-none focus:ring-1 focus:ring-teal-500/30 font-mono leading-relaxed"
                                        style={{ minHeight: '200px' }}
                                    />
                                </div>
                            )}
                        </div>

                        {/* 输出分项设置 - 折叠面板 */}
                        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden">
                            <button
                                onClick={() => setShowSectionEditor(!showSectionEditor)}
                                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/30 transition-colors"
                            >
                                <div className="flex items-center gap-2">
                                    <FileText className="w-4 h-4 text-teal-400" />
                                    <span className="text-xs font-medium text-zinc-300">输出分项</span>
                                    <span className="text-[10px] text-zinc-500">({enabledSectionCount} 个启用)</span>
                                    {/* 显示当前启用的分项标签 */}
                                    <div className="hidden sm:flex items-center gap-1 ml-1">
                                        {outputSections.filter(s => s.enabled).map((s, i) => (
                                            <span key={s.id} className={`px-1.5 py-0.5 rounded text-[9px] ${sectionColors[i % sectionColors.length].bg} ${sectionColors[i % sectionColors.length].text}`}>
                                                {s.name}
                                            </span>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    {showSectionEditor ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                                </div>
                            </button>
                            {showSectionEditor && (
                                <div className="px-4 pb-4 space-y-3 border-t border-zinc-800/50 pt-3">
                                    <div className="flex items-center justify-between">
                                        <span className="text-[10px] text-zinc-500">自定义输出结构 - 每个分项会指导 AI 输出对应内容</span>
                                        <div className="flex items-center gap-2">
                                            <button
                                                onClick={handleResetSections}
                                                className="text-[10px] text-zinc-500 hover:text-amber-400 flex items-center gap-1 transition-colors"
                                            >
                                                <RotateCcw className="w-3 h-3" />
                                                重置默认
                                            </button>
                                            <button
                                                onClick={handleAddSection}
                                                className="text-[10px] text-teal-400 hover:text-teal-300 flex items-center gap-1 transition-colors"
                                            >
                                                <Plus className="w-3 h-3" />
                                                添加分项
                                            </button>
                                        </div>
                                    </div>

                                    <div className="space-y-2">
                                        {outputSections.map((section, idx) => {
                                            const color = sectionColors[idx % sectionColors.length];
                                            const isEditing = editingSectionId === section.id;
                                            return (
                                                <div
                                                    key={section.id}
                                                    className={`border rounded-lg transition-all ${section.enabled ? `${color.border} ${color.bg}` : 'border-zinc-800 bg-zinc-900/30 opacity-60'
                                                        }`}
                                                >
                                                    <div className="flex items-center gap-2 px-3 py-2">
                                                        {/* Enable toggle */}
                                                        <button
                                                            onClick={() => handleToggleSection(section.id)}
                                                            className={`w-4 h-4 rounded border flex items-center justify-center shrink-0 transition-colors ${section.enabled
                                                                ? `${color.border} ${color.bg}`
                                                                : 'border-zinc-700 bg-zinc-800'
                                                                }`}
                                                        >
                                                            {section.enabled && <Check className={`w-2.5 h-2.5 ${color.text}`} />}
                                                        </button>

                                                        {/* Section name */}
                                                        {isEditing ? (
                                                            <input
                                                                type="text"
                                                                value={section.name}
                                                                onChange={e => handleUpdateSection(section.id, 'name', e.target.value)}
                                                                className="flex-1 bg-transparent border-b border-zinc-600 text-xs text-zinc-200 focus:outline-none focus:border-teal-500 px-1 py-0.5"
                                                                autoFocus
                                                            />
                                                        ) : (
                                                            <span
                                                                className={`flex-1 text-xs font-medium cursor-pointer ${section.enabled ? 'text-zinc-200' : 'text-zinc-500'}`}
                                                                onDoubleClick={() => setEditingSectionId(section.id)}
                                                                title="双击编辑名称"
                                                            >
                                                                {color.icon}
                                                                <span className="ml-1.5">{section.name}</span>
                                                            </span>
                                                        )}

                                                        {/* Actions */}
                                                        <button
                                                            onClick={() => setEditingSectionId(isEditing ? null : section.id)}
                                                            className={`p-1 rounded text-zinc-500 hover:text-zinc-300 transition-colors ${isEditing ? 'bg-zinc-800' : ''}`}
                                                            title={isEditing ? '关闭编辑' : '编辑'}
                                                        >
                                                            {isEditing ? <Check className="w-3 h-3" /> : <Settings2 className="w-3 h-3" />}
                                                        </button>
                                                        <button
                                                            onClick={() => handleDeleteSection(section.id)}
                                                            className="p-1 rounded text-zinc-600 hover:text-red-400 transition-colors"
                                                            title="删除"
                                                        >
                                                            <X className="w-3 h-3" />
                                                        </button>
                                                    </div>

                                                    {/* Description editor */}
                                                    {isEditing && (
                                                        <div className="px-3 pb-3">
                                                            <textarea
                                                                value={section.description}
                                                                onChange={e => handleUpdateSection(section.id, 'description', e.target.value)}
                                                                rows={3}
                                                                className="w-full bg-zinc-950/50 border border-zinc-700/50 rounded-lg px-2.5 py-2 text-[11px] text-zinc-300 placeholder:text-zinc-600 resize-y focus:outline-none focus:ring-1 focus:ring-teal-500/30 leading-relaxed"
                                                                placeholder="描述这个分项的输出要求，AI 会根据说明生成对应内容..."
                                                            />
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>

                    {/* === 输入框 + 生成按钮 === */}
                    <div className="space-y-3">
                        <div className="relative">
                            <textarea
                                value={inputText}
                                onChange={e => setInputText(e.target.value)}
                                placeholder="粘贴原始讲道 / 祷告 / 灵修 / 信仰反思文案..."
                                rows={8}
                                className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 resize-y focus:outline-none focus:ring-2 focus:ring-teal-500/30 focus:border-teal-500/30 transition-all"
                                disabled={isProcessing}
                            />
                            <div className="absolute bottom-3 right-3 flex items-center gap-2">
                                <span className="text-[10px] text-zinc-600">
                                    {inputText.length} 字
                                </span>
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            {isProcessing ? (
                                <button
                                    onClick={handleStop}
                                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium text-sm transition-all"
                                >
                                    <X className="w-4 h-4" />
                                    停止生成
                                </button>
                            ) : (
                                <button
                                    onClick={handleGenerate}
                                    disabled={!inputText.trim() || enabledSectionCount === 0}
                                    className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium text-sm transition-all ${inputText.trim() && enabledSectionCount > 0
                                        ? 'bg-gradient-to-r from-teal-500 to-cyan-500 hover:from-teal-600 hover:to-cyan-600 text-white shadow-lg shadow-teal-500/20'
                                        : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                        }`}
                                >
                                    <Sparkles className="w-4 h-4" />
                                    生成口播稿
                                </button>
                            )}

                            <span className="text-[10px] text-zinc-600">
                                AI 自动识别模板 · {enabledSectionCount} 个输出分项
                            </span>
                        </div>
                    </div>

                    {/* === 结果列表 === */}
                    {results.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center gap-2">
                                <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-zinc-500" />
                                    生成结果
                                    <span className="text-xs text-zinc-500">({results.filter(r => r.status === 'success').length})</span>
                                </h3>
                            </div>

                            {results.map(result => (
                                <div
                                    key={result.id}
                                    className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden transition-all"
                                >
                                    {/* Result Header */}
                                    <div
                                        className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-zinc-800/30 transition-colors"
                                        onClick={() => handleToggleCollapse(result.id)}
                                    >
                                        <div className={`shrink-0 p-1.5 rounded-lg ${result.status === 'processing' ? 'bg-teal-500/20'
                                            : result.status === 'success' ? 'bg-emerald-500/20'
                                                : result.status === 'error' ? 'bg-red-500/20'
                                                    : 'bg-zinc-800'
                                            }`}>
                                            {result.status === 'processing' ? (
                                                <Loader2 className="w-4 h-4 text-teal-400 animate-spin" />
                                            ) : result.status === 'success' ? (
                                                <Check className="w-4 h-4 text-emerald-400" />
                                            ) : result.status === 'error' ? (
                                                <X className="w-4 h-4 text-red-400" />
                                            ) : (
                                                <FileText className="w-4 h-4 text-zinc-500" />
                                            )}
                                        </div>

                                        <div className="flex-1 min-w-0">
                                            <div className="flex items-center gap-2">
                                                {result.detectedTemplate && (
                                                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium bg-teal-500/15 text-teal-400 border border-teal-500/20">
                                                        <Sparkles className="w-3 h-3" />
                                                        {result.detectedTemplate}
                                                    </span>
                                                )}
                                                <span className="text-xs text-zinc-500">
                                                    {new Date(result.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                {result.sections.length > 0 && (
                                                    <span className="text-[10px] text-zinc-600">
                                                        {result.sections.filter(s => s.content).length} 个分项
                                                    </span>
                                                )}
                                            </div>
                                            <p className="text-xs text-zinc-500 truncate mt-0.5">
                                                {result.originalText.slice(0, 100)}...
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                            {result.status === 'success' && (
                                                <>
                                                    <button
                                                        onClick={() => handleCopyAll(result)}
                                                        className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                                                        title="复制全部"
                                                    >
                                                        {copiedId === `all-${result.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                                                    </button>
                                                    <button
                                                        onClick={() => handleRegenerate(result)}
                                                        className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                                                        title="重新生成"
                                                    >
                                                        <RotateCw className="w-3.5 h-3.5" />
                                                    </button>
                                                </>
                                            )}
                                            <button
                                                onClick={() => handleDelete(result.id)}
                                                className="p-1.5 rounded-lg text-zinc-500 hover:text-red-400 hover:bg-zinc-800 transition-colors"
                                                title="删除"
                                            >
                                                <Trash2 className="w-3.5 h-3.5" />
                                            </button>
                                            <div className="text-zinc-600">
                                                {result.collapsed ? <ChevronDown className="w-4 h-4" /> : <ChevronUp className="w-4 h-4" />}
                                            </div>
                                        </div>
                                    </div>

                                    {/* Result Content - Dynamic sections */}
                                    {!result.collapsed && result.status === 'success' && (
                                        <div className="border-t border-zinc-800/50">
                                            {/* Sections rendered dynamically based on what was returned */}
                                            <div className={`grid ${result.sections.filter(s => s.content).length >= 2 ? 'grid-cols-1 lg:grid-cols-2' : 'grid-cols-1'} divide-y lg:divide-y-0 lg:divide-x divide-zinc-800/50`}>
                                                {result.sections.filter(s => s.content).map((section, idx) => {
                                                    const color = sectionColors[idx % sectionColors.length];
                                                    const copyId = `section-${result.id}-${idx}`;
                                                    return (
                                                        <div key={idx} className="p-4">
                                                            <div className="flex items-center justify-between mb-3">
                                                                <h4 className={`text-xs font-semibold ${color.text} flex items-center gap-1.5`}>
                                                                    {color.icon}
                                                                    {section.name}
                                                                </h4>
                                                                <button
                                                                    onClick={() => handleCopy(section.content, copyId)}
                                                                    className="text-[10px] text-zinc-500 hover:text-zinc-300 flex items-center gap-1 transition-colors"
                                                                >
                                                                    {copiedId === copyId ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                                                    复制
                                                                </button>
                                                            </div>
                                                            <div className="bg-zinc-950/50 border border-zinc-800/50 rounded-lg p-4 max-h-[500px] overflow-y-auto custom-scrollbar">
                                                                <div className="text-sm text-zinc-300 leading-relaxed whitespace-pre-wrap">
                                                                    {section.content}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>

                                            {/* 原文预览 */}
                                            <details className="border-t border-zinc-800/50">
                                                <summary className="px-4 py-2 text-[10px] text-zinc-600 hover:text-zinc-400 cursor-pointer transition-colors">
                                                    📄 查看原始文案
                                                </summary>
                                                <div className="px-4 pb-3">
                                                    <div className="bg-zinc-950/50 border border-zinc-800/30 rounded-lg p-3 max-h-[200px] overflow-y-auto custom-scrollbar">
                                                        <p className="text-xs text-zinc-500 leading-relaxed whitespace-pre-wrap">
                                                            {result.originalText}
                                                        </p>
                                                    </div>
                                                </div>
                                            </details>

                                            {/* 原始输出 */}
                                            <details className="border-t border-zinc-800/50">
                                                <summary className="px-4 py-2 text-[10px] text-zinc-600 hover:text-zinc-400 cursor-pointer transition-colors">
                                                    🔍 查看原始 AI 输出
                                                </summary>
                                                <div className="px-4 pb-3">
                                                    <div className="bg-zinc-950/50 border border-zinc-800/30 rounded-lg p-3 max-h-[300px] overflow-y-auto custom-scrollbar">
                                                        <pre className="text-xs text-zinc-500 leading-relaxed whitespace-pre-wrap font-mono">
                                                            {result.rawOutput}
                                                        </pre>
                                                    </div>
                                                </div>
                                            </details>
                                        </div>
                                    )}

                                    {/* Processing state */}
                                    {!result.collapsed && result.status === 'processing' && (
                                        <div className="border-t border-zinc-800/50 p-8 flex flex-col items-center justify-center gap-3">
                                            <div className="relative">
                                                <div className="w-12 h-12 rounded-full bg-gradient-to-r from-teal-500/20 to-cyan-500/20 animate-pulse" />
                                                <Loader2 className="w-6 h-6 text-teal-400 animate-spin absolute top-3 left-3" />
                                            </div>
                                            <p className="text-xs text-zinc-500">正在改写文案...</p>
                                            <p className="text-[10px] text-zinc-600">
                                                AI 正在自动识别模板并完全重构内容
                                            </p>
                                        </div>
                                    )}

                                    {/* Error state */}
                                    {!result.collapsed && result.status === 'error' && (
                                        <div className="border-t border-zinc-800/50 p-4">
                                            <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                                                <p className="text-xs text-red-400">{result.error || '生成失败'}</p>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                            <div ref={resultsEndRef} />
                        </div>
                    )}

                    {/* Empty State */}
                    {results.length === 0 && !isProcessing && (
                        <div className="flex flex-col items-center justify-center py-16 text-center">
                            <div className="w-20 h-20 rounded-2xl bg-gradient-to-br from-teal-500/10 to-cyan-500/10 flex items-center justify-center mb-4">
                                <Church className="w-10 h-10 text-teal-500/40" />
                            </div>
                            <h3 className="text-sm font-medium text-zinc-400 mb-2">自媒体文案改写工具</h3>
                            <p className="text-xs text-zinc-600 max-w-md leading-relaxed">
                                将讲道、祷告、灵修内容改写为适合短视频平台的口播稿。
                                AI 自动识别内容类型并选择最佳模板，保留核心灵性真理，
                                完全重建措辞、结构和叙述逻辑，确保版权安全。
                            </p>
                            <div className="flex flex-wrap items-center justify-center gap-2 mt-4">
                                {['TikTok', 'Reels', 'Shorts', 'Instagram', 'YouTube'].map(platform => (
                                    <span key={platform} className="px-2 py-1 rounded-full bg-zinc-900 border border-zinc-800 text-[10px] text-zinc-500">
                                        {platform}
                                    </span>
                                ))}
                            </div>
                        </div>
                    )}
                </div>
            </div>

            <style>{`
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: rgba(113, 113, 122, 0.3);
                    border-radius: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: rgba(113, 113, 122, 0.5);
                }
            `}</style>
        </div>
    );
}
