
import React, { useState, useEffect, useRef, useLayoutEffect, useCallback } from 'react';
import { GridData, Coordinate, GridSelection, GridStyles, cellKey } from '../types';
import { parsePasteData, formatForClipboard, colToLetter } from '../utils/processor';
import { buildGoogleSheetsHtml, copyToClipboard } from '../utils/clipboard';

interface SpreadsheetGridProps {
  data: GridData;
  onChange: (newData: GridData) => void;
  // Notify parent about selection changes so toolbar knows what to target
  onSelectionChange: (sel: GridSelection | null) => void;
  // Allow parent to control selection (e.g., for "Select All" button)
  externalSelection?: GridSelection | null;
  // Cell styles (e.g., orange background for source columns)
  cellStyles?: GridStyles;
  // Notify parent about style changes
  onStylesChange?: (styles: GridStyles) => void;
}

type ResizeState =
  | { type: 'col'; index: number; startX: number; startWidth: number; minIndex: number; maxIndex: number }
  | { type: 'row'; index: number; startY: number; startHeight: number; minIndex: number; maxIndex: number }
  | null;

type ResizePreview = { type: 'col' | 'row'; position: number; size: number };

const DEFAULT_COL_WIDTH = 140;
const DEFAULT_ROW_HEIGHT = 36;

