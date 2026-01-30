/**
 * 📖 帮助中心组件
 * 统一帮助入口，整合原教程模态框内容和各模块帮助文档
 */

import React, { useState, useEffect } from 'react';
import { BookOpen, Search, X } from 'lucide-react';

interface HelpCenterProps {
    isOpen: boolean;
    onClose: () => void;
    language?: 'zh' | 'en';
}

interface HelpSection {
    id: string;
    icon: string;
    title: string;
    content: string;
}

interface HelpModule {
    id: string;
    icon: string;
    name: string;
    description: string;
    sections: HelpSection[];
}

// 所有帮助模块数据 - 整合原教程内容和新帮助文档
const HELP_MODULES: HelpModule[] = [
    // ========== 视频教程与资源 ==========
    {
        id: 'video-tutorials',
        icon: '🎬',
        name: '视频教程',
        description: '视频教程和学习资源',
        sections: [
            {
                id: 'video-links', icon: '📺', title: '教程链接', content: `
### 视频教程链接

🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥

**🎬 AI 创作工具包 - 软件简要说明**
- 整体功能介绍录屏：[观看视频](https://drive.google.com/file/d/1XEH2HexTM7_h68OlvLLMBxijEruAM3UF/view?usp=sharing)

---

**AI一键修图（原创艺魔盒）**
- 手册和教程：[查看教程](https://drive.google.com/drive/folders/1qzdDcut79EL9NpCvDt50f8AHGnmmc_es?usp=drive_link)

**AI图片编辑器（原幻影迁移）**  
- 手册和演示案例：[查看教程](https://drive.google.com/drive/folders/1wR5M0hLOIi307Hr6y9axExPG5Cxx-tQ2?usp=drive_link)
- 支持多图层，可以合成、扩图、换场景、换装、换脸、AI对话、提取画风等
            ` },
            {
                id: 'planned', icon: '📋', title: '计划主题', content: `
### 计划中的教程主题

- 入门指南
- API Key 设置教程
- AI 一键修图工作流程
- 图片生成提示词技巧
- 翻译功能深度解析
- 自定义预设创建
- 高级技巧与窍门

---

**有教程主题建议？**
点击"建议反馈"按钮告诉我们您想学习什么！
            ` }
        ]
    },
    // ========== 快速开始 ==========
    {
        id: 'getting-started',
        icon: '🚀',
        name: '快速开始',
        description: '欢迎使用 AI 创作工具包',
        sections: [
            {
                id: 'api-key', icon: '🔑', title: '设置 API Key', content: `
### 第一步：设置 API Key

点击右上角的 🔑 按钮，输入您的 Google Gemini API 密钥。

**如何获取 API 密钥：**
- 访问 [Google AI Studio](https://aistudio.google.com)
- 使用 Google 账号登录
- 点击"获取 API Key"
- 复制并粘贴到 API Key 输入框

> 您的密钥仅保存在浏览器本地，不会上传到任何服务器。
            ` },
            {
                id: 'choose-tool', icon: '🛠️', title: '选择工具', content: `
### 第二步：选择工具

从顶部导航栏选择功能：

| 工具 | 说明 |
|------|------|
| AI 一键修图 | 专业图片编辑 |
| AI 图片编辑器 | 高级图片处理 |
| 图片生成提示词 | 从图片提取描述 |
| 提示词工具 | 创建详细AI提示词 |
| 创新指令模板 | 自定义模板 |
| 智能翻译 | 支持OCR的翻译 |
| 文案拆分 | 内容分割 |
| AI 软件目录 | 软件目录 |
            ` },
            {
                id: 'start-creating', icon: '✨', title: '开始创作', content: `
### 第三步：开始创作

每个工具都有自己的界面和提示说明，跟随屏幕指引操作即可！

**通用操作：**
- 上传图片：拖拽、双击或粘贴（Ctrl+V）
- 执行操作：点击"执行"按钮或 Ctrl+Enter
- 下载结果：点击"下载"按钮
- 复制内容：点击复制图标
            ` }
        ]
    },
    // ========== AI 一键修图 ==========
    {
        id: 'studio',
        icon: '🎨',
        name: 'AI 一键修图',
        description: '专业的AI图片编辑，支持自定义预设',
        sections: [
            {
                id: 'features', icon: '✨', title: '功能介绍', content: `
### 可用功能

**基础美化**
- 美颜增强、皮肤平滑
- 瑕疵去除、色彩校正

**换装**
- 更换服装风格
- 尝试不同搭配

**人像**
- 面部优化、表情调整
- 专业证件照

**背景**
- 背景去除/更换
- 背景虚化

**滤镜效果**
- 艺术滤镜、色彩分级
- 风格迁移

**智能抠图**
- 移除物体
- 自定义区域选择
            ` },
            {
                id: 'usage', icon: '📖', title: '使用方法', content: `
### 使用方法

1. 上传图片
2. 选择分类标签页（美化、换装等）
3. 选择预设或输入自定义指令
4. 点击"执行"应用效果
5. 下载处理结果

### 预设管理

- 创建自定义预设用于重复任务
- 导出/导入预设进行备份
- 通过Gmail账号同步预设
- 按分类组织预设
            ` }
        ]
    },
    // ========== AI 图片编辑器 ==========
    {
        id: 'magic-canvas',
        icon: '✨',
        name: 'AI 图片编辑器',
        description: '高级AI图片处理工具',
        sections: [
            {
                id: 'features', icon: '🎯', title: '主要功能', content: `
### 主要功能

**图片生成**
- 从文字描述创建图片
- 多种风格选项
- 高质量输出

**图片编辑**
- 修改现有图片
- 风格迁移
- 内容感知编辑

**背景操作**
- 背景去除/更换
- 背景效果

**物体处理**
- 添加/移除物体
- 移动、调整大小
            ` },
            {
                id: 'tips', icon: '💡', title: '使用技巧', content: `
### 小技巧

- 指令要具体明确
- 使用描述性语言
- 尝试不同风格
- 保存版本进行对比
            ` }
        ]
    },
    // ========== AI 思维导图 ==========
    {
        id: 'ai-mind-map',
        icon: '🧠',
        name: 'AI 思维导图',
        description: '把信息变成结构，把结构变成内容',
        sections: [
            {
                id: 'quick-start', icon: '🚀', title: '快速开始', content: `
### 第一步：创建思维导图
1. 点击顶部 **📥 输入** Tab
2. 在文本框中输入主题
3. 点击 **🚀 生成思维导图**

### 第二步：AI 扩展
1. 点击选中任意节点
2. 点击右侧 **🤖 AI 助手** Tab
3. 点击 **AI 一键扩展** 按钮

### 第三步：编辑与导出
1. 双击节点编辑文字
2. 使用工具栏调整布局和样式
3. 导出为图片或 PDF
            ` },
            {
                id: 'ai-assistant', icon: '🤖', title: 'AI 助手', content: `
### 一键扩展
选中节点后点击 **AI 一键扩展**，AI 自动生成 3-5 个子节点。

### 快捷操作
| 操作 | 功能 |
|------|------|
| 💡 发散思维 | 围绕主题发散创意 |
| 📋 拆解步骤 | 分解为执行步骤 |
| ✨ 优化文案 | 润色节点文字 |

### 智能工具
培养想法、工作分解、改组重构、语义聚类、视频脚本、解释说明、数据脱敏
            ` },
            {
                id: 'shortcuts', icon: '⌨️', title: '快捷键', content: `
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
            ` }
        ]
    },
    // ========== AI 图片识别 ==========
    {
        id: 'ai-image-recognition',
        icon: '🖼️',
        name: 'AI 图片识别',
        description: '让 AI 看懂你的图片，批量分析无压力',
        sections: [
            {
                id: 'quick-start', icon: '🚀', title: '快速开始', content: `
### 第一步：上传图片
1. 点击上传区域或拖拽图片到界面
2. 支持批量上传多张图片
3. 支持 JPG、PNG、GIF、WebP 格式

### 第二步：配置分析
1. 选择分析模式（自动识别/自定义提示词）
2. 设置输出语言
3. 可选：启用纯回复模式

### 第三步：开始分析
1. 点击「开始分析」按钮
2. AI 会逐张分析每张图片
3. 结果显示在图片下方
            ` },
            {
                id: 'analysis-mode', icon: '🤖', title: 'AI 分析', content: `
### 分析模式
| 模式 | 说明 |
|------|------|
| 自动识别 | AI 自动描述图片内容 |
| 物体识别 | 识别图片中的物体 |
| 文字提取 | OCR 提取图片中的文字 |
| 场景分析 | 分析图片场景和氛围 |
| 自定义 | 使用自定义提示词 |

### 纯回复模式
启用后，AI 只返回分析结果，适合需要结构化输出的场景。
            ` },
            {
                id: 'export', icon: '📤', title: '导出结果', content: `
### 导出格式
- **CSV**：表格格式，可用 Excel 打开
- **JSON**：结构化数据，适合程序处理
- **TXT**：纯文本格式
- **复制结果**：一键复制到剪贴板
            ` }
        ]
    },
    // ========== 智能翻译 ==========
    {
        id: 'smart-translate',
        icon: '🌐',
        name: '智能翻译',
        description: '强大的翻译功能，支持OCR识别',
        sections: [
            {
                id: 'instant', icon: '⚡', title: '即时翻译', content: `
### 即时翻译

- 输入或粘贴文字快速翻译
- 粘贴截图自动OCR识别
- 点击"立即翻译"或按 Ctrl/Cmd+Enter
- 使用 × 按钮删除图片
- 不浪费API - 只在需要时翻译
            ` },
            {
                id: 'batch', icon: '📚', title: '批量翻译', content: `
### 批量翻译

- 一次上传多张图片
- 自动OCR识别
- 批量翻译所有内容
- 导出结果到Excel
- 适合文档批量处理
            ` },
            {
                id: 'tips', icon: '💡', title: '使用技巧', content: `
### 小技巧

- OCR本地处理 - 无需上传
- 多文档处理使用批量模式
- 翻译前先选择目标语言
- 导出Excel保存记录
            ` }
        ]
    },
    // ========== 提示词工具 ==========
    {
        id: 'prompt-tool',
        icon: '💡',
        name: '提示词工具',
        description: '创建和优化详细的AI提示词',
        sections: [
            {
                id: 'quick-start', icon: '🚀', title: '快速开始', content: `
### 使用方法

1. 输入基础描述或概念
2. 选择想要的风格或氛围
3. 点击"生成"创建详细提示词
4. 查看并优化结果
5. 复制提示词用于AI绘画平台
            ` },
            {
                id: 'output', icon: '📝', title: '输出格式', content: `
### 输出格式

- 英文版本适用于国际平台（Midjourney、DALL·E）
- 中文版本适用于本地平台
- 两者都针对AI理解优化
- 包含技术参数
- 可直接使用
            ` }
        ]
    },
    // ========== 数据分析 ==========
    {
        id: 'sheetmind',
        icon: '📊',
        name: '数据分析',
        description: '让数据开口说话，AI 驱动的智能分析',
        sections: [
            {
                id: 'quick-start', icon: '🚀', title: '快速开始', content: `
### 使用方法

1. 点击「上传文件」或拖拽文件到界面
2. 支持 Excel、CSV、JSON 等格式
3. 选择要分析的列
4. 设置分组和聚合方式
5. 在表格视图中查看数据
            ` },
            {
                id: 'views', icon: '📊', title: '可视化视图', content: `
### 视图类型
| 视图 | 说明 |
|------|------|
| 表格视图 | 标准电子表格界面 |
| 画廊视图 | 以卡片形式展示 |
| 图表视图 | 数据可视化 |
| 仪表盘 | 多图表组合 |
            ` }
        ]
    },
    // ========== 快捷键 ==========
    {
        id: 'shortcuts',
        icon: '⌨️',
        name: '快捷键',
        description: '使用快捷键提升工作效率',
        sections: [
            {
                id: 'global', icon: '🌐', title: '全局快捷键', content: `
### 全局快捷键

| 快捷键 | 功能 |
|--------|------|
| Ctrl/Cmd + Enter | 执行/翻译 |
| Ctrl/Cmd + C | 复制选中文字 |
| Ctrl/Cmd + V | 粘贴图片/文字 |
| Escape | 关闭弹窗 |
            ` },
            {
                id: 'editor', icon: '🖼️', title: '图片编辑器', content: `
### 图片编辑器

| 快捷键 | 功能 |
|--------|------|
| Ctrl/Cmd + Z | 撤销上一步 |
| Ctrl/Cmd + Y | 重做 |
| Ctrl/Cmd + S | 保存/下载 |
| Delete | 清除选择 |
            ` },
            {
                id: 'navigation', icon: '🧭', title: '导航', content: `
### 导航

| 快捷键 | 功能 |
|--------|------|
| Tab | 在字段间移动 |
| Shift + Tab | 向后移动 |
| Enter | 确认/提交 |
            ` }
        ]
    },
    // ========== 常见问题 ==========
    {
        id: 'faq',
        icon: '❓',
        name: '常见问题',
        description: 'FAQ - 常见问题解答',
        sections: [
            {
                id: 'api', icon: '🔑', title: 'API 相关', content: `
### Q: 我的 API 密钥存储在哪里？
A: 您的 API 密钥存储在浏览器的 localStorage 中。它永远不会离开您的设备，只会在 API 调用时发送给 Google AI。

### Q: 为什么处理有时会失败？
A: 常见原因：
- 无效或过期的 API 密钥
- 没有网络连接
- API 配额超限
- API 密钥限制（检查 Google AI Studio 中允许的域名）
            ` },
            {
                id: 'data', icon: '🔒', title: '数据安全', content: `
### Q: 我的数据安全吗？
A: 是的。所有处理都发生在：
- 浏览器本地（OCR、界面）
- 直接与 Google AI 通信（仅 API 调用）
- 不会在我们的服务器上存储任何数据
- 除了 AI 处理外，图片不会上传

### Q: 可以离线使用吗？
A: 不可以，需要网络连接才能与 Google AI 服务通信。
            ` },
            {
                id: 'backup', icon: '💾', title: '备份与导出', content: `
### Q: 如何备份我的预设？
A: 关闭前点击"导出预设"。或输入 Gmail 地址进行云同步。没有备份的话，预设会在下次访问时重置为默认值。

### Q: 可以导出我的工作吗？
A: 可以！大部分工具支持：
- Excel 导出（翻译和提示词）
- 图片下载（编辑后的照片）
- 复制到剪贴板（文本）
            ` }
        ]
    }
];

