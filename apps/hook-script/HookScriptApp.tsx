/**
 * 黄金三秒 · 短视频脚本生成器
 * 
 * 功能:
 * 1. 多任务管理 - 每个任务有故事方向 + 多图参考 + AI 生成结果
 * 2. 图片拖拽排序 - 故事板顺序
 * 3. AI 批量生成 - 多条描述词思路
 * 4. 快速模板 - 内置常用短视频场景
 * 5. 复制/导出 - TSV 格式，图片自动上传 Gyazo
 * 6. 控制: 开始/停止/失败重试/全部重做
 */
import React, { useState, useRef, useCallback, useEffect } from 'react';
import { extractUrlsFromHtml, fetchImageBlob, convertBlobToBase64 } from '../ai-image-recognition/utils';
import './HookScriptApp.css';
import { playCompletionSound } from '@/utils/soundNotification';

// ========== Types ==========
interface TaskImage {
  id: string;
  data: string;      // base64
  mimeType: string;
  name: string;
  gyazoUrl?: string;  // 上传后的 Gyazo URL
}

interface HookResult {
  id: string;
  content: string;       // legacy/fallback
  contentZh: string;     // 中文完整描述（全景故事）
  contentEn: string;     // 英文完整描述（全景故事）
  motionZh?: string;     // 选填：视频动态(中文)
  motionEn?: string;     // 选填：视频动态(英文)
  firstFrameZh?: string; // 选填：首帧(中文)
  lastFrameZh?: string;  // 选填：尾帧(中文)
  firstFrameEn?: string; // 选填：首帧(英文)
  lastFrameEn?: string;  // 选填：尾帧(英文)
  starred: boolean;
}

interface HookTask {
  id: string;
  direction: string;
  images: TaskImage[];
  results: HookResult[];
  status: 'idle' | 'processing' | 'done' | 'error';
  error?: string;
  createdAt: number;
}

interface HookPreset {
  id: string;
  name: string;
  style: string;
  ideaCount: number;
  duration: string;
  systemInstruction: string;
  createdAt: number;
}

interface HookScriptAppProps {
  getAiInstance: () => any;
  textModel?: string;
}

// ========== Constants ==========
const DEFAULT_GYAZO_TOKEN = 'W0SHYCmn38FEoNQEdu7GwT1bOJP84TjQadGjlSgbG6I';

const STYLE_PRESETS = [
  { value: 'cinematic', label: '🎬 电影感' },
  { value: 'documentary', label: '📹 纪录片' },
  { value: 'vlog', label: '📱 Vlog' },
  { value: 'funny', label: '😂 搞笑' },
  { value: 'suspense', label: '🔮 悬疑' },
  { value: 'healing', label: '🌿 治愈' },
  { value: 'epic', label: '⚡ 史诗感' },
  { value: 'custom', label: '✏️ 自定义' },
];

const DURATION_OPTIONS = [
  { value: '3', label: '3秒' },
  { value: '5', label: '5秒' },
  { value: '15', label: '15秒' },
  { value: '30', label: '30秒' },
  { value: '60', label: '60秒' },
];

const QUICK_TEMPLATES = [
  { name: '🍳 美食开箱', direction: '展示一道精致美食的制作过程或开箱瞬间，重点突出色泽、质感、热气腾腾的画面', systemHint: '聚焦食物的色彩与质感，使用温暖色调' },
  { name: '✈️ 旅行Vlog', direction: '旅行途中的惊艳风景或有趣体验，用第一视角呈现发现感', systemHint: '强调运镜的流畅感和画面的壮观' },
  { name: '🎤 知识口播', direction: '一个引发好奇的知识点/冷知识，用吸引人的开头钩住观众', systemHint: '开头要有悬念或反转，让人想继续看' },
  { name: '🐾 萌宠日常', direction: '宠物的可爱/搞笑瞬间，突出反差萌', systemHint: '捕捉自然的互动瞬间' },
  { name: '💪 健身变化', direction: '展示健身前后的对比或训练过程中的高能瞬间', systemHint: '用对比和节奏感突出变化' },
  { name: '🎨 手工/绘画', direction: '一件手工作品或绘画从零开始到完成的过程', systemHint: '使用加速镜头展示过程，慢动作展示细节' },
  { name: '😱 反转剧情', direction: '一个有意想不到反转的短剧场景', systemHint: '铺垫要自然，反转要出乎意料' },
  { name: '🌅 治愈风景', direction: '一处令人心旷神怡的自然风景或安静场景', systemHint: '慢节奏，注重光影和氛围' },
  { name: '🛍️ 好物推荐', direction: '推荐一个实用/有趣的产品，展示使用效果', systemHint: '突出问题→解决方案→效果对比' },
  { name: '🎵 卡点视频', direction: '画面与音乐节点完美配合的视觉冲击', systemHint: '强调节奏、转场和视觉节拍' },
];

const DEFAULT_SYSTEM_INSTRUCTION = `你是一个专业的短视频创意导演和AI视频描述词专家。你的任务是根据用户提供的故事方向和参考图片序列，生成专业的AI视频/图片生成描述词。

要求：
1. 充分理解每张参考图的内容、构图、光影、色调和情绪
2. 按照图片的排列顺序理解故事脉络
3. 输出的描述词要足够详细，可以直接用于AI图像/视频生成
4. 每条思路要有不同的创意角度或风格变化
5. 描述词需包含：场景环境、人物/主体、光影氛围、摄影风格、色调情绪
6. 用英文输出最终描述词`;

const uid = () => Math.random().toString(36).slice(2, 10);

// Gyazo upload helper
const uploadToGyazo = async (base64Data: string, mimeType: string): Promise<string | null> => {
  try {
    const byteString = atob(base64Data);
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
    const blob = new Blob([ab], { type: mimeType });
    const file = new File([blob], `hook_${Date.now()}.${mimeType.split('/')[1] || 'png'}`, { type: mimeType });

    const token = localStorage.getItem('gyazo_access_token') || DEFAULT_GYAZO_TOKEN;
    const formData = new FormData();
    formData.append('access_token', token);
    formData.append('imagedata', file);

    const res = await fetch('https://upload.gyazo.com/api/upload', { method: 'POST', body: formData });
    if (!res.ok) return null;
    const json = await res.json();
    return json.url || json.permalink_url || null;
  } catch {
    return null;
  }
};

