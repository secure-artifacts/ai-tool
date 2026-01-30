/**
 * Image to Prompt Tool - Shared Components
 * 反推提示词工具 - 共享组件
 */

import React, { useState, useRef, useEffect } from 'react';
import { Copy, Check, ChevronDown, Loader2 } from 'lucide-react';
import { copyToClipboard } from '../utils';

/**
 * 加载指示器
 */
export const Loader: React.FC<{ small?: boolean }> = ({ small }) => (
    <div className={`loader ${small ? 'small' : ''}`}></div>
);

/**
 * 提示词显示组件
 * 来自创艺魔盒 2
 */
export const PromptDisplay: React.FC<{ title: string; text: string }> = ({ title, text }) => {
    const [copied, setCopied] = useState(false);

    const handleCopy = async () => {
        const success = await copyToClipboard(text);
        if (success) {
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        }
    };

    return (
        <div className="prompt-display">
            <div className="prompt-header">
                <span className="prompt-title">{title}</span>
                <button
                    onClick={handleCopy}
                    className="copy-btn"
                    title="复制"
                >
                    {copied ? <Check className="w-4 h-4 text-green-400" /> : <Copy className="w-4 h-4" />}
                </button>
            </div>
            <pre className="prompt-text">{text}</pre>
        </div>
    );
};

/**
 * 提示词标签页组件
 * 支持多专家结果展示
 */
interface ExpertPrompt {
    expert: string;
    englishPrompt: string;
    chinesePrompt: string;
}

export const PromptTabs: React.FC<{ prompts: ExpertPrompt[] }> = ({ prompts }) => {
    const [activeTab, setActiveTab] = useState(0);
    const [copied, setCopied] = useState<string | null>(null);

    const handleCopy = async (text: string, key: string) => {
        const success = await copyToClipboard(text);
        if (success) {
            setCopied(key);
            setTimeout(() => setCopied(null), 2000);
        }
    };

    if (!prompts || prompts.length === 0) {
        return <div className="text-zinc-400">No prompts available.</div>;
    }

    const activePrompt = prompts[activeTab];

    return (
        <div className="prompt-tabs">
            {/* Tab Headers */}
            {prompts.length > 1 && (
                <div className="tab-headers">
                    {prompts.map((prompt, index) => (
                        <button
                            key={index}
                            className={`tab-header ${activeTab === index ? 'active' : ''}`}
                            onClick={() => setActiveTab(index)}
                        >
                            {prompt.expert}
                        </button>
                    ))}
                </div>
            )}

            {/* Tab Content */}
            <div className="tab-content">
                {/* English Prompt */}
                <div className="prompt-section">
                    <div className="prompt-section-header">
                        <span className="prompt-section-title">English</span>
                        <button
                            onClick={() => handleCopy(activePrompt.englishPrompt, `en-${activeTab}`)}
                            className="copy-btn-small"
                            title="Copy English prompt"
                        >
                            {copied === `en-${activeTab}` ? (
                                <Check className="w-3.5 h-3.5 text-green-400" />
                            ) : (
                                <Copy className="w-3.5 h-3.5" />
                            )}
                        </button>
                    </div>
                    <pre className="prompt-text">{activePrompt.englishPrompt}</pre>
                </div>

                {/* Chinese Prompt */}
                <div className="prompt-section">
                    <div className="prompt-section-header">
                        <span className="prompt-section-title">中文</span>
                        <button
                            onClick={() => handleCopy(activePrompt.chinesePrompt, `zh-${activeTab}`)}
                            className="copy-btn-small"
                            title="Copy Chinese prompt"
                        >
                            {copied === `zh-${activeTab}` ? (
                                <Check className="w-3.5 h-3.5 text-green-400" />
                            ) : (
                                <Copy className="w-3.5 h-3.5" />
                            )}
                        </button>
                    </div>
                    <pre className="prompt-text">{activePrompt.chinesePrompt}</pre>
                </div>
            </div>
        </div>
    );
};

/**
 * 文件上传组件
 */
interface FileUploaderProps {
    onFileSelect: (files: File | File[]) => void;
    children: React.ReactNode;
    multiple?: boolean;
    accept?: string;
    openOnClick?: boolean;
    onRequestPasteFocus?: () => void;
    pasteZoneId?: string;
    onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}

