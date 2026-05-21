/**
 * AnnotationEditor - 截图标注编辑器
 * 
 * 功能：在图片上进行标注（画笔、箭头、矩形、椭圆、文字）
 * 类似 Snipaste / CleanShot X 的标注功能
 */

import React, { useRef, useState, useEffect, useCallback } from 'react';
import {
    Pencil, ArrowUpRight, Square, Circle, Type, Hand,
    Undo2, Trash2, Save, X, Minus, Plus, Crop, MessageSquarePlus,
} from 'lucide-react';

// ==================== Types ====================

interface Point { x: number; y: number; }

type ToolType = 'pen' | 'arrow' | 'rect' | 'ellipse' | 'text' | 'callout' | 'crop' | 'pan';

interface BaseShape {
    color: string;
    lineWidth: number;
}

interface PenShape extends BaseShape {
    type: 'pen';
    points: Point[];
}

interface ArrowShape extends BaseShape {
    type: 'arrow';
    start: Point;
    end: Point;
}

interface RectShape extends BaseShape {
    type: 'rect';
    start: Point;
    end: Point;
}

interface EllipseShape extends BaseShape {
    type: 'ellipse';
    start: Point;
    end: Point;
}

interface TextShape extends BaseShape {
    type: 'text';
    position: Point;
    text: string;
    fontSize: number;
}

interface CalloutShape extends BaseShape {
    type: 'callout';
    start: Point;  // arrow tip (where you point to)
    end: Point;    // text anchor (where the label goes)
    text: string;
    fontSize: number;
}

type Shape = PenShape | ArrowShape | RectShape | EllipseShape | TextShape | CalloutShape;

// ==================== Drawing Helpers ====================

function drawShape(ctx: CanvasRenderingContext2D, shape: Shape) {
    ctx.strokeStyle = shape.color;
    ctx.fillStyle = shape.color;
    ctx.lineWidth = shape.lineWidth;
    ctx.lineCap = 'round';
    ctx.lineJoin = 'round';

    switch (shape.type) {
        case 'pen': {
            if (shape.points.length < 2) return;
            ctx.beginPath();
            ctx.moveTo(shape.points[0].x, shape.points[0].y);
            for (let i = 1; i < shape.points.length; i++) {
                ctx.lineTo(shape.points[i].x, shape.points[i].y);
            }
            ctx.stroke();
            break;
        }
        case 'arrow': {
            const { start, end } = shape;
            const angle = Math.atan2(end.y - start.y, end.x - start.x);
            const headLen = Math.max(12, shape.lineWidth * 4);

            // Line
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(end.x, end.y);
            ctx.stroke();

            // Arrowhead
            ctx.beginPath();
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(
                end.x - headLen * Math.cos(angle - Math.PI / 6),
                end.y - headLen * Math.sin(angle - Math.PI / 6),
            );
            ctx.lineTo(
                end.x - headLen * Math.cos(angle + Math.PI / 6),
                end.y - headLen * Math.sin(angle + Math.PI / 6),
            );
            ctx.closePath();
            ctx.fill();
            break;
        }
        case 'rect': {
            const x = Math.min(shape.start.x, shape.end.x);
            const y = Math.min(shape.start.y, shape.end.y);
            const w = Math.abs(shape.end.x - shape.start.x);
            const h = Math.abs(shape.end.y - shape.start.y);
            ctx.strokeRect(x, y, w, h);
            break;
        }
        case 'ellipse': {
            const cx = (shape.start.x + shape.end.x) / 2;
            const cy = (shape.start.y + shape.end.y) / 2;
            const rx = Math.abs(shape.end.x - shape.start.x) / 2;
            const ry = Math.abs(shape.end.y - shape.start.y) / 2;
            ctx.beginPath();
            ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
            ctx.stroke();
            break;
        }
        case 'text': {
            const fontSize = shape.fontSize || 16;
            ctx.font = `bold ${fontSize}px -apple-system, "SF Pro", sans-serif`;
            // Text background
            const metrics = ctx.measureText(shape.text);
            const pad = 4;
            ctx.fillStyle = 'rgba(0,0,0,0.55)';
            ctx.fillRect(
                shape.position.x - pad,
                shape.position.y - fontSize - pad,
                metrics.width + pad * 2,
                fontSize + pad * 2,
            );
            // Text
            ctx.fillStyle = shape.color;
            ctx.fillText(shape.text, shape.position.x, shape.position.y);
            break;
        }
        case 'callout': {
            const { start, end } = shape;
            const angle = Math.atan2(start.y - end.y, start.x - end.x);
            const headLen = Math.max(12, shape.lineWidth * 4);

            // Line from label to arrow tip
            ctx.beginPath();
            ctx.moveTo(end.x, end.y);
            ctx.lineTo(start.x, start.y);
            ctx.stroke();

            // Arrowhead at start (the pointed end)
            ctx.beginPath();
            ctx.moveTo(start.x, start.y);
            ctx.lineTo(
                start.x - headLen * Math.cos(angle - Math.PI / 6),
                start.y - headLen * Math.sin(angle - Math.PI / 6),
            );
            ctx.lineTo(
                start.x - headLen * Math.cos(angle + Math.PI / 6),
                start.y - headLen * Math.sin(angle + Math.PI / 6),
            );
            ctx.closePath();
            ctx.fill();

            // Text label at 'end' position
            if (shape.text) {
                const fs = shape.fontSize || 16;
                ctx.font = `bold ${fs}px -apple-system, "SF Pro", sans-serif`;
                const tm = ctx.measureText(shape.text);
                const pad = 5;
                // Background pill
                ctx.fillStyle = 'rgba(0,0,0,0.65)';
                const bgX = end.x - pad;
                const bgY = end.y - fs - pad;
                const bgW = tm.width + pad * 2;
                const bgH = fs + pad * 2;
                ctx.beginPath();
                ctx.roundRect(bgX, bgY, bgW, bgH, 4);
                ctx.fill();
                // Text
                ctx.fillStyle = shape.color;
                ctx.fillText(shape.text, end.x, end.y);
            }
            break;
        }
    }
}

