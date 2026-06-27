
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
  diffColumns?: Record<number, number>;
  autoRowHeight?: boolean;
}

type ResizeState =
  | { type: 'col'; index: number; startX: number; startWidth: number; minIndex: number; maxIndex: number }
  | { type: 'row'; index: number; startY: number; startHeight: number; minIndex: number; maxIndex: number }
  | null;

type ResizePreview = { type: 'col' | 'row'; position: number; size: number };

const TOKEN_REGEX = /(\p{L}+|\p{N}+|[^\p{L}\p{N}\s]+|\s+)/gu;

function tokenize(text: string): string[] {
  if (!text) return [];
  return text.match(TOKEN_REGEX) || [];
}

interface DiffResult {
  type: 'common' | 'removed' | 'added' | 'case_change';
  textOrig?: string;
  textCorr?: string;
}

function diffTokens(tok1: string[], tok2: string[]): DiffResult[] {
  const n = tok1.length;
  const m = tok2.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => Array(m + 1).fill(0));
  
  for (let i = 1; i <= n; i++) {
    for (let j = 1; j <= m; j++) {
      if (tok1[i - 1].toLowerCase() === tok2[j - 1].toLowerCase()) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  let i = n, j = m;
  const result: DiffResult[] = [];
  
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && tok1[i - 1].toLowerCase() === tok2[j - 1].toLowerCase()) {
      const t1 = tok1[i - 1];
      const t2 = tok2[j - 1];
      if (t1 === t2) {
        result.unshift({ type: 'common', textOrig: t1, textCorr: t2 });
      } else {
        result.unshift({ type: 'case_change', textOrig: t1, textCorr: t2 });
      }
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      result.unshift({ type: 'added', textCorr: tok2[j - 1] });
      j--;
    } else {
      result.unshift({ type: 'removed', textOrig: tok1[i - 1] });
      i--;
    }
  }
  return result;
}

function renderDiffContent(val: string, isOriginal: boolean, compareVal?: string) {
  if (!compareVal || compareVal === val) {
    return val;
  }
  try {
    const originalText = isOriginal ? val : compareVal;
    const correctedText = isOriginal ? compareVal : val;
    const tok1 = tokenize(originalText);
    const tok2 = tokenize(correctedText);
    const diff = diffTokens(tok1, tok2);

    return (
      <>
        {diff.map((item, idx) => {
          if (isOriginal) {
            if (item.type === 'common') {
              return <span key={idx}>{item.textOrig}</span>;
            } else if (item.type === 'case_change') {
              return (
                <span
                  key={idx}
                  style={{
                    backgroundColor: '#fee2e2', // light red for original text capitalization change (about to be replaced)
                    color: '#991b1b',
                    padding: '0 2px',
                    borderRadius: '2px',
                    textDecoration: 'line-through'
                  }}
                >
                  {item.textOrig}
                </span>
              );
            } else if (item.type === 'removed') {
              return (
                <span
                  key={idx}
                  style={{
                    backgroundColor: '#fee2e2', // light red
                    color: '#991b1b',
                    textDecoration: 'line-through',
                    padding: '0 2px',
                    borderRadius: '2px',
                  }}
                >
                  {item.textOrig}
                </span>
              );
            }
            return null; // Skip added
          } else {
            if (item.type === 'common') {
              return <span key={idx}>{item.textCorr}</span>;
            } else if (item.type === 'case_change') {
              return (
                <span
                  key={idx}
                  style={{
                    backgroundColor: '#fef08a', // light yellow for capitalization changes
                    color: '#854d0e',
                    padding: '0 2px',
                    borderRadius: '2px',
                    fontWeight: 'bold'
                  }}
                >
                  {item.textCorr}
                </span>
              );
            } else if (item.type === 'added') {
              return (
                <span
                  key={idx}
                  style={{
                    backgroundColor: '#dcfce7', // light green
                    color: '#166534',
                    padding: '0 2px',
                    borderRadius: '2px',
                    fontWeight: 'bold',
                  }}
                >
                  {item.textCorr}
                </span>
              );
            }
            return null; // Skip removed
          }
        })}
      </>
    );
  } catch (e) {
    return val;
  }
}

