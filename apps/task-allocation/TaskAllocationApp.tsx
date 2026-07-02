import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { 
    UserPlus, 
    FolderPlus, 
    Trash2, 
    Download, 
    Upload,
    Copy, 
    RefreshCw, 
    Settings, 
    X, 
    ClipboardCheck,
    FileSpreadsheet,
    Grid,
    AlertCircle,
    UserCheck,
    Check,
    Edit2,
    Save,
    RotateCcw
} from 'lucide-react';
import { Button, Card, Input, Textarea, Flex, Badge } from '@/components/ui';
import { useToast } from '@/components/ui/Toast';
import './TaskAllocationApp.css';

// ==========================================
// 数据类型接口
// ==========================================
interface Producer {
    id: string;
    group: string; // 新增制作人组别
    name: string;
    quota: number;
    designatedClients: string[]; // 专属负责客户的名称列表
}

interface ClientDemand {
    id: string;
    team: string; // 团队名称
    clientName: string;
    demandType: string;
    totalQuantity: number;
}

// 矩阵单元格存储结构: Record<producerId, Record<demandId, number>>
type AllocationData = Record<string, Record<string, number>>;

// 基础常量与示例数据
const DEFAULT_DEMAND_TYPES = ['reels 视频', '人物口播图', '口播视频'];

const INITIAL_PRODUCERS: Producer[] = [
    { id: 'p1', group: '特效组', name: '老王', quota: 30, designatedClients: ['字节跳动', '腾讯'] },
    { id: 'p2', group: '剪辑组', name: '小李', quota: 20, designatedClients: ['阿里巴巴'] },
    { id: 'p3', group: '剪辑组', name: '阿珍', quota: 25, designatedClients: ['美团'] }
];

const INITIAL_DEMANDS: ClientDemand[] = [
    { id: 'd1', team: '抖音组', clientName: '字节跳动', demandType: 'reels 视频', totalQuantity: 30 },
    { id: 'd2', team: '广告组', clientName: '字节跳动', demandType: '人物口播图', totalQuantity: 10 },
    { id: 'd3', team: '电商组', clientName: '阿里巴巴', demandType: 'reels 视频', totalQuantity: 15 },
    { id: 'd4', team: '外卖组', clientName: '美团', demandType: '人物口播图', totalQuantity: 20 },
    { id: 'd5', team: '社交组', clientName: '腾讯', demandType: '口播视频', totalQuantity: 10 }
];

const INITIAL_ALLOCATIONS: AllocationData = {
    p1: { d1: 15, d2: 5, d5: 10 },
    p2: { d3: 15 },
    p3: { d4: 20 }
};

