/**
 * ImageFormulaPanel - 图片/视频链接转 Google Sheets IMAGE() 公式工具
 * 
 * 功能：
 * 1. 输入多个图片/Drive视频链接（每行一个或逗号/空格分隔）
 * 2. 生成 =IMAGE("url") 公式（Drive视频自动转为缩略图端点）
 * 3. 横版排列显示：第一行原始链接，第二行缩略图预览
 * 4. 可配置每行显示几个
 * 5. 复制后直接粘贴到 Google Sheets
 * 6. 【文件夹扫描】给定 Google Drive 文件夹链接，递归提取所有视频文件
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import {
    Image,
    Copy,
    Check,
    Trash2,
    Settings,
    Link2,
    Grid,
    ArrowDown,
    ArrowRight,
    ArrowLeft,
    ChevronDown,
    ChevronUp,
    Plus,
    X,
    Eye,
    EyeOff,
    Download,
    Clipboard,
    Sparkles,
    Columns,
    Rows,
    AlertCircle,
    ExternalLink,
    FolderOpen,
    Key,
    Loader2,
    Film,
    Search,
    ChevronRight,
    MessageSquarePlus,
    PenLine,
    Upload,
    LayoutGrid,
} from 'lucide-react';
import AnnotationEditor from './AnnotationEditor';
import ReviewCanvasView from './ReviewCanvasView';
import FeedbackModal from './FeedbackModal';
import { FeedbackPreviewModal } from './gallery/FeedbackPreviewModal';

interface ImageFormulaProps {
    onBack?: () => void;
}

interface ParsedImage {
    id: string;
    originalUrl: string;
    /** Original pasted link cell content (keeps hyperlink formula when available) */
    originalPasted: string;
    /** URL used in the =IMAGE() formula (may differ from original for Drive links) */
    imageUrl: string;
    /** URL used for browser preview (may differ for Drive — uses thumbnail endpoint) */
    previewUrl: string;
    /** Fallback preview URLs (tried in order when loading fails) */
    previewUrls?: string[];
    formula: string;
    isValid: boolean;
    /** Whether the URL was auto-converted from a Google Drive link */
    isGoogleDrive: boolean;
    /** Extracted Google Drive file ID, if any */
    driveFileId?: string;
    /** Why Drive URL cannot be converted/rendered (if known) */
    driveIssue?: string;
    /** Whether this is a video file (detected via Drive API mimeType) */
    isVideo?: boolean;
    /** Text info from the first column when pasting multi-column data */
    infoText?: string;
}

/** Column toggle options for feedback export */
interface FeedbackColumnOptions {
    infoText: boolean;         // 信息列
    linkColumn: boolean;       // 链接列
    rawPasted: boolean;        // 原始粘贴列（保留超链接公式）
    sourceImage: boolean;      // 原图预览
    annotatedImage: boolean;   // 标注图片（实际图片）
    reviewer: boolean;         // 反馈人
    severity: boolean;         // 严重程度
    annotationLink: boolean;   // 标注链接
    annotationFormula: boolean; // 标注公式
    feedbackText: boolean;     // 文字建议
}

type FeedbackColumnKey = keyof FeedbackColumnOptions | 'status';

const FEEDBACK_COLUMN_ORDER_STORAGE = 'sheetmind_feedback_column_order';
const FEEDBACK_COLUMN_DEFAULT_ORDER: FeedbackColumnKey[] = [
    'infoText',
    'linkColumn',
    'rawPasted',
    'sourceImage',
    'reviewer',
    'status',
    'severity',
    'feedbackText',
    'annotationLink',
    'annotationFormula',
    'annotatedImage',
];

const FEEDBACK_COLUMN_META: Record<FeedbackColumnKey, { label: string; icon: string; toggleable: boolean }> = {
    infoText: { label: '信息列', icon: '📋', toggleable: true },
    linkColumn: { label: '链接列', icon: '🔗', toggleable: true },
    rawPasted: { label: '原始粘贴', icon: '↩️', toggleable: true },
    sourceImage: { label: '原图预览', icon: '🌅', toggleable: true },
    annotatedImage: { label: '标注图片', icon: '🖼️', toggleable: true },
    reviewer: { label: '反馈人', icon: '👤', toggleable: true },
    status: { label: '状态', icon: '🏷️', toggleable: false },
    severity: { label: '严重程度', icon: '🚨', toggleable: true },
    annotationLink: { label: '标注链接', icon: '✂️', toggleable: true },
    annotationFormula: { label: '标注公式', icon: '📐', toggleable: true },
    feedbackText: { label: '文字建议', icon: '💬', toggleable: true },
};

const FEEDBACK_TOGGLE_KEYS: Array<keyof FeedbackColumnOptions> = FEEDBACK_COLUMN_DEFAULT_ORDER
    .filter((key): key is keyof FeedbackColumnOptions => key !== 'status');

function sanitizeFeedbackColumnOrder(input: unknown): FeedbackColumnKey[] {
    const known = new Set<FeedbackColumnKey>(FEEDBACK_COLUMN_DEFAULT_ORDER);
    const raw = Array.isArray(input) ? input : [];
    const out: FeedbackColumnKey[] = [];
    for (const item of raw) {
        if (typeof item !== 'string') continue;
        const key = item as FeedbackColumnKey;
        if (!known.has(key)) continue;
        if (out.includes(key)) continue;
        out.push(key);
    }

    // Force reset to the new default order if migrating from a version without severity,
    // because the requested sequence requires a complete re-ordering of existing columns.
    if (!out.includes('severity')) {
        return [...FEEDBACK_COLUMN_DEFAULT_ORDER];
    }

    for (const key of FEEDBACK_COLUMN_DEFAULT_ORDER) {
        if (!out.includes(key)) out.push(key);
    }
    return out;
}

type LayoutMode = 'horizontal' | 'vertical';

// ==================== Google Drive URL Conversion ====================

/**
 * Extract Google Drive file ID from various URL formats:
 * - https://drive.google.com/open?id=FILE_ID
 * - https://drive.google.com/open?id=FILE_ID&usp=drive_copy
 * - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 * - https://drive.google.com/file/d/FILE_ID/view
 * - https://drive.google.com/file/d/FILE_ID/edit
 * - https://drive.google.com/file/d/FILE_ID/preview
 * - https://drive.google.com/uc?id=FILE_ID
 * - https://drive.google.com/uc?id=FILE_ID&export=download
 * - https://drive.google.com/uc?export=view&id=FILE_ID
 * - https://drive.google.com/d/FILE_ID/...
 * - https://drive.google.com/thumbnail?id=FILE_ID&sz=w400
 * - https://lh3.googleusercontent.com/d/FILE_ID
 * - https://lh3.googleusercontent.com/d/FILE_ID=s220
 * - https://docs.google.com/uc?id=FILE_ID
 */
function extractGoogleDriveFileId(url: string): string | null {
    try {
        const parsed = new URL(url);
        const idFromQuery = parsed.searchParams.get('id');
        if (idFromQuery && /^[a-zA-Z0-9_-]{10,}$/.test(idFromQuery)) {
            return idFromQuery;
        }

        // Pattern 1: /file/d/FILE_ID/ or /d/FILE_ID/
        const pathMatch = url.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})/);
        if (pathMatch) return pathMatch[1];

        // Pattern 2: ?id=FILE_ID (covers open?id=, uc?id=, thumbnail?id=)
        const idParamMatch = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
        if (idParamMatch) return idParamMatch[1];

        // Pattern 3: lh3.googleusercontent.com/d/FILE_ID
        const lh3Match = url.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]{10,})/);
        if (lh3Match) return lh3Match[1];

        return null;
    } catch {
        return null;
    }
}

/**
 * Check if a URL is a Google Drive URL (any format)
 */
function isGoogleDriveUrl(url: string): boolean {
    return /drive\.google\.com|docs\.google\.com\/uc|lh3\.googleusercontent\.com\/d\//i.test(url);
}

function extractGoogleDriveResourceKey(url: string): string | undefined {
    try {
        const parsed = new URL(url);
        const key = parsed.searchParams.get('resourcekey');
        return key || undefined;
    } catch {
        return undefined;
    }
}

function isGoogleDriveFolderUrl(url: string): boolean {
    try {
        const parsed = new URL(url);
        return /\/drive\/folders\/[a-zA-Z0-9_-]+/.test(parsed.pathname);
    } catch {
        return false;
    }
}

function withResourceKey(url: string, resourceKey?: string): string {
    if (!resourceKey) return url;
    try {
        const parsed = new URL(url);
        if (!parsed.searchParams.get('resourcekey')) {
            parsed.searchParams.set('resourcekey', resourceKey);
        }
        return parsed.toString();
    } catch {
        return url;
    }
}

/**
 * Convert a Google Drive file ID to a direct image URL
 * for use in Google Sheets =IMAGE() formula.
 */
function driveIdToThumbnailUrl(fileId: string): string {
    return `https://lh3.googleusercontent.com/d/${fileId}`;
}

function driveIdToFormulaUrl(fileId: string, resourceKey?: string): string {
    return withResourceKey(`https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`, resourceKey);
}

/**
 * Build preview candidates for browser <img>. Some Drive links fail
 * intermittently on one endpoint, so keep multiple fallbacks.
 * Video files often only have thumbnails at smaller sizes.
 */
function driveIdToPreviewUrls(fileId: string, resourceKey?: string): string[] {
    const candidates = [
        // Google Drive video thumbnail — this is what Google Sheets uses
        `https://lh3.googleusercontent.com/d/${fileId}=w2000`,
        `https://lh3.googleusercontent.com/d/${fileId}=s2000`,
        `https://lh3.googleusercontent.com/d/${fileId}=w1600`,
        `https://lh3.googleusercontent.com/d/${fileId}=s1600`,
        `https://lh3.googleusercontent.com/d/${fileId}=w800`,
        `https://lh3.googleusercontent.com/d/${fileId}=s800`,
        `https://lh3.googleusercontent.com/d/${fileId}`,
        // Standard thumbnail endpoint (various sizes — small sizes work more often for videos)
        withResourceKey(`https://drive.google.com/thumbnail?id=${fileId}&sz=w2000`, resourceKey),
        withResourceKey(`https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`, resourceKey),
        withResourceKey(`https://drive.google.com/thumbnail?id=${fileId}&sz=w1200`, resourceKey),
        withResourceKey(`https://drive.google.com/thumbnail?id=${fileId}&sz=w320`, resourceKey),
        withResourceKey(`https://drive.google.com/thumbnail?id=${fileId}&sz=w400`, resourceKey),
        withResourceKey(`https://drive.google.com/thumbnail?id=${fileId}&sz=w800`, resourceKey),
        // Authenticated user endpoint
        `https://lh3.google.com/u/0/d/${fileId}=w1600-h1600-p-k-nu-iv1`,
        // Download-as-view fallbacks
        withResourceKey(`https://drive.usercontent.google.com/download?id=${fileId}&export=view`, resourceKey),
        withResourceKey(`https://drive.google.com/uc?export=view&id=${fileId}`, resourceKey),
    ];
    return Array.from(new Set(candidates));
}

// =================================================================

// ==================== Google Drive Folder Scan ====================

const VIDEO_MIME_TYPES = new Set([
    'video/mp4',
    'video/x-msvideo',
    'video/quicktime',
    'video/x-matroska',
    'video/webm',
    'video/x-flv',
    'video/mpeg',
    'video/3gpp',
    'video/x-ms-wmv',
    'video/ogg',
]);

const IMAGE_MIME_TYPES = new Set([
    'image/jpeg',
    'image/png',
    'image/gif',
    'image/webp',
    'image/bmp',
    'image/svg+xml',
    'image/tiff',
    'image/heic',
    'image/heif',
    'image/avif',
]);

const MEDIA_MIME_TYPES = new Set(Array.from(VIDEO_MIME_TYPES).concat(Array.from(IMAGE_MIME_TYPES)));

interface DriveFile {
    id: string;
    name: string;
    mimeType: string;
    /** Relative folder path from the scanned root folder (e.g. 'SubA/SubB') */
    folderPath?: string;
}

/** Extract Google Drive folder ID from folder URL */
function extractDriveFolderId(url: string): string | null {
    const m = url.match(/\/folders\/([a-zA-Z0-9_-]{10,})/);
    if (m) return m[1];
    // drive.google.com/open?id=xxx (if it's a folder)
    try {
        const parsed = new URL(url);
        const id = parsed.searchParams.get('id');
        if (id && /^[a-zA-Z0-9_-]{10,}$/.test(id)) return id;
    } catch { }
    return null;
}

/** Recursively list all media files (images + videos) inside a Drive folder (breadth-first).
 *  Each file's `folderPath` is the relative path from the root folder. */
async function listDriveMediaRecursive(
    folderId: string,
    apiKey: string,
    onProgress: (msg: string) => void,
    signal: AbortSignal,
): Promise<DriveFile[]> {
    const results: DriveFile[] = [];
    // Queue entries now include the relative folder path
    const queue: { id: string; path: string }[] = [{ id: folderId, path: '' }];
    let folderCount = 0;

    while (queue.length > 0) {
        if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
        const current = queue.shift()!;
        folderCount++;
        const pathLabel = current.path || '(根目录)';
        onProgress(`正在扫描第 ${folderCount} 个文件夹 [${pathLabel}]…`);

        let pageToken: string | undefined;
        do {
            if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
            const q = encodeURIComponent(`'${current.id}' in parents and trashed=false`);
            const fields = encodeURIComponent('nextPageToken,files(id,name,mimeType)');
            let url = `https://www.googleapis.com/drive/v3/files?q=${q}&fields=${fields}&pageSize=1000&key=${apiKey}`;
            if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;

            const res = await fetch(url, { signal });
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err?.error?.message || `HTTP ${res.status}`);
            }
            const data = await res.json();
            const files: DriveFile[] = data.files || [];

            for (const f of files) {
                if (f.mimeType === 'application/vnd.google-apps.folder') {
                    const childPath = current.path ? `${current.path}/${f.name}` : f.name;
                    queue.push({ id: f.id, path: childPath });
                } else if (MEDIA_MIME_TYPES.has(f.mimeType)) {
                    results.push({ ...f, folderPath: current.path || undefined });
                }
            }
            pageToken = data.nextPageToken;
        } while (pageToken);
    }
    return results;
}

// ===================================================================

const DRIVE_API_KEY_STORAGE = 'sheetmind_drive_api_key';
const GYAZO_TOKEN_STORAGE = 'sheetmind_gyazo_token';
const DEFAULT_GYAZO_TOKEN = 'W0SHYCmn38FEoNQEdu7GwT1bOJP84TjQadGjlSgbG6I';

// ==================== Gyazo Upload ====================

async function uploadToGyazo(dataUrl: string, token: string): Promise<{ url: string; permalinkUrl: string }> {
    const blob = await (await fetch(dataUrl)).blob();
    const formData = new FormData();
    formData.append('access_token', token);
    formData.append('imagedata', blob, 'annotation.png');

    const res = await fetch('https://upload.gyazo.com/api/upload', {
        method: 'POST',
        body: formData,
    });
    if (!res.ok) {
        const errText = await res.text().catch(() => '');
        throw new Error(`Gyazo upload failed (${res.status}): ${errText}`);
    }
    const data = await res.json();
    return { url: data.url, permalinkUrl: data.permalink_url };
}

// ==================== Feedback Types ====================

type FeedbackStatus = 'approved' | 'needs-edit' | 'rejected' | null;
type FeedbackSeverity = 'high' | 'medium' | 'low' | null;
type FeedbackScreenshotSource = 'thumbnail' | 'video' | 'paste';

interface FeedbackScreenshot {
    id: string;
    source: FeedbackScreenshotSource;
    dataUrl: string;
    gyazoUrl: string | null;
    gyazoPermalink: string | null;
    uploading: boolean;
    createdAt: number;
}

interface FeedbackItem {
    status: FeedbackStatus;
    severity: FeedbackSeverity;
    text: string;
    screenshots: FeedbackScreenshot[];
}

type LegacyFeedbackItem = FeedbackItem & {
    annotatedDataUrl?: string | null;
    gyazoUrl?: string | null;
    gyazoPermalink?: string | null;
    uploading?: boolean;
};

const SCREENSHOT_SOURCE_LABEL: Record<FeedbackScreenshotSource, string> = {
    thumbnail: '缩略图',
    video: '视频画面',
    paste: '粘贴截图',
};

function normalizeFeedbackScreenshots(item?: LegacyFeedbackItem | null): FeedbackScreenshot[] {
    if (!item) return [];

    if (Array.isArray(item.screenshots)) {
        return item.screenshots
            .filter(s => !!s?.dataUrl)
            .map((s, idx) => ({
                id: s.id || `s-${idx + 1}`,
                source: s.source || 'thumbnail',
                dataUrl: s.dataUrl,
                gyazoUrl: s.gyazoUrl || null,
                gyazoPermalink: s.gyazoPermalink || null,
                uploading: !!s.uploading,
                createdAt: typeof s.createdAt === 'number' ? s.createdAt : Date.now() + idx,
            }));
    }

    if (item.annotatedDataUrl) {
        return [{
            id: 'legacy-annotation',
            source: 'thumbnail',
            dataUrl: item.annotatedDataUrl,
            gyazoUrl: item.gyazoUrl || null,
            gyazoPermalink: item.gyazoPermalink || null,
            uploading: !!item.uploading,
            createdAt: 0,
        }];
    }

    return [];
}

function ensureFeedbackItem(item?: LegacyFeedbackItem | null): FeedbackItem {
    return {
        status: item?.status || null,
        severity: (item as any)?.severity || null,
        text: item?.text || '',
        screenshots: normalizeFeedbackScreenshots(item),
    };
}

function hasFeedbackSuggestion(item?: LegacyFeedbackItem | null): boolean {
    const fb = ensureFeedbackItem(item);
    return Boolean(fb.text.trim() || fb.screenshots.length > 0);
}

function getLatestFeedbackScreenshot(item?: LegacyFeedbackItem | null): FeedbackScreenshot | null {
    const screenshots = ensureFeedbackItem(item).screenshots;
    return screenshots.length > 0 ? screenshots[screenshots.length - 1] : null;
}

