import { getMainAiInstance, getStoredApiKey } from './aiAccess';
import type {
    AIExpandResult,
    AIGeneratedStructure,
    AIGeneratedNode,
    ImageRecognitionResult,
    MindMapNode,
    ContentMode
} from '../types';
import {
    type PromptMode,
    buildMapifyPrompt,
    buildSimplePrompt,
} from '../prompts/promptPresets';

// 可用的 Gemini 模型 (使用官方 API 正确名称)
export type GeminiModelId = 'gemini-3-flash-preview' | 'gemini-3-pro-preview' | 'gemini-2.5-flash' | 'gemini-2.0-flash';

export const GEMINI_MODELS: { id: GeminiModelId; label: string; description: string }[] = [
    { id: 'gemini-3-flash-preview', label: 'Gemini 3 Flash', description: '最新快速模型，平衡速度与能力' },
    { id: 'gemini-3-pro-preview', label: 'Gemini 3 Pro', description: '最强模型，复杂任务首选' },
    { id: 'gemini-2.5-flash', label: 'Gemini 2.5 Flash', description: '稳定快速模型' },
    { id: 'gemini-2.0-flash', label: 'Gemini 2.0 Flash', description: '经典快速模型' },
];

// 默认使用稳定的 2.5 Flash
let currentModel: GeminiModelId = 'gemini-2.5-flash';

const getApiUrl = (model: GeminiModelId = currentModel) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

// 流式 API URL
const getStreamApiUrl = (model: GeminiModelId = currentModel) =>
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`;

const GEMINI_PROXY_URL = '/api/gemini';

// 流式生成进度回调
export interface StreamProgress {
    type: 'start' | 'node' | 'complete' | 'error';
    node?: AIGeneratedNode;          // 新生成的节点
    partialText?: string;            // 当前累积的文本
    totalNodes?: number;             // 已生成节点数
    structure?: AIGeneratedStructure; // 完整结构（complete 时）
    error?: string;
}

interface GeminiResponse {
    candidates?: Array<{
        content?: {
            parts?: Array<{
                text?: string;
            }>;
        };
    }>;
    error?: {
        message: string;
    };
}

export class GeminiService {
    private apiKey: string;
    private getAiInstance: (() => any) | null;
    private model: GeminiModelId;

    constructor(apiKey?: string, model?: GeminiModelId) {
        this.apiKey = apiKey?.trim() || '';
        this.getAiInstance = getMainAiInstance();
        this.model = model || currentModel;
    }

    // 设置全局默认模型
    static setDefaultModel(model: GeminiModelId) {
        currentModel = model;
    }

    // 获取当前模型
    static getCurrentModel(): GeminiModelId {
        return currentModel;
    }

    // 设置当前实例的模型
    setModel(model: GeminiModelId) {
        this.model = model;
    }

    // 获取 API URL
    private getApiUrl(): string {
        return getApiUrl(this.model);
    }

    // ===================================
    // 文本 → 思维导图（支持多种 Prompt 模式）
    // ===================================
    async generateFromText(
        text: string,
        mode: ContentMode = 'general',
        maxDepth = 3,
        detailLevel: 'brief' | 'standard' | 'detailed' | 'extreme' = 'standard',
        promptMode: PromptMode = 'mapify',
        customPrompt?: string
    ): Promise<AIGeneratedStructure> {
        const modeInstructions = this.getModeInstructions(mode);

        // 根据详细度计算目标节点数
        const targetNodes = {
            brief: { l1: 5, l2: 3, l3: 2 },
            standard: { l1: 6, l2: 4, l3: 3 },
            detailed: { l1: 7, l2: 5, l3: 4 },
            extreme: { l1: 8, l2: 6, l3: 5 }
        }[detailLevel];

        let prompt: string;

        // 根据 prompt 模式选择不同的生成策略
        switch (promptMode) {
            case 'simple':
                // ⚡ 极简模式 - 快速生成
                prompt = buildSimplePrompt(text, modeInstructions);
                break;

            case 'custom':
                // ✏️ 自定义模式 - 用户自己的 Prompt
                if (customPrompt) {
                    prompt = customPrompt
                        .replace(/\{text\}/g, text)
                        .replace(/\{input\}/g, text)
                        .replace(/\{userInput\}/g, text);
                } else {
                    // 如果没有自定义 prompt，回退到简单模式
                    prompt = buildSimplePrompt(text, modeInstructions);
                }
                break;

            case 'mapify':
            default:
                // 🚀 Mapify 风格 - 深层结构 + Few-Shot
                prompt = buildMapifyPrompt(text, modeInstructions, targetNodes);
                break;
        }

        // 一次性生成完整结构，不再二次扩展（提速关键）
        const structure = await this.callGeminiForStructure(prompt, {
            temperature: promptMode === 'simple' ? 0.6 : 0.4,  // 简单模式温度稍高
            maxOutputTokens: promptMode === 'simple' ? 4096 : 8192  // 简单模式输出较短
        });

        return this.normalizeStructureOutput(structure);
    }

    // ===================================
    // 🚀 流式生成 + 渐进渲染（Mapify 核心体验）
    // ===================================
    async generateFromTextStreaming(
        text: string,
        mode: ContentMode = 'general',
        onProgress: (progress: StreamProgress) => void,
        detailLevel: 'brief' | 'standard' | 'detailed' | 'extreme' = 'standard'
    ): Promise<AIGeneratedStructure> {
        const modeInstructions = this.getModeInstructions(mode);

        const targetNodes = {
            brief: { l1: 5, l2: 3, l3: 2 },
            standard: { l1: 6, l2: 4, l3: 3 },
            detailed: { l1: 7, l2: 5, l3: 4 },
            extreme: { l1: 8, l2: 6, l3: 5 }
        }[detailLevel];

        // 强调流式友好的输出格式
        const prompt = `# Role
你是一个专业思维导图生成引擎。

# User Input
"""
${text}
"""

${modeInstructions ? `# Content Mode\n${modeInstructions}\n` : ''}
# 结构要求
- 一级分支：${targetNodes.l1}-${targetNodes.l1 + 2} 个
- 每个一级下：${targetNodes.l2}-${targetNodes.l2 + 2} 个二级
- 每个二级下：${targetNodes.l3}-${targetNodes.l3 + 1} 个三级
- 禁止空泛概括，必须有具体内容
- MECE 原则：同级节点相互独立

# Output Format
只返回 JSON，格式如下：
{
  "title": "根节点标题",
  "children": [
    {
      "label": "一级分支",
      "description": "说明",
      "logicType": "parallel",
      "children": [
        { 
          "label": "二级", 
          "description": "具体说明",
          "children": [
            { "label": "三级细节", "description": "详细说明" }
          ]
        }
      ]
    }
  ],
  "missingHints": []
}`;

        // 通知开始
        onProgress({ type: 'start', totalNodes: 0 });

        const storedKey = getStoredApiKey();
        const effectiveKey = this.apiKey || storedKey;

        try {
            // 使用流式 API
            const response = await fetch(
                `${getStreamApiUrl(this.model)}${effectiveKey ? `&key=${effectiveKey}` : ''}`,
                {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        contents: [{ parts: [{ text: prompt }] }],
                        generationConfig: {
                            temperature: 0.4,
                            maxOutputTokens: 8192,
                            responseMimeType: 'application/json' // 🔥 JSON Mode 强制输出
                        }
                    })
                }
            );

            if (!response.ok) {
                throw new Error(`API 请求失败: ${response.status}`);
            }

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error('无法读取响应流');
            }

            let fullText = '';
            let nodeCount = 0;
            const decoder = new TextDecoder();

            // 流式读取响应
            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                const chunk = decoder.decode(value, { stream: true });

                // 解析 SSE 格式
                const lines = chunk.split('\n');
                for (const line of lines) {
                    if (line.startsWith('data: ')) {
                        try {
                            const data = JSON.parse(line.slice(6));
                            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
                            fullText += text;

                            // 尝试解析部分 JSON 来检测新节点
                            const newNodes = this.detectNewNodes(fullText, nodeCount);
                            if (newNodes.length > 0) {
                                for (const node of newNodes) {
                                    nodeCount++;
                                    onProgress({
                                        type: 'node',
                                        node,
                                        totalNodes: nodeCount,
                                        partialText: fullText
                                    });
                                }
                            }
                        } catch {
                            // SSE 解析错误，继续
                        }
                    }
                }
            }

            // 解析完整结构
            const jsonText = this.extractJsonObject(fullText);
            if (jsonText) {
                const structure = JSON.parse(jsonText) as AIGeneratedStructure;
                const normalized = this.normalizeStructureOutput(structure);

                onProgress({
                    type: 'complete',
                    structure: normalized,
                    totalNodes: this.countNodes(normalized)
                });

                return normalized;
            }

            throw new Error('AI 返回格式异常');
        } catch (error) {
            const message = error instanceof Error ? error.message : '生成失败';
            onProgress({ type: 'error', error: message });
            throw error;
        }
    }

    // 检测新生成的节点（用于渐进渲染）
    private detectNewNodes(partialJson: string, existingCount: number): AIGeneratedNode[] {
        const nodes: AIGeneratedNode[] = [];

        // 使用正则匹配已完成的节点定义
        const labelMatches = partialJson.match(/"label"\s*:\s*"([^"]+)"/g) || [];

        // 只返回新检测到的节点
        for (let i = existingCount; i < labelMatches.length; i++) {
            const match = labelMatches[i].match(/"label"\s*:\s*"([^"]+)"/);
            if (match) {
                nodes.push({
                    label: match[1],
                    description: '',
                    children: []
                });
            }
        }

        return nodes;
    }

    // 计算节点总数
    private countNodes(structure: AIGeneratedStructure): number {
        let count = 1; // root
        const walk = (nodes: AIGeneratedNode[] = []) => {
            for (const node of nodes) {
                count++;
                if (node.children) walk(node.children);
            }
        };
        walk(structure.children);
        return count;
    }

    // ===================================
    // 🌐 联网增强生成（简化版 RAG - 使用 Google Search）
    // ===================================
    async generateWithWebSearch(
        text: string,
        mode: ContentMode = 'general',
        detailLevel: 'brief' | 'standard' | 'detailed' | 'extreme' = 'standard'
    ): Promise<AIGeneratedStructure & { searchInfo?: { queries: string[]; sources: string[] } }> {
        const modeInstructions = this.getModeInstructions(mode);

        const targetNodes = {
            brief: { l1: 5, l2: 3, l3: 2 },
            standard: { l1: 6, l2: 4, l3: 3 },
            detailed: { l1: 7, l2: 5, l3: 4 },
            extreme: { l1: 8, l2: 6, l3: 5 }
        }[detailLevel];

        const prompt = `# Role
