// API 生图 - 图片预览面板 (深色主题)
import React, { useState } from 'react';
import { Download, Copy, Check, X, ZoomIn, ZoomOut, Maximize2 } from 'lucide-react';
import { GeneratedImage } from '../types';
import { downloadImage } from '../services/imageGenService';

interface ImagePreviewPanelProps {
    image: GeneratedImage | null;
    onClose: () => void;
}

export const ImagePreviewPanel: React.FC<ImagePreviewPanelProps> = ({ image, onClose }) => {
    const [copied, setCopied] = useState(false);
    const [zoom, setZoom] = useState(1);

    if (!image) return null;

    const handleDownload = () => {
        downloadImage(image.url, `api-gen-${image.id}.png`);
    };

    const handleCopy = async () => {
        try {
            const response = await fetch(image.url);
            const blob = await response.blob();
            await navigator.clipboard.write([new ClipboardItem({ [blob.type]: blob })]);
            setCopied(true);
            setTimeout(() => setCopied(false), 2000);
        } catch (err) {
            console.error("Failed to copy", err);
        }
    };

    const handleCopyPrompt = () => {
        navigator.clipboard.writeText(image.prompt);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div className="api-gen-preview-overlay">
            {/* Backdrop */}
            <div className="api-gen-preview-backdrop" onClick={onClose} />

            {/* Content */}
            <div className="api-gen-preview-container">
                {/* Controls */}
                <div className="api-gen-preview-controls">
                    <div className="api-gen-preview-zoom">
                        <button
                            onClick={() => setZoom(z => Math.max(0.5, z - 0.25))}
                            className="api-gen-btn ghost icon-only"
                            title="缩小"
                        >
                            <ZoomOut size={16} />
                        </button>
                        <span>{Math.round(zoom * 100)}%</span>
                        <button
                            onClick={() => setZoom(z => Math.min(3, z + 0.25))}
                            className="api-gen-btn ghost icon-only"
                            title="放大"
                        >
                            <ZoomIn size={16} />
                        </button>
                        <button
                            onClick={() => setZoom(1)}
                            className="api-gen-btn ghost icon-only"
                            title="重置"
                        >
                            <Maximize2 size={16} />
                        </button>
                    </div>

                    <div className="api-gen-preview-actions">
                        <button onClick={handleCopy} className="api-gen-btn ghost" title="复制图片">
                            {copied ? <Check size={16} style={{ color: '#4ade80' }} /> : <Copy size={16} />}
                            复制图片
                        </button>
                        <button onClick={handleDownload} className="api-gen-btn primary" title="下载">
                            <Download size={16} />
                            下载
                        </button>
                        <button onClick={onClose} className="api-gen-btn ghost icon-only" title="关闭">
                            <X size={18} />
                        </button>
                    </div>
                </div>

                {/* Image */}
                <div className="api-gen-preview-image-wrapper">
                    <img
                        src={image.url}
                        alt={image.prompt}
                        style={{ transform: `scale(${zoom})`, transformOrigin: 'center' }}
                    />
                </div>

                {/* Info */}
                <div className="api-gen-preview-info">
                    <div className="api-gen-preview-info-prompt">
                        <div style={{ flex: 1 }}>
                            <label>提示词</label>
                            <p>{image.promptZh || image.prompt}</p>
                        </div>
                        <button
                            onClick={handleCopyPrompt}
                            className="api-gen-btn ghost icon-only"
                            title="复制提示词"
                        >
                            <Copy size={14} />
                        </button>
                    </div>
                    <div className="api-gen-preview-info-meta">
                        <span>模型: {image.model}</span>
                        <span>尺寸: {image.size}</span>
                        <span>{new Date(image.timestamp).toLocaleString('zh-CN')}</span>
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ImagePreviewPanel;
