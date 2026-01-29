/**
 * Fusion Workspace Component
 * 灵感融合工作区 - 采用创艺魔盒 2 的 UI 风格
 * 
 * 使用水平标签页布局，与批量模式保持一致
 */

import React, { useState, useRef, useEffect } from 'react';
import { Palette, Sparkles, Plus } from 'lucide-react';
import { FusionItem, FusionRole, FusionResult, FusionChatMessage } from '../types';
import { PromptDisplay, Loader, FileUploader } from './shared';

interface FusionWorkspaceProps {
    fusionItems: FusionItem[];
    fusionResult: FusionResult | null;
    fusionChatHistory: FusionChatMessage[];
    fusionChatInput: string;
    extraInstruction: string;
    onAddImages: (files: File[]) => void;
    onUpdateItem: (id: string, updates: Partial<FusionItem>) => void;
    onRemoveItem: (id: string) => void;
    onFusionGenerate: () => Promise<void>;
    onFusionChat: () => Promise<void>;
    onChatInputChange: (value: string) => void;
    onExtraInstructionChange: (value: string) => void;
    isProcessing: boolean;
    t: (key: string) => string;
    onPaste?: (e: React.ClipboardEvent<HTMLTextAreaElement>) => void;
}

const ROLE_OPTIONS: { value: FusionRole; labelKey: string; emoji: string }[] = [
    { value: 'style', labelKey: 'roleStyle', emoji: '🎨' },
    { value: 'composition', labelKey: 'roleComposition', emoji: '📐' },
    { value: 'scene', labelKey: 'roleScene', emoji: '🏞️' },
    { value: 'character', labelKey: 'roleCharacter', emoji: '👤' },
    { value: 'inspiration', labelKey: 'roleInspiration', emoji: '💡' },
];

