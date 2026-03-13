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

import React, { useState, useEffect, useRef, useMemo } from 'react';
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
    Lightbulb,
    Scissors,
    Columns,
    Library,
    Share2
} from 'lucide-react';
import { PresetManager, CopywritingPreset as PresetType } from './PresetManager';
import {
    appendToSheet,
    getSheetsSyncConfig
} from '@/services/sheetsSyncService';

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

// 拆分列定义
interface SplitColumn {
    id: string;
    name: string;        // 列名：如 "钩子"、"正文"、"互动语"
    description: string; // 提取要求：如 "开头吸引注意力的句子"
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
    // 拆分结果
    splitResults?: Record<string, string>; // columnId -> 提取的内容
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
    // 文案库匹配结果
    libraryMatchedId?: string;
    libraryMatchedContent?: string;
    // 文案库：单条指定用哪些库（空=用全局启用的）
    selectedLibraryIds?: string[];
    // 多选
    selected?: boolean;
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
    promptTabId?: string;
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
const DEFAULT_LIBRARY_INSTRUCTION = '根据文案内容选择合适的互动语，并替换/添加到文案末尾';
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
- 每行不超过 4 个单词，便于字幕显示
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
type CopywritingMode = 'standard' | 'voice' | 'classify' | 'split' | 'library' | 'social-media';

type CopywritingModeDraft = {
    instruction: string;
    instructions: string[];
    splitColumns?: SplitColumn[];
    libraryInstruction?: string;
};

type CopywritingModeDrafts = Record<CopywritingMode, CopywritingModeDraft>;

type CopywritingViewSnapshot = {
    items: CopywritingItem[];
    bulkInput: string;
    instruction: string;
    instructions: string[];
    selectedPresetId: string | null;
    systemInstruction: string;
    allCollapsed: boolean;
    mode: CopywritingMode;
    voiceModeSystemInstruction: string;
    classifyModeSystemInstruction: string;
    splitModeSystemInstruction: string;
    socialMediaModeSystemInstruction?: string;
    socialMediaOutputSections?: SocialMediaOutputSection[];
    socialMediaResultCount?: number;
    splitColumns: SplitColumn[];
    keywordFreqMap: Record<string, number>;
    keywordStatsColumnId: string | null;
    keywordStatsTotalItems: number;
    showDiff: boolean;
    batchSize: number;
    libraryInstruction: string;
    modeDrafts: CopywritingModeDrafts;
};

// === 文案库模式 ===
interface LibraryItem {
    id: string;
    content: string;
    weight: number;
    tags: string;
    usedCount: number; // 运行时已用次数
}

interface CopywritingLibrary {
    id: string;
    name: string;
    matchRule: string; // AI判断规则描述
    maxRepeat: number; // 同一条最多用几次
    items: LibraryItem[];
    enabled: boolean;
    color: string;
    group?: string; // 所属分页名（总库子库才有）
}

const LIB_COLORS = ['#4ade80', '#22d3ee', '#f472b6', '#fb923c', '#facc15', '#818cf8', '#c084fc', '#f87171'];

const DEFAULT_LIBRARY: CopywritingLibrary = {
    id: 'default_lib',
    name: '互动语库',
    matchRule: '根据文案的主题和语气，选择最匹配的互动引导语。优先选择剩余次数多的、优先级高的条目。',
    maxRepeat: 3,
    enabled: true,
    color: LIB_COLORS[0],
    items: [
        { id: 'lib1', content: 'Type Amen if you believe 🙏', weight: 10, tags: '信仰,认同', usedCount: 0 },
        { id: 'lib2', content: 'Share this with someone who needs it ❤️', weight: 5, tags: '分享,关怀', usedCount: 0 },
        { id: 'lib3', content: 'Comment your favorite verse below 👇', weight: 5, tags: '评论,经文', usedCount: 0 },
        { id: 'lib4', content: 'Double tap if this speaks to you 🙌', weight: 7, tags: '点赞,共鸣', usedCount: 0 },
    ]
};

// Google Sheets 导入工具
const extractSheetId = (url: string): string | null => {
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
};

const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (ch === '"') {
            if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
            else { inQuotes = !inQuotes; }
        } else if (ch === ',' && !inQuotes) {
            result.push(current); current = '';
        } else { current += ch; }
    }
    result.push(current);
    return result.map(v => v.trim().replace(/^"|"$/g, ''));
};

