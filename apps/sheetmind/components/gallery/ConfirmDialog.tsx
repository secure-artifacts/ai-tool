import React, { memo } from 'react';
import { Trash2, Info } from 'lucide-react';

export interface ConfirmDialogState {
    isOpen: boolean;
    title: string;
    message: string;
    type?: 'danger' | 'warning' | 'info';
    confirmText?: string;
    cancelText?: string;
    onConfirm: () => void;
}

export interface ConfirmDialogProps {
    dialog: ConfirmDialogState | null;
    onClose: () => void;
}

export const ConfirmDialog = memo(function ConfirmDialog({
    dialog,
    onClose,
}: ConfirmDialogProps) {
    if (!dialog || !dialog.isOpen) return null;

    const dialogType = dialog.type || 'info';

    return (
        <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
            {/* Backdrop */}
            <div
                className="absolute inset-0 bg-black/50 backdrop-blur-sm"
                onClick={onClose}
            />
            {/* Dialog */}
            <div className="relative bg-white rounded-2xl shadow-2xl max-w-sm w-full overflow-hidden animate-in zoom-in-95 duration-200">
                {/* Header with icon */}
                <div className={`px-6 pt-6 pb-4 flex flex-col items-center ${dialogType === 'danger' ? 'text-red-600' :
                    dialogType === 'warning' ? 'text-amber-600' : 'text-blue-600'
                    }`}>
                    <div className={`w-14 h-14 rounded-full flex items-center justify-center mb-3 ${dialogType === 'danger' ? 'bg-red-100' :
                        dialogType === 'warning' ? 'bg-amber-100' : 'bg-blue-100'
                        }`}>
                        {dialogType === 'danger' ? (
                            <Trash2 size={28} />
                        ) : dialogType === 'warning' ? (
                            <Info size={28} />
                        ) : (
                            <Info size={28} />
                        )}
                    </div>
                    <h3 className="text-lg font-semibold text-slate-800">{dialog.title}</h3>
                </div>
                {/* Message */}
                <div className="px-6 pb-4">
                    <p className="text-sm text-slate-600 text-center">{dialog.message}</p>
                </div>
                {/* Actions */}
                <div className="flex border-t border-slate-200">
                    <button
                        onClick={onClose}
                        className="flex-1 py-3 text-sm font-medium text-slate-600 hover:bg-slate-50 transition-colors border-r border-slate-200"
                    >
                        {dialog.cancelText || '取消'}
                    </button>
                    <button
                        onClick={dialog.onConfirm}
                        className={`flex-1 py-3 text-sm font-medium transition-colors ${dialogType === 'danger'
                            ? 'text-red-600 hover:bg-red-50'
                            : dialogType === 'warning'
                                ? 'text-amber-600 hover:bg-amber-50'
                                : 'text-blue-600 hover:bg-blue-50'
                            }`}
                    >
                        {dialog.confirmText || '确定'}
                    </button>
                </div>
            </div>
        </div>
    );
});
