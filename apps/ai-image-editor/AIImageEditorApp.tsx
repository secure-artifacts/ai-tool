import React, { useState, useCallback, useEffect, useRef, useContext } from 'react';
import { AppContext } from './AppContext';
import { Layer, Tool } from './types';
import { LayerPanel } from './components/Sidebar';
import { Canvas } from './components/WorkflowCanvas';
import { PromptBar } from './components/ControlPanel';
import { RightPanel } from './components/RightPanel';
import { geminiService } from './services/geminiService';
// FIX: Import TranslationKey and translations to fix undefined variable errors.
import { TranslationKey, translations } from './i18n';

type CropBox = { x: number; y: number; width: number; height: number };
type CanvasSize = { width: number; height: number };
export type PromptMode = 'generate' | 'edit';
export type ChatMessage = { role: 'user' | 'model'; text: string };

const getStoredPresetUser = () => {
  if (typeof window === 'undefined') return '';
  try {
    return localStorage.getItem('app_preset_user') || '';
  } catch {
    return '';
  }
};

type MagicCanvasState = {
  layers: Layer[];
  activeLayerId: string | null;
  prompt: string;
  tool: Tool;
  brushColor: string;
  brushSize: number;
  cropBox: { x: number; y: number; width: number; height: number } | null;
  canvasSize: { width: number; height: number } | null;
  isLayerPanelOpen: boolean;
  isRightPanelCollapsed: boolean;
  promptMode: PromptMode;
  isPromptExpanded: boolean;
  chatHistory: ChatMessage[];
  chatInput: string;
};

type MagicCanvasAppProps = {
  presetUser?: string;
  registerSaveHandler?: (handler: (() => void) | null) => void;
  onSaveStatusChange?: (status: { type: 'success' | 'error'; message: string } | null) => void;
  textModel?: string;
  imageModel?: string;
  imageResolution?: string;
  initialImage?: File | null;
  state?: MagicCanvasState;
  setState?: React.Dispatch<React.SetStateAction<MagicCanvasState>>;
};

