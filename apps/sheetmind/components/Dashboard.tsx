
import React, { useMemo, useState, useEffect, useCallback, useRef, memo } from 'react';
import { SheetData, FilterCondition, ChartType, AggregationType, ChartSnapshot } from '../types';
import {
    BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie,
    RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    ScatterChart, Scatter, FunnelChart, Funnel, Treemap,
    XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, Legend, LabelList
} from 'recharts';
import {
    LayoutDashboard, Hash, PieChart as PieChartIcon,
    BarChart3, Filter, Settings2, Plus, X, Copy, Check, Activity,
    Hexagon, ScatterChart as ScatterIcon, Filter as FunnelIcon, BoxSelect, Trash2,
    SlidersHorizontal,
    LineChart as LineChartIcon,
    Layers,
    Zap,
    Pin,
    Split,
    Table2,
    Cloud,
    Loader2,
    Sparkles,
    Lightbulb,
    TrendingUp,
    Calendar,
    Download,
    Upload,
    BarChart2,
    Grid,
    AlertTriangle
} from 'lucide-react';
import {
    isUserLoggedIn,
    saveDashboardBinsToCloud,
    loadDashboardBinsFromCloud,
    BinRange as CloudBinRange
} from '../services/firebaseService';

interface DashboardProps {
    data: SheetData;
    onAddSnapshot: (snapshot: ChartSnapshot) => void;
}

export const COLORS = [
    '#0088FE', '#00C49F', '#FFBB28', '#FF8042', '#8884d8',
    '#82ca9d', '#ffc658', '#ff7f50', '#a4de6c', '#d0ed57',
    '#8dd1e1', '#a4c8e0', '#d88884', '#e8c3b9', '#c6c6c6'
];

interface BinRange {
    id: string;
    label: string;
    min: number;
    max: number;
}

// Grouped Operators
const OPERATOR_GROUPS = [
    {
        label: "文本规则",
        options: [
            { value: 'eq', label: '等于 (Is)' },
            { value: 'neq', label: '不等于 (Not Is)' },
            { value: 'contains', label: '包含 (Contains)' },
            { value: 'notContains', label: '不包含 (Not Contains)' },
            { value: 'startsWith', label: '开头是 (Starts With)' },
            { value: 'endsWith', label: '结尾是 (Ends With)' },
        ]
    },
    {
        label: "数值/范围",
        options: [
            { value: 'gt', label: '大于 (>)' },
            { value: 'gte', label: '大于或等于 (>=)' },
            { value: 'lt', label: '小于 (<)' },
            { value: 'lte', label: '小于或等于 (<=)' },
            { value: 'between', label: '介于 (Between)' },
        ]
    },
    {
        label: "日期规则",
        options: [
            { value: 'dateIs', label: '日期为 (Date Is)' },
            { value: 'dateBefore', label: '日期早于 (Before)' },
            { value: 'dateAfter', label: '日期晚于 (After)' },
        ]
    }
];

// --- SMART CHART RECOMMENDATION TYPES ---
interface ColumnAnalysis {
    name: string;
    type: 'text' | 'number' | 'date' | 'mixed';
    uniqueCount: number;
    nullCount: number;
    totalCount: number;
    isLowCardinality: boolean; // 低基数 (适合分组)
    isHighCardinality: boolean; // 高基数 (适合做指标)
    hasNegatives: boolean;
    min?: number;
    max?: number;
    avg?: number;
    sampleValues: string[];
}

interface ChartRecommendation {
    id: string;
    title: string;
    description: string;
    chartType: ChartType;
    dimensionCol: string;
    metricCol: string;
    breakdownCol: string;
    aggregation: AggregationType;
    score: number; // 推荐分数 (用于排序)
    icon: 'bar' | 'pie' | 'line' | 'trend' | 'distribution';
}

// --- SMART DATA ANALYZER ---
const analyzeColumn = (rows: any[], colName: string): ColumnAnalysis => {
    const values = rows.map(r => r[colName]);
    const nonNullValues = values.filter(v => v !== null && v !== undefined && v !== '');
    const uniqueValues = new Set(nonNullValues.map(v => String(v)));

    // 检测类型
    let numericCount = 0;
    let dateCount = 0;
    let numbers: number[] = [];

    for (const val of nonNullValues) {
        const str = String(val);
        const num = parseFloat(str);
        if (!isNaN(num) && isFinite(num)) {
            numericCount++;
            numbers.push(num);
        }
        // 简单日期检测
        if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str) || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(str)) {
            dateCount++;
        }
    }

    const isNumeric = numericCount > nonNullValues.length * 0.8;
    const isDate = dateCount > nonNullValues.length * 0.8;

    let type: 'text' | 'number' | 'date' | 'mixed' = 'text';
    if (isDate) type = 'date';
    else if (isNumeric) type = 'number';
    else if (numericCount > 0 && numericCount < nonNullValues.length * 0.5) type = 'mixed';

    const uniqueRatio = uniqueValues.size / Math.max(nonNullValues.length, 1);

    return {
        name: colName,
        type,
        uniqueCount: uniqueValues.size,
        nullCount: values.length - nonNullValues.length,
        totalCount: values.length,
        isLowCardinality: uniqueValues.size <= 20 && uniqueValues.size > 1,
        isHighCardinality: uniqueRatio > 0.5 && uniqueValues.size > 20,
        hasNegatives: numbers.some(n => n < 0),
        min: numbers.length > 0 ? Math.min(...numbers) : undefined,
        max: numbers.length > 0 ? Math.max(...numbers) : undefined,
        avg: numbers.length > 0 ? numbers.reduce((a, b) => a + b, 0) / numbers.length : undefined,
        sampleValues: Array.from(uniqueValues).slice(0, 5)
    };
};

// --- SMART RECOMMENDATION ENGINE ---
const generateSmartRecommendations = (rows: any[], columns: string[]): ChartRecommendation[] => {
    if (rows.length === 0 || columns.length === 0) return [];

    // 分析所有列
    const analyses = columns.map(col => analyzeColumn(rows, col));

    // 找出分类列 (低基数文本/日期)
    const categoryColumns = analyses.filter(a =>
        (a.type === 'text' || a.type === 'date') && a.isLowCardinality
    );

    // 找出数值列 (可做指标)
    const numericColumns = analyses.filter(a => a.type === 'number');

    // 找出日期列 (时间序列)
    const dateColumns = analyses.filter(a => a.type === 'date');

    const recommendations: ChartRecommendation[] = [];
    let recId = 0;

    // === 推荐1: 基础分布统计 (如果有分类列) ===
    if (categoryColumns.length > 0) {
        const bestCat = categoryColumns.sort((a, b) => {
            // 优先选择基数在 3-15 之间的
            const scoreA = a.uniqueCount >= 3 && a.uniqueCount <= 15 ? 100 : 50;
            const scoreB = b.uniqueCount >= 3 && b.uniqueCount <= 15 ? 100 : 50;
            return scoreB - scoreA;
        })[0];

        recommendations.push({
            id: `rec-${recId++}`,
            title: `「${bestCat.name}」分布统计`,
            description: `按 ${bestCat.name} 分组统计数量 (共 ${bestCat.uniqueCount} 个分类)`,
            chartType: bestCat.uniqueCount <= 6 ? 'pie' : 'bar',
            dimensionCol: bestCat.name,
            metricCol: '',
            breakdownCol: '',
            aggregation: 'count',
            score: 95,
            icon: bestCat.uniqueCount <= 6 ? 'pie' : 'bar'
        });
    }

    // === 推荐2: 数值汇总 (如果有数值列 + 分类列) ===
    if (numericColumns.length > 0 && categoryColumns.length > 0) {
        const bestNum = numericColumns[0];
        const bestCat = categoryColumns[0];

        recommendations.push({
            id: `rec-${recId++}`,
            title: `「${bestCat.name}」的${bestNum.name}统计`,
            description: `按 ${bestCat.name} 汇总 ${bestNum.name} 的总和`,
            chartType: 'bar',
            dimensionCol: bestCat.name,
            metricCol: bestNum.name,
            breakdownCol: '',
            aggregation: 'sum',
            score: 90,
            icon: 'bar'
        });

        // 平均值版本
        recommendations.push({
            id: `rec-${recId++}`,
            title: `「${bestCat.name}」的${bestNum.name}平均值`,
            description: `按 ${bestCat.name} 计算 ${bestNum.name} 的平均值`,
            chartType: 'bar-horizontal',
            dimensionCol: bestCat.name,
            metricCol: bestNum.name,
            breakdownCol: '',
            aggregation: 'avg',
            score: 85,
            icon: 'bar'
        });
    }

    // === 推荐3: 交叉分析 (如果有2个分类列) ===
    if (categoryColumns.length >= 2) {
        const [cat1, cat2] = categoryColumns;
        recommendations.push({
            id: `rec-${recId++}`,
            title: `「${cat1.name}」×「${cat2.name}」交叉分析`,
            description: `按 ${cat1.name} 和 ${cat2.name} 双维度统计分布`,
            chartType: 'bar',
            dimensionCol: cat1.name,
            metricCol: '',
            breakdownCol: cat2.name,
            aggregation: 'count',
            score: 80,
            icon: 'bar'
        });
    }

    // === 推荐4: 时间趋势 (如果有日期列) ===
    if (dateColumns.length > 0) {
        const dateCol = dateColumns[0];
        recommendations.push({
            id: `rec-${recId++}`,
            title: `「${dateCol.name}」时间趋势`,
            description: `按日期查看数据变化趋势`,
            chartType: 'line',
            dimensionCol: dateCol.name,
            metricCol: numericColumns.length > 0 ? numericColumns[0].name : '',
            breakdownCol: '',
            aggregation: numericColumns.length > 0 ? 'sum' : 'count',
            score: 88,
            icon: 'trend'
        });
    }

    // === 推荐5: 占比分析 (饼图) ===
    if (categoryColumns.length > 0 && numericColumns.length > 0) {
        const bestCat = categoryColumns.find(c => c.uniqueCount <= 8) || categoryColumns[0];
        if (bestCat && bestCat.uniqueCount <= 10) {
            recommendations.push({
                id: `rec-${recId++}`,
                title: `「${bestCat.name}」${numericColumns[0].name}占比`,
                description: `查看各 ${bestCat.name} 的 ${numericColumns[0].name} 占比`,
                chartType: 'pie',
                dimensionCol: bestCat.name,
                metricCol: numericColumns[0].name,
                breakdownCol: '',
                aggregation: 'sum',
                score: 75,
                icon: 'pie'
            });
        }
    }

    // === 推荐6: 漏斗分析 ===
    if (categoryColumns.length > 0 && numericColumns.length > 0) {
        const smallCat = categoryColumns.find(c => c.uniqueCount >= 3 && c.uniqueCount <= 7);
        if (smallCat) {
            recommendations.push({
                id: `rec-${recId++}`,
                title: `「${smallCat.name}」漏斗分析`,
                description: `查看各阶段的转化情况`,
                chartType: 'funnel',
                dimensionCol: smallCat.name,
                metricCol: numericColumns[0].name,
                breakdownCol: '',
                aggregation: 'sum',
                score: 70,
                icon: 'distribution'
            });
        }
    }

    // 按分数排序
    return recommendations.sort((a, b) => b.score - a.score).slice(0, 6);
};

