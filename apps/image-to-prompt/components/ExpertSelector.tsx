/**
 * Expert Selector Component
 * 专家选择器组件 - 支持多选
 */

import React from 'react';
import { ExpertKey, expertDescriptions } from '../types';

interface ExpertSelectorProps {
    selectedExperts: ExpertKey[];
    onExpertChange: (experts: ExpertKey[]) => void;
    disabled?: boolean;
}

const EXPERT_OPTIONS: ExpertKey[] = ['general', 'midjourney', 'dalle3', 'sd', 'flux', 'bing', 'whisk', 'dreamina'];

export const ExpertSelector: React.FC<ExpertSelectorProps> = ({
    selectedExperts,
    onExpertChange,
    disabled = false
}) => {
    const handleToggle = (expert: ExpertKey) => {
        if (disabled) return;

        if (selectedExperts.includes(expert)) {
            // 至少保留一个专家
            if (selectedExperts.length > 1) {
                onExpertChange(selectedExperts.filter(e => e !== expert));
            }
        } else {
            onExpertChange([...selectedExperts, expert]);
        }
    };

    return (
        <div className="expert-selector-multi">
            <label style={{
                display: 'block',
                marginBottom: '0.5rem',
                color: 'var(--text-color)',
                fontWeight: 500
            }}>
                1. 选择AI绘画专家模型 (可多选):
            </label>
            <div className="expert-options" style={{
                display: 'flex',
                flexWrap: 'wrap',
                gap: '8px'
            }}>
                {EXPERT_OPTIONS.map(expert => (
                    <div
                        key={expert}
                        className="expert-option"
                        className="flex items-center"
                    >
                        <input
                            id={`expert-${expert}`}
                            type="checkbox"
                            value={expert}
                            checked={selectedExperts.includes(expert)}
                            onChange={() => handleToggle(expert)}
                            disabled={disabled}
                            style={{ marginRight: '4px' }}
                        />
                        <label
                            htmlFor={`expert-${expert}`}
                            style={{
                                cursor: disabled ? 'not-allowed' : 'pointer',
                                opacity: disabled ? 0.5 : 1,
                                fontSize: '0.9rem'
                            }}
                            title={expertDescriptions[expert]}
                        >
                            {expert}
                        </label>
                    </div>
                ))}
            </div>
        </div>
    );
};

export default ExpertSelector;
