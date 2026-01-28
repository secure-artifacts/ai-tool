/**
 * AI Tools Directory v1.6.0 - 完整版 + 社区分享
 * 功能：
 * 1. 44个预设AI工具
 * 2. AI URL分析器 - 粘贴链接自动识别工具信息
 * 3. 本地存储 - 用户自定义工具
 * 4. 社区分享 - Firestore同步
 * 5. 搜索、分类、安全筛选
 */

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import {
    Search, LayoutGrid, List, Copy, Check, Plus, X, Loader2,
    AlertTriangle, Sparkles, Filter, Link2, Trash2, Share2, Globe,
    Users, RefreshCw
} from 'lucide-react';
import { AITool, AIToolFilterState } from './types';
import { PRESET_AI_TOOLS, CATEGORY_LABELS, SAFETY_LABELS, PRICING_LABELS } from './presetData';
import {
    loadPublicTools,
    shareToolToPublic,
    deleteSharedTool,
    canDeleteTool,
    SharedAITool
} from './publicToolsService';

type ViewMode = 'grid' | 'list';
type SourceFilter = 'all' | 'preset' | 'custom' | 'community';

interface AIToolsDirectoryAppProps {
    getAiInstance?: () => any;
    textModel?: string;
    currentUser?: { email: string; displayName?: string } | null;
}

// LocalStorage key for custom tools
const CUSTOM_TOOLS_KEY = 'ai-tools-custom';

