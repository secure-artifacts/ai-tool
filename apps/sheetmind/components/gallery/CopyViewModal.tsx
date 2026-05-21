import React, { memo } from 'react';
import { X, Image, AlertCircle, ClipboardList } from 'lucide-react';

export interface CopyViewModalState {
    open: boolean;
    layoutMode: 'horizontal' | 'vertical' | 'columns';
    columnsPerRow: number;
    selectedColumns: string[];
    applyClassificationOverrides: boolean;
    emptyRowsBetweenGroups: number;
}

export interface CopyViewModalProps {
    modal: CopyViewModalState;
    onModalChange: (updater: CopyViewModalState | ((prev: CopyViewModalState) => CopyViewModalState)) => void;
    groupColumnName: string | undefined;
    allColumns: string[];
    imageColumn: string;
    classificationOverridesCount: number;
    onCopy: (columnsPerRow: number, includeExtraData: boolean, selectedColumns: string[], applyOverrides: boolean, layoutMode: string, emptyRowsBetweenGroups: number) => void;
}

export const CopyViewModal = memo(function CopyViewModal({
    modal,
    onModalChange,
    groupColumnName,
    allColumns,
    imageColumn,
    classificationOverridesCount,
    onCopy,
}: CopyViewModalProps) {
    if (!modal.open) return null;

    const update = (patch: Partial<CopyViewModalState>) => {
        onModalChange({ ...modal, ...patch });
    };

    return (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onKeyDown={(e) => { e.stopPropagation(); e.nativeEvent.stopImmediatePropagation(); }}>
            <div className="bg-white rounded-2xl shadow-2xl w-[400px] p-6">
                <div className="flex items-center justify-between mb-4">
                    <h3 className="text-lg font-bold text-slate-800 flex items-center gap-2">
                        <Image size={20} className="text-purple-500" />
                        复制视图布局
                    </h3>
                    <button
                        onClick={() => update({ open: false })}
                        className="p-1 hover:bg-slate-100 rounded"
                    >
                        <X size={18} className="text-slate-500" />
                    </button>
                </div>

                <div className="space-y-4">
                    <div className="p-4 bg-purple-50 rounded-lg">
                        <p className="text-sm text-slate-600 mb-3">
                            将当前分组视图复制为表格格式：
                        </p>
                        <ul className="text-xs text-slate-500 space-y-1 ml-4 list-disc">
                            <li>可选横向网格或竖向分组明细布局</li>
                            <li>竖向布局: 先分组标题，再该分组明细行</li>
                            <li>粘贴到 Google Sheets 后可自动识别</li>
                        </ul>
                    </div>

                    <div className="space-y-2">
                        <label className="text-sm font-medium text-slate-700">布局方向:</label>
                        <div className="grid grid-cols-3 gap-2">
                            {(['horizontal', 'vertical', 'columns'] as const).map((mode) => (
                                <button
                                    key={mode}
                                    onClick={() => update({ layoutMode: mode })}
                                    className={`px-2 py-2 text-[11px] font-medium rounded-lg transition-colors ${modal.layoutMode === mode
                                        ? 'bg-purple-500 text-white'
                                        : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                        }`}
                                >
                                    {mode === 'horizontal' ? '横向（网格）' : mode === 'vertical' ? '竖向（分组明细）' : '转置（按列分组）'}
                                </button>
                            ))}
                        </div>
                    </div>

                    {modal.layoutMode === 'horizontal' && (
                        <div className="flex items-center gap-3">
                            <label className="text-sm font-medium text-slate-700">每行缩略图数量:</label>
                            <div className="flex items-center gap-2 flex-wrap">
                                {[10, 15, 20, 25, 30, 40].map(n => (
                                    <button
                                        key={n}
                                        onClick={() => update({ columnsPerRow: n })}
                                        className={`w-8 h-8 text-sm font-medium rounded-lg transition-colors ${modal.columnsPerRow === n
                                            ? 'bg-purple-500 text-white'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                            }`}
                                    >
                                        {n}
                                    </button>
                                ))}
                                <input
                                    type="number"
                                    min="1"
                                    max="200"
                                    value={modal.columnsPerRow}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value) || 10;
                                        update({ columnsPerRow: Math.min(200, Math.max(1, val)) });
                                    }}
                                    className="w-14 h-8 px-2 text-sm text-center border border-slate-300 rounded-lg focus:border-purple-500 focus:outline-none tooltip-bottom"
                                    data-tip="自定义数量"
                                />
                            </div>
                        </div>
                    )}

                    <div className={`text-xs ${groupColumnName ? 'text-slate-500' : 'text-red-500 font-medium'}`}>
                        {groupColumnName
                            ? `当前: 按 "${groupColumnName}" 分组`
                            : <><AlertCircle size={12} className="inline mr-1" /> 未设置分组列 - 将把所有图片作为一个组导出</>
                        }
                    </div>

                    {/* Classification overrides toggle */}
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={modal.applyClassificationOverrides}
                            onChange={(e) => update({ applyClassificationOverrides: e.target.checked })}
                            className="w-4 h-4 text-purple-600 rounded focus:ring-purple-500"
                        />
                        <span className="text-sm text-slate-700">应用分类调整</span>
                        {classificationOverridesCount > 0 && (
                            <span className="text-[10px] text-purple-500">({classificationOverridesCount} 项)</span>
                        )}
                    </label>

                    {/* Extra data columns toggle */}
                    <div className="space-y-2">
                        <label className="flex items-center gap-2 cursor-pointer">
                            <input
                                type="checkbox"
                                checked={modal.includeExtraData}
                                onChange={(e) => update({ includeExtraData: e.target.checked })}
                                className="w-4 h-4 text-blue-600 rounded focus:ring-blue-500"
                            />
                            <span className="text-sm text-slate-700">包含额外数据列</span>
                        </label>

                        {modal.includeExtraData && (
                            <div className="ml-6 p-3 bg-slate-50 rounded-lg space-y-2 max-h-52 overflow-auto">
                                <p className="text-xs text-slate-500 mb-2">选择要导出的列 <span className="text-slate-400">(可拖拽调整顺序)</span>:</p>
                                {/* 未选中的列 */}
                                {[...allColumns.filter(col => col !== imageColumn && !modal.selectedColumns.includes(col)), ...(!modal.selectedColumns.includes('__THUMBNAIL__') ? ['__THUMBNAIL__'] : [])].map(col => (
                                    <label key={col} className="flex items-center gap-2 cursor-pointer py-0.5">
                                        <input
                                            type="checkbox"
                                            checked={false}
                                            onChange={() => {
                                                update({ selectedColumns: [...modal.selectedColumns, col] });
                                            }}
                                            className="w-3.5 h-3.5 text-blue-500 rounded focus:ring-blue-500"
                                        />
                                        <span className="text-xs text-slate-400">
                                            {col === '__THUMBNAIL__' ? '缩略图 (公式)' : col}
                                        </span>
                                    </label>
                                ))}
                                {/* 已选中的列 - 可拖拽排序 */}
                                {modal.selectedColumns.length > 0 && (
                                    <div className="mt-2 pt-2 border-t border-slate-200">
                                        <p className="text-[10px] text-blue-500 font-medium mb-1.5">已选列（导出顺序从上到下）:</p>
                                        {modal.selectedColumns.map((col, idx) => (
                                            <div
                                                key={col}
                                                draggable
                                                onDragStart={(e) => {
                                                    e.dataTransfer.setData('text/plain', String(idx));
                                                    e.dataTransfer.effectAllowed = 'move';
                                                    (e.currentTarget as HTMLElement).style.opacity = '0.5';
                                                }}
                                                onDragEnd={(e) => {
                                                    (e.currentTarget as HTMLElement).style.opacity = '1';
                                                }}
                                                onDragOver={(e) => {
                                                    e.preventDefault();
                                                    e.dataTransfer.dropEffect = 'move';
                                                    (e.currentTarget as HTMLElement).style.background = 'rgba(59,130,246,0.08)';
                                                }}
                                                onDragLeave={(e) => {
                                                    (e.currentTarget as HTMLElement).style.background = '';
                                                }}
                                                onDrop={(e) => {
                                                    e.preventDefault();
                                                    (e.currentTarget as HTMLElement).style.background = '';
                                                    const fromIdx = parseInt(e.dataTransfer.getData('text/plain'), 10);
                                                    if (isNaN(fromIdx) || fromIdx === idx) return;
                                                    const cols = [...modal.selectedColumns];
                                                    const [moved] = cols.splice(fromIdx, 1);
                                                    cols.splice(idx, 0, moved);
                                                    update({ selectedColumns: cols });
                                                }}
                                                className="flex items-center gap-2 py-1 px-1.5 rounded-md cursor-grab active:cursor-grabbing hover:bg-blue-50 transition-colors group"
                                            >
                                                <span className="text-slate-300 group-hover:text-slate-500 text-xs select-none" style={{ cursor: 'grab' }}>⠿</span>
                                                <input
                                                    type="checkbox"
                                                    checked={true}
                                                    onChange={() => {
                                                        update({ selectedColumns: modal.selectedColumns.filter(c => c !== col) });
                                                    }}
                                                    className="w-3.5 h-3.5 text-blue-500 rounded focus:ring-blue-500"
                                                />
                                                <span className={`text-xs font-medium flex-1 ${col === '__THUMBNAIL__' ? 'text-purple-600' : 'text-slate-700'}`}>
                                                    {col === '__THUMBNAIL__' ? '缩略图 (公式)' : col}
                                                </span>
                                                <div className="flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                    {idx > 0 && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const cols = [...modal.selectedColumns];
                                                                [cols[idx - 1], cols[idx]] = [cols[idx], cols[idx - 1]];
                                                                update({ selectedColumns: cols });
                                                            }}
                                                            className="p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-100"
                                                            title="上移"
                                                        >
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 15l-6-6-6 6"/></svg>
                                                        </button>
                                                    )}
                                                    {idx < modal.selectedColumns.length - 1 && (
                                                        <button
                                                            type="button"
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                const cols = [...modal.selectedColumns];
                                                                [cols[idx], cols[idx + 1]] = [cols[idx + 1], cols[idx]];
                                                                update({ selectedColumns: cols });
                                                            }}
                                                            className="p-0.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-100"
                                                            title="下移"
                                                        >
                                                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M6 9l6 6 6-6"/></svg>
                                                        </button>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                )}
                                {modal.selectedColumns.length > 0 && (
                                    <p className="text-xs text-blue-600 mt-2">
                                        {modal.layoutMode === 'columns'
                                            ? '布局: 每组为一列，顶部为标题，下方为图片与数据列 (按选中列顺序)'
                                            : modal.layoutMode === 'vertical'
                                            ? '布局: 分组标题行 → 明细行（按选中列顺序展示）'
                                            : '布局: 对于每一个项，按照选中列顺序分别作为横排展示'}
                                    </p>
                                )}
                            </div>
                        )}
                    </div>

                    {/* Empty rows configuration */}
                    {modal.layoutMode !== 'columns' && (
                        <div className="space-y-2">
                            <label className="text-sm font-medium text-slate-700">组间空行 (留白间距):</label>
                            <div className="flex items-center gap-2 flex-wrap">
                                {[0, 1, 2, 3, 5].map(n => (
                                    <button
                                        key={n}
                                        onClick={() => update({ emptyRowsBetweenGroups: n })}
                                        className={`w-8 h-8 text-sm font-medium rounded-lg transition-colors ${modal.emptyRowsBetweenGroups === n
                                            ? 'bg-purple-500 text-white'
                                            : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
                                            }`}
                                    >
                                        {n}
                                    </button>
                                ))}
                                <input
                                    type="number"
                                    min="0"
                                    max="20"
                                    value={modal.emptyRowsBetweenGroups}
                                    onChange={(e) => {
                                        const val = parseInt(e.target.value) || 0;
                                        update({ emptyRowsBetweenGroups: Math.min(20, Math.max(0, val)) });
                                    }}
                                    className="w-14 h-8 px-2 text-sm text-center border border-slate-300 rounded-lg focus:border-purple-500 focus:outline-none tooltip-bottom"
                                    data-tip="自定义空行"
                                />
                            </div>
                        </div>
                    )}
                </div>

                <div className="flex justify-end gap-2 mt-6">
                    <button
                        onClick={() => update({ open: false })}
                        className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                    >
                        取消
                    </button>
                    <button
                        onClick={() => onCopy(
                            modal.columnsPerRow,
                            modal.includeExtraData,
                            modal.selectedColumns,
                            modal.applyClassificationOverrides,
                            modal.layoutMode,
                            modal.emptyRowsBetweenGroups
                        )}
                        className="px-4 py-2 text-sm font-medium text-white bg-purple-500 rounded-lg hover:bg-purple-600 transition-colors"
                    >
                        <ClipboardList size={12} className="inline mr-1" /> 复制视图布局
                    </button>
                </div>
            </div>
        </div>
    );
});
