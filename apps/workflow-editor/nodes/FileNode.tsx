/**
 * 文件节点 — 上传图片或导入纯文本文件
 * 支持拖拽、粘贴、点击选择
 */

import React, { useCallback, useRef, useState } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import NodeHeader from './NodeHeader';
import { WfTextarea } from '../components/WfInputs';

const ACCEPT_TYPES = 'image/*,.txt,.md,.csv,.json,.text,.log';

const FileNode: React.FC<NodeProps> = ({ data }) => {
  const { files = [], text = '', nodeId, updateNodeData, customLabel, customColor, nodeNote } = data as any;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // 处理文件读取
  const processFiles = useCallback(
    (fileList: FileList | File[]) => {
      Array.from(fileList).forEach((file) => {
        if (file.type.startsWith('image/')) {
          // 图片 → base64
          const reader = new FileReader();
          reader.onload = (ev) => {
            const base64 = ev.target?.result as string;
            updateNodeData?.(nodeId, {
              files: [
                ...(files || []),
                { type: 'image', name: file.name, data: base64 },
              ],
            });
          };
          reader.readAsDataURL(file);
        } else {
          // 文本文件 → 读取内容
          const reader = new FileReader();
          reader.onload = (ev) => {
            const content = ev.target?.result as string;
            updateNodeData?.(nodeId, {
              text: ((text || '') + (text ? '\n' : '') + content).trim(),
              files: [
                ...(files || []),
                { type: 'text', name: file.name, data: content },
              ],
            });
          };
          reader.readAsText(file);
        }
      });
    },
    [nodeId, updateNodeData, files, text]
  );

  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) processFiles(e.target.files);
      e.target.value = '';
    },
    [processFiles]
  );

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles]
  );

  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  }, []);

  // 手动文本输入
  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeData?.(nodeId, { text: e.target.value });
    },
    [nodeId, updateNodeData]
  );

  // 移除单个文件
  const handleRemoveFile = useCallback(
    (index: number) => {
      const newFiles = [...(files || [])];
      newFiles.splice(index, 1);
      updateNodeData?.(nodeId, { files: newFiles });
    },
    [nodeId, updateNodeData, files]
  );

  // 清空全部
  const handleClear = useCallback(() => {
    updateNodeData?.(nodeId, { files: [], text: '' });
  }, [nodeId, updateNodeData]);

  const imageFiles = (files || []).filter((f: any) => f.type === 'image');
  const textFiles = (files || []).filter((f: any) => f.type === 'text');

  return (
    <div className="wf-node file-node" style={customColor ? { borderColor: `${customColor}66`, borderLeftColor: customColor } : undefined}>
      <NodeHeader
        icon="📁" defaultLabel="文件节点" customLabel={customLabel} customColor={customColor}
        nodeId={nodeId} updateNodeData={updateNodeData} nodeNote={nodeNote}
        trailing={(files?.length > 0 || text) ? (
          <span
            style={{ cursor: 'pointer', fontSize: '11px', color: '#94a3b8' }}
            onClick={handleClear}
            title="清空全部"
          >✕</span>
        ) : undefined}
      />
      <div className="wf-node-body">
        {/* 拖放区域 */}
        <div
          className={`wf-file-drop-zone ${isDragOver ? 'drag-over' : ''}`}
          onDrop={handleDrop}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onClick={() => fileInputRef.current?.click()}
        >
          <div className="wf-file-drop-icon">{isDragOver ? '📥' : '📂'}</div>
          <div className="wf-file-drop-text">
            拖入文件或点击选择
          </div>
          <div className="wf-file-drop-hint">
            支持图片 / .txt / .md / .csv / .json
          </div>
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept={ACCEPT_TYPES}
          multiple
          style={{ display: 'none' }}
          onChange={handleFileSelect}
        />

        {/* 已上传的图片预览 */}
        {imageFiles.length > 0 && (
          <div>
            <div className="wf-node-label">图片 ({imageFiles.length})</div>
            <div className="wf-image-grid">
              {imageFiles.map((f: any, i: number) => (
                <div key={i} style={{ position: 'relative' }}>
                  <img
                    src={f.data}
                    alt={f.name}
                    className="wf-image-thumb"
                    title={`${f.name}\n点击移除`}
                    onClick={() => handleRemoveFile(files.indexOf(f))}
                  />
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 已导入的文本文件列表 */}
        {textFiles.length > 0 && (
          <div>
            <div className="wf-node-label">文本文件 ({textFiles.length})</div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
              {textFiles.map((f: any, i: number) => (
                <div
                  key={i}
                  className="wf-file-tag"
                  onClick={() => handleRemoveFile(files.indexOf(f))}
                  title="点击移除"
                >
                  📄 {f.name}
                  <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#64748b' }}>✕</span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* 手动文本输入 */}
        <div>
          <div className="wf-node-label">或直接输入文本</div>
          <WfTextarea
            value={text}
            onChangeContent={val => updateNodeData?.(nodeId, { text: val })}
            onKeyDown={e => e.stopPropagation()}
            placeholder="直接粘贴或输入纯文本内容..."
            rows={3}
          />
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

export default FileNode;
