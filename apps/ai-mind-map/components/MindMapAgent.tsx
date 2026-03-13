import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMindMapStore } from '../store/mindMapStore';
import { GeminiService, GEMINI_MODELS, type GeminiModelId } from '../services/geminiService';
import { getStoredApiKey, hasAiAccess } from '../services/aiAccess';
import type { RefineAction } from '../types';
import {
    Bot, Send, X, Check, ChevronRight, AlertCircle,
    Plus, Trash2, Edit3, Move, Layers, RefreshCw,
    Play, Pause, SkipForward, Eye, EyeOff, Sparkles,
    Target, Lightbulb, Zap, CheckCircle2, XCircle, Settings
} from 'lucide-react';

// 操作类型配置
const ACTION_CONFIG: Record<string, { icon: typeof Plus; color: string; label: string }> = {
    add_node: { icon: Plus, color: '#22c55e', label: '添加' },
    delete_node: { icon: Trash2, color: '#ef4444', label: '删除' },
    update_node: { icon: Edit3, color: '#3b82f6', label: '修改' },
    move_node: { icon: Move, color: '#f59e0b', label: '移动' },
    expand: { icon: Layers, color: '#8b5cf6', label: '扩展' },
    regroup: { icon: RefreshCw, color: '#ec4899', label: '重组' },
};

// Agent 状态
type AgentPhase = 'idle' | 'thinking' | 'planning' | 'confirming' | 'executing' | 'done';

// 执行计划步骤
interface PlanStep {
    id: string;
    action: RefineAction;
    status: 'pending' | 'approved' | 'rejected' | 'done' | 'skipped';
}

