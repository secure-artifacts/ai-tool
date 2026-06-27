
import React, { useMemo, useState, useEffect, useCallback, useRef, memo } from 'react';
import { toBlob } from 'html-to-image';
import { SheetData, FilterCondition, ChartType, AggregationType, ChartSnapshot } from '../types';
import {
    BarChart, Bar, LineChart, Line, AreaChart, Area, PieChart, Pie,
    RadarChart, Radar, PolarGrid, PolarAngleAxis, PolarRadiusAxis,
    ScatterChart, Scatter, FunnelChart, Funnel, Treemap,
    XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell, Legend, LabelList, Brush, ComposedChart
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
    AlertTriangle,
    Target,
    GripVertical,
    ArrowUpDown,
    ArrowUp,
    ArrowDown
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
    '#3B82F6', // Blue
    '#10B981', // Emerald
    '#F59E0B', // Amber
    '#EF4444', // Red
    '#8B5CF6', // Violet
    '#EC4899', // Pink
    '#06B6D4', // Cyan
    '#84CC16', // Lime
    '#F97316', // Orange
    '#14B8A6', // Teal
    '#6366F1', // Indigo
    '#EAB308', // Yellow
    '#D946EF', // Fuchsia
    '#0EA5E9', // Sky
    '#22C55E', // Green
    '#A855F7', // Purple
    '#4F46E5', // Indigo-600
    '#BE123C', // Rose-700
    '#15803D', // Green-700
    '#B45309'  // Amber-700
];

const DraggableList = ({ items, setItems, label }: { items: string[], setItems: (items: string[]) => void, label: string }) => {
    const [draggingIdx, setDraggingIdx] = useState<number | null>(null);

    const handleDragStart = (e: React.DragEvent, index: number) => {
        setDraggingIdx(index);
        e.dataTransfer.effectAllowed = 'move';
    };

    const handleDragOver = (e: React.DragEvent, index: number) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = 'move';
        
        if (draggingIdx === null || draggingIdx === index) return;
        
        const newItems = [...items];
        const draggedItem = newItems[draggingIdx];
        newItems.splice(draggingIdx, 1);
        newItems.splice(index, 0, draggedItem);
        
        setDraggingIdx(index);
        setItems(newItems);
    };

    const handleDragEnd = () => {
        setDraggingIdx(null);
    };

    if (items.length === 0) return null;

    return (
        <div className="flex flex-col gap-1 mt-2 p-2 bg-indigo-50/50 rounded border border-indigo-100">
            <span className="text-[10px] text-indigo-700 font-medium mb-1">{label}提示：拖拽调整顺序</span>
            <div className="space-y-1 max-h-[200px] overflow-y-auto pr-1">
                {items.map((item: any, idx: number) => (
                    <div 
                        key={item}
                        draggable
                        onDragStart={(e) => handleDragStart(e, idx)}
                        onDragOver={(e) => handleDragOver(e, idx)}
                        onDragEnd={handleDragEnd}
                        className="flex items-center gap-2 p-1.5 bg-white border border-slate-200 rounded text-xs text-slate-700 cursor-move hover:border-indigo-300 hover:shadow-sm transition-all"
                    >
                        <GripVertical size={12} className="text-slate-400" />
                        <span className="truncate flex-1" title={item}>{item}</span>
                    </div>
                ))}
            </div>
        </div>
    );
};

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
        const bestCat = categoryColumns.sort((a: any, b: any) => {
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
    return recommendations.sort((a: any, b: any) => b.score - a.score).slice(0, 6);
};

// --- REUSABLE CHART COMPONENT (Exported for Gallery) ---
export const GenericChart: React.FC<{
    type: ChartType;
    data: any[];
    breakdownKeys: string[];
    aggregation: string;
    metricLabel: string;
    secondaryMetricLabel?: string;
    xAxisLabel: string;
    isStacked: boolean;
    isGrouped?: boolean;
    showValues?: boolean;
    stackIdMapping?: Record<string, string>;
    xTickFormatter?: (value: any) => string;
}> = ({ type, data, breakdownKeys, aggregation, metricLabel, secondaryMetricLabel, xAxisLabel, isStacked, isGrouped = false, showValues = true, stackIdMapping, xTickFormatter }) => {

    let actualGroupedBarsCount = 1;
    if (breakdownKeys && breakdownKeys.length > 0) {
        if (stackIdMapping) {
            const uniqueStackIds = new Set(breakdownKeys.map(k => stackIdMapping[k]));
            actualGroupedBarsCount = uniqueStackIds.size;
        } else {
            actualGroupedBarsCount = isStacked ? 1 : breakdownKeys.length;
        }
    }
    
    const totalBars = data?.length ? data.length * actualGroupedBarsCount : 0;
    const showBrush = data?.length > 15 || totalBars > 20;
    const initialItemsToShow = Math.max(2, Math.ceil(20 / actualGroupedBarsCount));
    const brushEndIndex = data?.length ? Math.min(initialItemsToShow - 1, data.length - 1) : 0;

    if (!data || data.length === 0) return <div className="h-full flex items-center justify-center text-slate-400">暂无数据</div>;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const CommonTooltip = useCallback(({ active, payload, label }: any) => {
        if (active && payload && payload.length) {
            return (
                <div className="bg-white p-3 border border-slate-200 shadow-lg rounded-lg text-xs z-50 min-w-[120px]">
                    <p className="font-bold mb-2 border-b pb-1 text-slate-800">{label}</p>
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
                            <span className="flex items-center gap-1 text-slate-600">
                                <span className="w-2 h-2 rounded-full shrink-0" style={{ backgroundColor: entry.color }}></span>
                                <span className="truncate max-w-[180px]" title={entry.name}>{entry.name}</span>:
                            </span>
                            <span className="font-mono font-medium text-slate-800">{typeof entry.value === 'number' ? entry.value.toLocaleString() : entry.value}</span>
                        </div>
                    ))}
                </div>
            );
        }
        return null;
    }, [isStacked, type]);

    const renderStacks = (ChartComponent: any) => {
        if (isStacked) {
            return breakdownKeys.map((key: string, index: number) => {
                const sid = stackIdMapping ? stackIdMapping[key] : (isGrouped ? undefined : "a");
                return (
                    <ChartComponent
                        key={key}
                        dataKey={key}
                        stackId={sid}
                        fill={COLORS[index % COLORS.length]}
                        stroke={COLORS[index % COLORS.length]}
                        name={key}
                        isAnimationActive={false}
                    >
                        {showValues && <LabelList dataKey={key} position="top" fill="#fff" fontSize={10} formatter={(val: any) => val > 0 ? String(val) : ''} />}
                    </ChartComponent>
                );
            });
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
                        formatter={(val: any) => Number(val).toLocaleString()}
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
                            <ComposedChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: showBrush ? 90 : 40 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" tickFormatter={xTickFormatter} stroke="#475569" fontSize={12} tickLine={false} angle={-30} textAnchor="end" interval={0} height={60} label={{ value: xAxisLabel, position: 'insideBottom', offset: showBrush ? -35 : -10, fontSize: 11, fill: '#64748b', fontWeight: 'bold' }} />
                                <YAxis yAxisId="left" stroke="#475569" fontSize={12} tickLine={false} />
                                {secondaryMetricLabel && <YAxis yAxisId="right" orientation="right" stroke="#d97706" fontSize={12} tickLine={false} />}
                                <Tooltip content={CommonTooltip} cursor={{ fill: '#f8fafc' }} />
                                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '20px' }} />
                                {isStacked || isGrouped ? breakdownKeys.map((key: string, index: number) => {
                                    const sid = stackIdMapping ? stackIdMapping[key] : (isGrouped ? undefined : "a");
                                    const isVirtuallyGrouped = sid === undefined || sid === key;
                                    return (
                                        <Bar yAxisId="left" key={key} dataKey={key} stackId={sid} fill={COLORS[index % COLORS.length]} name={key} isAnimationActive={false} radius={isVirtuallyGrouped ? [2, 2, 0, 0] : 0}>
                                            {showValues && <LabelList dataKey={key} position="top" fill={isVirtuallyGrouped ? '#64748b' : '#fff'} fontSize={10} formatter={(val: any) => val > 0 ? String(val) : ''} />}
                                        </Bar>
                                    );
                                }) : (
                                    <Bar yAxisId="left" dataKey="value" name={metricLabel || aggregation} fill="#8884d8" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                        {data.map((entry, index) => (
                                            <Cell key={`cell-${index}`} fill={(entry as any).isOther ? '#94a3b8' : COLORS[index % COLORS.length]} />
                                        ))}
                                        {showValues && (
                                            <LabelList dataKey="value" position="top" offset={5} fill="#64748b" fontSize={10} formatter={(val: any) => Number(val).toLocaleString()} />
                                        )}
                                    </Bar>
                                )}
                                {secondaryMetricLabel && (
                                    (isStacked || isGrouped) ? (
                                        <Line yAxisId="right" type="monotone" dataKey="secondaryValue" name={secondaryMetricLabel} stroke="#f59e0b" strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
                                    ) : (
                                        <Bar yAxisId="right" dataKey="secondaryValue" name={secondaryMetricLabel} fill="#f59e0b" radius={[4, 4, 0, 0]} isAnimationActive={false}>
                                            {showValues && (
                                                <LabelList dataKey="secondaryValue" position="top" offset={5} fill="#d97706" fontSize={10} formatter={(val: any) => val > 0 ? Number(val).toLocaleString() : ''} />
                                            )}
                                        </Bar>
                                    )
                                )}
                                {showBrush && (
                                    <Brush dataKey="name" height={22} stroke="#8884d8" travellerWidth={8} startIndex={0} endIndex={brushEndIndex} fill="#f8fafc" />
                                )}
                            </ComposedChart>
                        );
                    case 'bar-horizontal':
                        return (
                            <BarChart layout="vertical" data={data} margin={{ top: 20, right: 50, left: 40, bottom: 5 }}>
                                <CartesianGrid strokeDasharray="3 3" horizontal={false} stroke="#f1f5f9" />
                                <XAxis type="number" stroke="#475569" fontSize={12} />
                                <YAxis type="category" dataKey="name" tickFormatter={xTickFormatter} stroke="#475569" fontSize={12} width={100} />
                                <Tooltip content={CommonTooltip} cursor={{ fill: '#f8fafc' }} />
                                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '20px' }} />
                                {renderStacks(Bar)}
                            </BarChart>
                        );
                    case 'line':
                        return (
                            <LineChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: showBrush ? 90 : 40 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" tickFormatter={xTickFormatter} stroke="#94a3b8" fontSize={12} angle={-30} textAnchor="end" height={60} label={{ value: xAxisLabel, position: 'insideBottom', offset: showBrush ? -35 : -10, fontSize: 10, fill: '#cbd5e1' }} />
                                <YAxis yAxisId="left" stroke="#94a3b8" fontSize={12} />
                                {secondaryMetricLabel && <YAxis yAxisId="right" orientation="right" stroke="#d97706" fontSize={12} />}
                                <Tooltip content={CommonTooltip} />
                                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '20px' }} />
                                {isStacked ? breakdownKeys.map((key: string, index: number) => (
                                    <Line yAxisId="left" key={key} type="monotone" dataKey={key} stroke={COLORS[index % COLORS.length]} strokeWidth={2} dot={{ r: 3 }} name={key} isAnimationActive={false} />
                                )) : (
                                    <Line yAxisId="left" type="monotone" dataKey="value" stroke="#8884d8" strokeWidth={3} dot={{ r: 4 }} activeDot={{ r: 8 }} name={metricLabel || aggregation} isAnimationActive={false}>
                                        {showValues && <LabelList dataKey="value" position="top" offset={10} fill="#64748b" fontSize={10} />}
                                    </Line>
                                )}
                                {secondaryMetricLabel && (
                                    <Line yAxisId="right" type="monotone" dataKey="secondaryValue" stroke="#f59e0b" strokeWidth={3} strokeDasharray="5 5" dot={{ r: 4 }} activeDot={{ r: 8 }} name={secondaryMetricLabel} isAnimationActive={false}>
                                        {showValues && <LabelList dataKey="secondaryValue" position="top" offset={10} fill="#d97706" fontSize={10} />}
                                    </Line>
                                )}
                                {showBrush && (
                                    <Brush dataKey="name" height={22} stroke="#8884d8" travellerWidth={8} startIndex={0} endIndex={brushEndIndex} fill="#f8fafc" />
                                )}
                            </LineChart>
                        );
                    case 'area':
                        return (
                            <AreaChart data={data} margin={{ top: 20, right: 30, left: 20, bottom: showBrush ? 90 : 40 }}>
                                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                                <XAxis dataKey="name" tickFormatter={xTickFormatter} stroke="#94a3b8" fontSize={12} angle={-30} textAnchor="end" height={60} label={{ value: xAxisLabel, position: 'insideBottom', offset: showBrush ? -35 : -10, fontSize: 10, fill: '#cbd5e1' }} />
                                <YAxis stroke="#94a3b8" fontSize={12} />
                                <Tooltip content={CommonTooltip} />
                                <Legend verticalAlign="top" wrapperStyle={{ paddingBottom: '20px' }} />
                                {renderStacks(Area)}
                                {showBrush && (
                                    <Brush dataKey="name" height={22} stroke="#8884d8" travellerWidth={8} startIndex={0} endIndex={brushEndIndex} fill="#f8fafc" />
                                )}
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
                    case 'pivot': {
                        // Render a simple compact table for the snapshot / gallery preview
                        const is2D = breakdownKeys && breakdownKeys.length > 0;
                        return (
                            <div className="w-full h-full overflow-auto text-[10px] border border-slate-200 rounded p-1 bg-white">
                                <table className="w-full border-collapse bg-white">
                                    <thead>
                                        <tr className="bg-slate-50 font-bold border-b border-slate-200">
                                            <th className="px-2 py-1 text-left border-r border-slate-200">{xAxisLabel || '类别'}</th>
                                            {is2D ? (
                                                breakdownKeys.map(k => (
                                                    <th key={k} className="px-2 py-1 text-right border-r border-slate-200">{k}</th>
                                                ))
                                            ) : null}
                                            <th className="px-2 py-1 text-right">总计</th>
                                        </tr>
                                    </thead>
                                    <tbody className="divide-y divide-slate-100">
                                        {data.slice(0, 10).map((row: any, idx: number) => (
                                            <tr key={idx} className="hover:bg-slate-50">
                                                <td className="px-2 py-1 font-medium text-slate-700 truncate max-w-[80px] border-r border-slate-200">{row.name}</td>
                                                {is2D ? (
                                                    breakdownKeys.map(k => (
                                                        <td key={k} className="px-2 py-1 text-right font-mono text-slate-600 border-r border-slate-200">
                                                            {row[k] !== undefined ? row[k].toLocaleString() : 0}
                                                        </td>
                                                    ))
                                                ) : null}
                                                <td className="px-2 py-1 text-right font-mono font-bold text-slate-900 bg-slate-50/30">
                                                    {row.value !== undefined ? row.value.toLocaleString() : 0}
                                                </td>
                                            </tr>
                                        ))}
                                        {data.length > 10 && (
                                            <tr>
                                                <td colSpan={is2D ? breakdownKeys.length + 2 : 2} className="px-2 py-1 text-center text-slate-400 italic">
                                                    ...及其他 {data.length - 10} 项...
                                                </td>
                                            </tr>
                                        )}
                                    </tbody>
                                </table>
                            </div>
                        );
                    }
                    default:
                        return null;
                }
            })()}
        </ResponsiveContainer>
    );
};


