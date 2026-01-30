/**
 * ⌨️ 快捷键帮助面板
 * 显示所有可用的键盘快捷键
 */

import React, { useState } from 'react';
import { KEYBOARD_SHORTCUTS, formatShortcut, type ShortcutConfig } from '../hooks/useKeyboardShortcuts';
import { Keyboard, X } from 'lucide-react';

interface ShortcutsHelpPanelProps {
    isOpen?: boolean;
    onClose?: () => void;
}

const CATEGORY_LABELS: Record<string, string> = {
    node: '节点操作',
    edit: '编辑操作',
    view: '视图操作',
    file: '文件操作',
    ai: 'AI 操作',
};

export const ShortcutsHelpPanel: React.FC<ShortcutsHelpPanelProps> = ({
    isOpen: controlledOpen,
    onClose,
}) => {
    const [internalOpen, setInternalOpen] = useState(false);

    const isOpen = controlledOpen !== undefined ? controlledOpen : internalOpen;
    const handleClose = onClose || (() => setInternalOpen(false));
    const handleOpen = () => setInternalOpen(true);

    // 按分类分组快捷键
    const groupedShortcuts = KEYBOARD_SHORTCUTS.reduce((acc, shortcut) => {
        if (!acc[shortcut.category]) {
            acc[shortcut.category] = [];
        }
        // 过滤重复的操作（如 Delete 和 Backspace 都是删除）
        const existingAction = acc[shortcut.category].find(s => s.action === shortcut.action);
        if (!existingAction) {
            acc[shortcut.category].push(shortcut);
        }
        return acc;
    }, {} as Record<string, ShortcutConfig[]>);

    return (
        <>
            {/* 触发按钮 */}
            <div className="shortcuts-help-panel">
                <button
                    className="shortcuts-help-trigger"
                    onClick={handleOpen}
                    data-tip="键盘快捷键" className="tooltip-bottom"
                >
                    <Keyboard size={18} />
                </button>
            </div>

            {/* 模态框 */}
            {isOpen && (
                <div className="shortcuts-modal" onClick={handleClose}>
                    <div
                        className="shortcuts-modal-content"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="shortcuts-modal-header">
                            <h3>
                                <Keyboard size={18} />
                                键盘快捷键
                            </h3>
                            <button className="shortcuts-modal-close" onClick={handleClose}>
                                <X size={18} />
                            </button>
                        </div>

                        <div className="shortcuts-modal-body">
                            {Object.entries(groupedShortcuts).map(([category, shortcuts]) => (
                                <div key={category} className="shortcuts-category">
                                    <div className="shortcuts-category-title">
                                        {CATEGORY_LABELS[category] || category}
                                    </div>
                                    <div className="shortcuts-list">
                                        {shortcuts.map((shortcut) => (
                                            <div key={shortcut.action} className="shortcut-item">
                                                <span className="shortcut-label">{shortcut.label}</span>
                                                <span className="shortcut-key">{formatShortcut(shortcut)}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
