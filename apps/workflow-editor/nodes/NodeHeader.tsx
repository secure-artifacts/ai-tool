/**
 * 通用节点头部 — 集成颜色选择器 + 双击重命名 + 可编辑节点说明
 */

import React, { useState, useRef, useEffect, useCallback } from 'react';
import NodeColorPicker from './NodeColorPicker';

// 默认帮助说明 — 按 defaultLabel 关键字匹配
const NODE_HELP_MAP: Array<{ match: string; help: string }> = [
  { match: '输入', help: '💡 输入节点\n\n用途：输入文本需求或拖入参考图片。\n\n• 文本输入：写下创作需求\n• 图片输入：拖入参考图片\n• 支持直接粘贴图片\n\n输出：传递给下游节点' },
  { match: '文件', help: '💡 文件节点\n\n用途：从本地导入图片或文本文件。\n\n• 支持拖入多张图片\n• 支持 .txt 文本文件\n\n输出：传递给写描述词节点' },
  { match: '随机库', help: '💡 随机库节点\n\n用途：多维度随机词条库，每次运行随机抽取。\n\n• 导入 Google 表格数据\n• 一键切换不同总库\n• 支持配套指令传递\n\n输出：随机词条组合' },
  { match: '覆盖', help: '💡 维度覆盖节点\n\n用途：手动替换某些维度的值。\n\n• 选择要覆盖的维度\n• 输入固定值\n• 其他维度仍随机' },
  { match: '描述词', help: '💡 写描述词节点\n\n用途：汇总上游数据，AI 生成 Prompt。\n\n• 手动输入指令\n• 或从表格读取配套指令\n\n输出：AI 生成的描述词' },
  { match: '输出', help: '💡 输出节点\n\n用途：展示并复制所有结果。\n\n• 📊 复制到表格\n• 📋 单条复制\n• 双击放大查看' },
];

function getDefaultHelp(defaultLabel: string): string {
  for (const item of NODE_HELP_MAP) {
    if (defaultLabel.includes(item.match)) return item.help;
  }
  return '点击编辑，添加节点说明...';
}

interface Props {
  icon: string;
  defaultLabel: string;
  customLabel?: string;
  customColor?: string;
  trailing?: React.ReactNode;
  nodeId: string;
  updateNodeData?: (id: string, data: any) => void;
  nodeNote?: string; // 用户自定义的节点说明（持久化）
}

