export const convertBlobToBase64 = (blob: Blob): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onloadend = () => {
            const result = reader.result as string;
            // Remove data:image/xxx;base64, prefix
            const base64 = result.split(',')[1];
            resolve(base64);
        };
        reader.onerror = reject;
        reader.readAsDataURL(blob);
    });
};

const stripProtocol = (url: string): string => url.replace(/^https?:\/\//i, '');

// 检测可能被热链接保护的域名
export const isLikelyHotlinkBlocked = (url: string): boolean =>
    /fbcdn\.net|scontent\.|cdninstagram\.com|instagram\.com|fbsbx\.com|facebook\.com\/.*\/photos/i.test(url);

// 检测是 Facebook CDN 链接（带签名的）
export const isFacebookCdn = (url: string): boolean =>
    /scontent[\w.-]*\.fbcdn\.net|scontent[\w.-]*\.fna\.fbcdn\.net/i.test(url);

export const processImageUrl = (url: string): string => {
    try {
        const urlObj = new URL(url);

        // 1. Handle Gyazo Share Page Links
        // Converts https://gyazo.com/ID to https://i.gyazo.com/ID.{ext}
        // Gyazo images can be png, jpg, or gif - we'll try png first (most common for screenshots)
        if (urlObj.hostname === 'gyazo.com' && urlObj.pathname.length > 1) {
            const gyazoId = urlObj.pathname.slice(1).split('/')[0];  // 去除开头的 / 并获取 ID
            if (gyazoId && /^[a-f0-9]+$/i.test(gyazoId)) {
                // 优先尝试 png 格式（截图最常见），fetchImageBlob 会负责重试其他格式
                return `https://i.gyazo.com/${gyazoId}.png`;
            }
        }

        // 2. Handle Imgur Share Page Links
        // Converts https://imgur.com/ID to https://i.imgur.com/ID.jpg
        // Note: Skip album links (imgur.com/a/...) as they contain multiple images
        if (urlObj.hostname === 'imgur.com' || urlObj.hostname === 'www.imgur.com') {
            const pathParts = urlObj.pathname.slice(1).split('/');
            // Skip album links (/a/...) and gallery links (/gallery/...)
            if (pathParts[0] && pathParts[0] !== 'a' && pathParts[0] !== 'gallery' && pathParts[0] !== 't') {
                const imgurId = pathParts[0];
                // Imgur IDs are alphanumeric, typically 5-7 characters
                if (imgurId && /^[a-zA-Z0-9]+$/.test(imgurId) && imgurId.length >= 5 && imgurId.length <= 10) {
                    return `https://i.imgur.com/${imgurId}.jpg`;
                }
            }
        }

        // 3. Handle Google Drive Viewer Links
        // Converts https://drive.google.com/file/d/FILE_ID/view... to https://drive.google.com/uc?export=view&id=FILE_ID
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

        // 4. Handle Google User Content (lh3.googleusercontent.com etc.)
        if (urlObj.hostname.includes('googleusercontent.com')) {
            // Usually these links work fine, but sometimes =s0 ensures full size
        }

    } catch (e) {
        console.warn("Failed to process image URL", e);
    }
    return url;
};

// 解码 HTML 实体（如 &amp; -> &）
export const decodeHtmlEntities = (text: string): string => {
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    return textarea.value;
};

// Extract Image URLs from HTML (for Google Sheets support)
// Returns both the original URL (for formula reconstruction) and the processed URL (for fetching)
export const extractUrlsFromHtml = (html: string): { originalUrl: string; fetchUrl: string }[] => {
    try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(html, 'text/html');
        const images = doc.querySelectorAll('img');
        const results: { originalUrl: string; fetchUrl: string }[] = [];

        images.forEach(img => {
            if (img.src) {
                // 解码 HTML 实体（如 &amp; -> &）
                const decodedUrl = decodeHtmlEntities(img.src);
                results.push({
                    originalUrl: decodedUrl,  // Keep original for formula
                    fetchUrl: processImageUrl(decodedUrl)  // Process for fetching
                });
            }
        });

        return results;
    } catch (e) {
        console.error("Error parsing HTML for images:", e);
        return [];
    }
};



