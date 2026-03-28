/**
 * 输出节点 v2 — 表格视图
 * 直接以表格形式展示结果，支持：
 * - 固定列：原始输入图（支持多图，复制时转为 =IMAGE() 公式）
 * - 动态列：上游每个节点的输出字段自动分列
 * - 列顺序拖拽、列隐藏/显示
 * - 一键复制到 Google Sheets（Tab 分隔，粘贴自动对齐）
 */

import React, { useState, useCallback, useMemo, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Handle, Position, NodeProps, useHandleConnections, useNodesData } from '@xyflow/react';
import NodeHeader from './NodeHeader';

/* ============ 类型定义 ============ */

/** 一列的定义 */
interface ColumnDef {
  id: string;        // 唯一标识，如 'images', 'result-nodeXX', 'field-0'
  label: string;     // 显示名
  type: 'images' | 'text';
  visible: boolean;
}

/** 一行数据 */
interface TableRow {
  id: string;
  /** 原始图片 — data URL 或普通 URL */
  images: string[];
  /** 各列对应的文本值，key = column.id */
  fields: Record<string, string>;
  timestamp: number;
  status: 'success' | 'error';
  error?: string;
}

/* ============ 工具函数 ============ */

/** Gyazo 图床 Token（与 AI 图片识别模块共用） */
const DEFAULT_GYAZO_TOKEN = 'W0SHYCmn38FEoNQEdu7GwT1bOJP84TjQadGjlSgbG6I';

/** 上传图片到 Gyazo 图床（同 AI 图片识别模块） */
const uploadToGyazo = async (file: File, token: string): Promise<string | null> => {
  const formData = new FormData();
  formData.append('access_token', token);
  formData.append('imagedata', file);
  try {
    const res = await fetch('https://upload.gyazo.com/api/upload', { method: 'POST', body: formData });
    if (!res.ok) return null;
    const json = await res.json();
    // 把 https://gyazo.com/ID 转为直链 https://i.gyazo.com/ID.png
    const url = json.url || json.permalink_url || null;
    if (url) {
      const m = url.match(/gyazo\.com\/([a-f0-9]+)/i);
      if (m) return `https://i.gyazo.com/${m[1]}.png`;
    }
    return url;
  } catch { return null; }
};

/** 把 data URL 转为 File 对象 */
function dataUrlToFile(dataUrl: string, filename = 'image.png'): File | null {
  try {
    const [header, base64] = dataUrl.split(',');
    const mime = header.match(/:(.*?);/)?.[1] || 'image/png';
    const bytes = atob(base64);
    const buf = new Uint8Array(bytes.length);
    for (let i = 0; i < bytes.length; i++) buf[i] = bytes.charCodeAt(i);
    return new File([buf], filename, { type: mime });
  } catch { return null; }
}

/** 把图片 URL 包装成 Google Sheets =IMAGE() 公式 */
function toImageFormula(url: string): string {
  if (url.startsWith('data:')) return '[本地图片]';
  return `=IMAGE("${url}")`;
}

/** 尝试从文本结果中拆分多列（用 ||| 分隔） */
function splitResultFields(text: string): string[] {
  if (!text) return [''];
  // 如果包含 ||| 分隔符，拆成多列
  if (text.includes('|||')) {
    return text.split('|||').map(s => s.trim());
  }
  return [text];
}

/* ============ 组件 ============ */

