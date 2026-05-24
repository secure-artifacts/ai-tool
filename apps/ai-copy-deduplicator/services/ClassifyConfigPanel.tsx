/**
 * ClassifyConfigPanel — 可复用的 AI 文案分类配置面板
 *
 * 由专业查重工具提供，数据整理的 ProfessionalDedupAgent 直接调用此组件。
 * 任何 UI/功能更新只需改这一个文件，两边同步。
 */
import React, { useState, useCallback, useId, useRef, useEffect } from 'react';
import { Plus, Copy, Trash2 } from 'lucide-react';

// ==================== 类型 ====================

export interface CustomClassifyRule {
    id: string;
    name: string;
    level: string; // 维度 (如 "大类", "平台", "情绪", etc.)
    criteria: string;
    parentCategory: string; // 归属限制 (可选)
}

export interface ClassifyConfigValue {
    depth: 'full' | 'major' | 'custom';
    batchSize: number;
    customRules: CustomClassifyRule[];
    enableDedup: boolean;
    /** AI 模型 ('__global__' = 继承全局设置) */
    model?: string;
    /** 可选的 System Prompt 覆盖 */
    systemPromptOverride?: string;
    /** 查重模式 */
    dedupMode?: 'semantic' | 'fingerprint';
    /** 查重数据源 */
    dedupSource?: 'library' | 'self';
    /** 执行模式 (仅在数据整理 Pipeline 中有效) */
    taskMode?: 'all' | 'classify_only' | 'dedup_only';
    autoDeleteCondition?: 'none' | 'gt' | 'lt';
    autoDeleteThreshold?: number;
}

interface ClassifyConfigPanelProps {
    value: ClassifyConfigValue;
    onChange: (val: ClassifyConfigValue) => void;
    /** 是否以紧凑模式展示 (DataPipeline Agent 模式) */
    compact?: boolean;
    /** 面板模式 */
    panelMode?: 'classify' | 'dedup' | 'all';
}

// ==================== 预设 ====================

const PRESET_RULES: { label: string; rules: CustomClassifyRule[] }[] = [
    {
        label: '🇬🇧 信仰文案 (9大类+64中+100小)',
        rules: [], // 空 = 使用内置默认 system prompt，depth = 'full'
    },
    {
        label: '🛒 电商文案',
        rules: [
            { id: 'p1', name: '商品展示', level: '大类', criteria: '商品展示类文案', parentCategory: '' },
            { id: 'p2', name: '促销活动', level: '大类', criteria: '促销打折类文案', parentCategory: '' },
            { id: 'p3', name: '节日营销', level: '大类', criteria: '节日相关文案', parentCategory: '' },
            { id: 'p4', name: '品牌故事', level: '大类', criteria: '品牌/故事类文案', parentCategory: '' },
            { id: 'p5', name: '用户评价', level: '大类', criteria: '用户评价/口碑', parentCategory: '' },
        ],
    },
    {
        label: '😊 情绪分析',
        rules: [
            { id: 's1', name: '积极', level: '情绪', criteria: '积极正面的情绪', parentCategory: '' },
            { id: 's2', name: '中性', level: '情绪', criteria: '中性客观的语气', parentCategory: '' },
            { id: 's3', name: '消极', level: '情绪', criteria: '消极负面的情绪', parentCategory: '' },
        ],
    },
];

// ==================== Component ====================

const INHERIT_VALUE = '__global__';

