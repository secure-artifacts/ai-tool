/**
 * TabBar 组件 - AI 图片识别多标签页管理
 * 支持：新建标签页、切换标签页、重命名、删除
 */
import React, { useState, useRef, useEffect } from 'react';
import { Plus, X, Edit2, Check } from 'lucide-react';
import { RecognitionTab, createDefaultTab } from '../types';

interface TabBarProps {
    tabs: RecognitionTab[];
    activeTabId: string;
    onTabChange: (tabId: string) => void;
    onTabAdd: () => void;
    onTabRemove: (tabId: string) => void;
    onTabRename: (tabId: string, newName: string) => void;
}

const TabBar: React.FC<TabBarProps> = ({
    tabs,
    activeTabId,
    onTabChange,
    onTabAdd,
    onTabRemove,
    onTabRename
}) => {
    const [editingTabId, setEditingTabId] = useState<string | null>(null);
    const [editingName, setEditingName] = useState('');
    const inputRef = useRef<HTMLInputElement>(null);

    // 当进入编辑模式时聚焦输入框
    useEffect(() => {
        if (editingTabId && inputRef.current) {
            inputRef.current.focus();
            inputRef.current.select();
        }
    }, [editingTabId]);

    const handleStartEdit = (tab: RecognitionTab, e: React.MouseEvent) => {
        e.stopPropagation();
        setEditingTabId(tab.id);
        setEditingName(tab.name);
    };

    const handleConfirmEdit = () => {
        if (editingTabId && editingName.trim()) {
            onTabRename(editingTabId, editingName.trim());
        }
        setEditingTabId(null);
        setEditingName('');
    };

    const handleCancelEdit = () => {
        setEditingTabId(null);
        setEditingName('');
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            handleConfirmEdit();
        } else if (e.key === 'Escape') {
            handleCancelEdit();
        }
    };

    const handleRemoveTab = (tabId: string, e: React.MouseEvent) => {
        e.stopPropagation();
        if (tabs.length <= 1) {
            // 至少保留一个标签页
            return;
        }
        onTabRemove(tabId);
    };

    return (
        <div className="ai-recognition-tabbar flex items-center gap-1 px-2 py-1 bg-zinc-900/50 border-b border-zinc-800 overflow-x-auto scrollbar-thin scrollbar-thumb-zinc-700 scrollbar-track-transparent">
            {tabs.map((tab) => {
                const isActive = tab.id === activeTabId;
                const isEditing = editingTabId === tab.id;

                return (
                    <div
                        key={tab.id}
                        className={`
                            ai-recognition-tab group flex items-center gap-1.5 px-3 py-1.5 rounded-md cursor-pointer
                            transition-all duration-150 select-none min-w-[100px] max-w-[200px]
                            ${isActive ? 'is-active' : 'is-inactive'}
                            ${isActive
                                ? 'bg-teal-600/30 text-teal-400 border border-teal-600/50'
                                : 'bg-zinc-800/50 text-zinc-400 border border-transparent hover:bg-zinc-700/50 hover:text-zinc-300'
                            }
                        `}
                        onClick={() => !isEditing && onTabChange(tab.id)}
                    >
                        {isEditing ? (
                            <div className="flex items-center gap-1 flex-1">
                                <input
                                    ref={inputRef}
                                    type="text"
                                    value={editingName}
                                    onChange={(e) => setEditingName(e.target.value)}
                                    onKeyDown={handleKeyDown}
                                    onBlur={handleConfirmEdit}
                                    className="flex-1 bg-zinc-900 border border-teal-500 rounded px-1.5 py-0.5 text-sm text-zinc-100 outline-none min-w-[60px]"
                                    onClick={(e) => e.stopPropagation()}
                                />
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleConfirmEdit();
                                    }}
                                    className="p-0.5 text-teal-400 hover:text-teal-300"
                                >
                                    <Check size={14} />
                                </button>
                            </div>
                        ) : (
                            <>
                                {/* 标签页名称 */}
                                <span className="flex-1 text-sm truncate" title={tab.name}>
                                    {tab.name}
                                </span>

                                {/* 图片数量 */}
                                {tab.images.length > 0 && (
                                    <span className={`
                                        text-xs px-1.5 py-0.5 rounded-full
                                        ${isActive ? 'bg-teal-600/40 text-teal-300' : 'bg-zinc-700/60 text-zinc-400'}
                                    `}>
                                        {tab.images.length}
                                    </span>
                                )}

                                {/* 操作按钮 - 鼠标悬停时显示 */}
                                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <button
                                        onClick={(e) => handleStartEdit(tab, e)}
                                        className="p-0.5 text-zinc-500 hover:text-zinc-300"
                                        title="重命名"
                                    >
                                        <Edit2 size={12} />
                                    </button>
                                    {tabs.length > 1 && (
                                        <button
                                            onClick={(e) => handleRemoveTab(tab.id, e)}
                                            className="p-0.5 text-zinc-500 hover:text-red-400"
                                            title="删除标签页"
                                        >
                                            <X size={12} />
                                        </button>
                                    )}
                                </div>
                            </>
                        )}
                    </div>
                );
            })}

            {/* 新建标签页按钮 */}
            <button
                onClick={onTabAdd}
                className="ai-recognition-tab-add flex items-center justify-center w-8 h-8 rounded-md text-zinc-500 hover:text-teal-400 hover:bg-zinc-800/50 transition-colors"
                title="新建标签页"
            >
                <Plus size={18} />
            </button>
        </div>
    );
};

export default TabBar;
