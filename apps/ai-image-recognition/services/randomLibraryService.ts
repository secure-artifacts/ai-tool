/**
 * 随机库服务 - 用于高级创新的随机组合功能
 * 支持云同步、导入导出
 * @version 2.0 - 使用 Google Sheets API 读取分页目录
 */

import { getFirestore, doc, getDoc, setDoc } from 'firebase/firestore';
import { getAuth } from 'firebase/auth';

// 库值类型（支持分类）
export interface LibraryValue {
    value: string; // 值本身
    categories?: string[]; // 所属分类，如 ["室内", "小空间"]
}

// 随机库类型
export interface RandomLibrary {
    id: string;
    name: string;
    values: string[]; // 库中的值数组，允许重复（向后兼容，简单模式）
    valuesWithCategory?: LibraryValue[]; // 带分类的值数组（分类联动模式）
    valueWeights?: Record<string, number>; // 值权重映射，如 {"神父": 1, "普通人-男性": 5}，权重越高被选中概率越大
    enabled: boolean; // 是否在创新时使用此库
    participationRate?: number; // 参与概率 0-100，默认100（必选）
    pickMode: 'random-one' | 'random-multiple' | 'sequential'; // 抽取模式
    pickCount: number; // random-multiple 模式下抽取几个
    color: string; // 标签页颜色
    group?: string; // 分组名称（可选），如"衣服"、"场景"等
    sourceSheet?: string; // 来源总库分页名，用于分组显示
    createdAt: number;
    updatedAt: number;
}

// 随机库配置
export interface RandomLibraryConfig {
    libraries: RandomLibrary[];
    insertTemplate: string; // 如何插入到指令中，如 "{场景库}，{风格库}"
    enabled: boolean; // 总开关
    insertPosition: 'before' | 'after'; // 插入到指令前还是后
    transitionInstruction: string; // 过渡指令，连接创新指令和随机库结果
    combinationMode: 'random' | 'cartesian'; // 组合模式：整体随机 vs 笛卡尔积
    categoryLinkEnabled?: boolean; // 是否启用分类联动
    aiFilterEnabled?: boolean; // 是否启用AI智能过滤
    activeSourceSheet?: string; // 当前激活的总库分页名，用于标签页切换
    // 快捷创新模式扩展
    linkedInstructions?: Record<string, string>; // 总库名 → 配套创新指令 的映射
    quickTransitionInstruction?: string; // 快捷创新模式的过渡指令
    // 快捷创新默认预设（当没有导入指令时使用）
    quickPresetType?: 'standard' | 'withRandomLib'; // 当前选择的预设类型
    quickPresets?: { standard: string; withRandomLib: string }; // 用户自定义的预设内容
    // 同步刷新
    sourceSpreadsheetUrl?: string; // 导入源的 Google Sheets URL，用于同步刷新
}

// 默认过渡指令（用于随机库内容）
export const DEFAULT_TRANSITION_INSTRUCTION = '【画面创新细节】';

// 快捷创新模式默认过渡指令
export const DEFAULT_QUICK_TRANSITION_INSTRUCTION = '【画面创新细节】';

// 用户要求的过渡指令
export const USER_REQUIREMENT_TRANSITION = '【用户特别要求】';

// 快捷创新默认预设类型
export type QuickInnovationPresetType = 'standard' | 'withRandomLib';

// 快捷创新默认预设
export interface QuickInnovationPresets {
    standard: string; // 标准模式（不使用随机库）
    withRandomLib: string; // 随机库模式（末尾开放接入随机库内容）
}

// 默认预设内容
export const DEFAULT_QUICK_INNOVATION_PRESETS: QuickInnovationPresets = {
    standard: `请根据我给你的每一张图或者文字说明，详细描述图片，细节的分析图片的类型，特点，画面，根据这些元素以及我的要求进行创新。输出可直接用于图像或视频生成模型的完整 AI 描述词（Prompt）。

关键细节要求：你对每个提示词的描述必须详尽且高度细致。切勿简略。

主体与场景：极其精确地描述所有主体、物体和角色。对于人物，详细说明其外貌、服装（面料、款式、颜色）、配饰、姿势、表情和动作。指定他们彼此之间以及与环境的空间关系。

构图与风格：明确定义镜头类型（如"特写"、"全景"）、摄像机角度（如"低角度"、"荷兰式倾斜角"）以及整体艺术风格（如"超写实 3D 渲染"、"印象派油画"、"动漫关键视觉图"）。

艺术元素：如果图像具有独特的艺术风格，你必须描述其具体特征。这包括笔触（如"明显的厚涂笔触"、"平滑融合的数字喷枪"）、线条（如"锐利、干净的赛璐璐阴影轮廓"、"草率、松散的铅笔线条"）、调色板（如"鲜艳的霓虹色"、"柔和、低饱和度的色调"）和光影（如"戏剧性的明暗对比照明"、"柔和、弥散的晨光"）。

环境：详细描述背景和前景，包括地点、时间、天气和特定的环境元素。

## 核心任务：智能翻版创新

### 第一步：分析画面类型
请先识别图片属于什么类型（如：人物肖像、产品展示、自然风景、城市街景、室内场景、美食、动物等）

### 第二步：锁定不可变元素（必须保持原样）
以下元素请严格还原，不得创新：
- 天气状况（晴天/阴天/雨天/雪天等）
- 光影效果（光源方向、光线强弱、阴影特征）
- 画面风格（写实/插画/3D/电影感等视觉风格）
- 色调倾向（冷色调/暖色调/黑白等）
- 镜头语言（景别、拍摄角度、虚化程度）

### 第三步：识别可创新元素（根据画面类型自行判断）
根据画面类型，自动识别哪些元素可以进行变体创新：
- 主体可替换为同类型的其他主体
- 场景可替换为同性质的其他场景
- 动作/姿态可替换为同语境的其他动作
- 道具/配饰可替换为同功能的其他物品
- 背景元素可替换为同氛围的其他元素
- 保持相同的画面类型（如：风景、人像、产品、场景等）
- 保持相似的视觉风格和调性
- 可以变换具体的主体、场景元素、构图角度

## 创新边界
- ✅ 同类型变体：在相同风格/类型下创作新画面
- ✅ 元素替换：用类似性质的元素替换原有元素
- ❌ 类型跨越：不得从风景变人像，不得完全改变画面性质

## 输出要求
生成一个**同类型、同风格、同氛围**但**主体/场景/元素有变化**的新画面描述。`,

    withRandomLib: `请根据我给你的每一张图或者文字说明，详细描述图片，细节的分析图片的类型，特点，画面，根据这些元素以及我的要求进行创新。

给我完整的AI描述词，方便我直接给其他软件生成图片或者视频使用。你只需要给我最终的AI描述词就行，不需要其他任何多余的内容。

关键细节要求：你对每个提示词的描述必须详尽且高度细致。切勿简略。

主体与场景：极其精确地描述所有主体、物体和角色。对于人物，详细说明其外貌、服装（面料、款式、颜色）、配饰、姿势、表情和动作。指定他们彼此之间以及与环境的空间关系。

构图与风格：明确定义镜头类型（如"特写"、"全景"）、摄像机角度（如"低角度"、"荷兰式倾斜角"）以及整体艺术风格（如"超写实 3D 渲染"、"印象派油画"、"动漫关键视觉图"）。

艺术元素：如果图像具有独特的艺术风格，你必须描述其具体特征。这包括笔触（如"明显的厚涂笔触"、"平滑融合的数字喷枪"）、线条（如"锐利、干净的赛璐璐阴影轮廓"、"草率、松散的铅笔线条"）、调色板（如"鲜艳的霓虹色"、"柔和、低饱和度的色调"）和光影（如"戏剧性的明暗对比照明"、"柔和、弥散的晨光"）。

环境：详细描述背景和前景，包括地点、时间、天气和特定的环境元素。`,
};