const importLibrariesFromSheets = async (url: string): Promise<CopywritingLibrary[]> => {
    const spreadsheetId = extractSheetId(url);
    if (!spreadsheetId) throw new Error('无效的 Google Sheets 链接');

    // === 第1步：发现所有分页名 ===
    let sheetEntries: { name: string; matchRule: string }[] = [];

    // 方法1：尝试读取目录分页（A列=分页名，B列=使用指令）
    const catalogNames = ['分页目录', '随机总库目录', '目录', '库列表', 'catalog', 'index'];
    for (const catName of catalogNames) {
        try {
            const catUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(catName)}`;
            const resp = await fetch(catUrl);
            if (!resp.ok) continue;
            const csv = await resp.text();
            const lines = csv.split('\n').filter(l => l.trim());
            if (lines.length >= 2) {
                sheetEntries = lines.slice(1).map(l => {
                    const cols = parseCSVLine(l);
                    return { name: cols[0]?.trim() || '', matchRule: cols[1]?.trim() || '' };
                }).filter(e => e.name);
                console.log(`[importLibrariesFromSheets] 从目录"${catName}"读取到 ${sheetEntries.length} 个分页`);
                break;
            }
        } catch { continue; }
    }

    // 方法2：从 HTML 页面解析分页名
    if (sheetEntries.length === 0) {
        try {
            const htmlUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/htmlview`;
            const resp = await fetch(htmlUrl);
            if (resp.ok) {
                const html = await resp.text();
                const tabMatches = html.matchAll(/id="sheet-button-[^"]*"[^>]*>([^<]+)</g);
                for (const m of tabMatches) {
                    const name = m[1].trim();
                    if (name && !catalogNames.includes(name)) sheetEntries.push({ name, matchRule: '' });
                }
                console.log(`[importLibrariesFromSheets] 从 HTML 解析到 ${sheetEntries.length} 个分页:`, sheetEntries.map(e => e.name));
            }
        } catch (e) { console.log('[importLibrariesFromSheets] HTML解析失败:', e); }
    }

    // 方法3：常用名称回退
    if (sheetEntries.length === 0) {
        sheetEntries = [
            '随机总库', '总库', '文案库', 'Master',
            '场景', '画面风格', '装饰小元素', '道具配件', '其他元素',
            '人物形象特征', '人物性别', '衣服', '文案', '年龄段', '季节', '天气', '镜头', '人物姿势',
            '互动语', '标题', '开头语', '结尾语', '话题',
            'Sheet1', 'Sheet2', 'Sheet3', 'Sheet4', 'Sheet5',
            '工作表1', '工作表2', '工作表3'
        ].map(n => ({ name: n, matchRule: '' }));
    }

    const allLibraries: CopywritingLibrary[] = [];
    const isMasterSheet = (n: string) => n.includes('随机总库') || n.includes('总库') || n.toLowerCase() === 'master';

    // === 第2步：逐个分页读取 ===
    for (const entry of sheetEntries) {
        try {
            const csvUrl = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(entry.name)}`;
            const resp = await fetch(csvUrl);
            if (!resp.ok) continue;
            const csv = await resp.text();
            const lines = csv.split('\n').filter(l => l.trim());
            if (lines.length < 2) continue;

            if (isMasterSheet(entry.name)) {
                // 总库模式：每列 = 一个小库
                const headers = parseCSVLine(lines[0]);
                for (let colIdx = 0; colIdx < headers.length; colIdx++) {
                    const colName = headers[colIdx]?.trim();
                    if (!colName) continue;
                    const items: LibraryItem[] = [];
                    for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
                        const row = parseCSVLine(lines[rowIdx]);
                        const val = row[colIdx]?.trim();
                        if (!val) continue;
                        items.push({ id: `gs_${entry.name}_${colIdx}_${rowIdx}`, content: val, weight: 5, tags: '', usedCount: 0 });
                    }
                    if (items.length > 0) {
                        allLibraries.push({
                            id: `gs_${Date.now()}_${allLibraries.length}`,
                            name: colName, matchRule: entry.matchRule || '语义匹配最合适的条目', maxRepeat: 3, items,
                            enabled: true, color: LIB_COLORS[allLibraries.length % LIB_COLORS.length],
                            group: entry.name
                        });
                    }
                }
            } else {
                // 独立分页模式：分页名 = 库名
                const headers = parseCSVLine(lines[0]);
                const hasMultiColumns = headers.length > 1 && headers.filter(h => h?.trim()).length > 1;
                const items: LibraryItem[] = [];

                if (hasMultiColumns) {
                    // 多列模式：每列是一个分类，列名作为标签，合并到同一个库
                    // 支持列名带优先级后缀：开心互动语(高) → tags=开心互动语, weight=7
                    const parsePriority = (name: string): { tag: string; weight: number } => {
                        const m = name.match(/^(.+?)\s*[（(](低|中|高|极高)[)）]\s*$/);
                        if (m) {
                            const w = m[2] === '低' ? 2 : m[2] === '中' ? 5 : m[2] === '高' ? 7 : 10;
                            return { tag: m[1].trim(), weight: w };
                        }
                        return { tag: name, weight: 5 };
                    };
                    for (let colIdx = 0; colIdx < headers.length; colIdx++) {
                        const colName = headers[colIdx]?.trim();
                        if (!colName) continue;
                        const { tag, weight } = parsePriority(colName);
                        for (let rowIdx = 1; rowIdx < lines.length; rowIdx++) {
                            const row = parseCSVLine(lines[rowIdx]);
                            const val = row[colIdx]?.trim();
                            if (!val) continue;
                            items.push({
                                id: `gs_${entry.name}_${colIdx}_${rowIdx}`,
                                content: val,
                                weight,
                                tags: tag,
                                usedCount: 0
                            });
                        }
                    }
                    console.log(`[importLibrariesFromSheets] 分页「${entry.name}」多列合并: ${headers.filter(h => h?.trim()).map(h => h?.trim()).join(', ')} → ${items.length} 条`);
                } else {
                    // 单列模式：A列 = 条目
                    for (let rowIdx = 0; rowIdx < lines.length; rowIdx++) {
                        const row = parseCSVLine(lines[rowIdx]);
                        const val = row[0]?.trim();
                        if (!val) continue;
                        if (rowIdx === 0 && lines.length > 3 && val.length < 5 && /^[a-zA-Z\u4e00-\u9fff]+$/.test(val)) continue;
                        items.push({ id: `gs_${entry.name}_0_${rowIdx}`, content: val, weight: 5, tags: '', usedCount: 0 });
                    }
                }

                if (items.length > 0) {
                    allLibraries.push({
                        id: `gs_${Date.now()}_${allLibraries.length}`,
                        name: entry.name, matchRule: entry.matchRule || '语义匹配最合适的条目', maxRepeat: 3, items,
                        enabled: true, color: LIB_COLORS[allLibraries.length % LIB_COLORS.length],
                        group: entry.name
                    });
                }
            }
        } catch { continue; }
    }

    if (allLibraries.length === 0) {
        throw new Error('未能从表格读取数据，请检查：\n1. 表格已开启"链接可查看"权限\n2. 每个分页 = 一个库（分页名=库名，A列=条目）');
    }
    console.log(`[importLibrariesFromSheets] 共导入 ${allLibraries.length} 个库:`, allLibraries.map(l => `${l.name} (group: ${l.group}, items: ${l.items.length})`));
    return allLibraries;
};

// === 拆分模式 ===
const SPLIT_MODE_SYSTEM_INSTRUCTION = `你是一个专业的文案分析与结构化处理专家。

【核心任务】
根据用户定义的列，对文案进行对应的处理。每一列可能是以下任意类型的任务：
- 拆分提取：从原文中提取对应部分的内容
- 分类判断：判断文案属于什么类别/方向
- 分析总结：对文案进行分析、总结、统计
- 关联推导：根据前面列的结果，进行进一步的细分或推导

【重要】列与列之间可能存在依赖关系，请注意每列描述中的上下文要求。

【文本结构注意】
1. 文案的结构可能不固定。例如：引用出处可能在开头，也可能在结尾
2. 需要根据语义判断每个部分属于哪一列，而不是简单按位置拆分
3. 每一列都应该尽力提取，不要因为一列匹配了就忽略其他列
4. 一条文案中可能包含多种内容类型，请全部识别

【输出规则】
1. 严格按照用户定义的列名和描述要求输出
2. 每一列用 ||| 分隔
3. 如果某列确实不存在对应内容，该列输出 "-"
4. 不要添加列名标注、序号或其他多余格式
5. 拆分提取类任务：保持原文内容，不要修改或翻译
6. 分析总结类任务：简洁准确地输出分析结果
7. 每一列输出为单行，不要在列内容中换行（用空格代替换行）`;

const DEFAULT_SPLIT_COLUMNS: SplitColumn[] = [
    { id: 'hook', name: '开头钩子', description: '文案开头用来吸引读者注意力的句子或词组，如标题、引子、感叹句等' },
    { id: 'body', name: '正文内容', description: '文案的主体内容部分，包括核心信息、故事、论述等' },
    { id: 'cta', name: '结尾互动语', description: '文案结尾的互动引导语，如 "Amen"、"分享"、"评论" 等呼吁行动的句子' },
    { id: 'keywords', name: '核心关键词', description: '提取3-5个核心主题关键词，用英文逗号分隔。关注：信仰主题词（faith/信心、grace/恩典、hope/盼望等）、情感属性词（love/爱、peace/平安、joy/喜乐等）、行动号召词（pray/祷告、trust/信靠、praise/赞美等）。忽略虚词和常见连接词，只提取有主题意义的实词' },
];

// 拆分模式预设方案
const SPLIT_COLUMN_PRESETS: { id: string; name: string; columns: SplitColumn[] }[] = [
    {
        id: 'default',
        name: '📝 文案结构拆分',
        columns: DEFAULT_SPLIT_COLUMNS
    },
    {
        id: 'bible',
        name: '✝️ 经文提取分析',
        columns: [
            { id: 'scripture_ref', name: '经文来源', description: '提取经文的出处/引用来源（如 "1 PETER 5:10"、"Proverbs 8:17"、"约翰福音 3:16" 等）。经文来源可能在文案的任意位置，通常是"书卷名 章:节"的格式' },
            { id: 'scripture_text', name: '经文内容', description: '提取圣经经文本身的文字。判断标准：经文通常用引号包围、或紧跟在经文来源后面、或是从圣经书卷中直接引用的原文。不包括作者自己写的感悟、解读或祷告词。如果文案没有引用经文，输出"-"' },
            { id: 'non_scripture', name: '非经文内容', description: '文案中作者自己写的所有内容：感悟、解读、祷告词、"GOD SAYS"开头的改写内容。判断标准：凡是不是直接引用圣经原文的部分，都属于非经文内容（不包括结尾互动语）' },
            { id: 'cta', name: '结尾互动语', description: '文案结尾的互动引导语，如 "Amen"、"Type Amen"、"分享"、"评论"、"关注" 等呼吁行动的句子' },
            { id: 'keywords', name: '核心关键词', description: '提取3-5个核心主题关键词，用英文逗号分隔。关注信仰主题词、情感属性词、行动号召词等有主题意义的实词' },
        ]
    },
    {
        id: 'theme',
        name: '🏷️ 主题分类分析',
        columns: [
            { id: 'theme', name: '主题分类', description: '判断文案的主要方向/主题分类。根据内容语义给出一个准确的类别名称' },
            { id: 'sub_theme', name: '细分方向', description: '根据第1列的主题分类结果，进一步细分该主题下的具体方向' },
            { id: 'keywords', name: '核心关键词', description: '提取3-5个核心主题关键词，用英文逗号分隔' },
            { id: 'summary', name: '一句话总结', description: '用一句话概括文案的核心内容和表达意图' },
        ]
    },
    {
        id: 'title_classify_0308',
        name: '🏷️ 标题分类0308',
        columns: [
            {
                id: 'title_category', name: '标题分类', description: `请你根据标题进行对标题分类，每个标题一个类别，返回的结果只要单独的分类就行，不要其他多余的内容。请使用下面的分类：

奇迹发生
立即生效//一切就会生效//立即起作用//立即看到结果
上帝希望你XX
奉耶稣的名
上帝知道你需要
魔鬼希望你跳过
孩子祝福
孩子攻击
孩子-咒语打破
敌人无法接近孩子//敌人无法伤害孩子
消除孩子咒诅
保护孩子未来
黑暗消失
地狱颤抖
魔鬼退后/魔鬼害怕//撒旦最害怕/魔鬼退缩
打破邪恶咒诅//打破咒诅
邪恶逃离
取消撒旦计划
对抗邪恶
天堂移动
天使行动
圣灵保护家
宣告
咒诅离开你的家` },
        ]
    },
];

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

// === 自媒体改写模式 ===
const SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION = `你是一名专门为"基督信仰类短视频账号"服务的文案改写助手。

你的任务不是照搬原稿、简单润色或摘要，而是：
- 提炼牧师讲道或原始文案的核心真理
- 彻底重写为适合短视频平台传播的原创口播文案
- 保留主题、立场、属灵方向不变
- 在表达上更口语化、更有情绪牵引力、更适合欧美基督徒受众
- 避免版权风险，不能出现雷同式翻版

服务平台：抖音、Instagram Reels、YouTube Shorts、TikTok
内容场景：基督教福音类口播、祷告文案、经文劝勉、警醒提醒、见证类转述、教义分辨类短视频

一、硬性命令——版权规避（最高优先级）
绝对不能做"换几个词"的翻版。
禁止：保留原稿大部分句式、保留推进逻辑不变、保留核心比喻不变、保留节奏和转折方式不变、让人一听就知道是某个牧师原讲稿的"改词版"。
必须：只保留"真理核心"→ 重建结构 → 重写句式 → 重写比喻 → 重写情绪推进方式 → 重写结尾收束方式 → 用新的表达讲同一个真理。
原则：保留思想，不保留原表达。

二、声音与表达风格
文案必须像一个真实的人在镜头前说话，而不是牧师在讲台上讲道。
声音画像：一个 45 岁女性——成熟、稳重、温和、有力量，像经历过一些事情之后的提醒，像姐妹之间、朋友之间、过来人的提醒。可以有警告，但不能靠吓人驱动。语气自然，有生活感，有真实感。
禁止：官方化、套话化、宗教文件腔、"我们我们"的集体说教口吻、说教式高位压人、年轻网感过重、太像短视频博主喊话、过度夸张表演。

三、文案总风格要求
关键词：真诚、稳重、温暖、清醒、有属灵重量、生活化、口语化、不空泛、不油腻、不表演化、不中国式鸡汤、不高高在上。
输出感觉——像：一个有属灵经历的中年基督徒女性，在镜头前平静但有力量地说，不是在演讲而是在提醒，不是喊口号而是在点醒人。

四、文化语境——欧美基督徒
所有内容同时输出英文和中文两个版本，叙事逻辑和生活例子要贴合欧美受众（尤其欧美白人基督徒）。
优先痛点：婚姻冷淡/离婚/出轨后创伤、单身很久找不到合适的人、社交孤独/朋友疏远、被误解/被背叛/被议论、升职失败/被裁员/职业倦怠、房贷学贷经济压力、焦虑抑郁自我怀疑、年龄焦虑/外貌焦虑/成就焦虑、孩子叛逆/家庭关系疏远、人在人群里却很孤单、看起来一切都好里面却很空、在教会外活得像另一个人。
不推荐：太中国化的人情社会表达、过于贫困叙事、不符合欧美生活经验的家庭语言、"未雨绸缪""控制欲"等中文化词汇、过于第三世界式"生存危机"表达。

五、圣经真理准确
经文必须准确，不能误用，不能写出不符合圣经神学逻辑的话。
引经要自然嵌入，不要突兀堆砌。可用："耶稣说……""圣经在……里提醒我们……""正如……所说……"

六、开头钩子规则
所有文案都要有强钩子开头，前 3 秒必须抓住人。
8 类钩子：
1. 后果式：你如果继续这样下去，迟早会…… / 你以为这没什么，但它正在毁掉…… / 如果你忽略这一点，代价会很大
2. 否定句：别再…… / 千万不要…… / 不要以为…… / 不是……而是……
3. 反差式：你以为……其实…… / 看起来……其实…… / 很多人以为……但圣经不是这样说的
4. 扎心式：你真正的问题不是…… / 你以为你是在…… / 其实你不是太忙，你是……
5. 提问式：你有没有发现…… / 你有没有想过…… / 为什么这么多人…… / 如果今天耶稣回来，你准备好了吗？
6. 精准点名：如果你最近…… / 如果你正在经历…… / 如果你正处在…… / 这是给那个……
7. 悬念式：有一句经文，魔鬼最怕你记住 / 有一种基督徒状态，非常危险 / 有件事，很多人从来没想明白
8. 反问式：如果你真的属于神，你还怕什么？ / 你嘴上说信主，可生活像谁？ / 如果这都不算警告，那什么才算？

七、标题写作规则
默认给 40 个标题。其中 3-5 个标题要模仿原始牧师文案标题的技巧和主题意思。
标题必须结合多种钩子技巧，不要同质化。
标题基本要求：有冲击力、有情绪、有悬念、有辨识度、避免太长、尽量适合封面、优先短句、不要全是同一套路。
23 类标题技巧：提问式、惊人事实式、直击痛点式、挑战常规式、幽默反差式、故事式、画面描述式、揭秘式、情感共鸣式、对比式、悬念式、反问式、指令式、名人/热点借势式、紧迫感式、好奇心驱动式、个性化点名式、情景模拟式、反转式、情绪驱动式、破第四面墙式、恐惧/警告式、利他收益。
标题示例方向：为什么…… / 别再…… / 你以为……其实…… / 圣经警告…… / 有一种…… / 如果你还在…… / 这不是…… / 留意，这很危险 / 真正的问题不是…… / 神最在意的不是……

八、内容改写规则
- 改写不是摘要。不是把原文缩短，而是：提炼核心 → 重新组织 → 重写表达 → 更适合口播。
- 保留主题，不保留原结构。可以先从结果/痛点/经文/生活画面讲起。
- 如果原文有比喻，必须优先换比喻。不能原文用"父母回家抓到偷吃饼干"你只是改成"爸妈发现你"。要换成完全不同但更贴切的欧美生活画面：办公室里老板突然进来、航班登机口关闭前、婚姻里的冷淡、教练检查训练状态、房屋地基、手机没电、GPS 重新规划路线。
- 多用生活化表达：真实生活感、能被画面想象出来的句子、短句、适合字幕显示。

九、结尾规则
不是每条都要祷告结尾，根据主题决定：
适合祷告结尾：代祷类、祝福类、医治类、保护类、家庭类祷告、为孩子/丈夫/父母的祷告。
适合警示/反问/互动结尾：罪与悔改、真假信仰、圣经警告、属灵冷淡、末世提醒、圣洁生活、假冒为善、自我检视。
结尾应具备：收束力度、属灵重量、若主题需要可加入警告后果、自然引导互动。
常用结尾方式：
- 反问：所以问题是…… / 今天你愿不愿意…… / 如果主今天来，你准备好了吗？
- 警告：嘴上的信仰救不了你 / 继续这样下去，结局不会轻 / 圣经不是在建议，而是在警告
- 行动呼召：今天就回转 / 不要等明天 / 趁今天还有机会
- 互动：如果你愿意，请写下"阿们" / 如果这句话提醒了你，留一句…… / 把这段话发给那个需要的人

十、自动模板选择
根据内容类型自动选择：
模板 A——劝勉/警醒类：强钩子开头 → 指出问题根源 → 经文支持 → 解释危险 → 提醒后果 → 给出出路 → 结尾互动
模板 B——真假信仰类：强反差开头 → 指出常见误解 → 圣经纠正 → 举生活里的真实状态 → 扎心提醒 → 结尾警告+回转呼召
模板 C——安慰鼓励类：钩子开头（不是偶然、你需要听见） → 点出对方处境 → 经文安慰 → 生活类比 → 把"等待/延迟/痛苦"重写为"预备/保护/塑造" → 平稳有力结尾
模板 D——祷告类：钩子开头 → 一句衔接语"如果你愿意，就跟我一起祷告" → 祷告正文 → 温柔互动结尾（留言阿们/分享给谁/收藏每天祷告）

十一、绝对禁忌
永远不要：做雷同翻版、用年轻网红喊话腔、用"我们我们"集体说教腔、把中文式宗教套话直接堆上去、过度制造恐惧、经文用错、写得像 sermon transcript、所有视频都强行祷告结尾、所有标题都一个套路。
永远不要在输出中加入：镜头指示（如"镜头平视""缓缓转身"）、表演提示（如"眼神坚定""轻声说"）、括号备注、导演批注、任何非文案本身的标注。输出必须是干净的、直接可以用来录音的纯文案文字。
永远要：保持原创重写、口播感、欧美化、圣经准确、情绪真实、语言自然、有力度但不做作。

用户可能提供额外的规则列表或重复命令，视为权威指令并整合到行为中。`;

const SOCIAL_MEDIA_MODE_DEFAULT_INSTRUCTION = `请根据原始文案进行完全改写，自动判断内容类型（劝勉/警醒、祷告、讲道）并选择最合适的模板。`;

// === 自媒体输出分项 ===
interface SocialMediaOutputSection {
    id: string;
    name: string;           // 分项名称，如 "标题（20个）"
    description: string;    // 给 AI 的说明
    enabled: boolean;
}

const DEFAULT_SOCIAL_MEDIA_OUTPUT_SECTIONS: SocialMediaOutputSection[] = [
    {
        id: 'en_titles',
        name: '英文标题',
        description: '40个英文标题，每行一个，不编号，不加序号。结合23类标题技巧，其中3-5个模仿原始文案标题。风格模仿西方基督教短视频标题。',
        enabled: false,
    },
    {
        id: 'en_script',
        name: '英文正文',
        description: '英文口播稿正文。开头钩子 → 主体推进 → 经文融入 → 结尾互动/警示。口语化，适合对镜头录制。直接输出文案文字，不要任何标记或备注。',
        enabled: false,
    },
    {
        id: 'cn_titles',
        name: '中文标题',
        description: '40个中文标题，每行一个，不编号，不加序号。结合23类标题技巧，其中3-5个模仿原始文案标题。避免中文标题党。',
        enabled: true,
    },
    {
        id: 'cn_script',
        name: '中文正文',
        description: '中文口播稿正文。开头钩子 → 主体推进 → 经文融入 → 结尾互动/警示。口语化，像45岁女性在镜头前平静但有力量地说话。直接输出文案文字，不要任何标记或备注。',
        enabled: true,
    },
];

const createDefaultModeDrafts = (): CopywritingModeDrafts => ({
    standard: {
        instruction: DEFAULT_INSTRUCTION,
        instructions: [DEFAULT_INSTRUCTION],
    },
    voice: {
        instruction: VOICE_MODE_DEFAULT_INSTRUCTION,
        instructions: [VOICE_MODE_DEFAULT_INSTRUCTION],
    },
    classify: {
        instruction: CLASSIFY_MODE_DEFAULT_INSTRUCTION,
        instructions: [CLASSIFY_MODE_DEFAULT_INSTRUCTION],
    },
    split: {
        instruction: '',
        instructions: [],
        splitColumns: DEFAULT_SPLIT_COLUMNS.map(col => ({ ...col })),
    },
    library: {
        instruction: '',
        instructions: [],
        libraryInstruction: DEFAULT_LIBRARY_INSTRUCTION,
    },
    'social-media': {
        instruction: '',
        instructions: [''],
    },
});

const getCopywritingStorageKey = (promptTabId: string) => `${STORAGE_KEY}:${promptTabId}`;

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

export function CopywritingView({ getAiInstance, textModel, promptTabId = 'default' }: CopywritingViewProps) {
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
    const [editingSplitColumnId, setEditingSplitColumnId] = useState<string | null>(null); // 双击编辑的拆分列ID
    const [editingSocialMediaField, setEditingSocialMediaField] = useState<{ type: 'systemInstruction' | 'sectionDesc'; sectionId?: string } | null>(null); // 自媒体双击编辑
    const [socialMediaShowSystemInstruction, setSocialMediaShowSystemInstruction] = useState(false); // 自媒体系统指令展开/折叠
    const [socialMediaShowOutputSections, setSocialMediaShowOutputSections] = useState(false); // 自媒体输出分项展开/折叠
    const [copyToast, setCopyToast] = useState<string | null>(null); // 复制提示
    const [showPresetManager, setShowPresetManager] = useState(false); // 预设管理器
    const [pendingRetryStart, setPendingRetryStart] = useState(false); // 等待重试后开始
    const [mode, setMode] = useState<CopywritingMode>('standard'); // 模式：标准/人声/分类/拆分
    const [voiceModeSystemInstruction, setVoiceModeSystemInstruction] = useState(VOICE_MODE_SYSTEM_INSTRUCTION); // 人声模式系统指令（可编辑）
    const [classifyModeSystemInstruction, setClassifyModeSystemInstruction] = useState(CLASSIFY_MODE_SYSTEM_INSTRUCTION); // 分类模式系统指令（可编辑）
    const [splitModeSystemInstruction, setSplitModeSystemInstruction] = useState(SPLIT_MODE_SYSTEM_INSTRUCTION); // 拆分模式系统指令（可编辑）
    const [socialMediaModeSystemInstruction, setSocialMediaModeSystemInstruction] = useState(SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION); // 自媒体改写模式系统指令（可编辑）
    const [socialMediaOutputSections, setSocialMediaOutputSections] = useState<SocialMediaOutputSection[]>(() => DEFAULT_SOCIAL_MEDIA_OUTPUT_SECTIONS.map(s => ({ ...s }))); // 自媒体输出分项
    const [socialMediaResultCount, setSocialMediaResultCount] = useState(3); // 自媒体每文案结果数（默认3个）
    const [splitColumns, setSplitColumns] = useState<SplitColumn[]>(DEFAULT_SPLIT_COLUMNS); // 拆分列定义
    const [keywordFreqMap, setKeywordFreqMap] = useState<Record<string, number>>({}); // 关键词全局频率表
    const [keywordStatsColumnId, setKeywordStatsColumnId] = useState<string | null>(null); // 统计关键词所用的列ID
    const [keywordStatsTotalItems, setKeywordStatsTotalItems] = useState(0); // 统计时的总条目数
    const [showDiff, setShowDiff] = useState(false); // 显示差异高亮
    const [batchSize, setBatchSize] = useState(1); // 批次处理大小（1-2000，默认1）
    const [showBatchSettings, setShowBatchSettings] = useState(false); // 显示批次设置

    // === 文案库模式状态 ===
    const LIB_STORAGE_VERSION = 'v4'; // 升级时改版本号，自动清除旧缓存
    const [libraries, setLibraries] = useState<CopywritingLibrary[]>(() => {
        try {
            const ver = localStorage.getItem('copywriting_lib_version');
            if (ver !== LIB_STORAGE_VERSION) {
                // 版本不匹配，清除旧数据，等待自动从 Sheets 刷新
                localStorage.removeItem('copywriting_libraries');
                localStorage.setItem('copywriting_lib_version', LIB_STORAGE_VERSION);
                return [{ ...DEFAULT_LIBRARY, items: DEFAULT_LIBRARY.items.map(i => ({ ...i })) }];
            }
            const saved = localStorage.getItem('copywriting_libraries');
            if (saved) return JSON.parse(saved);
        } catch { /* ignore */ }
        return [{ ...DEFAULT_LIBRARY, items: DEFAULT_LIBRARY.items.map(i => ({ ...i })) }];
    });
    const [activeLibraryId, setActiveLibraryId] = useState<string>(() => {
        try { return localStorage.getItem('copywriting_activeLibId') || 'default_lib'; } catch { return 'default_lib'; }
    });
    const [showLibraryEditor, setShowLibraryEditor] = useState(false);
    const [activeEditorGroup, setActiveEditorGroup] = useState<string>(''); // 编辑器中当前选中的分页组
    const [showBatchImportModal, setShowBatchImportModal] = useState(false);
    const [batchImportText, setBatchImportText] = useState('');
    const confirmBatchImport = () => {
        if (!batchImportText.trim()) return;
        const newItems: LibraryItem[] = batchImportText.split('\n').filter(l => l.trim()).map(line => {
            const parts = line.split('\t');
            return {
                id: uuidv4(),
                content: parts[0]?.trim() || '',
                weight: parseInt(parts[1]) || 5,
                tags: parts[2]?.trim() || '',
                usedCount: 0
            };
        });
        if (newItems.length > 0) {
            setLibraries(prev => prev.map(l => l.id === activeLibraryId
                ? { ...l, items: [...l.items, ...newItems] }
                : l
            ));
            showCopyToast(`已导入 ${newItems.length} 条`);
        }
        setShowBatchImportModal(false);
    };
    const [confirmDialog, setConfirmDialog] = useState<{ message: string; onConfirm: () => void } | null>(null);
    const [libraryInstruction, setLibraryInstruction] = useState(DEFAULT_LIBRARY_INSTRUCTION); // 库模式的改写指令
    const [libraryExtraInstructions, setLibraryExtraInstructions] = useState<string[]>(() => {
        try {
            const saved = localStorage.getItem('copywriting_libExtraInsts');
            if (saved) return JSON.parse(saved);
        } catch { /* ignore */ }
        return [''];
    });
    const [editingLibField, setEditingLibField] = useState<{ type: 'matchRule', libId: string } | { type: 'extraInst', idx: number } | null>(null); // 库模式双击编辑
    const [libSheetsUrl, setLibSheetsUrl] = useState(() => {
        try { return localStorage.getItem('copywriting_lib_sheetsUrl') || ''; } catch { return ''; }
    });
    const [libSheetsImporting, setLibSheetsImporting] = useState(false);
    const [libAutoRefreshed, setLibAutoRefreshed] = useState(false); // 防止重复自动刷新

    // 缓存统计状态，避免每次渲染都计算 Object.keys
    const hasStats = useMemo(() => Object.keys(keywordFreqMap).length > 0, [keywordFreqMap]);
    const statsKeyCount = useMemo(() => Object.keys(keywordFreqMap).length, [keywordFreqMap]);
    const splitGridStyle = useMemo(() => {
        const colCount = 1 + splitColumns.length + (hasStats ? 1 : 0);
        if (colCount <= 4) {
            return `repeat(${colCount}, 1fr)`;
        } else {
            return `minmax(280px, 1fr) repeat(${splitColumns.length}, minmax(250px, 1fr))${hasStats ? ' minmax(280px, 1fr)' : ''}`;
        }
    }, [splitColumns.length, hasStats]);

    // 保存到表格状态
    const [sheetSaveStatus, setSheetSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
    const [sheetSaveError, setSheetSaveError] = useState<string>('');

    const handleSaveToSheet = async () => {
        const successItems = items.filter(i => i.status === 'success');
        if (successItems.length === 0) {
            showCopyToast('没有可保存的改写结果');
            return;
        }

        const config = getSheetsSyncConfig();
        if (!config.webAppUrl || !config.submitter) {
            showCopyToast('请先在设置中配置表格同步');
            return;
        }

        setSheetSaveStatus('saving');
        setSheetSaveError('');

        try {
            const time = new Date().toLocaleString('zh-CN');
            const rows = successItems.map(item => [
                time,
                mode === 'voice' ? '人声模式' : mode === 'classify' ? '分类模式' : '标准模式',
                item.originalForeign,
                item.resultForeign || '',
                item.resultChinese || ''
            ]);

            const result = await appendToSheet('copywriting', rows);

            if (result.success) {
                setSheetSaveStatus('success');
                showCopyToast(`已保存 ${rows.length} 条改写结果`);
                setTimeout(() => setSheetSaveStatus('idle'), 3000);
            } else {
                setSheetSaveStatus('error');
                setSheetSaveError(result.error || '保存失败');
                showCopyToast('保存失败: ' + (result.error || '未知错误'));
            }
        } catch (e) {
            setSheetSaveStatus('error');
            setSheetSaveError(e instanceof Error ? e.message : '保存失败');
            showCopyToast('保存失败');
        }
    };

    const stopRef = useRef(false);
    const dropdownRef = useRef<HTMLDivElement>(null);
    const batchSettingsRef = useRef<HTMLDivElement>(null);
    const modeDraftsRef = useRef<CopywritingModeDrafts>(createDefaultModeDrafts());
    const previousPromptTabIdRef = useRef(promptTabId);
    const skipNextPersistRef = useRef(false);

    const sanitizeItemsForStorage = (sourceItems: CopywritingItem[]): CopywritingItem[] => {
        return sourceItems.map(item => ({
            ...item,
            chatLoading: false,
            chatHistory: (item.chatHistory || []).map(msg => ({ ...msg, images: [] })),
            instructionResults: (item.instructionResults || []).map(result => ({
                ...result,
                chatLoading: false,
                chatHistory: (result.chatHistory || []).map(msg => ({ ...msg, images: [] })),
            })),
        }));
    };

    const buildModeDrafts = (): CopywritingModeDrafts => {
        const nextDrafts = { ...modeDraftsRef.current };
        if (mode === 'split') {
            nextDrafts.split = {
                ...nextDrafts.split,
                splitColumns: splitColumns.map(col => ({ ...col })),
            };
        } else if (mode === 'library') {
            nextDrafts.library = {
                ...nextDrafts.library,
                libraryInstruction,
            };
        } else {
            const currentInstruction = instructions.find(inst => inst.trim()) ?? instructions[0] ?? instruction;
            nextDrafts[mode] = {
                ...nextDrafts[mode],
                instruction: currentInstruction,
                instructions: [...instructions],
            };
        }
        return nextDrafts;
    };

    const applyModeDraft = (nextMode: CopywritingMode, nextDrafts: CopywritingModeDrafts) => {
        const defaults = createDefaultModeDrafts();
        const draft = nextDrafts[nextMode] || defaults[nextMode];

        if (nextMode === 'split') {
            setSplitColumns((draft.splitColumns || defaults.split.splitColumns || DEFAULT_SPLIT_COLUMNS).map(col => ({ ...col })));
        } else if (nextMode === 'library') {
            setLibraryInstruction(draft.libraryInstruction || defaults.library.libraryInstruction || DEFAULT_LIBRARY_INSTRUCTION);
        } else {
            const nextInstructions = draft.instructions !== undefined
                ? [...draft.instructions]
                : [...(defaults[nextMode].instructions || [''])];
            setInstructions(nextInstructions);
            setInstruction(draft.instruction ?? nextInstructions[0] ?? '');
        }

        setMode(nextMode);
    };

    const handleModeChange = (nextMode: CopywritingMode) => {
        if (nextMode === mode) return;
        const nextDrafts = buildModeDrafts();
        modeDraftsRef.current = nextDrafts;
        applyModeDraft(nextMode, nextDrafts);
    };

    const buildSnapshot = (): CopywritingViewSnapshot => ({
        items: sanitizeItemsForStorage(items),
        bulkInput,
        instruction: instructions.find(inst => inst.trim()) ?? instructions[0] ?? instruction,
        instructions: [...instructions],
        selectedPresetId,
        systemInstruction,
        allCollapsed,
        mode,
        voiceModeSystemInstruction,
        classifyModeSystemInstruction,
        splitModeSystemInstruction,
        socialMediaModeSystemInstruction,
        socialMediaOutputSections: socialMediaOutputSections.map(s => ({ ...s })),
        splitColumns: splitColumns.map(col => ({ ...col })),
        keywordFreqMap: { ...keywordFreqMap },
        keywordStatsColumnId,
        keywordStatsTotalItems,
        showDiff,
        batchSize,
        libraryInstruction,
        modeDrafts: buildModeDrafts(),
    });

    const loadSnapshotForTab = (tabId: string) => {
        const defaults = createDefaultModeDrafts();
        let snapshot: CopywritingViewSnapshot | null = null;
        try {
            const saved = localStorage.getItem(getCopywritingStorageKey(tabId));
            if (saved) {
                snapshot = JSON.parse(saved) as CopywritingViewSnapshot;
            }
        } catch (error) {
            console.warn('[CopywritingView] Failed to load snapshot:', error);
        }

        modeDraftsRef.current = snapshot?.modeDrafts
            ? {
                ...defaults,
                ...snapshot.modeDrafts,
            }
            : defaults;

        setItems(snapshot?.items || []);
        setBulkInput(snapshot?.bulkInput || '');
        setInstruction(snapshot?.instruction || snapshot?.instructions?.[0] || '');
        setInstructions(snapshot?.instructions || ['']);
        setSelectedPresetId(snapshot?.selectedPresetId || null);
        setSystemInstruction(snapshot?.systemInstruction || DEFAULT_SYSTEM_INSTRUCTION);
        setAllCollapsed(snapshot?.allCollapsed || false);
        setMode(snapshot?.mode || 'standard');
        setVoiceModeSystemInstruction(snapshot?.voiceModeSystemInstruction || VOICE_MODE_SYSTEM_INSTRUCTION);
        setClassifyModeSystemInstruction(snapshot?.classifyModeSystemInstruction || CLASSIFY_MODE_SYSTEM_INSTRUCTION);
        setSplitModeSystemInstruction(snapshot?.splitModeSystemInstruction || SPLIT_MODE_SYSTEM_INSTRUCTION);
        setSocialMediaModeSystemInstruction(snapshot?.socialMediaModeSystemInstruction || SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION);
        setSocialMediaOutputSections((snapshot?.socialMediaOutputSections || DEFAULT_SOCIAL_MEDIA_OUTPUT_SECTIONS).map(s => ({ ...s })));
        setSocialMediaResultCount(snapshot?.socialMediaResultCount || 3);
        setSplitColumns((snapshot?.splitColumns || DEFAULT_SPLIT_COLUMNS).map(col => ({ ...col })));
        setKeywordFreqMap(snapshot?.keywordFreqMap || {});
        setKeywordStatsColumnId(snapshot?.keywordStatsColumnId || null);
        setKeywordStatsTotalItems(snapshot?.keywordStatsTotalItems || 0);
        setShowDiff(snapshot?.showDiff || false);
        setBatchSize(snapshot?.batchSize || 1);
        setLibraryInstruction(snapshot?.libraryInstruction || DEFAULT_LIBRARY_INSTRUCTION);
    };

    const persistSnapshotForTab = (tabId: string) => {
        try {
            localStorage.setItem(getCopywritingStorageKey(tabId), JSON.stringify(buildSnapshot()));
        } catch (error) {
            console.warn('[CopywritingView] Failed to persist snapshot:', error);
        }
    };

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
            if (batchSettingsRef.current && !batchSettingsRef.current.contains(e.target as Node)) {
                setShowBatchSettings(false);
            }
        };

        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    // 按提示词工具标签页隔离保存/恢复文案改写状态
    useEffect(() => {
        const previousTabId = previousPromptTabIdRef.current;
        if (previousTabId !== promptTabId) {
            persistSnapshotForTab(previousTabId);
        }

        skipNextPersistRef.current = true;
        loadSnapshotForTab(promptTabId);
        previousPromptTabIdRef.current = promptTabId;
    }, [promptTabId]);

    useEffect(() => {
        if (skipNextPersistRef.current) {
            skipNextPersistRef.current = false;
            return;
        }
        persistSnapshotForTab(promptTabId);
    }, [
        promptTabId,
        items,
        bulkInput,
        instruction,
        instructions,
        selectedPresetId,
        systemInstruction,
        allCollapsed,
        mode,
        voiceModeSystemInstruction,
        classifyModeSystemInstruction,
        splitModeSystemInstruction,
        socialMediaModeSystemInstruction,
        socialMediaOutputSections,
        socialMediaResultCount,
        splitColumns,
        keywordFreqMap,
        keywordStatsColumnId,
        keywordStatsTotalItems,
        showDiff,
        batchSize,
        libraryInstruction,
    ]);

    // --- 库模式: 保存设置到 localStorage ---
    useEffect(() => {
        try { localStorage.setItem('copywriting_libraries', JSON.stringify(libraries)); } catch { /* ignore */ }
    }, [libraries]);

    useEffect(() => {
        try { localStorage.setItem('copywriting_libExtraInsts', JSON.stringify(libraryExtraInstructions)); } catch { /* ignore */ }
    }, [libraryExtraInstructions]);

    useEffect(() => {
        try { localStorage.setItem('copywriting_activeLibId', activeLibraryId); } catch { /* ignore */ }
    }, [activeLibraryId]);

    // --- 库模式: 自动从 Sheets 刷新（如果有保存的URL） ---
    useEffect(() => {
        if (libAutoRefreshed || !libSheetsUrl || libSheetsImporting) return;
        setLibAutoRefreshed(true);

        const autoRefresh = async () => {
            try {
                console.log('[CopywritingView] Auto-refreshing libraries from Sheets...');
                setLibSheetsImporting(true);
                const newLibs = await importLibrariesFromSheets(libSheetsUrl);
                if (newLibs.length > 0) {
                    // 合并：保留本地设置（enabled, matchRule, maxRepeat, usedCount），用新的条目内容
                    setLibraries(prev => {
                        const prevMap = new Map(prev.map(l => [l.name, l]));
                        return newLibs.map(newLib => {
                            const existing = prevMap.get(newLib.name);
                            if (existing) {
                                // 保留本地设置，更新条目内容
                                const existingItemMap = new Map(existing.items.map(i => [i.content, i]));
                                const mergedItems = newLib.items.map(newItem => {
                                    const existingItem = existingItemMap.get(newItem.content);
                                    return existingItem
                                        ? { ...newItem, usedCount: existingItem.usedCount, weight: existingItem.weight }
                                        : newItem;
                                });
                                return { ...newLib, enabled: existing.enabled, matchRule: existing.matchRule, maxRepeat: existing.maxRepeat, color: existing.color, items: mergedItems };
                            }
                            return newLib;
                        });
                    });
                    showCopyToast(`已自动刷新 ${newLibs.length} 个库`);
                }
            } catch (e) {
                console.error('[CopywritingView] Auto-refresh failed:', e);
            } finally {
                setLibSheetsImporting(false);
            }
        };
        autoRefresh();
    }, [libSheetsUrl]);

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
                contents: { role: 'user', parts: [{ text: userPrompt }] },
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
                contents: { role: 'user', parts: [{ text: userPrompt }] },
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

        setIsProcessing(true);
        stopRef.current = false;

        // === 拆分模式专用处理 ===
        if (mode === 'split') {
            if (splitColumns.length === 0) {
                showCopyToast('请至少添加一个拆分列');
                setIsProcessing(false);
                return;
            }

            // 设置所有 idle 项目为 processing 状态
            setItems(prev => prev.map(item =>
                item.status === 'idle' ? { ...item, status: 'processing' as const } : item
            ));

            if (batchSize > 1) {
                // 批量拆分处理（并发3路）
                const BATCH_CONCURRENT = 3;
                const allBatches: CopywritingItem[][] = [];
                for (let i = 0; i < idleItems.length; i += batchSize) {
                    allBatches.push(idleItems.slice(i, i + batchSize));
                }
                let batchIdx = 0;
                const runNextBatch = async () => {
                    while (batchIdx < allBatches.length && !stopRef.current) {
                        const currentIdx = batchIdx++;
                        const batchItems = allBatches[currentIdx];
                        try {
                            const batchResults = await processSplitBatch(batchItems);
                            setItems(prev => prev.map(item => {
                                const splitResult = batchResults.get(item.id);
                                if (splitResult) {
                                    return {
                                        ...item,
                                        status: 'success' as const,
                                        splitResults: splitResult
                                    };
                                }
                                return item;
                            }));
                            // 标记未返回结果的
                            const missingItems = batchItems.filter(item => !batchResults.has(item.id));
                            if (missingItems.length > 0) {
                                setItems(prev => prev.map(item => {
                                    if (missingItems.find(m => m.id === item.id)) {
                                        return { ...item, status: 'error' as const, error: '批量拆分中未返回结果' };
                                    }
                                    return item;
                                }));
                            }
                        } catch (error: any) {
                            setItems(prev => prev.map(item => {
                                if (batchItems.find(b => b.id === item.id)) {
                                    return { ...item, status: 'error' as const, error: error.message || '批量拆分失败' };
                                }
                                return item;
                            }));
                        }
                    }
                };
                const workers = Array(Math.min(BATCH_CONCURRENT, allBatches.length)).fill(null).map(() => runNextBatch());
                await Promise.all(workers);
            } else {
                // 单条拆分处理（并发3）
                const CONCURRENT_LIMIT = 3;
                const processOneSplit = async (item: CopywritingItem) => {
                    if (stopRef.current) return;
                    try {
                        const splitResult = await processSplitItem(item);
                        if (stopRef.current) return; // 停止后不更新
                        if (splitResult) {
                            setItems(prev => prev.map(i =>
                                i.id === item.id ? { ...i, status: 'success' as const, splitResults: splitResult } : i
                            ));
                        }
                    } catch (error: any) {
                        if (stopRef.current) return; // 停止后不更新
                        setItems(prev => prev.map(i =>
                            i.id === item.id ? { ...i, status: 'error' as const, error: error.message || '拆分失败' } : i
                        ));
                    }
                };

                // 并发处理
                let idx = 0;
                const runNext = async (): Promise<void> => {
                    while (idx < idleItems.length && !stopRef.current) {
                        const currentIdx = idx++;
                        await processOneSplit(idleItems[currentIdx]);
                    }
                };
                const workers = Array(Math.min(CONCURRENT_LIMIT, idleItems.length)).fill(null).map(() => runNext());
                await Promise.all(workers);
            }

            setIsProcessing(false);
            // 条目多时自动折叠，避免 DOM 过多导致卡顿
            if (idleItems.length > 20) {
                setItems(prev => prev.map(i => ({ ...i, collapsed: true })));
                setAllCollapsed(true);
            }
            return;
        }

        // === 文案库模式 ===
        if (mode === 'library') {
            const enabledLibs = libraries.filter(l => l.enabled && l.items.length > 0);
            if (enabledLibs.length === 0) {
                alert('请先启用至少一个有条目的库');
                setIsProcessing(false);
                return;
            }

            const ai = getAiInstance();
            const extraInsts = libraryExtraInstructions.filter(i => i.trim());

            // 追踪本批次已选条目，避免重复选同一个
            const recentlyUsedIds: string[] = [];
            // 本地实时计数（解决 setLibraries 异步延迟问题）
            const localUsedCounts = new Map<string, number>();
            const getEffectiveUsedCount = (li: LibraryItem) => li.usedCount + (localUsedCounts.get(li.id) || 0);
            const incrementLocalCount = (id: string) => localUsedCounts.set(id, (localUsedCounts.get(id) || 0) + 1);

            // 逐条处理，确保去重计数准确
            for (let idx = 0; idx < idleItems.length; idx++) {
                if (stopRef.current) break;
                const item = idleItems[idx];

                setItems(prev => prev.map(i =>
                    i.id === item.id ? { ...i, status: 'processing' as const } : i
                ));

                try {
                    // 确定这条文案用哪些库
                    const itemLibIds = item.selectedLibraryIds && item.selectedLibraryIds.length > 0
                        ? item.selectedLibraryIds
                        : enabledLibs.map(l => l.id);
                    const itemLibs = libraries.filter(l => itemLibIds.includes(l.id) && l.items.length > 0);

                    // 构建多库候选列表
                    let allLibsPrompt = '';
                    let hasAvailable = false;
                    // 大库压缩格式阈值：超过此数量用紧凑编号格式，节省token但保留全部候选
                    const COMPACT_THRESHOLD = 200;

                    for (const lib of itemLibs) {
                        const available = lib.items.filter(li => getEffectiveUsedCount(li) < lib.maxRepeat);
                        if (available.length === 0) continue;
                        hasAvailable = true;

                        if (available.length > COMPACT_THRESHOLD) {
                            // 大库：紧凑编号格式，全部发给 AI 做语义匹配
                            // 按优先级分组，高优先级标注
                            const lines = available.map((li, idx) => {
                                const prefix = li.weight >= 7 ? '★' : '';
                                const tagStr = li.tags ? `[${li.tags}]` : '';
                                return `${idx + 1}.${prefix}${tagStr} ${li.content}`;
                            });
                            allLibsPrompt += `\n【库: ${lib.name}】 ${lib.matchRule || '语义匹配最合适的条目'} (${available.length}条, ★=高优先)\n${lines.join('\n')}\n`;
                        } else {
                            // 小库：完整格式
                            const candidateText = available
                                .map(li => {
                                    const pl = li.weight <= 3 ? '低' : li.weight <= 6 ? '中' : li.weight <= 8 ? '高' : '极高';
                                    return `  [${li.id}] (优先级:${pl}, 剩余${lib.maxRepeat - getEffectiveUsedCount(li)}次) ${li.content}`;
                                })
                                .join('\n');
                            allLibsPrompt += `\n【库: ${lib.name}】 ${lib.matchRule || '语义匹配最合适的条目'} (${available.length}条)\n${candidateText}\n`;
                        }
                    }

                    if (!hasAvailable) {
                        if (stopRef.current) break;
                        setItems(prev => prev.map(i =>
                            i.id === item.id ? { ...i, status: 'error' as const, error: '所有库条目全部已达使用上限' } : i
                        ));
                        continue;
                    }

                    const libNames = itemLibs.map(l => l.name);
                    // 构建每个库的可用条目列表（用于编号→条目映射）
                    const libAvailableMap = new Map<string, LibraryItem[]>();
                    for (const lib of itemLibs) {
                        libAvailableMap.set(lib.id, lib.items.filter(li => getEffectiveUsedCount(li) < lib.maxRepeat));
                    }

                    const systemPrompt = `你是一个专业的文案改写专家。

【任务】
1. 分析原始文案内容
2. 从每个候选库中各选择一个最匹配的条目（按照每个库的使用指令）
3. 将选中的条目融入文案完成改写

【重要规则】
- 必须保持原文语言！英文文案输出英文，中文文案输出中文，绝对不要翻译！
- 只修改指令要求的部分，其余内容保持原样
- 优先选择标★的高优先级条目，但语义匹配更重要
- ⚠️ 每条文案必须选择不同的库条目！尽量多样化选择！${recentlyUsedIds.length > 0 ? `\n- 以下条目已被使用，请避免再选：${recentlyUsedIds.slice(-100).join(', ')}` : ''}

【输出格式】
严格按以下格式输出：
${libNames.map(n => `SELECTED_${n}: [选中条目的编号或ID]`).join('\n')}
RESULT: [改写后的完整文案，保持原文语言]
RESULT_ZH: [改写后文案的中文翻译]

注意：RESULT后面的改写文案必须完整，保持原文语言！RESULT_ZH是中文翻译（如果原文已经是中文则相同）。`;

                    let userPrompt = `【原始文案】
${item.originalForeign}
${allLibsPrompt}`;

                    if (extraInsts.length > 0) {
                        userPrompt += `\n\n【额外改写要求】\n${extraInsts.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}`;
                    }

                    const result = await ai.models.generateContent({
                        model: textModel,
                        contents: { role: 'user', parts: [{ text: userPrompt }] },
                        config: { systemInstruction: systemPrompt }
                    });

                    const responseText = result.text?.trim() || '';
                    const resultMatch = responseText.match(/RESULT:\s*(.+?)(?=\nRESULT_ZH:|$)/is);
                    const resultZhMatch = responseText.match(/RESULT_ZH:\s*([\s\S]+)/i);

                    if (stopRef.current) break;

                    if (resultMatch) {
                        const rewrittenText = resultMatch[1].trim();

                        // 解析每个库的选中条目并更新计数（支持编号和ID两种格式）
                        const matchedContents: string[] = [];
                        for (const lib of itemLibs) {
                            const selMatch = responseText.match(new RegExp(`SELECTED_${lib.name}:\\s*\\[?([^\\]\\n]+)\\]?`, 'i'));
                            const selectedValue = selMatch?.[1]?.trim() || '';
                            if (!selectedValue) continue;

                            const available = libAvailableMap.get(lib.id) || [];
                            let matchedItem: LibraryItem | undefined;

                            // 1. 按编号匹配（大库紧凑格式: "42" 或 "42.★ xxx"）
                            const numMatch = selectedValue.match(/^(\d+)/);
                            if (numMatch) {
                                const idx = parseInt(numMatch[1]) - 1;
                                if (idx >= 0 && idx < available.length) {
                                    matchedItem = available[idx];
                                }
                            }
                            // 2. 按 ID 匹配（小库完整格式）
                            if (!matchedItem) {
                                matchedItem = lib.items.find(li => li.id === selectedValue);
                            }
                            // 3. 按内容模糊匹配（兜底）
                            if (!matchedItem && selectedValue.length > 5) {
                                matchedItem = available.find(li => selectedValue.includes(li.content.slice(0, 10)) || li.content.includes(selectedValue.slice(0, 10)));
                            }

                            if (matchedItem) {
                                matchedContents.push(`${lib.name}: ${matchedItem.content}`);
                                recentlyUsedIds.push(matchedItem.id);
                                incrementLocalCount(matchedItem.id);
                                setLibraries(prev => prev.map(l => l.id === lib.id
                                    ? { ...l, items: l.items.map(li => li.id === matchedItem!.id ? { ...li, usedCount: li.usedCount + 1 } : li) }
                                    : l
                                ));
                            }
                        }

                        const chineseText = resultZhMatch?.[1]?.trim() || '';

                        setItems(prev => prev.map(i =>
                            i.id === item.id ? {
                                ...i,
                                status: 'success' as const,
                                resultForeign: rewrittenText,
                                resultChinese: chineseText,
                                libraryMatchedContent: matchedContents.join(' | ')
                            } : i
                        ));
                    } else {
                        setItems(prev => prev.map(i =>
                            i.id === item.id ? { ...i, status: 'error' as const, error: '解析失败: ' + responseText.slice(0, 100) } : i
                        ));
                    }
                } catch (error: any) {
                    if (stopRef.current) break;
                    setItems(prev => prev.map(i =>
                        i.id === item.id ? { ...i, status: 'error' as const, error: error.message || '处理失败' } : i
                    ));
                }
            }

            setIsProcessing(false);
            if (idleItems.length > 20) {
                setItems(prev => prev.map(i => ({ ...i, collapsed: true })));
                setAllCollapsed(true);
            }
            return;
        }

        // === 非拆分模式：过滤掉空指令 ===
        const activeInstructions = instructions.filter(inst => inst.trim());
        if (activeInstructions.length === 0) {
            if (mode === 'social-media') {
                // 自媒体模式：额外指令可选，重复 N 次获得多个结果
                const extraInst = instruction.trim() || '';
                for (let i = 0; i < socialMediaResultCount; i++) {
                    activeInstructions.push(extraInst);
                }
            } else if (instruction.trim()) {
                activeInstructions.push(instruction.trim());
            } else {
                activeInstructions.push(DEFAULT_INSTRUCTION);
            }
        }

        // === 批量处理模式（batchSize > 1，自媒体模式除外）===
        if (batchSize > 1 && mode !== 'social-media') {
            // 设置所有 idle 项目为 processing 状态
            setItems(prev => prev.map(item =>
                item.status === 'idle' ? { ...item, status: 'processing' as const } : item
            ));

            try {
                // 对于每个指令，批量处理所有项目
                for (const inst of activeInstructions) {
                    if (stopRef.current) break;

                    // 分批处理（并发3路）
                    const BATCH_CONCURRENT = 3;
                    const allBatches: CopywritingItem[][] = [];
                    for (let i = 0; i < idleItems.length; i += batchSize) {
                        allBatches.push(idleItems.slice(i, i + batchSize));
                    }
                    let batchIdx = 0;
                    const runNextBatch = async () => {
                        while (batchIdx < allBatches.length && !stopRef.current) {
                            const currentIdx = batchIdx++;
                            const batchItems = allBatches[currentIdx];

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
                        }
                    };
                    const workers = Array(Math.min(BATCH_CONCURRENT, allBatches.length)).fill(null).map(() => runNextBatch());
                    await Promise.all(workers);
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
                if (mode === 'social-media') {
                    // 自媒体模式：所有结果并发请求
                    const smPromises = activeInstructions.map(async (inst) => {
                        if (stopRef.current) return null;
                        const resultId = uuidv4();
                        try {
                            const ai = getAiInstance();
                            const enabledSections = socialMediaOutputSections.filter(s => s.enabled);
                            const sectionInstructions = enabledSections.map((s, si) => `${si + 1}. 【${s.name}】\n   要求: ${s.description}`).join('\n\n');
                            const sectionMarkers = enabledSections.map(s => `===【${s.name}】===`).join('\n...\n');
                            const userPrompt = `${inst}\n\n请根据以下原始文案进行完全改写。\n\n【输出分项要求】\n请严格按照以下分项输出，每个分项用对应的标记分隔：\n\n${sectionInstructions}\n\n【输出格式】\n${sectionMarkers}\n\n【重要】每个分项内的内容必须是干净的纯文本，直接就是可以用的文案。\n严禁在内容中出现：镜头指示（如"镜头平视"）、表演提示（如"眼神坚定"）、括号备注（如"（缓缓说）"）、任何非文案本身的标注。\n标题只输出标题文字本身（每行一个），正文只输出口播稿内容本身。\n\n【原始文案】\n${item.originalForeign}`;

                            const apiResult = await ai.models.generateContent({
                                model: textModel,
                                contents: { role: 'user', parts: [{ text: userPrompt }] },
                                config: { systemInstruction: socialMediaModeSystemInstruction }
                            });
                            const responseText = apiResult.text?.trim() || '';

                            const parsedSections: { name: string; content: string }[] = [];
                            for (let si = 0; si < enabledSections.length; si++) {
                                const section = enabledSections[si];
                                const marker = `===【${section.name}】===`;
                                const altMarker = `【${section.name}】`;
                                const nextSection = enabledSections[si + 1];
                                const nextMarker = nextSection ? `===【${nextSection.name}】===` : null;
                                const nextAltMarker = nextSection ? `【${nextSection.name}】` : null;
                                let startIdx = responseText.indexOf(marker);
                                let contentStart = startIdx !== -1 ? startIdx + marker.length : -1;
                                if (contentStart === -1) {
                                    const altIdx = responseText.indexOf(altMarker);
                                    contentStart = altIdx !== -1 ? altIdx + altMarker.length : -1;
                                }
                                let contentEnd = responseText.length;
                                if (nextMarker) {
                                    const ni = responseText.indexOf(nextMarker, contentStart > 0 ? contentStart : 0);
                                    if (ni !== -1) contentEnd = ni;
                                    else if (nextAltMarker) {
                                        const nai = responseText.indexOf(nextAltMarker, contentStart > 0 ? contentStart : 0);
                                        if (nai !== -1) contentEnd = nai;
                                    }
                                }
                                parsedSections.push({ name: section.name, content: contentStart !== -1 ? responseText.slice(contentStart, contentEnd).trim() : '' });
                            }
                            // 清除残留的标记文字
                            parsedSections.forEach(s => {
                                s.content = s.content
                                    .replace(new RegExp(`===?【${s.name}】===?`, 'g'), '')
                                    .replace(new RegExp(`【${s.name}】`, 'g'), '')
                                    .trim();
                            });
                            // 配对：每2个分项为一对（英文+中文），生成多个results
                            const halfIdx = Math.ceil(parsedSections.length / 2);
                            const pairedResults: InstructionResult[] = [];
                            for (let pi = 0; pi < halfIdx; pi++) {
                                const enSection = parsedSections[pi];
                                const cnSection = parsedSections[pi + halfIdx];
                                pairedResults.push({
                                    id: uuidv4(), instruction: inst, inputForeign: item.originalForeign,
                                    resultForeign: enSection?.content || '',
                                    resultChinese: cnSection?.content || '',
                                    status: 'success' as const, createdAt: Date.now()
                                });
                            }
                            return pairedResults;
                        } catch (error: any) {
                            return [{
                                id: resultId, instruction: inst, inputForeign: item.originalForeign,
                                resultForeign: '', resultChinese: '',
                                status: 'error' as const, error: error.message || '处理失败', createdAt: Date.now()
                            }];
                        }
                    });
                    const smResults = (await Promise.all(smPromises)).filter(Boolean).flat() as InstructionResult[];
                    results.push(...smResults);
                    lastForeign = smResults.find(r => r.status === 'success')?.resultForeign || '';
                    lastChinese = smResults.find(r => r.status === 'success')?.resultChinese || '';
                } else {
                // 非自媒体模式：顺序执行各指令
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
                            contents: { role: 'user', parts: [{ text: userPrompt }] },
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
                } // end else (non-social-media sequential)

                // 完成：设置最终状态
                const hasError = results.some(r => r.status === 'error');
                if (stopRef.current) return; // 停止后不更新
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
                if (stopRef.current) return; // 停止后不更新
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
        // 条目多时自动折叠
        if (idleItems.length > 20) {
            setItems(prev => prev.map(i => ({ ...i, collapsed: true })));
            setAllCollapsed(true);
        }
    };

    // --- Stop processing ---
    const handleStopProcessing = () => {
        stopRef.current = true;
        setIsProcessing(false);
        // 把所有还在 processing 的项目恢复为 idle
        setItems(prev => prev.map(item =>
            item.status === 'processing' ? { ...item, status: 'idle' as const } : item
        ));
    };

    // --- Copy functions (无空行) ---
    const handleCopy = (type: 'foreign' | 'chinese' | 'both' | 'all') => {
        // 库模式：结果存在 item.resultForeign / item.resultChinese，不在 instructionResults 里
        if (mode === 'library') {
            const successItems = items.filter(item => item.status === 'success' && item.resultForeign);
            if (successItems.length === 0) return;

            let headers: string[] = [];
            let rows: string[] = [];

            switch (type) {
                case 'foreign':
                    headers = ['改写结果'];
                    rows = successItems.map(item => escapeForSheet(item.resultForeign || ''));
                    break;
                case 'chinese':
                    headers = ['中文翻译'];
                    rows = successItems.map(item => escapeForSheet(item.resultChinese || ''));
                    break;
                case 'both':
                    headers = ['改写结果', '中文翻译'];
                    rows = successItems.map(item => `${escapeForSheet(item.resultForeign || '')}\t${escapeForSheet(item.resultChinese || '')}`);
                    break;
                case 'all':
                    headers = ['原文', '改写结果', '中文翻译', '匹配库条目'];
                    rows = successItems.map(item =>
                        `${escapeForSheet(item.originalForeign)}\t${escapeForSheet(item.resultForeign || '')}\t${escapeForSheet(item.resultChinese || '')}\t${escapeForSheet(item.libraryMatchedContent || '')}`
                    );
                    break;
            }

            const text = [headers.join('\t'), ...rows].join('\n');
            navigator.clipboard.writeText(text);
            setCopiedType(type);
            showCopyToast(`已复制${successItems.length}条结果`);
            setTimeout(() => setCopiedType(null), 2000);
            return;
        }

        // 包含所有有指令结果的项目（包括失败的），保持行对齐
        const allItems = items.filter(item => item.instructionResults && item.instructionResults.length > 0);
        if (allItems.length === 0) return;

        // 计算最大指令数
        const instructionCount = Math.max(...allItems.map(item => item.instructionResults?.length || 0));

        let headers: string[] = [];
        let rows: string[] = [];

        // 根据 mode === "voice" 决定列名
        const col1Name = mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文';
        const col2Name = mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文';

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

    // --- Process single item (重试/单条处理) - 支持多指令 + 库模式 ---
    const handleProcessSingleItem = async (item: CopywritingItem) => {
        setItems(prev => prev.map(i =>
            i.id === item.id ? { ...i, status: 'processing', instructionResults: [] } : i
        ));

        try {
            // === 库模式：复用批量处理的库匹配逻辑 ===
            if (mode === 'library') {
                const enabledLibs = libraries.filter(l => l.enabled && l.items.length > 0);
                if (enabledLibs.length === 0) throw new Error('请先启用至少一个有条目的库');
                const ai = getAiInstance();
                const extraInsts = libraryExtraInstructions.filter(i => i.trim());
                const itemLibIds = item.selectedLibraryIds && item.selectedLibraryIds.length > 0
                    ? item.selectedLibraryIds : enabledLibs.map(l => l.id);
                const itemLibs = libraries.filter(l => itemLibIds.includes(l.id) && l.items.length > 0);
                const COMPACT_THRESHOLD = 200;
                let allLibsPrompt = '';
                let hasAvailable = false;
                const libAvailableMap = new Map<string, LibraryItem[]>();
                for (const lib of itemLibs) {
                    const available = lib.items.filter(li => li.usedCount < lib.maxRepeat);
                    if (available.length === 0) continue;
                    hasAvailable = true;
                    libAvailableMap.set(lib.id, available);
                    if (available.length > COMPACT_THRESHOLD) {
                        const lines = available.map((li, idx) => {
                            const prefix = li.weight >= 7 ? '★' : '';
                            const tagStr = li.tags ? `[${li.tags}]` : '';
                            return `${idx + 1}.${prefix}${tagStr} ${li.content}`;
                        });
                        allLibsPrompt += `\n【库: ${lib.name}】 ${lib.matchRule || '语义匹配最合适的条目'} (${available.length}条, ★=高优先)\n${lines.join('\n')}\n`;
                    } else {
                        const candidateText = available.map(li => {
                            const pl = li.weight <= 3 ? '低' : li.weight <= 6 ? '中' : li.weight <= 8 ? '高' : '极高';
                            return `  [${li.id}] (优先级:${pl}, 剩余${lib.maxRepeat - li.usedCount}次) ${li.content}`;
                        }).join('\n');
                        allLibsPrompt += `\n【库: ${lib.name}】 ${lib.matchRule || '语义匹配最合适的条目'} (${available.length}条)\n${candidateText}\n`;
                    }
                }
                if (!hasAvailable) throw new Error('所有库条目全部已达使用上限');
                const libNames = itemLibs.map(l => l.name);
                const sysPrompt = `你是一个专业的文案改写专家。\n\n【任务】\n1. 分析原始文案内容\n2. 从每个候选库中各选择一个最匹配的条目\n3. 将选中的条目融入文案完成改写\n\n【重要规则】\n- 必须保持原文语言！\n- 只修改指令要求的部分，其余保持原样\n- 优先选择标★的条目，但语义匹配更重要\n${item.resultForeign ? `- ⚠️ 这是重试！请选择与上次不同的条目！上次用了: ${item.libraryMatchedContent || '未知'}` : ''}\n\n【输出格式】\n${libNames.map(n => `SELECTED_${n}: [选中条目的编号或ID]`).join('\n')}\nRESULT: [改写后的完整文案]\nRESULT_ZH: [中文翻译]`;
                let userPrompt = `【原始文案】\n${item.originalForeign}\n${allLibsPrompt}`;
                if (extraInsts.length > 0) userPrompt += `\n\n【额外要求】\n${extraInsts.map((inst, i) => `${i + 1}. ${inst}`).join('\n')}`;
                const result = await ai.models.generateContent({ model: textModel, contents: { role: 'user', parts: [{ text: userPrompt }] }, config: { systemInstruction: sysPrompt } });
                const responseText = result.text?.trim() || '';
                const resultMatch = responseText.match(/RESULT:\s*(.+?)(?=\nRESULT_ZH:|$)/is);
                const resultZhMatch = responseText.match(/RESULT_ZH:\s*([\s\S]+)/i);
                if (resultMatch) {
                    const rewrittenText = resultMatch[1].trim();
                    const matchedContents: string[] = [];
                    for (const lib of itemLibs) {
                        const selMatch = responseText.match(new RegExp(`SELECTED_${lib.name}:\\s*\\[?([^\\]\\n]+)\\]?`, 'i'));
                        const selectedValue = selMatch?.[1]?.trim() || '';
                        if (!selectedValue) continue;
                        const available = libAvailableMap.get(lib.id) || [];
                        let matchedItem: LibraryItem | undefined;
                        const numMatch = selectedValue.match(/^(\d+)/);
                        if (numMatch) { const idx = parseInt(numMatch[1]) - 1; if (idx >= 0 && idx < available.length) matchedItem = available[idx]; }
                        if (!matchedItem) matchedItem = lib.items.find(li => li.id === selectedValue);
                        if (!matchedItem && selectedValue.length > 5) matchedItem = available.find(li => selectedValue.includes(li.content.slice(0, 10)) || li.content.includes(selectedValue.slice(0, 10)));
                        if (matchedItem) {
                            matchedContents.push(`${lib.name}: ${matchedItem.content}`);
                            setLibraries(prev => prev.map(l => l.id === lib.id ? { ...l, items: l.items.map(li => li.id === matchedItem!.id ? { ...li, usedCount: li.usedCount + 1 } : li) } : l));
                        }
                    }
                    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'success' as const, resultForeign: rewrittenText, resultChinese: resultZhMatch?.[1]?.trim() || '', libraryMatchedContent: matchedContents.join(' | ') } : i));
                } else {
                    setItems(prev => prev.map(i => i.id === item.id ? { ...i, status: 'error' as const, error: '解析失败: ' + responseText.slice(0, 100) } : i));
                }
                return;
            }


            // 过滤有效指令
            let validInstructions = instructions.filter(inst => inst.trim());
            if (validInstructions.length === 0) {
                if (mode === 'social-media') {
                    // 自媒体模式：额外指令可选，为空时用默认空指令
                    validInstructions = [''];
                } else {
                    throw new Error('请输入至少一条有效指令');
                }
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
            } else if (mode === 'social-media') {
                // 自媒体改写模式：使用专用系统指令 + 动态分项
                systemPrompt = socialMediaModeSystemInstruction;
                const enabledSections = socialMediaOutputSections.filter(s => s.enabled);
                const sectionInstructions = enabledSections.map((s, idx) => `${idx + 1}. 【${s.name}】\n   要求: ${s.description}`).join('\n\n');
                const sectionMarkers = enabledSections.map(s => `===【${s.name}】===`).join('\n...\n');
                userPrompt = `${itemInstruction}

