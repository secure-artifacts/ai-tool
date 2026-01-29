import React, { useState } from 'react';
import { useMindMapStore } from '../store/mindMapStore';
import type { LayoutDirection, NodeStyle, MapStyle } from '../types';
import { StructureSelector } from './StructureSelector';

interface StylePanelProps {
    onClose?: () => void;
}

type Tab = 'style' | 'map';

const THEMES = [
    { name: '黎明', colors: ['#ff7e67', '#00b894', '#0984e3', '#6c5ce7'] },
    { name: '商务', colors: ['#2d3436', '#636e72', '#b2bec3', '#dfe6e9'] },
    { name: '清新', colors: ['#81ecec', '#74b9ff', '#a29bfe', '#fab1a0'] },
    { name: '暗黑', colors: ['#2d3436', '#e17055', '#fdcb6e', '#00cec9'] },
    { name: '海洋', colors: ['#0077b6', '#00b4d8', '#48cae4', '#90e0ef'] },
    { name: '森林', colors: ['#2d6a4f', '#40916c', '#52b788', '#95d5b2'] },
    { name: '日落', colors: ['#f72585', '#7209b7', '#3a0ca3', '#4cc9f0'] },
    { name: '糖果', colors: ['#ffadad', '#ffd6a5', '#caffbf', '#9bf6ff'] },
    { name: '极简', colors: ['#212529', '#495057', '#adb5bd', '#e9ecef'] },
    { name: '薰衣草', colors: ['#7b2cbf', '#9d4edd', '#c77dff', '#e0aaff'] },
    { name: '复古', colors: ['#bc6c25', '#dda15e', '#606c38', '#283618'] },
    { name: '霓虹', colors: ['#ff0a54', '#ff5400', '#00f5d4', '#7209b7'] },
];

// 完整视觉主题预设 - 类似 Mapify 的样式
interface VisualThemePreset {
    name: string;
    icon: string;
    description: string;
    colors: string[];
    lineStyle: 'curve' | 'straight' | 'step';
    nodeShape: 'rounded' | 'rectangle' | 'ellipse' | 'diamond' | 'underline';
    background: string;
}

const VISUAL_THEMES: VisualThemePreset[] = [
    {
        name: '经典彩虹',
        icon: '🌈',
        description: '彩色标题栏 + 圆角节点 + 曲线连接',
        colors: ['#e67e22', '#27ae60', '#9b59b6', '#3498db'],
        lineStyle: 'curve',
        nodeShape: 'rounded',
        background: '#fafafa',
    },
    {
        name: '商务紫',
        icon: '💼',
        description: '紫色主题 + 浅色背景 + 折线连接',
        colors: ['#7c3aed', '#8b5cf6', '#a78bfa', '#c4b5fd'],
        lineStyle: 'step',
        nodeShape: 'rounded',
        background: '#f5f3ff',
    },
    {
        name: '清新绿',
        icon: '🌿',
        description: '绿色主题 + 轻盈风格',
        colors: ['#059669', '#10b981', '#34d399', '#6ee7b7'],
        lineStyle: 'curve',
        nodeShape: 'rounded',
        background: '#ecfdf5',
    },
    {
        name: '科技蓝',
        icon: '💎',
        description: '蓝色渐变 + 菱形节点 + 直线连接',
        colors: ['#0284c7', '#0ea5e9', '#38bdf8', '#7dd3fc'],
        lineStyle: 'straight',
        nodeShape: 'diamond',
        background: '#f0f9ff',
    },
    {
        name: '暖橙',
        icon: '🔥',
        description: '橙色暖色调 + 活力风格',
        colors: ['#ea580c', '#f97316', '#fb923c', '#fdba74'],
        lineStyle: 'curve',
        nodeShape: 'rounded',
        background: '#fff7ed',
    },
    {
        name: '极简灰',
        icon: '⬜',
        description: '黑白灰 + 简约线条',
        colors: ['#1f2937', '#4b5563', '#9ca3af', '#d1d5db'],
        lineStyle: 'step',
        nodeShape: 'underline',
        background: '#f9fafb',
    },
];

