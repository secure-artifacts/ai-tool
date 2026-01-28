import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useMindMapStore } from '../store/mindMapStore';
import { Search, X, ChevronUp, ChevronDown, MapPin } from 'lucide-react';

interface SearchResult {
    id: string;
    label: string;
    path: string[];
    depth: number;
    notes?: string;
}

interface NodeSearchProps {
    isOpen: boolean;
    onClose: () => void;
    onNavigateToNode: (nodeId: string) => void;
}

export const NodeSearch: React.FC<NodeSearchProps> = ({
    isOpen,
    onClose,
    onNavigateToNode,
}) => {
    const { currentMap, selectNode } = useMindMapStore();
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [selectedIndex, setSelectedIndex] = useState(0);
    const inputRef = useRef<HTMLInputElement>(null);

    // 构建节点路径
    const buildPath = useCallback((nodeId: string): string[] => {
        if (!currentMap) return [];

        const path: string[] = [];
        let currentId: string | null | undefined = nodeId;

        while (currentId) {
            const node = currentMap.nodes[currentId];
            if (!node) break;
            path.unshift(node.label);
            currentId = node.parentId;
        }

        return path;
    }, [currentMap]);

    // 搜索节点
    const searchNodes = useCallback((searchQuery: string): SearchResult[] => {
        if (!currentMap || !searchQuery.trim()) return [];

        const lowerQuery = searchQuery.toLowerCase();
        const matches: SearchResult[] = [];

        Object.values(currentMap.nodes).forEach((node) => {
            const matchLabel = node.label.toLowerCase().includes(lowerQuery);
            const matchNotes = node.notes?.toLowerCase().includes(lowerQuery);

            if (matchLabel || matchNotes) {
                const path = buildPath(node.id);
                matches.push({
                    id: node.id,
                    label: node.label,
                    path,
                    depth: path.length - 1,
                    notes: node.notes,
                });
            }
        });

        // 按相关性排序：精确匹配 > 前缀匹配 > 包含匹配
        return matches.sort((a, b) => {
            const aExact = a.label.toLowerCase() === lowerQuery;
            const bExact = b.label.toLowerCase() === lowerQuery;
            if (aExact && !bExact) return -1;
            if (!aExact && bExact) return 1;

            const aPrefix = a.label.toLowerCase().startsWith(lowerQuery);
            const bPrefix = b.label.toLowerCase().startsWith(lowerQuery);
            if (aPrefix && !bPrefix) return -1;
            if (!aPrefix && bPrefix) return 1;

            return a.depth - b.depth;
        });
    }, [currentMap, buildPath]);

    // 当查询变化时搜索
    useEffect(() => {
        const newResults = searchNodes(query);
        setResults(newResults);
        setSelectedIndex(0);
    }, [query, searchNodes]);

    // 当打开时聚焦输入框
    useEffect(() => {
        if (isOpen && inputRef.current) {
            inputRef.current.focus();
            setQuery('');
            setResults([]);
        }
    }, [isOpen]);

    // 处理键盘导航
    const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                setSelectedIndex((prev) => Math.min(prev + 1, results.length - 1));
                break;
            case 'ArrowUp':
                e.preventDefault();
                setSelectedIndex((prev) => Math.max(prev - 1, 0));
                break;
            case 'Enter':
                e.preventDefault();
                if (results[selectedIndex]) {
                    handleSelectResult(results[selectedIndex]);
                }
                break;
            case 'Escape':
                e.preventDefault();
                onClose();
                break;
        }
    }, [results, selectedIndex, onClose]);

    // 选择结果
    const handleSelectResult = (result: SearchResult) => {
        selectNode(result.id);
        onNavigateToNode(result.id);
        onClose();
    };

    // 高亮匹配文本
    const highlightMatch = (text: string, query: string) => {
        if (!query.trim()) return text;

        const lowerText = text.toLowerCase();
        const lowerQuery = query.toLowerCase();
        const index = lowerText.indexOf(lowerQuery);

        if (index === -1) return text;

        return (
            <>
                {text.slice(0, index)}
                <mark className="search-highlight">{text.slice(index, index + query.length)}</mark>
                {text.slice(index + query.length)}
            </>
        );
    };

    if (!isOpen) return null;

    return (
        <div className="node-search-overlay" onClick={onClose}>
            <div className="node-search-modal" onClick={(e) => e.stopPropagation()}>
                <div className="search-header">
                    <Search className="search-icon" size={20} />
                    <input
                        ref={inputRef}
                        type="text"
                        className="search-input"
                        placeholder="搜索节点..."
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        onKeyDown={handleKeyDown}
                    />
                    {query && (
                        <button className="clear-btn" onClick={() => setQuery('')}>
                            <X size={16} />
                        </button>
                    )}
                    <button className="close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="search-body">
                    {query && results.length === 0 && (
                        <div className="no-results">
                            <span className="no-results-icon">🔍</span>
                            <p>没有找到匹配 "{query}" 的节点</p>
                        </div>
                    )}

                    {results.length > 0 && (
                        <>
                            <div className="results-count">
                                找到 {results.length} 个结果
                            </div>
                            <div className="results-list">
                                {results.map((result, index) => (
                                    <div
                                        key={result.id}
                                        className={`result-item ${index === selectedIndex ? 'selected' : ''}`}
                                        onClick={() => handleSelectResult(result)}
                                        onMouseEnter={() => setSelectedIndex(index)}
                                    >
                                        <div className="result-main">
                                            <MapPin className="result-icon" size={14} />
                                            <span className="result-label">
                                                {highlightMatch(result.label, query)}
                                            </span>
                                        </div>
                                        <div className="result-path">
                                            {result.path.slice(0, -1).join(' › ')}
                                        </div>
                                        {result.notes && result.notes.toLowerCase().includes(query.toLowerCase()) && (
                                            <div className="result-notes">
                                                📝 {highlightMatch(result.notes.slice(0, 100), query)}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        </>
                    )}

                    {!query && (
                        <div className="search-tips">
                            <p>💡 搜索提示：</p>
                            <ul>
                                <li>输入关键词搜索节点标题</li>
                                <li>也会搜索节点的备注内容</li>
                                <li>使用 ↑↓ 键选择结果</li>
                                <li>按 Enter 跳转到节点</li>
                                <li>按 Esc 关闭搜索</li>
                            </ul>
                        </div>
                    )}
                </div>

                <div className="search-footer">
                    <div className="keyboard-hints">
                        <span><kbd>↑</kbd><kbd>↓</kbd> 导航</span>
                        <span><kbd>Enter</kbd> 选择</span>
                        <span><kbd>Esc</kbd> 关闭</span>
                    </div>
                </div>
            </div>
        </div>
    );
};
