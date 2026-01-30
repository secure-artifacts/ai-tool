import React, { useRef, useEffect, useState, MouseEvent as ReactMouseEvent, useImperativeHandle, forwardRef, useCallback, useContext } from 'react';
import { Layer, Tool } from '../types';
import { AppContext } from '../AppContext';

type CropBox = { x: number; y: number; width: number; height: number };
type CanvasSize = { width: number; height: number };

interface CanvasProps {
    layers: Layer[];
    activeLayerId: string | null;
    canvasSize: CanvasSize | null;
    tool: Tool;
    brushColor: string;
    brushSize: number;
    onLayerUpdate: (id: string, updates: Partial<Pick<Layer, 'x' | 'y' | 'scale'>>) => void;
    cropBox: CropBox | null;
    setCropBox: (box: CropBox | null) => void;
    onSelectLayer: (id: string) => void;
}

type DragHandle = 'move' | 'scale-tl' | 'scale-tr' | 'scale-bl' | 'scale-br' | 'crop-move' | 'crop-tl' | 'crop-tr' | 'crop-bl' | 'crop-br' | 'crop-t' | 'crop-b' | 'crop-l' | 'crop-r';
type DragType = DragHandle | 'pan';
type DragState = {
    type: DragType,
    startX: number,
    startY: number,
    initialLayer?: Layer,
    initialCropBox?: CropBox,
    initialViewport?: { x: number, y: number }
};

