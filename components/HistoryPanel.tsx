/**
 * HistoryPanel - 历史记录管理系统 (升级版)
 * 支持永久保存、日期分组、视觉化预览、高级搜索和现代 UI
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { Search, RefreshCw, Trash2, Download, FileText, Lock, FolderOpen } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
    ModuleId,
    HistorySession,
    loadSessions,
    deleteSession,
    clearAllSessions,
    exportSessionAsJson,
    exportSessionAsText,
    formatSessionTime,
    getModuleName
} from '../services/historyService';

interface HistoryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    moduleId: ModuleId;
    onRestore: (session: HistorySession) => void;
}

// 日期分组标题
type GroupTitle = '今天' | '昨天' | '过去 7 天' | '更早';

interface GroupedSessions {
    title: GroupTitle;
    sessions: HistorySession[];
}

const HistoryPanel: React.FC<HistoryPanelProps> = ({
    isOpen,
    onClose,
    moduleId,
    onRestore
}) => {
    const { user } = useAuth();
    const [sessions, setSessions] = useState<HistorySession[]>([]);
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);

    // 搜索和筛选
    const [searchText, setSearchText] = useState('');

    // 展开的详情
    const [expandedId, setExpandedId] = useState<string | null>(null);

    // 清空确认
    const [clearConfirm, setClearConfirm] = useState(false);

    // 加载历史会话
    const loadHistory = useCallback(async () => {
        if (!user?.uid) return;

        setIsLoading(true);
        setError(null);

        try {
            // 不再清理过期会话，因为现在永久保存
            const data = await loadSessions(user.uid, moduleId, 200); // 增加可见数量
            setSessions(data);
        } catch (err: any) {
            console.error('[HistoryPanel] Load error:', err);
            setError(err.message || '加载失败');
        } finally {
            setIsLoading(false);
        }
    }, [user?.uid, moduleId]);

    // 打开时加载
    useEffect(() => {
        if (isOpen && user?.uid) {
            loadHistory();
            setExpandedId(null);
            setSearchText('');
        }
    }, [isOpen, user?.uid, loadHistory]);

    // 日期排序辅助函数
    const groupSessionsByDate = (inputSessions: HistorySession[]): GroupedSessions[] => {
        const now = new Date();
        now.setHours(0, 0, 0, 0);
        const todayMs = now.getTime();
        const yesterdayMs = todayMs - 24 * 60 * 60 * 1000;
        const last7DaysMs = todayMs - 7 * 24 * 60 * 60 * 1000;

        const groups: Record<GroupTitle, HistorySession[]> = {
            '今天': [],
            '昨天': [],
            '过去 7 天': [],
            '更早': []
        };

        inputSessions.forEach(session => {
            const time = session.createdAt.toMillis();
            if (time >= todayMs) {
                groups['今天'].push(session);
            } else if (time >= yesterdayMs) {
                groups['昨天'].push(session);
            } else if (time >= last7DaysMs) {
                groups['过去 7 天'].push(session);
            } else {
                groups['更早'].push(session);
            }
        });

        return (Object.entries(groups) as [GroupTitle, HistorySession[]][])
            .filter(([_, list]) => list.length > 0)
            .map(([title, list]) => ({ title, sessions: list }));
    };

    // 筛选并分组的会话
    const groupedData = useMemo(() => {
        let filtered = sessions;

        // 搜索筛选
        if (searchText.trim()) {
            const query = searchText.toLowerCase();
            filtered = filtered.filter(s =>
                s.title.toLowerCase().includes(query) ||
                s.preview.toLowerCase().includes(query)
            );
        }

        return groupSessionsByDate(filtered);
    }, [sessions, searchText]);

    // 删除会话
    const handleDelete = async (sessionId: string) => {
        if (!user?.uid) return;

        try {
            await deleteSession(user.uid, moduleId, sessionId);
            setSessions(prev => prev.filter(s => s.id !== sessionId));
            setDeleteConfirm(null);
            if (expandedId === sessionId) setExpandedId(null);
        } catch (err: any) {
            setError(err.message || '删除失败');
        }
    };

    // 清空所有历史
    const handleClearAll = async () => {
        if (!user?.uid) return;

        try {
            await clearAllSessions(user.uid, moduleId);
            setSessions([]);
            setClearConfirm(false);
            setExpandedId(null);
        } catch (err: any) {
            setError(err.message || '清空失败');
        }
    };

    // 导出会话
    const handleExport = (session: HistorySession, format: 'json' | 'txt') => {
        const content = format === 'json'
            ? exportSessionAsJson(session)
            : exportSessionAsText(session);

        const blob = new Blob([content], {
            type: format === 'json' ? 'application/json' : 'text/plain'
        });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${session.title}_${session.id.slice(0, 8)}.${format}`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    // 恢复会话
    const handleRestore = (session: HistorySession) => {
        onRestore(session);
        onClose();
    };

    // 渲染详细内容
    const renderDetailContent = (session: HistorySession) => {
        const data = session.data;

        switch (session.moduleId) {
            case 'image-recognition':
                if (data?.image) {
                    const getImageSrc = () => {
                        if (data.image.gyazoUrl) return data.image.gyazoUrl;
                        if (data.image.imageUrl && !data.image.imageUrl.startsWith('blob:')) return data.image.imageUrl;
                        if (data.image.originalInput && data.image.originalInput.startsWith('http')) return data.image.originalInput;
                        return null;
                    };
                    const imageSrc = getImageSrc();

                    return (
                        <div className="space-y-3">
                            {imageSrc && (
                                <div className="flex justify-center bg-black/40 p-2 rounded-lg border border-zinc-800">
                                    <img
                                        src={imageSrc}
                                        alt="识别图片"
                                        className="max-w-full max-h-48 rounded shadow-lg object-contain"
                                        onError={(e) => e.currentTarget.style.display = 'none'}
                                    />
                                </div>
                            )}
                            <div className="space-y-1">
                                <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">识别结果</div>
                                <div className="bg-zinc-800/80 p-3 rounded-lg text-sm text-zinc-200 leading-relaxed whitespace-pre-wrap max-h-60 overflow-y-auto border border-zinc-700/50">
                                    {data.image.result || '无结果'}
                                </div>
                            </div>
                            {data.prompt && (
                                <div className="text-xs text-zinc-500 italic">指令: {data.prompt}</div>
                            )}
                        </div>
                    );
                }
                break;

            case 'smart-translate':
                if (data?.original || data?.translated) {
                    return (
                        <div className="space-y-3">
                            <div className="space-y-1">
                                <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">原文</div>
                                <div className="bg-zinc-800/80 p-3 rounded-lg text-sm text-zinc-300 border border-zinc-700/50">
                                    {data.original || '无'}
                                </div>
                            </div>
                            <div className="space-y-1">
                                <div className="text-[10px] uppercase font-bold text-emerald-500/70 tracking-wider">译文</div>
                                <div className="bg-emerald-900/20 p-3 rounded-lg text-sm text-emerald-100 border border-emerald-800/30">
                                    {data.translated || '无'}
                                </div>
                            </div>
                        </div>
                    );
                }
                break;

            case 'desc-innovator':
                if (data?.session) {
                    return (
                        <div className="space-y-2">
                            <div className="text-[10px] uppercase font-bold text-zinc-500 tracking-wider">对话历史</div>
                            {data.session.messages?.slice(-3).map((msg: any, i: number) => (
                                <div key={i} className={`p-2.5 rounded-lg text-xs leading-relaxed ${msg.role === 'user' ? 'bg-amber-900/20 border border-amber-800/20 text-amber-100' : 'bg-zinc-800/80 border border-zinc-700/50 text-zinc-300'}`}>
                                    <span className="font-bold opacity-60 mr-1">{msg.role === 'user' ? 'YOU:' : 'AI:'}</span>
                                    {msg.text}
                                </div>
                            ))}
                        </div>
                    );
                }
                break;
        }

        return <div className="text-sm text-zinc-500 italic">无详细内容</div>;
    };

    if (!isOpen) return null;

    return (
        <>
            {/* 背景遮罩 */}
            <div
                className="fixed inset-0 bg-black/60 backdrop-blur-md z-[1000] animate-in fade-in duration-300"
                onClick={onClose}
            />

            {/* 侧边面板 */}
            <div
                className="fixed right-0 top-0 h-full w-[420px] max-w-[90vw] bg-zinc-950/90 backdrop-blur-xl shadow-[0_0_50px_rgba(0,0,0,0.5)] z-[1001] flex flex-col border-l border-zinc-800/50"
                style={{
                    animation: 'slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    boxShadow: '-10px 0 50px -15px rgba(0,0,0,0.5)'
                }}
            >
                {/* 头部 */}
                <div className="p-6 border-b border-zinc-800/50 space-y-4">
                    <div className="flex items-center justify-between">
                        <div>
                            <h2 className="text-xl font-bold bg-gradient-to-br from-white to-zinc-500 bg-clip-text text-transparent">
                                历史记录
                            </h2>
                            <p className="text-xs text-zinc-500 mt-1 flex items-center gap-1.5">
                                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse"></span>
                                {getModuleName(moduleId)} · {sessions.length} 条记录
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            className="w-8 h-8 flex items-center justify-center hover:bg-zinc-800 rounded-full transition-all text-zinc-500 hover:text-white"
                        >
                            ✕
                        </button>
                    </div>

                    {/* 搜索与工具 */}
                    <div className="flex gap-2">
                        <div className="relative flex-1 group">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-zinc-500 group-focus-within:text-amber-500 transition-colors" />
                            <input
                                type="text"
                                value={searchText}
                                onChange={(e) => setSearchText(e.target.value)}
                                placeholder="查找记录内容..."
                                className="w-full bg-zinc-900/50 border border-zinc-800 rounded-xl pl-9 pr-3 py-2.5 text-sm text-white placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-amber-500/50 focus:border-amber-500/50 transition-all"
                            />
                        </div>
                        <button
                            onClick={loadHistory}
                            disabled={isLoading}
                            className="w-10 h-10 flex items-center justify-center bg-zinc-900/50 border border-zinc-800 hover:bg-zinc-800 text-zinc-400 rounded-xl transition-all active:scale-95"
                            title="刷新列表"
                        >
                            <RefreshCw size={16} className={isLoading ? 'animate-spin' : ''} />
                        </button>
                    </div>

                    {/* 管理工具 */}
                    <div className="flex items-center justify-between px-1">
                        <div className="flex gap-2">
                            {/* 以后可以加标签/筛选按钮 */}
                        </div>

                        {clearConfirm ? (
                            <div className="flex items-center gap-2 animate-in zoom-in duration-200">
                                <span className="text-[10px] text-red-500 font-bold">确定清空吗？</span>
                                <button onClick={handleClearAll} className="px-2 py-1 bg-red-500/20 text-red-500 text-[10px] rounded border border-red-500/30 hover:bg-red-500 hover:text-white transition-all">确认</button>
                                <button onClick={() => setClearConfirm(false)} className="px-2 py-1 bg-zinc-800 text-zinc-400 text-[10px] rounded border border-zinc-700">取消</button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setClearConfirm(true)}
                                disabled={sessions.length === 0}
                                className="text-[10px] text-zinc-500 hover:text-red-400 flex items-center gap-1 transition-colors disabled:opacity-30"
                            >
                                <Trash2 size={12} /> 清空所有永久记录
                            </button>
                        )}
                    </div>
                </div>

                {/* 内容列表 */}
                <div className="flex-1 overflow-y-auto px-6 py-4 custom-scrollbar">
                    {/* 未登录 */}
                    {!user && (
                        <div className="h-full flex flex-col items-center justify-center text-center space-y-4 opacity-50">
                            <Lock size={48} className="opacity-50" />
                            <div className="space-y-1">
                                <p className="text-white font-medium">需要登录</p>
                                <p className="text-xs text-zinc-500">登录后即可同步和保存您的永久历史记录</p>
                            </div>
                        </div>
                    )}

                    {/* 加载中 */}
                    {user && isLoading && sessions.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center opacity-50">
                            <div className="w-8 h-8 border-2 border-zinc-800 border-t-amber-500 rounded-full animate-spin"></div>
                            <p className="text-xs text-zinc-500 mt-4">正在同步云端记录...</p>
                        </div>
                    )}

                    {/* 空状态 */}
                    {user && !isLoading && groupedData.length === 0 && (
                        <div className="h-full flex flex-col items-center justify-center text-center space-y-4 py-20">
                            <FolderOpen size={48} className="opacity-20" />
                            <div className="space-y-1">
                                <p className="text-zinc-400 font-medium">{searchText ? '未找到相关结果' : '暂无记录'}</p>
                                <p className="text-xs text-zinc-600">您的所有操作由于已设置为永久保存<br />将在这里长久留存</p>
                            </div>
                        </div>
                    )}

                    {/* 分组显示 */}
                    {user && groupedData.map(group => (
                        <div key={group.title} className="mb-8 animate-in slide-in-from-bottom-2 duration-400">
                            <h3 className="text-[10px] font-black text-zinc-600 uppercase tracking-[0.2em] mb-4 flex items-center gap-3">
                                {group.title}
                                <div className="h-[1px] flex-1 bg-zinc-800/50"></div>
                            </h3>

                            <div className="space-y-3">
                                {group.sessions.map(session => {
                                    // 缩略图提取
                                    const getThumbnail = () => {
                                        const data = session.data;
                                        if (session.moduleId === 'image-recognition' && data?.image) {
                                            return data.image.gyazoUrl || (data.image.imageUrl && !data.image.imageUrl.startsWith('blob:') ? data.image.imageUrl : null);
                                        }
                                        if (session.moduleId === 'smart-translate' && data?.item) {
                                            const item = data.item;
                                            return (item.sourceUrl && !item.sourceUrl.startsWith('blob:')) ? item.sourceUrl : (item.type === 'image' && item.content?.startsWith('data:') ? item.content : null);
                                        }
                                        return null;
                                    };
                                    const thumbnail = getThumbnail();
                                    const isExpanded = expandedId === session.id;

                                    return (
                                        <div
                                            key={session.id}
                                            className={`group relative bg-zinc-900/40 rounded-2xl border transition-all duration-300 overflow-hidden ${isExpanded ? 'border-amber-500/30 ring-1 ring-amber-500/10 bg-zinc-900/80 shadow-2xl' : 'border-zinc-800/50 hover:border-zinc-700 hover:bg-zinc-900/60'
                                                }`}
                                        >
                                            <div
                                                onClick={() => setExpandedId(isExpanded ? null : session.id)}
                                                className="p-4 cursor-pointer flex gap-4"
                                            >
                                                {/* 视觉标识 */}
                                                <div className="w-12 h-12 rounded-xl bg-zinc-800 flex-shrink-0 overflow-hidden border border-zinc-700/50 flex items-center justify-center relative">
                                                    {thumbnail ? (
                                                        <img src={thumbnail} className="w-full h-full object-cover" alt="" />
                                                    ) : (
                                                        <span className="text-xl opacity-40">
                                                            {session.moduleId === 'smart-translate' ? '文' : session.moduleId === 'desc-innovator' ? '💡' : '🖼️'}
                                                        </span>
                                                    )}
                                                </div>

                                                {/* 简要信息 */}
                                                <div className="flex-1 min-w-0">
                                                    <div className="flex items-start justify-between gap-2">
                                                        <h4 className={`text-sm font-medium truncate transition-colors ${isExpanded ? 'text-amber-100' : 'text-zinc-200 group-hover:text-white'}`}>
                                                            {session.title}
                                                        </h4>
                                                        <span className="text-[10px] text-zinc-600 tabular-nums whitespace-nowrap mt-1">
                                                            {formatSessionTime(session.createdAt)}
                                                        </span>
                                                    </div>
                                                    <p className={`text-xs mt-1 transition-all ${isExpanded ? 'text-zinc-400' : 'text-zinc-500 line-clamp-1'}`}>
                                                        {session.preview || '点击查看详情...'}
                                                    </p>
                                                </div>
                                            </div>

                                            {/* 扩展面板 */}
                                            {isExpanded && (
                                                <div className="px-4 pb-4 animate-in slide-in-from-top-2 duration-300">
                                                    <div className="border-t border-zinc-800/50 pt-4 mt-1 space-y-4">
                                                        {renderDetailContent(session)}

                                                        {/* 操作栏 */}
                                                        <div className="flex items-center gap-2 pt-2 border-t border-zinc-800/50">
                                                            <button
                                                                onClick={() => handleRestore(session)}
                                                                className="flex-1 h-9 flex items-center justify-center bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-xl transition-all active:scale-95 shadow-lg shadow-amber-900/20"
                                                            >
                                                                <Download size={14} /> 恢复到当前工作区
                                                            </button>

                                                            <div className="flex gap-1 h-9">
                                                                <button
                                                                    onClick={() => handleExport(session, 'txt')}
                                                                    className="w-9 h-9 flex items-center justify-center bg-zinc-800 hover:bg-zinc-700 text-zinc-400 rounded-xl transition-all"
                                                                    title="保存为文本"
                                                                >
                                                                    <FileText size={16} />
                                                                </button>

                                                                {deleteConfirm === session.id ? (
                                                                    <div className="flex items-center gap-1 bg-red-500/10 rounded-xl px-2 border border-red-500/20 animate-in fade-in zoom-in duration-200">
                                                                        <button onClick={() => handleDelete(session.id)} className="text-[10px] text-red-500 font-bold px-1">确认</button>
                                                                        <div className="w-[1px] h-3 bg-red-500/20"></div>
                                                                        <button onClick={() => setDeleteConfirm(null)} className="text-[10px] text-zinc-500 px-1">✕</button>
                                                                    </div>
                                                                ) : (
                                                                    <button
                                                                        onClick={() => setDeleteConfirm(session.id)}
                                                                        className="w-9 h-9 flex items-center justify-center bg-zinc-800/40 hover:bg-red-500/20 text-zinc-600 hover:text-red-400 rounded-xl transition-all"
                                                                        title="永久删除"
                                                                    >
                                                                        <Trash2 size={16} />
                                                                    </button>
                                                                )}
                                                            </div>
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            <style>{`
                @keyframes slideIn {
                    from { transform: translateX(100%); }
                    to { transform: translateX(0); }
                }
                .custom-scrollbar::-webkit-scrollbar {
                    width: 4px;
                }
                .custom-scrollbar::-webkit-scrollbar-track {
                    background: transparent;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb {
                    background: #27272a;
                    border-radius: 10px;
                }
                .custom-scrollbar::-webkit-scrollbar-thumb:hover {
                    background: #3f3f46;
                }
            `}</style>
        </>
    );
};

export default HistoryPanel;
