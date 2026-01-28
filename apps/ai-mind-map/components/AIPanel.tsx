/**
 * ✨ AI 助手面板 - 简化版
 * 重新设计的 UI，更简洁易用
 */

import React, { useState, useCallback, useEffect } from 'react';
import { useMindMapStore } from '../store/mindMapStore';
import { GeminiService } from '../services/geminiService';
import { getStoredApiKey, hasAiAccess } from '../services/aiAccess';
import type { AIExpandSuggestion, MindMapNode } from '../types';
import { AIResultModal } from './AIResultModal';
import { PresetSelector } from './PresetSelector';
import { buildPlatformConstraints } from '../services/aiConstraints';
import { buildPresetPrompt, type ExpandPreset } from '../presets/expandPresets';
import {
    Sparkles, ChevronDown, ChevronRight,
    Lightbulb, ListTodo, Wand2, FileText, Shield, Video,
    RefreshCw, Layers, Settings, Zap, Brain, Target,
    TrendingUp, Search, Check, AlertCircle, Loader2
} from 'lucide-react';

// 智能工具定义
const SMART_TOOLS = [
    { id: 'cultivate', icon: Lightbulb, label: '培养想法', color: '#fbbf24' },
    { id: 'wbs', icon: ListTodo, label: '工作分解', color: '#60a5fa' },
    { id: 'optimize', icon: Wand2, label: '优化文案', color: '#a78bfa' },
    { id: 'regroup', icon: RefreshCw, label: '改组重构', color: '#f472b6' },
    { id: 'cluster', icon: Layers, label: '语义聚类', color: '#34d399' },
    { id: 'video_script', icon: Video, label: '视频脚本', color: '#f87171' },
    { id: 'explain', icon: FileText, label: '解释说明', color: '#38bdf8' },
    { id: 'desensitize', icon: Shield, label: '数据脱敏', color: '#fb923c' },
] as const;

// 快捷操作
const QUICK_ACTIONS = [
    { id: 'diverge', icon: Lightbulb, label: '发散思维', action: 'cultivate' },
    { id: 'breakdown', icon: ListTodo, label: '拆解步骤', action: 'wbs' },
    { id: 'polish', icon: Wand2, label: '优化文案', action: 'optimize' },
];

