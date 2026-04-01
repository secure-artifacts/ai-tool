/**
 * AI 画面思路扩展器 - Scene Brainstorm Tool
 * 
 * 列级式 AI 场景扩展工具：
 * - 第0列：用户手动输入的种子画面（可批量添加）
 * - 后续列：每列有独立的自定义扩展指令
 * - 可勾选多条，AI 基于勾选内容扩展下一列
 * - 支持无限列扩展
 * - 收藏、复制、导出功能
 */
import React, { useState, useRef, useCallback } from 'react';
import './SceneBrainstormApp.css';

// ========== Types ==========

interface SceneItem {
  id: string;
  text: string;
  checked: boolean;
  category?: string; // 自动分类标签
}

interface ExpansionColumn {
  id: string;
  title: string;
  prompt: string;
  items: SceneItem[];
  isGenerating: boolean;
  isManual?: boolean;
  colGenCount?: number; // 每列独立的生成数量，不填则用全局
}

const DEFAULT_CATEGORIES = ['室内', '室外', '农场', '城市', '农村', '广场'];
const CATEGORY_STORAGE_KEY = 'scene_brainstorm_categories';
const CLASSIFY_TOGGLE_KEY = 'scene_brainstorm_auto_classify';

// ========== Preset System ==========
const PRESETS_STORAGE_KEY = 'scene_brainstorm_presets';

interface PromptPreset {
  id: string;
  name: string;
  prompt: string;
}

const BUILT_IN_PRESETS: PromptPreset[] = [
  { id: 'builtin_1', name: '默认扩展', prompt: '基于选中的画面描述，扩展生成不同的变体。保持核心元素，但从不同角度（光线、时间、情绪、构图、季节、天气等）进行变化，每个变体都要合理、有细节、有画面感。' },
  { id: 'builtin_2', name: '角度变化', prompt: '基于选中画面，从不同拍摄角度生成变体：俯拍、仰拍、特写、远景、广角、微距、时间推移等。每个变体明确指出角度并结合场景特点。' },
  { id: 'builtin_3', name: '情绪氛围', prompt: '基于选中画面，从不同情绪氛围生成变体：平静温马、紧张悬疑、快乐可爱、古典优雅、未来科幻、奇幻梦境等。每个变体的色调、光影、右面细节都要匹配情绪。' },
  { id: 'builtin_4', name: '季节天气', prompt: '基于选中画面，生成不同季节和天气条件下的变体：春花、夏日、秋叶、冬雪、雨天、雾气、暴风雨、彩虹、月光等。每个变体都应显示季节感。' },
  { id: 'builtin_5', name: '只输出提示词', prompt: '基于选中画面，转化为 AI 图片生成提示词格式。每条用英文输出，包含：场景描述、主体、光照、风格、相机参数。例如："A golden retriever sitting in sunlit meadow, soft bokeh background, warm afternoon light, Fujifilm, 85mm lens"' },
];

interface SceneBrainstormProps {
  getAiInstance: () => any;
  textModel?: string;
}

// ========== Constants ==========

const COLUMN_COLORS = [
  '#f59e0b', // 橙 (第0列 - 手动)
  '#4dabff', // 蓝
  '#34d399', // 绿
  '#a78bfa', // 紫
  '#f472b6', // 粉
  '#22d3ee', // 青
  '#fb923c', // 深橙
  '#818cf8', // 靛蓝
];

const DEFAULT_EXPAND_PROMPT = '基于选中的画面描述，扩展生成不同的变体。保持核心元素，但从不同角度（光线、时间、情绪、构图、季节、天气等）进行变化，每个变体都要合理、有细节、有画面感。';

// ========== Helper ==========

let idCounter = 0;
const genId = () => `sb_${Date.now()}_${idCounter++}`;

/**
 * Parse TSV/CSV from Google Sheets clipboard.
 * Google Sheets uses tab (\t) to separate cells.
 * Cells containing newlines or tabs are wrapped in double quotes.
 * Double quotes within cells are escaped as "".
 * Returns an array of cell values (flattened from all rows/columns).
 */
function parseTSV(raw: string): string[] {
  const cells: string[] = [];
  let i = 0;
  const len = raw.length;

  while (i < len) {
    // Skip leading whitespace that's not a newline or tab
    // (but keep meaningful whitespace inside cells)
    
    if (raw[i] === '"') {
      // Quoted field - can contain newlines, tabs, and escaped quotes
      i++; // skip opening quote
      let cell = '';
      while (i < len) {
        if (raw[i] === '"') {
          if (i + 1 < len && raw[i + 1] === '"') {
            // Escaped quote
            cell += '"';
            i += 2;
          } else {
            // End of quoted field
            i++; // skip closing quote
            break;
          }
        } else {
          cell += raw[i];
          i++;
        }
      }
      cells.push(cell.trim());
      // Skip separator (tab or newline) after the field
      if (i < len && (raw[i] === '\t' || raw[i] === '\n' || raw[i] === '\r')) {
        if (raw[i] === '\r' && i + 1 < len && raw[i + 1] === '\n') i++;
        i++;
      }
    } else {
      // Unquoted field - ends at tab or newline
      let cell = '';
      while (i < len && raw[i] !== '\t' && raw[i] !== '\n' && raw[i] !== '\r') {
        cell += raw[i];
        i++;
      }
      cells.push(cell.trim());
      // Skip separator
      if (i < len && (raw[i] === '\t' || raw[i] === '\n' || raw[i] === '\r')) {
        if (raw[i] === '\r' && i + 1 < len && raw[i + 1] === '\n') i++;
        i++;
      }
    }
  }

  return cells.filter(c => c.length > 0);
}

/**
 * Detect if text is from Google Sheets (contains tabs = multiple cells)
 */
function isGoogleSheetsPaste(text: string): boolean {
  return text.includes('\t');
}

// ========== Component ==========