// ========== Component ==========
const HookScriptApp: React.FC<HookScriptAppProps> = ({ getAiInstance, textModel }) => {
  // State
  const [tasks, setTasks] = useState<HookTask[]>(() => {
    try {
      const saved = localStorage.getItem('hook_script_tasks');
      if (saved) {
        const parsed = JSON.parse(saved);
        return parsed.map((t: any) => ({ ...t, status: t.status === 'processing' ? 'idle' : t.status }));
      }
    } catch {}
    return [createTask()];
  });
  const [systemInstruction, setSystemInstruction] = useState(() =>
    localStorage.getItem('hook_script_system') || DEFAULT_SYSTEM_INSTRUCTION
  );
  const [showSystem, setShowSystem] = useState(false);
  const [style, setStyle] = useState(() => localStorage.getItem('hook_script_style') || 'cinematic');
  const [ideaCount, setIdeaCount] = useState(() => {
    const saved = localStorage.getItem('hook_script_idea_count');
    return saved ? parseInt(saved) : 3;
  });
  const [duration, setDuration] = useState(() => localStorage.getItem('hook_script_duration') || '3');
  const [isRunning, setIsRunning] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [showTemplates, setShowTemplates] = useState(false);
  const [showPresets, setShowPresets] = useState(false);
  const [presets, setPresets] = useState<HookPreset[]>(() => {
    try {
      const saved = localStorage.getItem('hook_script_presets');
      return saved ? JSON.parse(saved) : [];
    } catch { return []; }
  });
  const [presetName, setPresetName] = useState('');
  const [dragState, setDragState] = useState<{ taskId: string; imageId: string } | null>(null);
  const [dragOverImage, setDragOverImage] = useState<string | null>(null);
  const [activeTaskId, setActiveTaskId] = useState<string | null>(null); // 当前聚焦的任务（用于粘贴）
  const [dragOverTaskId, setDragOverTaskId] = useState<string | null>(null); // 外部拖拽高亮
  const [clearConfirm, setClearConfirm] = useState(false); // 点击两次清空
  const [collapsedTasks, setCollapsedTasks] = useState<Set<string>>(new Set()); // 折叠的任务卡
  const dragCounterRef = useRef<Record<string, number>>({}); // 防抖拖拽计数器
  const clearTimerRef = useRef<number | null>(null);

  const stopRef = useRef(false);
  const tasksRef = useRef(tasks);
  tasksRef.current = tasks;
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});

  // Persist
  useEffect(() => {
    // Only persist non-image data for tasks (images can be large)
    try {
      const toSave = tasks.map(t => ({
        ...t,
        images: t.images.map(img => ({ ...img, data: img.data.substring(0, 200) + '…' })), // truncate for storage
        status: t.status === 'processing' ? 'idle' : t.status
      }));
      // Actually, let's save full data but only if it's not too big
      const fullSave = JSON.stringify(tasks.map(t => ({
        ...t,
        status: t.status === 'processing' ? 'idle' : t.status
      })));
      if (fullSave.length < 10_000_000) { // 10MB limit
        localStorage.setItem('hook_script_tasks', fullSave);
      }
    } catch {}
  }, [tasks]);

  useEffect(() => { localStorage.setItem('hook_script_system', systemInstruction); }, [systemInstruction]);
  useEffect(() => { localStorage.setItem('hook_script_style', style); }, [style]);
  useEffect(() => { localStorage.setItem('hook_script_idea_count', String(ideaCount)); }, [ideaCount]);
  useEffect(() => { localStorage.setItem('hook_script_duration', duration); }, [duration]);
  useEffect(() => {
    try { localStorage.setItem('hook_script_presets', JSON.stringify(presets)); } catch {}
  }, [presets]);

  // Show toast
  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(null), 2500);
  }, []);

  // ========== Task CRUD ==========
  function createTask(): HookTask {
    return { id: uid(), direction: '', images: [], results: [], status: 'idle', createdAt: Date.now() };
  }

  const addTask = useCallback(() => {
    setTasks(prev => [...prev, createTask()]);
  }, []);

  const removeTask = useCallback((taskId: string) => {
    setTasks(prev => prev.length > 1 ? prev.filter(t => t.id !== taskId) : prev);
  }, []);

  const updateTask = useCallback((taskId: string, updates: Partial<HookTask>) => {
    setTasks(prev => prev.map(t => t.id === taskId ? { ...t, ...updates } : t));
  }, []);

  // ========== Image Management ==========
  const handleAddImages = useCallback((taskId: string, files: FileList | File[]) => {
    const fileArr = Array.from(files);
    const promises = fileArr.map(file => new Promise<TaskImage>((resolve) => {
      const reader = new FileReader();
      reader.onload = () => {
        const dataUrl = reader.result as string;
        const [prefix, data] = dataUrl.split(',');
        const mimeType = prefix.match(/data:(.*?);/)?.[1] || 'image/png';
        resolve({ id: uid(), data, mimeType, name: file.name });
      };
      reader.readAsDataURL(file);
    }));

    Promise.all(promises).then(newImages => {
      setTasks(prev => prev.map(t =>
        t.id === taskId ? { ...t, images: [...t.images, ...newImages] } : t
      ));
    });
  }, []);

  const removeImage = useCallback((taskId: string, imageId: string) => {
    setTasks(prev => prev.map(t =>
      t.id === taskId ? { ...t, images: t.images.filter(img => img.id !== imageId) } : t
    ));
  }, []);

  // Image drag-and-drop reorder
  const handleDragStart = useCallback((taskId: string, imageId: string) => {
    setDragState({ taskId, imageId });
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, imageId: string) => {
    e.preventDefault();
    setDragOverImage(imageId);
  }, []);

  const handleDrop = useCallback((taskId: string, targetImageId: string) => {
    if (!dragState || dragState.taskId !== taskId) return;
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const images = [...t.images];
      const fromIdx = images.findIndex(img => img.id === dragState.imageId);
      const toIdx = images.findIndex(img => img.id === targetImageId);
      if (fromIdx < 0 || toIdx < 0 || fromIdx === toIdx) return t;
      const [moved] = images.splice(fromIdx, 1);
      images.splice(toIdx, 0, moved);
      return { ...t, images };
    }));
    setDragState(null);
    setDragOverImage(null);
  }, [dragState]);

  const handleDragEnd = useCallback(() => {
    setDragState(null);
    setDragOverImage(null);
  }, []);

  // File drop on task
  const handleFileDrop = useCallback((e: React.DragEvent, taskId: string) => {
    e.preventDefault();
    e.stopPropagation();
    setDragOverTaskId(null);
    dragCounterRef.current[taskId] = 0;
    if (e.dataTransfer.files?.length) {
      const imageFiles = Array.from(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
      if (imageFiles.length) handleAddImages(taskId, imageFiles);
    }
  }, [handleAddImages]);

  // External drag enter/leave for drop zone highlight
  const handleTaskDragEnter = useCallback((e: React.DragEvent, taskId: string) => {
    e.preventDefault();
    dragCounterRef.current[taskId] = (dragCounterRef.current[taskId] || 0) + 1;
    if (dragCounterRef.current[taskId] === 1) {
      setDragOverTaskId(taskId);
    }
  }, []);

  const handleTaskDragLeave = useCallback((e: React.DragEvent, taskId: string) => {
    e.preventDefault();
    dragCounterRef.current[taskId] = (dragCounterRef.current[taskId] || 1) - 1;
    if (dragCounterRef.current[taskId] <= 0) {
      dragCounterRef.current[taskId] = 0;
      setDragOverTaskId(null);
    }
  }, []);

  // ========== Paste Handler (clipboard images + Google Sheets URLs) ==========
  const handlePasteForTask = useCallback(async (taskId: string) => {
    try {
      const clipboardItems = await navigator.clipboard.read();
      const imageFiles: File[] = [];
      const urlsToFetch: string[] = [];

      for (const item of clipboardItems) {
        // Check for image types first
        for (const type of item.types) {
          if (type.startsWith('image/')) {
            const blob = await item.getType(type);
            const file = new File([blob], `paste_${Date.now()}.${type.split('/')[1] || 'png'}`, { type });
            imageFiles.push(file);
          }
        }

        // Check for HTML (Google Sheets paste)
        if (item.types.includes('text/html')) {
          const htmlBlob = await item.getType('text/html');
          const html = await htmlBlob.text();
          const extracted = extractUrlsFromHtml(html);
          for (const { fetchUrl } of extracted) {
            urlsToFetch.push(fetchUrl);
          }
        }

        // Check for plain text URLs
        if (urlsToFetch.length === 0 && imageFiles.length === 0 && item.types.includes('text/plain')) {
          const textBlob = await item.getType('text/plain');
          const text = await textBlob.text();
          const urlRegex = /https?:\/\/[^\s]+/g;
          const matches = text.match(urlRegex);
          if (matches) urlsToFetch.push(...matches);
        }
      }

      // Process direct image files
      if (imageFiles.length > 0) {
        handleAddImages(taskId, imageFiles);
        showToast(`📷 已粘贴 ${imageFiles.length} 张图片`);
        return;
      }

      // Fetch URL images
      if (urlsToFetch.length > 0) {
        showToast(`⏳ 正在加载 ${urlsToFetch.length} 张图片...`);
        let successCount = 0;
        for (const url of urlsToFetch) {
          try {
            const { blob, mimeType } = await fetchImageBlob(url);
            const base64 = await convertBlobToBase64(blob);
            const newImg: TaskImage = {
              id: uid(),
              data: base64,
              mimeType: mimeType || 'image/jpeg',
              name: `url_${Date.now()}.jpg`,
            };
            setTasks(prev => prev.map(t =>
              t.id === taskId ? { ...t, images: [...t.images, newImg] } : t
            ));
            successCount++;
          } catch (err) {
            console.warn('[HookScript] Failed to fetch image:', url, err);
          }
        }
        showToast(successCount > 0
          ? `✅ 成功加载 ${successCount}/${urlsToFetch.length} 张图片`
          : `❌ 图片加载失败`);
        return;
      }

      showToast('📋 剪贴板中没有图片');
    } catch (err) {
      console.warn('[HookScript] Paste error:', err);
      showToast('⚠️ 粘贴失败，请尝试拖拽或双击选择文件');
    }
  }, [handleAddImages, showToast]);

  // Global paste listener
  useEffect(() => {
    const handleGlobalPaste = (e: ClipboardEvent) => {
      if (!activeTaskId) return;
      // Don't intercept paste in input/textarea
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA') return;

      // Check if wrapper is active/visible
      const wrapper = document.querySelector('.hook-script-wrapper');
      if (wrapper && wrapper.getBoundingClientRect().width === 0) return;

      e.preventDefault();

      // Handle clipboard files directly
      if (e.clipboardData?.files?.length) {
        const imageFiles = Array.from(e.clipboardData.files).filter(f => f.type.startsWith('image/'));
        if (imageFiles.length > 0) {
          handleAddImages(activeTaskId, imageFiles);
          showToast(`📷 已粘贴 ${imageFiles.length} 张图片`);
          return;
        }
      }

      // Handle HTML (Google Sheets)
      const html = e.clipboardData?.getData('text/html');
      if (html) {
        const extracted = extractUrlsFromHtml(html);
        if (extracted.length > 0) {
          const taskId = activeTaskId;
          showToast(`⏳ 正在加载 ${extracted.length} 张图片...`);
          (async () => {
            let successCount = 0;
            for (const { fetchUrl } of extracted) {
              try {
                const { blob, mimeType } = await fetchImageBlob(fetchUrl);
                const base64 = await convertBlobToBase64(blob);
                const newImg: TaskImage = {
                  id: uid(),
                  data: base64,
                  mimeType: mimeType || 'image/jpeg',
                  name: `sheet_${Date.now()}.jpg`,
                };
                setTasks(prev => prev.map(t =>
                  t.id === taskId ? { ...t, images: [...t.images, newImg] } : t
                ));
                successCount++;
              } catch {}
            }
            showToast(successCount > 0
              ? `✅ 成功加载 ${successCount}/${extracted.length} 张图片`
              : `❌ 图片加载失败`);
          })();
          return;
        }
      }
    };

    document.addEventListener('paste', handleGlobalPaste);
    return () => document.removeEventListener('paste', handleGlobalPaste);
  }, [activeTaskId, handleAddImages, showToast]);

  // ========== Result Management ==========
  const toggleStar = useCallback((taskId: string, resultId: string) => {
    setTasks(prev => prev.map(t => t.id === taskId ? {
      ...t,
      results: t.results.map(r => r.id === resultId ? { ...r, starred: !r.starred } : r)
    } : t));
  }, []);

  // ========== AI Generation ==========
  const getStylePrompt = useCallback(() => {
    const preset = STYLE_PRESETS.find(s => s.value === style);
    if (style === 'custom') return '';
    const styleMap: Record<string, string> = {
      cinematic: '电影质感、宽画幅、浅景深、专业灯光',
      documentary: '纪录片风格、真实感、自然光线、手持镜头感',
      vlog: 'Vlog风格、轻松活泼、近距离、自然真实',
      funny: '搞笑风格、夸张表情、喜剧节奏',
      suspense: '悬疑氛围、暗调光影、紧张感、特写镜头',
      healing: '治愈系、柔和光影、暖色调、慢节奏',
      epic: '史诗感、宏大场面、逆光、低角度',
    };
    return styleMap[style] || '';
  }, [style]);

  const generateForTask = useCallback(async (taskId: string) => {
    const task = tasksRef.current.find(t => t.id === taskId);
    if (!task) return;

    updateTask(taskId, { status: 'processing', error: undefined, results: [] });

    try {
      const ai = getAiInstance();
      const model = textModel || 'gemini-2.5-flash';

      // Build image parts
      const imageParts = task.images.map((img, idx) => ({
        inlineData: { data: img.data, mimeType: img.mimeType }
      }));

      const imageDescriptions = task.images.length > 0
        ? `\n\n我提供了 ${task.images.length} 张参考图片，按顺序排列代表故事的视觉脉络。请仔细分析每张图的内容、构图、光影和色调。`
        : '';

      const styleHint = getStylePrompt();
      const styleText = styleHint ? `\n风格要求: ${styleHint}` : '';

      const prompt = `故事方向: ${task.direction || '请根据图片内容自由发挥'}${imageDescriptions}${styleText}
目标时长: ${duration}秒短视频
请生成 ${ideaCount} 条不同角度/风格的AI视频描述词思路。

⚠️ 每条思路必须包含以下四个维度，且分别提供【中文版】和【英文版】：
1. 完整画面 (完整的场景/故事描述词)
2. 首帧画面 (静止的首帧构图细节)
3. 尾帧画面 (静止的尾帧构图细节)
4. 视频动态 (具体的运镜和动作走向)

输出格式（严格按此规则并包含具体标签）:
---思路1---
【中文完整】
(完整故事画面综合描述词)
【中文首帧】
(静止的首帧画面细节构图描述)
【中文尾帧】
(静止的尾帧画面细节构图描述)
【中文动态】
(视频主体动作与运镜走向描述)
【英文完整】
(Complete story prompt)
【英文首帧】
(English first frame static description)
【英文尾帧】
(English last frame static description)
【英文动态】
(English video specific motion description)
---思路2---
...以此类推

每条描述词必须：
- 可以直接丢给AI视频/图片生成引擎
- 不要有多余的解释和前置语`;

      const parts: any[] = [...imageParts, { text: prompt }];

      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: {
          systemInstruction: systemInstruction,
          temperature: 0.9,
        },
      });

      if (stopRef.current) {
        updateTask(taskId, { status: 'idle' });
        return;
      }

      const text = response?.candidates?.[0]?.content?.parts?.[0]?.text || '';

      // Parse results — bilingual format
      const results: HookResult[] = [];
      const blocks = text.split(/---思路\d+---/).filter((b: string) => b.trim());

      const parseBilingual = (block: string): Partial<HookResult> => {
        const extract = (regex: RegExp) => {
          const m = block.match(regex);
          return m ? m[1].trim() : '';
        };

        const zhFull = extract(/【(?:中文完整|中文)】\s*([\s\S]*?)(?=【中文首帧】|【中文尾帧】|【中文动态】|【英文|【EN|$)/);
        const zhFirst = extract(/【中文首帧】\s*([\s\S]*?)(?=【中文尾帧】|【中文动态】|【英文|【EN|$)/);
        const zhLast = extract(/【中文尾帧】\s*([\s\S]*?)(?=【中文动态】|【英文|【EN|$)/);
        const zhMotion = extract(/【(?:中文动态|中文视频)】\s*([\s\S]*?)(?=【英文|【EN|$)/);
        
        const enFull = extract(/【(?:英文完整|英文|EN|EN_FULL)】\s*([\s\S]*?)(?=【英文首帧|【EN_FIRST|【英文尾帧|【EN_LAST|【英文动态|【EN_MOTION|$)/);
        const enFirst = extract(/【(?:英文首帧|EN_FIRST_FRAME)】\s*([\s\S]*?)(?=【英文尾帧|【EN_LAST|【英文动态|【EN_MOTION|$)/);
        const enLast = extract(/【(?:英文尾帧|EN_LAST_FRAME)】\s*([\s\S]*?)(?=【英文动态|【EN_MOTION|$)/);
        const enMotion = extract(/【(?:英文动态|英文视频|EN_MOTION|EN_VIDEO)】\s*([\s\S]*?)$/);

        // Fallback for old simple format if new tags fail
        if (!zhFull && !enFull && !zhFirst && !enFirst && !zhMotion) {
          const zhMatch = extract(/【中文】\s*([\s\S]*?)(?=【英文】|$)/);
          const enMatch = extract(/【英文】\s*([\s\S]*?)$/);
          return { contentZh: zhMatch, contentEn: enMatch };
        }

        return {
          contentZh: zhFull,
          motionZh: zhMotion,
          firstFrameZh: zhFirst,
          lastFrameZh: zhLast,
          contentEn: enFull,
          motionEn: enMotion,
          firstFrameEn: enFirst,
          lastFrameEn: enLast,
        };
      };

      if (blocks.length === 0) {
        if (text.trim()) {
          const parsed = parseBilingual(text);
          results.push({
            id: uid(),
            content: text.trim(),
            contentZh: parsed.contentZh || text.trim(),
            contentEn: parsed.contentEn || text.trim(),
            motionZh: parsed.motionZh,
            firstFrameZh: parsed.firstFrameZh,
            lastFrameZh: parsed.lastFrameZh,
            motionEn: parsed.motionEn,
            firstFrameEn: parsed.firstFrameEn,
            lastFrameEn: parsed.lastFrameEn,
            starred: false
          });
        }
      } else {
        blocks.forEach((block: string) => {
          const content = block.trim();
          if (!content) return;
          const parsed = parseBilingual(content);
          results.push({
            id: uid(),
            content,
            contentZh: parsed.contentZh || content,
            contentEn: parsed.contentEn || content,
            motionZh: parsed.motionZh,
            firstFrameZh: parsed.firstFrameZh,
            lastFrameZh: parsed.lastFrameZh,
            motionEn: parsed.motionEn,
            firstFrameEn: parsed.firstFrameEn,
            lastFrameEn: parsed.lastFrameEn,
            starred: false,
          });
        });
      }

      updateTask(taskId, { status: 'done', results });
    } catch (error: any) {
      console.error('[HookScript] Generation error:', error);
      updateTask(taskId, { status: 'error', error: error.message || '生成失败' });
    }
  }, [getAiInstance, textModel, systemInstruction, getStylePrompt, duration, ideaCount, updateTask]);

  // Regenerate single result
  const regenerateResult = useCallback(async (taskId: string, resultIdx: number) => {
    const task = tasksRef.current.find(t => t.id === taskId);
    if (!task) return;

    // Mark this result as refreshing (replace content with spinner text)
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      const results = [...t.results];
      if (results[resultIdx]) results[resultIdx] = { ...results[resultIdx], content: '⏳ 重新生成中...' };
      return { ...t, results };
    }));

    try {
      const ai = getAiInstance();
      const model = textModel || 'gemini-2.5-flash';

      const imageParts = task.images.map(img => ({
        inlineData: { data: img.data, mimeType: img.mimeType }
      }));

      const otherResults = task.results.filter((_, i) => i !== resultIdx).map(r => r.content).join('\n---\n');

      const prompt = `故事方向: ${task.direction || '请根据图片内容自由发挥'}
风格: ${getStylePrompt() || '自由'}
目标时长: ${duration}秒

以下是已有的其他思路（请不要重复）:
${otherResults || '无'}

请生成1条全新的、与上面不同角度的AI视频描述词。

⚠️ 必须同时提供中文和英文版本！格式：
【中文】
[中文描述词]
【英文】
[English description]`;

      const parts: any[] = [...imageParts, { text: prompt }];

      const response = await ai.models.generateContent({
        model,
        contents: [{ role: 'user', parts }],
        config: { systemInstruction, temperature: 1.0 },
      });

      const text = response?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';

      // Parse bilingual
      const zhMatch = text.match(/【中文】\s*([\s\S]*?)(?=【英文】|$)/);
      const enMatch = text.match(/【英文】\s*([\s\S]*?)$/);
      const zh = zhMatch ? zhMatch[1].trim() : text;
      const en = enMatch ? enMatch[1].trim() : text;

      setTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t;
        const results = [...t.results];
        if (results[resultIdx]) results[resultIdx] = {
          ...results[resultIdx],
          content: text || '(空结果)',
          contentZh: zh || '(空结果)',
          contentEn: en || '(空结果)',
        };
        return { ...t, results };
      }));

      showToast('✅ 已重新生成');
    } catch (error: any) {
      setTasks(prev => prev.map(t => {
        if (t.id !== taskId) return t;
        const results = [...t.results];
        if (results[resultIdx]) results[resultIdx] = { ...results[resultIdx], content: `❌ 重新生成失败: ${error.message}` };
        return { ...t, results };
      }));
    }
  }, [getAiInstance, textModel, systemInstruction, getStylePrompt, duration, showToast]);

  // ========== Batch Control ==========
  const startAll = useCallback(async () => {
    stopRef.current = false;
    setIsRunning(true);

    const idleTasks = tasksRef.current.filter(t => t.status === 'idle' && (t.direction.trim() || t.images.length > 0));
    for (const task of idleTasks) {
      if (stopRef.current) break;
      await generateForTask(task.id);
    }

    setIsRunning(false);
    playCompletionSound();
  }, [generateForTask]);

  const stopAll = useCallback(() => {
    stopRef.current = true;
    setIsRunning(false);
    // Reset processing tasks to idle
    setTasks(prev => prev.map(t => t.status === 'processing' ? { ...t, status: 'idle' } : t));
    showToast('⏸ 已停止');
  }, [showToast]);

  const retryFailed = useCallback(async () => {
    stopRef.current = false;
    setIsRunning(true);

    const failedTasks = tasksRef.current.filter(t => t.status === 'error');
    for (const task of failedTasks) {
      if (stopRef.current) break;
      await generateForTask(task.id);
    }

    setIsRunning(false);
    playCompletionSound();
  }, [generateForTask]);

  const redoAll = useCallback(async () => {
    // Reset all to idle first
    setTasks(prev => prev.map(t => ({ ...t, status: 'idle', results: [], error: undefined })));
    // Then start
    setTimeout(async () => {
      stopRef.current = false;
      setIsRunning(true);

      const allTasks = tasksRef.current.filter(t => t.direction.trim() || t.images.length > 0);
      for (const task of allTasks) {
        if (stopRef.current) break;
        await generateForTask(task.id);
      }

      setIsRunning(false);
      playCompletionSound();
    }, 100);
  }, [generateForTask]);

  // ========== Copy / Export ==========
  // Upload images and get gyazo map
  const uploadGyazoImages = useCallback(async () => {
    showToast('⏳ 正在上传图片到 Gyazo...');
    const uploadPromises: Promise<void>[] = [];
    const gyazoMap: Record<string, string> = {};

    for (const task of tasks) {
      for (const img of task.images) {
        if (img.gyazoUrl) {
          gyazoMap[img.id] = img.gyazoUrl;
        } else {
          uploadPromises.push(
            uploadToGyazo(img.data, img.mimeType).then(url => {
              if (url) {
                gyazoMap[img.id] = url;
                setTasks(prev => prev.map(t => ({
                  ...t,
                  images: t.images.map(i => i.id === img.id ? { ...i, gyazoUrl: url } : i)
                })));
              }
            })
          );
        }
      }
    }

    await Promise.all(uploadPromises);
    return gyazoMap;
  }, [tasks, showToast]);

  // Copy TSV: support 'zh', 'en', 'all' modes
  const copyAsTsv = useCallback(async (lang: 'zh' | 'en' | 'all') => {
    const gyazoMap = await uploadGyazoImages();

    const maxImages = Math.max(...tasks.map(t => t.images.length), 0);
    const maxResults = Math.max(...tasks.map(t => t.results.length), 0);

    // Build header
    const headers: string[] = ['故事方向'];
    for (let i = 0; i < maxImages; i++) headers.push(`图片${i + 1}`);
    if (lang === 'all') {
      for (let i = 0; i < maxResults; i++) headers.push(`中文思路${i + 1}`);
      for (let i = 0; i < maxResults; i++) headers.push(`英文思路${i + 1}`);
    } else {
      const prefix = lang === 'zh' ? '中文' : '英文';
      for (let i = 0; i < maxResults; i++) headers.push(`${prefix}思路${i + 1}`);
    }

    const buildCell = (r: HookResult | undefined, lang: 'zh' | 'en') => {
      if (!r) return '';
      let parts = [];
      if (lang === 'zh') {
        if (r.contentZh) parts.push(`【完整画面】\n${r.contentZh}`);
        if (r.firstFrameZh) parts.push(`【首帧】\n${r.firstFrameZh}`);
        if (r.lastFrameZh) parts.push(`【尾帧】\n${r.lastFrameZh}`);
        if (r.motionZh) parts.push(`【动态运镜】\n${r.motionZh}`);
        return parts.length > 0 ? parts.join('\n\n') : r.contentZh;
      } else {
        if (r.contentEn) parts.push(`【Complete Story】\n${r.contentEn}`);
        if (r.firstFrameEn) parts.push(`【First Frame】\n${r.firstFrameEn}`);
        if (r.lastFrameEn) parts.push(`【Last Frame】\n${r.lastFrameEn}`);
        if (r.motionEn) parts.push(`【Video Motion】\n${r.motionEn}`);
        return parts.length > 0 ? parts.join('\n\n') : r.contentEn;
      }
    };

    const escapeTsvUrl = (text: string) => {
      if (!text) return '';
      if (text.includes('\n') || text.includes('\t') || text.includes('"')) {
        return `"${text.replace(/"/g, '""')}"`;
      }
      return text;
    };

    // Build rows
    const rows: string[] = [headers.join('\t')];
    for (const task of tasks) {
      const cells: string[] = [task.direction];
      for (let i = 0; i < maxImages; i++) {
        const img = task.images[i];
        cells.push(img ? (gyazoMap[img.id] || '') : '');
      }
      if (lang === 'all') {
        for (let i = 0; i < maxResults; i++) cells.push(escapeTsvUrl(buildCell(task.results[i], 'zh')));
        for (let i = 0; i < maxResults; i++) cells.push(escapeTsvUrl(buildCell(task.results[i], 'en')));
      } else {
        for (let i = 0; i < maxResults; i++) cells.push(escapeTsvUrl(buildCell(task.results[i], lang)));
      }
      rows.push(cells.join('\t'));
    }

    const tsv = rows.join('\n');
    await navigator.clipboard.writeText(tsv);
    const langLabel = lang === 'zh' ? '中文' : lang === 'en' ? '英文' : '中英文';
    showToast(`✅ 已复制 ${tasks.length} 条任务（${langLabel}，含 ${Object.keys(gyazoMap).length} 张图片链接）`);
  }, [tasks, showToast, uploadGyazoImages]);

  const copySingleResult = useCallback(async (content: string) => {
    await navigator.clipboard.writeText(content);
    showToast('📋 已复制');
  }, [showToast]);

  // ========== Template ==========
  const applyTemplate = useCallback((template: typeof QUICK_TEMPLATES[0]) => {
    const newTask = createTask();
    newTask.direction = template.direction;
    setTasks(prev => [...prev, newTask]);
    setShowTemplates(false);
    showToast(`📋 已应用模板: ${template.name}`);
  }, [showToast]);

  // ========== Clear All ==========
  const clearAllTasks = useCallback(() => {
    if (!clearConfirm) {
      setClearConfirm(true);
      if (clearTimerRef.current) clearTimeout(clearTimerRef.current);
      clearTimerRef.current = window.setTimeout(() => setClearConfirm(false), 3000);
    } else {
      setTasks([createTask()]);
      setClearConfirm(false);
      showToast('🗑️ 已清空全部任务');
    }
  }, [clearConfirm, showToast]);

  // ========== Presets ==========
  const savePreset = useCallback(() => {
    const name = presetName.trim();
    if (!name) { showToast('⚠️ 请输入预设名称'); return; }
    const preset: HookPreset = {
      id: uid(),
      name,
      style,
      ideaCount,
      duration,
      systemInstruction,
      createdAt: Date.now(),
    };
    setPresets(prev => [preset, ...prev]);
    setPresetName('');
    showToast(`💾 已保存预设「${name}」`);
  }, [presetName, style, ideaCount, duration, systemInstruction, showToast]);

  const loadPreset = useCallback((preset: HookPreset) => {
    setStyle(preset.style);
    setIdeaCount(preset.ideaCount);
    setDuration(preset.duration);
    setSystemInstruction(preset.systemInstruction);
    showToast(`✅ 已加载预设「${preset.name}」`);
    setShowPresets(false);
  }, [showToast]);

  const deletePreset = useCallback((presetId: string) => {
    setPresets(prev => prev.filter(p => p.id !== presetId));
    showToast('🗑️ 已删除预设');
  }, [showToast]);

  // ========== Render ==========
  const idleCount = tasks.filter(t => t.status === 'idle' && (t.direction.trim() || t.images.length > 0)).length;
  const errorCount = tasks.filter(t => t.status === 'error').length;
  const doneCount = tasks.filter(t => t.status === 'done').length;

  return (
    <div className="hook-script-app">
      {/* Header */}
      <div className="hs-header">
        <div className="hs-title">🎬 黄金三秒</div>

        <div className="hs-controls">
          {/* Style */}
          <select className="hs-select" value={style} onChange={e => setStyle(e.target.value)}>
            {STYLE_PRESETS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          {/* Idea count */}
          <select className="hs-select" value={ideaCount} onChange={e => setIdeaCount(parseInt(e.target.value))}>
            {[1,2,3,4,5,6,8,10].map(n => <option key={n} value={n}>{n}条思路</option>)}
          </select>

          {/* Duration */}
          <select className="hs-select" value={duration} onChange={e => setDuration(e.target.value)}>
            {DURATION_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
          </select>

          {/* Templates */}
          <button className="hs-btn hs-btn-ghost" onClick={() => setShowTemplates(true)}>📋 模板</button>

          {/* Presets */}
          <button className="hs-btn hs-btn-ghost" onClick={() => setShowPresets(true)}>💾 预设</button>

          {/* Copy all */}
          <div className="hs-copy-group">
            <button className="hs-btn hs-btn-ghost" onClick={() => copyAsTsv('zh')} disabled={doneCount === 0} title="复制全部中文结果（TSV）">
              🇨🇳 复制中文
            </button>
            <button className="hs-btn hs-btn-ghost" onClick={() => copyAsTsv('en')} disabled={doneCount === 0} title="复制全部英文结果（TSV）">
              🇺🇸 复制英文
            </button>
            <button className="hs-btn hs-btn-ghost" onClick={() => copyAsTsv('all')} disabled={doneCount === 0} title="复制全部中英文结果（TSV）">
              📊 复制全部
            </button>
          </div>

          {/* Status badges */}
          {idleCount > 0 && <span className="hs-badge">⏳ 待处理 {idleCount}</span>}
          {errorCount > 0 && <span className="hs-badge" style={{ color: '#ef4444' }}>❌ 失败 {errorCount}</span>}
          {doneCount > 0 && <span className="hs-badge" style={{ color: '#10b981' }}>✅ 完成 {doneCount}</span>}

          {/* Clear button */}
          <button 
            className={`hs-btn ${clearConfirm ? 'hs-btn-danger' : 'hs-btn-ghost'}`}
            onClick={clearAllTasks} 
            disabled={tasks.length === 1 && tasks[0].status === 'idle' && !tasks[0].direction && tasks[0].images.length === 0}
            title={clearConfirm ? "此操作不可撤销" : "清空所有任务"}
          >
            {clearConfirm ? '⚠️ 再次点击确认清空' : '🗑️ 清空全部'}
          </button>

          {/* Control buttons */}
          {!isRunning ? (
            <button className="hs-btn hs-btn-primary" onClick={startAll} disabled={idleCount === 0}>
              ▶ 开始 {idleCount > 0 ? `(${idleCount})` : ''}
            </button>
          ) : (
            <button className="hs-btn hs-btn-danger" onClick={stopAll}>⏹ 停止</button>
          )}

          {errorCount > 0 && !isRunning && (
            <button className="hs-btn hs-btn-secondary" onClick={retryFailed}>🔄 重试失败({errorCount})</button>
          )}

          {doneCount > 0 && !isRunning && (
            <button className="hs-btn hs-btn-secondary" onClick={redoAll}>🔁 全部重做</button>
          )}
        </div>
      </div>

      {/* System Instruction */}
      <div className="hs-system-instruction">
        <div className="hs-system-toggle" onClick={() => setShowSystem(!showSystem)}>
          {showSystem ? '▾' : '▸'} 系统指令
          <span style={{ fontSize: '0.6rem', color: '#52525b', marginLeft: 4 }}>
            (全局 AI 角色与规则)
          </span>
        </div>
        {showSystem && (
          <textarea
            className="hs-system-textarea"
            value={systemInstruction}
            onChange={e => setSystemInstruction(e.target.value)}
            placeholder="定义 AI 的角色和输出规则..."
            rows={6}
          />
        )}
      </div>

      {/* Tasks */}
      <div className="hs-tasks-container">
        {tasks.map((task, taskIdx) => (
          <div
            key={task.id}
            className={`hs-task-card ${task.status} ${dragOverTaskId === task.id ? 'drag-highlight' : ''} ${activeTaskId === task.id ? 'active-task' : ''}`}
            onClick={() => setActiveTaskId(task.id)}
            onDragOver={e => { e.preventDefault(); }}
            onDragEnter={e => handleTaskDragEnter(e, task.id)}
            onDragLeave={e => handleTaskDragLeave(e, task.id)}
            onDrop={e => handleFileDrop(e, task.id)}
          >
            {/* Task Header */}
            <div className="hs-task-header">
              <button
                className="hs-task-collapse-btn"
                onClick={(e) => { e.stopPropagation(); setCollapsedTasks(prev => { const next = new Set(prev); next.has(task.id) ? next.delete(task.id) : next.add(task.id); return next; }); }}
                title={collapsedTasks.has(task.id) ? '展开' : '折叠'}
              >{collapsedTasks.has(task.id) ? '▸' : '▾'}</button>
              <span className="hs-task-number">#{taskIdx + 1}</span>
              {collapsedTasks.has(task.id) ? (
                <span className="hs-task-direction-preview" onClick={(e) => { e.stopPropagation(); setCollapsedTasks(prev => { const next = new Set(prev); next.delete(task.id); return next; }); }}>
                  {task.direction || '(空)'}
                  {task.images.length > 0 && <span className="hs-collapsed-badge">📷{task.images.length}</span>}
                  {task.results.length > 0 && <span className="hs-collapsed-badge">📝{task.results.length}</span>}
                </span>
              ) : (
                <input
                  className="hs-task-direction"
                  value={task.direction}
                  onChange={e => updateTask(task.id, { direction: e.target.value })}
                  placeholder="输入故事方向或创意描述..."
                />
              )}
              <span className={`hs-task-status ${task.status}`}>
                {task.status === 'idle' && '⏳ 待处理'}
                {task.status === 'processing' && <><span className="hs-spinner" /> 生成中</>}
                {task.status === 'done' && '✅ 已完成'}
                {task.status === 'error' && '❌ 失败'}
              </span>
              <div className="hs-task-actions">
                {/* Single task generate */}
                {task.status !== 'processing' && (
                  <button
                    className="hs-task-action-btn start-btn"
                    onClick={() => generateForTask(task.id)}
                    title="生成此任务"
                  >▶ 生成</button>
                )}
                {/* Delete */}
                {tasks.length > 1 && (
                  <button
                    className="hs-task-action-btn danger"
                    onClick={() => removeTask(task.id)}
                    title="删除任务"
                  >✕</button>
                )}
              </div>
            </div>

            {/* Collapsible content */}
            {!collapsedTasks.has(task.id) && <>
            {/* Image Strip */}
            <div className="hs-image-section">
              {task.images.length > 0 ? (
                <div className="hs-image-strip">
                  {task.images.map((img, imgIdx) => (
                    <React.Fragment key={img.id}>
                      {imgIdx > 0 && <span className="hs-image-arrow">→</span>}
                      <div
                        className={`hs-image-thumb ${dragState?.imageId === img.id ? 'dragging' : ''} ${dragOverImage === img.id ? 'drag-over' : ''}`}
                        draggable
                        onDragStart={() => handleDragStart(task.id, img.id)}
                        onDragOver={e => handleDragOver(e, img.id)}
                        onDrop={e => { e.preventDefault(); e.stopPropagation(); handleDrop(task.id, img.id); }}
                        onDragEnd={handleDragEnd}
                      >
                        <img src={`data:${img.mimeType};base64,${img.data}`} alt={img.name} />
                        <span className="hs-image-order">{imgIdx + 1}</span>
                        <button
                          className="hs-image-remove"
                          onClick={() => removeImage(task.id, img.id)}
                        >✕</button>
                      </div>
                    </React.Fragment>
                  ))}
                  <button
                    className="hs-image-add-btn"
                    onClick={() => handlePasteForTask(task.id)}
                    onDoubleClick={() => fileInputRefs.current[task.id]?.click()}
                    title="单击粘贴图片 / 双击选择文件"
                  >+</button>
                </div>
              ) : (
                <div
                  className={`hs-dropzone ${dragOverTaskId === task.id ? 'drag-active' : ''} ${activeTaskId === task.id ? 'active' : ''}`}
                  onClick={() => { setActiveTaskId(task.id); handlePasteForTask(task.id); }}
                  onDoubleClick={() => fileInputRefs.current[task.id]?.click()}
                >
                  {activeTaskId === task.id
                    ? '✅ 已选中 — 直接 Ctrl+V 粘贴图片，或双击选择文件'
                    : '📷 单击粘贴图片（支持谷歌表格），双击选择文件，或直接拖入'}
                </div>
              )}
              <input
                ref={el => { fileInputRefs.current[task.id] = el; }}
                type="file"
                accept="image/*"
                multiple
                style={{ display: 'none' }}
                onChange={e => {
                  if (e.target.files?.length) {
                    handleAddImages(task.id, e.target.files);
                    e.target.value = '';
                  }
                }}
              />
            </div>

            {/* Error */}
            {task.error && (
              <div style={{ padding: '4px 12px 8px', fontSize: '0.7rem', color: '#ef4444' }}>
                ⚠️ {task.error}
              </div>
            )}

            {/* Results */}
            {task.results.length > 0 && (
              <div className="hs-results">
                <div className="hs-results-header">
                  <span className="hs-results-label">📝 生成结果 ({task.results.length})</span>
                  <div style={{ display: 'flex', gap: '4px' }}>
                    <button
                      className="hs-btn hs-btn-ghost"
                      style={{ fontSize: '0.6rem', padding: '2px 6px' }}
                      onClick={() => {
                        const text = task.results.map((r, i) => `思路${i+1}: ${r.contentZh}`).join('\n\n');
                        navigator.clipboard.writeText(text);
                        showToast('📋 已复制全部中文');
                      }}
                    >🇨🇳 中文</button>
                    <button
                      className="hs-btn hs-btn-ghost"
                      style={{ fontSize: '0.6rem', padding: '2px 6px' }}
                      onClick={() => {
                        const text = task.results.map((r, i) => `Idea${i+1}: ${r.contentEn}`).join('\n\n');
                        navigator.clipboard.writeText(text);
                        showToast('📋 已复制全部英文');
                      }}
                    >🇺🇸 英文</button>
                    <button
                      className="hs-btn hs-btn-ghost"
                      style={{ fontSize: '0.6rem', padding: '2px 6px' }}
                      onClick={() => {
                        const text = task.results.map((r, i) => `思路${i+1}:\n【中文】${r.contentZh}\n【英文】${r.contentEn}`).join('\n\n');
                        navigator.clipboard.writeText(text);
                        showToast('📋 已复制全部');
                      }}
                    >📋 全部</button>
                  </div>
                </div>
                {task.results.map((result, rIdx) => (
                  <div key={result.id} className="hs-result-card">
                    <div className="hs-result-card-header">
                      <span className="hs-result-label">思路{rIdx + 1}</span>
                      <div className="hs-result-actions">
                        <button
                          className="hs-result-btn"
                          onClick={() => {
                            let text = '';
                            if (result.contentZh) text += `【完整画面】\n${result.contentZh}\n\n`;
                            if (result.firstFrameZh) text += `【首帧】\n${result.firstFrameZh}\n\n`;
                            if (result.lastFrameZh) text += `【尾帧】\n${result.lastFrameZh}\n\n`;
                            if (result.motionZh) text += `【动态】\n${result.motionZh}\n\n`;
                            copySingleResult(text.trim() || result.contentZh);
                          }}
                          title="复制中文全部(完整/首尾/动态)"
                        >🇨🇳</button>
                        <button
                          className="hs-result-btn"
                          onClick={() => {
                            let text = '';
                            if (result.contentEn) text += `【Complete】\n${result.contentEn}\n\n`;
                            if (result.firstFrameEn) text += `【First】\n${result.firstFrameEn}\n\n`;
                            if (result.lastFrameEn) text += `【Last】\n${result.lastFrameEn}\n\n`;
                            if (result.motionEn) text += `【Motion】\n${result.motionEn}\n\n`;
                            copySingleResult(text.trim() || result.contentEn);
                          }}
                          title="复制英文全部(完整/首尾/动态)"
                        >🇺🇸</button>
                        <button
                          className={`hs-result-btn ${result.starred ? 'starred' : ''}`}
                          onClick={() => toggleStar(task.id, result.id)}
                          title="收藏"
                        >{result.starred ? '⭐' : '☆'}</button>
                        <button
                          className="hs-result-btn"
                          onClick={() => regenerateResult(task.id, rIdx)}
                          title="重新生成此条"
                        >🔄</button>
                      </div>
                    </div>
                    <div className="hs-result-unified">
                      {/* Complete Story */}
                      <div className="hs-result-frame-block">
                        <span className="hs-frame-label" style={{ color: '#d4d4d8' }}>📝 完整画面描述</span>
                        <div className="hs-result-text">{result.contentZh}</div>
                        {result.contentEn && <div className="hs-result-text en">{result.contentEn}</div>}
                      </div>

                      {/* First Frame */}
                      {(result.firstFrameZh || result.firstFrameEn) && (
                        <div className="hs-result-frame-block">
                          <span className="hs-frame-label">📷 首帧起手</span>
                          {result.firstFrameZh && <div className="hs-result-text">{result.firstFrameZh}</div>}
                          {result.firstFrameEn && <div className="hs-result-text en">{result.firstFrameEn}</div>}
                        </div>
                      )}

                      {/* Last Frame */}
                      {(result.lastFrameZh || result.lastFrameEn) && (
                        <div className="hs-result-frame-block">
                          <span className="hs-frame-label">🌅 尾帧落幅</span>
                          {result.lastFrameZh && <div className="hs-result-text">{result.lastFrameZh}</div>}
                          {result.lastFrameEn && <div className="hs-result-text en">{result.lastFrameEn}</div>}
                        </div>
                      )}

                      {/* Video Motion */}
                      {(result.motionZh || result.motionEn) && (
                        <div className="hs-result-frame-block">
                          <span className="hs-frame-label">🎬 运镜与动态</span>
                          {result.motionZh && <div className="hs-result-text">{result.motionZh}</div>}
                          {result.motionEn && <div className="hs-result-text en">{result.motionEn}</div>}
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
            </>}
          </div>
        ))}

        {/* Add Task Button */}
        <button className="hs-add-task-btn" onClick={addTask}>
          ➕ 添加新任务
        </button>
      </div>

      {/* Template Modal */}
      {showTemplates && (
        <div className="hs-modal-overlay" onClick={() => setShowTemplates(false)}>
          <div className="hs-modal" onClick={e => e.stopPropagation()}>
            <h3>📋 快速模板</h3>
            {QUICK_TEMPLATES.map((tpl, i) => (
              <div key={i} className="hs-template-item" onClick={() => applyTemplate(tpl)}>
                <div className="hs-template-name">{tpl.name}</div>
                <div className="hs-template-desc">{tpl.direction}</div>
              </div>
            ))}
            <button
              className="hs-btn hs-btn-ghost"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setShowTemplates(false)}
            >关闭</button>
          </div>
        </div>
      )}

      {/* Presets Modal */}
      {showPresets && (
        <div className="hs-modal-overlay" onClick={() => setShowPresets(false)}>
          <div className="hs-modal hs-presets-modal" onClick={e => e.stopPropagation()}>
            <h3>💾 预设管理</h3>
            <p className="hs-preset-desc">保存当前的风格、思路数、时长和系统指令配置</p>

            {/* Save new preset */}
            <div className="hs-preset-save-row">
              <input
                className="hs-preset-name-input"
                value={presetName}
                onChange={e => setPresetName(e.target.value)}
                placeholder="输入预设名称..."
                onKeyDown={e => e.key === 'Enter' && savePreset()}
              />
              <button className="hs-btn hs-btn-primary" onClick={savePreset} style={{ whiteSpace: 'nowrap' }}>
                💾 保存当前配置
              </button>
            </div>

            {/* Current config summary */}
            <div className="hs-preset-current">
              <span>当前配置:</span>
              <span className="hs-preset-tag">{STYLE_PRESETS.find(s => s.value === style)?.label || style}</span>
              <span className="hs-preset-tag">{ideaCount}条思路</span>
              <span className="hs-preset-tag">{duration}秒</span>
            </div>

            {/* Preset list */}
            {presets.length === 0 ? (
              <div className="hs-preset-empty">还没有保存的预设，点击上方按钮保存当前配置</div>
            ) : (
              <div className="hs-preset-list">
                {presets.map(p => (
                  <div key={p.id} className="hs-preset-item">
                    <div className="hs-preset-item-info" onClick={() => loadPreset(p)}>
                      <div className="hs-preset-item-name">{p.name}</div>
                      <div className="hs-preset-item-meta">
                        <span className="hs-preset-tag sm">{STYLE_PRESETS.find(s => s.value === p.style)?.label || p.style}</span>
                        <span className="hs-preset-tag sm">{p.ideaCount}条思路</span>
                        <span className="hs-preset-tag sm">{p.duration}秒</span>
                        <span className="hs-preset-item-date">{new Date(p.createdAt).toLocaleDateString()}</span>
                      </div>
                    </div>
                    <button className="hs-preset-delete" onClick={() => deletePreset(p.id)} title="删除">✕</button>
                  </div>
                ))}
              </div>
            )}

            <button
              className="hs-btn hs-btn-ghost"
              style={{ width: '100%', marginTop: 8 }}
              onClick={() => setShowPresets(false)}
            >关闭</button>
          </div>
        </div>
      )}

      {/* Toast */}
      {toast && <div className="hs-toast">{toast}</div>}
    </div>
  );
};

export default HookScriptApp;