export interface ColumnBinConfig {
    enabled: boolean;
    bins: BinRange[];
}

export type GroupMatchMode = 'exact' | 'contains' | 'notContains' | 'startsWith' | 'endsWith' | 'gt' | 'gte' | 'lt' | 'lte' | 'range' | 'notEquals' | 'isEmpty' | 'isNotEmpty' | 'inList' | 'regex';

export interface SubDimensionGroupRule {
    id: string;
    source: string;       // For exact mode: the exact value. For other modes: the pattern/threshold.
    source2?: string;     // For 'range' mode: the upper bound.
    groupName: string;
    matchMode?: GroupMatchMode; // Default: 'exact' (backward compatible)
}

export interface SubDimensionGroupConfig {
    enabled: boolean;
    rules: SubDimensionGroupRule[];
}

const normalizeGroupKey = (val: any) => String(val ?? '').trim();

const matchesRule = (value: string, rule: SubDimensionGroupRule): boolean => {
    const mode = rule.matchMode || 'exact';
    const pattern = normalizeGroupKey(rule.source);

    if (mode === 'isEmpty') {
        return !value || value === '(未定义)' || value === 'undefined' || value === 'null';
    }
    if (mode === 'isNotEmpty') {
        return !!value && value !== '(未定义)' && value !== 'undefined' && value !== 'null';
    }

    if (!pattern) return false;

    switch (mode) {
        case 'exact':
            return value === pattern;
        case 'contains':
            return value.toLowerCase().includes(pattern.toLowerCase());
        case 'notContains':
            return !value.toLowerCase().includes(pattern.toLowerCase());
        case 'notEquals':
            return value !== pattern;
        case 'startsWith':
            return value.toLowerCase().startsWith(pattern.toLowerCase());
        case 'endsWith':
            return value.toLowerCase().endsWith(pattern.toLowerCase());
        case 'gt': {
            const num = parseFloat(value);
            return !isNaN(num) && num > parseFloat(pattern);
        }
        case 'gte': {
            const num = parseFloat(value);
            return !isNaN(num) && num >= parseFloat(pattern);
        }
        case 'lt': {
            const num = parseFloat(value);
            return !isNaN(num) && num < parseFloat(pattern);
        }
        case 'lte': {
            const num = parseFloat(value);
            return !isNaN(num) && num <= parseFloat(pattern);
        }
        case 'range': {
            const num = parseFloat(value);
            const upper = parseFloat(rule.source2 || '');
            return !isNaN(num) && num >= parseFloat(pattern) && (!isNaN(upper) ? num <= upper : true);
        }
        case 'inList': {
            const items = pattern.split(/[,，]/).map(s => s.trim().toLowerCase());
            return items.includes(value.toLowerCase());
        }
        case 'regex': {
            try {
                return new RegExp(pattern, 'i').test(value);
            } catch {
                return false;
            }
        }
        default:
            return value === pattern;
    }
};