// ==================== Constants ====================

const COLORS = [
    '#ff3b30', '#ff9500', '#ffcc00', '#34c759',
    '#007aff', '#af52de', '#ffffff', '#000000',
];

const TOOL_CONFIG: { key: ToolType; icon: React.ReactNode; label: string }[] = [
    { key: 'pen', icon: <Pencil size={15} />, label: '画笔' },
    { key: 'arrow', icon: <ArrowUpRight size={15} />, label: '箭头' },
    { key: 'callout', icon: <MessageSquarePlus size={15} />, label: '标注' },
    { key: 'rect', icon: <Square size={15} />, label: '矩形' },
    { key: 'ellipse', icon: <Circle size={15} />, label: '椭圆' },
    { key: 'text', icon: <Type size={15} />, label: '文字' },
    { key: 'crop', icon: <Crop size={15} />, label: '裁切' },
    { key: 'pan', icon: <Hand size={15} />, label: '拖拽' },
];

// ==================== Component ====================

interface AnnotationEditorProps {
    imageUrl: string;
    previewUrls?: string[];
    appendedImageUrls?: string[]; // Used for continuous preview
    feedbackText?: string;
    severity?: 'high' | 'medium' | 'low' | null;
    onFeedbackTextChange?: (text: string) => void;
    onSeverityChange?: (severity: 'high' | 'medium' | 'low' | null) => void;
    onSave: (dataUrl: string, text?: string, meta?: { hasVisualChanges?: boolean }) => void;
    onCancel: () => void;
    isInline?: boolean; // When true, uses standard document flow instead of fixed overlay
}

