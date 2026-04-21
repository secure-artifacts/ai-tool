import React from 'react';
import { Settings2, X, Grid3X3, FolderTree, LayoutGrid, Table2, CalendarDays, Bookmark, Loader2, Cloud, CloudOff, Info, Check, Trash2, Edit3, Save, Plus, ArrowUp, ArrowDown, Image } from 'lucide-react';
import { GalleryConfig, GalleryPreset, SavedConfig } from '../galleryUtils';

export const GalleryConfigPanel = (props: any) => {
    const { 
        BarChart2,
        CATEGORY_COLUMN,
        ChevronDown,
        Download,
        ExternalLink,
        FileText,
        FolderOpen,
        Link2,
        NOTE_COLUMN,
        RefreshCw,
        RotateCcw,
        Star,
        Tag,
        Upload,
        Video,
        activePresetId,
        advancedSectionRef,
        autoSyncCategoriesToSheet,
        autoSyncNotesToSheet,
        categoriesSyncCount,
        cloudError,
        cloudSyncEnabled,
        cloudSyncing,
        collapsedSections,
        config,
        copyDataToClipboard,
        copyViewModal,
        currentViewLabel,
        customPresets,
        data,
        deleteCustomPreset,
        deletePreset,
        downloadAllThumbnails,
        downloadProgress,
        effectiveData,
        effectivePureImageMode,
        effectiveTranspose,
        getDefaultConfig,
        getGoogleAccessToken,
        handleResetConfig,
        headerCollapsed,
        isBatchCategorySyncing,
        isBatchSyncing,
        loadPreset,
        notesSectionRef,
        notesSyncCount,
        parseGoogleSheetsUrl,
        presets,
        processedRows,
        renamePreset,
        savePreset,
        setActivePresetId,
        setAutoSyncCategoriesToSheet,
        setAutoSyncNotesToSheet,
        setCopyViewModal,
        setEditingPreset,
        setGalleryPage,
        setGroupLoadedCount,
        setSheetsError,
        setSheetsSpreadsheetId,
        setSheetsUrl,
        setShowConfig,
        setShowPresetEditor,
        sheetsError,
        sheetsSpreadsheetId,
        sheetsSyncing,
        sheetsUrl,
        stats,
        syncAllCategoriesToSheet,
        syncAllNotesToSheet,
        syncToGoogleSheet,
        toggleSection,
        updateConfig,
        viewSectionRef
    } = props;

    return (
                    <>
                        <div className="absolute inset-0 z-20 bg-slate-900/10 backdrop-blur-[1px]" onClick={() => setShowConfig(false)} />
                        {/* Drawer content floating above the layout with smaller footprint */}
                        <div className="absolute top-2 left-10 lg:left-12 bottom-6 w-[280px] z-50 bg-white/95 backdrop-blur-xl border border-slate-200/60 rounded-xl overflow-y-auto p-3 space-y-4 shadow-[0_8px_30px_rgb(0,0,0,0.12)] [&_label]:font-medium [&_label]:text-slate-700 animate-in slide-in-from-left-4 fade-in duration-200 custom-scrollbar">

                            <div className="border-b border-slate-200 pb-3 space-y-3">
                                <div className="flex items-start justify-between gap-2">
                                    <div className="flex-1 space-y-2">
                                        <div className="flex items-center gap-2">
                                            <Settings2 size={16} className="text-slate-600" />
                                            <h3 className="text-xs font-semibold text-slate-800">画廊配置</h3>
                                            <span className="text-[10px] text-slate-600 bg-slate-100 px-2 py-0.5 rounded-full">
                                                当前视图：{currentViewLabel}
                                            </span>
                                        </div>
                                    </div>
                                    <div className="flex items-center gap-1">
                                        <button
                                            onClick={() => setShowConfig(false)}
                                            className="p-1.5 bg-slate-100 hover:bg-slate-200 rounded text-slate-600 hover:text-slate-800 transition"
                                            title="收起配置面板"
                                        >
                                            <X size={16} />
                                        </button>
                                    </div>
                                </div>

                                {headerCollapsed ? (
                                    <div className="flex items-center gap-2">
                                        <select
                                            value={config.viewMode}
                                            onChange={e => updateConfig({ viewMode: e.target.value as GalleryConfig['viewMode'] })}
                                            className="flex-1 px-2 py-1 text-[10px] bg-white text-slate-800 border border-slate-200 rounded"
                                        >
                                            <option value="gallery">缩略图</option>
                                            <option value="tree">🌳 树形</option>
                                            <option value="timeline">时间轴</option>
                                            <option value="matrix">矩阵</option>
                                            <option value="calendar">日历</option>
                                        </select>
                                        <span className="text-[9px] text-slate-500">顶部已收起</span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="grid grid-cols-5 gap-1 bg-slate-100 p-1 rounded-lg">
                                            {[
                                                { mode: 'gallery', icon: Grid3X3, label: '缩略图' },
                                                { mode: 'tree', icon: FolderTree, label: '树形' },
                                                { mode: 'timeline', icon: LayoutGrid, label: '时间轴' },
                                                { mode: 'matrix', icon: Table2, label: '矩阵' },
                                                { mode: 'calendar', icon: CalendarDays, label: '日历' },
                                            ].map(({ mode, icon: Icon, label }) => (
                                                <button
                                                    key={mode}
                                                    onClick={() => updateConfig({ viewMode: mode as GalleryConfig['viewMode'] })}
                                                    className={`px-1.5 py-1.5 text-[9px] font-medium rounded-md transition-all flex flex-col items-center gap-0.5 ${config.viewMode === mode ? 'bg-white shadow-sm text-slate-800' : 'text-slate-500'}`}
                                                >
                                                    <Icon size={12} /> {label}
                                                </button>
                                            ))}
                                        </div>

                                        <div className="space-y-1.5">
                                            <div className="flex items-center justify-between">
                                                <span className="text-[10px] font-semibold text-slate-600 flex items-center gap-1">
                                                    <Bookmark size={12} />
                                                    配置版本
                                                    {cloudSyncing ? (
                                                        <Loader2 size={10} className="animate-spin text-indigo-500" />
                                                    ) : cloudSyncEnabled ? (
                                                        <Cloud size={10} className="text-green-500" />
                                                    ) : (
                                                        <CloudOff size={10} className="text-slate-400" />
                                                    )}
                                                </span>
                                                {cloudError && <span className="text-[9px] text-red-500">{cloudError}</span>}
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <select
                                                    value={activePresetId || ''}
                                                    onChange={e => {
                                                        const id = e.target.value;
                                                        if (!id) {
                                                            setActivePresetId(null);
                                                            return;
                                                        }
                                                        const preset = presets.find(p => p.id === id);
                                                        if (preset) loadPreset(preset);
                                                    }}
                                                    className="flex-1 px-2 py-1 text-[10px] bg-white text-slate-800 border border-slate-200 rounded"
                                                >
                                                    <option value="">当前配置（未保存）</option>
                                                    {presets.map(preset => (
                                                        <option key={preset.id} value={preset.id}>{preset.name}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={savePreset}
                                                    disabled={cloudSyncing}
                                                    className="px-2 py-1 text-[9px] bg-indigo-500 hover:bg-indigo-600 text-white rounded disabled:opacity-50"
                                                >
                                                    保存
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (!activePresetId) return;
                                                        const preset = presets.find(p => p.id === activePresetId);
                                                        if (!preset) return;
                                                        const newName = prompt('输入新版本名称:', preset.name);
                                                        if (newName && newName.trim() && newName.trim() !== preset.name) {
                                                            renamePreset(preset.id, newName.trim());
                                                        }
                                                    }}
                                                    disabled={!activePresetId}
                                                    className="px-2 py-1 text-[9px] bg-slate-100 text-slate-600 hover:bg-slate-200 rounded disabled:opacity-50"
                                                >
                                                    重命名
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        if (!activePresetId) return;
                                                        const preset = presets.find(p => p.id === activePresetId);
                                                        if (!preset) return;
                                                        if (confirm(`删除版本 "${preset.name}"？`)) {
                                                            deletePreset(preset.id);
                                                        }
                                                    }}
                                                    disabled={!activePresetId}
                                                    className="px-2 py-1 text-[9px] bg-red-50 text-red-600 hover:bg-red-100 rounded disabled:opacity-50"
                                                >
                                                    删除
                                                </button>
                                            </div>
                                        </div>

                                        <div className="space-y-2">
                                            <button
                                                onClick={copyDataToClipboard}
                                                className="w-full py-1.5 text-[10px] bg-emerald-500 text-white rounded hover:bg-emerald-600 flex items-center justify-center gap-1 tooltip-bottom"
                                                data-tip="复制筛选后的数据到剪贴板，可粘贴到谷歌表格"
                                            >
                                                <Download size={10} /> 复制到剪贴板 ({processedRows.length}行)
                                            </button>
                                            <button
                                                onClick={() => setCopyViewModal({ ...copyViewModal, open: true })}
                                                className="w-full py-1.5 text-[10px] bg-purple-500 text-white rounded hover:bg-purple-600 flex items-center justify-center gap-1 tooltip-bottom"
                                                data-tip="复制当前分组视图布局（支持横向网格/竖向分组明细）"
                                            >
                                                <Image size={10} /> 复制视图布局
                                            </button>
                                            <button
                                                onClick={downloadAllThumbnails}
                                                disabled={!!downloadProgress}
                                                className="w-full py-1.5 text-[10px] bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-70 flex items-center justify-center gap-1 tooltip-bottom"
                                                data-tip="下载当前筛选后的所有图片为 ZIP 压缩包"
                                            >
                                                {downloadProgress ? (
                                                    <>
                                                        <Loader2 size={10} className="animate-spin" />
                                                        {downloadProgress.status}
                                                    </>
                                                ) : (
                                                    <>
                                                        <Download size={10} /> 下载所有缩略图 ({processedRows.length})
                                                    </>
                                                )}
                                            </button>
                                            <div className="grid grid-cols-2 gap-2">
                                                <button
                                                    onClick={syncAllNotesToSheet}
                                                    disabled={isBatchSyncing || notesSyncCount === 0}
                                                    className="py-1.5 text-[9px] font-medium bg-blue-100 text-blue-700 hover:bg-blue-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                                                >
                                                    {isBatchSyncing ? (
                                                        <>
                                                            <Loader2 size={10} className="animate-spin" />
                                                            同步中...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Upload size={10} />
                                                            备注同步 {NOTE_COLUMN}列
                                                        </>
                                                    )}
                                                </button>
                                                <button
                                                    onClick={syncAllCategoriesToSheet}
                                                    disabled={isBatchCategorySyncing || categoriesSyncCount === 0}
                                                    className="py-1.5 text-[9px] font-medium bg-purple-100 text-purple-700 hover:bg-purple-200 rounded transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-1"
                                                >
                                                    {isBatchCategorySyncing ? (
                                                        <>
                                                            <Loader2 size={10} className="animate-spin" />
                                                            同步中...
                                                        </>
                                                    ) : (
                                                        <>
                                                            <Tag size={10} />
                                                            分类同步 {CATEGORY_COLUMN}列
                                                        </>
                                                    )}
                                                </button>
                                            </div>
                                            <div className="text-[9px] text-slate-400">A=备注 · B=媒体标签</div>
                                        </div>
                                    </>
                                )}
                            </div>

                            <button
                                onClick={handleResetConfig}
                                className="w-full py-1.5 text-[10px] text-red-600 hover:bg-red-50 rounded border border-red-200 flex items-center justify-center gap-1"
                            >
                                <Trash2 size={10} /> 重置配置
                            </button>

                            {/* Gallery Pagination Options */}
                            {config.viewMode === 'gallery' && (
                                <div ref={viewSectionRef}>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">每页显示</label>
                                    <div className="flex flex-wrap gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200">
                                        {[
                                            { size: -1, label: '渐进' },
                                            { size: 0, label: '全部' },
                                            { size: 100, label: '100' },
                                            { size: 200, label: '200' },
                                            { size: 300, label: '300' },
                                            { size: 500, label: '500' },
                                        ].map(({ size, label }) => (
                                            <button
                                                key={size}
                                                onClick={() => {
                                                    updateConfig({ galleryPageSize: size });
                                                    setGalleryPage(1);
                                                    setGroupLoadedCount({});
                                                }}
                                                className={`px-2 py-1 text-[9px] font-medium rounded transition-all ${config.galleryPageSize === size ? 'bg-purple-500 text-white shadow-sm' : 'text-slate-600 hover:bg-slate-100'}`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                        {/* Custom input inline */}
                                        <input
                                            type="number"
                                            min={10}
                                            max={2000}
                                            placeholder="自定义"
                                            defaultValue={config.galleryPageSize > 0 && ![100, 200, 300, 500].includes(config.galleryPageSize) ? config.galleryPageSize : ''}
                                            onBlur={(e) => {
                                                const val = parseInt(e.target.value);
                                                if (val && val >= 10 && val <= 2000) {
                                                    updateConfig({ galleryPageSize: val });
                                                    setGalleryPage(1);
                                                    setGroupLoadedCount({});
                                                }
                                            }}
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter') {
                                                    const val = parseInt((e.target as HTMLInputElement).value);
                                                    if (val && val >= 10 && val <= 2000) {
                                                        updateConfig({ galleryPageSize: val });
                                                        setGalleryPage(1);
                                                        setGroupLoadedCount({});
                                                    }
                                                }
                                            }}
                                            className="w-10 px-1 py-0.5 text-[9px] bg-white border border-slate-200 rounded text-center focus:ring-1 focus:ring-purple-300 focus:border-purple-400"
                                        />
                                    </div>
                                </div>
                            )}

                            {/* Calendar Mode Options */}
                            {config.viewMode === 'calendar' && (
                                <div ref={viewSectionRef}>
                                    <label className="block text-xs font-semibold text-slate-700 mb-1">日历显示</label>
                                    <div className="grid grid-cols-5 gap-1 bg-slate-50 p-1 rounded-lg border border-slate-200">
                                        {[
                                            { mode: 'month', label: '月' },
                                            { mode: 'week', label: '周' },
                                            { mode: 'day', label: '日' },
                                            { mode: 'range7', label: '±7天' },
                                            { mode: 'scroll', label: '横滚' },
                                        ].map(({ mode, label }) => (
                                            <button
                                                key={mode}
                                                onClick={() => updateConfig({ calendarMode: mode as GalleryConfig['calendarMode'] })}
                                                className={`px-1 py-1 text-[9px] font-medium rounded ${config.calendarMode === mode ? 'bg-indigo-100 text-indigo-700' : 'text-slate-500 hover:bg-slate-100'}`}
                                            >
                                                {label}
                                            </button>
                                        ))}
                                    </div>
                                    {config.calendarMode !== 'month' && (
                                        <div className="mt-1.5">
                                            <label className="block text-[9px] text-slate-500 mb-0.5">选择日期</label>
                                            <input
                                                type="date"
                                                value={config.selectedDate}
                                                onChange={e => updateConfig({ selectedDate: e.target.value })}
                                                className="w-full px-2 py-1 text-xs bg-white text-slate-800 border border-slate-200 rounded"
                                            />
                                        </div>
                                    )}
                                    {config.calendarMode === 'scroll' && (
                                        <div className="mt-1.5">
                                            <label className="block text-[9px] text-slate-500 mb-0.5">显示天数</label>
                                            <div className="flex gap-1">
                                                {[1, 2, 3, 4, 5].map(n => (
                                                    <button
                                                        key={n}
                                                        onClick={() => updateConfig({ scrollDaysPerView: n })}
                                                        className={`flex-1 py-1 text-[10px] rounded transition ${config.scrollDaysPerView === n
                                                            ? 'bg-indigo-500 text-white'
                                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                            }`}
                                                    >
                                                        {n}天
                                                    </button>
                                                ))}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            )}

                            {/* Matrix Options */}
                            {config.viewMode === 'matrix' && (
                                <div ref={viewSectionRef} className="space-y-2">
                                    <label className="block text-xs font-semibold text-slate-700">矩阵行列设置</label>
                                    <div className="grid grid-cols-2 gap-2">
                                        <div>
                                            <label className="block text-[9px] text-slate-500 mb-0.5">列（顶部表头）</label>
                                            <select
                                                value={config.matrixColColumn}
                                                onChange={e => updateConfig({ matrixColColumn: e.target.value })}
                                                className="w-full px-2 py-1 text-[10px] bg-white text-slate-800 border border-slate-200 rounded"
                                            >
                                                <option value="">选择列...</option>
                                                {effectiveData.columns.map(col => (
                                                    <option key={col} value={col}>{col}</option>
                                                ))}
                                            </select>
                                        </div>
                                        <div>
                                            <label className="block text-[9px] text-slate-500 mb-0.5">行（左侧表头）</label>
                                            <select
                                                value={config.matrixRowColumn}
                                                onChange={e => updateConfig({ matrixRowColumn: e.target.value })}
                                                className="w-full px-2 py-1 text-[10px] bg-white text-slate-800 border border-slate-200 rounded"
                                            >
                                                <option value="">选择列...</option>
                                                <option value="__GROUP_SETTINGS__">[分组设置]</option>
                                                {effectiveData.columns.map(col => (
                                                    <option key={col} value={col}>{col}</option>
                                                ))}
                                            </select>
                                        </div>
                                        {/* Swap Button */}
                                        <button
                                            onClick={() => updateConfig({
                                                matrixRowColumn: config.matrixColColumn,
                                                matrixColColumn: config.matrixRowColumn
                                            })}
                                            className="mt-1 w-full py-1 text-[10px] text-blue-600 bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 flex items-center justify-center gap-1 tooltip-bottom"
                                            data-tip="互换行列"
                                        >
                                            ↔️ 行列互换
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* Thumbnail Size */}
                            <div className="border-t border-sky-200 pt-3">
                                <label className="block text-xs font-semibold text-slate-700 mb-1">缩略图: {config.thumbnailSize}px</label>
                                <input
                                    type="range"
                                    min="80"
                                    max="500"
                                    value={config.thumbnailSize}
                                    onChange={e => updateConfig({ thumbnailSize: parseInt(e.target.value) })}
                                    className="w-full"
                                />
                                {/* Thumbnail Fit Mode Toggle */}
                                <div className="flex items-center gap-2 mt-2">
                                    <button
                                        onClick={() => updateConfig({ thumbnailFit: 'cover' })}
                                        className={`flex-1 px-2 py-1.5 text-[10px] rounded border transition-colors ${config.thumbnailFit === 'cover'
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                                            }`}
                                    >
                                        <Grid3X3 size={14} className="inline mr-1" /> 填充方格
                                    </button>
                                    <button
                                        onClick={() => updateConfig({ thumbnailFit: 'contain' })}
                                        className={`flex-1 px-2 py-1.5 text-[10px] rounded border transition-colors ${config.thumbnailFit === 'contain'
                                            ? 'bg-blue-600 text-white border-blue-600'
                                            : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                                            }`}
                                    >
                                        <Image size={14} className="inline mr-1" /> 原始比例
                                    </button>
                                </div>
                                {/* Label Overlay Toggle */}
                                <div className="flex items-center gap-2 mt-2">
                                    <input
                                        type="checkbox"
                                        id="showLabelOverlay"
                                        checked={config.showLabelOverlay}
                                        onChange={e => updateConfig({ showLabelOverlay: e.target.checked })}
                                        className="w-4 h-4 rounded border-slate-300"
                                    />
                                    <label htmlFor="showLabelOverlay" className="text-xs text-slate-600">
                                        持续显示信息标签
                                    </label>
                                </div>
                                {/* Favorite Icon Toggle */}
                                <div className="flex items-center gap-2 mt-1">
                                    <input
                                        type="checkbox"
                                        id="showFavoriteIcon"
                                        checked={config.showFavoriteIcon}
                                        onChange={e => updateConfig({ showFavoriteIcon: e.target.checked })}
                                        className="w-4 h-4 rounded border-slate-300"
                                    />
                                    <label htmlFor="showFavoriteIcon" className="text-xs text-slate-600">
                                        显示收藏按钮 <Star size={12} className="inline ml-1" />
                                    </label>
                                </div>
                                <div className="flex items-center gap-2 mt-1">
                                    <input
                                        type="checkbox"
                                        id="showCategoryIcon"
                                        checked={config.showCategoryIcon}
                                        onChange={e => updateConfig({ showCategoryIcon: e.target.checked })}
                                        className="w-4 h-4 rounded border-slate-300"
                                    />
                                    <label htmlFor="showCategoryIcon" className="text-xs text-slate-600">
                                        显示媒体标签按钮 <Tag size={12} className="inline ml-1" />
                                    </label>
                                </div>
                                {/* Hover Preview Toggle */}
                                <div className="flex items-center justify-between mt-2">
                                    <span className="text-xs text-slate-600">悬浮放大缩略图</span>
                                    <label className="relative inline-flex items-center cursor-pointer">
                                        <input
                                            type="checkbox"
                                            checked={config.hoverPreview}
                                            onChange={() => updateConfig({ hoverPreview: !config.hoverPreview })}
                                            className="sr-only peer"
                                        />
                                        <div className="w-9 h-5 bg-slate-300 peer-focus:ring-2 peer-focus:ring-indigo-300 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-indigo-500"></div>
                                    </label>
                                </div>
                            </div>



                            {/* Transpose Data Status - controlled from unified settings */}
                            {effectiveTranspose && (
                                <div className="border-t border-purple-200 pt-3 bg-purple-50 -mx-4 px-4 pb-3">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-purple-700 font-medium flex items-center gap-1"><RefreshCw size={12} /> 转置数据已启用</span>
                                    </div>
                                    <p className="text-[10px] text-purple-600 mt-1">
                                        第一列作为字段名，其他列作为记录。在顶部「配置」按钮中可关闭。
                                    </p>
                                </div>
                            )}

                            {/* Pure Image Mode Status - controlled from unified settings */}
                            {effectivePureImageMode && (
                                <div className="border-t border-emerald-200 pt-3 bg-emerald-50 -mx-4 px-4 pb-3">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-emerald-700 font-medium flex items-center gap-1"><Image size={12} /> 纯图片模式已启用</span>
                                        <span className="text-xs text-emerald-600 font-semibold">{effectiveData.rows.length} 张图片</span>
                                    </div>
                                    <p className="text-[10px] text-emerald-600 mt-1">
                                        自动扫描所有单元格，提取所有图片URL并平铺显示。在顶部「配置」按钮中可关闭。
                                    </p>
                                </div>
                            )}

                            {/* Show All Images Toggle */}
                            <div className="border-t border-sky-200 pt-3">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={config.showAllImages}
                                        onChange={e => updateConfig({ showAllImages: e.target.checked })}
                                        className="w-4 h-4 rounded border-slate-300 text-indigo-500 focus:ring-indigo-500"
                                    />
                                    <span className="text-xs text-slate-700 flex items-center gap-1"><Image size={12} /> 显示全部图片 (不限制数量)</span>
                                </label>
                                <p className="text-[10px] text-slate-400 mt-1 ml-6">关闭时，每个分组/单元格只显示部分图片以提高性能</p>
                            </div>

                            <div ref={notesSectionRef} className="text-[11px] font-semibold text-slate-800 tracking-wide">备注与分类</div>

                            {/* Sync Settings */}
                            <div className="border-t border-sky-200 pt-3 space-y-2">
                                <div className="flex items-center justify-between bg-blue-50 px-2 py-1.5 rounded-lg border border-blue-100">
                                    <div className="flex items-center gap-1.5">
                                        <Upload size={12} className={autoSyncNotesToSheet ? 'text-blue-600' : 'text-slate-400'} />
                                        <span className={`text-[10px] font-medium ${autoSyncNotesToSheet ? 'text-blue-700' : 'text-slate-500'}`}>
                                            备注 → 表格{NOTE_COLUMN}列
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => setAutoSyncNotesToSheet(!autoSyncNotesToSheet)}
                                        className={`relative w-8 h-4 rounded-full transition-colors ${autoSyncNotesToSheet ? 'bg-blue-500' : 'bg-slate-300'}`}
                                    >
                                        <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${autoSyncNotesToSheet ? 'left-4' : 'left-0.5'}`} />
                                    </button>
                                </div>
                                <div className="flex items-center justify-between bg-purple-50 px-2 py-1.5 rounded-lg border border-purple-100">
                                    <div className="flex items-center gap-1.5">
                                        <Tag size={12} className={autoSyncCategoriesToSheet ? 'text-purple-600' : 'text-slate-400'} />
                                        <span className={`text-[10px] font-medium ${autoSyncCategoriesToSheet ? 'text-purple-700' : 'text-slate-500'}`}>
                                            分类 → 表格{CATEGORY_COLUMN}列
                                        </span>
                                    </div>
                                    <button
                                        onClick={() => setAutoSyncCategoriesToSheet(!autoSyncCategoriesToSheet)}
                                        className={`relative w-8 h-4 rounded-full transition-colors ${autoSyncCategoriesToSheet ? 'bg-purple-500' : 'bg-slate-300'}`}
                                    >
                                        <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${autoSyncCategoriesToSheet ? 'left-4' : 'left-0.5'}`} />
                                    </button>
                                </div>
                            </div>

                            {/* Category/Tag Section */}
                            <div className="border-t border-sky-200 pt-3 space-y-3">
                                <div className="flex items-center gap-2">
                                    <Tag size={14} className="text-purple-500" />
                                    <span className="text-xs font-semibold text-slate-700">【媒体标签】分类设置</span>
                                </div>
                                <p className="text-[10px] text-slate-400">点击图标可快速分类</p>

                                {/* Category Options - 始终显示 */}
                                <div className="space-y-2 bg-slate-50 p-2 rounded-lg">
                                    {/* Built-in Presets */}
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] font-medium text-slate-600">快速预设</span>
                                            <div className="flex items-center gap-2">
                                                <button
                                                    onClick={() => updateConfig({ categoryOptions: getDefaultConfig().categoryOptions })}
                                                    className="text-[9px] text-slate-600 hover:text-slate-700 flex items-center gap-0.5 tooltip-bottom"
                                                    data-tip="恢复默认预设"
                                                >
                                                    <RotateCcw size={10} /> 恢复默认预设
                                                </button>
                                                <button
                                                    onClick={() => {
                                                        setEditingPreset({
                                                            id: Date.now().toString(),
                                                            name: '',
                                                            emoji: '🏷️',
                                                            options: [...config.categoryOptions]
                                                        });
                                                        setShowPresetEditor(true);
                                                    }}
                                                    className="text-[9px] text-purple-600 hover:text-purple-700 flex items-center gap-0.5 tooltip-bottom"
                                                    data-tip="保存当前分类为预设"
                                                >
                                                    <Plus size={10} /> 保存为预设
                                                </button>
                                            </div>
                                        </div>
                                        <div className="flex flex-wrap gap-1">
                                            {/* Built-in presets */}
                                            <button
                                                onClick={() => updateConfig({
                                                    categoryOptions: ['神父修女', '玛丽亚', '圣人类', '游行', '各种人物', '祷告词', '主耶稣', '天使', '元素', '其他']
                                                })}
                                                className="px-2 py-1 text-[10px] bg-purple-100 text-purple-700 hover:bg-purple-200 rounded transition-colors"
                                            >
                                                <Image size={12} className="inline mr-1" /> 画面分类
                                            </button>
                                            <button
                                                onClick={() => updateConfig({
                                                    categoryOptions: ['开场动画(效果类)', '创意开场', '镜头运动/转场', '场景', '画面形式(效果/动画)', '画面素材', '故事类(真实人物)', '故事类(卡通)']
                                                })}
                                                className="px-2 py-1 text-[10px] bg-blue-100 text-blue-700 hover:bg-blue-200 rounded transition-colors"
                                            >
                                                <Video size={12} className="inline mr-1" /> 参考分类
                                            </button>
                                            <button
                                                onClick={() => updateConfig({
                                                    categoryOptions: ['图片', '视频', 'Reels祷告词', 'Sora', '效果类视频', '主耶稣类视频', '玛丽亚视频']
                                                })}
                                                className="px-2 py-1 text-[10px] bg-green-100 text-green-700 hover:bg-green-200 rounded transition-colors"
                                            >
                                                <FileText size={12} className="inline mr-1" /> 贴文类型
                                            </button>
                                            <button
                                                onClick={() => updateConfig({
                                                    categoryOptions: ['安东尼奥', '边框设计', '成年男性', '成年女性', '祷告主词', '风景', '黑色背景', '家庭', '教堂', '旧纸张', '卡通插画耶稣', '卡通人物', '蜡烛', '老人', '卢西亚', '玛丽亚', '玛丽亚骑驴', '玫瑰花', '年轻人', '其他', '神父', '圣家族', '圣丽塔', '圣婴耶稣', '十字架', '石头石板', '手拿纸', '书本', '特蕾莎', '天使', '小学生/学生', '修女', '耶稣帮助人', '耶稣骑驴', '婴儿/幼儿', '游行', '灾难', '知更鸟', '主耶稣', '文档']
                                                })}
                                                className="px-2 py-1 text-[10px] bg-orange-100 text-orange-700 hover:bg-orange-200 rounded transition-colors"
                                            >
                                                <Tag size={10} className="inline mr-0.5" /> 画面细节
                                            </button>
                                            {/* Custom presets from cloud */}
                                            {customPresets.map((preset) => (
                                                <div key={preset.id} className="group relative">
                                                    <button
                                                        onClick={() => updateConfig({ categoryOptions: preset.options })}
                                                        className="px-2 py-1 text-[10px] bg-amber-100 text-amber-700 hover:bg-amber-200 rounded transition-colors"
                                                    >
                                                        {preset.emoji} {preset.name}
                                                    </button>
                                                    <button
                                                        onClick={(e) => {
                                                            e.stopPropagation();
                                                            if (confirm(`删除预设 "${preset.name}"？`)) {
                                                                deleteCustomPreset(preset.id);
                                                            }
                                                        }}
                                                        className="absolute -top-1 -right-1 w-3 h-3 bg-red-500 text-white rounded-full text-[8px] opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center"
                                                    >
                                                        ×
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                        {customPresets.length > 0 && (
                                            <p className="text-[9px] text-slate-400 flex items-center gap-1">
                                                <Cloud size={10} /> {customPresets.length} 个自定义预设已同步
                                            </p>
                                        )}
                                    </div>

                                    <div className="flex items-center justify-between border-t border-slate-200 pt-2">
                                        <span className="text-[10px] font-medium text-slate-600">当前分类选项</span>
                                        <span className="text-[10px] text-slate-400">{config.categoryOptions.length} 项</span>
                                    </div>
                                    <div className="flex flex-wrap gap-1">
                                        {config.categoryOptions.map((cat, idx) => (
                                            <div key={idx} className="flex items-center gap-1 bg-white border border-slate-200 rounded px-2 py-1 group">
                                                <span className="text-[10px] text-slate-700">{cat}</span>
                                                <button
                                                    onClick={() => {
                                                        const newOptions = config.categoryOptions.filter((_, i) => i !== idx);
                                                        updateConfig({ categoryOptions: newOptions });
                                                    }}
                                                    className="text-slate-300 hover:text-red-500 opacity-0 group-hover:opacity-100 transition-opacity"
                                                >
                                                    <X size={10} />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                    {/* Add new category */}
                                    <div className="flex gap-1">
                                        <input
                                            type="text"
                                            placeholder="新分类..."
                                            className="flex-1 px-2 py-1 text-[10px] border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                            onKeyDown={(e) => {
                                                if (e.key === 'Enter' && (e.target as HTMLInputElement).value.trim()) {
                                                    const newCat = (e.target as HTMLInputElement).value.trim();
                                                    if (!config.categoryOptions.includes(newCat)) {
                                                        updateConfig({ categoryOptions: [...config.categoryOptions, newCat] });
                                                    }
                                                    (e.target as HTMLInputElement).value = '';
                                                }
                                            }}
                                        />
                                        <button
                                            onClick={(e) => {
                                                const input = (e.currentTarget.previousElementSibling as HTMLInputElement);
                                                if (input.value.trim() && !config.categoryOptions.includes(input.value.trim())) {
                                                    updateConfig({ categoryOptions: [...config.categoryOptions, input.value.trim()] });
                                                    input.value = '';
                                                }
                                            }}
                                            className="px-2 py-1 text-[10px] bg-purple-500 text-white rounded hover:bg-purple-600"
                                        >
                                            <Plus size={10} />
                                        </button>
                                    </div>
                                    <div className="space-y-1">
                                        <textarea
                                            rows={2}
                                            placeholder="批量粘贴分类（支持多单元格/多行）"
                                            className="w-full px-2 py-1 text-[10px] border border-slate-200 rounded focus:outline-none focus:ring-1 focus:ring-purple-500"
                                            onPaste={(e) => {
                                                const text = e.clipboardData.getData('text');
                                                if (!text) return;
                                                e.preventDefault();
                                                const items = text
                                                    .split(/[\t\n\r]+/)
                                                    .map(s => s.trim())
                                                    .filter(Boolean);
                                                if (items.length === 0) return;
                                                const merged = [...config.categoryOptions];
                                                items.forEach(item => {
                                                    if (!merged.includes(item)) merged.push(item);
                                                });
                                                updateConfig({ categoryOptions: merged });
                                            }}
                                        />
                                        <p className="text-[9px] text-slate-400">从谷歌表格复制一片区域后直接粘贴即可</p>
                                    </div>

                                    {/* Target Column */}
                                    <div className="flex items-center gap-2 pt-2 border-t border-slate-200">
                                        <span className="text-[10px] text-slate-500">目标列:</span>
                                        <span className="text-[10px] font-medium text-slate-700">{CATEGORY_COLUMN} 列（固定）</span>
                                    </div>
                                    <div className="text-[9px] text-slate-400 pt-2 border-t border-slate-200">
                                        同步入口已移至顶部「快捷操作」
                                    </div>
                                </div>
                            </div>

                            <div ref={advancedSectionRef} className="border-t border-sky-200 pt-3">
                                <button
                                    onClick={() => toggleSection('advanced')}
                                    className="w-full flex items-center justify-between text-[11px] font-semibold text-slate-800 tracking-wide"
                                >
                                    <span>高级</span>
                                    <ChevronDown
                                        size={14}
                                        className={`transition-transform ${collapsedSections.has('advanced') ? '-rotate-90' : 'rotate-0'}`}
                                    />
                                </button>

                                {!collapsedSections.has('advanced') && (
                                    <div className="space-y-2 pt-2">
                                        <div className="text-[10px] font-semibold text-slate-700">数据源与表格</div>

                                        {/* Data Source Info */}
                                        {data && data.fileName && (
                                            <div className="bg-blue-50 rounded-lg p-2 border border-blue-200">
                                                <div className="flex items-center gap-1 mb-1">
                                                    <Table2 size={12} className="text-blue-600" />
                                                    <span className="text-xs font-semibold text-blue-700">当前数据源</span>
                                                </div>
                                                <div className="space-y-1">
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] text-blue-500 flex items-center gap-1"><FileText size={10} /> 表格:</span>
                                                        <span className="text-[11px] text-blue-800 font-medium truncate flex-1" title={data.fileName}>
                                                            {data.fileName}
                                                        </span>
                                                    </div>
                                                    {data.sheetName && (
                                                        <div className="flex items-center gap-2">
                                                            <span className="text-[10px] text-blue-500"><FileText size={10} className="inline mr-1" /> 工作表:</span>
                                                            <span className="text-[11px] text-blue-800 font-medium truncate flex-1" title={data.sheetName}>
                                                                {data.sheetName}
                                                            </span>
                                                        </div>
                                                    )}
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-[10px] text-blue-500"><BarChart2 size={10} className="inline mr-1" /> 数据:</span>
                                                        <span className="text-[11px] text-blue-800">
                                                            {effectiveData.rows.length} 行 · {effectiveData.columns.length} 列
                                                        </span>
                                                    </div>
                                                </div>
                                            </div>
                                        )}

                                        {/* Google Sheets Sync */}
                                        <div className="bg-green-50 rounded-lg p-2 border border-green-200">
                                            <div className="flex items-center justify-between mb-2">
                                                <span className="text-xs font-semibold text-green-700 flex items-center gap-1">
                                                    <Link2 size={12} />
                                                    表格联动
                                                </span>
                                                {sheetsSpreadsheetId && (
                                                    <a
                                                        href={sheetsUrl}
                                                        target="_blank"
                                                        rel="noopener noreferrer"
                                                        className="text-[10px] text-green-600 hover:text-green-700 flex items-center gap-0.5"
                                                    >
                                                        <ExternalLink size={10} /> 打开表格
                                                    </a>
                                                )}
                                            </div>
                                            <div className="flex gap-1">
                                                <input
                                                    type="text"
                                                    value={sheetsUrl}
                                                    onChange={(e) => {
                                                        setSheetsUrl(e.target.value);
                                                        const parsed = parseGoogleSheetsUrl(e.target.value);
                                                        setSheetsSpreadsheetId(parsed?.spreadsheetId || null);
                                                        setSheetsError(null);
                                                    }}
                                                    placeholder="粘贴 Google Sheets URL..."
                                                    className="flex-1 px-3 py-2 text-xs bg-white text-slate-900 border border-green-200 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-400 shadow-sm placeholder:text-slate-400"
                                                />
                                            </div>
                                            {sheetsSpreadsheetId && (
                                                <button
                                                    onClick={syncToGoogleSheet}
                                                    disabled={sheetsSyncing || processedRows.length === 0}
                                                    className="mt-2 w-full px-2 py-1.5 text-xs bg-green-500 hover:bg-green-600 text-white rounded flex items-center justify-center gap-1 disabled:opacity-50"
                                                >
                                                    {sheetsSyncing ? (
                                                        <><Loader2 size={12} className="animate-spin" /> 同步中...</>
                                                    ) : (
                                                        <><RefreshCw size={12} /> 同步当前视图到表格</>
                                                    )}
                                                </button>
                                            )}
                                            {sheetsError && (
                                                <p className="text-[10px] text-red-500 mt-1">{sheetsError}</p>
                                            )}
                                            {!sheetsSpreadsheetId && sheetsUrl && (
                                                <p className="text-[10px] text-amber-600 mt-1">无法解析表格链接</p>
                                            )}
                                            {!getGoogleAccessToken() && sheetsSpreadsheetId && (
                                                <p className="text-[10px] text-amber-600 mt-1">提示: 需要重新登录 Google 账号获取写入权限</p>
                                            )}
                                        </div>

                                        {/* Stats */}
                                        <div className="bg-slate-50 rounded-lg p-2 text-[10px] text-slate-500 space-y-0.5">
                                            <p><Image size={12} className="inline mr-1" /> {stats.totalImages} 张图片</p>
                                            <p><FolderOpen size={10} className="inline mr-0.5" /> {stats.groups} 个分组</p>
                                            <p>👤 {stats.accounts} 个账号</p>
                                        </div>

                                        {/* Reset Config */}
                                        <button
                                            onClick={handleResetConfig}
                                            className="w-full py-1.5 text-[10px] text-red-600 hover:bg-red-50 rounded border border-red-200 flex items-center justify-center gap-1"
                                        >
                                            <Trash2 size={10} /> 重置配置
                                        </button>
                                    </div>
                                )}
                            </div>
                        </div>
                    </>
    );
};