export default function AIToolsDirectoryApp({ getAiInstance, textModel, currentUser }: AIToolsDirectoryAppProps) {
    const [filters, setFilters] = useState<AIToolFilterState>({
        search: '',
        category: '',
        pricing: '',
        safety: ''
    });
    const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
    const [viewMode, setViewMode] = useState<ViewMode>('grid');
    const [copiedId, setCopiedId] = useState<string | null>(null);

    // Custom tools from localStorage
    const [customTools, setCustomTools] = useState<AITool[]>([]);

    // Community tools from Firestore
    const [communityTools, setCommunityTools] = useState<SharedAITool[]>([]);
    const [loadingCommunity, setLoadingCommunity] = useState(false);

    // Add tool modal state
    const [showAddModal, setShowAddModal] = useState(false);
    const [urlInput, setUrlInput] = useState('');
    const [isAnalyzing, setIsAnalyzing] = useState(false);
    const [analyzedTool, setAnalyzedTool] = useState<Partial<AITool> | null>(null);
    const [analyzeError, setAnalyzeError] = useState<string | null>(null);

    // Share modal state
    const [showShareModal, setShowShareModal] = useState(false);
    const [toolToShare, setToolToShare] = useState<AITool | null>(null);
    const [isSharing, setIsSharing] = useState(false);
    const [shareAsAnonymous, setShareAsAnonymous] = useState(false);

    // Load custom tools from localStorage
    useEffect(() => {
        try {
            const saved = localStorage.getItem(CUSTOM_TOOLS_KEY);
            if (saved) {
                setCustomTools(JSON.parse(saved));
            }
        } catch (e) {
            console.error('Failed to load custom tools:', e);
        }
    }, []);

    // Load community tools from Firestore
    const loadCommunityTools = useCallback(async () => {
        setLoadingCommunity(true);
        try {
            const tools = await loadPublicTools();
            setCommunityTools(tools);
        } catch (e) {
            console.error('Failed to load community tools:', e);
        } finally {
            setLoadingCommunity(false);
        }
    }, []);

    useEffect(() => {
        loadCommunityTools();
    }, [loadCommunityTools]);

    // Save custom tools to localStorage
    const saveCustomTools = useCallback((tools: AITool[]) => {
        try {
            localStorage.setItem(CUSTOM_TOOLS_KEY, JSON.stringify(tools));
            setCustomTools(tools);
        } catch (e) {
            console.error('Failed to save custom tools:', e);
        }
    }, []);

    // All tools = preset + custom + community
    const allTools = useMemo(() => {
        const preset = PRESET_AI_TOOLS.map(t => ({ ...t, source: 'preset' as const }));
        const custom = customTools.map(t => ({ ...t, isCustom: true, source: 'custom' as const }));
        const community = communityTools.map(t => ({ ...t, source: 'community' as const }));
        return [...preset, ...custom, ...community];
    }, [customTools, communityTools]);

    // Filter tools
    const filteredTools = useMemo(() => {
        return allTools.filter(tool => {
            // Source filter
            if (sourceFilter !== 'all') {
                if (sourceFilter === 'preset' && (tool as any).source !== 'preset') return false;
                if (sourceFilter === 'custom' && (tool as any).source !== 'custom') return false;
                if (sourceFilter === 'community' && (tool as any).source !== 'community') return false;
            }
            if (filters.search) {
                const searchLower = filters.search.toLowerCase();
                const matchesSearch =
                    tool.name.toLowerCase().includes(searchLower) ||
                    tool.description.toLowerCase().includes(searchLower) ||
                    tool.tags?.some(tag => tag.toLowerCase().includes(searchLower));
                if (!matchesSearch) return false;
            }
            if (filters.category && tool.category !== filters.category) return false;
            if (filters.pricing && tool.pricing !== filters.pricing) return false;
            if (filters.safety && tool.safety !== filters.safety) return false;
            return true;
        });
    }, [allTools, filters, sourceFilter]);

    // Category stats
    const categoryStats = useMemo(() => {
        const stats: Record<string, number> = {};
        allTools.forEach(tool => {
            stats[tool.category] = (stats[tool.category] || 0) + 1;
        });
        return stats;
    }, [allTools]);

    // Copy URL to clipboard
    const handleCopyUrl = (tool: AITool) => {
        navigator.clipboard.writeText(tool.website).then(() => {
            setCopiedId(tool.id);
            setTimeout(() => setCopiedId(null), 1500);
        });
    };

    // Delete custom tool
    const handleDeleteTool = (toolId: string) => {
        const updated = customTools.filter(t => t.id !== toolId);
        saveCustomTools(updated);
    };

    // Delete community tool (only owner)
    const handleDeleteCommunityTool = async (tool: SharedAITool) => {
        if (!currentUser?.email) {
            alert('请先登录');
            return;
        }
        if (!canDeleteTool(tool, currentUser.email)) {
            alert('只能删除自己分享的工具');
            return;
        }
        if (!tool.docId) return;

        try {
            await deleteSharedTool(tool.docId, currentUser.email, tool);
            await loadCommunityTools(); // Refresh
        } catch (e) {
            alert(e instanceof Error ? e.message : '删除失败');
        }
    };

    // Open share modal
    const handleOpenShareModal = (tool: AITool) => {
        if (!currentUser?.email) {
            alert('请先登录才能分享工具');
            return;
        }
        setToolToShare(tool);
        setShareAsAnonymous(false);
        setShowShareModal(true);
    };

    // Share tool to community
    const handleShareTool = async () => {
        if (!toolToShare || !currentUser?.email) return;

        setIsSharing(true);
        try {
            await shareToolToPublic(
                toolToShare,
                currentUser.email,
                shareAsAnonymous ? undefined : currentUser.displayName
            );
            setShowShareModal(false);
            setToolToShare(null);
            await loadCommunityTools(); // Refresh
        } catch (e) {
            alert(e instanceof Error ? e.message : '分享失败');
        } finally {
            setIsSharing(false);
        }
    };

    // AI URL Analyzer
    const handleAnalyzeUrl = async () => {
        if (!urlInput.trim()) return;
        if (!getAiInstance) {
            setAnalyzeError('AI功能不可用，请确保已配置 API Key');
            return;
        }

        setIsAnalyzing(true);
        setAnalyzeError(null);
        setAnalyzedTool(null);

        try {
            const ai = getAiInstance();
            const prompt = `分析以下网站URL，提取AI工具信息，返回JSON格式（不要markdown代码块）：

URL: ${urlInput}

请返回以下格式的JSON：
{
    "name": "工具名称",
    "category": "chatbot/image/video/audio/writing/code/productivity/other 之一",
    "website": "官网URL",
    "description": "50字以内的中文简介",
    "pricing": "free/freemium/paid/trial 之一",
    "freeQuota": "免费额度说明（如有）",
    "tags": ["标签1", "标签2"],
    "safety": "safe/unknown/unsafe 之一，根据网站知名度判断"
}

注意：
1. 如果无法访问或识别，返回 {"error": "原因"}
2. description 用简洁中文
3. 根据实际情况填写，不要编造`;

            const response = await ai.models.generateContent({
                model: textModel || 'gemini-2.0-flash',
                contents: prompt
            });

            let responseText = response.text || '';
            // Clean markdown code blocks
            if (responseText.startsWith('```')) {
                responseText = responseText.replace(/^```json?\s*/, '').replace(/```\s*$/, '');
            }

            const parsed = JSON.parse(responseText);

            if (parsed.error) {
                setAnalyzeError(parsed.error);
            } else {
                // Extract domain for favicon
                try {
                    const url = new URL(parsed.website || urlInput);
                    parsed.icon = `https://www.google.com/s2/favicons?domain=${url.hostname}&sz=64`;
                } catch {
                    // Ignore URL parse errors
                }
                parsed.id = `custom-${Date.now()}`;
                setAnalyzedTool(parsed);
            }
        } catch (e) {
            console.error('URL analysis failed:', e);
            setAnalyzeError(e instanceof Error ? e.message : '分析失败，请检查URL');
        } finally {
            setIsAnalyzing(false);
        }
    };

    // Save analyzed tool
    const handleSaveAnalyzedTool = () => {
        if (!analyzedTool) return;

        const newTool: AITool = {
            id: analyzedTool.id || `custom-${Date.now()}`,
            name: analyzedTool.name || 'Unknown',
            category: (analyzedTool.category as AITool['category']) || 'other',
            icon: analyzedTool.icon,
            website: analyzedTool.website || urlInput,
            description: analyzedTool.description || '',
            pricing: (analyzedTool.pricing as AITool['pricing']) || 'freemium',
            freeQuota: analyzedTool.freeQuota,
            tags: analyzedTool.tags,
            safety: (analyzedTool.safety as AITool['safety']) || 'unknown',
            isCustom: true
        };

        saveCustomTools([...customTools, newTool]);
        setShowAddModal(false);
        setUrlInput('');
        setAnalyzedTool(null);
    };

    // Navigate to software directory
    const handleNavigateToDirectory = () => {
        window.dispatchEvent(new CustomEvent('navigate-to-tool', { detail: 'directory' }));
    };

    return (
        <div className="h-full flex flex-col bg-[#0a0f1a] overflow-hidden">
            {/* Header */}
            <header className="bg-[#111827] border-b border-slate-700/50 px-4 py-3 shadow-sm flex-shrink-0">
                <div className="max-w-7xl mx-auto">
                    <div className="flex items-center justify-between mb-3">
                        <div className="flex items-center gap-3">
                            <div className="bg-gradient-to-br from-purple-600 to-indigo-600 p-2 rounded-xl shadow-sm">
                                <Sparkles className="text-white" size={22} />
                            </div>
                            <div>
                                <h1 className="text-lg font-bold text-white">AI 常用工具</h1>
                                <p className="text-xs text-slate-400">精选 {allTools.length} 个常用 AI 工具</p>
                            </div>
                        </div>
                        <div className="flex items-center gap-2">
                            <button
                                onClick={() => setShowAddModal(true)}
                                className="flex items-center gap-1 px-3 py-1.5 bg-purple-600 text-white text-sm rounded-lg hover:bg-purple-700 transition-colors"
                            >
                                <Plus size={16} />
                                添加工具
                            </button>
                            <button
                                onClick={() => setViewMode('grid')}
                                className={`p-2 rounded-lg transition-colors ${viewMode === 'grid' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                            >
                                <LayoutGrid size={18} />
                            </button>
                            <button
                                onClick={() => setViewMode('list')}
                                className={`p-2 rounded-lg transition-colors ${viewMode === 'list' ? 'bg-slate-700 text-white' : 'text-slate-400 hover:text-white'}`}
                            >
                                <List size={18} />
                            </button>
                        </div>
                    </div>

                    {/* Search & Filters */}
                    <div className="flex flex-wrap items-center gap-3">
                        <div className="flex-1 min-w-[200px] relative">
                            <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                            <input
                                type="text"
                                placeholder="搜索工具名称、描述、标签..."
                                value={filters.search}
                                onChange={(e) => setFilters(f => ({ ...f, search: e.target.value }))}
                                className="w-full pl-9 pr-4 py-2 text-sm text-white bg-slate-800/50 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/30 focus:border-purple-500 placeholder-slate-500"
                            />
                        </div>
                        <select
                            value={filters.category}
                            onChange={(e) => setFilters(f => ({ ...f, category: e.target.value }))}
                            className="px-3 py-2 text-sm text-white bg-slate-800/50 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                        >
                            <option value="">全部分类</option>
                            {Object.entries(CATEGORY_LABELS).map(([key, label]) => (
                                <option key={key} value={key}>{label} ({categoryStats[key] || 0})</option>
                            ))}
                        </select>
                        <select
                            value={filters.pricing}
                            onChange={(e) => setFilters(f => ({ ...f, pricing: e.target.value }))}
                            className="px-3 py-2 text-sm text-white bg-slate-800/50 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                        >
                            <option value="">全部价格</option>
                            {Object.entries(PRICING_LABELS).map(([key, label]) => (
                                <option key={key} value={key}>{label}</option>
                            ))}
                        </select>
                        <select
                            value={filters.safety}
                            onChange={(e) => setFilters(f => ({ ...f, safety: e.target.value }))}
                            className="px-3 py-2 text-sm text-white bg-slate-800/50 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                        >
                            <option value="">全部安全等级</option>
                            {Object.entries(SAFETY_LABELS).map(([key, { label }]) => (
                                <option key={key} value={key}>{label}</option>
                            ))}
                        </select>
                        <select
                            value={sourceFilter}
                            onChange={(e) => setSourceFilter(e.target.value as SourceFilter)}
                            className="px-3 py-2 text-sm text-white bg-slate-800/50 border border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/30"
                        >
                            <option value="all">全部来源</option>
                            <option value="preset">预设 ({PRESET_AI_TOOLS.length})</option>
                            <option value="custom">自定义 ({customTools.length})</option>
                            <option value="community">社区 ({communityTools.length})</option>
                        </select>
                        <button
                            onClick={loadCommunityTools}
                            disabled={loadingCommunity}
                            className="p-2 text-slate-400 hover:text-purple-400 hover:bg-purple-500/10 rounded-lg transition-colors disabled:opacity-50"
                            title="刷新社区工具"
                        >
                            <RefreshCw size={18} className={loadingCommunity ? 'animate-spin' : ''} />
                        </button>
                    </div>
                </div>
            </header>

            {/* Disclaimer */}
            <div className="bg-amber-900/20 border-b border-amber-800/30 px-4 py-2 flex-shrink-0">
                <div className="max-w-7xl mx-auto flex items-center gap-2 text-xs text-amber-400">
                    <AlertTriangle size={14} />
                    <span>
                        <strong>提醒：</strong>版权、安全、简介等所有信息仅供参考，详情请自行查阅相关网站。
                        链接需复制后在浏览器打开。安全信息可参考
                        <button onClick={handleNavigateToDirectory} className="text-blue-400 hover:underline ml-1">
                            AI软件目录
                        </button>。
                    </span>
                </div>
            </div>

            {/* Content */}
            <main className="flex-1 overflow-y-auto p-4">
                <div className="max-w-7xl mx-auto">
                    <div className="text-sm text-slate-400 mb-4">
                        共找到 <span className="font-medium text-white">{filteredTools.length}</span> 个工具
                        {customTools.length > 0 && (
                            <span className="ml-2 text-purple-400">（含 {customTools.length} 个自定义）</span>
                        )}
                    </div>

                    {viewMode === 'grid' ? (
                        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-5 xl:grid-cols-6 gap-4">
                            {filteredTools.map(tool => {
                                const extTool = tool as AITool & { source?: string };
                                const sharedTool = tool as SharedAITool;
                                return (
                                    <ToolCard
                                        key={tool.id}
                                        tool={tool}
                                        onCopy={() => handleCopyUrl(tool)}
                                        onDelete={
                                            extTool.source === 'custom'
                                                ? () => handleDeleteTool(tool.id)
                                                : extTool.source === 'community' && currentUser?.email && canDeleteTool(sharedTool, currentUser.email)
                                                    ? () => handleDeleteCommunityTool(sharedTool)
                                                    : undefined
                                        }
                                        onShare={extTool.source === 'custom' ? () => handleOpenShareModal(tool) : undefined}
                                        isCopied={copiedId === tool.id}
                                        source={extTool.source as 'preset' | 'custom' | 'community'}
                                        sharedBy={sharedTool.sharedBy}
                                    />
                                );
                            })}
                        </div>
                    ) : (
                        <div className="space-y-2">
                            {filteredTools.map(tool => {
                                const extTool = tool as AITool & { source?: string };
                                const sharedTool = tool as SharedAITool;
                                return (
                                    <ToolListItem
                                        key={tool.id}
                                        tool={tool}
                                        onCopy={() => handleCopyUrl(tool)}
                                        onDelete={
                                            extTool.source === 'custom'
                                                ? () => handleDeleteTool(tool.id)
                                                : extTool.source === 'community' && currentUser?.email && canDeleteTool(sharedTool, currentUser.email)
                                                    ? () => handleDeleteCommunityTool(sharedTool)
                                                    : undefined
                                        }
                                        onShare={extTool.source === 'custom' ? () => handleOpenShareModal(tool) : undefined}
                                        isCopied={copiedId === tool.id}
                                        source={extTool.source as 'preset' | 'custom' | 'community'}
                                        sharedBy={sharedTool.sharedBy}
                                    />
                                );
                            })}
                        </div>
                    )}

                    {filteredTools.length === 0 && (
                        <div className="text-center py-16 text-slate-400">
                            <Filter size={48} className="mx-auto mb-4 opacity-30" />
                            <p>没有找到匹配的工具</p>
                            <p className="text-sm mt-1">尝试调整筛选条件或添加自定义工具</p>
                        </div>
                    )}
                </div>
            </main>

            {/* Add Tool Modal */}
            {showAddModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                    <div className="bg-white rounded-2xl shadow-xl max-w-lg w-full max-h-[80vh] overflow-hidden flex flex-col">
                        {/* Modal Header */}
                        <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Link2 size={20} className="text-purple-600" />
                                <h2 className="text-lg font-bold text-slate-800">添加 AI 工具</h2>
                            </div>
                            <button
                                onClick={() => {
                                    setShowAddModal(false);
                                    setUrlInput('');
                                    setAnalyzedTool(null);
                                    setAnalyzeError(null);
                                }}
                                className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                            >
                                <X size={20} className="text-slate-400" />
                            </button>
                        </div>

                        {/* Modal Content */}
                        <div className="p-6 overflow-y-auto flex-1">
                            {/* URL Input */}
                            <div className="mb-4">
                                <label className="block text-sm font-medium text-slate-700 mb-2">
                                    粘贴工具网址
                                </label>
                                <div className="flex gap-2">
                                    <input
                                        type="url"
                                        placeholder="https://example.ai/"
                                        value={urlInput}
                                        onChange={(e) => setUrlInput(e.target.value)}
                                        className="flex-1 px-4 py-2 border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-purple-500/20 focus:border-purple-500"
                                    />
                                    <button
                                        onClick={handleAnalyzeUrl}
                                        disabled={isAnalyzing || !urlInput.trim()}
                                        className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                                    >
                                        {isAnalyzing ? (
                                            <Loader2 size={16} className="animate-spin" />
                                        ) : (
                                            <Globe size={16} />
                                        )}
                                        分析
                                    </button>
                                </div>
                                <p className="text-xs text-slate-400 mt-1">
                                    AI 将自动分析网站并提取工具信息
                                </p>
                            </div>

                            {/* Error */}
                            {analyzeError && (
                                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
                                    {analyzeError}
                                </div>
                            )}

                            {/* Preview */}
                            {analyzedTool && (
                                <div className="border border-slate-200 rounded-xl p-4 bg-slate-50">
                                    <h3 className="text-sm font-medium text-slate-600 mb-3">预览信息</h3>
                                    <div className="flex items-start gap-3">
                                        {analyzedTool.icon ? (
                                            <img src={analyzedTool.icon} alt="" className="w-12 h-12 rounded-lg" />
                                        ) : (
                                            <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600 font-bold">
                                                {(analyzedTool.name || '?').charAt(0)}
                                            </div>
                                        )}
                                        <div className="flex-1">
                                            <h4 className="font-semibold text-slate-800">{analyzedTool.name}</h4>
                                            <p className="text-sm text-slate-500 mt-1">{analyzedTool.description}</p>
                                            <div className="flex flex-wrap gap-2 mt-2">
                                                <span className="text-xs px-2 py-0.5 bg-slate-200 text-slate-600 rounded">
                                                    {CATEGORY_LABELS[analyzedTool.category as string] || analyzedTool.category}
                                                </span>
                                                <span className="text-xs px-2 py-0.5 bg-blue-100 text-blue-700 rounded">
                                                    {PRICING_LABELS[analyzedTool.pricing as string] || analyzedTool.pricing}
                                                </span>
                                                {analyzedTool.safety && (
                                                    <span className={`text-xs px-2 py-0.5 rounded ${analyzedTool.safety === 'safe' ? 'bg-green-100 text-green-700' :
                                                        analyzedTool.safety === 'unknown' ? 'bg-yellow-100 text-yellow-700' :
                                                            'bg-red-100 text-red-700'
                                                        }`}>
                                                        {SAFETY_LABELS[analyzedTool.safety]?.label || analyzedTool.safety}
                                                    </span>
                                                )}
                                            </div>
                                            {analyzedTool.freeQuota && (
                                                <p className="text-xs text-emerald-600 mt-2">💡 {analyzedTool.freeQuota}</p>
                                            )}
                                        </div>
                                    </div>
                                </div>
                            )}
                        </div>

                        {/* Modal Footer */}
                        {analyzedTool && (
                            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
                                <button
                                    onClick={() => {
                                        setAnalyzedTool(null);
                                        setUrlInput('');
                                    }}
                                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    重新分析
                                </button>
                                <button
                                    onClick={handleSaveAnalyzedTool}
                                    className="px-4 py-2 bg-purple-600 text-white rounded-lg hover:bg-purple-700 flex items-center gap-2"
                                >
                                    <Check size={16} />
                                    保存到本地
                                </button>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* Share Tool Modal */}
            {
                showShareModal && toolToShare && (
                    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
                        <div className="bg-white rounded-2xl shadow-xl max-w-md w-full">
                            {/* Modal Header */}
                            <div className="px-6 py-4 border-b border-slate-200 flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <Share2 size={20} className="text-blue-600" />
                                    <h2 className="text-lg font-bold text-slate-800">分享到社区</h2>
                                </div>
                                <button
                                    onClick={() => {
                                        setShowShareModal(false);
                                        setToolToShare(null);
                                    }}
                                    className="p-1 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    <X size={20} className="text-slate-400" />
                                </button>
                            </div>

                            {/* Modal Content */}
                            <div className="p-6">
                                <div className="flex items-center gap-3 mb-4 p-3 bg-slate-50 rounded-lg">
                                    {toolToShare.icon ? (
                                        <img src={toolToShare.icon} alt="" className="w-12 h-12 rounded-lg" />
                                    ) : (
                                        <div className="w-12 h-12 rounded-lg bg-purple-100 flex items-center justify-center text-purple-600 font-bold">
                                            {toolToShare.name.charAt(0)}
                                        </div>
                                    )}
                                    <div>
                                        <h4 className="font-semibold text-slate-800">{toolToShare.name}</h4>
                                        <p className="text-sm text-slate-500">{toolToShare.website}</p>
                                    </div>
                                </div>

                                <label className="flex items-center gap-3 p-3 border border-slate-200 rounded-lg cursor-pointer hover:bg-slate-50">
                                    <input
                                        type="checkbox"
                                        checked={shareAsAnonymous}
                                        onChange={(e) => setShareAsAnonymous(e.target.checked)}
                                        className="w-4 h-4 text-purple-600 rounded"
                                    />
                                    <div>
                                        <p className="text-sm font-medium text-slate-700">匿名分享</p>
                                        <p className="text-xs text-slate-400">
                                            {shareAsAnonymous ? '不显示您的名称' : `显示为: ${currentUser?.displayName || currentUser?.email}`}
                                        </p>
                                    </div>
                                </label>

                                <p className="text-xs text-slate-400 mt-4">
                                    分享后，其他用户可以看到此工具。您可以随时删除自己分享的工具。
                                </p>
                            </div>

                            {/* Modal Footer */}
                            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-3">
                                <button
                                    onClick={() => {
                                        setShowShareModal(false);
                                        setToolToShare(null);
                                    }}
                                    className="px-4 py-2 text-slate-600 hover:bg-slate-100 rounded-lg transition-colors"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleShareTool}
                                    disabled={isSharing}
                                    className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2"
                                >
                                    {isSharing ? <Loader2 size={16} className="animate-spin" /> : <Share2 size={16} />}
                                    {isSharing ? '分享中...' : '确认分享'}
                                </button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div>
    );
}

// Tool Card Component (Grid View) - Dark Theme
function ToolCard({ tool, onCopy, onDelete, onShare, isCopied, source, sharedBy }: {
    tool: AITool;
    onCopy: () => void;
    onDelete?: () => void;
    onShare?: () => void;
    isCopied: boolean;
    source?: 'preset' | 'custom' | 'community';
    sharedBy?: string;
}) {
    const safetyInfo = SAFETY_LABELS[tool.safety];

    return (
        <div className="bg-slate-800/50 rounded-xl border border-slate-700/50 p-4 hover:bg-slate-800 hover:border-purple-500/50 transition-all group relative">
            {/* Source badge */}
            <div className="absolute top-2 right-2 flex items-center gap-1">
                {source === 'custom' && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">自定义</span>
                )}
                {source === 'community' && (
                    <span className="text-[10px] px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded flex items-center gap-1">
                        <Users size={10} />
                        社区
                    </span>
                )}
                {onDelete && (
                    <button
                        onClick={onDelete}
                        className="p-1 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded transition-colors opacity-0 group-hover:opacity-100"
                    >
                        <Trash2 size={12} />
                    </button>
                )}
            </div>

            {/* Icon & Name */}
            <div className="flex items-center gap-3 mb-3">
                {tool.icon ? (
                    <img
                        src={tool.icon}
                        alt={tool.name}
                        className="w-10 h-10 rounded-lg object-cover bg-slate-700"
                        onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                    />
                ) : (
                    <div className="w-10 h-10 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white font-bold">
                        {tool.name.charAt(0)}
                    </div>
                )}
                <div className="flex-1 min-w-0">
                    <h3 className="font-semibold text-white truncate">{tool.name}</h3>
                    <span className="text-xs text-slate-500">{CATEGORY_LABELS[tool.category]}</span>
                </div>
            </div>

            {/* Description */}
            <p className="text-xs text-slate-400 line-clamp-2 mb-3 min-h-[2.5rem]">
                {tool.description}
            </p>

            {/* Tags */}
            {tool.tags && (
                <div className="flex flex-wrap gap-1 mb-3">
                    {tool.tags.slice(0, 3).map(tag => (
                        <span key={tag} className="px-2 py-0.5 bg-slate-700/50 text-slate-400 text-xs rounded">
                            {tag}
                        </span>
                    ))}
                </div>
            )}

            {/* Pricing & Safety */}
            <div className="flex items-center justify-between mb-3">
                <span className={`text-xs px-2 py-0.5 rounded ${tool.pricing === 'free' ? 'bg-green-500/20 text-green-400' :
                    tool.pricing === 'freemium' ? 'bg-blue-500/20 text-blue-400' :
                        'bg-slate-700 text-slate-400'
                    }`}>
                    {PRICING_LABELS[tool.pricing]}
                </span>
                <span className={`text-xs px-2 py-0.5 rounded ${safetyInfo.color === 'green' ? 'bg-green-500/20 text-green-400' :
                    safetyInfo.color === 'yellow' ? 'bg-yellow-500/20 text-yellow-400' :
                        'bg-red-500/20 text-red-400'
                    }`}>
                    {safetyInfo.label}
                </span>
            </div>

            {/* Free Quota */}
            {tool.freeQuota && (
                <p className="text-xs text-emerald-400 mb-3 truncate" title={tool.freeQuota}>
                    💡 {tool.freeQuota}
                </p>
            )}

            {/* Shared by */}
            {sharedBy && (
                <p className="text-xs text-slate-500 mb-2 truncate">
                    分享者: {sharedBy}
                </p>
            )}

            {/* Action Buttons */}
            <div className="flex gap-2">
                <button
                    onClick={onCopy}
                    className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${isCopied
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-slate-700/50 text-slate-300 hover:bg-purple-500/20 hover:text-purple-400'
                        }`}
                >
                    {isCopied ? <Check size={14} /> : <Copy size={14} />}
                    {isCopied ? '已复制' : '复制链接'}
                </button>
                {onShare && (
                    <button
                        onClick={onShare}
                        className="p-2 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors"
                        title="分享到社区"
                    >
                        <Share2 size={16} />
                    </button>
                )}
            </div>

            {/* Disclaimer */}
            <p className="text-[10px] text-slate-500 italic mt-2 text-center">* 信息仅供参考</p>
        </div>
    );
}

