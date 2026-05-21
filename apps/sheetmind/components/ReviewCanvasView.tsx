/**
 * ReviewCanvasView - PureRef 风格的平铺画布审查视图
 * 
 * 功能：
 * - 所有图片/视频平铺在无限画布上，自动填满窗口宽度
 * - 鼠标滚轮缩放（缩放到鼠标位置）
 * - 左键空白区域拖拽 / Alt+拖拽 / 中键拖拽
 * - 每个缩略图上显示三个反馈按钮
 * - 视频在画布卡片中预览，点击后进入大播放器
 */

import React, { useRef, useState, useCallback, useEffect, useMemo } from 'react';
import {
    Check, AlertTriangle, XCircle, PenLine,
    ZoomIn, ZoomOut, Maximize2,
    Play, X, Trash2, LayoutGrid,
} from 'lucide-react';

// ==================== Types ====================

interface ReviewImage {
    id: string;
    originalUrl: string;
    previewUrl: string;
    previewUrls?: string[];
    isGoogleDrive: boolean;
    driveFileId?: string;
    isValid: boolean;
    isVideo?: boolean;
    infoText?: string;
}

type FeedbackStatus = 'approved' | 'needs-edit' | 'rejected' | null;

interface FeedbackItem {
    status: FeedbackStatus;
    text: string;
    screenshots?: { id: string; source: string; dataUrl: string; gyazoUrl: string | null }[];
    annotatedDataUrl?: string | null;
    gyazoUrl?: string | null;
    gyazoPermalink?: string | null;
    uploading?: boolean;
}

interface ReviewCanvasViewProps {
    images: ReviewImage[];
    feedbackMap: Record<string, FeedbackItem>;
    onFeedbackStatusChange: (imgId: string, status: FeedbackStatus) => void;
    onOpenAnnotation: (img: ReviewImage) => void;
    onOpenFeedbackModal: (img: ReviewImage) => void;
    onOpenDrivePlayer: (fileId: string, name: string) => void;
    columns?: number;
    onScreenshotAnnotate?: (img: ReviewImage, dataUrl: string) => void;
    onAppendLinks?: (links: string[]) => void;
    onUpdateFeedbackText?: (imgId: string, text: string) => void;
    onClear?: () => void;
    onBatchFeedback?: (status: 'approved' | 'rejected' | null) => void;
    driveApiKey?: string;
    onClearFeedbackAdvice?: (imgId: string) => void;
    onClearAllFeedbackAdvice?: () => void;
    onDriveProbeResult?: (results: Record<string, { isVideo?: boolean; name?: string }>) => void;
    onColumnsChange?: (cols: number) => void;
}

// ==================== Constants ====================

