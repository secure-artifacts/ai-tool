/**
 * SuperRewriteView.tsx
 * 超级文案改写 - 三指令并行 + 智能配对
 * 
 * 功能:
 * 1. 三条独立指令（标题/正文/结尾）基于原始文案并行生成
 * 2. 正文改写可选（开关控制），关闭时直接用原文
 * 3. 标题/结尾支持不固定数量和类型（[类型标签] 内容 格式）
 * 4. AI智能配对 / 顺序配对 / 全组合 三种配对模式
 * 5. 四列输出：标题 | 正文 | 结尾 | 完整文案
 * 6. 指令预设管理、历史记录持久化
 */

import React, { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import { playCompletionSound } from '@/utils/soundNotification';
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
    X,
    Clock,
    Settings2,
    Search,
    Globe,
    FileText,
    Type,
    AlignLeft,
    MessageSquareQuote,
    Columns,
    Shuffle,
    ArrowDownUp,
    Grid3X3,
    Zap,
    ToggleLeft,
    ToggleRight,
    List,
    ShieldCheck
} from 'lucide-react';
import { useScriptureDeitySettings, ScriptureDeitySettingsPanel } from './components/ScriptureDeitySettings';

// --- Language List (comprehensive, searchable by zh/en/native) ---
const ALL_LANGUAGES = [
    { code: 'auto', zh: '跟从指令', en: 'Follow Instruction', native: '' },
    { code: 'zh', zh: '中文', en: 'Chinese', native: '中文' },
    { code: 'en', zh: '英文', en: 'English', native: 'English' },
    { code: 'es', zh: '西班牙语', en: 'Spanish', native: 'Español' },
    { code: 'fr', zh: '法语', en: 'French', native: 'Français' },
    { code: 'de', zh: '德语', en: 'German', native: 'Deutsch' },
    { code: 'pt', zh: '葡萄牙语', en: 'Portuguese', native: 'Português' },
    { code: 'ru', zh: '俄语', en: 'Russian', native: 'Русский' },
    { code: 'ja', zh: '日语', en: 'Japanese', native: '日本語' },
    { code: 'ko', zh: '韩语', en: 'Korean', native: '한국어' },
    { code: 'ar', zh: '阿拉伯语', en: 'Arabic', native: 'العربية' },
    { code: 'hi', zh: '印地语', en: 'Hindi', native: 'हिन्दी' },
    { code: 'bn', zh: '孟加拉语', en: 'Bengali', native: 'বাংলা' },
    { code: 'id', zh: '印尼语', en: 'Indonesian', native: 'Bahasa Indonesia' },
    { code: 'ms', zh: '马来语', en: 'Malay', native: 'Bahasa Melayu' },
    { code: 'th', zh: '泰语', en: 'Thai', native: 'ภาษาไทย' },
    { code: 'vi', zh: '越南语', en: 'Vietnamese', native: 'Tiếng Việt' },
    { code: 'tl', zh: '菲律宾语', en: 'Filipino', native: 'Filipino' },
    { code: 'tr', zh: '土耳其语', en: 'Turkish', native: 'Türkçe' },
    { code: 'pl', zh: '波兰语', en: 'Polish', native: 'Polski' },
    { code: 'uk', zh: '乌克兰语', en: 'Ukrainian', native: 'Українська' },
    { code: 'nl', zh: '荷兰语', en: 'Dutch', native: 'Nederlands' },
    { code: 'it', zh: '意大利语', en: 'Italian', native: 'Italiano' },
    { code: 'el', zh: '希腊语', en: 'Greek', native: 'Ελληνικά' },
    { code: 'cs', zh: '捷克语', en: 'Czech', native: 'Čeština' },
    { code: 'sv', zh: '瑞典语', en: 'Swedish', native: 'Svenska' },
    { code: 'da', zh: '丹麦语', en: 'Danish', native: 'Dansk' },
    { code: 'fi', zh: '芬兰语', en: 'Finnish', native: 'Suomi' },
    { code: 'no', zh: '挪威语', en: 'Norwegian', native: 'Norsk' },
    { code: 'hu', zh: '匈牙利语', en: 'Hungarian', native: 'Magyar' },
    { code: 'ro', zh: '罗马尼亚语', en: 'Romanian', native: 'Română' },
    { code: 'he', zh: '希伯来语', en: 'Hebrew', native: 'עברית' },
    { code: 'fa', zh: '波斯语', en: 'Persian', native: 'فارسی' },
    { code: 'ur', zh: '乌尔都语', en: 'Urdu', native: 'اردو' },
    { code: 'sw', zh: '斯瓦希里语', en: 'Swahili', native: 'Kiswahili' },
    { code: 'ta', zh: '泰米尔语', en: 'Tamil', native: 'தமிழ்' },
    { code: 'te', zh: '泰卢固语', en: 'Telugu', native: 'తెలుగు' },
    { code: 'ml', zh: '马拉雅拉姆语', en: 'Malayalam', native: 'മലയാളം' },
    { code: 'mr', zh: '马拉地语', en: 'Marathi', native: 'मराठी' },
    { code: 'gu', zh: '古吉拉特语', en: 'Gujarati', native: 'ગુજરાતી' },
    { code: 'kn', zh: '卡纳达语', en: 'Kannada', native: 'ಕನ್ನಡ' },
    { code: 'pa', zh: '旁遮普语', en: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
    { code: 'my', zh: '缅甸语', en: 'Burmese', native: 'မြန်မာ' },
    { code: 'km', zh: '高棉语', en: 'Khmer', native: 'ភាសាខ្មែរ' },
    { code: 'lo', zh: '老挝语', en: 'Lao', native: 'ພາສາລາວ' },
    { code: 'si', zh: '僧伽罗语', en: 'Sinhala', native: 'සිංහල' },
    { code: 'ne', zh: '尼泊尔语', en: 'Nepali', native: 'नेपाली' },
    { code: 'am', zh: '阿姆哈拉语', en: 'Amharic', native: 'አማርኛ' },
    { code: 'yo', zh: '约鲁巴语', en: 'Yoruba', native: 'Yorùbá' },
    { code: 'ig', zh: '伊博语', en: 'Igbo', native: 'Igbo' },
    { code: 'zu', zh: '祖鲁语', en: 'Zulu', native: 'isiZulu' },
    { code: 'af', zh: '南非荷兰语', en: 'Afrikaans', native: 'Afrikaans' },
    { code: 'ha', zh: '豪萨语', en: 'Hausa', native: 'Hausa' },
    { code: 'fil', zh: '他加禄语', en: 'Tagalog', native: 'Tagalog' },
    { code: 'bg', zh: '保加利亚语', en: 'Bulgarian', native: 'Български' },
    { code: 'hr', zh: '克罗地亚语', en: 'Croatian', native: 'Hrvatski' },
    { code: 'sk', zh: '斯洛伐克语', en: 'Slovak', native: 'Slovenčina' },
    { code: 'sl', zh: '斯洛文尼亚语', en: 'Slovenian', native: 'Slovenščina' },
    { code: 'lt', zh: '立陶宛语', en: 'Lithuanian', native: 'Lietuvių' },
    { code: 'lv', zh: '拉脱维亚语', en: 'Latvian', native: 'Latviešu' },
    { code: 'et', zh: '爱沙尼亚语', en: 'Estonian', native: 'Eesti' },
    { code: 'ka', zh: '格鲁吉亚语', en: 'Georgian', native: 'ქართული' },
    { code: 'az', zh: '阿塞拜疆语', en: 'Azerbaijani', native: 'Azərbaycanca' },
    { code: 'uz', zh: '乌兹别克语', en: 'Uzbek', native: 'Oʻzbek' },
    { code: 'kk', zh: '哈萨克语', en: 'Kazakh', native: 'Қазақ' },
    { code: 'mn', zh: '蒙古语', en: 'Mongolian', native: 'Монгол' },
];

// --- Types ---

interface TitleItem {
    type: string;     // 类型标签：悬念/数字/反问/痛点...
    content: string;  // 标题文本
    zh_type?: string;    // 中文类型标签
    zh_content?: string; // 中文标题
}

interface EndingItem {
    type: string;     // 类型标签：互动/情感/祝福...
    content: string;  // 结尾文本
    zh_type?: string;    // 中文类型标签
    zh_content?: string; // 中文结尾
}

interface RewriteGroup {
    titleIndex: number;
    endingIndex: number;
    title: string;
    titleType: string;
    body: string;
    ending: string;
    endingType: string;
    fullText: string;
    // 中文翻译
    zh_title?: string;
    zh_body?: string;
    zh_ending?: string;
    zh_fullText?: string;
}

interface SuperRewriteResult {
    id: string;
    originalText: string;

    bodyContent: string;
    bodyContentZh?: string;  // 中文正文
    scriptureNote?: string;  // 经文修改反馈
    bodyStatus: 'idle' | 'processing' | 'success' | 'error' | 'skipped';
    bodyError?: string;

    titles: TitleItem[];
    titlesStatus: 'idle' | 'processing' | 'success' | 'error';
    titlesError?: string;

    endings: EndingItem[];
    endingsStatus: 'idle' | 'processing' | 'success' | 'error';
    endingsError?: string;

    groups: RewriteGroup[];
    groupsStatus: 'idle' | 'processing' | 'success' | 'error';
    groupsError?: string;

    rawOutputs: {
        extractBody?: string;
        body: string;
        titles: string;
        endings: string;
        groups?: string;
    };
    rawPrompts?: {
        extractBody?: string;
        body: string;
        titles: string;
        endings: string;
        groups?: string;
    };
    viewMode?: 'rendered' | 'prompts' | 'outputs';
    createdAt: number;
    collapsed?: boolean;
}

interface ContextCopyItem {
    id: string;
    label: string;
    text: string;
}

type PairMode = 'ai' | 'sequential' | 'cartesian';

interface SuperRewriteViewProps {
    getAiInstance: () => GoogleGenAI;
    textModel: string;
}

// --- Default Instructions ---
// 标题和结尾指令默认为空，用户必须自行输入
// 正文指令默认为空，关闭正文改写时使用内置的智能提取逻辑

const DEFAULT_TITLE_INSTRUCTION = '';
const DEFAULT_BODY_INSTRUCTION = '';
const DEFAULT_ENDING_INSTRUCTION = '';

// --- Storage Keys ---
const STORAGE_KEY = 'super_rewrite_state_v1';
const TITLE_INSTRUCTION_KEY = 'super_rewrite_title_instruction_v1';
const BODY_INSTRUCTION_KEY = 'super_rewrite_body_instruction_v1';
const ENDING_INSTRUCTION_KEY = 'super_rewrite_ending_instruction_v1';
const SETTINGS_KEY = 'super_rewrite_settings_v1';
const LANG_SETTINGS_KEY = 'super_rewrite_lang_v1';

// --- Parsers ---

/** 解析 [类型标签] 内容 格式 */
function parseTaggedItems(raw: string): { type: string; content: string }[] {
    const items: { type: string; content: string }[] = [];
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
        // Primary: [Tag] Content
        const tagMatch = line.match(/^\[(.+?)\]\s*(.+)$/);
        if (tagMatch) {
            items.push({ type: tagMatch[1].trim(), content: tagMatch[2].trim() });
            continue;
        }
        // Fallback: "1. Content" or "- Content"
        const numMatch = line.match(/^\d+[\.\)]\s*(.+)$/);
        if (numMatch) {
            items.push({ type: '通用', content: numMatch[1].trim() });
            continue;
        }
        const dashMatch = line.match(/^[-•]\s*(.+)$/);
        if (dashMatch) {
            items.push({ type: '通用', content: dashMatch[1].trim() });
            continue;
        }
        // Last resort: non-empty lines that look like content
        if (line.length > 3 && !line.startsWith('#') && !line.startsWith('示例') && !line.startsWith('输出')) {
            items.push({ type: '通用', content: line });
        }
    }
    return items;
}

/** 解析配对输出 (序号,序号 格式) */
function parsePairings(raw: string, titleCount: number, endingCount: number): { titleIdx: number; endingIdx: number }[] {
    const pairs: { titleIdx: number; endingIdx: number }[] = [];
    const lines = raw.split('\n').map(l => l.trim()).filter(Boolean);

    for (const line of lines) {
        const match = line.match(/(\d+)\s*[,，]\s*(\d+)/);
        if (match) {
            const tIdx = parseInt(match[1]) - 1; // 1-based → 0-based
            const eIdx = parseInt(match[2]) - 1;
            if (tIdx >= 0 && tIdx < titleCount && eIdx >= 0 && eIdx < endingCount) {
                pairs.push({ titleIdx: tIdx, endingIdx: eIdx });
            }
        }
    }
    return pairs;
}