// 动态生成优先级说明
export function getPriorityInstruction(hasUserInput: boolean, hasRandomLib: boolean): string {
    const emphasis = '\n⚠️ 请严格按照优先级的顺序规则来生成描述词。\n给我完整的AI描述词，方便我直接给其他软件生成图片或者视频使用。你只需要给按照上述要求我最终的AI描述词就行，不需要其他任何多余的内容。';

    if (hasUserInput && hasRandomLib) {
        return '⚠️ 优先级：【用户特别要求】 > 【画面创新细节】 > 基础指令 > 默认还原' + emphasis;
    } else if (hasUserInput && !hasRandomLib) {
        return '⚠️ 优先级：【用户特别要求】 > 基础指令 > 默认还原' + emphasis;
    } else if (!hasUserInput && hasRandomLib) {
        return '⚠️ 优先级：【画面创新细节】 > 基础指令 > 默认还原' + emphasis;
    } else {
        return '⚠️ 优先级：基础指令 > 默认还原' + emphasis;
    }
}

// 保留常量用于向后兼容（默认情况）
export const FIXED_PRIORITY_INSTRUCTION = '⚠️ 优先级：【用户特别要求】 > 【画面创新细节】 > 基础指令 > 默认还原\n⚠️ 请严格按照优先级的顺序规则来生成描述词。\n给我完整的AI描述词，方便我直接给其他软件生成图片或者视频使用。你只需要给按照上述要求我最终的AI描述词就行，不需要其他任何多余的内容。';

// 默认配置
export const DEFAULT_RANDOM_LIBRARY_CONFIG: RandomLibraryConfig = {
    libraries: [],
    insertTemplate: '',
    enabled: false,
    insertPosition: 'after',
    transitionInstruction: DEFAULT_TRANSITION_INSTRUCTION,
    combinationMode: 'random', // 默认整体随机模式
    linkedInstructions: {}, // 快捷创新：总库配套指令
    quickTransitionInstruction: DEFAULT_QUICK_TRANSITION_INSTRUCTION, // 快捷创新过渡指令
    categoryLinkEnabled: true, // 默认启用分类联动（有分类数据时生效）
    quickPresetType: 'standard', // 默认使用标准预设
};

// 预设颜色
export const LIBRARY_COLORS = [
    '#f472b6', // pink
    '#fb923c', // orange
    '#facc15', // yellow
    '#4ade80', // green
    '#22d3ee', // cyan
    '#818cf8', // indigo
    '#c084fc', // purple
    '#f87171', // red
];

