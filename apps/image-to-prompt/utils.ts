/**
 * Image to Prompt Tool - Utilities & Helpers
 * 反推提示词工具 - 工具函数
 */

import { ExpertKey, expertDescriptions } from './types';

/**
 * 生成唯一 ID
 */
export const generateUniqueId = () => {
    return Date.now().toString();
};

/**
 * 文件转 Base64
 */
export const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result as string;
            resolve(result.split(',')[1]); // 返回纯 base64，不含 data URL 前缀
        };
        reader.onerror = reject;
        reader.readAsDataURL(file);
    });
};

/**
 * Base64 转 Blob
 */
export const b64toBlob = (b64Data: string, contentType = '', sliceSize = 512) => {
    const byteCharacters = atob(b64Data);
    const byteArrays: BlobPart[] = [];
    for (let offset = 0; offset < byteCharacters.length; offset += sliceSize) {
        const slice = byteCharacters.slice(offset, offset + sliceSize);
        const byteNumbers = new Array(slice.length);
        for (let i = 0; i < slice.length; i++) {
            byteNumbers[i] = slice.charCodeAt(i);
        }
        byteArrays.push(new Uint8Array(byteNumbers) as BlobPart);
    }
    return new Blob(byteArrays, { type: contentType });
};

/**
 * 下载 Data URL
 */
export const downloadDataUrl = (url: string, filename: string, prefix: string = 'processed') => {
    const link = document.createElement('a');
    link.href = url;
    link.download = `${prefix}_${filename}`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
};

/**
 * 获取多专家系统指令（精确模式 - 逐张处理）
 * 来自创艺魔盒 2 的优化版本
 */
export const getMultiExpertSystemInstruction = (expertKeys: ExpertKey[]) => {
    const expertNames = expertKeys.join(', ');
    return `You will act as a panel of expert prompt engineers for different AI image generation models. The experts are: ${expertNames}.

Your task is to analyze an uploaded image and, for EACH expert, create two distinct prompts (one in English, one in Chinese) that would generate a nearly identical image, tailored to that expert's specific model's style and syntax.

**MANDATORY IDENTIFICATION RULES (HIGHEST PRIORITY):**
1. **Image Type Distinction:**
   - **Real Photograph:** If the image looks like a real photo (or if it is ambiguous/realistic but processed), you MUST treat it as a photograph. Start your description with "A real photo taken with a mobile phone, bright scene...". STRICTLY AVOID terms like "painting", "illustration", "digital art", "3D render", or "drawing" to ensure the output style is photorealistic.
   - **Artwork:** Only if the image is clearly a painting, sketch, or stylized digital art, should you describe it as such (e.g., "An oil painting...", "A digital illustration...").
2. **Camera & Perspective:**
   - You MUST accurately identify and describe the camera angle and shot composition.
   - **Viewpoint:** Specify the exact angle relative to the subject (e.g., "shot from the front left", "view from behind", "right profile view").
   - **Elevation:** Specify the vertical angle (e.g., "low angle", "high angle", "eye-level", "top-down/bird's-eye view").
   - **Shot Size:** Specify the framing (e.g., "extreme close-up", "medium shot", "full body shot", "wide angle").

**CRITICAL DETAIL REQUIREMENTS:**
Your description for each prompt MUST be exhaustive and highly detailed. Do not be brief.
- **Subject & Scene:** Describe all subjects, objects, and characters with extreme precision. For people, detail their appearance, clothing (fabric, style, color), accessories, pose, expression, and action. Specify their spatial relationship to each other and the environment.
- **Composition & Style:** Clearly define the shot type, camera angle, and overall artistic style (adhering to the Mandatory Rules above).
- **Artistic Elements:** If the image has a distinct artistic style, you MUST describe its specific characteristics. This includes brushwork (e.g., "visible, thick impasto strokes", "smooth, blended digital airbrushing"), linework (e.g., "sharp, clean cel-shaded outlines", "sketchy, loose pencil lines"), color palette (e.g., "vibrant neon colors", "muted, desaturated tones"), and lighting (e.g., "dramatic chiaroscuro lighting", "soft, diffused morning light").
- **Environment:** Describe the background and foreground in detail, including location, time of day, weather, and specific environmental elements.
- **Keywords:** Incorporate relevant keywords that are effective for the target model (e.g., artist names for Stable Diffusion, stylistic terms for Midjourney).

**MODIFICATION INSTRUCTIONS:**
- After the image, a text-based instruction may be provided. If it is, you MUST incorporate this instruction into your generated prompts. For example, if the instruction is 'change the background to a beach', your prompts must describe a beach background instead of what's in the original image, while keeping other elements consistent.

**RESPONSE FORMAT RULES:**
- You MUST provide your response *only* as a valid JSON array of objects.
- Do NOT include any conversational text, introductions, explanations, or markdown formatting like \`\`\`json.
- Each object in the array must represent one expert and contain three keys: "expert", "englishPrompt", and "chinesePrompt".
- The "expert" key's value must be one of the requested expert names: ${expertNames}.

**Prohibited terms in prompts:** "ultra-realistic", "photorealistic", "photography style", "photo-level realism", "cinematic quality", "Unreal Engine".`;
};

