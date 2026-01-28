import React, { useContext, useRef, useEffect, useState } from 'react';
import { AppContext } from '../AppContext';
import { Layer } from '../types';
import { DownloadIcon, LayersIcon, SparklesIcon, MoonIcon, SunIcon, LeafIcon } from './Icons';

interface LayerItemProps {
  layer: Layer;
  isActive: boolean;
  onSelect: (id: string) => void;
  onDelete: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onDownload: (layer: Layer) => void;
  onReorder: (draggedId: string, dropTargetId: string) => void;
  activeLayerRef: React.RefObject<HTMLDivElement> | null;
}

const LayerItem: React.FC<LayerItemProps> = ({ layer, isActive, onSelect, onDelete, onToggleVisibility, onDownload, onReorder, activeLayerRef }) => {
  const { t } = useContext(AppContext);
  const [isDragOver, setIsDragOver] = useState(false);

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setIsDragOver(false);
    const draggedId = e.dataTransfer.getData('layerId');
    if (draggedId && draggedId !== layer.id) {
      onReorder(draggedId, layer.id);
    }
  };

  return (
    <div
      ref={isActive ? activeLayerRef : null}
      draggable
      onDragStart={(e) => e.dataTransfer.setData('layerId', layer.id)}
      onDragOver={(e) => { e.preventDefault(); setIsDragOver(true); }}
      onDragLeave={() => setIsDragOver(false)}
      onDrop={handleDrop}
      onClick={() => onSelect(layer.id)}
      className={`group relative flex items-center gap-2 p-2 rounded-md transition-colors cursor-pointer ${isActive ? 'bg-[var(--color-indigo-bg-light)]' : 'hover:bg-[var(--color-bg-contrast)]'} ${!layer.isVisible ? 'opacity-50' : ''}`}
    >
      {isDragOver && <div className="absolute top-0 left-0 w-full h-0.5 bg-blue-500" />}
      <button onClick={(e) => { e.stopPropagation(); onToggleVisibility(layer.id); }} className="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]" title={t(layer.isVisible ? 'layers.hide' : 'layers.show')}>
        {layer.isVisible ? (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" /><path strokeLinecap="round" strokeLinejoin="round" d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" /></svg>
        ) : (
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M13.875 18.825A10.05 10.05 0 0112 19c-4.478 0-8.268-2.943-9.543-7a9.97 9.97 0 011.563-3.029m5.858.908a3 3 0 114.243 4.243M9.878 9.878l4.242 4.242M9.88 9.88l-3.29-3.29m7.532 7.532l3.29 3.29M3 3l3.59 3.59m0 0A9.953 9.953 0 0112 5c4.478 0 8.268 2.943 9.543 7a10.025 10.025 0 01-4.132 5.411m0 0L21 21" /></svg>
        )}
      </button>
      <div className="w-12 h-8 bg-gray-700 rounded-sm overflow-hidden flex-shrink-0 cursor-pointer" onClick={() => onSelect(layer.id)}>
        <img src={layer.imageUrl} alt={layer.name} className="w-full h-full object-cover" />
      </div>
      <p className="text-sm truncate flex-grow cursor-pointer" onClick={() => onSelect(layer.id)}>{layer.name}</p>

      <div className={`flex items-center opacity-0 group-hover:opacity-100 transition-opacity`}>
        <button onClick={(e) => { e.stopPropagation(); onDownload(layer); }} className="p-1 text-[var(--color-text-secondary)] hover:text-[var(--color-indigo-text)]" title={t('common.download')}>
          <DownloadIcon className="h-4 w-4" />
        </button>
        <button onClick={(e) => { e.stopPropagation(); onDelete(layer.id); }} className="p-1 text-[var(--color-text-secondary)] hover:text-red-500" title={t('layers.delete')}>
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" /></svg>
        </button>
      </div>
    </div>
  );
};

interface LayerPanelProps {
  layers: Layer[];
  activeLayerId: string | null;
  isOpen: boolean;
  setIsOpen: (isOpen: boolean) => void;
  onLayerSelect: (id: string) => void;
  onAddLayer: (file: File) => void;
  onDeleteLayer: (id: string) => void;
  onToggleVisibility: (id: string) => void;
  onReorder: (draggedId: string, dropTargetId: string) => void;
}