const DEFAULT_COL_WIDTH = 140;
const DEFAULT_ROW_HEIGHT = 36;

export const SpreadsheetGrid: React.FC<SpreadsheetGridProps> = ({
  data,
  onChange,
  onSelectionChange,
  externalSelection,
  cellStyles,
  onStylesChange,
  diffColumns,
  autoRowHeight
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
  const hiddenInputRef = useRef<HTMLTextAreaElement | null>(null);

  // Derived dimensions
  const rowCount = Math.max(data.length, 50); // Ensure enough rows
  const colCount = Math.max(20, data.reduce((max, row) => Math.max(max, row?.length || 0), 0)); // Ensure enough cols

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

    // Focus hidden textarea to capture clipboard events directly
    if (hiddenInputRef.current) {
      hiddenInputRef.current.focus({ preventScroll: true });
    }
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
    if (hiddenInputRef.current) {
      hiddenInputRef.current.focus({ preventScroll: true });
    }
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
    if (hiddenInputRef.current) {
      hiddenInputRef.current.focus({ preventScroll: true });
    }
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
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'c') {
      e.preventDefault();
      handleCopy();
    }

    // Paste (Ctrl+V) - 直接在 keydown 中处理，解决 Electron 的 onPaste 事件问题
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'v') {
      if ((window as any).electronAPI) {
        e.preventDefault();
        handlePasteFromKeyboard();
      }
      // 非 Electron 环境不 call preventDefault，允许浏览器原生 paste 事件触发 onPaste={handlePaste}
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
    if (hiddenInputRef.current) {
      hiddenInputRef.current.focus({ preventScroll: true });
    }
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

    // 如果 Electron API 失败或为空，尝试使用浏览器 navigator.clipboard API
    if (!text && navigator.clipboard?.readText) {
      try {
        text = await navigator.clipboard.readText() || '';
      } catch (err) {
        console.warn('[SpreadsheetGrid] navigator.clipboard.readText failed:', err);
      }
    }

    if (!text) {
      console.warn('[SpreadsheetGrid] No clipboard text available');
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

    // 如果仍为空，尝试使用浏览器 navigator.clipboard API
    if (!text && navigator.clipboard?.readText) {
      try {
        text = await navigator.clipboard.readText() || '';
      } catch (err) {
        console.warn('[SpreadsheetGrid] navigator.clipboard.readText failed:', err);
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
      className="flex-1 overflow-auto relative bg-slate-950 outline-none select-none"
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPaste={handlePaste}
      onMouseUp={handleMouseUp}
      onFocus={(e) => {
        if (e.target === containerRef.current && !editingCell) {
          hiddenInputRef.current?.focus({ preventScroll: true });
        }
      }}
    >
      <textarea
        ref={hiddenInputRef}
        onPaste={handlePaste}
        style={{
          position: 'absolute',
          left: '-9999px',
          top: '-9999px',
          width: '100px',
          height: '100px',
          opacity: 0,
          border: 'none',
          padding: 0,
          margin: 0,
        }}
        tabIndex={-1}
      />
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
        className="inline-block bg-[#0b1220] relative"
        style={{ minWidth: '100%', minHeight: '100%' }}
      >
        {/* Column Headers */}
        <div className="flex sticky top-0 z-20 bg-[#0b1528] shadow-sm">
          <div
            className="w-10 h-8 flex-shrink-0 border-r border-b border-slate-700 bg-[#0f1b33] z-30 sticky left-0 cursor-pointer tooltip-bottom"
            onClick={selectAllGrid}
            data-tip="全选"
          ></div>
          {Array.from({ length: colCount }).map((_, c) => {
            const isColActive = selection && selection.start.col === c && selection.end.col === c && selection.start.row === 0 && selection.end.row === rowCount - 1;
            const isColInRange = selection && c >= Math.min(selection.start.col, selection.end.col) && c <= Math.max(selection.start.col, selection.end.col);

            return (
              <div
                key={c}
                className={`
                  h-8 flex-shrink-0 border-r border-b border-slate-700 flex items-center justify-center text-xs font-bold select-none cursor-pointer transition-colors relative
                  ${isColActive ? 'bg-[#107c41] text-white' : (isColInRange ? 'bg-emerald-900/55 text-emerald-200' : 'text-slate-200 hover:bg-slate-800')}
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
            <div
              key={r}
              className="flex"
              style={
                autoRowHeight
                  ? { minHeight: rowHeights[r] || DEFAULT_ROW_HEIGHT, height: 'auto' }
                  : { height: rowHeights[r] || DEFAULT_ROW_HEIGHT, minHeight: 22 }
              }
            >
              {/* Row Header */}
              <div
                className="w-10 flex-shrink-0 sticky left-0 z-10 bg-[#0f1b33] border-r border-b border-slate-700 flex items-center justify-center text-xs text-slate-300 font-medium select-none cursor-pointer"
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
                let borderClasses = "border-r border-b border-slate-700/90";
                if (selected && !editing) {
                  const { minR, maxR, minC, maxC } = getSelectionBounds(selection!);
                  if (r === minR) borderClasses += " border-t-2 border-t-cyan-400";
                  if (r === maxR) borderClasses += " border-b-2 border-b-cyan-400";
                  if (c === minC) borderClasses += " border-l-2 border-l-cyan-400";
                  if (c === maxC) borderClasses += " border-r-2 border-r-cyan-400";
                }

                // Get cell background color from styles
                const cellStyle = cellStyles?.get(cellKey(r, c));
                const bgColor = cellStyle?.bgColor;
                // 选中时保持橙色背景，只用边框表示选中
                const finalBgColor = bgColor || (selected ? '#1e3a5f' : '#0f172a');
                const cellTextColor = bgColor ? '#111827' : '#e5e7eb';

                // Determine if we should perform diff word highlighting
                let compareVal: string | undefined = undefined;
                let isOriginal = false;
                if (diffColumns) {
                  if (diffColumns[c] !== undefined) {
                    const correctedCol = diffColumns[c];
                    compareVal = data[r]?.[correctedCol];
                    isOriginal = true;
                  } else {
                    const originalColStr = Object.keys(diffColumns).find(k => diffColumns[Number(k)] === c);
                    if (originalColStr !== undefined) {
                      const originalCol = Number(originalColStr);
                      compareVal = data[r]?.[originalCol];
                      isOriginal = false;
                    }
                  }
                }

                return (
                  <div
                    key={`${r}-${c}`}
                    className={`
                      flex-shrink-0 relative text-sm
                      ${borderClasses}
                    `}
                    style={
                      autoRowHeight
                        ? {
                            width: colWidths[c] || DEFAULT_COL_WIDTH,
                            minWidth: 60,
                            minHeight: rowHeights[r] || DEFAULT_ROW_HEIGHT,
                            height: 'auto',
                            backgroundColor: finalBgColor
                          }
                        : {
                            width: colWidths[c] || DEFAULT_COL_WIDTH,
                            minWidth: 60,
                            height: rowHeights[r] || DEFAULT_ROW_HEIGHT,
                            minHeight: 22,
                            backgroundColor: finalBgColor
                          }
                    }
                    onMouseDown={(e) => handleMouseDown(r, c, e)}
                    onMouseEnter={() => handleMouseEnter(r, c)}
                    onDoubleClick={() => handleDoubleClick(r, c)}
                  >
                    {editing ? (
                      <textarea
                        ref={editorRef}
                        autoFocus
                        onFocus={(e) => e.target.select()}
                        className="absolute left-0 top-0 resize-none p-2 text-sm text-slate-100 bg-slate-900 focus:outline-none z-50 border-2 border-cyan-400 shadow-xl rounded"
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
                      <div
                        className={
                          autoRowHeight
                            ? "w-full px-2 py-1 pointer-events-none"
                            : "w-full h-full px-2 py-1 overflow-hidden pointer-events-none"
                        }
                        style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-word', color: cellTextColor }}
                      >
                        {renderDiffContent(cellValue, isOriginal, compareVal)}
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