// --- REUSABLE CHART COMPONENT (Exported for Gallery) ---
export const GenericChart: React.FC<{
    type: ChartType;
    data: any[];
    breakdownKeys: string[];
    aggregation: string;
    metricLabel: string;
    xAxisLabel: string;
    isStacked: boolean;
    showValues?: boolean;
}> = ({ type, data, breakdownKeys, aggregation, metricLabel, xAxisLabel, isStacked, showValues = true }) => {

    if (!data || data.length === 0) return <div className="h-full flex items-center justify-center text-slate-400">暂无数据</div>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const CommonTooltip = ({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-lg text-xs z-50">
                    <p className="font-bold mb-2 border-b pb-1">{label}</p>
                    {/* Show Total */}
                    {!isStacked && type !== 'pie' && (
                        <div className="flex justify-between gap-4 mb-1">
                            <span className="text-slate-500">总计:</span>
                            <span className="font-mono font-bold text-blue-600">{payload[0].payload.value}</span>
                        </div>
                    )}
                    {/* Show Breakdown */}
                    {payload.map((entry: any, idx: number) => (
                        <div key={idx} className="flex justify-between gap-4 items-center">
                            <span className="flex items-center gap-1">
                                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: entry.color }}></span>
                                {entry.name}:
                            </span>
                            <span className="font-mono">{typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}</span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    };

    // Helper to generate bars/lines for stacked data
    const renderStacks = (ChartComponent: any) => {
        if (isStacked) {
            return breakdownKeys.map((key, index) => (
                <ChartComponent
                    key={key}
                    dataKey={key}
                    stackId="a"
                    fill={COLORS[index % COLORS.length]}
                    stroke={COLORS[index % COLORS.length]}
                    name={key}
                    isAnimationActive={false}
                >
                    {showValues && <LabelList dataKey={key} position="top" fill="#fff" fontSize={10} formatter={(val: number) => val > 0 ? val : ''} />}
                </ChartComponent>
            ));
        }
        // Default Single Series
        return (
            <ChartComponent
                dataKey="value"
                name={metricLabel || aggregation}
                fill="#8884d8"
                stroke="#8884d8"
                radius={type === 'bar' ? [4, 4, 0, 0] : 0}
                isAnimationActive={false}
            >
                {!isStacked && data.map((entry, index) => (
                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                    <Cell key={`cell-${index}`} fill={(entry as any).isOther ? '#94a3b8' : COLORS[index % COLORS.length]} />
                ))}
                {showValues && (
                    <LabelList
                        dataKey="value"
                        position="top"
                        offset={5}
                        fill="#64748b"
                        fontSize={10}
                        formatter={(val: number) => val.toLocaleString()}
                    />
                )}
            </ChartComponent>
        );
    };

    return (
        <ResponsiveContainer width="100%" height="100%">
            {(() => {
                switch (type) {
                    case 'bar':
                        return (
                            <BarChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} tickLine={false} angle={-30} textAnchor="end" interval={0} height={60} label={{ value: xAxisLabel, position: 'insideBottom', offset: -10, fontSize: 10, fill: '#cbd5e1' }} />
                                <YAxis stroke="#94a3b8" fontSize={12} tickLine={false} />
                                <Tooltip content={CommonTooltip} cursor={{ fill: '#f8fafc' }} />
                                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '20px' }} />
                                {isStacked ? breakdownKeys.map((key, index) => (
                                    <Bar key={key} dataKey={key} stackId="a" fill={COLORS[index % COLORS.length]} name={key} isAnimationActive={false}>
                                        {showValues && <LabelList dataKey={key} position="top" fill="#fff" fontSize={10} formatter={(val: number) => val > 0 ? val : ''} />}
                                    </Bar>
                                )) : (
                                    <Bar dataKey="value" name={metricLabel || aggregation} fill="#8884d8" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                        {data.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={(entry as any).isOther ? '#94a3b8' : COLORS[index % COLORS.length]} />
                                        ))}
                                        {showValues && (
                                            <LabelList dataKey="value" position="top" offset={5} fill="#64748b" fontSize={10} formatter={(val: number) => val.toLocaleString()} />
                                        )}
                                    </Bar>
                                )}
                            </BarChart>
                        );
                    case 'bar-horizontal':
                        return (
                            <BarChart layout="vertical" data={data} margin={{ top: 20, right: 50, left: 40, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                <XAxis type="number" stroke="#94a3b8" fontSize={12} />
                                <YAxis type="category" dataKey="name" stroke="#94a3b8" fontSize={11} width={100} />
                                <Tooltip content={CommonTooltip} cursor={{ fill: '#f8fafc' }} />
                                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '20px' }} />
                                {renderStacks(Bar)}
                            </BarChart>
                        );
                    case 'line':
                        return (
                            <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} angle={-30} textAnchor="end" height={60} label={{ value: xAxisLabel, position: 'insideBottom', offset: -10, fontSize: 10, fill: '#cbd5e1' }} />
                                <YAxis stroke="#94a3b8" fontSize={12} />
                                <Tooltip content={CommonTooltip} />
                                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '20px' }} />
                                {isStacked ? breakdownKeys.map((key, index) => (
                                    <Line key={key} type="monotone" dataKey={key} stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} name={key} isAnimationActive={false} />
                                )) : (
                                    <Line type="monotone" dataKey="value" stroke="#8884d8" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 8 }} name={metricLabel || aggregation} isAnimationActive={false}>
                                        {showValues && <LabelList dataKey="value" position="top" offset={10} fill="#64748b" fontSize={10} />}
                                    </Line>
                                )}
                            </LineChart>
                        );
                    case 'area':
                        return (
                            <AreaChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: 40 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" stroke="#94a3b8" fontSize={12} angle={-30} textAnchor="end" height={60} label={{ value: xAxisLabel, position: 'insideBottom', offset: -10, fontSize: 10, fill: '#cbd5e1' }} />
                                <YAxis stroke="#94a3b8" fontSize={12} />
                                <Tooltip content={CommonTooltip} />
                                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '20px' }} />
                                {renderStacks(Area)}
                            </AreaChart>
                        );
                    case 'pie':
                        return (
                            <PieChart>
                                <Pie
                                    data={data}
                                    cx="50%" cy="45%"
                                    innerRadius={showValues ? 50 : 35}
                                    outerRadius={showValues ? 80 : 55}
                                    paddingAngle={2}
                                    dataKey="value"
                                    isAnimationActive={false}
                                    // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                    label={showValues ? ({ name, percentage }: any) => `${name} ${percentage}%` : false}
                                >
                                    {data.map((entry, index) => (
                                        // eslint-disable-next-line @typescript-eslint/no-explicit-any
                                        <Cell key={`cell-${index}`} fill={(entry as any).isOther ? '#94a3b8' : COLORS[index % COLORS.length]} />
                                    ))}
                                </Pie>
                                <Tooltip />
                                <Legend
                                    layout="horizontal"
                                    verticalAlign="bottom"
                                    align="center"
                                    wrapperStyle={{ fontSize: '10px', paddingTop: '5px' }}
                                />
                            </PieChart>
                        );
                    case 'radar':
                        return (
                            <RadarChart cx="50%" cy="50%" outerRadius="70%" data={data}>
                                <PolarGrid />
                                <PolarAngleAxis dataKey="name" fontSize={10} />
                                <PolarRadiusAxis angle={30} domain={[0, 'auto']} />
                                <Radar name={metricLabel || aggregation} dataKey="value" stroke="#8884d8" fill="#8884d8" fillOpacity={0.6} isAnimationActive={false} />
                                <Tooltip />
                                <Legend />
                            </RadarChart>
                        );
                    case 'scatter':
                        return (
                            <ScatterChart margin={{ top: 20, right: 20, bottom: 20, left: 20 }}>
                                <CartesianGrid />
                                <XAxis type="number" dataKey="x" name={xAxisLabel} unit="" stroke="#94a3b8" fontSize={12}>
                                    <LabelList dataKey="x" position="bottom" />
                                </XAxis>
                                <YAxis type="number" dataKey="y" name={metricLabel} unit="" stroke="#94a3b8" fontSize={12} />
                                <Tooltip cursor={{ strokeDasharray: '3 3' }} contentStyle={{ borderRadius: '8px' }} />
                                <Scatter name="数据点" data={data} fill="#8884d8" isAnimationActive={false} />
                            </ScatterChart>
                        );
                    case 'funnel':
                        return (
                            <FunnelChart>
                                <Tooltip />
                                <Funnel dataKey="value" data={data} isAnimationActive={false}>
                                    <LabelList position="right" fill="#000" stroke="none" dataKey="name" />
                                </Funnel>
                            </FunnelChart>
                        );
                    case 'treemap':
                        return (
                            <Treemap
                                data={data}
                                dataKey="value"
                                aspectRatio={4 / 3}
                                stroke="#fff"
                                fill="#8884d8"
                            >
                                <Tooltip />
                            </Treemap>
                        );
                    default:
                        return null;
                }
            })()}
        </ResponsiveContainer>
    );
};


