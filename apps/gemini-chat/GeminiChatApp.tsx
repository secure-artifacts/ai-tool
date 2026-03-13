/**
 * Gemini Chat – 完整多轮对话模块
 *
 * 功能：
 * - 经典聊天布局：左侧可折叠对话列表 + 右侧聊天区域
 * - 对话记忆：使用 @google/genai 的 contents 维护多轮上下文
 * - 流式输出：generateContentStream 实时打字效果
 * - Markdown 渲染：代码块、表格、列表等
 * - 模型选择：支持多种 Gemini 模型
 * - 图片支持：粘贴/上传图片
 * - 自定义系统提示词 + 预设模板
 * - localStorage 持久化
 */
import React, {
    useState, useRef, useCallback, useEffect, useMemo, memo,
} from 'react';
import { v4 as uuidv4 } from 'uuid';
import ReactMarkdown from 'react-markdown';
import {
    MessageSquare, Plus, Trash2, Send, Image, Settings2,
    ChevronLeft, ChevronRight, Loader2, Copy, Check, X,
    Sparkles, RotateCcw, PanelLeftClose, PanelLeftOpen,
    Bot, User, Pencil, Download, ChevronDown, Eraser, Upload,
} from 'lucide-react';

// ====== Types ======
interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    images?: string[]; // base64 data URLs
    timestamp: number;
}

interface Conversation {
    id: string;
    title: string;
    messages: ChatMessage[];
    model: string;
    systemPrompt: string;
    createdAt: number;
    updatedAt: number;
}

interface Props {
    getAiInstance: () => any;
}

// ====== Constants ======
const STORAGE_KEY = 'gemini_chat_conversations';

