/**
 * 统一设置下拉面板 - 用于转置和画廊共享配置
 * 改为下拉面板形式，可以边改边看效果
 */
import React, { useState, useMemo, useRef, useEffect, useTransition, useCallback } from 'react';
import {
    Settings, Layers, Calendar, Image, Filter,
    ArrowUpDown, Sparkles, ChevronDown, ChevronUp, Plus, Trash2,
    Check, ArrowUp, ArrowDown, X, Eye, EyeOff, Copy, Maximize2, Minimize2,
    RefreshCw, Link, Save, ClipboardList, FileText, UserCheck, BarChart2,
    CheckCircle, XCircle, AlertTriangle, FolderOpen, Hash, FolderTree
} from 'lucide-react';
import {
    SharedConfig,
    SortRule,
    CustomFilter,
    NumFilter,
    HighlightRule,
    GroupBinRange,
    TextGroupBin,
    TextGroupCondition,
    DateBinRange,
    GroupLevel,
    getDefaultSharedConfig,
} from '../types/sharedConfig';
import TreeGroupConfigModal from './TreeGroupConfigModal';

// Debounced input component to prevent lag during typing
const DebouncedInput: React.FC<{
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    style?: React.CSSProperties;
    type?: string;
    debounceMs?: number;
}> = ({ value, onChange, placeholder, className, style, type = 'text', debounceMs = 300 }) => {
    const [localValue, setLocalValue] = useState(value);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = useRef(true);

    // Sync external value changes
    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    useEffect(() => {
        return () => {
            mountedRef.current = false;
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const newValue = e.target.value;
        setLocalValue(newValue); // Immediate local update

        // Debounced config update
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            if (mountedRef.current) {
                onChange(newValue);
            }
        }, debounceMs);
    }, [onChange, debounceMs]);

    // Immediate update on blur
    const handleBlur = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (localValue !== value) {
            onChange(localValue);
        }
    }, [localValue, value, onChange]);

    return (
        <input
            type={type}
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder={placeholder}
            className={className}
            style={style}
        />
    );
};

// Debounced textarea component to prevent lag during typing
const DebouncedTextarea: React.FC<{
    value: string;
    onChange: (value: string) => void;
    placeholder?: string;
    className?: string;
    style?: React.CSSProperties;
    debounceMs?: number;
}> = ({ value, onChange, placeholder, className, style, debounceMs = 300 }) => {
    const [localValue, setLocalValue] = useState(value);
    const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const mountedRef = useRef(true);

    useEffect(() => {
        setLocalValue(value);
    }, [value]);

    useEffect(() => {
        return () => {
            mountedRef.current = false;
            if (timerRef.current) clearTimeout(timerRef.current);
        };
    }, []);

    const handleChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;
        setLocalValue(newValue);
        if (timerRef.current) clearTimeout(timerRef.current);
        timerRef.current = setTimeout(() => {
            if (mountedRef.current) {
                onChange(newValue);
            }
        }, debounceMs);
    }, [onChange, debounceMs]);

    const handleBlur = useCallback(() => {
        if (timerRef.current) clearTimeout(timerRef.current);
        if (localValue !== value) {
            onChange(localValue);
        }
    }, [localValue, value, onChange]);

    return (
        <textarea
            value={localValue}
            onChange={handleChange}
            onBlur={handleBlur}
            placeholder={placeholder}
            className={className}
            style={style}
        />
    );
};

interface DataRow {
    [key: string]: string | number | boolean | null;
}


interface SheetData {
    columns: string[];
    rows: DataRow[];
}

// 复制转置后数据按钮组件
const CopyTransposedDataButton: React.FC<{ data: SheetData }> = ({ data }) => {
    const [copyStatus, setCopyStatus] = useState<'idle' | 'success' | 'error'>('idle');

    const handleCopy = async () => {
        try {
            // 生成 HTML 表格格式，Google Sheets 能正确识别单元格
            const escapeHtml = (str: string) =>
                str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

            const headerRow = data.columns
                .map(col => `<td>${escapeHtml(col)}</td>`)
                .join('');

            const dataRows = data.rows.map(row =>
                '<tr>' + data.columns.map(col => {
                    const val = row[col];
                    if (val === null || val === undefined) return '<td></td>';
                    return `<td>${escapeHtml(String(val))}</td>`;
                }).join('') + '</tr>'
            ).join('');

            const htmlContent = `<table><tr>${headerRow}</tr>${dataRows}</table>`;

            // 同时提供纯文本格式作为后备
            const textHeaders = data.columns.join('\t');
            const textRows = data.rows.map(row =>
                data.columns.map(col => {
                    const val = row[col];
                    if (val === null || val === undefined) return '';
                    return String(val).replace(/\t/g, ' ').replace(/\n/g, ' ');
                }).join('\t')
            );
            const textContent = [textHeaders, ...textRows].join('\n');

            // 使用 Clipboard API 同时写入 HTML 和文本格式
            const htmlBlob = new Blob([htmlContent], { type: 'text/html' });
            const textBlob = new Blob([textContent], { type: 'text/plain' });

            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': htmlBlob,
                    'text/plain': textBlob
                })
            ]);

            setCopyStatus('success');
            setTimeout(() => setCopyStatus('idle'), 2000);
        } catch (err) {
            console.error('复制失败:', err);
            // 降级到纯文本复制
            try {
                const textHeaders = data.columns.join('\t');
                const textRows = data.rows.map(row =>
                    data.columns.map(col => {
                        const val = row[col];
                        if (val === null || val === undefined) return '';
                        return String(val).replace(/\t/g, ' ').replace(/\n/g, ' ');
                    }).join('\t')
                );
                await navigator.clipboard.writeText([textHeaders, ...textRows].join('\n'));
                setCopyStatus('success');
                setTimeout(() => setCopyStatus('idle'), 2000);
            } catch {
                setCopyStatus('error');
                setTimeout(() => setCopyStatus('idle'), 2000);
            }
        }
    };

    return (
        <button
            onClick={handleCopy}
            className={`mt-2 w-full px-2 py-1.5 text-[10px] rounded-lg transition-all flex items-center justify-center gap-1 shadow-sm ${copyStatus === 'success'
                ? 'bg-green-600 text-white'
                : copyStatus === 'error'
                    ? 'bg-red-500 text-white'
                    : 'bg-gradient-to-r from-green-500 to-emerald-500 text-white hover:from-green-600 hover:to-emerald-600'
                }`}
        >
            {copyStatus === 'success'
                ? <><CheckCircle size={12} className="inline mr-1" /> 已复制 {data.rows.length} 行</>
                : copyStatus === 'error'
                    ? <><XCircle size={12} className="inline mr-1" /> 复制失败</>
                    : <><ClipboardList size={12} className="inline mr-1" /> 复制转置后数据（{data.rows.length} 行）</>
            }
        </button>
    );
};

interface UnifiedSettingsPanelProps {
    isOpen: boolean;
    onClose: () => void;
    config: SharedConfig;
    onConfigChange: (config: SharedConfig) => void;
    data: SheetData;
    transposedData?: SheetData; // 转置后的数据，用于导出
    mode: 'transpose' | 'gallery' | 'both';
    anchorRef?: React.RefObject<HTMLElement>;  // 锚点元素
    // 查重相关 props
    dedupColumn?: string;
    onDedupColumnChange?: (column: string) => void;
    dedupMode?: 'off' | 'remove' | 'show';
    onDedupModeChange?: (mode: 'off' | 'remove' | 'show') => void;
    duplicateStats?: { total: number; unique: number; duplicates: number };
}

