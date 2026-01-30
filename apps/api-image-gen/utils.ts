// API 生图工具函数 - 复用 AI 图片识别的图片处理逻辑

export const convertBlobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

export const decodeHtmlEntities = (text: string): string => {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
};

export const processImageUrl = (url: string): string => {
    try {
        const urlObj = new URL(url);

        if (urlObj.hostname === 'gyazo.com' && urlObj.pathname.length > 1) {
            const gyazoId = urlObj.pathname.slice(1).split('/')[0];
            if (gyazoId && /^[a-f0-9]+$/i.test(gyazoId)) {
                return `https://i.gyazo.com/${gyazoId}.png`;
            }
        }

        if (urlObj.hostname === 'imgur.com' || urlObj.hostname === 'www.imgur.com') {
            const pathParts = urlObj.pathname.slice(1).split('/');
            if (pathParts[0] && pathParts[0] !== 'a' && pathParts[0] !== 'gallery') {
                const imgurId = pathParts[0];
                if (imgurId && /^[a-zA-Z0-9]+$/.test(imgurId) && imgurId.length >= 5) {
                    return `https://i.imgur.com/${imgurId}.jpg`;
                }
            }
        }

        if (urlObj.hostname.includes('drive.google.com')) {
            const pathMatch = urlObj.pathname.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
            if (pathMatch && pathMatch[1]) {
                return `https://drive.google.com/uc?export=view&id=${pathMatch[1]}`;
            }
        }
    } catch (e) {
        console.warn("Failed to process image URL", e);
    }
    return url;
};

// 从 HTML 提取图片 URL (Google Sheets 支持)
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

// 解析粘贴输入 (支持 =IMAGE() 公式和 URL)
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

// 解析 Google Sheets 粘贴的表格数据 (图片列 + 文本列)
export interface ParsedSheetRow {
    imageUrl: string | null;
    prompt: string;
}

export const parseSheetsPaste = (html: string, plainText: string): ParsedSheetRow[] => {
    const results: ParsedSheetRow[] = [];

    // 从 HTML 提取图片
    const imageUrls = extractUrlsFromHtml(html);

    // 从纯文本提取行 (每行可能是: 图片公式\t文本 或 文本)
    const lines = plainText.split(/\r?\n/).filter(line => line.trim());

    // 尝试解析 Tab 分隔的数据
    for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        const parts = line.split('\t');

        let imageUrl: string | null = null;
        let prompt = '';

        if (parts.length >= 2) {
            // 两列: 可能是 [图片/公式, 文本] 或 [文本, 图片/公式]
            const first = parts[0].trim();
            const second = parts[1].trim();

            const formulaRegex = /=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i;
            const firstMatch = first.match(formulaRegex);
            const secondMatch = second.match(formulaRegex);

            if (firstMatch) {
                imageUrl = processImageUrl(decodeHtmlEntities(firstMatch[1]));
                prompt = second;
            } else if (secondMatch) {
                imageUrl = processImageUrl(decodeHtmlEntities(secondMatch[1]));
                prompt = first;
            } else if (first.startsWith('http')) {
                imageUrl = processImageUrl(first);
                prompt = second;
            } else if (second.startsWith('http')) {
                imageUrl = processImageUrl(second);
                prompt = first;
            } else {
                // 都不是图片，第一列当作 prompt
                prompt = first;
            }
        } else {
            // 单列
            const formulaMatch = line.match(/=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i);
            if (formulaMatch) {
                imageUrl = processImageUrl(decodeHtmlEntities(formulaMatch[1]));
            } else if (!line.startsWith('http')) {
                prompt = line.trim();
            }
        }

        // 如果文本中没有图片但 HTML 中有，使用 HTML 中的
        if (!imageUrl && i < imageUrls.length) {
            imageUrl = imageUrls[i].fetchUrl;
        }

        if (imageUrl || prompt) {
            results.push({ imageUrl, prompt });
        }
    }

    // 如果纯文本解析结果为空但 HTML 有图片，使用 HTML 图片
    if (results.length === 0 && imageUrls.length > 0) {
        imageUrls.forEach(({ fetchUrl }) => {
            results.push({ imageUrl: fetchUrl, prompt: '' });
        });
    }

    return results;
};

// 下载图片 URL 并转换为 File
export const fetchImageAsFile = async (url: string): Promise<File | null> => {
    const stripped = url.replace(/^https?:\/\//i, '');
    const weservUrl = `https://images.weserv.nl/?url=${encodeURIComponent(stripped)}&output=jpg&q=95`;

    const candidates = [url, weservUrl];

    for (const candidate of candidates) {
        try {
            const response = await fetch(candidate);
            if (!response.ok) continue;

            const blob = await response.blob();
            if (blob.size < 100 || !blob.type.startsWith('image/')) continue;

            const filename = `image-${Date.now()}.${blob.type.split('/')[1] || 'jpg'}`;
            return new File([blob], filename, { type: blob.type });
        } catch (e) {
            continue;
        }
    }

    return null;
};
