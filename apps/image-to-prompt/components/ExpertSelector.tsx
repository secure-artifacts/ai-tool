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
            <label className="expert-selector-label">
                1. 选择AI绘画专家模型 (可多选):
            </label>
            <div className="expert-options">
                {EXPERT_OPTIONS.map(expert => (
                    <div
                        key={expert}
                        className="expert-option flex items-center"
                    >
                        <input
                            id={`expert-${expert}`}
                            type="checkbox"
                            value={expert}
                            checked={selectedExperts.includes(expert)}
                            onChange={() => handleToggle(expert)}
                            disabled={disabled}
                            className="mr-1"
                        />
                        <label
                            htmlFor={`expert-${expert}`}
                            className={`expert-option-label ${disabled ? 'disabled' : ''}`}
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
