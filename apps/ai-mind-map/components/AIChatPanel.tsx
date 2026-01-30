import React, { useState, useRef, useEffect, useCallback } from 'react';
import { useMindMapStore } from '../store/mindMapStore';
import { GeminiService } from '../services/geminiService';
import { getStoredApiKey, hasAiAccess } from '../services/aiAccess';
import { Send, Sparkles, Trash2, Copy, Check, Lightbulb, Wand2, ListTodo } from 'lucide-react';

interface ChatMessage {
    id: string;
    role: 'user' | 'assistant';
    content: string;
    timestamp: Date;
    isLoading?: boolean;
}

// 快捷指令
const QUICK_COMMANDS = [
    { icon: Lightbulb, label: '发散灵感', prompt: '请帮我围绕当前主题发散更多创意方向' },
    { icon: Wand2, label: '优化文案', prompt: '请帮我优化当前选中节点的文案，使其更有吸引力' },
    { icon: ListTodo, label: '拆解步骤', prompt: '请帮我把当前主题拆解为具体的执行步骤' },
];

export const AIChatPanel: React.FC = () => {
    const {
        currentMap,
        selectedNodeId,
        geminiApiKey,
        aiPlatform,
        aiGoal,
        aiAudience,
        aiScenario,
    } = useMindMapStore();

    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [inputValue, setInputValue] = useState('');
    const [isLoading, setIsLoading] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLTextAreaElement>(null);

    const envApiKey = (typeof import.meta !== 'undefined' && import.meta.env?.VITE_GEMINI_API_KEY) as string | undefined;
    const storedApiKey = getStoredApiKey();
    const apiKey = geminiApiKey || envApiKey || storedApiKey;
    const hasApiKey = hasAiAccess(apiKey);

    // 滚动到底部
    const scrollToBottom = useCallback(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, []);

    useEffect(() => {
        scrollToBottom();
    }, [messages, scrollToBottom]);

    // 获取当前上下文
    const getCurrentContext = useCallback(() => {
        if (!currentMap) return '';

        const parts: string[] = [];
        const rootNode = currentMap.nodes[currentMap.rootId];
        parts.push(`当前思维导图主题：${rootNode?.label || '未命名'}`);

        // 获取选中节点信息
        if (selectedNodeId) {
            const selectedNode = currentMap.nodes[selectedNodeId];
            if (selectedNode) {
                parts.push(`当前选中节点：${selectedNode.label}`);
                if (selectedNode.notes) {
                    parts.push(`节点备注：${selectedNode.notes}`);
                }
            }
        }

        // 获取思维导图结构摘要（使用上面已声明的 rootNode）
        if (rootNode) {
            const children = rootNode.children?.map(id => currentMap.nodes[id]?.label).filter(Boolean) || [];
            if (children.length > 0) {
                parts.push(`主要分支：${children.join('、')}`);
            }
        }

        // 平台约束
        if (aiPlatform) {
            const platformNames: Record<string, string> = {
                douyin: '抖音',
                kuaishou: '快手',
                xiaohongshu: '小红书',
                bilibili: 'B站',
            };
            parts.push(`目标平台：${platformNames[aiPlatform] || aiPlatform}`);
        }

        if (aiGoal) parts.push(`创作目标：${aiGoal}`);
        if (aiAudience) parts.push(`目标受众：${aiAudience}`);
        if (aiScenario) parts.push(`使用场景：${aiScenario}`);

        return parts.join('\n');
    }, [currentMap, selectedNodeId, aiPlatform, aiGoal, aiAudience, aiScenario]);

    // 发送消息
    const handleSend = async (customPrompt?: string) => {
        const prompt = customPrompt || inputValue.trim();
        if (!prompt || !hasApiKey) return;

        const userMessage: ChatMessage = {
            id: Date.now().toString(),
            role: 'user',
            content: prompt,
            timestamp: new Date(),
        };

        const loadingMessage: ChatMessage = {
            id: (Date.now() + 1).toString(),
            role: 'assistant',
            content: '',
            timestamp: new Date(),
            isLoading: true,
        };

        setMessages(prev => [...prev, userMessage, loadingMessage]);
        setInputValue('');
        setIsLoading(true);

        try {
            const service = new GeminiService(apiKey);
            const context = getCurrentContext();

            // 构建对话历史
            const historyForAI = messages
                .filter(m => !m.isLoading)
                .slice(-10) // 最近 10 条
                .map(m => `${m.role === 'user' ? '用户' : 'AI'}: ${m.content}`)
                .join('\n');

            const response = await service.chat(prompt, context, historyForAI);

            setMessages(prev =>
                prev.map(m =>
                    m.id === loadingMessage.id
                        ? { ...m, content: response, isLoading: false }
                        : m
                )
            );
        } catch (error) {
            console.error('Chat error:', error);
            setMessages(prev =>
                prev.map(m =>
                    m.id === loadingMessage.id
                        ? { ...m, content: '抱歉，发生错误，请重试。', isLoading: false }
                        : m
                )
            );
        } finally {
            setIsLoading(false);
        }
    };

    // 复制消息
    const handleCopy = (id: string, content: string) => {
        navigator.clipboard.writeText(content);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    // 清空对话
    const handleClear = () => {
        setMessages([]);
    };

    // 处理键盘事件
    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSend();
        }
    };

    return (
        <div className="ai-chat-panel">
            <div className="ai-chat-header">
                <div className="chat-title">
                    <Sparkles size={18} className="title-icon" />
                    <span>AI 创意搭子</span>
                </div>
                {messages.length > 0 && (
                    <button data-tip="清空对话" className="clear-btn tooltip-bottom" onClick={handleClear} >
                        <Trash2 size={16} />
                    </button>
                )}
            </div>

            <div className="ai-chat-messages">
                {messages.length === 0 ? (
                    <div className="chat-empty">
                        <div className="empty-icon">💬</div>
                        <h3>开始创意对话</h3>
                        <p>像 ChatGPT 一样，与 AI 一起迭代你的创意</p>
                        <div className="quick-commands">
                            {QUICK_COMMANDS.map((cmd, idx) => {
                                const Icon = cmd.icon;
                                return (
                                    <button
                                        key={idx}
                                        className="quick-cmd-btn"
                                        onClick={() => handleSend(cmd.prompt)}
                                        disabled={isLoading}
                                    >
                                        <Icon size={16} />
                                        <span>{cmd.label}</span>
                                    </button>
                                );
                            })}
                        </div>
                    </div>
                ) : (
                    messages.map(msg => (
                        <div key={msg.id} className={`chat-message ${msg.role}`}>
                            <div className="message-avatar">
                                {msg.role === 'user' ? '👤' : '✨'}
                            </div>
                            <div className="message-content">
                                {msg.isLoading ? (
                                    <div className="typing-indicator">
                                        <span></span>
                                        <span></span>
                                        <span></span>
                                    </div>
                                ) : (
                                    <>
                                        <div className="message-text">{msg.content}</div>
                                        {msg.role === 'assistant' && (
                                            <button
                                                className="copy-btn"
                                                onClick={() => handleCopy(msg.id, msg.content)}
                                            >
                                                {copiedId === msg.id ? (
                                                    <Check size={14} />
                                                ) : (
                                                    <Copy size={14} />
                                                )}
                                            </button>
                                        )}
                                    </>
                                )}
                            </div>
                        </div>
                    ))
                )}
                <div ref={messagesEndRef} />
            </div>

            <div className="ai-chat-input">
                <textarea
                    ref={inputRef}
                    value={inputValue}
                    onChange={e => setInputValue(e.target.value)}
                    onKeyDown={handleKeyDown}
                    placeholder="输入你的想法，或点击快捷指令..."
                    disabled={isLoading || !hasApiKey}
                    rows={1}
                />
                <button
                    className="send-btn"
                    onClick={() => handleSend()}
                    disabled={!inputValue.trim() || isLoading || !hasApiKey}
                >
                    <Send size={18} />
                </button>
            </div>

            {!hasApiKey && (
                <div className="no-api-warning">
                    请先在主工具箱设置 API 密钥
                </div>
            )}
        </div>
    );
};
