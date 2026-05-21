/**
 * 🎬 视频智能关键帧提取器 (Video Keyframe Extractor)
 * 纯浏览器端：拖入视频 → 按间隔截帧 → 选帧 → 上传 Gyazo → 复制到 Google Sheets
 */

import React, { useState, useRef, useCallback, useEffect } from 'react';
import { base64ToFile, uploadToGyazo, getGyazoToken } from '../image-review/services/gyazoService';
import { extractUrlsFromHtml, fetchImageBlob, parsePasteInput } from '../ai-image-recognition/utils';
import './VideoKeyframeApp.css';

// ========== Types ==========
interface FrameData {
    index: number;
    time: number;
    dataUrl: string;
    selected: boolean;
    gyazoUrl?: string;
    uploading?: boolean;
    groupId: string;
}

interface VideoGroup {
    id: string;
    name: string;
    blobUrl: string;
    originalUrl?: string;
    sourceDataUrl?: string; // Original image before split (for download)
    frameCount: number;
    duration: number;
    collapsed: boolean;
}

interface VideoKeyframeAppProps {
    getAiInstance?: () => unknown;
    textModel?: string;
}

interface StoryboardPrompt {
    panel: number;
    groupId: string;
    frameIndex: number;
    time: number;
    title: string;
    shotType: string;
    prompt: string;
}

interface HookStoryboardBridgeImage {
    data: string;
    mimeType: string;
    name?: string;
}

interface HookStoryboardBridgePayload {
    source?: string;
    createdAt?: number;
    direction?: string;
    storyOutlineZh?: string;
    characterAnchorZh?: string;
    visualTone?: string;
    storyboardZh?: string;
    shotLines?: string;
    storyboardCount?: number;
    images?: HookStoryboardBridgeImage[];
}

interface VideoKeyframeTab {
    id: string;
    name: string;
    entryMode: 'video' | 'storyboard' | 'split';
    videoSrc: string | null;
    videoName: string;
    videoDuration: number;
    videoAspect: number;
    frames: FrameData[];
    groups: VideoGroup[];
    urlInput: string;
    interval: number;
    storyboardCount: number;
    storyboardCreateMode: StoryboardCreateMode;
    storyboardStyle: string;
    storyboardContext: string;
    storyboardCustomInstruction: string;
    storyboardPrompts: StoryboardPrompt[];
    storyAnalysis: string;
    storyRevision: string;
    storyRevisionInstruction: string;
}

// ========== Helpers ==========
const fmtTime = (sec: number): string => {
    const m = Math.floor(sec / 60);
    const s = sec % 60;
    return `${String(m).padStart(2, '0')}:${s.toFixed(1).padStart(4, '0')}`;
};

const fmtTimeFull = (sec: number): string => {
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.floor(sec % 60);
    if (h > 0) return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    return `${m}:${String(s).padStart(2, '0')}`;
};

const extractResponseText = (response: any): string => {
    if (typeof response?.text === 'string') return response.text;
    return response?.candidates?.[0]?.content?.parts?.map((p: any) => p.text || '').join('') || '';
};

const parseStoryboardPrompts = (text: string, sourceFrames: FrameData[]): StoryboardPrompt[] => {
    const sections = text.split(/===\s*PANEL\s*(\d+)\s*===/i);
    const parsed: StoryboardPrompt[] = [];

    for (let i = 1; i < sections.length; i += 2) {
        const panel = Number(sections[i]);
        const body = (sections[i + 1] || '').trim();
        if (!body) continue;
        const frame = sourceFrames[panel - 1];

        const title = body.match(/(?:标题|Title)\s*[:：]\s*(.+)/i)?.[1]?.trim() || `分镜 ${panel}`;
        const shotType = body.match(/(?:镜头|Shot)\s*[:：]\s*(.+)/i)?.[1]?.trim() || '电影镜头';
        const promptMatch = body.match(/(?:描述词|Prompt)\s*[:：]\s*([\s\S]+)/i);
        const prompt = (promptMatch?.[1] || body)
            .replace(/^[-\s]*(标题|Title|镜头|Shot)\s*[:：].*$/gim, '')
            .trim();

        parsed.push({
            panel,
            groupId: frame?.groupId || 'story',
            frameIndex: frame?.index ?? (panel - 1),
            time: frame?.time ?? 0,
            title,
            shotType,
            prompt,
        });
    }

    return parsed;
};

type StoryboardCreateMode = 'describe' | 'create' | 'grok_video';

const DEFAULT_DESCRIBE_INSTRUCTION = `按每张输入图逐张反推 AI 图片描述词。先仔细识别画面里的主体、人物外貌、服装、动作、道具、环境、构图、镜头角度、光线、色彩、材质和情绪，再写成可直接用于生图/视频首帧的长描述词。每格必须忠实描述对应图片，不要改写成新剧情。`;

const DEFAULT_CREATE_INSTRUCTION = `把输入图当作参考图，而不是最终分镜。先提取参考图中的主体、人物长相、年龄气质、发型、服装、道具、场景、色调、光线、材质和整体摄影风格，再重新创作一组新的电影多宫格分镜。每格都要是新的镜头画面，并保持参考图主体与视觉风格连续一致，描述词要细到能直接生成画面。`;

const DEFAULT_GROK_VIDEO_INSTRUCTION = `把输入图当作风格和画面参考，生成用于 Grok (或类似 AI 视频模型) 制作 6 秒左右短视频的视频分镜表。
1. 请提取参考图中的元素，结合视频动态生成需求，规划出连贯的视频分镜。
2. 因为是短视频，请按 1-2 秒一格的节奏规划。
3. 镜头运动必须适合 AI 视频生成（例如：平移、推拉、环绕等）。`;

const createVideoKeyframeTab = (id: string, name: string): VideoKeyframeTab => ({
    id,
    name,
    entryMode: 'video',
    videoSrc: null,
    videoName: '',
    videoDuration: 0,
    videoAspect: 16 / 9,
    frames: [],
    groups: [],
    urlInput: '',
    interval: 2,
    storyboardCount: 9,
    storyboardCreateMode: 'describe',
    storyboardStyle: '电影写实',
    storyboardContext: '',
    storyboardCustomInstruction: DEFAULT_DESCRIBE_INSTRUCTION,
    storyboardPrompts: [],
    storyAnalysis: '',
    storyRevision: '',
    storyRevisionInstruction: '',
});
const STORYBOARD_BRIDGE_KEY = 'vkf_storyboard_bridge_v1';
const STORYBOARD_BRIDGE_EVENT = 'vkf-storyboard-bridge';

const getDraftText = (value: unknown, fallback = '') => {
    if (typeof value === 'string') return value;
    if (value && typeof (value as { value?: unknown }).value === 'string') {
        return String((value as { value: string }).value);
    }
    return fallback;
};

const getStoryboardGridLayout = (count: number) => {
    if (count <= 3) return { rows: count, cols: 1, label: `${count} 行 1 列` };
    if (count <= 6) return { rows: 3, cols: 2, label: '3 行 2 列' };
    if (count <= 9) return { rows: 3, cols: 3, label: '3 行 3 列' };
    if (count <= 12) return { rows: 4, cols: 3, label: '4 行 3 列' };
    const rows = Math.ceil(Math.sqrt(count * 16 / 9));
    const cols = Math.ceil(count / rows);
    return { rows, cols, label: `${rows} 行 ${cols} 列` };
};

const withStoryboardAspectRatio = (prompt: string) => {
    const text = prompt.trim();
    if (/9\s*[:/]\s*16|9\/16|竖版/.test(text)) return text;
    return `9:16 竖版画面，画面比例 9/16，${text}`;
};

const loadImageFromDataUrl = (dataUrl: string): Promise<HTMLImageElement> => {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = reject;
        img.src = dataUrl;
    });
};

// ========== Split Crop Editor Sub-Component ==========
interface SplitCropEditorProps {
    imageUrl: string;
    imgRef: React.MutableRefObject<HTMLImageElement | null>;
    hLines: number[];
    vLines: number[];
    onHLinesChange: (lines: number[]) => void;
    onVLinesChange: (lines: number[]) => void;
    onAutoDetect: () => void;
    onSetGrid: (rows: number, cols: number) => void;
    onSplit: () => void;
    onSplitAndNext?: () => void;
    onClose: () => void;
    showToast: (msg: string, type: 'success' | 'error' | 'info') => void;
    splitQueueCurrent?: number;
    splitQueueTotal?: number;
}