export const SpreadsheetGrid: React.FC<SpreadsheetGridProps> = ({
  data,
  onChange,
  onSelectionChange,
  externalSelection,
  cellStyles,
  onStylesChange
}) => {
  // State
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [editingCell, setEditingCell] = useState<Coordinate | null>(null);
  const [colWidths, setColWidths] = useState<number[]>([]);
  const [rowHeights, setRowHeights] = useState<number[]>([]);
  const [resizeState, setResizeState] = useState<ResizeState>(null);
  const [resizePreview, setResizePreview] = useState<ResizePreview | null>(null);
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const resizeRafRef = useRef<number | null>(null);
  const pendingResizeRef = useRef<{
    type: 'row' | 'col';
    size: number;
    minIndex: number;
    maxIndex: number;
  } | null>(null);
  const pendingPreviewRef = useRef<ResizePreview | null>(null);
  const lastAppliedResizeRef = useRef<{
    type: 'row' | 'col';
    size: number;
    minIndex: number;
    maxIndex: number;
  } | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);

  // Derived dimensions
  const rowCount = Math.max(data.length, 50); // Ensure enough rows
  const colCount = Math.max(data[0]?.length || 0, 20); // Ensure enough cols

  // Ensure widths/heights arrays have correct length
  useEffect(() => {
    setColWidths(prev => {
      const next = [...prev];
      while (next.length < colCount) next.push(DEFAULT_COL_WIDTH);
      return next;
    });
    setRowHeights(prev => {
      const next = [...prev];
      while (next.length < rowCount) next.push(DEFAULT_ROW_HEIGHT);
      return next;
    });
  }, [colCount, rowCount]);

  // --- Selection Logic ---

  // Notify parent when the selection changes
  useEffect(() => {
    onSelectionChange(selection);
  }, [selection, onSelectionChange]);

  // Sync external selection from parent (e.g., "Select All" button)
  useEffect(() => {
    if (externalSelection) {
      setSelection(externalSelection);
    }
  }, [externalSelection]);

  const handleMouseDown = (r: number, c: number, e: React.MouseEvent) => {
    if (e.button !== 0) return; // Only left click
    if (editingCell) return; // Don't interfere if editing

    setIsDragging(true);
    const newSelection = {
      start: { row: r, col: c },
      end: { row: r, col: c }
    };
    setSelection(newSelection);

    // Focus container to capture keyboard events
    containerRef.current?.focus();
  };

  const handleMouseEnter = (r: number, c: number) => {
    if (isDragging && selection) {
      setSelection({
        ...selection,
        end: { row: r, col: c }
      });
    }
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  const applyResize = useCallback((pending: {
    type: 'row' | 'col';
    size: number;
    minIndex: number;
    maxIndex: number;
  }) => {
    const last = lastAppliedResizeRef.current;
    if (
      last &&
      last.type === pending.type &&
      last.size === pending.size &&
      last.minIndex === pending.minIndex &&
      last.maxIndex === pending.maxIndex
    ) {
      return;
    }

    lastAppliedResizeRef.current = pending;

    if (pending.type === 'col') {
      setColWidths(prev => {
        const next = [...prev];
        const neededLength = pending.maxIndex + 1;
        if (next.length < neededLength) next.length = neededLength;
        next.fill(pending.size, pending.minIndex, pending.maxIndex + 1);
        return next;
      });
      return;
    }

    setRowHeights(prev => {
      const next = [...prev];
      const neededLength = pending.maxIndex + 1;
      if (next.length < neededLength) next.length = neededLength;
      next.fill(pending.size, pending.minIndex, pending.maxIndex + 1);
      return next;
    });
  }, []);

  const schedulePreview = useCallback((
    pending: {
      type: 'row' | 'col';
      size: number;
      minIndex: number;
      maxIndex: number;
    },
    preview: ResizePreview
  ) => {
    pendingResizeRef.current = pending;
    pendingPreviewRef.current = preview;
    if (resizeRafRef.current !== null) return;

    resizeRafRef.current = window.requestAnimationFrame(() => {
      resizeRafRef.current = null;
      const nextPreview = pendingPreviewRef.current;
      pendingPreviewRef.current = null;
      if (nextPreview) {
        setResizePreview(nextPreview);
      }
    });
  }, []);

  // --- Resize Logic ---
  useEffect(() => {
    if (!resizeState) return;
    const handleMove = (e: MouseEvent) => {
      if (resizeState.type === 'col') {
        const delta = e.clientX - resizeState.startX;
        const newWidth = Math.max(60, Math.round(resizeState.startWidth + delta));
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const position = Math.min(Math.max(0, e.clientX - rect.left), rect.width);
        schedulePreview(
          {
            type: 'col',
            size: newWidth,
            minIndex: resizeState.minIndex,
            maxIndex: resizeState.maxIndex
          },
          { type: 'col', position, size: newWidth }
        );
      } else if (resizeState.type === 'row') {
        const delta = e.clientY - resizeState.startY;
        const newHeight = Math.max(22, Math.round(resizeState.startHeight + delta));
        const container = containerRef.current;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        const position = Math.min(Math.max(0, e.clientY - rect.top), rect.height);
        schedulePreview(
          {
            type: 'row',
            size: newHeight,
            minIndex: resizeState.minIndex,
            maxIndex: resizeState.maxIndex
          },
          { type: 'row', position, size: newHeight }
        );
      }
    };
    const handleUp = () => {
      if (resizeRafRef.current !== null) {
        window.cancelAnimationFrame(resizeRafRef.current);
        resizeRafRef.current = null;
      }
      if (pendingPreviewRef.current) {
        setResizePreview(pendingPreviewRef.current);
        pendingPreviewRef.current = null;
      }
      if (pendingResizeRef.current) {
        applyResize(pendingResizeRef.current);
        pendingResizeRef.current = null;
      }
      setResizePreview(null);
      setResizeState(null);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.body.style.userSelect = 'none';
    document.body.style.cursor = resizeState.type === 'col' ? 'col-resize' : 'row-resize';
    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
    return () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
  }, [resizeState, schedulePreview, applyResize]);

  const getColResizeRange = (index: number) => {
    if (!selection) return { minIndex: index, maxIndex: index };
    const minC = Math.min(selection.start.col, selection.end.col);
    const maxC = Math.max(selection.start.col, selection.end.col);
    if (index < minC || index > maxC) return { minIndex: index, maxIndex: index };
    return { minIndex: minC, maxIndex: maxC };
  };

  const getRowResizeRange = (index: number) => {
    if (!selection) return { minIndex: index, maxIndex: index };
    const minR = Math.min(selection.start.row, selection.end.row);
    const maxR = Math.max(selection.start.row, selection.end.row);
    if (index < minR || index > maxR) return { minIndex: index, maxIndex: index };
    return { minIndex: minR, maxIndex: maxR };
  };

  const startColResize = (index: number, evt: React.MouseEvent) => {
    evt.stopPropagation();
    const { minIndex, maxIndex } = getColResizeRange(index);
    const startWidth = colWidths[index] ?? DEFAULT_COL_WIDTH;
    pendingResizeRef.current = {
      type: 'col',
      size: startWidth,
      minIndex,
      maxIndex
    };
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const position = Math.min(Math.max(0, evt.clientX - rect.left), rect.width);
      setResizePreview({ type: 'col', position, size: startWidth });
    }
    setResizeState({
      type: 'col',
      index,
      startX: evt.clientX,
      startWidth,
      minIndex,
      maxIndex
    });
  };

  const startRowResize = (index: number, evt: React.MouseEvent) => {
    evt.stopPropagation();
    const { minIndex, maxIndex } = getRowResizeRange(index);
    const startHeight = rowHeights[index] ?? DEFAULT_ROW_HEIGHT;
    pendingResizeRef.current = {
      type: 'row',
      size: startHeight,
      minIndex,
      maxIndex
    };
    const container = containerRef.current;
    if (container) {
      const rect = container.getBoundingClientRect();
      const position = Math.min(Math.max(0, evt.clientY - rect.top), rect.height);
      setResizePreview({ type: 'row', position, size: startHeight });
    }
    setResizeState({
      type: 'row',
      index,
      startY: evt.clientY,
      startHeight,
      minIndex,
      maxIndex
    });
  };

  const handleColumnHeaderClick = (colIndex: number, e: React.MouseEvent) => {
    if (e.shiftKey && selection) {
      const anchorCol = selection.start.col;
      setSelection({
        start: { row: 0, col: Math.min(anchorCol, colIndex) },
        end: { row: rowCount - 1, col: Math.max(anchorCol, colIndex) }
      });
    } else {
      // Select entire column (visually represented as 0 to max rows)
      setSelection({
        start: { row: 0, col: colIndex },
        end: { row: rowCount - 1, col: colIndex }
      });
    }
    containerRef.current?.focus();
  };

  const handleRowHeaderClick = (rowIndex: number, e: React.MouseEvent) => {
    if (e.shiftKey && selection) {
      const anchorRow = selection.start.row;
      setSelection({
        start: { row: Math.min(anchorRow, rowIndex), col: 0 },
        end: { row: Math.max(anchorRow, rowIndex), col: colCount - 1 }
      });
    } else {
      setSelection({
        start: { row: rowIndex, col: 0 },
        end: { row: rowIndex, col: colCount - 1 }
      });
    }
    containerRef.current?.focus();
  };

  // --- Keyboard & Action Logic ---

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (editingCell) return; // Let textarea handle events

    // Select all (Ctrl/Cmd + A)
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'a') {
      e.preventDefault();
      selectAllCells();
      return;
    }
    if (!selection) return;

    // Delete / Backspace: Clear content
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault();
      handleClearSelection();
    }

    // Copy (Ctrl+C)
    if ((e.metaKey || e.ctrlKey) && e.key === 'c') {
      e.preventDefault();
      handleCopy();
    }

    // Paste (Ctrl+V) - 直接在 keydown 中处理，解决 Electron 的 onPaste 事件问题
    if ((e.metaKey || e.ctrlKey) && e.key === 'v') {
      e.preventDefault();
      handlePasteFromKeyboard();
    }

    // Navigation
    if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.key)) {
      e.preventDefault();
      moveSelection(e.key);
    }

    // Enter: Move down or Edit
    if (e.key === 'Enter') {
      e.preventDefault();
      // If Shift+Enter, maybe move up? For now simple down
      moveSelection('ArrowDown');
    }

    // Tab: Move right
    if (e.key === 'Tab') {
      e.preventDefault();
      moveSelection('ArrowRight');
    }
  };

  const moveSelection = (key: string) => {
    if (!selection) return;
    const { start } = selection;
    let nr = start.row;
    let nc = start.col;

    if (key === 'ArrowUp') nr = Math.max(0, nr - 1);
    if (key === 'ArrowDown') nr = Math.min(rowCount - 1, nr + 1);
    if (key === 'ArrowLeft') nc = Math.max(0, nc - 1);
    if (key === 'ArrowRight') nc = Math.min(colCount - 1, nc + 1);

    setSelection({
      start: { row: nr, col: nc },
      end: { row: nr, col: nc }
    });

    // Logic to scroll view to selection would go here
  };

  const selectAllCells = () => {
    let maxRow = -1;
    let maxCol = -1;

    for (let r = 0; r < data.length; r++) {
      const row = data[r] || [];
      for (let c = 0; c < row.length; c++) {
        if (row[c]?.trim()) {
          maxRow = Math.max(maxRow, r);
          maxCol = Math.max(maxCol, c);
        }
      }
    }

    if (maxRow === -1 || maxCol === -1) {
      setSelection({
        start: { row: 0, col: 0 },
        end: { row: rowCount - 1, col: colCount - 1 }
      });
      return;
    }

    setSelection({
      start: { row: 0, col: 0 },
      end: { row: maxRow, col: maxCol }
    });
  };

  const selectAllGrid = () => {
    setSelection({
      start: { row: 0, col: 0 },
      end: { row: rowCount - 1, col: colCount - 1 }
    });
    containerRef.current?.focus();
  };

  const handleClearSelection = () => {
    if (!selection) return;
    const { minR, maxR, minC, maxC } = getSelectionBounds(selection);

    const newData = [...data];
    // Ensure rows exist
    for (let r = 0; r <= maxR; r++) {
      if (!newData[r]) newData[r] = [];
    }

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (newData[r]) newData[r][c] = '';
      }
    }
    onChange(newData);
  };

  const handleCopy = async () => {
    if (!selection) return;
    const { minR, maxR, minC, maxC } = getSelectionBounds(selection);

    // Extract sub-grid
    const subGrid: GridData = [];
    for (let r = minR; r <= maxR; r++) {
      const row: string[] = [];
      for (let c = minC; c <= maxC; c++) {
        row.push(data[r]?.[c] || '');
      }
      subGrid.push(row);
    }

    const text = formatForClipboard(subGrid);
    const html = buildGoogleSheetsHtml(subGrid, {
      styles: cellStyles,
      rowOffset: minR,
      colOffset: minC
    });
    const result = await copyToClipboard(text, html);
    if (result === 'failed') {
      console.error('Copy failed');
    }
  };

  // 从键盘 Ctrl+V 触发的粘贴（解决 Electron 的 onPaste 事件问题）
  const handlePasteFromKeyboard = async () => {
    if (editingCell) return;

    let text = '';

    // 优先使用 Electron 剪贴板 API（桌面版）
    if ((window as any).electronAPI?.clipboardReadText) {
      try {
        text = (window as any).electronAPI.clipboardReadText() || '';
      } catch (err) {
        console.warn('[SpreadsheetGrid] Electron clipboard failed:', err);
      }
    }

    // 如果 Electron API 失败，尝试浏览器 API
    if (!text) {
      try {
        text = await navigator.clipboard.readText();
      } catch (err) {
        console.warn('[SpreadsheetGrid] Browser clipboard failed:', err);
      }
    }

    if (!text) {
      console.warn('[SpreadsheetGrid] No text to paste');
      return;
    }

    const pastedRows = parsePasteData(text);
    if (!pastedRows.length) return;

    const startR = selection ? selection.start.row : 0;
    const startC = selection ? selection.start.col : 0;

    const newData = [...data];

    pastedRows.forEach((pRow, rIdx) => {
      const targetR = startR + rIdx;
      if (!newData[targetR]) newData[targetR] = [];

      pRow.forEach((pCell, cIdx) => {
        const targetC = startC + cIdx;
        while (newData[targetR].length <= targetC) newData[targetR].push('');
        newData[targetR][targetC] = pCell;
      });
    });

    onChange(newData);
  };

  const handlePaste = async (e: React.ClipboardEvent) => {
    if (editingCell) return;
    e.preventDefault();

    let text = '';

    // 优先使用 Electron 剪贴板 API（桌面版）
    if ((window as any).electronAPI?.clipboardReadText) {
      try {
        text = (window as any).electronAPI.clipboardReadText() || '';
      } catch (err) {
        console.warn('[SpreadsheetGrid] Electron clipboard failed:', err);
      }
    }

    // 如果 Electron API 失败或为空，尝试浏览器剪贴板
    if (!text) {
      text = e.clipboardData?.getData('text/plain') || '';
    }

    if (!text) {
      console.warn('[SpreadsheetGrid] No text to paste');
      return;
    }

    const pastedRows = parsePasteData(text);
    if (!pastedRows.length) return;

    const startR = selection ? selection.start.row : 0;
    const startC = selection ? selection.start.col : 0;

    const newData = [...data];

    pastedRows.forEach((pRow, rIdx) => {
      const targetR = startR + rIdx;
      if (!newData[targetR]) newData[targetR] = [];

      pRow.forEach((pCell, cIdx) => {
        const targetC = startC + cIdx;
        // Ensure padding
        while (newData[targetR].length <= targetC) newData[targetR].push('');
        newData[targetR][targetC] = pCell;
      });
    });

    onChange(newData);
  };

  const handleDoubleClick = (r: number, c: number) => {
    setEditingCell({ row: r, col: c });
  };

  const updateCell = (val: string) => {
    if (!editingCell) return;
    const { row, col } = editingCell;
    const newData = [...data];
    if (!newData[row]) newData[row] = [];
    while (newData[row].length <= col) newData[row].push('');
    newData[row][col] = val;
    onChange(newData);
  };

  const resizeEditor = useCallback(() => {
    if (!editingCell || !editorRef.current) return;

    const minWidth = Math.max(colWidths[editingCell.col] || DEFAULT_COL_WIDTH, 300);
    const minHeight = Math.max(rowHeights[editingCell.row] || DEFAULT_ROW_HEIGHT, 150);
    const textarea = editorRef.current;

    textarea.style.width = `${minWidth}px`;
    textarea.style.height = '0px';

    const nextHeight = Math.max(textarea.scrollHeight + 2, minHeight);
    textarea.style.height = `${nextHeight}px`;
  }, [editingCell, colWidths, rowHeights]);

  useLayoutEffect(() => {
    resizeEditor();
  }, [resizeEditor, editingCell, data]);

  // --- Rendering Helpers ---

  const getSelectionBounds = (sel: GridSelection) => {
    return {
      minR: Math.min(sel.start.row, sel.end.row),
      maxR: Math.max(sel.start.row, sel.end.row),
      minC: Math.min(sel.start.col, sel.end.col),
      maxC: Math.max(sel.start.col, sel.end.col),
    };
  };

  const isSelected = (r: number, c: number) => {
    if (!selection) return false;
    const { minR, maxR, minC, maxC } = getSelectionBounds(selection);
    return r >= minR && r <= maxR && c >= minC && c <= maxC;
  };

  // --- Render ---

  return (
    <div
      className="flex-1 overflow-auto relative bg-slate-200 outline-none select-none"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onMouseUp={handleMouseUp}
    >
      {resizePreview && (
        <div className="pointer-events-none absolute inset-0 z-40">
          {resizePreview.type === 'col' ? (
            <>
              <div
                className="absolute top-0 bottom-0 w-px bg-blue-500"
                style={{ left: resizePreview.position }}
              />
              <div
                className="absolute top-1 px-2 py-0.5 text-xs text-white bg-blue-500 rounded shadow"
                style={{ left: resizePreview.position + 6 }}
              >
                {resizePreview.size}px
              </div>
            </>
          ) : (
            <>
              <div
                className="absolute left-0 right-0 h-px bg-blue-500"
                style={{ top: resizePreview.position }}
              />
              <div
                className="absolute left-1 px-2 py-0.5 text-xs text-white bg-blue-500 rounded shadow"
                style={{ top: resizePreview.position + 6 }}
              >
                {resizePreview.size}px
              </div>
            </>
          )}
        </div>
      )}
      {/* The Grid Canvas */}
      <div
        className="inline-block bg-white relative"
        style={{ minWidth: '100%', minHeight: '100%' }}
      >
        {/* Column Headers */}
        <div className="flex sticky top-0 z-20 bg-slate-50 shadow-sm">
          <div
            className="w-10 h-8 flex-shrink-0 border-r border-b border-slate-300 bg-slate-100 z-30 sticky left-0 cursor-pointer"
            onClick={selectAllGrid}
            data-tip="全选" className="tooltip-bottom"
          ></div>
          {Array.from({ length: colCount }).map((_, c) => {
            const isColActive = selection && selection.start.col === c && selection.end.col === c && selection.start.row === 0 && selection.end.row === rowCount - 1;
            const isColInRange = selection && c >= Math.min(selection.start.col, selection.end.col) && c <= Math.max(selection.start.col, selection.end.col);

            return (
              <div
                key={c}
                className={`
                  h-8 flex-shrink-0 border-r border-b border-slate-300 flex items-center justify-center text-xs font-bold select-none cursor-pointer transition-colors relative
                  ${isColActive ? 'bg-[#107c41] text-white' : (isColInRange ? 'bg-green-100 text-[#107c41]' : 'text-slate-600 hover:bg-slate-100')}
                `}
                style={{ width: colWidths[c] || DEFAULT_COL_WIDTH, minWidth: 60 }}
                onClick={(e) => handleColumnHeaderClick(c, e)}
              >
                {colToLetter(c)}
                <span
                  className="absolute top-0 right-0 h-full w-1 cursor-col-resize"
                  onMouseDown={(e) => startColResize(c, e)}
                />
              </div>
            );
          })}
        </div>

        {/* Grid Body */}
        <div className="relative">
          {Array.from({ length: rowCount }).map((_, r) => (
            <div key={r} className="flex" style={{ height: rowHeights[r] || DEFAULT_ROW_HEIGHT, minHeight: 22 }}>
              {/* Row Header */}
              <div
                className="w-10 flex-shrink-0 sticky left-0 z-10 bg-slate-50 border-r border-b border-slate-300 flex items-center justify-center text-xs text-slate-500 font-medium select-none cursor-pointer"
                onClick={(e) => handleRowHeaderClick(r, e)}
              >
                <div className="relative w-full h-full flex items-center justify-center">
                  {r + 1}
                  <span
                    className="absolute bottom-0 left-0 w-full h-1 cursor-row-resize"
                    onMouseDown={(e) => startRowResize(r, e)}
                  />
                </div>
              </div>

              {/* Cells */}
              {Array.from({ length: colCount }).map((_, c) => {
                const cellValue = data[r]?.[c] || '';
                const selected = isSelected(r, c);
                const editing = editingCell?.row === r && editingCell?.col === c;

                // Determine borders for selection range outline
                let borderClasses = "border-r border-b border-slate-200";
                if (selected && !editing) {
                  const { minR, maxR, minC, maxC } = getSelectionBounds(selection!);
                  if (r === minR) borderClasses += " border-t-2 border-t-blue-500";
                  if (r === maxR) borderClasses += " border-b-2 border-b-blue-500";
                  if (c === minC) borderClasses += " border-l-2 border-l-blue-500";
                  if (c === maxC) borderClasses += " border-r-2 border-r-blue-500";
                }

                // Get cell background color from styles
                const cellStyle = cellStyles?.get(cellKey(r, c));
                const bgColor = cellStyle?.bgColor;
                // 选中时保持橙色背景，只用边框表示选中
                const finalBgColor = bgColor || (selected ? '#EFF6FF' : 'white');

                return (
                  <div
                    key={`${r}-${c}`}
                    className={`
                      flex-shrink-0 relative text-sm
                      ${borderClasses}
                    `}
                    style={{
                      width: colWidths[c] || DEFAULT_COL_WIDTH,
                      minWidth: 60,
                      height: rowHeights[r] || DEFAULT_ROW_HEIGHT,
                      minHeight: 22,
                      backgroundColor: finalBgColor
                    }}
                    onMouseDown={(e) => handleMouseDown(r, c, e)}
                    onMouseEnter={() => handleMouseEnter(r, c)}
                    onDoubleClick={() => handleDoubleClick(r, c)}
                  >
                    {editing ? (
                      <textarea
                        ref={editorRef}
                        autoFocus
                        className="absolute left-0 top-0 resize-none p-2 text-sm text-slate-900 bg-white focus:outline-none z-50 border-2 border-blue-500 shadow-xl rounded"
                        style={{
                          minWidth: Math.max(colWidths[c] || DEFAULT_COL_WIDTH, 300),
                          minHeight: Math.max(rowHeights[r] || DEFAULT_ROW_HEIGHT, 150),
                          width: 'auto',
                          height: 'auto',
                          overflow: 'hidden'
                        }}
                        value={cellValue}
                        onChange={(e) => updateCell(e.target.value)}
                        onBlur={() => setEditingCell(null)}
                        onKeyDown={(e) => {
                          e.stopPropagation(); // Stop grid nav
                          if (e.key === 'Escape') {
                            e.preventDefault();
                            setEditingCell(null);
                          }
                        }}
                      />
                    ) : (
                      <div className="w-full h-full px-2 py-1 overflow-hidden pointer-events-none" style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: '#000000' }}>
                        {cellValue}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
