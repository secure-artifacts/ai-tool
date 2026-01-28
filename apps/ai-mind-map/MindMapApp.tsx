// ============================================
// AI Mind Map Application Module
// Integrated into AI Creative Toolkit
// ============================================

import { useState, useEffect, useCallback } from 'react';
import { MindMapCanvas } from './components/MindMapCanvas';
import { Toolbar } from './components/Toolbar';
import { AIPanel } from './components/AIPanel';
// AIChatPanel 功能已合并到 AIPanel
import { InputPanel } from './components/InputPanel';
import { SettingsPanel } from './components/SettingsPanel';
import { MarkerPanel } from './components/MarkerPanel';
import { StylePanel } from './components/StylePanel';
import { OutlinePanel } from './components/OutlinePanel';
import { OutlineCardView } from './components/OutlineCardView';
import { HierarchyCardView } from './components/HierarchyCardView';
import { GridViews } from './components/GridViews';
import { SourceMenuPanel } from './components/SourceMenuPanel';
import { ContextMenu, type ContextMenuPosition } from './components/ContextMenu';
import { ShortcutsHelpPanel } from './components/ShortcutsHelpPanel';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { useMindMapStore } from './store/mindMapStore';
import './mind-map.css';

type SidePanel = 'menu' | 'input' | 'ai' | 'marker' | 'style' | 'settings' | null;

interface MindMapAppProps {
    getAiInstance?: () => any;
}

// 网格视图类型列表
const GRID_VIEW_TYPES = ['table-view', 'outline-view', 'matrix-bracket', 'notebook-view', 'org-matrix'];

