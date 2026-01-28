/**
 * 📖 帮助面板组件
 * 显示 AI 思维导图的帮助文档
 */

import React, { useState, useEffect } from 'react';
import { X, Search, Book, Rocket, Monitor, Download, Keyboard, HelpCircle, Lightbulb, Sparkles, MousePointer, Palette } from 'lucide-react';

interface HelpPanelProps {
    isOpen: boolean;
    onClose: () => void;
}

// 帮助内容结构
const HELP_SECTIONS = [
    {
        id: 'quick-start',
        icon: Rocket,
        title: '🚀 快速开始',
        content: `
### 第一步：创建思维导图
1. 点击顶部 **📥 输入** Tab
2. 在文本框中输入主题（如"2024年营销策略"）
3. 点击 **🚀 生成思维导图**

### 第二步：AI 扩展
1. 点击选中任意节点
2. 点击右侧 **🤖 AI 助手** Tab
3. 点击 **AI 一键扩展** 按钮

### 第三步：编辑与导出
1. 双击节点编辑文字
2. 使用工具栏调整布局和样式
3. 导出为图片或 PDF
        `
    },
    {
        id: 'interface',
        icon: Monitor,
        title: '🖥️ 界面介绍',
        content: `
### 顶部导航栏

| Tab | 功能 |
|-----|------|
| 📚 菜单 | 文件管理、打开/导入导图 |
| 📥 输入 | 多种输入方式生成导图 |
| 🤖 AI 助手 | AI 扩展和智能工具 |
| 🏷️ 标记 | 节点标签和图标 |
| 🎨 样式 | 主题和视觉样式 |
| ⚙️ 设置 | API 密钥和偏好设置 |

### 画布操作
- **拖拽画布**：按住空白区域拖动
- **缩放画布**：滚轮或双指缩放
- **选中节点**：单击节点
- **编辑节点**：双击节点
- **右键菜单**：右键点击节点或画布
        `
    },
    {
        id: 'input',
        icon: Download,
        title: '📥 输入方式',
        content: `
### 支持 6 种输入方式

1. **文本输入** - 输入主题或 Markdown 大纲
2. **图片输入** - 截图、照片、手绘导图
3. **文档输入** - PDF、Word、TXT 文件
4. **视频/YouTube** - 自动提取字幕生成导图
5. **网页输入** - 输入 URL 抓取内容
6. **音频输入** - 上传音频自动转录

### 文本输入示例
\`\`\`markdown
# 产品发布计划
## 前期准备
- 市场调研
- 竞品分析
## 执行阶段
- 内容制作
- 渠道推广
\`\`\`
        `
    },
    {
        id: 'ai-assistant',
        icon: Sparkles,
        title: '🤖 AI 助手',
        content: `
### 一键扩展
选中节点后点击 **AI 一键扩展**，AI 自动生成 3-5 个子节点。

### 快捷操作
| 操作 | 功能 |
|------|------|
| 💡 发散思维 | 围绕主题发散创意 |
| 📋 拆解步骤 | 分解为执行步骤 |
| ✨ 优化文案 | 润色节点文字 |

### 智能工具（展开可见）
- 培养想法、工作分解、优化文案
- 改组重构、语义聚类、视频脚本
- 解释说明、数据脱敏

### 扩展模式
点击 **✨ 选择扩展模式** 可选择：
- SWOT 分析、5W2H 分析
- 文章大纲、视频脚本
- 概念解释、知识梳理
        `
    },
    {
        id: 'node-ops',
        icon: MousePointer,
        title: '🖱️ 节点操作',
        content: `
### 基本操作

| 操作 | 方法 |
|------|------|
| 选中节点 | 单击节点 |
| 编辑文字 | 双击节点 或 按 Enter |
| 完成编辑 | 按 Enter 或点击空白处 |
| 取消编辑 | 按 Escape |
| 删除节点 | Delete 或 Backspace |
| 添加子节点 | 按 Tab |
| 添加兄弟 | 按 Enter |

### 拖拽操作
- **移动节点**：拖拽到新位置
- **调整层级**：拖拽到其他节点下方
- **复制节点**：按住 Alt 拖拽
        `
    },
    {
        id: 'style',
        icon: Palette,
        title: '🎨 样式设置',
        content: `
### 主题切换
在 **🎨 样式** Tab 中选择预设主题。

### 节点样式
- **颜色**：设置节点背景色
- **形状**：圆角矩形、胶囊、圆形
- **边框**：粗细和颜色
- **字体**：大小和粗细

### 布局设置
- **布局方向**：左右、上下、径向
- **节点间距**：水平和垂直间距
- **自动布局**：一键整理布局
        `
    },
    {
        id: 'shortcuts',
        icon: Keyboard,
        title: '⌨️ 快捷键',
        content: `
### 文件操作
| 快捷键 | 功能 |
|--------|------|
| Ctrl/⌘ + S | 保存 |
| Ctrl/⌘ + Z | 撤销 |
| Ctrl/⌘ + Shift + Z | 重做 |

### 节点操作
| 快捷键 | 功能 |
|--------|------|
| Tab | 添加子节点 |
| Enter | 添加兄弟节点 |
| Delete | 删除节点 |
| 空格 | 折叠/展开 |
| F2 | 编辑节点 |

### 视图操作
| 快捷键 | 功能 |
|--------|------|
| Ctrl/⌘ + F | 搜索 |
| Ctrl/⌘ + +/- | 缩放 |
| ↑ ↓ ← → | 节点导航 |
| ? | 快捷键帮助 |
        `
    },
    {
        id: 'faq',
        icon: HelpCircle,
        title: '❓ 常见问题',
        content: `
### Q: AI 功能不工作？
请在 **⚙️ 设置** 中确认已配置 API 密钥，并检查网络连接。

### Q: 如何保存导图？
导图自动保存到浏览器本地存储，也可导出为 JSON 备份。

### Q: 导图太大显示不全？
使用滚轮缩小，或点击工具栏 🎯 居中按钮。

### Q: 支持多人协作吗？
目前为单机版本，可通过导出/导入 JSON 交换数据。
        `
    },
    {
        id: 'tips',
        icon: Lightbulb,
        title: '💡 使用技巧',
        content: `
### 高效创建导图
1. **先粗后细**：先写主要分支，再逐步细化
2. **善用 AI**：让 AI 帮你扩展和优化
3. **模板复用**：常用结构保存为模板

### 提高 AI 质量
1. **明确主题**：节点内容越清晰越准确
2. **设置场景**：在高级设置中指定平台、目标
3. **选择模式**：使用预设扩展模式

### 整理复杂信息
1. **分层梳理**：从大分类到小细节
2. **语义聚类**：让 AI 自动分组
3. **MECE 原则**：使用"改组重构"
        `
    },
];

