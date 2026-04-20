import React, { memo } from 'react';
import { User, Lightbulb } from 'lucide-react';

export interface LoginPromptModalProps {
    isOpen: boolean;
    action: string;
    onLogin: () => void;
    onClose: () => void;
}

export const LoginPromptModal = memo(function LoginPromptModal({
    isOpen,
    action,
    onLogin,
    onClose,
}: LoginPromptModalProps) {
    if (!isOpen) return null;

    return (
        <div
            className="fixed inset-0 bg-black/50 flex items-center justify-center z-[120]"
            onClick={onClose}
        >
            <div
                className="bg-white rounded-xl shadow-2xl w-full max-w-sm mx-4 animate-in fade-in zoom-in-95 duration-200"
                onClick={(e) => e.stopPropagation()}
            >
                <div className="p-6 text-center">
                    <div className="w-16 h-16 bg-amber-100 rounded-full flex items-center justify-center mx-auto mb-4">
                        <User size={32} className="text-amber-600" />
                    </div>
                    <h3 className="text-lg font-bold text-slate-800 mb-2">需要登录</h3>
                    <p className="text-sm text-slate-600 mb-6">
                        {action}功能需要登录邮箱账号才能使用。
                        <br />
                        <span className="text-slate-400 text-xs">登录后数据将自动同步到云端</span>
                        <br />
                        <span className="text-slate-400 text-xs flex items-center gap-1"><Lightbulb size={12} /> 高级登录需要 Sheets 写入权限，适合需要同步/入库功能的用户；普通用户选择"普通登录"即可。</span>
                        <br />
                        <span className="text-slate-400 text-xs">如需权限可联系软件提供人申请，或使用普通模式登录并选择其他验证方式实现表格写入。</span>
                    </p>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="flex-1 px-4 py-2.5 text-sm font-medium text-slate-600 bg-slate-100 rounded-lg hover:bg-slate-200 transition-colors"
                        >
                            稍后再说
                        </button>
                        <button
                            onClick={onLogin}
                            className="flex-1 px-4 py-2.5 text-sm font-medium text-white bg-blue-500 rounded-lg hover:bg-blue-600 transition-colors"
                        >
                            去登录
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
});
