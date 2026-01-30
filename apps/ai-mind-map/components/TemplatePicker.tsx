// ============================================
// 模板选择器组件
// ============================================
import { useState } from 'react';
import { ClipboardList, Plus } from 'lucide-react';
import { MIND_MAP_TEMPLATES, TEMPLATE_CATEGORIES, cloneTemplateData } from '../templates';
import type { MindMapTemplate } from '../templates';
import type { MindMapData } from '../types';

interface TemplatePickerProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (mapData: MindMapData) => void;
}

export const TemplatePicker: React.FC<TemplatePickerProps> = ({ isOpen, onClose, onSelect }) => {
    const [activeCategory, setActiveCategory] = useState<string>('all');
    const [hoveredTemplate, setHoveredTemplate] = useState<string | null>(null);

    if (!isOpen) return null;

    const filteredTemplates = activeCategory === 'all'
        ? MIND_MAP_TEMPLATES
        : MIND_MAP_TEMPLATES.filter(t => t.category === activeCategory);

    const handleSelect = (template: MindMapTemplate) => {
        const newMapData = cloneTemplateData(template);
        onSelect(newMapData);
        onClose();
    };

    return (
        <div className="template-picker-overlay" onClick={onClose}>
            <div className="template-picker-modal" onClick={e => e.stopPropagation()}>
                {/* 头部 */}
                <div className="template-picker-header">
                    <div className="header-title">
                        <ClipboardList size={20} className="title-icon" />
                        <h2>选择模板</h2>
                    </div>
                    <p className="header-desc">从专业模板快速开始，或用 AI 生成自定义结构</p>
                    <button className="close-btn" onClick={onClose}>
                        <span className="material-icons">close</span>
                    </button>
                </div>

                {/* 分类标签 */}
                <div className="template-categories">
                    <button
                        className={`category-btn ${activeCategory === 'all' ? 'active' : ''}`}
                        onClick={() => setActiveCategory('all')}
                    >
                        <span>🌟</span>
                        <span>全部</span>
                    </button>
                    {TEMPLATE_CATEGORIES.map(cat => (
                        <button
                            key={cat.id}
                            className={`category-btn ${activeCategory === cat.id ? 'active' : ''}`}
                            onClick={() => setActiveCategory(cat.id)}
                        >
                            <span>{cat.icon}</span>
                            <span>{cat.label}</span>
                        </button>
                    ))}
                </div>

                {/* 模板网格 */}
                <div className="template-grid">
                    {filteredTemplates.map(template => (
                        <div
                            key={template.id}
                            className={`template-card ${hoveredTemplate === template.id ? 'hovered' : ''}`}
                            onMouseEnter={() => setHoveredTemplate(template.id)}
                            onMouseLeave={() => setHoveredTemplate(null)}
                            onClick={() => handleSelect(template)}
                        >
                            <div className="template-icon">{template.icon}</div>
                            <div className="template-info">
                                <h3 className="template-name">{template.name}</h3>
                                <p className="template-desc">{template.description}</p>
                            </div>
                            <div className="template-preview">
                                {/* 简单的节点预览 */}
                                <div className="preview-nodes">
                                    {Object.values(template.data.nodes)
                                        .filter(n => n.parentId === template.data.rootId)
                                        .slice(0, 4)
                                        .map((node, i) => (
                                            <div
                                                key={node.id}
                                                className="preview-node"
                                                style={{ backgroundColor: node.color + '30', borderColor: node.color }}
                                            >
                                                {node.label.replace(/[📋🚀✅📊📖📝⭐💡🎯❓🔧👥⏰💪⚠️🛡️📌📅🎣🎥📱📢🎨]/g, '').slice(0, 6)}
                                            </div>
                                        ))}
                                </div>
                            </div>
                            <div className="template-hover-action">
                                <span className="material-icons">add_circle</span>
                                使用模板
                            </div>
                        </div>
                    ))}

                    {/* 空白模板 */}
                    <div
                        className="template-card blank-template"
                        onClick={() => {
                            const blankData: MindMapData = {
                                id: `map-${Date.now()}`,
                                name: '新思维导图',
                                rootId: 'root',
                                nodes: {
                                    'root': {
                                        id: 'root',
                                        label: '中心主题',
                                        color: '#8b5cf6',
                                        parentId: null,
                                        children: [],
                                    },
                                },
                                createdAt: Date.now(),
                                updatedAt: Date.now(),
                                sourceType: 'blank',
                            };
                            onSelect(blankData);
                            onClose();
                        }}
                    >
                        <Plus size={24} className="template-icon" />
                        <div className="template-info">
                            <h3 className="template-name">空白导图</h3>
                            <p className="template-desc">从零开始创建</p>
                        </div>
                    </div>
                </div>

                {/* 底部提示 */}
                <div className="template-picker-footer">
                    <span className="footer-tip">💡 提示：选择模板后可自由编辑所有内容</span>
                </div>
            </div>
        </div >
    );
};