/** Apply placeholder replacement */
function applyPlaceholders(template: string, vars: Record<string, string>): string {
    let result = template;
    for (const [key, value] of Object.entries(vars)) {
        result = result.replaceAll(`{{${key}}}`, value);
    }
    return result;
}

const DebugPanel = ({ title, content }: { title: string; content?: string }) => {
    if (!content) return null;
    return (
        <div className="space-y-1.5">
            <h4 className="text-[11px] font-medium text-zinc-400">{title}</h4>
            <pre className="text-[10px] text-zinc-300 bg-zinc-900/80 p-3 rounded-lg border border-zinc-800/50 whitespace-pre-wrap font-mono max-h-48 overflow-y-auto w-full">
                {content}
            </pre>
        </div>
    );
};

// --- DebouncedTextarea: 本地状态防抖，避免逐字触发父组件渲染 ---
const DebouncedTextarea = React.memo(({
    value, onChange, ...props
}: {
    value: string;
    onChange: (v: string) => void;
} & Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'onChange' | 'value'>) => {
    const [localValue, setLocalValue] = React.useState(value);
    const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    React.useEffect(() => { setLocalValue(value); }, [value]);

    const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const v = e.target.value;
        setLocalValue(v);
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => onChange(v), 300);
    };

    const handleBlur = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        onChange(localValue);
    };

    React.useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current); }, []);

    return <textarea {...props} value={localValue} onChange={handleChange} onBlur={handleBlur} />;
});

// --- InstructionPanel: 独立组件，本地状态避免逐字触发父组件渲染 ---
const InstructionPanel = React.memo(({
    title, icon, color, value, onChange, defaultValue,
    isOpen, onToggle,
    enableRewrite, onToggleRewrite, rewriteLabel
}: {
    title: string;
    icon: React.ReactNode;
    color: string;
    value: string;
    onChange: (v: string) => void;
    defaultValue: string;
    isOpen: boolean;
    onToggle: () => void;
    enableRewrite?: boolean;         // undefined = no toggle shown (always rewrite)
    onToggleRewrite?: () => void;
    rewriteLabel?: string;           // e.g. '改写标题'
}) => {
    // 本地状态：输入时只更新本地，不触发父组件渲染
    const [localValue, setLocalValue] = React.useState(value);
    const debounceRef = React.useRef<ReturnType<typeof setTimeout> | null>(null);

    // 外部 value 变化时同步到本地（如清空按钮、外部重置）
    React.useEffect(() => {
        setLocalValue(value);
    }, [value]);

    const handleChange = (newValue: string) => {
        setLocalValue(newValue);
        // 防抖 300ms 后同步到父组件
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => onChange(newValue), 300);
    };

    const handleBlur = () => {
        // 失焦时立即同步
        if (debounceRef.current) clearTimeout(debounceRef.current);
        onChange(localValue);
    };

    const handleClear = () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        setLocalValue('');
        onChange('');
    };

    // 清理
    React.useEffect(() => {
        return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
    }, []);

    const ringColor = color.includes('amber') ? 'amber' : color.includes('emerald') ? 'emerald' : 'violet';

    return (
        <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden">
            <button
                onClick={onToggle}
                className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/30 transition-colors"
            >
                <div className="flex items-center gap-2">
                    <span className={color}>{icon}</span>
                    <span className="text-xs font-medium text-zinc-300">{title}</span>
                    {enableRewrite === false ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-zinc-700 text-zinc-400">已跳过·智能提取</span>
                    ) : localValue.trim() ? (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-emerald-500/20 text-emerald-400">已配置</span>
                    ) : (
                        <span className="px-1.5 py-0.5 rounded text-[9px] bg-red-500/20 text-red-400">未配置</span>
                    )}
                </div>
                <div className="flex items-center gap-2">
                    {enableRewrite !== undefined && onToggleRewrite && (
                        <div className="flex items-center gap-1.5" onClick={e => e.stopPropagation()}>
                            <span className="text-[10px] text-zinc-500">{rewriteLabel || '改写'}</span>
                            <button
                                onClick={onToggleRewrite}
                                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${enableRewrite ? 'bg-emerald-500' : 'bg-zinc-600'}`}
                            >
                                <span className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${enableRewrite ? 'translate-x-[18px]' : 'translate-x-[3px]'}`} />
                            </button>
                        </div>
                    )}
                    <span className="text-[10px] text-zinc-600">{localValue.length} 字符</span>
                    {isOpen ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                </div>
            </button>
            {isOpen && enableRewrite !== false && (
                <div className="px-4 pb-4 space-y-2 border-t border-zinc-800/50">
                    <div className="flex items-center justify-between pt-2">
                        <span className="text-[10px] text-zinc-500">
                            使用 {'{{ORIGINAL_TEXT}}'} 占位符引用原始文案
                        </span>
                        <button
                            onClick={handleClear}
                            className="text-[10px] text-zinc-500 hover:text-red-400 flex items-center gap-1 transition-colors"
                        >
                            <Trash2 className="w-3 h-3" />
                            清空
                        </button>
                    </div>
                    <textarea
                        value={localValue}
                        onChange={e => handleChange(e.target.value)}
                        onBlur={handleBlur}
                        rows={12}
                        placeholder="请输入指令..."
                        className={`w-full bg-zinc-950/50 border border-zinc-700/50 rounded-lg px-3 py-2.5 text-xs text-zinc-300 placeholder:text-zinc-600 resize-y focus:outline-none focus:ring-1 focus:ring-${ringColor}-500/30 font-mono leading-relaxed`}
                        style={{ minHeight: '180px' }}
                    />
                </div>
            )}
        </div>
    );
});