// 默认预设库（空库，让用户自己填充内容，默认不启用）
export const getDefaultLibraries = (): RandomLibrary[] => {
    const now = Date.now();
    return [
        {
            id: `lib_default_scene_${now}`,
            name: '场景',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[0],
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_style_${now + 1} `,
            name: '画面风格',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[1],
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_decoration_${now + 2} `,
            name: '装饰小元素',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[2],
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_props_${now + 3} `,
            name: '道具配件',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[3],
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_other_${now + 4} `,
            name: '其他元素',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[4],
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_character_${now + 5} `,
            name: '人物形象特征',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[5],
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_gender_${now + 6} `,
            name: '人物性别',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[6],
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_clothes_${now + 7} `,
            name: '衣服',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[7],
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_copy_${now + 8} `,
            name: '文案',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[0], // 循环颜色
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_age_${now + 9} `,
            name: '年龄段',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[1], // 循环颜色
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_season_${now + 10} `,
            name: '季节',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[2], // 循环颜色
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_weather_${now + 11} `,
            name: '天气',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[3], // 循环颜色
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_camera_${now + 12} `,
            name: '镜头',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[4], // 循环颜色
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
        {
            id: `lib_default_pose_${now + 13} `,
            name: '人物姿势',
            values: [],
            enabled: false,
            color: LIBRARY_COLORS[5], // 循环颜色
            pickMode: 'random-one',
            pickCount: 1,
            createdAt: now,
            updatedAt: now,
        },
    ];
};

// 获取带默认库的配置
export const getDefaultConfigWithLibraries = (): RandomLibraryConfig => ({
    ...DEFAULT_RANDOM_LIBRARY_CONFIG,
    libraries: getDefaultLibraries(),
});

// 生成唯一ID
export const generateLibraryId = (): string => {
    return `lib_${Date.now()}_${Math.random().toString(36).substr(2, 9)} `;
};

// 创建新库
export const createLibrary = (name: string, colorIndex: number = 0): RandomLibrary => {
    return {
        id: generateLibraryId(),
        name,
        values: [],
        enabled: true,
        pickMode: 'random-one',
        pickCount: 1,
        color: LIBRARY_COLORS[colorIndex % LIBRARY_COLORS.length],
        createdAt: Date.now(),
        updatedAt: Date.now(),
    };
};

// 解析粘贴的表格数据（支持横向和竖向）
export const parseTableData = (text: string): string[] => {
    // 先按换行分割
    const lines = text.split(/\r?\n/).filter(line => line.trim());

    const values: string[] = [];

    for (const line of lines) {
        // 按Tab分割（表格复制通常用Tab分隔）
        const cells = line.split('\t');
        for (const cell of cells) {
            const trimmed = cell.trim();
            if (trimmed) {
                values.push(trimmed);
            }
        }
    }

    return values;
};

// 解析粘贴的TSV表格数据为多个库（表头=库名，列=值，支持分类列）
export const parseTableDataToLibraries = (
    text: string,
    options?: { sourceLabel?: string }
): RandomLibrary[] => {
    const lines = text.split(/\r?\n/).filter(line => line.trim());
    if (lines.length < 2) return []; // 至少需要表头+一行数据

    // 解析表头
    const headers = lines[0].split('\t').map(h => h.trim());
    if (headers.length === 0 || !headers.some(h => h)) return [];

    // 识别值列和分类列
    const libraryColumns: { name: string; valueIndex: number; categoryIndex?: number; defaultCategory?: string }[] = [];

    for (let i = 0; i < headers.length; i++) {
        const header = headers[i];
        if (!header) continue;

        // 跳过分类列（以"分类"结尾的列）
        if (header.endsWith('分类')) continue;

        // 检查是否是"分类-库名"格式
        let category: string | undefined;
        let libraryName = header;
        const dashMatch = header.match(/^(.+)-(.+)$/);
        if (dashMatch) {
            category = dashMatch[1];
            libraryName = dashMatch[2];
        }

        // 检查下一列是否是对应的分类列
        const categoryHeader = header + '分类';
        const categoryIndex = headers.indexOf(categoryHeader);

        libraryColumns.push({
            name: libraryName,
            valueIndex: i,
            categoryIndex: categoryIndex !== -1 ? categoryIndex : undefined,
            defaultCategory: category,
        });
    }

    if (libraryColumns.length === 0) return [];

    // 解析数据行
    const libraryData: Map<string, { values: string[]; valuesWithCategory: LibraryValue[] }> = new Map();
    libraryColumns.forEach(col => {
        libraryData.set(col.name, { values: [], valuesWithCategory: [] });
    });

    for (let i = 1; i < lines.length; i++) {
        const cells = lines[i].split('\t');
        libraryColumns.forEach(col => {
            const value = cells[col.valueIndex]?.trim();
            if (!value) return;

            const data = libraryData.get(col.name);
            if (!data) return;

            data.values.push(value);

            // 解析分类
            let categories: string[] | undefined;
            if (col.categoryIndex !== undefined) {
                const categoryStr = cells[col.categoryIndex]?.trim();
                if (categoryStr) {
                    categories = categoryStr.split(/[,，]/).map(c => c.trim()).filter(c => c);
                    if (categories.length === 1 && categories[0] === '通用') {
                        categories = undefined;
                    }
                }
            }
            if (!categories && col.defaultCategory) {
                categories = [col.defaultCategory];
            }

            data.valuesWithCategory.push({ value, categories });
        });
    }

    // 转换为 RandomLibrary 数组
    const libraries: RandomLibrary[] = [];
    let colorIndex = 0;
    const sourceLabel = options?.sourceLabel || '手动粘贴';

    libraryData.forEach((data, name) => {
        if (data.values.length > 0) {
            const hasCategories = data.valuesWithCategory.some(v => v.categories && v.categories.length > 0);
            libraries.push({
                id: `lib_paste_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                name,
                values: data.values,
                valuesWithCategory: hasCategories ? data.valuesWithCategory : undefined,
                enabled: true,
                pickMode: 'random-one',
                pickCount: 1,
                color: LIBRARY_COLORS[colorIndex % LIBRARY_COLORS.length],
                sourceSheet: sourceLabel,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            colorIndex++;
        }
    });

    return libraries;
};

// ===== Google Sheets 公开表格读取功能 =====

// 从Google Sheets URL提取Spreadsheet ID
export const extractSpreadsheetId = (url: string): string | null => {
    // 支持多种URL格式：
    // https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/edit
    // https://docs.google.com/spreadsheets/d/SPREADSHEET_ID/
    const match = url.match(/\/spreadsheets\/d\/([a-zA-Z0-9-_]+)/);
    return match ? match[1] : null;
};

// 获取表格的所有分页（sheet）名称
export const fetchSheetNames = async (spreadsheetId: string): Promise<string[]> => {
    // 使用Google的公开API获取表格元数据
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error('无法访问表格，请确保已开启"链接可查看"权限');
        }

        // Google返回的是JSONP格式，需要解析
        const text = await response.text();
        // 尝试从返回的HTML页面中提取sheet信息
        // 备用方案：直接尝试读取第一个sheet
        return ['Sheet1']; // 默认返回，实际会在下面的函数中处理多sheet
    } catch (error) {
        console.error('获取分页列表失败:', error);
        throw new Error('获取分页列表失败，请检查表格权限');
    }
};

// 从公开的Google Sheet读取单个分页的A列数据
export const fetchSheetColumnA = async (
    spreadsheetId: string,
    sheetName: string
): Promise<string[]> => {
    // 使用公开的CSV导出API，只读取A列
    const encodedSheetName = encodeURIComponent(sheetName);
    const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodedSheetName}&range=A:A`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            throw new Error(`无法读取分页 "${sheetName}"，请确保表格已公开`);
        }

        const csvText = await response.text();

        // 解析CSV，提取A列值（跳过空行）
        const values = csvText
            .split('\n')
            .map(line => {
                // CSV格式可能有引号包裹
                let value = line.trim();
                if (value.startsWith('"') && value.endsWith('"')) {
                    value = value.slice(1, -1).replace(/""/g, '"');
                }
                return value;
            })
            .filter(value => value.length > 0);

        return values;
    } catch (error) {
        console.error(`读取分页 "${sheetName}" 失败:`, error);
        throw error;
    }
};

// 分页目录行结构（包含创新指令）
export interface CatalogRow {
    sheetName: string;         // A列：分页/总库名称
    linkedInstruction?: string; // B列：配套的创新指令
}

// Google Sheets API Key（从 sheetmind 共享）
const GOOGLE_API_KEY = 'AIzaSyBsSspB57hO83LQhAGZ_71cJeOouZzONsQ';

// 从公开的Google Sheet读取分页目录（快捷创新：分页名 + 配套指令）
// 使用 Google Sheets API 而不是 CSV，正确处理多行单元格
export const fetchCatalogWithInstructions = async (
    spreadsheetId: string,
    catalogSheetName: string
): Promise<CatalogRow[]> => {
    console.log(`[fetchCatalogWithInstructions] 开始读取分页目录: "${catalogSheetName}"`);

    // 使用 Google Sheets API 读取前5列
    const encodedSheetName = encodeURIComponent(catalogSheetName);
    const range = `${catalogSheetName}!A:E`;
    const url = `https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(range)}?valueRenderOption=FORMATTED_VALUE&key=${GOOGLE_API_KEY}`;

    try {
        const response = await fetch(url);

        if (!response.ok) {
            if (response.status === 404 || response.status === 400) {
                throw new Error(`分页 "${catalogSheetName}" 不存在`);
            }
            throw new Error(`无法读取分页 "${catalogSheetName}"，请确保表格已公开`);
        }

        const data = await response.json();
        const rows: string[][] = data.values || [];

        console.log(`[fetchCatalogWithInstructions] API返回 ${rows.length} 行`);

        if (rows.length === 0) return [];

        // 解析第一行作为表头
        const headerCells = rows[0] || [];
        console.log(`[fetchCatalogWithInstructions] 表头:`, headerCells);

        // 识别表头：先识别指令列（避免"总库配套指令"被误识别为分页名列）
        const sheetNameKeywords = ['分页名', '分页名称', '随机库', '库名', '总库名字', '总库名'];
        const instructionKeywords = ['创新指令', '基础指令', '配套指令', '指令', 'instruction', 'prompt'];

        let sheetNameCol = -1;
        let instructionCol = -1;
        let hasValidHeader = false;

        // 第一轮：先识别指令列（优先级更高）
        headerCells.forEach((cell, idx) => {
            const lower = (cell || '').toLowerCase().trim();
            if (instructionCol === -1 && instructionKeywords.some(k => lower.includes(k.toLowerCase()))) {
                instructionCol = idx;
                hasValidHeader = true;
            }
        });

        // 第二轮：识别分页名列（排除已识别的指令列）
        headerCells.forEach((cell, idx) => {
            if (idx === instructionCol) return; // 跳过已识别为指令的列
            const lower = (cell || '').toLowerCase().trim();
            if (sheetNameCol === -1 && sheetNameKeywords.some(k => lower.includes(k.toLowerCase()))) {
                sheetNameCol = idx;
                hasValidHeader = true;
            }
        });

        // 如果没有识别到有效表头，使用默认列：A=分页名，B=指令
        if (sheetNameCol === -1) sheetNameCol = 0;
        if (instructionCol === -1) instructionCol = 1;
        // 确保两列不相同
        if (sheetNameCol === instructionCol) {
            instructionCol = sheetNameCol === 0 ? 1 : 0;
        }

        console.log(`[fetchCatalogWithInstructions] 表头识别: 分页名列=${sheetNameCol}, 指令列=${instructionCol}, 有效表头=${hasValidHeader}`);

        const results: CatalogRow[] = [];

        // 验证是否是有效的分页名（简化版：只排除明显的空值和超长文本）
        const isValidSheetName = (name: string): boolean => {
            if (!name || !name.trim()) return false;
            const trimmed = name.trim();
            // 分页名不应该太长（超过50个字符很可能是指令文本）
            if (trimmed.length > 50) return false;
            // 分页名不应该包含多个句号（指令通常有句号）
            if ((trimmed.match(/。/g) || []).length >= 2) return false;
            return true;
        };

        // 从第二行开始读取数据（如果有有效表头），否则从第一行开始
        const startRow = hasValidHeader ? 1 : 0;

        console.log(`[fetchCatalogWithInstructions] 开始解析, startRow=${startRow}, 总行数=${rows.length}`);

        for (let i = startRow; i < rows.length; i++) {
            const cells = rows[i] || [];
            const sheetName = (cells[sheetNameCol] || '').trim();
            const instruction = (cells[instructionCol] || '').trim();

            // 调试：显示每行读取的内容
            if (i < startRow + 3) {
                console.log(`[fetchCatalogWithInstructions] 行${i}: sheetName="${sheetName}", instruction="${instruction?.substring(0, 50)}..."`);
            }

            // 只添加有效的分页名
            if (isValidSheetName(sheetName)) {
                results.push({
                    sheetName,
                    linkedInstruction: instruction || undefined,
                });
                console.log(`[fetchCatalogWithInstructions] ✓ 添加: sheetName="${sheetName}", hasInstruction=${!!instruction}`);
            } else {
                console.log(`[fetchCatalogWithInstructions] ✗ 跳过无效分页名: "${sheetName?.substring(0, 50)}..." (长度=${sheetName?.length || 0})`);
            }
        }

        console.log(`[fetchCatalogWithInstructions] 从 "${catalogSheetName}" 读取到 ${results.length} 行`);
        console.log(`[fetchCatalogWithInstructions] 示例数据:`, results.slice(0, 3).map(r => ({ sheetName: r.sheetName, hasInstruction: !!r.linkedInstruction, instructionPreview: r.linkedInstruction?.substring(0, 50) })));
        return results;
    } catch (error) {
        console.error(`读取分页目录 "${catalogSheetName}" 失败:`, error);
        throw error;
    }
};

// 将CSV文本分割成行（正确处理引号包裹的多行单元格）
const parseCSVToRows = (csvText: string): string[] => {
    const rows: string[] = [];
    let currentRow = '';
    let inQuotes = false;

    for (let i = 0; i < csvText.length; i++) {
        const char = csvText[i];

        if (char === '"') {
            // 处理转义引号
            if (inQuotes && csvText[i + 1] === '"') {
                currentRow += '""';
                i++;
            } else {
                inQuotes = !inQuotes;
                currentRow += char;
            }
        } else if (char === '\n' && !inQuotes) {
            // 只有不在引号内才是真正的行分隔符
            if (currentRow.trim()) {
                rows.push(currentRow);
            }
            currentRow = '';
        } else if (char === '\r') {
            // 跳过\r（Windows换行符）
            continue;
        } else {
            currentRow += char;
        }
    }

    // 添加最后一行
    if (currentRow.trim()) {
        rows.push(currentRow);
    }

    return rows;
};

// 解析CSV行为单元格数组（处理引号包裹的内容）
const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
        const char = line[i];

        if (char === '"') {
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // 跳过转义的引号
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    result.push(current.trim());
    return result;
};

// 从"随机总库"分页读取所有库（表头=库名，列=值）
// 支持分类联动：如果表头有"XX分类"列，则解析为带分类的值
export const fetchMasterSheetLibraries = async (
    spreadsheetId: string
): Promise<RandomLibrary[]> => {
    // 尝试读取"随机总库"分页
    const masterSheetNames = ['随机总库', '总库', 'Master', 'master'];

    for (const sheetName of masterSheetNames) {
        try {
            const encodedSheetName = encodeURIComponent(sheetName);
            const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodedSheetName}`;

            const response = await fetch(url);
            if (!response.ok) continue;

            const csvText = await response.text();
            const lines = csvText.split('\n').filter(line => line.trim());

            if (lines.length < 2) continue; // 至少需要表头+一行数据

            // 解析表头（第一行）
            const headers = parseCSVLine(lines[0]);
            if (headers.length === 0) continue;

            // 识别哪些列是值列，哪些是分类列
            // 分类列的表头格式："XX分类"，紧跟在值列后面
            // 也支持"分类-库名"格式的表头
            const libraryColumns: { name: string; valueIndex: number; categoryIndex?: number; defaultCategory?: string }[] = [];

            for (let i = 0; i < headers.length; i++) {
                const header = headers[i];
                if (!header) continue;

                // 检查是否是分类列（以"分类"结尾）
                if (header.endsWith('分类')) {
                    // 这是分类列，跳过（已经在前面的值列中处理）
                    continue;
                }

                // 检查表头是否是"分类-库名"格式
                let category: string | undefined;
                let libraryName = header;
                const dashMatch = header.match(/^(.+)-(.+)$/);
                if (dashMatch) {
                    category = dashMatch[1]; // 分类名
                    libraryName = dashMatch[2]; // 库名
                }

                // 检查下一列是否是对应的分类列
                const categoryHeader = header + '分类';
                const categoryIndex = headers.indexOf(categoryHeader);

                libraryColumns.push({
                    name: libraryName,
                    valueIndex: i,
                    categoryIndex: categoryIndex !== -1 ? categoryIndex : undefined,
                    defaultCategory: category, // 从表头提取的默认分类
                });
            }

            // 解析数据行
            const libraryData: Map<string, { values: string[]; valuesWithCategory: LibraryValue[] }> = new Map();

            libraryColumns.forEach(col => {
                libraryData.set(col.name, { values: [], valuesWithCategory: [] });
            });

            for (let i = 1; i < lines.length; i++) {
                const row = parseCSVLine(lines[i]);

                libraryColumns.forEach(col => {
                    const value = row[col.valueIndex]?.trim();
                    if (!value) return;

                    const data = libraryData.get(col.name);
                    if (!data) return;

                    // 添加到简单值数组
                    data.values.push(value);

                    // 解析分类
                    let categories: string[] | undefined;

                    // 优先使用分类列的值
                    if (col.categoryIndex !== undefined) {
                        const categoryStr = row[col.categoryIndex]?.trim();
                        if (categoryStr) {
                            // 分类可以用逗号分隔多个
                            categories = categoryStr.split(/[,，]/).map(c => c.trim()).filter(c => c);
                            // "通用"分类视为无分类限制
                            if (categories.length === 1 && categories[0] === '通用') {
                                categories = undefined;
                            }
                        }
                    }

                    // 如果没有分类列，使用从表头提取的默认分类（如"室内-场景"中的"室内"）
                    if (!categories && col.defaultCategory) {
                        categories = [col.defaultCategory];
                    }

                    data.valuesWithCategory.push({
                        value,
                        categories,
                    });
                });
            }

            // 转换为RandomLibrary数组
            const libraries: RandomLibrary[] = [];
            let colorIndex = 0;

            libraryData.forEach((data, name) => {
                if (data.values.length > 0) {
                    // 检查是否有分类信息
                    const hasCategories = data.valuesWithCategory.some(v => v.categories && v.categories.length > 0);

                    libraries.push({
                        id: `lib_master_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        name: name,
                        values: data.values,
                        valuesWithCategory: hasCategories ? data.valuesWithCategory : undefined,
                        enabled: true, // 从表格导入的有值，默认启用
                        pickMode: 'random-one',
                        pickCount: 1,
                        color: LIBRARY_COLORS[colorIndex % LIBRARY_COLORS.length],
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    });
                    colorIndex++;
                }
            });

            if (libraries.length > 0) {
                return libraries;
            }
        } catch (error) {
            // 该分页不存在，继续尝试下一个
            continue;
        }
    }

    return []; // 没有找到总库分页
};