export const Canvas = forwardRef<{
    clear: () => void;
    undo: () => void;
    getCanvas: () => HTMLCanvasElement | null;
    centerView: () => void;
}, CanvasProps>(({ layers, activeLayerId, canvasSize, tool, brushColor, brushSize, onLayerUpdate, cropBox, setCropBox, onSelectLayer }, ref) => {

    const { t } = useContext(AppContext);
    const activeLayer = layers.find(l => l.id === activeLayerId);

    const maskCanvasRef = useRef<HTMLCanvasElement>(null);
    const containerRef = useRef<HTMLDivElement>(null);
    const layerRefs = useRef<{ [key: string]: HTMLImageElement | null }>({});

    const [isDrawing, setIsDrawing] = useState(false);
    const [history, setHistory] = useState<ImageData[]>([]);
    const [historyIndex, setHistoryIndex] = useState(-1);
    const startPoint = useRef<{ x: number, y: number } | null>(null);

    const [dragState, setDragState] = useState<DragState | null>(null);
    const [viewport, setViewport] = useState({ x: 0, y: 0, scale: 1 });
    const [isPanning, setIsPanning] = useState(false);

    const getMaskCanvasContext = useCallback(() => maskCanvasRef.current?.getContext('2d', { willReadFrequently: true }), []);

    const centerView = useCallback(() => {
        if (!canvasSize || !containerRef.current) return;
        const container = containerRef.current;
        const availableWidth = container.clientWidth;
        const availableHeight = container.clientHeight;
        const scale = Math.min(availableWidth / canvasSize.width, availableHeight / canvasSize.height, 1) * 0.9;
        const x = (availableWidth - (canvasSize.width * scale)) / 2;
        const y = (availableHeight - (canvasSize.height * scale)) / 2;
        setViewport({ x, y, scale });
    }, [canvasSize]);

    useImperativeHandle(ref, () => ({
        clear: () => {
            const ctx = getMaskCanvasContext();
            const canvas = maskCanvasRef.current;
            if (ctx && canvas) {
                ctx.clearRect(0, 0, canvas.width, canvas.height);
                saveHistory();
            }
        },
        undo: () => {
            if (historyIndex > 0) {
                const newIndex = historyIndex - 1;
                setHistoryIndex(newIndex);
                const ctx = getMaskCanvasContext();
                if (ctx && history[newIndex]) {
                    ctx.putImageData(history[newIndex], 0, 0);
                }
            }
        },
        getCanvas: () => maskCanvasRef.current,
        centerView,
    }));

    const saveHistory = useCallback(() => {
        const ctx = getMaskCanvasContext();
        if (ctx && maskCanvasRef.current) {
            const newHistory = history.slice(0, historyIndex + 1);
            newHistory.push(ctx.getImageData(0, 0, maskCanvasRef.current.width, maskCanvasRef.current.height));
            setHistory(newHistory);
            setHistoryIndex(newHistory.length - 1);
        }
    }, [getMaskCanvasContext, history, historyIndex]);

    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.code === 'Space' && !e.repeat) {
                e.preventDefault();
                setIsPanning(true);
            }
            if (e.key === 'Escape' && tool === 'crop') {
                setCropBox(null);
                // A bit of a hack, but App.tsx will see this and switch tool to move.
                // Or better, handle it in Header.
            }
        };
        const handleKeyUp = (e: KeyboardEvent) => {
            if (e.code === 'Space') {
                e.preventDefault();
                setIsPanning(false);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        window.addEventListener('keyup', handleKeyUp);
        return () => {
            window.removeEventListener('keydown', handleKeyDown);
            window.removeEventListener('keyup', handleKeyUp);
        };
    }, [tool, setCropBox]);

    useEffect(() => {
        if (maskCanvasRef.current && activeLayer) {
            const activeImage = layerRefs.current[activeLayer.id];
            if (activeImage && activeImage.naturalWidth > 0) {
                const { naturalWidth, naturalHeight } = activeImage;
                if (maskCanvasRef.current.width !== naturalWidth || maskCanvasRef.current.height !== naturalHeight) {
                    maskCanvasRef.current.width = naturalWidth;
                    maskCanvasRef.current.height = naturalHeight;
                    const ctx = getMaskCanvasContext();
                    if (ctx) {
                        const initialImageData = ctx.createImageData(naturalWidth, naturalHeight);
                        setHistory([initialImageData]);
                        setHistoryIndex(0);
                    }
                }
            }
        }
    }, [activeLayer, layers, getMaskCanvasContext]);

    useEffect(() => {
        if (tool !== 'crop' && cropBox) {
            setCropBox(null);
        }
    }, [tool, cropBox, setCropBox]);

    const getMousePosInCanvasSpace = (e: ReactMouseEvent) => {
        const container = containerRef.current;
        if (!container) return { x: 0, y: 0 };
        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;
        const canvasX = (mouseX - viewport.x) / viewport.scale;
        const canvasY = (mouseY - viewport.y) / viewport.scale;
        return { x: canvasX, y: canvasY };
    };

    const getMousePosOnLayer = (e: ReactMouseEvent) => {
        const { x: canvasX, y: canvasY } = getMousePosInCanvasSpace(e);
        if (!activeLayer) return { x: 0, y: 0 };
        const layerX = (canvasX - activeLayer.x) / activeLayer.scale;
        const layerY = (canvasY - activeLayer.y) / activeLayer.scale;
        return { x: layerX, y: layerY };
    };

    const handleMouseDown = (e: ReactMouseEvent) => {
        if (isPanning) {
            setDragState({ type: 'pan', startX: e.clientX, startY: e.clientY, initialViewport: { x: viewport.x, y: viewport.y } });
            return;
        }

        const target = e.target as HTMLElement;

        // Check if we clicked on a layer to select it
        const layerElement = target.closest('[data-layer-id]');
        if (layerElement) {
            const layerId = layerElement.getAttribute('data-layer-id');
            if (layerId && layerId !== activeLayerId) {
                onSelectLayer(layerId);
            }
        }

        const type = target.dataset.dragType as DragHandle;

        if (!activeLayer) return;

        if (tool === 'brush' || tool === 'rectangle') {
            const ctx = getMaskCanvasContext();
            if (!ctx) return;
            const pos = getMousePosOnLayer(e);
            setIsDrawing(true);
            startPoint.current = pos;
            ctx.beginPath();
            ctx.moveTo(pos.x, pos.y);
            ctx.strokeStyle = brushColor;
            ctx.fillStyle = brushColor;
            ctx.lineWidth = brushSize / activeLayer.scale / viewport.scale;
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        } else if ((tool === 'move' || tool === 'crop') && type) {
            const pos = getMousePosInCanvasSpace(e);
            setDragState({ type, startX: pos.x, startY: pos.y, initialLayer: activeLayer, initialCropBox: cropBox || undefined });
        }
    };

    const handleMouseMove = (e: ReactMouseEvent) => {
        if (isDrawing && (tool === 'brush' || tool === 'rectangle')) {
            const ctx = getMaskCanvasContext();
            if (!ctx) return;
            const pos = getMousePosOnLayer(e);

            if (tool === 'brush') {
                ctx.lineTo(pos.x, pos.y);
                ctx.stroke();
            } else if (tool === 'rectangle' && startPoint.current) {
                if (historyIndex >= 0 && history[historyIndex]) {
                    ctx.putImageData(history[historyIndex], 0, 0);
                }
                ctx.fillRect(startPoint.current.x, startPoint.current.y, pos.x - startPoint.current.x, pos.y - startPoint.current.y);
            }
        } else if (dragState && activeLayer && containerRef.current) {

            if (dragState.type === 'pan' && dragState.initialViewport) {
                const dx = e.clientX - dragState.startX;
                const dy = e.clientY - dragState.startY;
                setViewport(v => ({ ...v, x: dragState.initialViewport!.x + dx, y: dragState.initialViewport!.y + dy }));
                return;
            }

            const currentPos = getMousePosInCanvasSpace(e);
            const dx = currentPos.x - dragState.startX;
            const dy = currentPos.y - dragState.startY;
            const { type, initialLayer, initialCropBox } = dragState;
            const activeImage = layerRefs.current[activeLayer.id];
            if (!activeImage) return;

            if (type === 'move' && initialLayer) {
                onLayerUpdate(activeLayer.id, { x: initialLayer.x + dx, y: initialLayer.y + dy });
            } else if (type.startsWith('scale-') && initialLayer) {
                const { naturalWidth, naturalHeight } = activeImage;
                if (naturalWidth === 0 || naturalHeight === 0) return;

                const initialWidth = naturalWidth * initialLayer.scale;
                const initialHeight = naturalHeight * initialLayer.scale;
                const initialCenterX = initialLayer.x + initialWidth / 2;
                const initialCenterY = initialLayer.y + initialHeight / 2;

                const mouseX = currentPos.x;
                const mouseY = currentPos.y;

                // Calculate distance from center to mouse, this determines the new size
                const distX = Math.abs(mouseX - initialCenterX);
                const distY = Math.abs(mouseY - initialCenterY);

                const newHalfWidth = distX;
                const newHalfHeight = distY;

                let newWidth;
                const aspectRatio = naturalWidth / naturalHeight;

                // Use the larger dimension's change to determine scale to keep it feeling responsive to the handle being dragged
                if (newHalfWidth / aspectRatio > newHalfHeight) {
                    newWidth = newHalfWidth * 2;
                } else {
                    newWidth = newHalfHeight * 2 * aspectRatio;
                }

                if (newWidth < 20) return; // Prevent scaling down too small

                const newScale = newWidth / naturalWidth;
                const newHeight = newWidth / aspectRatio;

                const newX = initialCenterX - newWidth / 2;
                const newY = initialCenterY - newHeight / 2;

                onLayerUpdate(activeLayer.id, { x: newX, y: newY, scale: newScale });

            } else if (type && type.startsWith('crop-')) {
                let newCropBox = { ...initialCropBox } as CropBox;

                if (!initialCropBox) {
                    newCropBox = { x: dragState.startX, y: dragState.startY, width: 0, height: 0 };
                }

                if (type === 'crop-move') {
                    newCropBox.x = initialCropBox!.x + dx;
                    newCropBox.y = initialCropBox!.y + dy;
                } else if (type === 'crop-br') {
                    newCropBox.width = Math.max(10, initialCropBox!.width + dx);
                    newCropBox.height = Math.max(10, initialCropBox!.height + dy);
                } else if (type === 'crop-bl') {
                    const width = Math.max(10, initialCropBox!.width - dx);
                    newCropBox.x = initialCropBox!.x + initialCropBox!.width - width;
                    newCropBox.width = width;
                    newCropBox.height = Math.max(10, initialCropBox!.height + dy);
                } else if (type === 'crop-tr') {
                    const height = Math.max(10, initialCropBox!.height - dy);
                    newCropBox.y = initialCropBox!.y + initialCropBox!.height - height;
                    newCropBox.height = height;
                    newCropBox.width = Math.max(10, initialCropBox!.width + dx);
                } else if (type === 'crop-tl') {
                    const width = Math.max(10, initialCropBox!.width - dx);
                    newCropBox.x = initialCropBox!.x + initialCropBox!.width - width;
                    newCropBox.width = width;
                    const height = Math.max(10, initialCropBox!.height - dy);
                    newCropBox.y = initialCropBox!.y + initialCropBox!.height - height;
                    newCropBox.height = height;
                } else if (type === 'crop-r') {
                    newCropBox.width = Math.max(10, initialCropBox!.width + dx);
                } else if (type === 'crop-l') {
                    const width = Math.max(10, initialCropBox!.width - dx);
                    newCropBox.x = initialCropBox!.x + initialCropBox!.width - width;
                    newCropBox.width = width;
                } else if (type === 'crop-t') {
                    const height = Math.max(10, initialCropBox!.height - dy);
                    newCropBox.y = initialCropBox!.y + initialCropBox!.height - height;
                    newCropBox.height = height;
                } else if (type === 'crop-b') {
                    newCropBox.height = Math.max(10, initialCropBox!.height + dy);
                }

                setCropBox(newCropBox);
            }
        }
    };

    const handleMouseUp = () => {
        if (isDrawing && (tool === 'brush' || tool === 'rectangle')) {
            const ctx = getMaskCanvasContext();
            if (!ctx) return;
            ctx.closePath();
            setIsDrawing(false);
            saveHistory();
        }
        if (dragState) {
            setDragState(null);
        }
    };

    const handleWheel = (e: React.WheelEvent) => {
        e.preventDefault();
        const { deltaY } = e;
        const zoomFactor = 1.1;
        const newScale = deltaY < 0 ? viewport.scale * zoomFactor : viewport.scale / zoomFactor;
        const scale = Math.max(0.1, Math.min(newScale, 10));

        const rect = containerRef.current!.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const newX = mouseX - (mouseX - viewport.x) * (scale / viewport.scale);
        const newY = mouseY - (mouseY - viewport.y) * (scale / viewport.scale);

        setViewport({ x: newX, y: newY, scale });
    };

    useEffect(() => {
        if (tool === 'crop' && canvasSize && !cropBox) {
            setCropBox({ x: 0, y: 0, width: canvasSize.width, height: canvasSize.height });
        }
    }, [tool, canvasSize, cropBox, setCropBox]);


    if (!canvasSize) {
        return (
            <div className="w-full h-full flex items-center justify-center text-center text-[var(--color-text-secondary)] p-4">
                <div>
                    <svg xmlns="http://www.w3.org/2000/svg" className="mx-auto h-16 w-16" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={1}><path strokeLinecap="round" strokeLinejoin="round" d="M4 16l4.586-4.586a2 2 0 012.828 0L16 16m-2-2l1.586-1.586a2 2 0 012.828 0L20 14m-6-6h.01M6 20h12a2 2 0 002-2V6a2 2 0 00-2-2H6a2 2 0 00-2 2v12a2 2 0 002 2z" /></svg>
                    <p className="mt-4 font-semibold">{t('canvas.no_image_placeholder_title')}</p>
                    <p className="mt-1 text-sm">{t('canvas.no_image_placeholder_desc')}</p>
                </div>
            </div>
        );
    }

    const viewportTransformStyle = {
        transform: `translate(${viewport.x}px, ${viewport.y}px) scale(${viewport.scale})`,
        transformOrigin: 'top left',
        cursor: isPanning ? (dragState?.type === 'pan' ? 'grabbing' : 'grab') : 'default'
    }

    const cropHandleSize = 12;
    const cropHandleOffset = -cropHandleSize / 2;

    return (
        <div
            ref={containerRef}
            className="w-full h-full overflow-hidden relative"
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onWheel={handleWheel}
        >
            <div
                className="absolute top-0 left-0 w-full h-full"
                style={viewportTransformStyle}
            >
                <div
                    className="absolute top-0 left-0 bg-grid shadow-xl"
                    style={{ width: canvasSize.width, height: canvasSize.height }}
                >
                    {layers.map(layer => {
                        const isLayerActive = layer.id === activeLayerId;
                        const activeImage = layerRefs.current[layer.id];

                        return (
                            <div
                                key={layer.id}
                                data-layer-id={layer.id}
                                className={`absolute top-0 left-0 ${isLayerActive && tool === 'move' ? 'outline outline-2 outline-blue-500 outline-offset-2' : ''}`}
                                style={{
                                    transform: `translate(${layer.x}px, ${layer.y}px) scale(${layer.scale})`,
                                    transformOrigin: 'top left',
                                    width: activeImage?.naturalWidth,
                                    height: activeImage?.naturalHeight,
                                    display: layer.isVisible ? 'block' : 'none',
                                    opacity: layer.opacity,
                                }}
                            >
                                <img
                                    ref={el => layerRefs.current[layer.id] = el}
                                    src={layer.imageUrl}
                                    alt={layer.name}
                                    className="block select-none w-full h-full"
                                    onDragStart={(e) => e.preventDefault()}
                                />
                                {isLayerActive && (
                                    <canvas
                                        ref={maskCanvasRef}
                                        className="absolute top-0 left-0 opacity-50 pointer-events-none"
                                    />
                                )}
                                {isLayerActive && tool === 'move' && (
                                    <>
                                        <div data-drag-type="move" className="absolute inset-0 cursor-move"></div>
                                        <div data-drag-type="scale-tl" className="absolute w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-nwse-resize crop-handle-tl"></div>
                                        <div data-drag-type="scale-tr" className="absolute w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-nesw-resize crop-handle-tr"></div>
                                        <div data-drag-type="scale-bl" className="absolute w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-nesw-resize crop-handle-bl"></div>
                                        <div data-drag-type="scale-br" className="absolute w-4 h-4 bg-white border-2 border-blue-500 rounded-full cursor-nwse-resize crop-handle-br"></div>
                                    </>
                                )}
                            </div>
                        )
                    })}
                </div>

                {tool === 'crop' && cropBox && (
                    <>
                        <div className="absolute inset-[-10000px] bg-black/50 pointer-events-none" style={{
                            clipPath: `path('M-10000 -10000 H 20000 V 20000 H -10000 V -10000 M${cropBox.x} ${cropBox.y} V ${cropBox.y + cropBox.height} H ${cropBox.x + cropBox.width} V ${cropBox.y} H ${cropBox.x} Z')`
                        }}></div>
                        <div
                            className="absolute"
                            style={{ left: cropBox.x, top: cropBox.y, width: cropBox.width, height: cropBox.height }}
                        >
                            <div className="w-full h-full border-2 border-dashed border-white pointer-events-none relative">
                                <div className="absolute top-1/3 left-0 w-full h-px bg-white/50"></div>
                                <div className="absolute top-2/3 left-0 w-full h-px bg-white/50"></div>
                                <div className="absolute left-1/3 top-0 h-full w-px bg-white/50"></div>
                                <div className="absolute left-2/3 top-0 h-full w-px bg-white/50"></div>
                            </div>
                            <div data-drag-type="crop-move" className="absolute inset-2 cursor-move"></div>
                            {/* Corner Handles */}
                            <div data-drag-type="crop-tl" className="absolute bg-white rounded-sm cursor-nwse-resize" style={{ width: cropHandleSize, height: cropHandleSize, top: cropHandleOffset, left: cropHandleOffset }}></div>
                            <div data-drag-type="crop-tr" className="absolute bg-white rounded-sm cursor-nesw-resize" style={{ width: cropHandleSize, height: cropHandleSize, top: cropHandleOffset, right: cropHandleOffset }}></div>
                            <div data-drag-type="crop-bl" className="absolute bg-white rounded-sm cursor-nesw-resize" style={{ width: cropHandleSize, height: cropHandleSize, bottom: cropHandleOffset, left: cropHandleOffset }}></div>
                            <div data-drag-type="crop-br" className="absolute bg-white rounded-sm cursor-nwse-resize" style={{ width: cropHandleSize, height: cropHandleSize, bottom: cropHandleOffset, right: cropHandleOffset }}></div>
                            {/* Edge Handles */}
                            <div data-drag-type="crop-t" className="absolute bg-white rounded-sm cursor-ns-resize" style={{ width: cropHandleSize, height: cropHandleSize, top: cropHandleOffset, left: `calc(50% - ${cropHandleSize / 2}px)` }}></div>
                            <div data-drag-type="crop-b" className="absolute bg-white rounded-sm cursor-ns-resize" style={{ width: cropHandleSize, height: cropHandleSize, bottom: cropHandleOffset, left: `calc(50% - ${cropHandleSize / 2}px)` }}></div>
                            <div data-drag-type="crop-l" className="absolute bg-white rounded-sm cursor-ew-resize" style={{ width: cropHandleSize, height: cropHandleSize, left: cropHandleOffset, top: `calc(50% - ${cropHandleSize / 2}px)` }}></div>
                            <div data-drag-type="crop-r" className="absolute bg-white rounded-sm cursor-ew-resize" style={{ width: cropHandleSize, height: cropHandleSize, right: cropHandleOffset, top: `calc(50% - ${cropHandleSize / 2}px)` }}></div>
                        </div>
                    </>
                )}
            </div>
        </div>
    );
});