const NodeHeader: React.FC<Props> = ({
  icon, defaultLabel, customLabel, customColor,
  trailing, nodeId, updateNodeData, nodeNote,
}) => {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');
  const [showNote, setShowNote] = useState(false);
  const [editingNote, setEditingNote] = useState(false);
  const [noteValue, setNoteValue] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLDivElement>(null);
  const noteTextareaRef = useRef<HTMLTextAreaElement>(null);

  const label = customLabel || defaultLabel;
  const defaultHelp = getDefaultHelp(defaultLabel);
  // 显示用户自定义说明，没有则显示默认帮助
  const displayNote = nodeNote || defaultHelp;
  const isCustomNote = !!nodeNote;

  const handleDoubleClick = useCallback(() => {
    setEditValue(label);
    setEditing(true);
  }, [label]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  // 进入编辑笔记时聚焦
  useEffect(() => {
    if (editingNote && noteTextareaRef.current) {
      noteTextareaRef.current.focus();
      // 光标移到末尾
      const len = noteTextareaRef.current.value.length;
      noteTextareaRef.current.setSelectionRange(len, len);
    }
  }, [editingNote]);

  // 点击外部关闭笔记面板
  useEffect(() => {
    if (!showNote) return;
    const handleClick = (e: MouseEvent) => {
      if (noteRef.current && !noteRef.current.contains(e.target as Node)) {
        setShowNote(false);
        setEditingNote(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [showNote]);

  const handleFinish = useCallback(() => {
    setEditing(false);
    const newLabel = editValue.trim();
    if (newLabel && newLabel !== defaultLabel) {
      updateNodeData?.(nodeId, { customLabel: newLabel });
    } else if (!newLabel || newLabel === defaultLabel) {
      updateNodeData?.(nodeId, { customLabel: undefined });
    }
  }, [editValue, defaultLabel, nodeId, updateNodeData]);

  const handleColorChange = useCallback((color: string | null) => {
    updateNodeData?.(nodeId, { customColor: color || undefined });
  }, [nodeId, updateNodeData]);

  // 开始编辑笔记
  const startEditNote = useCallback(() => {
    setNoteValue(nodeNote || '');
    setEditingNote(true);
  }, [nodeNote]);

  // 保存笔记
  const saveNote = useCallback(() => {
    const trimmed = noteValue.trim();
    updateNodeData?.(nodeId, { nodeNote: trimmed || undefined });
    setEditingNote(false);
  }, [noteValue, nodeId, updateNodeData]);

  // 重置为默认
  const resetNote = useCallback(() => {
    updateNodeData?.(nodeId, { nodeNote: undefined });
    setEditingNote(false);
  }, [nodeId, updateNodeData]);

  // 自定义颜色覆盖样式
  const headerStyle: React.CSSProperties = customColor ? {
    background: `linear-gradient(135deg, ${customColor}30, ${customColor}08)`,
    borderBottom: `1px solid ${customColor}25`,
  } : {};

  return (
    <div
      className="wf-node-header"
      style={headerStyle}
      onDoubleClick={handleDoubleClick}
      title="双击重命名"
    >
      <span className="wf-node-icon">{icon}</span>
      {editing ? (
        <input
          ref={inputRef}
          value={editValue}
          onChange={e => setEditValue(e.target.value)}
          onBlur={handleFinish}
          onKeyDown={e => { e.stopPropagation(); if (e.key === 'Enter') handleFinish(); if (e.key === 'Escape') setEditing(false); }}
          style={{
            background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.2)',
            borderRadius: '4px', padding: '2px 6px', fontSize: '13px', fontWeight: 600,
            color: '#f1f5f9', outline: 'none', width: '100%', maxWidth: '140px',
          }}
        />
      ) : (
        <span>{label}</span>
      )}
      {trailing}
      {/* 节点说明按钮 */}
      <div ref={noteRef} style={{ position: 'relative', display: 'inline-flex' }}>
        <button
          onClick={(e) => { e.stopPropagation(); setShowNote(!showNote); if (showNote) setEditingNote(false); }}
          style={{
            background: showNote ? 'rgba(99,102,241,0.3)' : isCustomNote ? 'rgba(250,204,21,0.15)' : 'rgba(255,255,255,0.06)',
            border: `1px solid ${isCustomNote ? 'rgba(250,204,21,0.3)' : 'rgba(255,255,255,0.1)'}`,
            borderRadius: '50%',
            width: '18px', height: '18px',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            cursor: 'pointer', fontSize: '10px',
            color: isCustomNote ? '#fbbf24' : '#94a3b8',
            padding: 0, marginLeft: '2px', flexShrink: 0,
            transition: 'all 0.15s',
          }}
          title={isCustomNote ? '查看/编辑自定义说明' : '查看节点说明'}
        >{isCustomNote ? '📝' : '?'}</button>
        {showNote && (
          <div
            style={{
              position: 'absolute', top: '24px', right: '-8px', zIndex: 9999,
              background: '#1e1e2e', border: '1px solid rgba(99,102,241,0.3)',
              borderRadius: '8px', padding: '10px', width: '280px',
              boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
            }}
            onClick={(e) => e.stopPropagation()}
            onWheelCapture={(e) => e.stopPropagation()}
          >
            {editingNote ? (
              <>
                <textarea
                  ref={noteTextareaRef}
                  value={noteValue}
                  onChange={(e) => setNoteValue(e.target.value)}
                  placeholder="输入你的节点说明..."
                  style={{
                    width: '100%', minHeight: '100px', maxHeight: '200px',
                    background: '#0f0f1a', color: '#e2e8f0',
                    border: '1px solid rgba(99,102,241,0.3)', borderRadius: '6px',
                    padding: '8px', fontSize: '11px', lineHeight: '1.6',
                    resize: 'vertical', outline: 'none', fontFamily: 'inherit',
                  }}
                  onKeyDown={(e) => {
                    e.stopPropagation();
                    if (e.key === 'Escape') { setEditingNote(false); }
                  }}
                />
                <div style={{ display: 'flex', gap: '4px', marginTop: '6px' }}>
                  <button
                    onClick={saveNote}
                    style={{
                      flex: 1, padding: '4px 8px', fontSize: '10px',
                      background: 'rgba(99,102,241,0.2)', border: '1px solid rgba(99,102,241,0.3)',
                      borderRadius: '4px', color: '#a5b4fc', cursor: 'pointer',
                    }}
                  >💾 保存</button>
                  {isCustomNote && (
                    <button
                      onClick={resetNote}
                      style={{
                        padding: '4px 8px', fontSize: '10px',
                        background: 'rgba(239,68,68,0.1)', border: '1px solid rgba(239,68,68,0.2)',
                        borderRadius: '4px', color: '#f87171', cursor: 'pointer',
                      }}
                    >↩ 恢复默认</button>
                  )}
                  <button
                    onClick={() => setEditingNote(false)}
                    style={{
                      padding: '4px 8px', fontSize: '10px',
                      background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.1)',
                      borderRadius: '4px', color: '#94a3b8', cursor: 'pointer',
                    }}
                  >取消</button>
                </div>
              </>
            ) : (
              <>
                <div
                  style={{
                    fontSize: '11px', color: '#cbd5e1', lineHeight: '1.6',
                    whiteSpace: 'pre-wrap', maxHeight: '200px', overflowY: 'auto',
                  }}
                >
                  {displayNote}
                </div>
                <div style={{ display: 'flex', gap: '4px', marginTop: '8px', borderTop: '1px solid rgba(255,255,255,0.06)', paddingTop: '6px' }}>
                  <button
                    onClick={startEditNote}
                    style={{
                      flex: 1, padding: '3px 8px', fontSize: '10px',
                      background: 'rgba(99,102,241,0.15)', border: '1px solid rgba(99,102,241,0.25)',
                      borderRadius: '4px', color: '#a5b4fc', cursor: 'pointer',
                    }}
                  >✏️ 编辑说明</button>
                </div>
              </>
            )}
          </div>
        )}
      </div>
      <NodeColorPicker currentColor={customColor} onColorChange={handleColorChange} />
    </div>
  );
};

export default NodeHeader;
