/**
 * 写描述词节点 — 汇总上游数据，调用 Gemini 生成最终 Prompt
 * 支持两种指令来源：
 *  - 手动输入：用户自己写指令模板
 *  - 从随机库读取：自动从上游随机库的 linkedInstructions (表格配套指令) 读取
 */

import React, { useCallback, useState, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useHandleConnections, useNodesData, useEdges, useReactFlow } from '@xyflow/react';
import NodeHeader from './NodeHeader';
import { WfTextarea } from '../components/WfInputs';

const PromptWriterNode: React.FC<NodeProps> = ({ data }) => {
  const {
    instruction = '',
    result = '',
    isGenerating = false,
    nodeId,
    updateNodeData,
    useLinkedInstruction = false,
    cachedLinkedInstruction = '',
    customLabel,
    customColor,
  } = data as any;

  const [copied, setCopied] = useState(false);

  // 获取上游连接
  const connections = useHandleConnections({ type: 'target' });
  const connectedNodeIds = connections.map(c => c.source);
  const allEdges = useEdges();

  // 获取两层深的上游节点 ID（穿透覆盖节点找随机库）
  const allUpstreamIds = useMemo(() => {
    const ids = new Set(connectedNodeIds);
    // 对每个直接连接的节点，找它们的上游（第二层）
    for (const directId of connectedNodeIds) {
      const upEdges = allEdges.filter(e => e.target === directId);
      for (const e of upEdges) {
        ids.add(e.source);
      }
    }
    return Array.from(ids);
  }, [connectedNodeIds, allEdges]);

  const connectedNodesData = useNodesData(allUpstreamIds);

  // 手动刷新：用 useReactFlow BFS 全图
  const { getNodes, getEdges } = useReactFlow();

  // 从上游随机库读取配套指令 — 用 state + effect 替代 useMemo
  // 确保自动感知 + 手动刷新都写入同一个变量
  const [linkedInstruction, setLinkedInstruction] = useState(cachedLinkedInstruction || '');

  // 从节点图中 BFS 查找配套指令的核心函数
  const findLinkedInstruction = useCallback((): string => {
    const allNodes = getNodes();
    const edges = getEdges();
    const visited = new Set<string>();
    const queue = [...connectedNodeIds];
    while (queue.length > 0) {
      const cur = queue.shift()!;
      if (visited.has(cur)) continue;
      visited.add(cur);
      const node = allNodes.find(n => n.id === cur);
      if (!node) continue;
      const config = (node.data as any)?.randomLibraryConfig;
      if (config?.linkedInstructions) {
        const activeSheet = config.activeSourceSheet || '';
        const inst = config.linkedInstructions[activeSheet];
        if (inst?.trim()) return inst.trim();
        // 如果当前总库没有配套指令，遍历找第一个有的
        for (const val of Object.values(config.linkedInstructions)) {
          if ((val as string)?.trim()) return (val as string).trim();
        }
      }
      // 继续往上遍历
      const upEdges = edges.filter(e => e.target === cur);
      for (const e of upEdges) queue.push(e.source);
    }
    return '';
  }, [getNodes, getEdges, connectedNodeIds]);

  // 自动响应：当上游数据变化时，重新从全图读取最新指令
  // 注意：只更新本地 state，不调用 updateNodeData（否则会触发无限循环）
  const lastLinkedRef = useRef(linkedInstruction);
  useEffect(() => {
    const found = findLinkedInstruction();
    if (found && found !== lastLinkedRef.current) {
      lastLinkedRef.current = found;
      setLinkedInstruction(found);
    }
  }, [connectedNodesData, findLinkedInstruction]);

  // 手动刷新按钮
  const handleRefreshLinked = useCallback(() => {
    const found = findLinkedInstruction();
    if (found) {
      setLinkedInstruction(found);
      updateNodeData?.(nodeId, { cachedLinkedInstruction: found });
    }
  }, [findLinkedInstruction, nodeId, updateNodeData]);

  const handleInstructionChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeData?.(nodeId, { instruction: e.target.value });
    },
    [nodeId, updateNodeData]
  );

  const toggleInstructionSource = useCallback(() => {
    updateNodeData?.(nodeId, { useLinkedInstruction: !useLinkedInstruction });
  }, [nodeId, updateNodeData, useLinkedInstruction]);

  // 收集上游数据摘要
  const getUpstreamSummary = useCallback(() => {
    const parts: string[] = [];

    connectedNodesData.forEach((nodeData: any) => {
      if (!nodeData?.data) return;
      if (nodeData.data.text) {
        parts.push(`用户需求: ${nodeData.data.text}`);
      }
      if (nodeData.data.finalValues && Array.isArray(nodeData.data.finalValues)) {
        parts.push(`风格词条: ${nodeData.data.finalValues.join(', ')}`);
      }
      if (nodeData.data.combination) {
        parts.push(`随机组合: ${nodeData.data.combination}`);
      }
    });

    // 去重（多路径连接可能产生重复数据）
    return [...new Set(parts)].join('\n');
  }, [connectedNodesData]);

  const handleCopy = useCallback(async () => {
    if (!result) return;
    try {
      await navigator.clipboard.writeText(result);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { }
  }, [result]);

  const upstreamSummary = getUpstreamSummary();

  // 放大编辑弹窗状态：{ text, field, editable }
  const [expandModal, setExpandModal] = useState<{ text: string; field: string; editable: boolean } | null>(null);

  // 阻止滚轮事件冒泡到 ReactFlow（否则会变成画布缩放）
  const stopWheelPropagation = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  const effectiveInstruction = useLinkedInstruction && linkedInstruction ? linkedInstruction : instruction;

  return (
    <div className="wf-node writer-node" style={customColor ? { borderColor: `${customColor}66`, borderLeftColor: customColor } : undefined}>
      <NodeHeader
        icon="✨" defaultLabel="写描述词" customLabel={customLabel} customColor={customColor}
        nodeId={nodeId} updateNodeData={updateNodeData} nodeNote={(data as any).nodeNote}
      />
      <div className="wf-node-body">
        {/* 指令来源开关 */}
        <div className="wf-instruction-source">
          <button
            className={`wf-source-tab ${!useLinkedInstruction ? 'active' : ''}`}
            onClick={() => updateNodeData?.(nodeId, { useLinkedInstruction: false })}
          >
            ✏️ 手动输入
          </button>
          <button
            className={`wf-source-tab ${useLinkedInstruction ? 'active' : ''}`}
            onClick={() => updateNodeData?.(nodeId, { useLinkedInstruction: true })}
          >
            📋 从表格读取
          </button>
        </div>

        {useLinkedInstruction ? (
          <div>
            <div className="wf-node-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span>配套指令（自动读取）</span>
              <button
                onClick={handleRefreshLinked}
                style={{
                  background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
                  borderRadius: '4px', padding: '1px 6px', fontSize: '10px',
                  color: '#a5b4fc', cursor: 'pointer',
                }}
                title="手动刷新：从上游随机库重新读取配套指令"
              >🔄 刷新</button>
            </div>
            {linkedInstruction ? (
              <div
                onWheelCapture={stopWheelPropagation}
                onDoubleClick={() => setExpandModal({ text: linkedInstruction, field: 'linkedInstruction', editable: true })}
                title="双击放大查看"
                style={{
                  padding: '8px 10px',
                  borderRadius: '6px',
                  background: 'rgba(99, 102, 241, 0.05)',
                  border: '1px solid rgba(99, 102, 241, 0.15)',
                  fontSize: '11px',
                  color: '#a5b4fc',
                  maxHeight: '80px',
                  overflow: 'auto',
                  whiteSpace: 'pre-wrap',
                  cursor: 'pointer',
                }}>
                {linkedInstruction}
              </div>
            ) : (
              <div style={{
                padding: '8px 10px',
                borderRadius: '6px',
                background: 'rgba(255,255,255,0.02)',
                border: '1px dashed rgba(255,255,255,0.1)',
                fontSize: '11px',
                color: '#64748b',
                textAlign: 'center',
              }}>
                ⚠️ 上游随机库尚未导入配套指令
                <br/>
                <span style={{ fontSize: '10px' }}>请在随机库设置中导入数据后点击 🔄 刷新</span>
              </div>
            )}
          </div>
        ) : (
          <div>
            <div className="wf-node-label">指令模板（可选）</div>
            <WfTextarea
              value={instruction}
              onChangeContent={(val) => updateNodeData?.(nodeId, { instruction: val })}
              onKeyDown={e => e.stopPropagation()}
              onWheelCapture={stopWheelPropagation}
              onDoubleClick={() => setExpandModal({ text: instruction, field: 'instruction', editable: true })}
              placeholder="输入发送给 AI 的指令模板...（双击放大编辑）"
              title="双击放大编辑"
              rows={3}
            />
          </div>
        )}

        {upstreamSummary && (
          <div>
            <div className="wf-node-label">上游数据汇总</div>
            <div
              onWheelCapture={stopWheelPropagation}
              onDoubleClick={() => setExpandModal({ text: upstreamSummary, field: 'upstream', editable: false })}
              title="双击放大查看"
              style={{
                padding: '6px 10px',
                borderRadius: '6px',
                background: 'rgba(255,255,255,0.03)',
                border: '1px solid rgba(255,255,255,0.08)',
                fontSize: '11px',
                color: '#94a3b8',
                maxHeight: '80px',
                overflow: 'auto',
                whiteSpace: 'pre-wrap',
                cursor: 'pointer',
              }}>
              {upstreamSummary}
            </div>
          </div>
        )}

        {result && (
          <div>
            <div className="wf-node-label">生成结果</div>
            <div
              className="wf-result-box"
              onWheelCapture={stopWheelPropagation}
              onDoubleClick={() => setExpandModal({ text: result, field: 'result', editable: true })}
              title="双击放大查看"
              style={{ cursor: 'pointer' }}
            >{result}</div>
            <div className="wf-result-actions" style={{ marginTop: '6px' }}>
              <button
                className="wf-node-btn wf-node-btn-secondary"
                onClick={handleCopy}
              >
                {copied ? '✅ 已复制' : '📋 复制'}
              </button>
            </div>
          </div>
        )}

        {isGenerating && (
          <div style={{
            display: 'flex',
            alignItems: 'center',
            gap: '8px',
            padding: '8px',
            fontSize: '12px',
            color: '#10b981',
          }}>
            <span className="wf-spinner" style={{ borderTopColor: '#10b981' }} />
            AI 正在生成描述词...
          </div>
        )}
      </div>

      <Handle type="target" position={Position.Left} id="target-left" />
      <Handle type="target" position={Position.Top} id="target-top" />
      <Handle type="target" position={Position.Right} id="target-right" />
      <Handle type="target" position={Position.Bottom} id="target-bottom" />
      <Handle type="source" position={Position.Right} id="source-right" />
      <Handle type="source" position={Position.Bottom} id="source-bottom" />
      <Handle type="source" position={Position.Left} id="source-left" />
      <Handle type="source" position={Position.Top} id="source-top" />

      {/* 双击放大编辑弹窗 — 用 Portal 渲染到 body，避免拖拽冲突 */}
      {expandModal && createPortal(
        <div
          onClick={() => {
            // 关闭时自动保存可编辑内容
            if (expandModal.editable && expandModal.field === 'linkedInstruction') {
              updateNodeData?.(nodeId, { cachedLinkedInstruction: expandModal.text });
            } else if (expandModal.editable && expandModal.field === 'result') {
              updateNodeData?.(nodeId, { result: expandModal.text });
            } else if (expandModal.editable && expandModal.field === 'instruction') {
              updateNodeData?.(nodeId, { instruction: expandModal.text });
            }
            setExpandModal(null);
          }}
          onMouseDown={e => e.stopPropagation()}
          onPointerDown={e => e.stopPropagation()}
          style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '24px',
          }}
        >
          <div
            onClick={e => e.stopPropagation()}
            onMouseDown={e => e.stopPropagation()}
            onPointerDown={e => e.stopPropagation()}
            style={{
              background: '#1e1e2e', border: '1px solid #444', borderRadius: '12px',
              width: '90vw', maxWidth: '900px', maxHeight: '85vh',
              minWidth: '300px', minHeight: '200px',
              display: 'flex', flexDirection: 'column', overflow: 'hidden',
              boxShadow: '0 25px 50px rgba(0,0,0,0.5)',
              resize: 'both',
            }}
          >
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 16px', borderBottom: '1px solid #333',
            }}>
              <span style={{ fontSize: '13px', fontWeight: 600, color: '#e2e8f0' }}>
                {expandModal.editable ? '✏️ 编辑内容' : '📄 查看内容'}
              </span>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  onClick={() => { navigator.clipboard.writeText(expandModal.text); }}
                  style={{
                    background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.3)',
                    borderRadius: '6px', padding: '4px 10px', fontSize: '11px',
                    color: '#a5b4fc', cursor: 'pointer',
                  }}
                >📋 复制</button>
                {expandModal.editable && (
                  <button
                    onClick={() => {
                      if (expandModal.field === 'linkedInstruction') {
                        updateNodeData?.(nodeId, { cachedLinkedInstruction: expandModal.text });
                      } else if (expandModal.field === 'result') {
                        updateNodeData?.(nodeId, { result: expandModal.text });
                      } else if (expandModal.field === 'instruction') {
                        updateNodeData?.(nodeId, { instruction: expandModal.text });
                      }
                      setExpandModal(null);
                    }}
                    style={{
                      background: 'rgba(34,197,94,0.15)', border: '1px solid rgba(34,197,94,0.3)',
                      borderRadius: '6px', padding: '4px 10px', fontSize: '11px',
                      color: '#4ade80', cursor: 'pointer',
                    }}
                  >💾 保存关闭</button>
                )}
                <button
                  onClick={() => setExpandModal(null)}
                  style={{
                    background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                    borderRadius: '6px', padding: '4px 10px', fontSize: '11px',
                    color: '#94a3b8', cursor: 'pointer',
                  }}
                >✕ 关闭</button>
              </div>
            </div>
            {expandModal.editable ? (
              <textarea
                value={expandModal.text}
                onChange={e => setExpandModal({ ...expandModal, text: e.target.value })}
                style={{
                  flex: 1, padding: '16px', border: 'none', outline: 'none',
                  fontSize: '13px', color: '#e2e8f0', whiteSpace: 'pre-wrap',
                  lineHeight: '1.6', background: 'transparent', resize: 'none',
                  fontFamily: 'inherit',
                }}
              />
            ) : (
              <div style={{
                flex: 1, overflowY: 'auto', padding: '16px',
                fontSize: '13px', color: '#e2e8f0', whiteSpace: 'pre-wrap',
                lineHeight: '1.6', userSelect: 'text',
              }}>
                {expandModal.text}
              </div>
            )}
            <div style={{
              padding: '6px 16px', borderTop: '1px solid #333',
              fontSize: '10px', color: '#475569', textAlign: 'center',
            }}>
              {expandModal.editable ? '直接编辑 · 拖拽右下角调整大小 · 点击外部自动保存' : '拖拽右下角调整大小 · 点击外部关闭'}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default PromptWriterNode;
