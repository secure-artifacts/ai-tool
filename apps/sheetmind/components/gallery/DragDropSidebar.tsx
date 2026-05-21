import React, { memo } from 'react';
import { Star, Tag } from 'lucide-react';

export interface DragDropFolder {
    id: string;
    name: string;
    emoji?: string;
}

export interface DragDropSidebarProps {
    isVisible: boolean;
    folders: DragDropFolder[];
    categoryOptions: string[];
    dragOverTarget: string | null;
    onDragOverTarget: (target: string | null) => void;
    onDropToFolder: (e: React.DragEvent, folderId: string) => void;
    onDropToCategory: (e: React.DragEvent, category: string) => void;
    onClickFolder?: (folderId: string) => void;
    onClickCategory?: (category: string) => void;
    isDraggingMode?: boolean;
    selectedCount?: number;
    getFavoritesCount: (folderId: string) => number;
}

export const DragDropSidebar = memo(function DragDropSidebar({
    isVisible,
    folders,
    categoryOptions,
    dragOverTarget,
    onDragOverTarget,
    onDropToFolder,
    onDropToCategory,
    onClickFolder,
    onClickCategory,
    isDraggingMode = true,
    selectedCount = 0,
    getFavoritesCount,
}: DragDropSidebarProps) {
    if (!isVisible) return null;

    const filteredCategories = categoryOptions.filter(c => c.trim());

    return (
        <div className="fixed left-4 bottom-4 z-50 animate-in slide-in-from-left duration-300">
            <div className="bg-white backdrop-blur-sm rounded-2xl shadow-2xl border border-slate-200 p-4 w-64 text-slate-700">
                <div className="text-xs font-semibold text-slate-600 uppercase tracking-wider mb-3">
                    {isDraggingMode ? '📌 拖拽到目标位置' : `📌 选定了 ${selectedCount} 项，点击分类放入`}
                </div>

                {/* 收藏夹列表 */}
                <div className="mb-4">
                    <div className="px-2 py-1 text-[10px] font-semibold text-amber-600 uppercase tracking-wider flex items-center gap-1">
                        <Star size={10} className="inline mr-0.5" /> 收藏夹
                    </div>
                    <div className="space-y-1 max-h-40 overflow-y-auto">
                        {folders.map(folder => (
                            <div
                                key={folder.id}
                                onDragOver={(e) => {
                                    e.preventDefault();
                                    e.dataTransfer.dropEffect = 'copy';
                                    onDragOverTarget(`folder-${folder.id}`);
                                }}
                                onDragLeave={() => onDragOverTarget(null)}
                                onDrop={(e) => onDropToFolder(e, folder.id)}
                                onClick={() => onClickFolder && onClickFolder(folder.id)}
                                className={`px-3 py-2 rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${dragOverTarget === `folder-${folder.id}`
                                    ? 'bg-green-100 border-green-400 ring-2 ring-green-300'
                                    : 'bg-slate-50 border-slate-200 hover:bg-green-50'
                                    }`}
                            >
                                <span>{folder.emoji || '📁'}</span>
                                <span className="flex-1 text-sm truncate text-slate-800">{folder.name}</span>
                                <span className="text-[10px] text-slate-500 bg-slate-200 px-1.5 py-0.5 rounded">{getFavoritesCount(folder.id)}</span>
                            </div>
                        ))}
                    </div>
                </div>

                {/* 媒体标签列表 */}
                {filteredCategories.length > 0 && (
                    <div>
                        <div className="px-2 py-1 text-[10px] font-semibold text-purple-600 uppercase tracking-wider flex items-center gap-1">
                            <Tag size={10} className="inline mr-0.5" /> 媒体标签
                        </div>
                        <div className="space-y-1 max-h-40 overflow-y-auto">
                            {filteredCategories.map(category => (
                                <div
                                    key={category}
                                    onDragOver={(e) => {
                                        e.preventDefault();
                                        e.dataTransfer.dropEffect = 'copy';
                                        onDragOverTarget(`category-${category}`);
                                    }}
                                    onDragLeave={() => onDragOverTarget(null)}
                                    onDrop={(e) => onDropToCategory(e, category)}
                                    onClick={() => onClickCategory && onClickCategory(category)}
                                    className={`px-3 py-2 rounded-lg border transition-all cursor-pointer flex items-center gap-2 ${dragOverTarget === `category-${category}`
                                        ? 'bg-purple-100 border-purple-400 ring-2 ring-purple-300'
                                        : 'bg-slate-50 border-slate-200 hover:bg-purple-50'
                                        }`}
                                >
                                    <Tag size={14} className="text-purple-500" />
                                    <span className="flex-1 text-sm truncate text-slate-800">{category}</span>
                                </div>
                            ))}
                        </div>
                    </div>
                )}

                <div className="mt-3 pt-3 border-t border-slate-200 text-[10px] text-slate-500 text-center">
                    {isDraggingMode ? '✨ 释放鼠标即可添加' : '✨ 快捷分类面板'}
                </div>
            </div>
        </div>
    );
});
