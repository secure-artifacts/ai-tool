import React, { useState, useContext } from 'react';
import { Toolbar } from './Header';
import { MagicPanel } from './Gallery';
import { Tool } from '../types';
import { AppContext } from '../AppContext';

interface RightPanelProps {
    tool: Tool;
    setTool: (tool: Tool) => void;
    color: string;
    setColor: (color: string) => void;
    size: number;
    setSize: (size: number) => void;
    onClear?: () => void;
    onUndo?: () => void;
    onApplyCrop: () => void;
    onMagicPromptSelect: (prompt: string) => void;
    isCollapsed: boolean;
    setIsCollapsed: (isCollapsed: boolean) => void;
    presetUser?: string;
    registerSaveHandler?: (handler: (() => void) | null) => void;
    onSaveStatusChange?: (status: { type: 'success' | 'error'; message: string } | null) => void;
}

export const RightPanel: React.FC<RightPanelProps> = (props) => {
    const { isCollapsed, setIsCollapsed } = props;
    const { t } = useContext(AppContext);

    return (
        <aside className={`absolute top-0 right-0 bg-[var(--color-bg-secondary)] h-screen flex flex-col border-l border-[var(--color-border)] transition-all duration-300 ease-in-out z-20 overflow-y-auto ${isCollapsed ? 'w-12' : 'w-72'}`}>
            <button 
                onClick={() => setIsCollapsed(!isCollapsed)}
                className="absolute -left-3.5 top-8 -translate-y-1/2 bg-[var(--color-bg-contrast)] hover:bg-[var(--color-text-secondary)] text-[var(--color-text-primary)] rounded-full p-1.5 z-30"
                title={t(isCollapsed ? "sidebar.expand" : "sidebar.collapse")}
            >
                {isCollapsed ? (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M11 19l-7-7 7-7m8 14l-7-7 7-7" /></svg>
                ) : (
                    <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={3}><path strokeLinecap="round" strokeLinejoin="round" d="M13 5l7 7-7 7M5 5l7 7-7 7" /></svg>
                )}
            </button>
            
            <div className={`h-full flex flex-col transition-opacity duration-300 ${isCollapsed ? 'opacity-0 pointer-events-none' : 'opacity-100'}`}>
                <Toolbar 
                    tool={props.tool}
                    setTool={props.setTool}
                    color={props.color}
                    setColor={props.setColor}
                    size={props.size}
                    setSize={props.setSize}
                    onClear={props.onClear}
                    onUndo={props.onUndo}
                    onApplyCrop={props.onApplyCrop}
                />
                <MagicPanel
                    onMagicPromptSelect={props.onMagicPromptSelect}
                    presetUser={props.presetUser}
                    registerSaveHandler={props.registerSaveHandler}
                    onSaveStatusChange={props.onSaveStatusChange}
                />
            </div>

            {isCollapsed && (
                <div className="absolute inset-0 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-2">
                        {t('magic_panel.title').split('').map((char, index) => (
                            <span key={index} className="font-bold text-xl text-[var(--color-indigo)] tracking-widest">{char}</span>
                        ))}
                    </div>
                </div>
             )}
        </aside>
    );
};