const OutputNode: React.FC<NodeProps> = ({ data }) => {
  const { nodeId, updateNodeData, customLabel, customColor, nodeNote } = data as any;

  // 表格行数据
  const [rows, setRows] = useState<TableRow[]>(
    () => (data.tableRows as TableRow[]) || []
  );

  // 列定义（持久化 + 可编辑）
  const [columns, setColumns] = useState<ColumnDef[]>(
    () => (data.tableColumns as ColumnDef[]) || [
      { id: 'images', label: '原始图', type: 'images', visible: true },
      { id: 'result', label: '结果', type: 'text', visible: true },
    ]
  );

  // 列管理弹窗
  const [showColumnConfig, setShowColumnConfig] = useState(false);

  // 从外部同步
  useEffect(() => {
    if (data.tableRows && Array.isArray(data.tableRows)) {
      setRows(data.tableRows as TableRow[]);
    }
  }, [data.tableRows]);

  useEffect(() => {
    if (data.tableColumns && Array.isArray(data.tableColumns)) {
      setColumns(data.tableColumns as ColumnDef[]);
    }
  }, [data.tableColumns]);

  const [copiedCellId, setCopiedCellId] = useState<string | null>(null);
  const [copySheetDone, setCopySheetDone] = useState(false);

  // 获取上游连接数据
  const connections = useHandleConnections({ type: 'target' });
  const connectedNodeIds = connections.map((c) => c.source);
  const connectedNodesData = useNodesData(connectedNodeIds);

  // 自动从上游收集结果，合并到 rows
  const upstreamRows = useMemo(() => {
    const newRows: TableRow[] = [];
    connectedNodesData.forEach((nd: any) => {
      if (!nd?.data) return;
      const result = nd.data.result;
      // 图片来源：优先 _upstreamImages（中间节点转发的），其次 images（输入节点原生）
      const rowImages: string[] = [];
      if (nd.data._upstreamImages && Array.isArray(nd.data._upstreamImages)) {
        rowImages.push(...nd.data._upstreamImages);
      }
      if (nd.data.images && Array.isArray(nd.data.images)) {
        rowImages.push(...nd.data.images);
      }
      const uniqueImages = [...new Set(rowImages)];

      if (result && typeof result === 'string' && result.trim()) {
        const fields = splitResultFields(result);
        const fieldMap: Record<string, string> = {};

        if (fields.length === 1) {
          // 单列结果
          fieldMap['result'] = fields[0];
        } else {
          // 多列：按索引分配列 ID
          fields.forEach((f, i) => {
            fieldMap[`field-${i}`] = f;
          });
        }

        newRows.push({
          id: `upstream-${nd.id}-${Date.now()}`,
          images: uniqueImages,
          fields: fieldMap,
          timestamp: Date.now(),
          status: result.startsWith('[API 错误]') || result.startsWith('[引擎错误]') ? 'error' : 'success',
        });
      }
    });
    return newRows;
  }, [connectedNodesData]);

  // 合并已保存 + 上游实时
  const allRows = useMemo(() => {
    const list = [...rows];
    upstreamRows.forEach((ur) => {
      // 避免重复
      const exists = rows.some(r =>
        Object.values(r.fields).join('') === Object.values(ur.fields).join('')
      );
      if (!exists) list.push(ur);
    });
    return list;
  }, [rows, upstreamRows]);

  const successRows = useMemo(
    () => allRows.filter(r => r.status === 'success'),
    [allRows]
  );

  // 自动检测需要的列数（根据数据中的 field 键）
  const detectedColumns = useMemo(() => {
    const fieldKeys = new Set<string>();
    allRows.forEach(r => {
      Object.keys(r.fields).forEach(k => fieldKeys.add(k));
    });

    // 看是否有多列 field-N 模式
    const hasMultiFields = [...fieldKeys].some(k => k.startsWith('field-'));
    if (hasMultiFields) {
      const maxIndex = [...fieldKeys]
        .filter(k => k.startsWith('field-'))
        .map(k => parseInt(k.split('-')[1], 10))
        .reduce((max, v) => Math.max(max, v), 0);

      const newCols: ColumnDef[] = [
        { id: 'images', label: '原始图', type: 'images', visible: true },
      ];
      for (let i = 0; i <= maxIndex; i++) {
        // 尝试从已有列定义拿自定义名字
        const existing = columns.find(c => c.id === `field-${i}`);
        newCols.push({
          id: `field-${i}`,
          label: existing?.label || `结果${maxIndex > 0 ? ` ${i + 1}` : ''}`,
          type: 'text',
          visible: existing?.visible ?? true,
        });
      }
      return newCols;
    }

    // 单列 result 模式
    const baseCols: ColumnDef[] = [
      { id: 'images', label: '原始图', type: 'images', visible: columns.find(c => c.id === 'images')?.visible ?? true },
      { id: 'result', label: columns.find(c => c.id === 'result')?.label || '结果', type: 'text', visible: columns.find(c => c.id === 'result')?.visible ?? true },
    ];
    return baseCols;
  }, [allRows, columns]);

  // 有效列 = 用户定义 merged with detected
  const effectiveColumns = useMemo(() => {
    // 用检测到的列为基础，保留用户的 visible/label 设置
    return detectedColumns.map(dc => {
      const userCol = columns.find(c => c.id === dc.id);
      return {
        ...dc,
        label: userCol?.label || dc.label,
        visible: userCol?.visible ?? dc.visible,
      };
    });
  }, [detectedColumns, columns]);

  const visibleColumns = useMemo(
    () => effectiveColumns.filter(c => c.visible),
    [effectiveColumns]
  );

  // 放大查看弹窗
  const [expandModal, setExpandModal] = useState<string | null>(null);

  // 复制单个单元格
  const handleCopyCell = useCallback(async (text: string, cellId: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedCellId(cellId);
      setTimeout(() => setCopiedCellId(null), 2000);
    } catch {}
  }, []);

  // 上传状态
  const [isUploading, setIsUploading] = useState(false);

  // 复制到 Google Sheets 格式（自动上传本地图片到 Gyazo）
  const handleCopyForSheet = useCallback(async () => {
    setIsUploading(true);
    try {
      // 1. 收集所有需要上传的本地图片（去重）
      const localImages = new Set<string>();
      successRows.forEach(row => {
        row.images.forEach((img: string) => {
          if (img.startsWith('data:')) localImages.add(img);
        });
      });

      // 2. 批量上传到 Gyazo
      const uploadCache = new Map<string, string>(); // dataUrl -> gyazoUrl
      if (localImages.size > 0) {
        const uploads = [...localImages].map(async (dataUrl) => {
          const file = dataUrlToFile(dataUrl);
          if (!file) return;
          const gyazoUrl = await uploadToGyazo(file, DEFAULT_GYAZO_TOKEN);
          if (gyazoUrl) uploadCache.set(dataUrl, gyazoUrl);
        });
        await Promise.all(uploads);
      }

      // 3. 构建表格数据
      const headerLine = visibleColumns.map(c => c.label).join('\t');
      const dataLines = successRows.map(row => {
        return visibleColumns.map(col => {
          if (col.type === 'images') {
            return row.images.length > 0
              ? row.images.map((img: string) => {
                  // 优先使用上传后的 Gyazo URL
                  const uploaded = uploadCache.get(img);
                  if (uploaded) return `=IMAGE("${uploaded}")`;
                  return toImageFormula(img);
                }).join(' | ')
              : '';
          }
          const val = row.fields[col.id] || '';
          return val.replace(/[\r\n]+/g, ' ').trim();
        }).join('\t');
      });

      const sheetText = [headerLine, ...dataLines].join('\n');
      await navigator.clipboard.writeText(sheetText);
      setCopySheetDone(true);
      setTimeout(() => setCopySheetDone(false), 2000);
    } catch (err) {
      console.error('[OutputNode] Copy to sheet failed:', err);
    } finally {
      setIsUploading(false);
    }
  }, [visibleColumns, successRows]);

  // 仅复制结果列（不含图片和表头）
  const handleCopyResultsOnly = useCallback(async () => {
    const textCols = visibleColumns.filter(c => c.type === 'text');
    const lines = successRows.map(row => {
      return textCols.map(col => {
        const val = row.fields[col.id] || '';
        return val.replace(/[\r\n]+/g, ' ').trim();
      }).join('\t');
    });
    try {
      await navigator.clipboard.writeText(lines.join('\n'));
      setCopiedCellId('results-only');
      setTimeout(() => setCopiedCellId(null), 2000);
    } catch {}
  }, [visibleColumns, successRows]);

  // 清空
  const handleClear = useCallback(() => {
    setRows([]);
    updateNodeData?.(nodeId, { tableRows: [], entries: [] });
  }, [nodeId, updateNodeData]);

  // 列重命名
  const handleRenameColumn = useCallback((colId: string, newLabel: string) => {
    setColumns(prev => {
      const updated = prev.map(c => c.id === colId ? { ...c, label: newLabel } : c);
      // 也确保新列被加入
      if (!updated.find(c => c.id === colId)) {
        const detected = effectiveColumns.find(c => c.id === colId);
        if (detected) updated.push({ ...detected, label: newLabel });
      }
      updateNodeData?.(nodeId, { tableColumns: updated });
      return updated;
    });
  }, [nodeId, updateNodeData, effectiveColumns]);

  // 列显示/隐藏
  const handleToggleColumn = useCallback((colId: string) => {
    setColumns(prev => {
      const updated = effectiveColumns.map(c =>
        c.id === colId ? { ...c, visible: !c.visible } : c
      );
      updateNodeData?.(nodeId, { tableColumns: updated });
      return updated;
    });
  }, [nodeId, updateNodeData, effectiveColumns]);

  // 阻止滚轮冒泡
  const stopWheel = useCallback((e: React.WheelEvent) => {
    e.stopPropagation();
  }, []);

  // 空状态
  if (allRows.length === 0) {
    return (
      <div className="wf-node output-node output-table-node" style={customColor ? { borderColor: `${customColor}66`, borderLeftColor: customColor } : undefined}>
        <NodeHeader
          icon="📊" defaultLabel="输出表格" customLabel={customLabel} customColor={customColor}
          nodeId={nodeId} updateNodeData={updateNodeData} nodeNote={nodeNote}
        />
        <div className="wf-node-body">
          <div className="wf-output-empty">
            <div style={{ fontSize: '28px', marginBottom: '6px' }}>📊</div>
            <div><strong>等待运行结果</strong></div>
            <div style={{ fontSize: '10px', color: '#64748b', marginTop: '4px' }}>
              连接上游节点后运行工作流，结果将以表格形式展示
            </div>
            <div style={{ fontSize: '10px', color: '#475569', marginTop: '6px' }}>
              ✦ 支持动态分列 · 图片公式 · 一键复制到 Google Sheets
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
    <div
      className="wf-node output-node output-table-node"
      style={{
        ...(customColor ? { borderColor: `${customColor}66`, borderLeftColor: customColor } : {}),
        minWidth: '360px',
        maxWidth: '600px',
      }}
    >
      <NodeHeader
        icon="📊" defaultLabel="输出表格" customLabel={customLabel} customColor={customColor}
        nodeId={nodeId} updateNodeData={updateNodeData} nodeNote={nodeNote}
        trailing={
          <span style={{ fontSize: '10px', color: '#22c55e' }}>
            {successRows.length} 行 · {visibleColumns.length} 列
          </span>
        }
      />
      <div className="wf-node-body">
        {/* 操作按钮区 */}
        <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
          <button
            className="wf-node-btn wf-node-btn-primary"
            onClick={handleCopyForSheet}
            disabled={isUploading}
            style={{ flex: 1, fontSize: '10px', padding: '4px 8px', minWidth: '90px' }}
            title="复制完整表格（含表头），本地图片自动上传到 Gyazo 图床，粘贴到 Google Sheets 自动对齐列"
          >
            {isUploading ? '⏳ 上传图片中...' : copySheetDone ? '✅ 已复制（图片复制为 =IMAGE()）' : '📊 复制到表格'}
          </button>
          <button
            className="wf-node-btn wf-node-btn-secondary"
            onClick={handleCopyResultsOnly}
            style={{ fontSize: '10px', padding: '4px 8px' }}
            title="仅复制结果文本列（不含图片和表头）"
          >
            {copiedCellId === 'results-only' ? '✅' : '📋'} 仅结果
          </button>
          <button
            className="wf-node-btn wf-node-btn-secondary"
            onClick={() => {
              const texts = successRows.map(r =>
                Object.values(r.fields).filter(Boolean).join(' ')
              ).filter(Boolean);
              if (texts.length === 0) return;
              window.postMessage({
                type: 'TOOLKIT_BRIDGE',
                action: 'fillPrompt',
                platform: 'flow',
                prompt: texts[0],
                autoGenerate: true,
                requestId: Date.now().toString()
              }, '*');
              setCopiedCellId('flow-sent');
              setTimeout(() => setCopiedCellId(null), 2000);
            }}
            style={{ fontSize: '10px', padding: '4px 8px' }}
            title="将第一条结果发送到 Flow 网站（需安装桥接插件）"
          >
            {copiedCellId === 'flow-sent' ? '✅ 已发送' : '🌐 Flow'}
          </button>
          <button
            className="wf-node-btn"
            onClick={() => setShowColumnConfig(!showColumnConfig)}
            style={{ fontSize: '10px', padding: '4px 8px', background: 'rgba(99,102,241,0.1)', color: '#a5b4fc', border: '1px solid rgba(99,102,241,0.2)' }}
            title="列管理"
          >
            ⚙ 列
          </button>
          <button
            className="wf-node-btn wf-node-btn-danger"
            onClick={handleClear}
            title="清空所有数据"
            style={{ padding: '4px 8px', fontSize: '10px' }}
          >
            🗑
          </button>
        </div>

        {/* 列管理面板 */}
        {showColumnConfig && (
          <div className="wf-output-col-config">
            <div style={{ fontSize: '10px', color: '#94a3b8', marginBottom: '6px', fontWeight: 600 }}>
              列管理 — 点击切换显隐，双击重命名
            </div>
            {effectiveColumns.map(col => (
              <div key={col.id} className="wf-output-col-item">
                <button
                  className={`wf-output-col-toggle ${col.visible ? 'on' : 'off'}`}
                  onClick={() => handleToggleColumn(col.id)}
                />
                <span
                  className="wf-output-col-label"
                  style={{ opacity: col.visible ? 1 : 0.4 }}
                  onDoubleClick={() => {
                    const newName = prompt('重命名列:', col.label);
                    if (newName?.trim()) handleRenameColumn(col.id, newName.trim());
                  }}
                >
                  {col.type === 'images' ? '🖼' : '📝'} {col.label}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 表格 */}
        <div
          className="wf-output-table-wrap"
          onWheelCapture={stopWheel}
        >
          <table className="wf-output-table">
            <thead>
              <tr>
                <th className="wf-ot-num">#</th>
                {visibleColumns.map(col => (
                  <th
                    key={col.id}
                    className={col.type === 'images' ? 'wf-ot-img-col' : 'wf-ot-text-col'}
                    onDoubleClick={() => {
                      const newName = prompt('重命名列:', col.label);
                      if (newName?.trim()) handleRenameColumn(col.id, newName.trim());
                    }}
                    title="双击重命名"
                  >
                    {col.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {allRows.map((row, idx) => (
                <tr
                  key={row.id}
                  className={row.status === 'error' ? 'wf-ot-row-error' : ''}
                >
                  <td className="wf-ot-num">
                    <span className={`wf-ot-status ${row.status}`}>
                      {row.status === 'error' ? '❌' : '✅'}
                    </span>
                    {idx + 1}
                  </td>
                  {visibleColumns.map(col => (
                    <td key={col.id}>
                      {col.type === 'images' ? (
                        <div className="wf-ot-images">
                          {row.images.length > 0 ? (
                            row.images.map((img, imgIdx) => (
                              <img
                                key={imgIdx}
                                src={img}
                                alt=""
                                className="wf-ot-thumb"
                                onDoubleClick={() => setExpandModal(img)}
                                title="双击放大"
                              />
                            ))
                          ) : (
                            <span className="wf-ot-no-img">—</span>
                          )}
                        </div>
                      ) : (
                        <div
                          className="wf-ot-cell-text"
                          onDoubleClick={() => setExpandModal(row.fields[col.id] || '')}
                          title="双击放大 · 点击复制"
                          onClick={() => handleCopyCell(row.fields[col.id] || '', `${row.id}-${col.id}`)}
                        >
                          {row.status === 'error' ? (
                            <span style={{ color: '#f87171' }}>{row.error || row.fields[col.id]}</span>
                          ) : (
                            row.fields[col.id] || '—'
                          )}
                          {copiedCellId === `${row.id}-${col.id}` && (
                            <span className="wf-ot-copied-badge">✓</span>
                          )}
                        </div>
                      )}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 底部提示 */}
        <div style={{ fontSize: '9px', color: '#475569', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <span>点击单元格复制 · 双击放大 · 图片复制为 =IMAGE()</span>
          <span style={{ color: '#94a3b8' }}>
            {new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}
          </span>
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

      {/* 放大查看弹窗 */}
      {expandModal && createPortal(
        <div
          className="wf-manager-overlay"
          onClick={() => setExpandModal(null)}
          style={{ zIndex: 999999 }}
        >
          <div
            className="wf-manager-container"
            onClick={e => e.stopPropagation()}
            style={{
              background: '#1a1a2e', padding: '20px', borderRadius: '12px',
              width: '80%', maxWidth: '800px', maxHeight: '85vh',
              display: 'flex', flexDirection: 'column',
            }}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '10px', alignItems: 'center' }}>
              <h3 style={{ margin: 0, color: '#f1f5f9' }}>📊 查看内容</h3>
              <div style={{ display: 'flex', gap: '6px' }}>
                <button
                  className="wf-node-btn wf-node-btn-primary"
                  onClick={() => {
                    navigator.clipboard.writeText(expandModal);
                    setExpandModal(null);
                  }}
                  style={{ padding: '2px 8px', fontSize: '11px' }}
                >📋 复制</button>
                <button
                  onClick={() => setExpandModal(null)}
                  style={{ background: 'transparent', border: 'none', color: '#94a3b8', cursor: 'pointer', fontSize: '16px' }}
                >✕</button>
              </div>
            </div>
            {expandModal.startsWith('data:image') || expandModal.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
              <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', overflow: 'auto' }}>
                <img src={expandModal} alt="" style={{ maxWidth: '100%', maxHeight: '100%', borderRadius: '8px' }} />
              </div>
            ) : (
              <textarea
                value={expandModal}
                readOnly
                onKeyDown={e => e.stopPropagation()}
                style={{
                  flex: 1, width: '100%', background: '#0f0f1a', color: '#e2e8f0',
                  padding: '12px', border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: '8px', fontSize: '13px', lineHeight: 1.6,
                  resize: 'none', outline: 'none',
                }}
              />
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default OutputNode;