你是一个联网搜索增强的思维导图专家。请先搜索「${text}」相关的最新信息，然后生成一个信息丰富、有据可查的思维导图。

# User Input
"""
${text}
"""

${modeInstructions ? `# Content Mode\n${modeInstructions}\n` : ''}
# 🌐 联网搜索要求
1. **必须搜索**：先搜索相关的最新信息、数据、趋势
2. **引用来源**：每个重要节点的 description 要标注信息来源
3. **时效性**：优先使用 2024-2025 年的最新数据
4. **准确性**：避免臆造，不确定的信息要标注

# 结构要求
- 一级分支：${targetNodes.l1}-${targetNodes.l1 + 2} 个
- 每个一级下：${targetNodes.l2}-${targetNodes.l2 + 2} 个二级
- 每个二级下：${targetNodes.l3}-${targetNodes.l3 + 1} 个三级
- MECE 原则：同级节点相互独立

# Output Format
只返回 JSON：
{
  "title": "根节点标题",
  "children": [
    {
      "label": "一级分支",
      "description": "说明（来源：xxx）",
      "logicType": "parallel",
      "sources": ["https://example.com"],
      "children": [
        { 
          "label": "二级", 
          "description": "具体信息，数据：xxx（来源：xxx）",
          "children": [
            { "label": "三级细节", "description": "详细说明" }
          ]
        }
      ]
    }
  ],
  "missingHints": [],
  "searchSummary": "本次搜索到的主要信息来源概述"
}`;

        try {
            const response = await this.requestGeminiWithSearch(prompt, 0.4);
            const textContent = response.candidates?.[0]?.content?.parts?.[0]?.text || '';

            const jsonText = this.extractJsonObject(textContent);
            if (jsonText) {
                const structure = JSON.parse(jsonText) as AIGeneratedStructure & { searchSummary?: string };
                const normalized = this.normalizeStructureOutput(structure);

                // 提取搜索信息
                const searchInfo = {
                    queries: response.groundingMetadata?.webSearchQueries || [],
                    sources: this.extractSourcesFromStructure(normalized)
                };

                return { ...normalized, searchInfo };
            }

            throw new Error('AI 返回格式异常');
        } catch (error) {
            console.error('联网生成失败，回退到普通生成:', error);
            // 回退到普通生成
            return this.generateFromText(text, mode, 4, detailLevel);
        }
    }

    // 从结构中提取所有来源
    private extractSourcesFromStructure(structure: AIGeneratedStructure): string[] {
        const sources = new Set<string>();

        const walk = (nodes: AIGeneratedNode[] = []) => {
            for (const node of nodes) {
                if (node.sources) {
                    node.sources.forEach(s => sources.add(s));
                }
                // 从 description 中提取来源
                if (node.description) {
                    const matches = node.description.match(/来源[：:]\s*([^\s,，。]+)/g);
                    matches?.forEach(m => sources.add(m.replace(/来源[：:]\s*/, '')));
                }
                if (node.children) walk(node.children);
            }
        };

        walk(structure.children);
        return Array.from(sources);
    }

    // ===================================
    // 图片识别 → 思维导图（核心能力）
    // ===================================
    async recognizeImage(base64Image: string, instruction?: string): Promise<ImageRecognitionResult> {
        const prompt = `你是一个专业的图片内容分析专家，擅长从图片中提取结构化信息。

请仔细分析这张图片，执行以下任务：

1. **识别图片类型**：
   - ppt: PPT/课件截图
   - notes: 学习笔记/书籍照片
   - whiteboard: 白板/手写草图
   - poster: 信息海报/结构图
   - mindmap: 已有思维导图
   - other: 其他类型

2. **提取文字内容**：使用 OCR 识别所有文字

3. **理解结构关系**：
   - 识别标题和层级关系
   - 识别列表、要点、编号
   - 推断隐含的逻辑关系

4. **生成思维导图结构**：
   - 确定核心主题
   - 划分主要分支
   - 建立层级关系

${instruction ? `用户额外要求：${instruction}` : ''}

请返回 JSON 格式：
{
  "imageType": "ppt",
  "rawText": "识别到的原始文字",
  "confidence": 0.85,
  "structure": {
    "title": "核心主题",
    "children": [
      {
        "label": "主分支1",
        "description": "说明",
        "logicType": "parallel",
        "children": [
          { "label": "子节点", "description": "..." }
        ]
      }
    ],
    "missingHints": []
  }
}`;

        try {
            const data = await this.requestGemini({
                contents: [
                    {
                        parts: [
                            { text: prompt },
                            {
                                inline_data: {
                                    mime_type: 'image/jpeg',
                                    data: base64Image.replace(/^data:image\/\w+;base64,/, ''),
                                },
                            },
                        ],
                    },
                ],
                generationConfig: {
                    temperature: 0.3,
                    maxOutputTokens: 4096,
                },
            });

            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const jsonText = this.extractJsonObject(textContent);
            if (jsonText) {
                const result = JSON.parse(jsonText);
                return {
                    success: true,
                    imageType: result.imageType,
                    rawText: result.rawText,
                    confidence: result.confidence,
                    structure: result.structure,
                };
            }

            throw new Error('无法解析响应');
        } catch (error) {
            console.error('图片识别失败:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '图片识别失败',
            };
        }
    }

    // ===================================
    // 海报/封面 → 视频化创意解读
    // ===================================
    async analyzePosterForVideo(
        base64Image: string,
        platform: 'douyin' | 'kuaishou' | 'xiaohongshu' | 'shipinhao' = 'douyin'
    ): Promise<ImageRecognitionResult> {
        const platformInfo = this.getPlatformInfo(platform);

        const prompt = `你是一位资深的短视频创意策划专家，擅长将静态海报/封面图转化为短视频创意方案。

请仔细分析这张图片，并生成一个完整的「海报→视频」创意方案：

## 分析任务

1. **图片类型识别**：
   - poster: 产品海报/活动海报
   - cover: 内容封面/缩略图
   - ad: 广告素材
   - screenshot: 截图/对比图
   - lifestyle: 场景图/生活方式图
   - other: 其他

2. **视觉元素解析**：
   - 主体元素（产品/人物/场景）
   - 文字信息（标题/卖点/CTA）
   - 构图特点（对称/对比/留白）
   - 情绪调性（高级/活泼/温暖/冷感）

3. **视频化创意输出**：
   - 将静态画面"动起来"的 3 种创意方向
   - 每个方向包含：钩子设计、拍摄手法、镜头节奏

## 目标平台
${platformInfo.name}（${platformInfo.characteristics.split('\n')[0]}）

## 输出格式（JSON）
{
  "imageType": "poster",
  "rawText": "识别到的文字内容",
  "confidence": 0.9,
  "visualAnalysis": {
    "mainSubject": "主体元素描述",
    "textInfo": ["标题", "卖点1", "卖点2"],
    "composition": "构图特点",
    "mood": "情绪调性"
  },
  "structure": {
    "title": "视频创意方案：[基于海报主题]",
    "children": [
      {
        "label": "视觉解析",
        "logicType": "parallel",
        "children": [
          { "label": "主体元素", "description": "..." },
          { "label": "文字信息", "description": "..." },
          { "label": "情绪调性", "description": "..." }
        ]
      },
      {
        "label": "🎬 创意方向A：[一句话概括]",
        "description": "拍摄难度：低/中/高",
        "children": [
          { "label": "🎣 钩子", "description": "前3秒做什么" },
          { "label": "📹 拍摄手法", "description": "镜头运动/剪辑节奏" },
          { "label": "📝 脚本参考", "description": "口播文案" }
        ]
      },
      {
        "label": "🎬 创意方向B：[一句话概括]",
        "description": "...",
        "children": [...]
      },
      {
        "label": "🎬 创意方向C：[一句话概括]",
        "description": "...",
        "children": [...]
      }
    ],
    "missingHints": ["可补充的元素建议"]
  }
}

