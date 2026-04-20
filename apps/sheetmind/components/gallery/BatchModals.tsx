import React, { memo } from 'react';
import { X, Tag, MessageSquare, Loader2 } from 'lucide-react';

// ==================== Batch Category Modal ====================
export interface BatchCategoryModalProps {
    isOpen: boolean;
    isSaving: boolean;
    selectedCount: number;
    categoryOptions: string[];
    onSelectCategory: (cat: string) => void;
    onClearCategory: () => void;
    onClose: () => void;
}

export const BatchCategoryModal = memo(function BatchCategoryModal({
    isOpen,
    isSaving,
    selectedCount,
    categoryOptions,
    onSelectCategory,
    onClearCategory,
    onClose,
}: BatchCategoryModalProps) {
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
                            <h3 className="font-bold text-slate-800">批量分类</h3>
                            <p className="text-[11px] text-slate-400">
                                为 {selectedCount} 张图片设置分类
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
                    <label className="block text-xs font-medium text-slate-600 mb-3">
                        选择要应用的分类
                    </label>
                    <div className="grid grid-cols-2 gap-2">
                        {categoryOptions.map((cat) => (
                            <button
                                key={cat}
                                onClick={() => onSelectCategory(cat)}
                                disabled={isSaving}
                                className="px-4 py-3 text-sm font-medium rounded-lg border-2 bg-white text-slate-700 border-slate-200 hover:border-purple-300 hover:bg-purple-50 transition-all disabled:opacity-50"
                            >
                                {cat}
                            </button>
                        ))}
                    </div>

                    {/* Clear category button */}
                    <button
                        onClick={onClearCategory}
                        disabled={isSaving}
                        className="w-full mt-3 px-4 py-2 text-sm text-slate-500 bg-slate-100 hover:bg-slate-200 rounded-lg transition-colors disabled:opacity-50"
                    >
                        ✕ 清除分类
                    </button>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                    <div className="text-[11px] text-slate-400">
                        {isSaving ? (
                            <span className="flex items-center gap-1">
                                <Loader2 size={12} className="animate-spin text-purple-500" />
                                正在批量设置...
                            </span>
                        ) : (
                            <span>点击分类选项即可批量应用</span>
                        )}
                    </div>
                    <button
                        onClick={onClose}
                        disabled={isSaving}
                        className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                    >
                        取消
                    </button>
                </div>
            </div>
        </div>
    );
});

// ==================== Batch Note Modal ====================
export interface BatchNoteModalProps {
    isOpen: boolean;
    isSaving: boolean;
    note: string;
    imageCount: number;
    onNoteChange: (note: string) => void;
    onSave: () => void;
    onClose: () => void;
}

export const BatchNoteModal = memo(function BatchNoteModal({
    isOpen,
    isSaving,
    note,
    imageCount,
    onNoteChange,
    onSave,
    onClose,
}: BatchNoteModalProps) {
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
                        <div className="w-8 h-8 bg-blue-100 rounded-lg flex items-center justify-center">
                            <MessageSquare size={18} className="text-blue-600" />
                        </div>
                        <div>
                            <h3 className="font-bold text-slate-800">批量备注</h3>
                            <p className="text-[11px] text-slate-400">
                                为 {imageCount} 张图片设置备注
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
                    <label className="block text-xs font-medium text-slate-600 mb-2">
                        输入备注内容
                    </label>
                    <textarea
                        value={note}
                        onChange={(e) => onNoteChange(e.target.value)}
                        placeholder="输入要批量添加的备注..."
                        className="w-full h-32 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-400 focus:border-transparent resize-none"
                        disabled={isSaving}
                    />
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                    <div className="text-[11px] text-slate-400">
                        {isSaving ? (
                            <span className="flex items-center gap-1">
                                <Loader2 size={12} className="animate-spin text-blue-500" />
                                正在批量设置...
                            </span>
                        ) : (
                            <span>输入备注后点击确定即可批量应用</span>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={onClose}
                            disabled={isSaving}
                            className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors disabled:opacity-50"
                        >
                            取消
                        </button>
                        <button
                            onClick={onSave}
                            disabled={isSaving}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors disabled:opacity-50"
                        >
                            {isSaving ? '应用中...' : '确定'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});
