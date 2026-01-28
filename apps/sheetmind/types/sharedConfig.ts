/**
 * 统一配置类型 - 用于转置面板和画廊面板共享
 */

// 排序规则
export interface SortRule {
    column: string;
    descending: boolean;
}

// 自定义筛选器
export interface CustomFilter {
    id: string;
    column: string;
    operator:
    | 'contains' | 'notContains' | 'equals' | 'notEquals'
    | 'startsWith' | 'endsWith' | 'notEmpty' | 'isEmpty'
    | 'regex' | 'multiSelect'
    | 'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' | 'between';
    value: string;
    value2?: string;  // For 'between' operator
    selectedValues?: string[];  // For 'multiSelect' mode
}

// 数字筛选器
export interface NumFilter {
    id: string;
    column: string;
    operator: 'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' | 'equals' | 'notEquals' | 'between' | 'notEmpty' | 'isEmpty';
    value: string;
    value2?: string;
}

// 高亮规则
export interface HighlightRule {
    id: string;
    column: string;
    operator:
    | 'contains' | 'notContains' | 'equals' | 'notEquals'
    | 'startsWith' | 'endsWith' | 'notEmpty' | 'isEmpty' | 'regex'
    | 'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' | 'between'
    | 'today' | 'thisWeek' | 'thisMonth' | 'dateEquals' | 'dateBefore' | 'dateAfter'
    | 'hasLink' | 'hasImageLink' | 'hasFormula';
    value: string;
    value2?: string;
    color: string;
    borderWidth?: number;
    enabled?: boolean;
}

// 数值范围分组
export interface GroupBinRange {
    id: string;
    label: string;
    min: number | null;
    max: number | null;
}

// Condition for text group matching
export interface TextGroupCondition {
    id: string;
    operator: 'contains' | 'equals' | 'startsWith' | 'endsWith' |
    'greaterThan' | 'lessThan' | 'greaterOrEqual' | 'lessOrEqual' | 'numEquals';
    value: string;
}

// 文本分组
export interface TextGroupBin {
    id: string;
    label: string;
    values: string[];
    keywords?: string[]; // Keywords for fuzzy matching (contains match) - legacy
    conditions?: TextGroupCondition[]; // Conditions with operators for flexible matching
}

// 日期范围分组
export interface DateBinRange {
    id: string;
    label: string;
    startDate: string;
    endDate: string;
}

// 多级分组层级配置
export interface GroupLevel {
    id: string;                       // 唯一ID
    column: string;                   // 分组列名
    type: 'text' | 'numeric' | 'date'; // 分组类型
    // 数值范围分组配置（type='numeric' 时使用）
    numericBins?: GroupBinRange[];
    // 文本分组配置（type='text' 时使用）
    textBins?: TextGroupBin[];
    // 日期分组配置（type='date' 时使用）
    dateBins?: DateBinRange[];
}

// 统一配置结构
export interface SharedConfig {
    // === 配置模式 ===
    useGlobalConfig?: boolean;        // 是否使用全局配置（默认true）

    // === 数据格式 ===
    transposeData?: boolean;          // 是否转置数据（横向数据转纵向）
    mergeTransposeColumns?: boolean;  // 是否合并同名列（如 贴文点赞量 [1.X] 和 [2.Y] 合并为一个列）

    // === 分组设置 ===
    groupColumn: string;              // 分组依据列（向后兼容，单级分组）
    groupColumns: string[];           // 多级分组列（向后兼容）
    groupLevels: GroupLevel[];        // 多级分组配置（新增，每级独立配置）
    // 数值范围分组（向后兼容，用于单级分组）
    groupBinning: boolean;
    groupBins: GroupBinRange[];
    // 文本分组（向后兼容，用于单级分组）
    textGrouping: boolean;
    textGroupBins: TextGroupBin[];
    // 关键词合并分组（模糊匹配）
    fuzzyRuleText: string;  // 格式: "目标分组=关键词1|关键词2;目标分组2=关键词3"

    // === 日期设置 ===
    dateColumn: string;               // 日期列
    dateStart: string;                // 日期筛选开始
    dateEnd: string;                  // 日期筛选结束
    // 日期范围分组
    dateBinning: boolean;
    dateBins: DateBinRange[];

    // === 显示列设置 ===
    displayColumns: string[];         // 显示信息列（转置数据列 / 画廊标签列）
    imageColumn: string;              // 图片列
    linkColumn: string;               // 链接列
    accountColumn: string;            // 账号列

    // === 筛选设置 ===
    filtersEnabled?: boolean;         // 是否启用筛选（日期+自定义+数字）
    customFilters: CustomFilter[];    // 自定义筛选
    numFilters: NumFilter[];          // 数字筛选

    // === 排序设置 ===
    sortEnabled?: boolean;            // 是否启用排序
    sortRules: SortRule[];            // 多级排序

    // === 高亮设置 ===
    highlightEnabled?: boolean;       // 是否启用高亮
    highlightRules: HighlightRule[];  // 高亮规则
}

// 配置版本/预设
export interface ConfigPreset {
    id: string;
    name: string;
    config: SharedConfig;
    createdAt: number;
}

// 默认配置
export const getDefaultSharedConfig = (): SharedConfig => ({
    // 数据格式
    transposeData: false,
    mergeTransposeColumns: false,
    // 分组
    groupColumn: '',
    groupColumns: [],
    groupLevels: [],
    groupBinning: false,
    groupBins: [],
    textGrouping: false,
    textGroupBins: [],
    fuzzyRuleText: '',
    // 日期
    dateColumn: '',
    dateStart: '',
    dateEnd: '',
    dateBinning: false,
    dateBins: [],
    // 显示列
    displayColumns: [],
    imageColumn: '',
    linkColumn: '',
    accountColumn: '',
    // 筛选
    filtersEnabled: true,
    customFilters: [],
    numFilters: [],
    // 排序
    sortEnabled: true,
    sortRules: [],
    // 高亮
    highlightEnabled: true,
    highlightRules: [],
});
