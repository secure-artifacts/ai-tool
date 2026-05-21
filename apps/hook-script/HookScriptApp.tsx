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
  storyOutlineZh?: string;
  storyboardZh?: string;
  shotPromptsZh?: string[];
  shotPromptsEn?: string[];
  motionZh?: string;     // 选填：视频动态(中文)
  motionEn?: string;     // 选填：视频动态(英文)
  firstFrameZh?: string; // 选填：首帧(中文)
  lastFrameZh?: string;  // 选填：尾帧(中文)
  firstFrameEn?: string; // 选填：首帧(英文)
  lastFrameEn?: string;  // 选填：尾帧(英文)
  shots?: StoryShot[];
  characterAnchorZh?: string;
  characterAnchorEn?: string;
  visualTone?: string;
  starred: boolean;
}

interface StoryShot {
  shotNumber: number;
  shotType: string;
  cameraMove: string;
  angle: string;
  duration: string;
  transition: string;
  sceneDescZh: string;
  promptZh: string;
  promptEn: string;
  motionDescZh: string;
  motionDescEn: string;
  audio: string;
  text: string;
  emotionIntensity: number;
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
const STORYBOARD_BRIDGE_KEY = 'vkf_storyboard_bridge_v1';
const STORYBOARD_BRIDGE_EVENT = 'vkf-storyboard-bridge';

const DURATION_OPTIONS = [
  { value: '3', label: '3秒' },
  { value: '5', label: '5秒' },
  { value: '10', label: '10秒' },
  { value: '15', label: '15秒' },
  { value: '30', label: '30秒' },
  { value: '45', label: '45秒' },
  { value: '60', label: '60秒' },
  { value: '90', label: '90秒' },
  { value: '120', label: '2分钟' },
  { value: 'custom', label: '✏️ 自定义' },
];

const SHOT_COUNT_OPTIONS = [
  { value: 3, label: '3镜头' },
  { value: 4, label: '4镜头' },
  { value: 5, label: '5镜头' },
  { value: 6, label: '6镜头' },
  { value: 8, label: '8镜头' },
  { value: 10, label: '10镜头' },
  { value: 12, label: '12镜头' },
  { value: 15, label: '15镜头' },
  { value: -1, label: '✏️ 自定义' },
];

const ASPECT_RATIO_OPTIONS = [
  { value: '9:16', label: '9:16 竖屏' },
  { value: '16:9', label: '16:9 横屏' },
  { value: '1:1', label: '1:1 方形' },
  { value: '4:5', label: '4:5 Feed' },
];

const STORY_SYSTEM_INSTRUCTION = `你是一位资深短视频导演和视觉叙事专家，精通三幕结构（建置→对抗→解决）、视觉节奏控制、声画关系和景别语法。

你的核心能力：
1. 将抽象故事概念转化为可执行的逐镜分镜脚本
2. 为每个镜头生成高度详细、具体的AI生图提示词（必须包含：人物外貌细节、服装材质颜色、具体场景环境、光线方向与色温、镜头焦段、景深效果）
3. 控制跨镜头的视觉一致性（角色外观、色调、光线统一）
4. 设计情绪节奏曲线：开场钩子→铺垫→冲突高潮→情感落点
5. 理解不同画面比例对构图的影响
6. 为每个镜头撰写可直接喂给AI动画/视频工具（如Runway、Kling、Pika）的动态描述

视觉风格硬性要求：
- 所有画面必须是真实电影摄影风格（cinematic photography），不允许插画、卡通、动画、3D渲染风格
- 提示词中必须包含：真实摄影、电影质感、自然光线/专业灯光、浅景深、胶片色调等电影关键词
- 每条promptEn必须以"Cinematic photography,"或"Photorealistic,"开头

提示词详细度要求（最重要）：
- 每条promptZh/promptEn不得少于80字/40词
- 必须具体描述：人物（年龄/肤色/发型/服装材质颜色/表情/动作/肢体语言）
- 必须具体描述：环境（室内/室外/具体地点/天气/时间段/背景物体）
- 必须具体描述：摄影参数（焦段如85mm/35mm、光圈如f/1.4、景深、光线方向如逆光/侧光/伦勃朗光）
- 必须具体描述：色调氛围（暖橘/冷蓝/低饱和/高对比/胶片颗粒感）

动画描述要求（motionDescZh/motionDescEn）：
- 用于直接输入AI视频/动画生成工具（Runway Gen-3, Kling, Pika等）
- 必须描述：主体运动（人物动作轨迹、速度、幅度）+ 镜头运动（推拉摇移的方向速度）
- 格式示例："女人缓缓抬头，目光从地面移向窗外，同时镜头从近景慢推到特写，3秒"

专业规范：
- 景别遵循「远→近→特写」或「特写→拉开」的叙事逻辑
- 相邻镜头不重复相同景别（除非刻意设计）
- 运镜服务于情绪，非炫技
- 声画关系清晰，每个镜头都有明确的声音设计
- 转场方式与节奏匹配（快节奏=硬切为主，慢节奏=溶解/淡出）
- 不要科幻，不要超能力，不要黑暗恐惧，不要幼稚口吻
- 必须符合现实认知，人物像真实成年人`;

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

const MIN_DURATION_SECONDS = 1;
const MAX_DURATION_SECONDS = 300;
const MIN_STORY_SHOTS = 1;
const MAX_STORY_SHOTS = 20;

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

const clampInteger = (value: number, min: number, max: number) => {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, Math.round(value)));
};