const SplitCropEditor: React.FC<SplitCropEditorProps> = ({
    imageUrl, imgRef, hLines, vLines,
    onHLinesChange, onVLinesChange,
    onAutoDetect, onSetGrid, onSplit, onSplitAndNext, onClose, showToast,
    splitQueueCurrent, splitQueueTotal,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const [addMode, setAddMode] = useState<'h' | 'v' | null>(null);
    const [dragging, setDragging] = useState<{ type: 'h' | 'v'; index: number } | null>(null);
    const [previewPos, setPreviewPos] = useState<{ x: number; y: number } | null>(null);
    const [canvasSize, setCanvasSize] = useState({ w: 0, h: 0 });
    const [customRows, setCustomRows] = useState(3);
    const [customCols, setCustomCols] = useState(3);

    // Compute display dimensions
    const computeDisplaySize = useCallback(() => {
        const img = imgRef.current;
        const container = containerRef.current;
        if (!img || !container) return { w: 0, h: 0 };
        const maxW = container.clientWidth - 32;
        const maxH = container.clientHeight - 32;
        const aspect = img.naturalWidth / img.naturalHeight;
        let w = maxW;
        let h = w / aspect;
        if (h > maxH) { h = maxH; w = h * aspect; }
        return { w: Math.floor(w), h: Math.floor(h) };
    }, [imgRef]);

    // Draw canvas
    const draw = useCallback(() => {
        const canvas = canvasRef.current;
        const img = imgRef.current;
        if (!canvas || !img) return;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        const { w, h } = computeDisplaySize();
        if (w <= 0 || h <= 0) return;

        canvas.width = w;
        canvas.height = h;
        setCanvasSize({ w, h });

        // Draw image
        ctx.drawImage(img, 0, 0, w, h);

        // Dim overlay
        ctx.fillStyle = 'rgba(0,0,0,0.15)';
        ctx.fillRect(0, 0, w, h);

        // Draw horizontal lines
        const sortedH = [...hLines].sort((a, b) => a - b);
        const sortedV = [...vLines].sort((a, b) => a - b);

        ctx.setLineDash([8, 4]);
        ctx.lineWidth = 2;

        sortedH.forEach(pos => {
            const y = pos * h;
            ctx.strokeStyle = '#ff6b6b';
            ctx.beginPath();
            ctx.moveTo(0, y);
            ctx.lineTo(w, y);
            ctx.stroke();

            // Handle dot
            ctx.setLineDash([]);
            ctx.fillStyle = '#ff6b6b';
            ctx.beginPath();
            ctx.arc(w / 2, y, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.setLineDash([8, 4]);
        });

        sortedV.forEach(pos => {
            const x = pos * w;
            ctx.strokeStyle = '#4ecdc4';
            ctx.beginPath();
            ctx.moveTo(x, 0);
            ctx.lineTo(x, h);
            ctx.stroke();

            ctx.setLineDash([]);
            ctx.fillStyle = '#4ecdc4';
            ctx.beginPath();
            ctx.arc(x, h / 2, 5, 0, Math.PI * 2);
            ctx.fill();
            ctx.setLineDash([8, 4]);
        });

        ctx.setLineDash([]);

        // Draw cell numbers
        const allH = [0, ...sortedH, 1];
        const allV = [0, ...sortedV, 1];
        let cellNum = 1;
        ctx.font = 'bold 16px -apple-system, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';

        for (let row = 0; row < allH.length - 1; row++) {
            for (let col = 0; col < allV.length - 1; col++) {
                const cx = ((allV[col] + allV[col + 1]) / 2) * w;
                const cy = ((allH[row] + allH[row + 1]) / 2) * h;

                // Badge background
                ctx.fillStyle = 'rgba(0,0,0,0.55)';
                ctx.beginPath();
                ctx.arc(cx, cy, 14, 0, Math.PI * 2);
                ctx.fill();

                ctx.fillStyle = '#fff';
                ctx.fillText(String(cellNum), cx, cy);
                cellNum++;
            }
        }

        // Draw preview line
        if (previewPos && addMode) {
            ctx.setLineDash([4, 4]);
            ctx.lineWidth = 1.5;
            ctx.strokeStyle = addMode === 'h' ? 'rgba(255,107,107,0.6)' : 'rgba(78,205,196,0.6)';
            ctx.beginPath();
            if (addMode === 'h') {
                ctx.moveTo(0, previewPos.y);
                ctx.lineTo(w, previewPos.y);
            } else {
                ctx.moveTo(previewPos.x, 0);
                ctx.lineTo(previewPos.x, h);
            }
            ctx.stroke();
            ctx.setLineDash([]);
        }
    }, [imgRef, hLines, vLines, computeDisplaySize, previewPos, addMode]);

    // Redraw on state changes
    useEffect(() => { draw(); }, [draw]);

    // Resize observer
    useEffect(() => {
        const container = containerRef.current;
        if (!container) return;
        const observer = new ResizeObserver(() => draw());
        observer.observe(container);
        return () => observer.disconnect();
    }, [draw]);

    // Get canvas-local mouse position
    const getCanvasPos = (e: React.MouseEvent): { x: number; y: number } | null => {
        const canvas = canvasRef.current;
        if (!canvas) return null;
        const rect = canvas.getBoundingClientRect();
        return { x: e.clientX - rect.left, y: e.clientY - rect.top };
    };

    // Find line near cursor (within 8px)
    const findNearLine = (pos: { x: number; y: number }): { type: 'h' | 'v'; index: number } | null => {
        const threshold = 8;
        for (let i = 0; i < hLines.length; i++) {
            if (Math.abs(hLines[i] * canvasSize.h - pos.y) < threshold) return { type: 'h', index: i };
        }
        for (let i = 0; i < vLines.length; i++) {
            if (Math.abs(vLines[i] * canvasSize.w - pos.x) < threshold) return { type: 'v', index: i };
        }
        return null;
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        e.preventDefault();
        const pos = getCanvasPos(e);
        if (!pos) return;

        // Right-click = delete line
        if (e.button === 2) {
            const near = findNearLine(pos);
            if (near) {
                if (near.type === 'h') {
                    onHLinesChange(hLines.filter((_, i) => i !== near.index));
                } else {
                    onVLinesChange(vLines.filter((_, i) => i !== near.index));
                }
            }
            return;
        }

        // Left-click in add mode = add a line
        if (addMode) {
            if (addMode === 'h') {
                const normalized = pos.y / canvasSize.h;
                if (normalized > 0.02 && normalized < 0.98) {
                    onHLinesChange([...hLines, normalized]);
                }
            } else {
                const normalized = pos.x / canvasSize.w;
                if (normalized > 0.02 && normalized < 0.98) {
                    onVLinesChange([...vLines, normalized]);
                }
            }
            setAddMode(null);
            setPreviewPos(null);
            return;
        }

        // Left-click on existing line = start dragging
        const near = findNearLine(pos);
        if (near) {
            setDragging(near);
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        const pos = getCanvasPos(e);
        if (!pos) return;

        if (dragging) {
            const { type, index } = dragging;
            if (type === 'h') {
                const normalized = Math.max(0.01, Math.min(0.99, pos.y / canvasSize.h));
                const newLines = [...hLines];
                newLines[index] = normalized;
                onHLinesChange(newLines);
            } else {
                const normalized = Math.max(0.01, Math.min(0.99, pos.x / canvasSize.w));
                const newLines = [...vLines];
                newLines[index] = normalized;
                onVLinesChange(newLines);
            }
            return;
        }

        if (addMode) {
            setPreviewPos(pos);
            return;
        }

        // Change cursor near existing lines
        const canvas = canvasRef.current;
        if (canvas) {
            const near = findNearLine(pos);
            if (near) {
                canvas.style.cursor = near.type === 'h' ? 'ns-resize' : 'ew-resize';
            } else {
                canvas.style.cursor = addMode ? 'crosshair' : 'default';
            }
        }
    };

    const handleMouseUp = () => {
        setDragging(null);
    };

    const handleContextMenu = (e: React.MouseEvent) => {
        e.preventDefault();
    };

    const totalCells = (hLines.length + 1) * (vLines.length + 1);

    return (
        <div className="vkf-split-editor">
            <div className="vkf-split-editor-toolbar">
                <div className="vkf-split-editor-title">
                    ✂️ 裁切线编辑器
                    {splitQueueTotal && splitQueueTotal > 1 && (
                        <span className="vkf-split-editor-badge" style={{ background: 'rgba(102,126,234,0.3)', color: '#a5b4fc' }}>
                            第 {splitQueueCurrent}/{splitQueueTotal} 张
                        </span>
                    )}
                    <span className="vkf-split-editor-badge">
                        {hLines.length + vLines.length} 条线 · {totalCells} 格
                    </span>
                </div>
                <button className="vkf-btn" onClick={onClose} style={{ padding: '4px 10px', fontSize: 11 }}>
                    ✕ 关闭
                </button>
            </div>

            {/* Quick presets row */}
            <div className="vkf-split-presets">
                <button className="vkf-btn vkf-btn-success" onClick={onAutoDetect} style={{ fontSize: 11, padding: '4px 8px' }}>
                    🔍 自动检测
                </button>
                <span className="vkf-split-preset-divider">|</span>
                {[[2,2],[3,3],[4,3],[4,5],[5,4],[5,5],[5,6],[6,4],[6,5],[7,6],[8,7],[9,8],[10,9],[2,1],[3,1],[4,1],[1,2],[1,3]].map(([r,c]) => (
                    <button
                        key={`${r}x${c}`}
                        className="vkf-btn"
                        onClick={() => { setCustomRows(r); setCustomCols(c); onSetGrid(r, c); }}
                        style={{ fontSize: 11, padding: '3px 7px', minWidth: 0 }}
                        title={`${r}行 × ${c}列 = ${r * c}格`}
                    >
                        {r}×{c}
                    </button>
                ))}
                <span className="vkf-split-preset-divider">|</span>
                <div className="vkf-split-custom-grid">
                    <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginRight: 2 }}>行</span>
                    <input
                        type="number"
                        min={1}
                        max={20}
                        value={customRows}
                        onChange={e => setCustomRows(Math.max(1, Math.min(20, Number(e.target.value))))}
                        className="vkf-split-grid-input"
                        title="行数（横向分割）"
                        placeholder="行"
                    />
                    <span style={{ color: 'rgba(255,255,255,0.4)', fontSize: 11 }}>×</span>
                    <input
                        type="number"
                        min={1}
                        max={20}
                        value={customCols}
                        onChange={e => setCustomCols(Math.max(1, Math.min(20, Number(e.target.value))))}
                        className="vkf-split-grid-input"
                        title="列数（纵向分割）"
                        placeholder="列"
                    />
                    <span style={{ color: 'rgba(255,255,255,0.45)', fontSize: 10, marginRight: 2 }}>列</span>
                    <button
                        className="vkf-btn vkf-btn-primary"
                        onClick={() => onSetGrid(customRows, customCols)}
                        style={{ fontSize: 11, padding: '3px 8px', minWidth: 0 }}
                    >
                        应用
                    </button>
                </div>
            </div>

            {/* Add line buttons */}
            <div className="vkf-split-add-row">
                <button
                    className={`vkf-btn ${addMode === 'h' ? 'vkf-btn-active-h' : ''}`}
                    onClick={() => setAddMode(addMode === 'h' ? null : 'h')}
                    style={{ fontSize: 11, padding: '4px 10px' }}
                >
                    ➕ 添加横线
                </button>
                <button
                    className={`vkf-btn ${addMode === 'v' ? 'vkf-btn-active-v' : ''}`}
                    onClick={() => setAddMode(addMode === 'v' ? null : 'v')}
                    style={{ fontSize: 11, padding: '4px 10px' }}
                >
                    ➕ 添加竖线
                </button>
                <button
                    className="vkf-btn vkf-btn-danger"
                    onClick={() => { onHLinesChange([]); onVLinesChange([]); }}
                    style={{ fontSize: 11, padding: '4px 10px' }}
                >
                    🗑️ 清空
                </button>
                <span style={{ flex: 1 }} />
                <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                    拖拽调整 · 右键删除
                </span>
            </div>

            {/* Canvas area */}
            <div className="vkf-split-canvas-container" ref={containerRef}>
                <canvas
                    ref={canvasRef}
                    className={`vkf-split-canvas ${addMode ? 'adding' : ''}`}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={() => { setDragging(null); setPreviewPos(null); }}
                    onContextMenu={handleContextMenu}
                />
            </div>

            {/* Confirm */}
            <div className="vkf-split-confirm">
                {splitQueueTotal && splitQueueTotal > 1 && splitQueueCurrent && splitQueueCurrent < splitQueueTotal ? (
                    <>
                        <button
                            className="vkf-btn"
                            onClick={onSplit}
                            disabled={hLines.length === 0 && vLines.length === 0}
                            style={{ justifyContent: 'center', padding: '12px', fontSize: 13 }}
                        >
                            ✂️ 仅拆分当前
                        </button>
                        <button
                            className="vkf-btn vkf-btn-primary"
                            onClick={onSplitAndNext}
                            disabled={hLines.length === 0 && vLines.length === 0}
                            style={{ flex: 1, justifyContent: 'center', padding: '12px', fontSize: 14, fontWeight: 'bold' }}
                        >
                            ✂️ 拆分为 {totalCells} 张 → 下一张 ({(splitQueueCurrent || 0) + 1}/{splitQueueTotal})
                        </button>
                    </>
                ) : (
                    <button
                        className="vkf-btn vkf-btn-primary"
                        onClick={splitQueueTotal && splitQueueTotal > 1 ? onSplitAndNext : onSplit}
                        disabled={hLines.length === 0 && vLines.length === 0}
                        style={{ flex: 1, justifyContent: 'center', padding: '12px', fontSize: 14, fontWeight: 'bold' }}
                    >
                        ✂️ 按裁切线拆分为 {totalCells} 张图{splitQueueTotal && splitQueueTotal > 1 ? '（最后一张）' : ''}
                    </button>
                )}
            </div>
        </div>
    );
};

// ========== Component ==========
const VideoKeyframeApp: React.FC<VideoKeyframeAppProps> = ({ getAiInstance, textModel }) => {
    // --- State ---
    const [entryMode, setEntryMode] = useState<'video' | 'storyboard' | 'split'>('video');
    const [videoSrc, setVideoSrc] = useState<string | null>(null);
    const [videoName, setVideoName] = useState('');
    const [videoDuration, setVideoDuration] = useState(0);
    const [videoAspect, setVideoAspect] = useState(16 / 9);
    const [frames, setFrames] = useState<FrameData[]>([]);
    const [groups, setGroups] = useState<VideoGroup[]>([]);
    const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
    const [interval, setInterval_] = useState(2);
    const [generating, setGenerating] = useState(false);
    const [genProgress, setGenProgress] = useState({ done: 0, total: 0 });
    const [dragging, setDragging] = useState(false);
    const [toast, setToast] = useState<{ msg: string; type: 'success' | 'error' | 'info' } | null>(null);
    const [uploadProgress, setUploadProgress] = useState<{ done: number; total: number } | null>(null);
    const [thumbWidth, setThumbWidth] = useState(100);
    const [urlInput, setUrlInput] = useState('');
    const [storyboardCount, setStoryboardCount] = useState(9);
    const [storyboardCreateMode, setStoryboardCreateMode] = useState<StoryboardCreateMode>('describe');
    const [storyboardStyle, setStoryboardStyle] = useState('电影写实');
    const [storyboardContext, setStoryboardContext] = useState('');
    const [storyboardCustomInstruction, setStoryboardCustomInstruction] = useState(DEFAULT_DESCRIBE_INSTRUCTION);
    const [storyboardDraftVersion, setStoryboardDraftVersion] = useState(0);
    const [storyboardPrompts, setStoryboardPrompts] = useState<StoryboardPrompt[]>([]);
    const [storyboardGenerating, setStoryboardGenerating] = useState(false);
    const [storyboardImporting, setStoryboardImporting] = useState(false);
    const [storyAnalysis, setStoryAnalysis] = useState('');
    const [storyRevision, setStoryRevision] = useState('');
    const [storyAnalyzing, setStoryAnalyzing] = useState(false);
    const [autoFrameAnalyzing, setAutoFrameAnalyzing] = useState(false);
    const [storyRevisionInstruction, setStoryRevisionInstruction] = useState('');
    const [storyRevisionDraftVersion, setStoryRevisionDraftVersion] = useState(0);
    const [storyAnalysisCollapsed, setStoryAnalysisCollapsed] = useState(false);
    const [storyRevisionCollapsed, setStoryRevisionCollapsed] = useState(false);

    // --- Split Crop Editor state ---
    const [splitEditorImage, setSplitEditorImage] = useState<string | null>(null);
    const [splitHLines, setSplitHLines] = useState<number[]>([]);
    const [splitVLines, setSplitVLines] = useState<number[]>([]);
    const splitImgRef = useRef<HTMLImageElement | null>(null);
    const [splitQueue, setSplitQueue] = useState<FrameData[]>([]);
    const [splitQueueIndex, setSplitQueueIndex] = useState(0);

    const [leftWidth, setLeftWidth] = useState(340);
    const [rightWidth, setRightWidth] = useState(460);
    const [resizingPanel, setResizingPanel] = useState<'left' | 'right' | null>(null);

    const videoRef = useRef<HTMLVideoElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const storyboardFileInputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef(false);
    const framesRef = useRef<FrameData[]>([]);
    const storyboardContextRef = useRef('');
    const storyboardInstructionRef = useRef(DEFAULT_DESCRIBE_INSTRUCTION);
    const storyRevisionInstructionRef = useRef('');
    const tabSwitchingRef = useRef(false);
    const [tabs, setTabs] = useState<VideoKeyframeTab[]>(() => [createVideoKeyframeTab('tab_1', '标签 1')]);
    const [activeTabId, setActiveTabId] = useState('tab_1');
    // Keep framesRef in sync
    useEffect(() => { framesRef.current = frames; }, [frames]);

    const applyTabState = useCallback((tab: VideoKeyframeTab) => {
        tabSwitchingRef.current = true;
        setActiveTabId(tab.id);
        setEntryMode(tab.entryMode);
        setVideoSrc(tab.videoSrc);
        setVideoName(tab.videoName);
        setVideoDuration(tab.videoDuration);
        setVideoAspect(tab.videoAspect);
        setFrames(tab.frames);
        setGroups(tab.groups);
        setActiveGroupId(null);
        setUrlInput(tab.urlInput);
        setInterval_(tab.interval);
        setStoryboardCount(tab.storyboardCount);
        setStoryboardCreateMode(tab.storyboardCreateMode);
        setStoryboardStyle(tab.storyboardStyle);
        setStoryboardContext(tab.storyboardContext);
        setStoryboardCustomInstruction(tab.storyboardCustomInstruction);
        setStoryboardPrompts(tab.storyboardPrompts);
        setStoryAnalysis(tab.storyAnalysis);
        setStoryRevision(tab.storyRevision);
        setStoryRevisionInstruction(tab.storyRevisionInstruction);
        storyboardContextRef.current = tab.storyboardContext;
        storyboardInstructionRef.current = tab.storyboardCustomInstruction;
        storyRevisionInstructionRef.current = tab.storyRevisionInstruction;
        setStoryboardDraftVersion(prev => prev + 1);
        setStoryRevisionDraftVersion(prev => prev + 1);
        setGenerating(false);
        setStoryAnalyzing(false);
        setStoryboardGenerating(false);
        setUploadProgress(null);
        setDownloading(null);
        window.setTimeout(() => {
            tabSwitchingRef.current = false;
        }, 0);
    }, []);

    useEffect(() => {
        if (tabSwitchingRef.current) return;
        setTabs(prev => prev.map(tab => tab.id === activeTabId ? {
            ...tab,
            entryMode,
            videoSrc,
            videoName,
            videoDuration,
            videoAspect,
            frames,
            groups,
            urlInput,
            interval,
            storyboardCount,
            storyboardCreateMode,
            storyboardStyle,
            storyboardContext,
            storyboardCustomInstruction,
            storyboardPrompts,
            storyAnalysis,
            storyRevision,
            storyRevisionInstruction,
        } : tab));
    }, [
        activeTabId,
        entryMode,
        frames,
        groups,
        interval,
        storyAnalysis,
        storyRevision,
        storyRevisionInstruction,
        storyboardContext,
        storyboardCount,
        storyboardCreateMode,
        storyboardCustomInstruction,
        storyboardPrompts,
        storyboardStyle,
        urlInput,
        videoAspect,
        videoDuration,
        videoName,
        videoSrc,
    ]);

    // Handle Resize
    useEffect(() => {
        if (!resizingPanel) return;

        const handleMouseMove = (e: MouseEvent) => {
            if (resizingPanel === 'left') {
                const newWidth = Math.max(260, Math.min(e.clientX, 600));
                setLeftWidth(newWidth);
            } else if (resizingPanel === 'right') {
                const newWidth = Math.max(300, Math.min(window.innerWidth - e.clientX, 800));
                setRightWidth(newWidth);
            }
        };

        const handleMouseUp = () => {
            setResizingPanel(null);
        };

        document.addEventListener('mousemove', handleMouseMove);
        document.addEventListener('mouseup', handleMouseUp);
        
        return () => {
            document.removeEventListener('mousemove', handleMouseMove);
            document.removeEventListener('mouseup', handleMouseUp);
        };
    }, [resizingPanel]);

    // --- Cache system (localStorage) ---
    const CACHE_KEY = 'vkf_tabs_cache_v2';
    // Save to cache when tabs change
    useEffect(() => {
        if (tabs.length === 0) return;
        try {
            const cache = { 
                activeTabId, 
                tabs: tabs.map(tab => ({
                    ...tab,
                    frames: tab.frames.map(f => ({ ...f, uploading: false })),
                })),
                savedAt: Date.now() 
            };
            localStorage.setItem(CACHE_KEY, JSON.stringify(cache));
        } catch (e) {
            console.warn('[VKF] Cache save failed:', e);
        }
    }, [tabs, activeTabId]);

    // Restore cache on mount
    useEffect(() => {
        try {
            const raw = localStorage.getItem(CACHE_KEY);
            if (!raw) {
                // Fallback to v1 for backwards compatibility
                const rawV1 = localStorage.getItem('vkf_cache_v1');
                if (rawV1) {
                    const cacheV1 = JSON.parse(rawV1);
                    if (cacheV1.frames?.length > 0) {
                        setFrames(cacheV1.frames);
                        setGroups(cacheV1.groups || []);
                        console.log(`[VKF] Restored ${cacheV1.frames.length} frames from v1 cache`);
                    }
                }
                return;
            }
            
            const cache = JSON.parse(raw);
            if (cache.tabs && Array.isArray(cache.tabs)) {
                setTabs(cache.tabs);
                if (cache.activeTabId) {
                    setActiveTabId(cache.activeTabId);
                    const activeTab = cache.tabs.find((t: any) => t.id === cache.activeTabId) || cache.tabs[0];
                    if (activeTab) {
                        applyTabState(activeTab);
                    }
                } else {
                    applyTabState(cache.tabs[0]);
                }
                console.log(`[VKF] Restored ${cache.tabs.length} tabs from cache`);
            }
        } catch (e) { 
            console.warn('[VKF] Cache restore failed:', e);
        }
    }, []); // eslint-disable-line react-hooks/exhaustive-deps

    // Toast helper
    const showToast = useCallback((msg: string, type: 'success' | 'error' | 'info' = 'info') => {
        setToast({ msg, type });
        setTimeout(() => setToast(null), 3000);
    }, []);

    const switchWorkspaceTab = useCallback((tabId: string) => {
        if (tabId === activeTabId) return;
        const tab = tabs.find(item => item.id === tabId);
        if (!tab) return;
        applyTabState(tab);
    }, [activeTabId, applyTabState, tabs]);

    const addWorkspaceTab = useCallback(() => {
        const index = tabs.length + 1;
        const tab = createVideoKeyframeTab(`tab_${Date.now()}`, `标签 ${index}`);
        setTabs(prev => [...prev, tab]);
        applyTabState(tab);
        showToast(`已新建 ${tab.name}`, 'success');
    }, [applyTabState, showToast, tabs.length]);

    const closeWorkspaceTab = useCallback((tabId: string) => {
        if (tabs.length <= 1) {
            const fresh = createVideoKeyframeTab('tab_1', '标签 1');
            setTabs([fresh]);
            applyTabState(fresh);
            showToast('已清空当前标签页', 'info');
            return;
        }

        const closeIndex = tabs.findIndex(tab => tab.id === tabId);
        const nextTabs = tabs.filter(tab => tab.id !== tabId);
        setTabs(nextTabs);
        if (tabId === activeTabId) {
            const nextTab = nextTabs[Math.max(0, closeIndex - 1)] || nextTabs[0];
            applyTabState(nextTab);
        }
    }, [activeTabId, applyTabState, showToast, tabs]);

    const clearCache = useCallback(() => {
        localStorage.removeItem(CACHE_KEY);
        localStorage.removeItem('vkf_cache_v1');
        setFrames([]);
        setGroups([]);
        setStoryboardPrompts([]);
        setStoryAnalysis('');
        setStoryRevision('');
        showToast('缓存已清除', 'info');
    }, [showToast]);

    const normalizeBridgeStoryboardCount = useCallback((count?: number) => {
        const options = [3, 6, 9, 12];
        if (!count) return 9;
        return options.reduce((best, item) => Math.abs(item - count) < Math.abs(best - count) ? item : best, 9);
    }, []);

    const importHookStoryboardPayload = useCallback((payload: HookStoryboardBridgePayload | null | undefined) => {
        if (!payload) return;

        const count = normalizeBridgeStoryboardCount(payload.storyboardCount);
        const storyText = [
            payload.storyOutlineZh || payload.direction || '',
            payload.characterAnchorZh ? `角色锚定：${payload.characterAnchorZh}` : '',
            payload.visualTone ? `视觉基调：${payload.visualTone}` : '',
        ].filter(Boolean).join('\n\n');

        const customInstruction = [
            DEFAULT_CREATE_INSTRUCTION,
            '来自“黄金三秒 · 故事版”的导演脚本。请保留黄金三秒开场钩子、三幕结构、情绪曲线和逐镜头节奏，但重新扩写为多宫格电影分镜图片描述词。',
            payload.shotLines ? `原故事版分镜参考：\n${payload.shotLines}` : '',
            payload.storyboardZh ? `原分镜脚本：\n${payload.storyboardZh}` : '',
        ].filter(Boolean).join('\n\n');

        setEntryMode('storyboard');
        setStoryboardCreateMode('create');
        setStoryboardCount(count);
        setStoryboardContext(storyText);
        setStoryboardCustomInstruction(customInstruction);
        storyboardContextRef.current = storyText;
        storyboardInstructionRef.current = customInstruction;
        setStoryboardDraftVersion(prev => prev + 1);
        setStoryboardPrompts([]);

        const bridgeImages = payload.images || [];
        if (bridgeImages.length > 0) {
            const groupId = `hook_storyboard_${payload.createdAt || Date.now()}`;
            const newFrames: FrameData[] = bridgeImages.map((img, index) => {
                const mimeType = img.mimeType || 'image/jpeg';
                const data = String(img.data || '').replace(/^data:image\/[^;]+;base64,/, '');
                return {
                    index,
                    time: index,
                    dataUrl: `data:${mimeType};base64,${data}`,
                    selected: true,
                    groupId,
                };
            });

            setFrames(prev => [
                ...prev.map(frame => ({ ...frame, selected: false })),
                ...newFrames,
            ]);
            setGroups(prev => [
                ...prev.map(group => ({ ...group, collapsed: true })),
                {
                    id: groupId,
                    name: '黄金三秒参考图',
                    blobUrl: '',
                    frameCount: newFrames.length,
                    duration: newFrames.length,
                    collapsed: false,
                },
            ]);
            showToast(`✅ 已导入黄金三秒故事版和 ${newFrames.length} 张参考图`, 'success');
        } else {
            setFrames(prev => prev.map(frame => ({ ...frame, selected: false })));
            showToast('✅ 已导入黄金三秒故事版文本', 'success');
        }
    }, [normalizeBridgeStoryboardCount, showToast]);

    useEffect(() => {
        const consumeStoredBridge = () => {
            try {
                const raw = localStorage.getItem(STORYBOARD_BRIDGE_KEY);
                if (!raw) return;
                localStorage.removeItem(STORYBOARD_BRIDGE_KEY);
                importHookStoryboardPayload(JSON.parse(raw));
            } catch (err) {
                console.warn('[VKF] Failed to import hook storyboard payload:', err);
            }
        };

        const handleBridge = (e: Event) => {
            importHookStoryboardPayload((e as CustomEvent<HookStoryboardBridgePayload>).detail);
        };

        consumeStoredBridge();
        window.addEventListener(STORYBOARD_BRIDGE_EVENT, handleBridge);
        return () => window.removeEventListener(STORYBOARD_BRIDGE_EVENT, handleBridge);
    }, [importHookStoryboardPayload]);

    const fileToDataUrl = useCallback((file: File): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(reader.result as string);
            reader.onerror = reject;
            reader.readAsDataURL(file);
        });
    }, []);

    const addStoryboardImageFiles = useCallback(async (files: File[]) => {
        const imageFiles = files.filter(file => file.type.startsWith('image/'));
        if (imageFiles.length === 0) {
            showToast('没有识别到图片文件', 'error');
            return;
        }

        const groupId = 'storyboard_uploads';
        const startIndex = Math.max(-1, ...framesRef.current.filter(f => f.groupId === groupId).map(f => f.index)) + 1;
        const newFrames: FrameData[] = [];

        for (let i = 0; i < imageFiles.length; i++) {
            const file = imageFiles[i];
            const dataUrl = await fileToDataUrl(file);
            newFrames.push({
                index: startIndex + i,
                time: startIndex + i,
                dataUrl,
                selected: true,
                groupId,
            });
        }

        setEntryMode(prev => prev === 'video' ? 'storyboard' : prev);
        setFrames(prev => [...prev, ...newFrames]);
        setGroups(prev => {
            const existing = prev.find(g => g.id === groupId);
            const frameCount = (existing?.frameCount || 0) + newFrames.length;
            if (existing) {
                return prev.map(g => g.id === groupId ? { ...g, frameCount, collapsed: false } : g);
            }
            return [...prev, {
                id: groupId,
                name: '上传的分镜图片',
                blobUrl: '',
                frameCount,
                duration: frameCount,
                collapsed: false,
            }];
        });
        showToast(`✅ 已添加 ${newFrames.length} 张分镜图片`, 'success');
    }, [fileToDataUrl, showToast]);

    const addStoryboardImageUrls = useCallback(async (rawText: string) => {
        const parsed = parsePasteInput(rawText);
        if (parsed.length === 0) {
            showToast('没有识别到图片链接或 =IMAGE() 公式', 'error');
            return;
        }

        setStoryboardImporting(true);
        const files: File[] = [];

        for (let i = 0; i < parsed.length; i++) {
            try {
                const { blob, mimeType } = await fetchImageBlob(parsed[i].url);
                const ext = mimeType.includes('png') ? 'png' : mimeType.includes('webp') ? 'webp' : 'jpg';
                files.push(new File([blob], `storyboard-url-${Date.now()}-${i}.${ext}`, { type: mimeType || 'image/jpeg' }));
            } catch (err) {
                console.warn('[VKF] image url import failed:', parsed[i].url, err);
            }
        }

        setStoryboardImporting(false);
        if (files.length === 0) {
            showToast('图片链接下载失败，请检查链接权限或改为本地上传', 'error');
            return;
        }

        await addStoryboardImageFiles(files);
        if (files.length < parsed.length) {
            showToast(`已导入 ${files.length}/${parsed.length} 张，部分链接无法下载`, 'info');
        }
    }, [addStoryboardImageFiles, showToast]);

    const handleStoryboardPaste = useCallback(async (e: React.ClipboardEvent<HTMLElement>) => {
        const clipboard = e.clipboardData;
        if (!clipboard) return;

        const files = Array.from(clipboard.files || []).filter(file => file.type.startsWith('image/'));
        if (files.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            await addStoryboardImageFiles(files);
            return;
        }

        const items = Array.from(clipboard.items || []);
        const imageFiles = items
            .filter(item => item.type.startsWith('image/'))
            .map(item => item.getAsFile())
            .filter(Boolean) as File[];
        if (imageFiles.length > 0) {
            e.preventDefault();
            e.stopPropagation();
            await addStoryboardImageFiles(imageFiles);
            return;
        }

        const html = clipboard.getData('text/html');
        if (html) {
            const urls = extractUrlsFromHtml(html);
            if (urls.length > 0) {
                e.preventDefault();
                e.stopPropagation();
                await addStoryboardImageUrls(urls.map(item => item.fetchUrl || item.originalUrl).join('\n'));
                return;
            }
        }

        const text = clipboard.getData('text/plain') || clipboard.getData('text');
        if (text && (text.includes('http') || text.includes('=IMAGE'))) {
            e.preventDefault();
            e.stopPropagation();
            await addStoryboardImageUrls(text);
        }
    }, [addStoryboardImageFiles, addStoryboardImageUrls]);

    // --- Video Loading ---
    const loadVideo = useCallback((file: File) => {
        const videoExts = ['.mp4', '.mov', '.mkv', '.avi', '.wmv', '.flv', '.webm', '.m4v'];
        const ext = file.name.toLowerCase().substring(file.name.lastIndexOf('.'));
        if (!videoExts.includes(ext)) {
            showToast('不支持的视频格式: ' + file.name, 'error');
            return;
        }
        const url = URL.createObjectURL(file);
        setVideoSrc(url);
        setVideoName(file.name);
        setVideoDuration(0);
    }, [showToast]);

    // Load multiple files sequentially
    const loadMultipleFiles = useCallback((files: File[]) => {
        if (files.length === 1) { loadVideo(files[0]); return; }
        // For multiple files, load first, queue rest
        loadVideo(files[0]);
        if (files.length > 1) showToast(`已加载 ${files[0].name}，共 ${files.length} 个文件待处理`, 'info');
    }, [loadVideo, showToast]);

    // --- URL Loading (fetch as blob to avoid CORS canvas taint) ---
    const [downloading, setDownloading] = useState<{ loaded: number; total: number; stage?: string } | null>(null);

    // Extract direct video URL from Facebook/Instagram page
    const extractSocialVideoUrl = useCallback(async (pageUrl: string): Promise<string> => {
        // Helper: decode Facebook's escaped URLs
        const decodeFbUrl = (raw: string): string => {
            return raw
                .replace(/\\\//g, '/')
                .replace(/\\u0025/g, '%')
                .replace(/\\u0026/g, '&')
                .replace(/&amp;/g, '&')
                .replace(/\\u003C/gi, '<')
                .replace(/\\u003E/gi, '>');
        };

        // Helper: try to extract video URL from HTML text
        const extractFromHtml = (html: string): string | null => {
            // 1. playable_url (HD first)
            const hdPlay = html.match(/"playable_url_quality_hd"\s*:\s*"([^"]+)"/);
            if (hdPlay) return decodeFbUrl(hdPlay[1]);

            const sdPlay = html.match(/"playable_url"\s*:\s*"([^"]+)"/);
            if (sdPlay) return decodeFbUrl(sdPlay[1]);

            // 2. browser_native URLs
            const nHd = html.match(/"browser_native_hd_url"\s*:\s*"([^"]+)"/);
            if (nHd) return decodeFbUrl(nHd[1]);
            const nSd = html.match(/"browser_native_sd_url"\s*:\s*"([^"]+)"/);
            if (nSd) return decodeFbUrl(nSd[1]);

            // 3. hd_src / sd_src
            const hdSrc = html.match(/"hd_src"\s*:\s*"([^"]+)"/);
            if (hdSrc) return decodeFbUrl(hdSrc[1]);
            const sdSrc = html.match(/"sd_src"\s*:\s*"([^"]+)"/);
            if (sdSrc) return decodeFbUrl(sdSrc[1]);

            // 4. og:video meta tag
            const ogMatch = html.match(/<meta[^>]+property=["']og:video(?::url)?["'][^>]+content=["']([^"']+)["']/i)
                || html.match(/<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:video(?::url)?["']/i);
            if (ogMatch) {
                const decoded = ogMatch[1].replace(/&amp;/g, '&');
                if (decoded.includes('.mp4') || decoded.includes('fbcdn')) return decoded;
            }

            // 5. Generic fbcdn video URL in source
            const fbcdn = html.match(/https?:\\?\/\\?\/[^"'\s]*?scontent[^"'\s]*?\.mp4[^"'\s]*/i)
                || html.match(/https?:\\?\/\\?\/[^"'\s]*?video[^"'\s]*?fbcdn[^"'\s]*?\.mp4[^"'\s]*/i);
            if (fbcdn) return decodeFbUrl(fbcdn[0]);

            return null;
        };

        // === Tier 1: Microlink API (most reliable for public videos) ===
        try {
            setDownloading({ loaded: 0, total: 0, stage: '🔍 Microlink 解析...' });
            const mlResp = await fetch(`https://api.microlink.io/?url=${encodeURIComponent(pageUrl)}&video=true&audio=false`);
            if (mlResp.ok) {
                const mlData = await mlResp.json();
                const videoUrl = mlData?.data?.video?.url;
                if (videoUrl && (videoUrl.includes('.mp4') || videoUrl.includes('fbcdn') || videoUrl.includes('video'))) {
                    console.log('[VKF] Microlink extracted:', videoUrl.substring(0, 80));
                    return videoUrl;
                }
            }
        } catch (err) {
            console.warn('[VKF] Microlink failed:', err);
        }

        // === Tier 2: CORS proxy + mobile Facebook (simpler HTML) ===
        const mobileUrl = pageUrl.replace('www.facebook.com', 'm.facebook.com');
        const proxyUrls = [
            `https://api.allorigins.win/raw?url=${encodeURIComponent(mobileUrl)}`,
            `https://api.allorigins.win/raw?url=${encodeURIComponent(pageUrl)}`,
            `https://corsproxy.io/?url=${encodeURIComponent(mobileUrl)}`,
            `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(mobileUrl)}`,
        ];

        for (const proxyUrl of proxyUrls) {
            try {
                setDownloading({ loaded: 0, total: 0, stage: '🔍 代理解析...' });
                const resp = await fetch(proxyUrl);
                if (!resp.ok) continue;
                const html = await resp.text();
                if (html.length < 500) continue; // Too short, probably error page

                const found = extractFromHtml(html);
                if (found) {
                    console.log('[VKF] Proxy extracted from:', proxyUrl.substring(0, 50));
                    return found;
                }
            } catch (err) {
                console.warn('[VKF] Proxy failed:', proxyUrl.substring(0, 50), err);
                continue;
            }
        }

        throw new Error('无法从页面提取视频链接');
    }, []);

    // Download video blob with progress
    const fetchVideoAsBlob = useCallback(async (videoUrl: string): Promise<Blob> => {
        setDownloading({ loaded: 0, total: 0, stage: '下载视频...' });

        const resp = await fetch(videoUrl);
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);

        const contentLength = Number(resp.headers.get('content-length') || 0);
        const reader = resp.body?.getReader();
        if (!reader) throw new Error('No stream');

        const chunks: Uint8Array[] = [];
        let loaded = 0;

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            chunks.push(value);
            loaded += value.length;
            setDownloading({ loaded, total: contentLength, stage: '下载视频...' });
        }

        return new Blob(chunks, { type: resp.headers.get('content-type') || 'video/mp4' });
    }, []);

    const loadVideoFromUrl = useCallback(async (rawUrl: string) => {
        const url = rawUrl.trim();
        if (!url) return;

        // Detect social media page URLs that need extraction
        const isFacebookPage = /^https?:\/\/(www\.)?(facebook|fb)\.(com|watch)\/(watch|reel|video|.*\/videos\/)/i.test(url);
        const isInstagramPage = /^https?:\/\/(www\.)?instagram\.com\/(reel|p)\//i.test(url);
        const needsExtraction = isFacebookPage || isInstagramPage;

        let videoUrl = url;
        let name = '在线视频';

        try {
            if (needsExtraction) {
                showToast('🔍 正在解析社交媒体链接...', 'info');
                videoUrl = await extractSocialVideoUrl(url);
                console.log('[VKF] Extracted video URL:', videoUrl.substring(0, 100));
                const idMatch = url.match(/\/(?:reel|videos?)\/(\d+)/);
                name = isFacebookPage
                    ? `Facebook_Reel_${idMatch?.[1] || 'video'}.mp4`
                    : `Instagram_Reel_${idMatch?.[1] || 'video'}.mp4`;
            } else {
                try {
                    const pathname = new URL(url).pathname;
                    const lastSegment = pathname.split('/').filter(Boolean).pop();
                    if (lastSegment && lastSegment.includes('.')) {
                        name = decodeURIComponent(lastSegment);
                        if (name.length > 60) name = name.substring(0, 57) + '...';
                    }
                } catch { /* ignore */ }
            }

            const blob = await fetchVideoAsBlob(videoUrl);
            const blobUrl = URL.createObjectURL(blob);
            setVideoSrc(blobUrl);
            setVideoName(name);
            setVideoDuration(0);
            setDownloading(null);

            const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
            showToast(`✅ 视频已下载 (${sizeMB} MB)`, 'success');
        } catch (err) {
            setDownloading(null);
            console.error('[VKF] URL load failed:', err);
            const msg = needsExtraction
                ? '❌ 解析失败 — 视频可能是私密的，或平台限制了访问'
                : '❌ 视频下载失败 — 可能是跨域限制或链接已失效';
            showToast(msg, 'error');
        }
    }, [showToast, extractSocialVideoUrl, fetchVideoAsBlob]);

    // Batch URL processing
    const [batchQueue, setBatchQueue] = useState<string[]>([]);
    const [batchIndex, setBatchIndex] = useState(0);

    const loadBatchUrls = useCallback((text: string) => {
        const urls = text.split('\n').map(s => s.trim()).filter(Boolean);
        if (urls.length === 0) return;
        setUrlInput('');
        if (urls.length === 1) {
            loadVideoFromUrl(urls[0]);
        } else {
            setBatchQueue(urls);
            setBatchIndex(0);
            loadVideoFromUrl(urls[0]);
            showToast(`📋 批量加载: 1/${urls.length}`, 'info');
        }
    }, [loadVideoFromUrl, showToast]);

    const handleVideoError = useCallback(() => {
        showToast('❌ 视频加载失败 — 可能是跨域限制或链接已失效，请尝试下载后拖入', 'error');
    }, [showToast]);

    const handleVideoLoaded = useCallback(() => {
        const video = videoRef.current;
        if (!video) return;
        setVideoDuration(video.duration);
        if (video.videoWidth && video.videoHeight) {
            setVideoAspect(video.videoWidth / video.videoHeight);
        }
    }, []);

    // --- Drag & Drop (multi-file) ---
    const handleDragOver = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(true);
    }, []);
    const handleDragLeave = useCallback(() => setDragging(false), []);
    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        setDragging(false);
        const files = Array.from(e.dataTransfer.files);
        if (files.length > 0) loadMultipleFiles(files);
    }, [loadMultipleFiles]);
    const handleFileSelect = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length > 0) loadMultipleFiles(files);
        if (fileInputRef.current) fileInputRef.current.value = '';
    }, [loadMultipleFiles]);

    // --- Frame Extraction ---
    const generateFrames = useCallback(async () => {
        const video = videoRef.current;
        if (!video || !video.duration || video.duration === Infinity) {
            showToast('视频未加载', 'error');
            return;
        }

        abortRef.current = false;
        setGenerating(true);
        
        const prevFrames = framesRef.current; // 捕获当前已有的帧，支持多视频拼接

        const duration = video.duration;
        const totalFrames = Math.floor(duration / interval) + 1;
        setGenProgress({ done: 0, total: totalFrames });

        // Offscreen canvas
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        // Use native resolution for maximum quality
        const tw = video.videoWidth;
        const th = video.videoHeight;
        canvas.width = tw;
        canvas.height = th;

        const wasPaused = video.paused;
        const savedTime = video.currentTime;
        video.pause();

        const newFrames: FrameData[] = [];

        for (let i = 0; i < totalFrames; i++) {
            if (abortRef.current) break;
            const time = Math.min(i * interval, duration - 0.01);

            video.currentTime = time;
            await new Promise<void>((resolve) => {
                const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
                video.addEventListener('seeked', onSeeked);
                setTimeout(resolve, 800);
            });

            ctx.drawImage(video, 0, 0, tw, th);
            let dataUrl: string;
            try {
                dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            } catch {
                // Tainted canvas — remote URL without CORS
                showToast('❌ 跨域视频无法截帧，请下载视频后拖入', 'error');
                setGenerating(false);
                video.currentTime = savedTime;
                return;
            }

            const frame: FrameData = { index: i, time, dataUrl, selected: false, groupId: videoName };
            newFrames.push(frame);

            // Batch update every 5 frames for performance
            if (i % 5 === 0 || i === totalFrames - 1) {
                setFrames([...prevFrames, ...newFrames]);
                setGenProgress({ done: i + 1, total: totalFrames });
                await new Promise(r => setTimeout(r, 0));
            }
        }

        setGenProgress({ done: totalFrames, total: totalFrames });
        setGenerating(false);

        // Register group
        const gid = videoName;
        setGroups(prev => {
            const existing = prev.find(g => g.id === gid);
            if (existing) {
                return prev.map(g => g.id === gid ? { ...g, frameCount: newFrames.length, duration: video.duration } : g);
            }
            return [...prev, {
                id: gid, name: videoName, blobUrl: videoSrc || '',
                frameCount: newFrames.length, duration: video.duration, collapsed: false
            }];
        });

        // Restore video state
        video.currentTime = savedTime;
        if (!wasPaused) video.play();

        if (!abortRef.current) {
            showToast(`✅ 已生成 ${newFrames.length} 帧 (${videoName})`, 'success');
        }
    }, [interval, showToast, videoName, videoSrc]);

    const buildFrameStoryParts = useCallback((sourceFrames: FrameData[], prompt: string) => {
        const parts: any[] = [];
        sourceFrames.forEach((frame, index) => {
            const mimeType = frame.dataUrl.match(/^data:(image\/[^;]+);base64,/)?.[1] || 'image/jpeg';
            const data = frame.dataUrl.split(',')[1] || frame.dataUrl;
            parts.push({
                text: `[关键帧 ${index + 1}] 时间点：${fmtTime(frame.time)}，原帧编号：${frame.index + 1}`,
            });
            parts.push({ inlineData: { mimeType, data } });
        });
        parts.push({ text: prompt });
        return parts;
    }, []);

    const autoExtractAndAnalyze = useCallback(async () => {
        const video = videoRef.current;
        if (!video || !video.duration || video.duration === Infinity) {
            showToast('视频未加载', 'error');
            return;
        }

        abortRef.current = false;
        setAutoFrameAnalyzing(true);
        setGenerating(true);
        
        const prevFrames = framesRef.current; // Keep existing frames

        const duration = video.duration;
        const totalFrames = Math.floor(duration / interval) + 1;
        setGenProgress({ done: 0, total: totalFrames });

        // Offscreen canvas
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const tw = video.videoWidth;
        const th = video.videoHeight;
        canvas.width = tw;
        canvas.height = th;

        const wasPaused = video.paused;
        const savedTime = video.currentTime;
        video.pause();

        const newFrames: FrameData[] = [];

        for (let i = 0; i < totalFrames; i++) {
            if (abortRef.current) break;
            const time = Math.min(i * interval, duration - 0.01);

            video.currentTime = time;
            await new Promise<void>((resolve) => {
                const onSeeked = () => { video.removeEventListener('seeked', onSeeked); resolve(); };
                video.addEventListener('seeked', onSeeked);
                setTimeout(resolve, 800);
            });

            ctx.drawImage(video, 0, 0, tw, th);
            let dataUrl: string;
            try {
                dataUrl = canvas.toDataURL('image/jpeg', 0.8);
            } catch {
                showToast('❌ 跨域视频无法截帧，请下载视频后拖入', 'error');
                setGenerating(false);
                setAutoFrameAnalyzing(false);
                video.currentTime = savedTime;
                return;
            }

            const frame: FrameData = { index: i, time, dataUrl, selected: true, groupId: videoName };
            newFrames.push(frame);

            // Batch update every 5 frames for performance
            if (i % 5 === 0 || i === totalFrames - 1) {
                setFrames([...prevFrames, ...newFrames]);
                setGenProgress({ done: i + 1, total: totalFrames });
                await new Promise(r => setTimeout(r, 0));
            }
        }

        setGenProgress({ done: totalFrames, total: totalFrames });
        setGenerating(false);

        const gid = videoName;
        setGroups(prev => {
            const existing = prev.find(g => g.id === gid);
            if (existing) {
                return prev.map(g => g.id === gid ? { ...g, frameCount: newFrames.length, duration: video.duration } : g);
            }
            return [...prev, {
                id: gid, name: videoName, blobUrl: videoSrc || '',
                frameCount: newFrames.length, duration: video.duration, collapsed: false
            }];
        });

        video.currentTime = savedTime;
        if (!wasPaused) video.play();

        if (abortRef.current || newFrames.length === 0) {
            setAutoFrameAnalyzing(false);
            return;
        }

        showToast(`✅ 已提取并选中 ${newFrames.length} 帧，正在自动分析...`, 'info');
        
        // -- Start Analysis --
        if (!getAiInstance) {
            showToast('当前工具未接入 AI 实例，无法分析故事', 'error');
            setAutoFrameAnalyzing(false);
            return;
        }

        setStoryAnalyzing(true);
        setStoryAnalysis('');
        setStoryRevision('');

        try {
            const ai: any = getAiInstance();
            const prompt = `你是短视频故事导演和剪辑分析师。请根据用户提供的 ${newFrames.length} 张关键帧，按时间顺序分析这条视频背后的故事。

要求：
- 只输出中文。
- 不要生成图片。
- 根据关键帧推断故事，但要标注哪些是“画面可见”，哪些是“合理推断”。
- 如果关键帧之间有缺口，请合理补全转场，但不要胡编与画面冲突的角色或事件。
- 请输出以下结构：

## 故事概述
用一段话说清这条视频大概讲了什么。

## 逐帧剧情线
按关键帧顺序列出每一帧的画面内容、可能动作、剧情功能。

## 主体/人物/场景设定
总结主体、人物关系、场景、时代感、视觉风格。

## 情绪节奏
说明开场、发展、转折、高潮、结尾的情绪变化。

## 当前故事问题
指出叙事不清、动机不足、节奏拖沓、缺少冲突或结尾弱等问题。

## 可改版方向
给出 3 个不同改版方向，每个方向说明核心钩子、冲突、结尾。`;

            const response = await ai.models.generateContent({
                model: textModel || 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: buildFrameStoryParts(newFrames, prompt) }],
                config: {
                    temperature: 0.55,
                    maxOutputTokens: 12000,
                },
            });

            const text = extractResponseText(response).trim();
            if (!text) throw new Error('AI 未返回故事分析');
            setStoryAnalysis(text);
            setStoryRevisionInstruction('');
            storyRevisionInstructionRef.current = '';
            setStoryRevisionDraftVersion(prev => prev + 1);
            showToast('✅ 已完成自动提取与故事分析', 'success');
        } catch (err) {
            console.error('[VKF] Auto story analysis failed:', err);
            const message = err instanceof Error ? err.message : String(err || '');
            if (/429|RESOURCE_EXHAUSTED|quota|rate/i.test(message)) {
                showToast('AI 请求受限或额度不足，提取成功但分析失败', 'error');
            } else if (/token|too large|payload|413|Request Entity/i.test(message)) {
                showToast('输入内容过大，无法自动分析（请减少截帧）', 'error');
            } else {
                showToast('故事分析失败，但截帧已完成', 'error');
            }
        } finally {
            setStoryAnalyzing(false);
            setAutoFrameAnalyzing(false);
        }
    }, [interval, showToast, videoName, videoSrc, getAiInstance, buildFrameStoryParts, textModel]);

    const captureCurrentFrame = useCallback(() => {
        const video = videoRef.current;
        if (!video || !video.duration || video.duration === Infinity) {
            showToast('无法截取，视频未就绪', 'error');
            return;
        }

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d')!;
        const tw = video.videoWidth;
        const th = video.videoHeight;
        canvas.width = tw;
        canvas.height = th;

        ctx.drawImage(video, 0, 0, tw, th);
        let dataUrl: string;
        try {
            dataUrl = canvas.toDataURL('image/jpeg', 0.8);
        } catch {
            showToast('❌ 跨域视频无法截帧，请下载视频后拖入', 'error');
            return;
        }

        const time = video.currentTime;
        // Use a high-resolution timestamp approach for index to avoid collision
        const frame: FrameData = { 
            index: Math.floor(time * 1000), 
            time, 
            dataUrl, 
            selected: true, 
            groupId: videoName 
        };

        setFrames(prev => {
            const newArr = [...prev, frame];
            return newArr.sort((a, b) => a.groupId.localeCompare(b.groupId) || a.time - b.time || a.index - b.index);
        });

        const gid = videoName;
        setGroups(prev => {
            const existing = prev.find(g => g.id === gid);
            if (existing) {
                return prev.map(g => g.id === gid ? { ...g, frameCount: existing.frameCount + 1 } : g);
            }
            return [...prev, {
                id: gid, name: videoName, blobUrl: videoSrc || '',
                frameCount: 1, duration: video.duration, collapsed: false
            }];
        });

        showToast(`📸 已手动截取 ${fmtTime(time)} 的画面`, 'success');
    }, [videoName, videoSrc, showToast]);

    const stopGeneration = useCallback(() => {
        abortRef.current = true;
    }, []);

    // --- Frame Selection (supports per-group or global) ---
    const toggleFrame = useCallback((groupId: string, index: number) => {
        setFrames(prev => prev.map(f =>
            f.groupId === groupId && f.index === index ? { ...f, selected: !f.selected } : f
        ));
    }, []);

    const deleteSingleFrame = useCallback((groupId: string, index: number) => {
        setFrames(prev => {
            const nextFrames = prev.filter(f => !(f.groupId === groupId && f.index === index));
            setGroups(prevGroups => prevGroups.filter(g => nextFrames.some(f => f.groupId === g.id)));
            return nextFrames;
        });
    }, []);

    const selectAll = useCallback((groupId?: string) => {
        setFrames(prev => prev.map(f =>
            (!groupId || f.groupId === groupId) ? { ...f, selected: true } : f
        ));
    }, []);

    const deselectAll = useCallback((groupId?: string) => {
        setFrames(prev => prev.map(f =>
            (!groupId || f.groupId === groupId) ? { ...f, selected: false } : f
        ));
    }, []);

    const invertSelection = useCallback((groupId?: string) => {
        setFrames(prev => prev.map(f =>
            (!groupId || f.groupId === groupId) ? { ...f, selected: !f.selected } : f
        ));
    }, []);

    const selectedCount = frames.filter(f => f.selected).length;

    const getSelectedFramesSorted = useCallback(() => {
        return frames
            .filter(f => f.selected)
            .sort((a, b) => a.groupId.localeCompare(b.groupId) || a.time - b.time || a.index - b.index);
    }, [frames]);

    // --- Storyboard prompt generation ---
    const getStoryboardFrames = useCallback(() => {
        const selected = getSelectedFramesSorted();
        return storyboardCreateMode === 'create'
            ? selected
            : selected.slice(0, storyboardCount);
    }, [getSelectedFramesSorted, storyboardCount, storyboardCreateMode]);

    const buildStoryboardInstruction = useCallback((inputCount: number, outputCount: number, storyText?: string) => {
        const contextText = getDraftText(storyboardContextRef.current, storyboardContext).trim();
        const customInstructionText = getDraftText(storyboardInstructionRef.current, storyboardCustomInstruction).trim();
        let modeInstruction = '';
        
        if (storyText) {
            const isGrokMode = storyboardCreateMode === 'grok_video';
            modeInstruction = `模式：纯故事大纲生成分镜描述词。
- 你必须生成 ${outputCount} 格全新的电影分镜画面，完整覆盖以下故事内容：
${storyText}
${isGrokMode ? '- 每一格代表 1-2 秒的视频镜头，写出明确的起止时间。\n- “镜头”必须是摄影机运动（例如：快速推进、缓慢拉出、环绕拍摄等）。' : ''}`;
        } else if (storyboardCreateMode === 'create') {
            modeInstruction = `模式：参考图生成新故事分镜。
- 用户提供的 ${inputCount} 张图片都是参考图，不是最终分镜格。
- 你必须生成 ${outputCount} 格全新的电影分镜画面。
- 参考图用于锁定主体、人物长相、服装、道具、场景元素、色调、光线、时代感和视觉风格。
- 每格要有镜头推进关系：建立镜头、行动镜头、反应镜头、特写、转折、高潮、收束等，不能只是复述参考图。`;
        } else if (storyboardCreateMode === 'grok_video') {
            modeInstruction = `模式：按参考图生成 GROK 视频分镜脚本。
- 用户提供的 ${inputCount} 张图片是视觉参考，你需要生成 ${outputCount} 格视频分镜。
- 请为一段视频规划连贯的镜头。
- 每一格代表 1-2 秒的视频镜头，写出明确的起止时间。
- “镜头”必须是摄影机运动（例如：快速推进、缓慢拉出、环绕拍摄等）。`;
        } else {
            modeInstruction = `模式：按图反推分镜描述词。
- 用户提供的 ${inputCount} 张图片就是要描述的分镜格。
- 请按输入顺序逐张输出，最多输出 ${outputCount} 格。
- 每格必须忠实描述对应图片，不要新编故事或改动主体。`;
        }

        let coreRequirements = '';
        if (storyText) {
            coreRequirements = `- **绝对优先遵循故事大纲**：必须严格按照我提供的故事剧情为主轴，将其推演为 ${outputCount} 个连续的分镜画面。
- 保持同一人物/主体、服装、时代背景、色彩和摄影风格在所有分镜中连续一致。`;
        } else {
            coreRequirements = `- 先认真看图，不要只概括。必须把画面里可见的信息尽量说清楚：人物/主体是谁、外貌年龄气质、发型五官、服装颜色款式、姿势动作、手部动作、道具、环境地点、前景/中景/背景、空间层次、材质纹理、光源方向、阴影、色温、色彩关系、情绪氛围。
- 如果参考图或关键帧里看不清细节，请基于画面合理补全，但不要引入与原画面冲突的新主体。
- 保持同一人物/主体、服装、时代背景、色彩和摄影风格连续一致。`;
        }

        const isGrok = storyboardCreateMode === 'grok_video';

        return `你是资深电影分镜导演、摄影指导和 AI 图像提示词专家。请生成“多宫格电影分镜板”的每格 AI 图片描述词。

${modeInstruction}

核心质量要求：
${coreRequirements}
- 每格“描述词”必须是一段完整、具体、可直接使用的提示词。长度由画面复杂度决定，不要为了凑字数重复废话，也不要过度简写。
${isGrok ? '' : '- 每格“描述词”都必须明确包含：9:16 竖版画面，画面比例 9/16。'}
- 每格都要适合直接粘贴到 AI 工具生成${isGrok ? '视频' : '图片'}。
- 不要输出空泛词，例如“电影感画面”“精美构图”“高质量”单独堆砌；这些可以有，但必须建立在具体视觉细节之后。
- 不要把不同格写成同一句模板。每格要有明确的镜头差异、动作差异和视觉重点。
- **绝对禁止**：科幻元素、未来科技、赛博朋克、魔法特效。但允许故事中出现天使、宗教人物等文化/信仰元素，这些不算科幻。
- **色调约束**：不要使用浓烈的电影调色（青橙、蓝绿、高对比等好莱坞调色）。色调必须接近普通手机自然拍摄，自然白平衡，正常曝光，日常生活记录感。
- **画面真实性**：所有画面必须像真人用手机或普通相机拍摄的日常记录，禁止出现任何明显的AI合成痕迹、过度柔光、过度锐化或不自然的完美感。
- **禁止台词/对白**：描述词只描述画面视觉内容，不要写任何人物台词、对话、旁白、字幕文字。人物可以有表情和肢体动作，但不要张嘴说话。
- **场景贴近生活**：所有场景必须是普通人日常生活中真实存在的场所（家里、街道、公园、办公室、餐厅、学校等），不要出现另类、夸张、戏剧化的布景或不符合日常生活的奇异环境。

输出格式要求：
- 只输出中文。
- 每格单独输出，格式必须严格使用：
=== PANEL 1 ===
标题：一句短标题
镜头：镜头类型 + 景别 + 机位
描述词：完整详细的 AI 生图描述词
- 必须严格输出 ${outputCount} 个 PANEL，从 PANEL 1 到 PANEL ${outputCount}。
- 不要生成图片，不要写操作说明。
- “标题”字段：${isGrok ? '必须写这格视频的时间段，例如：0:00-0:01' : '一句短标题'}
- “镜头”字段：${isGrok ? '必须是具体的摄影机运动（例如：快速推进、平移、跟拍）和景别' : '必须具体，例如：35mm 中景平视跟拍、俯拍全景等'}
- “描述词”字段：${isGrok ? '画面主体内容、具体动作和环境变化的详细描述，直接用于生视频。' : '建议按这个顺序组织成自然语言：主体与动作 → 场景与道具 → 构图与景别 → 光线与色彩 → 材质与画质 → 情绪与风格。'}
- 风格：${storyboardStyle || '电影写实'}。
${contextText ? `- 故事/场景方向：${contextText}` : ''}
${customInstructionText ? `- 用户自定义指令：${customInstructionText}` : ''}
- 如果用户自定义指令和以上质量要求冲突，优先保证描述词详细、准确、可直接用于生图。`;
    }, [storyboardCreateMode, storyboardCustomInstruction, storyboardContext, storyboardStyle]);

    const generateStoryboardPrompts = useCallback(async () => {
        const sourceFrames = getStoryboardFrames();
        if (sourceFrames.length === 0) {
            showToast('请先选择要生成分镜词的关键帧', 'error');
            return;
        }
        if (!getAiInstance) {
            showToast('当前工具未接入 AI 实例，无法识别图片生成描述词', 'error');
            return;
        }
        setStoryboardGenerating(true);
        setStoryboardPrompts([]);

        try {
            const ai: any = getAiInstance();
            const parts: any[] = [];

            sourceFrames.forEach((frame, index) => {
                const mimeType = frame.dataUrl.match(/^data:(image\/[^;]+);base64,/)?.[1] || 'image/jpeg';
                const data = frame.dataUrl.split(',')[1] || frame.dataUrl;
                parts.push({
                    text: storyboardCreateMode === 'create'
                        ? `[参考图 ${index + 1}] 原编号：${frame.index + 1}`
                        : `[PANEL ${index + 1}] 视频时间点：${fmtTime(frame.time)}，原帧编号：${frame.index + 1}`
                });
                parts.push({ inlineData: { mimeType, data } });
            });
            const outputCount = (storyboardCreateMode === 'create' || storyboardCreateMode === 'grok_video')
                ? storyboardCount
                : Math.min(sourceFrames.length, storyboardCount);
            parts.push({ text: buildStoryboardInstruction(sourceFrames.length, outputCount) });

            const response = await ai.models.generateContent({
                model: textModel || 'gemini-2.5-flash',
                contents: [{ role: 'user', parts }],
                config: {
                    temperature: 0.65,
                    maxOutputTokens: Math.min(24000, 2200 * outputCount),
                },
            });

            const text = extractResponseText(response).trim();
            const parseFrames = (storyboardCreateMode === 'create' || storyboardCreateMode === 'grok_video')
                ? Array.from({ length: outputCount }, (_, index) => sourceFrames[index % sourceFrames.length])
                : sourceFrames;
            const parsed = parseStoryboardPrompts(text, parseFrames);
            if (parsed.length === 0) throw new Error('AI 未按分镜格式返回结果');

            setStoryboardPrompts(parsed);
            showToast(`✅ 已生成 ${parsed.length} 格电影分镜描述词`, 'success');
        } catch (err) {
            console.error('[VKF] Storyboard prompt generation failed:', err);
            const message = err instanceof Error ? err.message : String(err || '');
            if (message.includes('AI 未按分镜格式返回结果')) {
                showToast('AI 返回格式不对：没有识别到 PANEL 分镜，请重试或简化自定义指令', 'error');
            } else if (/429|RESOURCE_EXHAUSTED|quota|rate/i.test(message)) {
                showToast('AI 请求受限或额度不足，请稍后重试', 'error');
            } else if (/token|too large|payload|413|Request Entity/i.test(message)) {
                showToast('输入内容过大，请减少参考图或缩短自定义指令', 'error');
            } else {
                showToast('生成分镜描述词失败，请检查参考图/指令后重试', 'error');
            }
        } finally {
            setStoryboardGenerating(false);
        }
    }, [buildStoryboardInstruction, getAiInstance, getStoryboardFrames, showToast, storyboardCount, storyboardCreateMode, textModel]);

    const generateStoryboardFromStory = useCallback(async () => {
        if (!storyRevision) {
            showToast('请先改版故事', 'error');
            return;
        }
        if (!getAiInstance) {
            showToast('当前工具未接入 AI 实例，无法生成分镜词', 'error');
            return;
        }
        setStoryboardGenerating(true);
        setStoryboardPrompts([]);
        
        try {
            const ai: any = getAiInstance();
            const parts: any[] = [];
            
            const storyText = storyRevision;
            const instruction = buildStoryboardInstruction(0, storyboardCount, storyText);


            parts.push({ text: instruction });
            
            const response = await ai.models.generateContent({
                model: textModel || 'gemini-2.5-flash',
                contents: [{ role: 'user', parts }],
                config: {
                    temperature: 0.65,
                    maxOutputTokens: Math.min(24000, 2200 * storyboardCount),
                },
            });
            
            const text = extractResponseText(response).trim();
            const parsed = parseStoryboardPrompts(text, []);
            if (parsed.length === 0) throw new Error('AI 未按分镜格式返回结果');
            
            setStoryboardPrompts(parsed);
            showToast(`✅ 已根据故事生成 ${parsed.length} 格分镜描述词`, 'success');
        } catch (err) {
            console.error('[VKF] Generate storyboard from story failed:', err);
            const message = err instanceof Error ? err.message : String(err || '');
            if (message.includes('AI 未按分镜格式返回结果')) {
                showToast('AI 返回格式不对：没有识别到 PANEL 分镜，请重试', 'error');
            } else if (/429|RESOURCE_EXHAUSTED|quota|rate/i.test(message)) {
                showToast('AI 请求受限或额度不足，请稍后重试', 'error');
            } else if (/token|too large|payload|413|Request Entity/i.test(message)) {
                showToast('输入内容过大，请减少参考图', 'error');
            } else {
                showToast('生成分镜描述词失败，请检查故事后重试', 'error');
            }
        } finally {
            setStoryboardGenerating(false);
        }
    }, [storyRevision, storyAnalysis, getAiInstance, storyboardCount, textModel, parseStoryboardPrompts, showToast, buildStoryboardInstruction]);



    const analyzeSelectedFrameStory = useCallback(async () => {
        const sourceFrames = getSelectedFramesSorted();
        if (sourceFrames.length === 0) {
            showToast('请先选择要分析故事的关键帧', 'error');
            return;
        }
        if (!getAiInstance) {
            showToast('当前工具未接入 AI 实例，无法分析故事', 'error');
            return;
        }

        setStoryAnalyzing(true);
        setStoryAnalysis('');
        setStoryRevision('');

        try {
            const ai: any = getAiInstance();
            const prompt = `你是短视频故事导演和剪辑分析师。请根据用户提供的 ${sourceFrames.length} 张关键帧，按时间顺序分析这条视频背后的故事。

要求：
- 只输出中文。
- 不要生成图片。
- 根据关键帧推断故事，但要标注哪些是“画面可见”，哪些是“合理推断”。
- 如果关键帧之间有缺口，请合理补全转场，但不要胡编与画面冲突的角色或事件。
- 请输出以下结构：

## 故事概述
用一段话说清这条视频大概讲了什么。

## 逐帧剧情线
按关键帧顺序列出每一帧的画面内容、可能动作、剧情功能。

## 主体/人物/场景设定
总结主体、人物关系、场景、时代感、视觉风格。

## 情绪节奏
说明开场、发展、转折、高潮、结尾的情绪变化。

## 当前故事问题
指出叙事不清、动机不足、节奏拖沓、缺少冲突或结尾弱等问题。

## 可改版方向
给出 3 个不同改版方向，每个方向说明核心钩子、冲突、结尾。`;

            const response = await ai.models.generateContent({
                model: textModel || 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: buildFrameStoryParts(sourceFrames, prompt) }],
                config: {
                    temperature: 0.55,
                    maxOutputTokens: 12000,
                },
            });

            const text = extractResponseText(response).trim();
            if (!text) throw new Error('AI 未返回故事分析');
            setStoryAnalysis(text);
            setStoryRevisionInstruction('');
            storyRevisionInstructionRef.current = '';
            setStoryRevisionDraftVersion(prev => prev + 1);
            showToast('✅ 已完成关键帧故事分析', 'success');
        } catch (err) {
            console.error('[VKF] Story analysis failed:', err);
            const message = err instanceof Error ? err.message : String(err || '');
            if (/429|RESOURCE_EXHAUSTED|quota|rate/i.test(message)) {
                showToast('AI 请求受限或额度不足，请稍后重试', 'error');
            } else if (/token|too large|payload|413|Request Entity/i.test(message)) {
                showToast('输入内容过大，请减少关键帧或缩短要求', 'error');
            } else {
                showToast('故事分析失败，请检查关键帧后重试', 'error');
            }
        } finally {
            setStoryAnalyzing(false);
        }
    }, [buildFrameStoryParts, getAiInstance, getSelectedFramesSorted, showToast, textModel]);

    const reviseSelectedFrameStory = useCallback(async () => {
        const sourceFrames = getSelectedFramesSorted();
        if (sourceFrames.length === 0) {
            showToast('请先选择要改版故事的关键帧', 'error');
            return;
        }
        if (!storyAnalysis.trim()) {
            showToast('请先分析故事，再生成改版', 'error');
            return;
        }
        if (!getAiInstance) {
            showToast('当前工具未接入 AI 实例，无法改版故事', 'error');
            return;
        }

        const instruction = getDraftText(storyRevisionInstructionRef.current, storyRevisionInstruction).trim();
        if (!instruction) {
            showToast('请先输入改版要求', 'error');
            return;
        }

        setStoryAnalyzing(true);
        setStoryRevision('');

        try {
            const ai: any = getAiInstance();
            const prompt = `你是短视频故事导演、编剧和分镜改版师。请根据关键帧、原故事分析和用户改版要求，重写一个更清晰、更有吸引力的视频故事方案。

原故事分析：
${storyAnalysis}

用户改版要求：
${instruction}

输出要求：
- 只输出中文。
- 不要生成图片。
- 保留关键帧中已经出现的主体、人物、场景和视觉风格，除非用户明确要求改变。
- 可以调整叙事顺序、动机、冲突、情绪节奏和结尾。
- 生成的是“改版后的故事方案”，不是普通建议。
- 请输出以下结构：

## 改版故事一句话
用一句话说清新故事。

## 新故事梗概
完整讲清起因、发展、转折、高潮和结尾。

## 黄金三秒开场
给出 3 个开场钩子版本。

## 逐帧改版剧情
按当前关键帧顺序说明每一帧应该承担的剧情功能、画面含义、角色动作或字幕方向。

## 情绪节奏表
按开场、铺垫、冲突、转折、高潮、结尾写情绪变化。

## 可直接用于分镜生成的新版描述
把新故事拆成 ${Math.min(sourceFrames.length, storyboardCount)} 个关键画面，每个画面写：画面内容、镜头、动作、情绪。`;

            const response = await ai.models.generateContent({
                model: textModel || 'gemini-2.5-flash',
                contents: [{ role: 'user', parts: buildFrameStoryParts(sourceFrames, prompt) }],
                config: {
                    temperature: 0.7,
                    maxOutputTokens: 16000,
                },
            });

            const text = extractResponseText(response).trim();
            if (!text) throw new Error('AI 未返回改版故事');
            setStoryRevision(text);
            showToast('✅ 已生成改版故事', 'success');
        } catch (err) {
            console.error('[VKF] Story revision failed:', err);
            const message = err instanceof Error ? err.message : String(err || '');
            if (/429|RESOURCE_EXHAUSTED|quota|rate/i.test(message)) {
                showToast('AI 请求受限或额度不足，请稍后重试', 'error');
            } else if (/token|too large|payload|413|Request Entity/i.test(message)) {
                showToast('输入内容过大，请减少关键帧或缩短要求', 'error');
            } else {
                showToast('改版故事失败，请检查要求后重试', 'error');
            }
        } finally {
            setStoryAnalyzing(false);
        }
    }, [buildFrameStoryParts, getAiInstance, getSelectedFramesSorted, showToast, storyAnalysis, storyRevisionInstruction, storyboardCount, textModel]);

    const copyStoryText = useCallback((text: string, label: string) => {
        if (!text.trim()) {
            showToast('没有可复制的内容', 'error');
            return;
        }
        navigator.clipboard.writeText(text).then(() => {
            showToast(`✅ 已复制${label}`, 'success');
        }).catch(() => {
            showToast('复制失败', 'error');
        });
    }, [showToast]);

    const copyStoryboardPrompts = useCallback((mode: 'text' | 'tsv' | 'board' | 'document' | 'video_prompt') => {
        if (storyboardPrompts.length === 0) {
            showToast('还没有可复制的分镜描述词', 'error');
            return;
        }

        const sortedPrompts = [...storyboardPrompts].sort((a, b) => a.panel - b.panel);
        const layout = getStoryboardGridLayout(sortedPrompts.length);
        const text = mode === 'video_prompt'
            ? [
                `🎬 GROK 中文视频提示词`,
                `Prompt:`,
                `风格设定：${storyboardStyle || '电影级超写实风格'}。`,
                ...sortedPrompts.flatMap(item => [
                    item.prompt.replace(/9:16.*?16\s*/g, '').trim(),
                    `镜头：${item.shotType}`
                ]),
                `强调：无慢动作，全部为实时速度，动作干净利落。`,
                `超高细节，8K分辨率，电影级光影，体积光，真实物理模拟，史诗级视觉冲击。`
            ].join('\n\n')
            : mode === 'document'
            ? [
                `请生成一张高质量的电影分镜脚本排版设计图（工业级分镜表格文档）。这是一张完整的表格排版视觉图，请以 3:4 竖版呈现。`,
                `整体排版与设计风格：这是一张排版精细的专业表格文件，包含 ${sortedPrompts.length} 个分镜镜头（从 1 到 ${sortedPrompts.length}）。表格带有黑色清晰的网格线，布局整洁，白底黑字。`,
                `表头必须包含以下列名称（用醒目的字体排版）：【镜号】、【画面(示意图)】、【景别/镜头运动】、【画面内容/动作】、【时间】。`,
                `底部带有全局备注，写着：风格：${storyboardStyle || '电影写实'}，画面比例：9:16 竖版，带有强烈的光影细节。`,
                `请在【画面(示意图)】的列中，画出具体的高质量分镜草图或剧照，在其他列中写满对应的文字（如果太长可以用乱码或模糊文本排版代替，但排版看起来必须像密密麻麻的专业文字说明）。`,
                '',
                `具体画面内容依次为（仅供你作画参考，请将这些画面画在表格【画面(示意图)】对应的单元格里）：`,
                ...sortedPrompts.map(item => [
                    `第 ${item.panel} 镜（${item.title || ''}）：${item.shotType}。${item.prompt.replace(/9:16.*?16\s*/g, '').substring(0, 100)}...`,
                ].join('')),
                '',
                `要求：重点展示表格文档排版的严谨性和设计感，画面中的剧照呈现统一的电影质感。`
            ].join('\n')
            : mode === 'board'
            ? [
                `请生成一张 9:16 竖版电影分镜板，画面比例必须是 9/16，包含 ${sortedPrompts.length} 个分镜格，布局为${layout.label}。`,
                `整体风格：${storyboardStyle || '电影写实'}。`,
                '画面要求：所有分镜放在同一张竖版图片中，每个格子边界清晰，按从左到右、从上到下排列；人物、服装、场景时代、色彩和摄影风格保持连续一致；每个格子都是独立电影画面，不要互相串格。',
                '',
                ...sortedPrompts.map(item => [
                    `第 ${item.panel} 格：${item.title}`,
                    `镜头：${item.shotType}`,
                    `画面描述词：${withStoryboardAspectRatio(item.prompt)}`,
                ].join('\n')),
            ].join('\n\n')
            : mode === 'tsv'
                ? storyboardCreateMode === 'grok_video'
                    ? [
                        '镜号\t画面 (示意图)\t景别/镜头运动\t画面内容/动作\t时间',
                        ...sortedPrompts.map(item =>
                            [item.panel, '', item.shotType, item.prompt.replace(/\n/g, ' '), item.title].join('\t')
                        ),
                        `风格：${storyboardStyle || '电影写实'}，画面比例：16:9\t\t\t\t`,
                    ].join('\n')
                    : [
                        '宫格\t原帧\t时间点\t标题\t镜头\tAI描述词',
                        ...sortedPrompts.map(item =>
                            [item.panel, item.frameIndex + 1, fmtTime(item.time), item.title, item.shotType, withStoryboardAspectRatio(item.prompt).replace(/\n/g, ' ')].join('\t')
                        )
                    ].join('\n')
                : sortedPrompts.map(item =>
                `=== PANEL ${item.panel} ===\n原帧：#${item.frameIndex + 1} · ${fmtTime(item.time)}\n标题：${item.title}\n镜头：${item.shotType}\n描述词：${withStoryboardAspectRatio(item.prompt)}`
            ).join('\n\n');

        navigator.clipboard.writeText(text).then(() => {
            showToast(
                mode === 'video_prompt'
                    ? '✅ 已复制 GROK 视频提示词'
                    : mode === 'document'
                        ? '✅ 已复制分镜文档图描述词'
                        : mode === 'board'
                            ? '✅ 已复制整张分镜板提示词'
                            : mode === 'tsv'
                                ? '✅ 已复制表格格式分镜词'
                                : '✅ 已复制全部分镜描述词',
                'success'
            );
        }).catch(() => {
            showToast('复制失败', 'error');
        });
    }, [showToast, storyboardPrompts, storyboardStyle]);

    // --- Open split editor: load selected image into the crop canvas ---
    const openSplitEditor = useCallback(async () => {
        const selected = frames.filter(f => f.selected);
        if (selected.length === 0) {
            showToast('请先选中需要拆分的图片', 'error');
            return;
        }
        // Set up queue for multi-image splitting
        setSplitQueue(selected);
        setSplitQueueIndex(0);
        const source = selected[0];
        try {
            const img = await loadImageFromDataUrl(source.dataUrl);
            splitImgRef.current = img;
            setSplitEditorImage(source.dataUrl);
            setSplitHLines([]);
            setSplitVLines([]);
        } catch {
            showToast('图片加载失败', 'error');
        }
    }, [frames, showToast]);

    // --- Advance to next image in split queue ---
    const advanceToNextSplitImage = useCallback(async () => {
        const nextIndex = splitQueueIndex + 1;
        if (nextIndex >= splitQueue.length) {
            // Queue exhausted
            setSplitEditorImage(null);
            setSplitQueue([]);
            setSplitQueueIndex(0);
            return;
        }
        setSplitQueueIndex(nextIndex);
        const source = splitQueue[nextIndex];
        try {
            const img = await loadImageFromDataUrl(source.dataUrl);
            splitImgRef.current = img;
            setSplitEditorImage(source.dataUrl);
            setSplitHLines([]);
            setSplitVLines([]);
        } catch {
            showToast('图片加载失败，跳过', 'error');
            // Try next one recursively
            setSplitQueueIndex(nextIndex);
        }
    }, [splitQueue, splitQueueIndex, showToast]);

    // --- Auto-detect grid lines by scanning pixel rows/cols for uniform color bands ---
    const autoDetectGridLines = useCallback(() => {
        const img = splitImgRef.current;
        if (!img) return;

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        canvas.width = img.naturalWidth;
        canvas.height = img.naturalHeight;
        ctx.drawImage(img, 0, 0);

        const w = img.naturalWidth;
        const h = img.naturalHeight;
        const imageData = ctx.getImageData(0, 0, w, h);
        const data = imageData.data;

        // --- Compute average luminance for each row and column ---
        const sampleStepX = Math.max(1, Math.floor(w / 200));
        const sampleStepY = Math.max(1, Math.floor(h / 200));

        const rowLum = new Float32Array(h);
        const rowVar = new Float32Array(h);
        for (let y = 0; y < h; y++) {
            let sum = 0, sumSq = 0, count = 0;
            for (let x = 0; x < w; x += sampleStepX) {
                const idx = (y * w + x) * 4;
                const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
                sum += lum;
                sumSq += lum * lum;
                count++;
            }
            rowLum[y] = sum / count;
            rowVar[y] = sumSq / count - (sum / count) ** 2;
        }

        const colLum = new Float32Array(w);
        const colVar = new Float32Array(w);
        for (let x = 0; x < w; x++) {
            let sum = 0, sumSq = 0, count = 0;
            for (let y = 0; y < h; y += sampleStepY) {
                const idx = (y * w + x) * 4;
                const lum = data[idx] * 0.299 + data[idx + 1] * 0.587 + data[idx + 2] * 0.114;
                sum += lum;
                sumSq += lum * lum;
                count++;
            }
            colLum[x] = sum / count;
            colVar[x] = sumSq / count - (sum / count) ** 2;
        }

        // --- Detect edges: find rows/cols with low variance AND a luminance shift from neighbors ---
        const edgeMargin = 0.06;
        const minGapPx = 2;

        // Compute edge score for each row: combination of low variance + luminance difference from surroundings
        const detectGaps = (
            lumArr: Float32Array,
            varArr: Float32Array,
            size: number,
        ): number[] => {
            const windowSize = Math.max(3, Math.round(size * 0.01));

            // Compute a smoothed variance score for bands of rows
            const bandScore = new Float32Array(size);
            for (let i = 0; i < size; i++) {
                // Low variance = more uniform = more likely a separator
                bandScore[i] = varArr[i];
            }

            // Smooth the band score for gap DETECTION only (not for positioning)
            const smoothed = new Float32Array(size);
            const smoothWindow = Math.max(1, Math.floor(windowSize / 2));
            for (let i = 0; i < size; i++) {
                let s = 0, c = 0;
                for (let j = Math.max(0, i - smoothWindow); j <= Math.min(size - 1, i + smoothWindow); j++) {
                    s += bandScore[j];
                    c++;
                }
                smoothed[i] = s / c;
            }

            // Find low-variance bands (potential separators)
            // Adaptive threshold: use median variance as baseline
            const sortedVars = Array.from(smoothed).sort((a, b) => a - b);
            const medianVar = sortedVars[Math.floor(sortedVars.length * 0.5)];
            const q10Var = sortedVars[Math.floor(sortedVars.length * 0.1)];
            // Separator variance should be significantly lower than median
            const varThreshold = Math.min(
                q10Var + (medianVar - q10Var) * 0.4,
                medianVar * 0.35
            );

            // Scan for gap bands
            const gaps: number[] = [];
            let inGap = false;
            let gapStart = 0;
            const margin = Math.round(size * edgeMargin);

            for (let i = 0; i < size; i++) {
                if (smoothed[i] < varThreshold) {
                    if (!inGap) { inGap = true; gapStart = i; }
                } else {
                    if (inGap) {
                        const gapEnd = i;
                        const gapWidth = gapEnd - gapStart;
                        // Find the precise center: the pixel with minimum raw variance within this gap band
                        let minVar = Infinity;
                        let bestPos = (gapStart + gapEnd) / 2;
                        for (let k = gapStart; k < gapEnd; k++) {
                            if (varArr[k] < minVar) {
                                minVar = varArr[k];
                                bestPos = k;
                            }
                        }
                        if (gapWidth >= minGapPx && bestPos > margin && bestPos < size - margin) {
                            gaps.push(bestPos / size);
                        }
                        inGap = false;
                    }
                }
            }

            return gaps;
        };

        const rawHGaps = detectGaps(rowLum, rowVar, h);
        const rawVGaps = detectGaps(colLum, colVar, w);

        // --- Merge gaps that are too close (within 4%) ---
        const mergeClose = (arr: number[], threshold = 0.04): number[] => {
            if (arr.length === 0) return arr;
            const sorted = [...arr].sort((a, b) => a - b);
            const result: number[] = [sorted[0]];
            for (let i = 1; i < sorted.length; i++) {
                if (sorted[i] - result[result.length - 1] > threshold) {
                    result.push(sorted[i]);
                } else {
                    result[result.length - 1] = (result[result.length - 1] + sorted[i]) / 2;
                }
            }
            return result;
        };

        const mergedH = mergeClose(rawHGaps);
        const mergedV = mergeClose(rawVGaps);

        setSplitHLines(mergedH);
        setSplitVLines(mergedV);

        const totalCells = (mergedH.length + 1) * (mergedV.length + 1);
        showToast(`🔍 自动检测到 ${mergedH.length} 条横线 + ${mergedV.length} 条竖线 = ${totalCells} 格`, 'info');
    }, [showToast]);

    // --- Set uniform grid lines ---
    const setUniformGrid = useCallback((rows: number, cols: number) => {
        const hLines: number[] = [];
        const vLines: number[] = [];
        for (let i = 1; i < rows; i++) hLines.push(i / rows);
        for (let i = 1; i < cols; i++) vLines.push(i / cols);
        setSplitHLines(hLines);
        setSplitVLines(vLines);
    }, []);

    // --- Execute split with custom lines ---
    const splitWithCustomLines = useCallback(async () => {
        const img = splitImgRef.current;
        if (!img) {
            showToast('没有图片可拆分', 'error');
            return;
        }

        const w = img.naturalWidth;
        const h = img.naturalHeight;

        // Build pixel boundaries from normalized lines
        const hBounds = [0, ...splitHLines.sort((a, b) => a - b).map(v => Math.round(v * h)), h];
        const vBounds = [0, ...splitVLines.sort((a, b) => a - b).map(v => Math.round(v * w)), w];

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            showToast('浏览器不支持裁切', 'error');
            return;
        }

        const groupId = `custom_split_${Date.now()}`;
        const newFrames: FrameData[] = [];
        let panel = 0;

        for (let row = 0; row < hBounds.length - 1; row++) {
            for (let col = 0; col < vBounds.length - 1; col++) {
                const sx = vBounds[col];
                const sy = hBounds[row];
                const sw = vBounds[col + 1] - sx;
                const sh = hBounds[row + 1] - sy;

                if (sw <= 0 || sh <= 0) continue;

                canvas.width = sw;
                canvas.height = sh;
                ctx.clearRect(0, 0, sw, sh);
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

                newFrames.push({
                    index: panel,
                    time: panel,
                    dataUrl: canvas.toDataURL('image/jpeg', 0.95),
                    selected: true,
                    groupId,
                });
                panel++;
            }
        }

        if (newFrames.length === 0) {
            showToast('拆分结果为空，请调整裁切线', 'error');
            return;
        }

        setFrames(prev => [
            ...prev.map(frame => ({ ...frame, selected: false })),
            ...newFrames,
        ]);
        setGroups(prev => [
            ...prev.map(group => ({ ...group, collapsed: true })),
            {
                id: groupId,
                name: `自定义拆分 ${splitHLines.length + 1}×${splitVLines.length + 1}`,
                blobUrl: '',
                sourceDataUrl: splitEditorImage || undefined,
                frameCount: newFrames.length,
                duration: newFrames.length,
                collapsed: false,
            },
        ]);

        setSplitEditorImage(null);
        setSplitQueue([]);
        setSplitQueueIndex(0);
        showToast(`✅ 已拆分为 ${newFrames.length} 张单独图片`, 'success');
    }, [showToast, splitHLines, splitVLines]);

    // --- Split current and advance to next in queue ---
    const splitAndAdvance = useCallback(async () => {
        const img = splitImgRef.current;
        if (!img) {
            showToast('没有图片可拆分', 'error');
            return;
        }

        const w = img.naturalWidth;
        const h = img.naturalHeight;

        const hBounds = [0, ...splitHLines.sort((a, b) => a - b).map(v => Math.round(v * h)), h];
        const vBounds = [0, ...splitVLines.sort((a, b) => a - b).map(v => Math.round(v * w)), w];

        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) {
            showToast('浏览器不支持裁切', 'error');
            return;
        }

        const groupId = `custom_split_${Date.now()}`;
        const newFrames: FrameData[] = [];
        let panel = 0;

        for (let row = 0; row < hBounds.length - 1; row++) {
            for (let col = 0; col < vBounds.length - 1; col++) {
                const sx = vBounds[col];
                const sy = hBounds[row];
                const sw = vBounds[col + 1] - sx;
                const sh = hBounds[row + 1] - sy;

                if (sw <= 0 || sh <= 0) continue;

                canvas.width = sw;
                canvas.height = sh;
                ctx.clearRect(0, 0, sw, sh);
                ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);

                newFrames.push({
                    index: panel,
                    time: panel,
                    dataUrl: canvas.toDataURL('image/jpeg', 0.95),
                    selected: true,
                    groupId,
                });
                panel++;
            }
        }

        if (newFrames.length === 0) {
            showToast('拆分结果为空，请调整裁切线', 'error');
            return;
        }

        setFrames(prev => [
            ...prev.map(frame => ({
                ...frame,
                // Keep previously-split results selected, only deselect source uploads
                selected: frame.groupId?.startsWith('custom_split_') ? frame.selected : false,
            })),
            ...newFrames,
        ]);
        setGroups(prev => [
            ...prev.map(group => ({ ...group, collapsed: true })),
            {
                id: groupId,
                name: `自定义拆分 ${splitHLines.length + 1}×${splitVLines.length + 1}`,
                blobUrl: '',
                sourceDataUrl: splitEditorImage || undefined,
                frameCount: newFrames.length,
                duration: newFrames.length,
                collapsed: false,
            },
        ]);

        showToast(`✅ 第 ${splitQueueIndex + 1}/${splitQueue.length} 张已拆分为 ${newFrames.length} 张`, 'success');

        // Advance to next image in queue
        await advanceToNextSplitImage();
    }, [showToast, splitHLines, splitVLines, splitQueueIndex, splitQueue.length, advanceToNextSplitImage]);

    // --- Gyazo Upload ---
    const uploadSelectedToGyazo = useCallback(async () => {
        const selected = frames.filter(f => f.selected);
        if (selected.length === 0) {
            showToast('请先选择要上传的帧', 'error');
            return;
        }

        const token = getGyazoToken();
        if (!token) {
            showToast('未配置 Gyazo Token', 'error');
            return;
        }

        setUploadProgress({ done: 0, total: selected.length });
        let successCount = 0;

        for (let i = 0; i < selected.length; i++) {
            const frame = selected[i];

            // Mark as uploading
            setFrames(prev => prev.map(f =>
                f.index === frame.index ? { ...f, uploading: true } : f
            ));

            try {
                const baseName = videoName.replace(/\.[^.]+$/, '');
                const filename = `${baseName}_frame_${String(frame.index).padStart(3, '0')}.jpg`;
                const file = base64ToFile(frame.dataUrl, filename);
                if (!file) throw new Error('转换失败');

                const url = await uploadToGyazo(file, token);
                if (!url) throw new Error('上传失败');

                setFrames(prev => prev.map(f =>
                    f.index === frame.index ? { ...f, gyazoUrl: url, uploading: false } : f
                ));
                successCount++;
            } catch {
                setFrames(prev => prev.map(f =>
                    f.index === frame.index ? { ...f, uploading: false } : f
                ));
            }

            setUploadProgress({ done: i + 1, total: selected.length });

            // Rate limit: 300ms between uploads
            if (i < selected.length - 1) {
                await new Promise(r => setTimeout(r, 300));
            }
        }

        setUploadProgress(null);
        showToast(`✅ 上传完成: ${successCount}/${selected.length}`, successCount > 0 ? 'success' : 'error');
        return successCount;
    }, [frames, videoName, showToast]);

    // --- One-click: Upload + Copy =IMAGE() formula ---
    const uploadAndCopyFormula = useCallback(async () => {
        const selected = frames.filter(f => f.selected);
        if (selected.length === 0) {
            showToast('请先选择帧', 'error');
            return;
        }

        // Step 1: Upload frames that don't have gyazoUrl yet
        const needUpload = selected.filter(f => !f.gyazoUrl);
        if (needUpload.length > 0) {
            showToast(`⏫ 正在上传 ${needUpload.length} 帧到 Gyazo...`, 'info');
            await uploadSelectedToGyazo();
        }

        // Step 2: Build TSV with =IMAGE() formulas from latest frames state
        // We need to read frames again since uploadSelectedToGyazo updated them
        await new Promise(r => setTimeout(r, 100));
    }, [frames, showToast, uploadSelectedToGyazo]);

    // Effect-based: copy formulas after upload completes — uses ref for freshest state
    const copyFormulasFromFrames = useCallback(() => {
        const latest = framesRef.current;
        const selected = latest.filter(f => f.selected && f.gyazoUrl);
        if (selected.length === 0) {
            showToast('没有已上传的帧可复制', 'error');
            return;
        }

        const rows = selected.map(f =>
            `=IMAGE("${f.gyazoUrl}")\t${fmtTime(f.time)}`
        );
        const tsv = rows.join('\n');

        navigator.clipboard.writeText(tsv).then(() => {
            showToast(`✅ 已复制 ${selected.length} 行 =IMAGE() 公式，直接粘贴到 Google Sheets`, 'success');
        }).catch(() => {
            showToast('复制失败', 'error');
        });
    }, [showToast]);

    // --- Copy to Sheets ---
    const copyForSheets = useCallback((mode: 'url' | 'image-formula') => {
        const selected = frames.filter(f => f.selected);
        if (selected.length === 0) {
            showToast('请先选择帧', 'error');
            return;
        }

        let tsv: string;
        if (mode === 'image-formula') {
            // Copy as =IMAGE() formulas — requires gyazo URLs
            const withUrls = selected.filter(f => f.gyazoUrl);
            if (withUrls.length === 0) {
                showToast('请先上传到 Gyazo 图床', 'error');
                return;
            }
            const rows = withUrls.map(f =>
                `${f.index + 1}\t${fmtTime(f.time)}\t=IMAGE("${f.gyazoUrl}")`
            );
            tsv = '序号\t时间点\t缩略图\n' + rows.join('\n');
        } else {
            // Copy URLs only
            const withUrls = selected.filter(f => f.gyazoUrl);
            if (withUrls.length === 0) {
                showToast('请先上传到 Gyazo 图床', 'error');
                return;
            }
            const rows = withUrls.map(f =>
                `${f.index + 1}\t${fmtTime(f.time)}\t${f.gyazoUrl}`
            );
            tsv = '序号\t时间点\t图片链接\n' + rows.join('\n');
        }

        navigator.clipboard.writeText(tsv).then(() => {
            showToast(`✅ 已复制 ${selected.filter(f => f.gyazoUrl).length} 行到剪贴板`, 'success');
        }).catch(() => {
            showToast('复制失败', 'error');
        });
    }, [frames, showToast]);

    // --- Download selected frames as ZIP ---
    const [downloadIncludeOriginal, setDownloadIncludeOriginal] = useState(false);

    // Helper: build a ZIP for a set of frames, optionally including the original source image
    const buildZipForFrames = useCallback(async (
        JSZip: any,
        framesToZip: FrameData[],
        baseName: string,
        folderName?: string,
    ) => {
        const zip = new JSZip();
        const folder = folderName ? zip.folder(folderName) : zip;

        // Optionally include original source image
        if (downloadIncludeOriginal) {
            const groupIds = [...new Set(framesToZip.map(f => f.groupId).filter(Boolean))];
            groupIds.forEach(gid => {
                const group = groups.find(g => g.id === gid);
                if (group?.sourceDataUrl) {
                    const base64 = group.sourceDataUrl.split(',')[1];
                    if (base64) {
                        folder.file(`原图_${gid.replace(/^custom_split_/, '')}.jpg`, base64, { base64: true });
                    }
                }
            });
        }

        framesToZip.forEach((f, idx) => {
            const base64 = f.dataUrl.split(',')[1];
            folder.file(`${String(idx + 1).padStart(3, '0')}.jpg`, base64, { base64: true });
        });

        return zip;
    }, [downloadIncludeOriginal, groups]);

    // Download all selected frames as one ZIP
    const downloadSelected = useCallback(async () => {
        const selected = frames.filter(f => f.selected);
        if (selected.length === 0) {
            showToast('请先选择要下载的帧', 'error');
            return;
        }

        try {
            const JSZip = (await import('jszip')).default;
            const baseName = videoName.replace(/\.[^.]+$/, '') || 'keyframes';
            const zip = await buildZipForFrames(JSZip, selected, baseName);

            const fileCount = Object.keys(zip.files).length;
            const groupIds = new Set(selected.map(f => f.groupId).filter(Boolean));
            const blob = await zip.generateAsync({ type: 'blob' });
            const sizeMB = (blob.size / 1024 / 1024).toFixed(1);
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `${baseName}_keyframes.zip`;
            document.body.appendChild(a);
            a.click();
            setTimeout(() => {
                document.body.removeChild(a);
                URL.revokeObjectURL(url);
            }, 100);

            const groupInfo = groupIds.size > 1 ? `（${groupIds.size} 组）` : '';
            showToast(`✅ 下载成功：${fileCount} 张图片${groupInfo}，${sizeMB} MB`, 'success');
        } catch (err) {
            console.error(err);
            showToast('下载失败', 'error');
        }
    }, [frames, videoName, showToast, buildZipForFrames]);

    // Download selected frames as separate ZIPs per group
    const downloadPerGroup = useCallback(async () => {
        const selected = frames.filter(f => f.selected);
        if (selected.length === 0) {
            showToast('请先选择要下载的帧', 'error');
            return;
        }

        // Group frames by groupId
        const byGroup = new Map<string, FrameData[]>();
        selected.forEach(f => {
            const gid = f.groupId || 'ungrouped';
            if (!byGroup.has(gid)) byGroup.set(gid, []);
            byGroup.get(gid)!.push(f);
        });

        if (byGroup.size <= 1) {
            // Only one group, just do normal download
            return downloadSelected();
        }

        try {
            const JSZip = (await import('jszip')).default;
            const baseName = videoName.replace(/\.[^.]+$/, '') || 'keyframes';
            let downloadCount = 0;

            for (const [gid, groupFrames] of byGroup) {
                const groupNum = downloadCount + 1;
                const group = groups.find(g => g.id === gid);
                const label = `第${groupNum}组_${group?.name || '未命名'}`.replace(/[\s\/]/g, '_');
                const zip = await buildZipForFrames(JSZip, groupFrames, baseName);

                const blob = await zip.generateAsync({ type: 'blob' });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = `${baseName}_${label}.zip`;
                document.body.appendChild(a);
                a.click();
                setTimeout(() => {
                    document.body.removeChild(a);
                    URL.revokeObjectURL(url);
                }, 100);

                downloadCount++;
                // Small delay between downloads to avoid browser blocking
                if (downloadCount < byGroup.size) {
                    await new Promise(r => setTimeout(r, 500));
                }
            }

            showToast(`✅ 分组下载完成：${downloadCount} 个 ZIP，共 ${selected.length} 张图片`, 'success');
        } catch (err) {
            console.error(err);
            showToast('下载失败', 'error');
        }
    }, [frames, videoName, groups, showToast, downloadSelected, buildZipForFrames]);

    // --- Seek video to frame ---
    const seekToFrame = useCallback((time: number) => {
        const video = videoRef.current;
        if (video) {
            video.currentTime = time;
            video.pause();
        }
    }, []);

    // --- Render ---
    return (
        <div className="vkf-app" onPaste={entryMode === 'storyboard' ? handleStoryboardPaste : undefined}>
            {/* Header */}
            <div className="vkf-header">
                <h1>🎬 视频关键帧提取器</h1>
                <div className="vkf-workspace-tabs" title="每个标签页保存独立的视频、关键帧、分镜词和故事分析">
                    {tabs.map(tab => (
                        <button
                            key={tab.id}
                            className={tab.id === activeTabId ? 'active' : ''}
                            onClick={() => switchWorkspaceTab(tab.id)}
                        >
                            <span>{tab.videoName || tab.name}</span>
                            <small>{tab.frames.length}</small>
                            <b
                                onClick={(e) => {
                                    e.stopPropagation();
                                    closeWorkspaceTab(tab.id);
                                }}
                                title="关闭标签页"
                            >
                                ×
                            </b>
                        </button>
                    ))}
                    <button className="vkf-workspace-add" onClick={addWorkspaceTab} title="新增标签页">
                        +
                    </button>
                </div>
                <div className="vkf-entry-tabs">
                    <button
                        className={entryMode === 'video' ? 'active' : ''}
                        onClick={() => setEntryMode('video')}
                    >
                        视频截帧
                    </button>
                    <button
                        className={entryMode === 'storyboard' ? 'active' : ''}
                        onClick={() => setEntryMode('storyboard')}
                    >
                        上传分镜图
                    </button>
                    <button
                        className={entryMode === 'split' ? 'active' : ''}
                        onClick={() => setEntryMode('split')}
                    >
                        拆分多宫格
                    </button>
                </div>
                {frames.length > 0 && (
                    <span className="vkf-header-stats">
                        {frames.length} 帧 · {selectedCount} 选中
                        {frames.filter(f => f.gyazoUrl).length > 0 && ` · ${frames.filter(f => f.gyazoUrl).length} 已上传`}
                    </span>
                )}
            </div>

            <div className={`vkf-main${resizingPanel ? ' resizing' : ''}`}>
                {/* Left Panel */}
                <div className="vkf-left" style={{ width: leftWidth }}>
                    {/* Video dropzone / player */}
                    {(entryMode === 'storyboard' || entryMode === 'split') ? (
                        <>
                            <div
                                className={`vkf-dropzone vkf-storyboard-dropzone ${dragging ? 'dragging' : ''}`}
                                tabIndex={0}
                                onPaste={handleStoryboardPaste}
                                onDragOver={handleDragOver}
                                onDragLeave={handleDragLeave}
                                onDrop={(e) => {
                                    e.preventDefault();
                                    setDragging(false);
                                    addStoryboardImageFiles(Array.from(e.dataTransfer.files));
                                }}
                                onClick={(e) => {
                                    e.currentTarget.focus();
                                    showToast('已激活粘贴区域，可直接 Ctrl/Cmd+V', 'info');
                                }}
                                onDoubleClick={() => storyboardFileInputRef.current?.click()}
                            >
                                <div className="vkf-dropzone-icon">🖼️</div>
                                <div className="vkf-dropzone-text">
                                    {entryMode === 'split' ? '上传 / 拖入整张多宫格长图' : '上传 / 拖入 / 粘贴分镜图片'}
                                </div>
                                <div className="vkf-dropzone-hint">
                                    单击激活粘贴 · 双击选择文件 · Ctrl/Cmd+V 粘贴图片、链接、Google Sheets 图片单元格、=IMAGE() 公式
                                </div>
                                <input
                                    ref={storyboardFileInputRef}
                                    type="file"
                                    accept="image/*"
                                    multiple
                                    style={{ display: 'none' }}
                                    onChange={(e) => {
                                        const files = Array.from(e.target.files || []);
                                        if (files.length > 0) addStoryboardImageFiles(files);
                                        if (storyboardFileInputRef.current) storyboardFileInputRef.current.value = '';
                                    }}
                                />
                            </div>
                            {storyboardImporting && (
                                <div className="vkf-importing-note">⏳ 正在导入粘贴的图片链接...</div>
                            )}

                            <div className="vkf-controls">
                                <div className="vkf-control-row">
                                    <span className="vkf-control-label">缩略图大小</span>
                                    <input
                                        type="range"
                                        min={40}
                                        max={360}
                                        step={20}
                                        value={thumbWidth}
                                        onChange={e => setThumbWidth(Number(e.target.value))}
                                        style={{ flex: 1, accentColor: '#667eea' }}
                                    />
                                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', minWidth: 36 }}>
                                        {thumbWidth}px
                                    </span>
                                </div>
                            </div>

                            {frames.length > 0 && (
                                <div className="vkf-upload-section">
                                    <button
                                        className="vkf-btn"
                                        onClick={() => selectAll('storyboard_uploads')}
                                        style={{ width: '100%', justifyContent: 'center' }}
                                    >
                                        选中全部上传图
                                    </button>
                                    <button
                                        className="vkf-btn vkf-btn-danger"
                                        onClick={() => {
                                            setFrames(prev => prev.filter(f => f.groupId !== 'storyboard_uploads'));
                                            setGroups(prev => prev.filter(g => g.id !== 'storyboard_uploads'));
                                            setStoryboardPrompts([]);
                                        }}
                                        style={{ width: '100%', justifyContent: 'center' }}
                                    >
                                        清空上传图
                                    </button>
                                </div>
                            )}

                            {/* renderStoryboardControls removed from vkf-left, moved to vkf-right */}
                            
                            {entryMode === 'split' && frames.length > 0 && !splitEditorImage && (
                                <div className="vkf-controls" style={{ marginTop: '16px' }}>
                                    <button
                                        className="vkf-btn vkf-btn-primary"
                                        onClick={openSplitEditor}
                                        disabled={frames.filter(f => f.selected).length === 0}
                                        style={{ width: '100%', justifyContent: 'center', padding: '12px', fontSize: '14px', fontWeight: 'bold' }}
                                        title={frames.filter(f => f.selected).length > 1 ? `批量拆分 ${frames.filter(f => f.selected).length} 张图` : '选中图片后进入裁切编辑'}
                                    >
                                        ✂️ {frames.filter(f => f.selected).length > 1 ? `批量拆分 ${frames.filter(f => f.selected).length} 张图` : '打开裁切编辑器'}
                                    </button>
                                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.38)', textAlign: 'center', marginTop: 4 }}>
                                        {frames.filter(f => f.selected).length > 1
                                            ? `已选 ${frames.filter(f => f.selected).length} 张，逐张进入裁切编辑器`
                                            : '选中图片后，进入可视化裁切线编辑'
                                        }
                                    </div>
                                </div>
                            )}


                        </>
                    ) : !videoSrc ? (
                        <>
                        <div
                            className={`vkf-dropzone ${dragging ? 'dragging' : ''}`}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                        >
                            <div className="vkf-dropzone-icon">🎥</div>
                            <div className="vkf-dropzone-text">拖入视频文件或点击选择</div>
                            <div className="vkf-dropzone-hint">支持 MP4, MOV, WebM, MKV — 可拖入多个文件</div>
                            <input
                                ref={fileInputRef}
                                type="file"
                                accept="video/*"
                                multiple
                                style={{ display: 'none' }}
                                onChange={handleFileSelect}
                            />
                        </div>
                        {/* URL input — supports multiple lines */}
                        <div style={{ padding: '0 16px 16px' }}>
                            <div style={{ fontSize: 12, color: 'rgba(255,255,255,0.45)', marginBottom: 6 }}>
                                或粘贴链接（每行一个，支持批量）
                            </div>
                            <textarea
                                value={urlInput}
                                onChange={e => setUrlInput(e.target.value)}
                                placeholder={'粘贴链接，每行一个：\nhttps://www.facebook.com/reel/xxx\nhttps://example.com/video.mp4'}
                                disabled={!!downloading}
                                rows={3}
                                style={{
                                    width: '100%',
                                    padding: '8px 10px',
                                    borderRadius: 6,
                                    border: '1px solid rgba(255,255,255,0.12)',
                                    background: 'rgba(255,255,255,0.06)',
                                    color: '#e6e6e6',
                                    fontSize: 12,
                                    outline: 'none',
                                    resize: 'vertical',
                                    fontFamily: 'inherit',
                                    boxSizing: 'border-box',
                                }}
                            />
                            <button
                                className="vkf-btn vkf-btn-primary"
                                onClick={() => loadBatchUrls(urlInput)}
                                disabled={!urlInput.trim() || !!downloading}
                                style={{ width: '100%', justifyContent: 'center', marginTop: 6 }}
                            >
                                {downloading ? (downloading.stage || '下载中...') : `加载 (${urlInput.split('\n').filter(s => s.trim()).length} 个链接)`}
                            </button>
                            {downloading && (
                                <div style={{ marginTop: 8 }}>
                                    <div className="vkf-progress" style={{ margin: 0 }}>
                                        <div className="vkf-progress-bar" style={{ width: downloading.total > 0 ? `${(downloading.loaded / downloading.total) * 100}%` : '30%' }} />
                                    </div>
                                    <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.5)', marginTop: 4, textAlign: 'center' }}>
                                        {downloading.stage && <span style={{ marginRight: 6 }}>{downloading.stage}</span>}
                                        ⏬ {(downloading.loaded / 1024 / 1024).toFixed(1)} MB
                                        {downloading.total > 0 && ` / ${(downloading.total / 1024 / 1024).toFixed(1)} MB`}
                                    </div>
                                </div>
                            )}
                            {!downloading && (
                                <div style={{ fontSize: 11, color: 'rgba(255,255,255,0.3)', marginTop: 6, lineHeight: 1.5 }}>
                                    💡 支持 facebook.com/reel/xxx 链接或任意 .mp4 直链
                                </div>
                            )}
                        </div>
                        </>
                    ) : (
                        <>
                            <div className="vkf-video-section">
                                <div className="vkf-video-wrapper">
                                    <video
                                        ref={videoRef}
                                        src={videoSrc}
                                        controls
                                        preload="auto"
                                        onLoadedMetadata={handleVideoLoaded}
                                        onError={handleVideoError}
                                    />
                                </div>
                                <div className="vkf-video-info" style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                    <div>
                                        <span title={videoName} style={{ marginRight: '8px' }}>
                                            📁 {videoName.length > 30 ? videoName.substring(0, 27) + '...' : videoName}
                                        </span>
                                        <span>
                                            {videoRef.current?.videoWidth && `${videoRef.current.videoWidth}×${videoRef.current.videoHeight}`}
                                            {videoDuration > 0 && ` · ⏱ ${fmtTimeFull(videoDuration)}`}
                                        </span>
                                    </div>
                                    <button 
                                        className="vkf-btn"
                                        onClick={captureCurrentFrame}
                                        style={{ padding: '2px 8px', fontSize: '12px' }}
                                        title="播放到指定画面后，点击即可手动补充截取当前这一帧"
                                    >
                                        📸 截取当前帧
                                    </button>
                                </div>
                            </div>

                            {/* Controls */}
                            <div className="vkf-controls">
                                <div className="vkf-control-row">
                                    <span className="vkf-control-label">截帧间隔</span>
                                    <select
                                        className="vkf-select"
                                        value={interval}
                                        onChange={e => setInterval_(Number(e.target.value))}
                                        disabled={generating}
                                    >
                                        <option value={0.5}>0.5 秒</option>
                                        <option value={1}>1 秒</option>
                                        <option value={2}>2 秒</option>
                                        <option value={3}>3 秒</option>
                                        <option value={5}>5 秒</option>
                                        <option value={10}>10 秒</option>
                                        <option value={15}>15 秒</option>
                                        <option value={30}>30 秒</option>
                                        <option value={60}>60 秒</option>
                                    </select>
                                    {videoDuration > 0 && (
                                        <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                                            ≈ {Math.floor(videoDuration / interval) + 1} 帧
                                        </span>
                                    )}
                                </div>

                                <div className="vkf-control-row">
                                    <span className="vkf-control-label">缩略图大小</span>
                                    <input
                                        type="range"
                                        min={40}
                                        max={360}
                                        step={20}
                                        value={thumbWidth}
                                        onChange={e => setThumbWidth(Number(e.target.value))}
                                        style={{ flex: 1, accentColor: '#667eea' }}
                                    />
                                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)', minWidth: 36 }}>
                                        {thumbWidth}px
                                    </span>
                                </div>

                                <div className="vkf-control-row">
                                    {!generating ? (
                                        <>
                                            <button
                                                className="vkf-btn vkf-btn-primary"
                                                onClick={generateFrames}
                                                disabled={videoDuration <= 0 || autoFrameAnalyzing}
                                                style={{ flex: 1 }}
                                            >
                                                🎞️ {frames.length > 0 ? '重新生成' : '开始截帧'}
                                            </button>
                                            <button
                                                className="vkf-btn vkf-btn-success"
                                                onClick={autoExtractAndAnalyze}
                                                disabled={videoDuration <= 0 || autoFrameAnalyzing}
                                                style={{ flex: 1 }}
                                                title="一键提取关键帧并自动分析故事"
                                            >
                                                {autoFrameAnalyzing ? '🤖 正在自动分析...' : '⚡ 一键截取加分析'}
                                            </button>
                                        </>
                                    ) : (
                                        <button
                                            className="vkf-btn vkf-btn-danger"
                                            onClick={stopGeneration}
                                            style={{ flex: 1 }}
                                        >
                                            ⏹ 停止 ({genProgress.done}/{genProgress.total})
                                        </button>
                                    )}
                                    <button
                                        className="vkf-btn"
                                        onClick={() => {
                                            setVideoSrc(null);
                                            setVideoName('');
                                            setFrames([]);
                                            setVideoDuration(0);
                                        }}
                                        title="更换视频"
                                    >
                                        🔄
                                    </button>
                                </div>
                            </div>

                        </>
                    )}

                    {/* Upload & Export section - Available in all modes */}
                    {frames.length > 0 && selectedCount > 0 && (
                        <div className="vkf-upload-section" style={{ marginTop: '16px' }}>
                            <div style={{ fontSize: 12, fontWeight: 600, color: 'rgba(255,255,255,0.7)', marginBottom: 4 }}>
                                📤 导出 ({selectedCount} 帧已选)
                            </div>

                            <button
                                className="vkf-btn vkf-btn-success"
                                onClick={uploadSelectedToGyazo}
                                disabled={!!uploadProgress}
                                style={{ width: '100%', justifyContent: 'center' }}
                            >
                                {uploadProgress
                                    ? `⏳ 上传中 ${uploadProgress.done}/${uploadProgress.total}`
                                    : '☁️ 上传到 Gyazo 图床'
                                }
                            </button>

                            {frames.some(f => f.selected && f.gyazoUrl) && (
                                <>
                                    <button
                                        className="vkf-btn"
                                        onClick={() => copyForSheets('image-formula')}
                                        style={{ width: '100%', justifyContent: 'center' }}
                                    >
                                        📋 复制 =IMAGE() 公式
                                    </button>
                                    <button
                                        className="vkf-btn"
                                        onClick={() => copyForSheets('url')}
                                        style={{ width: '100%', justifyContent: 'center' }}
                                    >
                                        🔗 复制链接列表
                                    </button>
                                </>
                            )}

                            <div style={{ display: 'flex', gap: 4, width: '100%' }}>
                                <button
                                    className="vkf-btn"
                                    onClick={downloadSelected}
                                    style={{ flex: 1, justifyContent: 'center' }}
                                >
                                    💾 合并下载 ({selectedCount})
                                </button>
                                {new Set(frames.filter(f => f.selected).map(f => f.groupId)).size > 1 && (
                                    <button
                                        className="vkf-btn vkf-btn-primary"
                                        onClick={downloadPerGroup}
                                        style={{ flex: 1, justifyContent: 'center' }}
                                    >
                                        📦 分组下载
                                    </button>
                                )}
                            </div>
                            <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'rgba(255,255,255,0.5)', cursor: 'pointer', marginTop: 2 }}>
                                <input
                                    type="checkbox"
                                    checked={downloadIncludeOriginal}
                                    onChange={e => setDownloadIncludeOriginal(e.target.checked)}
                                    style={{ accentColor: '#667eea' }}
                                />
                                附带拆分前原图
                            </label>
                        </div>
                    )}
                </div>

                <div 
                    className={`vkf-resizer ${resizingPanel === 'left' ? 'active' : ''}`}
                    onMouseDown={() => setResizingPanel('left')}
                />

                {/* Middle Panel - Frame Grid */}
                <div className="vkf-middle">
                    {frames.length > 0 && (
                        <>
                            <div className="vkf-grid-toolbar">
                                <span className="vkf-grid-toolbar-count">
                                    {selectedCount}/{frames.length} 已选
                                </span>
                                <button className="vkf-btn" onClick={() => selectAll()}>全选</button>
                                <button className="vkf-btn" onClick={() => invertSelection()}>反选</button>
                                <button className="vkf-btn" onClick={() => deselectAll()}>取消</button>
                                <button 
                                    className="vkf-btn vkf-btn-danger" 
                                    style={{ padding: '4px 8px' }}
                                    onClick={() => {
                                        setFrames(prev => {
                                            const nextFrames = prev.filter(f => !f.selected);
                                            setGroups(prevGroups => prevGroups.filter(g => nextFrames.some(f => f.groupId === g.id)));
                                            return nextFrames;
                                        });
                                    }}
                                    disabled={selectedCount === 0}
                                    title="删除选中帧，清理界面"
                                >
                                    🗑️ 删除选中
                                </button>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginLeft: 8 }}>
                                    <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>🔍</span>
                                    <input
                                        type="range"
                                        min={40}
                                        max={400}
                                        step={20}
                                        value={thumbWidth}
                                        onChange={e => setThumbWidth(Number(e.target.value))}
                                        style={{ width: 80, accentColor: '#667eea' }}
                                    />
                                    <span style={{ fontSize: 10, color: 'rgba(255,255,255,0.35)', minWidth: 28 }}>{thumbWidth}</span>
                                </div>
                                <div style={{ flex: 1 }} />
                                {selectedCount > 0 && !generating && (
                                    <button
                                        className="vkf-btn vkf-btn-primary"
                                        onClick={async () => {
                                            const selected = frames.filter(f => f.selected);
                                            const needUpload = selected.filter(f => !f.gyazoUrl);
                                            if (needUpload.length > 0) {
                                                await uploadSelectedToGyazo();
                                                // Wait for state to settle
                                                await new Promise(r => setTimeout(r, 200));
                                            }
                                            copyFormulasFromFrames();
                                        }}
                                        disabled={!!uploadProgress}
                                        style={{ fontWeight: 600 }}
                                    >
                                        {uploadProgress
                                            ? `⏳ ${uploadProgress.done}/${uploadProgress.total}`
                                            : `📋 一键复制公式 (${selectedCount})`
                                        }
                                    </button>
                                )}
                                {generating && (
                                    <span style={{ fontSize: 12, color: '#667eea' }}>
                                        ⏳ 生成中 {genProgress.done}/{genProgress.total}
                                    </span>
                                )}
                                {groups.length > 0 && (
                                    <button className="vkf-btn" style={{ fontSize: 10, padding: '4px 8px' }} onClick={clearCache} title="清除所有缓存帧">
                                        🗑️ 清除
                                    </button>
                                )}
                            </div>
                            {generating && (
                                <div className="vkf-progress">
                                    <div
                                        className="vkf-progress-bar"
                                        style={{ width: `${genProgress.total > 0 ? (genProgress.done / genProgress.total) * 100 : 0}%` }}
                                    />
                                </div>
                            )}
                        </>
                    )}

                    {frames.length > 0 ? (
                        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                            {/* AI Results removed from vkf-middle, moved to vkf-right */}
                            {/* Get unique group IDs preserving order */}
                            {(groups.length > 0 ? groups : [{ id: frames[0]?.groupId || 'default', name: frames[0]?.groupId || '视频', collapsed: false }]).map(group => {
                                const groupFrames = frames.filter(f => f.groupId === group.id);
                                if (groupFrames.length === 0) return null;
                                const groupSelected = groupFrames.filter(f => f.selected).length;
                                return (
                                    <div key={group.id} style={{ marginBottom: 4 }}>
                                        {/* Group Header */}
                                        <div
                                            style={{
                                                display: 'flex', alignItems: 'center', gap: 8,
                                                padding: '6px 12px', background: 'rgba(15, 17, 23, 0.95)',
                                                borderBottom: '1px solid rgba(255,255,255,0.06)',
                                                backdropFilter: 'blur(8px)',
                                                cursor: 'pointer', userSelect: 'none', position: 'sticky', top: 0, zIndex: 10,
                                            }}
                                            onClick={() => setGroups(prev => prev.map(g => g.id === group.id ? { ...g, collapsed: !g.collapsed } : g))}
                                        >
                                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                                                {group.collapsed ? '▶' : '▼'}
                                            </span>
                                            <span style={{ fontSize: 12, fontWeight: 600, color: '#667eea', flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                                🎬 {group.name}
                                            </span>
                                            <span style={{ fontSize: 11, color: 'rgba(255,255,255,0.4)' }}>
                                                {groupSelected}/{groupFrames.length}
                                            </span>
                                            <button className="vkf-btn" style={{ padding: '2px 8px', fontSize: 10 }} onClick={e => { e.stopPropagation(); selectAll(group.id); }}>全选</button>
                                            <button className="vkf-btn" style={{ padding: '2px 8px', fontSize: 10 }} onClick={e => { e.stopPropagation(); invertSelection(group.id); }}>反选</button>
                                            <button className="vkf-btn" style={{ padding: '2px 8px', fontSize: 10 }} onClick={e => { e.stopPropagation(); deselectAll(group.id); }}>取消</button>
                                            <button className="vkf-btn" style={{ padding: '2px 8px', fontSize: 10, color: '#ff4757' }} onClick={e => {
                                                e.stopPropagation();
                                                setFrames(prev => prev.filter(f => f.groupId !== group.id));
                                                setGroups(prev => prev.filter(g => g.id !== group.id));
                                            }}>✕</button>
                                        </div>
                                        {/* Group Frames */}
                                        {!group.collapsed && (
                                            <div className="vkf-frame-grid">
                                                {groupFrames.map(frame => (
                                                    <div
                                                        key={`${frame.groupId}-${frame.index}`}
                                                        className={`vkf-frame-cell ${frame.selected ? 'selected' : ''}`}
                                                        onClick={() => toggleFrame(frame.groupId, frame.index)}
                                                        onDoubleClick={() => seekToFrame(frame.time)}
                                                        title={`${fmtTime(frame.time)} — 单击选择，双击跳转`}
                                                        style={{ width: thumbWidth }}
                                                    >
                                                        <img src={frame.dataUrl} alt={`帧 ${frame.index + 1}`} draggable={false} />
                                                        <span className="vkf-frame-index">#{frame.index + 1}</span>
                                                        <div className="vkf-frame-time">
                                                            {fmtTime(frame.time)}
                                                            {frame.gyazoUrl && ' ☁️'}
                                                            {frame.uploading && ' ⏳'}
                                                        </div>
                                                        <div className="vkf-frame-check">✓</div>
                                                        <button 
                                                            className="vkf-frame-delete" 
                                                            onClick={(e) => {
                                                                e.stopPropagation();
                                                                deleteSingleFrame(frame.groupId, frame.index);
                                                            }}
                                                            title="删除此帧"
                                                        >
                                                            ×
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    ) : (
                        <div className="vkf-empty">
                            {videoSrc ? (
                                <>
                                    <span style={{ fontSize: 40 }}>🎞️</span>
                                    <span>设置截帧间隔，点击「开始截帧」</span>
                                </>
                            ) : (
                                <>
                                    <span style={{ fontSize: 40 }}>📽️</span>
                                    <span>请先在左侧加载视频</span>
                                </>
                            )}
                        </div>
                    )}
                </div>

                <div 
                    className={`vkf-resizer ${resizingPanel === 'right' ? 'active' : ''}`}
                    onMouseDown={() => setResizingPanel('right')}
                />

                {/* Right Panel - AI Results */}
                <div className="vkf-right" style={{ width: rightWidth }}>
                    {frames.length > 0 && (
                        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0, paddingBottom: '16px' }}>
                            
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                                {/* Area 1 */}
                                <div className="vkf-story-tool">
                                    <div className="vkf-section-title">🧠 功能区1：故事分析与改版</div>
                                    <div className="vkf-section-note">
                                        分析选中的关键帧故事，改版生成新故事，并直接根据故事出一套分镜词。
                                    </div>
                                    <button
                                        className="vkf-btn vkf-btn-primary"
                                        onClick={analyzeSelectedFrameStory}
                                        disabled={selectedCount === 0 || storyAnalyzing}
                                        style={{ width: '100%', justifyContent: 'center' }}
                                    >
                                        {storyAnalyzing && !storyAnalysis ? '🤖 正在分析故事...' : (storyAnalysis ? '✅ 分析完成 (重新分析)' : `🧠 分析选中帧故事 (${selectedCount})`)}
                                    </button>
                                    <textarea
                                        key={`story-revision-${storyRevisionDraftVersion}`}
                                        className="vkf-storyboard-input"
                                        defaultValue={storyRevisionInstruction}
                                        onChange={e => {
                                            storyRevisionInstructionRef.current = e.currentTarget.value;
                                        }}
                                        onBlur={e => {
                                            storyRevisionInstructionRef.current = e.currentTarget.value;
                                            setStoryRevisionInstruction(e.currentTarget.value);
                                        }}
                                        placeholder="改版要求：例如更悬疑、更治愈、加反转、换成广告故事、结尾更震撼..."
                                        rows={3}
                                        disabled={storyAnalyzing}
                                    />
                                    <button
                                        className="vkf-btn"
                                        onClick={reviseSelectedFrameStory}
                                        disabled={!storyAnalysis || selectedCount === 0 || storyAnalyzing}
                                        style={{ width: '100%', justifyContent: 'center' }}
                                    >
                                        {storyAnalyzing && storyAnalysis ? '🤖 正在改版故事...' : (storyRevision ? '✅ 改版完成 (重新改版)' : '✍️ 按要求改版故事')}
                                    </button>

                                    {/* Area 1 Results */}
                                    {(storyAnalysis || storyRevision) && (
                                        <div className="vkf-storyboard-results vkf-story-result" style={{ marginTop: '16px', background: 'rgba(255,255,255,0.02)' }}>
                                            <div className="vkf-story-result-body">
                                                {storyAnalysis && (
                                                    <section>
                                                        <div
                                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', padding: '4px 0' }}
                                                            onClick={() => setStoryAnalysisCollapsed(prev => !prev)}
                                                        >
                                                            <h3 style={{ margin: 0 }}>
                                                                {storyAnalysisCollapsed ? '▶' : '▼'} 原版故事分析
                                                            </h3>
                                                            <button className="vkf-btn" style={{ fontSize: 11, padding: '2px 8px' }} onClick={(e) => { e.stopPropagation(); copyStoryText(storyAnalysis, '原版故事分析'); }}>
                                                                📋 复制原版
                                                            </button>
                                                        </div>
                                                        {!storyAnalysisCollapsed && <pre>{storyAnalysis}</pre>}
                                                    </section>
                                                )}
                                                {storyRevision && (
                                                    <section>
                                                        <div
                                                            style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', cursor: 'pointer', userSelect: 'none', padding: '4px 0' }}
                                                            onClick={() => setStoryRevisionCollapsed(prev => !prev)}
                                                        >
                                                            <h3 style={{ margin: 0 }}>
                                                                {storyRevisionCollapsed ? '▶' : '▼'} 改版故事
                                                            </h3>
                                                            <button className="vkf-btn vkf-btn-primary" style={{ fontSize: 11, padding: '2px 8px' }} onClick={(e) => { e.stopPropagation(); copyStoryText(storyRevision, '改版故事'); }}>
                                                                📋 复制改版
                                                            </button>
                                                        </div>
                                                        {!storyRevisionCollapsed && <pre>{storyRevision}</pre>}
                                                    </section>
                                                )}
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Area 2 */}
                                <div className="vkf-storyboard-section">
                                    <div className="vkf-section-title">🎞️ 功能区2：看图写词与自定要求</div>
                                    <div className="vkf-section-note">
                                        根据当前分镜直接写描述词，或者根据新的要求给参考分镜写词。
                                    </div>

                                    <div className="vkf-mode-toggle">
                                        <button
                                            className={storyboardCreateMode === 'describe' ? 'active' : ''}
                                            onClick={() => {
                                                setStoryboardCreateMode('describe');
                                                setStoryboardCustomInstruction(DEFAULT_DESCRIBE_INSTRUCTION);
                                                storyboardInstructionRef.current = DEFAULT_DESCRIBE_INSTRUCTION;
                                                setStoryboardDraftVersion(prev => prev + 1);
                                            }}
                                            disabled={storyboardGenerating}
                                        >
                                            按图写词
                                        </button>
                                        <button
                                            className={storyboardCreateMode === 'create' ? 'active' : ''}
                                            onClick={() => {
                                                setStoryboardCreateMode('create');
                                                setStoryboardCustomInstruction(DEFAULT_CREATE_INSTRUCTION);
                                                storyboardInstructionRef.current = DEFAULT_CREATE_INSTRUCTION;
                                                setStoryboardDraftVersion(prev => prev + 1);
                                            }}
                                            disabled={storyboardGenerating}
                                        >
                                            带新要求生成
                                        </button>
                                        <button
                                            className={storyboardCreateMode === 'grok_video' ? 'active' : ''}
                                            onClick={() => {
                                                setStoryboardCreateMode('grok_video');
                                                setStoryboardCustomInstruction(DEFAULT_GROK_VIDEO_INSTRUCTION);
                                                storyboardInstructionRef.current = DEFAULT_GROK_VIDEO_INSTRUCTION;
                                                setStoryboardDraftVersion(prev => prev + 1);
                                            }}
                                            disabled={storyboardGenerating}
                                            style={{ borderLeft: '1px solid rgba(255,255,255,0.1)' }}
                                        >
                                            Grok 视频分镜表
                                        </button>
                                    </div>

                                    <div className="vkf-storyboard-controls">
                                        <label>
                                            <span>宫格</span>
                                            <select className="vkf-select" value={storyboardCount} onChange={e => setStoryboardCount(Number(e.target.value))} disabled={storyboardGenerating}>
                                                <option value={3}>3 格</option>
                                                <option value={6}>6 格</option>
                                                <option value={9}>9 格</option>
                                                <option value={12}>12 格</option>
                                            </select>
                                        </label>
                                        <label>
                                            <span>风格</span>
                                            <select className="vkf-select" value={storyboardStyle} onChange={e => setStoryboardStyle(e.target.value)} disabled={storyboardGenerating}>
                                                <option value="电影写实">电影写实</option>
                                                <option value="史诗电影感">史诗电影感</option>
                                                <option value="纪录片真实感">纪录片真实感</option>
                                                <option value="商业广告质感">商业广告质感</option>
                                                <option value="暗调悬疑电影">暗调悬疑电影</option>
                                                <option value="温暖治愈短片">温暖治愈短片</option>
                                            </select>
                                        </label>
                                    </div>

                                    <textarea
                                        key={`context-${storyboardDraftVersion}`}
                                        className="vkf-storyboard-input"
                                        defaultValue={storyboardContext}
                                        onChange={e => {
                                            storyboardContextRef.current = e.currentTarget.value;
                                        }}
                                        onBlur={e => {
                                            storyboardContextRef.current = e.currentTarget.value;
                                            setStoryboardContext(e.currentTarget.value);
                                        }}
                                        placeholder={storyboardCreateMode === 'create'
                                            ? '故事/场景方向：例如角色在雨夜发现线索，逐步走向悬疑高潮...'
                                            : '可选：补充人物设定、剧情背景、想统一的服装/时代/色调...'}
                                        rows={3}
                                        disabled={storyboardGenerating}
                                    />

                                    <textarea
                                        key={`instruction-${storyboardDraftVersion}`}
                                        className="vkf-storyboard-input"
                                        defaultValue={storyboardCustomInstruction}
                                        onChange={e => {
                                            storyboardInstructionRef.current = e.currentTarget.value;
                                        }}
                                        onBlur={e => {
                                            storyboardInstructionRef.current = e.currentTarget.value;
                                            setStoryboardCustomInstruction(e.currentTarget.value);
                                        }}
                                        placeholder="自定义描述词指令：你可以要求输出更短/更长、指定镜头语言、指定平台格式、加入负面词等..."
                                        rows={4}
                                        disabled={storyboardGenerating}
                                    />

                                    <button
                                        className="vkf-btn vkf-btn-primary"
                                        onClick={generateStoryboardPrompts}
                                        disabled={selectedCount === 0 || storyboardGenerating}
                                        style={{ width: '100%', justifyContent: 'center' }}
                                    >
                                        {storyboardGenerating
                                            ? '🤖 正在生成分镜词...'
                                            : storyboardCreateMode === 'create'
                                                ? `🎬 根据自定要求生成 ${storyboardCount} 格分镜词`
                                                : storyboardCreateMode === 'grok_video'
                                                    ? `🎬 按图生成 ${storyboardCount} 格分镜词`
                                                    : `🎬 按图生成 ${Math.min(selectedCount, storyboardCount)} 格分镜词`
                                        }
                                    </button>

                                    <button
                                        className="vkf-btn vkf-btn-success"
                                        onClick={generateStoryboardFromStory}
                                        disabled={!storyRevision || storyboardGenerating}
                                        style={{ width: '100%', justifyContent: 'center', marginTop: '6px' }}
                                    >
                                        {storyboardGenerating ? '🤖 正在生成分镜词...' : `🎬 根据修改后故事出 ${storyboardCount} 格分镜词`}
                                    </button>


                                    {storyboardPrompts.length > 0 && (
                                        <div className="vkf-storyboard-actions" style={{ marginTop: '8px' }}>
                                            <button className="vkf-btn vkf-btn-success" onClick={() => copyStoryboardPrompts('document')} title="生成专业分镜表格文档图的提示词">📄 生分镜表图提示词</button>
                                            <button className="vkf-btn vkf-btn-primary" onClick={() => copyStoryboardPrompts('board')} title="生成一张多宫格分镜板的完整提示词">🖼️ 分镜板提示词</button>
                                            <button className="vkf-btn vkf-btn-success" onClick={() => copyStoryboardPrompts('video_prompt')} title="Grok等AI视频工具可直接使用的提示词">🎬 Grok视频词</button>
                                            <button className="vkf-btn" onClick={() => copyStoryboardPrompts('text')} title="逐格纯文本，可粘贴到表格使用">📝 逐格纯文本</button>
                                            <button className="vkf-btn" onClick={() => copyStoryboardPrompts('tsv')} title="粘贴到Excel/Sheets的表格数据">📊 粘贴到表格</button>
                                        </div>
                                    )}

                                    {/* Area 2 Results */}
                                    {storyboardPrompts.length > 0 && (
                                        <div className="vkf-storyboard-results" style={{ marginTop: '16px', background: 'rgba(255,255,255,0.02)' }}>
                                            <div className="vkf-storyboard-results-header">
                                                <div>
                                                    <div className="vkf-storyboard-results-title">电影分镜描述词</div>
                                                    <div className="vkf-storyboard-results-subtitle">
                                                        {storyboardPrompts.length} 格 · 配合上方按钮直接复制
                                                    </div>
                                                </div>
                                            </div>
                                            <div className="vkf-storyboard-grid">
                                                {storyboardPrompts.map(item => {
                                                    const frame = frames.find(f =>
                                                        f.groupId === item.groupId &&
                                                        f.index === item.frameIndex &&
                                                        Math.abs(f.time - item.time) < 0.05
                                                    );
                                                    return (
                                                        <div key={`${item.panel}-${item.frameIndex}-${item.time}`} className="vkf-storyboard-card">
                                                            {frame && <img src={frame.dataUrl} alt={`分镜 ${item.panel}`} draggable={false} />}
                                                            <div className="vkf-storyboard-card-body">
                                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                                                    <span style={{
                                                                        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                                                                        width: 28, height: 28, borderRadius: '50%',
                                                                        background: 'linear-gradient(135deg, #667eea, #764ba2)',
                                                                        color: '#fff', fontWeight: 700, fontSize: 13, flexShrink: 0,
                                                                    }}>
                                                                        {item.panel}
                                                                    </span>
                                                                    <div style={{ flex: 1, minWidth: 0 }}>
                                                                        <div className="vkf-storyboard-card-title">{item.title}</div>
                                                                        <div className="vkf-storyboard-card-meta">
                                                                            {frame ? `#${item.frameIndex + 1} · ${fmtTime(item.time)}` : '故事模式'}
                                                                        </div>
                                                                    </div>
                                                                </div>
                                                                <div className="vkf-storyboard-shot">🎥 {item.shotType}</div>
                                                                <p>{withStoryboardAspectRatio(item.prompt)}</p>
                                                                <button
                                                                    className="vkf-btn"
                                                                    onClick={() => {
                                                                        navigator.clipboard.writeText(withStoryboardAspectRatio(item.prompt)).then(() => showToast(`✅ 已复制 PANEL ${item.panel}`, 'success'));
                                                                    }}
                                                                >
                                                                    复制本格
                                                                </button>
                                                            </div>
                                                        </div>
                                                    );
                                                })}
                                            </div>
                                        </div>
                                    )}
                                </div>
                            </div>
                        </div>
                    )}
                </div>
            </div>

            {/* Split Crop Editor Overlay */}
            {splitEditorImage && (
                <div className="vkf-split-overlay" onClick={(e) => { if (e.target === e.currentTarget) setSplitEditorImage(null); }}>
                    <SplitCropEditor
                        imageUrl={splitEditorImage}
                        imgRef={splitImgRef}
                        hLines={splitHLines}
                        vLines={splitVLines}
                        onHLinesChange={setSplitHLines}
                        onVLinesChange={setSplitVLines}
                        onAutoDetect={autoDetectGridLines}
                        onSetGrid={setUniformGrid}
                        onSplit={splitWithCustomLines}
                        onSplitAndNext={splitAndAdvance}
                        onClose={() => { setSplitEditorImage(null); setSplitQueue([]); setSplitQueueIndex(0); }}
                        showToast={showToast}
                        splitQueueCurrent={splitQueue.length > 1 ? splitQueueIndex + 1 : undefined}
                        splitQueueTotal={splitQueue.length > 1 ? splitQueue.length : undefined}
                    />
                </div>
            )}

            {/* Toast */}
            {toast && (
                <div className={`vkf-toast ${toast.type}`}>{toast.msg}</div>
            )}
        </div>
    );
};

export default VideoKeyframeApp;
