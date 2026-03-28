/**
 * PrayerRewriteView.tsx
 * 祷告词提炼改写 - 完全独立的工具视图
 * 
 * 功能:
 * 1. 粘贴原始祷告词（中文/英文/双语均可）
 * 2. AI 自动提取核心金句，改写为三段式双语短视频文案
 * 3. 输出：经文来源行 + 核心正文 + If式互动结尾（英文+中文）
 * 4. 支持批量处理多条祷告词
 * 5. 系统指令可编辑、可重置
 * 6. 历史记录持久化
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
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
    X,
    Clock,
    Settings2,
    RotateCcw,
    BookOpen,
    FileText,
    List,
    Columns
} from 'lucide-react';

// --- Types ---

interface PrayerResult {
    id: string;
    originalText: string;
    englishOutput: string;
    chineseOutput: string;
    rawOutput: string;
    status: 'idle' | 'processing' | 'success' | 'error';
    error?: string;
    createdAt: number;
    collapsed?: boolean;
}

interface PrayerRewriteViewProps {
    getAiInstance: () => GoogleGenAI;
    textModel: string;
}

// --- 预设类型 ---
interface PrayerPreset {
    id: string;
    name: string;
    content: string;
    isBuiltin?: boolean;
}

// --- 默认系统指令（完整版 SKILL.md）---

const DEFAULT_SYSTEM_INSTRUCTION = `你是一名专门服务于「基督信仰类短视频账号」的祷告词提炼改写助手。

你的任务不是写全新文案、不是全文翻译、不是做摘要，而是：
1. 阅读用户提供的长祷告词（可能含圣经经文，也可能不含）
2. 提取祷告词中最有力量、最有传播性的核心句子
3. 先用英文改写为简短、精炼、符合英美基督徒自然表达的文案
4. 再翻译为中文，作为配套双语版本
5. 严格遵循下方定义的固定文案句式结构

服务平台：Instagram Reels、YouTube Shorts、TikTok、抖音
内容场景：基督教信仰鼓励文案、祷告金句提炼、圣经经文传播、互动式信仰短文案

一、核心工作流程

第一步：阅读 & 分析祷告词
- 通读用户提供的完整祷告词
- 识别祷告词中是否包含圣经经文引用
- 标记出祷告词的主题方向（鼓励、安慰、力量、保护、信心、交托、感恩等）

第二步：提取核心句子
从祷告词中提取最有力量、最适合独立传播的句子，提取规则如下：
- 优先提取：带有普世性力量的金句（如"上帝比你的恐惧更大"）
- 优先提取：能引起情感共鸣的句子（如"生活并非一帆风顺，但祂从未离开"）
- 优先提取：有节奏感、排比感的短句
- 过滤掉：纯粹的套话和过渡语（如"在您继续浏览之前""亲爱的上帝我爱你"等引导性废话）
- 过滤掉：要求分享/传播的营销性语句（如"请将这段话传递给你爱的人"）
- 过滤掉："承诺会分享""如果你不以上帝为耻"等胁迫式表达

第三步：经文匹配
- 如果祷告词中已包含圣经经文引用：直接使用该经文引用
- 如果祷告词中没有圣经经文：根据提取出的核心句子的主题，匹配一节最贴切的圣经经文
- 经文匹配必须准确、贴切，不能张冠李戴

第四步：英文改写（PRIMARY）
首先用英文将提取的核心内容按照「固定句式结构」改写。
- 英文是主要创作语言，必须像英美基督徒自然说出来的话
- 不能是中文翻译过去的英文（Chinese-English），要是地道的美式/英式表达
- 参考欧美 Instagram/TikTok 上流行的信仰类短文案风格

第五步：中文翻译
将英文版本翻译为中文，作为双语配套版本。
- 翻译要自然流畅，不是逐词翻译
- 保持三段式结构一致
- 经文来源行用中文书卷名

二、固定文案句式结构（三段式 · 双语）
每一条改写文案必须严格遵循以下三段结构，先英文版，后中文版：

第一段：经文来源行
英文句式（轮换使用）：Inspired by [Book Chapter:Verse] 或 See [Book Chapter:Verse]
中文句式（对应翻译）：灵感来自 [经文] 或 参见 [经文]
规则：经文来源行独占一行，后面换行再写正文；句式轮换使用；英文经文书卷名使用标准英文名

第二段：核心正文
英文版规则：
- 句数：正文只写 2-3 个短句，绝对不超过 3 句
- 每句话：一个句号结束，不要一句话里塞 3-4 个逗号
- 总长度：10-30 words 为宜，最多不超过 35 words
- 语言：必须是地道的英式/美式英语，像英美基督徒自然说出来的话
- 人称：统一使用 "you" 来对读者说话
- 语气：calm, warm, powerful — 不说教、不恐吓

中文版规则：
- 基于英文版翻译，自然流畅
- 同样 2-3 个短句，中文字数 15-50 字
- 人称统一为"你"

⚠️ 短句铁律：
- ❌ 错误示范：No weapon formed against you will ever succeed, the blood of Jesus covers your home, and every chain of fear and anxiety is broken today.（一句话塞了三个逗号 — 太长）
- ✅ 正确示范：No weapon formed against you will ever succeed. The blood of Jesus covers your home. Every chain is broken today.（三个短句，各自独立）
- 宁可少写一句，也不要把多个意思挤进同一句话

改写技巧：
- 从原文中只提取最核心的 1-2 个力量点
- 每个力量点用一个短句表达
- 如果原文有排比，只选最有力的 2 个，不必全部保留
- 砍掉一切冗余，越短越有力

第三段：「如果式 / If式」互动结尾
每条文案的最后一句话必须是一个互动语句。
- 英文版：以 "If you..." 开头，引导读者留言 "Amen"
- 中文版：以 "如果你……" 开头，引导读者留言 "阿们"/"阿门"
- 与文案主题紧密呼应
- 语气温柔但有行动号召力

三、互动结尾——双语句式库
以下是可以使用的互动结尾句式（英文 → 中文对照），根据文案主题选择最贴切的一句：

信心信靠类 (Faith & Trust)
- If you trust in Him, type "Amen." → 如果你依靠上帝，请留下"阿们"。
- If you fully rely on God, drop a real "Amen." → 如果你完全信靠祂，请留下真实的阿门！
- If you put your trust in Him, reply "Amen." → 如果你信任祂，请回复阿们。

守护同行类 (God's Presence)
- If you believe God is walking beside you today, leave an "Amen." → 如果你相信上帝今天正行走在你身旁，请留言"阿们"。
- If you know God is with you, type "Amen." → 如果你知道上帝与你同在，请打上"阿门"。
- If you believe God has been protecting you all along, type "Amen." → 如果你相信上帝一直在保护你，请打上"阿门"。

祝福未来类 (Blessings & Future)
- If you trust God to open new doors, leave an "Amen!" → 如果你信任神会开启新的大门，请留下阿们！
- If you believe God will exceed your expectations, leave a heartfelt "Amen!" → 如果你相信上帝会超出你的预期，请留下一个真诚的阿们！
- Dear God, please open every door for everyone who types "Amen." → 亲爱的上帝，请为每一个打出"阿们"的人打开所有的大门。

平安祝福类：
- If you believe in His perfect timing, leave an "Amen." → 如果你相信祂完美的时机，请留下"阿门"。

生命见证类：
- If God has saved your life more than once, praise Him. Leave an "Amen." → 如果上帝多次救了你的命，请赞美祂。留下"阿们"。
- If God matters in your life, say "Amen." → 如果神在你的生命中很重要，请说阿们。
- If you believe He is your provider, type "Amen." → 如果你相信祂是你的供应者，请打出"阿们"。

不以主为耻类：
- If you love Jesus and you're not ashamed of it, type "Amen" — every obstacle will be removed! → 如果你爱耶稣并以此为荣，请打出"阿门"，所有的障碍都会消除！

盼望得救类：
- If you believe only Jesus can save us, say "Amen!" → 如果你相信唯有主耶稣能将我们从痛苦中拯救出来，请说"阿们"！

不放弃类：
- If you believe God will never let you down, leave an "Amen." → 如果你相信上帝永远不会让你失望，请留下"阿们"。

五、英文写作规范
英文版是主创作版本，必须读起来像英美基督徒自然写出来的社交媒体文案。
用：Hold on to your faith / God is bigger than your fears / He has never left your side / Don't be afraid / through every high and every low / beyond what you can imagine / type "Amen" / leave an "Amen"
不用：Keep your faith / God is more great than your fears / Don't be scared / input "Amen"
风格：Simple but powerful, Conversational, Rhythmic, Short sentences, Emotional but not dramatic
不用"very very"等重复副词；不用过于学术的宗教术语；不用中式英语结构；不用"Dear God"在正文中间

六、禁止事项
绝对不做：不保留营销引导语、不保留胁迫式表达、不保留迷信暗示、英文不能写成Chinese-English、经文不能用错
输出中不允许出现："在您继续浏览之前" / "Before you scroll..." / "我承诺会分享" / "将这段话传递给你爱的人" / "魔鬼想让你跳过" / "分享给X个人你就会……" / 任何迷信链式传播语言

七、特殊情况处理
A. 祷告词特别短（少于30字）：直接提取核心意思，匹配经文，适当扩展1-2句
B. 祷告词完全没有核心金句（全是套话）：从主题意图出发，自行撰写1-2句核心正文，匹配合适经文
C. 祷告词包含多个主题：只取最核心的一个主题，不拆分
D. 用户额外指定经文：以用户指定的经文为准

【输出规则】
1. 只输出最终文案，不要任何解释、标题、序号
2. 输出格式：英文三段式文案|||中文三段式文案
3. 使用 ||| 作为英文版和中文版的分隔符
4. 英文版和中文版都要包含完整的三段（经文来源行、核心正文、If式互动结尾）
5. 三段之间用换行分隔
6. 英文核心正文必须精简到15-35个单词，只写2-3个短句，绝对不要写长句
7. 每个英文短句不超过12个单词，不允许一句话里有3个以上逗号`;

// --- 内置预设 ---
const BUILTIN_PRESETS: PrayerPreset[] = [
    {
        id: 'default',
        name: '🙏 默认（完整版）',
        content: DEFAULT_SYSTEM_INSTRUCTION,
        isBuiltin: true,
    },
];

// --- Storage ---
const STORAGE_KEY = 'prayer_rewrite_state_v1';
const SYSTEM_PROMPT_STORAGE_KEY = 'prayer_rewrite_system_prompt_v1';
const PRESETS_STORAGE_KEY = 'prayer_rewrite_presets_v1';

// --- Component ---

export function PrayerRewriteView({ getAiInstance, textModel }: PrayerRewriteViewProps) {
    // --- State ---
    const [inputText, setInputText] = useState('');
    const [pendingPrayers, setPendingPrayers] = useState<string[]>([]); // 从 Google Sheets 解析出的待处理祷告词
    const [results, setResults] = useState<PrayerResult[]>(() => {
        try {
            const saved = localStorage.getItem(STORAGE_KEY);
            if (saved) return JSON.parse(saved).results || [];
        } catch { /* ignore */ }
        return [];
    });
    const [isProcessing, setIsProcessing] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [copiedBatchType, setCopiedBatchType] = useState<string | null>(null);

    // 系统指令（可编辑）
    const [systemPrompt, setSystemPrompt] = useState(() => {
        try {
            const saved = localStorage.getItem(SYSTEM_PROMPT_STORAGE_KEY);
            if (saved) return saved;
        } catch { /* ignore */ }
        return DEFAULT_SYSTEM_INSTRUCTION;
    });
    const [showSystemPrompt, setShowSystemPrompt] = useState(false);

    // 预设管理
    const [customPresets, setCustomPresets] = useState<PrayerPreset[]>(() => {
        try {
            const saved = localStorage.getItem(PRESETS_STORAGE_KEY);
            if (saved) return JSON.parse(saved);
        } catch { /* ignore */ }
        return [];
    });
    const [activePresetId, setActivePresetId] = useState<string>('default');
    const [showNewPresetInput, setShowNewPresetInput] = useState(false);
    const [newPresetName, setNewPresetName] = useState('');

    const allPresets = [...BUILTIN_PRESETS, ...customPresets];

    const stopRef = useRef(false);

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

    // Persist system prompt
    useEffect(() => {
        try {
            localStorage.setItem(SYSTEM_PROMPT_STORAGE_KEY, systemPrompt);
        } catch { /* ignore */ }
    }, [systemPrompt]);

    // Persist presets
    useEffect(() => {
        try {
            localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(customPresets));
        } catch { /* ignore */ }
    }, [customPresets]);

    // --- Parse Response ---
    const parseResponse = (responseText: string): { english: string; chinese: string } => {
        const parts = responseText.split('|||');
        if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
            return {
                english: parts[0].trim(),
                chinese: parts[1].trim()
            };
        }
        // Fallback: 如果没有 ||| 分隔符，尝试其他方式
        return {
            english: responseText.trim(),
            chinese: ''
        };
    };

    // --- Google Sheets 粘贴处理 ---

    const parseHtmlTable = (html: string): string[] => {
        const results: string[] = [];
        try {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const rows = doc.querySelectorAll('tr');

            if (rows.length === 0) {
                // 没有 tr 标签，尝试直接查找 td
                const cells = doc.querySelectorAll('td');
                if (cells.length > 0) {
                    const cellText = (cells[0].textContent || '').trim();
                    if (cellText) results.push(cellText);
                }
                return results;
            }

            rows.forEach(row => {
                const cells = row.querySelectorAll('td, th');
                if (cells.length === 0) return;

                // 获取单元格文本，保留 <br> 为换行
                const getCellText = (cell: Element): string => {
                    const clone = cell.cloneNode(true) as Element;
                    clone.querySelectorAll('br').forEach(br => {
                        br.replaceWith('\n');
                    });
                    return (clone.textContent || '').trim();
                };

                // 取第一列作为祷告词内容
                const text = getCellText(cells[0]);
                if (text) results.push(text);
            });
        } catch (e) {
            console.error('[PrayerRewrite] parseHtmlTable error:', e);
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
                setPendingPrayers(parsed);
                setInputText(parsed.map((p, i) => `【${i + 1}】${p.slice(0, 80)}${p.length > 80 ? '...' : ''}`).join('\n'));
                return;
            }
        }
        // 非表格粘贴，清除 pending 状态
        setPendingPrayers([]);
    };

    // --- Handlers ---

    const handleGenerate = useCallback(async () => {
        if ((!inputText.trim() && pendingPrayers.length === 0) || isProcessing) return;

        stopRef.current = false;
        setIsProcessing(true);

        let items: string[];

        if (pendingPrayers.length > 0) {
            // 使用从 Google Sheets 解析的完整单元格内容
            items = pendingPrayers;
        } else {
            // 支持批量：按双换行或三个以上换行分割
            const prayers = inputText.trim().split(/\n{3,}|\n---\n/).map(s => s.trim()).filter(Boolean);
            items = prayers.length > 0 ? prayers : [inputText.trim()];
        }

        for (const prayerText of items) {
            if (stopRef.current) break;

            const newResult: PrayerResult = {
                id: uuidv4(),
                originalText: prayerText,
                englishOutput: '',
                chineseOutput: '',
                rawOutput: '',
                status: 'processing',
                createdAt: Date.now(),
            };

            setResults(prev => [newResult, ...prev]);

            try {
                const ai = getAiInstance();

                const userPrompt = `请提炼改写以下祷告词为三段式双语短视频文案。

原始祷告词：
${prayerText}

⚠️ 严格要求：
1. 核心正文（第二段）必须极度精简：英文只写2-3个短句，每句不超过12个单词，总共15-35个单词
2. 不要写带4-5个逗号的长句子！要短句！要有力！
3. 必须包含完整三段：经文来源行 + 核心正文 + If式互动结尾
4. 输出格式：英文版|||中文版（用 ||| 分隔英文和中文）
5. 不要输出任何标题、序号、解释`;

                // 429 自动重试
                let apiResult: any;
                for (let retryAttempt = 0; retryAttempt <= 3; retryAttempt++) {
                    try {
                        apiResult = await ai.models.generateContent({
                            model: textModel || 'gemini-2.0-flash',
                            contents: { role: 'user', parts: [{ text: userPrompt }] },
                            config: {
                                systemInstruction: systemPrompt,
                                temperature: 0.8,
                                topP: 0.95,
                                maxOutputTokens: 4096,
                            }
                        });
                        break;
                    } catch (retryError: any) {
                        const errMsg = retryError?.message || '';
                        const is429 = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota');
                        if (is429 && retryAttempt < 3) {
                            const waitSec = Math.pow(2, retryAttempt + 1) * 2.5;
                            console.warn(`[祷告提炼] 429限速，第${retryAttempt + 1}次重试，等待${waitSec}s`);
                            await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
                            continue;
                        }
                        throw retryError;
                    }
                }

                if (stopRef.current) {
                    setResults(prev => prev.map(r =>
                        r.id === newResult.id ? { ...r, status: 'error', error: '已取消' } : r
                    ));
                    break;
                }

                const text = apiResult?.text?.trim() || '';
                const { english, chinese } = parseResponse(text);

                setResults(prev => prev.map(r =>
                    r.id === newResult.id
                        ? { ...r, englishOutput: english, chineseOutput: chinese, rawOutput: text, status: 'success' }
                        : r
                ));
            } catch (error: any) {
                console.error('[PrayerRewrite] Error:', error);
                setResults(prev => prev.map(r =>
                    r.id === newResult.id
                        ? { ...r, status: 'error', error: error?.message || '生成失败' }
                        : r
                ));
            }
        }

        setIsProcessing(false);
        setPendingPrayers([]); // 处理完毕清除 pending
    }, [inputText, pendingPrayers, isProcessing, getAiInstance, textModel, systemPrompt]);

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

    const handleCopyBoth = async (result: PrayerResult) => {
        const fullText = `${result.englishOutput}\n\n---\n\n${result.chineseOutput}`;
        await handleCopy(fullText, `both-${result.id}`);
    };

    // --- 单条重新生成 ---
    const handleRegenerate = useCallback(async (result: PrayerResult) => {
        if (isProcessing) return;
        stopRef.current = false;
        setIsProcessing(true);

        // 将状态设为 processing
        setResults(prev => prev.map(r =>
            r.id === result.id ? { ...r, status: 'processing' as const, error: undefined } : r
        ));

        try {
            const ai = getAiInstance();
            const userPrompt = `请提炼改写以下祷告词为三段式双语短视频文案。

原始祷告词：
${result.originalText}

⚠️ 严格要求：
1. 核心正文（第二段）必须极度精简：英文只写2-3个短句，每句不超过12个单词，总共15-35个单词
2. 不要写带4-5个逗号的长句子！要短句！要有力！
3. 必须包含完整三段：经文来源行 + 核心正文 + If式互动结尾
4. 输出格式：英文版|||中文版（用 ||| 分隔英文和中文）
5. 不要输出任何标题、序号、解释`;

            let apiResult: any;
            for (let retryAttempt = 0; retryAttempt <= 3; retryAttempt++) {
                try {
                    apiResult = await ai.models.generateContent({
                        model: textModel || 'gemini-2.0-flash',
                        contents: { role: 'user', parts: [{ text: userPrompt }] },
                        config: {
                            systemInstruction: systemPrompt,
                            temperature: 0.8,
                            topP: 0.95,
                            maxOutputTokens: 4096,
                        }
                    });
                    break;
                } catch (retryError: any) {
                    const errMsg = retryError?.message || '';
                    const is429 = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota');
                    if (is429 && retryAttempt < 3) {
                        const waitSec = Math.pow(2, retryAttempt + 1) * 2.5;
                        await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
                        continue;
                    }
                    throw retryError;
                }
            }

            const text = apiResult?.text?.trim() || '';
            const { english, chinese } = parseResponse(text);

            setResults(prev => prev.map(r =>
                r.id === result.id
                    ? { ...r, englishOutput: english, chineseOutput: chinese, rawOutput: text, status: 'success' as const }
                    : r
            ));
        } catch (error: any) {
            setResults(prev => prev.map(r =>
                r.id === result.id
                    ? { ...r, status: 'error' as const, error: error?.message || '生成失败' }
                    : r
            ));
        }

        setIsProcessing(false);
    }, [isProcessing, getAiInstance, textModel, systemPrompt]);

    // --- 批量重试失败项 ---
    const handleRetryFailed = useCallback(async () => {
        const failedItems = results.filter(r => r.status === 'error');
        if (failedItems.length === 0 || isProcessing) return;

        stopRef.current = false;
        setIsProcessing(true);

        for (const item of failedItems) {
            if (stopRef.current) break;

            setResults(prev => prev.map(r =>
                r.id === item.id ? { ...r, status: 'processing' as const, error: undefined } : r
            ));

            try {
                const ai = getAiInstance();
                const userPrompt = `请提炼改写以下祷告词为三段式双语短视频文案。

原始祷告词：
${item.originalText}

⚠️ 严格要求：
1. 核心正文（第二段）必须极度精简：英文只写2-3个短句，每句不超过12个单词，总共15-35个单词
2. 不要写带4-5个逗号的长句子！要短句！要有力！
3. 必须包含完整三段：经文来源行 + 核心正文 + If式互动结尾
4. 输出格式：英文版|||中文版（用 ||| 分隔英文和中文）
5. 不要输出任何标题、序号、解释`;

                let apiResult: any;
                for (let retryAttempt = 0; retryAttempt <= 3; retryAttempt++) {
                    try {
                        apiResult = await ai.models.generateContent({
                            model: textModel || 'gemini-2.0-flash',
                            contents: { role: 'user', parts: [{ text: userPrompt }] },
                            config: {
                                systemInstruction: systemPrompt,
                                temperature: 0.8,
                                topP: 0.95,
                                maxOutputTokens: 4096,
                            }
                        });
                        break;
                    } catch (retryError: any) {
                        const errMsg = retryError?.message || '';
                        const is429 = errMsg.includes('429') || errMsg.includes('RESOURCE_EXHAUSTED') || errMsg.includes('quota');
                        if (is429 && retryAttempt < 3) {
                            const waitSec = Math.pow(2, retryAttempt + 1) * 2.5;
                            await new Promise(resolve => setTimeout(resolve, waitSec * 1000));
                            continue;
                        }
                        throw retryError;
                    }
                }

                const text = apiResult?.text?.trim() || '';
                const { english, chinese } = parseResponse(text);

                setResults(prev => prev.map(r =>
                    r.id === item.id
                        ? { ...r, englishOutput: english, chineseOutput: chinese, rawOutput: text, status: 'success' as const }
                        : r
                ));
            } catch (error: any) {
                setResults(prev => prev.map(r =>
                    r.id === item.id
                        ? { ...r, status: 'error' as const, error: error?.message || '重试失败' }
                        : r
                ));
            }
        }

        setIsProcessing(false);
    }, [results, isProcessing, getAiInstance, textModel, systemPrompt]);

    const handleResetSystemPrompt = () => {
        setSystemPrompt(DEFAULT_SYSTEM_INSTRUCTION);
        setActivePresetId('default');
    };

    // --- 预设管理 ---
    const handleSelectPreset = (preset: PrayerPreset) => {
        setActivePresetId(preset.id);
        setSystemPrompt(preset.content);
    };

    const handleSaveAsPreset = () => {
        const name = newPresetName.trim();
        if (!name) return;
        const newPreset: PrayerPreset = {
            id: `custom-${Date.now()}`,
            name,
            content: systemPrompt,
        };
        setCustomPresets(prev => [...prev, newPreset]);
        setActivePresetId(newPreset.id);
        setShowNewPresetInput(false);
        setNewPresetName('');
    };

    const handleDeletePreset = (id: string) => {
        setCustomPresets(prev => prev.filter(p => p.id !== id));
        if (activePresetId === id) {
            setActivePresetId('default');
            setSystemPrompt(DEFAULT_SYSTEM_INSTRUCTION);
        }
    };

    const handleUpdatePreset = (id: string) => {
        setCustomPresets(prev => prev.map(p =>
            p.id === id ? { ...p, content: systemPrompt } : p
        ));
    };

    // --- 批量复制 ---
    // 把文案中的换行替换掉，确保一行一个文案、一个单元格一个内容
    const flattenForCell = (text: string): string => {
        if (!text) return '';
        // 把换行替换为 " | " 分隔，保证一个单元格内容在一行
        return text.replace(/\n+/g, ' | ').replace(/\s*\|\s*\|\s*/g, ' | ').trim();
    };

    const successResults = results.filter(r => r.status === 'success');

    const handleBatchCopy = async (type: 'english' | 'chinese' | 'both' | 'all') => {
        if (successResults.length === 0) return;
        let text = '';
        switch (type) {
            case 'english':
                text = successResults.map(r => flattenForCell(r.englishOutput)).join('\n');
                break;
            case 'chinese':
                text = successResults.map(r => flattenForCell(r.chineseOutput)).join('\n');
                break;
            case 'both':
                text = successResults.map(r => `${flattenForCell(r.englishOutput)}\t${flattenForCell(r.chineseOutput)}`).join('\n');
                break;
            case 'all':
                text = successResults.map(r => `${flattenForCell(r.originalText)}\t${flattenForCell(r.englishOutput)}\t${flattenForCell(r.chineseOutput)}`).join('\n');
                break;
        }
        try {
            await navigator.clipboard.writeText(text);
            setCopiedBatchType(type);
            setTimeout(() => setCopiedBatchType(null), 2000);
        } catch { /* ignore */ }
    };

    return (
        <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 overflow-y-auto" style={{ scrollBehavior: 'smooth' }}>
                <div className="max-w-5xl mx-auto px-4 py-6 space-y-5">

                    {/* === 标题区 === */}
                    <div className="flex items-start justify-between">
                        <div>
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <div className="bg-gradient-to-br from-sky-500/30 to-indigo-500/30 p-2 rounded-xl">
                                    <BookOpen className="w-5 h-5 text-sky-400" />
                                </div>
                                祷告词提炼改写
                            </h2>
                            <p className="text-xs text-zinc-500 mt-1">
                                从祷告词中提炼核心金句，改写为三段式英+中双语短视频文案
                            </p>
                        </div>
                        <div className="flex items-center gap-2">
                        </div>
                    </div>

                    {/* === 系统指令 - 折叠面板 === */}
                    <div className="bg-zinc-900/60 border border-zinc-800/80 rounded-xl overflow-hidden">
                        <button
                            onClick={() => setShowSystemPrompt(!showSystemPrompt)}
                            className="w-full flex items-center justify-between px-4 py-2.5 hover:bg-zinc-800/30 transition-colors"
                        >
                            <div className="flex items-center gap-2">
                                <Settings2 className="w-4 h-4 text-sky-400" />
                                <span className="text-xs font-medium text-zinc-300">系统指令</span>
                                {systemPrompt !== DEFAULT_SYSTEM_INSTRUCTION && (
                                    <span className="px-1.5 py-0.5 rounded text-[9px] bg-amber-500/20 text-amber-400">已修改</span>
                                )}
                                <span className="text-[10px] text-zinc-600 bg-zinc-800 px-1.5 py-0.5 rounded">
                                    {allPresets.find(p => p.id === activePresetId)?.name || '默认'}
                                </span>
                            </div>
                            <div className="flex items-center gap-2">
                                <span className="text-[10px] text-zinc-600">{systemPrompt.length} 字符</span>
                                {showSystemPrompt ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" /> : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />}
                            </div>
                        </button>
                        {showSystemPrompt && (
                            <div className="px-4 pb-4 space-y-3 border-t border-zinc-800/50">
                                {/* 预设切换 */}
                                <div className="flex items-center gap-2 pt-2 flex-wrap">
                                    <span className="text-[10px] text-zinc-500">预设:</span>
                                    {allPresets.map(preset => (
                                        <div key={preset.id} className="flex items-center gap-0.5">
                                            <button
                                                onClick={() => handleSelectPreset(preset)}
                                                className={`px-2 py-0.5 text-[10px] rounded transition-colors ${
                                                    activePresetId === preset.id
                                                        ? 'bg-sky-600 text-white'
                                                        : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-zinc-700'
                                                }`}
                                            >
                                                {preset.name}
                                            </button>
                                            {!preset.isBuiltin && (
                                                <button
                                                    onClick={() => handleDeletePreset(preset.id)}
                                                    className="p-0.5 text-zinc-600 hover:text-red-400 transition-colors"
                                                    title="删除预设"
                                                >
                                                    <X className="w-3 h-3" />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    {showNewPresetInput ? (
                                        <div className="flex items-center gap-1">
                                            <input
                                                type="text"
                                                value={newPresetName}
                                                onChange={e => setNewPresetName(e.target.value)}
                                                onKeyDown={e => { if (e.key === 'Enter') handleSaveAsPreset(); if (e.key === 'Escape') setShowNewPresetInput(false); }}
                                                placeholder="预设名称..."
                                                className="px-2 py-0.5 text-[10px] bg-zinc-800 border border-zinc-600 rounded text-zinc-300 w-24 focus:outline-none focus:border-sky-500"
                                                autoFocus
                                            />
                                            <button onClick={handleSaveAsPreset} className="px-1.5 py-0.5 text-[10px] bg-sky-600 text-white rounded hover:bg-sky-500">保存</button>
                                            <button onClick={() => setShowNewPresetInput(false)} className="px-1.5 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300">取消</button>
                                        </div>
                                    ) : (
                                        <button
                                            onClick={() => setShowNewPresetInput(true)}
                                            className="px-2 py-0.5 text-[10px] bg-zinc-800 hover:bg-zinc-700 text-zinc-400 border border-dashed border-zinc-600 rounded transition-colors"
                                        >
                                            + 另存为预设
                                        </button>
                                    )}
                                    {activePresetId !== 'default' && !allPresets.find(p => p.id === activePresetId)?.isBuiltin && (
                                        <button
                                            onClick={() => handleUpdatePreset(activePresetId)}
                                            className="px-2 py-0.5 text-[10px] bg-amber-600/20 hover:bg-amber-600/40 text-amber-400 border border-amber-600/30 rounded transition-colors"
                                        >
                                            更新当前预设
                                        </button>
                                    )}
                                </div>
                                <div className="flex items-center justify-between">
                                    <span className="text-[10px] text-zinc-500">编辑系统指令以调整提炼改写的风格和规则</span>
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
                                    className="w-full bg-zinc-950/50 border border-zinc-700/50 rounded-lg px-3 py-2.5 text-xs text-zinc-300 placeholder:text-zinc-600 resize-y focus:outline-none focus:ring-1 focus:ring-sky-500/30 font-mono leading-relaxed"
                                    style={{ minHeight: '200px' }}
                                />
                            </div>
                        )}
                    </div>

                    {/* === 输入框 + 生成按钮 === */}
                    <div className="space-y-3">
                        <div className="relative">
                            <textarea
                                value={inputText}
                                onChange={e => { setInputText(e.target.value); if (pendingPrayers.length > 0) setPendingPrayers([]); }}
                                onPaste={handlePaste}
                                placeholder="粘贴原始祷告词...（支持中文/英文/双语）&#10;&#10;支持从 Google Sheets 直接粘贴多个单元格，自动识别每条祷告词&#10;也可手动输入，多条祷告词之间用三个换行或 --- 分隔"
                                rows={10}
                                className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 text-sm text-zinc-200 placeholder:text-zinc-600 resize-y focus:outline-none focus:ring-2 focus:ring-sky-500/30 focus:border-sky-500/30 transition-all"
                                disabled={isProcessing}
                            />
                            <div className="absolute bottom-3 right-3 flex items-center gap-2">
                                {pendingPrayers.length > 0 ? (
                                    <span className="text-[10px] text-sky-400 bg-sky-500/10 px-2 py-0.5 rounded-full">
                                        📋 已识别 {pendingPrayers.length} 条祷告词（来自表格）
                                    </span>
                                ) : (
                                    <span className="text-[10px] text-zinc-600">
                                        {inputText.length} 字
                                    </span>
                                )}
                            </div>
                        </div>

                        <div className="flex items-center gap-3">
                            {isProcessing ? (
                                <button
                                    onClick={handleStop}
                                    className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-medium text-sm transition-all"
                                >
                                    <X className="w-4 h-4" />
                                    停止
                                </button>
                            ) : (
                                <button
                                    onClick={handleGenerate}
                                    disabled={!inputText.trim()}
                                    className={`flex items-center gap-2 px-6 py-2.5 rounded-xl font-medium text-sm transition-all ${inputText.trim()
                                        ? 'bg-gradient-to-r from-sky-500 to-indigo-500 hover:from-sky-600 hover:to-indigo-600 text-white shadow-lg shadow-sky-500/20'
                                        : 'bg-zinc-800 text-zinc-500 cursor-not-allowed'
                                        }`}
                                >
                                    <Sparkles className="w-4 h-4" />
                                    开始提炼改写
                                </button>
                            )}

                            <span className="text-[10px] text-zinc-600">
                                提炼核心金句 → 三段式英中双语文案
                            </span>
                        </div>
                    </div>

                    {/* === 结果列表 === */}
                    {results.length > 0 && (
                        <div className="space-y-4">
                            <div className="flex items-center justify-between">
                                <h3 className="text-sm font-semibold text-zinc-300 flex items-center gap-2">
                                    <Clock className="w-4 h-4 text-zinc-500" />
                                    生成结果
                                    <span className="text-xs text-zinc-500">({successResults.length})</span>
                                    {results.filter(r => r.status === 'error').length > 0 && (
                                        <span className="text-[10px] text-red-400">
                                            {results.filter(r => r.status === 'error').length} 失败
                                        </span>
                                    )}
                                </h3>
                                <div className="flex items-center gap-2">
                                {results.filter(r => r.status === 'error').length > 0 && !isProcessing && (
                                    <button
                                        onClick={handleRetryFailed}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium bg-red-600/20 hover:bg-red-600/40 text-red-400 hover:text-red-300 border border-red-600/30 transition-colors"
                                    >
                                        <RotateCw className="w-3.5 h-3.5" />
                                        重试失败 ({results.filter(r => r.status === 'error').length})
                                    </button>
                                )}
                                    <button
                                        onClick={handleClearAll}
                                        className="flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs font-medium text-zinc-500 hover:text-red-400 hover:bg-red-600/10 transition-colors"
                                        title="清空所有结果"
                                    >
                                        <Trash2 className="w-3.5 h-3.5" />
                                        清空
                                    </button>
                                </div>
                            </div>

                            {/* 批量复制按钮 */}
                            {successResults.length > 0 && (
                                <div className="flex items-center gap-2 flex-wrap">
                                    <span className="text-[10px] text-zinc-500">批量复制:</span>
                                    <button
                                        onClick={() => handleBatchCopy('english')}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedBatchType === 'english' ? 'bg-sky-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'}`}
                                    >
                                        {copiedBatchType === 'english' ? <Check size={12} /> : <Copy size={12} />}
                                        英文
                                    </button>
                                    <button
                                        onClick={() => handleBatchCopy('chinese')}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedBatchType === 'chinese' ? 'bg-amber-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'}`}
                                    >
                                        {copiedBatchType === 'chinese' ? <Check size={12} /> : <Copy size={12} />}
                                        中文
                                    </button>
                                    <button
                                        onClick={() => handleBatchCopy('both')}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedBatchType === 'both' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'}`}
                                    >
                                        {copiedBatchType === 'both' ? <Check size={12} /> : <Columns size={12} />}
                                        英文+中文
                                    </button>
                                    <button
                                        onClick={() => handleBatchCopy('all')}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedBatchType === 'all' ? 'bg-emerald-600 text-white' : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'}`}
                                    >
                                        {copiedBatchType === 'all' ? <Check size={12} /> : <Columns size={12} />}
                                        原始+英文+中文
                                    </button>
                                </div>
                            )}

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
                                        <div className={`shrink-0 p-1.5 rounded-lg ${result.status === 'processing' ? 'bg-sky-500/20'
                                            : result.status === 'success' ? 'bg-emerald-500/20'
                                                : result.status === 'error' ? 'bg-red-500/20'
                                                    : 'bg-zinc-800'
                                            }`}>
                                            {result.status === 'processing' ? (
                                                <Loader2 className="w-4 h-4 text-sky-400 animate-spin" />
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
                                                <span className="text-xs text-zinc-500">
                                                    {new Date(result.createdAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
                                                </span>
                                                {result.status === 'error' && (
                                                    <span className="text-[10px] text-red-400">{result.error}</span>
                                                )}
                                            </div>
                                            <p className="text-xs text-zinc-500 truncate mt-0.5">
                                                {result.originalText.slice(0, 120)}...
                                            </p>
                                        </div>

                                        <div className="flex items-center gap-1 shrink-0" onClick={e => e.stopPropagation()}>
                                            {result.status === 'success' && (
                                                <>
                                                    <button
                                                        onClick={() => handleCopyBoth(result)}
                                                        className="p-1.5 rounded-lg text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 transition-colors"
                                                        title="复制全部"
                                                    >
                                                        {copiedId === `both-${result.id}` ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
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
                                        </div>

                                        <div className="shrink-0">
                                            {result.collapsed
                                                ? <ChevronDown className="w-4 h-4 text-zinc-600" />
                                                : <ChevronUp className="w-4 h-4 text-zinc-600" />}
                                        </div>
                                    </div>

                                    {/* Result Body */}
                                    {!result.collapsed && result.status === 'success' && (
                                        <div className="border-t border-zinc-800/50">
                                            <div className="grid grid-cols-1 md:grid-cols-2 gap-0 md:divide-x md:divide-zinc-800/50">
                                                {/* English */}
                                                <div className="p-4">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-[10px] font-medium text-sky-400 uppercase tracking-wider">English</span>
                                                        <button
                                                            onClick={() => handleCopy(result.englishOutput, `en-${result.id}`)}
                                                            className="p-1 rounded text-zinc-600 hover:text-zinc-300 transition-colors"
                                                            title="复制英文"
                                                        >
                                                            {copiedId === `en-${result.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                                        </button>
                                                    </div>
                                                    <div className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
                                                        {result.englishOutput}
                                                    </div>
                                                </div>

                                                {/* Chinese */}
                                                <div className="p-4 border-t md:border-t-0 border-zinc-800/50">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-[10px] font-medium text-amber-400 uppercase tracking-wider">中文</span>
                                                        <button
                                                            onClick={() => handleCopy(result.chineseOutput, `zh-${result.id}`)}
                                                            className="p-1 rounded text-zinc-600 hover:text-zinc-300 transition-colors"
                                                            title="复制中文"
                                                        >
                                                            {copiedId === `zh-${result.id}` ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                                                        </button>
                                                    </div>
                                                    <div className="text-sm text-zinc-200 whitespace-pre-wrap leading-relaxed">
                                                        {result.chineseOutput}
                                                    </div>
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>
                            ))}
                        </div>
                    )}

                </div>
            </div>
        </div>
    );
}
