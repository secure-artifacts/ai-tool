/**
 * 覆盖节点 — 完整复刻快捷模式的覆盖层设置
 * 支持 3 种覆盖模式：手动文字、参考图提取、逐图提取
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { Handle, Position, NodeProps, useHandleConnections, useNodesData } from '@xyflow/react';
import NodeHeader from './NodeHeader';
import {
  OverrideEntry,
  getDefaultExtractPrompt,
  RandomLibrary,
} from '../../ai-image-recognition/services/randomLibraryService';

// 参考图类型
interface RefImage {
  id: string;
  data: string;      // base64
  mimeType: string;
}

const OverrideNode: React.FC<NodeProps> = ({ id, data }) => {
  const { nodeId, updateNodeData, customLabel, customColor, nodeNote } = data as any;

  // 使用响应式 hooks 获取上游连接和数据
  const connections = useHandleConnections({ type: 'target' });
  const connectedNodeIds = connections.map((c) => c.source);
  const connectedNodesData = useNodesData(connectedNodeIds);

  // 所有覆盖配置：维度名 → OverrideEntry
  const [overrides, setOverrides] = useState<Record<string, OverrideEntry>>(() => {
    return (data.overrides as Record<string, OverrideEntry>) || {};
  });

  // 当前正在编辑的维度
  const [editingDim, setEditingDim] = useState<string | null>(null);

  // 同步覆盖数据到节点
  useEffect(() => {
    updateNodeData?.(nodeId, { overrides });
  }, [overrides, nodeId, updateNodeData]);

  // 响应式获取上游随机库的维度列表
  const { hasRandomConnection, upstreamLibraries: _upstreamLibs, upstreamRandomConfig } = useMemo(() => {
    let hasRandomConnection = false;
    const libs: RandomLibrary[] = [];
    let upstreamRandomConfig: any = null;

    for (const nd of connectedNodesData) {
      if (!nd) continue;
      // 检查节点类型
      if ((nd as any).type === 'randomLibrary') {
        hasRandomConnection = true;
        const config = (nd.data as any)?.randomLibraryConfig;
        upstreamRandomConfig = config;
        if (config?.libraries) {
          libs.push(
            ...config.libraries.filter(
              (lib: RandomLibrary) => lib.enabled && lib.values.length > 0
            )
          );
        }
      }
    }
    return { hasRandomConnection, upstreamLibraries: libs, upstreamRandomConfig };
  }, [connectedNodesData]);

  // 透传上游随机库的 config 到自身 data（让下游节点能读取）
  React.useEffect(() => {
    if (upstreamRandomConfig) {
      const current = (data as any)?.randomLibraryConfig;
      // 只在变化时更新，避免无限循环
      if (JSON.stringify(current) !== JSON.stringify(upstreamRandomConfig)) {
        updateNodeData?.(nodeId, { randomLibraryConfig: upstreamRandomConfig });
      }
    }
  }, [upstreamRandomConfig, nodeId, updateNodeData]);

  const upstreamLibraries = _upstreamLibs;

  // 获取覆盖项计数
  const activeCount = Object.values(overrides).filter(
    (v) => v.value?.trim() || v.mode === 'queue-image'
  ).length;

  // 添加参考图到覆盖库
  const addImageToLibrary = useCallback(
    (dimName: string, base64: string, mimeType: string) => {
      const newImg: RefImage = {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        data: base64,
        mimeType,
      };
      setOverrides((prev) => {
        const entry = prev[dimName] || {
          value: '',
          count: 0,
          mode: 'image' as const,
        };
        const newLibrary = [...(entry.imageLibrary || []), newImg];
        return {
          ...prev,
          [dimName]: {
            ...entry,
            mode: 'image' as const,
            imageLibrary: newLibrary,
            imageData: newLibrary[0]?.data,
            imageMimeType: newLibrary[0]?.mimeType,
            extractPrompt:
              entry.extractPrompt || getDefaultExtractPrompt(dimName),
          },
        };
      });
    },
    []
  );

  // 从库中移除参考图
  const removeFromLibrary = useCallback(
    (dimName: string, refId: string) => {
      setOverrides((prev) => {
        const entry = prev[dimName];
        if (!entry) return prev;
        const newLibrary = (entry.imageLibrary || []).filter(
          (img) => img.id !== refId
        );
        return {
          ...prev,
          [dimName]: {
            ...entry,
            imageLibrary: newLibrary,
            imageData: newLibrary[0]?.data || '',
            imageMimeType: newLibrary[0]?.mimeType || '',
          },
        };
      });
    },
    []
  );

  // 处理文件上传
  const handleFileUpload = useCallback(
    (dimName: string) => {
      const input = document.createElement('input');
      input.type = 'file';
      input.accept = 'image/*';
      input.multiple = true;
      input.onchange = (e) => {
        const files = (e.target as HTMLInputElement).files;
        if (!files) return;
        Array.from(files).forEach((file) => {
          const reader = new FileReader();
          reader.onload = () => {
            const base64 = (reader.result as string).split(',')[1];
            addImageToLibrary(dimName, base64, file.type);
          };
          reader.readAsDataURL(file);
        });
      };
      input.click();
    },
    [addImageToLibrary]
  );

  // ---- 状态 1：未连接随机库节点 ----
  if (!hasRandomConnection) {
    return (
      <div className="wf-node override-node" style={customColor ? { borderColor: `${customColor}66`, borderLeftColor: customColor } : undefined}>
        <NodeHeader
          icon="🎯" defaultLabel="维度覆盖" customLabel={customLabel} customColor={customColor}
          nodeId={nodeId} updateNodeData={updateNodeData} nodeNote={nodeNote}
        />
        <div className="wf-node-body">
          <div className="wf-connection-hint">
            <div className="wf-connection-hint-icon">🔗</div>
            <div className="wf-connection-hint-text">
              <strong>需要连接随机库</strong>
              <br />
              从「🎲 随机库」节点的 <strong>右侧圆点</strong> 拖线到此节点的{' '}
              <strong>左侧圆点</strong>
            </div>
          </div>
          <div className="wf-override-explainer">
            <div className="wf-override-explainer-title">这个节点的作用：</div>
            <div className="wf-override-explainer-item">✏️ <strong>手动覆盖</strong> — 指定某个维度用固定值替换随机结果</div>
            <div className="wf-override-explainer-item">📷 <strong>参考图覆盖</strong> — 上传图片，AI提取描述来覆盖</div>
            <div className="wf-override-explainer-item">🔄 <strong>逐图提取</strong> — 批量处理时从每张图自动提取</div>
          </div>
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
  }

  // ---- 状态 2：已连接但上游库为空 ----
  if (upstreamLibraries.length === 0) {
    return (
      <div className="wf-node override-node" style={customColor ? { borderColor: `${customColor}66`, borderLeftColor: customColor } : undefined}>
        <NodeHeader
          icon="🎯" defaultLabel="维度覆盖" customLabel={customLabel} customColor={customColor}
          nodeId={nodeId} updateNodeData={updateNodeData} nodeNote={nodeNote}
          trailing={
            <span style={{ fontSize: '10px', color: '#22c55e' }}>✓ 已连接</span>
          }
        />
        <div className="wf-node-body">
          <div className="wf-override-waiting">
            <div style={{ fontSize: '20px', marginBottom: '4px' }}>⏳</div>
            <div><strong>等待上游随机库配置</strong></div>
            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
              请先在「🎲 随机库」节点中点击「打开随机库设置」，启用并配置至少一个库。
              <br /><br />
              配好后这里会自动出现维度列表，你可以对每个维度设置覆盖。
            </div>
          </div>
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
  }

  return (
    <div className="wf-node override-node" style={customColor ? { borderColor: `${customColor}66`, borderLeftColor: customColor } : undefined}>
      <NodeHeader
        icon="🎯" defaultLabel="维度覆盖" customLabel={customLabel} customColor={customColor}
        nodeId={nodeId} updateNodeData={updateNodeData} nodeNote={nodeNote}
        trailing={activeCount > 0 ? (
          <span style={{ fontSize: '10px', color: '#fbbf24' }}>{activeCount} 项覆盖</span>
        ) : undefined}
      />
      <div className="wf-node-body">
        {/* 全局操作 */}
        {activeCount > 0 && (
          <button
            className="wf-node-btn wf-node-btn-danger"
            onClick={() => setOverrides({})}
            style={{ width: '100%', marginBottom: '6px' }}
          >
            🗑 清除所有覆盖 ({activeCount}项)
          </button>
        )}

        {/* 维度列表 */}
        <div className="wf-override-dims">
          {upstreamLibraries.map((lib) => {
            const override = overrides[lib.name];
            const mode = override?.mode || 'text';
            const hasOverride =
              !!(override?.value?.trim()) || mode === 'queue-image';
            const isEditing = editingDim === lib.name;
            const overrideCount = override?.count || 0;
            const library = override?.imageLibrary || [];

            return (
              <div key={lib.id} className="wf-override-dim-item">
                {/* 维度标签 */}
                <div className="wf-override-dim-header">
                  <button
                    className={`wf-override-dim-tag ${hasOverride ? 'active' : ''} ${mode === 'queue-image' ? 'queue' : ''}`}
                    style={{
                      borderColor: hasOverride
                        ? mode === 'queue-image'
                          ? '#3b82f640'
                          : '#f59e0b40'
                        : `${lib.color}30`,
                      background: hasOverride
                        ? mode === 'queue-image'
                          ? '#1e3a5f30'
                          : '#78350f30'
                        : `${lib.color}10`,
                      color: hasOverride
                        ? mode === 'queue-image'
                          ? '#93c5fd'
                          : '#fcd34d'
                        : lib.color,
                    }}
                    onClick={() =>
                      setEditingDim(isEditing ? null : lib.name)
                    }
                  >
                    {/* 参考图缩略图 */}
                    {mode === 'image' && override?.imageData && (
                      <img
                        src={`data:${override.imageMimeType || 'image/jpeg'};base64,${override.imageData}`}
                        alt=""
                        className="wf-override-thumb"
                      />
                    )}
                    {mode === 'image' && !override?.imageData && '📷 '}
                    {mode === 'queue-image' && '🔄 '}
                    {lib.name}
                    {hasOverride && override?.value?.trim() && mode !== 'queue-image' && (
                      <span className="wf-override-preview-text">
                        {override.value.length > 6
                          ? override.value.slice(0, 6) + '…'
                          : override.value}
                      </span>
                    )}
                    {hasOverride && overrideCount > 0 && (
                      <span className="wf-override-count">×{overrideCount}</span>
                    )}
                  </button>

                  {/* 快速清除 */}
                  {hasOverride && !isEditing && (
                    <button
                      className="wf-override-clear-btn"
                      onClick={(e) => {
                        e.stopPropagation();
                        setOverrides((prev) => {
                          const next = { ...prev };
                          delete next[lib.name];
                          return next;
                        });
                      }}
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* 展开的编辑面板 */}
                {isEditing && (
                  <div className="wf-override-edit-panel">
                    {/* 模式切换 */}
                    <div className="wf-override-mode-tabs">
                      {(['text', 'image', 'queue-image'] as const).map((m) => (
                        <button
                          key={m}
                          onClick={() =>
                            setOverrides((prev) => ({
                              ...prev,
                              [lib.name]: {
                                ...prev[lib.name],
                                value: prev[lib.name]?.value || '',
                                count: prev[lib.name]?.count || 0,
                                mode: m,
                                extractPrompt:
                                  prev[lib.name]?.extractPrompt ||
                                  getDefaultExtractPrompt(lib.name),
                              },
                            }))
                          }
                          className={`wf-override-mode-tab ${mode === m ? 'active' : ''}`}
                        >
                          {m === 'text'
                            ? '✏️手动'
                            : m === 'image'
                              ? '📷参考图'
                              : '🔄逐图提取'}
                        </button>
                      ))}
                    </div>

                    {/* 手动文字模式 */}
                    {mode === 'text' && (
                      <div className="wf-override-text-input">
                        <input
                          type="text"
                          autoFocus
                          value={override?.value || ''}
                          onChange={(e) =>
                            setOverrides((prev) => ({
                              ...prev,
                              [lib.name]: {
                                ...prev[lib.name],
                                value: e.target.value,
                                count: prev[lib.name]?.count || 0,
                              },
                            }))
                          }
                          onKeyDown={(e) => {
                            e.stopPropagation();
                            if (e.key === 'Enter') setEditingDim(null);
                          }}
                          placeholder={`输入${lib.name}固定值...`}
                          className="wf-override-input"
                        />
                      </div>
                    )}

                    {/* 参考图模式 */}
                    {mode === 'image' && (
                      <div className="wf-override-image-section">
                        <div className="wf-override-field-label">提取要求：</div>
                        <input
                          type="text"
                          value={
                            override?.extractPrompt ||
                            getDefaultExtractPrompt(lib.name)
                          }
                          onChange={(e) =>
                            setOverrides((prev) => ({
                              ...prev,
                              [lib.name]: {
                                ...prev[lib.name],
                                value: prev[lib.name]?.value || '',
                                count: prev[lib.name]?.count || 0,
                                mode: 'image',
                                extractPrompt: e.target.value,
                              },
                            }))
                          }
                          className="wf-override-input"
                          onKeyDown={e => e.stopPropagation()}
                        />

                        {/* 参考图库 */}
                        {library.length > 0 && (
                          <div className="wf-override-ref-gallery">
                            {library.map((img, idx) => (
                              <div key={img.id} className="wf-override-ref-item">
                                <img
                                  src={`data:${img.mimeType};base64,${img.data}`}
                                  alt={`参考${idx + 1}`}
                                  className="wf-override-ref-thumb"
                                />
                                <span className="wf-override-ref-idx">
                                  {idx + 1}
                                </span>
                                <button
                                  className="wf-override-ref-remove"
                                  onClick={() =>
                                    removeFromLibrary(lib.name, img.id)
                                  }
                                >
                                  ×
                                </button>
                              </div>
                            ))}
                          </div>
                        )}

                        {/* 上传按钮 */}
                        <div
                          className="wf-override-upload-zone"
                          onClick={() => handleFileUpload(lib.name)}
                          onPaste={(e) => {
                            const items = e.clipboardData.items;
                            for (const item of items) {
                              if (item.type.startsWith('image/')) {
                                const file = item.getAsFile();
                                if (!file) continue;
                                const reader = new FileReader();
                                reader.onload = () => {
                                  const base64 = (
                                    reader.result as string
                                  ).split(',')[1];
                                  addImageToLibrary(
                                    lib.name,
                                    base64,
                                    file.type
                                  );
                                };
                                reader.readAsDataURL(file);
                                e.preventDefault();
                                break;
                              }
                            }
                          }}
                          tabIndex={0}
                        >
                          {library.length > 0
                            ? '➕ 继续添加参考图'
                            : '点击上传 / Ctrl+V 粘贴参考图'}
                        </div>

                        {library.length > 1 && (
                          <div className="wf-override-hint">
                            📌 已上传{library.length}张参考图
                          </div>
                        )}

                        {/* 提取结果 */}
                        {override?.value && (
                          <div className="wf-override-result">
                            <span className="wf-override-field-label">结果:</span>
                            <input
                              type="text"
                              value={override.value}
                              onChange={(e) =>
                                setOverrides((prev) => ({
                                  ...prev,
                                  [lib.name]: {
                                    ...prev[lib.name],
                                    value: e.target.value,
                                  } as any,
                                }))
                              }
                              className="wf-override-input result"
                              onKeyDown={e => e.stopPropagation()}
                            />
                          </div>
                        )}

                        {/* 批量应用到其他维度 */}
                        {(library.length > 0 || override?.imageData) &&
                          upstreamLibraries.length > 1 && (
                            <div className="wf-override-batch-apply">
                              <div className="wf-override-field-label">
                                📋 同时应用到其他维度：
                              </div>
                              <div className="wf-override-batch-tags">
                                {upstreamLibraries
                                  .filter((otherLib) => otherLib.name !== lib.name)
                                  .map((otherLib) => {
                                    const otherOverride = overrides[otherLib.name];
                                    const isLinked =
                                      otherOverride?.mode === 'image' &&
                                      otherOverride?.imageData ===
                                        override?.imageData;
                                    return (
                                      <button
                                        key={otherLib.id}
                                        onClick={() => {
                                          if (isLinked) {
                                            setOverrides((prev) => {
                                              const next = { ...prev };
                                              delete next[otherLib.name];
                                              return next;
                                            });
                                          } else {
                                            setOverrides((prev) => ({
                                              ...prev,
                                              [otherLib.name]: {
                                                ...prev[otherLib.name],
                                                mode: 'image' as const,
                                                imageData: override?.imageData,
                                                imageMimeType:
                                                  override?.imageMimeType,
                                                imageLibrary: override?.imageLibrary
                                                  ? [...override.imageLibrary]
                                                  : [],
                                                extractPrompt:
                                                  prev[otherLib.name]
                                                    ?.extractPrompt ||
                                                  getDefaultExtractPrompt(
                                                    otherLib.name
                                                  ),
                                                value:
                                                  prev[otherLib.name]?.value || '',
                                                count:
                                                  prev[otherLib.name]?.count || 0,
                                              },
                                            }));
                                          }
                                        }}
                                        className={`wf-override-batch-tag ${isLinked ? 'linked' : ''}`}
                                      >
                                        {isLinked ? '✓ ' : ''}
                                        {otherLib.name}
                                      </button>
                                    );
                                  })}
                              </div>
                            </div>
                          )}
                      </div>
                    )}

                    {/* 逐图提取模式 */}
                    {mode === 'queue-image' && (
                      <div className="wf-override-queue-section">
                        <div className="wf-override-hint" style={{ color: '#93c5fd' }}>
                          🔄 批量时从每张队列图片自动提取此维度
                        </div>
                        <div className="wf-override-field-label">提取要求：</div>
                        <input
                          type="text"
                          value={
                            override?.extractPrompt ||
                            getDefaultExtractPrompt(lib.name)
                          }
                          onChange={(e) =>
                            setOverrides((prev) => ({
                              ...prev,
                              [lib.name]: {
                                ...prev[lib.name],
                                value: '',
                                count: prev[lib.name]?.count || 0,
                                mode: 'queue-image',
                                extractPrompt: e.target.value,
                              },
                            }))
                          }
                          className="wf-override-input queue"
                          onKeyDown={e => e.stopPropagation()}
                        />
                        <div className="wf-override-hint" style={{ color: '#64748b' }}>
                          处理每张图时，AI会先提取该维度描述，再替换到随机组合中
                        </div>
                      </div>
                    )}

                    {/* 覆盖个数 */}
                    <div className="wf-override-count-editor">
                      <span className="wf-override-field-label">覆盖个数:</span>
                      <div className="wf-override-count-control">
                        <button
                          onClick={() =>
                            setOverrides((prev) => ({
                              ...prev,
                              [lib.name]: {
                                ...prev[lib.name],
                                value: prev[lib.name]?.value || '',
                                count: Math.max(
                                  0,
                                  (prev[lib.name]?.count || 0) - 1
                                ),
                              },
                            }))
                          }
                          className="wf-override-count-btn"
                        >
                          -
                        </button>
                        <span className="wf-override-count-value">
                          {overrideCount === 0 ? '全' : overrideCount}
                        </span>
                        <button
                          onClick={() =>
                            setOverrides((prev) => ({
                              ...prev,
                              [lib.name]: {
                                ...prev[lib.name],
                                value: prev[lib.name]?.value || '',
                                count: (prev[lib.name]?.count || 0) + 1,
                              },
                            }))
                          }
                          className="wf-override-count-btn"
                        >
                          +
                        </button>
                      </div>
                    </div>

                    {/* 确定按钮 */}
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '6px' }}>
                      <button
                        className="wf-node-btn wf-node-btn-secondary"
                        onClick={() => setEditingDim(null)}
                      >
                        确定
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
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

export default OverrideNode;
