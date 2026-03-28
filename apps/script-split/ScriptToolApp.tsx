
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
  Hash,
  Zap,
  Sparkles,
  LayoutGrid,
  Eraser
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
import type { GoogleGenAI } from '@google/genai';

interface ScriptToolAppProps {
  getAiInstance?: () => GoogleGenAI | null;
  textModel?: string;
}

const LOCAL_MODEL_KEY = 'script_tool_local_model';
const INHERIT_VALUE = '__global__';

const MODEL_OPTIONS = [
  { value: INHERIT_VALUE, label: '继承全局设置' },
  { value: 'gemini-2.5-flash', label: '⚡ gemini-2.5-flash (GA)' },
  { value: 'gemini-2.5-flash-lite', label: '⚡ gemini-2.5-flash-lite (GA·最快)' },
  { value: 'gemini-2.5-pro', label: '🧠 gemini-2.5-pro (GA·强推理)' },
  { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (Preview)' },
  { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview (Preview·最新)' },
];

// Default grid size
const DEFAULT_ROWS = 10;
const DEFAULT_COLS = 20;

function ScriptToolApp({ getAiInstance, textModel = 'gemini-3-flash-preview' }: ScriptToolAppProps) {
  // 本地模型选择（默认继承全局）
  const [localModel, setLocalModel] = useState<string>(() => {
    try { return localStorage.getItem(LOCAL_MODEL_KEY) || INHERIT_VALUE; } catch { return INHERIT_VALUE; }
  });
  const effectiveModel = localModel === INHERIT_VALUE ? textModel : localModel;
  const [gridData, setGridData] = useState<GridData>([]);
  const [selection, setSelection] = useState<GridSelection | null>(null);
  const [forceSelection, setForceSelection] = useState<GridSelection | null>(null); // 用于外部触发选区
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [clearSource, setClearSource] = useState(false); // 默认保留原文（开关关 = 保留，开关开 = 删除）
  const [gridStyles, setGridStyles] = useState<GridStyles>(new Map()); // 单元格样式（橙色标记）
  const [showPrefixModal, setShowPrefixModal] = useState(false); // 自定义前缀弹窗
  const [customPrefix, setCustomPrefix] = useState('prompt'); // 自定义前缀内容
  const [copiedSelection, setCopiedSelection] = useState(false);
  const [aiSplitting, setAiSplitting] = useState(false);

  // AI 智能拆分：用 Gemini 识别标题，substring 截取原文保证零修改
  const handleAiSplit = async () => {
    if (!selection) {
      setStatusMsg('请先用鼠标框选要处理的单元格区域');
      return;
    }
    if (!getAiInstance) {
      setStatusMsg('AI 功能需要配置 API Key');
      return;
    }
    const ai = getAiInstance();
    if (!ai) {
      setStatusMsg('请先在设置中配置 API Key');
      return;
    }

    const minR = Math.min(selection.start.row, selection.end.row);
    const maxR = Math.max(selection.start.row, selection.end.row);
    const minC = Math.min(selection.start.col, selection.end.col);
    const maxC = Math.max(selection.start.col, selection.end.col);

    // Collect non-empty cells
    const cells: { row: number; col: number; text: string }[] = [];
    for (let c = minC; c <= maxC; c++) {
      for (let r = minR; r <= maxR; r++) {
        const val = gridData[r]?.[c] || '';
        if (val.trim()) cells.push({ row: r, col: c, text: val });
      }
    }
    if (cells.length === 0) {
      setStatusMsg('选区内没有内容');
      return;
    }

    setAiSplitting(true);

    try {
      const BATCH_SIZE = 20;
      const newGrid = gridData.map(row => [...row]);
      const updatedCols: number[] = [];
      let processedCount = 0;

      for (let batchStart = 0; batchStart < cells.length; batchStart += BATCH_SIZE) {
        const batch = cells.slice(batchStart, batchStart + BATCH_SIZE);
        setStatusMsg(`AI 正在分析... (${processedCount}/${cells.length})`);

        const textsJson = batch.map((c, i) => `[${i}] ${c.text.substring(0, 500)}`).join('\n---\n');
        const prompt = `You are a title extractor for prayer/inspirational social media posts. For each numbered text, extract ONLY the short hook/title at the very beginning.

CRITICAL RULES:
- The title is the SHORTEST possible hook, headline, greeting, or attention-grabber at the start
- Prayer greetings like "Heavenly Father", "Dear God", "Dear Lord", "Father" are titles BY THEMSELVES — do NOT include the rest of the sentence
- ALL CAPS imperative phrases like "DON'T SKIP", "READ THIS", "STOP SCROLLING" are titles BY THEMSELVES
- Numbered list headers like "6 HEART-WARMING PRAYERS" end BEFORE the colon/number
- For regular sentences, use the first sentence (up to the first period)
- Return ONLY the EXACT characters from the original text, do NOT modify anything
- Titles should be SHORT — usually 2-10 words maximum

EXAMPLES (input → expected title):
- "DON'T SKIP PSALM 46:5: "God is within her..."" → "DON'T SKIP"
- "6 HEART-WARMING PRAYERS: 1. Dear Lord, please help me grow..." → "6 HEART-WARMING PRAYERS"
- "Heavenly Father, I come to you today trusting in your love..." → "Heavenly Father"
- "PRAYER AGAINST EVIL. Dear Heavenly Father, today I come before You..." → "PRAYER AGAINST EVIL."
- "God led you to read this. Sometimes God has to break you..." → "God led you to read this."
- "Father, thank you for waking me up this morning. Before I do anything..." → "Father, thank you for waking me up this morning."
- "BEFORE YOU GO ANY FURTHER, PRAY THIS PRAYER TO GOD. See Romans 8:28..." → "BEFORE YOU GO ANY FURTHER, PRAY THIS PRAYER TO GOD."
- "Before you start your day, you must say these 3 things to God: 1. Thank You..." → "Before you start your day, you must say these 3 things to God"

Texts:
${textsJson}

Return ONLY a JSON array of title strings: ["title1", "title2", ...]`;

        const response = await ai.models.generateContent({
          model: effectiveModel,
          contents: prompt,
        });

        const resultText = (response as any).text || '';
        const jsonMatch = resultText.match(/\[[\s\S]*\]/);
        if (!jsonMatch) throw new Error(`AI 返回格式异常 (批次 ${Math.floor(batchStart / BATCH_SIZE) + 1})`);

        const titles: string[] = JSON.parse(jsonMatch[0]);

        for (let i = 0; i < batch.length && i < titles.length; i++) {
          const cell = batch[i];
          const aiTitle = titles[i];
          const originalText = cell.text;

          const titleIdx = originalText.indexOf(aiTitle);
          let title: string;
          let content: string;

          if (titleIdx === 0 && aiTitle.length < originalText.length) {
            let splitPos = aiTitle.length;
            // If a colon follows the title, include it in the title
            const afterTitle = originalText.substring(splitPos);
            const colonMatch = afterTitle.match(/^[\s]*([:：])/);
            if (colonMatch) {
              splitPos += colonMatch[0].length;
            }
            title = originalText.substring(0, splitPos).trim();
            content = originalText.substring(splitPos).trim();
          } else {
            const lowerIdx = originalText.toLowerCase().indexOf(aiTitle.toLowerCase());
            if (lowerIdx === 0 && aiTitle.length < originalText.length) {
              let splitPos = aiTitle.length;
              // If a colon follows the title, include it in the title
              const afterTitle = originalText.substring(splitPos);
              const colonMatch = afterTitle.match(/^[\s]*([:：])/);
              if (colonMatch) {
                splitPos += colonMatch[0].length;
              }
              title = originalText.substring(0, splitPos).trim();
              content = originalText.substring(splitPos).trim();
            } else {
              const periodMatch = originalText.match(/^(.+?[.!?])\s+(.+)$/s);
              if (periodMatch) {
                title = periodMatch[1].trim();
                content = periodMatch[2].trim();
              } else {
                title = originalText;
                content = '';
              }
            }
          }

          const srcCol = cell.col;
          while (newGrid[cell.row].length <= srcCol + 2) newGrid[cell.row].push('');
          newGrid[cell.row][srcCol + 1] = title;
          newGrid[cell.row][srcCol + 2] = content;
          if (!updatedCols.includes(srcCol + 1)) updatedCols.push(srcCol + 1);
          if (!updatedCols.includes(srcCol + 2)) updatedCols.push(srcCol + 2);
        }

        processedCount += batch.length;
        // Update grid progressively so user can see results appearing
        setGridData(newGrid.map(row => [...row]));
      }

      setGridData(newGrid);

      // Mark source columns orange
      if (!clearSource) {
        const newStyles = new Map(gridStyles);
        for (const cell of cells) {
          newStyles.set(cellKey(cell.row, cell.col), { bgColor: '#FFA500' });
        }
        setGridStyles(newStyles);
      }

      const colsStr = updatedCols.map(c => colToLetter(c)).join(', ');
      setStatusMsg(`AI 拆分完成！已处理 ${cells.length} 个单元格，结果在列: ${colsStr}`);
    } catch (err: any) {
      setStatusMsg(`AI 拆分失败: ${err.message || '未知错误'}`);
    } finally {
      setAiSplitting(false);
    }
  };

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
    if ((tool === ToolType.SplitThree || tool === ToolType.SplitTwo || tool === ToolType.SmartSplit) && !clearSource) {
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
        if (col <= -3000 && col > -4000) {
          totalAdded = -(col + 3000);
        }
      }
      const prefixUsed = prefix || 'prompt';
      toolMsg = `已为 ${totalAdded} 个单元格添加 ${prefixUsed}- 前缀`;
    } else if (tool === ToolType.MultiPanelPrompt) {
      // Parse panel count from updatedCols
      let panelCount = 0;
      for (const col of updatedCols) {
        if (col <= -4000) {
          panelCount = -(col + 4000);
        }
      }
      const colsStr = updatedCols.filter(c => c >= 0).map(c => colToLetter(c)).join(', ');
      toolMsg = panelCount > 0
        ? `已生成 ${panelCount} 画面分割图提示词，结果在列: ${colsStr}`
        : `选区内没有找到内容`;
    } else if (tool === ToolType.CleanTails) {
      let cleanedCount = 0;
      for (const col of updatedCols) {
        if (col <= -5000 && col > -6000) {
          cleanedCount = -(col + 5000);
        }
      }
      toolMsg = cleanedCount > 0
        ? `已清理 ${cleanedCount} 个单元格的尾部标签/水印`
        : `选区内没有发现需要清理的尾部标签/水印`;
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

  const getContentBounds = (
    minR: number,
    maxR: number,
    minC: number,
    maxC: number
  ): { minR: number; maxR: number; minC: number; maxC: number } | null => {
    let found = false;
    let contentMinR = maxR;
    let contentMaxR = minR;
    let contentMinC = maxC;
    let contentMaxC = minC;

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (gridData[r]?.[c]?.trim()) {
          found = true;
          contentMinR = Math.min(contentMinR, r);
          contentMaxR = Math.max(contentMaxR, r);
          contentMinC = Math.min(contentMinC, c);
          contentMaxC = Math.max(contentMaxC, c);
        }
      }
    }

    if (!found) return null;
    return { minR: contentMinR, maxR: contentMaxR, minC: contentMinC, maxC: contentMaxC };
  };

  const copyRange = async (
    range: { minR: number; maxR: number; minC: number; maxC: number } | null,
    mode: 'all' | 'selection'
  ) => {
    if (!range) {
      setStatusMsg(mode === 'all' ? '没有可复制的内容' : '选区内没有可复制的内容');
      return;
    }

    const subGrid: GridData = [];
    for (let r = range.minR; r <= range.maxR; r++) {
      const row: string[] = [];
      for (let c = range.minC; c <= range.maxC; c++) {
        row.push(gridData[r]?.[c] || '');
      }
      subGrid.push(row);
    }

    const text = formatForClipboard(subGrid);
    const html = buildGoogleSheetsHtml(subGrid, {
      styles: gridStyles,
      rowOffset: range.minR,
      colOffset: range.minC,
      includeEmptyRows: false
    });

    const result = await copyToClipboard(text, html);
    if (result === 'rich') {
      if (mode === 'all') {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        setCopiedSelection(true);
        setTimeout(() => setCopiedSelection(false), 2000);
      }
      setStatusMsg(`已复制内容: ${colToLetter(range.minC)}${range.minR + 1}:${colToLetter(range.maxC)}${range.maxR + 1}`);
      return;
    }

    if (result === 'text') {
      if (mode === 'all') {
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
      } else {
        setCopiedSelection(true);
        setTimeout(() => setCopiedSelection(false), 2000);
      }
      setStatusMsg(`已复制（纯文本）: ${colToLetter(range.minC)}${range.minR + 1}:${colToLetter(range.maxC)}${range.maxR + 1}`);
      return;
    }

    setStatusMsg('复制失败');
  };

  const handleCopyAll = async () => {
    const maxR = Math.max(0, gridData.length - 1);
    const maxC = Math.max(0, ...gridData.map(row => Math.max(0, (row?.length || 0) - 1)));
    const contentBounds = getContentBounds(0, maxR, 0, maxC);
    await copyRange(contentBounds, 'all');
  };

  const handleCopySelection = async () => {
    if (!selection) {
      setStatusMsg('请先框选要复制的区域');
      return;
    }
    const minR = Math.min(selection.start.row, selection.end.row);
    const maxR = Math.max(selection.start.row, selection.end.row);
    const minC = Math.min(selection.start.col, selection.end.col);
    const maxC = Math.max(selection.start.col, selection.end.col);
    const contentBounds = getContentBounds(minR, maxR, minC, maxC);
    await copyRange(contentBounds, 'selection');
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
            <Button
              variant="primary"
              onClick={handleCopySelection}
              disabled={!selection}
              className="bg-emerald-600 hover:bg-emerald-700 text-white border-transparent shadow-sm text-xs whitespace-nowrap"
            >
              {copiedSelection ? <Check className="w-4 h-4 mr-1" /> : <Copy className="w-4 h-4 mr-1" />}
              {copiedSelection ? '已复制' : '复制选中'}
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
                icon={<Zap className="w-4 h-4" />}
                label="半智能拆分"
                tooltip="半智能拆分标题：优先换行 → 冒号 → 祈祷关键词(Dear God等) → 英文句号"
                onClick={() => handleProcess(ToolType.SmartSplit)}
                disabled={!selection}
              />
              <ToolButton
                icon={<Sparkles className="w-4 h-4" />}
                label={aiSplitting ? 'AI 分析中...' : '🤖 AI 拆分'}
                tooltip="AI 智能识别标题，100%保留原文不修改（需要 API Key）"
                onClick={handleAiSplit}
                disabled={!selection || aiSplitting || !getAiInstance}
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
                icon={<LayoutGrid className="w-4 h-4" />}
                label="多画面提示词"
                tooltip="将每个单元格内容生成多画面分割图描述格式（画面1、画面2...）"
                onClick={() => handleProcess(ToolType.MultiPanelPrompt)}
                disabled={!selection}
              />
              <ToolButton
                icon={<Eraser className="w-4 h-4" />}
                label="清理尾部"
                tooltip="自动清理结尾的 @某人 标签或 Veo 等水印单词"
                onClick={() => handleProcess(ToolType.CleanTails)}
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
                data-tip={clearSource ? '拆分后删除原始文案' : '拆分后保留原始文案（默认）'}
                className={`tooltip-bottom relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${clearSource ? 'bg-red-500' : 'bg-slate-300'}`}
              >
                <span
                  className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${clearSource ? 'switch-on' : 'switch-off'}`}
                />
              </button>
            </div>

            {/* AI 模型选择 */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-slate-500">AI模型:</span>
              <select
                value={localModel}
                onChange={e => {
                  const v = e.target.value;
                  setLocalModel(v);
                  try { localStorage.setItem(LOCAL_MODEL_KEY, v); } catch {}
                }}
                className="text-xs border border-slate-300 rounded px-1 py-0.5 bg-white text-slate-700"
                style={{ maxWidth: '180px' }}
              >
                {MODEL_OPTIONS.map(o => (
                  <option key={o.value} value={o.value}>
                    {o.value === INHERIT_VALUE ? `${o.label} (${textModel})` : o.label}
                  </option>
                ))}
              </select>
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
        <div className="prefix-modal-overlay" onClick={() => setShowPrefixModal(false)}>
          <div className="prefix-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="prefix-modal-title">添加序号前缀</h3>
            <p className="prefix-modal-desc">
              输入要添加的前缀内容。例如输入 "prompt"，将生成 prompt-1、prompt-2...
            </p>
            <input
              type="text"
              value={customPrefix}
              onChange={(e) => setCustomPrefix(e.target.value)}
              placeholder="输入前缀，如: prompt, step, item"
              className="prefix-modal-input"
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customPrefix.trim()) {
                  handleConfirmPrefix();
                }
              }}
              autoFocus
            />
            <div className="prefix-modal-actions">
              <button
                onClick={() => setShowPrefixModal(false)}
                className="prefix-modal-btn-cancel"
              >
                取消
              </button>
              <button
                onClick={handleConfirmPrefix}
                disabled={!customPrefix.trim()}
                className={`prefix-modal-btn-confirm ${!customPrefix.trim() ? 'disabled' : ''}`}
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
    data-tip={tooltip || label}
    className={`
      tooltip-bottom flex items-center gap-2 px-3 py-2 transition-colors text-xs font-medium whitespace-nowrap
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
