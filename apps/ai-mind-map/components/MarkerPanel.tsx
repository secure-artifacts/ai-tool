import { useState } from 'react';
import { useMindMapStore } from '../store/mindMapStore';
import { MARKER_GROUPS, NODE_TAG_CONFIG } from '../types';
import type { NodeTag } from '../types';
import { STICKER_CATEGORIES, STICKERS } from './stickerData';

interface MarkerPanelProps {
    onClose?: () => void;
}

export const MarkerPanel: React.FC<MarkerPanelProps> = ({ onClose }) => {
    const { selectedNodeId, currentMap, toggleMarker, toggleSticker, addTag, removeTag } = useMindMapStore();
    const [activeTab, setActiveTab] = useState<'marker' | 'sticker'>('marker');
    const [stickerCategory, setStickerCategory] = useState<string>('all');

    // 获取当前选中节点的 markers
    const selectedNode = selectedNodeId && currentMap ? currentMap.nodes[selectedNodeId] : null;
    const activeMarkers = selectedNode?.markers || [];
    const activeStickers = selectedNode?.stickers || [];
    const activeTags = selectedNode?.tags || [];

    const handleToggle = (markerId: string) => {
        if (selectedNodeId) {
            toggleMarker(selectedNodeId, markerId);
        }
    };

    const handleToggleSticker = (stickerId: string) => {
        if (selectedNodeId) {
            toggleSticker(selectedNodeId, stickerId);
        }
    };

    const handleToggleTag = (tag: NodeTag) => {
        if (!selectedNodeId || !selectedNode) return;
        if (activeTags.includes(tag)) {
            removeTag(selectedNodeId, tag);
        } else {
            addTag(selectedNodeId, tag);
        }
    };

    const visibleStickerGroups = stickerCategory === 'all'
        ? Object.entries(STICKERS)
        : Object.entries(STICKERS).filter(([catId]) => catId === stickerCategory);

    return (
        <div className="marker-panel">
            <div className="marker-panel-header">
                <div className="panel-tabs-header">
                    <button
                        className={`panel-tab-btn ${activeTab === 'marker' ? 'active' : ''}`}
                        onClick={() => setActiveTab('marker')}
                    >
                        标记
                    </button>
                    <button
                        className={`panel-tab-btn ${activeTab === 'sticker' ? 'active' : ''}`}
                        onClick={() => setActiveTab('sticker')}
                    >
                        贴纸
                    </button>
                </div>
                {onClose && <button className="close-btn" onClick={onClose}>×</button>}
            </div>

            <div className="marker-panel-content">
                {!selectedNodeId ? (
                    <div className="marker-panel-empty">
                        <p>请先选择一个节点以添加标记或贴纸</p>
                    </div>
                ) : (
                    <>
                        <div className="selected-node-preview">
                            <span>当前节点：</span>
                            <strong>{selectedNode?.label}</strong>
                        </div>

                        {activeTab === 'marker' ? (
                            <>
                                <div className="marker-group">
                                    <div className="marker-group-title">
                                        📌 内容标记
                                    </div>
                                    <div className="marker-group-items">
                                        {(Object.keys(NODE_TAG_CONFIG) as NodeTag[]).map((tag) => {
                                            const config = NODE_TAG_CONFIG[tag];
                                            const isActive = activeTags.includes(tag);
                                            return (
                                                <button
                                                    key={tag}
                                                    className={`tag-btn ${isActive ? 'active' : ''}`}
                                                    style={{
                                                        borderColor: isActive ? config.color : undefined,
                                                        backgroundColor: isActive ? `${config.color}20` : undefined,
                                                    }}
                                                    onClick={() => handleToggleTag(tag)}
                                                >
                                                    <span>{config.icon}</span>
                                                    <span>{config.label}</span>
                                                </button>
                                            );
                                        })}
                                    </div>
                                </div>
                                {MARKER_GROUPS.map((group) => (
                                    <div key={group.id} className="marker-group">
                                        <div className="marker-group-title" onClick={(e) => {
                                            const content = e.currentTarget.nextElementSibling;
                                            content?.classList.toggle('hidden');
                                            e.currentTarget.classList.toggle('collapsed');
                                        }}>
                                            <span className="arrow">▼</span> {group.label}
                                        </div>
                                        <div className="marker-group-items">
                                            {group.items.map((item) => {
                                                const isActive = activeMarkers.includes(item.id);
                                                return (
                                                    <button
                                                        key={item.id}
                                                        className={`marker-item-btn ${isActive ? 'active' : ''} ${item.type}`}
                                                        onClick={() => handleToggle(item.id)}
                                                        title={item.label}
                                                    >
                                                        {item.type === 'color' ? (
                                                            <div
                                                                className="color-dot"
                                                                style={{ backgroundColor: item.color }}
                                                            />
                                                        ) : (
                                                            <span className="marker-icon">{item.content}</span>
                                                        )}
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </>
                        ) : (
                            <>
                                <div className="sticker-filter">
                                    <button
                                        className={`filter-btn ${stickerCategory === 'all' ? 'active' : ''}`}
                                        onClick={() => setStickerCategory('all')}
                                    >
                                        全部
                                    </button>
                                    {STICKER_CATEGORIES.map((group) => (
                                        <button
                                            key={group.id}
                                            className={`filter-btn ${stickerCategory === group.id ? 'active' : ''}`}
                                            onClick={() => setStickerCategory(group.id)}
                                        >
                                            {group.label}
                                        </button>
                                    ))}
                                </div>
                                {visibleStickerGroups.map(([catId, stickers]) => (
                                    <div key={catId} className="marker-group">
                                        <div className="marker-group-title">
                                            {STICKER_CATEGORIES.find((c) => c.id === catId)?.label || catId}
                                        </div>
                                        <div className="sticker-grid">
                                            {stickers.map((item) => {
                                                const isActive = activeStickers.includes(item.id);
                                                const Icon = item.icon;
                                                return (
                                                    <button
                                                        key={item.id}
                                                        className={`sticker-btn ${isActive ? 'active' : ''}`}
                                                        onClick={() => handleToggleSticker(item.id)}
                                                        title={item.id}
                                                    >
                                                        <Icon size={18} color={item.color} />
                                                    </button>
                                                );
                                            })}
                                        </div>
                                    </div>
                                ))}
                            </>
                        )}
                    </>
                )}
            </div>
        </div>
    );
};
