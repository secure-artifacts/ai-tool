import React, { useState } from 'react';
import './TutorialModal.css';

interface TutorialSection {
    id: string;
    icon: string;
    title: { en: string; zh: string };
    content: { en: string; zh: string };
}

interface TutorialModalProps {
    onClose: () => void;
    language: 'en' | 'zh';
}

// 教程内容数据
const tutorialSections: TutorialSection[] = [
    {
        id: 'video-tutorials',
        icon: '🎬',
        title: { en: 'Video Tutorials', zh: '视频教程' },
        content: {
            en: `Video tutorials and learning resources.

**Coming Soon!**

We're preparing detailed video tutorials for each feature. Check back soon!

**Planned Topics:**
• Getting Started Guide
• API Key Setup Tutorial
• AI One-Click Retouch Workflow
• Image to Prompt Techniques
• Translation Features Deep Dive
• Custom Preset Creation
• Advanced Tips & Tricks

---

**👇 Add your own tutorial links below 👇**

[Your content here - replace this text with links to your tutorial videos, articles, or learning resources]

**Example format:**
• Getting Started: [Video link]
• Advanced Techniques: [Article link]
• Community Resources: [Forum/Discord link]

**Suggested Resources:**
• YouTube Channel: [Link here]
• Documentation: [Link here]
• Community Forum: [Link here]
• Discord Server: [Link here]

---

**Have suggestions for tutorial topics?**
Click the Feedback button (💬) to let us know what you'd like to learn!`,
            zh: `视频教程和学习资源

**即将推出！**

我们正在为每个功能准备详细的视频教程，敬请期待！


我们正在为每个功能准备详细的视频教程，敬请期待！
🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥

原名创艺魔盒
现名AI一键修图
手册和教程：https://drive.google.com/drive/folders/1qzdDcut79EL9NpCvDt50f8AHGnmmc_es?usp=drive_link

 
原名幻影迁移
现名AI图片编辑器
手册和演示案例（需要录教程可以说下）：https://drive.google.com/drive/folders/1wR5M0hLOIi307Hr6y9axExPG5Cxx-tQ2?usp=drive_link
个支持多图层，可以合成，扩图，换场景，换装，换脸，AI对话，提取画风等等，

🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥🔥




**计划主题：**
• 入门指南
• APIKey 设置教程
• AI 一键修图工作流程
• 图片生成提示词技巧
• 翻译功能深度解析
• 自定义预设创建
• 高级技巧与窍门

---

**👇 在下方添加您的教程链接 👇**

[在此添加您的内容 - 将此文本替换为您的教程视频、文章或学习资源链接]

**示例格式：**
• 入门教程：[视频链接]
• 高级技巧：[文章链接]
• 社区资源：[论坛/Discord链接]

**推荐资源：**
• YouTube频道：[链接]
• 文档中心：[链接]
• 社区论坛：[链接]
• Discord服务器：[链接]

---

**有教程主题建议？**
点击"建议反馈"按钮（�）告诉我们您想学习什么！`
        }
    },
    {
        id: 'getting-started',
        icon: '🚀',
        title: { en: 'Getting Started', zh: '快速开始' },
        content: {
            en: `Welcome to AI Creative Toolkit!

**Step 1: Set Your API Key**
Click the 🔑 button in the top right corner and enter your Google Gemini API key. Your key is stored locally in your browser and never uploaded to any server.

**How to get an API key:**
• Visit Google AI Studio (aistudio.google.com)
• Sign in with your Google account
• Click "Get API Key"
• Copy and paste it into the API Key field

**Step 2: Choose a Tool**
Select from the navigation bar at the top:
• AI One-Click Retouch - Professional image editing
• AI Image Editor - Advanced image manipulation
• Image to Prompt - Extract descriptions from images
• Prompt Innovator - Create detailed AI prompts
• Innovation Instruction Template - Custom templates
• Smart Translate - Translation with OCR support
• Generate Sub-Email - Email utilities
• 文案加工站 - Content splitting
• AI Software Directory - Software catalog

**Step 3: Start Creating**
Each tool has its own interface with helpful tooltips. Just follow the on-screen instructions!`,
            zh: `欢迎使用 AI 创作工具包！

**第一步：设置 API Key**
点击右上角的 🔑 按钮，输入您的 Google Gemini API 密钥。您的密钥仅保存在浏览器本地，不会上传到任何服务器。

**如何获取 API 密钥：**
• 访问 Google AI Studio (aistudio.google.com)
• 使用 Google 账号登录
• 点击"获取 API Key"
• 复制并粘贴到 API Key 输入框

**第二步：选择工具**
从顶部导航栏选择功能：
• AI 一键修图 - 专业图片编辑
• AI 图片编辑器 - 高级图片处理
• 图片生成提示词 - 从图片提取描述
• 提示词工具 - 创建详细AI提示词
• 创新指令模板 - 自定义模板
• 智能翻译 - 支持OCR的翻译
• 生成子邮箱 - 邮箱工具
• 文案加工站 - 内容分割
• AI 软件目录 - 软件目录

**第三步：开始创作**
每个工具都有自己的界面和提示说明，跟随屏幕指引操作即可！`
        }
    },
    {
        id: 'studio',
        icon: '🎨',
        title: { en: 'AI One-Click Retouch', zh: 'AI 一键修图' },
        content: {
            en: `Professional AI-powered image editing with custom presets.

**Available Features:**

**Basic Retouch**
• Beauty enhancement
• Skin smoothing
• Blemish removal
• Color correction

**Outfit Change**
• Change clothing styles
• Try different outfits
• Fashion suggestions

**Portrait**
• Face enhancement
• Expression adjustments
• Professional headshots

**Background**
• Remove background
• Change background
• Background blur/replacement

**Filter Effects**
• Artistic filters
• Color grading
• Style transfer

**Smart Matting**
• Remove unwanted objects
• Keep subject only
• Custom area selection

**Custom Edit**
• Free-form instructions
• Custom modifications
• Save as reusable presets

**How to Use:**
1. Upload an image
2. Select a category tab (Retouch, Outfit, etc.)
3. Choose a preset or enter custom instructions
4. Click "Execute" to apply
5. Download the result

**Preset Management:**
• Create custom presets for repeated tasks
• Export/Import presets for backup
• Sync presets via Gmail account
• Organize presets by category

**Tips:**
• Use custom presets for brand-consistent editing
• Combine multiple effects
• Export presets regularly to avoid data loss`,
            zh: `专业的AI图片编辑，支持自定义预设。

**可用功能：**

**基础美化**
• 美颜增强
• 皮肤平滑
• 瑕疵去除
• 色彩校正

**换装**
• 更换服装风格
• 尝试不同搭配
• 时尚建议

**人像**
• 面部优化
• 表情调整
• 专业证件照

**背景**
• 背景去除
• 更换背景
• 背景虚化/替换

**滤镜效果**
• 艺术滤镜
• 色彩分级
• 风格迁移

**智能抠图**
• 移除不需要的物体
• 保留主体
• 自定义区域选择

**自定义编辑**
• 自由描述修改
• 自定义修改指令
• 保存为可复用预设

**使用方法：**
1. 上传图片
2. 选择分类标签页（美化、换装等）
3. 选择预设或输入自定义指令
4. 点击"执行"应用效果
5. 下载处理结果

**预设管理：**
• 创建自定义预设用于重复任务
• 导出/导入预设进行备份
• 通过Gmail账号同步预设
• 按分类组织预设

**小技巧：**
• 使用自定义预设保持品牌一致性
• 组合多种效果
• 定期导出预设避免数据丢失`
        }
    },
    {
        id: 'magic-canvas',
        icon: '✨',
        title: { en: 'AI Image Editor', zh: 'AI 图片编辑器' },
        content: {
            en: `Advanced AI-powered image manipulation tool.

**Main Features:**

**Image Generation**
• Create images from text descriptions
• Multiple style options
• High-quality output

**Image Editing**
• Modify existing images
• Style transfer
• Content-aware editing

**Background Operations**
• Remove background
• Change background
• Background effects

**Object Manipulation**
• Add/remove objects
• Move elements
• Resize and transform

**Artistic Effects**
• Apply artistic styles
• Add filters
• Creative transformations

**How to Use:**
1. Upload an image or start with text
2. Enter your editing instructions
3. AI processes your request
4. Download or further edit the result

**Tips:**
• Be specific with your instructions
• Use descriptive language
• Experiment with different styles
• Save versions for comparison`,
            zh: `高级AI图片处理工具。

**主要功能：**

**图片生成**
• 从文字描述创建图片
• 多种风格选项
• 高质量输出

**图片编辑**
• 修改现有图片
• 风格迁移
• 内容感知编辑

**背景操作**
• 背景去除
• 更换背景
• 背景效果

**物体处理**
• 添加/移除物体
• 移动元素
• 调整大小和变换

**艺术效果**
• 应用艺术风格
• 添加滤镜
• 创意转换

**使用方法：**
1. 上传图片或从文字开始
2. 输入编辑指令
3. AI处理您的请求
4. 下载或进一步编辑结果

**小技巧：**
• 指令要具体明确
• 使用描述性语言
• 尝试不同风格
• 保存版本进行对比`
        }
    },
    {
        id: 'prompt',
        icon: '🖼️',
        title: { en: 'Image to Prompt', zh: '图片生成提示词' },
        content: {
            en: `Generate detailed AI prompts from your images.

**How to Use:**
1. Select AI expert models (multi-select supported)
2. Upload images by clicking, dragging, or pasting (Ctrl+V)
3. Click "Start Generating" to create descriptions
4. View merged prompts in both English and Chinese
5. Chat with each image to refine prompts

**Features:**
• Multi-expert analysis (Midjourney, DALL·E, Stable Diffusion, etc.)
• Interactive chat for each image
• Batch processing multiple images
• Export all results to Excel
• Session history saved automatically

**Available Experts:**
• Midjourney Specialist
• DALL·E Expert
• Stable Diffusion Master
• General AI Art Advisor
• And more...

**Tips:**
• Select multiple experts for comprehensive descriptions
• Use chat to add specific details
• Export regularly to save your work
• Clear history when starting new projects`,
            zh: `从图片生成详细的AI提示词。

**使用方法：**
1. 选择AI绘画专家模型（支持多选）
2. 双击、拖拽或粘贴（Ctrl+V）上传图片
3. 点击"开始生成"创建描述
4. 查看中英文合并的提示词结果
5. 与每张图片对话，优化提示词

**功能特色：**
• 多专家分析（Midjourney、DALL·E、Stable Diffusion等）
• 每张图片可单独对话
• 批量处理多张图片
• 导出所有结果到Excel
• 会话历史自动保存

**可用专家：**
• Midjourney 专家
• DALL·E 专家
• Stable Diffusion 大师
• 通用AI绘画顾问
• 更多专家...

**小技巧：**
• 选择多个专家获得全面描述
• 通过对话添加特定细节
• 定期导出保存工作成果
• 开始新项目时清除历史`
        }
    },
    {
        id: 'desc',
        icon: '💡',
        title: { en: 'Prompt Tool', zh: '提示词工具' },
        content: {
            en: `Create and refine detailed AI prompts for image generation.

**What It Does:**
Transform simple ideas into comprehensive AI prompts with detailed descriptions of:
• Subject and composition
• Lighting and atmosphere
• Style and artistic elements
• Technical parameters
• Camera settings and perspectives

**How to Use:**
1. Enter a basic description or concept
2. Select the style or mood you want
3. Click "Generate" to create detailed prompts
4. Review and refine the results
5. Copy prompts for use in AI art platforms

**Output Format:**
• English version for international platforms (Midjourney, DALL·E)
• Chinese version for local platforms
• Both optimized for AI understanding
• Technical parameters included
• Ready to use immediately

**Tips:**
• Start with clear, simple concepts
• Add specific details through refinement
• Experiment with different styles
• Save successful prompts for reuse
• Combine with Image to Prompt for inspiration`,
            zh: `创建和优化详细的AI图像生成提示词。

**功能说明：**
将简单想法转换为全面的AI提示词，包含详细描述：
• 主体和构图
• 光照和氛围
• 风格和艺术元素
• 技术参数
• 相机设置和视角

**使用方法：**
1. 输入基础描述或概念
2. 选择想要的风格或氛围
3. 点击"生成"创建详细提示词
4. 查看并优化结果
5. 复制提示词用于AI绘画平台

**输出格式：**
• 英文版本适用于国际平台（Midjourney、DALL·E）
• 中文版本适用于本地平台
• 两者都针对AI理解优化
• 包含技术参数
• 可直接使用

**小技巧：**
• 从清晰简单的概念开始
• 通过优化添加具体细节
• 尝试不同风格
• 保存成功的提示词以便复用
• 结合"图片生成提示词"获得灵感`
        }
    },
    {
        id: 'template',
        icon: '📋',
        title: { en: 'Innovation Instruction Template', zh: '创新指令模板' },
        content: {
            en: `Create and manage custom instruction templates for AI tasks.

**What It Does:**
Build reusable instruction templates with customizable parameters for:
• Image editing tasks
• Content generation
• Repeated workflows
• Standardized processes

**Features:**
• Create custom templates
• Add variable parameters
• Save templates for reuse
• Export/Import templates
• Category organization

**How to Use:**
1. Create a new template
2. Define instructions and parameters
3. Add customizable fields
4. Save to your template library
5. Use template by filling in variables

**Template Types:**
• Image editing instructions
• Content generation prompts
• Style transfer templates
• Custom AI workflows

**Tips:**
• Use variables for flexible templates
• Organize by category
• Export templates for backup
• Share templates with team members`,
            zh: `创建和管理AI任务的自定义指令模板。

**功能说明：**
构建可复用的指令模板，支持自定义参数，用于：
• 图片编辑任务
• 内容生成
• 重复性工作流程
• 标准化流程

**功能特色：**
• 创建自定义模板
• 添加可变参数
• 保存模板复用
• 导出/导入模板
• 分类组织

**使用方法：**
1. 创建新模板
2. 定义指令和参数
3. 添加可自定义字段
4. 保存到模板库
5. 填入变量使用模板

**模板类型：**
• 图片编辑指令
• 内容生成提示词
• 风格迁移模板
• 自定义AI工作流

**小技巧：**
• 使用变量创建灵活模板
• 按分类组织
• 导出模板进行备份
• 与团队成员共享模板`
        }
    },
    {
        id: 'translate',
        icon: '🌏',
        title: { en: 'Smart Translate', zh: '智能翻译' },
        content: {
            en: `Powerful translation with OCR support.

**Two Modes Available:**

**Instant Translation**
• Type or paste text for quick translation
• Paste screenshots for automatic OCR
• Click "Translate Now" or press Ctrl/Cmd+Enter
• Delete images with the × button
• No API waste - translate only when needed

**Batch Translation**
• Upload multiple images at once
• Automatic OCR recognition
• Batch translate all content
• Export results to Excel
• Perfect for document processing

**Supported Operations:**
• Text translation (any language pair)
• Image OCR + translation
• Multiple file formats
• Automatic language detection
• Copy translation results
• History tracking

**How to Use:**
1. Select target language
2. Switch between Instant/Batch mode
3. Input text or upload images
4. Get translation results
5. Export or copy as needed

**Tips:**
• OCR works locally - no upload required
• Use batch mode for multiple documents
• Select target language before translating
• Export Excel for record keeping`,
            zh: `强大的翻译功能，支持OCR识别。

**两种模式：**

**即时翻译**
• 输入或粘贴文字快速翻译
• 粘贴截图自动OCR识别
• 点击"立即翻译"或按 Ctrl/Cmd+Enter
• 使用 × 按钮删除图片
• 不浪费API - 只在需要时翻译

**批量翻译**
• 一次上传多张图片
• 自动OCR识别
• 批量翻译所有内容
• 导出结果到Excel
• 适合文档批量处理

**支持的操作：**
• 文字翻译（任意语言对）
• 图片OCR + 翻译
• 多种文件格式
• 自动语言检测
• 复制翻译结果
• 历史记录追踪

**使用方法：**
1. 选择目标语言
2. 切换即时/批量模式
3. 输入文字或上传图片
4. 获取翻译结果
5. 按需导出或复制

**小技巧：**
• OCR本地处理 - 无需上传
• 多文档处理使用批量模式
• 翻译前先选择目标语言
• 导出Excel保存记录`
        }
    },
    {
        id: 'subemail',
        icon: '📧',
        title: { en: 'Generate Sub-Email', zh: '生成子邮箱' },
        content: {
            en: `Generate sub-email addresses for organization and privacy.

**What It Does:**
Create multiple email variants from a single Gmail address using the "+" feature.

**How It Works:**
Gmail treats these as the same address:
• yourname@gmail.com
• yourname+shopping@gmail.com
• yourname+work@gmail.com
• yourname+newsletter@gmail.com

All emails go to the same inbox, but you can filter them easily!

**Use Cases:**
• Separate newsletters from important emails
• Track which services share/sell your email
• Create dedicated addresses for different purposes
• Filter spam more effectively
• Organize incoming mail automatically

**How to Use:**
1. Enter your base Gmail address
2. Add category/purpose labels
3. Generate sub-email addresses
4. Copy and use for registrations
5. Set up filters in Gmail for organization

**Tips:**
• Use descriptive labels (e.g., "+shopping", "+work")
• Create filters in Gmail to auto-organize
• Track which services spam you
• Easy to block by filtering the label`,
            zh: `生成子邮箱地址，用于组织和隐私保护。

**功能说明：**
使用Gmail的"+"功能从单个邮箱创建多个邮箱变体。

**工作原理：**
Gmail将这些视为同一地址：
• yourname@gmail.com
• yourname+购物@gmail.com
• yourname+工作@gmail.com
• yourname+新闻@gmail.com

所有邮件都进入同一收件箱，但可以轻松过滤！

**使用场景：**
• 分离新闻邮件和重要邮件
• 追踪哪些服务共享/出售您的邮箱
• 为不同目的创建专用地址
• 更有效地过滤垃圾邮件
• 自动组织收到的邮件

**使用方法：**
1. 输入基础Gmail地址
2. 添加分类/用途标签
3. 生成子邮箱地址
4. 复制用于注册
5. 在Gmail中设置过滤器进行组织

**小技巧：**
• 使用描述性标签（如"+购物"、"+工作"）
• 在Gmail中创建过滤器自动组织
• 追踪哪些服务发送垃圾邮件
• 通过过滤标签轻松屏蔽`
        }
    },
    {
        id: 'script',
        icon: '📝',
        title: { en: '文案加工站', zh: '文案加工站' },
        content: {
            en: `Split and analyze text content for various purposes.

**What It Does:**
Break down long-form content into manageable pieces for:
• Social media posts
• Marketing materials
• Content planning
• Multi-platform publishing

**Features:**
• Automatic text segmentation
• Character/word count
• Format preservation
• Smart breakpoints
• Copy individual segments

**How to Use:**
1. Paste your long-form content
2. Set splitting parameters (length, style)
3. Review automated segments
4. Adjust as needed
5. Copy segments for use

**Use Cases:**
• Convert blog posts to tweets
• Create social media threads
• Segment marketing copy
• Prepare multi-part content
• Platform-specific formatting

**Tips:**
• Maintain logical breakpoints
• Keep related ideas together
• Consider platform limits
• Review all segments before use`,
            zh: `拆分和分析文案内容，用于各种用途。

**功能说明：**
将长篇内容拆分为可管理的片段，用于：
• 社交媒体发布
• 营销素材
• 内容规划
• 多平台发布

**功能特色：**
• 自动文本分段
• 字符/字数统计
• 格式保留
• 智能断点
• 复制单独片段

**使用方法：**
1. 粘贴长篇内容
2. 设置拆分参数（长度、风格）
3. 查看自动分段
4. 根据需要调整
5. 复制片段使用

**使用场景：**
• 将博客文章转换为推文
• 创建社交媒体话题
• 分段营销文案
• 准备多部分内容
• 平台特定格式化

**小技巧：**
• 保持逻辑断点
• 将相关想法放在一起
• 考虑平台限制
• 使用前审查所有片段`
        }
    },
    {
        id: 'directory',
        icon: '🗂️',
        title: { en: 'AI Software Directory', zh: 'AI 软件目录' },
        content: {
            en: `Browse and discover AI software and tools.

**What It Offers:**
A curated directory of AI tools and software:
• Image generation tools
• Text AI platforms
• Video editing AI
• Audio processing
• Development tools
• Productivity apps

**Features:**
• Categorized listings
• Tool descriptions
• Feature comparisons
• Direct links
• Regular updates

**Categories:**
• Image & Design
• Text & Writing
• Video & Audio
• Development
• Business & Productivity
• Research & Analysis

**How to Use:**
1. Browse by category
2. Read tool descriptions
3. Compare features
4. Click links to visit tools
5. Discover new AI solutions

**Tips:**
• Check tool descriptions for your needs
• Compare similar tools
• Bookmark favorites
• Check back for new additions`,
            zh: `浏览和发现AI软件和工具。

**提供内容：**
精选的AI工具和软件目录：
• 图像生成工具
• 文本AI平台
• 视频编辑AI
• 音频处理
• 开发工具
• 生产力应用

**功能特色：**
• 分类列表
• 工具描述
• 功能对比
• 直接链接
• 定期更新

**分类：**
• 图像与设计
• 文本与写作
• 视频与音频
• 开发工具
• 商务与生产力
• 研究与分析

**使用方法：**
1. 按分类浏览
2. 阅读工具描述
3. 对比功能
4. 点击链接访问工具
5. 发现新的AI解决方案

**小技巧：**
• 根据需求查看工具描述
• 对比类似工具
• 收藏常用工具
• 定期查看新增内容`
        }
    },
    {
        id: 'shortcuts',
        icon: '⌨️',
        title: { en: 'Keyboard Shortcuts', zh: '快捷键' },
        content: {
            en: `Speed up your workflow with keyboard shortcuts.

**Global Shortcuts:**
• Ctrl/Cmd + Enter - Execute/Translate (context-dependent)
• Ctrl/Cmd + C - Copy selected text
• Ctrl/Cmd + V - Paste image/text
• Escape - Close modal windows

**Image Editor:**
• Ctrl/Cmd + Z - Undo last change
• Ctrl/Cmd + Y - Redo change
• Ctrl/Cmd + S - Save/Download
• Delete - Clear selection

**Translation:**
• Ctrl/Cmd + Enter - Translate now
• Ctrl/Cmd + V - Paste for OCR

**Navigation:**
• Tab - Move between fields
• Shift + Tab - Move backward
• Enter - Confirm/Submit

**Tips:**
• Shortcuts work in most tools
• Check each tool for specific shortcuts
• Combine shortcuts for faster workflow`,
            zh: `使用快捷键提升工作效率。

**全局快捷键：**
• Ctrl/Cmd + Enter - 执行/翻译（根据上下文）
• Ctrl/Cmd + C - 复制选中文字
• Ctrl/Cmd + V - 粘贴图片/文字
• Escape - 关闭弹窗

**图片编辑器：**
• Ctrl/Cmd + Z - 撤销上一步
• Ctrl/Cmd + Y - 重做
• Ctrl/Cmd + S - 保存/下载
• Delete - 清除选择

**翻译工具：**
• Ctrl/Cmd + Enter - 立即翻译
• Ctrl/Cmd + V - 粘贴进行OCR

**导航：**
• Tab - 在字段间移动
• Shift + Tab - 向后移动
• Enter - 确认/提交

**小技巧：**
• 大部分工具都支持快捷键
• 查看各工具的特定快捷键
• 组合快捷键加快工作流程`
        }
    },
    {
        id: 'faq',
        icon: '❓',
        title: { en: 'FAQ', zh: '常见问题' },
        content: {
            en: `Frequently Asked Questions

**Q: Where is my API key stored?**
A: Your API key is stored in your browser's localStorage. It never leaves your device and is only sent to Google AI for API calls.

**Q: Why does processing fail sometimes?**
A: Common reasons:
• Invalid or expired API key
• No internet connection
• API quota exceeded
• API key restrictions (check allowed domains in Google AI Studio)

**Q: Can I use this offline?**
A: No, an internet connection is required to communicate with Google's AI services.

**Q: Is my data safe?**
A: Yes. All processing happens:
• Locally in your browser (OCR, interface)
• Directly with Google AI (API calls only)
• No data is stored on our servers
• Images are not uploaded except for AI processing

**Q: How do I back up my presets?**
A: Click "Export Presets" before closing. Or enter your Gmail address for cloud sync. Without backup, presets reset to default on next visit.

**Q: How do I clear my history?**
A: Use the "Clear History" button in each tool or clear your browser cache.

**Q: Can I export my work?**
A: Yes! Most tools support:
• Excel export for translations and prompts
• Image download for edited photos
• Copy to clipboard for text

**Q: How do I report bugs or suggest features?**
A: Click the "Feedback" button (💬) in the header!

**Q: Is there a usage limit?**
A: Limits depend on your Google AI API quota. Check your quota in Google AI Studio.

**Q: Can I use custom presets across devices?**
A: Yes! Either:
• Export presets and import on other devices
• Use Gmail sync (enter same email on all devices)`,
            zh: `常见问题解答

**问：我的 API 密钥存储在哪里？**
答：您的 API 密钥存储在浏览器的 localStorage 中。它不会离开您的设备，只在API调用时发送给 Google AI。

**问：为什么处理有时会失败？**
答：常见原因：
• API 密钥无效或过期
• 没有网络连接
• API 配额用完
• API 密钥有限制（在 Google AI Studio 中检查允许的域名）

**问：可以离线使用吗？**
答：不可以，需要互联网连接才能与 Google AI 服务通信。

**问：我的数据安全吗？**
答：是的。所有处理都在：
• 浏览器本地进行（OCR、界面）
• 直接与 Google AI 通信（仅API调用）
• 我们的服务器不存储任何数据
• 图片仅在AI处理时上传

**问：如何备份我的预设？**
答：关闭前点击"导出预设"。或输入您的Gmail地址进行云同步。不备份的话，下次访问预设会恢复默认。

**问：如何清除历史记录？**
答：使用各工具的"清除历史"按钮或清除浏览器缓存。

**问：可以导出我的工作成果吗？**
答：可以！大部分工具支持：
• Excel导出翻译和提示词
• 图片下载编辑后的照片
• 复制文本到剪贴板

**问：如何报告 Bug 或提建议？**
答：点击顶部的"建议反馈"按钮（💬）！

**问：有使用限制吗？**
答：限制取决于您的 Google AI API 配额。在 Google AI Studio 中查看您的配额。

**问：可以在多设备使用自定义预设吗？**
答：可以！两种方式：
• 导出预设并在其他设备导入
• 使用Gmail同步（在所有设备输入相同邮箱）`
        }
    }
];