export default function TaskAllocationApp() {
    const toast = useToast();
    
    // ==========================================
    // 状态管理
    // ==========================================
    const [producers, setProducers] = useState<Producer[]>([]);
    const [demands, setDemands] = useState<ClientDemand[]>([]);
    const [allocations, setAllocations] = useState<AllocationData>({});
    const [demandTypes, setDemandTypes] = useState<string[]>([]);
    
    // UI 控制状态
    const [activeConfigTab, setActiveConfigTab] = useState<'producers' | 'demands' | 'settings'>('producers');
    const [showConfigPanel, setShowConfigPanel] = useState<boolean>(false); // 默认收起配置面板以保持页面整洁
    const [activeProducerDesignatedId, setActiveProducerDesignatedId] = useState<string | null>(null);
    const [showPasteModal, setShowPasteModal] = useState<'producers' | 'demands' | 'allocations' | null>(null);
    const [pasteText, setPasteText] = useState<string>('');
    const [showExportModal, setShowExportModal] = useState<boolean>(false);
    const [transposeOnCopy, setTransposeOnCopy] = useState<boolean>(false); // 复制时是否转置布局
    
    // 鼠标悬停十字定位
    const [hoveredCol, setHoveredCol] = useState<string | null>(null);

    // 新增表单状态
    const [newProducerGroup, setNewProducerGroup] = useState('');
    const [newProducerName, setNewProducerName] = useState('');
    const [newProducerQuota, setNewProducerQuota] = useState(40);
    const [newProducerDesignated, setNewProducerDesignated] = useState<string[]>([]);
    
    const [newDemandTeam, setNewDemandTeam] = useState('');
    const [newDemandClient, setNewDemandClient] = useState('');
    const [newDemandType, setNewDemandType] = useState('');
    const [newDemandQty, setNewDemandQty] = useState(10);

    const [newCustomType, setNewCustomType] = useState('');

    // 编辑状态管理
    const [editingProducerId, setEditingProducerId] = useState<string | null>(null);
    const [editProducerGroup, setEditProducerGroup] = useState('');
    const [editProducerName, setEditProducerName] = useState('');
    const [editProducerQuota, setEditProducerQuota] = useState(0);

    const [editingDemandId, setEditingDemandId] = useState<string | null>(null);
    const [editDemandTeam, setEditDemandTeam] = useState('');
    const [editDemandClient, setEditDemandClient] = useState('');
    const [editDemandType, setEditDemandType] = useState('');
    const [editDemandQty, setEditDemandQty] = useState(0);

    const [editingTypeIndex, setEditingTypeIndex] = useState<number | null>(null);
    const [editTypeName, setEditTypeName] = useState('');

    // 自定义 Confirm 弹窗状态
    const [confirmModal, setConfirmModal] = useState<{
        open: boolean;
        title: string;
        description: string;
        onConfirm: () => void;
    }>({ open: false, title: '', description: '', onConfirm: () => {} });

    // 文件导入 Ref
    const fileInputRef = useRef<HTMLInputElement>(null);

    // ==========================================
    // 1. 初始化与 LocalStorage 持久化
    // ==========================================
    useEffect(() => {
        const storedProducers = localStorage.getItem('ta_producers');
        const storedDemands = localStorage.getItem('ta_demands');
        const storedAllocations = localStorage.getItem('ta_allocations');
        const storedTypes = localStorage.getItem('ta_types');

        if (storedProducers && storedDemands && storedAllocations && storedTypes) {
            try {
                setProducers(JSON.parse(storedProducers));
                setDemands(JSON.parse(storedDemands));
                setAllocations(JSON.parse(storedAllocations));
                setDemandTypes(JSON.parse(storedTypes));
            } catch (e) {
                console.error("加载本地存储数据失败，使用初始数据", e);
                resetToDefault();
            }
        } else {
            resetToDefault();
        }
    }, []);

    // 监听状态改变并自动保存
    useEffect(() => {
        if (producers.length > 0) {
            localStorage.setItem('ta_producers', JSON.stringify(producers));
        }
    }, [producers]);

    useEffect(() => {
        if (demands.length > 0) {
            localStorage.setItem('ta_demands', JSON.stringify(demands));
        }
    }, [demands]);

    useEffect(() => {
        localStorage.setItem('ta_allocations', JSON.stringify(allocations));
    }, [allocations]);

    useEffect(() => {
        if (demandTypes.length > 0) {
            localStorage.setItem('ta_types', JSON.stringify(demandTypes));
        }
    }, [demandTypes]);

    // 重置初始数据方法
    const resetToDefault = () => {
        setProducers(INITIAL_PRODUCERS);
        setDemands(INITIAL_DEMANDS);
        setAllocations(INITIAL_ALLOCATIONS);
        setDemandTypes(DEFAULT_DEMAND_TYPES);
        setNewDemandType(DEFAULT_DEMAND_TYPES[0]);
        toast.success("成功恢复示例演示数据！");
    };

    // 清空数据方法
    const clearAllData = () => {
        showConfirm("清空全部数据", "确定要清空全部制作人、客户需求和分配数据吗？该操作不可撤销。", () => {
            setProducers([]);
            setDemands([]);
            setAllocations({});
            setDemandTypes(DEFAULT_DEMAND_TYPES);
            setNewDemandType(DEFAULT_DEMAND_TYPES[0]);
            localStorage.removeItem('ta_producers');
            localStorage.removeItem('ta_demands');
            localStorage.removeItem('ta_allocations');
            localStorage.removeItem('ta_types');
            toast.success("所有本地缓存数据已被清空。");
        });
    };

    // 显示 Confirm 的便捷方法
    const showConfirm = (title: string, description: string, onConfirm: () => void) => {
        setConfirmModal({
            open: true,
            title,
            description,
            onConfirm: () => {
                onConfirm();
                closeConfirm();
            }
        });
    };

    const closeConfirm = () => {
        setConfirmModal(prev => ({ ...prev, open: false }));
    };

    // ==========================================
    // 2. 双向统计计算与级联排序 (Memoized)
    // ==========================================
    
    // 对需求列进行级联排序 (团队 -> 客户 -> 需求类型)
    const sortedDemands = useMemo(() => {
        return [...demands].sort((a, b) => {
            const teamA = a.team || '未分类团队';
            const teamB = b.team || '未分类团队';
            if (teamA !== teamB) return teamA.localeCompare(teamB);
            
            if (a.clientName !== b.clientName) return a.clientName.localeCompare(b.clientName);
            
            return a.demandType.localeCompare(b.demandType);
        });
    }, [demands]);

    // 对制作人进行级联排序 (组别 -> 姓名)
    const sortedProducers = useMemo(() => {
        return [...producers].sort((a, b) => {
            const groupA = a.group || '通用组';
            const groupB = b.group || '通用组';
            if (groupA !== groupB) return groupA.localeCompare(groupB);
            return a.name.localeCompare(b.name);
        });
    }, [producers]);

    // 计算制作人组别 rowSpan 跨度，用于垂直单元格合并
    const producerGroupSpans = useMemo(() => {
        const spans: Record<string, number> = {};
        sortedProducers.forEach(p => {
            const gName = p.group || '通用组';
            spans[gName] = (spans[gName] || 0) + 1;
        });
        return spans;
    }, [sortedProducers]);

    // 计算第一级列表头“团队”的合并区间 (colSpans) 与大组总量统计
    const teamGroups = useMemo(() => {
        const groups: { team: string; span: number; totalDemand: number; totalAllocated: number }[] = [];
        
        sortedDemands.forEach(d => {
            const teamName = d.team || '未分类团队';
            
            // 算本单元格已分配的累加值
            let cellAllocatedSum = 0;
            producers.forEach(p => {
                cellAllocatedSum += (allocations[p.id]?.[d.id] || 0);
            });

            if (groups.length === 0 || groups[groups.length - 1].team !== teamName) {
                groups.push({ 
                    team: teamName, 
                    span: 1, 
                    totalDemand: d.totalQuantity, 
                    totalAllocated: cellAllocatedSum 
                });
            } else {
                const last = groups[groups.length - 1];
                last.span += 1;
                last.totalDemand += d.totalQuantity;
                last.totalAllocated += cellAllocatedSum;
            }
        });
        return groups;
    }, [sortedDemands, producers, allocations]);

    // 计算第二级列表头“客户”的合并区间 (colSpans)
    const clientGroups = useMemo(() => {
        const groups: { key: string; clientName: string; span: number }[] = [];
        sortedDemands.forEach(d => {
            const key = `${d.team || '未分类团队'} - ${d.clientName}`;
            if (groups.length === 0 || groups[groups.length - 1].key !== key) {
                groups.push({ key, clientName: d.clientName, span: 1 });
            } else {
                groups[groups.length - 1].span += 1;
            }
        });
        return groups;
    }, [sortedDemands]);

    // 计算制作人当前分配量与饱和度
    const producerStats = useMemo(() => {
        const stats: Record<string, { total: number; percent: number; status: 'under' | 'normal' | 'over' }> = {};
        producers.forEach(p => {
            const pAllocations = allocations[p.id] || {};
            const total = Object.values(pAllocations).reduce((sum, val) => sum + (val || 0), 0);
            const percent = p.quota > 0 ? (total / p.quota) * 100 : 0;
            
            let status: 'under' | 'normal' | 'over' = 'under';
            if (percent > 100) status = 'over';
            else if (percent >= 80) status = 'normal';
            
            stats[p.id] = { 
                total: Math.round(total * 100) / 100, 
                percent: Math.round(percent * 10) / 10,
                status 
            };
        });
        return stats;
    }, [producers, allocations]);

    // 计算每个需求列的分配总和与未分配缺口
    const demandStats = useMemo(() => {
        const stats: Record<string, { allocated: number; unallocated: number; status: 'safe' | 'warning' | 'danger' }> = {};
        demands.forEach(d => {
            let allocated = 0;
            producers.forEach(p => {
                allocated += (allocations[p.id]?.[d.id] || 0);
            });
            const unallocated = d.totalQuantity - allocated;
            
            let status: 'safe' | 'warning' | 'danger' = 'safe';
            if (unallocated > 0) status = 'warning';
            else if (unallocated < 0) status = 'danger';

            stats[d.id] = {
                allocated: Math.round(allocated * 100) / 100,
                unallocated: Math.round(unallocated * 100) / 100,
                status
            };
        });
        return stats;
    }, [demands, producers, allocations]);

    // 全局大盘统计
    const globalStats = useMemo(() => {
        const totalDemandQty = demands.reduce((sum, d) => sum + d.totalQuantity, 0);
        const totalAllocatedQty = Object.values(allocations).reduce((sum, pAlloc) => {
            return sum + Object.values(pAlloc).reduce((s, val) => s + (val || 0), 0);
        }, 0);
        
        let avgSaturation = 0;
        if (producers.length > 0) {
            const sumPercents = producers.reduce((sum, p) => sum + (producerStats[p.id]?.percent || 0), 0);
            avgSaturation = sumPercents / producers.length;
        }

        return {
            totalDemandQty: Math.round(totalDemandQty * 100) / 100,
            totalAllocatedQty: Math.round(totalAllocatedQty * 100) / 100,
            avgSaturation: Math.round(avgSaturation * 10) / 10
        };
    }, [demands, allocations, producers, producerStats]);

    // ==========================================
    // 3. 专属职责映射关系计算
    // ==========================================
    
    // 客户被哪些制作人专属负责 (列头展示)
    const clientResponsibilityMap = useMemo(() => {
        const map: Record<string, string[]> = {};
        demands.forEach(d => {
            if (!map[d.clientName]) {
                const responsibleProducers = producers
                    .filter(p => p.designatedClients.includes(d.clientName))
                    .map(p => p.name);
                map[d.clientName] = responsibleProducers;
            }
        });
        return map;
    }, [demands, producers]);

    // 判断单元格是否是专属负责的对口单元格
    const isDesignatedCell = useCallback((producer: Producer, demand: ClientDemand) => {
        return producer.designatedClients.includes(demand.clientName);
    }, []);

    // ==========================================
    // 4. 输入框网格交互与修改
    // ==========================================
    const handleCellChange = (producerId: string, demandId: string, valStr: string) => {
        let value = valStr === '' ? 0 : parseFloat(valStr);
        if (isNaN(value)) value = 0;
        if (value < 0) value = 0; // 不允许负数

        setAllocations(prev => {
            const updated = { ...prev };
            if (!updated[producerId]) {
                updated[producerId] = {};
            }
            updated[producerId] = {
                ...updated[producerId],
                [demandId]: value
            };
            return updated;
        });
    };

    // 清空指派
    const clearAllocations = () => {
        showConfirm("清空矩阵分配", "确定要将当前的指派结果全部清零吗？这不会删除制作人或客户名单。", () => {
            setAllocations({});
            toast.success("矩阵已成功清空。");
        });
    };

    // ==========================================
    // 5. 批量粘贴导入模块 (Sheets/Excel 多列复制粘贴)
    // ==========================================
    
    // 解析并导入制作人与定额 (支持：组别 \t 制作人 \t 定额 3列导入)
    const importProducers = () => {
        if (!pasteText.trim()) return;
        
        const lines = pasteText.split('\n');
        const newProducersList: Producer[] = [];
        let skippedCount = 0;

        let hasHeader = false;
        const firstLine = lines[0]?.trim();
        if (firstLine) {
            const firstParts = firstLine.split(/\t|,/);
            const cell0 = firstParts[0]?.trim();
            const cell1 = firstParts[1]?.trim();
            if (cell0 === '组别' || cell0 === '部门' || cell0 === '团队' || cell1 === '姓名' || cell1 === '制作人') {
                hasHeader = true;
            }
        }

        const startIndex = hasHeader ? 1 : 0;

        for (let i = startIndex; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed) continue;

            const parts = trimmed.split(/\t|,/);
            let group = '通用组';
            let name = '';
            let quotaStr = '';

            // 如果有3列：组别 \t 姓名 \t 定额
            if (parts.length >= 3) {
                group = parts[0]?.trim() || '通用组';
                name = parts[1]?.trim();
                quotaStr = parts[2]?.trim();
            } else {
                // 如果只有2列：姓名 \t 定额
                name = parts[0]?.trim();
                quotaStr = parts[1]?.trim();
            }

            const quota = quotaStr ? parseFloat(quotaStr) : 40;

            if (name && !isNaN(quota)) {
                newProducersList.push({
                    id: `p_imported_${Date.now()}_${i}`,
                    group,
                    name,
                    quota,
                    designatedClients: []
                });
            } else {
                skippedCount++;
            }
        }

        if (newProducersList.length > 0) {
            setProducers(prev => [...prev, ...newProducersList]);
            toast.success(`成功导入 ${newProducersList.length} 个制作人！${skippedCount ? `跳过 ${skippedCount} 行无效数据。` : ''}`);
        } else {
            toast.error("未能识别出有效的制作人数据，格式为：'组别\t姓名\t定额' 或 '姓名\t定额'");
        }

        setPasteText('');
        setShowPasteModal(null);
    };

    // 解析并导入客户需求量 (多列)
    const importDemands = () => {
        if (!pasteText.trim()) return;

        const lines = pasteText.split('\n');
        const newDemandsList: ClientDemand[] = [];
        let skippedCount = 0;

        let hasHeader = false;
        let pasteDemandTypes = [...demandTypes];
        const firstLine = lines[0]?.trim();
        
        if (firstLine) {
            const firstParts = firstLine.split(/\t|,/);
            const cell0 = firstParts[0]?.trim();
            const cell1 = firstParts[1]?.trim();
            
            if (cell0 === '团队' || cell0 === '部门' || cell1 === '客户' || cell1 === '用户' || cell1 === '名称') {
                hasHeader = true;
                if (firstParts.length > 2) {
                    pasteDemandTypes = firstParts.slice(2).map(t => t.trim() || '通用');
                }
            }
        }

        const startIndex = hasHeader ? 1 : 0;

        for (let i = startIndex; i < lines.length; i++) {
            const trimmed = lines[i].trim();
            if (!trimmed) continue;

            const parts = trimmed.split(/\t|,/);
            const team = parts[0]?.trim() || '通用团队';
            const clientName = parts[1]?.trim();

            if (!clientName) {
                skippedCount++;
                continue;
            }

            if (parts.length > 2) {
                for (let colIdx = 2; colIdx < parts.length; colIdx++) {
                    const qtyStr = parts[colIdx]?.trim();
                    const qty = qtyStr ? parseFloat(qtyStr) : 0;
                    
                    let dType = '通用';
                    if (hasHeader) {
                        dType = pasteDemandTypes[colIdx - 2] || '通用';
                    } else {
                        dType = demandTypes[colIdx - 2] || (colIdx === 2 ? '通用' : `需求类型${colIdx - 1}`);
                    }

                    if (!isNaN(qty) && qty > 0) {
                        newDemandsList.push({
                            id: `d_imported_${Date.now()}_${i}_${colIdx}`,
                            team,
                            clientName,
                            demandType: dType,
                            totalQuantity: qty
                        });

                        if (!pasteDemandTypes.includes(dType)) {
                            pasteDemandTypes.push(dType);
                        }
                    }
                }
            } else {
                skippedCount++;
            }
        }

        if (newDemandsList.length > 0) {
            setDemands(prev => [...prev, ...newDemandsList]);
            setDemandTypes(pasteDemandTypes);
            toast.success(`成功解析并导入 ${newDemandsList.length} 个非零客户需求列！${skippedCount ? `跳过 ${skippedCount} 条无效记录。` : ''}`);
        } else {
            toast.error("未能识别到有效的需求数据，格式为：'团队\t客户名称\t需求A数量\t需求B数量...'");
        }

        setPasteText('');
        setShowPasteModal(null);
    };

    // 解析并导入补录分配情况 (三列：需求人、分配量、制作人)
    const importAllocations = () => {
        if (!pasteText.trim()) return;

        const lines = pasteText.split('\n');
        let successCount = 0;
        let skipCount = 0;
        let warningLines: string[] = [];

        // 深度拷贝已有的分配矩阵
        const newAllocations = JSON.parse(JSON.stringify(allocations));

        lines.forEach((line, index) => {
            const trimmedLine = line.trim();
            if (!trimmedLine) return;

            // 如果是表头（包含“需求人”或“制作人”等关键词），自动忽略
            if (index === 0 && (trimmedLine.includes('需求人') || trimmedLine.includes('制作人') || trimmedLine.includes('需求量') || trimmedLine.includes('客户'))) {
                return;
            }

            // 支持 Tab 或逗号分隔
            const parts = trimmedLine.split(/\t|,/);
            if (parts.length < 3) {
                skipCount++;
                return;
            }

            const clientNameInput = parts[0].trim();
            const quantityInput = parseInt(parts[1].trim(), 10);
            const producerNameInput = parts[2].trim();

            if (!clientNameInput || isNaN(quantityInput) || !producerNameInput) {
                skipCount++;
                return;
            }

            // 1. 匹配制作人姓名 (忽略大小写与前后空格)
            const matchedProducer = producers.find(p => p.name.toLowerCase() === producerNameInput.toLowerCase());

            if (!matchedProducer) {
                warningLines.push(`第 ${index + 1} 行: 找不到制作人 “${producerNameInput}”，已跳过该行分配。`);
                skipCount++;
                return;
            }

            // 2. 匹配客户需求人 (优先完全相同，其次包含关系，最后组合名匹配)
            let matchedDemands = demands.filter(d => d.clientName.toLowerCase() === clientNameInput.toLowerCase());

            if (matchedDemands.length === 0) {
                matchedDemands = demands.filter(d => {
                    const combined = `${d.team}-${d.clientName}-${d.demandType}`.toLowerCase();
                    return combined.includes(clientNameInput.toLowerCase()) || 
                           clientNameInput.toLowerCase().includes(d.clientName.toLowerCase());
                });
            }

            if (matchedDemands.length === 0) {
                warningLines.push(`第 ${index + 1} 行: 找不到客户需求列 “${clientNameInput}”，已跳过该行分配。`);
                skipCount++;
                return;
            }

            // 如果该客户对应多个需求分类，优先选择目前仍有未分配额度的需求类型，否则默认第一个
            let targetDemand = matchedDemands[0];
            if (matchedDemands.length > 1) {
                const withGap = matchedDemands.find(d => {
                    const stats = demandStats[d.id] || { allocated: 0, unallocated: d.totalQuantity };
                    return stats.unallocated > 0;
                });
                if (withGap) {
                    targetDemand = withGap;
                }
            }

            // 3. 填入分配矩阵 (原来的定额和总需求量不要动，只写入分配值)
            if (!newAllocations[matchedProducer.id]) {
                newAllocations[matchedProducer.id] = {};
            }
            newAllocations[matchedProducer.id][targetDemand.id] = quantityInput;
            successCount++;
        });

        setAllocations(newAllocations);
        setPasteText('');
        setShowPasteModal(null);

        if (warningLines.length > 0) {
            toast.warning(`分配补录完成：成功补录 ${successCount} 个单元格分配。有 ${skipCount} 条记录跳过/未匹配，请按 F12 在控制台查看日志提示。`);
            console.warn("工作分配直接导入跳过日志:\n" + warningLines.join('\n'));
        } else {
            toast.success(`🎉 成功补录 ${successCount} 个单元格的分配数据！`);
        }
    };

    // ==========================================
    // 6. 配置面板操作 (添加、删除、编辑)
    // ==========================================
    
    // 添加制作人
    const handleAddProducer = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newProducerName.trim()) return;

        const newP: Producer = {
            id: `p_${Date.now()}`,
            group: newProducerGroup.trim() || '通用组',
            name: newProducerName.trim(),
            quota: newProducerQuota,
            designatedClients: newProducerDesignated
        };

        setProducers(prev => [...prev, newP]);
        setNewProducerName('');
        setNewProducerGroup('');
        setNewProducerQuota(40);
        setNewProducerDesignated([]);
        toast.success(`成功添加制作人 ${newP.name}！`);
    };

    // 开始编辑制作人
    const startEditProducer = (p: Producer) => {
        setEditingProducerId(p.id);
        setEditProducerGroup(p.group || '通用组');
        setEditProducerName(p.name);
        setEditProducerQuota(p.quota);
    };

    // 保存编辑制作人
    const saveProducerEdit = (id: string) => {
        if (!editProducerName.trim()) {
            toast.warning("制作人姓名不能为空！");
            return;
        }

        setProducers(prev => prev.map(p => {
            if (p.id !== id) return p;
            return {
                ...p,
                group: editProducerGroup.trim() || '通用组',
                name: editProducerName.trim(),
                quota: editProducerQuota
            };
        }));
        setEditingProducerId(null);
        toast.success("已更新制作人信息。");
    };

    // 删除制作人
    const handleDeleteProducer = (id: string) => {
        const prod = producers.find(p => p.id === id);
        showConfirm("删除制作人", `确定要删除制作人“${prod?.name || ''}”吗？对应的分配数据也会被清空。`, () => {
            setProducers(prev => prev.filter(p => p.id !== id));
            setAllocations(prev => {
                const updated = { ...prev };
                delete updated[id];
                return updated;
            });
            toast.success("已成功删除制作人。");
        });
    };

    // 修改专属对接客户
    const toggleProducerDesignated = (pId: string, clientName: string) => {
        setProducers(prev => prev.map(p => {
            if (p.id !== pId) return p;
            const exists = p.designatedClients.includes(clientName);
            return {
                ...p,
                designatedClients: exists 
                    ? p.designatedClients.filter(c => c !== clientName)
                    : [...p.designatedClients, clientName]
            };
        }));
    };

    // 添加客户需求
    const handleAddDemand = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newDemandClient.trim()) return;

        const newD: ClientDemand = {
            id: `d_${Date.now()}`,
            team: newDemandTeam.trim() || '通用团队',
            clientName: newDemandClient.trim(),
            demandType: newDemandType || '通用',
            totalQuantity: newDemandQty
        };

        setDemands(prev => [...prev, newD]);
        setNewDemandClient('');
        setNewDemandTeam('');
        setNewDemandQty(10);
        toast.success(`成功添加 ${newD.team} 团队下 ${newD.clientName} 的 ${newD.demandType} 需求列！`);
    };

    // 开始编辑客户需求列
    const startEditDemand = (d: ClientDemand) => {
        setEditingDemandId(d.id);
        setEditDemandTeam(d.team || '');
        setEditDemandClient(d.clientName);
        setEditDemandType(d.demandType);
        setEditDemandQty(d.totalQuantity);
    };

    // 保存编辑客户需求列
    const saveDemandEdit = (id: string) => {
        if (!editDemandClient.trim()) {
            toast.warning("客户名称不能为空！");
            return;
        }

        setDemands(prev => prev.map(d => {
            if (d.id !== id) return d;
            return {
                ...d,
                team: editDemandTeam.trim() || '通用团队',
                clientName: editDemandClient.trim(),
                demandType: editDemandType,
                totalQuantity: editDemandQty
            };
        }));
        setEditingDemandId(null);
        toast.success("已更新客户需求配置。");
    };

    // 删除需求列
    const handleDeleteDemand = (id: string) => {
        const dem = demands.find(d => d.id === id);
        showConfirm("删除需求列", `确定要删除 “${dem?.clientName || ''} - ${dem?.demandType || ''}” 配置列吗？对应的指派数量也会被清空。`, () => {
            setDemands(prev => prev.filter(d => d.id !== id));
            setAllocations(prev => {
                const updated = { ...prev };
                Object.keys(updated).forEach(pId => {
                    if (updated[pId]) {
                        delete updated[pId][id];
                    }
                });
                return updated;
            });
            toast.success("已成功删除需求列。");
        });
    };

    // 添加自定义类型
    const handleAddCustomType = (e: React.FormEvent) => {
        e.preventDefault();
        if (!newCustomType.trim()) return;
        setDemandTypes(prev => {
            if (prev.includes(newCustomType.trim())) return prev;
            return [...prev, newCustomType.trim()];
        });
        setNewDemandType(newCustomType.trim());
        setNewCustomType('');
        toast.success(`成功添加需求类型 “${newCustomType}”！`);
    };

    // 开始编辑需求类型
    const startEditDemandType = (index: number, typeName: string) => {
        setEditingTypeIndex(index);
        setEditTypeName(typeName);
    };

    // 保存编辑需求类型
    const saveDemandTypeEdit = (index: number) => {
        const oldName = demandTypes[index];
        const newName = editTypeName.trim();

        if (!newName) {
            toast.warning("需求类型名称不能为空！");
            return;
        }

        if (demandTypes.includes(newName) && oldName !== newName) {
            toast.warning("该需求类型名称已存在！");
            return;
        }

        setDemandTypes(prev => prev.map((t, idx) => idx === index ? newName : t));
        
        setDemands(prev => prev.map(d => {
            if (d.demandType !== oldName) return d;
            return { ...d, demandType: newName };
        }));

        setEditingTypeIndex(null);
        toast.success(`成功将 “${oldName}” 重命名为 “${newName}”！`);
    };

    // 删除自定义类型
    const handleDeleteCustomType = (type: string) => {
        showConfirm("删除需求类型", `确定要删除类型“${type}”吗？若有已经创建的客户需求使用该类型，它们的类型标识分类依然保留。`, () => {
            setDemandTypes(prev => prev.filter(t => t !== type));
            if (newDemandType === type) {
                setNewDemandType(DEFAULT_DEMAND_TYPES[0]);
            }
            toast.success("已成功删除需求类型选项。");
        });
    };

    // ==========================================
    // 7. 配置全量备份导入导出 (JSON 文件)
    // ==========================================
    
    // 导出完整的 json 配置文件
    const handleExportConfig = () => {
        const completeConfig = {
            version: 'ta-config-v3',
            timestamp: new Date().toISOString(),
            producers,
            demands,
            allocations,
            demandTypes
        };

        const configStr = JSON.stringify(completeConfig, null, 2);
        const blob = new Blob([configStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = `工作分配规划配置_${new Date().toISOString().slice(0,10)}.json`;
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success("完整配置规划已成功导出为 JSON 文件！");
    };

    // 触发隐藏 of file input
    const triggerFileImport = () => {
        fileInputRef.current?.click();
    };

    // 处理导入的配置文件
    const handleImportConfig = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (event) => {
            try {
                const jsonText = event.target?.result as string;
                const imported = JSON.parse(jsonText);

                if (!imported.producers || !imported.demands || !imported.allocations || !imported.demandTypes) {
                    toast.error("导入文件失败：文件格式不正确，缺少核心配置信息！");
                    return;
                }

                setProducers(imported.producers);
                setDemands(imported.demands);
                setAllocations(imported.allocations);
                setDemandTypes(imported.demandTypes);

                toast.success("🎉 全量分配规划配置已成功导入并加载！");
            } catch (err) {
                console.error(err);
                toast.error("导入配置文件解析错误，请确认是否为导出的 .json 格式文件。");
            }
        };
        reader.readAsText(file);
        e.target.value = '';
    };

    // ==========================================
    // 8. 导出报表数据 (Markdown/CSV/Excel-TSV)
    // ==========================================
    
    // 生成 Markdown 报表字符 (包含制作人组别和客户大团队)
    const markdownReport = useMemo(() => {
        if (sortedProducers.length === 0 || sortedDemands.length === 0) return '暂无分配数据';

        let md = `| 组别 | 制作人 | 定额 | 已分配 | 饱和度 | ` + sortedDemands.map(d => `${d.team || '未分类'}-${d.clientName}(${d.demandType})[总:${d.totalQuantity}]`).join(' | ') + ' |\n';
        md += `| :--- | :--- | :--- | :--- | :--- | ` + sortedDemands.map(() => ':---').join(' | ') + ' |\n';

        sortedProducers.forEach(p => {
            const stats = producerStats[p.id];
            md += `| ${p.group || '通用组'} | **${p.name}** | ${p.quota} | ${stats.total} | ${stats.percent}% | `;
            md += sortedDemands.map(d => allocations[p.id]?.[d.id] || 0).join(' | ') + ' |\n';
        });

        md += `| **未分配剩余** | - | - | - | - | `;
        md += sortedDemands.map(d => demandStats[d.id]?.unallocated).join(' | ') + ' |\n';

        return md;
    }, [sortedProducers, sortedDemands, allocations, producerStats, demandStats]);

    // 生成 CSV 报表并触发下载
    const downloadCSV = () => {
        if (sortedProducers.length === 0 || sortedDemands.length === 0) return;

        let csvContent = '\uFEFF';
        
        const headers = ['制作人组别', '制作人姓名', '容量定额', '已分配总量', '饱和度'];
        sortedDemands.forEach(d => {
            headers.push(`${d.team || '未分类'}-${d.clientName}-${d.demandType}(总:${d.totalQuantity})`);
        });
        csvContent += headers.map(h => `"${h}"`).join(',') + '\n';

        sortedProducers.forEach(p => {
            const stats = producerStats[p.id];
            const row: (string | number)[] = [p.group || '通用组', p.name, p.quota, stats.total, `${stats.percent}%`];
            sortedDemands.forEach(d => {
                row.push(allocations[p.id]?.[d.id] || 0);
            });
            csvContent += row.join(',') + '\n';
        });

        const footerRow: (string | number)[] = ['未分配剩余需求', '-', '-', '-', '-'];
        sortedDemands.forEach(d => {
            footerRow.push(demandStats[d.id]?.unallocated ?? 0);
        });
        csvContent += footerRow.join(',') + '\n';

        const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
        const link = document.createElement('a');
        const url = URL.createObjectURL(blob);
        link.setAttribute('href', url);
        link.setAttribute('download', `工作分配定额矩阵_${new Date().toISOString().slice(0,10)}.csv`);
        link.style.visibility = 'hidden';
        document.body.appendChild(link);
        link.click();
        document.body.removeChild(link);
        toast.success("CSV 分配矩阵表已成功导出！");
    };

    // 复制 Markdown 表格到剪贴板
    const copyMarkdown = () => {
        navigator.clipboard.writeText(markdownReport).then(() => {
            toast.success('Markdown 分配报表已复制到剪贴板！');
        });
    };

    // 复制为 Excel/Google Sheets 兼容的 Tab 分隔文本（支持转置与公式计算）
    const copySpreadsheetFormat = () => {
        if (sortedProducers.length === 0 || sortedDemands.length === 0) return;

        // 辅助函数：将列索引（0开始）转换为 Excel 列字母（A, B, C... AA, AB...）
        const getExcelColLetter = (index: number): string => {
            let temp = index;
            let letter = '';
            while (temp >= 0) {
                letter = String.fromCharCode((temp % 26) + 65) + letter;
                temp = Math.floor(temp / 26) - 1;
            }
            return letter;
        };

        let tsv = '';

        if (transposeOnCopy) {
            // ==========================================
            // 转置布局：横向是制作人，竖向是客户需求列
            // ==========================================
            // A (0) -> 团队
            // B (1) -> 客户名称
            // C (2) -> 需求类型
            // D (3) -> 总需求量
            // E (4) 到 lastProducerColLetter -> 各制作人
            const firstProducerColIdx = 4;
            const lastProducerColIdx = firstProducerColIdx + sortedProducers.length - 1;
            
            const firstProducerColLetter = getExcelColLetter(firstProducerColIdx);
            const lastProducerColLetter = getExcelColLetter(lastProducerColIdx);

            // 第一行表头：制作人组别
            const h1 = ['团队', '客户名称', '需求类型', '总需求量', ...sortedProducers.map(p => p.group || '通用组'), '未分配剩余'];
            tsv += h1.join('\t') + '\n';

            // 第二行表头：制作人姓名
            const h2 = ['', '', '', '', ...sortedProducers.map(p => p.name), ''];
            tsv += h2.join('\t') + '\n';

            // 第三行表头：容量限额（纯数字，便于底部的饱和度公式计算引用）
            const h3 = ['容量限额', '', '', '', ...sortedProducers.map(p => p.quota), ''];
            tsv += h3.join('\t') + '\n';

            // 需求数据行：从第4行开始 (Excel 行号 r = 4)
            sortedDemands.forEach((d, idx) => {
                const r = 4 + idx; // Excel 行号
                
                // 每一个制作人在该需求下的指派数
                const allocationsRow = sortedProducers.map(p => allocations[p.id]?.[d.id] || 0);

                // 未分配剩余公式：=D{r}-SUM(E{r}:{lastProducerColLetter}{r})
                const gapFormula = `=D${r}-SUM(${firstProducerColLetter}${r}:${lastProducerColLetter}${r})`;

                const row = [
                    d.team || '未分类团队',
                    d.clientName,
                    d.demandType,
                    d.totalQuantity,
                    ...allocationsRow,
                    gapFormula
                ];
                tsv += row.join('\t') + '\n';
            });

            // 倒数第二行：已分配总量行 (Excel 行号 allocatedSumRow = 4 + sortedDemands.length)
            const allocatedSumRow = 4 + sortedDemands.length;
            const allocatedSumFormulas = sortedProducers.map((p, idx) => {
                const colLetter = getExcelColLetter(firstProducerColIdx + idx);
                return `=SUM(${colLetter}4:${colLetter}${allocatedSumRow - 1})`;
            });

            const footerSum = [
                '已分配总量',
                '',
                '',
                '',
                ...allocatedSumFormulas,
                '-'
            ];
            tsv += footerSum.join('\t') + '\n';

            // 最后一行：饱和度行 (Excel 行号 saturationRow = 5 + sortedDemands.length)
            const saturationRow = 5 + sortedDemands.length;
            const saturationFormulas = sortedProducers.map((p, idx) => {
                const colLetter = getExcelColLetter(firstProducerColIdx + idx);
                // 引用第3行的容量限额 L3
                return `=IF(${colLetter}3>0, ${colLetter}${allocatedSumRow}/${colLetter}3, 0)`;
            });

            const footerSat = [
                '饱和度',
                '',
                '',
                '',
                ...saturationFormulas,
                '-'
            ];
            tsv += footerSat.join('\t') + '\n';

        } else {
            // ==========================================
            // 标准布局：横向是需求，竖向是制作人
            // ==========================================
            const firstDemandColIdx = 3;
            const lastDemandColIdx = firstDemandColIdx + sortedDemands.length - 1;
            
            const firstDemandColLetter = getExcelColLetter(firstDemandColIdx);
            const lastDemandColLetter = getExcelColLetter(lastDemandColIdx);
            
            const allocatedColLetter = getExcelColLetter(lastDemandColIdx + 1);
            const saturationColLetter = getExcelColLetter(lastDemandColIdx + 2);

            // 第一行：团队/大组分类表头
            const h1 = ['组别', '制作人', '定额上限', ...sortedDemands.map(d => d.team || '未分类团队'), '已分配总量', '饱和度'];
            tsv += h1.join('\t') + '\n';

            // 第二行：客户名称表头
            const h2 = ['', '', '', ...sortedDemands.map(d => d.clientName), '', ''];
            tsv += h2.join('\t') + '\n';

            // 第三行：具体需求类型表头
            const h3 = ['', '', '', ...sortedDemands.map(d => d.demandType), '', ''];
            tsv += h3.join('\t') + '\n';

            // 第四行：总需求量指标（作为纯数字写入，便于下方公式引用计算）
            const h4 = ['总需求量指标', '', '', ...sortedDemands.map(d => d.totalQuantity), '', ''];
            tsv += h4.join('\t') + '\n';

            // 制作人数据行 (从第5行开始，对应 Excel 行号 r = 5)
            sortedProducers.forEach((p, idx) => {
                const r = 5 + idx; // Excel 中的行号
                
                // 每一个制作人的单元格分配数据
                const allocationsRow = sortedDemands.map(d => allocations[p.id]?.[d.id] || 0);

                // 总量公式：=SUM(D{r}:{lastDemandColLetter}{r})
                const totalFormula = `=SUM(${firstDemandColLetter}${r}:${lastDemandColLetter}${r})`;
                
                // 饱和度公式：=IF(C{r}>0, {allocatedColLetter}{r}/C{r}, 0)
                const satFormula = `=IF(C${r}>0, ${allocatedColLetter}${r}/C${r}, 0)`;

                const row = [
                    p.group || '通用组',
                    p.name,
                    p.quota,
                    ...allocationsRow,
                    totalFormula,
                    satFormula
                ];
                tsv += row.join('\t') + '\n';
            });

            // 最后一列：未分配剩余需求 (Excel 行号 gapRow = 5 + sortedProducers.length)
            const gapRow = 5 + sortedProducers.length;
            
            // 缺口行各列的公式列表：每个需求列 L 对应的公式为：=L4-SUM(L5:L{gapRow-1})
            const gapFormulas = sortedDemands.map((d, idx) => {
                const colLetter = getExcelColLetter(firstDemandColIdx + idx);
                return `=${colLetter}4-SUM(${colLetter}5:${colLetter}${gapRow - 1})`;
            });

            const footer = [
                '未分配剩余需求',
                '',
                '',
                ...gapFormulas,
                '-',
                '-'
            ];
            tsv += footer.join('\t') + '\n';
        }

        navigator.clipboard.writeText(tsv).then(() => {
            toast.success(
                transposeOnCopy 
                    ? '📋 已复制转置分配数据！已内置 SUM/IF/Gap 自动统计公式！' 
                    : '📋 复制成功！已为您携带 Excel/Google 表格计算公式！粘贴后修改分配，各列和总数将自动计算！'
            );
        }).catch(err => {
            console.error(err);
            toast.error('复制失败，请赋予浏览器剪贴板权限或重试。');
        });
    };

    // ==========================================
    // 9. 辅助提取客户列表 (用于专属配置下拉)
    // ==========================================
    const allClientNames = useMemo(() => {
        const clientSet = new Set<string>();
        demands.forEach(d => clientSet.add(d.clientName));
        return Array.from(clientSet);
    }, [demands]);

    // 渲染时辅助去重记录哪些制作人组别已经输出过 Rowspan
    const renderedGroupRowspans = new Set<string>();


    return (
        <div className="task-allocation-container">
            {/* 隐藏的文件导入框 */}
            <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                accept=".json"
                onChange={handleImportConfig}
            />

            {/* ==========================================
                顶部状态栏
               ========================================== */}
            <div className="matrix-header">
                <div className="matrix-title-section">
                    <h2>📊 制作人-客户工作分配矩阵 (按组别级联)</h2>
                    <p>左侧固定组别与人名，横向平滑滚动；顶部按“大组/团队”实时汇总件数。支持 Excel/Sheets 直接粘贴多列内容。</p>
                </div>
                
                <div className="matrix-stats-panel">
                    <div className="stat-card-mini">
                        <span className="stat-label">总客户需求</span>
                        <span className="stat-val">{globalStats.totalDemandQty} 件</span>
                    </div>
                    <div className="stat-card-mini">
                        <span className="stat-label">总已分配量</span>
                        <span className="stat-val" style={{ color: '#a855f7' }}>{globalStats.totalAllocatedQty} 件</span>
                    </div>
                    <div className="stat-card-mini">
                        <span className="stat-label">制作人平均饱和度</span>
                        <span className={`stat-val ${globalStats.avgSaturation > 100 ? 'error' : globalStats.avgSaturation >= 80 ? 'warning' : ''}`}>
                            {globalStats.avgSaturation}%
                        </span>
                    </div>
                </div>
            </div>

            {/* ==========================================
                快捷操作控制栏
               ========================================== */}
            <div className="matrix-controls-bar">
                <div className="matrix-actions-left">
                    <Button 
                        variant="primary" 
                        icon={<FileSpreadsheet size={16} />}
                        onClick={() => setShowPasteModal('producers')}
                    >
                        批量导入制作人
                    </Button>
                    <Button 
                        variant="primary" 
                        icon={<FileSpreadsheet size={16} />}
                        onClick={() => setShowPasteModal('demands')}
                    >
                        批量导入需求量 (多列)
                    </Button>
                    <Button 
                        variant="primary" 
                        icon={<FileSpreadsheet size={16} />}
                        onClick={() => setShowPasteModal('allocations')}
                    >
                        批量导入分配值 (三列)
                    </Button>
                    <Button 
                        variant="ghost" 
                        icon={<RefreshCw size={16} />}
                        onClick={clearAllocations}
                    >
                        清空矩阵分配
                    </Button>
                </div>

                <div className="matrix-actions-right">
                    <Button 
                        variant="secondary" 
                        icon={<Upload size={16} />}
                        onClick={triggerFileImport}
                    >
                        导入配置规划 (JSON)
                    </Button>
                    <Button 
                        variant="secondary" 
                        icon={<Download size={16} />}
                        onClick={handleExportConfig}
                    >
                        导出配置规划 (JSON)
                    </Button>
                    <Button 
                        variant="secondary" 
                        icon={<Download size={16} />}
                        onClick={downloadCSV}
                        disabled={producers.length === 0}
                    >
                        导出 CSV
                    </Button>
                    <label 
                        className="transpose-checkbox-label"
                        style={{ 
                            display: 'flex', 
                            alignItems: 'center', 
                            gap: '6px', 
                            fontSize: '12px', 
                            cursor: 'pointer', 
                            color: 'var(--text-muted-color)',
                            userSelect: 'none',
                            marginRight: '8px'
                        }}
                    >
                        <input 
                            type="checkbox" 
                            checked={transposeOnCopy}
                            onChange={(e) => setTransposeOnCopy(e.target.checked)}
                            style={{ 
                                cursor: 'pointer',
                                accentColor: '#a855f7'
                            }}
                        />
                        <span>复制时转置 (横向制作人)</span>
                    </label>
                    <Button 
                        variant="secondary" 
                        icon={<Copy size={16} />}
                        onClick={copySpreadsheetFormat}
                        disabled={producers.length === 0}
                    >
                        复制表格格式
                    </Button>
                    <Button 
                        variant="secondary" 
                        icon={<Copy size={16} />}
                        onClick={() => setShowExportModal(true)}
                        disabled={producers.length === 0}
                    >
                        复制 Markdown 报表
                    </Button>
                    
                    <div className="config-btn-group">
                        <button 
                            className={`config-tab-btn ${showConfigPanel ? 'active' : ''}`}
                            onClick={() => setShowConfigPanel(!showConfigPanel)}
                        >
                            <Settings size={14} style={{ marginRight: 4, display: 'inline-block', verticalAlign: 'middle' }} />
                            {showConfigPanel ? '隐藏配置面板' : '显示配置面板'}
                        </button>
                    </div>
                </div>
            </div>

            {/* ==========================================
                核心三层二维矩阵表格 (横向滚动防挤压)
               ========================================== */}
            <div className="matrix-table-wrapper">
                {producers.length === 0 || sortedDemands.length === 0 ? (
                    <Flex align="center" justify="center" direction="col" style={{ height: '300px', gap: '16px' }}>
                        <Grid size={48} style={{ color: 'var(--text-muted-color)', opacity: 0.5 }} />
                        <div style={{ color: 'var(--text-muted-color)', fontSize: '15px' }}>
                            暂无分配数据。请先使用上方按钮“批量导入”或在下方“配置面板”中手动添加制作人与需求量。
                        </div>
                        <Button variant="primary" onClick={resetToDefault}>加载示例演示数据</Button>
                    </Flex>
                ) : (
                    <table className="matrix-table">
                        <thead>
                            {/* 第一层表头：团队（Team）以及已分/总数 自动组统计 */}
                            <tr className="header-row-1">
                                <th className="col-group col-sticky-group" style={{ zIndex: 30 }} rowSpan={3}>
                                    组别
                                </th>
                                <th className="col-producer col-sticky-producer" style={{ zIndex: 30 }} rowSpan={3}>
                                    制作人
                                </th>
                                {teamGroups.map((g, idx) => (
                                    <th 
                                        key={`team-g-${idx}`} 
                                        colSpan={g.span} 
                                        className="client-header-group"
                                        style={{ background: '#1c1c24', borderBottom: '1px solid rgba(255, 255, 255, 0.1)' }}
                                    >
                                        👥 {g.team}
                                        <span style={{ display: 'block', fontSize: '10px', fontWeight: 'normal', color: '#60a5fa', marginTop: '2px' }}>
                                            (已分配: {g.totalAllocated} / 总需求: {g.totalDemand} 件)
                                        </span>
                                    </th>
                                ))}
                                <th className="col-saturation col-sticky-saturation" style={{ zIndex: 30 }} rowSpan={3}>
                                    分配进度 / 饱和度
                                </th>
                            </tr>
                            
                            {/* 第二层表头：客户名称（Client） */}
                            <tr className="header-row-2">
                                {clientGroups.map((g, idx) => (
                                    <th 
                                        key={`client-g-${idx}`} 
                                        colSpan={g.span}
                                        style={{ background: '#14151c', color: '#e5e7eb', borderBottom: '1px solid rgba(255, 255, 255, 0.08)' }}
                                    >
                                        🏢 {g.clientName}
                                        {clientResponsibilityMap[g.clientName]?.length > 0 && (
                                            <span className="header-responsible-label" style={{ fontSize: '9px', marginTop: '1px' }}>
                                                (负责: {clientResponsibilityMap[g.clientName].join(',')})
                                            </span>
                                        )}
                                    </th>
                                ))}
                            </tr>
                            
                            {/* 第三层表头：需求分类标识 */}
                            <tr className="header-row-2">
                                {sortedDemands.map(d => (
                                    <th 
                                        key={`d-header-${d.id}`} 
                                        className={`col-demand ${hoveredCol === d.id ? 'col-hovered' : ''}`}
                                        style={{ background: '#101012', fontSize: '11px', color: 'var(--text-muted-color)' }}
                                        onMouseEnter={() => setHoveredCol(d.id)}
                                        onMouseLeave={() => setHoveredCol(null)}
                                    >
                                        <Badge variant="default" size="sm">{d.demandType}</Badge>
                                        <div style={{ marginTop: '2px', fontWeight: 'bold' }}>总: {d.totalQuantity}</div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        
                        <tbody>
                            {/* 制作人列表数据行 */}
                            {sortedProducers.map(p => {
                                const stats = producerStats[p.id] || { total: 0, percent: 0, status: 'under' };
                                const groupName = p.group || '通用组';
                                const shouldRenderGroupCell = !renderedGroupRowspans.has(groupName);
                                
                                if (shouldRenderGroupCell) {
                                    renderedGroupRowspans.add(groupName);
                                }
                                
                                return (
                                    <tr key={`p-row-${p.id}`}>
                                        {/* 组别列：同一组内垂直合并单元格 */}
                                        {shouldRenderGroupCell && (
                                            <td 
                                                className="col-sticky-group" 
                                                rowSpan={producerGroupSpans[groupName]}
                                            >
                                                {groupName}
                                            </td>
                                        )}

                                        {/* 固定第二列：制作人姓名与容量限制 */}
                                        <td className="col-sticky-producer">
                                            <div className="producer-info-cell">
                                                <div className="producer-name">
                                                    <UserCheck size={14} style={{ color: '#a855f7' }} />
                                                    {p.name}
                                                </div>
                                                <div className="producer-limits">
                                                    定额限值: {p.quota} 件
                                                </div>
                                                {p.designatedClients.length > 0 && (
                                                    <div className="producer-responsibilities" title={p.designatedClients.join(', ')}>
                                                        专属: {p.designatedClients.join(', ')}
                                                    </div>
                                                )}
                                            </div>
                                        </td>
                                        
                                        {/* 客户需求分配矩阵格 */}
                                        {sortedDemands.map(d => {
                                            const isDesignated = isDesignatedCell(p, d);
                                            const val = allocations[p.id]?.[d.id] || 0;
                                            
                                            return (
                                                <td 
                                                    key={`cell-${p.id}-${d.id}`} 
                                                    className={`${isDesignated ? 'cell-designated' : ''} ${hoveredCol === d.id ? 'col-hovered' : ''}`}
                                                    onMouseEnter={() => setHoveredCol(d.id)}
                                                    onMouseLeave={() => setHoveredCol(null)}
                                                >
                                                    <div className="cell-input-wrapper">
                                                        <input 
                                                            type="number"
                                                            className={`matrix-cell-input ${val === 0 ? 'zero-val' : ''}`}
                                                            value={val === 0 ? '' : val}
                                                            placeholder="0"
                                                            onChange={(e) => handleCellChange(p.id, d.id, e.target.value)}
                                                        />
                                                        {isDesignated && <div className="designated-tag-indicator" title="专属责任格" />}
                                                    </div>
                                                </td>
                                            );
                                        })}
                                        
                                        {/* 固定尾列：饱和度指示器 */}
                                        <td className="col-sticky-saturation">
                                            <div className="saturation-wrapper">
                                                <div className="saturation-text">
                                                    <span>{stats.total} / {p.quota} 件</span>
                                                    <span className={`sat-${stats.status}`}>{stats.percent}%</span>
                                                </div>
                                                <div className="saturation-bar-bg">
                                                    <div 
                                                        className={`saturation-bar-fill sat-${stats.status}-bg`} 
                                                        style={{ width: `${Math.min(stats.percent, 100)}%` }}
                                                    />
                                                </div>
                                            </div>
                                        </td>
                                    </tr>
                                );
                            })}
                            
                            {/* 表尾行：未分配剩余需求 */}
                            <tr className="row-unallocated">
                                <td className="col-sticky-producer" style={{ left: 0, zIndex: 15, borderRight: '2px solid rgba(255, 255, 255, 0.15)' }} colSpan={2}>
                                    <span style={{ fontWeight: 'bold', color: '#f59e0b', paddingLeft: '8px' }}>未分配剩余需求</span>
                                </td>
                                
                                {sortedDemands.map(d => {
                                    const stats = demandStats[d.id] || { allocated: 0, unallocated: 0, status: 'safe' };
                                    
                                    return (
                                        <td 
                                            key={`unallocated-cell-${d.id}`}
                                            className={hoveredCol === d.id ? 'col-hovered' : ''}
                                            onMouseEnter={() => setHoveredCol(d.id)}
                                            onMouseLeave={() => setHoveredCol(null)}
                                        >
                                            <span className={`unallocated-badge ${stats.unallocated === 0 ? 'safe' : 'warning'}`}>
                                                {stats.unallocated === 0 ? '已分完' : `余 ${stats.unallocated}`}
                                            </span>
                                        </td>
                                    );
                                })}
                                
                                <td className="col-sticky-saturation">
                                    <div style={{ fontSize: '11px', color: 'var(--text-muted-color)' }}>
                                        总需求: {globalStats.totalDemandQty} 件
                                    </div>
                                </td>
                            </tr>
                        </tbody>
                    </table>
                )}
            </div>

            {/* ==========================================
                下方可折叠配置管理面板
               ========================================== */}
            <div className="matrix-config-section" style={{ marginTop: '24px' }}>
                <div 
                    className="config-section-header" 
                    onClick={() => setShowConfigPanel(!showConfigPanel)}
                    style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'center',
                        padding: '12px 16px',
                        background: 'rgba(255, 255, 255, 0.02)',
                        borderBottom: showConfigPanel ? '1px solid rgba(255, 255, 255, 0.08)' : 'none',
                        cursor: 'pointer',
                        userSelect: 'none',
                        borderRadius: 'var(--radius-lg) var(--radius-lg) 0 0'
                    }}
                >
                    <h3 style={{ margin: 0, fontSize: '13px', display: 'flex', alignItems: 'center', gap: '8px', color: '#e5e7eb' }}>
                        ⚙️ 制作人与客户需求配置控制台
                        <span style={{ fontSize: '11px', color: 'var(--text-muted-color)', fontWeight: 'normal' }}>
                            ({producers.length} 名制作人 / {demands.length} 个需求列)
                        </span>
                    </h3>
                    <span style={{ fontSize: '12px', color: '#a855f7', fontWeight: 'bold' }}>
                        {showConfigPanel ? '收起配置面板 ▲' : '展开配置面板 ▼'}
                    </span>
                </div>
                
                {showConfigPanel && (
                    <div style={{ padding: '16px' }}>
                        <div style={{ display: 'flex', borderBottom: '1px solid rgba(255, 255, 255, 0.08)', marginBottom: '16px', gap: '8px' }}>
                            <button 
                                className={`config-tab-btn ${activeConfigTab === 'producers' ? 'active' : ''}`}
                                style={{ fontSize: '13px', paddingBottom: '8px', borderRadius: 0, borderBottom: activeConfigTab === 'producers' ? '2px solid #a855f7' : 'none' }}
                                onClick={() => setActiveConfigTab('producers')}
                            >
                            👥 制作人及组别配置 ({producers.length})
                        </button>
                        <button 
                            className={`config-tab-btn ${activeConfigTab === 'demands' ? 'active' : ''}`}
                            style={{ fontSize: '13px', paddingBottom: '8px', borderRadius: 0, borderBottom: activeConfigTab === 'demands' ? '2px solid #a855f7' : 'none' }}
                            onClick={() => setActiveConfigTab('demands')}
                        >
                            🏢 客户需求列管理 ({demands.length})
                        </button>
                        <button 
                            className={`config-tab-btn ${activeConfigTab === 'settings' ? 'active' : ''}`}
                            style={{ fontSize: '13px', paddingBottom: '8px', borderRadius: 0, borderBottom: activeConfigTab === 'settings' ? '2px solid #a855f7' : 'none' }}
                            onClick={() => setActiveConfigTab('settings')}
                        >
                            ⚙️ 基础系统设置
                        </button>
                    </div>

                    <div className="config-grid-layout">
                        {/* TAB 1: 制作人配置 */}
                        {activeConfigTab === 'producers' && (
                            <>
                                {/* 制作人列表展示 */}
                                <div className="config-pane">
                                    <h3>制作人名册</h3>
                                    {producers.length === 0 ? (
                                        <div style={{ color: 'var(--text-muted-color)', fontSize: '12px', padding: '16px 0' }}>暂无制作人，请在右侧添加。</div>
                                    ) : (
                                        <div className="config-list-scroll">
                                            {sortedProducers.map(p => (
                                                <div key={p.id} className="config-item-row" style={{ alignItems: 'flex-start' }}>
                                                    {editingProducerId === p.id ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', paddingRight: '8px' }}>
                                                            <Flex gap={2} style={{ width: '100%' }}>
                                                                <Input 
                                                                    type="text" 
                                                                    value={editProducerGroup} 
                                                                    onChange={(e) => setEditProducerGroup(e.target.value)} 
                                                                    placeholder="组别"
                                                                    style={{ width: '100px', height: '28px', fontSize: '12px' }}
                                                                />
                                                                <Input 
                                                                    type="text" 
                                                                    value={editProducerName} 
                                                                    onChange={(e) => setEditProducerName(e.target.value)} 
                                                                    placeholder="姓名"
                                                                    style={{ height: '28px', fontSize: '12px', flex: 1 }}
                                                                />
                                                                <Input 
                                                                    type="number" 
                                                                    value={editProducerQuota} 
                                                                    onChange={(e) => setEditProducerQuota(parseInt(e.target.value) || 0)} 
                                                                    placeholder="定额"
                                                                    style={{ width: '70px', height: '28px', fontSize: '12px' }}
                                                                />
                                                            </Flex>
                                                            <Flex gap={1} justify="end">
                                                                <Button variant="ghost" size="xs" onClick={() => setEditingProducerId(null)}><X size={12} /></Button>
                                                                <Button variant="primary" size="xs" onClick={() => saveProducerEdit(p.id)} icon={<Save size={10} />}>保存</Button>
                                                            </Flex>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <div className="config-item-info" style={{ flex: 1 }}>
                                                                <span className="config-item-name">
                                                                    <Badge variant="warning" size="sm" style={{ marginRight: 6 }}>{p.group || '通用组'}</Badge>
                                                                    {p.name} 
                                                                    <span style={{ fontSize: '11px', color: '#a855f7', marginLeft: '6px' }}>(定额: {p.quota})</span>
                                                                </span>
                                                                <span className="config-item-meta">
                                                                    专属客户: {p.designatedClients.length > 0 ? p.designatedClients.join(', ') : '无'}
                                                                </span>
                                                                
                                                                {/* 对口专属客户勾选列表 */}
                                                                {allClientNames.length > 0 && (
                                                                    <div style={{ marginTop: '6px' }}>
                                                                        <button 
                                                                            type="button" 
                                                                            className="btn-toggle-tags"
                                                                            style={{
                                                                                fontSize: '11px',
                                                                                background: 'rgba(168, 85, 247, 0.1)',
                                                                                border: '1px solid rgba(168, 85, 247, 0.2)',
                                                                                color: '#c084fc',
                                                                                padding: '2px 8px',
                                                                                borderRadius: '4px',
                                                                                cursor: 'pointer',
                                                                                outline: 'none'
                                                                            }}
                                                                            onClick={() => setActiveProducerDesignatedId(activeProducerDesignatedId === p.id ? null : p.id)}
                                                                        >
                                                                            {activeProducerDesignatedId === p.id ? '收起专属负责配置 ▲' : `配置专属负责 (${p.designatedClients.length}) ▼`}
                                                                        </button>
                                                                        
                                                                        {activeProducerDesignatedId === p.id && (
                                                                            <div className="custom-select-tags" style={{ marginTop: '8px', maxHeight: '120px', overflowY: 'auto', padding: '6px', background: 'rgba(0, 0, 0, 0.25)', borderRadius: '4px', border: '1px solid rgba(255,255,255,0.05)' }}>
                                                                                {allClientNames.map(client => {
                                                                                    const isSelected = p.designatedClients.includes(client);
                                                                                    return (
                                                                                        <button 
                                                                                            key={`${p.id}-tag-${client}`}
                                                                                            type="button"
                                                                                            className={`select-tag-btn ${isSelected ? 'selected' : ''}`}
                                                                                            onClick={() => toggleProducerDesignated(p.id, client)}
                                                                                        >
                                                                                            {client}
                                                                                        </button>
                                                                                    );
                                                                                })}
                                                                            </div>
                                                                        )}
                                                                    </div>
                                                                )}
                                                            </div>
                                                            <Flex gap={1}>
                                                                <Button 
                                                                    variant="ghost" 
                                                                    size="xs"
                                                                    onClick={() => startEditProducer(p)}
                                                                    style={{ color: '#a855f7' }}
                                                                >
                                                                    <Edit2 size={12} />
                                                                </Button>
                                                                <Button 
                                                                    variant="ghost" 
                                                                    size="xs"
                                                                    onClick={() => handleDeleteProducer(p.id)}
                                                                    style={{ color: '#ef4444' }}
                                                                >
                                                                    <Trash2 size={12} />
                                                                </Button>
                                                            </Flex>
                                                        </>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* 添加制作人表单 */}
                                <div className="config-pane">
                                    <h3>添加制作人</h3>
                                    <form onSubmit={handleAddProducer} className="config-add-form" style={{ flexDirection: 'column', gap: '12px' }}>
                                        <Flex gap={2} align="center" style={{ width: '100%', flexWrap: 'wrap' }}>
                                            <div style={{ flex: 1, minWidth: '100px' }}>
                                                <label style={{ fontSize: '11px', color: 'var(--text-muted-color)', display: 'block', marginBottom: '4px' }}>制作人组别/团队</label>
                                                <Input 
                                                    type="text" 
                                                    value={newProducerGroup}
                                                    onChange={(e) => setNewProducerGroup(e.target.value)}
                                                    placeholder="例如：特效组"
                                                    fullWidth
                                                />
                                            </div>
                                            <div style={{ flex: 1.2, minWidth: '120px' }}>
                                                <label style={{ fontSize: '11px', color: 'var(--text-muted-color)', display: 'block', marginBottom: '4px' }}>制作人姓名</label>
                                                <Input 
                                                    type="text" 
                                                    value={newProducerName}
                                                    onChange={(e) => setNewProducerName(e.target.value)}
                                                    placeholder="例如：老王"
                                                    fullWidth
                                                />
                                            </div>
                                            <div style={{ width: '90px' }}>
                                                <label style={{ fontSize: '11px', color: 'var(--text-muted-color)', display: 'block', marginBottom: '4px' }}>定额上限</label>
                                                <Input 
                                                    type="number" 
                                                    value={newProducerQuota}
                                                    onChange={(e) => setNewProducerQuota(parseInt(e.target.value) || 0)}
                                                    placeholder="40"
                                                    fullWidth
                                                />
                                            </div>
                                        </Flex>
                                        <Button variant="primary" type="submit" fullWidth icon={<UserPlus size={16} />}>
                                            确认添加
                                        </Button>
                                    </form>
                                </div>
                            </>
                        )}

                        {/* TAB 2: 需求列配置 */}
                        {activeConfigTab === 'demands' && (
                            <>
                                {/* 需求列名册 */}
                                <div className="config-pane">
                                    <h3>客户需求配置列</h3>
                                    {demands.length === 0 ? (
                                        <div style={{ color: 'var(--text-muted-color)', fontSize: '12px', padding: '16px 0' }}>暂无需求列，请在右侧添加。</div>
                                    ) : (
                                        <div className="config-list-scroll">
                                            {demands.map(d => (
                                                <div key={d.id} className="config-item-row" style={{ alignItems: 'flex-start' }}>
                                                    {editingDemandId === d.id ? (
                                                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', width: '100%', paddingRight: '8px' }}>
                                                            <Flex gap={1} style={{ width: '100%' }}>
                                                                <Input 
                                                                    type="text" 
                                                                    value={editDemandTeam} 
                                                                    onChange={(e) => setEditDemandTeam(e.target.value)} 
                                                                    placeholder="团队/部门"
                                                                    style={{ height: '28px', fontSize: '12px', flex: 0.8 }}
                                                                />
                                                                <Input 
                                                                    type="text" 
                                                                    value={editDemandClient} 
                                                                    onChange={(e) => setEditDemandClient(e.target.value)} 
                                                                    placeholder="客户名"
                                                                    style={{ height: '28px', fontSize: '12px', flex: 1 }}
                                                                />
                                                                <select 
                                                                    value={editDemandType}
                                                                    onChange={(e) => setEditDemandType(e.target.value)}
                                                                    style={{ height: '28px', fontSize: '12px', background: '#0f0f12', border: '1px solid var(--border-color)', borderRadius: '4px', color: '#fff', flex: 1, padding: '0 4px', outline: 'none' }}
                                                                >
                                                                    {demandTypes.map(t => (
                                                                        <option key={`edit-opt-${t}`} value={t}>{t}</option>
                                                                    ))}
                                                                </select>
                                                                <Input 
                                                                    type="number" 
                                                                    value={editDemandQty} 
                                                                    onChange={(e) => setEditDemandQty(parseFloat(e.target.value) || 0)} 
                                                                    placeholder="总量"
                                                                    style={{ width: '60px', height: '28px', fontSize: '12px' }}
                                                                />
                                                            </Flex>
                                                            <Flex gap={1} justify="end">
                                                                <Button variant="ghost" size="xs" onClick={() => setEditingDemandId(null)}><X size={12} /></Button>
                                                                <Button variant="primary" size="xs" onClick={() => saveDemandEdit(d.id)} icon={<Save size={10} />}>保存</Button>
                                                            </Flex>
                                                        </div>
                                                    ) : (
                                                        <>
                                                            <div className="config-item-info" style={{ flex: 1 }}>
                                                                <span className="config-item-name">
                                                                    <Badge variant="info" size="sm" style={{ marginRight: 6 }}>{d.team || '未分类'}</Badge>
                                                                    {d.clientName} - {d.demandType}
                                                                </span>
                                                                <span className="config-item-meta">需求总量: {d.totalQuantity} 件</span>
                                                            </div>
                                                            <Flex gap={1}>
                                                                <Button 
                                                                    variant="ghost" 
                                                                    size="xs"
                                                                    onClick={() => startEditDemand(d)}
                                                                    style={{ color: '#a855f7' }}
                                                                >
                                                                    <Edit2 size={12} />
                                                                </Button>
                                                                <Button 
                                                                    variant="ghost" 
                                                                    size="xs"
                                                                    onClick={() => handleDeleteDemand(d.id)}
                                                                    style={{ color: '#ef4444' }}
                                                                >
                                                                    <Trash2 size={12} />
                                                                </Button>
                                                            </Flex>
                                                        </>
                                                    )}
                                                </div>
                                            ))}
                                        </div>
                                    )}
                                </div>

                                {/* 添加需求列 */}
                                <div className="config-pane">
                                    <h3>添加客户需求列</h3>
                                    <form onSubmit={handleAddDemand} className="config-add-form" style={{ flexDirection: 'column', gap: '12px' }}>
                                        <Flex gap={2} style={{ width: '100%', flexWrap: 'wrap' }}>
                                            <div style={{ flex: 1, minWidth: '100px' }}>
                                                <label style={{ fontSize: '11px', color: 'var(--text-muted-color)', display: 'block', marginBottom: '4px' }}>团队/部门</label>
                                                <Input 
                                                    type="text" 
                                                    value={newDemandTeam}
                                                    onChange={(e) => setNewDemandTeam(e.target.value)}
                                                    placeholder="如：抖音组"
                                                    fullWidth
                                                />
                                            </div>
                                            <div style={{ flex: 1.2, minWidth: '120px' }}>
                                                <label style={{ fontSize: '11px', color: 'var(--text-muted-color)', display: 'block', marginBottom: '4px' }}>客户名称</label>
                                                <Input 
                                                    type="text" 
                                                    value={newDemandClient}
                                                    onChange={(e) => setNewDemandClient(e.target.value)}
                                                    placeholder="如：字节跳动"
                                                    fullWidth
                                                />
                                            </div>
                                            <div style={{ flex: 1, minWidth: '100px' }}>
                                                <label style={{ fontSize: '11px', color: 'var(--text-muted-color)', display: 'block', marginBottom: '4px' }}>需求类型</label>
                                                <select 
                                                    style={{ 
                                                        width: '100%', 
                                                        height: '36px', 
                                                        background: '#0f0f12', 
                                                        border: '1px solid var(--border-color)', 
                                                        borderRadius: 'var(--radius-md)',
                                                        color: '#fff',
                                                        padding: '0 8px',
                                                        outline: 'none'
                                                    }}
                                                    value={newDemandType}
                                                    onChange={(e) => setNewDemandType(e.target.value)}
                                                >
                                                    {demandTypes.map(t => (
                                                        <option key={`opt-${t}`} value={t}>{t}</option>
                                                    ))}
                                                </select>
                                            </div>
                                            <div style={{ width: '80px' }}>
                                                <label style={{ fontSize: '11px', color: 'var(--text-muted-color)', display: 'block', marginBottom: '4px' }}>总需求数</label>
                                                <Input 
                                                    type="number" 
                                                    value={newDemandQty}
                                                    onChange={(e) => setNewDemandQty(parseFloat(e.target.value) || 0)}
                                                    placeholder="10"
                                                    fullWidth
                                                />
                                            </div>
                                        </Flex>
                                        <Button variant="primary" type="submit" fullWidth icon={<FolderPlus size={16} />}>
                                            确认添加
                                        </Button>
                                    </form>
                                </div>
                            </>
                        )}

                        {/* TAB 3: 基础系统配置 */}
                        {activeConfigTab === 'settings' && (
                            <>
                                {/* 需求类别列表维护 */}
                                <div className="config-pane">
                                    <h3>需求类型维护</h3>
                                    <div className="config-list-scroll">
                                        {demandTypes.map((t, index) => (
                                            <div key={`type-mgr-${t}`} className="config-item-row" style={{ padding: '6px 12px' }}>
                                                {editingTypeIndex === index ? (
                                                    <div style={{ display: 'flex', gap: '4px', width: '100%', alignItems: 'center' }}>
                                                        <Input 
                                                            type="text" 
                                                            value={editTypeName} 
                                                            onChange={(e) => setEditTypeName(e.target.value)} 
                                                            style={{ height: '24px', fontSize: '12px', flex: 1 }}
                                                        />
                                                        <Button variant="primary" size="xs" onClick={() => saveDemandTypeEdit(index)} style={{ padding: '2px 6px' }} icon={<Save size={10} />}>保存</Button>
                                                        <Button variant="ghost" size="xs" onClick={() => setEditingTypeIndex(null)} style={{ padding: '2px 4px' }}><X size={10} /></Button>
                                                    </div>
                                                ) : (
                                                    <>
                                                        <span>{t}</span>
                                                        <Flex gap={1}>
                                                            <Button 
                                                                variant="ghost" 
                                                                size="xs"
                                                                onClick={() => startEditDemandType(index, t)}
                                                                style={{ color: '#a855f7', padding: 0 }}
                                                            >
                                                                <Edit2 size={11} />
                                                            </Button>
                                                            {!DEFAULT_DEMAND_TYPES.slice(0, 3).includes(t) && (
                                                                <Button 
                                                                    variant="ghost" 
                                                                    size="xs"
                                                                    onClick={() => handleDeleteCustomType(t)}
                                                                    style={{ color: '#ef4444', padding: 0 }}
                                                                >
                                                                    <Trash2 size={11} />
                                                                </Button>
                                                            )}
                                                        </Flex>
                                                    </>
                                                )}
                                            </div>
                                        ))}
                                    </div>
                                    <form onSubmit={handleAddCustomType} className="config-add-form">
                                        <Input 
                                            type="text" 
                                            value={newCustomType}
                                            onChange={(e) => setNewCustomType(e.target.value)}
                                            placeholder="输入新增类型，如后期特效"
                                            style={{ flex: 1 }}
                                        />
                                        <Button variant="secondary" type="submit">添加</Button>
                                    </form>
                                </div>

                                {/* 系统维护选项 */}
                                <div className="config-pane" style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                    <h3>数据维护与清空</h3>
                                    <div style={{ fontSize: '12px', color: 'var(--text-muted-color)', lineHeight: 1.5 }}>
                                        可随时恢复为自带的级联案例数据，或完全重置系统为空白状态。
                                    </div>
                                    <Flex gap={2}>
                                        <Button variant="secondary" onClick={resetToDefault} style={{ flex: 1 }} icon={<RotateCcw size={14} />}>
                                            重置案例数据
                                        </Button>
                                        <Button variant="danger" onClick={clearAllData} style={{ flex: 1 }} icon={<Trash2 size={14} />}>
                                            清空全部数据
                                        </Button>
                                    </Flex>
                                </div>
                            </>
                        )}
                        </div>
                    </div>
                )}
            </div>

            {/* ==========================================
                弹窗 1: 批量粘贴导入 (Producers / Demands)
               ========================================== */}
            {showPasteModal !== null && (
                <div className="modal-overlay">
                    <div className="modal-content">
                        <div className="modal-header">
                            <h3>
                                {showPasteModal === 'producers' ? '📥 批量从 Google 表格粘贴导入制作人' : 
                                 showPasteModal === 'demands' ? '📥 批量从 Google 表格粘贴导入客户需求' :
                                 '📥 批量补录粘贴分配情况 (需求人/分配量/制作人)'}
                            </h3>
                            <button className="close-btn" onClick={() => { setShowPasteModal(null); setPasteText(''); }}>
                                <X size={20} />
                            </button>
                        </div>
                        
                        {showPasteModal === 'producers' ? (
                            <div className="paste-instructions">
                                <strong>💡 格式要求（支持直接从 Google Sheets 复制）：</strong><br />
                                支持两种格式：<br />
                                1. 三列式：<code>组别    制作人姓名    容量定额</code>（如：<code>特效组    老王    30</code>）<br />
                                2. 两列式：<code>制作人姓名    容量定额</code>（组别会默认为<code>通用组</code>）
                            </div>
                        ) : showPasteModal === 'demands' ? (
                            <div className="paste-instructions">
                                <strong>💡 级联格式要求（支持直接从表格多列区域复制）：</strong><br />
                                列格式：<code>团队	客户名称	需求分类A数量	需求分类B数量	需求分类C数量 ...</code><br />
                                第一行为表头（如以<code>团队</code>和<code>客户</code>开头，系统会自动将后续的列名识别为自定义需求类型，并忽略值为0的空列）。例如：<br />
                                <code>团队	客户名称	reels 视频	人物口播图	口播视频</code><br />
                                <code>抖音组	字节跳动	30	10	0</code><br />
                                <code>电商组	阿里巴巴	15	0	5</code>
                            </div>
                        ) : (
                            <div className="paste-instructions">
                                <strong>💡 分配数据补录格式（三列式，用 Tab 或逗号分隔，不修改定额和总需求量）：</strong><br />
                                列顺序：<code>需求人(客户)	需求量	制作人</code><br />
                                第一行为表头（可选，会自动忽略包含“需求人”的表头行）。例如：<br />
                                <code>需求人	需求量	制作人</code><br />
                                <code>字节跳动	15	老王</code><br />
                                <code>美团	10	小李</code><br />
                                <code>阿里巴巴	5	阿珍</code>
                            </div>
                        )}
                        
                        <textarea
                            className="paste-textarea"
                            value={pasteText}
                            onChange={(e) => setPasteText(e.target.value)}
                            placeholder={
                                showPasteModal === 'producers' 
                                    ? "在此处粘贴您的表格数据列...\n例如:\n特效组\t老王\t40\n剪辑组\t小李\t35\n阿红\t20"
                                    : showPasteModal === 'demands'
                                    ? "复制包含表头的完整行和数据行直接粘贴至此...\n例如:\n团队\t客户名称\treels 视频\t人物口播图\n抖音组\t字节跳动\t30\t10\n外卖组\t美团\t0\t20"
                                    : "在此处粘贴三列分配情况...\n例如:\n需求人\t需求量\t制作人\n字节跳动\t15\t老王\n美团\t10\t小李"
                            }
                        />
                        
                        <div className="modal-footer">
                            <Button variant="secondary" onClick={() => { setShowPasteModal(null); setPasteText(''); }}>
                                取消
                            </Button>
                            <Button 
                                variant="primary" 
                                icon={<ClipboardCheck size={16} />}
                                onClick={() => {
                                    if (showPasteModal === 'producers') importProducers();
                                    else if (showPasteModal === 'demands') importDemands();
                                    else if (showPasteModal === 'allocations') importAllocations();
                                }}
                                disabled={!pasteText.trim()}
                            >
                                确认导入并填充
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* ==========================================
                弹窗 2: Markdown 报表复制预览
               ========================================== */}
            {showExportModal && (
                <div className="modal-overlay">
                    <div className="modal-content" style={{ width: '700px' }}>
                        <div className="modal-header">
                            <h3>📋 Markdown 分配报表预览</h3>
                            <button className="close-btn" onClick={() => setShowExportModal(false)}>
                                <X size={20} />
                            </button>
                        </div>
                        
                        <div className="paste-instructions" style={{ background: 'rgba(168, 85, 247, 0.05)', borderColor: 'rgba(168, 85, 247, 0.15)', color: '#e9d5ff' }}>
                            以下是为您生成的 Markdown 格式分配矩阵报表，您可以点击复制按钮，直接粘贴到您的日报、周报文档或在线会议聊天框中。
                        </div>

                        <div className="export-preview-area">
                            {markdownReport}
                        </div>
                        
                        <div className="modal-footer">
                            <Button variant="secondary" onClick={() => setShowExportModal(false)}>
                                关闭
                            </Button>
                            <Button 
                                variant="primary" 
                                icon={<Copy size={16} />}
                                onClick={copyMarkdown}
                            >
                                复制到剪贴板
                            </Button>
                        </div>
                    </div>
                </div>
            )}

            {/* ==========================================
                弹窗 3: 自定义 Confirm 确认对话框
               ========================================== */}
            {confirmModal.open && (
                <div className="modal-overlay" onClick={closeConfirm}>
                    <div className="modal-content confirm-dialog" style={{ width: '400px' }} onClick={(e) => e.stopPropagation()}>
                        <div className="modal-header">
                            <h3 style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                                <AlertCircle size={18} style={{ color: '#fbbf24' }} />
                                {confirmModal.title}
                            </h3>
                            <button className="close-btn" onClick={closeConfirm}>
                                <X size={18} />
                            </button>
                        </div>
                        <div style={{ fontSize: '13px', color: 'var(--text-muted-color)', lineHeight: 1.5, padding: '8px 0' }}>
                            {confirmModal.description}
                        </div>
                        <div className="modal-footer" style={{ border: 'none', paddingTop: 0, gap: '8px' }}>
                            <Button variant="secondary" onClick={closeConfirm}>
                                取消
                            </Button>
                            <Button variant="danger" onClick={confirmModal.onConfirm}>
                                确定
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
}