const parseJsonFromText = (text: string) => {
  const arrayMatch = text.match(/\[[\s\S]*\]/);
  if (arrayMatch) return JSON.parse(arrayMatch[0]);
  const objMatch = text.match(/\{[\s\S]*\}/);
  if (objMatch) return JSON.parse(objMatch[0]);
  throw new Error('返回内容中未找到 JSON');
};

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
  const [duration, setDuration] = useState(() => {
    const saved = parseInt(localStorage.getItem('hook_script_duration') || '3', 10);
    return String(clampInteger(saved, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS));
  });
  const [generationMode, setGenerationMode] = useState<'hook' | 'story'>(
    () => (localStorage.getItem('hook_script_generation_mode') as 'hook' | 'story') || 'hook'
  );
  const [storyShotCount, setStoryShotCount] = useState(() => {
    const saved = parseInt(localStorage.getItem('hook_script_story_shot_count') || '6', 10);
    return clampInteger(saved, MIN_STORY_SHOTS, MAX_STORY_SHOTS);
  });
  const [storyPace, setStoryPace] = useState<'快' | '中' | '慢'>(
    () => (localStorage.getItem('hook_script_story_pace') as '快' | '中' | '慢') || '中'
  );
  const [coreMessage, setCoreMessage] = useState(() => localStorage.getItem('hook_script_core_message') || '');
  const [faithTone, setFaithTone] = useState<'隐性' | '中性' | '明确'>(
    () => (localStorage.getItem('hook_script_faith_tone') as '隐性' | '中性' | '明确') || '中性'
  );
  const [endingStyle, setEndingStyle] = useState<'留白' | '金句' | '祷告' | '提问'>(
    () => (localStorage.getItem('hook_script_ending_style') as '留白' | '金句' | '祷告' | '提问') || '金句'
  );
  const [aspectRatio, setAspectRatio] = useState(() => localStorage.getItem('hook_script_aspect_ratio') || '9:16');
  const [characterAnchor, setCharacterAnchor] = useState(() => localStorage.getItem('hook_script_character_anchor') || '');
  const [visualToneInput, setVisualToneInput] = useState(() => localStorage.getItem('hook_script_visual_tone') || '');
  const [showCharacterPanel, setShowCharacterPanel] = useState(false);
  // Structured character settings
  const [charSettings, setCharSettings] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('hook_script_char_settings') || '{}'); } catch { return {}; }
  });
  const [sceneSettings, setSceneSettings] = useState<Record<string, string>>(() => {
    try { return JSON.parse(localStorage.getItem('hook_script_scene_settings') || '{}'); } catch { return {}; }
  });
  const [refineInputs, setRefineInputs] = useState<Record<string, string>>({});
  const [refiningId, setRefiningId] = useState<string | null>(null);
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
  useEffect(() => { localStorage.setItem('hook_script_generation_mode', generationMode); }, [generationMode]);
  useEffect(() => { localStorage.setItem('hook_script_story_shot_count', String(storyShotCount)); }, [storyShotCount]);
  useEffect(() => { localStorage.setItem('hook_script_story_pace', storyPace); }, [storyPace]);
  useEffect(() => { localStorage.setItem('hook_script_core_message', coreMessage); }, [coreMessage]);
  useEffect(() => { localStorage.setItem('hook_script_faith_tone', faithTone); }, [faithTone]);
  useEffect(() => { localStorage.setItem('hook_script_ending_style', endingStyle); }, [endingStyle]);
  useEffect(() => { localStorage.setItem('hook_script_aspect_ratio', aspectRatio); }, [aspectRatio]);
  useEffect(() => { localStorage.setItem('hook_script_character_anchor', characterAnchor); }, [characterAnchor]);
  useEffect(() => { localStorage.setItem('hook_script_visual_tone', visualToneInput); }, [visualToneInput]);
  useEffect(() => { try { localStorage.setItem('hook_script_char_settings', JSON.stringify(charSettings)); } catch {} }, [charSettings]);
  useEffect(() => { try { localStorage.setItem('hook_script_scene_settings', JSON.stringify(sceneSettings)); } catch {} }, [sceneSettings]);
  useEffect(() => {
    try { localStorage.setItem('hook_script_presets', JSON.stringify(presets)); } catch {}
  }, [presets]);

  // Auto-build character anchor from structured settings
  const buildCharacterAnchor = useCallback(() => {
    const c = charSettings;
    const s = sceneSettings;
    const charParts: string[] = [];
    if (c.gender) charParts.push(c.gender);
    if (c.ageRange) charParts.push(c.ageRange);
    if (c.country) charParts.push(c.country);
    if (c.ethnicity) charParts.push(c.ethnicity);
    if (c.skinTone) charParts.push(`${c.skinTone}肤色`);
    if (c.hairStyle) charParts.push(c.hairStyle);
    if (c.clothing) charParts.push(c.clothing);
    if (c.bodyType) charParts.push(c.bodyType);
    if (c.expression) charParts.push(c.expression);
    if (c.props) charParts.push(`道具:${c.props}`);
    if (c.extra) charParts.push(c.extra);
    const sceneParts: string[] = [];
    if (s.locationType) sceneParts.push(s.locationType);
    if (s.specificLocation) sceneParts.push(s.specificLocation);
    if (s.timeOfDay) sceneParts.push(s.timeOfDay);
    if (s.weather) sceneParts.push(s.weather);
    if (s.season) sceneParts.push(s.season);
    if (s.sceneProps) sceneParts.push(s.sceneProps);
    if (s.extra) sceneParts.push(s.extra);
    const anchor = charParts.join(',');
    const scene = sceneParts.length > 0 ? `\n场景设定: ${sceneParts.join(',')}` : '';
    setCharacterAnchor(anchor + scene);
  }, [charSettings, sceneSettings]);

  const updateCharField = useCallback((field: string, value: string) => {
    setCharSettings(prev => ({ ...prev, [field]: value }));
  }, []);
  const updateSceneField = useCallback((field: string, value: string) => {
    setSceneSettings(prev => ({ ...prev, [field]: value }));
  }, []);

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

  // ========== Shot-level Editing (ShotKraft-style: AI is starting point, user has full creative control) ==========
  const updateShotField = useCallback((taskId: string, resultId: string, shotIdx: number, field: keyof StoryShot, value: string | number) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        results: t.results.map(r => {
          if (r.id !== resultId || !r.shots) return r;
          const newShots = [...r.shots];
          newShots[shotIdx] = { ...newShots[shotIdx], [field]: value };
          // Also sync shotPrompts arrays for backward compat
          const shotPromptsZh = newShots.map(s => s.promptZh);
          const shotPromptsEn = newShots.map(s => s.promptEn);
          return { ...r, shots: newShots, shotPromptsZh, shotPromptsEn };
        })
      };
    }));
  }, []);

  const deleteShot = useCallback((taskId: string, resultId: string, shotIdx: number) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        results: t.results.map(r => {
          if (r.id !== resultId || !r.shots || r.shots.length <= 1) return r;
          const newShots = r.shots.filter((_, i) => i !== shotIdx).map((s, i) => ({ ...s, shotNumber: i + 1 }));
          return { ...r, shots: newShots, shotPromptsZh: newShots.map(s => s.promptZh), shotPromptsEn: newShots.map(s => s.promptEn) };
        })
      };
    }));
    showToast('🗑️ 已删除镜头');
  }, [showToast]);

  const insertShot = useCallback((taskId: string, resultId: string, afterIdx: number) => {
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        results: t.results.map(r => {
          if (r.id !== resultId || !r.shots) return r;
          const newShot: StoryShot = {
            shotNumber: afterIdx + 2,
            shotType: '中景', cameraMove: '固定', angle: '平视',
            duration: '3s', transition: '硬切',
            sceneDescZh: '', promptZh: '', promptEn: '',
            motionDescZh: '', motionDescEn: '',
            audio: '', text: '', emotionIntensity: 5,
          };
          const newShots = [...r.shots];
          newShots.splice(afterIdx + 1, 0, newShot);
          const renumbered = newShots.map((s, i) => ({ ...s, shotNumber: i + 1 }));
          return { ...r, shots: renumbered, shotPromptsZh: renumbered.map(s => s.promptZh), shotPromptsEn: renumbered.map(s => s.promptEn) };
        })
      };
    }));
    showToast('➕ 已插入新镜头');
  }, [showToast]);

  const reorderShot = useCallback((taskId: string, resultId: string, fromIdx: number, toIdx: number) => {
    if (fromIdx === toIdx) return;
    setTasks(prev => prev.map(t => {
      if (t.id !== taskId) return t;
      return {
        ...t,
        results: t.results.map(r => {
          if (r.id !== resultId || !r.shots) return r;
          const newShots = [...r.shots];
          const [moved] = newShots.splice(fromIdx, 1);
          newShots.splice(toIdx, 0, moved);
          const renumbered = newShots.map((s, i) => ({ ...s, shotNumber: i + 1 }));
          return { ...r, shots: renumbered, shotPromptsZh: renumbered.map(s => s.promptZh), shotPromptsEn: renumbered.map(s => s.promptEn) };
        })
      };
    }));
  }, []);

  // ========== Refinement Chat (continue conversation to modify script) ==========
  const refineForResult = useCallback(async (taskId: string, resultId: string, instruction: string) => {
    if (!instruction.trim()) return;
    const task = tasksRef.current.find(t => t.id === taskId);
    const result = task?.results.find(r => r.id === resultId);
    if (!result?.shots) return;

    setRefiningId(resultId);
    try {
      const ai = getAiInstance();
      const model = textModel || 'gemini-2.5-flash';
      const chat = ai.chats.create({ model, config: { systemInstruction: STORY_SYSTEM_INSTRUCTION } });

      // First message: provide current script as context
      const currentScript = JSON.stringify({
        storyOutlineZh: result.storyboardZh || result.contentZh,
        characterAnchorZh: result.characterAnchorZh,
        visualTone: result.visualTone,
        shots: result.shots,
      }, null, 2);

      await chat.sendMessage({ message: `这是我当前的分镜脚本，请记住它：\n${currentScript}` });

      // Second message: user's refinement instruction
      const response = await chat.sendMessage({
        message: `请根据以下修改指令，更新分镜脚本。保持JSON格式返回完整的shots数组（与原格式完全一致）。

修改指令：${instruction}

要求：
- 只返回修改后的完整 shots JSON 数组，不要其他内容
- 保持所有字段结构不变（shotNumber, shotType, cameraMove, angle, duration, transition, sceneDescZh, promptZh, promptEn, motionDescZh, motionDescEn, audio, text, emotionIntensity）
- 每条promptZh不少于80字，promptEn不少于40词
- 所有promptEn以Cinematic photography开头
- 不要输出markdown，不要解释`
      });

      const text = typeof response === 'string' ? response : (response as any)?.text || '';
      // Parse the returned JSON
      const jsonMatch = text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        if (Array.isArray(parsed) && parsed.length > 0) {
          const newShots: StoryShot[] = parsed.map((s: any, idx: number) => ({
            shotNumber: s.shotNumber || idx + 1,
            shotType: s.shotType || '', cameraMove: s.cameraMove || '', angle: s.angle || '',
            duration: s.duration || '', transition: s.transition || '',
            sceneDescZh: s.sceneDescZh || '', promptZh: s.promptZh || '', promptEn: s.promptEn || '',
            motionDescZh: s.motionDescZh || '', motionDescEn: s.motionDescEn || '',
            audio: s.audio || '', text: s.text || '', emotionIntensity: parseInt(s.emotionIntensity) || 5,
          }));
          setTasks(prev => prev.map(t => {
            if (t.id !== taskId) return t;
            return { ...t, results: t.results.map(r => {
              if (r.id !== resultId) return r;
              return { ...r, shots: newShots, shotPromptsZh: newShots.map(s => s.promptZh), shotPromptsEn: newShots.map(s => s.promptEn) };
            })};
          }));
          showToast('✅ 脚本已更新');
        }
      }
    } catch (err: any) {
      showToast(`❌ 修改失败: ${err.message?.slice(0, 50)}`);
    } finally {
      setRefiningId(null);
      setRefineInputs(prev => ({ ...prev, [resultId]: '' }));
    }
  }, [getAiInstance, textModel, showToast]);

  // Refine a single shot via chat
  const refineSingleShot = useCallback(async (taskId: string, resultId: string, shotIdx: number, instruction: string) => {
    if (!instruction.trim()) return;
    const task = tasksRef.current.find(t => t.id === taskId);
    const result = task?.results.find(r => r.id === resultId);
    const shot = result?.shots?.[shotIdx];
    if (!shot) return;

    const shotKey = `${resultId}-${shotIdx}`;
    setRefiningId(shotKey);
    try {
      const ai = getAiInstance();
      const model = textModel || 'gemini-2.5-flash';
      const chat = ai.chats.create({ model, config: { systemInstruction: STORY_SYSTEM_INSTRUCTION } });

      const shotJson = JSON.stringify(shot, null, 2);
      await chat.sendMessage({ message: `这是我当前的单个镜头数据，请记住它：\n${shotJson}` });

      const response = await chat.sendMessage({
        message: `请根据以下修改指令，更新这个镜头。返回修改后的完整JSON对象（与原格式完全一致）。

修改指令：${instruction}

要求：
- 只返回修改后的单个镜头JSON对象，不要数组，不要其他内容
- 保持所有字段结构不变
- promptZh不少于80字，promptEn不少于40词，以Cinematic photography开头
- 真实电影摄影风格
- 不要输出markdown`
      });

      const text = typeof response === 'string' ? response : (response as any)?.text || '';
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (jsonMatch) {
        const parsed = JSON.parse(jsonMatch[0]);
        const updatedShot: StoryShot = {
          shotNumber: shot.shotNumber,
          shotType: parsed.shotType || shot.shotType,
          cameraMove: parsed.cameraMove || shot.cameraMove,
          angle: parsed.angle || shot.angle,
          duration: parsed.duration || shot.duration,
          transition: parsed.transition || shot.transition,
          sceneDescZh: parsed.sceneDescZh || shot.sceneDescZh,
          promptZh: parsed.promptZh || shot.promptZh,
          promptEn: parsed.promptEn || shot.promptEn,
          motionDescZh: parsed.motionDescZh || shot.motionDescZh,
          motionDescEn: parsed.motionDescEn || shot.motionDescEn,
          audio: parsed.audio || shot.audio,
          text: parsed.text ?? shot.text,
          emotionIntensity: parseInt(parsed.emotionIntensity) || shot.emotionIntensity,
        };
        setTasks(prev => prev.map(t => {
          if (t.id !== taskId) return t;
          return { ...t, results: t.results.map(r => {
            if (r.id !== resultId || !r.shots) return r;
            const newShots = [...r.shots];
            newShots[shotIdx] = updatedShot;
            return { ...r, shots: newShots, shotPromptsZh: newShots.map(s => s.promptZh), shotPromptsEn: newShots.map(s => s.promptEn) };
          })};
        }));
        showToast(`✅ 镜头 #${shot.shotNumber} 已更新`);
      }
    } catch (err: any) {
      showToast(`❌ 修改失败: ${err.message?.slice(0, 50)}`);
    } finally {
      setRefiningId(null);
      setRefineInputs(prev => ({ ...prev, [shotKey]: '' }));
    }
  }, [getAiInstance, textModel, showToast]);

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

  const normalizeDuration = useCallback((value: string) => {
    const numeric = parseInt(value, 10);
    return String(clampInteger(numeric, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS));
  }, []);

  const normalizeStoryShotCount = useCallback((value: string | number) => {
    const numeric = typeof value === 'number' ? value : parseInt(value, 10);
    return clampInteger(numeric, MIN_STORY_SHOTS, MAX_STORY_SHOTS);
  }, []);

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
      const normalizedDuration = normalizeDuration(duration);
      const normalizedShotCount = normalizeStoryShotCount(storyShotCount);
      const prompt = generationMode === 'story'
        ? `故事方向: ${task.direction || '请根据图片内容自由发挥'}${imageDescriptions}${styleText}
目标时长: ${normalizedDuration}秒短视频
画面比例: ${aspectRatio}
核心传达: ${coreMessage || '信仰不是逃避现实，而是在现实里继续温柔与坚定'}
镜头数: ${normalizedShotCount}
节奏基调: ${storyPace}
信仰表达: ${faithTone}
结尾方式: ${endingStyle}${characterAnchor ? `\n主角外观描述: ${characterAnchor}` : ''}${visualToneInput ? `\n视觉基调: ${visualToneInput}` : ''}

请生成 ${ideaCount} 条不同角度的专业短视频分镜方案。

请严格返回 JSON 数组。每个元素一条方案：
[
  {
    "storyOutlineZh": "1-3段中文故事总纲，含三幕标注（建置/对抗/解决），包含黄金三秒钩子",
    "characterAnchorZh": "主角固定外观（年龄/服装/发型/体态/气质）",
    "characterAnchorEn": "Character anchor in English",
    "visualTone": "统一视觉基调（色温/光线风格/调色偏好）",
    "contentZh": "中文完整画面总描述",
    "contentEn": "English overall visual description",
    "shots": [
      {
        "shotNumber": 1,
        "shotType": "景别(特写/近景/中景/全景/远景)",
        "cameraMove": "运镜(推/拉/摇/移/跟/升降/手持/固定)",
        "angle": "机位(平视/仰拍/俯拍/斜角/POV)",
        "duration": "单镜时长如 2s",
        "transition": "转场(硬切/溶解/闪白/划入/匹配剪辑)",
        "sceneDescZh": "场景叙事描述（导演说明）",
        "promptZh": "【不少于80字】完整中文AI生图提示词，真实电影摄影风格。必须包含：人物外貌+服装细节+场景环境+光线方向色温+镜头焦段+景深+色调氛围+角色锚定",
        "promptEn": "【min 40 words】Cinematic photography, [full English prompt with character details, wardrobe, environment, lighting direction, lens focal length, depth of field, color grading, character anchor]",
        "motionDescZh": "动画描述：主体运动(人物动作轨迹+速度)+镜头运动(推拉摇移方向+速度)，可直接用于AI视频工具",
        "motionDescEn": "Motion description for AI video tools: subject movement + camera movement with direction and speed",
        "audio": "声音设计(BGM/环境音/旁白)",
        "text": "字幕或花字（无则空字符串）",
        "emotionIntensity": "情绪强度1-10"
      }
    ]
  }
]

要求：
- shots 数组严格 ${normalizedShotCount} 个镜头，全部镜头时长之和控制在 ${normalizedDuration}秒内
- 所有 promptZh 不少于80字，promptEn 不少于40词，必须高度具体详细
- 所有画面必须是真实电影摄影风格，promptEn 必须以 Cinematic photography 开头
- 每个 promptZh/promptEn 必须包含：人物细节+服装+环境+光线+焦段+景深+色调+角色锚定
- 每个 motionDescZh/motionDescEn 必须描述主体动作和镜头运动，可直接用于AI视频工具
- 在提示词中注明画面比例(${aspectRatio})和构图方向
- emotionIntensity 构成完整情绪曲线，不要全是同一个数值
- 相邻镜头景别不可重复（除非刻意）
- 不要输出 markdown，不要解释`
        : `故事方向: ${task.direction || '请根据图片内容自由发挥'}${imageDescriptions}${styleText}
目标时长: ${normalizedDuration}秒短视频
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
          systemInstruction: generationMode === 'story' ? STORY_SYSTEM_INSTRUCTION : systemInstruction,
          temperature: 0.9,
        },
      });

      if (stopRef.current) {
        updateTask(taskId, { status: 'idle' });
        return;
      }

      const text = response?.text || response?.candidates?.[0]?.content?.parts?.[0]?.text || '';

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

      if (generationMode === 'story') {
        const parsed = parseJsonFromText(text);
        const items = Array.isArray(parsed) ? parsed : [parsed];
        items.forEach((item: any) => {
          // Parse structured shots array (new format)
          const shots: StoryShot[] = Array.isArray(item.shots) ? item.shots.map((s: any, idx: number) => ({
            shotNumber: s.shotNumber || idx + 1,
            shotType: s.shotType || '',
            cameraMove: s.cameraMove || '',
            angle: s.angle || '',
            duration: s.duration || '',
            transition: s.transition || '',
            sceneDescZh: s.sceneDescZh || '',
            promptZh: s.promptZh || '',
            promptEn: s.promptEn || '',
            motionDescZh: s.motionDescZh || '',
            motionDescEn: s.motionDescEn || '',
            audio: s.audio || '',
            text: s.text || '',
            emotionIntensity: parseInt(s.emotionIntensity) || 5,
          })) : [];

          // Backward compat: also extract flat shotPrompts
          const shotPromptsZh = shots.length > 0
            ? shots.map(s => s.promptZh)
            : (Array.isArray(item.shotPromptsZh) ? item.shotPromptsZh.map(String) : []);
          const shotPromptsEn = shots.length > 0
            ? shots.map(s => s.promptEn)
            : (Array.isArray(item.shotPromptsEn) ? item.shotPromptsEn.map(String) : []);

          results.push({
            id: uid(),
            content: JSON.stringify(item, null, 2),
            contentZh: item.contentZh || item.storyOutlineZh || '',
            contentEn: item.contentEn || '',
            storyOutlineZh: item.storyOutlineZh || '',
            storyboardZh: item.storyboardZh || '',
            characterAnchorZh: item.characterAnchorZh || '',
            characterAnchorEn: item.characterAnchorEn || '',
            visualTone: item.visualTone || '',
            shots,
            shotPromptsZh,
            shotPromptsEn,
            starred: false,
          });
        });
      } else if (blocks.length === 0) {
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
  }, [getAiInstance, textModel, systemInstruction, getStylePrompt, duration, ideaCount, updateTask, generationMode, coreMessage, storyShotCount, storyPace, faithTone, endingStyle, aspectRatio, characterAnchor, visualToneInput, normalizeDuration, normalizeStoryShotCount]);

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
    const maxShots = Math.max(...tasks.flatMap(t => t.results.map(r => Math.max(r.shotPromptsZh?.length || 0, r.shotPromptsEn?.length || 0))), 0);

    // Build header
    const headers: string[] = ['故事方向'];
    for (let i = 0; i < maxImages; i++) headers.push(`图片${i + 1}`);
    if (generationMode === 'story') {
      headers.push('故事总纲', '分镜脚本');
      if (lang === 'all' || lang === 'zh') {
        for (let i = 0; i < maxShots; i++) headers.push(`中文提示词_镜头${i + 1}`);
      }
      if (lang === 'all' || lang === 'en') {
        for (let i = 0; i < maxShots; i++) headers.push(`英文提示词_镜头${i + 1}`);
      }
    } else if (lang === 'all') {
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
      if (generationMode === 'story') {
        const primary = task.results[0];
        cells.push(escapeTsvUrl(primary?.storyOutlineZh || primary?.contentZh || ''));
        cells.push(escapeTsvUrl(primary?.storyboardZh || ''));
        if (lang === 'all' || lang === 'zh') {
          for (let i = 0; i < maxShots; i++) cells.push(escapeTsvUrl(primary?.shotPromptsZh?.[i] || ''));
        }
        if (lang === 'all' || lang === 'en') {
          for (let i = 0; i < maxShots; i++) cells.push(escapeTsvUrl(primary?.shotPromptsEn?.[i] || ''));
        }
      } else if (lang === 'all') {
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
  }, [tasks, showToast, uploadGyazoImages, generationMode]);

  const copySingleResult = useCallback(async (content: string) => {
    await navigator.clipboard.writeText(content);
    showToast('📋 已复制');
  }, [showToast]);

  const copyShotPrompts = useCallback(async (prompts: string[] | undefined, label: string) => {
    const list = (prompts || []).filter(Boolean);
    if (list.length === 0) {
      showToast(`⚠️ 没有可复制的${label}`);
      return;
    }
    await navigator.clipboard.writeText(list.map((item) => {
      if (item.includes('\t') || item.includes('\n') || item.includes('"')) {
        return `"${item.replace(/"/g, '""')}"`;
      }
      return item;
    }).join('\t'));
    showToast(`📋 已复制${label}（一镜头一格）`);
  }, [showToast]);

  // Copy full script for a result (all shots formatted)
  const copyFullScript = useCallback(async (result: any) => {
    const lines: string[] = [];
    const shots: StoryShot[] = result.shots || [];
    const totalDur = shots.reduce((sum, s) => sum + (parseFloat(s.duration) || 0), 0);

    // Shot count header
    lines.push(`🎬 本画面共拆分为 ${shots.length} 个镜头 | 总时长约 ${totalDur}s`);
    lines.push('═'.repeat(40));

    // Story info
    if (result.storyOutlineZh) lines.push(`\n📖 故事总纲\n${result.storyOutlineZh}\n`);
    if (result.characterAnchorZh) lines.push(`👤 角色锚定: ${result.characterAnchorZh}`);
    if (result.visualTone) lines.push(`🎨 视觉基调: ${result.visualTone}`);
    if (result.storyOutlineZh || result.characterAnchorZh || result.visualTone) lines.push('─'.repeat(40));

    // Shots
    shots.forEach((s: StoryShot, i: number) => {
      lines.push(`\n🎬 镜头 #${s.shotNumber}/${shots.length}  |  ${s.shotType}  |  ${s.cameraMove}  |  ${s.angle}  |  ${s.duration}  |  转场:${s.transition}  |  情绪:${s.emotionIntensity}/10`);
      lines.push(`─`.repeat(40));
      if (s.sceneDescZh) lines.push(`📝 场景: ${s.sceneDescZh}`);
      if (s.audio) lines.push(`🔊 声音: ${s.audio}`);
      if (s.text) lines.push(`💬 字幕: ${s.text}`);
      lines.push(`\n🖼️ 中文提示词:\n${s.promptZh}`);
      lines.push(`\n🖼️ English Prompt:\n${s.promptEn}`);
      if (s.motionDescZh) lines.push(`\n🎬 动画描述(中):\n${s.motionDescZh}`);
      if (s.motionDescEn) lines.push(`🎬 Motion(EN):\n${s.motionDescEn}`);
      lines.push('');
    });

    // Overall description
    if (result.contentZh) lines.push(`\n📝 完整画面描述:\n${result.contentZh}`);
    if (result.contentEn) lines.push(`\n📝 Full Description:\n${result.contentEn}`);

    await navigator.clipboard.writeText(lines.join('\n'));
    showToast(`📋 已复制完整脚本（${shots.length}个镜头）`);
  }, [showToast]);

  // Copy all shot prompts merged into one unified description
  const copyAllPrompts = useCallback(async (result: any, lang: 'zh' | 'en') => {
    const shots: StoryShot[] = result.shots || [];
    if (shots.length === 0) { showToast('⚠️ 没有镜头数据'); return; }
    const totalDur = shots.reduce((sum, s) => sum + (parseFloat(s.duration) || 0), 0);
    const header = lang === 'zh'
      ? `🎬 本画面共拆分为 ${shots.length} 个镜头 | 总时长约 ${totalDur}s\n${'═'.repeat(40)}\n`
      : `🎬 This scene is split into ${shots.length} shots | Total duration ~${totalDur}s\n${'═'.repeat(40)}\n`;
    const merged = shots.map((s: StoryShot) => {
      const prompt = lang === 'zh' ? s.promptZh : s.promptEn;
      return `【镜头${s.shotNumber}/${shots.length} ${s.shotType} ${s.duration}】${prompt}`;
    }).join('\n\n');
    await navigator.clipboard.writeText(header + merged);
    showToast(`📋 已复制${shots.length}个镜头${lang === 'zh' ? '中文' : '英文'}提示词`);
  }, [showToast]);

  const sendToStoryboardTool = useCallback((task: HookTask, result: HookResult) => {
    const shots = result.shots || [];
    const shotLines = shots.length > 0
      ? shots.map((shot) => [
        `镜头${shot.shotNumber}: ${shot.shotType} / ${shot.cameraMove} / ${shot.angle} / ${shot.duration}`,
        shot.sceneDescZh ? `场景: ${shot.sceneDescZh}` : '',
        shot.promptZh ? `生图提示词: ${shot.promptZh}` : '',
        shot.motionDescZh ? `动画描述: ${shot.motionDescZh}` : '',
        shot.audio ? `声音: ${shot.audio}` : '',
        shot.text ? `字幕: ${shot.text}` : '',
      ].filter(Boolean).join('\n')).join('\n\n')
      : (result.storyboardZh || result.shotPromptsZh?.map((p, i) => `镜头${i + 1}: ${p}`).join('\n\n') || '');

    const payload = {
      source: 'hook-script',
      createdAt: Date.now(),
      direction: task.direction,
      storyOutlineZh: result.storyOutlineZh || result.contentZh || task.direction,
      characterAnchorZh: result.characterAnchorZh || '',
      visualTone: result.visualTone || '',
      storyboardZh: result.storyboardZh || '',
      shotLines,
      storyboardCount: Math.min(12, Math.max(3, shots.length || result.shotPromptsZh?.length || storyShotCount || 9)),
      images: task.images.map((img) => ({
        data: img.data,
        mimeType: img.mimeType,
        name: img.name,
      })),
    };

    try {
      localStorage.setItem(STORYBOARD_BRIDGE_KEY, JSON.stringify(payload));
    } catch {
      localStorage.setItem(STORYBOARD_BRIDGE_KEY, JSON.stringify({ ...payload, images: [] }));
      showToast('⚠️ 参考图较大，已只发送故事文本');
    }

    window.dispatchEvent(new CustomEvent(STORYBOARD_BRIDGE_EVENT, { detail: payload }));
    window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: { tool: 'videoKeyframe' } }));
    showToast('✅ 已发送到多宫格分镜词');
  }, [showToast, storyShotCount]);

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
          <select className="hs-select" value={generationMode} onChange={e => setGenerationMode(e.target.value as 'hook' | 'story')}>
            <option value="hook">⚡ 钩子版</option>
            <option value="story">🎞️ 故事版</option>
          </select>

          {/* Style */}
          <select className="hs-select" value={style} onChange={e => setStyle(e.target.value)}>
            {STYLE_PRESETS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}
          </select>

          {/* Idea count */}
          <select className="hs-select" value={ideaCount} onChange={e => setIdeaCount(parseInt(e.target.value))}>
            {[1,2,3,4,5,6,8,10].map(n => <option key={n} value={n}>{n}条思路</option>)}
          </select>

          {/* Duration: preset select + custom input */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <select
              className="hs-select"
              value={DURATION_OPTIONS.some(d => d.value === duration) ? duration : 'custom'}
              onChange={e => {
                const v = e.target.value;
                if (v === 'custom') {
                  // If current value matches a preset, nudge to a non-preset value to show input
                  const cur = parseInt(duration) || 10;
                  const nonPreset = DURATION_OPTIONS.some(d => d.value === String(cur) && d.value !== 'custom') ? cur + 1 : cur;
                  setDuration(String(clampInteger(nonPreset, MIN_DURATION_SECONDS, MAX_DURATION_SECONDS)));
                  return;
                }
                setDuration(v);
              }}
            >
              {DURATION_OPTIONS.map(d => <option key={d.value} value={d.value}>{d.label}</option>)}
            </select>
            {!DURATION_OPTIONS.some(d => d.value === duration && d.value !== 'custom') && (
              <input
                className="hs-select"
                style={{ width: 56 }}
                type="number"
                min={MIN_DURATION_SECONDS}
                max={MAX_DURATION_SECONDS}
                step={1}
                value={duration}
                onChange={e => setDuration(e.target.value)}
                onBlur={e => setDuration(normalizeDuration(e.target.value))}
                placeholder="秒"
              />
            )}
            <span className="hs-badge">秒</span>
          </div>

          {generationMode === 'story' && (
            <>
              {/* Shot count: preset select + custom input */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <select
                  className="hs-select"
                  value={SHOT_COUNT_OPTIONS.some(s => s.value === storyShotCount) ? String(storyShotCount) : '-1'}
                  onChange={e => {
                    const v = parseInt(e.target.value);
                    if (v === -1) {
                      const nonPreset = SHOT_COUNT_OPTIONS.some(s => s.value === storyShotCount && s.value !== -1) ? storyShotCount + 1 : storyShotCount;
                      setStoryShotCount(clampInteger(nonPreset > 0 ? nonPreset : 7, MIN_STORY_SHOTS, MAX_STORY_SHOTS));
                      return;
                    }
                    setStoryShotCount(v);
                  }}
                >
                  {SHOT_COUNT_OPTIONS.map(s => <option key={s.value} value={String(s.value)}>{s.label}</option>)}
                </select>
                {!SHOT_COUNT_OPTIONS.some(s => s.value === storyShotCount && s.value !== -1) && (
                  <input
                    className="hs-select"
                    style={{ width: 56 }}
                    type="number"
                    min={MIN_STORY_SHOTS}
                    max={MAX_STORY_SHOTS}
                    step={1}
                    value={storyShotCount}
                    onChange={e => setStoryShotCount(normalizeStoryShotCount(e.target.value))}
                    onBlur={e => setStoryShotCount(normalizeStoryShotCount(e.target.value))}
                    placeholder="数量"
                  />
                )}
                <span className="hs-badge">镜头</span>
              </div>
              <select className="hs-select" value={storyPace} onChange={e => setStoryPace(e.target.value as '快' | '中' | '慢')}>
                {['快', '中', '慢'].map(v => <option key={v} value={v}>{v}节奏</option>)}
              </select>
              <select className="hs-select" value={faithTone} onChange={e => setFaithTone(e.target.value as '隐性' | '中性' | '明确')}>
                {['隐性', '中性', '明确'].map(v => <option key={v} value={v}>信仰:{v}</option>)}
              </select>
              <select className="hs-select" value={endingStyle} onChange={e => setEndingStyle(e.target.value as '留白' | '金句' | '祷告' | '提问')}>
                {['留白', '金句', '祷告', '提问'].map(v => <option key={v} value={v}>结尾:{v}</option>)}
              </select>
              <select className="hs-select" value={aspectRatio} onChange={e => setAspectRatio(e.target.value)}>
                {ASPECT_RATIO_OPTIONS.map(a => <option key={a.value} value={a.value}>{a.label}</option>)}
              </select>
              <input
                className="hs-select"
                style={{ minWidth: 220 }}
                value={coreMessage}
                onChange={e => setCoreMessage(e.target.value)}
                placeholder="核心传达，例如：在现实里继续温柔"
              />
              <button
                className={`hs-btn ${showCharacterPanel ? 'hs-btn-accent' : 'hs-btn-ghost'}`}
                onClick={() => setShowCharacterPanel(!showCharacterPanel)}
                title="打开角色/场景设定面板"
              >👤 角色设定</button>
              <input
                className="hs-select"
                style={{ minWidth: 180 }}
                value={visualToneInput}
                onChange={e => setVisualToneInput(e.target.value)}
                placeholder="🎨 视觉基调：暖色调,自然光,胶片感"
                title="统一色温/光线/调色风格"
              />
            </>
          )}

          {/* Structured Character/Scene Settings Panel */}
          {showCharacterPanel && generationMode === 'story' && (
            <div className="hs-character-panel">
              <div className="hs-charpanel-section">
                <div className="hs-charpanel-title">👤 角色设定</div>
                <div className="hs-charpanel-grid">
                  <label>性别
                    <input list="dl-gender" value={charSettings.gender || ''} onChange={e => updateCharField('gender', e.target.value)} placeholder="不限" />
                    <datalist id="dl-gender">{['男性', '女性'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>年龄
                    <input list="dl-age" value={charSettings.ageRange || ''} onChange={e => updateCharField('ageRange', e.target.value)} placeholder="如：青年(18-25)" />
                    <datalist id="dl-age">{['儿童(5-12)', '少年(13-17)', '青年(18-25)', '轻熟(26-35)', '中年(36-50)', '中老年(51-65)', '老年(65+)'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>国家/地区
                    <input list="dl-country" value={charSettings.country || ''} onChange={e => updateCharField('country', e.target.value)} placeholder="如：英国/美国" />
                    <datalist id="dl-country">{['英国', '美国', '爱尔兰', '法国', '德国', '意大利', '西班牙', '荷兰', '瑞士', '瑞典', '挪威', '丹麦', '芬兰', '波兰', '奥地利', '比利时', '葡萄牙', '希腊', '土耳其', '俄罗斯', '中国', '日本', '韩国', '印度', '澳大利亚', '加拿大', '巴西', '墨西哥', '南非', '以色列'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>族裔
                    <input list="dl-ethnicity" value={charSettings.ethnicity || ''} onChange={e => updateCharField('ethnicity', e.target.value)} placeholder="如：亚裔/白人" />
                    <datalist id="dl-ethnicity">{['亚裔', '东亚人', '南亚人', '东南亚人', '中东人', '白人/高加索人', '黑人/非裔', '拉丁裔', '混血'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>肤色
                    <input list="dl-skin" value={charSettings.skinTone || ''} onChange={e => updateCharField('skinTone', e.target.value)} placeholder="如：白皙/小麦色" />
                    <datalist id="dl-skin">{['白皙', '象牙白', '小麦色', '黄', '浅棕', '棕色', '深棕', '黑'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>发型
                    <input list="dl-hair" value={charSettings.hairStyle || ''} onChange={e => updateCharField('hairStyle', e.target.value)} placeholder="如：黑色长发" />
                    <datalist id="dl-hair">{['黑色长发', '黑色短发', '金色长发', '棕色卷发', '红色短发', '灰白短发', '光头', '马尾辫', '编发'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>服装
                    <input list="dl-clothing" value={charSettings.clothing || ''} onChange={e => updateCharField('clothing', e.target.value)} placeholder="如：白色亚麻衬衫" />
                    <datalist id="dl-clothing">{['白色衬衫', '深色西装', '牛仔外套+T恤', '连衣裙', '卫衣+运动裤', '工装外套', '毛衣+围巾', '职业套装'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>体型
                    <input list="dl-body" value={charSettings.bodyType || ''} onChange={e => updateCharField('bodyType', e.target.value)} placeholder="如：标准/纤瘦" />
                    <datalist id="dl-body">{['纤瘦', '标准', '健壮', '微胖', '丰满', '高大', '娇小'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>气质/表情
                    <input value={charSettings.expression || ''} onChange={e => updateCharField('expression', e.target.value)} placeholder="如：温柔沉静" />
                  </label>
                  <label>道具
                    <input value={charSettings.props || ''} onChange={e => updateCharField('props', e.target.value)} placeholder="如：旧皮箱/圣经" />
                  </label>
                  <label>补充
                    <input value={charSettings.extra || ''} onChange={e => updateCharField('extra', e.target.value)} placeholder="其他人物细节..." />
                  </label>
                </div>
              </div>
              <div className="hs-charpanel-section">
                <div className="hs-charpanel-title">🏠 场景设定</div>
                <div className="hs-charpanel-grid">
                  <label>场景类型
                    <input list="dl-loctype" value={sceneSettings.locationType || ''} onChange={e => updateSceneField('locationType', e.target.value)} placeholder="如：室内/室外" />
                    <datalist id="dl-loctype">{['室内', '室外', '室内外结合'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>具体地点
                    <input list="dl-loc" value={sceneSettings.specificLocation || ''} onChange={e => updateSceneField('specificLocation', e.target.value)} placeholder="如：老旧公寓" />
                    <datalist id="dl-loc">{['教堂', '咖啡厅', '公寓卧室', '海边', '森林小径', '城市街道', '医院', '办公室', '学校教室', '车内', '火车站', '山顶'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>时间段
                    <input list="dl-time" value={sceneSettings.timeOfDay || ''} onChange={e => updateSceneField('timeOfDay', e.target.value)} placeholder="如：黄昏" />
                    <datalist id="dl-time">{['清晨', '上午', '正午', '午后', '黄昏', '傍晚', '夜晚', '深夜', '黎明'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>天气
                    <input list="dl-weather" value={sceneSettings.weather || ''} onChange={e => updateSceneField('weather', e.target.value)} placeholder="如：小雨" />
                    <datalist id="dl-weather">{['晴天', '多云', '阴天', '小雨', '大雨', '暴雨', '雪', '雾', '大风'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>季节
                    <input list="dl-season" value={sceneSettings.season || ''} onChange={e => updateSceneField('season', e.target.value)} placeholder="如：秋" />
                    <datalist id="dl-season">{['春', '夏', '秋', '冬'].map(v => <option key={v} value={v} />)}</datalist>
                  </label>
                  <label>场景道具
                    <input value={sceneSettings.sceneProps || ''} onChange={e => updateSceneField('sceneProps', e.target.value)} placeholder="如：老木桌/蜡烛" />
                  </label>
                  <label>补充
                    <input value={sceneSettings.extra || ''} onChange={e => updateSceneField('extra', e.target.value)} placeholder="其他场景细节..." />
                  </label>
                </div>
              </div>
              <div className="hs-charpanel-actions">
                <button className="hs-btn hs-btn-accent" onClick={() => { buildCharacterAnchor(); showToast('✅ 角色锚定已更新'); }}>✅ 应用到角色锚定</button>
                <div className="hs-charpanel-preview">{characterAnchor || '（填写上方字段后点击"应用"生成锚定描述）'}</div>
              </div>
            </div>
          )}

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
                        {generationMode === 'story' && (
                          <>
                            <button
                              className="hs-result-btn"
                              onClick={() => copyShotPrompts(result.shotPromptsZh, '中文镜头提示词')}
                              title="复制中文逐镜头提示词（一镜头一格）"
                            >🧾中</button>
                            <button
                              className="hs-result-btn"
                              onClick={() => copyShotPrompts(result.shotPromptsEn, '英文镜头提示词')}
                              title="复制英文逐镜头提示词（一镜头一格）"
                            >🧾EN</button>
                          </>
                        )}
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
	                        {result.shots && result.shots.length > 0 && (
	                          <>
                            <button
                              className="hs-result-btn"
                              onClick={() => copyFullScript(result)}
                              title="一键复制完整镜头脚本（含所有元数据）"
                              style={{ fontSize: '0.6rem', padding: '2px 6px' }}
                            >📋 完整脚本</button>
                            <button
                              className="hs-result-btn"
                              onClick={() => copyAllPrompts(result, 'zh')}
                              title="复制所有镜头的中文生图提示词（合并）"
                              style={{ fontSize: '0.6rem', padding: '2px 6px' }}
                            >🖼️ 中文提示词</button>
	                            <button
	                              className="hs-result-btn"
	                              onClick={() => copyAllPrompts(result, 'en')}
	                              title="Copy all shot EN prompts (merged)"
	                              style={{ fontSize: '0.6rem', padding: '2px 6px' }}
	                            >🖼️ EN Prompts</button>
	                            <button
	                              className="hs-result-btn"
	                              onClick={() => sendToStoryboardTool(task, result)}
	                              title="发送故事版到多宫格电影分镜词"
	                              style={{ fontSize: '0.6rem', padding: '2px 6px', color: '#00d9a5' }}
	                            >🎞️ 多宫格</button>
	                          </>
	                        )}
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
                      {generationMode === 'story' && (
                        <>
                          {result.storyOutlineZh && (
                            <div className="hs-result-frame-block">
                              <span className="hs-frame-label" style={{ color: '#d4d4d8' }}>✨ 故事总纲</span>
                              <div className="hs-result-text">{result.storyOutlineZh}</div>
                            </div>
                          )}
                          {(result.characterAnchorZh || result.visualTone) && (
                            <div className="hs-result-frame-block">
                              {result.characterAnchorZh && (
                                <>
                                  <span className="hs-frame-label">👤 角色锚定</span>
                                  <div className="hs-result-text">{result.characterAnchorZh}</div>
                                  {result.characterAnchorEn && <div className="hs-result-text en">{result.characterAnchorEn}</div>}
                                </>
                              )}
                              {result.visualTone && (
                                <>
                                  <span className="hs-frame-label" style={{ marginTop: result.characterAnchorZh ? 8 : 0 }}>🎨 视觉基调</span>
                                  <div className="hs-result-text">{result.visualTone}</div>
                                </>
                              )}
                            </div>
                          )}
                          {/* Emotion Curve */}
                          {result.shots && result.shots.length > 0 && (
                            <div className="hs-result-frame-block">
                              <span className="hs-frame-label">📈 情绪曲线</span>
                              <div className="hs-emotion-curve">
                                {result.shots.map((shot, idx) => (
                                  <div key={idx} className="hs-emotion-bar-wrap">
                                    <div
                                      className="hs-emotion-bar"
                                      style={{ height: `${shot.emotionIntensity * 10}%` }}
                                      title={`镜头${shot.shotNumber}: 情绪 ${shot.emotionIntensity}/10`}
                                    />
                                    <span className="hs-emotion-label">{shot.shotNumber}</span>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}
                          {/* Timeline Shot Cards */}
                          {result.shots && result.shots.length > 0 ? (
                            <div className="hs-result-frame-block">
                              <span className="hs-frame-label">🎬 分镜时间线 <span style={{ color: '#52525b', fontWeight: 400 }}>（点击文字可编辑）</span></span>
                              <div className="hs-shot-timeline">
                                {result.shots.map((shot, idx) => (
                                  <div key={idx} className="hs-shot-card">
                                    <div className="hs-shot-card-header">
                                      <span className="hs-shot-number">#{shot.shotNumber}</span>
                                      <select className="hs-shot-inline-select" value={shot.shotType} onChange={e => updateShotField(task.id, result.id, idx, 'shotType', e.target.value)}>
                                        {['特写', '近景', '中景', '全景', '远景', '大远景'].map(v => <option key={v} value={v}>{v}</option>)}
                                      </select>
                                      <input className="hs-shot-inline-input duration" value={shot.duration} onChange={e => updateShotField(task.id, result.id, idx, 'duration', e.target.value)} title="时长" />
                                      <select className="hs-shot-inline-select sm" value={shot.cameraMove} onChange={e => updateShotField(task.id, result.id, idx, 'cameraMove', e.target.value)}>
                                        {['推', '拉', '摇', '移', '跟', '升降', '手持', '固定', '环绕', '甩'].map(v => <option key={v} value={v}>{v}</option>)}
                                      </select>
                                      <select className="hs-shot-inline-select sm" value={shot.angle} onChange={e => updateShotField(task.id, result.id, idx, 'angle', e.target.value)}>
                                        {['平视', '俯拍', '仰拍', '斜角', 'POV'].map(v => <option key={v} value={v}>{v}</option>)}
                                      </select>
                                      <select className="hs-shot-inline-select sm" value={shot.transition} onChange={e => updateShotField(task.id, result.id, idx, 'transition', e.target.value)}>
                                        {['硬切', '溶解', '闪白', '划入', '匹配剪辑', '淡入', '淡出'].map(v => <option key={v} value={v}>{v}</option>)}
                                      </select>
                                      <span className="hs-shot-emotion" title={`情绪强度 ${shot.emotionIntensity}/10`}>
                                        {'🔥'.repeat(Math.min(Math.ceil(shot.emotionIntensity / 3), 3))}
                                      </span>
                                      <div className="hs-shot-actions">
                                        <button className="hs-result-btn" onClick={() => copySingleResult(shot.promptZh)} title="复制中文提示词">🇨🇳</button>
                                        <button className="hs-result-btn" onClick={() => copySingleResult(shot.promptEn || shot.promptZh)} title="复制英文提示词">🇺🇸</button>
                                        <button className="hs-result-btn" onClick={() => insertShot(task.id, result.id, idx)} title="在此镜头后插入">➕</button>
                                        {idx > 0 && <button className="hs-result-btn" onClick={() => reorderShot(task.id, result.id, idx, idx - 1)} title="上移">⬆</button>}
                                        {idx < (result.shots?.length || 0) - 1 && <button className="hs-result-btn" onClick={() => reorderShot(task.id, result.id, idx, idx + 1)} title="下移">⬇</button>}
                                        {(result.shots?.length || 0) > 1 && <button className="hs-result-btn" onClick={() => deleteShot(task.id, result.id, idx)} title="删除此镜头" style={{ color: '#ef4444' }}>✕</button>}
                                      </div>
                                    </div>
                                    <div
                                      className="hs-shot-scene-edit"
                                      contentEditable
                                      suppressContentEditableWarning
                                      onBlur={e => updateShotField(task.id, result.id, idx, 'sceneDescZh', e.currentTarget.textContent || '')}
                                      data-placeholder="点击输入场景叙事描述（导演说明）..."
                                    >{shot.sceneDescZh}</div>
                                    <div className="hs-shot-aux-row">
                                      <span className="hs-shot-aux-label">🔊</span>
                                      <div
                                        className="hs-shot-aux-edit"
                                        contentEditable
                                        suppressContentEditableWarning
                                        onBlur={e => updateShotField(task.id, result.id, idx, 'audio', e.currentTarget.textContent || '')}
                                        data-placeholder="声音设计..."
                                      >{shot.audio}</div>
                                      {(shot.text || true) && (
                                        <>
                                          <span className="hs-shot-aux-label">💬</span>
                                          <div
                                            className="hs-shot-aux-edit"
                                            contentEditable
                                            suppressContentEditableWarning
                                            onBlur={e => updateShotField(task.id, result.id, idx, 'text', e.currentTarget.textContent || '')}
                                            data-placeholder="字幕/花字..."
                                          >{shot.text}</div>
                                        </>
                                      )}
                                    </div>
                                    <div className="hs-shot-prompts">
                                      <div
                                        className="hs-shot-prompt-edit"
                                        contentEditable
                                        suppressContentEditableWarning
                                        onBlur={e => updateShotField(task.id, result.id, idx, 'promptZh', e.currentTarget.textContent || '')}
                                        data-placeholder="中文生图提示词..."
                                      >{shot.promptZh}</div>
                                      <div
                                        className="hs-shot-prompt-edit en"
                                        contentEditable
                                        suppressContentEditableWarning
                                        onBlur={e => updateShotField(task.id, result.id, idx, 'promptEn', e.currentTarget.textContent || '')}
                                        data-placeholder="English prompt..."
                                      >{shot.promptEn}</div>
                                    </div>
                                    {/* Motion Description for AI Animation Tools */}
                                    <div className="hs-shot-motion-block">
                                      <div className="hs-shot-motion-header">
                                        <span>🎬 动画镜头描述</span>
                                        <div className="hs-shot-actions" style={{ opacity: 0.5 }}>
                                          <button className="hs-result-btn" onClick={() => copySingleResult(shot.motionDescEn || shot.motionDescZh)} title="复制动画描述">📋</button>
                                        </div>
                                      </div>
                                      <div
                                        className="hs-shot-motion-edit"
                                        contentEditable
                                        suppressContentEditableWarning
                                        onBlur={e => updateShotField(task.id, result.id, idx, 'motionDescZh', e.currentTarget.textContent || '')}
                                        data-placeholder="主体运动 + 镜头运动（如：女人缓缓抬头，镜头从近景慢推到特写）..."
                                      >{shot.motionDescZh}</div>
                                      <div
                                        className="hs-shot-motion-edit en"
                                        contentEditable
                                        suppressContentEditableWarning
                                        onBlur={e => updateShotField(task.id, result.id, idx, 'motionDescEn', e.currentTarget.textContent || '')}
                                        data-placeholder="Subject motion + camera motion for AI video tools..."
                                      >{shot.motionDescEn}</div>
                                    </div>
                                    {/* Per-shot refinement chat */}
                                    <div className="hs-shot-refine">
                                      <input
                                        className="hs-shot-refine-input"
                                        value={refineInputs[`${result.id}-${idx}`] || ''}
                                        onChange={e => setRefineInputs(prev => ({ ...prev, [`${result.id}-${idx}`]: e.target.value }))}
                                        onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); refineSingleShot(task.id, result.id, idx, refineInputs[`${result.id}-${idx}`] || ''); }}}
                                        placeholder={`✏️ 修改此镜头，如：改成雨天、换成俯拍...`}
                                        disabled={refiningId === `${result.id}-${idx}`}
                                      />
                                      <button
                                        className="hs-shot-refine-btn"
                                        onClick={() => refineSingleShot(task.id, result.id, idx, refineInputs[`${result.id}-${idx}`] || '')}
                                        disabled={refiningId === `${result.id}-${idx}` || !(refineInputs[`${result.id}-${idx}`] || '').trim()}
                                      >{refiningId === `${result.id}-${idx}` ? '⏳' : '✏️'}</button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          ) : (
                            <>
                              {/* Backward compat: old storyboardZh + flat shotPrompts */}
                              {result.storyboardZh && (
                                <div className="hs-result-frame-block">
                                  <span className="hs-frame-label">🎬 分镜脚本</span>
                                  <div className="hs-result-text">{result.storyboardZh}</div>
                                </div>
                              )}
                              {(result.shotPromptsZh?.length || result.shotPromptsEn?.length) ? (
                                <div className="hs-result-frame-block">
                                  <span className="hs-frame-label">🖼️ 逐镜头生图提示词</span>
                                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                                    {Array.from({ length: Math.max(result.shotPromptsZh?.length || 0, result.shotPromptsEn?.length || 0) }).map((_, idx) => (
                                      <div key={idx} style={{ background: '#18181b', border: '1px solid #30303a', borderRadius: 8, padding: 8 }}>
                                        <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#f59e0b', marginBottom: 6 }}>镜头 {idx + 1}</div>
                                        {result.shotPromptsZh?.[idx] && <div className="hs-result-text">{result.shotPromptsZh[idx]}</div>}
                                        {result.shotPromptsEn?.[idx] && <div className="hs-result-text en">{result.shotPromptsEn[idx]}</div>}
                                      </div>
                                    ))}
                                  </div>
                                </div>
                              ) : null}
                            </>
                          )}
                        </>
                      )}

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

                      {/* Refinement Chat Input (story mode only) */}
                      {generationMode === 'story' && result.shots && result.shots.length > 0 && (
                        <div className="hs-refine-block">
                          <div className="hs-refine-header">💬 继续修改脚本</div>
                          <div className="hs-refine-row">
                            <input
                              className="hs-refine-input"
                              value={refineInputs[result.id] || ''}
                              onChange={e => setRefineInputs(prev => ({ ...prev, [result.id]: e.target.value }))}
                              onKeyDown={e => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); refineForResult(task.id, result.id, refineInputs[result.id] || ''); }}}
                              placeholder="输入修改指令，如：把第3镜改成雨天、增加一个特写镜头、把节奏加快..."
                              disabled={refiningId === result.id}
                            />
                            <button
                              className="hs-btn hs-btn-accent"
                              onClick={() => refineForResult(task.id, result.id, refineInputs[result.id] || '')}
                              disabled={refiningId === result.id || !(refineInputs[result.id] || '').trim()}
                            >
                              {refiningId === result.id ? '⏳ 修改中...' : '✏️ 修改'}
                            </button>
                          </div>
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