const AnnotationEditor: React.FC<AnnotationEditorProps> = ({
    imageUrl,
    previewUrls,
    appendedImageUrls = [],
    feedbackText: initialFeedbackText,
    severity,
    onFeedbackTextChange,
    onSeverityChange,
    onSave,
    onCancel,
    isInline = false,
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const wrapperRef = useRef<HTMLDivElement>(null);
    const imageRef = useRef<HTMLImageElement>(null);
    const textInputRef = useRef<HTMLInputElement>(null);
    const pendingCalloutRef = useRef<CalloutShape | null>(null);

    const [tool, setTool] = useState<ToolType>('arrow');
    const [color, setColor] = useState('#ff3b30');
    const [lineWidth, setLineWidth] = useState(3);
    const [fontSize, setFontSize] = useState(18);
    const [shapes, setShapes] = useState<Shape[]>([]);
    const [currentShape, setCurrentShape] = useState<Shape | null>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [canvasSize, setCanvasSize] = useState({ w: 800, h: 600 });
    const [imageLoaded, setImageLoaded] = useState(false);
    const [viewScale, setViewScale] = useState(1);
    const [textInput, setTextInput] = useState<{ show: boolean; x: number; y: number; text: string }>({
        show: false, x: 0, y: 0, text: '',
    });
    const [isTextComposing, setIsTextComposing] = useState(false);
    const [mergedImageUrl, setMergedImageUrl] = useState<string>('');
    const [isSpaceDown, setIsSpaceDown] = useState(false);
    const [cropSelection, setCropSelection] = useState<{ start: Point; end: Point } | null>(null);
    // ── Interaction States (Infinite Canvas) ──
    const [isPanning, setIsPanning] = useState(false);
    // Track pure visual translation offset for panning anywhere
    const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
    const panStartRef = useRef({ x: 0, y: 0, oX: 0, oY: 0 });
    const [viewportSize, setViewportSize] = useState({ w: 0, h: 0 });
    const [saveStatus, setSaveStatus] = useState<'idle' | 'saving' | 'saved'>('idle');
    const [hasImageEdited, setHasImageEdited] = useState(false);
    const [currentUrlIdx, setCurrentUrlIdx] = useState(0);

    // Track viewport size for correct visual centering
    useEffect(() => {
        if (!wrapperRef.current) return;
        const observer = new ResizeObserver((entries) => {
            const rect = entries[0].contentRect;
            if (rect.width > 0 && rect.height > 0) {
                setViewportSize({ w: rect.width, h: rect.height });
            }
        });
        observer.observe(wrapperRef.current);
        // Force initial read
        setViewportSize({ 
            w: wrapperRef.current.clientWidth, 
            h: wrapperRef.current.clientHeight 
        });
        return () => observer.disconnect();
    }, []);

    // ── Load and convert all images to data URLs (avoids CORS tainting on save) ──
    useEffect(() => {
        let isCancelled = false;
        setHasImageEdited(false);

        // Convert any URL to a data URL via fetch (works in Electron without CORS limits)
        const toDataUrl = async (src: string): Promise<string> => {
            // Already a data URL? Return as-is
            if (src.startsWith('data:')) return src;
            try {
                const resp = await fetch(src);
                const blob = await resp.blob();
                return await new Promise<string>((resolve, reject) => {
                    const reader = new FileReader();
                    reader.onloadend = () => resolve(reader.result as string);
                    reader.onerror = reject;
                    reader.readAsDataURL(blob);
                });
            } catch {
                // fetch failed — fall back to Image element approach
                return src; // will still display but save may taint
            }
        };

        const loadImg = (src: string): Promise<HTMLImageElement> => {
            return new Promise((resolve, reject) => {
                const i = new Image();
                i.crossOrigin = 'anonymous';
                i.onload = () => resolve(i);
                i.onerror = reject;
                i.src = src;
            });
        };

        const initMergedImage = async () => {
            try {
                // First convert base image to data URL
                const urlsToTry = previewUrls && previewUrls.length > 0 ? [imageUrl, ...previewUrls] : [imageUrl];
                let baseDataUrl: string | null = null;
                let baseImg: HTMLImageElement | null = null;
                for (const url of urlsToTry) {
                    try {
                        const dataUrl = await toDataUrl(url);
                        const img = await loadImg(dataUrl);
                        baseDataUrl = dataUrl;
                        baseImg = img;
                        break;
                    } catch (e) { /* ignore and try next */ }
                }
                if (!baseImg || !baseDataUrl) throw new Error("Base image failed to load");

                // If no appended URLs, use the data URL directly
                if (appendedImageUrls.length === 0) {
                    if (!isCancelled) {
                        setMergedImageUrl(baseDataUrl);
                    }
                    return;
                }

                // Load all appended images
                const appended: HTMLImageElement[] = [];
                for (const url of appendedImageUrls) {
                    if (url) {
                        try {
                            const dataUrl = await toDataUrl(url);
                            appended.push(await loadImg(dataUrl));
                        } catch (e) {
                            console.error("Appended image failed:", url);
                        }
                    }
                }

                if (appended.length === 0) {
                    if (!isCancelled) setMergedImageUrl(baseDataUrl);
                    return;
                }

                // Merge them vertically!
                const maxWidth = Math.max(baseImg.naturalWidth, ...appended.map(i => i.naturalWidth));
                const totalHeight = baseImg.naturalHeight + appended.reduce((sum, i) => sum + i.naturalHeight, 0);

                const canvas = document.createElement('canvas');
                canvas.width = maxWidth;
                canvas.height = totalHeight;
                const ctx = canvas.getContext('2d')!;
                ctx.fillStyle = '#1e1e2e';
                ctx.fillRect(0, 0, maxWidth, totalHeight);

                let currentY = 0;
                ctx.drawImage(baseImg, 0, currentY);
                currentY += baseImg.naturalHeight;

                for (const img of appended) {
                    ctx.drawImage(img, 0, currentY);
                    currentY += img.naturalHeight;
                }

                if (!isCancelled) {
                    setMergedImageUrl(canvas.toDataURL('image/png'));
                }
            } catch (e) {
                console.error("Failed to merge images:", e);
                if (!isCancelled) setMergedImageUrl('');
            }
        };

        if (imageUrl) {
            initMergedImage();
        }

        return () => { isCancelled = true; };
    }, [imageUrl, previewUrls, appendedImageUrls]);

    useEffect(() => {
        setCurrentUrlIdx(0);
    }, [imageUrl, previewUrls]);

    // Handle actual sizing once image source is ready
    useEffect(() => {
        const urls = previewUrls && previewUrls.length > 0 ? previewUrls : [imageUrl];
        const fallbackUrl = urls[currentUrlIdx] || imageUrl;
        const src = mergedImageUrl || fallbackUrl;
        if (!src) return;
        const img = imageRef.current;
        if (!img) return;

        const handleLoad = () => {
            const maxW = isInline ? window.innerWidth * 0.95 : window.innerWidth * 0.82;
            const maxH = isInline ? window.innerHeight * 0.85 : window.innerHeight * 0.68;
            
            let ratio = 1;
            // If the image is extremely tall (e.g. multiple stitched screenshots > 2.5), we prioritize fitting width
            if (img.naturalHeight > img.naturalWidth * 2.5) {
                ratio = Math.min(maxW / img.naturalWidth, 1);
            } else {
                ratio = Math.min(maxW / img.naturalWidth, maxH / img.naturalHeight, 1);
            }

            const w = Math.round(img.naturalWidth * ratio);
            const h = Math.round(img.naturalHeight * ratio);
            setCanvasSize({ w, h });
            setViewScale(1);
            setImageLoaded(true);
        };

        if (img.complete && img.naturalWidth > 0) {
            handleLoad();
        } else {
            img.onload = handleLoad;
        }
    }, [mergedImageUrl, currentUrlIdx, previewUrls, imageUrl, isInline]);

    const getNormalizedCropRect = useCallback((selection: { start: Point; end: Point } | null) => {
        if (!selection) return null;
        const x = Math.min(selection.start.x, selection.end.x);
        const y = Math.min(selection.start.y, selection.end.y);
        const w = Math.abs(selection.end.x - selection.start.x);
        const h = Math.abs(selection.end.y - selection.start.y);
        return { x, y, w, h };
    }, []);

    // ── Render shapes on canvas ──
    const renderCanvas = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const ctx = canvas.getContext('2d')!;
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        for (const s of shapes) drawShape(ctx, s);
        if (currentShape) drawShape(ctx, currentShape);
        // Draw pending callout arrow while user is typing text
        if (pendingCalloutRef.current) drawShape(ctx, pendingCalloutRef.current);
    }, [shapes, currentShape]);

    useEffect(() => {
        renderCanvas();
    }, [renderCanvas]);

    // ── Mouse coordinate helper ──
    const getPos = (e: React.MouseEvent): Point => {
        const canvas = canvasRef.current!;
        const rect = canvas.getBoundingClientRect();
        return {
            x: (e.clientX - rect.left) * (canvas.width / rect.width),
            y: (e.clientY - rect.top) * (canvas.height / rect.height),
        };
    };

    // ── Mouse handlers ──
    const handleMouseDown = (e: React.MouseEvent) => {
        e.stopPropagation();
        // Space+Drag, Middle Click, Alt+Drag OR Right Click, or explicit Pan Tool
        if (e.button === 1 || e.button === 2 || (e.button === 0 && (isSpaceDown || e.altKey || tool === 'pan'))) {
            setIsPanning(true);
            panStartRef.current = {
                x: e.clientX,
                y: e.clientY,
                oX: panOffset.x,
                oY: panOffset.y,
            };
            return;
        }

        if (e.button !== 0) return; // ignore other buttons
        const pos = getPos(e);

        if (tool === 'text') {
            // If text input is already visible, confirm it first before opening new one
            if (textInput.show) {
                handleTextConfirm();
            }
            setIsPanning(false);
            setIsDrawing(false);
            // Use a microtask to ensure previous confirm settles before showing new input
            setTimeout(() => {
                setTextInput({ show: true, x: pos.x, y: pos.y, text: '' });
                pendingCalloutRef.current = null;
                setTimeout(() => textInputRef.current?.focus(), 30);
            }, 10);
            return;
        }

        if (tool === 'callout') {
            setIsDrawing(true);
            setCurrentShape({ type: 'callout', color, lineWidth, start: pos, end: pos, text: '', fontSize });
            return;
        }

        if (tool === 'crop') {
            setIsDrawing(true);
            setCurrentShape(null);
            setCropSelection({ start: pos, end: pos });
            return;
        }

        setIsDrawing(true);

        if (tool === 'pen') {
            setCurrentShape({ type: 'pen', color, lineWidth, points: [pos] });
        } else if (tool === 'arrow') {
            setCurrentShape({ type: 'arrow', color, lineWidth, start: pos, end: pos });
        } else if (tool === 'rect') {
            setCurrentShape({ type: 'rect', color, lineWidth, start: pos, end: pos });
        } else if (tool === 'ellipse') {
            setCurrentShape({ type: 'ellipse', color, lineWidth, start: pos, end: pos });
        }
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (isPanning) {
            const dx = e.clientX - panStartRef.current.x;
            const dy = e.clientY - panStartRef.current.y;
            setPanOffset({
                x: panStartRef.current.oX + dx,
                y: panStartRef.current.oY + dy
            });
            return;
        }

        if (!isDrawing) return;
        const pos = getPos(e);

        if (tool === 'crop') {
            setCropSelection(prev => prev ? ({ ...prev, end: pos }) : prev);
            return;
        }

        if (!currentShape) return;

        if (currentShape.type === 'pen') {
            setCurrentShape({ ...currentShape, points: [...currentShape.points, pos] });
        } else if (currentShape.type === 'arrow' || currentShape.type === 'rect' || currentShape.type === 'ellipse' || currentShape.type === 'callout') {
            setCurrentShape({ ...currentShape, end: pos });
        }
    };

    const handleMouseUp = () => {
        if (isPanning) {
            setIsPanning(false);
            return;
        }
        if (!isDrawing) return;
        if (tool === 'crop') {
            setIsDrawing(false);
            return;
        }
        if (!currentShape) return;
        setIsDrawing(false);

        // Callout: after drawing the arrow line, show text input at end point
        if (currentShape.type === 'callout') {
            pendingCalloutRef.current = currentShape as CalloutShape;
            setCurrentShape(null);
            setTextInput({ show: true, x: currentShape.end.x, y: currentShape.end.y, text: '' });
            setTimeout(() => textInputRef.current?.focus(), 50);
            return;
        }

        setShapes(prev => [...prev, currentShape]);
        setCurrentShape(null);
    };

    // ── Text input ──
    const buildPendingTextShape = (): TextShape | null => {
        const text = textInput.text.trim();
        if (!text) return null;
        return {
            type: 'text',
            color,
            lineWidth,
            position: { x: textInput.x, y: textInput.y },
            text,
            fontSize,
        };
    };

    const handleTextConfirm = () => {
        if (pendingCalloutRef.current) {
            // Complete a callout shape with the entered text
            const callout = pendingCalloutRef.current;
            if (textInput.text.trim()) {
                setShapes(prev => [...prev, {
                    ...callout,
                    text: textInput.text,
                }]);
            }
            pendingCalloutRef.current = null;
        } else {
            const shape = buildPendingTextShape();
            if (shape) {
                setShapes(prev => [...prev, shape]);
            }
        }
        setTextInput({ show: false, x: 0, y: 0, text: '' });
        setIsTextComposing(false);
    };

    const handleWheelZoom = useCallback((e: React.WheelEvent<HTMLDivElement>) => {
        e.stopPropagation();
        // e.preventDefault() in React onWheel may be passive, so we rely on touchAction: 'none' in CSS 
        // to prevent native zooming and scrolling conflicts
        e.preventDefault();
        
        const viewport = wrapperRef.current;
        if (!viewport) return;

        const factor = e.deltaY > 0 ? 0.92 : 1.08;
        const nextScale = Math.max(0.5, Math.min(4, viewScale * factor));
        if (Math.abs(nextScale - viewScale) < 0.001) return;

        const rect = viewport.getBoundingClientRect();
        const localX = e.clientX - rect.left;
        const localY = e.clientY - rect.top;

        const innerW = canvasSize.w * viewScale;
        const innerH = canvasSize.h * viewScale;
        const baseOffsetX = viewportSize.w > 0 ? Math.max(0, (viewportSize.w - innerW) / 2) : 0;
        const baseOffsetY = viewportSize.h > 0 ? Math.max(0, (viewportSize.h - innerH) / 2) : 0;
        
        const finalLeft = baseOffsetX + panOffset.x;
        const finalTop = baseOffsetY + panOffset.y;

        // Convert pointer from viewport pixels to mapped image-space percent coordinate
        const imageLocalX = localX - finalLeft;
        const imageLocalY = localY - finalTop;

        const nextInnerW = canvasSize.w * nextScale;
        const nextInnerH = canvasSize.h * nextScale;
        const nextBaseOffsetX = viewportSize.w > 0 ? Math.max(0, (viewportSize.w - nextInnerW) / 2) : 0;
        const nextBaseOffsetY = viewportSize.h > 0 ? Math.max(0, (viewportSize.h - nextInnerH) / 2) : 0;

        // Match the exact pixel scaling locally so mouse remains over same point
        const scaleRatio = nextScale / viewScale;
        const nextImageLocalX = imageLocalX * scaleRatio;
        const nextImageLocalY = imageLocalY * scaleRatio;

        // Synchronously update both viewScale and CSS translation offset in a single render batch!
        // This eliminates the 1-frame jitter/bounce effect
        setPanOffset({
            x: localX - nextBaseOffsetX - nextImageLocalX,
            y: localY - nextBaseOffsetY - nextImageLocalY,
        });
        setViewScale(nextScale);
    }, [viewScale, canvasSize, panOffset, viewportSize]); // Added all dependencies for accurate mathematical tracking

    // ── Undo ──
    const handleUndo = () => {
        setShapes(prev => prev.slice(0, -1));
    };

    // ── Clear ──
    const handleClear = () => {
        setShapes([]);
        setCurrentShape(null);
        setCropSelection(null);
    };

    // ── Apply crop ──
    const handleApplyCrop = () => {
        const rect = getNormalizedCropRect(cropSelection);
        const img = imageRef.current;
        if (!rect || !img) return;
        if (rect.w < 6 || rect.h < 6) return;

        const scaleX = img.naturalWidth / canvasSize.w;
        const scaleY = img.naturalHeight / canvasSize.h;
        const sx = Math.max(0, Math.round(rect.x * scaleX));
        const sy = Math.max(0, Math.round(rect.y * scaleY));
        const sw = Math.max(1, Math.round(rect.w * scaleX));
        const sh = Math.max(1, Math.round(rect.h * scaleY));

        const out = document.createElement('canvas');
        out.width = sw;
        out.height = sh;
        const ctx = out.getContext('2d');
        if (!ctx) return;

        try {
            ctx.drawImage(img, sx, sy, sw, sh, 0, 0, sw, sh);
        } catch {
            return;
        }

        const croppedDataUrl = out.toDataURL('image/png');
        setMergedImageUrl(croppedDataUrl);
        setHasImageEdited(true);
        setShapes([]);
        setCurrentShape(null);
        setTextInput({ show: false, x: 0, y: 0, text: '' });
        setCropSelection(null);
        setIsDrawing(false);
        setIsPanning(false);
        setPanOffset({ x: 0, y: 0 });
        setViewScale(1);
        setTool('arrow');
    };

    // ── Save: merge image + annotations ──
    const handleSave = async () => {
        const img = imageRef.current;
        if (!img) return;
        setSaveStatus('saving');

        // Create output canvas at display resolution
        const outCanvas = document.createElement('canvas');
        outCanvas.width = canvasSize.w;
        outCanvas.height = canvasSize.h;
        const ctx = outCanvas.getContext('2d')!;

        // Draw image
        try {
            ctx.drawImage(img, 0, 0, canvasSize.w, canvasSize.h);
        } catch {
            // CORS fallback — white background
            ctx.fillStyle = '#f0f0f0';
            ctx.fillRect(0, 0, canvasSize.w, canvasSize.h);
            ctx.fillStyle = '#999';
            ctx.font = '14px sans-serif';
            ctx.fillText('(原图因权限无法嵌入，仅保留标注)', 20, 30);
        }

        // Draw annotations from state directly to avoid render-timing race.
        const exportShapes: Shape[] = [...shapes];
        if (currentShape) exportShapes.push(currentShape);
        // Include pending callout arrow (user may be typing text)
        if (pendingCalloutRef.current) {
            if (textInput.show && textInput.text.trim()) {
                exportShapes.push({ ...pendingCalloutRef.current, text: textInput.text });
            } else {
                exportShapes.push(pendingCalloutRef.current);
            }
        }
        if (textInput.show && !pendingCalloutRef.current) {
            const pendingText = buildPendingTextShape();
            if (pendingText) exportShapes.push(pendingText);
        }
        const hasVisualChanges = hasImageEdited || exportShapes.length > 0;
        for (const s of exportShapes) drawShape(ctx, s);

        try {
            const dataUrl = outCanvas.toDataURL('image/png');
            onSave(dataUrl, undefined, { hasVisualChanges });
        } catch {
            // Canvas tainted — render annotations only
            const fallback = document.createElement('canvas');
            fallback.width = canvasSize.w;
            fallback.height = canvasSize.h;
            const fCtx = fallback.getContext('2d')!;
            fCtx.fillStyle = '#f8f8f8';
            fCtx.fillRect(0, 0, canvasSize.w, canvasSize.h);
            for (const s of exportShapes) drawShape(fCtx, s);
            onSave(fallback.toDataURL('image/png'), undefined, { hasVisualChanges });
        }

        setSaveStatus('saved');
        setTimeout(() => setSaveStatus('idle'), 2000);
    };

    // ── Keyboard shortcuts ──
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                if (textInput.show) {
                    setTextInput({ show: false, x: 0, y: 0, text: '' });
                } else if (cropSelection) {
                    setCropSelection(null);
                    setIsDrawing(false);
                } else {
                    onCancel();
                }
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 'z') {
                e.preventDefault();
                handleUndo();
            }
            if ((e.metaKey || e.ctrlKey) && e.key === 's') {
                e.preventDefault();
                handleSave();
            }
        };

        const handleSpaceDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' && document.activeElement?.tagName !== 'INPUT' && document.activeElement?.tagName !== 'TEXTAREA') {
                e.preventDefault();
                setIsSpaceDown(true);
            }
        };
        const handleSpaceUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') setIsSpaceDown(false);
        };
        const handleWindowBlur = () => {
            setIsSpaceDown(false);
            setIsPanning(false);
        };

        window.addEventListener('keydown', handler);
        window.addEventListener('keydown', handleSpaceDown);
        window.addEventListener('keyup', handleSpaceUp);
        window.addEventListener('blur', handleWindowBlur);

        return () => {
            window.removeEventListener('keydown', handler);
            window.removeEventListener('keydown', handleSpaceDown);
            window.removeEventListener('keyup', handleSpaceUp);
            window.removeEventListener('blur', handleWindowBlur);
        };
    }, [textInput.show, cropSelection, onCancel, shapes]);

    // Choose the best preview URL
    const allUrls = previewUrls && previewUrls.length > 0 ? previewUrls : [imageUrl];
    const displayUrl = allUrls[currentUrlIdx] || imageUrl;
    const renderUrl = mergedImageUrl || displayUrl;
    const normalizedCropRect = getNormalizedCropRect(cropSelection);
    const hasValidCropSelection = Boolean(normalizedCropRect && normalizedCropRect.w >= 6 && normalizedCropRect.h >= 6);

    return (
        <div
            style={isInline ? {
                display: 'flex', flexDirection: 'column', width: '100%', height: '100%',
                background: '#1a1a2e', position: 'absolute', inset: 0, zIndex: 10,
                alignItems: 'center',
            } : {
                position: 'fixed', inset: 0, zIndex: 200000,
                background: 'rgba(0,0,0,0.85)', backdropFilter: 'blur(8px)',
                display: 'flex', flexDirection: 'column',
                alignItems: 'center',
            }}
            onMouseUp={() => isDrawing && handleMouseUp()}
            onClick={e => { if (e.target === e.currentTarget) onCancel(); }}
        >
            {/* ── Toolbar ── */}
            <div style={{
                display: 'flex', alignItems: 'center', gap: 6, padding: '8px 16px',
                background: 'rgba(30,30,50,0.95)', borderRadius: '0 0 12px 12px',
                boxShadow: '0 4px 20px rgba(0,0,0,0.4)', flexWrap: 'wrap', justifyContent: 'center',
            }}>
                {/* Tools */}
                {TOOL_CONFIG.map(t => (
                    <button
                        key={t.key}
                        onClick={() => setTool(t.key)}
                        title={t.label}
                        style={{
                            background: tool === t.key ? 'rgba(99,102,241,0.8)' : 'rgba(255,255,255,0.08)',
                            border: tool === t.key ? '1px solid #818cf8' : '1px solid transparent',
                            borderRadius: 6, padding: '5px 9px', cursor: 'pointer',
                            color: tool === t.key ? '#fff' : '#94a3b8',
                            display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                            transition: 'all 0.15s',
                        }}
                    >
                        {t.icon} {t.label}
                    </button>
                ))}

                <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

                {/* Colors */}
                {COLORS.map(c => (
                    <button
                        key={c}
                        onClick={() => setColor(c)}
                        style={{
                            width: 20, height: 20, borderRadius: '50%',
                            background: c,
                            border: color === c ? '2px solid #fff' : '2px solid rgba(255,255,255,0.2)',
                            cursor: 'pointer', boxShadow: color === c ? '0 0 6px rgba(255,255,255,0.4)' : 'none',
                            transition: 'all 0.15s',
                        }}
                    />
                ))}

                <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

                {/* Line width */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                        onClick={() => setLineWidth(w => Math.max(1, w - 1))}
                        style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: '#94a3b8' }}
                    ><Minus size={12} /></button>
                    <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 24, textAlign: 'center' }}>{lineWidth}px</span>
                    <button
                        onClick={() => setLineWidth(w => Math.min(20, w + 1))}
                        style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: '#94a3b8' }}
                    ><Plus size={12} /></button>
                </div>

                {(tool === 'text' || tool === 'callout') && (
                    <>
                        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                            <span style={{ fontSize: 10, color: '#64748b' }}>字号</span>
                            <input
                                type="number"
                                value={fontSize}
                                onChange={e => setFontSize(Math.max(8, Math.min(72, Number(e.target.value) || 18)))}
                                style={{ width: 40, background: 'rgba(255,255,255,0.08)', border: '1px solid rgba(255,255,255,0.15)', borderRadius: 4, padding: '2px 4px', color: '#e2e8f0', fontSize: 11, textAlign: 'center' }}
                            />
                        </div>
                    </>
                )}

                <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

                {/* View zoom */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                    <button
                        onClick={() => setViewScale(z => Math.max(0.5, z / 1.1))}
                        style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: '#94a3b8' }}
                        title="缩小视图"
                    ><Minus size={12} /></button>
                    <span style={{ fontSize: 11, color: '#94a3b8', minWidth: 40, textAlign: 'center' }}>
                        {Math.round(viewScale * 100)}%
                    </span>
                    <button
                        onClick={() => setViewScale(z => Math.min(4, z * 1.1))}
                        style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: '#94a3b8' }}
                        title="放大视图"
                    ><Plus size={12} /></button>
                    <button
                        onClick={() => setViewScale(1)}
                        style={{ background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 4, padding: '3px 6px', cursor: 'pointer', color: '#94a3b8', fontSize: 10 }}
                        title="重置缩放"
                    >1:1</button>
                </div>

                <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

                {/* Actions */}
                <button
                    onClick={handleUndo}
                    disabled={shapes.length === 0}
                    title="撤销 (⌘Z)"
                    style={{
                        background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                        padding: '5px 9px', cursor: shapes.length > 0 ? 'pointer' : 'not-allowed',
                        color: shapes.length > 0 ? '#94a3b8' : '#475569',
                        display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                    }}
                >
                    <Undo2 size={14} /> 撤销
                </button>
                <button
                    onClick={handleClear}
                    disabled={shapes.length === 0}
                    style={{
                        background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                        padding: '5px 9px', cursor: shapes.length > 0 ? 'pointer' : 'not-allowed',
                        color: shapes.length > 0 ? '#f87171' : '#475569',
                        display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                    }}
                >
                    <Trash2 size={14} /> 清除
                </button>

                {tool === 'crop' && (
                    <>
                        <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />
                        <button
                            onClick={() => setCropSelection(null)}
                            disabled={!cropSelection}
                            style={{
                                background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                                padding: '5px 9px', cursor: cropSelection ? 'pointer' : 'not-allowed',
                                color: cropSelection ? '#94a3b8' : '#475569',
                                display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                            }}
                        >
                            <X size={14} /> 清空裁切框
                        </button>
                        <button
                            onClick={handleApplyCrop}
                            disabled={!hasValidCropSelection}
                            style={{
                                background: 'linear-gradient(135deg, #0ea5e9, #0284c7)',
                                border: 'none',
                                borderRadius: 6,
                                padding: '5px 12px',
                                cursor: hasValidCropSelection ? 'pointer' : 'not-allowed',
                                color: '#fff',
                                fontWeight: 600,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: 11,
                                opacity: hasValidCropSelection ? 1 : 0.45,
                            }}
                        >
                            <Crop size={14} /> 应用裁切
                        </button>
                    </>
                )}

                <div style={{ width: 1, height: 24, background: 'rgba(255,255,255,0.15)', margin: '0 4px' }} />

                <button
                    onClick={handleSave}
                    disabled={saveStatus === 'saving'}
                    title="保存 (⌘S)"
                    style={{
                        background: saveStatus === 'saved' ? '#16a34a'
                            : saveStatus === 'saving' ? '#ca8a04'
                            : 'linear-gradient(135deg, #22c55e, #16a34a)',
                        border: 'none', borderRadius: 6,
                        padding: '5px 14px', cursor: saveStatus === 'saving' ? 'wait' : 'pointer',
                        color: '#fff', fontWeight: 600,
                        display: 'flex', alignItems: 'center', gap: 4, fontSize: 12,
                        boxShadow: saveStatus === 'saved' ? '0 0 12px rgba(34,197,94,0.6)' : '0 2px 8px rgba(34,197,94,0.3)',
                        transition: 'all 0.2s',
                    }}
                >
                    {saveStatus === 'saved' ? <><Save size={14} /> ✓ 已保存</>
                        : saveStatus === 'saving' ? <><Save size={14} /> 保存中...</>
                        : <><Save size={14} /> 保存标注</>}
                </button>
                <button
                    onClick={onCancel}
                    title="取消 (Esc)"
                    style={{
                        background: 'rgba(255,255,255,0.08)', border: 'none', borderRadius: 6,
                        padding: '5px 9px', cursor: 'pointer', color: '#94a3b8',
                        display: 'flex', alignItems: 'center', gap: 4, fontSize: 11,
                    }}
                >
                    <X size={14} /> 取消
                </button>
            </div>

            {/* ── Canvas area ── */}
            <div
                ref={wrapperRef}
                style={{
                    position: 'relative', marginTop: 12,
                    width: '100%', flex: 1,
                    maxWidth: '100%', maxHeight: isInline ? '100%' : 'calc(100vh - 100px)',
                    borderRadius: 8, overflow: 'hidden', // Disabled native scrollbars, drag to pan instead
                    boxShadow: isInline ? 'none' : '0 8px 32px rgba(0,0,0,0.5)',
                    background: '#0f1220',
                    touchAction: 'none', // Prevent trackpad native gestures (pinch/swipe)
                    cursor: (isPanning || tool === 'pan') ? (isPanning ? 'grabbing' : 'grab') : (isSpaceDown ? 'grab' : (tool === 'text' ? 'text' : 'crosshair')),
                }}
                onWheel={handleWheelZoom}
                onContextMenu={e => { e.preventDefault(); e.stopPropagation(); }}
                onMouseDown={(e) => {
                    // Click on empty wrapper space to pan, or if pan tool is selected
                    if ((e.target === wrapperRef.current || tool === 'pan') && e.button === 0) {
                        setIsPanning(true);
                        panStartRef.current = {
                            x: e.clientX, y: e.clientY,
                            oX: panOffset.x,
                            oY: panOffset.y,
                        };
                    }
                }}
                onMouseMove={(e) => {
                    if (isPanning) {
                        const dx = e.clientX - panStartRef.current.x;
                        const dy = e.clientY - panStartRef.current.y;
                        setPanOffset({
                            x: panStartRef.current.oX + dx,
                            y: panStartRef.current.oY + dy
                        });
                    }
                }}
                onMouseUp={() => isPanning && setIsPanning(false)}
                onMouseLeave={() => isPanning && setIsPanning(false)}
            >
                {(() => {
                    const innerW = canvasSize.w * viewScale;
                    const innerH = canvasSize.h * viewScale;
                    const baseOffsetX = viewportSize.w > 0 ? Math.max(0, (viewportSize.w - innerW) / 2) : 0;
                    const baseOffsetY = viewportSize.h > 0 ? Math.max(0, (viewportSize.h - innerH) / 2) : 0;

                    return (
                        <div
                            style={{
                                position: 'relative',
                                width: innerW, height: innerH,
                                left: baseOffsetX, top: baseOffsetY,
                                transform: `translate(${panOffset.x}px, ${panOffset.y}px)`,
                                transition: 'width 0s, height 0s', // instantaneous rendering for tracking
                            }}
                        >
                            {/* Background image */}
                    {renderUrl && (
                        <img
                            ref={imageRef}
                            src={renderUrl}
                            referrerPolicy="no-referrer"
                            onError={() => {
                                // If merged image failed, fallback to raw preview chain.
                                if (mergedImageUrl) {
                                    setMergedImageUrl('');
                                    setCurrentUrlIdx(0);
                                    return;
                                }
                                if (currentUrlIdx + 1 < allUrls.length) {
                                    setCurrentUrlIdx(prev => prev + 1);
                                }
                            }}
                            style={{
                                position: 'absolute', top: 0, left: 0,
                                width: '100%', height: '100%', objectFit: 'contain',
                                pointerEvents: 'none', background: '#1e1e2e',
                            }}
                            alt=""
                        />
                    )}

                    {/* Drawing canvas overlay */}
                    <canvas
                        ref={canvasRef}
                        width={canvasSize.w}
                        height={canvasSize.h}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: '100%' }}
                        onMouseDown={handleMouseDown}
                        onMouseMove={handleMouseMove}
                        onMouseUp={handleMouseUp}
                        onMouseLeave={handleMouseUp}
                    />

                            {tool === 'crop' && cropSelection && (() => {
                                const r = getNormalizedCropRect(cropSelection);
                                if (!r) return null;
                                const left = r.x * viewScale;
                                const top = r.y * viewScale;
                                const width = r.w * viewScale;
                                const height = r.h * viewScale;
                                return (
                                    <div
                                        style={{
                                            position: 'absolute',
                                            inset: 0,
                                            pointerEvents: 'none',
                                            zIndex: 7,
                                        }}
                                    >
                                        <div
                                            style={{
                                                position: 'absolute',
                                                left,
                                                top,
                                                width: Math.max(1, width),
                                                height: Math.max(1, height),
                                                border: '2px dashed #38bdf8',
                                                background: 'rgba(14,165,233,0.16)',
                                                boxShadow: '0 0 0 9999px rgba(0,0,0,0.36)',
                                            }}
                                        />
                                        <div
                                            style={{
                                                position: 'absolute',
                                                left,
                                                top: Math.max(0, top - 22),
                                                padding: '2px 6px',
                                                borderRadius: 4,
                                                background: 'rgba(15,23,42,0.85)',
                                                color: '#bae6fd',
                                                fontSize: 10,
                                                fontWeight: 600,
                                            }}
                                        >
                                            裁切 {Math.round(r.w)}×{Math.round(r.h)}
                                        </div>
                                    </div>
                                );
                            })()}

                            {textInput.show && (
                                <div
                                    style={{
                                        position: 'absolute',
                                        left: Math.max(8, Math.min(textInput.x * viewScale, canvasSize.w * viewScale - 200)),
                                        top: Math.max(8, Math.min(textInput.y * viewScale + 6, canvasSize.h * viewScale - 38)),
                                        zIndex: 8,
                                        display: 'flex', alignItems: 'center', gap: 4,
                                    }}
                                    onMouseDown={e => e.stopPropagation()}
                                    onClick={e => e.stopPropagation()}
                                >
                                    <input
                                        ref={textInputRef}
                                        autoFocus
                                        value={textInput.text}
                                        onChange={e => setTextInput(prev => ({ ...prev, text: e.target.value }))}
                                        onCompositionStart={() => setIsTextComposing(true)}
                                        onCompositionEnd={() => setIsTextComposing(false)}
                                        onKeyDown={e => {
                                            e.stopPropagation();
                                            if (e.key === 'Enter' && !isTextComposing) handleTextConfirm();
                                            if (e.key === 'Escape') {
                                                pendingCalloutRef.current = null;
                                                setTextInput({ show: false, x: 0, y: 0, text: '' });
                                                setIsTextComposing(false);
                                            }
                                        }}
                                        placeholder="输入文字后按 Enter…"
                                        style={{
                                            background: 'rgba(0,0,0,0.72)', color: color,
                                            border: `1px solid ${color}`, borderRadius: 4,
                                            padding: '3px 8px',
                                            fontSize: Math.max(12, Math.min(32, Math.round(fontSize * viewScale * 0.85))),
                                            fontWeight: 'bold', outline: 'none', minWidth: 120,
                                            fontFamily: '-apple-system, "SF Pro", sans-serif',
                                        }}
                                    />
                                    <button
                                        onClick={(e) => { e.stopPropagation(); handleTextConfirm(); }}
                                        onMouseDown={e => e.stopPropagation()}
                                        style={{
                                            width: 24, height: 24, borderRadius: 4,
                                            background: color, border: 'none', cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: '#fff', fontSize: 14, fontWeight: 'bold',
                                        }}
                                        title="确认 (Enter)"
                                    >✓</button>
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            pendingCalloutRef.current = null;
                                            setTextInput({ show: false, x: 0, y: 0, text: '' });
                                        }}
                                        onMouseDown={e => e.stopPropagation()}
                                        style={{
                                            width: 24, height: 24, borderRadius: 4,
                                            background: 'rgba(255,255,255,0.15)', border: 'none', cursor: 'pointer',
                                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                                            color: '#94a3b8', fontSize: 12,
                                        }}
                                        title="取消 (Esc)"
                                    >✕</button>
                                </div>
                            )}
                        </div>
                    );
                })()}

                {/* Shape count indicator */}
                {shapes.length > 0 && (
                    <div style={{
                        position: 'absolute', bottom: 8, right: 8,
                        background: 'rgba(0,0,0,0.6)', borderRadius: 12,
                        padding: '2px 10px', fontSize: 10, color: '#94a3b8',
                    }}>
                        {shapes.length} 个标注
                    </div>
                )}
            </div>

            {/* Hint */}
            <div style={{ marginTop: 8, fontSize: 11, color: '#64748b', textAlign: 'center' }}>
                滚轮缩放视图 · 选择工具后在图片上绘制 · 裁切工具可框选后应用 · ⌘Z 撤销 · ⌘S 保存 · Esc 取消
            </div>

            {/* Optional feedback text input */}
            {onFeedbackTextChange && !isInline && (
                <div style={{
                    marginTop: 10, width: canvasSize.w || 600,
                    maxWidth: '85vw',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                        <div style={{ fontSize: 11, color: '#94a3b8', display: 'flex', alignItems: 'center', gap: 4 }}>
                            💬 文字建议
                        </div>
                        {onSeverityChange && (
                            <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.03)', padding: 3, borderRadius: 6 }}>
                                {(['high', 'medium', 'low'] as const).map(sev => {
                                    const labels = { high: '高', medium: '中', low: '低' };
                                    const colors = { high: '#ef4444', medium: '#eab308', low: '#3b82f6' };
                                    const isActive = severity === sev;
                                    return (
                                        <button
                                            key={sev}
                                            onClick={() => onSeverityChange(isActive ? null : sev)}
                                            style={{
                                                background: isActive ? `${colors[sev]}22` : 'transparent',
                                                border: `1px solid ${isActive ? colors[sev] : 'transparent'}`,
                                                borderRadius: 4, padding: '2px 10px', cursor: 'pointer',
                                                color: isActive ? colors[sev] : '#94a3b8',
                                                fontSize: 11, fontWeight: isActive ? 600 : 400,
                                                transition: 'all 0.15s',
                                            }}
                                            title={`严重程度: ${labels[sev]}`}
                                        >{labels[sev]}</button>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                    <textarea
                        value={initialFeedbackText || ''}
                        onChange={e => onFeedbackTextChange(e.target.value)}
                        placeholder="输入修改建议…"
                        rows={2}
                        style={{
                            width: '100%', padding: '8px 12px',
                            background: 'rgba(255,255,255,0.06)',
                            border: '1px solid rgba(255,255,255,0.12)',
                            borderRadius: 8, color: '#e2e8f0', fontSize: 12,
                            lineHeight: 1.5, resize: 'vertical', outline: 'none',
                            fontFamily: '-apple-system, "SF Pro", sans-serif',
                        }}
                        onFocus={e => { e.target.style.borderColor = '#f59e0b'; }}
                        onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.12)'; }}
                    />
                </div>
            )}
        </div>
    );
};

export default AnnotationEditor;