export const MindMapAgent: React.FC<{ onClose: () => void }> = ({ onClose }) => {
    const {
        currentMap,
        selectedNodeId,
        geminiApiKey,
        aiCreationHistory,
        getMapAsMarkdown,
        addNode,
        updateNode,
        deleteNode,
        addStructureToNode,
        pushHistory,
    } = useMindMapStore();

    const [phase, setPhase] = useState<AgentPhase>('idle');
    const [userGoal, setUserGoal] = useState('');
    const [agentThinking, setAgentThinking] = useState('');
    const [planSteps, setPlanSteps] = useState<PlanStep[]>([]);
    const [currentStepIndex, setCurrentStepIndex] = useState(0);
    const [executionLog, setExecutionLog] = useState<string[]>([]);
    const [showPreview, setShowPreview] = useState(true);
    const [selectedModel, setSelectedModel] = useState<GeminiModelId>('gemini-2.5-flash');
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const envApiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) as string | undefined;
    const storedApiKey = getStoredApiKey();
    const apiKey = geminiApiKey || envApiKey || storedApiKey;
    const hasApiKey = hasAiAccess(apiKey);

    // 根据节点标签找到节点ID
    const findNodeByLabel = useCallback((label: string): string | null => {
        if (!currentMap) return null;
        for (const [id, node] of Object.entries(currentMap.nodes)) {
            if (node.label === label) return id;
        }
        for (const [id, node] of Object.entries(currentMap.nodes)) {
            if (node.label.includes(label) || label.includes(node.label)) return id;
        }
        return null;
    }, [currentMap]);

    // 应用单个操作
    const applyAction = useCallback((action: RefineAction): boolean => {
        if (!currentMap) return false;

        switch (action.type) {
            case 'add_node': {
                const parentId = action.parentNodeLabel
                    ? findNodeByLabel(action.parentNodeLabel)
                    : currentMap.rootId;
                if (!parentId) return false;

                if (action.children && action.children.length > 0) {
                    addStructureToNode(parentId, action.children.map(c => ({
                        label: c.label,
                        description: c.notes,
                        children: c.children?.map(cc => ({
                            label: cc.label,
                            description: cc.notes,
                        })),
                    })));
                } else if (action.newLabel) {
                    addNode(parentId, action.newLabel, undefined, action.newNotes);
                }
                return true;
            }
            case 'update_node': {
                const nodeId = findNodeByLabel(action.targetNodeLabel || '');
                if (!nodeId) return false;
                const updates: { label?: string; notes?: string } = {};
                if (action.newLabel) updates.label = action.newLabel;
                if (action.newNotes) updates.notes = action.newNotes;
                updateNode(nodeId, updates);
                return true;
            }
            case 'delete_node': {
                const nodeId = findNodeByLabel(action.targetNodeLabel || '');
                if (!nodeId || nodeId === currentMap.rootId) return false;
                deleteNode(nodeId);
                return true;
            }
            case 'expand': {
                const nodeId = findNodeByLabel(action.targetNodeLabel || '');
                if (!nodeId) return false;
                if (action.children && action.children.length > 0) {
                    addStructureToNode(nodeId, action.children.map(c => ({
                        label: c.label,
                        description: c.notes,
                        children: c.children?.map(cc => ({
                            label: cc.label,
                            description: cc.notes,
                        })),
                    })));
                }
                return true;
            }
            default:
                return false;
        }
    }, [currentMap, findNodeByLabel, addNode, updateNode, deleteNode, addStructureToNode]);

    // 开始 Agent 规划
    const startAgent = async () => {
        if (!userGoal.trim() || !hasApiKey || !currentMap) return;

        setPhase('thinking');
        setAgentThinking('正在分析思维导图并理解你的目标...');
        setPlanSteps([]);
        setExecutionLog([]);
        setCurrentStepIndex(0);

        try {
            const service = new GeminiService(apiKey, selectedModel);
            const mapStructure = getMapAsMarkdown();

            // 构建创建历史
            const creationHistory = aiCreationHistory
                .filter(r => r.type === 'create')
                .slice(-3)
                .map(r => `用户输入: "${r.userInput.slice(0, 100)}..."`)
                .join('\n');

            // 获取选中节点上下文
            let selectedContext = '';
            if (selectedNodeId && currentMap.nodes[selectedNodeId]) {
                const node = currentMap.nodes[selectedNodeId];
                selectedContext = `当前选中节点: "${node.label}"`;
            }

            setAgentThinking('正在制定执行计划...');
            setPhase('planning');

            const prompt = `思维导图修改任务。直接执行，不要确认。

## 当前导图
\`\`\`
${mapStructure}
\`\`\`

${selectedContext}

## 目标
${userGoal}

## 输出 JSON
{
  "understanding": "一句话理解",
  "plan": [
    {
      "type": "add_node|delete_node|update_node|expand",
      "description": "简短描述",
      "targetNodeLabel": "节点名",
      "parentNodeLabel": "父节点名",
      "newLabel": "新标签",
      "children": [{"label": "子节点"}]
    }
  ]
}

规则：最多3步，直接做，不废话。只返回JSON。`;

            const data = await service['requestGemini']({
                contents: [{ role: 'user', parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.5, maxOutputTokens: 4096 },
            });

            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const jsonMatch = textContent.match(/\{[\s\S]*\}/);

            if (jsonMatch) {
                const result = JSON.parse(jsonMatch[0]);

                setAgentThinking(result.understanding || '已理解你的目标');

                if (result.plan && result.plan.length > 0) {
                    const steps: PlanStep[] = result.plan.map((action: any, idx: number) => ({
                        id: `step-${idx}`,
                        action: {
                            id: `action-${idx}`,
                            type: action.type,
                            description: action.description,
                            targetNodeLabel: action.targetNodeLabel,
                            parentNodeLabel: action.parentNodeLabel,
                            newLabel: action.newLabel,
                            newNotes: action.newNotes,
                            children: action.children,
                        },
                        status: 'pending' as const,
                    }));

                    setPlanSteps(steps);
                    setPhase('confirming');
                    setExecutionLog([`📋 计划包含 ${steps.length} 个步骤`, `💡 ${result.summary || '准备执行'}`]);
                } else {
                    setAgentThinking('未能生成有效计划，请尝试更具体的描述');
                    setPhase('idle');
                }
            } else {
                throw new Error('无法解析 AI 响应');
            }
        } catch (error) {
            console.error('Agent error:', error);
            setAgentThinking('出错了，请重试');
            setPhase('idle');
        }
    };

    // 批准单个步骤
    const approveStep = (stepId: string) => {
        setPlanSteps(prev => prev.map(s =>
            s.id === stepId ? { ...s, status: 'approved' } : s
        ));
    };

    // 拒绝单个步骤
    const rejectStep = (stepId: string) => {
        setPlanSteps(prev => prev.map(s =>
            s.id === stepId ? { ...s, status: 'rejected' } : s
        ));
    };

    // 批准所有步骤
    const approveAll = () => {
        setPlanSteps(prev => prev.map(s =>
            s.status === 'pending' ? { ...s, status: 'approved' } : s
        ));
    };

    // 开始执行
    const executeApproved = async () => {
        const approvedSteps = planSteps.filter(s => s.status === 'approved');
        if (approvedSteps.length === 0) {
            setExecutionLog(prev => [...prev, '⚠️ 没有批准的步骤']);
            return;
        }

        setPhase('executing');
        pushHistory(); // 记录历史便于撤销

        let successCount = 0;
        for (const step of approvedSteps) {
            setExecutionLog(prev => [...prev, `▶️ 执行: ${step.action.description}`]);

            const success = applyAction(step.action);
            if (success) {
                successCount++;
                setPlanSteps(prev => prev.map(s =>
                    s.id === step.id ? { ...s, status: 'done' } : s
                ));
                setExecutionLog(prev => [...prev, `   ✅ 成功`]);
            } else {
                setPlanSteps(prev => prev.map(s =>
                    s.id === step.id ? { ...s, status: 'skipped' } : s
                ));
                setExecutionLog(prev => [...prev, `   ❌ 跳过（目标节点未找到）`]);
            }

            // 小延迟让 UI 更新可见
            await new Promise(r => setTimeout(r, 300));
        }

        setExecutionLog(prev => [...prev, `🎉 完成！成功执行 ${successCount}/${approvedSteps.length} 步`]);
        setPhase('done');
    };

    // 重置
    const reset = () => {
        setPhase('idle');
        setUserGoal('');
        setAgentThinking('');
        setPlanSteps([]);
        setExecutionLog([]);
        setCurrentStepIndex(0);
    };

    // 获取阶段状态
    const getPhaseInfo = () => {
        switch (phase) {
            case 'idle': return { label: '等待指令', color: '#6b7280' };
            case 'thinking': return { label: '思考中...', color: '#f59e0b' };
            case 'planning': return { label: '规划中...', color: '#8b5cf6' };
            case 'confirming': return { label: '请确认计划', color: '#3b82f6' };
            case 'executing': return { label: '执行中...', color: '#22c55e' };
            case 'done': return { label: '已完成', color: '#22c55e' };
        }
    };

    const phaseInfo = getPhaseInfo();
    const pendingCount = planSteps.filter(s => s.status === 'pending').length;
    const approvedCount = planSteps.filter(s => s.status === 'approved').length;

    return (
        <div className="mindmap-agent">
            {/* 头部 */}
            <div className="agent-header">
                <div className="agent-title">
                    <Bot size={24} className="agent-icon" />
                    <span>AI Agent</span>
                    <span className="agent-badge" style={{ background: phaseInfo.color }}>
                        {phaseInfo.label}
                    </span>
                </div>
                <div className="agent-header-right">
                    {/* 模型选择器 */}
                    <select
                        className="model-selector"
                        value={selectedModel}
                        onChange={e => setSelectedModel(e.target.value as GeminiModelId)}
                        disabled={phase === 'thinking' || phase === 'planning' || phase === 'executing'}
                    >
                        {GEMINI_MODELS.map(m => (
                            <option key={m.id} value={m.id}>
                                {m.label}
                            </option>
                        ))}
                    </select>
                    <button className="close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>
            </div>

            {/* 主体 */}
            <div className="agent-body">
                {/* 目标输入区 */}
                {(phase === 'idle' || phase === 'done') && (
                    <div className="agent-goal-section">
                        <div className="goal-label">
                            <Target size={16} />
                            <span>你想让 Agent 做什么？</span>
                        </div>
                        <textarea
                            ref={inputRef}
                            value={userGoal}
                            onChange={e => setUserGoal(e.target.value)}
                            placeholder="例如：&#10;• 补充竞品分析模块&#10;• 精简冗余内容&#10;• 把营销策略扩展得更详细&#10;• 从用户视角重新组织结构"
                            rows={4}
                            disabled={!hasApiKey}
                        />
                        <button
                            className="start-btn"
                            onClick={startAgent}
                            disabled={!userGoal.trim() || !hasApiKey || phase !== 'idle' && phase !== 'done'}
                        >
                            <Zap size={18} />
                            {phase === 'done' ? '继续完善' : '开始规划'}
                        </button>
                        {phase === 'done' && (
                            <button className="reset-btn" onClick={reset}>
                                重新开始
                            </button>
                        )}
                    </div>
                )}

                {/* 思考/规划中 */}
                {(phase === 'thinking' || phase === 'planning') && (
                    <div className="agent-thinking">
                        <div className="thinking-animation">
                            <Sparkles size={32} className="sparkle-icon" />
                        </div>
                        <div className="thinking-text">{agentThinking}</div>
                    </div>
                )}

                {/* 计划确认区 */}
                {phase === 'confirming' && (
                    <div className="agent-plan-section">
                        <div className="plan-header">
                            <Lightbulb size={16} />
                            <span>{agentThinking}</span>
                        </div>

                        <div className="plan-actions-bar">
                            <button className="approve-all-btn" onClick={approveAll} disabled={pendingCount === 0}>
                                <CheckCircle2 size={16} />
                                全部批准 ({pendingCount})
                            </button>
                            <button
                                className="execute-btn"
                                onClick={executeApproved}
                                disabled={approvedCount === 0}
                            >
                                <Play size={16} />
                                执行 ({approvedCount})
                            </button>
                        </div>

                        <div className="plan-steps">
                            {planSteps.map((step, idx) => {
                                const config = ACTION_CONFIG[step.action.type] || ACTION_CONFIG.add_node;
                                const Icon = config.icon;
                                return (
                                    <div key={step.id} className={`plan-step ${step.status}`}>
                                        <div className="step-number">{idx + 1}</div>
                                        <div className="step-icon" style={{ color: config.color }}>
                                            <Icon size={16} />
                                        </div>
                                        <div className="step-content">
                                            <div className="step-type">{config.label}</div>
                                            <div className="step-desc">{step.action.description}</div>
                                        </div>
                                        {step.status === 'pending' && (
                                            <div className="step-actions">
                                                <button
                                                    className="step-approve tooltip-bottom"
                                                    onClick={() => approveStep(step.id)}
                                                    data-tip="批准"
                                                >
                                                    <Check size={16} />
                                                </button>
                                                <button
                                                    className="step-reject tooltip-bottom"
                                                    onClick={() => rejectStep(step.id)}
                                                    data-tip="跳过"
                                                >
                                                    <X size={16} />
                                                </button>
                                            </div>
                                        )}
                                        {step.status === 'approved' && (
                                            <div className="step-status approved">
                                                <CheckCircle2 size={16} />
                                            </div>
                                        )}
                                        {step.status === 'rejected' && (
                                            <div className="step-status rejected">
                                                <XCircle size={16} />
                                            </div>
                                        )}
                                        {step.status === 'done' && (
                                            <div className="step-status done">
                                                ✅
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                )}

                {/* 执行中/完成 */}
                {(phase === 'executing' || (phase === 'done' && executionLog.length > 0)) && (
                    <div className="agent-execution">
                        <div className="execution-header">
                            <span>执行日志</span>
                        </div>
                        <div className="execution-log">
                            {executionLog.map((log, idx) => (
                                <div key={idx} className="log-line">{log}</div>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {!hasApiKey && (
                <div className="no-api-warning">
                    请先在主工具箱设置 API 密钥
                </div>
            )}

            <style>{`
                .mindmap-agent {
                    display: flex;
                    flex-direction: column;
                    height: 100%;
                    background: linear-gradient(180deg, #0f172a 0%, #1e1b4b 100%);
                    border-radius: 16px;
                    overflow: hidden;
                }

                .agent-header {
                    display: flex;
                    align-items: center;
                    justify-content: space-between;
                    padding: 20px 24px;
                    background: rgba(255, 255, 255, 0.03);
                    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
                }

                .agent-title {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    font-weight: 700;
                    font-size: 18px;
                    color: #f0f0f0;
                }

                .agent-icon {
                    color: #a855f7;
                }

                .agent-badge {
                    font-size: 11px;
                    padding: 4px 10px;
                    border-radius: 12px;
                    color: white;
                    font-weight: 500;
                }

                .agent-header-right {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                }

                .model-selector {
                    padding: 8px 12px;
                    background: rgba(255, 255, 255, 0.08);
                    border: 1px solid rgba(255, 255, 255, 0.15);
                    border-radius: 8px;
                    color: #e0e0e0;
                    font-size: 12px;
                    cursor: pointer;
                    outline: none;
                    transition: all 0.2s;
                }

                .model-selector:hover:not(:disabled) {
                    background: rgba(255, 255, 255, 0.12);
                    border-color: rgba(168, 85, 247, 0.4);
                }

                .model-selector:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .model-selector option {
                    background: #1e1b4b;
                    color: #e0e0e0;
                }

                .close-btn {
                    padding: 8px;
                    border: none;
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 8px;
                    color: #888;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .close-btn:hover {
                    background: rgba(255, 255, 255, 0.1);
                    color: #fff;
                }

                .agent-body {
                    flex: 1;
                    overflow-y: auto;
                    padding: 24px;
                }

                .agent-goal-section {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                .goal-label {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    color: #a855f7;
                    font-weight: 500;
                    font-size: 14px;
                }

                .agent-goal-section textarea {
                    padding: 16px;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    border-radius: 12px;
                    color: #f0f0f0;
                    font-size: 14px;
                    resize: none;
                    outline: none;
                    transition: border-color 0.2s;
                }

                .agent-goal-section textarea:focus {
                    border-color: rgba(168, 85, 247, 0.5);
                }

                .agent-goal-section textarea::placeholder {
                    color: #666;
                }

                .start-btn {
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    gap: 8px;
                    padding: 14px 24px;
                    background: linear-gradient(135deg, #a855f7, #6366f1);
                    border: none;
                    border-radius: 12px;
                    color: white;
                    font-size: 15px;
                    font-weight: 600;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .start-btn:hover:not(:disabled) {
                    filter: brightness(1.1);
                    transform: translateY(-1px);
                }

                .start-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .reset-btn {
                    padding: 10px;
                    background: transparent;
                    border: 1px solid rgba(255, 255, 255, 0.2);
                    border-radius: 8px;
                    color: #888;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .reset-btn:hover {
                    background: rgba(255, 255, 255, 0.05);
                    color: #fff;
                }

                .agent-thinking {
                    display: flex;
                    flex-direction: column;
                    align-items: center;
                    justify-content: center;
                    padding: 60px 20px;
                    text-align: center;
                }

                .thinking-animation {
                    margin-bottom: 20px;
                }

                .sparkle-icon {
                    color: #a855f7;
                    animation: pulse 1.5s ease-in-out infinite;
                }

                @keyframes pulse {
                    0%, 100% { transform: scale(1); opacity: 1; }
                    50% { transform: scale(1.2); opacity: 0.8; }
                }

                .thinking-text {
                    color: #c4b5fd;
                    font-size: 16px;
                }

                .agent-plan-section {
                    display: flex;
                    flex-direction: column;
                    gap: 16px;
                }

                .plan-header {
                    display: flex;
                    align-items: center;
                    gap: 10px;
                    padding: 16px;
                    background: rgba(168, 85, 247, 0.1);
                    border-radius: 12px;
                    color: #c4b5fd;
                    font-size: 14px;
                }

                .plan-actions-bar {
                    display: flex;
                    gap: 12px;
                }

                .approve-all-btn, .execute-btn {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    padding: 10px 16px;
                    border-radius: 8px;
                    font-size: 13px;
                    font-weight: 500;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .approve-all-btn {
                    flex: 1;
                    background: rgba(255, 255, 255, 0.05);
                    border: 1px solid rgba(255, 255, 255, 0.1);
                    color: #ccc;
                }

                .approve-all-btn:hover:not(:disabled) {
                    background: rgba(255, 255, 255, 0.1);
                }

                .execute-btn {
                    flex: 1;
                    background: linear-gradient(135deg, #22c55e, #16a34a);
                    border: none;
                    color: white;
                }

                .execute-btn:hover:not(:disabled) {
                    filter: brightness(1.1);
                }

                .approve-all-btn:disabled, .execute-btn:disabled {
                    opacity: 0.5;
                    cursor: not-allowed;
                }

                .plan-steps {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                }

                .plan-step {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 14px 16px;
                    background: rgba(255, 255, 255, 0.03);
                    border: 1px solid rgba(255, 255, 255, 0.08);
                    border-radius: 12px;
                    transition: all 0.2s;
                }

                .plan-step.approved {
                    background: rgba(34, 197, 94, 0.1);
                    border-color: rgba(34, 197, 94, 0.3);
                }

                .plan-step.rejected {
                    opacity: 0.5;
                    background: rgba(239, 68, 68, 0.05);
                }

                .plan-step.done {
                    background: rgba(34, 197, 94, 0.15);
                    border-color: rgba(34, 197, 94, 0.4);
                }

                .step-number {
                    width: 24px;
                    height: 24px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(168, 85, 247, 0.2);
                    border-radius: 6px;
                    color: #a855f7;
                    font-size: 12px;
                    font-weight: 600;
                }

                .step-icon {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: rgba(255, 255, 255, 0.05);
                    border-radius: 8px;
                }

                .step-content {
                    flex: 1;
                }

                .step-type {
                    font-size: 11px;
                    color: #888;
                    margin-bottom: 2px;
                }

                .step-desc {
                    font-size: 13px;
                    color: #e0e0e0;
                }

                .step-actions {
                    display: flex;
                    gap: 6px;
                }

                .step-approve, .step-reject {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    border-radius: 8px;
                    border: none;
                    cursor: pointer;
                    transition: all 0.2s;
                }

                .step-approve {
                    background: rgba(34, 197, 94, 0.1);
                    color: #22c55e;
                }

                .step-approve:hover {
                    background: rgba(34, 197, 94, 0.2);
                }

                .step-reject {
                    background: rgba(239, 68, 68, 0.1);
                    color: #ef4444;
                }

                .step-reject:hover {
                    background: rgba(239, 68, 68, 0.2);
                }

                .step-status {
                    width: 32px;
                    height: 32px;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                }

                .step-status.approved { color: #22c55e; }
                .step-status.rejected { color: #ef4444; }
                .step-status.done { font-size: 18px; }

                .agent-execution {
                    display: flex;
                    flex-direction: column;
                    gap: 12px;
                }

                .execution-header {
                    color: #888;
                    font-size: 13px;
                }

                .execution-log {
                    padding: 16px;
                    background: rgba(0, 0, 0, 0.3);
                    border-radius: 12px;
                    font-family: 'SF Mono', monospace;
                    font-size: 13px;
                    max-height: 300px;
                    overflow-y: auto;
                }

                .log-line {
                    padding: 4px 0;
                    color: #a0a0a0;
                }

                .no-api-warning {
                    padding: 16px;
                    text-align: center;
                    background: rgba(239, 68, 68, 0.1);
                    color: #ef4444;
                    font-size: 13px;
                }
            `}</style>
        </div>
    );
};
