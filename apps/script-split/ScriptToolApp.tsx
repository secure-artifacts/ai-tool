
import React, { useState, useEffect, useRef } from 'react';
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
  Eraser,
  Combine,
  Trash2,
  AlignLeft,
  Link2,
  ListOrdered,
  Scissors,
  FileInput,
  Download,
  Maximize2,
  Undo2,
  Redo2
} from 'lucide-react';
import {
  processGrid,
  formatForClipboard,
  colToLetter
} from './utils/processor';
import { buildGoogleSheetsHtml, buildMergedCellsHtml, copyToClipboard } from './utils/clipboard';
import { GridData, ToolType, GridSelection, ProcessOptions, GridStyles, cellKey } from './types';
import { Button } from './components/UIComponents';
import { SpreadsheetGrid } from './components/SpreadsheetGrid';
import type { GoogleGenAI } from '@google/genai';

interface ScriptToolAppProps {
  getAiInstance?: () => GoogleGenAI | null;
  textModel?: string;
}

const LOCAL_MODEL_KEY = 'script_tool_local_model';
const SCRIPT_TOOL_STATE_KEY = 'script_tool_state_v1';
const INHERIT_VALUE = '__global__';

// 信仰词汇大写保护 — 与智能翻译共享同一 localStorage key
const DEITY_TERMS_KEY = 'smart_translate_deity_terms';
const DEFAULT_DEITY_TERMS = [
  'God', 'Lord', 'Jesus', 'Christ',
  'the Lord', 'Yahweh', 'the Lord God',
  'the Lord Jesus', 'Jesus Christ',
  'the Christ of the last days', 'Almighty God',
  'He', 'Heavenly Father', 'God the Father', 'Father',
  'the Almighty God', 'the Creator', 'the Most High',
  'King of kings', 'Lord of lords', 'Redeemer',
  'the Son of God', 'the Lamb of God',
  // Tagalog (Filipino) terms
  'Diyos', 'Panginoon', 'Panginoong', 'Hesus', 'Kristo',
  'Ama sa Langit', 'Diyos Ama', 'Ama', 'Tagalikha', 'Lumikha',
  'Manunubos', 'Anak ng Diyos', 'Kordero ng Diyos',
  'Espiritu Santo', 'Banal na Espiritu', 'Panginoong Hesus',
  'Diyos na Makapangyarihan', 'Makapangyarihang Diyos',
  'Siya', 'Kanya', 'Niya'
];

const loadDeityTerms = (): string[] => {
  if (typeof localStorage === 'undefined') return DEFAULT_DEITY_TERMS;
  try {
    const raw = localStorage.getItem(DEITY_TERMS_KEY);
    if (!raw) return DEFAULT_DEITY_TERMS;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : DEFAULT_DEITY_TERMS;
  } catch {
    return DEFAULT_DEITY_TERMS;
  }
};

const saveDeityTerms = (terms: string[]) => {
  try { localStorage.setItem(DEITY_TERMS_KEY, JSON.stringify(terms)); } catch {}
};



