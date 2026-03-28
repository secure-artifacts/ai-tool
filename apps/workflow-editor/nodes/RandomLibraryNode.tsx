/**
 * 随机库节点 — 完整复刻 AI 图片识别中的随机库设置
 * 直接嵌入 RandomLibraryManager 组件
 * 新增下拉菜单可快速切换启用/禁用库
 */

import React, { useCallback, useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps } from '@xyflow/react';
import NodeHeader from './NodeHeader';
import { WfTextarea, WfInput } from '../components/WfInputs';
import { RandomLibraryManager } from '../../ai-image-recognition/components/RandomLibraryManager';
import {
  RandomLibraryConfig,
  DEFAULT_RANDOM_LIBRARY_CONFIG,
  getDefaultLibraries,
  generateRandomCombination,
  pickRandomValues,
} from '../../ai-image-recognition/services/randomLibraryService';

const RandomLibraryNode: React.FC<NodeProps> = ({ data }) => {
  const { nodeId, updateNodeData } = data as any;

  // 随机库配置 — 完整的 RandomLibraryConfig
  const [config, setConfig] = useState<RandomLibraryConfig>(() => {
    // 优先使用已保存的配置（如果从 data 恢复）
    if (data.randomLibraryConfig) {
      return data.randomLibraryConfig as RandomLibraryConfig;
    }
    return {
      ...DEFAULT_RANDOM_LIBRARY_CONFIG,
      libraries: getDefaultLibraries(),
      enabled: true,
    };
  });

  // 用 ref 追踪内部更新，防止 sync 循环
  const internalUpdateRef = useRef(false);

  // 当外部 data.randomLibraryConfig 变化时同步到内部 state
  // 这解决了 loadFlow 后配置丢失的问题（useState 只读一次初始值）
  useEffect(() => {
    if (internalUpdateRef.current) {
      internalUpdateRef.current = false;
      return;
    }
    if (data.randomLibraryConfig && data.randomLibraryConfig !== config) {
      const external = data.randomLibraryConfig as RandomLibraryConfig;
      // 只在库数据真正不同时才同步（避免无限循环）
      if (external.libraries && JSON.stringify(external.libraries) !== JSON.stringify(config.libraries)) {
        setConfig(external);
      }
    }
  }, [data.randomLibraryConfig]); // eslint-disable-line react-hooks/exhaustive-deps

  const [showManager, setShowManager] = useState(false);
  const [previewCombination, setPreviewCombination] = useState('');
  const [showLibDropdown, setShowLibDropdown] = useState(false);
  const [libSearchQuery, setLibSearchQuery] = useState('');
  const [nodeToast, setNodeToast] = useState('');
  const nodeToastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const showNodeToast = useCallback((msg: string) => {
    setNodeToast(msg);
    if (nodeToastTimer.current) clearTimeout(nodeToastTimer.current);
    nodeToastTimer.current = setTimeout(() => setNodeToast(''), 3000);
  }, []);

  // 配置变化时同步到节点数据
  useEffect(() => {
    internalUpdateRef.current = true;
    updateNodeData?.(nodeId, {
      randomLibraryConfig: config,
    });
  }, [config, nodeId, updateNodeData]);

  // 配置变更
  const handleConfigChange = useCallback((newConfig: RandomLibraryConfig) => {
    setConfig(newConfig);
  }, []);

  // 切换单个库的启用/禁用
  const toggleLibrary = useCallback((libId: string) => {
    setConfig(prev => ({
      ...prev,
      libraries: prev.libraries.map(lib =>
        lib.id === libId ? { ...lib, enabled: !lib.enabled } : lib
      ),
    }));
  }, []);

  // 生成预览组合
  const handlePreview = useCallback(() => {
    const enabledLibs = config.libraries.filter(lib => lib.enabled && lib.values.length > 0);
    if (enabledLibs.length === 0) {
      setPreviewCombination('（没有启用的库或库为空）');
      return;
    }

    const parts = enabledLibs.map(lib => {
      const picked = pickRandomValues(lib);
      return `[${lib.name}] ${picked.join('、')}`;
    });

    const combination = parts.join(' + ');
    setPreviewCombination(combination);

    // 同步到节点数据供下游使用
    updateNodeData?.(nodeId, {
      combination,
      randomLibraryConfig: config,
    });
  }, [config, nodeId, updateNodeData]);

  // 统计信息
  const enabledCount = config.libraries.filter(lib => lib.enabled && lib.values.length > 0).length;
  const totalCount = config.libraries.length;
  const totalValues = config.libraries.reduce((sum, lib) => sum + lib.values.length, 0);

  return (
    <div className="wf-node random-node" style={(data as any).customColor ? { borderColor: `${(data as any).customColor}66`, borderLeftColor: (data as any).customColor } : undefined}>
      <NodeHeader
        icon="🎲" defaultLabel="随机库" customLabel={(data as any).customLabel} customColor={(data as any).customColor}
        nodeId={nodeId} updateNodeData={updateNodeData} nodeNote={(data as any).nodeNote}
        trailing={
          <span style={{ fontSize: '10px', color: '#94a3b8', display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '2px' }}>
            <span>{config.activeSourceSheet ? `[ ${config.activeSourceSheet} ]` : ''}</span>
            <span>{enabledCount}/{totalCount} 库 · {totalValues} 词条</span>
          </span>
        }
      />
      <div className="wf-node-body">
        {/* 随机库管理器入口 */}
        <button
          className="wf-node-btn wf-node-btn-primary"
          onClick={() => setShowManager(true)}
          style={{ width: '100%' }}
        >
          ⚙️ 打开随机库设置
        </button>

        {/* 快速选库下拉 — 按总库分组 */}
        <div className="wf-lib-dropdown-wrap">
          <button
            className="wf-node-btn wf-node-btn-secondary"
            onClick={() => setShowLibDropdown(!showLibDropdown)}
            style={{ width: '100%' }}
          >
            📚 快速选库 {showLibDropdown ? '▲' : '▼'}
          </button>
          {showLibDropdown && (() => {
            // 按 sourceSheet（总库）分组
            const groups = new Map<string, typeof config.libraries>();
            for (const lib of config.libraries) {
              const key = lib.sourceSheet || '默认库';
              if (!groups.has(key)) groups.set(key, []);
              groups.get(key)!.push(lib);
            }

            // 单选：选中某个总库，禁用其他所有
            const selectGroup = (groupKey: string) => {
              const groupLibs = groups.get(groupKey);
              if (!groupLibs) return;
              const isCurrentlySelected = groupLibs.every(l => l.enabled);
              const newActiveSheet = isCurrentlySelected ? '' : groupKey;
              const newLibraries = config.libraries.map(lib => ({
                ...lib,
                enabled: isCurrentlySelected
                  ? false // 取消选择
                  : (lib.sourceSheet || '默认库') === groupKey, // 只启用选中组
              }));
              const newConfig = { ...config, activeSourceSheet: newActiveSheet, libraries: newLibraries };
              setConfig(newConfig);
              // 立即同步到 React Flow 节点数据，确保下游节点（写描述词）能即时感知变化
              updateNodeData?.(nodeId, { randomLibraryConfig: newConfig });
            };

            // 搜索过滤
            const query = libSearchQuery.trim().toLowerCase();
            const filteredGroups = query
              ? new Map(Array.from(groups.entries()).filter(([name]) => name.toLowerCase().includes(query)))
              : groups;

            return (
              <div className="wf-lib-dropdown" onWheelCapture={e => e.stopPropagation()}>
                <div style={{ padding: '4px 6px', borderBottom: '1px solid rgba(255,255,255,0.06)' }}>
                  <WfInput
                    type="text"
                    placeholder="🔍 搜索总库..."
                    value={libSearchQuery}
                    onChangeContent={val => setLibSearchQuery(val)}
                    onKeyDown={e => e.stopPropagation()}
                    style={{
                      width: '100%', padding: '4px 8px', borderRadius: '4px',
                      border: '1px solid rgba(99,102,241,0.2)', background: 'rgba(15,23,42,0.8)',
                      color: '#e2e8f0', fontSize: '11px', outline: 'none', boxSizing: 'border-box',
                    }}
                  />
                </div>
                {filteredGroups.size === 0 ? (
                  <div className="wf-lib-dropdown-empty">{query ? '没有匹配的总库' : '暂无库，请先在设置中添加'}</div>
                ) : (
                  Array.from(filteredGroups.entries()).map(([groupName, libs]) => {
                    const allEnabled = libs.every(l => l.enabled);
                    const totalVals = libs.reduce((s, l) => s + l.values.length, 0);
                    return (
                      <label
                        key={groupName}
                        className={`wf-lib-dropdown-item ${allEnabled ? 'enabled' : ''}`}
                      >
                        <input
                          type="radio"
                          name="wf-source-sheet"
                          checked={allEnabled}
                          onChange={() => selectGroup(groupName)}
                        />
                        <span className="wf-lib-name" style={{ fontWeight: 600 }}>
                          📂 {groupName}
                        </span>
                        <span className="wf-lib-count">{libs.length}库 · {totalVals}条</span>
                      </label>
                    );
                  })
                )}
              </div>
            );
          })()}
        </div>

        {/* 已启用的库简览 — 可展开查看内容 */}
        {enabledCount > 0 && (
          <div>
            <div className="wf-node-label">已启用的库</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '4px' }}>
              {config.libraries
                .filter(lib => lib.enabled && lib.values.length > 0)
                .map(lib => (
                  <div
                    key={lib.id}
                    style={{
                      padding: '4px 8px',
                      borderRadius: '6px',
                      background: `${lib.color}10`,
                      border: `1px solid ${lib.color}30`,
                      fontSize: '10px',
                      cursor: 'pointer',
                    }}
                    title={`${lib.name}: ${lib.values.slice(0, 10).join(', ')}${lib.values.length > 10 ? '...' : ''}`}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <span style={{ color: lib.color, fontWeight: 600 }}>{lib.name}</span>
                      <span style={{ color: '#64748b' }}>{lib.values.length} 条</span>
                    </div>
                    <div style={{
                      color: '#94a3b8', marginTop: '2px',
                      overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                    }}>
                      {lib.values.slice(0, 5).join(' · ')}
                      {lib.values.length > 5 && ' ...'}
                    </div>
                  </div>
                ))}
            </div>
          </div>
        )}

        {/* 快速粘贴/输入创建库 */}
        <div>
          <button
            className="wf-node-btn wf-node-btn-secondary"
            onClick={() => updateNodeData?.(nodeId, { showPasteInput: !(data as any).showPasteInput })}
            style={{ width: '100%' }}
          >
            📋 {(data as any).showPasteInput ? '收起输入区' : '粘贴创建库'}
          </button>
          {(data as any).showPasteInput && (
            <div style={{ marginTop: '6px' }}>
              <WfTextarea
                placeholder={"格式说明：\n第1行 = 库名\n后续行 = 每行一个词条\n\n或者用 Tab 分隔列"}
                rows={4}
                value={(data as any).pasteInputText || ''}
                onChangeContent={val => updateNodeData?.(nodeId, { pasteInputText: val })}
                onKeyDown={e => e.stopPropagation()}
                onWheelCapture={e => e.stopPropagation()}
                style={{
                  width: '100%', resize: 'vertical', fontSize: '11px',
                  background: 'rgba(255,255,255,0.03)', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '6px', padding: '6px 8px', color: '#e2e8f0',
                  fontFamily: 'monospace', minHeight: '60px',
                }}
              />
              <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                <button
                  className="wf-node-btn wf-node-btn-primary"
                  style={{ flex: 1, fontSize: '10px' }}
                  onClick={() => {
                    const text = ((data as any).pasteInputText || '').trim();
                    if (!text) { showNodeToast('请先输入内容'); return; }
                    const lines = text.split('\n').map((l: string) => l.trim()).filter((l: string) => l);
                    if (lines.length === 0) { showNodeToast('没有有效内容'); return; }

                    let libName = '粘贴库';
                    let values: string[] = [];

                    if (lines[0].includes('\t')) {
                      const parts = lines[0].split('\t').map((s: string) => s.trim()).filter((s: string) => s);
                      libName = parts[0] || '粘贴库';
                      lines.forEach((line: string) => {
                        const cols = line.split('\t').map((s: string) => s.trim()).filter((s: string) => s);
                        cols.slice(1).forEach((v: string) => { if (v) values.push(v); });
                      });
                      if (values.length === 0) {
                        values = lines.map((l: string) => l.split('\t')[0].trim()).filter((v: string) => v);
                        libName = `粘贴库-${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
                      }
                    } else {
                      if (lines.length > 1 && lines[0].length <= 20) {
                        libName = lines[0];
                        values = lines.slice(1);
                      } else {
                        libName = `粘贴库-${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
                        values = lines;
                      }
                    }

                    values = [...new Set(values)];
                    if (values.length === 0) { showNodeToast('没有解析到有效值'); return; }

                    const colors = ['#f43f5e', '#8b5cf6', '#06b6d4', '#22c55e', '#f59e0b', '#ec4899', '#6366f1', '#14b8a6'];
                    const color = colors[Math.floor(Math.random() * colors.length)];
                    const newLib = {
                      id: `lib-paste-${Date.now()}`,
                      name: libName, values, color,
                      enabled: true, pickMode: 'random-one' as const, pickCount: 1,
                      createdAt: Date.now(), updatedAt: Date.now(),
                    };
                    setConfig(prev => ({ ...prev, libraries: [...prev.libraries, newLib] }));
                    updateNodeData?.(nodeId, { pasteInputText: '', showPasteInput: false });
                    showNodeToast(`✅ 已创建「${libName}」${values.length} 条`);
                  }}
                >✅ 创建库</button>
                <button
                  className="wf-node-btn wf-node-btn-secondary"
                  style={{ fontSize: '10px' }}
                  onClick={async () => {
                    try {
                      const t = await navigator.clipboard.readText();
                      updateNodeData?.(nodeId, { pasteInputText: t });
                    } catch { showNodeToast('⚠️ 无法读取剪贴板'); }
                  }}
                >📋 粘贴</button>
              </div>
            </div>
          )}
        </div>

        {/* 预览区 */}
        <button
          className="wf-node-btn wf-node-btn-secondary"
          onClick={handlePreview}
          style={{ width: '100%' }}
        >
          🔄 重新抽取预览
        </button>

        {previewCombination && (
          <div className="wf-random-preview">
            {previewCombination}
          </div>
        )}

        {/* 内联 Toast */}
        {nodeToast && (
          <div style={{
            marginTop: '6px',
            padding: '4px 8px',
            borderRadius: '6px',
            background: 'rgba(99,102,241,0.15)',
            border: '1px solid rgba(99,102,241,0.25)',
            color: '#a5b4fc',
            fontSize: '10px',
            textAlign: 'center',
            animation: 'wf-toast-in 0.2s ease-out',
          }}>
            {nodeToast}
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

      {/* 随机库管理器弹窗 — 用 Portal 渲染到 body 防止被节点容器裁剪 */}
      {showManager && createPortal(
        <div
          className="wf-manager-overlay"
          onClick={(e) => {
            if (e.target === e.currentTarget) setShowManager(false);
          }}
        >
          <div
            className="wf-manager-container"
            onClick={(e) => e.stopPropagation()}
          >
            <RandomLibraryManager
              config={config}
              onChange={handleConfigChange}
              onClose={() => setShowManager(false)}
              workMode="quick"
            />
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default RandomLibraryNode;
