import React from 'react';
import { extractImageUrl } from '../galleryUtils';

export const GalleryCalendarView = (props: any) => {
    const {
        buildGroupedRows,
        config,
        effectiveGroupColumn,
        effectiveImageColumn,
        parseDate,
        renderThumbnail,
        timelineData,
        updateConfig
    } = props;

    return (
                                /* Scroll View - Responsive full-width day cards */
                                <div className="h-full flex flex-col">
                                    {/* Quick Date Navigation */}
                                    <div className="flex-shrink-0 bg-white border-b border-slate-200 p-2 flex items-center gap-2 flex-wrap sticky top-0 z-20">
                                        <span className="text-xs text-slate-500">快速跳转:</span>
                                        {[...timelineData.keys()].slice(0, 15).map(dateKey => {
                                            const d = parseDate(dateKey);
                                            const isValidDate = d && !isNaN(d.getTime());
                                            return (
                                                <button
                                                    key={dateKey}
                                                    onClick={() => updateConfig({ selectedDate: dateKey })}
                                                    className={`px-2 py-0.5 text-[10px] rounded transition ${config.selectedDate === dateKey
                                                        ? 'bg-indigo-500 text-white'
                                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                                        }`}
                                                >
                                                    {isValidDate ? `${d!.getMonth() + 1}/${d!.getDate()}` : dateKey.slice(0, 10)}
                                                </button>
                                            );
                                        })}
                                    </div>
                                    {/* Day Cards - Horizontal scroll with all days */}
                                    <div className="flex-1 overflow-auto">
                                        <div className="flex gap-2 p-2 items-start" style={{ minWidth: 'max-content' }}>
                                            {(() => {
                                                // Show ALL entries, scroll horizontally
                                                const entries = [...timelineData.entries()];
                                                if (entries.length === 0) return null;

                                                // Card width based on scrollDaysPerView (how many fit on screen) or user-set scrollCardWidth
                                                const cardWidth = config.scrollCardWidth;

                                                return entries.map(([dateKey, { rows, accounts, date }]) => {
                                                    // Skip dates with no rows that have valid images
                                                    const rowsWithImages = rows.filter(r => extractImageUrl(r[effectiveImageColumn]));
                                                    if (rowsWithImages.length === 0) return null;

                                                    const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
                                                    const dateObj = date || parseDate(dateKey);
                                                    const isValidDate = dateObj && !isNaN(dateObj.getTime());
                                                    const displayRows = config.showAllImages ? rowsWithImages : rowsWithImages.slice(0, 50);

                                                    return (
                                                        <div
                                                            key={dateKey}
                                                            className="bg-white rounded-lg border border-slate-200 overflow-hidden flex flex-col flex-shrink-0"
                                                            style={{ width: cardWidth }}
                                                        >
                                                            <div className="bg-gradient-to-r from-indigo-500 to-purple-500 text-white px-3 py-2 flex-shrink-0 sticky top-0 z-10">
                                                                {isValidDate ? (
                                                                    <>
                                                                        <div className="flex items-baseline gap-2">
                                                                            <span className="text-xl font-bold">{dateObj!.getDate()}</span>
                                                                            <span className="text-sm opacity-80">{dateObj!.getMonth() + 1}月 周{weekDays[dateObj!.getDay()]}</span>
                                                                        </div>
                                                                        <div className="text-[10px] opacity-70 mt-0.5">
                                                                            {rows.length}个帖子 · {accounts.size}个账号
                                                                        </div>
                                                                    </>
                                                                ) : (
                                                                    <>
                                                                        <div className="text-base font-bold truncate">{dateKey}</div>
                                                                        <div className="text-[10px] opacity-70 mt-0.5">
                                                                            {rows.length}个帖子 · {accounts.size}个账号
                                                                        </div>
                                                                    </>
                                                                )}
                                                            </div>
                                                            <div className="p-2">
                                                                {effectiveGroupColumn ? (
                                                                    // Group by groupColumn (with smart parsing like TransposePanel)
                                                                    (() => {
                                                                        const subGroups = buildGroupedRows(displayRows);
                                                                        return subGroups.map(({ key, label, rows: subRows }) => (
                                                                            <div key={key} className="mb-2 last:mb-0">
                                                                                <div className="text-[9px] font-medium text-slate-600 mb-1 pb-0.5 border-b border-slate-200">
                                                                                    {label} ({subRows.length})
                                                                                </div>
                                                                                <div className="flex flex-wrap gap-1">
                                                                                    {subRows.map((row, idx) =>
                                                                                        renderThumbnail(row, idx, { size: config.thumbnailSize, showMeta: false, compact: true })
                                                                                    )}
                                                                                </div>
                                                                            </div>
                                                                        ));
                                                                    })()
                                                                ) : (
                                                                    // No grouping
                                                                    <div className="flex flex-wrap gap-1">
                                                                        {displayRows.map((row, idx) =>
                                                                            renderThumbnail(row, idx, { size: config.thumbnailSize, showMeta: false, compact: true })
                                                                        )}
                                                                        {!config.showAllImages && rows.length > 50 && (
                                                                            <div className="px-2 bg-slate-200 rounded flex items-center justify-center text-xs text-slate-500 font-medium"
                                                                                style={{ height: config.thumbnailSize }}>
                                                                                +{rows.length - 50}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                        </div>
                                                    );
                                                });
                                            })()}
                                        </div>
                                    </div>
                                    {/* Bottom info bar */}
                                    <div className="flex-shrink-0 bg-white border-t border-slate-200 px-3 py-1.5 flex items-center justify-between text-[10px] text-slate-500">
                                        <span>共 {timelineData.size} 天 · 可水平滚动查看更多 →</span>
                                        <span>每屏显示 {config.scrollDaysPerView} 天</span>
                                    </div>
                                </div>
    );
};
