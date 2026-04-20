import React, { memo } from 'react';
import { Edit3, Trash2 } from 'lucide-react';

export interface FolderContextMenuData {
    folderId: string;
    x: number;
    y: number;
}

export interface FolderContextMenuFolder {
    id: string;
    name: string;
    emoji?: string;
}

export interface FolderContextMenuProps {
    menu: FolderContextMenuData | null;
    folders: FolderContextMenuFolder[];
    defaultFolderId: string;
    onClose: () => void;
    onEdit: (folder: FolderContextMenuFolder) => void;
    onClearFolder: (folderId: string) => void;
    onDeleteFolder: (folderId: string) => void;
}

export const FolderContextMenu = memo(function FolderContextMenu({
    menu,
    folders,
    defaultFolderId,
    onClose,
    onEdit,
    onClearFolder,
    onDeleteFolder,
}: FolderContextMenuProps) {
    if (!menu) return null;

    const folder = folders.find(f => f.id === menu.folderId);

    return (
        <div
            className="fixed inset-0 z-[120]"
            onClick={onClose}
        >
            <div
                className="absolute bg-white rounded-lg shadow-xl border border-slate-200 py-1 w-36"
                style={{ left: menu.x, top: menu.y }}
                onClick={e => e.stopPropagation()}
            >
                <button
                    onClick={() => {
                        if (folder) onEdit(folder);
                        onClose();
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
                >
                    <Edit3 size={14} /> 编辑
                </button>
                <button
                    onClick={() => {
                        onClearFolder(menu.folderId);
                        onClose();
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                >
                    <Trash2 size={14} /> 清空此收藏夹
                </button>
                {menu.folderId !== defaultFolderId && (
                    <button
                        onClick={() => {
                            onDeleteFolder(menu.folderId);
                            onClose();
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"
                    >
                        <Trash2 size={14} /> 删除
                    </button>
                )}
            </div>
        </div>
    );
});