const MIN_SCALE = 0.1;
const MAX_SCALE = 3;
const ZOOM_FACTOR = 0.08;
const TILE_GAP = 12;
const DRIVE_URL_RE = /drive\.google\.com|drive\.usercontent\.google\.com|docs\.google\.com\/uc|lh3\.googleusercontent\.com\/d\//i;
// Broad extension coverage for mixed user-provided names/URLs.
const IMAGE_EXT_RE = /\.(jpe?g|jfif|pjpeg|pjp|png|apng|gif|webp|bmp|dib|tiff?|svgz?|ico|heic|heif|avif|jxl|raw|dng|cr2|cr3|nef|nrw|arw|srf|sr2|orf|rw2|raf|pef|srw|x3f)(?:[?#].*)?$/i;
const VIDEO_EXT_RE = /\.(mp4|m4v|mov|qt|webm|mkv|avi|wmv|asf|flv|f4v|m3u8|ts|mts|m2ts|mpg|mpeg|mpe|m2v|3gp|3g2|ogv|vob|rm|rmvb|mxf|divx|xvid|hevc|h264|h265|av1)(?:[?#].*)?$/i;
const URL_RE = /(?:https?:\/\/)?(?:drive\.google\.com|drive\.usercontent\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com)[^\s<>"']+|https?:\/\/[^\s<>"']+/gi;
const IMAGE_FORMULA_RE = /=IMAGE\s*\(\s*"([^"]+)"/gi;
const HYPERLINK_FORMULA_RE = /=HYPERLINK\s*\(\s*"([^"]+)"/gi;

const STATUS_COLORS: Record<string, { bg: string; border: string; text: string; label: string }> = {
    approved: { bg: '#dcfce7', border: '#86efac', text: '#16a34a', label: '✅' },
    'needs-edit': { bg: '#fef9c3', border: '#fde047', text: '#ca8a04', label: '⚠️' },
    rejected: { bg: '#fee2e2', border: '#fca5a5', text: '#dc2626', label: '❌' },
};

function normalizeUrlCandidate(raw: string): string {
    let normalized = raw
        .trim()
        .replace(/[\u200B-\u200D\uFEFF]/g, '')
        .replace(/\u00A0/g, ' ')
        .replace(/&quot;/gi, '"')
        .replace(/&#34;/gi, '"')
        .replace(/&#39;/gi, "'")
        .replace(/&apos;/gi, "'")
        .replace(/&amp;/gi, '&')
        .replace(/\\\//g, '/')
        .replace(/\\u002f/gi, '/')
        .replace(/\\u0026/gi, '&')
        .replace(/^[<("'\[]+/, '')
        .replace(/[>)"'\],;.!?，。；：！？、]+$/, '');
        
    // Support URLs missing https:// but starting with known domains
    if (/^(drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com|drive\.usercontent\.google\.com)/i.test(normalized)) {
        normalized = `https://${normalized}`;
    }
    
    return normalized;
}

function decodeUrlParam(value: string): string {
    try {
        return decodeURIComponent(value);
    } catch {
        return value;
    }
}

function normalizeExtractedUrl(raw: string): string {
    const normalized = normalizeUrlCandidate(raw);
    try {
        const parsed = new URL(normalized);
        const isGoogleRedirect = /(^|\.)google\./i.test(parsed.hostname) && parsed.pathname === '/url';
        if (isGoogleRedirect) {
            const redirectTarget = parsed.searchParams.get('q') || parsed.searchParams.get('url');
            if (redirectTarget) {
                const decoded = normalizeUrlCandidate(decodeUrlParam(redirectTarget));
                if (/^https?:\/\//i.test(decoded)) return decoded;
            }
        }
    } catch {
        // ignore malformed URLs and return normalized value
    }
    return normalized;
}

function extractGoogleDriveFileId(url: string): string | undefined {
    const pathMatch = url.match(/\/(?:file\/)?d\/([a-zA-Z0-9_-]{10,})/);
    if (pathMatch) return pathMatch[1];
    const idMatch = url.match(/[?&]id=([a-zA-Z0-9_-]{10,})/);
    if (idMatch) return idMatch[1];
    const lh3Match = url.match(/lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]{10,})/);
    if (lh3Match) return lh3Match[1];
    return undefined;
}

function extractLinksFromText(text: string, collector: Set<string>) {
    if (!text) return;
    const formulaPatterns = [IMAGE_FORMULA_RE, HYPERLINK_FORMULA_RE];
    for (const pattern of formulaPatterns) {
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null = null;
        while ((match = pattern.exec(text)) !== null) {
            const candidate = normalizeUrlCandidate(match[1] || '');
            if (/^https?:\/\//i.test(candidate)) collector.add(candidate);
        }
    }

    URL_RE.lastIndex = 0;
    let urlMatch: RegExpExecArray | null = null;
    while ((urlMatch = URL_RE.exec(text)) !== null) {
        const candidate = normalizeUrlCandidate(urlMatch[0] || '');
        if (/^https?:\/\//i.test(candidate)) collector.add(candidate);
    }
}

function extractLinksFromClipboard(clipboardData: DataTransfer | null): string[] {
    if (!clipboardData) return [];
    const links = new Set<string>();

    const html = clipboardData.getData('text/html');
    if (html) {
        const doc = new DOMParser().parseFromString(html, 'text/html');
        
        // 1. Extract from Google Sheets cells (handles =IMAGE formulas and cell hyperlinks)
        doc.querySelectorAll('td, th').forEach(cell => {
            const url = extractUrlFromHtmlCell(cell);
            if (url && /^https?:\/\//i.test(url)) {
                links.add(url);
            }
        });

        // 2. Extract from anchor tags
        doc.querySelectorAll('a[href]').forEach(a => {
            const href = normalizeUrlCandidate(a.getAttribute('href') || '');
            if (/^https?:\/\//i.test(href)) links.add(href);
        });

        // 3. Fallback to text content
        extractLinksFromText(doc.body?.textContent || '', links);
    }

    extractLinksFromText(clipboardData.getData('text/plain'), links);
    return Array.from(links);
}

function extractUrlFromCellText(raw: string): string | null {
    const value = (raw || '').trim();
    if (!value) return null;
    if (/^https?:\/\//i.test(value)) return normalizeExtractedUrl(value);
    if (/^(drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com)/i.test(value)) return normalizeExtractedUrl(`https://${value}`);

    // Google Sheets HTML may expose formulas without leading "=" in attributes.
    const formulaText = value.startsWith('=') ? value : (/^[A-Z_]+\s*\(/i.test(value) ? `=${value}` : value);

    const hyperlinkMatch = formulaText.match(/=HYPERLINK\s*\(\s*["']([^"']+)["']/i);
    if (hyperlinkMatch?.[1]) return normalizeExtractedUrl(hyperlinkMatch[1]);

    const imageMatch = formulaText.match(/=IMAGE\s*\(\s*["']([^"']+)["']/i);
    if (imageMatch?.[1]) return normalizeExtractedUrl(imageMatch[1]);

    const urlMatch = value.match(/(?:https?:\/\/)?(?:drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com|drive\.usercontent\.google\.com)[^\s<>"']+/i) || value.match(/https?:\/\/[^\s<>"']+/i);
    if (urlMatch?.[0]) return normalizeExtractedUrl(urlMatch[0]);
    return null;
}

function extractUrlFromHtmlFragment(raw: string): string | null {
    const value = raw || '';
    if (!value) return null;

    const attrUrlMatch = value.match(/(?:href|src|data-sheets-hyperlink|data-hyperlink|data-url)=["']([^"']+)["']/i);
    if (attrUrlMatch?.[1]) {
        const url = extractUrlFromCellText(attrUrlMatch[1]);
        if (url) return url;
    }

    const formulaMatch = value.match(/data-sheets-formula=["']([^"']+)["']/i);
    if (formulaMatch?.[1]) {
        const formula = formulaMatch[1]
            .replace(/&quot;/gi, '"')
            .replace(/&#34;/gi, '"')
            .replace(/&amp;/gi, '&');
        const url = extractUrlFromCellText(formula);
        if (url) return url;
    }

    const url = extractUrlFromCellText(value);
    if (url) return url;

    const driveIdMatch = value.match(/(?:file\/d\/|\/d\/|[?&]id=|driveFileId["']?\s*[:=]\s*["']?)([a-zA-Z0-9_-]{10,})/i);
    if (driveIdMatch?.[1]) {
        return `https://drive.google.com/file/d/${driveIdMatch[1]}/view`;
    }

    return null;
}

function extractUrlFromHtmlCell(cell: Element): string {
    const anchor = cell.querySelector('a[href]');
    if (anchor) {
        const href = extractUrlFromCellText(anchor.getAttribute('href') || '');
        if (href) {
            return href;
        }
    }

    const attrCandidates = [
        cell.getAttribute('data-sheets-formula'),
        cell.getAttribute('data-sheets-hyperlink'),
        cell.getAttribute('data-hyperlink'),
        cell.getAttribute('data-url'),
    ];
    for (const attr of attrCandidates) {
        const url = extractUrlFromCellText(attr || '');
        if (url) return url;
    }

    const media = cell.querySelector('img[src],video[src],source[src]');
    if (media) {
        const src = extractUrlFromCellText(media.getAttribute('src') || '');
        if (src) return src;
    }

    const outerHtmlUrl = extractUrlFromHtmlFragment((cell as HTMLElement).outerHTML || '');
    if (outerHtmlUrl) return outerHtmlUrl;

    const text = (cell.textContent || '').trim();
    const textUrl = extractUrlFromCellText(text);
    return textUrl || text;
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

function extractUrlCandidate(raw: string): { url: string; isDirect: boolean } | null {
    const value = (raw || '').trim();
    if (!value) return null;

    if (/^https?:\/\//i.test(value)) {
        return { url: normalizeUrlCandidate(value), isDirect: true };
    }
    if (/^(drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com)/i.test(value)) {
        return { url: normalizeUrlCandidate(`https://${value}`), isDirect: true };
    }
    const formulaText = value.startsWith('=') ? value : (/^[A-Z_]+\s*\(/i.test(value) ? `=${value}` : value);
    const hyperlinkMatch = formulaText.match(/=HYPERLINK\s*\(\s*["']([^"']+)["']/i);
    if (hyperlinkMatch?.[1]) return { url: normalizeUrlCandidate(hyperlinkMatch[1]), isDirect: false };
    const imageMatch = formulaText.match(/=IMAGE\s*\(\s*["']([^"']+)["']/i);
    if (imageMatch?.[1]) return { url: normalizeUrlCandidate(imageMatch[1]), isDirect: false };
    const urlMatch = value.match(/(?:https?:\/\/)?(?:drive\.google\.com|docs\.google\.com|lh3\.googleusercontent\.com)[^\s<>"']+/i) || value.match(/https?:\/\/[^\s<>"']+/i);
    if (urlMatch?.[0]) return { url: normalizeUrlCandidate(urlMatch[0]), isDirect: false };

    return null;
}

function parseInfoUrlFromCells(rawCells: string[]): { infoText: string; url: string } | null {
    const cells = rawCells.map(cell => (cell || '').trim());
    if (cells.length < 2) return null;

    const parsed = cells.map(cell => extractUrlCandidate(cell));
    const urlIndexes = parsed
        .map((item, idx) => (item?.url ? idx : -1))
        .filter(idx => idx >= 0);
    if (urlIndexes.length === 0) return null;

    // Rows copied from feedback/export tables may contain multiple URLs
    // (original link + preview + annotation links). Prefer the left-most
    // non-annotation/non-preview URL, then fallback to the first URL cell.
    const urlIndex = (() => {
        const preferred = urlIndexes.find(idx => {
            const url = (parsed[idx]?.url || '').toLowerCase();
            const raw = (cells[idx] || '').toLowerCase();
            if (!url) return false;
            const isGyazo = url.includes('gyazo.com') || url.includes('i.gyazo.com');
            const isDrivePreview = url.includes('drive.google.com/thumbnail') || url.includes('lh3.googleusercontent.com');
            const isImageFormulaCell = raw.includes('=image(');
            return !(isGyazo || isDrivePreview || isImageFormulaCell);
        });
        return preferred ?? urlIndexes[0];
    })();
    const url = parsed[urlIndex]?.url;
    if (!url) return null;

    const buildInfo = (segment: string[]) => segment
        .map(part => stripUrlArtifacts(part))
        .filter(Boolean)
        .join('\t')
        .trim();

    const leftInfo = buildInfo(cells.slice(0, urlIndex));
    const rightInfo = buildInfo(cells.slice(urlIndex + 1));
    const urlCellInfo = stripUrlArtifacts(cells[urlIndex] || '');
    const infoText = leftInfo || rightInfo || urlCellInfo || '';

    return { infoText, url };
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
    return normalizeUrlCandidate(url).toLowerCase();
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

function parseInfoUrlsFromCells(rawCells: string[]): { infoText: string; url: string }[] {
    const cells = rawCells.map(cell => (cell || '').trim()).filter(Boolean);
    if (cells.length === 0) return [];

    const parsed = cells.map(cell => extractUrlCandidate(cell));
    const urlIndexes = parsed
        .map((item, idx) => (item?.url ? idx : -1))
        .filter(idx => idx >= 0);
    if (urlIndexes.length === 0) return [];

    if (urlIndexes.length === 1) {
        const single = parseInfoUrlFromCells(cells);
        return single ? [single] : [];
    }

    const indexes = pickMeaningfulUrlIndexes(cells, parsed, urlIndexes);

    return indexes.map(idx => {
        const url = parsed[idx]?.url || '';
        const nonUrlInfo = cells
            .filter((_, cellIdx) => cellIdx !== idx && !parsed[cellIdx]?.url)
            .map(part => stripUrlArtifacts(part))
            .filter(Boolean)
            .join('\t')
            .trim();
        const urlCellInfo = stripUrlArtifacts(cells[idx] || '');
        return {
            url,
            infoText: nonUrlInfo || urlCellInfo || '',
        };
    }).filter(item => item.url);
}

function extractHtmlCellPasteValue(cell: Element): string {
    const url = extractUrlFromHtmlCell(cell);
    const label = (cell.textContent || '').trim();
    if (/^https?:\/\//i.test(url)) {
        if (label && !/^https?:\/\//i.test(label) && label !== url) {
            const safeLabel = label.replace(/"/g, '""');
            return `=HYPERLINK("${url}","${safeLabel}")`;
        }
        return url;
    }
    return label || url;
}

function inferExplicitMediaType(url: string): boolean | undefined {
    const normalized = (url || '').trim().replace(/[)\]>"'.,;!]+$/, '');
    if (!normalized) return undefined;
    if (VIDEO_EXT_RE.test(normalized)) return true;
    if (IMAGE_EXT_RE.test(normalized)) return false;
    return undefined;
}

function buildPastedReviewImage(url: string, id: string, infoText?: string): ReviewImage {
    const isGoogleDrive = DRIVE_URL_RE.test(url);
    const driveFileId = isGoogleDrive ? extractGoogleDriveFileId(url) : undefined;
    const previewUrl = driveFileId ? `https://drive.google.com/thumbnail?id=${driveFileId}&sz=w1600` : url;
    
    // 格式判断只看链接本身；其他信息列不参与图片/视频判断。
    let isVideo: boolean | undefined = undefined;
    
    const explicitType = inferExplicitMediaType(url);
    if (explicitType !== undefined) {
        isVideo = explicitType;
    }
    
    return {
        id,
        originalUrl: url,
        previewUrl,
        previewUrls: driveFileId ? [
            previewUrl, 
            `https://lh3.googleusercontent.com/d/${driveFileId}=w1600`,
            `https://lh3.googleusercontent.com/d/${driveFileId}=s1600`
        ] : undefined,
        isGoogleDrive,
        driveFileId,
        isValid: /^https?:\/\//i.test(url),
        isVideo, // 初始可能为 undefined，等待后续 Probe
    };
}

// ==================== Component ====================

const ReviewCanvasView: React.FC<ReviewCanvasViewProps> = ({
    images,
    feedbackMap,
    onFeedbackStatusChange,
    onOpenAnnotation,
    onOpenFeedbackModal,
    onOpenDrivePlayer,
    columns: requestedColumns = 1,
    onAppendLinks,
    onUpdateFeedbackText,
    onClear,
    onBatchFeedback,
    driveApiKey,
    onClearFeedbackAdvice,
    onClearAllFeedbackAdvice,
    onDriveProbeResult,
    onColumnsChange,
}) => {
    const containerRef = useRef<HTMLDivElement>(null);

    const isEditableEl = useCallback((el: HTMLElement | null): boolean => {
        if (!el) return false;
        const tag = el.tagName;
        return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
    }, []);

    // ── Transform state ──
    const [scale, setScale] = useState(0.1);
    const [panX, setPanX] = useState(0);
    const [panY, setPanY] = useState(0);
    const [isDragging, setIsDragging] = useState(false);
    const dragStart = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

    // ── Per-card drag state ──
    const [cardPositions, setCardPositions] = useState<Record<string, { x: number; y: number }>>({});
    const [draggingCard, setDraggingCard] = useState<string | null>(null);
    const cardDragStart = useRef({ x: 0, y: 0, origX: 0, origY: 0 });

    // ── Inline rejected-reason input ──
    const [rejectReasonId, setRejectReasonId] = useState<string | null>(null);
    const [rejectReasonText, setRejectReasonText] = useState('');

    // ── Image fallback state ──
    const [fallbackIndex, setFallbackIndex] = useState<Record<string, number>>({});
    const [failedThumbs, setFailedThumbs] = useState<Set<string>>(new Set());
    const [videoTypeOverrides, setVideoTypeOverrides] = useState<Record<string, true>>({});
    // ── Inline video player ──
    const [playingVideoId, setPlayingVideoId] = useState<string | null>(null);
    const [pastedImages, setPastedImages] = useState<ReviewImage[]>([]);
    const [pasteHint, setPasteHint] = useState('');
    const [clearArmed, setClearArmed] = useState(false);
    const nonDriveProbeTriedRef = useRef<Set<string>>(new Set());

    const mergedImages = useMemo(() => {
        const merged: ReviewImage[] = [];
        const seen = new Set<string>();
        for (const img of [...images, ...pastedImages]) {
            const key = getMediaUrlDedupKey(img.originalUrl || img.id);
            if (seen.has(key)) continue;
            seen.add(key);
            merged.push(img);
        }
        return merged;
    }, [images, pastedImages]);

    const displayImages = mergedImages;
    const validImages = displayImages.filter(img => img.isValid);
    const cols = Math.min(requestedColumns, Math.max(1, displayImages.length));
    const remainingImageIds = useMemo(
        () => displayImages.filter(img => !feedbackMap[img.id]?.status).map(img => img.id),
        [displayImages, feedbackMap]
    );

    const probeNonDriveVideo = useCallback((img: ReviewImage) => {
        if (!img || img.isGoogleDrive || img.isVideo !== undefined) return;
        if (!/^https?:\/\//i.test(img.originalUrl)) return;
        if (nonDriveProbeTriedRef.current.has(img.id)) return;

        nonDriveProbeTriedRef.current.add(img.id);

        const video = document.createElement('video');
        video.preload = 'metadata';
        video.muted = true;
        (video as any).playsInline = true;

        let settled = false;
        let timer = 0;

        const cleanup = () => {
            video.onloadedmetadata = null;
            video.oncanplay = null;
            video.onerror = null;
            if (timer) window.clearTimeout(timer);
            try {
                video.pause();
                video.removeAttribute('src');
                video.load();
            } catch {
                // ignore cleanup failures
            }
        };

        const done = (isVideo: boolean) => {
            if (settled) return;
            settled = true;
            cleanup();
            if (isVideo) {
                setVideoTypeOverrides(prev => (prev[img.id] ? prev : { ...prev, [img.id]: true }));
            }
        };

        video.onloadedmetadata = () => done(true);
        video.oncanplay = () => done(true);
        video.onerror = () => done(false);
        timer = window.setTimeout(() => done(false), 3500);

        try {
            video.src = img.originalUrl;
        } catch {
            done(false);
        }
    }, []);

    // ── Compute tile size from container width ──
    const getTileSize = useCallback(() => {
        const container = containerRef.current;
        if (!container) return 300;
        const containerW = container.clientWidth;
        const availableW = containerW - TILE_GAP * (cols + 1) - 20;
        return Math.max(200, Math.floor(availableW / cols));
    }, [cols]);

    const [tileSize, setTileSize] = useState(300);

    // ── Fit to width ──
    const handleFitAll = useCallback(() => {
        const ts = getTileSize();
        setTileSize(ts);
        setScale(0.1);
        setPanX(TILE_GAP);
        setPanY(TILE_GAP);
    }, [getTileSize]);

    useEffect(() => {
        const timer = setTimeout(handleFitAll, 50);
        return () => clearTimeout(timer);
    }, [displayImages.length, handleFitAll]);

    useEffect(() => {
        window.addEventListener('resize', handleFitAll);
        return () => window.removeEventListener('resize', handleFitAll);
    }, [handleFitAll]);

    useEffect(() => {
        if (images.length === 0) return;
        const parentUrls = new Set(images.map(img => img.originalUrl));
        setPastedImages(prev => prev.filter(img => !parentUrls.has(img.originalUrl)));
    }, [images]);

    useEffect(() => {
        const validIds = new Set(mergedImages.map(img => img.id));
        nonDriveProbeTriedRef.current.forEach(id => {
            if (!validIds.has(id)) nonDriveProbeTriedRef.current.delete(id);
        });
        setVideoTypeOverrides(prev => {
            const next: Record<string, true> = {};
            let changed = false;
            Object.entries(prev).forEach(([id, value]) => {
                if (value && validIds.has(id)) {
                    next[id] = true;
                } else {
                    changed = true;
                }
            });
            return changed ? next : prev;
        });
    }, [mergedImages]);

    useEffect(() => {
        validImages.forEach(img => {
            if (!img.isGoogleDrive && img.isVideo === undefined) {
                probeNonDriveVideo(img);
            }
        });
    }, [validImages, probeNonDriveVideo]);

    const applyStatusToRemaining = useCallback((status: 'approved' | 'rejected') => {
        if (remainingImageIds.length === 0) return;
        remainingImageIds.forEach(imgId => onFeedbackStatusChange(imgId, status));
    }, [remainingImageIds, onFeedbackStatusChange]);

    useEffect(() => {
        const isEditableTarget = (target: EventTarget | null): boolean => {
            const el = target as HTMLElement | null;
            if (!el) return false;
            const tag = el.tagName;
            return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable;
        };

        const onPaste = (e: ClipboardEvent) => {
            if (isEditableTarget(e.target)) return;

            // Enhanced: detect two-column paste (infoText \t URL)
            const plainText = e.clipboardData?.getData('text/plain') || '';
            const lines = plainText.split(/\r?\n/).filter(l => l.trim());
            const twoColumnLines: { infoText: string; url: string }[] = [];
            const singleLinks: string[] = [];

            // ── Phase 1: Parse structured HTML rows (primary source of truth for order) ──
            const html = e.clipboardData?.getData('text/html') || '';
            let htmlRowsFound = false;
            if (html) {
                const doc = new DOMParser().parseFromString(html, 'text/html');
                const rows = doc.querySelectorAll('tr');
                rows.forEach(row => {
                    const cells = Array.from(row.querySelectorAll('td,th'));
                    if (cells.length < 2) {
                        if (cells.length === 1) {
                            const cell = cells[0];
                            const url = extractUrlFromHtmlCell(cell);
                            if (url && /^https?:\/\//i.test(url)) {
                                const label = (cell.textContent || '').trim();
                                // Only use label as infoText if it's not just the URL itself
                                const infoText = (!/^https?:\/\//i.test(label) && label !== url) ? label : '';
                                twoColumnLines.push({ infoText, url });
                            }
                        }
                        return;
                    }
                    const values = cells.map(cell => extractHtmlCellPasteValue(cell));
                    twoColumnLines.push(...parseInfoUrlsFromCells(values));
                });
                htmlRowsFound = twoColumnLines.length > 0;
            }

            // ── Phase 2: Parse plain text lines (only if HTML rows didn't produce results) ──
            // When HTML rows are found, plain text contains the SAME data in a different URL format,
            // which would cause duplicates. Skip it to preserve HTML row order as the single source of truth.
            if (!htmlRowsFound) {
                for (const line of lines) {
                    const parts = line.split('\t');
                    if (parts.length >= 2) {
                        twoColumnLines.push(...parseInfoUrlsFromCells(parts));
                    } else {
                        const lineLinks = new Set<string>();
                        extractLinksFromText(line, lineLinks);
                        singleLinks.push(...Array.from(lineLinks));
                    }
                }
            }

            // ── Phase 3: Backstop link extraction (catch links missed by structured parsing) ──
            singleLinks.push(...extractLinksFromClipboard(e.clipboardData));

            // Dedup singleLinks against structured URLs using canonical keys (Drive file ID aware)
            const structuredKeys = new Set(twoColumnLines.map(item => getMediaUrlDedupKey(item.url)));
            const seenSingleKeys = new Set<string>();
            const uniqueSingleLinks: string[] = [];
            for (const link of singleLinks) {
                const key = getMediaUrlDedupKey(link);
                if (structuredKeys.has(key) || seenSingleKeys.has(key)) continue;
                seenSingleKeys.add(key);
                uniqueSingleLinks.push(link);
            }
            singleLinks.length = 0;
            singleLinks.push(...uniqueSingleLinks);

            if (twoColumnLines.length === 0 && singleLinks.length === 0) return;

            e.preventDefault();

            // Build existing keys set using canonical dedup keys
            const existingKeys = new Set([
                ...images.map(img => getMediaUrlDedupKey(img.originalUrl)),
                ...pastedImages.map(img => getMediaUrlDedupKey(img.originalUrl)),
            ]);

            // Merge two-column lines, deduplicating by canonical key (preserves first occurrence = HTML row order)
            const mergedByUrl = new Map<string, { infoText: string; url: string }>();
            const mergedKeyToUrl = new Map<string, string>(); // canonical key → first URL seen
            twoColumnLines.forEach(item => {
                const key = getMediaUrlDedupKey(item.url);
                const prev = mergedByUrl.get(key);
                if (!prev) {
                    mergedByUrl.set(key, item);
                    mergedKeyToUrl.set(key, item.url);
                    return;
                }
                if (!prev.infoText && item.infoText) {
                    mergedByUrl.set(key, { ...item, url: prev.url }); // keep first URL, take better infoText
                }
            });
            singleLinks.forEach(url => {
                const key = getMediaUrlDedupKey(url);
                if (!mergedByUrl.has(key)) {
                    mergedByUrl.set(key, { infoText: '', url });
                    mergedKeyToUrl.set(key, url);
                }
            });

            const mergedLines = Array.from(mergedByUrl.values());
            const toAdd = mergedLines.filter(item => !existingKeys.has(getMediaUrlDedupKey(item.url)));
            const upsertLines = mergedLines.map(i => i.infoText ? `${i.infoText}\t${i.url}` : i.url);

            if (upsertLines.length === 0) {
                setPasteHint('链接已存在');
                return;
            }

            setPastedImages(prev => {
                let changed = false;
                const updated = prev.map(img => {
                        const incoming = mergedByUrl.get(getMediaUrlDedupKey(img.originalUrl));
                        if (incoming) {
                            const nextInfo = img.infoText || incoming.infoText;
                            const nextType = img.isVideo !== undefined
                                ? img.isVideo
                                : inferExplicitMediaType(img.originalUrl);
                            if (nextInfo !== img.infoText || nextType !== img.isVideo) {
                                changed = true;
                                return { ...img, infoText: nextInfo, isVideo: nextType };
                            }
                    }
                    return img;
                });

                const newImages = toAdd.map((item, idx) => ({
                    ...buildPastedReviewImage(item.url, `pasted-${Date.now()}-${idx}`, item.infoText),
                    infoText: item.infoText,
                }));
                if (newImages.length > 0) {
                    return [...updated, ...newImages];
                }
                return changed ? updated : prev;
            });
            onAppendLinks?.(upsertLines);

            if (toAdd.length > 0) {
                const hasInfoText = mergedLines.some(item => item.infoText);
                setPasteHint(`已识别 ${toAdd.length} 条链接${hasInfoText ? '（含信息列）' : ''}`);
            } else {
                setPasteHint(`已更新 ${upsertLines.length} 条链接`);
            }
        };

        window.addEventListener('paste', onPaste);
        return () => window.removeEventListener('paste', onPaste);
    }, [images, pastedImages, onAppendLinks]);

    useEffect(() => {
        if (!pasteHint) return;
        const timer = window.setTimeout(() => setPasteHint(''), 1800);
        return () => window.clearTimeout(timer);
    }, [pasteHint]);

    useEffect(() => {
        if (!clearArmed) return;
        const timer = window.setTimeout(() => setClearArmed(false), 2000);
        return () => window.clearTimeout(timer);
    }, [clearArmed]);

    useEffect(() => {
        const apiKey = (driveApiKey || '').trim();
        if (!apiKey) return;

        const allImgs = [...images, ...pastedImages];
        const seenFileIds = new Set<string>();
        const targets = allImgs.filter(img => {
            if (!img.isGoogleDrive || !img.driveFileId || img.isVideo !== undefined) return false;
            if (seenFileIds.has(img.driveFileId)) return false;
            seenFileIds.add(img.driveFileId);
            return true;
        });
        if (targets.length === 0) return;

        let cancelled = false;

        (async () => {
            const typeByFileId: Record<string, boolean> = {};
            const nameByFileId: Record<string, string> = {};

            for (const img of targets) {
                if (cancelled) return;
                const fileId = img.driveFileId!;
                try {
                    const res = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?fields=mimeType,name&key=${apiKey}`);
                    if (!res.ok) continue;
                    const data = await res.json();
                    if (typeof data?.mimeType === 'string') {
                        typeByFileId[fileId] = data.mimeType.startsWith('video/');
                    }
                    if (typeof data?.name === 'string' && data.name.trim()) {
                        nameByFileId[fileId] = data.name.trim();
                    }
                } catch {
                    // ignore single-file fetch errors
                }
            }

            if (cancelled) return;
            if (Object.keys(typeByFileId).length === 0 && Object.keys(nameByFileId).length === 0) return;

            const finalResults: Record<string, { isVideo?: boolean; name?: string }> = {};
            for (const fileId of Array.from(new Set([...Object.keys(typeByFileId), ...Object.keys(nameByFileId)]))) {
                finalResults[fileId] = {
                    isVideo: typeByFileId[fileId],
                    name: nameByFileId[fileId],
                };
            }
            onDriveProbeResult?.(finalResults);

            setPastedImages(prev => prev.map(img => {
                const fileId = img.driveFileId || '';
                if (!fileId) return img;

                const resolvedType = typeByFileId[fileId];
                const resolvedName = nameByFileId[fileId];
                const fallbackType = img.isVideo;
                const nextType = resolvedType === undefined ? fallbackType : resolvedType;
                const nextInfo = img.infoText || resolvedName || img.infoText;

                if (nextType === img.isVideo && nextInfo === img.infoText) return img;
                return { ...img, isVideo: nextType, infoText: nextInfo };
            }));
        })();

        return () => {
            cancelled = true;
        };
    }, [images, pastedImages, driveApiKey]);


    // ── Binary Probe: fetch first 8-16 bytes via proxy to identify MP4/WebM/PNG/JPG ──
    useEffect(() => {
        const allImgs = [...images, ...pastedImages];
        // Only probe items that are still Unsure (undefined)
        const targets = allImgs.filter(
            img => img.driveFileId && img.isVideo === undefined
        );
        if (targets.length === 0) return;

        let cancelled = false;
        const results: Record<string, boolean> = {};

        (async () => {
            for (const img of targets) {
                if (cancelled) break;
                const fileId = img.driveFileId!;
                
                try {
                    // Try to sniff via proxy
                    const targetUrl = `https://drive.google.com/uc?id=${fileId}&export=download`;
                    const proxyUrl = `/api/image-proxy?url=${encodeURIComponent(targetUrl)}`;
                    
                    const res = await fetch(proxyUrl, { 
                        method: 'GET',
                        headers: { 'Range': 'bytes=0-15' }, // Only first 16 bytes
                        cache: 'no-cache'
                    });
                    
                    if (res.ok) {
                        const buffer = await res.arrayBuffer();
                        const bytes = new Uint8Array(buffer);
                        
                        // Magic numbers:
                        // [0, 0, 0, X, 102, 116, 121, 112] -> 'ftyp' (MP4)
                        const isMp4 = bytes[4] === 0x66 && bytes[5] === 0x74 && bytes[6] === 0x79 && bytes[7] === 0x70;
                        // [26, 69, 223, 163] -> EBML (WebM/MKV)
                        const isWebm = bytes[0] === 0x1A && bytes[1] === 0x45 && bytes[2] === 0xDF && bytes[3] === 0xA3;
                        // [137, 80, 78, 71] -> PNG
                        const isPng = bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4E && bytes[3] === 0x47;
                        // [255, 216, 255] -> JPG
                        const isJpg = bytes[0] === 0xFF && bytes[1] === 0xD8 && bytes[2] === 0xFF;

                        if (isMp4 || isWebm) {
                            results[fileId] = true;
                        } else if (isPng || isJpg) {
                            results[fileId] = false;
                        }
                    }
                } catch {
                    // ignore probe failures
                }
            }

            if (!cancelled && Object.keys(results).length > 0) {
                const finalResults: Record<string, { isVideo?: boolean }> = {};
                Object.entries(results).forEach(([fileId, isVideo]) => {
                    finalResults[fileId] = { isVideo };
                });
                onDriveProbeResult?.(finalResults);
                
                setPastedImages(prev => prev.map(img => {
                    const fileId = img.driveFileId || '';
                    if (!fileId || results[fileId] === undefined) return img;
                    if (img.isVideo !== undefined) return img;
                    return { ...img, isVideo: results[fileId] };
                }));
            }
        })();

        return () => { cancelled = true; };
    }, [images, pastedImages, onDriveProbeResult]);

    // ── Wheel zoom (zoom toward cursor) ──
    const handleWheel = useCallback((e: React.WheelEvent) => {
        e.preventDefault();
        const container = containerRef.current;
        if (!container) return;

        const rect = container.getBoundingClientRect();
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top;

        const delta = e.deltaY > 0 ? -ZOOM_FACTOR : ZOOM_FACTOR;
        const newScale = Math.max(MIN_SCALE, Math.min(MAX_SCALE, scale * (1 + delta)));
        const ratio = newScale / scale;

        setPanX(mouseX - (mouseX - panX) * ratio);
        setPanY(mouseY - (mouseY - panY) * ratio);
        setScale(newScale);
    }, [scale, panX, panY]);

    // ── Drag to pan: LEFT-CLICK on empty area, Alt+click, or Middle-click ──
    const handleMouseDown = useCallback((e: React.MouseEvent) => {
        // If an input is focused (for example reviewer name), clicking canvas should
        // immediately release focus so global paste can be handled by canvas.
        const active = document.activeElement as HTMLElement | null;
        const target = e.target as HTMLElement | null;
        if (isEditableEl(active) && active !== target) {
            active.blur();
        }

        // Allow pan on: middle click, Alt+click, or left-click on the canvas background
        const isCanvasBackground = target === containerRef.current
            || target?.getAttribute('data-canvas-bg') === 'true';
        const canPan = e.button === 1 || (e.button === 0 && e.altKey) || (e.button === 0 && isCanvasBackground);

        if (canPan) {
            e.preventDefault();
            setIsDragging(true);
            dragStart.current = { x: e.clientX, y: e.clientY, panX, panY };
        }
    }, [panX, panY, isEditableEl]);

    const handleMouseMove = useCallback((e: React.MouseEvent) => {
        // Card drag takes priority
        if (draggingCard) {
            const dx = (e.clientX - cardDragStart.current.x) / scale;
            const dy = (e.clientY - cardDragStart.current.y) / scale;
            setCardPositions(prev => ({
                ...prev,
                [draggingCard]: {
                    x: cardDragStart.current.origX + dx,
                    y: cardDragStart.current.origY + dy,
                },
            }));
            return;
        }
        if (!isDragging) return;
        setPanX(dragStart.current.panX + (e.clientX - dragStart.current.x));
        setPanY(dragStart.current.panY + (e.clientY - dragStart.current.y));
    }, [isDragging, draggingCard, scale]);

    const handleMouseUp = useCallback(() => {
        setIsDragging(false);
        setDraggingCard(null);
    }, []);

    // ── Keyboard ──
    useEffect(() => {
        const handler = (e: KeyboardEvent) => {
            if (e.key === '0' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                handleFitAll();
            }
        };
        window.addEventListener('keydown', handler);
        return () => window.removeEventListener('keydown', handler);
    }, [handleFitAll]);

    const tileW = tileSize;
    const uiScale = Math.max(0.7, tileW / 300);
    const DYN_INFO_BAR_H = Math.round(26 * uiScale);
    const DYN_BUTTON_BAR_H = Math.round(30 * uiScale);
    const tileH = tileSize + DYN_INFO_BAR_H + DYN_BUTTON_BAR_H;

    return (
        <div
            style={{
                width: '100%', height: '100%', overflow: 'hidden', position: 'relative',
                background: '#0f0f13',
                cursor: isDragging ? 'grabbing' : 'grab',
                userSelect: 'none',
            }}
            ref={containerRef}
            onWheel={handleWheel}
            onMouseDown={handleMouseDown}
            onMouseMove={handleMouseMove}
            onMouseUp={handleMouseUp}
            onMouseLeave={handleMouseUp}
            onContextMenu={e => e.preventDefault()}
        >
            {/* ── Zoom controls ── */}
            <div style={{
                position: 'absolute', top: 8, right: 8, zIndex: 10,
                display: 'flex', gap: 4, alignItems: 'center',
                background: 'rgba(0,0,0,0.7)', borderRadius: 8, padding: '4px 10px',
                backdropFilter: 'blur(8px)',
            }}>
                <button onClick={() => setScale(s => Math.max(MIN_SCALE, s * 0.8))}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}>
                    <ZoomOut size={14} />
                </button>
                <span style={{ fontSize: 10, color: '#94a3b8', minWidth: 44, textAlign: 'center' }}>
                    {Math.round(scale * 100)}%
                </span>
                <button onClick={() => setScale(s => Math.min(MAX_SCALE, s * 1.25))}
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}>
                    <ZoomIn size={14} />
                </button>
                <div style={{ width: 1, height: 14, background: '#3f3f46', margin: '0 4px' }} />
                <button onClick={handleFitAll} title="适应画布 (⌘0)"
                    style={{ background: 'none', border: 'none', color: '#94a3b8', cursor: 'pointer', padding: 2 }}>
                    <Maximize2 size={14} />
                </button>
                {/* ── Column selector ── */}
                <div style={{ width: 1, height: 14, background: '#3f3f46', margin: '0 4px' }} />
                <div style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                    <LayoutGrid size={12} style={{ color: '#64748b', flexShrink: 0 }} />
                    {[1, 2, 3, 4, 5, 6, 8].map(n => (
                        <button
                            key={n}
                            onClick={() => onColumnsChange?.(n)}
                            title={`每行 ${n} 个`}
                            style={{
                                background: requestedColumns === n ? 'rgba(99,102,241,0.35)' : 'rgba(255,255,255,0.06)',
                                border: requestedColumns === n ? '1px solid rgba(129,140,248,0.6)' : '1px solid transparent',
                                color: requestedColumns === n ? '#a5b4fc' : '#71717a',
                                cursor: 'pointer',
                                padding: '1px 5px',
                                borderRadius: 3,
                                fontSize: 10,
                                fontWeight: requestedColumns === n ? 700 : 500,
                                minWidth: 18,
                                textAlign: 'center' as const,
                                transition: 'all 0.12s',
                            }}
                        >{n}</button>
                    ))}
                </div>
                {onClear && displayImages.length > 0 && (
                    <>
                        <div style={{ width: 1, height: 14, background: '#3f3f46', margin: '0 4px' }} />
                        <button
                            onClick={() => {
                                if (clearArmed) {
                                    onClear();
                                    setClearArmed(false);
                                    setPasteHint('已清空画布内容');
                                    return;
                                }
                                setClearArmed(true);
                                setPasteHint('再次点击清空按钮以确认');
                            }}
                            title={clearArmed ? '再次点击确认清空' : '清空画布（需二次确认）'}
                            style={{
                                background: clearArmed ? 'rgba(239,68,68,0.28)' : 'rgba(239,68,68,0.12)',
                                border: clearArmed ? '1px solid rgba(254,202,202,0.85)' : '1px solid rgba(248,113,113,0.45)',
                                color: clearArmed ? '#fecaca' : '#f87171',
                                cursor: 'pointer',
                                padding: '2px 8px',
                                opacity: 1,
                                transition: 'background 0.15s, border-color 0.15s, color 0.15s, transform 0.15s',
                                borderRadius: 4,
                                display: 'flex',
                                alignItems: 'center',
                                gap: 4,
                                fontSize: 10,
                                fontWeight: 700,
                                transform: clearArmed ? 'scale(1.03)' : 'scale(1)',
                            }}
                        >
                            <Trash2 size={13} />
                            {clearArmed ? '确认清空' : '清空'}
                        </button>
                    </>
                )}
                <span style={{ fontSize: 9, color: '#52525b', marginLeft: 6 }}>
                    拖拽=平移 · 滚轮=缩放
                </span>
            </div>

            {pasteHint && (
                <div style={{
                    position: 'absolute',
                    top: 8,
                    left: '50%',
                    transform: 'translateX(-50%)',
                    zIndex: 11,
                    background: 'rgba(37,99,235,0.95)',
                    color: '#fff',
                    padding: '6px 12px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 600,
                    boxShadow: '0 4px 16px rgba(0,0,0,0.35)',
                }}>
                    {pasteHint}
                </div>
            )}

            {/* ── Canvas layer (for drag on empty space) ── */}
            <div
                data-canvas-bg="true"
                style={{
                    position: 'absolute', inset: 0,
                    cursor: isDragging ? 'grabbing' : 'grab',
                }}
            />

            {displayImages.length === 0 && (
                <div style={{
                    position: 'absolute',
                    inset: 0,
                    zIndex: 2,
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    pointerEvents: 'none',
                }}>
                    <div style={{
                        background: 'rgba(0,0,0,0.55)',
                        border: '1px solid #27272a',
                        borderRadius: 12,
                        padding: '16px 18px',
                        color: '#a1a1aa',
                        textAlign: 'center',
                        fontSize: 12,
                        lineHeight: 1.6,
                        maxWidth: 380,
                    }}>
                        画布已打开，直接按 Ctrl/Cmd+V 粘贴链接即可识别
                        <br />
                        支持 URL / IMAGE() / HYPERLINK()
                    </div>
                </div>
            )}

            {/* ── Transformed content ── */}
            <div style={{
                transformOrigin: '0 0',
                transform: `translate(${panX}px, ${panY}px) scale(${scale})`,
                position: 'absolute', top: 0, left: 0,
                imageRendering: 'auto',
            }}>
                <div
                    data-canvas-bg="true"
                    style={{
                    display: 'grid',
                    gridTemplateColumns: `repeat(${cols}, ${tileW}px)`,
                    gridAutoFlow: 'row',
                    gap: `${TILE_GAP}px`,
                }}>
                    {displayImages.map((img, idx) => {
                        const fb = feedbackMap[img.id];
                        const status = fb?.status || null;
                        const sc = status ? STATUS_COLORS[status] : null;
                        const fbIdx = fallbackIndex[img.id] || 0;
                        const allUrls = img.previewUrls && img.previewUrls.length > 0 ? img.previewUrls : [img.previewUrl];
                        const currentUrl = allUrls[fbIdx] || img.previewUrl;
                        const isInvalid = !img.isValid;
                        const isDriveFile = Boolean(img.isGoogleDrive && img.driveFileId);
                        const overrideType = videoTypeOverrides[img.id];
                        const isVideo = !isInvalid && (overrideType !== undefined ? overrideType : img.isVideo === true);
                        const isDriveVideo = isDriveFile && isVideo;
                        const isNonDriveVideo = !isDriveFile && isVideo;
                        const isDriveImage = isDriveFile && !isVideo;
                        // Always reserve top-right space for video buttons (both Drive and non-Drive)
                        const metaTop = isVideo ? 44 : 4;
                        // Video cards span 2 columns for landscape layout (only if grid has 2+ cols)
                        const isWide = !isInvalid && isVideo && cols >= 2;
                        const cardW = isWide ? tileW * 2 + TILE_GAP : tileW;
                        // 视频卡片：媒体区域固定 16:9，信息栏和按钮栏是额外空间
                        // 图片卡片：媒体区域正方形
                        const cardMediaH = isVideo
                            ? Math.round(cardW * 9 / 16)
                            : tileW;
                        const cardH = cardMediaH + DYN_INFO_BAR_H + DYN_BUTTON_BAR_H;

                        const cardPos = cardPositions[img.id];
                        return (
                            <div
                                key={img.id}
                                style={{
                                    width: cardW, height: cardH,
                                    gridColumn: isWide ? 'span 2' : 'span 1',
                                    borderRadius: 8, overflow: 'hidden',
                                    background: '#1c1c22',
                                    border: sc ? `2px solid ${sc.border}` : '2px solid #2a2a32',
                                    display: 'flex', flexDirection: 'column',
                                    position: cardPos ? 'absolute' : 'relative',
                                    transition: draggingCard === img.id ? 'none' : 'border-color 0.15s',
                                    boxShadow: draggingCard === img.id
                                        ? '0 8px 32px rgba(0,0,0,0.6)'
                                        : sc ? `0 0 12px ${sc.border}44` : '0 2px 8px rgba(0,0,0,0.3)',
                                    zIndex: draggingCard === img.id ? 100 : cardPos ? 10 : undefined,
                                    ...(cardPos ? { left: cardPos.x, top: cardPos.y } : {}),
                                }}
                            >
                                {/* ── Media area ── 视频固定 16:9，图片 flex 填充 */}
                                <div style={{
                                    ...(isVideo
                                        ? { flex: 'none', height: cardMediaH }
                                        : { flex: 1, minHeight: cardMediaH }),
                                    position: 'relative', overflow: 'hidden',
                                    background: '#111116', cursor: isInvalid ? 'not-allowed' : 'pointer',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                }}>
                                    {isInvalid ? (
                                        <div style={{
                                            width: '100%', height: '100%', padding: 12,
                                            display: 'flex', flexDirection: 'column', gap: 8,
                                            alignItems: 'center', justifyContent: 'center',
                                            color: '#94a3b8', textAlign: 'center',
                                        }}>
                                            <AlertTriangle size={22} style={{ color: '#f59e0b' }} />
                                            <div style={{ fontSize: 12, fontWeight: 700, color: '#fbbf24' }}>链接无效</div>
                                            <div style={{
                                                fontSize: 10, lineHeight: 1.4, color: '#64748b',
                                                maxWidth: '100%', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            }} title={img.originalUrl || img.infoText || '未识别内容'}>
                                                {img.originalUrl || img.infoText || '未识别内容'}
                                            </div>
                                        </div>
                                    ) : isDriveVideo ? (
                                        /* ── Drive VIDEO: Always render the interactive Drive player ── */
                                        <div style={{ width: '100%', height: '100%', position: 'relative' }}>
                                            <iframe
                                                data-video-id={img.id}
                                                src={`https://drive.google.com/file/d/${img.driveFileId}/preview`}
                                                style={{ width: '100%', height: '100%', border: 'none' }}
                                                allow="autoplay"
                                                loading="lazy"
                                            />
                                            {/* Top-Left Controls */}
                                            <div style={{
                                                position: 'absolute', top: 4, left: 4, zIndex: 5,
                                                display: 'flex', gap: 6, alignItems: 'center',
                                            }}>
                                                <span 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setVideoTypeOverrides(prev => ({ ...prev, [img.id]: false }));
                                                    }}
                                                    style={{
                                                        background: 'rgba(99,102,241,0.85)', borderRadius: 4, padding: '1px 6px',
                                                        fontSize: 9, color: '#fff', fontWeight: 600, cursor: 'pointer'
                                                    }} 
                                                    title="点击强制切换为图片"
                                                >
                                                    ▶ 视频
                                                </span>
                                                <button
                                                    onClick={e => { e.stopPropagation(); onOpenDrivePlayer(img.driveFileId!, img.originalUrl); }}
                                                    style={{
                                                        background: 'rgba(0,0,0,0.7)', border: 'none', borderRadius: 5,
                                                        color: '#fff', cursor: 'pointer', padding: '3px 6px',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                                                    }}
                                                    title="放大标注"
                                                >
                                                    <Maximize2 size={11} />
                                                </button>
                                            </div>
                                        </div>
                                    ) : isNonDriveVideo ? (
                                        /* ── External VIDEO: render native video player ── */
                                        <>
                                            <video
                                                src={img.originalUrl}
                                                style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                                                preload="metadata"
                                                playsInline
                                                muted={playingVideoId !== img.id}
                                                controls={playingVideoId === img.id}
                                                autoPlay={playingVideoId === img.id}
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (playingVideoId !== img.id) setPlayingVideoId(img.id);
                                                }}
                                                onPlay={() => setPlayingVideoId(img.id)}
                                                onPause={() => setPlayingVideoId(prev => (prev === img.id ? null : prev))}
                                                onError={() => setFailedThumbs(prev => new Set(prev).add(img.id))}
                                            />
                                            {playingVideoId !== img.id && (
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); setPlayingVideoId(img.id); }}
                                                    style={{
                                                        position: 'absolute', top: 6, left: 50, zIndex: 4,
                                                        background: 'rgba(0,0,0,0.6)', border: '1px solid rgba(255,255,255,0.3)',
                                                        borderRadius: '50%', width: 32, height: 32,
                                                        color: '#fff', cursor: 'pointer',
                                                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                                                        backdropFilter: 'blur(4px)',
                                                    }}
                                                    title="播放视频"
                                                >
                                                    <Play size={16} fill="#fff" style={{ marginLeft: 2 }} />
                                                </button>
                                            )}
                                            <span 
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    setVideoTypeOverrides(prev => ({ ...prev, [img.id]: false }));
                                                }}
                                                style={{
                                                position: 'absolute', top: 4, left: 4, zIndex: 5,
                                                background: 'rgba(99,102,241,0.85)', borderRadius: 4, padding: '1px 6px',
                                                fontSize: 9, color: '#fff', fontWeight: 600, cursor: 'pointer'
                                            }} title="点击强制切换为图片">▶ 视频</span>
                                        </>
                                    ) : (
                                        /* ── Regular image (Drive image or non-Drive) ── */
                                        <>
                                            {img.isGoogleDrive && failedThumbs.has(img.id) ? (
                                                <div 
                                                    style={{ position: 'absolute', inset: 0, cursor: 'pointer' }}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        onOpenAnnotation(img);
                                                    }}
                                                >
                                                    <iframe
                                                        src={`https://drive.google.com/file/d/${img.driveFileId}/preview`}
                                                        style={{ width: '100%', height: '100%', border: 'none', pointerEvents: 'none' }}
                                                        loading="lazy"
                                                        tabIndex={-1}
                                                    />
                                                </div>
                                            ) : (
                                                <img
                                                    src={currentUrl}
                                                    alt=""
                                                    referrerPolicy="no-referrer"
                                                    style={{ width: '100%', height: '100%', objectFit: 'contain', background: '#000' }}
                                                    loading="lazy"
                                                    draggable={false}
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        // Handle non-video (images) by directly opening the annotation editor
                                                        // which now has both drawing and text feedback capabilities
                                                        onOpenAnnotation(img);
                                                    }}
                                                    onError={() => {
                                                        // Only probe non-drive videos. Do NOT assume Drive files are videos just because a thumbnail 403s.
                                                        if (!img.isGoogleDrive && img.isVideo === undefined) {
                                                            probeNonDriveVideo(img);
                                                        }
                                                        
                                                        if (fbIdx + 1 < allUrls.length) {
                                                            setFallbackIndex(prev => ({ ...prev, [img.id]: fbIdx + 1 }));
                                                        } else {
                                                            setFailedThumbs(prev => new Set(prev).add(img.id));
                                                        }
                                                    }}
                                                />
                                            )}
                                            {/* Image badge for Drive images */}
                                            {(isDriveImage || !img.isGoogleDrive) && (
                                                <span 
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setVideoTypeOverrides(prev => ({ ...prev, [img.id]: true }));
                                                    }}
                                                    style={{
                                                    position: 'absolute', top: 4, left: 4, zIndex: 5,
                                                    background: 'rgba(34,197,94,0.85)', borderRadius: 4, padding: '1px 6px',
                                                    fontSize: 9, color: '#fff', fontWeight: 600, cursor: 'pointer'
                                                }} title="点击强制切换为视频">🖼 图片</span>
                                            )}
                                        </>
                                    )}

                                    {/* Status + indicators (auto avoid top-right player buttons) */}
                                    <div style={{
                                        position: 'absolute',
                                        top: metaTop,
                                        right: 4,
                                        zIndex: 6,
                                        display: 'flex',
                                        flexDirection: 'column',
                                        alignItems: 'flex-end',
                                        gap: 4,
                                        pointerEvents: 'none',
                                    }}>
                                        {sc && (
                                            <div style={{
                                                background: sc.bg, borderRadius: 5, padding: '1px 6px',
                                                fontSize: 13, color: sc.text, fontWeight: 700,
                                                border: `1px solid ${sc.border}`,
                                                boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
                                            }}>
                                                {sc.label}
                                            </div>
                                        )}
                                        <div style={{ display: 'flex', gap: 4 }}>
                                            {/* Text Feedback indicator */}
                                            {fb?.text && (
                                                <div style={{
                                                    background: '#f59e0b', borderRadius: 4, padding: '2px 6px',
                                                    fontSize: 9, color: '#fff', display: 'flex', alignItems: 'center', gap: 3,
                                                    fontWeight: 600, boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                                                }}>
                                                    💬 有文字
                                                </div>
                                            )}
                                            {/* Annotation indicator — support new screenshots[] */}
                                            {((fb?.screenshots && fb.screenshots.length > 0) || fb?.annotatedDataUrl) && (
                                                <div style={{
                                                    background: '#e11d48', borderRadius: 4, padding: '2px 6px',
                                                    fontSize: 9, color: '#fff', display: 'flex', alignItems: 'center', gap: 3,
                                                    fontWeight: 600, boxShadow: '0 2px 4px rgba(0,0,0,0.3)',
                                                }}>
                                                    <PenLine size={9} /> {fb?.screenshots && fb.screenshots.length > 1 ? `${fb.screenshots.length} 张截图` : '有截图'}
                                                </div>
                                            )}
                                        </div>
                                    </div>

                                </div>

                                {/* ── Info Bar (Index + infoText) — also serves as drag handle ── */}
                                <div
                                    data-card-id={img.id}
                                    style={{
                                        display: 'flex', alignItems: 'center', gap: Math.round(6 * uiScale),
                                        height: DYN_INFO_BAR_H, padding: `0 ${Math.round(6 * uiScale)}px`,
                                        background: sc ? sc.bg : '#16161a',
                                        borderTop: '1px solid #2a2a32',
                                        flexShrink: 0,
                                        cursor: draggingCard === img.id ? 'grabbing' : 'move',
                                    }}
                                    onMouseDown={e => {
                                        if (e.button !== 0) return;
                                        e.stopPropagation();
                                        e.preventDefault();
                                        // 首次拖拽：从获取屏幕实际位置来计算无缩放的绝对坐标，确保肉眼无缝切换为 absolute 且不跳动
                                        let pos = cardPositions[img.id];
                                        if (!pos) {
                                            const cardEl = (e.currentTarget as HTMLElement).parentElement;
                                            const container = containerRef.current;
                                            if (cardEl && container) {
                                                const rect = cardEl.getBoundingClientRect();
                                                const containerRect = container.getBoundingClientRect();
                                                const x = (rect.left - containerRect.left - panX) / scale;
                                                const y = (rect.top - containerRect.top - panY) / scale;
                                                pos = { x, y };
                                                setCardPositions(prev => ({ ...prev, [img.id]: pos! }));
                                            } else {
                                                pos = { x: 0, y: 0 };
                                            }
                                        }
                                        setDraggingCard(img.id);
                                        cardDragStart.current = { x: e.clientX, y: e.clientY, origX: pos.x, origY: pos.y };
                                    }}
                                    title="拖拽移动卡片"
                                >
                                    <span style={{
                                        fontSize: Math.round(9 * uiScale), color: '#52525b', marginRight: Math.round(2 * uiScale), userSelect: 'none',
                                    }}>⠿</span>
                                    <span style={{
                                        background: 'rgba(0,0,0,0.6)', borderRadius: Math.round(4 * uiScale), padding: `${Math.max(1, Math.round(1 * uiScale))}px ${Math.round(5 * uiScale)}px`,
                                        fontSize: Math.round(10 * uiScale), color: '#94a3b8', fontFamily: 'monospace',
                                    }}>#{idx + 1}</span>
                                    {img.infoText && (
                                        <div style={{
                                            fontSize: Math.round(10 * uiScale), color: '#e2e8f0', fontWeight: 500,
                                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                                            flex: 1,
                                        }} title={img.infoText}>
                                            📋 {img.infoText}
                                        </div>
                                    )}
                                </div>

                                {/* ── Three-button bar ── */}
                                <div style={{
                                    display: 'flex', height: DYN_BUTTON_BAR_H, borderTop: '1px solid #2a2a32',
                                    background: sc ? sc.bg : '#1c1c22',
                                    flexShrink: 0,
                                }}>
                                    {isInvalid ? (
                                        <div style={{
                                            flex: 1,
                                            display: 'flex',
                                            alignItems: 'center',
                                            justifyContent: 'center',
                                            color: '#fbbf24',
                                            fontSize: Math.round(11 * uiScale),
                                            fontWeight: 600,
                                        }}>
                                            无效链接占位
                                        </div>
                                    ) : ([
                                        { key: 'approved' as const, Icon: Check, label: '可以使用' },
                                        { key: 'needs-edit' as const, Icon: AlertTriangle, label: '需要修改' },
                                        { key: 'rejected' as const, Icon: XCircle, label: '不可使用' },
                                    ] as const).map(({ key, Icon, label }, bi) => {
                                        const active = status === key;
                                        const c = STATUS_COLORS[key];
                                        const hasScreenshots = (fb?.screenshots && fb.screenshots.length > 0) || !!fb?.annotatedDataUrl;
                                        const hasSuggestion = (key === 'needs-edit' || key === 'rejected') && Boolean(
                                            (fb?.text || '').trim()
                                            || hasScreenshots
                                        );
                                        const displayLabel = active && hasSuggestion ? '查看建议' : label;
                                        return (
                                            <button
                                                key={key}
                                                onClick={() => {
                                                    if (key === 'needs-edit') {
                                                        if (active) {
                                                            if (hasSuggestion) {
                                                                onOpenFeedbackModal(img);
                                                            } else {
                                                                onFeedbackStatusChange(img.id, null);
                                                            }
                                                            return;
                                                        }
                                                        onFeedbackStatusChange(img.id, key);
                                                        onOpenFeedbackModal(img);
                                                        return;
                                                    }
                                                    if (key === 'rejected') {
                                                        if (active) {
                                                            if (hasSuggestion) {
                                                                onOpenFeedbackModal(img);
                                                            } else {
                                                                // Show inline reason input
                                                                setRejectReasonId(img.id);
                                                                setRejectReasonText(fb?.text || '');
                                                            }
                                                            return;
                                                        }
                                                        onFeedbackStatusChange(img.id, key);
                                                        // Show inline reason input
                                                        setRejectReasonId(img.id);
                                                        setRejectReasonText('');
                                                        return;
                                                    }
                                                    onFeedbackStatusChange(img.id, active ? null : key);
                                                }}
                                                style={{
                                                    flex: 1, border: 'none', cursor: 'pointer',
                                                    display: 'flex', alignItems: 'center', justifyContent: 'center', gap: Math.round(3 * uiScale),
                                                    fontSize: Math.round(11 * uiScale), fontWeight: active ? 700 : 400,
                                                    background: active ? c.bg : 'transparent',
                                                    color: active ? c.text : '#71717a',
                                                    transition: 'all 0.15s',
                                                    borderRight: bi < 2 ? '1px solid #2a2a32' : 'none',
                                                }}
                                            >
                                                <Icon size={Math.round(12 * uiScale)} /> {displayLabel}
                                            </button>
                                        );
                                    })}
                                </div>

                                {/* ── Feedback text and Clear Advice ── */}
                                {((fb?.text) || (fb?.screenshots && fb.screenshots.length > 0) || fb?.annotatedDataUrl) && (
                                    <div style={{
                                        display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 4,
                                        padding: '3px 6px', fontSize: 9, color: '#a1a1aa',
                                        borderTop: '1px solid #2a2a32', background: '#16161a',
                                    }}>
                                        <div style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', flex: 1 }} title={fb?.text || ''}>
                                            {fb?.text ? `💬 ${fb.text}` : '🖼️ 有截图建议'}
                                        </div>
                                        {onClearFeedbackAdvice && (
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onClearFeedbackAdvice(img.id); }}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 2,
                                                    background: 'rgba(239, 68, 68, 0.15)', border: '1px solid rgba(239, 68, 68, 0.3)',
                                                    borderRadius: 4, color: '#fca5a5', cursor: 'pointer', padding: '1px 4px', fontSize: 9, flexShrink: 0,
                                                }}
                                                title="清空当前卡片建议"
                                            >
                                                <Trash2 size={9} /> 清空建议
                                            </button>
                                        )}
                                    </div>
                                )}

                                {/* ── Reject reason inline input ── */}
                                {rejectReasonId === img.id && (
                                    <div style={{
                                        padding: '4px 6px', borderTop: '1px solid #2a2a32',
                                        background: '#1c1117', display: 'flex', gap: 4, alignItems: 'center',
                                    }} onClick={e => e.stopPropagation()} onMouseDown={e => e.stopPropagation()}>
                                        <input
                                            autoFocus
                                            value={rejectReasonText}
                                            onChange={e => setRejectReasonText(e.target.value)}
                                            onKeyDown={e => {
                                                e.stopPropagation();
                                                if (e.key === 'Enter') {
                                                    onUpdateFeedbackText?.(img.id, rejectReasonText);
                                                    setRejectReasonId(null);
                                                }
                                                if (e.key === 'Escape') setRejectReasonId(null);
                                            }}
                                            placeholder="不可使用的原因…"
                                            style={{
                                                flex: 1, background: 'rgba(255,255,255,0.08)', border: '1px solid #ef4444',
                                                borderRadius: 4, color: '#fca5a5', fontSize: 10, padding: '2px 6px',
                                                outline: 'none', fontFamily: 'inherit',
                                            }}
                                        />
                                        <button
                                            onClick={() => {
                                                onUpdateFeedbackText?.(img.id, rejectReasonText);
                                                setRejectReasonId(null);
                                            }}
                                            style={{
                                                background: '#ef4444', border: 'none', borderRadius: 4,
                                                color: '#fff', fontSize: 9, padding: '2px 6px', cursor: 'pointer', fontWeight: 600,
                                            }}
                                        >确认</button>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>

            {/* ── Stats bar ── */}
            <div style={{
                position: 'absolute', bottom: 0, left: 0, right: 0, zIndex: 10,
                background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(8px)',
                padding: '6px 16px', display: 'flex', alignItems: 'center', gap: 16,
                fontSize: 11, color: '#94a3b8',
            }}>
                <span>共 {displayImages.length} 个文件</span>
                <span style={{ color: '#3f3f46' }}>|</span>
                <span style={{ color: '#52525b' }}>{cols} 列</span>
                {(() => {
                    const a = Object.values(feedbackMap).filter(f => f.status === 'approved').length;
                    const n = Object.values(feedbackMap).filter(f => f.status === 'needs-edit').length;
                    const r = Object.values(feedbackMap).filter(f => f.status === 'rejected').length;
                    const u = Math.max(0, displayImages.length - a - n - r);
                    return (
                        <>
                            {a > 0 && <span style={{ color: '#4ade80' }}>✅ {a}</span>}
                            {n > 0 && <span style={{ color: '#facc15' }}>⚠️ {n}</span>}
                            {r > 0 && <span style={{ color: '#f87171' }}>❌ {r}</span>}
                            {u > 0 && <span style={{ color: '#52525b' }}>未标记 {u}</span>}
                        </>
                    );
                })()}
                {onBatchFeedback && displayImages.length > 0 && (
                    <>
                        <span style={{ color: '#3f3f46' }}>|</span>
                        <button
                            onClick={() => applyStatusToRemaining('approved')}
                            disabled={remainingImageIds.length === 0}
                            style={{
                                background: 'rgba(74,222,128,0.15)', border: '1px solid rgba(74,222,128,0.3)',
                                borderRadius: 4, color: '#4ade80', fontSize: 10, padding: '2px 8px',
                                cursor: remainingImageIds.length === 0 ? 'not-allowed' : 'pointer',
                                fontWeight: 600, transition: 'all 0.15s',
                                opacity: remainingImageIds.length === 0 ? 0.45 : 1,
                            }}
                            onMouseEnter={e => {
                                if (remainingImageIds.length > 0) e.currentTarget.style.background = 'rgba(74,222,128,0.3)';
                            }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(74,222,128,0.15)'; }}
                        >✓ 剩下全部可用</button>
                        <button
                            onClick={() => applyStatusToRemaining('rejected')}
                            disabled={remainingImageIds.length === 0}
                            style={{
                                background: 'rgba(248,113,113,0.15)', border: '1px solid rgba(248,113,113,0.3)',
                                borderRadius: 4, color: '#f87171', fontSize: 10, padding: '2px 8px',
                                cursor: remainingImageIds.length === 0 ? 'not-allowed' : 'pointer',
                                fontWeight: 600, transition: 'all 0.15s',
                                opacity: remainingImageIds.length === 0 ? 0.45 : 1,
                            }}
                            onMouseEnter={e => {
                                if (remainingImageIds.length > 0) e.currentTarget.style.background = 'rgba(248,113,113,0.3)';
                            }}
                            onMouseLeave={e => { e.currentTarget.style.background = 'rgba(248,113,113,0.15)'; }}
                        >✕ 剩下全部不可用</button>
                            <button
                                onClick={() => onBatchFeedback(null)}
                                style={{
                                    background: 'rgba(148,163,184,0.1)', border: '1px solid rgba(148,163,184,0.2)',
                                    borderRadius: 4, color: '#64748b', fontSize: 10, padding: '2px 8px',
                                    cursor: 'pointer', transition: 'all 0.15s',
                                }}
                                onMouseEnter={e => { e.currentTarget.style.background = 'rgba(148,163,184,0.2)'; }}
                                onMouseLeave={e => { e.currentTarget.style.background = 'rgba(148,163,184,0.1)'; }}
                            >清除标记</button>
                            {onClearAllFeedbackAdvice && (
                                <button
                                    onClick={onClearAllFeedbackAdvice}
                                    style={{
                                        background: 'rgba(239, 68, 68, 0.1)', border: '1px solid rgba(239, 68, 68, 0.2)',
                                        borderRadius: 4, color: '#f87171', fontSize: 10, padding: '2px 8px',
                                        cursor: 'pointer', transition: 'all 0.15s',
                                    }}
                                    onMouseEnter={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.2)'; }}
                                    onMouseLeave={e => { e.currentTarget.style.background = 'rgba(239, 68, 68, 0.1)'; }}
                                >清空所有卡片建议</button>
                            )}
                        </>
                    )}
                </div>
        </div>
    );
};

export default ReviewCanvasView;