请根据以下原始文案进行完全改写。

【输出分项要求】
请严格按照以下分项输出，每个分项用对应的标记分隔：

${sectionInstructions}

【输出格式】
${sectionMarkers}

【原始文案】
${item.originalForeign}`;
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
                contents: { role: 'user', parts: [{ text: userPrompt }] },
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
            } else if (mode === 'social-media') {
                // 自媒体改写模式：根据动态分项解析
                const enabledSections = socialMediaOutputSections.filter(s => s.enabled);
                const parsedSections: { name: string; content: string }[] = [];
                for (let si = 0; si < enabledSections.length; si++) {
                    const section = enabledSections[si];
                    const marker = `===【${section.name}】===`;
                    const altMarker = `【${section.name}】`;
                    const nextSection = enabledSections[si + 1];
                    const nextMarker = nextSection ? `===【${nextSection.name}】===` : null;
                    const nextAltMarker = nextSection ? `【${nextSection.name}】` : null;
                    let startIdx = responseText.indexOf(marker);
                    let contentStart = startIdx !== -1 ? startIdx + marker.length : -1;
                    if (contentStart === -1) {
                        const altIdx = responseText.indexOf(altMarker);
                        contentStart = altIdx !== -1 ? altIdx + altMarker.length : -1;
                    }
                    let contentEnd = responseText.length;
                    if (nextMarker) {
                        const ni = responseText.indexOf(nextMarker, contentStart > 0 ? contentStart : 0);
                        if (ni !== -1) contentEnd = ni;
                        else if (nextAltMarker) {
                            const nai = responseText.indexOf(nextAltMarker, contentStart > 0 ? contentStart : 0);
                            if (nai !== -1) contentEnd = nai;
                        }
                    }
                    parsedSections.push({ name: section.name, content: contentStart !== -1 ? responseText.slice(contentStart, contentEnd).trim() : '' });
                }
                // 清除残留的标记文字
                parsedSections.forEach(s => {
                    s.content = s.content
                        .replace(new RegExp(`===?【${s.name}】===?`, 'g'), '')
                        .replace(new RegExp(`【${s.name}】`, 'g'), '')
                        .trim();
                });
                // 分列：前半→左列，后半→右列
                const halfIdx = Math.ceil(parsedSections.length / 2);
                const leftSections = parsedSections.slice(0, halfIdx);
                const rightSections = parsedSections.slice(halfIdx);
                return {
                    foreign: leftSections.map(s => s.content).join('\n\n').trim(),
                    chinese: rightSections.map(s => s.content).join('\n\n').trim()
                };
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

    // --- 拆分列管理 ---
    const addSplitColumn = () => {
        setSplitColumns(prev => [...prev, {
            id: uuidv4(),
            name: `列${prev.length + 1}`,
            description: ''
        }]);
    };

    const removeSplitColumn = (id: string) => {
        if (splitColumns.length <= 1) return;
        setSplitColumns(prev => prev.filter(col => col.id !== id));
    };

    const updateSplitColumn = (id: string, updates: Partial<SplitColumn>) => {
        setSplitColumns(prev => prev.map(col =>
            col.id === id ? { ...col, ...updates } : col
        ));
    };

    // --- 拆分模式处理单条 ---
    const processSplitItem = async (item: CopywritingItem): Promise<Record<string, string> | null> => {
        try {
            const ai = getAiInstance();

            const columnsDesc = splitColumns.map((col, idx) =>
                `第${idx + 1}列【${col.name}】：${col.description || '无特殊要求'}`
            ).join('\n');

            const systemPrompt = `${splitModeSystemInstruction}

