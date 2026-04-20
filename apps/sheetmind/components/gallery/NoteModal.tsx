import React, { memo } from 'react';
import { X, MessageSquare, Check, Cloud, CloudOff, Upload, Loader2, Lightbulb } from 'lucide-react';
import { isUserLoggedIn } from '../../services/firebaseService';

export interface NoteModalProps {
    isOpen: boolean;
    imageUrl: string;
    rowIndex: number;
    currentNote: string;
    isSaving: boolean;
    syncToSheet: boolean;
    noteColumn: string;
    sheetName: string;
    onNoteChange: (note: string) => void;
    onSyncToggle: () => void;
    onSave: () => void;
    onClose: () => void;
}

export const NoteModal = memo(function NoteModal({
    isOpen,
    imageUrl,
    rowIndex,
    currentNote,
    isSaving,
    syncToSheet,
    noteColumn,
    sheetName,
    onNoteChange,
    onSyncToggle,
    onSave,
    onClose,
}: NoteModalProps) {
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
                            <h3 className="font-bold text-slate-800">添加备注</h3>
                            <p className="text-[11px] text-slate-400">
                                备注将同步到 {noteColumn}{rowIndex} 单元格
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
                                {sheetName || '当前工作表'} → {noteColumn}{rowIndex}
                            </p>
                            {syncToSheet && (
                                <p className="text-[10px] text-amber-600 mt-2 bg-amber-50 px-2 py-1 rounded inline-block">
                                    <Lightbulb size={12} className="inline mr-1" /> 备注将覆盖 {noteColumn} 列现有内容
                                </p>
                            )}
                        </div>
                    </div>

                    {/* Note Input */}
                    <div>
                        <label className="block text-xs font-medium text-slate-600 mb-2">
                            备注内容
                        </label>
                        <textarea
                            value={currentNote}
                            onChange={(e) => onNoteChange(e.target.value)}
                            placeholder="输入备注内容..."
                            className="w-full h-32 px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent resize-none"
                            autoFocus
                        />
                    </div>

                    {/* Sync to Sheet Toggle */}
                    <div className="flex items-center justify-between mt-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
                        <div className="flex items-center gap-2">
                            <Upload size={16} className={syncToSheet ? 'text-blue-600' : 'text-slate-400'} />
                            <div>
                                <p className="text-sm font-medium text-slate-700">同步到 Google 表格</p>
                                <p className="text-[10px] text-slate-400">将备注写入原表格的 {noteColumn} 列</p>
                            </div>
                        </div>
                        <button
                            onClick={onSyncToggle}
                            className={`relative w-11 h-6 rounded-full transition-colors ${syncToSheet ? 'bg-blue-600' : 'bg-slate-300'
                                }`}
                        >
                            <span className={`absolute top-1 w-4 h-4 bg-white rounded-full shadow transition-all ${syncToSheet ? 'left-6' : 'left-1'
                                }`} />
                        </button>
                    </div>
                </div>

                {/* Modal Footer */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-slate-50 rounded-b-xl">
                    <div className="text-[11px] text-slate-400">
                        {isUserLoggedIn() ? (
                            <span className="flex items-center gap-1">
                                <Cloud size={12} className="text-green-500" />
                                备注将保存到云端
                            </span>
                        ) : (
                            <span className="flex items-center gap-1">
                                <CloudOff size={12} className="text-amber-500" />
                                未登录，备注仅保存本地
                            </span>
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
                            disabled={isSaving || rowIndex <= 0}
                            className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50 flex items-center gap-2"
                        >
                            {isSaving ? (
                                <>
                                    <Loader2 size={14} className="animate-spin" />
                                    保存中...
                                </>
                            ) : (
                                <>
                                    <Check size={14} />
                                    {syncToSheet ? '保存并同步' : '保存备注'}
                                </>
                            )}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});
