/**
 * 🎹 WiseMapping 风格键盘快捷键系统
 * 全局快捷键 Hook，支持标准 Mind Map 操作
 */

import { useEffect, useCallback, useRef } from 'react';
import { useMindMapStore } from '../store/mindMapStore';

// 快捷键配置
export interface ShortcutConfig {
    key: string;
    ctrl?: boolean;
    shift?: boolean;
    alt?: boolean;
    meta?: boolean;
    action: string;
    label: string;
    category: 'node' | 'edit' | 'view' | 'file' | 'ai';
}

// WiseMapping 风格快捷键列表
export const KEYBOARD_SHORTCUTS: ShortcutConfig[] = [
    // 节点操作
    { key: 'Tab', action: 'addChild', label: '添加子节点', category: 'node' },
    { key: 'Enter', action: 'addSibling', label: '添加兄弟节点', category: 'node' },
    { key: 'Delete', action: 'deleteNode', label: '删除节点', category: 'node' },
    { key: 'Backspace', action: 'deleteNode', label: '删除节点', category: 'node' },
    { key: 'F2', action: 'renameNode', label: '重命名节点', category: 'node' },
    { key: 'Space', action: 'toggleCollapse', label: '展开/折叠', category: 'node' },

    // 编辑操作
    { key: 'z', ctrl: true, action: 'undo', label: '撤销', category: 'edit' },
    { key: 'z', ctrl: true, shift: true, action: 'redo', label: '重做', category: 'edit' },
    { key: 'y', ctrl: true, action: 'redo', label: '重做', category: 'edit' },
    { key: 'c', ctrl: true, action: 'copy', label: '复制', category: 'edit' },
    { key: 'v', ctrl: true, action: 'paste', label: '粘贴', category: 'edit' },
    { key: 'x', ctrl: true, action: 'cut', label: '剪切', category: 'edit' },
    { key: 'a', ctrl: true, action: 'selectAll', label: '全选', category: 'edit' },

    // 文件操作
    { key: 's', ctrl: true, action: 'save', label: '保存', category: 'file' },
    { key: 'e', ctrl: true, action: 'export', label: '导出', category: 'file' },
    { key: 'n', ctrl: true, action: 'newMap', label: '新建导图', category: 'file' },

    // 视图操作
    { key: '+', ctrl: true, action: 'zoomIn', label: '放大', category: 'view' },
    { key: '-', ctrl: true, action: 'zoomOut', label: '缩小', category: 'view' },
    { key: '0', ctrl: true, action: 'zoomReset', label: '重置缩放', category: 'view' },
    { key: 'f', ctrl: true, action: 'search', label: '搜索节点', category: 'view' },

    // 导航
    { key: 'ArrowUp', action: 'navUp', label: '向上移动', category: 'node' },
    { key: 'ArrowDown', action: 'navDown', label: '向下移动', category: 'node' },
    { key: 'ArrowLeft', action: 'navLeft', label: '向左移动', category: 'node' },
    { key: 'ArrowRight', action: 'navRight', label: '向右移动', category: 'node' },

    // AI 操作
    { key: 'g', ctrl: true, action: 'aiGenerate', label: 'AI 生成子节点', category: 'ai' },
    { key: 'e', ctrl: true, shift: true, action: 'aiExpand', label: 'AI 扩展', category: 'ai' },
];

// 剪贴板数据
interface ClipboardData {
    nodeId: string;
    label: string;
    notes?: string;
    children?: string[];
    isCut: boolean;
}