export const TutorialModal: React.FC<TutorialModalProps> = ({ onClose, language }) => {
    const [activeSection, setActiveSection] = useState(tutorialSections[0].id);

    const currentSection = tutorialSections.find(s => s.id === activeSection) || tutorialSections[0];

    const t = (key: string) => {
        const translations = {
            en: { title: 'User Guide', close: 'Close' },
            zh: { title: '使用指南', close: '关闭' }
        };
        return translations[language][key as 'title' | 'close'];
    };

    return (
        <div className="tutorial-modal-overlay" onClick={onClose}>
            <div className="tutorial-modal-panel" onClick={(e) => e.stopPropagation()}>
                <div className="tutorial-modal-header">
                    <h2>🎓 {t('title')}</h2>
                    <button className="tutorial-modal-close" onClick={onClose}>×</button>
                </div>

                <div className="tutorial-modal-body">
                    <nav className="tutorial-nav">
                        {tutorialSections.map((section) => (
                            <button
                                key={section.id}
                                className={`tutorial-nav-item ${activeSection === section.id ? 'active' : ''}`}
                                onClick={() => setActiveSection(section.id)}
                            >
                                <span className="tutorial-nav-icon">{section.icon}</span>
                                <span className="tutorial-nav-text">{section.title[language]}</span>
                            </button>
                        ))}
                    </nav>

                    <div className="tutorial-content">
                        <h3>
                            {currentSection.icon} {currentSection.title[language]}
                        </h3>
                        <div className="tutorial-content-text">
                            {currentSection.content[language].split('\n').map((line, index) => {
                                if (line.startsWith('**') && line.endsWith('**')) {
                                    return <h4 key={index}>{line.replace(/\*\*/g, '')}</h4>;
                                } else if (line.startsWith('•')) {
                                    return <li key={index}>{line.substring(1).trim()}</li>;
                                } else if (line.trim()) {
                                    return <p key={index}>{line}</p>;
                                } else {
                                    return <br key={index} />;
                                }
                            })}
                        </div>
                    </div>
                </div>

                <div className="tutorial-modal-footer">
                    <button className="tutorial-close-btn" onClick={onClose}>
                        {t('close')}
                    </button>
                </div>
            </div>
        </div>
    );
};