// 多总库信息
export interface MasterSheetInfo {
    sheetName: string; // 分页名称
    groupName: string; // 分组名称（从分页名提取，如"衣服-随机总库"提取"衣服"）
    libraries: RandomLibrary[]; // 该分页包含的库
    linkedInstruction?: string; // 快捷创新：配套的创新指令（从分页目录B列读取）
}

// 从指定总库分页读取库（带分组信息）
export const fetchMasterSheetWithGroup = async (
    spreadsheetId: string,
    sheetName: string
): Promise<MasterSheetInfo | null> => {
    try {
        const encodedSheetName = encodeURIComponent(sheetName);
        const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:csv&sheet=${encodedSheetName}`;

        const response = await fetch(url);
        if (!response.ok) return null;

        const csvText = await response.text();
        console.log('[fetchMasterSheetWithGroup] CSV原始内容 (前500字符):', csvText.substring(0, 500));

        const lines = csvText.split('\n').filter(line => line.trim());
        console.log('[fetchMasterSheetWithGroup] 总行数:', lines.length, '第一行:', lines[0]?.substring(0, 100));

        if (lines.length < 2) return null;

        // 解析表头（第一行）
        const headers = parseCSVLine(lines[0]);
        console.log('[fetchMasterSheetWithGroup] 解析后的表头:', headers);
        if (headers.length === 0) return null;

        // 验证：如果表头看起来像分页名列表（包含"总库"或"随机总库"），说明API返回了目录分页的数据
        // 这是Google Sheets公开API的一个问题：请求不存在的分页时会返回第一个分页的数据
        const firstHeader = headers[0] || '';
        if (firstHeader.includes('随机总库') || firstHeader.includes('总库') || firstHeader.includes('目录')) {
            console.log(`[fetchMasterSheetWithGroup] 跳过：表头 "${firstHeader}" 看起来像分页名，不是库名`);
            return null;
        }

        // 识别"XX"和"XX分类"配对
        // 分类列的数据会作为对应库的valuesWithCategory导入
        const categoryColumns = new Map<string, number>(); // 库名 -> 分类列索引
        const libraryColumns = new Map<string, number>(); // 库名 -> 值列索引

        headers.forEach((header, colIndex) => {
            if (!header) return;
            if (header.endsWith('分类')) {
                // 这是分类列，找出对应的库名
                const libName = header.slice(0, -2); // 去掉"分类"后缀
                categoryColumns.set(libName, colIndex);
            } else {
                libraryColumns.set(header, colIndex);
            }
        });

        // 解析数据行，同时收集值和分类
        const libraryData: Map<string, { values: string[], categories: string[] }> = new Map();
        libraryColumns.forEach((_, name) => {
            libraryData.set(name, { values: [], categories: [] });
        });

        for (let i = 1; i < lines.length; i++) {
            const row = parseCSVLine(lines[i]);
            libraryColumns.forEach((colIndex, libName) => {
                const value = row[colIndex]?.trim();
                if (value) {
                    const data = libraryData.get(libName)!;
                    data.values.push(value);
                    // 如果有对应的分类列，也收集分类
                    const catColIndex = categoryColumns.get(libName);
                    if (catColIndex !== undefined) {
                        data.categories.push(row[catColIndex]?.trim() || '');
                    }
                }
            });
        }

        // 提取分组名称
        // 支持格式：衣服-随机总库、衣服随机总库、衣服总库
        let groupName = sheetName
            .replace(/-?随机总库$/, '')
            .replace(/-?总库$/, '')
            .replace(/-?Master$/i, '')
            .trim();

        if (!groupName || groupName === sheetName) {
            groupName = '默认'; // 如果是纯"随机总库"则用默认分组
        }

        // 转换为RandomLibrary数组
        const libraries: RandomLibrary[] = [];
        let colorIndex = 0;

        console.log('[fetchMasterSheetWithGroup] 分页:', sheetName, '表头:', headers, '数据行数:', lines.length - 1);
        console.log('[fetchMasterSheetWithGroup] 分类列配对:', Object.fromEntries(categoryColumns));

        libraryData.forEach((data, name) => {
            console.log(`[fetchMasterSheetWithGroup] 库 "${name}" 值数量:`, data.values.length, '分类数量:', data.categories.length);

            // 构建 valuesWithCategory（如果有分类数据）
            // LibraryValue 类型要求 categories 是数组，分类用逗号分隔
            let valuesWithCategory: LibraryValue[] | undefined;
            if (data.categories.length > 0 && data.categories.some(c => c)) {
                valuesWithCategory = data.values.map((value, idx) => ({
                    value,
                    categories: data.categories[idx]
                        ? data.categories[idx].split(',').map(c => c.trim()).filter(c => c)
                        : []
                }));
            }

            // 允许空库被创建（表头存在即创建）
            libraries.push({
                id: `lib_${groupName}_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                name: name,
                values: data.values,
                valuesWithCategory,
                enabled: true,
                pickMode: 'random-one',
                pickCount: 1,
                color: LIBRARY_COLORS[colorIndex % LIBRARY_COLORS.length],
                group: groupName,
                sourceSheet: sheetName, // 记录来源总库分页
                createdAt: Date.now(),
                updatedAt: Date.now(),
            });
            colorIndex++;
        });

        if (libraries.length > 0) {
            return {
                sheetName,
                groupName,
                libraries,
            };
        }

        return null;
    } catch (error) {
        return null;
    }
};

