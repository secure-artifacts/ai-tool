import React from 'react';

import { GalleryConfig } from '../galleryUtils';
import { DataRow } from '../../types';
import { computeMatrixData } from '../galleryViewData';

export type MatrixData = ReturnType<typeof computeMatrixData>;

interface GalleryMatrixViewProps {
    config: GalleryConfig;
    matrixData: MatrixData;
    buildGroupedRows: (rows: DataRow[]) => { key: string; label: string; rows: DataRow[] }[];
    renderThumbnail: (row: DataRow, index: number, options?: { size?: number; showMeta?: boolean; compact?: boolean }) => React.ReactNode;
}

export const GalleryMatrixView = (props: GalleryMatrixViewProps) => {
    const {
        config,
        matrixData,
        buildGroupedRows,
        renderThumbnail
    } = props;

    return (
/* Matrix View */
                                <div className="overflow-auto h-full">
                                    <table className="border-collapse min-w-full">
                                        <thead className="sticky top-0 z-10">
                                            <tr>
                                                <th className="sticky left-0 z-20 bg-slate-100 border border-slate-300 px-2 py-2 text-xs font-semibold text-slate-700" style={{ maxWidth: 120, minWidth: 80 }}>
                                                    {config.matrixRowColumn === '__GROUP_SETTINGS__' ? '[分组设置]' : (config.matrixRowColumn || '行')}
                                                </th>
                                                {matrixData.colKeys.map(col => (
                                                    <th key={col} className="bg-slate-100 border border-slate-300 px-2 py-2 text-xs font-medium text-slate-600 whitespace-nowrap">
                                                        {matrixData.colLabels.get(col) || col}
                                                    </th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody>
                                            {matrixData.rowKeys.map(rowKey => (
                                                <tr key={rowKey}>
                                                    <td className="sticky left-0 z-10 bg-slate-50 border border-slate-200 px-2 py-2 text-xs font-medium text-slate-700" style={{ maxWidth: 120, minWidth: 80 }}>
                                                        <div className="break-words">{matrixData.rowLabels.get(rowKey) || rowKey}</div>
                                                    </td>
                                                    {matrixData.colKeys.map(colKey => {
                                                        const cellKey = `${rowKey}|${colKey}`;
                                                        const rows = matrixData.cells.get(cellKey) || [];

                                                        return (
                                                            <td key={colKey} className="border border-slate-200 p-1.5 align-top bg-white" style={{ minWidth: config.matrixCellWidth }}>
                                                                {rows.length > 0 ? (
                                                                    config.groupColumn ? (
                                                                        // With groupColumn: show sub-grouped content
                                                                        (() => {
                                                                            const displayRows = config.showAllImages ? rows : rows.slice(0, 20);
                                                                            const subGroups = buildGroupedRows(displayRows);
                                                                            const perGroupLimit = config.showAllImages ? Infinity : 4;
                                                                            return (
                                                                                <div className="space-y-1.5">
                                                                                    {subGroups.map(({ key, label, rows: subRows }) => (
                                                                                        <div key={key} className="border-l-2 border-slate-200 pl-1.5">
                                                                                            <div className="text-[9px] font-medium text-slate-600 mb-0.5">
                                                                                                {label} <span className="text-slate-400">({subRows.length})</span>
                                                                                            </div>
                                                                                            <div className="flex flex-wrap gap-0.5">
                                                                                                {subRows.slice(0, perGroupLimit).map((row, idx) =>
                                                                                                    renderThumbnail(row, idx, { size: config.thumbnailSize, showMeta: false, compact: true })
                                                                                                )}
                                                                                                {!config.showAllImages && subRows.length > 4 && (
                                                                                                    <div className="px-1 bg-slate-200 rounded flex items-center justify-center text-[8px] text-slate-500"
                                                                                                        style={{ height: config.thumbnailSize }}>
                                                                                                        +{subRows.length - 4}
                                                                                                    </div>
                                                                                                )}
                                                                                            </div>
                                                                                        </div>
                                                                                    ))}
                                                                                    {!config.showAllImages && rows.length > 20 && (
                                                                                        <div className="text-[9px] text-slate-400 text-center">
                                                                                            还有 {rows.length - 20} 项...
                                                                                        </div>
                                                                                    )}
                                                                                </div>
                                                                            );
                                                                        })()
                                                                    ) : (
                                                                        // No groupColumn: show flat thumbnails
                                                                        <div className="flex flex-wrap gap-1">
                                                                            {(config.showAllImages ? rows : rows.slice(0, 6)).map((row, idx) =>
                                                                                renderThumbnail(row, idx, { size: config.thumbnailSize, showMeta: false, compact: true })
                                                                            )}
                                                                            {!config.showAllImages && rows.length > 6 && (
                                                                                <div className="px-2 bg-slate-200 rounded flex items-center justify-center text-[10px] text-slate-600"
                                                                                    style={{ height: config.thumbnailSize }}>
                                                                                    +{rows.length - 6}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                    )
                                                                ) : (
                                                                    <span className="text-slate-300 text-[10px]">—</span>
                                                                )}
                                                            </td>
                                                        );
                                                    })}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
    );
};
