/**
 * Gyazo 图床上传服务
 * 用于将图片上传到 Gyazo 获取永久链接
 */

// 默认 Gyazo Token（与 AI 图片识别工具共用）
const DEFAULT_GYAZO_TOKEN = 'W0SHYCmn38FEoNQEdu7GwT1bOJP84TjQadGjlSgbG6I';

// 获取 Gyazo Access Token（优先从 localStorage，否则使用默认）
export const getGyazoToken = (): string => {
    return localStorage.getItem('gyazo_access_token') || DEFAULT_GYAZO_TOKEN;
};

// 将 base64 数据转换为 File 对象
export const base64ToFile = (base64Data: string, filename: string = 'image.png'): File | null => {
    try {
        // 检查是否是有效的 data URL
        if (!base64Data || typeof base64Data !== 'string') {
            console.error('[gyazoService] Invalid base64 data: empty or not a string',
                '\nFilename:', filename,
                '\nType:', typeof base64Data,
                '\nData:', base64Data?.substring?.(0, 100) || 'null/undefined');
            console.trace('[gyazoService] Stack trace:');
            return null;
        }

        console.log('[gyazoService] base64 data length:', base64Data.length, 'starts with:', base64Data.substring(0, 50));

        // 检查并提取 base64 内容
        let base64Content: string;
        let mimeType = 'image/png';

        if (base64Data.startsWith('data:')) {
            // 使用 split 更稳健地提取
            const commaIndex = base64Data.indexOf(',');
            if (commaIndex === -1) {
                console.error('[gyazoService] Invalid data URL format: no comma found');
                return null;
            }

            const header = base64Data.substring(0, commaIndex);
            base64Content = base64Data.substring(commaIndex + 1);

            // 提取 MIME 类型
            const mimeMatch = header.match(/data:(image\/[^;]+)/);
            if (mimeMatch) {
                mimeType = mimeMatch[1];
            }
        } else {
            // 假设是纯 base64 字符串
            base64Content = base64Data;
        }

        // 移除可能的空白字符
        base64Content = base64Content.replace(/\s/g, '');

        // 验证 base64 字符串格式（简化检查）
        if (base64Content.length === 0) {
            console.error('[gyazoService] Empty base64 content after extraction',
                '\nFilename:', filename,
                '\nOriginal data starts with:', base64Data.substring(0, 100));
            console.trace('[gyazoService] Stack trace:');
            return null;
        }

        console.log('[gyazoService] Extracted base64 content length:', base64Content.length);

        const byteCharacters = atob(base64Content);
        const byteNumbers = new Array(byteCharacters.length);

        for (let i = 0; i < byteCharacters.length; i++) {
            byteNumbers[i] = byteCharacters.charCodeAt(i);
        }

        const byteArray = new Uint8Array(byteNumbers);
        console.log('[gyazoService] Created file, size:', byteArray.length, 'bytes');
        return new File([byteArray], filename, { type: mimeType });
    } catch (error) {
        console.error('[gyazoService] base64ToFile error:', error);
        return null;
    }
};

// 上传图片到 Gyazo
export const uploadToGyazo = async (file: File, token: string): Promise<string | null> => {
    const formData = new FormData();
    formData.append('access_token', token);
    formData.append('imagedata', file);

    try {
        const res = await fetch('https://upload.gyazo.com/api/upload', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            console.error(`[gyazoService] Upload failed: ${res.status} ${res.statusText}`);
            return null;
        }

        const json = await res.json();
        // Gyazo 返回的是分享页面链接，需要转换为直接图片链接
        const shareUrl = json.url || json.permalink_url;
        if (shareUrl) {
            // 将 https://gyazo.com/xxx 转换为 https://i.gyazo.com/xxx.png
            const match = shareUrl.match(/gyazo\.com\/([a-f0-9]+)/i);
            if (match) {
                return `https://i.gyazo.com/${match[1]}.png`;
            }
            return shareUrl;
        }
        return null;
    } catch (error) {
        console.error('[gyazoService] Upload error:', error);
        return null;
    }
};

