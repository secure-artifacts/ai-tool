/**
 * CopywritingView.tsx
 * 文案改写模式 - 批量改写外文文案并提供中文翻译
 * 
 * 功能:
 * 1. 支持单列（纯外文）或双列（外文+中文参照）输入
 * 2. 根据用户指令批量改写外文
 * 3. 输出双列布局：左外文右中文
 * 4. 支持预设保存到 Firebase
 * 5. 多种复制选项，无空行，直接粘贴到表格
 */

import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../../contexts/AuthContext';
import { db } from '../../firebase/index';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import {
    FileText,
    Play,
    Loader2,
    Copy,
    Check,
    Trash2,
    Download,
    Save,
    ChevronDown,
    ChevronUp,
    Plus,
    X,
    Settings2,
    Sparkles,
    MessageCircle,
    MessageSquare,
    RotateCw,
    ClipboardCopy,
    Eye,
    FolderOpen,
    Package,
    Mic,
    Tag,
    FileEdit,
    Search,
    Lightbulb
} from 'lucide-react';
import { PresetManager, CopywritingPreset as PresetType } from './PresetManager';

// --- Types ---

interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    images?: string[];
}

// 单个指令的执行结果
interface InstructionResult {
    id: string;
    instruction: string;        // 使用的指令
    inputForeign: string;       // 输入的外文（可能是原文或上一步的结果）
    resultForeign: string;      // 改写后的外文
    resultChinese: string;      // 翻译后的中文
    status: 'idle' | 'processing' | 'success' | 'error';
    error?: string;
    createdAt: number;
    // 每指令独立对话
    chatOpen?: boolean;
    chatHistory?: ChatMessage[];
    chatInput?: string;
    chatLoading?: boolean;
}

interface CopywritingItem {
    id: string;
    originalForeign: string;      // 原始外文
    originalChinese?: string;     // 原始中文（可选）
    resultForeign?: string;       // 改写后的外文（最后一次结果）
    resultChinese?: string;       // 翻译后的中文（最后一次结果）
    status: 'idle' | 'processing' | 'success' | 'error';
    error?: string;
    // 多指令结果
    instructionResults?: InstructionResult[];
    // 折叠状态
    collapsed?: boolean;
    // 单条设置
    showSettings?: boolean;       // 显示单条设置面板
    customInstruction?: string;   // 单条自定义指令
    // 对话功能
    chatOpen?: boolean;
    chatHistory?: ChatMessage[];
    chatInput?: string;
    chatLoading?: boolean;
}

interface CopywritingPreset {
    id: string;
    name: string;
    instruction: string;
    createdAt: number;
}

interface CopywritingViewProps {
    getAiInstance: () => GoogleGenAI;
    textModel: string;
}

// --- 辅助函数：为表格单元格格式化文本 ---
function escapeForSheet(text: string): string {
    const t = text || '';
    // 如果包含Tab、换行符或引号，用引号包裹并转义内部引号
    if (t.includes('\t') || t.includes('\n') || t.includes('\r') || t.includes('"')) {
        return `"${t.replace(/"/g, '""')}"`;
    }
    return t;
}

// --- Simple Diff Highlight ---
// 简单的单词级别 diff，返回 React 元素数组
function highlightDiff(original: string, modified: string): React.ReactNode {
    if (!original || !modified) return modified || '';

    // 简单的按空格分词
    const origWords = original.split(/(\s+)/);
    const modWords = modified.split(/(\s+)/);

    const result: React.ReactNode[] = [];
    let modIndex = 0;

    // 使用 Set 存储原文中的词
    const origSet = new Set(origWords.filter(w => w.trim()));

    for (let i = 0; i < modWords.length; i++) {
        const word = modWords[i];
        if (!word.trim()) {
            // 保留空白
            result.push(word);
        } else if (!origSet.has(word)) {
            // 新增或修改的词 - 高亮显示（黄色荧光笔效果）
            result.push(
                <span key={`diff-${i}`} className="bg-yellow-500/40 text-yellow-200 px-0.5 rounded">
                    {word}
                </span>
            );
        } else {
            // 未修改的词
            result.push(word);
        }
    }

    return result;
}

// --- Constants ---

const STORAGE_KEY = 'copywriting_view_state_v1';
const PRESETS_DOC_PATH = 'copywriting_presets';
const DEFAULT_INSTRUCTION = '我需要你给我每个文案的标题添加一个时间或者修改过期时间，可以修改为2026年一月';
const DEFAULT_SYSTEM_INSTRUCTION = `你是一个专业的文案编辑和翻译专家。

【核心原则】
1. 根据文案合理理解标题、内容和结尾的结构
2. 只修改用户指令明确要求修改的部分，其他保持原样
3. 根据当前语言的正宗语法规范对用户要求修改的部分进行修改，没要求修改的部分不需要修改
4. 保持专业、简洁`;

// 内置预设
const BUILTIN_PRESETS: CopywritingPreset[] = [
    {
        id: 'builtin_example',
        name: '📌 示例指令',
        instruction: DEFAULT_INSTRUCTION,
        createdAt: Date.now()
    },
    {
        id: 'builtin_remove_at_logo',
        name: '🚫 去掉@名字',
        instruction: '需要根据当前文案修改。修改要求：去掉文案中的@和名字logo，保持其他内容不变。',
        createdAt: Date.now()
    },
    {
        id: 'builtin_add_interaction',
        name: '💬 添加互动语',
        instruction: `需要根据当前文案修改。修改要求：在结尾根据当前文案内容，识别结尾互动语，自动判断添加或者修改为合适的互动语结尾。严格使用我提供给你的结尾互动语句子，不要修改。常用互动语：
Disappoint Satan by "God is good!"
Put " Amen " to defeat Satan.
put Amen and shame the devil
IF YOU Depend on God Put I DO
tell Him : " Thank You! "
If you believe it, Don't forget Amen.
If you trust Him, put Amen
IF YOU BELIEVE IN THE POWER OF PRAYER-PUT AMEN
Lord, open a door for everyone who puts Amen and shares.
If you are not ashamed to love Jesus, put Amen.`,
        createdAt: Date.now()
    },
    {
        id: 'builtin_add_see',
        name: '👁️ 添加/修改 SEE',
        instruction: '需要根据当前文案修改。修改要求：开头部分需要统一添加 SEE。如果已经有了SEE则不需要添加。如果开头有 Inspired by 则修改为 SEE。',
        createdAt: Date.now()
    },
    {
        id: 'builtin_add_inspired_by',
        name: '✨ 添加/修改 Inspired by',
        instruction: '需要根据当前文案修改。修改要求：开头部分需要统一添加 Inspired by。如果已经有了 Inspired by 则不需要添加。如果开头有 SEE 则修改为 Inspired by。',
        createdAt: Date.now()
    },
    {
        id: 'builtin_classify_general',
        name: '🏷️ 通用分类文本',
        instruction: `请按以下类别分类：
- 促销活动
- 产品介绍
- 用户评价
- 新闻资讯
- 其他

只输出类别名称，不需要其他内容。`,
        createdAt: Date.now()
    },
    {
        id: 'builtin_classify_fb_groups',
        name: '👥 fb小组名字分类',
        instruction: `请按以下类别分类（共15个）：

1. 宗教小组 - 包含上帝、耶稣、佛、真主等宗教词汇，或祷告(Prayer)、信仰(Faith)等
2. 偏向励志的 - 包含早安(Good Morning)、晚安(Good Night)、正能量、语录(Quotes)、激励(Motivation)等，且没有明显宗教色彩
3. 美食小组 - 食谱、烹饪、餐厅、吃货分享
4. 衣服小组 - 服装、穿搭、时尚(Fashion)
5. 电影音乐小组 - 影视、歌曲、歌词、MV
6. 买卖小组 - 二手、Marketplace、Buy & Sell、闲置交易（侧重于具体的物品交易）
7. 招聘小组 - 找工作、Hiring、Jobs、兼职
8. 风景小组 - 自然风光、城市景观、旅游摄影
9. 汽车小组 - 汽车买卖、改装、车友会
10. 美容小组 - 化妆、护肤、美甲、发型
11. 母婴小组 - 妈妈群、育儿、怀孕、婴儿用品
12. 明星小组 - 粉丝群、特定名人名字、饭圈
13. 广告小组 - 侧重于商业推广、链接分享、Promo、Business Promotion
14. 乡村小组 - 农村生活、Village、Farm、田园风格
15. 手工艺小组 - DIY、Crochet(钩针)、Woodworking(木工)、手工制作

如果没有包含在以上分类中，标记为"其他 - [具体类型]"。`,
        createdAt: Date.now()
    }
];

// === 人声文案模式 ===
const VOICE_MODE_SYSTEM_INSTRUCTION = `你是一个专业的配音文案标注专家，专门为 ElevenLabs 配音软件准备文案。

【核心用途】
用于 ElevenLabs 配音。场景：祷告 / 宣告 / 属灵鼓励 / 短视频旁白

【情感标签规则（最重要）】
✅ 只使用情感/语气标签（如 [calm] [reverent] [faith-filled] [pause]）
❌ 不要使用 emoji
❌ 不要解释标签含义
标签要求：克制、稳定、不浮夸、不戏剧化

【节奏与结构】
- 合适的停顿，常用 [pause]，停顿要合理，符合正常人说话的情况，只有必须停顿的才加停顿，不然太多停顿听着就像是在背台词了
- 停顿要根据整体文案内容添加的合理自然

【ElevenLabs 特性优化】
针对 ElevenLabs 的特性，它对停顿和标点非常敏感。在 ElevenLabs 中，直接使用 [pause] 标签有时效果不够自然。
**最有效的"停顿"其实是利用标点符号（如 ... 或 ,）以及通过情感词引导模型改变语速。**
- 将情感词放在中括号内并配合 ... 标点，能更好地引导 AI 表现出语气起伏
- 例如：[calm] Lord... I come before You today, with a grateful heart...

【语气取向】
根据文案内容，偏向：力量感、祷告感、安抚感、权柄但不咆哮
避免：情绪炸裂、表演感、过度煽动

【内容处理原则】
❌ 不改原文意思
❌ 不擅自删句
❌ 不加新神学内容

【输出要求 - 分两部分】
你需要输出两个结果，用 ||| 分隔：
1. 加标签结果：带情感标签的完整文案（用于 ElevenLabs 配音）
2. 断句结果：根据标签合理断行后的文案（用于字幕显示）

断行规则：
- 断句合理，符合语言习惯
- 每行不要太长（建议不超过30个字符/字母 + 空格），便于字幕显示
- 也不要太短（至少有完整的意思单元）
- 在 [pause] 标签处自然断行
- 断句结果不包含情感标签，只保留纯文本
- ⚠️ 断句结果不包含省略号（...），省略号仅用于配音的加标签结果

输出格式示例：
[calm] Lord... I come before You today, with a grateful heart...
|||\nLord,\nI come before You today,\nwith a grateful heart.`;

const VOICE_MODE_DEFAULT_INSTRUCTION = `根据这个文案帮我加一些情感标签。要符合 ElevenLabs 这款软件生成音频使用。

输出两个结果：
1. 加标签结果 - 带情感标签（如 [calm] [reverent] [faith-filled] [pause] 等）
2. 断句结果 - 根据标签合理断行，用于字幕显示（不带标签）`;

// === 分类模式 ===
type CopywritingMode = 'standard' | 'voice' | 'classify';

const CLASSIFY_MODE_SYSTEM_INSTRUCTION = `你是一个专业的文案分类专家。

【核心任务】
根据用户提供的分类规则，将文案准确地分到对应的类别中。

【输出规则】
1. 只输出分类结果，不要任何解释、说明或其他内容
2. 只输出类别名称，不要添加任何标点或前缀
3. 如果没有包含在提供分类中，标记为"其他 - [具体类型，你自己判断的类型]"
4. 严格按照用户提供的分类规则和类别列表进行分类`;

const CLASSIFY_MODE_DEFAULT_INSTRUCTION = `请按以下类别分类：
- 促销活动
- 产品介绍
- 用户评价
- 新闻资讯
- 其他

只输出类别名称，不需要其他内容。`;

// --- Diff 工具函数 ---
// 简单的单词级别 diff 算法
function computeWordDiff(original: string, result: string): { originalWithDiff: React.ReactNode; resultWithDiff: React.ReactNode } {
    // 将文本拆分为单词（保留空格和标点）
    const tokenize = (text: string) => text.match(/[\w\u4e00-\u9fff]+|[^\w\u4e00-\u9fff]+/g) || [];

    const originalTokens = tokenize(original);
    const resultTokens = tokenize(result);

    // 使用 LCS (最长公共子序列) 来找出共同部分
    const lcs = (a: string[], b: string[]): Set<number>[] => {
        const m = a.length, n = b.length;
        const dp: number[][] = Array(m + 1).fill(null).map(() => Array(n + 1).fill(0));

        for (let i = 1; i <= m; i++) {
            for (let j = 1; j <= n; j++) {
                if (a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) {
                    dp[i][j] = dp[i - 1][j - 1] + 1;
                } else {
                    dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
                }
            }
        }

        // 回溯找出匹配的索引
        const matchedA = new Set<number>();
        const matchedB = new Set<number>();
        let i = m, j = n;
        while (i > 0 && j > 0) {
            if (a[i - 1].toLowerCase() === b[j - 1].toLowerCase()) {
                matchedA.add(i - 1);
                matchedB.add(j - 1);
                i--; j--;
            } else if (dp[i - 1][j] > dp[i][j - 1]) {
                i--;
            } else {
                j--;
            }
        }
        return [matchedA, matchedB];
    };

    const [matchedOriginal, matchedResult] = lcs(originalTokens, resultTokens);

    // 构建带高亮的原文（被删除/修改的部分用红色删除线）
    const originalWithDiff = originalTokens.map((token, idx) => {
        if (!matchedOriginal.has(idx) && token.trim()) {
            return <span key={idx} style={{ backgroundColor: 'rgba(239, 68, 68, 0.3)', textDecoration: 'line-through', color: '#ef4444' }}>{token}</span>;
        }
        return <span key={idx}>{token}</span>;
    });

    // 构建带高亮的结果（新增/修改的部分用绿色背景）
    const resultWithDiff = resultTokens.map((token, idx) => {
        if (!matchedResult.has(idx) && token.trim()) {
            return <span key={idx} style={{ backgroundColor: 'rgba(34, 197, 94, 0.3)', color: '#22c55e' }}>{token}</span>;
        }
        return <span key={idx}>{token}</span>;
    });

    return { originalWithDiff, resultWithDiff };
}

