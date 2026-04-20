import React, { memo } from 'react';
import { X, Tag } from 'lucide-react';

const PRESET_EMOJI_OPTIONS = ['🏷️', '📦', '🎨', '📷', '🎬', '📝', '🌟', '💼', '🎯', '📊'];

export interface PresetEditorModalProps {
    isOpen: boolean;
    name: string;
    emoji: string;
    options: string[];
    onNameChange: (name: string) => void;
    onEmojiChange: (emoji: string) => void;
    onSave: () => void;
    onClose: () => void;
}

export const PresetEditorModal = memo(function PresetEditorModal({
    isOpen,
    name,
    emoji,
    options,
    onNameChange,
    onEmojiChange,
    onSave,
    onClose,
}: PresetEditorModalProps) {
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
                        <div className="w-8 h-8 bg-amber-100 rounded-lg flex items-center justify-center">
                            <Tag size={18} className="text-amber-600" />
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-slate-800">保存为预设</h3>
                            <p className="text-xs text-slate-500">自定义预设会同步到云端</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-lg hover:bg-slate-100 flex items-center justify-center transition-colors"
                    >
                        <X size={18} className="text-slate-500" />
                    </button>
                </div>

                {/* Modal Content */}
                <div className="p-5 space-y-4">
                    {/* Preset Name */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-600">预设名称</label>
                        <input
                            type="text"
                            value={name}
                            onChange={(e) => onNameChange(e.target.value)}
                            placeholder="例如：产品分类"
                            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-500 focus:border-transparent"
                        />
                    </div>

                    {/* Emoji Picker */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-600">图标</label>
                        <div className="flex flex-wrap gap-1.5 items-center">
                            {PRESET_EMOJI_OPTIONS.map((e) => (
                                <button
                                    key={e}
                                    onClick={() => onEmojiChange(e)}
                                    className={`w-10 h-10 text-lg rounded-lg border transition-colors ${emoji === e
                                        ? 'bg-amber-100 border-amber-300'
                                        : 'bg-slate-50 border-slate-200 hover:bg-slate-100'
                                        }`}
                                >
                                    {e}
                                </button>
                            ))}
                        </div>
                    </div>

                    {/* Options Preview */}
                    <div className="space-y-1.5">
                        <label className="text-xs font-medium text-slate-600">包含分类 ({options.length} 项)</label>
                        <div className="flex flex-wrap gap-1 p-2 bg-slate-50 rounded-lg max-h-24 overflow-y-auto">
                            {options.map((opt, idx) => (
                                <span key={idx} className="px-2 py-0.5 text-xs bg-white border border-slate-200 rounded">
                                    {opt}
                                </span>
                            ))}
                        </div>
                        <p className="text-[10px] text-slate-400">将当前分类选项保存为预设</p>
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
                        保存预设
                    </button>
                </div>
            </div>
        </div>
    );
});