只返回 JSON，不要任何解释。`;

        try {
            const data = await this.requestGemini({
                contents: [
                    {
                        parts: [
                            { text: prompt },
                            {
                                inline_data: {
                                    mime_type: 'image/jpeg',
                                    data: base64Image.replace(/^data:image\/\w+;base64,/, ''),
                                },
                            },
                        ],
                    },
                ],
                generationConfig: {
                    temperature: 0.5,
                    maxOutputTokens: 4096,
                },
            });

            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const jsonText = this.extractJsonObject(textContent);
            if (jsonText) {
                const result = JSON.parse(jsonText);
                return {
                    success: true,
                    imageType: result.imageType,
                    rawText: result.rawText,
                    confidence: result.confidence,
                    structure: result.structure,
                };
            }

            throw new Error('无法解析响应');
        } catch (error) {
            console.error('海报分析失败:', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '海报分析失败',
            };
        }
    }

    // ===================================
    // YouTube 视频 → 思维导图
    // ===================================
    async analyzeYouTubeVideo(
        videoUrl: string,
        mode: ContentMode = 'general'
    ): Promise<AIGeneratedStructure> {
        const modeInstructions = this.getModeInstructions(mode);

        const prompt = `你是一位专业的视频内容分析师。请分析以下 YouTube 视频并生成结构化的思维导图。

## 视频链接
${videoUrl}

## 分析要求
1. 提取视频的核心主题和标题
2. 按时间线或主题维度分解视频内容
3. 提取关键信息点、金句、数据等
4. 识别视频的目标受众和核心价值

${modeInstructions}

## 输出格式（JSON）
{
  "title": "视频标题/主题",
  "children": [
    {
      "label": "核心主题1",
      "description": "详细说明",
      "children": [
        { "label": "要点1", "description": "..." },
        { "label": "要点2", "description": "..." }
      ]
    },
    {
      "label": "核心主题2",
      "description": "详细说明",
      "children": [...]
    }
  ],
  "missingHints": ["可补充的方向"]
}

注意：
- 如果无法访问视频，请基于标题和上下文推测内容结构
- 生成至少 3 层深度的结构
- 每个节点都要有 description

只返回 JSON，不要任何解释。`;

        return this.callGeminiForStructure(prompt);
    }

    // ===================================
    // 网页内容 → 思维导图
    // ===================================
    async analyzeWebpage(
        webpageUrl: string,
        webpageContent: string,
        mode: ContentMode = 'general'
    ): Promise<AIGeneratedStructure> {
        const modeInstructions = this.getModeInstructions(mode);

        // 如果内容过长，截取前 15000 字
        const truncatedContent = webpageContent.length > 15000
            ? webpageContent.slice(0, 15000) + '\n...(内容已截断)'
            : webpageContent;

        const prompt = `你是一位专业的内容结构化专家。请分析以下网页内容并生成结构化的思维导图。

## 网页来源
${webpageUrl}

