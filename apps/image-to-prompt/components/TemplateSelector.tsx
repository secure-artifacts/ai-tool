/**
 * Template Selector Component
 * 模板选择器组件 - 用于选择反推指令模板
 */

import React, { useState } from 'react';
import { Preset } from '../types';

interface TemplateSelectorProps {
    presets: Preset[];
    selectedId: string;
    onSelect: (id: string) => void;
    onViewSystemInstruction?: () => void;
    t: (key: string) => string;
}

export const TemplateSelector: React.FC<TemplateSelectorProps> = ({
    presets,
    selectedId,
    onSelect,
    onViewSystemInstruction,
    t
}) => {
    return (
        <div className="expert-selector-multi" style={{ marginTop: '1rem' }}>
            <div style={{
                display: 'flex',
                justifyContent: 'space-between',
                alignItems: 'center',
                marginBottom: '0.5rem'
            }}>
                <label style={{ marginBottom: 0, fontWeight: 500 }}>
                    {t('templateLabel') || '反推指令模版'}{' '}
                    <span style={{
                        fontSize: '0.85em',
                        color: 'var(--text-muted-color)',
                        fontWeight: 'normal'
                    }}>
                        (可选自定义)
                    </span>
                </label>
                {onViewSystemInstruction && (
                    <button
                        className="btn btn-secondary btn-sm"
                        onClick={onViewSystemInstruction}
                        style={{ padding: '2px 8px', fontSize: '0.8rem' }}
                    >
                        {t('viewSystemInstruction') || '查看系统指令'}
                    </button>
                )}
            </div>
            <select
                value={selectedId}
                onChange={(e) => onSelect(e.target.value)}
                style={{
                    width: '100%',
                    padding: '0.5rem',
                    borderRadius: '4px',
                    border: '1px solid var(--border-color)',
                    backgroundColor: 'var(--control-bg-color)',
                    color: 'var(--text-color)',
                    cursor: 'pointer'
                }}
            >
                <option value="system_default">{t('systemDefault') || '系统默认'}</option>
                <option value="manual_input">{t('manualInput') || '手动输入 (自定义)'}</option>
                {presets.map(preset => (
                    <option key={preset.id} value={preset.id}>
                        {preset.label}
                    </option>
                ))}
            </select>
            <div style={{
                fontSize: '0.85rem',
                color: 'var(--text-muted-color)',
                marginTop: '0.5rem'
            }}>
                {selectedId === 'system_default'
                    ? (t('systemDefaultDesc') || '使用系统内置的反推指令')
                    : selectedId === 'manual_input'
                        ? (t('manualInputDesc') || '在下方输入自定义指令')
                        : (t('customPresetDesc') || '使用选中的自定义预设')
                }
            </div>
        </div>
    );
};

export default TemplateSelector;
