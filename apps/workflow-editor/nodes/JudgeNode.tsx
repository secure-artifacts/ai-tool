/**
 * 判断节点 — 根据上游输入，按条件规则决定输出
 * 核心逻辑：
 *  1. 接收两路输入：用户输入（A）和 随机代码输出（B）
 *  2. 根据判断规则决定最终输出
 *  3. 支持多种判断模式：
 *     - 优先替换：用户指定的维度覆盖随机结果中同名维度
 *     - 关键词匹配：检测 A 是否包含关键词
 *     - 非空判断：A 有内容就用 A，否则用 B
 *     - 自定义代码：写 JS 表达式
 */

import React, { useCallback, useState, useMemo, useEffect } from 'react';
import { Handle, Position, NodeProps, useHandleConnections, useNodesData } from '@xyflow/react';
import NodeHeader from './NodeHeader';
import { WfTextarea, WfInput } from '../components/WfInputs';

type JudgeMode = 'priorityReplace' | 'keyword' | 'nonempty' | 'custom';

interface ReplaceRule {
  id: string;
  keyword: string;    // 库名关键词，如 "场景"
  replaceAll: boolean; // true=全部替换, false=只替换第一个
}

const JudgeNode: React.FC<NodeProps> = ({ data }) => {
  const { nodeId, updateNodeData, customLabel, customColor, nodeNote } = data as any;

  // 判断模式
  const [judgeMode, setJudgeMode] = useState<JudgeMode>(
    () => (data as any).judgeMode || 'priorityReplace'
  );

  // 优先替换模式的规则
  const [replaceRules, setReplaceRules] = useState<ReplaceRule[]>(
    () => (data as any).replaceRules || [
      { id: 'r1', keyword: '', replaceAll: true },
    ]
  );

  // 全局优先关键词
  const [globalKeyword, setGlobalKeyword] = useState<string>(
    () => (data as any).globalKeyword || '全局优先'
  );

  // 追加关键词
  const [appendKeywords, setAppendKeywords] = useState<string>(
    () => (data as any).appendKeywords || '新要求、特殊要求'
  );

  // 关键词匹配模式的关键词
  const [matchKeywords, setMatchKeywords] = useState<string>(
    () => (data as any).matchKeywords || ''
  );

  // 自定义代码
  const [customCode, setCustomCode] = useState<string>(
    () => (data as any).customCode || '// A = 用户输入, B = 随机结果\nreturn A ? A : B;'
  );

  // 运行结果
  const [lastResult, setLastResult] = useState<string>((data as any).lastResult || '');
  const [lastError, setLastError] = useState<string>('');

  // 获取上游连接
  const connections = useHandleConnections({ type: 'target' });
  const connectedNodeIds = connections.map(c => c.source);
  const connectedNodesData = useNodesData(connectedNodeIds);

  // 保存配置变化
  useEffect(() => {
    updateNodeData?.(nodeId, {
      judgeMode, replaceRules, globalKeyword, appendKeywords,
      matchKeywords, customCode,
    });
  }, [judgeMode, replaceRules, globalKeyword, appendKeywords, matchKeywords, customCode, nodeId, updateNodeData]);

  // 收集上游 A (用户输入) 和 B (随机/代码结果)
  const { inputA, inputB } = useMemo(() => {
    let a = '';
    let b = '';
    connectedNodesData.forEach((nd: any) => {
      if (!nd?.data) return;
      // 优先识别类型：输入节点 → A, 随机/代码节点 → B
      if (nd.type === 'inputNode' || nd.type === 'fileNode') {
        a = nd.data.text || '';
      } else if (nd.data.result || nd.data.combination || nd.data.lastResult) {
        b = nd.data.result || nd.data.combination || nd.data.lastResult || '';
      } else if (nd.data.text) {
        // 兜底：如果上游有 text 但不是输入节点
        if (!a) a = nd.data.text;
        else if (!b) b = nd.data.text;
      }
    });
    return { inputA: a, inputB: b };
  }, [connectedNodesData]);

  // 阻止滚轮冒泡
  const stopWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  // 执行判断逻辑
  const runJudge = useCallback(() => {
    try {
      setLastError('');
      let result = '';
      const A = inputA;
      const B = inputB;

      switch (judgeMode) {
        case 'priorityReplace': {
          // 优先替换模式
          // 1. 检查全局优先关键词
          if (globalKeyword && A.includes(globalKeyword)) {
            result = A;
            break;
          }

          // 2. 从 A 中提取用户指定的维度值，替换到 B 中
          result = B;
          for (const rule of replaceRules) {
            if (!rule.keyword.trim()) continue;
            const kw = rule.keyword.trim();
            // 从 A 中提取：支持 "【库名】值" "库名: 值" "库名=值" 格式
            const patterns = [
              new RegExp(`(?:【${kw}】|\\[${kw}\\])\\s*[:：=]?\\s*(.+?)(?:\\n|$)`, 'i'),
              new RegExp(`${kw}\\s*[:：=]\\s*(.+?)(?:\\n|$)`, 'i'),
            ];
            let userValue = '';
            for (const pat of patterns) {
              const m = A.match(pat);
              if (m && m[1]?.trim()) {
                userValue = m[1].trim();
                break;
              }
            }
            if (!userValue) continue;

            // 在 B 中替换同名维度
            const replacePatterns = [
              new RegExp(`((?:【${kw}】|\\[${kw}\\])\\s*[:：=]?\\s*)([^\\n]*)`, rule.replaceAll ? 'gi' : 'i'),
              new RegExp(`(${kw}\\s*[:：=]\\s*)([^\\n]*)`, rule.replaceAll ? 'gi' : 'i'),
            ];
            for (const rp of replacePatterns) {
              if (rp.test(result)) {
                result = result.replace(rp, `$1${userValue}`);
                break;
              }
            }
          }

          // 3. 提取追加关键词内容
          if (appendKeywords.trim()) {
            const appendKws = appendKeywords.split(/[,，、\s]+/).filter(Boolean);
            for (const ak of appendKws) {
              const akPat = new RegExp(`(?:【?${ak}】?)\\s*[:：=]?\\s*(.+?)(?:\\n|$)`, 'i');
              const m = A.match(akPat);
              if (m && m[1]?.trim()) {
                result = result.trimEnd() + '\n' + m[1].trim();
              }
            }
          }
          break;
        }

        case 'keyword': {
          const kws = matchKeywords.split(/[,，、\s]+/).filter(Boolean);
          const hasMatch = kws.some(kw => A.includes(kw));
          result = hasMatch ? A : B;
          break;
        }

        case 'nonempty': {
          result = A.trim() ? A : B;
          break;
        }

        case 'custom': {
          const fn = new Function('A', 'B', customCode);
          result = String(fn(A, B) ?? '');
          break;
        }
      }

      setLastResult(result);
      updateNodeData?.(nodeId, { result, lastResult: result, combination: result });
    } catch (err: any) {
      setLastError(err.message || '判断代码运行出错');
      setLastResult('');
    }
  }, [judgeMode, inputA, inputB, replaceRules, globalKeyword, appendKeywords, matchKeywords, customCode, nodeId, updateNodeData]);

  // 添加规则
  const addRule = useCallback(() => {
    setReplaceRules(prev => [
      ...prev,
      { id: `r-${Date.now()}`, keyword: '', replaceAll: true },
    ]);
  }, []);

  // 删除规则
  const removeRule = useCallback((id: string) => {
    setReplaceRules(prev => prev.filter(r => r.id !== id));
  }, []);

  // 更新规则
  const updateRule = useCallback((id: string, updates: Partial<ReplaceRule>) => {
    setReplaceRules(prev => prev.map(r => r.id === id ? { ...r, ...updates } : r));
  }, []);

  const modeLabels: Record<JudgeMode, { icon: string; label: string; desc: string }> = {
    priorityReplace: { icon: '🔀', label: '优先替换', desc: '用户指定维度覆盖随机结果' },
    keyword: { icon: '🔍', label: '关键词', desc: '检测输入中是否包含关键词' },
    nonempty: { icon: '📝', label: '非空判断', desc: 'A 有内容用 A，否则用 B' },
    custom: { icon: '⚡', label: '自定义', desc: '写 JS 代码判断' },
  };

  return (
    <div className="wf-node judge-node" style={customColor ? { borderColor: `${customColor}66`, borderLeftColor: customColor } : undefined}>
      <NodeHeader
        icon="⚖️" defaultLabel="判断节点" customLabel={customLabel} customColor={customColor}
        nodeId={nodeId} updateNodeData={updateNodeData} nodeNote={nodeNote}
        trailing={
          <span style={{ fontSize: '10px', color: '#94a3b8' }}>
            {modeLabels[judgeMode].icon} {modeLabels[judgeMode].label}
          </span>
        }
      />
      <div className="wf-node-body">
        {/* 上游输入预览 */}
        <div style={{ display: 'flex', gap: '6px' }}>
          <div style={{ flex: 1 }}>
            <div className="wf-node-label">A 用户输入</div>
            <div style={{
              padding: '4px 6px', borderRadius: '4px', fontSize: '10px',
              background: 'rgba(59,130,246,0.06)', border: '1px solid rgba(59,130,246,0.15)',
              color: '#93c5fd', maxHeight: '40px', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {inputA || '—（未连接）'}
            </div>
          </div>
          <div style={{ flex: 1 }}>
            <div className="wf-node-label">B 随机结果</div>
            <div style={{
              padding: '4px 6px', borderRadius: '4px', fontSize: '10px',
              background: 'rgba(139,92,246,0.06)', border: '1px solid rgba(139,92,246,0.15)',
              color: '#c4b5fd', maxHeight: '40px', overflow: 'hidden',
              textOverflow: 'ellipsis', whiteSpace: 'nowrap',
            }}>
              {inputB || '—（未连接）'}
            </div>
          </div>
        </div>

        {/* 模式切换 */}
        <div>
          <div className="wf-node-label">判断模式</div>
          <div style={{ display: 'flex', gap: '3px', flexWrap: 'wrap' }}>
            {(Object.keys(modeLabels) as JudgeMode[]).map(mode => (
              <button
                key={mode}
                className={`wf-node-btn ${judgeMode === mode ? 'wf-node-btn-primary' : 'wf-node-btn-secondary'}`}
                onClick={() => setJudgeMode(mode)}
                style={{ fontSize: '10px', padding: '3px 8px' }}
              >
                {modeLabels[mode].icon} {modeLabels[mode].label}
              </button>
            ))}
          </div>
          <div style={{ fontSize: '9px', color: '#64748b', marginTop: '3px' }}>
            {modeLabels[judgeMode].desc}
          </div>
        </div>

        {/* 模式配置区 */}
        {judgeMode === 'priorityReplace' && (
          <div onWheelCapture={stopWheel}>
            <div className="wf-node-label" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <span>替换规则</span>
              <button
                className="wf-node-btn wf-node-btn-secondary"
                onClick={addRule}
                style={{ fontSize: '9px', padding: '1px 6px' }}
              >+ 添加规则</button>
            </div>

            {/* 全局优先 */}
            <div style={{ marginBottom: '6px' }}>
              <div style={{ fontSize: '9px', color: '#64748b', marginBottom: '2px' }}>
                全局优先关键词（输入包含此词 → 直接用 A）
              </div>
              <WfInput
                type="text"
                value={globalKeyword}
                onChangeContent={val => setGlobalKeyword(val)}
                onKeyDown={e => e.stopPropagation()}
                placeholder="全局优先"
                style={{ width: '100%', padding: '3px 6px', fontSize: '10px' }}
              />
            </div>

            {/* 替换规则列表 */}
            {replaceRules.map(rule => (
              <div key={rule.id} style={{
                display: 'flex', gap: '4px', alignItems: 'center', marginBottom: '3px',
              }}>
                <WfInput
                  type="text"
                  value={rule.keyword}
                  onChangeContent={val => updateRule(rule.id, { keyword: val })}
                  onKeyDown={e => e.stopPropagation()}
                  placeholder="库名关键词"
                  style={{ flex: 1, padding: '3px 6px', fontSize: '10px' }}
                />
                <button
                  className="wf-node-btn wf-node-btn-secondary"
                  onClick={() => updateRule(rule.id, { replaceAll: !rule.replaceAll })}
                  style={{ fontSize: '9px', padding: '2px 5px', whiteSpace: 'nowrap' }}
                  title={rule.replaceAll ? '全部替换' : '仅第一个'}
                >
                  {rule.replaceAll ? '全部' : '首个'}
                </button>
                <button
                  onClick={() => removeRule(rule.id)}
                  style={{
                    background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                    borderRadius: '4px', color: '#f87171', cursor: 'pointer',
                    fontSize: '10px', padding: '1px 4px',
                  }}
                >✕</button>
              </div>
            ))}

            {/* 追加关键词 */}
            <div style={{ marginTop: '4px' }}>
              <div style={{ fontSize: '9px', color: '#64748b', marginBottom: '2px' }}>
                追加关键词（输入包含这些词 → 追加到结果末尾）
              </div>
              <WfInput
                type="text"
                value={appendKeywords}
                onChangeContent={val => setAppendKeywords(val)}
                onKeyDown={e => e.stopPropagation()}
                placeholder="新要求、特殊要求"
                style={{ width: '100%', padding: '3px 6px', fontSize: '10px' }}
              />
            </div>
          </div>
        )}

        {judgeMode === 'keyword' && (
          <div>
            <div className="wf-node-label">匹配关键词（逗号分隔）</div>
              <WfInput
              type="text"
              value={matchKeywords}
              onChangeContent={val => setMatchKeywords(val)}
              onKeyDown={e => e.stopPropagation()}
              placeholder="关键词1, 关键词2, 关键词3"
              style={{ width: '100%', padding: '4px 8px', fontSize: '11px' }}
            />
            <div style={{ fontSize: '9px', color: '#64748b', marginTop: '3px' }}>
              A 包含任一关键词 → 输出 A，否则 → 输出 B
            </div>
          </div>
        )}

        {judgeMode === 'nonempty' && (
          <div style={{ fontSize: '11px', color: '#94a3b8', padding: '8px', textAlign: 'center' }}>
            ✅ 无需配置<br />
            <span style={{ fontSize: '10px', color: '#64748b' }}>A 不为空 → 输出 A<br />A 为空 → 输出 B</span>
          </div>
        )}

        {judgeMode === 'custom' && (
          <div>
            <div className="wf-node-label">自定义 JS 代码</div>
            <WfTextarea
              value={customCode}
              onChangeContent={val => setCustomCode(val)}
              onKeyDown={e => e.stopPropagation()}
              onWheelCapture={stopWheel}
              rows={4}
              style={{
                fontFamily: 'monospace', fontSize: '11px', lineHeight: '1.5',
                tabSize: 2, whiteSpace: 'pre', overflowWrap: 'normal',
              }}
              spellCheck={false}
            />
            <div style={{ fontSize: '9px', color: '#64748b', marginTop: '2px' }}>
              变量: A = 用户输入, B = 随机结果. 用 return 返回
            </div>
          </div>
        )}

        {/* 运行按钮 + 跳转 */}
        <div style={{ display: 'flex', gap: '4px' }}>
          <button
            className="wf-node-btn wf-node-btn-primary"
            onClick={runJudge}
            style={{ flex: 1 }}
          >
            ⚖️ 运行判断
          </button>
          <button
            className="wf-node-btn wf-node-btn-secondary"
            onClick={() => {
              window.dispatchEvent(new CustomEvent('navigate-to-tool', {
                detail: { tool: 'skillGenerator', subTab: 'codegen' },
              }));
            }}
            title="跳转到模版指令的判断代码生成工具"
            style={{ padding: '4px 8px', fontSize: '10px', whiteSpace: 'nowrap' }}
          >
            🔀 判断工具 ↗
          </button>
        </div>

        {/* 错误 */}
        {lastError && (
          <div style={{
            padding: '6px 8px', borderRadius: '6px',
            background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
            fontSize: '11px', color: '#f87171',
          }}>
            ❌ {lastError}
          </div>
        )}

        {/* 结果 */}
        {lastResult && (
          <div>
            <div className="wf-node-label">判断结果</div>
            <div
              className="wf-result-box"
              style={{ maxHeight: '100px', cursor: 'pointer' }}
              onClick={async () => {
                try {
                  await navigator.clipboard.writeText(lastResult);
                } catch {}
              }}
              title="点击复制"
            >
              {lastResult}
            </div>
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
    </div>
  );
};

export default JudgeNode;
