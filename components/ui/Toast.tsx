import React, { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { CheckCircle, XCircle, AlertCircle, Info, X } from 'lucide-react';

// Toast 类型
type ToastType = 'success' | 'error' | 'warning' | 'info';

// 单个 Toast 的数据结构
interface Toast {
    id: string;
    type: ToastType;
    message: string;
    duration?: number;
}

// Context 类型
interface ToastContextType {
    toasts: Toast[];
    addToast: (type: ToastType, message: string, duration?: number) => void;
    removeToast: (id: string) => void;
    // 便捷方法
    success: (message: string, duration?: number) => void;
    error: (message: string, duration?: number) => void;
    warning: (message: string, duration?: number) => void;
    info: (message: string, duration?: number) => void;
}

const ToastContext = createContext<ToastContextType | null>(null);

// Toast 图标映射
const TOAST_ICONS = {
    success: CheckCircle,
    error: XCircle,
    warning: AlertCircle,
    info: Info,
};

// Toast 样式映射
const TOAST_STYLES = {
    success: {
        bg: 'bg-gradient-to-r from-green-600/95 to-emerald-600/95',
        border: 'border-green-400/30',
        icon: 'text-green-200',
        text: 'text-white',
    },
    error: {
        bg: 'bg-gradient-to-r from-red-600/95 to-rose-600/95',
        border: 'border-red-400/30',
        icon: 'text-red-200',
        text: 'text-white',
    },
    warning: {
        bg: 'bg-gradient-to-r from-amber-600/95 to-orange-600/95',
        border: 'border-amber-400/30',
        icon: 'text-amber-200',
        text: 'text-white',
    },
    info: {
        bg: 'bg-gradient-to-r from-blue-600/95 to-indigo-600/95',
        border: 'border-blue-400/30',
        icon: 'text-blue-200',
        text: 'text-white',
    },
};

// 单个 Toast 组件
const ToastItem: React.FC<{
    toast: Toast;
    onRemove: (id: string) => void;
}> = ({ toast, onRemove }) => {
    const [isExiting, setIsExiting] = useState(false);
    const Icon = TOAST_ICONS[toast.type];
    const styles = TOAST_STYLES[toast.type];

    useEffect(() => {
        if (toast.duration && toast.duration > 0) {
            const timer = setTimeout(() => {
                setIsExiting(true);
                setTimeout(() => onRemove(toast.id), 300);
            }, toast.duration);
            return () => clearTimeout(timer);
        }
    }, [toast.id, toast.duration, onRemove]);

    const handleClose = () => {
        setIsExiting(true);
        setTimeout(() => onRemove(toast.id), 300);
    };

    return (
        <div
            className={`
                flex items-center gap-3 px-4 py-3 rounded-xl shadow-2xl border backdrop-blur-sm
                ${styles.bg} ${styles.border}
                transform transition-all duration-300 ease-out
                ${isExiting ? 'opacity-0 translate-x-full' : 'opacity-100 translate-x-0'}
                hover:scale-[1.02] cursor-default
                min-w-[280px] max-w-[400px]
            `}
        >
            <Icon className={`w-5 h-5 flex-shrink-0 ${styles.icon}`} />
            <p className={`flex-1 text-sm font-medium ${styles.text}`}>{toast.message}</p>
            <button
                onClick={handleClose}
                className="flex-shrink-0 p-1 rounded-full hover:bg-white/20 transition-colors"
            >
                <X className="w-4 h-4 text-white/80" />
            </button>
        </div>
    );
};

// Toast 容器组件
const ToastContainer: React.FC<{ toasts: Toast[]; onRemove: (id: string) => void }> = ({
    toasts,
    onRemove,
}) => {
    if (toasts.length === 0) return null;

    return (
        <div className="fixed top-4 right-4 z-[9999] flex flex-col gap-3">
            {toasts.map((toast) => (
                <ToastItem key={toast.id} toast={toast} onRemove={onRemove} />
            ))}
        </div>
    );
};

// Toast Provider
export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [toasts, setToasts] = useState<Toast[]>([]);

    const removeToast = useCallback((id: string) => {
        setToasts((prev) => prev.filter((t) => t.id !== id));
    }, []);

    const addToast = useCallback((type: ToastType, message: string, duration = 3000) => {
        const id = `toast_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`;
        setToasts((prev) => [...prev, { id, type, message, duration }]);
    }, []);

    const success = useCallback((message: string, duration?: number) => addToast('success', message, duration), [addToast]);
    const error = useCallback((message: string, duration?: number) => addToast('error', message, duration ?? 5000), [addToast]);
    const warning = useCallback((message: string, duration?: number) => addToast('warning', message, duration ?? 4000), [addToast]);
    const info = useCallback((message: string, duration?: number) => addToast('info', message, duration), [addToast]);

    return (
        <ToastContext.Provider value={{ toasts, addToast, removeToast, success, error, warning, info }}>
            {children}
            <ToastContainer toasts={toasts} onRemove={removeToast} />
        </ToastContext.Provider>
    );
};

// 使用 Toast 的 Hook
export const useToast = (): ToastContextType => {
    const context = useContext(ToastContext);
    if (!context) {
        throw new Error('useToast must be used within a ToastProvider');
    }
    return context;
};

// 导出类型
export type { Toast, ToastType };