export const FusionWorkspace: React.FC<FusionWorkspaceProps> = ({
    fusionItems,
    fusionResult,
    fusionChatHistory,
    fusionChatInput,
    extraInstruction,
    onAddImages,
    onUpdateItem,
    onRemoveItem,
    onFusionGenerate,
    onFusionChat,
    onChatInputChange,
    onExtraInstructionChange,
    isProcessing,
    t,
    onPaste
}) => {
    const [activeItemId, setActiveItemId] = useState<string | null>(null);
    const chatContainerRef = useRef<HTMLDivElement>(null);

    const activeItem = fusionItems.find(item => item.id === activeItemId) || fusionItems[0];

    // 自动滚动到底部
    useEffect(() => {
        if (chatContainerRef.current) {
            chatContainerRef.current.scrollTop = chatContainerRef.current.scrollHeight;
        }
    }, [fusionChatHistory, fusionResult]);

    // 选中第一个项目
    useEffect(() => {
        if (fusionItems.length > 0 && !activeItemId) {
            setActiveItemId(fusionItems[0].id);
        } else if (fusionItems.length === 0) {
            setActiveItemId(null);
        }
    }, [fusionItems, activeItemId]);

    // 如果没有图片，显示上传区域
    if (!fusionItems || fusionItems.length === 0) {
        return (
            <div className="fusion-workspace fusion-empty">
                <FileUploader onFileSelect={(files) => onAddImages(files as File[])} multiple openOnClick={false} onPaste={onPaste}>
                    <div className="uploader-content">
                        <Palette size={48} className="text-primary" />
                        <h3>{t('fusionTitle') || '灵感融合'}</h3>
                        <p>{t('fusionDesc') || '添加多张参考图，为每张图指定角色，生成融合提示词'}</p>
                        <p className="mt-4 text-primary">双击选择图片、拖拽图片、或直接粘贴图片</p>
                        <p className="text-sm text-muted mt-2">支持从网页、谷歌表格等来源粘贴图片</p>
                    </div>
                </FileUploader>
            </div>
        );
    }

    // 有图片时，显示与批量模式一致的水平标签页布局
    return (
        <>
            {isProcessing && (
                <div className="global-loader">
                    <Loader />
                    <p>{t('processing') || '处理中...'}</p>
                </div>
            )}
            {/* 水平标签页 - 与批量模式一致 */}
            <div className="batch-prompt-tabs-container">
                <div className="batch-prompt-tabs">
                    {fusionItems.map((item) => (
                        <button
                            key={item.id}
                            onClick={() => setActiveItemId(item.id)}
                            className={`tab-btn ${item.id === (activeItemId || fusionItems[0]?.id) ? 'active' : ''}`}
                            disabled={isProcessing}
                        >
                            <img src={item.imageData.url} alt="thumbnail" />
                            <span className="tab-filename" title={item.imageData.name}>{item.imageData.name}</span>
                            <span className="role-badge" style={{
                                fontSize: '0.75rem',
                                padding: '2px 6px',
                                background: 'var(--primary-color)',
                                borderRadius: '4px',
                                marginLeft: '4px'
                            }}>
                                {item.role === 'style' && '🎨'}
                                {item.role === 'composition' && '📐'}
                                {item.role === 'scene' && '🏞️'}
                                {item.role === 'character' && '👤'}
                                {item.role === 'inspiration' && '💡'}
                            </span>
                            <button
                                className="delete-img-btn-tab"
                                onClick={(e) => { e.stopPropagation(); onRemoveItem(item.id); }}
                                title={t('deleteImage') || '删除图片'}
                                style={{
                                    marginLeft: '8px',
                                    background: 'transparent',
                                    border: 'none',
                                    color: 'var(--text-color)',
                                    opacity: 0.6,
                                    cursor: 'pointer',
                                    fontSize: '16px',
                                    padding: '0 4px',
                                    lineHeight: 1
                                }}
                                onMouseOver={(e) => e.currentTarget.style.opacity = '1'}
                                onMouseOut={(e) => e.currentTarget.style.opacity = '0.6'}
                            >×</button>
                        </button>
                    ))}
                    {/* 添加更多图片按钮 */}
                    <FileUploader onFileSelect={(files) => onAddImages(files as File[])} multiple openOnClick={false} onPaste={onPaste}>
                        <button type="button" className="tab-btn tab-btn-add" style={{ minWidth: 'auto', padding: '8px 16px', display: 'flex', alignItems: 'center', gap: '6px' }} title="双击选择图片，或直接粘贴图片（支持从谷歌表格等来源粘贴）">
                            ➕ <span>{t('addImage') || '添加/粘贴图片'}</span>
                        </button>
                    </FileUploader>
                    {/* 融合生成按钮 */}
                    <button
                        onClick={onFusionGenerate}
                        className="tab-btn tab-btn-export"
                        disabled={isProcessing || fusionItems.length < 1}
                        style={{ marginLeft: 'auto' }}
                    >
                        {isProcessing ? (t('processing') || '处理中...') : (t('fuse') || '✨ 融合生成')}
                    </button>
                </div>
            </div>

            {/* 内容区域：左图右文 */}
            <div className="image-chat-content">
                <div className="image-preview-wrapper-small">
                    {activeItem && <img src={activeItem.imageData.url} alt="Selected preview" />}
                    {/* 角色选择器 */}
                    {activeItem && (
                        <select
                            value={activeItem.role}
                            onChange={(e) => onUpdateItem(activeItem.id, { role: e.target.value as FusionRole })}
                            className="role-selector"
                            style={{ width: '100%', marginTop: '10px', padding: '8px', borderRadius: '6px' }}
                        >
                            <option value="style">🎨 {t('roleStyle') || '画风风格'}</option>
                            <option value="composition">📐 {t('roleComposition') || '构图布局'}</option>
                            <option value="scene">🏞️ {t('roleScene') || '场景环境'}</option>
                            <option value="character">👤 {t('roleCharacter') || '角色姿态'}</option>
                            <option value="inspiration">💡 {t('roleInspiration') || '灵感参考'}</option>
                        </select>
                    )}
                    {/* 额外指令输入 */}
                    <input
                        type="text"
                        value={extraInstruction}
                        onChange={(e) => onExtraInstructionChange(e.target.value)}
                        placeholder={t('extraInstructionPlaceholder') || '额外指令（可选）'}
                        style={{
                            width: '100%',
                            marginTop: '10px',
                            padding: '8px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color)',
                            background: 'var(--control-bg-color)',
                            color: 'var(--text-color)'
                        }}
                    />
                </div>
                <div className="output-area">
                    {/* 融合结果 */}
                    <div className="chat-container" ref={chatContainerRef}>
                        {fusionResult ? (
                            <>
                                <PromptDisplay title="Fused Prompt (English)" text={fusionResult.englishPrompt} />
                                <PromptDisplay title="融合提示词 (中文)" text={fusionResult.chinesePrompt} />
                                {/* 显示对话历史 */}
                                {fusionChatHistory?.map((msg, index) => (
                                    msg.sender === 'user' ? (
                                        <div key={index} className="chat-message user"><pre>{msg.text}</pre></div>
                                    ) : (
                                        <div key={index} className="chat-message model">
                                            <PromptDisplay title="修改后的提示词" text={msg.text} />
                                        </div>
                                    )
                                ))}
                            </>
                        ) : (
                            <div style={{ minHeight: '200px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--text-muted-color)' }}>
                                <div className="text-center">
                                    <p style={{ fontSize: '1.2rem', marginBottom: '0.5rem' }}>🎨 {t('fusionTitle') || '灵感融合'}</p>
                                    <p>{t('fusionDesc') || '添加多张参考图，为每张图指定角色，生成融合提示词'}</p>
                                    <p className="mt-4">点击右上角 "✨ 融合生成" 按钮开始</p>
                                </div>
                            </div>
                        )}
                        {isProcessing && <div className="chat-message model"><Loader /></div>}
                    </div>

                    {/* 对话输入框 - 仅在有结果时显示 */}
                    {fusionResult && (
                        <div className="chat-input">
                            <input
                                type="text"
                                value={fusionChatInput}
                                onChange={(e) => onChatInputChange(e.target.value)}
                                placeholder={t('chatPlaceholder') || '输入修改指令...'}
                                onKeyPress={(e) => e.key === 'Enter' && !isProcessing && onFusionChat()}
                                disabled={isProcessing}
                            />
                            <button
                                className="btn btn-primary"
                                onClick={onFusionChat}
                                disabled={isProcessing || !fusionChatInput.trim()}
                            >
                                {t('sendMessage') || '发送'}
                            </button>
                        </div>
                    )}
                </div>
            </div>
        </>
    );
};

export default FusionWorkspace;
