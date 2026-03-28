/**
 * 节点颜色选择器 — 可嵌入任何节点的头部
 * 点击色块弹出调色板，选择后通过 onColorChange 回调保存到节点 data
 */

import React, { useState, useRef, useEffect } from 'react';

const PRESET_COLORS = [
  '#3b82f6', '#6366f1', '#8b5cf6', '#a855f7',
  '#ec4899', '#f43f5e', '#ef4444', '#f59e0b',
  '#eab308', '#22c55e', '#10b981', '#14b8a6',
  '#06b6d4', '#0ea5e9', '#64748b', '#e2e8f0',
];

interface Props {
  currentColor?: string;
  onColorChange: (color: string | null) => void;
}

const NodeColorPicker: React.FC<Props> = ({ currentColor, onColorChange }) => {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // 点击外部关闭
  useEffect(() => {
    if (!open) return;
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', handleClick);
    return () => document.removeEventListener('mousedown', handleClick);
  }, [open]);

  return (
    <div ref={ref} style={{ position: 'relative', marginLeft: 'auto' }}>
      <div
        className="wf-node-color-dot"
        style={{ background: currentColor || 'rgba(255,255,255,0.15)' }}
        onClick={e => { e.stopPropagation(); setOpen(!open); }}
        title="自定义节点颜色"
      />
      {open && (
        <div className="wf-node-color-picker" onClick={e => e.stopPropagation()}>
          {PRESET_COLORS.map(c => (
            <button
              key={c}
              style={{
                background: c,
                outline: currentColor === c ? '2px solid #fff' : 'none',
                outlineOffset: '1px',
              }}
              onClick={() => { onColorChange(c); setOpen(false); }}
            />
          ))}
          <button
            style={{
              width: '100%', background: 'rgba(255,255,255,0.05)',
              fontSize: '9px', color: '#94a3b8', height: '20px',
            }}
            onClick={() => { onColorChange(null); setOpen(false); }}
          >↩ 恢复默认</button>
        </div>
      )}
    </div>
  );
};

export default NodeColorPicker;
