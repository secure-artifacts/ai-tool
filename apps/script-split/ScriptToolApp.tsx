
import React, { useState, useEffect } from 'react';
import {
  Columns,
  Video,
  WrapText,
  Copy,
  Check,
  Grid3X3,
  Info,
  MousePointer2,
  Languages,
  CheckSquare,
  Hash
} from 'lucide-react';
import {
  processGrid,
  formatForClipboard,
  colToLetter
} from './utils/processor';
import { buildGoogleSheetsHtml, copyToClipboard } from './utils/clipboard';
import { GridData, ToolType, GridSelection, ProcessOptions, GridStyles, cellKey } from './types';
import { Button } from './components/UIComponents';
import { SpreadsheetGrid } from './components/SpreadsheetGrid';

// Default grid size
const DEFAULT_ROWS = 10;
const DEFAULT_COLS = 20;

function ScriptToolApp() {
  const [gridData, setGridData] = useState<GridData>([]);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const [forceSelection, setForceSelection] = useState<GridSelection | null>(null); // 用于外部触发选区
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [clearSource, setClearSource] = useState(false); // 默认保留原文（开关关 = 保留，开关开 = 删除）
  const [gridStyles, setGridStyles] = useState<GridStyles>(new Map()); // 单元格样式（橙色标记）
  const [showPrefixModal, setShowPrefixModal] = useState(false); // 自定义前缀弹窗
  const [customPrefix, setCustomPrefix] = useState('prompt'); // 自定义前缀内容

  // Initialize empty grid
  useEffect(() => {
    setGridData(Array(DEFAULT_ROWS).fill(null).map(() => Array(DEFAULT_COLS).fill('')));
  }, []);

  // 实际处理函数
  const doProcess = (tool: ToolType, prefix?: string) => {
    if (!selection) {
      setStatusMsg('请先用鼠标框选要处理的单元格区域');
      return;
    }

    // clearSource: false = 保留原文（默认）, true = 删除原文
    const options: ProcessOptions = { clearSource, customPrefix: prefix };
    const { newGrid, updatedCols } = processGrid(gridData, selection, tool, options);
    setGridData(newGrid);

    // 标记原列为橙色（拆分操作时，且保留原文）
    // 只有保留原文时才标记，因为删除原文后颜色没有意义
    if ((tool === ToolType.SplitThree || tool === ToolType.SplitTwo) && !clearSource) {
      const minR = Math.min(selection.start.row, selection.end.row);
      const maxR = Math.max(selection.start.row, selection.end.row);
      const minC = Math.min(selection.start.col, selection.end.col);
      const maxC = Math.max(selection.start.col, selection.end.col);

      const newStyles = new Map(gridStyles);
      // 标记有内容的原列为橙色
      for (let c = minC; c <= maxC; c++) {
        for (let r = minR; r <= maxR; r++) {
          const val = gridData[r]?.[c] || '';
          if (val.trim()) {
            newStyles.set(cellKey(r, c), { bgColor: '#FFA500' }); // 橙色
          }
        }
      }
      setGridStyles(newStyles);
    } else if (clearSource) {
      // 如果删除原文，清除原列的颜色标记
      const minR = Math.min(selection.start.row, selection.end.row);
      const maxR = Math.max(selection.start.row, selection.end.row);
      const minC = Math.min(selection.start.col, selection.end.col);
      const maxC = Math.max(selection.start.col, selection.end.col);

      const newStyles = new Map(gridStyles);
      for (let c = minC; c <= maxC; c++) {
        for (let r = minR; r <= maxR; r++) {
          newStyles.delete(cellKey(r, c));
        }
      }
      setGridStyles(newStyles);
    }

    // 根据工具类型显示不同的提示
    let toolMsg = '';
    if (tool === ToolType.ClearChinese) {
      // Parse stats from updatedCols (negative values are stats)
      let deletedCount = 0;
      let punctuationOnlyCount = 0;
      const realCols: number[] = [];

      for (const col of updatedCols) {
        if (col <= -2000) {
          punctuationOnlyCount = -(col + 2000);
        } else if (col <= -1000) {
          deletedCount = -(col + 1000);
        } else {
          realCols.push(col);
        }
      }

      let msg = `已删除 ${deletedCount} 个含中文汉字的单元格`;
      if (punctuationOnlyCount > 0) {
        msg += `（另有 ${punctuationOnlyCount} 个单元格仅含中文标点，已保留）`;
      }
      if (deletedCount === 0 && punctuationOnlyCount === 0) {
        msg = '选区内没有找到中文内容';
      }
      toolMsg = msg;
    } else if (tool === ToolType.AddPromptPrefix) {
      // Parse stats from updatedCols
      let totalAdded = 0;
      for (const col of updatedCols) {
        if (col <= -3000) {
          totalAdded = -(col + 3000);
        }
      }
      const prefixUsed = prefix || 'prompt';
      toolMsg = `已为 ${totalAdded} 个单元格添加 ${prefixUsed}- 前缀`;
    } else {
      const colsStr = updatedCols.filter(c => c >= 0).map(c => colToLetter(c)).join(', ');
      const clearMsg = clearSource ? ' (已删除原文案)' : '';
      toolMsg = `已处理选区，结果更新于列: ${colsStr}${clearMsg}`;
    }
    setStatusMsg(toolMsg);
  };

  // 入口函数：对于 AddPromptPrefix 显示弹窗，其他工具直接处理
  const handleProcess = (tool: ToolType) => {
    if (tool === ToolType.AddPromptPrefix) {
      if (!selection) {
        setStatusMsg('请先用鼠标框选要处理的单元格区域');
        return;
      }
      setShowPrefixModal(true);
    } else {
      doProcess(tool);
    }
  };

  // 确认添加前缀
  const handleConfirmPrefix = () => {
    setShowPrefixModal(false);
    doProcess(ToolType.AddPromptPrefix, customPrefix);
  };

  const handleCopyAll = async () => {
    const text = formatForClipboard(gridData);
    const html = buildGoogleSheetsHtml(gridData, {
      styles: gridStyles,
      includeEmptyRows: false
    });

    const result = await copyToClipboard(text, html);
    if (result === 'rich') {
      setCopied(true);
      setStatusMsg('已复制！粘贴到 Google Sheets 试试');
      setTimeout(() => setCopied(false), 2000);
      return;
    }

    if (result === 'text') {
      setCopied(true);
      setStatusMsg('已复制（纯文本）');
      setTimeout(() => setCopied(false), 2000);
      return;
    }

    setStatusMsg('复制失败');
  };

  const handleSelectAll = () => {
    // Select all cells with content
    let maxRow = 0;
    let maxCol = 0;
    for (let r = 0; r < gridData.length; r++) {
      for (let c = 0; c < (gridData[r]?.length || 0); c++) {
        if (gridData[r][c]?.trim()) {
          maxRow = Math.max(maxRow, r);
          maxCol = Math.max(maxCol, c);
        }
      }
    }
    const newSelection = {
      start: { row: 0, col: 0 },
      end: { row: maxRow, col: maxCol }
    };
    setForceSelection(newSelection); // 触发子组件更新
    setSelection(newSelection); // 同步父组件状态
    setStatusMsg(`已选中全部内容: A1:${colToLetter(maxCol)}${maxRow + 1}`);
  };

  const getSelectionLabel = () => {
    if (!selection) return null;
    const minR = Math.min(selection.start.row, selection.end.row) + 1;
    const maxR = Math.max(selection.start.row, selection.end.row) + 1;
    const minC = colToLetter(Math.min(selection.start.col, selection.end.col));
    const maxC = colToLetter(Math.max(selection.start.col, selection.end.col));

    if (minR === maxR && minC === maxC) return `${minC}${minR}`;
    return `${minC}${minR}:${maxC}${maxR}`;
  };

  return (
    <div className="script-tool-app tool-container">
      {/* Toolbar */}
      <header className="bg-[#f9fbfd] border-b border-slate-200 px-4 py-3 flex-none">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">

          {/* Title & Logo */}
          <div className="flex items-center gap-3">
            <div className="bg-[#107c41] p-2 rounded text-white shadow-sm">
              <Grid3X3 className="w-6 h-6" />
            </div>
            <div>
              <h1 className="text-lg font-medium text-slate-800 leading-tight">文案拆分表</h1>
              <p className="text-xs text-slate-500">类 Google Sheets 编辑器</p>
            </div>
          </div>

          {/* Tool Actions */}
          <div className="flex items-center gap-2 flex-wrap">
            {/* 选中全部 & 复制全部 - 放在最前面 */}
            <Button variant="primary" onClick={handleSelectAll} className="bg-blue-600 hover:bg-blue-700 text-white border-transparent shadow-sm text-xs whitespace-nowrap">
              <CheckSquare className="w-4 h-4 mr-1" />
              选中全部
            </Button>

            <Button variant="primary" onClick={handleCopyAll} className="bg-[#107c41] hover:bg-[#0b6a37] text-white border-transparent shadow-sm text-xs whitespace-nowrap">
              {copied ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
              {copied ? '已复制' : '复制全部'}
            </Button>

            <div className="w-px h-6 bg-slate-300 mx-1"></div>

            {/* 拆分工具 */}
            <div className="flex bg-white border border-slate-300 rounded-md shadow-sm divide-x divide-slate-300">
              <ToolButton
                icon={<Columns className="w-4 h-4" />}
                label="拆分三段 (标/内/尾)"
                tooltip="把选区按 标题/正文/尾句 三列拆分到新列"
                onClick={() => handleProcess(ToolType.SplitThree)}
                disabled={!selection}
              />
              <ToolButton
                icon={<div className="flex gap-0.5 scale-75"><div className="w-1 h-4 bg-current rounded-sm"></div><div className="w-1 h-4 bg-current rounded-sm"></div></div>}
                label="拆分两段 (标/内)"
                tooltip="把选区按 标题/正文 两列拆分到新列"
                onClick={() => handleProcess(ToolType.SplitTwo)}
                disabled={!selection}
              />
              <ToolButton
                icon={<WrapText className="w-4 h-4" />}
                label="清理换行"
                tooltip="清除多余换行，按句号转换为一行一句"
                onClick={() => handleProcess(ToolType.CleanBreaks)}
                disabled={!selection}
              />
              <ToolButton
                icon={<Video className="w-4 h-4" />}
                label="视频提示词"
                tooltip="将选区内容统一格式化为视频提示词模板"
                onClick={() => handleProcess(ToolType.VideoPrompts)}
                disabled={!selection}
              />
              <ToolButton
                icon={<Languages className="w-4 h-4" />}
                label="删除中文"
                tooltip="删除选中区域内包含中文的单元格（保留纯外文）"
                onClick={() => handleProcess(ToolType.ClearChinese)}
                disabled={!selection}
              />
              <ToolButton
                icon={<Hash className="w-4 h-4" />}
                label="Opal 序号"
                tooltip="给每个单元格内容前面添加 prompt-序号（用于 Opal 自动化）"
                onClick={() => handleProcess(ToolType.AddPromptPrefix)}
                disabled={!selection}
              />
            </div>

            <div className="w-px h-6 bg-slate-300 mx-1"></div>

            {/* Clear Source Switch */}
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">删除原文</span>
              <button
                onClick={() => setClearSource(!clearSource)}
                title={clearSource ? '拆分后删除原始文案' : '拆分后保留原始文案（默认）'}
                className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${clearSource ? 'bg-red-500' : 'bg-slate-300'
                  }`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform`}
                  style={{ transform: clearSource ? 'translateX(18px)' : 'translateX(2px)' }}
                />
              </button>
            </div>
          </div>
        </div>

        {/* Status Bar / Hints */}
        <div className="mt-3 flex items-center justify-between text-xs">
          <div className={`flex items-center gap-2 px-3 py-1.5 rounded transition-colors ${statusMsg || selection ? 'bg-blue-600 text-white' : 'bg-slate-700 text-white'}`}>
            {selection ? <MousePointer2 className="w-3.5 h-3.5" /> : <Info className="w-3.5 h-3.5" />}
            <span className="font-medium">
              {statusMsg || (selection
                ? `当前选区：${getSelectionLabel()}。点击上方工具处理选区。`
                : '提示：支持 Ctrl+C 复制，Delete 删除，Ctrl+V 粘贴。拖拽可框选区域。')}
            </span>
          </div>
        </div>
      </header>

      {/* Main Grid Area */}
      <main className="flex-1 flex flex-col overflow-hidden relative">
        <SpreadsheetGrid
          data={gridData}
          onChange={setGridData}
          onSelectionChange={setSelection}
          externalSelection={forceSelection}
          cellStyles={gridStyles}
        />
      </main>

      {/* 自定义前缀弹窗 */}
      {showPrefixModal && (
        <div
          style={{
            position: 'fixed',
            top: 0,
            left: 0,
            right: 0,
            bottom: 0,
            background: 'rgba(0, 0, 0, 0.5)',
            display: 'flex',
            justifyContent: 'center',
            alignItems: 'center',
            zIndex: 9999
          }}
          onClick={() => setShowPrefixModal(false)}
        >
          <div
            style={{
              background: 'white',
              borderRadius: '12px',
              padding: '24px',
              minWidth: '360px',
              boxShadow: '0 20px 40px rgba(0,0,0,0.2)'
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <h3 style={{ margin: '0 0 16px', fontSize: '18px', fontWeight: 600, color: '#1e293b' }}>
              添加序号前缀
            </h3>
            <p style={{ margin: '0 0 16px', fontSize: '14px', color: '#64748b' }}>
              输入要添加的前缀内容。例如输入 "prompt"，将生成 prompt-1、prompt-2...
            </p>
            <input
              type="text"
              value={customPrefix}
              onChange={(e) => setCustomPrefix(e.target.value)}
              placeholder="输入前缀，如: prompt, step, item"
              style={{
                width: '100%',
                padding: '12px 16px',
                border: '2px solid #e2e8f0',
                borderRadius: '8px',
                fontSize: '16px',
                outline: 'none',
                marginBottom: '16px',
                boxSizing: 'border-box'
              }}
              onFocus={(e) => e.target.style.borderColor = '#3b82f6'}
              onBlur={(e) => e.target.style.borderColor = '#e2e8f0'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customPrefix.trim()) {
                  handleConfirmPrefix();
                }
              }}
              autoFocus
            />
            <div style={{ display: 'flex', gap: '12px', justifyContent: 'flex-end' }}>
              <button
                onClick={() => setShowPrefixModal(false)}
                style={{
                  padding: '10px 20px',
                  border: '1px solid #e2e8f0',
                  borderRadius: '8px',
                  background: 'white',
                  color: '#64748b',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: 'pointer'
                }}
              >
                取消
              </button>
              <button
                onClick={handleConfirmPrefix}
                disabled={!customPrefix.trim()}
                style={{
                  padding: '10px 20px',
                  border: 'none',
                  borderRadius: '8px',
                  background: customPrefix.trim() ? '#22c55e' : '#94a3b8',
                  color: 'white',
                  fontSize: '14px',
                  fontWeight: 500,
                  cursor: customPrefix.trim() ? 'pointer' : 'not-allowed'
                }}
              >
                确定添加
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

const ToolButton: React.FC<{ icon: React.ReactNode; label: string; tooltip?: string; onClick: () => void; disabled?: boolean }> = ({ icon, label, tooltip, onClick, disabled }) => (
  <button
    onClick={onClick}
    disabled={disabled}
    title={tooltip || label}
    className={`
      flex items-center gap-2 px-3 py-2 transition-colors text-xs font-medium whitespace-nowrap
      ${disabled
        ? 'opacity-40 cursor-not-allowed bg-slate-50 text-slate-400'
        : 'hover:bg-green-50 text-slate-700 hover:text-green-700'
      }
    `}
  >
    {icon}
    <span>{label}</span>
  </button>
);

export default ScriptToolApp;