// --- Component ---
export function SuperRewriteView({ getAiInstance, textModel }: SuperRewriteViewProps) {
    // --- State ---
    const [inputText, setInputText] = useState('');
    const [pendingInputs, setPendingInputs] = useState<string[]>([]);
    const [results, setResults] = useState<SuperRewriteResult[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) return JSON.parse(saved).results || [];
        } catch { /* ignore */ }
        return [];
    });
    const [isProcessing, setIsProcessing] = useState(false);
    const [batchProgress, setBatchProgress] = useState<{ current: number, total: number } | null>(null);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [copiedBatchType, setCopiedBatchType] = useState<string | null>(null);
    const [resultCopyMenu, setResultCopyMenu] = useState<{ x: number; y: number; items: ContextCopyItem[] } | null>(null);

    // Instructions
    const [titleInstruction, setTitleInstruction] = useState(() => {
        try { const s = localStorage.getItem(TITLE_INSTRUCTION_KEY); if (s) return s; } catch { }
        return DEFAULT_TITLE_INSTRUCTION;
    });
    const [bodyInstruction, setBodyInstruction] = useState(() => {
        try { const s = localStorage.getItem(BODY_INSTRUCTION_KEY); if (s) return s; } catch { }
        return DEFAULT_BODY_INSTRUCTION;
    });
    const [endingInstruction, setEndingInstruction] = useState(() => {
        try { const s = localStorage.getItem(ENDING_INSTRUCTION_KEY); if (s) return s; } catch { }
        return DEFAULT_ENDING_INSTRUCTION;
    });

    // Settings
    const [enableTitleRewrite, setEnableTitleRewrite] = useState(() => {
        try { const s = localStorage.getItem(SETTINGS_KEY); if (s) { return JSON.parse(s).enableTitleRewrite ?? true; } } catch { }
        return true;
    });
    const [enableBodyRewrite, setEnableBodyRewrite] = useState(() => {
        try { const s = localStorage.getItem(SETTINGS_KEY); if (s) { return JSON.parse(s).enableBodyRewrite ?? true; } } catch { }
        return true;
    });
    const [enableEndingRewrite, setEnableEndingRewrite] = useState(() => {
        try { const s = localStorage.getItem(SETTINGS_KEY); if (s) { return JSON.parse(s).enableEndingRewrite ?? true; } } catch { }
        return true;
    });
    const [pairMode, setPairMode] = useState<PairMode>(() => {
        try { const s = localStorage.getItem(SETTINGS_KEY); if (s) { return JSON.parse(s).pairMode || 'ai'; } } catch { }
        return 'ai';
    });

    // Language settings: global only
    const [globalLang, setGlobalLang] = useState(() => {
        try { const s = localStorage.getItem(LANG_SETTINGS_KEY); if (s) return JSON.parse(s).global || 'auto'; } catch { }
        return 'auto';
    });
    // Set all effective languages to globalLang to avoid confusion
    const effectiveTitleLang = globalLang;
    const effectiveBodyLang = globalLang;
    const effectiveEndingLang = globalLang;

    // UI state
    const [showTitleInstruction, setShowTitleInstruction] = useState(false);
    const [showBodyInstruction, setShowBodyInstruction] = useState(false);
    const [showEndingInstruction, setShowEndingInstruction] = useState(false);
    const [showDeitySettings, setShowDeitySettings] = useState(false);

    const settings = useScriptureDeitySettings();

    const stopRef = useRef(false);

    // Persist
    useEffect(() => {
        try {
            localStorage.setItem(STORAGE_KEY, JSON.stringify({
                results: results.map(r => ({
                    ...r,
                    originalText: r.originalText.slice(0, 5000)
                }))
            }));
        } catch { }
    }, [results]);

    useEffect(() => {
        try { localStorage.setItem(TITLE_INSTRUCTION_KEY, titleInstruction); } catch { }
    }, [titleInstruction]);
    useEffect(() => {
        try { localStorage.setItem(BODY_INSTRUCTION_KEY, bodyInstruction); } catch { }
    }, [bodyInstruction]);
    useEffect(() => {
        try { localStorage.setItem(ENDING_INSTRUCTION_KEY, endingInstruction); } catch { }
    }, [endingInstruction]);
    useEffect(() => {
        try {
            localStorage.setItem(SETTINGS_KEY, JSON.stringify({ enableTitleRewrite, enableBodyRewrite, enableEndingRewrite, pairMode }));
        } catch { }
    }, [enableTitleRewrite, enableBodyRewrite, enableEndingRewrite, pairMode]);
    useEffect(() => {
        try {
            localStorage.setItem(LANG_SETTINGS_KEY, JSON.stringify({ global: globalLang }));
        } catch { }
    }, [globalLang]);

    // --- API call with retry ---
    const callAI = async (ai: GoogleGenAI, prompt: string, systemPrompt?: string): Promise<string> => {
        let result: any;
        for (let attempt = 0; attempt <= 3; attempt++) {
            try {
                result = await ai.models.generateContent({
                    model: textModel || 'gemini-2.5-flash',
                    contents: prompt,
                    config: {
                        temperature: 0.85,
                        topP: 0.95,
                        maxOutputTokens: 8192,
                        ...(systemPrompt ? { systemInstruction: systemPrompt } : {})
                    }
                });
                break;
            } catch (err: any) {
                const errMsg = err?.message || '';
                const is429 = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota');
                if (is429 && attempt < 3) {
                    const waitSec = Math.pow(2, attempt + 1) * 2.5;
                    await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
                    continue;
                }
                throw err;
            }
        }
        return result?.text?.trim() || '';
    };

    // --- Google Sheets 粘贴处理 (批量输入 - 高保真解析) ---
    const parseHtmlTable = (html: string): string[] => {
        const results: string[] = [];
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const rows = doc.querySelectorAll('tr');

            // 获取单元格文本，保留 <br> 为换行符
            const getCellText = (cell: Element): string => {
                const clone = cell.cloneNode(true) as Element;
                // Google Sheets 的 <br> 代表单元格内换行
                clone.querySelectorAll('br').forEach(br => {
                    br.replaceWith('\n');
                });
                // 处理 <p> 标签（某些 Sheets 版本用 <p> 包裹段落）
                clone.querySelectorAll('p').forEach(p => {
                    if (p.nextSibling) {
                        p.after('\n');
                    }
                });
                return (clone.textContent || '').trim();
            };

            if (rows.length === 0) {
                // 没有 tr 标签，尝试直接查找 td
                const cells = doc.querySelectorAll('td');
                if (cells.length > 0) {
                    const cellText = getCellText(cells[0]);
                    if (cellText) results.push(cellText);
                }
                return results;
            }

            rows.forEach(row => {
                const cells = row.querySelectorAll('td, th');
                if (cells.length === 0) return;

                // 取第一列作为文案内容
                const text = getCellText(cells[0]);
                if (text) results.push(text);
            });
        } catch (e) {
            console.error('[SuperRewrite] parseHtmlTable error:', e);
        }
        return results;
    };

    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        const htmlData = clipboardData.getData('text/html');

        if (htmlData && (htmlData.includes('<table') || htmlData.includes('<tr'))) {
            e.preventDefault();
            const parsed = parseHtmlTable(htmlData);
            if (parsed.length > 0) {
                setPendingInputs(parsed);
                setInputText(`已从表格粘贴 ${parsed.length} 条文案`);
                return;
            }
        }
        // 非表格粘贴，清除 pending 状态
        setPendingInputs([]);
    };

    const handleRemovePendingItem = (index: number) => {
        setPendingInputs(prev => {
            const next = prev.filter((_, i) => i !== index);
            if (next.length === 0) {
                setInputText('');
            } else {
                setInputText(`已从表格粘贴 ${next.length} 条文案`);
            }
            return next;
        });
    };

    const handleClearPendingInputs = () => {
        setPendingInputs([]);
        setInputText('');
    };

    // --- Generate handler ---
    const handleGenerate = useCallback(async () => {
        if ((!inputText.trim() && pendingInputs.length === 0) || isProcessing) return;
        // 验证：标题和结尾指令不能为空
        if (!titleInstruction.trim() || !endingInstruction.trim()) {
            alert('请先填写「标题指令」和「结尾指令」后再开始改写');
            return;
        }

        stopRef.current = false;
        setIsProcessing(true);

        let items: string[];
        if (pendingInputs.length > 0) {
            items = pendingInputs;
        } else {
            // 支持批量：按至少三个换行或 \n---\n 分割
            const texts = inputText.trim().split(/\n{3,}|\n---\n/).map(s => s.trim()).filter(Boolean);
            items = texts.length > 0 ? texts : [inputText.trim()];
        }

        try {
            const ai = getAiInstance();
            setBatchProgress({ current: 0, total: items.length });

            for (let i = 0; i < items.length; i++) {
                const rawText = items[i];
                if (stopRef.current) break;

                setBatchProgress({ current: i + 1, total: items.length });

                const originalText = rawText.trim();
                
                const newResult: SuperRewriteResult = {
                    id: uuidv4(),
                    originalText,
                    bodyContent: '',
                    bodyStatus: enableBodyRewrite ? 'processing' : 'skipped',
                    titles: [],
                    titlesStatus: 'processing',
                    endings: [],
                    endingsStatus: 'processing',
                    groups: [],
                    groupsStatus: 'idle',
                    rawOutputs: { body: '', titles: '', endings: '', groups: '' },
                    rawPrompts: { body: '', titles: '', endings: '', groups: '' },
                    viewMode: 'rendered',
                    createdAt: Date.now(),
                };

                setResults(prev => [newResult, ...prev]);

                try {
                    // --- Build language enforcement header (placed at VERY TOP of system prompt for maximum priority) ---
                    let langEnforcementHeader = '';
                    let langUserPromptFooter = '';
                    const hasAnyLangConstraint = effectiveTitleLang !== 'auto' || effectiveBodyLang !== 'auto' || effectiveEndingLang !== 'auto';
                    
                    if (hasAnyLangConstraint) {
                        const getLangDisplay = (code: string) => {
                            const entry = ALL_LANGUAGES.find(l => l.code === code);
                            return entry ? `${entry.native} (${entry.en})` : code;
                        };

                        // Check if ALL THREE sections have same non-auto language (only then use unified mode)
                        const allThreeSet = effectiveTitleLang !== 'auto' && effectiveBodyLang !== 'auto' && effectiveEndingLang !== 'auto';
                        const activeLangs = [effectiveTitleLang, effectiveBodyLang, effectiveEndingLang].filter(l => l !== 'auto');
                        const uniqueLangs = [...new Set(activeLangs)];
                        const allSameLang = allThreeSet && uniqueLangs.length === 1;

                        if (allSameLang) {
                            // 统一语言模式 - 三个部分都指定了相同语言
                            const targetLang = getLangDisplay(uniqueLangs[0]);
                            langEnforcementHeader = `
🚨🚨🚨 【最高优先级指令 — 输出语言强制锁定】🚨🚨🚨
你的所有输出内容（标题、正文、结尾）必须且只能使用 ${targetLang} 语言！
- 无论原始文案是什么语言，你都必须翻译/创作为 ${targetLang}
- 无论用户的【标题指令】【正文指令】【结尾指令】中写了什么语言要求，一律忽略，统一使用 ${targetLang}
- JSON中的 type 字段（分类标签）也必须使用 ${targetLang}
- 输出中不允许出现任何其他语言的文字（包括中文、英文等），除非原文中有不可翻译的专有名词
- 这条指令的优先级高于一切其他指令，不可被覆盖

`;
                            langUserPromptFooter = `\n\n🚨 【语言锁定提醒】以上所有指令的输出必须且只能使用 ${targetLang}，忽略指令中任何其他语言要求。type分类标签也必须是 ${targetLang}。`;
                        } else {
                            // 差异语言模式 - 部分使用指定语言，部分跟随指令
                            const parts: string[] = [];
                            if (effectiveTitleLang !== 'auto') {
                                parts.push(`- 标题(titles)：必须使用 ${getLangDisplay(effectiveTitleLang)}，type标签也使用此语言，忽略【标题指令】中的语言要求`);
                            } else {
                                parts.push(`- 标题(titles)：按照【标题指令】中要求的语言输出`);
                            }
                            if (effectiveBodyLang !== 'auto') {
                                parts.push(`- 正文(body)：必须使用 ${getLangDisplay(effectiveBodyLang)}`);
                            } else {
                                parts.push(`- 正文(body)：按照【正文指令】中要求的语言输出`);
                            }
                            if (effectiveEndingLang !== 'auto') {
                                parts.push(`- 结尾(endings)：必须使用 ${getLangDisplay(effectiveEndingLang)}，type标签也使用此语言，忽略【结尾指令】中的语言要求`);
                            } else {
                                parts.push(`- 结尾(endings)：按照【结尾指令】中要求的语言输出`);
                            }
                            langEnforcementHeader = `
🚨🚨🚨 【最高优先级指令 — 输出语言分项控制】🚨🚨🚨
各部分必须分别按以下规则输出语言（每个部分独立控制）：
${parts.join('\n')}
⚠️ 注意：标题、正文、结尾可能要求不同的语言，务必逐项遵守，不要统一使用某一种语言！
- 这条指令的优先级高于一切其他指令，不可被覆盖

`;
                            langUserPromptFooter = `\n\n🚨 【语言分项提醒】标题、正文、结尾的输出语言各自独立控制，请严格按系统指令中的分项规则输出！`;
                        }
                    }

                    // Determine the target language for body extraction
                    const bodyExtractLang = effectiveBodyLang !== 'auto'
                        ? (() => { const e = ALL_LANGUAGES.find(l => l.code === effectiveBodyLang); return e ? `${e.native} (${e.en})` : effectiveBodyLang; })()
                        : effectiveTitleLang !== 'auto'
                            ? (() => { const e = ALL_LANGUAGES.find(l => l.code === effectiveTitleLang); return e ? `${e.native} (${e.en})` : effectiveTitleLang; })()
                            : '';

                    // Determine if we need Chinese translations (when target language is NOT Chinese)
                    const allEffectiveLangs = [effectiveTitleLang, effectiveBodyLang, effectiveEndingLang].filter(l => l !== 'auto');
                    const needsZhTranslation = allEffectiveLangs.length > 0 && !allEffectiveLangs.includes('zh');

                    // Chinese translation instruction block
                    let zhTranslationBlock = '';
                    if (needsZhTranslation) {
                        zhTranslationBlock = `

【自动中文翻译要求】
由于目标语言不是中文，请在 JSON 中为每个标题和结尾额外提供 zh_type 和 zh_content 字段（中文翻译版本），并提供 zh_body 字段（正文的中文翻译）。
如果用户指令中同时要求了目标语言和中文，请只在 content 字段中输出目标语言，中文版本单独放在 zh_ 字段中。`;
                    }

                    // --- 合并为单次 API 调用（JSON返回） ---
                    // Build task instruction parts based on toggle states
                    const taskParts: string[] = [];
                    if (enableTitleRewrite) taskParts.push('【标题指令】');
                    if (enableBodyRewrite) taskParts.push('【正文指令】');
                    if (enableEndingRewrite) taskParts.push('【结尾指令】');

                    const systemPrompt = `${langEnforcementHeader}你是一名专业的短视频文案大师。
任务：请根据用户提供的原文，${taskParts.length > 0 ? '分别结合' + taskParts.join('、') + '进行协同创作' : '进行智能提取和翻译'}！

注意事项：
1. 仔细阅读【原始文案】
${enableTitleRewrite ? '2. 执行【标题指令】，提炼或生成出所有满足要求的标题（需包含对应的分类标签）' : '2. 【标题智能提取】：从原始文案中提取原有的标题/钩子句，保持原文内容不改写，仅在需要时翻译为目标语言'}
${enableBodyRewrite ? '3. 执行【正文指令】，对原始文案的主体部分进行改写（不包含标题和结尾）' : '3. 【正文智能提取】：请通读整篇原始文案，基于完整的语义分析，智能识别并提取出"纯正文主体"部分。\\n\\n   ⚠️【核心原则：基于语义分析，而非行数或位置】\\n   你必须通读整篇文案，理解其完整的语义结构后，再判断哪些内容属于"标题钩子"、哪些是"正文主体"、哪些是"结尾互动语"。绝不能简单地按行数或位置来切割。\\n\\n   【需要去除的内容】：\\n   - 标题/钩子部分：文案中起"吸引停留、制造悬念、命运感暗示、号召停下"作用的引导性语句。这些句子的语义功能是"抓住读者注意力"，而非传递正文的核心信息。它们不一定在第一行——需要根据语义功能来判断。\\n   - 结尾互动语/号召语：语义功能是"引导读者行动"的句子（如写下阿们、分享给你爱的人、请留言、点赞转发等）。\\n   - 结尾祝福/收尾短句：语义功能是"结束和祝愿"的句子（如愿主保佑你、阿们等简短收尾语）。\\n\\n   【正文主体的语义特征】：\\n   正文主体是文案的核心内容承载部分，其语义功能是"传递信息、讲述故事、表达祷告、阐述道理"。具体包括：\\n   - 祷告/祈祷的实质内容（向神倾诉、祈求、感恩、宣告等）\\n   - 故事叙述、道理阐述、信仰教导\\n   - 情感表达的主体段落\\n   当你发现内容从"抓注意力的钩子语义"转变为"实质性的内容表达"时，正文就开始了。\\n\\n   【关键判断要点】：\\n   - 按语义功能区分，不按行数位置切割。同样的句子在不同文案中可能是标题也可能是正文，取决于它在整篇文案中的语义角色。\\n   - 宁多勿少：如果某段内容你不确定是标题钩子还是正文，将它保留在正文中。\\n   - 无标题的情况：如果文案一开头就直接进入实质内容（祷告正文、故事叙述等），没有钩子引导句，则body应包含从头开始的全部核心内容。\\n   - 正文中间的祷告内容、叙述内容要完整保留，不要删改任何正文段落。\\n\\n   ⚠️ 语言一致性要求：提取后的正文必须与你生成的标题和结尾使用相同的语言！请根据【标题指令】和【结尾指令】中要求的输出语言，将正文也翻译为对应语言。翻译时保留原文的语义、语气和段落结构，只改变语言，不改变内容'}
${enableEndingRewrite ? '4. 执行【结尾指令】，生成出所有满足要求的结尾文案（需包含对应的分类标签）' : '4. 【结尾智能提取】：从原始文案中提取原有的结尾互动语/号召语，保持原文内容不改写，仅在需要时翻译为目标语言'}${zhTranslationBlock}

【输出格式：强制 JSON】
为了便于前后端系统解析，无论用户在其自定义的局部指令中要求了何种纯文本格式或排版，最终你都必须将结果统一归纳为以下结构的 JSON 字符串进行返回。必须保证 JSON 格式合法。
不要输出任何分析过程，不要输出 \`\`\`json 标记。

{
  "titles": [
    { "type": "category label", "content": "title text"${needsZhTranslation ? ', "zh_type": "中文分类标签", "zh_content": "中文标题"' : ''} }
  ],
  "body": "${enableBodyRewrite ? 'rewritten body content' : 'extracted body content'}",${needsZhTranslation ? '\n  "zh_body": "中文正文翻译",' : ''}
  "endings": [
    { "type": "category label", "content": "ending text"${needsZhTranslation ? ', "zh_type": "中文分类标签", "zh_content": "中文结尾"' : ''} }
  ]${settings.enableScriptureDetection ? ',\n  "scriptureNote": "经文修改情况反馈"' : ''}
}

${settings.deityTerms && settings.deityTerms.length > 0 ? `【Capitalization Rules (CRITICAL)】
If generating English, you MUST capitalize the first letter of these specific religious terms and pronouns: ${settings.deityTerms.join(', ')}.
${settings.applyDeityCapitalizationToAll ? `For any other output language, you MUST also capitalize the corresponding translated terms for these words.` : ''}
` : ''}
${settings.enableScriptureDetection ? `【SCRIPTURE QUOTATION RULES (CRITICAL FOR COPYRIGHT)】
1. Detect if the source text contains any religious scriptures (e.g., from the Bible).
2. If scriptures are detected, you MUST NOT translate them yourself.
3. You MUST quote the exact official text from the specified version: 【${settings.scriptureVersion || 'WEB (World English Bible) 或 KJV (King James Version)'}】.
4. If the exact quote from the specified version cannot be found, keep the original language or add a note, but DO NOT create a new translation.
5. You MUST provide feedback in the "scriptureNote" JSON field:
   - If NO scripture is detected, output: "不包含经文"
   - If a scripture is detected and you modified it to the specified version, output: "经文已修改为【${settings.scriptureVersion || 'WEB (World English Bible) 或 KJV (King James Version)'}】"
   - If a scripture is detected but it's already the correct version or no modification was needed, output: "不需要修改，当前是【${settings.scriptureVersion || 'WEB (World English Bible) 或 KJV (King James Version)'}】"
` : ''}
【✅ 输出前自检】
在输出 JSON 之前，请逐项自检以下要求：
${!enableTitleRewrite ? '- 标题必须是从原文提取的，不得自行创作/改写（仅允许翻译）' : '- 标题必须按照【标题指令】要求创作'}
${!enableBodyRewrite ? '- 正文必须是从原文提取的，不得改写原意（仅允许翻译）' : '- 正文必须按照【正文指令】要求改写'}
${!enableEndingRewrite ? '- 结尾必须是从原文提取的，不得自行创作/改写（仅允许翻译）' : '- 结尾必须按照【结尾指令】要求创作'}
${hasAnyLangConstraint ? '- 检查输出中每个 content/body/type 字段的语言是否严格符合上方语言锁定指令的要求，不得出现任何非目标语言的内容' : ''}
${needsZhTranslation ? '- 检查 zh_ 字段是否均已填写中文翻译' : ''}
- 检查 JSON 格式是否合法，确保字符串转义正确
如果自检发现不符合，请修正后再输出。`;

                    // User prompt: ALWAYS include all instructions. When rewrite is off, mark as [reference only] so AI knows to use for language context only
                    const userPrompt = `${enableTitleRewrite ? '【标题指令】' : '【标题指令 - 仅供语言参考，不改写】'}\n${titleInstruction}\n\n${enableBodyRewrite ? '【正文指令】' : '【正文 - 不改写，仅提取原文】'}\n${enableBodyRewrite ? bodyInstruction : '保持原文不变，仅在需要时翻译为目标语言'}\n\n${enableEndingRewrite ? '【结尾指令】' : '【结尾指令 - 仅供语言参考，不改写】'}\n${endingInstruction}\n\n【原始文案】\n${originalText}${langUserPromptFooter}`;

                    setResults(prev => prev.map(r => r.id === newResult.id ? {
                        ...r,
                        rawPrompts: { extractBody: '', body: '', titles: userPrompt, endings: systemPrompt, groups: '' }
                    } : r));

                    let parsedTitles: TitleItem[] = [];
                    let parsedEndings: EndingItem[] = [];
                    let bodyContent = originalText;
                    let bodyContentZh = '';
                    let titleOk = false;
                    let endingOk = false;
                    let bodyOk = false;
                    let scriptureNote: string | undefined = undefined;
                    
                    let rawOutput = '';

                    try {
                        rawOutput = await callAI(ai, userPrompt, systemPrompt);
                        
                        if (stopRef.current) {
                            setResults(prev => prev.map(r =>
                                r.id === newResult.id ? { ...r, titlesStatus: 'error', endingsStatus: 'error', bodyStatus: 'error', titlesError: '已取消', endingsError: '已取消', bodyError: '已取消' } : r
                            ));
                            break;
                        }

                        let cleanedOutput = rawOutput.trim();
                        if (cleanedOutput.startsWith('```json')) cleanedOutput = cleanedOutput.slice(7);
                        if (cleanedOutput.startsWith('```')) cleanedOutput = cleanedOutput.slice(3);
                        if (cleanedOutput.endsWith('```')) cleanedOutput = cleanedOutput.slice(0, -3);
                        cleanedOutput = cleanedOutput.trim();

                        const parsedObj = JSON.parse(cleanedOutput);
                        
                        if (parsedObj.titles && Array.isArray(parsedObj.titles)) {
                            parsedTitles = parsedObj.titles;
                            titleOk = parsedTitles.length > 0;
                        }
                        if (parsedObj.endings && Array.isArray(parsedObj.endings)) {
                            parsedEndings = parsedObj.endings;
                            endingOk = parsedEndings.length > 0;
                        }
                        if (parsedObj.body && typeof parsedObj.body === 'string' && parsedObj.body.trim().length > 0) {
                            bodyContent = parsedObj.body;
                            bodyOk = true;
                        } else if (!enableBodyRewrite) {
                            bodyContent = originalText;
                            bodyOk = true;
                            console.warn('[SuperRewrite] AI未返回提取的正文，回退使用原文');
                        }
                        // Extract Chinese body translation if present
                        if (parsedObj.zh_body && typeof parsedObj.zh_body === 'string') {
                            bodyContentZh = parsedObj.zh_body;
                        }
                        
                        if (parsedObj.scriptureNote && typeof parsedObj.scriptureNote === 'string') {
                            scriptureNote = parsedObj.scriptureNote;
                        }

                        // Fail fallback if user prompts somehow caused the AI to abandon the JSON constraint
                        if (!titleOk || !endingOk) {
                             throw new Error('AI未能按JSON格式或未能返回足够的标题和结尾');
                        }

                    } catch (generationError: any) {
                        console.error('[SuperRewrite] Unified Generation Error:', generationError);
                        titleOk = false;
                        endingOk = false;
                        if (!enableBodyRewrite) {
                            bodyContent = originalText;
                            bodyOk = true;
                        } else {
                            bodyOk = false;
                        }
                    }

                    // Update intermediate state
                    setResults(prev => prev.map(r =>
                        r.id === newResult.id ? {
                            ...r,
                            titles: parsedTitles,
                            titlesStatus: titleOk ? 'success' : 'error',
                            titlesError: titleOk ? undefined : '未解析到标题/格式错误',
                            endings: parsedEndings,
                            endingsStatus: endingOk ? 'success' : 'error',
                            endingsError: endingOk ? undefined : '未解析到结尾/格式错误',
                            bodyContent,
                            bodyContentZh,
                            scriptureNote,
                            bodyStatus: bodyOk ? (enableBodyRewrite ? 'success' : 'skipped') : 'error',
                            bodyError: bodyOk ? undefined : 'JSON中未包含正文或失败',
                            rawOutputs: { ...r.rawOutputs, body: '', titles: rawOutput, endings: '' },
                            groupsStatus: (titleOk && endingOk) ? 'processing' : 'error',
                        } : r
                    ));

            // --- 配对阶段 ---
            if (titleOk && endingOk) {
                let groups: RewriteGroup[] = [];

                // Helper to build a group with zh_ support
                const buildGroup = (tIdx: number, eIdx: number): RewriteGroup => {
                    const t = parsedTitles[tIdx];
                    const e = parsedEndings[eIdx];
                    const zhTitle = t.zh_content || '';
                    const zhEnding = e.zh_content || '';
                    return {
                        titleIndex: tIdx,
                        endingIndex: eIdx,
                        title: t.content,
                        titleType: t.type,
                        body: bodyContent,
                        ending: e.content,
                        endingType: e.type,
                        fullText: `${t.content}\n${bodyContent}\n${e.content}`,
                        zh_title: zhTitle,
                        zh_body: bodyContentZh,
                        zh_ending: zhEnding,
                        zh_fullText: (zhTitle || bodyContentZh || zhEnding) ? `${zhTitle || t.content}\n${bodyContentZh || bodyContent}\n${zhEnding || e.content}` : undefined,
                    };
                };

                if (pairMode === 'sequential') {
                    // 顺序配对：1→1, 2→2, 循环较少的一方
                    const maxLen = Math.max(parsedTitles.length, parsedEndings.length);
                    for (let i = 0; i < maxLen; i++) {
                        const tIdx = i % parsedTitles.length;
                        const eIdx = i % parsedEndings.length;
                        groups.push(buildGroup(tIdx, eIdx));
                    }
                } else if (pairMode === 'cartesian') {
                    // 全组合
                    for (let t = 0; t < parsedTitles.length; t++) {
                        for (let e = 0; e < parsedEndings.length; e++) {
                            groups.push(buildGroup(t, e));
                        }
                    }
                } else {
                    // AI 智能配对
                    try {
                        const titleList = parsedTitles.map((t, i) => `${i + 1}. [${t.type}] ${t.content}`).join('\n');
                        const endingList = parsedEndings.map((e, i) => `${i + 1}. [${e.type}] ${e.content}`).join('\n');

                        const pairPrompt = `你是一名文案编辑。请将以下标题和结尾进行最佳配对。

## 配对规则
1. 风格匹配：同类型标题和结尾优先配对
2. 语气一致：标题和结尾的情感强度要匹配
3. 主题呼应：标题引出的话题，结尾要有回应
4. 每个标题必须配一个结尾
5. 如果标题数 > 结尾数，结尾可以重复使用

## 标题列表
${titleList}

## 结尾列表
${endingList}

## 输出格式（严格遵守）
每组一行，格式：标题序号,结尾序号
只输出数字对，不要任何解释。`;

                        const pairRaw = await callAI(ai, pairPrompt);
                        
                        setResults(prev => prev.map(r => r.id === newResult.id ? {
                            ...r,
                            rawPrompts: r.rawPrompts ? { ...r.rawPrompts, groups: pairPrompt } : undefined,
                            rawOutputs: { ...r.rawOutputs, groups: pairRaw }
                        } : r));

                        const pairings = parsePairings(pairRaw, parsedTitles.length, parsedEndings.length);

                        if (pairings.length > 0) {
                            groups = pairings.map(p => buildGroup(p.titleIdx, p.endingIdx));
                        } else {
                            // Fallback to sequential
                            const maxLen = Math.max(parsedTitles.length, parsedEndings.length);
                            for (let i = 0; i < maxLen; i++) {
                                const tIdx = i % parsedTitles.length;
                                const eIdx = i % parsedEndings.length;
                                groups.push(buildGroup(tIdx, eIdx));
                            }
                        }
                    } catch (pairErr: any) {
                        // Fallback to sequential on error
                        const maxLen = Math.max(parsedTitles.length, parsedEndings.length);
                        for (let i = 0; i < maxLen; i++) {
                            const tIdx = i % parsedTitles.length;
                            const eIdx = i % parsedEndings.length;
                            groups.push(buildGroup(tIdx, eIdx));
                        }
                    }
                }

                setResults(prev => prev.map(r =>
                    r.id === newResult.id ? {
                        ...r,
                        groups,
                        groupsStatus: groups.length > 0 ? 'success' : 'error',
                    } : r
                ));
            }

                } catch (error: any) {
                    console.error('[SuperRewrite] Error:', error);
                    setResults(prev => prev.map(r =>
                        r.id === newResult.id ? {
                            ...r,
                            titlesStatus: r.titlesStatus === 'processing' ? 'error' : r.titlesStatus,
                            endingsStatus: r.endingsStatus === 'processing' ? 'error' : r.endingsStatus,
                            bodyStatus: r.bodyStatus === 'processing' ? 'error' : r.bodyStatus,
                            groupsStatus: 'error',
                            titlesError: error?.message,
                            endingsError: error?.message,
                            bodyError: error?.message,
                        } : r
                    ));
                } // End inner try
            } // End for loop
        } catch (globalError) {
            console.error('[SuperRewrite] Global Error:', globalError);
        } finally {
            setIsProcessing(false);
            setBatchProgress(null);
            playCompletionSound();
        }
    }, [inputText, pendingInputs, isProcessing, getAiInstance, textModel, titleInstruction, bodyInstruction, endingInstruction, enableTitleRewrite, enableBodyRewrite, enableEndingRewrite, pairMode, globalLang]);

    // Status helper
    const getOverallStatus = (result: SuperRewriteResult) => {
        if (result.groupsStatus === 'success') return 'success';
        if ([result.titlesStatus, result.endingsStatus, result.bodyStatus, result.groupsStatus].some(s => s === 'processing')) return 'processing';
        if ([result.titlesStatus, result.endingsStatus].some(s => s === 'error')) return 'error';
        return 'idle';
    };

    const handleStop = () => { stopRef.current = true; };

    // --- 重试失败项 ---
    const handleRetryFailed = useCallback(() => {
        const failedItems = results.filter(r => getOverallStatus(r) === 'error');
        if (failedItems.length === 0 || isProcessing) return;
        const texts = failedItems.map(r => r.originalText);
        // 移除失败项
        setResults(prev => prev.filter(r => getOverallStatus(r) !== 'error'));
        // 设置为 pending 并触发生成
        setPendingInputs(texts);
        setInputText(`重试 ${texts.length} 条失败文案`);
    }, [results, isProcessing]);

    // --- 全部重做 ---
    const handleRedoAll = useCallback(() => {
        if (results.length === 0 || isProcessing) return;
        const texts = results.map(r => r.originalText);
        setResults([]);
        setPendingInputs(texts);
        setInputText(`重做全部 ${texts.length} 条文案`);
    }, [results, isProcessing]);

    const handleDelete = (id: string) => {
        setResults(prev => prev.filter(r => r.id !== id));
    };

    const handleRetrySingle = (id: string) => {
        const item = results.find(r => r.id === id);
        if (!item || isProcessing) return;
        setResults(prev => prev.filter(r => r.id !== id));
        setPendingInputs([item.originalText]);
        setInputText(`重试 1 条文案`);
    };

    const handleClearAll = () => { setResults([]); };

    const handleToggleCollapse = (id: string) => {
        setResults(prev => prev.map(r =>
            r.id === id ? { ...r, collapsed: !r.collapsed } : r
        ));
    };

    const handleSetViewMode = (id: string, mode: 'rendered' | 'prompts' | 'outputs') => {
        setResults(prev => prev.map(r =>
            r.id === id ? { ...r, viewMode: mode } : r
        ));
    };

    const handleCopy = async (text: string, id: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(id);
            setTimeout(() => setCopiedId(null), 2000);
        } catch { /* ignore */ }
    };

    const openResultCopyMenu = (e: React.MouseEvent, items: ContextCopyItem[]) => {
        e.preventDefault();
        e.stopPropagation();
        const validItems = items.filter(item => item.text && item.text.trim().length > 0);
        if (validItems.length === 0) return;

        const menuWidth = 172;
        const menuHeight = validItems.length * 32 + 12;
        const x = Math.max(8, Math.min(e.clientX, window.innerWidth - menuWidth - 8));
        const y = Math.max(8, Math.min(e.clientY, window.innerHeight - menuHeight - 8));
        setResultCopyMenu({ x, y, items: validItems });
    };

    useEffect(() => {
        if (!resultCopyMenu) return;
        const handleKeydown = (event: KeyboardEvent) => {
            if (event.key === 'Escape') setResultCopyMenu(null);
        };
        const handleViewportChange = () => setResultCopyMenu(null);
        window.addEventListener('keydown', handleKeydown);
        window.addEventListener('resize', handleViewportChange);
        window.addEventListener('scroll', handleViewportChange, true);
        return () => {
            window.removeEventListener('keydown', handleKeydown);
            window.removeEventListener('resize', handleViewportChange);
            window.removeEventListener('scroll', handleViewportChange, true);
        };
    }, [resultCopyMenu]);

    // High performance floating mouse tooltip for right click hint
    useEffect(() => {
        const tooltip = document.createElement('div');
        tooltip.id = 'right-click-tooltip';
        tooltip.className = 'fixed z-[100] pointer-events-none px-2 py-1 bg-zinc-950/90 text-zinc-300 text-[10px] rounded border border-zinc-700/80 shadow-lg whitespace-nowrap transition-opacity duration-150 flex items-center gap-1.5 opacity-0';
        tooltip.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-zinc-500"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4"/><path d="M12 8h.01"/></svg> 右键快捷复制';
        tooltip.style.display = 'none';
        // Put exactly at the same DOM level to ensure it overlays everything correctly
        document.body.appendChild(tooltip);

        let timeoutId: any;
        const handleMouseMove = (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const row = target.closest('.result-row-hover');
            const menuOpen = document.getElementById('result-copy-menu');
            
            if (row && !menuOpen) {
                tooltip.style.display = 'flex';
                // Adjust position slightly to be below and to the right of cursor
                tooltip.style.left = `${e.clientX + 14}px`;
                tooltip.style.top = `${e.clientY + 14}px`;
                
                // Allow browser to render display: flex before changing opacity for transition
                requestAnimationFrame(() => {
                    tooltip.style.opacity = '1';
                });
            } else {
                tooltip.style.opacity = '0';
                clearTimeout(timeoutId);
                timeoutId = setTimeout(() => {
                    if (tooltip.style.opacity === '0') {
                        tooltip.style.display = 'none';
                    }
                }, 150);
            }
        };

        // Delay attaching to prevent ghost triggers
        setTimeout(() => document.addEventListener('mousemove', handleMouseMove), 100);
        
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            if (document.body.contains(tooltip)) {
                document.body.removeChild(tooltip);
            }
            clearTimeout(timeoutId);
        };
    }, []);

    // --- Batch copy ---
    // TSV 引号包裹：保留单元格内的换行，粘贴到 Google Sheets 时每个换行仍在同一个单元格内
    const quoteForTsv = (text: string): string => {
        if (!text) return '';
        // 标准 TSV/CSV 引号规则：内容含换行或引号时，用双引号包裹，内部引号转义为 ""
        const trimmed = text.trim();
        if (trimmed.includes('\n') || trimmed.includes('\t') || trimmed.includes('"')) {
            return `"${trimmed.replace(/"/g, '""')}"`;
        }
        return trimmed;
    };

    const handleBatchCopy = async (type: 'titles' | 'body' | 'endings' | 'tsv' | 'tsv_with_original' | 'zh_titles' | 'zh_body' | 'zh_endings' | 'zh_tsv' | 'zh_tsv_with_original') => {
        const successResults = results.filter(r => r.groupsStatus === 'success' && r.groups.length > 0);
        if (successResults.length === 0) return;

        let text = '';

        switch (type) {
            case 'titles':
                text = '标题\n' + successResults.flatMap(r => r.titles.map(t => quoteForTsv(`[${t.type}] ${t.content}`))).join('\n');
                break;
            case 'body':
                text = '正文\n' + successResults.map(r => r.bodyContent ? quoteForTsv(r.bodyContent) : '').filter(Boolean).join('\n');
                break;
            case 'endings':
                text = '结尾\n' + successResults.flatMap(r => r.endings.map(e => quoteForTsv(`[${e.type}] ${e.content}`))).join('\n');
                break;
            case 'zh_titles':
                text = '中文标题\n' + successResults.flatMap(r => r.titles.filter(t => t.zh_content).map(t => quoteForTsv(`[${t.zh_type || t.type}] ${t.zh_content}`))).join('\n');
                break;
            case 'zh_body':
                text = '中文正文\n' + successResults.map(r => r.groups[0]?.zh_body ? quoteForTsv(r.groups[0].zh_body) : '').filter(Boolean).join('\n');
                break;
            case 'zh_endings':
                text = '中文结尾\n' + successResults.flatMap(r => r.endings.filter(e => e.zh_content).map(e => quoteForTsv(`[${e.zh_type || e.type}] ${e.zh_content}`))).join('\n');
                break;
            case 'tsv': {
                const hasZh = successResults.some(r => r.groups.some(g => g.zh_title || g.zh_body || g.zh_ending));
                let header = `标题\t正文\t结尾\t合并全文`;
                if (hasZh) header += `\t中文标题\t中文正文\t中文结尾\t中文合并全文`;
                
                const rows = successResults.flatMap(r => r.groups.map(g => {
                    let row = `${quoteForTsv(g.title)}\t${quoteForTsv(g.body)}\t${quoteForTsv(g.ending)}\t${quoteForTsv(g.fullText)}`;
                    if (hasZh) row += `\t${quoteForTsv(g.zh_title || '')}\t${quoteForTsv(g.zh_body || '')}\t${quoteForTsv(g.zh_ending || '')}\t${quoteForTsv(g.zh_fullText || '')}`;
                    return row;
                })).join('\n');
                text = `${header}\n${rows}`;
                break;
            }
            case 'tsv_with_original': {
                const hasZh2 = successResults.some(r => r.groups.some(g => g.zh_title || g.zh_body || g.zh_ending));
                let header = `原文\t标题\t正文\t结尾\t合并全文`;
                if (hasZh2) header += `\t中文标题\t中文正文\t中文结尾\t中文合并全文`;

                const rows = successResults.flatMap(r => r.groups.map(g => {
                    let row = `${quoteForTsv(r.originalText)}\t${quoteForTsv(g.title)}\t${quoteForTsv(g.body)}\t${quoteForTsv(g.ending)}\t${quoteForTsv(g.fullText)}`;
                    if (hasZh2) row += `\t${quoteForTsv(g.zh_title || '')}\t${quoteForTsv(g.zh_body || '')}\t${quoteForTsv(g.zh_ending || '')}\t${quoteForTsv(g.zh_fullText || '')}`;
                    return row;
                })).join('\n');
                text = `${header}\n${rows}`;
                break;
            }
            case 'zh_tsv': {
                let header = `中文标题\t中文正文\t中文结尾\t中文合并全文`;
                const rows = successResults.flatMap(r => r.groups.map(g =>
                    `${quoteForTsv(g.zh_title || '')}\t${quoteForTsv(g.zh_body || '')}\t${quoteForTsv(g.zh_ending || '')}\t${quoteForTsv(g.zh_fullText || '')}`
                )).join('\n');
                text = `${header}\n${rows}`;
                break;
            }
            case 'zh_tsv_with_original': {
                let header = `原文\t中文标题\t中文正文\t中文结尾\t中文合并全文`;
                const rows = successResults.flatMap(r => r.groups.map(g =>
                    `${quoteForTsv(r.originalText)}\t${quoteForTsv(g.zh_title || '')}\t${quoteForTsv(g.zh_body || '')}\t${quoteForTsv(g.zh_ending || '')}\t${quoteForTsv(g.zh_fullText || '')}`
                )).join('\n');
                text = `${header}\n${rows}`;
                break;
            }
        }

        try {
            await navigator.clipboard.writeText(text);
            setCopiedBatchType(type);
            setTimeout(() => setCopiedBatchType(null), 2000);
        } catch { }
    };



    const successResults = results.filter(r => r.groupsStatus === 'success');
    const totalGroups = successResults.reduce((sum, r) => sum + r.groups.length, 0);
    const hasAnyZhData = successResults.some(r => r.groups.some(g => g.zh_title || g.zh_body || g.zh_ending));

    // InstructionPanel is now memoized and defined outside the component

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto" style={{ scrollBehavior: 'smooth' }}>
                <div className="w-full px-4 py-6 space-y-5">

                    {/* === 标题区 === */}
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <div className="bg-gradient-to-br from-orange-500/30 to-rose-500/30 p-2 rounded-xl">
                                    <Zap className="w-5 h-5 text-orange-400" />
                                </div>
                                超级文案改写
                            </h2>
                            <p className="text-xs text-zinc-500 mt-1">
                                三指令并行：标题 + 正文 + 结尾 → 智能配对 → 四列输出
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

                    {/* === 三指令编辑区 === */}
                    <div className="space-y-2">
                        <InstructionPanel
                            title="标题指令"
                            icon={<Type className="w-4 h-4" />}
                            color="text-amber-400"
                            value={titleInstruction}
                            onChange={setTitleInstruction}
                            defaultValue={DEFAULT_TITLE_INSTRUCTION}
                            isOpen={showTitleInstruction}
                            onToggle={() => setShowTitleInstruction(!showTitleInstruction)}
                            enableRewrite={enableTitleRewrite}
                            onToggleRewrite={() => setEnableTitleRewrite(!enableTitleRewrite)}
                            rewriteLabel="改写标题"
                        />

                        <InstructionPanel
                            title="正文指令"
                            icon={<AlignLeft className="w-4 h-4" />}
                            color="text-emerald-400"
                            value={bodyInstruction}
                            onChange={setBodyInstruction}
                            defaultValue={DEFAULT_BODY_INSTRUCTION}
                            isOpen={showBodyInstruction}
                            onToggle={() => setShowBodyInstruction(!showBodyInstruction)}
                            enableRewrite={enableBodyRewrite}
                            onToggleRewrite={() => setEnableBodyRewrite(!enableBodyRewrite)}
                            rewriteLabel="改写正文"
                        />

                        <InstructionPanel
                            title="结尾指令"
                            icon={<MessageSquareQuote className="w-4 h-4" />}
                            color="text-violet-400"
                            value={endingInstruction}
                            onChange={setEndingInstruction}
                            defaultValue={DEFAULT_ENDING_INSTRUCTION}
                            isOpen={showEndingInstruction}
                            onToggle={() => setShowEndingInstruction(!showEndingInstruction)}
                            enableRewrite={enableEndingRewrite}
                            onToggleRewrite={() => setEnableEndingRewrite(!enableEndingRewrite)}
                            rewriteLabel="改写结尾"
                        />
                    </div>

                    <div className="flex items-center gap-3">
                        {/* === 输出语言设置 === */}
                        <div className="w-fit max-w-full bg-zinc-900/60 border border-zinc-800/80 rounded-xl px-3 py-2" style={{ overflow: 'visible', position: 'relative', zIndex: 20 }}>
                            <div className="flex items-center gap-2" style={{ overflow: 'visible' }}>
                                <div className="flex items-center gap-1.5 shrink-0">
                                    <Globe className="w-4 h-4 text-cyan-400" />
                                    <span className="text-xs font-medium text-zinc-300">输出语言</span>
                                    <span className="text-[9px] text-zinc-600 hidden 2xl:inline">可分别控制标题/正文/结尾的输出语言</span>
                                </div>
                                <div className="flex items-center gap-1.5 min-w-0" style={{ overflow: 'visible' }}>
                                    {/* 统一语言设置 */}
                                    <LanguageSelector label="语言" value={globalLang} onChange={setGlobalLang} color="text-cyan-300" placeholder="跟从指令" />
                                </div>
                            </div>
                        </div>

                        {/* === 配对模式 === */}
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-zinc-500 font-medium">配对模式:</span>
                            <div className="flex bg-zinc-900 border border-zinc-700 rounded-lg p-0.5">
                                {[
                                    { value: 'sequential' as PairMode, label: '顺序配对', icon: <ArrowDownUp className="w-3 h-3" /> },
                                    { value: 'ai' as PairMode, label: 'AI智能', icon: <Sparkles className="w-3 h-3" /> },
                                    { value: 'cartesian' as PairMode, label: '全组合', icon: <Grid3X3 className="w-3 h-3" /> },
                                ].map(mode => (
                                    <button
                                        key={mode.value}
                                        onClick={() => setPairMode(mode.value)}
                                        className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-medium transition-all ${pairMode === mode.value
                                            ? 'bg-orange-600 text-white'
                                            : 'text-zinc-400 hover:text-zinc-200'
                                            }`}
                                    >
                                        {mode.icon}
                                        {mode.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>

                    {/* === 信仰版权与规范设置 === */}
                    <div className="bg-zinc-900/60 border border-zinc-800 rounded-xl overflow-hidden mb-4">
                        <button
                            onClick={() => setShowDeitySettings(!showDeitySettings)}
                            className="w-full flex items-center justify-between px-4 py-3 hover:bg-zinc-800/50 transition-colors"
                        >
                            <div className="flex items-center gap-2 text-zinc-300">
                                <ShieldCheck className="w-4 h-4 text-amber-400" />
                                <span className="font-medium text-sm">信仰版权与规范</span>
                            </div>
                            <div className="flex items-center gap-2">
                                {settings.enableScriptureDetection && (
                                    <span className="text-[10px] text-amber-500 bg-amber-500/10 px-2 py-0.5 rounded">经文检测开启</span>
                                )}
                                {showDeitySettings ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                            </div>
                        </button>
                        {showDeitySettings && (
                            <div className="px-4 pb-4 pt-2 border-t border-zinc-800/50">
                                <ScriptureDeitySettingsPanel settings={settings} />
                            </div>
                        )}
                    </div>

                    {/* === 输入区 === */}
                    <div className="space-y-3">
                        <div className="relative">
                            <textarea
                                value={inputText}
                                onChange={e => {
                                    setInputText(e.target.value);
                                    if (pendingInputs.length > 0) setPendingInputs([]);
                                }}
                                onPaste={handlePaste}
                                placeholder={pendingInputs.length > 0 ? '已解析表格数据，点击「开始改写」处理' : '支持多行批量，或直接从 Google Sheets 粘贴内容...'}
                                rows={pendingInputs.length > 0 ? 2 : 6}
                                className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 resize-y focus:outline-none focus:ring-2 focus:ring-orange-500/30 focus:border-orange-500/30 transition-all"
                                disabled={isProcessing || pendingInputs.length > 0}
                            />
                            <div className="absolute bottom-3 right-3 flex items-center gap-2">
                                {pendingInputs.length > 0 ? (
                                    <span className="text-[10px] text-orange-400 font-medium">
                                        📋 {pendingInputs.length} 条文案已就绪
                                    </span>
                                ) : (
                                    <span className="text-[10px] text-zinc-600">
                                        {inputText.length} 字
                                    </span>
                                )}
                            </div>
                        </div>

                        {/* === 粘贴解析列表 === */}
                        {pendingInputs.length > 0 && (
                            <div className="bg-zinc-900/60 border border-orange-500/20 rounded-xl overflow-hidden">
                                <div className="flex items-center justify-between px-4 py-2 border-b border-zinc-800/50">
                                    <div className="flex items-center gap-2">
                                        <List className="w-3.5 h-3.5 text-orange-400" />
                                        <span className="text-xs font-medium text-orange-400">已解析 {pendingInputs.length} 条文案</span>
                                    </div>
                                    <button
                                        onClick={handleClearPendingInputs}
                                        className="text-[10px] text-zinc-500 hover:text-red-400 flex items-center gap-1 transition-colors"
                                    >
                                        <X className="w-3 h-3" />
                                        清除
                                    </button>
                                </div>
                                <div className="max-h-60 overflow-y-auto custom-scrollbar divide-y divide-zinc-800/30">
                                    {pendingInputs.map((item, index) => (
                                        <div key={index} className="group flex items-start gap-3 px-4 py-2.5 hover:bg-zinc-800/20 transition-colors">
                                            <span className="shrink-0 text-[10px] text-zinc-600 font-mono mt-0.5 min-w-[24px] text-right">
                                                {index + 1}.
                                            </span>
                                            <div className="flex-1 min-w-0">
                                                <p className="text-xs text-zinc-300 whitespace-pre-wrap leading-relaxed line-clamp-4">
                                                    {item}
                                                </p>
                                                {item.length > 200 && (
                                                    <span className="text-[9px] text-zinc-600 mt-0.5 inline-block">
                                                        {item.length} 字
                                                    </span>
                                                )}
                                            </div>
                                            <button
                                                onClick={() => handleRemovePendingItem(index)}
                                                className="shrink-0 p-1 text-zinc-600 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-all"
                                                title="移除此条"
                                            >
                                                <X className="w-3 h-3" />
                                            </button>
                                        </div>
                                    ))}
                                </div>
                            </div>
                        )}

                        <div className="flex items-center gap-2 flex-wrap">
                            {isProcessing ? (
                                <>
                                    <button
                                        onClick={handleStop}
                                        className="flex items-center gap-2 px-5 py-2 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium text-sm transition-all"
                                    >
                                        <X className="w-4 h-4" />
                                        停止
                                    </button>
                                    {batchProgress && batchProgress.total > 1 && (
                                        <span className="text-[10px] text-amber-500/80 font-medium">
                                            {batchProgress.current}/{batchProgress.total}
                                        </span>
                                    )}
                                </>
                            ) : (
                                <button
                                    onClick={handleGenerate}
                                    disabled={(!inputText.trim() && pendingInputs.length === 0) || !titleInstruction.trim() || !endingInstruction.trim()}
                                    className={`flex items-center gap-2 px-5 py-2 rounded-xl font-medium text-sm transition-all ${(inputText.trim() || pendingInputs.length > 0) && titleInstruction.trim() && endingInstruction.trim()
                                        ? 'bg-gradient-to-r from-orange-500 to-rose-500 hover:from-orange-600 hover:to-rose-600 text-white shadow-lg shadow-orange-500/20'
                                        : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                        }`}
                                >
                                    <Sparkles className="w-4 h-4" />
                                    开始改写{pendingInputs.length > 0 ? ` (${pendingInputs.length})` : ''}
                                </button>
                            )}

                            {results.length > 0 && !isProcessing && (
                                <>
                                    <span className="text-zinc-700 mx-0.5">|</span>
                                    <button
                                        onClick={handleRedoAll}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
                                    >
                                        <RotateCw className="w-3 h-3" />
                                        重做 ({results.length})
                                    </button>
                                    {results.some(r => getOverallStatus(r) === 'error') && (
                                        <button
                                            onClick={handleRetryFailed}
                                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] bg-amber-500/10 hover:bg-amber-500/20 text-amber-400 border border-amber-500/30 transition-colors"
                                        >
                                            <RotateCw className="w-3 h-3" />
                                            重试失败 ({results.filter(r => getOverallStatus(r) === 'error').length})
                                        </button>
                                    )}
                                    <button
                                        onClick={handleClearAll}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] bg-zinc-800 hover:bg-red-900/30 text-zinc-500 hover:text-red-400 border border-zinc-700 transition-colors"
                                    >
                                        <Trash2 className="w-3 h-3" />
                                        清除
                                    </button>
                                </>
                            )}

                            {totalGroups > 0 && !isProcessing && (
                                <>
                                    <span className="text-zinc-700 mx-0.5">|</span>
                                    <span className="text-[10px] text-zinc-500">复制:</span>
                                    {[
                                        { type: 'tsv' as const, label: `TSV (${totalGroups})` },
                                        { type: 'tsv_with_original' as const, label: '含原文' },
                                        { type: 'titles' as const, label: '标题' },
                                        { type: 'body' as const, label: '正文' },
                                        { type: 'endings' as const, label: '结尾' },
                                    ].map(btn => (
                                        <button
                                            key={btn.type}
                                            onClick={() => handleBatchCopy(btn.type)}
                                            className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors"
                                        >
                                            {copiedBatchType === btn.type ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                            {copiedBatchType === btn.type ? '已复制' : btn.label}
                                        </button>
                                    ))}
                                    {hasAnyZhData && (
                                        <>
                                            <span className="text-zinc-700 mx-0.5">|</span>
                                            <span className="text-[10px] text-cyan-500/70">中文:</span>
                                            {[
                                                { type: 'zh_tsv' as const, label: '中文TSV' },
                                                { type: 'zh_tsv_with_original' as const, label: '中文+原文' },
                                                { type: 'zh_titles' as const, label: '中文标题' },
                                                { type: 'zh_body' as const, label: '中文正文' },
                                                { type: 'zh_endings' as const, label: '中文结尾' },
                                            ].map(btn => (
                                                <button
                                                    key={btn.type}
                                                    onClick={() => handleBatchCopy(btn.type)}
                                                    className="flex items-center gap-1 px-2.5 py-1 rounded-lg text-[10px] bg-cyan-950/40 hover:bg-cyan-900/40 text-cyan-300 border border-cyan-800/40 transition-colors"
                                                >
                                                    {copiedBatchType === btn.type ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                                    {copiedBatchType === btn.type ? '已复制' : btn.label}
                                                </button>
                                            ))}
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    {/* === 结果列表 === */}
                    {results.length > 0 && (
                        <div className="space-y-4">
                            <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                                <Clock className="w-4 h-4 text-zinc-500" />
                                生成结果
                                <span className="text-xs text-zinc-500">({successResults.length})</span>
                            </h3>

                            {results.map(result => {
                                const status = getOverallStatus(result);
                                return (
                                    <div key={result.id} className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden transition-all">
                                        {/* Header */}
                                        <div
                                            className="flex items-center gap-3 px-4 py-3 cursor-pointer hover:bg-zinc-800/30 transition-colors"
                                            onClick={() => handleToggleCollapse(result.id)}
                                        >
                                            <div className={`shrink-0 p-1.5 rounded-lg ${status === 'processing' ? 'bg-orange-500/20'
                                                : status === 'success' ? 'bg-emerald-500/20'
                                                    : status === 'error' ? 'bg-red-500/20'
                                                        : 'bg-zinc-800'
                                                }`}>
                                                {status === 'processing' ? (
                                                    <Loader2 className="w-4 h-4 text-orange-400 animate-spin" />
                                                ) : status === 'success' ? (
                                                    <Check className="w-4 h-4 text-emerald-400" />
                                                ) : status === 'error' ? (
                                                    <X className="w-4 h-4 text-red-400" />
                                                ) : (
                                                    <FileText className="w-4 h-4 text-zinc-500" />
                                                )}
                                            </div>

                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2 flex-wrap">
                                                    {/* Progress badges */}
                                                    <StatusBadge label="标题" status={result.titlesStatus} count={result.titles.length} />
                                                    <StatusBadge label="正文" status={result.bodyStatus} />
                                                    <StatusBadge label="结尾" status={result.endingsStatus} count={result.endings.length} />
                                                    <StatusBadge label="配对" status={result.groupsStatus} count={result.groups.length} />
                                                    <span className="text-[10px] text-zinc-600">
                                                        {new Date(result.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                                    </span>
                                                </div>
                                                <p className="text-xs text-zinc-500 truncate mt-0.5">
                                                    {result.originalText.slice(0, 100)}...
                                                </p>
                                            </div>

                                            <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                                {/* 复制按钮组 */}
                                                {result.groups.length > 0 && (<>
                                                    <CopyBtn
                                                        text={`标题\t正文\t结尾\n` + result.groups.map(g => `${quoteForTsv(g.title)}\t${quoteForTsv(g.body)}\t${quoteForTsv(g.ending)}`).join('\n')}
                                                        id={`all-${result.id}`}
                                                        label="全部"
                                                        copiedId={copiedId}
                                                        onCopy={handleCopy}
                                                        accent
                                                    />
                                                    <CopyBtn
                                                        text={`原文\t标题\t正文\t结尾\n` + result.groups.map(g => `${quoteForTsv(result.originalText)}\t${quoteForTsv(g.title)}\t${quoteForTsv(g.body)}\t${quoteForTsv(g.ending)}`).join('\n')}
                                                        id={`allOrig-${result.id}`}
                                                        label="含原文"
                                                        copiedId={copiedId}
                                                        onCopy={handleCopy}
                                                    />
                                                    <CopyBtn
                                                        text={`标题\n` + result.groups.map(g => quoteForTsv(g.title)).join('\n')}
                                                        id={`allT-${result.id}`}
                                                        label="标题"
                                                        copiedId={copiedId}
                                                        onCopy={handleCopy}
                                                    />
                                                    <CopyBtn
                                                        text={`正文\n` + result.groups.map(g => quoteForTsv(g.body)).filter((v, i, a) => a.indexOf(v) === i).join('\n')}
                                                        id={`allB-${result.id}`}
                                                        label="正文"
                                                        copiedId={copiedId}
                                                        onCopy={handleCopy}
                                                    />
                                                    <CopyBtn
                                                        text={`结尾\n` + result.groups.map(g => quoteForTsv(g.ending)).join('\n')}
                                                        id={`allE-${result.id}`}
                                                        label="结尾"
                                                        copiedId={copiedId}
                                                        onCopy={handleCopy}
                                                    />
                                                </>)}
                                                <button
                                                    onClick={() => handleSetViewMode(result.id, result.viewMode === 'prompts' ? 'rendered' : 'prompts')}
                                                    className={`${RESULT_ACTION_BTN_BASE} ${result.viewMode === 'prompts'
                                                        ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                                                        : 'bg-zinc-900/40 text-zinc-300 border-zinc-700/60 hover:bg-zinc-800/70 hover:border-zinc-600'
                                                        }`}
                                                >
                                                    查看指令
                                                </button>
                                                <button
                                                    onClick={() => handleSetViewMode(result.id, result.viewMode === 'outputs' ? 'rendered' : 'outputs')}
                                                    className={`${RESULT_ACTION_BTN_BASE} ${result.viewMode === 'outputs'
                                                        ? 'bg-orange-500/20 text-orange-300 border-orange-500/40'
                                                        : 'bg-zinc-900/40 text-zinc-300 border-zinc-700/60 hover:bg-zinc-800/70 hover:border-zinc-600'
                                                        }`}
                                                >
                                                    查看返回
                                                </button>
                                                <div className="w-px h-4 bg-zinc-800 mx-1"></div>
                                                <button
                                                    onClick={() => handleRetrySingle(result.id)}
                                                    className={`${RESULT_ICON_BTN_BASE} text-zinc-400 border-zinc-700/60 bg-zinc-900/40 hover:text-orange-300 hover:bg-zinc-800/70 hover:border-zinc-600`}
                                                    title="重新生成"
                                                >
                                                    <RotateCw className="w-3.5 h-3.5" />
                                                </button>
                                                <button
                                                    onClick={() => handleDelete(result.id)}
                                                    className={`${RESULT_ICON_BTN_BASE} text-zinc-400 border-zinc-700/60 bg-zinc-900/40 hover:text-red-300 hover:bg-zinc-800/70 hover:border-zinc-600`}
                                                    title="删除"
                                                >
                                                    <Trash2 className="w-3.5 h-3.5" />
                                                </button>
                                            </div>
                                        </div>

                                        {/* Result Content */}
                                        {!result.collapsed && (
                                            <div className="border-t border-zinc-800/50 overflow-x-auto pb-4">
                                                {result.viewMode === 'prompts' && (
                                                    <div className="p-4 grid gap-4 grid-cols-1">
                                                        {result.rawPrompts?.extractBody ? (
                                                            <>
                                                                <DebugPanel title="正文提取指令" content={result.rawPrompts.extractBody} />
                                                                <DebugPanel title="标题生成指令" content={result.rawPrompts.titles} />
                                                                {result.rawPrompts.body && <DebugPanel title="正文改写指令" content={result.rawPrompts.body} />}
                                                                <DebugPanel title="结尾生成指令" content={result.rawPrompts.endings} />
                                                            </>
                                                        ) : (
                                                            <>
                                                                <DebugPanel title="用户指令 (User Prompt) — 包含标题/正文/结尾指令+原文" content={result.rawPrompts?.titles || ''} />
                                                                <DebugPanel title="系统指令 (System Prompt) — 包含语言锁定+自检规则" content={result.rawPrompts?.endings || ''} />
                                                            </>
                                                        )}
                                                        {result.rawPrompts?.groups && <DebugPanel title="智能配对指令" content={result.rawPrompts.groups} />}
                                                    </div>
                                                )}
                                                {result.viewMode === 'outputs' && (
                                                    <div className="p-4 grid gap-4 grid-cols-1">
                                                        {result.rawOutputs?.extractBody ? (
                                                            <>
                                                                <DebugPanel title="正文提取返回" content={result.rawOutputs.extractBody} />
                                                                <DebugPanel title="标题生成返回" content={result.rawOutputs.titles} />
                                                                {result.rawOutputs.body && <DebugPanel title="正文改写返回" content={result.rawOutputs.body} />}
                                                                <DebugPanel title="结尾生成返回" content={result.rawOutputs.endings} />
                                                            </>
                                                        ) : (
                                                            <DebugPanel title="核心生成返回 (JSON)" content={result.rawOutputs?.titles || ''} />
                                                        )}
                                                        {result.rawOutputs?.groups && <DebugPanel title="智能配对返回" content={result.rawOutputs.groups} />}
                                                    </div>
                                                )}
                                                {(!result.viewMode || result.viewMode === 'rendered') && result.groups.length > 0 && (
                                                <table className="w-full min-w-[900px] text-xs mt-2">
                                                    <thead>
                                                        <tr className="bg-zinc-800/50">
                                                            <th className="px-2 py-2 text-left text-zinc-400 font-medium w-[40px]">#</th>
                                                            <th className="px-2 py-2 text-left text-zinc-400 font-medium">标题</th>
                                                            <th className="px-2 py-2 text-left text-zinc-400 font-medium">正文</th>
                                                            <th className="px-2 py-2 text-left text-zinc-400 font-medium">结尾</th>
                                                            <th className="px-2 py-2 text-left text-zinc-400 font-medium">
                                                                完整文案
                                                                {globalLang !== 'auto' && <span className="ml-1.5 text-[9px] text-cyan-400/70 font-normal">{ALL_LANGUAGES.find(l => l.code === globalLang)?.zh || globalLang}</span>}
                                                                {globalLang === 'auto' && <span className="ml-1.5 text-[9px] text-zinc-500 font-normal">跟从指令</span>}
                                                            </th>
                                                        </tr>
                                                    </thead>
                                                    <tbody>
                                                        {result.groups.map((group, idx) => {
                                                            const hasZh = !!(group.zh_title || group.zh_body || group.zh_ending || group.zh_fullText);
                                                            return (<React.Fragment key={idx}>
                                                            {/* === 外文行 === */}
                                                            <tr
                                                                className={`result-row-hover hover:bg-zinc-800/20 transition-colors ${idx === 0 ? 'border-t border-zinc-800/30' : 'border-t border-zinc-600 shadow-[0_-1px_0_rgba(255,255,255,0.05)]'}`}
                                                                onContextMenu={(e) => openResultCopyMenu(e, [
                                                                    { id: `f-${result.id}-${idx}`, label: '复制整条', text: `标题\t正文\t结尾\t合并全文\n${quoteForTsv(group.title)}\t${quoteForTsv(group.body)}\t${quoteForTsv(group.ending)}\t${quoteForTsv(group.fullText)}` },
                                                                    { id: `forig-${result.id}-${idx}`, label: '含原文整条', text: `原文\t标题\t正文\t结尾\t合并全文\n${quoteForTsv(result.originalText)}\t${quoteForTsv(group.title)}\t${quoteForTsv(group.body)}\t${quoteForTsv(group.ending)}\t${quoteForTsv(group.fullText)}` },
                                                                    { id: `ft-${result.id}-${idx}`, label: '复制标题', text: `标题\n${quoteForTsv(group.title)}` },
                                                                    { id: `fb-${result.id}-${idx}`, label: '复制正文', text: `正文\n${quoteForTsv(group.body)}` },
                                                                    { id: `fe-${result.id}-${idx}`, label: '复制结尾', text: `结尾\n${quoteForTsv(group.ending)}` },
                                                                ])}
                                                            >
                                                                <td className="px-2 py-2 text-zinc-600 align-top">{idx + 1}</td>
                                                                <td className="px-2 py-2 align-top">
                                                                    <div className="flex items-center gap-1 mb-1 flex-wrap">
                                                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-medium ${getTypeColor(group.titleType)}`}>{group.titleType}</span>
                                                                    </div>
                                                                    <div className="text-zinc-200 whitespace-pre-wrap leading-relaxed max-h-28 overflow-y-auto custom-scrollbar break-words">{group.title}</div>
                                                                </td>
                                                                <td className="px-2 py-2 align-top">
                                                                    <div className="text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-28 overflow-y-auto custom-scrollbar break-words">
                                                                        {idx === 0 ? group.body : <span className="text-zinc-600 italic">同上</span>}
                                                                    </div>
                                                                    {idx === 0 && result.scriptureNote && (
                                                                        <div className="mt-2 text-[10px] text-amber-400/90 font-medium break-words">
                                                                            <span className="bg-amber-500/10 px-1 py-0.5 rounded">{result.scriptureNote}</span>
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td className="px-2 py-2 align-top">
                                                                    <div className="flex items-center gap-1 mb-1 flex-wrap">
                                                                        <span className={`inline-block px-1.5 py-0.5 rounded text-[9px] font-medium ${getTypeColor(group.endingType)}`}>{group.endingType}</span>
                                                                    </div>
                                                                    <div className="text-zinc-200 whitespace-pre-wrap leading-relaxed max-h-28 overflow-y-auto custom-scrollbar break-words">{group.ending}</div>
                                                                </td>
                                                                <td className="px-2 py-2 align-top">
                                                                    <div className="text-zinc-300 whitespace-pre-wrap leading-relaxed max-h-36 overflow-y-auto custom-scrollbar text-[11px] break-words">{group.fullText}</div>
                                                                </td>
                                                            </tr>
                                                            {/* === 中文行 === */}
                                                            {hasZh && (
                                                            <tr
                                                                className="result-row-hover bg-cyan-950/15 border-t border-dashed border-cyan-800/25"
                                                                onContextMenu={(e) => openResultCopyMenu(e, [
                                                                    { id: `zf-${result.id}-${idx}`, label: '复制中文整条', text: `中文标题\t中文正文\t中文结尾\t中文合并全文\n${quoteForTsv(group.zh_title || group.title)}\t${quoteForTsv(group.zh_body || group.body)}\t${quoteForTsv(group.zh_ending || group.ending)}\t${quoteForTsv(group.zh_fullText || '')}` },
                                                                    { id: `zforig-${result.id}-${idx}`, label: '含原文中文整条', text: `原文\t中文标题\t中文正文\t中文结尾\t中文合并全文\n${quoteForTsv(result.originalText)}\t${quoteForTsv(group.zh_title || group.title)}\t${quoteForTsv(group.zh_body || group.body)}\t${quoteForTsv(group.zh_ending || group.ending)}\t${quoteForTsv(group.zh_fullText || '')}` },
                                                                    { id: `zft-${result.id}-${idx}`, label: '复制中文标题', text: `中文标题\n${quoteForTsv(group.zh_title || '')}` },
                                                                    { id: `zfb-${result.id}-${idx}`, label: '复制中文正文', text: `中文正文\n${quoteForTsv(group.zh_body || '')}` },
                                                                    { id: `zfe-${result.id}-${idx}`, label: '复制中文结尾', text: `中文结尾\n${quoteForTsv(group.zh_ending || '')}` },
                                                                ])}
                                                            >
                                                                <td className="px-2 py-1.5 align-top">
                                                                    <span className="text-[8px] px-1 py-0.5 rounded bg-cyan-900/40 text-cyan-400/80 font-medium">中</span>
                                                                </td>
                                                                <td className="px-2 py-1.5 align-top">
                                                                    {group.zh_title ? (
                                                                        <>
                                                                            <div className="text-zinc-400 text-[10px] whitespace-pre-wrap leading-relaxed max-h-20 overflow-y-auto custom-scrollbar break-words mt-0.5">{group.zh_title}</div>
                                                                        </>
                                                                    ) : <span className="text-zinc-700 text-[10px]">—</span>}
                                                                </td>
                                                                <td className="px-2 py-1.5 align-top">
                                                                    {idx === 0 && group.zh_body ? (
                                                                        <>
                                                                            <div className="text-zinc-400 text-[10px] whitespace-pre-wrap leading-relaxed max-h-20 overflow-y-auto custom-scrollbar break-words mt-0.5">{group.zh_body}</div>
                                                                        </>
                                                                    ) : <span className="text-zinc-700 text-[10px]">{idx === 0 ? '—' : ''}</span>}
                                                                </td>
                                                                <td className="px-2 py-1.5 align-top">
                                                                    {group.zh_ending ? (
                                                                        <>
                                                                            <div className="text-zinc-400 text-[10px] whitespace-pre-wrap leading-relaxed max-h-20 overflow-y-auto custom-scrollbar break-words mt-0.5">{group.zh_ending}</div>
                                                                        </>
                                                                    ) : <span className="text-zinc-700 text-[10px]">—</span>}
                                                                </td>
                                                                <td className="px-2 py-1.5 align-top">
                                                                    {group.zh_fullText ? (
                                                                        <>
                                                                            <div className="text-zinc-400 text-[10px] whitespace-pre-wrap leading-relaxed max-h-28 overflow-y-auto custom-scrollbar break-words">{group.zh_fullText}</div>
                                                                        </>
                                                                    ) : <span className="text-zinc-700 text-[10px]">—</span>}
                                                                </td>
                                                            </tr>
                                                            )}
                                                            </React.Fragment>);
                                                        })}
                                                    </tbody>
                                                </table>
                                                )}
                                            </div>
                                        )}

                                        {/* Error details */}
                                        {!result.collapsed && status === 'error' && (
                                            <div className="border-t border-zinc-800/50 px-4 py-3">
                                                {result.titlesError && <p className="text-xs text-red-400">标题: {result.titlesError}</p>}
                                                {result.bodyError && <p className="text-xs text-red-400">正文: {result.bodyError}</p>}
                                                {result.endingsError && <p className="text-xs text-red-400">结尾: {result.endingsError}</p>}
                                                {result.groupsError && <p className="text-xs text-red-400">配对: {result.groupsError}</p>}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>
            </div>
            {resultCopyMenu && (
                <>
                    <div
                        className="fixed inset-0 z-[90]"
                        onClick={() => setResultCopyMenu(null)}
                        onContextMenu={(e) => {
                            e.preventDefault();
                            setResultCopyMenu(null);
                        }}
                    />
                    <div
                        id="result-copy-menu"
                        className="fixed z-[91] min-w-[168px] bg-zinc-950/95 border border-zinc-700 rounded-lg shadow-xl overflow-hidden"
                        style={{ left: resultCopyMenu.x, top: resultCopyMenu.y }}
                        onMouseLeave={() => setResultCopyMenu(null)}
                    >
                        {resultCopyMenu.items.map(item => {
                            const isCopied = copiedId === item.id;
                            return (
                                <button
                                    type="button"
                                    key={item.id}
                                    onClick={() => {
                                        handleCopy(item.text, item.id);
                                        setResultCopyMenu(null);
                                    }}
                                    className={`w-full h-8 px-3 text-xs text-left flex items-center gap-2 transition-colors ${
                                        isCopied
                                            ? 'bg-emerald-500/20 text-emerald-300'
                                            : 'text-zinc-200 hover:bg-zinc-800'
                                    }`}
                                >
                                    {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3 text-zinc-400" />}
                                    {isCopied ? '已复制' : item.label}
                                </button>
                            );
                        })}
                    </div>
                </>
            )}
        </div>
    );
}

// --- Sub-components ---

const RESULT_ACTION_BTN_BASE = 'inline-flex items-center justify-center gap-1 h-8 px-2.5 rounded-lg text-[11px] font-medium border transition-colors';
const RESULT_ICON_BTN_BASE = 'inline-flex items-center justify-center h-8 w-8 rounded-lg border transition-colors';

function StatusBadge({ label, status, count }: { label: string; status: string; count?: number }) {
    const colors: Record<string, string> = {
        idle: 'bg-zinc-800 text-zinc-500 border-zinc-700',
        processing: 'bg-orange-500/15 text-orange-400 border-orange-500/20',
        success: 'bg-emerald-500/15 text-emerald-400 border-emerald-500/20',
        error: 'bg-red-500/15 text-red-400 border-red-500/20',
        skipped: 'bg-zinc-700/50 text-zinc-400 border-zinc-600',
    };
    return (
        <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-medium border ${colors[status] || colors.idle}`}>
            {status === 'processing' && <Loader2 className="w-2.5 h-2.5 animate-spin" />}
            {status === 'success' && <Check className="w-2.5 h-2.5" />}
            {status === 'error' && <X className="w-2.5 h-2.5" />}
            {label}
            {count !== undefined && count > 0 && <span>({count})</span>}
            {status === 'skipped' && <span>跳过</span>}
        </span>
    );
}

function CopyBtn({ text, id, copiedId, onCopy, label, accent }: { text: string; id: string; copiedId: string | null; onCopy: (text: string, id: string) => void; label?: string; accent?: boolean }) {
    const isCopied = copiedId === id;
    return (
        <button
            onClick={(e) => { e.stopPropagation(); onCopy(text, id); }}
            className={`${RESULT_ACTION_BTN_BASE} ${
                isCopied
                    ? 'bg-emerald-500/20 text-emerald-300 border-emerald-500/40'
                    : accent
                        ? 'bg-orange-500/15 text-orange-300 border-orange-500/40 hover:bg-orange-500/25'
                        : 'bg-zinc-900/40 text-zinc-300 border-zinc-700/60 hover:bg-zinc-800/70 hover:border-zinc-600'
            }`}
        >
            {isCopied ? <Check className="w-3 h-3" /> : <Copy className="w-3 h-3" />}
            {isCopied ? '已复制' : (label ? `复制${label}` : '复制')}
        </button>
    );
}

// --- Language Selector (searchable dropdown) ---
function LanguageSelector({ label, value, onChange, color, followGlobal, placeholder }: { label: string; value: string; onChange: (v: string) => void; color: string; followGlobal?: string; placeholder?: string }) {
    const [open, setOpen] = useState(false);
    const [search, setSearch] = useState('');
    const ref = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        const handleClick = (e: MouseEvent) => {
            if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, []);

    useEffect(() => {
        if (open && inputRef.current) inputRef.current.focus();
    }, [open]);

    // 计算显示文本
    const isFollowingGlobal = value === 'follow_global';
    const effectiveCode = isFollowingGlobal ? (followGlobal || 'auto') : value;
    const current = ALL_LANGUAGES.find(l => l.code === effectiveCode);
    const globalLangEntry = followGlobal ? ALL_LANGUAGES.find(l => l.code === followGlobal) : null;

    const getDisplayText = () => {
        if (isFollowingGlobal) {
            if (!followGlobal || followGlobal === 'auto') return '跟随总设置';
            return `跟随 · ${globalLangEntry?.zh || followGlobal}`;
        }
        if (value === 'auto') return placeholder || '跟从指令';
        return current?.zh || '选择语言';
    };

    const filtered = useMemo(() => {
        if (!search.trim()) return ALL_LANGUAGES;
        const q = search.toLowerCase();
        return ALL_LANGUAGES.filter(l =>
            l.zh.toLowerCase().includes(q) ||
            l.en.toLowerCase().includes(q) ||
            l.native.toLowerCase().includes(q) ||
            l.code.toLowerCase().includes(q)
        );
    }, [search]);

    return (
        <div ref={ref} className="relative" style={{ minWidth: label ? '118px' : '130px' }}>
            <button
                onClick={() => { setOpen(!open); setSearch(''); }}
                className={`w-full flex items-center gap-1 px-2 py-1 rounded-lg border transition-colors text-left ${
                    isFollowingGlobal
                        ? 'border-zinc-700/40 bg-zinc-800/40 hover:border-zinc-600'
                        : (value !== 'auto'
                            ? 'border-cyan-600/40 bg-cyan-900/15 hover:border-cyan-500/50'
                            : 'border-zinc-700/60 bg-zinc-800/70 hover:border-zinc-600')
                }`}
            >
                {label && <span className={`text-[9px] font-medium ${color}`}>{label}</span>}
                <span className={`text-[10px] flex-1 truncate ${isFollowingGlobal ? 'text-zinc-500' : 'text-zinc-300'}`}>
                    {getDisplayText()}
                </span>
                {!isFollowingGlobal && value !== 'auto' && (
                    <span className="text-[8px] text-cyan-400/60 font-medium hidden xl:inline">覆盖</span>
                )}
                <ChevronDown className={`w-3 h-3 text-zinc-500 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>

            {open && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl z-50 overflow-hidden" style={{ maxHeight: '360px' }}>
                    <div className="p-2 border-b border-zinc-800">
                        <div className="flex items-center gap-2 px-2 py-1.5 bg-zinc-800/80 rounded-lg border border-zinc-700/50">
                            <Search className="w-3 h-3 text-zinc-500 shrink-0" />
                            <input
                                ref={inputRef}
                                value={search}
                                onChange={e => setSearch(e.target.value)}
                                placeholder="搜索语言 / Search..."
                                className="flex-1 bg-transparent text-[10px] text-zinc-200 placeholder:text-zinc-600 outline-none"
                            />
                        </div>
                    </div>
                    <div className="overflow-y-auto custom-scrollbar" style={{ maxHeight: '300px' }}>
                        {/* 跟随总设置 选项 (仅当 followGlobal 存在时显示) */}
                        {followGlobal !== undefined && !search.trim() && (
                            <>
                                <button
                                    onClick={() => { onChange('follow_global'); setOpen(false); setSearch(''); }}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/60 transition-colors border-b border-zinc-800/50 ${
                                        value === 'follow_global' ? 'bg-cyan-900/20 text-cyan-300' : 'text-zinc-400'
                                    }`}
                                >
                                    <span className="text-[10px] font-medium">🔗 跟随总设置</span>
                                    {globalLangEntry && followGlobal !== 'auto' && (
                                        <span className="text-[9px] text-zinc-500">→ {globalLangEntry.zh}</span>
                                    )}
                                    {(!followGlobal || followGlobal === 'auto') && (
                                        <span className="text-[9px] text-zinc-600">→ 跟从指令</span>
                                    )}
                                    {value === 'follow_global' && <Check className="w-3 h-3 text-cyan-400 ml-auto shrink-0" />}
                                </button>
                            </>
                        )}
                        {filtered.length === 0 ? (
                            <div className="p-4 text-center text-[10px] text-zinc-600">未找到匹配的语言</div>
                        ) : (
                            filtered.map(lang => (
                                <button
                                    key={lang.code}
                                    onClick={() => { onChange(lang.code); setOpen(false); setSearch(''); }}
                                    className={`w-full flex items-center gap-2 px-3 py-2 text-left hover:bg-zinc-800/60 transition-colors ${
                                        value === lang.code ? 'bg-zinc-800 text-zinc-100' : 'text-zinc-400'
                                    }`}
                                >
                                    <span className="text-[10px] font-medium text-zinc-200 min-w-[60px]">{lang.zh}</span>
                                    <span className="text-[9px] text-zinc-500 min-w-[70px]">{lang.en}</span>
                                    {lang.native && <span className="text-[9px] text-zinc-600">{lang.native}</span>}
                                    {value === lang.code && <Check className="w-3 h-3 text-emerald-400 ml-auto shrink-0" />}
                                </button>
                            ))
                        )}
                    </div>
                </div>
            )}
        </div>
    );
}

function getTypeColor(type: string): string {
    const map: Record<string, string> = {
        '悬念': 'bg-amber-500/20 text-amber-300',
        '数字': 'bg-blue-500/20 text-blue-300',
        '反问': 'bg-purple-500/20 text-purple-300',
        '痛点': 'bg-red-500/20 text-red-300',
        '互动': 'bg-emerald-500/20 text-emerald-300',
        '情感': 'bg-rose-500/20 text-rose-300',
        '祝福': 'bg-sky-500/20 text-sky-300',
        '警示': 'bg-orange-500/20 text-orange-300',
        '共鸣': 'bg-pink-500/20 text-pink-300',
        '对比': 'bg-indigo-500/20 text-indigo-300',
    };
    return map[type] || 'bg-zinc-700/50 text-zinc-300';
}

export default SuperRewriteView;
