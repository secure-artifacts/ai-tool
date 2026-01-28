import React, { useContext, useState, useRef, useEffect } from 'react';
import { AppContext } from '../AppContext';
import { Tool } from '../types';
import { BrushIcon, RectangleIcon, MoveIcon } from './Icons';

const COLORS = ['#EF4444', '#F97316', '#84CC16', '#22C55E', '#06B6D4', '#6366F1', '#D946EF', '#FFFFFF', '#000000'];

interface ToolbarProps {
    tool: Tool;
    setTool: (tool: Tool) => void;
    color: string;
    setColor: (color: string) => void;
    size: number;
    setSize: (size: number) => void;
    onClear?: () => void;
    onUndo?: () => void;
    onApplyCrop: () => void;
}

const ToolButton: React.FC<{isActive: boolean, onClick: () => void, title: string, children: React.ReactNode}> = ({isActive, onClick, title, children}) => (
    <button
        onClick={onClick}
        title={title}
        className={`p-2 rounded-md ${isActive ? 'bg-[var(--color-indigo)] text-white' : 'bg-[var(--color-bg-contrast)] hover:opacity-80 text-[var(--color-text-primary)]'} transition-colors`}
    >
        {children}
    </button>
);

const Popover: React.FC<{ trigger: React.ReactNode, children: React.ReactNode }> = ({ trigger, children }) => {
    const [isOpen, setIsOpen] = useState(false);
    const popoverRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (popoverRef.current && !popoverRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    return (
        <div className="relative" ref={popoverRef}>
            <div onClick={() => setIsOpen(!isOpen)}>{trigger}</div>
            {isOpen && (
                <div className="absolute top-full left-1/2 -translate-x-1/2 mt-2 p-2 bg-[var(--color-bg-secondary)] rounded-lg shadow-lg border border-[var(--color-border)] z-50">
                    {children}
                </div>
            )}
        </div>
    );
};


export const Toolbar: React.FC<ToolbarProps> = ({ tool, setTool, color, setColor, size, setSize, onClear, onUndo, onApplyCrop }) => {
    const { t } = useContext(AppContext);

    return (
        <div className="p-2 border-b border-[var(--color-border)] flex-shrink-0">
             <div className="flex flex-col items-center gap-2 p-1.5 bg-[var(--color-bg)] rounded-lg shadow-sm border border-[var(--color-border)]">
                {/* Row 1 */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                        <ToolButton isActive={tool === 'move'} onClick={() => setTool('move')} title={t('toolbar.move')}>
                            <MoveIcon className="h-5 w-5" />
                        </ToolButton>
                         <ToolButton isActive={tool === 'crop'} onClick={() => setTool('crop')} title={t('toolbar.crop')}>
                            <span className="material-icons text-base leading-none">crop</span>
                        </ToolButton>
                    </div>

                    <div className="h-6 w-px bg-[var(--color-border)]"></div>

                    <div className="flex items-center gap-1">
                        <ToolButton isActive={false} onClick={onUndo!} title={t('toolbar.undo')}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 018 8v2M3 10l6-6m-6 6l6 6" /></svg>
                        </ToolButton>
                        <ToolButton isActive={false} onClick={onClear!} title={t('toolbar.clear_mask')}>
                          <svg xmlns="http://www.w3.org/2000/svg" className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}><path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" /></svg>
                        </ToolButton>
                    </div>
                    
                    { tool === 'crop' && (
                        <>
                         <div className="h-6 w-px bg-[var(--color-border)]"></div>
                         <div className="flex items-center gap-2">
                            <button onClick={() => setTool('move')} className="px-3 py-1.5 bg-[var(--color-bg-contrast)] hover:opacity-80 text-white text-sm font-semibold rounded-md transition-colors">
                               {t('common.cancel')}
                            </button>
                            <button onClick={onApplyCrop} className="px-3 py-1.5 bg-[var(--color-indigo)] hover:bg-[var(--color-indigo-hover)] text-white text-sm font-semibold rounded-md transition-colors">
                               {t('toolbar.apply_crop')}
                            </button>
                         </div>
                        </>
                    )}
                </div>

                {/* Row 2 */}
                <div className="flex items-center gap-2">
                    <div className="flex items-center gap-1">
                        <ToolButton isActive={tool === 'brush'} onClick={() => setTool('brush')} title={t('toolbar.brush')}>
                            <BrushIcon className="h-5 w-5" />
                        </ToolButton>
                        <ToolButton isActive={tool === 'rectangle'} onClick={() => setTool('rectangle')} title={t('toolbar.rectangle')}>
                           <RectangleIcon className="h-5 w-5" />
                        </ToolButton>
                    </div>
                    
                    { (tool === 'brush' || tool === 'rectangle') && (
                        <>
                        <div className="h-6 w-px bg-[var(--color-border)]"></div>
                        <div className="flex items-center gap-2">
                             <Popover trigger={
                                <button className="w-6 h-6 rounded-full border-2 border-white/50 shadow-md" style={{ backgroundColor: color }} title={t('toolbar.color')}></button>
                             }>
                                 <div className="grid grid-cols-5 gap-2">
                                    {COLORS.map(c => (
                                        <button key={c} onClick={() => setColor(c)} style={{ backgroundColor: c }} className={`w-6 h-6 rounded-full transition-transform hover:scale-110 border border-black/20 ${color === c ? 'ring-2 ring-offset-2 ring-offset-[var(--color-bg-secondary)] ring-white' : ''}`} />
                                    ))}
                                </div>
                             </Popover>
                             <Popover trigger={
                                <button className="flex items-center justify-center w-6 h-6 bg-[var(--color-bg-contrast)] rounded-full" title={t('toolbar.size')}>
                                    <div className="bg-white/50 rounded-full" style={{ width: Math.max(2, size/10 + 2), height: Math.max(2, size/10 + 2)}}></div>
                                </button>
                             }>
                                 <div className="p-2 w-48">
                                    <div className="flex justify-between items-center mb-2">
                                        <span className="text-xs text-[var(--color-text-secondary)]">{t('toolbar.size')}</span>
                                        <span className="text-sm font-semibold w-10 text-right">{size}px</span>
                                    </div>
                                    <input 
                                        type="range" 
                                        min="1" 
                                        max="200"
                                        step="1"
                                        value={size} 
                                        onChange={(e) => setSize(Number(e.target.value))}
                                        className="w-full h-2 bg-[var(--color-bg-contrast)] rounded-lg appearance-none cursor-pointer"
                                    />
                                </div>
                             </Popover>
                        </div>
                        </>
                    )}
                </div>
            </div>
        </div>
    );
};
