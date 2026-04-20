/**
 * DataPipelinePanel — 智能代理
 * 四阶段彩色数据流水线。全局主题自适应（暗色/亮色/护眼）。
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
  memo,
} from 'react';
import { tsvEscapeCell } from '../utils/tsvEscape';
import { createPortal } from 'react-dom';
import {
  Trash2,
  Sparkles,
  Copy,
  ClipboardPaste,
  ChevronDown,
  ChevronUp,
  Plus,
  X,
  Loader2,
  AlertCircle,
  CheckCircle2,
  RotateCcw,
  Settings2,
  Eye,
  EyeOff,
  FileDown,
  Zap,
  Save,
  FolderOpen,
  Eraser,
  AlertTriangle,
} from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import * as XLSX from 'xlsx';
import { readWorkbookFromHtml, extractImageFromFormula, fetchImageAsBase64 } from '../utils/parser';
import type { SheetData } from '../types';
import { AgentRegistry, getAgentById } from '../agents';
import { ClassifyConfigPanel } from '../../ai-copy-deduplicator/services/ClassifyConfigPanel';
import './DataPipelinePanel.css';

// ─────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────
export type RowStatus = 'idle' | 'processing' | 'done' | 'error' | 'deduped';

export interface PipelineRow {
  id: string;
  raw: Record<string, string>;
  ai: Record<string, string>;
  status: RowStatus;
  errorMsg?: string;
  isDedupRemoved: boolean;
  dedupKey?: string;
  aiLogs?: { time: string, phase: string, request: string, response: string, runtimeMs: number }[];
}

export interface AiInstruction {
  id: string;
  name: string;
  prompt: string;         // Used for basic prompt mode
  outputColumn: string;   // Used for basic prompt mode
  sourceColumn: string;   // Column whose data is fed to AI as input
  // -- Agent Mode Support --
  agentId?: string;       // If set, this instruction invokes a specialized Agent (not a simple prompt)
  agentConfig?: any;      // Arbitrary config for the agent
}

export interface PipelineConfig {
  rawColumns: string[];
  dedupColumns: string[];
  dedupKeep: 'first' | 'last';
  dedupPhaseMode: 'exact' | 'semantic';
  semanticDedupConfig: Record<string, any>;
  aiInstructions: AiInstruction[];
  batchSize: number;
  concurrency: number;
  maxRetries: number;
  mergeInstructions: boolean;
}

/** Preset: a saved snapshot of config (minus rawColumns, which depend on data) */
interface PipelinePreset {
  id: string;
  name: string;
  dedupColumns: string[];
  dedupKeep: 'first' | 'last';
  dedupPhaseMode: 'exact' | 'semantic';
  semanticDedupConfig: Record<string, any>;
  aiInstructions: AiInstruction[];
  batchSize: number;
  concurrency: number;
  maxRetries: number;
  mergeInstructions: boolean;
}

const DEFAULT_CONFIG: PipelineConfig = {
  rawColumns: ['原文'],
  dedupColumns: ['原文'],
  dedupKeep: 'first',
  dedupPhaseMode: 'exact',
  semanticDedupConfig: {},
  aiInstructions: [],
  batchSize: 10,
  concurrency: 3,
  maxRetries: 2,
  mergeInstructions: true,
};

const STORAGE_KEY = 'data_pipeline_state';
const PRESET_STORAGE_KEY = 'data_pipeline_presets';
const PROMPT_PRESET_KEY = 'data_pipeline_prompt_presets';

/** Reusable prompt template */
interface PromptPreset {
  id: string;
  name: string;
  prompt: string;
}

// ─────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────
function uuid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function parseTsv(text: string): string[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== '')
    .map((line) => line.split('\t'));
}

/** Extract headers + rows from a Workbook (first sheet) */
function workbookToGrid(wb: XLSX.WorkBook): { headers: string[]; dataRows: string[][] } {
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return { headers: [], dataRows: [] };
  const sheet = wb.Sheets[sheetName];
  const aoa: string[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' }) as string[][];
  if (aoa.length === 0) return { headers: [], dataRows: [] };
  const headers = aoa[0].map((h) => String(h ?? '').trim());
  const dataRows = aoa.slice(1).filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  return { headers, dataRows };
}

function buildBatchPrompt(
  instructions: AiInstruction[],
  rows: PipelineRow[],
  rawColumns: string[]
): string {
  const rowsJson = rows.map((row, i) => {
    const cells: Record<string, string> = {};
    rawColumns.forEach((col) => { cells[col] = row.raw[col] ?? ''; });
    Object.assign(cells, row.ai);
    return { __id: i, ...cells };
  });

  const outputSpec: string[] = [];
  const instructionList = instructions
    .map((inst, i) => {
      let promptText = inst.prompt;
      let outCols = inst.outputColumn ? [inst.outputColumn] : [];
      if (inst.agentId) {
         const agent = getAgentById(inst.agentId);
         if (agent) {
             outCols = agent.predictOutputColumns(inst.agentConfig || {}, inst.sourceColumn, inst.outputColumn);
             if (agent.compileMergedInstruction) {
                 promptText = agent.compileMergedInstruction(inst.agentConfig || {}, inst.sourceColumn, outCols);
             }
         }
      }
      outCols.forEach(col => {
         outputSpec.push(`"${col}": "<生成的处理结果>"`);
      });
      return `指令${i + 1}【${inst.name}】处理列「${inst.sourceColumn}」：\n${promptText}`;
    })
    .join('\n\n');

  return `你是一个专业的数据处理助手。请对以下 ${rows.length} 行数据依次执行所有指令，严格按照 JSON 数组格式返回结果，不要输出任何多余内容。要求：如果后续指令依赖前面指令生成的列名，你必须在心中推算前一步的生成结果，然后继续执行。

## 数据（JSON 数组，每项含 __id 字段作为行号）
${JSON.stringify(rowsJson, null, 2)}

## 指令列表
${instructionList}

## 返回格式（严格 JSON 数组，与输入行数相同，每项含 __id + 各输出列）
[
  { "__id": 0, ${outputSpec.join(', ')} },
  ...
]`;
}

function buildSinglePrompt(
  instruction: AiInstruction,
  rows: PipelineRow[],
  rawColumns: string[]
): string {
  const rowsJson = rows.map((row, i) => {
    const cells: Record<string, string> = {};
    rawColumns.forEach((col) => { cells[col] = row.raw[col] ?? ''; });
    Object.assign(cells, row.ai);
    return { __id: i, ...cells };
  });

  return `你是一个专业的数据处理助手。请对以下 ${rows.length} 行数据执行指令，严格按照 JSON 数组格式返回结果，不要输出任何多余内容。

## 数据（JSON 数组，每项含 __id 字段作为行号）
${JSON.stringify(rowsJson, null, 2)}

## 指令【${instruction.name}】
处理列「${instruction.sourceColumn}」中的数据，执行以下操作：
${instruction.prompt}

## 返回格式（严格 JSON 数组，与输入行数相同）
[
  { "__id": 0, "${instruction.outputColumn}": "<处理结果>" },
  ...
]`;
}

/** Check if column values contain image data (=IMAGE formulas or image URLs) */
function isImageColumn(rows: PipelineRow[], col: string): boolean {
  const sample = rows.slice(0, 10);
  let imageCount = 0;
  for (const row of sample) {
    const val = row.raw[col] ?? '';
    if (!val) continue;
    if (extractImageFromFormula(val)) { imageCount++; continue; }
    if (/^https?:\/\//i.test(val) && (
      /\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?.*)?$/i.test(val) ||
      /gyazo\.com|imgur\.com/i.test(val)
    )) { imageCount++; }
  }
  return imageCount >= 2; // at least 2 of first 10 rows have images
}