export const AIPanel: React.FC = () => {
    const {
        currentMap,
        selectedNodeId,
        geminiApiKey,
        missingHints,
        addNode,
        addMultipleNodes,
        setMissingHints,
        updateNode,
        addStructureToNode,
        aiPlatform,
        aiGoal,
        aiAudience,
        aiScenario,
        setAiPlatform,
        setAiGoal,
        setAiAudience,
        setAiScenario,
        aiResults,
        addAiResult,
        removeAiResult,
    } = useMindMapStore();

    // 状态
    const [isLoading, setIsLoading] = useState(false);
    const [message, setMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);
    const [suggestions, setSuggestions] = useState<AIExpandSuggestion[]>([]);
    const [resultModal, setResultModal] = useState<{ isOpen: boolean; title: string; content: string }>({
        isOpen: false, title: '', content: ''
    });

    // 折叠状态
    const [expandedSections, setExpandedSections] = useState<Record<string, boolean>>({
        'smart-tools': false,
        'advanced': false,
    });
    const [showPresetSelector, setShowPresetSelector] = useState(false);

    const selectedNode = currentMap?.nodes[selectedNodeId || ''];
    const envApiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) as string | undefined;
    const storedApiKey = getStoredApiKey();
    const apiKey = geminiApiKey || envApiKey || storedApiKey;
    const hasApiKey = hasAiAccess(apiKey);

    // 显示消息
    const showMessage = useCallback((type: 'success' | 'error', text: string) => {
        setMessage({ type, text });
        setTimeout(() => setMessage(null), 3000);
    }, []);

    // 获取节点上下文
    const getNodeContext = useCallback((nodeId: string): string => {
        if (!currentMap) return '';
        const path: string[] = [];
        let currentId: string | null = nodeId;
        while (currentId) {
            const mapNode: MindMapNode | undefined = currentMap.nodes[currentId];
            if (!mapNode) break;
            path.unshift(mapNode.label);
            currentId = mapNode.parentId ?? null;
        }
        return path.join(' > ');
    }, [currentMap]);

    // 获取节点深度
    const getNodeDepth = (nodeId: string) => {
        if (!currentMap) return 0;
        let depth = 0;
        let currentId: string | null | undefined = nodeId;
        while (currentId) {
            const node = currentMap.nodes[currentId];
            if (!node?.parentId) break;
            depth += 1;
            currentId = node.parentId;
        }
        return depth;
    };

    // 切换折叠
    const toggleSection = (section: string) => {
        setExpandedSections(prev => ({ ...prev, [section]: !prev[section] }));
    };

    // ========== 一键扩展 ==========
    const handleQuickExpand = async () => {
        if (!selectedNode || !selectedNodeId) {
            showMessage('error', '请先选择一个节点');
            return;
        }

        setIsLoading(true);
        try {
            if (!hasApiKey) {
                showMessage('error', '请先配置 API 密钥');
                return;
            }
            const service = new GeminiService(apiKey);
            const context = getNodeContext(selectedNodeId);
            const depth = getNodeDepth(selectedNodeId);
            const result = await service.expandNode(selectedNode, context, undefined, depth);

            if (result.suggestions.length > 0) {
                const labels = result.suggestions.map(s => s.label);
                addMultipleNodes(selectedNodeId, labels);
                showMessage('success', `✅ 已添加 ${result.suggestions.length} 个子节点`);
            } else {
                showMessage('error', '未生成任何建议');
            }
        } catch (err) {
            showMessage('error', (err as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    // ========== 运行 Copilot 工具 ==========
    const runTool = async (toolId: string) => {
        if (!selectedNode || !currentMap || !selectedNodeId) {
            showMessage('error', '请先选择一个节点');
            return;
        }

        setIsLoading(true);
        try {
            if (!hasApiKey) {
                showMessage('error', '请先配置 API 密钥');
                return;
            }
            const service = new GeminiService(apiKey);
            const constraints = buildPlatformConstraints(aiPlatform, aiGoal, aiAudience, aiScenario);

            switch (toolId) {
                case 'cultivate': {
                    const suggestions = await service.cultivateIdeas(selectedNode.label, constraints);
                    if (suggestions.length) {
                        addStructureToNode(selectedNodeId, suggestions);
                        showMessage('success', `✅ 已生成 ${suggestions.length} 个想法`);
                    }
                    break;
                }
                case 'wbs': {
                    const steps = await service.jobBreakdown(selectedNode.label, constraints);
                    if (steps.length) {
                        addStructureToNode(selectedNodeId, steps);
                        showMessage('success', `✅ 已分解为 ${steps.length} 个步骤`);
                    }
                    break;
                }
                case 'optimize': {
                    const optimized = await service.optimizeLabel(selectedNode.label);
                    if (optimized) {
                        updateNode(selectedNodeId, { label: optimized });
                        showMessage('success', '✅ 文案已优化');
                    }
                    break;
                }
                case 'explain': {
                    const explanation = await service.explainTerm(selectedNode.label);
                    if (explanation) {
                        updateNode(selectedNodeId, { notes: explanation });
                        showMessage('success', '✅ 已添加解释说明');
                    }
                    break;
                }
                case 'regroup': {
                    const regrouped = await service.regroup(selectedNode.label, constraints);
                    if (regrouped.length) {
                        const wrapperId = addNode(selectedNodeId, '改组建议');
                        addStructureToNode(wrapperId, regrouped);
                        showMessage('success', '✅ 已生成改组建议');
                    }
                    break;
                }
                case 'desensitize': {
                    const masked = await service.desensitizeText(selectedNode.label);
                    if (masked) {
                        updateNode(selectedNodeId, { label: masked });
                        showMessage('success', '✅ 数据已脱敏');
                    }
                    break;
                }
                case 'video_script': {
                    const content = await service.generateVideoScriptResult(selectedNode.label, constraints);
                    if (content) {
                        setResultModal({
                            isOpen: true,
                            title: `🎬 视频脚本：${selectedNode.label}`,
                            content,
                        });
                        addNode(selectedNodeId, '视频脚本', undefined, content);
                        addAiResult(`视频脚本：${selectedNode.label}`, content);
                        showMessage('success', '✅ 已生成视频脚本');
                    }
                    break;
                }
                case 'cluster': {
                    const childIds = selectedNode.children || [];
                    const labels = childIds.map((id) => currentMap.nodes[id]?.label).filter(Boolean) as string[];
                    if (labels.length === 0) {
                        showMessage('error', '当前节点没有子节点可聚类');
                    } else {
                        const groups = await service.clusterNodes(labels);
                        if (groups.length) {
                            const groupRootId = addNode(selectedNodeId, '聚类结果');
                            groups.forEach((group) => {
                                addNode(groupRootId, group.label);
                            });
                            showMessage('success', `✅ 已生成 ${groups.length} 个分组`);
                        }
                    }
                    break;
                }
            }
        } catch (err) {
            showMessage('error', (err as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    // 处理预设扩展
    const handlePresetExpand = async (preset: ExpandPreset) => {
        if (!selectedNode || !currentMap || !selectedNodeId) return;

        setIsLoading(true);
        try {
            if (!hasApiKey) {
                showMessage('error', '请先配置 API 密钥');
                return;
            }
            const service = new GeminiService(apiKey);
            const context = getNodeContext(selectedNodeId);
            const depth = getNodeDepth(selectedNodeId);
            const contextParts = context.split(' > ');
            const rootTopic = contextParts[0] || selectedNode.label;
            const fullPrompt = buildPresetPrompt(preset, selectedNode.label, context, rootTopic);

            const result = await service.expandWithPreset(selectedNode, context, fullPrompt, depth);

            if (result.suggestions?.length) {
                const labels = result.suggestions.map((s: AIExpandSuggestion) => s.label);
                addMultipleNodes(selectedNodeId, labels);
                showMessage('success', `✅ [${preset.name}] 已添加 ${result.suggestions.length} 个节点`);
            }
        } catch (err) {
            showMessage('error', (err as Error).message);
        } finally {
            setIsLoading(false);
        }
    };

    // 处理缺失提示
    const handleAddMissingHint = (hint: string) => {
        if (!currentMap) return;
        addNode(currentMap.rootId, hint);
        setMissingHints(missingHints.filter((h) => h !== hint));
    };

    return (
        <div className="ai-panel-v2">
            <AIResultModal
                isOpen={resultModal.isOpen}
                onClose={() => setResultModal({ isOpen: false, title: '', content: '' })}
                title={resultModal.title}
                content={resultModal.content}
            />

            {/* 消息提示 */}
            {message && (
                <div className={`ai-message ${message.type}`}>
                    {message.type === 'success' ? <Check size={14} /> : <AlertCircle size={14} />}
                    {message.text}
                </div>
            )}

            {/* API 密钥警告 */}
            {!hasApiKey && (
                <div className="ai-warning-v2">
                    <AlertCircle size={16} />
                    <span>请先配置 API 密钥</span>
                </div>
            )}

            {/* 选中节点信息 */}
            {selectedNode && (
                <div className="selected-node-v2">
                    <Target size={14} />
                    <span className="node-label">{selectedNode.label}</span>
                </div>
            )}

            {/* ===== 一键扩展 ===== */}
            <button
                className="primary-expand-btn"
                onClick={handleQuickExpand}
                disabled={isLoading || !selectedNode}
            >
                {isLoading ? (
                    <>
                        <Loader2 size={20} className="spin" />
                        <span>AI 处理中...</span>
                    </>
                ) : (
                    <>
                        <Sparkles size={20} />
                        <span>AI 一键扩展</span>
                    </>
                )}
            </button>

            {/* ===== 快捷操作 ===== */}
            <div className="quick-actions-v2">
                {QUICK_ACTIONS.map((action) => (
                    <button
                        key={action.id}
                        className="quick-action-chip"
                        onClick={() => runTool(action.action)}
                        disabled={isLoading || !selectedNode}
                    >
                        <action.icon size={14} />
                        <span>{action.label}</span>
                    </button>
                ))}
            </div>

            {/* ===== 智能工具 (可折叠) ===== */}
            <div className="section-v2">
                <div
                    className="section-header-v2"
                    onClick={() => toggleSection('smart-tools')}
                >
                    {expandedSections['smart-tools'] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span>🧩 智能工具</span>
                </div>
                {expandedSections['smart-tools'] && (
                    <div className="smart-tools-grid">
                        {SMART_TOOLS.map((tool) => (
                            <button
                                key={tool.id}
                                className="smart-tool-btn"
                                onClick={() => runTool(tool.id)}
                                disabled={isLoading || !selectedNode}
                                style={{ '--tool-color': tool.color } as React.CSSProperties}
                            >
                                <tool.icon size={18} />
                                <span>{tool.label}</span>
                            </button>
                        ))}
                    </div>
                )}
            </div>

            {/* ===== 扩展模式 ===== */}
            <button
                className="preset-trigger-btn"
                onClick={() => setShowPresetSelector(true)}
                disabled={isLoading || !selectedNode}
            >
                <Sparkles size={16} />
                <span>✨ 选择扩展模式</span>
                <ChevronRight size={16} />
            </button>

            {/* 预设选择器模态框 */}
            <PresetSelector
                isOpen={showPresetSelector}
                onClose={() => setShowPresetSelector(false)}
                onSelect={(preset) => {
                    setShowPresetSelector(false);
                    handlePresetExpand(preset);
                }}
                targetNodeLabel={selectedNode?.label || ''}
            />

            {/* ===== 高级设置 (可折叠) ===== */}
            <div className="section-v2">
                <div
                    className="section-header-v2"
                    onClick={() => toggleSection('advanced')}
                >
                    {expandedSections['advanced'] ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                    <span>⚙️ 高级设置</span>
                </div>
                {expandedSections['advanced'] && (
                    <div className="advanced-settings-v2">
                        <div className="setting-row">
                            <label>平台</label>
                            <select value={aiPlatform} onChange={(e) => setAiPlatform(e.target.value as typeof aiPlatform)}>
                                <option value="tiktok">TikTok</option>
                                <option value="facebook">Facebook</option>
                                <option value="instagram">Instagram</option>
                            </select>
                        </div>
                        <div className="setting-row">
                            <label>目标</label>
                            <select value={aiGoal} onChange={(e) => setAiGoal(e.target.value as typeof aiGoal)}>
                                <option value="completion">完播</option>
                                <option value="engagement">互动</option>
                                <option value="conversion">转化</option>
                                <option value="follow">关注</option>
                            </select>
                        </div>
                        <div className="setting-row">
                            <input
                                type="text"
                                placeholder="目标人群（可选）"
                                value={aiAudience}
                                onChange={(e) => setAiAudience(e.target.value)}
                            />
                        </div>
                        <div className="setting-row">
                            <input
                                type="text"
                                placeholder="场景/品类（可选）"
                                value={aiScenario}
                                onChange={(e) => setAiScenario(e.target.value)}
                            />
                        </div>
                    </div>
                )}
            </div>

            {/* ===== 缺失提示 ===== */}
            {missingHints.length > 0 && (
                <div className="section-v2 missing-hints-v2">
                    <div className="section-header-v2">
                        <Lightbulb size={16} />
                        <span>💡 AI 建议补充</span>
                    </div>
                    <div className="hints-list-v2">
                        {missingHints.map((hint, i) => (
                            <button
                                key={i}
                                className="hint-chip"
                                onClick={() => handleAddMissingHint(hint)}
                            >
                                + {hint}
                            </button>
                        ))}
                    </div>
                </div>
            )}

            {/* ===== AI 结果历史 ===== */}
            {aiResults.length > 0 && (
                <div className="section-v2">
                    <div className="section-header-v2">
                        <FileText size={16} />
                        <span>📄 结果历史</span>
                    </div>
                    <div className="results-list-v2">
                        {aiResults.slice(0, 3).map((item) => (
                            <div key={item.id} className="result-item-v2">
                                <span className="result-title">{item.title}</span>
                                <button
                                    className="result-view-btn"
                                    onClick={() => setResultModal({ isOpen: true, title: item.title, content: item.content })}
                                >
                                    查看
                                </button>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </div>
    );
};