const MODEL_OPTIONS = [
    { value: INHERIT_VALUE, label: '继承全局设置' },
    { value: 'gemini-3.5-flash', label: '🚀 gemini-3.5-flash (GA·新)' },
    { value: 'gemini-2.5-flash', label: '⚡ gemini-2.5-flash (GA)' },
    { value: 'gemini-2.5-flash-lite', label: '⚡ gemini-2.5-flash-lite (GA·最快)' },
    { value: 'gemini-2.5-pro', label: '🧠 gemini-2.5-pro (GA·强推理)' },
    { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (Preview)' },
    { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview (Preview·最新)' },
];

type PasteTarget = 'ignore' | 'level' | 'name' | 'parentCategory' | 'criteria';

const PASTE_TARGET_OPTIONS: Array<{ value: PasteTarget; label: string }> = [
    { value: 'ignore', label: '忽略此列' },
    { value: 'level', label: '分类维度' },
    { value: 'name', label: '类别名称' },
    { value: 'parentCategory', label: '归属限制(可选)' },
    { value: 'criteria', label: '判断标准' },
];

export const ClassifyConfigPanel: React.FC<ClassifyConfigPanelProps> = ({ value, onChange, compact = false, panelMode = 'all' }) => {
    const config: ClassifyConfigValue = {
        depth: value?.depth || 'full',
        batchSize: value?.batchSize ?? 999,
        customRules: value?.customRules || [],
        enableDedup: panelMode === 'dedup' ? true : (value?.enableDedup ?? false),
        dedupSource: panelMode === 'dedup' ? (value?.dedupSource || 'self') : (value?.dedupSource || 'library'),
        dedupMode: value?.dedupMode || 'semantic',
        autoDeleteCondition: value?.autoDeleteCondition || 'none',
        autoDeleteThreshold: value?.autoDeleteThreshold ?? 95,
        taskMode: panelMode === 'dedup' ? 'dedup_only' : (panelMode === 'classify' ? 'classify_only' : (value?.taskMode || 'all')),
        model: value?.model || INHERIT_VALUE,
        systemPromptOverride: value?.systemPromptOverride || '',
    };

    const uid = useId();

    const update = useCallback((partial: Partial<ClassifyConfigValue>) => {
        onChange({ ...config, ...partial });
    }, [config, onChange]);

    const [showCustomRules, setShowCustomRules] = useState(config.customRules.length > 0);
    const [showAdvanced, setShowAdvanced] = useState(false);
    const [pasteWizardOpen, setPasteWizardOpen] = useState(false);
    const [pasteRows, setPasteRows] = useState<string[][]>([]);
    const [pasteColumnCount, setPasteColumnCount] = useState(0);
    const [pasteColumnMapping, setPasteColumnMapping] = useState<PasteTarget[]>([]);
    const [pasteHasHeader, setPasteHasHeader] = useState(false);
    const [clearConfirmPending, setClearConfirmPending] = useState(false);
    const clearConfirmTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const sectionBg: React.CSSProperties = {
        background: 'var(--bg-color-secondary, var(--control-bg-color, rgba(128,128,128,0.1)))',
        borderRadius: 8,
        padding: compact ? '8px 10px' : '10px 14px',
    };

    const inputStyle: React.CSSProperties = {
        background: 'var(--control-bg-color, #27272a)',
        color: 'var(--text-color, #e4e4e7)',
        border: '1px solid var(--border-color, #333)',
        borderRadius: 4,
        padding: '2px 6px',
        fontSize: 11,
    };

    // 工具函数：更新自定义规则并持久化
    const updateRules = useCallback((rules: CustomClassifyRule[]) => {
        update({ customRules: rules });
        try { localStorage.setItem('ai_classify_custom_rules', JSON.stringify(rules)); } catch {}
    }, [config]);

    const handleCopyRulesToTable = useCallback(async () => {
        if (!config.customRules.length) return;

        const cleanCell = (val: string | undefined) => (val ?? '')
            .replace(/\r?\n/g, ' ')
            .replace(/\t/g, ' ')
            .trim();

        const header = ['分类维度', '类别名称', '归属限制(可选)', '判断标准'];
        const lines = [
            header.join('\t'),
            ...config.customRules.map(rule => ([
                cleanCell(rule.level || '大类'),
                cleanCell(rule.name),
                cleanCell(rule.parentCategory),
                cleanCell(rule.criteria),
            ].join('\t'))),
        ];

        try { await navigator.clipboard.writeText(lines.join('\n')); } catch {}
    }, [config.customRules]);

    const getDefaultMappingByColCount = useCallback((colCount: number): PasteTarget[] => {
        const base = Array.from({ length: colCount }, () => 'ignore' as PasteTarget);
        if (colCount <= 0) return base;
        if (colCount === 1) {
            base[0] = 'name';
            return base;
        }
        if (colCount === 2) {
            base[0] = 'name';
            base[1] = 'criteria';
            return base;
        }
        if (colCount === 3) {
            base[0] = 'level';
            base[1] = 'name';
            base[2] = 'criteria';
            return base;
        }
        base[0] = 'level';
        base[1] = 'name';
        base[2] = 'parentCategory';
        base[3] = 'criteria';
        return base;
    }, []);

    const getHeaderMapping = useCallback((headerCells: string[]): PasteTarget[] => {
        return headerCells.map((cell) => {
            const text = cell.toLowerCase().trim();
            if (!text) return 'ignore';
            if (text.includes('维度') || text.includes('层级') || text.includes('level')) return 'level';
            if (text.includes('类别') || text.includes('名称') || text.includes('name') || text.includes('category')) return 'name';
            if (text.includes('归属') || text.includes('父类') || text.includes('parent')) return 'parentCategory';
            if (text.includes('标准') || text.includes('criteria') || text.includes('规则') || text.includes('说明')) return 'criteria';
            return 'ignore';
        });
    }, []);

    const openPasteWizard = useCallback((text: string) => {
        const rows = text.split(/\r?\n/).filter(r => r.trim());
        if (!rows.length) return;

        const tableRows = rows.map(row => row.split('\t').map(col => col.trim()));
        const colCount = Math.max(...tableRows.map(row => row.length), 0);
        if (!colCount) return;

        const normalizedRows = tableRows.map(row =>
            Array.from({ length: colCount }, (_, i) => row[i] ?? '')
        );

        const headerMapping = getHeaderMapping(normalizedRows[0] || []);
        const detectedHeader = headerMapping.some(v => v !== 'ignore');
        const initialMapping = detectedHeader ? headerMapping : getDefaultMappingByColCount(colCount);

        setPasteRows(normalizedRows);
        setPasteColumnCount(colCount);
        setPasteColumnMapping(initialMapping);
        setPasteHasHeader(detectedHeader);
        setPasteWizardOpen(true);
    }, [getDefaultMappingByColCount, getHeaderMapping]);

    const handlePasteRulesFromTable = useCallback(async () => {
        let text = '';
        try { text = await navigator.clipboard.readText(); } catch {
            return; // 无法读取剪贴板
        }
        if (!text?.trim()) return;
        openPasteWizard(text);
    }, [openPasteWizard]);

    const applyMappedPastedRules = useCallback(() => {
        const sourceRows = pasteHasHeader ? pasteRows.slice(1) : pasteRows;
        const newRules: CustomClassifyRule[] = [];

        sourceRows.forEach((row, rowIdx) => {
            const draft: CustomClassifyRule = {
                id: `${Date.now()}-${rowIdx}-${Math.random().toString(36).slice(2, 8)}`,
                level: '大类',
                name: '',
                parentCategory: '',
                criteria: '',
            };

            for (let i = 0; i < pasteColumnCount; i += 1) {
                const target = pasteColumnMapping[i] || 'ignore';
                const value = (row[i] || '').trim();
                if (!value || target === 'ignore') continue;
                if (target === 'level') draft.level = value;
                if (target === 'name') draft.name = value;
                if (target === 'parentCategory') draft.parentCategory = value;
                if (target === 'criteria') draft.criteria = value;
            }

            if (!draft.name) return;
            newRules.push(draft);
        });

        if (newRules.length > 0) {
            updateRules([...config.customRules, ...newRules]);
        }
        setPasteWizardOpen(false);
    }, [config.customRules, pasteColumnCount, pasteColumnMapping, pasteHasHeader, pasteRows, updateRules]);

    const handleClearAllCustomRules = useCallback(() => {
        if (!config.customRules.length) return;
        if (!clearConfirmPending) {
            setClearConfirmPending(true);
            if (clearConfirmTimerRef.current) clearTimeout(clearConfirmTimerRef.current);
            clearConfirmTimerRef.current = setTimeout(() => {
                setClearConfirmPending(false);
                clearConfirmTimerRef.current = null;
            }, 2600);
            return;
        }
        if (clearConfirmTimerRef.current) {
            clearTimeout(clearConfirmTimerRef.current);
            clearConfirmTimerRef.current = null;
        }
        setClearConfirmPending(false);
        updateRules([]);
    }, [clearConfirmPending, config.customRules, updateRules]);

    useEffect(() => {
        if (config.customRules.length > 0) return;
        setClearConfirmPending(false);
        if (clearConfirmTimerRef.current) {
            clearTimeout(clearConfirmTimerRef.current);
            clearConfirmTimerRef.current = null;
        }
    }, [config.customRules.length]);

    useEffect(() => {
        return () => {
            if (clearConfirmTimerRef.current) {
                clearTimeout(clearConfirmTimerRef.current);
            }
        };
    }, []);

    return (
        <>
        <div style={{ display: 'flex', flexDirection: 'column', gap: compact ? 10 : 14, fontSize: compact ? 12 : 13 }}>
            {/* ── 执行模式 (仅 Pipeline 全功能中显示) ── */}
            {compact && panelMode === 'all' && (
                <div style={{ ...sectionBg, display: 'flex', flexDirection: 'column', gap: 8, borderLeft: '3px solid #3b82f6' }}>
                    <div style={{ fontWeight: 600, fontSize: 12, color: '#3b82f6' }}>执行模式 (仅 Pipeline 节点)</div>
                    <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                            <input type="radio" name={`taskMode-${uid}`} checked={config.taskMode === 'all'}
                                onChange={() => update({ taskMode: 'all', enableDedup: true })} />
                            全功能 (AI 分类 + 智能查重)
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                            <input type="radio" name={`taskMode-${uid}`} checked={config.taskMode === 'dedup_only'}
                                onChange={() => update({ taskMode: 'dedup_only', enableDedup: true })} />
                            仅执行查重 (瞬间完成，不消耗 Tokens)
                        </label>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                            <input type="radio" name={`taskMode-${uid}`} checked={config.taskMode === 'classify_only'}
                                onChange={() => update({ taskMode: 'classify_only', enableDedup: false })} />
                            仅执行分类
                        </label>
                    </div>
                </div>
            )}

            {/* ── 分类配置 ── */}
            {panelMode !== 'dedup' && config.taskMode !== 'dedup_only' && (
                <div style={{ ...sectionBg, display: 'flex', flexDirection: 'column', gap: 8 }}>
                    <div style={{ fontWeight: 600, fontSize: compact ? 11 : 12 }}>分类模式</div>
                <div style={{ display: 'flex', gap: compact ? 8 : 16, flexWrap: 'wrap' }}>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                        <input type="radio" name={`classifyDepth-${uid}`} checked={config.depth === 'full'}
                            onChange={() => update({ depth: 'full' })} />
                        三层分类 (大+中+小)
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                        <input type="radio" name={`classifyDepth-${uid}`} checked={config.depth === 'major'}
                            onChange={() => update({ depth: 'major' })} />
                        仅大类
                    </label>
                    <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer' }}>
                        <input type="radio" name={`classifyDepth-${uid}`} checked={config.depth === 'custom'}
                            onChange={() => {
                                update({ depth: 'custom' });
                                setShowCustomRules(true);
                            }} />
                        <span style={{ color: config.depth === 'custom' ? '#22c55e' : 'inherit', fontWeight: config.depth === 'custom' ? 600 : 400 }}>
                            完全自定义 (不限层级)
                        </span>
                    </label>
                </div>
                {config.depth === 'full' && (
                    <div style={{ fontSize: 10, color: 'var(--text-muted-color, #888)' }}>
                        使用内置「万字分类 Prompt」(9大类 + 64中类 + 100+小类)，适用于信仰类短视频文案。
                    </div>
                )}
                {config.depth === 'custom' && (
                    <div style={{ fontSize: 10, color: '#22c55e' }}>
                        ⚡ 完全依据你的自定义规则分类，AI 不使用内置分类体系。
                    </div>
                )}
                </div>
            )}

            {/* ── 自定义规则 ── */}
            {config.taskMode !== 'dedup_only' && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                    type="button"
                    onClick={() => setShowCustomRules(!showCustomRules)}
                    style={{
                        background: config.customRules.length > 0 ? 'rgba(34, 197, 94, 0.08)' : 'none',
                        border: `1px solid ${config.customRules.length > 0 ? '#22c55e44' : 'var(--border-color, rgba(128,128,128,0.3))'}`,
                        cursor: 'pointer', padding: '6px 10px', borderRadius: 6,
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: compact ? 13 : 14,
                        fontWeight: 600, color: config.customRules.length > 0 ? '#22c55e' : 'var(--text-color)',
                    }}
                >
                    <span style={{ transform: showCustomRules ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', fontSize: 10 }}>▶</span>
                    <span>✏️ 自定义分类规则</span>
                    {config.customRules.length > 0 && (
                        <span style={{ fontSize: 10, fontWeight: 400, marginLeft: 4 }}>
                            ({config.customRules.length} 条)
                        </span>
                    )}
                </button>

                {showCustomRules && (
                    <div style={{ ...sectionBg, display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {/* 预设快捷按钮 */}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {PRESET_RULES.map((preset, i) => (
                                <button
                                    key={i}
                                    type="button"
                                    onClick={() => {
                                        if (preset.rules.length === 0) {
                                            // 使用内置 prompt
                                            updateRules([]);
                                            update({ depth: 'full', customRules: [] });
                                        } else {
                                            updateRules(preset.rules);
                                            update({ depth: 'custom', customRules: preset.rules });
                                        }
                                    }}
                                    style={{
                                        fontSize: 12, padding: '4px 10px', borderRadius: 12,
                                        border: '1px solid var(--border-color, rgba(128,128,128,0.3))',
                                        background: 'transparent', cursor: 'pointer',
                                        color: 'var(--text-color)',
                                        transition: 'all 0.15s',
                                    }}
                                >
                                    {preset.label}
                                </button>
                            ))}
                        </div>

                        {/* 规则列表 */}
                        <div
                            style={{
                                maxHeight: compact ? 260 : 340,
                                overflowY: 'auto',
                                overscrollBehavior: 'contain',
                                paddingRight: 2,
                            }}
                        >
                            {config.customRules.map((rule, idx) => (
                                <div key={rule.id} style={{
                                    display: 'flex', gap: 4, alignItems: 'center', padding: '3px 0',
                                    borderBottom: '1px solid var(--border-color, rgba(128,128,128,0.15))',
                                }}>
                                    <input
                                        type="text" placeholder="维度"
                                        value={rule.level} title="分类维度 (如: 大类/平台/情绪)"
                                        onChange={e => {
                                            const updated = [...config.customRules];
                                            updated[idx] = { ...rule, level: e.target.value };
                                            updateRules(updated);
                                        }}
                                        style={{ ...inputStyle, width: 70, color: '#3b82f6' }}
                                    />
                                    <input
                                        type="text" placeholder="类别名称"
                                        value={rule.name}
                                        onChange={e => {
                                            const updated = [...config.customRules];
                                            updated[idx] = { ...rule, name: e.target.value };
                                            updateRules(updated);
                                        }}
                                        style={{ ...inputStyle, width: 80 }}
                                    />
                                    <input
                                        type="text" placeholder="归属限制(可选)"
                                        value={rule.parentCategory} title="如果仅在某个其他标签触发时才生效"
                                        onChange={e => {
                                            const updated = [...config.customRules];
                                            updated[idx] = { ...rule, parentCategory: e.target.value };
                                            updateRules(updated);
                                        }}
                                        style={{ ...inputStyle, width: 80, color: '#f59e0b' }}
                                    />
                                    <input
                                        type="text" placeholder="判断标准"
                                        value={rule.criteria}
                                        onChange={e => {
                                            const updated = [...config.customRules];
                                            updated[idx] = { ...rule, criteria: e.target.value };
                                            updateRules(updated);
                                        }}
                                        style={{ ...inputStyle, flex: 1 }}
                                    />
                                    <button
                                        type="button"
                                        onClick={() => {
                                            const updated = config.customRules.filter((_, i) => i !== idx);
                                            updateRules(updated);
                                        }}
                                        style={{ background: 'transparent', color: '#ef4444', border: 'none', cursor: 'pointer', padding: '2px', fontSize: 14, lineHeight: 1 }}
                                        title="删除此规则"
                                    >×</button>
                                </div>
                            ))}
                        </div>

                        {/* 操作按钮 */}
                        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                            <button
                                type="button"
                                onClick={() => {
                                    const newRule: CustomClassifyRule = { id: Date.now().toString(), name: '', level: '大类', criteria: '', parentCategory: '' };
                                    updateRules([...config.customRules, newRule]);
                                }}
                                style={{
                                    flex: '1 1 160px', display: 'flex', alignItems: 'center', gap: 4,
                                    background: 'transparent', color: '#22c55e',
                                    border: '1px dashed #22c55e44', borderRadius: 4,
                                    padding: '6px 8px', fontSize: 12, cursor: 'pointer', justifyContent: 'center',
                                }}
                            >
                                <Plus size={12} /> 添加自定义分类
                            </button>
                            <button
                                type="button"
                                onClick={handleClearAllCustomRules}
                                disabled={config.customRules.length === 0}
                                title={config.customRules.length === 0
                                    ? '暂无可清空规则'
                                    : clearConfirmPending
                                        ? '再次点击确认清空'
                                        : `清空全部 ${config.customRules.length} 条自定义类别`}
                                style={{
                                    flex: '1 1 160px', display: 'flex', alignItems: 'center', gap: 4,
                                    background: clearConfirmPending ? 'rgba(239, 68, 68, 0.1)' : 'transparent',
                                    color: '#ef4444',
                                    opacity: config.customRules.length === 0 ? 0.45 : 1,
                                    border: clearConfirmPending ? '1px solid #ef444488' : '1px dashed #ef444455', borderRadius: 4,
                                    padding: '6px 8px', fontSize: 12, cursor: config.customRules.length === 0 ? 'not-allowed' : 'pointer', justifyContent: 'center',
                                }}
                            >
                                <Trash2 size={12} /> {clearConfirmPending ? '再次点击确认清空' : '一键清空自定义类别'}
                            </button>
                            <button
                                type="button"
                                onClick={handleCopyRulesToTable}
                                disabled={config.customRules.length === 0}
                                title={config.customRules.length === 0 ? '暂无可复制规则' : '复制为表格格式 (TSV)'}
                                style={{
                                    flex: '1 1 160px', display: 'flex', alignItems: 'center', gap: 4,
                                    background: 'transparent', color: '#a855f7',
                                    opacity: config.customRules.length === 0 ? 0.45 : 1,
                                    border: '1px dashed #a855f744', borderRadius: 4,
                                    padding: '6px 8px', fontSize: 12, cursor: config.customRules.length === 0 ? 'not-allowed' : 'pointer', justifyContent: 'center',
                                }}
                            >
                                <Copy size={12} /> 复制当前规则 (到表格)
                            </button>
                            <button
                                type="button"
                                onClick={handlePasteRulesFromTable}
                                style={{
                                    flex: '1 1 160px', display: 'flex', alignItems: 'center', gap: 4,
                                    background: 'transparent', color: '#3b82f6',
                                    border: '1px dashed #3b82f644', borderRadius: 4,
                                    padding: '6px 8px', fontSize: 12, cursor: 'pointer', justifyContent: 'center',
                                }}
                            >
                                <Copy size={12} /> 批量粘贴 (从表格)
                            </button>
                        </div>
                    </div>
                )}
                </div>
            )}

            {/* ── 高级选项 ── */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <button
                    type="button"
                    onClick={() => setShowAdvanced(!showAdvanced)}
                    style={{
                        background: 'none', border: 'none', cursor: 'pointer', padding: 0,
                        display: 'flex', alignItems: 'center', gap: 6, fontSize: compact ? 13 : 14,
                        fontWeight: 600, color: 'var(--text-color)',
                    }}
                >
                    <span style={{ transform: showAdvanced ? 'rotate(90deg)' : 'none', transition: 'transform 0.15s', fontSize: 10 }}>▶</span>
                    <span>⚙️ 高级选项</span>
                </button>

                {showAdvanced && (
                    <div style={{ ...sectionBg, display: 'flex', flexDirection: 'column', gap: 8 }}>
                        {/* AI 模型 */}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: compact ? 13 : 14 }}>
                            AI 模型:
                            <select
                                value={config.model || INHERIT_VALUE}
                                onChange={e => update({ model: e.target.value })}
                                className="dp-input"
                                style={{ fontSize: compact ? 13 : 14, padding: '4px 8px', maxWidth: 220 }}
                            >
                                {MODEL_OPTIONS.map(o => (
                                    <option key={o.value} value={o.value}>{o.label}</option>
                                ))}
                            </select>
                        </label>

                        {compact && (
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13 }}>
                                任务模式:
                                <select
                                    value={config.taskMode || 'all'}
                                    onChange={e => update({ taskMode: e.target.value as any })}
                                    className="dp-input"
                                    style={{ fontSize: 13, padding: '4px 8px' }}
                                >
                                    <option value="all">分类 + 查重</option>
                                    <option value="classify_only">仅分类</option>
                                    <option value="dedup_only">仅查重</option>
                                </select>
                            </label>
                        )}

                        {/* 批量大小 */}
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11 }}>
                            批量大小:
                            <select
                                value={config.batchSize}
                                onChange={e => update({ batchSize: parseInt(e.target.value) })}
                                className="dp-input"
                                style={{ fontSize: 11, padding: '2px 6px' }}
                            >
                                <option value="999">自动（智能分批）</option>
                                <option value="20">20条/批</option>
                                <option value="50">50条/批</option>
                                <option value="100">100条/批</option>
                            </select>
                        </label>

                        {/* 查重库比对 - 仅在非 classify_only 时允许单独切断 */}
                        {panelMode !== 'classify' && config.taskMode !== 'classify_only' && (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                                {panelMode !== 'dedup' && (
                                    <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 11 }}>
                                        <input type="checkbox" checked={config.enableDedup}
                                            onChange={e => update({ enableDedup: e.target.checked })} />
                                        启用查重防撞系统
                                    </label>
                                )}

                                {(config.enableDedup || panelMode === 'dedup') && (
                                    <div style={{ paddingLeft: panelMode === 'dedup' ? 0 : 22, display: 'flex', flexDirection: 'column', gap: 6 }}>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                            <div 
                                                onClick={() => update({ dedupSource: 'library' })}
                                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, background: config.dedupSource !== 'self' ? '#f59e0b20' : 'rgba(255,255,255,0.05)', color: config.dedupSource !== 'self' ? '#f59e0b' : 'var(--text-muted-color)', border: `1px solid ${config.dedupSource !== 'self' ? '#f59e0b50' : 'transparent'}`, transition: 'all 0.2s' }}>
                                                <div style={{ width: 12, height: 12, borderRadius: '50%', border: `4px solid ${config.dedupSource !== 'self' ? '#f59e0b' : 'rgba(255,255,255,0.3)'}` }}></div>
                                                与外部总文案库查重
                                            </div>
                                            <div 
                                                onClick={() => update({ dedupSource: 'self' })}
                                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, background: config.dedupSource === 'self' ? '#f59e0b20' : 'rgba(255,255,255,0.05)', color: config.dedupSource === 'self' ? '#f59e0b' : 'var(--text-muted-color)', border: `1px solid ${config.dedupSource === 'self' ? '#f59e0b50' : 'transparent'}`, transition: 'all 0.2s' }}>
                                                <div style={{ width: 12, height: 12, borderRadius: '50%', border: `4px solid ${config.dedupSource === 'self' ? '#f59e0b' : 'rgba(255,255,255,0.3)'}` }}></div>
                                                内部自我查重 (处理当前表格内容)
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                            <div 
                                                onClick={() => update({ dedupMode: 'semantic' })}
                                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, background: config.dedupMode !== 'fingerprint' ? '#10b98120' : 'rgba(255,255,255,0.05)', color: config.dedupMode !== 'fingerprint' ? '#10b981' : 'var(--text-muted-color)', border: `1px solid ${config.dedupMode !== 'fingerprint' ? '#10b98150' : 'transparent'}`, transition: 'all 0.2s' }}>
                                                <div style={{ width: 12, height: 12, borderRadius: '50%', border: `4px solid ${config.dedupMode !== 'fingerprint' ? '#10b981' : 'rgba(255,255,255,0.3)'}` }}></div>
                                                语义相似查重 (本地向量)
                                            </div>
                                            <div 
                                                onClick={() => update({ dedupMode: 'fingerprint' })}
                                                style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 11, background: config.dedupMode === 'fingerprint' ? '#3b82f620' : 'rgba(255,255,255,0.05)', color: config.dedupMode === 'fingerprint' ? '#3b82f6' : 'var(--text-muted-color)', border: `1px solid ${config.dedupMode === 'fingerprint' ? '#3b82f650' : 'transparent'}`, transition: 'all 0.2s' }}>
                                                <div style={{ width: 12, height: 12, borderRadius: '50%', border: `4px solid ${config.dedupMode === 'fingerprint' ? '#3b82f6' : 'rgba(255,255,255,0.3)'}` }}></div>
                                                指纹完全匹配 (算法查重)
                                            </div>
                                        </div>
                                        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 6, marginTop: 4, padding: '6px 8px', background: 'rgba(239, 68, 68, 0.05)', border: '1px dashed rgba(239, 68, 68, 0.2)', borderRadius: 4 }}>
                                            <span style={{ fontSize: 11, color: '#ef4444', fontWeight: 500 }}>🗑️ 自动打回/删除设置:</span>
                                            <select 
                                                value={config.autoDeleteCondition} 
                                                onChange={e => update({ autoDeleteCondition: e.target.value as any })}
                                                className="dp-input" style={{ fontSize: 11, padding: '2px 4px', width: 90 }}
                                            >
                                                <option value="none">不自动删除</option>
                                                <option value="gt">相似度大于</option>
                                                <option value="lt">相似度小于</option>
                                            </select>
                                            {config.autoDeleteCondition !== 'none' && (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <input 
                                                        type="number" 
                                                        className="dp-input" 
                                                        style={{ width: 50, fontSize: 11, padding: '2px 4px' }}
                                                        value={config.autoDeleteThreshold}
                                                        onChange={e => update({ autoDeleteThreshold: parseInt(e.target.value) || 0 })}
                                                    /> <span style={{ fontSize: 11 }}>%</span>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                )}
                            </div>
                        )}
                    </div>
                )}
            </div>
        </div>

        {pasteWizardOpen && (
            <div
                style={{
                    position: 'fixed',
                    inset: 0,
                    zIndex: 9999,
                    background: 'rgba(0, 0, 0, 0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    padding: 16,
                }}
            >
                <div
                    style={{
                        width: 'min(920px, 95vw)',
                        maxHeight: '85vh',
                        overflow: 'auto',
                        background: 'var(--surface-color, var(--bg-color, #111827))',
                        color: 'var(--text-color)',
                        border: '1px solid var(--border-color, rgba(128,128,128,0.3))',
                        borderRadius: 12,
                        padding: 14,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 10,
                    }}
                >
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                        <div style={{ fontSize: 15, fontWeight: 700 }}>批量粘贴列映射</div>
                        <button
                            type="button"
                            onClick={() => setPasteWizardOpen(false)}
                            style={{
                                background: 'transparent',
                                border: '1px solid var(--border-color, rgba(128,128,128,0.3))',
                                color: 'var(--text-color)',
                                borderRadius: 6,
                                padding: '4px 8px',
                                cursor: 'pointer',
                            }}
                        >
                            关闭
                        </button>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
                        <div style={{ fontSize: 12, color: 'var(--text-muted-color)' }}>
                            已识别 {pasteRows.length} 行，{pasteColumnCount} 列。请设置每一列对应的数据类型。
                        </div>
                        <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                            <input
                                type="checkbox"
                                checked={pasteHasHeader}
                                onChange={(e) => setPasteHasHeader(e.target.checked)}
                            />
                            第一行是表头
                        </label>
                    </div>

                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(150px, 1fr))', gap: 8 }}>
                        {Array.from({ length: pasteColumnCount }, (_, colIdx) => (
                            <label key={`paste-col-${colIdx}`} style={{ display: 'flex', flexDirection: 'column', gap: 4, fontSize: 12 }}>
                                <span>第 {colIdx + 1} 列</span>
                                <select
                                    className="dp-input"
                                    value={pasteColumnMapping[colIdx] || 'ignore'}
                                    onChange={(e) => {
                                        const next = [...pasteColumnMapping];
                                        next[colIdx] = e.target.value as PasteTarget;
                                        setPasteColumnMapping(next);
                                    }}
                                    style={{ fontSize: 12, padding: '4px 6px' }}
                                >
                                    {PASTE_TARGET_OPTIONS.map(opt => (
                                        <option key={opt.value} value={opt.value}>{opt.label}</option>
                                    ))}
                                </select>
                            </label>
                        ))}
                    </div>

                    <div style={{ border: '1px solid var(--border-color, rgba(128,128,128,0.3))', borderRadius: 8, overflow: 'auto' }}>
                        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                            <thead>
                                <tr style={{ background: 'var(--control-bg-color, rgba(128,128,128,0.08))' }}>
                                    {Array.from({ length: pasteColumnCount }, (_, colIdx) => (
                                        <th key={`paste-preview-head-${colIdx}`} style={{ textAlign: 'left', padding: '6px 8px', borderBottom: '1px solid var(--border-color, rgba(128,128,128,0.2))' }}>
                                            列 {colIdx + 1}
                                        </th>
                                    ))}
                                </tr>
                            </thead>
                            <tbody>
                                {pasteRows.slice(0, 6).map((row, rowIdx) => (
                                    <tr key={`paste-preview-row-${rowIdx}`}>
                                        {Array.from({ length: pasteColumnCount }, (_, colIdx) => (
                                            <td key={`paste-preview-cell-${rowIdx}-${colIdx}`} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border-color, rgba(128,128,128,0.12))' }}>
                                                {row[colIdx] || ''}
                                            </td>
                                        ))}
                                    </tr>
                                ))}
                            </tbody>
                        </table>
                    </div>

                    <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                        <button
                            type="button"
                            onClick={() => setPasteWizardOpen(false)}
                            style={{
                                background: 'transparent',
                                color: 'var(--text-color)',
                                border: '1px solid var(--border-color, rgba(128,128,128,0.3))',
                                borderRadius: 6,
                                padding: '6px 10px',
                                cursor: 'pointer',
                            }}
                        >
                            取消
                        </button>
                        <button
                            type="button"
                            onClick={applyMappedPastedRules}
                            style={{
                                background: '#3b82f6',
                                color: '#fff',
                                border: 'none',
                                borderRadius: 6,
                                padding: '6px 12px',
                                cursor: 'pointer',
                                fontWeight: 600,
                            }}
                        >
                            按映射导入
                        </button>
                    </div>
                </div>
            </div>
        )}
        </>
    );
};