## 网页内容
\`\`\`
${truncatedContent}
\`\`\`

## 分析要求
1. 提取文章的核心主题和标题
2. 按逻辑结构分解内容（总分、因果、对比等）
3. 提取关键论点、数据、引用等
4. 保持层级清晰，避免过于扁平

${modeInstructions}

## 输出格式（JSON）
{
  "title": "文章主题",
  "children": [
    {
      "label": "主要观点1",
      "description": "详细说明",
      "children": [
        { "label": "支撑点1", "description": "..." },
        { "label": "支撑点2", "description": "..." }
      ]
    }
  ],
  "missingHints": ["可补充的方向"]
}

注意：
- 忽略导航、广告等无关内容
- 保留文章的核心论述结构
- 生成至少 3 层深度

只返回 JSON，不要任何解释。`;

        return this.callGeminiForStructure(prompt);
    }

    // ===================================
    // 音频内容 → 思维导图
    // ===================================
    async analyzeAudio(
        audioBase64: string,
        mimeType: string = 'audio/mp3',
        mode: ContentMode = 'general'
    ): Promise<AIGeneratedStructure> {
        const modeInstructions = this.getModeInstructions(mode);

        const prompt = `你是一位专业的音频内容分析师。请分析以上传的音频内容并生成结构化的思维导图。

## 分析要求
1. 首先转录音频中的语音内容
2. 提取核心主题和讨论要点
3. 按话题或时间线组织内容结构
4. 识别说话人的核心观点和金句

${modeInstructions}

## 输出格式（JSON）
{
  "title": "音频主题",
  "children": [
    {
      "label": "话题1",
      "description": "主要讨论内容",
      "children": [
        { "label": "要点1", "description": "..." },
        { "label": "要点2", "description": "..." }
      ]
    }
  ],
  "missingHints": ["可补充的方向"]
}

注意：
- 如果音频较长，按话题分段
- 保留重要的引用和数据
- 生成至少 3 层深度

只返回 JSON，不要任何解释。`;

        try {
            // 移除 base64 前缀如果存在
            const base64Data = audioBase64.includes(',')
                ? audioBase64.split(',')[1]
                : audioBase64;

            const data = await this.requestGemini({
                contents: [
                    {
                        parts: [
                            { text: prompt },
                            {
                                inlineData: {
                                    mimeType: mimeType,
                                    data: base64Data,
                                },
                            },
                        ],
                    },
                ],
                generationConfig: {
                    temperature: 0.6,
                    maxOutputTokens: 4096,
                },
            });

            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const jsonText = this.extractJsonObject(textContent);

            if (jsonText) {
                const parsed = JSON.parse(jsonText) as AIGeneratedStructure;
                return this.normalizeStructureOutput(parsed);
            }

            throw new Error('无法解析音频分析结果');
        } catch (error) {
            console.error('音频分析失败:', error);
            throw error;
        }
    }

    // ===================================
    // 节点扩展（专业级 Prompt 工程）
    // ===================================
    async expandNode(
        node: MindMapNode,
        context: string,
        customPrompt?: string,
        depth: number = 1
    ): Promise<AIExpandResult> {
        // 从上下文路径提取根主题
        const contextParts = context.split(' > ');
        const rootTopic = contextParts[0] || node.label;

        // 动态 Temperature：深度越深越严谨
        // 第1层 0.7（发散）→ 第4层+ 0.2（精准）
        const dynamicTemperature = Math.max(0.2, 0.7 - (depth - 1) * 0.15);

        const prompt = customPrompt
            ? `# Role
你是一个极简主义的思维导图专家。

# Context Anchoring（锚点上下文）
根主题：${rootTopic}
完整路径：${context}
当前节点：${node.label}
用户要求：${customPrompt}

# Rules
1. 每个节点标签建议控制在 2-12 个字
2. 尽量不用标点，不要写完整句子
3. 输出优先使用名词或动宾短语
4. 子节点尽量满足 MECE（避免明显重叠）
5. 内容必须紧扣根主题「${rootTopic}」，不能跑题
6. 节点要具体、可执行，避免空泛词（如“其他”“等等”）

# Examples（关键示例）
User: 根主题="健康生活" 当前节点="运动"
Bad Output: ["你应该多去跑步", "游泳也是不错的选择", "做瑜伽可以塑形"]
Good Output: ["有氧运动", "力量训练", "柔韧拉伸", "运动频率"]

User: 根主题="编程学习" 当前节点="Python"
Bad Output: ["Python是一门很好的语言", "变量和数据类型", "编程"]
Good Output: ["基础语法", "数据结构", "Web框架", "数据分析"]

# Task
生成 5-8 个高质量子节点。只返回 JSON 数组：
[{"label": "关键词", "description": "一句话说明"}, ...]`

            : `# Role
你是一个极简主义的思维导图专家。

# Context Anchoring（锚点上下文）
根主题：${rootTopic}
完整路径：${context}
当前节点：${node.label}

# Rules
1. 每个节点标签建议控制在 2-12 个字
2. 尽量不用标点，不要写完整句子
3. 输出优先使用名词或动宾短语
4. 子节点尽量满足 MECE（避免明显重叠）
5. 内容必须紧扣根主题「${rootTopic}」，不能跑题
6. 节点要具体、可执行，避免空泛词（如“其他”“等等”）

# Examples（关键示例）
User: 根主题="健康生活" 当前节点="运动"
Bad Output: ["你应该多去跑步", "游泳也是不错的选择", "做瑜伽可以塑形"]
Good Output: ["有氧运动", "力量训练", "柔韧拉伸", "运动频率"]

User: 根主题="编程学习" 当前节点="Python"
Bad Output: ["Python是一门很好的语言", "变量和数据类型", "编程"]
Good Output: ["基础语法", "数据结构", "Web框架", "数据分析"]

# Task
生成 6-10 个高质量子节点。只返回 JSON 数组：
[{"label": "关键词", "description": "一句话说明"}, ...]`;

        try {
            const data = await this.requestGemini({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: dynamicTemperature,
                    maxOutputTokens: 1536,
                },
            });
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            const jsonText = this.extractJsonArray(textContent);
            if (jsonText) {
                const suggestions = JSON.parse(jsonText) as Array<{
                    label: string;
                    description?: string;
                }>;

                // 后处理：清理噪音 + 去重，避免过度截断导致语义损失
                const seen = new Set<string>();
                const cleanedSuggestions = suggestions
                    .map((s) => ({
                        label: (s.label || '')
                            .replace(/[，。！？、；：""''（）【】《》\.\,\!\?\;\:\(\)\[\]]/g, '')
                            .replace(/\s+/g, ' ')
                            .trim()
                            .slice(0, 18),
                        description: s.description?.trim(),
                    }))
                    .filter((s) => s.label.length >= 2)
                    .filter((s) => {
                        const key = s.label.toLowerCase();
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    })
                    .slice(0, 10)
                    .map((s, i) => ({
                        id: `suggestion-${i}`,
                        ...s,
                    }));

                return { suggestions: cleanedSuggestions };
            }

            throw new Error('无法解析响应');
        } catch (error) {
            console.error('节点扩展失败:', error);
            throw error;
        }
    }

    // ===================================
    // 使用预设模式扩展节点
    // ===================================
    async expandWithPreset(
        node: MindMapNode,
        context: string,
        presetPrompt: string,
        depth: number = 1
    ): Promise<AIExpandResult> {
        // 动态 Temperature：深度越深越严谨
        const dynamicTemperature = Math.max(0.3, 0.8 - (depth - 1) * 0.15);

        try {
            const data = await this.requestGemini({
                contents: [{ parts: [{ text: presetPrompt }] }],
                generationConfig: {
                    temperature: dynamicTemperature,
                    maxOutputTokens: 2560,
                },
            });
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            const jsonText = this.extractJsonArray(textContent);
            if (jsonText) {
                const suggestions = JSON.parse(jsonText) as Array<{
                    label: string;
                    description?: string;
                }>;

                // 后处理：清理噪音 + 去重，保留更多有效信息
                const seen = new Set<string>();
                const cleanedSuggestions = suggestions
                    .map((s) => ({
                        label: (s.label || '')
                            .replace(/[，。！？、；：""''（）【】《》\.\,\!\?\;\:\(\)\[\]]/g, '')
                            .replace(/\s+/g, ' ')
                            .trim()
                            .slice(0, 22),
                        description: s.description?.trim(),
                    }))
                    .filter((s) => s.label.length >= 2)
                    .filter((s) => {
                        const key = s.label.toLowerCase();
                        if (seen.has(key)) return false;
                        seen.add(key);
                        return true;
                    })
                    .slice(0, 12)
                    .map((s, i) => ({
                        id: `preset-${i}`,
                        ...s,
                    }));

                return { suggestions: cleanedSuggestions };
            }

            throw new Error('无法解析响应');
        } catch (error) {
            console.error('预设扩展失败:', error);
            throw error;
        }
    }

    // ===================================
    // 联网搜索增强扩展
    // ===================================
    async expandWithWebSearch(
        node: MindMapNode,
        context: string,
        customPrompt?: string,
        depth: number = 1
    ): Promise<AIExpandResult & { searchResults?: Array<{ query: string }> }> {
        const contextParts = context.split(' > ');
        const rootTopic = contextParts[0] || node.label;
        const dynamicTemperature = Math.max(0.3, 0.7 - (depth - 1) * 0.15);

        const searchPrompt = customPrompt
            ? `# Role
你是一个联网搜索增强的思维导图专家。你可以联网搜索获取最新信息。

# Context Anchoring
根主题：${rootTopic}
完整路径：${context}
当前节点：${node.label}
用户要求：${customPrompt}

# Task
1. 先联网搜索「${node.label}」相关的最新信息、数据、趋势
2. 基于搜索结果，生成 4-6 个高质量子节点
3. 每个节点必须包含来源信息

# Rules
1. 节点标签 2-8 字
2. 必须引用真实来源（网站名或简称）
3. 优先使用最新数据（2023-2025年）
4. 标注信息的时效性

# Output Format
只返回 JSON：
{
  "suggestions": [
    {"label": "节点名", "description": "说明", "sources": ["来源网站"]}
  ],
  "searchSummary": "搜索结果概述"
}`
            : `# Role
你是一个联网搜索增强的思维导图专家。你可以联网搜索获取最新信息。

# Context Anchoring
根主题：${rootTopic}
完整路径：${context}
当前节点：${node.label}

# Task
1. 联网搜索「${node.label}」相关的最新信息
2. 生成 4-6 个基于搜索结果的高质量子节点
3. 每个节点包含可验证的来源

# Output Format
只返回 JSON：
{
  "suggestions": [
    {"label": "节点名", "description": "具体信息+数据", "sources": ["来源"]}
  ],
  "searchSummary": "搜索结果概述"
}`;

        try {
            const data = await this.requestGeminiWithSearch(searchPrompt, dynamicTemperature);
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            const jsonText = this.extractJsonObject(textContent);
            if (jsonText) {
                const result = JSON.parse(jsonText) as {
                    suggestions: Array<{ label: string; description?: string; sources?: string[] }>;
                    searchSummary?: string;
                };

                const cleanedSuggestions = result.suggestions.map((s, i) => ({
                    id: `web-${i}`,
                    label: s.label
                        .replace(/[，。！？、；：""''（）【】《》\.\\,\\!\\?\\;\\:\\(\\)\\[\\]]/g, '')
                        .slice(0, 12),
                    description: s.description,
                    sources: s.sources,
                }));

                return {
                    suggestions: cleanedSuggestions,
                    searchResults: data.groundingMetadata?.webSearchQueries?.map((q: string) => ({
                        query: q,
                    })),
                };
            }

            throw new Error('无法解析联网搜索响应');
        } catch (error) {
            console.error('联网搜索扩展失败:', error);
            // 降级到普通扩展
            return this.expandNode(node, context, customPrompt, depth);
        }
    }

    // ===================================
    // 联网搜索生成思维导图
    // ===================================
    async generateFromTextWithWebSearch(
        text: string,
        mode: ContentMode = 'general',
        maxDepth = 3,
        detailLevel: 'brief' | 'standard' | 'detailed' | 'extreme' = 'standard'
    ): Promise<AIGeneratedStructure & { searchQueries?: string[] }> {
        const modeInstructions = this.getModeInstructions(mode);
        const depthInstruction = this.getDepthInstruction(maxDepth);
        const detailInstruction = this.getDetailInstruction(detailLevel);

        const prompt = `你是一个联网搜索增强的思维导图专家。请先联网搜索获取「${text}」相关的最新信息，然后生成思维导图。

用户输入的内容：
"""
${text}
"""

${modeInstructions}

## 联网搜索要求
1. 搜索主题相关的最新信息、数据、趋势
2. 搜索权威来源和官方数据
3. 搜索最新的行业报告和研究

## 输出要求
1. **核心主题**：精准提炼根节点标题（8-16字以内）
2. **多层级结构**：${depthInstruction}
3. **引用来源**：重要节点需标注信息来源
4. **详细度**：${detailInstruction}
5. **时效性**：优先使用2024-2025年的最新数据

只返回 JSON：
{
  "title": "根节点标题",
  "children": [
    {
      "label": "一级分支",
      "description": "详细说明",
      "sources": ["信息来源"],
      "children": [...]
    }
  ],
  "missingHints": ["建议补充的模块"],
  "searchSummary": "本次联网搜索概述"
}`;

        try {
            const data = await this.requestGeminiWithSearch(prompt, 0.5);
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const jsonText = this.extractJsonObject(textContent);

            if (jsonText) {
                const parsed = JSON.parse(jsonText) as AIGeneratedStructure & { searchSummary?: string };
                const normalized = this.normalizeStructureOutput(parsed);
                return {
                    ...normalized,
                    searchQueries: data.groundingMetadata?.webSearchQueries,
                };
            }

            throw new Error('无法解析响应');
        } catch (error) {
            console.error('联网搜索生成失败，降级到普通生成:', error);
            return this.generateFromText(text, mode, maxDepth, detailLevel);
        }
    }

    // ===================================
    // 联网搜索实时研究
    // ===================================
    async researchTopic(topic: string): Promise<{
        summary: string;
        keyFindings: Array<{ title: string; content: string; source?: string }>;
        trends: string[];
        sources: string[];
    }> {
        const prompt = `# Role
你是一个联网搜索研究助手。请对「${topic}」进行全面的网络调研。

# Task
1. 搜索该主题的最新信息和发展动态
2. 搜索相关数据和统计
3. 搜索专家观点和行业分析
4. 搜索趋势预测

# Output Format
只返回 JSON：
{
  "summary": "一段话概述主题的核心内容和当前状态",
  "keyFindings": [
    {"title": "发现1", "content": "具体内容和数据", "source": "来源网站"},
    {"title": "发现2", "content": "...", "source": "..."}
  ],
  "trends": ["趋势1", "趋势2", "趋势3"],
  "sources": ["引用的网站或来源列表"]
}`;

        try {
            const data = await this.requestGeminiWithSearch(prompt, 0.4);
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const jsonText = this.extractJsonObject(textContent);

            if (jsonText) {
                return JSON.parse(jsonText);
            }

            throw new Error('无法解析研究结果');
        } catch (error) {
            console.error('联网研究失败:', error);
            return {
                summary: `无法获取「${topic}」的网络搜索结果`,
                keyFindings: [],
                trends: [],
                sources: [],
            };
        }
    }

    // ===================================
    // 带搜索的 Gemini 请求
    // ===================================
    private async requestGeminiWithSearch(prompt: string, temperature: number = 0.5): Promise<GeminiResponse & { groundingMetadata?: any }> {
        const aiFactory = this.getAiInstance || getMainAiInstance();

        if (aiFactory) {
            try {
                const ai = aiFactory();
                // 使用 Gemini 2.0 的 Google Search 工具
                const response = await ai.models.generateContent({
                    model: 'gemini-2.0-flash',
                    contents: [{ parts: [{ text: prompt }] }],
                    config: {
                        temperature,
                        maxOutputTokens: 4096,
                        tools: [{
                            googleSearch: {}
                        }]
                    }
                });

                const text = response?.text
                    ?? response?.candidates?.[0]?.content?.parts?.[0]?.text
                    ?? '';

                return {
                    candidates: [{ content: { parts: [{ text }] } }],
                    groundingMetadata: response?.candidates?.[0]?.groundingMetadata,
                };
            } catch (error) {
                console.error('联网搜索请求失败:', error);
                throw error;
            }
        }

        // Fallback: 使用 REST API（需要 API 密钥）
        const storedKey = getStoredApiKey();
        const effectiveKey = this.apiKey || storedKey;

        if (!effectiveKey) {
            throw new Error('联网搜索需要 API 密钥');
        }

        const response = await fetch(
            `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=${effectiveKey}`,
            {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    contents: [{ parts: [{ text: prompt }] }],
                    generationConfig: {
                        temperature,
                        maxOutputTokens: 4096,
                    },
                    tools: [{
                        googleSearch: {}
                    }]
                }),
            }
        );

        if (!response.ok) {
            throw new Error(`联网搜索请求失败: ${response.status}`);
        }

        return response.json();
    }

    // ===================================
    // 推荐扩展方向
    // ===================================
    async getSuggestionsForDirection(
        node: MindMapNode,
        context: string
    ): Promise<AIExpandResult> {
        const prompt = `你是一个思维导图扩展助手。用户正在处理一个思维导图，当前节点是："${node.label}"
上下文路径：${context}

请建议 4-6 个不同的扩展方向或思考角度。每个建议应该是一个独特的视角或方法。

只返回 JSON 数组：
[{"label": "方向1", "description": "探索这个角度..."}, ...]

让建议多样化且有启发性。`;

        try {
            const data = await this.requestGemini({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: 0.9,
                    maxOutputTokens: 1024,
                },
            });
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            const jsonText = this.extractJsonArray(textContent);
            if (jsonText) {
                const suggestions = JSON.parse(jsonText) as Array<{
                    label: string;
                    description?: string;
                }>;

                return {
                    suggestions: suggestions.map((s, i) => ({
                        id: `direction-${i}`,
                        label: s.label,
                        description: s.description,
                    })),
                };
            }

            throw new Error('无法解析响应');
        } catch (error) {
            console.error('获取建议失败:', error);
            throw error;
        }
    }

    // ===================================
    // 节点压缩/总结
    // ===================================
    async summarizeNode(node: MindMapNode, childrenLabels: string[]): Promise<string> {
        const prompt = `将以下思维导图节点及其子节点总结为一句精炼的话：

节点：${node.label}
子节点：${childrenLabels.join('、')}

只返回总结后的一句话（10-30字）。`;

        try {
            const data = await this.requestGemini({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.5, maxOutputTokens: 100 },
            });
            return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || node.label;
        } catch {
            return node.label;
        }
    }

    // ===================================
    // Copilot: 培养想法
    // ===================================
    async cultivateIdeas(topic: string, constraints?: string): Promise<AIGeneratedNode[]> {
        const prompt = `请围绕主题“${topic}”进行发散性思维，生成 4-6 个相关概念或脑暴方向。
只返回 JSON 数组：
[{"label": "方向1", "description": "简短说明"}, ...]
要求：label 2-8 字，description 简洁清晰。
${constraints ? `约束：\n${constraints}` : ''}`;

        const data = await this.requestGemini({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.8, maxOutputTokens: 1024 },
        });

        const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonText = this.extractJsonArray(textContent);
        if (!jsonText) return [];
        return JSON.parse(jsonText) as AIGeneratedNode[];
    }

    // ===================================
    // Copilot: 工作分解 (WBS)
    // ===================================
    async jobBreakdown(topic: string, constraints?: string): Promise<AIGeneratedNode[]> {
        const prompt = `请使用 WBS 工作分解结构为“${topic}”生成阶段或步骤。
输出 4-8 个子节点，建议使用“阶段一/阶段二”或“步骤 1/步骤 2”命名。
只返回 JSON 数组：
[{"label": "阶段一", "description": "内容"}, ...]
${constraints ? `约束：\n${constraints}` : ''}`;

        const data = await this.requestGemini({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
        });

        const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonText = this.extractJsonArray(textContent);
        if (!jsonText) return [];
        return JSON.parse(jsonText) as AIGeneratedNode[];
    }

    // ===================================
    // Copilot: 解释
    // ===================================
    async explainTerm(topic: string): Promise<string> {
        const prompt = `请用 1-3 句话解释“${topic}”，语言简洁易懂。仅返回解释文本。`;

        const data = await this.requestGemini({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 256 },
        });

        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    }

    // ===================================
    // Copilot: 地图优化
    // ===================================
    async optimizeLabel(topic: string): Promise<string> {
        const prompt = `请将“${topic}”优化为更专业、更精炼的表达，保留原意。仅返回优化后的短语（2-12字）。`;

        const data = await this.requestGemini({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 128 },
        });

        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || topic;
    }

    // ===================================
    // Copilot: 改组（MECE）
    // ===================================
    async regroup(topic: string, constraints?: string): Promise<AIGeneratedNode[]> {
        const prompt = `请对“${topic}”进行 MECE 原则的重新分类，生成一套更科学的子节点结构。
要求 4-6 个一级分类，每个分类 2-4 个子点。
只返回 JSON，格式：
{
  "label": "${topic}",
  "children": [
    { "label": "分类1", "description": "说明", "children": [ { "label": "子点", "description": "说明" } ] }
  ]
}
${constraints ? `约束：\n${constraints}` : ''}`;

        const data = await this.requestGemini({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
        });

        const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonText = this.extractJsonObject(textContent);
        if (!jsonText) return [];
        const parsed = JSON.parse(jsonText) as AIGeneratedNode;
        return parsed.children || [];
    }

    // ===================================
    // Copilot: 成片描述（镜头脚本）
    // ===================================
    async generateVideoScript(title: string, outline: string, constraints?: string): Promise<string> {
        const prompt = `你是一名短视频编导。请根据以下思维导图内容生成可直接用于 AI 视频生成的成片描述。

主题：${title}
导图要点：
${outline}
${constraints ? `\n平台约束：\n${constraints}` : ''}

要求：
1. 输出“镜头脚本”，包含 6-10 个镜头，按顺序编号。
2. 每个镜头包含：画面/动作/字幕/旁白/时长（秒）。
3. 文风清晰、画面感强、可执行。
4. 总字数控制在 200-350 字。
只返回脚本文本，不要额外解释。`;

        const data = await this.requestGemini({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
        });

        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    }

    // ===================================
    // Copilot: 数据脱敏
    // ===================================
    async desensitizeText(text: string): Promise<string> {
        const prompt = `请检测文本“${text}”。如果包含敏感信息（如人名、手机号、身份证、金额等），请用星号 (*) 替换进行脱敏。如果没有敏感信息，请按原样返回。只返回处理后的文本。`;

        const data = await this.requestGemini({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.2, maxOutputTokens: 256 },
        });

        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || text;
    }

    // ===================================
    // Copilot: 视频脚本（弹窗结果）
    // ===================================
    async generateVideoScriptResult(topic: string, constraints?: string): Promise<string> {
        const prompt = `
你是一位专业导演与 AI 视频提示词专家。
请根据主题“${topic}”输出一份可直接用于 AI 视频生成的内容，严格遵循以下格式（不要代码块）：
${constraints ? `平台约束：\n${constraints}` : ''}

[ 🎬 视频提示词 / Video Prompt ]
(英文提示词，包含主体、环境、光影、镜头、风格)

[ 📝 脚本故事 / Story Script ]
(30-60 秒中文旁白脚本)

[ 💡 拍摄建议 / Director's Note ]
(简短构图或情绪建议)
`;

        const data = await this.requestGemini({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.6, maxOutputTokens: 1024 },
        });

        return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
    }

    // ===================================
    // Copilot: 语义聚类
    // ===================================
    async clusterNodes(labels: string[]): Promise<Array<{ label: string; items: string[] }>> {
        const prompt = `请对以下节点名称进行语义聚类，生成 3-6 个分类。
节点列表：${labels.join('、')}

要求：
1. 每个分类有简短名称。
2. items 必须来自给定列表，不能新增。
3. 返回 JSON 数组：
[{"label": "分类名", "items": ["节点1","节点2"]}, ...]`;

        const data = await this.requestGemini({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.4, maxOutputTokens: 1024 },
        });

        const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const jsonText = this.extractJsonArray(textContent);
        if (!jsonText) return [];
        return JSON.parse(jsonText) as Array<{ label: string; items: string[] }>;
    }

    // ===================================
    // 节点级 AI 深度扩展（Markdown 解析）
    // ===================================
    async generateDeepSubtopics(
        topic: string,
        context?: string,
        customInstruction?: string
    ): Promise<AIGeneratedNode[]> {
        const instruction = customInstruction || '请展开极其详细的内容，不要省略。';
        const prompt = `
# Role
你是一位追求极致细节的知识图谱专家。

# Task
请针对主题 **"${topic}"**${context ? ` (背景: ${context})` : ''} 生成一份**极度详实、层级丰富**的思维导图。

# Critical Rules (为了避免内容过于精简，请严格遵守)
1. **结构下沉原则**：
   - **严禁**把解释、定义、方法论写在同一行。
   - **必须**将所有解释性内容拆解为**下一级子节点**。
2. **内容颗粒度**：
   - 末端节点必须是**有信息量的短句**，避免单词式节点。
3. **规模要求**：
   - 必须生成 **至少 4 层** 深度。
   - 每个父节点下至少包含 **3-5 个** 子节点。
4. **格式要求**：
   - 仅使用 Markdown 标题 (#, ##, ###, ####, #####) 表示层级。
   - 不要使用列表符号。

# User Instruction
${instruction} (请务必“废话”多一点，把细节铺开，不要太节省字数)
`;

        const data = await this.requestGemini({
            contents: [{ parts: [{ text: prompt }] }],
            generationConfig: { temperature: 0.7, maxOutputTokens: 8192 },
        });

        const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
        const tree = this.parseMarkdownToTree(textContent);
        return tree?.children || [];
    }

    // ===================================
    // 智能补全提示
    // ===================================
    async getMissingHints(
        rootLabel: string,
        existingBranches: string[]
    ): Promise<string[]> {
        const prompt = `分析这个思维导图结构，找出可能缺失的内容模块：

主题：${rootLabel}
现有分支：${existingBranches.join('、')}

请指出 1-3 个可能缺失但重要的模块。只返回 JSON 数组：
["缺失模块1", "缺失模块2"]`;

        try {
            const data = await this.requestGemini({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.6, maxOutputTokens: 256 },
            });
            const text = data.candidates?.[0]?.content?.parts?.[0]?.text || '[]';
            const match = this.extractJsonArray(text);
            return match ? JSON.parse(match) : [];
        } catch {
            return [];
        }
    }

    // ===================================
    // 对话式共创
    // ===================================
    async chat(
        userMessage: string,
        context: string,
        history: string
    ): Promise<string> {
        const prompt = `你是一位专业的短视频创意策划搭子，擅长与用户进行多轮对话，逐步完善创意方案。

## 当前上下文
${context || '暂无上下文'}

## 对话历史
${history || '这是第一轮对话'}

## 用户最新消息
${userMessage}

## 角色定位
1. 你是"创意搭子"，像朋友一样交流，语气自然亲切
2. 针对用户的问题给出具体、可落地的建议
3. 主动追问细节，帮助用户完善想法
4. 结合平台特性和目标受众给出针对性建议
5. 适时给出 2-3 个选择方向，让用户有选择权

## 回复要求
- 语言简洁有力，避免废话
- 如果用户问创意方向，给出 2-3 个具体可执行的选项
- 如果用户问拍摄方案，给出钩子+结构+镜头建议
- 如果用户问脚本，给出口语化、符合平台风格的文案
- 必要时用 markdown 格式增强可读性

请直接回复，不要说"好的"之类的开场白：`;

        try {
            const data = await this.requestGemini({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: 2048 },
            });
            return data.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '抱歉，我无法理解你的问题。';
        } catch (error) {
            console.error('Chat error:', error);
            throw error;
        }
    }

    // ===================================
    // 智能完善对话（核心功能）
    // ===================================
    async smartRefineChat(
        userMessage: string,
        mapStructure: string,              // 完整思维导图结构（Markdown格式）
        creationHistory: string,           // 创建历史记录
        conversationHistory: string,       // 当前完善会话的对话历史
        selectedNodeContext?: string       // 当前选中节点的上下文（如果有）
    ): Promise<{
        reply: string;                     // AI 回复文本
        suggestedActions?: Array<{
            type: 'add_node' | 'delete_node' | 'update_node' | 'move_node' | 'expand' | 'regroup';
            description: string;
            targetNodeLabel?: string;
            parentNodeLabel?: string;
            newLabel?: string;
            newNotes?: string;
            children?: Array<{ label: string; notes?: string; children?: Array<{ label: string; notes?: string }> }>;
        }>;
        needsMoreInfo?: boolean;           // 是否需要更多信息
        clarifyingQuestions?: string[];    // 追问问题
    }> {
        const prompt = `思维导图智能完善。直接给出修改方案，不要追问确认。

## 导图结构
\`\`\`
${mapStructure}
\`\`\`

${selectedNodeContext ? `选中节点: ${selectedNodeContext}` : ''}

## 用户需求
${userMessage}

## 输出 JSON
{
  "reply": "简短说明要做什么（1-2句话）",
  "suggestedActions": [
    {
      "type": "add_node|update_node|delete_node|expand",
      "description": "简短描述",
      "targetNodeLabel": "节点名",
      "parentNodeLabel": "父节点名",
      "newLabel": "新标签",
      "children": [{"label": "子节点"}]
    }
  ]
}

规则：最多3个操作，直接执行，不问问题。只返回JSON。`;

        try {
            const data = await this.requestGemini({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.6, maxOutputTokens: 4096 },
            });

            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const jsonText = this.extractJsonObject(textContent);

            if (jsonText) {
                const result = JSON.parse(jsonText);
                return {
                    reply: result.reply || '抱歉，我无法理解你的请求。',
                    suggestedActions: result.suggestedActions,
                    needsMoreInfo: result.needsMoreInfo,
                    clarifyingQuestions: result.clarifyingQuestions,
                };
            }

            // 如果无法解析 JSON，返回纯文本回复
            return {
                reply: textContent.trim() || '抱歉，我无法理解你的请求。',
                needsMoreInfo: true,
            };
        } catch (error) {
            console.error('Smart refine chat error:', error);
            throw error;
        }
    }

    // 短视频创意共创系统
    // ===================================
    async generateVideoCreative(
        topic: string,
        platform: 'douyin' | 'kuaishou' | 'xiaohongshu' | 'shipinhao',
        accountType?: string
    ): Promise<AIGeneratedStructure> {
        const platformInfo = this.getPlatformInfo(platform);

        const prompt = `你是一位资深的短视频创意策划专家，深谙各大平台的内容偏好和算法规则。

## 用户需求
- **视频主题**：${topic}
- **目标平台**：${platformInfo.name}
- **账号类型**：${accountType || '通用账号'}

## 平台特性分析
${platformInfo.characteristics}

## 任务要求
请作为"懂平台的创意策划搭子"，生成 3-4 个【可直接落地执行】的创意方向。

每个创意方向必须包含：
1. **创意核心**：一句话概括创意亮点
2. **为什么现在适合**：结合平台当前趋势
3. **拍摄难度**：低/中/高
4. **钩子设计**：前3秒如何抓住观众
5. **情绪曲线**：开场→中段→结尾的情绪变化
6. **镜头策划**：2-4个关键镜头（镜头类型+拍什么+注意点）
7. **脚本建议**：口语化的台词参考（符合${platformInfo.name}风格）
8. **封面/标题方向**：吸引点击的建议

## 输出格式（JSON）
{
  "title": "${topic} - ${platformInfo.name}创意方案",
  "children": [
    {
      "label": "创意方向A：[核心一句话]",
      "description": "为什么现在适合 + 拍摄难度",
      "logicType": "parallel",
      "children": [
        {
          "label": "🎣 钩子设计",
          "description": "前3秒具体做什么",
          "children": [
            { "label": "开场台词", "description": "..." },
            { "label": "画面设计", "description": "..." }
          ]
        },
        {
          "label": "📈 情绪曲线",
          "children": [
            { "label": "开场", "description": "情绪类型+强度" },
            { "label": "中段", "description": "..." },
            { "label": "结尾", "description": "..." }
          ]
        },
        {
          "label": "🎬 镜头策划",
          "children": [
            { "label": "镜头1", "description": "类型+拍什么+注意点" },
            { "label": "镜头2", "description": "..." }
          ]
        },
        {
          "label": "📝 脚本台词",
          "description": "口语化、符合平台风格的完整脚本"
        },
        {
          "label": "🖼️ 封面标题",
          "description": "封面建议 + 标题参考"
        }
      ]
    }
  ],
  "missingHints": ["可补充的方向建议"]
}

注意：
- 给出"创意选择权"而非唯一答案
- 确保每个方向都是普通团队可执行的
- 脚本语言要符合${platformInfo.name}的说话风格
- 不要天马行空，要考虑实际拍摄可行性

只返回 JSON，不要任何解释。`;

        return this.callGeminiForStructure(prompt);
    }

    private getPlatformInfo(platform: 'douyin' | 'kuaishou' | 'xiaohongshu' | 'shipinhao'): {
        name: string;
        characteristics: string;
    } {
        const platformData = {
            douyin: {
                name: '抖音',
                characteristics: `
- 内容偏好：高能量、强节奏、信息密度高
- 爆款结构：直接给结果 → 反差 → 过程解释
- 情绪偏好：爽感 > 共鸣 > 好奇
- 开头容忍度：前3秒必须有钩子
- 语言风格：直接、口语化、带梗`
            },
            kuaishou: {
                name: '快手',
                characteristics: `
- 内容偏好：真实、接地气、有人情味
- 爆款结构：故事引入 → 真实展示 → 情感共鸣
- 情绪偏好：共鸣 > 感动 > 实用
- 开头容忍度：可稍慢，但要有温度
- 语言风格：朴实、亲切、像聊天`
            },
            xiaohongshu: {
                name: '小红书',
                characteristics: `
- 内容偏好：美感、干货、可复制的生活方式
- 爆款结构：封面吸睛 → 痛点共鸣 → 解决方案 → 行动号召
- 情绪偏好：种草感 > 向往感 > 实用感
- 开头容忍度：前5秒展示核心价值
- 语言风格：精致、有调性、闺蜜分享感`
            },
            shipinhao: {
                name: '视频号',
                characteristics: `
- 内容偏好：正能量、有价值、适合转发
- 爆款结构：观点先行 → 案例支撑 → 金句收尾
- 情绪偏好：认同感 > 获得感 > 触动
- 开头容忍度：可稍长，但要有深度
- 语言风格：成熟、有见地、像朋友推荐`
            }
        };
        return platformData[platform];
    }

    // ===================================
    // 私有方法
    // ===================================
    private getModeInstructions(mode: ContentMode): string {
        switch (mode) {
            case 'content-planning':
                return `这是一个【内容策划】场景，请按照"选题 → 观点 → 论据 → 输出形式"的结构组织。`;
            case 'video-script':
                return `这是一个【视频脚本】场景，请按照"开场 → 内容展开 → 转化引导 → 结尾"的结构组织。`;
            case 'article':
                return `这是一个【文章结构】场景，请按照"标题 → 开头 → 正文论点 → 结尾"的结构组织。`;
            case 'video-creative':
                return `这是一个【短视频创意共创】场景，需要生成多个可落地的创意方向，每个方向包含完整的拍摄方案。`;
            default:
                return '';
        }
    }

    private async callGeminiForStructure(
        prompt: string,
        config?: { temperature?: number; maxOutputTokens?: number }
    ): Promise<AIGeneratedStructure> {
        try {
            const data = await this.requestGemini({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: {
                    temperature: config?.temperature ?? 0.6,
                    maxOutputTokens: config?.maxOutputTokens ?? 4096
                },
            });
            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';

            const jsonText = this.extractJsonObject(textContent);
            if (jsonText) {
                return JSON.parse(jsonText) as AIGeneratedStructure;
            }

            throw new Error('AI 返回格式异常，请重试');
        } catch (error) {
            console.error('生成结构失败:', error);
            throw error;
        }
    }

    private async enhanceStructureDetails(
        structure: AIGeneratedStructure,
        mode: ContentMode,
        originalText: string,
        maxDepth: number,
        detailLevel: 'brief' | 'standard' | 'detailed' | 'extreme'
    ): Promise<AIGeneratedStructure> {
        if (!structure?.children?.length) {
            return structure;
        }

        if (detailLevel === 'brief') {
            return structure;
        }

        if (maxDepth <= 3) {
            return structure;
        }

        const maxBranchesToExpand = detailLevel === 'extreme' ? 8 : detailLevel === 'detailed' ? 7 : 6;
        const expandedChildren: AIGeneratedNode[] = [];
        const branches = structure.children.slice(0, maxBranchesToExpand);

        for (const branch of branches) {
            const expanded = await this.expandBranch(structure.title, branch, mode, originalText, detailLevel);
            let resolvedBranch = expanded || branch;

            if (maxDepth >= 5 && resolvedBranch.children?.length) {
                resolvedBranch = await this.expandSecondLevel(
                    structure.title,
                    resolvedBranch,
                    mode,
                    originalText,
                    detailLevel
                );
            }

            expandedChildren.push(resolvedBranch);
        }

        if (structure.children.length > maxBranchesToExpand) {
            expandedChildren.push(...structure.children.slice(maxBranchesToExpand));
        }

        return {
            ...structure,
            children: expandedChildren,
        };
    }

    private async expandBranch(
        rootTitle: string,
        branch: AIGeneratedNode,
        mode: ContentMode,
        originalText: string,
        detailLevel: 'brief' | 'standard' | 'detailed' | 'extreme'
    ): Promise<AIGeneratedNode | null> {
        const modeInstructions = this.getModeInstructions(mode);
        const detailInstruction = this.getDetailInstruction(detailLevel);
        const secondLevelCount = detailLevel === 'extreme' ? '5-7' : detailLevel === 'detailed' ? '4-6' : '3-5';
        const thirdLevelCount = detailLevel === 'extreme' ? '3-4' : '2-3';
        const prompt = `你是思维导图专家。请围绕“${rootTitle}”中的一级分支“${branch.label}”进行深度扩展，输出更细致的层级结构。

原始输入：
"""
${originalText}
"""

${modeInstructions}

要求：
1. 生成 ${secondLevelCount} 个二级子点，每个子点必须包含 description。
2. 至少 2 个二级子点继续扩展为三级细节（每个 ${thirdLevelCount} 个）。
3. 二级 label 2-8字，三级可 4-16字；细节写 description。
4. 详细度要求：${detailInstruction}
5. 仅返回该分支的 JSON 对象，不要解释。

返回格式：
{
  "label": "${branch.label}",
  "description": "说明",
  "children": [
    {
      "label": "二级子点",
      "description": "说明",
      "suggestedTags": ["key-point"],
      "children": [
        { "label": "三级细节", "description": "说明" }
      ]
    }
  ]
}`;

        try {
            const data = await this.requestGemini({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: detailLevel === 'extreme' ? 3072 : 2048 },
            });

            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const jsonText = this.extractJsonObject(textContent);
            if (!jsonText) return null;

            const parsed = JSON.parse(jsonText) as AIGeneratedNode;
            if (!parsed?.label || !parsed.children) return null;
            return parsed;
        } catch {
            return null;
        }
    }

    private async expandSecondLevel(
        rootTitle: string,
        branch: AIGeneratedNode,
        mode: ContentMode,
        originalText: string,
        detailLevel: 'brief' | 'standard' | 'detailed' | 'extreme'
    ): Promise<AIGeneratedNode> {
        const children = branch.children || [];
        const targetCount = detailLevel === 'extreme' ? 4 : detailLevel === 'detailed' ? 3 : 2;
        const targets = children.slice(0, targetCount);
        const updatedChildren: AIGeneratedNode[] = [];

        for (const child of children) {
            if (targets.includes(child)) {
                const expanded = await this.expandSubBranch(rootTitle, branch.label, child, mode, originalText, detailLevel);
                updatedChildren.push(expanded || child);
            } else {
                updatedChildren.push(child);
            }
        }

        return { ...branch, children: updatedChildren };
    }

    private async expandSubBranch(
        rootTitle: string,
        branchLabel: string,
        node: AIGeneratedNode,
        mode: ContentMode,
        originalText: string,
        detailLevel: 'brief' | 'standard' | 'detailed' | 'extreme'
    ): Promise<AIGeneratedNode | null> {
        const modeInstructions = this.getModeInstructions(mode);
        const detailInstruction = this.getDetailInstruction(detailLevel);
        const count = detailLevel === 'extreme' ? '4-6' : detailLevel === 'detailed' ? '3-5' : '2-4';
        const prompt = `你是思维导图专家。请围绕“${rootTitle} → ${branchLabel} → ${node.label}”进行细化扩展，补充第四层细节。

原始输入：
"""
${originalText}
"""

${modeInstructions}

要求：
1. 为该节点生成 ${count} 个子节点，每个子节点必须包含 description。
2. label 可更详细（4-16字），避免完整句，细节写 description。
3. 详细度要求：${detailInstruction}
4. 仅返回该节点 JSON，不要解释。

返回格式：
{
  "label": "${node.label}",
  "description": "说明",
  "children": [
    { "label": "细节点", "description": "说明" }
  ]
}`;

        try {
            const data = await this.requestGemini({
                contents: [{ parts: [{ text: prompt }] }],
                generationConfig: { temperature: 0.7, maxOutputTokens: detailLevel === 'extreme' ? 2048 : 1536 },
            });

            const textContent = data.candidates?.[0]?.content?.parts?.[0]?.text || '';
            const jsonText = this.extractJsonObject(textContent);
            if (!jsonText) return null;

            const parsed = JSON.parse(jsonText) as AIGeneratedNode;
            if (!parsed?.label || !parsed.children) return null;
            return parsed;
        } catch {
            return null;
        }
    }

    private getDepthInstruction(maxDepth: number): string {
        if (maxDepth <= 3) {
            return '包含 3 层结构（根 -> 一级分支 -> 二级子点），不需要继续下钻。';
        }
        if (maxDepth === 4) {
            return '至少包含 4 层结构（根 -> 一级分支 -> 二级子点 -> 三级细节）。';
        }
        return '至少包含 5 层结构（根 -> 一级分支 -> 二级子点 -> 三级细节 -> 四级补充）。';
    }

    private getDetailInstruction(level: 'brief' | 'standard' | 'detailed' | 'extreme'): string {
        switch (level) {
            case 'brief':
                return '每个节点 1 句话以内，优先列要点，不展开案例。';
            case 'detailed':
                return '关键节点提供更具体的解释、例子或数据，避免空泛。';
            case 'extreme':
                return '关键节点提供具体例子、数据或操作步骤，尽量详细但保持结构清晰。';
            default:
                return '内容清晰完整，适度展开说明。';
        }
    }

    private normalizeStructureOutput(structure: AIGeneratedStructure): AIGeneratedStructure {
        if (!structure || !Array.isArray(structure.children)) return structure;

        const normalizeText = (text: string): string => text.replace(/\s+/g, ' ').trim();
        const appendDescription = (current: string, extra: string): string => {
            const trimmed = normalizeText(extra);
            if (!trimmed) return current;
            if (!current) return trimmed;
            if (current.includes(trimmed)) return current;
            return `${current}；${trimmed}`;
        };

        const splitLabel = (label: string, description: string | undefined, depth: number) => {
            let nextLabel = normalizeText(label);
            let nextDesc = typeof description === 'string' ? normalizeText(description) : '';

            if (depth <= 1 && nextLabel.length > 18) {
                const parenMatch = nextLabel.match(/^(.+?)[（(](.+)[）)](.*)$/);
                if (parenMatch) {
                    const main = normalizeText(`${parenMatch[1]}${parenMatch[3] || ''}`);
                    const extra = normalizeText(parenMatch[2] || '');
                    if (main) nextLabel = main;
                    if (extra) nextDesc = appendDescription(nextDesc, extra);
                }

                const splitMatch = nextLabel.match(/^(.+?)[：:、\\-—–|/](.+)$/);
                if (splitMatch) {
                    const main = normalizeText(splitMatch[1] || '');
                    const extra = normalizeText(splitMatch[2] || '');
                    if (main) nextLabel = main;
                    if (extra) nextDesc = appendDescription(nextDesc, extra);
                }
            }

            return { label: nextLabel || label, description: nextDesc || description };
        };

        const normalizeNode = (node: AIGeneratedNode, depth: number): AIGeneratedNode => {
            const label = typeof node.label === 'string' ? node.label : '';
            const { label: nextLabel, description: nextDesc } = splitLabel(label, node.description, depth);
            const children = node.children?.map((child) => normalizeNode(child, depth + 1));
            return {
                ...node,
                label: nextLabel,
                description: nextDesc,
                children,
            };
        };

        return {
            ...structure,
            title: typeof structure.title === 'string' ? normalizeText(structure.title) : structure.title,
            children: structure.children.map((child) => normalizeNode(child, 0)),
        };
    }

    private normalizeBodyForGenAI(body: object): object {
        if (!body || typeof body !== 'object') return body;
        const raw = body as { contents?: any };
        if (!Array.isArray(raw.contents)) return body;

        const contents = raw.contents.map((content: any) => {
            if (!content || typeof content !== 'object') return content;
            const parts = Array.isArray(content.parts) ? content.parts.map((part: any) => {
                if (part?.inline_data && !part.inlineData) {
                    const inlineData = {
                        mimeType: part.inline_data.mime_type,
                        data: part.inline_data.data,
                    };
                    const { inline_data, ...rest } = part;
                    return { ...rest, inlineData };
                }
                return part;
            }) : content.parts;
            return { ...content, parts };
        });

        return { ...body, contents };
    }

    private async requestGemini(body: object, maxRetries = 2): Promise<GeminiResponse> {
        let attempt = 0;

        while (attempt <= maxRetries) {
            const aiFactory = this.getAiInstance || getMainAiInstance();
            if (aiFactory) {
                try {
                    const normalizedBody = this.normalizeBodyForGenAI(body);
                    const ai = aiFactory();
                    const response = await ai.models.generateContent({
                        model: 'gemini-2.0-flash',
                        ...normalizedBody,
                    });
                    const text = response?.text
                        ?? response?.candidates?.[0]?.content?.parts?.[0]?.text
                        ?? '';
                    return { candidates: [{ content: { parts: [{ text }] } }] };
                } catch (error) {
                    const message = error instanceof Error ? error.message : 'API 请求失败';
                    const shouldRetry = /RESOURCE_EXHAUSTED|quota|rate limit|429|503/i.test(message);
                    if (shouldRetry && attempt < maxRetries) {
                        const delay = 500 * Math.pow(2, attempt);
                        await new Promise((resolve) => setTimeout(resolve, delay));
                        attempt += 1;
                        continue;
                    }
                    throw new Error(this.getFriendlyErrorMessage(message));
                }
            }

            const storedKey = getStoredApiKey();
            const effectiveKey = this.apiKey || storedKey;
            const endpoint = effectiveKey ? `${this.getApiUrl()}?key=${effectiveKey}` : GEMINI_PROXY_URL;
            const response = await fetch(endpoint, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(body),
            });

            if (response.ok) {
                return response.json();
            }

            const errorData = await response.json().catch(() => null);
            const message = errorData?.error?.message || `API 请求失败 (${response.status})`;
            const status = response.status;

            if ((status === 429 || status === 503) && attempt < maxRetries) {
                const delay = 500 * Math.pow(2, attempt);
                await new Promise((resolve) => setTimeout(resolve, delay));
                attempt += 1;
                continue;
            }

            throw new Error(this.getFriendlyErrorMessage(message, status));
        }

        throw new Error('API 请求失败');
    }

    private getFriendlyErrorMessage(message: string, status?: number): string {
        if (status === 429 || message.toLowerCase().includes('resource exhausted')) {
            return '请求过于频繁或额度不足，请稍后重试或检查配额。';
        }
        if (status === 401 || status === 403) {
            return 'API 密钥无效或权限不足，请检查设置。';
        }
        return message;
    }

    private extractJsonObject(text: string): string | null {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced?.[1]) return fenced[1].trim();
        const match = text.match(/\{[\s\S]*\}/);
        return match ? match[0] : null;
    }

    private extractJsonArray(text: string): string | null {
        const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
        if (fenced?.[1]) return fenced[1].trim();
        const match = text.match(/\[[\s\S]*\]/);
        return match ? match[0] : null;
    }

    private parseMarkdownToTree(text: string): AIGeneratedNode | null {
        const cleanText = text
            .replace(/```markdown/gi, '')
            .replace(/```/g, '')
            .trim();

        const lines = cleanText.split('\n');
        const root: AIGeneratedNode = { label: '', description: '', children: [] };
        const stack: { level: number; node: AIGeneratedNode }[] = [];

        lines.forEach((line) => {
            const trimmed = line.trim();
            if (!trimmed) return;

            let level = 0;
            let content = '';

            const hashMatch = trimmed.match(/^(#+)\s+(.*)/);
            if (hashMatch) {
                level = hashMatch[1].length;
                content = hashMatch[2];
            } else {
                return;
            }

            const cleaned = content
                .replace(/\*\*/g, '')
                .replace(/\*/g, '')
                .replace(/`/g, '')
                .replace(/\[(.*?)\]\(.*?\)/g, '$1')
                .trim();

            const splitMatch = cleaned.match(/^([^:：]+)[:：](.+)$/);
            let label = cleaned;
            let description = '';

            if (splitMatch) {
                label = splitMatch[1].trim();
                description = splitMatch[2].trim();
            }

            const newNode: AIGeneratedNode = { label, description, children: [] };

            if (level === 1) {
                root.label = newNode.label;
                root.description = newNode.description;
                stack.length = 0;
                stack.push({ level, node: root });
            } else {
                if (stack.length === 0) {
                    stack.push({ level: 1, node: root });
                }

                while (stack.length > 0 && stack[stack.length - 1].level >= level) {
                    stack.pop();
                }

                const parent = stack.length > 0 ? stack[stack.length - 1].node : root;
                if (!parent.children) parent.children = [];
                parent.children.push(newNode);
                stack.push({ level, node: newNode });
            }
        });

        if (root.label || (root.children && root.children.length > 0)) {
            return root;
        }
        return null;
    }
}
