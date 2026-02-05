/**
 * 图片标注画布组件 - 在图片上绘制标注
 */
import React, { useRef, useState, useEffect, useCallback } from 'react';
import { Square, Circle, ArrowRight, Pencil, Type, Undo2, Trash2, Download } from 'lucide-react';
import { Annotation, AnnotationType, ANNOTATION_TOOLS } from '../types';

interface ImageCanvasProps {
    imageUrl: string;
    annotations: Annotation[];
    currentTool: AnnotationType | null;
    annotationColor: string;
    onAnnotationsChange: (annotations: Annotation[]) => void;
    onToolChange: (tool: AnnotationType | null) => void;
    onColorChange: (color: string) => void;
}

// 预设颜色
const PRESET_COLORS = [
    '#ef4444', // red
    '#f97316', // orange
    '#eab308', // yellow
    '#22c55e', // green
    '#06b6d4', // cyan
    '#3b82f6', // blue
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#ffffff', // white
];

// 工具图标映射
const ToolIcon: React.FC<{ type: AnnotationType; size?: number }> = ({ type, size = 18 }) => {
    switch (type) {
        case 'rectangle': return <Square size={size} />;
        case 'circle': return <Circle size={size} />;
        case 'arrow': return <ArrowRight size={size} />;
        case 'freehand': return <Pencil size={size} />;
        case 'text': return <Type size={size} />;
    }
};

