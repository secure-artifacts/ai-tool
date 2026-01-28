/**
 * 🖱️ WiseMapping 风格右键上下文菜单
 * 用于节点和画布的上下文操作
 */

import React, { useEffect, useRef, useState, useCallback } from 'react';
import { useMindMapStore } from '../store/mindMapStore';
import { formatShortcut, KEYBOARD_SHORTCUTS, type ShortcutConfig } from '../hooks/useKeyboardShortcuts';
import {
    Plus,
    Trash2,
    Edit3,
    Copy,
    Scissors,
    ClipboardPaste,
    ChevronDown,
    ChevronUp,
    Sparkles,
    Link,
    MessageSquare,
    Palette,
    Flag,
} from 'lucide-react';

export interface ContextMenuPosition {
    x: number;
    y: number;
}

export interface ContextMenuProps {
    position: ContextMenuPosition | null;
    nodeId: string | null;
    onClose: () => void;
    onCopy?: () => void;
    onCut?: () => void;
    onPaste?: () => void;
    onRename?: (nodeId: string) => void;
    hasClipboard?: boolean;
}

interface MenuItem {
    id: string;
    label: string;
    icon: React.ReactNode;
    shortcut?: string;
    action: () => void;
    disabled?: boolean;
    divider?: boolean;
    submenu?: MenuItem[];
}

export const ContextMenu: React.FC<ContextMenuProps> = ({
    position,
    nodeId,
    onClose,
    onCopy,
    onCut,
    onPaste,
    onRename,
    hasClipboard = false,
}) => {
    const menuRef = useRef<HTMLDivElement>(null);
    const [submenuOpen, setSubmenuOpen] = useState<string | null>(null);

    const {
        currentMap,
        addNode,
        deleteNode,
        toggleCollapse,
        openAiExpand,
        updateNode,
    } = useMindMapStore();

    // 获取快捷键显示
    const getShortcut = useCallback((action: string): string => {
        const shortcut = KEYBOARD_SHORTCUTS.find(s => s.action === action);
        return shortcut ? formatShortcut(shortcut) : '';
    }, []);

    // 点击外部关闭
    useEffect(() => {
        const handleClickOutside = (e: MouseEvent) => {
            if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
                onClose();
            }
        };

        const handleScroll = () => onClose();
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onClose();
        };

        document.addEventListener('mousedown', handleClickOutside);
        document.addEventListener('scroll', handleScroll, true);
        document.addEventListener('keydown', handleKeyDown);

        return () => {
            document.removeEventListener('mousedown', handleClickOutside);
            document.removeEventListener('scroll', handleScroll, true);
            document.removeEventListener('keydown', handleKeyDown);
        };
    }, [onClose]);

    // 调整菜单位置防止溢出
    useEffect(() => {
        if (position && menuRef.current) {
            const menu = menuRef.current;
            const rect = menu.getBoundingClientRect();
            const viewportWidth = window.innerWidth;
            const viewportHeight = window.innerHeight;

            let { x, y } = position;

            if (x + rect.width > viewportWidth) {
                x = viewportWidth - rect.width - 10;
            }
            if (y + rect.height > viewportHeight) {
                y = viewportHeight - rect.height - 10;
            }

            menu.style.left = `${Math.max(10, x)}px`;
            menu.style.top = `${Math.max(10, y)}px`;
        }
    }, [position]);

    if (!position) return null;

    const node = nodeId && currentMap?.nodes[nodeId];
    const isRoot = nodeId === currentMap?.rootId;
    const hasChildren = node && node.children && node.children.length > 0;
    const isCollapsed = node?.collapsed;

    // 构建菜单项
    const menuItems: MenuItem[] = [
        // 节点操作
        {
            id: 'addChild',
            label: '添加子节点',
            icon: <Plus size={16} />,
            shortcut: getShortcut('addChild'),
            action: () => {
                if (nodeId) addNode(nodeId, '新主题');
                onClose();
            },
        },
        {
            id: 'addSibling',
            label: '添加兄弟节点',
            icon: <Plus size={16} />,
            shortcut: getShortcut('addSibling'),
            action: () => {
                if (nodeId && node?.parentId) {
                    addNode(node.parentId, '新主题');
                }
                onClose();
            },
            disabled: isRoot,
        },
        { id: 'div1', label: '', icon: null, action: () => { }, divider: true },

        // 编辑操作
        {
            id: 'rename',
            label: '重命名',
            icon: <Edit3 size={16} />,
            shortcut: 'F2',
            action: () => {
                if (nodeId && onRename) onRename(nodeId);
                onClose();
            },
        },
        {
            id: 'copy',
            label: '复制',
            icon: <Copy size={16} />,
            shortcut: getShortcut('copy'),
            action: () => {
                if (onCopy) onCopy();
                onClose();
            },
        },
        {
            id: 'cut',
            label: '剪切',
            icon: <Scissors size={16} />,
            shortcut: getShortcut('cut'),
            action: () => {
                if (onCut) onCut();
                onClose();
            },
            disabled: isRoot,
        },
        {
            id: 'paste',
            label: '粘贴',
            icon: <ClipboardPaste size={16} />,
            shortcut: getShortcut('paste'),
            action: () => {
                if (onPaste) onPaste();
                onClose();
            },
            disabled: !hasClipboard,
        },
        { id: 'div2', label: '', icon: null, action: () => { }, divider: true },

        // 展开/折叠
        {
            id: 'toggleCollapse',
            label: isCollapsed ? '展开子节点' : '折叠子节点',
            icon: isCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />,
            shortcut: getShortcut('toggleCollapse'),
            action: () => {
                if (nodeId) toggleCollapse(nodeId);
                onClose();
            },
            disabled: !hasChildren,
        },
        { id: 'div3', label: '', icon: null, action: () => { }, divider: true },

        // 附加内容
        {
            id: 'addLink',
            label: '添加链接',
            icon: <Link size={16} />,
            action: () => {
                const url = prompt('请输入链接 URL:', node?.link || 'https://');
                if (url && nodeId) {
                    updateNode(nodeId, { link: url });
                }
                onClose();
            },
        },
        {
            id: 'addNote',
            label: '添加备注',
            icon: <MessageSquare size={16} />,
            action: () => {
                const notes = prompt('请输入备注:', node?.notes || '');
                if (notes !== null && nodeId) {
                    updateNode(nodeId, { notes });
                }
                onClose();
            },
        },
        { id: 'div4', label: '', icon: null, action: () => { }, divider: true },

        // 样式
        {
            id: 'style',
            label: '节点样式',
            icon: <Palette size={16} />,
            action: () => {
                window.dispatchEvent(new CustomEvent('mindmap-open-style', { detail: { nodeId } }));
                onClose();
            },
        },
        {
            id: 'marker',
            label: '添加标记',
            icon: <Flag size={16} />,
            action: () => {
                window.dispatchEvent(new CustomEvent('mindmap-open-marker', { detail: { nodeId } }));
                onClose();
            },
        },
        { id: 'div5', label: '', icon: null, action: () => { }, divider: true },

        // AI 操作
        {
            id: 'aiExpand',
            label: 'AI 扩展节点',
            icon: <Sparkles size={16} />,
            shortcut: getShortcut('aiExpand'),
            action: () => {
                if (nodeId) openAiExpand(nodeId);
                onClose();
            },
        },
        { id: 'div6', label: '', icon: null, action: () => { }, divider: true },

        // 删除
        {
            id: 'delete',
            label: '删除节点',
            icon: <Trash2 size={16} />,
            shortcut: getShortcut('deleteNode'),
            action: () => {
                if (nodeId && !isRoot) {
                    deleteNode(nodeId);
                }
                onClose();
            },
            disabled: isRoot,
        },
    ];

    return (
        <div
            ref={menuRef}
            className="context-menu"
            style={{
                position: 'fixed',
                left: position.x,
                top: position.y,
                zIndex: 9999,
            }}
        >
            {menuItems.map((item) => {
                if (item.divider) {
                    return <div key={item.id} className="context-menu-divider" />;
                }

                return (
                    <button
                        key={item.id}
                        className={`context-menu-item ${item.disabled ? 'disabled' : ''}`}
                        onClick={item.disabled ? undefined : item.action}
                        disabled={item.disabled}
                    >
                        <span className="context-menu-icon">{item.icon}</span>
                        <span className="context-menu-label">{item.label}</span>
                        {item.shortcut && (
                            <span className="context-menu-shortcut">{item.shortcut}</span>
                        )}
                    </button>
                );
            })}
        </div>
    );
};

