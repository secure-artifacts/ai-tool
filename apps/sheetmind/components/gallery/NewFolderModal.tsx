import React, { memo } from 'react';
import { X, FolderPlus, Edit3 } from 'lucide-react';

const EMOJI_OPTIONS = ['📂', '⭐', '❤️', '💼', '🎯', '🔥', '💎', '🎨', '📸', '🎬', '🎵', '📚'];

export interface NewFolderModalProps {
    isOpen: boolean;
    name: string;
    emoji: string;
    onNameChange: (name: string) => void;
    onEmojiChange: (emoji: string) => void;
    onCreate: () => void;
    onClose: () => void;
}

export const NewFolderModal = memo(function NewFolderModal({
    isOpen,
    name,
    emoji,
    onNameChange,
    onEmojiChange,
    onCreate,
    onClose,
}: NewFolderModalProps) {
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[110]"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Modal Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-green-100 rounded-lg flex items-center justify-center">
                            <FolderPlus size={18} className="text-green-600" />
                        </div>
                        <h3 className="font-bold text-slate-800">新建收藏夹</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1.5">收藏夹名称</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => onNameChange(e.target.value)}
                            placeholder="输入收藏夹名称"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-green-400 focus:border-transparent"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1.5">选择图标</label>
                        <div className="flex flex-wrap gap-1.5 items-center">
                            {EMOJI_OPTIONS.map(e => (
                                <button
                                    key={e}
                                    onClick={() => onEmojiChange(e)}
                                    className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all ${emoji === e
                                        ? 'bg-green-100 border-2 border-green-500'
                                        : 'bg-slate-100 border border-slate-200 hover:bg-slate-200'
                                        }`}
                                >
                                    {e}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={onCreate}
                        disabled={!name.trim()}
                        className="px-4 py-2 text-sm font-medium text-white bg-green-500 rounded-lg hover:bg-green-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        创建
                    </button>
                </div>
            </div>
        </div>
    );
});

// ==================== Edit Folder Modal ====================
export interface EditFolderModalProps {
    isOpen: boolean;
    name: string;
    emoji: string;
    onNameChange: (name: string) => void;
    onEmojiChange: (emoji: string) => void;
    onSave: () => void;
    onClose: () => void;
}

export const EditFolderModal = memo(function EditFolderModal({
    isOpen,
    name,
    emoji,
    onNameChange,
    onEmojiChange,
    onSave,
    onClose,
}: EditFolderModalProps) {
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[130]"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Modal Header */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
                    <div className="flex items-center gap-2">
                        <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                            <Edit3 size={18} className="text-amber-600" />
                        </div>
                        <h3 className="font-bold text-slate-800">编辑收藏夹</h3>
                    </div>
                    <button
                        onClick={onClose}
                        className="p-1.5 text-slate-400 hover:text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Modal Body */}
                <div className="p-5 space-y-4">
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1.5">收藏夹名称</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => onNameChange(e.target.value)}
                            placeholder="输入收藏夹名称"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                            autoFocus
                        />
                    </div>
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-1.5">选择图标</label>
                        <div className="flex flex-wrap gap-1.5 items-center">
                            {EMOJI_OPTIONS.map(e => (
                                <button
                                    key={e}
                                    onClick={() => onEmojiChange(e)}
                                    className={`w-10 h-10 rounded-lg text-xl flex items-center justify-center transition-all ${emoji === e
                                        ? 'bg-amber-100 border-2 border-amber-500'
                                        : 'bg-slate-100 border border-slate-200 hover:bg-slate-200'
                                        }`}
                                >
                                    {e}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 text-sm font-medium text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={onSave}
                        disabled={!name.trim()}
                        className="px-4 py-2 text-sm font-medium text-white bg-amber-500 rounded-lg hover:bg-amber-600 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                    >
                        保存
                    </button>
                </div>
            </div>
        </div>
    );
});