/** Build Vision API content parts for a single row with image */
async function buildVisionContent(
  instruction: AiInstruction,
  row: PipelineRow,
  rowIdx: number
): Promise<{ parts: Array<{ text: string } | { inlineData: { mimeType: string; data: string } }>; rowIdx: number } | null> {
  const val = row.raw[instruction.sourceColumn] ?? '';
  const imageUrl = extractImageFromFormula(val) ?? (/^https?:\/\//i.test(val) ? val : null);
  if (!imageUrl) return null;

  const base64 = await fetchImageAsBase64(imageUrl);
  if (!base64) return null;

  return {
    rowIdx,
    parts: [
      { inlineData: { mimeType: 'image/jpeg', data: base64 } },
      { text: `## 第 ${rowIdx} 行图片\n\n请根据以下指令处理这张图片:\n${instruction.prompt}\n\n请只返回处理结果文本，不要包含任何 markdown 或多余内容。` }
    ]
  };
}


// ─────────────────────────────────────────────
// Sub-components
// ─────────────────────────────────────────────

function ConfirmButton({
  onClick, icon: Icon, label, confirmLabel = '确认操作？', className, style, title
}: {
  onClick: () => void; icon: any; label?: string; confirmLabel?: string; className?: string; style?: React.CSSProperties; title?: string;
}) {
  const [confirming, setConfirming] = React.useState(false);
  const timeoutRef = React.useRef<any>(null);
  return (
    <button
      className={`${className || ''} ${confirming ? 'confirming' : ''}`}
      style={{ ...style, cursor: confirming ? 'default' : 'pointer', padding: confirming ? '4px 6px' : undefined }}
      onClick={() => {
        if (!confirming) {
          setConfirming(true);
          timeoutRef.current = setTimeout(() => setConfirming(false), 3000);
        }
      }}
      title={title}
    >
      {confirming ? (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span style={{ fontSize: 11, color: 'var(--text-muted-color)' }}>{confirmLabel}</span>
          <div
            onClick={(e) => { e.stopPropagation(); onClick(); setConfirming(false); clearTimeout(timeoutRef.current); }}
            style={{ background: '#e05252', color: '#fff', padding: '2px 6px', borderRadius: 4, fontSize: 11, cursor: 'pointer', fontWeight: 600 }}
          >确认</div>
          <div
            onClick={(e) => { e.stopPropagation(); setConfirming(false); clearTimeout(timeoutRef.current); }}
            style={{ background: 'var(--control-bg-color)', color: 'var(--text-color)', padding: '2px 6px', borderRadius: 4, fontSize: 11, border: '1px solid var(--border-color)', cursor: 'pointer' }}
          >取消</div>
        </div>
      ) : (
        <>
          <Icon size={13} style={{ marginRight: label ? 4 : 0 }} />
          {label}
        </>
      )}
    </button>
  );
}

/** Render cell value: detect =IMAGE() formulas and image URLs, show thumbnails */
function CellContent({ value }: { value: string | undefined }) {
  if (!value) return null;
  const imageUrl = extractImageFromFormula(value);
  if (imageUrl) {
    return (
      <a href={imageUrl} target="_blank" rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={imageUrl}
        style={{ display: 'inline-block' }}>
        <img
          src={`https://images.weserv.nl/?url=${encodeURIComponent(imageUrl)}&w=64&h=64&fit=cover`}
          alt=""
          loading="lazy"
          style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border-color)' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      </a>
    );
  }
  // Direct image URL (Gyazo, imgur, etc.)
  if (/^https?:\/\//i.test(value) && /\.(png|jpg|jpeg|gif|webp|svg|bmp)(\?.*)?$/i.test(value) ||
      /^https?:\/\/(i\.)?(gyazo|imgur)\.com\//i.test(value)) {
    return (
      <a href={value} target="_blank" rel="noopener noreferrer"
        onClick={(e) => e.stopPropagation()}
        title={value}
        style={{ display: 'inline-block' }}>
        <img
          src={`https://images.weserv.nl/?url=${encodeURIComponent(value)}&w=64&h=64&fit=cover`}
          alt=""
          loading="lazy"
          style={{ width: 32, height: 32, objectFit: 'cover', borderRadius: 4, border: '1px solid var(--border-color)' }}
          onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
        />
      </a>
    );
  }
  return <>{value}</>;
}
function InstructionEditor({
  inst,
  rawColumns,
  aiOutputCols,
  promptPresets,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
  onSavePromptPreset,
  onLoadPromptPreset,
  onDeletePromptPreset,
}: {
  inst: AiInstruction;
  rawColumns: string[];
  aiOutputCols: string[];
  promptPresets: PromptPreset[];
  onChange: (updated: AiInstruction) => void;
  onDelete: () => void;
  onMoveUp?: () => void;
  onMoveDown?: () => void;
  onSavePromptPreset: (name: string, prompt: string) => void;
  onLoadPromptPreset: (preset: PromptPreset) => void;
  onDeletePromptPreset: (id: string) => void;
}) {
  const [customCol, setCustomCol] = useState('');
  const [showCustomCol, setShowCustomCol] = useState(false);
  const [showPromptPresets, setShowPromptPresets] = useState(false);
  const [showAgentPicker, setShowAgentPicker] = useState(false);
  const [showExpandedEdit, setShowExpandedEdit] = useState(false);
  const [presetSaveInputVisible, setPresetSaveInputVisible] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const presetBtnRef = useRef<HTMLButtonElement>(null);
  const switchAgentBtnRef = useRef<HTMLButtonElement>(null);
  const allSourceCols = [...rawColumns, ...aiOutputCols];
  const config = inst.agentConfig || {};
  const agent = inst.agentId ? getAgentById(inst.agentId) : undefined;
  
  const existingOutputCols = [...new Set([...rawColumns, ...aiOutputCols, inst.outputColumn].filter(Boolean))];

  const globalPresetGroups = useMemo(() => {
    const groups: Array<{ label: string; icon: string; items: Array<{ name: string; prompt: string }> }> = [];
    try {
      // 1. AI 图片识别预设 (ai-classifier-presets) — {id, name, text}
      const classifierRaw = localStorage.getItem('ai-classifier-presets');
      if (classifierRaw) {
        const parsed = JSON.parse(classifierRaw) as Array<{ name: string; text: string }>;
        const items = parsed.filter(p => p.text?.trim()).map(p => ({ name: p.name, prompt: p.text }));
        if (items.length > 0) groups.push({ label: 'AI 图片识别', icon: '🖼️', items });
      }
      // 2. 画面扩展预设 (scene_brainstorm_presets) — {id, name, prompt}
      const sceneRaw = localStorage.getItem('scene_brainstorm_presets');
      if (sceneRaw) {
        const parsed = JSON.parse(sceneRaw) as Array<{ name: string; prompt: string }>;
        const items = parsed.filter(p => p.prompt?.trim()).map(p => ({ name: p.name, prompt: p.prompt }));
        if (items.length > 0) groups.push({ label: '画面扩展', icon: '🎬', items });
      }
      // 3. Skill Builder (skill_builder_sessions) — {title, skill: {name, instructions}}
      const skillRaw = localStorage.getItem('skill_builder_sessions');
      if (skillRaw) {
        const sessions = JSON.parse(skillRaw) as Array<{ title: string; skill: { name: string; instructions: string } }>;
        const items = sessions.filter(s => s.skill?.instructions?.trim()).map(s => ({ name: s.skill.name || s.title, prompt: s.skill.instructions }));
        if (items.length > 0) groups.push({ label: 'Skill Builder', icon: '🧠', items });
      }
      // 4. Hook Script 预设 (hook_script_presets) — {id, name, prompt}
      const hookRaw = localStorage.getItem('hook_script_presets');
      if (hookRaw) {
        const parsed = JSON.parse(hookRaw) as Array<{ name: string; prompt: string }>;
        const items = parsed.filter(p => p.prompt?.trim()).map(p => ({ name: p.name, prompt: p.prompt }));
        if (items.length > 0) groups.push({ label: 'Hook Script', icon: '📝', items });
      }
      // 5. 祷告词改写预设 (prayer_rewrite_presets_v1) — {name, content}
      const prayerRaw = localStorage.getItem('prayer_rewrite_presets_v1');
      if (prayerRaw) {
        const parsed = JSON.parse(prayerRaw) as Array<{ name: string; content: string }>;
        const items = parsed.filter(p => p.content?.trim()).map(p => ({ name: p.name, prompt: p.content }));
        if (items.length > 0) groups.push({ label: '提示词工具', icon: '🪶', items });
      }
      // 6. API 生图预设 (api_gen_instruction_presets) — {name, content}
      const apiGenRaw = localStorage.getItem('api_gen_instruction_presets');
      if (apiGenRaw) {
        const parsed = JSON.parse(apiGenRaw) as Array<{ name: string; content: string }>;
        const items = parsed.filter(p => p.content?.trim()).map(p => ({ name: p.name, prompt: p.content }));
        if (items.length > 0) groups.push({ label: 'API 生图', icon: '🪄', items });
      }
    } catch { /* ignore parse errors */ }
    return groups;
  }, [showPromptPresets]); // re-read when dropdown opens

  return (
    <div className="dp-inst-card" style={{ padding: '6px 8px' }}>
      {/* Single row: Source → Output | Prompt | Delete */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        <select className="dp-input" style={{ width: 110, flexShrink: 0, cursor: 'pointer', fontSize: 12, fontWeight: aiOutputCols.includes(inst.sourceColumn) ? 600 : 'normal', color: aiOutputCols.includes(inst.sourceColumn) ? 'var(--brand-color)' : 'var(--text-color)' }}
          value={inst.sourceColumn}
          onChange={(e) => {
            const newSrc = e.target.value;
            const autoOut = newSrc ? `${newSrc}_ai处理` : inst.outputColumn;
            // Auto-rename output if it still follows the default pattern
            const isDefaultPattern = /^(AI处理_\d+|.*_ai处理)$/.test(inst.outputColumn);
            onChange({ ...inst, sourceColumn: newSrc, ...(isDefaultPattern ? { outputColumn: autoOut } : {}) });
          }}
          title="在此选择上一阶段的数据列作为输入">
          {!allSourceCols.includes(inst.sourceColumn) && inst.sourceColumn && <option value={inst.sourceColumn}>{inst.sourceColumn}</option>}
          <optgroup label="基础表格列">
            {rawColumns.map((col) => <option key={col} value={col}>{col}</option>)}
          </optgroup>
          {aiOutputCols.length > 0 && (
            <optgroup label="前置 AI 结果 (动态列)">
              {aiOutputCols.map((col) => <option key={col} value={col}>✨ {col}</option>)}
            </optgroup>
          )}
        </select>

        <span style={{ color: 'var(--text-muted-color)', fontSize: 11, flexShrink: 0 }}>→</span>

        {agent ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2, flexShrink: 0 }}>
               <input className="dp-input" style={{ width: 100, fontSize: 11 }}
                 value={inst.outputColumn} 
                 onChange={e => onChange({...inst, outputColumn: e.target.value})} 
                 placeholder="默认前缀" 
                 title="设置列名前缀，下方将动态生成列名" 
               />
               <div style={{ fontSize: 9, color: 'var(--brand-color)', fontWeight: 500, opacity: 0.8, maxWidth: 100, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }} title={agent.predictOutputColumns(inst.agentConfig || {}, inst.sourceColumn, inst.outputColumn).join(', ')}>
                  {agent.predictOutputColumns(inst.agentConfig || {}, inst.sourceColumn, inst.outputColumn).join(', ')}
               </div>
            </div>
        ) : showCustomCol ? (
          <div style={{ display: 'flex', gap: 2, width: 90, flexShrink: 0 }}>
            <input className="dp-input" style={{ flex: 1, minWidth: 0, fontSize: 11 }}
              value={customCol} onChange={(e) => setCustomCol(e.target.value)} placeholder="新列名"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === 'Enter' && customCol.trim()) { onChange({ ...inst, outputColumn: customCol.trim() }); setShowCustomCol(false); setCustomCol(''); }
                if (e.key === 'Escape') { setShowCustomCol(false); setCustomCol(''); }
              }} />
            <button className="dp-btn" style={{ padding: '1px 4px', fontSize: 10 }}
              onClick={() => { if (customCol.trim()) { onChange({ ...inst, outputColumn: customCol.trim() }); setShowCustomCol(false); setCustomCol(''); } }}>✓</button>
          </div>
        ) : (
          <select className="dp-input" style={{ width: 100, flexShrink: 0, cursor: 'pointer', fontSize: 11 }}
            value={inst.outputColumn}
            onChange={(e) => { if (e.target.value === '__custom__') setShowCustomCol(true); else onChange({ ...inst, outputColumn: e.target.value }); }}
            title="输出到列">
            {!existingOutputCols.includes(inst.outputColumn) && inst.outputColumn && <option value={inst.outputColumn}>{inst.outputColumn}</option>}
            {existingOutputCols.map((col) => <option key={col} value={col}>{col}</option>)}
            <option value="__custom__">＋ 新建列</option>
          </select>
        )}

        {/* Prompt preview OR Agent Button */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
          {agent ? (
            <>
              <button className="dp-btn dp-btn-primary" style={{ width: '100%', fontSize: 11, justifyContent: 'center', paddingRight: 24, flexDirection: 'column', gap: 2, alignItems: 'center' }}
                onClick={() => setShowExpandedEdit(true)}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                  {agent.icon} {agent.name} (点击设置)
                </div>
                {agent.getSummary && inst.agentConfig && Object.keys(inst.agentConfig).length > 0 && (
                  <div style={{ fontSize: 9, opacity: 0.8, fontWeight: 'normal', maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {agent.getSummary(inst.agentConfig)}
                  </div>
                )}
              </button>
              <button ref={switchAgentBtnRef} style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: 'rgba(255,255,255,0.8)', padding: 2 }}
                onClick={(e) => { e.stopPropagation(); setShowAgentPicker(v => !v); }}
                title="更换专业工具">
                <ChevronDown size={12} />
              </button>
              {showAgentPicker && createPortal(
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setShowAgentPicker(false)} />
                  <div style={{
                    position: 'fixed',
                    top: (switchAgentBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                    left: Math.min((switchAgentBtnRef.current?.getBoundingClientRect().right ?? 280) - 200, window.innerWidth - 210),
                    zIndex: 9999,
                    background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                    borderRadius: 8, padding: 8, width: 200, maxHeight: 360, overflowY: 'auto',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  }} onClick={(e) => e.stopPropagation()}>
                    <div style={{ fontSize: 10, color: 'var(--text-muted-color)', fontWeight: 700, marginBottom: 4 }}>更换专业工具 (Agent)</div>
                    {AgentRegistry.map(agt => (
                      <div key={agt.id} style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, marginBottom: 2, background: agt.id === agent.id ? 'var(--primary-color)' : 'var(--control-bg-color)', color: agt.id === agent.id ? 'var(--inverse-text-color)' : 'var(--text-color)' }}
                        onClick={() => { onChange({ ...inst, agentId: agt.id, agentConfig: {} }); setShowAgentPicker(false); }} title={agt.description}>
                        <span>{agt.icon}</span>
                        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
                          <span style={{ fontWeight: 600 }}>{agt.name}</span>
                        </div>
                      </div>
                    ))}
                    <div style={{ height: 1, background: 'var(--border-color)', margin: '4px 0' }}></div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 4, cursor: 'pointer', fontSize: 12, color: 'var(--error-color)' }}
                      onClick={() => { onChange({ ...inst, agentId: undefined, prompt: '', agentConfig: undefined }); setShowAgentPicker(false); }}>
                      <span style={{ marginLeft: 22 }}>返回基础提示词模式</span>
                    </div>
                  </div>
                </>,
                document.body
              )}
            </>
          ) : (
            <>
              <input className="dp-input" style={{ width: '100%', fontSize: 11, paddingRight: 28 }}
                value={inst.prompt}
                onChange={(e) => onChange({ ...inst, prompt: e.target.value })}
                onDoubleClick={() => setShowExpandedEdit(true)}
                placeholder="双击展开编辑 AI 指令..."
                title={inst.prompt || '双击展开编辑'}
              />
              {/* Template button */}
              <button ref={presetBtnRef} style={{ position: 'absolute', right: 2, top: '50%', transform: 'translateY(-50%)',
                background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted-color)', padding: 2 }}
                onClick={() => setShowPromptPresets((v) => !v)}
                title="指令模板">
                <FolderOpen size={12} />
              </button>
              {/* Preset dropdown — rendered via portal to avoid clipping */}
              {showPromptPresets && createPortal(
                <>
                  <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setShowPromptPresets(false)} />
                  <div style={{
                    position: 'fixed',
                    top: (presetBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                    left: Math.min((presetBtnRef.current?.getBoundingClientRect().right ?? 280) - 300, window.innerWidth - 310),
                    zIndex: 9999,
                    background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                    borderRadius: 8, padding: 8, width: 300, maxHeight: 360, overflowY: 'auto',
                    boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                  }} onClick={(e) => e.stopPropagation()}>
                    {/* Local presets */}
                    {promptPresets.length > 0 && (
                      <div style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted-color)', fontWeight: 700, marginBottom: 4 }}>📌 本地模板</div>
                        {promptPresets.map((pp) => (
                          <div key={pp.id} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 11, marginBottom: 2, background: 'var(--control-bg-color)' }}
                            onClick={() => { onChange({ ...inst, prompt: pp.prompt }); setShowPromptPresets(false); }} title={pp.prompt}>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-color)' }}>{pp.name}</span>
                            <button onClick={(e) => { e.stopPropagation(); onDeletePromptPreset(pp.id); }}
                              style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 1, color: 'var(--text-muted-color)' }}><X size={10} /></button>
                          </div>
                        ))}
                      </div>
                    )}
                    {/* Global presets from all app modules */}
                    {globalPresetGroups.map((group, gi) => (
                      <div key={gi} style={{ marginBottom: 6 }}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted-color)', fontWeight: 700, marginBottom: 4 }}>{group.icon} {group.label}</div>
                        {group.items.map((gs, i) => (
                          <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '4px 6px', borderRadius: 4, cursor: 'pointer', fontSize: 11, marginBottom: 2, background: 'var(--control-bg-color)' }}
                            onClick={() => { onChange({ ...inst, prompt: gs.prompt }); setShowPromptPresets(false); }} title={gs.prompt.substring(0, 200)}>
                            <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', color: 'var(--text-color)' }}>{gs.name}</span>
                          </div>
                        ))}
                      </div>
                    ))}
                    {promptPresets.length === 0 && globalPresetGroups.length === 0 && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted-color)', padding: '8px 0', textAlign: 'center' }}>暂无指令模板</div>
                    )}
                    {presetSaveInputVisible ? (
                      <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                        <input
                          className="dp-input"
                          style={{ flex: 1, padding: 4, fontSize: 11 }}
                          value={newPresetName}
                          onChange={(e) => setNewPresetName(e.target.value)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' && newPresetName.trim()) {
                              onSavePromptPreset(newPresetName.trim(), inst.prompt);
                              setPresetSaveInputVisible(false);
                              setShowPromptPresets(false);
                            } else if (e.key === 'Escape') {
                              setPresetSaveInputVisible(false);
                            }
                          }}
                          autoFocus
                        />
                        <button className="dp-btn dp-btn-orange" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => {
                            if (newPresetName.trim()) {
                              onSavePromptPreset(newPresetName.trim(), inst.prompt);
                              setPresetSaveInputVisible(false);
                              setShowPromptPresets(false);
                            }
                        }}>确定</button>
                        <button className="dp-btn" style={{ fontSize: 10, padding: '2px 6px' }} onClick={() => setPresetSaveInputVisible(false)}>取消</button>
                      </div>
                    ) : (
                      <button className="dp-btn dp-btn-orange" style={{ width: '100%', fontSize: 10, marginTop: 4, justifyContent: 'center' }}
                        onClick={() => {
                          if (!inst.prompt.trim()) return;
                          setNewPresetName(inst.name || `模板 ${promptPresets.length + 1}`);
                          setPresetSaveInputVisible(true);
                        }}><Save size={10} /> 保存当前指令为模板</button>
                    )}
                  </div>
                </>,
                document.body
              )}
            </>
          )}
        </div>

        {/* Controls: Up, Down, Delete */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
          {onMoveUp && (
            <button onClick={onMoveUp} style={{ padding: 2, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted-color)' }} title="上移">
              <span style={{ fontSize: 10 }}>▲</span>
            </button>
          )}
          {onMoveDown && (
            <button onClick={onMoveDown} style={{ padding: 2, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted-color)' }} title="下移">
              <span style={{ fontSize: 10 }}>▼</span>
            </button>
          )}
          <button onClick={onDelete}
            style={{ padding: 3, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted-color)' }}
            title="删除指令"><X size={14} /></button>
        </div>
      </div>

      {/* Expanded edit modal (double-click) */}
      {showExpandedEdit && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowExpandedEdit(false)}>
          <div style={{ background: 'var(--surface-color)', borderRadius: 12, padding: 20, width: '80%', maxWidth: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}
            onClick={(e) => e.stopPropagation()}
            onKeyDown={(e) => e.stopPropagation()}
            onKeyUp={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4, background: 'var(--bg-color)', padding: 4, borderRadius: 8 }}>
                <div 
                   onClick={() => onChange({ ...inst, agentId: undefined, prompt: '', agentConfig: undefined })}
                   style={{ 
                     display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500,
                     background: !agent ? 'var(--surface-color)' : 'transparent',
                     boxShadow: !agent ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                     color: !agent ? 'var(--text-color)' : 'var(--text-muted-color)'
                   }}>
                  <Sparkles size={14} style={{ color: !agent ? '#e57c26' : 'currentColor' }} /> 基础指令
                </div>
                {AgentRegistry.map(agt => (
                  <div 
                     key={agt.id}
                     title={agt.description}
                     onClick={() => onChange({ ...inst, agentId: agt.id, agentConfig: {} })}
                     style={{ 
                       display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px', borderRadius: 6, cursor: 'pointer', fontSize: 13, fontWeight: 500,
                       background: agent?.id === agt.id ? 'var(--surface-color)' : 'transparent',
                       boxShadow: agent?.id === agt.id ? '0 2px 8px rgba(0,0,0,0.08)' : 'none',
                       color: agent?.id === agt.id ? 'var(--text-color)' : 'var(--text-muted-color)'
                     }}>
                    {agt.icon} {agt.name}
                  </div>
                ))}
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ fontSize: 11, color: 'var(--text-muted-color)', marginLeft: 8 }}>{inst.sourceColumn} → </span>
                <input 
                  className="dp-input" 
                  style={{ width: 140, padding: 4, height: 26, fontSize: 11, background: 'var(--surface-color)', border: '1px solid var(--border-color)', borderRadius: 4, color: 'var(--text-color)' }}
                  value={inst.outputColumn || ''}
                  onChange={(e) => onChange({ ...inst, outputColumn: e.target.value })}
                  placeholder={agent ? "自定义列名前缀(可选)" : "目标列名"}
                  title={agent ? "留空则使用默认生成的列名。输入内容会作为新列名的开头部分。" : ""}
                />
              </div>
              <div style={{ flex: 1 }} />
              <button className="dp-btn" onClick={() => setShowExpandedEdit(false)}><X size={14} /> 确认并关闭</button>
            </div>
            {agent ? (
              <div style={{ flex: 1, overflowY: 'auto', overflowX: 'hidden', background: 'var(--bg-color)', padding: 20, borderRadius: 10 }}>
                <agent.ConfigComponent 
                  value={inst.agentConfig || {}} 
                  onChange={(agentConfig) => onChange({ ...inst, agentConfig })} 
                />
              </div>
            ) : (
              <textarea className="dp-textarea" style={{ flex: 1, minHeight: 300, fontSize: 13, lineHeight: 1.6 }}
                value={inst.prompt}
                onChange={(e) => onChange({ ...inst, prompt: e.target.value })}
                placeholder="输入 AI 处理指令..."
                autoFocus />
            )}
          </div>
        </div>,
        document.body
      )}
    </div>
  );
}


// ─────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────
interface DataPipelinePanelProps {
  getAiInstance: () => GoogleGenAI;
  modelId?: string;
  /** Main SheetMind data — when provided, allows '从主表导入' */
  data?: SheetData | null;
  isActive?: boolean;
}