const ImageCanvas: React.FC<ImageCanvasProps> = ({
    imageUrl,
    annotations,
    currentTool,
    annotationColor,
    onAnnotationsChange,
    onToolChange,
    onColorChange,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [isDrawing, setIsDrawing] = useState(false);
    const [currentPoints, setCurrentPoints] = useState<{ x: number; y: number }[]>([]);
    const [imageSize, setImageSize] = useState({ width: 0, height: 0 });
    const [textInput, setTextInput] = useState<{ x: number; y: number; value: string } | null>(null);

    // 加载图片并设置画布大小
    useEffect(() => {
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.onload = () => {
            if (containerRef.current && canvasRef.current) {
                const container = containerRef.current;
                const aspectRatio = img.width / img.height;
                const containerWidth = container.clientWidth;
                const containerHeight = container.clientHeight;

                let width = containerWidth;
                let height = containerWidth / aspectRatio;

                if (height > containerHeight) {
                    height = containerHeight;
                    width = containerHeight * aspectRatio;
                }

                setImageSize({ width, height });
                canvasRef.current.width = width;
                canvasRef.current.height = height;
            }
        };
        img.src = imageUrl;
    }, [imageUrl]);

    // 绘制所有标注
    const drawAnnotations = useCallback(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        const ctx = canvas.getContext('2d');
        if (!ctx) return;

        // 清除画布
        ctx.clearRect(0, 0, canvas.width, canvas.height);

        // 绘制已保存的标注
        annotations.forEach(annotation => {
            drawAnnotation(ctx, annotation);
        });

        // 绘制当前正在绘制的标注
        if (currentPoints.length > 0 && currentTool) {
            const tempAnnotation: Annotation = {
                id: 'temp',
                type: currentTool,
                points: currentPoints,
                color: annotationColor,
                strokeWidth: 3,
            };
            drawAnnotation(ctx, tempAnnotation);
        }
    }, [annotations, currentPoints, currentTool, annotationColor]);

    // 绘制单个标注
    const drawAnnotation = (ctx: CanvasRenderingContext2D, annotation: Annotation) => {
        ctx.strokeStyle = annotation.color;
        ctx.fillStyle = annotation.color;
        ctx.lineWidth = annotation.strokeWidth;
        ctx.lineCap = 'round';
        ctx.lineJoin = 'round';

        const { type, points } = annotation;

        switch (type) {
            case 'rectangle':
                if (points.length >= 2) {
                    const [start, end] = points;
                    ctx.strokeRect(
                        start.x, start.y,
                        end.x - start.x, end.y - start.y
                    );
                }
                break;

            case 'circle':
                if (points.length >= 2) {
                    const [center, edge] = points;
                    const radius = Math.sqrt(
                        Math.pow(edge.x - center.x, 2) + Math.pow(edge.y - center.y, 2)
                    );
                    ctx.beginPath();
                    ctx.arc(center.x, center.y, radius, 0, Math.PI * 2);
                    ctx.stroke();
                }
                break;

            case 'arrow':
                if (points.length >= 2) {
                    const [start, end] = points;
                    const headLength = 15;
                    const angle = Math.atan2(end.y - start.y, end.x - start.x);

                    // 线条
                    ctx.beginPath();
                    ctx.moveTo(start.x, start.y);
                    ctx.lineTo(end.x, end.y);
                    ctx.stroke();

                    // 箭头
                    ctx.beginPath();
                    ctx.moveTo(end.x, end.y);
                    ctx.lineTo(
                        end.x - headLength * Math.cos(angle - Math.PI / 6),
                        end.y - headLength * Math.sin(angle - Math.PI / 6)
                    );
                    ctx.lineTo(
                        end.x - headLength * Math.cos(angle + Math.PI / 6),
                        end.y - headLength * Math.sin(angle + Math.PI / 6)
                    );
                    ctx.closePath();
                    ctx.fill();
                }
                break;

            case 'freehand':
                if (points.length > 1) {
                    ctx.beginPath();
                    ctx.moveTo(points[0].x, points[0].y);
                    points.slice(1).forEach(point => {
                        ctx.lineTo(point.x, point.y);
                    });
                    ctx.stroke();
                }
                break;

            case 'text':
                if (points.length > 0 && annotation.text) {
                    ctx.font = '16px sans-serif';
                    ctx.fillText(annotation.text, points[0].x, points[0].y);
                }
                break;
        }
    };

    // 监听标注变化重新绘制
    useEffect(() => {
        drawAnnotations();
    }, [drawAnnotations]);

    // 获取画布坐标
    const getCanvasCoords = (e: React.MouseEvent): { x: number; y: number } => {
        const canvas = canvasRef.current;
        if (!canvas) return { x: 0, y: 0 };

        const rect = canvas.getBoundingClientRect();
        return {
            x: e.clientX - rect.left,
            y: e.clientY - rect.top,
        };
    };

    // 鼠标按下
    const handleMouseDown = (e: React.MouseEvent) => {
        if (!currentTool) return;

        const coords = getCanvasCoords(e);

        if (currentTool === 'text') {
            setTextInput({ x: coords.x, y: coords.y, value: '' });
            return;
        }

        setIsDrawing(true);
        setCurrentPoints([coords]);
    };

    // 鼠标移动
    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDrawing || !currentTool) return;

        const coords = getCanvasCoords(e);

        if (currentTool === 'freehand') {
            setCurrentPoints(prev => [...prev, coords]);
        } else {
            setCurrentPoints(prev => [prev[0], coords]);
        }
    };

    // 鼠标释放
    const handleMouseUp = () => {
        if (!isDrawing || !currentTool || currentPoints.length < 2) {
            setIsDrawing(false);
            setCurrentPoints([]);
            return;
        }

        const newAnnotation: Annotation = {
            id: `ann-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: currentTool,
            points: currentPoints,
            color: annotationColor,
            strokeWidth: 3,
        };

        onAnnotationsChange([...annotations, newAnnotation]);
        setIsDrawing(false);
        setCurrentPoints([]);
    };

    // 处理文字输入
    const handleTextSubmit = () => {
        if (!textInput || !textInput.value.trim()) {
            setTextInput(null);
            return;
        }

        const newAnnotation: Annotation = {
            id: `ann-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
            type: 'text',
            points: [{ x: textInput.x, y: textInput.y }],
            color: annotationColor,
            strokeWidth: 3,
            text: textInput.value,
        };

        onAnnotationsChange([...annotations, newAnnotation]);
        setTextInput(null);
    };

    // 撤销最后一个标注
    const handleUndo = () => {
        if (annotations.length > 0) {
            onAnnotationsChange(annotations.slice(0, -1));
        }
    };

    // 清除所有标注
    const handleClear = () => {
        onAnnotationsChange([]);
    };

    // 导出带标注的图片
    const handleExport = async () => {
        const canvas = canvasRef.current;
        if (!canvas) return;

        // 创建临时画布
        const exportCanvas = document.createElement('canvas');
        exportCanvas.width = canvas.width;
        exportCanvas.height = canvas.height;
        const ctx = exportCanvas.getContext('2d');
        if (!ctx) return;

        // 绘制原图
        const img = new Image();
        img.crossOrigin = 'anonymous';
        await new Promise<void>((resolve) => {
            img.onload = () => {
                ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
                resolve();
            };
            img.src = imageUrl;
        });

        // 绘制标注
        annotations.forEach(annotation => {
            drawAnnotation(ctx, annotation);
        });

        // 下载
        const link = document.createElement('a');
        link.download = `review-${Date.now()}.png`;
        link.href = exportCanvas.toDataURL('image/png');
        link.click();
    };

    return (
        <div className="h-full flex flex-col">
            {/* 工具栏 */}
            <div className="p-3 bg-zinc-800/50 border-b border-zinc-700/50 flex items-center gap-3">
                {/* 绘图工具 */}
                <div className="flex gap-1">
                    {ANNOTATION_TOOLS.map(tool => (
                        <button
                            key={tool.type}
                            onClick={() => onToolChange(currentTool === tool.type ? null : tool.type)}
                            className={`p-2 rounded-lg transition-colors ${currentTool === tool.type
                                    ? 'bg-teal-600 text-white'
                                    : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                                }`}
                            title={tool.label}
                        >
                            <ToolIcon type={tool.type} />
                        </button>
                    ))}
                </div>

                <div className="w-px h-6 bg-zinc-600" />

                {/* 颜色选择 */}
                <div className="flex gap-1">
                    {PRESET_COLORS.map(color => (
                        <button
                            key={color}
                            onClick={() => onColorChange(color)}
                            className={`w-6 h-6 rounded-full transition-transform ${annotationColor === color ? 'ring-2 ring-white scale-110' : ''
                                }`}
                            style={{ backgroundColor: color }}
                        />
                    ))}
                </div>

                <div className="w-px h-6 bg-zinc-600" />

                {/* 操作按钮 */}
                <button
                    onClick={handleUndo}
                    disabled={annotations.length === 0}
                    className="p-2 rounded-lg bg-zinc-700 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="撤销"
                >
                    <Undo2 size={18} />
                </button>
                <button
                    onClick={handleClear}
                    disabled={annotations.length === 0}
                    className="p-2 rounded-lg bg-zinc-700 text-zinc-300 hover:bg-zinc-600 disabled:opacity-50 disabled:cursor-not-allowed"
                    title="清除所有"
                >
                    <Trash2 size={18} />
                </button>
                <button
                    onClick={handleExport}
                    className="p-2 rounded-lg bg-zinc-700 text-zinc-300 hover:bg-zinc-600"
                    title="导出图片"
                >
                    <Download size={18} />
                </button>
            </div>

            {/* 画布区域 */}
            <div
                ref={containerRef}
                className="flex-1 relative overflow-hidden flex items-center justify-center bg-zinc-900"
            >
                {/* 底层图片 */}
                <img
                    src={imageUrl}
                    alt=""
                    className="max-w-full max-h-full object-contain"
                    style={{ width: imageSize.width, height: imageSize.height }}
                />

                {/* 标注画布（覆盖在图片上） */}
                <canvas
                    ref={canvasRef}
                    className="absolute cursor-crosshair"
                    style={{
                        width: imageSize.width,
                        height: imageSize.height,
                        cursor: currentTool ? 'crosshair' : 'default'
                    }}
                    onMouseDown={handleMouseDown}
                    onMouseMove={handleMouseMove}
                    onMouseUp={handleMouseUp}
                    onMouseLeave={() => setIsDrawing(false)}
                />

                {/* 文字输入框 */}
                {textInput && (
                    <input
                        type="text"
                        autoFocus
                        value={textInput.value}
                        onChange={(e) => setTextInput({ ...textInput, value: e.target.value })}
                        onKeyDown={(e) => {
                            if (e.key === 'Enter') handleTextSubmit();
                            if (e.key === 'Escape') setTextInput(null);
                        }}
                        onBlur={handleTextSubmit}
                        className="absolute px-2 py-1 bg-zinc-800 border border-teal-500 rounded text-white text-sm outline-none"
                        style={{ left: textInput.x, top: textInput.y }}
                        placeholder="输入文字..."
                    />
                )}
            </div>
        </div>
    );
};

export default ImageCanvas;
