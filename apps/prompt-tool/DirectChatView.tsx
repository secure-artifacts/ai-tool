import React, { useState, useEffect, useRef } from 'react';
import { GoogleGenAI } from "@google/genai";
import { v4 as uuidv4 } from 'uuid';
import { useAuth } from '../../contexts/AuthContext';
import ProjectPanel from '../../components/ProjectPanel';
import {
    Project,
    debouncedSaveProject,
    createProject
} from '../../services/projectService';
import {
    MessageSquarePlus,
    Trash2,
    Send,
    Loader2,
    Copy,
    Check,
    Plus,
    MessageCircle,
    X,
    Eraser,
    Download,
    FileText,
    ListPlus,
    FilePlus,
    ImageIcon,
    Paperclip,
    Maximize2
} from 'lucide-react';

interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    images?: string[]; // Base64 data URLs
    timestamp: number;
}

interface ChatSession {
    id: string;
    topic: string; // The "Original Word" or Title
    messages: ChatMessage[];
    inputText: string;
    pendingAttachments?: string[]; // Base64 data URLs pending send
    isLoading: boolean;
}

interface DirectChatViewProps {
    getAiInstance: () => GoogleGenAI;
    textModel: string;
}

const STORAGE_KEY = 'direct_chat_view_state';

const convertBlobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            resolve(result);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

