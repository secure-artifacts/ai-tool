# AI 创作工具包 - 完整功能说明文档

> 文档基线：基于当前仓库代码整理（`index.tsx` + `apps/*` + `services/*` + `components/*`）  
> 整理日期：2026-02-17（v2.96.0）  
> 说明：本文描述“当前代码能力”，可能与某些历史线上版本文案存在差异。

## 目录

1. [产品概览](#1-产品概览)
2. [整体架构](#2-整体架构)
3. [平台级通用能力](#3-平台级通用能力)
4. [功能总览矩阵（19大工具）](#4-功能总览矩阵19大工具)
5. [工具功能详解](#5-工具功能详解)
6. [跨工具联动与典型工作流](#6-跨工具联动与典型工作流)
7. [数据存储与同步策略](#7-数据存储与同步策略)
8. [认证与权限体系](#8-认证与权限体系)
9. [部署、运行与版本管理](#9-部署运行与版本管理)
10. [配套文档与源码入口](#10-配套文档与源码入口)

---

## 1. 产品概览

AI 创作工具包是一个多工具集成平台，覆盖：

- AI 图片处理（修图、编辑、生图、审核、文字提取）
- 图片理解与提示词工程（反推、识别、创新、模板化）
- 文本生产与处理（翻译、文案拆分、查重去重）
- 数据分析与结构化工作流（SheetMind、思维导图、工具目录管理）

当前主导航共 **19 个核心工具**，并且具备统一的账号、配置、预设、项目、同步与 API 管理能力。

---

## 2. 整体架构

### 2.1 前端与运行形态

- 前端框架：React + TypeScript + Vite
- 主入口：`index.tsx`
- 运行形态：Web 版（Firebase Hosting）、AI Studio 嵌入版、Electron 桌面版（重点增强 SheetMind 大数据本地缓存）

### 2.2 代码组织

- 工具应用：`apps/*`
- 平台组件：`components/*`
- 业务服务：`services/*`
- 上下文：`contexts/*`
- Firebase 与云函数：`firebase/*`, `functions/*`
- 文档：`docs/*`

### 2.3 后端依赖

- Firebase Auth（登录认证）
- Firestore（用户配置、预设、项目、公共数据）
- Firebase Hosting（前端托管）
- Firebase Functions（Service Account Token 转发）
- Google Sheets / GAS（表格写入与配置来源）

---

## 3. 平台级通用能力

### 3.1 全局导航与界面系统

- 19 工具统一导航入口
- 支持中/英语言切换
- 支持主题切换（暗/亮）
- 支持 UI 缩放、字体缩放
- 帮助中心、教程、更新说明、反馈入口内置
- 版本历史查看与版本跳转入口内置

### 3.2 模型与推理配置

- 全局文本模型选择（如 `gemini-3-flash-preview`, `gemini-3-pro-preview`）
- 全局图片模型选择（如 `gemini-2.5-flash-image`, `gemini-3-pro-image-preview (4K)`, `imagen-4.0-generate-001`）
- 图片分辨率选择（1K/2K）
- 多工具共享 `getAiInstance`，统一调用链路

### 3.3 API Key 管理（含 API 池）

- 手动 API Key 模式
- API 池模式（多 Key 自动轮换）
- 共享池模式（内部学习模式，带管理员授权校验）
- Key 管理能力：添加/编辑/删除/批量导入、刷新池、手动轮换到下一个 Key
- 自动轮换策略：对 `quota / 429 / rate limit / RESOURCE_EXHAUSTED` 触发轮换重试，已覆盖 `models.generateContent` 与 `models.generateContentStream`

### 3.4 登录与账号体系

- 邮箱密码登录/注册/找回密码
- Google 普通登录（只读）
- Google 高级登录（含 Sheets 写入范围）
- 登录后自动关联 `presetUser` 与云同步邮箱

### 3.5 统一项目管理（ProjectPanel）

- 按模块管理项目（项目列表、搜索、星标、置顶、重命名、复制、删除）
- 项目状态自动保存（防抖）
- 版本快照管理（创建、回滚、星标、改名、删除）
- 支持无登录下的邮箱云同步回退读取

### 3.6 预设系统

- 支持工具级预设保存/同步（本地 + 云端）
- 支持预设导入/导出（JSON）
- 支持全局预设导入/导出
- 图片修图与模板构建器支持 Google Sheet 预设同步

### 3.7 云同步与表格同步

- 邮箱云同步（`publicSync`）：推送/拉取/合并
- Google Sheets 结果写入（按工具分页）
- 支持连接测试、提交人命名、自动保存开关

### 3.8 反馈与支持体系

- 反馈系统（功能建议 / Bug 上报）
- 帮助中心（整合教程与模块帮助）
- 更新公告与版本日志弹窗

---

## 4. 功能总览矩阵（19大工具）

| 序号 | 工具 | 导航ID | 核心定位 |
|---|---|---|---|
| 1 | AI 一键修图 | `studio` | 预设化修图与批量处理 |
| 2 | AI 图片编辑器 | `magicCanvas` | 图层式编辑、蒙版与对话改图 |
| 3 | 反推提示词 | `prompt` | 从图片反推生成提示词 |
| 4 | AI 图片识别 | `imageRecognition` | 批量识图 + 创新 + 随机库 |
| 5 | 提示词工具 | `desc` | 提示词创新/对话/文案改写 |
| 6 | 模版指令+随机库生成器 | `skillGenerator` | 生成基础指令与随机库 |
| 7 | 专业文案查重 | `proDedup` | MinHash/LSH 查重与搜索 |
| 8 | 智能翻译 | `translate` | OCR+多语批量与即时翻译 |
| 9 | 文案拆分 | `script` | 表格化脚本拆分与清洗 |
|10| 表格数据分析 | `sheetMind` | 表格分析、透视、画廊、仪表盘 |
|11| AI 思维导图 | `mindMap` | 多输入源结构化导图 |
|12| 指令模版 | `template` | 模块化指令模板构建 |
|13| 生成子邮箱 | `subemail` | Gmail 点号变体与密码生成 |
|14| AI 工具集 | `aiToolsDirectory` | AI 工具目录 + 社区共享 |
|15| API 生图 | `apiImageGen` | 批量生图工作流 |
|16| AI 文案去重 | `copyDedup` | AI 语义分组去重 |
|17| 图片审核 | `imageReview` | 审核标注、AI语气翻译解释、报告导出 |
|18| 图片前景文字提取 | `imageTextExtractor` | 批量提取前景文本并翻译 |
|19| 教程检索台 | `tutorialHub` | 教程管理、分类、搜索与检索 |

---

## 5. 工具功能详解

### 5.1 AI 一键修图（`studio`）

- 分类预设体系：换装、人像P图、背景替换、滤镜、智能抠图、自定义修改
- 支持单图与批量模式
- 区域编辑能力：矩形选区、画笔路径、颜色与笔刷尺寸
- 编辑历史：撤销/重做、历史索引预览
- 可将当前图一键发送到 AI 图片编辑器继续精修
- 预设管理：增删改、导入导出、Sheet 同步

### 5.2 AI 图片编辑器（`magicCanvas`）

- 图层系统：增删、显隐、排序、位置/缩放调整
- 画布与工具：移动、画笔、裁剪框、蒙版相关操作
- 双模式：`generate`（生成）/`edit`（对话编辑）
- 编辑对话历史（chat history）与上下文延续
- 样式提取、图层合成、结果下载

### 5.3 反推提示词（`prompt`）

- 专家维度选择（如通用、Midjourney、DALL·E 等）
- 会话管理：多会话、历史、会话删除
- 模式：精确/快速批处理
- 融合模式：多图融合生成提示词
- 支持文件、URL、粘贴、HTML提取等输入路径
- 预设模板与手动指令叠加

### 5.4 AI 图片识别（`imageRecognition`）

- 多工作模式：标准、创新、快捷、拆分模式
- 批量并发处理 + 请求间隔 + 重试退避
- 支持纯回复模式、失败重试、批量重置
- 创新能力：多轮创新、创新数量控制、融合图片创新、结果翻译（中英）
- 随机库系统：多数据源、随机组合/笛卡尔积、AI 填充随机库、Google Sheets 同步、配套指令绑定
- 结果发送到“提示词工具”继续创新流程

### 5.5 提示词工具（`desc`）

- 三大子模式：创新器 / 直接对话 / 文案改写
- 多标签页并行任务系统（Prompt Tabs）
- 每条输出支持独立对话追问与图片附件
- 支持多轮生成、每轮数量控制、翻译显示切换
- 创新要求预设管理
- 支持写入 Google Sheets
- 集成项目管理（保存/恢复任务状态）

### 5.6 模版指令+随机库生成器（`skillGenerator`）

- 输入材料：参考图、样例描述词、常规要求、硬规则
- 生成结果：基础指令 + 随机库表格
- 多工作子标签：AI 生成、AI 高级、手动编辑、AI 扩展、库本地化、AI 分类、代码生成、批量组合
- 支持工作区（Workspace）与历史快照
- 支持自动识图前置分析、追加样本优化
- 支持导入导出与对话扩展

### 5.7 专业文案查重（`proDedup`）

- 双子功能页：文案查重（`ProDedupApp`）与表格查重搜索（`CopySearchApp`）
- `ProDedupApp`：基于 MinHash + LSH 的本地高性能查重，支持阈值设置、结果分组、手动保留唯一项，支持 Sheets 分类库管理与检查/搜索模式
- `CopySearchApp`：解析 Excel/Sheets 粘贴 TSV，支持多搜索词多色高亮、备注绑定、`contains/similar` 模式切换，结果可复制回表格

### 5.8 智能翻译（`translate`）

- 双模式：批量翻译 / 即时翻译
- 输入支持：文本、图片、图片 URL、粘贴截图
- OCR + 翻译一体流程
- 批量多语种翻译（含“仅中文”开关）
- 支持全部重译、全部复制、逐条复制
- 与项目系统打通，可保存翻译工作状态

### 5.9 文案拆分（`script`）

- 网格化编辑（Spreadsheet 风格）
- 常用处理工具：三段拆分 / 两段拆分 / 智能拆分、清理换行、去中文、添加前缀、视频提示格式处理
- AI 拆分：通过模型识别标题与正文分段
- 支持选区处理、格式化复制到 Sheets

### 5.10 表格数据分析（`sheetMind`）

- 视图模式：`grid / dashboard / transpose / gallery / align`
- 多数据源/多 Sheet 管理
- 大数据缓存（浏览器 + Electron 本地文件缓存）
- AI 分析聊天（数据问答与洞察）
- 仪表盘图表快照（云保存）
- 透视/转置、列对齐、画廊展示、查重模式
- 配置面板支持导入导出 JSON

### 5.11 AI 思维导图（`mindMap`）

- 多输入源：文本、图片、文档、YouTube、网页、音频
- AI 节点扩展、改组、聚类、文案优化
- 多布局与视图（大纲、卡片、网格等）
- 节点标记、边界、关系线、摘要层
- 快捷键与右键菜单完整支持

### 5.12 指令模版（`template`）

- 模块化指令编辑（分 section 管理）
- 版本化保存（新增/覆盖/重命名/删除）
- 搜索、恢复默认、重置
- 实时预览合成后的完整指令
- 支持导入导出与 Sheet 同步

### 5.13 生成子邮箱（`subemail`）

- 生成 Gmail 点号变体（支持 `all` 全量）
- 可选密码批量生成（长度、符号、易混字符控制）
- 结果支持逐条复制与一键复制全部

### 5.14 AI 工具集（`aiToolsDirectory`）

- 内置预设工具库（注释标注约 44 个）
- 本地自定义工具管理（localStorage）
- 社区工具共享（Firestore）
- AI URL 分析器：粘贴网站自动补全工具信息
- 支持搜索、分类、价格、安全级别筛选

### 5.15 API 生图（`apiImageGen`）

- 工作流模式：经典 / 创新
- 批量行队列模式（行级图片与描述输入）
- 支持拖拽合并/拆分策略
- 创新模式：先分析生成描述词，再批量生图
- 垫图模式（标准/固定人物）
- 队列暂停、恢复、重试、历史侧栏、预览面板
- 自动下载与批量下载能力

### 5.16 AI 文案去重（`copyDedup`）

- AI 语义判重（分组 + 代表文案）
- 支持双列输入（外文对比 + 中文显示）
- 相似短句高亮显示
- 结果导出（全量表格 / 仅唯一）
- 支持写入 Google Sheets
- 本地文案库维护（保存、清空、统计）

### 5.17 图片审核（`imageReview`）

- 审核状态流：合格/不合格/需修改/放弃
- 双栏反馈结构：问题 + 建议
- 严重级别分级
- 语气级别与翻译目标语言控制
- 审核建议可由 AI 以更合适语气翻译解释，便于新人理解并接受修改建议
- 审核视图/列表视图/执行清单视图切换
- 图片标注（框、箭头、文字、画笔）
- 报告导出：PDF、文本、HTML、剪贴板
- 支持 Gyazo 分享长图链接

### 5.18 图片前景文字提取（`imageTextExtractor`）

- 批量提取前景文字并输出中文翻译
- 输入支持：本地文件、URL、`=IMAGE()`、HTML 粘贴
- 并发与批次控制（batchSize/concurrency）
- 支持任务中止、单条重试、旧结果导入
- 输出支持复制/导出 TXT/CSV/HTML 表格格式
- 结果本地持久化（localStorage）

### 5.19 教程检索台（`tutorialHub`）

- 数据源：支持 Google Sheets URL 导入、粘贴表格数据（TSV/CSV）
- 数据获取：通过 Google Sheets API v4 读取，自动提取单元格超链接（支持"插入链接"和 `=HYPERLINK()` 公式）
- 智能解析：自动识别表头（日期、国家/小区、录屏、文档、概述等），按列头语义分类链接（录屏列链接归为视频类，文档列链接归为文档类）
- 链接类型识别：YouTube、Google Drive 文件/文件夹、Google Docs/Sheets/Slides、视频文件（.mp4/.webm/.mov 等）、通用链接
- 两级分类体系：5 个固定大类（视频类、生图类、设计类、小技巧、其他）+ 自定义子分类
- AI 智能分类：使用 Gemini AI 自动为教程分配大类与子分类（需 API Key）
- 预设分类：无 API Key 时可使用内置预设类别快速分类
- 搜索与筛选：关键词搜索（名称/描述/链接范围）、AI 语义搜索、按大类/子分类筛选
- 双视图模式：网格卡片视图 / 列表视图
- 卡片展示：结构化显示录屏链接、文档链接、概述描述、来源国家/地区、日期
- 自动刷新：页面加载时自动从 Google Sheets 拉取最新数据（后台刷新，先显示本地缓存）
- 数据持久化：表格 URL、教程条目、视图模式、主题均保存至 localStorage
- 主题支持：独立暗色/亮色主题切换
- 批量操作：一键复制全部教程文本、分类结果导出 JSON
- CSV 回退：Sheets API 不可用时自动回退到 CSV 导出模式

---

## 6. 跨工具联动与典型工作流

### 6.1 图片识别 -> 提示词工具

- `imageRecognition` 可将识别/创新结果发送到 `desc`
- 自动构建创新条目并触发后续创新流程

### 6.2 一键修图 -> AI 图片编辑器

- `studio` 中可将当前图发送到 `magicCanvas`
- 适用于“预设快修 -> 图层精修”的串联流程

### 6.3 表格同步工作流

- 图片识别/提示词/翻译/去重结果可统一写入 Sheets
- 通过“提交人-功能名”自动分表页沉淀

### 6.4 项目化工作流

- 图片识别、提示词、翻译等支持项目化保存
- 可在项目中做版本快照并回滚

---

## 7. 数据存储与同步策略

### 7.1 本地存储（localStorage）

- API Key、API池开关、UI配置、部分工具状态、历史记录、预设

### 7.2 Firestore 存储

- 用户设置、预设、模板、项目、分类配置、公共共享数据

### 7.3 邮箱云同步（`publicSync`）

- 无需登录也可通过邮箱同步关键数据（需用户知晓共享风险）
- 支持拉取、推送、冲突合并

### 7.4 Google Sheets

- 结果归档与轻量协作
- 支持 API Key 只读、Service Account 读写、OAuth 读写

---

## 8. 认证与权限体系

### 8.1 登录模式

- 邮箱密码
- Google 普通登录（只读）
- Google 高级登录（含写入权限 scopes）

### 8.2 Sheets 认证模式

- `apiKey`：只读
- `serviceAccount`：读写（推荐长期稳定）
- `customOAuth`：读写（自定义客户端）
- `builtinOAuth`：读写（白名单测试模式）

### 8.3 权限与规则

- Firestore 规则区分登录用户、自定义公共集合与邮箱同步集合
- 共享配置（如共享 API 池）限制写入权限

---

## 9. 部署、运行与版本管理

### 9.1 本地开发

- `npm install`
- 配置 `.env.local`（`GEMINI_API_KEY`）
- `npm run dev`

### 9.2 Web 部署

- Firebase Hosting（`dist`）
- 单页路由重写到 `index.html`

### 9.3 云函数

- `functions/src/index.ts`：提供 Service Account token（Sheets API 使用）

### 9.4 Electron 桌面版

- 目录：`electron/*`
- 重点能力：SheetMind 本地缓存增强、离线友好、桌面下载体验优化

### 9.5 版本管理

- 应用内提供版本历史展示与入口切换
- 更新说明在 `UpdateNotice` 中维护

---

## 10. 配套文档与源码入口

### 10.1 关键源码入口

- 主入口与路由：`index.tsx`
- 认证：`contexts/AuthContext.tsx`, `services/authService.ts`
- 项目系统：`services/projectService.ts`, `components/ProjectPanel.tsx`
- 云同步：`services/cloudSyncService.ts`, `components/CloudSyncPanel.tsx`
- 表格同步：`services/sheetsSyncService.ts`
- Sheets 认证：`services/sheetsAuthService.ts`, `components/SheetsAuthConfig.tsx`
- 云函数：`functions/src/index.ts`
- Firestore 规则：`firestore.rules`

### 10.2 工具源码入口（按导航）

- `studio`：`index.tsx`（`ImageStudioTool`）
- `magicCanvas`：`apps/ai-image-editor/AIImageEditorApp.tsx`
- `prompt`：`apps/image-to-prompt/ImageToPromptApp.tsx`
- `imageRecognition`：`apps/ai-image-recognition/ImageRecognitionApp.tsx`
- `desc`：`apps/prompt-tool/PromptToolApp.tsx`
- `skillGenerator`：`apps/skill-generator/SkillGeneratorApp.tsx`
- `proDedup`：`apps/ai-copy-deduplicator/ProDedupApp.tsx`
- `translate`：`apps/smart-translate/SmartTranslateApp.tsx`
- `script`：`apps/script-split/ScriptToolApp.tsx`
- `sheetMind`：`apps/sheetmind/SheetMindApp.tsx`
- `mindMap`：`apps/ai-mind-map/MindMapApp.tsx`
- `template`：`index.tsx`（`TemplateBuilderTool`）
- `subemail`：`apps/sub-email/SubEmailGenerator.tsx`
- `aiToolsDirectory`：`apps/ai-tools/AIToolsDirectoryApp.tsx`
- `apiImageGen`：`apps/api-image-gen/ApiImageGenApp.tsx`
- `copyDedup`：`apps/ai-copy-deduplicator/AICopyDeduplicatorApp.tsx`
- `imageReview`：`apps/image-review/ImageReviewApp.tsx`
- `imageTextExtractor`：`apps/image-text-extractor/ImageTextExtractorApp.tsx`
- `tutorialHub`：`apps/tutorial-hub/TutorialHubApp.tsx`

### 10.3 已有专项文档

- `docs/Skill-Generator-完整功能文档.md`
- `docs/sheets-auth-guide.md`
- `docs/表格同步使用说明.md`

---

如果你需要，我可以继续基于这份文档输出两版衍生稿：

1. 对外发布版（面向用户，语言更产品化）  
2. 开发交接版（面向开发者，补充模块依赖图、状态字段、接口与数据结构清单）