const MODEL_OPTIONS = [
  { value: INHERIT_VALUE, label: '继承全局设置' },
  { value: 'gemini-3.5-flash', label: '🚀 gemini-3.5-flash (GA·最新旗舰)' },
  { value: 'gemini-3.1-flash-lite', label: '⚡ gemini-3.1-flash-lite (GA·默认)' },
  { value: 'gemini-2.5-flash', label: '⚡ gemini-2.5-flash (GA)' },
  { value: 'gemini-2.5-flash-lite', label: '⚡ gemini-2.5-flash-lite (GA·最快)' },
  { value: 'gemini-2.5-pro', label: '🧠 gemini-2.5-pro (GA·强推理)' },
  { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (Preview)' },
  { value: 'gemini-3.1-pro-preview', label: 'gemini-3.1-pro-preview (Preview·最新)' },
];

// Default grid size
const DEFAULT_ROWS = 10;
const DEFAULT_COLS = 20;
const LINK_VARIANT_LIMIT = 4096;
const CONTENT_PLACEHOLDER = '{{内容}}';
const QUOTED_CONTENT_PLACEHOLDER = `"${CONTENT_PLACEHOLDER}"`;
const MANUAL_SPLIT_MARKER = '⟦拆分点⟧';
const TEMPLATE_PRESETS_KEY = 'script_tool_template_presets_v1';

type SplitUnit = 'words' | 'characters';
type ExpandedEditor = 'source' | 'template' | null;

interface TemplateSegment {
  id: string;
  text: string;
  promptTemplate?: string;
  finalPrompt?: string;
}

interface TemplatePreset {
  id: string;
  name: string;
  template: string;
}

const loadTemplatePresets = (): TemplatePreset[] => {
  try {
    const parsed = JSON.parse(localStorage.getItem(TEMPLATE_PRESETS_KEY) || '[]');
    return Array.isArray(parsed) ? parsed.filter(item => item && typeof item.id === 'string' && typeof item.name === 'string' && typeof item.template === 'string') : [];
  } catch {
    return [];
  }
};

const countSegmentUnits = (text: string, unit: SplitUnit): number =>
  unit === 'characters'
    ? Array.from(text.replace(/\s/g, '')).length
    : (text.trim().match(/\S+/g) || []).length;

const splitIntoSentences = (text: string): string[] => {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (!normalized) return [];
  // Treat natural speech pauses as preferred boundaries, not only sentence endings.
  return normalized.match(/[^.!?。！？,，;；:：、…]+(?:[.!?。！？,，;；:：、…]+[”’"']?)?|[^.!?。！？,，;；:：、…]+$/g)?.map(item => item.trim()).filter(Boolean) || [normalized];
};

const hardSplitText = (text: string, target: number, unit: SplitUnit): string[] => {
  if (unit === 'words') {
    const words = text.trim().split(/\s+/).filter(Boolean);
    const result: string[] = [];
    for (let i = 0; i < words.length; i += target) result.push(words.slice(i, i + target).join(' '));
    return result;
  }
  const chars = Array.from(text.trim());
  const result: string[] = [];
  for (let i = 0; i < chars.length; i += target) result.push(chars.slice(i, i + target).join('').trim());
  return result.filter(Boolean);
};

const autoSplitTemplateText = (
  text: string,
  minimum: number,
  maximum: number,
  unit: SplitUnit,
  keepSentences: boolean,
  tolerance: number
): string[] => {
  const safeMin = Math.max(1, Math.min(minimum, maximum));
  const safeMax = Math.max(safeMin, maximum);
  if (!keepSentences) return hardSplitText(text, safeMax, unit);
  const sentences = splitIntoSentences(text);
  const floatingMax = safeMax + Math.max(0, tolerance);
  const result: string[] = [];
  let current = '';
  for (const sentence of sentences) {
    const candidate = current ? `${current} ${sentence}` : sentence;
    const currentCount = countSegmentUnits(current, unit);
    const candidateCount = countSegmentUnits(candidate, unit);
    if (current && candidateCount > floatingMax) {
      result.push(current);
      current = sentence;
    } else if (current && currentCount >= safeMin && candidateCount > safeMax && tolerance === 0) {
      result.push(current);
      current = sentence;
    } else {
      current = candidate;
    }
  }
  if (current) result.push(current);
  return result;
};

interface HighlightedTextareaProps extends React.TextareaHTMLAttributes<HTMLTextAreaElement> {
  value: string;
  containerClassName?: string;
}

const HighlightedTextarea = React.forwardRef<HTMLTextAreaElement, HighlightedTextareaProps>(({ value, className = '', containerClassName = '', onScroll, style, ...props }, ref) => {
  const [scroll, setScroll] = useState({ top: 0, left: 0 });
  const pieces = value.split(/("\{\{内容\}\}"|⟦拆分点⟧|\{\{内容\}\})/g);
  return (
    <span className={`relative block w-full overflow-hidden rounded-md ${containerClassName}`}>
      <pre aria-hidden="true" className={`${className} pointer-events-none absolute inset-0 overflow-hidden whitespace-pre-wrap break-words m-0`} style={{ ...style, color: 'transparent', fontFamily: 'inherit', letterSpacing: 0, transform: `translate(${-scroll.left}px, ${-scroll.top}px)`, borderColor: 'transparent' }}>
        {pieces.map((piece, index) => piece === MANUAL_SPLIT_MARKER
          ? <mark key={index} style={{ backgroundColor: '#b45309', color: 'transparent', borderRadius: 3, padding: 0 }}>{piece}</mark>
          : piece === CONTENT_PLACEHOLDER || piece === QUOTED_CONTENT_PLACEHOLDER
            ? <mark key={index} style={{ backgroundColor: '#0f766e', color: 'transparent', borderRadius: 3, padding: 0 }}>{piece}</mark>
            : <React.Fragment key={index}>{piece}</React.Fragment>)}
      </pre>
      <textarea
        {...props}
        ref={ref}
        value={value}
        className={`${className} relative z-10 bg-transparent`}
        style={{ ...style, color: '#e2e8f0', caretColor: '#f8fafc', WebkitTextFillColor: '#e2e8f0', fontFamily: 'inherit', letterSpacing: 0 }}
        onScroll={event => {
          setScroll({ top: event.currentTarget.scrollTop, left: event.currentTarget.scrollLeft });
          onScroll?.(event);
        }}
      />
    </span>
  );
});
HighlightedTextarea.displayName = 'HighlightedTextarea';

interface PersistedScriptToolState {
  gridData: GridData;
  selection: GridSelection | null;
  clearSource: boolean;
  gridStyles: [string, { bgColor?: string }][];
  customPrefix: string;
  mergeCycle: number;
  mergeCellSpan: number;
  diffCols?: Record<number, number>;
  autoRowHeight?: boolean;
}

const createEmptyGrid = (): GridData =>
  Array.from({ length: DEFAULT_ROWS }, () => Array(DEFAULT_COLS).fill(''));

const countAmbiguousLinkChars = (value: string): number => {
  return (value.match(/[lI]/g) || []).length;
};

const generateLinkVariants = (value: string): string[] => {
  const ambiguousCount = countAmbiguousLinkChars(value);
  if (ambiguousCount === 0) return [];
  if (ambiguousCount > Math.log2(LINK_VARIANT_LIMIT)) {
    throw new Error(`可疑字符过多，会生成 ${Math.pow(2, ambiguousCount).toLocaleString()} 条候选。当前上限为 ${LINK_VARIANT_LIMIT.toLocaleString()} 条。`);
  }

  const variants: string[] = [''];
  for (const ch of value) {
    if (ch !== 'l' && ch !== 'I') {
      for (let i = 0; i < variants.length; i++) {
        variants[i] += ch;
      }
      continue;
    }

    const currentLength = variants.length;
    for (let i = 0; i < currentLength; i++) {
      const prefix = variants[i];
      variants[i] = `${prefix}l`;
      variants.push(`${prefix}I`);
    }
  }

  return variants;
};

const normalizeGridData = (raw: unknown): GridData => {
  if (!Array.isArray(raw)) return createEmptyGrid();
  const rows = raw
    .filter((row): row is unknown[] => Array.isArray(row))
    .map(row => row.map(cell => (cell == null ? '' : String(cell))));
  if (rows.length === 0) return createEmptyGrid();
  return rows;
};

const normalizeSelection = (raw: unknown): GridSelection | null => {
  if (!raw || typeof raw !== 'object') return null;
  const value = raw as {
    start?: { row?: unknown; col?: unknown };
    end?: { row?: unknown; col?: unknown };
  };
  const sr = value.start?.row;
  const sc = value.start?.col;
  const er = value.end?.row;
  const ec = value.end?.col;
  if ([sr, sc, er, ec].every(v => typeof v === 'number' && Number.isFinite(v))) {
    return {
      start: { row: sr as number, col: sc as number },
      end: { row: er as number, col: ec as number }
    };
  }
  return null;
};

const normalizeGridStyles = (raw: unknown): GridStyles => {
  if (!Array.isArray(raw)) return new Map();
  const map = new Map<string, { bgColor?: string }>();
  for (const entry of raw) {
    if (!Array.isArray(entry) || entry.length !== 2) continue;
    const [key, style] = entry;
    if (typeof key !== 'string') continue;
    if (!style || typeof style !== 'object') continue;
    const bgColor = (style as { bgColor?: unknown }).bgColor;
    map.set(key, typeof bgColor === 'string' ? { bgColor } : {});
  }
  return map;
};

let memoryPersistedState: PersistedScriptToolState | null = null;

const loadPersistedState = (): PersistedScriptToolState | null => {
  return memoryPersistedState;
};

function ScriptToolApp({ getAiInstance, textModel = 'gemini-3-flash-preview' }: ScriptToolAppProps) {
  const [persistedState] = useState<PersistedScriptToolState | null>(() => loadPersistedState());
  // 本地模型选择（默认继承全局）
  const [localModel, setLocalModel] = useState<string>(() => {
    try { return localStorage.getItem(LOCAL_MODEL_KEY) || INHERIT_VALUE; } catch { return INHERIT_VALUE; }
  });
  const effectiveModel = localModel === INHERIT_VALUE ? textModel : localModel;
  const [gridData, setGridData] = useState<GridData>(persistedState?.gridData || createEmptyGrid());
  const [selection, setSelection] = useState<GridSelection | null>(persistedState?.selection || null);
  const [forceSelection, setForceSelection] = useState<GridSelection | null>(persistedState?.selection || null); // 用于外部触发选区
  const [copied, setCopied] = useState(false);
  const [statusMsg, setStatusMsg] = useState<string>('');
  const [clearSource, setClearSource] = useState<boolean>(persistedState?.clearSource ?? false); // 默认保留原文（开关关 = 保留，开关开 = 删除）
  const [gridStyles, setGridStyles] = useState<GridStyles>(new Map(persistedState?.gridStyles || [])); // 单元格样式（橙色标记）
  const [showPrefixModal, setShowPrefixModal] = useState(false); // 自定义前缀弹窗
  const [customPrefix, setCustomPrefix] = useState<string>(persistedState?.customPrefix || 'prompt'); // 自定义前缀内容
  const [copiedSelection, setCopiedSelection] = useState(false);
  const [aiSplitting, setAiSplitting] = useState(false);
  const [showMergeModal, setShowMergeModal] = useState(false);
  const [mergeCycle, setMergeCycle] = useState<number>(persistedState?.mergeCycle ?? 1); // 循环列数
  const [showWrapModal, setShowWrapModal] = useState(false); // 自动断行弹窗
  const [lineWidth, setLineWidth] = useState<number>(18); // 断行宽度（默认18）
  const [showLinkVariantModal, setShowLinkVariantModal] = useState(false);
  const [linkVariantInput, setLinkVariantInput] = useState('');
  const [showMergeCellModal, setShowMergeCellModal] = useState(false);
  const [mergeCellSpan, setMergeCellSpan] = useState<number>(persistedState?.mergeCellSpan ?? 5);
  const [showDeityModal, setShowDeityModal] = useState(false);
  const [deityTerms, setDeityTerms] = useState<string[]>(() => loadDeityTerms());
  const [deityNewTerm, setDeityNewTerm] = useState('');
  const [enableAiSpellCheck] = useState(true);
  const [spellChecking, setSpellChecking] = useState(false);
  const [diffCols, setDiffCols] = useState<Record<number, number>>(persistedState?.diffCols || {});
  const [autoRowHeight, setAutoRowHeight] = useState<boolean>(persistedState?.autoRowHeight ?? false);
  const [showTemplateSplitter, setShowTemplateSplitter] = useState(false);
  const [templateSource, setTemplateSource] = useState('');
  const [promptTemplate, setPromptTemplate] = useState(`内容：${QUOTED_CONTENT_PLACEHOLDER}`);
  const [splitUnit, setSplitUnit] = useState<SplitUnit>('words');
  const [splitMinimum, setSplitMinimum] = useState(10);
  const [splitMaximum, setSplitMaximum] = useState(18);
  const [keepSentences, setKeepSentences] = useState(true);
  const [allowTolerance, setAllowTolerance] = useState(true);
  const [splitTolerance, setSplitTolerance] = useState(3);
  const [templateSegments, setTemplateSegments] = useState<TemplateSegment[]>([]);
  const [selectedSegmentIds, setSelectedSegmentIds] = useState<Set<string>>(new Set());
  const [segmentCarets, setSegmentCarets] = useState<Record<string, number>>({});
  const [templatePresets, setTemplatePresets] = useState<TemplatePreset[]>(loadTemplatePresets);
  const [selectedPresetId, setSelectedPresetId] = useState('');
  const [presetName, setPresetName] = useState('');
  const [expandedEditor, setExpandedEditor] = useState<ExpandedEditor>(null);
  const [storyboardMode, setStoryboardMode] = useState(false);
  const promptTemplateRef = useRef<HTMLTextAreaElement | null>(null);
  const templateSourceRef = useRef<HTMLTextAreaElement | null>(null);
  const editorHistoryRef = useRef<Record<'source' | 'template', { undo: string[]; redo: string[] }>>({ source: { undo: [], redo: [] }, template: { undo: [], redo: [] } });

  const setEditorValue = (editor: 'source' | 'template', value: string, record = true) => {
    const current = editor === 'source' ? templateSource : promptTemplate;
    if (value === current) return;
    if (record) {
      const history = editorHistoryRef.current[editor];
      history.undo.push(current);
      if (history.undo.length > 100) history.undo.shift();
      history.redo = [];
    }
    editor === 'source' ? setTemplateSource(value) : setPromptTemplate(value);
  };

  const undoEditor = (editor: 'source' | 'template') => {
    const history = editorHistoryRef.current[editor];
    const previous = history.undo.pop();
    if (previous === undefined) return;
    history.redo.push(editor === 'source' ? templateSource : promptTemplate);
    setEditorValue(editor, previous, false);
  };

  const redoEditor = (editor: 'source' | 'template') => {
    const history = editorHistoryRef.current[editor];
    const next = history.redo.pop();
    if (next === undefined) return;
    history.undo.push(editor === 'source' ? templateSource : promptTemplate);
    setEditorValue(editor, next, false);
  };

  const handleEditorShortcut = (event: React.KeyboardEvent<HTMLTextAreaElement>, editor: 'source' | 'template') => {
    if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== 'z') return;
    event.preventDefault();
    event.shiftKey ? redoEditor(editor) : undoEditor(editor);
  };

  const insertManualSplitMarker = () => {
    const textarea = templateSourceRef.current;
    const start = textarea?.selectionStart ?? templateSource.length;
    const end = textarea?.selectionEnd ?? start;
    const nextValue = `${templateSource.slice(0, start)}${MANUAL_SPLIT_MARKER}${templateSource.slice(end)}`;
    const nextCaret = start + MANUAL_SPLIT_MARKER.length;
    setEditorValue('source', nextValue);
    window.requestAnimationFrame(() => {
      templateSourceRef.current?.focus();
      templateSourceRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
    setStatusMsg(`已在光标位置添加 ${MANUAL_SPLIT_MARKER}`);
  };

  const persistTemplatePresets = (presets: TemplatePreset[]) => {
    setTemplatePresets(presets);
    try { localStorage.setItem(TEMPLATE_PRESETS_KEY, JSON.stringify(presets)); } catch {}
  };

  const saveTemplatePreset = () => {
    const name = presetName.trim();
    if (!name) return setStatusMsg('请先输入预设名称');
    if (!promptTemplate.trim()) return setStatusMsg('完整描述词模板不能为空');
    const existing = templatePresets.find(item => item.name === name);
    const preset: TemplatePreset = { id: existing?.id || `${Date.now()}`, name, template: promptTemplate };
    const next = existing ? templatePresets.map(item => item.id === existing.id ? preset : item) : [...templatePresets, preset];
    persistTemplatePresets(next);
    setSelectedPresetId(preset.id);
    setStatusMsg(existing ? `已更新预设“${name}”` : `已保存预设“${name}”`);
  };

  const loadTemplatePreset = (id: string) => {
    setSelectedPresetId(id);
    const preset = templatePresets.find(item => item.id === id);
    if (!preset) return;
    setEditorValue('template', preset.template);
    setPresetName(preset.name);
    setStatusMsg(`已载入预设“${preset.name}”`);
  };

  const deleteTemplatePreset = () => {
    const preset = templatePresets.find(item => item.id === selectedPresetId);
    if (!preset) return setStatusMsg('请先选择要删除的预设');
    persistTemplatePresets(templatePresets.filter(item => item.id !== selectedPresetId));
    setSelectedPresetId('');
    setPresetName('');
    setStatusMsg(`已删除预设“${preset.name}”`);
  };

  const insertContentPlaceholder = () => {
    const textarea = promptTemplateRef.current;
    const start = textarea?.selectionStart ?? promptTemplate.length;
    const end = textarea?.selectionEnd ?? start;
    const nextValue = `${promptTemplate.slice(0, start)}${QUOTED_CONTENT_PLACEHOLDER}${promptTemplate.slice(end)}`;
    const nextCaret = start + QUOTED_CONTENT_PLACEHOLDER.length;
    setEditorValue('template', nextValue);
    window.requestAnimationFrame(() => {
      promptTemplateRef.current?.focus();
      promptTemplateRef.current?.setSelectionRange(nextCaret, nextCaret);
    });
    setStatusMsg(`已在光标位置插入 ${QUOTED_CONTENT_PLACEHOLDER}`);
  };

  const fillPromptTemplate = (content: string, template = promptTemplate) => template.split(CONTENT_PLACEHOLDER).join(content);
  const getSegmentFinalPrompt = (segment: TemplateSegment) => segment.finalPrompt ?? fillPromptTemplate(segment.text, segment.promptTemplate ?? promptTemplate);

  const runTemplateSplit = () => {
    if (!templateSource.trim()) {
      setStatusMsg('请先输入需要拆分的原始文案');
      return;
    }
    if (!promptTemplate.includes(CONTENT_PLACEHOLDER)) {
      setStatusMsg(`描述词模板中必须包含 ${CONTENT_PLACEHOLDER} 内容块`);
      return;
    }
    const sourceSnapshot = templateSource;
    const manualBlocks = sourceSnapshot.split(MANUAL_SPLIT_MARKER);
    const hasManualMarkers = manualBlocks.length > 1;
    const parts = hasManualMarkers
      ? manualBlocks.map(block => block.trim()).filter(Boolean)
      : autoSplitTemplateText(
        sourceSnapshot,
        splitMinimum,
        splitMaximum,
        splitUnit,
        keepSentences,
        allowTolerance ? splitTolerance : 0
      ).filter(Boolean);
    setTemplateSegments(parts.map((text, index) => ({ id: `${Date.now()}-${index}`, text })));
    setSelectedSegmentIds(new Set());
    // Generating results must never mutate the source editor or remove its manual markers.
    setTemplateSource(sourceSnapshot);
    const markerCount = Math.max(0, manualBlocks.length - 1);
    setStatusMsg(hasManualMarkers
      ? `已严格按照 ${markerCount} 个手动拆分点生成 ${parts.length} 段，未执行自动拆分`
      : `已自动拆分为 ${parts.length} 段，可继续批量编辑`);
  };

  const runManualPointSplit = () => {
    if (!templateSource.trim()) {
      setStatusMsg('请先输入文案，并在需要拆分的位置添加拆分点');
      return;
    }
    if (!promptTemplate.includes(CONTENT_PLACEHOLDER)) {
      setStatusMsg(`描述词模板中必须包含 ${CONTENT_PLACEHOLDER} 内容块`);
      return;
    }
    if (!templateSource.includes(MANUAL_SPLIT_MARKER)) {
      setStatusMsg(`请先把光标放到拆分位置，并添加 ${MANUAL_SPLIT_MARKER}`);
      return;
    }
    const parts = templateSource.split(MANUAL_SPLIT_MARKER).map(item => item.trim()).filter(Boolean);
    setTemplateSegments(parts.map((text, index) => ({ id: `${Date.now()}-manual-${index}`, text })));
    setSelectedSegmentIds(new Set());
    setTemplateSource(templateSource);
    setStatusMsg(`已严格按照 ${parts.length - 1} 个手动拆分点生成 ${parts.length} 段`);
  };

  const updateTemplateSegment = (id: string, text: string) => {
    setTemplateSegments(items => items.map(item => item.id === id ? { ...item, text } : item));
  };

  const updateSegmentFields = (id: string, patch: Partial<TemplateSegment>) => {
    setTemplateSegments(items => items.map(item => item.id === id ? { ...item, ...patch } : item));
  };

  const replaceSegmentWithParts = (id: string, parts: string[]) => {
    setTemplateSegments(items => {
      const index = items.findIndex(item => item.id === id);
      if (index < 0) return items;
      const source = items[index];
      const replacements = parts.filter(Boolean).map((text, partIndex) => ({
        id: `${Date.now()}-${partIndex}`,
        text,
        promptTemplate: source.promptTemplate
      }));
      return [...items.slice(0, index), ...replacements, ...items.slice(index + 1)];
    });
    setSelectedSegmentIds(prev => { const next = new Set(prev); next.delete(id); return next; });
  };

  const autoSplitCurrentSegment = (id: string) => {
    const segment = templateSegments.find(item => item.id === id);
    if (!segment) return;
    const cleanText = segment.text.split(MANUAL_SPLIT_MARKER).join(' ');
    const parts = autoSplitTemplateText(cleanText, splitMinimum, splitMaximum, splitUnit, keepSentences, allowTolerance ? splitTolerance : 0);
    if (parts.length < 2) return setStatusMsg('当前段按现有设置无需继续拆分');
    replaceSegmentWithParts(id, parts);
    setStatusMsg(`已按当前设置将第 ${templateSegments.indexOf(segment) + 1} 段拆分为 ${parts.length} 段`);
  };

  const insertMarkerIntoSegment = (id: string) => {
    const segment = templateSegments.find(item => item.id === id);
    if (!segment) return;
    const caret = segmentCarets[id];
    if (caret === undefined || caret < 0 || caret > segment.text.length) return setStatusMsg('请先把光标放到该段需要拆分的位置');
    updateTemplateSegment(id, `${segment.text.slice(0, caret)}${MANUAL_SPLIT_MARKER}${segment.text.slice(caret)}`);
    setSegmentCarets(prev => ({ ...prev, [id]: caret + MANUAL_SPLIT_MARKER.length }));
    setStatusMsg('已在当前段光标位置插入拆分点');
  };

  const splitCurrentSegmentAtMarkers = (id: string) => {
    const segment = templateSegments.find(item => item.id === id);
    if (!segment?.text.includes(MANUAL_SPLIT_MARKER)) return setStatusMsg('当前段没有手动拆分点');
    const parts = segment.text.split(MANUAL_SPLIT_MARKER).map(text => text.trim()).filter(Boolean);
    replaceSegmentWithParts(id, parts);
    setStatusMsg(`已按手动拆分点将当前段拆分为 ${parts.length} 段`);
  };

  const moveRemainderToNextSegment = (id: string, redistribute: boolean) => {
    const index = templateSegments.findIndex(item => item.id === id);
    if (index < 0 || index >= templateSegments.length - 1) return setStatusMsg('最后一段没有下一段可接收文字');
    const segment = templateSegments[index];
    const caret = segmentCarets[id];
    if (caret === undefined || caret <= 0 || caret >= segment.text.length) return setStatusMsg('请先把光标放在当前段内部需要断开的位置');
    const before = segment.text.slice(0, caret).trim();
    const remainder = segment.text.slice(caret).trim();
    if (!before || !remainder) return setStatusMsg('光标前后都必须有文字');
    const nextSegment = templateSegments[index + 1];
    const combinedNext = `${remainder} ${nextSegment.text.trim()}`.trim();
    const allowedMax = Math.max(splitMinimum, splitMaximum) + (allowTolerance ? splitTolerance : 0);
    const redistributed = redistribute && countSegmentUnits(combinedNext, splitUnit) > allowedMax
      ? autoSplitTemplateText(combinedNext, splitMinimum, splitMaximum, splitUnit, keepSentences, allowTolerance ? splitTolerance : 0)
      : [combinedNext];
    const nextReplacements: TemplateSegment[] = redistributed.map((text, partIndex) => ({
      id: partIndex === 0 ? nextSegment.id : `${Date.now()}-cascade-${partIndex}`,
      text,
      promptTemplate: nextSegment.promptTemplate
    }));
    setTemplateSegments(items => [
      ...items.slice(0, index),
      { ...segment, text: before, finalPrompt: undefined },
      ...nextReplacements,
      ...items.slice(index + 2)
    ]);
    setStatusMsg(redistributed.length > 1
      ? `已将光标后的文字移到下一段，并因超出范围自动重排为 ${redistributed.length} 段`
      : redistribute
        ? `已将第 ${index + 1} 段光标后的文字并入下一段，当前无需继续重排`
        : `已仅移动到第 ${index + 2} 段，未自动重新拆分`);
  };

  const mergeNextAndResplit = (id: string) => {
    const index = templateSegments.findIndex(item => item.id === id);
    if (index < 0 || index >= templateSegments.length - 1) return setStatusMsg('最后一段无法与下一段合并');
    const current = templateSegments[index];
    const next = templateSegments[index + 1];
    const mergedText = `${current.text.trim()} ${next.text.trim()}`.trim();
    const parts = autoSplitTemplateText(mergedText, splitMinimum, splitMaximum, splitUnit, keepSentences, allowTolerance ? splitTolerance : 0);
    const replacements: TemplateSegment[] = parts.map((text, partIndex) => ({ id: `${Date.now()}-resplit-${partIndex}`, text, promptTemplate: current.promptTemplate }));
    setTemplateSegments(items => [...items.slice(0, index), ...replacements, ...items.slice(index + 2)]);
    setSelectedSegmentIds(new Set());
    setStatusMsg(`已合并第 ${index + 1}、${index + 2} 段并重新拆分为 ${parts.length} 段`);
  };

  const mergeSelectedTemplateSegments = () => {
    const indexes = templateSegments.map((item, index) => selectedSegmentIds.has(item.id) ? index : -1).filter(index => index >= 0);
    if (indexes.length < 2) {
      setStatusMsg('请至少选择两个相邻段落进行合并');
      return;
    }
    if (indexes.some((index, i) => i > 0 && index !== indexes[i - 1] + 1)) {
      setStatusMsg('只能合并连续相邻的段落');
      return;
    }
    const first = indexes[0];
    const last = indexes[indexes.length - 1];
    const merged: TemplateSegment = {
      id: `${Date.now()}-merged`,
      text: templateSegments.slice(first, last + 1).map(item => item.text.trim()).filter(Boolean).join(' ')
    };
    setTemplateSegments(items => [...items.slice(0, first), merged, ...items.slice(last + 1)]);
    setSelectedSegmentIds(new Set([merged.id]));
    setStatusMsg(`已合并 ${indexes.length} 个段落`);
  };

  const splitSelectedAtCarets = () => {
    let splitCount = 0;
    const next: TemplateSegment[] = [];
    for (const item of templateSegments) {
      if (!selectedSegmentIds.has(item.id)) {
        next.push(item);
        continue;
      }
      const caret = segmentCarets[item.id];
      if (!caret || caret >= item.text.length) {
        next.push(item);
        continue;
      }
      const before = item.text.slice(0, caret).trim();
      const after = item.text.slice(caret).trim();
      if (!before || !after) {
        next.push(item);
        continue;
      }
      next.push({ id: `${Date.now()}-${splitCount}-a`, text: before }, { id: `${Date.now()}-${splitCount}-b`, text: after });
      splitCount++;
    }
    if (!splitCount) {
      setStatusMsg('请选中段落，并先把光标放在需要拆分的位置');
      return;
    }
    setTemplateSegments(next);
    setSelectedSegmentIds(new Set());
    setStatusMsg(`已按光标位置拆分 ${splitCount} 个段落`);
  };

  const copyTemplateResults = async (filledOnly = false) => {
    const chosen = selectedSegmentIds.size ? templateSegments.filter(item => selectedSegmentIds.has(item.id)) : templateSegments;
    if (!chosen.length) return setStatusMsg('没有可复制的拆分结果');
    const text = chosen.map(item => filledOnly ? getSegmentFinalPrompt(item) : `${item.text}\t${getSegmentFinalPrompt(item)}`).join('\n');
    await navigator.clipboard.writeText(text);
    setStatusMsg(`已复制 ${chosen.length} 条${filledOnly ? '完整描述词' : '双列结果'}`);
  };

  const exportTemplateResults = () => {
    if (!templateSegments.length) return setStatusMsg('没有可导出的拆分结果');
    const rows = ['序号\t拆分文案\t完整描述词', ...templateSegments.map((item, index) => `${index + 1}\t${item.text.replace(/\t/g, ' ')}\t${getSegmentFinalPrompt(item).replace(/\t/g, ' ')}`)];
    const url = URL.createObjectURL(new Blob([rows.join('\n')], { type: 'text/tab-separated-values;charset=utf-8' }));
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `模板拆分结果_${Date.now()}.tsv`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  // ===== 合并行内容：多列合并为一列（顿号分隔）=====
  const handleMergeRowContent = () => {
    if (!selection) {
      setStatusMsg('请先用鼠标框选要合并的区域');
      return;
    }
    const minR = Math.min(selection.start.row, selection.end.row);
    const maxR = Math.max(selection.start.row, selection.end.row);
    const minC = Math.min(selection.start.col, selection.end.col);
    const maxC = Math.max(selection.start.col, selection.end.col);
    const totalCols = maxC - minC + 1;
    if (totalCols < 2) {
      setStatusMsg('至少需要选中 2 列才能合并');
      return;
    }

    const newGrid = gridData.map(row => [...row]);
    let mergedCount = 0;

    for (let r = minR; r <= maxR; r++) {
      const parts: string[] = [];
      for (let c = minC; c <= maxC; c++) {
        const val = (newGrid[r]?.[c] || '').trim();
        if (val) parts.push(val);
      }
      if (parts.length === 0) continue;

      // Write merged content to first column
      newGrid[r][minC] = parts.join('、');
      // Clear remaining columns
      for (let c = minC + 1; c <= maxC; c++) {
        newGrid[r][c] = '';
      }
      mergedCount++;
    }

    setGridData(newGrid);

    // Update selection to first column only
    const newSel = {
      start: { row: minR, col: minC },
      end: { row: maxR, col: minC }
    };
    setForceSelection(newSel);
    setSelection(newSel);

    setStatusMsg(`✅ 已将 ${totalCols} 列合并为 1 列（${colToLetter(minC)}），共处理 ${mergedCount} 行，用「、」分隔`);
  };

  // ===== 合并列：将所有列按循环数合并 =====
  const handleMergeColumns = () => {
    if (!selection) {
      setStatusMsg('请先用鼠标框选要合并的区域');
      return;
    }
    setShowMergeModal(true);
  };

  const getFirstSelectedText = (): string => {
    if (!selection) return '';
    const minR = Math.min(selection.start.row, selection.end.row);
    const maxR = Math.max(selection.start.row, selection.end.row);
    const minC = Math.min(selection.start.col, selection.end.col);
    const maxC = Math.max(selection.start.col, selection.end.col);

    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        const value = gridData[r]?.[c]?.trim();
        if (value) return value;
      }
    }
    return '';
  };

  const handleOpenLinkVariantModal = () => {
    const selectedText = getFirstSelectedText();
    setLinkVariantInput(selectedText);
    setShowLinkVariantModal(true);
    if (!selectedText) {
      setStatusMsg('请输入链接，或先选中一个包含链接的单元格');
    }
  };

  const handleGenerateLinkVariants = () => {
    const source = linkVariantInput.trim();
    if (!source) {
      setStatusMsg('请输入需要枚举的链接');
      return;
    }

    try {
      const variants = generateLinkVariants(source);
      if (variants.length === 0) {
        setStatusMsg('链接中没有找到小写 l 或大写 I');
        return;
      }

      const anchorRow = selection ? Math.min(selection.start.row, selection.end.row) : 0;
      const anchorCol = selection ? Math.min(selection.start.col, selection.end.col) : 0;
      const targetCol = anchorCol + 1;
      const nextGrid = gridData.map(row => [...row]);
      const minCols = Math.max(DEFAULT_COLS, targetCol + 1, nextGrid[0]?.length || 0);

      while (nextGrid.length < anchorRow + variants.length) {
        nextGrid.push(Array(minCols).fill(''));
      }

      for (let r = 0; r < nextGrid.length; r++) {
        if (!nextGrid[r]) nextGrid[r] = [];
        while (nextGrid[r].length < minCols) nextGrid[r].push('');
      }

      variants.forEach((variant, idx) => {
        nextGrid[anchorRow + idx][targetCol] = variant;
      });

      const newSelection = {
        start: { row: anchorRow, col: targetCol },
        end: { row: anchorRow + variants.length - 1, col: targetCol }
      };

      setGridData(nextGrid);
      setForceSelection(newSelection);
      setSelection(newSelection);
      setShowLinkVariantModal(false);
      setStatusMsg(`已生成 ${variants.length} 个链接候选，结果在 ${colToLetter(targetCol)}${anchorRow + 1}:${colToLetter(targetCol)}${anchorRow + variants.length}`);
    } catch (err: any) {
      setStatusMsg(err?.message || '链接枚举失败');
    }
  };

  // ===== 信仰词汇大写保护：纯脚本检查 =====
  const handleOpenDeityModal = () => {
    setDeityTerms(loadDeityTerms()); // 每次打开从 localStorage 刷新
    setShowDeityModal(true);
  };

  const handleAddDeityTerm = () => {
    const val = deityNewTerm.trim();
    if (!val) return;
    const newTerms = val.split(/[,，]/).map(t => t.trim()).filter(Boolean);
    const merged = Array.from(new Set([...deityTerms, ...newTerms]));
    setDeityTerms(merged);
    saveDeityTerms(merged);
    setDeityNewTerm('');
  };

  const handleRemoveDeityTerm = (term: string) => {
    const updated = deityTerms.filter(t => t !== term);
    setDeityTerms(updated);
    saveDeityTerms(updated);
  };

  const handleResetDeityTerms = () => {
    setDeityTerms(DEFAULT_DEITY_TERMS);
    saveDeityTerms(DEFAULT_DEITY_TERMS);
  };

  const doDeityCapitalizationCheck = async () => {
    setShowDeityModal(false);
    if (!selection) {
      setStatusMsg('请先用鼠标框选要检查的单元格区域');
      return;
    }

    const minR = Math.min(selection.start.row, selection.end.row);
    const maxR = Math.max(selection.start.row, selection.end.row);
    const minC = Math.min(selection.start.col, selection.end.col);
    const maxC = Math.max(selection.start.col, selection.end.col);

    const W = maxC - minC + 1;
    const resultColOffset = W;
    const feedbackColOffset = W * 2;
    const maxRequiredCol = maxC + feedbackColOffset;

    setDiffCols(prev => {
      const next = { ...prev };
      for (let c = minC; c <= maxC; c++) {
        next[c] = c + resultColOffset;
      }
      return next;
    });

    setAutoRowHeight(true);

    const newGrid = gridData.map(row => [...row]);
    const newStyles = new Map(gridStyles);

    // 确保每行有足够的列
    for (let r = 0; r < newGrid.length; r++) {
      while (newGrid[r].length <= maxRequiredCol) {
        newGrid[r].push('');
      }
    }

    if (!getAiInstance || !getAiInstance()) {
      setStatusMsg(`⚠️ AI 检测未运行 (未配置 API Key)`);
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          if (newGrid[r]?.[c]?.trim()) {
            newGrid[r][c + resultColOffset] = '';
            newGrid[r][c + feedbackColOffset] = '⚠️ 需配置 API Key 运行 AI 检查';
          }
        }
      }
      setGridData(newGrid);
      return;
    }
    const ai = getAiInstance()!;
    let modelToUse = effectiveModel;
    let autoUpgradeMsg = '';
    if (modelToUse.toLowerCase().includes('lite') || modelToUse === 'gemini-3.1-flash-lite') {
      modelToUse = 'gemini-3.5-flash';
      autoUpgradeMsg = ' (检测到 Lite 模型，已自动升级至 3.5-flash 以确保效果)';
    }

    setSpellChecking(true);
    setStatusMsg(`🔍 AI 智能检测中...${autoUpgradeMsg}`);

    try {
      // 收集需要检查的单元格（直接使用选区内的原文）
      const cellsToCheck: { row: number; col: number; text: string }[] = [];
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          const val = newGrid[r]?.[c] || '';
          if (val.trim()) {
            cellsToCheck.push({ row: r, col: c, text: val });
          } else {
            newGrid[r][c + resultColOffset] = '';
            newGrid[r][c + feedbackColOffset] = '';
          }
        }
      }

      if (cellsToCheck.length === 0) {
        setStatusMsg('选区内没有内容');
        setSpellChecking(false);
        return;
      }

      const BATCH_SIZE = 20;
      let spellFixCount = 0;
      const latestGrid = newGrid.map(row => [...row]);
      const latestStyles = new Map(newStyles);

      for (let batchStart = 0; batchStart < cellsToCheck.length; batchStart += BATCH_SIZE) {
        const batch = cellsToCheck.slice(batchStart, batchStart + BATCH_SIZE);
        setStatusMsg(`🔍 AI 智能检测中... (${batchStart}/${cellsToCheck.length})`);

        try {
          const pronounsList = ['he', 'him', 'his', 'you', 'your', 'siya', 'kanya', 'niya', 'kayo', 'iyo', 'mo', 'ka', 'ninyo', 'sila', 'kila', 'kaniya'];
          const properDeityTerms = deityTerms.filter(t => !pronounsList.includes(t.toLowerCase()));
          const textsJson = batch.map((c, i) => `[${i}] ${c.text}`).join('\n---\n');
          const prompt = `You are a professional proofreader specializing in prayer/inspirational social media content in multiple languages (especially English and Tagalog/Filipino). For each numbered text below, fix ALL spelling, grammar, punctuation, and capitalization errors while preserving the original meaning, tone, and language of the text.

FIX THESE ERROR TYPES across English and Tagalog:
1. SPELLING & TYPOS: e.g., "Whoe" → "Whoever", "recieve" → "receive", Tagalog typos like "mahalin" / "pananampalataya" typos.
2. RELIGIOUS PROPER NOUNS: e.g., "Our Lady of Lords" → "Our Lady of Lourdes", "Pslam" → "Psalm", Tagalog names like "Hesukristo", "Diyos".
3. SPEECH-TO-TEXT ARTIFACTS: e.g., "our men" → "Amen", "nor Jesus" → "In Jesus' name" (reconstruct garbled phrases from voice transcription)
4. MISSING PUNCTUATION: Add periods between run-on sentences. Add proper sentence capitalization.
5. GRAMMAR & WORD CORRECTION: Fix verb tenses, subject-verb agreement, and word confusion.
6. NUMBERING SEQUENCE: "First...Second...Second" → "First...Second...Third"
7. BROKEN SENTENCES: Fix garbled sentence boundaries.
8. PRONOUN & PROPER NOUN CAPITALIZATION FOR DEITY:
   - PROPER NOUNS: Capitalize all proper nouns referring to Deity. Specific words list: [${properDeityTerms.join(', ')}].
   - PRONOUNS (CONTEXT-DEPENDENT): ONLY capitalize pronouns (e.g., He, Him, His, You, Your, Siya, Kanya, Niya) if they DIRECTLY refer to God, Jesus Christ, or the Holy Spirit.
   - AVOID OVER-CAPITALIZATION: DO NOT capitalize pronouns when they refer to the reader/audience or other human beings / biblical characters / prophets.
     * Examples:
       - "God is already working for you and your family" → "you" and "your" refer to the reader (human). They MUST remain lowercase: "you", "your". (Capitalizing to "You" or "Your" is a CRITICAL ERROR).
       - "Joseph was once in a pit, but he was lifted up" → "he" refers to Joseph (human). It MUST remain lowercase: "he". (Capitalizing to "He" is a CRITICAL ERROR).
       - "Daniel was in danger, but he was protected" → "he" refers to Daniel (human). It MUST remain lowercase: "he". (Capitalizing to "He" is a CRITICAL ERROR).
       - "Moses led them, but he doubted" → "he" refers to Moses (human). It MUST remain lowercase: "he".
     * Only capitalize when referring directly to God, e.g., "God is good, He is always there" (He = God), or "We worship You, Lord" (You = Lord).
     * If a pronoun refers to any human, reader, or biblical character, KEEP IT LOWERCASE.
9. AMEN FORMATTING: Wrap standalone "Amen" in quotes (e.g. write "Amen", say "Amen") when referred to as something to type/say.
10. LANGUAGE CONSISTENCY: Keep Tagalog text in Tagalog, English in English. Do NOT translate the text, only correct its errors in its source language.

CRITICAL RULES:
- Keep the language of each text exactly as it is (English stays English, Tagalog stays Tagalog). Do NOT translate between languages!
- Fix ALL errors you find, not just spelling.
- Keep the devotional/prayer tone intact.
- Do NOT add or remove content beyond fixes.
- If a text has no errors, return it EXACTLY as-is.
- Return the COMPLETE corrected text for each entry.

Texts:
${textsJson}

Return ONLY a JSON array of corrected strings: ["corrected1", "corrected2", ...]`;

          const response = await ai.models.generateContent({
            model: modelToUse,
            contents: prompt,
          });

          const resultText = (response as any).text || '';
          const jsonMatch = resultText.match(/\[[\s\S]*\]/);
          if (!jsonMatch) {
            throw new Error('AI返回格式解析失败');
          }

          const corrected: string[] = JSON.parse(jsonMatch[0]);
          for (let i = 0; i < batch.length && i < corrected.length; i++) {
            const cell = batch[i];
            const original = cell.text;
            const fixed = corrected[i];
            
            latestGrid[cell.row][cell.col + resultColOffset] = fixed || original;
            if (fixed && fixed !== original) {
              spellFixCount++;
              // 修正后单元格浅紫色高亮显示结果单元格
              latestStyles.set(cellKey(cell.row, cell.col + resultColOffset), { bgColor: '#c4b5fd' });
              latestGrid[cell.row][cell.col + feedbackColOffset] = '🤖 AI已修正';
            } else {
              latestGrid[cell.row][cell.col + feedbackColOffset] = '✅';
            }
          }
        } catch (batchErr) {
          // 单个 batch 出错，在该 batch 所有单元格反馈中标注异常
          for (const cell of batch) {
            latestGrid[cell.row][cell.col + feedbackColOffset] = '⚠️ AI 检查失败，请重试';
          }
        }
      }

      setGridData(latestGrid);
      setGridStyles(latestStyles);
      setStatusMsg(`✅ AI 智能检测完成，已修正 ${spellFixCount} 个单元格（结果见 ${colToLetter(minC + resultColOffset)} 列，反馈见 ${colToLetter(minC + feedbackColOffset)} 列）`);
    } catch (err: any) {
      setStatusMsg(`⚠️ AI 智能检测失败: ${err.message || '未知错误'}`);
      const failedGrid = newGrid.map(row => [...row]);
      for (let r = minR; r <= maxR; r++) {
        for (let c = minC; c <= maxC; c++) {
          if (failedGrid[r]?.[c]?.trim()) {
            failedGrid[r][c + feedbackColOffset] = '⚠️ AI 检查失败，请重试';
          }
        }
      }
      setGridData(failedGrid);
    } finally {
      setSpellChecking(false);
    }
  };

  // ===== 合并单元格：生成 colspan 格式并复制到剪贴板 =====
  const handleOpenMergeCellModal = () => {
    if (!selection) {
      setStatusMsg('请先用鼠标框选要处理的单元格区域');
      return;
    }
    setShowMergeCellModal(true);
  };

  const doMergeCellGenerate = async () => {
    setShowMergeCellModal(false);
    if (!selection) return;

    const minR = Math.min(selection.start.row, selection.end.row);
    const maxR = Math.max(selection.start.row, selection.end.row);
    const minC = Math.min(selection.start.col, selection.end.col);
    const maxC = Math.max(selection.start.col, selection.end.col);
    const totalCols = maxC - minC + 1;
    const totalRows = maxR - minR + 1;
    const span = Math.max(1, mergeCellSpan);

    // 收集选区数据
    const sourceGrid: string[][] = [];
    for (let r = minR; r <= maxR; r++) {
      const row: string[] = [];
      for (let c = minC; c <= maxC; c++) {
        row.push(gridData[r]?.[c] || '');
      }
      sourceGrid.push(row);
    }

    // 写入表格：每个值占 span 列（第一个写值，后面填空）
    const newGrid = gridData.map(row => [...row]);
    const expandedCols = totalCols * span;
    const targetStartCol = maxC + 1; // 写到选区右侧

    // 确保每行有足够的列
    for (let r = 0; r < newGrid.length; r++) {
      while (newGrid[r].length < targetStartCol + expandedCols) {
        newGrid[r].push('');
      }
    }
    // 确保有足够的行
    while (newGrid.length < minR + totalRows) {
      newGrid.push(Array(targetStartCol + expandedCols).fill(''));
    }

    for (let r = 0; r < sourceGrid.length; r++) {
      const targetRow = minR + r;
      for (let c = 0; c < sourceGrid[r].length; c++) {
        const targetCol = targetStartCol + c * span;
        // 确保行有足够的列
        while (newGrid[targetRow].length < targetCol + span) {
          newGrid[targetRow].push('');
        }
        // 第一个单元格写值
        newGrid[targetRow][targetCol] = sourceGrid[r][c];
        // 后续单元格填空（模拟合并效果）
        for (let s = 1; s < span; s++) {
          newGrid[targetRow][targetCol + s] = '';
        }
      }
    }

    setGridData(newGrid);

    // 更新选区到新生成的区域
    const newSelection = {
      start: { row: minR, col: targetStartCol },
      end: { row: minR + totalRows - 1, col: targetStartCol + expandedCols - 1 }
    };
    setForceSelection(newSelection);
    setSelection(newSelection);

    // 生成 colspan HTML 并复制到剪贴板
    const mergedHtml = buildMergedCellsHtml(sourceGrid, span);
    const textLines = sourceGrid.map(row => {
      return row.map(cell => {
        // 纯文本：每个值后面跟 (span-1) 个 tab
        const tabs = '\t'.repeat(span - 1);
        return cell + tabs;
      }).join('\t');
    }).join('\n');

    const result = await copyToClipboard(textLines, mergedHtml);
    const copyMsg = result === 'rich' ? '（已复制到剪贴板，可直接粘贴到 Google Sheets）' 
                  : result === 'text' ? '（已复制纯文本）' : '';

    setStatusMsg(`✅ 已生成合并单元格格式：${totalRows} 行 × ${totalCols} 列，每值跨 ${span} 列 → 总宽 ${expandedCols} 列 ${copyMsg}`);
  };

  const doMergeColumns = () => {
    setShowMergeModal(false);
    if (!selection) return;

    const minR = Math.min(selection.start.row, selection.end.row);
    const maxR = Math.max(selection.start.row, selection.end.row);
    const minC = Math.min(selection.start.col, selection.end.col);
    const maxC = Math.max(selection.start.col, selection.end.col);
    const totalCols = maxC - minC + 1;
    const totalRows = maxR - minR + 1;
    const cycle = Math.max(1, Math.min(mergeCycle, totalCols));

    if (totalCols <= cycle) {
      setStatusMsg(`选区只有 ${totalCols} 列，不需要合并（循环列数 = ${cycle}）`);
      return;
    }

    // 计算有多少组
    const groupCount = Math.ceil(totalCols / cycle);

    // 收集每组的行数据
    const mergedRows: string[][] = [];
    for (let g = 0; g < groupCount; g++) {
      const startCol = minC + g * cycle;
      for (let r = minR; r <= maxR; r++) {
        const row: string[] = [];
        let hasContent = false;
        for (let c = 0; c < cycle; c++) {
          const actualCol = startCol + c;
          const val = actualCol <= maxC ? (gridData[r]?.[actualCol] || '') : '';
          row.push(val);
          if (val.trim()) hasContent = true;
        }
        if (hasContent) mergedRows.push(row);
      }
    }

    // 构建新的 grid
    const newGrid = gridData.map(row => [...row]);

    // 先清空选区
    for (let r = minR; r <= maxR; r++) {
      for (let c = minC; c <= maxC; c++) {
        if (newGrid[r]) newGrid[r][c] = '';
      }
    }

    // 确保有足够的行
    const neededRows = minR + mergedRows.length;
    while (newGrid.length < neededRows) {
      newGrid.push(Array(newGrid[0]?.length || DEFAULT_COLS).fill(''));
    }

    // 写入合并后的数据
    for (let i = 0; i < mergedRows.length; i++) {
      const targetRow = minR + i;
      for (let c = 0; c < cycle; c++) {
        if (!newGrid[targetRow]) newGrid[targetRow] = Array(newGrid[0]?.length || DEFAULT_COLS).fill('');
        newGrid[targetRow][minC + c] = mergedRows[i][c] || '';
      }
    }

    setGridData(newGrid);

    // 更新选区
    const newSelection = {
      start: { row: minR, col: minC },
      end: { row: minR + mergedRows.length - 1, col: minC + cycle - 1 }
    };
    setForceSelection(newSelection);
    setSelection(newSelection);

    const colStr = Array.from({ length: cycle }, (_, i) => colToLetter(minC + i)).join(', ');
    setStatusMsg(`✅ 已将 ${totalCols} 列（${groupCount} 组 × ${cycle} 列）合并为 ${mergedRows.length} 行，结果在列: ${colStr}`);
  };

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

  // 持久化关键状态：切换页面返回时保留文案拆分内容
  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        const payload: PersistedScriptToolState = {
          gridData,
          selection,
          clearSource,
          gridStyles: Array.from(gridStyles.entries()),
          customPrefix,
          mergeCycle,
          mergeCellSpan,
          diffCols,
          autoRowHeight
        };
        memoryPersistedState = payload;
      } catch {
        // ignore errors
      }
    }, 150);
    return () => window.clearTimeout(timer);
  }, [gridData, selection, clearSource, gridStyles, customPrefix, mergeCycle, mergeCellSpan, diffCols, autoRowHeight]);

  // 实际处理函数
  const doProcess = (tool: ToolType, prefix?: string) => {
    if (!selection) {
      setStatusMsg('请先用鼠标框选要处理的单元格区域');
      return;
    }

    // clearSource: false = 保留原文（默认）, true = 删除原文
    const options: ProcessOptions = { clearSource, customPrefix: prefix, lineWidth };
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
    } else if (tool === ToolType.CleanEmojis) {
      let cleanedCount = 0;
      for (const col of updatedCols) {
        if (col <= -6000 && col > -7000) {
          cleanedCount = -(col + 6000);
        }
      }
      toolMsg = cleanedCount > 0
        ? `已清理 ${cleanedCount} 个单元格中的表情符号`
        : `选区内没有发现表情符号`;
    } else {
      const colsStr = updatedCols.filter(c => c >= 0).map(c => colToLetter(c)).join(', ');
      const clearMsg = clearSource ? ' (已删除原文案)' : '';
      toolMsg = `已处理选区，结果更新于列: ${colsStr}${clearMsg}`;
    }
    setStatusMsg(toolMsg);
  };

  // 入口函数：对于 AddPromptPrefix / AutoWrap 显示弹窗，其他工具直接处理
  const handleProcess = (tool: ToolType) => {
    if (!selection) {
      setStatusMsg('请先用鼠标框选要处理的单元格区域');
      return;
    }
    if (tool === ToolType.AddPromptPrefix) {
      setShowPrefixModal(true);
    } else if (tool === ToolType.AutoWrap) {
      setShowWrapModal(true);
    } else {
      doProcess(tool);
    }
  };

  // 确认添加前缀
  const handleConfirmPrefix = () => {
    setShowPrefixModal(false);
    doProcess(ToolType.AddPromptPrefix, customPrefix);
  };

  // 确认自动断行
  const handleConfirmWrap = () => {
    setShowWrapModal(false);
    doProcess(ToolType.AutoWrap);
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

  const handleClearGrid = () => {
    const nextGrid =
      gridData.length > 0
        ? gridData.map(row => row.map(() => ''))
        : createEmptyGrid();
    setGridData(nextGrid);
    setGridStyles(new Map());
    setDiffCols({});
    setSelection(null);
    setForceSelection(null);
    setCopied(false);
    setCopiedSelection(false);
    setStatusMsg('已清空表格文字与背景标记（保留表格结构）');
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
    <div className="script-tool-app tool-container" style={{ display: 'flex', flexDirection: 'column', overflow: 'hidden', padding: '0' }}>
      {/* Toolbar */}
      <header className="bg-[#f9fbfd] border-b border-slate-200 px-4 py-2 flex-none" style={{ overflow: 'visible' }}>
        <div className="flex flex-col gap-3">

          <div className="flex flex-col lg:flex-row lg:items-start lg:justify-between gap-2.5">
            <div className="flex items-center gap-2 flex-wrap">
              <div className="bg-[#107c41] p-1.5 rounded text-white shadow-sm">
                <Grid3X3 className="w-5 h-5" />
              </div>
              <div>
                <h1 className="text-sm font-medium text-slate-800 leading-tight">文案加工站</h1>
                <p className="text-[10px] text-slate-500">类 Google Sheets 编辑器</p>
              </div>
              <div className="hidden md:flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 bg-white text-[11px] text-slate-600">
                <MousePointer2 className="w-3.5 h-3.5" />
                <span>选区：</span>
                <span className="font-medium text-slate-700">{selection ? getSelectionLabel() : '未选择'}</span>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center gap-1.5 p-1 rounded-lg border border-slate-200 bg-white shadow-sm">
                <Button variant="primary" onClick={handleSelectAll} className="inline-flex items-center justify-center bg-blue-600 hover:bg-blue-700 text-white border-transparent text-xs whitespace-nowrap px-3 py-1.5 leading-none transition-all hover:shadow-md hover:shadow-blue-500/35">
                  <CheckSquare className="w-3.5 h-3.5 mr-1" />
                  选中全部
                </Button>
                <Button variant="primary" onClick={handleCopyAll} className="inline-flex items-center justify-center bg-[#107c41] hover:bg-[#0b6a37] text-white border-transparent text-xs whitespace-nowrap px-3 py-1.5 leading-none transition-all hover:shadow-md hover:shadow-emerald-500/35">
                  {copied ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                  {copied ? '已复制' : '复制全部'}
                </Button>
                <Button
                  variant="primary"
                  onClick={handleCopySelection}
                  disabled={!selection}
                  className="inline-flex items-center justify-center bg-emerald-600 hover:bg-emerald-700 text-white border-transparent text-xs whitespace-nowrap px-3 py-1.5 leading-none transition-all hover:shadow-md hover:shadow-cyan-500/25 disabled:opacity-100 disabled:bg-slate-800 disabled:text-slate-400 disabled:border-slate-700 disabled:shadow-none"
                >
                  {copiedSelection ? <Check className="w-3.5 h-3.5 mr-1" /> : <Copy className="w-3.5 h-3.5 mr-1" />}
                  {copiedSelection ? '已复制' : '复制选中'}
                </Button>
                <Button
                  variant="primary"
                  onClick={handleClearGrid}
                  className="inline-flex items-center justify-center bg-slate-700 hover:bg-slate-600 text-white border-transparent text-xs whitespace-nowrap px-3 py-1.5 leading-none transition-all hover:shadow-md hover:shadow-slate-500/25"
                >
                  <Trash2 className="w-3.5 h-3.5 mr-1" />
                  清空表格
                </Button>
              </div>

              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white">
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

              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-lg border border-slate-200 bg-white">
                <span className="text-xs text-slate-500">自动行高</span>
                <button
                  onClick={() => setAutoRowHeight(!autoRowHeight)}
                  data-tip={autoRowHeight ? '点击关闭自动行高撑开' : '点击开启内容自动撑开行高'}
                  className={`tooltip-bottom relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${autoRowHeight ? 'bg-emerald-500' : 'bg-slate-300'}`}
                >
                  <span
                    className={`inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform ${autoRowHeight ? 'switch-on' : 'switch-off'}`}
                  />
                </button>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-1 flex-wrap">
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
              icon={<ListOrdered className="w-4 h-4" />}
              label="排比句排列"
              tooltip="自动提取并排列带序号/英文序数的排比句（保留前言和结尾的原始换行）"
              onClick={() => handleProcess(ToolType.ArrangeParallel)}
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
              // Use a text emoji as an icon
              icon={<span className="w-4 h-4 inline-flex items-center justify-center text-sm">🧹</span>}
              label="清理表情"
              tooltip="自动删除文本中的 emoji 表情图标和特殊符号"
              onClick={() => handleProcess(ToolType.CleanEmojis)}
              disabled={!selection}
            />
            <ToolButton
              icon={<AlignLeft className="w-4 h-4" />}
              label="自动断行"
              tooltip="按最高 18 个字符智能断行排版，保留英语单词完整"
              onClick={() => handleProcess(ToolType.AutoWrap)}
              disabled={!selection}
            />
            <ToolButton
              icon={<FileInput className="w-4 h-4" />}
              label="模板拆分"
              tooltip="按单词或字符拆分文案，并自动填充到描述词模板的内容块"
              onClick={() => setShowTemplateSplitter(true)}
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
            <ToolButton
              icon={<Combine className="w-4 h-4" />}
              label="合并列"
              tooltip="将多列数据按循环数合并（如3列一循环：D-F并入A-C下方）"
              onClick={handleMergeColumns}
              disabled={!selection}
            />
            <ToolButton
              icon={<span className="w-4 h-4 inline-flex items-center justify-center text-xs font-bold">→1</span>}
              label="多列合一"
              tooltip="将选区每行的多列内容合并到第一列，用顿号（、）分隔"
              onClick={handleMergeRowContent}
              disabled={!selection}
            />
            <ToolButton
              icon={<Link2 className="w-4 h-4" />}
              label="链接枚举"
              tooltip="枚举链接里小写 l 与大写 I 的所有可能组合，结果写入右侧一列"
              onClick={handleOpenLinkVariantModal}
            />
            <ToolButton
              icon={<span className="w-4 h-4 inline-flex items-center justify-center text-xs font-bold">⊞</span>}
              label="合并单元格"
              tooltip="将选区每列数据生成合并单元格格式（跨N列），结果写入右侧并自动复制到剪贴板"
              onClick={handleOpenMergeCellModal}
              disabled={!selection}
            />
            <ToolButton
              icon={<span className="w-4 h-4 inline-flex items-center justify-center text-xs font-bold">✝</span>}
              label="文案检查修正"
              tooltip="检查信仰词汇大写与拼写错误，在右侧生成修正结果与反馈报告，可自定义大写词汇列表"
              onClick={handleOpenDeityModal}
              disabled={!selection}
            />
            <div className="flex items-center gap-1.5 px-2 py-1 rounded-md border border-slate-200 bg-white">
              <span className="text-xs font-medium text-slate-600">AI模型:</span>
              <select
                value={localModel}
                onChange={e => {
                  const v = e.target.value;
                  setLocalModel(v);
                  try { localStorage.setItem(LOCAL_MODEL_KEY, v); } catch {}
                }}
                className="text-xs border border-slate-300 rounded px-1.5 py-1 bg-white text-slate-700"
                style={{ maxWidth: '220px' }}
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
        <div className="mt-1 flex items-center justify-between text-xs">
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
      <main className="flex-1 flex flex-col overflow-hidden relative" style={{ minHeight: 0 }}>
        <SpreadsheetGrid
          data={gridData}
          onChange={setGridData}
          onSelectionChange={setSelection}
          externalSelection={forceSelection}
          cellStyles={gridStyles}
          diffColumns={diffCols}
          autoRowHeight={autoRowHeight}
        />
      </main>

      {showTemplateSplitter && (
        <div className="prefix-modal-overlay" onClick={() => setShowTemplateSplitter(false)}>
          <div className="bg-white rounded-lg shadow-2xl border border-slate-200 flex flex-col" style={{ width: 'min(96vw, 1500px)', height: 'min(92vh, 920px)' }} onClick={e => e.stopPropagation()}>
            <div className="px-5 py-3 border-b border-slate-200 flex items-center justify-between">
              <div>
                <h3 className="text-base font-semibold text-slate-800">模板拆分与批量编辑</h3>
                <p className="text-xs text-slate-500 mt-0.5">内容块默认插入为 {QUOTED_CONTENT_PLACEHOLDER}，可放在描述词的任意位置</p>
              </div>
              <button className="text-slate-500 hover:text-slate-800 px-2 py-1" onClick={() => setShowTemplateSplitter(false)}>关闭</button>
            </div>

            <div className="p-4 border-b border-slate-200 grid grid-cols-1 lg:grid-cols-2 gap-3">
              <label className="text-xs font-medium text-slate-600">
                <span className="flex items-center justify-between gap-2"><span>原始文案</span><span className="inline-flex items-center gap-2"><button type="button" title="撤销" onClick={() => undoEditor('source')} className="rounded border border-slate-500 p-1 text-slate-300"><Undo2 className="w-3.5 h-3.5" /></button><button type="button" title="重做" onClick={() => redoEditor('source')} className="rounded border border-slate-500 p-1 text-slate-300"><Redo2 className="w-3.5 h-3.5" /></button><button type="button" onClick={insertManualSplitMarker} className="rounded border border-cyan-400 bg-cyan-900 px-2 py-1 text-[11px] font-medium text-cyan-100">在光标处添加拆分点</button><button type="button" onClick={runManualPointSplit} className="rounded border border-emerald-400 bg-emerald-900 px-2 py-1 text-[11px] font-medium text-emerald-100">按拆分点生成</button><span className="inline-flex items-center gap-1 text-[11px] text-slate-400"><Maximize2 className="w-3 h-3" />双击放大</span></span></span>
                <HighlightedTextarea ref={templateSourceRef} onDoubleClick={() => setExpandedEditor('source')} onKeyDown={e => handleEditorShortcut(e, 'source')} className="mt-1 w-full min-h-28 border border-slate-300 rounded-md p-2 text-sm resize-y" value={templateSource} onChange={e => setEditorValue('source', e.target.value)} placeholder={`输入完整文案；手动拆分点会显示为 ${MANUAL_SPLIT_MARKER}`} title="双击放大编辑" />
              </label>
              <label className="text-xs font-medium text-slate-600">
                <span className="flex items-center justify-between gap-2">
                  <span>完整描述词模板</span>
                  <span className="ml-auto inline-flex items-center gap-1"><button type="button" title="撤销" onClick={() => undoEditor('template')} className="rounded border border-slate-500 p-1 text-slate-300"><Undo2 className="w-3.5 h-3.5" /></button><button type="button" title="重做" onClick={() => redoEditor('template')} className="rounded border border-slate-500 p-1 text-slate-300"><Redo2 className="w-3.5 h-3.5" /></button></span>
                  <button type="button" onClick={insertContentPlaceholder} className="inline-flex items-center gap-1 rounded border border-blue-300 bg-blue-50 px-2 py-1 text-xs font-medium text-blue-700 hover:bg-blue-100">
                    <FileInput className="w-3.5 h-3.5" />在光标处插入内容块
                  </button>
                </span>
                <HighlightedTextarea ref={promptTemplateRef} onDoubleClick={() => setExpandedEditor('template')} onKeyDown={e => handleEditorShortcut(e, 'template')} className="mt-1 w-full min-h-28 border border-slate-300 rounded-md p-2 text-sm resize-y" value={promptTemplate} onChange={e => setEditorValue('template', e.target.value)} placeholder="粘贴完整描述词，把光标放到文案应出现的位置，再点击插入内容块" title="双击放大编辑" />
                <span className="mt-2 grid grid-cols-1 sm:grid-cols-[minmax(180px,1fr)_minmax(160px,240px)_auto_auto] items-center gap-2">
                  <select className="w-full border rounded px-2 py-2 text-xs font-normal placeholder:text-slate-400" style={{ minWidth: 0, backgroundColor: '#0f1e36', color: '#e2e8f0', borderColor: '#49617f', colorScheme: 'dark' }} value={selectedPresetId} onChange={e => loadTemplatePreset(e.target.value)}>
                    <option value="">选择描述词预设</option>
                    {templatePresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                  </select>
                  <input className="w-full border rounded px-2 py-2 text-xs font-normal placeholder:text-slate-400" style={{ minWidth: 0, backgroundColor: '#0f1e36', color: '#e2e8f0', borderColor: '#49617f', caretColor: '#e2e8f0' }} value={presetName} onChange={e => setPresetName(e.target.value)} placeholder="输入预设名称" />
                  <button type="button" onClick={saveTemplatePreset} className="rounded px-3 py-2 text-xs font-semibold whitespace-nowrap" style={{ backgroundColor: '#047857', color: '#ffffff', border: '1px solid #10b981' }}>保存预设</button>
                  <button type="button" onClick={deleteTemplatePreset} disabled={!selectedPresetId} className="rounded px-3 py-2 text-xs font-semibold whitespace-nowrap disabled:opacity-40" style={{ backgroundColor: selectedPresetId ? '#991b1b' : '#27364d', color: '#ffffff', border: `1px solid ${selectedPresetId ? '#ef4444' : '#49617f'}` }}>删除</button>
                </span>
              </label>
            </div>

            <div className="px-4 py-2.5 border-b border-slate-200 flex items-center gap-3 flex-wrap bg-slate-50">
              <label className="text-xs text-slate-600 flex items-center gap-1.5">拆分依据
                <select className="border border-slate-300 rounded px-2 py-1 bg-white" value={splitUnit} onChange={e => setSplitUnit(e.target.value as SplitUnit)}>
                  <option value="words">单词数</option><option value="characters">字符数</option>
                </select>
              </label>
              <label className="text-xs text-slate-600 flex items-center gap-1.5">最小数量
                <input className="w-20 border border-slate-300 rounded px-2 py-1" type="number" min="1" value={splitMinimum} onChange={e => setSplitMinimum(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="text-xs text-slate-600 flex items-center gap-1.5">最大数量
                <input className="w-20 border border-slate-300 rounded px-2 py-1" type="number" min="1" value={splitMaximum} onChange={e => setSplitMaximum(Math.max(1, Number(e.target.value) || 1))} />
              </label>
              <label className="text-xs text-slate-600 flex items-center gap-1.5"><input type="checkbox" checked={keepSentences} onChange={e => setKeepSentences(e.target.checked)} />优先按停顿标点拆分</label>
              <label className="text-xs text-slate-600 flex items-center gap-1.5"><input type="checkbox" checked={allowTolerance} onChange={e => setAllowTolerance(e.target.checked)} />允许按标点浮动</label>
              <label className={`text-xs flex items-center gap-1.5 ${allowTolerance ? 'text-slate-600' : 'text-slate-400'}`}>±
                <input className="w-16 border border-slate-300 rounded px-2 py-1" type="number" min="0" disabled={!allowTolerance} value={splitTolerance} onChange={e => setSplitTolerance(Math.max(0, Number(e.target.value) || 0))} />
              </label>
              <Button variant="primary" onClick={runTemplateSplit} className="bg-blue-600 hover:bg-blue-700 text-white text-xs px-3 py-1.5">开始拆分</Button>
            </div>

            <div className="px-4 py-2 border-b border-slate-200 flex items-center gap-2 flex-wrap">
              <div className="inline-flex rounded-md border border-slate-500 overflow-hidden">
                <button type="button" onClick={() => setStoryboardMode(false)} className="px-3 py-1.5 text-xs font-medium" style={{ backgroundColor: !storyboardMode ? '#2563eb' : '#17253b', color: '#fff' }}>统一模板</button>
                <button type="button" onClick={() => setStoryboardMode(true)} className="px-3 py-1.5 text-xs font-medium" style={{ backgroundColor: storyboardMode ? '#7c3aed' : '#17253b', color: '#fff' }}>分镜模式</button>
              </div>
              <Button onClick={mergeSelectedTemplateSegments} disabled={selectedSegmentIds.size < 2} className="text-xs px-2.5 py-1.5"><Combine className="w-3.5 h-3.5 mr-1" />批量合并</Button>
              <Button onClick={splitSelectedAtCarets} disabled={!selectedSegmentIds.size} className="text-xs px-2.5 py-1.5"><Scissors className="w-3.5 h-3.5 mr-1" />按光标批量拆分</Button>
              <Button onClick={() => copyTemplateResults(false)} className="text-xs px-2.5 py-1.5"><Copy className="w-3.5 h-3.5 mr-1" />复制双列</Button>
              <Button onClick={() => copyTemplateResults(true)} className="text-xs px-2.5 py-1.5"><Copy className="w-3.5 h-3.5 mr-1" />复制完整描述词</Button>
              <Button onClick={exportTemplateResults} className="text-xs px-2.5 py-1.5"><Download className="w-3.5 h-3.5 mr-1" />导出 TSV</Button>
              <span className="ml-auto text-xs text-slate-500">已选 {selectedSegmentIds.size} / 共 {templateSegments.length} 段</span>
            </div>

            <div className="flex-1 overflow-auto p-4 bg-slate-50">
              <table className="w-full border-collapse bg-white text-sm table-fixed">
                <thead className="sticky top-0 bg-slate-100 z-10"><tr><th className="border border-slate-300 p-2 w-12"><input type="checkbox" checked={templateSegments.length > 0 && selectedSegmentIds.size === templateSegments.length} onChange={e => setSelectedSegmentIds(e.target.checked ? new Set(templateSegments.map(item => item.id)) : new Set())} /></th><th className="border border-slate-300 p-2 w-14">序号</th><th className={`border border-slate-300 p-2 text-left ${storyboardMode ? 'w-[28%]' : 'w-[40%]'}`}>拆分文案</th>{storyboardMode && <th className="border border-slate-300 p-2 w-[28%] text-left">本段描述词模板</th>}<th className="border border-slate-300 p-2 text-left">最终描述词（可编辑）</th></tr></thead>
                <tbody>
                  {templateSegments.map((item, index) => {
                    const count = countSegmentUnits(item.text, splitUnit);
                    const lowerBound = Math.max(1, Math.min(splitMinimum, splitMaximum) - (allowTolerance ? splitTolerance : 0));
                    const upperBound = Math.max(splitMinimum, splitMaximum) + (allowTolerance ? splitTolerance : 0);
                    const outOfRange = count < lowerBound || count > upperBound;
                    return <tr key={item.id} className={selectedSegmentIds.has(item.id) ? 'bg-blue-50' : ''}>
                      <td className="border border-slate-300 p-2 text-center"><input type="checkbox" checked={selectedSegmentIds.has(item.id)} onChange={e => setSelectedSegmentIds(prev => { const next = new Set(prev); e.target.checked ? next.add(item.id) : next.delete(item.id); return next; })} /></td>
                      <td className="border border-slate-300 p-2 text-center text-slate-500">{index + 1}</td>
                      <td className="border border-slate-300 p-2 align-top"><textarea className="w-full min-h-24 border border-slate-300 rounded p-2 resize-y text-sm" value={item.text} onChange={e => updateTemplateSegment(item.id, e.target.value)} onSelect={e => { const caret = e.currentTarget.selectionStart; setSegmentCarets(prev => ({ ...prev, [item.id]: caret })); }} /><div className="mt-1 flex items-center gap-1.5 flex-wrap"><span className={`text-[11px] mr-auto ${outOfRange ? 'text-amber-600 font-medium' : 'text-slate-400'}`}>{count} {splitUnit === 'words' ? '个单词' : '个字符'}{outOfRange ? ' · 超出目标范围' : ''}</span><button type="button" onClick={() => autoSplitCurrentSegment(item.id)} className="rounded border border-blue-500 bg-blue-900 px-2 py-1 text-[11px] font-medium text-blue-100">按设置拆分本段</button><button type="button" onClick={() => insertMarkerIntoSegment(item.id)} className="rounded border border-amber-500 bg-amber-900 px-2 py-1 text-[11px] font-medium text-amber-100">光标处插入拆分点</button><button type="button" onClick={() => splitCurrentSegmentAtMarkers(item.id)} className="rounded border border-emerald-500 bg-emerald-900 px-2 py-1 text-[11px] font-medium text-emerald-100">按拆分点拆分本段</button><button type="button" disabled={index === templateSegments.length - 1} onClick={() => moveRemainderToNextSegment(item.id, false)} className="rounded border border-cyan-500 bg-cyan-900 px-2 py-1 text-[11px] font-medium text-cyan-100 disabled:opacity-35">仅后移到下一段</button><button type="button" disabled={index === templateSegments.length - 1} onClick={() => moveRemainderToNextSegment(item.id, true)} className="rounded border border-indigo-500 bg-indigo-900 px-2 py-1 text-[11px] font-medium text-indigo-100 disabled:opacity-35">后移并重排下一段</button><button type="button" disabled={index === templateSegments.length - 1} onClick={() => mergeNextAndResplit(item.id)} className="rounded border border-violet-500 bg-violet-900 px-2 py-1 text-[11px] font-medium text-violet-100 disabled:opacity-35">整段与下一段合并重拆</button></div></td>
                      {storyboardMode && <td className="border border-slate-300 p-2 align-top">
                        <select className="w-full mb-1.5 border border-slate-500 rounded px-2 py-1.5 text-xs" style={{ backgroundColor: '#0f1e36', color: '#e2e8f0', colorScheme: 'dark' }} value={templatePresets.find(preset => preset.template === item.promptTemplate)?.id || ''} onChange={e => { const preset = templatePresets.find(p => p.id === e.target.value); updateSegmentFields(item.id, { promptTemplate: preset?.template, finalPrompt: undefined }); }}>
                          <option value="">使用全局模板</option>
                          {templatePresets.map(preset => <option key={preset.id} value={preset.id}>{preset.name}</option>)}
                        </select>
                        <textarea className="w-full min-h-24 border border-slate-300 rounded p-2 resize-y text-sm" value={item.promptTemplate ?? promptTemplate} onChange={e => updateSegmentFields(item.id, { promptTemplate: e.target.value, finalPrompt: undefined })} />
                        {!((item.promptTemplate ?? promptTemplate).includes(CONTENT_PLACEHOLDER)) && <div className="text-[11px] text-red-400 mt-1">本段模板缺少 {CONTENT_PLACEHOLDER}</div>}
                      </td>}
                      <td className="border border-slate-300 p-2 align-top"><textarea className="w-full min-h-24 border border-slate-300 rounded p-2 resize-y text-sm" value={getSegmentFinalPrompt(item)} onChange={e => updateSegmentFields(item.id, { finalPrompt: e.target.value })} /><div className="mt-1 flex justify-end"><button type="button" onClick={() => updateSegmentFields(item.id, { finalPrompt: undefined })} className="text-[11px] text-blue-400 hover:text-blue-300">恢复自动生成</button></div></td>
                    </tr>;
                  })}
                  {!templateSegments.length && <tr><td colSpan={storyboardMode ? 5 : 4} className="border border-slate-300 py-12 text-center text-slate-400">设置文案和模板后点击“开始拆分”</td></tr>}
                </tbody>
              </table>
            </div>

            {expandedEditor && (
              <div className="absolute inset-0 z-30 flex flex-col bg-[#101d32]" onClick={e => e.stopPropagation()}>
                <div className="flex items-center justify-between gap-3 border-b border-slate-600 px-5 py-3">
                  <div className="text-sm font-semibold text-slate-100">{expandedEditor === 'source' ? '放大编辑：原始文案' : '放大编辑：完整描述词模板'}</div>
                  <div className="flex items-center gap-2">
                    <button type="button" title="撤销" onClick={() => undoEditor(expandedEditor)} className="rounded border border-slate-500 bg-slate-800 p-1.5 text-slate-200"><Undo2 className="w-4 h-4" /></button>
                    <button type="button" title="重做" onClick={() => redoEditor(expandedEditor)} className="rounded border border-slate-500 bg-slate-800 p-1.5 text-slate-200"><Redo2 className="w-4 h-4" /></button>
                    {expandedEditor === 'source' && <button type="button" onClick={insertManualSplitMarker} className="inline-flex items-center gap-1 rounded border border-cyan-400 bg-cyan-900 px-3 py-1.5 text-xs font-medium text-cyan-100"><Scissors className="w-3.5 h-3.5" />在光标处添加拆分点</button>}
                    {expandedEditor === 'source' && <button type="button" onClick={() => { runManualPointSplit(); setExpandedEditor(null); }} className="inline-flex items-center gap-1 rounded border border-emerald-400 bg-emerald-900 px-3 py-1.5 text-xs font-medium text-emerald-100">按拆分点生成</button>}
                    {expandedEditor === 'template' && <button type="button" onClick={insertContentPlaceholder} className="inline-flex items-center gap-1 rounded border border-blue-400 bg-blue-900 px-3 py-1.5 text-xs font-medium text-blue-100"><FileInput className="w-3.5 h-3.5" />在光标处插入内容块</button>}
                    <button type="button" onClick={() => setExpandedEditor(null)} className="rounded border border-slate-500 bg-slate-700 px-3 py-1.5 text-xs font-medium text-white">完成并关闭</button>
                  </div>
                </div>
                <HighlightedTextarea
                  ref={expandedEditor === 'template' ? promptTemplateRef : templateSourceRef}
                  autoFocus
                  containerClassName="flex-1 min-h-0 m-4"
                  className="absolute inset-0 w-full h-full resize-none rounded-md border border-slate-500 bg-[#0b1628] p-4 text-base leading-7 outline-none focus:border-blue-400"
                  value={expandedEditor === 'source' ? templateSource : promptTemplate}
                  onChange={e => setEditorValue(expandedEditor, e.target.value)}
                  onKeyDown={e => handleEditorShortcut(e, expandedEditor)}
                  placeholder={expandedEditor === 'source' ? '输入需要拆分的完整文案' : '粘贴完整描述词，把光标放到文案应出现的位置'}
                />
              </div>
            )}
          </div>
        </div>
      )}

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

      {/* 自动断行设置弹窗 */}
      {showWrapModal && (
        <div className="prefix-modal-overlay" onClick={() => setShowWrapModal(false)}>
          <div className="prefix-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="prefix-modal-title">自动断行设置</h3>
            <p className="prefix-modal-desc">
              设置每行最大字符数。英语单词不会被截断，遇到 <b>: . ? !</b> 标点时自动换行。
              <br />• 默认 <b>18</b> 个字符（适合字幕排版）
              <br />• 较短的值（如 12~15）适合竖屏短视频
              <br />• 较长的值（如 25~30）适合横屏/正常阅读
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span className="text-sm text-slate-600">每行字符数：</span>
              <input
                type="number"
                min={5}
                max={100}
                value={lineWidth}
                onChange={(e) => setLineWidth(Math.max(5, parseInt(e.target.value) || 18))}
                className="prefix-modal-input"
                style={{ width: '80px', textAlign: 'center' }}
                onKeyDown={(e) => { if (e.key === 'Enter') handleConfirmWrap(); }}
                autoFocus
              />
            </div>
            <div className="prefix-modal-actions">
              <button
                onClick={() => setShowWrapModal(false)}
                className="prefix-modal-btn-cancel"
              >
                取消
              </button>
              <button
                onClick={handleConfirmWrap}
                className="prefix-modal-btn-confirm"
              >
                确定断行
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 链接 l/I 枚举弹窗 */}
      {showLinkVariantModal && (
        <div className="prefix-modal-overlay" onClick={() => setShowLinkVariantModal(false)}>
          <div className="prefix-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="prefix-modal-title">链接 l / I 枚举</h3>
            <p className="prefix-modal-desc">
              粘贴看不清的链接，工具会把其中的小写 <b>l</b> 和大写 <b>I</b> 生成所有组合。
              结果会写入当前选区右侧一列，每行一个候选链接。
              <br />当前最多生成 <b>{LINK_VARIANT_LIMIT.toLocaleString()}</b> 条，避免浏览器卡死。
            </p>
            <textarea
              value={linkVariantInput}
              onChange={(e) => setLinkVariantInput(e.target.value)}
              placeholder="粘贴链接，例如：https://example.com/aIl..."
              className="prefix-modal-input"
              rows={4}
              style={{ width: '100%', minHeight: 110, resize: 'vertical', textAlign: 'left' }}
              onKeyDown={(e) => {
                if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                  handleGenerateLinkVariants();
                }
              }}
              autoFocus
            />
            <div className="text-xs text-slate-500" style={{ marginTop: '-4px', marginBottom: '12px' }}>
              已识别 {countAmbiguousLinkChars(linkVariantInput)} 个可疑字符，预计生成 {countAmbiguousLinkChars(linkVariantInput) > 0 ? Math.pow(2, countAmbiguousLinkChars(linkVariantInput)).toLocaleString() : 0} 条。
            </div>
            <div className="prefix-modal-actions">
              <button
                onClick={() => setShowLinkVariantModal(false)}
                className="prefix-modal-btn-cancel"
              >
                取消
              </button>
              <button
                onClick={handleGenerateLinkVariants}
                disabled={!linkVariantInput.trim()}
                className={`prefix-modal-btn-confirm ${!linkVariantInput.trim() ? 'disabled' : ''}`}
              >
                生成候选
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 合并列弹窗 */}
      {showMergeModal && (
        <div className="prefix-modal-overlay" onClick={() => setShowMergeModal(false)}>
          <div className="prefix-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="prefix-modal-title">合并列</h3>
            <p className="prefix-modal-desc">
              设置循环列数。例如：
              <br />• 设为 <b>1</b>：所有列合并到第一列（纵向堆叠）
              <br />• 设为 <b>3</b>：每 3 列为一组，后续组追加到前 3 列下方
              <br />
              <br />选区共 <b>{selection ? Math.abs(selection.end.col - selection.start.col) + 1 : 0}</b> 列，
              将分为 <b>{selection ? Math.ceil((Math.abs(selection.end.col - selection.start.col) + 1) / Math.max(1, mergeCycle)) : 0}</b> 组
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span className="text-sm text-slate-600">循环列数：</span>
              <input
                type="number"
                min={1}
                max={selection ? Math.abs(selection.end.col - selection.start.col) + 1 : 100}
                value={mergeCycle}
                onChange={(e) => setMergeCycle(Math.max(1, parseInt(e.target.value) || 1))}
                className="prefix-modal-input"
                style={{ width: '80px', textAlign: 'center' }}
                onKeyDown={(e) => { if (e.key === 'Enter') doMergeColumns(); }}
                autoFocus
              />
              <span className="text-xs text-slate-400">列为一组</span>
            </div>
            <div className="prefix-modal-actions">
              <button onClick={() => setShowMergeModal(false)} className="prefix-modal-btn-cancel">取消</button>
              <button onClick={doMergeColumns} className="prefix-modal-btn-confirm">确定合并</button>
            </div>
          </div>
        </div>
      )}

      {/* 合并单元格弹窗 */}
      {showMergeCellModal && (
        <div className="prefix-modal-overlay" onClick={() => setShowMergeCellModal(false)}>
          <div className="prefix-modal-content" onClick={(e) => e.stopPropagation()}>
            <h3 className="prefix-modal-title">合并单元格</h3>
            <p className="prefix-modal-desc">
              将选区每列数据生成 Google Sheets 合并单元格格式。
              <br />• 每个值跨 <b>N</b> 列（合并单元格效果）
              <br />• 结果写入选区右侧，同时自动复制到剪贴板
              <br />• 粘贴到 Google Sheets 时会显示为真正的合并单元格
              <br />
              <br />选区共 <b>{selection ? Math.abs(selection.end.col - selection.start.col) + 1 : 0}</b> 列 × <b>{selection ? Math.abs(selection.end.row - selection.start.row) + 1 : 0}</b> 行，
              合并后总宽 = <b>{selection ? (Math.abs(selection.end.col - selection.start.col) + 1) * Math.max(1, mergeCellSpan) : 0}</b> 列
            </p>
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px' }}>
              <span className="text-sm text-slate-600">每值跨列数：</span>
              <input
                type="number"
                min={1}
                max={50}
                value={mergeCellSpan}
                onChange={(e) => setMergeCellSpan(Math.max(1, parseInt(e.target.value) || 1))}
                className="prefix-modal-input"
                style={{ width: '80px', textAlign: 'center' }}
                onKeyDown={(e) => { if (e.key === 'Enter') doMergeCellGenerate(); }}
                autoFocus
              />
              <span className="text-xs text-slate-400">列</span>
            </div>
            <div className="prefix-modal-actions">
              <button onClick={() => setShowMergeCellModal(false)} className="prefix-modal-btn-cancel">取消</button>
              <button onClick={doMergeCellGenerate} className="prefix-modal-btn-confirm">确定生成</button>
            </div>
          </div>
        </div>
      )}

      {/* 信仰词汇大写保护弹窗 */}
      {showDeityModal && (
        <div className="prefix-modal-overlay" onClick={() => setShowDeityModal(false)}>
          <div className="prefix-modal-content" onClick={(e) => e.stopPropagation()} style={{ maxWidth: '520px' }}>
            <h3 className="prefix-modal-title">✝️ 文案检查修正</h3>
            <p className="prefix-modal-desc">
              采用纯 AI 语义理解检查并修正选区内信仰词汇的大写、拼写与代词指代，并在右侧生成修正结果与反馈报告。
              <br />点击词汇可删除，输入框回车可添加（支持逗号分隔批量添加）。
            </p>
            <div style={{
              display: 'flex', flexWrap: 'wrap', gap: '6px',
              padding: '10px', background: '#f8fafc',
              border: '1px solid #e2e8f0', borderRadius: '8px',
              maxHeight: '200px', overflowY: 'auto',
              marginBottom: '10px'
            }}>
              {deityTerms.map(term => (
                <div key={term} style={{
                  display: 'flex', alignItems: 'center', gap: '4px',
                  padding: '3px 10px', background: '#e0f2fe',
                  border: '1px solid #7dd3fc', borderRadius: '14px',
                  fontSize: '12px', color: '#0c4a6e', cursor: 'pointer'
                }}
                  onClick={() => handleRemoveDeityTerm(term)}
                  title="点击删除"
                >
                  <span>{term}</span>
                  <span style={{ color: '#ef4444', fontWeight: 'bold', marginLeft: '2px' }}>×</span>
                </div>
              ))}
            </div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
              <input
                type="text"
                value={deityNewTerm}
                onChange={(e) => setDeityNewTerm(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') handleAddDeityTerm(); }}
                placeholder="输入新词汇（支持逗号分隔批量添加）..."
                className="prefix-modal-input"
                style={{ flex: 1 }}
                autoFocus
              />
              <button onClick={handleAddDeityTerm} className="prefix-modal-btn-confirm" style={{ padding: '6px 12px' }}>添加</button>
            </div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                <button
                  onClick={handleResetDeityTerms}
                  style={{ background: 'none', border: 'none', color: '#94a3b8', fontSize: '11px', cursor: 'pointer' }}
                >
                  ↺ 恢复默认词汇
                </button>
                <span style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '11px', color: '#a78bfa' }} title="代词与名词将交由 AI 语义分析进行大写和纠错，已取消本地正则匹配以防误杀">
                  🤖 纯 AI 智能检测已启用 (无本地正则误判)
                </span>
              </div>
              <div className="prefix-modal-actions">
                <button onClick={() => setShowDeityModal(false)} className="prefix-modal-btn-cancel">取消</button>
                <button onClick={doDeityCapitalizationCheck} className="prefix-modal-btn-confirm" disabled={spellChecking}>
                  {spellChecking ? '检查中...' : '执行检查'}
                </button>
              </div>
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
      tooltip-bottom inline-flex items-center gap-1 px-2 py-1 transition-colors text-xs font-semibold whitespace-nowrap leading-none
      border rounded-md
      ${disabled
        ? 'cursor-not-allowed text-slate-500 border-slate-700 bg-slate-800/90'
        : 'text-slate-200 border-slate-700 bg-slate-900/80 hover:bg-emerald-900/25 hover:text-emerald-200 hover:border-emerald-500/60 hover:shadow-[0_0_0_1px_rgba(16,185,129,0.18)]'
      }
    `}
  >
    {icon}
    <span>{label}</span>
  </button>
);

export default ScriptToolApp;