/**
 * 获取批量多专家系统指令（快速模式 - 批量打包）
 */
export const getBatchMultiExpertSystemInstruction = (expertKeys: ExpertKey[]) => {
    const expertNames = expertKeys.join(', ');
    return `You are a panel of expert prompt engineers. The experts are: ${expertNames}.
Analyze EACH of multiple uploaded images. For EACH image and EACH expert, create two prompts (English and Chinese).

**RULES (Apply the MANDATORY IDENTIFICATION RULES from single-image mode):**
- Identify if each image is a photo or artwork.
- Describe camera angles and shot details.
- Be exhaustive and detailed.

**RESPONSE FORMAT:**
- Return a JSON object with a "results" array.
- Each item in "results" is an array of expert prompts for one image, in the order the images were provided.
- Each expert prompt object has: "expert", "englishPrompt", "chinesePrompt".

Example for 2 images, 1 expert:
{
  "results": [
    [{"expert": "general", "englishPrompt": "...", "chinesePrompt": "..."}],
    [{"expert": "general", "englishPrompt": "...", "chinesePrompt": "..."}]
  ]
}`;
};

/**
 * 获取融合合成系统指令
 * 来自创艺魔盒 2
 */
export const getFusionSystemInstruction = () => {
    return `You are an expert Art Director. synthesize a single, cohesive image generation prompt from multiple reference images.
Each image comes with a 'Role'. Extract ONLY the feature corresponding to the Role:
- 'style': Extract art style, brushwork, color palette.
- 'composition': Extract camera angle, framing, layout.
- 'scene': Extract background environment, lighting.
- 'character': Extract subject pose, attire.
- 'inspiration': General inspiration.
Combine these elements into a rich Midjourney/Stable Diffusion prompt. 
Response JSON schema: { "englishPrompt": "string", "chinesePrompt": "string" }`;
};

/**
 * 复制文本到剪贴板
 */
export const copyToClipboard = async (text: string): Promise<boolean> => {
    try {
        await navigator.clipboard.writeText(text);
        return true;
    } catch (err) {
        console.error('Failed to copy:', err);
        return false;
    }
};

// ========== 图片 URL 处理函数（与 AI 图片识别工具保持一致）==========

/**
 * 解码 HTML 实体（如 &amp; -> &）
 */
export const decodeHtmlEntities = (text: string): string => {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
};

/**
 * 处理图片 URL，转换特殊链接为直接图片链接
 */
export const processImageUrl = (url: string): string => {
    try {
        const urlObj = new URL(url);

        // 1. Handle Gyazo Share Page Links
        if (urlObj.hostname === 'gyazo.com' && urlObj.pathname.length > 1) {
            const gyazoId = urlObj.pathname.slice(1).split('/')[0];
            if (gyazoId && /^[a-f0-9]+$/i.test(gyazoId)) {
                return `https://i.gyazo.com/${gyazoId}.png`;
            }
        }

        // 2. Handle Imgur Share Page Links
        if (urlObj.hostname === 'imgur.com' || urlObj.hostname === 'www.imgur.com') {
            const pathParts = urlObj.pathname.slice(1).split('/');
            if (pathParts[0] && pathParts[0] !== 'a' && pathParts[0] !== 'gallery' && pathParts[0] !== 't') {
                const imgurId = pathParts[0];
                if (imgurId && /^[a-zA-Z0-9]+$/.test(imgurId) && imgurId.length >= 5 && imgurId.length <= 10) {
                    return `https://i.imgur.com/${imgurId}.jpg`;
                }
            }
        }

        // 3. Handle Google Drive Viewer Links
        if (urlObj.hostname.includes('drive.google.com')) {
            const pathMatch = urlObj.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (pathMatch && pathMatch[1]) {
                return `https://drive.google.com/uc?export=view&id=${pathMatch[1]}`;
            }
            const idParam = urlObj.searchParams.get('id');
            if (idParam) {
                return `https://drive.google.com/uc?export=view&id=${idParam}`;
            }
        }
    } catch (e) {
        console.warn("Failed to process image URL", e);
    }
    return url;
};

