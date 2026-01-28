/**
 * FixedTooltip - 全局固定定位的 Tooltip 组件
 * 
 * 使用 position: fixed 确保 tooltip 不会被任何父容器的 overflow: hidden 裁切
 * 
 * 使用方法：
 * 1. 在应用根部添加 <FixedTooltipProvider>
 * 2. 给需要 tooltip 的元素添加 data-tooltip="提示文字" 属性
 * 
 * 示例：
 * <button data-tooltip="这是一个提示">按钮</button>
 */

import React, { createContext, useContext, useState, useCallback, useEffect, useRef } from 'react';

interface TooltipState {
    visible: boolean;
    text: string;
    x: number;
    y: number;
    position: 'top' | 'bottom';
}

interface TooltipContextType {
    showTooltip: (text: string, element: HTMLElement) => void;
    hideTooltip: () => void;
}

const TooltipContext = createContext<TooltipContextType | null>(null);

export const useFixedTooltip = () => {
    const context = useContext(TooltipContext);
    if (!context) {
        throw new Error('useFixedTooltip must be used within FixedTooltipProvider');
    }
    return context;
};

interface FixedTooltipProviderProps {
    children: React.ReactNode;
    /** 延迟显示时间（毫秒），默认 300ms */
    delay?: number;
}

export const FixedTooltipProvider: React.FC<FixedTooltipProviderProps> = ({
    children,
    delay = 300
}) => {
    const [tooltip, setTooltip] = useState<TooltipState>({
        visible: false,
        text: '',
        x: 0,
        y: 0,
        position: 'bottom'
    });

    const timeoutRef = useRef<number | null>(null);
    const currentElementRef = useRef<HTMLElement | null>(null);

    const showTooltip = useCallback((text: string, element: HTMLElement) => {
        // 清除之前的延迟
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
        }

        currentElementRef.current = element;

        // 延迟显示
        timeoutRef.current = window.setTimeout(() => {
            if (currentElementRef.current !== element) return;

            const rect = element.getBoundingClientRect();
            const viewportHeight = window.innerHeight;

            // 计算 tooltip 位置
            const tooltipHeight = 32; // 估算 tooltip 高度
            const gap = 8; // tooltip 与元素的间距

            // 判断显示在上方还是下方
            const spaceBelow = viewportHeight - rect.bottom;
            const spaceAbove = rect.top;
            const preferBottom = spaceBelow >= tooltipHeight + gap || spaceBelow > spaceAbove;

            let y: number;
            let position: 'top' | 'bottom';

            if (preferBottom) {
                y = rect.bottom + gap;
                position = 'bottom';
            } else {
                y = rect.top - gap;
                position = 'top';
            }

            setTooltip({
                visible: true,
                text,
                x: rect.left + rect.width / 2,
                y,
                position
            });
        }, delay);
    }, [delay]);

    const hideTooltip = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        currentElementRef.current = null;
        setTooltip(prev => ({ ...prev, visible: false }));
    }, []);

    // 全局事件监听 - 自动处理带有 data-tooltip 属性的元素
    useEffect(() => {
        const handleMouseEnter = (e: MouseEvent) => {
            const target = e.target;
            if (!(target instanceof Element)) return;

            const tooltipText = target.getAttribute('data-tooltip') || target.closest('[data-tooltip]')?.getAttribute('data-tooltip');

            if (tooltipText) {
                const element = (target.closest('[data-tooltip]') || target) as HTMLElement;
                showTooltip(tooltipText, element);
            }
        };

        const handleMouseLeave = (e: MouseEvent) => {
            const target = e.target;
            if (target instanceof Element && (target.hasAttribute('data-tooltip') || target.closest('[data-tooltip]'))) {
                hideTooltip();
            }
        };

        // 使用事件委托
        document.addEventListener('mouseenter', handleMouseEnter, true);
        document.addEventListener('mouseleave', handleMouseLeave, true);

        return () => {
            document.removeEventListener('mouseenter', handleMouseEnter, true);
            document.removeEventListener('mouseleave', handleMouseLeave, true);
        };
    }, [showTooltip, hideTooltip]);

    // 清理
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    return (
        <TooltipContext.Provider value={{ showTooltip, hideTooltip }}>
            {children}

            {/* 固定定位的 Tooltip */}
            {tooltip.visible && tooltip.text && (
                <div
                    className="fixed z-[99999] px-3 py-1.5 text-xs font-medium text-white bg-slate-800 rounded-lg shadow-lg pointer-events-none whitespace-pre-wrap max-w-xs"
                    style={{
                        left: tooltip.x,
                        top: tooltip.position === 'bottom' ? tooltip.y : 'auto',
                        bottom: tooltip.position === 'top' ? `calc(100vh - ${tooltip.y}px)` : 'auto',
                        transform: 'translateX(-50%)',
                        animation: 'tooltipFadeIn 0.15s ease-out'
                    }}
                >
                    {tooltip.text}

                    {/* 小三角 */}
                    <div
                        className="absolute left-1/2 -translate-x-1/2 border-[5px] border-transparent"
                        style={{
                            ...(tooltip.position === 'bottom'
                                ? { top: '-10px', borderBottomColor: 'rgb(30 41 59)' }
                                : { bottom: '-10px', borderTopColor: 'rgb(30 41 59)' })
                        }}
                    />
                </div>
            )}

            {/* 动画样式 */}
            <style>{`
                @keyframes tooltipFadeIn {
                    from {
                        opacity: 0;
                        transform: translateX(-50%) translateY(${tooltip.position === 'bottom' ? '-4px' : '4px'});
                    }
                    to {
                        opacity: 1;
                        transform: translateX(-50%) translateY(0);
                    }
                }
            `}</style>
        </TooltipContext.Provider>
    );
};

/**
 * Tooltip 包装组件 - 用于包装需要 tooltip 的元素
 * 
 * 使用示例：
 * <Tooltip text="提示文字">
 *   <button>按钮</button>
 * </Tooltip>
 */
interface TooltipProps {
    text: string;
    children: React.ReactElement;
    position?: 'top' | 'bottom' | 'auto';
}

export const Tooltip: React.FC<TooltipProps> = ({ text, children }) => {
    // 直接使用 data-tooltip 属性，让 Provider 处理
    return React.cloneElement(
        children,
        { 'data-tooltip': text } as React.HTMLAttributes<HTMLElement>
    );
};

export default FixedTooltipProvider;