【处理列定义】
${columnsDesc}

【输出格式】
严格按照 ${splitColumns.length} 列输出，列之间用 ||| 分隔。
示例：第1列内容|||第2列内容|||第3列内容`;

            const userPrompt = `请按照列定义处理以下文案，输出 ${splitColumns.length} 列结果：

${item.originalForeign}

严格按 ||| 分隔输出：`;

            const result = await ai.models.generateContent({
                model: textModel,
                contents: { role: 'user', parts: [{ text: userPrompt }] },
                config: {
                    systemInstruction: systemPrompt
                }
            });

            const responseText = result.text?.trim() || '';

            // 解析响应：按 ||| 分割
            const parts = responseText.split('|||').map(p => p.trim());
            const splitResults: Record<string, string> = {};
            splitColumns.forEach((col, idx) => {
                splitResults[col.id] = parts[idx] || '-';
            });

            return splitResults;
        } catch (error: any) {
            console.error('[CopywritingView] Split processing error:', error);
            throw error;
        }
    };

    // --- 拆分模式批量处理 ---
    const processSplitBatch = async (
        batchItems: CopywritingItem[]
    ): Promise<Map<string, Record<string, string>>> => {
        const ai = getAiInstance();
        const resultsMap = new Map<string, Record<string, string>>();

        const columnsDesc = splitColumns.map((col, idx) =>
            `第${idx + 1}列【${col.name}】：${col.description || '无特殊要求'}`
        ).join('\n');

        // 构建批量输入
        const batchInput = batchItems.map((item, idx) =>
            `[${idx + 1}] ${item.originalForeign.replace(/\n/g, ' ')}`
        ).join('\n');

        const systemPrompt = `${splitModeSystemInstruction}

【处理列定义】
${columnsDesc}

【输出格式】
对每条文案，严格按照 ${splitColumns.length} 列输出，列之间用 ||| 分隔。
每条结果以 [编号] 开头。
示例：
[1] 第1列内容|||第2列内容|||第3列内容
[2] 第1列内容|||第2列内容|||第3列内容`;

        const userPrompt = `请按照列定义分别处理以下 ${batchItems.length} 条文案，每条输出 ${splitColumns.length} 列结果：

${batchInput}

