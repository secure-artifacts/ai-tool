/**
 * Tooltip 组件 - 使用 Portal 渲染避免被容器裁切
 * 
 * 用法：
 * <Tooltip content="提示文字">
 *   <button>按钮</button>
 * </Tooltip>
 * 
 * 或者带有延迟：
 * <Tooltip content="提示文字" delay={300}>
 *   <span>文字</span>
 * </Tooltip>
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

export type TooltipPosition = 'top' | 'bottom' | 'left' | 'right';

interface TooltipProps {
    /** 提示内容 */
    content: React.ReactNode;
    /** 子元素（触发器） */
    children: React.ReactElement;
    /** 显示位置，默认 'top' */
    position?: TooltipPosition;
    /** 显示延迟（毫秒），默认 200 */
    delay?: number;
    /** 是否禁用 tooltip */
    disabled?: boolean;
    /** 额外的 CSS 类名 */
    className?: string;
    /** 最大宽度（像素），默认 300 */
    maxWidth?: number;
}

interface TooltipPosition2D {
    top: number;
    left: number;
}

const ARROW_SIZE = 6;
const OFFSET = 8;

export const Tooltip: React.FC<TooltipProps> = ({
    content,
    children,
    position = 'top',
    delay = 200,
    disabled = false,
    className = '',
    maxWidth = 300
}) => {
    const [isVisible, setIsVisible] = useState(false);
    const [coords, setCoords] = useState<TooltipPosition2D>({ top: 0, left: 0 });
    const [actualPosition, setActualPosition] = useState<TooltipPosition>(position);

    const triggerRef = useRef<HTMLElement | null>(null);
    const tooltipRef = useRef<HTMLDivElement>(null);
    const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // 计算 tooltip 位置
    const calculatePosition = useCallback(() => {
        if (!triggerRef.current || !tooltipRef.current) return;

        const triggerRect = triggerRef.current.getBoundingClientRect();
        const tooltipRect = tooltipRef.current.getBoundingClientRect();
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        let newPosition = position;
        let top = 0;
        let left = 0;

        // 计算各方向的位置
        const positions: Record<TooltipPosition, TooltipPosition2D> = {
            top: {
                top: triggerRect.top - tooltipRect.height - OFFSET,
                left: triggerRect.left + (triggerRect.width - tooltipRect.width) / 2
            },
            bottom: {
                top: triggerRect.bottom + OFFSET,
                left: triggerRect.left + (triggerRect.width - tooltipRect.width) / 2
            },
            left: {
                top: triggerRect.top + (triggerRect.height - tooltipRect.height) / 2,
                left: triggerRect.left - tooltipRect.width - OFFSET
            },
            right: {
                top: triggerRect.top + (triggerRect.height - tooltipRect.height) / 2,
                left: triggerRect.right + OFFSET
            }
        };

        // 检查是否超出视口，自动调整方向
        const checkBounds = (pos: TooltipPosition): boolean => {
            const { top, left } = positions[pos];
            if (pos === 'top' && top < 0) return false;
            if (pos === 'bottom' && top + tooltipRect.height > viewportHeight) return false;
            if (pos === 'left' && left < 0) return false;
            if (pos === 'right' && left + tooltipRect.width > viewportWidth) return false;
            return true;
        };

        // 尝试使用偏好位置，否则用备选
        const fallbacks: Record<TooltipPosition, TooltipPosition[]> = {
            top: ['bottom', 'left', 'right'],
            bottom: ['top', 'left', 'right'],
            left: ['right', 'top', 'bottom'],
            right: ['left', 'top', 'bottom']
        };

        if (!checkBounds(position)) {
            for (const fallback of fallbacks[position]) {
                if (checkBounds(fallback)) {
                    newPosition = fallback;
                    break;
                }
            }
        }

        ({ top, left } = positions[newPosition]);

        // 确保不超出左右边界
        left = Math.max(8, Math.min(left, viewportWidth - tooltipRect.width - 8));
        // 确保不超出上下边界
        top = Math.max(8, Math.min(top, viewportHeight - tooltipRect.height - 8));

        setCoords({ top, left });
        setActualPosition(newPosition);
    }, [position]);

    // 显示 tooltip
    const showTooltip = useCallback(() => {
        if (disabled || !content) return;

        timeoutRef.current = setTimeout(() => {
            setIsVisible(true);
        }, delay);
    }, [disabled, content, delay]);

    // 隐藏 tooltip
    const hideTooltip = useCallback(() => {
        if (timeoutRef.current) {
            clearTimeout(timeoutRef.current);
            timeoutRef.current = null;
        }
        setIsVisible(false);
    }, []);

    // 位置更新
    useEffect(() => {
        if (isVisible) {
            // 使用 RAF 确保 DOM 已挂载
            requestAnimationFrame(() => {
                calculatePosition();
            });
        }
    }, [isVisible, calculatePosition]);

    // 清理定时器
    useEffect(() => {
        return () => {
            if (timeoutRef.current) {
                clearTimeout(timeoutRef.current);
            }
        };
    }, []);

    // 滚动时隐藏
    useEffect(() => {
        if (isVisible) {
            const handleScroll = () => hideTooltip();
            window.addEventListener('scroll', handleScroll, true);
            return () => window.removeEventListener('scroll', handleScroll, true);
        }
    }, [isVisible, hideTooltip]);

    // 克隆子元素并添加事件
    const childProps = children.props as Record<string, any>;
    const trigger = React.cloneElement(children, {
        ref: (node: HTMLElement) => {
            triggerRef.current = node;
            // 保留原有的 ref
            const childRef = (children as any).ref;
            if (typeof childRef === 'function') {
                childRef(node);
            } else if (childRef) {
                childRef.current = node;
            }
        },
        onMouseEnter: (e: React.MouseEvent) => {
            showTooltip();
            childProps.onMouseEnter?.(e);
        },
        onMouseLeave: (e: React.MouseEvent) => {
            hideTooltip();
            childProps.onMouseLeave?.(e);
        },
        onFocus: (e: React.FocusEvent) => {
            showTooltip();
            childProps.onFocus?.(e);
        },
        onBlur: (e: React.FocusEvent) => {
            hideTooltip();
            childProps.onBlur?.(e);
        }
    } as any);

    // Tooltip 内容
    const tooltipContent = isVisible && content ? createPortal(
        <div
            ref={tooltipRef}
            className={`ui-tooltip ui-tooltip-${actualPosition} ${className}`}
            style={{
                top: coords.top,
                left: coords.left,
                maxWidth
            }}
            role="tooltip"
        >
            <div className="ui-tooltip-content">
                {content}
            </div>
            <div className="ui-tooltip-arrow" />
        </div>,
        document.body
    ) : null;

    return (
        <>
            {trigger}
            {tooltipContent}
        </>
    );
};

export default Tooltip;
