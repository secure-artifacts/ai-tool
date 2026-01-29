/**
 * 统一 UI 组件库
 * 用于整个 AI 创作工具包的 UI 统一化
 */

import React, { ButtonHTMLAttributes, InputHTMLAttributes, HTMLAttributes, forwardRef } from 'react';

// ============================================
// Button 组件
// ============================================

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
    variant?: 'primary' | 'secondary' | 'cta' | 'ghost' | 'danger';
    size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
    fullWidth?: boolean;
    loading?: boolean;
    icon?: React.ReactNode;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(({
    variant = 'secondary',
    size = 'md',
    fullWidth = false,
    loading = false,
    icon,
    children,
    className = '',
    disabled,
    ...props
}, ref) => {
    const baseClass = 'btn';
    const variantClass = `btn-${variant}`;
    const sizeClass = size !== 'md' ? `btn-${size}` : '';
    const fullWidthClass = fullWidth ? 'btn-full' : '';

    const classes = [baseClass, variantClass, sizeClass, fullWidthClass, className]
        .filter(Boolean)
        .join(' ');

    return (
        <button
            ref={ref}
            className={classes}
            disabled={disabled || loading}
            {...props}
        >
            {loading ? (
                <span className="loader small" style={{ width: 16, height: 16, borderWidth: 2, margin: 0 }} />
            ) : icon}
            {children}
        </button>
    );
});

Button.displayName = 'Button';

// ============================================
// Card 组件
// ============================================

export interface CardProps extends HTMLAttributes<HTMLDivElement> {
    variant?: 'default' | 'glass';
    hoverable?: boolean;
    padding?: 'none' | 'sm' | 'md' | 'lg';
}

export const Card = forwardRef<HTMLDivElement, CardProps>(({
    variant = 'default',
    hoverable = false,
    padding = 'md',
    children,
    className = '',
    ...props
}, ref) => {
    const baseClass = 'card';
    const variantClass = variant === 'glass' ? 'card-glass' : '';
    const hoverClass = hoverable ? 'card-hover' : '';
    const paddingClass = padding === 'none' ? 'p-0' : padding === 'sm' ? 'p-2' : padding === 'lg' ? 'p-6' : '';

    const classes = [baseClass, variantClass, hoverClass, paddingClass, className]
        .filter(Boolean)
        .join(' ');

    return (
        <div ref={ref} className={classes} {...props}>
            {children}
        </div>
    );
});

Card.displayName = 'Card';

// ============================================
// Input 组件
// ============================================

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
    error?: boolean;
    fullWidth?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(({
    error = false,
    fullWidth = false,
    className = '',
    ...props
}, ref) => {
    const baseClass = 'input';
    const errorClass = error ? 'input-error' : '';
    const fullWidthClass = fullWidth ? 'w-full' : '';

    const classes = [baseClass, errorClass, fullWidthClass, className]
        .filter(Boolean)
        .join(' ');

    return <input ref={ref} className={classes} {...props} />;
});

Input.displayName = 'Input';

// ============================================
// Textarea 组件
// ============================================

export interface TextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
    error?: boolean;
    fullWidth?: boolean;
}

export const Textarea = forwardRef<HTMLTextAreaElement, TextareaProps>(({
    error = false,
    fullWidth = false,
    className = '',
    ...props
}, ref) => {
    const baseClass = 'textarea';
    const errorClass = error ? 'textarea-error' : '';
    const fullWidthClass = fullWidth ? 'w-full' : '';

    const classes = [baseClass, errorClass, fullWidthClass, className]
        .filter(Boolean)
        .join(' ');

    return <textarea ref={ref} className={classes} {...props} />;
});

Textarea.displayName = 'Textarea';

// ============================================
// Flex 布局组件
// ============================================

export interface FlexProps extends HTMLAttributes<HTMLDivElement> {
    direction?: 'row' | 'col';
    align?: 'start' | 'center' | 'end';
    justify?: 'start' | 'center' | 'end' | 'between';
    gap?: 1 | 2 | 3 | 4 | 6 | 8;
    wrap?: boolean;
}

export const Flex = forwardRef<HTMLDivElement, FlexProps>(({
    direction = 'row',
    align = 'start',
    justify = 'start',
    gap = 2,
    wrap = false,
    children,
    className = '',
    ...props
}, ref) => {
    const classes = [
        'flex',
        direction === 'col' ? 'flex-col' : 'flex-row',
        `items-${align}`,
        `justify-${justify}`,
        `gap-${gap}`,
        wrap ? 'flex-wrap' : '',
        className
    ].filter(Boolean).join(' ');

    return (
        <div ref={ref} className={classes} {...props}>
            {children}
        </div>
    );
});

Flex.displayName = 'Flex';

// ============================================
// Badge 组件
// ============================================

export interface BadgeProps extends HTMLAttributes<HTMLSpanElement> {
    variant?: 'default' | 'success' | 'error' | 'warning' | 'info';
    size?: 'sm' | 'md';
}

export const Badge = forwardRef<HTMLSpanElement, BadgeProps>(({
    variant = 'default',
    size = 'md',
    children,
    className = '',
    ...props
}, ref) => {
    const baseClass = 'badge';
    const variantClass = `badge-${variant}`;
    const sizeClass = size === 'sm' ? 'badge-sm' : '';

    const classes = [baseClass, variantClass, sizeClass, className]
        .filter(Boolean)
        .join(' ');

    return (
        <span ref={ref} className={classes} {...props}>
            {children}
        </span>
    );
});

Badge.displayName = 'Badge';

// ============================================
// 导出所有组件
// ============================================

export default {
    Button,
    Card,
    Input,
    Textarea,
    Flex,
    Badge,
};