// 扫描所有分页（支持总库和单独分页两种类型）
export const scanMasterSheets = async (
    spreadsheetId: string,
    customSheetNames?: string[] // 用户自定义的分页名
): Promise<MasterSheetInfo[]> => {
    console.log('[scanMasterSheets] 开始扫描, spreadsheetId:', spreadsheetId);

    // 1. 先尝试读取目录分页，获取用户定义的分页名列表
    const catalogSheetNames = ['分页目录', '随机总库目录', '目录', '库列表', '分页列表', 'catalog', 'index'];
    // 需要跳过的默认分页名（各语言版本）
    const defaultSheetPatterns = [
        /^Sheet\d+$/i,           // Sheet1, Sheet2, sheet3...
        /^工作表\d+$/,            // 工作表1, 工作表2...
        /^シート\d+$/,            // 日文 シート1, シート2...
        /^Лист\d+$/i,            // 俄文
        /^Feuille\d+$/i,         // 法文
        /^Hoja\d+$/i,            // 西班牙文
        /^Foglio\d+$/i,          // 意大利文
    ];

    const isDefaultSheetName = (name: string): boolean => {
        return defaultSheetPatterns.some(pattern => pattern.test(name.trim()));
    };

    let userDefinedSheetNames: string[] = [];
    // 快捷创新：分页名 → 配套指令 的映射
    const instructionMap: Map<string, string> = new Map();

    for (const catalogName of catalogSheetNames) {
        try {
            // 使用新的函数读取 A 列（分页名）和 B 列（创新指令）
            const catalogRows = await fetchCatalogWithInstructions(spreadsheetId, catalogName);
            if (catalogRows.length > 0) {
                // 找到了目录分页
                userDefinedSheetNames = catalogRows
                    .map(row => row.sheetName)
                    .filter(name =>
                        name && name.trim() &&
                        !catalogSheetNames.includes(name.trim()) &&
                        !isDefaultSheetName(name)
                    );

                // 保存配套指令到映射表
                catalogRows.forEach(row => {
                    if (row.sheetName && row.linkedInstruction) {
                        instructionMap.set(row.sheetName.trim(), row.linkedInstruction);
                    }
                });

                console.log(`[scanMasterSheets] 从"${catalogName}"分页读取到 ${userDefinedSheetNames.length} 个分页名, ${instructionMap.size} 个配套指令`);
                console.log(`[scanMasterSheets] 配套指令映射:`, Object.fromEntries(instructionMap));
                break;
            } else {
                console.log(`[scanMasterSheets] 目录"${catalogName}"返回空结果`);
            }
        } catch (e) {
            // 该目录分页不存在，继续尝试下一个
            console.log(`[scanMasterSheets] 尝试读取目录"${catalogName}"失败:`, e);
        }
    }

    // 2. 合并分页名来源（同样过滤掉默认名）
    // 只有在没有找到目录分页且没有用户自定义分页名时，才使用基础默认名
    const fallbackSheetNames = (userDefinedSheetNames.length === 0 && (!customSheetNames || customSheetNames.length === 0))
        ? ['随机总库']
        : [];

    const trySheetNames = [
        ...userDefinedSheetNames,
        ...(customSheetNames || []).filter(name => !isDefaultSheetName(name)),
        ...fallbackSheetNames,
    ];

    console.log('[scanMasterSheets] 尝试扫描的分页名:', trySheetNames);

    const results: MasterSheetInfo[] = [];
    const foundSheets = new Set<string>();
    const contentHashes = new Set<string>();

    for (const sheetName of trySheetNames) {
        if (foundSheets.has(sheetName)) continue;

        // 判断分页类型：包含"随机总库"或"总库" → 按总库读取，否则按单独分页读取
        const isMasterSheet = sheetName.includes('随机总库') || sheetName.includes('总库') || sheetName.toLowerCase() === 'master';

        let info: MasterSheetInfo | null = null;

        if (isMasterSheet) {
            // 按总库方式读取（表头=库名，列=值）
            info = await fetchMasterSheetWithGroup(spreadsheetId, sheetName);
        } else {
            // 按单独分页方式读取（分页名=库名，A列=值）
            try {
                const values = await fetchSheetColumnA(spreadsheetId, sheetName);
                if (values.length > 0) {
                    // 解析分页名中的分类信息（如 "室内-场景" → 分类=室内, 库名=场景）
                    let category: string | undefined;
                    let libraryName = sheetName;
                    const dashMatch = sheetName.match(/^(.+)-(.+)$/);
                    if (dashMatch) {
                        category = dashMatch[1];
                        libraryName = dashMatch[2];
                    }

                    // 构建带分类的值数组
                    const valuesWithCategory: LibraryValue[] = values.map(value => ({
                        value,
                        categories: category ? [category] : undefined,
                    }));

                    info = {
                        sheetName,
                        groupName: category || '默认',
                        libraries: [{
                            id: `lib_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                            name: libraryName,
                            values: values,
                            valuesWithCategory: valuesWithCategory,
                            enabled: true,
                            pickMode: 'random-one',
                            pickCount: 1,
                            color: LIBRARY_COLORS[results.length % LIBRARY_COLORS.length],
                            sourceSheet: sheetName, // 记录来源分页
                            createdAt: Date.now(),
                            updatedAt: Date.now(),
                        }],
                    };
                }
            } catch (e) {
                // 分页不存在或读取失败
            }
        }

        if (info && info.libraries.length > 0) {
            // 内容hash去重
            const contentHash = info.libraries
                .map(lib => `${lib.name}:${lib.values.slice(0, 5).join(',')}`)
                .sort()
                .join('|');

            if (!contentHashes.has(contentHash)) {
                contentHashes.add(contentHash);
                // 快捷创新：附加配套指令（从分页目录B列读取）
                const linkedInstruction = instructionMap.get(sheetName);
                console.log(`[scanMasterSheets] 查找配套指令: sheetName="${sheetName}", found=${!!linkedInstruction}, instructionMapSize=${instructionMap.size}`);
                if (linkedInstruction) {
                    info.linkedInstruction = linkedInstruction;
                    console.log(`[scanMasterSheets] ✓ 附加指令到 "${sheetName}": ${linkedInstruction.substring(0, 50)}...`);
                }
                results.push(info);
                foundSheets.add(sheetName);
            }
        }
    }

    return results;
};

// 从公开的Google Sheet导入所有分页作为随机库
// 支持两种格式：
// 1. 多分页模式：每个分页名=库名，A列=值
// 2. 单分页模式：一个"随机总库"分页，表头=库名，列=值
export const importFromGoogleSheets = async (
    spreadsheetUrl: string,
    existingLibraries: RandomLibrary[],
    mode: 'replace' | 'merge-add' | 'merge-update' = 'merge-add'
): Promise<RandomLibrary[]> => {
    const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
    if (!spreadsheetId) {
        throw new Error('无效的Google Sheets链接');
    }

    // 首先尝试读取"随机总库"分页（单分页模式）
    const masterLibraries = await fetchMasterSheetLibraries(spreadsheetId);

    // 同时尝试读取多分页模式的库
    // 尝试获取所有分页
    let sheetNames: string[] = [];

    try {
        // 尝试通过gviz API获取分页信息
        const response = await fetch(
            `https://docs.google.com/spreadsheets/d/${spreadsheetId}/gviz/tq?tqx=out:json&sheet=`
        );
        // 忽略结果，使用备用方案
    } catch (e) {
        // 忽略错误，使用备用方案
    }

    // 尝试一些常见的分页名称
    const trySheetNames = [
        '场景', '画面风格', '装饰小元素', '道具配件', '其他元素',
        '人物形象特征', '人物性别', '衣服', '文案', '年龄段', '季节', '天气', '镜头', '人物姿势',
        'Sheet1', 'Sheet2', 'Sheet3', 'Sheet4', 'Sheet5',
        '工作表1', '工作表2', '工作表3'
    ];

    const sheetLibraries: RandomLibrary[] = [];

    // 尝试读取每个可能的分页
    for (const sheetName of trySheetNames) {
        try {
            const values = await fetchSheetColumnA(spreadsheetId, sheetName);

            if (values.length > 0) {
                sheetNames.push(sheetName);

                // 解析分页名中的分类信息（如"室内-场景" → 分类=室内, 库名=场景）
                let category: string | undefined;
                let libraryName = sheetName;
                const dashMatch = sheetName.match(/^(.+)-(.+)$/);
                if (dashMatch) {
                    category = dashMatch[1]; // 分类名
                    libraryName = dashMatch[2]; // 库名
                }

                // 构建带分类的值数组
                const valuesWithCategory: LibraryValue[] = values.map(value => ({
                    value,
                    categories: category ? [category] : undefined,
                }));

                sheetLibraries.push({
                    id: `lib_sheets_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    name: libraryName,
                    values: values,
                    valuesWithCategory: valuesWithCategory,
                    enabled: true,
                    pickMode: 'random-one',
                    pickCount: 1,
                    color: LIBRARY_COLORS[sheetLibraries.length % LIBRARY_COLORS.length],
                    createdAt: Date.now(),
                    updatedAt: Date.now(),
                });
            }
        } catch (error) {
            // 该分页不存在或无法读取，跳过
            continue;
        }
    }

    // 合并总库和分页的结果
    // 分页库优先（如果同名，分页覆盖总库）
    const allImportedLibraries: RandomLibrary[] = [...masterLibraries];
    const masterNames = new Set(masterLibraries.map(lib => lib.name));

    for (const sheetLib of sheetLibraries) {
        const existing = allImportedLibraries.find(lib => lib.name === sheetLib.name);
        if (existing) {
            // 同名库：合并值（保留重复）
            existing.values = [...existing.values, ...sheetLib.values];
            existing.updatedAt = Date.now();
        } else {
            // 新库：直接添加
            allImportedLibraries.push(sheetLib);
        }
    }

    if (allImportedLibraries.length === 0) {
        throw new Error('未能从表格中读取到任何数据，请确保：\n1. 表格已开启"链接可查看"权限\n2. 使用以下任一格式：\n   • 多分页模式：分页名=库名，A列=值\n   • 单分页模式：创建"随机总库"分页，表头=库名，列=值');
    }

    // 根据模式处理
    const existingNames = new Set(existingLibraries.map(lib => lib.name));

    if (mode === 'replace') {
        return allImportedLibraries;
    } else if (mode === 'merge-update') {
        // 合并更新：同名库合并值
        for (const newLib of allImportedLibraries) {
            const existing = existingLibraries.find(lib => lib.name === newLib.name);
            if (existing) {
                // 保留重复值
                existing.values = [...existing.values, ...newLib.values];
                existing.updatedAt = Date.now();
            } else {
                existingLibraries.push(newLib);
            }
        }
        return existingLibraries;
    } else {
        // merge-add：只添加新库
        const newLibs = allImportedLibraries.filter(lib => !existingNames.has(lib.name));
        return [...existingLibraries, ...newLibs];
    }
};

// 从Google Sheets通过gid读取分页（更可靠的方式）
export const importFromGoogleSheetsByGid = async (
    spreadsheetUrl: string,
    sheetConfigs: { gid: string; name: string }[],
    existingLibraries: RandomLibrary[],
    mode: 'replace' | 'merge-add' | 'merge-update' = 'merge-add'
): Promise<RandomLibrary[]> => {
    const spreadsheetId = extractSpreadsheetId(spreadsheetUrl);
    if (!spreadsheetId) {
        throw new Error('无效的Google Sheets链接');
    }

    const importedLibraries: RandomLibrary[] = [];
    const existingNames = new Set(existingLibraries.map(lib => lib.name));

    for (const config of sheetConfigs) {
        try {
            // 使用gid读取分页
            const url = `https://docs.google.com/spreadsheets/d/${spreadsheetId}/export?format=csv&gid=${config.gid}&range=A:A`;
            const response = await fetch(url);

            if (!response.ok) continue;

            const csvText = await response.text();
            const values = csvText
                .split('\n')
                .map(line => {
                    let value = line.trim();
                    if (value.startsWith('"') && value.endsWith('"')) {
                        value = value.slice(1, -1).replace(/""/g, '"');
                    }
                    return value;
                })
                .filter(v => v.length > 0);

            if (values.length > 0) {
                const existingLib = existingLibraries.find(lib => lib.name === config.name);

                if (mode === 'replace' || (mode === 'merge-add' && !existingLib)) {
                    importedLibraries.push({
                        id: `lib_sheets_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                        name: config.name,
                        values: values,
                        enabled: true,
                        pickMode: 'random-one',
                        pickCount: 1,
                        color: LIBRARY_COLORS[importedLibraries.length % LIBRARY_COLORS.length],
                        createdAt: Date.now(),
                        updatedAt: Date.now(),
                    });
                } else if (mode === 'merge-update' && existingLib) {
                    existingLib.values = [...new Set([...existingLib.values, ...values])];
                    existingLib.updatedAt = Date.now();
                }
            }
        } catch (error) {
            console.warn(`读取gid=${config.gid}失败:`, error);
            continue;
        }
    }

    if (mode === 'replace') {
        return importedLibraries;
    }
    return [...existingLibraries, ...importedLibraries.filter(lib => !existingNames.has(lib.name))];
};

// 加权随机选择一个值
const weightedRandomSelect = (values: string[], weights: Record<string, number>): string => {
    // 计算所有值的权重（默认为1）
    const weightedValues = values.map(v => ({
        value: v,
        weight: weights[v] ?? 1
    }));

    // 计算总权重
    const totalWeight = weightedValues.reduce((sum, item) => sum + item.weight, 0);

    // 生成随机数
    let random = Math.random() * totalWeight;

    // 按权重选择
    for (const item of weightedValues) {
        random -= item.weight;
        if (random <= 0) {
            return item.value;
        }
    }

    // 兜底返回最后一个
    return values[values.length - 1];
};

// 加权随机选择多个值（不重复）
const weightedRandomSelectMultiple = (values: string[], weights: Record<string, number>, count: number): string[] => {
    const result: string[] = [];
    const remaining = [...values];
    const actualCount = Math.min(count, values.length);

    for (let i = 0; i < actualCount; i++) {
        if (remaining.length === 0) break;

        const selected = weightedRandomSelect(remaining, weights);
        result.push(selected);

        // 从剩余值中移除已选择的
        const idx = remaining.indexOf(selected);
        if (idx > -1) remaining.splice(idx, 1);
    }

    return result;
};

// 从库中随机抽取值（支持权重）
export const pickRandomValues = (library: RandomLibrary): string[] => {
    if (library.values.length === 0) return [];

    const weights = library.valueWeights ?? {};

    switch (library.pickMode) {
        case 'random-one': {
            return [weightedRandomSelect(library.values, weights)];
        }
        case 'random-multiple': {
            const count = Math.min(library.pickCount, library.values.length);
            return weightedRandomSelectMultiple(library.values, weights, count);
        }
        case 'sequential': {
            // 顺序模式，返回第一个（需要外部维护索引）
            return [library.values[0]];
        }
        default:
            return [];
    }
};

// 从带分类的库中随机抽取值（支持分类过滤）
export const pickRandomValuesWithCategory = (
    library: RandomLibrary,
    allowedCategory?: string // 如果指定，只从该分类的值中抽取
): string[] => {
    const valuesWithCategory = library.valuesWithCategory;

    // 如果没有分类信息，使用普通的抽取
    if (!valuesWithCategory || valuesWithCategory.length === 0) {
        return pickRandomValues(library);
    }

    // 筛选符合分类的值
    let filteredValues: LibraryValue[];
    if (allowedCategory) {
        filteredValues = valuesWithCategory.filter(v => {
            // 没有分类的值（通用）可以配任何分类
            if (!v.categories || v.categories.length === 0) return true;
            // 有分类的值需要匹配
            return v.categories.includes(allowedCategory);
        });
    } else {
        filteredValues = valuesWithCategory;
    }

    if (filteredValues.length === 0) return [];

    // 根据抽取模式选择
    switch (library.pickMode) {
        case 'random-one': {
            const index = Math.floor(Math.random() * filteredValues.length);
            return [filteredValues[index].value];
        }
        case 'random-multiple': {
            const count = Math.min(library.pickCount, filteredValues.length);
            const shuffled = [...filteredValues].sort(() => Math.random() - 0.5);
            return shuffled.slice(0, count).map(v => v.value);
        }
        case 'sequential': {
            return [filteredValues[0].value];
        }
        default:
            return [];
    }
};

// 获取配置中所有库的所有分类
export const getAllCategories = (config: RandomLibraryConfig): string[] => {
    const categories = new Set<string>();

    for (const lib of config.libraries) {
        if (lib.valuesWithCategory) {
            for (const v of lib.valuesWithCategory) {
                if (v.categories) {
                    v.categories.forEach(c => categories.add(c));
                }
            }
        }
    }

    return Array.from(categories);
};

// 检查配置是否有分类联动数据
export const hasCategoryLinkData = (config: RandomLibraryConfig): boolean => {
    return config.libraries.some(lib =>
        lib.valuesWithCategory && lib.valuesWithCategory.some(v => v.categories && v.categories.length > 0)
    );
};

// AI智能分类结果类型
export interface AICategoryResult {
    categories: string[]; // 建议的分类列表
    assignments: {
        [libraryName: string]: {
            [value: string]: string[]; // 每个值对应的分类
        };
    };
}

// 生成AI分类的Prompt
export const buildAICategoryPrompt = (config: RandomLibraryConfig): string => {
    const librariesInfo: string[] = [];

    for (const lib of config.libraries) {
        if (lib.values.length > 0) {
            librariesInfo.push(`${lib.name}：[${lib.values.slice(0, 50).join(', ')}${lib.values.length > 50 ? '...' : ''}]`);
        }
    }

    return `你是一个智能分类助手。请根据以下随机库的值，分析它们的使用场景，给出合理的分类建议。

目标：让同一分类下的值可以合理组合，避免不合理的组合（如"室内场景"配"轮船"）。

随机库数据：
${librariesInfo.join('\n')}

请返回JSON格式（不要有任何其他文字）：
{
  "categories": ["分类1", "分类2", "分类3"],
  "assignments": {
    "库名1": { "值1": ["分类1"], "值2": ["分类1", "分类2"] },
    "库名2": { "值1": ["分类2"], "值2": ["分类3"] }
  }
}

注意：
1. 分类数量建议2-5个，如"室内"、"室外"、"水边"等
2. 一个值可以属于多个分类（如"自行车"可以在室内和室外）
3. 通用的值可以不指定分类或标记为"通用"
4. 只返回JSON，不要有其他解释`;
};

// 应用AI分类结果到配置
export const applyAICategoryResult = (
    config: RandomLibraryConfig,
    result: AICategoryResult
): RandomLibraryConfig => {
    const newLibraries = config.libraries.map(lib => {
        const libAssignments = result.assignments[lib.name];
        if (!libAssignments) {
            return lib;
        }

        const valuesWithCategory: LibraryValue[] = lib.values.map(value => {
            const categories = libAssignments[value];
            return {
                value,
                categories: categories && categories.length > 0 && !(categories.length === 1 && categories[0] === '通用')
                    ? categories
                    : undefined,
            };
        });

        return {
            ...lib,
            valuesWithCategory,
        };
    });

    return {
        ...config,
        libraries: newLibraries,
        categoryLinkEnabled: true, // 自动开启分类联动
    };
};

// 根据模板生成随机组合文本（支持分类联动）
export const generateRandomCombination = (config: RandomLibraryConfig): string => {
    if (!config.enabled || config.libraries.length === 0) return '';

    // 过滤启用的库，并根据participationRate概率决定是否参与本次组合
    const enabledLibraries = config.libraries.filter(lib => {
        if (!lib.enabled || lib.values.length === 0) return false;
        // 根据概率决定是否参与（默认100%必选）
        const rate = lib.participationRate ?? 100;
        if (rate >= 100) return true; // 100%必选
        if (rate <= 0) return false; // 0%不选
        return Math.random() * 100 < rate; // 按概率决定
    });
    if (enabledLibraries.length === 0) return '';

    // 检查是否启用分类联动且有分类数据
    const useCategoryLink = config.categoryLinkEnabled && hasCategoryLinkData(config);

    // 如果启用分类联动，先随机选择一个分类
    let selectedCategory: string | undefined;
    if (useCategoryLink) {
        const allCategories = getAllCategories(config);
        if (allCategories.length > 0) {
            selectedCategory = allCategories[Math.floor(Math.random() * allCategories.length)];
        }
    }

    let result = config.insertTemplate;

    // 如果没有模板，自动生成
    if (!result.trim()) {
        const parts: string[] = [];
        for (const lib of enabledLibraries) {
            const picked = useCategoryLink
                ? pickRandomValuesWithCategory(lib, selectedCategory)
                : pickRandomValues(lib);
            if (picked.length > 0) {
                parts.push(`${lib.name}：${picked.join('、')}`);
            }
        }
        return parts.join('，');
    }

    // 替换模板中的占位符
    for (const lib of enabledLibraries) {
        const placeholder = `{${lib.name}}`;
        if (result.includes(placeholder)) {
            const picked = useCategoryLink
                ? pickRandomValuesWithCategory(lib, selectedCategory)
                : pickRandomValues(lib);
            result = result.replace(new RegExp(placeholder.replace(/[{}]/g, '\\$&'), 'g'), picked.join('、'));
        }
    }

    // 清理未使用的占位符
    result = result.replace(/\{[^}]+\}/g, '');

    return result.trim();
};

// 全局已使用组合集合（用于跨卡片去重）
let usedCombinations = new Set<string>();

// 重置已使用组合（在批量创新开始时调用）
export const resetUsedCombinations = (): void => {
    usedCombinations = new Set<string>();
};

// 生成唯一的随机组合（避免重复）
export const generateUniqueRandomCombination = (
    config: RandomLibraryConfig,
    maxAttempts: number = 50
): string | null => {
    if (!config.enabled || config.libraries.length === 0) return null;

    const enabledLibraries = config.libraries.filter(lib => lib.enabled && lib.values.length > 0);
    if (enabledLibraries.length === 0) return null;

    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const combination = generateRandomCombination(config);
        if (combination && !usedCombinations.has(combination)) {
            usedCombinations.add(combination);
            return combination;
        }
    }

    // 如果尝试多次都重复，返回最后一个（允许少量重复）
    return generateRandomCombination(config);
};

// 生成多个唯一随机组合
export const generateMultipleUniqueCombinations = (
    config: RandomLibraryConfig,
    count: number
): string[] => {
    if (!config.enabled) return [];

    const combinations: string[] = [];
    const localUsed = new Set<string>();

    for (let i = 0; i < count; i++) {
        let attempts = 0;
        let combination: string | null = null;

        while (attempts < 100) {
            combination = generateRandomCombination(config);
            if (combination && !localUsed.has(combination) && !usedCombinations.has(combination)) {
                localUsed.add(combination);
                usedCombinations.add(combination);
                combinations.push(combination);
                break;
            }
            attempts++;
        }

        // 如果实在找不到唯一组合，允许使用重复的
        if (attempts >= 100 && combination) {
            combinations.push(combination);
        }
    }

    return combinations;
};

// 生成笛卡尔积组合（排列组合模式）
// 例如：场景库抽5个×风格库抽2个 = 10个组合
export const generateCartesianCombinations = (
    config: RandomLibraryConfig
): string[] => {
    if (!config.enabled) return [];

    const enabledLibraries = config.libraries.filter(lib => lib.enabled && lib.values.length > 0);
    if (enabledLibraries.length === 0) return [];

    // 从每个库随机抽取指定数量的值
    const libraryPicks: { name: string; values: string[] }[] = enabledLibraries.map(lib => {
        const count = lib.pickMode === 'random-multiple' ? Math.min(lib.pickCount, lib.values.length) : 1;
        const shuffled = [...lib.values].sort(() => Math.random() - 0.5);
        return {
            name: lib.name,
            values: shuffled.slice(0, count)
        };
    });

    // 生成笛卡尔积
    const cartesian = (arrays: string[][]): string[][] => {
        if (arrays.length === 0) return [[]];
        const [first, ...rest] = arrays;
        const restCombinations = cartesian(rest);
        const result: string[][] = [];
        for (const item of first) {
            for (const combo of restCombinations) {
                result.push([item, ...combo]);
            }
        }
        return result;
    };

    const allCombinations = cartesian(libraryPicks.map(lp => lp.values));

    // 格式化输出
    return allCombinations.map(combo => {
        return combo.map((value, index) => `${libraryPicks[index].name}：${value}`).join('，');
    });
};

// 云同步：保存配置
export const saveRandomLibraryConfig = async (config: RandomLibraryConfig): Promise<void> => {
    const auth = getAuth();
    const user = auth.currentUser;

    if (!user) {
        // 未登录时保存到本地
        localStorage.setItem('randomLibraryConfig', JSON.stringify(config));
        return;
    }

    try {
        const db = getFirestore();
        const docRef = doc(db, 'users', user.uid, 'settings', 'randomLibrary');
        await setDoc(docRef, {
            ...config,
            updatedAt: Date.now(),
        });
        // 同时保存本地副本
        localStorage.setItem('randomLibraryConfig', JSON.stringify(config));
    } catch (error) {
        console.error('保存随机库配置失败:', error);
        // 失败时保存到本地
        localStorage.setItem('randomLibraryConfig', JSON.stringify(config));
    }
};

// 合并默认库到现有配置中（只添加用户配置中没有的新库）
const mergeDefaultLibraries = (config: RandomLibraryConfig): RandomLibraryConfig => {
    const defaultLibs = getDefaultLibraries();
    const existingNames = new Set(config.libraries.map(lib => lib.name));

    // 找出用户配置中没有的新预设库
    const newLibraries = defaultLibs.filter(lib => !existingNames.has(lib.name));

    if (newLibraries.length === 0) {
        return config;
    }

    // 合并新库到用户配置
    return {
        ...config,
        libraries: [...config.libraries, ...newLibraries],
    };
};

// 云同步：加载配置
export const loadRandomLibraryConfig = async (): Promise<RandomLibraryConfig> => {
    const auth = getAuth();
    const user = auth.currentUser;

    // 先尝试从本地加载
    const localConfig = localStorage.getItem('randomLibraryConfig');
    let localData: RandomLibraryConfig | null = null;
    if (localConfig) {
        try {
            localData = JSON.parse(localConfig);
        } catch {
            localData = null;
        }
    }

    let result: RandomLibraryConfig;

    if (!user) {
        result = localData || DEFAULT_RANDOM_LIBRARY_CONFIG;
    } else {
        try {
            const db = getFirestore();
            const docRef = doc(db, 'users', user.uid, 'settings', 'randomLibrary');
            const docSnap = await getDoc(docRef);

            if (docSnap.exists()) {
                const cloudData = docSnap.data() as RandomLibraryConfig;
                // 同步到本地
                localStorage.setItem('randomLibraryConfig', JSON.stringify(cloudData));
                result = cloudData;
            } else {
                result = localData || DEFAULT_RANDOM_LIBRARY_CONFIG;
            }
        } catch (error) {
            console.error('加载随机库配置失败:', error);
            result = localData || DEFAULT_RANDOM_LIBRARY_CONFIG;
        }
    }

    // 自动合并新的预设库（不会覆盖用户已有的库）
    const merged = mergeDefaultLibraries(result);

    // 如果有新库被添加，保存更新后的配置
    if (merged.libraries.length > result.libraries.length) {
        localStorage.setItem('randomLibraryConfig', JSON.stringify(merged));
        // 如果用户已登录，也同步到云端
        if (user) {
            saveRandomLibraryConfig(merged).catch(err => {
                console.warn('保存合并后的配置失败:', err);
            });
        }
    }

    return merged;
};

// 导出所有库为JSON
export const exportLibraries = (config: RandomLibraryConfig): string => {
    return JSON.stringify({
        version: 1,
        exportedAt: new Date().toISOString(),
        data: config,
    }, null, 2);
};

// 导入库
export interface ImportOptions {
    mode: 'replace' | 'merge-add' | 'merge-update';
    // replace: 完全覆盖
    // merge-add: 只添加新库，不覆盖已有
    // merge-update: 添加新库，同名库更新值
}

export const importLibraries = (
    jsonString: string,
    currentConfig: RandomLibraryConfig,
    options: ImportOptions
): RandomLibraryConfig => {
    try {
        const imported = JSON.parse(jsonString);
        const importedConfig = imported.data || imported as RandomLibraryConfig;

        if (!importedConfig.libraries) {
            throw new Error('无效的导入数据');
        }

        switch (options.mode) {
            case 'replace':
                return {
                    ...importedConfig,
                    // 确保结构完整
                    enabled: importedConfig.enabled ?? false,
                    insertTemplate: importedConfig.insertTemplate ?? '',
                    insertPosition: importedConfig.insertPosition ?? 'after',
                };

            case 'merge-add': {
                const existingNames = new Set(currentConfig.libraries.map(lib => lib.name));
                const newLibraries = importedConfig.libraries.filter(
                    (lib: RandomLibrary) => !existingNames.has(lib.name)
                );
                return {
                    ...currentConfig,
                    libraries: [...currentConfig.libraries, ...newLibraries],
                };
            }

            case 'merge-update': {
                const existingMap = new Map(currentConfig.libraries.map(lib => [lib.name, lib]));

                for (const importedLib of importedConfig.libraries) {
                    const existing = existingMap.get(importedLib.name);
                    if (existing) {
                        // 合并值（去重或保留重复取决于设计）
                        existing.values = [...existing.values, ...importedLib.values];
                        existing.updatedAt = Date.now();
                    } else {
                        existingMap.set(importedLib.name, importedLib);
                    }
                }

                return {
                    ...currentConfig,
                    libraries: Array.from(existingMap.values()),
                };
            }

            default:
                return currentConfig;
        }
    } catch (error) {
        console.error('导入失败:', error);
        throw new Error('导入失败：数据格式无效');
    }
};
