import React, { memo } from 'react';
import { Image, ExternalLink, Grid3X3, Star, Plus, MessageSquare, Tag, Copy } from 'lucide-react';

export interface ContextMenuData {
    imageUrl: string;
    imageFormula: string;
    row: Record<string, any>;
    x: number;
    y: number;
}

export interface ContextMenuFolder {
    id: string;
    name: string;
    emoji?: string;
}

export interface ThumbnailContextMenuProps {
    menu: ContextMenuData | null;
    menuPos: { x: number; y: number } | null;
    menuRef: React.RefObject<HTMLDivElement | null>;
    closeTimerRef: React.MutableRefObject<ReturnType<typeof setTimeout> | null>;
    onClose: () => void;
    // Label columns
    labelColumns: string[];
    // Detail columns
    detailColumns: string[];
    detailColumn: string;
    onDetailColumnChange: (col: string) => void;
    // Link column
    linkColumn: string;
    // Folders
    folders: ContextMenuFolder[];
    // Callbacks
    copyImageToClipboard: (url: string) => void;
    copyTextToClipboard: (text: string, label: string) => void;
    copyRowDataToClipboard: (row: Record<string, any>, imageUrl: string) => void;
    isFavorited: (imageUrl: string) => boolean;
    toggleFavorite: (imageUrl: string, row: Record<string, any>) => void;
    addToFolder: (imageUrl: string, row: Record<string, any>, folderId: string) => void;
    onCreateFolderAndAdd: (imageUrl: string, row: Record<string, any>) => void;
    openNoteModal: (imageUrl: string, row: Record<string, any>) => void;
    openCategoryModal: (imageUrl: string, row: Record<string, any>) => void;
    getNoteForImage: (imageUrl: string) => string | undefined;
    getCategoryForImage: (imageUrl: string) => string | undefined;
}

