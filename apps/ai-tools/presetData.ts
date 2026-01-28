import { AITool } from './types';

// Helper to get favicon from Google's service
const getFavicon = (domain: string) => `https://www.google.com/s2/favicons?domain=${domain}&sz=64`;

// 用户提供的工具列表 - 常用工具排在前面
export const PRESET_AI_TOOLS: AITool[] = [
    // ========== 常用工具 (置顶) ==========
    // 其他（AI聊天机器人）+生图
    {
        id: 'chatgpt',
        name: 'ChatGPT',
        category: 'chatbot',
        icon: getFavicon('chatgpt.com'),
        website: 'https://chatgpt.com/',
        description: 'OpenAI 旗舰对话AI，支持 GPT-4o 多模态，可生图',
        pricing: 'freemium',
        freeQuota: '免费版限量；Plus $20/月',
        tags: ['对话', '生图', '代码'],
        safety: 'safe'
    },
    // 其他（AI聊天机器人）+生图+生视频
    {
        id: 'aistudio',
        name: 'AI Studio',
        category: 'chatbot',
        icon: getFavicon('aistudio.google.com'),
        website: 'https://aistudio.google.com/',
        description: 'Google AI Studio，开发者测试Gemini，可生图生视频',
        pricing: 'free',
        freeQuota: '免费使用',
        tags: ['开发', '生图', '生视频'],
        safety: 'safe'
    },
    // 其他（AI聊天机器人）生图+生视频
    {
        id: 'gemini',
        name: 'Gemini',
        category: 'chatbot',
        icon: getFavicon('gemini.google.com'),
        website: 'https://gemini.google.com',
        description: 'Google AI 助手，多模态理解，可生图生视频',
        pricing: 'freemium',
        freeQuota: '免费使用；Advanced $19.99/月',
        tags: ['对话', '生图', '生视频'],
        safety: 'safe'
    },
    // 其他（AI聊天机器人）生图+生视频
    {
        id: 'grok',
        name: 'Grok',
        category: 'chatbot',
        icon: getFavicon('x.com'),
        website: 'https://x.com/i/grok',
        description: 'xAI 出品，集成 X 平台实时信息，可生图生视频',
        pricing: 'paid',
        freeQuota: '需 X Premium 订阅',
        tags: ['对话', '生图', '生视频'],
        safety: 'safe'
    },
    // AI口播视频
    {
        id: 'heygen',
        name: 'HeyGen',
        category: 'video',
        icon: getFavicon('heygen.com'),
        website: 'https://www.heygen.com/',
        description: 'AI口播视频生成和翻译',
        pricing: 'freemium',
        freeQuota: '1分钟免费；Creator $24/月',
        tags: ['口播视频', '数字人'],
        safety: 'unsafe'
    },
    // AI生图 + 视频
    {
        id: 'dreamina',
        name: 'Dreamina',
        category: 'image',
        icon: getFavicon('dreamina.capcut.com'),
        website: 'https://dreamina.capcut.com/ai-tool/home',
        description: '字节跳动AI生图+视频创作工具',
        pricing: 'freemium',
        freeQuota: '免费试用',
        tags: ['生图', '视频'],
        safety: 'unsafe'
    },
    // AI生图 + 视频
    {
        id: 'kling',
        name: 'Kling AI',
        category: 'video',
        icon: getFavicon('klingai.com'),
        website: 'https://www.klingai.com/',
        description: '快手可灵AI生图+视频生成',
        pricing: 'freemium',
        freeQuota: '每日免费积分',
        tags: ['生图', '视频生成'],
        safety: 'unsafe'
    },
    // AI生图 + 视频
    {
        id: 'midjourney',
        name: 'Midjourney',
        category: 'image',
        icon: getFavicon('midjourney.com'),
        website: 'https://midjourney.com/',
        description: '顶级AI生图+视频，艺术风格突出',
        pricing: 'paid',
        freeQuota: '无免费；Basic $10/月',
        tags: ['生图', '视频', '艺术'],
        safety: 'safe'
    },
    // AI生图 + 视频
    {
        id: 'sora',
        name: 'Sora',
        category: 'video',
        icon: getFavicon('sora.com'),
        website: 'https://sora.com/',
        description: 'OpenAI 视频生成模型，可生图',
        pricing: 'paid',
        freeQuota: '需 ChatGPT Plus 订阅',
        tags: ['生图', '视频生成'],
        safety: 'safe'
    },
    // AI视频生成
    {
        id: 'hailuo',
        name: '海螺AI',
        category: 'video',
        icon: getFavicon('hailuoai.video'),
        website: 'https://hailuoai.video/',
        description: 'MiniMax 海螺AI视频生成',
        pricing: 'freemium',
        freeQuota: '免费使用',
        tags: ['视频生成'],
        safety: 'unsafe'
    },
    // AI生图 + 视频
    {
        id: 'whisk',
        name: 'Whisk',
        category: 'image',
        icon: getFavicon('labs.google'),
        website: 'https://labs.google/fx/tools/whisk',
        description: 'Google Labs 生图+视频混合工具',
        pricing: 'free',
        freeQuota: '免费使用',
        tags: ['生图', '视频', '创意'],
        safety: 'safe'
    },
    // AI生图（图像生成）
    {
        id: 'imagefx',
        name: 'ImageFX',
        category: 'image',
        icon: getFavicon('aitestkitchen.withgoogle.com'),
        website: 'https://aitestkitchen.withgoogle.com/tools/image-fx',
        description: 'Google AI Test Kitchen 图像生成',
        pricing: 'free',
        freeQuota: '免费使用',
        tags: ['图像生成'],
        safety: 'safe'
    },
    // AI生图（图像生成）
    {
        id: 'krea',
        name: 'KREA',
        category: 'image',
        icon: getFavicon('krea.ai'),
        website: 'https://www.krea.ai/home',
        description: 'AI 图像生成和增强工具',
        pricing: 'freemium',
        freeQuota: '免费版有限额；Pro $24/月',
        tags: ['图像生成', '增强'],
        safety: 'unknown'
    },
    // AI生图（图像生成）
    {
        id: 'flux',
        name: 'Playground AI / Flux',
        category: 'image',
        icon: getFavicon('bfl.ai'),
        website: 'https://playground.bfl.ai/image/generate',
        description: 'Black Forest Labs Flux 图像生成器',
        pricing: 'freemium',
        freeQuota: '免费试用',
        tags: ['图像生成'],
        safety: 'safe'
    },
    // AI生图（图像生成）+口播+生视频
    {
        id: 'hedra',
        name: 'Hedra Characters',
        category: 'video',
        icon: getFavicon('hedra.com'),
        website: 'https://www.hedra.com/app/characters',
        description: 'AI 图像生成+口播+视频生成',
        pricing: 'freemium',
        freeQuota: '免费试用',
        tags: ['图像生成', '口播', '视频'],
        safety: 'unknown'
    },
    // AI音频（配音、音效、音乐等）
    {
        id: 'elevenlabs',
        name: 'ElevenLabs',
        category: 'audio',
        icon: getFavicon('elevenlabs.io'),
        website: 'https://elevenlabs.io/',
        description: 'AI音频：配音、音效、语音合成',
        pricing: 'freemium',
        freeQuota: '每月10,000字符免费',
        tags: ['配音', '音效', 'TTS'],
        safety: 'safe'
    },
    // AI音频（配音、音效、音乐等）
    {
        id: 'suno',
        name: 'Suno AI',
        category: 'audio',
        icon: getFavicon('suno.ai'),
        website: 'https://app.suno.ai/',
        description: 'AI音频：音乐生成',
        pricing: 'freemium',
        freeQuota: '每日50积分免费',
        tags: ['音乐生成'],
        safety: 'safe'
    },
    // AI视频制作+音频
    {
        id: 'clipchamp',
        name: 'Clipchamp',
        category: 'video',
        icon: getFavicon('clipchamp.com'),
        website: 'https://app.clipchamp.com/',
        description: '微软AI视频制作+音频编辑器',
        pricing: 'freemium',
        freeQuota: '免费版可用',
        tags: ['视频制作', '音频'],
        safety: 'safe'
    },

    // ========== 其他工具 ==========
    {
        id: 'pixverse',
        name: 'PixVerse',
        category: 'video',
        icon: getFavicon('pixverse.ai'),
        website: 'https://app.pixverse.ai/visionary',
        description: 'AI 图片和视频生成平台',
        pricing: 'freemium',
        freeQuota: '每日免费积分',
        tags: ['视频', '图片'],
        safety: 'unknown'
    },
    {
        id: 'runway',
        name: 'Runway',
        category: 'video',
        icon: getFavicon('runwayml.com'),
        website: 'https://app.runwayml.com/',
        description: 'AI视频生成先驱，Gen-3/Gen-4',
        pricing: 'freemium',
        freeQuota: '125积分免费；Standard $15/月',
        tags: ['视频生成', '编辑'],
        safety: 'safe'
    },
    {
        id: 'bing-create',
        name: 'Bing Image Creator',
        category: 'image',
        icon: getFavicon('bing.com'),
        website: 'https://www.bing.com/images/create',
        description: '微软 Bing 图片生成器',
        pricing: 'free',
        freeQuota: '免费使用',
        tags: ['图片生成'],
        safety: 'safe'
    },
    {
        id: 'designer',
        name: 'Microsoft Designer',
        category: 'image',
        icon: getFavicon('designer.microsoft.com'),
        website: 'https://designer.microsoft.com/image-creator',
        description: '微软设计师 AI 图片创建',
        pricing: 'free',
        freeQuota: '免费使用',
        tags: ['图片', '设计'],
        safety: 'safe'
    },
    {
        id: 'recraft',
        name: 'Recraft',
        category: 'image',
        icon: getFavicon('recraft.ai'),
        website: 'https://www.recraft.ai/',
        description: 'AI 矢量图和图片生成',
        pricing: 'freemium',
        freeQuota: '每日免费积分',
        tags: ['图片', '矢量'],
        safety: 'safe'
    },
    {
        id: 'shedevrum',
        name: 'Shedevrum',
        category: 'image',
        icon: getFavicon('shedevrum.ai'),
        website: 'https://shedevrum.ai/en',
        description: 'Yandex AI 图片生成',
        pricing: 'free',
        freeQuota: '免费使用',
        tags: ['图片生成'],
        safety: 'safe'
    },
    {
        id: 'copilot',
        name: 'Microsoft Copilot',
        category: 'chatbot',
        icon: getFavicon('copilot.microsoft.com'),
        website: 'https://copilot.microsoft.com/',
        description: '微软 AI 助手',
        pricing: 'freemium',
        freeQuota: '免费使用；Pro $20/月',
        tags: ['对话', '搜索'],
        safety: 'safe'
    },
    {
        id: 'vidu',
        name: 'Vidu',
        category: 'video',
        icon: getFavicon('vidu.com'),
        website: 'https://platform.vidu.com/',
        description: '国产 AI 视频生成',
        pricing: 'freemium',
        freeQuota: '免费试用',
        tags: ['视频生成'],
        safety: 'unsafe'
    },
    {
        id: 'poe',
        name: 'Poe',
        category: 'chatbot',
        icon: getFavicon('poe.com'),
        website: 'https://poe.com/login',
        description: 'Quora 多AI聊天平台',
        pricing: 'freemium',
        freeQuota: '免费每日积分',
        tags: ['对话', '多模型'],
        safety: 'safe'
    },
    {
        id: 'vidnoz',
        name: 'Vidnoz',
        category: 'video',
        icon: getFavicon('vidnoz.com'),
        website: 'https://aiapp.vidnoz.com/',
        description: 'AI 视频和数字人工具',
        pricing: 'freemium',
        freeQuota: '免费试用',
        tags: ['视频', '数字人'],
        safety: 'unknown'
    },
    {
        id: 'firefly',
        name: 'Adobe Firefly',
        category: 'image',
        icon: getFavicon('firefly.adobe.com'),
        website: 'https://firefly.adobe.com/',
        description: 'Adobe AI 图片生成',
        pricing: 'freemium',
        freeQuota: '每月免费积分',
        tags: ['图片生成', '设计'],
        safety: 'safe'
    },
    {
        id: 'lovart',
        name: 'Lovart',
        category: 'image',
        icon: getFavicon('lovart.ai'),
        website: 'https://www.lovart.ai/',
        description: 'AI 艺术生成平台',
        pricing: 'freemium',
        freeQuota: '免费试用',
        tags: ['图片', '艺术'],
        safety: 'unknown'
    },
    {
        id: 'picsart',
        name: 'Picsart',
        category: 'image',
        icon: getFavicon('picsart.com'),
        website: 'https://picsart.com/',
        description: 'AI 图片编辑工具',
        pricing: 'freemium',
        freeQuota: '免费版可用',
        tags: ['图片编辑'],
        safety: 'safe'
    },
    {
        id: 'getimg',
        name: 'Getimg.ai',
        category: 'image',
        icon: getFavicon('getimg.ai'),
        website: 'https://getimg.ai/',
        description: 'AI 图片生成套件',
        pricing: 'freemium',
        freeQuota: '每月100积分免费',
        tags: ['图片生成'],
        safety: 'safe'
    },
    {
        id: 'ideogram',
        name: 'Ideogram',
        category: 'image',
        icon: getFavicon('ideogram.ai'),
        website: 'https://ideogram.ai/login',
        description: 'AI图片生成，擅长文字渲染',
        pricing: 'freemium',
        freeQuota: '每日免费生成次数',
        tags: ['图片生成', '文字'],
        safety: 'safe'
    },
    {
        id: 'leiapix',
        name: 'LeiaPix',
        category: 'image',
        icon: getFavicon('leiapix.com'),
        website: 'https://convert.leiapix.com/',
        description: '2D转3D深度图工具',
        pricing: 'free',
        freeQuota: '免费使用',
        tags: ['图片', '3D'],
        safety: 'safe'
    },
    {
        id: 'leonardo',
        name: 'Leonardo.AI',
        category: 'image',
        icon: getFavicon('leonardo.ai'),
        website: 'https://leonardo.ai/',
        description: 'AI图片生成平台',
        pricing: 'freemium',
        freeQuota: '每日150积分免费',
        tags: ['图片生成'],
        safety: 'safe'
    },
    {
        id: 'pincel',
        name: 'Pincel',
        category: 'image',
        icon: getFavicon('pincel.app'),
        website: 'https://pincel.app/',
        description: 'AI 图片增强工具',
        pricing: 'freemium',
        freeQuota: '免费试用',
        tags: ['图片增强'],
        safety: 'unknown'
    },
    {
        id: 'pixelcut',
        name: 'Pixelcut',
        category: 'image',
        icon: getFavicon('pixelcut.ai'),
        website: 'https://www.pixelcut.ai',
        description: 'AI 图片编辑和背景去除',
        pricing: 'freemium',
        freeQuota: '免费版可用',
        tags: ['图片编辑', '去背景'],
        safety: 'unknown'
    },
    {
        id: 'pixeltinkers',
        name: 'Pixel Tinkers',
        category: 'image',
        icon: getFavicon('pixeltinkers.com'),
        website: 'https://www.pixeltinkers.com/',
        description: 'AI 图片工具集',
        pricing: 'freemium',
        freeQuota: '免费试用',
        tags: ['图片'],
        safety: 'safe'
    },
    {
        id: 'recraft-app',
        name: 'Recraft App',
        category: 'image',
        icon: getFavicon('recraft.ai'),
        website: 'https://app.recraft.ai/',
        description: 'Recraft AI 应用版',
        pricing: 'freemium',
        freeQuota: '每日免费积分',
        tags: ['图片', '矢量'],
        safety: 'safe'
    },
    {
        id: 'luma',
        name: 'Luma Dream Machine',
        category: 'video',
        icon: getFavicon('lumalabs.ai'),
        website: 'https://dream-machine.lumalabs.ai/board/new',
        description: 'Luma AI 视频生成',
        pricing: 'freemium',
        freeQuota: '每月30次免费；$23.99/月',
        tags: ['视频生成'],
        safety: 'safe'
    },
    {
        id: 'fliki',
        name: 'Fliki',
        category: 'video',
        icon: getFavicon('fliki.ai'),
        website: 'https://app.fliki.ai/',
        description: 'AI 视频和配音生成',
        pricing: 'freemium',
        freeQuota: '5分钟免费',
        tags: ['视频', '配音'],
        safety: 'safe'
    },
    {
        id: 'framepack',
        name: 'FramePack',
        category: 'video',
        icon: getFavicon('framepack.ai'),
        website: 'https://framepack.ai/',
        description: 'AI 视频打包工具',
        pricing: 'freemium',
        freeQuota: '免费试用',
        tags: ['视频'],
        safety: 'safe'
    },
    {
        id: 'pollo',
        name: 'Pollo AI',
        category: 'video',
        icon: getFavicon('pollo.ai'),
        website: 'https://pollo.ai/template',
        description: 'AI 视频模板工具',
        pricing: 'freemium',
        freeQuota: '免费试用',
        tags: ['视频', '模板'],
        safety: 'safe'
    },
    {
        id: 'meta-ai',
        name: 'Meta AI',
        category: 'chatbot',
        icon: getFavicon('meta.ai'),
        website: 'https://www.meta.ai/',
        description: 'Meta 出品的 AI 助手',
        pricing: 'free',
        freeQuota: '完全免费',
        tags: ['对话', '免费'],
        safety: 'safe'
    }
];

// Category labels for display
export const CATEGORY_LABELS: Record<string, string> = {
    chatbot: '对话',
    image: '图片',
    video: '视频',
    audio: '音频',
    writing: '写作',
    code: '代码',
    productivity: '效率',
    other: '其他'
};

// Safety labels
export const SAFETY_LABELS: Record<string, { label: string; color: string }> = {
    safe: { label: '安全', color: 'green' },
    unknown: { label: '需翻墙', color: 'yellow' },
    unsafe: { label: '谨慎使用', color: 'red' }
};

// Pricing labels
export const PRICING_LABELS: Record<string, string> = {
    free: '免费',
    freemium: '免费+付费',
    paid: '付费',
    trial: '试用'
};