// 上传 base64 图片到 Gyazo
export const uploadBase64ToGyazo = async (
    base64Data: string,
    filename: string = 'image.png'
): Promise<string | null> => {
    const token = getGyazoToken();
    if (!token) {
        console.warn('[gyazoService] No Gyazo token found');
        return null;
    }

    const file = base64ToFile(base64Data, filename);
    if (!file) {
        console.error('[gyazoService] Failed to convert base64 to file');
        return null;
    }

    return uploadToGyazo(file, token);
};

/**
 * 上传图片到 Gyazo 并返回分享页面链接（非直链）
 * 返回 https://gyazo.com/xxx 格式的链接，可以直接在浏览器打开
 */
export const uploadToGyazoAndGetShareUrl = async (file: File, token: string): Promise<string | null> => {
    const formData = new FormData();
    formData.append('access_token', token);
    formData.append('imagedata', file);

    try {
        console.log(`[gyazoService] Uploading file: ${file.name}, size: ${(file.size / 1024 / 1024).toFixed(2)}MB`);

        const res = await fetch('https://upload.gyazo.com/api/upload', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) {
            const errorText = await res.text().catch(() => '');
            console.error(`[gyazoService] Upload failed: ${res.status} ${res.statusText}`, errorText);
            // 常见错误码
            if (res.status === 401) {
                console.error('[gyazoService] Token 无效或已过期');
            } else if (res.status === 413) {
                console.error('[gyazoService] 图片太大，超过 Gyazo 限制');
            } else if (res.status === 429) {
                console.error('[gyazoService] 请求过于频繁，请稍后再试');
            }
            return null;
        }

        const json = await res.json();
        console.log('[gyazoService] Upload success:', json.url || json.permalink_url);
        // 返回分享页面链接
        return json.url || json.permalink_url || null;
    } catch (error) {
        console.error('[gyazoService] Upload error:', error);
        if (error instanceof TypeError && error.message.includes('fetch')) {
            console.error('[gyazoService] 网络连接失败，请检查网络');
        }
        return null;
    }
};

/**
 * 上传 base64 图片到 Gyazo 获取分享链接
 */
export const uploadBase64ToGyazoShareUrl = async (
    base64Data: string,
    filename: string = 'report.png'
): Promise<string | null> => {
    const token = getGyazoToken();
    if (!token) {
        console.warn('[gyazoService] No Gyazo token found. Please set gyazo_access_token in localStorage.');
        return null;
    }

    const file = base64ToFile(base64Data, filename);
    if (!file) {
        console.error('[gyazoService] Failed to convert base64 to file');
        return null;
    }

    return uploadToGyazoAndGetShareUrl(file, token);
};

/**
 * 使用 TinyURL 缩短链接
 */
export const shortenUrl = async (longUrl: string): Promise<string> => {
    try {
        // 使用 TinyURL 的免费 API
        const response = await fetch(`https://tinyurl.com/api-create.php?url=${encodeURIComponent(longUrl)}`);
        if (response.ok) {
            const shortUrl = await response.text();
            if (shortUrl.startsWith('http')) {
                return shortUrl;
            }
        }
    } catch (error) {
        console.warn('[gyazoService] URL shortening failed:', error);
    }
    // 如果缩短失败，返回原链接
    return longUrl;
};

/**
 * 上传 base64 图片到 Gyazo 并返回缩短后的分享链接
 */
export const uploadBase64ToGyazoAndShorten = async (
    base64Data: string,
    filename: string = 'report.png'
): Promise<string | null> => {
    const shareUrl = await uploadBase64ToGyazoShareUrl(base64Data, filename);
    if (shareUrl) {
        return shortenUrl(shareUrl);
    }
    return null;
};