export const parsePasteInput = (text: string): { type: 'url' | 'formula'; content: string; url: string }[] => {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    const results: { type: 'url' | 'formula'; content: string; url: string }[] = [];

    // Regex for =IMAGE("url") - handles variations in spacing and quotes
    const formulaRegex = /=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i;
    // Loose Regex for URL - looks for http/https at the start of a string or after a space
    const urlRegex = /https?:\/\/[^\s]+/;

    for (const line of lines) {
        const trimmed = line.trim();
        // Check for formula first
        const formulaMatch = trimmed.match(formulaRegex);

        if (formulaMatch) {
            const rawUrl = decodeHtmlEntities(formulaMatch[1]);  // 解码 HTML 实体
            results.push({
                type: 'formula',
                content: trimmed, // Original formula string to preserve
                url: processImageUrl(rawUrl) // Processed URL
            });
            continue;
        }

        const urlMatch = trimmed.match(urlRegex);
        if (urlMatch) {
            const rawUrl = decodeHtmlEntities(urlMatch[0]);  // 解码 HTML 实体（如 &amp; -> &）
            results.push({
                type: 'url',
                content: trimmed, // Original URL line
                url: processImageUrl(rawUrl)
            });
        }
    }

    return results;
};

// Helper to fetch external image and convert to Blob (Handles CORS errors gracefully by trying a proxy)
export const fetchImageBlob = async (url: string): Promise<{ blob: Blob; mimeType: string }> => {
    // 优先尝试本地代理（Vite dev server 或 Electron 环境无 CORS 限制）
    const inElectron = !!(window as any).electronCache?.isElectron;

    const tryLocalProxy = async (targetUrl: string): Promise<{ blob: Blob; mimeType: string } | null> => {
        try {
            const fetchUrl = inElectron
                ? targetUrl  // Electron 无 CORS 限制，直接 fetch
                : `/api/image-proxy?url=${encodeURIComponent(targetUrl)}`;
            const response = await fetch(fetchUrl);
            if (response.ok) {
                const blob = await response.blob();
                if (blob.size > 100 && blob.type.startsWith('image/')) {
                    return { blob, mimeType: blob.type };
                }
            }
        } catch (e) {
            // 本地代理不可用（可能是生产环境），继续走外部代理
        }
        return null;
    };

    // Gyazo URL 强制走本地代理（不再绕 weserv.nl）
    const gyazoMatch = url.match(/https:\/\/i\.gyazo\.com\/([a-f0-9]+)\.(png|jpg|gif)/i);

    if (gyazoMatch) {
        const gyazoId = gyazoMatch[1];
        const extensions = ['jpg', 'png', 'gif'];

        // 先尝试本地代理（最快最可靠）
        for (const ext of extensions) {
            const directUrl = `https://i.gyazo.com/${gyazoId}.${ext}`;
            const result = await tryLocalProxy(directUrl);
            if (result) return result;
        }

        // 本地代理不可用时回退到 weserv.nl
        for (const ext of extensions) {
            const directUrlNoProtocol = `i.gyazo.com/${gyazoId}.${ext}`;
            const weservUrl = `https://images.weserv.nl/?url=${encodeURIComponent(directUrlNoProtocol)}&output=jpg&q=100`;

            try {
                const response = await fetch(weservUrl);
                if (response.ok) {
                    const blob = await response.blob();
                    if (blob.size > 100 && blob.type.startsWith('image/')) {
                        return { blob, mimeType: blob.type };
                    }
                }
            } catch (e) {
                // 继续尝试下一个格式
            }
        }
        console.warn('[fetchImageBlob] Gyazo: all methods failed, trying general proxies...');
    }

    // 非 Gyazo URL 也优先尝试本地代理
    const localResult = await tryLocalProxy(url);
    if (localResult) return localResult;

    const encodedUrl = encodeURIComponent(url);
    const stripped = stripProtocol(url);

    // 各种代理 URL
    const weservUrl = `https://images.weserv.nl/?url=${encodeURIComponent(stripped)}&output=jpg&q=100&we=1`;
    const weservUrlDirect = `https://images.weserv.nl/?url=${encodedUrl}&output=jpg&q=100`;
    const gadgetProxy = `https://images1-focus-opensocial.googleusercontent.com/gadgets/proxy?container=focus&refresh=86400&url=${encodedUrl}`;
    const allOriginsProxy = `https://api.allorigins.win/raw?url=${encodedUrl}`;
    const corsProxy = `https://corsproxy.io/?${encodedUrl}`;
    const wpProxy = stripped ? `https://i0.wp.com/${stripped}` : null;
    // 额外的代理选项
    const corsAnywhereProxy = `https://cors-anywhere.herokuapp.com/${url}`;
    const thingProxyUrl = `https://thingproxy.freeboard.io/fetch/${url}`;

    // 针对 Facebook CDN 的特殊处理 - 优先使用 weserv
    const isFb = isFacebookCdn(url);

    // Build candidate list. For domains that often block hotlink (fbcdn/scontent), try proxies first.
    let candidates: string[];
    if (isFb) {
        // Facebook CDN 专用代理顺序
        candidates = [
            weservUrl,
            weservUrlDirect,
            gadgetProxy,
            thingProxyUrl,
            allOriginsProxy,
            corsProxy,
            wpProxy
        ].filter(Boolean) as string[];
    } else if (isLikelyHotlinkBlocked(url)) {
        candidates = [
            weservUrl,
            gadgetProxy,
            wpProxy,
            url,
            allOriginsProxy,
            corsProxy
        ].filter(Boolean) as string[];
    } else {
        candidates = [
            url,
            weservUrl,
            gadgetProxy,
            allOriginsProxy,
            corsProxy,
            wpProxy
        ].filter(Boolean) as string[];
    }

    // 去重
    candidates = Array.from(new Set(candidates));

    const attemptFetch = async (fetchUrl: string, options?: RequestInit) => {
        const response = await fetch(fetchUrl, options);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const blob = await response.blob();
        // Validate it's actually an image
        if (blob.type.startsWith('text/') || blob.type.includes('html')) {
            throw new Error("Invalid image content (Received HTML/Text)");
        }
        // 也检查 blob 大小，太小的可能是错误响应
        if (blob.size < 100) {
            throw new Error("Image too small, likely an error response");
        }
        return blob;
    };

    const isGoogle = url.includes('google.com') || url.includes('googleusercontent.com');
    const errors: { url: string; error: any }[] = [];

    // 尝试使用 img 标签 + canvas 加载图片
    const tryLoadViaImage = async (imageUrl: string, useCors: boolean = false): Promise<Blob> => {
        return new Promise((resolve, reject) => {
            const img = new Image();
            // 不使用 crossOrigin 时可以加载图片但无法通过 canvas 读取（会 taint）
            // 使用 crossOrigin = 'anonymous' 时需要服务器配合返回 CORS 头
            if (useCors) {
                img.crossOrigin = 'anonymous';
            }

            const timeout = setTimeout(() => {
                reject(new Error('Image load timeout'));
            }, 15000);  // 15秒超时

            img.onload = () => {
                clearTimeout(timeout);
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    if (!ctx) {
                        reject(new Error('Canvas context failed'));
                        return;
                    }
                    ctx.drawImage(img, 0, 0);
                    // 尝试读取 canvas 数据（如果图片被 tainted 会抛错）
                    canvas.toBlob(blob => {
                        if (blob && blob.size > 100) {
                            resolve(blob);
                        } else {
                            reject(new Error('Canvas toBlob failed or image too small'));
                        }
                    }, 'image/jpeg', 0.95);
                } catch (e) {
                    reject(e);
                }
            };

            img.onerror = () => {
                clearTimeout(timeout);
                reject(new Error('Image load error'));
            };

            img.src = imageUrl;
        });
    };

    // 对于 Facebook CDN，先尝试 img 标签方式（用户浏览器可能有 session）
    if (isFb) {
        try {
            const blob = await tryLoadViaImage(url);
            return { blob, mimeType: 'image/jpeg' };
        } catch (imgError) {
            errors.push({ url: `[img+canvas] ${url}`, error: imgError });
        }

        // 然后尝试直接 fetch
        try {
            const blob = await attemptFetch(url);
            return { blob, mimeType: blob.type };
        } catch (directError) {
            errors.push({ url: `[direct] ${url}`, error: directError });
        }
    }

    for (const candidate of candidates) {
        try {
            const blob = await attemptFetch(candidate);
            return { blob, mimeType: blob.type };
        } catch (error) {
            errors.push({ url: candidate, error });
        }
    }

    console.warn('All image fetch attempts failed', { url, errors });
    let msg = "图片无法下载。请检查链接是否有效。";
    if (isFb) {
        msg = "Facebook 图片无法下载。这类链接通常有时效限制，建议：\\n1. 先在浏览器中打开图片链接\\n2. 右键保存图片到本地\\n3. 然后通过上传文件的方式添加";
    } else if (isGoogle) {
        msg += " 注意：Google Drive 图片权限必须设为公开，或尝试使用 direct link。";
    }
    throw new Error(msg);
};