export const LayerPanel: React.FC<LayerPanelProps> = ({ layers, activeLayerId, isOpen, setIsOpen, onLayerSelect, onAddLayer, onDeleteLayer, onToggleVisibility, onReorder }) => {
  const { t, language, setLanguage, theme, setTheme } = useContext(AppContext);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const activeLayerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (activeLayerRef.current) {
      activeLayerRef.current.scrollIntoView({
        behavior: 'smooth',
        block: 'nearest',
      });
    }
  }, [activeLayerId]);

  const handleAddClick = () => {
    fileInputRef.current?.click();
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (file) {
      onAddLayer(file);
    }
    event.target.value = '';
  };

  const handleDownload = (layer: Layer) => {
    const link = document.createElement('a');
    link.href = layer.imageUrl;
    const name = layer.name.split('.').slice(0, -1).join('.');
    const ext = layer.file.type.split('/')[1] || 'png';
    link.download = `${name}.${ext}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handleLanguageToggle = () => {
    setLanguage(language === 'zh' ? 'en' : 'zh');
  };

  const handleThemeToggle = () => {
    if (theme === 'dark') setTheme('light');
    else if (theme === 'light') setTheme('green');
    else setTheme('dark');
  };

  const ThemeIcon = () => {
    if (theme === 'dark') return <MoonIcon className="h-6 w-6" />;
    if (theme === 'light') return <SunIcon className="h-6 w-6" />;
    return <LeafIcon className="h-6 w-6" />;
  };

  return (
    <aside className="absolute top-0 left-0 h-full flex z-30">
      {/* Icon Bar */}
      <div className="w-16 h-full flex flex-col items-center justify-between py-4 bg-[var(--color-bg)] border-r border-[var(--color-border)]">
        <div className="flex flex-col items-center gap-4">
          {/* Brand Unit */}
          <div className="flex flex-col items-center gap-3 p-2">
            <SparklesIcon className="h-8 w-8 text-[var(--color-indigo)]" />
            <div className="w-full border-b border-[var(--color-border)] my-2"></div>
            {language === 'zh' ? (
              <div className="flex flex-col items-center gap-1">
                {t('app.title').split('').map((char, index) => (
                  <span key={index} className="font-bold text-xl text-[var(--color-indigo)] tracking-widest">{char}</span>
                ))}
              </div>
            ) : (
              <div className="flex items-start justify-center gap-2 py-2">
                {t('app.title').split(' ').map((word, wordIndex) => (
                  <div key={wordIndex} className="flex flex-col items-center">
                    {word.split('').map((char, charIndex) => (
                      <span key={charIndex} className="font-bold text-sm leading-none tracking-wider text-[var(--color-indigo)]">{char}</span>
                    ))}
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="w-10 border-b border-[var(--color-border)]"></div>
          {/* Layers Toggle */}
          <button
            onClick={() => setIsOpen(!isOpen)}
            className={`p-2 rounded-lg ${isOpen ? 'bg-[var(--color-indigo-bg-light)] text-[var(--color-indigo)]' : 'text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-contrast)]'}`}
            title={t('layers.title')}
          >
            <LayersIcon className="h-6 w-6" />
          </button>
        </div>

        <div className="flex flex-col items-center gap-4">
          <button
            onClick={handleThemeToggle}
            className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-contrast)] hover:text-[var(--color-text-primary)]"
            title="切换主题"
          >
            <ThemeIcon />
          </button>
          <button
            onClick={handleLanguageToggle}
            className="p-2 w-10 h-10 flex items-center justify-center rounded-lg text-sm font-bold text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-contrast)] hover:text-[var(--color-text-primary)]"
            title="切换语言"
          >
            {language === 'zh' ? 'EN' : '中'}
          </button>
          <div className="w-10 border-b border-[var(--color-border)]"></div>
          <input type="file" ref={fileInputRef} onChange={handleFileChange} accept="image/*" className="hidden" />
          <button
            onClick={handleAddClick}
            className="p-2 rounded-lg text-[var(--color-text-secondary)] hover:bg-[var(--color-bg-contrast)] hover:text-[var(--color-text-primary)]"
            title={t('layers.add')}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
            </svg>
          </button>
        </div>
      </div>

      {/* Content Panel */}
      <div className={`transition-all duration-300 ease-in-out overflow-hidden flex flex-col bg-[var(--color-bg-secondary)] border-r border-[var(--color-border)] ${isOpen ? 'w-64' : 'w-0'}`}>
        <div className="w-64 h-full flex flex-col">
          <div className="p-2 border-b border-[var(--color-border)] flex-shrink-0">
            <h2 className="text-base font-bold text-center">{t('layers.title')}</h2>
          </div>
          <div className="flex-grow p-2 overflow-y-auto">
            <div className="flex flex-col-reverse gap-2">
              {layers.map(layer => (
                <LayerItem
                  key={layer.id}
                  layer={layer}
                  isActive={activeLayerId === layer.id}
                  onSelect={onLayerSelect}
                  onDelete={onDeleteLayer}
                  onToggleVisibility={onToggleVisibility}
                  onDownload={handleDownload}
                  onReorder={onReorder}
                  activeLayerRef={activeLayerId === layer.id ? activeLayerRef : null}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </aside>
  );
};