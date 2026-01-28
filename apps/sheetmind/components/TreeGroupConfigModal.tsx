/**
 * 树状图多级分组配置弹窗
 * 以树状视图方式直观配置多层级分组
 * 每一层级的配置项与普通分组完全一致
 */
import React, { useState, useEffect, useMemo } from 'react';
import { X, Plus, ChevronDown, ChevronUp, Trash2 } from 'lucide-react';
import { GroupLevel, TextGroupBin, TextGroupCondition, GroupBinRange, DateBinRange } from '../types/sharedConfig';

interface TreeGroupConfigModalProps {
    isOpen: boolean;
    onClose: () => void;
    groupLevels: GroupLevel[];
    onGroupLevelsChange: (levels: GroupLevel[]) => void;
    columns: string[];
    // 传入数据以便提取唯一值
    data?: { rows: Record<string, unknown>[] };
}

const TreeGroupConfigModal: React.FC<TreeGroupConfigModalProps> = ({
    isOpen,
    onClose,
    groupLevels,
    onGroupLevelsChange,
    columns,
    data,
}) => {
    const [localLevels, setLocalLevels] = useState<GroupLevel[]>(groupLevels);
    const [expandedLevel, setExpandedLevel] = useState<number | null>(null);

    // Modal resize state
    const [modalSize, setModalSize] = useState({ width: 800, height: 600 });
    const [isResizing, setIsResizing] = useState(false);
    const resizeStartRef = React.useRef({ x: 0, y: 0, width: 0, height: 0 });

    // Handle resize
    const handleResizeStart = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        resizeStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            width: modalSize.width,
            height: modalSize.height
        };
    };

    React.useEffect(() => {
        if (!isResizing) return;

        const handleMouseMove = (e: MouseEvent) => {
            const deltaX = e.clientX - resizeStartRef.current.x;
            const deltaY = e.clientY - resizeStartRef.current.y;
            setModalSize({
                width: Math.max(600, Math.min(1400, resizeStartRef.current.width + deltaX)),
                height: Math.max(400, Math.min(900, resizeStartRef.current.height + deltaY))
            });
        };

        const handleMouseUp = () => {
            setIsResizing(false);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [isResizing]);

    useEffect(() => {
        setLocalLevels(groupLevels);
        // 当打开弹窗且有配置好的层级时，自动展开第一个层级
        if (isOpen && groupLevels.length > 0 && groupLevels[0].column) {
            setExpandedLevel(0);
        }
    }, [groupLevels, isOpen]);

    const handleSave = () => {
        onGroupLevelsChange(localLevels);
        onClose();
    };

    const updateLevel = (idx: number, updates: Partial<GroupLevel>) => {
        setLocalLevels(prev => prev.map((l, i) => i === idx ? { ...l, ...updates } : l));
    };

    const addLevel = () => {
        const newLevel: GroupLevel = {
            id: `level-${Date.now()}`,
            column: '',
            type: 'text',
        };
        setLocalLevels(prev => [...prev, newLevel]);
        // 自动展开新添加的层级
        setExpandedLevel(localLevels.length);
    };

    const removeLevel = (idx: number) => {
        if (idx === 0) {
            setLocalLevels([]);
        } else {
            setLocalLevels(prev => prev.slice(0, idx));
        }
    };

    // 获取某列的唯一值
    const getUniqueValues = (columnName: string): string[] => {
        if (!data?.rows || !columnName) return [];
        const values = new Set<string>();
        data.rows.forEach(row => {
            const val = row[columnName];
            if (val !== null && val !== undefined && val !== '') {
                values.add(String(val));
            }
        });
        return Array.from(values).sort();
    };

    if (!isOpen) return null;

    const levelNames = ['一级分组', '二级分组', '三级分组', '四级分组', '五级分组'];
    const levelColors = [
        'from-indigo-500 to-purple-500',
        'from-blue-500 to-cyan-500',
        'from-teal-500 to-green-500',
        'from-orange-500 to-yellow-500',
        'from-pink-500 to-red-500',
    ];

    return (
        <div data-modal="tree-group-config" className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/40 backdrop-blur-sm" onClick={(e) => e.stopPropagation()}>
            <div
                className="bg-white rounded-2xl shadow-2xl flex flex-col relative"
                style={{ width: `${modalSize.width}px`, height: `${modalSize.height}px`, maxWidth: '95vw', maxHeight: '95vh' }}
            >
                {/* 头部 */}
                <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 bg-gradient-to-r from-indigo-50 to-white rounded-t-2xl">
                    <div className="flex items-center gap-3">
                        <span className="text-2xl">📊</span>
                        <div>
                            <h2 className="text-lg font-bold text-slate-800">多级分组树状视图</h2>
                            <p className="text-xs text-slate-500">可视化配置层级嵌套关系 · 每层级可配置完整分组规则</p>
                        </div>
                    </div>
                    <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg transition-colors">
                        <X size={20} className="text-slate-500" />
                    </button>
                </div>

                {/* 树状图主体 */}
                <div className="flex-1 overflow-auto p-6 bg-slate-50">
                    {localLevels.length === 0 && (
                        <div className="flex flex-col items-center justify-center py-12">
                            <div className="text-6xl mb-4">📂</div>
                            <p className="text-slate-500 mb-4">尚未配置分组层级</p>
                            <button
                                onClick={addLevel}
                                className="px-4 py-2 bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 flex items-center gap-2"
                            >
                                <Plus size={16} />
                                添加一级分组
                            </button>
                        </div>
                    )}

                    {localLevels.length > 0 && (
                        <div className="space-y-4">
                            {localLevels.map((level, idx) => {
                                const isExpanded = expandedLevel === idx;
                                const isLast = idx === localLevels.length - 1;
                                const uniqueValues = level.column ? getUniqueValues(level.column) : [];

                                return (
                                    <div key={level.id} style={{ marginLeft: idx * 24 }}>
                                        {/* 连接线指示 */}
                                        {idx > 0 && (
                                            <div className="flex items-center mb-2 text-slate-400">
                                                <span className="text-lg mr-2">└─</span>
                                                <span className="text-[10px]">嵌套在 "{levelNames[idx - 1] || `${idx}级`}" 内</span>
                                            </div>
                                        )}

                                        {/* 层级卡片 */}
                                        <div className={`bg-white rounded-xl shadow-lg border-2 transition-all duration-200 ${isExpanded ? 'border-indigo-400 ring-4 ring-indigo-100' : 'border-slate-200 hover:border-indigo-300'
                                            }`}>
                                            {/* 顶部渐变条 */}
                                            <div className={`h-1.5 rounded-t-xl bg-gradient-to-r ${levelColors[idx] || levelColors[4]}`} />

                                            {/* 层级头部 */}
                                            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-100">
                                                <div className="flex items-center gap-3">
                                                    <span className="text-xl">{idx === 0 ? '📁' : isLast ? '📄' : '📂'}</span>
                                                    <span className="font-semibold text-slate-700">
                                                        {levelNames[idx] || `${idx + 1}级分组`}
                                                    </span>
                                                </div>
                                                <div className="flex items-center gap-2">
                                                    <button
                                                        onClick={() => setExpandedLevel(isExpanded ? null : idx)}
                                                        className={`flex items-center gap-1 px-3 py-1.5 text-xs font-medium rounded-lg transition-all ${isExpanded
                                                            ? 'bg-indigo-100 text-indigo-700 border border-indigo-300'
                                                            : 'bg-indigo-500 text-white hover:bg-indigo-600 shadow-sm'
                                                            }`}
                                                    >
                                                        {isExpanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                                                        {isExpanded ? '收起规则' : '⚙️ 设置分组规则'}
                                                    </button>
                                                    <button
                                                        onClick={() => removeLevel(idx)}
                                                        className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded transition-colors"
                                                        title="删除此层级及所有子层级"
                                                    >
                                                        <Trash2 size={16} />
                                                    </button>
                                                </div>
                                            </div>

                                            {/* 基本配置（始终可见） */}
                                            <div className="px-4 py-3 bg-slate-50/50">
                                                <div className="flex items-center gap-4 flex-wrap">
                                                    {/* 选择分组列 */}
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs text-slate-500">分组列:</span>
                                                        <select
                                                            value={level.column}
                                                            onChange={e => updateLevel(idx, { column: e.target.value })}
                                                            className="px-2 py-1.5 text-sm border border-slate-200 rounded-lg bg-white focus:ring-2 focus:ring-indigo-200 focus:border-indigo-400 min-w-[150px]"
                                                        >
                                                            <option value="">选择列...</option>
                                                            {columns.map(col => (
                                                                <option key={col} value={col}>{col}</option>
                                                            ))}
                                                        </select>
                                                    </div>

                                                    {/* 类型选择 */}
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-xs text-slate-500">类型:</span>
                                                        <div className="flex bg-slate-100 rounded-lg p-0.5">
                                                            {(['text', 'numeric', 'date'] as const).map(t => (
                                                                <button
                                                                    key={t}
                                                                    onClick={() => updateLevel(idx, { type: t })}
                                                                    className={`px-3 py-1 text-xs rounded-md transition-all ${level.type === t
                                                                        ? 'bg-slate-800 text-white shadow'
                                                                        : 'text-slate-600 hover:bg-slate-200'
                                                                        }`}
                                                                >
                                                                    {t === 'text' ? '文本' : t === 'numeric' ? '数值' : '日期'}
                                                                </button>
                                                            ))}
                                                        </div>
                                                    </div>

                                                    {/* 快速预览 */}
                                                    {level.column && (
                                                        <div className="text-xs text-slate-400">
                                                            {uniqueValues.length > 0 && `(${uniqueValues.length} 个不同值)`}
                                                        </div>
                                                    )}
                                                </div>

                                                {/* 提示用户点击设置分组规则 */}
                                                {!isExpanded && level.column && (
                                                    <div className="mt-2 text-xs text-amber-600 bg-amber-50 px-2 py-1 rounded flex items-center gap-1">
                                                        💡 点击上方 "⚙️ 设置分组规则" 按钮来配置{level.type === 'text' ? '文本匹配条件' : level.type === 'numeric' ? '数值范围' : '日期范围'}
                                                    </div>
                                                )}
                                            </div>

                                            {/* 详细配置（展开时显示） */}
                                            {isExpanded && (
                                                <div className="px-4 py-4 border-t border-slate-100">
                                                    {/* 文本类型配置 */}
                                                    {level.type === 'text' && (
                                                        <TextGroupConfig
                                                            level={level}
                                                            idx={idx}
                                                            updateLevel={updateLevel}
                                                            uniqueValues={uniqueValues}
                                                        />
                                                    )}

                                                    {/* 数值类型配置 */}
                                                    {level.type === 'numeric' && (
                                                        <NumericGroupConfig
                                                            level={level}
                                                            idx={idx}
                                                            updateLevel={updateLevel}
                                                        />
                                                    )}

                                                    {/* 日期类型配置 */}
                                                    {level.type === 'date' && (
                                                        <DateGroupConfig
                                                            level={level}
                                                            idx={idx}
                                                            updateLevel={updateLevel}
                                                        />
                                                    )}
                                                </div>
                                            )}
                                        </div>

                                        {/* 添加子层级按钮 */}
                                        {isLast && (
                                            <div className="mt-4" style={{ marginLeft: 24 }}>
                                                <button
                                                    onClick={addLevel}
                                                    className="flex items-center gap-2 px-4 py-2 text-sm text-indigo-600 bg-indigo-50 hover:bg-indigo-100 rounded-lg border-2 border-dashed border-indigo-200 transition-colors"
                                                >
                                                    <span className="text-slate-400">└─</span>
                                                    <Plus size={16} />
                                                    添加子层级（嵌套在 "{levelNames[idx] || `${idx + 1}级`}" 内）
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* 底部操作栏 */}
                <div className="flex items-center justify-between px-5 py-4 border-t border-slate-200 bg-white rounded-b-2xl">
                    <div className="text-xs text-slate-500">
                        已配置 <span className="font-semibold text-indigo-600">{localLevels.length}</span> 个层级
                        {localLevels.length > 0 && (
                            <span className="text-slate-400 ml-2">
                                · 点击"展开配置"设置详细分组规则
                            </span>
                        )}
                    </div>
                    <div className="flex gap-2">
                        <button
                            onClick={() => setLocalLevels([])}
                            className="px-4 py-2 text-sm text-red-600 hover:bg-red-50 rounded-lg transition-colors"
                        >
                            清空全部
                        </button>
                        <button
                            onClick={onClose}
                            className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                        >
                            取消
                        </button>
                        <button
                            onClick={handleSave}
                            className="px-6 py-2 text-sm bg-indigo-500 text-white rounded-lg hover:bg-indigo-600 transition-colors"
                        >
                            保存配置
                        </button>
                    </div>
                </div>

                {/* Resize handle */}
                <div
                    onMouseDown={(e) => {
                        e.stopPropagation();
                        e.preventDefault();
                        handleResizeStart(e);
                    }}
                    onMouseEnter={(e) => {
                        e.currentTarget.style.cursor = 'se-resize';
                    }}
                    className="absolute bottom-2 right-2 w-10 h-10 flex items-center justify-center bg-indigo-500 hover:bg-indigo-600 rounded-lg shadow-lg transition-all"
                    style={{ zIndex: 9999, cursor: 'se-resize' }}
                    title="↘️ 拖拽调整窗口大小"
                >
                    <svg width="16" height="16" viewBox="0 0 12 12" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path d="M11 1L1 11M11 5L5 11M11 9L9 11" stroke="white" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                </div>
            </div>
        </div>
    );
};

// ========== 文本分组配置 ==========
const TextGroupConfig: React.FC<{
    level: GroupLevel;
    idx: number;
    updateLevel: (idx: number, updates: Partial<GroupLevel>) => void;
    uniqueValues: string[];
}> = ({ level, idx, updateLevel, uniqueValues }) => {
    const textBins = level.textBins || [];

    const addBin = () => {
        const newBin: TextGroupBin = { id: `tbin-${Date.now()}`, label: '', values: [], conditions: [] };
        updateLevel(idx, { textBins: [...textBins, newBin] });
    };

    const updateBin = (binIdx: number, updates: Partial<TextGroupBin>) => {
        const newBins = textBins.map((b, i) => i === binIdx ? { ...b, ...updates } : b);
        updateLevel(idx, { textBins: newBins });
    };

    const removeBin = (binIdx: number) => {
        updateLevel(idx, { textBins: textBins.filter((_, i) => i !== binIdx) });
    };

    const addCondition = (binIdx: number) => {
        const bin = textBins[binIdx];
        const newCond: TextGroupCondition = { id: `cond-${Date.now()}`, operator: 'contains', value: '' };
        updateBin(binIdx, { conditions: [...(bin.conditions || []), newCond] });
    };

    const updateCondition = (binIdx: number, condIdx: number, updates: Partial<TextGroupCondition>) => {
        const bin = textBins[binIdx];
        const newConditions = (bin.conditions || []).map((c, i) => i === condIdx ? { ...c, ...updates } : c);
        updateBin(binIdx, { conditions: newConditions });
    };

    const removeCondition = (binIdx: number, condIdx: number) => {
        const bin = textBins[binIdx];
        updateBin(binIdx, { conditions: (bin.conditions || []).filter((_, i) => i !== condIdx) });
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">📝 文本分组规则</span>
                <button onClick={addBin} className="text-xs text-green-600 hover:text-green-700 flex items-center gap-1">
                    <Plus size={12} /> 添加分组
                </button>
            </div>

            {textBins.length === 0 && (
                <div className="text-xs text-slate-400 italic bg-slate-50 rounded-lg p-3 text-center">
                    未设置规则时，将按原值进行分组
                </div>
            )}

            {/* 唯一值预览 */}
            {uniqueValues.length > 0 && uniqueValues.length <= 20 && (
                <div className="bg-blue-50 rounded-lg p-2">
                    <div className="text-[10px] text-blue-600 mb-1">可选值预览:</div>
                    <div className="flex flex-wrap gap-1">
                        {uniqueValues.slice(0, 15).map(val => (
                            <span key={val} className="px-1.5 py-0.5 bg-white text-[10px] text-blue-700 rounded border border-blue-200">
                                {val.length > 15 ? val.slice(0, 15) + '...' : val}
                            </span>
                        ))}
                        {uniqueValues.length > 15 && (
                            <span className="text-[10px] text-blue-500">+{uniqueValues.length - 15} 更多</span>
                        )}
                    </div>
                </div>
            )}

            {textBins.map((bin, binIdx) => (
                <div key={bin.id} className="bg-green-50 rounded-lg p-3 border border-green-100">
                    <div className="flex items-center gap-2 mb-2">
                        <input
                            type="text"
                            value={bin.label}
                            onChange={e => updateBin(binIdx, { label: e.target.value })}
                            className="flex-1 px-2 py-1.5 text-sm border border-green-200 rounded-lg bg-white"
                            placeholder="分组名称"
                        />
                        <button onClick={() => removeBin(binIdx)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                            <X size={14} />
                        </button>
                    </div>

                    <div className="space-y-2">
                        <div className="flex items-center justify-between">
                            <span className="text-[10px] text-slate-500">匹配条件:</span>
                            <button onClick={() => addCondition(binIdx)} className="text-[10px] text-green-600 hover:text-green-700">
                                + 添加条件
                            </button>
                        </div>

                        {(bin.conditions || []).length === 0 && (
                            <div className="text-[10px] text-slate-400 italic">点击"添加条件"设置匹配规则</div>
                        )}

                        {(bin.conditions || []).map((cond, condIdx) => (
                            <div key={cond.id} className="flex items-center gap-2 bg-white rounded-lg p-2 border border-green-100">
                                <select
                                    value={cond.operator}
                                    onChange={e => updateCondition(binIdx, condIdx, { operator: e.target.value as TextGroupCondition['operator'] })}
                                    className="px-2 py-1 text-xs border border-slate-200 rounded bg-white"
                                >
                                    <option value="contains">包含</option>
                                    <option value="equals">等于</option>
                                    <option value="startsWith">开头是</option>
                                    <option value="endsWith">结尾是</option>
                                </select>
                                <input
                                    type="text"
                                    value={cond.value}
                                    onChange={e => updateCondition(binIdx, condIdx, { value: e.target.value })}
                                    className="flex-1 px-2 py-1 text-xs border border-slate-200 rounded"
                                    placeholder="匹配值"
                                />
                                <button onClick={() => removeCondition(binIdx, condIdx)} className="p-1 text-red-300 hover:text-red-500">
                                    <X size={12} />
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            ))}
        </div>
    );
};

// ========== 数值分组配置 ==========
const NumericGroupConfig: React.FC<{
    level: GroupLevel;
    idx: number;
    updateLevel: (idx: number, updates: Partial<GroupLevel>) => void;
}> = ({ level, idx, updateLevel }) => {
    const numericBins = level.numericBins || [];

    const addBin = () => {
        const newBin: GroupBinRange = { id: `nbin-${Date.now()}`, min: 0, max: 100, label: '' };
        updateLevel(idx, { numericBins: [...numericBins, newBin] });
    };

    const updateBin = (binIdx: number, updates: Partial<GroupBinRange>) => {
        const newBins = numericBins.map((b, i) => i === binIdx ? { ...b, ...updates } : b);
        updateLevel(idx, { numericBins: newBins });
    };

    const removeBin = (binIdx: number) => {
        updateLevel(idx, { numericBins: numericBins.filter((_, i) => i !== binIdx) });
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">🔢 数值范围分组</span>
                <button onClick={addBin} className="text-xs text-amber-600 hover:text-amber-700 flex items-center gap-1">
                    <Plus size={12} /> 添加范围
                </button>
            </div>

            {numericBins.length === 0 && (
                <div className="text-xs text-slate-400 italic bg-slate-50 rounded-lg p-3 text-center">
                    未设置范围时，将按原始数值进行分组
                </div>
            )}

            {numericBins.map((bin, binIdx) => (
                <div key={bin.id} className="flex items-center gap-2 bg-amber-50 rounded-lg p-3 border border-amber-100">
                    <div className="flex items-center gap-1">
                        <input
                            type="number"
                            value={bin.min}
                            onChange={e => updateBin(binIdx, { min: parseFloat(e.target.value) || 0 })}
                            className="w-20 px-2 py-1.5 text-sm border border-amber-200 rounded-lg bg-white text-center"
                            placeholder="最小值"
                        />
                        <span className="text-slate-400">~</span>
                        <input
                            type="number"
                            value={bin.max}
                            onChange={e => updateBin(binIdx, { max: parseFloat(e.target.value) || 0 })}
                            className="w-20 px-2 py-1.5 text-sm border border-amber-200 rounded-lg bg-white text-center"
                            placeholder="最大值"
                        />
                    </div>
                    <span className="text-slate-400">→</span>
                    <input
                        type="text"
                        value={bin.label}
                        onChange={e => updateBin(binIdx, { label: e.target.value })}
                        className="flex-1 px-2 py-1.5 text-sm border border-amber-200 rounded-lg bg-white"
                        placeholder="分组标签"
                    />
                    <button onClick={() => removeBin(binIdx)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <X size={14} />
                    </button>
                </div>
            ))}
        </div>
    );
};

// ========== 日期分组配置 ==========
const DateGroupConfig: React.FC<{
    level: GroupLevel;
    idx: number;
    updateLevel: (idx: number, updates: Partial<GroupLevel>) => void;
}> = ({ level, idx, updateLevel }) => {
    const dateBins = level.dateBins || [];

    const addBin = () => {
        const today = new Date().toISOString().slice(0, 10);
        const newBin: DateBinRange = { id: `dbin-${Date.now()}`, startDate: today, endDate: today, label: '' };
        updateLevel(idx, { dateBins: [...dateBins, newBin] });
    };

    const updateBin = (binIdx: number, updates: Partial<DateBinRange>) => {
        const newBins = dateBins.map((b, i) => i === binIdx ? { ...b, ...updates } : b);
        updateLevel(idx, { dateBins: newBins });
    };

    const removeBin = (binIdx: number) => {
        updateLevel(idx, { dateBins: dateBins.filter((_, i) => i !== binIdx) });
    };

    return (
        <div className="space-y-3">
            <div className="flex items-center justify-between">
                <span className="text-sm font-medium text-slate-700">📅 日期范围分组</span>
                <button onClick={addBin} className="text-xs text-blue-600 hover:text-blue-700 flex items-center gap-1">
                    <Plus size={12} /> 添加范围
                </button>
            </div>

            {dateBins.length === 0 && (
                <div className="text-xs text-slate-400 italic bg-slate-50 rounded-lg p-3 text-center">
                    未设置范围时，将按原始日期进行分组
                </div>
            )}

            {dateBins.map((bin, binIdx) => (
                <div key={bin.id} className="flex items-center gap-2 bg-blue-50 rounded-lg p-3 border border-blue-100">
                    <div className="flex items-center gap-1">
                        <input
                            type="date"
                            value={bin.startDate}
                            onChange={e => updateBin(binIdx, { startDate: e.target.value })}
                            className="px-2 py-1.5 text-sm border border-blue-200 rounded-lg bg-white"
                        />
                        <span className="text-slate-400">~</span>
                        <input
                            type="date"
                            value={bin.endDate}
                            onChange={e => updateBin(binIdx, { endDate: e.target.value })}
                            className="px-2 py-1.5 text-sm border border-blue-200 rounded-lg bg-white"
                        />
                    </div>
                    <span className="text-slate-400">→</span>
                    <input
                        type="text"
                        value={bin.label}
                        onChange={e => updateBin(binIdx, { label: e.target.value })}
                        className="flex-1 px-2 py-1.5 text-sm border border-blue-200 rounded-lg bg-white"
                        placeholder="分组标签 (如: 第一季度)"
                    />
                    <button onClick={() => removeBin(binIdx)} className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <X size={14} />
                    </button>
                </div>
            ))}
        </div>
    );
};

export default TreeGroupConfigModal;
