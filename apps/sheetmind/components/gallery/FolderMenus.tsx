import React, { memo } from 'react';
import { Plus } from 'lucide-react';

export interface FolderMenuItem {
    id: string;
    name: string;
    emoji?: string;
}

export interface FavoriteItem {
    folderId?: string;
}

// ==================== Single Item Folder Menu ====================
export interface FolderSelectionMenuProps {
    isOpen: boolean;
    x: number;
    y: number;
    menuRef: React.RefObject<HTMLDivElement | null>;
    folders: FolderMenuItem[];
    favorites: FavoriteItem[];
    onSelectFolder: (folderId: string) => void;
    onCreateFolder: () => void;
    onClose: () => void;
}

export const FolderSelectionMenu = memo(function FolderSelectionMenu({
    isOpen,
    x,
    y,
    menuRef,
    folders,
    favorites,
    onSelectFolder,
    onCreateFolder,
}: FolderSelectionMenuProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] pointer-events-none">
            <div
                ref={menuRef}
                className="absolute bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px] animate-in fade-in zoom-in-95 duration-150 pointer-events-auto"
                style={{
                    left: Math.min(x, window.innerWidth - 200),
                    top: Math.min(y, window.innerHeight - 300)
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    选择收藏夹
                </div>
                {folders.map(folder => (
                    <button
                        key={folder.id}
                        onClick={() => onSelectFolder(folder.id)}
                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-amber-50 hover:text-amber-600 flex items-center gap-2"
                    >
                        <span>{folder.emoji || '📁'}</span>
                        <span className="truncate flex-1">{folder.name}</span>
                        <span className="text-[10px] text-slate-400">
                            {favorites.filter(f => f.folderId === folder.id).length}
                        </span>
                    </button>
                ))}
                <div className="border-t border-slate-100 mt-1 pt-1">
                    <button
                        onClick={onCreateFolder}
                        className="w-full px-3 py-2 text-left text-sm text-green-600 hover:bg-green-50 flex items-center gap-2"
                    >
                        <Plus size={12} />
                        <span>新建收藏夹</span>
                    </button>
                </div>
            </div>
        </div>
    );
});

// ==================== Batch Folder Menu ====================
export interface BatchFolderMenuProps {
    isOpen: boolean;
    x: number;
    y: number;
    menuRef: React.RefObject<HTMLDivElement | null>;
    selectedCount: number;
    folders: FolderMenuItem[];
    favorites: FavoriteItem[];
    onSelectFolder: (folderId: string) => void;
    onCreateFolder: () => void;
}

export const BatchFolderMenu = memo(function BatchFolderMenu({
    isOpen,
    x,
    y,
    menuRef,
    selectedCount,
    folders,
    favorites,
    onSelectFolder,
    onCreateFolder,
}: BatchFolderMenuProps) {
    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 z-[100] pointer-events-none">
            <div
                ref={menuRef}
                className="absolute bg-white rounded-lg shadow-xl border border-slate-200 py-1 min-w-[180px] animate-in fade-in zoom-in-95 duration-150 pointer-events-auto"
                style={{
                    left: Math.min(x, window.innerWidth - 200),
                    top: Math.min(y, window.innerHeight - 300)
                }}
                onClick={(e) => e.stopPropagation()}
            >
                <div className="px-3 py-1.5 text-[10px] font-semibold text-slate-400 uppercase tracking-wider border-b border-slate-100">
                    选择收藏夹 ({selectedCount} 项)
                </div>
                {folders.map(folder => (
                    <button
                        key={folder.id}
                        onClick={() => onSelectFolder(folder.id)}
                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-amber-50 hover:text-amber-600 flex items-center gap-2"
                    >
                        <span>{folder.emoji || '📁'}</span>
                        <span className="truncate flex-1">{folder.name}</span>
                        <span className="text-[10px] text-slate-400">
                            {favorites.filter(f => f.folderId === folder.id).length}
                        </span>
                    </button>
                ))}
                <div className="border-t border-slate-100 mt-1 pt-1">
                    <button
                        onClick={onCreateFolder}
                        className="w-full px-3 py-2 text-left text-sm text-green-600 hover:bg-green-50 flex items-center gap-2"
                    >
                        <Plus size={12} />
                        <span>新建收藏夹并添加</span>
                    </button>
                </div>
            </div>
        </div>
    );
});