export const FileUploader: React.FC<FileUploaderProps> = ({
    onFileSelect,
    children,
    multiple = false,
    accept = 'image/*',
    openOnClick = true,
    onRequestPasteFocus,
    pasteZoneId = 'image-to-prompt',
    onPaste
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);
    const labelRef = useRef<HTMLLabelElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [isDragging, setIsDragging] = useState(false);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        setIsDragging(false);

        const files = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length > 0) {
            onFileSelect(multiple ? files : files[0]);
        }
    };

    const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) {
            onFileSelect(multiple ? files : files[0]);
        }
        // 清空 input 以允许重复选择同一文件
        e.target.value = '';
    };

    // 使用定时器区分单击和双击
    const clickTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const handleClick = (e: React.MouseEvent<HTMLLabelElement>) => {
        if (openOnClick) return;

        // 双击检测：如果已有定时器则说明是第二次点击(双击)，清除定时器并打开文件选择
        if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
            fileInputRef.current?.click();
            return;
        }

        // 第一次点击，启动定时器，延迟执行单击逻辑（聚焦 textarea）
        e.preventDefault();
        clickTimerRef.current = setTimeout(() => {
            clickTimerRef.current = null;
            // 聚焦内置的 textarea 或外部的 textarea
            if (onRequestPasteFocus) {
                onRequestPasteFocus();
            } else {
                textareaRef.current?.focus();
            }
        }, 250); // 250ms 内第二次点击视为双击
    };

    const handleKeyDown = (e: React.KeyboardEvent<HTMLLabelElement>) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        fileInputRef.current?.click();
    };

    const handleDoubleClick = () => {
        // 双击也触发文件选择（备用）
        if (clickTimerRef.current) {
            clearTimeout(clickTimerRef.current);
            clickTimerRef.current = null;
        }
        fileInputRef.current?.click();
    };

    // 内置的粘贴处理
    const handleInternalPaste = (e: React.ClipboardEvent<HTMLTextAreaElement>) => {
        // 如果有外部 onPaste 回调，优先使用
        if (onPaste) {
            onPaste(e);
            return;
        }

        // 默认粘贴处理：只处理直接粘贴的图片文件
        const clipboardData = e.clipboardData;
        if (!clipboardData) return;

        // 直接粘贴图片文件
        if (clipboardData.files.length > 0) {
            const imageFiles = Array.from(clipboardData.files).filter(f => f.type.startsWith('image/'));
            if (imageFiles.length > 0) {
                e.preventDefault();
                onFileSelect(multiple ? imageFiles : imageFiles[0]);
                return;
            }
        }

        // 通过 clipboardData.items 获取图片
        const items = Array.from(clipboardData.items || []);
        const imageItems = items.filter(item => item.type.startsWith('image/'));
        if (imageItems.length > 0) {
            const files = imageItems.map(item => item.getAsFile()).filter(Boolean) as File[];
            if (files.length > 0) {
                e.preventDefault();
                onFileSelect(multiple ? files : files[0]);
            }
        }
    };

    return (
        <label
            ref={labelRef}
            className={`file-upload-label ${isDragging ? 'dragging' : ''}`}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={handleClick}
            onDoubleClick={handleDoubleClick}
            onKeyDown={handleKeyDown}
            tabIndex={0}
            role="button"
            data-paste-zone={pasteZoneId}
        >
            {children}
            <input
                ref={fileInputRef}
                type="file"
                accept={accept}
                multiple={multiple}
                onChange={handleFileChange}
                className="d-none"
            />
            {/* 内置隐藏的 textarea 用于接收粘贴事件 */}
            <textarea
                ref={textareaRef}
                onPaste={handleInternalPaste}
                className="visually-hidden"
                aria-hidden="true"
            />
        </label>
    );
};

/**
 * 工具标题栏组件
 */
interface ToolHeaderProps {
    title: string;
    description?: string;
    onReset?: () => void;
    actions?: React.ReactNode;
}

export const ToolHeader: React.FC<ToolHeaderProps> = ({
    title,
    description,
    onReset,
    actions
}) => {
    return (
        <div className="tool-header">
            <div className="tool-header-main">
                <h2>{title}</h2>
                {description && <p className="tool-description">{description}</p>}
            </div>
            <div className="tool-header-actions">
                {actions}
                {onReset && (
                    <button onClick={onReset} className="reset-btn" title="重置">
                        重置
                    </button>
                )}
            </div>
        </div>
    );
};

/**
 * 模式切换按钮组
 */
interface ModeToggleProps {
    modes: { key: string; label: string }[];
    activeMode: string;
    onModeChange: (mode: string) => void;
}

export const ModeToggle: React.FC<ModeToggleProps> = ({ modes, activeMode, onModeChange }) => {
    return (
        <div className="mode-toggle">
            {modes.map(mode => (
                <button
                    key={mode.key}
                    className={`toggle-btn ${activeMode === mode.key ? 'active' : ''}`}
                    onClick={() => onModeChange(mode.key)}
                >
                    {mode.label}
                </button>
            ))}
        </div>
    );
};
