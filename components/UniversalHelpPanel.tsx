/**
 * 📖 通用帮助面板组件
 * 可在各个模块中复用的帮助文档显示组件
 */

import React, { useState, useEffect } from 'react';
import { X, Search, Book, ChevronRight, ExternalLink } from 'lucide-react';

interface HelpSection {
    id: string;
    icon: string;
    title: string;
    content: string;
}

interface UniversalHelpPanelProps {
    isOpen: boolean;
    onClose: () => void;
    title: string;
    subtitle?: string;
    sections: HelpSection[];
    version?: string;
}

export const UniversalHelpPanel: React.FC<UniversalHelpPanelProps> = ({
    isOpen,
    onClose,
    title,
    subtitle,
    sections,
    version = 'v1.0.0'
}) => {
    const [activeSection, setActiveSection] = useState(sections[0]?.id || '');
    const [searchQuery, setSearchQuery] = useState('');

    // ESC 关闭
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape' && isOpen) {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, onClose]);

    // 重置状态
    useEffect(() => {
        if (isOpen && sections.length > 0) {
            setActiveSection(sections[0].id);
            setSearchQuery('');
        }
    }, [isOpen, sections]);

    if (!isOpen) return null;

    // 搜索过滤
    const filteredSections = searchQuery
        ? sections.filter(
            s => s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                s.content.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : sections;

    const currentSection = sections.find(s => s.id === activeSection) || sections[0];

    return (
        <div className="universal-help-overlay" onClick={onClose}>
            <div className="universal-help-modal" onClick={e => e.stopPropagation()}>
                {/* 头部 */}
                <div className="universal-help-header">
                    <div className="help-header-info">
                        <Book size={22} className="help-book-icon" />
                        <div>
                            <h2>{title}</h2>
                            {subtitle && <p className="help-subtitle">{subtitle}</p>}
                        </div>
                    </div>
                    <div className="help-search-box">
                        <Search size={16} />
                        <input
                            type="text"
                            placeholder="搜索帮助..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <button className="help-close-button" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="universal-help-body">
                    {/* 侧边栏 */}
                    <nav className="universal-help-nav">
                        {filteredSections.map(section => (
                            <button
                                key={section.id}
                                className={`help-nav-btn ${activeSection === section.id ? 'active' : ''}`}
                                onClick={() => setActiveSection(section.id)}
                            >
                                <span className="nav-icon">{section.icon}</span>
                                <span className="nav-title">{section.title}</span>
                                <ChevronRight size={14} className="nav-arrow" />
                            </button>
                        ))}
                    </nav>

                    {/* 内容区 */}
                    <div className="universal-help-content">
                        {currentSection && (
                            <>
                                <h1>
                                    <span className="content-icon">{currentSection.icon}</span>
                                    {currentSection.title}
                                </h1>
                                <div
                                    className="help-content-text"
                                    dangerouslySetInnerHTML={{
                                        __html: simpleMarkdownToHtml(currentSection.content)
                                    }}
                                />
                            </>
                        )}
                    </div>
                </div>

                {/* 底部 */}
                <div className="universal-help-footer">
                    <span className="footer-hint">按 ESC 关闭帮助面板</span>
                    <span className="footer-version">{version}</span>
                </div>
            </div>
        </div>
    );
};

// 帮助按钮组件
interface HelpButtonProps {
    onClick: () => void;
    className?: string;
}

export const HelpButton: React.FC<HelpButtonProps> = ({ onClick, className }) => (
    <button
        className={`universal-help-fab ${className || ''}`}
        onClick={onClick}
        title="帮助文档"
    >
        <span>?</span>
    </button>
);

// 简单的 Markdown 转 HTML
function simpleMarkdownToHtml(md: string): string {
    return md
        // 代码块
        .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
        // 行内代码
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        // 标题
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        // 粗体
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        // 表格处理
        .replace(/\|(.+)\|/g, (match) => {
            const cells = match.split('|').filter(c => c.trim());
            if (cells.every(c => /^[-:]+$/.test(c.trim()))) {
                return '';
            }
            const row = cells.map(c => `<td>${c.trim()}</td>`).join('');
            return `<tr>${row}</tr>`;
        })
        // 列表
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
        // 段落
        .replace(/\n\n/g, '</p><p>')
        // 换行
        .replace(/\n/g, '<br>')
        // 包装表格
        .replace(/(<tr>.*<\/tr>)+/gs, '<table>$&</table>')
        // 包装列表
        .replace(/(<li>.*<\/li>)+/gs, '<ul>$&</ul>');
}

// 导出样式 CSS（需要在使用的模块中引入）
export const UNIVERSAL_HELP_STYLES = `
/* ============================================
   通用帮助面板样式
   ============================================ */

.universal-help-overlay {
    position: fixed;
    top: 0;
    left: 0;
    right: 0;
    bottom: 0;
    background: rgba(0, 0, 0, 0.7);
    backdrop-filter: blur(4px);
    display: flex;
    align-items: center;
    justify-content: center;
    z-index: 10000;
    animation: helpFadeIn 0.2s ease;
}

@keyframes helpFadeIn {
    from { opacity: 0; }
    to { opacity: 1; }
}

.universal-help-modal {
    width: 90vw;
    max-width: 1000px;
    height: 80vh;
    max-height: 700px;
    background: linear-gradient(145deg, #1e1e2e, #181825);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 16px;
    display: flex;
    flex-direction: column;
    overflow: hidden;
    box-shadow: 0 20px 60px rgba(0, 0, 0, 0.5);
}

.universal-help-header {
    display: flex;
    align-items: center;
    gap: 16px;
    padding: 16px 20px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
    background: rgba(255, 255, 255, 0.02);
}

.help-header-info {
    display: flex;
    align-items: center;
    gap: 12px;
    flex-shrink: 0;
}

.help-book-icon {
    color: #6366f1;
}

.help-header-info h2 {
    font-size: 18px;
    font-weight: 600;
    color: #e0e0e0;
    margin: 0;
}

.help-subtitle {
    font-size: 12px;
    color: #888;
    margin: 2px 0 0 0;
}

.help-search-box {
    flex: 1;
    display: flex;
    align-items: center;
    gap: 8px;
    padding: 8px 14px;
    background: rgba(255, 255, 255, 0.06);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 8px;
    max-width: 300px;
}

.help-search-box svg {
    color: #666;
}

.help-search-box input {
    flex: 1;
    background: none;
    border: none;
    color: #e0e0e0;
    font-size: 14px;
    outline: none;
}

.help-close-button {
    padding: 8px;
    background: rgba(255, 255, 255, 0.06);
    border: none;
    border-radius: 8px;
    color: #888;
    cursor: pointer;
    transition: all 0.2s;
}

.help-close-button:hover {
    background: rgba(255, 255, 255, 0.1);
    color: #fff;
}

.universal-help-body {
    flex: 1;
    display: flex;
    overflow: hidden;
}

.universal-help-nav {
    width: 240px;
    border-right: 1px solid rgba(255, 255, 255, 0.08);
    padding: 12px;
    overflow-y: auto;
    display: flex;
    flex-direction: column;
    gap: 4px;
}

.help-nav-btn {
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 10px 14px;
    background: none;
    border: none;
    border-radius: 8px;
    color: #aaa;
    font-size: 13px;
    cursor: pointer;
    transition: all 0.2s;
    text-align: left;
}

.help-nav-btn:hover {
    background: rgba(255, 255, 255, 0.06);
    color: #e0e0e0;
}

.help-nav-btn.active {
    background: rgba(99, 102, 241, 0.15);
    color: #a5b4fc;
}

.nav-icon {
    font-size: 16px;
}

.nav-title {
    flex: 1;
}

.nav-arrow {
    color: #555;
    opacity: 0;
    transition: opacity 0.2s;
}

.help-nav-btn:hover .nav-arrow,
.help-nav-btn.active .nav-arrow {
    opacity: 1;
}

.universal-help-content {
    flex: 1;
    padding: 24px 32px;
    overflow-y: auto;
}

.universal-help-content h1 {
    display: flex;
    align-items: center;
    gap: 12px;
    font-size: 22px;
    font-weight: 600;
    color: #e0e0e0;
    margin: 0 0 20px 0;
    padding-bottom: 12px;
    border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.content-icon {
    font-size: 24px;
}

.help-content-text {
    font-size: 14px;
    line-height: 1.7;
    color: #bbb;
}

.help-content-text h2 {
    font-size: 17px;
    font-weight: 600;
    color: #e0e0e0;
    margin: 24px 0 12px 0;
}

.help-content-text h3 {
    font-size: 15px;
    font-weight: 600;
    color: #ccc;
    margin: 20px 0 10px 0;
}

.help-content-text ul {
    margin: 0 0 16px 0;
    padding-left: 20px;
}

.help-content-text li {
    margin: 6px 0;
}

.help-content-text table {
    width: 100%;
    border-collapse: collapse;
    margin: 16px 0;
}

.help-content-text tr {
    border-bottom: 1px solid rgba(255, 255, 255, 0.08);
}

.help-content-text td {
    padding: 10px 12px;
    font-size: 13px;
}

.help-content-text tr:first-child td {
    font-weight: 600;
    color: #e0e0e0;
    background: rgba(255, 255, 255, 0.04);
}

.help-content-text code {
    background: rgba(255, 255, 255, 0.08);
    padding: 2px 6px;
    border-radius: 4px;
    font-family: 'SF Mono', Monaco, monospace;
    font-size: 12px;
    color: #f472b6;
}

.help-content-text pre {
    background: rgba(0, 0, 0, 0.3);
    border: 1px solid rgba(255, 255, 255, 0.08);
    border-radius: 8px;
    padding: 16px;
    overflow-x: auto;
    margin: 16px 0;
}

.help-content-text pre code {
    background: none;
    padding: 0;
    color: #a5b4fc;
}

.help-content-text strong {
    color: #e0e0e0;
    font-weight: 600;
}

.universal-help-footer {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 12px 20px;
    border-top: 1px solid rgba(255, 255, 255, 0.08);
    font-size: 12px;
    color: #666;
}

.footer-hint {
    opacity: 0.7;
}

.footer-version {
    color: #555;
}

/* 悬浮帮助按钮 */
.universal-help-fab {
    position: fixed;
    bottom: 24px;
    right: 24px;
    width: 48px;
    height: 48px;
    background: linear-gradient(135deg, #6366f1, #8b5cf6);
    border: none;
    border-radius: 50%;
    color: white;
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 24px;
    font-weight: bold;
    box-shadow: 0 4px 20px rgba(99, 102, 241, 0.4);
    transition: all 0.2s ease;
    z-index: 1000;
}

.universal-help-fab:hover {
    transform: scale(1.1);
    box-shadow: 0 6px 25px rgba(99, 102, 241, 0.5);
}

.universal-help-fab:active {
    transform: scale(0.95);
}
`;
