import React, { memo } from 'react';
import { X, Copy, Table2, Info } from 'lucide-react';
import { tsvEscapeCell } from '../../utils/tsvEscape';

export interface FeedbackPreviewModalProps {
    isOpen: boolean;
    header: string[];
    rows: { cells: string[]; previewUrl: string }[];
    onClose: () => void;
    onCopy: () => void;
    includeHeader: boolean;
}

export const FeedbackPreviewModal = memo(function FeedbackPreviewModal({
    isOpen,
    header,
    rows,
    onClose,
    onCopy,
    includeHeader
}: FeedbackPreviewModalProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[200000] bg-black/60 backdrop-blur-sm flex items-center justify-center p-4">
            <div className="bg-white rounded-xl shadow-2xl w-[90vw] max-w-5xl h-[85vh] flex flex-col overflow-hidden animate-in fade-in zoom-in duration-200">
                {/* Header */}
                <div className="px-5 py-4 border-b border-slate-200 flex justify-between items-center bg-slate-50 flex-shrink-0">
                    <div className="flex items-center gap-3">
                        <div className="p-2 bg-indigo-100 text-indigo-600 rounded-lg">
                            <Table2 size={20} />
                        </div>
                        <div>
                            <h2 className="text-lg font-semibold text-slate-800 leading-tight">预览反馈数据</h2>
                            <p className="text-xs text-slate-500 mt-0.5">
                                共 {rows.length} 条记录，包含 {header.length} 列数据 {includeHeader ? '' : '（复制时将不包含表头）'}
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="text-slate-400 hover:text-slate-600 hover:bg-slate-200/50 p-2 rounded-lg transition-colors"
                    >
                        <X size={20} />
                    </button>
                </div>

                {/* Content */}
                <div className="flex-1 overflow-auto p-5 bg-slate-50/50">
                    <div className="bg-white border border-slate-200 rounded-lg shadow-sm overflow-hidden">
                        <div className="overflow-x-auto">
                            <table className="w-full text-left border-collapse text-[11px]">
                                <thead>
                                    <tr className="bg-slate-100 border-b border-slate-200">
                                        <th className="py-2 px-3 font-semibold text-slate-700 border-r border-slate-200 whitespace-nowrap w-16 text-center">
                                            缩略图 (不复制)
                                        </th>
                                        {header.map((col, idx) => (
                                            <th key={idx} className="py-2 px-3 font-semibold text-slate-700 border-r border-slate-200 whitespace-nowrap">
                                                {col}
                                            </th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody>
                                    {rows.map((row, rowIdx) => (
                                        <tr key={rowIdx} className="border-b border-slate-100 hover:bg-slate-50 transition-colors">
                                            <td className="py-1 px-1 border-r border-slate-100 text-center w-16">
                                                {row.previewUrl ? (
                                                    <img 
                                                        src={row.previewUrl} 
                                                        alt="preview" 
                                                        className="w-10 h-10 object-cover rounded bg-slate-200 mx-auto border border-slate-200 shadow-sm"
                                                        referrerPolicy="no-referrer"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <div className="w-10 h-10 bg-slate-100 rounded mx-auto border border-slate-200" />
                                                )}
                                            </td>
                                            {(Array.isArray(row) ? row : (row.cells || [])).map((cell, cellIdx) => (
                                                <td key={cellIdx} className="py-2 px-3 border-r border-slate-100 text-slate-600 truncate max-w-[200px]" title={cell}>
                                                    {cell || <span className="text-slate-300 italic">空</span>}
                                                </td>
                                            ))}
                                        </tr>
                                    ))}
                                    {rows.length === 0 && (
                                        <tr>
                                            <td colSpan={header.length + 1} className="py-8 text-center text-slate-400">
                                                暂无反馈数据
                                            </td>
                                        </tr>
                                    )}
                                </tbody>
                            </table>
                        </div>
                    </div>
                    
                    <div className="mt-4 flex items-start gap-2 text-xs text-slate-500 bg-blue-50 text-blue-700 p-3 rounded-lg border border-blue-100">
                        <Info size={14} className="mt-0.5 flex-shrink-0" />
                        <div>
                            <strong>提示：</strong> 请确认上方预览的数据格式无误。点击「复制为 TSV」后，您可以直接在 Google Sheets 或 Excel 中按 <strong>Cmd/Ctrl + V</strong> 粘贴，数据将自动对齐到对应的列。
                        </div>
                    </div>
                </div>

                {/* Footer */}
                <div className="p-4 border-t border-slate-200 flex justify-end gap-3 bg-white flex-shrink-0">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-600 hover:bg-slate-100 rounded-lg transition-colors border border-transparent"
                    >
                        取消
                    </button>
                    <button
                        onClick={onCopy}
                        className="px-5 py-2 text-sm font-semibold text-white bg-indigo-600 hover:bg-indigo-700 active:bg-indigo-800 rounded-lg transition-colors shadow-sm flex items-center gap-2"
                    >
                        <Copy size={16} />
                        一键复制 (TSV)
                    </button>
                </div>
            </div>
        </div>
    );
});
