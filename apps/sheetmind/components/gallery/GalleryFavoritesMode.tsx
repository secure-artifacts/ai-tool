import React from 'react';
import { Search, Loader2, Star, Tag, Check, Layers, ChevronLeft, ChevronRight, X, ListFilter, Copy, Play, Trash2, BookOpen, Lightbulb, Plus, Image as ImageIcon, Filter, MessageSquare } from 'lucide-react';
import { ImageCard } from './ImageCard';

export const GalleryFavoritesMode = (props: any) => {
    const { 
        Filter,
        MessageSquare,
        activeFolderId,
        clearAllFavorites,
        config,
        copyAllFavoritesData,
        copyRowDataToClipboard,
        copySelectedFavoritesData,
        deselectAllFavorites,
        dragOverTarget,
        favoriteFolders,
        favoriteSearchKeyword,
        favorites,
        getCategoryForImage,
        getFavoritesInFolder,
        getFilteredFavorites,
        getNoteForImage,
        handleContextMenu,
        handleDragEnd,
        handleDropToFolder,
        handleFavoriteDragStart,
        handleThumbnailMouseEnter,
        handleThumbnailMouseLeave,
        invertFavoriteSelection,
        isDraggingImage,
        openBatchCategoryModal,
        openBatchNoteModal,
        openCategoryModal,
        openExternalUrl,
        openNoteModal,
        selectAllFavorites,
        selectedFavorites,
        setActiveFolderId,
        setCopyFeedback,
        setDragOverTarget,
        setEditFolderModal,
        setFavoriteSearchKeyword,
        setFloatingTip,
        setFolderContextMenu,
        setNewFolderModal,
        setSelectedThumbnails,
        setShowFavorites,
        toggleFavorite,
        toggleFavoriteSelection
    } = props;

    return (
                            <div className="space-y-4">
                                {/* Favorites Header */}
                                <div className="flex items-center justify-between bg-amber-50 px-4 py-3 rounded-xl border border-amber-200">
                                    <div className="flex items-center gap-3">
                                        <Star size={20} className="text-amber-500" fill="currentColor" />
                                        <span className="font-semibold text-amber-800">我的收藏</span>
                                        <span className="text-xs text-amber-600 bg-amber-100 px-2 py-0.5 rounded-full">{getFavoritesInFolder(activeFolderId).length} 项</span>
                                        {selectedFavorites.size > 0 && (
                                            <span className="text-xs text-blue-600 bg-blue-100 px-2 py-0.5 rounded-full">已选 {selectedFavorites.size}</span>
                                        )}
                                    </div>
                                    <div className="flex gap-2">
                                        {getFavoritesInFolder(activeFolderId).length > 0 && (
                                            <button
                                                onClick={clearAllFavorites}
                                                className="px-3 py-1.5 text-xs text-red-600 bg-white border border-red-200 rounded-lg hover:bg-red-50"
                                            >
                                                <Trash2 size={12} className="inline mr-1" />清空
                                            </button>
                                        )}
                                        <button
                                            onClick={() => setShowFavorites(false)}
                                            className="px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                                        >
                                            返回画廊
                                        </button>
                                    </div>
                                </div>

                                {/* Folder Tabs with Tip */}
                                <div className="flex items-center justify-between gap-2 mb-1">
                                    <span className="text-[10px] text-slate-400"><Lightbulb size={10} className="inline mr-1" /> 双击收藏夹可编辑名称和图标</span>
                                </div>
                                <div className="flex items-center gap-2 overflow-x-auto pb-2">
                                    <button
                                        onClick={() => setActiveFolderId('all')}
                                        className={`px-3 py-1.5 text-xs rounded-lg border whitespace-nowrap transition-colors ${activeFolderId === 'all'
                                            ? 'bg-amber-500 text-white border-amber-500'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'
                                            }`}
                                    >
                                        <BookOpen size={12} className="inline mr-1" /> 全部 ({favorites.length})
                                    </button>
                                    {favoriteFolders.map(folder => (
                                        <button
                                            key={folder.id}
                                            onClick={() => setActiveFolderId(folder.id)}
                                            onDoubleClick={(e) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                setEditFolderModal({
                                                    isOpen: true,
                                                    folderId: folder.id,
                                                    name: folder.name,
                                                    emoji: folder.emoji || '📁'
                                                });
                                            }}
                                            onContextMenu={(e) => {
                                                e.preventDefault();
                                                setFolderContextMenu({ x: e.clientX, y: e.clientY, folderId: folder.id });
                                            }}
                                            onDragOver={(e) => {
                                                e.preventDefault();
                                                e.dataTransfer.dropEffect = 'copy';
                                                setDragOverTarget(`folder-${folder.id}`);
                                            }}
                                            onDragLeave={() => setDragOverTarget(null)}
                                            onDrop={(e) => handleDropToFolder(e, folder.id)}
                                            className={`px-3 py-1.5 text-xs rounded-lg border whitespace-nowrap transition-all flex items-center gap-1 tooltip-bottom ${activeFolderId === folder.id
                                                ? 'bg-amber-500 text-white border-amber-500'
                                                : 'bg-white text-slate-600 border-slate-200 hover:border-amber-300'
                                                } ${dragOverTarget === `folder-${folder.id}` ? 'ring-2 ring-green-400 ring-offset-1 scale-105 bg-green-50' : ''}`}
                                            data-tip="双击编辑 | 右键更多选项"
                                        >
                                            {folder.emoji || '📁'} {folder.name} ({getFavoritesInFolder(folder.id).length})
                                        </button>
                                    ))}
                                    <button
                                        onClick={() => setNewFolderModal({
                                            isOpen: true,
                                            name: '收藏夹 ' + (favoriteFolders.length + 1),
                                            emoji: '📂',
                                            onSuccess: undefined
                                        })}
                                        className="px-3 py-1.5 text-xs text-green-600 bg-green-50 rounded-lg border border-green-200 hover:bg-green-100 flex items-center gap-1"
                                    >
                                        <Plus size={12} /> 新建
                                    </button>
                                </div>

                                {/* Search Bar for Favorites */}
                                <div className="flex items-center gap-2">
                                    <div className="relative flex-1 max-w-md">
                                        <input
                                            type="text"
                                            value={favoriteSearchKeyword}
                                            onChange={(e) => setFavoriteSearchKeyword(e.target.value)}
                                            placeholder="在收藏中搜索..."
                                            className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-amber-400 focus:border-transparent"
                                        />
                                        <Filter size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-slate-400" />
                                        {favoriteSearchKeyword && (
                                            <button
                                                onClick={() => setFavoriteSearchKeyword('')}
                                                className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                                            >
                                                <X size={14} />
                                            </button>
                                        )}
                                    </div>
                                </div>

                                {/* Selection Toolbar */}
                                {favorites.length > 0 && (
                                    <div className="flex items-center gap-2 bg-slate-50 px-4 py-2 rounded-lg border border-slate-200">
                                        <span className="text-xs text-slate-500 mr-2">选择:</span>
                                        <button
                                            onClick={selectAllFavorites}
                                            className="px-2 py-1 text-xs text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                        >
                                            全选
                                        </button>
                                        <button
                                            onClick={deselectAllFavorites}
                                            className="px-2 py-1 text-xs text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                        >
                                            取消
                                        </button>
                                        <button
                                            onClick={invertFavoriteSelection}
                                            className="px-2 py-1 text-xs text-slate-700 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                        >
                                            反选
                                        </button>
                                        <div className="flex-1" />
                                        <button
                                            onClick={copySelectedFavoritesData}
                                            disabled={selectedFavorites.size === 0}
                                            className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                        >
                                            <Copy size={12} /> 复制选中 ({selectedFavorites.size})
                                        </button>
                                        <button
                                            onClick={copyAllFavoritesData}
                                            className="px-3 py-1 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600 flex items-center gap-1"
                                        >
                                            <Copy size={12} /> 复制全部
                                        </button>
                                        <button
                                            onClick={() => {
                                                const imageUrls = Array.from(selectedFavorites).map(id => {
                                                    const fav = favorites.find(f => f.id === id);
                                                    return fav?.imageUrl || '';
                                                }).filter(Boolean);
                                                if (imageUrls.length === 0) {
                                                    setCopyFeedback('⚠️ 请先选择收藏项');
                                                    setTimeout(() => setCopyFeedback(null), 2000);
                                                    return;
                                                }
                                                // Set selectedThumbnails for batch category modal
                                                setSelectedThumbnails(new Set(imageUrls));
                                                openBatchCategoryModal();
                                            }}
                                            disabled={selectedFavorites.size === 0}
                                            className="px-3 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                        >
                                            <Tag size={12} /> 批量分类
                                        </button>
                                        <button
                                            onClick={() => {
                                                const imageUrls = Array.from(selectedFavorites).map(id => {
                                                    const fav = favorites.find(f => f.id === id);
                                                    return fav?.imageUrl || '';
                                                }).filter(Boolean);
                                                openBatchNoteModal(imageUrls);
                                            }}
                                            disabled={selectedFavorites.size === 0}
                                            className="px-3 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1"
                                        >
                                            <MessageSquare size={12} /> 批量备注
                                        </button>
                                    </div>
                                )}

                                {/* Favorites Grid */}
                                {getFilteredFavorites(activeFolderId, favoriteSearchKeyword).length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                                        <Star size={48} className="mb-4 opacity-30" />
                                        <p className="text-lg font-medium">{favoriteSearchKeyword ? '未找到匹配的收藏' : '暂无收藏'}</p>
                                        <p className="text-sm mt-1">{favoriteSearchKeyword ? '请尝试其他关键词' : '右键点击图片或点击右上角⭐可添加收藏'}</p>
                                    </div>
                                ) : (
                                    <div className="flex flex-wrap gap-4">
                                        {getFilteredFavorites(activeFolderId, favoriteSearchKeyword).map((fav, index) => (
                                            <div
                                                key={fav.id}
                                                draggable
                                                onDragStart={(e) => handleFavoriteDragStart(e, fav, index)}
                                                onDragEnd={handleDragEnd}
                                                className={`relative group bg-white rounded-xl border-2 overflow-hidden shadow-sm hover:shadow-lg transition-all cursor-pointer tooltip-bottom ${selectedFavorites.has(fav.id)
                                                    ? 'border-blue-500 ring-2 ring-blue-200'
                                                    : 'border-slate-200'
                                                    } ${isDraggingImage ? 'cursor-grabbing' : 'cursor-grab'}`}
                                                style={{ width: config.thumbnailSize + 40 }}
                                                onClick={() => toggleFavoriteSelection(fav.id)}
                                                data-tip="拖拽到其他收藏夹可移动"
                                            >
                                                {/* Selection checkbox */}
                                                <div className={`absolute top-2 left-2 z-10 w-5 h-5 rounded border-2 flex items-center justify-center transition-all ${selectedFavorites.has(fav.id)
                                                    ? 'bg-blue-500 border-blue-500 text-white'
                                                    : 'bg-white/80 border-slate-300 opacity-0 group-hover:opacity-100'
                                                    }`}>
                                                    {selectedFavorites.has(fav.id) && <Check size={12} />}
                                                </div>

                                                {/* Image - with hover preview */}
                                                <div
                                                    className="relative"
                                                    onDoubleClick={(e) => {
                                                        if (!config.linkColumn) {
                                                            setFloatingTip({ text: '⚠️ 请先指定链接列', x: e.clientX, y: e.clientY });
                                                            setTimeout(() => setFloatingTip(null), 2000);
                                                            return;
                                                        }
                                                        const linkUrl = String(fav.rowData[config.linkColumn] || '');
                                                        if (linkUrl) {
                                                            e.stopPropagation();
                                                            openExternalUrl(linkUrl);
                                                        }
                                                    }}
                                                    onContextMenu={(e) => handleContextMenu(e, fav.rowData, fav.imageUrl)}
                                                    onMouseEnter={(e) => handleThumbnailMouseEnter(fav.imageUrl, e)}
                                                    onMouseLeave={handleThumbnailMouseLeave}
                                                >
                                                    <img
                                                        src={fav.imageUrl}
                                                        alt=""
                                                        className={`${config.thumbnailFit === 'contain' ? 'object-contain' : 'object-cover'} w-full`}
                                                        style={{
                                                            height: config.thumbnailSize,
                                                            backgroundColor: config.thumbnailFit === 'contain' ? '#f1f5f9' : undefined
                                                        }}
                                                        loading="lazy"
                                                    />
                                                    {/* Favorite badge */}
                                                    <div className="absolute top-2 right-2 bg-amber-400 text-white p-1.5 rounded-full shadow">
                                                        <Star size={16} fill="currentColor" />
                                                    </div>
                                                    {/* Note indicator - top left */}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); openNoteModal(fav.imageUrl, fav.rowData); }}
                                                        className={`absolute top-2 left-2 p-1.5 rounded-full shadow z-10 transition-all ${getNoteForImage(fav.imageUrl)
                                                            ? 'bg-blue-500 text-white opacity-100'
                                                            : 'bg-white/80 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-blue-400 hover:text-white'
                                                            }`}
                                                        title={getNoteForImage(fav.imageUrl)
                                                            ? `备注: ${getNoteForImage(fav.imageUrl).slice(0, 50)}${getNoteForImage(fav.imageUrl).length > 50 ? '...' : ''}`
                                                            : '添加备注'
                                                        }
                                                    >
                                                        <MessageSquare size={16} />
                                                    </button>
                                                    {/* Category indicator - top right (below star) */}
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); openCategoryModal(fav.imageUrl, fav.rowData); }}
                                                        className={`absolute top-10 right-2 p-1.5 rounded-full shadow z-10 transition-all ${getCategoryForImage(fav.imageUrl)
                                                            ? 'bg-purple-500 text-white opacity-100'
                                                            : 'bg-white/80 text-slate-400 opacity-0 group-hover:opacity-100 hover:bg-purple-400 hover:text-white'
                                                            }`}
                                                        title={getCategoryForImage(fav.imageUrl)
                                                            ? `【媒体标签】: ${getCategoryForImage(fav.imageUrl)}`
                                                            : '添加分类'
                                                        }
                                                    >
                                                        <Tag size={16} />
                                                    </button>
                                                </div>

                                                {/* Actions */}
                                                <div className="p-2 space-y-1" onClick={(e) => e.stopPropagation()}>
                                                    {/* Show some row data preview */}
                                                    <div className="text-[10px] text-slate-500 truncate">
                                                        {Object.entries(fav.rowData).slice(0, 2).map(([k, v]) => (
                                                            v ? <span key={k} className="mr-2">{k}: {String(v).slice(0, 15)}</span> : null
                                                        ))}
                                                    </div>
                                                    <div className="flex gap-1">
                                                        <button
                                                            onClick={() => copyRowDataToClipboard(fav.rowData, fav.imageUrl)}
                                                            className="flex-1 px-2 py-1 text-[10px] bg-blue-50 text-blue-600 hover:bg-blue-100 rounded flex items-center justify-center gap-1"
                                                        >
                                                            <Copy size={10} /> 复制行数据
                                                        </button>
                                                        <button
                                                            onClick={() => toggleFavorite(fav.imageUrl, fav.rowData)}
                                                            className="px-2 py-1 text-[10px] bg-red-50 text-red-600 hover:bg-red-100 rounded tooltip-bottom"
                                                            data-tip="取消收藏"
                                                        >
                                                            <Trash2 size={10} />
                                                        </button>
                                                    </div>
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                            </div>
    );
};