const Dashboard: React.FC<DashboardProps> = ({ data, onAddSnapshot }) => {
    // --- VISUALIZATION CONFIG STATE ---
    const [chartType, setChartType] = useState<ChartType>('bar');
    const [dimensionCol, setDimensionCol] = useState<string>(data.columns[0] || ''); // X-Axis
    const [subDimensionCol, setSubDimensionCol] = useState<string>(''); // Secondary X-Axis
    const [breakdownCol, setBreakdownCol] = useState<string>(''); // Stack / Legend / Series
    const [metricCol, setMetricCol] = useState<string>(''); // Y-Axis
    const [aggregation, setAggregation] = useState<AggregationType>('count');
    const [showValues, setShowValues] = useState(true);

    // Scatter Plot specific: X-Axis Value
    const [scatterXCol, setScatterXCol] = useState<string>('');

    // --- DATA BINNING (RANGES) STATE ---
    // Row field binning
    const [enableRowBinning, setEnableRowBinning] = useState(false);
    const [rowBins, setRowBins] = useState<BinRange[]>([
        { id: '1', label: '低 (0-100)', min: 0, max: 100 },
        { id: '2', label: '中 (101-500)', min: 101, max: 500 },
        { id: '3', label: '高 (501+)', min: 501, max: 999999 }
    ]);
    // Column field binning (for pivot table style)
    const [enableColBinning, setEnableColBinning] = useState(false);
    const [colBins, setColBins] = useState<BinRange[]>([
        { id: 'c1', label: '普通', min: 0, max: 1000 },
        { id: 'c2', label: '爆贴', min: 1001, max: 2500 },
        { id: 'c3', label: '大爆贴', min: 2501, max: Infinity }
    ]);

    // Legacy compatibility
    const enableBinning = enableRowBinning;
    const bins = rowBins;
    const setBins = setRowBins;

    // --- FILTER STATE ---
    const [excludeEmpty, setExcludeEmpty] = useState<boolean>(true);
    const [filters, setFilters] = useState<FilterCondition[]>([]);

    // --- UI / LIMIT STATE ---
    const [maxItems, setMaxItems] = useState<number>(20); // Top N limiter
    const [sortConfig, setSortConfig] = useState<{ key: string, direction: 'asc' | 'desc' }>({
        key: 'name', // Default sort by name (which will handle bin order)
        direction: 'asc'
    });
    const [copied, setCopied] = useState(false);

    // --- CHART DISPLAY MODE ---
    // 'total' = 总和视图, 'faceted' = 分面视图(每个分段一个图), 'filtered' = 筛选视图
    const [chartDisplayMode, setChartDisplayMode] = useState<'total' | 'faceted' | 'filtered'>('total');
    const [selectedBreakdowns, setSelectedBreakdowns] = useState<string[]>([]); // 选中的分段列

    // --- PERFORMANCE STATE ---
    const [isProcessing, setIsProcessing] = useState(false);
    const [calculationVersion, setCalculationVersion] = useState(0);
    const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastCalcConfigRef = useRef<string>('');

    // --- MANUAL GENERATION MODE ---
    // 图表不会自动生成，需要用户点击“生成图表”按钮
    const [chartGenerated, setChartGenerated] = useState(false);

    // --- SMART RECOMMENDATIONS ---
    const [showRecommendations, setShowRecommendations] = useState(false);
    const [recommendations, setRecommendations] = useState<ChartRecommendation[]>([]);
    const [isAnalyzing, setIsAnalyzing] = useState(false);

    // Reset defaults when data changes
    useEffect(() => {
        setDimensionCol(data.columns[0] || '');
        setSubDimensionCol('');
        setMetricCol('');
        setBreakdownCol('');
        setFilters([]);
        setAggregation('count');
        // Reset calculation state for new data
        lastCalcConfigRef.current = '';
        setChartGenerated(false); // 重置图表生成状态
    }, [data]);


    // Threshold for auto-calculation
    const LARGE_DATA_THRESHOLD = 2000;
    const isLargeDataset = data.rows.length > LARGE_DATA_THRESHOLD;

    // Create a config signature to detect changes
    const configSignature = `${dimensionCol}|${subDimensionCol}|${breakdownCol}|${metricCol}|${aggregation}|${enableBinning}|${bins.length}|${enableColBinning}|${colBins.length}|${filters.length}|${sortConfig.key}|${sortConfig.direction}|${maxItems}`;

    // For large datasets, check if calculation is needed
    const needsRecalculation = isLargeDataset && lastCalcConfigRef.current !== configSignature;

    // Manual calculation trigger for large datasets
    const triggerCalculation = useCallback(() => {
        setIsProcessing(true);
        lastCalcConfigRef.current = configSignature;
        setCalculationVersion(v => v + 1);
        setTimeout(() => {
            setIsProcessing(false);
        }, 100);
    }, [configSignature]);

    // 手动生成图表
    const handleGenerateChart = useCallback(() => {
        setIsProcessing(true);
        lastCalcConfigRef.current = configSignature;
        setChartGenerated(true);
        setTimeout(() => {
            setIsProcessing(false);
        }, 100);
    }, [configSignature]);

    // 生成智能推荐
    const handleSmartAnalyze = useCallback(() => {
        setIsAnalyzing(true);
        setShowRecommendations(true);
        // 用 setTimeout 让 UI 先更新
        setTimeout(() => {
            const recs = generateSmartRecommendations(data.rows, data.columns);
            setRecommendations(recs);
            setIsAnalyzing(false);
        }, 300);
    }, [data.rows, data.columns]);

    // 应用推荐配置
    const applyRecommendation = useCallback((rec: ChartRecommendation) => {
        setChartType(rec.chartType);
        setDimensionCol(rec.dimensionCol);
        setMetricCol(rec.metricCol);
        setBreakdownCol(rec.breakdownCol);
        setAggregation(rec.aggregation);
        setShowRecommendations(false);
        setEnableRowBinning(false);
        setEnableColBinning(false);
        setSubDimensionCol('');
        // 自动触发生成
        setChartGenerated(true);
        setIsProcessing(true);
        lastCalcConfigRef.current = '';
        setTimeout(() => setIsProcessing(false), 100);
    }, []);

    // --- AUTO BINNING LOGIC ---
    const handleAutoBinning = () => {
        if (!dimensionCol) return;

        // Extract numbers
        const values = data.rows
            .map(r => parseFloat(String(r[dimensionCol])))
            .filter(n => !isNaN(n));

        if (values.length === 0) {
            alert("当前维度列没有检测到有效数值，无法自动分段。请确保选择了数值列（如“评论数”）。");
            return;
        }

        const min = Math.min(...values);
        const max = Math.max(...values);

        if (min === max) {
            setBins([{ id: Date.now().toString(), label: `${min}`, min: min, max: max }]);
            setEnableRowBinning(true);
            return;
        }

        // Generate 5 bins
        const binCount = 5;
        const interval = (max - min) / binCount;

        const newBins: BinRange[] = [];
        for (let i = 0; i < binCount; i++) {
            const rawStart = min + (i * interval);
            const rawEnd = min + ((i + 1) * interval);

            // Adjust last bin to definitely include max
            const isLast = i === binCount - 1;
            const effectiveEnd = isLast ? max : rawEnd;

            const format = (n: number) => Number.isInteger(n) ? n : parseFloat(n.toFixed(1));

            newBins.push({
                id: Date.now().toString() + i,
                label: `${format(rawStart)}-${format(effectiveEnd)}`,
                min: parseFloat(rawStart.toFixed(2)),
                max: parseFloat(effectiveEnd.toFixed(2))
            });
        }
        setBins(newBins);
        setEnableRowBinning(true);

        // Force sort by name (which maps to bin min value) ascending
        setSortConfig({ key: 'name', direction: 'asc' });
    };

    // --- PRESET EXPORT/IMPORT ---
    interface DashboardPreset {
        name: string;
        version: number;
        rowBins: BinRange[];
        colBins: BinRange[];
        enableRowBinning: boolean;
        enableColBinning: boolean;
        aggregation: AggregationType;
        maxItems: number;
        showValues: boolean;
    }

    const exportPreset = () => {
        const preset: DashboardPreset = {
            name: 'Dashboard Preset',
            version: 1,
            rowBins,
            colBins,
            enableRowBinning,
            enableColBinning,
            aggregation,
            maxItems,
            showValues
        };
        const json = JSON.stringify(preset, null, 2);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `dashboard-preset-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const importPresetRef = useRef<HTMLInputElement>(null);

    const handleImportPreset = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (ev) => {
            try {
                const preset = JSON.parse(ev.target?.result as string) as DashboardPreset;
                if (preset.rowBins) setRowBins(preset.rowBins);
                if (preset.colBins) setColBins(preset.colBins);
                if (preset.enableRowBinning !== undefined) setEnableRowBinning(preset.enableRowBinning);
                if (preset.enableColBinning !== undefined) setEnableColBinning(preset.enableColBinning);
                if (preset.aggregation) setAggregation(preset.aggregation);
                if (preset.maxItems) setMaxItems(preset.maxItems);
                if (preset.showValues !== undefined) setShowValues(preset.showValues);
                alert('预设加载成功！');
            } catch (err) {
                alert('预设文件格式错误');
            }
        };
        reader.readAsText(file);
        // Reset input
        if (importPresetRef.current) importPresetRef.current.value = '';
    };

    // Auto-save to localStorage and sync to Firebase
    const [binsSyncing, setBinsSyncing] = useState(false);
    const binsCloudLoadedRef = useRef(false);

    // Load from localStorage first, then override with cloud data
    useEffect(() => {
        // Load from localStorage
        const savedPreset = localStorage.getItem('dashboard-bins-preset');
        if (savedPreset) {
            try {
                const p = JSON.parse(savedPreset);
                if (p.rowBins) setRowBins(p.rowBins);
                if (p.colBins) setColBins(p.colBins);
            } catch { }
        }

        // Then load from cloud (cloud takes priority)
        const loadFromCloud = async () => {
            if (!isUserLoggedIn()) return;
            try {
                const cloudBins = await loadDashboardBinsFromCloud();
                if (cloudBins && (cloudBins.rowBins.length > 0 || cloudBins.colBins.length > 0)) {
                    binsCloudLoadedRef.current = true;
                    if (cloudBins.rowBins.length > 0) setRowBins(cloudBins.rowBins);
                    if (cloudBins.colBins.length > 0) setColBins(cloudBins.colBins);
                }
            } catch (err) {
                console.error('[Cloud Sync] Failed to load dashboard bins:', err);
            }
        };
        loadFromCloud();
    }, []);

    // Save to localStorage and sync to Firebase
    useEffect(() => {
        // Save to localStorage immediately
        localStorage.setItem('dashboard-bins-preset', JSON.stringify({ rowBins, colBins }));

        // Sync to Firebase (debounced)
        if (isUserLoggedIn()) {
            const syncTimeout = setTimeout(async () => {
                try {
                    setBinsSyncing(true);
                    await saveDashboardBinsToCloud({ rowBins, colBins });
                } catch (err) {
                    console.error('[Cloud Sync] Failed to save dashboard bins:', err);
                } finally {
                    setBinsSyncing(false);
                }
            }, 2000); // 2 second debounce
            return () => clearTimeout(syncTimeout);
        }
    }, [rowBins, colBins]);

    // --- 2. DATA PROCESSING PIPELINE ---
    const processedData = useMemo(() => {
        // 如果还没有点击“生成图表”，返回空数据
        if (!chartGenerated) {
            return {
                chartData: [],
                tableData: [],
                totalValue: 0,
                totalCount: 0,
                breakdownKeys: [],
                isSkipped: true,
                notGenerated: true
            };
        }

        // For large datasets, skip processing until user triggers it
        if (isLargeDataset && needsRecalculation) {
            return {
                chartData: [],
                tableData: [],
                totalValue: 0,
                totalCount: 0,
                breakdownKeys: [],
                isSkipped: true
            };
        }

        // Step A: Filtering
        const filteredRows = data.rows.filter(row => {
            return filters.every(filter => {
                const rawRowVal = row[filter.column];
                const rowStr = String(rawRowVal || '').toLowerCase();
                const filterVal = filter.value.toLowerCase();

                switch (filter.operator) {
                    case 'eq': return rowStr === filterVal;
                    case 'neq': return rowStr !== filterVal;
                    case 'contains': return rowStr.includes(filterVal);
                    case 'notContains': return !rowStr.includes(filterVal);
                    case 'startsWith': return rowStr.startsWith(filterVal);
                    case 'endsWith': return rowStr.endsWith(filterVal);
                    case 'gt': return parseFloat(rowStr) > parseFloat(filterVal);
                    case 'gte': return parseFloat(rowStr) >= parseFloat(filterVal);
                    case 'lt': return parseFloat(rowStr) < parseFloat(filterVal);
                    case 'lte': return parseFloat(rowStr) <= parseFloat(filterVal);
                    case 'between': {
                        const v1 = parseFloat(filter.value);
                        const v2 = parseFloat(filter.value2 || '0');
                        const val = parseFloat(rowStr);
                        return !isNaN(val) && val >= v1 && val <= v2;
                    }
                    case 'dateIs': return rowStr.startsWith(filterVal);
                    case 'dateBefore': return (Date.parse(rowStr) || 0) < (Date.parse(filterVal) || 0);
                    case 'dateAfter': return (Date.parse(rowStr) || 0) > (Date.parse(filterVal) || 0);
                    default: return true;
                }
            });
        });

        // Special Case: Scatter Chart (Raw Rows)
        if (chartType === 'scatter') {
            if (!scatterXCol || !metricCol) return { chartData: [], tableData: [], totalValue: 0, totalCount: 0, breakdownKeys: [] };

            const scatterData = filteredRows.map(row => ({
                x: parseFloat(String(row[scatterXCol] || 0)),
                y: parseFloat(String(row[metricCol] || 0)),
                name: row[dimensionCol] || 'Item',
                z: breakdownCol ? row[breakdownCol] : undefined // Optional Z dimension for color
            })).filter(d => !isNaN(d.x) && !isNaN(d.y));

            return { chartData: scatterData, tableData: scatterData, totalValue: 0, totalCount: scatterData.length, breakdownKeys: [] };
        }

        // Step B: Grouping (Cross-Tab Logic)
        const groups: Record<string, any> = {};
        const breakdownKeysSet = new Set<string>();

        const getRowKey = (row: any) => {
            let primaryKey = '';

            // 1. Calculate Main Key
            if (enableBinning && dimensionCol) {
                const val = parseFloat(String(row[dimensionCol]));
                if (isNaN(val)) return null;
                const matchingBin = bins.find(b => val >= b.min && val <= b.max);
                primaryKey = matchingBin ? matchingBin.label : 'Out of Range';
            } else {
                let key = String(row[dimensionCol]);
                if (excludeEmpty && (!key || key === 'undefined' || key === 'null')) return null;
                if (!key) primaryKey = "(空值)";
                else primaryKey = key;
            }

            // 2. Append Secondary Dimension Key (if active)
            if (subDimensionCol) {
                const subVal = String(row[subDimensionCol] || '(空)');
                primaryKey = `${primaryKey} / ${subVal}`;
            }

            return primaryKey;
        };

        filteredRows.forEach(row => {
            const mainKey = getRowKey(row);
            if (mainKey === null) return;

            if (!groups[mainKey]) groups[mainKey] = { name: mainKey, count: 0, sum: 0, _values: [] };

            let metricVal = 0;
            if (metricCol) {
                metricVal = parseFloat(String(row[metricCol]));
                if (isNaN(metricVal)) metricVal = 0;
            }

            groups[mainKey].count += 1;
            groups[mainKey].sum += metricVal;
            groups[mainKey]._values.push(metricVal);

            if (breakdownCol) {
                let subKey = String(row[breakdownCol]);
                if (!subKey || subKey === 'undefined') subKey = '(未定义)';

                // Apply column binning if enabled
                if (enableColBinning && colBins.length > 0) {
                    const numVal = parseFloat(subKey);
                    if (!isNaN(numVal)) {
                        const matchedBin = colBins.find(bin => numVal >= bin.min && numVal < (bin.max === Infinity ? Number.MAX_VALUE : bin.max));
                        subKey = matchedBin ? matchedBin.label : '(其他)';
                    }
                }

                breakdownKeysSet.add(subKey);

                if (!groups[mainKey][subKey]) groups[mainKey][subKey] = 0;

                if (aggregation === 'count') {
                    groups[mainKey][subKey] += 1;
                } else if (aggregation === 'sum') {
                    groups[mainKey][subKey] += metricVal;
                } else if (aggregation === 'avg') {
                    groups[mainKey][subKey] += metricVal;
                }
            }
        });

        // Sort breakdown keys - if using column binning, sort by bin order
        let breakdownKeys: string[];
        if (enableColBinning && colBins.length > 0) {
            // Sort by bin order
            const binOrder = colBins.map(b => b.label);
            breakdownKeys = Array.from(breakdownKeysSet).sort((a, b) => {
                const idxA = binOrder.indexOf(a);
                const idxB = binOrder.indexOf(b);
                if (idxA === -1 && idxB === -1) return a.localeCompare(b);
                if (idxA === -1) return 1;
                if (idxB === -1) return -1;
                return idxA - idxB;
            });
        } else {
            breakdownKeys = Array.from(breakdownKeysSet).sort();
        }

        // Step C: Format Output Data
        let totalValue = 0;
        let totalCount = 0;

        const fullData = Object.values(groups).map((group: any) => {
            let value = 0;
            if (aggregation === 'count') value = group.count;
            else if (aggregation === 'sum') value = group.sum;
            else if (aggregation === 'avg') value = group.count > 0 ? (group.sum / group.count) : 0;

            value = parseFloat(value.toFixed(2));
            totalValue += value;
            totalCount += group.count;

            return {
                ...group,
                value,
                _values: undefined
            };
        });

        // Calculate Percentages
        const fullDataWithPercentage = fullData.map(d => ({
            ...d,
            percentage: totalValue > 0 ? parseFloat(((d.value / totalValue) * 100).toFixed(1)) : 0
        }));

        // Step D: Sort
        fullDataWithPercentage.sort((a, b) => {
            const factor = sortConfig.direction === 'asc' ? 1 : -1;

            if (enableBinning && sortConfig.key === 'name') {
                // Extract the bin label part if combined
                const labelA = subDimensionCol ? a.name.split(' / ')[0] : a.name;
                const labelB = subDimensionCol ? b.name.split(' / ')[0] : b.name;

                const binA = bins.find(bin => bin.label === labelA);
                const binB = bins.find(bin => bin.label === labelB);
                const minA = binA ? binA.min : (sortConfig.direction === 'asc' ? Infinity : -Infinity);
                const minB = binB ? binB.min : (sortConfig.direction === 'asc' ? Infinity : -Infinity);

                if (minA !== minB) return (minA - minB) * factor;

                // If bins match, sort by secondary part
                if (subDimensionCol) {
                    return a.name.localeCompare(b.name) * factor;
                }
            }

            const valA = a[sortConfig.key] !== undefined ? a[sortConfig.key] : 0;
            const valB = b[sortConfig.key] !== undefined ? b[sortConfig.key] : 0;

            if (typeof valA === 'string' && typeof valB === 'string') {
                return valA.localeCompare(valB) * factor;
            }
            return (valA - valB) * factor;
        });

        // Step E: Limit for Chart (Top N)
        let chartData = [...fullDataWithPercentage];

        if (!enableBinning && fullDataWithPercentage.length > maxItems) {
            const topN = fullDataWithPercentage.slice(0, maxItems);
            const others = fullDataWithPercentage.slice(maxItems);

            const othersNode: any = {
                name: `其他 (${others.length}项)`,
                value: 0,
                count: 0,
                isOther: true
            };

            others.forEach(o => {
                othersNode.value += o.value;
                othersNode.count += o.count;
                breakdownKeys.forEach(k => {
                    if (o[k]) othersNode[k] = (othersNode[k] || 0) + o[k];
                });
            });
            othersNode.value = parseFloat(othersNode.value.toFixed(2));
            othersNode.percentage = totalValue > 0 ? parseFloat(((othersNode.value / totalValue) * 100).toFixed(1)) : 0;

            chartData = [...topN, othersNode];
        }

        return {
            chartData,
            tableData: fullDataWithPercentage,
            totalValue,
            totalCount,
            breakdownKeys
        };

    }, [data, filters, chartType, dimensionCol, subDimensionCol, metricCol, breakdownCol, scatterXCol, aggregation, enableBinning, bins, enableColBinning, colBins, excludeEmpty, sortConfig, maxItems, isLargeDataset, needsRecalculation, calculationVersion, chartGenerated]);

    // --- ACTIONS ---
    const handleCopyTable = () => {
        const { breakdownKeys, tableData, totalValue } = processedData;
        let header = `类别\t总数值 (${aggregation})\t占比`;
        if (breakdownKeys.length > 0) {
            header += `\t` + breakdownKeys.join('\t');
        }
        const body = tableData.map(d => {
            let row = `${d.name}\t${d.value}\t${d.percentage}%`;
            if (breakdownKeys.length > 0) {
                row += `\t` + breakdownKeys.map(k => d[k] || 0).join('\t');
            }
            return row;
        }).join('\n');
        const footer = `总计\t${totalValue}\t100%`;
        const text = `${header}\n${body}\n${footer}`;
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    const addFilter = () => {
        const firstCol = data.columns[0];
        setFilters([...filters, { id: Date.now().toString(), column: firstCol, operator: 'eq', value: '' }]);
    };
    const updateFilter = (id: string, field: keyof FilterCondition | 'value2', val: string) => {
        setFilters(filters.map(f => f.id === id ? { ...f, [field]: val } : f));
    };
    const removeFilter = (id: string) => setFilters(filters.filter(f => f.id !== id));

    const addBin = () => setBins([...bins, { id: Date.now().toString(), label: `范围 ${bins.length + 1}`, min: 0, max: 100 }]);
    const removeBin = (id: string) => setBins(bins.filter(b => b.id !== id));
    const updateBin = (id: string, field: keyof BinRange, val: string | number) => {
        setBins(bins.map(b => b.id === id ? { ...b, [field]: val } : b));
    };

    const handleAddToSnapshot = () => {
        const { chartData, breakdownKeys } = processedData;
        const newSnapshot: ChartSnapshot = {
            id: Date.now().toString(),
            title: `${dimensionCol}${subDimensionCol ? ' + ' + subDimensionCol : ''} - ${aggregation === 'count' ? '数量' : aggregation}分布`,
            type: chartType,
            // Deep copy
            data: JSON.parse(JSON.stringify(chartData)),
            breakdownKeys: [...breakdownKeys],
            aggregation,
            metricLabel: metricCol ? metricCol : '数量',
            isStacked: breakdownKeys.length > 0 && ['bar', 'bar-horizontal', 'area', 'line'].includes(chartType),
            xAxisLabel: enableBinning ? '范围区间' : dimensionCol
        };
        onAddSnapshot(newSnapshot);
    };

    return (
        <div className="h-full bg-slate-50 overflow-y-auto p-4 md:p-6 scrollbar-hide space-y-6">

            <div className="flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
                <h2 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
                    <LayoutDashboard className="text-blue-600" /> 可视化工作台
                    {isLargeDataset && (
                        <span className="text-xs font-normal bg-amber-100 text-amber-700 px-2 py-1 rounded-full">
                            大数据模式 ({data.rows.length.toLocaleString()} 行)
                        </span>
                    )}
                </h2>
                <div className="flex flex-wrap gap-2 bg-white p-1 rounded-lg border border-slate-200 shadow-sm">
                    <button title="柱状图" onClick={() => setChartType('bar')} className={`p-2 rounded ${chartType === 'bar' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}><BarChart3 size={20} /></button>
                    <button title="条形图" onClick={() => setChartType('bar-horizontal')} className={`p-2 rounded ${chartType === 'bar-horizontal' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}><BarChart3 className="rotate-90" size={20} /></button>
                    <button title="折线图" onClick={() => setChartType('line')} className={`p-2 rounded ${chartType === 'line' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}><LineChartIcon size={20} /></button>
                    <button title="面积图" onClick={() => setChartType('area')} className={`p-2 rounded ${chartType === 'area' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}><Activity size={20} /></button>
                    <button title="饼图" onClick={() => setChartType('pie')} className={`p-2 rounded ${chartType === 'pie' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}><PieChartIcon size={20} /></button>
                    <button title="雷达图" onClick={() => setChartType('radar')} className={`p-2 rounded ${chartType === 'radar' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}><Hexagon size={20} /></button>
                    <button title="散点图" onClick={() => setChartType('scatter')} className={`p-2 rounded ${chartType === 'scatter' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}><ScatterIcon size={20} /></button>
                    <button title="漏斗图" onClick={() => setChartType('funnel')} className={`p-2 rounded ${chartType === 'funnel' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}><FunnelIcon size={20} /></button>
                    <button title="树形图" onClick={() => setChartType('treemap')} className={`p-2 rounded ${chartType === 'treemap' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'}`}><BoxSelect size={20} /></button>
                    <div className="w-px bg-slate-200 mx-1"></div>
                    <button title="透视表" onClick={() => setChartType('pivot')} className={`p-2 rounded ${chartType === 'pivot' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:bg-slate-50'}`}><Table2 size={20} /></button>
                    <div className="w-px bg-slate-200 mx-1"></div>
                    {/* 智能推荐按钮 */}
                    <button
                        title="智能推荐"
                        onClick={handleSmartAnalyze}
                        disabled={isAnalyzing}
                        className="px-3 py-1.5 rounded bg-gradient-to-r from-violet-500 to-purple-600 text-white font-medium text-sm flex items-center gap-1.5 hover:from-violet-600 hover:to-purple-700 transition-all shadow-sm disabled:opacity-50"
                    >
                        {isAnalyzing ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <Sparkles size={16} />
                        )}
                        智能推荐
                    </button>
                </div>
            </div>

            {/* 智能推荐面板 */}
            {showRecommendations && (
                <div className="bg-gradient-to-r from-violet-50 to-purple-50 border border-violet-200 rounded-xl p-4 shadow-sm animate-in fade-in slide-in-from-top-2 duration-200">
                    <div className="flex items-center justify-between mb-4">
                        <div className="flex items-center gap-2">
                            <div className="p-2 bg-violet-100 rounded-lg">
                                <Sparkles size={20} className="text-violet-600" />
                            </div>
                            <div>
                                <p className="font-semibold text-violet-800">智能图表推荐</p>
                                <p className="text-xs text-violet-600">根据数据特征自动推荐最佳可视化方案</p>
                            </div>
                        </div>
                        <button
                            onClick={() => setShowRecommendations(false)}
                            className="p-1.5 hover:bg-violet-100 rounded-lg transition-colors"
                        >
                            <X size={18} className="text-violet-500" />
                        </button>
                    </div>

                    {isAnalyzing ? (
                        <div className="flex flex-col items-center justify-center py-8 gap-3">
                            <div className="w-8 h-8 border-3 border-violet-300 border-t-violet-600 rounded-full animate-spin"></div>
                            <p className="text-sm text-violet-600">正在分析数据结构...</p>
                        </div>
                    ) : recommendations.length === 0 ? (
                        <div className="text-center py-6 text-violet-600">
                            <Lightbulb size={32} className="mx-auto mb-2 opacity-50" />
                            <p className="text-sm">暂无推荐，请确保数据包含分类列或数值列</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
                            {recommendations.map((rec) => (
                                <button
                                    key={rec.id}
                                    onClick={() => applyRecommendation(rec)}
                                    className="group p-4 bg-white hover:bg-violet-50 border border-violet-200 hover:border-violet-400 rounded-xl text-left transition-all hover:shadow-md"
                                >
                                    <div className="flex items-start gap-3">
                                        <div className={`p-2 rounded-lg ${rec.icon === 'pie' ? 'bg-green-100 text-green-600' :
                                            rec.icon === 'trend' ? 'bg-blue-100 text-blue-600' :
                                                rec.icon === 'distribution' ? 'bg-orange-100 text-orange-600' :
                                                    'bg-violet-100 text-violet-600'
                                            }`}>
                                            {rec.icon === 'pie' ? <PieChartIcon size={18} /> :
                                                rec.icon === 'trend' ? <TrendingUp size={18} /> :
                                                    rec.icon === 'distribution' ? <FunnelIcon size={18} /> :
                                                        <BarChart3 size={18} />}
                                        </div>
                                        <div className="flex-1 min-w-0">
                                            <p className="font-medium text-sm text-slate-800 group-hover:text-violet-700 truncate">
                                                {rec.title}
                                            </p>
                                            <p className="text-xs text-slate-500 mt-0.5 line-clamp-2">
                                                {rec.description}
                                            </p>
                                            <div className="flex items-center gap-2 mt-2">
                                                <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                                                    {rec.chartType === 'bar' ? '柱状图' :
                                                        rec.chartType === 'bar-horizontal' ? '条形图' :
                                                            rec.chartType === 'line' ? '折线图' :
                                                                rec.chartType === 'pie' ? '饼图' :
                                                                    rec.chartType === 'funnel' ? '漏斗图' :
                                                                        rec.chartType}
                                                </span>
                                                <span className="text-[10px] px-1.5 py-0.5 bg-slate-100 text-slate-600 rounded">
                                                    {rec.aggregation === 'count' ? '计数' :
                                                        rec.aggregation === 'sum' ? '求和' : '平均'}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* Large Dataset Warning Banner */}
            {isLargeDataset && needsRecalculation && (
                <div className="bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl p-4 flex items-center justify-between shadow-sm">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-amber-100 rounded-lg">
                            <Zap size={20} className="text-amber-600" />
                        </div>
                        <div>
                            <p className="font-semibold text-amber-800">大数据集 - 手动计算模式</p>
                            <p className="text-xs text-amber-600">检测到 {data.rows.length.toLocaleString()} 行数据。请先配置好参数，然后点击右侧按钮生成统计图表。</p>
                        </div>
                    </div>
                    <button
                        onClick={triggerCalculation}
                        disabled={isProcessing}
                        className="px-4 py-2 bg-amber-500 hover:bg-amber-600 text-white font-medium rounded-lg shadow-sm transition-colors flex items-center gap-2 disabled:opacity-50"
                    >
                        {isProcessing ? (
                            <>
                                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin"></div>
                                计算中...
                            </>
                        ) : (
                            <>
                                <Zap size={16} />
                                生成统计
                            </>
                        )}
                    </button>
                </div>
            )}


            {/* CONFIGURATION PANEL */}
            <div className="grid grid-cols-1 xl:grid-cols-4 gap-6">

                {/* Left: Settings */}
                <div className="xl:col-span-1 space-y-6">

                    {/* 1. Axes Configuration */}
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <Settings2 size={16} /> 数据维度与指标
                            </h3>
                            <div className="flex gap-1">
                                <button
                                    onClick={exportPreset}
                                    title="导出预设"
                                    className="text-[10px] px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 flex items-center gap-1"
                                >
                                    <Download size={12} className="inline mr-1" /> 导出
                                </button>
                                <label
                                    title="导入预设"
                                    className="text-[10px] px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 flex items-center gap-1 cursor-pointer"
                                >
                                    <Upload size={12} className="inline mr-1" /> 导入
                                    <input
                                        type="file"
                                        ref={importPresetRef}
                                        accept=".json"
                                        onChange={handleImportPreset}
                                        className="hidden"
                                    />
                                </label>
                            </div>
                        </div>
                        <div className="space-y-4">
                            {chartType === 'scatter' ? (
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">X 轴数值列</label>
                                    <select value={scatterXCol} onChange={(e) => setScatterXCol(e.target.value)} className="w-full p-2 border border-slate-300 rounded text-sm">
                                        <option value="">请选择数值列...</option>
                                        {data.columns.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            ) : (
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">行字段 (分组依据)</label>
                                    <select value={dimensionCol} onChange={(e) => setDimensionCol(e.target.value)} className="w-full p-2 border border-slate-300 rounded text-sm bg-slate-50">
                                        {data.columns.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>

                                    <div className="mt-2 flex items-center gap-2">
                                        <input type="checkbox" id="enableRowBinning" checked={enableRowBinning} onChange={(e) => setEnableRowBinning(e.target.checked)} className="rounded text-blue-600 focus:ring-blue-500" />
                                        <label htmlFor="enableRowBinning" className="text-xs text-slate-700 cursor-pointer select-none">对行字段启用数值分段</label>
                                    </div>

                                    {/* Row Binning Settings */}
                                    {enableRowBinning && (
                                        <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100 space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs font-medium text-blue-700">行字段分段设置</span>
                                                <div className="flex gap-1">
                                                    <button onClick={handleAutoBinning} className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-600 rounded hover:bg-blue-200">⚡ 自动</button>
                                                    <button onClick={() => setRowBins([...rowBins, { id: Date.now().toString(), label: `区间${rowBins.length + 1}`, min: 0, max: 100 }])} className="text-[10px] px-2 py-0.5 bg-blue-100 text-blue-600 rounded hover:bg-blue-200">+ 添加</button>
                                                </div>
                                            </div>
                                            {rowBins.map((bin, idx) => (
                                                <div key={bin.id} className="flex items-center gap-1 text-xs">
                                                    <input value={bin.label} onChange={(e) => setRowBins(rowBins.map(b => b.id === bin.id ? { ...b, label: e.target.value } : b))} className="flex-1 px-2 py-1 border rounded text-xs" placeholder="标签" />
                                                    <input type="number" value={bin.min === -Infinity ? '' : bin.min} onChange={(e) => setRowBins(rowBins.map(b => b.id === bin.id ? { ...b, min: Number(e.target.value) } : b))} className="w-16 px-2 py-1 border rounded text-xs text-center" placeholder="起" />
                                                    <span className="text-slate-400">~</span>
                                                    <input type="number" value={bin.max === Infinity ? '' : bin.max} onChange={(e) => setRowBins(rowBins.map(b => b.id === bin.id ? { ...b, max: e.target.value === '' ? Infinity : Number(e.target.value) } : b))} className="w-16 px-2 py-1 border rounded text-xs text-center" placeholder="止" />
                                                    <button onClick={() => setRowBins(rowBins.filter(b => b.id !== bin.id))} className="text-red-400 hover:text-red-600 p-1"><X size={12} /></button>
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Secondary X Dimension (New Feature) */}
                            {!chartType.includes('scatter') && (
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1 flex items-center gap-1">
                                        <Split size={12} /> 行字段二 (组合显示)
                                    </label>
                                    <select value={subDimensionCol} onChange={(e) => setSubDimensionCol(e.target.value)} className="w-full p-2 border border-slate-300 rounded text-sm bg-white">
                                        <option value="">(无)</option>
                                        {data.columns.filter(c => c !== dimensionCol).map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <p className="text-[10px] text-slate-400 mt-1">
                                        选择后行标签会显示为"人员 / 类型"的组合
                                    </p>
                                </div>
                            )}


                            {/* Column Field (Breakdown/Cross-tab) - Available for all chart types */}
                            {chartType !== 'scatter' && (
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1 flex items-center gap-1">
                                        <Layers size={12} /> 列字段 (交叉分类)
                                    </label>
                                    <select value={breakdownCol} onChange={(e) => setBreakdownCol(e.target.value)} className="w-full p-2 border border-slate-300 rounded text-sm bg-white">
                                        <option value="">(无)</option>
                                        {data.columns.filter(c => c !== dimensionCol && c !== subDimensionCol).map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>

                                    {breakdownCol && (
                                        <div className="mt-2 flex items-center gap-2">
                                            <input type="checkbox" id="enableColBinning" checked={enableColBinning} onChange={(e) => setEnableColBinning(e.target.checked)} className="rounded text-indigo-600 focus:ring-indigo-500" />
                                            <label htmlFor="enableColBinning" className="text-xs text-slate-700 cursor-pointer select-none">对列字段启用数值分段</label>
                                        </div>
                                    )}

                                    {/* Column Binning Settings */}
                                    {breakdownCol && enableColBinning && (
                                        <div className="mt-3 p-3 bg-indigo-50 rounded-lg border border-indigo-100 space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs font-medium text-indigo-700">列字段分段设置</span>
                                                <div className="flex gap-1">
                                                    <button onClick={() => {
                                                        // Auto-generate bins for column field
                                                        const vals = data.rows.map(r => parseFloat(String(r[breakdownCol]))).filter(n => !isNaN(n));
                                                        if (vals.length === 0) return;
                                                        const minVal = Math.min(...vals);
                                                        const maxVal = Math.max(...vals);
                                                        const step = Math.ceil((maxVal - minVal) / 4);
                                                        const newBins = [];
                                                        for (let i = 0; i < 4; i++) {
                                                            const start = minVal + i * step;
                                                            const end = i === 3 ? Infinity : minVal + (i + 1) * step;
                                                            newBins.push({ id: `cb${i}`, label: end === Infinity ? `${start}+` : `${start}-${end}`, min: start, max: end });
                                                        }
                                                        setColBins(newBins);
                                                    }} className="text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200">⚡ 自动</button>
                                                    <button onClick={() => setColBins([...colBins, { id: Date.now().toString(), label: `区间${colBins.length + 1}`, min: 0, max: 100 }])} className="text-[10px] px-2 py-0.5 bg-indigo-100 text-indigo-600 rounded hover:bg-indigo-200">+ 添加</button>
                                                </div>
                                            </div>
                                            {/* Preset buttons */}
                                            <div className="flex gap-1 flex-wrap">
                                                <button onClick={() => setColBins([
                                                    { id: 'p1', label: '普通', min: 0, max: 1000 },
                                                    { id: 'p2', label: '爆贴', min: 1001, max: 2500 },
                                                    { id: 'p3', label: '大爆贴', min: 2501, max: Infinity }
                                                ])} className="text-[10px] px-2 py-0.5 bg-white border border-indigo-200 text-indigo-600 rounded hover:bg-indigo-50">评论量</button>
                                            </div>
                                            {colBins.map((bin, idx) => (
                                                <div key={bin.id} className="flex items-center gap-1 text-xs">
                                                    <input value={bin.label} onChange={(e) => setColBins(colBins.map(b => b.id === bin.id ? { ...b, label: e.target.value } : b))} className="flex-1 px-2 py-1 border rounded text-xs" placeholder="标签" />
                                                    <input type="number" value={bin.min === -Infinity ? '' : bin.min} onChange={(e) => setColBins(colBins.map(b => b.id === bin.id ? { ...b, min: Number(e.target.value) } : b))} className="w-16 px-2 py-1 border rounded text-xs text-center" placeholder="起" />
                                                    <span className="text-slate-400">~</span>
                                                    <input type="number" value={bin.max === Infinity ? '' : bin.max} onChange={(e) => setColBins(colBins.map(b => b.id === bin.id ? { ...b, max: e.target.value === '' ? Infinity : Number(e.target.value) } : b))} className="w-16 px-2 py-1 border rounded text-xs text-center" placeholder="止" />
                                                    <button onClick={() => setColBins(colBins.filter(b => b.id !== bin.id))} className="text-red-400 hover:text-red-600 p-1"><X size={12} /></button>
                                                </div>
                                            ))}
                                        </div>
                                    )}

                                    {/* Chart Display Mode - only show when breakdowns exist */}
                                    {breakdownCol && (
                                        <div className="mt-3 p-3 bg-emerald-50 rounded-lg border border-emerald-100 space-y-2">
                                            <span className="text-xs font-medium text-emerald-700">图表显示模式</span>
                                            <div className="flex gap-1 flex-wrap">
                                                <button
                                                    onClick={() => setChartDisplayMode('total')}
                                                    className={`text-[10px] px-2 py-1 rounded ${chartDisplayMode === 'total' ? 'bg-emerald-600 text-white' : 'bg-white border border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}
                                                >
                                                    <BarChart2 size={12} className="inline mr-1" /> 总和
                                                </button>
                                                <button
                                                    onClick={() => setChartDisplayMode('faceted')}
                                                    className={`text-[10px] px-2 py-1 rounded ${chartDisplayMode === 'faceted' ? 'bg-emerald-600 text-white' : 'bg-white border border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}
                                                >
                                                    <Grid size={12} className="inline mr-1" /> 分面 (多图)
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setChartDisplayMode('filtered');
                                                        // 如果之前没有选择任何分段，则自动全选
                                                        if (selectedBreakdowns.length === 0) {
                                                            setSelectedBreakdowns(processedData.breakdownKeys);
                                                        }
                                                    }}
                                                    className={`text-[10px] px-2 py-1 rounded ${chartDisplayMode === 'filtered' ? 'bg-emerald-600 text-white' : 'bg-white border border-emerald-200 text-emerald-600 hover:bg-emerald-50'}`}
                                                >
                                                    🎯 筛选
                                                </button>
                                            </div>

                                            {/* Breakdown selection for filtered mode */}
                                            {chartDisplayMode === 'filtered' && processedData.breakdownKeys.length > 0 && (
                                                <div className="flex gap-1 flex-wrap mt-2">
                                                    {processedData.breakdownKeys.map(key => (
                                                        <label key={key} className="flex items-center gap-1 text-xs cursor-pointer">
                                                            <input
                                                                type="checkbox"
                                                                checked={selectedBreakdowns.includes(key)}
                                                                onChange={(e) => {
                                                                    if (e.target.checked) {
                                                                        setSelectedBreakdowns([...selectedBreakdowns, key]);
                                                                    } else {
                                                                        setSelectedBreakdowns(selectedBreakdowns.filter(k => k !== key));
                                                                    }
                                                                }}
                                                                className="rounded text-emerald-600"
                                                            />
                                                            <span className="text-emerald-700">{key}</span>
                                                        </label>
                                                    ))}
                                                    <button
                                                        onClick={() => setSelectedBreakdowns(processedData.breakdownKeys)}
                                                        className="text-[10px] px-1 text-emerald-600 hover:underline"
                                                    >全选</button>
                                                    <button
                                                        onClick={() => setSelectedBreakdowns([])}
                                                        className="text-[10px] px-1 text-emerald-600 hover:underline"
                                                    >清空</button>
                                                </div>
                                            )}
                                        </div>
                                    )}
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">指标 (数值/Y轴)</label>
                                <select value={metricCol} onChange={(e) => setMetricCol(e.target.value)} className="w-full p-2 border border-slate-300 rounded text-sm">
                                    <option value="">(无 - 默认计数)</option>
                                    {data.columns.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>

                            {metricCol && (
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">聚合方式</label>
                                    <div className="flex bg-slate-100 p-1 rounded">
                                        <button onClick={() => setAggregation('count')} className={`flex-1 py-1 text-xs rounded ${aggregation === 'count' ? 'bg-white shadow text-blue-600' : 'text-slate-500'}`}>计数</button>
                                        <button onClick={() => setAggregation('sum')} className={`flex-1 py-1 text-xs rounded ${aggregation === 'sum' ? 'bg-white shadow text-blue-600' : 'text-slate-500'}`}>求和</button>
                                        <button onClick={() => setAggregation('avg')} className={`flex-1 py-1 text-xs rounded ${aggregation === 'avg' ? 'bg-white shadow text-blue-600' : 'text-slate-500'}`}>平均</button>
                                    </div>
                                </div>
                            )}

                            {/* Chart Limit Control */}
                            {!enableBinning && chartType !== 'scatter' && (
                                <div>
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="text-xs font-medium text-slate-500 flex items-center gap-1"><SlidersHorizontal size={12} /> 图表显示数量</label>
                                        <span className="text-xs text-blue-600 font-mono">{maxItems} 项</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="5"
                                        max="50"
                                        step="5"
                                        value={maxItems}
                                        onChange={(e) => setMaxItems(Number(e.target.value))}
                                        className="w-full h-2 bg-slate-200 rounded-lg appearance-none cursor-pointer"
                                    />
                                    <p className="text-[10px] text-slate-400 mt-1">超出部分将合并为“其他”</p>
                                </div>
                            )}

                            <div>
                                <label className="flex items-center gap-2 cursor-pointer select-none text-xs mt-2">
                                    <input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} className="rounded text-blue-600" />
                                    <span className="text-slate-600">显示数值标签</span>
                                </label>
                            </div>
                        </div>
                    </div>


                    {/* Filtering - moved below */}
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2"><Filter size={16} /> 数据筛选</h3>
                            <button onClick={addFilter} className="text-xs text-blue-600 hover:bg-blue-50 px-2 py-1 rounded flex items-center gap-1"><Plus size={14} /> 添加</button>
                        </div>

                        <div className="space-y-3">
                            <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                                <input type="checkbox" checked={excludeEmpty} onChange={(e) => setExcludeEmpty(e.target.checked)} className="rounded text-blue-600" />
                                <span className="text-slate-600">排除空值</span>
                            </label>

                            {filters.map((filter) => (
                                <div key={filter.id} className="bg-slate-50 p-2 rounded border border-slate-200 space-y-2 relative group">
                                    <button onClick={() => removeFilter(filter.id)} className="absolute top-1 right-1 text-slate-300 hover:text-red-500"><X size={12} /></button>
                                    <select value={filter.column} onChange={(e) => updateFilter(filter.id, 'column', e.target.value)} className="w-full text-xs p-1 border rounded">
                                        {data.columns.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <select value={filter.operator} onChange={(e) => updateFilter(filter.id, 'operator', e.target.value)} className="w-full text-xs p-1 border rounded">
                                        {OPERATOR_GROUPS.map(g => (
                                            <optgroup key={g.label} label={g.label}>
                                                {g.options.map(op => <option key={op.value} value={op.value}>{op.label}</option>)}
                                            </optgroup>
                                        ))}
                                    </select>
                                    <input type="text" value={filter.value} onChange={(e) => updateFilter(filter.id, 'value', e.target.value)} className="w-full text-xs p-1 border rounded" placeholder="值..." />
                                    {filter.operator === 'between' && (
                                        <input type="text" value={filter.value2 || ''} onChange={(e) => updateFilter(filter.id, 'value2', e.target.value)} className="w-full text-xs p-1 border rounded" placeholder="最大值..." />
                                    )}
                                </div>
                            ))}
                        </div>
                    </div>

                </div>

                {/* Right: Charts & Data */}
                <div className="xl:col-span-3 space-y-6">

                    {/* 1. Main Chart Editor */}
                    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-[500px] flex flex-col relative">
                        <div className="flex justify-between items-center mb-4">
                            <div className="flex items-center gap-3">
                                <h3 className="font-bold text-slate-700">配置工作台</h3>
                                <div className="text-xs text-slate-400 px-2 py-1 bg-slate-50 rounded flex items-center gap-2">
                                    {isProcessing && <Loader2 size={12} className="animate-spin" />}
                                    {data.rows.length > 5000 && <span className="text-amber-500 flex items-center gap-1"><AlertTriangle size={12} /> 大数据</span>}
                                    {breakdownCol ? '堆叠模式' : `Top ${maxItems}`} | 总计: {processedData.totalValue.toLocaleString()} | 行数: {data.rows.length.toLocaleString()}
                                </div>
                            </div>
                            <button
                                onClick={handleAddToSnapshot}
                                className="text-xs bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors shadow-sm shadow-blue-200"
                            >
                                <Pin size={14} /> 添加到报告
                            </button>
                            <button
                                onClick={handleGenerateChart}
                                className="text-xs bg-emerald-600 text-white hover:bg-emerald-700 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors shadow-sm shadow-emerald-200"
                            >
                                {isProcessing ? <Loader2 size={14} className="animate-spin" /> : <Zap size={14} />}
                                {chartGenerated ? '重新生成' : '生成图表'}
                            </button>
                        </div>
                        <div className="flex-1 w-full min-h-0 overflow-auto">
                            {/* 如果未生成图表，显示提示 */}
                            {!chartGenerated ? (
                                <div className="h-full flex flex-col items-center justify-center text-slate-400 bg-slate-50 rounded-lg">
                                    <BarChart3 size={64} className="mb-4 opacity-30" />
                                    <p className="text-lg font-medium text-slate-500">设置完成后点击"生成图表"</p>
                                    <p className="text-sm mt-2 text-slate-400">左侧选择维度、指标等设置项</p>
                                    <button
                                        onClick={handleGenerateChart}
                                        className="mt-6 px-6 py-2.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 flex items-center gap-2 font-medium shadow-lg shadow-emerald-100"
                                    >
                                        <Zap size={18} /> 生成图表
                                    </button>
                                </div>
                            ) : chartType === 'pivot' ? (
                                /* Pivot Table View */
                                <div className="h-full">
                                    {!breakdownCol ? (
                                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                            <Table2 size={48} className="mb-4 opacity-50" />
                                            <p className="text-sm font-medium">请设置"次级维度"来生成交叉透视表</p>
                                            <p className="text-xs mt-1">在左侧设置面板中选择一个字段作为列分类</p>
                                        </div>
                                    ) : (
                                        <table className="border-collapse text-sm w-full">
                                            <thead>
                                                <tr>
                                                    <th className="px-4 py-3 text-left font-bold text-slate-700 bg-slate-100 border border-slate-200 sticky left-0 z-10">
                                                        {enableBinning ? '范围' : dimensionCol}
                                                    </th>
                                                    {processedData.breakdownKeys.map(key => (
                                                        <th key={key} className="px-4 py-3 text-center font-bold text-slate-700 bg-slate-100 border border-slate-200 whitespace-nowrap min-w-[80px]">
                                                            {key}
                                                        </th>
                                                    ))}
                                                    <th className="px-4 py-3 text-center font-bold text-indigo-700 bg-indigo-50 border border-slate-200 whitespace-nowrap">
                                                        总计
                                                    </th>
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {processedData.tableData.slice(0, 100).map((item, idx) => (
                                                    <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                                        <td className="px-4 py-2 font-medium text-slate-700 border border-slate-200 sticky left-0 bg-inherit whitespace-nowrap">
                                                            {item.name}
                                                        </td>
                                                        {processedData.breakdownKeys.map(key => (
                                                            <td key={key} className="px-4 py-2 text-center text-slate-600 border border-slate-200 tabular-nums">
                                                                {(item[key] || 0).toLocaleString()}
                                                            </td>
                                                        ))}
                                                        <td className="px-4 py-2 text-center font-semibold text-indigo-700 bg-indigo-50/50 border border-slate-200 tabular-nums">
                                                            {item.value.toLocaleString()}
                                                        </td>
                                                    </tr>
                                                ))}
                                                {processedData.tableData.length > 100 && (
                                                    <tr className="bg-amber-50">
                                                        <td colSpan={processedData.breakdownKeys.length + 2} className="px-4 py-3 text-center text-amber-700 border border-slate-200 text-sm">
                                                            <AlertTriangle size={14} className="inline mr-1" /> 仅显示前 100 行，共 {processedData.tableData.length.toLocaleString()} 行。请使用筛选或导出完整数据。
                                                        </td>
                                                    </tr>
                                                )}
                                                {/* Totals Row */}
                                                <tr className="bg-slate-100 font-semibold">
                                                    <td className="px-4 py-2 font-bold text-slate-700 border border-slate-200 sticky left-0 bg-slate-100">
                                                        总计
                                                    </td>
                                                    {processedData.breakdownKeys.map(key => {
                                                        const colTotal = processedData.tableData.reduce((sum, item) => sum + (item[key] || 0), 0);
                                                        return (
                                                            <td key={key} className="px-4 py-2 text-center text-slate-700 border border-slate-200 tabular-nums">
                                                                {colTotal.toLocaleString()}
                                                            </td>
                                                        );
                                                    })}
                                                    <td className="px-4 py-2 text-center font-bold text-indigo-700 bg-indigo-100 border border-slate-200 tabular-nums">
                                                        {processedData.totalValue.toLocaleString()}
                                                    </td>
                                                </tr>
                                            </tbody>
                                        </table>
                                    )}
                                </div>
                            ) : chartDisplayMode === 'faceted' && processedData.breakdownKeys.length > 0 ? (
                                /* Faceted View - Multiple Charts */
                                <div className="h-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-auto p-2">
                                    {processedData.breakdownKeys.map((key) => {
                                        // Create data for this specific breakdown
                                        let facetData = processedData.tableData.map(item => ({
                                            name: item.name,
                                            value: (item as any)[key] || 0,
                                            percentage: 0
                                        })).filter(d => d.value > 0);

                                        const facetTotal = facetData.reduce((s, d) => s + d.value, 0);
                                        facetData.forEach(d => d.percentage = facetTotal > 0 ? parseFloat(((d.value / facetTotal) * 100).toFixed(1)) : 0);

                                        // Sort by value and take top 6 for pie charts to avoid label overlap
                                        facetData = facetData.sort((a, b) => b.value - a.value);
                                        const displayData = facetData.length > 6 ? [
                                            ...facetData.slice(0, 5),
                                            {
                                                name: `其他(${facetData.length - 5}项)`,
                                                value: facetData.slice(5).reduce((s, d) => s + d.value, 0),
                                                percentage: facetData.slice(5).reduce((s, d) => s + d.percentage, 0)
                                            }
                                        ] : facetData;

                                        // 分面视图使用饼图展示各分组数据
                                        const facetChartType = 'pie';

                                        return (
                                            <div key={key} className="bg-slate-50 rounded-lg p-3 border border-slate-200 min-h-[280px]">
                                                <h4 className="text-sm font-bold text-slate-700 mb-2 text-center">{key}</h4>
                                                <div className="h-[200px]">
                                                    <GenericChart
                                                        type={facetChartType}
                                                        data={displayData}
                                                        breakdownKeys={[]}
                                                        aggregation={aggregation}
                                                        metricLabel={key}
                                                        xAxisLabel={enableBinning ? '范围区间' : dimensionCol}
                                                        isStacked={false}
                                                        showValues={false}
                                                    />
                                                </div>
                                                <div className="text-center text-xs text-slate-500 mt-2">
                                                    总计: {facetTotal.toLocaleString()} ({facetData.length}项)
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            ) : chartDisplayMode === 'filtered' ? (
                                /* Filtered View - Only selected breakdowns */
                                selectedBreakdowns.length > 0 ? (
                                    chartType === 'pie' ? (
                                        /* 饼图筛选模式：每个选中的分段显示一个独立饼图 */
                                        <div className="h-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-auto p-2">
                                            {selectedBreakdowns.map((key) => {
                                                // 为每个分段创建独立的饼图数据
                                                let facetData = processedData.tableData.map(item => ({
                                                    name: item.name,
                                                    value: (item as any)[key] || 0,
                                                    percentage: 0
                                                })).filter(d => d.value > 0);

                                                const facetTotal = facetData.reduce((s, d) => s + d.value, 0);
                                                facetData.forEach(d => d.percentage = facetTotal > 0 ? parseFloat(((d.value / facetTotal) * 100).toFixed(1)) : 0);

                                                // 限制显示项数
                                                facetData = facetData.sort((a, b) => b.value - a.value);
                                                const displayData = facetData.length > 6 ? [
                                                    ...facetData.slice(0, 5),
                                                    {
                                                        name: `其他(${facetData.length - 5}项)`,
                                                        value: facetData.slice(5).reduce((s, d) => s + d.value, 0),
                                                        percentage: facetData.slice(5).reduce((s, d) => s + d.percentage, 0)
                                                    }
                                                ] : facetData;

                                                return (
                                                    <div key={key} className="bg-slate-50 rounded-lg p-3 border border-slate-200 min-h-[280px]">
                                                        <h4 className="text-sm font-bold text-slate-700 mb-2 text-center">{key}</h4>
                                                        <div className="h-[200px]">
                                                            <GenericChart
                                                                type="pie"
                                                                data={displayData}
                                                                breakdownKeys={[]}
                                                                aggregation={aggregation}
                                                                metricLabel={key}
                                                                xAxisLabel={enableBinning ? '范围区间' : dimensionCol}
                                                                isStacked={false}
                                                                showValues={false}
                                                            />
                                                        </div>
                                                        <div className="text-center text-xs text-slate-500 mt-2">
                                                            总计: {facetTotal.toLocaleString()} ({facetData.length}项)
                                                        </div>
                                                    </div>
                                                );
                                            })}
                                        </div>
                                    ) : (
                                        <GenericChart
                                            type={chartType}
                                            data={processedData.chartData}
                                            breakdownKeys={selectedBreakdowns}
                                            aggregation={aggregation}
                                            metricLabel={metricCol}
                                            xAxisLabel={enableBinning ? '范围区间' : dimensionCol}
                                            isStacked={selectedBreakdowns.length > 0 && ['bar', 'bar-horizontal', 'area', 'line'].includes(chartType)}
                                            showValues={showValues}
                                        />
                                    )
                                ) : (
                                    <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                        <span className="text-4xl mb-3">🎯</span>
                                        <p className="text-sm font-medium">请在左侧勾选要显示的分段</p>
                                        <p className="text-xs mt-1">勾选后将只显示选中的分段数据</p>
                                    </div>
                                )
                            ) : (
                                /* Total/Default View */
                                <GenericChart
                                    type={chartType}
                                    data={processedData.chartData}
                                    breakdownKeys={processedData.breakdownKeys}
                                    aggregation={aggregation}
                                    metricLabel={metricCol}
                                    xAxisLabel={enableBinning ? '范围区间' : dimensionCol}
                                    isStacked={processedData.breakdownKeys.length > 0 && ['bar', 'bar-horizontal', 'area', 'line'].includes(chartType)}
                                    showValues={showValues}
                                />
                            )}
                        </div>
                    </div>

                    {/* 2. Detailed Data Table */}
                    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden flex flex-col max-h-[400px]">
                        <div className="p-4 border-b border-slate-200 bg-slate-50 flex justify-between items-center">
                            <h3 className="font-bold text-slate-700 flex items-center gap-2"><Hash size={16} /> 统计明细 (全部数据)</h3>
                            <button onClick={handleCopyTable} className="text-xs flex items-center gap-1 text-slate-600 hover:text-blue-600">
                                {copied ? <Check size={14} className="text-green-500" /> : <Copy size={14} />} {copied ? '已复制' : '复制数据'}
                            </button>
                        </div>
                        <div className="overflow-auto flex-1">
                            <table className="w-full text-sm text-left border-collapse">
                                <thead className="bg-slate-100 text-xs uppercase text-slate-500 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-4 py-3 cursor-pointer hover:bg-slate-200 border-b" onClick={() => setSortConfig({ key: 'name', direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' })}>
                                            {enableBinning ? '范围' : dimensionCol} {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                        </th>
                                        <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 border-b" onClick={() => setSortConfig({ key: 'value', direction: sortConfig.direction === 'asc' ? 'desc' : 'asc' })}>
                                            总{aggregation === 'count' ? '数量' : '数值'} {sortConfig.key === 'value' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                        </th>
                                        <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 border-b" onClick={() => setSortConfig({ key: 'percentage', direction: sortConfig.key === 'percentage' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}>
                                            占比 {sortConfig.key === 'percentage' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                        </th>

                                        {/* Dynamic Headers for Breakdown - Clickable for Sorting */}
                                        {processedData.breakdownKeys.map(k => (
                                            <th
                                                key={k}
                                                className="px-4 py-3 text-right border-b text-blue-600 whitespace-nowrap cursor-pointer hover:bg-slate-200"
                                                onClick={() => setSortConfig({ key: k, direction: sortConfig.key === k && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}
                                            >
                                                {k} {sortConfig.key === k && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-100">
                                    {processedData.tableData.slice(0, 200).map((item, idx) => (
                                        <tr key={idx} className="hover:bg-slate-50">
                                            <td className="px-4 py-2 font-medium text-slate-700 truncate max-w-[200px]" title={item.name}>{item.name}</td>
                                            <td className="px-4 py-2 text-right font-mono text-slate-900 font-bold bg-slate-50/50">{item.value.toLocaleString()}</td>
                                            <td className="px-4 py-2 text-right text-slate-400">{item.percentage}%</td>

                                            {/* Dynamic Cells for Breakdown */}
                                            {processedData.breakdownKeys.map(k => (
                                                <td key={k} className="px-4 py-2 text-right font-mono text-slate-600">
                                                    {/* eslint-disable-next-line @typescript-eslint/no-explicit-any */}
                                                    {(item as any)[k] ? (item as any)[k].toLocaleString() : '-'}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                    {processedData.tableData.length > 200 && (
                                        <tr className="bg-amber-50">
                                            <td colSpan={3 + processedData.breakdownKeys.length} className="px-4 py-3 text-center text-amber-700 text-sm">
                                                <AlertTriangle size={14} className="inline mr-1" /> 仅显示前 200 行，共 {processedData.tableData.length.toLocaleString()} 行
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                                <tfoot className="bg-slate-50 border-t border-slate-200 font-bold text-slate-800 sticky bottom-0 z-10">
                                    <tr>
                                        <td className="px-4 py-3">总计</td>
                                        <td className="px-4 py-3 text-right">{processedData.totalValue.toLocaleString()}</td>
                                        <td className="px-4 py-3 text-right">100%</td>
                                        {processedData.breakdownKeys.map(k => <td key={k} className="px-4 py-3"></td>)}
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                </div>
            </div>

        </div >
    );
};

Dashboard.displayName = 'Dashboard';

export default memo(Dashboard);