export const DirectChatView: React.FC<DirectChatViewProps> = ({ getAiInstance, textModel }) => {
    // --- Auth for history ---
    const { user } = useAuth();

    // --- State ---
    // 从 localStorage 恢复会话，保持切换界面时数据不丢失
    const [sessions, setSessions] = useState<ChatSession[]>(() => {
        if (typeof window !== 'undefined') {
            try {
                const stored = localStorage.getItem(STORAGE_KEY);
                if (stored) {
                    const parsed = JSON.parse(stored);
                    if (Array.isArray(parsed)) {
                        // 恢复会话，重置 loading 状态
                        return parsed.map((s: any) => ({
                            ...s,
                            isLoading: false,
                            pendingAttachments: []  // 不恢复图片附件（太大）
                        }));
                    }
                }
            } catch (e) {
                console.warn('[DirectChatView] Failed to load sessions from localStorage', e);
            }
        }
        return [];
    });

    const [bulkInput, setBulkInput] = useState('');
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [draggingSessionId, setDraggingSessionId] = useState<string | null>(null);
    const fileInputRefs = useRef<{ [key: string]: HTMLInputElement | null }>({});
    // 消息放大状态
    const [expandedMessageText, setExpandedMessageText] = useState<string | null>(null);
    const [modalCopied, setModalCopied] = useState(false);
    // 单击提示状态 - 跟随鼠标位置
    const [clickHint, setClickHint] = useState<{ show: boolean; x: number; y: number }>({ show: false, x: 0, y: 0 });
    // 历史记录面板
    const [showHistoryPanel, setShowHistoryPanel] = useState(false); // 兼容式保留
    const [showProjectPanel, setShowProjectPanel] = useState(false);
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const projectInitializedRef = useRef(false);
    const lastSavedStateRef = useRef<string>('');
    const isCreatingProjectRef = useRef(false); // 防止重复创建项目的竞态条件

    // 自动保存状态到项目
    useEffect(() => {
        if (!user?.uid || sessions.length === 0) return;

        // 只保存有消息的会话
        const sessionsWithMessages = sessions.filter(s => s.messages.length > 0);
        if (sessionsWithMessages.length === 0) return;

        // 初始化项目（如果没有）
        if (!currentProject && !projectInitializedRef.current) {
            projectInitializedRef.current = true;
            const tempProject: Project = {
                id: `temp_${Date.now()}`,
                moduleId: 'desc-chat',
                name: '新建对话',
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
                updatedAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
                isActive: true,
                isStarred: false,
                isPinned: false,
                tags: [],
                preview: '',
                itemCount: 0,
                currentState: {},
                versionCount: 0
            };
            setCurrentProject(tempProject);
            return;
        }

        if (!currentProject?.id) return;

        // 序列化状态用于比较
        const stateSnapshot = JSON.stringify({
            sessions: sessionsWithMessages.map(s => ({
                id: s.id,
                topic: s.topic,
                messageCount: s.messages.length,
                lastMessage: s.messages[s.messages.length - 1]?.text?.slice(0, 50)
            }))
        });

        if (stateSnapshot === lastSavedStateRef.current) return;
        lastSavedStateRef.current = stateSnapshot;

        // 保存到项目
        const saveToProject = async () => {
            let projectId = currentProject.id;

            // 临时项目需要先创建
            if (projectId.startsWith('temp_')) {
                const firstSession = sessionsWithMessages[0];
                const projectName = firstSession.topic?.slice(0, 30) || '对话项目';
                projectId = await createProject(user.uid, {
                    moduleId: 'desc-chat',
                    name: projectName
                });
                setCurrentProject(prev => prev ? { ...prev, id: projectId, name: projectName } : null);
            }

            // 清理保存的数据（移除图片）
            const cleanedSessions = sessionsWithMessages.map(session => ({
                id: session.id,
                topic: session.topic,
                messages: session.messages.map(msg => ({
                    id: msg.id,
                    role: msg.role,
                    text: msg.text,
                    timestamp: msg.timestamp
                    // 移除 images 字段
                }))
            }));

            const stateToSave = {
                sessions: cleanedSessions
            };

            const previewText = sessionsWithMessages[0]?.messages[sessionsWithMessages[0].messages.length - 1]?.text?.slice(0, 100) || '';
            const totalMessages = sessionsWithMessages.reduce((sum, s) => sum + s.messages.length, 0);

            debouncedSaveProject(user.uid, 'desc-chat', projectId, stateToSave, {
                preview: previewText,
                itemCount: totalMessages
            });
        };

        saveToProject();
    }, [user?.uid, sessions, currentProject]);

    // 自动保存会话到 localStorage（保持切换界面时数据不丢失）
    useEffect(() => {
        if (typeof window !== 'undefined') {
            try {
                // 清理大型数据后再保存
                const sessionsToSave = sessions.map(s => ({
                    id: s.id,
                    topic: s.topic,
                    messages: s.messages.map(msg => ({
                        id: msg.id,
                        role: msg.role,
                        text: msg.text,
                        timestamp: msg.timestamp
                        // 不保存 images 字段（太大）
                    })),
                    inputText: s.inputText
                    // 不保存 pendingAttachments 和 isLoading
                }));
                localStorage.setItem(STORAGE_KEY, JSON.stringify(sessionsToSave));
            } catch (err) {
                console.warn('[DirectChatView] Failed to save sessions to localStorage:', err);
            }
        }
    }, [sessions]);

    // --- ESC 键关闭模态框 ---
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && expandedMessageText) {
                setExpandedMessageText(null);
            }
        };
        document.addEventListener('keydown', handleKeyDown);
        return () => document.removeEventListener('keydown', handleKeyDown);
    }, [expandedMessageText]);

    // --- Actions ---

    const handleSingleAdd = () => {
        const text = bulkInput.trim();
        if (!text) return;
        const newSession: ChatSession = {
            id: uuidv4(),
            topic: text,
            messages: [],
            inputText: '',
            isLoading: false
        };
        setSessions(prev => [newSession, ...prev]); // Add to top
        setBulkInput('');
    };

    const handleBulkAdd = () => {
        if (!bulkInput.trim()) return;

        const lines: string[] = [];
        const input = bulkInput;
        let current = '';
        let inQuote = false;

        // CSV/Excel style parsing to handle multi-line cells from Google Sheets
        for (let i = 0; i < input.length; i++) {
            const char = input[i];
            const nextChar = input[i + 1];

            if (char === '"') {
                if (inQuote && nextChar === '"') {
                    current += '"';
                    i++;
                } else {
                    inQuote = !inQuote;
                }
            } else if (!inQuote && (char === '\t' || char === '\n' || char === '\r')) {
                if (current.trim()) {
                    lines.push(current.trim());
                }
                current = '';
            } else {
                current += char;
            }
        }
        if (current.trim()) {
            lines.push(current.trim());
        }

        const newSessions: ChatSession[] = lines.map(line => ({
            id: uuidv4(),
            topic: line,
            messages: [], // Start empty, the topic acts as context
            inputText: '',
            isLoading: false
        }));

        setSessions(prev => [...newSessions, ...prev]); // Add to top
        setBulkInput('');
    };

    const handleAddEmpty = () => {
        const newSession: ChatSession = {
            id: uuidv4(),
            topic: 'New Conversation',
            messages: [],
            inputText: '',
            isLoading: false
        };
        setSessions(prev => [newSession, ...prev]); // Add to top
    };

    const handleClearAll = () => {
        setSessions([]);
    };

    const handleDeleteSession = (id: string) => {
        setSessions(prev => prev.filter(s => s.id !== id));
    };

    const handleClearHistory = (id: string) => {
        setSessions(prev => prev.map(s => s.id === id ? { ...s, messages: [] } : s));
    };

    const handleCopy = (text: string, id: string) => {
        navigator.clipboard.writeText(text);
        setCopiedId(id);
        setTimeout(() => setCopiedId(null), 2000);
    };

    const handleCopyHistory = (session: ChatSession) => {
        let text = `Original Prompt: ${session.topic}\n\n--- Chat History ---\n`;
        session.messages.forEach(msg => {
            const role = msg.role === 'user' ? 'User' : 'AI';
            const attachmentInfo = msg.images && msg.images.length > 0 ? ` [Attached ${msg.images.length} Image(s)]` : '';
            text += `[${role}]${attachmentInfo}: ${msg.text}\n`;
        });
        handleCopy(text, `history-${session.id}`);
    };

    const handleExportAll = () => {
        let exportText = `# Direct Chat Export\n`;
        exportText += `Date: ${new Date().toLocaleString()}\n`;
        exportText += `Total Sessions: ${sessions.length}\n`;
        exportText += `\n${'='.repeat(50)}\n\n`;

        sessions.forEach((session, index) => {
            exportText += `## Session ${index + 1}\n`;
            exportText += `Topic: ${session.topic}\n\n`;

            if (session.messages.length > 0) {
                session.messages.forEach(msg => {
                    const role = msg.role === 'user' ? 'User' : 'AI';
                    const attachmentInfo = msg.images && msg.images.length > 0 ? ` [Attached ${msg.images.length} Image(s)]` : '';
                    exportText += `[${role}]${attachmentInfo}: ${msg.text}\n`;
                });
            } else {
                exportText += `(No messages)\n`;
            }
            exportText += `\n${'-'.repeat(50)}\n\n`;
        });

        const blob = new Blob([exportText], { type: 'text/plain;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `direct_chat_export_${new Date().toISOString().slice(0, 10)}.txt`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const updateSessionInput = (id: string, text: string) => {
        setSessions(prev => prev.map(s => s.id === id ? { ...s, inputText: text } : s));
    };

    const updateSessionTopic = (id: string, text: string) => {
        setSessions(prev => prev.map(s => s.id === id ? { ...s, topic: text } : s));
    };

    // --- Image Handling ---

    const addAttachments = (id: string, newImages: string[]) => {
        setSessions(prev => prev.map(s => s.id === id ? {
            ...s,
            pendingAttachments: [...(s.pendingAttachments || []), ...newImages]
        } : s));
    };

    const removeAttachment = (sessionId: string, index: number) => {
        setSessions(prev => prev.map(s => s.id === sessionId ? {
            ...s,
            pendingAttachments: s.pendingAttachments?.filter((_, i) => i !== index)
        } : s));
    };

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, sessionId: string) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;

        const newAttachments: string[] = [];
        for (const file of files) {
            try {
                const base64 = await convertBlobToBase64(file);
                newAttachments.push(base64);
            } catch (err) {
                console.error('Failed to process file', err);
            }
        }

        if (newAttachments.length > 0) {
            addAttachments(sessionId, newAttachments);
        }
        e.target.value = '';
    };

    const handlePaste = async (e: React.ClipboardEvent, sessionId: string) => {
        const items = e.clipboardData.items;
        const files: File[] = [];
        for (let i = 0; i < items.length; i++) {
            if (items[i].type.startsWith('image/')) {
                const file = items[i].getAsFile();
                if (file) files.push(file);
            }
        }

        if (files.length === 0) return;

        e.preventDefault();
        const newAttachments: string[] = [];
        for (const file of files) {
            try {
                const base64 = await convertBlobToBase64(file);
                newAttachments.push(base64);
            } catch (err) {
                console.error('Failed to process pasted image', err);
            }
        }

        if (newAttachments.length > 0) {
            addAttachments(sessionId, newAttachments);
        }
    };

    // --- Drag and Drop Handlers ---

    const handleDragEnter = (e: React.DragEvent, sessionId: string) => {
        e.preventDefault();
        e.stopPropagation();
        if (draggingSessionId !== sessionId) {
            setDraggingSessionId(sessionId);
        }
    };

    const handleDragLeave = (e: React.DragEvent, sessionId: string) => {
        e.preventDefault();
        e.stopPropagation();

        // Prevent flickering when dragging over child elements
        if (e.currentTarget.contains(e.relatedTarget as Node)) {
            return;
        }

        setDraggingSessionId(null);
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        // Ensure drop effect is copy
        e.dataTransfer.dropEffect = 'copy';
    };

    const handleDrop = async (e: React.DragEvent, sessionId: string) => {
        e.preventDefault();
        e.stopPropagation();
        setDraggingSessionId(null);

        const files = Array.from<File>(e.dataTransfer.files).filter(f => f.type.startsWith('image/'));
        if (files.length === 0) return;

        const newAttachments: string[] = [];
        for (const file of files) {
            try {
                const base64 = await convertBlobToBase64(file);
                newAttachments.push(base64);
            } catch (err) {
                console.error('Failed to process dropped image', err);
            }
        }

        if (newAttachments.length > 0) {
            addAttachments(sessionId, newAttachments);
        }
    };

    const sendMessage = async (sessionId: string) => {
        const session = sessions.find(s => s.id === sessionId);
        const hasText = !!session?.inputText.trim();
        const hasAttachments = !!(session?.pendingAttachments && session.pendingAttachments.length > 0);

        if (!session || (!hasText && !hasAttachments) || session.isLoading) return;

        const userText = session.inputText.trim();
        const attachments = session.pendingAttachments || [];

        const userMsg: ChatMessage = {
            id: uuidv4(),
            role: 'user',
            text: userText,
            images: attachments,
            timestamp: Date.now()
        };

        // 1. Optimistic Update: Add user message, clear input/attachments, set loading
        setSessions(prev => prev.map(s => s.id === sessionId ? {
            ...s,
            messages: [...s.messages, userMsg],
            inputText: '',
            pendingAttachments: [],
            isLoading: true
        } : s));

        try {
            const ai = getAiInstance();

            // System Instruction
            let systemInstruction = "You are a creative AI assistant helping to refine prompts or brainstorm ideas.";
            if (session.topic && session.topic !== 'New Conversation') {
                systemInstruction += `\n\nThe user is currently focused on this specific topic/prompt:\n"${session.topic}"\n\nAll your responses should be relevant to modifying, expanding, or discussing this topic.`;
            }

            // Construct History
            const contents: any[] = [];

            // Map previous history
            session.messages.forEach(msg => {
                const parts: any[] = [];
                // Add image parts if any
                if (msg.images && msg.images.length > 0) {
                    msg.images.forEach(imgDataUrl => {
                        const base64Data = imgDataUrl.replace(/^data:image\/\w+;base64,/, '');
                        // Extract mime type if possible, or default to png
                        const mimeMatch = imgDataUrl.match(/^data:(image\/\w+);base64,/);
                        const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

                        parts.push({
                            inlineData: {
                                mimeType: mimeType,
                                data: base64Data
                            }
                        });
                    });
                }
                // Add text part (after images)
                if (msg.text) {
                    parts.push({ text: msg.text });
                }

                if (parts.length > 0) {
                    contents.push({
                        role: msg.role === 'user' ? 'user' : 'model',
                        parts: parts
                    });
                }
            });

            // Add current message
            const currentParts: any[] = [];
            if (attachments.length > 0) {
                attachments.forEach(imgDataUrl => {
                    const base64Data = imgDataUrl.replace(/^data:image\/\w+;base64,/, '');
                    const mimeMatch = imgDataUrl.match(/^data:(image\/\w+);base64,/);
                    const mimeType = mimeMatch ? mimeMatch[1] : 'image/png';

                    currentParts.push({
                        inlineData: {
                            mimeType: mimeType,
                            data: base64Data
                        }
                    });
                });
            }
            if (userText) {
                currentParts.push({ text: userText });
            }

            contents.push({
                role: 'user',
                parts: currentParts
            });

            const result = await ai.models.generateContent({
                model: textModel,
                contents: contents,
                config: {
                    systemInstruction
                }
            });

            const responseText = result.text || '';

            const modelMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: responseText,
                timestamp: Date.now()
            };

            // 2. Success Update
            setSessions(prev => prev.map(s => s.id === sessionId ? {
                ...s,
                messages: [...s.messages, modelMsg],
                isLoading: false
            } : s));

            // 项目状态会自动保存
            if (user?.uid) {
            }

        } catch (error: any) {
            console.error(error);
            // 3. Error Update
            const errorMsg: ChatMessage = {
                id: uuidv4(),
                role: 'model',
                text: `Error: ${error.message || 'Request failed'}`,
                timestamp: Date.now()
            };
            setSessions(prev => prev.map(s => s.id === sessionId ? {
                ...s,
                messages: [...s.messages, errorMsg],
                isLoading: false
            } : s));
        }
    };

    return (
        <>
            <div className="flex flex-col h-full bg-zinc-950 text-zinc-100 p-4 gap-6 overflow-y-auto custom-scrollbar">

                {/* Unified Toolbar */}
                <div className="w-full max-w-none mx-auto flex flex-col gap-4">
                    <div className="bg-zinc-900 border border-zinc-800 rounded-xl p-3 flex flex-wrap items-start gap-3 shadow-sm relative z-20">

                        {/* Input Area with buttons inside */}
                        <div className="flex-1 min-w-[300px] flex items-center gap-2">
                            <textarea
                                value={bulkInput}
                                onChange={(e) => setBulkInput(e.target.value)}
                                onKeyDown={(e) => {
                                    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) handleBulkAdd();
                                }}
                                placeholder="输入提示词（单条添加整段，批量添加按行分割）"
                                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/50 resize-none overflow-hidden placeholder-zinc-600 h-[36px]"
                            />
                            {/* Buttons next to textarea */}
                            <div className="flex gap-1.5 shrink-0">
                                <button
                                    onClick={handleSingleAdd}
                                    disabled={!bulkInput.trim()}
                                    className="px-2.5 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-600 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                    title="将内容作为单条添加 (可含换行)"
                                >
                                    <FilePlus size={14} /> 单条
                                </button>
                                <button
                                    onClick={handleBulkAdd}
                                    disabled={!bulkInput.trim()}
                                    className="px-2.5 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white border border-emerald-500 rounded text-xs font-medium transition-colors disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-1"
                                    title="按行分割批量添加"
                                >
                                    <ListPlus size={14} /> 批量
                                </button>
                            </div>
                        </div>

                        <div className="h-10 w-px bg-zinc-800 shrink-0 hidden lg:block self-center"></div>

                        {/* Stats & Actions */}
                        <div className="flex items-center gap-3 shrink-0 self-center">
                            <div className="text-zinc-500 text-xs font-medium px-2">
                                会话: <span className="text-zinc-200 font-bold">{sessions.length}</span>
                            </div>

                            <button
                                onClick={handleAddEmpty}
                                className="flex items-center gap-1.5 px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white border border-zinc-700 rounded-lg text-xs transition-colors"
                                title="添加空对话"
                            >
                                <MessageSquarePlus size={14} /> 空对话
                            </button>
                            <button
                                onClick={handleExportAll}
                                disabled={sessions.length === 0}
                                className="p-1.5 text-purple-400 hover:bg-purple-900/20 border border-transparent hover:border-purple-900/30 rounded-lg transition-colors disabled:opacity-50"
                                title="导出所有"
                            >
                                <Download size={16} />
                            </button>
                            {/* 当前项目名称 */}
                            {currentProject && !currentProject.id.startsWith('temp_') && (
                                <span className="text-xs text-zinc-500 max-w-[100px] truncate" title={currentProject.name}>
                                    📁 {currentProject.name}
                                </span>
                            )}
                            {/* 项目管理按钮 */}
                            <button
                                onClick={() => setShowProjectPanel(true)}
                                className="p-1.5 text-amber-400 hover:bg-amber-900/20 border border-transparent hover:border-amber-900/30 rounded-lg transition-colors"
                                title="项目管理"
                            >
                                📁
                            </button>
                            <button
                                onClick={handleClearAll}
                                disabled={sessions.length === 0}
                                className="p-1.5 text-red-400 hover:bg-red-900/20 border border-transparent hover:border-red-900/30 rounded-lg transition-colors disabled:opacity-50"
                                title="清空所有"
                            >
                                <Trash2 size={16} />
                            </button>
                        </div>
                    </div>
                </div>

                {/* Chat Grid */}
                <div className="w-full max-w-none mx-auto flex-1 pb-10">
                    {sessions.length === 0 ? (
                        <div className="flex flex-col items-center justify-center h-64 text-zinc-600 border-2 border-dashed border-zinc-800 rounded-xl bg-zinc-900/30">
                            <MessageCircle size={48} className="mb-4 opacity-20" />
                            <p className="text-sm">暂无会话，请在上方添加</p>
                        </div>
                    ) : (
                        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-6">
                            {sessions.map(session => (
                                <div key={session.id} className="bg-zinc-900 border border-zinc-800 rounded-xl overflow-hidden shadow-sm flex flex-col h-[600px] hover:border-zinc-700 transition-all">
                                    {/* Card Header */}
                                    <div className="p-3 border-b border-zinc-800 bg-zinc-900/80 flex gap-2 items-center justify-between">
                                        <div className="flex items-center gap-2 flex-1 min-w-0">
                                            <FileText size={14} className="text-zinc-500 shrink-0" />
                                            <input
                                                type="text"
                                                value={session.topic}
                                                onChange={(e) => updateSessionTopic(session.id, e.target.value)}
                                                className="bg-transparent text-sm font-semibold text-zinc-200 focus:outline-none border-b border-transparent focus:border-emerald-500 px-1 flex-1 truncate"
                                                title={session.topic}
                                            />
                                        </div>
                                        <div className="flex items-center gap-1">
                                            <button
                                                onClick={() => handleCopyHistory(session)}
                                                className="p-1.5 text-zinc-500 hover:text-emerald-400 hover:bg-zinc-800 rounded transition-colors"
                                                title="复制聊天记录"
                                            >
                                                {copiedId === `history-${session.id}` ? <Check size={14} /> : <Copy size={14} />}
                                            </button>
                                            <button
                                                onClick={() => handleClearHistory(session.id)}
                                                className="p-1.5 text-zinc-500 hover:text-amber-400 hover:bg-zinc-800 rounded transition-colors"
                                                title="清空聊天记录 (保留卡片)"
                                            >
                                                <Eraser size={14} />
                                            </button>
                                            <button
                                                onClick={() => handleDeleteSession(session.id)}
                                                className="p-1.5 text-zinc-500 hover:text-red-400 hover:bg-zinc-800 rounded transition-colors"
                                                title="删除会话"
                                            >
                                                <Trash2 size={14} />
                                            </button>
                                        </div>
                                    </div>

                                    {/* Original Prompt Display Area */}
                                    <div className="p-3 bg-zinc-950/50 border-b border-zinc-800/50">
                                        <div className="text-[0.625rem] font-medium text-zinc-500 mb-1">原始提示词 (Original Prompt)</div>
                                        <div className="text-xs text-zinc-300 bg-zinc-800/30 p-2 rounded border border-zinc-700/30 max-h-24 overflow-y-auto custom-scrollbar break-words whitespace-pre-wrap leading-relaxed select-text">
                                            {session.topic}
                                        </div>
                                    </div>

                                    {/* Chat History */}
                                    <div className="flex-1 overflow-y-auto p-3 space-y-3 custom-scrollbar bg-zinc-950/30">
                                        {session.messages.length === 0 ? (
                                            <div className="h-full flex flex-col items-center justify-center text-zinc-600 text-xs gap-2">
                                                <span className="italic">开始关于该主题的对话...</span>
                                                <button
                                                    onClick={() => {
                                                        updateSessionInput(session.id, "请帮我丰富和润色这个提示词");
                                                    }}
                                                    className="px-2 py-1 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-md border border-zinc-700 transition-colors"
                                                >
                                                    "请帮我丰富和润色这个提示词"
                                                </button>
                                            </div>
                                        ) : (
                                            session.messages.map(msg => (
                                                <div key={msg.id} className={`flex flex-col gap-1 ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                                                    <div
                                                        className={`max-w-[90%] rounded-lg p-2.5 text-sm whitespace-pre-wrap leading-relaxed relative group ${msg.role === 'user'
                                                            ? 'bg-emerald-900/30 text-emerald-100 border border-emerald-500/20'
                                                            : 'bg-zinc-800 text-zinc-200 border border-zinc-700 cursor-pointer hover:bg-zinc-700/50'
                                                            }`}
                                                        onClick={(e) => {
                                                            if (msg.role !== 'user') {
                                                                setClickHint({ show: true, x: e.clientX, y: e.clientY });
                                                                setTimeout(() => setClickHint({ show: false, x: 0, y: 0 }), 1500);
                                                            }
                                                        }}
                                                        onDoubleClick={() => msg.role !== 'user' && setExpandedMessageText(msg.text)}
                                                        title={msg.role !== 'user' ? '双击放大窗口查看结果' : undefined}
                                                    >
                                                        {msg.images && msg.images.length > 0 && (
                                                            <div className="flex flex-wrap gap-1 mb-2 justify-end">
                                                                {msg.images.map((img, idx) => (
                                                                    <img key={idx} src={img} className="w-16 h-16 object-cover rounded border border-zinc-700/50" alt="uploaded" />
                                                                ))}
                                                            </div>
                                                        )}
                                                        {msg.text}
                                                        <div className="absolute top-1 right-1 flex gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
                                                            {msg.role !== 'user' && (
                                                                <button
                                                                    onClick={(e) => { e.stopPropagation(); setExpandedMessageText(msg.text); }}
                                                                    className="p-1 rounded bg-black/20 text-white/70 hover:bg-black/40"
                                                                    title="放大查看"
                                                                >
                                                                    <Maximize2 size={10} />
                                                                </button>
                                                            )}
                                                            <button
                                                                onClick={(e) => { e.stopPropagation(); handleCopy(msg.text, msg.id); }}
                                                                className="p-1 rounded bg-black/20 text-white/70 hover:bg-black/40"
                                                                title="Copy"
                                                            >
                                                                {copiedId === msg.id ? <Check size={10} /> : <Copy size={10} />}
                                                            </button>
                                                        </div>
                                                    </div>
                                                    <span className="text-[0.625rem] text-zinc-600 px-1">
                                                        {msg.role === 'user' ? 'You' : 'AI'}
                                                    </span>
                                                </div>
                                            ))
                                        )}
                                        {/* 单击提示气泡 - 显示在鼠标位置 */}
                                        {clickHint.show && (
                                            <div
                                                className="fixed bg-emerald-600 text-white text-[0.5625rem] px-2 py-1 rounded shadow-lg whitespace-nowrap z-[9999] pointer-events-none"
                                                style={{ left: clickHint.x + 10, top: clickHint.y - 30 }}
                                            >
                                                👆 双击放大窗口查看结果
                                            </div>
                                        )}
                                        {session.isLoading && (
                                            <div className="flex justify-start">
                                                <div className="bg-zinc-800 rounded-lg p-3 flex items-center gap-2 text-zinc-400 text-xs">
                                                    <Loader2 size={14} className="animate-spin" />
                                                    Thinking...
                                                </div>
                                            </div>
                                        )}
                                    </div>

                                    {/* Footer Input */}
                                    <div
                                        className={`p-3 border-t border-zinc-800 bg-zinc-900 flex flex-col gap-2 relative transition-colors ${draggingSessionId === session.id ? 'bg-zinc-800' : ''}`}
                                        onDragOver={(e) => handleDragOver(e)}
                                        onDragEnter={(e) => handleDragEnter(e, session.id)}
                                        onDragLeave={(e) => handleDragLeave(e, session.id)}
                                        onDrop={(e) => handleDrop(e, session.id)}
                                    >
                                        {draggingSessionId === session.id && (
                                            <div className="absolute inset-0 z-20 bg-emerald-900/40 backdrop-blur-[1px] flex flex-col items-center justify-center border-2 border-emerald-500/50 border-dashed rounded-lg m-1 pointer-events-none">
                                                <Plus size={24} className="text-emerald-400 mb-1" />
                                                <span className="text-xs font-bold text-emerald-200 shadow-sm">松开添加图片</span>
                                            </div>
                                        )}

                                        {/* Attachments Preview */}
                                        {session.pendingAttachments && session.pendingAttachments.length > 0 && (
                                            <div className="flex gap-2 overflow-x-auto pb-2 custom-scrollbar">
                                                {session.pendingAttachments.map((img, i) => (
                                                    <div key={i} className="relative group w-12 h-12 shrink-0">
                                                        <img src={img} className="w-full h-full object-cover rounded border border-zinc-700" alt="pending" />
                                                        <button
                                                            onClick={() => removeAttachment(session.id, i)}
                                                            className="absolute -top-1 -right-1 bg-red-500 text-white rounded-full p-0.5 opacity-0 group-hover:opacity-100 transition-opacity"
                                                            title="删除图片"
                                                        >
                                                            <X size={8} />
                                                        </button>
                                                    </div>
                                                ))}
                                            </div>
                                        )}

                                        <div className="flex gap-2 items-end">
                                            <input
                                                type="file"
                                                ref={el => { fileInputRefs.current[session.id] = el; }}
                                                className="hidden"
                                                accept="image/*"
                                                multiple
                                                onChange={(e) => handleFileSelect(e, session.id)}
                                            />
                                            <button
                                                onClick={() => fileInputRefs.current[session.id]?.click()}
                                                className="p-2 bg-zinc-800 hover:bg-zinc-700 text-zinc-400 hover:text-zinc-200 rounded-lg border border-zinc-700 transition-colors shrink-0"
                                                title="上传参考图"
                                            >
                                                <ImageIcon size={18} />
                                            </button>
                                            <textarea
                                                value={session.inputText}
                                                onChange={(e) => updateSessionInput(session.id, e.target.value)}
                                                onKeyDown={(e) => {
                                                    if (e.key === 'Enter' && !e.shiftKey) {
                                                        e.preventDefault();
                                                        sendMessage(session.id);
                                                    }
                                                }}
                                                onPaste={(e) => handlePaste(e, session.id)}
                                                placeholder="输入消息 (支持粘贴/拖拽图片)..."
                                                className="flex-1 bg-zinc-950 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 resize-none h-[42px] custom-scrollbar"
                                                disabled={session.isLoading}
                                            />
                                            <button
                                                onClick={() => sendMessage(session.id)}
                                                disabled={(!(session.inputText || '').trim() && (!session.pendingAttachments || session.pendingAttachments.length === 0)) || session.isLoading}
                                                className="w-[42px] h-[42px] flex items-center justify-center bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg disabled:opacity-50 disabled:bg-zinc-700 transition-colors shrink-0"
                                            >
                                                <Send size={18} />
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* 消息放大模态框 */}
                {expandedMessageText && (
                    <div
                        className="fixed inset-0 bg-black/70 backdrop-blur-sm flex items-center justify-center z-[100] p-4 md:p-8"
                        onClick={() => setExpandedMessageText(null)}
                    >
                        <div
                            className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl flex flex-col max-w-[90vw] max-h-[85vh] w-full md:max-w-4xl overflow-hidden"
                            onClick={(e) => e.stopPropagation()}
                        >
                            {/* 头部 */}
                            <div className="flex items-center justify-between px-4 py-3 border-b border-zinc-800 bg-zinc-900/95 flex-shrink-0">
                                <div>
                                    <h3 className="text-sm font-semibold text-zinc-100">AI 回复</h3>
                                    <p className="text-[0.625rem] text-zinc-500">对话消息</p>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => {
                                            navigator.clipboard.writeText(expandedMessageText);
                                            setModalCopied(true);
                                            setTimeout(() => setModalCopied(false), 2000);
                                        }}
                                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all ${modalCopied
                                            ? 'bg-emerald-600 text-white'
                                            : 'bg-zinc-800 hover:bg-zinc-700 text-zinc-300 hover:text-white'
                                            }`}
                                        title="复制内容"
                                    >
                                        {modalCopied ? <Check size={14} /> : <Copy size={14} />}
                                        {modalCopied ? '已复制' : '复制'}
                                    </button>
                                    <button
                                        onClick={() => setExpandedMessageText(null)}
                                        className="p-2 text-zinc-500 hover:text-zinc-200 hover:bg-zinc-800 rounded-lg transition-colors"
                                        title="关闭 (ESC)"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>
                            </div>

                            {/* 内容 - 可滚动 */}
                            <div className="flex-1 overflow-y-auto p-4 md:p-6 custom-scrollbar">
                                <div className="text-sm md:text-base text-zinc-200 whitespace-pre-wrap leading-relaxed select-text">
                                    {expandedMessageText}
                                </div>
                            </div>

                            {/* 底部提示 */}
                            <div className="px-4 py-2 border-t border-zinc-800 bg-zinc-900/95 flex-shrink-0">
                                <p className="text-[0.625rem] text-zinc-600 text-center">
                                    双击文本区域或按 ESC 键关闭 · 可选中文字复制
                                </p>
                            </div>
                        </div>
                    </div>
                )}
            </div>

            {/* 项目管理面板 */}
            <ProjectPanel
                isOpen={showProjectPanel}
                onClose={() => setShowProjectPanel(false)}
                moduleId="desc-chat"
                currentProjectId={currentProject?.id}
                onProjectChange={(project) => {
                    setCurrentProject(project);
                    // 恢复项目状态，补充默认字段
                    if (project.currentState?.sessions) {
                        const restoredSessions = project.currentState.sessions.map((s: any) => ({
                            ...s,
                            inputText: s.inputText || '',
                            pendingAttachments: s.pendingAttachments || [],
                            isLoading: false,
                            messages: s.messages || []
                        }));
                        setSessions(restoredSessions);
                    }
                    setShowProjectPanel(false);
                }}
                onCreateNew={() => {
                    setSessions([]);
                    setCurrentProject(null);
                }}
            />
        </>
    );
};