const MODEL_OPTIONS = [
    { value: 'gemini-3.1-flash-lite-preview', label: 'Gemini 3.1 Flash Lite (最新)' },
    { value: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash' },
    { value: 'gemini-2.5-pro', label: 'Gemini 2.5 Pro' },
    { value: 'gemini-3-flash-preview', label: 'Gemini 3 Flash' },
    { value: 'gemini-3-pro-preview', label: 'Gemini 3 Pro' },
];

const SYSTEM_PROMPT_TEMPLATES = [
    { label: '默认助手', value: 'You are a helpful, creative, and knowledgeable AI assistant. Respond in the same language the user uses.' },
    { label: '中文助手', value: '你是一个友好、专业的中文 AI 助手。请始终用中文回复，保持简洁清晰。' },
    { label: '编程专家', value: 'You are an expert programmer. Provide clear, well-commented code with explanations. Use markdown code blocks with proper language tags.' },
    { label: '翻译官', value: 'You are a professional translator. If the user writes in Chinese, translate to English. If in English, translate to Chinese. Provide natural, fluent translations.' },
    { label: '文案写手', value: '你是一位资深文案创作者。擅长写吸引人的标题、广告文案和社交媒体内容。请根据用户需求创作高质量文案。' },
    { label: '自定义', value: '' },
];

/** 构建带有当前时间上下文的系统提示词（官方 Gemini 也会注入这些信息） */
function buildSystemPrompt(customPrompt: string): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric',
        weekday: 'long',
    });
    const timeStr = now.toLocaleTimeString('zh-CN', {
        hour: '2-digit', minute: '2-digit',
    });
    const contextLine = `Current date and time: ${dateStr} ${timeStr}. User timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
    const base = customPrompt || SYSTEM_PROMPT_TEMPLATES[0].value;
    return `${base}\n\n${contextLine}`;
}

// ====== Helpers ======
function loadConversations(): Conversation[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        if (!raw) return [];
        return JSON.parse(raw);
    } catch { return []; }
}

function saveConversations(convs: Conversation[]) {
    try {
        // Only keep the last 50 conversations to avoid quota issues
        const trimmed = convs.slice(0, 50);
        localStorage.setItem(STORAGE_KEY, JSON.stringify(trimmed));
    } catch (e) {
        console.warn('[GeminiChat] Failed to save to localStorage:', e);
    }
}

function generateTitle(firstMsg: string): string {
    const clean = firstMsg.replace(/\n/g, ' ').trim();
    if (clean.length <= 30) return clean || '新对话';
    return clean.substring(0, 30) + '…';
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const isToday = d.toDateString() === now.toDateString();
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    const isYesterday = d.toDateString() === yesterday.toDateString();
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (isToday) return time;
    if (isYesterday) return `昨天 ${time}`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + time;
}

// ====== Code Block with copy ======
const CodeBlock = memo(({ children, className }: { children: React.ReactNode; className?: string }) => {
    const [copied, setCopied] = useState(false);
    const language = className?.replace('language-', '') || '';
    const code = String(children).replace(/\n$/, '');

    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };

    return (
        <div style={{
            position: 'relative', borderRadius: '8px', overflow: 'hidden',
            margin: '8px 0', background: '#1e1e2e', border: '1px solid #313244',
        }}>
            <div style={{
                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                padding: '4px 12px', background: '#181825', fontSize: '11px', color: '#6c7086',
            }}>
                <span>{language || 'code'}</span>
                <button onClick={handleCopy} style={{
                    background: 'none', border: 'none', cursor: 'pointer', color: '#6c7086',
                    display: 'flex', alignItems: 'center', gap: '4px', fontSize: '11px',
                    padding: '2px 6px', borderRadius: '4px', transition: 'all 0.15s',
                }}>
                    {copied ? <><Check size={12} /> 已复制</> : <><Copy size={12} /> 复制</>}
                </button>
            </div>
            <pre style={{
                margin: 0, padding: '12px 16px', overflow: 'auto', fontSize: '13px',
                lineHeight: '1.6', color: '#cdd6f4', fontFamily: "'JetBrains Mono', 'Fira Code', monospace",
            }}>
                <code>{code}</code>
            </pre>
        </div>
    );
});

// ====== Main Component ======
const GeminiChatApp: React.FC<Props> = ({ getAiInstance }) => {
    // State
    const [conversations, setConversations] = useState<Conversation[]>(() => loadConversations());
    const [activeConvId, setActiveConvId] = useState<string | null>(() => {
        const convs = loadConversations();
        return convs.length > 0 ? convs[0].id : null;
    });
    const [inputText, setInputText] = useState('');
    const [pendingImages, setPendingImages] = useState<string[]>([]);
    const [isStreaming, setIsStreaming] = useState(false);
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [showSettings, setShowSettings] = useState(false);
    const [selectedModel, setSelectedModel] = useState('gemini-2.5-flash');
    const [systemPrompt, setSystemPrompt] = useState(SYSTEM_PROMPT_TEMPLATES[0].value);
    const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);
    const [editingTitle, setEditingTitle] = useState<string | null>(null);
    const [editTitleValue, setEditTitleValue] = useState('');
    const [streamingText, setStreamingText] = useState('');

    // Refs
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const fileInputRef = useRef<HTMLInputElement>(null);
    const abortRef = useRef(false);

    // Derived
    const activeConv = useMemo(
        () => conversations.find(c => c.id === activeConvId) || null,
        [conversations, activeConvId]
    );

    // Persist
    useEffect(() => {
        saveConversations(conversations);
    }, [conversations]);

    // Auto scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeConv?.messages, streamingText]);

    // Auto resize textarea
    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    }, [inputText]);

    // ====== Conversation Management ======
    const createConversation = useCallback(() => {
        const conv: Conversation = {
            id: uuidv4(),
            title: '新对话',
            messages: [],
            model: selectedModel,
            systemPrompt,
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        setConversations(prev => [conv, ...prev]);
        setActiveConvId(conv.id);
        setInputText('');
        setPendingImages([]);
        setShowSettings(false);
        setTimeout(() => textareaRef.current?.focus(), 100);
    }, [selectedModel, systemPrompt]);

    const deleteConversation = useCallback((id: string) => {
        setConversations(prev => prev.filter(c => c.id !== id));
        if (activeConvId === id) {
            setConversations(prev => {
                setActiveConvId(prev.length > 0 ? prev[0].id : null);
                return prev;
            });
        }
    }, [activeConvId]);

    const clearAllConversations = useCallback(() => {
        if (!confirm('确定清空所有对话记录？')) return;
        setConversations([]);
        setActiveConvId(null);
    }, []);

    const renameConversation = useCallback((id: string, title: string) => {
        setConversations(prev => prev.map(c => c.id === id ? { ...c, title } : c));
        setEditingTitle(null);
    }, []);

    // ====== Image handling ======
    const addImageFromFile = useCallback((file: File) => {
        if (!file.type.startsWith('image/')) return;
        const reader = new FileReader();
        reader.onload = () => {
            const dataUrl = reader.result as string;
            setPendingImages(prev => [...prev, dataUrl]);
        };
        reader.readAsDataURL(file);
    }, []);

    const handlePaste = useCallback((e: React.ClipboardEvent) => {
        const items = e.clipboardData.items;
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                e.preventDefault();
                const file = items[i].getAsFile();
                if (file) addImageFromFile(file);
                return;
            }
        }
    }, [addImageFromFile]);

    const handleDrop = useCallback((e: React.DragEvent) => {
        e.preventDefault();
        const files = e.dataTransfer.files;
        for (let i = 0; i < files.length; i++) {
            if (files[i].type.startsWith('image/')) {
                addImageFromFile(files[i]);
            }
        }
    }, [addImageFromFile]);

    // ====== Send Message ======
    const sendMessage = useCallback(async () => {
        const text = inputText.trim();
        if (!text && pendingImages.length === 0) return;
        if (isStreaming) return;

        let convId = activeConvId;
        let conv = activeConv;

        // If no active conversation, create one
        if (!conv) {
            const newConv: Conversation = {
                id: uuidv4(),
                title: '新对话',
                messages: [],
                model: selectedModel,
                systemPrompt,
                createdAt: Date.now(),
                updatedAt: Date.now(),
            };
            convId = newConv.id;
            conv = newConv;
            setConversations(prev => [newConv, ...prev]);
            setActiveConvId(newConv.id);
        }

        // Create user message
        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            text,
            images: pendingImages.length > 0 ? [...pendingImages] : undefined,
            timestamp: Date.now(),
        };

        // Update title if first message
        const isFirst = conv.messages.length === 0;
        const newTitle = isFirst ? generateTitle(text) : conv.title;

        // Add user message to conversation
        setConversations(prev => prev.map(c =>
            c.id === convId ? {
                ...c,
                messages: [...c.messages, userMsg],
                title: newTitle,
                updatedAt: Date.now(),
            } : c
        ));
        setInputText('');
        setPendingImages([]);
        setIsStreaming(true);
        setStreamingText('');
        abortRef.current = false;

        try {
            const ai = getAiInstance();

            // Build contents array for multi-turn
            const allMessages = [...conv.messages, userMsg];
            const contents = allMessages.map(msg => {
                const parts: any[] = [];
                if (msg.images) {
                    msg.images.forEach(img => {
                        const [meta, data] = img.split(',');
                        const mimeMatch = meta.match(/data:(.*?);/);
                        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                        parts.push({ inlineData: { data, mimeType } });
                    });
                }
                if (msg.text) {
                    parts.push({ text: msg.text });
                }
                return { role: msg.role, parts };
            });

            // Stream response（启用 Google Search 联网 + 注入当前时间）
            const responseStream = await ai.models.generateContentStream({
                model: conv.model || selectedModel,
                contents,
                config: {
                    systemInstruction: buildSystemPrompt(conv.systemPrompt || systemPrompt),
                    temperature: 0.7,
                    tools: [{ googleSearch: {} }],
                },
            });

            let fullText = '';
            for await (const chunk of responseStream) {
                if (abortRef.current) break;
                if (chunk.text) {
                    fullText += chunk.text;
                    setStreamingText(fullText);
                }
            }

            // Save assistant message
            const assistantMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: fullText,
                timestamp: Date.now(),
            };

            setConversations(prev => prev.map(c =>
                c.id === convId ? {
                    ...c,
                    messages: [...c.messages, assistantMsg],
                    updatedAt: Date.now(),
                } : c
            ));
        } catch (err: any) {
            console.error('[GeminiChat] Error:', err);
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: `❌ 错误: ${err.message || '请求失败，请重试'}`,
                timestamp: Date.now(),
            };
            setConversations(prev => prev.map(c =>
                c.id === convId ? {
                    ...c,
                    messages: [...c.messages, errorMsg],
                    updatedAt: Date.now(),
                } : c
            ));
        } finally {
            setIsStreaming(false);
            setStreamingText('');
        }
    }, [inputText, pendingImages, isStreaming, activeConvId, activeConv, selectedModel, systemPrompt, getAiInstance]);

    // ====== Stop streaming ======
    const stopStreaming = useCallback(() => {
        abortRef.current = true;
    }, []);

    // ====== Regenerate last response ======
    const regenerateLastResponse = useCallback(async () => {
        if (!activeConv || activeConv.messages.length < 2) return;
        if (isStreaming) return;

        // Remove last assistant message
        const msgs = [...activeConv.messages];
        if (msgs[msgs.length - 1].role === 'model') {
            msgs.pop();
        }

        setConversations(prev => prev.map(c =>
            c.id === activeConvId ? { ...c, messages: msgs, updatedAt: Date.now() } : c
        ));

        // Re-send
        setIsStreaming(true);
        setStreamingText('');
        abortRef.current = false;

        try {
            const ai = getAiInstance();
            const contents = msgs.map(msg => {
                const parts: any[] = [];
                if (msg.images) {
                    msg.images.forEach(img => {
                        const [meta, data] = img.split(',');
                        const mimeMatch = meta.match(/data:(.*?);/);
                        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';
                        parts.push({ inlineData: { data, mimeType } });
                    });
                }
                if (msg.text) parts.push({ text: msg.text });
                return { role: msg.role, parts };
            });

            const responseStream = await ai.models.generateContentStream({
                model: activeConv.model || selectedModel,
                contents,
                config: {
                    systemInstruction: buildSystemPrompt(activeConv.systemPrompt || systemPrompt),
                    temperature: 0.7,
                    tools: [{ googleSearch: {} }],
                },
            });

            let fullText = '';
            for await (const chunk of responseStream) {
                if (abortRef.current) break;
                if (chunk.text) {
                    fullText += chunk.text;
                    setStreamingText(fullText);
                }
            }

            const assistantMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: fullText,
                timestamp: Date.now(),
            };

            setConversations(prev => prev.map(c =>
                c.id === activeConvId ? {
                    ...c,
                    messages: [...msgs, assistantMsg],
                    updatedAt: Date.now(),
                } : c
            ));
        } catch (err: any) {
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: `❌ 错误: ${err.message || '请求失败'}`,
                timestamp: Date.now(),
            };
            setConversations(prev => prev.map(c =>
                c.id === activeConvId ? {
                    ...c,
                    messages: [...msgs, errorMsg],
                    updatedAt: Date.now(),
                } : c
            ));
        } finally {
            setIsStreaming(false);
            setStreamingText('');
        }
    }, [activeConv, activeConvId, isStreaming, selectedModel, systemPrompt, getAiInstance]);

    // ====== Copy message ======
    const copyMessage = useCallback((msgId: string, text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedMsgId(msgId);
        setTimeout(() => setCopiedMsgId(null), 2000);
    }, []);

    // ====== Export conversation ======
    const exportConversation = useCallback(() => {
        if (!activeConv) return;
        const text = activeConv.messages.map(m =>
            `${m.role === 'user' ? '👤 用户' : '🤖 AI'} [${formatTime(m.timestamp)}]\n${m.text}`
        ).join('\n\n---\n\n');
        const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${activeConv.title}.txt`;
        a.click();
        URL.revokeObjectURL(url);
    }, [activeConv]);

    // ====== Export ALL conversations (JSON backup) ======
    const exportAllConversations = useCallback(() => {
        if (conversations.length === 0) return;
        const data = {
            exportedAt: new Date().toISOString(),
            version: 1,
            conversations,
        };
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `gemini-chat-backup-${new Date().toISOString().slice(0, 10)}.json`;
        a.click();
        URL.revokeObjectURL(url);
    }, [conversations]);

    // ====== Import conversations (restore from JSON) ======
    const importConversations = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result as string);
                let imported: Conversation[] = [];
                // Support both raw array and wrapped format
                if (Array.isArray(data)) {
                    imported = data;
                } else if (data.conversations && Array.isArray(data.conversations)) {
                    imported = data.conversations;
                } else {
                    alert('无效的备份文件格式');
                    return;
                }
                // Merge: skip duplicates by id
                const existingIds = new Set(conversations.map(c => c.id));
                const newOnes = imported.filter(c => !existingIds.has(c.id));
                if (newOnes.length === 0) {
                    alert(`文件中的 ${imported.length} 条对话全部已存在，无需导入。`);
                    return;
                }
                setConversations(prev => [...newOnes, ...prev]);
                alert(`成功导入 ${newOnes.length} 条对话！（跳过 ${imported.length - newOnes.length} 条已存在的）`);
            } catch (err) {
                alert('解析备份文件失败，请确认是有效的 JSON 文件。');
            }
        };
        reader.readAsText(file);
        // Reset so the same file can be re-imported
        e.target.value = '';
    }, [conversations]);

    // ====== Key handler（兼容中文输入法 IME） ======
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        // 输入法正在组合（如拼音选字）时，忽略 Enter
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }, [sendMessage]);

    // ====== Markdown components ======
    const markdownComponents = useMemo(() => ({
        code: ({ className, children, ...props }: any) => {
            const isBlock = className || String(children).includes('\n');
            if (isBlock) {
                return <CodeBlock className={className}>{children}</CodeBlock>;
            }
            return (
                <code style={{
                    background: 'rgba(139,92,246,0.15)', padding: '1px 6px',
                    borderRadius: '4px', fontSize: '0.9em', color: '#c4b5fd',
                }} {...props}>{children}</code>
            );
        },
        p: ({ children }: any) => <p style={{ margin: '0 0 8px', lineHeight: '1.7' }}>{children}</p>,
        ul: ({ children }: any) => <ul style={{ margin: '4px 0 8px', paddingLeft: '20px' }}>{children}</ul>,
        ol: ({ children }: any) => <ol style={{ margin: '4px 0 8px', paddingLeft: '20px' }}>{children}</ol>,
        li: ({ children }: any) => <li style={{ margin: '2px 0', lineHeight: '1.6' }}>{children}</li>,
        h1: ({ children }: any) => <h1 style={{ fontSize: '1.3em', margin: '12px 0 6px', fontWeight: 700, color: '#e2e8f0' }}>{children}</h1>,
        h2: ({ children }: any) => <h2 style={{ fontSize: '1.15em', margin: '10px 0 5px', fontWeight: 600, color: '#e2e8f0' }}>{children}</h2>,
        h3: ({ children }: any) => <h3 style={{ fontSize: '1.05em', margin: '8px 0 4px', fontWeight: 600, color: '#e2e8f0' }}>{children}</h3>,
        blockquote: ({ children }: any) => (
            <blockquote style={{
                borderLeft: '3px solid #a78bfa', margin: '8px 0', padding: '4px 12px',
                background: 'rgba(139,92,246,0.08)', borderRadius: '0 6px 6px 0', color: '#a1a1aa',
            }}>{children}</blockquote>
        ),
        table: ({ children }: any) => (
            <div style={{ overflow: 'auto', margin: '8px 0' }}>
                <table style={{
                    borderCollapse: 'collapse', width: '100%', fontSize: '13px',
                }}>{children}</table>
            </div>
        ),
        th: ({ children }: any) => (
            <th style={{
                border: '1px solid #3f3f46', padding: '6px 10px', background: '#27272a',
                textAlign: 'left', fontWeight: 600, color: '#e2e8f0',
            }}>{children}</th>
        ),
        td: ({ children }: any) => (
            <td style={{
                border: '1px solid #3f3f46', padding: '6px 10px', color: '#d4d4d8',
            }}>{children}</td>
        ),
        a: ({ children, href }: any) => (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{
                color: '#818cf8', textDecoration: 'underline',
            }}>{children}</a>
        ),
        hr: () => <hr style={{ border: 'none', borderTop: '1px solid #3f3f46', margin: '12px 0' }} />,
    }), []);

    // ====== Render ======
    return (
        <div style={{
            display: 'flex', height: '100%', width: '100%',
            background: '#09090b', color: '#e4e4e7', fontFamily: "'Inter', system-ui, sans-serif",
            overflow: 'hidden',
        }}>
            {/* ====== Sidebar ====== */}
            <div style={{
                width: sidebarOpen ? '280px' : '0px',
                minWidth: sidebarOpen ? '280px' : '0px',
                transition: 'all 0.25s cubic-bezier(0.4, 0, 0.2, 1)',
                background: '#0c0c0f',
                borderRight: sidebarOpen ? '1px solid #1f1f23' : 'none',
                display: 'flex', flexDirection: 'column',
                overflow: 'hidden',
            }}>
                {/* Sidebar header */}
                <div style={{
                    padding: '14px 12px', display: 'flex', alignItems: 'center', gap: '8px',
                    borderBottom: '1px solid #1f1f23',
                }}>
                    <button onClick={createConversation} style={{
                        flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: '6px', padding: '8px', borderRadius: '8px', border: '1px solid #27272a',
                        background: 'rgba(139,92,246,0.08)', color: '#a78bfa', cursor: 'pointer',
                        fontSize: '13px', fontWeight: 600, transition: 'all 0.15s',
                    }}>
                        <Plus size={16} /> 新对话
                    </button>
                    <button onClick={() => setSidebarOpen(false)} style={{
                        background: 'none', border: 'none', cursor: 'pointer', color: '#52525b',
                        padding: '6px', borderRadius: '6px', display: 'flex',
                    }}>
                        <PanelLeftClose size={18} />
                    </button>
                </div>

                {/* Conversation list */}
                <div style={{ flex: 1, overflow: 'auto', padding: '8px 6px' }}>
                    {conversations.length === 0 && (
                        <div style={{
                            textAlign: 'center', color: '#3f3f46', fontSize: '13px',
                            padding: '40px 16px',
                        }}>
                            <MessageSquare size={32} style={{ margin: '0 auto 12px', opacity: 0.3 }} />
                            <p>还没有对话</p>
                            <p style={{ fontSize: '12px', marginTop: '4px' }}>点击"新对话"开始</p>
                        </div>
                    )}
                    {conversations.map(conv => (
                        <div
                            key={conv.id}
                            onClick={() => {
                                setActiveConvId(conv.id);
                                setSelectedModel(conv.model);
                                setSystemPrompt(conv.systemPrompt);
                            }}
                            style={{
                                padding: '10px 12px', borderRadius: '8px', cursor: 'pointer',
                                marginBottom: '2px', transition: 'all 0.15s',
                                background: conv.id === activeConvId ? 'rgba(139,92,246,0.12)' : 'transparent',
                                border: conv.id === activeConvId ? '1px solid rgba(139,92,246,0.2)' : '1px solid transparent',
                            }}
                        >
                            {editingTitle === conv.id ? (
                                <input
                                    autoFocus
                                    value={editTitleValue}
                                    onChange={e => setEditTitleValue(e.target.value)}
                                    onBlur={() => renameConversation(conv.id, editTitleValue)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') renameConversation(conv.id, editTitleValue);
                                        if (e.key === 'Escape') setEditingTitle(null);
                                    }}
                                    style={{
                                        width: '100%', background: '#18181b', border: '1px solid #a78bfa',
                                        borderRadius: '4px', padding: '3px 6px', color: '#e4e4e7',
                                        fontSize: '13px', outline: 'none',
                                    }}
                                />
                            ) : (
                                <>
                                    <div style={{
                                        fontSize: '13px', fontWeight: 500, color: '#d4d4d8',
                                        whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                                    }}>
                                        {conv.title}
                                    </div>
                                    <div style={{
                                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                        marginTop: '4px',
                                    }}>
                                        <span style={{ fontSize: '11px', color: '#52525b' }}>
                                            {conv.messages.length} 条 · {formatTime(conv.updatedAt)}
                                        </span>
                                        {conv.id === activeConvId && (
                                            <div style={{ display: 'flex', gap: '2px' }} onClick={e => e.stopPropagation()}>
                                                <button onClick={() => {
                                                    setEditingTitle(conv.id);
                                                    setEditTitleValue(conv.title);
                                                }} style={{
                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                    color: '#52525b', padding: '2px', borderRadius: '4px',
                                                }}>
                                                    <Pencil size={12} />
                                                </button>
                                                <button onClick={() => deleteConversation(conv.id)} style={{
                                                    background: 'none', border: 'none', cursor: 'pointer',
                                                    color: '#52525b', padding: '2px', borderRadius: '4px',
                                                }}>
                                                    <Trash2 size={12} />
                                                </button>
                                            </div>
                                        )}
                                    </div>
                                </>
                            )}
                        </div>
                    ))}
                </div>

                {/* Sidebar footer */}
                <div style={{
                    padding: '8px 12px', borderTop: '1px solid #1f1f23',
                    display: 'flex', flexDirection: 'column', gap: '4px',
                }}>
                    {/* Export / Import row */}
                    <div style={{ display: 'flex', gap: '4px' }}>
                        <button onClick={exportAllConversations} title="导出全部对话 (JSON)" style={{
                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: '4px', padding: '6px', borderRadius: '6px', border: 'none',
                            background: 'transparent', color: '#52525b', cursor: 'pointer',
                            fontSize: '11px', transition: 'all 0.15s',
                        }}>
                            <Download size={13} /> 导出备份
                        </button>
                        <label title="从 JSON 文件恢复对话" style={{
                            flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center',
                            gap: '4px', padding: '6px', borderRadius: '6px', border: 'none',
                            background: 'transparent', color: '#52525b', cursor: 'pointer',
                            fontSize: '11px', transition: 'all 0.15s',
                        }}>
                            <Upload size={13} /> 导入恢复
                            <input type="file" accept=".json" onChange={importConversations}
                                style={{ display: 'none' }} />
                        </label>
                    </div>
                    {/* Clear all */}
                    <button onClick={clearAllConversations} style={{
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        gap: '4px', padding: '6px', borderRadius: '6px', border: 'none',
                        background: 'transparent', color: '#3f3f46', cursor: 'pointer',
                        fontSize: '11px', transition: 'all 0.15s',
                    }}>
                        <Eraser size={13} /> 清空全部
                    </button>
                </div>
            </div>

            {/* ====== Main Chat Area ====== */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                {/* Chat Header */}
                <div style={{
                    padding: '10px 16px', display: 'flex', alignItems: 'center', gap: '8px',
                    borderBottom: '1px solid #1f1f23', background: '#0c0c0f',
                    flexShrink: 0,
                }}>
                    {!sidebarOpen && (
                        <button onClick={() => setSidebarOpen(true)} style={{
                            background: 'none', border: 'none', cursor: 'pointer', color: '#52525b',
                            padding: '6px', borderRadius: '6px', display: 'flex',
                        }}>
                            <PanelLeftOpen size={18} />
                        </button>
                    )}
                    <div style={{
                        display: 'flex', alignItems: 'center', gap: '6px',
                    }}>
                        <div style={{
                            background: 'linear-gradient(135deg, rgba(139,92,246,0.3), rgba(99,102,241,0.2))',
                            padding: '5px', borderRadius: '8px', display: 'flex',
                        }}>
                            <Sparkles size={16} style={{ color: '#a78bfa' }} />
                        </div>
                        <span style={{ fontSize: '14px', fontWeight: 600, color: '#d4d4d8' }}>
                            Gemini Chat
                        </span>
                    </div>

                    <div style={{ flex: 1 }} />

                    {/* Model selector */}
                    <select
                        value={activeConv?.model || selectedModel}
                        onChange={e => {
                            const model = e.target.value;
                            setSelectedModel(model);
                            if (activeConv) {
                                setConversations(prev => prev.map(c =>
                                    c.id === activeConvId ? { ...c, model } : c
                                ));
                            }
                        }}
                        style={{
                            background: '#18181b', color: '#a1a1aa', border: '1px solid #27272a',
                            borderRadius: '6px', padding: '5px 8px', fontSize: '12px',
                            cursor: 'pointer', outline: 'none',
                        }}
                    >
                        {MODEL_OPTIONS.map(opt => (
                            <option key={opt.value} value={opt.value}>{opt.label}</option>
                        ))}
                    </select>

                    {/* Settings */}
                    <button onClick={() => setShowSettings(!showSettings)} style={{
                        background: showSettings ? 'rgba(139,92,246,0.15)' : 'none',
                        border: 'none', cursor: 'pointer',
                        color: showSettings ? '#a78bfa' : '#52525b',
                        padding: '6px', borderRadius: '6px', display: 'flex',
                    }}>
                        <Settings2 size={16} />
                    </button>

                    {activeConv && (
                        <button onClick={exportConversation} style={{
                            background: 'none', border: 'none', cursor: 'pointer', color: '#52525b',
                            padding: '6px', borderRadius: '6px', display: 'flex',
                        }} title="导出对话">
                            <Download size={16} />
                        </button>
                    )}
                </div>

                {/* Settings Panel */}
                {showSettings && (
                    <div style={{
                        padding: '12px 16px', background: '#0f0f12', borderBottom: '1px solid #1f1f23',
                        display: 'flex', flexDirection: 'column', gap: '10px', flexShrink: 0,
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                            <span style={{ fontSize: '12px', color: '#71717a', minWidth: '70px' }}>系统提示词:</span>
                            <div style={{ display: 'flex', gap: '4px', flexWrap: 'wrap' }}>
                                {SYSTEM_PROMPT_TEMPLATES.map((tpl, i) => (
                                    <button
                                        key={i}
                                        onClick={() => {
                                            if (tpl.value) {
                                                setSystemPrompt(tpl.value);
                                                if (activeConv) {
                                                    setConversations(prev => prev.map(c =>
                                                        c.id === activeConvId ? { ...c, systemPrompt: tpl.value } : c
                                                    ));
                                                }
                                            }
                                        }}
                                        style={{
                                            padding: '3px 10px', borderRadius: '12px', border: 'none',
                                            fontSize: '11px', cursor: 'pointer', transition: 'all 0.15s',
                                            background: systemPrompt === tpl.value ? 'rgba(139,92,246,0.2)' : '#18181b',
                                            color: systemPrompt === tpl.value ? '#c4b5fd' : '#71717a',
                                        }}
                                    >
                                        {tpl.label}
                                    </button>
                                ))}
                            </div>
                        </div>
                        <textarea
                            value={activeConv?.systemPrompt ?? systemPrompt}
                            onChange={e => {
                                setSystemPrompt(e.target.value);
                                if (activeConv) {
                                    setConversations(prev => prev.map(c =>
                                        c.id === activeConvId ? { ...c, systemPrompt: e.target.value } : c
                                    ));
                                }
                            }}
                            placeholder="输入系统提示词（定义 AI 角色和行为）..."
                            rows={3}
                            style={{
                                width: '100%', background: '#18181b', border: '1px solid #27272a',
                                borderRadius: '8px', padding: '8px 12px', color: '#a1a1aa',
                                fontSize: '12px', resize: 'vertical', outline: 'none',
                                fontFamily: 'inherit', lineHeight: '1.5',
                            }}
                        />
                    </div>
                )}

                {/* Messages Area */}
                <div style={{
                    flex: 1, overflow: 'auto', padding: '16px',
                    display: 'flex', flexDirection: 'column',
                }}>
                    {/* Empty state */}
                    {(!activeConv || activeConv.messages.length === 0) && !isStreaming && (
                        <div style={{
                            flex: 1, display: 'flex', flexDirection: 'column',
                            alignItems: 'center', justifyContent: 'center',
                            color: '#3f3f46', gap: '12px',
                        }}>
                            <div style={{
                                background: 'linear-gradient(135deg, rgba(139,92,246,0.15), rgba(99,102,241,0.1))',
                                padding: '20px', borderRadius: '20px',
                            }}>
                                <Bot size={48} style={{ color: '#6d28d9' }} />
                            </div>
                            <h2 style={{
                                fontSize: '18px', fontWeight: 600, color: '#52525b', margin: 0,
                            }}>开始与 Gemini 对话</h2>
                            <p style={{ fontSize: '13px', color: '#3f3f46', margin: 0, textAlign: 'center', maxWidth: '400px' }}>
                                支持多轮对话记忆、流式输出、Markdown、图片上传与代码高亮
                            </p>
                            <div style={{
                                display: 'flex', gap: '8px', marginTop: '8px', flexWrap: 'wrap',
                                justifyContent: 'center',
                            }}>
                                {['帮我写一个 Python 脚本', '解释量子计算', '翻译这段文字', '创作一首诗'].map(s => (
                                    <button
                                        key={s}
                                        onClick={() => {
                                            setInputText(s);
                                            textareaRef.current?.focus();
                                        }}
                                        style={{
                                            padding: '6px 14px', borderRadius: '16px',
                                            border: '1px solid #27272a', background: '#0f0f12',
                                            color: '#71717a', fontSize: '12px', cursor: 'pointer',
                                            transition: 'all 0.15s',
                                        }}
                                    >
                                        {s}
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Messages */}
                    {activeConv?.messages.map(msg => (
                        <div key={msg.id} style={{
                            display: 'flex', gap: '12px',
                            marginBottom: '20px',
                            flexDirection: msg.role === 'user' ? 'row-reverse' : 'row',
                        }}>
                            {/* Avatar */}
                            <div style={{
                                width: '32px', height: '32px', borderRadius: '10px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0,
                                background: msg.role === 'user'
                                    ? 'linear-gradient(135deg, #3b82f6, #2563eb)'
                                    : 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                            }}>
                                {msg.role === 'user' ? <User size={16} color="#fff" /> : <Bot size={16} color="#fff" />}
                            </div>

                            {/* Content */}
                            <div style={{
                                maxWidth: '75%', minWidth: '60px',
                            }}>
                                {/* Images */}
                                {msg.images && msg.images.length > 0 && (
                                    <div style={{
                                        display: 'flex', gap: '6px', flexWrap: 'wrap',
                                        marginBottom: '8px',
                                    }}>
                                        {msg.images.map((img, i) => (
                                            <img key={i} src={img} alt="" style={{
                                                maxWidth: '200px', maxHeight: '150px',
                                                borderRadius: '8px', border: '1px solid #27272a',
                                                objectFit: 'cover',
                                            }} />
                                        ))}
                                    </div>
                                )}

                                {/* Text bubble */}
                                {msg.text && (
                                    <div style={{
                                        padding: '10px 14px', borderRadius: '12px',
                                        fontSize: '14px', lineHeight: '1.7',
                                        background: msg.role === 'user' ? '#1e40af' : '#18181b',
                                        color: msg.role === 'user' ? '#dbeafe' : '#d4d4d8',
                                        border: msg.role === 'user' ? 'none' : '1px solid #27272a',
                                        wordBreak: 'break-word',
                                    }}>
                                        {msg.role === 'model' ? (
                                            <ReactMarkdown components={markdownComponents}>
                                                {msg.text}
                                            </ReactMarkdown>
                                        ) : (
                                            <div style={{ whiteSpace: 'pre-wrap' }}>{msg.text}</div>
                                        )}
                                    </div>
                                )}

                                {/* Footer */}
                                <div style={{
                                    display: 'flex', alignItems: 'center', gap: '6px',
                                    marginTop: '4px', justifyContent: msg.role === 'user' ? 'flex-end' : 'flex-start',
                                }}>
                                    <span style={{ fontSize: '11px', color: '#3f3f46' }}>
                                        {formatTime(msg.timestamp)}
                                    </span>
                                    <button onClick={() => copyMessage(msg.id, msg.text)} style={{
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        color: copiedMsgId === msg.id ? '#22c55e' : '#3f3f46',
                                        padding: '2px', display: 'flex',
                                    }}>
                                        {copiedMsgId === msg.id ? <Check size={12} /> : <Copy size={12} />}
                                    </button>
                                    {msg.role === 'model' && msg === activeConv.messages[activeConv.messages.length - 1] && (
                                        <button onClick={regenerateLastResponse} disabled={isStreaming} style={{
                                            background: 'none', border: 'none', cursor: 'pointer',
                                            color: '#3f3f46', padding: '2px', display: 'flex',
                                        }} title="重新生成">
                                            <RotateCcw size={12} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    ))}

                    {/* Streaming indicator */}
                    {isStreaming && (
                        <div style={{
                            display: 'flex', gap: '12px', marginBottom: '20px',
                        }}>
                            <div style={{
                                width: '32px', height: '32px', borderRadius: '10px',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                flexShrink: 0,
                                background: 'linear-gradient(135deg, #8b5cf6, #6d28d9)',
                            }}>
                                <Bot size={16} color="#fff" />
                            </div>
                            <div style={{ maxWidth: '75%', minWidth: '60px' }}>
                                <div style={{
                                    padding: '10px 14px', borderRadius: '12px', fontSize: '14px',
                                    lineHeight: '1.7', background: '#18181b', border: '1px solid #27272a',
                                    color: '#d4d4d8', wordBreak: 'break-word',
                                }}>
                                    {streamingText ? (
                                        <ReactMarkdown components={markdownComponents}>
                                            {streamingText}
                                        </ReactMarkdown>
                                    ) : (
                                        <div style={{ display: 'flex', gap: '4px', padding: '4px 0' }}>
                                            <div style={{
                                                width: '6px', height: '6px', borderRadius: '50%',
                                                background: '#a78bfa', animation: 'pulse 1.4s infinite ease-in-out',
                                            }} />
                                            <div style={{
                                                width: '6px', height: '6px', borderRadius: '50%',
                                                background: '#a78bfa', animation: 'pulse 1.4s infinite ease-in-out 0.2s',
                                            }} />
                                            <div style={{
                                                width: '6px', height: '6px', borderRadius: '50%',
                                                background: '#a78bfa', animation: 'pulse 1.4s infinite ease-in-out 0.4s',
                                            }} />
                                        </div>
                                    )}
                                </div>
                                {streamingText && (
                                    <button onClick={stopStreaming} style={{
                                        marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px',
                                        background: 'none', border: 'none', cursor: 'pointer',
                                        color: '#ef4444', fontSize: '11px',
                                    }}>
                                        <X size={12} /> 停止生成
                                    </button>
                                )}
                            </div>
                        </div>
                    )}

                    <div ref={messagesEndRef} />
                </div>

                {/* Input Area */}
                <div style={{
                    padding: '12px 16px', borderTop: '1px solid #1f1f23',
                    background: '#0c0c0f', flexShrink: 0,
                }}>
                    {/* Pending images preview */}
                    {pendingImages.length > 0 && (
                        <div style={{
                            display: 'flex', gap: '6px', flexWrap: 'wrap',
                            marginBottom: '8px', padding: '8px', background: '#18181b',
                            borderRadius: '8px', border: '1px solid #27272a',
                        }}>
                            {pendingImages.map((img, i) => (
                                <div key={i} style={{ position: 'relative' }}>
                                    <img src={img} alt="" style={{
                                        width: '60px', height: '60px', objectFit: 'cover',
                                        borderRadius: '6px', border: '1px solid #3f3f46',
                                    }} />
                                    <button onClick={() => setPendingImages(prev => prev.filter((_, idx) => idx !== i))} style={{
                                        position: 'absolute', top: '-4px', right: '-4px',
                                        width: '18px', height: '18px', borderRadius: '50%',
                                        background: '#ef4444', border: 'none', cursor: 'pointer',
                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                        color: '#fff',
                                    }}>
                                        <X size={10} />
                                    </button>
                                </div>
                            ))}
                        </div>
                    )}

                    {/* Input box */}
                    <div style={{
                        display: 'flex', alignItems: 'flex-end', gap: '8px',
                        background: '#18181b', borderRadius: '12px', border: '1px solid #27272a',
                        padding: '8px 12px',
                        transition: 'border-color 0.15s',
                    }}>
                        <input
                            type="file"
                            ref={fileInputRef}
                            accept="image/*"
                            multiple
                            onChange={e => {
                                const files = e.target.files;
                                if (files) {
                                    for (let i = 0; i < files.length; i++) {
                                        addImageFromFile(files[i]);
                                    }
                                }
                                e.target.value = '';
                            }}
                            style={{ display: 'none' }}
                        />
                        <button onClick={() => fileInputRef.current?.click()} style={{
                            background: 'none', border: 'none', cursor: 'pointer', color: '#52525b',
                            padding: '4px', display: 'flex', borderRadius: '6px', flexShrink: 0,
                        }} title="上传图片">
                            <Image size={18} />
                        </button>

                        <textarea
                            ref={textareaRef}
                            value={inputText}
                            onChange={e => setInputText(e.target.value)}
                            onKeyDown={handleKeyDown}
                            onPaste={handlePaste}
                            onDragOver={e => e.preventDefault()}
                            onDrop={handleDrop}
                            placeholder="发送消息... (Shift+Enter 换行，粘贴/拖拽图片)"
                            rows={1}
                            style={{
                                flex: 1, background: 'transparent', border: 'none', outline: 'none',
                                color: '#e4e4e7', fontSize: '14px', resize: 'none',
                                fontFamily: 'inherit', lineHeight: '1.5', padding: '4px 0',
                                maxHeight: '200px',
                            }}
                        />

                        {isStreaming ? (
                            <button onClick={stopStreaming} style={{
                                background: '#ef4444', border: 'none', cursor: 'pointer',
                                color: '#fff', padding: '6px 12px', borderRadius: '8px',
                                display: 'flex', alignItems: 'center', gap: '4px',
                                fontSize: '13px', fontWeight: 600, flexShrink: 0,
                            }}>
                                <X size={14} /> 停止
                            </button>
                        ) : (
                            <button
                                onClick={sendMessage}
                                disabled={!inputText.trim() && pendingImages.length === 0}
                                style={{
                                    background: (inputText.trim() || pendingImages.length > 0)
                                        ? 'linear-gradient(135deg, #8b5cf6, #6d28d9)'
                                        : '#27272a',
                                    border: 'none', cursor: (inputText.trim() || pendingImages.length > 0)
                                        ? 'pointer' : 'default',
                                    color: '#fff', padding: '6px 12px', borderRadius: '8px',
                                    display: 'flex', alignItems: 'center', gap: '4px',
                                    fontSize: '13px', fontWeight: 600, flexShrink: 0,
                                    transition: 'all 0.15s',
                                    opacity: (inputText.trim() || pendingImages.length > 0) ? 1 : 0.5,
                                }}
                            >
                                <Send size={14} />
                            </button>
                        )}
                    </div>

                    <div style={{
                        textAlign: 'center', fontSize: '11px', color: '#3f3f46',
                        marginTop: '6px',
                    }}>
                        {activeConv?.model || selectedModel} · {activeConv?.messages.length || 0} 条消息
                    </div>
                </div>
            </div>

            {/* Pulse animation */}
            <style>{`
                @keyframes pulse {
                    0%, 80%, 100% { transform: scale(0.6); opacity: 0.4; }
                    40% { transform: scale(1); opacity: 1; }
                }
            `}</style>
        </div>
    );
};

export default GeminiChatApp;