function AppContent({ presetUser, registerSaveHandler, onSaveStatusChange, textModel = 'gemini-3-flash-preview', imageModel = 'gemini-2.5-flash-image', imageResolution = '1K', initialImage, state, setState }: MagicCanvasAppProps) {
  const { t, theme } = useContext(AppContext);

  // Local state for transient UI states
  const [isGenerating, setIsGenerating] = useState(false);
  const [isSynthesizing, setIsSynthesizing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isExtractingStyle, setIsExtractingStyle] = useState(false);
  const [isReplying, setIsReplying] = useState(false);

  // Use lifted state if available, otherwise local state (fallback)
  const [localLayers, setLocalLayers] = useState<Layer[]>([]);
  const [localActiveLayerId, setLocalActiveLayerId] = useState<string | null>(null);
  const [localPrompt, setLocalPrompt] = useState('');
  const [localTool, setLocalTool] = useState<Tool>('move');
  const [localBrushColor, setLocalBrushColor] = useState('#EF4444');
  const [localBrushSize, setLocalBrushSize] = useState(20);
  const [localCropBox, setLocalCropBox] = useState<CropBox | null>(null);
  const [localCanvasSize, setLocalCanvasSize] = useState<CanvasSize | null>(null);
  const [localIsLayerPanelOpen, setLocalIsLayerPanelOpen] = useState(true);
  const [localIsRightPanelCollapsed, setLocalIsRightPanelCollapsed] = useState(false);
  const [localPromptMode, setLocalPromptMode] = useState<PromptMode>('generate');
  const [localIsPromptExpanded, setLocalIsPromptExpanded] = useState(false);
  const [localChatHistory, setLocalChatHistory] = useState<ChatMessage[]>([]);
  const [localChatInput, setLocalChatInput] = useState('');

  const layers = state?.layers ?? localLayers;
  const activeLayerId = state?.activeLayerId ?? localActiveLayerId;
  const prompt = state?.prompt ?? localPrompt;
  const tool = state?.tool ?? localTool;
  const brushColor = state?.brushColor ?? localBrushColor;
  const brushSize = state?.brushSize ?? localBrushSize;
  const cropBox = state?.cropBox ?? localCropBox;
  const canvasSize = state?.canvasSize ?? localCanvasSize;
  const isLayerPanelOpen = state?.isLayerPanelOpen ?? localIsLayerPanelOpen;
  const isRightPanelCollapsed = state?.isRightPanelCollapsed ?? localIsRightPanelCollapsed;
  const promptMode = state?.promptMode ?? localPromptMode;
  const isPromptExpanded = state?.isPromptExpanded ?? localIsPromptExpanded;
  const chatHistory = state?.chatHistory ?? localChatHistory;
  const chatInput = state?.chatInput ?? localChatInput;

  const setLayers = useCallback((val: Layer[] | ((prev: Layer[]) => Layer[])) => {
    if (setState) {
      setState(prev => ({ ...prev, layers: typeof val === 'function' ? val(prev.layers) : val }));
    } else {
      setLocalLayers(val);
    }
  }, [setState]);

  const setActiveLayerId = useCallback((val: string | null | ((prev: string | null) => string | null)) => {
    if (setState) {
      setState(prev => ({ ...prev, activeLayerId: typeof val === 'function' ? val(prev.activeLayerId) : val }));
    } else {
      setLocalActiveLayerId(val);
    }
  }, [setState]);

  const setPrompt = useCallback((val: string | ((prev: string) => string)) => {
    if (setState) {
      setState(prev => ({ ...prev, prompt: typeof val === 'function' ? val(prev.prompt) : val }));
    } else {
      setLocalPrompt(val);
    }
  }, [setState]);

  const setTool = useCallback((val: Tool | ((prev: Tool) => Tool)) => {
    if (setState) {
      setState(prev => ({ ...prev, tool: typeof val === 'function' ? val(prev.tool) : val }));
    } else {
      setLocalTool(val);
    }
  }, [setState]);

  const setBrushColor = useCallback((val: string | ((prev: string) => string)) => {
    if (setState) {
      setState(prev => ({ ...prev, brushColor: typeof val === 'function' ? val(prev.brushColor) : val }));
    } else {
      setLocalBrushColor(val);
    }
  }, [setState]);

  const setBrushSize = useCallback((val: number | ((prev: number) => number)) => {
    if (setState) {
      setState(prev => ({ ...prev, brushSize: typeof val === 'function' ? val(prev.brushSize) : val }));
    } else {
      setLocalBrushSize(val);
    }
  }, [setState]);

  const setCropBox = useCallback((val: CropBox | null | ((prev: CropBox | null) => CropBox | null)) => {
    if (setState) {
      setState(prev => ({ ...prev, cropBox: typeof val === 'function' ? val(prev.cropBox) : val }));
    } else {
      setLocalCropBox(val);
    }
  }, [setState]);

  const setCanvasSize = useCallback((val: CanvasSize | null | ((prev: CanvasSize | null) => CanvasSize | null)) => {
    if (setState) {
      setState(prev => ({ ...prev, canvasSize: typeof val === 'function' ? val(prev.canvasSize) : val }));
    } else {
      setLocalCanvasSize(val);
    }
  }, [setState]);

  const setIsLayerPanelOpen = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    if (setState) {
      setState(prev => ({ ...prev, isLayerPanelOpen: typeof val === 'function' ? val(prev.isLayerPanelOpen) : val }));
    } else {
      setLocalIsLayerPanelOpen(val);
    }
  }, [setState]);

  const setIsRightPanelCollapsed = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    if (setState) {
      setState(prev => ({ ...prev, isRightPanelCollapsed: typeof val === 'function' ? val(prev.isRightPanelCollapsed) : val }));
    } else {
      setLocalIsRightPanelCollapsed(val);
    }
  }, [setState]);

  const setPromptMode = useCallback((val: PromptMode | ((prev: PromptMode) => PromptMode)) => {
    if (setState) {
      setState(prev => ({ ...prev, promptMode: typeof val === 'function' ? val(prev.promptMode) : val }));
    } else {
      setLocalPromptMode(val);
    }
  }, [setState]);

  const setIsPromptExpanded = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
    if (setState) {
      setState(prev => ({ ...prev, isPromptExpanded: typeof val === 'function' ? val(prev.isPromptExpanded) : val }));
    } else {
      setLocalIsPromptExpanded(val);
    }
  }, [setState]);

  const setChatHistory = useCallback((val: ChatMessage[] | ((prev: ChatMessage[]) => ChatMessage[])) => {
    if (setState) {
      setState(prev => ({ ...prev, chatHistory: typeof val === 'function' ? val(prev.chatHistory) : val }));
    } else {
      setLocalChatHistory(val);
    }
  }, [setState]);

  const setChatInput = useCallback((val: string | ((prev: string) => string)) => {
    if (setState) {
      setState(prev => ({ ...prev, chatInput: typeof val === 'function' ? val(prev.chatInput) : val }));
    } else {
      setLocalChatInput(val);
    }
  }, [setState]);
  const fallbackPresetUserRef = useRef<string>(getStoredPresetUser());
  const resolvedPresetUser = presetUser ?? fallbackPresetUserRef.current;


  const canvasRef = useRef<{
    clear: () => void;
    undo: () => void;
    getCanvas: () => HTMLCanvasElement | null;
    centerView: () => void;
  }>(null);

  const activeLayer = layers.find(l => l.id === activeLayerId);
  const sourceLayer = activeLayer?.sourceLayerId ? layers.find(l => l.id === activeLayer.sourceLayerId) : undefined;

  const handlePromptModeChange = (mode: PromptMode) => {
    // Switching TO edit mode, preserve prompt in chat history if needed
    if (mode === 'edit' && prompt && chatHistory.length === 0) {
      setChatHistory([{ role: 'model', text: prompt }]);
    }
    // Switching FROM edit mode, set prompt to the last message
    if (mode === 'generate' && promptMode === 'edit' && chatHistory.length > 0) {
      const lastMessage = chatHistory[chatHistory.length - 1];
      if (lastMessage) {
        setPrompt(lastMessage.text);
      }
    }
    setPromptMode(mode);
  };

  const handleClearChatHistory = useCallback(() => {
    setChatHistory([]);
    setChatInput('');
    // Optionally reset the main prompt as well if the chat was cleared
    if (chatHistory.length > 0) {
      const lastModelMessage = [...chatHistory].reverse().find(m => m.role === 'model');
      setPrompt(lastModelMessage?.text || '');
    }
  }, [chatHistory]);

  const addLayer = useCallback((file: File, position?: { x: number; y: number; scale: number; }) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      const imageUrl = e.target?.result as string;
      const img = new Image();
      img.onload = () => {
        const newLayer: Layer = {
          id: `layer-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
          name: file.name,
          imageUrl,
          file,
          opacity: 1,
          isVisible: true,
          x: position?.x ?? (Math.random() * 40),
          y: position?.y ?? (Math.random() * 40),
          scale: position?.scale ?? 1,
        };
        setLayers(prev => [...prev, newLayer]);
        setActiveLayerId(newLayer.id);

        if (!canvasSize) {
          setCanvasSize({ width: img.naturalWidth, height: img.naturalHeight });
          // Use a timeout to ensure canvas component has updated with the new size
          setTimeout(() => canvasRef.current?.centerView(), 0);
        }
      };
      img.src = imageUrl;
    };
    reader.readAsDataURL(file);
  }, [canvasSize, setLayers, setActiveLayerId, setCanvasSize]);

  const handleLayerUpdate = useCallback((id: string, updates: Partial<Pick<Layer, 'x' | 'y' | 'scale'>>) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, ...updates } : l));
  }, []);

  const handleDeleteLayer = useCallback((id: string) => {
    setLayers(prev => {
      const newLayers = prev.filter(l => l.id !== id);
      if (activeLayerId === id) {
        const deletedIndex = prev.findIndex(l => l.id === id);
        const nextActiveIndex = Math.max(0, deletedIndex - 1);
        setActiveLayerId(newLayers[nextActiveIndex]?.id || null);
      }
      if (newLayers.length === 0) {
        setCanvasSize(null); // Reset canvas if all layers are deleted
      }
      return newLayers;
    });
  }, [activeLayerId]);

  const handleToggleVisibility = useCallback((id: string) => {
    setLayers(prev => prev.map(l => l.id === id ? { ...l, isVisible: !l.isVisible } : l));
  }, []);

  const handleReorderLayers = useCallback((draggedId: string, dropTargetId: string) => {
    setLayers(prev => {
      const items = [...prev];
      const draggedIndex = items.findIndex(l => l.id === draggedId);
      const dropTargetIndex = items.findIndex(l => l.id === dropTargetId);

      if (draggedIndex === -1 || dropTargetIndex === -1 || draggedIndex === dropTargetIndex) {
        return prev;
      }

      const [reorderedItem] = items.splice(draggedIndex, 1);
      // To place visually ABOVE with flex-col-reverse, we need to place it AFTER in the array.
      // But for intuitive replacement, we place it at the target's index.
      const newDropTargetIndex = items.findIndex(l => l.id === dropTargetId);
      items.splice(newDropTargetIndex, 0, reorderedItem);

      return items;
    });
  }, []);


  useEffect(() => {
    const handleDrop = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer && e.dataTransfer.files.length > 0) {
        Array.from(e.dataTransfer.files).forEach(file => {
          if (file && file.type.startsWith('image/')) {
            addLayer(file);
          }
        });
      }
    };
    const handleDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const handlePaste = (e: ClipboardEvent) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (let i = 0; i < items.length; i++) {
        if (items[i].type.indexOf('image') !== -1) {
          const file = items[i].getAsFile();
          if (file) {
            addLayer(file);
          }
          break;
        }
      }
    };

    window.addEventListener('drop', handleDrop);
    window.addEventListener('dragover', handleDragOver);
    window.addEventListener('paste', handlePaste);

    return () => {
      window.removeEventListener('drop', handleDrop);
      window.removeEventListener('dragover', handleDragOver);
      window.removeEventListener('paste', handlePaste);
    };
  }, [addLayer]);

  // Handle initial image from props (e.g. from One-Click Retouch)
  const lastProcessedImageRef = useRef<File | null>(null);
  useEffect(() => {
    if (initialImage && initialImage !== lastProcessedImageRef.current) {
      addLayer(initialImage);
      lastProcessedImageRef.current = initialImage;
    }
  }, [initialImage, addLayer]);

  const handleApplyCrop = useCallback(() => {
    if (!activeLayer || !cropBox || !canvasSize) return;

    const sourceImage = new Image();
    sourceImage.onload = () => {
      const tempCanvas = document.createElement('canvas');
      tempCanvas.width = cropBox.width;
      tempCanvas.height = cropBox.height;
      const ctx = tempCanvas.getContext('2d');
      if (!ctx) return;

      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(0, 0, tempCanvas.width, tempCanvas.height);

      // The cropBox is in canvas coordinates. The layer is also in canvas coordinates.
      // We need to find the part of the source image that corresponds to the crop box area.
      const sourceCropX = (cropBox.x - activeLayer.x) / activeLayer.scale;
      const sourceCropY = (cropBox.y - activeLayer.y) / activeLayer.scale;
      const sourceCropWidth = cropBox.width / activeLayer.scale;
      const sourceCropHeight = cropBox.height / activeLayer.scale;

      // Where to draw the cropped image on the new canvas
      const destX = activeLayer.x - cropBox.x;
      const destY = activeLayer.y - cropBox.y;
      const destWidth = sourceImage.naturalWidth * activeLayer.scale;
      const destHeight = sourceImage.naturalHeight * activeLayer.scale;

      ctx.drawImage(
        sourceImage,
        0, 0, sourceImage.naturalWidth, sourceImage.naturalHeight,
        destX, destY, destWidth, destHeight
      );

      tempCanvas.toBlob(blob => {
        if (blob) {
          const newFile = new File([blob], `expanded-${activeLayer.file.name}`, { type: 'image/png' });
          const newCanvasSize = { width: cropBox.width, height: cropBox.height };
          const offsetX = -cropBox.x;
          const offsetY = -cropBox.y;

          setLayers(prev => prev.map(l => ({ ...l, x: l.x + offsetX, y: l.y + offsetY })));

          addLayer(newFile, { x: 0, y: 0, scale: 1 });
          setCanvasSize(newCanvasSize);
          setTimeout(() => canvasRef.current?.centerView(), 0);
        }
      }, 'image/png');

      setTool('move');
      setCropBox(null);
    };
    sourceImage.src = activeLayer.imageUrl;
  }, [activeLayer, cropBox, addLayer, canvasSize]);

  const handleGenerate = useCallback(async (basePrompt: string, magicPrompt: string = '') => {
    if (!activeLayer) {
      alert(t('alert.no_active_layer'));
      return;
    }

    setIsGenerating(true);
    setError(null);

    try {
      const maskCanvas = canvasRef.current?.getCanvas();
      const finalPrompt = [magicPrompt, basePrompt].filter(Boolean).join('\n');

      const resultDataUrl = await geminiService.generateImage(
        activeLayer.file,
        maskCanvas,
        finalPrompt,
        imageModel,
        imageResolution
      );

      const res = await fetch(resultDataUrl);
      const blob = await res.blob();
      const newFile = new File([blob], `generated-${Date.now()}.png`, { type: blob.type });

      const newLayer: Layer = {
        id: `layer-${Date.now()}`,
        name: `${activeLayer.name} (${t('layers.generated')})`,
        imageUrl: resultDataUrl,
        file: newFile,
        opacity: 1,
        isVisible: true,
        sourceLayerId: activeLayer.id,
        x: activeLayer.x,
        y: activeLayer.y,
        scale: activeLayer.scale,
      };

      setLayers(prevLayers => {
        const sourceIndex = prevLayers.findIndex(l => l.id === activeLayerId);
        const newLayers = [...prevLayers];
        newLayers.splice(sourceIndex + 1, 0, newLayer);
        return newLayers;
      });
      setActiveLayerId(newLayer.id);
      canvasRef.current?.clear();

    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : t('alert.unknown_error');
      setError(errorMessage);
      console.error(e);
    } finally {
      setIsGenerating(false);
    }
  }, [activeLayer, layers, activeLayerId, t]);

  const handleSynthesizeScene = useCallback(async (basePrompt: string) => {
    const visibleLayers = layers.filter(l => l.isVisible);
    if (visibleLayers.length < 2 || !canvasSize) {
      alert(t('alert.synthesize_requires_layers'));
      return;
    }

    setIsSynthesizing(true);
    setError(null);

    try {
      const resultDataUrl = await geminiService.mergeLayers(
        visibleLayers,
        canvasSize,
        basePrompt,
        imageModel,
        imageResolution
      );

      const res = await fetch(resultDataUrl);
      const blob = await res.blob();
      const newFile = new File([blob], `synthesized-${Date.now()}.png`, { type: blob.type });

      const newLayer: Layer = {
        id: `layer-${Date.now()}`,
        name: t('layers.synthesized'),
        imageUrl: resultDataUrl,
        file: newFile,
        opacity: 1,
        isVisible: true,
        x: 0,
        y: 0,
        scale: 1,
      };

      setLayers(prevLayers => {
        // Hide the layers that were used for synthesis and add the new one
        const originalLayerIds = new Set(visibleLayers.map(l => l.id));
        const updatedOldLayers = prevLayers.map(l =>
          originalLayerIds.has(l.id) ? { ...l, isVisible: false } : l
        );
        return [...updatedOldLayers, newLayer];
      });

      setActiveLayerId(newLayer.id);

    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : t('alert.unknown_error');
      setError(errorMessage);
      console.error(e);
    } finally {
      setIsSynthesizing(false);
    }
  }, [layers, canvasSize, t]);

  const handleExtractStyle = useCallback(async () => {
    if (!activeLayer) {
      alert(t('alert.no_active_layer'));
      return;
    }

    setIsExtractingStyle(true);
    setError(null);

    try {
      const styleDescription = await geminiService.extractStyle(activeLayer.file, textModel);
      setPrompt(styleDescription);
      setChatHistory([{ role: 'model', text: styleDescription }]);
      if (!isPromptExpanded) {
        setIsPromptExpanded(true);
      }
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : t('alert.unknown_error');
      setError(errorMessage);
      console.error(e);
    } finally {
      setIsExtractingStyle(false);
    }
  }, [activeLayer, t, isPromptExpanded, textModel]);

  const handleSendChatMessage = useCallback(async () => {
    if (!chatInput.trim() || isReplying) return;

    const newHistory: ChatMessage[] = [...chatHistory, { role: 'user', text: chatInput }];
    setChatHistory(newHistory);
    setChatInput('');
    setIsReplying(true);
    setError(null);

    try {
      const imageFile = activeLayer?.file;
      const refinedPrompt = await geminiService.chatWithPromptHelper(newHistory, imageFile, textModel);
      setChatHistory(prev => [...prev, { role: 'model', text: refinedPrompt }]);
      setPrompt(refinedPrompt);
    } catch (e) {
      const errorMessage = e instanceof Error ? e.message : t('alert.unknown_error');
      setError(errorMessage);
      // Optionally add an error message to chat history
      setChatHistory(prev => [...prev, { role: 'model', text: `Error: ${errorMessage}` }]);
      console.error(e);
    } finally {
      setIsReplying(false);
    }
  }, [chatInput, chatHistory, isReplying, t, activeLayer, textModel]);

  // 隐藏 textarea ref，用于接收粘贴事件
  const globalPasteTextareaRef = useRef<HTMLTextAreaElement>(null);

  return (
    <div
      className={`magic-canvas-root theme-${theme} w-full h-screen overflow-hidden bg-[var(--color-bg)] text-[var(--color-text-primary)] relative`}
      tabIndex={-1}
      onClick={(e) => {
        // 点击任意非输入区域时，聚焦隐藏的 textarea 以接收粘贴事件
        const target = e.target as HTMLElement;
        if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA' && !target.isContentEditable) {
          globalPasteTextareaRef.current?.focus();
        }
      }}
    >
      {/* 全局隐藏的 textarea，用于接收粘贴事件 */}
      <textarea
        ref={globalPasteTextareaRef}
        className="absolute -left-[9999px] top-0 w-px h-px opacity-0"
        aria-hidden="true"
      />
      <LayerPanel
        layers={layers}
        activeLayerId={activeLayerId}
        isOpen={isLayerPanelOpen}
        setIsOpen={setIsLayerPanelOpen}
        onLayerSelect={setActiveLayerId}
        onAddLayer={addLayer}
        onDeleteLayer={handleDeleteLayer}
        onToggleVisibility={handleToggleVisibility}
        onReorder={handleReorderLayers}
      />
      <main className="w-full h-full flex flex-col overflow-hidden">
        <div className="flex-grow flex flex-col relative bg-[var(--color-bg-tertiary)]">
          <div className="flex-grow relative">
            <Canvas
              ref={canvasRef}
              layers={layers}
              activeLayerId={activeLayerId}
              canvasSize={canvasSize}
              tool={tool}
              brushColor={brushColor}
              brushSize={brushSize}
              onLayerUpdate={handleLayerUpdate}
              cropBox={cropBox}
              setCropBox={setCropBox}
              onSelectLayer={setActiveLayerId}
            />
            {error && (
              <div className="absolute top-4 left-1/2 -translate-x-1/2 bg-red-500/90 text-white px-4 py-2 rounded-md text-sm shadow-lg z-20">
                <p>{t('alert.generation_failed')}: {error}</p>
              </div>
            )}
          </div>
          <PromptBar
            prompt={prompt}
            setPrompt={setPrompt}
            onGenerate={handleGenerate}
            onSynthesize={handleSynthesizeScene}
            canSynthesize={layers.filter(l => l.isVisible).length > 1}
            isGenerating={isGenerating}
            isSynthesizing={isSynthesizing}
            isLeftPanelOpen={isLayerPanelOpen}
            isRightPanelCollapsed={isRightPanelCollapsed}
            promptMode={promptMode}
            setPromptMode={handlePromptModeChange}
            onExtractStyle={handleExtractStyle}
            isExtractingStyle={isExtractingStyle}
            isPromptExpanded={isPromptExpanded}
            setIsPromptExpanded={setIsPromptExpanded}
            chatHistory={chatHistory}
            chatInput={chatInput}
            setChatInput={setChatInput}
            onSendChatMessage={handleSendChatMessage}
            onClearChatHistory={handleClearChatHistory}
            isReplying={isReplying}
          />
        </div>
      </main>
      <RightPanel
        tool={tool}
        setTool={setTool}
        color={brushColor}
        setColor={setBrushColor}
        size={brushSize}
        setSize={setBrushSize}
        onClear={canvasRef.current?.clear}
        onUndo={canvasRef.current?.undo}
        onApplyCrop={handleApplyCrop}
        onMagicPromptSelect={(magicPrompt) => handleGenerate(prompt, magicPrompt)}
        isCollapsed={isRightPanelCollapsed}
        setIsCollapsed={setIsRightPanelCollapsed}
        presetUser={resolvedPresetUser}
        registerSaveHandler={registerSaveHandler}
        onSaveStatusChange={onSaveStatusChange}
      />
    </div>
  );
}

export default function AIImageEditorApp(props: MagicCanvasAppProps = {}) {
  const [language, setLanguage] = useState<'zh' | 'en'>('zh');
  const [theme, setTheme] = useState<'dark' | 'light' | 'green'>('dark');

  const t = useCallback((key: TranslationKey, options?: Record<string, string>): string => {
    let translation = translations[language][key] ?? key;
    if (options) {
      Object.entries(options).forEach(([k, v]) => {
        translation = translation.replace(`{{${k}}}`, v);
      });
    }
    return translation;
  }, [language]);

  useEffect(() => {
    const root = document.documentElement;
    root.lang = language;
  }, [language]);

  const contextValue = {
    language,
    setLanguage,
    theme,
    setTheme,
    t
  };

  return (
    <AppContext.Provider value={contextValue}>
      <AppContent {...props} />
    </AppContext.Provider>
  )
}