/**
 * 从 HTML 中提取图片 URL（用于 Google Sheets 支持）
 */
export const extractUrlsFromHtml = (html: string): { originalUrl: string; fetchUrl: string }[] => {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const images = doc.querySelectorAll('img');
        const results: { originalUrl: string; fetchUrl: string }[] = [];

        images.forEach(img => {
            if (img.src) {
                const decodedUrl = decodeHtmlEntities(img.src);
                results.push({
                    originalUrl: decodedUrl,
                    fetchUrl: processImageUrl(decodedUrl)
                });
            }
        });

        return results;
    } catch (e) {
        console.error("Error parsing HTML for images:", e);
        return [];
    }
};

/**
 * 解析粘贴的文本内容，提取 URL 和 =IMAGE() 公式
 */
export const parsePasteInput = (text: string): { type: 'url' | 'formula'; content: string; url: string }[] => {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    const results: { type: 'url' | 'formula'; content: string; url: string }[] = [];

    const formulaRegex = /=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i;
    const urlRegex = /https?:\/\/[^\s]+/;

    for (const line of lines) {
        const trimmed = line.trim();
        const formulaMatch = trimmed.match(formulaRegex);

        if (formulaMatch) {
            const rawUrl = decodeHtmlEntities(formulaMatch[1]);
            results.push({
                type: 'formula',
                content: trimmed,
                url: processImageUrl(rawUrl)
            });
            continue;
        }

        const urlMatch = trimmed.match(urlRegex);
        if (urlMatch) {
            const rawUrl = decodeHtmlEntities(urlMatch[0]);
            results.push({
                type: 'url',
                content: trimmed,
                url: processImageUrl(rawUrl)
            });
        }
    }

    return results;
};

/**
 * 从远程 URL 获取图片并转换为 Blob
 */
export const fetchImageBlob = async (url: string): Promise<{ blob: Blob; mimeType: string }> => {
    const stripProtocol = (u: string): string => u.replace(/^https?:\/\//i, '');
    const encodedUrl = encodeURIComponent(url);
    const stripped = stripProtocol(url);

    // 各种代理 URL
    const weservUrl = `https://images.weserv.nl/?url=${encodeURIComponent(stripped)}&output=jpg&q=100&we=1`;
    const gadgetProxy = `https://images1-focus-opensocial.googleusercontent.com/gadgets/proxy?container=focus&refresh=86400&url=${encodedUrl}`;
    const allOriginsProxy = `https://api.allorigins.win/raw?url=${encodedUrl}`;
    const corsProxy = `https://corsproxy.io/?${encodedUrl}`;
    const wpProxy = stripped ? `https://i0.wp.com/${stripped}` : null;

    const candidates = [
        url,
        weservUrl,
        gadgetProxy,
        allOriginsProxy,
        corsProxy,
        wpProxy
    ].filter(Boolean) as string[];

    const attemptFetch = async (fetchUrl: string) => {
        const response = await fetch(fetchUrl);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        if (blob.type.startsWith('text/') || blob.type.includes('html')) {
            throw new Error("Invalid image content");
        }
        if (blob.size < 100) {
            throw new Error("Image too small");
        }
        return blob;
    };

    for (const candidate of candidates) {
        try {
            const blob = await attemptFetch(candidate);
            return { blob, mimeType: blob.type };
        } catch (error) {
            console.warn(`Fetch failed for ${candidate}:`, error);
        }
    }

    throw new Error("图片无法下载。请检查链接是否有效，或尝试保存图片到本地后上传。");
};