export const HelpCenter: React.FC<HelpCenterProps> = ({ isOpen, onClose, language = 'zh' }) => {
    const [activeModule, setActiveModule] = useState(HELP_MODULES[0].id);
    const [activeSection, setActiveSection] = useState(HELP_MODULES[0].sections[0].id);
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
        if (isOpen) {
            setActiveModule(HELP_MODULES[0].id);
            setActiveSection(HELP_MODULES[0].sections[0].id);
            setSearchQuery('');
        }
    }, [isOpen]);

    if (!isOpen) return null;

    const currentModule = HELP_MODULES.find(m => m.id === activeModule) || HELP_MODULES[0];
    const currentSection = currentModule.sections.find(s => s.id === activeSection) || currentModule.sections[0];

    // 搜索过滤模块
    const filteredModules = searchQuery
        ? HELP_MODULES.filter(m =>
            m.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
            m.sections.some(s =>
                s.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
                s.content.toLowerCase().includes(searchQuery.toLowerCase())
            )
        )
        : HELP_MODULES;

    return (
        <div className="help-center-overlay" onClick={onClose}>
            <div className="help-center-modal" onClick={e => e.stopPropagation()}>
                {/* 头部 */}
                <div className="help-center-header">
                    <div className="help-center-title">
                        <span className="help-center-icon"><BookOpen size={24} /></span>
                        <div>
                            <h2>帮助中心</h2>
                            <p className="help-center-subtitle">AI 创作工具包使用指南</p>
                        </div>
                    </div>
                    <div className="help-center-search">
                        <Search size={14} className="search-icon" />
                        <input
                            type="text"
                            placeholder="搜索帮助..."
                            value={searchQuery}
                            onChange={e => setSearchQuery(e.target.value)}
                        />
                    </div>
                    <button className="help-center-close" onClick={onClose}><X size={18} /></button>
                </div>

                <div className="help-center-body">
                    {/* 左侧模块列表 */}
                    <nav className="help-center-modules">
                        <div className="modules-header">功能模块</div>
                        {filteredModules.map(module => (
                            <button
                                key={module.id}
                                className={`module-item ${activeModule === module.id ? 'active' : ''}`}
                                onClick={() => {
                                    setActiveModule(module.id);
                                    setActiveSection(module.sections[0].id);
                                }}
                            >
                                <span className="module-icon">{module.icon}</span>
                                <span className="module-name">{module.name}</span>
                            </button>
                        ))}
                    </nav>

                    {/* 中间章节导航 */}
                    <nav className="help-center-sections">
                        <div className="sections-header">
                            <span>{currentModule.icon}</span>
                            <span>{currentModule.name}</span>
                        </div>
                        <p className="sections-desc">{currentModule.description}</p>
                        <div className="sections-list">
                            {currentModule.sections.map(section => (
                                <button
                                    key={section.id}
                                    className={`section-item ${activeSection === section.id ? 'active' : ''}`}
                                    onClick={() => setActiveSection(section.id)}
                                >
                                    <span className="section-icon">{section.icon}</span>
                                    <span>{section.title}</span>
                                </button>
                            ))}
                        </div>
                    </nav>

                    {/* 右侧内容区 */}
                    <div className="help-center-content">
                        <h1>
                            <span>{currentSection.icon}</span>
                            {currentSection.title}
                        </h1>
                        <div
                            className="help-content-body"
                            dangerouslySetInnerHTML={{
                                __html: simpleMarkdownToHtml(currentSection.content)
                            }}
                        />
                    </div>
                </div>

                {/* 底部 */}
                <div className="help-center-footer">
                    <span>按 ESC 关闭帮助中心</span>
                    <span className="help-version">v2.8.0</span>
                </div>
            </div>
        </div>
    );
};

