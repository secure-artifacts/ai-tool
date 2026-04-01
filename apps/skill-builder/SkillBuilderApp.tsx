/**
 * AI Skill Builder — 类似 GPTs / Gems 的 Skill 训练器
 *
 * 功能：
 * - 左侧聊天面板：与 AI 对话式训练 Skill
 * - 右侧结果面板：实时预览生成的 SKILL.md
 * - 侧边栏：已保存的 Skill 列表
 * - 自动从对话中提炼 name / description / instructions
 * - 导出为 SKILL.md 格式
 */
import React, { useState, useRef, useCallback, useEffect, useMemo, memo } from 'react';
import { v4 as uuidv4 } from 'uuid';
import ReactMarkdown from 'react-markdown';
import {
    Plus, Trash2, Send, Sparkles, X, Copy, Check, Loader2,
    PanelLeftClose, PanelLeftOpen, Bot, User, RotateCcw,
    Download, Pencil, FileText, Wand2, ChevronDown,
} from 'lucide-react';
import './SkillBuilder.css';

// ====== Types ======
interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
    timestamp: number;
}

interface SkillData {
    name: string;
    description: string;
    instructions: string;
}

interface SkillSession {
    id: string;
    title: string;
    messages: ChatMessage[];
    skill: SkillData;
    model: string;
    createdAt: number;
    updatedAt: number;
}

interface Props {
    getAiInstance: () => any;
    textModel?: string;
}

// ====== Constants ======
const STORAGE_KEY = 'skill_builder_sessions';
const MAX_SESSIONS = 30;

const SYSTEM_PROMPT = `你是一位专业的 AI Skill 训练师。你的任务是通过对话帮助用户创建高质量的 AI Skill（技能指令）。

## 你的工作流程：

1. **理解需求**：询问用户想要创建什么样的 Skill，了解它的用途、目标受众、期望的输入和输出。
2. **迭代优化**：根据用户的描述和反馈，逐步完善 Skill 的指令内容。
3. **结构化输出**：在每次回复的最后，用特殊的标记块输出当前最新版本的 Skill 定义：

\`\`\`skill
---
name: [Skill 名称，简短有力]
description: [一句话描述 Skill 的功能]
---
[完整的 Skill 指令内容，包含角色定义、工作流程、输入输出格式、约束条件等]
\`\`\`

## 重要规则：
- 每次回复都要包含 \`\`\`skill 代码块，即使只是微调也要给出完整版本
- Skill 指令要具体、可执行、无歧义
- 使用用户的语言回复（中文问中文答）
- 主动建议改进，如添加边界情况处理、输出格式规范等
- 如果用户只是简单描述，你要主动扩展和完善指令
- 初始对话时，先快速生成一个基础版本，然后引导用户逐步优化

## Skill 指令质量标准：
- ✅ 明确的角色定义
- ✅ 清晰的工作流程（分步骤）
- ✅ 输入/输出格式说明
- ✅ 约束条件和边界处理
- ✅ 质量自检规则`;

const SUGGESTIONS = [
    '帮我创建一个文案查重 Skill',
    '我想训练一个翻译助手',
    '创建一个代码审查 Skill',
    '帮我做一个产品描述词生成器',
];

// ====== Helpers ======
function loadSessions(): SkillSession[] {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        return raw ? JSON.parse(raw) : [];
    } catch { return []; }
}

function saveSessions(sessions: SkillSession[]) {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(sessions.slice(0, MAX_SESSIONS)));
    } catch (e) {
        console.warn('[SkillBuilder] Save failed:', e);
    }
}

function formatTime(ts: number): string {
    const d = new Date(ts);
    const now = new Date();
    const time = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' });
    if (d.toDateString() === now.toDateString()) return time;
    const yesterday = new Date(now);
    yesterday.setDate(yesterday.getDate() - 1);
    if (d.toDateString() === yesterday.toDateString()) return `昨天 ${time}`;
    return d.toLocaleDateString('zh-CN', { month: 'short', day: 'numeric' }) + ' ' + time;
}

