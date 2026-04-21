import React from 'react';
import { Star, Tag, Check, X, Copy, Trash2, Image as ImageIcon, ChevronDown, ChevronRight, Search, MessageSquare, Filter } from 'lucide-react';
import { ImageCard } from './ImageCard';

export const GalleryCategoryView = (props: any) => {
    const {
        clearCategoryItems,
        config,
        dragOverTarget,
        effectiveData,
        effectiveImageColumn,
        effectiveLinkColumn,
        extractImageUrl,
        galleryCategories,
        gallerySelectMode,
        getNoteForImage,
        handleContextMenu,
        handleDropToCategory,
        handleStarClick,
        handleThumbnailDoubleClick,
        handleThumbnailMouseEnter,
        handleThumbnailMouseLeave,
        isFavorited,
        openBatchCategoryModal,
        openBatchNoteModal,
        openCategoryModal,
        openNoteModal,
        scheduleThumbnailSelect,
        selectedThumbnails,
        setDragOverTarget,
        setGallerySelectMode,
        setSelectedThumbnails,
        setShowBatchFolderMenu,
        setShowCategoryView
    } = props;

    return (
                            <div className="space-y-4">
                                {/* Category View Header */}
                                <div className="flex items-center justify-between bg-purple-50 px-4 py-3 rounded-xl border border-purple-200">
                                    <div className="flex items-center gap-3">
                                        <Tag size={20} className="text-purple-500" />
                                        <span className="font-semibold text-purple-800">媒体标签分类</span>
                                        <span className="text-xs text-purple-600 bg-purple-100 px-2 py-0.5 rounded-full">{galleryCategories.size} 项</span>
                                    </div>
                                    <div className="flex items-center gap-2">
                                        {/* Toggle select mode */}
                                        <button
                                            onClick={() => {
                                                setGallerySelectMode(!gallerySelectMode);
                                                if (gallerySelectMode) setSelectedThumbnails(new Set());
                                            }}
                                            className={`px-3 py-1.5 text-xs rounded-lg flex items-center gap-1.5 transition-colors ${gallerySelectMode
                                                ? 'bg-blue-100 text-blue-700 border border-blue-300'
                                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                                                }`}
                                        >
                                            <Check size={12} />
                                            {gallerySelectMode ? `选择中 (${selectedThumbnails.size})` : '多选'}
                                        </button>
                                        <button
                                            onClick={() => setShowCategoryView(false)}
                                            className="px-3 py-1.5 text-xs text-slate-600 bg-white border border-slate-200 rounded-lg hover:bg-slate-100"
                                        >
                                            返回画廊
                                        </button>
                                    </div>
                                </div>

                                {/* Category View Batch Actions */}
                                {gallerySelectMode && selectedThumbnails.size > 0 && (
                                    <div className="flex items-center gap-2 px-4 py-2 bg-blue-50 rounded-lg border border-blue-200">
                                        <span className="text-xs text-blue-600">已选 {selectedThumbnails.size} 项</span>
                                        <div className="flex-1" />
                                        <button
                                            onClick={openBatchCategoryModal}
                                            className="px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 flex items-center gap-1"
                                        >
                                            <Tag size={10} /> 批量分类
                                        </button>
                                        <button
                                            onClick={() => openBatchNoteModal(Array.from(selectedThumbnails))}
                                            className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
                                        >
                                            <MessageSquare size={10} /> 批量备注
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                setShowBatchFolderMenu({ x: e.clientX, y: e.clientY });
                                            }}
                                            className="px-2 py-1 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 flex items-center gap-1"
                                        >
                                            <Star size={10} /> 批量收藏 ▾
                                        </button>
                                        <button
                                            onClick={() => setSelectedThumbnails(new Set())}
                                            className="px-2 py-1 text-xs text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                        >
                                            取消选择
                                        </button>
                                    </div>
                                )}

                                {/* Grouped by Category */}
                                {galleryCategories.size === 0 && config.categoryOptions.filter(c => c.trim()).length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-16 text-slate-400">
                                        <Tag size={48} className="mb-4 opacity-30" />
                                        <p className="text-lg font-medium">暂无媒体标签</p>
                                        <p className="text-sm mt-1">点击图片上的标签图标可添加分类</p>
                                    </div>
                                ) : (
                                    (() => {
                                        // Group images by category
                                        const categoryGroups = new Map<string, { imageUrl: string; row: Record<string, unknown>; rowId: string }[]>();

                                        config.categoryOptions
                                            .map(cat => cat.trim())
                                            .filter(Boolean)
                                            .forEach(category => {
                                                if (!categoryGroups.has(category)) {
                                                    categoryGroups.set(category, []);
                                                }
                                            });

                                        galleryCategories.forEach((category, imageUrl) => {
                                            if (!category) return;
                                            const rowIndex = effectiveData.rows.findIndex(r => {
                                                const rowImageUrl = effectiveImageColumn ? extractImageUrl(r[effectiveImageColumn]) : null;
                                                return rowImageUrl === imageUrl;
                                            });
                                            const row = rowIndex >= 0 ? effectiveData.rows[rowIndex] : null;
                                            if (!row) return;

                                            // Generate rowId for this row - include index for uniqueness
                                            const rowId = `${imageUrl}||${row._sourceSheet || ''}||${rowIndex}`;

                                            if (!categoryGroups.has(category)) {
                                                categoryGroups.set(category, []);
                                            }
                                            categoryGroups.get(category)!.push({ imageUrl, row, rowId });
                                        });

                                        return (
                                            <div className="space-y-6">
                                                {Array.from(categoryGroups.entries()).map(([category, items]) => (
                                                    <div key={category} className="bg-white rounded-xl border border-slate-200 overflow-hidden">
                                                        <div
                                                            className={`flex items-center justify-between px-4 py-2 bg-purple-50 border-b border-purple-100 transition-all ${dragOverTarget === `category-${category}` ? 'ring-2 ring-green-400 ring-inset bg-green-100' : ''}`}
                                                            onDragOver={(e) => {
                                                                e.preventDefault();
                                                                e.dataTransfer.dropEffect = 'copy';
                                                                setDragOverTarget(`category-${category}`);
                                                            }}
                                                            onDragLeave={() => setDragOverTarget(null)}
                                                            onDrop={(e) => handleDropToCategory(e, category)}
                                                        >
                                                            <div className="flex items-center gap-2">
                                                                <Tag size={14} className="text-purple-500" />
                                                                <span className="font-medium text-purple-800">{category}</span>
                                                                <span className="text-xs text-purple-500 bg-purple-100 px-1.5 py-0.5 rounded">{items.length}</span>
                                                                {dragOverTarget === `category-${category}` && (
                                                                    <span className="text-xs text-green-600 bg-green-100 px-2 py-0.5 rounded">释放添加到此分类</span>
                                                                )}
                                                            </div>
                                                            <button
                                                                onClick={(e) => {
                                                                    e.stopPropagation();
                                                                    clearCategoryItems(category);
                                                                }}
                                                                className="text-[10px] text-red-600 hover:bg-red-50 px-2 py-1 rounded"
                                                            >
                                                                清空此标签
                                                            </button>
                                                        </div>
                                                        <div className="p-3 flex flex-wrap gap-3">
                                                            {items.length === 0 ? (
                                                                <div className="text-xs text-slate-400">
                                                                    暂无内容，可从画廊点击标签图标进行分类
                                                                </div>
                                                            ) : items.map(({ imageUrl, row, rowId }) => (
                                                                <div
                                                                    key={rowId}
                                                                    className={`relative group rounded-lg overflow-hidden border transition-all hover:shadow-md ${gallerySelectMode && selectedThumbnails.has(rowId)
                                                                        ? 'border-blue-500 ring-2 ring-blue-300'
                                                                        : 'border-slate-200 hover:border-purple-300'
                                                                        }`}
                                                                    style={{ width: config.thumbnailSize, height: config.thumbnailSize }}
                                                                    onClick={(e) => {
                                                                        if (!gallerySelectMode) return;
                                                                        if ((e.target as HTMLElement).closest('button')) return;
                                                                        scheduleThumbnailSelect(rowId);
                                                                    }}
                                                                    onDoubleClick={(e) => {
                                                                        const linkUrl = effectiveLinkColumn ? String(row[effectiveLinkColumn] || '') : '';
                                                                        handleThumbnailDoubleClick(e, rowId, linkUrl);
                                                                    }}
                                                                    onContextMenu={(e) => handleContextMenu(e, row, imageUrl)}
                                                                    onMouseEnter={(e) => handleThumbnailMouseEnter(imageUrl, e)}
                                                                    onMouseLeave={handleThumbnailMouseLeave}
                                                                >
                                                                    {/* Selection checkbox */}
                                                                    {gallerySelectMode && (
                                                                        <div
                                                                            className={`absolute top-1 left-1 w-5 h-5 rounded border-2 z-20 flex items-center justify-center cursor-pointer transition-all ${selectedThumbnails.has(rowId)
                                                                                ? 'bg-blue-500 border-blue-500 text-white'
                                                                                : 'bg-white/80 border-slate-400 text-transparent hover:border-blue-400'
                                                                                }`}
                                                                            onClick={(e) => {
                                                                                e.stopPropagation();
                                                                                setSelectedThumbnails(prev => {
                                                                                    const next = new Set(prev);
                                                                                    if (next.has(rowId)) {
                                                                                        next.delete(rowId);
                                                                                    } else {
                                                                                        next.add(rowId);
                                                                                    }
                                                                                    return next;
                                                                                });
                                                                            }}
                                                                        >
                                                                            {selectedThumbnails.has(rowId) && <Check size={14} />}
                                                                        </div>
                                                                    )}
                                                                    <img
                                                                        src={imageUrl}
                                                                        alt=""
                                                                        className="w-full h-full"
                                                                        style={{ objectFit: config.thumbnailFit }}
                                                                        loading="lazy"
                                                                    />
                                                                    {/* Favorite star */}
                                                                    {config.showFavoriteIcon && (
                                                                        <button
                                                                            onClick={(e) => handleStarClick(e, imageUrl, row)}
                                                                            className={`absolute top-1 right-1 p-1.5 rounded-full z-10 transition-all ${isFavorited(imageUrl)
                                                                                ? 'bg-amber-400 text-white opacity-100'
                                                                                : 'bg-black/40 text-white opacity-0 group-hover:opacity-70 hover:bg-amber-400 hover:opacity-100'
                                                                                }`}
                                                                        >
                                                                            <Star size={14} fill={isFavorited(imageUrl) ? 'currentColor' : 'none'} />
                                                                        </button>
                                                                    )}
                                                                    {/* Note indicator */}
                                                                    <button
                                                                        onClick={(e) => { e.stopPropagation(); openNoteModal(imageUrl, row); }}
                                                                        className={`absolute top-8 left-1 p-1.5 rounded z-10 transition-all ${getNoteForImage(imageUrl)
                                                                            ? 'bg-blue-500 text-white opacity-100'
                                                                            : 'bg-black/40 text-white opacity-0 group-hover:opacity-70 hover:bg-blue-400 hover:opacity-100'
                                                                            }`}
                                                                        title={getNoteForImage(imageUrl) || '添加备注'}
                                                                    >
                                                                        <MessageSquare size={14} />
                                                                    </button>
                                                                    {/* Category button */}
                                                                    {config.showCategoryIcon && (
                                                                        <button
                                                                            onClick={(e) => { e.stopPropagation(); openCategoryModal(imageUrl, row); }}
                                                                            className="absolute top-8 right-1 p-1.5 rounded z-10 transition-all bg-purple-500 text-white opacity-100"
                                                                            title={`【媒体标签】: ${category}`}
                                                                        >
                                                                            <Tag size={14} />
                                                                        </button>
                                                                    )}
                                                                </div>
                                                            ))}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>
                                        );
                                    })()
                                )}
                            </div>
    );
};
