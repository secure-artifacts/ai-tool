/**
 * ImageFormulaPanel - 图片链接转 Google Sheets IMAGE() 公式工具
 * 
 * 功能：
 * 1. 输入多个图片链接（每行一个或逗号/空格分隔）
 * 2. 生成 =IMAGE("url") 公式
 * 3. 横版排列显示：第一行原始链接，第二行缩略图预览
 * 4. 可配置每行显示几个
 * 5. 复制后直接粘贴到 Google Sheets
 */

import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
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
} from 'lucide-react';

interface ImageFormulaProps {
    onBack?: () => void;
}

interface ParsedImage {
    id: string;
    originalUrl: string;
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
 */
function driveIdToPreviewUrls(fileId: string, resourceKey?: string): string[] {
    const candidates = [
        withResourceKey(`https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`, resourceKey),
        withResourceKey(`https://drive.usercontent.google.com/download?id=${fileId}&export=view`, resourceKey),
        `https://lh3.googleusercontent.com/d/${fileId}=w1600`,
        `https://lh3.googleusercontent.com/d/${fileId}`,
        withResourceKey(`https://drive.google.com/uc?export=view&id=${fileId}`, resourceKey),
        withResourceKey(`https://drive.google.com/uc?export=download&id=${fileId}`, resourceKey),
    ];
    return Array.from(new Set(candidates));
}

// =================================================================

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
    const [previewFallbackIndex, setPreviewFallbackIndex] = useState<Record<string, number>>({});
    const [showFormulaInPreview, setShowFormulaInPreview] = useState(false);
    const [imageMode, setImageMode] = useState<1 | 2 | 4>(1); // Google Sheets IMAGE mode
    const [customImageHeight, setCustomImageHeight] = useState(200);
    const [customImageWidth, setCustomImageWidth] = useState(200);
    const textareaRef = useRef<HTMLTextAreaElement>(null);

    // Parse input URLs
    const parsedImages: ParsedImage[] = useMemo(() => {
        if (!inputText.trim()) return [];

        // Split by newline, comma, space, or tab
        const lines = inputText
            .split(/[\n,\t]+/)
            .map(s => s.trim())
            .filter(s => s.length > 0);

        // Deduplicate while preserving order
        const seen = new Set<string>();
        const unique: string[] = [];
        for (const line of lines) {
            if (!seen.has(line)) {
                seen.add(line);
                unique.push(line);
            }
        }

        return unique.map((url, i) => {
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
                    driveIssue = '这是 Google Drive 文件夹链接，不是图片文件链接';
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

            return {
                id: `img-${i}`,
                originalUrl: url,
                imageUrl,
                previewUrl,
                previewUrls,
                formula,
                isValid,
                isGoogleDrive: isDrive,
                driveFileId,
                driveIssue,
            };
        });
    }, [inputText, imageMode, customImageHeight, customImageWidth]);

    useEffect(() => {
        setPreviewFallbackIndex({});
    }, [inputText, imageMode, itemsPerRow]);

    // Group images into rows
    const imageRows = useMemo(() => {
        const rows: ParsedImage[][] = [];
        for (let i = 0; i < parsedImages.length; i += itemsPerRow) {
            rows.push(parsedImages.slice(i, i + itemsPerRow));
        }
        return rows;
    }, [parsedImages, itemsPerRow]);

    // Generate TSV data for clipboard (horizontal layout)
    // Row 1: original URLs
    // Row 2: =IMAGE() formulas
    const generateTsvData = useCallback(() => {
        if (parsedImages.length === 0) return '';

        if (layoutMode === 'horizontal') {
            // 横版：一行链接 + 一行公式，按 itemsPerRow 分组
            const blocks: string[] = [];
            for (const row of imageRows) {
                const urlRow = row.map(img => img.originalUrl).join('\t');
                const formulaRow = row.map(img => img.formula).join('\t');
                blocks.push(`${urlRow}\n${formulaRow}`);
            }
            return blocks.join('\n');
        } else {
            // 纵版：每列一组（链接 + 公式），横向排列
            const blocks: string[] = [];
            for (const row of imageRows) {
                // Each image takes 2 columns (URL, Formula)
                const urlRow = row.map(img => img.originalUrl).join('\t');
                const formulaRow = row.map(img => img.formula).join('\t');
                blocks.push(`${urlRow}\n${formulaRow}`);
            }
            return blocks.join('\n');
        }
    }, [parsedImages, imageRows, layoutMode]);