// CSS 样式（添加到 mind-map.css）
export const contextMenuStyles = `
/* 右键上下文菜单 */
.context-menu {
    min-width: 200px;
    background: rgba(30, 30, 40, 0.98);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 12px;
    box-shadow: 0 8px 32px rgba(0, 0, 0, 0.4), 0 0 0 1px rgba(255, 255, 255, 0.05);
    backdrop-filter: blur(20px);
    padding: 6px;
    overflow: hidden;
}

.context-menu-item {
    display: flex;
    align-items: center;
    gap: 10px;
    width: 100%;
    padding: 10px 12px;
    border: none;
    background: transparent;
    color: #e0e0e0;
    font-size: 13px;
    text-align: left;
    cursor: pointer;
    border-radius: 8px;
    transition: all 0.15s ease;
}

.context-menu-item:hover:not(.disabled) {
    background: rgba(99, 102, 241, 0.2);
    color: #fff;
}

.context-menu-item.disabled {
    color: #666;
    cursor: not-allowed;
    opacity: 0.5;
}

.context-menu-icon {
    display: flex;
    align-items: center;
    justify-content: center;
    width: 20px;
    height: 20px;
    color: inherit;
    opacity: 0.8;
}

.context-menu-label {
    flex: 1;
}

.context-menu-shortcut {
    font-size: 11px;
    color: #888;
    background: rgba(255, 255, 255, 0.08);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: system-ui, -apple-system, sans-serif;
}

.context-menu-divider {
    height: 1px;
    background: rgba(255, 255, 255, 0.1);
    margin: 6px 0;
}
`;
