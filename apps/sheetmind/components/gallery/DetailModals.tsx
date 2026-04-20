import React, { memo } from 'react';
import { X, Info } from 'lucide-react';

export interface ImageModalProps {
    imageUrl: string | null;
    onClose: () => void;
}

export const ImageModal = memo(function ImageModal({
    imageUrl,
    onClose,
}: ImageModalProps) {
    if (!imageUrl) return null;

    return (
        <div
            className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div className="relative max-w-[90vw] max-h-[90vh]">
                <img
                    src={imageUrl}
                    alt=""
                    className="max-w-full max-h-[90vh] object-contain rounded-lg"
                />
                <button
                    onClick={onClose}
                    className="absolute -top-4 -right-4 p-2 bg-white rounded-full shadow-lg hover:bg-slate-100"
                >
                    <X size={20} />
                </button>
            </div>
        </div>
    );
});

// ==================== Row Detail Modal ====================

export interface RowDetailModalProps {
    row: Record<string, any> | null;
    columns: string[];
    imageColumn: string;
    extractImageUrl: (val: any) => string | null;
    onClose: () => void;
}

export const RowDetailModal = memo(function RowDetailModal({
    row,
    columns,
    imageColumn,
    extractImageUrl,
    onClose,
}: RowDetailModalProps) {
    if (!row) return null;

    const imageUrl = extractImageUrl(row[imageColumn]);

    return (
        <div
            className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-xl shadow-2xl max-w-2xl w-full max-h-[85vh] overflow-hidden"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-slate-50">
                    <h3 className="text-sm font-semibold text-slate-800 flex items-center gap-1"><Info size={14} /> 数据详情</h3>
                    <button
                        onClick={onClose}
                        className="p-1 hover:bg-slate-200 rounded"
                    >
                        <X size={18} />
                    </button>
                </div>
                {/* Image preview */}
                {imageUrl && (
                    <div className="p-4 border-b border-slate-200 bg-slate-100 flex justify-center">
                        <img
                            src={imageUrl}
                            alt=""
                            className="max-h-48 object-contain rounded-lg shadow"
                        />
                    </div>
                )}
                {/* Data table */}
                <div className="overflow-y-auto max-h-[50vh] p-4">
                    <table className="w-full text-sm">
                        <tbody>
                            {columns.map(col => {
                                const value = row[col];
                                if (value === undefined || value === null || value === '') return null;
                                return (
                                    <tr key={col} className="border-b border-slate-100 hover:bg-slate-50">
                                        <td className="py-2 pr-4 text-slate-500 font-medium whitespace-nowrap align-top" style={{ width: '35%' }}>
                                            {col}
                                        </td>
                                        <td className="py-2 text-slate-800 break-words">
                                            {String(value)}
                                        </td>
                                    </tr>
                                );
                            })}
                        </tbody>
                    </table>
                </div>
                {/* Footer */}
                <div className="px-4 py-3 border-t border-slate-200 bg-slate-50 flex justify-end">
                    <button
                        onClick={onClose}
                        className="px-4 py-1.5 text-sm bg-slate-600 text-white rounded hover:bg-slate-700"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
});