// 简单的 Markdown 转 HTML
function simpleMarkdownToHtml(md: string): string {
    return md
        .replace(/```(\w*)\n([\s\S]*?)```/g, '<pre><code>$2</code></pre>')
        .replace(/`([^`]+)`/g, '<code>$1</code>')
        .replace(/^### (.+)$/gm, '<h3>$1</h3>')
        .replace(/^## (.+)$/gm, '<h2>$1</h2>')
        .replace(/^# (.+)$/gm, '<h1>$1</h1>')
        .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
        .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2" target="_blank" rel="noopener noreferrer">$1</a>')
        .replace(/^> (.+)$/gm, '<blockquote>$1</blockquote>')
        .replace(/\|(.+)\|/g, (match) => {
            const cells = match.split('|').filter(c => c.trim());
            if (cells.every(c => /^[-:]+$/.test(c.trim()))) return '';
            const row = cells.map(c => `<td>${c.trim()}</td>`).join('');
            return `<tr>${row}</tr>`;
        })
        .replace(/^- (.+)$/gm, '<li>$1</li>')
        .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
        .replace(/\n\n/g, '</p><p>')
        .replace(/\n/g, '<br>')
        .replace(/(<tr>.*<\/tr>)+/gs, '<table>$&</table>')
        .replace(/(<li>.*<\/li>)+/gs, '<ul>$&</ul>');
}

export default HelpCenter;
