/**
 * 输入节点 — 支持批量图片添加
 * 功能：
 *  - 点击选择多张图片
 *  - 拖拽图片到节点
 *  - 从剪贴板粘贴图片 (Ctrl+V)
 *  - 缩略图预览 + 单张删除
 *  - 一键清空所有图片
 */

import React, { useCallback, useRef, useState } from 'react';
import { Handle, Position, NodeProps } from '@xyflow/react';
import NodeHeader from './NodeHeader';
import { WfTextarea } from '../components/WfInputs';

const InputNode: React.FC<NodeProps> = ({ data }) => {
  const { text = '', images = [], nodeId, updateNodeData, customLabel, customColor, nodeNote } = data as any;
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [isDragOver, setIsDragOver] = useState(false);

  // 通用图片处理函数
  const processFiles = useCallback(
    (files: FileList | File[]) => {
      const fileArr = Array.from(files).filter(f => f.type.startsWith('image/'));
      if (fileArr.length === 0) return;

      let loaded = 0;
      const newImages: string[] = [];

      fileArr.forEach(file => {
        const reader = new FileReader();
        reader.onload = (ev) => {
          newImages.push(ev.target?.result as string);
          loaded++;
          if (loaded === fileArr.length) {
            updateNodeData?.(nodeId, { images: [...(images || []), ...newImages] });
          }
        };
        reader.readAsDataURL(file);
      });
    },
    [nodeId, updateNodeData, images]
  );

  // 文件选择
  const handleFileSelect = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files) processFiles(e.target.files);
      // 清空 input 以便重复选择同一文件
      e.target.value = '';
    },
    [processFiles]
  );

  // 拖拽
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

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

  // 粘贴
  const handlePaste = useCallback(
    (e: React.ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      const imageFiles: File[] = [];
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.startsWith('image/')) {
          const file = items[i].getAsFile();
          if (file) imageFiles.push(file);
        }
      }
      if (imageFiles.length > 0) {
        e.preventDefault();
        processFiles(imageFiles);
      }
    },
    [processFiles]
  );

  const handleTextChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      updateNodeData?.(nodeId, { text: e.target.value });
    },
    [nodeId, updateNodeData]
  );

  const handleRemoveImage = useCallback(
    (index: number) => {
      const newImages = [...images];
      newImages.splice(index, 1);
      updateNodeData?.(nodeId, { images: newImages });
    },
    [nodeId, updateNodeData, images]
  );

  const handleClearAll = useCallback(() => {
    updateNodeData?.(nodeId, { images: [], imageGroups: [] });
  }, [nodeId, updateNodeData]);

  return (
    <div className="wf-node input-node" onPaste={handlePaste} style={customColor ? { borderColor: `${customColor}66`, borderLeftColor: customColor } : undefined}>
      <NodeHeader
        icon="📝" defaultLabel="输入节点" customLabel={customLabel} customColor={customColor}
        nodeId={nodeId} updateNodeData={updateNodeData} nodeNote={nodeNote}
        trailing={images.length > 0 ? (
          <span style={{ marginLeft: 'auto', fontSize: '10px', color: '#94a3b8' }}>
            {images.length} 张图
          </span>
        ) : undefined}
      />
      <div className="wf-node-body">
        <div>
          <div className="wf-node-label">用户指令 / 基础想法</div>
          <WfTextarea
            value={text}
            onChangeContent={val => updateNodeData?.(nodeId, { text: val })}
            onKeyDown={e => e.stopPropagation()}
            placeholder="输入你的创意想法、角色描述..."
            rows={3}
          />
        </div>

        <div>
          <div className="wf-node-label" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>参考图片（可选）</span>
            {images.length > 0 && (
              <button
                className="wf-node-btn"
                style={{ fontSize: '10px', padding: '1px 6px' }}
                onClick={handleClearAll}
              >
                🗑 清空 ({images.length})
              </button>
            )}
          </div>

          {/* 图片网格 */}
          {images.length > 0 && (
            <div className="wf-image-grid">
              {images.map((img: string, i: number) => (
                <div key={i} className="wf-image-thumb-wrap">
                  <img
                    src={img}
                    alt=""
                    className="wf-image-thumb"
                  />
                  <button
                    className="wf-image-remove-btn"
                    onClick={() => handleRemoveImage(i)}
                    title="移除此图"
                  >
                    ✕
                  </button>
                </div>
              ))}
            </div>
          )}

          {/* 拖拽/点击上传区 */}
          <div
            className={`wf-image-upload-area ${isDragOver ? 'drag-over' : ''}`}
            onClick={() => fileInputRef.current?.click()}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            <div className="wf-upload-icon">📁</div>
            <div>点击选择 / 拖拽图片 / Ctrl+V 粘贴</div>
            <div style={{ fontSize: '10px', color: '#475569' }}>支持批量添加多张</div>
          </div>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            multiple
            style={{ display: 'none' }}
            onChange={handleFileSelect}
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

export default InputNode;
