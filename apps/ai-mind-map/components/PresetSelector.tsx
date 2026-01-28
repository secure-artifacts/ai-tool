// ============================================
// AI 扩展预设选择器
// ============================================
import { useState } from 'react';
import { EXPAND_PRESETS, getPresetsByCategory } from '../presets/expandPresets';
import type { ExpandPreset } from '../presets/expandPresets';

interface PresetSelectorProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (preset: ExpandPreset) => void;
    targetNodeLabel: string;
}

export const PresetSelector: React.FC<PresetSelectorProps> = ({
    isOpen,
    onClose,
    onSelect,
    targetNodeLabel,
}) => {
    const [hoveredPreset, setHoveredPreset] = useState<string | null>(null);
    const categories = getPresetsByCategory();

    if (!isOpen) return null;

    return (
        <div className="preset-selector-overlay" onClick={onClose}>
            <div className="preset-selector-modal" onClick={e => e.stopPropagation()}>
                {/* 头部 */}
                <div className="preset-selector-header">
                    <div className="header-title">
                        <span className="title-icon">🧠</span>
                        <h2>AI 扩展模式</h2>
                    </div>
                    <p className="header-desc">
                        为「<strong>{targetNodeLabel}</strong>」选择扩展角度
                    </p>
                    <button className="close-btn" onClick={onClose}>
                        <span className="material-icons">close</span>
                    </button>
                </div>

                {/* 预设网格 */}
                <div className="preset-categories">
                    {Object.entries(categories).map(([key, category]) => (
                        <div key={key} className="preset-category">
                            <h3 className="category-title">{category.label}</h3>
                            <div className="preset-grid">
                                {category.presets.map(preset => (
                                    <button
                                        key={preset.id}
                                        className={`preset-card ${hoveredPreset === preset.id ? 'hovered' : ''}`}
                                        onMouseEnter={() => setHoveredPreset(preset.id)}
                                        onMouseLeave={() => setHoveredPreset(null)}
                                        onClick={() => {
                                            onSelect(preset);
                                            onClose();
                                        }}
                                    >
                                        <span className="preset-icon">{preset.icon}</span>
                                        <div className="preset-info">
                                            <span className="preset-name">{preset.name}</span>
                                            <span className="preset-desc">{preset.description}</span>
                                        </div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    ))}
                </div>

                {/* 底部提示 */}
                <div className="preset-selector-footer">
                    <span className="footer-tip">💡 选择不同的扩展模式，AI 会从该角度生成子节点</span>
                </div>
            </div>
        </div>
    );
};
