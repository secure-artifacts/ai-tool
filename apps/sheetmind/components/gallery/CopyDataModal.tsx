import React, { memo, useState, useMemo } from 'react';
import { X, Copy, Layers, CheckSquare, Square, Filter } from 'lucide-react';
import { tsvEscapeCell } from '../../utils/tsvEscape';

export interface CopyDataModalProps {
    isOpen: boolean;
    allColumns: string[];
    processedRows: Record<string, unknown>[];
    totalRows: number;
    onClose: () => void;
    onCopyDone: (message: string) => void;
}

export const CopyDataModal = memo(function CopyDataModal({
    isOpen,
    allColumns,
    processedRows,
    totalRows,
    onClose,
    onCopyDone,
}: CopyDataModalProps) {
    // Copy mode: 'unified' = all columns merged, 'bySheet' = split by _sourceSheet
    const [copyMode, setCopyMode] = useState<'unified' | 'bySheet'>('bySheet');
    // Selected columns (only for unified mode)
    const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set(allColumns));
    // Exclude internal columns from selection
    const internalCols = useMemo(() => new Set(['_rowId', '_sourceSheet']), []);

    // Detect source sheets and their column structures
    const sheetInfo = useMemo(() => {
        const sheets = new Map<string, { columns: Set<string>; rowCount: number }>();
        for (const row of processedRows) {
            const sheet = String(row._sourceSheet || '未知分页');
            if (!sheets.has(sheet)) {
                sheets.set(sheet, { columns: new Set<string>(), rowCount: 0 });
            }
            const info = sheets.get(sheet)!;
            info.rowCount++;
            // Detect which columns actually have data in this sheet
            for (const col of allColumns) {
                if (internalCols.has(col)) continue;
                const val = row[col];
                if (val !== null && val !== undefined && String(val).trim() !== '') {
                    info.columns.add(col);
                }
            }
        }
        return sheets;
    }, [processedRows, allColumns, internalCols]);

    const hasMultipleSheets = sheetInfo.size > 1;
    const displayColumns = allColumns.filter(c => !internalCols.has(c));

    // Toggle column selection
    const toggleColumn = (col: string) => {
        setSelectedColumns(prev => {
            const next = new Set(prev);
            if (next.has(col)) {
                next.delete(col);
            } else {
                next.add(col);
            }
            return next;
        });
    };

    const selectAll = () => setSelectedColumns(new Set(allColumns));
    const deselectAll = () => setSelectedColumns(new Set());

    // Perform copy
    const handleCopy = async () => {
        try {
            let text = '';

            if (copyMode === 'bySheet' && hasMultipleSheets) {
                // Split by source sheet - each block has its own headers
                const blocks: string[] = [];
                for (const [sheetName, info] of sheetInfo) {
                    const sheetCols = displayColumns.filter(c => info.columns.has(c));
                    if (sheetCols.length === 0) continue;

                    const sheetRows = processedRows.filter(
                        r => String(r._sourceSheet || '未知分页') === sheetName
                    );

                    // Header row
                    const headerLine = sheetCols.join('\t');
                    // Data rows
                    const dataLines = sheetRows.map(row =>
                        sheetCols.map(col => tsvEscapeCell(String(row[col] ?? ''))).join('\t')
                    );

                    blocks.push(headerLine + '\n' + dataLines.join('\n'));
                }
                text = blocks.join('\n\n'); // Double newline between blocks
            } else {
                // Unified mode with selected columns
                const cols = displayColumns.filter(c => selectedColumns.has(c));
                if (cols.length === 0) {
                    onCopyDone('⚠️ 请至少选择一列');
                    return;
                }
                const headerLine = cols.join('\t');
                const dataLines = processedRows.map(row =>
                    cols.map(col => tsvEscapeCell(String(row[col] ?? ''))).join('\t')
                );
                text = headerLine + '\n' + dataLines.join('\n');
            }

            await navigator.clipboard.writeText(text);

            if (copyMode === 'bySheet' && hasMultipleSheets) {
                onCopyDone(`✅ 已按 ${sheetInfo.size} 个分页分块复制 ${totalRows} 行`);
            } else {
                const colCount = displayColumns.filter(c => selectedColumns.has(c)).length;
                onCopyDone(`✅ 已复制 ${totalRows} 行 × ${colCount} 列`);
            }
            onClose();
        } catch (err) {
            console.error('Copy failed:', err);
            onCopyDone('❌ 复制失败');
        }
    };

    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm"
            onClick={onClose}
            onKeyDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}
        >
            <div
                className="bg-white rounded-2xl shadow-2xl w-[420px] max-h-[80vh] flex flex-col"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between p-5 pb-3 border-b border-slate-100">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Copy size={20} className="text-emerald-500" />
                        复制数据到剪贴板
                    </h3>
                    <button
                        onClick={onClose}
                        className="p-1.5 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <X size={18} className="text-slate-400" />
                    </button>
                </div>

                {/* Body */}
                <div className="flex-1 overflow-y-auto p-5 space-y-4">
                    {/* Stats */}
                    <div className="flex items-center gap-3 text-xs text-slate-500">
                        <span className="px-2 py-1 bg-slate-100 rounded-full">
                            {totalRows} 行
                        </span>
                        <span className="px-2 py-1 bg-slate-100 rounded-full">
                            {displayColumns.length} 列
                        </span>
                        {hasMultipleSheets && (
                            <span className="px-2 py-1 bg-indigo-50 text-indigo-600 rounded-full">
                                {sheetInfo.size} 个分页
                            </span>
                        )}
                    </div>

                    {/* Copy Mode Selector */}
                    {hasMultipleSheets && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">复制模式</label>
                            <div className="grid grid-cols-2 gap-2">
                                <button
                                    onClick={() => setCopyMode('bySheet')}
                                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                                        copyMode === 'bySheet'
                                            ? 'border-emerald-400 bg-emerald-50'
                                            : 'border-slate-200 hover:border-slate-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <Layers size={16} className={copyMode === 'bySheet' ? 'text-emerald-600' : 'text-slate-400'} />
                                        <span className={`text-sm font-semibold ${copyMode === 'bySheet' ? 'text-emerald-700' : 'text-slate-600'}`}>
                                            按分页分块
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 leading-relaxed">
                                        每个分页独立列头，各自对齐
                                    </p>
                                </button>
                                <button
                                    onClick={() => setCopyMode('unified')}
                                    className={`p-3 rounded-xl border-2 text-left transition-all ${
                                        copyMode === 'unified'
                                            ? 'border-blue-400 bg-blue-50'
                                            : 'border-slate-200 hover:border-slate-300'
                                    }`}
                                >
                                    <div className="flex items-center gap-2 mb-1">
                                        <Filter size={16} className={copyMode === 'unified' ? 'text-blue-600' : 'text-slate-400'} />
                                        <span className={`text-sm font-semibold ${copyMode === 'unified' ? 'text-blue-700' : 'text-slate-600'}`}>
                                            统一列头
                                        </span>
                                    </div>
                                    <p className="text-[10px] text-slate-500 leading-relaxed">
                                        合并所有列，可选列导出
                                    </p>
                                </button>
                            </div>
                        </div>
                    )}

                    {/* By-Sheet Preview */}
                    {copyMode === 'bySheet' && hasMultipleSheets && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">分页预览</label>
                            <div className="space-y-1.5 max-h-40 overflow-y-auto">
                                {Array.from(sheetInfo.entries()).map(([name, info]) => (
                                    <div
                                        key={name}
                                        className="flex items-center justify-between px-3 py-2 bg-slate-50 rounded-lg"
                                    >
                                        <span className="text-xs font-medium text-slate-700 truncate max-w-[200px]">{name}</span>
                                        <div className="flex items-center gap-2 text-[10px] text-slate-400 shrink-0">
                                            <span>{info.rowCount} 行</span>
                                            <span>·</span>
                                            <span>{info.columns.size} 列</span>
                                        </div>
                                    </div>
                                ))}
                            </div>
                            <p className="text-[10px] text-slate-400">
                                每个分页将独立输出（各自的列头 + 数据），中间空一行分隔
                            </p>
                        </div>
                    )}

                    {/* Column Selector (unified mode or single sheet) */}
                    {(copyMode === 'unified' || !hasMultipleSheets) && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between">
                                <label className="text-sm font-medium text-slate-700">选择导出列</label>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={selectAll}
                                        className="text-[10px] text-blue-600 hover:text-blue-700 flex items-center gap-0.5"
                                    >
                                        <CheckSquare size={10} /> 全选
                                    </button>
                                    <button
                                        onClick={deselectAll}
                                        className="text-[10px] text-slate-500 hover:text-slate-700 flex items-center gap-0.5"
                                    >
                                        <Square size={10} /> 全不选
                                    </button>
                                </div>
                            </div>
                            <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto p-2 bg-slate-50 rounded-lg border border-slate-200">
                                {displayColumns.map(col => {
                                    const isSelected = selectedColumns.has(col);
                                    return (
                                        <button
                                            key={col}
                                            onClick={() => toggleColumn(col)}
                                            className={`px-2.5 py-1 text-[11px] rounded-lg border transition-all ${
                                                isSelected
                                                    ? 'bg-blue-500 text-white border-blue-500'
                                                    : 'bg-white text-slate-500 border-slate-200 hover:border-blue-300'
                                            }`}
                                        >
                                            {col}
                                        </button>
                                    );
                                })}
                            </div>
                            <p className="text-[10px] text-slate-400">
                                已选 {displayColumns.filter(c => selectedColumns.has(c)).length}/{displayColumns.length} 列
                            </p>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex justify-end gap-2 p-5 pt-3 border-t border-slate-100">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={handleCopy}
                        className="px-5 py-2 text-sm font-medium text-white bg-emerald-500 rounded-lg hover:bg-emerald-600 transition-colors flex items-center gap-1.5"
                    >
                        <Copy size={14} />
                        {copyMode === 'bySheet' && hasMultipleSheets
                            ? `按 ${sheetInfo.size} 个分页复制`
                            : `复制 ${displayColumns.filter(c => selectedColumns.has(c)).length} 列`
                        }
                    </button>
                </div>
            </div>
        </div>
    );
});