export const StylePanel: React.FC<StylePanelProps> = ({ onClose }) => {
    const {
        currentMap,
        selectedNodeId,
        updateNode,
        layoutDirection,
        setLayoutDirection,
        themeMode,
        setThemeMode,
        updateMapStyle,
        applyTheme,
        applyVisualTheme,
        allowManualDrag,
        setAllowManualDrag
    } = useMindMapStore();
    const [activeTab, setActiveTab] = useState<Tab>('style');

    const selectedNode = selectedNodeId && currentMap ? currentMap.nodes[selectedNodeId] : null;

    // Helper to update node style
    const handleUpdateNodeStyle = (updates: Partial<NodeStyle>) => {
        if (!selectedNodeId || !selectedNode) return;
        updateNode(selectedNodeId, {
            style: {
                ...selectedNode.style,
                ...updates
            }
        });
    };

    // Helper to update map style
    const handleUpdateMapStyle = (updates: Partial<MapStyle>) => {
        updateMapStyle(updates);
    };

    return (
        <div className="marker-panel style-panel"> {/* Reuse marker-panel layout */}
            <div className="marker-panel-header">
                <div className="panel-tabs-header">
                    <button
                        className={`panel-tab-btn ${activeTab === 'style' ? 'active' : ''}`}
                        onClick={() => setActiveTab('style')}
                    >
                        样式
                    </button>
                    <button
                        className={`panel-tab-btn ${activeTab === 'map' ? 'active' : ''}`}
                        onClick={() => setActiveTab('map')}
                    >
                        地图
                    </button>
                </div>
                {onClose && <button className="close-btn" onClick={onClose}>×</button>}
            </div>

            <div className="marker-panel-content">
                {activeTab === 'style' ? (
                    <div className="style-tab-content">
                        {!selectedNode ? (
                            <div className="empty-state">
                                <p>请选择一个节点以编辑样式</p>
                            </div>
                        ) : (
                            <>
                                <div className="style-group">
                                    <label>形状</label>
                                    <div className="shape-grid">
                                        {['rectangle', 'rounded', 'ellipse', 'diamond', 'underline'].map(shape => (
                                            <button
                                                key={shape}
                                                className={`shape-btn ${selectedNode.style?.shape === shape ? 'active' : ''}`}
                                                onClick={() => handleUpdateNodeStyle({ shape: shape as any })}
                                                title={shape}
                                            >
                                                <div className={`shape-preview shape-${shape}`} />
                                            </button>
                                        ))}
                                    </div>
                                </div>

                                <div className="style-group">
                                    <label>填充颜色</label>
                                    <input
                                        type="color"
                                        value={selectedNode.style?.fill || selectedNode.color || '#ffffff'}
                                        onChange={(e) => handleUpdateNodeStyle({ fill: e.target.value })}
                                        className="color-picker-input"
                                    />
                                </div>

                                <div className="style-group">
                                    <label>边框</label>
                                    <div className="control-row">
                                        <input
                                            type="color"
                                            value={selectedNode.style?.borderColor || '#000000'}
                                            onChange={(e) => handleUpdateNodeStyle({ borderColor: e.target.value })}
                                            title="边框颜色"
                                        />
                                        <select
                                            value={selectedNode.style?.borderStyle || 'solid'}
                                            onChange={(e) => handleUpdateNodeStyle({ borderStyle: e.target.value as any })}
                                        >
                                            <option value="solid">实线</option>
                                            <option value="dashed">虚线</option>
                                            <option value="dotted">点线</option>
                                        </select>
                                        <input
                                            type="number"
                                            min="0"
                                            max="10"
                                            value={selectedNode.style?.borderWidth ?? 0}
                                            onChange={(e) => handleUpdateNodeStyle({ borderWidth: Number(e.target.value) })}
                                            style={{ width: '50px' }}
                                        />
                                    </div>
                                </div>

                                <div className="style-group">
                                    <label>文本</label>
                                    <div className="control-row">
                                        <select
                                            value={selectedNode.style?.fontFamily || 'inherit'}
                                            onChange={(e) => handleUpdateNodeStyle({ fontFamily: e.target.value })}
                                        >
                                            <option value="inherit">默认</option>
                                            <option value="serif">Serif</option>
                                            <option value="sans-serif">Sans</option>
                                            <option value="monospace">Mono</option>
                                        </select>
                                        <input
                                            type="number"
                                            value={selectedNode.style?.fontSize || 14}
                                            onChange={(e) => handleUpdateNodeStyle({ fontSize: Number(e.target.value) })}
                                            style={{ width: '60px' }}
                                            title="字号"
                                        />
                                        <button
                                            className={`icon-btn ${selectedNode.style?.fontWeight === 'bold' ? 'active' : ''}`}
                                            onClick={() => handleUpdateNodeStyle({ fontWeight: selectedNode.style?.fontWeight === 'bold' ? 'normal' : 'bold' })}
                                        >
                                            B
                                        </button>
                                        <button
                                            className={`icon-btn ${selectedNode.style?.fontStyle === 'italic' ? 'active' : ''}`}
                                            onClick={() => handleUpdateNodeStyle({ fontStyle: selectedNode.style?.fontStyle === 'italic' ? 'normal' : 'italic' })}
                                        >
                                            I
                                        </button>
                                        <button
                                            className={`icon-btn ${selectedNode.style?.textDecoration === 'underline' ? 'active' : ''}`}
                                            onClick={() => handleUpdateNodeStyle({ textDecoration: selectedNode.style?.textDecoration === 'underline' ? 'none' : 'underline' })}
                                        >
                                            U
                                        </button>
                                        <button
                                            className={`icon-btn ${selectedNode.style?.textDecoration === 'line-through' ? 'active' : ''}`}
                                            onClick={() => handleUpdateNodeStyle({ textDecoration: selectedNode.style?.textDecoration === 'line-through' ? 'none' : 'line-through' })}
                                        >
                                            S
                                        </button>
                                        <input
                                            type="color"
                                            value={selectedNode.style?.color || '#000000'}
                                            onChange={(e) => handleUpdateNodeStyle({ color: e.target.value })}
                                            title="文本颜色"
                                        />
                                    </div>
                                </div>
                            </>
                        )}
                    </div>
                ) : (
                    <div className="map-tab-content">
                        <div className="style-group">
                            <label>结构</label>
                            <StructureSelector
                                value={layoutDirection}
                                onChange={(value) => setLayoutDirection(value as LayoutDirection)}
                            />
                        </div>

                        <div className="style-group">
                            <label>拖拽布局</label>
                            <div className="control-row">
                                <label>
                                    <input
                                        type="checkbox"
                                        checked={allowManualDrag}
                                        onChange={(e) => setAllowManualDrag(e.target.checked)}
                                    />
                                    子级跟随父级移动
                                </label>
                            </div>
                        </div>

                        <div className="style-group">
                            <label>主题模式</label>
                            <div className="theme-toggle-row">
                                <button
                                    className={`theme-btn ${themeMode === 'light' ? 'active' : ''}`}
                                    onClick={() => setThemeMode('light')}
                                >
                                    ☀️ 浅色
                                </button>
                                <button
                                    className={`theme-btn ${themeMode === 'dark' ? 'active' : ''}`}
                                    onClick={() => setThemeMode('dark')}
                                >
                                    🌙 深色
                                </button>
                            </div>
                        </div>

                        <div className="style-group">
                            <label>视觉主题</label>
                            <div className="visual-theme-grid">
                                {VISUAL_THEMES.map((theme) => (
                                    <button
                                        key={theme.name}
                                        className="visual-theme-btn"
                                        onClick={() => applyVisualTheme({
                                            colors: theme.colors,
                                            lineStyle: theme.lineStyle,
                                            nodeShape: theme.nodeShape,
                                            background: theme.background,
                                        })}
                                        title={theme.description}
                                    >
                                        <span className="visual-theme-icon">{theme.icon}</span>
                                        <span className="visual-theme-name">{theme.name}</span>
                                        <span className="visual-theme-colors">
                                            {theme.colors.slice(0, 4).map((color, i) => (
                                                <span key={i} style={{ backgroundColor: color }} />
                                            ))}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="style-group">
                            <label>主题配色</label>
                            <div className="theme-palette-grid">
                                {THEMES.map((theme) => (
                                    <button
                                        key={theme.name}
                                        className="theme-palette-btn"
                                        onClick={() => applyTheme(theme.colors)}
                                        title={theme.name}
                                    >
                                        <span className="theme-palette-name">{theme.name}</span>
                                        <span className="theme-palette-colors">
                                            {theme.colors.map((color) => (
                                                <span key={color} style={{ backgroundColor: color }} />
                                            ))}
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>

                        <div className="style-group">
                            <label>画布背景</label>
                            <input
                                type="color"
                                value={currentMap?.style?.background || (themeMode === 'dark' ? '#1a1b26' : '#f8fafc')}
                                onChange={(e) => handleUpdateMapStyle({ background: e.target.value })}
                                className="color-picker-input"
                            />
                        </div>

                        <div className="style-group">
                            <label>连线样式</label>
                            <div className="control-column">
                                <select
                                    value={currentMap?.style?.lineStyle || 'curve'}
                                    onChange={(e) => handleUpdateMapStyle({ lineStyle: e.target.value as any })}
                                >
                                    <option value="curve">曲线</option>
                                    <option value="straight">直线</option>
                                    <option value="step">折线</option>
                                </select>
                                <div className="control-row" className="mt-2">
                                    <span>颜色</span>
                                    <input
                                        type="color"
                                        value={currentMap?.style?.lineColor || '#6366f1'}
                                        onChange={(e) => handleUpdateMapStyle({ lineColor: e.target.value })}
                                    />
                                </div>
                                <div className="control-row" className="mt-2">
                                    <label>
                                        <input
                                            type="checkbox"
                                            checked={currentMap?.style?.rainbowLines || false}
                                            onChange={(e) => handleUpdateMapStyle({ rainbowLines: e.target.checked })}
                                        />
                                        彩虹线条
                                    </label>
                                </div>
                                <div className="control-row" style={{ marginTop: '8px', alignItems: 'center' }}>
                                    <span>宽度</span>
                                    <input
                                        type="range"
                                        min="1"
                                        max="10"
                                        value={currentMap?.style?.lineWidth || 2}
                                        onChange={(e) => handleUpdateMapStyle({ lineWidth: Number(e.target.value) })}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};
