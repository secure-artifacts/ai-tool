import React, { memo } from 'react';
import { X, Tag, Upload, Loader2 } from 'lucide-react';

export interface CategoryModalProps {
    isOpen: boolean;
    imageUrl: string;
    rowIndex: number;
    currentCategory: string;
    isSaving: boolean;
    categoryOptions: string[];
    autoSyncToSheet: boolean;
    categoryColumn: string;
    sheetName: string;
    onSelectCategory: (category: string) => void;
    onClearCategory: () => void;
    onSyncToggle: () => void;
    onClose: () => void;
}

export const CategoryModal = memo(function CategoryModal({
    isOpen,
    imageUrl,
    rowIndex,
    currentCategory,
    isSaving,
    categoryOptions,
    autoSyncToSheet,
    categoryColumn,
    sheetName,
    onSelectCategory,
    onClearCategory,
    onSyncToggle,
    onClose,
}: CategoryModalProps) {
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110]"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-md mx-4 animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Modal Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-purple-100 rounded-lg flex items-center justify-center">
                            <Tag size={18} className="text-purple-600" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800">【媒体标签】</h3>
                            <p className="text-[11px] text-slate-400">
                                标签将同步到 {categoryColumn}{rowIndex} 单元格
                            </p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-5">
                    {/* Image Preview */}
                    <div className="flex gap-4 mb-4">
                        <div className="w-20 h-20 bg-slate-100 rounded-lg overflow-hidden flex-shrink-0">
                            <img
                                src={imageUrl}
                                alt="Preview"
                                className="w-full h-full object-cover"
                                onError={(e) => {
                                    (e.target as HTMLImageElement).style.display = 'none';
                                }}
                            />
                        </div>
                        <div className="flex-1 min-w-0">
                            <p className="text-xs text-slate-500 mb-1">目标位置</p>
                            <p className="text-sm font-medium text-slate-700 truncate">
                                {sheetName || '当前工作表'} → {categoryColumn}{rowIndex}
                            </p>
                            {currentCategory && (
                                <p className="text-sm text-purple-600 mt-2 bg-purple-50 px-2 py-1 rounded inline-block">
                                    当前: {currentCategory}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Category Options */}
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-3">
                            选择分类标签
                        </label>
                        <div className="grid grid-cols-2 gap-2">
                            {categoryOptions.map((cat) => (
                                <button
                                    key={cat}
                                    onClick={() => onSelectCategory(cat)}
                                    disabled={isSaving}
                                    className={`px-4 py-3 text-sm font-medium rounded-lg border-2 transition-all ${currentCategory === cat
                                        ? 'bg-purple-500 text-white border-purple-500'
                                        : 'bg-white text-slate-700 border-slate-200 hover:border-purple-300 hover:bg-purple-50'
                                        } disabled:opacity-50`}
                                >
                                    {cat}
                                </button>
                            ))}
                        </div>

                        {/* Clear category button */}
                        {currentCategory && (
                            <button
                                onClick={onClearCategory}
                                disabled={isSaving}
                                className="w-full mt-3 px-4 py-2 text-sm text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                            >
                                ✕ 清除分类
                            </button>
                        )}
                    </div>

                    {/* Auto sync toggle */}
                    <div className="flex items-center justify-between mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-2">
                            <Upload size={16} className={autoSyncToSheet ? 'text-purple-600' : 'text-slate-400'} />
                            <div>
                                <p className="text-sm font-medium text-slate-700">自动同步到表格</p>
                                <p className="text-[10px] text-slate-400">将标签写入 {categoryColumn} 列</p>
                            </div>
                        </div>
                        <button
                            onClick={onSyncToggle}
                            className={`relative w-11 h-6 rounded-full transition-colors ${autoSyncToSheet ? 'bg-purple-600' : 'bg-slate-300'}`}
                        >
                            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${autoSyncToSheet ? 'left-6' : 'left-1'}`} />
                        </button>
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                    <div className="text-[11px] text-slate-400">
                        {isSaving ? (
                            <span className="flex items-center gap-1">
                                <Loader2 size={12} className="animate-spin text-purple-500" />
                                正在保存...
                            </span>
                        ) : (
                            <span>点击分类选项即可保存</span>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isSaving}
                        className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                        关闭
                    </button>
                </div>
            </div>
        </div>
    );
});