// Tool List Item Component (List View) - Dark Theme
function ToolListItem({ tool, onCopy, onDelete, onShare, isCopied, source, sharedBy }: {
    tool: AITool;
    onCopy: () => void;
    onDelete?: () => void;
    onShare?: () => void;
    isCopied: boolean;
    source?: 'preset' | 'custom' | 'community';
    sharedBy?: string;
}) {
    const safetyInfo = SAFETY_LABELS[tool.safety];

    return (
        <div className="bg-slate-800/50 rounded-lg border border-slate-700/50 p-4 hover:bg-slate-800 hover:border-purple-500/50 transition-all flex items-center gap-4 group">
            {/* Icon */}
            {tool.icon ? (
                <img
                    src={tool.icon}
                    alt={tool.name}
                    className="w-12 h-12 rounded-lg object-cover flex-shrink-0 bg-slate-700"
                    onError={(e) => { (e.target as HTMLImageElement).style.display = 'none' }}
                />
            ) : (
                <div className="w-12 h-12 rounded-lg bg-gradient-to-br from-purple-500 to-indigo-500 flex items-center justify-center text-white font-bold flex-shrink-0">
                    {tool.name.charAt(0)}
                </div>
            )}

            {/* Info */}
            <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1 flex-wrap">
                    <h3 className="font-semibold text-white">{tool.name}</h3>
                    <span className="text-xs text-slate-500">• {CATEGORY_LABELS[tool.category]}</span>
                    {source === 'custom' && (
                        <span className="text-xs px-1.5 py-0.5 bg-purple-500/20 text-purple-400 rounded">自定义</span>
                    )}
                    {source === 'community' && (
                        <span className="text-xs px-1.5 py-0.5 bg-blue-500/20 text-blue-400 rounded flex items-center gap-1">
                            <Users size={10} />
                            社区
                        </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded ${tool.pricing === 'free' ? 'bg-green-500/20 text-green-400' :
                        tool.pricing === 'freemium' ? 'bg-blue-500/20 text-blue-400' :
                            'bg-slate-700 text-slate-400'
                        }`}>
                        {PRICING_LABELS[tool.pricing]}
                    </span>
                    <span className={`text-xs px-2 py-0.5 rounded ${safetyInfo.color === 'green' ? 'bg-green-500/20 text-green-400' :
                        safetyInfo.color === 'yellow' ? 'bg-yellow-500/20 text-yellow-400' :
                            'bg-red-500/20 text-red-400'
                        }`}>
                        {safetyInfo.label}
                    </span>
                </div>
                <p className="text-sm text-slate-400 truncate">{tool.description}</p>
                <div className="flex items-center gap-4">
                    {tool.freeQuota && (
                        <p className="text-xs text-emerald-400 mt-1">💡 {tool.freeQuota}</p>
                    )}
                    {sharedBy && (
                        <p className="text-xs text-slate-500 mt-1">分享者: {sharedBy}</p>
                    )}
                </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-2 flex-shrink-0">
                {onShare && (
                    <button
                        onClick={onShare}
                        className="p-2 text-slate-500 hover:text-blue-400 hover:bg-blue-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                        title="分享到社区"
                    >
                        <Share2 size={16} />
                    </button>
                )}
                {onDelete && (
                    <button
                        onClick={onDelete}
                        className="p-2 text-slate-500 hover:text-red-400 hover:bg-red-500/10 rounded-lg transition-colors opacity-0 group-hover:opacity-100"
                    >
                        <Trash2 size={16} />
                    </button>
                )}
                <button
                    onClick={onCopy}
                    className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${isCopied
                        ? 'bg-green-500/20 text-green-400'
                        : 'bg-slate-700/50 text-slate-300 hover:bg-purple-500/20 hover:text-purple-400'
                        }`}
                >
                    {isCopied ? <Check size={14} /> : <Copy size={14} />}
                    {isCopied ? '已复制' : '复制链接'}
                </button>
            </div>
        </div>
    );
}

export { AIToolsDirectoryApp };