/** 从 AI 回复中提取 ```skill ``` 代码块 */
function parseSkillBlock(text: string): SkillData | null {
    // Match ```skill ... ``` block
    const match = text.match(/```skill\s*\n([\s\S]*?)```/);
    if (!match) return null;
    const block = match[1].trim();

    // Parse frontmatter
    const fmMatch = block.match(/^---\s*\n([\s\S]*?)\n---\s*\n([\s\S]*)$/);
    if (!fmMatch) {
        return { name: '', description: '', instructions: block };
    }

    const frontmatter = fmMatch[1];
    const instructions = fmMatch[2].trim();

    const nameMatch = frontmatter.match(/name:\s*(.+)/);
    const descMatch = frontmatter.match(/description:\s*(.+)/);

    return {
        name: nameMatch ? nameMatch[1].trim() : '',
        description: descMatch ? descMatch[1].trim() : '',
        instructions,
    };
}

/** 构建带时间上下文的系统提示词 */
function buildSystemPrompt(): string {
    const now = new Date();
    const dateStr = now.toLocaleDateString('zh-CN', {
        year: 'numeric', month: 'long', day: 'numeric', weekday: 'long',
    });
    return `${SYSTEM_PROMPT}\n\nCurrent date: ${dateStr}. Timezone: ${Intl.DateTimeFormat().resolvedOptions().timeZone}.`;
}

/** 导出为 SKILL.md */
function exportSkillMd(skill: SkillData): string {
    return `---
name: ${skill.name}
description: ${skill.description}
---

${skill.instructions}`;
}

// ====== CodeBlock ======
const CodeBlock = memo(({ children, className }: { children: React.ReactNode; className?: string }) => {
    const [copied, setCopied] = useState(false);
    const language = className?.replace('language-', '') || '';
    const code = String(children).replace(/\n$/, '');
    // Don't render skill blocks as code — they are handled separately
    if (language === 'skill') return null;
    const handleCopy = () => {
        navigator.clipboard.writeText(code);
        setCopied(true);
        setTimeout(() => setCopied(false), 2000);
    };
    return (
        <div className="sb-code-block">
            <div className="sb-code-block-header">
                <span>{language || 'code'}</span>
                <button onClick={handleCopy}>
                    {copied ? <><Check size={12} /> 已复制</> : <><Copy size={12} /> 复制</>}
                </button>
            </div>
            <pre><code>{code}</code></pre>
        </div>
    );
});

