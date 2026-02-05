/**
 * 执行清单视图 - 按任务聚合反馈，而非按图片
 * 专为外国团队设计的任务导向视图
 */
import React, { useMemo, useState } from 'react';
import { Check, Copy, Download, ChevronDown, ChevronUp, AlertCircle, Image as ImageIcon } from 'lucide-react';
import { ImageReview, FeedbackItem, ReviewStatus, REVIEW_STATUS_CONFIG, SEVERITY_CONFIG, SeverityLevel } from '../types';

interface ExecutionViewProps {
    images: ImageReview[];
    onCopyAll: () => void;
}

// 聚合的任务项
interface AggregatedTask {
    severity: SeverityLevel;
    problemEn: string;
    suggestionEn: string;
    images: { id: string; name: string; imageUrl: string }[];
    originalFeedbacks: { problemCn: string; suggestionCn: string }[];
    referenceImageUrl?: string;  // 参考图
    colorHex?: string;           // 推荐颜色
}

// 按状态分组的任务
interface StatusGroup {
    status: ReviewStatus;
    label: string;
    labelEn: string;
    icon: string;
    tasks: AggregatedTask[];
    imageCount: number;
}

const ExecutionView: React.FC<ExecutionViewProps> = ({ images, onCopyAll }) => {
    const [expandedGroups, setExpandedGroups] = useState<Set<ReviewStatus>>(new Set(['rejected', 'revision']));
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // 聚合任务
    const statusGroups = useMemo<StatusGroup[]>(() => {
        const groups: Record<ReviewStatus, StatusGroup> = {
            rejected: {
                status: 'rejected',
                label: '不合格',
                labelEn: 'Rejected - Must Fix',
                icon: '❌',
                tasks: [],
                imageCount: 0,
            },
            revision: {
                status: 'revision',
                label: '需要修改',
                labelEn: 'Needs Revision',
                icon: '✏️',
                tasks: [],
                imageCount: 0,
            },
            pending: {
                status: 'pending',
                label: '待审核',
                labelEn: 'Pending Review',
                icon: '⏳',
                tasks: [],
                imageCount: 0,
            },
            approved: {
                status: 'approved',
                label: '合格',
                labelEn: 'Approved',
                icon: '✅',
                tasks: [],
                imageCount: 0,
            },
        };

        // 遍历所有图片
        images.forEach(img => {
            const group = groups[img.status];
            if (!group) return; // 跳过无效状态
            group.imageCount++;

            // 遍历每个反馈项
            img.feedbackItems.forEach(item => {
                const problemEn = item.problemTranslation?.english || item.problemCn;
                const suggestionEn = item.suggestionTranslation?.english || item.suggestionCn;

                if (!problemEn && !suggestionEn) return;

                // 查找是否有相似的任务可以合并
                const existingTask = group.tasks.find(task =>
                    task.severity === item.severity &&
                    task.problemEn.toLowerCase() === problemEn.toLowerCase()
                );

                if (existingTask) {
                    // 合并到现有任务
                    if (!existingTask.images.find(i => i.id === img.id)) {
                        existingTask.images.push({
                            id: img.id,
                            name: img.originalInput || `Image`,
                            imageUrl: img.imageUrl,
                        });
                    }
                    existingTask.originalFeedbacks.push({
                        problemCn: item.problemCn,
                        suggestionCn: item.suggestionCn,
                    });
                } else {
                    // 创建新任务
                    group.tasks.push({
                        severity: item.severity,
                        problemEn,
                        suggestionEn,
                        images: [{
                            id: img.id,
                            name: img.originalInput || `Image`,
                            imageUrl: img.imageUrl,
                        }],
                        originalFeedbacks: [{
                            problemCn: item.problemCn,
                            suggestionCn: item.suggestionCn,
                        }],
                        referenceImageUrl: item.referenceImageUrl,
                        colorHex: item.colorHex,
                    });
                }
            });
        });

        // 按严重程度排序任务
        const severityOrder: SeverityLevel[] = ['critical', 'major', 'minor', 'suggestion'];
        Object.values(groups).forEach(group => {
            group.tasks.sort((a, b) =>
                severityOrder.indexOf(a.severity) - severityOrder.indexOf(b.severity)
            );
        });

        // 返回有意义顺序的分组（3个状态）
        return [
            groups.rejected,
            groups.revision,
            groups.pending,
            groups.approved,
        ].filter(g => g.imageCount > 0);
    }, [images]);

    // 切换展开/折叠
    const toggleGroup = (status: ReviewStatus) => {
        setExpandedGroups(prev => {
            const next = new Set(prev);
            if (next.has(status)) {
                next.delete(status);
            } else {
                next.add(status);
            }
            return next;
        });
    };

    // 复制任务到剪贴板
    const copyTask = async (task: AggregatedTask) => {
        const text = `${SEVERITY_CONFIG[task.severity].icon} ${SEVERITY_CONFIG[task.severity].labelEn}

Problem: ${task.problemEn}
${task.suggestionEn ? `Suggestion: ${task.suggestionEn}` : ''}

Affected images: ${task.images.map(i => i.name).join(', ')}`;

        await navigator.clipboard.writeText(text);
        setCopiedId(task.problemEn);
        setTimeout(() => setCopiedId(null), 2000);
    };

    // 生成完整执行清单
    const generateFullChecklist = (): string => {
        const lines: string[] = [];
        lines.push('═══════════════════════════════════════════════════════════════');
        lines.push('                    EXECUTION CHECKLIST');
        lines.push('═══════════════════════════════════════════════════════════════');
        lines.push('');

        statusGroups.forEach(group => {
            if (group.tasks.length === 0 && group.status !== 'approved') return;

            lines.push(`\n${group.icon} ${group.labelEn.toUpperCase()} (${group.imageCount} images)`);
            lines.push('───────────────────────────────────────────────────────────────');

            if (group.tasks.length === 0) {
                lines.push('  No specific feedback');
            } else {
                group.tasks.forEach((task, index) => {
                    const severityConfig = SEVERITY_CONFIG[task.severity];
                    lines.push(`\n  ${index + 1}. [${severityConfig.icon} ${severityConfig.labelEn}]`);
                    lines.push(`     Problem: ${task.problemEn}`);
                    if (task.suggestionEn) {
                        lines.push(`     Suggestion: ${task.suggestionEn}`);
                    }
                    lines.push(`     📎 Affects: ${task.images.map(i => i.name).join(', ')}`);
                });
            }
        });

        lines.push('\n═══════════════════════════════════════════════════════════════');

        return lines.join('\n');
    };

    // 复制完整清单
    const handleCopyAll = async () => {
        const text = generateFullChecklist();
        await navigator.clipboard.writeText(text);
        onCopyAll();
    };

    // 统计
    const totalTasks = statusGroups.reduce((sum, g) => sum + g.tasks.length, 0);
    const criticalCount = statusGroups.reduce((sum, g) =>
        sum + g.tasks.filter(t => t.severity === 'critical').length, 0
    );

    return (
        <div className="h-full flex flex-col bg-zinc-950 text-white">
            {/* 头部 */}
            <div className="p-4 border-b border-zinc-800 bg-zinc-900/50">
                <div className="flex items-center justify-between mb-3">
                    <h2 className="text-lg font-semibold flex items-center gap-2">
                        <AlertCircle size={20} className="text-amber-400" />
                        Execution Checklist
                    </h2>
                    <button
                        onClick={handleCopyAll}
                        className="flex items-center gap-2 px-3 py-1.5 bg-teal-600 hover:bg-teal-700 rounded-lg text-sm transition-colors"
                    >
                        <Copy size={14} />
                        Copy All
                    </button>
                </div>

                {/* 快速统计 */}
                <div className="flex gap-4 text-sm">
                    <span className="text-zinc-400">
                        Total Tasks: <span className="text-white font-medium">{totalTasks}</span>
                    </span>
                    {criticalCount > 0 && (
                        <span className="text-red-400">
                            🔴 Critical: {criticalCount}
                        </span>
                    )}
                </div>
            </div>

            {/* 任务列表 */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4">
                {statusGroups.map(group => {
                    const isExpanded = expandedGroups.has(group.status);
                    const hasTasks = group.tasks.length > 0;

                    return (
                        <div
                            key={group.status}
                            className={`rounded-lg border transition-colors ${group.status === 'rejected' ? 'border-red-700/50 bg-red-900/10' :
                                group.status === 'revision' ? 'border-amber-700/50 bg-amber-900/10' :
                                    group.status === 'approved' ? 'border-emerald-700/50 bg-emerald-900/10' :
                                        'border-zinc-700/50 bg-zinc-800/30'
                                }`}
                        >
                            {/* 分组头部 */}
                            <div
                                className="p-3 flex items-center justify-between cursor-pointer"
                                onClick={() => toggleGroup(group.status)}
                            >
                                <div className="flex items-center gap-3">
                                    <span className="text-xl">{group.icon}</span>
                                    <div>
                                        <h3 className="font-medium">{group.labelEn}</h3>
                                        <p className="text-xs text-zinc-500">
                                            {group.imageCount} images • {group.tasks.length} tasks
                                        </p>
                                    </div>
                                </div>
                                {hasTasks && (
                                    isExpanded ? <ChevronUp size={18} /> : <ChevronDown size={18} />
                                )}
                            </div>

                            {/* 展开的任务列表 */}
                            {isExpanded && hasTasks && (
                                <div className="px-3 pb-3 space-y-2">
                                    {group.tasks.map((task, index) => {
                                        const severityConfig = SEVERITY_CONFIG[task.severity];

                                        return (
                                            <div
                                                key={index}
                                                className={`p-3 rounded-lg border-l-4 bg-zinc-800/50 ${task.severity === 'critical' ? 'border-l-red-500' :
                                                    task.severity === 'major' ? 'border-l-amber-500' :
                                                        task.severity === 'minor' ? 'border-l-blue-500' :
                                                            'border-l-green-500'
                                                    }`}
                                            >
                                                <div className="flex items-start justify-between gap-2">
                                                    <div className="flex-1">
                                                        <div className="flex items-center gap-2 mb-2">
                                                            <span className="text-sm">{severityConfig.icon}</span>
                                                            <span className={`text-xs px-2 py-0.5 rounded ${task.severity === 'critical' ? 'bg-red-900/50 text-red-300' :
                                                                task.severity === 'major' ? 'bg-amber-900/50 text-amber-300' :
                                                                    task.severity === 'minor' ? 'bg-blue-900/50 text-blue-300' :
                                                                        'bg-green-900/50 text-green-300'
                                                                }`}>
                                                                {severityConfig.labelEn}
                                                            </span>
                                                        </div>

                                                        <p className="text-sm text-white mb-1">
                                                            <span className="text-zinc-500">Problem: </span>
                                                            {task.problemEn}
                                                        </p>

                                                        {task.suggestionEn && (
                                                            <p className="text-sm text-emerald-300">
                                                                <span className="text-zinc-500">Suggestion: </span>
                                                                {task.suggestionEn}
                                                            </p>
                                                        )}

                                                        {/* 颜色代码 */}
                                                        {task.colorHex && (
                                                            <div className="flex items-center gap-2 mt-1">
                                                                <span className="text-xs text-zinc-500">Color:</span>
                                                                <span
                                                                    className="w-4 h-4 rounded border border-zinc-500"
                                                                    style={{ backgroundColor: task.colorHex }}
                                                                />
                                                                <span className="text-xs font-mono text-cyan-300">{task.colorHex.toUpperCase()}</span>
                                                            </div>
                                                        )}

                                                        {/* 参考图 */}
                                                        {task.referenceImageUrl && (
                                                            <div className="mt-2">
                                                                <span className="text-xs text-zinc-500 block mb-1">📎 Reference (Like this):</span>
                                                                <img
                                                                    src={task.referenceImageUrl}
                                                                    alt="Reference"
                                                                    className="max-h-20 rounded border border-zinc-600"
                                                                />
                                                            </div>
                                                        )}

                                                        {/* 受影响的图片 */}
                                                        <div className="mt-2 flex items-center gap-2 flex-wrap">
                                                            <span className="text-xs text-zinc-500">Affects:</span>
                                                            {task.images.slice(0, 3).map((img, i) => (
                                                                <div
                                                                    key={i}
                                                                    className="w-8 h-8 rounded overflow-hidden border border-zinc-600"
                                                                    title={img.name}
                                                                >
                                                                    <img
                                                                        src={img.imageUrl}
                                                                        alt=""
                                                                        className="w-full h-full object-cover"
                                                                    />
                                                                </div>
                                                            ))}
                                                            {task.images.length > 3 && (
                                                                <span className="text-xs text-zinc-500">
                                                                    +{task.images.length - 3} more
                                                                </span>
                                                            )}
                                                        </div>
                                                    </div>

                                                    <button
                                                        onClick={() => copyTask(task)}
                                                        className="p-1.5 text-zinc-500 hover:text-white transition-colors"
                                                        title="Copy task"
                                                    >
                                                        {copiedId === task.problemEn ? (
                                                            <Check size={14} className="text-green-400" />
                                                        ) : (
                                                            <Copy size={14} />
                                                        )}
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            )}

                            {/* 无任务时的提示 */}
                            {isExpanded && !hasTasks && group.status === 'approved' && (
                                <div className="px-3 pb-3 text-sm text-zinc-500">
                                    ✨ All approved images have no specific feedback.
                                </div>
                            )}
                        </div>
                    );
                })}

                {statusGroups.length === 0 && (
                    <div className="text-center py-12 text-zinc-500">
                        <ImageIcon size={48} className="mx-auto mb-4 opacity-50" />
                        <p>No images to review</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default ExecutionView;
