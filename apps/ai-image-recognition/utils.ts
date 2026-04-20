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
    // [调试挂钩] 发送原始 URL 到我们的 proxy 后台看一下格式
    try { if (typeof window !== 'undefined') fetch(`/api/image-proxy?url=RAW_URL_LOG:${encodeURIComponent(url)}`).catch(() => null); } catch (e) { }


    try {
        const urlObj = new URL(url);

        // 1. Handle Gyazo Share Page Links
        // Converts https://gyazo.com/ID to https://i.gyazo.com/ID.{ext}
        // Gyazo images can be png, jpg, or gif - default to png.
        if (urlObj.hostname === 'gyazo.com' && urlObj.pathname.length > 1) {
            const gyazoId = urlObj.pathname.slice(1).split('/')[0];  // 去除开头的 / 并获取 ID
            if (gyazoId && /^[a-f0-9]+$/i.test(gyazoId)) {
                // fetchImageBlob 会负责重试其他格式
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
        if (urlObj.hostname === 'drive.google.com') {
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
        if (urlObj.hostname.endsWith('.googleusercontent.com') || urlObj.hostname === 'googleusercontent.com') {
            // Google Sheets copied images usually have =w100-h125 or =s120 in the pathname.
            // Replace this with =s0 to fetch the original full-resolution image.
            urlObj.pathname = urlObj.pathname.replace(/=[wshd]\d+.*$/i, '=s0');

            // Also clean query params if they restrict size (though less common for these hosts)
            if (urlObj.searchParams.has('sz')) urlObj.searchParams.set('sz', 's0');
            urlObj.searchParams.delete('w');
            urlObj.searchParams.delete('h');
            return urlObj.toString();
        }

        // 5. Handle Google Docs/Sheets internal image URLs
        if (urlObj.hostname === 'docs.google.com' && urlObj.pathname.includes('/image')) {
            // These URLs limit dimensions via query parameters (e.g. ?w=100&h=120)
            urlObj.searchParams.delete('w');
            urlObj.searchParams.delete('h');
            return urlObj.toString();
        }

    } catch (e) {
        console.warn("Failed to process image URL", e);
    }
    return url;
};

// 解码 HTML 实体（如 &amp; -> &）
// 使用 textarea 安全解码所有 HTML 实体（textarea.value 不会执行任何脚本）
export const decodeHtmlEntities = (text: string): string => {
    if (!text || !text.includes('&')) return text;
    const textarea = document.createElement('textarea');
    textarea.innerHTML = text;
    const decoded = textarea.value;
    textarea.remove();
    return decoded;
};

const collectUrlsFromString = (text: string): string[] => {
    if (!text) return [];
    const urls: string[] = [];

    const addUrl = (raw: string) => {
        const decoded = decodeHtmlEntities(String(raw || '').trim());
        if (!decoded) return;
        if (!/^https?:\/\//i.test(decoded)) return;
        urls.push(decoded);
    };

    // =IMAGE(HYPERLINK("url", ...), ...)
    const imageHyperlinkRegex = /=IMAGE\s*\(\s*HYPERLINK\s*\(\s*(?:"([^"]+)"|'([^']+)'|([^,\)\s]+))/gi;
    for (const m of text.matchAll(imageHyperlinkRegex)) {
        addUrl(m[1] || m[2] || m[3] || '');
    }

    // =IMAGE("url", ...), =IMAGE('url', ...), =IMAGE(url, ...)
    const imageFormulaRegex = /=IMAGE\s*\(\s*(?:"([^"]+)"|'([^']+)'|([^,\)\s]+))/gi;
    for (const m of text.matchAll(imageFormulaRegex)) {
        addUrl(m[1] || m[2] || m[3] || '');
    }

    // Plain URL in arbitrary text
    const urlRegex = /https?:\/\/[^\s"'<>\\]+/gi;
    for (const m of text.matchAll(urlRegex)) {
        addUrl(m[0]);
    }

    return urls;
};

// Extract Image URLs from HTML (for Google Sheets support)
// Returns both the original URL (for formula reconstruction) and the processed URL (for fetching)
export const extractUrlsFromHtml = (html: string): { originalUrl: string; fetchUrl: string }[] => {
    try {
        const formulaResults: { originalUrl: string; fetchUrl: string }[] = [];
        const imgResults: { originalUrl: string; fetchUrl: string }[] = [];

        // Prefer Google Sheets' data attrs over <img src> thumbnail URLs.
        if (typeof DOMParser !== 'undefined') {
            const doc = new DOMParser().parseFromString(html, 'text/html');

            doc.querySelectorAll('[data-sheets-formula]').forEach((el) => {
                const formula = decodeHtmlEntities(el.getAttribute('data-sheets-formula') || '');
                for (const url of collectUrlsFromString(formula)) {
                    formulaResults.push({
                        originalUrl: url,
                        fetchUrl: processImageUrl(url),
                    });
                }
            });

            doc.querySelectorAll('[data-sheets-value]').forEach((el) => {
                const raw = decodeHtmlEntities(el.getAttribute('data-sheets-value') || '');
                if (!raw) return;
                try {
                    const parsed = JSON.parse(raw);
                    const scan = (value: unknown) => {
                        if (typeof value === 'string') {
                            for (const url of collectUrlsFromString(value)) {
                                formulaResults.push({
                                    originalUrl: url,
                                    fetchUrl: processImageUrl(url),
                                });
                            }
                            return;
                        }
                        if (Array.isArray(value)) {
                            value.forEach(scan);
                            return;
                        }
                        if (value && typeof value === 'object') {
                            Object.values(value as Record<string, unknown>).forEach(scan);
                        }
                    };
                    scan(parsed);
                } catch {
                    for (const url of collectUrlsFromString(raw)) {
                        formulaResults.push({
                            originalUrl: url,
                            fetchUrl: processImageUrl(url),
                        });
                    }
                }
            });

            doc.querySelectorAll('img[src]').forEach((img) => {
                const src = img.getAttribute('src') || '';
                const decodedUrl = decodeHtmlEntities(src);
                if (!decodedUrl) return;
                imgResults.push({
                    originalUrl: decodedUrl,
                    fetchUrl: processImageUrl(decodedUrl),
                });
            });
        } else {
            const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
            let match;
            while ((match = imgRegex.exec(html)) !== null) {
                const decodedUrl = decodeHtmlEntities(match[1]);
                imgResults.push({
                    originalUrl: decodedUrl,
                    fetchUrl: processImageUrl(decodedUrl)
                });
            }
        }

        if (formulaResults.length > 0) return formulaResults;
        return imgResults;
    } catch (e) {
        console.error("Error parsing HTML for images:", e);
        return [];
    }
};



export const parsePasteInput = (text: string): { type: 'url' | 'formula'; content: string; url: string }[] => {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    const results: { type: 'url' | 'formula'; content: string; url: string }[] = [];

    // Regex for =IMAGE(url, ...) - supports quoted/unquoted first arg and extra params
    const formulaRegex = /=IMAGE\s*\(\s*(?:"([^"]+)"|'([^']+)'|([^,\)\s]+))/gi;
    // Loose Regex for URL - looks for http/https at the start of a string or after a space
    const urlRegex = /https?:\/\/[^\s\t]+/g;

    for (const line of lines) {
        // Split by tab to handle Google Sheets multi-column paste
        const cells = line.split('\t');
        for (const cell of cells) {
            const trimmed = cell.trim();
            if (!trimmed) continue;

            // Check for formula(s) first - use matchAll to catch multiple in one cell
            formulaRegex.lastIndex = 0;
            const formulaMatches = [...trimmed.matchAll(formulaRegex)];
            if (formulaMatches.length > 0) {
                for (const match of formulaMatches) {
                    const rawUrl = decodeHtmlEntities(match[1] || match[2] || match[3] || '');
                    if (!rawUrl) continue;
                    results.push({
                        type: 'formula',
                        content: match[0],
                        url: processImageUrl(rawUrl)
                    });
                }
                continue;
            }

            // Check for URL(s)
            urlRegex.lastIndex = 0;
            const urlMatches = [...trimmed.matchAll(urlRegex)];
            for (const match of urlMatches) {
                const rawUrl = decodeHtmlEntities(match[0]);
                results.push({
                    type: 'url',
                    content: trimmed,
                    url: processImageUrl(rawUrl)
                });
            }
        }
    }

    return results;
};

// 提取横向多维大表（矩阵模式）：同一列下，以图片为锚点，其下方的格子为它的附属 metadata
export const parseMatrixHtmlTable = (html: string): { originalUrl: string; fetchUrl: string; matrixColumnIndex: number; metadataRows: string[] }[] => {
    try {
        if (typeof DOMParser === 'undefined') return [];
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const tables = Array.from(doc.querySelectorAll('table'));
        if (tables.length === 0) return [];
        
        const results: { originalUrl: string; fetchUrl: string; matrixColumnIndex: number; metadataRows: string[] }[] = [];

        for (const table of tables) {
            const rows = Array.from(table.querySelectorAll('tr'));
            const grid: HTMLTableCellElement[][] = rows.map(tr => Array.from(tr.querySelectorAll('td, th')));
            if (grid.length === 0) continue;

            const maxCols = Math.max(...grid.map(row => row.length));

            for (let c = 0; c < maxCols; c++) {
                // 1. Identify all rows in this column that contain an anchor (image)
                const imgIndices: number[] = [];
                const anchorUrls: string[] = [];

                for (let r = 0; r < grid.length; r++) {
                    const cell = grid[r][c];
                    let anchorUrl = '';
                    if (cell) {
                        const img = cell.querySelector('img');
                        if (img && img.getAttribute('src')) {
                            anchorUrl = decodeHtmlEntities(img.getAttribute('src') || '');
                        } else {
                            const f = cell.getAttribute('data-sheets-formula');
                            if (f && f.includes('IMAGE(')) {
                                const urls = collectUrlsFromString(decodeHtmlEntities(f));
                                if (urls.length > 0) anchorUrl = urls[0];
                            }
                        }
                    }
                    if (anchorUrl) {
                        imgIndices.push(r);
                        anchorUrls.push(anchorUrl);
                    }
                }

                if (imgIndices.length === 0) continue;

                // 2. Determine layout pattern for this column
                // If the last row is an image and the first is not, it is likely an "Image at Bottom" pattern
                let isBottomPattern = false;
                if (imgIndices[imgIndices.length - 1] === grid.length - 1 && imgIndices[0] !== 0) {
                    isBottomPattern = true;
                }

                // 3. Extract metadata according to the pattern
                for (let i = 0; i < imgIndices.length; i++) {
                    const rAnchor = imgIndices[i];
                    const anchorUrl = anchorUrls[i];
                    const prevAnchor = i > 0 ? imgIndices[i - 1] : -1;
                    const nextAnchor = i < imgIndices.length - 1 ? imgIndices[i + 1] : grid.length;

                    const metadataRows: string[] = [];
                    
                    if (isBottomPattern) {
                        // Gather rows STRICTLY ABOVE the image
                        for (let z = prevAnchor + 1; z < rAnchor; z++) {
                            const metaCell = grid[z][c];
                            metadataRows.push(metaCell ? (metaCell.textContent || '').trim() : '');
                        }
                    } else {
                        // Top pattern: Gather rows STRICTLY BELOW the image
                        // For the very first image, also gather any loose heading rows ABOVE it
                        if (i === 0) {
                            for (let z = 0; z < rAnchor; z++) {
                                const metaCell = grid[z][c];
                                metadataRows.push(metaCell ? (metaCell.textContent || '').trim() : '');
                            }
                        }
                        for (let z = rAnchor + 1; z < nextAnchor; z++) {
                            const metaCell = grid[z][c];
                            metadataRows.push(metaCell ? (metaCell.textContent || '').trim() : '');
                        }
                    }

                    results.push({
                        originalUrl: anchorUrl,
                        fetchUrl: processImageUrl(anchorUrl),
                        matrixColumnIndex: c,
                        metadataRows
                    });
                }
            }
        }
        return results;
    } catch (e) {
        console.error("Error parsing html for matrix extraction:", e);
        return [];
    }
};

// 按表格行分组：同一 <tr> 内的图片归为一组（一张卡片）
export const extractUrlsFromHtmlGrouped = (html: string): { originalUrl: string; fetchUrl: string }[][] => {
    try {
        const imgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
        const trRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;

        // Try table row structure first
        const trMatches = [...html.matchAll(trRegex)];
        if (trMatches.length > 0) {
            const groups: { originalUrl: string; fetchUrl: string }[][] = [];
            for (const trMatch of trMatches) {
                const rowHtml = trMatch[1];
                const group: { originalUrl: string; fetchUrl: string }[] = [];
                let imgMatch;
                const rowImgRegex = /<img[^>]+src=["']([^"']+)["'][^>]*>/gi;
                while ((imgMatch = rowImgRegex.exec(rowHtml)) !== null) {
                    const decodedUrl = decodeHtmlEntities(imgMatch[1]);
                    group.push({ originalUrl: decodedUrl, fetchUrl: processImageUrl(decodedUrl) });
                }
                if (group.length > 0) groups.push(group);
            }
            if (groups.length > 0) return groups;
        }

        // No table structure, each image is its own group
        const groups: { originalUrl: string; fetchUrl: string }[][] = [];
        let match;
        while ((match = imgRegex.exec(html)) !== null) {
            const decodedUrl = decodeHtmlEntities(match[1]);
            groups.push([{ originalUrl: decodedUrl, fetchUrl: processImageUrl(decodedUrl) }]);
        }
        return groups;
    } catch (e) {
        console.error("Error parsing HTML for grouped images:", e);
        return [];
    }
};

// 分组版：同一行（tab分隔）的多个公式/URL 归为一组（一张卡片）
// 每组第一个 = 主图，其余 = 融合图
export type PasteItem = { type: 'url' | 'formula'; content: string; url: string };
export type PasteGroup = PasteItem[]; // 一组 = 一张卡片

export const parsePasteInputGrouped = (text: string): PasteGroup[] => {
    const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
    const groups: PasteGroup[] = [];

    const formulaRegex = /=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/gi;
    const singleFormulaRegex = /=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i;
    const urlRegex = /https?:\/\/[^\s\t]+/g;

    for (const line of lines) {
        const trimmed = line.trim();
        const group: PasteGroup = [];

        // 检查是否包含 tab（谷歌表格同行多列）
        if (trimmed.includes('\t')) {
            const cells = trimmed.split('\t');
            for (const cell of cells) {
                const c = cell.trim();
                if (!c) continue;
                const fm = c.match(singleFormulaRegex);
                if (fm) {
                    const rawUrl = decodeHtmlEntities(fm[1]);
                    group.push({ type: 'formula', content: c, url: processImageUrl(rawUrl) });
                } else {
                    const um = c.match(/https?:\/\/[^\s]+/);
                    if (um) {
                        const rawUrl = decodeHtmlEntities(um[0]);
                        group.push({ type: 'url', content: c, url: processImageUrl(rawUrl) });
                    }
                }
            }
        } else {
            // 单列：检查一行是否有多个 =IMAGE()
            const allFormulas = [...trimmed.matchAll(formulaRegex)];
            if (allFormulas.length > 0) {
                for (const fm of allFormulas) {
                    const rawUrl = decodeHtmlEntities(fm[1]);
                    group.push({ type: 'formula', content: fm[0], url: processImageUrl(rawUrl) });
                }
            } else {
                // 检查 URL
                const allUrls = [...trimmed.matchAll(urlRegex)];
                for (const um of allUrls) {
                    const rawUrl = decodeHtmlEntities(um[0]);
                    group.push({ type: 'url', content: um[0], url: processImageUrl(rawUrl) });
                }
            }
        }

        if (group.length > 0) groups.push(group);
    }

    return groups;
};

// Helper to fetch external image and convert to Blob (Handles CORS errors gracefully by trying a proxy)
export const fetchImageBlob = async (url: string): Promise<{ blob: Blob; mimeType: string }> => {
    // 优先尝试本地代理（Vite dev server 或 Electron 本地服务器）
    const inElectron = !!(window as any).electronCache?.isElectron;

    const tryLocalProxy = async (targetUrl: string): Promise<{ blob: Blob; mimeType: string } | null> => {
        const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(targetUrl)}`;
        try {
            const response = await fetch(proxyUrl);
            if (response.ok) {
                const blob = await response.blob();
                // Some upstreams return application/octet-stream for valid images.
                // Only reject clear non-image responses.
                let type = (blob.type || '').toLowerCase();
                
                // --- 核心优化：Magic Numbers 魔数探测 ---
                // 解决 Google Drive 返回 application/octet-stream 导致无法区分图视的问题
                if (!type || type === 'application/octet-stream') {
                    const headerBuffer = await blob.slice(0, 16).arrayBuffer();
                    const header = new Uint8Array(headerBuffer);
                    
                    // 常见的视频头探测
                    const isMp4 = header[4] === 0x66 && header[5] === 0x74 && header[6] === 0x79 && header[7] === 0x70; // 'ftyp'
                    const isWebm = header[0] === 0x1A && header[1] === 0x45 && header[2] === 0xDF && header[3] === 0xA3; // EBML
                    const isMov = header[4] === 0x6d && header[5] === 0x6f && header[6] === 0x6f && header[7] === 0x76; // 'moov'
                    
                    // 常见的图片头探测
                    const isPng = header[0] === 0x89 && header[1] === 0x50 && header[2] === 0x4E && header[3] === 0x47;
                    const isJpg = header[0] === 0xFF && header[1] === 0xD8 && header[2] === 0xFF;
                    const isGif = header[0] === 0x47 && header[1] === 0x49 && header[2] === 0x46;

                    if (isMp4 || isWebm || isMov) {
                        type = 'video/mp4'; // 强制修正为视频
                    } else if (isPng) {
                        type = 'image/png';
                    } else if (isJpg) {
                        type = 'image/jpeg';
                    } else if (isGif) {
                        type = 'image/gif';
                    }
                }

                const looksInvalidText = type.startsWith('text/') || type.includes('html') || type.includes('xml') || type.includes('json');
                if (blob.size > 100 && !looksInvalidText) {
                    return { blob, mimeType: type };
                }
            }
        } catch (e) {
            // 本地代理不可用（可能是生产环境），继续走外部代理
        }

        // Electron 下再尝试直连（某些公开 CDN 可直接读）
        if (inElectron) {
            try {
                const response = await fetch(targetUrl);
                if (response.ok) {
                    const blob = await response.blob();
                    const type = (blob.type || '').toLowerCase();
                    const looksInvalidText = type.startsWith('text/') || type.includes('html') || type.includes('xml') || type.includes('json');
                    if (blob.size > 100 && !looksInvalidText) {
                        return { blob, mimeType: blob.type };
                    }
                }
            } catch (e) {
                // ignore and continue with fallback proxies below
            }
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

    const isGoogle = (() => { try { const h = new URL(url).hostname; return h.endsWith('.google.com') || h === 'google.com' || h.endsWith('.googleusercontent.com'); } catch { return false; } })();
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