// ====== Main Component ======
const SkillBuilderApp: React.FC<Props> = ({ getAiInstance, textModel }) => {
    // State
    const [sessions, setSessions] = useState<SkillSession[]>(() => loadSessions());
    const [activeId, setActiveId] = useState<string | null>(() => {
        const s = loadSessions();
        return s.length > 0 ? s[0].id : null;
    });
    const [inputText, setInputText] = useState('');
    const [isStreaming, setIsStreaming] = useState(false);
    const [streamingText, setStreamingText] = useState('');
    const [sidebarOpen, setSidebarOpen] = useState(true);
    const [copiedSkill, setCopiedSkill] = useState(false);
    const [editingTitle, setEditingTitle] = useState<string | null>(null);
    const [editTitleVal, setEditTitleVal] = useState('');
    const [copiedMsgId, setCopiedMsgId] = useState<string | null>(null);

    // Refs
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const abortRef = useRef(false);

    // Derived
    const activeSession = useMemo(
        () => sessions.find(s => s.id === activeId) || null,
        [sessions, activeId]
    );

    // Live skill from streaming
    const liveSkill = useMemo(() => {
        if (streamingText) {
            const parsed = parseSkillBlock(streamingText);
            if (parsed) return parsed;
        }
        return activeSession?.skill || null;
    }, [streamingText, activeSession]);

    // Persist
    useEffect(() => { saveSessions(sessions); }, [sessions]);

    // Auto scroll
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [activeSession?.messages, streamingText]);

    // Auto resize textarea
    useEffect(() => {
        const ta = textareaRef.current;
        if (!ta) return;
        ta.style.height = 'auto';
        ta.style.height = Math.min(ta.scrollHeight, 200) + 'px';
    }, [inputText]);

    // ====== Session Management ======
    const createSession = useCallback(() => {
        const session: SkillSession = {
            id: uuidv4(),
            title: '新 Skill',
            messages: [],
            skill: { name: '', description: '', instructions: '' },
            model: textModel || 'gemini-2.5-flash',
            createdAt: Date.now(),
            updatedAt: Date.now(),
        };
        setSessions(prev => [session, ...prev]);
        setActiveId(session.id);
        setInputText('');
        setTimeout(() => textareaRef.current?.focus(), 100);
    }, []);

    const deleteSession = useCallback((id: string) => {
        setSessions(prev => {
            const next = prev.filter(s => s.id !== id);
            if (activeId === id) {
                setActiveId(next.length > 0 ? next[0].id : null);
            }
            return next;
        });
    }, [activeId]);

    const renameSession = useCallback((id: string, title: string) => {
        setSessions(prev => prev.map(s => s.id === id ? { ...s, title } : s));
        setEditingTitle(null);
    }, []);

    // ====== Send Message ======
    const sendMessage = useCallback(async () => {
        const text = inputText.trim();
        if (!text || isStreaming) return;

        let sessId = activeId;
        let sess = activeSession;

        if (!sess) {
            const newSess: SkillSession = {
                id: uuidv4(), title: '新 Skill', messages: [],
                skill: { name: '', description: '', instructions: '' },
                model: textModel || 'gemini-2.5-flash', createdAt: Date.now(), updatedAt: Date.now(),
            };
            sessId = newSess.id;
            sess = newSess;
            setSessions(prev => [newSess, ...prev]);
            setActiveId(newSess.id);
        }

        const userMsg: ChatMessage = { id: uuidv4(), role: 'user', text, timestamp: Date.now() };
        const isFirst = sess.messages.length === 0;
        const newTitle = isFirst ? (text.length <= 20 ? text : text.substring(0, 20) + '…') : sess.title;

        setSessions(prev => prev.map(s =>
            s.id === sessId ? { ...s, messages: [...s.messages, userMsg], title: newTitle, updatedAt: Date.now() } : s
        ));
        setInputText('');
        setIsStreaming(true);
        setStreamingText('');
        abortRef.current = false;

        try {
            const ai = getAiInstance();
            const allMessages = [...sess.messages, userMsg];
            const contents = allMessages.map(msg => ({
                role: msg.role,
                parts: [{ text: msg.text }],
            }));

            const responseStream = await ai.models.generateContentStream({
                model: sess.model,
                contents,
                config: {
                    systemInstruction: buildSystemPrompt(),
                    temperature: 0.7,
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

            // Parse skill from response
            const parsedSkill = parseSkillBlock(fullText);
            const assistantMsg: ChatMessage = { id: uuidv4(), role: 'model', text: fullText, timestamp: Date.now() };

            setSessions(prev => prev.map(s => {
                if (s.id !== sessId) return s;
                const updatedSkill = parsedSkill || s.skill;
                const updatedTitle = isFirst && parsedSkill?.name ? parsedSkill.name : s.title;
                return {
                    ...s,
                    messages: [...s.messages, assistantMsg],
                    skill: updatedSkill,
                    title: updatedTitle,
                    updatedAt: Date.now(),
                };
            }));
        } catch (err: any) {
            console.error('[SkillBuilder] Error:', err);
            const errorMsg: ChatMessage = {
                id: uuidv4(), role: 'model',
                text: `❌ 错误: ${err.message || '请求失败，请重试'}`,
                timestamp: Date.now(),
            };
            setSessions(prev => prev.map(s =>
                s.id === sessId ? { ...s, messages: [...s.messages, errorMsg], updatedAt: Date.now() } : s
            ));
        } finally {
            setIsStreaming(false);
            setStreamingText('');
        }
    }, [inputText, isStreaming, activeId, activeSession, getAiInstance]);

    const stopStreaming = useCallback(() => { abortRef.current = true; }, []);

    // ====== Copy / Export ======
    const copySkill = useCallback(() => {
        if (!liveSkill) return;
        navigator.clipboard.writeText(exportSkillMd(liveSkill));
        setCopiedSkill(true);
        setTimeout(() => setCopiedSkill(false), 2000);
    }, [liveSkill]);

    const downloadSkill = useCallback(() => {
        if (!liveSkill) return;
        const content = exportSkillMd(liveSkill);
        const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${liveSkill.name || 'SKILL'}.md`;
        a.click();
        URL.revokeObjectURL(url);
    }, [liveSkill]);

    const copyMessage = useCallback((id: string, text: string) => {
        navigator.clipboard.writeText(text);
        setCopiedMsgId(id);
        setTimeout(() => setCopiedMsgId(null), 2000);
    }, []);

    // ====== Key handler ======
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        if (e.nativeEvent.isComposing || e.keyCode === 229) return;
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
        }
    }, [sendMessage]);

    // ====== Markdown components ======
    const mdComponents = useMemo(() => ({
        code: ({ className, children, ...props }: any) => {
            const isBlock = className || String(children).includes('\n');
            if (isBlock) return <CodeBlock className={className}>{children}</CodeBlock>;
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
        h1: ({ children }: any) => <h1 style={{ fontSize: '1.2em', margin: '10px 0 5px', fontWeight: 700, color: '#e2e8f0' }}>{children}</h1>,
        h2: ({ children }: any) => <h2 style={{ fontSize: '1.1em', margin: '8px 0 4px', fontWeight: 600, color: '#e2e8f0' }}>{children}</h2>,
        h3: ({ children }: any) => <h3 style={{ fontSize: '1em', margin: '6px 0 3px', fontWeight: 600, color: '#e2e8f0' }}>{children}</h3>,
        blockquote: ({ children }: any) => (
            <blockquote style={{
                borderLeft: '3px solid #a78bfa', margin: '8px 0', padding: '4px 12px',
                background: 'rgba(139,92,246,0.08)', borderRadius: '0 6px 6px 0', color: '#a1a1aa',
            }}>{children}</blockquote>
        ),
        a: ({ children, href }: any) => (
            <a href={href} target="_blank" rel="noopener noreferrer" style={{ color: '#818cf8', textDecoration: 'underline' }}>{children}</a>
        ),
    }), []);

    /** Strip the ```skill block from display text */
    const stripSkillBlock = (text: string) => text.replace(/```skill\s*\n[\s\S]*?```/g, '').trim();

    // ====== Render ======
    return (
        <div className="skill-builder">
            {/* ====== Sidebar ====== */}
            <div className={`sb-sidebar ${sidebarOpen ? '' : 'collapsed'}`}>
                <div className="sb-sidebar-header">
                    <button className="sb-new-btn" onClick={createSession}>
                        <Plus size={14} /> 新建 Skill
                    </button>
                    <button className="sb-collapse-btn" onClick={() => setSidebarOpen(false)}>
                        <PanelLeftClose size={16} />
                    </button>
                </div>

                <div className="sb-skill-list">
                    {sessions.length === 0 && (
                        <div className="sb-sidebar-empty">
                            <Wand2 size={28} style={{ margin: '0 auto 10px', opacity: 0.3 }} />
                            <p>还没有 Skill</p>
                            <p style={{ fontSize: '11px', marginTop: '4px' }}>点击"新建 Skill"开始训练</p>
                        </div>
                    )}
                    {sessions.map(sess => (
                        <div
                            key={sess.id}
                            className={`sb-skill-item ${sess.id === activeId ? 'active' : ''}`}
                            onClick={() => setActiveId(sess.id)}
                        >
                            {editingTitle === sess.id ? (
                                <input
                                    autoFocus
                                    value={editTitleVal}
                                    onChange={e => setEditTitleVal(e.target.value)}
                                    onBlur={() => renameSession(sess.id, editTitleVal)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter') renameSession(sess.id, editTitleVal);
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
                                    <div className="sb-skill-item-title">{sess.title}</div>
                                    <div className="sb-skill-item-meta">
                                        <span>{sess.messages.length} 条 · {formatTime(sess.updatedAt)}</span>
                                        {sess.id === activeId && (
                                            <div className="sb-skill-item-actions" onClick={e => e.stopPropagation()}>
                                                <button onClick={() => { setEditingTitle(sess.id); setEditTitleVal(sess.title); }}>
                                                    <Pencil size={12} />
                                                </button>
                                                <button onClick={() => deleteSession(sess.id)}>
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
            </div>

            {/* ====== Main Content ====== */}
            <div className="sb-main">
                {/* ====== Chat Panel ====== */}
                <div className="sb-chat-panel">
                    <div className="sb-chat-header">
                        {!sidebarOpen && (
                            <button className="sb-collapse-btn" onClick={() => setSidebarOpen(true)}>
                                <PanelLeftOpen size={16} />
                            </button>
                        )}
                        <div className="sb-chat-header-title">
                            <div className="sb-chat-header-badge">
                                <Sparkles size={14} style={{ color: '#a78bfa' }} />
                            </div>
                            Skill 训练对话
                        </div>
                        <div style={{ flex: 1 }} />
                        <span style={{ fontSize: '11px', color: '#52525b' }}>
                            {activeSession?.messages.length || 0} 条消息
                        </span>
                    </div>

                    {/* Messages */}
                    <div className="sb-chat-messages">
                        {(!activeSession || activeSession.messages.length === 0) && !isStreaming && (
                            <div className="sb-chat-empty">
                                <div className="sb-chat-empty-icon">
                                    <Wand2 size={44} style={{ color: '#6d28d9' }} />
                                </div>
                                <h2>开始训练你的 Skill</h2>
                                <p>描述你想要创建的 AI 技能，我会通过对话帮你迭代出高质量的 SKILL.md 指令</p>
                                <div className="sb-suggestion-chips">
                                    {SUGGESTIONS.map(s => (
                                        <button
                                            key={s}
                                            className="sb-suggestion-chip"
                                            onClick={() => { setInputText(s); textareaRef.current?.focus(); }}
                                        >
                                            {s}
                                        </button>
                                    ))}
                                </div>
                            </div>
                        )}

                        {activeSession?.messages.map(msg => {
                            const displayText = msg.role === 'model' ? stripSkillBlock(msg.text) : msg.text;
                            return (
                                <div key={msg.id} className={`sb-msg ${msg.role}`}>
                                    <div className={`sb-msg-avatar ${msg.role === 'user' ? 'user-avatar' : 'model-avatar'}`}>
                                        {msg.role === 'user' ? <User size={14} color="#fff" /> : <Bot size={14} color="#fff" />}
                                    </div>
                                    <div className="sb-msg-content">
                                        <div className={`sb-msg-bubble ${msg.role === 'user' ? 'user-bubble' : 'model-bubble'}`}>
                                            {msg.role === 'model' ? (
                                                <ReactMarkdown components={mdComponents}>{displayText}</ReactMarkdown>
                                            ) : (
                                                <div style={{ whiteSpace: 'pre-wrap' }}>{displayText}</div>
                                            )}
                                        </div>
                                        <div className="sb-msg-footer">
                                            <span>{formatTime(msg.timestamp)}</span>
                                            <button onClick={() => copyMessage(msg.id, msg.text)}>
                                                {copiedMsgId === msg.id ? <Check size={12} color="#22c55e" /> : <Copy size={12} />}
                                            </button>
                                        </div>
                                    </div>
                                </div>
                            );
                        })}

                        {/* Streaming */}
                        {isStreaming && (
                            <div className="sb-msg model">
                                <div className="sb-msg-avatar model-avatar">
                                    <Bot size={14} color="#fff" />
                                </div>
                                <div className="sb-msg-content">
                                    <div className="sb-msg-bubble model-bubble">
                                        {streamingText ? (
                                            <ReactMarkdown components={mdComponents}>
                                                {stripSkillBlock(streamingText)}
                                            </ReactMarkdown>
                                        ) : (
                                            <div className="sb-streaming-dots">
                                                <div className="sb-streaming-dot" />
                                                <div className="sb-streaming-dot" />
                                                <div className="sb-streaming-dot" />
                                            </div>
                                        )}
                                    </div>
                                    {streamingText && (
                                        <button
                                            onClick={stopStreaming}
                                            style={{
                                                marginTop: '4px', display: 'flex', alignItems: 'center', gap: '4px',
                                                background: 'none', border: 'none', cursor: 'pointer',
                                                color: '#ef4444', fontSize: '11px',
                                            }}
                                        >
                                            <X size={12} /> 停止生成
                                        </button>
                                    )}
                                </div>
                            </div>
                        )}
                        <div ref={messagesEndRef} />
                    </div>

                    {/* Input */}
                    <div className="sb-chat-input-area">
                        <div className="sb-chat-input-box">
                            <textarea
                                ref={textareaRef}
                                value={inputText}
                                onChange={e => setInputText(e.target.value)}
                                onKeyDown={handleKeyDown}
                                placeholder="描述你的 Skill 需求，或提出修改意见... (Shift+Enter 换行)"
                                rows={1}
                            />
                            {isStreaming ? (
                                <button className="sb-stop-btn" onClick={stopStreaming}>
                                    <X size={14} /> 停止
                                </button>
                            ) : (
                                <button
                                    className={`sb-send-btn ${inputText.trim() ? 'active' : 'inactive'}`}
                                    onClick={sendMessage}
                                    disabled={!inputText.trim()}
                                >
                                    <Send size={14} />
                                </button>
                            )}
                        </div>
                    </div>
                </div>

                {/* ====== Divider ====== */}
                <div className="sb-divider" />

                {/* ====== Result Panel ====== */}
                <div className="sb-result-panel">
                    <div className="sb-result-header">
                        <h3>🎯 训练结果</h3>
                        <div className="sb-result-actions">
                            <button className="sb-result-action-btn" onClick={copySkill} disabled={!liveSkill?.instructions}>
                                {copiedSkill ? <><Check size={12} /> 已复制</> : <><Copy size={12} /> 复制全文</>}
                            </button>
                            <button className="sb-result-action-btn" onClick={downloadSkill} disabled={!liveSkill?.instructions}>
                                <Download size={12} /> 导出 .md
                            </button>
                        </div>
                    </div>

                    <div className="sb-result-content">
                        {liveSkill && liveSkill.instructions ? (
                            <div className="sb-skill-preview">
                                {/* Name */}
                                <div className="sb-skill-field">
                                    <div className="sb-skill-field-label">Skill 名称</div>
                                    <input
                                        value={liveSkill.name}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setSessions(prev => prev.map(s =>
                                                s.id === activeId ? { ...s, skill: { ...s.skill, name: val } } : s
                                            ));
                                        }}
                                        placeholder="输入 Skill 名称..."
                                    />
                                </div>

                                {/* Description */}
                                <div className="sb-skill-field">
                                    <div className="sb-skill-field-label">描述</div>
                                    <input
                                        value={liveSkill.description}
                                        onChange={e => {
                                            const val = e.target.value;
                                            setSessions(prev => prev.map(s =>
                                                s.id === activeId ? { ...s, skill: { ...s.skill, description: val } } : s
                                            ));
                                        }}
                                        placeholder="一句话描述..."
                                    />
                                </div>

                                {/* Instructions */}
                                <div className="sb-skill-field">
                                    <div className="sb-skill-field-label">指令内容</div>
                                    <div className="sb-skill-instruction-box">
                                        <div className="sb-skill-instruction-header">
                                            <span><FileText size={12} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} />SKILL.md</span>
                                            <span>{liveSkill.instructions.length} 字</span>
                                        </div>
                                        <div className="sb-skill-instruction-content">
                                            {liveSkill.instructions}
                                        </div>
                                    </div>
                                </div>
                            </div>
                        ) : (
                            <div className="sb-result-empty">
                                <div className="sb-result-empty-icon">📝</div>
                                <h3>等待训练结果</h3>
                                <p>在左侧对话中描述你想要的 Skill，AI 会自动生成结构化的指令，并在这里实时预览</p>
                            </div>
                        )}
                    </div>

                    {/* Status bar */}
                    <div className="sb-status-bar">
                        <div className={`sb-status-dot ${isStreaming ? 'streaming' : liveSkill?.instructions ? 'done' : 'idle'}`} />
                        {isStreaming ? '正在生成...' : liveSkill?.instructions ? `就绪 · ${liveSkill.instructions.length} 字` : '等待输入'}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default SkillBuilderApp;