// --- Component ---

export function CopywritingView({ getAiInstance, textModel }: CopywritingViewProps) {
    const { user } = useAuth();

    // --- State ---
    const [items, setItems] = useState<CopywritingItem[]>([]);
    const [bulkInput, setBulkInput] = useState('');
    const [instruction, setInstruction] = useState('');
    const [instructions, setInstructions] = useState<string[]>(['']); // 多指令列表
    const [presets, setPresets] = useState<CopywritingPreset[]>([]);
    const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
    const [showPresetDropdown, setShowPresetDropdown] = useState(false);
    const [newPresetName, setNewPresetName] = useState('');
    const [showSavePreset, setShowSavePreset] = useState(false);
    const [isProcessing, setIsProcessing] = useState(false);
    const [copiedType, setCopiedType] = useState<string | null>(null);
    const [presetLoading, setPresetLoading] = useState(false);
    const [showPreview, setShowPreview] = useState(false); // 预览最终指令
    const [systemInstruction, setSystemInstruction] = useState(DEFAULT_SYSTEM_INSTRUCTION); // 系统指令（可编辑）
    const [allCollapsed, setAllCollapsed] = useState(false); // 全局折叠状态
    const [activePresetDropdown, setActivePresetDropdown] = useState<number | null>(null); // 当前打开的预设下拉索引
    const [editingInstructionIndex, setEditingInstructionIndex] = useState<number | null>(null); // 双击编辑的指令索引
    const [copyToast, setCopyToast] = useState<string | null>(null); // 复制提示
    const [showPresetManager, setShowPresetManager] = useState(false); // 预设管理器
    const [pendingRetryStart, setPendingRetryStart] = useState(false); // 等待重试后开始
    const [mode, setMode] = useState<CopywritingMode>('standard'); // 模式：标准/人声/分类
    const [voiceModeSystemInstruction, setVoiceModeSystemInstruction] = useState(VOICE_MODE_SYSTEM_INSTRUCTION); // 人声模式系统指令（可编辑）
    const [classifyModeSystemInstruction, setClassifyModeSystemInstruction] = useState(CLASSIFY_MODE_SYSTEM_INSTRUCTION); // 分类模式系统指令（可编辑）
    const [showDiff, setShowDiff] = useState(false); // 显示差异高亮
    const [batchSize, setBatchSize] = useState(1); // 批次处理大小（1-2000，默认1）
    const [showBatchSettings, setShowBatchSettings] = useState(false); // 显示批次设置

    const stopRef = useRef(false);
    const dropdownRef = useRef<HTMLDivElement>(null);

    // --- Load presets from Firebase ---
    useEffect(() => {
        const loadPresets = async () => {
            if (!user?.uid) return;

            try {
                setPresetLoading(true);
                const docRef = doc(db, 'users', user.uid, 'settings', PRESETS_DOC_PATH);
                const docSnap = await getDoc(docRef);

                if (docSnap.exists()) {
                    const data = docSnap.data();
                    setPresets(data.presets || []);
                }
            } catch (error) {
                console.error('[CopywritingView] Failed to load presets:', error);
            } finally {
                setPresetLoading(false);
            }
        };

        loadPresets();
    }, [user?.uid]);

    // --- Save presets to Firebase ---
    const savePresetsToFirebase = async (newPresets: CopywritingPreset[]) => {
        if (!user?.uid) return;

        try {
            const docRef = doc(db, 'users', user.uid, 'settings', PRESETS_DOC_PATH);
            await setDoc(docRef, { presets: newPresets }, { merge: true });
        } catch (error) {
            console.error('[CopywritingView] Failed to save presets:', error);
        }
    };

    // --- Close dropdown on outside click ---
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
                setShowPresetDropdown(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // --- Parse input (参照创新模式的解析逻辑) ---
    const parseInput = (mode: 'batch' | 'single' = 'batch'): { foreign: string; chinese?: string }[] => {
        const raw = bulkInput.trim();
        if (!raw) return [];

        const results: { foreign: string; chinese?: string }[] = [];

        if (mode === 'single') {
            // 单条模式：检测是否是 Tab 分隔的两列
            const parts = raw.split('\t');
            if (parts.length >= 2) {
                results.push({
                    foreign: parts[0].trim(),
                    chinese: parts[1].trim() || undefined
                });
            } else {
                results.push({ foreign: raw });
            }
        } else {
            // 批量模式：按换行分割，每行可能是 Tab 分隔的两列
            let current = '';
            let inQuote = false;
            const lines: string[] = [];

            for (let i = 0; i < bulkInput.length; i++) {
                const char = bulkInput[i];
                const nextChar = bulkInput[i + 1];

                if (char === '"') {
                    if (inQuote && nextChar === '"') {
                        current += '"';
                        i++;
                    } else {
                        inQuote = !inQuote;
                    }
                } else if (!inQuote && (char === '\n' || char === '\r')) {
                    if (current.trim()) {
                        lines.push(current.trim());
                    }
                    current = '';
                } else {
                    current += char;
                }
            }
            if (current.trim()) {
                lines.push(current.trim());
            }

            // 解析每行，检测是否有 Tab 分隔的两列
            for (const line of lines) {
                const parts = line.split('\t');
                if (parts.length >= 2) {
                    results.push({
                        foreign: parts[0].trim(),
                        chinese: parts[1].trim() || undefined
                    });
                } else {
                    results.push({ foreign: line });
                }
            }
        }

        return results;
    };

    // --- Add items ---
    const handleAddItems = (mode: 'batch' | 'single' = 'batch') => {
        const parsed = parseInput(mode);
        if (parsed.length === 0) return;

        // 检测文本是否主要是中文（内联定义以便在此处使用）
        const checkIsChinese = (text: string): boolean => {
            if (!text) return false;
            const chineseChars = text.match(/[\u4e00-\u9fff]/g);
            const totalChars = text.replace(/\s/g, '').length;
            if (totalChars === 0) return false;
            return (chineseChars?.length || 0) / totalChars > 0.3;
        };

        // 自动检测并调换中外文顺序
        // 规则：如果两列都有内容，且第一列是中文、第二列是外文，则调换
        const adjustedItems: CopywritingItem[] = parsed.map(p => {
            if (p.chinese && p.foreign) {
                // 两列都有内容
                const firstIsChinese = checkIsChinese(p.foreign);
                const secondIsChinese = checkIsChinese(p.chinese);

                // 如果第一列是中文，第二列是外文，则调换
                if (firstIsChinese && !secondIsChinese) {
                    return {
                        id: uuidv4(),
                        originalForeign: p.chinese,    // 调换
                        originalChinese: p.foreign,    // 调换
                        status: 'idle' as const
                    };
                }
            }
            // 正常顺序或只有一列
            return {
                id: uuidv4(),
                originalForeign: p.foreign,
                originalChinese: p.chinese,
                status: 'idle' as const
            };
        });

        setItems(prev => [...adjustedItems, ...prev]);
        setBulkInput('');
    };

    // --- 处理粘贴事件：直接从剪贴板 HTML 解析 Google 表格单元格 ---
    const handlePaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        // 尝试获取 HTML 格式数据（Google 表格复制时包含 HTML）
        const htmlData = clipboardData.getData('text/html');

        // 如果有 HTML 数据，尝试解析表格
        if (htmlData && (htmlData.includes('<table') || htmlData.includes('<tr'))) {
            e.preventDefault(); // 阻止默认粘贴

            // 解析 HTML 表格
            const parsed = parseHtmlTable(htmlData);

            if (parsed.length > 0) {
                // 检测文本是否主要是中文
                const checkIsChinese = (text: string): boolean => {
                    if (!text) return false;
                    const chineseChars = text.match(/[\u4e00-\u9fff]/g);
                    const totalChars = text.replace(/\s/g, '').length;
                    if (totalChars === 0) return false;
                    return (chineseChars?.length || 0) / totalChars > 0.3;
                };

                // 自动检测并调换中外文顺序
                const adjustedItems: CopywritingItem[] = parsed.map(p => {
                    if (p.chinese && p.foreign) {
                        const firstIsChinese = checkIsChinese(p.foreign);
                        const secondIsChinese = checkIsChinese(p.chinese);
                        if (firstIsChinese && !secondIsChinese) {
                            return {
                                id: uuidv4(),
                                originalForeign: p.chinese,
                                originalChinese: p.foreign,
                                status: 'idle' as const
                            };
                        }
                    }
                    return {
                        id: uuidv4(),
                        originalForeign: p.foreign,
                        originalChinese: p.chinese,
                        status: 'idle' as const
                    };
                });

                setItems(prev => [...adjustedItems, ...prev]);
                showCopyToast(`已从表格粘贴 ${adjustedItems.length} 条`);
                return;
            }
        }

        // 如果不是表格 HTML，使用默认粘贴行为
        // 不阻止默认行为，让文本正常粘贴到 textarea
    };

    // --- 解析 HTML 表格数据（支持 Google 表格格式）---
    const parseHtmlTable = (html: string): { foreign: string; chinese?: string }[] => {
        const results: { foreign: string; chinese?: string }[] = [];

        try {
            // 创建临时 DOM 元素解析 HTML
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');

            // 查找所有表格行
            const rows = doc.querySelectorAll('tr');

            if (rows.length === 0) {
                // 没有 tr 标签，尝试直接查找 td
                const cells = doc.querySelectorAll('td');
                if (cells.length > 0) {
                    // 单行数据
                    const cellTexts = Array.from(cells).map(cell =>
                        (cell.textContent || '').trim()
                    );
                    if (cellTexts.length >= 1 && cellTexts[0]) {
                        results.push({
                            foreign: cellTexts[0],
                            chinese: cellTexts[1] || undefined
                        });
                    }
                }
                return results;
            }

            // 遍历每行
            rows.forEach(row => {
                const cells = row.querySelectorAll('td, th');
                if (cells.length === 0) return;

                // 获取每个单元格的文本内容
                // Google 表格的单元格可能包含 <br> 换行，需要保留
                const getCellText = (cell: Element): string => {
                    // 将 <br> 替换为换行符
                    const clone = cell.cloneNode(true) as Element;
                    clone.querySelectorAll('br').forEach(br => {
                        br.replaceWith('\n');
                    });
                    return (clone.textContent || '').trim();
                };

                const cellTexts = Array.from(cells).map(cell => getCellText(cell));

                // 过滤掉全空的行
                if (cellTexts.every(t => !t)) return;

                // 第一列是外文，第二列是中文（如果有）
                if (cellTexts[0]) {
                    results.push({
                        foreign: cellTexts[0],
                        chinese: cellTexts[1] || undefined
                    });
                } else if (cellTexts[1]) {
                    // 如果第一列为空但第二列有内容
                    results.push({
                        foreign: cellTexts[1],
                        chinese: undefined
                    });
                }
            });
        } catch (error) {
            console.error('[CopywritingView] Failed to parse HTML table:', error);
        }

        return results;
    };

    // --- Clear all ---
    const handleClearAll = () => {
        setItems([]);
    };

    // --- Delete single item ---
    const handleDeleteItem = (id: string) => {
        setItems(prev => prev.filter(item => item.id !== id));
    };

    // --- 显示复制提示 ---
    const showCopyToast = (message: string) => {
        setCopyToast(message);
        setTimeout(() => setCopyToast(null), 2000);
    };

    // --- Process single item ---
    const processItem = async (item: CopywritingItem): Promise<{ foreign: string; chinese: string } | null> => {
        try {
            const ai = getAiInstance();

            const systemPrompt = `${systemInstruction}

【输出规则】
1. 只输出最终文案，不要任何解释
2. 输出格式：改写后的外文|||中文翻译
3. 使用 ||| 作为分隔符`;

            const userPrompt = `改写指令：
${instruction || DEFAULT_INSTRUCTION}

原始外文：
${item.originalForeign}

请严格按照指令改写，只修改指令要求的部分，其他保持原样。输出格式：改写后的外文|||中文翻译`;

            const result = await ai.models.generateContent({
                model: textModel,
                contents: { parts: [{ text: userPrompt }] },
                config: {
                    systemInstruction: systemPrompt
                }
            });

            const responseText = result.text?.trim() || '';

            // 解析响应
            const parts = responseText.split('|||');
            if (parts.length >= 2) {
                return {
                    foreign: parts[0].trim(),
                    chinese: parts[1].trim()
                };
            } else {
                // 如果没有分隔符，尝试其他方式解析或返回原文
                console.warn('[CopywritingView] Unexpected response format:', responseText);
                return {
                    foreign: responseText,
                    chinese: '(翻译失败)'
                };
            }
        } catch (error: any) {
            console.error('[CopywritingView] Process error:', error);
            throw error;
        }
    };

    // --- 批量处理函数：一次 API 调用处理多条文案 ---
    const processBatch = async (
        batchItems: CopywritingItem[],
        inst: string
    ): Promise<Map<string, { foreign: string; chinese: string }>> => {
        const ai = getAiInstance();
        const results = new Map<string, { foreign: string; chinese: string }>();

        // 构建批量输入
        const numberedInputs = batchItems.map((item, idx) => `[${idx + 1}] ${item.originalForeign}`).join('\n\n');

        let systemPrompt: string;
        let userPrompt: string;

        if (mode === 'voice') {
            // 人声模式批量处理
            systemPrompt = `${voiceModeSystemInstruction}

【批量处理输出规则】
你需要处理多条文案，每条以 [编号] 开头。
对于每条文案，输出格式为：[编号] 加标签结果|||断句结果
每条结果占一行。`;

            userPrompt = `${inst}

请为以下每条文案添加情感标签并断行：

${numberedInputs}

按格式输出每条结果：[编号] 加标签结果|||断句结果`;

        } else if (mode === 'classify') {
            // 分类模式批量处理
            systemPrompt = `${classifyModeSystemInstruction}

【批量处理输出规则】
你需要对多条文案进行分类，每条以 [编号] 开头。
对于每条文案，只输出：[编号] 分类结果
每条结果占一行，不要有任何解释。`;

            userPrompt = `分类规则：
${inst}

请对以下每条文案进行分类：

${numberedInputs}

按格式输出每条结果：[编号] 分类结果`;

        } else {
            // 标准模式批量处理
            systemPrompt = `${systemInstruction}

【批量处理输出规则】
你需要处理多条文案，每条以 [编号] 开头。
对于每条文案，输出格式为：[编号] 改写后的外文|||中文翻译
每条结果占一行。`;

            userPrompt = `改写指令：
${inst}

请处理以下每条文案：

${numberedInputs}

按格式输出每条结果：[编号] 改写后的外文|||中文翻译`;
        }

        try {
            const apiResult = await ai.models.generateContent({
                model: textModel,
                contents: { parts: [{ text: userPrompt }] },
                config: { systemInstruction: systemPrompt }
            });

            const responseText = apiResult.text?.trim() || '';

            // 解析批量结果
            const lines = responseText.split('\n').filter(line => line.trim());

            for (const line of lines) {
                // 匹配 [编号] 格式
                const match = line.match(/^\[(\d+)\]\s*(.+)$/);
                if (match) {
                    const idx = parseInt(match[1], 10) - 1;
                    const content = match[2].trim();

                    if (idx >= 0 && idx < batchItems.length) {
                        const item = batchItems[idx];

                        if (mode === 'classify') {
                            // 分类模式：只有分类结果
                            results.set(item.id, { foreign: content, chinese: '' });
                        } else {
                            // 标准/人声模式：解析 ||| 分隔符
                            const parts = content.split('|||');
                            if (parts.length >= 2) {
                                results.set(item.id, {
                                    foreign: parts[0].trim(),
                                    chinese: parts[1].trim()
                                });
                            } else {
                                // 解析失败，使用原始输出
                                results.set(item.id, { foreign: content, chinese: '(解析失败)' });
                            }
                        }
                    }
                }
            }
        } catch (error: any) {
            console.error('[CopywritingView] Batch process error:', error);
            throw error;
        }

        return results;
    };

    // --- Start processing ---
    const handleStartProcessing = async () => {
        const idleItems = items.filter(item => item.status === 'idle');
        if (idleItems.length === 0) return;

        // 过滤掉空指令
        const activeInstructions = instructions.filter(inst => inst.trim());
        if (activeInstructions.length === 0) {
            // 如果多指令列表为空，使用单个instruction
            if (instruction.trim()) {
                activeInstructions.push(instruction.trim());
            } else {
                activeInstructions.push(DEFAULT_INSTRUCTION);
            }
        }

        setIsProcessing(true);
        stopRef.current = false;

        // === 批量处理模式（batchSize > 1）===
        if (batchSize > 1) {
            // 设置所有 idle 项目为 processing 状态
            setItems(prev => prev.map(item =>
                item.status === 'idle' ? { ...item, status: 'processing' as const } : item
            ));

            try {
                // 对于每个指令，批量处理所有项目
                for (const inst of activeInstructions) {
                    if (stopRef.current) break;

                    // 分批处理
                    for (let i = 0; i < idleItems.length; i += batchSize) {
                        if (stopRef.current) break;

                        const batchItems = idleItems.slice(i, i + batchSize);

                        try {
                            const batchResults = await processBatch(batchItems, inst);

                            // 更新批量结果
                            setItems(prev => prev.map(item => {
                                const result = batchResults.get(item.id);
                                if (result) {
                                    const newResult: InstructionResult = {
                                        id: uuidv4(),
                                        instruction: inst,
                                        inputForeign: item.originalForeign,
                                        resultForeign: result.foreign,
                                        resultChinese: result.chinese,
                                        status: 'success',
                                        createdAt: Date.now()
                                    };
                                    return {
                                        ...item,
                                        status: 'success' as const,
                                        resultForeign: result.foreign,
                                        resultChinese: result.chinese,
                                        instructionResults: [...(item.instructionResults || []), newResult]
                                    };
                                }
                                return item;
                            }));

                            // 对于批量中没有返回结果的项目，标记为失败
                            const missingItems = batchItems.filter(item => !batchResults.has(item.id));
                            if (missingItems.length > 0) {
                                setItems(prev => prev.map(item => {
                                    if (missingItems.find(m => m.id === item.id)) {
                                        return {
                                            ...item,
                                            status: 'error' as const,
                                            error: '批量处理中未返回结果'
                                        };
                                    }
                                    return item;
                                }));
                            }
                        } catch (error: any) {
                            // 批次失败，标记该批次所有项目为错误
                            setItems(prev => prev.map(item => {
                                if (batchItems.find(b => b.id === item.id)) {
                                    return {
                                        ...item,
                                        status: 'error' as const,
                                        error: error.message || '批量处理失败'
                                    };
                                }
                                return item;
                            }));
                        }

                        // 批次之间延迟避免 API 限流
                        if (i + batchSize < idleItems.length) {
                            await new Promise(resolve => setTimeout(resolve, 300));
                        }
                    }
                }
            } catch (error: any) {
                console.error('[CopywritingView] Batch processing error:', error);
            }

            setIsProcessing(false);
            return;
        }

        // === 单条处理模式（batchSize === 1）===
        const CONCURRENT_LIMIT = 3; // 同时处理3条

        // 处理单个项目的所有指令（独立执行，每个指令都用原文）
        const processOneWithMultipleInstructions = async (item: CopywritingItem) => {
            if (stopRef.current) return;

            // Set processing status
            setItems(prev => prev.map(i =>
                i.id === item.id ? { ...i, status: 'processing', instructionResults: [] } : i
            ));

            const results: InstructionResult[] = [];
            let lastForeign = '';
            let lastChinese = '';

            try {
                for (let idx = 0; idx < activeInstructions.length; idx++) {
                    if (stopRef.current) break;

                    const inst = activeInstructions[idx];
                    const resultId = uuidv4();

                    try {
                        const ai = getAiInstance();

                        // 根据 mode === "voice" 选择不同的系统提示和输出格式
                        let systemPrompt: string;
                        let userPrompt: string;

                        if (mode === "voice") {
                            // 人声文案模式：使用用户编辑过的系统指令
                            systemPrompt = voiceModeSystemInstruction;
                            userPrompt = `${inst}

原始文案：
${item.originalForeign}

请根据指令为文案添加情感标签，并合理断行用于字幕显示。只输出最终结果，不要任何解释或标题。`;
                        } else if (mode === "classify") {
                            // 分类模式：只输出分类结果
                            systemPrompt = classifyModeSystemInstruction;
                            userPrompt = `分类规则：
${inst}

待分类文案：
${item.originalForeign}

请根据上述分类规则，只输出分类结果，不要附加任何解释或说明。`;
                        } else {
                            // 标准模式：输出外文+中文翻译
                            systemPrompt = `${systemInstruction}

【输出规则】
1. 只输出最终文案，不要任何解释
2. 输出格式：改写后的外文|||中文翻译
3. 使用 ||| 作为分隔符`;

                            userPrompt = `改写指令：
${inst}

原始外文：
${item.originalForeign}

请严格按照指令改写，只修改指令要求的部分，其他保持原样。输出格式：改写后的外文|||中文翻译`;
                        }

                        const apiResult = await ai.models.generateContent({
                            model: textModel,
                            contents: { parts: [{ text: userPrompt }] },
                            config: { systemInstruction: systemPrompt }
                        });

                        const responseText = apiResult.text?.trim() || '';

                        if (mode === "voice") {
                            // 人声文案模式：解析两个结果（加标签结果|||断句结果）
                            const parts = responseText.split('|||');
                            if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
                                lastForeign = parts[0].trim(); // 加标签结果
                                lastChinese = parts[1].trim(); // 断句结果
                            } else {
                                // 解析失败，抛出错误
                                throw new Error('断句解析失败：AI 未按格式返回结果');
                            }
                        } else if (mode === "classify") {
                            // 分类模式：只有一个分类结果
                            lastForeign = responseText.trim(); // 分类结果
                            lastChinese = ''; // 不需要中文翻译
                        } else {
                            // 标准模式：解析 ||| 分隔符
                            const parts = responseText.split('|||');
                            if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
                                lastForeign = parts[0].trim();
                                lastChinese = parts[1].trim();
                            } else {
                                // 解析失败，抛出错误
                                throw new Error('翻译解析失败：AI 未按格式返回结果');
                            }
                        }

                        results.push({
                            id: resultId,
                            instruction: inst,
                            inputForeign: item.originalForeign, // 始终用原文
                            resultForeign: lastForeign,
                            resultChinese: lastChinese,
                            status: 'success',
                            createdAt: Date.now()
                        });

                        // 更新UI显示进度
                        setItems(prev => prev.map(i =>
                            i.id === item.id ? {
                                ...i,
                                instructionResults: [...results],
                                resultForeign: lastForeign,
                                resultChinese: lastChinese
                            } : i
                        ));

                    } catch (error: any) {
                        results.push({
                            id: resultId,
                            instruction: inst,
                            inputForeign: item.originalForeign,
                            resultForeign: '',
                            resultChinese: '',
                            status: 'error',
                            error: error.message || '处理失败',
                            createdAt: Date.now()
                        });
                        // 出错后继续下一个指令，使用之前的输入
                    }
                }

                // 完成：设置最终状态
                const hasError = results.some(r => r.status === 'error');
                setItems(prev => prev.map(i =>
                    i.id === item.id ? {
                        ...i,
                        instructionResults: results,
                        resultForeign: lastForeign,
                        resultChinese: lastChinese,
                        status: hasError ? 'error' : 'success'
                    } : i
                ));

            } catch (error: any) {
                setItems(prev => prev.map(i =>
                    i.id === item.id ? {
                        ...i,
                        status: 'error',
                        error: error.message || '处理失败'
                    } : i
                ));
            }
        };

        // 并发处理，分批执行
        for (let i = 0; i < idleItems.length; i += CONCURRENT_LIMIT) {
            if (stopRef.current) break;

            const batch = idleItems.slice(i, i + CONCURRENT_LIMIT);
            await Promise.all(batch.map(item => processOneWithMultipleInstructions(item)));

            // 批次之间稍微延迟避免 API 限流
            if (i + CONCURRENT_LIMIT < idleItems.length) {
                await new Promise(resolve => setTimeout(resolve, 200));
            }
        }

        setIsProcessing(false);
    };

    // --- Stop processing ---
    const handleStopProcessing = () => {
        stopRef.current = true;
    };

    // --- Copy functions (无空行) ---
    const handleCopy = (type: 'foreign' | 'chinese' | 'both' | 'all') => {
        // 包含所有有指令结果的项目（包括失败的），保持行对齐
        const allItems = items.filter(item => item.instructionResults && item.instructionResults.length > 0);
        if (allItems.length === 0) return;

        // 计算最大指令数
        const instructionCount = Math.max(...allItems.map(item => item.instructionResults?.length || 0));

        let headers: string[] = [];
        let rows: string[] = [];

        // 根据 mode === "voice" 决定列名
        const col1Name = mode === "voice" ? '加标签' : '外文';
        const col2Name = mode === "voice" ? '断句' : '中文';

        switch (type) {
            case 'foreign':
                // 表头：指令1外文/加标签, 指令2外文/加标签...
                headers = Array.from({ length: instructionCount }, (_, i) => `指令${i + 1}${col1Name}`);
                rows = allItems.map(item => {
                    const results = item.instructionResults!;
                    return Array.from({ length: instructionCount }, (_, i) =>
                        results[i]?.status === 'success' ? escapeForSheet(results[i].resultForeign) : ''
                    ).join('\t');
                });
                break;
            case 'chinese':
                // 表头：指令1中文/断句, 指令2中文/断句...
                headers = Array.from({ length: instructionCount }, (_, i) => `指令${i + 1}${col2Name}`);
                rows = allItems.map(item => {
                    const results = item.instructionResults!;
                    return Array.from({ length: instructionCount }, (_, i) =>
                        results[i]?.status === 'success' ? escapeForSheet(results[i].resultChinese) : ''
                    ).join('\t');
                });
                break;
            case 'both':
                // 表头：指令1外文/加标签, 指令1中文/断句, 指令2外文/加标签, 指令2中文/断句...
                headers = [];
                for (let i = 0; i < instructionCount; i++) {
                    headers.push(`指令${i + 1}${col1Name}`, `指令${i + 1}${col2Name}`);
                }
                rows = allItems.map(item => {
                    const results = item.instructionResults!;
                    const row: string[] = [];
                    for (let i = 0; i < instructionCount; i++) {
                        if (results[i]?.status === 'success') {
                            row.push(escapeForSheet(results[i].resultForeign), escapeForSheet(results[i].resultChinese));
                        } else {
                            row.push('', '');
                        }
                    }
                    return row.join('\t');
                });
                break;
            case 'all':
                // 表头：原始外文/原文, 原始中文/原中文, 指令1外文/加标签, 指令1中文/断句...
                headers = [mode === "voice" ? '原文' : '原始外文', mode === "voice" ? '原中文' : '原始中文'];
                for (let i = 0; i < instructionCount; i++) {
                    headers.push(`指令${i + 1}${col1Name}`, `指令${i + 1}${col2Name}`);
                }
                rows = allItems.map(item => {
                    const results = item.instructionResults!;
                    const row = [escapeForSheet(item.originalForeign), escapeForSheet(item.originalChinese || '')];
                    for (let i = 0; i < instructionCount; i++) {
                        if (results[i]?.status === 'success') {
                            row.push(escapeForSheet(results[i].resultForeign), escapeForSheet(results[i].resultChinese));
                        } else {
                            row.push('', '');
                        }
                    }
                    return row.join('\t');
                });
                break;
        }

        const text = [headers.join('\t'), ...rows].join('\n');
        navigator.clipboard.writeText(text);
        setCopiedType(type);
        showCopyToast(`已复制${allItems.length}条结果`);
        setTimeout(() => setCopiedType(null), 2000);
    };

    // --- Export ---
    const handleExport = () => {
        const successItems = items.filter(item => item.status === 'success');
        if (successItems.length === 0) return;

        // 为TSV格式化：用引号包裹，内部引号转义
        const escapeForSheet = (text: string) => {
            const t = text || '';
            if (t.includes('\t') || t.includes('\n') || t.includes('\r') || t.includes('"')) {
                return `"${t.replace(/"/g, '""')}"`;
            }
            return t;
        };

        let content = '原始外文\t原始中文\t改写后外文\t改写后中文\n';
        successItems.forEach(item => {
            content += `${escapeForSheet(item.originalForeign)}\t${escapeForSheet(item.originalChinese || '')}\t${escapeForSheet(item.resultForeign || '')}\t${escapeForSheet(item.resultChinese || '')}\n`;
        });

        const blob = new Blob([content], { type: 'text/tab-separated-values;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `copywriting_export_${new Date().toISOString().slice(0, 10)}.tsv`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // --- Preset management ---
    const handleSelectPreset = (preset: CopywritingPreset) => {
        setInstruction(preset.instruction);
        setSelectedPresetId(preset.id);
        setShowPresetDropdown(false);
    };

    const handleSavePreset = () => {
        // 获取第一个非空指令
        const firstInstruction = instructions.find(i => i.trim());
        if (!firstInstruction) return;

        // 打开保存预设modal
        setNewPresetName(firstInstruction.slice(0, 20) + '...');
        setShowSavePreset(true);
    };

    const confirmSavePreset = async () => {
        const firstInstruction = instructions.find(i => i.trim());
        if (!firstInstruction || !newPresetName.trim()) return;

        const newPreset: CopywritingPreset = {
            id: uuidv4(),
            name: newPresetName.trim(),
            instruction: firstInstruction.trim(),
            createdAt: Date.now()
        };

        const newPresets = [...presets, newPreset];
        setPresets(newPresets);
        await savePresetsToFirebase(newPresets);

        setShowSavePreset(false);
        setNewPresetName('');
        showCopyToast(`已保存预设: ${newPresetName.trim()}`);
    };

    const handleDeletePreset = async (presetId: string, e: React.MouseEvent) => {
        e.stopPropagation();

        const newPresets = presets.filter(p => p.id !== presetId);
        setPresets(newPresets);
        await savePresetsToFirebase(newPresets);

        if (selectedPresetId === presetId) {
            setSelectedPresetId(null);
        }
    };

    // --- Reset item to idle ---
    const handleRetryItem = (id: string) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, status: 'idle', error: undefined } : item
        ));
    };

    // --- 一键重试所有失败的项目 ---
    const handleRetryAllErrors = () => {
        setItems(prev => prev.map(item =>
            item.status === 'error' ? { ...item, status: 'idle', error: undefined, instructionResults: [] } : item
        ));
        // 设置标志，等 items 更新后自动开始
        setPendingRetryStart(true);
    };

    // 监听 pendingRetryStart，当 items 更新后自动开始处理
    useEffect(() => {
        if (pendingRetryStart && items.some(i => i.status === 'idle')) {
            setPendingRetryStart(false);
            handleStartProcessing();
        }
    }, [pendingRetryStart, items]);

    // --- Process single item (重试/单条处理) - 支持多指令 ---
    const handleProcessSingleItem = async (item: CopywritingItem) => {
        setItems(prev => prev.map(i =>
            i.id === item.id ? { ...i, status: 'processing', instructionResults: [] } : i
        ));

        try {
            // 过滤有效指令
            const validInstructions = instructions.filter(inst => inst.trim());
            if (validInstructions.length === 0) {
                throw new Error('请输入至少一条有效指令');
            }

            const instructionResults: InstructionResult[] = [];

            // 独立执行每个指令（每个都用原文作为输入）
            for (let i = 0; i < validInstructions.length; i++) {
                const inst = validInstructions[i];
                try {
                    const result = await processItemWithInstruction(
                        item, // 始终用原文
                        inst
                    );
                    if (result) {
                        instructionResults.push({
                            id: `${item.id}_inst_${i}`,
                            instruction: inst,
                            inputForeign: item.originalForeign,
                            resultForeign: result.foreign,
                            resultChinese: result.chinese,
                            status: 'success',
                            createdAt: Date.now()
                        });
                    }
                } catch (err: any) {
                    instructionResults.push({
                        id: `${item.id}_inst_${i}`,
                        instruction: inst,
                        inputForeign: item.originalForeign,
                        resultForeign: '',
                        resultChinese: '',
                        status: 'error',
                        error: err.message,
                        createdAt: Date.now()
                    });
                }
            }

            // 最终结果取最后一个成功的指令结果
            const lastSuccess = [...instructionResults].reverse().find(r => r.status === 'success');

            setItems(prev => prev.map(i =>
                i.id === item.id ? {
                    ...i,
                    instructionResults,
                    resultForeign: lastSuccess?.resultForeign || '',
                    resultChinese: lastSuccess?.resultChinese || '',
                    status: instructionResults.some(r => r.status === 'success') ? 'success' : 'error',
                    error: instructionResults.every(r => r.status === 'error') ? '所有指令执行失败' : undefined
                } : i
            ));
        } catch (error: any) {
            setItems(prev => prev.map(i =>
                i.id === item.id ? {
                    ...i,
                    status: 'error',
                    error: error.message || '处理失败'
                } : i
            ));
        }
    };

    // --- Process item with specific instruction ---
    const processItemWithInstruction = async (item: CopywritingItem, itemInstruction: string): Promise<{ foreign: string; chinese: string } | null> => {
        try {
            const ai = getAiInstance();

            // 根据 mode === "voice" 选择不同的系统提示和输出格式（与批量处理一致）
            let systemPrompt: string;
            let userPrompt: string;

            if (mode === "voice") {
                // 人声文案模式：使用用户编辑过的系统指令
                systemPrompt = voiceModeSystemInstruction;
                userPrompt = `${itemInstruction}

原始文案：
${item.originalForeign}

请根据指令为文案添加情感标签，并合理断行用于字幕显示。只输出最终结果，不要任何解释或标题。`;
            } else {
                // 标准模式：输出外文+中文翻译
                systemPrompt = `${systemInstruction}

【输出规则】
1. 只输出最终文案，不要任何解释
2. 输出格式：改写后的外文|||中文翻译
3. 使用 ||| 作为分隔符`;

                userPrompt = `改写指令：
${itemInstruction}

原始外文：
${item.originalForeign}

请严格按照指令改写，只修改指令要求的部分，其他保持原样。输出格式：改写后的外文|||中文翻译`;
            }

            const result = await ai.models.generateContent({
                model: textModel,
                contents: { parts: [{ text: userPrompt }] },
                config: {
                    systemInstruction: systemPrompt
                }
            });

            const responseText = result.text?.trim() || '';

            if (mode === "voice") {
                // 人声文案模式：解析两个结果（加标签结果|||断句结果）
                const parts = responseText.split('|||');
                if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
                    return {
                        foreign: parts[0].trim(), // 加标签结果
                        chinese: parts[1].trim()  // 断句结果
                    };
                } else {
                    // 解析失败，抛出错误
                    throw new Error('断句解析失败：AI 未按格式返回结果');
                }
            } else {
                // 标准模式：解析 ||| 分隔符
                const parts = responseText.split('|||');
                if (parts.length >= 2 && parts[0].trim() && parts[1].trim()) {
                    return {
                        foreign: parts[0].trim(),
                        chinese: parts[1].trim()
                    };
                } else {
                    // 解析失败，抛出错误
                    throw new Error('翻译解析失败：AI 未按格式返回结果');
                }
            }
        } catch (error: any) {
            console.error('[CopywritingView] Process error:', error);
            throw error;
        }
    };

    // --- Update item settings ---
    const updateItemSettings = (id: string, updates: Partial<CopywritingItem>) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, ...updates } : item
        ));
    };

    // --- Toggle chat ---
    const toggleItemChat = (id: string) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, chatOpen: !item.chatOpen } : item
        ));
    };

    // --- Toggle settings panel ---
    const toggleItemSettings = (id: string) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, showSettings: !item.showSettings } : item
        ));
    };

    // --- Copy single item ---
    const handleCopySingleItem = (item: CopywritingItem, type: 'all' | 'foreign' | 'chinese' | 'result') => {
        const escapeForSheet = (text: string) => {
            const t = text || '';
            if (t.includes('\t') || t.includes('\n') || t.includes('\r') || t.includes('"')) {
                return `"${t.replace(/"/g, '""')}"`;
            }
            return t;
        };
        let text = '';
        switch (type) {
            case 'foreign':
                text = escapeForSheet(item.resultForeign || '');
                break;
            case 'chinese':
                text = escapeForSheet(item.resultChinese || '');
                break;
            case 'result':
                text = `${escapeForSheet(item.resultForeign || '')}\t${escapeForSheet(item.resultChinese || '')}`;
                break;
            case 'all':
                text = `${escapeForSheet(item.originalForeign)}\t${escapeForSheet(item.originalChinese || '')}\t${escapeForSheet(item.resultForeign || '')}\t${escapeForSheet(item.resultChinese || '')}`;
                break;
        }
        navigator.clipboard.writeText(text);
    };

    // --- Reset all to idle ---
    const handleResetAll = () => {
        setItems(prev => prev.map(item => ({
            ...item,
            status: 'idle',
            resultForeign: undefined,
            resultChinese: undefined,
            error: undefined,
            instructionResults: []
        })));
    };

    // --- 折叠/展开功能 ---
    const toggleItemCollapse = (id: string) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, collapsed: !item.collapsed } : item
        ));
    };

    const toggleAllCollapse = () => {
        const newState = !allCollapsed;
        setAllCollapsed(newState);
        setItems(prev => prev.map(item => ({ ...item, collapsed: newState })));
    };

    // --- 多指令管理 ---
    const addInstruction = () => {
        setInstructions(prev => [...prev, '']);
    };

    const removeInstruction = (index: number) => {
        if (instructions.length <= 1) return;
        setInstructions(prev => prev.filter((_, i) => i !== index));
    };

    const updateInstruction = (index: number, value: string) => {
        setInstructions(prev => prev.map((inst, i) => i === index ? value : inst));
    };

    // --- 检测文本是否主要是中文 ---
    const isMostlyChinese = (text: string): boolean => {
        if (!text) return false;
        const chineseChars = text.match(/[\u4e00-\u9fff]/g);
        const totalChars = text.replace(/\s/g, '').length;
        if (totalChars === 0) return false;
        return (chineseChars?.length || 0) / totalChars > 0.3;
    };

    // --- 针对单个指令的重试 ---
    const handleRetryInstruction = async (itemId: string, instIdx: number) => {
        const item = items.find(i => i.id === itemId);
        if (!item) return;

        const inst = instructions[instIdx];
        if (!inst?.trim()) return;

        // 更新该指令状态为processing
        setItems(prev => prev.map(i => {
            if (i.id !== itemId) return i;
            const newResults = [...(i.instructionResults || [])];
            if (newResults[instIdx]) {
                newResults[instIdx] = { ...newResults[instIdx], status: 'processing', error: undefined };
            }
            return { ...i, instructionResults: newResults };
        }));

        try {
            const result = await processItemWithInstruction(item, inst);
            setItems(prev => prev.map(i => {
                if (i.id !== itemId) return i;
                const newResults = [...(i.instructionResults || [])];
                if (result) {
                    newResults[instIdx] = {
                        ...newResults[instIdx],
                        resultForeign: result.foreign,
                        resultChinese: result.chinese,
                        status: 'success',
                        error: undefined
                    };
                } else {
                    newResults[instIdx] = { ...newResults[instIdx], status: 'error', error: '处理失败' };
                }
                // 根据所有指令结果计算 item 整体状态
                const allSuccess = newResults.every(r => r.status === 'success');
                const hasError = newResults.some(r => r.status === 'error');
                const hasProcessing = newResults.some(r => r.status === 'processing');
                let newStatus: 'idle' | 'processing' | 'success' | 'error' = i.status;
                if (hasProcessing) {
                    newStatus = 'processing';
                } else if (allSuccess) {
                    newStatus = 'success';
                } else if (hasError) {
                    newStatus = 'error';
                }
                return { ...i, instructionResults: newResults, status: newStatus };
            }));
        } catch (err) {
            setItems(prev => prev.map(i => {
                if (i.id !== itemId) return i;
                const newResults = [...(i.instructionResults || [])];
                newResults[instIdx] = { ...newResults[instIdx], status: 'error', error: String(err) };
                // 更新整体状态为 error
                return { ...i, instructionResults: newResults, status: 'error' };
            }));
        }
    };

    // --- 针对单个指令的对话开关 ---
    const toggleInstructionChat = (itemId: string, instIdx: number) => {
        setItems(prev => prev.map(i => {
            if (i.id !== itemId) return i;
            const newResults = [...(i.instructionResults || [])];
            if (newResults[instIdx]) {
                newResults[instIdx] = { ...newResults[instIdx], chatOpen: !newResults[instIdx].chatOpen };
            }
            return { ...i, instructionResults: newResults };
        }));
    };

    // --- 针对单个指令的对话输入更新 ---
    const updateInstructionChatInput = (itemId: string, instIdx: number, value: string) => {
        setItems(prev => prev.map(i => {
            if (i.id !== itemId) return i;
            const newResults = [...(i.instructionResults || [])];
            if (newResults[instIdx]) {
                newResults[instIdx] = { ...newResults[instIdx], chatInput: value };
            }
            return { ...i, instructionResults: newResults };
        }));
    };

    // --- 针对单个指令的对话发送 ---
    const handleInstructionChatSend = async (itemId: string, instIdx: number) => {
        const item = items.find(i => i.id === itemId);
        if (!item || !item.instructionResults?.[instIdx]) return;

        const result = item.instructionResults[instIdx];
        const input = result.chatInput?.trim();
        if (!input) return;

        const userMsg: ChatMessage = { id: uuidv4(), role: 'user', text: input };

        // 添加用户消息并清空输入
        setItems(prev => prev.map(i => {
            if (i.id !== itemId) return i;
            const newResults = [...(i.instructionResults || [])];
            newResults[instIdx] = {
                ...newResults[instIdx],
                chatHistory: [...(newResults[instIdx].chatHistory || []), userMsg],
                chatInput: '',
                chatLoading: true
            };
            return { ...i, instructionResults: newResults };
        }));

        try {
            const ai = getAiInstance();
            const systemPrompt = `你是一个专业的文案编辑和翻译专家。
当前正在编辑的文案：
- 原始外文：${item.originalForeign}
- 改写指令：${result.instruction}
- 当前外文结果：${result.resultForeign}
- 当前中文翻译：${result.resultChinese}

请根据用户的要求修改文案。输出格式：修改后的外文|||中文翻译`;

            const chatResult = await ai.models.generateContent({
                model: textModel,
                contents: { parts: [{ text: input }] },
                config: { systemInstruction: systemPrompt }
            });

            const responseText = chatResult.text?.trim() || '';

            // 解析结果
            const parts = responseText.split('|||');
            const hasUpdate = parts.length >= 2;

            // 构建助手消息，如果更新了结果则添加提示
            const msgText = hasUpdate
                ? `${responseText}\n\n✅ 结果已更新到上方单元格，请查看。`
                : responseText;
            const assistantMsg: ChatMessage = { id: uuidv4(), role: 'model', text: msgText };

            setItems(prev => prev.map(i => {
                if (i.id !== itemId) return i;
                const newResults = [...(i.instructionResults || [])];
                newResults[instIdx] = {
                    ...newResults[instIdx],
                    chatHistory: [...(newResults[instIdx].chatHistory || []), assistantMsg],
                    chatLoading: false,
                    ...(hasUpdate ? { resultForeign: parts[0].trim(), resultChinese: parts[1].trim() } : {})
                };
                return { ...i, instructionResults: newResults };
            }));
        } catch (err) {
            const errorMsg: ChatMessage = { id: uuidv4(), role: 'model', text: `错误: ${err}` };
            setItems(prev => prev.map(i => {
                if (i.id !== itemId) return i;
                const newResults = [...(i.instructionResults || [])];
                newResults[instIdx] = {
                    ...newResults[instIdx],
                    chatHistory: [...(newResults[instIdx].chatHistory || []), errorMsg],
                    chatLoading: false
                };
                return { ...i, instructionResults: newResults };
            }));
        }
    };

    const handleChatSend = async (item: CopywritingItem) => {
        const input = item.chatInput?.trim();
        if (!input) return;

        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            text: input
        };

        // 添加用户消息并清空输入
        setItems(prev => prev.map(i =>
            i.id === item.id ? {
                ...i,
                chatHistory: [...(i.chatHistory || []), userMsg],
                chatInput: '',
                chatLoading: true
            } : i
        ));

        try {
            const ai = getAiInstance();

            const systemPrompt = `你是一个专业的文案编辑和翻译专家。

当前正在编辑的文案：
- 原始外文：${item.originalForeign}
- 原始中文：${item.originalChinese || '(无)'}
${item.resultForeign ? `- 当前改写结果：${item.resultForeign}` : ''}
${item.resultChinese ? `- 当前翻译结果：${item.resultChinese}` : ''}

之前批量处理时使用的改写指令：
"${instruction || DEFAULT_INSTRUCTION}"

用户正在通过对话继续优化这条文案。请根据用户的要求进行修改。

【输出规则】
- 如果用户要求修改文案，输出格式必须是：改写后的外文|||中文翻译
- 使用 ||| 作为分隔符
- 不要任何解释，直接输出结果
- 如果用户只是在询问或讨论，可以正常回复`;

            const historyForAI = (item.chatHistory || []).map(msg => ({
                role: msg.role as 'user' | 'model',
                parts: [{ text: msg.text }]
            }));

            const result = await ai.models.generateContent({
                model: textModel,
                contents: [
                    ...historyForAI,
                    { role: 'user', parts: [{ text: input }] }
                ],
                config: {
                    systemInstruction: systemPrompt
                }
            });

            const responseText = result.text?.trim() || '';

            // 检测是否包含 ||| 分隔符（表示修改了文案）
            const parts = responseText.split('|||');
            let updatedItem: Partial<CopywritingItem> = {};

            if (parts.length >= 2) {
                // 是格式化的结果，更新改写结果
                updatedItem = {
                    resultForeign: parts[0].trim(),
                    resultChinese: parts[1].trim(),
                    status: 'success'
                };
            }

            // 构建回复消息，如果更新了结果则添加提醒
            let replyText = responseText;
            if (parts.length >= 2) {
                replyText += '\n\n✅ 结果已更新到上方单元格，请查看。';
            }

            const modelMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: replyText
            };

            setItems(prev => prev.map(i =>
                i.id === item.id ? {
                    ...i,
                    ...updatedItem,
                    chatHistory: [...(i.chatHistory || []), modelMsg],
                    chatLoading: false
                } : i
            ));
        } catch (error: any) {
            console.error('[CopywritingView] Chat error:', error);
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: `错误：${error.message || '处理失败'}`
            };
            setItems(prev => prev.map(i =>
                i.id === item.id ? {
                    ...i,
                    chatHistory: [...(i.chatHistory || []), errorMsg],
                    chatLoading: false
                } : i
            ));
        }
    };


    // --- Stats ---
    const stats = {
        total: items.length,
        idle: items.filter(i => i.status === 'idle').length,
        processing: items.filter(i => i.status === 'processing').length,
        success: items.filter(i => i.status === 'success').length,
        error: items.filter(i => i.status === 'error').length
    };

    return (
        <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 p-4 gap-3 overflow-y-auto custom-scrollbar">

            {/* === 改写指令 + 输入文案 (同一行) === */}
            <div className="flex gap-3">
                {/* 改写指令 (左侧 40%) */}
                <div className="w-2/5 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <Settings2 size={14} className={mode === 'voice' ? 'text-purple-400' : mode === 'classify' ? 'text-cyan-400' : 'text-amber-400'} />
                            <span className="text-xs font-medium text-zinc-300">
                                {mode === 'voice' ? '人声文案指令' : mode === 'classify' ? '分类规则' : '改写指令'}
                            </span>
                            {/* 模式切换按钮组 */}
                            <div className="flex items-center gap-0.5">
                                <button
                                    onClick={() => {
                                        setMode('standard');
                                        setInstructions([DEFAULT_INSTRUCTION]);
                                    }}
                                    className={`px-2 py-0.5 text-[10px] rounded-l-full transition-all border ${mode === 'standard'
                                        ? 'bg-amber-600 text-white border-amber-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        }`}
                                    title="标准模式：文案改写 + 翻译"
                                >
                                    <FileEdit size={10} className="inline mr-0.5" /> 标准
                                </button>
                                <button
                                    onClick={() => {
                                        setMode('voice');
                                        setInstructions([VOICE_MODE_DEFAULT_INSTRUCTION]);
                                    }}
                                    className={`px-2 py-0.5 text-[10px] transition-all border-y ${mode === 'voice'
                                        ? 'bg-purple-600 text-white border-purple-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        }`}
                                    title="人声模式：ElevenLabs 配音标注"
                                >
                                    <Mic size={10} className="inline mr-0.5" /> 人声
                                </button>
                                <button
                                    onClick={() => {
                                        setMode('classify');
                                        setInstructions([CLASSIFY_MODE_DEFAULT_INSTRUCTION]);
                                    }}
                                    className={`px-2 py-0.5 text-[10px] rounded-r-full transition-all border ${mode === 'classify'
                                        ? 'bg-cyan-600 text-white border-cyan-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        }`}
                                    title="分类模式：按规则输出分类结果"
                                >
                                    <Tag size={10} className="inline mr-0.5" /> 分类
                                </button>
                            </div>
                            {/* 显示差异开关 - 仅标准模式 */}
                            {mode === 'standard' && (
                                <button
                                    onClick={() => setShowDiff(!showDiff)}
                                    className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full transition-all ${showDiff
                                        ? 'bg-amber-600 text-white border border-amber-500'
                                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'
                                        }`}
                                    title={showDiff ? '关闭差异高亮' : '显示原文与改写结果的差异'}
                                >
                                    {showDiff ? <><Search size={10} className="inline mr-0.5" /> 差异显示中</> : <><Search size={10} className="inline mr-0.5" /> 显示差异</>}
                                </button>
                            )}
                            {/* 批次处理设置 */}
                            <div className="relative">
                                <button
                                    onClick={() => setShowBatchSettings(!showBatchSettings)}
                                    className={`flex items-center gap-1 px-2 py-0.5 text-[10px] rounded-full transition-all ${batchSize > 1
                                        ? 'bg-emerald-600 text-white border border-emerald-500'
                                        : 'bg-zinc-800 text-zinc-400 border border-zinc-700 hover:bg-zinc-700'
                                        }`}
                                    title={`批次处理：每次 ${batchSize} 条（点击设置）`}
                                >
                                    <Package size={10} className="inline mr-0.5" /> 批次×{batchSize}
                                </button>
                                {showBatchSettings && (
                                    <div className="absolute top-full left-0 mt-1 bg-zinc-800 border border-zinc-700 rounded-lg p-2 shadow-lg z-50 min-w-[180px]">
                                        <div className="text-[10px] text-zinc-400 mb-1">每次 API 调用处理条数</div>
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="range"
                                                min="1"
                                                max="2000"
                                                value={batchSize}
                                                onChange={(e) => setBatchSize(parseInt(e.target.value))}
                                                className="flex-1 h-1 accent-emerald-500"
                                            />
                                            <input
                                                type="number"
                                                min="1"
                                                max="2000"
                                                value={batchSize}
                                                onChange={(e) => {
                                                    const val = parseInt(e.target.value) || 1;
                                                    setBatchSize(Math.min(2000, Math.max(1, val)));
                                                }}
                                                className="w-16 bg-zinc-900 border border-zinc-600 rounded px-2 py-0.5 text-xs text-center text-white [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none"
                                            />
                                        </div>
                                        <div className="text-[9px] text-zinc-500 mt-1">
                                            {batchSize === 1 ? '单条模式：每条文案单独调用API，结果更精准' : `批次模式：${batchSize}条/次，大幅减少API调用次数`}
                                        </div>
                                        <div className="text-[8px] text-zinc-600 mt-1 border-t border-zinc-700 pt-1 flex items-start gap-1">
                                            <Lightbulb size={10} className="shrink-0 mt-0.5" /> 提示：批次越大，API调用越少，速度越快，但单条结果精度可能略降。推荐分类任务用批次模式，改写任务用单条模式。
                                        </div>
                                        <div className="flex justify-between mt-2">
                                            <button
                                                onClick={() => setBatchSize(1)}
                                                className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600"
                                            >
                                                单条
                                            </button>
                                            <button
                                                onClick={() => setBatchSize(20)}
                                                className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600"
                                            >
                                                ×20
                                            </button>
                                            <button
                                                onClick={() => setBatchSize(50)}
                                                className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600"
                                            >
                                                ×50
                                            </button>
                                            <button
                                                onClick={() => setBatchSize(100)}
                                                className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600"
                                            >
                                                ×100
                                            </button>
                                            <button
                                                onClick={() => setBatchSize(500)}
                                                className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600"
                                            >
                                                ×500
                                            </button>
                                            <button
                                                onClick={() => setBatchSize(2000)}
                                                className="text-[9px] px-1.5 py-0.5 rounded bg-emerald-700 hover:bg-emerald-600"
                                            >
                                                Max
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                        <div className="flex items-center gap-1">
                            {/* 保存预设 */}
                            <button
                                onClick={handleSavePreset}
                                disabled={presetLoading || !instructions.some(i => i.trim())}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded transition-colors text-amber-500 hover:text-amber-400 hover:bg-amber-900/20 disabled:opacity-50"
                                title="保存当前指令为预设"
                            >
                                <Save size={10} /> 保存
                            </button>
                            {/* 管理预设 */}
                            <button
                                onClick={() => setShowPresetManager(true)}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded transition-colors text-blue-400 hover:text-blue-300 hover:bg-blue-900/20"
                                title="管理预设"
                            >
                                <FolderOpen size={10} /> 管理
                            </button>
                            {/* 预览指令 */}
                            <button
                                onClick={() => setShowPreview(true)}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded transition-colors text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800"
                            >
                                <Eye size={10} /> 预览
                            </button>
                        </div>
                    </div>
                    {/* 多指令列表 */}
                    <div className="space-y-1.5 max-h-48 overflow-y-auto overflow-x-hidden">
                        {instructions.map((inst, idx) => (
                            <div key={idx} className="flex items-start gap-1">
                                <span className="text-[10px] text-amber-400 w-4 shrink-0 mt-1.5">{idx + 1}.</span>
                                <div className="flex-1 relative">
                                    <textarea
                                        value={inst}
                                        onChange={(e) => updateInstruction(idx, e.target.value)}
                                        onDoubleClick={() => setEditingInstructionIndex(idx)}
                                        placeholder="输入改写指令..."
                                        title="双击弹框编辑"
                                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-amber-500 placeholder-zinc-600 resize-none min-h-[36px]"
                                        rows={2}
                                    />
                                </div>
                                {/* 预设选择按钮 */}
                                <button
                                    onClick={() => setActivePresetDropdown(activePresetDropdown === idx ? null : idx)}
                                    className={`p-1 rounded transition-colors mt-0.5 ${activePresetDropdown === idx
                                        ? 'text-amber-400 bg-amber-900/30'
                                        : 'text-zinc-500 hover:text-amber-400 hover:bg-zinc-800'
                                        }`}
                                    title="选择预设"
                                >
                                    <ChevronDown size={12} />
                                </button>
                                {instructions.length > 1 && (
                                    <button
                                        onClick={() => removeInstruction(idx)}
                                        className="p-0.5 text-zinc-500 hover:text-red-400 mt-1"
                                    >
                                        <X size={12} />
                                    </button>
                                )}
                            </div>
                        ))}
                    </div>

                    {/* 预设选择面板 - 当选中某个指令时显示 */}
                    {activePresetDropdown !== null && activePresetDropdown >= 0 && (
                        <div className="mt-2 bg-zinc-950 border border-amber-700/50 rounded-lg p-2">
                            <div className="text-[10px] text-amber-400 mb-1.5">
                                选择预设填充到指令 {activePresetDropdown + 1}：
                            </div>
                            <div className="flex flex-wrap gap-1">
                                {BUILTIN_PRESETS.map(preset => (
                                    <button
                                        key={preset.id}
                                        onClick={() => { updateInstruction(activePresetDropdown, preset.instruction); setActivePresetDropdown(null); }}
                                        className="px-2 py-1 bg-zinc-800 hover:bg-amber-900/30 text-xs text-amber-300 rounded border border-zinc-700 hover:border-amber-600 truncate max-w-[150px]"
                                        title={preset.instruction}
                                    >
                                        {preset.name}
                                    </button>
                                ))}
                                {presets.map(preset => (
                                    <button
                                        key={preset.id}
                                        onClick={() => { updateInstruction(activePresetDropdown, preset.instruction); setActivePresetDropdown(null); }}
                                        className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 rounded border border-zinc-700 truncate max-w-[150px]"
                                        title={preset.instruction}
                                    >
                                        {preset.name}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 添加指令按钮 */}
                    <button
                        onClick={addInstruction}
                        className="mt-2 flex items-center gap-1 px-2 py-0.5 text-[10px] text-amber-400 hover:bg-amber-900/20 rounded border border-amber-900/30"
                    >
                        <Plus size={10} /> 添加指令
                    </button>
                </div>

                {/* 输入文案 (右侧 60%) */}
                <div className="w-3/5 bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <FileText size={14} className="text-emerald-400" />
                            <span className="text-xs font-medium text-zinc-300">输入文案</span>
                            {bulkInput && (
                                <button onClick={() => setBulkInput('')} className="text-[10px] text-zinc-500 hover:text-zinc-300">清空</button>
                            )}
                        </div>
                        <span className="text-[10px] text-zinc-500">
                            待添加约 <span className="text-emerald-400 font-medium">{bulkInput.trim() ? bulkInput.trim().split('\n').length : 0}</span> 条
                        </span>
                    </div>
                    <div className="relative">
                        <textarea
                            value={bulkInput}
                            onChange={(e) => setBulkInput(e.target.value)}
                            onPaste={handlePaste}
                            placeholder="直接粘贴表格数据，自动识别单元格。支持：Google表格/Excel"
                            className="w-full bg-zinc-950 border border-zinc-700 rounded px-2 py-1.5 pb-8 text-xs text-zinc-200 focus:outline-none focus:border-emerald-500 resize-none h-20 placeholder-zinc-600 font-mono"
                            onKeyDown={(e) => { if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleAddItems('batch'); }}
                        />
                        <div className="absolute bottom-1.5 right-1.5 flex gap-1">
                            <button
                                onClick={() => handleAddItems('single')}
                                disabled={!bulkInput.trim()}
                                className="px-2 py-0.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-600 rounded text-[10px] disabled:opacity-50 flex items-center"
                            >
                                <Plus size={10} className="mr-0.5" /> 单条
                            </button>
                            <button
                                onClick={() => handleAddItems('batch')}
                                disabled={!bulkInput.trim()}
                                className="px-2 py-0.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded text-[10px] disabled:opacity-50 flex items-center"
                            >
                                <FileText size={10} className="mr-0.5" /> 批量添加
                            </button>
                        </div>
                    </div>
                </div>
            </div>

            {/* === 状态栏 + 操作按钮 (第二行) === */}
            <div className="flex items-center justify-between gap-3">
                {/* 状态栏 */}
                {items.length > 0 ? (
                    <div className="flex items-stretch gap-0 bg-zinc-900 border border-zinc-800 rounded-lg overflow-hidden flex-1">
                        <div className="flex-1 px-3 py-1.5 border-r border-zinc-800">
                            <span className="text-zinc-500 text-[10px]">队列</span>
                            <span className="ml-1.5 text-zinc-200 font-bold text-xs">{stats.total}</span>
                        </div>
                        <div className="flex-1 px-3 py-1.5 border-r border-amber-900/30 bg-amber-900/10">
                            <span className="text-amber-400 text-[10px]">待处理</span>
                            <span className="ml-1.5 text-amber-400 font-bold text-xs">{stats.idle}</span>
                        </div>
                        <div className="flex-1 px-3 py-1.5 border-r border-emerald-900/30 bg-emerald-900/10">
                            <span className="text-emerald-400 text-[10px]">成功</span>
                            <span className="ml-1.5 text-emerald-400 font-bold text-xs">{stats.success}</span>
                        </div>
                        <div className="flex-1 px-3 py-1.5 bg-red-900/10">
                            <span className="text-red-400 text-[10px]">失败</span>
                            <span className="ml-1.5 text-red-400 font-bold text-xs">{stats.error}</span>
                        </div>
                    </div>
                ) : (
                    <div className="flex-1" />
                )}

                {/* 操作按钮 */}
                <div className="flex items-center gap-2">
                    {items.length > 0 && (
                        <>
                            {/* 折叠/展开按钮 */}
                            <button
                                onClick={toggleAllCollapse}
                                className="flex items-center gap-1 px-2 py-1 text-zinc-400 hover:bg-zinc-800 border border-zinc-700 rounded text-[10px]"
                            >
                                {allCollapsed ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                                {allCollapsed ? '展开全部' : '收起全部'}
                            </button>
                            <button
                                onClick={handleClearAll}
                                className="flex items-center gap-1 px-2 py-1 text-red-400 hover:bg-red-900/20 border border-red-900/30 rounded text-[10px]"
                            >
                                <Trash2 size={12} /> 清空
                            </button>
                            <button
                                onClick={handleResetAll}
                                disabled={stats.success === 0 && stats.error === 0}
                                className="flex items-center gap-1 px-2 py-1 text-amber-400 hover:bg-amber-900/20 border border-amber-900/30 rounded text-[10px] disabled:opacity-50"
                            >
                                <RotateCw size={12} /> 重做全部
                            </button>
                            {stats.error > 0 && (
                                <button
                                    onClick={handleRetryAllErrors}
                                    className="flex items-center gap-1 px-2 py-1 text-red-400 hover:bg-red-900/20 border border-red-900/30 rounded text-[10px]"
                                >
                                    <RotateCw size={12} /> 重试失败 ({stats.error})
                                </button>
                            )}
                        </>
                    )}
                    {isProcessing ? (
                        <button
                            onClick={handleStopProcessing}
                            className="flex items-center gap-1 px-3 py-1.5 bg-red-600 hover:bg-red-500 text-white rounded text-xs font-medium"
                        >
                            <X size={14} /> 停止
                        </button>
                    ) : (
                        <button
                            onClick={handleStartProcessing}
                            disabled={stats.idle === 0 || !instructions.some(i => i.trim())}
                            className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 hover:bg-purple-500 text-white rounded text-xs font-medium disabled:opacity-50"
                        >
                            <Play size={14} /> 开始改写
                        </button>
                    )}
                </div>
            </div>

            {/* --- Results --- */}
            {items.length > 0 && (
                <div className="w-full max-w-none mx-auto flex-1">

                    {/* 复制按钮栏 */}
                    {stats.success > 0 && (
                        <div className="flex items-center gap-2 mb-4 flex-wrap">
                            <span className="text-xs text-zinc-500">批量复制:</span>
                            <button
                                onClick={() => handleCopy('foreign')}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedType === 'foreign'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                    }`}
                            >
                                {copiedType === 'foreign' ? <Check size={12} /> : <Copy size={12} />}
                                {mode === "voice" ? '加标签' : '外文'}
                            </button>
                            <button
                                onClick={() => handleCopy('chinese')}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedType === 'chinese'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                    }`}
                            >
                                {copiedType === 'chinese' ? <Check size={12} /> : <Copy size={12} />}
                                {mode === "voice" ? '断句' : '中文'}
                            </button>
                            <button
                                onClick={() => handleCopy('both')}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedType === 'both'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                    }`}
                            >
                                {copiedType === 'both' ? <Check size={12} /> : <Copy size={12} />}
                                {mode === "voice" ? '标签+断句' : '结果两列'}
                            </button>
                            <button
                                onClick={() => handleCopy('all')}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedType === 'all'
                                    ? 'bg-emerald-600 text-white'
                                    : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                    }`}
                            >
                                {copiedType === 'all' ? <Check size={12} /> : <Copy size={12} />}
                                全部四列
                            </button>

                            {/* 按指令复制 - 当有多指令结果时显示 */}
                            {instructions.filter(i => i.trim()).length > 0 && items.some(item => item.instructionResults && item.instructionResults.length > 0) && (
                                <>
                                    <span className="text-zinc-600">|</span>
                                    <span className="text-[10px] text-zinc-500">按指令:</span>
                                    {instructions.filter(i => i.trim()).map((_, instIdx) => (
                                        <button
                                            key={`copy_inst_${instIdx}`}
                                            onClick={() => {
                                                const allItems = items.filter(item => item.instructionResults && item.instructionResults.length > 0);
                                                const col1Name = mode === "voice" ? '加标签' : '外文';
                                                const col2Name = mode === "voice" ? '断句' : '中文';
                                                const headers = [`指令${instIdx + 1}${col1Name}`, `指令${instIdx + 1}${col2Name}`];
                                                const rows = allItems.map(item => {
                                                    const r = item.instructionResults![instIdx];
                                                    if (r?.status === 'success') {
                                                        return `${escapeForSheet(r.resultForeign)}\t${escapeForSheet(r.resultChinese)}`;
                                                    }
                                                    return '\t'; // 空占位
                                                });
                                                const text = [headers.join('\t'), ...rows].join('\n');
                                                navigator.clipboard.writeText(text);
                                                setCopiedType(`inst_${instIdx}`);
                                                showCopyToast(`已复制指令${instIdx + 1}结果 (${allItems.length}条)`);
                                                setTimeout(() => setCopiedType(null), 1500);
                                            }}
                                            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] transition-colors ${copiedType === `inst_${instIdx}`
                                                ? 'bg-purple-600 text-white'
                                                : 'bg-purple-900/30 hover:bg-purple-800/40 text-purple-300 border border-purple-700/30'
                                                }`}
                                        >
                                            {copiedType === `inst_${instIdx}` ? <Check size={10} /> : <Copy size={10} />}
                                            指令{instIdx + 1}
                                        </button>
                                    ))}
                                </>
                            )}

                            <div className="flex-1" />

                            <button
                                onClick={handleExport}
                                className="flex items-center gap-1 px-2.5 py-1 bg-purple-600/20 hover:bg-purple-600/30 text-purple-400 border border-purple-600/30 rounded text-xs transition-colors"
                            >
                                <Download size={12} />
                                导出 TSV
                            </button>
                        </div>
                    )}

                    {/* 结果列表 */}
                    <div className="space-y-3">
                        {items.map((item) => (
                            <div
                                key={item.id}
                                className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden"
                            >
                                {/* 折叠头部 - 始终显示 */}
                                <div
                                    className="px-3 py-2 bg-zinc-900 border-b border-zinc-800 flex items-center justify-between cursor-pointer hover:bg-zinc-800/50"
                                    onClick={() => toggleItemCollapse(item.id)}
                                >
                                    <div className="flex items-center gap-2 flex-1 min-w-0">
                                        <button className="text-zinc-400 hover:text-zinc-200">
                                            {item.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                                        </button>
                                        <span className="text-xs text-zinc-200 truncate flex-1">
                                            {item.originalForeign.slice(0, 80)}{item.originalForeign.length > 80 ? '...' : ''}
                                        </span>
                                        {/* 状态标签 */}
                                        {item.status === 'processing' && (
                                            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-amber-900/30 text-amber-400 text-[10px] rounded">
                                                <Loader2 size={10} className="animate-spin" /> 处理中
                                            </span>
                                        )}
                                        {item.status === 'success' && (
                                            <span className="flex items-center gap-1 px-1.5 py-0.5 bg-emerald-900/30 text-emerald-400 text-[10px] rounded">
                                                <Check size={10} /> 完成
                                                {(item.instructionResults?.length || 0) > 1 && (
                                                    <span className="text-emerald-300">({item.instructionResults?.length}步)</span>
                                                )}
                                            </span>
                                        )}
                                        {item.status === 'error' && (
                                            <span className="px-1.5 py-0.5 bg-red-900/30 text-red-400 text-[10px] rounded">错误</span>
                                        )}
                                        {item.status === 'idle' && (
                                            <span className="px-1.5 py-0.5 bg-zinc-800 text-zinc-400 text-[10px] rounded">待处理</span>
                                        )}
                                    </div>
                                </div>

                                {/* 折叠内容 */}
                                {!item.collapsed && (
                                    <>
                                        {/* 横向表格布局 - 类似谷歌表格，可水平滚动 */}
                                        <div className="overflow-x-auto">
                                            <div
                                                className="grid gap-px bg-zinc-800"
                                                style={{
                                                    gridTemplateColumns: (() => {
                                                        const colCount = 2 + (item.instructionResults?.length || 1) * 2;
                                                        // 少于等于4列时平分宽度，超过4列时固定宽度可滚动
                                                        if (colCount <= 4) {
                                                            return `repeat(${colCount}, 1fr)`;
                                                        } else {
                                                            return `repeat(${colCount}, minmax(280px, 1fr))`;
                                                        }
                                                    })()
                                                }}
                                            >
                                                {/* 原始外文 */}
                                                <div className="bg-zinc-950 p-3">
                                                    <div className="text-[10px] text-zinc-500 mb-1">
                                                        原始外文
                                                        {showDiff && item.status === 'success' && item.resultForeign && (
                                                            <span className="ml-2 text-amber-500">（差异高亮）</span>
                                                        )}
                                                    </div>
                                                    <div className="text-sm text-zinc-300 whitespace-pre-wrap break-words">
                                                        {showDiff && item.status === 'success' && item.resultForeign
                                                            ? computeWordDiff(item.originalForeign, item.resultForeign).originalWithDiff
                                                            : item.originalForeign
                                                        }
                                                    </div>
                                                </div>

                                                {/* 原始中文 */}
                                                <div className="bg-zinc-950 p-3">
                                                    <div className="text-[10px] text-zinc-500 mb-1">原始中文</div>
                                                    <div className="text-sm text-zinc-400 whitespace-pre-wrap break-words">
                                                        {item.originalChinese || <span className="italic text-zinc-600">-</span>}
                                                    </div>
                                                </div>

                                                {/* 各指令结果列 */}
                                                {item.instructionResults?.map((result, idx) => (
                                                    <React.Fragment key={result.id}>
                                                        {/* 指令N - 外文/加标签/分类结果列 */}
                                                        <div className={`bg-zinc-950 border-l-2 ${mode === "classify" ? 'border-yellow-500/50' : 'border-purple-500/50'} flex flex-col`}>
                                                            {/* 标签行 */}
                                                            <div className="px-3 py-1 bg-zinc-800/50 flex items-center justify-between border-b border-zinc-700/50">
                                                                <span className={`text-[10px] ${mode === "classify" ? 'text-yellow-400' : 'text-purple-400'} font-medium`}>
                                                                    {mode === "classify" ? `分类结果 ${idx + 1}` : `指令${idx + 1} ${mode === "voice" ? '加标签' : '外文'}`}
                                                                </span>
                                                                {result.status === 'success' && (
                                                                    <div className="flex items-center gap-1">
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(result.resultForeign); showCopyToast(mode === "classify" ? `已复制分类结果${idx + 1}` : `已复制指令${idx + 1}${mode === "voice" ? '加标签' : '外文'}`); }}
                                                                            className={`px-1 py-0.5 text-[9px] ${mode === "classify" ? 'text-yellow-400 hover:bg-yellow-900/30' : 'text-purple-400 hover:bg-purple-900/30'} rounded`}
                                                                            title={mode === "classify" ? '复制分类结果' : (mode === "voice" ? '复制加标签结果' : '复制外文')}
                                                                        >{mode === "classify" ? '分' : (mode === "voice" ? '标' : '外')}</button>
                                                                        {mode !== "classify" && (
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(`${result.resultForeign}\t${result.resultChinese}`); showCopyToast(`已复制指令${idx + 1}${mode === "voice" ? '标签+断句' : '外文+中文'}`); }}
                                                                                className="px-1 py-0.5 text-[9px] text-emerald-400 hover:bg-emerald-900/30 rounded"
                                                                                title={mode === "voice" ? '复制标签+断句' : '复制外文+中文'}
                                                                            >全</button>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            {/* 内容行 */}
                                                            <div className="px-3 py-2 flex-1">
                                                                {result.status === 'processing' ? (
                                                                    <div className="flex items-center gap-2 text-amber-400 text-sm">
                                                                        <Loader2 size={14} className="animate-spin" />
                                                                        处理中...
                                                                    </div>
                                                                ) : result.status === 'success' ? (
                                                                    <div className={`text-sm ${mode === "classify" ? 'text-yellow-100' : 'text-purple-100'} whitespace-pre-wrap break-words`}>
                                                                        {mode === "classify" ? result.resultForeign : highlightDiff(result.inputForeign, result.resultForeign)}
                                                                    </div>
                                                                ) : result.status === 'error' ? (
                                                                    <div className="text-sm text-red-400">{result.error || '失败'}</div>
                                                                ) : (
                                                                    <div className="text-sm text-zinc-600">-</div>
                                                                )}
                                                            </div>
                                                        </div>
                                                        {/* 指令N - 中文/断句列 - 分类模式不显示 */}
                                                        {mode !== "classify" && (
                                                            <div className="bg-zinc-950 flex flex-col">
                                                                {/* 标签行：指令N 中文/断句 + 复制按钮 */}
                                                                <div className="px-3 py-1 bg-zinc-800/50 flex items-center justify-between border-b border-zinc-700/50">
                                                                    <span className={`text-[10px] ${mode === "voice" ? 'text-cyan-400' : 'text-blue-400'} font-medium`}>
                                                                        指令{idx + 1} {mode === "voice" ? '断句' : '中文'}
                                                                    </span>
                                                                    {result.status === 'success' && (
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(result.resultChinese); showCopyToast(`已复制指令${idx + 1}${mode === "voice" ? '断句' : '中文'}`); }}
                                                                            className={`px-1 py-0.5 text-[9px] ${mode === "voice" ? 'text-cyan-400 hover:bg-cyan-900/30' : 'text-blue-400 hover:bg-blue-900/30'} rounded`}
                                                                            title={mode === "voice" ? '复制断句结果' : '复制中文'}
                                                                        >{mode === "voice" ? '断' : '中'}</button>
                                                                    )}
                                                                </div>
                                                                {/* 内容行 */}
                                                                <div className="px-3 py-2 flex-1">
                                                                    {result.status === 'processing' ? (
                                                                        <div className="flex items-center gap-2 text-amber-400 text-sm">
                                                                            <Loader2 size={14} className="animate-spin" />
                                                                            处理中...
                                                                        </div>
                                                                    ) : result.status === 'success' ? (
                                                                        <div className="text-sm text-blue-100 whitespace-pre-wrap break-words">
                                                                            {result.resultChinese}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-sm text-zinc-600">-</div>
                                                                    )}
                                                                </div>
                                                                {/* 指令操作栏：重试、对话 */}
                                                                <div className="px-2 py-1 bg-zinc-900/50 border-t border-zinc-700/30 flex items-center gap-1 justify-end">
                                                                    {(result.status === 'error' || result.status === 'success') && (
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); handleRetryInstruction(item.id, idx); }}
                                                                            className="p-1 text-amber-400 hover:bg-amber-900/20 rounded transition-colors"
                                                                            title="重试该指令"
                                                                        >
                                                                            <RotateCw size={12} />
                                                                        </button>
                                                                    )}
                                                                    {result.status === 'success' && (
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); toggleInstructionChat(item.id, idx); }}
                                                                            className={`p-1 rounded transition-colors ${result.chatOpen ? 'text-amber-400 bg-amber-900/20' : 'text-zinc-500 hover:text-amber-400'}`}
                                                                            title="对话修改"
                                                                        >
                                                                            <MessageSquare size={12} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                {/* 指令对话面板 */}
                                                                {result.chatOpen && (
                                                                    <div className="px-2 py-2 bg-zinc-900 border-t border-amber-600/30">
                                                                        {/* 对话历史 */}
                                                                        {result.chatHistory && result.chatHistory.length > 0 && (
                                                                            <div className="max-h-32 overflow-y-auto mb-2 space-y-1">
                                                                                {result.chatHistory.map(msg => (
                                                                                    <div key={msg.id} className={`text-[10px] px-2 py-1 rounded ${msg.role === 'user' ? 'bg-blue-900/30 text-blue-200' : 'bg-zinc-800 text-zinc-300'}`}>
                                                                                        {msg.text}
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        )}
                                                                        {/* 输入框 */}
                                                                        <div className="flex gap-1">
                                                                            <input
                                                                                type="text"
                                                                                value={result.chatInput || ''}
                                                                                onChange={(e) => updateInstructionChatInput(item.id, idx, e.target.value)}
                                                                                onKeyDown={(e) => { if (e.key === 'Enter') handleInstructionChatSend(item.id, idx); }}
                                                                                placeholder="输入修改要求..."
                                                                                className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-2 py-1 text-[10px] text-zinc-200 focus:outline-none focus:border-amber-500"
                                                                                onClick={(e) => e.stopPropagation()}
                                                                            />
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); handleInstructionChatSend(item.id, idx); }}
                                                                                disabled={result.chatLoading || !result.chatInput?.trim()}
                                                                                className="px-2 py-1 bg-amber-600 hover:bg-amber-500 text-white rounded text-[10px] disabled:opacity-50"
                                                                            >
                                                                                {result.chatLoading ? <Loader2 size={10} className="animate-spin" /> : '发送'}
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                )}
                                                            </div>
                                                        )}
                                                    </React.Fragment>
                                                ))}

                                                {/* 如果没有指令结果，显示默认的改写后列 */}
                                                {(!item.instructionResults || item.instructionResults.length === 0) && (
                                                    <>
                                                        {/* 改写后外文 / 加标签结果 */}
                                                        <div className="bg-zinc-950 p-3">
                                                            <div className={`text-[10px] ${mode === "voice" ? 'text-purple-500' : 'text-emerald-500'} mb-1`}>
                                                                {mode === "voice" ? '加标签结果' : '改写后外文'}
                                                            </div>
                                                            {item.status === 'processing' && (
                                                                <div className="flex items-center gap-2 text-amber-400 text-sm">
                                                                    <Loader2 size={14} className="animate-spin" />
                                                                    处理中...
                                                                </div>
                                                            )}
                                                            {item.status === 'success' && (
                                                                <div className={`text-sm ${mode === "voice" ? 'text-purple-100' : 'text-emerald-100'} whitespace-pre-wrap break-words`}>
                                                                    {showDiff && mode === 'standard' && item.resultForeign
                                                                        ? computeWordDiff(item.originalForeign, item.resultForeign).resultWithDiff
                                                                        : item.resultForeign
                                                                    }
                                                                </div>
                                                            )}
                                                            {item.status === 'error' && (
                                                                <div className="text-sm text-red-400">错误: {item.error}</div>
                                                            )}
                                                            {item.status === 'idle' && (
                                                                <div className="text-sm text-zinc-600 italic">待处理</div>
                                                            )}
                                                        </div>
                                                        {/* 改写后中文 / 断句结果 */}
                                                        <div className="bg-zinc-950 p-3">
                                                            <div className={`text-[10px] ${mode === "voice" ? 'text-cyan-500' : 'text-blue-500'} mb-1`}>
                                                                {mode === "voice" ? '断句结果' : '改写后中文'}
                                                            </div>
                                                            {item.status === 'success' ? (
                                                                <div className={`text-sm ${mode === "voice" ? 'text-cyan-100' : 'text-blue-100'} whitespace-pre-wrap break-words`}>
                                                                    {item.resultChinese}
                                                                </div>
                                                            ) : (
                                                                <div className="text-sm text-zinc-600 italic">-</div>
                                                            )}
                                                        </div>
                                                    </>
                                                )}
                                            </div>
                                        </div>
                                        {/* 单条复制按钮栏 */}
                                        {item.instructionResults && item.instructionResults.length > 0 && (
                                            <div className="px-3 py-1.5 bg-zinc-900/50 border-t border-zinc-800 flex items-center gap-2 flex-wrap">
                                                <span className="text-[10px] text-zinc-500">本条复制：</span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const results = item.instructionResults!;
                                                        const col1Name = mode === "voice" ? '加标签' : '外文';
                                                        const headers = results.map((_, i) => `指令${i + 1}${col1Name}`);
                                                        const values = results.map(r => r.status === 'success' ? escapeForSheet(r.resultForeign) : '');
                                                        navigator.clipboard.writeText(`${headers.join('\t')}\n${values.join('\t')}`);
                                                        showCopyToast(mode === "voice" ? '已复制加标签' : '已复制外文');
                                                    }}
                                                    className="px-1.5 py-0.5 bg-purple-900/30 hover:bg-purple-800/40 text-purple-300 text-[10px] rounded"
                                                >
                                                    {mode === "voice" ? '只标签' : '只外文'}
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const results = item.instructionResults!;
                                                        const col2Name = mode === "voice" ? '断句' : '中文';
                                                        const headers = results.map((_, i) => `指令${i + 1}${col2Name}`);
                                                        const values = results.map(r => r.status === 'success' ? escapeForSheet(r.resultChinese) : '');
                                                        navigator.clipboard.writeText(`${headers.join('\t')}\n${values.join('\t')}`);
                                                        showCopyToast(mode === "voice" ? '已复制断句' : '已复制中文');
                                                    }}
                                                    className={`px-1.5 py-0.5 ${mode === "voice" ? 'bg-cyan-900/30 hover:bg-cyan-800/40 text-cyan-300' : 'bg-blue-900/30 hover:bg-blue-800/40 text-blue-300'} text-[10px] rounded`}
                                                >
                                                    {mode === "voice" ? '只断句' : '只中文'}
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const results = item.instructionResults!;
                                                        const col1Name = mode === "voice" ? '加标签' : '外文';
                                                        const col2Name = mode === "voice" ? '断句' : '中文';
                                                        const headers = results.flatMap((_, i) => [`指令${i + 1}${col1Name}`, `指令${i + 1}${col2Name}`]);
                                                        const values = results.flatMap(r => r.status === 'success' ? [escapeForSheet(r.resultForeign), escapeForSheet(r.resultChinese)] : ['', '']);
                                                        navigator.clipboard.writeText(`${headers.join('\t')}\n${values.join('\t')}`);
                                                        showCopyToast(mode === "voice" ? '已复制标签+断句' : '已复制外文+中文');
                                                    }}
                                                    className="px-1.5 py-0.5 bg-emerald-900/30 hover:bg-emerald-800/40 text-emerald-300 text-[10px] rounded"
                                                >
                                                    {mode === "voice" ? '标签+断句' : '外文+中文'}
                                                </button>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const results = item.instructionResults!;
                                                        const col1Name = mode === "voice" ? '加标签' : '外文';
                                                        const col2Name = mode === "voice" ? '断句' : '中文';
                                                        const headers = [mode === "voice" ? '原文' : '原始外文', mode === "voice" ? '原中文' : '原始中文', ...results.flatMap((_, i) => [`指令${i + 1}${col1Name}`, `指令${i + 1}${col2Name}`])];
                                                        const values = [escapeForSheet(item.originalForeign), escapeForSheet(item.originalChinese || ''), ...results.flatMap(r => r.status === 'success' ? [escapeForSheet(r.resultForeign), escapeForSheet(r.resultChinese)] : ['', ''])];
                                                        navigator.clipboard.writeText(`${headers.join('\t')}\n${values.join('\t')}`);
                                                        showCopyToast('已复制完整内容(含表头)');
                                                    }}
                                                    className="px-1.5 py-0.5 bg-amber-900/30 hover:bg-amber-800/40 text-amber-300 text-[10px] rounded"
                                                >
                                                    完整
                                                </button>
                                            </div>
                                        )}
                                    </>
                                )}

                                {/* 操作栏 */}
                                <div className="px-3 py-1.5 bg-zinc-900 border-t border-zinc-800 flex items-center gap-2 flex-wrap">
                                    {/* 操作按钮 */}
                                    <div className="flex items-center gap-1">
                                        {/* 设置按钮（点击展开单条设置面板） */}
                                        <button
                                            onClick={() => toggleItemSettings(item.id)}
                                            className={`p-1.5 rounded transition-colors ${item.showSettings
                                                ? 'text-purple-400 bg-purple-500/10'
                                                : 'text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800'
                                                }`}
                                            title="单条设置"
                                        >
                                            <Settings2 size={14} />
                                        </button>

                                        {/* 单条处理 (仅idle状态) */}
                                        {item.status === 'idle' && (
                                            <button
                                                onClick={() => handleProcessSingleItem(item)}
                                                className="p-1.5 text-purple-400 hover:bg-purple-900/20 rounded transition-colors"
                                                title="单条处理"
                                            >
                                                <Play size={14} />
                                            </button>
                                        )}

                                        {/* 删除 */}
                                        <button
                                            onClick={() => handleDeleteItem(item.id)}
                                            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                                            title="删除"
                                        >
                                            <X size={14} />
                                        </button>
                                    </div>

                                    {/* 状态提示 */}
                                    <div className="flex-1 text-right">
                                        {item.customInstruction && (
                                            <span className="text-[10px] text-purple-400">使用单条指令</span>
                                        )}
                                    </div>
                                </div>

                                {/* 单条设置面板 */}
                                {item.showSettings && (
                                    <div className="px-3 py-2 bg-purple-900/10 border-t border-purple-500/10 text-xs">
                                        <div className="flex flex-col gap-2">
                                            <div className="flex flex-col gap-1">
                                                <label className="text-zinc-400 font-medium">自定义改写指令 (留空则使用全局设置)</label>
                                                <textarea
                                                    className="w-full bg-zinc-900 border border-zinc-700 rounded p-2 text-zinc-200 focus:border-purple-500 focus:outline-none resize-none h-16"
                                                    value={item.customInstruction || ''}
                                                    onChange={(e) => updateItemSettings(item.id, { customInstruction: e.target.value })}
                                                    placeholder={`全局指令: ${instruction || '(空)'}`}
                                                />
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {/* 对话区域 */}
                                {item.chatOpen && (
                                    <div className="px-3 py-3 bg-zinc-900/50 border-t border-zinc-800">
                                        {/* 对话历史 */}
                                        <div className="mb-2 max-h-48 overflow-y-auto space-y-2">
                                            {(item.chatHistory?.length || 0) === 0 ? (
                                                <div className="text-xs text-zinc-500 italic text-center py-2">
                                                    开始对话，继续优化此条文案
                                                </div>
                                            ) : (
                                                item.chatHistory?.map(msg => (
                                                    <div
                                                        key={msg.id}
                                                        className={`p-2 rounded text-xs ${msg.role === 'user'
                                                            ? 'bg-blue-900/20 text-blue-200 ml-8'
                                                            : 'bg-zinc-800 text-zinc-200 mr-8'
                                                            }`}
                                                    >
                                                        {msg.text}
                                                    </div>
                                                ))
                                            )}
                                            {item.chatLoading && (
                                                <div className="flex items-center gap-2 text-amber-400 text-xs p-2 bg-zinc-800 rounded mr-8">
                                                    <Loader2 size={12} className="animate-spin" />
                                                    思考中...
                                                </div>
                                            )}
                                        </div>

                                        {/* 对话输入 */}
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="text"
                                                value={item.chatInput || ''}
                                                onChange={(e) => updateItemSettings(item.id, { chatInput: e.target.value })}
                                                placeholder="输入修改要求，按回车发送..."
                                                className="flex-1 px-3 py-2 bg-zinc-950 border border-zinc-700 rounded text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        handleChatSend(item);
                                                    }
                                                }}
                                                disabled={item.chatLoading}
                                            />
                                            <button
                                                onClick={() => handleChatSend(item)}
                                                disabled={!item.chatInput?.trim() || item.chatLoading}
                                                className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm disabled:opacity-50"
                                            >
                                                发送
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            )}

            {/* 空状态 */}
            {items.length === 0 && (
                <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 border-2 border-dashed border-zinc-800 rounded-xl bg-zinc-900/30 min-h-[300px]">
                    <FileText size={48} className="mb-4 opacity-20" />
                    <p className="text-sm">添加文案开始批量改写</p>
                    <p className="text-xs text-zinc-700 mt-2">支持从表格复制粘贴（外文 + 中文参照两列）</p>
                </div>
            )}

            {/* === 预览指令弹框 === */}
            {showPreview && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-4" onClick={() => setShowPreview(false)}>
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[80vh]" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between p-4 border-b border-zinc-800">
                            <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                <Eye size={20} className={mode === "voice" ? "text-purple-400" : mode === "classify" ? "text-cyan-400" : "text-purple-400"} />
                                {mode === "voice" ? '🎙️ 人声文案模式 - 指令预览' : mode === "classify" ? '🏷️ 分类模式 - 指令预览' : '最终指令预览'}
                            </h3>
                            <button onClick={() => setShowPreview(false)} className="text-zinc-500 hover:text-white">
                                <X size={20} />
                            </button>
                        </div>
                        <div className="p-4 overflow-y-auto bg-zinc-950/50 space-y-4">
                            <p className="text-xs text-zinc-500">
                                {mode === "voice"
                                    ? '以下是人声文案模式的 Prompt 结构（专为 ElevenLabs 配音优化）：'
                                    : mode === "classify"
                                        ? '以下是分类模式的 Prompt 结构（只输出分类结果，无需翻译）：'
                                        : '以下是发送给 AI 的完整 Prompt 结构（如果修改结果不满意可以修改这里的指令）：'
                                }
                            </p>

                            {/* 系统指令 - 可编辑 */}
                            <div className={`bg-black/30 p-4 rounded-lg border ${mode === "voice" ? 'border-purple-900/30' : mode === "classify" ? 'border-cyan-900/30' : 'border-blue-900/30'}`}>
                                <div className={`${mode === "voice" ? 'text-purple-400' : mode === "classify" ? 'text-cyan-400' : 'text-blue-400'} font-medium mb-2 text-sm flex items-center gap-2`}>
                                    {mode === "voice" ? '🎙️ 人声文案系统指令' : mode === "classify" ? '🏷️ 分类模式系统指令' : '📝 系统固定默认指令'}
                                    <span className="text-zinc-500 text-xs font-normal">（可直接编辑）</span>
                                    {mode === "voice" && (
                                        <button
                                            onClick={() => setVoiceModeSystemInstruction(VOICE_MODE_SYSTEM_INSTRUCTION)}
                                            className="text-[10px] text-purple-400/60 hover:text-purple-400 px-1.5 py-0.5 rounded bg-purple-900/20 hover:bg-purple-900/40 transition-colors"
                                        >
                                            重置默认
                                        </button>
                                    )}
                                    {mode === "classify" && (
                                        <button
                                            onClick={() => setClassifyModeSystemInstruction(CLASSIFY_MODE_SYSTEM_INSTRUCTION)}
                                            className="text-[10px] text-cyan-400/60 hover:text-cyan-400 px-1.5 py-0.5 rounded bg-cyan-900/20 hover:bg-cyan-900/40 transition-colors"
                                        >
                                            重置默认
                                        </button>
                                    )}
                                </div>
                                <textarea
                                    value={mode === "voice" ? voiceModeSystemInstruction : mode === "classify" ? classifyModeSystemInstruction : systemInstruction}
                                    onChange={(e) => {
                                        if (mode === "voice") {
                                            setVoiceModeSystemInstruction(e.target.value);
                                        } else if (mode === "classify") {
                                            setClassifyModeSystemInstruction(e.target.value);
                                        } else {
                                            setSystemInstruction(e.target.value);
                                        }
                                    }}
                                    placeholder={mode === "voice" ? VOICE_MODE_SYSTEM_INSTRUCTION : mode === "classify" ? CLASSIFY_MODE_SYSTEM_INSTRUCTION : DEFAULT_SYSTEM_INSTRUCTION}
                                    className={`w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-300 focus:outline-none resize-none h-48 placeholder-zinc-600 ${mode === "voice" ? 'focus:border-purple-500' : mode === "classify" ? 'focus:border-cyan-500' : 'focus:border-blue-500'}`}
                                />
                            </div>

                            {/* 用户指令列表 - 可编辑 */}
                            <div className={`bg-black/30 p-4 rounded-lg border ${mode === "voice" ? 'border-cyan-900/30' : mode === "classify" ? 'border-yellow-900/30' : 'border-emerald-900/30'}`}>
                                <div className={`${mode === "voice" ? 'text-cyan-400' : mode === "classify" ? 'text-yellow-400' : 'text-emerald-400'} font-medium mb-2 text-sm flex items-center gap-2`}>
                                    {mode === "classify" ? '🏷️ 分类规则' : '🎯 用户指令列表'}
                                    <span className="text-zinc-500 text-xs font-normal">（{instructions.filter(i => i.trim()).length}条指令，独立执行）</span>
                                </div>
                                <div className="space-y-2 max-h-60 overflow-y-auto overflow-x-hidden">
                                    {instructions.map((inst, idx) => (
                                        <div key={idx} className="flex items-start gap-2">
                                            <span className={`text-[10px] ${mode === "voice" ? 'text-cyan-400' : mode === "classify" ? 'text-yellow-400' : 'text-emerald-400'} w-4 mt-2`}>{idx + 1}.</span>
                                            <textarea
                                                value={inst}
                                                onChange={(e) => updateInstruction(idx, e.target.value)}
                                                placeholder={mode === "classify" ? "输入分类规则..." : "输入改写指令..."}
                                                className={`flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-sm text-zinc-200 focus:outline-none placeholder-zinc-600 resize-none min-h-[60px] ${mode === "voice" ? 'focus:border-cyan-500' : mode === "classify" ? 'focus:border-yellow-500' : 'focus:border-emerald-500'}`}
                                                rows={2}
                                            />
                                            {instructions.length > 1 && (
                                                <button onClick={() => removeInstruction(idx)} className="text-zinc-500 hover:text-red-400 mt-2">
                                                    <X size={14} />
                                                </button>
                                            )}
                                        </div>
                                    ))}
                                    <button
                                        onClick={addInstruction}
                                        className={`flex items-center gap-1 px-2 py-1 text-xs ${mode === "voice" ? 'text-cyan-400 hover:bg-cyan-900/20 border-cyan-900/30' : mode === "classify" ? 'text-yellow-400 hover:bg-yellow-900/20 border-yellow-900/30' : 'text-emerald-400 hover:bg-emerald-900/20 border-emerald-900/30'} rounded border`}
                                    >
                                        <Plus size={12} /> 添加指令
                                    </button>
                                </div>
                            </div>

                            {/* 输出格式 - 锁定 */}
                            <div className="bg-black/30 p-4 rounded-lg border border-zinc-800 opacity-60">
                                <div className="text-zinc-500 font-medium mb-2 text-sm flex items-center gap-2">
                                    🔒 输出格式（固定，不可修改）
                                </div>
                                <div className="text-zinc-600 text-xs font-mono">
                                    {mode === "voice"
                                        ? '加标签结果|||断句结果'
                                        : mode === "classify"
                                            ? '分类结果（仅输出分类名称，无需翻译）'
                                            : '改写后的外文|||中文翻译'
                                    }
                                </div>
                                {mode === "voice" && (
                                    <p className="text-[10px] text-zinc-500 mt-2">
                                        第一列：带情感标签的文案（用于 ElevenLabs）<br />
                                        第二列：合理断行的纯文本（用于字幕显示）
                                    </p>
                                )}
                                {mode === "classify" && (
                                    <p className="text-[10px] text-zinc-500 mt-2">
                                        AI 将根据您的分类规则，只输出分类结果。<br />
                                        适合大批量数据分类，比如小组名称归类、内容审核等。
                                    </p>
                                )}
                            </div>
                        </div>
                        <div className="p-4 border-t border-zinc-800 flex justify-end gap-2">
                            <button
                                onClick={() => setShowPreview(false)}
                                className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-white rounded-lg text-sm transition-colors"
                            >
                                关闭
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 双击编辑指令弹框 */}
            {editingInstructionIndex !== null && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl mx-4 shadow-2xl">
                        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                            <div className="text-amber-400 font-medium flex items-center gap-2">
                                ✏️ 编辑指令 {editingInstructionIndex + 1}
                            </div>
                            <button
                                onClick={() => setEditingInstructionIndex(null)}
                                className="text-zinc-500 hover:text-zinc-300"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-4">
                            <textarea
                                value={instructions[editingInstructionIndex] || ''}
                                onChange={(e) => updateInstruction(editingInstructionIndex, e.target.value)}
                                placeholder="在此输入完整的改写指令..."
                                className="w-full h-48 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-amber-500 placeholder-zinc-600 resize-none"
                                autoFocus
                            />
                            <div className="mt-3 text-[10px] text-zinc-500">
                                提示：在这里可以完整查看和编辑指令内容。关闭弹框后自动保存。
                            </div>
                        </div>
                        <div className="p-4 border-t border-zinc-800 flex justify-between">
                            {/* 预设快速填充 */}
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] text-zinc-500">快速填充：</span>
                                {BUILTIN_PRESETS.slice(0, 4).map(preset => (
                                    <button
                                        key={preset.id}
                                        onClick={() => updateInstruction(editingInstructionIndex, preset.instruction)}
                                        className="px-2 py-1 bg-zinc-800 hover:bg-amber-900/30 text-[10px] text-amber-300 rounded border border-zinc-700"
                                    >
                                        {preset.name}
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={() => setEditingInstructionIndex(null)}
                                className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-lg text-sm font-medium"
                            >
                                确定
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 保存预设 Modal */}
            {showSavePreset && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50" onClick={() => setShowSavePreset(false)}>
                    <div className="bg-zinc-900 border border-amber-600/50 rounded-xl p-4 max-w-md w-full mx-4" onClick={(e) => e.stopPropagation()}>
                        <h3 className="text-amber-400 text-sm font-medium mb-3">保存预设</h3>
                        <div className="mb-3">
                            <label className="text-[10px] text-zinc-500 mb-1 block">预设名称</label>
                            <input
                                type="text"
                                value={newPresetName}
                                onChange={(e) => setNewPresetName(e.target.value)}
                                className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-amber-500"
                                placeholder="输入预设名称..."
                                autoFocus
                                onKeyDown={(e) => { if (e.key === 'Enter') confirmSavePreset(); }}
                            />
                        </div>
                        <div className="mb-3">
                            <label className="text-[10px] text-zinc-500 mb-1 block">指令内容预览</label>
                            <div className="bg-zinc-950 border border-zinc-800 rounded p-2 text-xs text-zinc-400 max-h-24 overflow-y-auto">
                                {instructions.find(i => i.trim()) || '无'}
                            </div>
                        </div>
                        <div className="flex gap-2 justify-end">
                            <button
                                onClick={() => setShowSavePreset(false)}
                                className="px-3 py-1.5 text-zinc-400 hover:text-zinc-200 text-sm"
                            >
                                取消
                            </button>
                            <button
                                onClick={confirmSavePreset}
                                disabled={!newPresetName.trim()}
                                className="px-4 py-1.5 bg-amber-600 hover:bg-amber-500 text-white rounded text-sm disabled:opacity-50"
                            >
                                保存
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 复制提示Toast */}
            {copyToast && (
                <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-emerald-600 text-white rounded-lg shadow-lg text-sm flex items-center gap-2 animate-pulse">
                    <Check size={16} />
                    {copyToast}
                </div>
            )}

            {/* 预设管理器 */}
            <PresetManager
                isOpen={showPresetManager}
                onClose={() => setShowPresetManager(false)}
                presets={presets}
                builtinPresets={BUILTIN_PRESETS}
                onPresetsChange={(newPresets) => {
                    setPresets(newPresets);
                    savePresetsToFirebase(newPresets);
                }}
                onSelectPreset={(preset) => {
                    // 填充到第一个空指令槽，或替换第一个
                    const emptyIdx = instructions.findIndex(i => !i.trim());
                    if (emptyIdx >= 0) {
                        const newInstructions = [...instructions];
                        newInstructions[emptyIdx] = preset.instruction;
                        setInstructions(newInstructions);
                    } else {
                        setInstructions([preset.instruction, ...instructions.slice(1)]);
                    }
                    showCopyToast(`已应用预设: ${preset.name}`);
                }}
            />
        </div>
    );
}