const UnifiedSettingsPanel: React.FC<UnifiedSettingsPanelProps> = ({
    isOpen,
    onClose,
    config,
    onConfigChange,
    data,
    transposedData,
    mode,
    anchorRef,
    dedupColumn,
    onDedupColumnChange,
    dedupMode = 'off',
    onDedupModeChange,
    duplicateStats,
}) => {
    const panelRef = useRef<HTMLDivElement>(null);
    const [activeTab, setActiveTab] = useState<'filter' | 'sort' | 'group' | 'display' | 'highlight' | 'dedup'>('filter');
    const [textGroupSelection, setTextGroupSelection] = useState<Set<string>>(new Set());
    const [pasteConditionOperator, setPasteConditionOperator] = useState<TextGroupCondition['operator']>('contains');
    const [configIo, setConfigIo] = useState<{ mode: 'export' | 'import' | null; text: string; notice: string }>({
        mode: null,
        text: '',
        notice: '',
    });
    const [isPending, startTransition] = useTransition();
    const [panelPlacement, setPanelPlacement] = useState<'bottom' | 'top'>('bottom');
    const [showTreeGroupModal, setShowTreeGroupModal] = useState(false);
    const [isExpandedModal, setIsExpandedModal] = useState(false);
    const filtersEnabled = config.filtersEnabled ?? true;
    const sortEnabled = config.sortEnabled ?? true;
    const highlightEnabled = config.highlightEnabled ?? true;

    // 优化：缓存当前分组层级和可用列
    // 优先使用 groupLevels，否则回退到 groupColumns/groupColumn
    const currentGroupLevels = useMemo((): GroupLevel[] => {
        if (config.groupLevels?.length > 0) return config.groupLevels;
        // 向后兼容：从 groupColumns/groupColumn 构建
        const cols = config.groupColumns?.length > 0 ? config.groupColumns : (config.groupColumn ? [config.groupColumn] : []);
        return cols.map((col, idx) => ({
            id: `legacy-${idx}`,
            column: col,
            type: 'text' as const,
        }));
    }, [config.groupLevels, config.groupColumns, config.groupColumn]);

    // 点击外部关闭
    useEffect(() => {
        if (!isOpen) return;
        const handleClickOutside = (e: MouseEvent) => {
            // 如果树状图弹窗打开，不关闭
            if (showTreeGroupModal) return;
            if (panelRef.current && !panelRef.current.contains(e.target as Node)) {
                // 如果点击的是锚点按钮，不关闭（让按钮的 onClick 处理）
                if (anchorRef?.current?.contains(e.target as Node)) return;
                // 检查是否点击了树状图弹窗
                const target = e.target as HTMLElement;
                if (target.closest('[data-modal="tree-group-config"]')) return;
                onClose();
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, [isOpen, onClose, anchorRef, showTreeGroupModal]);

    useEffect(() => {
        if (!isOpen) return;
        const anchorEl = anchorRef?.current;
        if (!anchorEl) {
            setPanelPlacement('bottom');
            return;
        }
        const rect = anchorEl.getBoundingClientRect();
        const gap = 8;
        const panelHeight = 560;
        const spaceBelow = window.innerHeight - rect.bottom - gap;
        const spaceAbove = rect.top - gap;
        if (spaceBelow >= panelHeight || spaceBelow >= spaceAbove) {
            setPanelPlacement('bottom');
        } else {
            setPanelPlacement('top');
        }
    }, [isOpen, anchorRef]);


    const updateConfig = useCallback((partial: Partial<SharedConfig>) => {
        startTransition(() => {
            onConfigChange({ ...config, ...partial });
        });
    }, [config, onConfigChange, startTransition]);

    // Debounced update for text inputs to avoid lag during typing
    const debouncedUpdateConfigRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const updateConfigDebounced = useCallback((partial: Partial<SharedConfig>, debounceMs = 300) => {
        if (debouncedUpdateConfigRef.current) {
            clearTimeout(debouncedUpdateConfigRef.current);
        }
        debouncedUpdateConfigRef.current = setTimeout(() => {
            startTransition(() => {
                onConfigChange({ ...config, ...partial });
            });
        }, debounceMs);
    }, [config, onConfigChange, startTransition]);

    const exportConfig = async () => {
        const payload = JSON.stringify(config, null, 2);
        setConfigIo({ mode: 'export', text: payload, notice: '' });
        try {
            if (navigator.clipboard?.writeText) {
                await navigator.clipboard.writeText(payload);
                setConfigIo({ mode: 'export', text: payload, notice: '已复制到剪贴板' });
                return;
            }
        } catch {
            // Ignore clipboard errors and fallback
        }
        setConfigIo({ mode: 'export', text: payload, notice: '复制失败，请手动复制' });
    };

    const importConfig = () => {
        setConfigIo({ mode: 'import', text: '', notice: '' });
    };

    // 自动检测并设置默认列
    useEffect(() => {
        if (!data.columns.length) return;
        const updates: Partial<SharedConfig> = {};

        // 图片列默认：贴文多媒体
        if (!config.imageColumn) {
            const imageCol = data.columns.find(c => c.includes('贴文多媒体') || c.includes('多媒体') || c.includes('图片') || c.includes('封面'));
            if (imageCol) updates.imageColumn = imageCol;
        }

        // 链接列默认：贴文链接
        if (!config.linkColumn) {
            const linkCol = data.columns.find(c => c.includes('贴文链接') || c.includes('链接') || c.includes('Link') || c.includes('URL'));
            if (linkCol) updates.linkColumn = linkCol;
        }

        // 日期列默认
        if (!config.dateColumn) {
            const dateCol = data.columns.find(c => c.includes('日期') || c.includes('时间') || c.includes('Date'));
            if (dateCol) updates.dateColumn = dateCol;
        }

        // 默认显示信息列：贴文多媒体、点赞量、播放量等
        if (config.displayColumns.length === 0) {
            const defaultCols = data.columns.filter(c =>
                c.includes('贴文多媒体') || c.includes('多媒体') ||
                c.includes('点赞') || c.includes('贴文点赞量') ||
                c.includes('播放') || c.includes('评论') ||
                c.includes('粉丝') || c.includes('收藏')
            );
            if (defaultCols.length > 0) updates.displayColumns = defaultCols;
        }

        if (Object.keys(updates).length > 0) {
            onConfigChange({ ...config, ...updates });
        }
    }, [data.columns, config.imageColumn, config.linkColumn, config.dateColumn, config.displayColumns, onConfigChange]);

    // 获取列的唯一值
    const getUniqueValues = (column: string): string[] => {
        if (!column || !data.rows) return [];
        return [...new Set(
            data.rows.map(r => String(r[column] || '')).filter(v => v)
        )].sort((a, b) => a.localeCompare(b, 'zh-CN'));
    };

    // 检测列类型
    const detectColumnType = (col: string): 'number' | 'text' | 'date' => {
        if (!col || !data.rows) return 'text';
        const sampleValues = data.rows.slice(0, 20).map(r => String(r[col] || '')).filter(v => v);
        const numCount = sampleValues.filter(v => !isNaN(parseFloat(v))).length;
        const dateCount = sampleValues.filter(v => /^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(v)).length;
        if (dateCount > sampleValues.length * 0.5) return 'date';
        if (numCount > sampleValues.length * 0.5) return 'number';
        return 'text';
    };

    // 获取筛选操作符列表
    const getOperators = (columnType: 'number' | 'text' | 'date') => {
        const common = [
            { value: 'notEmpty', label: '非空' },
            { value: 'isEmpty', label: '为空' },
            { value: 'multiSelect', label: '多选值' },
        ];
        if (columnType === 'number') {
            return [
                { value: 'greaterThan', label: '大于 >' },
                { value: 'lessThan', label: '小于 <' },
                { value: 'greaterOrEqual', label: '大于等于 ≥' },
                { value: 'lessOrEqual', label: '小于等于 ≤' },
                { value: 'equals', label: '等于 =' },
                { value: 'notEquals', label: '不等于 ≠' },
                { value: 'between', label: '区间' },
                ...common
            ];
        }
        return [
            { value: 'contains', label: '包含' },
            { value: 'notContains', label: '不包含' },
            { value: 'equals', label: '等于' },
            { value: 'notEquals', label: '不等于' },
            { value: 'startsWith', label: '开头是' },
            { value: 'endsWith', label: '结尾是' },
            { value: 'regex', label: '正则' },
            ...common
        ];
    };

    if (!isOpen) return null;

    const tabs = [
        { id: 'filter', label: '筛选', icon: Filter, color: 'blue' },
        { id: 'sort', label: '排序', icon: ArrowUpDown, color: 'orange' },
        { id: 'group', label: '分组', icon: Layers, color: 'indigo' },
        { id: 'display', label: '显示', icon: Image, color: 'purple' },
        { id: 'highlight', label: '高亮', icon: Sparkles, color: 'amber' },
        { id: 'dedup', label: '查重', icon: Copy, color: 'teal' },
    ] as const;

    return (
        <>
            {/* Modal backdrop when expanded */}
            {isExpandedModal && (
                <div
                    className="fixed inset-0 bg-black/40 backdrop-blur-sm z-[9998]"
                    onClick={() => setIsExpandedModal(false)}
                />
            )}
            <div
                ref={panelRef}
                className={isExpandedModal
                    ? "fixed inset-4 md:inset-10 lg:inset-20 bg-white rounded-2xl shadow-2xl border border-slate-200 z-[9999] overflow-hidden sheetmind-light-form unified-settings-panel flex flex-col"
                    : "absolute top-full right-0 mt-2 w-[420px] bg-white rounded-xl shadow-2xl border border-slate-200 z-50 overflow-hidden sheetmind-light-form unified-settings-panel flex flex-col"
                }
                style={isExpandedModal ? {} : {
                    height: '560px',
                    top: panelPlacement === 'bottom' ? undefined : 'auto',
                    bottom: panelPlacement === 'top' ? 'calc(100% + 8px)' : undefined,
                    marginTop: panelPlacement === 'bottom' ? '0.5rem' : undefined,
                    marginBottom: panelPlacement === 'top' ? '0.5rem' : undefined,
                }}
            >
                {/* Tab Header */}
                <div className="flex border-b border-slate-200 bg-slate-50 px-2 py-1 gap-1 overflow-x-auto">
                    {tabs.map(tab => {
                        const Icon = tab.icon;
                        const isActive = activeTab === tab.id;
                        return (
                            <button
                                key={tab.id}
                                onClick={() => setActiveTab(tab.id)}
                                className={`flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md transition-all whitespace-nowrap ${isActive
                                    ? `bg-${tab.color}-100 text-${tab.color}-700 shadow-sm`
                                    : 'text-slate-500 hover:bg-slate-100'
                                    }`}
                                style={isActive ? {
                                    backgroundColor: tab.color === 'indigo' ? '#e0e7ff' :
                                        tab.color === 'purple' ? '#f3e8ff' :
                                            tab.color === 'blue' ? '#dbeafe' :
                                                tab.color === 'orange' ? '#ffedd5' :
                                                    '#fef3c7',
                                    color: tab.color === 'indigo' ? '#4338ca' :
                                        tab.color === 'purple' ? '#7e22ce' :
                                            tab.color === 'blue' ? '#1d4ed8' :
                                                tab.color === 'orange' ? '#c2410c' :
                                                    '#b45309'
                                } : {}}
                            >
                                <Icon size={12} />
                                {tab.label}
                            </button>
                        );
                    })}
                    <div className="ml-auto flex items-center gap-1">
                        <button
                            onClick={() => setIsExpandedModal(!isExpandedModal)}
                            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md text-indigo-600 hover:bg-indigo-50 border border-indigo-200"
                            title={isExpandedModal ? "收起为小面板" : "展开为大窗口"}
                        >
                            {isExpandedModal ? <Minimize2 size={12} /> : <Maximize2 size={12} />}
                            {isExpandedModal ? '收起' : '展开'}
                        </button>
                        <button
                            onClick={exportConfig}
                            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md text-slate-600 hover:bg-slate-100 border border-slate-200"
                        >
                            导出
                        </button>
                        <button
                            onClick={importConfig}
                            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md text-slate-600 hover:bg-slate-100 border border-slate-200"
                        >
                            导入
                        </button>
                        <button
                            onClick={() => {
                                onConfigChange(getDefaultSharedConfig());
                                setActiveTab('filter');
                                setTextGroupSelection(new Set());
                            }}
                            className="flex items-center gap-1 px-2 py-1.5 text-xs font-medium rounded-md text-red-600 hover:bg-red-50 border border-red-200"
                        >
                            <Trash2 size={12} />
                            恢复默认
                        </button>
                    </div>
                </div>

                {/* Transpose Data Toggle - Important data format option */}
                <div className="border-b border-purple-100 bg-purple-50/50 px-3 py-1.5">
                    <label className="flex items-center justify-between cursor-pointer">
                        <span className="text-[11px] font-medium text-slate-700 flex items-center gap-1.5">
                            <RefreshCw size={12} className="inline mr-1" /> 转置数据
                            <span className="text-[9px] text-slate-500 font-normal">
                                （横向→纵向）
                            </span>
                        </span>
                        <button
                            onClick={() => updateConfig({
                                transposeData: !config.transposeData,
                                // Clear display columns when toggling transpose - column names will change
                                displayColumns: []
                            })}
                            className={`relative w-9 h-5 rounded-full transition-colors ${config.transposeData ? 'bg-purple-500' : 'bg-slate-300'}`}
                        >
                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${config.transposeData ? 'left-4' : 'left-0.5'}`} />
                        </button>
                    </label>
                    {config.transposeData && (
                        <>
                            <p className="text-[9px] text-purple-600 mt-1">
                                <CheckCircle size={10} className="inline mr-1" /> 已启用：第一列作为字段名，其他列作为记录
                            </p>
                            {/* Merge Columns Sub-toggle */}
                            <label className="flex items-center justify-between cursor-pointer mt-2 pt-1.5 border-t border-purple-200">
                                <span className="text-[10px] text-slate-600 flex items-center gap-1">
                                    <Link size={10} className="inline mr-1" /> 合并同名列
                                    <span className="text-[8px] text-slate-400">
                                        (如[1.X]和[2.Y]合并)
                                    </span>
                                </span>
                                <button
                                    onClick={() => updateConfig({
                                        mergeTransposeColumns: !config.mergeTransposeColumns,
                                        displayColumns: []  // Reset display columns when toggling
                                    })}
                                    className={`relative w-8 h-4 rounded-full transition-colors ${config.mergeTransposeColumns ? 'bg-indigo-500' : 'bg-slate-300'}`}
                                >
                                    <span className={`absolute top-0.5 w-3 h-3 bg-white rounded-full shadow transition-all ${config.mergeTransposeColumns ? 'left-4' : 'left-0.5'}`} />
                                </button>
                            </label>
                            {/* 复制转置后数据按钮 */}
                            {transposedData && transposedData.rows.length > 0 && (
                                <CopyTransposedDataButton data={transposedData} />
                            )}
                        </>
                    )}
                </div>

                {/* 配置摘要 - Quick Overview */}
                {(() => {
                    const summaryItems: { label: string; value: string; tab: typeof activeTab; color: string }[] = [];

                    // 筛选
                    if (config.customFilters.length > 0) {
                        summaryItems.push({ label: '筛选', value: `${config.customFilters.length}条`, tab: 'filter', color: 'blue' });
                    }
                    // 排序
                    if (config.sortRules.length > 0) {
                        summaryItems.push({ label: '排序', value: `${config.sortRules.length}条`, tab: 'sort', color: 'orange' });
                    }
                    // 分组
                    const groupCount = config.groupColumns?.length || (config.groupColumn ? 1 : 0);
                    if (groupCount > 0) {
                        summaryItems.push({ label: '多级分组', value: `${groupCount}级`, tab: 'group', color: 'indigo' });
                    }
                    if (config.textGrouping && config.textGroupBins.length > 0) {
                        summaryItems.push({ label: '文本分组', value: `${config.textGroupBins.length}组`, tab: 'group', color: 'indigo' });
                    }
                    if (config.fuzzyRuleText) {
                        const ruleCount = config.fuzzyRuleText.split(';').filter(r => r.includes('=')).length;
                        summaryItems.push({ label: '关键词合并', value: `${ruleCount}条`, tab: 'group', color: 'indigo' });
                    }
                    if (config.dateBinning && config.dateBins.length > 0) {
                        summaryItems.push({ label: '日期分组', value: `${config.dateBins.length}段`, tab: 'group', color: 'indigo' });
                    }
                    // 显示
                    if (config.imageColumn) {
                        summaryItems.push({ label: '图片列', value: config.imageColumn, tab: 'display', color: 'purple' });
                    }
                    if (config.displayColumns.length > 0) {
                        summaryItems.push({ label: '显示列', value: `${config.displayColumns.length}列`, tab: 'display', color: 'purple' });
                    }
                    // 高亮
                    if (config.highlightRules.length > 0) {
                        summaryItems.push({ label: '高亮', value: `${config.highlightRules.length}条`, tab: 'highlight', color: 'amber' });
                    }

                    if (summaryItems.length === 0) return null;

                    return (
                        <div className="border-b border-slate-100 bg-slate-50/50 px-3 py-1.5">
                            <div className="flex flex-wrap gap-1">
                                {summaryItems.map((item, idx) => (
                                    <button
                                        key={idx}
                                        onClick={() => setActiveTab(item.tab)}
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 text-[10px] rounded bg-white border border-slate-200 hover:border-slate-300 transition-colors"
                                        style={{
                                            borderColor: item.tab === activeTab ? (
                                                item.color === 'blue' ? '#93c5fd' :
                                                    item.color === 'orange' ? '#fdba74' :
                                                        item.color === 'indigo' ? '#a5b4fc' :
                                                            item.color === 'purple' ? '#c4b5fd' :
                                                                '#fcd34d'
                                            ) : undefined
                                        }}
                                    >
                                        <span className="text-slate-500">{item.label}:</span>
                                        <span className="font-medium text-slate-700 max-w-[60px] truncate">{item.value}</span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    );
                })()}

                {configIo.mode && (
                    <div className="border-b border-slate-200 bg-white px-3 py-2">
                        <div className="flex items-center justify-between mb-1">
                            <span className="text-[11px] font-medium text-slate-700">
                                {configIo.mode === 'export' ? '导出配置' : '导入配置'}
                            </span>
                            <button
                                onClick={() => setConfigIo({ mode: null, text: '', notice: '' })}
                                className="text-slate-400 hover:text-slate-600"
                                aria-label="close"
                            >
                                <X size={12} />
                            </button>
                        </div>
                        <textarea
                            value={configIo.text}
                            onChange={e => setConfigIo(prev => ({ ...prev, text: e.target.value }))}
                            readOnly={configIo.mode === 'export'}
                            placeholder={configIo.mode === 'export' ? '' : '粘贴总配置 JSON...'}
                            className="w-full h-28 px-2 py-1 text-[10px] font-mono text-slate-700 border border-slate-200 rounded bg-slate-50"
                        />
                        <div className="flex items-center justify-between mt-1">
                            <span className="text-[10px] text-slate-500">{configIo.notice}</span>
                            <div className="flex gap-1">
                                {configIo.mode === 'export' ? (
                                    <>
                                        <button
                                            onClick={exportConfig}
                                            className="text-[10px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                                        >
                                            重新复制
                                        </button>
                                        <button
                                            onClick={() => {
                                                const blob = new Blob([configIo.text], { type: 'application/json' });
                                                const url = URL.createObjectURL(blob);
                                                const a = document.createElement('a');
                                                a.href = url;
                                                a.download = `sheetmind-config-${new Date().toISOString().slice(0, 10)}.json`;
                                                a.click();
                                                URL.revokeObjectURL(url);
                                                setConfigIo(prev => ({ ...prev, notice: '已下载配置文件' }));
                                            }}
                                            className="text-[10px] px-2 py-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-50"
                                        >
                                            <Save size={10} className="inline mr-1" /> 下载文件
                                        </button>
                                    </>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => {
                                                if (!configIo.text.trim()) {
                                                    setConfigIo(prev => ({ ...prev, notice: '请先粘贴配置' }));
                                                    return;
                                                }
                                                try {
                                                    const parsed = JSON.parse(configIo.text);
                                                    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                                                        setConfigIo(prev => ({ ...prev, notice: '配置格式不正确' }));
                                                        return;
                                                    }
                                                    onConfigChange({ ...getDefaultSharedConfig(), ...(parsed as SharedConfig) });
                                                    setActiveTab('filter');
                                                    setTextGroupSelection(new Set());
                                                    setConfigIo({ mode: null, text: '', notice: '' });
                                                } catch (err) {
                                                    const errMsg = err instanceof Error ? err.message : '未知错误';
                                                    setConfigIo(prev => ({ ...prev, notice: `配置解析失败: ${errMsg}` }));
                                                }
                                            }}
                                            className="text-[10px] px-2 py-1 rounded border border-slate-200 text-slate-600 hover:bg-slate-50"
                                        >
                                            应用导入
                                        </button>
                                        <label className="text-[10px] px-2 py-1 rounded border border-blue-200 text-blue-600 hover:bg-blue-50 cursor-pointer flex items-center gap-1">
                                            <FolderOpen size={10} /> 选择文件
                                            <input
                                                type="file"
                                                accept=".json"
                                                className="hidden"
                                                onChange={(e) => {
                                                    const file = e.target.files?.[0];
                                                    if (!file) return;
                                                    const reader = new FileReader();
                                                    reader.onload = (ev) => {
                                                        const text = ev.target?.result as string;
                                                        try {
                                                            const parsed = JSON.parse(text);
                                                            if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
                                                                setConfigIo(prev => ({ ...prev, notice: '配置格式不正确' }));
                                                                return;
                                                            }
                                                            onConfigChange({ ...getDefaultSharedConfig(), ...(parsed as SharedConfig) });
                                                            setActiveTab('filter');
                                                            setTextGroupSelection(new Set());
                                                            setConfigIo({ mode: null, text: '', notice: '' });
                                                        } catch (err) {
                                                            const errMsg = err instanceof Error ? err.message : '未知错误';
                                                            setConfigIo(prev => ({ ...prev, notice: `文件解析失败: ${errMsg}` }));
                                                        }
                                                    };
                                                    reader.readAsText(file);
                                                    e.target.value = ''; // Reset input
                                                }}
                                            />
                                        </label>
                                    </>
                                )}
                            </div>
                        </div>
                    </div>
                )}

                {/* Tab Content */}
                <div className="p-3 overflow-y-auto flex-1" style={{ minHeight: 0 }}>

                    {/* === 分组设置 === */}
                    {activeTab === 'group' && (
                        <div className="space-y-2">
                            {/* 快捷分组按钮 */}
                            <div className="flex flex-wrap gap-1">
                                <button
                                    onClick={() => {
                                        const typeCol = data.columns.find(c => c.includes('类型') || c.includes('Type'));
                                        if (typeCol) {
                                            updateConfig({ groupColumn: typeCol, groupLevels: [], groupColumns: [] });
                                        } else {
                                            alert('未找到"类型"相关的列。请在下方手动选择分组列。');
                                        }
                                    }}
                                    className={`px-2 py-1 text-[10px] rounded border ${config.groupColumn?.includes('类型') ? 'bg-indigo-500 text-white border-indigo-600' : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700'}`}
                                ><FileText size={10} className="inline mr-1" /> 按类型</button>
                                <button
                                    onClick={() => {
                                        const likeCol = data.columns.find(c => c.includes('点赞') || c.includes('贴文点赞量'));
                                        if (likeCol) {
                                            updateConfig({ groupColumn: likeCol, groupBinning: true, groupLevels: [], groupColumns: [] });
                                        } else {
                                            alert('未找到"点赞"相关的列。请在下方手动选择分组列。');
                                        }
                                    }}
                                    className={`px-2 py-1 text-[10px] rounded border ${config.groupColumn?.includes('点赞') ? 'bg-indigo-500 text-white border-indigo-600' : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700'}`}
                                >👍 按点赞范围</button>
                                <button
                                    onClick={() => {
                                        const authorCol = data.columns.find(c => c.includes('作者') || c.includes('账号') || c.includes('用户'));
                                        if (authorCol) {
                                            updateConfig({ groupColumn: authorCol, groupLevels: [], groupColumns: [] });
                                        } else {
                                            alert('未找到"作者/账号/用户"相关的列。请在下方手动选择分组列。');
                                        }
                                    }}
                                    className={`px-2 py-1 text-[10px] rounded border ${config.groupColumn?.includes('作者') || config.groupColumn?.includes('账号') ? 'bg-indigo-500 text-white border-indigo-600' : 'bg-indigo-50 hover:bg-indigo-100 border-indigo-200 text-indigo-700'}`}
                                ><UserCheck size={10} className="inline mr-1" /> 按作者</button>
                                {config.groupColumn && (
                                    <button
                                        onClick={() => updateConfig({ groupColumn: '', groupBinning: false, groupLevels: [], groupColumns: [] })}
                                        className="px-2 py-1 text-[10px] bg-red-50 hover:bg-red-100 rounded border border-red-200 text-red-500"
                                    >取消分组</button>
                                )}
                            </div>

                            {/* 分组模式切换 */}
                            <div className="flex items-center gap-2 p-2 bg-slate-100 rounded-lg border border-slate-200">
                                <span className="text-[10px] text-slate-600">分组模式:</span>
                                <button
                                    onClick={() => updateConfig({ groupLevels: [] })}
                                    className={`px-2 py-0.5 text-[10px] rounded ${!currentGroupLevels.length || currentGroupLevels.length <= 1
                                        ? 'bg-indigo-500 text-white'
                                        : 'bg-white text-slate-600 border border-slate-300'
                                        }`}
                                >
                                    简单分组
                                </button>
                                <button
                                    onClick={() => {
                                        // 切换到多级分组模式
                                        // 如果有 groupColumn，转为第一个 groupLevel
                                        const firstLevel: GroupLevel = config.groupColumn
                                            ? { id: `level-${Date.now()}`, column: config.groupColumn, type: 'text' }
                                            : { id: `level-${Date.now()}`, column: data.columns[0] || '', type: 'text' };
                                        // 添加第二个空层级，让用户可以选择
                                        updateConfig({
                                            groupLevels: [firstLevel, { id: `level-${Date.now() + 1}`, column: '', type: 'text' }],
                                            groupColumn: ''  // 清除简单分组
                                        });
                                    }}
                                    className={`px-2 py-0.5 text-[10px] rounded ${currentGroupLevels.length > 1
                                        ? 'bg-indigo-500 text-white'
                                        : 'bg-white text-slate-600 border border-slate-300'
                                        }`}
                                >
                                    多级分组
                                </button>
                                {/* 树状图配置按钮 - 多级分组模式下始终显示 */}
                                <button
                                    onClick={() => setShowTreeGroupModal(true)}
                                    className="ml-auto px-2 py-0.5 text-[10px] rounded bg-gradient-to-r from-indigo-500 to-purple-500 text-white hover:from-indigo-600 hover:to-purple-600 flex items-center gap-1"
                                >
                                    <BarChart2 size={10} className="inline mr-1" /> 树状视图配置
                                </button>
                            </div>

                            {/* 简单分组 - 原来的下拉选择 */}
                            {currentGroupLevels.length <= 1 && (
                                <div className="p-2 bg-indigo-50 rounded-lg border border-indigo-200">
                                    <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 mb-1">
                                        <span className="inline-block w-1.5 h-3 rounded-sm bg-indigo-500" />
                                        分组依据列
                                    </label>
                                    <select
                                        value={config.groupColumn}
                                        onChange={e => updateConfig({ groupColumn: e.target.value, groupLevels: [] })}
                                        className="w-full px-1.5 py-1 text-[11px] text-slate-800 bg-white border border-slate-200 rounded"
                                    >
                                        <option value="">不分组</option>
                                        {data.columns.map(col => (
                                            <option key={col} value={col}>{col}</option>
                                        ))}
                                    </select>
                                </div>
                            )}

                            {/* 多级分组设置 - 树形嵌套结构 */}
                            {currentGroupLevels.length > 1 && (
                                <div className="p-2 bg-indigo-50 rounded-lg border border-indigo-200">
                                    <div className="flex items-center justify-between mb-1.5">
                                        <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800">
                                            <span className="inline-block w-1.5 h-3 rounded-sm bg-indigo-500" />
                                            <FolderTree size={12} className="inline mr-1" /> 层级分组配置
                                        </label>
                                        <button
                                            onClick={() => updateConfig({ groupLevels: [], groupColumns: [], groupColumn: '' })}
                                            className="text-[9px] px-2 py-0.5 bg-red-50 text-red-600 rounded hover:bg-red-100"
                                        >
                                            清空全部
                                        </button>
                                    </div>
                                    <p className="text-[9px] text-slate-500 mb-2">
                                        每个层级在上一级内部进行细分（类似文件夹嵌套）
                                    </p>

                                    {/* 树形嵌套渲染 */}
                                    <div className="space-y-1">
                                        {currentGroupLevels.map((level, idx) => {
                                            const indentLevel = idx;
                                            const isLast = idx === currentGroupLevels.length - 1;

                                            return (
                                                <div key={level.id} style={{ marginLeft: indentLevel * 16 }}>
                                                    {/* 连接线 */}
                                                    {idx > 0 && (
                                                        <div className="flex items-center mb-1">
                                                            <span className="text-slate-300 text-sm mr-1">└─</span>
                                                            <span className="text-[9px] text-slate-400">嵌套在上级内</span>
                                                        </div>
                                                    )}

                                                    <div className="bg-white rounded-lg border border-indigo-200 overflow-hidden">
                                                        {/* 层级头部 */}
                                                        <div className="flex items-center justify-between px-2 py-1.5 bg-gradient-to-r from-indigo-50 to-white border-b border-indigo-100">
                                                            <div className="flex items-center gap-2 min-w-0">
                                                                <FolderOpen size={18} className="text-indigo-500" />
                                                                <span className="text-[10px] font-semibold text-indigo-700 whitespace-nowrap">
                                                                    {idx === 0 ? '一级分组' : idx === 1 ? '二级分组' : idx === 2 ? '三级分组' : `${idx + 1}级`}
                                                                </span>
                                                                <select
                                                                    value={level.column}
                                                                    onChange={e => {
                                                                        const newLevels = currentGroupLevels.map((l, i) =>
                                                                            i === idx ? { ...l, column: e.target.value } : l
                                                                        );
                                                                        updateConfig({ groupLevels: newLevels });
                                                                    }}
                                                                    className="min-w-[100px] max-w-[140px] px-1 py-0.5 text-[10px] text-slate-700 bg-white border border-slate-200 rounded truncate"
                                                                >
                                                                    <option value="">选择列...</option>
                                                                    {data.columns.map(col => (
                                                                        <option key={col} value={col}>{col}</option>
                                                                    ))}
                                                                </select>
                                                            </div>
                                                            <div className="flex items-center gap-1">
                                                                {/* 类型切换 */}
                                                                <div className="flex items-center gap-0.5 bg-white border border-slate-200 rounded p-0.5">
                                                                    <button
                                                                        onClick={() => updateConfig({
                                                                            groupLevels: currentGroupLevels.map((l, i) =>
                                                                                i === idx ? { ...l, type: 'text' } : l
                                                                            )
                                                                        })}
                                                                        className={`px-1.5 py-0.5 text-[9px] rounded ${level.type === 'text' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                                                                    >
                                                                        文本
                                                                    </button>
                                                                    <button
                                                                        onClick={() => updateConfig({
                                                                            groupLevels: currentGroupLevels.map((l, i) =>
                                                                                i === idx ? { ...l, type: 'numeric' } : l
                                                                            )
                                                                        })}
                                                                        className={`px-1.5 py-0.5 text-[9px] rounded ${level.type === 'numeric' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                                                                    >
                                                                        数值
                                                                    </button>
                                                                    <button
                                                                        onClick={() => updateConfig({
                                                                            groupLevels: currentGroupLevels.map((l, i) =>
                                                                                i === idx ? { ...l, type: 'date' } : l
                                                                            )
                                                                        })}
                                                                        className={`px-1.5 py-0.5 text-[9px] rounded ${level.type === 'date' ? 'bg-slate-800 text-white' : 'text-slate-600 hover:bg-slate-100'}`}
                                                                    >
                                                                        日期
                                                                    </button>
                                                                </div>
                                                                {/* 删除按钮 */}
                                                                <button
                                                                    onClick={() => {
                                                                        // 删除此层级及所有子层级
                                                                        const newLevels = currentGroupLevels.slice(0, idx);
                                                                        updateConfig({ groupLevels: newLevels.length > 0 ? newLevels : [] });
                                                                    }}
                                                                    className="p-0.5 text-red-400 hover:text-red-600"
                                                                    title="删除此层级及所有子层级"
                                                                >
                                                                    <X size={12} />
                                                                </button>
                                                            </div>
                                                        </div>

                                                        {/* 层级详细配置（折叠） */}
                                                        <div className="p-2">
                                                            {level.type === 'text' && (
                                                                <div className="space-y-2">
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-[9px] font-medium text-slate-600">文本分组规则</span>
                                                                        <button
                                                                            onClick={() => {
                                                                                const newBin = { id: `tbin-${Date.now()}`, label: '', values: [], conditions: [] };
                                                                                const newLevels = currentGroupLevels.map((l, i) =>
                                                                                    i === idx ? { ...l, textBins: [...(l.textBins || []), newBin] } : l
                                                                                );
                                                                                updateConfig({ groupLevels: newLevels });
                                                                            }}
                                                                            className="text-[9px] text-green-600 hover:text-green-800"
                                                                        >
                                                                            + 添加分组
                                                                        </button>
                                                                    </div>
                                                                    {(level.textBins || []).length === 0 && (
                                                                        <div className="text-[8px] text-slate-400 italic">按原值分组（无自定义规则）</div>
                                                                    )}
                                                                    {(level.textBins || []).map((bin, binIdx) => (
                                                                        <div key={bin.id} className="rounded-md border border-green-100 bg-green-50/40 p-2">
                                                                            <div className="flex items-center gap-2">
                                                                                <input
                                                                                    type="text"
                                                                                    value={bin.label}
                                                                                    onChange={e => {
                                                                                        const newBins = [...(level.textBins || [])];
                                                                                        newBins[binIdx] = { ...bin, label: e.target.value };
                                                                                        const newLevels = currentGroupLevels.map((l, i) =>
                                                                                            i === idx ? { ...l, textBins: newBins } : l
                                                                                        );
                                                                                        updateConfig({ groupLevels: newLevels });
                                                                                    }}
                                                                                    className="flex-1 px-1 py-0.5 text-[10px] border rounded"
                                                                                    placeholder="分组名称"
                                                                                />
                                                                                <button
                                                                                    onClick={() => {
                                                                                        const newBins = (level.textBins || []).filter((_, i) => i !== binIdx);
                                                                                        const newLevels = currentGroupLevels.map((l, i) =>
                                                                                            i === idx ? { ...l, textBins: newBins } : l
                                                                                        );
                                                                                        updateConfig({ groupLevels: newLevels });
                                                                                    }}
                                                                                    className="text-red-400 hover:text-red-600"
                                                                                >
                                                                                    <X size={10} />
                                                                                </button>
                                                                            </div>
                                                                            <div className="mt-1 space-y-1">
                                                                                <div className="flex items-center justify-between">
                                                                                    <span className="text-[8px] text-slate-500">匹配条件</span>
                                                                                    <button
                                                                                        onClick={() => {
                                                                                            const newCond = { id: `cond-${Date.now()}`, operator: 'contains' as const, value: '' };
                                                                                            const newBins = [...(level.textBins || [])];
                                                                                            newBins[binIdx] = { ...bin, conditions: [...(bin.conditions || []), newCond] };
                                                                                            const newLevels = currentGroupLevels.map((l, i) =>
                                                                                                i === idx ? { ...l, textBins: newBins } : l
                                                                                            );
                                                                                            updateConfig({ groupLevels: newLevels });
                                                                                        }}
                                                                                        className="text-[8px] text-green-600"
                                                                                    >
                                                                                        + 条件
                                                                                    </button>
                                                                                </div>
                                                                                {(bin.conditions || []).map((cond, condIdx) => (
                                                                                    <div key={cond.id} className="flex items-center gap-1">
                                                                                        <select
                                                                                            value={cond.operator}
                                                                                            onChange={e => {
                                                                                                const newConditions = [...(bin.conditions || [])];
                                                                                                newConditions[condIdx] = { ...cond, operator: e.target.value as TextGroupCondition['operator'] };
                                                                                                const newBins = [...(level.textBins || [])];
                                                                                                newBins[binIdx] = { ...bin, conditions: newConditions };
                                                                                                const newLevels = currentGroupLevels.map((l, i) =>
                                                                                                    i === idx ? { ...l, textBins: newBins } : l
                                                                                                );
                                                                                                updateConfig({ groupLevels: newLevels });
                                                                                            }}
                                                                                            className="px-1 py-0.5 text-[9px] border rounded bg-white"
                                                                                        >
                                                                                            <option value="contains">包含</option>
                                                                                            <option value="equals">等于</option>
                                                                                            <option value="startsWith">开头</option>
                                                                                            <option value="endsWith">结尾</option>
                                                                                        </select>
                                                                                        <input
                                                                                            type="text"
                                                                                            value={cond.value}
                                                                                            onChange={e => {
                                                                                                const newConditions = [...(bin.conditions || [])];
                                                                                                newConditions[condIdx] = { ...cond, value: e.target.value };
                                                                                                const newBins = [...(level.textBins || [])];
                                                                                                newBins[binIdx] = { ...bin, conditions: newConditions };
                                                                                                const newLevels = currentGroupLevels.map((l, i) =>
                                                                                                    i === idx ? { ...l, textBins: newBins } : l
                                                                                                );
                                                                                                updateConfig({ groupLevels: newLevels });
                                                                                            }}
                                                                                            className="flex-1 px-1 py-0.5 text-[10px] border rounded"
                                                                                            placeholder="匹配值"
                                                                                        />
                                                                                        <button
                                                                                            onClick={() => {
                                                                                                const newConditions = (bin.conditions || []).filter((_, i) => i !== condIdx);
                                                                                                const newBins = [...(level.textBins || [])];
                                                                                                newBins[binIdx] = { ...bin, conditions: newConditions };
                                                                                                const newLevels = currentGroupLevels.map((l, i) =>
                                                                                                    i === idx ? { ...l, textBins: newBins } : l
                                                                                                );
                                                                                                updateConfig({ groupLevels: newLevels });
                                                                                            }}
                                                                                            className="text-red-300 hover:text-red-500"
                                                                                        >
                                                                                            <X size={8} />
                                                                                        </button>
                                                                                    </div>
                                                                                ))}
                                                                            </div>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            {level.type === 'numeric' && (
                                                                <div className="space-y-2">
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-[9px] font-medium text-slate-600">数值范围</span>
                                                                        <button
                                                                            onClick={() => {
                                                                                const newBin = { id: `bin-${Date.now()}`, min: 0, max: 100, label: '' };
                                                                                const newLevels = currentGroupLevels.map((l, i) =>
                                                                                    i === idx ? { ...l, numericBins: [...(l.numericBins || []), newBin] } : l
                                                                                );
                                                                                updateConfig({ groupLevels: newLevels });
                                                                            }}
                                                                            className="text-[9px] text-amber-600"
                                                                        >
                                                                            + 添加范围
                                                                        </button>
                                                                    </div>
                                                                    {(level.numericBins || []).map((bin, binIdx) => (
                                                                        <div key={bin.id} className="flex items-center gap-1">
                                                                            <input type="number" value={bin.min} onChange={e => {
                                                                                const newBins = [...(level.numericBins || [])];
                                                                                newBins[binIdx] = { ...bin, min: parseFloat(e.target.value) || 0 };
                                                                                const newLevels = currentGroupLevels.map((l, i) => i === idx ? { ...l, numericBins: newBins } : l);
                                                                                updateConfig({ groupLevels: newLevels });
                                                                            }} className="w-16 px-1 py-0.5 text-[10px] border rounded" placeholder="最小" />
                                                                            <span className="text-[9px]">~</span>
                                                                            <input type="number" value={bin.max} onChange={e => {
                                                                                const newBins = [...(level.numericBins || [])];
                                                                                newBins[binIdx] = { ...bin, max: parseFloat(e.target.value) || 0 };
                                                                                const newLevels = currentGroupLevels.map((l, i) => i === idx ? { ...l, numericBins: newBins } : l);
                                                                                updateConfig({ groupLevels: newLevels });
                                                                            }} className="w-16 px-1 py-0.5 text-[10px] border rounded" placeholder="最大" />
                                                                            <input type="text" value={bin.label} onChange={e => {
                                                                                const newBins = [...(level.numericBins || [])];
                                                                                newBins[binIdx] = { ...bin, label: e.target.value };
                                                                                const newLevels = currentGroupLevels.map((l, i) => i === idx ? { ...l, numericBins: newBins } : l);
                                                                                updateConfig({ groupLevels: newLevels });
                                                                            }} className="flex-1 px-1 py-0.5 text-[10px] border rounded" placeholder="标签" />
                                                                            <button onClick={() => {
                                                                                const newBins = (level.numericBins || []).filter((_, i) => i !== binIdx);
                                                                                const newLevels = currentGroupLevels.map((l, i) => i === idx ? { ...l, numericBins: newBins } : l);
                                                                                updateConfig({ groupLevels: newLevels });
                                                                            }} className="text-red-400 hover:text-red-600"><X size={10} /></button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}

                                                            {level.type === 'date' && (
                                                                <div className="space-y-2">
                                                                    <div className="flex items-center justify-between">
                                                                        <span className="text-[9px] font-medium text-slate-600">日期范围</span>
                                                                        <button
                                                                            onClick={() => {
                                                                                const today = new Date().toISOString().slice(0, 10);
                                                                                const newBin = { id: `bin-${Date.now()}`, startDate: today, endDate: today, label: '' };
                                                                                const newLevels = currentGroupLevels.map((l, i) =>
                                                                                    i === idx ? { ...l, dateBins: [...(l.dateBins || []), newBin] } : l
                                                                                );
                                                                                updateConfig({ groupLevels: newLevels });
                                                                            }}
                                                                            className="text-[9px] text-blue-600"
                                                                        >
                                                                            + 添加范围
                                                                        </button>
                                                                    </div>
                                                                    {(level.dateBins || []).map((bin, binIdx) => (
                                                                        <div key={bin.id} className="flex items-center gap-1">
                                                                            <input type="date" value={bin.startDate} onChange={e => {
                                                                                const newBins = [...(level.dateBins || [])];
                                                                                newBins[binIdx] = { ...bin, startDate: e.target.value };
                                                                                const newLevels = currentGroupLevels.map((l, i) => i === idx ? { ...l, dateBins: newBins } : l);
                                                                                updateConfig({ groupLevels: newLevels });
                                                                            }} className="px-1 py-0.5 text-[10px] border rounded" />
                                                                            <span className="text-[9px]">~</span>
                                                                            <input type="date" value={bin.endDate} onChange={e => {
                                                                                const newBins = [...(level.dateBins || [])];
                                                                                newBins[binIdx] = { ...bin, endDate: e.target.value };
                                                                                const newLevels = currentGroupLevels.map((l, i) => i === idx ? { ...l, dateBins: newBins } : l);
                                                                                updateConfig({ groupLevels: newLevels });
                                                                            }} className="px-1 py-0.5 text-[10px] border rounded" />
                                                                            <input type="text" value={bin.label} onChange={e => {
                                                                                const newBins = [...(level.dateBins || [])];
                                                                                newBins[binIdx] = { ...bin, label: e.target.value };
                                                                                const newLevels = currentGroupLevels.map((l, i) => i === idx ? { ...l, dateBins: newBins } : l);
                                                                                updateConfig({ groupLevels: newLevels });
                                                                            }} className="flex-1 px-1 py-0.5 text-[10px] border rounded" placeholder="标签" />
                                                                            <button onClick={() => {
                                                                                const newBins = (level.dateBins || []).filter((_, i) => i !== binIdx);
                                                                                const newLevels = currentGroupLevels.map((l, i) => i === idx ? { ...l, dateBins: newBins } : l);
                                                                                updateConfig({ groupLevels: newLevels });
                                                                            }} className="text-red-400 hover:text-red-600"><X size={10} /></button>
                                                                        </div>
                                                                    ))}
                                                                </div>
                                                            )}
                                                        </div>

                                                        {/* 添加子层级按钮 - 仅在最后一级显示 */}
                                                        {isLast && (
                                                            <div className="px-2 py-1.5 bg-slate-50 border-t border-slate-100">
                                                                <button
                                                                    onClick={() => {
                                                                        const newLevel: GroupLevel = { id: `level-${Date.now()}`, column: '', type: 'text' };
                                                                        updateConfig({ groupLevels: [...currentGroupLevels, newLevel] });
                                                                    }}
                                                                    className="w-full text-[9px] py-1 px-2 bg-indigo-100 text-indigo-700 rounded hover:bg-indigo-200 flex items-center justify-center gap-1"
                                                                >
                                                                    <span>└─</span> + 添加子层级（嵌套在此级内）
                                                                </button>
                                                            </div>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                </div>
                            )}

                            {/* 数值范围分组 */}
                            <div className="p-2 bg-indigo-50 rounded-lg border border-indigo-200">
                                <label className="flex items-center gap-2 text-[11px] font-medium text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={config.groupBinning}
                                        onChange={e => updateConfig({ groupBinning: e.target.checked })}
                                        className="rounded w-3.5 h-3.5"
                                    />
                                    按数值范围分组
                                </label>
                                {config.groupBinning && (
                                    <div className="mt-2 space-y-1">
                                        {config.groupBins.map((bin, idx) => (
                                            <div key={bin.id} className="flex items-center gap-1">
                                                <input
                                                    type="text"
                                                    value={bin.label}
                                                    onChange={e => {
                                                        const newBins = [...config.groupBins];
                                                        newBins[idx] = { ...bin, label: e.target.value };
                                                        updateConfig({ groupBins: newBins });
                                                    }}
                                                    placeholder="标签"
                                                    className="w-24 px-1.5 py-1 text-[10px] border border-slate-200 rounded"
                                                />
                                                <input
                                                    type="number"
                                                    value={bin.min ?? ''}
                                                    onChange={e => {
                                                        const newBins = [...config.groupBins];
                                                        newBins[idx] = { ...bin, min: e.target.value ? Number(e.target.value) : null };
                                                        updateConfig({ groupBins: newBins });
                                                    }}
                                                    placeholder="最小"
                                                    className="w-20 px-1.5 py-1 text-[10px] border border-slate-200 rounded"
                                                />
                                                <span className="text-slate-400 text-[10px]">~</span>
                                                <input
                                                    type="number"
                                                    value={bin.max ?? ''}
                                                    onChange={e => {
                                                        const newBins = [...config.groupBins];
                                                        newBins[idx] = { ...bin, max: e.target.value ? Number(e.target.value) : null };
                                                        updateConfig({ groupBins: newBins });
                                                    }}
                                                    placeholder="最大"
                                                    className="w-20 px-1.5 py-1 text-[10px] border border-slate-200 rounded"
                                                />
                                                <button
                                                    onClick={() => updateConfig({
                                                        groupBins: config.groupBins.filter(b => b.id !== bin.id)
                                                    })}
                                                    className="p-0.5 text-red-400 hover:text-red-600"
                                                >
                                                    <X size={12} />
                                                </button>
                                            </div>
                                        ))}
                                        <button
                                            onClick={() => updateConfig({
                                                groupBins: [...config.groupBins, {
                                                    id: Date.now().toString(),
                                                    label: `区间${config.groupBins.length + 1}`,
                                                    min: null,
                                                    max: null
                                                }]
                                            })}
                                            className="text-[10px] text-indigo-600 hover:text-indigo-700 flex items-center gap-0.5"
                                        >
                                            <Plus size={10} /> 添加区间
                                        </button>
                                    </div>
                                )}
                            </div>

                            {/* 文本分组 */}
                            <div className="p-2 bg-slate-50 rounded-lg border border-slate-200">
                                <label className="flex items-center gap-2 text-xs font-medium text-slate-700">
                                    <input
                                        type="checkbox"
                                        checked={config.textGrouping}
                                        onChange={e => updateConfig({ textGrouping: e.target.checked })}
                                        className="rounded"
                                    />
                                    按文本值分组
                                </label>
                                {config.textGrouping && (() => {
                                    // Get unique values from the group column
                                    const uniqueValues = config.groupColumn ? Array.from(new Set(
                                        data.rows.map(r => String(r[config.groupColumn] || '').trim()).filter(v => v)
                                    )).sort() : [];
                                    // Get values already assigned to groups
                                    const assignedValues = new Set(config.textGroupBins.flatMap(g => g.values));
                                    // Unassigned values
                                    const unassignedValues = uniqueValues.filter(v => !assignedValues.has(v));

                                    return (
                                        <div className="mt-2 space-y-2">
                                            <div className="flex justify-between items-center">
                                                <span className="text-[10px] font-medium text-purple-700">文本分组设置</span>
                                            </div>

                                            {/* Unique Values List */}
                                            {config.groupColumn && (
                                                <div className="bg-white rounded border border-purple-100 p-2">
                                                    <div className="flex items-center justify-between mb-2">
                                                        <span className="text-[9px] font-medium text-slate-600">
                                                            待分组的值 ({unassignedValues.length}/{uniqueValues.length})
                                                        </span>
                                                        <div className="flex gap-1">
                                                            <button
                                                                onClick={() => setTextGroupSelection(new Set(unassignedValues))}
                                                                className="text-[8px] px-1 py-0.5 text-purple-600 hover:bg-purple-50 rounded"
                                                            >
                                                                全选
                                                            </button>
                                                            <button
                                                                onClick={() => {
                                                                    const inverted = new Set(unassignedValues.filter(v => !textGroupSelection.has(v)));
                                                                    setTextGroupSelection(inverted);
                                                                }}
                                                                className="text-[8px] px-1 py-0.5 text-purple-600 hover:bg-purple-50 rounded"
                                                            >
                                                                反选
                                                            </button>
                                                            <button
                                                                onClick={() => setTextGroupSelection(new Set())}
                                                                className="text-[8px] px-1 py-0.5 text-purple-600 hover:bg-purple-50 rounded"
                                                            >
                                                                清空
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <div className="flex flex-wrap gap-1 max-h-24 overflow-y-auto">
                                                        {unassignedValues.length === 0 ? (
                                                            <span className="text-[9px] text-slate-400 italic">所有值均已分组</span>
                                                        ) : unassignedValues.map(val => (
                                                            <button
                                                                key={val}
                                                                onClick={() => {
                                                                    setTextGroupSelection(prev => {
                                                                        const next = new Set(prev);
                                                                        if (next.has(val)) next.delete(val);
                                                                        else next.add(val);
                                                                        return next;
                                                                    });
                                                                }}
                                                                className={`px-1.5 py-0.5 text-[9px] rounded border transition-colors ${textGroupSelection.has(val)
                                                                    ? 'bg-purple-500 text-white border-purple-500'
                                                                    : 'bg-white text-slate-700 border-slate-200 hover:border-purple-300'
                                                                    }`}
                                                            >
                                                                {val}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Assign to Group */}
                                            {textGroupSelection.size > 0 && config.textGroupBins.length > 0 && (
                                                <div className="bg-purple-100 rounded p-2">
                                                    <span className="text-[9px] text-purple-700 font-medium">
                                                        将选中的 {textGroupSelection.size} 个值添加到:
                                                    </span>
                                                    <div className="flex flex-wrap gap-1 mt-1">
                                                        {config.textGroupBins.map(group => (
                                                            <button
                                                                key={group.id}
                                                                onClick={() => {
                                                                    updateConfig({
                                                                        textGroupBins: config.textGroupBins.map(g =>
                                                                            g.id === group.id
                                                                                ? { ...g, values: [...new Set([...g.values, ...textGroupSelection])] }
                                                                                : g
                                                                        )
                                                                    });
                                                                    setTextGroupSelection(new Set());
                                                                }}
                                                                className="px-2 py-1 text-[9px] bg-purple-600 text-white rounded hover:bg-purple-700"
                                                            >
                                                                {group.label}
                                                            </button>
                                                        ))}
                                                    </div>
                                                </div>
                                            )}

                                            {/* Groups List */}
                                            <div className="space-y-2">
                                                {config.textGroupBins.map((group, groupIndex) => (
                                                    <div key={group.id} className="p-2 bg-white rounded border border-purple-100 space-y-1">
                                                        <div className="flex items-center gap-1">
                                                            {/* 排序按钮 */}
                                                            <div className="flex flex-col gap-0.5">
                                                                <button
                                                                    onClick={() => {
                                                                        if (groupIndex === 0) return;
                                                                        const newBins = [...config.textGroupBins];
                                                                        [newBins[groupIndex - 1], newBins[groupIndex]] = [newBins[groupIndex], newBins[groupIndex - 1]];
                                                                        updateConfig({ textGroupBins: newBins });
                                                                    }}
                                                                    disabled={groupIndex === 0}
                                                                    className={`p-0.5 rounded ${groupIndex === 0 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-purple-600 hover:bg-purple-50'}`}
                                                                    title="上移"
                                                                >
                                                                    <ChevronUp size={10} />
                                                                </button>
                                                                <button
                                                                    onClick={() => {
                                                                        if (groupIndex === config.textGroupBins.length - 1) return;
                                                                        const newBins = [...config.textGroupBins];
                                                                        [newBins[groupIndex], newBins[groupIndex + 1]] = [newBins[groupIndex + 1], newBins[groupIndex]];
                                                                        updateConfig({ textGroupBins: newBins });
                                                                    }}
                                                                    disabled={groupIndex === config.textGroupBins.length - 1}
                                                                    className={`p-0.5 rounded ${groupIndex === config.textGroupBins.length - 1 ? 'text-slate-300 cursor-not-allowed' : 'text-slate-500 hover:text-purple-600 hover:bg-purple-50'}`}
                                                                    title="下移"
                                                                >
                                                                    <ChevronDown size={10} />
                                                                </button>
                                                            </div>
                                                            <span className="text-[9px] text-slate-400 font-mono w-4">{groupIndex + 1}</span>
                                                            <input
                                                                value={group.label}
                                                                onChange={(e) => updateConfig({
                                                                    textGroupBins: config.textGroupBins.map(g =>
                                                                        g.id === group.id ? { ...g, label: e.target.value } : g
                                                                    )
                                                                })}
                                                                className="flex-1 px-2 py-1 border rounded text-[11px] font-medium"
                                                                placeholder="分组名称"
                                                            />
                                                            <span className="text-[9px] text-slate-400">({group.values.length + (group.conditions?.length || 0)})</span>
                                                            <button
                                                                onClick={() => updateConfig({
                                                                    textGroupBins: config.textGroupBins.filter(g => g.id !== group.id)
                                                                })}
                                                                className="text-red-400 hover:text-red-600 p-1"
                                                                title="删除分组"
                                                            >
                                                                <X size={12} />
                                                            </button>
                                                        </div>

                                                        {/* Conditions Editor - 条件匹配 */}
                                                        <div className="space-y-1 bg-blue-50 rounded p-1.5 border border-blue-100">
                                                            <div className="flex items-center justify-between">
                                                                <span className="text-[9px] text-blue-600 font-medium">📐 匹配条件</span>
                                                                <button
                                                                    onClick={() => updateConfig({
                                                                        textGroupBins: config.textGroupBins.map(g =>
                                                                            g.id === group.id
                                                                                ? { ...g, conditions: [...(g.conditions || []), { id: Date.now().toString(), operator: 'contains' as TextGroupCondition['operator'], value: '' }] }
                                                                                : g
                                                                        )
                                                                    })}
                                                                    className="text-[8px] px-1.5 py-0.5 bg-blue-100 text-blue-600 rounded hover:bg-blue-200"
                                                                >
                                                                    + 添加条件
                                                                </button>
                                                            </div>
                                                            <input
                                                                type="text"
                                                                placeholder="批量粘贴条件（表格多单元格）"
                                                                onPaste={(e) => {
                                                                    const text = e.clipboardData.getData('text');
                                                                    const items = text
                                                                        .split(/\r?\n/)
                                                                        .flatMap(row => row.split('\t'))
                                                                        .map(val => val.trim())
                                                                        .filter(Boolean);
                                                                    if (items.length === 0) return;
                                                                    e.preventDefault();
                                                                    updateConfig({
                                                                        textGroupBins: config.textGroupBins.map(g => {
                                                                            if (g.id !== group.id) return g;
                                                                            const existing = new Set((g.conditions || []).map(c => `${c.operator}::${c.value}`));
                                                                            const newConditions = items
                                                                                .filter(val => !existing.has(`${pasteConditionOperator}::${val}`))
                                                                                .map(val => ({
                                                                                    id: `${Date.now()}-${Math.random().toString(16).slice(2, 8)}`,
                                                                                    operator: pasteConditionOperator,
                                                                                    value: val
                                                                                }));
                                                                            return {
                                                                                ...g,
                                                                                conditions: [...(g.conditions || []), ...newConditions]
                                                                            };
                                                                        })
                                                                    });
                                                                }}
                                                                className="w-full px-2 py-1 border border-blue-200 rounded text-[9px] bg-white"
                                                            />
                                                            <div className="flex items-center gap-1">
                                                                <span className="text-[9px] text-slate-500">批量条件类型</span>
                                                                <select
                                                                    value={pasteConditionOperator}
                                                                    onChange={(e) => setPasteConditionOperator(e.target.value as TextGroupCondition['operator'])}
                                                                    className="px-1 py-0.5 border border-blue-200 rounded text-[9px] bg-white"
                                                                >
                                                                    <optgroup label="文本">
                                                                        <option value="contains">包含</option>
                                                                        <option value="equals">等于</option>
                                                                        <option value="startsWith">开头是</option>
                                                                        <option value="endsWith">结尾是</option>
                                                                    </optgroup>
                                                                    <optgroup label="数字">
                                                                        <option value="greaterThan">大于 &gt;</option>
                                                                        <option value="lessThan">小于 &lt;</option>
                                                                        <option value="greaterOrEqual">大于等于 ≥</option>
                                                                        <option value="lessOrEqual">小于等于 ≤</option>
                                                                        <option value="numEquals">数字等于 =</option>
                                                                    </optgroup>
                                                                </select>
                                                            </div>
                                                            {(group.conditions || []).map((cond, condIdx) => (
                                                                <div key={cond.id} className="flex items-center gap-1">
                                                                    <select
                                                                        value={cond.operator}
                                                                        onChange={(e) => updateConfig({
                                                                            textGroupBins: config.textGroupBins.map(g =>
                                                                                g.id === group.id
                                                                                    ? {
                                                                                        ...g, conditions: (g.conditions || []).map((c, i) =>
                                                                                            i === condIdx ? { ...c, operator: e.target.value as TextGroupCondition['operator'] } : c
                                                                                        )
                                                                                    }
                                                                                    : g
                                                                            )
                                                                        })}
                                                                        className="px-1 py-0.5 border border-blue-200 rounded text-[9px] bg-white"
                                                                    >
                                                                        <optgroup label="文本">
                                                                            <option value="contains">包含</option>
                                                                            <option value="equals">等于</option>
                                                                            <option value="startsWith">开头是</option>
                                                                            <option value="endsWith">结尾是</option>
                                                                        </optgroup>
                                                                        <optgroup label="数字">
                                                                            <option value="greaterThan">大于 &gt;</option>
                                                                            <option value="lessThan">小于 &lt;</option>
                                                                            <option value="greaterOrEqual">大于等于 ≥</option>
                                                                            <option value="lessOrEqual">小于等于 ≤</option>
                                                                            <option value="numEquals">数字等于 =</option>
                                                                        </optgroup>
                                                                    </select>
                                                                    <input
                                                                        value={cond.value}
                                                                        onChange={(e) => updateConfig({
                                                                            textGroupBins: config.textGroupBins.map(g =>
                                                                                g.id === group.id
                                                                                    ? {
                                                                                        ...g, conditions: (g.conditions || []).map((c, i) =>
                                                                                            i === condIdx ? { ...c, value: e.target.value } : c
                                                                                        )
                                                                                    }
                                                                                    : g
                                                                            )
                                                                        })}
                                                                        className="flex-1 px-1.5 py-0.5 border border-blue-200 rounded text-[9px] bg-white min-w-0"
                                                                        placeholder={cond.operator.includes('Than') || cond.operator.includes('Equal') || cond.operator === 'numEquals' ? '数字' : '文本'}
                                                                    />
                                                                    <button
                                                                        onClick={() => updateConfig({
                                                                            textGroupBins: config.textGroupBins.map(g =>
                                                                                g.id === group.id
                                                                                    ? { ...g, conditions: (g.conditions || []).filter((_, i) => i !== condIdx) }
                                                                                    : g
                                                                            )
                                                                        })}
                                                                        className="text-red-400 hover:text-red-600 shrink-0"
                                                                    >
                                                                        <X size={10} />
                                                                    </button>
                                                                </div>
                                                            ))}
                                                            {(!group.conditions || group.conditions.length === 0) && (
                                                                <div className="text-[8px] text-slate-400 italic">点击"添加条件"设置匹配规则（如：包含"美食"或大于1000）</div>
                                                            )}
                                                        </div>

                                                        {/* Exact Values */}
                                                        <div className="flex flex-wrap gap-1">
                                                            {group.values.map(val => (
                                                                <span
                                                                    key={val}
                                                                    className="px-1.5 py-0.5 text-[9px] bg-purple-100 text-purple-700 rounded flex items-center gap-0.5"
                                                                >
                                                                    {val}
                                                                    <button
                                                                        onClick={() => updateConfig({
                                                                            textGroupBins: config.textGroupBins.map(g =>
                                                                                g.id === group.id
                                                                                    ? { ...g, values: g.values.filter(v => v !== val) }
                                                                                    : g
                                                                            )
                                                                        })}
                                                                        className="text-purple-400 hover:text-purple-600"
                                                                    >
                                                                        <X size={8} />
                                                                    </button>
                                                                </span>
                                                            ))}
                                                            {group.values.length === 0 && (!group.conditions || group.conditions.length === 0) && (
                                                                <span className="text-[8px] text-slate-400 italic">添加条件或从上方选择值</span>
                                                            )}
                                                        </div>
                                                    </div>
                                                ))}
                                            </div>

                                            {/* 新建分组按钮 */}
                                            <button
                                                onClick={() => updateConfig({
                                                    textGroupBins: [...config.textGroupBins, {
                                                        id: Date.now().toString(),
                                                        label: `分组${config.textGroupBins.length + 1}`,
                                                        values: []
                                                    }]
                                                })}
                                                className="w-full text-[10px] py-1.5 px-2 border-2 border-dashed border-purple-200 text-purple-600 rounded-lg hover:border-purple-400 hover:bg-purple-50 transition-colors flex items-center justify-center gap-1"
                                            >
                                                <Plus size={12} /> 新建分组
                                            </button>

                                            {/* Clear All */}
                                            {config.textGroupBins.length > 0 && (
                                                <button
                                                    onClick={() => updateConfig({ textGroupBins: [] })}
                                                    className="text-[9px] text-red-500 hover:text-red-600"
                                                >
                                                    清空所有分组
                                                </button>
                                            )}
                                        </div>
                                    );
                                })()}
                            </div>

                            {/* 关键词合并分组 */}
                            <div>
                                <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 bg-slate-100 border border-slate-200 rounded px-2 py-0.5 mb-1">
                                    <span className="inline-block w-1.5 h-3 rounded-sm bg-emerald-500" />
                                    关键词合并分组
                                </label>
                                <DebouncedTextarea
                                    value={config.fuzzyRuleText || ''}
                                    onChange={(newValue) => updateConfig({ fuzzyRuleText: newValue })}
                                    placeholder="格式: 目标分组=关键词1|关键词2;目标分组2=关键词3"
                                    className="w-full px-2.5 py-2 text-xs bg-white text-slate-900 border border-slate-200 rounded-lg focus:ring-2 focus:ring-emerald-400 h-14 resize-none placeholder:text-slate-400"
                                    debounceMs={500}
                                />

                                <p className="text-[9px] text-slate-400 mt-0.5">
                                    例：服饰=衣服|衣物;家居=生活|日用
                                </p>
                            </div>
                            <div>
                                <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 bg-slate-100 border border-slate-200 rounded px-2 py-0.5 mb-1">
                                    <span className="inline-block w-1.5 h-3 rounded-sm bg-sky-500" />
                                    日期列
                                </label>
                                <select
                                    value={config.dateColumn}
                                    onChange={e => updateConfig({ dateColumn: e.target.value })}
                                    className="w-full px-2 py-1.5 text-xs bg-white text-slate-800 border border-slate-200 rounded"
                                >
                                    <option value="">选择日期列...</option>
                                    {data.columns.map(col => (
                                        <option key={col} value={col}>{col}</option>
                                    ))}
                                </select>

                                {config.dateColumn && (
                                    <div className="mt-2">
                                        <label className="flex items-center gap-2 cursor-pointer select-none">
                                            <input
                                                type="checkbox"
                                                checked={config.dateBinning}
                                                onChange={(e) => updateConfig({ dateBinning: e.target.checked })}
                                                className="rounded text-green-600 focus:ring-green-500 w-3 h-3"
                                            />
                                            <span className="text-[10px] text-slate-600">按日期范围分组</span>
                                        </label>

                                        {config.dateBinning && (
                                            <div className="mt-2 p-2 bg-green-50 rounded border border-green-100 space-y-2">
                                                <div className="flex justify-between items-center">
                                                    <span className="text-[10px] font-medium text-green-700">日期分段设置</span>
                                                    <button
                                                        onClick={() => {
                                                            const today = new Date();
                                                            const todayStr = today.toISOString().slice(0, 10);
                                                            const label = `${today.getMonth() + 1}/${today.getDate()}`;
                                                            updateConfig({
                                                                dateBins: [...config.dateBins, {
                                                                    id: Date.now().toString(),
                                                                    label,
                                                                    startDate: todayStr,
                                                                    endDate: todayStr
                                                                }]
                                                            });
                                                        }}
                                                        className="text-[10px] text-green-600 hover:text-green-700 flex items-center gap-0.5"
                                                    >
                                                        <Plus size={10} /> 添加
                                                    </button>
                                                </div>
                                                {config.dateBins.map((bin, idx) => (
                                                    <div key={bin.id} className="flex flex-wrap items-center gap-2 bg-white p-2 rounded">
                                                        <input
                                                            type="text"
                                                            value={bin.label}
                                                            onChange={e => {
                                                                const newBins = [...config.dateBins];
                                                                newBins[idx] = { ...bin, label: e.target.value };
                                                                updateConfig({ dateBins: newBins });
                                                            }}
                                                            placeholder="标签"
                                                            className="w-20 px-2 py-1 text-[11px] border border-slate-200 rounded"
                                                        />
                                                        <input
                                                            type="date"
                                                            value={bin.startDate}
                                                            onChange={e => {
                                                                const newBins = [...config.dateBins];
                                                                newBins[idx] = { ...bin, startDate: e.target.value };
                                                                updateConfig({ dateBins: newBins });
                                                            }}
                                                            className="min-w-[120px] px-2 py-1 text-[11px] border border-slate-200 rounded"
                                                        />
                                                        <span className="text-slate-400 text-[10px]">~</span>
                                                        <input
                                                            type="date"
                                                            value={bin.endDate}
                                                            onChange={e => {
                                                                const newBins = [...config.dateBins];
                                                                newBins[idx] = { ...bin, endDate: e.target.value };
                                                                updateConfig({ dateBins: newBins });
                                                            }}
                                                            className="min-w-[120px] px-2 py-1 text-[11px] border border-slate-200 rounded"
                                                        />
                                                        <button
                                                            onClick={() => updateConfig({
                                                                dateBins: config.dateBins.filter(b => b.id !== bin.id)
                                                            })}
                                                            className="p-0.5 text-red-400 hover:text-red-600"
                                                        >
                                                            <X size={10} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}


                    {/* === 显示列设置 === */}
                    {activeTab === 'display' && (
                        <div className="space-y-2">
                            {/* 列选择器 */}
                            <div className="p-2 bg-purple-50 rounded-lg border border-purple-200 space-y-2">
                                <div className="grid grid-cols-3 gap-2">
                                    <div>
                                        <label className="block text-[10px] text-purple-700 mb-0.5">图片列</label>
                                        <select
                                            value={config.imageColumn}
                                            onChange={e => updateConfig({ imageColumn: e.target.value })}
                                            className="w-full px-1.5 py-1 text-[11px] text-slate-800 bg-white border border-slate-200 rounded"
                                        >
                                            <option value="">选择...</option>
                                            {data.columns.map(col => (
                                                <option key={col} value={col}>{col}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] text-purple-700 mb-0.5">链接列</label>
                                        <select
                                            value={config.linkColumn}
                                            onChange={e => updateConfig({ linkColumn: e.target.value })}
                                            className="w-full px-1.5 py-1 text-[11px] text-slate-800 bg-white border border-slate-200 rounded"
                                        >
                                            <option value="">选择...</option>
                                            {data.columns.map(col => (
                                                <option key={col} value={col}>{col}</option>
                                            ))}
                                        </select>
                                    </div>
                                    <div>
                                        <label className="block text-[10px] text-purple-700 mb-0.5">账号列</label>
                                        <select
                                            value={config.accountColumn}
                                            onChange={e => updateConfig({ accountColumn: e.target.value })}
                                            className="w-full px-1.5 py-1 text-[11px] text-slate-800 bg-white border border-slate-200 rounded"
                                        >
                                            <option value="">选择...</option>
                                            {data.columns.map(col => (
                                                <option key={col} value={col}>{col}</option>
                                            ))}
                                        </select>
                                    </div>
                                </div>
                            </div>

                            {/* 显示信息列 */}
                            <div className="p-2 bg-purple-50 rounded-lg border border-purple-200">
                                <label className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-800 mb-1.5">
                                    <span className="inline-block w-1.5 h-3 rounded-sm bg-purple-500" />
                                    显示信息列
                                </label>
                                <div className="max-h-32 overflow-y-auto p-1.5 bg-white rounded border border-slate-200">
                                    <div className="flex flex-wrap gap-1">
                                        {data.columns.map(col => (
                                            <label
                                                key={col}
                                                className={`px-2 py-1 text-xs rounded-lg cursor-pointer transition-all ${config.displayColumns.includes(col)
                                                    ? 'bg-purple-500 text-white'
                                                    : 'bg-slate-100 text-slate-600 hover:bg-purple-100'
                                                    }`}
                                                onClick={() => {
                                                    if (config.displayColumns.includes(col)) {
                                                        updateConfig({ displayColumns: config.displayColumns.filter(c => c !== col) });
                                                    } else {
                                                        updateConfig({ displayColumns: [...config.displayColumns, col] });
                                                    }
                                                }}
                                            >
                                                {col.length > 12 ? col.slice(0, 12) + '...' : col}
                                            </label>
                                        ))}
                                    </div>
                                </div>
                                <div className="flex justify-between mt-1.5">
                                    <button
                                        onClick={() => updateConfig({ displayColumns: data.columns })}
                                        className="text-[10px] text-purple-600 hover:text-purple-700"
                                    >全选</button>
                                    <span className="text-[10px] text-slate-400">已选 {config.displayColumns.length}/{data.columns.length}</span>
                                    <button
                                        onClick={() => updateConfig({ displayColumns: [] })}
                                        className="text-[10px] text-red-500 hover:text-red-600"
                                    >清空</button>
                                </div>
                            </div>
                        </div>
                    )}

                    {/* === 筛选设置 === */}
                    {activeTab === 'filter' && (
                        <div className="space-y-2">
                            <div className="flex items-center justify-between px-2 py-1.5 bg-blue-50 border border-blue-200 rounded-lg">
                                <span className="text-xs font-semibold text-blue-700">筛选开关</span>
                                <div className="flex items-center gap-2">
                                    <span className="text-[10px] text-blue-600">{filtersEnabled ? '已启用' : '已暂停'}</span>
                                    <button
                                        onClick={() => updateConfig({ filtersEnabled: !filtersEnabled })}
                                        className={`relative w-9 h-5 rounded-full transition-colors ${filtersEnabled ? 'bg-blue-500' : 'bg-slate-300'}`}
                                        title={filtersEnabled ? '点击暂停筛选' : '点击启用筛选'}
                                    >
                                        <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${filtersEnabled ? 'left-4' : 'left-0.5'}`} />
                                    </button>
                                </div>
                            </div>
                            {/* 快捷筛选按钮 */}
                            <div className="flex flex-wrap gap-1">
                                <button
                                    onClick={() => {
                                        const typeCol = data.columns.find(c => c.includes('类型') || c.includes('Type'));
                                        updateConfig({
                                            customFilters: [...config.customFilters, {
                                                id: Date.now().toString(), column: typeCol || '', operator: 'multiSelect', value: '', selectedValues: []
                                            }]
                                        });
                                    }}
                                    className="px-2 py-1 text-[10px] bg-blue-50 hover:bg-blue-100 rounded border border-blue-200 text-blue-700"
                                ><FileText size={10} className="inline mr-1" /> 贴文类型</button>
                                <button
                                    onClick={() => {
                                        const numCol = data.columns.find(c => c.includes('点赞') || c.includes('播放') || c.includes('粉丝') || c.includes('贴文点赞量'));
                                        updateConfig({
                                            customFilters: [...config.customFilters, {
                                                id: Date.now().toString(), column: numCol || '', operator: 'greaterThan', value: '', selectedValues: []
                                            }]
                                        });
                                    }}
                                    className="px-2 py-1 text-[10px] bg-purple-50 hover:bg-purple-100 rounded border border-purple-200 text-purple-700"
                                ><Hash size={12} className="inline mr-1" /> 数字筛选</button>
                                {config.dateColumn && (
                                    <button
                                        onClick={() => {
                                            const today = new Date();
                                            const weekAgo = new Date(today);
                                            weekAgo.setDate(weekAgo.getDate() - 7);
                                            updateConfig({
                                                dateStart: weekAgo.toISOString().slice(0, 10),
                                                dateEnd: today.toISOString().slice(0, 10)
                                            });
                                        }}
                                        className={`px-2 py-1 text-[10px] rounded border ${config.dateStart || config.dateEnd
                                            ? 'bg-sky-500 text-white border-sky-600'
                                            : 'bg-sky-50 hover:bg-sky-100 border-sky-200 text-sky-700'
                                            }`}
                                    ><Calendar size={12} className="inline mr-1" /> 日期筛选{config.dateStart || config.dateEnd ? ' ✓' : ''}</button>
                                )}
                                <button
                                    onClick={() => updateConfig({
                                        customFilters: [...config.customFilters, {
                                            id: Date.now().toString(), column: '', operator: 'notEmpty', value: '', selectedValues: []
                                        }]
                                    })}
                                    className="px-2 py-1 text-[10px] bg-slate-50 hover:bg-slate-100 rounded border border-slate-200 text-slate-700"
                                ><CheckCircle size={10} className="inline mr-1" /> 非空</button>
                                {(config.customFilters.length > 0 || config.dateStart || config.dateEnd) && (
                                    <button
                                        onClick={() => updateConfig({ customFilters: [], dateStart: '', dateEnd: '' })}
                                        className="px-2 py-1 text-[10px] bg-red-50 hover:bg-red-100 rounded border border-red-200 text-red-500"
                                    >清除全部</button>
                                )}
                            </div>

                            {/* 日期筛选范围详情 */}
                            {config.dateColumn && (config.dateStart || config.dateEnd) && (
                                <div className="p-2 bg-sky-50 rounded-lg border border-sky-200">
                                    <div className="flex items-center gap-2">
                                        <Calendar size={10} className="text-sky-700" />
                                        <input
                                            type="date"
                                            value={config.dateStart}
                                            onChange={e => updateConfig({ dateStart: e.target.value })}
                                            className="flex-1 px-2 py-1 text-[10px] text-slate-800 border border-slate-200 rounded bg-white"
                                        />
                                        <span className="text-slate-500 text-[10px]">~</span>
                                        <input
                                            type="date"
                                            value={config.dateEnd}
                                            onChange={e => updateConfig({ dateEnd: e.target.value })}
                                            className="flex-1 px-2 py-1 text-[10px] text-slate-800 border border-slate-200 rounded bg-white"
                                        />
                                        <button
                                            onClick={() => updateConfig({ dateStart: '', dateEnd: '' })}
                                            className="p-0.5 text-red-400 hover:text-red-600"
                                        >
                                            <X size={12} />
                                        </button>
                                    </div>
                                </div>
                            )}

                            {/* 筛选条件列表 */}
                            {config.customFilters.map((cf, idx) => {
                                const uniqueValues = cf.column ? getUniqueValues(cf.column) : [];
                                const columnType = detectColumnType(cf.column);

                                return (
                                    <div key={cf.id} className="p-2 bg-blue-50 rounded-lg border border-blue-200 space-y-1.5">
                                        <div className="flex items-center justify-between">
                                            <span className="text-[10px] text-blue-600 font-medium">
                                                {cf.column ? (
                                                    <>
                                                        {cf.column.includes('类型') ? <><FileText size={10} className="inline mr-1" />贴文类型</> :
                                                            cf.column.includes('点赞') || cf.column.includes('播放') || cf.column.includes('粉丝') ? '数字筛选' :
                                                                cf.operator === 'notEmpty' || cf.operator === 'isEmpty' ? <><CheckCircle size={10} className="inline mr-1" />非空筛选</> :
                                                                    cf.column}
                                                        <span className="text-blue-400 ml-1">({columnType === 'number' ? '数字' : '文本'})</span>
                                                    </>
                                                ) : (
                                                    <>筛选 #{idx + 1}</>
                                                )}
                                            </span>
                                            <button
                                                onClick={() => updateConfig({
                                                    customFilters: config.customFilters.filter(f => f.id !== cf.id)
                                                })}
                                                className="p-0.5 hover:bg-blue-100 rounded"
                                            >
                                                <X size={12} className="text-blue-400" />
                                            </button>
                                        </div>

                                        {/* 列选择 */}
                                        <select
                                            value={cf.column}
                                            onChange={e => {
                                                const newCol = e.target.value;
                                                const newType = detectColumnType(newCol);
                                                const defaultOp = newType === 'number' ? 'greaterThan' : 'multiSelect';
                                                updateConfig({
                                                    customFilters: config.customFilters.map(f =>
                                                        f.id === cf.id ? { ...f, column: newCol, operator: defaultOp as CustomFilter['operator'], value: '', selectedValues: [] } : f
                                                    )
                                                });
                                            }}
                                            className="w-full px-1.5 py-1 text-[11px] text-slate-800 bg-white border border-slate-200 rounded"
                                        >
                                            <option value="">选择筛选列...</option>
                                            {data.columns.map(col => (
                                                <option key={col} value={col}>{col}</option>
                                            ))}
                                        </select>

                                        {/* 操作符 */}
                                        {cf.column && (
                                            <select
                                                value={cf.operator || 'contains'}
                                                onChange={e => updateConfig({
                                                    customFilters: config.customFilters.map(f =>
                                                        f.id === cf.id ? { ...f, operator: e.target.value as CustomFilter['operator'], value: '', selectedValues: [] } : f
                                                    )
                                                })}
                                                className="w-full px-1.5 py-1.5 text-[11px] text-slate-800 bg-white border border-slate-200 rounded"
                                            >
                                                <optgroup label="常用">
                                                    <option value="multiSelect">多选值</option>
                                                    <option value="notEmpty">非空</option>
                                                    <option value="isEmpty">为空</option>
                                                </optgroup>
                                                {columnType === 'number' ? (
                                                    <optgroup label="数值比较">
                                                        <option value="greaterThan">大于 &gt;</option>
                                                        <option value="lessThan">小于 &lt;</option>
                                                        <option value="greaterOrEqual">大于等于 ≥</option>
                                                        <option value="lessOrEqual">小于等于 ≤</option>
                                                        <option value="equals">等于 =</option>
                                                        <option value="notEquals">不等于 ≠</option>
                                                        <option value="between">区间范围</option>
                                                    </optgroup>
                                                ) : (
                                                    <optgroup label="文本匹配">
                                                        <option value="contains">包含</option>
                                                        <option value="notContains">不包含</option>
                                                        <option value="equals">等于</option>
                                                        <option value="notEquals">不等于</option>
                                                        <option value="startsWith">开头是</option>
                                                        <option value="endsWith">结尾是</option>
                                                        <option value="regex">正则表达式</option>
                                                    </optgroup>
                                                )}
                                            </select>
                                        )}

                                        {/* 值输入 */}
                                        {cf.column && cf.operator && !['notEmpty', 'isEmpty', 'multiSelect'].includes(cf.operator) && (
                                            <div className="flex items-center gap-1">
                                                <DebouncedInput
                                                    value={cf.value || ''}
                                                    onChange={(newValue) => updateConfig({
                                                        customFilters: config.customFilters.map(f =>
                                                            f.id === cf.id ? { ...f, value: newValue } : f
                                                        )
                                                    })}
                                                    placeholder={cf.operator === 'between' ? '最小值' : '输入值...'}
                                                    className="flex-1 px-2 py-1.5 text-[11px] rounded"
                                                    style={{ backgroundColor: '#fff', color: '#1e293b', border: '1px solid #93c5fd' }}
                                                    debounceMs={400}
                                                />

                                                {cf.operator === 'between' && (
                                                    <>
                                                        <span className="text-slate-400 text-[10px]">~</span>
                                                        <DebouncedInput
                                                            value={cf.value2 || ''}
                                                            onChange={(newValue) => updateConfig({
                                                                customFilters: config.customFilters.map(f =>
                                                                    f.id === cf.id ? { ...f, value2: newValue } : f
                                                                )
                                                            })}
                                                            placeholder="最大值"
                                                            className="flex-1 px-2 py-1.5 text-[11px] rounded"
                                                            style={{ backgroundColor: '#fff', color: '#1e293b', border: '1px solid #93c5fd' }}
                                                            debounceMs={400}
                                                        />

                                                    </>
                                                )}
                                            </div>
                                        )}

                                        {/* 多选值 */}
                                        {cf.column && cf.operator === 'multiSelect' && uniqueValues.length > 0 && (
                                            <div className="max-h-40 overflow-y-auto bg-white border border-slate-200 rounded p-1.5 flex flex-wrap gap-1">
                                                {uniqueValues.slice(0, 50).map(val => (
                                                    <label
                                                        key={val}
                                                        className={`px-1.5 py-0.5 text-[10px] rounded cursor-pointer transition-all ${(cf.selectedValues || []).includes(val)
                                                            ? 'bg-blue-500 text-white'
                                                            : 'bg-slate-100 text-slate-600 hover:bg-blue-100'
                                                            }`}
                                                        onClick={() => {
                                                            const currentValues = cf.selectedValues || [];
                                                            const newValues = currentValues.includes(val)
                                                                ? currentValues.filter(v => v !== val)
                                                                : [...currentValues, val];
                                                            updateConfig({
                                                                customFilters: config.customFilters.map(f =>
                                                                    f.id === cf.id ? { ...f, selectedValues: newValues } : f
                                                                )
                                                            });
                                                        }}
                                                    >
                                                        {val.length > 15 ? val.slice(0, 15) + '...' : val}
                                                    </label>
                                                ))}
                                                {uniqueValues.length > 50 && (
                                                    <span className="text-[9px] text-slate-400">+{uniqueValues.length - 50}更多</span>
                                                )}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}


                            <button
                                onClick={() => updateConfig({
                                    customFilters: [...config.customFilters, {
                                        id: Date.now().toString(),
                                        column: '',
                                        operator: 'contains',
                                        value: '',
                                        selectedValues: []
                                    }]
                                })}
                                className="w-full py-1.5 text-xs text-blue-600 bg-blue-50 hover:bg-blue-100 rounded-lg border border-dashed border-blue-300 flex items-center justify-center gap-1"
                            >
                                <Plus size={12} /> 添加筛选条件
                            </button>

                            {/* === 数字筛选 === */}
                            <div className="border-t border-slate-200 pt-3 mt-3">
                                <div className="text-xs font-semibold text-slate-700 mb-2 flex items-center gap-1"><Hash size={12} /> 数字筛选 ({config.numFilters.length})</div>
                                <div className="space-y-2">
                                    {config.numFilters.map((filter, idx) => (
                                        <div key={filter.id} className="bg-emerald-50 rounded p-2 space-y-1.5">
                                            <div className="flex items-center gap-1">
                                                <select
                                                    value={filter.column}
                                                    onChange={e => {
                                                        const newFilters = [...config.numFilters];
                                                        newFilters[idx] = { ...filter, column: e.target.value };
                                                        updateConfig({ numFilters: newFilters });
                                                    }}
                                                    className="flex-1 px-1.5 py-1 text-[10px] bg-white text-slate-800 border border-slate-200 rounded"
                                                >
                                                    <option value="">选择列...</option>
                                                    {data.columns.map(col => (
                                                        <option key={col} value={col}>{col}</option>
                                                    ))}
                                                </select>
                                                <button
                                                    onClick={() => updateConfig({
                                                        numFilters: config.numFilters.filter(f => f.id !== filter.id)
                                                    })}
                                                    className="p-1 text-red-400 hover:text-red-600 hover:bg-red-50 rounded"
                                                >
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                            <div className="flex items-center gap-1">
                                                <select
                                                    value={filter.operator}
                                                    onChange={e => {
                                                        const newFilters = [...config.numFilters];
                                                        newFilters[idx] = { ...filter, operator: e.target.value as NumFilter['operator'] };
                                                        updateConfig({ numFilters: newFilters });
                                                    }}
                                                    className="flex-1 px-1.5 py-1 text-[10px] bg-white text-slate-800 border border-slate-200 rounded"
                                                >
                                                    <option value="greaterThan">大于 &gt;</option>
                                                    <option value="lessThan">小于 &lt;</option>
                                                    <option value="greaterOrEqual">大于等于 ≥</option>
                                                    <option value="lessOrEqual">小于等于 ≤</option>
                                                    <option value="equals">等于 =</option>
                                                    <option value="notEquals">不等于 ≠</option>
                                                    <option value="between">区间</option>
                                                    <option value="notEmpty">非空</option>
                                                    <option value="isEmpty">为空</option>
                                                </select>
                                                {!['notEmpty', 'isEmpty'].includes(filter.operator) && (
                                                    <DebouncedInput
                                                        value={filter.value}
                                                        onChange={(newValue) => {
                                                            const newFilters = [...config.numFilters];
                                                            newFilters[idx] = { ...filter, value: newValue };
                                                            updateConfig({ numFilters: newFilters });
                                                        }}
                                                        placeholder={filter.operator === 'between' ? '最小值' : '数值'}
                                                        className="w-16 px-1.5 py-1 text-[10px] bg-white text-slate-800 border border-slate-200 rounded"
                                                        debounceMs={400}
                                                    />
                                                )}
                                                {filter.operator === 'between' && (
                                                    <DebouncedInput
                                                        value={filter.value2 || ''}
                                                        onChange={(newValue) => {
                                                            const newFilters = [...config.numFilters];
                                                            newFilters[idx] = { ...filter, value2: newValue };
                                                            updateConfig({ numFilters: newFilters });
                                                        }}
                                                        placeholder="最大值"
                                                        className="w-16 px-1.5 py-1 text-[10px] bg-white text-slate-800 border border-slate-200 rounded"
                                                        debounceMs={400}
                                                    />
                                                )}
                                            </div>
                                        </div>
                                    ))}
                                    <button
                                        onClick={() => updateConfig({
                                            numFilters: [...config.numFilters, {
                                                id: Date.now().toString(),
                                                column: '',
                                                operator: 'greaterThan',
                                                value: ''
                                            }]
                                        })}
                                        className="w-full py-1 text-[10px] text-emerald-600 hover:text-emerald-700 hover:bg-emerald-100 rounded border border-dashed border-emerald-200 flex items-center justify-center gap-1"
                                    >
                                        <Plus size={10} /> 添加数字筛选
                                    </button>
                                </div>
                            </div>
                        </div>
                    )
                    }

                    {/* === 排序设置 === */}
                    {
                        activeTab === 'sort' && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between px-2 py-1.5 bg-orange-50 border border-orange-200 rounded-lg">
                                    <span className="text-xs font-semibold text-orange-700">排序开关</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-orange-600">{sortEnabled ? '已启用' : '已暂停'}</span>
                                        <button
                                            onClick={() => updateConfig({ sortEnabled: !sortEnabled })}
                                            className={`relative w-9 h-5 rounded-full transition-colors ${sortEnabled ? 'bg-orange-500' : 'bg-slate-300'}`}
                                            title={sortEnabled ? '点击暂停排序' : '点击启用排序'}
                                        >
                                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${sortEnabled ? 'left-4' : 'left-0.5'}`} />
                                        </button>
                                    </div>
                                </div>
                                {config.sortRules.map((rule, idx) => (
                                    <div key={idx} className="flex items-center gap-2 bg-white p-2 rounded-lg border border-slate-200">
                                        <span className="text-[10px] text-slate-400 w-4">{idx + 1}</span>
                                        <select
                                            value={rule.column}
                                            onChange={e => {
                                                const newRules = [...config.sortRules];
                                                newRules[idx] = { ...rule, column: e.target.value };
                                                updateConfig({ sortRules: newRules });
                                            }}
                                            className="flex-1 min-w-0 px-2 py-1 text-xs text-slate-800 bg-white border border-slate-200 rounded"
                                        >
                                            <option value="">选择排序列...</option>
                                            {data.columns.map(col => (
                                                <option key={col} value={col}>{col}</option>
                                            ))}
                                        </select>
                                        <button
                                            onClick={() => {
                                                const newRules = [...config.sortRules];
                                                newRules[idx] = { ...rule, descending: !rule.descending };
                                                updateConfig({ sortRules: newRules });
                                            }}
                                            className={`p-1 rounded ${rule.descending ? 'bg-orange-100 text-orange-600' : 'bg-blue-100 text-blue-600'}`}
                                        >
                                            {rule.descending ? <ArrowDown size={12} /> : <ArrowUp size={12} />}
                                        </button>
                                        <button
                                            onClick={() => updateConfig({
                                                sortRules: config.sortRules.filter((_, i) => i !== idx)
                                            })}
                                            className="p-1 text-red-400 hover:text-red-600"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                ))}
                                {/* 快捷排序预设 */}
                                <div className="flex flex-wrap gap-1 mb-2">
                                    <button
                                        onClick={() => {
                                            const likeCol = data.columns.find(c => c.includes('点赞') || c.includes('like') || c.includes('Like'));
                                            if (likeCol) {
                                                updateConfig({
                                                    sortRules: [{ column: likeCol, descending: true }, ...config.sortRules.filter(r => r.column !== likeCol)]
                                                });
                                            }
                                        }}
                                        className="px-2 py-1 text-[10px] bg-orange-50 hover:bg-orange-100 rounded border border-orange-200 text-orange-700"
                                    >👍 点赞↓</button>
                                    <button
                                        onClick={() => {
                                            const commentCol = data.columns.find(c => c.includes('评论') || c.includes('comment'));
                                            if (commentCol) {
                                                updateConfig({
                                                    sortRules: [{ column: commentCol, descending: true }, ...config.sortRules.filter(r => r.column !== commentCol)]
                                                });
                                            }
                                        }}
                                        className="px-2 py-1 text-[10px] bg-orange-50 hover:bg-orange-100 rounded border border-orange-200 text-orange-700"
                                    >💬 评论↓</button>
                                    <button
                                        onClick={() => {
                                            const dateCol = data.columns.find(c => c.includes('日期') || c.includes('时间') || c.includes('Date'));
                                            if (dateCol) {
                                                updateConfig({
                                                    sortRules: [{ column: dateCol, descending: true }, ...config.sortRules.filter(r => r.column !== dateCol)]
                                                });
                                            }
                                        }}
                                        className="px-2 py-1 text-[10px] bg-teal-50 hover:bg-teal-100 rounded border border-teal-200 text-teal-700"
                                    ><Calendar size={12} className="inline mr-1" /> 日期↓</button>
                                    {config.sortRules.length > 0 && (
                                        <button
                                            onClick={() => updateConfig({ sortRules: [] })}
                                            className="px-2 py-1 text-[10px] bg-red-50 hover:bg-red-100 rounded border border-red-200 text-red-500"
                                        >清除</button>
                                    )}
                                </div>

                                <button
                                    onClick={() => updateConfig({
                                        sortRules: [...config.sortRules, { column: '', descending: true }]
                                    })}
                                    className="w-full py-1.5 text-xs text-slate-500 hover:text-slate-700 hover:bg-slate-100 rounded-lg border border-dashed border-slate-300 flex items-center justify-center gap-1"
                                >
                                    <Plus size={12} /> 添加排序级别
                                </button>
                            </div>
                        )
                    }

                    {/* === 高亮设置 === */}
                    {
                        activeTab === 'highlight' && (
                            <div className="space-y-2">
                                <div className="flex items-center justify-between px-2 py-1.5 bg-amber-50 border border-amber-200 rounded-lg">
                                    <span className="text-xs font-semibold text-amber-700">高亮开关</span>
                                    <div className="flex items-center gap-2">
                                        <span className="text-[10px] text-amber-600">{highlightEnabled ? '已启用' : '已暂停'}</span>
                                        <button
                                            onClick={() => updateConfig({ highlightEnabled: !highlightEnabled })}
                                            className={`relative w-9 h-5 rounded-full transition-colors ${highlightEnabled ? 'bg-amber-500' : 'bg-slate-300'}`}
                                            title={highlightEnabled ? '点击暂停高亮' : '点击启用高亮'}
                                        >
                                            <span className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-all ${highlightEnabled ? 'left-4' : 'left-0.5'}`} />
                                        </button>
                                    </div>
                                </div>
                                {config.highlightRules.map((rule, idx) => (
                                    <div key={rule.id} className="p-2 bg-amber-50 rounded-lg border border-amber-200 space-y-1.5">
                                        <div className="flex items-center gap-2">
                                            <input
                                                type="color"
                                                value={rule.color}
                                                onChange={e => {
                                                    const newRules = [...config.highlightRules];
                                                    newRules[idx] = { ...rule, color: e.target.value };
                                                    updateConfig({ highlightRules: newRules });
                                                }}
                                                className="w-6 h-6 rounded cursor-pointer border-0"
                                            />
                                            <select
                                                value={rule.column}
                                                onChange={e => {
                                                    const newRules = [...config.highlightRules];
                                                    newRules[idx] = { ...rule, column: e.target.value };
                                                    updateConfig({ highlightRules: newRules });
                                                }}
                                                className="flex-1 px-1.5 py-1 text-[11px] text-slate-800 bg-white border border-slate-200 rounded"
                                            >
                                                <option value="">选择列...</option>
                                                {data.columns.map(col => (
                                                    <option key={col} value={col}>{col}</option>
                                                ))}
                                            </select>
                                            <button
                                                onClick={() => updateConfig({
                                                    highlightRules: config.highlightRules.filter(r => r.id !== rule.id)
                                                })}
                                                className="p-0.5 text-red-400 hover:text-red-600"
                                            >
                                                <X size={12} />
                                            </button>
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <select
                                                value={rule.operator}
                                                onChange={e => {
                                                    const newRules = [...config.highlightRules];
                                                    newRules[idx] = { ...rule, operator: e.target.value as HighlightRule['operator'] };
                                                    updateConfig({ highlightRules: newRules });
                                                }}
                                                className="w-24 px-1.5 py-1 text-[10px] text-slate-800 bg-white border border-slate-200 rounded"
                                            >
                                                <optgroup label="数值">
                                                    <option value="greaterThan">&gt; 大于</option>
                                                    <option value="lessThan">&lt; 小于</option>
                                                    <option value="greaterOrEqual">≥ 大于等于</option>
                                                    <option value="lessOrEqual">≤ 小于等于</option>
                                                    <option value="between">介于</option>
                                                </optgroup>
                                                <optgroup label="文本">
                                                    <option value="contains">包含</option>
                                                    <option value="notContains">不包含</option>
                                                    <option value="equals">等于</option>
                                                    <option value="notEmpty">非空</option>
                                                    <option value="isEmpty">为空</option>
                                                </optgroup>
                                            </select>
                                            {!['notEmpty', 'isEmpty'].includes(rule.operator) && (
                                                <input
                                                    type="text"
                                                    value={rule.value}
                                                    onChange={e => {
                                                        const newRules = [...config.highlightRules];
                                                        newRules[idx] = { ...rule, value: e.target.value };
                                                        updateConfig({ highlightRules: newRules });
                                                    }}
                                                    placeholder={rule.operator === 'between' ? '最小' : '值'}
                                                    className="flex-1 px-1.5 py-1 text-[10px] bg-white border border-slate-200 rounded"
                                                />
                                            )}
                                            {rule.operator === 'between' && (
                                                <>
                                                    <span className="text-slate-400 text-[10px]">~</span>
                                                    <input
                                                        type="text"
                                                        value={rule.value2 || ''}
                                                        onChange={e => {
                                                            const newRules = [...config.highlightRules];
                                                            newRules[idx] = { ...rule, value2: e.target.value };
                                                            updateConfig({ highlightRules: newRules });
                                                        }}
                                                        placeholder="最大"
                                                        className="flex-1 px-1.5 py-1 text-[10px] bg-white border border-slate-200 rounded"
                                                    />
                                                </>
                                            )}
                                            <select
                                                value={rule.borderWidth || 3}
                                                onChange={e => {
                                                    const newRules = [...config.highlightRules];
                                                    newRules[idx] = { ...rule, borderWidth: parseInt(e.target.value) };
                                                    updateConfig({ highlightRules: newRules });
                                                }}
                                                className="w-12 px-1 py-1 text-[10px] text-slate-800 bg-white border border-slate-200 rounded"
                                                title="边框粗细"
                                            >
                                                <option value="1">1px</option>
                                                <option value="2">2px</option>
                                                <option value="3">3px</option>
                                                <option value="4">4px</option>
                                                <option value="5">5px</option>
                                            </select>
                                        </div>
                                    </div>
                                ))}
                                <button
                                    onClick={() => updateConfig({
                                        highlightRules: [...config.highlightRules, {
                                            id: Date.now().toString(),
                                            column: '',
                                            operator: 'greaterThan',
                                            value: '',
                                            color: '#FFD700',
                                            borderWidth: 3,
                                            enabled: true
                                        }]
                                    })}
                                    className="w-full py-1.5 text-xs text-amber-600 bg-amber-50 hover:bg-amber-100 rounded-lg border border-dashed border-amber-300 flex items-center justify-center gap-1"
                                >
                                    <Plus size={12} /> 添加高亮规则
                                </button>
                            </div>
                        )
                    }

                    {/* === 查重设置 === */}
                    {activeTab === 'dedup' && (
                        <div className="space-y-3">
                            <div className="text-xs text-slate-500 mb-2">
                                检测并处理重复数据
                            </div>

                            {/* 检查列选择 */}
                            <div className="p-2 bg-teal-50 rounded-lg border border-teal-200">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-teal-800 font-semibold whitespace-nowrap">检查列:</span>
                                    <select
                                        value={dedupColumn || ''}
                                        onChange={(e) => onDedupColumnChange?.(e.target.value)}
                                        className="flex-1 min-w-0 max-w-[180px] text-sm text-slate-800 font-medium border border-slate-300 rounded px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-teal-500 truncate"
                                    >
                                        <option value="">选择列...</option>
                                        {data.columns.map(h => (
                                            <option key={h} value={h}>{h}</option>
                                        ))}
                                    </select>
                                </div>
                            </div>

                            {/* 模式按钮 */}
                            <div className="flex items-center gap-1 bg-slate-100 rounded-lg p-1">
                                <button
                                    onClick={() => onDedupModeChange?.('off')}
                                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors ${dedupMode === 'off'
                                        ? 'bg-white shadow-sm text-slate-800'
                                        : 'text-slate-600 hover:bg-slate-200'
                                        }`}
                                >
                                    关闭
                                </button>
                                <button
                                    onClick={() => onDedupModeChange?.('remove')}
                                    disabled={!dedupColumn}
                                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40 ${dedupMode === 'remove'
                                        ? 'bg-green-500 text-white shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-200'
                                        }`}
                                >
                                    <EyeOff size={10} className="inline mr-1" />去重
                                </button>
                                <button
                                    onClick={() => onDedupModeChange?.('show')}
                                    disabled={!dedupColumn}
                                    className={`flex-1 px-2 py-1.5 text-xs font-medium rounded-md transition-colors disabled:opacity-40 ${dedupMode === 'show'
                                        ? 'bg-amber-500 text-white shadow-sm'
                                        : 'text-slate-600 hover:bg-slate-200'
                                        }`}
                                >
                                    <Eye size={10} className="inline mr-1" />仅看重复
                                </button>
                            </div>

                            {/* 统计信息 */}
                            {dedupMode !== 'off' && dedupColumn && duplicateStats && (
                                <div className="text-xs text-slate-500 bg-slate-50 rounded-lg p-3 space-y-1.5">
                                    <div className="flex justify-between">
                                        <span>总行数:</span>
                                        <b className="text-slate-700">{duplicateStats.total}</b>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>唯一值:</span>
                                        <b className="text-green-600">{duplicateStats.unique}</b>
                                    </div>
                                    <div className="flex justify-between">
                                        <span>重复项:</span>
                                        <b className="text-amber-600">{duplicateStats.duplicates}</b>
                                    </div>
                                </div>
                            )}

                            {/* 提示 */}
                            {!dedupColumn && (
                                <div className="text-xs text-slate-400 bg-slate-50 rounded-lg p-2 text-center">
                                    请先选择要检查重复的列
                                </div>
                            )}
                        </div>
                    )}
                </div >
            </div >

            {/* 树状图多级分组配置弹窗 */}
            <TreeGroupConfigModal
                isOpen={showTreeGroupModal}
                onClose={() => setShowTreeGroupModal(false)}
                groupLevels={currentGroupLevels}
                onGroupLevelsChange={(levels) => {
                    updateConfig({ groupLevels: levels, groupColumn: '' });
                }}
                columns={data.columns}
                data={{ rows: data.rows }}
            />
        </>
    );
};

export default UnifiedSettingsPanel;