export const HelpPanel: React.FC<HelpPanelProps> = ({ isOpen, onClose }) => {
    const [activeSection, setActiveSection] = useState('quick-start');
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

    if (!isOpen) return null;

    // 搜索过滤
    const filteredSections = searchQuery
        ? HELP_SECTIONS.filter(
            s => s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                s.content.toLowerCase().includes(searchQuery.toLowerCase())
        )
        : HELP_SECTIONS;

    const currentSection = HELP_SECTIONS.find(s => s.id === activeSection) || HELP_SECTIONS[0];

    return (
        <div className="help-panel-overlay" onClick={onClose}>
            <div className="help-panel-modal" onClick={e => e.stopPropagation()}>
                {/* 头部 */}
                <div className="help-panel-header">
                    <div className="help-header-title">
                        <Book size={22} />
                        <h2>帮助文档</h2>
                    </div>
                    <div className="help-search">
                        <Search size={16} />
                        <input
                            type="text"
                            placeholder="搜索帮助..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <button className="help-close-btn" onClick={onClose}>
                        <X size={20} />
                    </button>
                </div>

                <div className="help-panel-body">
                    {/* 侧边栏 */}
                    <nav className="help-sidebar">
                        {filteredSections.map(section => (
                            <button
                                key={section.id}
                                className={`help-nav-item ${activeSection === section.id ? 'active' : ''}`}
                                onClick={() => setActiveSection(section.id)}
                            >
                                <section.icon size={16} />
                                <span>{section.title}</span>
                            </button>
                        ))}
                    </nav>

                    {/* 内容区 */}
                    <div className="help-content">
                        <h1>{currentSection.title}</h1>
                        <div
                            className="help-content-body"
                            dangerouslySetInnerHTML={{
                                __html: simpleMarkdownToHtml(currentSection.content)
                            }}
                        />
                    </div>
                </div>

                {/* 底部 */}
                <div className="help-panel-footer">
                    <span>按 <kbd>?</kbd> 随时打开快捷键帮助</span>
                    <span className="help-version">v2.12.0</span>
                </div>
            </div>
        </div>
    );
};

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
        // 表格
        .replace(/\|(.+)\|/g, (match) => {
            const cells = match.split('|').filter(c => c.trim());
            if (cells.every(c => /^[-:]+$/.test(c.trim()))) {
                return ''; // 跳过分隔行
            }
            const isHeader = !match.includes('---');
            const tag = isHeader ? 'td' : 'td';
            const row = cells.map(c => `<${tag}>${c.trim()}</${tag}>`).join('');
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
