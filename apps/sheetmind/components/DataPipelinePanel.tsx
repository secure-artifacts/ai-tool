
/**
 * DataPipelinePanel — 数据整理入库
 * 四阶段彩色数据流水线。全局主题自适应（暗色/亮色/护眼）。
 */

import React, {
  useState,
  useRef,
  useCallback,
  useEffect,
  useMemo,
} from 'react';
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
} from 'lucide-react';
import { GoogleGenAI } from '@google/genai';
import * as XLSX from 'xlsx';
import { readWorkbookFromHtml, extractImageFromFormula, fetchImageAsBase64 } from '../utils/parser';
import type { SheetData } from '../types';
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
}

export interface AiInstruction {
  id: string;
  name: string;
  prompt: string;
  outputColumn: string;
  /** Column whose data is fed to AI as input */
  sourceColumn: string;
}

export interface PipelineConfig {
  rawColumns: string[];
  dedupColumns: string[];
  dedupKeep: 'first' | 'last';
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

  const outputSpec = instructions
    .map((inst) => `"${inst.outputColumn}": "<${inst.name}的处理结果>"`)
    .join(', ');

  const instructionList = instructions
    .map((inst, i) => `指令${i + 1}【${inst.name}】处理列「${inst.sourceColumn}」→ 输出列名"${inst.outputColumn}"：\n${inst.prompt}`)
    .join('\n\n');