const DataPipelinePanel: React.FC<DataPipelinePanelProps> = ({ getAiInstance, modelId = 'gemini-2.0-flash', data: sheetData, isActive = true }) => {
  // ── Config ──────────────────────────────────
  const [config, setConfig] = useState<PipelineConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY + '_config');
      if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return DEFAULT_CONFIG;
  });

  const [showConfig, setShowConfig] = useState(false);
  const [viewLogsFor, setViewLogsFor] = useState<string | null>(null);
  const [showBatchInstModal, setShowBatchInstModal] = useState(false);
  const [batchInstText, setBatchInstText] = useState('');
  const [newColName, setNewColName] = useState('');
  const [showAddColInput, setShowAddColInput] = useState(false);
  const [showDedupPicker, setShowDedupPicker] = useState(false);
  const dedupBtnRef = useRef<HTMLButtonElement>(null);
  const [showAIPicker, setShowAIPicker] = useState(false);
  const aiBtnRef = useRef<HTMLButtonElement>(null);

  const [showAddAgentPicker, setShowAddAgentPicker] = useState(false);
  const addAgentBtnRef = useRef<HTMLButtonElement>(null);

  const [showAddAgentPickerModal, setShowAddAgentPickerModal] = useState(false);
  const addAgentBtnRefModal = useRef<HTMLButtonElement>(null);

  // ── Presets ──
  const [presets, setPresets] = useState<PipelinePreset[]>(() => {
    try {
      const saved = localStorage.getItem(PRESET_STORAGE_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return [];
  });
  const [showPresetMenu, setShowPresetMenu] = useState(false);
  const presetBtnRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    try { localStorage.setItem(PRESET_STORAGE_KEY, JSON.stringify(presets)); } catch { /* ignore */ }
  }, [presets]);

  // ── Prompt Presets (reusable instruction templates) ──
  const [promptPresets, setPromptPresets] = useState<PromptPreset[]>(() => {
    try {
      const saved = localStorage.getItem(PROMPT_PRESET_KEY);
      if (saved) return JSON.parse(saved);
    } catch { /* ignore */ }
    return [];
  });
  useEffect(() => {
    try { localStorage.setItem(PROMPT_PRESET_KEY, JSON.stringify(promptPresets)); } catch { /* ignore */ }
  }, [promptPresets]);

  const savePromptPreset = useCallback((name: string, prompt: string) => {
    setPromptPresets((prev) => [...prev, {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name, prompt,
    }]);
  }, []);
  const deletePromptPreset = useCallback((id: string) => {
    setPromptPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);

  useEffect(() => {
    try { localStorage.setItem(STORAGE_KEY + '_config', JSON.stringify(config)); } catch { /* ignore */ }
  }, [config]);

  // ── Rows ─────────────────────────────────────
  const [rows, setRows] = useState<PipelineRow[]>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY + '_rows');
      if (saved) {
        const parsed: PipelineRow[] = JSON.parse(saved);
        // 自动干预：将重启/奔溃残留的 zombie processing 状态重置为 idle
        return parsed.map(r => r.status === 'processing' ? { ...r, status: 'idle' } : r);
      }
    } catch { /* ignore */ }
    return [];
  });

  const [showDedupAudit, setShowDedupAudit] = useState(false);

  const rowsPersistTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (rowsPersistTimer.current) clearTimeout(rowsPersistTimer.current);
    rowsPersistTimer.current = setTimeout(() => {
      try { localStorage.setItem(STORAGE_KEY + '_rows', JSON.stringify(rows)); } catch { /* ignore */ }
    }, 800);
  }, [rows]);

  // ── Running state ────────────────────────────
  const [isRunningAI, setIsRunningAI] = useState(false);
  const [aiProgress, setAiProgress] = useState<{ current: number, total: number } | null>(null);
  const [runLog, setRunLog] = useState<string[]>([]);
  const abortRef = useRef(false);
  const [copyFeedback, setCopyFeedback] = useState<string | null>(null);

  const log = useCallback((msg: string) => {
    setRunLog((prev) => [...prev.slice(-99), `[${new Date().toLocaleTimeString()}] ${msg}`]);
  }, []);

  // ── Preset helpers (depend on log) ──
  const savePreset = useCallback((name: string) => {
    const preset: PipelinePreset = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      name,
      dedupColumns: config.dedupColumns,
      dedupKeep: config.dedupKeep,
      dedupPhaseMode: config.dedupPhaseMode || 'exact',
      semanticDedupConfig: config.semanticDedupConfig || {},
      aiInstructions: config.aiInstructions,
      batchSize: config.batchSize,
      concurrency: config.concurrency,
      maxRetries: config.maxRetries,
      mergeInstructions: config.mergeInstructions,
    };
    setPresets((prev) => [...prev, preset]);
    log(`💾 预设「${name}」已保存`);
  }, [config, log]);

  const loadPreset = useCallback((preset: PipelinePreset) => {
    setConfig((c) => ({
      ...c,
      dedupColumns: preset.dedupColumns,
      dedupKeep: preset.dedupKeep,
      dedupPhaseMode: preset.dedupPhaseMode || 'exact',
      semanticDedupConfig: preset.semanticDedupConfig || {},
      aiInstructions: preset.aiInstructions,
      batchSize: preset.batchSize,
      concurrency: preset.concurrency,
      maxRetries: preset.maxRetries,
      mergeInstructions: preset.mergeInstructions,
    }));
    setShowPresetMenu(false);
    log(`📦 已加载预设「${preset.name}」`);
  }, [log]);

  const deletePreset = useCallback((id: string) => {
    setPresets((prev) => prev.filter((p) => p.id !== id));
  }, []);


  // ── Import from main SheetMind data ────────
  const loadFromSheetData = useCallback(() => {
    if (!sheetData || !sheetData.rows.length) return;
    const columns = sheetData.columns;
    const newRows: PipelineRow[] = sheetData.rows.map((row) => {
      const raw: Record<string, string> = {};
      columns.forEach((col) => { raw[col] = String(row[col] ?? ''); });
      return { id: uuid(), raw, ai: {}, status: 'idle' as RowStatus, isDedupRemoved: false };
    });
    setConfig((c) => ({ ...c, rawColumns: columns }));
    setRows(newRows);
    log(`✅ 从主表导入 ${newRows.length} 行 × ${columns.length} 列`);
  }, [sheetData, log]);

  // ── Derived ──────────────────────────────────
  const activeRows = useMemo(() => rows.filter((r) => !r.isDedupRemoved), [rows]);
  const dedupedRows = useMemo(() => rows.filter((r) => r.isDedupRemoved), [rows]);
  const aiOutputColumns = useMemo(
    () => {
      const cols = new Set<string>();
      config.aiInstructions.forEach((inst) => {
        if (inst.agentId) {
          const agent = getAgentById(inst.agentId);
          if (agent) {
            agent.predictOutputColumns(inst.agentConfig || {}, inst.sourceColumn, inst.outputColumn).forEach(c => cols.add(c));
          }
        } else if (inst.outputColumn) {
          cols.add(inst.outputColumn);
        }
      });
      return [...cols];
    },
    [config.aiInstructions]
  );
  const allDisplayColumns = useMemo(
    () => [...config.rawColumns, ...aiOutputColumns],
    [config.rawColumns, aiOutputColumns]
  );

  // ── Google-Sheets-like cell interaction ──
  const [focusCell, setFocusCell] = useState<{ rowId: string; col: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; col: string } | null>(null);
  const [expandedCell, setExpandedCell] = useState<{ rowId: string; col: string; value: string; isOutput: boolean } | null>(null);
  const [editValue, setEditValue] = useState('');
  const [selectionAnchor, setSelectionAnchor] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const [selectionEnd, setSelectionEnd] = useState<{ rowIdx: number; colIdx: number } | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const editInputRef = useRef<HTMLTextAreaElement>(null);

  // Get rectangular selection set
  const getSelectionRect = useCallback((): Set<string> => {
    if (!selectionAnchor) {
      return focusCell ? new Set([`${focusCell.rowId}:${focusCell.col}`]) : new Set();
    }
    const end = selectionEnd ?? selectionAnchor;
    const r1 = Math.min(selectionAnchor.rowIdx, end.rowIdx);
    const r2 = Math.max(selectionAnchor.rowIdx, end.rowIdx);
    const c1 = Math.min(selectionAnchor.colIdx, end.colIdx);
    const c2 = Math.max(selectionAnchor.colIdx, end.colIdx);
    const keys = new Set<string>();
    for (let r = r1; r <= r2; r++) {
      const row = activeRows[r];
      if (!row) continue;
      for (let c = c1; c <= c2; c++) {
        const col = allDisplayColumns[c];
        if (col) keys.add(`${row.id}:${col}`);
      }
    }
    return keys;
  }, [selectionAnchor, selectionEnd, focusCell, activeRows, allDisplayColumns]);

  const selectedCells = useMemo(() => getSelectionRect(), [getSelectionRect]);

  // Derive which columns & rows are in the selection (for header/row-num highlighting)
  // Only highlight col headers if it's a column-based selection (anchor starts at row 0)
  // Only highlight row nums if it's a row-based selection (anchor starts at col 0)
  const highlightedCols = useMemo((): Set<string> => {
    if (!selectionAnchor) return new Set();
    const end = selectionEnd ?? selectionAnchor;
    // If selection spans all rows (row 0 to last), it's a column-select
    const isFullColumnSelect = Math.min(selectionAnchor.rowIdx, end.rowIdx) === 0 &&
      Math.max(selectionAnchor.rowIdx, end.rowIdx) >= activeRows.length - 1;
    // If selection spans all columns, it's a row-select — don't highlight col headers
    const isFullRowSelect = Math.min(selectionAnchor.colIdx, end.colIdx) === 0 &&
      Math.max(selectionAnchor.colIdx, end.colIdx) >= allDisplayColumns.length - 1;
    if (!isFullColumnSelect || isFullRowSelect) return new Set();
    const c1 = Math.min(selectionAnchor.colIdx, end.colIdx);
    const c2 = Math.max(selectionAnchor.colIdx, end.colIdx);
    const cols = new Set<string>();
    for (let c = c1; c <= c2; c++) {
      const col = allDisplayColumns[c];
      if (col) cols.add(col);
    }
    return cols;
  }, [selectionAnchor, selectionEnd, allDisplayColumns, activeRows]);

  const selectedRowIndices = useMemo((): Set<number> => {
    if (!selectionAnchor) return new Set();
    const end = selectionEnd ?? selectionAnchor;
    // If selection spans all columns (col 0 to last), it's a row-select
    const isFullRowSelect = Math.min(selectionAnchor.colIdx, end.colIdx) === 0 &&
      Math.max(selectionAnchor.colIdx, end.colIdx) >= allDisplayColumns.length - 1;
    // If it spans all rows, it's a column-select — don't highlight row numbers
    const isFullColumnSelect = Math.min(selectionAnchor.rowIdx, end.rowIdx) === 0 &&
      Math.max(selectionAnchor.rowIdx, end.rowIdx) >= activeRows.length - 1;
    if (!isFullRowSelect || isFullColumnSelect) return new Set();
    const r1 = Math.min(selectionAnchor.rowIdx, end.rowIdx);
    const r2 = Math.max(selectionAnchor.rowIdx, end.rowIdx);
    const rows = new Set<number>();
    for (let r = r1; r <= r2; r++) rows.add(r);
    return rows;
  }, [selectionAnchor, selectionEnd, allDisplayColumns, activeRows]);

  const getCellIndices = useCallback((rowId: string, col: string): { rowIdx: number; colIdx: number } => {
    return {
      rowIdx: activeRows.findIndex((r) => r.id === rowId),
      colIdx: allDisplayColumns.indexOf(col),
    };
  }, [activeRows, allDisplayColumns]);

  // Commit inline edit (defined BEFORE handleCellClick)
  const commitEdit = useCallback(() => {
    if (!editingCell) return;
    const { rowId, col } = editingCell;
    setRows((prev) => prev.map((r) => {
      if (r.id !== rowId) return r;
      if (config.rawColumns.includes(col)) {
        return { ...r, raw: { ...r.raw, [col]: editValue } };
      } else {
        return { ...r, ai: { ...r.ai, [col]: editValue } };
      }
    }));
    setEditingCell(null);
  }, [editingCell, editValue, config.rawColumns]);

  // Double-click to expand and view/edit cell
  const handleCellDoubleClick = useCallback((rowId: string, col: string) => {
    const row = activeRows.find((r) => r.id === rowId);
    if (!row) return;
    const isOutput = aiOutputColumns.includes(col);
    const val = isOutput ? (row.ai[col] ?? '') : (row.raw[col] ?? '');
    setExpandedCell({ rowId, col, value: val, isOutput });
  }, [activeRows, aiOutputColumns]);

  // Cell mousedown — focus + start drag
  const handleCellMouseDown = useCallback((rowId: string, col: string, e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault(); // prevent text selection during drag
    if (editingCell) commitEdit();
    const indices = getCellIndices(rowId, col);
    if (e.shiftKey && selectionAnchor) {
      // Shift+Click: extend range
      setSelectionEnd(indices);
    } else {
      setFocusCell({ rowId, col });
      setSelectionAnchor(indices);
      setSelectionEnd(null);
      setIsDragging(true);
    }
  }, [editingCell, commitEdit, getCellIndices, selectionAnchor]);

  // Cell mouseenter during drag — extend selection
  const handleCellMouseEnter = useCallback((rowId: string, col: string) => {
    if (!isDragging) return;
    const indices = getCellIndices(rowId, col);
    setSelectionEnd(indices);
  }, [isDragging, getCellIndices]);

  // Global mouseup — stop drag
  useEffect(() => {
    const handleMouseUp = () => setIsDragging(false);
    window.addEventListener('mouseup', handleMouseUp);
    return () => window.removeEventListener('mouseup', handleMouseUp);
  }, []);

  // Row number mousedown = select entire row (supports drag for multi-row)
  const handleRowMouseDown = useCallback((rowIdx: number, e: React.MouseEvent) => {
    e.preventDefault();
    const row = activeRows[rowIdx];
    if (!row) return;
    if (e.shiftKey && selectionAnchor) {
      // Shift: extend to this row
      setSelectionEnd({ rowIdx, colIdx: allDisplayColumns.length - 1 });
      // Also extend anchor column to 0 for full row
      setSelectionAnchor((prev) => prev ? { rowIdx: prev.rowIdx, colIdx: 0 } : { rowIdx, colIdx: 0 });
    } else {
      setFocusCell({ rowId: row.id, col: allDisplayColumns[0] });
      setSelectionAnchor({ rowIdx, colIdx: 0 });
      setSelectionEnd({ rowIdx, colIdx: allDisplayColumns.length - 1 });
      setIsDragging(true);
    }
  }, [activeRows, allDisplayColumns, selectionAnchor]);

  // Row mouseenter during drag — extend rows
  const handleRowMouseEnter = useCallback((rowIdx: number) => {
    if (!isDragging) return;
    setSelectionEnd({ rowIdx, colIdx: allDisplayColumns.length - 1 });
  }, [isDragging, allDisplayColumns]);

  // Column header mousedown = select entire column (supports drag multi-col)
  const handleColumnMouseDown = useCallback((col: string, e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const colIdx = allDisplayColumns.indexOf(col);
    if (activeRows.length === 0 || colIdx < 0) return;
    if (e.shiftKey && selectionAnchor) {
      setSelectionEnd({ rowIdx: activeRows.length - 1, colIdx });
      setSelectionAnchor((prev) => prev ? { rowIdx: 0, colIdx: prev.colIdx } : { rowIdx: 0, colIdx });
    } else {
      setFocusCell({ rowId: activeRows[0].id, col });
      setSelectionAnchor({ rowIdx: 0, colIdx });
      setSelectionEnd({ rowIdx: activeRows.length - 1, colIdx });
      setIsDragging(true);
    }
  }, [activeRows, allDisplayColumns, selectionAnchor]);

  // Column header mouseenter during drag
  const handleColumnMouseEnter = useCallback((col: string) => {
    if (!isDragging) return;
    const colIdx = allDisplayColumns.indexOf(col);
    if (colIdx < 0) return;
    setSelectionEnd({ rowIdx: activeRows.length - 1, colIdx });
  }, [isDragging, allDisplayColumns, activeRows]);

  const copySelectedCells = useCallback(() => {
    if (selectedCells.size === 0) return;
    const parsed = Array.from(selectedCells).map((k) => {
      const i = k.indexOf(':');
      return { rowId: k.slice(0, i), col: k.slice(i + 1) };
    });
    const rowOrder = activeRows.filter((r) => parsed.some((p) => p.rowId === r.id));
    const colSet = new Set(parsed.map((p) => p.col));
    const colOrder = allDisplayColumns.filter((c) => colSet.has(c));
    const lines = rowOrder.map((row) =>
      colOrder.map((col) => {
        const key = `${row.id}:${col}`;
        if (!selectedCells.has(key)) return '';
        const val = row.raw[col] ?? row.ai[col] ?? '';
        return tsvEscapeCell(val);
      }).join('\t')
    );
    const tsv = lines.join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      log(`📋 已复制 ${selectedCells.size} 个单元格`);
      setCopyFeedback('selected');
      setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, [selectedCells, activeRows, allDisplayColumns, log]);

  // ── Keyboard navigation ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // Prevent handling if the user is typing in an input/textarea anywhere
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement ||
        (e.target as HTMLElement)?.isContentEditable
      ) {
        return;
      }
      
      // Prevent handling if the DataPipelinePanel wrapper is hidden (height: 0)
      const container = tableRef.current?.closest('.datapipeline-page-wrapper');
      if (container && (container as HTMLElement).style.height === '0px') {
        return;
      }

      // Copy
      if ((e.metaKey || e.ctrlKey) && e.key === 'c' && selectedCells.size > 0) {
        e.preventDefault();
        copySelectedCells();
        return;
      }
      // Select all
      if ((e.metaKey || e.ctrlKey) && e.key === 'a' && activeRows.length > 0 && allDisplayColumns.length > 0) {
        e.preventDefault();
        setFocusCell({ rowId: activeRows[0].id, col: allDisplayColumns[0] });
        setSelectionAnchor({ rowIdx: 0, colIdx: 0 });
        setSelectionEnd({ rowIdx: activeRows.length - 1, colIdx: allDisplayColumns.length - 1 });
        return;
      }
      // Escape
      if (e.key === 'Escape') {
        if (editingCell) { setEditingCell(null); }
        else { setFocusCell(null); setSelectionAnchor(null); setSelectionEnd(null); }
        return;
      }
      // When editing
      if (editingCell) {
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commitEdit();
          const idx = getCellIndices(editingCell.rowId, editingCell.col);
          const nextRow = activeRows[idx.rowIdx + 1];
          if (nextRow) {
            setFocusCell({ rowId: nextRow.id, col: editingCell.col });
            setSelectionAnchor({ rowIdx: idx.rowIdx + 1, colIdx: idx.colIdx });
            setSelectionEnd(null);
          }
        }
        if (e.key === 'Tab') {
          e.preventDefault();
          commitEdit();
          const idx = getCellIndices(editingCell.rowId, editingCell.col);
          const nextColIdx = e.shiftKey ? idx.colIdx - 1 : idx.colIdx + 1;
          const nextCol = allDisplayColumns[nextColIdx];
          if (nextCol) {
            setFocusCell({ rowId: editingCell.rowId, col: nextCol });
            setSelectionAnchor({ rowIdx: idx.rowIdx, colIdx: nextColIdx });
            setSelectionEnd(null);
          }
        }
        return;
      }
      if (!focusCell) return;
      const { rowIdx, colIdx } = getCellIndices(focusCell.rowId, focusCell.col);
      let nextRowIdx = rowIdx;
      let nextColIdx = colIdx;

      if (e.key === 'ArrowUp') { e.preventDefault(); nextRowIdx = Math.max(0, rowIdx - 1); }
      else if (e.key === 'ArrowDown') { e.preventDefault(); nextRowIdx = Math.min(activeRows.length - 1, rowIdx + 1); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); nextColIdx = Math.max(0, colIdx - 1); }
      else if (e.key === 'ArrowRight') { e.preventDefault(); nextColIdx = Math.min(allDisplayColumns.length - 1, colIdx + 1); }
      else if (e.key === 'Tab') { e.preventDefault(); nextColIdx = e.shiftKey ? Math.max(0, colIdx - 1) : Math.min(allDisplayColumns.length - 1, colIdx + 1); }
      else if (e.key === 'Enter') { e.preventDefault(); handleCellDoubleClick(focusCell.rowId, focusCell.col); return; }
      else if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        setRows((prev) => prev.map((r) => {
          let changed = false;
          const newRaw = { ...r.raw };
          const newAi = { ...r.ai };
          selectedCells.forEach((key) => {
            const i = key.indexOf(':');
            const rid = key.slice(0, i); const c = key.slice(i + 1);
            if (rid !== r.id) return;
            if (config.rawColumns.includes(c)) { newRaw[c] = ''; changed = true; }
            else { newAi[c] = ''; changed = true; }
          });
          return changed ? { ...r, raw: newRaw, ai: newAi } : r;
        }));
        return;
      } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey) {
        handleCellDoubleClick(focusCell.rowId, focusCell.col);
        setEditValue(e.key);
        return;
      } else { return; }

      const nextRow = activeRows[nextRowIdx];
      const nextCol = allDisplayColumns[nextColIdx];
      if (nextRow && nextCol) {
        if (e.shiftKey) {
          setSelectionEnd({ rowIdx: nextRowIdx, colIdx: nextColIdx });
        } else {
          setSelectionAnchor({ rowIdx: nextRowIdx, colIdx: nextColIdx });
          setSelectionEnd(null);
        }
        setFocusCell({ rowId: nextRow.id, col: nextCol });
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [copySelectedCells, selectedCells, focusCell, editingCell, activeRows, allDisplayColumns, commitEdit, getCellIndices, handleCellDoubleClick, config.rawColumns]);

  // ── Column widths (resizable) ─────────────────
  const DEFAULT_COL_WIDTH = 180;
  const [columnWidths, setColumnWidths] = useState<Record<string, number>>({});
  const [headerHeight, setHeaderHeight] = useState<number | undefined>(undefined);
  const colWidthsRef = useRef<Record<string, number>>({});
  const headerHeightRef = useRef<number | undefined>(undefined);
  colWidthsRef.current = columnWidths;
  headerHeightRef.current = headerHeight;
  const tableRef = useRef<HTMLTableElement>(null);

  const getColWidth = useCallback((col: string) => columnWidths[col] || DEFAULT_COL_WIDTH, [columnWidths]);

  const onHeaderResizeStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    const startY = e.clientY;
    const currentHeight = tableRef.current?.querySelector('thead th')?.getBoundingClientRect()?.height || 36;
    const startH = headerHeightRef.current || currentHeight;

    const onMouseMove = (ev: MouseEvent) => {
      const newH = Math.max(36, startH + (ev.clientY - startY));
      const ths = tableRef.current?.querySelectorAll('thead th');
      if (ths) {
        ths.forEach(th => {
          (th as HTMLElement).style.height = newH + 'px';
        });
      }
    };
    const onMouseUp = (ev: MouseEvent) => {
      const finalH = Math.max(36, startH + (ev.clientY - startY));
      setHeaderHeight(finalH);
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'row-resize';
    document.body.style.userSelect = 'none';
  }, []);

  const onResizeStart = useCallback((e: React.MouseEvent, col: string) => {
    e.preventDefault();
    e.stopPropagation();
    const startX = e.clientX;
    const startW = colWidthsRef.current[col] || DEFAULT_COL_WIDTH;

    // Find the <col> element for direct DOM manipulation
    const colEl = tableRef.current?.querySelector(`col[data-col="${col}"]`) as HTMLElement | null;

    const onMouseMove = (ev: MouseEvent) => {
      const newW = Math.max(60, startW + (ev.clientX - startX));
      if (colEl) colEl.style.width = newW + 'px';
    };
    const onMouseUp = (ev: MouseEvent) => {
      const finalW = Math.max(60, startW + (ev.clientX - startX));
      setColumnWidths((prev) => ({ ...prev, [col]: finalW }));
      document.removeEventListener('mousemove', onMouseMove);
      document.removeEventListener('mouseup', onMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };
    document.addEventListener('mousemove', onMouseMove);
    document.addEventListener('mouseup', onMouseUp);
    document.body.style.cursor = 'col-resize';
    document.body.style.userSelect = 'none';
  }, []);

  // ── Stage 1: Paste ───────────────────────────
  const [pasteHeaders, setPasteHeaders] = useState<string[]>([]);
  const [pastePreview, setPastePreview] = useState<string[][]>([]);
  const [headerMapping, setHeaderMapping] = useState<Record<string, string>>({});
  const [showPastePanel, setShowPastePanel] = useState(false);
  const pasteRef = useRef<HTMLTextAreaElement>(null);
  const [rawPasteText, setRawPasteText] = useState('');
  /** Workbook built from clipboard data */
  const pasteWbRef = useRef<XLSX.WorkBook | null>(null);
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());
  const [pasteHasHeaders, setPasteHasHeaders] = useState<boolean>(true);
  const [autoDisabledHeaders, setAutoDisabledHeaders] = useState<boolean>(false);
  const [presetSaveInputVisible, setPresetSaveInputVisible] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');

  /** Core paste handler — accepts a Workbook or falls back to TSV text */
  const handlePasteFromWorkbook = useCallback((wb: XLSX.WorkBook, overrideHasHeader?: boolean) => {
    pasteWbRef.current = wb;
    const headersRaw = workbookToGrid(wb).headers;
    const gridRaw = workbookToGrid(wb).dataRows;
    const grid = headersRaw.length > 0 ? [headersRaw, ...gridRaw] : gridRaw;
    if (grid.length === 0) return;
    
    let computedHeaders: string[] = [];
    let preview: string[][] = [];
    let effectiveHasHeaders = overrideHasHeader ?? pasteHasHeaders;
    
    // Reset auto-disable flag unless we explicitly just triggered it
    if (overrideHasHeader !== undefined) {
      setAutoDisabledHeaders(false);
    }

    if (overrideHasHeader === undefined && effectiveHasHeaders && grid.length > 0) {
      const firstRow = grid[0].map(h => String(h || '').trim());
      const hasLongHeaders = firstRow.some(h => {
        const hasChinese = /[\u4e00-\u9fa5]/.test(h);
        return (hasChinese && h.length > 5) || (!hasChinese && h.length > 20);
      });
      if (hasLongHeaders) {
        effectiveHasHeaders = false;
        setPasteHasHeaders(false);
        setAutoDisabledHeaders(true);
      } else {
        setAutoDisabledHeaders(false);
      }
    }

    if (effectiveHasHeaders) {
      computedHeaders = grid[0].map(h => String(h || '').trim());
      preview = grid.slice(1, 7);
    } else {
      const maxCols = grid.reduce((mx, r) => Math.max(mx, r.length), 0);
      computedHeaders = Array.from({ length: maxCols }, (_, i) => `列${i + 1}`);
      preview = grid.slice(0, 6);
    }
    
    setPasteHeaders(computedHeaders);
    setPastePreview(preview);
    const mapping: Record<string, string> = {};
    computedHeaders.forEach((h) => { mapping[h] = h; });
    setHeaderMapping(mapping);
    // Default: all columns selected
    setSelectedColumns(new Set(computedHeaders));
    setShowPastePanel(true);
  }, [pasteHasHeaders]);

  /** Parse pasted text — prioritise manual TSV for reliability, XLSX.read as fallback */
  const handlePaste = useCallback((text: string, overrideHasHeader?: boolean) => {
    setRawPasteText(text);

    // Helper: apply parsed grid to state
    const applyGrid = (grid: string[][]) => {
      if (grid.length === 0) return;
      const maxCols = grid.reduce((mx, r) => Math.max(mx, r.length), 0);
      let computedHeaders: string[] = [];
      let preview: string[][] = [];
      let effectiveHasHeaders = overrideHasHeader ?? pasteHasHeaders;
      
      if (overrideHasHeader !== undefined) {
        setAutoDisabledHeaders(false);
      }

      if (overrideHasHeader === undefined && effectiveHasHeaders && grid.length > 0) {
        const firstRow = grid[0].map(h => String(h || '').trim());
        const hasLongHeaders = firstRow.some(h => {
          const hasChinese = /[\u4e00-\u9fa5]/.test(h);
          return (hasChinese && h.length > 5) || (!hasChinese && h.length > 20);
        });
        if (hasLongHeaders) {
          effectiveHasHeaders = false;
          setPasteHasHeaders(false);
          setAutoDisabledHeaders(true);
        } else {
          setAutoDisabledHeaders(false);
        }
      }

      if (effectiveHasHeaders) {
        if (grid.length < 2) return;
        computedHeaders = grid[0].length >= maxCols
          ? grid[0].map((h) => h.trim())
          : Array.from({ length: maxCols }, (_, i) => grid[0][i]?.trim() || `列${i + 1}`);
        preview = grid.slice(1, 7);
      } else {
        computedHeaders = Array.from({ length: maxCols }, (_, i) => `列${i + 1}`);
        preview = grid.slice(0, 6);
      }
      setPasteHeaders(computedHeaders);
      setPastePreview(preview);
      const mapping: Record<string, string> = {};
      computedHeaders.forEach((h) => { mapping[h] = h; });
      setHeaderMapping(mapping);
      setSelectedColumns(new Set(computedHeaders));
      setShowPastePanel(true);
    };

    // 1. If text looks like TSV (contains tabs), parse manually for reliability
    //    XLSX.read(text, {type:'string'}) often mis-parses simple TSV into a
    //    single-row workbook, losing all data rows.
    const tsvGrid = parseTsv(text);
    if (tsvGrid.length > 0 && tsvGrid.some(r => r.length > 1)) {
      // Genuine multi-column TSV
      applyGrid(tsvGrid);
      return;
    }

    // 2. Try XLSX.read for non-TSV formats (e.g. CSV with commas)
    try {
      const wb = XLSX.read(text, { type: 'string' });
      handlePasteFromWorkbook(wb, overrideHasHeader);
    } catch {
      // 3. Final fallback: treat as single-column or simple text
      if (tsvGrid.length > 0) {
        applyGrid(tsvGrid);
      }
    }
  }, [handlePasteFromWorkbook, pasteHasHeaders]);

  const confirmImport = useCallback(() => {
    let dataRows: string[][] = [];
    if (pasteWbRef.current) {
      const { headers: headersRaw, dataRows: dataRowsRaw } = workbookToGrid(pasteWbRef.current);
      const grid = headersRaw.length > 0 ? [headersRaw, ...dataRowsRaw] : dataRowsRaw;
      if (pasteHasHeaders) {
        dataRows = grid.slice(1);
      } else {
        dataRows = grid;
      }
    } else {
      // TSV fallback
      const grid = parseTsv(rawPasteText);
      const maxCols = grid.reduce((mx, r) => Math.max(mx, r.length), 0);
      if (pasteHasHeaders) {
        if (grid.length < 2) return;
        dataRows = grid.slice(1);
      } else {
        dataRows = grid;
      }
    }
    // Only import selected columns (which are maintained in selectedColumns based on the active pasteHeaders)
    const importHeaders = pasteHeaders.filter((h) => selectedColumns.has(h));
    if (importHeaders.length === 0) return;
    const newRows: PipelineRow[] = dataRows.map((cells) => {
      const raw: Record<string, string> = {};
      importHeaders.forEach((col) => {
        const idx = pasteHeaders.indexOf(col);
        raw[col] = (cells[idx] != null ? String(cells[idx]) : '').trim();
      });
      return { id: uuid(), raw, ai: {}, status: 'idle', isDedupRemoved: false };
    });
    // Update rawColumns to only the selected columns
    // Update rawColumns to only the selected columns
    setConfig((c) => ({ ...c, rawColumns: importHeaders }));
    setRows((prev) => [...prev, ...newRows]);
    setShowPastePanel(false);
    pasteWbRef.current = null;
    log(`✅ 导入 ${newRows.length} 行数据（${importHeaders.length}/${pasteHeaders.length} 列）`);
  }, [selectedColumns, rawPasteText, log, pasteHeaders, pasteHasHeaders]);

  // ── Global Cmd+V / Ctrl+V paste listener ───
  // Allows pasting data anywhere in the panel (no need to click the grid first)
  useEffect(() => {
    const onGlobalPaste = async (e: ClipboardEvent) => {
      // Return if the current tool is not active
      if (!isActive) return;
      
      // Skip if user is typing in an input/textarea
      const tag = (document.activeElement?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      // Skip if paste panel is already open
      if (showPastePanel) return;

      e.preventDefault();
      const html = e.clipboardData?.getData('text/html') || '';
      const text = e.clipboardData?.getData('text/plain') || '';

      if (html && html.includes('google-sheets-html-origin')) {
        try {
          const wb = await readWorkbookFromHtml(html);
          handlePasteFromWorkbook(wb);
          return;
        } catch { /* fall through */ }
      }
      if (text?.trim()) handlePaste(text);
    };
    document.addEventListener('paste', onGlobalPaste);
    return () => document.removeEventListener('paste', onGlobalPaste);
  }, [showPastePanel, handlePaste, handlePasteFromWorkbook, isActive]);

  // ── Stage 2: Dedup ───────────────────────────
  const handleDedup = useCallback(async () => {
    if (config.dedupPhaseMode === 'semantic') {
         const agent = getAgentById('agent_semantic_dedup');
         if (!agent) {
             log('❌ 高级语义查重工具未找到');
             return;
         }
         log('🚀 开始高级查重分析...');
         if (config.dedupColumns.length === 0) {
             log('⚠️ 请先配置"去重依据列"中的需要查重的列名');
             return;
         }
         
         const dataArr = rows.map(r => config.dedupColumns.map(c => r.raw[c] ?? '').join(' '));
         try {
             // getAiInstance is available in closure
             const results = await agent.executeBatch(dataArr, config.semanticDedupConfig || {}, getAiInstance, 'Combined', undefined, 'Result');
             
             let removed = 0;
             setRows((prev) => {
                 const updated = [...prev];
                 results.forEach((res, i) => {
                     // Check if it got flagged
                     if (res.__remove__) {
                         updated[i] = { ...updated[i], isDedupRemoved: true, dedupKey: '算法查重判定' };
                         removed++;
                     }
                 });
                 return updated;
             });
             log(`🧹 高级查重完成，标记移除 ${removed} 行重复数据`);
         } catch(e: any) {
             log(`❌ 高级查重失败: ${e.message}`);
         }
         return;
    }

    // --- Exact deduplication ---
    const seen = new Map<string, string>();
    let removed = 0;
    setRows((prev) => {
      const order = config.dedupKeep === 'last' ? [...prev].reverse() : prev;
      const removeIds = new Set<string>();
      order.forEach((row) => {
        if (row.isDedupRemoved) return;
        const key = config.dedupColumns.map((col) => (row.raw[col] ?? '').trim()).join('\u0000');
        if (seen.has(key)) {
          removeIds.add(config.dedupKeep === 'last' ? seen.get(key)! : row.id);
          if (config.dedupKeep === 'last') seen.set(key, row.id);
        } else {
          seen.set(key, row.id);
        }
      });
      removed = removeIds.size;
      return prev.map((row) =>
        removeIds.has(row.id)
          ? { ...row, isDedupRemoved: true, dedupKey: config.dedupColumns.map((c) => row.raw[c]).join(' | ') }
          : row
      );
    });
    setTimeout(() => log(`🧹 去重完成，移除 ${removed} 行重复数据`), 0);
  }, [config.dedupColumns, config.dedupKeep, config.dedupPhaseMode, config.semanticDedupConfig, rows, getAiInstance, log]);

  const handleUndoDedup = useCallback(() => {
    setRows((prev) => prev.map((r) => ({ ...r, isDedupRemoved: false, dedupKey: undefined })));
    log('↩️ 已恢复所有被去重的行');
  }, [log]);

  const handleRedoAll = useCallback(() => {
    setRows((prev) => prev.map((r) => ({ ...r, status: 'idle', ai: {}, aiLogs: [] })));
    log('🔄 已执行“全部重做”：已重置状态并清空AI输出');
  }, [log]);

  const handleClearResults = useCallback(() => {
    setRows((prev) => prev.map((r) => ({ ...r, status: 'idle', ai: {}, aiLogs: [], isDedupRemoved: false, dedupKey: undefined })));
    log('🧹 已清空所有生成结果和状态（保留原始数据）');
  }, [log]);

  // ── One-click: Dedup → AI ──
  const pendingOneClick = useRef(false);
  const handleOneClickRun = useCallback(async () => {
    if (rows.length === 0) { log('⚠️ 没有数据'); return; }
    // If dedup columns not configured, open config panel
    if (config.dedupColumns.length === 0) {
      log('⚠️ 请先设置去重列');
      setShowConfig(true);
      return;
    }
    // If no valid instructions configured, open config panel so user can set up first
    const noValid = config.aiInstructions.length === 0 || config.aiInstructions.every(i => {
      if (i.agentId) return false; // Agent mode is valid by itself
      return !i.prompt || !i.prompt.trim(); // Basic mode needs a prompt
    });

    if (noValid) {
      log('⚠️ 请先设置 AI 指令');
      setShowConfig(true);
      return;
    }
    
    // For exact match dedup it's synchronous, but for semantic it takes time.
    // It is safe to await it here
    await handleDedup();
    pendingOneClick.current = true;
  }, [rows.length, config.dedupColumns.length, config.aiInstructions, handleDedup, log]);

  // ── Stage 3: AI ──────────────────────────────
  const handleRunAI = useCallback(async (targetRowIds?: string[]) => {
    if (isRunningAI) return;
    const targets = targetRowIds 
      ? rows.filter((r) => targetRowIds.includes(r.id) && !r.isDedupRemoved)
      : rows.filter((r) => !r.isDedupRemoved && r.status !== 'done');
      
    if (targets.length === 0) { log('⚠️ 没有待处理的行'); return; }
    if (config.aiInstructions.length === 0) { log('⚠️ 请先添加 AI 处理指令'); return; }

    abortRef.current = false;
    setIsRunningAI(true);
    log(`🚀 开始 AI 处理，共 ${targets.length} 行，批次大小 ${config.batchSize}`);

    let ai: GoogleGenAI;
    try { ai = getAiInstance(); } catch {
      log('❌ 请先设置 API 密钥');
      setIsRunningAI(false);
      return;
    }

    setRows((prev) =>
      prev.map((r) => targets.some((t) => t.id === r.id) ? { ...r, status: 'processing' } : r)
    );
    
    setAiProgress({ current: 0, total: targets.length });

    const batches: PipelineRow[][] = [];
    for (let i = 0; i < targets.length; i += config.batchSize) {
      batches.push(targets.slice(i, i + config.batchSize));
    }
    log(`📦 共分 ${batches.length} 个批次`);

    let batchIdx = 0;
    let processedCount = 0;
    const runBatch = async (batch: PipelineRow[]): Promise<void> => {
      const bIdx = batchIdx++;

      const hasUnmergeableAgent = config.aiInstructions.some(inst => inst.agentId && !getAgentById(inst.agentId)?.compileMergedInstruction);

      if (config.mergeInstructions && !hasUnmergeableAgent) {
        // ── 合并模式：所有指令一次请求 ──
        const prompt = buildBatchPrompt(config.aiInstructions, batch, config.rawColumns);
        let attempt = 0;
        while (attempt <= config.maxRetries) {
          if (abortRef.current) return;
          try {
            log(`📤 批次 ${bIdx + 1}/${batches.length} (${batch.length}行, 第${attempt + 1}次)`);
            const startTime = Date.now();
            const result = await ai.models.generateContent({ model: modelId, contents: prompt });
            const runtimeMs = Date.now() - startTime;
            const text = result.text ?? '';
            const jsonMatch = text.match(/\[[\s\S]*\]/);
            if (!jsonMatch) throw new Error('返回内容不含 JSON 数组，将重试');
            const parsed: Array<Record<string, string>> = JSON.parse(jsonMatch[0]);
            setRows((prev) => {
              const updated = [...prev];
              parsed.forEach((item) => {
                const rowIdx = parseInt(String(item.__id), 10);
                const targetRow = batch[rowIdx];
                if (!targetRow) return;
                const idx = updated.findIndex((r) => r.id === targetRow.id);
                if (idx < 0) return;
                const mergedAi = { ...updated[idx].ai };
                config.aiInstructions.forEach((inst) => {
                  let outCols = inst.outputColumn ? [inst.outputColumn] : [];
                  if (inst.agentId) {
                      const agent = getAgentById(inst.agentId);
                      if (agent) outCols = agent.predictOutputColumns(inst.agentConfig || {}, inst.sourceColumn, inst.outputColumn);
                  }
                  outCols.forEach(col => {
                    if (item[col] !== undefined) {
                        mergedAi[col] = String(item[col]);
                    }
                  });
                });
                const newLog = { time: new Date().toLocaleTimeString(), phase: '多指令合并', request: prompt, response: text, runtimeMs };
                updated[idx] = { ...updated[idx], ai: mergedAi, status: 'done', errorMsg: undefined, aiLogs: [...(updated[idx].aiLogs || []), newLog] };
                // Mutate local batch for sequential pipeline access
                targetRow.ai = mergedAi;
              });
              return updated;
            });
            log(`✅ 批次 ${bIdx + 1} 完成`);
            return;
          } catch (err: unknown) {
            attempt++;
            const msg = err instanceof Error ? err.message : String(err);
            if (attempt > config.maxRetries) {
              log(`❌ 批次 ${bIdx + 1} 失败: ${msg}`);
              setRows((prev) =>
                prev.map((r) =>
                  batch.some((b) => b.id === r.id && r.status === 'processing')
                    ? { ...r, status: 'error', errorMsg: msg } : r
                )
              );
            } else {
              log(`⚠️ 第 ${attempt} 次失败，${2 ** attempt}s 后重试...`);
              await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
            }
          }
        }
      } else {
        // ── 分开模式：每条/类单独请求 ──
        for (const inst of config.aiInstructions) {
          if (abortRef.current) return;
          if (!inst.agentId && !inst.prompt.trim()) continue;

          // ── Agent (独立专业工具) 模式 ──
          if (inst.agentId) {
             const agent = getAgentById(inst.agentId);
             if (!agent) {
                 log(`⚠️ 工具 [${inst.agentId}] 未找到`);
                 continue;
             }
             log(`🤖 批次 ${bIdx + 1} 启动智能工具【${agent.name}】(${batch.length}行)`);
             const dataArr = batch.map(r => String(r.ai[inst.sourceColumn] ?? r.raw[inst.sourceColumn] ?? ''));
             
             let attempt = 0;
             while(attempt <= config.maxRetries) {
                 if (abortRef.current) return;
                 try {
                     const startTime = Date.now();
                     const results = await agent.executeBatch(dataArr, inst.agentConfig || {}, getAiInstance, inst.sourceColumn, undefined, inst.outputColumn);
                     const runtimeMs = Date.now() - startTime;
                     
                     setRows(prev => {
                         const updated = [...prev];
                         results.forEach((res, i) => {
                             const targetRow = batch[i];
                             const idx = updated.findIndex(r => r.id === targetRow.id);
                             if (idx >= 0) {
                                 let isDedupRemoved = updated[idx].isDedupRemoved;
                                 if (res.__remove__) {
                                     isDedupRemoved = true;
                                     delete res.__remove__;
                                 }
                                 const mergedAi = { ...updated[idx].ai, ...res };
                                 const newLog = { time: new Date().toLocaleTimeString(), phase: `工具: ${agent.name}`, request: `Input: ${dataArr[i]}\nConfig: ${JSON.stringify(inst.agentConfig)}`, response: JSON.stringify(res, null, 2), runtimeMs };
                                 updated[idx] = { ...updated[idx], isDedupRemoved, ai: mergedAi, aiLogs: [...(updated[idx].aiLogs || []), newLog] };
                                 // Mutate local batch for sequential pipeline access
                                 targetRow.ai = mergedAi;
                             }
                         });
                         return updated;
                     });
                     log(`✅ 批次 ${bIdx + 1} 工具【${agent.name}】处理完成`);
                     break;
                 } catch (err: unknown) {
                     attempt++;
                     const msg = err instanceof Error ? err.message : String(err);
                     if (attempt > config.maxRetries) {
                         log(`❌ 批次 ${bIdx + 1} 工具【${agent.name}】失败: ${msg}`);
                     } else {
                         log(`⚠️ 工具【${agent.name}】重试...`);
                         await new Promise(res => setTimeout(res, 3000));
                     }
                 }
             }
             continue;
          }

          // ── 检测是否为图片列 ──
          const imageMode = inst.sourceColumn && isImageColumn(batch, inst.sourceColumn);

          if (imageMode) {
            // ── 图片模式：逐行调用 Vision API ──
            log(`🖼️ 批次 ${bIdx + 1} 指令【${inst.name}】检测到图片列，启用 Vision 模式 (${batch.length}行)`);
            for (let ri = 0; ri < batch.length; ri++) {
              if (abortRef.current) return;
              const row = batch[ri];
              log(`🖼️ 处理第 ${ri + 1}/${batch.length} 行图片...`);
              try {
                const visionData = await buildVisionContent(inst, row, ri);
                if (!visionData) {
                  log(`⚠️ 第 ${ri + 1} 行无有效图片，跳过`);
                  continue;
                }
                const startTime = Date.now();
                const result = await ai.models.generateContent({
                  model: modelId,
                  contents: [{ role: 'user', parts: visionData.parts }],
                });
                const runtimeMs = Date.now() - startTime;
                const text = (result.text ?? '').trim();
                const newLog = { time: new Date().toLocaleTimeString(), phase: `视觉分析: ${inst.name}`, request: '[Image base64 uploaded]', response: text, runtimeMs };
                
                setRows((prev) => prev.map((r) => {
                  if (r.id === row.id) {
                    const mergedAi = { ...r.ai, [inst.outputColumn]: text };
                    // Mutate local batch for sequential pipeline access
                    row.ai = mergedAi;
                    return { ...r, ai: mergedAi, aiLogs: [...(r.aiLogs || []), newLog] };
                  }
                  return r;
                }));
              } catch (err: unknown) {
                const msg = err instanceof Error ? err.message : String(err);
                log(`❌ 第 ${ri + 1} 行图片处理失败: ${msg}`);
                setRows((prev) => prev.map((r) =>
                  r.id === row.id ? { ...r, status: 'error', errorMsg: msg } : r
                ));
              }
              // Small delay to avoid rate limiting
              if (ri < batch.length - 1) await new Promise((res) => setTimeout(res, 300));
            }
            log(`✅ 批次 ${bIdx + 1} 指令【${inst.name}】图片处理完成`);
          } else {
            // ── 文本模式：批量处理 ──
            const prompt = buildSinglePrompt(inst, batch, config.rawColumns);
            let attempt = 0;
            while (attempt <= config.maxRetries) {
              if (abortRef.current) return;
              try {
                log(`📤 批次 ${bIdx + 1}/${batches.length} 指令【${inst.name}】(${batch.length}行, 第${attempt + 1}次)`);
                const startTime = Date.now();
                const result = await ai.models.generateContent({ model: modelId, contents: prompt });
                const runtimeMs = Date.now() - startTime;
                const text = result.text ?? '';
                const jsonMatch = text.match(/\[[\s\S]*\]/);
                if (!jsonMatch) throw new Error('返回内容不含 JSON 数组，将重试');
                const parsed: Array<Record<string, string>> = JSON.parse(jsonMatch[0]);
                setRows((prev) => {
                  const updated = [...prev];
                  parsed.forEach((item) => {
                    const rowIdx = parseInt(String(item.__id), 10);
                    const targetRow = batch[rowIdx];
                    if (!targetRow) return;
                    const idx = updated.findIndex((r) => r.id === targetRow.id);
                    if (idx < 0) return;
                    const mergedAi = { ...updated[idx].ai };
                    if (inst.outputColumn && item[inst.outputColumn] !== undefined) {
                      mergedAi[inst.outputColumn] = String(item[inst.outputColumn]);
                    }
                    const newLog = { time: new Date().toLocaleTimeString(), phase: `单行处理: ${inst.name}`, request: prompt, response: text, runtimeMs };
                    updated[idx] = { ...updated[idx], ai: mergedAi, aiLogs: [...(updated[idx].aiLogs || []), newLog] };
                    // Mutate local batch for sequential pipeline access
                    targetRow.ai = mergedAi;
                  });
                  return updated;
                });
                log(`✅ 批次 ${bIdx + 1} 指令【${inst.name}】完成`);
                break;
              } catch (err: unknown) {
                attempt++;
                const msg = err instanceof Error ? err.message : String(err);
                if (attempt > config.maxRetries) {
                  log(`❌ 批次 ${bIdx + 1} 指令【${inst.name}】失败: ${msg}`);
                } else {
                  log(`⚠️ 第 ${attempt} 次失败，${2 ** attempt}s 后重试...`);
                  await new Promise((res) => setTimeout(res, 1000 * 2 ** attempt));
                }
              }
            }
          }
        }

        // Mark rows as done after all instructions processed
        setRows((prev) =>
          prev.map((r) =>
            batch.some((b) => b.id === r.id && r.status === 'processing')
              ? { ...r, status: 'done' } : r
          )
        );
      }
      processedCount += batch.length;
      setAiProgress({ current: processedCount, total: targets.length });
    };

    const queue = [...batches];
    const workers = Array.from({ length: config.concurrency }, async () => {
      while (queue.length > 0 && !abortRef.current) {
        const batch = queue.shift();
        if (batch) await runBatch(batch);
      }
    });
    await Promise.all(workers);
    setIsRunningAI(false);
    setAiProgress(null);
    if (abortRef.current) {
      log('🛑 任务已中止');
    } else {
      log('🎉 全部批次处理完毕');
    }
    // Revert any stuck rows (from aborts) to idle
    setRows((prev) => prev.map((r) => r.status === 'processing' ? { ...r, status: 'idle' } : r));
  }, [isRunningAI, rows, config, getAiInstance, modelId, log]);

  const handleRetryErrors = useCallback(() => {
    setRows((prev) => prev.map((r) => (r.status === 'error' ? { ...r, status: 'idle', errorMsg: undefined } : r)));
    log('🔄 已将失败行重置为待处理');
  }, [log]);

  // Auto-trigger AI after one-click dedup completes
  useEffect(() => {
    if (pendingOneClick.current && !isRunningAI) {
      pendingOneClick.current = false;
      handleRunAI();
    }
  }, [rows, isRunningAI, handleRunAI]);

  // ── Stage 4: Export ──────────────────────────
  const buildTsvOutput = useCallback((includeRemoved: boolean = false) => {
    const cols = allDisplayColumns;
    const header = cols.map(tsvEscapeCell).join('\t');
    const targetRows = includeRemoved ? rows : activeRows;
    const body = targetRows.map((r) => {
      // 如果包含被剔除的行，并且该行确已被剔除，则输出空行内容
      if (includeRemoved && r.isDedupRemoved) {
        return cols.map(() => '').join('\t');
      }
      return cols.map((c) => tsvEscapeCell(r.ai[c] ?? r.raw[c] ?? '')).join('\t');
    }).join('\n');
    return header + '\n' + body;
  }, [rows, activeRows, allDisplayColumns]);

  const handleCopyResult = useCallback(() => {
    navigator.clipboard.writeText(buildTsvOutput(false)).then(() => {
       log('📋 已复制可见数据（可直接粘贴到 Google Sheets）');
       setCopyFeedback('all');
       setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, [buildTsvOutput, log]);

  const handleCopyResultWithRemoved = useCallback(() => {
    navigator.clipboard.writeText(buildTsvOutput(true)).then(() => {
       log('📋 已复制全部数据 (包含被剔除的空行)');
       setCopyFeedback('all_with_removed');
       setTimeout(() => setCopyFeedback(null), 2000);
    });
  }, [buildTsvOutput, log]);

  const handleExportCsv = useCallback(() => {
    const tsv = buildTsvOutput();
    const blob = new Blob(['\ufeff' + tsv.replace(/\t/g, ',')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `智能代理_${new Date().toLocaleDateString('zh')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    log('💾 CSV 已导出');
  }, [buildTsvOutput, log]);

  // ── Derived ──────────────────────────────────
  const errorRows = useMemo(() => rows.filter((r) => r.status === 'error'), [rows]);
  const doneRows = useMemo(() => rows.filter((r) => !r.isDedupRemoved && r.status === 'done'), [rows]);

  const STAGE_COLORS = { s1: '#e05252', s2: '#3aaa6b', s3: '#e57c26', s4: '#3b82f6' };

  // ── Render ───────────────────────────────────
  return (
    <div className="dp-panel" style={{ display: 'flex', flexDirection: 'column', height: '100%', overflow: 'hidden' }}>

      {/* ─── Toolbar ── */}
      <div className="dp-toolbar" style={{ padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', flexShrink: 0 }}>
        <strong style={{ fontSize: 14, color: 'var(--on-surface-color)', marginRight: 4 }}>智能代理</strong>

        {/* Preset button */}
        <button ref={presetBtnRef} className={`dp-btn ${showPresetMenu ? 'dp-btn-blue active' : ''}`}
          onClick={() => setShowPresetMenu((v) => !v)}>
          <FolderOpen size={13} /> 预设
        </button>
        <button className={`dp-btn ${showConfig ? 'dp-btn-orange active' : ''}`} onClick={() => setShowConfig((v) => !v)}>
          <Settings2 size={13} /> 配置
        </button>
        <button className="dp-btn dp-btn-red" onClick={() => { setShowPastePanel(true); setTimeout(() => pasteRef.current?.focus(), 100); }}>
          <ClipboardPaste size={13} /> 粘贴数据
        </button>
        {sheetData && sheetData.rows.length > 0 && (
          <button className="dp-btn dp-btn-red" onClick={loadFromSheetData} title={`导入主表 ${sheetData.rows.length} 行 × ${sheetData.columns.length} 列`}>
            <FileDown size={13} /> 从主表导入 ({sheetData.rows.length}行)
          </button>
        )}
        <button ref={dedupBtnRef} className={`dp-btn dp-btn-green ${showDedupPicker ? 'active' : ''}`}
          onClick={() => setShowDedupPicker((v) => !v)} disabled={rows.length === 0}>
          <Trash2 size={13} /> 执行去重
        </button>
        {isRunningAI ? (
          <button className="dp-btn dp-btn-orange active" onClick={() => { abortRef.current = true; }}>
            <Loader2 size={13} className="animate-spin" /> 停止 {aiProgress ? `(${aiProgress.current}/${aiProgress.total})` : ''}
          </button>
        ) : (
          <button ref={aiBtnRef} className={`dp-btn dp-btn-orange ${showAIPicker ? 'active' : ''}`}
            onClick={() => setShowAIPicker((v) => !v)} disabled={activeRows.length === 0}>
            <Sparkles size={13} /> 运行 AI
          </button>
        )}
        {/* One-click: Dedup + AI */}
        {!isRunningAI && rows.length > 0 && config.aiInstructions.length > 0 && (
          <button className="dp-btn" onClick={handleOneClickRun}
            style={{ background: 'linear-gradient(135deg, #3aaa6b, #e57c26)', color: '#fff', border: 'none', fontWeight: 700 }}
            title="一键去重后自动运行 AI">
            <Zap size={13} /> 去重+AI
          </button>
        )}
        {selectedCells.size > 0 && (
          <button className="dp-btn" style={{ background: 'rgba(59,130,246,0.15)', color: '#3b82f6', border: '1px solid rgba(59,130,246,0.3)' }}
            onClick={copySelectedCells} title="Ctrl/⌘+C 复制选中单元格 (TSV 格式，可粘贴到 Google Sheets)">
            <Copy size={13} /> {copyFeedback === 'selected' ? '已复制' : `复制选中 (${selectedCells.size})`}
          </button>
        )}
        <button className="dp-btn dp-btn-blue" onClick={handleCopyResult} disabled={activeRows.length === 0} title="仅复制可见的数据">
          <Copy size={13} /> {copyFeedback === 'all' ? '已复制' : '复制全部'}
        </button>
        {rows.length > activeRows.length && (
          <button className="dp-btn" style={{ border: '1px solid #7dd3fc', color: '#0284c7' }} onClick={handleCopyResultWithRemoved} title="将刚才查重被删除/过滤掉的行作为空行一并带上复制，方便您粘贴回原始表格并保持行号对齐">
            <Copy size={13} /> {copyFeedback === 'all_with_removed' ? '已复制' : '复制 (包含原空行)'}
          </button>
        )}
        <button className="dp-btn dp-btn-blue" onClick={handleExportCsv} disabled={activeRows.length === 0}>
          <FileDown size={13} /> 导出 CSV
        </button>
        {(rows.some(r => Object.keys(r.ai).length > 0 || r.status !== 'idle' || r.isDedupRemoved)) && (
          <>
            <ConfirmButton
              className="dp-btn"
              onClick={handleRedoAll}
              title="清空 AI 处理结果，并将所有行状态重置为待处理"
              style={{ color: '#f59e0b', border: '1px solid currentColor' }}
              icon={RotateCcw}
              label="全部重做"
              confirmLabel="确认重置？"
            />
            <ConfirmButton
              className="dp-btn"
              onClick={handleClearResults}
              title="清空全部生成结果和状态（保留原始数据）"
              style={{ color: '#ef4444', border: '1px solid currentColor' }}
              icon={Eraser}
              label="清空结果"
              confirmLabel="确认清空结果？"
            />
          </>
        )}
        <ConfirmButton
          className="dp-btn"
          onClick={() => {
            setRows([]);
            setConfig(c => ({
              ...c,
              rawColumns: ['原文'],
              dedupColumns: ['原文'],
              aiInstructions: c.aiInstructions.map((inst, i) => ({
                ...inst,
                sourceColumn: '原文',
                outputColumn: `AI处理_${i + 1}`,
              })),
            }));
            log('🗑️ 已清空全部数据，列名已恢复默认');
          }}
          title="清空整张表的所有数据（包括原始数据）"
          icon={Trash2}
          confirmLabel="确认清空整表？"
        />
      </div>

      {/* ─── Config Panel ── */}
      {showConfig && (
        <div className="dp-config-panel" style={{ padding: '12px 16px', overflowY: 'auto', maxHeight: 320, flexShrink: 0 }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
            {/* Left: Columns + Dedup */}
            <div>
              <div className="dp-config-section-title" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e05252', display: 'inline-block' }} />
                第一阶段：原始列名
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 8 }}>
                {config.rawColumns.map((col, i) => (
                  <div key={col + '_' + i} className="dp-tag" style={{ borderColor: 'rgba(224,82,82,0.3)', color: '#e05252', cursor: 'default' }}
                    title="双击重命名此列"
                  >
                    <span
                      contentEditable
                      suppressContentEditableWarning
                      onBlur={(e) => {
                        const newName = (e.target as HTMLSpanElement).textContent?.trim() || '';
                        if (newName && newName !== col) {
                          setConfig((c) => ({
                            ...c,
                            rawColumns: c.rawColumns.map((rc, j) => j === i ? newName : rc),
                            dedupColumns: c.dedupColumns.map(dc => dc === col ? newName : dc),
                            aiInstructions: c.aiInstructions.map(inst => ({
                              ...inst,
                              sourceColumn: inst.sourceColumn === col ? newName : inst.sourceColumn,
                              outputColumn: inst.outputColumn === col ? newName : inst.outputColumn,
                            })),
                          }));
                          setRows(prev => prev.map(r => {
                            if (col in r.raw) {
                              const newRaw = { ...r.raw };
                              newRaw[newName] = newRaw[col];
                              delete newRaw[col];
                              return { ...r, raw: newRaw };
                            }
                            return r;
                          }));
                        } else {
                          (e.target as HTMLSpanElement).textContent = col;
                        }
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') { e.preventDefault(); (e.target as HTMLSpanElement).blur(); }
                        if (e.key === 'Escape') { (e.target as HTMLSpanElement).textContent = col; (e.target as HTMLSpanElement).blur(); }
                      }}
                      style={{ outline: 'none', minWidth: 20, cursor: 'text', borderBottom: '1px dashed rgba(224,82,82,0.3)' }}
                    >
                      {col}
                    </span>
                    <button style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: '#e05252', opacity: 0.6 }}
                      onClick={() => setConfig((c) => ({ ...c, rawColumns: c.rawColumns.filter((_, j) => j !== i) }))}>
                      <X size={10} />
                    </button>
                  </div>
                ))}
                {showAddColInput ? (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                    <input
                      className="dp-input"
                      style={{ width: 100, padding: '2px 6px', fontSize: 12 }}
                      placeholder="列名..."
                      value={newColName}
                      autoFocus
                      onChange={(e) => setNewColName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newColName.trim()) {
                          setConfig((c) => ({ ...c, rawColumns: [...c.rawColumns, newColName.trim()] }));
                          setNewColName('');
                          setShowAddColInput(false);
                        } else if (e.key === 'Escape') {
                          setNewColName(''); setShowAddColInput(false);
                        }
                      }}
                      onBlur={() => {
                        if (newColName.trim()) {
                          setConfig((c) => ({ ...c, rawColumns: [...c.rawColumns, newColName.trim()] }));
                        }
                        setNewColName(''); setShowAddColInput(false);
                      }}
                    />
                  </div>
                ) : (
                  <button className="dp-btn dp-btn-red" style={{ padding: '2px 8px' }}
                    onClick={() => setShowAddColInput(true)}>
                    <Plus size={10} /> 添加列
                  </button>
                )}
              </div>

              <div className="dp-config-section-title" style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 12 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3aaa6b', display: 'inline-block' }} />
                第二阶段：去重清理
              </div>
              <div style={{ display: 'flex', gap: 8, marginTop: 8, marginBottom: 8 }}>
                <div 
                   onClick={() => setConfig(c => ({ ...c, dedupPhaseMode: 'exact' }))}
                   style={{ background: config.dedupPhaseMode==='exact'?'#3aaa6b20':'transparent', color: config.dedupPhaseMode==='exact'?'#3aaa6b':'var(--text-muted-color)', border: `1px solid ${config.dedupPhaseMode==='exact'?'#3aaa6b50':'var(--border-color)'}`, padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, transition: 'all 0.2s' }}>
                  🎯 精准列匹配
                </div>
                <div 
                   onClick={() => setConfig(c => ({ ...c, dedupPhaseMode: 'semantic' }))}
                   style={{ background: config.dedupPhaseMode==='semantic'?'#f59e0b20':'transparent', color: config.dedupPhaseMode==='semantic'?'#f59e0b':'var(--text-muted-color)', border: `1px solid ${config.dedupPhaseMode==='semantic'?'#f59e0b50':'var(--border-color)'}`, padding: '4px 12px', borderRadius: 4, cursor: 'pointer', fontSize: 12, transition: 'all 0.2s' }}>
                  🔎 高级查重 (算法/语义)
                </div>
              </div>
              
              <div style={{ fontSize: 11, marginBottom: 4, color: 'var(--text-muted-color)' }}>
                {config.dedupPhaseMode === 'semantic' ? '选择参与查重特征提取的列（可多选）：' : '选择去重依据列（完全相同即去重）：'}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                {config.rawColumns.map((col) => (
                  <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', color: 'var(--text-color)' }}>
                    <input type="checkbox" checked={config.dedupColumns.includes(col)}
                      onChange={(e) => setConfig((c) => ({
                        ...c,
                        dedupColumns: e.target.checked ? [...c.dedupColumns, col] : c.dedupColumns.filter((d) => d !== col),
                      }))} />
                    {col}
                  </label>
                ))}
              </div>
              
              {config.dedupPhaseMode === 'exact' ? (
                <div style={{ display: 'flex', gap: 12 }}>
                  {([['first', '保留第一条'], ['last', '保留最后一条']] as const).map(([val, label]) => (
                    <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', color: 'var(--text-color)' }}>
                      <input type="radio" name="dp-keep" checked={config.dedupKeep === val} onChange={() => setConfig((c) => ({ ...c, dedupKeep: val }))} />
                      {label}
                    </label>
                  ))}
                </div>
              ) : (
                <div style={{ marginTop: 8 }}>
                  <ClassifyConfigPanel
                      value={{
                          ...config.semanticDedupConfig,
                          depth: 'major',
                          batchSize: config.semanticDedupConfig?.batchSize ?? 999,
                          customRules: [],
                          enableDedup: true,
                          dedupMode: config.semanticDedupConfig?.dedupMode || 'fingerprint',
                          dedupSource: config.semanticDedupConfig?.dedupSource || 'self',
                          taskMode: 'dedup_only',
                          systemPromptOverride: '',
                      }}
                      onChange={(val) => {
                          setConfig(c => ({ 
                              ...c, 
                              semanticDedupConfig: { ...c.semanticDedupConfig, ...val, enableDedup: true, taskMode: 'dedup_only' } 
                          }));
                      }}
                      compact={true}
                      panelMode="dedup"
                  />
                </div>
              )}
            </div>

            {/* Right: AI instructions */}
            <div>
              <div className="dp-config-section-title" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e57c26', display: 'inline-block' }} />
                第三阶段：AI 指令
                {config.aiInstructions.length > 0 && (
                  <button
                    onClick={() => setConfig(c => ({ ...c, aiInstructions: [] }))}
                    title="清空所有 AI 指令"
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted-color)', padding: 2, marginLeft: 2, opacity: 0.6 }}
                  ><Eraser size={12} /></button>
                )}
                {(() => {
                  const hasUnmergeableAgent = config.aiInstructions.some(inst => inst.agentId && !getAgentById(inst.agentId)?.compileMergedInstruction);
                  const effectiveMerge = config.mergeInstructions && !hasUnmergeableAgent;
                  return (
                    <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, cursor: hasUnmergeableAgent ? 'not-allowed' : 'pointer', fontSize: 11, fontWeight: 400, opacity: hasUnmergeableAgent ? 0.6 : 1 }} title={hasUnmergeableAgent ? "包含不支持合并的工具，强制分开执行" : "合为一步执行省流提速"}>
                      <span
                        onClick={() => { if (!hasUnmergeableAgent) setConfig((c) => ({ ...c, mergeInstructions: !c.mergeInstructions })) }}
                        style={{
                          width: 26, height: 14, borderRadius: 7, position: 'relative', display: 'inline-block', cursor: hasUnmergeableAgent ? 'not-allowed' : 'pointer',
                          background: effectiveMerge ? '#e57c26' : 'var(--border-color)',
                          transition: 'background 0.2s',
                        }}>
                        <span style={{
                          position: 'absolute', top: 2, left: effectiveMerge ? 14 : 2,
                          width: 10, height: 10, borderRadius: '50%', background: '#fff',
                          transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                        }} />
                      </span>
                      <span style={{ color: effectiveMerge ? '#e57c26' : 'var(--text-muted-color)' }}>
                        {effectiveMerge ? '合并请求' : '分开请求'}
                      </span>
                    </label>
                  );
                })()}
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', paddingRight: 4 }}>
                {config.aiInstructions.map((inst, idx) => (
                  <InstructionEditor
                    key={inst.id}
                    inst={inst}
                    rawColumns={config.rawColumns}
                    aiOutputCols={aiOutputColumns.filter((c) => c !== inst.outputColumn)}
                    promptPresets={promptPresets}
                    onChange={(updated) => setConfig((c) => ({ ...c, aiInstructions: c.aiInstructions.map((i) => (i.id === inst.id ? updated : i)) }))}
                    onDelete={() => setConfig((c) => ({ ...c, aiInstructions: c.aiInstructions.filter((i) => i.id !== inst.id) }))}
                    onMoveUp={
                      idx > 0
                        ? () =>
                            setConfig((c) => {
                              const arr = [...c.aiInstructions];
                              [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                              return { ...c, aiInstructions: arr };
                            })
                        : undefined
                    }
                    onMoveDown={
                      idx < config.aiInstructions.length - 1
                        ? () =>
                            setConfig((c) => {
                              const arr = [...c.aiInstructions];
                              [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
                              return { ...c, aiInstructions: arr };
                            })
                        : undefined
                    }
                    onSavePromptPreset={savePromptPreset}
                    onLoadPromptPreset={() => {}}
                    onDeletePromptPreset={deletePromptPreset}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6, position: 'relative' }}>
                <button ref={addAgentBtnRef} className="dp-btn dp-btn-orange" style={{ flex: 1 }}
                  onClick={() => setShowAddAgentPicker(v => !v)}>
                  <Plus size={12} /> 增加处理节点 <span style={{ fontSize: 9, opacity: 0.7 }}>▼</span>
                </button>
                <button className="dp-btn dp-btn-orange" onClick={() => { setBatchInstText(''); setShowBatchInstModal(true); }}>
                  <ClipboardPaste size={12} /> 批量粘贴
                </button>
                {showAddAgentPicker && createPortal(
                  <>
                     <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setShowAddAgentPicker(false)} />
                     <div style={{
                        position: 'fixed',
                        top: (addAgentBtnRef.current?.getBoundingClientRect().bottom ?? 0) + 4,
                        left: addAgentBtnRef.current?.getBoundingClientRect().left ?? 0,
                        zIndex: 9999,
                        background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                        borderRadius: 8, padding: 8, width: 220,
                        boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                     }} onClick={e => e.stopPropagation()}>
                        <div style={{ fontSize: 10, color: 'var(--text-muted-color)', fontWeight: 700, marginBottom: 4 }}>普通指令</div>
                        <button className="dp-btn" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 8, background: 'none', border: 'none' }}
                          onClick={() => {
                             setConfig((c) => { 
                               let src = c.rawColumns[0] || ''; 
                               if (c.aiInstructions.length > 0) {
                                  const lastInst = c.aiInstructions[c.aiInstructions.length - 1];
                                  if (lastInst.agentId) {
                                      const agent = getAgentById(lastInst.agentId);
                                      if (agent) {
                                          const predicted = agent.predictOutputColumns(lastInst.agentConfig || {}, lastInst.sourceColumn, lastInst.outputColumn);
                                          if (predicted.length > 0) src = predicted[0];
                                      }
                                  } else if (lastInst.outputColumn) {
                                      src = lastInst.outputColumn;
                                  }
                               }
                               return { ...c, aiInstructions: [...c.aiInstructions, { id: uuid(), name: `指令 ${c.aiInstructions.length + 1}`, prompt: '', outputColumn: src ? `${src}_ai处理` : `AI处理_${c.aiInstructions.length + 1}`, sourceColumn: src }] }; 
                             });
                             setShowAddAgentPicker(false);
                          }}>
                          <Sparkles size={14} style={{ color: '#e57c26' }} /> ✨ 自定义 Prompt 节点
                        </button>

                        <div style={{ fontSize: 10, color: 'var(--text-muted-color)', fontWeight: 700, marginBottom: 4 }}>独立专业工具 (Agent)</div>
                        {AgentRegistry.map(agent => (
                           <button key={agent.id} className="dp-btn" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 2, background: 'none', border: 'none' }}
                             title={agent.description}
                             onClick={() => {
                               setConfig((c) => { 
                                 let src = c.rawColumns[0] || ''; 
                                 if (c.aiInstructions.length > 0) {
                                    const lastInst = c.aiInstructions[c.aiInstructions.length - 1];
                                    if (lastInst.agentId) {
                                        const prevAgent = getAgentById(lastInst.agentId);
                                        if (prevAgent) {
                                            const predicted = prevAgent.predictOutputColumns(lastInst.agentConfig || {}, lastInst.sourceColumn, lastInst.outputColumn);
                                            if (predicted.length > 0) src = predicted[0];
                                        }
                                    } else if (lastInst.outputColumn) {
                                        src = lastInst.outputColumn;
                                    }
                                 }
                                 return { ...c, aiInstructions: [...c.aiInstructions, { id: uuid(), name: agent.name, prompt: '', outputColumn: '', sourceColumn: src, agentId: agent.id, agentConfig: {} }] }; 
                               });
                               setShowAIPicker(false);
                             }}>
                             <span style={{ color: 'var(--brand-color)' }}>{agent.icon}</span> {agent.name}
                           </button>
                        ))}
                     </div>
                  </>,
                  document.body
                )}
              </div>

              {/* Batch params */}
              <div style={{ display: 'flex', gap: 8, marginTop: 12, flexWrap: 'wrap' }}>
                {([
                  { label: '每批次行数', key: 'batchSize', min: 1, max: 50, w: 48 },
                  { label: '并发数', key: 'concurrency', min: 1, max: 10, w: 36 },
                  { label: '最大重试', key: 'maxRetries', min: 0, max: 5, w: 36 },
                ] as const).map(({ label, key, min, max, w }) => (
                  <label key={key} className="dp-batch-count-label">
                    {label}
                    <input
                      type="number" min={min} max={max}
                      value={config[key]}
                      onChange={(e) => setConfig((c) => ({ ...c, [key]: Math.max(min, +e.target.value) }))}
                      style={{ width: w }}
                    />
                  </label>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}


      {/* ─── Preset Menu (portal to body) ── */}
      {showPresetMenu && createPortal(
        (() => {
          const rect = presetBtnRef.current?.getBoundingClientRect();
          const top = (rect?.bottom ?? 100) + 4;
          const left = rect?.left ?? 100;
          return (
            <div style={{ position: 'fixed', inset: 0, zIndex: 99999 }} onClick={() => setShowPresetMenu(false)}>
              <div onClick={(e) => e.stopPropagation()} style={{
                position: 'absolute', top, left, background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                borderRadius: 10, padding: '10px 12px', width: 280, maxHeight: '50vh', overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted-color)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ flex: 1, display: 'flex', alignItems: 'center', gap: 4 }}>
                    <FolderOpen size={12} /> 预设管理
                  </span>
                  <button onClick={() => {
                      navigator.clipboard.writeText(JSON.stringify(presets, null, 2));
                      log('✅ 配置已导出到剪贴板，共 ' + presets.length + ' 条');
                  }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e57c26' }} title="导出配置到剪贴板">
                     <Copy size={12} />
                  </button>
                  <button onClick={async () => {
                      try {
                          const text = await navigator.clipboard.readText();
                          const parsed = JSON.parse(text);
                          if (Array.isArray(parsed) && parsed[0]?.id) {
                              setPresets(parsed);
                              log('✅ 成功导入 ' + parsed.length + ' 条预设');
                          } else throw new Error();
                      } catch {
                          log('❌ 导入失败，请先复制合法的配置清单 JSON');
                      }
                  }} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#e57c26' }} title="从剪贴板导入配置">
                     <ClipboardPaste size={12} />
                  </button>
                </div>
                {presets.length === 0 ? (
                  <div style={{ fontSize: 12, color: 'var(--text-muted-color)', padding: '12px 0', textAlign: 'center' }}>
                    暂无预设，点击下方保存当前配置
                  </div>
                ) : (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8 }}>
                    {presets.map((p) => (
                      <div key={p.id} style={{
                        display: 'flex', alignItems: 'center', gap: 6, padding: '6px 8px', borderRadius: 6,
                        background: 'var(--control-bg-color)', cursor: 'pointer', fontSize: 12,
                      }}
                        onClick={() => loadPreset(p)}
                        title={`去重列: ${p.dedupColumns.join(', ')}\n指令数: ${p.aiInstructions.length}\n模式: ${p.mergeInstructions ? '合并' : '分开'}`}
                      >
                        <span style={{ flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 600, color: 'var(--text-color)' }}>
                          {p.name}
                        </span>
                        <span style={{ fontSize: 10, color: 'var(--text-muted-color)', flexShrink: 0 }}>
                          {p.aiInstructions.length} 指令
                        </span>
                        <button
                          onClick={(e) => { e.stopPropagation(); deletePreset(p.id); }}
                          style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, color: 'var(--text-muted-color)' }}
                          title="删除此预设"
                        >
                          <X size={12} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                {presetSaveInputVisible ? (
                  <div style={{ display: 'flex', gap: 4, marginTop: 4 }}>
                    <input
                      className="dp-input"
                      style={{ flex: 1, padding: 4, fontSize: 11 }}
                      value={newPresetName}
                      onChange={(e) => setNewPresetName(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && newPresetName.trim()) {
                          savePreset(newPresetName.trim());
                          setPresetSaveInputVisible(false);
                          setShowPresetMenu(false);
                        } else if (e.key === 'Escape') {
                          setPresetSaveInputVisible(false);
                        }
                      }}
                      autoFocus
                    />
                    <button className="dp-btn dp-btn-blue" onClick={() => {
                        if (newPresetName.trim()) {
                          savePreset(newPresetName.trim());
                          setPresetSaveInputVisible(false);
                          setShowPresetMenu(false);
                        }
                    }}>确定</button>
                    <button className="dp-btn" onClick={() => setPresetSaveInputVisible(false)}>取消</button>
                  </div>
                ) : (
                  <button className="dp-btn dp-btn-blue" style={{ width: '100%', justifyContent: 'center' }}
                    onClick={() => {
                      setNewPresetName(`预设 ${presets.length + 1}`);
                      setPresetSaveInputVisible(true);
                    }}>
                    <Save size={12} /> 保存当前配置为预设
                  </button>
                )}
              </div>
            </div>
          );
        })()
        , document.body
      )}

      {/* ─── Dedup Picker (portal to body) ── */}
      {showDedupPicker && createPortal(
        (() => {
          const rect = dedupBtnRef.current?.getBoundingClientRect();
          const top = (rect?.bottom ?? 100) + 4;
          const left = rect?.left ?? 100;
          return (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setShowDedupPicker(false)} />
              <div style={{
                position: 'fixed', top, left, zIndex: 9999,
                background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                borderRadius: 10, padding: '10px 14px', minWidth: 220, maxWidth: 320,
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted-color)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#3aaa6b', display: 'inline-block' }} />
                  选择去重依据列
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 8, maxHeight: 200, overflowY: 'auto' }}>
                  {config.rawColumns.map((col) => (
                    <label key={col} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer', color: 'var(--text-color)' }}>
                      <input type="checkbox" checked={config.dedupColumns.includes(col)}
                        onChange={(e) => setConfig((c) => ({
                          ...c,
                          dedupColumns: e.target.checked ? [...c.dedupColumns, col] : c.dedupColumns.filter((d) => d !== col),
                        }))} />
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{col}</span>
                    </label>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 10, marginBottom: 8 }}>
                  {([['first', '保留第一条'], ['last', '保留最后一条']] as const).map(([val, label]) => (
                    <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, cursor: 'pointer', color: 'var(--text-color)' }}>
                      <input type="radio" name="dp-dedup-keep" checked={config.dedupKeep === val} onChange={() => setConfig((c) => ({ ...c, dedupKeep: val }))} />
                      {label}
                    </label>
                  ))}
                </div>
                <button className="dp-btn dp-btn-green" style={{ width: '100%', justifyContent: 'center' }}
                  disabled={config.dedupColumns.length === 0}
                  onClick={() => { handleDedup(); setShowDedupPicker(false); }}>
                  <Trash2 size={12} /> 确认去重 ({config.dedupColumns.length} 列)
                </button>
              </div>
            </>
          );
        })()
        , document.body
      )}

      {/* ─── AI Picker (portal to body) ── */}
      {showAIPicker && createPortal(
        (() => {
          const rect = aiBtnRef.current?.getBoundingClientRect();
          const top = (rect?.bottom ?? 100) + 4;
          // anchor to the right to avoid overflow
          const right = window.innerWidth - (rect?.right ?? 300);
          return (
            <>
              <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setShowAIPicker(false)} />
              <div style={{
                position: 'fixed', top, right, zIndex: 9999,
                background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                borderRadius: 10, padding: '12px 14px', width: 420, maxHeight: '70vh', overflowY: 'auto',
                boxShadow: '0 8px 24px rgba(0,0,0,0.25)',
              }}>
                <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted-color)', marginBottom: 8, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e57c26', display: 'inline-block' }} />
                  AI 指令设置
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
                  {config.aiInstructions.map((inst, idx) => (
                    <InstructionEditor
                      key={inst.id}
                      inst={inst}
                      rawColumns={config.rawColumns}
                      aiOutputCols={aiOutputColumns.filter((c) => c !== inst.outputColumn)}
                      promptPresets={promptPresets}
                      onChange={(updated) => setConfig((c) => ({ ...c, aiInstructions: c.aiInstructions.map((i) => (i.id === inst.id ? updated : i)) }))}
                      onDelete={() => setConfig((c) => ({ ...c, aiInstructions: c.aiInstructions.filter((i) => i.id !== inst.id) }))}
                      onMoveUp={
                        idx > 0
                          ? () =>
                              setConfig((c) => {
                                const arr = [...c.aiInstructions];
                                [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
                                return { ...c, aiInstructions: arr };
                              })
                          : undefined
                      }
                      onMoveDown={
                        idx < config.aiInstructions.length - 1
                          ? () =>
                              setConfig((c) => {
                                const arr = [...c.aiInstructions];
                                [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
                                return { ...c, aiInstructions: arr };
                              })
                          : undefined
                      }
                      onSavePromptPreset={savePromptPreset}
                      onLoadPromptPreset={() => {}}
                      onDeletePromptPreset={deletePromptPreset}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6, position: 'relative' }}>
                  <button ref={addAgentBtnRefModal} className="dp-btn dp-btn-orange" style={{ flex: 1 }}
                    onClick={() => setShowAddAgentPickerModal(v => !v)}>
                    <Plus size={12} /> 增加处理节点 <span style={{ fontSize: 9, opacity: 0.7 }}>▼</span>
                  </button>
                  <button className="dp-btn dp-btn-orange" onClick={() => { setBatchInstText(''); setShowBatchInstModal(true); }}>
                    <ClipboardPaste size={12} /> 批量粘贴
                  </button>
                  {showAddAgentPickerModal && createPortal(
                    <>
                       <div style={{ position: 'fixed', inset: 0, zIndex: 9998 }} onClick={() => setShowAddAgentPickerModal(false)} />
                       <div style={{
                          position: 'fixed',
                          top: (addAgentBtnRefModal.current?.getBoundingClientRect().bottom ?? 0) + 4,
                          left: addAgentBtnRefModal.current?.getBoundingClientRect().left ?? 0,
                          zIndex: 9999,
                          background: 'var(--surface-color)', border: '1px solid var(--border-color)',
                          borderRadius: 8, padding: 8, width: 220,
                          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
                       }} onClick={e => e.stopPropagation()}>
                          <div style={{ fontSize: 10, color: 'var(--text-muted-color)', fontWeight: 700, marginBottom: 4 }}>普通指令</div>
                          <button className="dp-btn" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 8, background: 'none', border: 'none' }}
                            onClick={() => {
                               setConfig((c) => { 
                                 const src = c.rawColumns[0] || ''; 
                                 return { ...c, aiInstructions: [...c.aiInstructions, { id: uuid(), name: `指令 ${c.aiInstructions.length + 1}`, prompt: '', outputColumn: src ? `${src}_ai处理` : `AI处理_${c.aiInstructions.length + 1}`, sourceColumn: src }] }; 
                               });
                               setShowAddAgentPickerModal(false);
                            }}>
                            <Sparkles size={14} style={{ color: '#e57c26' }} /> ✨ 自定义 Prompt 节点
                          </button>

                          <div style={{ fontSize: 10, color: 'var(--text-muted-color)', fontWeight: 700, marginBottom: 4 }}>独立专业工具 (Agent)</div>
                          {AgentRegistry.map(agent => (
                             <button key={agent.id} className="dp-btn" style={{ width: '100%', justifyContent: 'flex-start', marginBottom: 2, background: 'none', border: 'none' }}
                               title={agent.description}
                               onClick={() => {
                                 setConfig((c) => { 
                                   const src = c.rawColumns[0] || ''; 
                                   return { ...c, aiInstructions: [...c.aiInstructions, { id: uuid(), name: agent.name, prompt: '', outputColumn: '', sourceColumn: src, agentId: agent.id, agentConfig: {} }] }; 
                                 });
                                 setShowAddAgentPickerModal(false);
                               }}>
                               <span style={{ color: 'var(--brand-color)' }}>{agent.icon}</span> {agent.name}
                             </button>
                          ))}
                       </div>
                    </>,
                    document.body
                  )}
                </div>
                <div style={{ display: 'flex', gap: 8, marginTop: 10, flexWrap: 'wrap' }}>
                  {([
                    { label: '每批次行数', key: 'batchSize', min: 1, max: 50, w: 48 },
                    { label: '并发数', key: 'concurrency', min: 1, max: 10, w: 36 },
                    { label: '最大重试', key: 'maxRetries', min: 0, max: 5, w: 36 },
                  ] as const).map(({ label, key, min, max, w }) => (
                    <label key={key} className="dp-batch-count-label">
                      {label}
                      <input
                        type="number" min={min} max={max}
                        value={config[key]}
                        onChange={(e) => setConfig((c) => ({ ...c, [key]: Math.max(min, +e.target.value) }))}
                        style={{ width: w }}
                      />
                    </label>
                  ))}
                </div>
                <button className="dp-btn dp-btn-orange" style={{ width: '100%', justifyContent: 'center', marginTop: 10, fontWeight: 700 }}
                  disabled={config.aiInstructions.length === 0 || config.aiInstructions.every((i) => !i.agentId && (!i.prompt || !i.prompt.trim()))}
                  onClick={() => { setShowAIPicker(false); handleRunAI(); }}>
                  <Sparkles size={13} /> 开始运行 ({activeRows.filter((r) => r.status !== 'done').length} 行待处理)
                </button>
              </div>
            </>
          );
        })()
        , document.body
      )}

      {/* ─── Paste Modal (portal to body) ── */}
      {showPastePanel && createPortal(
        <div className="dp-modal-overlay" onClick={() => setShowPastePanel(false)}>
          <div className="dp-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ClipboardPaste size={16} style={{ color: '#e05252' }} /> 粘贴数据（从 Google Sheets 复制）
            </h3>
            <p>直接在下方粘贴，支持多列。首行会被识别为列名。</p>
            <textarea
              ref={pasteRef}
              className="dp-textarea"
              style={{ height: 140, marginBottom: 10 }}
              placeholder="在此粘贴从 Google Sheets 复制的数据（Ctrl+V）..."
              onPaste={async (e) => {
                e.preventDefault();
                const html = e.clipboardData.getData('text/html');
                const text = e.clipboardData.getData('text/plain');
                if (html && html.includes('google-sheets-html-origin')) {
                  try {
                    const wb = await readWorkbookFromHtml(html);
                    handlePasteFromWorkbook(wb);
                    (e.target as HTMLTextAreaElement).value = text || '（已解析 Google Sheets HTML 格式）';
                    return;
                  } catch { /* fall through */ }
                }
                if (text) {
                  handlePaste(text);
                  (e.target as HTMLTextAreaElement).value = text;
                  setRawPasteText(text);
                }
              }}
              onChange={(e) => handlePaste(e.target.value)}
            />

            {pasteHeaders.length > 0 && (
              <div style={{ marginBottom: 10 }}>
                <p style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                  <span>检测到 <strong>{pasteHeaders.length}</strong> 列{pastePreview.length > 0 ? `，${pastePreview.length}+ 行数据` : ''}，点击选择要导入的列：</span>
                  <span style={{ fontSize: 11, color: 'var(--text-muted-color)', cursor: 'pointer' }}
                    onClick={() => {
                      if (selectedColumns.size === pasteHeaders.length) setSelectedColumns(new Set());
                      else setSelectedColumns(new Set(pasteHeaders));
                    }}>
                    {selectedColumns.size === pasteHeaders.length ? '取消全选' : '全选'}
                  </span>
                  <div style={{ flex: 1 }} />
                  <label style={{ fontSize: 11, display: 'flex', alignItems: 'center', gap: 4, fontWeight: 'normal', color: 'var(--text-muted-color)' }}>
                    <input type="checkbox" checked={pasteHasHeaders} onChange={(e) => {
                       const checked = e.target.checked;
                       setPasteHasHeaders(checked);
                       if (pasteWbRef.current) {
                         handlePasteFromWorkbook(pasteWbRef.current, checked);
                       } else {
                         handlePaste(rawPasteText, checked);
                       }
                    }} /> 识别首行为标题
                  </label>
                </p>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 6 }}>
                  {pasteHeaders.map((h) => {
                    const isSelected = selectedColumns.has(h);
                    return (
                      <span
                        key={h}
                        title={h}
                        onClick={() => setSelectedColumns((prev) => {
                          const next = new Set(prev);
                          if (next.has(h)) next.delete(h); else next.add(h);
                          return next;
                        })}
                        style={{
                          display: 'inline-flex', alignItems: 'center', gap: 4,
                          padding: '3px 10px', borderRadius: 12, fontSize: 12, fontWeight: 600,
                          cursor: 'pointer', transition: 'all 0.15s',
                          maxWidth: 280, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                          background: isSelected ? 'rgba(224,82,82,0.15)' : 'var(--control-bg-color)',
                          color: isSelected ? '#e05252' : 'var(--text-muted-color)',
                          border: isSelected ? '1px solid rgba(224,82,82,0.3)' : '1px solid var(--border-color)',
                          opacity: isSelected ? 1 : 0.5,
                          textDecoration: isSelected ? 'none' : 'line-through',
                        }}
                      >
                        {isSelected ? '✓ ' : ''}{h}
                      </span>
                    );
                  })}
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted-color)', marginTop: 4 }}>
                  已选 {selectedColumns.size}/{pasteHeaders.length} 列
                </p>
                {autoDisabledHeaders && (
                  <div style={{ marginTop: 8, padding: '6px 10px', background: 'rgba(245, 158, 11, 0.1)', color: '#d97706', borderRadius: 6, fontSize: 12, display: 'flex', alignItems: 'flex-start', gap: 6 }}>
                    <AlertTriangle size={14} style={{ marginTop: 2, flexShrink: 0 }} />
                    <div style={{ lineHeight: 1.4 }}>
                      系统检测到首行看起来像是数据内容（长度较长），已为您<strong>自动取消勾选</strong>「识别首行为标题」。如需恢复，请手动勾选。
                    </div>
                  </div>
                )}
              </div>
            )}

            {pastePreview.length > 0 && (
              <div style={{ marginBottom: 10, overflowX: 'auto' }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted-color)' }}>前 {Math.min(pastePreview.length, 6)} 行预览：</p>
                <table className="dp-table" style={{ minWidth: 'auto' }}>
                  <thead>
                    <tr style={{ background: 'var(--control-bg-color)' }}>
                      {pasteHeaders.map((h, i) => (
                        <th key={i} style={{ padding: '2px 4px', background: 'var(--control-bg-color)' }}>
                          <input 
                            className="dp-input" 
                            style={{ width: '100%', fontSize: 12, fontWeight: 600, color: 'var(--text-muted-color)', background: 'transparent', border: '1px solid transparent', padding: '2px 4px' }}
                            value={h}
                            title="点击可直接修改列名"
                            onFocus={e => e.target.style.border = '1px solid var(--border-color)'}
                            onBlur={e => e.target.style.border = '1px solid transparent'}
                            onChange={(e) => {
                              const newVal = e.target.value;
                              const oldVal = pasteHeaders[i];
                              setPasteHeaders(prev => {
                                const next = [...prev];
                                next[i] = newVal;
                                return next;
                              });
                              setSelectedColumns(prev => {
                                if (prev.has(oldVal)) {
                                  const next = new Set(prev);
                                  next.delete(oldVal);
                                  next.add(newVal);
                                  return next;
                                }
                                return prev;
                              });
                            }}
                          />
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {pastePreview.map((row, i) => (
                      <tr key={i}>{pasteHeaders.map((_, j) => <td key={j}>{row[j] != null ? String(row[j]) : ''}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="dp-btn" onClick={() => setShowPastePanel(false)}>取消</button>
              <button className="dp-btn" style={{ background: '#e05252', color: '#fff', border: 'none' }}
                disabled={selectedColumns.size === 0}
                onClick={confirmImport}>
                确认导入 ({selectedColumns.size} 列)
              </button>
            </div>
          </div>
        </div>
        , document.body
      )}

      {/* ─── Batch Instructions Modal (portal to body) ── */}
      {showBatchInstModal && createPortal(
        <div className="dp-modal-overlay" onClick={() => setShowBatchInstModal(false)}>
          <div className="dp-modal" onClick={(e) => e.stopPropagation()}>
            <h3 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <ClipboardPaste size={16} style={{ color: '#e57c26' }} /> 批量粘贴 AI 指令
            </h3>
            <p>
              格式：每行两列，<strong>第一列是输出列名</strong>，<strong>第二列是指令内容</strong>。
              可直接从 Google Sheets 复制两列粘贴。
            </p>
            <textarea
              className="dp-textarea"
              style={{ height: 180, marginBottom: 10 }}
              placeholder={'中文翻译\t请把这段话翻译成英文：{原文}\n大类\t请对内容分类，返回：电子/服装/家居：{原文}\n情感分析\t分析情感倒向，返回正面/中性/负面：{原文}'}
              value={batchInstText}
              onChange={(e) => setBatchInstText(e.target.value)}
              onPaste={(e) => { e.preventDefault(); const text = e.clipboardData.getData('text'); setBatchInstText(text); }}
            />

            {batchInstText.trim() && (() => {
              const lines = batchInstText.split(/\r?\n/).filter(l => l.trim());
              const parsed = lines.map(l => l.split('\t'));
              return (
                <div style={{ marginBottom: 10 }}>
                  <p>解析预览（{parsed.length} 条指令）：</p>
                  <div style={{ maxHeight: 120, overflowY: 'auto', border: '1px solid var(--border-color)', borderRadius: 6 }}>
                    {parsed.map((cols, i) => (
                      <div key={i} style={{ display: 'flex', gap: 8, padding: '4px 8px', fontSize: 12, background: i % 2 === 0 ? 'var(--control-bg-color)' : 'transparent' }}>
                        <span style={{ fontWeight: 600, color: '#e57c26', width: 100, flexShrink: 0, overflow: 'hidden', textOverflow: 'ellipsis' }}>{cols[0] || <span style={{ color: '#ef4444' }}>缺少列名</span>}</span>
                        <span style={{ color: 'var(--text-muted-color)', overflow: 'hidden', textOverflow: 'ellipsis', flex: 1, whiteSpace: 'nowrap' }}>{cols[1] || '（无指令内容）'}</span>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })()}

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
              <button className="dp-btn" onClick={() => setShowBatchInstModal(false)}>取消</button>
              <button className="dp-btn" style={{ background: '#e57c26', color: '#fff', border: 'none' }}
                disabled={!batchInstText.trim()}
                onClick={() => {
                  const lines = batchInstText.split(/\r?\n/).filter(l => l.trim());
                  const newInsts = lines.map(l => l.split('\t')).filter(cols => cols[0]?.trim())
                    .map(cols => ({ id: uuid(), name: cols[0].trim(), outputColumn: cols[0].trim(), prompt: (cols[1] ?? '').trim(), sourceColumn: config.rawColumns[0] || '' }));
                  if (newInsts.length === 0) return;
                  setConfig(c => ({ ...c, aiInstructions: [...c.aiInstructions, ...newInsts] }));
                  setShowBatchInstModal(false);
                  log(`✅ 批量导入 ${newInsts.length} 条 AI 指令`);
                }}>
                导入 {batchInstText.trim() ? batchInstText.split(/\r?\n/).filter(l => l.trim()).length : 0} 条指令
              </button>
            </div>
          </div>
        </div>
        , document.body
      )}

      {/* ─── Main Grid (always visible, Ctrl+V anywhere to paste) ── */}
      <div
        style={{ flex: 1, overflow: 'auto', position: 'relative' }}
        tabIndex={0}
        onPaste={async (e) => {
          e.preventDefault();
          const html = e.clipboardData.getData('text/html');
          const text = e.clipboardData.getData('text/plain');
          // 优先使用 HTML 格式（Google Sheets 完整保留单元格结构）
          if (html && html.includes('google-sheets-html-origin')) {
            try {
              const wb = await readWorkbookFromHtml(html);
              handlePasteFromWorkbook(wb);
              return;
            } catch (err) {
              console.warn('[DataPipeline] HTML parse failed, falling back to text:', err);
            }
          }
          // Fallback to text
          if (text?.trim()) handlePaste(text);
        }}
      >
        <table className="dp-table" style={{ tableLayout: 'fixed' }} ref={tableRef}>
          <colgroup>
            <col style={{ width: 36 }} />
            <col style={{ width: 44 }} />
            {config.rawColumns.map((col) => (
              <col key={col} data-col={col} style={{ width: getColWidth(col) }} />
            ))}
            {aiOutputColumns.map((col) => (
              <col key={col} data-col={col} style={{ width: getColWidth(col) }} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <th className="dp-col-num" style={{ background: '#374151' }}>#</th>
              <th style={{ background: '#374151' }}>状态</th>
              {config.rawColumns.map((col) => (
                <th key={col} className={highlightedCols.has(col) ? 'dp-th-selected' : ''}
                  style={{ height: headerHeight ? `${headerHeight}px` : undefined, background: highlightedCols.has(col) ? '#2563eb' : STAGE_COLORS.s1, position: 'relative' }}
                  onMouseDown={(e) => handleColumnMouseDown(col, e)}
                  onMouseEnter={() => handleColumnMouseEnter(col)}
                  title={`点击选中整列「${col}」`}>
                  <span style={{ display: 'block', height: '100%', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-all' }}>{col}</span>
                  <div className="dp-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, col); }} />
                  <div className="dp-header-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onHeaderResizeStart(e); }} />
                </th>
              ))}
              {aiOutputColumns.map((col) => (
                <th key={col} className={highlightedCols.has(col) ? 'dp-th-selected' : ''}
                  style={{ height: headerHeight ? `${headerHeight}px` : undefined, background: highlightedCols.has(col) ? '#2563eb' : STAGE_COLORS.s3, position: 'relative' }}
                  onMouseDown={(e) => handleColumnMouseDown(col, e)}
                  onMouseEnter={() => handleColumnMouseEnter(col)}
                  title={`点击选中整列「${col}」`}>
                  <span style={{ display: 'block', height: '100%', overflow: 'hidden', whiteSpace: 'normal', wordBreak: 'break-all' }}>{col}</span>
                  <div className="dp-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, col); }} />
                  <div className="dp-header-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onHeaderResizeStart(e); }} />
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {activeRows.length > 0 ? activeRows.map((row, idx) => (
                <tr key={row.id} className={row.status === 'error' ? 'dp-row-error' : row.status === 'done' ? 'dp-row-done' : ''}>
                  <td className={`dp-col-num ${selectedRowIndices.has(idx) ? 'dp-rownum-selected' : ''}`}
                    style={{ cursor: 'pointer', background: selectedRowIndices.has(idx) ? '#2563eb' : undefined, color: selectedRowIndices.has(idx) ? '#fff' : undefined }}
                    onMouseDown={(e) => handleRowMouseDown(idx, e)}
                    onMouseEnter={() => handleRowMouseEnter(idx)}
                  >{idx + 1}</td>
                  <td style={{ textAlign: 'center', position: 'relative' }}>
                    {row.status === 'processing' && <Loader2 size={12} className="animate-spin" style={{ color: '#e57c26', margin: 'auto' }} />}
                    {row.status === 'done' && <CheckCircle2 size={12} style={{ color: '#3aaa6b', margin: 'auto' }} />}
                    {row.status === 'error' && <span title={row.errorMsg}><AlertCircle size={12} style={{ color: '#ef4444', margin: 'auto' }} /></span>}
                    {row.status === 'idle' && <span style={{ color: 'var(--text-muted-color)' }}>·</span>}
                    <div className="dp-row-actions">
                      <button className="dp-row-action-btn" onClick={(e) => { e.stopPropagation(); handleRunAI([row.id]); }} data-tooltip="单独运行此行">
                        <Zap size={14} style={{ color: '#e57c26' }} />
                      </button>
                      {row.aiLogs && row.aiLogs.length > 0 && (
                        <button className="dp-row-action-btn" onClick={(e) => { e.stopPropagation(); setViewLogsFor(row.id); }} data-tooltip="查看 AI 完整日志">
                          <Eye size={14} style={{ color: '#3b82f6' }} />
                        </button>
                      )}
                    </div>
                  </td>
                  {config.rawColumns.map((col) => {
                    const cellKey = `${row.id}:${col}`;
                    const isFocus = focusCell?.rowId === row.id && focusCell?.col === col;
                    const isSelected = selectedCells.has(cellKey);
                    const isEditing = editingCell?.rowId === row.id && editingCell?.col === col;
                    return (
                      <td key={col} title={isEditing ? undefined : row.raw[col]}
                        className={`${isSelected ? 'dp-cell-selected' : ''} ${isFocus ? 'dp-cell-focus' : ''}`}
                        onMouseDown={(e) => handleCellMouseDown(row.id, col, e)}
                        onMouseEnter={() => handleCellMouseEnter(row.id, col)}
                        onDoubleClick={() => handleCellDoubleClick(row.id, col)}
                      >
                        {isEditing ? (
                          <textarea
                            ref={editInputRef}
                            className="dp-cell-edit"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => { if (e.key === 'Escape') { setEditingCell(null); } }}
                          />
                        ) : (
                          <CellContent value={row.raw[col]} />
                        )}
                      </td>
                    );
                  })}
                  {aiOutputColumns.map((col) => {
                    const cellKey = `${row.id}:${col}`;
                    const isFocus = focusCell?.rowId === row.id && focusCell?.col === col;
                    const isSelected = selectedCells.has(cellKey);
                    const isEditing = editingCell?.rowId === row.id && editingCell?.col === col;
                    return (
                      <td key={col} title={isEditing ? undefined : row.ai[col]}
                        className={`${isSelected ? 'dp-cell-selected' : ''} ${isFocus ? 'dp-cell-focus' : ''}`}
                        onMouseDown={(e) => handleCellMouseDown(row.id, col, e)}
                        onMouseEnter={() => handleCellMouseEnter(row.id, col)}
                        onDoubleClick={() => handleCellDoubleClick(row.id, col)}
                      >
                        {isEditing ? (
                          <textarea
                            ref={editInputRef}
                            className="dp-cell-edit"
                            value={editValue}
                            onChange={(e) => setEditValue(e.target.value)}
                            onBlur={commitEdit}
                            onKeyDown={(e) => { if (e.key === 'Escape') { setEditingCell(null); } }}
                          />
                        ) : row.status === 'processing' ? (
                          row.ai[col] 
                            ? <span style={{ color: 'var(--text-color)' }}>{row.ai[col]}</span> 
                            : <span style={{ color: '#e57c26', fontStyle: 'italic' }}>处理中...</span>
                        ) : (
                          <span style={{ color: row.ai[col] ? 'var(--text-color)' : 'var(--text-muted-color)' }}>{row.ai[col] ?? '—'}</span>
                        )}
                      </td>
                    );
                  })}
                </tr>
              )) : (
              // ―― Empty ghost rows + paste hint ――
              <>
                {Array.from({ length: 8 }).map((_, i) => (
                  <tr key={i} style={{ opacity: 0.35 }}>
                    <td className="dp-col-num" style={{ color: 'var(--text-muted-color)' }}>{i + 1}</td>
                    <td />
                    {config.rawColumns.map((col) => <td key={col} />)}
                    {aiOutputColumns.map((col) => <td key={col} />)}
                  </tr>
                ))}
                <tr>
                  <td
                    colSpan={2 + config.rawColumns.length + aiOutputColumns.length}
                    style={{
                      textAlign: 'center',
                      padding: '28px 0',
                      color: 'var(--text-muted-color)',
                      fontSize: 13,
                      pointerEvents: 'none',
                      borderBottom: 'none',
                    }}
                  >
                    ⤵ 在此区域按 <kbd style={{ background: 'var(--control-bg-color)', border: '1px solid var(--border-color)', borderRadius: 4, padding: '1px 6px', fontSize: 11 }}>Ctrl+V</kbd> 直接粘贴 Google Sheets 数据
                  </td>
                </tr>
              </>
            )}
          </tbody>
        </table>
      </div>

      {/* ─── Dedup Audit ── */}
      {dedupedRows.length > 0 && (
        <div className="dp-dedup-bar">
          <button className="dp-dedup-toggle" onClick={() => setShowDedupAudit((v) => !v)}>
            {showDedupAudit ? <EyeOff size={12} /> : <Eye size={12} />}
            已去重行审计 ({dedupedRows.length} 行) — 点击查看
            <span style={{ flex: 1 }} />
            <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#3aaa6b', fontSize: 12 }}
              onClick={(e) => { e.stopPropagation(); handleUndoDedup(); }}>
              ↩ 全部恢复
            </button>
          </button>
          {showDedupAudit && (
            <div style={{ maxHeight: 120, overflowY: 'auto', overflowX: 'auto' }}>
              <table className="dp-table">
                <tbody>
                  {dedupedRows.map((row, i) => (
                    <tr key={row.id} className="dp-dedup-row">
                      <td className="dp-col-num">{i + 1}</td>
                      {config.rawColumns.map((col) => <td key={col}>{row.raw[col] ?? ''}</td>)}
                      <td style={{ color: '#3aaa6b', fontSize: 11, whiteSpace: 'nowrap' }}>重复键: {row.dedupKey}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* ─── Log ── */}
      {runLog.length > 0 && (
        <div className="dp-log">
          {runLog.map((l, i) => <div key={i}>{l}</div>)}
        </div>
      )}

      {/* ─── Error bar ── */}
      {errorRows.length > 0 && !isRunningAI && (
        <div className="dp-error-bar">
          <AlertCircle size={13} />
          <span>{errorRows.length} 行处理失败</span>
          <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', fontSize: 12, textDecoration: 'underline', display: 'flex', alignItems: 'center', gap: 4 }}
            onClick={handleRetryErrors}>
            <RotateCcw size={12} /> 重置并重跑
          </button>
        </div>
      )}

      {/* ─── Expanded Cell View Modal ── */}
      {expandedCell && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setExpandedCell(null)}>
          <div style={{ background: 'var(--surface-color)', borderRadius: 12, padding: 20, width: '80%', maxWidth: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.4)', position: 'relative' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 4 }}>
              <div style={{ fontWeight: 600, fontSize: 14 }}>
                查看单元格: <span style={{ color: 'var(--text-muted-color)' }}>{expandedCell.col}</span>
              </div>
              <button 
                onClick={async () => {
                   try {
                     await navigator.clipboard.writeText(expandedCell.value);
                   } catch { /* ignore */ }
                }}
                className="dp-btn" style={{ padding: '4px 8px', fontSize: 11, background: 'none' }} title="复制内容">
                <Copy size={12} /> 复制
              </button>
            </div>
            <textarea
              autoFocus
              className="dp-input"
              style={{ flex: 1, minHeight: 200, fontSize: 13, lineHeight: '1.5', padding: 12, resize: 'none' }}
              value={expandedCell.value}
              onChange={(e) => setExpandedCell({ ...expandedCell, value: e.target.value })}
              onKeyDown={(e) => {
                // Ignore usual table shortcuts inside this textarea
                e.stopPropagation();
                if (e.key === 'Escape') setExpandedCell(null);
                // Ctrl+Enter or Cmd+Enter to save
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                   setRows((prev) => prev.map((r) => {
                     if (r.id !== expandedCell.rowId) return r;
                     if (!expandedCell.isOutput) {
                       return { ...r, raw: { ...r.raw, [expandedCell.col]: expandedCell.value } };
                     } else {
                       return { ...r, ai: { ...r.ai, [expandedCell.col]: expandedCell.value } };
                     }
                   }));
                   setExpandedCell(null);
                }
              }}
            />
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 }}>
              <div style={{ fontSize: 11, color: 'var(--text-muted-color)' }}>
                按 <kbd style={{ background: 'var(--control-bg-color)', padding: '2px 4px', borderRadius: 4 }}>Esc</kbd> 关闭，
                按 <kbd style={{ background: 'var(--control-bg-color)', padding: '2px 4px', borderRadius: 4 }}>Cmd/Ctrl+Enter</kbd> 保存
              </div>
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="dp-btn" onClick={() => setExpandedCell(null)}>取消</button>
                <button className="dp-btn dp-btn-orange" onClick={() => {
                  setRows((prev) => prev.map((r) => {
                    if (r.id !== expandedCell.rowId) return r;
                    if (!expandedCell.isOutput) {
                       return { ...r, raw: { ...r.raw, [expandedCell.col]: expandedCell.value } };
                    } else {
                       return { ...r, ai: { ...r.ai, [expandedCell.col]: expandedCell.value } };
                    }
                  }));
                  setExpandedCell(null);
                }}>保存</button>
              </div>
            </div>
            <button style={{ position: 'absolute', top: 12, right: 12, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted-color)' }}
              onClick={() => setExpandedCell(null)}>
              <X size={16} />
            </button>
          </div>
        </div>,
        document.body
      )}

      {/* ─── View Logs Modal ── */}
      {viewLogsFor && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setViewLogsFor(null)}>
          <div style={{ background: 'var(--surface-color)', borderRadius: 12, padding: '20px 24px', width: '90%', maxWidth: 900, maxHeight: '85vh', display: 'flex', flexDirection: 'column', gap: 14, boxShadow: '0 12px 40px rgba(0,0,0,0.4)', position: 'relative' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderBottom: '1px solid var(--border-color)', paddingBottom: 12 }}>
              <div style={{ fontWeight: 600, fontSize: 16, display: 'flex', alignItems: 'center', gap: 8 }}>
                <Eye size={16} style={{ color: '#3b82f6' }} />
                AI 处理日志分析 (ID: {viewLogsFor.substring(0, 8)})
              </div>
              <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted-color)' }}
                onClick={() => setViewLogsFor(null)}>
                <X size={18} />
              </button>
            </div>
            <div style={{ flex: 1, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 16, paddingRight: 8 }}>
              {rows.find((r) => r.id === viewLogsFor)?.aiLogs?.length ? (
                rows.find((r) => r.id === viewLogsFor)!.aiLogs!.map((log, idx) => (
                  <div key={idx} style={{ background: 'var(--bg-color)', borderRadius: 8, padding: 16, border: '1px solid var(--border-color)' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <span style={{ background: '#e57c26', color: '#fff', fontSize: 11, padding: '2px 8px', borderRadius: 12, fontWeight: 500 }}>{log.phase}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-muted-color)' }}>{log.time}</span>
                      </div>
                      <span style={{ fontSize: 11, color: 'var(--text-muted-color)', background: 'var(--control-bg-color)', padding: '2px 6px', borderRadius: 4 }}>
                        耗时: {(log.runtimeMs / 1000).toFixed(2)}s
                      </span>
                    </div>
                    <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 16 }}>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted-color)', marginBottom: 6, textTransform: 'uppercase' }}>📤 请求报文 (Request Payload)</div>
                        <pre style={{ margin: 0, padding: 10, background: 'rgba(0,0,0,0.03)', borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflowY: 'auto' }}>
                          {log.request}
                        </pre>
                      </div>
                      <div>
                        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted-color)', marginBottom: 6, textTransform: 'uppercase' }}>📥 响应数据 (Response Data)</div>
                        <pre style={{ margin: 0, padding: 10, background: 'rgba(58, 170, 107, 0.05)', border: '1px solid rgba(58, 170, 107, 0.2)', borderRadius: 6, fontSize: 11, whiteSpace: 'pre-wrap', wordBreak: 'break-all', maxHeight: 300, overflowY: 'auto' }}>
                          {log.response || '<Empty Response>'}
                        </pre>
                      </div>
                    </div>
                  </div>
                ))
              ) : (
                <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted-color)', fontSize: 13 }}>
                  暂无日志记录
                </div>
              )}
            </div>
          </div>
        </div>,
        document.body
      )}
    </div>
  );
};

export default DataPipelinePanel;