const Dashboard: React.FC<DashboardProps> = ({ data, onAddSnapshot }) => {
    const OTHER_GROUP_LABEL = '其他类型';
    // --- VISUALIZATION CONFIG STATE ---
    const [chartType, setChartType] = useState<ChartType>('bar');
    const [dimensionCol, setDimensionCol] = useState<string>(data.columns[0] || ''); // X-Axis
    const [subDimensionCol, setSubDimensionCol] = useState<string>(''); // Secondary X-Axis
    const [breakdownCol, setBreakdownCol] = useState<string>(''); // Stack / Legend / Series
    const [metricCol, setMetricCol] = useState<string>(''); // Y-Axis
    const [aggregation, setAggregation] = useState<AggregationType>('count');
    const [secondaryMetricCol, setSecondaryMetricCol] = useState<string>(''); // Secondary Y-Axis
    const [secondaryAggregation, setSecondaryAggregation] = useState<AggregationType>('sum');
    const [showValues, setShowValues] = useState(true);

    // Date granularity for time-series grouping
    const [dateGranularity, setDateGranularity] = useState<'day' | 'week' | 'month' | 'quarter' | 'year'>('month');
    const [monthStartDay, setMonthStartDay] = useState(23);
    const [showYearInDate, setShowYearInDate] = useState(false); // 月份标签是否显示年份

    // Bar chart group mode: per-column configuration
    const [bColGroupModes, setBColGroupModes] = useState<Record<string, 'stacked' | 'grouped'>>({});

    // Custom axis labels
    const [customXLabel, setCustomXLabel] = useState('');
    const [customYLabel, setCustomYLabel] = useState('');
    const [xTickDisplayField, setXTickDisplayField] = useState<string>('all');

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
    
    // Per-column specific binning (replaces global colBinning)
    const [perColBins, setPerColBins] = useState<Record<string, ColumnBinConfig>>({});
    const [subDimensionGroups, setSubDimensionGroups] = useState<Record<string, SubDimensionGroupConfig>>({});

    // Column field binning (legacy)
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

    // --- CHART SORTING STATE ---
    const [xSortMode, setXSortMode] = useState<'default' | 'asc' | 'desc' | 'manual'>('default');
    const [xManualOrder, setXManualOrder] = useState<string[]>([]);
    const [stackSortMode, setStackSortMode] = useState<'default' | 'asc' | 'desc' | 'manual'>('default');
    const [stackManualOrder, setStackManualOrder] = useState<string[]>([]);

    const [copied, setCopied] = useState(false);
    const [chartCopied, setChartCopied] = useState(false);
    const [copyingChart, setCopyingChart] = useState(false);

    // --- PIVOT TABLE MULTI-COLUMN WRAPPING STATE ---
    const [multiColumnWrap, setMultiColumnWrap] = useState<number>(1);
    const [showPercentageInPivot, setShowPercentageInPivot] = useState<boolean>(false);
    const [pivotCopied, setPivotCopied] = useState(false);

    // --- CHART DISPLAY MODE ---
    // 'total' = 总和视图, 'faceted' = 分面视图(每个分段一个图), 'filtered' = 筛选视图
    const [chartDisplayMode, setChartDisplayMode] = useState<'total' | 'faceted' | 'filtered'>('total');
    const [selectedBreakdowns, setSelectedBreakdowns] = useState<string[]>([]); // 选中的分段列
    const [colQuickUnchecked, setColQuickUnchecked] = useState<Record<string, string[]>>({}); // 单字段独立过滤
    const [groupRowSearch, setGroupRowSearch] = useState<Record<string, string>>({});
    const [groupDraftNames, setGroupDraftNames] = useState<Record<string, string[]>>({});
    const [groupNewName, setGroupNewName] = useState<Record<string, string>>({});
    const [groupCollapsedRows, setGroupCollapsedRows] = useState<Record<string, boolean>>({});

    // --- PERFORMANCE STATE ---
    const [isProcessing, setIsProcessing] = useState(false);
    const [calculationVersion, setCalculationVersion] = useState(0);
    const processingTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastCalcConfigRef = useRef<string>('');
    const chartCaptureRef = useRef<HTMLDivElement>(null);
    const rawValueOptionsCacheRef = useRef<Record<string, string[]>>({});

    // --- MANUAL GENERATION MODE ---
    // 图表实时响应，无需手动点击生成
    const [chartGenerated, setChartGenerated] = useState(true);

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
        setXTickDisplayField('all');
        // Reset calculation state for new data
        lastCalcConfigRef.current = '';
        setChartGenerated(true); // 实时预览模式：始终为 true
        rawValueOptionsCacheRef.current = {};
        setGroupRowSearch({});
        setGroupDraftNames({});
        setGroupNewName({});
        setGroupCollapsedRows({});
    }, [data]);

    // Auto-trigger smart recommendations on first load
    useEffect(() => {
        if (data.rows.length > 0 && data.columns.length > 0 && recommendations.length === 0) {
            const recs = generateSmartRecommendations(data.rows, data.columns);
            setRecommendations(recs);
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [data.rows, data.columns]);

    useEffect(() => {
        if (xTickDisplayField.startsWith('sub:')) {
            const selectedCol = xTickDisplayField.slice(4);
            const subCols = subDimensionCol ? subDimensionCol.split(':::') : [];
            if (!subCols.includes(selectedCol)) {
                setXTickDisplayField('all');
            }
        }
    }, [subDimensionCol, xTickDisplayField]);
    // Threshold for auto-calculation
    const LARGE_DATA_THRESHOLD = 2000;
    const isLargeDataset = data.rows.length > LARGE_DATA_THRESHOLD;

    // Pre-compute which columns are dates
    const dateColumnsSet = useMemo(() => {
        if (!data || !data.rows || data.rows.length === 0) return new Set<string>();
        const dates = new Set<string>();
        const sample = data.rows.slice(0, Math.min(50, data.rows.length));
        for (const col of data.columns) {
            let dateCount = 0;
            let validCount = 0;
            for (const row of sample) {
                const val = String(row[col] || '');
                if (!val) continue;
                validCount++;
                if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(val) || /^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(val)) dateCount++;
            }
            if (validCount > 0 && dateCount > validCount * 0.6) {
                dates.add(col);
            }
        }
        return dates;
    }, [data.rows, data.columns]);

    // Check if any configured dimension or breakdown is a date
    const isAnyDateSelected = useMemo(() => {
        const colsToCheck = [];
        if (dimensionCol) colsToCheck.push(dimensionCol);
        if (breakdownCol) colsToCheck.push(...breakdownCol.split(':::'));
        if (subDimensionCol) colsToCheck.push(...subDimensionCol.split(':::'));
        
        return colsToCheck.some(c => dateColumnsSet.has(c));
    }, [dimensionCol, breakdownCol, subDimensionCol, dateColumnsSet]);

    // Helper: group a date string by granularity
    const groupDateByGranularity = useCallback((dateStr: string): string | null => {
        const d = new Date(dateStr.replace(/\//g, '-'));
        if (isNaN(d.getTime())) return null;
        const y = d.getFullYear();
        const m = d.getMonth(); // 0-based
        switch (dateGranularity) {
            case 'day': {
                const dayStr = `${String(m + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
                return showYearInDate ? `${y}-${dayStr}` : dayStr;
            }
            case 'week': {
                const onejan = new Date(y, 0, 1);
                const weekNum = Math.ceil(((d.getTime() - onejan.getTime()) / 86400000 + onejan.getDay() + 1) / 7);
                return showYearInDate ? `${y}-W${String(weekNum).padStart(2, '0')}` : `W${String(weekNum).padStart(2, '0')}`;
            }
            case 'month': {
                if (d.getDate() >= monthStartDay) {
                    const nextMonth = new Date(y, m + 1, 1);
                    return showYearInDate ? `${nextMonth.getFullYear()}-${String(nextMonth.getMonth() + 1).padStart(2, '0')}` : `${nextMonth.getMonth() + 1}月`;
                } else {
                    return showYearInDate ? `${y}-${String(m + 1).padStart(2, '0')}` : `${m + 1}月`;
                }
            }
            case 'quarter': {
                let effectiveMonth = m;
                if (d.getDate() >= monthStartDay) effectiveMonth = m + 1;
                const effectiveDate = new Date(y, effectiveMonth, 1);
                const q = Math.floor(effectiveDate.getMonth() / 3) + 1;
                return showYearInDate ? `${effectiveDate.getFullYear()}-Q${q}` : `Q${q}`;
            }
            case 'year': return `${y}`;
            default: return dateStr;
        }
    }, [dateGranularity, monthStartDay, showYearInDate]);

    // Auto-enable column binning for numeric breakdown columns
    useEffect(() => {
        if (!breakdownCol || !data?.rows) return;
        const sample = data.rows.slice(0, 50);
        const numCount = sample.filter(r => !isNaN(parseFloat(String(r[breakdownCol] || '')))).length;
        const isNumericCol = numCount > sample.length * 0.6;
        if (isNumericCol && !enableColBinning) {
            setEnableColBinning(true);
            // Auto-generate bins
            const vals = data.rows.map(r => parseFloat(String(r[breakdownCol]))).filter(n => !isNaN(n));
            if (vals.length > 0) {
                const minVal = Math.min(...vals);
                const maxVal = Math.max(...vals);
                const step = Math.ceil((maxVal - minVal) / 4);
                const newBins = [];
                for (let i = 0; i < 4; i++) {
                    const start = minVal + i * step;
                    const end = i === 3 ? Infinity : minVal + (i + 1) * step;
                    newBins.push({ id: `auto_cb${i}`, label: end === Infinity ? `${start}+` : `${start}-${end}`, min: start, max: end });
                }
                setColBins(newBins);
            }
        }
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [breakdownCol]);

    // Create a config signature to detect changes (excludes sort — sorting is instant, no debounce needed)
    const configSignature = `${dimensionCol}|${subDimensionCol}|${breakdownCol}|${metricCol}|${aggregation}|${enableBinning}|${bins.length}|${enableColBinning}|${colBins.length}|${filters.length}|${maxItems}|${dateGranularity}|${JSON.stringify(colQuickUnchecked)}|${JSON.stringify(subDimensionGroups)}`;

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
        secondaryMetricCol?: string;
        secondaryAggregation?: AggregationType;
        maxItems: number;
        showValues: boolean;
        subDimensionGroups?: Record<string, SubDimensionGroupConfig>;
        groupDraftNames?: Record<string, string[]>;
    }

    const exportPreset = () => {
        const preset: DashboardPreset = {
            name: 'Dashboard Preset',
            version: 2,
            rowBins,
            colBins,
            enableRowBinning,
            enableColBinning,
            aggregation,
            secondaryMetricCol,
            secondaryAggregation,
            maxItems,
            showValues,
            subDimensionGroups,
            groupDraftNames
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
                if (preset.secondaryMetricCol !== undefined) setSecondaryMetricCol(preset.secondaryMetricCol);
                if (preset.secondaryAggregation) setSecondaryAggregation(preset.secondaryAggregation);
                if (preset.maxItems) setMaxItems(preset.maxItems);
                if (preset.showValues !== undefined) setShowValues(preset.showValues);
                if (preset.subDimensionGroups) setSubDimensionGroups(preset.subDimensionGroups);
                if (preset.groupDraftNames) setGroupDraftNames(preset.groupDraftNames);
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

    // --- Debounce for real-time preview ---
    const processedDataCache = useRef<any>(null);
    const [computeReady, setComputeReady] = useState(true);

    useEffect(() => {
        setComputeReady(false);
        setIsProcessing(true);
        const timer = setTimeout(() => {
            setComputeReady(true);
            setIsProcessing(false);
        }, 250);
        return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [configSignature, showYearInDate]);

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

        // Debounce: return cached data while waiting
        if (!computeReady && processedDataCache.current) {
            return processedDataCache.current;
        }

        // Step A: Filtering
        const initialFilteredRows = data.rows.filter((row: any) => {
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

        const getBinnedValue = (col: string, rawVal: any) => {
            let val = String(rawVal);
            if (!val || val === 'undefined') val = '(未定义)';
            
            // 1. Date granularity check first
            if (dateColumnsSet.has(col) && dateGranularity !== 'day') {
                const grouped = groupDateByGranularity(val);
                if (grouped) return grouped;
            }

            // 2. Continuous numeric binning
            const colBinConfig = perColBins[col];
            if (colBinConfig && colBinConfig.enabled && colBinConfig.bins.length > 0) {
                const numVal = parseFloat(val);
                if (!isNaN(numVal)) {
                    const matchedBin = colBinConfig.bins.find(bin => numVal >= bin.min && numVal < (bin.max === Infinity ? Number.MAX_VALUE : bin.max));
                    return matchedBin ? matchedBin.label : '(其他)';
                }
            } else if (enableColBinning && colBins.length > 0) { // Legacy single fallback for backward compatibility
                const numVal = parseFloat(val);
                if (!isNaN(numVal)) {
                    const matchedBin = colBins.find(bin => numVal >= bin.min && numVal < (bin.max === Infinity ? Number.MAX_VALUE : bin.max));
                    return matchedBin ? matchedBin.label : '(其他)';
                }
            }
            return val;
        };


        const compiledRulesCache: Record<string, { groupName: string, rules: SubDimensionGroupRule[] }[]> = {};
        const getCompiledRules = (col: string) => {
            if (compiledRulesCache[col]) return compiledRulesCache[col];
            const cfg = subDimensionGroups[col];
            if (!cfg?.enabled || !cfg.rules?.length) {
                compiledRulesCache[col] = [];
                return [];
            }
            
            const groupedMap = new Map<string, string[]>();
            cfg.rules.forEach((rule) => {
                const group = normalizeGroupKey(rule.groupName);
                if (!group) return;
                const current = groupedMap.get(group) || [];
                current.push('');
                groupedMap.set(group, current);
            });
            const draftNames = (groupDraftNames[col] || []).map(normalizeGroupKey).filter(Boolean);
            const mergedNames = Array.from(new Set([...draftNames, ...Array.from(groupedMap.keys())]));

            const structured = mergedNames.map(gn => ({
                groupName: gn,
                rules: cfg.rules.filter(r => normalizeGroupKey(r.groupName) === gn)
            })).filter(g => g.rules.length > 0);
            
            compiledRulesCache[col] = structured;
            return structured;
        };

        const getDisplayValue = (col: string, rawVal: any) => {
            const baseVal = getBinnedValue(col, rawVal);
            const structuredGroups = getCompiledRules(col);
            if (structuredGroups.length === 0) return baseVal;

            const normalizedBase = normalizeGroupKey(baseVal);
            if (!normalizedBase) return baseVal;

            for (const { groupName, rules } of structuredGroups) {
                // 1. Exact matches within this group have highest intra-group priority
                for (const rule of rules) {
                    if ((rule.matchMode || 'exact') === 'exact') {
                        if (normalizeGroupKey(rule.source) === normalizedBase) return groupName;
                    }
                }
                // 2. Smart conditionals within this group
                for (const rule of rules) {
                    if ((rule.matchMode || 'exact') !== 'exact') {
                        if (matchesRule(normalizedBase, rule)) return groupName;
                    }
                }
            }

            return OTHER_GROUP_LABEL;
        };



        const activeCols = [];
        if (dimensionCol) activeCols.push(dimensionCol);
        if (subDimensionCol) activeCols.push(...subDimensionCol.split(':::'));
        if (breakdownCol) activeCols.push(...breakdownCol.split(':::'));
        const uniqueActiveCols = Array.from(new Set(activeCols)).filter(Boolean);

        const availableQuickFilters: Record<string, string[]> = {};
        uniqueActiveCols.forEach(col => {
            const vals = new Set<string>();
            initialFilteredRows.forEach(row => {
                vals.add(getDisplayValue(col, row[col]));
            });
            availableQuickFilters[col] = Array.from(vals)
                .map(v => ({ v, isOther: v === '(其他)' || v === '(未定义)' || v === 'Out of Range' || v === OTHER_GROUP_LABEL }))
                .sort((a, b) => {
                    if (a.isOther) return 1;
                    if (b.isOther) return -1;
                    return a.v.localeCompare(b.v);
                })
                .map(o => o.v);
        });

        const filteredRows = initialFilteredRows.filter(row => {
            return uniqueActiveCols.every(col => {
                const unchecked = colQuickUnchecked[col];
                if (!unchecked || unchecked.length === 0) return true;
                const val = getDisplayValue(col, row[col]);
                return !unchecked.includes(val);
            });
        });

        // Special Case: Scatter Chart (Raw Rows)
        if (chartType === 'scatter') {
            if (!scatterXCol || !metricCol) return { chartData: [], tableData: [], totalValue: 0, totalCount: 0, breakdownKeys: [] };

            const scatterData = filteredRows.map(row => ({
                x: parseFloat(String(row[scatterXCol] || 0)),
                y: parseFloat(String(row[metricCol] || 0)),
                name: getDisplayValue(dimensionCol, row[dimensionCol]) || 'Item',
                z: breakdownCol ? row[breakdownCol] : undefined // Optional Z dimension for color
            })).filter((d: any) => !isNaN(d.x) && !isNaN(d.y));

            return { chartData: scatterData, tableData: scatterData, totalValue: 0, totalCount: scatterData.length, breakdownKeys: [] };
        }

        // Step B: Grouping (Cross-Tab Logic)
        const groups: Record<string, any> = {};
        const breakdownKeysSet = new Set<string>();


        const getRowKey = (row: any): { mainKey: string; primaryLabel: string; subLabelByCol: Record<string, string> } | null => {
            let primaryLabel = '';
            const subLabelByCol: Record<string, string> = {};

            // 1. Calculate Main Key
            if (enableBinning && dimensionCol) {
                const val = parseFloat(String(row[dimensionCol]));
                if (isNaN(val)) return null;
                const matchingBin = bins.find(b => val >= b.min && val <= b.max);
                primaryLabel = matchingBin ? matchingBin.label : 'Out of Range';
            } else if (dateColumnsSet.has(dimensionCol) && dateGranularity !== 'day') {
                // Date granularity grouping
                const rawVal = String(row[dimensionCol] || '');
                if (excludeEmpty && (!rawVal || rawVal === 'undefined' || rawVal === 'null')) return null;
                const grouped = groupDateByGranularity(rawVal);
                if (!grouped) return null;
                primaryLabel = grouped;
            } else {
                let key = String(getDisplayValue(dimensionCol, row[dimensionCol]));
                if (excludeEmpty && (!key || key === 'undefined' || key === 'null')) return null;
                if (!key) primaryLabel = "(空值)";
                else primaryLabel = key;
            }

            // 2. Append Secondary Dimension Key (if active)
            let mainKey = primaryLabel;
            if (subDimensionCol) {
                const sCols = subDimensionCol.split(':::');
                const subVals = sCols.map(c => {
                    const val = getDisplayValue(c, row[c]);
                    subLabelByCol[c] = val;
                    return val;
                }).join(' / ');
                mainKey = `${primaryLabel} / ${subVals}`;
            }

            return { mainKey, primaryLabel, subLabelByCol };
        };

        filteredRows.forEach(row => {
            const keyInfo = getRowKey(row);
            if (!keyInfo) return;
            const { mainKey, primaryLabel, subLabelByCol } = keyInfo;

            if (!groups[mainKey]) groups[mainKey] = {
                name: mainKey,
                _primaryLabel: primaryLabel,
                _subLabelByCol: subLabelByCol,
                count: 0,
                sum: 0,
                _values: [],
                secCount: 0,
                secSum: 0
            };

            let metricVal = 0;
            let metricIsEmpty = false;
            if (metricCol) {
                const rawMetric = row[metricCol];
                const rawStr = String(rawMetric ?? '').trim();
                metricIsEmpty = rawStr === '' || rawStr === 'undefined' || rawStr === 'null';
                metricVal = parseFloat(rawStr);
                if (isNaN(metricVal)) metricVal = 0;
            }

            let secMetricVal = 0;
            let secMetricIsEmpty = false;
            if (secondaryMetricCol) {
                const rawSecMetric = row[secondaryMetricCol];
                const secRawStr = String(rawSecMetric ?? '').trim();
                secMetricIsEmpty = secRawStr === '' || secRawStr === 'undefined' || secRawStr === 'null';
                secMetricVal = parseFloat(secRawStr);
                if (isNaN(secMetricVal)) secMetricVal = 0;
            }

            // When counting with a metric column selected, skip rows where metric is empty
            const shouldCount = aggregation !== 'count' || !metricCol || !metricIsEmpty;
            const shouldSecCount = secondaryAggregation !== 'count' || !secondaryMetricCol || !secMetricIsEmpty;

            if (shouldCount) {
                groups[mainKey].count += 1;
            }
            if (shouldSecCount) {
                groups[mainKey].secCount += 1;
            }

            groups[mainKey].sum += metricVal;
            groups[mainKey]._values.push(metricVal);
            groups[mainKey].secSum += secMetricVal;

            if (breakdownCol) {
                const bCols = breakdownCol.split(':::');
                let subKey = '';

                // Apply grouping mapping (and binning) for breakdown keys.
                subKey = bCols.map(c => getDisplayValue(c, row[c])).join(' / ');

                breakdownKeysSet.add(subKey);

                if (!groups[mainKey][subKey]) groups[mainKey][subKey] = 0;

                if (aggregation === 'count') {
                    if (shouldCount) {
                        groups[mainKey][subKey] += 1;
                    }
                } else if (aggregation === 'sum') {
                    groups[mainKey][subKey] += metricVal;
                } else if (aggregation === 'avg') {
                    groups[mainKey][subKey] += metricVal;
                }
            }
        });

        // Pre-calculate totals for all breakdown keys
        const keyTotals = Array.from(breakdownKeysSet).map(key => {
            let total = 0;
            Object.values(groups).forEach((g: any) => { total += (g[key] || 0); });
            return { key, total };
        });

        // Cap breakdown keys to prevent rendering freeze (max 15)
        const MAX_BREAKDOWN_KEYS = 15;
        let breakdownKeys: string[];
        
        if (keyTotals.length > MAX_BREAKDOWN_KEYS) {
            // Drop smallest
            keyTotals.sort((a: any, b: any) => b.total - a.total);
            const keepKeys = new Set(keyTotals.slice(0, MAX_BREAKDOWN_KEYS).map(k => k.key));
            const dropKeys = keyTotals.slice(MAX_BREAKDOWN_KEYS).map(k => k.key);

            // Merge dropped keys into '其他'
            Object.values(groups).forEach((g: any) => {
                let otherSum = 0;
                dropKeys.forEach(dk => {
                    otherSum += (g[dk] || 0);
                    delete g[dk];
                });
                if (otherSum > 0) g['其他'] = otherSum;
            });
            breakdownKeys = [...Array.from(keepKeys), '其他'];
        } else {
            breakdownKeys = keyTotals.map(k => k.key);
        }

        // Apply advanced sorting to the final breakdownKeys
        if (stackSortMode === 'manual') {
            breakdownKeys.sort((a: any, b: any) => {
                const idxA = stackManualOrder.indexOf(a);
                const idxB = stackManualOrder.indexOf(b);
                if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                if (idxA !== -1) return -1;
                if (idxB !== -1) return 1;
                return a.localeCompare(b);
            });
        } else if (stackSortMode === 'asc' || stackSortMode === 'desc') {
            const map = new Map(keyTotals.map(k => [k.key, k.total]));
            breakdownKeys.sort((a: any, b: any) => {
                if (a === '其他') return 1; // Always at end
                if (b === '其他') return -1;
                const vA = map.get(a) || 0;
                const vB = map.get(b) || 0;
                return stackSortMode === 'asc' ? vA - vB : vB - vA;
            });
        } else {
            // Default sort: if using column binning, sort by bin order, else alphabetical
            if (enableColBinning && colBins.length > 0) {
                const binOrder = colBins.map(b => b.label);
                breakdownKeys.sort((a: any, b: any) => {
                    const idxA = binOrder.indexOf(a);
                    const idxB = binOrder.indexOf(b);
                    if (idxA === -1 && idxB === -1) return a.localeCompare(b);
                    if (idxA === -1) return 1;
                    if (idxB === -1) return -1;
                    return idxA - idxB;
                });
            } else {
                breakdownKeys.sort();
            }
        }

        // Step C: Format Output Data
        let totalValue = 0;
        let totalCount = 0;

        const fullData = Object.values(groups).map((group: any) => {
            let value = 0;
            if (aggregation === 'count') value = group.count;
            else if (aggregation === 'sum') value = group.sum;
            else if (aggregation === 'avg') value = group.count > 0 ? (group.sum / group.count) : 0;

            let secondaryValue = 0;
            if (secondaryAggregation === 'count') secondaryValue = group.secCount || 0;
            else if (secondaryAggregation === 'sum') secondaryValue = group.secSum || 0;
            else if (secondaryAggregation === 'avg') secondaryValue = group.secCount > 0 ? (group.secSum / group.secCount) : 0;

            value = parseFloat(value.toFixed(2));
            secondaryValue = parseFloat(secondaryValue.toFixed(2));
            totalValue += value;
            totalCount += group.count;

            return {
                ...group,
                value,
                secondaryValue,
                _values: undefined
            };
        });

        // Calculate Percentages
        const fullDataWithPercentage = fullData.map((d: any) => ({
            ...d,
            percentage: totalValue > 0 ? parseFloat(((d.value / totalValue) * 100).toFixed(1)) : 0
        }));

        // Step D: Sort
        fullDataWithPercentage.sort((a: any, b: any) => {
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

        // Step E: Limit and Sort for Chart (Top N and Advanced Sort)
        let chartData = [...fullDataWithPercentage];

        // Apply advanced sorting to chart data explicitly
        if (xSortMode !== 'default') {
            chartData.sort((a: any, b: any) => {
                if (xSortMode === 'manual') {
                    const idxA = xManualOrder.indexOf(a.name);
                    const idxB = xManualOrder.indexOf(b.name);
                    if (idxA !== -1 && idxB !== -1) return idxA - idxB;
                    if (idxA !== -1) return -1;
                    if (idxB !== -1) return 1;
                    return 0; // maintain original sort fallback
                } else {
                    const factor = xSortMode === 'asc' ? 1 : -1;
                    return (a.value - b.value) * factor;
                }
            });
        }

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
                breakdownKeys.forEach((k: string) => {
                    if (o[k]) othersNode[k] = (othersNode[k] || 0) + o[k];
                });
            });
            othersNode.value = parseFloat(othersNode.value.toFixed(2));
            othersNode.percentage = totalValue > 0 ? parseFloat(((othersNode.value / totalValue) * 100).toFixed(1)) : 0;

            chartData = [...topN, othersNode];
        }

        const result = {
            chartData,
            tableData: fullDataWithPercentage,
            totalValue,
            totalCount,
            breakdownKeys,
            availableQuickFilters
        };

        // Cache for debounce
        processedDataCache.current = result;
        return result;

    }, [data, filters, chartType, dimensionCol, subDimensionCol, metricCol, breakdownCol, scatterXCol, aggregation, enableBinning, bins, enableColBinning, colBins, perColBins, subDimensionGroups, excludeEmpty, sortConfig, maxItems, isLargeDataset, needsRecalculation, calculationVersion, chartGenerated, dateColumnsSet, dateGranularity, groupDateByGranularity, computeReady, showYearInDate, xSortMode, xManualOrder, stackSortMode, stackManualOrder, colQuickUnchecked]);

    const xTickLabelMap = useMemo(() => {
        const map = new Map<string, string>();
        const subKey = xTickDisplayField.startsWith('sub:') ? xTickDisplayField.slice(4) : '';
        (processedData.chartData || []).forEach((item: any) => {
            const raw = String(item?.name ?? '');
            let display = raw;
            if (xTickDisplayField === 'dimension') {
                display = String(item?._primaryLabel ?? raw);
            } else if (subKey) {
                display = String(item?._subLabelByCol?.[subKey] ?? raw);
            }
            map.set(raw, display);
        });
        return map;
    }, [processedData.chartData, xTickDisplayField]);

    const formatXAxisTick = useCallback((value: any) => {
        const key = String(value ?? '');
        return xTickLabelMap.get(key) ?? key;
    }, [xTickLabelMap]);

    // --- ACTIONS ---
    const handleCopyTable = () => {
        const { breakdownKeys, tableData, totalValue } = processedData;
        let header = `类别\t总数值 (${aggregation})\t占比`;
        if (breakdownKeys.length > 0) {
            header += `\t` + breakdownKeys.join('\t');
        }
        const body = tableData.map((d: any) => {
            let row = `${d.name}\t${d.value}\t${d.percentage}%`;
            if (breakdownKeys.length > 0) {
                row += `\t` + breakdownKeys.map((k: string) => d[k] || 0).join('\t');
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

    const handleCopyPivotData = () => {
        const { breakdownKeys, tableData, totalValue } = processedData;
        let text = '';

        if (breakdownCol) {
            // Copy 2D pivot table
            const headers = [enableBinning ? '范围' : dimensionCol, ...breakdownKeys, '总计'];
            const headerRow = headers.join('\t');
            
            const rows = tableData.slice(0, 100).map((item: any) => {
                const cols = [
                    item.name,
                    ...breakdownKeys.map((key: string) => item[key] || 0),
                    item.value
                ];
                return cols.join('\t');
            });

            const totals = [
                '总计',
                ...breakdownKeys.map((key: string) => {
                    return tableData.reduce((sum: number, item: any) => sum + (item[key] || 0), 0);
                }),
                totalValue
            ];
            const totalsRow = totals.join('\t');

            text = [headerRow, ...rows, totalsRow].join('\n');
        } else {
            // Copy 1D pivot table (with wrapping)
            const wrapCols = multiColumnWrap;
            const totalRows = tableData.length;
            const rowsPerCol = Math.ceil(totalRows / wrapCols);
            const labelCol = enableBinning ? '范围' : dimensionCol;
            const valueCol = metricCol || (aggregation === 'count' ? '数量' : '数值');

            // Build headers
            const headerParts = [];
            for (let c = 0; c < wrapCols; c++) {
                headerParts.push(labelCol, valueCol);
                if (showPercentageInPivot) {
                    headerParts.push('占比');
                }
            }
            const headerRow = headerParts.join('\t');

            // Build rows
            const rows = [];
            for (let r = 0; r < rowsPerCol; r++) {
                const rowParts = [];
                for (let c = 0; c < wrapCols; c++) {
                    const dataIdx = c * rowsPerCol + r;
                    if (dataIdx < totalRows) {
                        const item = tableData[dataIdx];
                        rowParts.push(item.name, item.value);
                        if (showPercentageInPivot) {
                            rowParts.push(`${item.percentage}%`);
                        }
                    } else {
                        rowParts.push('/', '/');
                        if (showPercentageInPivot) {
                            rowParts.push('/');
                        }
                    }
                }
                rows.push(rowParts.join('\t'));
            }

            // Build totals row
            const totalRowParts = [];
            totalRowParts.push('总计', totalValue);
            if (showPercentageInPivot) {
                totalRowParts.push('100%');
            }
            for (let c = 1; c < wrapCols; c++) {
                totalRowParts.push('', '');
                if (showPercentageInPivot) {
                    totalRowParts.push('');
                }
            }
            const totalsRow = totalRowParts.join('\t');

            text = [headerRow, ...rows, totalsRow].join('\n');
        }

        navigator.clipboard.writeText(text).then(() => {
            setPivotCopied(true);
            setTimeout(() => setPivotCopied(false), 2000);
        });
    };

    const handleCopyChartImage = useCallback(async () => {
        if (!chartCaptureRef.current || copyingChart) return;
        setCopyingChart(true);
        try {
            const node = chartCaptureRef.current;
            const width = Math.max(1, Math.floor(node.clientWidth));
            const height = Math.max(1, Math.floor(node.clientHeight));
            const exportScale = 3;

            const blob = await toBlob(node, {
                width,
                height,
                canvasWidth: width * exportScale,
                canvasHeight: height * exportScale,
                pixelRatio: 1,
                cacheBust: true,
                backgroundColor: '#ffffff'
            });
            if (!blob) throw new Error('Failed to render chart image');

            if (navigator.clipboard?.write && typeof ClipboardItem !== 'undefined') {
                await navigator.clipboard.write([
                    new ClipboardItem({ [blob.type]: blob })
                ]);
                setChartCopied(true);
                setTimeout(() => setChartCopied(false), 2000);
                return;
            }

            // Fallback: download as PNG when image clipboard API is unavailable.
            const imageUrl = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = imageUrl;
            a.download = `chart-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.png`;
            a.click();
            URL.revokeObjectURL(imageUrl);
        } catch (err) {
            console.error('Copy chart image failed:', err);
        } finally {
            setCopyingChart(false);
        }
    }, [copyingChart]);

    const getRawColumnValueOptions = useCallback((col: string) => {
        const cached = rawValueOptionsCacheRef.current[col];
        if (cached) return cached;

        const seen = new Set<string>();
        for (const row of data.rows) {
            let val = String(row[col] ?? '');
            if (!val || val === 'undefined' || val === 'null') val = '(未定义)';
            seen.add(val);
            if (seen.size >= 500) break;
        }

        const options = Array.from(seen).sort((a, b) => a.localeCompare(b));
        rawValueOptionsCacheRef.current[col] = options;
        return options;
    }, [data.rows]);

    const normalizeGroupText = useCallback((value: any) => String(value ?? '').trim(), []);

    const getGroupRowsForColumn = useCallback((col: string) => {
        const groupedMap = new Map<string, string[]>();
        (subDimensionGroups[col]?.rules || []).forEach((rule) => {
            const source = normalizeGroupText(rule.source);
            const group = normalizeGroupText(rule.groupName);
            if (!source || !group) return;
            const current = groupedMap.get(group) || [];
            if (!current.includes(source)) current.push(source);
            groupedMap.set(group, current);
        });

        const draftNames = (groupDraftNames[col] || []).map(normalizeGroupText).filter(Boolean);
        const mergedNames = Array.from(new Set([...Array.from(groupedMap.keys()), ...draftNames]));

        return mergedNames.map((groupName) => ({
            groupName,
            values: (groupedMap.get(groupName) || []).sort((a, b) => a.localeCompare(b))
        }));
    }, [groupDraftNames, normalizeGroupText, subDimensionGroups]);

    const createGroupForColumn = useCallback((col: string, name: string) => {
        const nextName = normalizeGroupText(name);
        if (!nextName) return;
        setGroupDraftNames((prev) => {
            const current = prev[col] || [];
            if (current.includes(nextName)) return prev;
            return { ...prev, [col]: [...current, nextName] };
        });
        setGroupNewName((prev) => ({ ...prev, [col]: '' }));
    }, [normalizeGroupText]);

    const renameGroupForColumn = useCallback((col: string, oldName: string, newName: string) => {
        const oldNormalized = normalizeGroupText(oldName);
        const newNormalized = normalizeGroupText(newName);
        if (!oldNormalized || !newNormalized || oldNormalized === newNormalized) return;

        setSubDimensionGroups((prev) => {
            const prevCfg = prev[col] || { enabled: true, rules: [] as SubDimensionGroupRule[] };
            const nextRules = (prevCfg.rules || []).map((rule) => (
                normalizeGroupText(rule.groupName) === oldNormalized
                    ? { ...rule, groupName: newNormalized }
                    : rule
            ));
            return { ...prev, [col]: { enabled: true, rules: nextRules } };
        });

        setGroupDraftNames((prev) => {
            const current = prev[col] || [];
            const renamed = current.map((name) => normalizeGroupText(name) === oldNormalized ? newNormalized : name);
            return { ...prev, [col]: Array.from(new Set(renamed)) };
        });
    }, [normalizeGroupText]);

    const removeGroupForColumn = useCallback((col: string, groupName: string) => {
        const target = normalizeGroupText(groupName);
        if (!target) return;

        setSubDimensionGroups((prev) => {
            const prevCfg = prev[col] || { enabled: true, rules: [] as SubDimensionGroupRule[] };
            const nextRules = (prevCfg.rules || []).filter((rule) => normalizeGroupText(rule.groupName) !== target);
            return { ...prev, [col]: { enabled: true, rules: nextRules } };
        });

        setGroupDraftNames((prev) => {
            const current = prev[col] || [];
            return { ...prev, [col]: current.filter((name) => normalizeGroupText(name) !== target) };
        });
    }, [normalizeGroupText]);

    const moveGroupRankForColumn = useCallback((col: string, groupName: string, direction: -1 | 1) => {
        setGroupDraftNames((prev) => {
            const currentDraft = (prev[col] || []).map(normalizeGroupText).filter(Boolean);
            const subGroups = subDimensionGroups[col]?.rules || [];
            const existingRuleGroups = new Set(subGroups.map(r => normalizeGroupText(r.groupName)).filter(Boolean));
            const fullOrder = Array.from(new Set([...currentDraft, ...Array.from(existingRuleGroups)]));
            
            const targetName = normalizeGroupText(groupName);
            const idx = fullOrder.indexOf(targetName);
            if (idx === -1) return prev;
            
            const newIdx = idx + direction;
            if (newIdx < 0 || newIdx >= fullOrder.length) return prev;
            
            const newOrder = [...fullOrder];
            const temp = newOrder[idx];
            newOrder[idx] = newOrder[newIdx];
            newOrder[newIdx] = temp;
            
            return { ...prev, [col]: newOrder };
        });
    }, [normalizeGroupText, subDimensionGroups]);

    const clearGroupValuesForColumn = useCallback((col: string, groupName: string) => {
        const target = normalizeGroupText(groupName);
        if (!target) return;

        setSubDimensionGroups((prev) => {
            const prevCfg = prev[col] || { enabled: true, rules: [] as SubDimensionGroupRule[] };
            const nextRules = (prevCfg.rules || []).filter((rule) => normalizeGroupText(rule.groupName) !== target);
            return { ...prev, [col]: { enabled: true, rules: nextRules } };
        });

        setGroupDraftNames((prev) => {
            const current = prev[col] || [];
            if (current.includes(target)) return prev;
            return { ...prev, [col]: [...current, target] };
        });
    }, [normalizeGroupText]);

    const setValueGroupForColumn = useCallback((col: string, value: string, groupName: string | null) => {
        const normalizedValue = normalizeGroupText(value);
        const normalizedGroup = normalizeGroupText(groupName);
        if (!normalizedValue) return;

        setSubDimensionGroups((prev) => {
            const prevCfg = prev[col] || { enabled: true, rules: [] as SubDimensionGroupRule[] };
            const nextRules = (prevCfg.rules || []).filter((rule) => normalizeGroupText(rule.source) !== normalizedValue);
            if (normalizedGroup) {
                nextRules.push({
                    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    source: normalizedValue,
                    groupName: normalizedGroup
                });
            }
            return { ...prev, [col]: { enabled: true, rules: nextRules } };
        });
    }, [normalizeGroupText]);

    const setValuesGroupForColumn = useCallback((col: string, values: string[], groupName: string) => {
        const normalizedGroup = normalizeGroupText(groupName);
        if (!normalizedGroup || values.length === 0) return;
        const valueSet = new Set(values.map((v) => normalizeGroupText(v)).filter(Boolean));
        if (valueSet.size === 0) return;

        setSubDimensionGroups((prev) => {
            const prevCfg = prev[col] || { enabled: true, rules: [] as SubDimensionGroupRule[] };
            const nextRules = (prevCfg.rules || []).filter((rule) => !valueSet.has(normalizeGroupText(rule.source)));
            Array.from(valueSet).forEach((source) => {
                nextRules.push({
                    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                    source,
                    groupName: normalizedGroup
                });
            });
            return { ...prev, [col]: { enabled: true, rules: nextRules } };
        });
    }, [normalizeGroupText]);

    const toggleGroupRowCollapsed = useCallback((rowKey: string) => {
        setGroupCollapsedRows((prev) => ({
            ...prev,
            [rowKey]: !prev[rowKey]
        }));
    }, []);

    const addFilter = () => {
        const firstCol = data.columns[0];
        setFilters([...filters, { id: Date.now().toString(), column: firstCol, operator: 'eq', value: '' }]);
    };
    const updateFilter = (id: string, field: keyof FilterCondition | 'value2', val: string) => {
        setFilters(filters.map(f => f.id === id ? { ...f, [field]: val } : f));
    };
    const removeFilter = (id: string) => setFilters(filters.filter(f => f.id !== id));

    const addBin = () => setBins([...bins, { id: Date.now().toString(), label: `范围 ${bins.length + 1}`, min: 0, max: 100 }]);
    const removeBin = (id: string) => setBins(bins.filter((b: any) => b.id !== id));
    const updateBin = (id: string, field: keyof BinRange, val: string | number) => {
        setBins(bins.map((b: any) => b.id === id ? { ...b, [field]: val } : b));
    };

    const stackIdMapping = useMemo(() => {
        if (!breakdownCol) return undefined;
        const bCols = breakdownCol.split(':::');
        const mapping: Record<string, string> = {};
        
        processedData.breakdownKeys.forEach((key: string) => {
            const parts = key.split(' - ');
            let sidParts: string[] = [];
            bCols.forEach((col, i) => {
                const mode = bColGroupModes[col] || 'grouped';
                if (mode === 'grouped' && i < parts.length) {
                    sidParts.push(parts[i]);
                }
            });
            mapping[key] = sidParts.length > 0 ? sidParts.join('-') : 'a';
        });
        return mapping;
    }, [breakdownCol, bColGroupModes, processedData.breakdownKeys]);

    const renderCustomGroupingBlock = (col: string, isMain: boolean = false) => {
        const isText = isMain ? true : (subDimensionCol ? subDimensionCol.split(':::') : []).includes(col);
        return (
            <div className={`${isMain ? "mt-4" : "pl-5 mt-2"} p-2.5 bg-purple-50 rounded border border-purple-200 space-y-2`}>
                {!isMain && (
                    <>
                        <label className="text-xs flex items-center gap-1.5 cursor-pointer select-none text-purple-800 font-medium">
                            <input
                                type="checkbox"
                                checked={subDimensionGroups[col]?.enabled || false}
                                onChange={(e) => {
                                    const enabled = e.target.checked;
                                    if (enabled) {
                                        const sCols = subDimensionCol ? subDimensionCol.split(':::') : [];
                                        if (!sCols.includes(col)) {
                                            setSubDimensionCol([...sCols, col].join(':::'));
                                        }
                                    }
                                    setSubDimensionGroups(prev => ({
                                        ...prev,
                                        [col]: {
                                            enabled,
                                            rules: prev[col]?.rules?.length ? prev[col].rules : []
                                        }
                                    }));
                                }}
                                className="rounded text-purple-600 focus:ring-purple-500 w-4 h-4"
                            />
                            开启副维度分组映射（归类替换）
                        </label>
                        {!isText && (
                            <p className="text-xs text-purple-700">提示：启用后会自动勾选“作为X坐标副维度”。</p>
                        )}
                    </>
                )}

                                                                        {subDimensionGroups[col]?.enabled && (() => {
                                                                            const groupRows = getGroupRowsForColumn(col);
                                                                            const valueOptions = getRawColumnValueOptions(col).slice(0, 200);
                                                                            return (
                                                                                <div className="space-y-2">
                                                                                    <div className="flex items-center justify-between gap-2">
                                                                                        <span className="text-xs text-purple-700">每一行是一个组，组内勾选“包含值”</span>
                                                                                        <div className="flex items-center gap-1">
                                                                                            <input
                                                                                                value={groupNewName[col] || ''}
                                                                                                onChange={(e) => setGroupNewName(prev => ({ ...prev, [col]: e.target.value }))}
                                                                                                className="w-24 min-w-0 px-2 py-1 border border-purple-300 rounded text-xs text-slate-800 bg-white"
                                                                                                placeholder="新组名"
                                                                                            />
                                                                                            <button
                                                                                                onClick={() => createGroupForColumn(col, groupNewName[col] || '')}
                                                                                                className="text-xs px-2 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200"
                                                                                            >
                                                                                                新增组
                                                                                            </button>
                                                                                        </div>
                                                                                    </div>

                                                                                    {groupRows.length === 0 && (
                                                                                        <div className="text-xs text-purple-700 bg-white border border-purple-200 rounded p-2">
                                                                                            先新增一个组，然后在组内勾选要包含的值。
                                                                                        </div>
                                                                                    )}

                                                                                    {groupRows.map((group, idx) => {
                                                                                        const rowKey = `${col}::${group.groupName}`;
                                                                                        const keyword = (groupRowSearch[rowKey] || '').trim().toLowerCase();
                                                                                        const valueOwnerMap = new Map<string, string>();
                                                                                        const colRules = subDimensionGroups[col]?.rules || [];
                                                                                        groupRows.forEach((g) => {
                                                                                            g.values.forEach((v) => {
                                                                                                if (!valueOwnerMap.has(v)) valueOwnerMap.set(v, g.groupName);
                                                                                            });
                                                                                        });
                                                                                        valueOptions.forEach(v => {
                                                                                            if (valueOwnerMap.has(v)) return;
                                                                                            const normalizedBase = normalizeGroupKey(v);
                                                                                            const matchedRule = colRules.find(rule => matchesRule(normalizedBase, rule));
                                                                                            if (matchedRule) {
                                                                                                valueOwnerMap.set(v, matchedRule.groupName);
                                                                                            }
                                                                                        });
                                                                                        const visibleValues = valueOptions
                                                                                            .filter(v => !keyword || v.toLowerCase().includes(keyword))
                                                                                            .sort((a, b) => {
                                                                                                const ownerA = valueOwnerMap.get(a) || '';
                                                                                                const ownerB = valueOwnerMap.get(b) || '';
                                                                                                const weightA = ownerA === group.groupName ? 2 : ownerA ? 1 : 0;
                                                                                                const weightB = ownerB === group.groupName ? 2 : ownerB ? 1 : 0;
                                                                                                if (weightA !== weightB) return weightA - weightB;
                                                                                                return a.localeCompare(b);
                                                                                            });
                                                                                        const groupValueSet = new Set(group.values);
                                                                                        const collapsed = !!groupCollapsedRows[rowKey];
                                                                                        return (
                                                                                            <div key={`${group.groupName}_${idx}`} className="bg-white border border-purple-200 rounded p-2.5 space-y-2">
                                                                                                <div className="flex items-center gap-1.5">
                                                                                                    <input
                                                                                                        defaultValue={group.groupName}
                                                                                                        onBlur={(e) => {
                                                                                                            const newName = e.target.value.trim();
                                                                                                            if (newName && newName !== group.groupName) {
                                                                                                                renameGroupForColumn(col, group.groupName, newName);
                                                                                                            }
                                                                                                        }}
                                                                                                        onKeyDown={(e) => {
                                                                                                            if (e.key === 'Enter' && !e.nativeEvent.isComposing) (e.target as HTMLInputElement).blur();
                                                                                                        }}
                                                                                                        className="w-full min-w-0 px-2 py-1 border border-purple-200 rounded text-xs text-slate-800 bg-slate-50 hover:bg-white focus:bg-white focus:border-purple-400 focus:ring-1 focus:ring-purple-300 outline-none transition-colors"
                                                                                                    />
                                                                                                    <span className="text-xs text-purple-700 whitespace-nowrap">含 {group.values.length} 值</span>
                                                                                                    <div className="flex bg-slate-100 rounded mr-1">
                                                                                                        <button onClick={() => moveGroupRankForColumn(col, group.groupName, -1)} disabled={idx === 0} className={`p-1 rounded-l ${idx === 0 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-200'}`}><ArrowUp size={12} /></button>
                                                                                                        <button onClick={() => moveGroupRankForColumn(col, group.groupName, 1)} disabled={idx === groupRows.length - 1} className={`p-1 rounded-r border-l border-white ${idx === groupRows.length - 1 ? 'text-slate-300' : 'text-slate-600 hover:bg-slate-200'}`}><ArrowDown size={12} /></button>
                                                                                                    </div>
                                                                                                    <button
                                                                                                        onClick={() => toggleGroupRowCollapsed(rowKey)}
                                                                                                        className="text-xs px-2 py-1 bg-white border border-purple-300 text-purple-800 rounded hover:bg-purple-50 whitespace-nowrap"
                                                                                                    >
                                                                                                        {collapsed ? '展开' : '收起'}
                                                                                                    </button>
                                                                                                    <button
                                                                                                        onClick={() => clearGroupValuesForColumn(col, group.groupName)}
                                                                                                        className="text-xs px-2 py-1 bg-purple-100 text-purple-800 rounded hover:bg-purple-200 whitespace-nowrap"
                                                                                                    >
                                                                                                        清空值
                                                                                                    </button>
                                                                                                    <button
                                                                                                        onClick={() => removeGroupForColumn(col, group.groupName)}
                                                                                                        className="text-xs px-2 py-1 bg-white border border-red-300 text-red-600 rounded hover:bg-red-50 whitespace-nowrap"
                                                                                                    >
                                                                                                        删组
                                                                                                    </button>
                                                                                                </div>

                                                                                                {!collapsed && (
                                                                                                    <>
                                                                                                        {/* === Smart Rules (条件规则) === */}
                                                                                                        {(() => {
                                                                                                            const MATCH_MODE_LABELS: Record<GroupMatchMode, string> = {
                                                                                                                exact: '等于', contains: '包含', notContains: '不包含', startsWith: '开头是', endsWith: '结尾是',
                                                                                                                gt: '大于', gte: '≥ 大于等于', lt: '小于', lte: '≤ 小于等于',
                                                                                                                range: '范围', notEquals: '不等于', isEmpty: '为空', isNotEmpty: '非空', inList: '在列表中', regex: '正则'
                                                                                                            };
                                                                                                            const smartRulesForGroup = (subDimensionGroups[col]?.rules || []).filter(
                                                                                                                r => normalizeGroupText(r.groupName) === normalizeGroupText(group.groupName) && r.matchMode && r.matchMode !== 'exact'
                                                                                                            );
                                                                                                            const smartRuleKey = `smart_${rowKey}`;
                                                                                                            return (
                                                                                                                <div className="space-y-1.5 border border-blue-200 rounded p-2 bg-blue-50/50">
                                                                                                                    <div className="flex items-center justify-between">
                                                                                                                        <span className="text-[10px] font-medium text-blue-700">🧠 条件规则（自动匹配）</span>
                                                                                                                    </div>
                                                                                                                    {smartRulesForGroup.map((rule) => (
                                                                                                                        <div key={rule.id} className="flex items-center gap-1 text-[10px] bg-white rounded px-1.5 py-1 border border-blue-200">
                                                                                                                            <span className="px-1 py-0.5 bg-blue-100 text-blue-700 rounded font-medium">{MATCH_MODE_LABELS[rule.matchMode!]}</span>
                                                                                                                            <span className="text-slate-700 truncate max-w-[80px]" title={rule.source}>{rule.source}</span>
                                                                                                                            {rule.matchMode === 'range' && rule.source2 && (
                                                                                                                                <><span className="text-slate-400">~</span><span className="text-slate-700">{rule.source2}</span></>
                                                                                                                            )}
                                                                                                                            <button onClick={() => {
                                                                                                                                setSubDimensionGroups(prev => {
                                                                                                                                    const prevCfg = prev[col] || { enabled: true, rules: [] };
                                                                                                                                    return { ...prev, [col]: { ...prevCfg, rules: prevCfg.rules.filter(r => r.id !== rule.id) } };
                                                                                                                                });
                                                                                                                            }} className="ml-auto text-red-400 hover:text-red-600"><X size={10} /></button>
                                                                                                                        </div>
                                                                                                                    ))}
                                                                                                                    <div className="flex items-center gap-1 flex-wrap">
                                                                                                                        <select
                                                                                                                            id={`smart_mode_${smartRuleKey}`}
                                                                                                                            defaultValue="contains"
                                                                                                                            className="px-1 py-0.5 border border-blue-300 rounded text-[10px] bg-white text-slate-800"
                                                                                                                            onChange={(e) => {
                                                                                                                                const val2El = document.getElementById(`smart_val2_${smartRuleKey}`) as HTMLInputElement;
                                                                                                                                const valEl = document.getElementById(`smart_val_${smartRuleKey}`) as HTMLInputElement;
                                                                                                                                if (val2El) val2El.style.display = e.target.value === 'range' ? 'block' : 'none';
                                                                                                                                const noValueModes = ['isEmpty', 'isNotEmpty'];
                                                                                                                                if (valEl) {
                                                                                                                                    valEl.style.display = noValueModes.includes(e.target.value) ? 'none' : 'block';
                                                                                                                                    if (e.target.value === 'inList') valEl.placeholder = '值1,值2,值3';
                                                                                                                                    else valEl.placeholder = '值';
                                                                                                                                }
                                                                                                                            }}
                                                                                                                        >
                                                                                                                            {(Object.entries(MATCH_MODE_LABELS) as [GroupMatchMode, string][])
                                                                                                                                .filter(([k]) => k !== 'exact')
                                                                                                                                .map(([k, label]) => (
                                                                                                                                    <option key={k} value={k}>{label}</option>
                                                                                                                                ))
                                                                                                                            }
                                                                                                                        </select>
                                                                                                                        <input
                                                                                                                            id={`smart_val_${smartRuleKey}`}
                                                                                                                            className="flex-1 min-w-0 px-1.5 py-0.5 border border-blue-300 rounded text-[10px] bg-white text-slate-800"
                                                                                                                            placeholder="值"
                                                                                                                        />
                                                                                                                        <input
                                                                                                                            id={`smart_val2_${smartRuleKey}`}
                                                                                                                            className="w-14 px-1.5 py-0.5 border border-blue-300 rounded text-[10px] bg-white text-slate-800"
                                                                                                                            placeholder="上限"
                                                                                                                            style={{ display: 'none' }}
                                                                                                                        />
                                                                                                                        <button
                                                                                                                            onClick={() => {
                                                                                                                                const modeEl = document.getElementById(`smart_mode_${smartRuleKey}`) as HTMLSelectElement;
                                                                                                                                const valEl = document.getElementById(`smart_val_${smartRuleKey}`) as HTMLInputElement;
                                                                                                                                const val2El = document.getElementById(`smart_val2_${smartRuleKey}`) as HTMLInputElement;
                                                                                                                                if (!modeEl) return;
                                                                                                                                const mode = modeEl.value as GroupMatchMode;
                                                                                                                                const noValueModes = ['isEmpty', 'isNotEmpty'];
                                                                                                                                if (!noValueModes.includes(mode) && (!valEl || !valEl.value.trim())) return;
                                                                                                                                const newRule: SubDimensionGroupRule = {
                                                                                                                                    id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
                                                                                                                                    source: noValueModes.includes(mode) ? '' : valEl.value.trim(),
                                                                                                                                    source2: mode === 'range' ? val2El?.value.trim() : undefined,
                                                                                                                                    groupName: group.groupName,
                                                                                                                                    matchMode: mode
                                                                                                                                };
                                                                                                                                setSubDimensionGroups(prev => {
                                                                                                                                    const prevCfg = prev[col] || { enabled: true, rules: [] };
                                                                                                                                    return { ...prev, [col]: { ...prevCfg, rules: [...prevCfg.rules, newRule] } };
                                                                                                                                });
                                                                                                                                if (valEl) valEl.value = '';
                                                                                                                                if (val2El) val2El.value = '';
                                                                                                                            }}
                                                                                                                            className="text-[10px] px-1.5 py-0.5 bg-blue-600 text-white rounded hover:bg-blue-700 whitespace-nowrap"
                                                                                                                        >+ 添加</button>
                                                                                                                    </div>
                                                                                                                </div>
                                                                                                            );
                                                                                                        })()}

                                                                                                        {/* === Exact Match (精确值勾选) === */}
                                                                                                        <div className="flex items-center gap-1.5">
                                                                                                            <input
                                                                                                                value={groupRowSearch[rowKey] || ''}
                                                                                                                onChange={(e) => setGroupRowSearch(prev => ({ ...prev, [rowKey]: e.target.value }))}
                                                                                                                className="w-full min-w-0 px-2 py-1 border border-purple-300 rounded text-xs text-slate-800 bg-white"
                                                                                                                placeholder="搜索此组要包含的值..."
                                                                                                            />
                                                                                                            <button
                                                                                                                onClick={() => setValuesGroupForColumn(col, visibleValues, group.groupName)}
                                                                                                                className="text-xs px-2 py-1 bg-purple-600 text-white rounded hover:bg-purple-700 whitespace-nowrap"
                                                                                                            >
                                                                                                                全选筛选结果
                                                                                                            </button>
                                                                                                        </div>

                                                                                                <div className="max-h-36 overflow-y-auto space-y-1 border border-purple-200 rounded p-1.5 bg-purple-50/40">
                                                                                                    {visibleValues.map((v) => {
                                                                                                        const owner = valueOwnerMap.get(v) || '';
                                                                                                        const checked = owner === group.groupName;
                                                                                                        const selectedByOther = !!owner && owner !== group.groupName;
                                                                                                        return (
                                                                                                            <label key={v} className={`flex items-center gap-1.5 px-1.5 py-1 text-xs rounded cursor-pointer ${selectedByOther ? 'text-slate-400 bg-slate-50 hover:bg-slate-100' : 'text-purple-900 hover:bg-purple-100'}`}>
                                                                                                                <input
                                                                                                                    type="checkbox"
                                                                                                                    checked={checked}
                                                                                                                    onChange={() => setValueGroupForColumn(col, v, checked ? null : group.groupName)}
                                                                                                                    className="rounded text-purple-600 w-4 h-4"
                                                                                                                />
                                                                                                                <span className="truncate" title={v}>{v}</span>
                                                                                                                {selectedByOther && (
                                                                                                                    <span className="text-[10px] text-slate-400 ml-auto">{owner}</span>
                                                                                                                )}
                                                                                                            </label>
                                                                                                        );
                                                                                                    })}
                                                                                                </div>
                                                                                                    </>
                                                                                                )}
                                                                                            </div>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            );
                                                                        })()}
                                                                    </div>
        );
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

    const render1DPivotTable = () => {
        const tableData = processedData.tableData;
        const totalRows = tableData.length;
        if (totalRows === 0) {
            return (
                <div className="h-full flex flex-col items-center justify-center text-slate-400">
                    <Table2 size={48} className="mb-4 opacity-50" />
                    <p className="text-sm font-medium">暂无统计数据</p>
                </div>
            );
        }

        const wrapCols = !breakdownCol ? multiColumnWrap : 1;
        const rowsPerCol = Math.ceil(totalRows / wrapCols);

        const renderGroupHeader = (groupKey: number) => {
            return (
                <React.Fragment key={`h-${groupKey}`}>
                    <th className="px-4 py-3 text-left font-bold text-slate-700 bg-slate-100 border border-slate-200 sticky top-0 z-10">
                        {enableBinning ? '范围' : dimensionCol}
                    </th>
                    <th className="px-4 py-3 text-right font-bold text-slate-700 bg-slate-100 border border-slate-200 sticky top-0 z-10">
                        {metricCol || (aggregation === 'count' ? '数量' : '数值')}
                    </th>
                    {showPercentageInPivot && (
                        <th className="px-4 py-3 text-right font-bold text-slate-700 bg-slate-100 border border-slate-200 sticky top-0 z-10">
                            占比
                        </th>
                    )}
                </React.Fragment>
            );
        };

        const rows = [];
        for (let r = 0; r < rowsPerCol; r++) {
            const rowCells = [];
            for (let c = 0; c < wrapCols; c++) {
                const dataIdx = c * rowsPerCol + r;
                if (dataIdx < totalRows) {
                    const item = tableData[dataIdx];
                    rowCells.push(
                        <React.Fragment key={`c-${c}`}>
                            <td className="px-4 py-2 font-medium text-slate-700 border border-slate-200 truncate max-w-[150px]" title={item.name}>
                                {item.name}
                            </td>
                            <td className="px-4 py-2 text-right font-mono text-slate-900 border border-slate-200 tabular-nums">
                                {item.value.toLocaleString()}
                            </td>
                            {showPercentageInPivot && (
                                <td className="px-4 py-2 text-right text-slate-500 border border-slate-200 tabular-nums">
                                    {item.percentage}%
                                </td>
                            )}
                        </React.Fragment>
                    );
                } else {
                    rowCells.push(
                        <React.Fragment key={`c-${c}`}>
                            <td className="px-4 py-2 text-slate-300 border border-slate-200 italic select-none">/</td>
                            <td className="px-4 py-2 text-right text-slate-300 border border-slate-200 italic select-none">/</td>
                            {showPercentageInPivot && (
                                <td className="px-4 py-2 text-right text-slate-300 border border-slate-200 italic select-none">/</td>
                            )}
                        </React.Fragment>
                    );
                }
            }
            rows.push(
                <tr key={`r-${r}`} className={r % 2 === 0 ? 'bg-white hover:bg-slate-50' : 'bg-slate-50/50 hover:bg-slate-50'}>
                    {rowCells}
                </tr>
            );
        }

        const totalRowCells = [];
        totalRowCells.push(
            <React.Fragment key="tot-0">
                <td className="px-4 py-2 font-bold text-slate-700 bg-slate-100 border border-slate-200">
                    总计
                </td>
                <td className="px-4 py-2 text-right font-bold text-indigo-700 bg-indigo-50 border border-slate-200 tabular-nums">
                    {processedData.totalValue.toLocaleString()}
                </td>
                {showPercentageInPivot && (
                    <td className="px-4 py-2 text-right font-bold text-slate-700 bg-slate-100 border border-slate-200 tabular-nums">
                        100%
                    </td>
                )}
            </React.Fragment>
        );
        for (let c = 1; c < wrapCols; c++) {
            totalRowCells.push(
                <React.Fragment key={`tot-${c}`}>
                    <td className="px-4 py-2 bg-slate-100 border border-slate-200"></td>
                    <td className="px-4 py-2 text-right bg-slate-100 border border-slate-200"></td>
                    {showPercentageInPivot && (
                        <td className="px-4 py-2 text-right bg-slate-100 border border-slate-200"></td>
                    )}
                </React.Fragment>
            );
        }

        return (
            <div className="h-full overflow-auto">
                <table className="border-collapse text-sm w-full min-w-max">
                    <thead>
                        <tr>
                            {Array.from({ length: wrapCols }).map((_, c) => renderGroupHeader(c))}
                        </tr>
                    </thead>
                    <tbody>
                        {rows}
                        <tr className="bg-slate-100 font-semibold sticky bottom-0 z-10">
                            {totalRowCells}
                        </tr>
                    </tbody>
                </table>
            </div>
        );
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
                    <button data-tip="柱状图" onClick={() => setChartType('bar')} className={`p-2 rounded ${chartType === 'bar' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'} tooltip-bottom`}><BarChart3 size={20} /></button>
                    <button data-tip="条形图" onClick={() => setChartType('bar-horizontal')} className={`p-2 rounded ${chartType === 'bar-horizontal' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'} tooltip-bottom`}><BarChart3 className="rotate-90" size={20} /></button>
                    <button data-tip="折线图" onClick={() => setChartType('line')} className={`p-2 rounded ${chartType === 'line' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'} tooltip-bottom`}><LineChartIcon size={20} /></button>
                    <button data-tip="面积图" onClick={() => setChartType('area')} className={`p-2 rounded ${chartType === 'area' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'} tooltip-bottom`}><Activity size={20} /></button>
                    <button data-tip="饼图" onClick={() => setChartType('pie')} className={`p-2 rounded ${chartType === 'pie' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'} tooltip-bottom`}><PieChartIcon size={20} /></button>
                    <button data-tip="雷达图" onClick={() => setChartType('radar')} className={`p-2 rounded ${chartType === 'radar' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'} tooltip-bottom`}><Hexagon size={20} /></button>
                    <button data-tip="散点图" onClick={() => setChartType('scatter')} className={`p-2 rounded ${chartType === 'scatter' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'} tooltip-bottom`}><ScatterIcon size={20} /></button>
                    <button data-tip="漏斗图" onClick={() => setChartType('funnel')} className={`p-2 rounded ${chartType === 'funnel' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'} tooltip-bottom`}><FunnelIcon size={20} /></button>
                    <button data-tip="树形图" onClick={() => setChartType('treemap')} className={`p-2 rounded ${chartType === 'treemap' ? 'bg-blue-50 text-blue-600' : 'text-slate-400 hover:bg-slate-50'} tooltip-bottom`}><BoxSelect size={20} /></button>
                    <div className="w-px bg-slate-200 mx-1"></div>
                    <button data-tip="透视表" onClick={() => setChartType('pivot')} className={`p-2 rounded ${chartType === 'pivot' ? 'bg-indigo-50 text-indigo-600' : 'text-slate-400 hover:bg-slate-50'} tooltip-bottom`}><Table2 size={20} /></button>
                    <div className="w-px bg-slate-200 mx-1 tooltip-bottom"></div>
                    {/* 智能推荐按钮 */}
                    <button
                        data-tip="智能推荐"
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
            <div className="flex flex-col xl:flex-row gap-6">

                {/* Left: Settings */}
                <div className="w-full min-w-0 space-y-6 xl:w-[420px] xl:min-w-[340px] xl:max-w-[70vw] xl:shrink-0 xl:resize-x xl:overflow-x-auto">

                    {/* 1. Axes Configuration */}
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <Settings2 size={16} /> 数据维度与指标
                            </h3>
                            <div className="flex gap-1 tooltip-bottom">
                                <button
                                    onClick={exportPreset}
                                    data-tip="导出预设"
                                    className="text-[10px] px-2 py-1 bg-slate-100 text-slate-600 rounded hover:bg-slate-200 flex items-center gap-1"
                                >
                                    <Download size={12} className="inline mr-1 tooltip-bottom" /> 导出
                                </button>
                                <label
                                    data-tip="导入预设"
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
                                    <select value={scatterXCol} onChange={(e) => setScatterXCol(e.target.value)} className="w-full p-2 border border-slate-300 rounded text-sm text-slate-800 bg-white">
                                        <option value="">请选择数值列...</option>
                                        {data.columns.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                </div>
                            ) : (
                                <div>
                                    <div className="flex items-center justify-between mb-1 gap-2">
                                        <label className="text-xs font-bold text-slate-800 whitespace-nowrap shrink-0">主维度 (X轴)</label>
                                        <input type="text" placeholder="自定义显示名" value={customXLabel} onChange={e => setCustomXLabel(e.target.value)} className="w-[72px] min-w-0 px-1.5 py-[2px] text-[10px] border border-slate-200 rounded text-slate-600 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-slate-50" title="在图表上显示的自定义X轴名称" />
                                    </div>
                                    <select value={dimensionCol} onChange={(e) => setDimensionCol(e.target.value)} className="w-full p-2 border border-slate-300 rounded text-sm text-slate-800 bg-white">
                                        {data.columns.map(c => <option key={c} value={c}>{c}</option>)}
                                    </select>
                                    <div className="mt-2">
                                        <label className="block text-xs font-medium text-slate-500 mb-1">字段数据分组 (可选)</label>
                                        <select
                                            value={
                                                enableRowBinning ? 'binning' : (dimensionCol && subDimensionGroups[dimensionCol]?.enabled ? 'mapping' : 'none')
                                            }
                                            onChange={(e) => {
                                                const val = e.target.value;
                                                if (val === 'none') {
                                                    setEnableRowBinning(false);
                                                    if (dimensionCol) {
                                                        setSubDimensionGroups(prev => ({
                                                            ...prev,
                                                            [dimensionCol]: { enabled: false, rules: prev[dimensionCol]?.rules || [] }
                                                        }));
                                                    }
                                                } else if (val === 'binning') {
                                                    setEnableRowBinning(true);
                                                    if (dimensionCol) {
                                                        setSubDimensionGroups(prev => ({
                                                            ...prev,
                                                            [dimensionCol]: { enabled: false, rules: prev[dimensionCol]?.rules || [] }
                                                        }));
                                                    }
                                                } else if (val === 'mapping') {
                                                    setEnableRowBinning(false);
                                                    if (dimensionCol) {
                                                        setSubDimensionGroups(prev => ({
                                                            ...prev,
                                                            [dimensionCol]: { enabled: true, rules: prev[dimensionCol]?.rules || [] }
                                                        }));
                                                    }
                                                }
                                            }}
                                            className="w-full p-1.5 border border-slate-300 rounded text-xs text-slate-800 bg-white"
                                        >
                                            <option value="none">不进行处理 (默认)</option>
                                            <option value="mapping">文本归类映射 (分组重命名)</option>
                                            <option value="binning">数值区间分箱 (按数值分段)</option>
                                        </select>
                                    </div>

                                    {dimensionCol && subDimensionGroups[dimensionCol]?.enabled && renderCustomGroupingBlock(dimensionCol, true)}

                                    <div className="mt-2">
                                        <label className="block text-xs font-medium text-slate-500 mb-1">坐标轴标签显示</label>
                                        <select
                                            value={xTickDisplayField}
                                            onChange={(e) => setXTickDisplayField(e.target.value)}
                                            className="w-full p-1.5 border border-slate-300 rounded text-xs text-slate-800 bg-white"
                                        >
                                            <option value="all">显示组合名称（默认）</option>
                                            <option value="dimension">仅显示主字段：{dimensionCol || '主字段'}</option>
                                            {(subDimensionCol ? subDimensionCol.split(':::').filter(Boolean) : []).map((c) => (
                                                <option key={c} value={`sub:${c}`}>仅显示副字段：{c}</option>
                                            ))}
                                        </select>
                                    </div>

                                    {isAnyDateSelected && (
                                        <div className="mt-2 p-2 bg-sky-50 rounded-lg border border-sky-100 space-y-2">
                                            <div className="flex items-center gap-1">
                                                {[
                                                    { value: 'day' as const, label: '天' },
                                                    { value: 'week' as const, label: '周' },
                                                    { value: 'month' as const, label: '月' },
                                                    { value: 'quarter' as const, label: '季' },
                                                    { value: 'year' as const, label: '年' },
                                                ].map(opt => (
                                                    <button
                                                        key={opt.value}
                                                        onClick={() => setDateGranularity(opt.value)}
                                                        className={`flex-1 py-1 text-[11px] rounded font-medium transition-all ${dateGranularity === opt.value
                                                            ? 'bg-sky-600 text-white shadow-sm'
                                                            : 'text-sky-700 hover:bg-sky-100'
                                                        }`}
                                                    >
                                                        {opt.label}
                                                    </button>
                                                ))}
                                            </div>
                                            <div className="flex items-center justify-between">
                                                <label className="flex items-center gap-1.5 cursor-pointer">
                                                    <input type="checkbox" checked={showYearInDate} onChange={(e) => setShowYearInDate(e.target.checked)} className="rounded text-sky-600 w-3 h-3" />
                                                    <span className="text-[10px] text-sky-600">显示年份</span>
                                                </label>
                                                {(dateGranularity === 'month' || dateGranularity === 'quarter') && (
                                                    <div className="flex items-center gap-1">
                                                        <span className="text-[10px] text-sky-500">每月</span>
                                                        <select
                                                            value={monthStartDay}
                                                            onChange={(e) => setMonthStartDay(parseInt(e.target.value))}
                                                            className="text-[11px] py-0.5 px-1 border border-sky-200 rounded bg-white text-sky-800 w-12"
                                                        >
                                                            {Array.from({length: 28}, (_, i) => i + 1).map((d: any) => (
                                                                <option key={d} value={d}>{d}号</option>
                                                            ))}
                                                        </select>
                                                        <span className="text-[10px] text-sky-500">起算</span>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    )}



                                    {/* Row Binning Settings */}
                                    {enableRowBinning && (
                                        <div className="mt-3 p-3 bg-blue-50 rounded-lg border border-blue-100 space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-xs font-medium text-blue-700">数据分箱设置</span>
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

                            {/* X Sort Order */}
                            {chartType !== 'scatter' && (
                                <div className="mt-4">
                                    <div className="flex justify-between items-center mb-1">
                                        <label className="text-xs font-bold text-slate-800 flex items-center gap-1"><ArrowUpDown size={12} /> X轴排序规则</label>
                                    </div>
                                    <select 
                                        value={xSortMode}
                                        onChange={(e) => {
                                            setXSortMode(e.target.value as any);
                                            if (e.target.value === 'manual' && xManualOrder.length === 0) {
                                                setXManualOrder(processedData.tableData.map((d: any) => d.name).filter(n => n && !n.startsWith('其他')));
                                            }
                                        }}
                                        className="w-full p-1.5 border border-slate-200 rounded text-xs text-slate-700 bg-slate-50 outline-none focus:border-indigo-300"
                                    >
                                        <option value="default">默认 (按字段名/跟随数据表)</option>
                                        <option value="desc">按当前指标降序 (从大到小)</option>
                                        <option value="asc">按当前指标升序 (从小到大)</option>
                                        <option value="manual">自定义手动拖拽</option>
                                    </select>
                                    {xSortMode === 'manual' && (
                                        <DraggableList items={xManualOrder} setItems={setXManualOrder} label="X轴项" />
                                    )}
                                </div>
                            )}

                            {/* Secondary Fields (Unified Free UI) */}
                            {chartType !== 'scatter' && (() => {
                                const bCols = breakdownCol ? breakdownCol.split(':::') : [];
                                const sCols = subDimensionCol ? subDimensionCol.split(':::') : [];
                                const allSecCols = Array.from(new Set([...bCols, ...sCols]));

                                return (
                                    <div className="space-y-3 relative mt-6 pt-4 border-t border-slate-200">
                                        <div className="absolute -top-3 right-0 z-10">
                                            {allSecCols.length > 0 && (
                                                <button
                                                    title="快捷对换：将主 X 轴字段与当前首个副字段交换"
                                                    onClick={() => {
                                                        const currentMain = dimensionCol;
                                                        const targetSec = allSecCols[0];
                                                        
                                                        setDimensionCol(targetSec);
                                                        
                                                        const newBCols = bCols.map(c => c === targetSec ? currentMain : c);
                                                        const newSCols = sCols.map(c => c === targetSec ? currentMain : c);
                                                        
                                                        setBreakdownCol(newBCols.join(':::'));
                                                        setSubDimensionCol(newSCols.join(':::'));
                                                    }}
                                                    className="flex items-center justify-center p-1.5 bg-white border border-indigo-200 text-indigo-400 hover:text-indigo-600 hover:bg-indigo-50 rounded shadow-sm transition-all text-[10px] gap-1"
                                                >
                                                    <ArrowUpDown size={12} /> <span className="font-medium">主副对换</span>
                                                </button>
                                            )}
                                        </div>

                                        <div>
                                            <label className="block text-xs font-bold text-slate-800 mb-2 flex items-center gap-1">
                                                <Layers size={13} className="text-indigo-500" /> 拆分维度 (副X轴/细分)
                                            </label>

                                            <div className="mb-2">
                                                <select 
                                                    value="" 
                                                    onChange={(e) => {
                                                        const val = e.target.value;
                                                        if (val && !allSecCols.includes(val)) {
                                                            const newBCols = breakdownCol ? breakdownCol.split(':::') : [];
                                                            setBreakdownCol([...newBCols, val].join(':::'));
                                                        }
                                                    }}
                                                    className="w-full p-2 border border-indigo-200 border-dashed rounded text-sm text-indigo-600 bg-indigo-50/50 outline-none hover:bg-indigo-50 cursor-pointer"
                                                >
                                                    <option value="">+ 添加拆分维度...</option>
                                                    {data.columns.filter((c: string) => c !== dimensionCol && !allSecCols.includes(c)).map((c: string) => (
                                                        <option key={c} value={c}>{c}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            
                                            <div className="flex flex-col gap-2">
                                                {allSecCols.map(col => {
                                                    const isColor = bCols.includes(col);
                                                    const isText = sCols.includes(col);
                                                    
                                                    return (
                                                        <div key={col} className="border border-indigo-100 rounded p-2.5 bg-indigo-50/30">
                                                            <div className="flex items-center justify-between mb-1.5">
                                                                <span className="font-bold text-xs text-indigo-800 bg-indigo-100 px-1.5 py-0.5 rounded">{col}</span>
                                                                <button 
                                                                    onClick={() => {
                                                                        setBreakdownCol(bCols.filter(c => c !== col).join(':::'));
                                                                        setSubDimensionCol(sCols.filter(c => c !== col).join(':::'));
                                                                    }}
                                                                    className="text-slate-400 hover:text-red-500"
                                                                >
                                                                    <X size={12} />
                                                                </button>
                                                            </div>
                                                            <div className="flex flex-col gap-1.5 pl-1">
                                                                <label className={"text-xs flex items-center gap-1.5 cursor-pointer select-none " + (isColor ? "text-slate-800 font-medium" : "text-slate-500")}>
                                                                    <input 
                                                                        type="checkbox" 
                                                                        checked={isColor} 
                                                                        onChange={(e) => {
                                                                            if (e.target.checked) setBreakdownCol([...bCols, col].join(':::'));
                                                                            else setBreakdownCol(bCols.filter(c => c !== col).join(':::'));
                                                                        }}
                                                                        className="rounded text-indigo-500"
                                                                    />
                                                                    分类维度 (颜色/图例)
                                                                </label>
                                                                {isColor && (
                                                                    <div className="pl-5 mt-1 flex items-center gap-2">
                                                                        <span className="text-xs text-slate-600 shrink-0">📊 排列方式:</span>
                                                                        <select
                                                                            value={bColGroupModes[col] || 'grouped'}
                                                                            onChange={(e) => setBColGroupModes({...bColGroupModes, [col]: e.target.value as any})}
                                                                            className="flex-1 min-w-0 p-1 border border-indigo-200 rounded text-xs bg-white text-indigo-700 outline-none"
                                                                        >
                                                                            <option value="stacked">堆叠 (Stacked)</option>
                                                                            <option value="grouped">独立分组 (并排)</option>
                                                                        </select>
                                                                    </div>
                                                                )}
                                                                <label className={"text-xs flex items-center gap-1.5 cursor-pointer select-none " + (isText ? "text-slate-800 font-medium" : "text-slate-500")}>
                                                                    <input 
                                                                        type="checkbox" 
                                                                        checked={isText} 
                                                                        onChange={(e) => {
                                                                            if (e.target.checked) setSubDimensionCol([...sCols, col].join(':::'));
                                                                            else setSubDimensionCol(sCols.filter(c => c !== col).join(':::'));
                                                                        }}
                                                                        className="rounded text-indigo-500"
                                                                    />
                                                                    子维度 (拼接至X轴)
                                                                </label>

                                                                {renderCustomGroupingBlock(col, false)}
                                                                
                                                                {/* Per-column Binning Configuration */}
                                                                <div className="pl-5 mt-2">
                                                                    <div className="flex items-center gap-2">
                                                                        <input 
                                                                            type="checkbox" 
                                                                            checked={!!perColBins[col]?.enabled}
                                                                            onChange={(e) => setPerColBins(prev => ({...prev, [col]: {...(prev[col] || { bins: [] }), enabled: e.target.checked}}))}
                                                                            className="rounded text-indigo-500 w-3 h-3"
                                                                        />
                                                                        <span className="text-[10px] text-slate-500">仅对此字段启用分段</span>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    </div>
                                );
                            })()}

                            {/* Default Primary Y-Axis */}
                            <div className="pt-6 mt-4 border-t-2 border-slate-200">
                                <div className="flex items-center justify-between mb-1 gap-2">
                                    <label className="text-sm font-bold text-slate-800 flex items-center gap-1 whitespace-nowrap shrink-0">主指标 (左Y轴)</label>
                                    <input type="text" placeholder="自定义显示名" value={customYLabel} onChange={e => setCustomYLabel(e.target.value)} className="w-[72px] min-w-0 px-1.5 py-[2px] text-[10px] border border-slate-200 rounded text-slate-600 focus:outline-none focus:border-indigo-400 focus:ring-1 focus:ring-indigo-400 bg-slate-50" title="在图表上显示的自定义Y轴名称" />
                                </div>
                                <select value={metricCol} onChange={(e) => setMetricCol(e.target.value)} className="w-full p-2 border border-slate-300 rounded text-sm text-slate-800 bg-white">
                                    {data.columns.map((c: string) => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>

                            {chartType !== 'scatter' && (
                                <div className="mt-2">
                                    <label className="block text-xs font-medium text-slate-500 mb-1">计算规则 (聚合)</label>
                                    <div className="flex bg-slate-100 p-1 rounded">
                                        <button onClick={() => setAggregation('count')} className={`flex-1 py-1 text-xs rounded ${aggregation === 'count' ? 'bg-white shadow text-slate-800 font-medium' : 'text-slate-500 hover:bg-slate-200'}`}>计数</button>
                                        <button onClick={() => setAggregation('sum')} className={`flex-1 py-1 text-xs rounded ${aggregation === 'sum' ? 'bg-white shadow text-slate-800 font-medium' : 'text-slate-500 hover:bg-slate-200'}`}>求和</button>
                                        <button onClick={() => setAggregation('avg')} className={`flex-1 py-1 text-xs rounded ${aggregation === 'avg' ? 'bg-white shadow text-slate-800 font-medium' : 'text-slate-500 hover:bg-slate-200'}`}>平均</button>
                                    </div>
                                </div>
                            )}
                            {/* Secondary Y-Axis */}
                            <div className="mt-4 pt-4 border-t border-slate-200">
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs font-bold text-amber-600 flex items-center gap-1"><Layers size={12}/> 副指标 (右Y轴)</label>
                                </div>
                                <select value={secondaryMetricCol} onChange={(e) => setSecondaryMetricCol(e.target.value)} className="w-full p-2 border border-amber-200 rounded text-sm text-slate-800 bg-amber-50 outline-none">
                                    <option value="">(不使用副轴)</option>
                                    {data.columns.map(c => <option key={c} value={c}>{c}</option>)}
                                </select>
                            </div>

                            {secondaryMetricCol && (
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">副轴计算规则 (聚合)</label>
                                    <div className="flex bg-amber-100 p-1 rounded">
                                        <button onClick={() => setSecondaryAggregation('count')} className={`flex-1 py-1 text-xs rounded ${secondaryAggregation === 'count' ? 'bg-white shadow text-amber-600' : 'text-slate-500'}`}>计数</button>
                                        <button onClick={() => setSecondaryAggregation('sum')} className={`flex-1 py-1 text-xs rounded ${secondaryAggregation === 'sum' ? 'bg-white shadow text-amber-600' : 'text-slate-500'}`}>求和</button>
                                        <button onClick={() => setSecondaryAggregation('avg')} className={`flex-1 py-1 text-xs rounded ${secondaryAggregation === 'avg' ? 'bg-white shadow text-amber-600' : 'text-slate-500'}`}>平均</button>
                                    </div>
                                </div>
                            )}

                            <div>


                                    {/* 堆叠/分组排序 */}
                                    {processedData.breakdownKeys.length > 0 && (
                                        <div>
                                            <label className="block text-[10px] text-slate-500 mb-1">副字段排序</label>
                                            <select 
                                                value={stackSortMode}
                                                onChange={(e) => {
                                                    setStackSortMode(e.target.value as any);
                                                    if (e.target.value === 'manual' && stackManualOrder.length === 0) {
                                                        // 初始化预设
                                                        setStackManualOrder([...processedData.breakdownKeys].filter(k => k !== '其他'));
                                                    }
                                                }}
                                                className="w-full p-1.5 border border-slate-200 rounded text-xs text-slate-700 bg-slate-50 outline-none focus:border-indigo-300"
                                            >
                                                <option value="default">默认 (字母顺序/预设分段)</option>
                                                <option value="desc">按总和数据降序 (从大到小)</option>
                                                <option value="asc">按总和数据升序 (从小到大)</option>
                                                <option value="manual">自定义手动拖拽</option>
                                            </select>
                                            {stackSortMode === 'manual' && (
                                                <DraggableList items={stackManualOrder} setItems={setStackManualOrder} label="分色组" />
                                            )}
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>

                    {chartType === 'pivot' && (
                        <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm space-y-4">
                            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2">
                                <Table2 size={16} className="text-indigo-600" /> 表格排版配置
                            </h3>
                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">分栏展示列数 (并排数)</label>
                                <select
                                    value={multiColumnWrap}
                                    onChange={(e) => setMultiColumnWrap(parseInt(e.target.value))}
                                    className="w-full p-2 border border-slate-300 rounded text-xs text-slate-800 bg-white"
                                >
                                    <option value={1}>1 栏 (默认单列)</option>
                                    <option value={2}>2 栏并排</option>
                                    <option value={3}>3 栏并排</option>
                                    <option value={4}>4 栏并排</option>
                                    <option value={5}>5 栏并排</option>
                                    <option value={6}>6 栏并排</option>
                                </select>
                                <p className="text-[10px] text-slate-400 mt-1">仅在未设置"拆分维度"时，单维度列表生效</p>
                            </div>
                            {!breakdownCol && (
                                <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                                    <input
                                        type="checkbox"
                                        checked={showPercentageInPivot}
                                        onChange={(e) => setShowPercentageInPivot(e.target.checked)}
                                        className="rounded text-blue-600"
                                    />
                                    <span className="text-slate-700 font-medium">显示占比列 (Percentage)</span>
                                </label>
                            )}
                        </div>
                    )}


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

                    {/* Advanced Settings */}
                    <div className="bg-white p-4 rounded-xl border border-slate-200 shadow-sm">
                        <div className="flex justify-between items-center mb-4">
                            <h3 className="text-sm font-bold text-slate-700 flex items-center gap-2"><Settings2 size={16} /> 高级配置</h3>
                        </div>

                        <div className="space-y-4">
                            <label className="flex items-center gap-2 cursor-pointer select-none text-xs">
                                <input type="checkbox" checked={showValues} onChange={(e) => setShowValues(e.target.checked)} className="rounded text-blue-600" />
                                <span className="text-slate-700 font-medium">在图表上显示具体数值标签</span>
                            </label>

                            {processedData.breakdownKeys.length > 0 && (
                                <div>
                                    <label className="block text-xs font-medium text-slate-500 mb-1">多维度展示模式</label>
                                    <select value={chartDisplayMode} onChange={(e) => setChartDisplayMode(e.target.value as any)} className="w-full p-2 border border-slate-300 rounded text-xs text-slate-800 bg-white">
                                        <option value="total">标准图表 (合并视图)</option>
                                        <option value="faceted">分面网格视图 (图表墙)</option>
                                    </select>
                                </div>
                            )}

                            <div>
                                <label className="block text-xs font-medium text-slate-500 mb-1">最大显示项数 (Top N)</label>
                                <input type="number" min="1" max="500" value={maxItems} onChange={(e) => setMaxItems(parseInt(e.target.value) || 20)} className="w-full p-2 border border-slate-300 rounded text-xs text-slate-800 bg-white" />
                                <p className="text-[10px] text-slate-400 mt-1">超出部分将自动合并为"其他"</p>
                            </div>
                        </div>
                    </div>

                </div>

                {/* Right: Charts & Data */}
                <div className="flex-1 min-w-0 space-y-6">

                    {/* 1. Main Chart Editor */}
                    <div className="bg-white p-6 rounded-xl border border-slate-200 shadow-sm h-[500px] flex flex-col relative">
                        {/* 🗣 自然语言面包屑 - 实时解读当前图表配置 */}
                        <div className="px-3 py-2 mb-3 bg-gradient-to-r from-blue-50 to-indigo-50 border border-blue-100 rounded-lg">
                            <p className="text-xs text-blue-800 flex items-center gap-1.5 flex-wrap">
                                <Target size={12} className="text-blue-500 shrink-0" />
                                <span>📊 按</span>
                                <span className="font-bold text-blue-700 bg-blue-100 px-1.5 py-0.5 rounded">{enableBinning ? `${dimensionCol} (分段)` : dateColumnsSet.has(dimensionCol) && dateGranularity !== 'day' ? `${dimensionCol} (${dateGranularity === 'week' ? '按周' : dateGranularity === 'month' ? '按月' : dateGranularity === 'quarter' ? '按季' : '按年'})` : dimensionCol || '未选择'}</span>
                                <span>{aggregation === 'count' ? '统计数量' : aggregation === 'sum' ? `求和 ${metricCol || ''}` : `求平均 ${metricCol || ''}`}</span>
                                {breakdownCol && (<>
                                    <span>，按</span>
                                    <span className="font-bold text-indigo-700 bg-indigo-100 px-1.5 py-0.5 rounded">{breakdownCol}</span>
                                    <span>拆分颜色</span>
                                </>)}
                                {subDimensionCol && (<>
                                    <span>，二级维度</span>
                                    <span className="font-bold text-purple-700 bg-purple-100 px-1.5 py-0.5 rounded">{subDimensionCol}</span>
                                </>)}
                                {filters.length > 0 && (
                                    <span className="text-amber-700">，已过滤 {filters.length} 条规则</span>
                                )}
                                <span className="text-slate-400 ml-1">| {processedData.chartData.length} 项 · 总计 {processedData.totalValue.toLocaleString()}</span>
                            </p>
                        </div>
                        <div className="flex justify-between items-center mb-3">
                            <div className="flex items-center gap-3">
                                {isProcessing && <Loader2 size={14} className="animate-spin text-blue-500" />}
                                {data.rows.length > 5000 && <span className="text-xs text-amber-500 flex items-center gap-1 bg-amber-50 px-2 py-1 rounded"><AlertTriangle size={12} /> 大数据集</span>}
                            </div>
                            <div className="flex items-center gap-2">
                                {/* 智能推荐入口按钮 */}
                                {recommendations.length > 0 && (
                                    <button
                                        onClick={() => setShowRecommendations(!showRecommendations)}
                                        className={`text-xs px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors ${showRecommendations ? 'bg-violet-100 text-violet-700' : 'bg-violet-50 text-violet-600 hover:bg-violet-100'}`}
                                    >
                                        <Sparkles size={14} /> 推荐 ({recommendations.length})
                                    </button>
                                )}
                                {chartType === 'pivot' && (
                                    <button
                                        onClick={handleCopyPivotData}
                                        className="text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors border border-indigo-200"
                                    >
                                        {pivotCopied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                                        {pivotCopied ? '已复制数据' : '复制表格数据'}
                                    </button>
                                )}
                                <button
                                    onClick={handleCopyChartImage}
                                    disabled={copyingChart}
                                    className="text-xs bg-indigo-50 text-indigo-700 hover:bg-indigo-100 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors border border-indigo-200 disabled:opacity-60"
                                >
                                    {copyingChart ? <Loader2 size={14} className="animate-spin" /> : chartCopied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                                    {copyingChart ? '复制中...' : chartCopied ? '已复制图片' : '复制图表图'}
                                </button>
                                <button
                                    onClick={handleAddToSnapshot}
                                    className="text-xs bg-blue-600 text-white hover:bg-blue-700 px-3 py-1.5 rounded-lg flex items-center gap-1 transition-colors shadow-sm shadow-blue-200"
                                >
                                    <Pin size={14} /> 添加到报告
                                </button>
                            </div>
                        </div>
                        {/* 智能推荐浮层 */}
                        {showRecommendations && recommendations.length > 0 && (
                            <div className="mb-3 grid grid-cols-2 lg:grid-cols-3 gap-2">
                                {recommendations.slice(0, 6).map(rec => (
                                    <button
                                        key={rec.id}
                                        onClick={() => applyRecommendation(rec)}
                                        className="group p-2.5 bg-violet-50 hover:bg-violet-100 border border-violet-200 hover:border-violet-400 rounded-lg text-left transition-all text-xs"
                                    >
                                        <p className="font-medium text-slate-700 group-hover:text-violet-700 truncate">{rec.title}</p>
                                        <p className="text-[10px] text-slate-400 mt-0.5 truncate">{rec.description}</p>
                                    </button>
                                ))}
                            </div>
                        )}
                        <div ref={chartCaptureRef} className="flex-1 w-full min-h-0 overflow-hidden relative bg-white">
                            {chartType === 'pivot' ? (
                                /* Pivot Table View */
                                <div className="h-full">
                                    {!breakdownCol ? (
                                        render1DPivotTable()
                                    ) : (
                                        <table className="border-collapse text-sm w-full">
                                            <thead>
                                                <tr>
                                                    <th className="px-4 py-3 text-left font-bold text-slate-700 bg-slate-100 border border-slate-200 sticky left-0 z-10">
                                                        {enableBinning ? '范围' : dimensionCol}
                                                    </th>
                                                    {processedData.breakdownKeys.map((key: string) => (
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
                                                {processedData.tableData.slice(0, 100).map((item: any, idx: number) => (
                                                    <tr key={idx} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                                        <td className="px-4 py-2 font-medium text-slate-700 border border-slate-200 sticky left-0 bg-inherit whitespace-nowrap">
                                                            {item.name}
                                                        </td>
                                                        {processedData.breakdownKeys.map((key: string) => (
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
                                                    {processedData.breakdownKeys.map((key: string) => {
                                                        const colTotal = processedData.tableData.reduce((sum: number, item: any) => sum + (item[key] || 0), 0);
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
                                <div className="h-full grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 overflow-y-auto p-2 pb-8">
                                    {processedData.breakdownKeys.map((key: string) => {
                                        // Create data for this specific breakdown
                                        let facetData = processedData.tableData.map((item: any) => ({
                                            name: item.name,
                                            value: (item as any)[key] || 0,
                                            percentage: 0
                                        })).filter((d: any) => d.value > 0);

                                        const facetTotal = facetData.reduce((s: number, d: any) => s + d.value, 0);
                                        facetData.forEach((d: any) => d.percentage = facetTotal > 0 ? parseFloat(((d.value / facetTotal) * 100).toFixed(1)) : 0);

                                        // Sort by value and take top 6 for pie charts to avoid label overlap
                                        facetData = facetData.sort((a: any, b: any) => b.value - a.value);
                                        const displayData = facetData.length > 6 ? [
                                            ...facetData.slice(0, 5),
                                            {
                                                name: `其他(${facetData.length - 5}项)`,
                                                value: facetData.slice(5).reduce((s: number, d: any) => s + d.value, 0),
                                                percentage: facetData.slice(5).reduce((s: number, d: any) => s + d.percentage, 0)
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
                                                        metricLabel={customYLabel || key}
                                                        xAxisLabel={customXLabel || (enableBinning ? '范围区间' : dimensionCol)}
                                                        isStacked={false}
                                                        showValues={false}
                                                        stackIdMapping={stackIdMapping}
                                                        xTickFormatter={formatXAxisTick}
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
                                        /* Total/Default View */
                                <GenericChart
                                    type={chartType}
                                    data={processedData.chartData}
                                    breakdownKeys={processedData.breakdownKeys}
                                    aggregation={aggregation}
                                    metricLabel={customYLabel || metricCol}
                                    secondaryMetricLabel={secondaryMetricCol ? `${secondaryMetricCol} (${secondaryAggregation})` : undefined}
                                    xAxisLabel={customXLabel || (enableBinning ? '范围区间' : dimensionCol)}
                                    isStacked={processedData.breakdownKeys.length > 0 && ['bar', 'bar-horizontal', 'area', 'line'].includes(chartType)}
                                    showValues={showValues}
                                    stackIdMapping={stackIdMapping}
                                    xTickFormatter={formatXAxisTick}
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
                        <div className="overflow-hidden flex-1">
                            <table className="w-full text-sm text-left border-collapse">
                                <thead className="bg-slate-100 text-xs uppercase text-slate-500 sticky top-0 z-10">
                                    <tr>
                                        <th className="px-4 py-3 cursor-pointer hover:bg-slate-200 border-b" onClick={() => setSortConfig({ key: 'name', direction: sortConfig.key === 'name' && sortConfig.direction === 'asc' ? 'desc' : 'asc' })}>
                                            {enableBinning ? '范围' : dimensionCol} {sortConfig.key === 'name' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                        </th>
                                        <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 border-b" onClick={() => setSortConfig({ key: 'value', direction: sortConfig.key === 'value' && sortConfig.direction === 'desc' ? 'asc' : 'desc' })}>
                                            总{aggregation === 'count' ? '数量' : '数值'} {sortConfig.key === 'value' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                        </th>
                                        <th className="px-4 py-3 text-right cursor-pointer hover:bg-slate-200 border-b" onClick={() => setSortConfig({ key: 'percentage', direction: sortConfig.key === 'percentage' && sortConfig.direction === 'desc' ? 'asc' : 'desc' })}>
                                            占比 {sortConfig.key === 'percentage' && (sortConfig.direction === 'asc' ? '↑' : '↓')}
                                        </th>

                                        {/* Dynamic Headers for Breakdown - Clickable for Sorting */}
                                        {processedData.breakdownKeys.map((k: string) => (
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
                                    {processedData.tableData.slice(0, 200).map((item: any, idx: number) => (
                                        <tr key={idx} className="hover:bg-slate-50">
                                            <td className="px-4 py-2 font-medium text-slate-700 truncate max-w-[200px]" title={item.name}>{item.name}</td>
                                            <td className="px-4 py-2 text-right font-mono text-slate-900 font-bold bg-slate-50/50">{item.value.toLocaleString()}</td>
                                            <td className="px-4 py-2 text-right text-slate-400">{item.percentage}%</td>

                                            {/* Dynamic Cells for Breakdown */}
                                            {processedData.breakdownKeys.map((k: string) => (
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
                                        {processedData.breakdownKeys.map((k: string) => <td key={k} className="px-4 py-3"></td>)}
                                    </tr>
                                </tfoot>
                            </table>
                        </div>
                    </div>

                </div>
            </div>
        </div>
    );
};

Dashboard.displayName = 'Dashboard';

export default memo(Dashboard);
