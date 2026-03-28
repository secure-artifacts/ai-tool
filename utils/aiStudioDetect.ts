/**
 * AI Studio 环境检测工具
 * 
 * 检测当前是否运行在 AI Studio 模式。
 * 
 * 检测方式（任一满足即为 AI Studio 模式）：
 * 1. 环境变量 VITE_AI_STUDIO=true（打包 AI Studio 源码时在 .env.local 中设置）
 * 2. URL hostname 包含 aistudio.google.com
 * 3. API key 以 AIza 开头（AI Studio 标准 key 格式）
 * 
 * 在 AI Studio 模式下：
 * - 不加 vertexai: true
 * - 生图使用 imageConfig 而非 responseModalities
 */

/**
 * 检测环境变量是否标记为 AI Studio 模式
 */
const isEnvAiStudio = (): boolean => {
    try {
        return (import.meta as any).env?.VITE_AI_STUDIO === 'true';
    } catch {
        return false;
    }
};

/**
 * 检测当前页面 URL 是否在 AI Studio 域名下
 */
const isHostAiStudio = (): boolean => {
    if (typeof window === 'undefined') return false;
    try {
        const hostname = window.location.hostname;
        return hostname === 'aistudio.google.com'
            || hostname.endsWith('.aistudio.google.com')
            || hostname.endsWith('.google.com') && window.location.pathname.includes('/aistudio');
    } catch {
        return false;
    }
};

/**
 * 检测是否应该使用 AI Studio 模式（非 Vertex AI）
 * 
 * 条件（任一满足即为 AI Studio 模式）：
 * 1. 环境变量 VITE_AI_STUDIO=true
 * 2. URL 在 AI Studio 域名下
 * 3. API key 以 AIza 开头
 */
export const shouldUseAiStudioMode = (apiKey?: string): boolean => {
    // 1. AI Studio 域名 → 始终 AI Studio 模式（平台内部提供认证，不需要外部 key）
    if (isHostAiStudio()) return true;

    // 2. 有 key → 按 key 类型判断（优先于环境变量）
    //    网站模式下：AIza 开头 = AI Studio key，其他 = Vertex AI key
    if (apiKey && apiKey.trim().length > 0) {
        return apiKey.trim().startsWith('AIza');
    }

    // 3. 无 key + 环境变量 → AI Studio 构建模式（打包 AI Studio 版本时用）
    if (isEnvAiStudio()) return true;
    return false;
};

/**
 * 是否运行在 AI Studio 环境中（不依赖 key）
 */
export const isRunningInAiStudio = (): boolean => {
    return isEnvAiStudio() || isHostAiStudio();
};
