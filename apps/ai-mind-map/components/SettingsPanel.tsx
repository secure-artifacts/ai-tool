import React from 'react';

export const SettingsPanel: React.FC = () => {
    const hasMainAppAi = Boolean((window as any).__mindMapGetAiInstance);

    return (
        <div className="settings-panel">
            <div className="settings-header">
                <h3>⚙️ 设置</h3>
            </div>
            <div className="settings-content">
                <div className="setting-group">
                    <label className="setting-label">
                        <span className="label-text">AI 服务状态</span>
                    </label>
                    <div className="api-status" style={{
                        padding: '12px',
                        borderRadius: '8px',
                        background: hasMainAppAi ? 'rgba(34, 197, 94, 0.1)' : 'rgba(239, 68, 68, 0.1)',
                        border: `1px solid ${hasMainAppAi ? 'rgba(34, 197, 94, 0.3)' : 'rgba(239, 68, 68, 0.3)'}`,
                        color: hasMainAppAi ? '#22c55e' : '#ef4444',
                        fontSize: '0.875rem'
                    }}>
                        {hasMainAppAi ? (
                            <span>✅ 已连接主应用 AI 服务</span>
                        ) : (
                            <span>⚠️ 未连接 AI 服务，请在主工具箱中设置 API Key</span>
                        )}
                    </div>
                    <p className="api-key-help" style={{ marginTop: '8px', fontSize: '0.75rem', color: 'var(--color-text-muted)' }}>
                        思维导图模块使用主工具箱的 API 密钥设置，无需单独配置。
                    </p>
                </div>

                <div className="setting-group">
                    <label className="setting-label">
                        <span className="label-text">快捷键</span>
                    </label>
                    <div className="shortcuts-list">
                        <div className="shortcut">
                            <kbd>Tab</kbd>
                            <span>添加子节点</span>
                        </div>
                        <div className="shortcut">
                            <kbd>Enter</kbd>
                            <span>添加同级节点</span>
                        </div>
                        <div className="shortcut">
                            <kbd>Delete</kbd>
                            <span>删除选中节点</span>
                        </div>
                        <div className="shortcut">
                            <kbd>⌘ + S</kbd>
                            <span>保存思维导图</span>
                        </div>
                        <div className="shortcut">
                            <kbd>⌘ + E</kbd>
                            <span>导出</span>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