    // Copy to clipboard as TSV (Tab-separated values for Google Sheets)
    const handleCopy = useCallback(async () => {
        const tsv = generateTsvData();
        if (!tsv) return;

        try {
            // Build HTML table to ensure Google Sheets interprets formulas correctly
            const htmlRows: string[] = [];
            for (const row of imageRows) {
                // URL row
                htmlRows.push('<tr>' + row.map(img =>
                    `<td>${img.originalUrl}</td>`
                ).join('') + '</tr>');
                // Formula row
                htmlRows.push('<tr>' + row.map(img =>
                    `<td>${img.formula}</td>`
                ).join('') + '</tr>');
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
    }, [generateTsvData, imageRows]);

    // Copy only URLs
    const handleCopyUrls = useCallback(async () => {
        const urls = parsedImages.map(img => img.originalUrl).join('\n');
        if (!urls) return;
        try {
            await navigator.clipboard.writeText(urls);
            setCopyUrlStatus('copied');
            setTimeout(() => setCopyUrlStatus('idle'), 2000);
        } catch (e) {
            console.error('Copy failed:', e);
        }
    }, [parsedImages]);

    // Clear all
    const handleClear = () => {
        setInputText('');
    };

    // Handle paste - support pasting from Google Sheets (with HTML)
    const handlePaste = useCallback((e: React.ClipboardEvent) => {
        const html = e.clipboardData.getData('text/html');
        if (html) {
            // Try to extract URLs from HTML table cells
            const parser = new DOMParser();
            const doc = parser.parseFromString(html, 'text/html');
            const cells = doc.querySelectorAll('td');
            if (cells.length > 0) {
                e.preventDefault();
                const urls: string[] = [];
                cells.forEach(cell => {
                    const text = cell.textContent?.trim() || '';
                    if (text && /^https?:\/\//i.test(text)) {
                        urls.push(text);
                    }
                    // Also extract from =IMAGE() formula
                    const match = text.match(/=IMAGE\s*\(\s*"([^"]+)"/i);
                    if (match) {
                        urls.push(match[1]);
                    }
                });
                if (urls.length > 0) {
                    setInputText(prev => {
                        const existing = prev.trim();
                        return existing ? existing + '\n' + urls.join('\n') : urls.join('\n');
                    });
                    return;
                }
            }
        }
        // Default: let the textarea handle it normally
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

    const validCount = parsedImages.filter(img => img.isValid).length;
    const invalidCount = parsedImages.length - validCount;
    const driveCount = parsedImages.filter(img => img.isGoogleDrive).length;

    return (
        <div className="h-full flex flex-col bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            {/* Header */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 bg-gradient-to-r from-blue-50 to-indigo-50 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="bg-gradient-to-br from-blue-500 to-indigo-600 p-2 rounded-lg shadow-sm">
                        <Image className="text-white" size={18} />
                    </div>
                    <div>
                        <h2 className="font-bold text-slate-800 text-sm">图片公式生成器</h2>
                        <p className="text-[11px] text-slate-500">批量生成 Google Sheets =IMAGE() 公式，支持直接粘贴到表格</p>
                    </div>
                </div>
                <div className="flex items-center gap-2">
                    {parsedImages.length > 0 && (
                        <span className="text-xs text-slate-500 bg-white px-2 py-1 rounded-full border border-slate-200 shadow-sm">
                            {validCount} 个链接
                            {driveCount > 0 && <span className="text-blue-600 ml-1">({driveCount} GDrive)</span>}
                            {invalidCount > 0 && <span className="text-amber-600 ml-1">({invalidCount} 无效)</span>}
                        </span>
                    )}
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
                    </div>
                </div>
            )}

            {/* Main Content */}
            <div className="flex-1 flex overflow-hidden min-h-0">

                {/* Left: Input Area */}
                <div className="w-full md:w-[360px] flex flex-col border-r border-slate-200 shrink-0">
                    <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
                        <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                            <Link2 size={12} className="text-blue-500" />
                            粘贴图片链接（每行一个）
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
                        placeholder={"粘贴图片链接，每行一个：\n\nhttps://example.com/image1.jpg\nhttps://drive.google.com/open?id=xxx\nhttps://drive.google.com/file/d/xxx/view\n\n💡 支持 Google Drive 各种链接格式\n💡 也支持从 Google Sheets 粘贴带 =IMAGE() 公式的单元格"}
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
                                onClick={handleClear}
                                disabled={parsedImages.length === 0}
                                className="flex items-center justify-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-medium bg-white text-slate-500 border border-slate-200 hover:bg-red-50 hover:text-red-500 hover:border-red-200 transition-all disabled:opacity-40 disabled:cursor-not-allowed"
                            >
                                <Trash2 size={12} /> 清空
                            </button>
                        </div>
                        <p className="text-[10px] text-slate-400 text-center">
                            ⌘+Enter 快捷复制 • 复制后直接 Ctrl+V 到 Google Sheets
                        </p>
                    </div>
                </div>

                {/* Right: Preview Area */}
                <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
                    <div className="px-3 py-2 border-b border-slate-100 bg-slate-50 flex items-center justify-between shrink-0">
                        <span className="text-xs font-medium text-slate-600 flex items-center gap-1.5">
                            <Grid size={12} className="text-indigo-500" />
                            预览 —— 粘贴后在 Google Sheets 中的效果
                        </span>
                        <div className="flex items-center gap-2">
                            <span className="text-[10px] text-slate-400">
                                {imageRows.length} 组 × {itemsPerRow} 列
                            </span>
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
                                                行 {rowIdx * 2 + 1}-{rowIdx * 2 + 2}
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
                                                                            className="rounded-md overflow-hidden border border-slate-200 bg-slate-50 shadow-sm hover:shadow-md hover:border-indigo-300 transition-all cursor-pointer group relative"
                                                                            style={{ width: thumbnailSize, height: thumbnailSize }}
                                                                            onClick={() => window.open(img.originalUrl, '_blank')}
                                                                        >
                                                                            <img
                                                                                src={currentPreviewUrl}
                                                                                alt=""
                                                                                className={`w-full h-full ${imageMode === 2 ? 'object-fill' : 'object-contain'}`}
                                                                                loading="lazy"
                                                                                onError={(e) => {
                                                                                    const nextIndex = fallbackIdx + 1;
                                                                                    const hasNext = !!(img.previewUrls && nextIndex < img.previewUrls.length);
                                                                                    if (hasNext) {
                                                                                        setPreviewFallbackIndex(prev => ({ ...prev, [img.id]: nextIndex }));
                                                                                        return;
                                                                                    }
                                                                                    (e.target as HTMLImageElement).style.display = 'none';
                                                                                    const placeholder = (e.target as HTMLImageElement).nextElementSibling as HTMLElement;
                                                                                    if (placeholder) placeholder.style.display = 'flex';
                                                                                }}
                                                                            />
                                                                            <div className="hidden absolute inset-0 items-center justify-center bg-slate-100 text-slate-400 flex-col gap-1" style={{ display: 'none' }}>
                                                                                {img.isGoogleDrive ? (
                                                                                    <>
                                                                                        <Image size={16} className="text-blue-400" />
                                                                                        <span className="text-[8px] text-blue-500">Google Drive</span>
                                                                                        {img.driveIssue && (
                                                                                            <span className="text-[8px] text-amber-500 px-1 text-center leading-tight">{img.driveIssue}</span>
                                                                                        )}
                                                                                    </>
                                                                                ) : (
                                                                                    <AlertCircle size={20} />
                                                                                )}
                                                                            </div>
                                                                            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center">
                                                                                <ExternalLink size={14} className="text-white opacity-0 group-hover:opacity-100 transition-opacity drop-shadow" />
                                                                            </div>
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
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ))}

                                {/* Summary */}
                                <div className="text-center py-4">
                                    <div className="inline-flex items-center gap-3 px-4 py-2 bg-slate-100 rounded-full text-xs text-slate-500">
                                        <span>共 <strong className="text-slate-700">{parsedImages.length}</strong> 个图片</span>
                                        <span className="text-slate-300">|</span>
                                        <span>分 <strong className="text-slate-700">{imageRows.length}</strong> 组</span>
                                        <span className="text-slate-300">|</span>
                                        <span>每行 <strong className="text-slate-700">{itemsPerRow}</strong> 个</span>
                                        <span className="text-slate-300">|</span>
                                        <span>共 <strong className="text-slate-700">{imageRows.length * 2}</strong> 行</span>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};

export default ImageFormulaPanel;