  return `你是一个专业的数据处理助手。请对以下 ${rows.length} 行数据依次执行所有指令，严格按照 JSON 数组格式返回结果，不要输出任何多余内容。

## 数据（JSON 数组，每项含 __id 字段作为行号）
${JSON.stringify(rowsJson, null, 2)}

## 指令列表
${instructionList}

## 返回格式（严格 JSON 数组，与输入行数相同，每项含 __id + 各输出列）
[
  { "__id": 0, ${outputSpec} },
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
  onSavePromptPreset: (name: string, prompt: string) => void;
  onLoadPromptPreset: (preset: PromptPreset) => void;
  onDeletePromptPreset: (id: string) => void;
}) {
  const [customCol, setCustomCol] = useState('');
  const [showCustomCol, setShowCustomCol] = useState(false);
  const [showPromptPresets, setShowPromptPresets] = useState(false);
  const [showExpandedEdit, setShowExpandedEdit] = useState(false);
  const presetBtnRef = useRef<HTMLButtonElement>(null);
  const allSourceCols = [...rawColumns, ...aiOutputCols];
  const existingOutputCols = [...new Set([...rawColumns, ...aiOutputCols, inst.outputColumn].filter(Boolean))];

  // Load global presets from all app modules
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
    } catch { /* ignore parse errors */ }
    return groups;
  }, [showPromptPresets]); // re-read when dropdown opens

  return (
    <div className="dp-inst-card" style={{ padding: '6px 8px' }}>
      {/* Single row: Source → Output | Prompt | Delete */}
      <div style={{ display: 'flex', gap: 5, alignItems: 'center' }}>
        {/* Source column */}
        <select className="dp-input" style={{ width: 100, flexShrink: 0, cursor: 'pointer', fontSize: 11 }}
          value={inst.sourceColumn}
          onChange={(e) => {
            const newSrc = e.target.value;
            const autoOut = newSrc ? `${newSrc}_ai处理` : inst.outputColumn;
            // Auto-rename output if it still follows the default pattern
            const isDefaultPattern = /^(AI处理_\d+|.*_ai处理)$/.test(inst.outputColumn);
            onChange({ ...inst, sourceColumn: newSrc, ...(isDefaultPattern ? { outputColumn: autoOut } : {}) });
          }}
          title="处理数据列">
          {!allSourceCols.includes(inst.sourceColumn) && inst.sourceColumn && <option value={inst.sourceColumn}>{inst.sourceColumn}</option>}
          {allSourceCols.map((col) => <option key={col} value={col}>{col}</option>)}
        </select>

        <span style={{ color: 'var(--text-muted-color)', fontSize: 11, flexShrink: 0 }}>→</span>

        {/* Output column */}
        {showCustomCol ? (
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

        {/* Prompt preview (single line, double-click to expand) */}
        <div style={{ flex: 1, minWidth: 0, position: 'relative' }}>
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
                <button className="dp-btn dp-btn-orange" style={{ width: '100%', fontSize: 10, marginTop: 4, justifyContent: 'center' }}
                  onClick={() => {
                    if (!inst.prompt.trim()) return;
                    const name = window.prompt('指令模板名称：', inst.name || `模板 ${promptPresets.length + 1}`);
                    if (name?.trim()) { onSavePromptPreset(name.trim(), inst.prompt); setShowPromptPresets(false); }
                  }}><Save size={10} /> 保存当前指令为模板</button>
              </div>
            </>,
            document.body
          )}
        </div>

        {/* Delete button */}
        <button onClick={onDelete}
          style={{ padding: 3, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted-color)', flexShrink: 0 }}
          title="删除指令"><X size={14} /></button>
      </div>

      {/* Expanded edit modal (double-click) */}
      {showExpandedEdit && createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 9999, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}
          onClick={() => setShowExpandedEdit(false)}>
          <div style={{ background: 'var(--surface-color)', borderRadius: 12, padding: 20, width: '80%', maxWidth: 700, maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 10, boxShadow: '0 12px 40px rgba(0,0,0,0.4)' }}
            onClick={(e) => e.stopPropagation()}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <Sparkles size={16} style={{ color: '#e57c26' }} />
              <span style={{ fontWeight: 700, color: 'var(--text-color)' }}>编辑 AI 指令</span>
              <span style={{ fontSize: 11, color: 'var(--text-muted-color)' }}>{inst.sourceColumn} → {inst.outputColumn}</span>
              <div style={{ flex: 1 }} />
              <button className="dp-btn" onClick={() => setShowExpandedEdit(false)}><X size={14} /> 关闭</button>
            </div>
            <textarea className="dp-textarea" style={{ flex: 1, minHeight: 300, fontSize: 13, lineHeight: 1.6 }}
              value={inst.prompt}
              onChange={(e) => onChange({ ...inst, prompt: e.target.value })}
              placeholder="输入 AI 处理指令..."
              autoFocus />
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
}

const DataPipelinePanel: React.FC<DataPipelinePanelProps> = ({ getAiInstance, modelId = 'gemini-2.0-flash', data: sheetData }) => {
  // ── Config ──────────────────────────────────
  const [config, setConfig] = useState<PipelineConfig>(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY + '_config');
      if (saved) return { ...DEFAULT_CONFIG, ...JSON.parse(saved) };
    } catch { /* ignore */ }
    return DEFAULT_CONFIG;
  });

  const [showConfig, setShowConfig] = useState(false);
  const [showBatchInstModal, setShowBatchInstModal] = useState(false);
  const [batchInstText, setBatchInstText] = useState('');
  const [newColName, setNewColName] = useState('');
  const [showAddColInput, setShowAddColInput] = useState(false);
  const [showDedupPicker, setShowDedupPicker] = useState(false);
  const dedupBtnRef = useRef<HTMLButtonElement>(null);
  const [showAIPicker, setShowAIPicker] = useState(false);
  const aiBtnRef = useRef<HTMLButtonElement>(null);

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
      if (saved) return JSON.parse(saved);
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
  const [runLog, setRunLog] = useState<string[]>([]);
  const abortRef = useRef(false);

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
    () => [...new Set(config.aiInstructions.map((i) => i.outputColumn).filter(Boolean))],
    [config.aiInstructions]
  );
  const allDisplayColumns = useMemo(
    () => [...config.rawColumns, ...aiOutputColumns],
    [config.rawColumns, aiOutputColumns]
  );

  // ── Google-Sheets-like cell interaction ──
  const [focusCell, setFocusCell] = useState<{ rowId: string; col: string } | null>(null);
  const [editingCell, setEditingCell] = useState<{ rowId: string; col: string } | null>(null);
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

  // Double-click to edit
  const handleCellDoubleClick = useCallback((rowId: string, col: string) => {
    const row = activeRows.find((r) => r.id === rowId);
    if (!row) return;
    const val = row.raw[col] ?? row.ai[col] ?? '';
    setEditingCell({ rowId, col });
    setEditValue(val);
    setTimeout(() => editInputRef.current?.focus(), 0);
  }, [activeRows]);

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
        return val.replace(/\t/g, ' ').replace(/\n/g, ' ');
      }).join('\t')
    );
    const tsv = lines.join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      log(`📋 已复制 ${selectedCells.size} 个单元格`);
    });
  }, [selectedCells, activeRows, allDisplayColumns, log]);

  // ── Keyboard navigation ──
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
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
  const colWidthsRef = useRef<Record<string, number>>({});
  colWidthsRef.current = columnWidths;
  const tableRef = useRef<HTMLTableElement>(null);

  const getColWidth = useCallback((col: string) => columnWidths[col] || DEFAULT_COL_WIDTH, [columnWidths]);

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
  /** Which columns user selected to import (default: all) */
  const [selectedColumns, setSelectedColumns] = useState<Set<string>>(new Set());

  /** Core paste handler — accepts a Workbook or falls back to TSV text */
  const handlePasteFromWorkbook = useCallback((wb: XLSX.WorkBook) => {
    pasteWbRef.current = wb;
    const { headers, dataRows } = workbookToGrid(wb);
    if (headers.length === 0 || dataRows.length === 0) return;
    setPasteHeaders(headers);
    setPastePreview(dataRows.slice(0, 6));
    const mapping: Record<string, string> = {};
    headers.forEach((h) => { mapping[h] = h; });
    setHeaderMapping(mapping);
    // Default: all columns selected
    setSelectedColumns(new Set(headers));
    setShowPastePanel(true);
  }, []);

  /** Legacy TSV fallback */
  const handlePaste = useCallback((text: string) => {
    setRawPasteText(text);
    try {
      const wb = XLSX.read(text, { type: 'string' });
      handlePasteFromWorkbook(wb);
    } catch {
      // fallback to manual TSV
      const grid = parseTsv(text);
      if (grid.length < 2) return;
      const maxCols = grid.reduce((mx, r) => Math.max(mx, r.length), 0);
      const headers = grid[0].length >= maxCols
        ? grid[0].map((h) => h.trim())
        : Array.from({ length: maxCols }, (_, i) => grid[0][i]?.trim() || `列${i + 1}`);
      setPasteHeaders(headers);
      setPastePreview(grid.slice(1, 6));
      const mapping: Record<string, string> = {};
      headers.forEach((h) => { mapping[h] = h; });
      setHeaderMapping(mapping);
      setSelectedColumns(new Set(headers));
      setShowPastePanel(true);
    }
  }, [handlePasteFromWorkbook]);

  const confirmImport = useCallback(() => {
    let allHeaders: string[] = [];
    let dataRows: string[][] = [];
    if (pasteWbRef.current) {
      const g = workbookToGrid(pasteWbRef.current);
      allHeaders = g.headers;
      dataRows = g.dataRows;
    } else {
      // TSV fallback
      const grid = parseTsv(rawPasteText);
      if (grid.length < 2) return;
      const maxCols = grid.reduce((mx, r) => Math.max(mx, r.length), 0);
      allHeaders = grid[0].length >= maxCols
        ? grid[0].map((h) => h.trim())
        : Array.from({ length: maxCols }, (_, i) => grid[0][i]?.trim() || `列${i + 1}`);
      dataRows = grid.slice(1);
    }
    // Only import selected columns
    const importHeaders = allHeaders.filter((h) => selectedColumns.has(h));
    if (importHeaders.length === 0) return;
    const newRows: PipelineRow[] = dataRows.map((cells) => {
      const raw: Record<string, string> = {};
      importHeaders.forEach((col) => {
        const idx = allHeaders.indexOf(col);
        raw[col] = (cells[idx] != null ? String(cells[idx]) : '').trim();
      });
      return { id: uuid(), raw, ai: {}, status: 'idle', isDedupRemoved: false };
    });
    // Update rawColumns to only the selected columns
    setConfig((c) => ({ ...c, rawColumns: importHeaders }));
    setRows((prev) => [...prev, ...newRows]);
    setShowPastePanel(false);
    pasteWbRef.current = null;
    log(`✅ 导入 ${newRows.length} 行数据（${importHeaders.length}/${allHeaders.length} 列）`);
  }, [selectedColumns, rawPasteText, log]);

  // ── Stage 2: Dedup ───────────────────────────
  const handleDedup = useCallback(() => {
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
  }, [config.dedupColumns, config.dedupKeep, log]);

  const handleUndoDedup = useCallback(() => {
    setRows((prev) => prev.map((r) => ({ ...r, isDedupRemoved: false, dedupKey: undefined })));
    log('↩️ 已恢复所有被去重的行');
  }, [log]);

  // ── One-click: Dedup → AI ──
  const pendingOneClick = useRef(false);
  const handleOneClickRun = useCallback(() => {
    if (rows.length === 0) { log('⚠️ 没有数据'); return; }
    // If dedup columns not configured, open config panel
    if (config.dedupColumns.length === 0) {
      log('⚠️ 请先设置去重列');
      setShowConfig(true);
      return;
    }
    // If no instructions configured, open config panel so user can set up first
    if (config.aiInstructions.length === 0 || config.aiInstructions.every(i => !i.prompt.trim())) {
      log('⚠️ 请先设置 AI 指令');
      setShowConfig(true);
      return;
    }
    handleDedup();
    pendingOneClick.current = true;
  }, [rows.length, config.dedupColumns.length, config.aiInstructions, handleDedup, log]);

  // ── Stage 3: AI ──────────────────────────────
  const handleRunAI = useCallback(async () => {
    if (isRunningAI) return;
    const targets = rows.filter((r) => !r.isDedupRemoved && r.status !== 'done');
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

    const batches: PipelineRow[][] = [];
    for (let i = 0; i < targets.length; i += config.batchSize) {
      batches.push(targets.slice(i, i + config.batchSize));
    }
    log(`📦 共分 ${batches.length} 个批次`);

    let batchIdx = 0;
    const runBatch = async (batch: PipelineRow[]): Promise<void> => {
      const bIdx = batchIdx++;

      if (config.mergeInstructions) {
        // ── 合并模式：所有指令一次请求 ──
        const prompt = buildBatchPrompt(config.aiInstructions, batch, config.rawColumns);
        let attempt = 0;
        while (attempt <= config.maxRetries) {
          if (abortRef.current) return;
          try {
            log(`📤 批次 ${bIdx + 1}/${batches.length} (${batch.length}行, 第${attempt + 1}次)`);
            const result = await ai.models.generateContent({ model: modelId, contents: prompt });
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
                  if (inst.outputColumn && item[inst.outputColumn] !== undefined) {
                    mergedAi[inst.outputColumn] = String(item[inst.outputColumn]);
                  }
                });
                updated[idx] = { ...updated[idx], ai: mergedAi, status: 'done', errorMsg: undefined };
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
        // ── 分开模式：每条指令单独请求 ──
        for (const inst of config.aiInstructions) {
          if (abortRef.current) return;
          if (!inst.prompt.trim()) continue;

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
                const result = await ai.models.generateContent({
                  model: modelId,
                  contents: [{ role: 'user', parts: visionData.parts }],
                });
                const text = (result.text ?? '').trim();
                setRows((prev) => prev.map((r) =>
                  r.id === row.id ? { ...r, ai: { ...r.ai, [inst.outputColumn]: text } } : r
                ));
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
                const result = await ai.models.generateContent({ model: modelId, contents: prompt });
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
                    updated[idx] = { ...updated[idx], ai: mergedAi };
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
    log('🎉 全部批次处理完毕');
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
  const buildTsvOutput = useCallback(() => {
    const cols = allDisplayColumns;
    const header = cols.join('\t');
    const body = activeRows.map((r) => cols.map((c) => (r.ai[c] ?? r.raw[c] ?? '')).join('\t')).join('\n');
    return header + '\n' + body;
  }, [activeRows, allDisplayColumns]);

  const handleCopyResult = useCallback(() => {
    navigator.clipboard.writeText(buildTsvOutput()).then(() => log('📋 已复制（可直接粘贴到 Google Sheets）'));
  }, [buildTsvOutput, log]);

  const handleExportCsv = useCallback(() => {
    const tsv = buildTsvOutput();
    const blob = new Blob(['\ufeff' + tsv.replace(/\t/g, ',')], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `数据整理_${new Date().toLocaleDateString('zh')}.csv`;
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
        <strong style={{ fontSize: 14, color: 'var(--on-surface-color)', marginRight: 4 }}>数据整理</strong>

        {/* Stage pills */}
        <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap', flex: 1 }}>
          {[
            { color: STAGE_COLORS.s1, label: `粘贴原文 (${rows.length})` },
            { color: STAGE_COLORS.s2, label: `去重 (-${dedupedRows.length})` },
            { color: STAGE_COLORS.s3, label: `AI (${doneRows.length}/${activeRows.length})` },
            { color: STAGE_COLORS.s4, label: `导出` },
          ].map((s, i) => (
            <span key={i} style={{ padding: '2px 8px', borderRadius: 20, background: s.color, color: '#fff', fontSize: 11, fontWeight: 600 }}>
              {s.label}
            </span>
          ))}
        </div>

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
            <Loader2 size={13} className="animate-spin" /> 停止
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
            <Copy size={13} /> 复制选中 ({selectedCells.size})
          </button>
        )}
        <button className="dp-btn dp-btn-blue" onClick={handleCopyResult} disabled={activeRows.length === 0}>
          <Copy size={13} /> 复制全部
        </button>
        <button className="dp-btn dp-btn-blue" onClick={handleExportCsv} disabled={activeRows.length === 0}>
          <FileDown size={13} /> 导出 CSV
        </button>
        <button className="dp-btn" onClick={() => { if (window.confirm('确认清空全部数据？')) { setRows([]); log('🗑️ 已清空全部数据'); } }}>
          <Trash2 size={13} />
        </button>
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
                  <div key={i} className="dp-tag" style={{ borderColor: 'rgba(224,82,82,0.3)', color: '#e05252' }}>
                    {col}
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
                第二阶段：去重依据列
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
              <div style={{ display: 'flex', gap: 12 }}>
                {([['first', '保留第一条'], ['last', '保留最后一条']] as const).map(([val, label]) => (
                  <label key={val} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', color: 'var(--text-color)' }}>
                    <input type="radio" name="dp-keep" checked={config.dedupKeep === val} onChange={() => setConfig((c) => ({ ...c, dedupKeep: val }))} />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Right: AI instructions */}
            <div>
              <div className="dp-config-section-title" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#e57c26', display: 'inline-block' }} />
                第三阶段：AI 指令
                <span style={{ fontSize: 11, opacity: 0.6, fontWeight: 400 }}>（多指令合并一次请求）</span>
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto', paddingRight: 4 }}>
                {config.aiInstructions.map((inst) => (
                  <InstructionEditor
                    key={inst.id}
                    inst={inst}
                    rawColumns={config.rawColumns}
                    aiOutputCols={aiOutputColumns.filter((c) => c !== inst.outputColumn)}
                    promptPresets={promptPresets}
                    onChange={(updated) => setConfig((c) => ({ ...c, aiInstructions: c.aiInstructions.map((i) => (i.id === inst.id ? updated : i)) }))}
                    onDelete={() => setConfig((c) => ({ ...c, aiInstructions: c.aiInstructions.filter((i) => i.id !== inst.id) }))}
                    onSavePromptPreset={savePromptPreset}
                    onLoadPromptPreset={() => {}}
                    onDeletePromptPreset={deletePromptPreset}
                  />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                <button className="dp-btn dp-btn-orange" style={{ flex: 1 }}
                  onClick={() => setConfig((c) => { const src = c.rawColumns[0] || ''; return { ...c, aiInstructions: [...c.aiInstructions, { id: uuid(), name: `指令 ${c.aiInstructions.length + 1}`, prompt: '', outputColumn: src ? `${src}_ai处理` : `AI处理_${c.aiInstructions.length + 1}`, sourceColumn: src }] }; })}>
                  <Plus size={12} /> 添加指令
                </button>
                <button className="dp-btn dp-btn-orange" onClick={() => { setBatchInstText(''); setShowBatchInstModal(true); }}>
                  <ClipboardPaste size={12} /> 批量粘贴
                </button>
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
                  <FolderOpen size={12} /> 预设管理
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
                <button className="dp-btn dp-btn-blue" style={{ width: '100%', justifyContent: 'center' }}
                  onClick={() => {
                    const name = window.prompt('预设名称：', `预设 ${presets.length + 1}`);
                    if (name?.trim()) {
                      savePreset(name.trim());
                      setShowPresetMenu(false);
                    }
                  }}>
                  <Save size={12} /> 保存当前配置为预设
                </button>
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
                  <label style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 5, cursor: 'pointer', fontSize: 11, fontWeight: 400 }}>
                    <span
                      onClick={() => setConfig((c) => ({ ...c, mergeInstructions: !c.mergeInstructions }))}
                      style={{
                        width: 30, height: 16, borderRadius: 8, position: 'relative', display: 'inline-block', cursor: 'pointer',
                        background: config.mergeInstructions ? '#e57c26' : 'var(--border-color)',
                        transition: 'background 0.2s',
                      }}>
                      <span style={{
                        position: 'absolute', top: 2, left: config.mergeInstructions ? 16 : 2,
                        width: 12, height: 12, borderRadius: '50%', background: '#fff',
                        transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                      }} />
                    </span>
                    <span style={{ color: config.mergeInstructions ? '#e57c26' : 'var(--text-muted-color)' }}>
                      {config.mergeInstructions ? '合并请求' : '分开请求'}
                    </span>
                  </label>
                </div>
                <div style={{ maxHeight: 220, overflowY: 'auto', paddingRight: 4 }}>
                  {config.aiInstructions.map((inst) => (
                    <InstructionEditor
                      key={inst.id}
                      inst={inst}
                      rawColumns={config.rawColumns}
                      aiOutputCols={aiOutputColumns.filter((c) => c !== inst.outputColumn)}
                      promptPresets={promptPresets}
                      onChange={(updated) => setConfig((c) => ({ ...c, aiInstructions: c.aiInstructions.map((i) => (i.id === inst.id ? updated : i)) }))}
                      onDelete={() => setConfig((c) => ({ ...c, aiInstructions: c.aiInstructions.filter((i) => i.id !== inst.id) }))}
                      onSavePromptPreset={savePromptPreset}
                      onLoadPromptPreset={() => {}}
                      onDeletePromptPreset={deletePromptPreset}
                    />
                  ))}
                </div>
                <div style={{ display: 'flex', gap: 6, marginTop: 6 }}>
                  <button className="dp-btn dp-btn-orange" style={{ flex: 1 }}
                    onClick={() => setConfig((c) => { const src = c.rawColumns[0] || ''; return { ...c, aiInstructions: [...c.aiInstructions, { id: uuid(), name: `指令 ${c.aiInstructions.length + 1}`, prompt: '', outputColumn: src ? `${src}_ai处理` : `AI处理_${c.aiInstructions.length + 1}`, sourceColumn: src }] }; })}>
                    <Plus size={12} /> 添加指令
                  </button>
                  <button className="dp-btn dp-btn-orange" onClick={() => { setBatchInstText(''); setShowBatchInstModal(true); }}>
                    <ClipboardPaste size={12} /> 批量粘贴
                  </button>
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
                  disabled={config.aiInstructions.length === 0 || config.aiInstructions.every((i) => !i.prompt.trim())}
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
                  检测到 <strong>{pasteHeaders.length}</strong> 列{pastePreview.length > 0 ? `，${pastePreview.length}+ 行数据` : ''}，点击选择要导入的列：
                  <span style={{ fontSize: 11, color: 'var(--text-muted-color)', cursor: 'pointer' }}
                    onClick={() => {
                      if (selectedColumns.size === pasteHeaders.length) setSelectedColumns(new Set());
                      else setSelectedColumns(new Set(pasteHeaders));
                    }}>
                    {selectedColumns.size === pasteHeaders.length ? '取消全选' : '全选'}
                  </span>
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
              </div>
            )}

            {pastePreview.length > 0 && (
              <div style={{ marginBottom: 10, overflowX: 'auto' }}>
                <p style={{ fontSize: 12, color: 'var(--text-muted-color)' }}>前 {Math.min(pastePreview.length, 6)} 行预览：</p>
                <table className="dp-table" style={{ minWidth: 'auto' }}>
                  <thead>
                    <tr style={{ background: 'var(--control-bg-color)' }}>
                      {pasteHeaders.map((h, i) => <th key={i} style={{ color: 'var(--text-muted-color)', background: 'var(--control-bg-color)', fontWeight: 600 }}>{h}</th>)}
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
                  style={{ background: highlightedCols.has(col) ? '#2563eb' : STAGE_COLORS.s1, position: 'relative' }}
                  onMouseDown={(e) => handleColumnMouseDown(col, e)}
                  onMouseEnter={() => handleColumnMouseEnter(col)}
                  title={`点击选中整列「${col}」`}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{col}</span>
                  <div className="dp-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, col); }} />
                </th>
              ))}
              {aiOutputColumns.map((col) => (
                <th key={col} className={highlightedCols.has(col) ? 'dp-th-selected' : ''}
                  style={{ background: highlightedCols.has(col) ? '#2563eb' : STAGE_COLORS.s3, position: 'relative' }}
                  onMouseDown={(e) => handleColumnMouseDown(col, e)}
                  onMouseEnter={() => handleColumnMouseEnter(col)}
                  title={`点击选中整列「${col}」`}>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', display: 'block' }}>{col}</span>
                  <div className="dp-resize-handle" onMouseDown={(e) => { e.stopPropagation(); onResizeStart(e, col); }} />
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
                  <td style={{ textAlign: 'center' }}>
                    {row.status === 'processing' && <Loader2 size={12} className="animate-spin" style={{ color: '#e57c26', margin: 'auto' }} />}
                    {row.status === 'done' && <CheckCircle2 size={12} style={{ color: '#3aaa6b', margin: 'auto' }} />}
                    {row.status === 'error' && <span title={row.errorMsg}><AlertCircle size={12} style={{ color: '#ef4444', margin: 'auto' }} /></span>}
                    {row.status === 'idle' && <span style={{ color: 'var(--text-muted-color)' }}>·</span>}
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
                          <span style={{ color: '#e57c26', fontStyle: 'italic' }}>处理中...</span>
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
    </div>
  );
};

export default DataPipelinePanel;