const SceneBrainstormApp: React.FC<SceneBrainstormProps> = ({ getAiInstance, textModel }) => {
  // Column 0 manual input text
  const [manualInput, setManualInput] = useState('');
  const [col0Tab, setCol0Tab] = useState<'manual' | 'ai' | 'image'>('manual');

  // Image expansion state
  const [imageFiles, setImageFiles] = useState<{ file: File; preview: string; id: string }[]>([]);
  const [imagePrompt, setImagePrompt] = useState('基于这张图片，描述画面中的场景细节，并联想出更多类似风格但不同元素的画面');
  const [isImageExpanding, setIsImageExpanding] = useState(false);
  const imageInputRef = useRef<HTMLInputElement>(null);
  
  const [columns, setColumns] = useState<ExpansionColumn[]>([
    {
      id: genId(),
      title: '第0层：我的画面',
      prompt: '',
      items: [],
      isGenerating: false,
      isManual: true,
    },
    {
      id: genId(),
      title: '第1层：扩展',
      prompt: DEFAULT_EXPAND_PROMPT,
      items: [],
      isGenerating: false,
    },
  ]);

  const [isExpandingAll, setIsExpandingAll] = useState(false);

  const [starred, setStarred] = useState<Set<string>>(new Set());
  const [notification, setNotification] = useState<string | null>(null);
  const [genCount, setGenCount] = useState(10);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const notificationTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-classify state
  const [autoClassify, setAutoClassify] = useState(() => {
    try { return localStorage.getItem(CLASSIFY_TOGGLE_KEY) === 'true'; } catch { return false; }
  });
  const [classifyCategories, setClassifyCategories] = useState<string[]>(() => {
    try {
      const stored = localStorage.getItem(CATEGORY_STORAGE_KEY);
      return stored ? JSON.parse(stored) : DEFAULT_CATEGORIES;
    } catch { return DEFAULT_CATEGORIES; }
  });
  const [showCategoryEditor, setShowCategoryEditor] = useState(false);
  const [newCategoryInput, setNewCategoryInput] = useState('');
  const [isClassifying, setIsClassifying] = useState(false);

  // ===== Preset System State =====
  const [presets, setPresets] = useState<PromptPreset[]>(() => {
    try {
      const stored = localStorage.getItem(PRESETS_STORAGE_KEY);
      return stored ? JSON.parse(stored) : [];
    } catch { return []; }
  });
  const [showPresetManager, setShowPresetManager] = useState(false);
  const [newPresetName, setNewPresetName] = useState('');
  const [newPresetPrompt, setNewPresetPrompt] = useState('');
  const presetFileInputRef = useRef<HTMLInputElement>(null);

  // Quick-save inline input state (replaces prompt() dialog)
  const [quickSaveKey, setQuickSaveKey] = useState<string | null>(null); // e.g. 'col0-ai', 'col0-image', 'col-3'
  const [quickSaveName, setQuickSaveName] = useState('');
  const quickSaveInputRef = useRef<HTMLInputElement>(null);

  // All presets = built-in + user
  const allPresets = [...BUILT_IN_PRESETS, ...presets];

  const persistPresets = useCallback((updated: PromptPreset[]) => {
    setPresets(updated);
    try { localStorage.setItem(PRESETS_STORAGE_KEY, JSON.stringify(updated)); } catch {}
  }, []);

  const deletePreset = useCallback((presetId: string) => {
    persistPresets(presets.filter(p => p.id !== presetId));
  }, [presets, persistPresets]);

  // Persist classify settings
  const toggleAutoClassify = useCallback((val: boolean) => {
    setAutoClassify(val);
    try { localStorage.setItem(CLASSIFY_TOGGLE_KEY, String(val)); } catch {}
  }, []);

  const updateCategories = useCallback((cats: string[]) => {
    setClassifyCategories(cats);
    try { localStorage.setItem(CATEGORY_STORAGE_KEY, JSON.stringify(cats)); } catch {}
  }, []);

  const addCategory = useCallback(() => {
    const name = newCategoryInput.trim();
    if (!name || classifyCategories.includes(name)) return;
    updateCategories([...classifyCategories, name]);
    setNewCategoryInput('');
  }, [newCategoryInput, classifyCategories, updateCategories]);

  const removeCategory = useCallback((cat: string) => {
    updateCategories(classifyCategories.filter(c => c !== cat));
  }, [classifyCategories, updateCategories]);

  // Show notification
  const showNotification = useCallback((msg: string) => {
    setNotification(msg);
    if (notificationTimerRef.current) clearTimeout(notificationTimerRef.current);
    notificationTimerRef.current = setTimeout(() => setNotification(null), 3000);
  }, []);

  // ===== Preset CRUD (requires showNotification) =====
  const savePreset = useCallback((name: string, prompt: string) => {
    if (!name.trim() || !prompt.trim()) return;
    const np: PromptPreset = { id: genId(), name: name.trim(), prompt: prompt.trim() };
    persistPresets([...presets, np]);
    showNotification(`✅ 已保存预设「${np.name}」`);
  }, [presets, persistPresets, showNotification]);

  const exportPresets = useCallback(() => {
    const data = JSON.stringify(allPresets.filter(p => !p.id.startsWith('builtin_')), null, 2);
    const blob = new Blob([data], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `画面扩展预设_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification(`✅ 已导出 ${presets.length} 个自定义预设`);
  }, [allPresets, presets, showNotification]);

  const importPresets = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported: PromptPreset[] = JSON.parse(reader.result as string);
        if (!Array.isArray(imported)) throw new Error('Invalid format');
        const validItems = imported.filter(p => p.name && p.prompt).map(p => ({
          ...p, id: p.id?.startsWith('builtin_') ? genId() : (p.id || genId()),
        }));
        persistPresets([...presets, ...validItems]);
        showNotification(`✅ 已导入 ${validItems.length} 个预设`);
      } catch {
        showNotification('❌ 预设文件格式无效');
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  }, [presets, persistPresets, showNotification]);


  // Scroll to right
  const scrollToRight = useCallback(() => {
    setTimeout(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTo({
          left: scrollContainerRef.current.scrollWidth,
          behavior: 'smooth',
        });
      }
    }, 100);
  }, []);

  // Parse input text into items (handles both plain text and Google Sheets TSV)
  const parseInputToItems = useCallback((text: string): SceneItem[] => {
    let entries: string[];

    if (isGoogleSheetsPaste(text)) {
      // Google Sheets paste - parse as TSV
      entries = parseTSV(text);
    } else {
      // Plain text - split by newlines
      entries = text
        .split('\n')
        .map(l => l.replace(/^\d+[\.\)、：:]\s*/, '').replace(/^[-•*]\s*/, '').trim())
        .filter(l => l.length > 1);
    }

    return entries
      .filter(t => t.length > 1)
      .map(t => ({
        id: genId(),
        text: t,
        checked: true,
      }));
  }, []);

  // Handle paste event on the textarea - auto-add items directly
  const handleManualPaste = useCallback((e: React.ClipboardEvent<HTMLTextAreaElement>) => {
    const pastedText = e.clipboardData.getData('text/plain');
    if (!pastedText || !pastedText.trim()) return;

    e.preventDefault(); // Always prevent default - we handle it ourselves

    const newItems = parseInputToItems(pastedText);
    if (newItems.length === 0) {
      showNotification('⚠️ 未识别到有效内容');
      return;
    }

    setColumns(prev => prev.map((c, i) =>
      i === 0 ? { ...c, items: [...c.items, ...newItems] } : c
    ));

    const source = isGoogleSheetsPaste(pastedText) ? '表格' : '文本';
    showNotification(`✅ 已从${source}粘贴添加 ${newItems.length} 条画面`);
  }, [parseInputToItems, showNotification]);

  // Add manual items from textarea (Column 0)
  const addManualItems = useCallback(() => {
    const newItems = parseInputToItems(manualInput);

    if (newItems.length === 0) {
      showNotification('⚠️ 请输入至少一条画面描述');
      return;
    }

    setColumns(prev => prev.map((c, i) =>
      i === 0 ? { ...c, items: [...c.items, ...newItems] } : c
    ));

    setManualInput('');
    showNotification(`✅ 已添加 ${newItems.length} 条画面`);
  }, [manualInput, parseInputToItems, showNotification]);

  // ===== Image handling =====
  const handleImageUpload = useCallback((files: FileList | null) => {
    if (!files) return;
    const newImages = Array.from(files)
      .filter(f => f.type.startsWith('image/'))
      .map(f => ({
        file: f,
        preview: URL.createObjectURL(f),
        id: genId(),
      }));
    if (newImages.length === 0) {
      showNotification('⚠️ 请选择有效的图片文件');
      return;
    }
    setImageFiles(prev => [...prev, ...newImages]);
    showNotification(`✅ 已添加 ${newImages.length} 张图片`);
  }, [showNotification]);

  const removeImage = useCallback((imgId: string) => {
    setImageFiles(prev => {
      const removed = prev.find(i => i.id === imgId);
      if (removed) URL.revokeObjectURL(removed.preview);
      return prev.filter(i => i.id !== imgId);
    });
  }, []);

  // Convert File to base64 (strip prefix)
  const fileToBase64 = useCallback(async (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        // Strip data:image/xxx;base64, prefix
        const base64 = result.split(',')[1] || result;
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }, []);

  // Single AI call helper
  const callAiOnce = useCallback(async (ai: any, model: string, systemPrompt: string, userPrompt: string, batchSize: number): Promise<string[]> => {
    const response = await ai.models.generateContent({
      model,
      contents: userPrompt,
      config: {
        systemInstruction: systemPrompt,
        temperature: 1.0,
        maxOutputTokens: Math.min(65536, batchSize * 120),
      },
    });

    const text = typeof response?.text === 'string' ? response.text
      : (response?.candidates?.[0]?.content?.parts?.[0]?.text || '');

    return text
      .split('\n')
      .map((l: string) => l.replace(/^\d+[\.\)、：:]\s*/, '').replace(/^[-•*]\s*/, '').trim())
      .filter((l: string) => l.length > 5);
  }, []);

  // Generate items for a column using AI (with batch support for large counts)
  const generateForColumn = useCallback(async (colIndex: number) => {
    const col = columns[colIndex];
    const isFirstCol = colIndex === 0;

    let checkedItems: SceneItem[] = [];
    if (!isFirstCol) {
      const prevCol = columns[colIndex - 1];
      checkedItems = prevCol.items.filter(i => i.checked);
      if (checkedItems.length === 0) {
        showNotification('⚠️ 请先在上一列勾选至少一条画面');
        return;
      }
    } else {
      if (!col.prompt.trim()) {
        showNotification('⚠️ 请输入主题或要求');
        return;
      }
    }

    setColumns(prev => prev.map((c, i) =>
      i === colIndex ? { ...c, isGenerating: true } : c
    ));

    try {
      const ai = getAiInstance();
      const model = textModel || 'gemini-2.5-flash';
      const perItemCount = col.colGenCount || genCount; // 每条扩展数量
      const totalTarget = isFirstCol ? perItemCount : perItemCount * checkedItems.length;
      const BATCH_SIZE = 80;
      const batches = Math.ceil(totalTarget / BATCH_SIZE);
      let allLines: string[] = [];

      for (let b = 0; b < batches; b++) {
        const batchCount = b === batches - 1 ? totalTarget - b * BATCH_SIZE : BATCH_SIZE;
        if (batchCount <= 0) break;

        const systemPrompt = `你是一个专业的视觉创意总监，善于构思丰富的画面场景。

输出规则：
1. 每条画面独占一行
2. 不要加编号、不要加标题、不要加任何前缀符号
3. 每条画面描述控制在1-3句话，要具体、有画面感、要合理
4. 总共生成约${batchCount}条不同的画面
5. 直接输出画面描述，不要有多余的说明文字
6. 不要重复已有画面，要有创造性的变化`;

        let userPrompt: string;
        const existingContext = allLines.length > 0 ? `\n\n注意：以下画面已经生成过，请不要重复：\n${allLines.slice(-20).join('\n')}` : '';

        if (isFirstCol) {
          userPrompt = `主题/要求：${col.prompt}${existingContext}\n\n请围绕以上主题，生成约${batchCount}条丰富多样的画面场景描述。直接输出：`;
        } else {
          const checkedTexts = checkedItems.map((item, idx) => `${idx + 1}. ${item.text}`).join('\n');
          const batchPerItem = Math.max(2, Math.ceil(batchCount / checkedItems.length));
          userPrompt = `以下是${checkedItems.length}条已有画面：\n${checkedTexts}\n\n扩展要求：${col.prompt}${existingContext}\n\n请基于每条画面各扩展约${batchPerItem}个不同变体，总计约${batchCount}条。直接输出：`;
        }

        const lines = await callAiOnce(ai, model, systemPrompt, userPrompt, batchCount);
        allLines = allLines.concat(lines);

        if (batches > 1) {
          showNotification(`⏳ 批次 ${b + 1}/${batches} 完成，已生成 ${allLines.length} 条...`);
        }
      }

      if (allLines.length === 0) {
        showNotification('❌ AI 未返回有效内容，请重试');
        setColumns(prev => prev.map((c, i) =>
          i === colIndex ? { ...c, isGenerating: false } : c
        ));
        return;
      }

      const newItems: SceneItem[] = allLines.map((line: string) => ({
        id: genId(),
        text: line,
        checked: false,
      }));

      setColumns(prev => prev.map((c, i) =>
        i === colIndex
          ? { ...c, items: isFirstCol ? [...c.items, ...newItems] : newItems, isGenerating: false }
          : c
      ));

      showNotification(`✅ 已生成 ${newItems.length} 条画面思路`);

      // Auto-classify if enabled
      if (autoClassify && classifyCategories.length > 0 && newItems.length > 0) {
        classifyItems(colIndex, newItems);
      }
    } catch (error: any) {
      console.error('[SceneBrainstorm] Generation error:', error);
      showNotification(`❌ 生成失败: ${error.message || '未知错误'}`);
      setColumns(prev => prev.map((c, i) =>
        i === colIndex ? { ...c, isGenerating: false } : c
      ));
    }
  }, [columns, getAiInstance, textModel, genCount, showNotification, callAiOnce, autoClassify, classifyCategories]);

  // Classify items using AI
  const classifyItems = useCallback(async (colIndex: number, items: SceneItem[]) => {
    if (items.length === 0 || classifyCategories.length === 0) return;
    setIsClassifying(true);
    try {
      const ai = getAiInstance();
      const model = textModel || 'gemini-2.5-flash';
      const BATCH = 60;
      const batches = [];
      for (let i = 0; i < items.length; i += BATCH) {
        batches.push(items.slice(i, i + BATCH));
      }

      const categoryMapping: Record<string, string> = {};

      for (const batch of batches) {
        const systemPrompt = `你是场景分类专家。将每条画面归入指定类别之一。

可选类别：${classifyCategories.join('、')}

规则：
1. 每条画面只能归入一个类别
2. 如果都不合适，选最接近的
3. 严格按 JSON 格式输出，不要有任何其他文字

输出格式：
{"results":[{"id":"xxx","category":"类别名"}]}`;

        const userPrompt = batch.map(item => `[${item.id}] ${item.text}`).join('\n');

        const response = await ai.models.generateContent({
          model,
          contents: userPrompt,
          config: { systemInstruction: systemPrompt, temperature: 0.1 },
        });

        const text = typeof response?.text === 'string' ? response.text : '';
        try {
          const jsonMatch = text.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (parsed.results) {
              for (const r of parsed.results) {
                if (r.id && r.category) categoryMapping[r.id] = r.category;
              }
            }
          }
        } catch { /* ignore parse errors */ }
      }

      // Apply categories to items
      setColumns(prev => prev.map((c, i) => {
        if (i !== colIndex) return c;
        return {
          ...c,
          items: c.items.map(item => {
            const cat = categoryMapping[item.id];
            return cat ? { ...item, category: cat } : item;
          }),
        };
      }));

      const classified = Object.keys(categoryMapping).length;
      if (classified > 0) {
        showNotification(`🏷 已自动分类 ${classified} 条画面`);
      }
    } catch (err: any) {
      console.error('[SceneBrainstorm] Classify error:', err);
      // Silently fail - classification is optional
    } finally {
      setIsClassifying(false);
    }
  }, [classifyCategories, getAiInstance, textModel, showNotification]);

  // AI expand from images (placed after classifyItems to avoid forward-ref)
  const expandFromImages = useCallback(async () => {
    if (imageFiles.length === 0) {
      showNotification('⚠️ 请先添加至少一张图片');
      return;
    }
    setIsImageExpanding(true);
    const perImageCount = columns[0].colGenCount || genCount;

    try {
      const ai = getAiInstance();
      const model = textModel || 'gemini-2.5-flash';
      let allNewItems: SceneItem[] = [];

      for (let idx = 0; idx < imageFiles.length; idx++) {
        showNotification(`🖼 正在分析第 ${idx + 1}/${imageFiles.length} 张图片...`);
        const imgFile = imageFiles[idx];
        const base64Data = await fileToBase64(imgFile.file);
        const mimeType = imgFile.file.type || 'image/jpeg';

        const systemPrompt = `你是一个专业的视觉创意总监，善于从图片中提取创意灵感并扩展出丰富的画面场景。

输出规则：
1. 每条画面独占一行
2. 不要加编号、不要加标题、不要加任何前缀符号
3. 每条画面描述控制在1-3句话，要具体、有画面感
4. 总共生成约${perImageCount}条不同的画面
5. 直接输出画面描述，不要有多余的说明文字`;

        const userContent = [
          { inlineData: { data: base64Data, mimeType } },
          { text: `${imagePrompt}\n\n请基于这张图片生成约${perImageCount}条画面描述。直接输出：` },
        ];

        const response = await ai.models.generateContent({
          model,
          contents: [{ role: 'user', parts: userContent }],
          config: {
            systemInstruction: systemPrompt,
            temperature: 1.0,
            maxOutputTokens: Math.min(65536, perImageCount * 120),
          },
        });

        const text = typeof response?.text === 'string' ? response.text
          : (response?.candidates?.[0]?.content?.parts?.[0]?.text || '');

        const lines = text
          .split('\n')
          .map((l: string) => l.replace(/^\d+[\.\)、：:]\s*/, '').replace(/^[-•*]\s*/, '').trim())
          .filter((l: string) => l.length > 5);

        const newItems: SceneItem[] = lines.map((line: string) => ({
          id: genId(),
          text: line,
          checked: true,
        }));

        allNewItems = allNewItems.concat(newItems);
      }

      if (allNewItems.length === 0) {
        showNotification('❌ 未能从图片中生成画面描述');
        setIsImageExpanding(false);
        return;
      }

      setColumns(prev => prev.map((c, i) =>
        i === 0 ? { ...c, items: [...c.items, ...allNewItems] } : c
      ));

      showNotification(`✅ 从 ${imageFiles.length} 张图片生成了 ${allNewItems.length} 条画面`);

      // Auto-classify if enabled
      if (autoClassify && classifyCategories.length > 0 && allNewItems.length > 0) {
        classifyItems(0, allNewItems);
      }
    } catch (error: any) {
      console.error('[SceneBrainstorm] Image expansion error:', error);
      showNotification(`❌ 图片扩展失败: ${error.message || '未知错误'}`);
    } finally {
      setIsImageExpanding(false);
    }
  }, [imageFiles, imagePrompt, columns, genCount, getAiInstance, textModel, showNotification, fileToBase64, autoClassify, classifyCategories, classifyItems]);


  // Classify existing items in a column manually
  const classifyColumnItems = useCallback((colIndex: number) => {
    const col = columns[colIndex];
    if (!col || col.items.length === 0) return;
    classifyItems(colIndex, col.items);
  }, [columns, classifyItems]);

  // Regenerate a single item (replace with a new AI-generated one)
  const regenerateItem = useCallback(async (colIndex: number, itemId: string) => {
    const col = columns[colIndex];
    if (!col) return;
    const item = col.items.find(i => i.id === itemId);
    if (!item) return;

    // Mark item as regenerating
    setColumns(prev => prev.map((c, i) =>
      i === colIndex ? {
        ...c,
        items: c.items.map(it => it.id === itemId ? { ...it, text: '⏳ 重新生成中...' } : it)
      } : c
    ));

    try {
      const ai = getAiInstance();
      const model = textModel || 'gemini-2.5-flash';
      const otherTexts = col.items.filter(i => i.id !== itemId).slice(0, 10).map(i => i.text).join('\n');

      const prompt = `主题/要求：${col.prompt || '创意画面场景'}\n\n以下是已有的其他画面（请不要重复）：\n${otherTexts || '无'}\n\n请生成1条全新的、与上面不同的画面场景描述。直接输出一条描述，不要编号不要前缀。`;

      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        config: {
          systemInstruction: '你是一个专业的视觉创意总监，善于构思丰富的画面场景。直接输出一条画面描述，不要有任何前缀或编号。',
          temperature: 1.0,
        },
      });

      const text = (typeof response?.text === 'string' ? response.text
        : (response?.candidates?.[0]?.content?.parts?.[0]?.text || '')).trim();

      const newText = text.replace(/^\d+[\.\)、：:]\s*/, '').replace(/^[-•*]\s*/, '').trim() || '(空结果)';

      setColumns(prev => prev.map((c, i) =>
        i === colIndex ? {
          ...c,
          items: c.items.map(it => it.id === itemId ? { ...it, text: newText, category: undefined } : it)
        } : c
      ));

      showNotification('✅ 已重新生成');
    } catch (err: any) {
      setColumns(prev => prev.map((c, i) =>
        i === colIndex ? {
          ...c,
          items: c.items.map(it => it.id === itemId ? { ...it, text: item.text } : it)
        } : c
      ));
      showNotification(`❌ 重新生成失败: ${err.message || '未知错误'}`);
    }
  }, [columns, getAiInstance, textModel, showNotification]);

  // Regenerate entire column (clear and re-generate)
  const regenerateColumn = useCallback(async (colIndex: number) => {
    const col = columns[colIndex];
    if (!col || col.isGenerating) return;

    // Clear items first
    setColumns(prev => prev.map((c, i) =>
      i === colIndex ? { ...c, items: [] } : c
    ));

    // Then generate
    await generateForColumn(colIndex);
  }, [columns, generateForColumn]);

  // One-click expand all: chain generation across all non-manual columns
  const expandAll = useCallback(async () => {
    if (isExpandingAll) return;
    // Check column 0 has items
    if (columns[0].items.length === 0) {
      showNotification('⚠️ 请先在第0层添加画面');
      return;
    }
    setIsExpandingAll(true);

    try {
      // First: auto-check all items in column 0
      setColumns(prev => prev.map((c, i) =>
        i === 0 ? { ...c, items: c.items.map(item => ({ ...item, checked: true })) } : c
      ));

      // Chain: for each non-manual column, generate then auto-check all
      for (let ci = 1; ci < columns.length; ci++) {
        showNotification(`🚀 正在扩展第 ${ci} 层...`);
        await generateForColumn(ci);
        // After generating, auto-check all items in this column for next layer
        setColumns(prev => prev.map((c, i) =>
          i === ci ? { ...c, items: c.items.map(item => ({ ...item, checked: true })) } : c
        ));
        // Small delay for state to settle
        await new Promise(r => setTimeout(r, 300));
      }

      showNotification(`✅ 全部 ${columns.length - 1} 层扩展完成！`);
    } catch (err: any) {
      showNotification(`❌ 一键扩展中断: ${err.message || '未知错误'}`);
    } finally {
      setIsExpandingAll(false);
    }
  }, [columns, isExpandingAll, generateForColumn, showNotification]);

  // Toggle check on an item
  const toggleCheck = useCallback((colIndex: number, itemId: string) => {
    setColumns(prev => prev.map((c, i) =>
      i === colIndex ? {
        ...c,
        items: c.items.map(item =>
          item.id === itemId ? { ...item, checked: !item.checked } : item
        ),
      } : c
    ));
  }, []);

  // Select all / deselect all in a column
  const toggleAllChecks = useCallback((colIndex: number) => {
    setColumns(prev => prev.map((c, i) => {
      if (i !== colIndex) return c;
      const allChecked = c.items.every(item => item.checked);
      return {
        ...c,
        items: c.items.map(item => ({ ...item, checked: !allChecked })),
      };
    }));
  }, []);

  // Add column
  const addColumn = useCallback(() => {
    const newCol: ExpansionColumn = {
      id: genId(),
      title: `第${columns.length}层`,
      prompt: DEFAULT_EXPAND_PROMPT,
      items: [],
      isGenerating: false,
    };
    setColumns(prev => [...prev, newCol]);
    scrollToRight();
  }, [columns.length, scrollToRight]);

  // Update column gen count
  const updateColumnGenCount = useCallback((colIndex: number, count: number | undefined) => {
    setColumns(prev => prev.map((c, i) =>
      i === colIndex ? { ...c, colGenCount: count } : c
    ));
  }, []);

  // Remove column (can't remove column 0)
  const removeColumn = useCallback((colIndex: number) => {
    if (colIndex === 0) return;
    if (columns.length <= 2) return; // Keep at least col0 + col1
    setColumns(prev => prev.filter((_, i) => i !== colIndex));
  }, [columns.length]);

  // Update column title
  const updateColumnTitle = useCallback((colIndex: number, title: string) => {
    setColumns(prev => prev.map((c, i) =>
      i === colIndex ? { ...c, title } : c
    ));
  }, []);

  // Update column prompt
  const updateColumnPrompt = useCallback((colIndex: number, prompt: string) => {
    setColumns(prev => prev.map((c, i) =>
      i === colIndex ? { ...c, prompt } : c
    ));
  }, []);

  // Toggle star
  const toggleStar = useCallback((itemId: string) => {
    setStarred(prev => {
      const next = new Set(prev);
      if (next.has(itemId)) next.delete(itemId);
      else next.add(itemId);
      return next;
    });
  }, []);

  // Copy item text
  const copyItem = useCallback((text: string) => {
    navigator.clipboard.writeText(text).then(() => {
      showNotification('📋 已复制到剪贴板');
    });
  }, [showNotification]);

  // Escape a cell value for TSV (Google Sheets compatible)
  const escapeTsvCell = useCallback((text: string): string => {
    // If cell contains tab, newline, or double quote, wrap in quotes
    if (text.includes('\t') || text.includes('\n') || text.includes('\r') || text.includes('"')) {
      return '"' + text.replace(/"/g, '""') + '"';
    }
    return text;
  }, []);

  // Copy a single column as TSV (one item per row, pasteable into Google Sheets as a column)
  const copyColumnItems = useCallback((colIndex: number) => {
    const col = columns[colIndex];
    if (!col || col.items.length === 0) return;
    const hasCategories = col.items.some(i => i.category);
    const tsv = col.items.map(item => {
      const parts = [escapeTsvCell(item.text)];
      if (hasCategories) parts.push(escapeTsvCell(item.category || ''));
      return parts.join('\t');
    }).join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      showNotification(`📋 已复制「${col.title}」${col.items.length} 条${hasCategories ? '（含分类）' : ''}`);
    });
  }, [columns, escapeTsvCell, showNotification]);

  // Copy ALL columns as a multi-column TSV table (pasteable into Google Sheets)
  const copyAllColumnsAsTsv = useCallback(() => {
    const nonEmptyCols = columns.filter(c => c.items.length > 0);
    if (nonEmptyCols.length === 0) {
      showNotification('⚠️ 没有可复制的内容');
      return;
    }

    const maxRows = Math.max(...nonEmptyCols.map(c => c.items.length));
    const rows: string[] = [];

    // Check if any column has categories
    const colHasCats = nonEmptyCols.map(c => c.items.some(i => i.category));

    // Header row: column titles (with category columns interleaved)
    const headerCells: string[] = [];
    nonEmptyCols.forEach((c, idx) => {
      headerCells.push(escapeTsvCell(c.title));
      if (colHasCats[idx]) headerCells.push(escapeTsvCell(c.title + '-分类'));
    });
    rows.push(headerCells.join('\t'));

    // Data rows
    for (let r = 0; r < maxRows; r++) {
      const cells: string[] = [];
      nonEmptyCols.forEach((c, idx) => {
        const item = c.items[r];
        cells.push(item ? escapeTsvCell(item.text) : '');
        if (colHasCats[idx]) cells.push(item?.category ? escapeTsvCell(item.category) : '');
      });
      rows.push(cells.join('\t'));
    }

    const tsv = rows.join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      showNotification(`📋 已复制全部 ${nonEmptyCols.length} 列（可直接贴入表格）`);
    });
  }, [columns, escapeTsvCell, showNotification]);

  // Delete a single item
  const deleteItem = useCallback((colIndex: number, itemId: string) => {
    setColumns(prev => prev.map((c, i) =>
      i === colIndex ? { ...c, items: c.items.filter(item => item.id !== itemId) } : c
    ));
  }, []);

  // Copy all checked items as TSV
  const copyChecked = useCallback(() => {
    const allChecked = columns.flatMap(c => c.items.filter(i => i.checked));
    if (allChecked.length === 0) {
      showNotification('⚠️ 没有勾选的画面');
      return;
    }
    const tsv = allChecked.map(item => escapeTsvCell(item.text)).join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      showNotification(`📋 已复制 ${allChecked.length} 条勾选画面（可贴入表格）`);
    });
  }, [columns, escapeTsvCell, showNotification]);

  // Export all items as TXT file
  const exportAll = useCallback(() => {
    const lines: string[] = [];
    columns.forEach((col) => {
      if (col.items.length === 0) return;
      lines.push(`\n=== ${col.title} ===`);
      if (col.prompt) lines.push(`扩展要求: ${col.prompt}`);
      lines.push('');
      col.items.forEach((item, idx) => {
        const starMark = starred.has(item.id) ? ' ⭐' : '';
        lines.push(`${idx + 1}. ${item.text}${starMark}`);
      });
    });

    const content = `AI 画面思路扩展器 - 导出\n生成时间: ${new Date().toLocaleString()}\n${lines.join('\n')}`;
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `画面思路_${new Date().toISOString().slice(0, 10)}.txt`;
    a.click();
    URL.revokeObjectURL(url);
    showNotification('📥 导出成功');
  }, [columns, starred, showNotification]);

  // Copy starred as TSV
  const exportStarred = useCallback(() => {
    const allItems = columns.flatMap(c => c.items);
    const starredItems = allItems.filter(i => starred.has(i.id));
    if (starredItems.length === 0) {
      showNotification('⚠️ 没有收藏的画面');
      return;
    }
    const tsv = starredItems.map(item => escapeTsvCell(item.text)).join('\n');
    navigator.clipboard.writeText(tsv).then(() => {
      showNotification(`📋 已复制 ${starredItems.length} 条收藏（可贴入表格）`);
    });
  }, [columns, starred, escapeTsvCell, showNotification]);

  // Count totals
  const totalItems = columns.reduce((sum, c) => sum + c.items.length, 0);
  const totalStarred = columns.flatMap(c => c.items).filter(i => starred.has(i.id)).length;
  const totalChecked = columns.flatMap(c => c.items).filter(i => i.checked).length;

  return (
    <div className="scene-brainstorm">
      {/* Header */}
      <div className="sb-header">
        <div className="sb-header-left">
          <h2 className="sb-title">
            <span className="sb-title-icon">🎨</span>
            AI 画面思路扩展器
          </h2>
          <span className="sb-subtitle">填入画面 → 逐层AI扩展 → 无限画面思路</span>
        </div>
        <div className="sb-header-right">
          <button
            className={`sb-expand-all-btn ${isExpandingAll ? 'running' : ''}`}
            onClick={expandAll}
            disabled={isExpandingAll || columns[0].items.length === 0}
          >
            {isExpandingAll ? '⏳ 扩展中...' : '🚀 一键扩展全部层'}
          </button>
          <label className="sb-gen-count">
            每条扩展
            <select
              className="sb-gen-count-select"
              value={[3,5,10,20,50].includes(genCount) ? genCount : ''}
              onChange={e => { if (e.target.value) setGenCount(Number(e.target.value)); }}
            >
              <option value="" disabled>快选</option>
              <option value={3}>3</option>
              <option value={5}>5</option>
              <option value={10}>10</option>
              <option value={20}>20</option>
              <option value={50}>50</option>
            </select>
            <input
              type="number"
              min={1}
              max={999}
              value={genCount}
              onChange={e => {
                const v = parseInt(e.target.value) || 5;
                setGenCount(Math.max(1, Math.min(999, v)));
              }}
              className="sb-gen-count-input"
            />
            条
          </label>
          {/* Preset Manager Toggle */}
          <button
            onClick={() => setShowPresetManager(!showPresetManager)}
            style={{
              padding: '3px 10px', borderRadius: '5px', fontSize: '11px',
              border: `1px solid ${showPresetManager ? 'rgba(96,165,250,0.4)' : 'rgba(255,255,255,0.12)'}`,
              background: showPresetManager ? 'rgba(96,165,250,0.12)' : 'transparent',
              color: showPresetManager ? '#60a5fa' : 'var(--text-muted, #888)',
              cursor: 'pointer', whiteSpace: 'nowrap',
            }}
            title="管理指令预设（保存、导入、导出）"
          >📝 预设 ({allPresets.length})</button>
          {/* Auto-classify toggle */}
          <div className="sb-classify-toggle" style={{ position: 'relative' }}>
            <label
              className="sb-classify-switch"
              title="生成后自动分类画面场景"
              style={{
                display: 'flex', alignItems: 'center', gap: '4px', cursor: 'pointer',
                fontSize: '11px', color: autoClassify ? '#34d399' : 'var(--text-muted, #888)',
                padding: '2px 6px', borderRadius: '4px',
                background: autoClassify ? 'rgba(52,211,153,0.1)' : 'transparent',
                border: `1px solid ${autoClassify ? 'rgba(52,211,153,0.3)' : 'transparent'}`,
                userSelect: 'none', whiteSpace: 'nowrap',
              }}
            >
              <span
                onClick={() => toggleAutoClassify(!autoClassify)}
                style={{
                  display: 'inline-block', width: '28px', height: '14px', borderRadius: '7px',
                  background: autoClassify ? '#34d399' : 'rgba(255,255,255,0.15)',
                  position: 'relative', transition: 'background 0.2s', cursor: 'pointer', flexShrink: 0,
                }}
              >
                <span style={{
                  display: 'block', width: '10px', height: '10px', borderRadius: '50%',
                  background: '#fff', position: 'absolute', top: '2px',
                  left: autoClassify ? '16px' : '2px', transition: 'left 0.2s',
                  boxShadow: '0 1px 3px rgba(0,0,0,0.3)',
                }} />
              </span>
              <span onClick={() => toggleAutoClassify(!autoClassify)}>分类</span>
              <span
                onClick={() => setShowCategoryEditor(!showCategoryEditor)}
                style={{
                  cursor: 'pointer', fontSize: '9px', opacity: 0.7,
                  marginLeft: '2px', color: 'var(--text-muted, #888)',
                }}
                title="编辑分类列表"
              >
                ⚙
              </span>
            </label>
            {isClassifying && (
              <span style={{ fontSize: '9px', color: '#34d399', marginLeft: '4px' }}>分类中...</span>
            )}
            {/* Category Editor Dropdown */}
            {showCategoryEditor && (
              <div
                style={{
                  position: 'absolute', top: '100%', right: 0, marginTop: '4px',
                  background: 'var(--card-bg-color, #1e293b)', border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
                  borderRadius: '8px', boxShadow: '0 8px 24px rgba(0,0,0,0.4)', zIndex: 200,
                  minWidth: '180px', padding: '8px', fontSize: '11px',
                }}
              >
                <div style={{ fontWeight: 600, color: 'var(--text-color, #e2e8f0)', marginBottom: '6px', fontSize: '12px' }}>
                  🏷 场景分类
                </div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '6px' }}>
                  {classifyCategories.map(cat => (
                    <span
                      key={cat}
                      style={{
                        display: 'inline-flex', alignItems: 'center', gap: '3px',
                        padding: '2px 8px', borderRadius: '10px', fontSize: '11px',
                        background: 'rgba(52,211,153,0.12)', color: '#34d399',
                        border: '1px solid rgba(52,211,153,0.25)',
                      }}
                    >
                      {cat}
                      <span
                        onClick={() => removeCategory(cat)}
                        style={{ cursor: 'pointer', fontSize: '13px', lineHeight: 1, opacity: 0.7 }}
                        title={`删除「${cat}」`}
                      >×</span>
                    </span>
                  ))}
                </div>
                <div style={{ display: 'flex', gap: '4px' }}>
                  <input
                    type="text"
                    placeholder="新类别名"
                    value={newCategoryInput}
                    onChange={e => setNewCategoryInput(e.target.value)}
                    onKeyDown={e => { if (e.key === 'Enter') addCategory(); }}
                    style={{
                      flex: 1, padding: '3px 6px', borderRadius: '4px', fontSize: '11px',
                      border: '1px solid var(--border-color, #333)', background: 'var(--bg-primary, #111)',
                      color: 'var(--text-color, #e2e8f0)', outline: 'none', minWidth: 0,
                    }}
                  />
                  <button
                    onClick={addCategory}
                    disabled={!newCategoryInput.trim()}
                    style={{
                      padding: '3px 8px', borderRadius: '4px', fontSize: '10px',
                      border: 'none', background: 'rgba(52,211,153,0.2)', color: '#34d399',
                      cursor: 'pointer', opacity: newCategoryInput.trim() ? 1 : 0.4,
                    }}
                  >
                    + 添加
                  </button>
                </div>
                <button
                  onClick={() => updateCategories(DEFAULT_CATEGORIES)}
                  style={{
                    marginTop: '6px', width: '100%', padding: '3px', borderRadius: '4px',
                    fontSize: '10px', border: '1px dashed var(--border-color, #444)',
                    background: 'transparent', color: 'var(--text-muted, #888)', cursor: 'pointer',
                  }}
                >
                  恢复默认
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Preset Manager Panel */}
      {showPresetManager && (
        <div style={{
          background: 'var(--card-bg-color, #1e293b)', border: '1px solid var(--border-color, rgba(255,255,255,0.12))',
          borderRadius: '10px', margin: '0 12px 8px', padding: '12px 14px',
          boxShadow: '0 4px 16px rgba(0,0,0,0.3)', fontSize: '12px',
        }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--text-color, #e2e8f0)' }}>📝 指令预设管理</span>
            <div style={{ display: 'flex', gap: '6px' }}>
              <button onClick={exportPresets} style={{
                padding: '3px 10px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.15)',
                background: 'transparent', color: '#60a5fa', cursor: 'pointer', fontSize: '11px',
              }}>📤 导出</button>
              <button onClick={() => presetFileInputRef.current?.click()} style={{
                padding: '3px 10px', borderRadius: '5px', border: '1px solid rgba(255,255,255,0.15)',
                background: 'transparent', color: '#34d399', cursor: 'pointer', fontSize: '11px',
              }}>📥 导入</button>
              <input ref={presetFileInputRef} type="file" accept=".json" style={{ display: 'none' }} onChange={importPresets} />
              <button onClick={() => setShowPresetManager(false)} style={{
                padding: '3px 10px', borderRadius: '5px', border: 'none',
                background: 'rgba(255,255,255,0.08)', color: 'var(--text-muted, #888)', cursor: 'pointer', fontSize: '11px',
              }}>关闭</button>
            </div>
          </div>
          {/* Built-in presets */}
          <div style={{ marginBottom: '8px', color: 'var(--text-muted, #888)', fontSize: '10px', fontWeight: 600 }}>内置预设</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '10px' }}>
            {BUILT_IN_PRESETS.map(p => (
              <span key={p.id} title={p.prompt} style={{
                padding: '3px 10px', borderRadius: '12px', fontSize: '11px',
                background: 'rgba(96,165,250,0.1)', color: '#60a5fa',
                border: '1px solid rgba(96,165,250,0.2)', cursor: 'default',
              }}>{p.name}</span>
            ))}
          </div>
          {/* User presets */}
          <div style={{ marginBottom: '6px', color: 'var(--text-muted, #888)', fontSize: '10px', fontWeight: 600 }}>自定义预设 ({presets.length})</div>
          {presets.length === 0 ? (
            <div style={{ color: 'var(--text-muted, #666)', fontSize: '11px', padding: '4px 0' }}>暂无自定义预设，在下方添加</div>
          ) : (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px', marginBottom: '8px' }}>
              {presets.map(p => (
                <span key={p.id} title={p.prompt} style={{
                  display: 'inline-flex', alignItems: 'center', gap: '4px',
                  padding: '3px 10px', borderRadius: '12px', fontSize: '11px',
                  background: 'rgba(52,211,153,0.1)', color: '#34d399',
                  border: '1px solid rgba(52,211,153,0.2)',
                }}>
                  {p.name}
                  <span onClick={() => deletePreset(p.id)} style={{
                    cursor: 'pointer', fontSize: '13px', lineHeight: 1, opacity: 0.7, marginLeft: '2px',
                  }} title="删除">×</span>
                </span>
              ))}
            </div>
          )}
          {/* Add new preset */}
          <div style={{ display: 'flex', gap: '4px', alignItems: 'stretch' }}>
            <input
              type="text" placeholder="预设名称" value={newPresetName}
              onChange={e => setNewPresetName(e.target.value)}
              style={{
                width: '100px', padding: '4px 8px', borderRadius: '5px', fontSize: '11px',
                border: '1px solid var(--border-color, #333)', background: 'var(--bg-primary, #111)',
                color: 'var(--text-color, #e2e8f0)', outline: 'none',
              }}
            />
            <input
              type="text" placeholder="预设指令内容..." value={newPresetPrompt}
              onChange={e => setNewPresetPrompt(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter' && newPresetName.trim() && newPresetPrompt.trim()) { savePreset(newPresetName, newPresetPrompt); setNewPresetName(''); setNewPresetPrompt(''); } }}
              style={{
                flex: 1, padding: '4px 8px', borderRadius: '5px', fontSize: '11px',
                border: '1px solid var(--border-color, #333)', background: 'var(--bg-primary, #111)',
                color: 'var(--text-color, #e2e8f0)', outline: 'none',
              }}
            />
            <button
              onClick={() => { if (newPresetName.trim() && newPresetPrompt.trim()) { savePreset(newPresetName, newPresetPrompt); setNewPresetName(''); setNewPresetPrompt(''); } }}
              disabled={!newPresetName.trim() || !newPresetPrompt.trim()}
              style={{
                padding: '4px 12px', borderRadius: '5px', fontSize: '11px',
                border: 'none', background: 'rgba(52,211,153,0.2)', color: '#34d399',
                cursor: 'pointer', opacity: (newPresetName.trim() && newPresetPrompt.trim()) ? 1 : 0.4,
                whiteSpace: 'nowrap',
              }}
            >+ 保存</button>
          </div>
        </div>
      )}

      {/* Columns Container */}
      <div className="sb-columns-container" ref={scrollContainerRef}>
        <div className="sb-columns-scroll">
          {columns.map((col, colIndex) => {
            const color = COLUMN_COLORS[colIndex % COLUMN_COLORS.length];
            const prevCol = colIndex > 0 ? columns[colIndex - 1] : null;
            const prevCheckedCount = prevCol ? prevCol.items.filter(i => i.checked).length : 0;
            const canGenerate = colIndex === 0 ? col.prompt.trim().length > 0 : prevCheckedCount > 0;
            const checkedCount = col.items.filter(i => i.checked).length;
            const allChecked = col.items.length > 0 && col.items.every(i => i.checked);

            return (
              <div
                key={col.id}
                className={`sb-column ${col.isManual ? 'manual' : ''}`}
                style={{ '--col-color': color } as React.CSSProperties}
              >
                {/* Column Header */}
                <div className="sb-col-header">
                  <div className="sb-col-badge" style={{ background: color }}>
                    <input
                      className="sb-col-title-input"
                      value={col.title}
                      onChange={e => updateColumnTitle(colIndex, e.target.value)}
                    />
                  </div>
                  {colIndex > 0 && columns.length > 2 && (
                    <button
                      className="sb-col-remove"
                      onClick={() => removeColumn(colIndex)}
                      title="移除此列"
                    >
                      ×
                    </button>
                  )}
                </div>

                {/* Column 0: Tabbed Manual / AI Input */}
                {col.isManual && (
                  <div className="sb-col-manual">
                    <div className="sb-col0-tabs">
                      <button
                        className={`sb-col0-tab ${col0Tab === 'manual' ? 'active' : ''}`}
                        onClick={() => setCol0Tab('manual')}
                      >
                        ✏️ 手动输入
                      </button>
                      <button
                        className={`sb-col0-tab ${col0Tab === 'ai' ? 'active' : ''}`}
                        onClick={() => setCol0Tab('ai')}
                      >
                        🤖 AI 生成
                      </button>
                      <button
                        className={`sb-col0-tab ${col0Tab === 'image' ? 'active' : ''}`}
                        onClick={() => setCol0Tab('image')}
                      >
                        📸 图片扩展
                      </button>
                    </div>

                    {col0Tab === 'manual' ? (
                      <>
                        <textarea
                          className="sb-manual-textarea"
                          placeholder={"每行一条画面，也可直接粘贴 Google 表格"}
                          value={manualInput}
                          onChange={e => setManualInput(e.target.value)}
                          onPaste={handleManualPaste}
                          rows={2}
                        />
                        <button className="sb-manual-add" onClick={addManualItems}>
                          ➕ 添加到列表
                        </button>
                      </>
                    ) : col0Tab === 'ai' ? (
                      <>
                        <textarea
                          className="sb-col-prompt"
                          placeholder="输入主题让 AI 生成画面，例如：非洲草原日出日落的各种画面"
                          value={col.prompt}
                          onChange={e => updateColumnPrompt(colIndex, e.target.value)}
                          rows={2}
                        />
                        <button
                          className={`sb-col-generate ${col.isGenerating ? 'generating' : ''} ${!canGenerate ? 'disabled' : ''}`}
                          onClick={() => generateForColumn(colIndex)}
                          disabled={col.isGenerating || !canGenerate}
                        >
                          {col.isGenerating ? (
                            <><span className="sb-spinner" /> 生成中...</>
                          ) : (
                            <>🤖 AI 生成 {columns[0].colGenCount || genCount} 条</>
                          )}
                        </button>
                        {col.items.length > 0 && !col.isGenerating && (
                          <button
                            className="sb-col-generate"
                            onClick={() => regenerateColumn(colIndex)}
                            style={{ background: '#3f3f46', marginLeft: '4px', fontSize: '0.7rem' }}
                          >
                            🔁 重新生成
                          </button>
                        )}
                      </>
                    ) : col0Tab === 'image' ? (
                      <>
                        <div style={{ display: 'flex', gap: '4px', marginBottom: '3px' }}>
                          <select
                            value=""
                            onChange={e => { if (e.target.value) setImagePrompt(e.target.value); }}
                            style={{
                              flex: 1, minWidth: 0, padding: '2px 4px', borderRadius: '4px', fontSize: '10px',
                              border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
                              color: 'var(--text-muted, #888)', cursor: 'pointer', outline: 'none',
                            }}
                          >
                            <option value="">选择预设指令...</option>
                            {allPresets.map(p => <option key={p.id} value={p.prompt}>{p.name}</option>)}
                          </select>
                          {quickSaveKey === 'col0-image' ? (
                            <span style={{ display: 'inline-flex', gap: '2px' }}>
                              <input
                                ref={quickSaveInputRef}
                                type="text" placeholder="预设名称" value={quickSaveName}
                                onChange={e => setQuickSaveName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter' && quickSaveName.trim()) { savePreset(quickSaveName, imagePrompt); setQuickSaveKey(null); setQuickSaveName(''); } if (e.key === 'Escape') { setQuickSaveKey(null); setQuickSaveName(''); } }}
                                onBlur={() => { setTimeout(() => { setQuickSaveKey(k => k === 'col0-image' ? null : k); setQuickSaveName(''); }, 150); }}
                                style={{ width: '80px', padding: '1px 4px', borderRadius: '4px', fontSize: '10px', border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(0,0,0,0.3)', color: '#34d399', outline: 'none' }}
                                autoFocus
                              />
                              <button onClick={() => { if (quickSaveName.trim()) { savePreset(quickSaveName, imagePrompt); setQuickSaveKey(null); setQuickSaveName(''); } }} style={{ padding: '1px 5px', borderRadius: '4px', fontSize: '10px', border: 'none', background: 'rgba(52,211,153,0.2)', color: '#34d399', cursor: 'pointer' }}>✓</button>
                            </span>
                          ) : (
                            <button
                              onClick={() => { if (imagePrompt.trim()) { setQuickSaveKey('col0-image'); setQuickSaveName(''); } }}
                              disabled={!imagePrompt.trim()}
                              title="保存当前指令为预设"
                              style={{
                                padding: '2px 6px', borderRadius: '4px', fontSize: '10px',
                                border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
                                color: imagePrompt.trim() ? '#34d399' : 'rgba(255,255,255,0.2)',
                                cursor: imagePrompt.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap',
                              }}
                            >💾 存</button>
                          )}
                        </div>
                        <textarea
                          className="sb-col-prompt"
                          placeholder="图片扩展指令：基于图片生成什么样的画面描述..."
                          value={imagePrompt}
                          onChange={e => setImagePrompt(e.target.value)}
                          rows={2}
                        />
                        <div style={{
                          display: 'flex', flexWrap: 'wrap', gap: '6px', padding: '6px',
                          borderRadius: '6px', background: 'rgba(255,255,255,0.03)',
                          border: '1px dashed rgba(255,255,255,0.1)', minHeight: '48px',
                          alignItems: 'center',
                        }}>
                          {imageFiles.map(img => (
                            <div key={img.id} style={{
                              position: 'relative', width: '60px', height: '60px',
                              borderRadius: '6px', overflow: 'hidden',
                              border: '1px solid rgba(255,255,255,0.15)',
                            }}>
                              <img src={img.preview} alt="" style={{
                                width: '100%', height: '100%', objectFit: 'cover',
                              }} />
                              <button onClick={() => removeImage(img.id)} style={{
                                position: 'absolute', top: '1px', right: '1px',
                                width: '16px', height: '16px', borderRadius: '50%',
                                background: 'rgba(0,0,0,0.7)', color: '#fff',
                                border: 'none', fontSize: '10px', cursor: 'pointer',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                lineHeight: 1,
                              }}>×</button>
                            </div>
                          ))}
                          <button
                            onClick={() => imageInputRef.current?.click()}
                            style={{
                              width: '60px', height: '60px', borderRadius: '6px',
                              border: '1px dashed rgba(255,255,255,0.2)',
                              background: 'transparent', color: 'rgba(255,255,255,0.4)',
                              cursor: 'pointer', fontSize: '20px',
                              display: 'flex', alignItems: 'center', justifyContent: 'center',
                            }}
                            title="添加图片"
                          >+</button>
                          <input
                            ref={imageInputRef}
                            type="file"
                            accept="image/*"
                            multiple
                            style={{ display: 'none' }}
                            onChange={e => handleImageUpload(e.target.files)}
                          />
                        </div>
                        <div style={{ display: 'flex', gap: '4px', marginTop: '4px' }}>
                          <button
                            className={`sb-col-generate ${isImageExpanding ? 'generating' : ''} ${imageFiles.length === 0 ? 'disabled' : ''}`}
                            onClick={expandFromImages}
                            disabled={isImageExpanding || imageFiles.length === 0}
                            style={{ flex: 1 }}
                          >
                            {isImageExpanding ? (
                              <><span className="sb-spinner" /> 分析图片中...</>
                            ) : (
                              <>📸 从 {imageFiles.length} 张图片扩展 (每张 {columns[0].colGenCount || genCount} 条)</>
                            )}
                          </button>
                          {imageFiles.length > 0 && !isImageExpanding && (
                            <button
                              className="sb-col-generate"
                              onClick={() => { imageFiles.forEach(i => URL.revokeObjectURL(i.preview)); setImageFiles([]); }}
                              style={{ background: '#3f3f46', fontSize: '0.7rem' }}
                            >🗑</button>
                          )}
                        </div>
                      </>
                    ) : null}
                  </div>
                )}

                {/* Non-manual columns: show parent context + prompt */}
                {!col.isManual && (
                  <>
                    <div className="sb-col-parent">
                      <span className="sb-col-parent-label">基于上一列：</span>
                      <span className="sb-col-parent-text">
                        {prevCheckedCount > 0
                          ? `已勾选 ${prevCheckedCount} 条`
                          : '← 请先在上一列勾选'}
                      </span>
                    </div>
                    <div className="sb-col-prompt-area">
                      <div style={{ display: 'flex', gap: '4px', marginBottom: '3px', flexWrap: 'wrap' }}>
                        <select
                          value=""
                          onChange={e => { if (e.target.value) updateColumnPrompt(colIndex, e.target.value); }}
                          style={{
                            flex: 1, minWidth: 0, padding: '2px 4px', borderRadius: '4px', fontSize: '10px',
                            border: '1px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.05)',
                            color: 'var(--text-muted, #888)', cursor: 'pointer', outline: 'none',
                          }}
                        >
                          <option value="">选择预设指令...</option>
                          {allPresets.map(p => <option key={p.id} value={p.prompt}>{p.name}</option>)}
                        </select>
                        {quickSaveKey === `col-${colIndex}` ? (
                          <span style={{ display: 'inline-flex', gap: '2px' }}>
                            <input
                              type="text" placeholder="预设名称" value={quickSaveName}
                              onChange={e => setQuickSaveName(e.target.value)}
                              onKeyDown={e => { if (e.key === 'Enter' && quickSaveName.trim()) { savePreset(quickSaveName, col.prompt); setQuickSaveKey(null); setQuickSaveName(''); } if (e.key === 'Escape') { setQuickSaveKey(null); setQuickSaveName(''); } }}
                              onBlur={() => { setTimeout(() => { setQuickSaveKey(k => k === `col-${colIndex}` ? null : k); setQuickSaveName(''); }, 150); }}
                              style={{ width: '80px', padding: '1px 4px', borderRadius: '4px', fontSize: '10px', border: '1px solid rgba(52,211,153,0.4)', background: 'rgba(0,0,0,0.3)', color: '#34d399', outline: 'none' }}
                              autoFocus
                            />
                            <button onClick={() => { if (quickSaveName.trim()) { savePreset(quickSaveName, col.prompt); setQuickSaveKey(null); setQuickSaveName(''); } }} style={{ padding: '1px 5px', borderRadius: '4px', fontSize: '10px', border: 'none', background: 'rgba(52,211,153,0.2)', color: '#34d399', cursor: 'pointer' }}>✓</button>
                          </span>
                        ) : (
                          <button
                            onClick={() => { if (col.prompt.trim()) { setQuickSaveKey(`col-${colIndex}`); setQuickSaveName(''); } }}
                            disabled={!col.prompt.trim()}
                            title="保存当前指令为预设"
                            style={{
                              padding: '2px 6px', borderRadius: '4px', fontSize: '10px',
                              border: '1px solid rgba(255,255,255,0.12)', background: 'transparent',
                              color: col.prompt.trim() ? '#34d399' : 'rgba(255,255,255,0.2)',
                              cursor: col.prompt.trim() ? 'pointer' : 'default', whiteSpace: 'nowrap',
                            }}
                          >💾 存</button>
                        )}
                      </div>
                      <textarea
                        className="sb-col-prompt"
                        placeholder="自定义扩展要求..."
                        value={col.prompt}
                        onChange={e => updateColumnPrompt(colIndex, e.target.value)}
                        rows={1}
                      />
                      <div className="sb-col-gen-row">
                        <button
                          className={`sb-col-generate ${col.isGenerating ? 'generating' : ''} ${!canGenerate ? 'disabled' : ''}`}
                          onClick={() => generateForColumn(colIndex)}
                          disabled={col.isGenerating || !canGenerate}
                        >
                          {col.isGenerating ? (
                            <><span className="sb-spinner" /> 生成中...</>
                          ) : (
                            <>✨ 扩展</>
                          )}
                        </button>
                        {col.items.length > 0 && !col.isGenerating && (
                          <button
                            className="sb-col-generate"
                            onClick={() => regenerateColumn(colIndex)}
                            style={{ background: '#3f3f46', fontSize: '0.7rem' }}
                          >
                            🔁 重新生成
                          </button>
                        )}
                        <span className="sb-col-gen-label">每条</span>
                        <input
                          type="number"
                          className="sb-col-gen-input"
                          placeholder={String(genCount)}
                          value={col.colGenCount ?? ''}
                          onChange={e => {
                            const v = e.target.value ? Math.max(1, Math.min(999, parseInt(e.target.value) || 0)) : undefined;
                            updateColumnGenCount(colIndex, v);
                          }}
                          title="每条扩展数量（留空用全局默认）"
                        />
                        <span className="sb-col-gen-label">条</span>
                      </div>
                    </div>
                  </>
                )}

                {/* Select all toggle */}
                {col.items.length > 0 && (
                  <div className="sb-col-select-all">
                    <label className="sb-checkbox-label" onClick={() => toggleAllChecks(colIndex)}>
                      <span className={`sb-checkbox ${allChecked ? 'checked' : ''}`}>
                        {allChecked ? '✓' : ''}
                      </span>
                      {allChecked ? '取消全选' : '全选'} ({checkedCount}/{col.items.length})
                    </label>
                  </div>
                )}

                {/* Items List */}
                <div className="sb-col-items">
                  {col.items.length === 0 && !col.isGenerating && (
                    <div className="sb-col-empty">
                      {col.isManual
                        ? '在上方输入画面描述，点击添加'
                        : '← 勾选上一列后点击生成'}
                    </div>
                  )}
                  {col.items.map((item, itemIdx) => {
                    const isStarred = starred.has(item.id);
                    return (
                      <div
                        key={item.id}
                        className={`sb-item ${item.checked ? 'checked' : ''}`}
                      >
                        <span
                          className={`sb-checkbox ${item.checked ? 'checked' : ''}`}
                          onClick={() => toggleCheck(colIndex, item.id)}
                        >
                          {item.checked ? '✓' : ''}
                        </span>
                        <span className="sb-item-num">{itemIdx + 1}</span>
                        <div className="sb-item-text" onClick={() => toggleCheck(colIndex, item.id)}>
                          {item.text}
                        </div>
                        {item.category && (
                          <span
                            className="sb-item-category"
                            style={{
                              fontSize: '9px', padding: '1px 5px', borderRadius: '8px',
                              background: 'rgba(52,211,153,0.12)', color: '#34d399',
                              border: '1px solid rgba(52,211,153,0.2)', whiteSpace: 'nowrap',
                              flexShrink: 0, lineHeight: '16px',
                            }}
                          >
                            {item.category}
                          </span>
                        )}
                        <div className="sb-item-actions">
                          <button
                            className={`sb-item-btn star ${isStarred ? 'active' : ''}`}
                            onClick={() => toggleStar(item.id)}
                            title="收藏"
                          >
                            {isStarred ? '★' : '☆'}
                          </button>
                          <button
                            className="sb-item-btn copy"
                            onClick={() => copyItem(item.text)}
                            title="复制"
                          >
                            📋
                          </button>
                          <button
                            className="sb-item-btn"
                            onClick={() => regenerateItem(colIndex, item.id)}
                            title="重新生成此条"
                            style={{ color: '#60a5fa' }}
                          >
                            🔄
                          </button>
                          <button
                            className="sb-item-btn del"
                            onClick={() => deleteItem(colIndex, item.id)}
                            title="删除"
                          >
                            ×
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                {/* Column Footer with stats and copy button */}
                {col.items.length > 0 && (
                  <div className="sb-col-footer">
                    <div className="sb-col-stats">
                      {col.items.length} 条
                      {checkedCount > 0 && ` · ${checkedCount} 勾选`}
                      {col.items.some(i => i.category) && ` · 已分类`}
                    </div>
                    <div style={{ display: 'flex', gap: '4px' }}>
                      {autoClassify && col.items.length > 0 && !col.items.every(i => i.category) && (
                        <button
                          className="sb-col-copy-btn"
                          onClick={() => classifyColumnItems(colIndex)}
                          disabled={isClassifying}
                          style={{ fontSize: '10px' }}
                        >
                          🏷
                        </button>
                      )}
                      <button
                        className="sb-col-copy-btn"
                        onClick={() => copyColumnItems(colIndex)}
                      >
                        📋 复制本列
                      </button>
                    </div>
                  </div>
                )}
              </div>
            );
          })}

          {/* Add Column Button */}
          <div className="sb-add-column" onClick={addColumn}>
            <div className="sb-add-column-inner">
              <span className="sb-add-icon">+</span>
              <span className="sb-add-text">添加新层</span>
            </div>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="sb-bottom-bar">
        <div className="sb-bottom-left">
          <span className="sb-stats">
            共 <strong>{totalItems}</strong> 条画面
            {totalChecked > 0 && <> · <strong>{totalChecked}</strong> 已勾选</>}
            {totalStarred > 0 && <> · <strong>{totalStarred}</strong> 收藏</>}
            {' · '}{columns.length} 层
          </span>
        </div>
        <div className="sb-bottom-right">
          <button className="sb-action-btn primary" onClick={copyAllColumnsAsTsv} disabled={totalItems === 0}>
            📊 复制全部列为表格
          </button>
          <button className="sb-action-btn" onClick={copyChecked} disabled={totalChecked === 0}>
            ☑ 复制勾选 ({totalChecked})
          </button>
          <button className="sb-action-btn" onClick={exportStarred} disabled={totalStarred === 0}>
            ⭐ 复制收藏 ({totalStarred})
          </button>
          <button className="sb-action-btn" onClick={exportAll} disabled={totalItems === 0}>
            📥 导出TXT
          </button>
          <button className="sb-action-btn danger" onClick={() => {
            if (totalItems === 0 || confirm('确定要清空所有画面吗？')) {
              setColumns([
                { id: genId(), title: '第0层：我的画面', prompt: '', items: [], isGenerating: false, isManual: true },
                { id: genId(), title: '第1层：扩展', prompt: DEFAULT_EXPAND_PROMPT, items: [], isGenerating: false },
              ]);
              setStarred(new Set());
              setManualInput('');
              showNotification('🗑 已清空');
            }
          }}>
            🗑 清空
          </button>
        </div>
      </div>

      {/* Notification */}
      {notification && (
        <div className="sb-notification">{notification}</div>
      )}
    </div>
  );
};

export default SceneBrainstormApp;
