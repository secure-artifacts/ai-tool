// API 生图 - 历史侧边栏 (深色主题)
import React from 'react';
import { Trash2, Download, History, X } from 'lucide-react';
import { GeneratedImage } from '../types';
import { downloadImage } from '../services/imageGenService';

interface HistorySidebarProps {
    history: GeneratedImage[];
    onSelect: (image: GeneratedImage) => void;
    onDelete: (id: string) => void;
    onClear: () => void;
    selectedId?: string;
    isOpen: boolean;
    onClose: () => void;
}

export const HistorySidebar: React.FC<HistorySidebarProps> = ({
    history,
    onSelect,
    onDelete,
    onClear,
    selectedId,
    isOpen,
    onClose
}) => {
    if (!isOpen) return null;

    return (
        <div className="api-gen-history-overlay">
            {/* Backdrop */}
            <div className="api-gen-history-backdrop" onClick={onClose} />

            {/* Panel */}
            <div className="api-gen-history-panel">
                {/* Header */}
                <div className="api-gen-history-header">
                    <div className="api-gen-history-header-left">
                        <History size={18} />
                        <span>生成历史</span>
                        <span className="count">{history.length}</span>
                    </div>
                    <div className="api-gen-history-header-actions">
                        {history.length > 0 && (
                            <button onClick={onClear} className="danger" title="清空历史">
                                <Trash2 size={14} />
                            </button>
                        )}
                        <button onClick={onClose} title="关闭">
                            <X size={16} />
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div className="api-gen-history-content">
                    {history.length === 0 ? (
                        <div className="api-gen-empty">
                            <History size={48} />
                            <p>暂无历史记录</p>
                            <p className="hint">生成的图片会显示在这里</p>
                        </div>
                    ) : (
                        <div className="api-gen-history-grid">
                            {history.map((img) => (
                                <div
                                    key={img.id}
                                    className={`api-gen-history-item ${selectedId === img.id ? 'selected' : ''}`}
                                    onClick={() => onSelect(img)}
                                >
                                    <img
                                        src={img.url}
                                        alt={img.prompt}
                                        loading="lazy"
                                    />
                                    <div className="api-gen-history-item-overlay">
                                        <span className="api-gen-history-item-time">
                                            {new Date(img.timestamp).toLocaleString('zh-CN', {
                                                month: 'short',
                                                day: 'numeric',
                                                hour: '2-digit',
                                                minute: '2-digit'
                                            })}
                                        </span>
                                    </div>
                                    <div className="api-gen-history-item-actions">
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                downloadImage(img.url, `api-gen-${img.id}.png`);
                                            }}
                                            title="下载"
                                        >
                                            <Download size={12} />
                                        </button>
                                        <button
                                            onClick={(e) => {
                                                e.stopPropagation();
                                                onDelete(img.id);
                                            }}
                                            className="danger"
                                            title="删除"
                                        >
                                            <Trash2 size={12} />
                                        </button>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            </div>
        </div>
    );
};

export default HistorySidebar;
