import React from 'react';
import { ChevronDown, ChevronRight, Star, MessageSquare, Tag } from 'lucide-react';
import { extractImageUrl } from '../galleryUtils';

export const GalleryTimelineView = (props: any) => {
    const {
        config,
        effectiveAccountColumn,
        effectiveDateBinning,
        effectiveDateBins,
        effectiveGroupBinning,
        effectiveGroupBins,
        effectiveGroupColumn,
        effectiveImageColumn,
        expandedGroups,
        getRowGroupKey,
        groupedTimelineData,
        renderThumbnail,
        setExpandedGroups,
        timelineData
    } = props;

    return (
                                /* Timeline View */
                                <div className="space-y-4">
                                    {/* Determine primary grouping based on groupPriority */}
                                    {effectiveGroupColumn && (config.groupPriority === 'column' || !effectiveDateBinning || effectiveDateBins.length === 0) ? (
                                        /* Column-first mode: Primary grouping by groupColumn, secondary by date */
                                        groupedTimelineData.map(({ key: groupKey, label: groupLabel, dateGroups }) => {
                                            // Count total rows across all date groups
                                            const totalRows = [...dateGroups.values()].reduce((sum, dg) => sum + dg.rows.length, 0);
                                            const hasImages = [...dateGroups.values()].some(dg =>
                                                dg.rows.some(r => extractImageUrl(r[effectiveImageColumn]))
                                            );
                                            if (!hasImages) return null;

                                            const isExpanded = expandedGroups.has(groupKey);

                                            return (
                                                <div key={groupKey} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                                    <button
                                                        onClick={() => {
                                                            const next = new Set(expandedGroups);
                                                            if (isExpanded) next.delete(groupKey);
                                                            else next.add(groupKey);
                                                            setExpandedGroups(next);
                                                        }}
                                                        className="w-full px-4 py-3 flex items-center justify-between bg-gradient-to-r from-indigo-50 to-white hover:from-indigo-100"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                            <span className="font-semibold text-slate-800">{groupLabel}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 text-xs text-slate-500">
                                                            <span className="bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">{totalRows} 个帖子</span>
                                                            <span className="bg-slate-100 px-2 py-0.5 rounded-full">{dateGroups.size} 个日期</span>
                                                        </div>
                                                    </button>

                                                    {isExpanded && (
                                                        <div className="p-4 border-t border-slate-100 space-y-4">
                                                            {[...dateGroups.entries()].map(([dateKey, dg]) => {
                                                                const displayRows = config.showAllImages ? dg.rows : dg.rows.slice(0, 50);
                                                                if (displayRows.length === 0) return null;

                                                                return (
                                                                    <div key={dateKey} className="border-l-2 border-slate-200 pl-3">
                                                                        <div className="flex items-center gap-2 mb-2 pb-1 border-b border-slate-100">
                                                                            <span className="text-xs font-medium text-slate-600">{dateKey}</span>
                                                                            <span className="text-[10px] text-slate-400">({dg.rows.length})</span>
                                                                        </div>
                                                                        <div className="flex flex-wrap gap-3">
                                                                            {displayRows.map((row, idx) => renderThumbnail(row, idx))}
                                                                        </div>
                                                                    </div>
                                                                );
                                                            })}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    ) : (
                                        /* Date-first mode: Primary grouping by date */
                                        [...timelineData.entries()].map(([dateKey, group]) => {
                                            const hasImages = group.rows.some(r => extractImageUrl(r[effectiveImageColumn]));
                                            if (!hasImages) return null;

                                            const isExpanded = expandedGroups.has(dateKey);

                                            return (
                                                <div key={dateKey} className="bg-white rounded-lg border border-slate-200 overflow-hidden">
                                                    <button
                                                        onClick={() => {
                                                            const next = new Set(expandedGroups);
                                                            if (isExpanded) next.delete(dateKey);
                                                            else next.add(dateKey);
                                                            setExpandedGroups(next);
                                                        }}
                                                        className="w-full px-4 py-3 flex items-center justify-between bg-gradient-to-r from-slate-50 to-white hover:from-slate-100"
                                                    >
                                                        <div className="flex items-center gap-3">
                                                            {isExpanded ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                                                            <span className="font-semibold text-slate-800">{dateKey}</span>
                                                        </div>
                                                        <div className="flex items-center gap-2 text-xs text-slate-500">
                                                            <span className="bg-slate-100 px-2 py-0.5 rounded-full">{group.rows.length} 个帖子</span>
                                                            {effectiveAccountColumn && <span className="bg-blue-50 text-blue-600 px-2 py-0.5 rounded-full">{group.accounts.size} 个账号</span>}
                                                        </div>
                                                    </button>

                                                    {isExpanded && (
                                                        <div className="p-4 border-t border-slate-100">
                                                            {/* Check if we need secondary column grouping */}
                                                            {effectiveGroupColumn && effectiveDateBinning && effectiveDateBins.length > 0 && config.groupPriority === 'date' ? (
                                                                /* Show secondary grouping by column */
                                                                (() => {
                                                                    // Group rows by column value
                                                                    const columnGroups = new Map<string, Record<string, unknown>[]>();
                                                                    for (const row of group.rows) {
                                                                        const columnKey = getRowGroupKey(row);
                                                                        if (!columnGroups.has(columnKey)) columnGroups.set(columnKey, []);
                                                                        columnGroups.get(columnKey)!.push(row);
                                                                    }

                                                                    // Sort column groups
                                                                    let sortedColumnGroups = [...columnGroups.entries()];
                                                                    if (effectiveGroupBinning && effectiveGroupBins.length > 0) {
                                                                        const binOrder = effectiveGroupBins.map(b => b.label);
                                                                        sortedColumnGroups.sort((a, b) => {
                                                                            const idxA = binOrder.indexOf(a[0]);
                                                                            const idxB = binOrder.indexOf(b[0]);
                                                                            if (idxA === -1 && idxB === -1) return a[0].localeCompare(b[0]);
                                                                            if (idxA === -1) return 1;
                                                                            if (idxB === -1) return -1;
                                                                            return idxA - idxB;
                                                                        });
                                                                    }

                                                                    return (
                                                                        <div className="space-y-3">
                                                                            {sortedColumnGroups.map(([columnKey, rows]) => (
                                                                                <div key={columnKey} className="border-l-2 border-indigo-200 pl-3">
                                                                                    <div className="flex items-center gap-2 mb-2 pb-1 border-b border-slate-100">
                                                                                        <span className="text-xs font-medium text-indigo-600">{columnKey}</span>
                                                                                        <span className="text-[10px] text-slate-400">({rows.length})</span>
                                                                                    </div>
                                                                                    <div className="flex flex-wrap gap-3">
                                                                                        {(config.showAllImages ? rows : rows.slice(0, 50)).map((row, idx) => renderThumbnail(row, idx))}
                                                                                    </div>
                                                                                </div>
                                                                            ))}
                                                                        </div>
                                                                    );
                                                                })()
                                                            ) : (
                                                                /* No secondary grouping */
                                                                <div className="flex flex-wrap gap-3">
                                                                    {(config.showAllImages ? group.rows : group.rows.slice(0, 50)).map((row, idx) => renderThumbnail(row, idx))}
                                                                </div>
                                                            )}
                                                        </div>
                                                    )}
                                                </div>
                                            );
                                        })
                                    )}
                                </div>
    );
};