export const ThumbnailContextMenu = memo(function ThumbnailContextMenu({
    menu,
    menuPos,
    menuRef,
    closeTimerRef,
    onClose,
    labelColumns,
    detailColumns,
    detailColumn,
    onDetailColumnChange,
    linkColumn,
    folders,
    copyImageToClipboard,
    copyTextToClipboard,
    copyRowDataToClipboard,
    isFavorited,
    toggleFavorite,
    addToFolder,
    onCreateFolderAndAdd,
    openNoteModal,
    openCategoryModal,
    getNoteForImage,
    getCategoryForImage,
}: ThumbnailContextMenuProps) {
    if (!menu) return null;

    return (
        <div
            ref={menuRef}
            className="fixed z-[100] bg-white rounded-lg shadow-2xl border border-slate-200 py-1 w-[360px] max-w-[calc(100vw-16px)] animate-in fade-in zoom-in-95 duration-100"
            style={{
                left: menuPos ? menuPos.x : menu.x,
                top: menuPos ? menuPos.y : menu.y,
                maxHeight: 'min(560px, 78vh)',
                overflowY: 'auto'
            }}
            onClick={(e) => e.stopPropagation()}
            onMouseEnter={() => {
                if (closeTimerRef.current) {
                    clearTimeout(closeTimerRef.current);
                    closeTimerRef.current = null;
                }
            }}
            onMouseLeave={() => {
                if (closeTimerRef.current) {
                    clearTimeout(closeTimerRef.current);
                }
                closeTimerRef.current = setTimeout(() => {
                    onClose();
                    closeTimerRef.current = null;
                }, 120);
            }}
        >
            {/* Image Copy Options */}
            <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">图片</div>
            <button
                onClick={() => {
                    copyImageToClipboard(menu.imageUrl);
                    onClose();
                }}
                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2"
            >
                <Image size={14} /> 复制图片
            </button>
            <button
                onClick={() => copyTextToClipboard(menu.imageUrl, '图片链接')}
                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2"
            >
                <ExternalLink size={14} /> 复制图片链接
            </button>
            {menu.imageFormula.startsWith('=IMAGE') && (
                <button
                    onClick={() => copyTextToClipboard(menu.imageFormula, '图片公式')}
                    className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-blue-50 hover:text-blue-700 flex items-center gap-2"
                >
                    <Grid3X3 size={14} /> 复制图片公式
                </button>
            )}

            {/* Label Column Values */}
            {labelColumns.length > 0 && (
                <>
                    <div className="border-t border-slate-100 my-1"></div>
                    <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">字段</div>
                    {labelColumns.map(col => {
                        const value = String(menu.row[col] || '');
                        const displayValue = value || '(空)';
                        const copyValue = value;
                        return (
                            <button
                                key={col}
                                onClick={() => copyValue ? copyTextToClipboard(copyValue, col) : null}
                                disabled={!copyValue}
                                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${copyValue
                                    ? 'text-slate-700 hover:bg-green-50 hover:text-green-700'
                                    : 'text-slate-300 cursor-not-allowed'
                                    }`}
                            >
                                <span className="text-[10px] text-slate-400 w-16 truncate">{col}:</span>
                                <span className="truncate flex-1">{displayValue.length > 20 ? displayValue.slice(0, 20) + '...' : displayValue}</span>
                            </button>
                        );
                    })}
                </>
            )}

            {/* Full text preview area for selected column */}
            {detailColumns.length > 0 && (
                <>
                    <div className="border-t border-slate-100 my-1"></div>
                    <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">完整内容</div>
                    <div className="px-3 pb-2 space-y-2">
                        <select
                            value={detailColumn}
                            onChange={(e) => onDetailColumnChange(e.target.value)}
                            className="w-full px-2 py-1.5 text-xs rounded-md border border-slate-200 bg-slate-50 text-slate-700 focus:outline-none focus:border-blue-400"
                        >
                            {detailColumns.map(col => (
                                <option key={col} value={col}>{col}</option>
                            ))}
                        </select>
                        <div className="max-h-36 overflow-y-auto rounded-md border border-slate-200 bg-slate-50 px-2 py-2">
                            {String(menu.row[detailColumn] ?? '').trim() ? (
                                <pre className="text-xs text-slate-700 whitespace-pre-wrap break-words font-sans m-0">
                                    {String(menu.row[detailColumn])}
                                </pre>
                            ) : (
                                <span className="text-xs text-slate-400">(空)</span>
                            )}
                        </div>
                        <button
                            onClick={() => {
                                const fullText = String(menu.row[detailColumn] ?? '');
                                if (!fullText.trim()) return;
                                copyTextToClipboard(fullText, `${detailColumn}完整内容`);
                            }}
                            disabled={!String(menu.row[detailColumn] ?? '').trim()}
                            className={`w-full px-2 py-1.5 text-xs rounded-md border transition-colors ${String(menu.row[detailColumn] ?? '').trim()
                                ? 'text-blue-700 border-blue-200 bg-blue-50 hover:bg-blue-100'
                                : 'text-slate-300 border-slate-200 bg-slate-50 cursor-not-allowed'
                                }`}
                        >
                            复制当前完整内容
                        </button>
                    </div>
                </>
            )}

            {/* Link if available */}
            {linkColumn && menu.row[linkColumn] && (
                <>
                    <div className="border-t border-slate-100 my-1"></div>
                    <button
                        onClick={() => copyTextToClipboard(String(menu.row[linkColumn]), '链接')}
                        className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-purple-50 hover:text-purple-700 flex items-center gap-2"
                    >
                        <ExternalLink size={14} /> 复制关联链接
                    </button>
                </>
            )}

            {/* Favorite and Copy Row options */}
            <div className="border-t border-slate-100 my-1"></div>
            <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">收藏夹</div>
            {isFavorited(menu.imageUrl) ? (
                <button
                    onClick={() => {
                        toggleFavorite(menu.imageUrl, menu.row);
                        onClose();
                    }}
                    className="w-full px-3 py-2 text-left text-sm text-amber-600 hover:bg-amber-50 flex items-center gap-2"
                >
                    <Star size={14} fill="currentColor" /> 取消收藏
                </button>
            ) : (
                <>
                    {folders.map(folder => (
                        <button
                            key={folder.id}
                            onClick={() => {
                                addToFolder(menu.imageUrl, menu.row, folder.id);
                                onClose();
                            }}
                            className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-amber-50 hover:text-amber-600 flex items-center gap-2"
                        >
                            <span>{folder.emoji || '📁'}</span>
                            <span className="truncate">{folder.name}</span>
                        </button>
                    ))}
                    <button
                        onClick={() => {
                            onCreateFolderAndAdd(menu.imageUrl, menu.row);
                            onClose();
                        }}
                        className="w-full px-3 py-2 text-left text-sm text-green-600 hover:bg-green-50 flex items-center gap-2"
                    >
                        <Plus size={12} /> 新建收藏夹并添加
                    </button>
                </>
            )}

            {/* Add Note Option */}
            <button
                onClick={() => {
                    openNoteModal(menu.imageUrl, menu.row);
                    onClose();
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${getNoteForImage(menu.imageUrl)
                    ? 'text-blue-600 hover:bg-blue-50'
                    : 'text-slate-700 hover:bg-blue-50 hover:text-blue-600'
                    }`}
            >
                <MessageSquare size={14} fill={getNoteForImage(menu.imageUrl) ? 'currentColor' : 'none'} />
                {getNoteForImage(menu.imageUrl) ? '编辑备注' : '添加备注'}
                {getNoteForImage(menu.imageUrl) && (
                    <span className="ml-auto text-[10px] text-blue-400 bg-blue-50 px-1.5 py-0.5 rounded">已有</span>
                )}
            </button>

            {/* Add Category Option */}
            <button
                onClick={() => {
                    openCategoryModal(menu.imageUrl, menu.row);
                    onClose();
                }}
                className={`w-full px-3 py-2 text-left text-sm flex items-center gap-2 ${getCategoryForImage(menu.imageUrl)
                    ? 'text-purple-600 hover:bg-purple-50'
                    : 'text-slate-700 hover:bg-purple-50 hover:text-purple-600'
                    }`}
            >
                <Tag size={14} fill={getCategoryForImage(menu.imageUrl) ? 'currentColor' : 'none'} />
                {getCategoryForImage(menu.imageUrl) ? '编辑分类' : '添加分类'}
                {getCategoryForImage(menu.imageUrl) && (
                    <span className="ml-auto text-[10px] text-purple-400 bg-purple-50 px-1.5 py-0.5 rounded truncate max-w-[80px]">{getCategoryForImage(menu.imageUrl)}</span>
                )}
            </button>

            {/* Display current note/category info if exists */}
            {(getNoteForImage(menu.imageUrl) || getCategoryForImage(menu.imageUrl)) && (
                <>
                    <div className="border-t border-slate-100 my-1"></div>
                    <div className="px-2 py-1 text-[10px] font-semibold text-slate-400 uppercase tracking-wider">当前标注</div>
                    {getCategoryForImage(menu.imageUrl) && (
                        <div className="px-3 py-1.5 text-sm text-slate-600 flex items-center gap-2">
                            <Tag size={12} className="text-purple-400" />
                            <span className="text-purple-600 font-medium">{getCategoryForImage(menu.imageUrl)}</span>
                        </div>
                    )}
                    {getNoteForImage(menu.imageUrl) && (
                        <div className="px-3 py-1.5 text-sm text-slate-600 flex items-start gap-2">
                            <MessageSquare size={12} className="text-blue-400 mt-0.5 flex-shrink-0" />
                            <span className="text-blue-600 text-xs break-words max-w-[180px]">{getNoteForImage(menu.imageUrl)?.slice(0, 60)}{(getNoteForImage(menu.imageUrl)?.length || 0) > 60 ? '...' : ''}</span>
                        </div>
                    )}
                </>
            )}

            <button
                onClick={() => {
                    copyRowDataToClipboard(menu.row, menu.imageUrl);
                    onClose();
                }}
                className="w-full px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-100 flex items-center gap-2"
            >
                <Copy size={14} /> 复制整行数据
            </button>
        </div>
    );
});