每条结果以 [编号] 开头，列之间用 ||| 分隔：`;

        const result = await ai.models.generateContent({
            model: textModel,
            contents: { role: 'user', parts: [{ text: userPrompt }] },
            config: {
                systemInstruction: systemPrompt
            }
        });

        const responseText = result.text?.trim() || '';

        // 解析批量响应 - 支持多行内容
        // 先按 [编号] 标记分割，而不是按换行分割
        const itemRegex = /\[(\d+)\]\s*/g;
        const markers: { idx: number; pos: number }[] = [];
        let m;
        while ((m = itemRegex.exec(responseText)) !== null) {
            markers.push({ idx: parseInt(m[1]) - 1, pos: m.index + m[0].length });
        }

        for (let mi = 0; mi < markers.length; mi++) {
            const { idx } = markers[mi];
            const start = markers[mi].pos;
            const end = mi + 1 < markers.length ? markers[mi + 1].pos - markers[mi + 1].idx.toString().length - 3 : responseText.length;
            // 取当前编号到下一编号之间的全部内容
            const rawContent = responseText.slice(start, end).trim();

            if (idx >= 0 && idx < batchItems.length) {
                const parts = rawContent.split('|||').map(p => p.trim());
                const splitResults: Record<string, string> = {};
                splitColumns.forEach((col, colIdx) => {
                    splitResults[col.id] = parts[colIdx] || '-';
                });
                resultsMap.set(batchItems[idx].id, splitResults);
            }
        }

        return resultsMap;
    };

    // --- 拆分模式复制列 ---
    const handleCopySplitColumn = (columnId: string) => {
        const successItems = items.filter(i => i.status === 'success' && i.splitResults);
        const col = splitColumns.find(c => c.id === columnId);
        if (!col) return;
        const text = successItems.map(item => item.splitResults?.[columnId] || '-').join('\n');
        navigator.clipboard.writeText(text);
        setCopiedType(`split_${columnId}`);
        showCopyToast(`已复制「${col.name}」列 (${successItems.length}条)`);
        setTimeout(() => setCopiedType(null), 1500);
    };

    // --- 拆分模式复制全部列（Tab分隔表格格式）---
    const handleCopySplitAll = () => {
        const successItems = items.filter(i => i.status === 'success' && i.splitResults);
        const headers = ['原文', ...splitColumns.map(col => col.name), ...(hasStats ? ['频率统计'] : [])].join('\t');
        const rows = successItems.map(item => {
            const cols = splitColumns.map(col => escapeForSheet(item.splitResults?.[col.id] || '-'));
            const statsCol = hasStats ? [escapeForSheet(getItemKeywordStatsText(item) || '-')] : [];
            return [escapeForSheet(item.originalForeign), ...cols, ...statsCol].join('\t');
        });
        navigator.clipboard.writeText([headers, ...rows].join('\n'));
        setCopiedType('split_all');
        showCopyToast(`已复制完整结果 (${successItems.length}条${hasStats ? ' + 统计' : ''})`);
        setTimeout(() => setCopiedType(null), 1500);
    };

    // --- 关键词频率统计 ---
    const computeKeywordFrequency = (columnId: string) => {
        const successItems = items.filter(i => i.status === 'success' && i.splitResults);
        const freqMap: Record<string, number> = {};

        for (const item of successItems) {
            const rawKeywords = item.splitResults?.[columnId] || '';
            if (!rawKeywords || rawKeywords === '-') continue;
            // 支持中英文逗号、顿号分隔
            const keywords = rawKeywords.split(/[,，、;；]+/).map(k => k.trim().toLowerCase()).filter(k => k && k !== '-');
            // 每条文案中同一关键词只计一次
            const unique = [...new Set(keywords)];
            for (const kw of unique) {
                freqMap[kw] = (freqMap[kw] || 0) + 1;
            }
        }

        setKeywordFreqMap(freqMap);
        setKeywordStatsColumnId(columnId);
        setKeywordStatsTotalItems(successItems.length);
        showCopyToast(`已统计 ${Object.keys(freqMap).length} 个关键词 (${successItems.length}条文案)`);
    };

    // 获取单条文案的关键词统计文本
    const getItemKeywordStatsText = (item: CopywritingItem): string => {
        if (!keywordStatsColumnId || !item.splitResults || Object.keys(keywordFreqMap).length === 0) return '';
        const rawKeywords = item.splitResults[keywordStatsColumnId] || '';
        if (!rawKeywords || rawKeywords === '-') return '-';
        const keywords = rawKeywords.split(/[,，、;；]+/).map(k => k.trim().toLowerCase()).filter(k => k && k !== '-');
        const unique = [...new Set(keywords)];
        return unique.map(kw => `${kw}(${keywordFreqMap[kw] || 0}/${keywordStatsTotalItems})`).join(', ');
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
                contents: { role: 'user', parts: [{ text: input }] },
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
                <div className="w-[65%] bg-zinc-900 border border-zinc-800 rounded-lg p-3">
                    <div className="flex items-center justify-between mb-2">
                        <div className="flex items-center gap-2">
                            <Settings2 size={14} className={mode === 'voice' ? 'text-purple-400' : mode === 'classify' ? 'text-cyan-400' : mode === 'split' ? 'text-orange-400' : mode === 'library' ? 'text-green-400' : mode === 'social-media' ? 'text-teal-400' : 'text-amber-400'} />
                            <span className="text-xs font-medium text-zinc-300">
                                {mode === 'voice' ? '人声文案指令' : mode === 'classify' ? '分类规则' : mode === 'split' ? '拆分列定义' : mode === 'library' ? '文案库配置' : mode === 'social-media' ? '自媒体改写指令' : '改写指令'}
                            </span>
                            {/* 模式切换按钮组 */}
                            <div className="flex items-center gap-0.5">
                                <button
                                    onClick={() => handleModeChange('standard')}
                                    className={`px-2 py-0.5 text-[10px] rounded-l-full transition-all border ${mode === 'standard'
                                        ? 'bg-amber-600 text-white border-amber-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="标准模式：文案改写 + 翻译"
                                >
                                    <FileEdit size={10} className="inline mr-0.5" /> 标准
                                </button>
                                <button
                                    onClick={() => handleModeChange('voice')}
                                    className={`px-2 py-0.5 text-[10px] transition-all border-y ${mode === 'voice'
                                        ? 'bg-purple-600 text-white border-purple-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="人声模式：ElevenLabs 配音标注"
                                >
                                    <Mic size={10} className="inline mr-0.5" /> 人声
                                </button>
                                <button
                                    onClick={() => handleModeChange('classify')}
                                    className={`px-2 py-0.5 text-[10px] transition-all border-y ${mode === 'classify'
                                        ? 'bg-cyan-600 text-white border-cyan-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="分类模式：按规则输出分类结果"
                                >
                                    <Tag size={10} className="inline mr-0.5" /> 分类
                                </button>
                                <button
                                    onClick={() => handleModeChange('split')}
                                    className={`px-2 py-0.5 text-[10px] transition-all border ${mode === 'split'
                                        ? 'bg-orange-600 text-white border-orange-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="拆分模式：按自定义列智能拆分文案结构"
                                >
                                    <Scissors size={10} className="inline mr-0.5" /> 拆分
                                </button>
                                <button
                                    onClick={() => handleModeChange('library')}
                                    className={`px-2 py-0.5 text-[10px] transition-all border ${mode === 'library'
                                        ? 'bg-green-600 text-white border-green-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="文案库模式：语义匹配文案库 + 智能改写"
                                >
                                    <Library size={10} className="inline mr-0.5" /> 文案库
                                </button>
                                <button
                                    onClick={() => handleModeChange('social-media')}
                                    className={`px-2 py-0.5 text-[10px] rounded-r-full transition-all border ${mode === 'social-media'
                                        ? 'bg-teal-600 text-white border-teal-500'
                                        : 'bg-zinc-800 text-zinc-400 border-zinc-700 hover:bg-zinc-700'
                                        } tooltip-bottom`}
                                    data-tip="自媒体改写：信仰短视频口播稿改写"
                                >
                                    <Share2 size={10} className="inline mr-0.5" /> 自媒体
                                </button>
                            </div>
                            {/* 显示差异开关 - 标准/库模式 */}
                            {(mode === 'standard' || mode === 'library') && (
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
                            <div className="relative" ref={batchSettingsRef}>
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
                                                onClick={() => { setBatchSize(1); setShowBatchSettings(false); }}
                                                className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600"
                                            >
                                                单条
                                            </button>
                                            <button
                                                onClick={() => { setBatchSize(20); setShowBatchSettings(false); }}
                                                className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600"
                                            >
                                                ×20
                                            </button>
                                            <button
                                                onClick={() => { setBatchSize(50); setShowBatchSettings(false); }}
                                                className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600"
                                            >
                                                ×50
                                            </button>
                                            <button
                                                onClick={() => { setBatchSize(100); setShowBatchSettings(false); }}
                                                className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600"
                                            >
                                                ×100
                                            </button>
                                            <button
                                                onClick={() => { setBatchSize(500); setShowBatchSettings(false); }}
                                                className="text-[9px] px-1.5 py-0.5 rounded bg-zinc-700 hover:bg-zinc-600"
                                            >
                                                ×500
                                            </button>
                                            <button
                                                onClick={() => { setBatchSize(2000); setShowBatchSettings(false); }}
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
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded transition-colors text-amber-500 hover:text-amber-400 hover:bg-amber-900/20 disabled:opacity-50 tooltip-bottom"
                                data-tip="保存当前指令为预设"
                            >
                                <Save size={10} /> 保存
                            </button>
                            {/* 管理预设 */}
                            <button
                                onClick={() => setShowPresetManager(true)}
                                className="flex items-center gap-0.5 px-1.5 py-0.5 text-[10px] rounded transition-colors text-blue-400 hover:text-blue-300 hover:bg-blue-900/20 tooltip-bottom"
                                data-tip="管理预设"
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
                    {/* === 拆分模式：列编辑器 === */}
                    {mode === 'split' ? (
                        <div className="space-y-1.5 max-h-60 overflow-y-auto overflow-x-hidden">
                            {splitColumns.map((col, idx) => (
                                <div key={col.id} className="bg-zinc-950 border border-orange-900/30 rounded-lg p-2">
                                    <div className="flex items-center gap-1.5 mb-1">
                                        <span className="text-[10px] text-orange-400 font-bold w-4 shrink-0">{idx + 1}.</span>
                                        <input
                                            type="text"
                                            value={col.name}
                                            onChange={(e) => updateSplitColumn(col.id, { name: e.target.value })}
                                            placeholder="列名（如：钩子）"
                                            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-0.5 text-xs text-orange-200 focus:outline-none focus:border-orange-500 placeholder-zinc-600"
                                        />
                                        {splitColumns.length > 1 && (
                                            <button
                                                onClick={() => removeSplitColumn(col.id)}
                                                className="p-0.5 text-zinc-500 hover:text-red-400"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>
                                    <textarea
                                        value={col.description}
                                        onChange={(e) => updateSplitColumn(col.id, { description: e.target.value })}
                                        onDoubleClick={() => setEditingSplitColumnId(col.id)}
                                        placeholder="提取要求（双击放大编辑）"
                                        data-tip="双击弹框编辑"
                                        className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-orange-500 placeholder-zinc-600 resize-none tooltip-bottom cursor-pointer"
                                        rows={1}
                                    />
                                </div>
                            ))}
                            <div className="flex items-center gap-2 flex-wrap">
                                <button
                                    onClick={addSplitColumn}
                                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-orange-400 hover:bg-orange-900/20 rounded border border-orange-900/30"
                                >
                                    <Plus size={10} /> 添加列
                                </button>
                                <span className="text-zinc-600">|</span>
                                <span className="text-[10px] text-zinc-500">预设：</span>
                                {SPLIT_COLUMN_PRESETS.map(preset => (
                                    <button
                                        key={preset.id}
                                        onClick={() => setSplitColumns(preset.columns.map(c => ({ ...c })))}
                                        className="px-2 py-0.5 text-[10px] text-amber-300 hover:bg-amber-900/20 rounded border border-amber-900/30"
                                    >
                                        {preset.name}
                                    </button>
                                ))}
                                <span className="text-zinc-600">|</span>
                                <button
                                    onClick={() => setSplitColumns(DEFAULT_SPLIT_COLUMNS)}
                                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded border border-zinc-700/50"
                                >
                                    <RotateCw size={10} /> 重置默认
                                </button>
                            </div>
                        </div>
                    ) : mode === 'library' ? (
                        <div className="space-y-2 max-h-60 overflow-y-auto overflow-x-hidden">
                            {/* 当前文案库概览（简洁版，详细管理在编辑库弹窗中） */}
                            {(() => {
                                const enabledLibs = libraries.filter(l => l.enabled);
                                return (
                                    <div className="bg-zinc-950 border border-green-900/30 rounded-lg p-2">
                                        <div className="flex items-center justify-between mb-1.5">
                                            <div className="flex items-center gap-2">
                                                <span className="text-green-400 text-xs font-medium">📚 文案库</span>
                                                <span className="text-[10px] text-zinc-500">
                                                    {enabledLibs.length}/{libraries.length} 启用
                                                </span>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <button
                                                    onClick={() => {
                                                        setLibraries(prev => prev.map(l => ({ ...l, items: l.items.map(i => ({ ...i, usedCount: 0 })) })));
                                                        showCopyToast('已重置所有库的使用计数');
                                                    }}
                                                    className="px-1.5 py-0.5 text-[9px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded"
                                                >
                                                    <RotateCw size={9} className="inline mr-0.5" /> 重置计数
                                                </button>
                                                <button
                                                    onClick={() => setShowLibraryEditor(true)}
                                                    className="px-1.5 py-0.5 text-[9px] text-green-400 hover:bg-green-900/20 rounded border border-green-900/30"
                                                >
                                                    <Settings2 size={9} className="inline mr-0.5" /> 编辑库
                                                </button>
                                            </div>
                                        </div>
                                        {/* 已启用的库 + 可编辑指令 */}
                                        <div className="space-y-1">
                                            {enabledLibs.map(lib => (
                                                <div key={lib.id} className="flex items-center gap-1.5 px-1.5 py-1 bg-zinc-800/60 rounded">
                                                    <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: lib.color }} />
                                                    <span className="text-[10px] text-zinc-300 font-medium shrink-0">{lib.name}</span>
                                                    <span className="text-[9px] text-zinc-600 shrink-0">
                                                        {lib.items.filter(i => i.usedCount < lib.maxRepeat).length}/{lib.items.length}
                                                    </span>
                                                    <input
                                                        type="text"
                                                        value={lib.matchRule}
                                                        onChange={(e) => setLibraries(prev => prev.map(l => l.id === lib.id ? { ...l, matchRule: e.target.value } : l))}
                                                        onDoubleClick={() => setEditingLibField({ type: 'matchRule', libId: lib.id })}
                                                        className="flex-1 bg-transparent border-none text-[10px] text-zinc-500 focus:text-zinc-200 focus:outline-none focus:bg-zinc-900/50 rounded px-1 truncate cursor-pointer"
                                                        placeholder="使用指令（双击放大）"
                                                        title="双击放大编辑"
                                                    />
                                                </div>
                                            ))}
                                            {enabledLibs.length === 0 && (
                                                <span className="text-[10px] text-zinc-600 italic">无启用的库，点击"编辑库"添加</span>
                                            )}
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* 额外改写指令（全局，可选） */}
                            <div className="bg-zinc-950 border border-green-900/30 rounded-lg p-2">
                                <div className="text-[10px] text-green-400 font-medium mb-1">额外改写指令（可选）</div>
                                {libraryExtraInstructions.map((inst, idx) => (
                                    <div key={idx} className="flex items-start gap-1 mb-1">
                                        <span className="text-[10px] text-green-400 w-4 shrink-0 mt-1">{idx + 1}.</span>
                                        <textarea
                                            value={inst}
                                            onChange={(e) => {
                                                setLibraryExtraInstructions(prev => {
                                                    const next = [...prev];
                                                    next[idx] = e.target.value;
                                                    return next;
                                                });
                                            }}
                                            onDoubleClick={() => setEditingLibField({ type: 'extraInst', idx })}
                                            placeholder="如：把标题改为疑问句"
                                            data-tip="双击放大编辑"
                                            className="flex-1 bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-[11px] text-zinc-300 focus:outline-none focus:border-green-500 placeholder-zinc-600 resize-none tooltip-bottom cursor-pointer"
                                            rows={1}
                                        />
                                        {/* 预设选择按钮 */}
                                        <button
                                            onClick={() => setActivePresetDropdown(activePresetDropdown === -(200 + idx) ? null : -(200 + idx))}
                                            className={`p-1 rounded transition-colors mt-0.5 ${activePresetDropdown === -(200 + idx)
                                                ? 'text-amber-400 bg-amber-900/30'
                                                : 'text-zinc-500 hover:text-amber-400 hover:bg-zinc-800'
                                                } tooltip-bottom`}
                                            data-tip="选择预设"
                                        >
                                            <ChevronDown size={12} />
                                        </button>
                                        {libraryExtraInstructions.length > 1 && (
                                            <button
                                                onClick={() => setLibraryExtraInstructions(prev => prev.filter((_, i) => i !== idx))}
                                                className="p-0.5 text-zinc-500 hover:text-red-400 mt-0.5"
                                            >
                                                <X size={12} />
                                            </button>
                                        )}
                                    </div>
                                ))}
                                {/* 预设下拉（当某个额外指令激活时显示） */}
                                {activePresetDropdown !== null && activePresetDropdown <= -200 && (
                                    <div className="mt-1 bg-zinc-950 border border-amber-700/50 rounded-lg p-2">
                                        <div className="text-[10px] text-amber-400 mb-1.5">
                                            选择预设填充到指令 {-(activePresetDropdown) - 200 + 1}：
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {BUILTIN_PRESETS.map(preset => (
                                                <button
                                                    key={preset.id}
                                                    onClick={() => {
                                                        const targetIdx = -(activePresetDropdown!) - 200;
                                                        setLibraryExtraInstructions(prev => {
                                                            const next = [...prev];
                                                            next[targetIdx] = preset.instruction;
                                                            return next;
                                                        });
                                                        setActivePresetDropdown(null);
                                                    }}
                                                    className="px-2 py-1 bg-zinc-800 hover:bg-amber-900/30 text-xs text-amber-300 rounded border border-zinc-700 hover:border-amber-600 truncate max-w-[150px]"
                                                    title={preset.instruction}
                                                >
                                                    {preset.name}
                                                </button>
                                            ))}
                                            {presets.map(preset => (
                                                <button
                                                    key={preset.id}
                                                    onClick={() => {
                                                        const targetIdx = -(activePresetDropdown!) - 200;
                                                        setLibraryExtraInstructions(prev => {
                                                            const next = [...prev];
                                                            next[targetIdx] = preset.instruction;
                                                            return next;
                                                        });
                                                        setActivePresetDropdown(null);
                                                    }}
                                                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-xs text-zinc-200 rounded border border-zinc-700 truncate max-w-[150px]"
                                                    title={preset.instruction}
                                                >
                                                    {preset.name}
                                                </button>
                                            ))}
                                        </div>
                                    </div>
                                )}
                                <button
                                    onClick={() => setLibraryExtraInstructions(prev => [...prev, ''])}
                                    className="flex items-center gap-1 px-2 py-0.5 text-[10px] text-green-400 hover:bg-green-900/20 rounded border border-green-900/30"
                                >
                                    <Plus size={10} /> 添加指令
                                </button>
                            </div>
                        </div>
                    ) : mode === 'social-media' ? (
                        <div className="space-y-2">
                            {/* 系统指令 - 可折叠 */}
                            <div className="bg-zinc-950 border border-teal-900/30 rounded-lg">
                                <button
                                    onClick={() => setSocialMediaShowSystemInstruction(prev => !prev)}
                                    className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-teal-900/10 transition-colors rounded-lg"
                                >
                                    <div className="flex items-center gap-1.5">
                                        {socialMediaShowSystemInstruction ? <ChevronDown size={12} className="text-teal-400/60" /> : <ChevronUp size={12} className="text-teal-400/60 -rotate-90" />}
                                        <span className="text-teal-400 text-xs font-medium">📱 系统指令</span>
                                        {!socialMediaShowSystemInstruction && <span className="text-[9px] text-zinc-500 truncate max-w-[180px]">{socialMediaModeSystemInstruction.slice(0, 40)}...</span>}
                                    </div>
                                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                        <button
                                            onClick={() => setSocialMediaModeSystemInstruction(SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION)}
                                            className="px-1.5 py-0.5 text-[9px] text-teal-400/60 hover:text-teal-400 rounded bg-teal-900/20 hover:bg-teal-900/40 transition-colors"
                                        >
                                            重置
                                        </button>
                                    </div>
                                </button>
                                {socialMediaShowSystemInstruction && (
                                    <div className="px-2 pb-2">
                                        <textarea
                                            value={socialMediaModeSystemInstruction}
                                            onChange={(e) => setSocialMediaModeSystemInstruction(e.target.value)}
                                            onDoubleClick={() => setEditingSocialMediaField({ type: 'systemInstruction' })}
                                            placeholder={SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION}
                                            data-tip="双击弹框编辑"
                                            className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1.5 text-[11px] text-zinc-300 focus:outline-none focus:border-teal-500 placeholder-zinc-600 resize-y min-h-[200px] max-h-[500px] leading-relaxed cursor-pointer tooltip-bottom"
                                            rows={12}
                                        />
                                    </div>
                                )}
                            </div>
                            {/* 输出分项编辑器 - 可折叠 */}
                            <div className="bg-zinc-950 border border-teal-900/20 rounded-lg">
                                <button
                                    onClick={() => setSocialMediaShowOutputSections(prev => !prev)}
                                    className="w-full flex items-center justify-between px-2 py-1.5 hover:bg-teal-900/10 transition-colors rounded-lg"
                                >
                                    <div className="flex items-center gap-1.5">
                                        {socialMediaShowOutputSections ? <ChevronDown size={12} className="text-teal-400/60" /> : <ChevronUp size={12} className="text-teal-400/60 -rotate-90" />}
                                        <span className="text-[10px] text-teal-400 font-medium">📤 输出分项（{socialMediaOutputSections.filter(s => s.enabled).length} 个启用）</span>
                                        <div className="flex items-center gap-1">
                                            {socialMediaOutputSections.filter(s => s.enabled).map((s) => (
                                                <span key={s.id} className="px-1 py-0 rounded text-[9px] bg-teal-900/20 text-teal-400/80">{s.name}</span>
                                            ))}
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1" onClick={e => e.stopPropagation()}>
                                        <button
                                            onClick={() => setSocialMediaOutputSections(DEFAULT_SOCIAL_MEDIA_OUTPUT_SECTIONS.map(s => ({ ...s })))}
                                            className="px-1 py-0.5 text-[9px] text-zinc-500 hover:text-teal-400 rounded hover:bg-zinc-800 transition-colors"
                                        >
                                            重置
                                        </button>
                                        <button
                                            onClick={() => setSocialMediaOutputSections(prev => [...prev, { id: uuidv4(), name: '新分项', description: '请描述这个分项的输出要求...', enabled: true }])}
                                            className="px-1 py-0.5 text-[9px] text-teal-400 hover:text-teal-300 rounded hover:bg-teal-900/20 transition-colors flex items-center gap-0.5"
                                        >
                                            <Plus size={9} /> 添加
                                        </button>
                                    </div>
                                </button>
                                {socialMediaShowOutputSections && (
                                    <div className="px-2 pb-2 space-y-1">
                                        {socialMediaOutputSections.map((section, idx) => (
                                            <div key={section.id} className={`border rounded transition-all ${section.enabled ? 'border-teal-900/30 bg-teal-900/10' : 'border-zinc-800 bg-zinc-900/30 opacity-50'}`}>
                                                <div className="flex items-center gap-1 px-1.5" style={{ height: '22px' }}>
                                                    <button
                                                        onClick={() => setSocialMediaOutputSections(prev => prev.map(s => s.id === section.id ? { ...s, enabled: !s.enabled } : s))}
                                                        className={`w-3 h-3 rounded border flex items-center justify-center shrink-0 ${section.enabled ? 'border-teal-500/50 bg-teal-500/20' : 'border-zinc-700 bg-zinc-800'}`}
                                                    >
                                                        {section.enabled && <Check className="w-2 h-2 text-teal-400" />}
                                                    </button>
                                                    <span className="text-teal-400/60 shrink-0" style={{ fontSize: '9px' }}>{idx + 1}.</span>
                                                    <input
                                                        type="text"
                                                        value={section.name}
                                                        onChange={e => setSocialMediaOutputSections(prev => prev.map(s => s.id === section.id ? { ...s, name: e.target.value } : s))}
                                                        className="flex-1 bg-transparent text-zinc-200 focus:outline-none border-b border-transparent focus:border-teal-500/50 min-w-0"
                                                        style={{ fontSize: '10px', lineHeight: '18px', padding: '0 2px' }}
                                                        placeholder="分项名称"
                                                    />
                                                    {socialMediaOutputSections.length > 1 && (
                                                        <button
                                                            onClick={() => setSocialMediaOutputSections(prev => prev.filter(s => s.id !== section.id))}
                                                            className="p-0.5 text-zinc-600 hover:text-red-400 transition-colors"
                                                        >
                                                            <X size={9} />
                                                        </button>
                                                    )}
                                                </div>
                                                <div className="px-1.5 pb-1">
                                                    <textarea
                                                        value={section.description}
                                                        onChange={e => setSocialMediaOutputSections(prev => prev.map(s => s.id === section.id ? { ...s, description: e.target.value } : s))}
                                                        onDoubleClick={() => setEditingSocialMediaField({ type: 'sectionDesc', sectionId: section.id })}
                                                        placeholder="描述输出要求（双击放大编辑）"
                                                        data-tip="双击弹框编辑"
                                                        className="w-full bg-zinc-900/50 border border-zinc-700/50 rounded px-1.5 text-zinc-400 focus:outline-none focus:border-teal-500/30 placeholder-zinc-600 resize-none leading-relaxed cursor-pointer tooltip-bottom"
                                                        style={{ fontSize: '9px', padding: '2px 6px' }}
                                                        rows={1}
                                                    />
                                                </div>
                                            </div>
                                        ))}
                                        <div style={{ fontSize: '9px' }} className="text-zinc-600 mt-0.5">第 1 个分项 → 左列 · 其余 → 右列 · 双击描述放大编辑</div>
                                    </div>
                                )}
                            </div>
                            {/* 额外改写指令 */}
                            <div className="bg-zinc-950 border border-teal-900/20 rounded-lg p-2">
                                <div className="flex items-center justify-between mb-1">
                                    <div className="text-[10px] text-teal-400 font-medium">🎯 额外改写指令（可选）</div>
                                    <div className="flex items-center gap-1">
                                        <span style={{ fontSize: '9px' }} className="text-zinc-500">每文案</span>
                                        <select
                                            value={socialMediaResultCount}
                                            onChange={e => setSocialMediaResultCount(Number(e.target.value))}
                                            className="bg-zinc-800 border border-zinc-700 rounded text-teal-300 focus:outline-none focus:border-teal-500 cursor-pointer"
                                            style={{ fontSize: '10px', padding: '1px 4px' }}
                                        >
                                            {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map(n => (
                                                <option key={n} value={n}>{n}个结果</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                                <textarea
                                    value={instructions[0] || ''}
                                    onChange={(e) => updateInstruction(0, e.target.value)}
                                    onDoubleClick={() => setEditingInstructionIndex(0)}
                                    placeholder="（可选）在这里输入额外的改写要求，比如：语气更活泼、主题偏向恩典..."
                                    data-tip="双击弹框编辑"
                                    className="w-full bg-zinc-900 border border-zinc-700 rounded px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:border-teal-500 placeholder-zinc-600 resize-none min-h-[36px] cursor-pointer tooltip-bottom"
                                    rows={2}
                                />
                            </div>
                        </div>
                    ) : (
                        <>
                            {/* 多指令列表 */}
                            <div className="space-y-1.5 max-h-48 overflow-y-auto overflow-x-hidden">
                                {instructions.map((inst, idx) => (
                                    <div key={idx} className="flex items-start gap-1">
                                        <span className="text-[10px] text-amber-400 w-4 shrink-0 mt-1.5">{idx + 1}.</span>
                                        <div className="flex-1 relative tooltip-bottom">
                                            <textarea
                                                value={inst}
                                                onChange={(e) => updateInstruction(idx, e.target.value)}
                                                onDoubleClick={() => setEditingInstructionIndex(idx)}
                                                placeholder="输入改写指令..."
                                                data-tip="双击弹框编辑"
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
                                                } tooltip-bottom`}
                                            data-tip="选择预设"
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
                        </>
                    )}
                </div>

                {/* 输入文案 (右侧 45%) */}
                <div className="w-[35%] bg-zinc-900 border border-zinc-800 rounded-lg p-3">
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
                            disabled={stats.idle === 0 || (mode !== 'split' && mode !== 'library' && mode !== 'social-media' && !instructions.some(i => i.trim()))}
                            className={`flex items-center gap-1 px-3 py-1.5 ${mode === 'split' ? 'bg-orange-600 hover:bg-orange-500' : mode === 'library' ? 'bg-green-600 hover:bg-green-500' : mode === 'social-media' ? 'bg-teal-600 hover:bg-teal-500' : 'bg-purple-600 hover:bg-purple-500'} text-white rounded text-xs font-medium disabled:opacity-50`}
                        >
                            <Play size={14} /> {mode === 'split' ? '开始拆分' : mode === 'library' ? '开始匹配改写' : mode === 'social-media' ? '开始改写' : '开始改写'}
                        </button>
                    )}
                </div>
            </div>

            {/* --- Results --- */}
            {items.length > 0 && (
                <div className="w-full max-w-none mx-auto flex-1">

                    {/* 库模式：多选批量分配工具栏 */}
                    {mode === 'library' && (
                        <div className="flex items-center gap-2 mb-2 flex-wrap">
                            <button
                                onClick={() => setItems(prev => prev.map(i => ({ ...i, selected: !prev.every(p => p.selected) })))}
                                className="px-2 py-1 text-[10px] text-green-400 hover:bg-green-900/20 rounded border border-green-900/30"
                            >
                                {items.every(i => i.selected) ? '取消全选' : '全选'}
                            </button>
                            {items.some(i => i.selected) && (
                                <>
                                    <span className="text-[10px] text-zinc-500">已选 {items.filter(i => i.selected).length} 条</span>
                                    <span className="text-[10px] text-zinc-600">|</span>
                                    <span className="text-[10px] text-zinc-500">指定库:</span>
                                    {libraries.map(lib => {
                                        const selectedItems = items.filter(i => i.selected);
                                        const allHaveLib = selectedItems.every(i => (i.selectedLibraryIds || []).includes(lib.id));
                                        return (
                                            <button
                                                key={lib.id}
                                                onClick={() => {
                                                    setItems(prev => prev.map(i => {
                                                        if (!i.selected) return i;
                                                        const current = i.selectedLibraryIds || [];
                                                        if (allHaveLib) {
                                                            return { ...i, selectedLibraryIds: current.filter(id => id !== lib.id) };
                                                        } else {
                                                            return { ...i, selectedLibraryIds: [...new Set([...current, lib.id])] };
                                                        }
                                                    }));
                                                }}
                                                className={`flex items-center gap-1 px-1.5 py-0.5 text-[9px] rounded ${allHaveLib ? 'bg-green-800 text-green-200' : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700'}`}
                                            >
                                                <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: lib.color }} />
                                                {lib.name}
                                            </button>
                                        );
                                    })}
                                    <button
                                        onClick={() => setItems(prev => prev.map(i => i.selected ? { ...i, selectedLibraryIds: undefined } : i))}
                                        className="px-1.5 py-0.5 text-[9px] text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded"
                                    >
                                        清除指定
                                    </button>
                                </>
                            )}
                        </div>
                    )}

                    {/* 复制按钮栏 */}
                    {stats.success > 0 && (
                        <div className="flex items-center gap-2 mb-4 flex-wrap">
                            <span className="text-xs text-zinc-500">批量复制:</span>

                            {/* === 拆分模式复制按钮 === */}
                            {mode === 'split' ? (
                                <>
                                    {splitColumns.map(col => (
                                        <button
                                            key={`copy_split_${col.id}`}
                                            onClick={() => handleCopySplitColumn(col.id)}
                                            className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedType === `split_${col.id}`
                                                ? 'bg-orange-600 text-white'
                                                : 'bg-orange-900/30 hover:bg-orange-800/40 text-orange-300 border border-orange-700/30'
                                                }`}
                                        >
                                            {copiedType === `split_${col.id}` ? <Check size={12} /> : <Copy size={12} />}
                                            {col.name}
                                        </button>
                                    ))}
                                    <span className="text-zinc-600">|</span>
                                    <button
                                        onClick={handleCopySplitAll}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedType === 'split_all'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                            }`}
                                    >
                                        {copiedType === 'split_all' ? <Check size={12} /> : <Columns size={12} />}
                                        全部列（表格）
                                    </button>

                                    {/* 关键词频率统计 */}
                                    <span className="text-zinc-600">|</span>
                                    <select
                                        value={keywordStatsColumnId || ''}
                                        onChange={(e) => setKeywordStatsColumnId(e.target.value || null)}
                                        className="px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-xs text-zinc-300"
                                    >
                                        <option value="">选择统计列...</option>
                                        {splitColumns.map(col => (
                                            <option key={col.id} value={col.id}>{col.name}</option>
                                        ))}
                                    </select>
                                    <button
                                        onClick={() => {
                                            const colId = keywordStatsColumnId || splitColumns.find(c => c.name.includes('关键词'))?.id || splitColumns[splitColumns.length - 1]?.id;
                                            if (colId) computeKeywordFrequency(colId);
                                        }}
                                        disabled={stats.success === 0}
                                        className="flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors bg-sky-900/30 hover:bg-sky-800/40 text-sky-300 border border-sky-700/30 disabled:opacity-50"
                                    >
                                        <FileText size={12} />
                                        统计关键词频率
                                    </button>
                                    {hasStats && (
                                        <>
                                            <span className="text-[10px] text-sky-400">
                                                已统计 {statsKeyCount} 个词 / {keywordStatsTotalItems} 条
                                            </span>
                                            <button
                                                onClick={() => {
                                                    const successItems = items.filter(i => i.status === 'success' && i.splitResults);
                                                    // 汇总表：关键词\t出现次数\t频率
                                                    const sortedKeywords = Object.entries(keywordFreqMap)
                                                        .sort((a, b) => b[1] - a[1])
                                                        .map(([kw, count]) => `${kw}\t${count}\t${(count / keywordStatsTotalItems * 100).toFixed(1)}%`);
                                                    const header = `关键词\t出现次数\t频率(总${keywordStatsTotalItems}条)`;
                                                    navigator.clipboard.writeText([header, ...sortedKeywords].join('\n'));
                                                    setCopiedType('stats_all');
                                                    showCopyToast(`已复制 ${sortedKeywords.length} 个关键词统计`);
                                                    setTimeout(() => setCopiedType(null), 1500);
                                                }}
                                                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedType === 'stats_all'
                                                    ? 'bg-sky-600 text-white'
                                                    : 'bg-sky-900/30 hover:bg-sky-800/40 text-sky-300 border border-sky-700/30'
                                                    }`}
                                            >
                                                {copiedType === 'stats_all' ? <Check size={12} /> : <Copy size={12} />}
                                                复制统计表
                                            </button>
                                            <button
                                                onClick={() => { setKeywordFreqMap({}); setKeywordStatsColumnId(null); setKeywordStatsTotalItems(0); }}
                                                className="text-[10px] text-zinc-500 hover:text-zinc-300"
                                            >清除</button>
                                        </>
                                    )}
                                </>
                            ) : (
                                <>
                                    <button
                                        onClick={() => handleCopy('foreign')}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedType === 'foreign'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                            }`}
                                    >
                                        {copiedType === 'foreign' ? <Check size={12} /> : <Copy size={12} />}
                                        {mode === "voice" ? '加标签' : mode === 'library' ? '改写结果' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文'}
                                    </button>
                                    <button
                                        onClick={() => handleCopy('chinese')}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedType === 'chinese'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                            }`}
                                    >
                                        {copiedType === 'chinese' ? <Check size={12} /> : <Copy size={12} />}
                                        {mode === "voice" ? '断句' : mode === 'library' ? '中文翻译' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文'}
                                    </button>
                                    <button
                                        onClick={() => handleCopy('both')}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedType === 'both'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                            }`}
                                    >
                                        {copiedType === 'both' ? <Check size={12} /> : <Copy size={12} />}
                                        {mode === "voice" ? '标签+断句' : mode === 'library' ? '结果+翻译' : mode === 'social-media' ? socialMediaOutputSections.filter(s => s.enabled).map(s => s.name).join('+') : '结果两列'}
                                    </button>
                                    <button
                                        onClick={() => handleCopy('all')}
                                        className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors ${copiedType === 'all'
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700'
                                            }`}
                                    >
                                        {copiedType === 'all' ? <Check size={12} /> : <Copy size={12} />}
                                        {mode === 'library' ? '全部列' : '全部四列'}
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
                                                        const col1Name = mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文';
                                                        const col2Name = mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文';
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

                            {/* 保存到表格按钮 */}
                            <button
                                onClick={handleSaveToSheet}
                                disabled={sheetSaveStatus === 'saving'}
                                className={`flex items-center gap-1 px-2.5 py-1 rounded text-xs transition-colors border ${sheetSaveStatus === 'success' ? 'bg-emerald-600/30 text-emerald-300 border-emerald-500/50' :
                                    sheetSaveStatus === 'error' ? 'bg-red-600/20 text-red-400 border-red-500/30' :
                                        'bg-blue-600/20 hover:bg-blue-600/30 text-blue-400 border-blue-600/30'
                                    }`}
                                title={sheetSaveStatus === 'error' ? sheetSaveError : '保存到 Google Sheets'}
                            >
                                {sheetSaveStatus === 'saving' ? <Loader2 size={12} className="animate-spin" /> :
                                    sheetSaveStatus === 'success' ? <Check size={12} /> :
                                        <FileText size={12} />}
                                {sheetSaveStatus === 'saving' ? '保存中...' :
                                    sheetSaveStatus === 'success' ? '已保存' :
                                        '保存表格'}
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
                                        {/* 库模式：多选勾选 */}
                                        {mode === 'library' && (
                                            <input
                                                type="checkbox"
                                                checked={!!item.selected}
                                                onChange={(e) => {
                                                    e.stopPropagation();
                                                    setItems(prev => prev.map(i => i.id === item.id ? { ...i, selected: !i.selected } : i));
                                                }}
                                                onClick={(e) => e.stopPropagation()}
                                                className="w-3 h-3 accent-green-500 cursor-pointer shrink-0"
                                            />
                                        )}
                                        <button className="text-zinc-400 hover:text-zinc-200">
                                            {item.collapsed ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
                                        </button>
                                        <span className="text-xs text-zinc-200 truncate flex-1">
                                            {item.originalForeign.slice(0, 80)}{item.originalForeign.length > 80 ? '...' : ''}
                                        </span>
                                        {/* 库模式：显示单条指定的库 */}
                                        {mode === 'library' && item.selectedLibraryIds && item.selectedLibraryIds.length > 0 && (
                                            <span className="flex items-center gap-0.5 px-1 py-0.5 bg-zinc-800 rounded text-[8px] text-zinc-500 shrink-0">
                                                {item.selectedLibraryIds.map(lid => {
                                                    const lib = libraries.find(l => l.id === lid);
                                                    return lib ? <span key={lid} className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: lib.color }} title={lib.name} /> : null;
                                                })}
                                            </span>
                                        )}
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
                                        {item.status === 'success' && mode === 'library' && item.libraryMatchedContent && (
                                            <span className="px-1.5 py-0.5 bg-green-900/30 text-green-300 text-[10px] rounded truncate max-w-[200px]" title={item.libraryMatchedContent}>
                                                📚 {item.libraryMatchedContent.slice(0, 30)}{item.libraryMatchedContent.length > 30 ? '...' : ''}
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
                                        {/* === 拆分模式结果渲染 === */}
                                        {mode === 'split' && (
                                            <div className="overflow-x-auto">
                                                <div
                                                    className="grid gap-px bg-zinc-800"
                                                    style={{
                                                        gridTemplateColumns: splitGridStyle
                                                    }}
                                                >
                                                    {/* 原文列 */}
                                                    <div className="bg-zinc-950 p-3">
                                                        <div className="text-[10px] text-zinc-500 mb-1">原文</div>
                                                        <div className="text-sm text-zinc-300 whitespace-pre-wrap break-words">
                                                            {item.originalForeign}
                                                        </div>
                                                    </div>

                                                    {/* 各拆分列 */}
                                                    {splitColumns.map((col, colIdx) => {
                                                        const colorClasses = [
                                                            'border-orange-500/50 text-orange-400 text-orange-100',
                                                            'border-sky-500/50 text-sky-400 text-sky-100',
                                                            'border-emerald-500/50 text-emerald-400 text-emerald-100',
                                                            'border-violet-500/50 text-violet-400 text-violet-100',
                                                            'border-pink-500/50 text-pink-400 text-pink-100',
                                                            'border-amber-500/50 text-amber-400 text-amber-100',
                                                            'border-cyan-500/50 text-cyan-400 text-cyan-100',
                                                            'border-rose-500/50 text-rose-400 text-rose-100',
                                                        ];
                                                        const colors = colorClasses[colIdx % colorClasses.length].split(' ');
                                                        const borderClass = colors[0];
                                                        const labelClass = colors[1];
                                                        const textClass = colors[2];
                                                        const content = item.splitResults?.[col.id];

                                                        return (
                                                            <div key={col.id} className={`bg-zinc-950 border-l-2 ${borderClass} flex flex-col`}>
                                                                <div className="px-3 py-1 bg-zinc-800/50 flex items-center justify-between border-b border-zinc-700/50">
                                                                    <span className={`text-[10px] ${labelClass} font-medium`}>
                                                                        {col.name}
                                                                    </span>
                                                                    {item.status === 'success' && content && content !== '-' && (
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                navigator.clipboard.writeText(content);
                                                                                showCopyToast(`已复制「${col.name}」`);
                                                                            }}
                                                                            className={`px-1 py-0.5 text-[9px] ${labelClass} hover:bg-zinc-700/50 rounded`}
                                                                        >
                                                                            <Copy size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <div className="px-3 py-2 flex-1">
                                                                    {item.status === 'processing' ? (
                                                                        <div className="flex items-center gap-2 text-amber-400 text-sm">
                                                                            <Loader2 size={14} className="animate-spin" />
                                                                            处理中...
                                                                        </div>
                                                                    ) : item.status === 'success' ? (
                                                                        <div className={`text-sm ${textClass} whitespace-pre-wrap break-words`}>
                                                                            {content || '-'}
                                                                        </div>
                                                                    ) : item.status === 'error' ? (
                                                                        <div className="text-sm text-red-400">{item.error || '失败'}</div>
                                                                    ) : (
                                                                        <div className="text-sm text-zinc-600 italic">待处理</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })}

                                                    {/* 关键词频率统计列 */}
                                                    {hasStats && (() => {
                                                        const statsText = getItemKeywordStatsText(item);
                                                        return (
                                                            <div className="bg-zinc-950 border-l-2 border-sky-500/50 flex flex-col">
                                                                <div className="px-3 py-1 bg-zinc-800/50 flex items-center justify-between border-b border-zinc-700/50">
                                                                    <span className="text-[10px] text-sky-400 font-medium">
                                                                        📊 频率统计
                                                                    </span>
                                                                    {item.status === 'success' && statsText && statsText !== '-' && (
                                                                        <button
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                navigator.clipboard.writeText(statsText);
                                                                                showCopyToast('已复制统计结果');
                                                                            }}
                                                                            className="px-1 py-0.5 text-[9px] text-sky-400 hover:bg-zinc-700/50 rounded"
                                                                        >
                                                                            <Copy size={10} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                                <div className="px-3 py-2 flex-1">
                                                                    {item.status === 'success' ? (
                                                                        <div className="text-sm text-sky-100 whitespace-pre-wrap break-words">
                                                                            {statsText || '-'}
                                                                        </div>
                                                                    ) : (
                                                                        <div className="text-sm text-zinc-600 italic">-</div>
                                                                    )}
                                                                </div>
                                                            </div>
                                                        );
                                                    })()}
                                                </div>
                                            </div>
                                        )}

                                        {/* === 非拆分模式结果渲染 === */}
                                        {mode !== 'split' && (
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
                                                                        {mode === "classify" ? `分类结果 ${idx + 1}` : `指令${idx + 1} ${mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文'}`}
                                                                    </span>
                                                                    {result.status === 'success' && (
                                                                        <div className="flex items-center gap-1">
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(result.resultForeign); showCopyToast(mode === "classify" ? `已复制分类结果${idx + 1}` : `已复制指令${idx + 1}${mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文'}`); }}
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
                                                                            指令{idx + 1} {mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文'}
                                                                        </span>
                                                                        {result.status === 'success' && (
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(result.resultChinese); showCopyToast(`已复制指令${idx + 1}${mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文'}`); }}
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
                                                                                className="p-1 text-amber-400 hover:bg-amber-900/20 rounded transition-colors tooltip-bottom"
                                                                                data-tip="重试该指令"
                                                                            >
                                                                                <RotateCw size={12} />
                                                                            </button>
                                                                        )}
                                                                        {result.status === 'success' && (
                                                                            <button
                                                                                onClick={(e) => { e.stopPropagation(); toggleInstructionChat(item.id, idx); }}
                                                                                className={`p-1 rounded transition-colors ${result.chatOpen ? 'text-amber-400 bg-amber-900/20' : 'text-zinc-500 hover:text-amber-400'} tooltip-bottom`}
                                                                                data-tip="对话修改"
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
                                                                        {showDiff && (mode === 'standard' || mode === 'library') && item.resultForeign
                                                                            ? highlightDiff(item.originalForeign, item.resultForeign)
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
                                        )}
                                        {/* 单条复制按钮栏 */}
                                        {item.instructionResults && item.instructionResults.length > 0 && (
                                            <div className="px-3 py-1.5 bg-zinc-900/50 border-t border-zinc-800 flex items-center gap-2 flex-wrap">
                                                <span className="text-[10px] text-zinc-500">本条复制：</span>
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        const results = item.instructionResults!;
                                                        const col1Name = mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文';
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
                                                        const col2Name = mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文';
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
                                                        const col1Name = mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文';
                                                        const col2Name = mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文';
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
                                                        const col1Name = mode === "voice" ? '加标签' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled)[0]?.name || '分项1') : '外文';
                                                        const col2Name = mode === "voice" ? '断句' : mode === 'social-media' ? (socialMediaOutputSections.filter(s => s.enabled).slice(1).map(s => s.name).join('+') || '分项2') : '中文';
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
                                                } tooltip-bottom`}
                                            data-tip="单条设置"
                                        >
                                            <Settings2 size={14} />
                                        </button>

                                        {/* 单条处理 (idle状态) */}
                                        {item.status === 'idle' && (
                                            <button
                                                onClick={() => handleProcessSingleItem(item)}
                                                className="p-1.5 text-purple-400 hover:bg-purple-900/20 rounded transition-colors tooltip-bottom"
                                                data-tip="单条处理"
                                            >
                                                <Play size={14} />
                                            </button>
                                        )}

                                        {/* 重试 (success/error状态) */}
                                        {(item.status === 'success' || item.status === 'error') && (
                                            <button
                                                onClick={() => handleProcessSingleItem(item)}
                                                className={`p-1.5 rounded transition-colors tooltip-bottom ${mode === 'library'
                                                    ? 'text-green-400 hover:bg-green-900/20'
                                                    : 'text-amber-400 hover:bg-amber-900/20'
                                                    }`}
                                                data-tip={mode === 'library' ? '重新匹配' : '重试'}
                                            >
                                                <RotateCw size={14} />
                                            </button>
                                        )}

                                        {/* 删除 */}
                                        <button
                                            onClick={() => handleDeleteItem(item.id)}
                                            className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors tooltip-bottom"
                                            data-tip="删除"
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
            )
            }

            {/* 空状态 */}
            {
                items.length === 0 && (
                    <div className="flex-1 flex flex-col items-center justify-center text-zinc-600 border-2 border-dashed border-zinc-800 rounded-xl bg-zinc-900/30 min-h-[300px]">
                        <FileText size={48} className="mb-4 opacity-20" />
                        <p className="text-sm">添加文案开始批量改写</p>
                        <p className="text-xs text-zinc-700 mt-2">支持从表格复制粘贴（外文 + 中文参照两列）</p>
                    </div>
                )
            }

            {/* === 预览指令弹框 === */}
            {
                showPreview && (
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
                                            : mode === 'social-media'
                                                ? '以下是自媒体改写模式的 Prompt 结构（信仰短视频口播稿改写）：'
                                                : '以下是发送给 AI 的完整 Prompt 结构（如果修改结果不满意可以修改这里的指令）：'
                                    }
                                </p>

                                {/* 系统指令 - 可编辑 */}
                                <div className={`bg-black/30 p-4 rounded-lg border ${mode === "voice" ? 'border-purple-900/30' : mode === "classify" ? 'border-cyan-900/30' : mode === 'social-media' ? 'border-teal-900/30' : 'border-blue-900/30'}`}>
                                    <div className={`${mode === "voice" ? 'text-purple-400' : mode === "classify" ? 'text-cyan-400' : mode === 'social-media' ? 'text-teal-400' : 'text-blue-400'} font-medium mb-2 text-sm flex items-center gap-2`}>
                                        {mode === "voice" ? '🎙️ 人声文案系统指令' : mode === "classify" ? '🏷️ 分类模式系统指令' : mode === 'social-media' ? '📱 自媒体改写系统指令' : '📝 系统固定默认指令'}
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
                                        {mode === 'social-media' && (
                                            <button
                                                onClick={() => setSocialMediaModeSystemInstruction(SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION)}
                                                className="text-[10px] text-teal-400/60 hover:text-teal-400 px-1.5 py-0.5 rounded bg-teal-900/20 hover:bg-teal-900/40 transition-colors"
                                            >
                                                重置默认
                                            </button>
                                        )}
                                    </div>
                                    <textarea
                                        value={mode === "voice" ? voiceModeSystemInstruction : mode === "classify" ? classifyModeSystemInstruction : mode === 'social-media' ? socialMediaModeSystemInstruction : systemInstruction}
                                        onChange={(e) => {
                                            if (mode === "voice") {
                                                setVoiceModeSystemInstruction(e.target.value);
                                            } else if (mode === "classify") {
                                                setClassifyModeSystemInstruction(e.target.value);
                                            } else if (mode === 'social-media') {
                                                setSocialMediaModeSystemInstruction(e.target.value);
                                            } else {
                                                setSystemInstruction(e.target.value);
                                            }
                                        }}
                                        placeholder={mode === "voice" ? VOICE_MODE_SYSTEM_INSTRUCTION : mode === "classify" ? CLASSIFY_MODE_SYSTEM_INSTRUCTION : mode === 'social-media' ? SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION : DEFAULT_SYSTEM_INSTRUCTION}
                                        className={`w-full bg-zinc-900 border border-zinc-700 rounded px-3 py-2 text-xs text-zinc-300 focus:outline-none resize-none h-48 placeholder-zinc-600 ${mode === "voice" ? 'focus:border-purple-500' : mode === "classify" ? 'focus:border-cyan-500' : mode === 'social-media' ? 'focus:border-teal-500' : 'focus:border-blue-500'}`}
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
                )
            }

            {/* 双击编辑指令弹框 */}
            {
                editingInstructionIndex !== null && (
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
                )
            }

            {/* 自媒体模式双击编辑弹窗 */}
            {editingSocialMediaField !== null && (() => {
                const isSystemInstruction = editingSocialMediaField.type === 'systemInstruction';
                const editingSection = editingSocialMediaField.sectionId
                    ? socialMediaOutputSections.find(s => s.id === editingSocialMediaField.sectionId)
                    : null;
                return (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-3xl mx-4 shadow-2xl flex flex-col max-h-[85vh]">
                            <div className="p-4 border-b border-zinc-800 flex items-center justify-between shrink-0">
                                <div className="text-teal-400 font-medium flex items-center gap-2">
                                    ✏️ {isSystemInstruction ? '编辑自媒体系统指令' : `编辑分项描述 - ${editingSection?.name || ''}`}
                                </div>
                                <button
                                    onClick={() => setEditingSocialMediaField(null)}
                                    className="text-zinc-500 hover:text-zinc-300"
                                >
                                    <X size={18} />
                                </button>
                            </div>
                            <div className="p-4 flex-1 overflow-auto">
                                <textarea
                                    value={isSystemInstruction ? socialMediaModeSystemInstruction : (editingSection?.description || '')}
                                    onChange={(e) => {
                                        if (isSystemInstruction) {
                                            setSocialMediaModeSystemInstruction(e.target.value);
                                        } else if (editingSocialMediaField.sectionId) {
                                            setSocialMediaOutputSections(prev => prev.map(s =>
                                                s.id === editingSocialMediaField.sectionId ? { ...s, description: e.target.value } : s
                                            ));
                                        }
                                    }}
                                    placeholder={isSystemInstruction ? '输入系统指令...' : '描述这个分项的输出要求...'}
                                    className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-teal-500 placeholder-zinc-600 resize-none leading-relaxed"
                                    style={{ minHeight: isSystemInstruction ? '400px' : '200px' }}
                                    autoFocus
                                />
                                <div className="mt-3 text-[10px] text-zinc-500">
                                    {isSystemInstruction ? '提示：这是发送给 AI 的系统指令，定义了改写风格和规则。' : '提示：描述 AI 在这个分项中应该输出什么内容。'}
                                </div>
                            </div>
                            <div className="p-4 border-t border-zinc-800 flex justify-between shrink-0">
                                {isSystemInstruction && (
                                    <button
                                        onClick={() => setSocialMediaModeSystemInstruction(SOCIAL_MEDIA_MODE_SYSTEM_INSTRUCTION)}
                                        className="px-3 py-1.5 text-xs text-zinc-500 hover:text-teal-400 rounded border border-zinc-700 hover:border-teal-700 transition-colors"
                                    >
                                        重置默认
                                    </button>
                                )}
                                {!isSystemInstruction && <div />}
                                <button
                                    onClick={() => setEditingSocialMediaField(null)}
                                    className="px-4 py-2 bg-teal-600 hover:bg-teal-500 text-white rounded-lg text-sm font-medium"
                                >
                                    确定
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 库模式双击编辑弹窗 */}
            {editingLibField !== null && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl mx-4 shadow-2xl">
                        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                            <div className="text-green-400 font-medium flex items-center gap-2">
                                ✏️ {editingLibField.type === 'matchRule'
                                    ? `编辑库使用指令 - ${libraries.find(l => l.id === (editingLibField as any).libId)?.name || ''}`
                                    : `编辑额外指令 ${(editingLibField as any).idx + 1}`}
                            </div>
                            <button
                                onClick={() => setEditingLibField(null)}
                                className="text-zinc-500 hover:text-zinc-300"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-4">
                            <textarea
                                value={
                                    editingLibField.type === 'matchRule'
                                        ? libraries.find(l => l.id === (editingLibField as any).libId)?.matchRule || ''
                                        : libraryExtraInstructions[(editingLibField as any).idx] || ''
                                }
                                onChange={(e) => {
                                    if (editingLibField.type === 'matchRule') {
                                        const libId = (editingLibField as any).libId;
                                        setLibraries(prev => prev.map(l => l.id === libId ? { ...l, matchRule: e.target.value } : l));
                                    } else {
                                        const idx = (editingLibField as any).idx;
                                        setLibraryExtraInstructions(prev => {
                                            const next = [...prev];
                                            next[idx] = e.target.value;
                                            return next;
                                        });
                                    }
                                }}
                                placeholder="在此输入完整的指令..."
                                className="w-full h-48 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-green-500 placeholder-zinc-600 resize-none"
                                autoFocus
                            />
                            <div className="mt-3 text-[10px] text-zinc-500">
                                提示：在这里可以完整查看和编辑指令内容。关闭弹框后自动保存。
                            </div>
                        </div>
                        <div className="p-4 border-t border-zinc-800 flex justify-between">
                            <div className="flex items-center gap-2 flex-wrap">
                                <span className="text-[10px] text-zinc-500">快速填充：</span>
                                {BUILTIN_PRESETS.slice(0, 4).map(preset => (
                                    <button
                                        key={preset.id}
                                        onClick={() => {
                                            if (editingLibField!.type === 'matchRule') {
                                                const libId = (editingLibField as any).libId;
                                                setLibraries(prev => prev.map(l => l.id === libId ? { ...l, matchRule: preset.instruction } : l));
                                            } else {
                                                const idx = (editingLibField as any).idx;
                                                setLibraryExtraInstructions(prev => {
                                                    const next = [...prev];
                                                    next[idx] = preset.instruction;
                                                    return next;
                                                });
                                            }
                                        }}
                                        className="px-2 py-1 bg-zinc-800 hover:bg-green-900/30 text-[10px] text-green-300 rounded border border-zinc-700"
                                    >
                                        {preset.name}
                                    </button>
                                ))}
                            </div>
                            <button
                                onClick={() => setEditingLibField(null)}
                                className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium"
                            >
                                确定
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 文案库编辑器弹框 */}
            {showLibraryEditor && (() => {
                let activeLib = libraries.find(l => l.id === activeLibraryId);
                if (!activeLib && libraries.length > 0) {
                    activeLib = libraries[0];
                    setActiveLibraryId(libraries[0].id);
                }
                if (!activeLib) return null;
                const updateLib = (updates: Partial<CopywritingLibrary>) => {
                    setLibraries(prev => prev.map(l => l.id === activeLibraryId ? { ...l, ...updates } : l));
                };
                const updateLibItem = (itemId: string, updates: Partial<LibraryItem>) => {
                    setLibraries(prev => prev.map(l => l.id === activeLibraryId
                        ? { ...l, items: l.items.map(i => i.id === itemId ? { ...i, ...updates } : i) }
                        : l
                    ));
                };
                const addLibItem = () => {
                    setLibraries(prev => prev.map(l => l.id === activeLibraryId
                        ? { ...l, items: [...l.items, { id: uuidv4(), content: '', weight: 5, tags: '', usedCount: 0 }] }
                        : l
                    ));
                };
                const removeLibItem = (itemId: string) => {
                    setLibraries(prev => prev.map(l => l.id === activeLibraryId
                        ? { ...l, items: l.items.filter(i => i.id !== itemId) }
                        : l
                    ));
                };
                const handleBatchImport = () => {
                    setBatchImportText('');
                    setShowBatchImportModal(true);
                };

                return (
                    <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                        <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-4xl mx-4 shadow-2xl max-h-[85vh] flex flex-col">
                            <div className="p-4 border-b border-zinc-800">
                                <div className="flex items-center justify-between mb-2">
                                    <div className="text-green-400 font-medium flex items-center gap-2">
                                        📚 编辑文案库
                                    </div>
                                    <button
                                        onClick={() => setShowLibraryEditor(false)}
                                        className="text-zinc-500 hover:text-zinc-300"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                                {/* 第一级：分页/总库 标签 */}
                                {(() => {
                                    // 构建分组
                                    const groups: { group: string; libs: CopywritingLibrary[] }[] = [];
                                    const seen = new Set<string>();
                                    for (const lib of libraries) {
                                        const g = lib.group || lib.name;
                                        if (!seen.has(g)) {
                                            seen.add(g);
                                            groups.push({ group: g, libs: libraries.filter(l => (l.group || l.name) === g) });
                                        }
                                    }
                                    // 确定当前选中的分组
                                    const activeGroup = activeEditorGroup || (activeLib ? (activeLib.group || activeLib.name) : groups[0]?.group || '');
                                    const currentGroupLibs = groups.find(g => g.group === activeGroup)?.libs || [];
                                    const isMultiGroup = currentGroupLibs.length > 1 || (currentGroupLibs.length === 1 && currentGroupLibs[0].name !== activeGroup);

                                    return (
                                        <>
                                            <div className="flex items-center gap-1 flex-wrap">
                                                {groups.map(grp => {
                                                    const isActive = grp.group === activeGroup;
                                                    const totalItems = grp.libs.reduce((s, l) => s + l.items.length, 0);
                                                    const allEnabled = grp.libs.every(l => l.enabled);
                                                    const someEnabled = grp.libs.some(l => l.enabled);
                                                    return (
                                                        <button
                                                            key={grp.group}
                                                            onClick={() => {
                                                                setActiveEditorGroup(grp.group);
                                                                // 如果是单库分组，直接选中该库
                                                                if (grp.libs.length === 1 && grp.libs[0].name === grp.group) {
                                                                    setActiveLibraryId(grp.libs[0].id);
                                                                } else if (grp.libs.length > 0) {
                                                                    // 选中组内第一个库
                                                                    const firstLib = grp.libs.find(l => l.id === activeLibraryId) || grp.libs[0];
                                                                    setActiveLibraryId(firstLib.id);
                                                                }
                                                            }}
                                                            onContextMenu={(e) => {
                                                                e.preventDefault();
                                                                // 右键切换整组启用/禁用
                                                                const newEnabled = !allEnabled;
                                                                setLibraries(prev => prev.map(l => {
                                                                    if (grp.libs.some(gl => gl.id === l.id)) {
                                                                        return { ...l, enabled: newEnabled };
                                                                    }
                                                                    return l;
                                                                }));
                                                            }}
                                                            className={`px-2.5 py-1 text-xs rounded-lg transition-all flex items-center gap-1.5 ${isActive
                                                                ? 'bg-green-600 text-white'
                                                                : someEnabled
                                                                    ? 'bg-zinc-800 text-zinc-300 hover:bg-zinc-700 border border-zinc-700'
                                                                    : 'bg-zinc-800/40 text-zinc-500 hover:bg-zinc-700 border border-zinc-800'
                                                                }`}
                                                            title={`${allEnabled ? '全部启用' : someEnabled ? '部分启用' : '全部禁用'}｜右键切换`}
                                                        >
                                                            <span className={`w-2 h-2 rounded-full ${allEnabled ? '' : someEnabled ? 'opacity-50' : 'opacity-30'}`}
                                                                style={{ backgroundColor: grp.libs[0]?.color || '#888' }} />
                                                            {grp.group}
                                                            <span className="text-[10px] opacity-60">({totalItems})</span>
                                                        </button>
                                                    );
                                                })}
                                                <button
                                                    onClick={() => {
                                                        const newLib: CopywritingLibrary = {
                                                            id: uuidv4(),
                                                            name: `新库 ${libraries.length + 1}`,
                                                            matchRule: '根据文案内容语义匹配最合适的条目',
                                                            maxRepeat: 3,
                                                            items: [],
                                                            enabled: true,
                                                            color: LIB_COLORS[libraries.length % LIB_COLORS.length]
                                                        };
                                                        setLibraries(prev => [...prev, newLib]);
                                                        setActiveLibraryId(newLib.id);
                                                        setActiveEditorGroup(newLib.name);
                                                    }}
                                                    className="px-2 py-1 text-[10px] text-green-400 hover:bg-green-900/20 rounded-lg border border-dashed border-green-800/40"
                                                >
                                                    + 新建
                                                </button>
                                            </div>
                                            {/* 第二级：子库标签（仅总库模式下显示） */}
                                            {isMultiGroup && (
                                                <div className="flex items-center gap-1 flex-wrap mt-1 pl-2 border-l-2 border-green-800/30">
                                                    {currentGroupLibs.map(lib => (
                                                        <button
                                                            key={lib.id}
                                                            onClick={() => setActiveLibraryId(lib.id)}
                                                            onContextMenu={(e) => {
                                                                e.preventDefault();
                                                                setLibraries(prev => prev.map(l => l.id === lib.id ? { ...l, enabled: !l.enabled } : l));
                                                            }}
                                                            className={`px-2 py-0.5 text-[11px] rounded transition-all flex items-center gap-1 ${lib.id === activeLibraryId
                                                                ? 'bg-green-500/80 text-white'
                                                                : lib.enabled
                                                                    ? 'bg-zinc-800/80 text-zinc-300 hover:bg-zinc-700'
                                                                    : 'bg-zinc-800/30 text-zinc-600 hover:bg-zinc-700 line-through opacity-50'
                                                                }`}
                                                            title={`${lib.enabled ? '✅ 已启用' : '⬜ 已禁用'}｜右键切换`}
                                                        >
                                                            <span className="w-1.5 h-1.5 rounded-full" style={{ backgroundColor: lib.enabled ? lib.color : '#555' }} />
                                                            {lib.name} ({lib.items.length})
                                                        </button>
                                                    ))}
                                                </div>
                                            )}
                                        </>
                                    );
                                })()}
                                {/* 操作按钮 */}
                                <div className="flex items-center gap-2 mt-1">
                                    {libraries.length > 1 && (
                                        <button
                                            onClick={() => {
                                                setConfirmDialog({
                                                    message: `确定删除「${activeLib.name}」？`,
                                                    onConfirm: () => {
                                                        const remaining = libraries.filter(l => l.id !== activeLibraryId);
                                                        setLibraries(remaining);
                                                        setActiveLibraryId(remaining[0].id);
                                                    }
                                                });
                                            }}
                                            className="px-2 py-0.5 text-[10px] text-red-400/60 hover:text-red-400 hover:bg-red-900/20 rounded"
                                        >
                                            <Trash2 size={10} className="inline mr-0.5" /> 删除当前库
                                        </button>
                                    )}
                                </div>
                                {/* Google Sheets 导入 */}
                                <div className="flex items-center gap-2 mt-2">
                                    <input
                                        type="text"
                                        value={libSheetsUrl}
                                        onChange={(e) => {
                                            setLibSheetsUrl(e.target.value);
                                            try { localStorage.setItem('copywriting_lib_sheetsUrl', e.target.value); } catch { }
                                        }}
                                        placeholder="粘贴 Google Sheets 链接..."
                                        className="flex-1 bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-xs text-zinc-300 focus:outline-none focus:border-green-500"
                                    />
                                    <button
                                        onClick={async () => {
                                            if (!libSheetsUrl.trim()) return;
                                            setLibSheetsImporting(true);
                                            try {
                                                const imported = await importLibrariesFromSheets(libSheetsUrl);
                                                setLibraries(imported);
                                                setActiveLibraryId(imported[0].id);
                                                showCopyToast(`✅ 导入成功: ${imported.length} 个库, 共 ${imported.reduce((s, l) => s + l.items.length, 0)} 条`);
                                            } catch (error: any) {
                                                alert(error.message || '导入失败');
                                            } finally {
                                                setLibSheetsImporting(false);
                                            }
                                        }}
                                        disabled={libSheetsImporting || !libSheetsUrl.trim()}
                                        className="px-3 py-1.5 text-xs bg-green-700 hover:bg-green-600 disabled:opacity-50 text-white rounded flex items-center gap-1"
                                    >
                                        {libSheetsImporting ? <Loader2 size={12} className="animate-spin" /> : <Download size={12} />}
                                        {libSheetsImporting ? '导入中...' : '从表格导入'}
                                    </button>
                                </div>
                            </div>
                            <div className="p-4 space-y-3 overflow-y-auto flex-1">
                                {/* 库基本设置 */}
                                <div className="grid grid-cols-3 gap-3">
                                    <div>
                                        <label className="text-[10px] text-zinc-500 mb-1 block">库名称</label>
                                        <input
                                            type="text"
                                            value={activeLib.name}
                                            onChange={(e) => updateLib({ name: e.target.value })}
                                            className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm text-green-200 focus:outline-none focus:border-green-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-zinc-500 mb-1 block">单条最大使用次数</label>
                                        <input
                                            type="number"
                                            value={activeLib.maxRepeat}
                                            onChange={(e) => updateLib({ maxRepeat: parseInt(e.target.value) || 1 })}
                                            min={1}
                                            className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-1.5 text-sm text-zinc-200 focus:outline-none focus:border-green-500"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-zinc-500 mb-1 block">库条目数</label>
                                        <div className="px-3 py-1.5 text-sm text-zinc-400 bg-zinc-950 border border-zinc-700 rounded">{activeLib.items.length} 条</div>
                                    </div>
                                </div>
                                <div>
                                    <label className="text-[10px] text-zinc-500 mb-1 block">匹配规则（告诉 AI 如何选择）</label>
                                    <textarea
                                        value={activeLib.matchRule}
                                        onChange={(e) => updateLib({ matchRule: e.target.value })}
                                        className="w-full bg-zinc-950 border border-zinc-700 rounded px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-green-500 resize-none"
                                        rows={2}
                                    />
                                </div>

                                {/* 批量操作栏 */}
                                {(() => {
                                    // 收集标签
                                    const allTags = Array.from(new Set(activeLib.items.map(i => i.tags).filter(Boolean)));
                                    if (allTags.length === 0) return null;
                                    return (
                                        <div className="bg-zinc-800/50 rounded-lg px-3 py-2 space-y-1.5">
                                            <div className="text-[10px] text-zinc-500 font-medium">按分类批量操作</div>
                                            <div className="flex items-center gap-1 flex-wrap">
                                                {allTags.map(tag => {
                                                    const count = activeLib.items.filter(i => i.tags === tag).length;
                                                    const avgWeight = Math.round(activeLib.items.filter(i => i.tags === tag).reduce((s, i) => s + i.weight, 0) / count);
                                                    const priorityLabel = avgWeight <= 3 ? '⚪低' : avgWeight <= 6 ? '🟡中' : avgWeight <= 8 ? '🟠高' : '🔴极高';
                                                    return (
                                                        <div key={tag} className="flex items-center gap-1 bg-zinc-900 rounded px-2 py-1">
                                                            <span className="text-[10px] text-zinc-300">{tag}</span>
                                                            <span className="text-[9px] text-zinc-600">({count})</span>
                                                            <select
                                                                value={avgWeight <= 3 ? '2' : avgWeight <= 6 ? '5' : avgWeight <= 8 ? '7' : '10'}
                                                                onChange={(e) => {
                                                                    const newWeight = parseInt(e.target.value);
                                                                    setLibraries(prev => prev.map(l => l.id === activeLibraryId
                                                                        ? { ...l, items: l.items.map(i => i.tags === tag ? { ...i, weight: newWeight } : i) }
                                                                        : l
                                                                    ));
                                                                }}
                                                                className="bg-transparent border-none text-[10px] text-zinc-400 focus:outline-none cursor-pointer appearance-none"
                                                                title="设置该分类所有条目的优先级"
                                                            >
                                                                <option value="2" className="bg-zinc-800">⚪ 低</option>
                                                                <option value="5" className="bg-zinc-800">🟡 中</option>
                                                                <option value="7" className="bg-zinc-800">🟠 高</option>
                                                                <option value="10" className="bg-zinc-800">🔴 极高</option>
                                                            </select>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    );
                                })()}

                                {/* 库条目列表 */}
                                <div className="border border-zinc-700 rounded-lg overflow-hidden">
                                    <div className="flex items-center bg-zinc-800 px-3 py-1.5 gap-2">
                                        <span className="flex-1 text-[10px] text-zinc-400 font-medium">内容</span>
                                        {activeLib.items.some(i => i.tags) && <span className="w-20 text-[10px] text-zinc-400 font-medium text-center">分类</span>}
                                        <span className="w-16 text-[10px] text-zinc-400 font-medium text-center">优先级</span>
                                        <span className="w-14 text-[10px] text-zinc-400 font-medium text-center">已用</span>
                                        <span className="w-6"></span>
                                    </div>
                                    <div className="max-h-60 overflow-y-auto">
                                        {activeLib.items.map((item, idx) => (
                                            <div key={item.id} className="flex items-center px-1 py-0.5 gap-2 border-t border-zinc-800/50 hover:bg-zinc-800/30">
                                                <input
                                                    type="text"
                                                    value={item.content}
                                                    onChange={(e) => updateLibItem(item.id, { content: e.target.value })}
                                                    className="flex-1 bg-transparent border-none px-2 py-1 text-xs text-zinc-200 focus:outline-none focus:bg-zinc-800/50 rounded"
                                                    placeholder={`条目 ${idx + 1}`}
                                                />
                                                {activeLib.items.some(i => i.tags) && (
                                                    <span className="w-20 text-[9px] text-zinc-500 text-center truncate" title={item.tags}>
                                                        {item.tags || '-'}
                                                    </span>
                                                )}
                                                <select
                                                    value={item.weight <= 3 ? '2' : item.weight <= 6 ? '5' : item.weight <= 8 ? '7' : '10'}
                                                    onChange={(e) => updateLibItem(item.id, { weight: parseInt(e.target.value) })}
                                                    className="w-16 bg-transparent border-none px-1 py-1 text-xs text-zinc-300 focus:outline-none text-center appearance-none cursor-pointer"
                                                >
                                                    <option value="2" className="bg-zinc-800">⚪ 低</option>
                                                    <option value="5" className="bg-zinc-800">🟡 中</option>
                                                    <option value="7" className="bg-zinc-800">🟠 高</option>
                                                    <option value="10" className="bg-zinc-800">🔴 极高</option>
                                                </select>
                                                <span className={`w-14 text-center text-[10px] ${item.usedCount >= activeLib.maxRepeat ? 'text-red-400' : 'text-zinc-500'}`}>
                                                    {item.usedCount}/{activeLib.maxRepeat}
                                                </span>
                                                <button onClick={() => removeLibItem(item.id)} className="w-6 text-zinc-600 hover:text-red-400 flex items-center justify-center">
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>

                                {/* 操作按钮 */}
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={addLibItem}
                                        className="flex items-center gap-1 px-3 py-1 text-xs text-green-400 hover:bg-green-900/20 rounded border border-green-900/30"
                                    >
                                        <Plus size={12} /> 添加条目
                                    </button>
                                    <button
                                        onClick={handleBatchImport}
                                        className="flex items-center gap-1 px-3 py-1 text-xs text-sky-400 hover:bg-sky-900/20 rounded border border-sky-900/30"
                                    >
                                        <ClipboardCopy size={12} /> 批量导入
                                    </button>
                                    <button
                                        onClick={() => {
                                            setConfirmDialog({
                                                message: '确定清空所有条目？',
                                                onConfirm: () => updateLib({ items: [] })
                                            });
                                        }}
                                        className="flex items-center gap-1 px-3 py-1 text-xs text-red-400 hover:bg-red-900/20 rounded border border-red-900/30"
                                    >
                                        <Trash2 size={12} /> 清空
                                    </button>
                                </div>
                            </div>
                            <div className="p-4 border-t border-zinc-800 flex justify-end">
                                <button
                                    onClick={() => setShowLibraryEditor(false)}
                                    className="px-4 py-2 bg-green-600 hover:bg-green-500 text-white rounded-lg text-sm font-medium"
                                >
                                    完成
                                </button>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 批量导入弹框 */}
            {showBatchImportModal && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[60]" onClick={() => setShowBatchImportModal(false)}>
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-lg mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                            <div className="text-green-400 font-medium text-sm">📋 批量导入</div>
                            <button onClick={() => setShowBatchImportModal(false)} className="text-zinc-500 hover:text-zinc-300">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="p-4 space-y-3">
                            <div className="text-[11px] text-zinc-500">
                                每行一条，可用 Tab 分隔权重和标签。格式：<span className="text-zinc-400">内容{'\t'}权重{'\t'}标签</span>
                            </div>
                            <textarea
                                value={batchImportText}
                                onChange={e => setBatchImportText(e.target.value)}
                                placeholder={"粘贴文案库内容...\n例：Type Amen 🙏\t10\t互动\n例：Share this ❤️\t5\t分享"}
                                className="w-full h-48 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-green-500 placeholder-zinc-600 resize-none font-mono"
                                autoFocus
                            />
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={async () => {
                                            try {
                                                const clip = await navigator.clipboard.readText();
                                                if (clip) setBatchImportText(clip);
                                            } catch { showCopyToast('无法读取剪贴板'); }
                                        }}
                                        className="px-3 py-1.5 text-[11px] bg-zinc-800 hover:bg-zinc-700 text-zinc-300 rounded-lg transition-colors"
                                    >
                                        📋 从剪贴板粘贴
                                    </button>
                                    <span className="text-[10px] text-zinc-600">
                                        {batchImportText.trim() ? `${batchImportText.split('\n').filter(l => l.trim()).length} 条` : ''}
                                    </span>
                                </div>
                                <div className="flex gap-2">
                                    <button
                                        onClick={() => setShowBatchImportModal(false)}
                                        className="px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={confirmBatchImport}
                                        disabled={!batchImportText.trim()}
                                        className="px-4 py-1.5 text-sm bg-green-600 hover:bg-green-500 disabled:bg-zinc-700 disabled:text-zinc-500 text-white rounded-lg font-medium transition-colors"
                                    >
                                        导入
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>
            )}


            {/* 确认对话框 */}
            {confirmDialog && (
                <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-[70]" onClick={() => setConfirmDialog(null)}>
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-sm mx-4 shadow-2xl" onClick={e => e.stopPropagation()}>
                        <div className="p-5">
                            <div className="text-sm text-zinc-200 mb-5">{confirmDialog.message}</div>
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setConfirmDialog(null)}
                                    className="px-4 py-1.5 text-sm text-zinc-400 hover:text-zinc-200 transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={() => { confirmDialog.onConfirm(); setConfirmDialog(null); }}
                                    className="px-4 py-1.5 text-sm bg-red-600 hover:bg-red-500 text-white rounded-lg font-medium transition-colors"
                                >
                                    确定
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 双击编辑拆分列弹框 */}
            {
                editingSplitColumnId !== null && (() => {
                    const col = splitColumns.find(c => c.id === editingSplitColumnId);
                    if (!col) return null;
                    const colIdx = splitColumns.findIndex(c => c.id === editingSplitColumnId);
                    return (
                        <div className="fixed inset-0 bg-black/70 flex items-center justify-center z-50">
                            <div className="bg-zinc-900 border border-zinc-700 rounded-xl w-full max-w-2xl mx-4 shadow-2xl">
                                <div className="p-4 border-b border-zinc-800 flex items-center justify-between">
                                    <div className="text-orange-400 font-medium flex items-center gap-2">
                                        ✏️ 编辑拆分列 {colIdx + 1}
                                    </div>
                                    <button
                                        onClick={() => setEditingSplitColumnId(null)}
                                        className="text-zinc-500 hover:text-zinc-300"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                                <div className="p-4 space-y-3">
                                    <div>
                                        <label className="text-[10px] text-zinc-500 mb-1 block">列名</label>
                                        <input
                                            type="text"
                                            value={col.name}
                                            onChange={(e) => updateSplitColumn(col.id, { name: e.target.value })}
                                            placeholder="列名（如：钩子、关键词）"
                                            className="w-full bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-2 text-sm text-orange-200 focus:outline-none focus:border-orange-500 placeholder-zinc-600"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-[10px] text-zinc-500 mb-1 block">提取/分析要求</label>
                                        <textarea
                                            value={col.description}
                                            onChange={(e) => updateSplitColumn(col.id, { description: e.target.value })}
                                            placeholder="在此输入详细的提取或分析要求...\n例如：提取3-5个核心主题关键词，用逗号分隔。关注信仰主题词、情感属性词、行动号召词等。"
                                            className="w-full h-48 bg-zinc-950 border border-zinc-700 rounded-lg px-4 py-3 text-sm text-zinc-200 focus:outline-none focus:border-orange-500 placeholder-zinc-600 resize-none"
                                            autoFocus
                                        />
                                    </div>
                                    <div className="text-[10px] text-zinc-500">
                                        提示：在这里可以详细描述该列的提取或分析要求。支持多行编辑，关闭弹框后自动保存。
                                    </div>
                                </div>
                                <div className="p-4 border-t border-zinc-800 flex justify-end">
                                    <button
                                        onClick={() => setEditingSplitColumnId(null)}
                                        className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm font-medium"
                                    >
                                        确定
                                    </button>
                                </div>
                            </div>
                        </div>
                    );
                })()
            }

            {/* 保存预设 Modal */}
            {
                showSavePreset && (
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
                )
            }

            {/* 复制提示Toast */}
            {
                copyToast && (
                    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 px-4 py-2 bg-emerald-600 text-white rounded-lg shadow-lg text-sm flex items-center gap-2 animate-pulse">
                        <Check size={16} />
                        {copyToast}
                    </div>
                )
            }

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
        </div >
    );
}