function decodeUrlParam(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function decodeHtmlUrlText(value: string): string {
    return (value || '')
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#34;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/\\\//g, '/')
        .replace(/\\u002f/gi, '/')
        .replace(/\\u0026/gi, '&');
}

function normalizeExtractedUrl(raw: string): string {
    const value = decodeHtmlUrlText(raw || '')
        .trim()
        .replace(/^[<("'\[]+/, '')
        .replace(/[>)"'\],;.!?，。；：！？、]+$/, '');
    try {
        const parsed = new URL(value);
        const isGoogleRedirect = /(^|\.)google\./i.test(parsed.hostname) && parsed.pathname === '/url';
        if (isGoogleRedirect) {
            const redirectTarget = parsed.searchParams.get('q') || parsed.searchParams.get('url');
            if (redirectTarget) {
                const decoded = decodeUrlParam(redirectTarget).trim();
                if (/^https?:\/\//i.test(decoded)) return decoded;
            }
        }
    } catch {
        // ignore malformed URL and return original trimmed value
    }
    return value;
}

function extractUrlFromFormulaOrText(raw: string): string | null {
    const value = decodeHtmlUrlText(raw || '').trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return normalizeExtractedUrl(value);
    if (/^(drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com|drive\.usercontent\.google\.com)/i.test(value)) return normalizeExtractedUrl(`https://${value}`);

    const hyperlinkMatch = value.match(/=?\s*HYPERLINK\s*\(\s*["']([^"']+)["']/i);
    if (hyperlinkMatch?.[1]) return normalizeExtractedUrl(hyperlinkMatch[1].trim());

    const anchorMatch = value.match(/<a\s+[^>]*href="([^"]+)"[^>]*>/i);
    if (anchorMatch?.[1]) return normalizeExtractedUrl(anchorMatch[1].trim());

    const imageFormulaMatch = value.match(/=?\s*IMAGE\s*\(\s*["']([^"']+)["']/i);
    if (imageFormulaMatch?.[1]) return normalizeExtractedUrl(imageFormulaMatch[1].trim());

    const urlMatch = value.match(/(?:https?:\/\/)?(?:drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com|drive\.usercontent\.google\.com)[^\s<>"']+/i) || value.match(/https?:\/\/[^\s<>"']+/i);
    if (urlMatch?.[0]) return normalizeExtractedUrl(urlMatch[0].trim());

    return null;
}

function extractUrlFromHtmlFragment(raw: string): string | null {
    const value = decodeHtmlUrlText(raw || '');
    if (!value) return null;

    const attrUrlMatch = value.match(/(?:href|src|data-sheets-hyperlink|data-hyperlink|data-url)=["']([^"']+)["']/i);
    if (attrUrlMatch?.[1]) {
        const url = extractUrlFromFormulaOrText(attrUrlMatch[1]);
        if (url) return url;
    }

    const formulaMatch = value.match(/data-sheets-formula=["']([^"']+)["']/i);
    if (formulaMatch?.[1]) {
        const formula = formulaMatch[1]
            .replace(/&quot;/gi, '"')
            .replace(/&#34;/gi, '"')
            .replace(/&amp;/gi, '&');
        const url = extractUrlFromFormulaOrText(formula);
        if (url) return url;
    }

    const url = extractUrlFromFormulaOrText(value);
    if (url) return url;

    const driveIdMatch = value.match(/(?:file\/d\/|\/d\/|[?&]id=|driveFileId["']?\s*[:=]\s*["']?)([a-zA-Z0-9_-]{10,})/i);
    if (driveIdMatch?.[1]) {
        return `https://drive.google.com/file/d/${driveIdMatch[1]}/view`;
    }

    return null;
}

function pushUniqueNormalizedUrl(out: string[], candidate: string | null | undefined) {
    if (!candidate) return;
    const normalized = normalizeExtractedUrl(candidate);
    if (!/^https?:\/\//i.test(normalized)) return;
    if (out.indexOf(normalized) >= 0) return;
    out.push(normalized);
}

function extractUrlCandidatesFromText(raw: string): string[] {
    const value = decodeHtmlUrlText(raw || '');
    const out: string[] = [];
    if (!value.trim()) return out;

    const hyperlinkRe = /=?\s*HYPERLINK\s*\(\s*["']([^"']+)["']/ig;
    const imageRe = /=?\s*IMAGE\s*\(\s*["']([^"']+)["']/ig;
    const anchorRe = /<a\s+[^>]*href=["']([^"']+)["'][^>]*>/ig;
    const attrRe = /(?:href|src|data-sheets-hyperlink|data-hyperlink|data-url)=["']([^"']+)["']/ig;
    const urlRe = /(?:https?:\/\/)?(?:drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com|drive\.usercontent\.google\.com)[^\s<>"']+|https?:\/\/[^\s<>"']+/ig;

    [hyperlinkRe, imageRe, anchorRe, attrRe, urlRe].forEach(re => {
        re.lastIndex = 0;
        let match: RegExpExecArray | null;
        while ((match = re.exec(value)) !== null) {
            const rawMatch = match[1] || match[0] || '';
            if (/^(drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com|drive\.usercontent\.google\.com)/i.test(rawMatch)) {
                pushUniqueNormalizedUrl(out, `https://${rawMatch}`);
            } else {
                pushUniqueNormalizedUrl(out, rawMatch);
            }
        }
    });

    const driveIdMatches = value.matchAll(/(?:file\/d\/|\/d\/|[?&]id=|driveFileId["']?\s*[:=]\s*["']?)([a-zA-Z0-9_-]{10,})/ig);
    for (const match of driveIdMatches) {
        pushUniqueNormalizedUrl(out, `https://drive.google.com/file/d/${match[1]}/view`);
    }

    return out;
}

function extractUrlCandidateFromCell(raw: string): { url: string; isDirect: boolean } | null {
    const value = (raw || '').trim();
    if (!value) return null;

    if (/^https?:\/\//i.test(value)) return { url: normalizeExtractedUrl(value), isDirect: true };

    const hyperlinkMatch = value.match(/=?\s*HYPERLINK\s*\(\s*["']([^"']+)["']/i);
    if (hyperlinkMatch?.[1]) return { url: normalizeExtractedUrl(hyperlinkMatch[1].trim()), isDirect: false };

    const anchorMatch = value.match(/<a\s+[^>]*href=["']([^"']+)["'][^>]*>/i);
    if (anchorMatch?.[1]) return { url: normalizeExtractedUrl(anchorMatch[1].trim()), isDirect: false };

    const imageFormulaMatch = value.match(/=?\s*IMAGE\s*\(\s*["']([^"']+)["']/i);
    if (imageFormulaMatch?.[1]) return { url: normalizeExtractedUrl(imageFormulaMatch[1].trim()), isDirect: false };

    const urlMatch = value.match(/(?:https?:\/\/)?(?:drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com|drive\.usercontent\.google\.com)[^\s<>"']+/i) || value.match(/https?:\/\/[^\s<>"']+/i);
    if (urlMatch?.[0]) return { url: normalizeExtractedUrl(urlMatch[0].trim()), isDirect: false };

    const htmlUrl = extractUrlFromHtmlFragment(value);
    if (htmlUrl) return { url: htmlUrl, isDirect: false };

    return null;
}

function extractUrlCandidatesFromCell(raw: string): Array<{ url: string; isDirect: boolean }> {
    const direct = extractUrlCandidateFromCell(raw);
    const urls = extractUrlCandidatesFromText(raw);
    if (direct?.url && urls.indexOf(direct.url) < 0) urls.unshift(direct.url);
    return urls.map(url => ({
        url,
        isDirect: direct?.url === url ? direct.isDirect : /^https?:\/\//i.test((raw || '').trim()),
    }));
}

function inferExplicitMediaType(url: string, infoText?: string): boolean | undefined {
    const VIDEO_NAME_RE = /\.(mp4|m4v|mov|qt|webm|mkv|avi|wmv|asf|flv|f4v|m3u8|ts|mts|m2ts|mpg|mpeg|mpe|m2v|3gp|3g2|ogv|vob|rm|rmvb|mxf|divx|xvid|hevc|h264|h265|av1)(?=$|[^a-z0-9])/i;
    const IMAGE_NAME_RE = /\.(jpe?g|jfif|pjpeg|pjp|png|apng|gif|webp|bmp|dib|tiff?|svgz?|ico|heic|heif|avif|jxl|raw|dng|cr2|cr3|nef|nrw|arw|srf|sr2|orf|rw2|raf|pef|srw|x3f)(?=$|[^a-z0-9])/i;
    const candidates = [url, infoText || ''].filter(Boolean);
    for (const value of candidates) {
        if (VIDEO_NAME_RE.test(value)) return true;
    }
    for (const value of candidates) {
        if (IMAGE_NAME_RE.test(value)) return false;
    }
    return undefined;
}

function inferMediaTypeFromName(name?: string): boolean | undefined {
    const VIDEO_NAME_RE = /\.(mp4|m4v|mov|qt|webm|mkv|avi|wmv|asf|flv|f4v|m3u8|ts|mts|m2ts|mpg|mpeg|mpe|m2v|3gp|3g2|ogv|vob|rm|rmvb|mxf|divx|xvid|hevc|h264|h265|av1)(?=$|[^a-z0-9])/i;
    const IMAGE_NAME_RE = /\.(jpe?g|jfif|pjpeg|pjp|png|apng|gif|webp|bmp|dib|tiff?|svgz?|ico|heic|heif|avif|jxl|raw|dng|cr2|cr3|nef|nrw|arw|srf|sr2|orf|rw2|raf|pef|srw|x3f)(?=$|[^a-z0-9])/i;
    const value = (name || '').trim();
    if (!value) return undefined;
    if (VIDEO_NAME_RE.test(value)) return true;
    if (IMAGE_NAME_RE.test(value)) return false;
    return undefined;
}

function extractUrlFromHtmlCellValue(cell: Element): string {
    const formula = (cell.getAttribute('data-sheets-formula') || '').trim();
    if (formula) return formula;

    const cellText = (cell.textContent || '').trim();
    const attrCandidates = [
        cell.getAttribute('data-sheets-hyperlink'),
        cell.getAttribute('data-hyperlink'),
        cell.getAttribute('data-url'),
    ];
    for (const attr of attrCandidates) {
        const raw = (attr || '').trim();
        if (!raw) continue;
        const url = extractUrlFromFormulaOrText(raw) || raw;
        if (/^https?:\/\//i.test(url)) {
            if (cellText && !/^https?:\/\//i.test(cellText)) {
                const safeLabel = cellText.replace(/"/g, '""');
                return `=HYPERLINK("${url}","${safeLabel}")`;
            }
            return url;
        }
        return raw;
    }

    const anchor = cell.querySelector('a[href]');
    if (anchor) {
        const href = extractUrlFromFormulaOrText(anchor.getAttribute('href') || '');
        if (href) {
            const label = (anchor.textContent || cell.textContent || '').trim();
            const safeLabel = (label || href).replace(/"/g, '""');
            // Preserve hyperlink semantics when clipboard provides only <a>.
            return `=HYPERLINK("${href}","${safeLabel}")`;
        }
    }

    const outerHtmlUrl = extractUrlFromHtmlFragment((cell as HTMLElement).outerHTML || '');
    if (outerHtmlUrl) {
        const label = (cellText || outerHtmlUrl).trim();
        if (label && !/^https?:\/\//i.test(label)) {
            const safeLabel = label.replace(/"/g, '""');
            return `=HYPERLINK("${outerHtmlUrl}","${safeLabel}")`;
        }
        return outerHtmlUrl;
    }

    const media = cell.querySelector('img[src],video[src],source[src]');
    if (media) {
        const mediaUrl = extractUrlFromFormulaOrText(media.getAttribute('src') || '');
        if (mediaUrl) return mediaUrl;
    }

    return (cell.textContent || '').trim();
}

function stripUrlArtifacts(value: string): string {
    let text = (value || '').trim();
    if (!text) return '';
    text = text.replace(/=HYPERLINK\s*\(\s*"[^"]+"\s*,\s*"([^"]*)"\s*\)/ig, '$1');
    text = text.replace(/=HYPERLINK\s*\(\s*'[^']+'\s*,\s*'([^']*)'\s*\)/ig, '$1');
    text = text.replace(/=IMAGE\s*\(\s*"[^"]+"(?:\s*,[^)]*)?\s*\)/ig, '');
    text = text.replace(/=IMAGE\s*\(\s*'[^']+'(?:\s*,[^)]*)?\s*\)/ig, '');
    text = text.replace(/https?:\/\/[^\s<>"']+/ig, '');
    text = text.replace(/\s+/g, ' ').trim();
    return text;
}

function isGeneratedPreviewUrlCell(url: string, rawCell: string): boolean {
    const lowerUrl = (url || '').toLowerCase();
    const lowerRaw = (rawCell || '').toLowerCase();
    if (lowerRaw.includes('=image(')) return true;
    if (lowerUrl.includes('gyazo.com') || lowerUrl.includes('i.gyazo.com')) return true;
    if (lowerUrl.includes('drive.google.com/thumbnail')) return true;
    if (lowerUrl.includes('lh3.googleusercontent.com/d/')) return true;
    return false;
}

function isAnnotationUrlCell(url: string): boolean {
    const lowerUrl = (url || '').toLowerCase();
    return lowerUrl.includes('gyazo.com') || lowerUrl.includes('i.gyazo.com');
}

function getMediaUrlDedupKey(url: string): string {
    const driveId = extractGoogleDriveFileId(url);
    if (driveId) return `drive:${driveId}`;
    return normalizeExtractedUrl(url).toLowerCase();
}

function pickMeaningfulUrlIndexes(
    cells: string[],
    parsed: Array<{ url: string; isDirect: boolean } | null>,
    urlIndexes: number[]
): number[] {
    const out: number[] = [];
    const seen = new Set<string>();

    const add = (idx: number) => {
        const url = parsed[idx]?.url || '';
        if (!url) return;
        const key = getMediaUrlDedupKey(url);
        if (seen.has(key)) return;
        seen.add(key);
        out.push(idx);
    };

    urlIndexes
        .filter(idx => !isGeneratedPreviewUrlCell(parsed[idx]?.url || '', cells[idx] || ''))
        .forEach(add);

    urlIndexes
        .filter(idx => isGeneratedPreviewUrlCell(parsed[idx]?.url || '', cells[idx] || ''))
        .forEach(idx => {
            const url = parsed[idx]?.url || '';
            if (!url) return;
            if (out.length > 0 && isAnnotationUrlCell(url)) return;
            add(idx);
        });

    return out.length ? out : urlIndexes;
}

function buildInfoTextFromCells(cells: string[], fallbackCell?: string): string {
    const info = cells
        .map(part => stripUrlArtifacts(part))
        .filter(Boolean)
        .join('\t')
        .trim();
    if (info) return info;
    return stripUrlArtifacts(fallbackCell || '');
}

function expandInfoUrlCells(rawCells: string[]): string[] {
    const cells = rawCells.map(cell => (cell || '').trim()).filter(Boolean);
    if (cells.length === 0) return [];

    const parsed = cells.map(cell => extractUrlCandidateFromCell(cell));
    const urlIndexes = parsed
        .map((item, idx) => (item?.url ? idx : -1))
        .filter(idx => idx >= 0);

    if (urlIndexes.length === 0 && cells.length === 1) {
        const urls = extractUrlCandidatesFromText(cells[0]);
        if (urls.length > 1) return urls;
    }

    if (urlIndexes.length <= 1) {
        const row = cells.join('\t').trim();
        return row ? [row] : [];
    }

    const indexes = pickMeaningfulUrlIndexes(cells, parsed, urlIndexes);
    const out: string[] = [];

    indexes.forEach(idx => {
        const rawCell = cells[idx] || '';
        const infoText = buildInfoTextFromCells(
            cells.filter((_, cellIdx) => cellIdx !== idx && !parsed[cellIdx]?.url),
            rawCell
        );
        out.push(infoText ? `${infoText}\t${rawCell}` : rawCell);
    });

    return out;
}

function parseInfoUrlLine(rawLine: string): { url: string; infoText: string; normalized: string; rawUrlCell: string } | null {
    const raw = (rawLine || '').trim();
    if (!raw) return null;

            if (raw.includes('\t')) {
        const parts = raw.split('\t').map(part => part.trim());
        if (parts.length >= 2) {
            const parsed = parts.map(part => extractUrlCandidateFromCell(part));
            const urlIndexes = parsed
                .map((item, idx) => (item?.url ? idx : -1))
                .filter(idx => idx >= 0);

            if (urlIndexes.length > 0) {
                // Feedback export rows may contain original URL + preview/annotation URLs.
                // Keep distinct source media links, and only collapse generated previews when
                // they point to the same underlying Drive file as another URL in the row.
                const urlIndex = pickMeaningfulUrlIndexes(parts, parsed, urlIndexes)[0] ?? urlIndexes[0];
                const url = parsed[urlIndex]?.url;
                if (url) {
                    const buildInfo = (segment: string[]) => segment
                        .map(part => stripUrlArtifacts(part))
                        .filter(Boolean)
                        .join('\t')
                        .trim();

                    const leftInfo = buildInfo(parts.slice(0, urlIndex));
                    const rightInfo = buildInfo(parts.slice(urlIndex + 1));
                    // "信息" should only come from dedicated non-link columns.
                    // Do not extract text from the URL/hyperlink cell itself.
                    const infoText = [leftInfo, rightInfo]
                        .filter(Boolean)
                        .join('\t')
                        .trim();

                    return {
                        url,
                        infoText,
                        normalized: infoText ? `${infoText}\t${url}` : url,
                        rawUrlCell: (parts[urlIndex] || '').trim() || url,
                    };
                }
            }
        }
    }

    const directUrl = extractUrlFromFormulaOrText(raw);
    if (!directUrl) return null;
    
    // If this is a single hyperlink/image formula cell, it should not produce infoText.
    if (/^\s*=?\s*(HYPERLINK|IMAGE)\s*\(/i.test(raw)) {
        return {
            url: directUrl,
            infoText: '',
            normalized: directUrl,
            rawUrlCell: raw,
        };
    }

    // 如果没有制表符，我们可以把整行内容去掉 URL 之后的部分当作 infoText
    const stripped = raw.replace(directUrl, '').trim();
    // 移除可能存在的括号等影响视觉的边角料
    const cleanedInfo = stripped.replace(/^[<("'\[]+|[>)"'\],;.!?]+$/g, '').trim();

    return { 
        url: directUrl, 
        infoText: cleanedInfo, 
        normalized: cleanedInfo ? `${cleanedInfo}\t${directUrl}` : directUrl,
        rawUrlCell: raw,
    };
}

const ImageFormulaPanel: React.FC<ImageFormulaProps> = ({ onBack }) => {
    // State
    const [inputText, setInputText] = useState('');
    const [itemsPerRow, setItemsPerRow] = useState(5);
    const [layoutMode, setLayoutMode] = useState<LayoutMode>('horizontal');
    const [showSettings, setShowSettings] = useState(false);
    const [showPreview, setShowPreview] = useState(true);
    const [thumbnailSize, setThumbnailSize] = useState(80);
    const [copyStatus, setCopyStatus] = useState<'idle' | 'copied'>('idle');
    const [copyUrlStatus, setCopyUrlStatus] = useState<'idle' | 'copied'>('idle');
    const [copyFormulaStatus, setCopyFormulaStatus] = useState<'idle' | 'copied'>('idle');
    const [copyGroupedStatus, setCopyGroupedStatus] = useState<'idle' | 'copied'>('idle');
    const [groupedCopyMode, setGroupedCopyMode] = useState<'horizontal' | 'vertical'>('horizontal');
    const [previewFallbackIndex, setPreviewFallbackIndex] = useState<Record<string, number>>({});
    const [showFormulaInPreview, setShowFormulaInPreview] = useState(false);
    const [emptyRowCount, setEmptyRowCount] = useState(0); // 组间插入空行数量（0=不插入）
    const [splitHorizontalUrls, setSplitHorizontalUrls] = useState(false); // 横版链接是否拆分为纵版
    const [imageMode, setImageMode] = useState<1 | 2 | 4>(1); // Google Sheets IMAGE mode
    const [customImageHeight, setCustomImageHeight] = useState(200);
    const [customImageWidth, setCustomImageWidth] = useState(200);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // ── Folder scan state ──
    const [showFolderScanner, setShowFolderScanner] = useState(false);
    const [folderUrl, setFolderUrl] = useState('');
    const [driveApiKey, setDriveApiKey] = useState<string>(() => localStorage.getItem(DRIVE_API_KEY_STORAGE) || '');
    const [showApiKey, setShowApiKey] = useState(false);
    const [scanStatus, setScanStatus] = useState<'idle' | 'scanning' | 'done' | 'error'>('idle');
    const [scanProgress, setScanProgress] = useState('');
    const [scanError, setScanError] = useState('');
    const [scanResult, setScanResult] = useState<DriveFile[]>([]);
    const [groupByFolder, setGroupByFolder] = useState(true); // 按子文件夹分组导入
    const scanAbortRef = useRef<AbortController | null>(null);

    // ── Drive preview/player modal ──
    const [drivePreviewId, setDrivePreviewId] = useState<string | null>(null);
    const [drivePreviewName, setDrivePreviewName] = useState('');

    // ── Feedback / review mode ──
    const [feedbackMode, setFeedbackMode] = useState(false);
    const [feedbackMap, setFeedbackMap] = useState<Record<string, FeedbackItem>>({});
    const [gyazoToken] = useState<string>(() => localStorage.getItem(GYAZO_TOKEN_STORAGE) || localStorage.getItem('gyazo_access_token') || DEFAULT_GYAZO_TOKEN);
    const [copyFeedbackStatus, setCopyFeedbackStatus] = useState<'idle' | 'uploading' | 'copied'>('idle');
    const [feedbackColumns, setFeedbackColumns] = useState<FeedbackColumnOptions>({
        infoText: false,
        linkColumn: false,
        rawPasted: false,
        sourceImage: false,
        annotatedImage: false,
        reviewer: true,
        annotationLink: true,
        annotationFormula: true,
        feedbackText: true,
    });
    const [feedbackColumnOrder, setFeedbackColumnOrder] = useState<FeedbackColumnKey[]>(() => {
        const saved = localStorage.getItem(FEEDBACK_COLUMN_ORDER_STORAGE);
        if (!saved) return FEEDBACK_COLUMN_DEFAULT_ORDER;
        try {
            return sanitizeFeedbackColumnOrder(JSON.parse(saved));
        } catch {
            return FEEDBACK_COLUMN_DEFAULT_ORDER;
        }
    });
    const [reviewerName, setReviewerName] = useState<string>(() => localStorage.getItem('sheetmind_reviewer_name') || '');
    const [showFeedbackColumnPicker, setShowFeedbackColumnPicker] = useState(false);
    const [showFeedbackPreview, setShowFeedbackPreview] = useState(false);
    const [previewData, setPreviewData] = useState<{ header: string[]; rows: { cells: string[], previewUrl: string }[] } | null>(null);
    const [includeFeedbackHeader, setIncludeFeedbackHeader] = useState(false);
    const [batchSelectMode, setBatchSelectMode] = useState(false);
    const [selectedImageIds, setSelectedImageIds] = useState<Set<string>>(new Set());

    // ── Annotation editor state ──
    const [annotatingImageId, setAnnotatingImageId] = useState<string | null>(null);
    const [annotatingImageUrl, setAnnotatingImageUrl] = useState('');
    const [annotatingPreviewUrls, setAnnotatingPreviewUrls] = useState<string[]>([]);
    const [annotatingAppendedUrls, setAnnotatingAppendedUrls] = useState<string[]>([]);
    const [pasteTargetImageId, setPasteTargetImageId] = useState<string | null>(null);
    const [pasteHint, setPasteHint] = useState('');
    const [pasteProcessing, setPasteProcessing] = useState(false);
    const [drivePreviewShowAnnotator, setDrivePreviewShowAnnotator] = useState(false);

    // ── Context menu ──
    const [contextMenu, setContextMenu] = useState<{ show: boolean; x: number; y: number; imgId: string }>({ show: false, x: 0, y: 0, imgId: '' });
    const [editingFeedbackText, setEditingFeedbackText] = useState<string | null>(null);

    // ── Canvas / PureRef view mode ──
    const [canvasViewMode, setCanvasViewMode] = useState(false);
    const [canvasColumns, setCanvasColumns] = useState(1);
    const [includeThumbnailInCopy, setIncludeThumbnailInCopy] = useState(false);

    // ── Feedback modal state ──
    const [feedbackModalImg, setFeedbackModalImg] = useState<ParsedImage | null>(null);
    const [showClearAllConfirm, setShowClearAllConfirm] = useState(false);

    useEffect(() => {
        localStorage.setItem(FEEDBACK_COLUMN_ORDER_STORAGE, JSON.stringify(feedbackColumnOrder));
    }, [feedbackColumnOrder]);

    // Close context menu on click outside
    useEffect(() => {
        if (!contextMenu.show) return;
        const handler = () => setContextMenu(prev => ({ ...prev, show: false }));
        window.addEventListener('click', handler);
        return () => window.removeEventListener('click', handler);
    }, [contextMenu.show]);

    // ── Paste screenshot to annotate (manual screenshot flow) ──
    useEffect(() => {
        if (!pasteTargetImageId) return;

        const targetId = pasteTargetImageId;
        const handleWindowPaste = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items || items.length === 0) {
                setPasteHint('未检测到剪贴板内容，请先复制截图后再粘贴。');
                return;
            }

            const imageItem = Array.from(items).find(item => item.type.startsWith('image/'));
            if (!imageItem) {
                setPasteHint('粘贴内容里没有图片，请先复制截图后再试。');
                return;
            }

            const file = imageItem.getAsFile();
            if (!file) {
                setPasteHint('读取剪贴板图片失败，请重试。');
                return;
            }

            e.preventDefault();
            setPasteProcessing(true);
            setPasteHint('');

            const reader = new FileReader();
            reader.onload = () => {
                const dataUrl = String(reader.result || '');
                if (!dataUrl.startsWith('data:image/')) {
                    setPasteProcessing(false);
                    setPasteHint('剪贴板不是有效图片，请重试。');
                    return;
                }

                setAnnotatingImageId(targetId);
                setAnnotatingImageUrl(dataUrl);
                setAnnotatingPreviewUrls([dataUrl]);
                setAnnotatingAppendedUrls([]);
                setPasteTargetImageId(null);
                setPasteProcessing(false);
            };
            reader.onerror = () => {
                setPasteProcessing(false);
                setPasteHint('解析截图失败，请重新截图后粘贴。');
            };
            reader.readAsDataURL(file);
        };

        window.addEventListener('paste', handleWindowPaste);
        return () => window.removeEventListener('paste', handleWindowPaste);
    }, [pasteTargetImageId]);

    // Parse input URLs — supports tab-separated "infoText\tURL" lines and space-separated horizontal URLs
    const parsedImages: ParsedImage[] = useMemo(() => {
        if (!inputText.trim()) return [];

        // Split strictly by newline first
        const rawLines = inputText.split('\n').map(s => s.trim()).filter(Boolean);

        // Optionally expand lines: if splitHorizontalUrls is on and a line has multiple space-separated URLs, split them
        const lines: string[] = [];
        for (const rawLine of rawLines) {
            if (!splitHorizontalUrls) {
                // 保持原样 — 不拆分横版链接
                lines.push(rawLine);
                continue;
            }
            // If line has tabs, expand rows with multiple media hyperlinks into independent entries.
            if (rawLine.includes('\t')) {
                lines.push(...expandInfoUrlCells(rawLine.split('\t')));
                continue;
            }
            // If line has formula (=IMAGE, =HYPERLINK), keep as-is
            if (/^\s*=\s*(IMAGE|HYPERLINK)\s*\(/i.test(rawLine)) {
                lines.push(rawLine);
                continue;
            }
            const extractedUrls = extractUrlCandidatesFromText(rawLine);
            if (extractedUrls.length > 1) {
                extractedUrls.forEach(url => lines.push(url));
                continue;
            }
            // Try to find multiple URLs separated by spaces on the same line
            const urlMatches = rawLine.match(/https?:\/\/[^\s<>"']+/gi);
            if (urlMatches && urlMatches.length > 1) {
                // Multiple URLs on one line — split each as its own entry
                for (const url of urlMatches) {
                    lines.push(url.trim());
                }
            } else {
                lines.push(rawLine);
            }
        }

        return lines.map((rawLine, i) => {
            const parsedLine = parseInfoUrlLine(rawLine);
            const infoText = parsedLine?.infoText;
            const urlPart = parsedLine ? parsedLine.url : rawLine;

            // Keep a fallback parser when the line is not recognized as a standard URL row.
            let url = urlPart;
            if (!parsedLine) {
                const hyperlinkMatch = urlPart.match(/=HYPERLINK\s*\(\s*"([^"]+)"/i);
                if (hyperlinkMatch) {
                    url = hyperlinkMatch[1];
                }
                const anchorMatch = urlPart.match(/<a\s+[^>]*href="([^"]+)"[^>]*>/i);
                if (anchorMatch && !hyperlinkMatch) {
                    url = anchorMatch[1];
                }
                const imageFormulaMatch = urlPart.match(/=IMAGE\s*\(\s*"([^"]+)"/i);
                if (imageFormulaMatch && !hyperlinkMatch && !anchorMatch) {
                    url = imageFormulaMatch[1];
                }
            }
            if (!url) {
                return {
                    id: `img-${i}`,
                    originalUrl: '',
                    originalPasted: rawLine,
                    imageUrl: '',
                    previewUrl: '',
                    formula: '',
                    isValid: false,
                    isGoogleDrive: false,
                    infoText,
                };
            }

            // Check if it looks like a URL
            let isValid = /^https?:\/\/.+/i.test(url) || /^data:image\//i.test(url);

            // Check for Google Drive URL and convert
            let imageUrl = url;
            let previewUrl = url;
            let previewUrls: string[] | undefined;
            let driveFileId: string | undefined;
            let driveIssue: string | undefined;
            const isDrive = isValid && isGoogleDriveUrl(url);

            if (isDrive) {
                if (isGoogleDriveFolderUrl(url)) {
                    isValid = false;
                    driveIssue = '这是 Google Drive 文件夹链接，请粘贴具体的文件链接';
                }
                const fileId = extractGoogleDriveFileId(url);
                const resourceKey = extractGoogleDriveResourceKey(url);
                if (fileId && !driveIssue) {
                    driveFileId = fileId;
                    imageUrl = resourceKey ? driveIdToFormulaUrl(fileId, resourceKey) : driveIdToThumbnailUrl(fileId);
                    previewUrls = driveIdToPreviewUrls(fileId, resourceKey);
                    previewUrl = previewUrls[0];
                } else if (!driveIssue) {
                    isValid = false;
                    driveIssue = '未能从此 Drive 链接提取文件 ID';
                }
            }

            let formula = `=IMAGE("${imageUrl}")`;
            if (imageMode === 2) {
                formula = `=IMAGE("${imageUrl}",2)`;
            } else if (imageMode === 4) {
                formula = `=IMAGE("${imageUrl}",4,${customImageHeight},${customImageWidth})`;
            }

            const explicitType = inferExplicitMediaType(url, infoText);
            const resolvedType = isDrive ? (explicitType ?? undefined) : explicitType;

            return {
                id: `img-${i}`,
                originalUrl: url,
                originalPasted: rawLine,
                imageUrl,
                previewUrl,
                previewUrls,
                formula,
                isValid,
                isGoogleDrive: isDrive,
                driveFileId,
                driveIssue,
                isVideo: resolvedType,
                infoText,
            };
        });
    }, [inputText, imageMode, customImageHeight, customImageWidth, splitHorizontalUrls]);

    // ── Fetch real thumbnail URLs from Drive API ──
    const [driveThumbnails, setDriveThumbnails] = useState<Record<string, string>>({});

    useEffect(() => {
        const apiKey = driveApiKey;
        if (!apiKey) return;
        
        const driveFiles = parsedImages.filter(img => img.isGoogleDrive && img.driveFileId);
        if (driveFiles.length === 0) return;

        const toFetch = driveFiles.filter(f => f.driveFileId && !driveThumbnails[f.driveFileId!]);
        if (toFetch.length === 0) return;

        let cancelled = false;

        (async () => {
            const newThumbs: Record<string, string> = {};
            const newMimeTypes: Record<string, string> = {};
            const newNames: Record<string, string> = {};

            for (const file of toFetch) {
                if (cancelled) break;
                const fid = file.driveFileId!;
                try {
                    // Extract resource key from original URL if present
                    const rkMatch = file.originalUrl.match(/resourcekey=([^&]+)/);
                    const resourceKey = rkMatch ? rkMatch[1] : undefined;

                    const headers: Record<string, string> = {};
                    if (resourceKey) {
                        headers['X-Goog-Drive-Resource-Keys'] = `${fid}/${resourceKey}`;
                    }

                    const res = await fetch(
                        `https://www.googleapis.com/drive/v3/files/${fid}?fields=thumbnailLink,hasThumbnail,videoMediaMetadata,mimeType,name&key=${apiKey}`,
                        { headers }
                    );
                    if (res.ok) {
                        const data = await res.json();
                        console.log(`[Drive API] ${fid}:`, data.mimeType, 'hasThumbnail:', data.hasThumbnail, 'thumbnailLink:', !!data.thumbnailLink);
                        if (data.mimeType) {
                            newMimeTypes[fid] = data.mimeType;
                        }
                        if (data.thumbnailLink) {
                            newThumbs[fid] = data.thumbnailLink.replace(/=s\d+/, '=s2000');
                        }
                        if (typeof data.name === 'string' && data.name.trim()) {
                            newNames[fid] = data.name.trim();
                        }
                    } else {
                        console.warn(`[Drive API] ${fid}: HTTP ${res.status}`);
                    }
                } catch (err) {
                    console.warn(`[Drive API] ${fid}: fetch error`, err);
                }
            }

            if (!cancelled && (Object.keys(newThumbs).length > 0 || Object.keys(newMimeTypes).length > 0 || Object.keys(newNames).length > 0)) {
                setDriveThumbnails(prev => ({ ...prev, ...newThumbs }));
                setDriveMimeTypes(prev => ({ ...prev, ...newMimeTypes }));
                setDriveFileNames(prev => ({ ...prev, ...newNames }));
            }
        })();

        return () => { cancelled = true; };
    }, [parsedImages, driveApiKey]); // eslint-disable-line react-hooks/exhaustive-deps

    // ── Merge API thumbnails + mimeType into parsedImages ──
    const [driveMimeTypes, setDriveMimeTypes] = useState<Record<string, string>>({});
    const [driveFileNames, setDriveFileNames] = useState<Record<string, string>>({});

    const enrichedImages = useMemo(() => {
        const hasThumbs = Object.keys(driveThumbnails).length > 0;
        const hasMimes = Object.keys(driveMimeTypes).length > 0;
        const hasNames = Object.keys(driveFileNames).length > 0;
        if (!hasThumbs && !hasMimes && !hasNames) return parsedImages;
        return parsedImages.map(img => {
            if (!img.driveFileId) return img;
            const apiThumb = driveThumbnails[img.driveFileId];
            const mimeType = driveMimeTypes[img.driveFileId];
            const fileName = driveFileNames[img.driveFileId];
            const isVideo = mimeType ? mimeType.startsWith('video/') : undefined;
            const inferredByName = inferMediaTypeFromName([img.infoText || '', fileName || ''].filter(Boolean).join('\t'));
            
            // 修正回退逻辑：不再默认 Drive 文件为视频，而是保持未确定状态 (undefined) 让子组件去 Probe
            const finalIsVideo = isVideo !== undefined 
                ? isVideo 
                : (inferredByName !== undefined ? inferredByName : img.isVideo);

            return {
                ...img,
                ...(apiThumb ? {
                    previewUrl: apiThumb,
                    previewUrls: [apiThumb, ...(img.previewUrls || [])],
                } : {}),
                isVideo: finalIsVideo,
                ...(!img.infoText && fileName ? { infoText: fileName } : {}),
            };
        });
    }, [parsedImages, driveThumbnails, driveMimeTypes, driveFileNames]);

    useEffect(() => {
        setPreviewFallbackIndex({});
    }, [inputText, imageMode, itemsPerRow]);

    // Group images into rows
    const imageRows = useMemo(() => {
        const rows: ParsedImage[][] = [];
        for (let i = 0; i < enrichedImages.length; i += itemsPerRow) {
            rows.push(enrichedImages.slice(i, i + itemsPerRow));
        }
        return rows;
    }, [enrichedImages, itemsPerRow]);

    // Generate TSV data for clipboard (horizontal layout)
    // Row 1: original URLs
    // Row 2: =IMAGE() formulas
    const generateTsvData = useCallback(() => {
        if (parsedImages.length === 0) return '';

        const separator = '\n'.repeat(emptyRowCount + 1);

        if (layoutMode === 'horizontal') {
            // 横版：一行链接 + 一行公式，按 itemsPerRow 分组
            const blocks: string[] = [];
            for (const row of imageRows) {
                const urlRow = row.map(img => img.originalUrl).join('\t');
                const formulaRow = row.map(img => img.formula).join('\t');
                blocks.push(`${urlRow}\n${formulaRow}`);
            }
            return blocks.join(separator);
        } else {
            // 纵版：每列一组（链接 + 公式），横向排列
            const blocks: string[] = [];
            for (const row of imageRows) {
                const urlRow = row.map(img => img.originalUrl).join('\t');
                const formulaRow = row.map(img => img.formula).join('\t');
                blocks.push(`${urlRow}\n${formulaRow}`);
            }
            return blocks.join(separator);
        }
    }, [parsedImages, imageRows, layoutMode, emptyRowCount]);

    // Copy to clipboard as TSV (Tab-separated values for Google Sheets)
    const handleCopy = useCallback(async () => {
        const tsv = generateTsvData();
        if (!tsv) return;

        try {
            // Build HTML table to ensure Google Sheets interprets formulas correctly
            const htmlRows: string[] = [];
            for (let ri = 0; ri < imageRows.length; ri++) {
                const row = imageRows[ri];
                // URL row (use clean originalUrl, not originalPasted which may contain folder path)
                htmlRows.push('<tr>' + row.map(img =>
                    `<td>${img.originalUrl}</td>`
                ).join('') + '</tr>');
                // Formula row
                htmlRows.push('<tr>' + row.map(img =>
                    `<td>${img.formula}</td>`
                ).join('') + '</tr>');
                // 组间空行
                if (emptyRowCount > 0 && ri < imageRows.length - 1) {
                    for (let i = 0; i < emptyRowCount; i++) {
                        htmlRows.push('<tr>' + row.map(() => '<td></td>').join('') + '</tr>');
                    }
                }
            }
            const html = `<table>${htmlRows.join('')}</table>`;

            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([tsv], { type: 'text/plain' }),
                })
            ]);
            setCopyStatus('copied');
            setTimeout(() => setCopyStatus('idle'), 2000);
        } catch {
            // Fallback to plain text
            try {
                await navigator.clipboard.writeText(tsv);
                setCopyStatus('copied');
                setTimeout(() => setCopyStatus('idle'), 2000);
            } catch (e) {
                console.error('Copy failed:', e);
            }
        }
    }, [generateTsvData, imageRows, emptyRowCount]);

    // Copy only original data (with grouping and empty rows applied)
    const handleCopyUrls = useCallback(async () => {
        if (parsedImages.length === 0) return;

        const separator = '\n'.repeat(emptyRowCount + 1);
        const blocks: string[] = [];
        const htmlRows: string[] = [];

        for (let ri = 0; ri < imageRows.length; ri++) {
            const row = imageRows[ri];
            const urlRow = row.map(img => img.originalUrl).join('\t');
            blocks.push(urlRow);

            htmlRows.push('<tr>' + row.map(img => `<td>${img.originalUrl}</td>`).join('') + '</tr>');
            
            if (emptyRowCount > 0 && ri < imageRows.length - 1) {
                for (let i = 0; i < emptyRowCount; i++) {
                    htmlRows.push('<tr>' + row.map(() => '<td></td>').join('') + '</tr>');
                }
            }
        }

        const tsv = blocks.join(separator);
        const html = `<table>${htmlRows.join('')}</table>`;

        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([tsv], { type: 'text/plain' }),
                })
            ]);
            setCopyUrlStatus('copied');
            setTimeout(() => setCopyUrlStatus('idle'), 2000);
        } catch {
            try {
                await navigator.clipboard.writeText(tsv);
                setCopyUrlStatus('copied');
                setTimeout(() => setCopyUrlStatus('idle'), 2000);
            } catch (e) {
                console.error('Copy failed:', e);
            }
        }
    }, [parsedImages, imageRows, emptyRowCount]);

    // Copy only Formulas in original order
    const handleCopyFormulasOnly = useCallback(async () => {
        const formulasText = parsedImages.map(img => img.formula).join('\n');
        if (!formulasText) return;
        try {
            const htmlRows = parsedImages.map(img => `<tr><td>${img.formula}</td></tr>`);
            const html = `<table>${htmlRows.join('')}</table>`;

            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([formulasText], { type: 'text/plain' }),
                })
            ]);
            setCopyFormulaStatus('copied');
            setTimeout(() => setCopyFormulaStatus('idle'), 2000);
        } catch {
            try {
                await navigator.clipboard.writeText(formulasText);
                setCopyFormulaStatus('copied');
                setTimeout(() => setCopyFormulaStatus('idle'), 2000);
            } catch (e) {
                console.error('Copy failed:', e);
            }
        }
    }, [parsedImages]);

    /**
     * Copy grouped: supports two modes.
     *
     * Horizontal (并排): each category → 3-col group side-by-side
     *  | 分类A名 | url_a1 | =IMAGE() | 分类B名 | url_b1 | =IMAGE() |
     *  |         | url_a2 | =IMAGE() |         | url_b2 | =IMAGE() |
     *
     * Vertical (竖版): fixed 3 columns, category name repeats
     *  | 分类A名 | url_a1 | =IMAGE() |
     *  | 分类A名 | url_a2 | =IMAGE() |
     *  | 分类B名 | url_b1 | =IMAGE() |
     */
    const handleCopyGrouped = useCallback(async () => {
        const valid = parsedImages.filter(img => img.isValid);
        if (valid.length === 0) return;

        // Group by infoText (folder path), preserving insertion order
        const groupOrder: string[] = [];
        const groupMap = new Map<string, ParsedImage[]>();
        for (const img of valid) {
            const key = img.infoText?.trim() || '';
            if (!groupMap.has(key)) {
                groupMap.set(key, []);
                groupOrder.push(key);
            }
            groupMap.get(key)!.push(img);
        }

        const groups = groupOrder.map(key => ({
            name: key,
            files: groupMap.get(key)!,
        }));

        const textLines: string[] = [];
        const htmlRows: string[] = [];

        if (groupedCopyMode === 'vertical') {
            // ── Vertical: fixed 3 columns ──
            for (const group of groups) {
                for (const img of group.files) {
                    const cells = [group.name, img.originalUrl, img.formula];
                    textLines.push(cells.join('\t'));
                    htmlRows.push(`<tr>${cells.map(c => `<td>${c}</td>`).join('')}</tr>`);
                }
            }
        } else {
            // ── Horizontal: N groups side-by-side ──
            const maxRows = Math.max(...groups.map(g => g.files.length));
            for (let row = 0; row < maxRows; row++) {
                const tsvCells: string[] = [];
                const htmlCells: string[] = [];
                for (const group of groups) {
                    const img = group.files[row];
                    const catCell = row === 0 ? group.name : '';
                    const linkCell = img ? img.originalUrl : '';
                    const formulaCell = img ? img.formula : '';
                    tsvCells.push(catCell, linkCell, formulaCell);
                    htmlCells.push(
                        `<td>${catCell}</td>`,
                        `<td>${linkCell}</td>`,
                        `<td>${formulaCell}</td>`,
                    );
                }
                textLines.push(tsvCells.join('\t'));
                htmlRows.push(`<tr>${htmlCells.join('')}</tr>`);
            }
        }

        const tsv = textLines.join('\n');
        const html = `<table>${htmlRows.join('')}</table>`;

        try {
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([tsv], { type: 'text/plain' }),
                })
            ]);
            setCopyGroupedStatus('copied');
            setTimeout(() => setCopyGroupedStatus('idle'), 2000);
        } catch {
            try {
                await navigator.clipboard.writeText(tsv);
                setCopyGroupedStatus('copied');
                setTimeout(() => setCopyGroupedStatus('idle'), 2000);
            } catch (e) {
                console.error('Copy failed:', e);
            }
        }
    }, [parsedImages, groupedCopyMode]);

    // Clear all
    const handleClear = () => {
        setInputText('');
    };

    // Handle paste - support pasting from Google Sheets (with HTML)
    // Supports multi-column tables: first column = info text, last column = URL
    const handlePaste = useCallback((e: React.ClipboardEvent) => {
        const appendLines = (lines: string[]) => {
            const normalized = lines.map(line => line.trim()).filter(Boolean);
            if (normalized.length === 0) return false;
            setInputText(prev => {
                const existing = prev.trim();
                return existing ? `${existing}\n${normalized.join('\n')}` : normalized.join('\n');
            });
            return true;
        };

        const html = e.clipboardData.getData('text/html');
        if (html) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const rows = doc.querySelectorAll('tr');

            // Multi-column table (rows with 2+ cells: info + URL)
            if (rows.length > 0) {
                e.preventDefault();
                const outputLines: string[] = [];

                rows.forEach(row => {
                    const cells = row.querySelectorAll('td,th');
                    if (cells.length === 0) return;

                    if (cells.length >= 2) {
                        const rawParts: string[] = [];
                        cells.forEach((cell) => {
                            const cellValue = extractUrlFromHtmlCellValue(cell);
                            rawParts.push(cellValue);
                        });
                        const expandedRows = expandInfoUrlCells(rawParts);
                        if (expandedRows.length > 1) {
                            outputLines.push(...expandedRows);
                            return;
                        }
                        // Check if ALL cells are URLs (horizontal link paste) and split mode is on
                        const allUrls = splitHorizontalUrls && rawParts.every(p => {
                            const extracted = extractUrlFromFormulaOrText(p);
                            return !!extracted;
                        });
                        if (allUrls && rawParts.length > 1) {
                            // 横版粘贴：每个单元格都是链接，拆分为独立行
                            rawParts.forEach(p => {
                                const trimmed = p.trim();
                                if (trimmed) outputLines.push(trimmed);
                            });
                        } else {
                            const rawRow = rawParts.join('\t').trim();
                            if (rawRow) outputLines.push(rawRow);
                        }
                    } else {
                        // Single column
                        const cell = cells[0];
                        const value = extractUrlFromHtmlCellValue(cell);
                        const urls = extractUrlCandidatesFromCell(`${value}\n${(cell as HTMLElement).outerHTML || ''}`);
                        if (urls.length > 1) {
                            urls.forEach(item => outputLines.push(item.url));
                        } else if (value.trim()) {
                            outputLines.push(value.trim());
                        }
                    }
                });

                if (outputLines.length > 0) {
                    if (appendLines(outputLines)) return;
                }
            }

            // Fallback: single-cell table or no rows — try <td> direct
            const cells = doc.querySelectorAll('td,th');
            if (cells.length > 0 && rows.length === 0) {
                e.preventDefault();
                const urls: string[] = [];
                cells.forEach(cell => {
                    const value = extractUrlFromHtmlCellValue(cell);
                    if (value.trim()) urls.push(value.trim());
                });
                if (appendLines(urls)) return;
            }

            // No table cells found — try extracting <a> tags directly (non-table HTML)
            const anchors = doc.querySelectorAll('a[href]');
            if (anchors.length > 0) {
                e.preventDefault();
                const urls: string[] = [];
                anchors.forEach(a => {
                    const href = a.getAttribute('href') || '';
                    if (href && /^https?:\/\//i.test(href)) {
                        urls.push(href);
                    }
                });
                if (appendLines(urls)) return;
            }
        }
        // Default: let the textarea handle it normally
    }, [splitHorizontalUrls]);

    const handleAppendLinksFromCanvas = useCallback((links: string[]) => {
        if (!links || links.length === 0) return;
        setInputText(prev => {
            const existing = prev
                .split('\n')
                .map(s => s.trim())
                .filter(Boolean);

            // Use canonical dedup key (Drive file ID aware) to prevent duplicates from different URL formats
            const dedupKeyToIndex = new Map<string, number>();
            existing.forEach((line, idx) => {
                const parsed = parseInfoUrlLine(line);
                if (parsed) {
                    const key = getMediaUrlDedupKey(parsed.url);
                    if (!dedupKeyToIndex.has(key)) {
                        dedupKeyToIndex.set(key, idx);
                    }
                }
            });

            let changed = false;
            for (const raw of links) {
                const parsedNew = parseInfoUrlLine(raw);
                if (!parsedNew) continue;

                const key = getMediaUrlDedupKey(parsedNew.url);
                const existingIdx = dedupKeyToIndex.get(key);
                if (existingIdx === undefined) {
                    existing.push(parsedNew.normalized);
                    dedupKeyToIndex.set(key, existing.length - 1);
                    changed = true;
                    continue;
                }

                const parsedOld = parseInfoUrlLine(existing[existingIdx]);
                const oldInfo = parsedOld?.infoText?.trim() || '';
                const newInfo = parsedNew.infoText.trim();

                // Upgrade existing row when it previously had no infoText.
                if (!oldInfo && newInfo) {
                    existing[existingIdx] = parsedNew.normalized;
                    changed = true;
                }
            }

            if (!changed) return prev;
            return existing.join('\n');
        });
    }, []);

    // Keyboard shortcut
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
                handleCopy();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleCopy]);

    // ── Folder scan handler (supports multiple folder URLs) ──
    const handleFolderScan = useCallback(async () => {
        // Parse all lines into folder IDs
        const lines = folderUrl.split(/[\n,]+/).map(s => s.trim()).filter(Boolean);
        const folderEntries: { url: string; id: string }[] = [];
        for (const line of lines) {
            const id = extractDriveFolderId(line);
            if (id) folderEntries.push({ url: line, id });
        }
        if (folderEntries.length === 0) {
            setScanError('无法识别文件夹链接，请粘贴 Google Drive 文件夹分享链接（每行一个）');
            setScanStatus('error');
            return;
        }
        if (!driveApiKey.trim()) {
            setScanError('请输入 Google Drive API Key');
            setScanStatus('error');
            return;
        }
        // Persist API key
        localStorage.setItem(DRIVE_API_KEY_STORAGE, driveApiKey.trim());

        // Abort previous scan
        scanAbortRef.current?.abort();
        const controller = new AbortController();
        scanAbortRef.current = controller;

        setScanStatus('scanning');
        setScanError('');
        setScanResult([]);
        setScanProgress(`开始扫描 ${folderEntries.length} 个文件夹…`);

        try {
            const allFiles: DriveFile[] = [];
            for (let fi = 0; fi < folderEntries.length; fi++) {
                if (controller.signal.aborted) throw new DOMException('Aborted', 'AbortError');
                const entry = folderEntries[fi];
                setScanProgress(`[${fi + 1}/${folderEntries.length}] 正在扫描文件夹…`);
                const files = await listDriveMediaRecursive(
                    entry.id,
                    driveApiKey.trim(),
                    (msg) => setScanProgress(`[${fi + 1}/${folderEntries.length}] ${msg}`),
                    controller.signal,
                );
                allFiles.push(...files);
            }
            const imageCount = allFiles.filter(f => IMAGE_MIME_TYPES.has(f.mimeType)).length;
            const videoCount = allFiles.filter(f => VIDEO_MIME_TYPES.has(f.mimeType)).length;
            const uniqueSubfolders = new Set(allFiles.map(f => f.folderPath || '').filter(Boolean));
            const subfolderInfo = uniqueSubfolders.size > 0 ? `，${uniqueSubfolders.size} 个子文件夹` : '';
            setScanResult(allFiles);
            setScanStatus('done');
            setScanProgress(`扫描完成：${folderEntries.length} 个根文件夹${subfolderInfo}，共找到 ${allFiles.length} 个媒体文件（${imageCount} 图片 + ${videoCount} 视频）`);
        } catch (e: unknown) {
            if ((e as Error).name === 'AbortError') return;
            setScanError((e as Error).message || '扫描失败，请检查 API Key 和文件夹权限');
            setScanStatus('error');
        }
    }, [folderUrl, driveApiKey]);

    const handleFolderScanAbort = useCallback(() => {
        scanAbortRef.current?.abort();
        setScanStatus('idle');
        setScanProgress('');
    }, []);

    /** Append scanned media files into the input textarea.
     *  When groupByFolder is on, files are grouped by subfolder with the folder
     *  path prepended as a tab-separated info column (parseable as infoText). */
    const handleAppendScannedVideos = useCallback(() => {
        if (scanResult.length === 0) return;

        let urls: string;
        if (groupByFolder) {
            // Group files by folderPath
            const groups = new Map<string, DriveFile[]>();
            for (const f of scanResult) {
                const key = f.folderPath || '';
                if (!groups.has(key)) groups.set(key, []);
                groups.get(key)!.push(f);
            }
            const lines: string[] = [];
            for (const [folderPath, files] of groups) {
                for (const f of files) {
                    const driveUrl = `https://drive.google.com/file/d/${f.id}/view`;
                    if (folderPath) {
                        // Tab-separated: folderPath \t URL — this will be parsed as infoText + URL
                        lines.push(`${folderPath}\t${driveUrl}`);
                    } else {
                        lines.push(driveUrl);
                    }
                }
            }
            urls = lines.join('\n');
        } else {
            urls = scanResult
                .map(f => `https://drive.google.com/file/d/${f.id}/view`)
                .join('\n');
        }

        setInputText(prev => {
            const existing = prev.trim();
            return existing ? existing + '\n' + urls : urls;
        });
        // Collapse scanner after appending
        setShowFolderScanner(false);
        setScanStatus('idle');
        setScanResult([]);
        setScanProgress('');
    }, [scanResult, groupByFolder]);

    // ── Feedback: save annotation by explicit image id (APPEND to screenshots[]) ──
    const persistAnnotation = useCallback(async (
        imgId: string,
        dataUrl: string,
        options?: { text?: string; closeEditor?: boolean; source?: FeedbackScreenshotSource }
    ) => {
        if (!imgId || !dataUrl) return;

        const screenshotId = `ss-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
        const newScreenshot: FeedbackScreenshot = {
            id: screenshotId,
            source: options?.source || 'thumbnail',
            dataUrl,
            gyazoUrl: null,
            gyazoPermalink: null,
            uploading: true,
            createdAt: Date.now(),
        };

        setFeedbackMap(prev => {
            const existing = ensureFeedbackItem(prev[imgId] as any);
            return {
                ...prev,
                [imgId]: {
                    status: existing.status || 'needs-edit',
                    text: options?.text !== undefined ? options.text : existing.text,
                    screenshots: [...existing.screenshots, newScreenshot],
                    // Legacy compat
                    annotatedDataUrl: dataUrl,
                    gyazoUrl: null,
                    gyazoPermalink: null,
                    uploading: true,
                },
            };
        });

        if (options?.closeEditor !== false) {
            setAnnotatingImageId(null);
        }

        // Auto-upload to Gyazo
        if (gyazoToken.trim()) {
            try {
                const result = await uploadToGyazo(dataUrl, gyazoToken.trim());
                setFeedbackMap(prev => {
                    const item = prev[imgId];
                    if (!item) return prev;
                    const updatedScreenshots = (item.screenshots || []).map(s =>
                        s.id === screenshotId
                            ? { ...s, gyazoUrl: result.url, gyazoPermalink: result.permalinkUrl, uploading: false }
                            : s
                    );
                    return {
                        ...prev,
                        [imgId]: {
                            ...item,
                            screenshots: updatedScreenshots,
                            // Legacy compat: point to latest uploaded
                            gyazoUrl: result.url,
                            gyazoPermalink: result.permalinkUrl,
                            uploading: updatedScreenshots.some(s => s.uploading),
                        },
                    };
                });
            } catch (e) {
                console.error('Gyazo upload failed:', e);
                setFeedbackMap(prev => {
                    const item = prev[imgId];
                    if (!item) return prev;
                    const updatedScreenshots = (item.screenshots || []).map(s =>
                        s.id === screenshotId ? { ...s, uploading: false } : s
                    );
                    return {
                        ...prev,
                        [imgId]: { ...item, screenshots: updatedScreenshots, uploading: false },
                    };
                });
            }
        } else {
            setFeedbackMap(prev => {
                const item = prev[imgId];
                if (!item) return prev;
                const updatedScreenshots = (item.screenshots || []).map(s =>
                    s.id === screenshotId ? { ...s, uploading: false } : s
                );
                return {
                    ...prev,
                    [imgId]: { ...item, screenshots: updatedScreenshots, uploading: false },
                };
            });
        }
    }, [gyazoToken]);

    // ── Feedback: update text ──
    const updateFeedbackText = useCallback((imgId: string, text: string) => {
        setFeedbackMap(prev => {
            const existing = ensureFeedbackItem(prev[imgId] as any);
            return {
                ...prev,
                [imgId]: { ...existing, text },
            };
        });
    }, []);

    // ── Feedback: change status (✅ ⚠️ ❌) ──
    const handleFeedbackStatusChange = useCallback((imgId: string, status: 'approved' | 'needs-edit' | 'rejected' | null) => {
        setFeedbackMap(prev => {
            const existing = ensureFeedbackItem(prev[imgId] as any);
            return {
                ...prev,
                [imgId]: { ...existing, status },
            };
        });
    }, []);

    // ── Feedback: change severity (高 中 低) ──
    const handleFeedbackSeverityChange = useCallback((imgId: string, severity: 'high' | 'medium' | 'low' | null) => {
        setFeedbackMap(prev => {
            const existing = ensureFeedbackItem(prev[imgId] as any);
            return {
                ...prev,
                [imgId]: { ...existing, severity },
            };
        });
    }, []);

    // ── Feedback: batch select + bulk status apply ──
    const toggleBatchSelectImage = useCallback((imgId: string) => {
        setSelectedImageIds(prev => {
            const next = new Set(prev);
            if (next.has(imgId)) next.delete(imgId);
            else next.add(imgId);
            return next;
        });
    }, []);

    const applyBatchFeedbackStatus = useCallback((status: 'approved' | 'rejected') => {
        if (selectedImageIds.size === 0) return;
        setFeedbackMap(prev => {
            const next = { ...prev };
            selectedImageIds.forEach(imgId => {
                const existing = ensureFeedbackItem(next[imgId] as any);
                next[imgId] = { ...existing, status };
            });
            return next;
        });
    }, [selectedImageIds]);

    const selectAllBatchTargets = useCallback(() => {
        const ids = parsedImages.filter(img => img.isValid).map(img => img.id);
        setSelectedImageIds(new Set(ids));
    }, [parsedImages]);

    useEffect(() => {
        const validIds = new Set(parsedImages.map(img => img.id));
        setSelectedImageIds(prev => {
            let changed = false;
            const next = new Set<string>();
            prev.forEach(id => {
                if (validIds.has(id)) next.add(id);
                else changed = true;
            });
            return changed ? next : prev;
        });
    }, [parsedImages]);

    useEffect(() => {
        if (feedbackMode && !canvasViewMode) return;
        setBatchSelectMode(false);
        setSelectedImageIds(new Set());
    }, [feedbackMode, canvasViewMode]);

    const isFeedbackColumnEnabled = useCallback((key: FeedbackColumnKey) => {
        if (key === 'status') return true;
        return feedbackColumns[key];
    }, [feedbackColumns]);

    const activeFeedbackColumnOrder = useMemo(
        () => {
            const base = feedbackColumnOrder.filter(isFeedbackColumnEnabled);
            // When "含缩略图" is enabled, ensure sourceImage column is included (as the first column for easy visual verification)
            if (includeThumbnailInCopy && !base.includes('sourceImage')) {
                return ['sourceImage' as FeedbackColumnKey, ...base];
            }
            return base;
        },
        [feedbackColumnOrder, isFeedbackColumnEnabled, includeThumbnailInCopy]
    );

    const moveFeedbackColumn = useCallback((key: FeedbackColumnKey, direction: -1 | 1) => {
        setFeedbackColumnOrder(prev => {
            const idx = prev.indexOf(key);
            if (idx < 0) return prev;
            const nextIdx = idx + direction;
            if (nextIdx < 0 || nextIdx >= prev.length) return prev;
            const next = [...prev];
            [next[idx], next[nextIdx]] = [next[nextIdx], next[idx]];
            return next;
        });
    }, []);

    // ── Feedback: copy all as TSV with dynamic column selection ──
    const getFeedbackExportDataRows = useCallback((updatedMap: Record<string, any>) => {
        const statusLabels: Record<string, string> = { approved: '可以使用', 'needs-edit': '需要修改', rejected: '不可使用' };
        const toSingleLine = (value: string) => (value || '').replace(/\r?\n+/g, ' / ').trim();
        const normalizeRawPastedForExport = (raw: string, fallbackUrl?: string) => {
            const text = (raw || '').trim();
            const fallback = (fallbackUrl || '').trim();
            if (!text) {
                if (/^https?:\/\//i.test(fallback)) {
                    const safe = fallback.replace(/"/g, '""');
                    return `=HYPERLINK("${safe}","${safe}")`;
                }
                return '';
            }
            const hyperlink = text.match(/^\s*=?\s*HYPERLINK\s*\(\s*["']([^"']+)["'](?:\s*[,;]\s*["']([^"']*)["'])?\s*\)\s*$/i);
            if (hyperlink?.[1]) return text.startsWith('=') ? text : `=${text}`;
            if (/^https?:\/\//i.test(text)) {
                const safe = text.replace(/"/g, '""');
                return `=HYPERLINK("${safe}","${safe}")`;
            }
            if (/^https?:\/\//i.test(fallback)) {
                const safeUrl = fallback.replace(/"/g, '""');
                const safeLabel = text.replace(/"/g, '""');
                return `=HYPERLINK("${safeUrl}","${safeLabel}")`;
            }
            return text;
        };
        const sourceImageFormula = (img: ParsedImage) => (img.formula || (img.imageUrl ? `=IMAGE("${img.imageUrl}")` : ''));
        const resolveStatusText = (img: ParsedImage, status?: FeedbackStatus) => {
            if (!img.isValid) return '没有权限';
            return status ? (statusLabels[status] || '') : '';
        };
        const screenshotUrls = (screenshots: FeedbackScreenshot[]) => screenshots.filter(s => s.gyazoUrl).map(s => s.gyazoUrl!);

        return parsedImages.map(img => {
            const fb = updatedMap[img.id];
            const screenshots = normalizeFeedbackScreenshots(fb as any);
            return activeFeedbackColumnOrder.map((col): string => {
                switch (col) {
                    case 'infoText':
                        return img.infoText || '';
                    case 'linkColumn':
                        return img.originalUrl || '';
                    case 'rawPasted':
                        return normalizeRawPastedForExport(img.originalPasted || '', img.originalUrl);
                    case 'sourceImage':
                        return sourceImageFormula(img);
                    case 'reviewer':
                        return reviewerName.trim();
                    case 'status':
                        return resolveStatusText(img, fb?.status);
                    case 'severity': {
                        const sev = fb?.severity;
                        return sev === 'high' ? '高' : sev === 'medium' ? '中' : sev === 'low' ? '低' : '';
                    }
                    case 'annotatedImage': {
                        const urls = screenshotUrls(screenshots);
                        return urls.join(' | ') || '';
                    }
                    case 'annotationLink': {
                        const urls = screenshotUrls(screenshots);
                        return urls.join(' | ') || '';
                    }
                    case 'annotationFormula': {
                        const formulas = screenshotUrls(screenshots).map(url => `=IMAGE("${url}")`);
                        return formulas[0] || '';
                    }
                    case 'feedbackText':
                        return toSingleLine(fb?.text || '');
                    default:
                        return '';
                }
            });
        });
    }, [parsedImages, activeFeedbackColumnOrder, reviewerName]);

    const handlePreviewFeedback = useCallback(async () => {
        try {
            if (!gyazoToken.trim()) {
                const hasAnnotations = parsedImages.some(img => {
                    const fb = ensureFeedbackItem(feedbackMap[img.id] as any);
                    return fb.screenshots.length > 0;
                });
                if (hasAnnotations) {
                    alert('你有截图标注但未配置 Gyazo Token，复制的反馈不会包含图片链接。请在设置中配置 Token。');
                }
            }

            setCopyFeedbackStatus('uploading');

            // Batch upload any missing Gyazo URLs (iterate all screenshots)
            const updatedMap = { ...feedbackMap };
            let hasNewUploads = false;
            
            for (const img of parsedImages) {
                const fb = updatedMap[img.id];
                if (!fb) continue;
                const screenshots = normalizeFeedbackScreenshots(fb as any);
                let updatedScreenshots = [...screenshots];
                for (let i = 0; i < updatedScreenshots.length; i++) {
                    const ss = updatedScreenshots[i];
                    if (ss.dataUrl && !ss.gyazoUrl && gyazoToken.trim()) {
                        try {
                            const result = await uploadToGyazo(ss.dataUrl, gyazoToken.trim());
                            updatedScreenshots[i] = { ...ss, gyazoUrl: result.url, gyazoPermalink: result.permalinkUrl, uploading: false };
                            hasNewUploads = true;
                        } catch (e) {
                            console.error('Gyazo bulk upload failed for', img.id, e);
                        }
                    }
                }
                if (hasNewUploads) {
                    const latestWithUrl = updatedScreenshots.filter(s => s.gyazoUrl).pop();
                    updatedMap[img.id] = {
                        ...fb,
                        screenshots: updatedScreenshots,
                        annotatedDataUrl: updatedScreenshots[updatedScreenshots.length - 1]?.dataUrl || null,
                        gyazoUrl: latestWithUrl?.gyazoUrl || null,
                        gyazoPermalink: latestWithUrl?.gyazoPermalink || null,
                        uploading: false,
                    } as any;
                }
            }

            if (hasNewUploads) {
                setFeedbackMap(updatedMap);
            }

            const header = activeFeedbackColumnOrder.map(col => FEEDBACK_COLUMN_META[col].label);
            const rowArrays = getFeedbackExportDataRows(updatedMap);
            const rows = rowArrays.map((cells, idx) => ({
                cells,
                previewUrl: parsedImages[idx]?.previewUrl || parsedImages[idx]?.originalUrl || ''
            }));
            
            setPreviewData({ header, rows });
            setShowFeedbackPreview(true);
            setCopyFeedbackStatus('idle');
        } catch (err) {
            console.error('Preview error:', err);
            alert('预览数据生成失败: ' + String(err));
            setCopyFeedbackStatus('idle');
        }
    }, [parsedImages, feedbackMap, gyazoToken, activeFeedbackColumnOrder, getFeedbackExportDataRows]);

    const handleCopyFeedback = useCallback(async () => {
        if (!gyazoToken.trim()) {
            const hasAnnotations = parsedImages.some(img => {
                const fb = ensureFeedbackItem(feedbackMap[img.id] as any);
                return fb.screenshots.length > 0;
            });
            if (hasAnnotations) {
                alert('你有截图标注但未配置 Gyazo Token，复制的反馈不会包含图片链接。请在设置中配置 Token。');
            }
        }

        setCopyFeedbackStatus('uploading');

        // Batch upload any missing Gyazo URLs (iterate all screenshots)
        const updatedMap = { ...feedbackMap };
        let hasNewUploads = false;
        
        for (const img of parsedImages) {
            const fb = updatedMap[img.id];
            if (!fb) continue;
            const screenshots = normalizeFeedbackScreenshots(fb as any);
            let updatedScreenshots = [...screenshots];
            for (let i = 0; i < updatedScreenshots.length; i++) {
                const ss = updatedScreenshots[i];
                if (ss.dataUrl && !ss.gyazoUrl && gyazoToken.trim()) {
                    try {
                        const result = await uploadToGyazo(ss.dataUrl, gyazoToken.trim());
                        updatedScreenshots[i] = { ...ss, gyazoUrl: result.url, gyazoPermalink: result.permalinkUrl, uploading: false };
                        hasNewUploads = true;
                    } catch (e) {
                        console.error('Gyazo bulk upload failed for', img.id, e);
                    }
                }
            }
            if (hasNewUploads) {
                const latestWithUrl = updatedScreenshots.filter(s => s.gyazoUrl).pop();
                updatedMap[img.id] = {
                    ...fb,
                    screenshots: updatedScreenshots,
                    annotatedDataUrl: updatedScreenshots[updatedScreenshots.length - 1]?.dataUrl || null,
                    gyazoUrl: latestWithUrl?.gyazoUrl || null,
                    gyazoPermalink: latestWithUrl?.gyazoPermalink || null,
                    uploading: false,
                } as any;
            }
        }

        if (hasNewUploads) {
            setFeedbackMap(updatedMap);
        }

        // Save reviewer name
        if (reviewerName.trim()) {
            localStorage.setItem('sheetmind_reviewer_name', reviewerName.trim());
        }

        // Build dynamic columns based on feedbackColumns
        const buildHeader = () => activeFeedbackColumnOrder.map(col => FEEDBACK_COLUMN_META[col].label);

        const rowArrays = getFeedbackExportDataRows(updatedMap);
        const rows = rowArrays.map(row => row.join('\t'));
        const header = buildHeader();
        const tsv = includeFeedbackHeader
            ? [header.join('\t'), ...rows].join('\n')
            : rows.join('\n');

        // Build HTML with embedded images for annotatedImage column
        const escapeHtml = (value: string) => (value || '')
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
        
        const buildHtmlRow = (img: ParsedImage) => {
            const fb = updatedMap[img.id];
            const screenshots = normalizeFeedbackScreenshots(fb as any);
            const cols: Array<{ value: string; raw?: boolean; formula?: string }> = activeFeedbackColumnOrder.map(col => {
                switch (col) {
                    case 'infoText':
                        return { value: img.infoText || '' };
                    case 'linkColumn':
                        return { value: img.originalUrl || '' };
                    case 'rawPasted': {
                        const formula = normalizeRawPastedForExport(img.originalPasted || '', img.originalUrl);
                        return { value: formula, formula: formula.startsWith('=') ? formula : undefined };
                    }
                    case 'sourceImage': {
                        const formula = sourceImageFormula(img);
                        return { value: formula, formula: formula.startsWith('=') ? formula : undefined };
                    }
                    case 'reviewer':
                        return { value: reviewerName.trim() };
                    case 'status':
                        return { value: resolveStatusText(img, fb?.status) };
                    case 'annotatedImage': {
                        const imgs = screenshots.filter(s => s.gyazoUrl).map(s =>
                            `<img src="${s.gyazoUrl}" style="max-width:250px;max-height:180px;margin:2px;" title="${SCREENSHOT_SOURCE_LABEL[s.source] || s.source}" />`
                        );
                        return { value: imgs.join('<br/>') || '', raw: true };
                    }
                    case 'annotationLink': {
                        const urls = screenshotUrls(screenshots);
                        return { value: urls.join(' | ') || '' };
                    }
                    case 'annotationFormula': {
                        const formulas = screenshotUrls(screenshots).map(url => `=IMAGE("${url}")`);
                        const formula = formulas[0] || '';
                        return { value: formula, formula: formula.startsWith('=') ? formula : undefined };
                    }
                    case 'feedbackText':
                        return { value: toSingleLine(fb?.text || '') };
                    default:
                        return { value: '' };
                }
            });
            return '<tr>' + cols.map(c => {
                const cellValue = c.raw ? c.value : escapeHtml(c.value);
                if (c.formula) {
                    return `<td data-sheets-formula="${escapeHtml(c.formula)}">${cellValue}</td>`;
                }
                return `<td>${cellValue}</td>`;
            }).join('') + '</tr>';
        };

        try {
            const preferPlainFormulaMode = feedbackColumns.rawPasted;
            if (preferPlainFormulaMode) {
                // Avoid HTML clipboard coercing hyperlink formulas into plain anchor URLs.
                await navigator.clipboard.writeText(tsv);
                setCopyFeedbackStatus('copied');
                setTimeout(() => setCopyFeedbackStatus('idle'), 2000);
                return;
            }

            const htmlRows: string[] = [];
            if (includeFeedbackHeader) {
                htmlRows.push('<tr>' + header.map(h => `<th>${h}</th>`).join('') + '</tr>');
            }
            htmlRows.push(...parsedImages.map(buildHtmlRow));
            const html = `<table>${htmlRows.join('')}</table>`;
            await navigator.clipboard.write([
                new ClipboardItem({
                    'text/html': new Blob([html], { type: 'text/html' }),
                    'text/plain': new Blob([tsv], { type: 'text/plain' }),
                })
            ]);
        } catch {
            await navigator.clipboard.writeText(tsv);
        }
        setCopyFeedbackStatus('copied');
        setTimeout(() => setCopyFeedbackStatus('idle'), 2000);
    }, [parsedImages, feedbackMap, gyazoToken, feedbackColumns, reviewerName, includeFeedbackHeader, activeFeedbackColumnOrder]);

    // ── Context menu handler ──
    const handleThumbnailContextMenu = useCallback((e: React.MouseEvent, img: ParsedImage) => {
        if (!feedbackMode) return;
        e.preventDefault();
        setContextMenu({ show: true, x: e.clientX, y: e.clientY, imgId: img.id });
    }, [feedbackMode]);

    // ── Open annotation editor ──
    const openAnnotation = useCallback((img: ParsedImage) => {
        setAnnotatingImageId(img.id);
        // Always open the original preview image first to avoid re-opening a previously cropped screenshot.
        setAnnotatingImageUrl(img.previewUrl);
        setAnnotatingPreviewUrls(img.previewUrls || [img.previewUrl]);
        setAnnotatingAppendedUrls([]);
        setDrivePreviewShowAnnotator(true);
        setContextMenu(prev => ({ ...prev, show: false }));
    }, []);

    // ── Close Drive preview + inline annotator together (avoid falling back to the global annotator modal) ──
    const closeDrivePreview = useCallback(() => {
        setDrivePreviewId(null);
        setDrivePreviewName('');
        setDrivePreviewShowAnnotator(false);
        setAnnotatingImageId(null);
        setAnnotatingImageUrl('');
        setAnnotatingPreviewUrls([]);
        setAnnotatingAppendedUrls([]);
    }, []);

    const blobToDataUrl = useCallback((blob: Blob): Promise<string> => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = () => resolve(String(reader.result || ''));
            reader.onerror = () => reject(reader.error || new Error('read blob failed'));
            reader.readAsDataURL(blob);
        });
    }, []);

    const tryReadImageFromClipboard = useCallback(async (): Promise<string | null> => {
        const clipboard = navigator.clipboard as (Clipboard & { read?: () => Promise<ClipboardItem[]> });
        if (!clipboard || typeof clipboard.read !== 'function') return null;
        try {
            const items = await clipboard.read();
            for (const item of items) {
                const imageType = item.types.find(type => type.startsWith('image/'));
                if (!imageType) continue;
                const blob = await item.getType(imageType);
                const dataUrl = await blobToDataUrl(blob);
                if (dataUrl.startsWith('data:image/')) return dataUrl;
            }
        } catch {
            // ignore and fallback to manual Cmd/Ctrl+V flow
        }
        return null;
    }, [blobToDataUrl]);

    // ── Start screenshot annotation flow: click-to-paste first, fallback to manual Cmd/Ctrl+V ──
    const startPasteAnnotation = useCallback(async (imgId: string) => {
        setContextMenu(prev => ({ ...prev, show: false }));
        setPasteHint('');
        setPasteProcessing(true);

        const dataUrl = await tryReadImageFromClipboard();
        if (dataUrl) {
            setAnnotatingImageId(imgId);
            setAnnotatingImageUrl(dataUrl);
            setAnnotatingPreviewUrls([dataUrl]);
            setAnnotatingAppendedUrls([]);
            setPasteTargetImageId(null);
            setPasteProcessing(false);
            return;
        }

        setPasteTargetImageId(imgId);
        setPasteHint('未能直接读取系统剪贴板，请按 Cmd/Ctrl + V 粘贴截图。');
        setPasteProcessing(false);
    }, [tryReadImageFromClipboard]);

    // ── Feedback modal: save ──
    const handleFeedbackModalSave = useCallback(async (data: { text: string; severity: 'high' | 'medium' | 'low' | null; annotatedDataUrl: string | null }) => {
        const img = feedbackModalImg;
        if (!img) return;
        const imgId = img.id;

        // Update text and severity
        setFeedbackMap(prev => {
            const existing = ensureFeedbackItem(prev[imgId] as any);
            return { ...prev, [imgId]: { ...existing, text: data.text !== undefined ? data.text : existing.text, severity: data.severity !== undefined ? data.severity : existing.severity } };
        });

        // If there's a new annotation, append it via persistAnnotation
        if (data.annotatedDataUrl) {
            void persistAnnotation(imgId, data.annotatedDataUrl, {
                text: data.text,
                closeEditor: true,
                source: 'thumbnail',
            });
        }

        setFeedbackModalImg(null);
    }, [feedbackModalImg, persistAnnotation]);

    const feedbackCount = Object.values(feedbackMap).filter(fb => {
        const norm = ensureFeedbackItem(fb as any);
        return norm.status || norm.text || norm.screenshots.length > 0;
    }).length;

    const validCount = parsedImages.filter(img => img.isValid).length;
    const invalidCount = parsedImages.length - validCount;
    const driveCount = parsedImages.filter(img => img.isGoogleDrive).length;

    return (
        <div className="h-full flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50 shrink-0">
                <div className="flex items-center gap-3">
                    {onBack && (
                        <button
                            onClick={onBack}
                            className="p-1.5 rounded-lg text-slate-500 hover:bg-white hover:text-slate-700 hover:shadow-sm transition-all"
                            title="返回"
                        >
                            <ArrowLeft size={18} />
                        </button>
                    )}
                    <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-2 rounded-lg shadow-sm">
                        <Image className="text-white" size={18} />
                    </div>
                    <div>
                        <h2 className="font-bold text-slate-800 text-sm">图片 / 视频公式生成器</h2>
                        <p className="text-[11px] text-slate-500">批量生成 Google Sheets =IMAGE() 公式，支持图片及 Google Drive 视频缩略图</p>
                    </div>
                </div>
                <div className="flex items-center gap-2 flex-wrap justify-end">
                    {parsedImages.length > 0 && (
                        <span className="text-xs text-slate-500 bg-white px-2 py-1 rounded-full border border-slate-200 shadow-sm">
                            {validCount} 个链接
                            {driveCount > 0 && <span className="text-blue-600 ml-1">({driveCount} GDrive)</span>}
                            {invalidCount > 0 && <span className="text-amber-600 ml-1">({invalidCount} 无效)</span>}
                        </span>
                    )}
                    <button
                        onClick={() => setFeedbackMode(!feedbackMode)}
                        className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors ${feedbackMode
                            ? 'bg-rose-100 text-rose-700 ring-1 ring-rose-300'
                            : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                            }`}
                        title="开启后可右键标注反馈建议"
                    >
                        <MessageSquarePlus size={12} />
                        {feedbackMode ? '反馈模式 ✓' : '反馈模式'}
                    </button>
                    {feedbackMode && (
                        <button
                            onClick={() => setCanvasViewMode(!canvasViewMode)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors ${canvasViewMode
                                ? 'bg-violet-100 text-violet-700 ring-1 ring-violet-300'
                                : 'bg-white text-slate-600 border border-slate-200 hover:bg-slate-50'
                                }`}
                            title="PureRef 风格平铺画布 - 滚轮缩放，Alt+拖拽平移"
                        >
                            <LayoutGrid size={12} />
                            {canvasViewMode ? '画布视图 ✓' : '画布视图'}
                        </button>
                    )}
                    {Object.values(feedbackMap).filter(f => f.status).length > 0 && (<>
                        <button
                            onClick={handlePreviewFeedback}
                            className={`
                                flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-medium text-[11px] shadow-sm transition-all
                                ${copyFeedbackStatus === 'uploading' 
                                    ? 'bg-slate-100 text-slate-400 cursor-wait' 
                                    : 'bg-indigo-50 text-indigo-600 hover:bg-indigo-100 border border-indigo-200 hover:border-indigo-300'
                                }
                            `}
                            disabled={copyFeedbackStatus === 'uploading'}
                            title="预览即将复制的反馈数据表格"
                        >
                            {copyFeedbackStatus === 'uploading' ? (
                                <><Loader2 size={12} className="animate-spin" /> 上传中</>
                            ) : (
                                <><Eye size={12} /> 预览结果</>
                            )}
                        </button>
                        <button
                            onClick={handleCopyFeedback}
                            className={`
                                flex items-center gap-1.5 px-3.5 py-1.5 rounded-lg font-medium text-[11px] shadow-sm transition-all
                                ${copyFeedbackStatus === 'copied' 
                                    ? 'bg-emerald-500 text-white shadow-emerald-500/20' 
                                    : copyFeedbackStatus === 'uploading'
                                        ? 'bg-slate-100 text-slate-400 cursor-wait'
                                        : 'bg-gradient-to-r from-rose-500 to-rose-600 text-white hover:from-rose-600 hover:to-rose-700 shadow-rose-500/20'
                                }
                            `}
                            disabled={copyFeedbackStatus === 'uploading'}
                        >
                            {copyFeedbackStatus === 'copied' ? (
                                <><Check size={12} /> 已复制</>
                            ) : copyFeedbackStatus === 'uploading' ? (
                                <><Loader2 size={12} className="animate-spin" /> 上传中</>
                            ) : (
                                <><Clipboard size={12} /> 复制反馈 ({Object.values(feedbackMap).filter(f => f.status).length})</>
                            )}
                        </button>
                    </>)}
                    <button
                        onClick={() => setShowSettings(!showSettings)}
                        className={`p-1.5 rounded-lg transition-colors ${showSettings
                            ? 'bg-indigo-100 text-indigo-700 shadow-inner'
                            : 'text-slate-500 hover:bg-white hover:shadow-sm'
                            }`}
                        title="设置"
                    >
                        <Settings size={16} />
                    </button>
                </div>
            </div>

            {/* Settings Panel (Collapsible) */}
            {showSettings && (
                <div className="px-4 py-3 bg-slate-50 border-b border-slate-200 shrink-0">
                    <div className="flex flex-wrap items-center gap-4">
                        {/* Items per row */}
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-slate-600 font-medium whitespace-nowrap">每行个数：</label>
                            <div className="flex items-center gap-1 bg-white rounded-lg border border-slate-200 px-1 py-0.5">
                                {[3, 4, 5, 6, 8, 10, 20, 25, 30, 40].map(n => (
                                    <button
                                        key={n}
                                        onClick={() => setItemsPerRow(n)}
                                        className={`px-2 py-1 text-xs rounded-md transition-colors ${itemsPerRow === n
                                            ? 'bg-indigo-500 text-white shadow-sm'
                                            : 'text-slate-600 hover:bg-slate-100'
                                            }`}
                                    >
                                        {n}
                                    </button>
                                ))}
                                <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={itemsPerRow}
                                    onChange={e => setItemsPerRow(Math.max(1, Math.min(50, Number(e.target.value) || 1)))}
                                    className="w-12 px-1.5 py-1 text-xs border border-slate-200 rounded-md text-center focus:ring-1 focus:ring-indigo-400 outline-none mx-0.5"
                                />
                            </div>
                        </div>

                        {/* Thumbnail size */}
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-slate-600 font-medium whitespace-nowrap">缩略图：</label>
                            <input
                                type="range"
                                min={40}
                                max={200}
                                value={thumbnailSize}
                                onChange={e => setThumbnailSize(Number(e.target.value))}
                                className="w-24 accent-indigo-500"
                            />
                            <span className="text-xs text-slate-500 w-8">{thumbnailSize}px</span>
                        </div>

                        {/* IMAGE mode */}
                        <div className="flex items-center gap-2">
                            <label className="text-xs text-slate-600 font-medium whitespace-nowrap">IMAGE 模式：</label>
                            <select
                                value={imageMode}
                                onChange={e => setImageMode(Number(e.target.value) as 1 | 2 | 4)}
                                className="text-sm font-semibold bg-white border border-slate-300 rounded-md px-2.5 py-1.5 focus:ring-2 focus:ring-indigo-400 outline-none shadow-sm min-w-[220px]"
                                style={{ color: '#0f172a', WebkitTextFillColor: '#0f172a', opacity: 1 }}
                            >
                                <option value={1}>1 - 适应单元格（保留比例）</option>
                                <option value={2}>2 - 拉伸填充</option>
                                <option value={4}>4 - 自定义大小</option>
                            </select>
                        </div>

                        {imageMode === 4 && (
                            <div className="flex items-center gap-2 text-xs">
                                <label className="text-slate-600 font-medium whitespace-nowrap">高:</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={2000}
                                    value={customImageHeight}
                                    onChange={e => setCustomImageHeight(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
                                    className="w-16 px-1.5 py-1 border border-slate-200 rounded-md text-center focus:ring-1 focus:ring-indigo-400 outline-none"
                                />
                                <label className="text-slate-600 font-medium whitespace-nowrap">宽:</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={2000}
                                    value={customImageWidth}
                                    onChange={e => setCustomImageWidth(Math.max(1, Math.min(2000, Number(e.target.value) || 1)))}
                                    className="w-16 px-1.5 py-1 border border-slate-200 rounded-md text-center focus:ring-1 focus:ring-indigo-400 outline-none"
                                />
                            </div>
                        )}

                        {/* Preview toggle */}
                        <button
                            onClick={() => setShowPreview(!showPreview)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors ${showPreview
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-500'
                                }`}
                        >
                            {showPreview ? <Eye size={12} /> : <EyeOff size={12} />}
                            {showPreview ? '显示预览' : '隐藏预览'}
                        </button>

                        {/* Show formula in preview */}
                        <button
                            onClick={() => setShowFormulaInPreview(!showFormulaInPreview)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors ${showFormulaInPreview
                                ? 'bg-purple-100 text-purple-700'
                                : 'bg-slate-100 text-slate-500'
                                }`}
                        >
                            <Sparkles size={12} />
                            {showFormulaInPreview ? '显示公式' : '隐藏公式'}
                        </button>

                        {/* Empty row toggle */}
                        <div
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors ${emptyRowCount > 0
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-500'
                                }`}
                            title="复制时在每组（链接行+公式行）之间插入几行空行"
                        >
                            <Rows size={12} />
                            <label htmlFor="emptyRowCount" className="cursor-pointer">组间空行:</label>
                            <input
                                id="emptyRowCount"
                                type="number"
                                min="0"
                                max="20"
                                value={emptyRowCount}
                                onChange={(e) => setEmptyRowCount(Math.max(0, parseInt(e.target.value) || 0))}
                                className={`w-8 bg-transparent text-center outline-none border-b focus:border-amber-400 ${emptyRowCount > 0 ? 'border-amber-300/50' : 'border-slate-300'}`}
                            />
                        </div>

                        {/* Split horizontal URLs toggle */}
                        <button
                            onClick={() => setSplitHorizontalUrls(!splitHorizontalUrls)}
                            className={`flex items-center gap-1 px-2.5 py-1 rounded-md text-xs transition-colors ${splitHorizontalUrls
                                ? 'bg-blue-100 text-blue-700'
                                : 'bg-slate-100 text-slate-500'
                                }`}
                            title="开启后，横版粘贴的多个链接会拆分为独立行；关闭则保持原样横版排列"
                        >
                            <Columns size={12} />
                            {splitHorizontalUrls ? '拆分横版 ✓' : '保持横版'}
                        </button>

                    </div>

                    {/* Feedback actions (shown when feedback mode is on) */}
                    {feedbackMode && feedbackCount > 0 && (
                        <div className="mt-2 pt-2 border-t border-slate-200 space-y-2">
                            <div className="flex items-center gap-3">
                                <button
                                    onClick={handleCopyFeedback}
                                    disabled={copyFeedbackStatus === 'uploading'}
                                    className={`flex items-center gap-1 px-3 py-1 rounded-md text-xs font-medium transition-all ${copyFeedbackStatus === 'copied'
                                        ? 'bg-green-100 text-green-700'
                                        : copyFeedbackStatus === 'uploading'
                                            ? 'bg-amber-100 text-amber-700 cursor-wait'
                                            : 'bg-rose-500 text-white hover:bg-rose-600 shadow-sm'
                                        }`}
                                >
                                    {copyFeedbackStatus === 'copied' ? <><Check size={12} /> 已复制</> : copyFeedbackStatus === 'uploading' ? <><Loader2 size={12} className="animate-spin" /> 上传中...</> : <><Copy size={12} /> 复制反馈 ({feedbackCount})</>}
                                </button>
                                <button
                                    onClick={() => setShowFeedbackColumnPicker(v => !v)}
                                    className={`flex items-center gap-1 px-2 py-1 rounded-md text-[10px] transition-colors ${
                                        showFeedbackColumnPicker ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-100 text-slate-500 hover:bg-indigo-50'
                                    }`}
                                    title="选择复制反馈时包含的列"
                                >
                                    <Settings size={10} /> 列选项
                                </button>
                                <span className="text-[9px] text-slate-400">
                                    Gyazo 自动上传 ✓
                                </span>
                            </div>

                            {/* Feedback column picker panel */}
                            {showFeedbackColumnPicker && (
                                <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 space-y-2">
                                    {/* Reviewer name input */}
                                    <div className="flex items-center gap-2">
                                        <label className="text-[10px] text-slate-500 font-medium whitespace-nowrap">反馈人:</label>
                                        <input
                                            type="text"
                                            value={reviewerName}
                                            onChange={e => {
                                                setReviewerName(e.target.value);
                                                localStorage.setItem('sheetmind_reviewer_name', e.target.value);
                                            }}
                                            placeholder="输入反馈人名字"
                                            className="flex-1 text-xs border border-slate-300 rounded px-2 py-1 bg-white focus:outline-none focus:ring-1 focus:ring-indigo-400"
                                        />
                                    </div>
                                    <div className="flex items-center justify-between gap-2">
                                        <span className="text-[10px] text-slate-500 font-medium">复制表头</span>
                                        <button
                                            onClick={() => setIncludeFeedbackHeader(v => !v)}
                                            className={`px-2 py-0.5 rounded text-[10px] font-medium border transition-colors ${
                                                includeFeedbackHeader
                                                    ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                                    : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                                            }`}
                                        >
                                            {includeFeedbackHeader ? '开启 ✓' : '关闭（默认）'}
                                        </button>
                                    </div>
                                    {/* Column toggles */}
                                    <div className="flex flex-wrap gap-1.5">
                                        {FEEDBACK_TOGGLE_KEYS.map(col => (
                                            <button
                                                key={col}
                                                onClick={() => setFeedbackColumns(prev => ({ ...prev, [col]: !prev[col] }))}
                                                className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-medium transition-colors border ${
                                                    feedbackColumns[col]
                                                        ? 'bg-indigo-50 text-indigo-700 border-indigo-300'
                                                        : 'bg-white text-slate-400 border-slate-200 hover:border-slate-300'
                                                }`}
                                            >
                                                <span>{FEEDBACK_COLUMN_META[col].icon}</span>
                                                {FEEDBACK_COLUMN_META[col].label}
                                                {feedbackColumns[col] && <Check size={9} />}
                                            </button>
                                        ))}
                                    </div>
                                    <div className="border border-slate-200 rounded-md bg-white p-2 space-y-1.5">
                                        <div className="text-[10px] text-slate-500 font-medium">列顺序（上移/下移）</div>
                                        {activeFeedbackColumnOrder.map(col => {
                                            const idx = feedbackColumnOrder.indexOf(col);
                                            const canUp = idx > 0;
                                            const canDown = idx >= 0 && idx < feedbackColumnOrder.length - 1;
                                            return (
                                                <div key={`order-${col}`} className="flex items-center justify-between gap-2 text-[10px]">
                                                    <span className="text-slate-600 flex items-center gap-1">
                                                        <span>{FEEDBACK_COLUMN_META[col].icon}</span>
                                                        {FEEDBACK_COLUMN_META[col].label}
                                                    </span>
                                                    <div className="flex items-center gap-1">
                                                        <button
                                                            onClick={() => moveFeedbackColumn(col, -1)}
                                                            disabled={!canUp}
                                                            className={`px-1.5 py-0.5 rounded border ${canUp ? 'text-slate-600 border-slate-300 hover:bg-slate-50' : 'text-slate-300 border-slate-200 cursor-not-allowed'}`}
                                                        >
                                                            ↑
                                                        </button>
                                                        <button
                                                            onClick={() => moveFeedbackColumn(col, 1)}
                                                            disabled={!canDown}
                                                            className={`px-1.5 py-0.5 rounded border ${canDown ? 'text-slate-600 border-slate-300 hover:bg-slate-50' : 'text-slate-300 border-slate-200 cursor-not-allowed'}`}
                                                        >
                                                            ↓
                                                        </button>
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                    <div className="text-[9px] text-slate-400">启用的列会按上方顺序复制；可关闭任意列，状态列固定启用。</div>
                                </div>
                            )}
                        </div>
                    )}
                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden min-h-0">

                {/* Left: Input Area */}
                <div className="w-full md:w-[360px] flex flex-col border-r border-slate-200 shrink-0">

                    {/* ── Folder Scanner Toggle ── */}
                    <div className="border-b border-slate-200 shrink-0">
                        <button
                            onClick={() => { setShowFolderScanner(v => !v); setScanStatus('idle'); setScanError(''); }}
                            className={`w-full flex items-center justify-between px-3 py-2 text-xs font-medium transition-colors ${
                                showFolderScanner
                                    ? 'bg-violet-50 text-violet-700'
                                    : 'bg-slate-50 text-slate-600 hover:bg-violet-50/50 hover:text-violet-600'
                            }`}
                        >
                            <span className="flex items-center gap-1.5">
                                <FolderOpen size={13} className={showFolderScanner ? 'text-violet-500' : 'text-slate-400'} />
                                📁 文件夹批量扫描（Google Drive）
                            </span>
                            <ChevronRight size={13} className={`transition-transform ${showFolderScanner ? 'rotate-90' : ''}`} />
                        </button>

                        {showFolderScanner && (
                            <div className="px-3 py-3 bg-violet-50/60 space-y-2.5">
                                {/* Folder URLs (multiple) */}
                                <div>
                                    <label className="text-[10px] text-violet-700 font-semibold mb-1 block">📂 文件夹分享链接（每行一个，支持批量）</label>
                                    <textarea
                                        value={folderUrl}
                                        onChange={e => setFolderUrl(e.target.value)}
                                        placeholder={"粘贴一个或多个文件夹链接：\nhttps://drive.google.com/drive/folders/xxx\nhttps://drive.google.com/drive/folders/yyy"}
                                        rows={3}
                                        className="w-full px-2.5 py-1.5 text-xs font-mono border border-violet-200 rounded-lg bg-white focus:ring-2 focus:ring-violet-400 outline-none placeholder:text-slate-400 resize-none leading-relaxed"
                                    />
                                </div>

                                {/* API Key */}
                                <div>
                                    <label className="text-[10px] text-violet-700 font-semibold mb-1 flex items-center gap-1">
                                        <Key size={10} /> Google Drive API Key
                                        <a
                                            href="https://console.cloud.google.com/apis/library/drive.googleapis.com"
                                            target="_blank"
                                            rel="noreferrer"
                                            className="text-blue-500 hover:underline ml-auto"
                                        >
                                            → 获取免费 Key
                                        </a>
                                    </label>
                                    <div className="flex gap-1">
                                        <input
                                            type={showApiKey ? 'text' : 'password'}
                                            value={driveApiKey}
                                            onChange={e => setDriveApiKey(e.target.value)}
                                            placeholder="AIzaSy…"
                                            className="flex-1 px-2.5 py-1.5 text-xs font-mono border border-violet-200 rounded-lg bg-white focus:ring-2 focus:ring-violet-400 outline-none placeholder:text-slate-400"
                                        />
                                        <button
                                            onClick={() => setShowApiKey(v => !v)}
                                            className="px-2 rounded-lg border border-violet-200 bg-white text-slate-500 hover:text-violet-600 transition-colors"
                                            title={showApiKey ? '隐藏' : '显示'}
                                        >
                                            {showApiKey ? <EyeOff size={12} /> : <Eye size={12} />}
                                        </button>
                                    </div>
                                    <p className="text-[9px] text-slate-400 mt-0.5">Key 保存在本地，用于读取公开文件夹内的视频列表</p>
                                </div>

                                {/* Scan button + progress */}
                                <div className="flex gap-2">
                                    {scanStatus === 'scanning' ? (
                                        <button
                                            onClick={handleFolderScanAbort}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-red-50 text-red-600 border border-red-200 text-xs font-medium hover:bg-red-100 transition-colors"
                                        >
                                            <X size={13} /> 停止扫描
                                        </button>
                                    ) : (
                                        <button
                                            onClick={handleFolderScan}
                                            disabled={!folderUrl.trim() || !driveApiKey.trim()}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-violet-600 text-white text-xs font-semibold hover:bg-violet-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors shadow-sm"
                                        >
                                            <Search size={13} /> 开始扫描视频
                                        </button>
                                    )}
                                    {scanResult.length > 0 && (
                                        <button
                                            onClick={handleAppendScannedVideos}
                                            className="flex-1 flex items-center justify-center gap-1.5 py-2 rounded-lg bg-green-600 text-white text-xs font-semibold hover:bg-green-700 transition-colors shadow-sm"
                                        >
                                            <Plus size={13} /> 导入 {scanResult.length} 个文件{groupByFolder ? ' (按文件夹分组)' : ''}
                                        </button>
                                    )}
                                </div>

                                {/* Status messages */}
                                {scanStatus === 'scanning' && (
                                    <div className="flex items-center gap-2 text-[11px] text-violet-600 bg-violet-100 px-2.5 py-1.5 rounded-lg">
                                        <Loader2 size={12} className="animate-spin shrink-0" />
                                        <span>{scanProgress}</span>
                                    </div>
                                )}
                                {scanStatus === 'done' && scanResult.length === 0 && (
                                    <div className="text-[11px] text-amber-600 bg-amber-50 px-2.5 py-1.5 rounded-lg">
                                        ⚠️ 文件夹中未找到媒体文件（包含所有子文件夹）
                                    </div>
                                )}
                                {scanStatus === 'done' && scanResult.length > 0 && (
                                    <>
                                        {/* Group by folder toggle */}
                                        {(() => {
                                            const uniqueFolders = new Set(scanResult.map(f => f.folderPath || '').filter(Boolean));
                                            return uniqueFolders.size > 0 ? (
                                                <label className="flex items-center gap-2 text-[11px] text-slate-600 cursor-pointer select-none py-0.5">
                                                    <button
                                                        onClick={() => setGroupByFolder(!groupByFolder)}
                                                        className={`relative w-7 h-3.5 rounded-full transition-colors ${groupByFolder ? 'bg-violet-500' : 'bg-slate-300'}`}
                                                    >
                                                        <span className={`absolute top-0.5 w-2.5 h-2.5 bg-white rounded-full shadow transition-all ${groupByFolder ? 'left-[14px]' : 'left-0.5'}`} />
                                                    </button>
                                                    <span>按子文件夹分组导入 <span className="text-violet-500 font-medium">({uniqueFolders.size} 个子文件夹)</span></span>
                                                </label>
                                            ) : null;
                                        })()}
                                        <div className="bg-white border border-green-200 rounded-lg p-2 max-h-36 overflow-y-auto space-y-1">
                                            <p className="text-[10px] font-semibold text-green-700 mb-1">
                                                ✅ 找到 {scanResult.length} 个媒体文件：
                                            </p>
                                            {groupByFolder ? (
                                                // Grouped display
                                                (() => {
                                                    const groups = new Map<string, DriveFile[]>();
                                                    for (const f of scanResult) {
                                                        const key = f.folderPath || '(根目录)';
                                                        if (!groups.has(key)) groups.set(key, []);
                                                        groups.get(key)!.push(f);
                                                    }
                                                    return Array.from(groups.entries()).map(([folder, files]) => (
                                                        <div key={folder} className="mb-1.5">
                                                            <div className="flex items-center gap-1 text-[10px] font-semibold text-violet-700 bg-violet-50 px-1.5 py-0.5 rounded mb-0.5">
                                                                <FolderOpen size={10} className="shrink-0" />
                                                                <span className="truncate" title={folder}>{folder}</span>
                                                                <span className="ml-auto text-violet-400 shrink-0">({files.length})</span>
                                                            </div>
                                                            {files.map(f => (
                                                                <div key={f.id} className="flex items-center gap-1.5 text-[10px] text-slate-600 pl-3">
                                                                    {VIDEO_MIME_TYPES.has(f.mimeType)
                                                                        ? <Film size={9} className="text-violet-400 shrink-0" />
                                                                        : <Image size={9} className="text-sky-400 shrink-0" />
                                                                    }
                                                                    <span className="truncate" title={f.name}>{f.name}</span>
                                                                </div>
                                                            ))}
                                                        </div>
                                                    ));
                                                })()
                                            ) : (
                                                // Flat display
                                                scanResult.map(f => (
                                                    <div key={f.id} className="flex items-center gap-1.5 text-[10px] text-slate-600">
                                                        {VIDEO_MIME_TYPES.has(f.mimeType)
                                                            ? <Film size={10} className="text-violet-400 shrink-0" />
                                                            : <Image size={10} className="text-sky-400 shrink-0" />
                                                        }
                                                        <span className="truncate" title={f.name}>
                                                            {f.folderPath ? <span className="text-slate-400">{f.folderPath}/</span> : null}
                                                            {f.name}
                                                        </span>
                                                    </div>
                                                ))
                                            )}
                                        </div>
                                    </>
                                )}
                                {scanStatus === 'error' && (
                                    <div className="text-[11px] text-red-600 bg-red-50 border border-red-200 px-2.5 py-1.5 rounded-lg">
                                        ❌ {scanError}
                                    </div>
                                )}
                            </div>
                        )}
                    </div>

                    {/* ── Manual link input ── */}
                    <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
                        <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                            <Link2 size={12} className="text-blue-500" />
                            粘贴图片 / 视频链接（每行一个）
                        </span>
                        {inputText && (
                            <button
                                onClick={handleClear}
                                className="text-xs text-slate-400 hover:text-red-500 flex items-center gap-1 transition-colors"
                            >
                                <Trash2 size={11} /> 清空
                            </button>
                        )}
                    </div>
                    <textarea
                        ref={textareaRef}
                        value={inputText}
                        onChange={e => setInputText(e.target.value)}
                        onPaste={handlePaste}
                        placeholder={"粘贴图片或 Google Drive 视频链接，每行一个：\n\nhttps://example.com/image1.jpg\nhttps://drive.google.com/file/d/xxx/view\nhttps://drive.google.com/open?id=xxx\n\n🎬 Google Drive 视频 → 自动生成视频缩略图公式\n🖼️ 图片链接 → 直接生成 =IMAGE() 公式\n📎 支持从 Google Sheets 粘贴超链接单元格\n💡 也支持 =HYPERLINK() / =IMAGE() 公式"}
                        className="flex-1 px-3 py-2 text-xs font-mono text-slate-700 resize-none outline-none focus:bg-blue-50/30 transition-colors leading-relaxed placeholder:text-slate-350 placeholder:leading-relaxed"
                        spellCheck={false}
                    />

                    {/* Action Buttons */}
                    <div className="px-3 py-2.5 border-t border-slate-200 bg-white shrink-0 space-y-2">
                        {/* Primary: Copy for Google Sheets */}
                        <button
                            onClick={handleCopy}
                            disabled={parsedImages.length === 0}
                            className={`w-full flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-semibold transition-all disabled:opacity-40 disabled:cursor-not-allowed ${copyStatus === 'copied'
                                ? 'bg-green-500 text-white shadow-md'
                                : 'bg-gradient-to-r from-blue-500 to-indigo-600 text-white hover:from-blue-600 hover:to-indigo-700 shadow-md hover:shadow-lg active:scale-[0.98]'
                                }`}
                        >
                            {copyStatus === 'copied' ? (
                                <><Check size={16} /> 已复制！粘贴到 Google Sheets 即可</>
                            ) : (
                                <><Copy size={16} /> 复制版式到 Google Sheets</>
                            )}
                        </button>
                        <div className="flex gap-2">
                            <button
                                onClick={handleCopyUrls}
                                disabled={parsedImages.length === 0}
                                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${copyUrlStatus === 'copied'
                                    ? 'bg-green-50 text-green-600 border-green-200'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                                    }`}
                            >
                                {copyUrlStatus === 'copied' ? <Check size={12} /> : <Link2 size={12} />}
                                {copyUrlStatus === 'copied' ? '已复制链接' : '仅复制链接'}
                            </button>
                            <button
                                onClick={handleCopyFormulasOnly}
                                disabled={parsedImages.length === 0}
                                className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${copyFormulaStatus === 'copied'
                                    ? 'bg-green-50 text-green-600 border-green-200'
                                    : 'bg-white text-slate-600 border-slate-200 hover:bg-slate-50 hover:border-slate-300'
                                    }`}
                            >
                                {copyFormulaStatus === 'copied' ? <Check size={12} /> : <Clipboard size={12} />}
                                {copyFormulaStatus === 'copied' ? '已复制公式' : '原始顺序公式'}
                            </button>
                            <button
                                onClick={handleClear}
                                disabled={parsedImages.length === 0}
                                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-500 border border-slate-200 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <Trash2 size={12} /> 清空
                            </button>
                        </div>
                        {/* Grouped copy — only show when there are folder-grouped files */}
                        {parsedImages.some(img => img.infoText?.trim()) && (
                            <div className="space-y-1.5">
                                {/* Mode toggle */}
                                <div className="flex items-center gap-1 justify-center">
                                    <span className="text-[10px] text-slate-400 mr-1">分组模式:</span>
                                    <button
                                        onClick={() => setGroupedCopyMode('horizontal')}
                                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all border ${groupedCopyMode === 'horizontal'
                                            ? 'bg-violet-100 text-violet-700 border-violet-300'
                                            : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'
                                        }`}
                                    >
                                        并排
                                    </button>
                                    <button
                                        onClick={() => setGroupedCopyMode('vertical')}
                                        className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all border ${groupedCopyMode === 'vertical'
                                            ? 'bg-violet-100 text-violet-700 border-violet-300'
                                            : 'bg-white text-slate-400 border-slate-200 hover:text-slate-600'
                                        }`}
                                    >
                                        竖版
                                    </button>
                                </div>
                                <button
                                    onClick={handleCopyGrouped}
                                    disabled={parsedImages.length === 0}
                                    className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-xs font-semibold transition-all border disabled:opacity-40 disabled:cursor-not-allowed ${copyGroupedStatus === 'copied'
                                        ? 'bg-green-50 text-green-600 border-green-200'
                                        : 'bg-violet-50 text-violet-700 border-violet-200 hover:bg-violet-100 hover:border-violet-300'
                                        }`}
                                >
                                    {copyGroupedStatus === 'copied' ? (
                                        <><Check size={14} /> 已复制！粘贴到 Sheets 即可</>
                                    ) : groupedCopyMode === 'horizontal' ? (
                                        <><Columns size={14} /> 分组复制：分类|链接|公式 × N组并排</>
                                    ) : (
                                        <><Rows size={14} /> 分组复制：分类|链接|公式（竖版3列）</>
                                    )}
                                </button>
                            </div>
                        )}
                        <p className="text-[10px] text-slate-400 text-center">
                            ⌘+Enter 快捷复制 • 复制后直接 Ctrl+V 到 Google Sheets
                        </p>
                    </div>
                </div>

                {/* Right: Preview Area */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    {/* Always show the table preview */}
                    <>
                    <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
                        <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                            <Grid size={12} className="text-indigo-500" />
                            预览 —— 粘贴后在 Google Sheets 中的效果
                        </span>
                        <div className="flex items-center gap-2 flex-wrap justify-end">
                            <span className="text-[10px] text-slate-400">
                                {imageRows.length} 组 × {itemsPerRow} 列
                            </span>
                            {feedbackMode && (
                                <>
                                    <button
                                        onClick={() => {
                                            setBatchSelectMode(v => !v);
                                            setSelectedImageIds(new Set());
                                        }}
                                        className={`px-2 py-1 rounded text-[10px] font-medium border transition-colors ${
                                            batchSelectMode
                                                ? 'bg-emerald-50 text-emerald-700 border-emerald-300'
                                                : 'bg-white text-slate-500 border-slate-200 hover:bg-emerald-50 hover:text-emerald-700'
                                        }`}
                                    >
                                        {batchSelectMode ? '退出批量' : '批量选择'}
                                    </button>
                                    {batchSelectMode && (
                                        <>
                                            <span className="text-[10px] text-emerald-600 font-medium">
                                                已选 {selectedImageIds.size}
                                            </span>
                                            <button
                                                onClick={selectAllBatchTargets}
                                                className="px-2 py-1 rounded text-[10px] font-medium border bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                                            >
                                                全选
                                            </button>
                                            <button
                                                onClick={() => setSelectedImageIds(new Set())}
                                                className="px-2 py-1 rounded text-[10px] font-medium border bg-white text-slate-500 border-slate-200 hover:bg-slate-50"
                                            >
                                                清空选择
                                            </button>
                                            <button
                                                onClick={() => applyBatchFeedbackStatus('approved')}
                                                disabled={selectedImageIds.size === 0}
                                                className="px-2 py-1 rounded text-[10px] font-medium border bg-emerald-50 text-emerald-700 border-emerald-300 disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                设为可用
                                            </button>
                                            <button
                                                onClick={() => applyBatchFeedbackStatus('rejected')}
                                                disabled={selectedImageIds.size === 0}
                                                className="px-2 py-1 rounded text-[10px] font-medium border bg-rose-50 text-rose-700 border-rose-300 disabled:opacity-40 disabled:cursor-not-allowed"
                                            >
                                                设为不可用
                                            </button>
                                        </>
                                    )}
                                </>
                            )}
                        </div>
                    </div>

                    <div className="flex-1 overflow-auto p-4 bg-gradient-to-br from-slate-50 to-white">
                        {parsedImages.length === 0 ? (
                            /* Empty state */
                            <div className="h-full flex flex-col items-center justify-center text-slate-400">
                                <div className="bg-slate-100 p-6 rounded-2xl mb-4">
                                    <Image size={40} className="opacity-40" />
                                </div>
                                <p className="text-sm font-medium mb-1">在左侧粘贴图片链接开始</p>
                                <p className="text-xs text-slate-400 max-w-xs text-center leading-relaxed">
                                    支持一次粘贴多个链接，将自动生成 Google Sheets 的<br />
                                    <code className="bg-slate-100 px-1 py-0.5 rounded text-indigo-600">=IMAGE()</code> 公式
                                </p>
                            </div>
                        ) : (
                            /* Preview grid */
                            <div className="space-y-4">
                                {imageRows.map((row, rowIdx) => (
                                    <div
                                        key={rowIdx}
                                        className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm hover:shadow-md transition-shadow"
                                    >
                                        {/* Row header */}
                                        <div className="px-3 py-1.5 bg-slate-50 border-b border-slate-100 flex items-center justify-between">
                                            <span className="text-[10px] text-slate-400 font-medium">
                                                第 {rowIdx + 1} 组 ({row.length} 个)
                                            </span>
                                            <span className="text-[10px] text-slate-400">
                                                {(() => {
                                                    const rowsPerGroup = 2 + emptyRowCount;
                                                    const startRow = rowIdx * rowsPerGroup + 1;
                                                    return `行 ${startRow}-${startRow + 1}`;
                                                })()}
                                            </span>
                                        </div>

                                        {/* Spreadsheet-like grid */}
                                        <div className="overflow-x-auto">
                                            <table className="w-full border-collapse text-xs">
                                                <tbody>
                                                    <tr className="bg-blue-50/50">
                                                        <td className="px-2 py-1 border-r border-b border-slate-200 bg-slate-100 text-[10px] text-slate-500 font-medium w-8 text-center whitespace-nowrap">
                                                            链接
                                                        </td>
                                                        {row.map((img, colIdx) => (
                                                            <td
                                                                key={`url-${colIdx}`}
                                                                className="px-2 py-1.5 border-r border-b border-slate-200 max-w-[160px]"
                                                                style={{ minWidth: thumbnailSize + 20 }}
                                                            >
                                                                <div className="flex items-center gap-1">
                                                                    {img.isGoogleDrive ? (
                                                                        <span className="shrink-0 text-[8px] bg-blue-100 text-blue-600 px-1 py-0.5 rounded font-medium" title="Google Drive 链接已自动转换">GD</span>
                                                                    ) : img.isValid ? (
                                                                        <Link2 size={10} className="text-blue-400 shrink-0" />
                                                                    ) : (
                                                                        <AlertCircle size={10} className="text-amber-500 shrink-0" />
                                                                    )}
                                                                    <span className="truncate text-[10px] text-slate-600 font-mono" title={img.originalUrl}>
                                                                        {img.originalUrl}
                                                                    </span>
                                                                </div>
                                                            </td>
                                                        ))}
                                                    </tr>

                                                    {/* Row 2: Thumbnails / Formulas */}
                                                    <tr>
                                                        <td className="px-2 py-1 border-r border-b border-slate-200 bg-slate-100 text-[10px] text-slate-500 font-medium w-8 text-center whitespace-nowrap">
                                                            缩略图
                                                        </td>
                                                        {row.map((img, colIdx) => (
                                                            <td
                                                                key={`thumb-${colIdx}`}
                                                                className="px-2 py-2 border-r border-b border-slate-200 text-center"
                                                                style={{ minWidth: thumbnailSize + 20 }}
                                                            >
                                                                {showPreview && img.isValid ? (
                                                                    <div className="flex flex-col items-center gap-1">
                                                                        {(() => {
                                                                            const fallbackIdx = previewFallbackIndex[img.id] || 0;
                                                                            const currentPreviewUrl = (img.previewUrls && img.previewUrls[fallbackIdx]) || img.previewUrl;
                                                                            return (
                                                                        <div
                                                                            className={`rounded-md overflow-hidden border bg-slate-50 shadow-sm hover:shadow-md transition-all cursor-pointer group relative ${
                                                                                feedbackMode && batchSelectMode && selectedImageIds.has(img.id)
                                                                                    ? 'border-emerald-400 ring-2 ring-emerald-200'
                                                                                    : feedbackMode
                                                                                        ? 'hover:border-rose-300 border-slate-200'
                                                                                        : 'hover:border-indigo-300 border-slate-200'
                                                                            }`}
                                                                            style={{ width: thumbnailSize, height: thumbnailSize }}
                                                                            onClick={() => {
                                                                                if (feedbackMode && batchSelectMode) {
                                                                                    toggleBatchSelectImage(img.id);
                                                                                    return;
                                                                                }
                                                                                if (img.isGoogleDrive && img.driveFileId) {
                                                                                    setDrivePreviewId(img.driveFileId);
                                                                                    setDrivePreviewName(img.originalUrl);
                                                                                } else {
                                                                                    window.open(img.originalUrl, '_blank');
                                                                                }
                                                                            }}
                                                                            onContextMenu={e => handleThumbnailContextMenu(e, img)}
                                                                        >
                                                                            <img
                                                                                src={currentPreviewUrl}
                                                                                alt=""
                                                                                referrerPolicy="no-referrer"
                                                                                className={`w-full h-full ${imageMode === 2 ? 'object-fill' : 'object-contain'}`}
                                                                                style={{ position: 'relative', zIndex: 2 }}
                                                                                loading="lazy"
                                                                                onError={(e) => {
                                                                                    const nextIndex = fallbackIdx + 1;
                                                                                    const hasNext = !!(img.previewUrls && nextIndex < img.previewUrls.length);
                                                                                    if (hasNext) {
                                                                                        setPreviewFallbackIndex(prev => ({ ...prev, [img.id]: nextIndex }));
                                                                                        return;
                                                                                    }
                                                                                    // Hide failed img to reveal iframe behind it
                                                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                                                }}
                                                                            />
                                                                            {/* Drive embed iframe as fallback thumbnail */}
                                                                            {img.isGoogleDrive && img.driveFileId && (
                                                                                <iframe
                                                                                    src={`https://drive.google.com/file/d/${img.driveFileId}/preview`}
                                                                                    className="absolute inset-0 w-full h-full border-0"
                                                                                    style={{ zIndex: 1, pointerEvents: 'none' }}
                                                                                    loading="lazy"
                                                                                    tabIndex={-1}
                                                                                />
                                                                            )}
                                                                            {/* Generic fallback for non-Drive files */}
                                                                            {!img.isGoogleDrive && (
                                                                            <div className="hidden absolute inset-0 items-center justify-center bg-gradient-to-br from-slate-100 to-slate-200 text-slate-400 flex-col gap-1.5" style={{ display: 'none' }}>
                                                                                <AlertCircle size={20} />
                                                                            </div>
                                                                            )}
                                                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                                                                {!feedbackMode && (
                                                                                    <ExternalLink size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                                                                                )}
                                                                            </div>
                                                                            {feedbackMode && batchSelectMode && (
                                                                                <button
                                                                                    onClick={(e) => {
                                                                                        e.stopPropagation();
                                                                                        toggleBatchSelectImage(img.id);
                                                                                    }}
                                                                                    className={`absolute top-0.5 left-4 w-4 h-4 rounded border text-[10px] font-bold flex items-center justify-center ${
                                                                                        selectedImageIds.has(img.id)
                                                                                            ? 'bg-emerald-500 border-emerald-400 text-white'
                                                                                            : 'bg-black/55 border-white/60 text-white/80'
                                                                                    }`}
                                                                                    title={selectedImageIds.has(img.id) ? '取消选择' : '选择此项'}
                                                                                >
                                                                                    {selectedImageIds.has(img.id) ? '✓' : ''}
                                                                                </button>
                                                                            )}
                                                                            {/* Feedback status badge */}
                                                                            {feedbackMap[img.id]?.status && (
                                                                                <div
                                                                                    className="absolute top-0.5 right-0.5 rounded-full text-[8px] font-bold px-1 leading-4"
                                                                                    style={{
                                                                                        background: feedbackMap[img.id]?.status === 'approved' ? '#22c55e'
                                                                                            : feedbackMap[img.id]?.status === 'rejected' ? '#ef4444' : '#eab308',
                                                                                        color: '#fff',
                                                                                    }}
                                                                                >
                                                                                    {feedbackMap[img.id]?.status === 'approved' ? '✓' : feedbackMap[img.id]?.status === 'rejected' ? '✗' : '⚠'}
                                                                                </div>
                                                                            )}
                                                                            {/* Annotation/text indicators */}
                                                                            {normalizeFeedbackScreenshots(feedbackMap[img.id] as any).length > 0 && (
                                                                                <div className="absolute top-0.5 left-0.5 w-3.5 h-3.5 bg-rose-500 rounded-full flex items-center justify-center" title={`${normalizeFeedbackScreenshots(feedbackMap[img.id] as any).length} 张标注`}>
                                                                                    <PenLine size={8} className="text-white" />
                                                                                </div>
                                                                            )}
                                                                            {/* Info text label from first column */}
                                                                            {img.infoText && (
                                                                                <div
                                                                                    className="absolute bottom-0 left-0 right-0 text-[8px] text-white font-medium truncate px-1 py-0.5"
                                                                                    style={{ background: 'rgba(0,0,0,0.55)', lineHeight: '1.3', zIndex: 2 }}
                                                                                    title={img.infoText}
                                                                                >
                                                                                    {img.infoText}
                                                                                </div>
                                                                            )}
                                                                            {/* Three feedback buttons at bottom */}
                                                                            {feedbackMode && (
                                                                                <div
                                                                                    className="absolute bottom-0 left-0 right-0 flex opacity-0 group-hover:opacity-100 transition-opacity"
                                                                                    style={{ background: 'rgba(0,0,0,0.65)' }}
                                                                                    onClick={e => e.stopPropagation()}
                                                                                >
                                                                                    {(['approved', 'needs-edit', 'rejected'] as const).map(status => {
                                                                                        const icons = { approved: '✅', 'needs-edit': '⚠️', rejected: '❌' };
                                                                                        const isActive = feedbackMap[img.id]?.status === status;
                                                                                        const hasSuggestion = status === 'needs-edit' && Boolean(
                                                                                            (feedbackMap[img.id]?.text || '').trim()
                                                                                            || normalizeFeedbackScreenshots(feedbackMap[img.id] as any).length > 0
                                                                                        );
                                                                                        const icon = status === 'needs-edit' && isActive && hasSuggestion ? '👁️' : icons[status];
                                                                                        return (
                                                                                            <button
                                                                                                key={status}
                                                                                                onClick={(e) => {
                                                                                                    e.stopPropagation();
                                                                                                    if (status === 'needs-edit') {
                                                                                                        if (isActive) {
                                                                                                            if (hasSuggestion) {
                                                                                                                setFeedbackModalImg(img);
                                                                                                            } else {
                                                                                                                handleFeedbackStatusChange(img.id, null);
                                                                                                            }
                                                                                                            return;
                                                                                                        }
                                                                                                        handleFeedbackStatusChange(img.id, status);
                                                                                                        setFeedbackModalImg(img);
                                                                                                        return;
                                                                                                    }
                                                                                                    handleFeedbackStatusChange(img.id, isActive ? null : status);
                                                                                                }}
                                                                                                style={{
                                                                                                    flex: 1, border: 'none', cursor: 'pointer',
                                                                                                    background: isActive ? 'rgba(255,255,255,0.2)' : 'transparent',
                                                                                                    padding: '3px 0', fontSize: 10,
                                                                                                    transition: 'background 0.15s',
                                                                                                }}
                                                                                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(255,255,255,0.15)'; }}
                                                                                                onMouseLeave={e => { e.currentTarget.style.background = isActive ? 'rgba(255,255,255,0.2)' : 'transparent'; }}
                                                                                                title={status === 'approved' ? '可以使用' : status === 'needs-edit' ? (isActive && hasSuggestion ? '查看建议' : '需要修改') : '不可使用'}
                                                                                            >
                                                                                                {icon}
                                                                                            </button>
                                                                                        );
                                                                                    })}
                                                                                </div>
                                                                            )}
                                                                        </div>
                                                                            );
                                                                        })()}
                                                                        {showFormulaInPreview && (
                                                                            <code className="text-[9px] text-indigo-500 bg-indigo-50 px-1.5 py-0.5 rounded max-w-full truncate block" title={img.formula}>
                                                                                {img.formula}
                                                                            </code>
                                                                        )}
                                                                    </div>
                                                                ) : (
                                                                    <code className="text-[10px] text-green-700 bg-green-50 px-2 py-1 rounded block truncate" title={img.formula}>
                                                                        {img.formula}
                                                                    </code>
                                                                )}
                                                            </td>
                                                        ))}
                                                    </tr>

                                                    {/* Row 3: Feedback (when feedback mode is on) */}
                                                    {feedbackMode && (
                                                        <tr className="bg-rose-50/30">
                                                            <td className="px-2 py-1 border-r border-b border-slate-200 bg-rose-50 text-[10px] text-rose-500 font-medium w-8 text-center whitespace-nowrap">
                                                                建议
                                                            </td>
                                                            {row.map((img, colIdx) => (
                                                                <td
                                                                    key={`fb-${colIdx}`}
                                                                    className="px-1 py-1.5 border-r border-b border-slate-200"
                                                                    style={{ minWidth: thumbnailSize + 20, verticalAlign: 'top' }}
                                                                >
                                                                    <div className="flex flex-col gap-1">
                                                                        {/* Annotated screenshot thumbnails (multi) */}
                                                                        {(() => {
                                                                            const screenshots = normalizeFeedbackScreenshots(feedbackMap[img.id] as any);
                                                                            if (screenshots.length === 0) return null;
                                                                            return screenshots.map((ss, ssIdx) => (
                                                                                <div key={ss.id || ssIdx} className="relative" style={{ marginBottom: 2 }}>
                                                                                    <img
                                                                                        src={ss.dataUrl}
                                                                                        className="w-full rounded border border-rose-200 cursor-pointer hover:border-rose-400 transition-colors"
                                                                                        style={{ maxHeight: 50, objectFit: 'contain' }}
                                                                                        onClick={() => window.open(ss.gyazoPermalink || ss.gyazoUrl || ss.dataUrl, '_blank')}
                                                                                        alt={`标注 ${ssIdx + 1}`}
                                                                                    />
                                                                                    {ss.uploading && (
                                                                                        <div className="absolute inset-0 bg-black/40 flex items-center justify-center rounded">
                                                                                            <Loader2 size={10} className="text-white animate-spin" />
                                                                                        </div>
                                                                                    )}
                                                                                    <span className="absolute top-0 left-0 text-[6px] bg-slate-700 text-slate-300 px-1 rounded-br" style={{ lineHeight: '14px' }}>
                                                                                        {SCREENSHOT_SOURCE_LABEL[ss.source] || ss.source}
                                                                                    </span>
                                                                                    {ss.gyazoUrl && (
                                                                                        <span className="absolute bottom-0 right-0 text-[6px] bg-green-500 text-white px-0.5 rounded-tl">✓</span>
                                                                                    )}
                                                                                </div>
                                                                            ));
                                                                        })()}
                                                                        {/* Text feedback */}
                                                                        {editingFeedbackText === img.id ? (
                                                                            <textarea
                                                                                autoFocus
                                                                                value={feedbackMap[img.id]?.text || ''}
                                                                                onChange={e => updateFeedbackText(img.id, e.target.value)}
                                                                                onBlur={() => setEditingFeedbackText(null)}
                                                                                onKeyDown={e => { if (e.key === 'Escape') setEditingFeedbackText(null); }}
                                                                                className="w-full text-[10px] px-1.5 py-1 border border-rose-300 rounded bg-white outline-none focus:ring-1 focus:ring-rose-300 resize-none"
                                                                                rows={2}
                                                                                placeholder="输入建议…"
                                                                            />
                                                                        ) : (
                                                                            <div
                                                                                onClick={() => setEditingFeedbackText(img.id)}
                                                                                className="text-[10px] text-slate-500 px-1.5 py-0.5 rounded cursor-text hover:bg-rose-50 transition-colors min-h-[20px] border border-transparent hover:border-rose-200"
                                                                                title="点击输入文字建议"
                                                                            >
                                                                                {feedbackMap[img.id]?.text || (
                                                                                    <span className="text-slate-300 italic">点击输入…</span>
                                                                                )}
                                                                            </div>
                                                                        )}
                                                                        {/* Quick actions */}
                                                                        <div className="flex gap-0.5">
                                                                            <button
                                                                                onClick={() => openAnnotation(img)}
                                                                                className="text-[9px] text-rose-500 hover:bg-rose-100 rounded px-1 py-0.5 transition-colors flex items-center gap-0.5"
                                                                                title="标注截图"
                                                                            >
                                                                                <PenLine size={9} /> 标注
                                                                            </button>
                                                                        </div>
                                                                    </div>
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    )}

                                                    {/* 组间空行预览 */}
                                                    {emptyRowCount > 0 && rowIdx < imageRows.length - 1 && (
                                                        <tr className="bg-amber-50/40">
                                                            <td className="px-2 py-1 border-r border-b border-slate-200 bg-amber-50/60 text-[10px] text-amber-400 font-medium w-8 text-center whitespace-nowrap">
                                                                空
                                                            </td>
                                                            {row.map((_, colIdx) => (
                                                                <td
                                                                    key={`empty-${colIdx}`}
                                                                    className="px-2 py-2 border-r border-b border-slate-200 border-dashed"
                                                                    style={{ minWidth: thumbnailSize + 20 }}
                                                                />
                                                            ))}
                                                        </tr>
                                                    )}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ))}

                                {/* Summary */}
                                <div className="text-center py-4">
                                    <div className="inline-flex items-center gap-3 px-4 py-2 bg-slate-100 rounded-full text-xs text-slate-500">
                                        <span>共 <strong className="text-slate-700">{parsedImages.length}</strong> 个文件</span>
                                        <span className="text-slate-300">|</span>
                                        <span>分 <strong className="text-slate-700">{imageRows.length}</strong> 组</span>
                                        <span className="text-slate-300">|</span>
                                        <span>每行 <strong className="text-slate-700">{itemsPerRow}</strong> 个</span>
                                        <span className="text-slate-300">|</span>
                                        <span>共 <strong className="text-slate-700">{imageRows.length * 2 + Math.max(0, imageRows.length - 1) * emptyRowCount}</strong> 行{emptyRowCount > 0 && <span className="text-amber-500 ml-0.5">(含空行)</span>}</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                    </>
                </div>
            </div>

            {/* ── Fullscreen Canvas View Modal (Portal to body) ── */}
            {feedbackMode && canvasViewMode && createPortal(
                <div
                    style={{
                        position: 'fixed', inset: 0, zIndex: 99999,
                        background: '#0f0f13',
                        display: 'flex', flexDirection: 'column',
                    }}
                >
                    {/* Canvas header */}
                    <div style={{
                        display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                        padding: '6px 16px', borderBottom: '1px solid #2a2a32',
                        background: 'rgba(0,0,0,0.4)', flexShrink: 0,
                        backdropFilter: 'blur(8px)',
                    }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 13, fontWeight: 600, color: '#e2e8f0' }}>
                                🖼️ 画布视图
                            </span>
                            <span style={{ fontSize: 11, color: '#64748b' }}>
                                {enrichedImages.filter(i => i.isValid).length} 个文件
                            </span>
                        </div>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                            {/* Reviewer name - always visible */}
                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                <label style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, whiteSpace: 'nowrap' }}>👤</label>
                                <input
                                    type="text"
                                    value={reviewerName}
                                    onChange={e => {
                                        setReviewerName(e.target.value);
                                        localStorage.setItem('sheetmind_reviewer_name', e.target.value);
                                    }}
                                    placeholder="反馈人"
                                    style={{
                                        width: 80, fontSize: 11, padding: '3px 6px',
                                        border: '1px solid #334155', borderRadius: 4,
                                        background: '#1e293b', color: '#e2e8f0',
                                        outline: 'none',
                                    }}
                                />
                            </div>
                            {Object.values(feedbackMap).filter(f => f.status).length > 0 && (<>
                                <button
                                    onClick={handlePreviewFeedback}
                                    disabled={copyFeedbackStatus === 'uploading'}
                                    style={{
                                        background: 'rgba(99,102,241,0.2)',
                                        border: '1px solid rgba(99,102,241,0.5)', borderRadius: 6,
                                        color: '#a5b4fc', cursor: copyFeedbackStatus === 'uploading' ? 'wait' : 'pointer', padding: '4px 12px',
                                        fontSize: 11, fontWeight: 600,
                                        display: 'flex', alignItems: 'center', gap: 4,
                                    }}
                                >
                                    {copyFeedbackStatus === 'uploading' ? '上传中...' : '👁️ 预览结果'}
                                </button>
                                <button
                                    onClick={handleCopyFeedback}
                                    disabled={copyFeedbackStatus === 'uploading'}
                                    style={{
                                        background: copyFeedbackStatus === 'copied' ? '#22c55e' : copyFeedbackStatus === 'uploading' ? '#475569' : 'linear-gradient(135deg, #e11d48, #be123c)',
                                        border: 'none', borderRadius: 6,
                                        color: '#fff', cursor: copyFeedbackStatus === 'uploading' ? 'wait' : 'pointer', padding: '4px 12px',
                                        fontSize: 11, fontWeight: 600,
                                        display: 'flex', alignItems: 'center', gap: 4,
                                    }}
                                >
                                    {copyFeedbackStatus === 'copied' ? '✓ 已复制' : copyFeedbackStatus === 'uploading' ? '上传中...' : `📋 复制反馈 (${Object.values(feedbackMap).filter(f => f.status).length})`}
                                </button>
                                <button
                                    onClick={() => setShowFeedbackColumnPicker(v => !v)}
                                    style={{
                                        background: showFeedbackColumnPicker ? 'rgba(99,102,241,0.3)' : 'rgba(255,255,255,0.1)',
                                        border: showFeedbackColumnPicker ? '1px solid rgba(99,102,241,0.5)' : '1px solid transparent',
                                        borderRadius: 6,
                                        color: showFeedbackColumnPicker ? '#a5b4fc' : '#94a3b8',
                                        cursor: 'pointer', padding: '4px 8px',
                                        fontSize: 10, display: 'flex', alignItems: 'center', gap: 3,
                                    }}
                                    title="选择复制反馈时包含的列"
                                >
                                    <Settings size={10} /> 列选项
                                </button>
                                <button
                                    onClick={() => setIncludeThumbnailInCopy(v => !v)}
                                    style={{
                                        background: includeThumbnailInCopy ? 'rgba(16,185,129,0.25)' : 'rgba(255,255,255,0.1)',
                                        border: includeThumbnailInCopy ? '1px solid rgba(52,211,153,0.5)' : '1px solid transparent',
                                        borderRadius: 6,
                                        color: includeThumbnailInCopy ? '#6ee7b7' : '#94a3b8',
                                        cursor: 'pointer', padding: '4px 8px',
                                        fontSize: 10, display: 'flex', alignItems: 'center', gap: 3,
                                        transition: 'all 0.15s',
                                    }}
                                    title="复制反馈时附带原图缩略图（=IMAGE公式），方便核对顺序"
                                >
                                    🌅 含缩略图 {includeThumbnailInCopy && '✓'}
                                </button>
                            </>)}
                            <button
                                onClick={() => setCanvasViewMode(false)}
                                style={{
                                    background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 6,
                                    color: '#94a3b8', cursor: 'pointer', padding: '4px 12px',
                                    fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
                                }}
                            >
                                ✕ 关闭画布
                            </button>
                        </div>
                    </div>

                    {/* Column picker panel (canvas view) */}
                    {showFeedbackColumnPicker && (
                        <div style={{
                            padding: '10px 16px', background: 'rgba(15,18,30,0.95)',
                            borderBottom: '1px solid #2a2a32', flexShrink: 0,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
                                <span style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600 }}>复制表头</span>
                                <button
                                    onClick={() => setIncludeFeedbackHeader(v => !v)}
                                    style={{
                                        padding: '3px 8px',
                                        borderRadius: 4,
                                        fontSize: 10,
                                        fontWeight: 600,
                                        cursor: 'pointer',
                                        border: includeFeedbackHeader ? '1px solid rgba(52,211,153,0.5)' : '1px solid #334155',
                                        background: includeFeedbackHeader ? 'rgba(16,185,129,0.18)' : 'rgba(255,255,255,0.05)',
                                        color: includeFeedbackHeader ? '#6ee7b7' : '#64748b',
                                    }}
                                >
                                    {includeFeedbackHeader ? '开启 ✓' : '关闭（默认）'}
                                </button>
                            </div>
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                                {FEEDBACK_TOGGLE_KEYS.map(col => (
                                    <button
                                        key={col}
                                        onClick={() => setFeedbackColumns(prev => ({ ...prev, [col]: !prev[col] }))}
                                        style={{
                                            display: 'flex', alignItems: 'center', gap: 4,
                                            padding: '3px 8px', borderRadius: 4, fontSize: 10, fontWeight: 500,
                                            cursor: 'pointer',
                                            border: feedbackColumns[col] ? '1px solid rgba(99,102,241,0.5)' : '1px solid #334155',
                                            background: feedbackColumns[col] ? 'rgba(99,102,241,0.15)' : 'rgba(255,255,255,0.05)',
                                            color: feedbackColumns[col] ? '#a5b4fc' : '#64748b',
                                        }}
                                    >
                                        <span>{FEEDBACK_COLUMN_META[col].icon}</span> {FEEDBACK_COLUMN_META[col].label} {feedbackColumns[col] && '✓'}
                                    </button>
                                ))}
                            </div>
                            <div style={{ marginTop: 8, border: '1px solid #334155', borderRadius: 6, padding: '6px 8px', background: 'rgba(255,255,255,0.02)' }}>
                                <div style={{ fontSize: 10, color: '#94a3b8', fontWeight: 600, marginBottom: 6 }}>列顺序（上移/下移）</div>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                                    {activeFeedbackColumnOrder.map(col => {
                                        const idx = feedbackColumnOrder.indexOf(col);
                                        const canUp = idx > 0;
                                        const canDown = idx >= 0 && idx < feedbackColumnOrder.length - 1;
                                        return (
                                            <div key={`canvas-order-${col}`} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                                                <span style={{ fontSize: 10, color: '#cbd5e1', display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <span>{FEEDBACK_COLUMN_META[col].icon}</span>
                                                    {FEEDBACK_COLUMN_META[col].label}
                                                </span>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                    <button
                                                        onClick={() => moveFeedbackColumn(col, -1)}
                                                        disabled={!canUp}
                                                        style={{
                                                            borderRadius: 4,
                                                            border: canUp ? '1px solid #475569' : '1px solid #334155',
                                                            background: 'transparent',
                                                            color: canUp ? '#cbd5e1' : '#475569',
                                                            cursor: canUp ? 'pointer' : 'not-allowed',
                                                            fontSize: 10,
                                                            padding: '1px 6px',
                                                        }}
                                                    >
                                                        ↑
                                                    </button>
                                                    <button
                                                        onClick={() => moveFeedbackColumn(col, 1)}
                                                        disabled={!canDown}
                                                        style={{
                                                            borderRadius: 4,
                                                            border: canDown ? '1px solid #475569' : '1px solid #334155',
                                                            background: 'transparent',
                                                            color: canDown ? '#cbd5e1' : '#475569',
                                                            cursor: canDown ? 'pointer' : 'not-allowed',
                                                            fontSize: 10,
                                                            padding: '1px 6px',
                                                        }}
                                                    >
                                                        ↓
                                                    </button>
                                                </div>
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                            <div style={{ fontSize: 9, color: '#475569', marginTop: 6 }}>启用的列会按上方顺序复制；可关闭任意列，状态列固定启用。</div>
                        </div>
                    )}
                    {/* Canvas body */}
                    <div style={{ flex: 1, overflow: 'hidden' }}>
                        <ReviewCanvasView
                            images={enrichedImages}
                            feedbackMap={feedbackMap}
                            driveApiKey={driveApiKey}
                            onFeedbackStatusChange={handleFeedbackStatusChange}
                            onOpenAnnotation={(img) => openAnnotation(img as ParsedImage)}
                            onOpenFeedbackModal={(img) => {
                                const parsed = parsedImages.find(p => p.id === img.id);
                                if (parsed) setFeedbackModalImg(parsed);
                            }}
                            onOpenDrivePlayer={(fileId, name) => {
                                setDrivePreviewId(fileId);
                                setDrivePreviewName(name);
                            }}
                            onScreenshotAnnotate={(img, dataUrl) => {
                                setAnnotatingImageId(img.id);
                                setAnnotatingImageUrl(dataUrl);
                                setAnnotatingPreviewUrls([dataUrl]);
                            }}
                            onAppendLinks={handleAppendLinksFromCanvas}
                            columns={canvasColumns}
                            onColumnsChange={setCanvasColumns}
                            onClear={() => { setInputText(''); setFeedbackMap({}); }}
                            onBatchFeedback={(status) => {
                                setFeedbackMap(prev => {
                                    const newMap = { ...prev };
                                    enrichedImages.forEach(img => {
                                        const existing = ensureFeedbackItem(newMap[img.id] as any);
                                        newMap[img.id] = { ...existing, status };
                                    });
                                    return newMap;
                                });
                            }}
                            onClearFeedbackAdvice={(imgId) => {
                                setFeedbackMap(prev => {
                                    const newMap = { ...prev };
                                    if (newMap[imgId]) {
                                        newMap[imgId] = { ...newMap[imgId], text: '', screenshots: [] };
                                    }
                                    return newMap;
                                });
                            }}
                            onClearAllFeedbackAdvice={() => {
                                setShowClearAllConfirm(true);
                            }}
                            onDriveProbeResult={(results) => {
                                setDriveMimeTypes(prev => {
                                    const next = { ...prev };
                                    let changed = false;
                                    Object.entries(results).forEach(([fileId, res]) => {
                                        if (res.isVideo !== undefined) {
                                            const mime = res.isVideo ? 'video/mp4' : 'image/png';
                                            if (next[fileId] !== mime) {
                                                next[fileId] = mime;
                                                changed = true;
                                            }
                                        }
                                    });
                                    return changed ? next : prev;
                                });
                                setDriveFileNames(prev => {
                                    const next = { ...prev };
                                    let changed = false;
                                    Object.entries(results).forEach(([fileId, res]) => {
                                        if (res.name && next[fileId] !== res.name) {
                                            next[fileId] = res.name;
                                            changed = true;
                                        }
                                    });
                                    return changed ? next : prev;
                                });
                            }}
                        />
                    </div>
                </div>,
                document.body
            )}
            {/* Google Drive Preview/Player Modal */}
            {drivePreviewId && createPortal(
                <div
                    style={{
                        position: 'fixed', inset: 0, zIndex: 150000,
                        background: 'rgba(0,0,0,0.75)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        backdropFilter: 'blur(4px)',
                    }}
                    onClick={closeDrivePreview}
                >
                    <div
                        style={{
                            width: '85vw', maxWidth: 1100, height: '80vh',
                            background: '#1a1a2e', borderRadius: 16,
                            overflow: 'hidden', display: 'flex', flexDirection: 'column',
                            boxShadow: '0 25px 60px rgba(0,0,0,0.5)',
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        {/* Modal header */}
                        <div style={{
                            display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                            padding: '10px 16px', borderBottom: '1px solid rgba(255,255,255,0.1)',
                            background: 'rgba(0,0,0,0.3)', flexShrink: 0,
                        }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0 }}>
                                <Film size={14} style={{ color: '#818cf8', flexShrink: 0 }} />
                                <span style={{
                                    fontSize: 12, color: '#94a3b8', fontFamily: 'monospace',
                                    overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                }}>
                                    {drivePreviewName || drivePreviewId}
                                </span>
                            </div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexShrink: 0 }}>
                                {/* Toggle Video/Annotation */}
                                {(() => {
                                    const currentImg = parsedImages.find(i => i.driveFileId === drivePreviewId);
                                    if (currentImg && annotatingImageId === currentImg.id) {
                                        return (
                                            <button
                                                onClick={() => setDrivePreviewShowAnnotator(!drivePreviewShowAnnotator)}
                                                style={{
                                                    background: drivePreviewShowAnnotator ? 'rgba(74,222,128,0.2)' : 'rgba(255,255,255,0.1)',
                                                    border: 'none', borderRadius: 6,
                                                    color: drivePreviewShowAnnotator ? '#4ade80' : '#94a3b8',
                                                    cursor: 'pointer', padding: '5px 12px', fontSize: 11, fontWeight: 600,
                                                    transition: 'all 0.2s',
                                                }}
                                                title={drivePreviewShowAnnotator ? "隐藏截图，继续播放视频" : "显示已截取的图片和标注"}
                                            >
                                                {drivePreviewShowAnnotator ? '▶ 返回视频继续截' : '🖍️ 查看标注'}
                                            </button>
                                        );
                                    }
                                    return null;
                                })()}
                                {/* Screenshot + Annotate button */}
                                {feedbackMode && (
                                    <button
                                        onClick={async () => {
                                            try {
                                                const stream = await navigator.mediaDevices.getDisplayMedia({
                                                    video: { displaySurface: 'browser' } as any,
                                                    audio: false,
                                                    preferCurrentTab: true,
                                                } as any);
                                                const track = stream.getVideoTracks()[0];
                                                if (!track) throw new Error('No video track from display capture');

                                                let bitmap: ImageBitmap;
                                                try {
                                                    // @ts-ignore
                                                    const imageCapture = new ImageCapture(track);
                                                    bitmap = await imageCapture.grabFrame();
                                                } finally {
                                                    track.stop();
                                                }

                                                const fullCanvas = document.createElement('canvas');
                                                fullCanvas.width = bitmap.width;
                                                fullCanvas.height = bitmap.height;
                                                const fullCtx = fullCanvas.getContext('2d')!;
                                                fullCtx.drawImage(bitmap, 0, 0);

                                                // Always keep full capture for video screenshots.
                                                // No automatic crop is applied here.
                                                const dataUrl = fullCanvas.toDataURL('image/png');

                                                const img = parsedImages.find(i => i.driveFileId === drivePreviewId);
                                                if (img) {
                                                    if (drivePreviewShowAnnotator && annotatingImageId === img.id && annotatingImageUrl) {
                                                        // Append to existing
                                                        setAnnotatingAppendedUrls(prev => [...prev, dataUrl]);
                                                        setDrivePreviewShowAnnotator(true);
                                                    } else {
                                                        // Start from latest existing annotation (if any), then append this new video screenshot.
                                                        const existingScreenshots = normalizeFeedbackScreenshots(feedbackMap[img.id] as any);
                                                        const latestAnnotatedUrl = existingScreenshots.length > 0
                                                            ? existingScreenshots[existingScreenshots.length - 1].dataUrl
                                                            : null;

                                                        setAnnotatingImageId(img.id);
                                                        if (latestAnnotatedUrl) {
                                                            setAnnotatingImageUrl(latestAnnotatedUrl);
                                                            setAnnotatingPreviewUrls([latestAnnotatedUrl]);
                                                            setAnnotatingAppendedUrls([dataUrl]);
                                                        } else {
                                                            setAnnotatingImageUrl(dataUrl);
                                                            setAnnotatingPreviewUrls([dataUrl]);
                                                            setAnnotatingAppendedUrls([]);
                                                        }
                                                        setDrivePreviewShowAnnotator(true);
                                                    }
                                                }
                                            } catch (err) {
                                                console.error('Screen capture failed:', err);
                                                const img = parsedImages.find(i => i.driveFileId === drivePreviewId);
                                                if (img) {
                                                    setAnnotatingImageId(img.id);
                                                    setAnnotatingImageUrl(img.previewUrl);
                                                    setAnnotatingPreviewUrls(img.previewUrls || [img.previewUrl]);
                                                    setAnnotatingAppendedUrls([]);
                                                    setDrivePreviewShowAnnotator(true);
                                                }
                                            }
                                        }}
                                        style={{
                                            background: 'linear-gradient(135deg, #e11d48, #be123c)',
                                            border: 'none', borderRadius: 6,
                                            color: '#fff', cursor: 'pointer', padding: '5px 12px',
                                            fontSize: 11, fontWeight: 600,
                                            display: 'flex', alignItems: 'center', gap: 5,
                                            boxShadow: '0 2px 8px rgba(225,29,72,0.3)',
                                        }}
                                        title="截取当前画面并进行标注"
                                    >
                                        <PenLine size={12} /> 📸 {(() => {
                                            const currentImg = parsedImages.find(i => i.driveFileId === drivePreviewId);
                                            return currentImg && normalizeFeedbackScreenshots(feedbackMap[currentImg.id] as any).length > 0 ? '添加视频截图' : '截图标注';
                                        })()}
                                    </button>
                                )}
                                <button
                                    onClick={() => window.open(`https://drive.google.com/file/d/${drivePreviewId}/view`, '_blank')}
                                    style={{
                                        background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 6,
                                        color: '#94a3b8', cursor: 'pointer', padding: '4px 10px',
                                        fontSize: 11, display: 'flex', alignItems: 'center', gap: 4,
                                    }}
                                    title="在 Google Drive 中打开"
                                >
                                    <ExternalLink size={12} /> 打开
                                </button>
                                <button
                                    onClick={closeDrivePreview}
                                    style={{
                                        background: 'rgba(255,255,255,0.1)', border: 'none', borderRadius: 6,
                                        color: '#94a3b8', cursor: 'pointer', padding: '4px 8px',
                                        fontSize: 14, lineHeight: 1,
                                    }}
                                >✕</button>
                            </div>
                        </div>
                        {/* Iframe player & Annotator */}
                        <div style={{ flex: 1, position: 'relative', overflow: 'hidden', display: 'flex', background: '#000' }}>
                            {(() => {
                                const currentImg = parsedImages.find(i => i.driveFileId === drivePreviewId);
                                const isAnnotating = currentImg && annotatingImageId === currentImg.id;

                                return (
                                    <>
                                        <iframe
                                            data-video-id={`drive-player-${drivePreviewId}`}
                                            src={`https://drive.google.com/file/d/${drivePreviewId}/preview`}
                                            style={{
                                                flex: 1, width: '100%', height: '100%', border: 'none',
                                                display: (isAnnotating && drivePreviewShowAnnotator) ? 'none' : 'block'
                                            }}
                                            allow="autoplay; fullscreen"
                                            allowFullScreen
                                        />
                                        {isAnnotating && drivePreviewShowAnnotator && (
                                            <div style={{ position: 'absolute', inset: 0, zIndex: 10 }}>
                                                <AnnotationEditor
                                                    isInline
                                                    imageUrl={annotatingImageUrl}
                                                    appendedImageUrls={annotatingAppendedUrls}
                                                    previewUrls={annotatingPreviewUrls}
                                                    onSave={(dataUrl, fbText, meta) => {
                                                        if (fbText !== undefined) {
                                                            updateFeedbackText(currentImg.id, fbText);
                                                        }
                                                        if (meta?.hasVisualChanges) {
                                                            void persistAnnotation(currentImg.id, dataUrl, {
                                                                text: fbText,
                                                                closeEditor: false,
                                                                source: 'video',
                                                            });
                                                        }
                                                    }}
                                                    onCancel={() => {
                                                        // Hide annotator, return to video
                                                        setDrivePreviewShowAnnotator(false);
                                                    }}
                                                    feedbackText={feedbackMap[annotatingImageId!]?.text || ''}
                                                    onFeedbackTextChange={(text) => updateFeedbackText(annotatingImageId!, text)}
                                                />
                                            </div>
                                        )}
                                    </>
                                );
                            })()}
                        </div>

                        {/* Inline feedback bar (when feedback mode is on) */}
                        {feedbackMode && (() => {
                            const img = parsedImages.find(i => i.driveFileId === drivePreviewId);
                            if (!img) return null;
                            const fb = feedbackMap[img.id];
                            return (
                                <div style={{
                                    padding: '8px 16px', borderTop: '1px solid rgba(255,255,255,0.1)',
                                    background: 'rgba(0,0,0,0.3)', display: 'flex', alignItems: 'center', gap: 10,
                                    flexShrink: 0,
                                }}>
                                    {/* Three status buttons */}
                                    {(['approved', 'needs-edit', 'rejected'] as const).map(status => {
                                        const labels = { approved: '可以使用', 'needs-edit': '需要修改', rejected: '不可使用' };
                                        const colors = { approved: '#22c55e', 'needs-edit': '#eab308', rejected: '#ef4444' };
                                        const isActive = fb?.status === status;
                                        const hasSuggestion = status === 'needs-edit' && Boolean(
                                            (fb?.text || '').trim()
                                            || normalizeFeedbackScreenshots(fb as any).length > 0
                                        );
                                        const label = status === 'needs-edit' && isActive && hasSuggestion ? '查看建议' : labels[status];
                                        return (
                                            <button
                                                key={status}
                                                onClick={() => {
                                                    if (status === 'needs-edit') {
                                                        if (isActive) {
                                                            if (hasSuggestion) {
                                                                setFeedbackModalImg(img);
                                                            } else {
                                                                handleFeedbackStatusChange(img.id, null);
                                                            }
                                                            return;
                                                        }
                                                        handleFeedbackStatusChange(img.id, status);
                                                        setFeedbackModalImg(img);
                                                        return;
                                                    }
                                                    handleFeedbackStatusChange(img.id, isActive ? null : status);
                                                }}
                                                style={{
                                                    background: isActive ? `${colors[status]}22` : 'rgba(255,255,255,0.06)',
                                                    border: isActive ? `1px solid ${colors[status]}` : '1px solid rgba(255,255,255,0.1)',
                                                    borderRadius: 6, padding: '4px 12px', cursor: 'pointer',
                                                    color: isActive ? colors[status] : '#94a3b8',
                                                    fontSize: 11, fontWeight: isActive ? 600 : 400,
                                                    transition: 'all 0.15s',
                                                }}
                                            >{label}</button>
                                        );
                                    })}
                                    
                                    <div style={{ width: 1, height: 16, background: 'rgba(255,255,255,0.1)', margin: '0 2px' }} />

                                    <div style={{ display: 'flex', gap: 4, background: 'rgba(255,255,255,0.03)', padding: 3, borderRadius: 6 }}>
                                        {(['high', 'medium', 'low'] as const).map(sev => {
                                            const labels = { high: '高', medium: '中', low: '低' };
                                            const colors = { high: '#ef4444', medium: '#eab308', low: '#3b82f6' };
                                            const isActive = fb?.severity === sev;
                                            return (
                                                <button
                                                    key={sev}
                                                    onClick={() => handleFeedbackSeverityChange(img.id, isActive ? null : sev)}
                                                    style={{
                                                        background: isActive ? `${colors[sev]}22` : 'transparent',
                                                        border: `1px solid ${isActive ? colors[sev] : 'transparent'}`,
                                                        borderRadius: 4, padding: '2px 8px', cursor: 'pointer',
                                                        color: isActive ? colors[sev] : '#94a3b8',
                                                        fontSize: 10, fontWeight: isActive ? 600 : 400,
                                                        transition: 'all 0.15s',
                                                    }}
                                                    title={`严重程度: ${labels[sev]}`}
                                                >{labels[sev]}</button>
                                            );
                                        })}
                                    </div>

                                    <button
                                        onClick={() => { void startPasteAnnotation(img.id); }}
                                        style={{
                                            background: 'rgba(255,255,255,0.06)',
                                            border: '1px solid rgba(255,255,255,0.1)',
                                            borderRadius: 6, padding: '4px 10px', cursor: 'pointer',
                                            color: '#cbd5e1', fontSize: 11, fontWeight: 500,
                                            display: 'flex', alignItems: 'center', gap: 4,
                                        }}
                                        title="手动截图后按 Cmd/Ctrl+V 粘贴到标注"
                                    >
                                        <Upload size={12} /> 粘贴截图
                                    </button>
                                    {/* Quick text input */}
                                    <input
                                        type="text"
                                        value={fb?.text || ''}
                                        onChange={e => updateFeedbackText(img.id, e.target.value)}
                                        placeholder="输入文字建议…"
                                        style={{
                                            flex: 1, background: 'rgba(255,255,255,0.06)',
                                            border: '1px solid rgba(255,255,255,0.1)', borderRadius: 6,
                                            padding: '5px 10px', color: '#e2e8f0', fontSize: 11,
                                            outline: 'none', fontFamily: '-apple-system, sans-serif',
                                        }}
                                        onFocus={e => { e.target.style.borderColor = '#f59e0b'; }}
                                        onBlur={e => { e.target.style.borderColor = 'rgba(255,255,255,0.1)'; }}
                                    />
                                </div>
                            );
                        })()}
                    </div>
                </div>,
                document.body
            )}

            {/* Right-click context menu */}
            {contextMenu.show && (
                <div
                    style={{
                        position: 'fixed', left: contextMenu.x, top: contextMenu.y, zIndex: 10001,
                        background: '#fff', borderRadius: 8, boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
                        border: '1px solid #e2e8f0', overflow: 'hidden', minWidth: 160,
                    }}
                    onClick={e => e.stopPropagation()}
                >
                    {(() => {
                        const img = parsedImages.find(i => i.id === contextMenu.imgId);
                        if (!img) return null;
                        return (
                            <>
                                <button
                                    onClick={() => { openAnnotation(img); }}
                                    style={{ width: '100%', padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, color: '#334155' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                >
                                    <PenLine size={14} style={{ color: '#e11d48' }} /> {normalizeFeedbackScreenshots(feedbackMap[img.id] as any).length > 0 ? '添加截图' : '标注截图'}
                                </button>
                                <button
                                    onClick={() => { void startPasteAnnotation(img.id); }}
                                    style={{ width: '100%', padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, color: '#334155' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                >
                                    <Upload size={14} style={{ color: '#6366f1' }} /> 粘贴截图标注
                                </button>
                                <button
                                    onClick={() => {
                                        setEditingFeedbackText(img.id);
                                        setContextMenu(prev => ({ ...prev, show: false }));
                                    }}
                                    style={{ width: '100%', padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, color: '#334155' }}
                                    onMouseEnter={e => (e.currentTarget.style.background = '#f8fafc')}
                                    onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                >
                                    <MessageSquarePlus size={14} style={{ color: '#f59e0b' }} /> 文字建议
                                </button>
                                {(feedbackMap[img.id]?.text || normalizeFeedbackScreenshots(feedbackMap[img.id] as any).length > 0) && (
                                    <>
                                        <div style={{ height: 1, background: '#f1f5f9' }} />
                                        <button
                                            onClick={() => {
                                                setFeedbackMap(prev => {
                                                    const next = { ...prev };
                                                    delete next[img.id];
                                                    return next;
                                                });
                                                setContextMenu(prev => ({ ...prev, show: false }));
                                            }}
                                            style={{ width: '100%', padding: '8px 14px', border: 'none', background: 'none', cursor: 'pointer', textAlign: 'left', fontSize: 12, display: 'flex', alignItems: 'center', gap: 8, color: '#ef4444' }}
                                            onMouseEnter={e => (e.currentTarget.style.background = '#fef2f2')}
                                            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                                        >
                                            <Trash2 size={14} /> 清除反馈
                                        </button>
                                    </>
                                )}
                            </>
                        );
                    })()}
                </div>
            )}

            {/* Manual screenshot paste helper modal */}
            {pasteTargetImageId && createPortal(
                <div
                    style={{
                        position: 'fixed', inset: 0, zIndex: 160002,
                        background: 'rgba(0,0,0,0.55)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    onClick={() => setPasteTargetImageId(null)}
                >
                    <div
                        style={{
                            width: 'min(540px, 92vw)',
                            background: '#0f172a',
                            border: '1px solid rgba(148,163,184,0.28)',
                            borderRadius: 12,
                            padding: '16px 18px',
                            color: '#e2e8f0',
                            boxShadow: '0 20px 50px rgba(0,0,0,0.35)',
                        }}
                        onClick={e => e.stopPropagation()}
                    >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                            <Upload size={16} style={{ color: '#60a5fa' }} />
                            <span style={{ fontSize: 14, fontWeight: 700 }}>粘贴截图后继续标注</span>
                        </div>
                        <div style={{ fontSize: 12, color: '#94a3b8', lineHeight: 1.6 }}>
                            先手动截图并复制，然后在这个页面按 <strong style={{ color: '#e2e8f0' }}>Cmd/Ctrl + V</strong>。
                            <br />
                            粘贴后会自动进入标注编辑器，保存后会继续自动上传 Gyazo。
                        </div>
                        {pasteHint && (
                            <div style={{
                                marginTop: 10, fontSize: 12, color: '#fda4af',
                                background: 'rgba(190,24,93,0.12)', border: '1px solid rgba(244,114,182,0.25)',
                                borderRadius: 8, padding: '8px 10px',
                            }}>
                                {pasteHint}
                            </div>
                        )}
                        <div style={{ marginTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10 }}>
                            <span style={{ fontSize: 11, color: '#64748b' }}>
                                {pasteProcessing ? '正在读取截图…' : '等待你粘贴截图…'}
                            </span>
                            <button
                                onClick={() => setPasteTargetImageId(null)}
                                style={{
                                    border: 'none', borderRadius: 8, cursor: 'pointer',
                                    padding: '6px 12px', fontSize: 12, fontWeight: 600,
                                    background: 'rgba(148,163,184,0.18)', color: '#cbd5e1',
                                }}
                            >
                                取消
                            </button>
                        </div>
                    </div>
                </div>,
                document.body
            )}

            {/* Annotation Editor Modal (portaled to body for z-index above canvas) */}
            {annotatingImageId && !drivePreviewId && createPortal(
                <AnnotationEditor
                    imageUrl={annotatingImageUrl}
                    appendedImageUrls={annotatingAppendedUrls}
                    previewUrls={annotatingPreviewUrls}
                    onSave={(dataUrl, fbText, meta) => {
                        if (!annotatingImageId) return;
                        if (fbText !== undefined) {
                            updateFeedbackText(annotatingImageId, fbText);
                        }
                        if (meta?.hasVisualChanges) {
                            void persistAnnotation(annotatingImageId, dataUrl, {
                                text: fbText,
                                closeEditor: true,
                                source: 'thumbnail',
                            });
                        } else {
                            setAnnotatingImageId(null);
                            setDrivePreviewShowAnnotator(false);
                        }
                    }}
                    onCancel={() => {
                        setAnnotatingImageId(null);
                        setDrivePreviewShowAnnotator(false);
                    }}
                    feedbackText={annotatingImageId ? (feedbackMap[annotatingImageId]?.text || '') : ''}
                    onFeedbackTextChange={(text) => {
                        if (annotatingImageId) {
                            updateFeedbackText(annotatingImageId, text);
                        }
                    }}
                />,
                document.body
            )}

            {/* Feedback Modal (portaled to body for z-index above canvas) */}
            {feedbackModalImg && createPortal(
                <FeedbackModal
                    imageUrl={feedbackModalImg.previewUrl}
                    previewUrls={feedbackModalImg.previewUrls}
                    feedbackText={feedbackMap[feedbackModalImg.id]?.text || ''}
                    severity={feedbackMap[feedbackModalImg.id]?.severity || null}
                    annotatedDataUrl={normalizeFeedbackScreenshots(feedbackMap[feedbackModalImg.id] as any).pop()?.dataUrl || null}
                    gyazoUrl={(feedbackMap[feedbackModalImg.id] as any)?.gyazoUrl || null}
                    gyazoPermalink={(feedbackMap[feedbackModalImg.id] as any)?.gyazoPermalink || null}
                    uploading={(feedbackMap[feedbackModalImg.id] as any)?.uploading || false}
                    onSave={handleFeedbackModalSave}
                    onCancel={() => setFeedbackModalImg(null)}
                />,
                document.body
            )}

            {showClearAllConfirm && createPortal(
                <div style={{
                    position: 'fixed', inset: 0, zIndex: 99999,
                    background: 'rgba(0,0,0,0.7)', backdropFilter: 'blur(4px)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                }}>
                    <div style={{
                        background: '#1c1c22', border: '1px solid #2a2a32', borderRadius: 12,
                        padding: 24, width: 360, boxShadow: '0 8px 32px rgba(0,0,0,0.5)',
                    }}>
                        <h3 style={{ margin: '0 0 12px 0', fontSize: 16, color: '#f87171', display: 'flex', alignItems: 'center', gap: 8 }}>
                            ⚠️ 清空所有建议
                        </h3>
                        <p style={{ margin: '0 0 24px 0', fontSize: 14, color: '#a1a1aa', lineHeight: 1.5 }}>
                            确定要清空所有卡片的建议和截图吗？此操作无法撤销。
                            <br />（但已标记的“可用/不可用”状态会被保留）
                        </p>
                        <div style={{ display: 'flex', gap: 12, justifyContent: 'flex-end' }}>
                            <button
                                onClick={() => setShowClearAllConfirm(false)}
                                style={{
                                    background: 'transparent', border: '1px solid #3f3f46', borderRadius: 6,
                                    color: '#e2e8f0', padding: '6px 16px', cursor: 'pointer', fontSize: 13,
                                }}
                            >取消</button>
                            <button
                                onClick={() => {
                                    setFeedbackMap(prev => {
                                        const newMap = { ...prev };
                                        Object.keys(newMap).forEach(key => {
                                            if (newMap[key]) {
                                                newMap[key] = { ...newMap[key], text: '', screenshots: [] };
                                            }
                                        });
                                        return newMap;
                                    });
                                    setShowClearAllConfirm(false);
                                }}
                                style={{
                                    background: '#ef4444', border: 'none', borderRadius: 6,
                                    color: '#fff', padding: '6px 16px', cursor: 'pointer', fontSize: 13, fontWeight: 600,
                                }}
                            >清空</button>
                        </div>
                    </div>
                </div>,
                document.body
            )}
            {showFeedbackPreview && createPortal(
                <FeedbackPreviewModal 
                    isOpen={showFeedbackPreview}
                    header={previewData?.header || []}
                    rows={previewData?.rows || []}
                    includeHeader={includeFeedbackHeader}
                    onClose={() => setShowFeedbackPreview(false)}
                    onCopy={() => {
                        handleCopyFeedback();
                        setShowFeedbackPreview(false);
                    }}
                />,
                document.body
            )}
        </div>
    );
};

export default ImageFormulaPanel;
