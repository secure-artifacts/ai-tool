import React from 'react';
import { Search, Loader2, Star, Tag, Check, Layers, ChevronLeft, ChevronRight, X, ListFilter, Copy, Play, MessageSquare } from 'lucide-react';
import { GalleryConfig, extractImageUrl, parseDate } from '../galleryUtils';

export const GalleryToolbar = (props: any) => {
    const { 
        MessageSquare,
        calendarMonth,
        classificationMode,
        classificationOverrides,
        clearThumbnailSelection,
        collapseAll,
        config,
        copyFeedback,
        copySelectedThumbnailsData,
        customGroups,
        effectiveDateBinning,
        effectiveDateBins,
        effectiveDateColumn,
        effectiveGroupLevels,
        effectiveImageColumn,
        expandAll,
        extractImageUrl,
        favorites,
        favoritesSyncing,
        galleryCategories,
        gallerySelectMode,
        getRowGroupKey,
        localSearchInput,
        openBatchCategoryModal,
        openBatchNoteModal,
        parseDate,
        primaryGroupColumn,
        processedRows,
        selectedForClassification,
        selectedThumbnails,
        setCalendarMonth,
        setClassificationMode,
        setCollapsedGalleryGroups,
        setCopyFeedback,
        setDraggedItems,
        setGallerySelectMode,
        setLocalSearchInput,
        setSelectedForClassification,
        setSelectedThumbnails,
        setShowBatchFolderMenu,
        setShowCategoryView,
        setShowFavorites,
        showCategoryView,
        showFavorites,
        stats,
        updateConfig
    } = props;

    return (
                    <div className="flex-shrink-0 bg-white/90 backdrop-blur-sm border-b border-slate-200 px-2 flex items-center gap-1 h-7 shadow-[0_1px_2px_rgba(0,0,0,0.02)] z-10 w-full overflow-x-auto [&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]">
                        <div className="flex items-center gap-1 flex-1 min-w-max">
                            <span className="text-[10px] text-slate-500 hidden sm:inline-block mr-1 opacity-70">
                                {stats.totalImages}图 · {stats.groups}组
                            </span>

                            <div className="h-3 w-px bg-slate-300 mx-1"></div>

                            {/* Favorites toggle button */}
                            <button
                                onClick={() => {
                                    setShowFavorites(!showFavorites);
                                    if (!showFavorites) setShowCategoryView(false);
                                }}
                                className={`px-2 py-0.5 text-[10px] rounded flex items-center gap-1 transition-colors ${showFavorites
                                    ? 'bg-amber-100/80 text-amber-700 border border-amber-200 shadow-sm'
                                    : 'bg-transparent hover:bg-slate-100 text-slate-600'
                                    }`}
                            >
                                {favoritesSyncing ? (
                                    <Loader2 size={10} className="animate-spin" />
                                ) : (
                                    <Star size={10} fill={showFavorites ? 'currentColor' : 'none'} />
                                )}
                                收藏 {favorites.length > 0 && `(${favorites.length})`}
                            </button>

                            {/* Category View toggle button */}
                            <button
                                onClick={() => {
                                    setShowCategoryView(!showCategoryView);
                                    if (!showCategoryView) setShowFavorites(false);
                                }}
                                className={`px-2 py-0.5 text-[10px] rounded flex items-center gap-1 transition-colors ${showCategoryView
                                    ? 'bg-purple-100/80 text-purple-700 border border-purple-200 shadow-sm'
                                    : 'bg-transparent hover:bg-slate-100 text-slate-600'
                                    }`}
                            >
                                <Tag size={10} />
                                标签 {galleryCategories.size > 0 && `(${galleryCategories.size})`}
                            </button>

                            {/* Gallery selection mode toggle */}
                            {!showFavorites && config.viewMode === 'gallery' && (
                                <button
                                    onClick={() => {
                                        setGallerySelectMode(!gallerySelectMode);
                                        if (gallerySelectMode) setSelectedThumbnails(new Set());
                                    }}
                                    className={`px-2 py-0.5 text-[10px] rounded flex items-center gap-1 transition-colors ${gallerySelectMode
                                        ? 'bg-blue-100/80 text-blue-700 border border-blue-200 shadow-sm'
                                        : 'bg-transparent hover:bg-slate-100 text-slate-600'
                                        }`}
                                >
                                    <Check size={10} />
                                    {gallerySelectMode ? `选择 (${selectedThumbnails.size})` : '多选'}
                                </button>
                            )}

                            {/* Classification mode toggle */}
                            {!showFavorites && config.viewMode === 'gallery' && (
                                <>
                                    <button
                                        onClick={() => {
                                            setClassificationMode(!classificationMode);
                                            if (classificationMode) {
                                                setSelectedForClassification(new Set());
                                                setDraggedItems([]);
                                            }
                                        }}
                                        className={`px-2 py-0.5 text-[10px] rounded flex items-center gap-1 transition-colors tooltip-bottom ${classificationMode
                                            ? 'bg-purple-100/80 text-purple-700 border border-purple-200 shadow-sm'
                                            : 'bg-transparent hover:bg-slate-100 text-slate-600'
                                            }`}
                                        data-tip="开启分类模式"
                                    >
                                        <Layers size={10} />
                                        {classificationMode ? `分类 (${selectedForClassification.size})` : '分类'}
                                    </button>
                                    {/* Clear selection button - shown when items are selected */}
                                    {classificationMode && selectedForClassification.size > 0 && (
                                        <button
                                            onClick={() => {
                                                setSelectedForClassification(new Set());
                                                setDraggedItems([]);
                                                setCopyFeedback('✅ 已取消全选');
                                                setTimeout(() => setCopyFeedback(null), 1500);
                                            }}
                                            className="px-2 py-1 text-xs rounded flex items-center gap-1 bg-red-50 hover:bg-red-100 text-red-600 border border-red-200 transition-colors tooltip-bottom"
                                            data-tip="取消全选"
                                        >
                                            ✕ 取消选择
                                        </button>
                                    )}
                                </>
                            )}

                            {/* Global Keyword Search - 回车或点击搜索按钮触发，避免每字都重算 */}
                            {!showFavorites && (
                                <div className="relative flex items-center ml-1 gap-0.5">
                                    <input
                                        type="text"
                                        value={localSearchInput}
                                        onChange={e => setLocalSearchInput(e.target.value)}
                                        onKeyDown={e => {
                                            if (e.key === 'Enter') {
                                                updateConfig({ searchKeyword: localSearchInput.trim() });
                                            }
                                            if (e.key === 'Escape') {
                                                setLocalSearchInput('');
                                                updateConfig({ searchKeyword: '' });
                                            }
                                        }}
                                        onBlur={() => {
                                            if (localSearchInput.trim() !== (config.searchKeyword || '')) {
                                                updateConfig({ searchKeyword: localSearchInput.trim() });
                                            }
                                        }}
                                        placeholder="🔎 搜索 (回车确认)"
                                        className={`w-28 focus:w-36 px-2 py-0 min-h-[22px] text-[10px] bg-white border rounded transition-all focus:ring-1 focus:ring-blue-400 focus:border-blue-400 focus:outline-none ${config.searchKeyword
                                            ? 'border-blue-300 bg-blue-50/50'
                                            : 'border-slate-200 bg-slate-50'
                                            }`}
                                    />
                                    {(localSearchInput || config.searchKeyword) && (
                                        <button
                                            onClick={() => { setLocalSearchInput(''); updateConfig({ searchKeyword: '' }); }}
                                            className="absolute right-1 text-slate-400 hover:text-slate-600 p-0.5"
                                            title="清除搜索"
                                        >
                                            <X size={10} />
                                        </button>
                                    )}
                                </div>
                            )}

                            {/* Selection action buttons */}
                            {gallerySelectMode && selectedThumbnails.size > 0 && (
                                <div className="flex items-center gap-2 px-2 py-1 bg-blue-50 rounded-lg border border-blue-200">
                                    <span className="text-xs text-blue-600">已选 {selectedThumbnails.size} 项</span>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            setShowBatchFolderMenu({ x: e.clientX, y: e.clientY });
                                        }}
                                        className="px-2 py-0.5 text-xs bg-amber-500 text-white rounded hover:bg-amber-600 flex items-center gap-1"
                                    >
                                        <Star size={10} /> 批量收藏 ▾
                                    </button>
                                    <button
                                        onClick={() => copySelectedThumbnailsData(processedRows)}
                                        className="px-2 py-0.5 text-xs bg-emerald-500 text-white rounded hover:bg-emerald-600 flex items-center gap-1"
                                    >
                                        <Copy size={10} /> 复制数据
                                    </button>
                                    <button
                                        onClick={openBatchCategoryModal}
                                        className="px-2 py-0.5 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 flex items-center gap-1"
                                    >
                                        <Tag size={10} /> 批量分类
                                    </button>
                                    <button
                                        onClick={() => openBatchNoteModal(Array.from(selectedThumbnails))}
                                        className="px-2 py-0.5 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 flex items-center gap-1"
                                    >
                                        <MessageSquare size={10} /> 批量备注
                                    </button>
                                    <button
                                        onClick={clearThumbnailSelection}
                                        className="px-2 py-0.5 text-xs text-slate-600 bg-white border border-slate-200 rounded hover:bg-slate-100"
                                    >
                                        取消
                                    </button>
                                </div>
                            )}

                        </div>

                        {/* Feedback message overlay (absolute to save space) */}
                        {copyFeedback && (
                            <div className="absolute top-8 left-1/2 transform -translate-x-1/2 z-50 px-3 py-1 text-[10px] font-medium text-white bg-slate-800/90 backdrop-blur rounded-full shadow-lg pointer-events-none animate-in fade-in slide-in-from-top-2">
                                {copyFeedback}
                            </div>
                        )}

                        <div className="flex items-center gap-1 ml-auto shrink-0">
                            {config.viewMode === 'timeline' && (
                                <>
                                    <button onClick={expandAll} className="px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 rounded">全展开</button>
                                    <button onClick={collapseAll} className="px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 rounded">全折叠</button>
                                </>
                            )}

                            {config.viewMode === 'gallery' && (primaryGroupColumn || effectiveGroupLevels.length > 0 || (effectiveDateBinning && effectiveDateBins.length > 0)) && (
                                <>
                                    <button
                                        onClick={() => setCollapsedGalleryGroups(new Set())}
                                        className="px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 rounded"
                                    >
                                        全展开
                                    </button>
                                    <button
                                        onClick={() => {
                                            const allGroupKeys = new Set<string>();
                                            processedRows.forEach(row => {
                                                const imageUrl = extractImageUrl(row[effectiveImageColumn]);
                                                const overrideKey = imageUrl ? classificationOverrides[imageUrl] : null;

                                                if (overrideKey) {
                                                    allGroupKeys.add(overrideKey);
                                                } else if (primaryGroupColumn || effectiveGroupLevels.length > 0) {
                                                    allGroupKeys.add(getRowGroupKey(row));
                                                } else if (effectiveDateBinning && effectiveDateBins.length > 0 && effectiveDateColumn) {
                                                    const date = parseDate(row[effectiveDateColumn]);
                                                    if (date) {
                                                        const dateTime = date.getTime();
                                                        let found = false;
                                                        for (const bin of effectiveDateBins) {
                                                            const startTime = new Date(bin.startDate).getTime();
                                                            const endTime = new Date(bin.endDate).getTime() + 86400000 - 1;
                                                            if (dateTime >= startTime && dateTime <= endTime) {
                                                                const startD = new Date(bin.startDate);
                                                                const endD = new Date(bin.endDate);
                                                                allGroupKeys.add(`${startD.getMonth() + 1}/${startD.getDate()}-${endD.getMonth() + 1}/${endD.getDate()}`);
                                                                found = true;
                                                                break;
                                                            }
                                                        }
                                                        if (!found) allGroupKeys.add('其他');
                                                    } else {
                                                        allGroupKeys.add('无效日期');
                                                    }
                                                }
                                            });
                                            customGroups.forEach(g => allGroupKeys.add(g));
                                            setCollapsedGalleryGroups(allGroupKeys);
                                        }}
                                        className="px-2 py-0.5 text-[10px] text-slate-600 hover:bg-slate-100 rounded"
                                    >
                                        全折叠
                                    </button>
                                </>
                            )}

                            {config.viewMode === 'calendar' && config.calendarMode === 'month' && (
                                <div className="flex items-center gap-0.5 bg-slate-50 border border-slate-200 rounded px-1">
                                    <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() - 1))} className="p-0.5 hover:bg-slate-200 rounded text-slate-500">
                                        <ChevronLeft size={12} />
                                    </button>
                                    <span className="text-[10px] font-medium min-w-[60px] text-center text-slate-700">{calendarMonth.getFullYear()}年{calendarMonth.getMonth() + 1}月</span>
                                    <button onClick={() => setCalendarMonth(new Date(calendarMonth.getFullYear(), calendarMonth.getMonth() + 1))} className="p-0.5 hover:bg-slate-200 rounded text-slate-500">
                                        <ChevronRight size={12} />
                                    </button>
                                </div>
                            )}
                        </div>
                    </div>
    );
};