export const MindMapApp: React.FC<MindMapAppProps> = ({ getAiInstance }) => {
    const { themeMode, currentMap, selectedNodeId, selectNode, addNode, deleteNode, saveCurrentMap, layoutDirection, toggleCollapse, openAiExpand } = useMindMapStore();
    const [activePanel, setActivePanel] = useState<SidePanel>('input');

    // 🖱️ 右键菜单状态
    const [contextMenu, setContextMenu] = useState<{ position: ContextMenuPosition; nodeId: string } | null>(null);

    // 🎹 使用增强的快捷键系统
    const { copyNode, cutNode, pasteNode, hasClipboard, setRenameCallback } = useKeyboardShortcuts();

    // 检查特殊视图模式
    const isGridMode = layoutDirection === 'grid';
    const isHierarchyCardMode = layoutDirection === 'hierarchy-card';
    const isNewGridViewMode = GRID_VIEW_TYPES.includes(layoutDirection);
    const isCardViewMode = isGridMode || isHierarchyCardMode || isNewGridViewMode;

    // Store getAiInstance in window for services to access
    useEffect(() => {
        if (getAiInstance) {
            (window as any).__mindMapGetAiInstance = getAiInstance;
        }
        return () => {
            delete (window as any).__mindMapGetAiInstance;
        };
    }, [getAiInstance]);

    // Apply theme to document
    useEffect(() => {
        document.documentElement.setAttribute('data-theme', themeMode);
    }, [themeMode]);

    // 处理右键菜单
    const handleContextMenu = useCallback((e: React.MouseEvent, nodeId?: string) => {
        e.preventDefault();
        setContextMenu({
            position: { x: e.clientX, y: e.clientY },
            nodeId: nodeId || selectedNodeId || '',
        });
    }, [selectedNodeId]);

    const closeContextMenu = useCallback(() => {
        setContextMenu(null);
    }, []);

    // 监听全局右键事件（画布空白区域）
    useEffect(() => {
        const handleGlobalContextMenu = (e: MouseEvent) => {
            // 只处理画布区域的右键
            const target = e.target as HTMLElement;
            if (target.closest('.react-flow') && !target.closest('.react-flow__node')) {
                e.preventDefault();
                setContextMenu({
                    position: { x: e.clientX, y: e.clientY },
                    nodeId: selectedNodeId || currentMap?.rootId || '',
                });
            }
        };

        document.addEventListener('contextmenu', handleGlobalContextMenu);
        return () => document.removeEventListener('contextmenu', handleGlobalContextMenu);
    }, [selectedNodeId, currentMap?.rootId]);

    return (
        <div className="mind-map-app" data-theme={themeMode}>
            <header className="mind-map-header">
                <div className="logo">
                    <span className="material-icons logo-icon-material">tips_and_updates</span>
                    <span className="logo-text">AI 思维导图</span>
                    <span className="logo-tagline">把信息变成结构，把结构变成内容</span>
                </div>

                {currentMap && (
                    <div className="current-map-info">
                        <span className="map-name">{currentMap.name}</span>
                    </div>
                )}

                <nav className="panel-tabs">
                    <button
                        className={`tab-btn ${activePanel === 'menu' ? 'active' : ''}`}
                        onClick={() => setActivePanel(activePanel === 'menu' ? null : 'menu')}
                    >
                        📚 菜单
                    </button>
                    <button
                        className={`tab-btn ${activePanel === 'input' ? 'active' : ''}`}
                        onClick={() => setActivePanel(activePanel === 'input' ? null : 'input')}
                    >
                        📥 输入
                    </button>
                    <button
                        className={`tab-btn ${activePanel === 'ai' ? 'active' : ''}`}
                        onClick={() => setActivePanel(activePanel === 'ai' ? null : 'ai')}
                    >
                        🤖 AI 助手
                    </button>
                    <button
                        className={`tab-btn ${activePanel === 'marker' ? 'active' : ''}`}
                        onClick={() => setActivePanel(activePanel === 'marker' ? null : 'marker')}
                    >
                        🏷️ 标记
                    </button>
                    <button
                        className={`tab-btn ${activePanel === 'style' ? 'active' : ''}`}
                        onClick={() => setActivePanel(activePanel === 'style' ? null : 'style')}
                    >
                        🎨 样式
                    </button>
                    <button
                        className={`tab-btn ${activePanel === 'settings' ? 'active' : ''}`}
                        onClick={() => setActivePanel(activePanel === 'settings' ? null : 'settings')}
                    >
                        ⚙️ 设置
                    </button>
                </nav>
            </header>

            <Toolbar />


            <div className="mind-map-main">
                <div className="canvas-container">
                    {isGridMode && currentMap ? (
                        <OutlineCardView
                            nodes={currentMap.nodes}
                            rootId={currentMap.rootId}
                            onNodeClick={(nodeId) => selectNode(nodeId)}
                            onAddNode={(parentId) => addNode(parentId, '新节点')}
                            onAddSibling={(nodeId) => {
                                const node = currentMap.nodes[nodeId];
                                if (node?.parentId) addNode(node.parentId, '新节点');
                            }}
                            onDeleteNode={(nodeId) => deleteNode(nodeId)}
                            onAiExpand={(nodeId) => openAiExpand(nodeId)}
                            selectedNodeId={selectedNodeId}
                        />
                    ) : isHierarchyCardMode && currentMap ? (
                        <HierarchyCardView
                            nodes={currentMap.nodes}
                            rootId={currentMap.rootId}
                            onNodeClick={(nodeId) => selectNode(nodeId)}
                            onAddNode={(parentId) => addNode(parentId, '新节点')}
                            onAddSibling={(nodeId) => {
                                const node = currentMap.nodes[nodeId];
                                if (node?.parentId) addNode(node.parentId, '新节点');
                            }}
                            onDeleteNode={(nodeId) => deleteNode(nodeId)}
                            onAiExpand={(nodeId) => openAiExpand(nodeId)}
                            selectedNodeId={selectedNodeId}
                        />
                    ) : isNewGridViewMode && currentMap ? (
                        <GridViews
                            nodes={currentMap.nodes}
                            rootId={currentMap.rootId}
                            layoutType={layoutDirection}
                            onNodeClick={(nodeId) => selectNode(nodeId)}
                            onAddNode={(parentId) => addNode(parentId, '新节点')}
                            onAddSibling={(nodeId) => {
                                const node = currentMap.nodes[nodeId];
                                if (node?.parentId) addNode(node.parentId, '新节点');
                            }}
                            onDeleteNode={(nodeId) => deleteNode(nodeId)}
                            onAiExpand={(nodeId) => openAiExpand(nodeId)}
                            onToggleCollapse={(nodeId) => toggleCollapse(nodeId)}
                            selectedNodeId={selectedNodeId}
                        />
                    ) : (
                        <MindMapCanvas />
                    )}
                    {!isCardViewMode && <OutlinePanel />}
                </div>

                {activePanel && (
                    <aside className="side-panel">
                        {activePanel === 'menu' && (
                            <SourceMenuPanel
                                onClose={() => setActivePanel(null)}
                                onSelectTab={(tab) => {
                                    setActivePanel('input');
                                    window.setTimeout(() => {
                                        window.dispatchEvent(new CustomEvent('mindmap-input-tab', { detail: { tab } }));
                                    }, 0);
                                }}
                                onOpenMaps={() => window.dispatchEvent(new CustomEvent('mindmap-open-maps'))}
                                onImport={() => window.dispatchEvent(new CustomEvent('mindmap-import'))}
                            />
                        )}
                        {activePanel === 'input' && <InputPanel />}
                        {activePanel === 'ai' && <AIPanel />}
                        {activePanel === 'marker' && <MarkerPanel onClose={() => setActivePanel(null)} />}
                        {activePanel === 'style' && <StylePanel onClose={() => setActivePanel(null)} />}
                        {activePanel === 'settings' && <SettingsPanel />}
                    </aside>
                )}
            </div>

            {/* 🖱️ 右键上下文菜单 */}
            <ContextMenu
                position={contextMenu?.position || null}
                nodeId={contextMenu?.nodeId || null}
                onClose={closeContextMenu}
                onCopy={copyNode}
                onCut={cutNode}
                onPaste={pasteNode}
                hasClipboard={hasClipboard()}
            />

            {/* ⌨️ 快捷键帮助面板 */}
            <ShortcutsHelpPanel />
        </div>
    );
};

export default MindMapApp;