export function useKeyboardShortcuts() {
    const {
        currentMap,
        selectedNodeId,
        selectNode,
        addNode,
        deleteNode,
        updateNode,
        toggleCollapse,
        undo,
        redo,
        saveCurrentMap,
        openAiExpand,
    } = useMindMapStore();

    const clipboardRef = useRef<ClipboardData | null>(null);
    const renameCallbackRef = useRef<((nodeId: string) => void) | null>(null);

    // 设置重命名回调
    const setRenameCallback = useCallback((callback: (nodeId: string) => void) => {
        renameCallbackRef.current = callback;
    }, []);

    // 获取节点的兄弟节点
    const getSiblings = useCallback((nodeId: string): string[] => {
        if (!currentMap) return [];
        const node = currentMap.nodes[nodeId];
        if (!node?.parentId) return [];
        const parent = currentMap.nodes[node.parentId];
        return parent?.children || [];
    }, [currentMap]);

    // 导航到相邻节点
    const navigateNode = useCallback((direction: 'up' | 'down' | 'left' | 'right') => {
        if (!currentMap || !selectedNodeId) return;

        const node = currentMap.nodes[selectedNodeId];
        if (!node) return;

        switch (direction) {
            case 'up':
            case 'down': {
                // 在兄弟节点间移动
                const siblings = getSiblings(selectedNodeId);
                const currentIndex = siblings.indexOf(selectedNodeId);
                if (currentIndex === -1) return;

                const newIndex = direction === 'up'
                    ? Math.max(0, currentIndex - 1)
                    : Math.min(siblings.length - 1, currentIndex + 1);

                if (newIndex !== currentIndex) {
                    selectNode(siblings[newIndex]);
                }
                break;
            }
            case 'left': {
                // 移动到父节点
                if (node.parentId) {
                    selectNode(node.parentId);
                }
                break;
            }
            case 'right': {
                // 移动到第一个子节点
                if (node.children && node.children.length > 0) {
                    selectNode(node.children[0]);
                }
                break;
            }
        }
    }, [currentMap, selectedNodeId, selectNode, getSiblings]);

    // 添加兄弟节点
    const addSiblingNode = useCallback(() => {
        if (!currentMap || !selectedNodeId) return;
        const node = currentMap.nodes[selectedNodeId];
        if (node?.parentId) {
            addNode(node.parentId, '新主题');
        }
    }, [currentMap, selectedNodeId, addNode]);

    // 复制节点
    const copyNode = useCallback(() => {
        if (!currentMap || !selectedNodeId) return;
        const node = currentMap.nodes[selectedNodeId];
        if (!node) return;

        clipboardRef.current = {
            nodeId: selectedNodeId,
            label: node.label,
            notes: node.notes,
            children: node.children,
            isCut: false,
        };
    }, [currentMap, selectedNodeId]);

    // 剪切节点
    const cutNode = useCallback(() => {
        if (!currentMap || !selectedNodeId) return;
        if (selectedNodeId === currentMap.rootId) return; // 不能剪切根节点

        const node = currentMap.nodes[selectedNodeId];
        if (!node) return;

        clipboardRef.current = {
            nodeId: selectedNodeId,
            label: node.label,
            notes: node.notes,
            children: node.children,
            isCut: true,
        };
    }, [currentMap, selectedNodeId]);

    // 粘贴节点
    const pasteNode = useCallback(() => {
        if (!currentMap || !selectedNodeId || !clipboardRef.current) return;

        const { label, notes, isCut, nodeId: sourceNodeId } = clipboardRef.current;

        // 添加新节点
        addNode(selectedNodeId, label + (isCut ? '' : ' (副本)'), undefined, notes);

        // 如果是剪切，删除原节点
        if (isCut && sourceNodeId && sourceNodeId !== currentMap.rootId) {
            deleteNode(sourceNodeId);
            clipboardRef.current = null;
        }
    }, [currentMap, selectedNodeId, addNode, deleteNode]);

    // 触发重命名
    const triggerRename = useCallback(() => {
        if (selectedNodeId && renameCallbackRef.current) {
            renameCallbackRef.current(selectedNodeId);
        }
    }, [selectedNodeId]);

    // 匹配快捷键
    const matchShortcut = useCallback((e: KeyboardEvent, shortcut: ShortcutConfig): boolean => {
        const ctrlMatch = shortcut.ctrl ? (e.ctrlKey || e.metaKey) : !(e.ctrlKey || e.metaKey);
        const shiftMatch = shortcut.shift ? e.shiftKey : !e.shiftKey;
        const altMatch = shortcut.alt ? e.altKey : !e.altKey;
        const keyMatch = e.key.toLowerCase() === shortcut.key.toLowerCase();

        return ctrlMatch && shiftMatch && altMatch && keyMatch;
    }, []);

    // 执行快捷键动作
    const executeAction = useCallback((action: string, e: KeyboardEvent) => {
        switch (action) {
            case 'addChild':
                if (selectedNodeId) {
                    e.preventDefault();
                    addNode(selectedNodeId, '新主题');
                }
                break;

            case 'addSibling':
                e.preventDefault();
                addSiblingNode();
                break;

            case 'deleteNode':
                if (selectedNodeId && currentMap && selectedNodeId !== currentMap.rootId) {
                    e.preventDefault();
                    deleteNode(selectedNodeId);
                }
                break;

            case 'renameNode':
                e.preventDefault();
                triggerRename();
                break;

            case 'toggleCollapse':
                if (selectedNodeId) {
                    e.preventDefault();
                    toggleCollapse(selectedNodeId);
                }
                break;

            case 'undo':
                e.preventDefault();
                undo();
                break;

            case 'redo':
                e.preventDefault();
                redo();
                break;

            case 'copy':
                e.preventDefault();
                copyNode();
                break;

            case 'paste':
                e.preventDefault();
                pasteNode();
                break;

            case 'cut':
                e.preventDefault();
                cutNode();
                break;

            case 'save':
                e.preventDefault();
                saveCurrentMap();
                break;

            case 'navUp':
                e.preventDefault();
                navigateNode('up');
                break;

            case 'navDown':
                e.preventDefault();
                navigateNode('down');
                break;

            case 'navLeft':
                e.preventDefault();
                navigateNode('left');
                break;

            case 'navRight':
                e.preventDefault();
                navigateNode('right');
                break;

            case 'aiExpand':
                if (selectedNodeId) {
                    e.preventDefault();
                    openAiExpand(selectedNodeId);
                }
                break;

            case 'search':
                e.preventDefault();
                // 触发搜索面板
                window.dispatchEvent(new CustomEvent('mindmap-open-search'));
                break;

            case 'export':
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('mindmap-export'));
                break;

            case 'newMap':
                e.preventDefault();
                window.dispatchEvent(new CustomEvent('mindmap-new'));
                break;

            default:
                break;
        }
    }, [
        selectedNodeId,
        currentMap,
        addNode,
        deleteNode,
        addSiblingNode,
        triggerRename,
        toggleCollapse,
        undo,
        redo,
        copyNode,
        pasteNode,
        cutNode,
        saveCurrentMap,
        navigateNode,
        openAiExpand,
    ]);

    // 主键盘事件处理
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            // 忽略输入框中的键盘事件
            if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) {
                return;
            }

            // 🔧 修复：只有当焦点在思维导图区域内时，才处理编辑类快捷键
            // 这样可以避免影响其他模块的复制/粘贴功能
            const mindMapContainer = document.querySelector('.mind-map-app');
            const isInMindMap = mindMapContainer?.contains(document.activeElement) ||
                mindMapContainer?.contains(e.target as Node);

            // 匹配所有快捷键
            for (const shortcut of KEYBOARD_SHORTCUTS) {
                if (matchShortcut(e, shortcut)) {
                    // 编辑类快捷键（copy, paste, cut, selectAll）只在思维导图区域内生效
                    const editActions = ['copy', 'paste', 'cut', 'selectAll'];
                    if (editActions.includes(shortcut.action) && !isInMindMap) {
                        // 不拦截，让浏览器默认处理
                        return;
                    }
                    executeAction(shortcut.action, e);
                    return;
                }
            }
        };

        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [matchShortcut, executeAction]);

    return {
        shortcuts: KEYBOARD_SHORTCUTS,
        setRenameCallback,
        copyNode,
        cutNode,
        pasteNode,
        hasClipboard: () => clipboardRef.current !== null,
    };
}

// 格式化快捷键显示
export function formatShortcut(shortcut: ShortcutConfig): string {
    const parts: string[] = [];

    if (shortcut.ctrl) {
        parts.push(navigator.platform.includes('Mac') ? '⌘' : 'Ctrl');
    }
    if (shortcut.shift) {
        parts.push('⇧');
    }
    if (shortcut.alt) {
        parts.push(navigator.platform.includes('Mac') ? '⌥' : 'Alt');
    }

    // 格式化按键名称
    let keyName = shortcut.key;
    switch (shortcut.key) {
        case 'Tab': keyName = '⇥'; break;
        case 'Enter': keyName = '↵'; break;
        case 'Delete': keyName = 'Del'; break;
        case 'Backspace': keyName = '⌫'; break;
        case 'Space': keyName = '␣'; break;
        case 'ArrowUp': keyName = '↑'; break;
        case 'ArrowDown': keyName = '↓'; break;
        case 'ArrowLeft': keyName = '←'; break;
        case 'ArrowRight': keyName = '→'; break;
        default: keyName = shortcut.key.toUpperCase();
    }

    parts.push(keyName);
    return parts.join('+');
}
