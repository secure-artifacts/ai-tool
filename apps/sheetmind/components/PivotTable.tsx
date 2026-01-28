import React, { useMemo, useState } from 'react';
import { SheetData, DataRow } from '../types';
import {
    Table2, Settings2, Plus, X, Copy, Check, Download,
    ChevronDown, Layers, Filter, Hash, Calendar
} from 'lucide-react';

interface PivotTableProps {
    data: SheetData;
}

interface BinRange {
    id: string;
    label: string;
    min: number;
    max: number;
}

interface PivotConfig {
    rowField: string;
    columnField: string;
    valueField: string;
    aggregation: 'count' | 'sum' | 'avg';
    columnBins: BinRange[];
    useColumnBins: boolean;
    showRowTotals: boolean;
    showColumnTotals: boolean;
}

const PivotTable: React.FC<PivotTableProps> = ({ data }) => {
    const [config, setConfig] = useState<PivotConfig>({
        rowField: '',
        columnField: '',
        valueField: '',
        aggregation: 'count',
        columnBins: [],
        useColumnBins: false,
        showRowTotals: true,
        showColumnTotals: true,
    });

    const [copied, setCopied] = useState(false);
    const [showSettings, setShowSettings] = useState(true);

    // Get numeric columns for binning
    const numericColumns = useMemo(() => {
        if (data.rows.length === 0) return [];
        return data.columns.filter(col => {
            const sampleValues = data.rows.slice(0, 20).map(r => r[col]);
            const numericCount = sampleValues.filter(v => !isNaN(Number(v)) && v !== '' && v !== null).length;
            return numericCount > sampleValues.length * 0.5;
        });
    }, [data]);

    // Auto-generate bins for a numeric column
    const handleAutoBin = () => {
        if (!config.columnField || !numericColumns.includes(config.columnField)) return;

        const values = data.rows
            .map(r => Number(r[config.columnField]))
            .filter(v => !isNaN(v));

        if (values.length === 0) return;

        const minVal = Math.min(...values);
        const maxVal = Math.max(...values);
        const range = maxVal - minVal;

        // Create smarter bins based on data range
        const bins: BinRange[] = [];
        let numBins = 4;

        // Calculate nice round step values
        const rawStep = range / numBins;
        let step: number;

        if (rawStep <= 10) {
            step = Math.ceil(rawStep / 5) * 5; // Round to 5
        } else if (rawStep <= 100) {
            step = Math.ceil(rawStep / 10) * 10; // Round to 10
        } else if (rawStep <= 1000) {
            step = Math.ceil(rawStep / 100) * 100; // Round to 100
        } else if (rawStep <= 10000) {
            step = Math.ceil(rawStep / 500) * 500; // Round to 500
        } else {
            step = Math.ceil(rawStep / 1000) * 1000; // Round to 1000
        }

        // Round the minimum to a nice starting point
        let startMin = Math.floor(minVal / step) * step;
        if (startMin < 0 && minVal >= 0) startMin = 0;

        for (let i = 0; i < numBins; i++) {
            const binMin = startMin + i * step;
            const binMax = startMin + (i + 1) * step;
            const isLast = i === numBins - 1;

            bins.push({
                id: `bin-${i}`,
                label: isLast ? `${binMin}+` : `${binMin}-${binMax}`,
                min: binMin,
                max: isLast ? Infinity : binMax,
            });
        }

        setConfig(prev => ({ ...prev, columnBins: bins, useColumnBins: true }));
    };

    // Quick presets for common use cases
    const applyPreset = (presetType: 'comments' | 'percentage' | 'custom') => {
        let bins: BinRange[] = [];

        if (presetType === 'comments') {
            // For comment counts like "爆贴" and "大爆贴"
            bins = [
                { id: 'bin-1', label: '普通', min: 0, max: 1000 },
                { id: 'bin-2', label: '爆贴', min: 1001, max: 2500 },
                { id: 'bin-3', label: '大爆贴', min: 2501, max: Infinity },
            ];
        } else if (presetType === 'percentage') {
            bins = [
                { id: 'bin-1', label: '低 (0-25%)', min: 0, max: 25 },
                { id: 'bin-2', label: '中 (25-50%)', min: 25, max: 50 },
                { id: 'bin-3', label: '高 (50-75%)', min: 50, max: 75 },
                { id: 'bin-4', label: '极高 (75%+)', min: 75, max: Infinity },
            ];
        }

        if (bins.length > 0) {
            setConfig(prev => ({ ...prev, columnBins: bins, useColumnBins: true }));
        }
    };

    // Add custom bin
    const addBin = () => {
        const newBin: BinRange = {
            id: `bin-${Date.now()}`,
            label: '新区间',
            min: 0,
            max: 100,
        };
        setConfig(prev => ({ ...prev, columnBins: [...prev.columnBins, newBin] }));
    };

    // Remove bin
    const removeBin = (id: string) => {
        setConfig(prev => ({
            ...prev,
            columnBins: prev.columnBins.filter(b => b.id !== id)
        }));
    };

    // Update bin
    const updateBin = (id: string, field: keyof BinRange, value: string | number) => {
        setConfig(prev => ({
            ...prev,
            columnBins: prev.columnBins.map(b =>
                b.id === id ? { ...b, [field]: value } : b
            )
        }));
    };

    // Calculate pivot table data
    const pivotData = useMemo(() => {
        if (!config.rowField) return null;

        const rows = data.rows;

        // Get unique row values
        const rowValues: string[] = Array.from(new Set(rows.map(r => String(r[config.rowField] ?? '(空)'))));

        // Determine column values
        let columnValues: string[] = [];
        let getColumnKey: (row: DataRow) => string = () => '';

        if (config.useColumnBins && config.columnBins.length > 0 && config.columnField) {
            // Use bins for column grouping
            columnValues = config.columnBins.map(b => b.label);
            getColumnKey = (row: DataRow) => {
                const val = Number(row[config.columnField]);
                if (isNaN(val)) return '其他';
                const bin = config.columnBins.find(b => val >= b.min && val < b.max);
                return bin ? bin.label : '其他';
            };
            // Add "其他" if there might be values outside bins
            if (!columnValues.includes('其他')) {
                columnValues.push('其他');
            }
        } else if (config.columnField) {
            // Use unique values for column grouping
            columnValues = Array.from(new Set(rows.map(r => String(r[config.columnField] ?? '(空)'))));
            getColumnKey = (row: DataRow) => String(row[config.columnField] ?? '(空)');
        } else {
            // No column field - just show totals
            columnValues = ['总计'];
            getColumnKey = () => '总计';
        }

        // Build pivot matrix
        const matrix: Record<string, Record<string, number[]>> = {};

        rowValues.forEach(rv => {
            matrix[rv] = {};
            columnValues.forEach(cv => {
                matrix[rv][cv] = [];
            });
        });

        // Populate matrix with values
        rows.forEach(row => {
            const rowKey = String(row[config.rowField] ?? '(空)');
            const colKey = getColumnKey(row);

            if (matrix[rowKey] && matrix[rowKey][colKey] !== undefined) {
                if (config.aggregation === 'count') {
                    matrix[rowKey][colKey].push(1);
                } else {
                    const val = Number(row[config.valueField]);
                    if (!isNaN(val)) {
                        matrix[rowKey][colKey].push(val);
                    }
                }
            }
        });

        // Aggregate values
        const aggregate = (values: number[]): number => {
            if (values.length === 0) return 0;
            if (config.aggregation === 'count') return values.length;
            if (config.aggregation === 'sum') return values.reduce((a, b) => a + b, 0);
            if (config.aggregation === 'avg') return values.reduce((a, b) => a + b, 0) / values.length;
            return 0;
        };

        const result: Record<string, Record<string, number>> = {};
        const columnTotals: Record<string, number[]> = {};
        columnValues.forEach(cv => columnTotals[cv] = []);

        rowValues.forEach(rv => {
            result[rv] = {};
            columnValues.forEach(cv => {
                const aggregated = aggregate(matrix[rv][cv]);
                result[rv][cv] = aggregated;
                if (aggregated > 0) {
                    columnTotals[cv].push(...matrix[rv][cv]);
                }
            });
            // Row total
            const allRowValues = columnValues.flatMap(cv => matrix[rv][cv]);
            result[rv]['__total__'] = aggregate(allRowValues);
        });

        // Calculate column totals row
        const totalsRow: Record<string, number> = {};
        columnValues.forEach(cv => {
            totalsRow[cv] = aggregate(columnTotals[cv]);
        });
        // Grand total
        const allValues = Object.values(columnTotals).flat();
        totalsRow['__total__'] = aggregate(allValues);

        return {
            rowValues,
            columnValues,
            matrix: result,
            totalsRow,
        };
    }, [data, config]);

    // Copy table to clipboard
    const handleCopy = () => {
        if (!pivotData) return;

        const { rowValues, columnValues, matrix, totalsRow } = pivotData;

        // Build TSV string
        let tsv = config.rowField + '\t' + columnValues.join('\t');
        if (config.showRowTotals) tsv += '\t总计';
        tsv += '\n';

        rowValues.forEach(rv => {
            tsv += rv + '\t';
            tsv += columnValues.map(cv => matrix[rv][cv]).join('\t');
            if (config.showRowTotals) tsv += '\t' + matrix[rv]['__total__'];
            tsv += '\n';
        });

        if (config.showColumnTotals) {
            tsv += '总计\t';
            tsv += columnValues.map(cv => totalsRow[cv]).join('\t');
            if (config.showRowTotals) tsv += '\t' + totalsRow['__total__'];
        }

        navigator.clipboard.writeText(tsv);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    // Format number for display
    const formatNumber = (n: number): string => {
        if (config.aggregation === 'avg') {
            return n.toFixed(1);
        }
        return n.toLocaleString();
    };

    return (
        <div className="flex flex-col h-full bg-white rounded-xl shadow-sm border border-slate-200 overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-purple-50 flex justify-between items-center">
                <div className="flex items-center gap-3">
                    <div className="bg-indigo-600 p-2 rounded-lg shadow-sm">
                        <Table2 className="text-white" size={20} />
                    </div>
                    <div>
                        <h3 className="font-bold text-slate-800">数据透视表</h3>
                        <p className="text-xs text-slate-500">交叉统计分析</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={handleCopy}
                        disabled={!pivotData}
                        className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-white border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-50 transition-colors"
                    >
                        {copied ? <Check size={14} className="text-green-600" /> : <Copy size={14} />}
                        {copied ? '已复制' : '复制表格'}
                    </button>
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={`p-2 rounded-lg transition-colors ${showSettings ? 'bg-indigo-100 text-indigo-600' : 'bg-white text-slate-500 hover:bg-slate-50'}`}
                    >
                        <Settings2 size={18} />
                    </button>
                </div>
            </div>

            <div className="flex-1 flex overflow-hidden">
                {/* Settings Panel */}
                {showSettings && (
                    <div className="w-72 shrink-0 border-r border-slate-200 bg-slate-50 p-4 overflow-y-auto">
                        <div className="space-y-5">
                            {/* Row Field */}
                            <div>
                                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 mb-2">
                                    <Layers size={14} />
                                    行字段 (分组依据)
                                </label>
                                <select
                                    value={config.rowField}
                                    onChange={(e) => setConfig(prev => ({ ...prev, rowField: e.target.value }))}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    <option value="">选择列...</option>
                                    {data.columns.map(col => (
                                        <option key={col} value={col}>{col}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Column Field */}
                            <div>
                                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 mb-2">
                                    <Filter size={14} />
                                    列字段 (交叉分类)
                                </label>
                                <select
                                    value={config.columnField}
                                    onChange={(e) => setConfig(prev => ({
                                        ...prev,
                                        columnField: e.target.value,
                                        useColumnBins: false,
                                        columnBins: []
                                    }))}
                                    className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                >
                                    <option value="">（无 - 仅行汇总）</option>
                                    {data.columns.map(col => (
                                        <option key={col} value={col}>{col}</option>
                                    ))}
                                </select>
                            </div>

                            {/* Binning Options */}
                            {config.columnField && numericColumns.includes(config.columnField) && (
                                <div className="p-3 bg-white rounded-lg border border-slate-200">
                                    <div className="flex items-center justify-between mb-3">
                                        <label className="flex items-center gap-2 text-xs font-semibold text-slate-600">
                                            <Hash size={14} />
                                            数值区间分组
                                        </label>
                                        <label className="flex items-center gap-2 text-xs cursor-pointer">
                                            <input
                                                type="checkbox"
                                                checked={config.useColumnBins}
                                                onChange={(e) => setConfig(prev => ({ ...prev, useColumnBins: e.target.checked }))}
                                                className="rounded text-indigo-600"
                                            />
                                            启用
                                        </label>
                                    </div>

                                    {config.useColumnBins && (
                                        <div className="space-y-2">
                                            <div className="flex gap-1">
                                                <button
                                                    onClick={handleAutoBin}
                                                    className="flex-1 text-xs px-2 py-1.5 bg-indigo-50 text-indigo-600 rounded-lg hover:bg-indigo-100 transition-colors"
                                                >
                                                    自动生成
                                                </button>
                                                <button
                                                    onClick={() => applyPreset('comments')}
                                                    className="flex-1 text-xs px-2 py-1.5 bg-amber-50 text-amber-600 rounded-lg hover:bg-amber-100 transition-colors"
                                                    title="预设: 普通/爆贴/大爆贴"
                                                >
                                                    评论量
                                                </button>
                                            </div>

                                            {config.columnBins.map((bin, idx) => (
                                                <div key={bin.id} className="p-2 bg-slate-50 rounded-lg border border-slate-200">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-[10px] text-slate-400 font-medium">区间 {idx + 1}</span>
                                                        <button
                                                            onClick={() => removeBin(bin.id)}
                                                            className="p-0.5 text-slate-300 hover:text-red-500"
                                                        >
                                                            <X size={12} />
                                                        </button>
                                                    </div>
                                                    <div className="mb-2">
                                                        <label className="text-[10px] text-slate-500 mb-0.5 block">分组名称（显示在表头）</label>
                                                        <input
                                                            type="text"
                                                            value={bin.label}
                                                            onChange={(e) => updateBin(bin.id, 'label', e.target.value)}
                                                            className="w-full px-2 py-1.5 text-xs font-medium border border-slate-200 rounded bg-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                                            placeholder="如：爆贴、大爆贴"
                                                        />
                                                    </div>
                                                    <div>
                                                        <label className="text-[10px] text-slate-500 mb-1 block">数值范围</label>
                                                        <div className="grid grid-cols-2 gap-2">
                                                            <div>
                                                                <span className="text-[9px] text-slate-400 block mb-0.5">起始值 (≥)</span>
                                                                <input
                                                                    type="number"
                                                                    value={bin.min === -Infinity ? '' : bin.min}
                                                                    onChange={(e) => updateBin(bin.id, 'min', Number(e.target.value))}
                                                                    className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded bg-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                                                    placeholder="0"
                                                                />
                                                            </div>
                                                            <div>
                                                                <span className="text-[9px] text-slate-400 block mb-0.5">结束值 (&lt;) 空=无上限</span>
                                                                <input
                                                                    type="number"
                                                                    value={bin.max === Infinity ? '' : bin.max}
                                                                    onChange={(e) => updateBin(bin.id, 'max', e.target.value === '' ? Infinity : Number(e.target.value))}
                                                                    className="w-full px-2 py-1.5 text-xs border border-slate-200 rounded bg-white focus:ring-1 focus:ring-indigo-500 outline-none"
                                                                    placeholder="无上限"
                                                                />
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            ))}

                                            <button
                                                onClick={addBin}
                                                className="w-full text-xs px-3 py-1.5 border border-dashed border-slate-300 text-slate-500 rounded-lg hover:border-indigo-400 hover:text-indigo-600 transition-colors flex items-center justify-center gap-1"
                                            >
                                                <Plus size={12} /> 添加区间
                                            </button>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Value Field & Aggregation */}
                            <div>
                                <label className="flex items-center gap-2 text-xs font-semibold text-slate-600 mb-2">
                                    <Calendar size={14} />
                                    聚合方式
                                </label>
                                <div className="flex gap-1 mb-2">
                                    {[
                                        { key: 'count', label: '计数' },
                                        { key: 'sum', label: '求和' },
                                        { key: 'avg', label: '平均' },
                                    ].map(opt => (
                                        <button
                                            key={opt.key}
                                            onClick={() => setConfig(prev => ({ ...prev, aggregation: opt.key as any }))}
                                            className={`flex-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-colors ${config.aggregation === opt.key
                                                ? 'bg-indigo-600 text-white'
                                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                                                }`}
                                        >
                                            {opt.label}
                                        </button>
                                    ))}
                                </div>

                                {config.aggregation !== 'count' && (
                                    <select
                                        value={config.valueField}
                                        onChange={(e) => setConfig(prev => ({ ...prev, valueField: e.target.value }))}
                                        className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:ring-2 focus:ring-indigo-500 outline-none bg-white"
                                    >
                                        <option value="">选择数值列...</option>
                                        {numericColumns.map(col => (
                                            <option key={col} value={col}>{col}</option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            {/* Display Options */}
                            <div className="space-y-2">
                                <label className="text-xs font-semibold text-slate-600">显示选项</label>
                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={config.showRowTotals}
                                        onChange={(e) => setConfig(prev => ({ ...prev, showRowTotals: e.target.checked }))}
                                        className="rounded text-indigo-600"
                                    />
                                    显示行合计
                                </label>
                                <label className="flex items-center gap-2 text-xs cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={config.showColumnTotals}
                                        onChange={(e) => setConfig(prev => ({ ...prev, showColumnTotals: e.target.checked }))}
                                        className="rounded text-indigo-600"
                                    />
                                    显示列合计
                                </label>
                            </div>
                        </div>
                    </div>
                )}

                {/* Table Area */}
                <div className="flex-1 overflow-auto p-4">
                    {!config.rowField ? (
                        <div className="h-full flex flex-col items-center justify-center text-slate-400">
                            <Table2 size={48} className="mb-4 opacity-50" />
                            <p className="text-sm font-medium">请先选择行字段</p>
                            <p className="text-xs mt-1">在左侧设置面板中配置透视表</p>
                        </div>
                    ) : pivotData ? (
                        <div className="inline-block min-w-full">
                            <table className="border-collapse text-sm">
                                <thead>
                                    <tr>
                                        <th className="px-4 py-3 text-left font-bold text-slate-700 bg-slate-100 border border-slate-200 sticky left-0 z-10">
                                            {config.rowField}
                                        </th>
                                        {pivotData.columnValues.map(cv => (
                                            <th key={cv} className="px-4 py-3 text-center font-bold text-slate-700 bg-slate-100 border border-slate-200 whitespace-nowrap min-w-[80px]">
                                                {cv}
                                            </th>
                                        ))}
                                        {config.showRowTotals && (
                                            <th className="px-4 py-3 text-center font-bold text-indigo-700 bg-indigo-50 border border-slate-200 whitespace-nowrap">
                                                总计
                                            </th>
                                        )}
                                    </tr>
                                </thead>
                                <tbody>
                                    {pivotData.rowValues.map((rv, idx) => (
                                        <tr key={rv} className={idx % 2 === 0 ? 'bg-white' : 'bg-slate-50'}>
                                            <td className="px-4 py-2 font-medium text-slate-700 border border-slate-200 sticky left-0 bg-inherit whitespace-nowrap">
                                                {rv}
                                            </td>
                                            {pivotData.columnValues.map(cv => (
                                                <td key={cv} className="px-4 py-2 text-center text-slate-600 border border-slate-200 tabular-nums">
                                                    {formatNumber(pivotData.matrix[rv][cv])}
                                                </td>
                                            ))}
                                            {config.showRowTotals && (
                                                <td className="px-4 py-2 text-center font-semibold text-indigo-700 bg-indigo-50/50 border border-slate-200 tabular-nums">
                                                    {formatNumber(pivotData.matrix[rv]['__total__'])}
                                                </td>
                                            )}
                                        </tr>
                                    ))}
                                    {config.showColumnTotals && (
                                        <tr className="bg-slate-100 font-semibold">
                                            <td className="px-4 py-2 font-bold text-slate-700 border border-slate-200 sticky left-0 bg-slate-100">
                                                总计
                                            </td>
                                            {pivotData.columnValues.map(cv => (
                                                <td key={cv} className="px-4 py-2 text-center text-slate-700 border border-slate-200 tabular-nums">
                                                    {formatNumber(pivotData.totalsRow[cv])}
                                                </td>
                                            ))}
                                            {config.showRowTotals && (
                                                <td className="px-4 py-2 text-center font-bold text-indigo-700 bg-indigo-100 border border-slate-200 tabular-nums">
                                                    {formatNumber(pivotData.totalsRow['__total__'])}
                                                </td>
                                            )}
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    ) : null}
                </div>
            </div>
        </div>
    );
};

export default PivotTable;
