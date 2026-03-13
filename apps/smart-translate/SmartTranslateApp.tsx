import React, { useState, useRef, useEffect, createContext, useContext, useCallback, useMemo } from 'react';
import { Copy, Check, FileText, Globe, Languages, RefreshCw, Plus, FolderOpen, Pencil } from 'lucide-react';
import { GoogleGenAI } from "@google/genai";
import './SmartTranslateApp.css';
import { InstantTranslateTool } from './InstantTranslateTool';
import { allLanguages } from './constants';
import { LanguageSelector } from './LanguageSelector';
import { fetchImageBlob, processImageUrl, decodeHtmlEntities } from '@/apps/ai-image-recognition/utils';
import {
    appendToSheet,
    getSheetsSyncConfig
} from '@/services/sheetsSyncService';
import { useAuth } from '../../contexts/AuthContext';
import ProjectPanel from '../../components/ProjectPanel';
import {
    Project,
    debouncedSaveProject,
    createProject,
    getOrCreateSharedProject
} from '../../services/projectService';

// --- Constants ---
const DEFAULT_GYAZO_TOKEN = 'W0SHYCmn38FEoNQEdu7GwT1bOJP84TjQadGjlSgbG6I';
const BATCH_LANG_STORAGE_KEY = 'smart_translate_batch_languages';
const BATCH_ONLY_CHINESE_KEY = 'smart_translate_batch_only_chinese';
const BATCH_CLEANUP_MODE_KEY = 'smart_translate_batch_cleanup_mode';
const CUSTOM_INSTRUCTION_KEY = 'smart_translate_custom_instruction';
const DEFAULT_BATCH_LANGS = ['en'];

const zhDisplayNames = typeof Intl !== 'undefined' && typeof Intl.DisplayNames === 'function'
    ? new Intl.DisplayNames(['zh-CN'], { type: 'language' })
    : null;

const getChineseLanguageLabel = (code: string) => {
    if (!zhDisplayNames) return '';
    if (!code || code === 'smart_auto') return '';
    const normalized = code.replace('_', '-');
    return zhDisplayNames.of(normalized) || '';
};

const getLanguageName = (code: string) => {
    const fallbackName = allLanguages.find(l => l.code === code)?.name || '';
    const zhName = getChineseLanguageLabel(code);
    if (zhName) {
        if (fallbackName && !fallbackName.includes(zhName)) {
            return `${zhName} (${fallbackName})`;
        }
        return zhName;
    }
    return fallbackName || code;
};

const normalizeBatchLanguages = (languages?: string[] | null): string[] => {
    const validCodes = new Set(allLanguages.map(l => l.code));
    const cleaned: string[] = [];

    (languages || []).forEach(code => {
        if (!validCodes.has(code)) return;
        if (code === 'smart_auto' || code === 'zh') return;
        if (cleaned.includes(code)) return;
        cleaned.push(code);
    });

    if (cleaned.length === 0) {
        return DEFAULT_BATCH_LANGS.slice();
    }

    return cleaned;
};

const loadBatchLanguages = (): string[] => {
    if (typeof localStorage === 'undefined') {
        return DEFAULT_BATCH_LANGS.slice();
    }
    try {
        const raw = localStorage.getItem(BATCH_LANG_STORAGE_KEY);
        if (!raw) return DEFAULT_BATCH_LANGS.slice();
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return DEFAULT_BATCH_LANGS.slice();
        return normalizeBatchLanguages(parsed);
    } catch {
        return DEFAULT_BATCH_LANGS.slice();
    }
};

const loadBatchOnlyChinese = (): boolean => {
    if (typeof localStorage === 'undefined') {
        return false;
    }
    try {
        const raw = localStorage.getItem(BATCH_ONLY_CHINESE_KEY);
        if (!raw) return false;
        return JSON.parse(raw) === true;
    } catch {
        return false;
    }
};

const loadBatchCleanupMode = (): boolean => {
    if (typeof localStorage === 'undefined') {
        return false;
    }
    try {
        const raw = localStorage.getItem(BATCH_CLEANUP_MODE_KEY);
        if (!raw) return false;
        return JSON.parse(raw) === true;
    } catch {
        return false;
    }
};

const loadCustomInstruction = (): string => {
    if (typeof localStorage === 'undefined') return '';
    try {
        return localStorage.getItem(CUSTOM_INSTRUCTION_KEY) || '';
    } catch {
        return '';
    }
};

// Helper for retrying on empty results - 当 AI 返回空结果时自动重试
async function retryOnEmpty<T>(
    fn: () => Promise<T>,
    isEmpty: (result: T) => boolean,
    maxRetries: number = 3,
    initialDelayMs: number = 1500
): Promise<T> {
    let lastResult: T | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
        try {
            const result = await fn();
            lastResult = result;

            if (!isEmpty(result)) {
                return result;
            }

            if (attempt < maxRetries) {
                const delay = Math.min(initialDelayMs * Math.pow(1.5, attempt), 5000);
                await new Promise(resolve => setTimeout(resolve, delay));
            }
        } catch (error) {
            // 发生错误时直接抛出，不重试
            throw error;
        }
    }

    // 所有重试都返回空结果，返回最后一次结果
    console.warn('[retryOnEmpty] All retries exhausted with empty results');
    return lastResult!;
}

// --- App Contexts (API, i18n, Theme) ---
const translations = {
    en: {
        appTitle: "Smart Translate",
        navTranslate: "Smart Translate",
        // Translate Tool
        translateTitle: "Batch Smart Translate",
        translateDescription: "Paste images (Ctrl+V), drag & drop files, or enter links/text below.",
        translateButton: "Translate",
        inputPlaceholder: "Enter text, image link (http://...), or paste an image (Ctrl+V)...",
        uploadButton: "Upload Image",
        clearQueue: "Clear All",
        targetLanguage: "Target:",
        batchLanguagesLabel: "Batch languages:",
        batchLanguagesHint: "Chinese (Simplified) is always included.",
        batchOnlyChineseLabel: "Only translate to Chinese",
        batchOnlyChineseHint: "When enabled, other languages are ignored.",
        batchCleanupModeLabel: "Watermark Cleanup Mode",
        batchCleanupModeHint: "When enabled, the AI will attempt to remove AI tool watermarks (e.g. \"Made with ChatGPT\") before translating. Default: OFF.",
        batchCleanupModeWarning: "⚠️ Warning: This mode may occasionally misidentify a title or closing line as promotional content, causing it to be omitted from the translation. Please review results manually.",
        batchLanguagesSelected: "Selected",
        batchLanguagesEmpty: "No extra languages selected",
        batchLanguagesEdit: "Edit",
        searchLanguage: "Search language...",
        copyAll: "Copy All",
        copyAllSuccess: "Copied!",
        retranslateAll: "Retranslate All",
        addEmpty: "Add Empty",
        addEmptyTooltip: "Add an empty entry for manual input",
        // Items
        item_text_label: "Text Input",
        item_image_label: "Image",
        status_idle: "Idle",
        status_uploading: "Uploading...",
        status_fetching: "Fetching...",
        status_ocr: "Reading...",
        status_translating: "Translating...",
        status_done: "Done",
        status_error: "Error",
        upload_error: "Upload failed",
        upload_error_token: "Token Error",
        link_label: "Image Link",
        link_placeholder_text: "--",
        original_text: "Original:",
        translated_text: "Translated:",
        copy: "Copy",
        copy_link: "Copy Link",
        copied: "Copied!",
        delete: "Delete",
        set_token_btn: "⚠️ Check Token",
        // Mode switching
        modeBatch: "Batch",
        modeInstant: "Instant",
        // Instant translate
        instantTitle: "Instant Translate",
        instantInputPlaceholder: "Type or paste text/image here for instant translation...",
        instantOriginal: "Original:",
        instantTranslated: "Translated:",
        instantProcessingOCR: "Recognizing text...",
        instantProcessingTranslate: "Translating...",
        instantPlaceholder: "Translation will appear here...",
        instantHint: "Click the button or press Ctrl/Cmd+Enter to translate",
        instantTranslateButton: "Translate Now",
        error_ocrFailed: "OCR failed",
        error_translationFailed: "Translation failed",
        modelLabel: "Model",
        // General
        apiKeyTitle: "Settings",
        apiKeyButtonLabel: "Settings / API Key",
        apiKeyPrompt: "Configure your API keys below. Data is stored locally in your browser.",
        apiKeyInputPlaceholder: "Google Gemini API Key",
        gyazoTokenLabel: "Gyazo Access Token (Pre-configured)",
        gyazoTokenPlaceholder: "Using system default token",
        error_apiKeyNotSet: "API Key not set. Please set your key by clicking the 'Settings' button.",
        save: "Save",
        cancel: "Cancel",
        error_generic: "An error occurred.",
        error_cors: "Cannot access image (CORS). Please paste the image file instead of the link.",
    },
    zh: {
        appTitle: "智能翻译",
        navTranslate: "智能翻译",
        // Translate Tool
        translateTitle: "智能批量翻译",
        translateDescription: "粘贴图片(Ctrl+V)、拖放文件，或在下方输入链接/文本。",
        translateButton: "开始翻译",
        inputPlaceholder: "输入文本、图片链接(http://...)，或粘贴图片(Ctrl+V)...",
        uploadButton: "上传图片",
        clearQueue: "清空",
        targetLanguage: "目标:",
        batchLanguagesLabel: "批量翻译语种:",
        batchLanguagesHint: "中文（简体）始终包含",
        batchOnlyChineseLabel: "仅翻译为中文",
        batchOnlyChineseHint: "开启后将忽略其他语种，仅输出中文。",
        batchCleanupModeLabel: "水印清理模式",
        batchCleanupModeHint: "开启后，AI 会在翻译前尝试移除 AI 工具水印（如 \"Made with ChatGPT\" 等）。默认：关闭。",
        batchCleanupModeWarning: "⚠️ 注意：该模式偶尔可能将文案的标题行或结尾误判为推广内容而在翻译中遗漏，翻译完成后请自行检查结果。",
        batchLanguagesSelected: "已选",
        batchLanguagesEmpty: "暂无额外语种",
        batchLanguagesEdit: "设置",
        searchLanguage: "搜索语言...",
        copyAll: "复制全部",
        copyAllSuccess: "已复制!",
        retranslateAll: "重新翻译",
        addEmpty: "添加空条目",
        addEmptyTooltip: "添加一个空白条目，手动输入内容",
        // Items
        item_text_label: "文本",
        item_image_label: "图片",
        status_idle: "等待中",
        status_uploading: "上传中...",
        status_fetching: "获取中...",
        status_ocr: "识别中...",
        status_translating: "翻译中...",
        status_done: "完成",
        status_error: "失败",
        upload_error: "上传失败",
        upload_error_token: "Token错误",
        link_label: "图片链接",
        link_placeholder_text: "--",
        original_text: "原文:",
        translated_text: "译文:",
        copy: "复制",
        copy_link: "复制链接",
        copied: "已复制",
        delete: "删除",
        set_token_btn: "⚠️ 检查 Token",
        // Mode switching
        modeBatch: "批量翻译",
        modeInstant: "即时翻译",
        // Instant translate
        instantTitle: "即时翻译",
        instantInputPlaceholder: "在此输入或粘贴文字/截图，自动翻译...",
        instantOriginal: "原文:",
        instantTranslated: "译文:",
        instantProcessingOCR: "正在识别文字...",
        instantProcessingTranslate: "正在翻译...",
        instantPlaceholder: "翻译结果将显示在这里...",
        instantHint: "点击按钮或按 Ctrl/Cmd+Enter 进行翻译",
        instantTranslateButton: "立即翻译",
        error_ocrFailed: "OCR识别失败",
        error_translationFailed: "翻译失败",
        modelLabel: "模型",
        // General
        apiKeyTitle: "设置",
        apiKeyButtonLabel: "设置 / API Key",
        apiKeyPrompt: "请在下方配置您的API密钥。数据仅存储在您的浏览器本地。",
        apiKeyInputPlaceholder: "Google Gemini API Key",
        gyazoTokenLabel: "Gyazo Access Token (已内置)",
        gyazoTokenPlaceholder: "使用系统默认 Token",
        error_apiKeyNotSet: "未设置API密钥。请点击右上角的\"设置\"按钮进行设置。",
        save: "保存",
        cancel: "取消",
        error_generic: "发生错误。",
        error_cors: "无法访问图片链接(CORS限制)。请直接粘贴图片文件。",
    }
} as const;

type Language = 'en' | 'zh';
type Theme = 'dark' | 'light' | 'eye-care';

const ApiContext = createContext<{
    apiKey: string;
    setApiKey: (key: string) => void;
    gyazoToken: string;
    setGyazoToken: (token: string) => void;
    getAiInstance: () => GoogleGenAI;
    isKeySet: boolean;
    isSettingsOpen: boolean;
    setSettingsOpen: (isOpen: boolean) => void;
    allowApiKeySettings: boolean;
}>({
    apiKey: '',
    setApiKey: () => { },
    gyazoToken: '',
    setGyazoToken: () => { },
    getAiInstance: () => { throw new Error('ApiProvider not found'); },
    isKeySet: false,
    isSettingsOpen: false,
    setSettingsOpen: () => { },
    allowApiKeySettings: false,
});

const LanguageContext = createContext({
    language: 'zh' as Language,
    setLanguage: (lang: Language) => { },
    t: (key: keyof typeof translations.zh, replacements?: { [key: string]: string | number }) => '' as string
});
const ThemeContext = createContext({
    theme: 'dark' as Theme,
    toggleTheme: () => { }
});

interface ApiProviderProps {
    children: React.ReactNode;
    external?: {
        getAiInstance: () => GoogleGenAI;
        gyazoToken?: string;
    };
}

const ApiProvider: React.FC<ApiProviderProps> = ({ children, external }) => {
    const [apiKey, _setApiKey] = useState(() => localStorage.getItem('user_api_key') || '');
    const [gyazoToken, _setGyazoToken] = useState(() => localStorage.getItem('gyazo_access_token') || DEFAULT_GYAZO_TOKEN);
    const [isSettingsOpen, setSettingsOpen] = useState(false);

    const allowApiKeySettings = !external;

    if (external) {
        const value = {
            apiKey: '',
            setApiKey: () => { },
            gyazoToken: external.gyazoToken ?? DEFAULT_GYAZO_TOKEN,
            setGyazoToken: () => { },
            getAiInstance: external.getAiInstance,
            isKeySet: true,
            isSettingsOpen,
            setSettingsOpen,
            allowApiKeySettings,
        };
        return <ApiContext.Provider value={value}>{children}</ApiContext.Provider>;
    }

    const setApiKey = (key: string) => {
        _setApiKey(key);
        if (key) {
            localStorage.setItem('user_api_key', key);
        } else {
            localStorage.removeItem('user_api_key');
        }
    };

    const setGyazoToken = (token: string) => {
        _setGyazoToken(token);
        if (token && token !== DEFAULT_GYAZO_TOKEN) {
            localStorage.setItem('gyazo_access_token', token);
        } else if (!token) {
            // If user clears it, we might want to revert to default or respect empty?
            // For this app, we'll just remove custom token, which effectively reverts to default on reload, 
            // but in state we allow empty if they really want to disable it.
            localStorage.removeItem('gyazo_access_token');
        }
    };

    const getEnvApiKey = () => {
        if (typeof import.meta !== 'undefined' && import.meta.env) {
            return (import.meta.env.VITE_GEMINI_API_KEY as string | undefined) || '';
        }
        return '';
    };

    const getAiInstance = () => {
        const envKey = getEnvApiKey();
        const keyToUse = apiKey || envKey;
        if (!keyToUse) {
            throw new Error('API key is not set.');
        }
        if (keyToUse.startsWith('AIza')) {
            throw new Error('⚠️ 旧版 AI Studio API Key（AIza 开头）已被禁止使用。请联系本国技术员注册最新的 Vertex AI API Key。');
        }
        const cleanKey = keyToUse.trim().replace(/[^\x20-\x7E]/g, '');
        return new GoogleGenAI({ apiKey: cleanKey, vertexai: true });
    };

    const isKeySet = !!(apiKey || getEnvApiKey());

    return (
        <ApiContext.Provider value={{ apiKey, setApiKey, gyazoToken, setGyazoToken, getAiInstance, isKeySet, isSettingsOpen, setSettingsOpen, allowApiKeySettings }}>
            {children}
        </ApiContext.Provider>
    );
};

interface LanguageProviderProps {
    children: React.ReactNode;
    external?: {
        language: Language;
        setLanguage: (lang: Language) => void;
    };
}

const LanguageProvider: React.FC<LanguageProviderProps> = ({ children, external }) => {
    const [internalLanguage, setInternalLanguage] = useState<Language>('zh');
    const language = external?.language ?? internalLanguage;
    const setLanguage = external?.setLanguage ?? setInternalLanguage;

    const t = (key: keyof typeof translations.zh, replacements: { [key: string]: string | number } = {}): string => {
        let translation: string = translations[language][key] || translations['en'][key] || key;
        if (replacements) {
            Object.entries(replacements).forEach(([k, v]) => {
                translation = translation.replace(`{${k}}`, String(v));
            });
        }
        return translation;
    };

    return <LanguageContext.Provider value={{ language, setLanguage, t }}>{children}</LanguageContext.Provider>;
};

interface ThemeProviderProps {
    children: React.ReactNode;
    external?: {
        theme: Theme;
        toggleTheme: () => void;
    };
}

const SMART_TRANSLATE_THEME_CYCLE: Theme[] = ['dark', 'light', 'eye-care'];

const ThemeProvider: React.FC<ThemeProviderProps> = ({ children, external }) => {
    const [internalTheme, setInternalTheme] = useState<Theme>('dark');
    const theme = external?.theme ?? internalTheme;
    const toggleTheme = external?.toggleTheme ?? (() => {
        setInternalTheme(prev => {
            const idx = SMART_TRANSLATE_THEME_CYCLE.indexOf(prev);
            return SMART_TRANSLATE_THEME_CYCLE[(idx + 1) % SMART_TRANSLATE_THEME_CYCLE.length];
        });
    });

    return <ThemeContext.Provider value={{ theme, toggleTheme }}>{children}</ThemeContext.Provider>;
};

const useApi = () => useContext(ApiContext);
const useTranslation = () => useContext(LanguageContext);
const useTheme = () => useContext(ThemeContext);

// --- Helper Functions ---
const fileToBase64 = (file: File): Promise<string> => {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve((reader.result as string).split(',')[1]);
        reader.onerror = (error) => reject(error);
    });
};

const fetchImageAsBase64 = async (url: string): Promise<{ mimeType: string, data: string }> => {
    try {
        const { blob, mimeType } = await fetchImageBlob(url);

        // Handle octet-stream responses (common from Google Drive)
        let finalMime = mimeType;
        if (!finalMime || finalMime === 'application/octet-stream' || !finalMime.startsWith('image/')) {
            // Try to infer from URL extension
            const extMatch = url.match(/\.(jpeg|jpg|gif|png|webp|bmp|tiff|svg)$/i);
            if (extMatch) {
                const ext = extMatch[1].toLowerCase();
                finalMime = ext === 'jpg' ? 'image/jpeg' : `image/${ext}`;
            } else if (blob.type && blob.type.startsWith('image/')) {
                finalMime = blob.type;
            } else {
                finalMime = 'image/png'; // Default fallback
            }
        }

        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onloadend = () => {
                const base64data = (reader.result as string).split(',')[1];
                resolve({ mimeType: finalMime, data: base64data });
            };
            reader.onerror = reject;
            reader.readAsDataURL(blob);
        });
    } catch (error) {
        throw new Error('Failed to fetch image. CORS might be blocking access.');
    }
};

/**
 * Convert various Google Drive URL formats to a direct download URL
 * Supported formats:
 * - https://drive.google.com/file/d/FILE_ID/view
 * - https://drive.google.com/file/d/FILE_ID/view?usp=sharing
 * - https://drive.google.com/open?id=FILE_ID
 * - https://drive.google.com/uc?id=FILE_ID
 * - https://drive.google.com/uc?export=view&id=FILE_ID
 * - https://lh3.googleusercontent.com/d/FILE_ID
 * - https://drive.usercontent.google.com/download?id=FILE_ID
 */
const convertGoogleDriveUrl = (url: string): string | null => {
    // Pattern 1: /file/d/FILE_ID/view or /file/d/FILE_ID/preview
    const filePattern = /drive\.google\.com\/file\/d\/([a-zA-Z0-9_-]+)/;
    const fileMatch = url.match(filePattern);
    if (fileMatch) {
        return `https://drive.google.com/uc?export=download&id=${fileMatch[1]}`;
    }

    // Pattern 2: /open?id=FILE_ID
    const openPattern = /drive\.google\.com\/open\?id=([a-zA-Z0-9_-]+)/;
    const openMatch = url.match(openPattern);
    if (openMatch) {
        return `https://drive.google.com/uc?export=download&id=${openMatch[1]}`;
    }

    // Pattern 3: /uc?id=FILE_ID (already has id param)
    const ucPattern = /drive\.google\.com\/uc\?.*id=([a-zA-Z0-9_-]+)/;
    const ucMatch = url.match(ucPattern);
    if (ucMatch) {
        return `https://drive.google.com/uc?export=download&id=${ucMatch[1]}`;
    }

    // Pattern 4: lh3.googleusercontent.com/d/FILE_ID
    const lh3Pattern = /lh3\.googleusercontent\.com\/d\/([a-zA-Z0-9_-]+)/;
    const lh3Match = url.match(lh3Pattern);
    if (lh3Match) {
        return `https://drive.google.com/uc?export=download&id=${lh3Match[1]}`;
    }

    // Pattern 5: drive.usercontent.google.com/download?id=FILE_ID
    const ucontentPattern = /drive\.usercontent\.google\.com\/download\?.*id=([a-zA-Z0-9_-]+)/;
    const ucontentMatch = url.match(ucontentPattern);
    if (ucontentMatch) {
        return `https://drive.google.com/uc?export=download&id=${ucontentMatch[1]}`;
    }

    // Pattern 6: lh3.googleusercontent.com with other paths (thumbnail URLs)
    try {
        const urlHost = new URL(url).hostname;
        if (urlHost.endsWith('.googleusercontent.com') || urlHost === 'googleusercontent.com') {
            // These URLs are often already direct image URLs
            return url;
        }
    } catch (e) {
        // Invalid URL
    }

    return null;
};

/**
 * Extract URL from Google Sheets IMAGE formula
 * Supported formats:
 * - =IMAGE("https://...")
 * - =IMAGE('https://...')
 */
const extractUrlFromImageFormula = (text: string): string | null => {
    const formulaMatch = text.match(/=IMAGE\s*\(\s*["']([^"']+)["']\s*\)/i);
    if (formulaMatch && formulaMatch[1]) {
        return formulaMatch[1];
    }
    return null;
};

const normalizeUrl = (url: string): string => {
    // 先解码 HTML 实体（如 &amp; -> &）
    const decodedUrl = decodeHtmlEntities(url);
    // First apply Gyazo, Imgur, and other image host conversions
    let processedUrl = processImageUrl(decodedUrl);

    // Then check if it's a Google Drive URL that needs conversion
    const isGoogleDrive = (() => {
        try {
            const h = new URL(processedUrl).hostname;
            return h === 'drive.google.com' || h.endsWith('.googleusercontent.com') || h === 'drive.usercontent.google.com';
        } catch { return false; }
    })();

    if (isGoogleDrive) {
        const convertedUrl = convertGoogleDriveUrl(processedUrl);
        if (convertedUrl) {
            return convertedUrl;
        }
    }

    return processedUrl;
};

const Loader = ({ small }: { small?: boolean }) => <div className={`loader ${small ? 'small' : ''}`}></div>;

// Model options removed - now using global textModel from parent

// --- Types ---
interface TranslateItem {
    id: string;
    type: 'text' | 'image' | 'image-url';
    content: string; // text string or base64 image string or URL
    mimeType?: string;
    sourceUrl?: string; // For image-url type, or uploaded link
    fileName?: string; // For uploaded/pasted images
    originalText?: string; // For images, the OCR result
    translatedText?: string;
    chineseText?: string; // 中文翻译（必须）
    translations?: Record<string, string>; // 多语言翻译结果（不含中文）
    detectedLanguage?: string; // 检测到的原文语言
    status: 'idle' | 'processing_upload' | 'processing_fetch' | 'processing_ocr' | 'processing_translate' | 'success' | 'error';
    uploadStatus?: 'idle' | 'success' | 'error'; // Track upload specifically
    uploadErrorType?: 'token_missing' | 'network' | 'other';
    error?: string;
    fileObj?: File;
}

// allLanguages moved to constants.ts


// --- Components ---

// LanguageSelector moved to LanguageSelector.tsx

const BatchItemCard: React.FC<{
    item: TranslateItem,
    batchTargetLanguages: string[],
    batchOnlyChinese: boolean,
    onDelete: (id: string) => void,
    onUpdate?: (id: string, updates: Partial<TranslateItem>) => void,
    onTranslate?: (id: string) => void
}> = ({ item, batchTargetLanguages, batchOnlyChinese, onDelete, onUpdate, onTranslate }) => {
    const { t } = useTranslation();
    const { setSettingsOpen } = useApi();
    const [copied, setCopied] = useState(false);
    const [linkCopied, setLinkCopied] = useState(false);
    const [isCollapsed, setIsCollapsed] = useState(false);
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);

    const effectiveBatchLanguages = useMemo(
        () => (batchOnlyChinese ? [] : normalizeBatchLanguages(batchTargetLanguages)),
        [batchOnlyChinese, batchTargetLanguages]
    );
    const primaryBatchLanguage = effectiveBatchLanguages[0] || '';
    const hasPrimaryBatchLanguage = Boolean(primaryBatchLanguage);
    const translationEntries = useMemo(() => {
        return effectiveBatchLanguages.map(code => ({
            code,
            label: getLanguageName(code),
            text: item.translations?.[code] ?? (code === primaryBatchLanguage ? (item.translatedText || '') : '')
        }));
    }, [effectiveBatchLanguages, item.translatedText, item.translations, primaryBatchLanguage]);
    const translatedColumnCount = translationEntries.length;
    const contentColumnCount = translatedColumnCount + 2;

    // 拖拽调整高度
    const [cardHeight, setCardHeight] = useState<number | null>(null);
    const [isResizing, setIsResizing] = useState(false);
    const cardRef = useRef<HTMLDivElement>(null);

    // 开始拖拽调整高度
    const startResizeHeight = (e: React.MouseEvent) => {
        e.preventDefault();
        setIsResizing(true);
        const startY = e.clientY;
        const currentHeight = cardRef.current?.offsetHeight || 280;
        const startHeight = cardHeight || currentHeight;

        // 如果是第一次拖拽，先设置当前高度避免跳变
        if (!cardHeight) {
            setCardHeight(currentHeight);
        }

        const onMouseMove = (moveEvent: MouseEvent) => {
            const deltaY = moveEvent.clientY - startY;
            const newHeight = Math.max(150, startHeight + deltaY); // 最小高度 150px
            setCardHeight(newHeight);
        };

        const onMouseUp = () => {
            setIsResizing(false);
            document.removeEventListener('mousemove', onMouseMove);
            document.removeEventListener('mouseup', onMouseUp);
            document.body.style.cursor = '';
            document.body.style.userSelect = '';
        };

        document.addEventListener('mousemove', onMouseMove);
        document.addEventListener('mouseup', onMouseUp);
        document.body.style.cursor = 'row-resize';
        document.body.style.userSelect = 'none';
    };

    const [showCopyMenu, setShowCopyMenu] = useState(false);

    // 转义 TSV 格式
    const escapeForSheet = (str: string) => {
        if (!str) return '';
        if (/[\n\t"]/.test(str)) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const handleCopy = (text: string) => {
        navigator.clipboard.writeText(text).then(() => {
            setCopied(true);
            setShowCopyMenu(false);
            setTimeout(() => setCopied(false), 2000);
        });
    };

    // 获取原文内容
    const getOriginalText = () => item.originalText || (item.type === 'text' ? item.content : '') || '';

    // 复制原文（单列）
    const copyOriginal = () => handleCopy(escapeForSheet(getOriginalText()));

    const getTranslationByLang = (code: string) => {
        if (!code) return '';
        if (item.translations && item.translations[code]) return item.translations[code];
        if (code === primaryBatchLanguage) return item.translatedText || '';
        return '';
    };

    // 复制目标语言结果（单列 - 主语言）
    const copyTranslated = () => {
        const text = hasPrimaryBatchLanguage
            ? getTranslationByLang(primaryBatchLanguage)
            : (item.chineseText || '');
        handleCopy(escapeForSheet(text));
    };

    // 复制目标语言结果+中文结果（两列，Tab 分隔）
    const copyTranslatedAndChinese = () => {
        if (!hasPrimaryBatchLanguage) {
            handleCopy(escapeForSheet(item.chineseText || ''));
            return;
        }
        const text = `${escapeForSheet(getTranslationByLang(primaryBatchLanguage))}\t${escapeForSheet(item.chineseText || '')}`;
        handleCopy(text);
    };

    // 复制所有语种译文+中文（多列，Tab 分隔）
    const copyAllLanguages = () => {
        const translatedColumns = effectiveBatchLanguages.map(code => escapeForSheet(getTranslationByLang(code))).join('\t');
        const text = `${translatedColumns}\t${escapeForSheet(item.chineseText || '')}`;
        handleCopy(text);
    };

    // 复制全部（原文+所有译文+中文，Tab 分隔）
    const copyAll = () => {
        const translatedColumns = effectiveBatchLanguages.map(code => escapeForSheet(getTranslationByLang(code)));
        const parts = [escapeForSheet(getOriginalText())];
        if (translatedColumns.length > 0) {
            parts.push(...translatedColumns);
        }
        parts.push(escapeForSheet(item.chineseText || ''));
        const text = parts.join('\t');
        handleCopy(text);
    };

    const handleCopyLink = (link: string) => {
        navigator.clipboard.writeText(link).then(() => {
            setLinkCopied(true);
            setTimeout(() => setLinkCopied(false), 2000);
        });
    };

    const getStatusLabel = () => {
        switch (item.status) {
            case 'processing_upload': return t('status_uploading');
            case 'processing_fetch': return t('status_fetching');
            case 'processing_ocr': return t('status_ocr');
            case 'processing_translate': return t('status_translating');
            case 'success': return t('status_done');
            case 'error': return t('status_error');
            default: return t('status_idle');
        }
    };

    // 处理原文输入变化，带防抖即时翻译
    const handleInputChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
        const newValue = e.target.value;

        // 更新内容
        if (onUpdate) {
            // 对于图片类型，只更新 originalText，不覆盖 content（content 存储的是图片数据）
            if (item.type === 'image' || item.type === 'image-url') {
                onUpdate(item.id, {
                    originalText: newValue
                });
            } else {
                // 对于纯文本类型，同时更新 content 和 originalText
                onUpdate(item.id, {
                    content: newValue,
                    originalText: newValue
                });
            }
        }

        // 防抖翻译：只在 idle 状态下，停止输入 800ms 后自动翻译
        // 翻译过程中或完成后，只更新文本，不自动触发翻译
        if (onTranslate && newValue.trim() && item.status === 'idle') {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
            debounceTimerRef.current = setTimeout(() => {
                onTranslate(item.id);
            }, 800);
        }
    };

    // 清理定时器
    useEffect(() => {
        return () => {
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, []);

    // Gyazo 图片格式自动检测（缩略图用）
    const [gyazoExtIndex, setGyazoExtIndex] = useState(0);
    const gyazoExtensions = ['jpg', 'png', 'gif'];

    const getGyazoThumbnailUrl = (gyazoId: string): string => {
        const ext = gyazoExtensions[gyazoExtIndex] || 'jpg';
        const directUrl = `i.gyazo.com/${gyazoId}.${ext}`;
        return `https://images.weserv.nl/?url=${encodeURIComponent(directUrl)}&w=200&h=200&fit=cover&output=jpg&q=80`;
    };

    const handleGyazoImgError = () => {
        if (gyazoExtIndex < gyazoExtensions.length - 1) {
            setGyazoExtIndex(prev => prev + 1);
        }
    };

    const renderVisual = () => {
        if (item.type === 'image') {
            return <img src={`data:${item.mimeType};base64,${item.content}`} alt="Original" />;
        } else if (item.type === 'image-url') {
            let displayUrl = item.sourceUrl || '';

            // 检测是否是 Gyazo 链接
            const gyazoMatch = displayUrl.match(/https:\/\/i\.gyazo\.com\/([a-f0-9]+)\.(png|jpg|gif)/i);
            if (gyazoMatch) {
                const gyazoId = gyazoMatch[1];
                displayUrl = getGyazoThumbnailUrl(gyazoId);
                return <img src={displayUrl} alt="Gyazo" referrerPolicy="no-referrer" onError={handleGyazoImgError} />;
            }

            // 检测是否需要代理的链接（Facebook CDN、Google 图片、Google Drive 等）
            const needsProxy = (() => {
                try {
                    const h = new URL(displayUrl).hostname;
                    return h.endsWith('.fbcdn.net') ||
                        h.startsWith('scontent') ||
                        h.endsWith('.googleusercontent.com') ||
                        h === 'drive.google.com' ||
                        h === 'drive.usercontent.google.com' ||
                        h.match(/^lh[3-6]\.google/) !== null ||
                        h.endsWith('.ggpht.com');
                } catch { return false; }
            })();

            if (needsProxy) {
                const urlNoProtocol = displayUrl.replace(/^https?:\/\//, '');
                displayUrl = `https://images.weserv.nl/?url=${encodeURIComponent(urlNoProtocol)}&w=200&h=200&fit=cover&output=jpg&q=80`;
            }

            return <img src={displayUrl} alt="Remote" referrerPolicy="no-referrer" />;
        } else {
            return <div className="text-icon">T</div>;
        }
    };

    // 获取摘要文本
    const getSummary = () => {
        // 对于图片类型，只用 originalText（OCR 结果），不用 content（base64 数据）
        const original = item.type === 'text'
            ? (item.originalText || item.content || '')
            : (item.originalText || '');
        const translated = hasPrimaryBatchLanguage
            ? ((item.translations?.[primaryBatchLanguage] ?? item.translatedText) || '')
            : (item.chineseText || '');
        const originalPreview = original.length > 50 ? original.substring(0, 50) + '...' : original;
        const translatedPreview = translated.length > 50 ? translated.substring(0, 50) + '...' : translated;
        return { originalPreview, translatedPreview };
    };

    const { originalPreview, translatedPreview } = getSummary();

    // 收起状态的紧凑视图
    if (isCollapsed) {
        return (
            <div className={`batch-item collapsed ${item.status}`}>
                {/* 右上角固定按钮区域 */}
                <div className="item-actions">
                    <button
                        className="toggle-btn tooltip-bottom"
                        onClick={() => setIsCollapsed(false)}
                        data-tip="展开"
                    >
                        ▼
                    </button>
                    <button className="delete-btn" onClick={() => onDelete(item.id)} title={t('delete')}>×</button>
                </div>
                <div className="collapsed-content tooltip-bottom" onClick={() => setIsCollapsed(false)} data-tip="点击展开">
                    <div className="collapsed-visual">
                        {renderVisual()}
                    </div>
                    <div className="collapsed-info">
                        <div className="collapsed-original">
                            <span className="collapsed-label">原:</span>
                            <span className="collapsed-text">{originalPreview || '(空)'}</span>
                        </div>
                        <div className="collapsed-translated">
                            <span className="collapsed-label">译:</span>
                            <span className="collapsed-text">{translatedPreview || '...'}</span>
                        </div>
                    </div>
                    <div className={`status-badge ${item.status}`}>{getStatusLabel()}</div>
                </div>
            </div>
        );
    }

    // 展开状态的完整视图
    return (
        <div
            ref={cardRef}
            className={`batch-item expanded ${item.status} ${isResizing ? 'resizing' : ''}`}
            style={cardHeight ? { height: `${cardHeight}px` } : undefined}
        >
            {/* 右上角固定按钮区域 */}
            <div className="item-actions">
                {/* 复制菜单 */}
                <div className="copy-menu-container">
                    <button
                        className={`copy-menu-btn ${copied ? 'copied' : ''} tooltip-bottom`}
                        onClick={() => setShowCopyMenu(!showCopyMenu)}
                        data-tip="复制"
                    >
                        {copied ? <Check size={14} /> : <Copy size={14} />}
                    </button>
                    {showCopyMenu && (
                        <div className="copy-dropdown-menu" onMouseLeave={() => setShowCopyMenu(false)}>
                            <button onClick={copyOriginal} disabled={!getOriginalText()}>
                                <FileText size={14} /> 复制原文
                            </button>
                            <button
                                onClick={copyTranslated}
                                disabled={hasPrimaryBatchLanguage ? !getTranslationByLang(primaryBatchLanguage) : !item.chineseText}
                            >
                                <Globe size={14} /> 复制译文
                            </button>
                            <button onClick={copyAllLanguages} disabled={effectiveBatchLanguages.length === 0}>
                                <Languages size={14} /> 复制所有语种
                            </button>
                            <button
                                onClick={copyTranslatedAndChinese}
                                disabled={hasPrimaryBatchLanguage
                                    ? (!getTranslationByLang(primaryBatchLanguage) && !item.chineseText)
                                    : !item.chineseText}
                            >
                                <RefreshCw size={14} /> 复制译文+中文
                            </button>
                            <button
                                onClick={copyAll}
                                disabled={!getOriginalText() && !(hasPrimaryBatchLanguage ? getTranslationByLang(primaryBatchLanguage) : item.chineseText)}
                            >
                                <Copy size={14} /> 复制全部
                            </button>
                        </div>
                    )}
                </div>
                <button
                    className="toggle-btn tooltip-bottom"
                    onClick={() => setIsCollapsed(true)}
                    data-tip="收起"
                >
                    ▲
                </button>
                <button className="delete-btn" onClick={() => onDelete(item.id)} title={t('delete')}>×</button>
            </div>

            <div className="batch-item-visual">
                {renderVisual()}
                {item.fileName && <div className="identifier-text file" title={item.fileName}>📄 {item.fileName}</div>}
                <div className={`status-badge ${item.status}`}>{getStatusLabel()}</div>
                {/* 图片下方的链接按钮 */}
                {item.sourceUrl && (
                    <button
                        className={`link-btn ${linkCopied ? 'copied' : ''}`}
                        onClick={() => handleCopyLink(item.sourceUrl!)}
                        title={item.sourceUrl}
                    >
                        🔗 {linkCopied ? '已复制' : '复制链接'}
                    </button>
                )}
                {item.uploadStatus === 'error' && (
                    <div className="upload-error-mini">
                        <span className="error-text">
                            {item.uploadErrorType === 'token_missing' ? '❌ Token' : '❌ 上传失败'}
                        </span>
                        {item.uploadErrorType === 'token_missing' && (
                            <button className="set-token-btn-mini" onClick={() => setSettingsOpen(true)}>
                                设置
                            </button>
                        )}
                    </div>
                )}
            </div>

            <div
                className="batch-item-content multi-columns"
                style={{ gridTemplateColumns: `repeat(${contentColumnCount}, minmax(220px, 1fr))` }}
            >
                <div className="content-block original">
                    <div className="block-header">
                        {t('original_text')}
                        {/* 显示检测到的原文语言 */}
                        {item.detectedLanguage && (
                            <span className="detected-language-tag">({item.detectedLanguage})</span>
                        )}
                        {/* 单条翻译按钮 */}
                        {onTranslate && (item.originalText || item.content) && !item.status.startsWith('processing') && (
                            <button
                                className="mini-translate-btn tooltip-bottom"
                                onClick={() => onTranslate(item.id)}
                                data-tip="翻译此条目"
                            >
                                {item.status === 'success' ? '🔄' : '▶️'} 翻译
                            </button>
                        )}
                    </div>
                    <div className="block-body">
                        {/* 所有状态的条目都可以编辑原文 */}
                        {onUpdate ? (
                            <textarea
                                className="editable-original-textarea"
                                placeholder={item.type === 'text' ? "输入要翻译的文本..." : "OCR 识别后可在此编辑..."}
                                value={item.originalText || (item.type === 'text' ? item.content : '') || ''}
                                onChange={handleInputChange}
                                style={{
                                    width: '100%',
                                    minHeight: '80px',
                                    height: '100%',
                                    border: 'none',
                                    background: 'transparent',
                                    resize: 'none',
                                    outline: 'none',
                                    fontSize: '0.95rem',
                                    color: 'inherit',
                                    fontFamily: 'inherit',
                                    lineHeight: '1.5'
                                }}
                            />
                        ) : (
                            item.originalText || (item.type === 'text' ? item.content : '') || <span className="placeholder">...</span>
                        )}
                    </div>
                </div>

                {translationEntries.map(entry => (
                    <div key={entry.code} className="content-block translated">
                        <div className="block-header">
                            {t('translated_text')} · {entry.label}
                        </div>
                        <div className="block-body">
                            {item.status.startsWith('processing') && item.status !== 'processing_upload' ? (
                                <Loader small />
                            ) : item.error ? (
                                <span className="error-text">{item.error}</span>
                            ) : (
                                entry.text || <span className="placeholder">...</span>
                            )}
                        </div>
                    </div>
                ))}

                <div className="content-block chinese">
                    <div className="block-header">
                        中文
                    </div>
                    <div className="block-body">
                        {item.status.startsWith('processing') && item.status !== 'processing_upload' ? (
                            <Loader small />
                        ) : (
                            item.chineseText || <span className="placeholder">...</span>
                        )}
                    </div>
                </div>
            </div>

            {/* 底部调整大小手柄 */}
            <div
                className="resize-handle-bottom tooltip-bottom"
                onMouseDown={startResizeHeight}
                data-tip="拖拽调整高度"
            >
                <div className="resize-handle-indicator" />
            </div>
        </div>
    );
};

export type SmartTranslateState = {
    mode: 'batch' | 'instant';
    items: TranslateItem[];
    inputText: string;
    targetLanguage: string;
    batchTargetLanguages?: string[];
    batchOnlyChinese?: boolean;
    batchCleanupMode?: boolean;
    customInstruction?: string;
    isProcessing: boolean;
};

export const initialSmartTranslateState: SmartTranslateState = {
    mode: 'instant',
    items: [],
    inputText: '',
    targetLanguage: (() => { try { return localStorage.getItem('smart_translate_target_lang') || 'smart_auto'; } catch { return 'smart_auto'; } })(),
    batchTargetLanguages: loadBatchLanguages(),
    batchOnlyChinese: loadBatchOnlyChinese(),
    batchCleanupMode: loadBatchCleanupMode(),
    customInstruction: loadCustomInstruction(),
    isProcessing: false,
};

interface TranslateToolProps {
    textModel: string;
    imageModel: string;
    state?: SmartTranslateState;
    setState?: React.Dispatch<React.SetStateAction<SmartTranslateState>>;
    batchTargetLanguages: string[];
    setBatchTargetLanguages: (val: string[] | ((prev: string[]) => string[])) => void;
    batchOnlyChinese: boolean;
    setBatchOnlyChinese: (val: boolean | ((prev: boolean) => boolean)) => void;
    batchCleanupMode: boolean;
    setBatchCleanupMode: (val: boolean | ((prev: boolean) => boolean)) => void;
    customInstruction: string;
    setCustomInstruction: (val: string) => void;
}

const useBatchLanguageState = (
    state?: SmartTranslateState,
    setState?: React.Dispatch<React.SetStateAction<SmartTranslateState>>
) => {
    const [localBatchLanguages, setLocalBatchLanguages] = useState<string[]>(() => loadBatchLanguages());
    const [localBatchOnlyChinese, setLocalBatchOnlyChinese] = useState<boolean>(() => loadBatchOnlyChinese());
    const [localBatchCleanupMode, setLocalBatchCleanupMode] = useState<boolean>(() => loadBatchCleanupMode());
    const [localCustomInstruction, setLocalCustomInstruction] = useState<string>(() => loadCustomInstruction());

    const batchOnlyChinese = useMemo(() => {
        if (typeof state?.batchOnlyChinese === 'boolean') {
            return state.batchOnlyChinese;
        }
        return localBatchOnlyChinese;
    }, [state?.batchOnlyChinese, localBatchOnlyChinese]);

    const batchCleanupMode = useMemo(() => {
        if (typeof state?.batchCleanupMode === 'boolean') {
            return state.batchCleanupMode;
        }
        return localBatchCleanupMode;
    }, [state?.batchCleanupMode, localBatchCleanupMode]);

    const customInstruction = useMemo(() => {
        if (typeof state?.customInstruction === 'string') {
            return state.customInstruction;
        }
        return localCustomInstruction;
    }, [state?.customInstruction, localCustomInstruction]);

    const batchTargetLanguages = useMemo(() => {
        if (state?.batchTargetLanguages && state.batchTargetLanguages.length > 0) {
            return normalizeBatchLanguages(state.batchTargetLanguages);
        }
        return localBatchLanguages;
    }, [state?.batchTargetLanguages, localBatchLanguages]);

    useEffect(() => {
        if (state?.batchTargetLanguages && state.batchTargetLanguages.length > 0) {
            const normalized = normalizeBatchLanguages(state.batchTargetLanguages);
            setLocalBatchLanguages(normalized);
            if (typeof localStorage !== 'undefined') {
                localStorage.setItem(BATCH_LANG_STORAGE_KEY, JSON.stringify(normalized));
            }
        }
    }, [state?.batchTargetLanguages]);

    useEffect(() => {
        if (typeof state?.batchOnlyChinese !== 'boolean') return;
        setLocalBatchOnlyChinese(state.batchOnlyChinese);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(BATCH_ONLY_CHINESE_KEY, JSON.stringify(state.batchOnlyChinese));
        }
    }, [state?.batchOnlyChinese]);

    useEffect(() => {
        if (typeof state?.batchCleanupMode !== 'boolean') return;
        setLocalBatchCleanupMode(state.batchCleanupMode);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(BATCH_CLEANUP_MODE_KEY, JSON.stringify(state.batchCleanupMode));
        }
    }, [state?.batchCleanupMode]);

    useEffect(() => {
        if (typeof state?.customInstruction !== 'string') return;
        setLocalCustomInstruction(state.customInstruction);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(CUSTOM_INSTRUCTION_KEY, state.customInstruction);
        }
    }, [state?.customInstruction]);

    const setBatchTargetLanguages = useCallback((val: string[] | ((prev: string[]) => string[])) => {
        const prevLangs = batchOnlyChinese ? localBatchLanguages : batchTargetLanguages;
        const nextRaw = typeof val === 'function' ? val(prevLangs) : val;
        const normalized = normalizeBatchLanguages(nextRaw);
        if (setState) {
            setState(prev => ({ ...prev, batchTargetLanguages: normalized }));
        }
        setLocalBatchLanguages(normalized);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(BATCH_LANG_STORAGE_KEY, JSON.stringify(normalized));
        }
    }, [batchOnlyChinese, batchTargetLanguages, localBatchLanguages, setState]);

    const setBatchOnlyChinese = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
        const next = typeof val === 'function' ? val(batchOnlyChinese) : val;
        if (setState) {
            setState(prev => ({ ...prev, batchOnlyChinese: next }));
        }
        setLocalBatchOnlyChinese(next);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(BATCH_ONLY_CHINESE_KEY, JSON.stringify(next));
        }
    }, [batchOnlyChinese, setState]);

    const setBatchCleanupMode = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
        const next = typeof val === 'function' ? val(batchCleanupMode) : val;
        if (setState) {
            setState(prev => ({ ...prev, batchCleanupMode: next }));
        }
        setLocalBatchCleanupMode(next);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(BATCH_CLEANUP_MODE_KEY, JSON.stringify(next));
        }
    }, [batchCleanupMode, setState]);

    const setCustomInstruction = useCallback((val: string) => {
        if (setState) {
            setState(prev => ({ ...prev, customInstruction: val }));
        }
        setLocalCustomInstruction(val);
        if (typeof localStorage !== 'undefined') {
            localStorage.setItem(CUSTOM_INSTRUCTION_KEY, val);
        }
    }, [setState]);

    return { batchTargetLanguages, setBatchTargetLanguages, batchOnlyChinese, setBatchOnlyChinese, batchCleanupMode, setBatchCleanupMode, customInstruction, setCustomInstruction };
};

const TranslateTool = ({
    textModel,
    imageModel,
    state,
    setState,
    batchTargetLanguages,
    setBatchTargetLanguages,
    batchOnlyChinese,
    setBatchOnlyChinese,
    batchCleanupMode,
    setBatchCleanupMode,
    customInstruction,
    setCustomInstruction
}: TranslateToolProps) => {
    const { t } = useTranslation();
    const { getAiInstance, gyazoToken, setSettingsOpen } = useApi();

    // Local state fallbacks
    const [localMode, setLocalMode] = useState<'batch' | 'instant'>('instant');
    const [localItems, setLocalItems] = useState<TranslateItem[]>([]);
    const [localInputText, setLocalInputText] = useState("");
    const [localTargetLanguage, setLocalTargetLanguage] = useState(() => {
        try { return localStorage.getItem('smart_translate_target_lang') || 'smart_auto'; } catch { return 'smart_auto'; }
    });
    const [localIsProcessing, setLocalIsProcessing] = useState(false);
    const [showHistoryPanel, setShowHistoryPanel] = useState(false); // 兼容式保留
    const [showProjectPanel, setShowProjectPanel] = useState(false);
    const [currentProject, setCurrentProject] = useState<Project | null>(null);
    const projectInitializedRef = useRef(false);
    const lastSavedStateRef = useRef<string>('');
    const isCreatingProjectRef = useRef(false); // 防止重复创建项目的竞态条件
    const { user } = useAuth();

    const mode = state?.mode ?? localMode;
    const items = state?.items ?? localItems;
    const inputText = state?.inputText ?? localInputText;
    const targetLanguage = state?.targetLanguage ?? localTargetLanguage;
    const isProcessing = state?.isProcessing ?? localIsProcessing;

    const effectiveBatchLanguages = useMemo(
        () => (batchOnlyChinese ? [] : normalizeBatchLanguages(batchTargetLanguages)),
        [batchOnlyChinese, batchTargetLanguages]
    );
    const primaryBatchLanguage = effectiveBatchLanguages[0] || '';
    const hasExtraLanguages = effectiveBatchLanguages.length > 0;
    const batchLanguageLabels = useMemo(() => {
        return effectiveBatchLanguages.map(code => getLanguageName(code));
    }, [effectiveBatchLanguages]);
    const batchLanguageSummary = useMemo(() => {
        const chineseLabel = getLanguageName('zh');
        return [chineseLabel, ...batchLanguageLabels].filter(Boolean).join(' / ');
    }, [batchLanguageLabels]);

    const setMode = useCallback((val: 'batch' | 'instant' | ((prev: 'batch' | 'instant') => 'batch' | 'instant')) => {
        if (setState) {
            setState(prev => ({ ...prev, mode: typeof val === 'function' ? val(prev.mode) : val }));
        } else {
            setLocalMode(val);
        }
    }, [setState]);

    const setItems = useCallback((val: TranslateItem[] | ((prev: TranslateItem[]) => TranslateItem[])) => {
        if (setState) {
            setState(prev => ({ ...prev, items: typeof val === 'function' ? val(prev.items) : val }));
        } else {
            setLocalItems(val);
        }
    }, [setState]);

    const setInputText = useCallback((val: string | ((prev: string) => string)) => {
        if (setState) {
            setState(prev => ({ ...prev, inputText: typeof val === 'function' ? val(prev.inputText) : val }));
        } else {
            setLocalInputText(val);
        }
    }, [setState]);

    const setTargetLanguage = useCallback((val: string | ((prev: string) => string)) => {
        const resolve = (prev: string) => typeof val === 'function' ? val(prev) : val;
        if (setState) {
            setState(prev => {
                const next = resolve(prev.targetLanguage);
                try { localStorage.setItem('smart_translate_target_lang', next); } catch { }
                return { ...prev, targetLanguage: next };
            });
        } else {
            setLocalTargetLanguage(prev => {
                const next = resolve(prev);
                try { localStorage.setItem('smart_translate_target_lang', next); } catch { }
                return next;
            });
        }
    }, [setState]);

    const setIsProcessing = useCallback((val: boolean | ((prev: boolean) => boolean)) => {
        if (setState) {
            setState(prev => ({ ...prev, isProcessing: typeof val === 'function' ? val(prev.isProcessing) : val }));
        } else {
            setLocalIsProcessing(val);
        }
    }, [setState]);

    const [copyAllStatus, setCopyAllStatus] = useState(false);
    const [showBatchCopyMenu, setShowBatchCopyMenu] = useState(false);
    const [isInputCollapsed, setIsInputCollapsed] = useState(false);
    const [showInlineInstruction, setShowInlineInstruction] = useState(() => !!customInstruction?.trim());

    // 保存到表格状态
    const [sheetSaveStatus, setSheetSaveStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
    const [sheetSaveError, setSheetSaveError] = useState<string>('');

    const handleSaveToSheet = async () => {
        const successItems = items.filter(i => i.status === 'success');
        if (successItems.length === 0) {
            alert('没有可保存的翻译结果');
            return;
        }

        const config = getSheetsSyncConfig();
        if (!config.webAppUrl || !config.submitter) {
            alert('请先在设置中配置表格同步');
            return;
        }

        setSheetSaveStatus('saving');
        setSheetSaveError('');

        try {
            const time = new Date().toLocaleString('zh-CN');
            const rows = successItems.map(item => [
                time,
                effectiveBatchLanguages.join(', '),
                item.originalText || '',
                item.translatedText || item.chineseText || ''
            ]);

            const result = await appendToSheet('translate', rows);

            if (result.success) {
                setSheetSaveStatus('success');
                setTimeout(() => setSheetSaveStatus('idle'), 3000);
            } else {
                setSheetSaveStatus('error');
                setSheetSaveError(result.error || '保存失败');
            }
        } catch (e) {
            setSheetSaveStatus('error');
            setSheetSaveError(e instanceof Error ? e.message : '保存失败');
        }
    };

    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropZoneRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    // 批次大小（用户可自定义，localStorage 持久化）
    const BATCH_SIZE_KEY = 'smart_translate_batch_size';
    const [batchSize, setBatchSize] = useState(() => {
        try { const v = localStorage.getItem(BATCH_SIZE_KEY); return v ? Math.max(1, Math.min(20, parseInt(v))) : 10; } catch { return 10; }
    });
    const handleBatchSizeChange = (val: number) => {
        const clamped = Math.max(1, Math.min(20, val));
        setBatchSize(clamped);
        try { localStorage.setItem(BATCH_SIZE_KEY, String(clamped)); } catch { }
    };
    const processingIdsRef = useRef<Set<string>>(new Set());
    const activeWorkersRef = useRef(0);

    // 自动保存状态到项目（仅批量模式）
    // 即时模式在 InstantTranslateTool 组件中单独处理
    useEffect(() => {
        // 仅批量模式保存
        if (mode !== 'batch') return;
        if (!user?.uid || items.length === 0) return;

        // 初始化项目（如果没有）
        if (!currentProject && !projectInitializedRef.current) {
            projectInitializedRef.current = true;
            const tempProject: Project = {
                id: `temp_${Date.now()}`,
                moduleId: 'smart-translate',
                name: '新建翻译项目',
                createdAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
                updatedAt: { seconds: Date.now() / 1000, nanoseconds: 0 } as any,
                isActive: true,
                isStarred: false,
                isPinned: false,
                tags: [],
                preview: '',
                itemCount: 0,
                currentState: {},
                versionCount: 0
            };
            setCurrentProject(tempProject);
            return;
        }

        if (!currentProject?.id) return;

        // 只保存成功的翻译
        const completedItems = items.filter(item => item.status === 'success');
        if (completedItems.length === 0) return;

        // 序列化状态用于比较
        const stateSnapshot = JSON.stringify({
            items: completedItems.map(item => ({
                id: item.id,
                type: item.type,
                originalText: item.originalText,
                translatedText: item.translatedText,
                translations: item.translations,
                detectedLanguage: item.detectedLanguage,
                sourceUrl: item.sourceUrl
            })),
            targetLanguage,
            batchTargetLanguages: effectiveBatchLanguages,
            batchOnlyChinese
        });

        if (stateSnapshot === lastSavedStateRef.current) return;
        lastSavedStateRef.current = stateSnapshot;

        // 保存到项目
        const saveToProject = async () => {
            let projectId = currentProject.id;

            // 临时项目需要先创建
            if (projectId.startsWith('temp_')) {
                // 防止重复创建项目的竞态条件
                if (isCreatingProjectRef.current) {
                    return;
                }

                isCreatingProjectRef.current = true;
                try {
                    const firstItem = completedItems[0];
                    const projectName = (firstItem.originalText || firstItem.translatedText || '').slice(0, 30) || '翻译项目';
                    projectId = await createProject(user.uid, {
                        moduleId: 'smart-translate',
                        name: projectName
                    });
                    setCurrentProject(prev => prev ? { ...prev, id: projectId, name: projectName } : null);
                } catch (error) {
                    console.error('[Project] Failed to create project:', error);
                    isCreatingProjectRef.current = false;
                    return;
                }
                isCreatingProjectRef.current = false;
            }

            // 清理保存的数据
            const cleanedItems = completedItems.map(item => ({
                id: item.id,
                type: item.type,
                originalText: item.originalText,
                translatedText: item.translatedText,
                chineseText: item.chineseText,
                translations: item.translations,
                detectedLanguage: item.detectedLanguage,
                sourceUrl: item.sourceUrl,
                status: item.status
            }));

            const stateToSave = {
                items: cleanedItems,
                targetLanguage,
                batchTargetLanguages: effectiveBatchLanguages,
                batchOnlyChinese,
                mode
            };

            const previewText = completedItems[0]?.translatedText?.slice(0, 100) || '';

            debouncedSaveProject(user.uid, 'smart-translate', projectId, stateToSave, {
                preview: previewText,
                itemCount: completedItems.length
            });
        };

        saveToProject();
    }, [user?.uid, items, targetLanguage, effectiveBatchLanguages, batchOnlyChinese, batchCleanupMode, customInstruction, currentProject, mode]);


    // Helper to detect URL
    const isUrl = (text: string) => {
        // Strict URL check: http/https start, no whitespace allowed in the whole string
        return /^https?:\/\/[^\s]+$/.test(text.trim());
    };

    const uploadImage = async (file: File): Promise<string | null> => {
        // Use the context token, which defaults to the hardcoded one
        const tokenToUse = gyazoToken || DEFAULT_GYAZO_TOKEN;

        if (!tokenToUse) {
            throw new Error("TOKEN_MISSING");
        }

        const formData = new FormData();
        formData.append('access_token', tokenToUse);
        formData.append('imagedata', file);

        try {
            const res = await fetch('https://upload.gyazo.com/api/upload', {
                method: 'POST',
                body: formData
            });

            if (!res.ok) {
                throw new Error(`Gyazo Upload failed: ${res.status} ${res.statusText}`);
            }

            const json = await res.json();
            return json.url || json.permalink_url || null;
        } catch (error) {
            console.error("Upload error:", error);
            throw error;
        }
    };

    // Add items (text or images)
    const addItems = async (newFiles: File[]) => {
        // Pre-calculate base64 to display UI immediately
        const newItemsWithData = await Promise.all(newFiles.map(async (file) => {
            const base64 = await fileToBase64(file);
            let fileName = file.name;
            if (fileName === 'image.png' || !fileName) {
                const date = new Date().toISOString().replace(/[:.]/g, '-');
                fileName = `Screenshot_${date}.png`;
            }

            // Start uploading immediately
            const status: TranslateItem['status'] = 'processing_upload';

            return {
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                type: 'image' as const,
                content: base64,
                mimeType: file.type,
                fileName: fileName,
                status: status,
                uploadStatus: 'idle' as const,
                fileObj: file // Temp store file for upload logic
            };
        }));

        // Add to state
        setItems(prev => [...prev, ...newItemsWithData.map(({ fileObj, ...item }) => item)]);

        // Trigger uploads
        newItemsWithData.forEach(async (itemData) => {
            let url: string | null = null;
            let uploadStatus: TranslateItem['uploadStatus'] = 'error';
            let uploadErrorType: TranslateItem['uploadErrorType'] = 'other';

            try {
                url = await uploadImage(itemData.fileObj);
                uploadStatus = 'success';
            } catch (e: any) {
                uploadStatus = 'error';
                if (e.message === "TOKEN_MISSING") {
                    uploadErrorType = 'token_missing';
                } else {
                    uploadErrorType = 'network';
                }
            }

            setItems(prev => prev.map(i => {
                if (i.id === itemData.id) {
                    return {
                        ...i,
                        status: 'idle', // Ready for OCR, upload finished (or failed, still ready for local OCR)
                        sourceUrl: url || undefined, // Set URL if upload success
                        uploadStatus: uploadStatus,
                        uploadErrorType: uploadErrorType
                    };
                }
                return i;
            }));
        });
    };

    const createTextOrUrlItem = (text: string): TranslateItem => {
        const trimmed = text.trim();

        // 1. Check if it's a Google Sheets IMAGE formula
        const formulaUrl = extractUrlFromImageFormula(trimmed);
        if (formulaUrl) {
            const directUrl = normalizeUrl(formulaUrl);
            return {
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                type: 'image-url',
                content: '',
                sourceUrl: directUrl,
                status: 'idle'
            };
        }

        // 2. Check if it's a direct URL (including Google Drive URLs)
        if (isUrl(trimmed)) {
            const directUrl = normalizeUrl(trimmed);
            return {
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                type: 'image-url',
                content: '',
                sourceUrl: directUrl,
                status: 'idle'
            };
        }

        // 3. Otherwise treat as text
        return {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            type: 'text',
            content: trimmed,
            originalText: trimmed,
            status: 'idle'
        };
    };

    const parseInputAndAddItems = () => {
        if (!inputText.trim()) return;

        const lines = inputText.split(/\n+/);
        const newItems: TranslateItem[] = [];

        lines.forEach(line => {
            if (!line.trim()) return;
            newItems.push(createTextOrUrlItem(line));
        });

        setItems(prev => [...prev, ...newItems]);
        setInputText("");
    };

    // Add empty item for manual input
    const addEmptyItem = () => {
        const emptyItem: TranslateItem = {
            id: Date.now() + Math.random().toString(36).substr(2, 9),
            type: 'text',
            content: '',
            originalText: '',
            status: 'idle'
        };
        setItems(prev => [...prev, emptyItem]);
    };

    // Processing Logic
    const processQueue = async () => {
        parseInputAndAddItems();
        // Allow state to settle
        await new Promise(r => setTimeout(r, 50));
        setIsProcessing(true);
    };

    useEffect(() => {
        if (!isProcessing) return;
        // 防止重复调度
        if (activeWorkersRef.current > 0) return;

        const ai = getAiInstance();
        const isChineseOnly = effectiveBatchLanguages.length === 0;
        const targetLangSpecs = effectiveBatchLanguages
            .map(code => `${getLanguageName(code)} (${code})`)
            .join(', ');

        const updateItemById = (id: string, updates: Partial<TranslateItem>) => {
            setItems(prev => prev.map(i => i.id === id ? { ...i, ...updates } : i));
        };

        // OCR 单张图片（含 429 自动重试）

        const ocrImage = async (item: TranslateItem): Promise<string> => {
            let base64Data = item.content;
            let mimeType = item.mimeType;

            if (item.type === 'image-url') {
                updateItemById(item.id, { status: 'processing_fetch' });
                const fetched = await fetchImageAsBase64(item.sourceUrl!);
                base64Data = fetched.data;
                mimeType = fetched.mimeType;
                updateItemById(item.id, { content: base64Data, mimeType });
            }

            updateItemById(item.id, { status: 'processing_ocr' });

            // 429 自动重试
            let lastError: any = null;
            for (let attempt = 0; attempt < 4; attempt++) {
                try {
                    const response = await ai.models.generateContent({
                        model: textModel,
                        contents: {
                            role: 'user',
                            parts: [
                                { inlineData: { mimeType: mimeType!, data: base64Data } },
                                { text: "Identify all text in this image. Return only the text exactly as it appears, without any introductory or concluding remarks." }
                            ]
                        }
                    });
                    const text = response.text || '';
                    updateItemById(item.id, { originalText: text });
                    return text;
                } catch (e: any) {
                    lastError = e;
                    const is429 = e?.message?.includes('429') || e?.message?.includes('RESOURCE_EXHAUSTED') || e?.status === 429;
                    if (is429 && attempt < 3) {
                        const delay = 3000 * Math.pow(2, attempt); // 3s, 6s, 12s
                        console.warn(`[OCR] 429 rate limit, retry ${attempt + 1}/3 after ${delay}ms`);
                        await new Promise(r => setTimeout(r, delay));
                        continue;
                    }
                    throw e;
                }
            }
            throw lastError;
        };

        // 批量翻译一组文本
        const translateBatch = async (batch: { id: string; text: string }[]) => {
            if (batch.length === 0) return;

            // 标记所有为翻译中
            batch.forEach(b => updateItemById(b.id, { status: 'processing_translate' }));

            const cleanupInstruction = batchCleanupMode ? `
NOTE: Only remove text that EXACTLY matches these specific AI tool watermark patterns (verbatim signatures):
- Exact phrases like "Made with ChatGPT", "Generated by Midjourney", "Created using DALL-E", "Made by Sora", "Made by Kling"
- Standalone social media handles that are NOT part of the copywriting (e.g., a line containing ONLY "@username")

DO NOT remove:
- Titles, headings, or the first line of any text - these are part of the content and MUST be translated
- Slogans, taglines, or short promotional phrases that are part of the copywriting
- Any sentence that appears to be written content, even if it sounds like an advertisement
- URLs that are part of the content

Only translate all the meaningful content, including titles and headings.` : '';

            const customInstructionBlock = customInstruction?.trim() ? `\nADDITIONAL USER REQUIREMENTS:\n${customInstruction.trim()}\n` : '';

            const numberedTexts = batch.map((b, i) => `--- ITEM ${i + 1} ---\n${b.text}`).join('\n\n');

            const translatePrompt = isChineseOnly
                ? `You are a professional translation engine. Translate ${batch.length} text items into Chinese (Simplified).
Also detect the source language for each item.

${cleanupInstruction}
${customInstructionBlock}
CRITICAL RULES:
1. Translate the COMPLETE text for each item - do NOT skip or omit any part, especially the FIRST LINE (title/heading).
2. The first line of each item is the TITLE and MUST be translated - never skip it.
3. If the source text is already in Chinese, copy it exactly.
4. Preserve all line breaks and formatting from the original.
5. Return a JSON array with exactly ${batch.length} objects, one for each item in order.

Return in this exact JSON format (no markdown, no extra text):
[
  {"chinese": "Chinese translation", "detectedLanguage": "语言名称"},
  ...
]

Here are the ${batch.length} items:

${numberedTexts}`
                : `You are a professional translation engine. Translate ${batch.length} text items into these target languages: ${targetLangSpecs}.
Also detect the source language for each item.

${cleanupInstruction}
${customInstructionBlock}
CRITICAL RULES:
1. Translate the COMPLETE text for each item - do NOT skip or omit any part, especially the FIRST LINE (title/heading).
2. The first line of each item is the TITLE and MUST be translated - never skip it.
3. If the source text is already in Chinese, copy it exactly to the "chinese" field.
4. If the source text is NOT Chinese, translate it to Chinese (Simplified) for the "chinese" field.
5. Preserve all line breaks and formatting from the original.
6. Return a JSON array with exactly ${batch.length} objects, one for each item in order.

Return in this exact JSON format (no markdown, no extra text):
[
  {"translations": {${effectiveBatchLanguages.map(c => `"${c}": "..."`).join(', ')}}, "chinese": "...", "detectedLanguage": "..."},
  ...
]

Here are the ${batch.length} items:

${numberedTexts}`;

            try {
                const translateResponse = await retryOnEmpty(
                    () => ai.models.generateContent({
                        model: textModel,
                        contents: translatePrompt
                    }),
                    (response) => !response.text?.trim(),
                    3, 1500
                );

                let rawText = (translateResponse.text || '').trim();
                if (rawText.startsWith('```')) {
                    rawText = rawText.replace(/^```json?\s*/, '').replace(/```\s*$/, '');
                }

                let results: any[] = [];
                try {
                    results = JSON.parse(rawText);
                } catch {
                    // 如果解析失败且只有1条，尝试解析为单个对象
                    if (batch.length === 1) {
                        try {
                            results = [JSON.parse(rawText)];
                        } catch {
                            results = [isChineseOnly ? { chinese: rawText } : { translations: { [primaryBatchLanguage]: rawText } }];
                        }
                    } else {
                        batch.forEach(b => updateItemById(b.id, { status: 'error', error: '批量翻译结果解析失败' }));
                        return;
                    }
                }

                // 映射结果到各项
                batch.forEach((b, i) => {
                    const parsed = results[i];
                    if (!parsed) {
                        updateItemById(b.id, { status: 'error', error: '翻译结果缺失' });
                        return;
                    }

                    let translatedText = '';
                    let chineseText = parsed.chinese || '';
                    let detectedLanguage = parsed.detectedLanguage || '';
                    let translations: Record<string, string> | undefined;

                    if (!isChineseOnly) {
                        if (parsed.translations && typeof parsed.translations === 'object') {
                            translations = {};
                            effectiveBatchLanguages.forEach(code => {
                                if (typeof parsed.translations[code] === 'string') {
                                    translations![code] = parsed.translations[code];
                                }
                            });
                        }
                        if (translations && translations[primaryBatchLanguage]) {
                            translatedText = translations[primaryBatchLanguage];
                        }
                    }

                    if (isChineseOnly) {
                        translatedText = '';
                        translations = undefined;
                    }

                    const hasTranslation = translatedText.trim() ||
                        (translations && Object.values(translations).some(v => v?.trim())) ||
                        chineseText.trim();

                    updateItemById(b.id, {
                        status: hasTranslation ? 'success' : 'error',
                        translatedText,
                        chineseText,
                        translations,
                        detectedLanguage,
                        ...(hasTranslation ? {} : { error: '翻译结果为空' })
                    });
                });

            } catch (e: any) {
                console.error('Batch translate error:', e);
                batch.forEach(b => updateItemById(b.id, { status: 'error', error: e.message || '翻译失败' }));
            }
        };

        // 主调度逻辑
        const runBatchProcess = async () => {
            activeWorkersRef.current = 1;

            const idleItems = items.filter(i => i.status === 'idle' && !processingIdsRef.current.has(i.id));
            if (idleItems.length === 0) {
                const uploadingCount = items.filter(i => i.status === 'processing_upload').length;
                if (uploadingCount === 0) {
                    activeWorkersRef.current = 0;
                    setIsProcessing(false);
                }
                return;
            }

            // 标记正在处理
            idleItems.forEach(i => processingIdsRef.current.add(i.id));

            // 分离图片和文本
            const imageItems = idleItems.filter(i => i.type === 'image' || i.type === 'image-url');
            const textItems = idleItems.filter(i => i.type === 'text');

            // 1. 并发 OCR 图片（最多 batchSize 个同时）
            const ocrResults: { id: string; text: string }[] = [];
            for (let i = 0; i < imageItems.length; i += batchSize) {
                const chunk = imageItems.slice(i, i + batchSize);
                const results = await Promise.allSettled(
                    chunk.map(async item => {
                        try {
                            const text = await ocrImage(item);
                            if (!text.trim()) throw new Error('No text found.');
                            return { id: item.id, text };
                        } catch (e: any) {
                            updateItemById(item.id, { status: 'error', error: e.message || 'OCR 失败' });
                            return null;
                        }
                    })
                );
                results.forEach(r => {
                    if (r.status === 'fulfilled' && r.value) {
                        ocrResults.push(r.value);
                    }
                });
            }

            // 2. 合并所有待翻译文本
            const allToTranslate = [
                ...textItems.map(i => ({ id: i.id, text: i.content })),
                ...ocrResults
            ];

            // 3. 分批翻译（每批 batchSize 条）
            for (let i = 0; i < allToTranslate.length; i += batchSize) {
                const batch = allToTranslate.slice(i, i + batchSize);
                await translateBatch(batch);
            }

            // 清理
            idleItems.forEach(i => processingIdsRef.current.delete(i.id));
            activeWorkersRef.current = 0;
        };

        runBatchProcess();
    }, [items, isProcessing, effectiveBatchLanguages, primaryBatchLanguage, getAiInstance, t, textModel, user]);


    // Event Handlers
    const handleFiles = (files: FileList | null) => {
        if (files) addItems(Array.from(files));
    };

    const handlePaste = useCallback((e: ClipboardEvent) => {
        // 在即时模式下，让 InstantTranslateTool 自己处理粘贴事件
        if (mode === 'instant') return;

        const target = e.target as HTMLElement;

        // ===== 隔离检查：避免拦截其他工具的粘贴事件 =====
        if (!target.closest('.smart-translate-app')) {
            return;
        }

        // 在输入框或文本区域中粘贴时，判断是否需要拦截
        // 只有在拖放区或者工具容器外部粘贴时才处理
        const isBatchTextarea = target instanceof HTMLElement && target.classList.contains('batch-textarea');
        if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') {
            // 对于任何 INPUT 或 TEXTAREA，默认允许正常的文本粘贴
            // 只有批量翻译的输入框允许拦截 Google Sheets 表格粘贴
            if (!isBatchTextarea) {
                return;
            }
        }

        // API key modal 和语言选择器中的粘贴也应该正常处理
        if (target.closest('.api-key-modal') || target.closest('.custom-select-search-wrapper')) {
            return;
        }

        // ===== 先检查文本内容，判断是否应该处理 =====
        const plainText = e.clipboardData?.getData('text/plain') || '';
        const html = e.clipboardData?.getData('text/html') || '';
        const hasImageFormula = plainText.includes('=IMAGE');
        const hasHttp = plainText.includes('http');
        const hasImgTag = html.includes('<img');
        const shouldHandleAsImageContent = hasImageFormula || hasHttp || hasImgTag;
        const hasMeaningfulText = plainText.trim().length > 0;

        // 1. Handle Files (Images)
        const clipItems = e.clipboardData?.items;
        const files: File[] = [];
        let hasImage = false;

        if (clipItems) {
            for (let i = 0; i < clipItems.length; i++) {
                if (clipItems[i].type.indexOf('image') !== -1) {
                    const file = clipItems[i].getAsFile();
                    if (file) {
                        files.push(file);
                        hasImage = true;
                    }
                }
            }
        }

        if (hasImage) {
            // 如果有纯文本但没有链接/公式，说明图片只是 Google Sheets 的截图
            // 这种情况不拦截，让浏览器正常处理
            if (hasMeaningfulText && !shouldHandleAsImageContent) {
                return;
            }
            addItems(files);
            e.preventDefault();
            return;
        }

        // 检测是否为图片URL
        const isImageUrl = (text: string): boolean => {
            const trimmed = text.trim();
            if (!/^https?:\/\/[^\s]+$/.test(trimmed)) return false;
            const imageExtensions = /\.(jpg|jpeg|png|gif|webp|bmp|svg)(\?.*)?$/i;
            const imageHosts = /(gyazo\.com|imgur\.com|i\.imgur\.com|googleusercontent\.com|drive\.google\.com|lh[0-9]+\.googleusercontent\.com)/i;
            const googleDrivePattern = /drive\.google\.com\/.*\/d\/([a-zA-Z0-9_-]+)/i;
            const imageFormulaPattern = /^=IMAGE\s*\(/i;
            return imageExtensions.test(trimmed) || imageHosts.test(trimmed) || googleDrivePattern.test(trimmed) || imageFormulaPattern.test(trimmed);
        };

        // 在 textarea 中粘贴时，检查是否为图片链接
        if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT') {
            const plainText = e.clipboardData?.getData('text/plain') || '';
            const lines = plainText.split(/\n+/).map(l => l.trim()).filter(l => l);

            // 如果所有行都是图片链接/公式，直接创建图片项目
            const allAreImageUrls = lines.length > 0 && lines.every(line => isImageUrl(line) || isUrl(line));
            if (allAreImageUrls) {
                e.preventDefault();
                const newItems: TranslateItem[] = lines.map(line => createTextOrUrlItem(line));
                setItems(prev => [...prev, ...newItems]);
                return;
            }

            // 处理 HTML 表格
            if (e.clipboardData?.types.includes('text/html')) {
                const htmlData = e.clipboardData.getData('text/html');
                if (!htmlData.includes('<table')) {
                    return; // Normal text
                }
            } else {
                return; // Normal text
            }
        }

        const htmlData = e.clipboardData?.getData('text/html');
        if (htmlData) {
            const parser = new DOMParser();
            const doc = parser.parseFromString(htmlData, 'text/html');

            // First, try to extract image URLs from Google Sheets cells
            // Google Sheets may store formula in data-sheets-formula attribute
            // or render images as <img> tags within cells
            const extractedUrls: string[] = [];

            // Method 1: Look for img tags inside the HTML
            const imgTags = doc.querySelectorAll('img');
            imgTags.forEach(img => {
                const src = img.getAttribute('src');
                if (src && src.startsWith('http')) {
                    extractedUrls.push(src);
                }
            });

            // Method 2: Look for data-sheets-formula attribute (Google Sheets specific)
            const cellsWithFormula = doc.querySelectorAll('[data-sheets-formula]');
            cellsWithFormula.forEach(cell => {
                const formula = cell.getAttribute('data-sheets-formula');
                if (formula) {
                    const url = extractUrlFromImageFormula(formula);
                    if (url) {
                        extractedUrls.push(url);
                    }
                }
            });

            // Method 3: Look for data-sheets-value that might contain URLs
            const cellsWithValue = doc.querySelectorAll('[data-sheets-value]');
            cellsWithValue.forEach(cell => {
                try {
                    const valueAttr = cell.getAttribute('data-sheets-value');
                    if (valueAttr) {
                        // data-sheets-value is JSON encoded
                        const valueObj = JSON.parse(valueAttr);
                        if (valueObj && typeof valueObj === 'object') {
                            // Check for formula or string value containing URL
                            const searchValue = (obj: any): void => {
                                if (typeof obj === 'string') {
                                    // Check if it's a URL
                                    if (obj.match(/^https?:\/\//)) {
                                        extractedUrls.push(obj);
                                    }
                                    // Check if it's a formula
                                    const url = extractUrlFromImageFormula(obj);
                                    if (url) {
                                        extractedUrls.push(url);
                                    }
                                } else if (typeof obj === 'object' && obj !== null) {
                                    Object.values(obj).forEach(v => searchValue(v));
                                }
                            };
                            searchValue(valueObj);
                        }
                    }
                } catch (e) {
                    // Ignore JSON parse errors
                }
            });

            // If we found image URLs from Google Sheets, create items for them
            if (extractedUrls.length > 0) {
                const newItems: TranslateItem[] = extractedUrls.map(url => {
                    const directUrl = normalizeUrl(url);
                    return {
                        id: Date.now() + Math.random().toString(36).substr(2, 9),
                        type: 'image-url' as const,
                        content: '',
                        sourceUrl: directUrl,
                        status: 'idle' as const
                    };
                });
                setItems(prev => [...prev, ...newItems]);
                e.preventDefault();
                return;
            }

            // Fall back to standard table parsing
            const rows = doc.querySelectorAll('tr');
            if (rows.length > 0) {
                const newItems: TranslateItem[] = [];
                rows.forEach(row => {
                    const cells = row.querySelectorAll('td, th');
                    cells.forEach(cell => {
                        // Also check for img tags inside cells
                        const cellImg = cell.querySelector('img');
                        if (cellImg) {
                            const src = cellImg.getAttribute('src');
                            if (src && src.startsWith('http')) {
                                const directUrl = normalizeUrl(src);
                                newItems.push({
                                    id: Date.now() + Math.random().toString(36).substr(2, 9),
                                    type: 'image-url',
                                    content: '',
                                    sourceUrl: directUrl,
                                    status: 'idle'
                                });
                                return;
                            }
                        }

                        const cellText = (cell as HTMLElement).innerText.trim();
                        if (cellText) {
                            newItems.push(createTextOrUrlItem(cellText));
                        }
                    });
                });

                if (newItems.length > 0) {
                    setItems(prev => [...prev, ...newItems]);
                    e.preventDefault();
                    return;
                }
            }
        }

    }, [gyazoToken, mode]); // Re-bind when token or mode changes

    useEffect(() => {
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [handlePaste]);

    const handleDelete = (id: string) => {
        setItems(prev => prev.filter(i => i.id !== id));
    };

    const handleUpdateItem = (id: string, updates: Partial<TranslateItem>) => {
        setItems(prev => prev.map(item =>
            item.id === id ? { ...item, ...updates } : item
        ));
    };

    // 即时翻译单个条目
    const handleTranslateItem = async (id: string) => {
        const item = items.find(i => i.id === id);
        if (!item) return;

        const textToTranslate = item.originalText || item.content;
        if (!textToTranslate?.trim()) return;

        const ai = getAiInstance();
        const isChineseOnly = effectiveBatchLanguages.length === 0;
        const targetLangSpecs = effectiveBatchLanguages
            .map(code => `${getLanguageName(code)} (${code})`)
            .join(', ');
        const targetLangJson = effectiveBatchLanguages
            .map(code => `"${code}": "translation in ${getLanguageName(code)}"`)
            .join(', ');

        // 更新状态为翻译中
        setItems(prev => prev.map(i =>
            i.id === id ? { ...i, status: 'processing_translate' as const } : i
        ));

        try {
            // 第一步：翻译（多语种 + 中文）
            const cleanupNote = batchCleanupMode ? `\nNOTE: Only remove text that EXACTLY matches these specific AI tool watermark patterns (verbatim signatures): "Made with ChatGPT", "Generated by Midjourney", "Created using DALL-E", "Made by Sora", "Made by Kling", or a line containing ONLY a social handle like "@username". DO NOT remove titles, headings, slogans, or any written content.\n` : '';
            const customNote = customInstruction?.trim() ? `\nADDITIONAL USER REQUIREMENTS:\n${customInstruction.trim()}\n` : '';

            const translatePrompt = isChineseOnly
                ? `Translate the following text into Chinese (Simplified).
Also provide the detected source language name in Chinese.
${cleanupNote}${customNote}
CRITICAL RULES:
1. Translate the COMPLETE text - do NOT skip or omit any part, especially the FIRST LINE (title/heading).
2. The first line is the TITLE and MUST be translated - never skip or remove it.
3. If the source text is already in Chinese, copy it exactly to the "chinese" field.
4. If the source text is NOT Chinese, translate it to Chinese (Simplified) for the "chinese" field.
5. Preserve all line breaks and formatting from the original.
6. Do NOT remove any content - translate everything including titles, slogans, and all body text.

Return in this exact JSON format (no markdown):
{"chinese": "Chinese translation or original if source is Chinese", "detectedLanguage": "语言名称"}

Text to translate:
"""
${textToTranslate}
"""`
                : `Translate the following text into these target languages: ${targetLangSpecs}.
Also provide the detected source language name in Chinese.
Use the language codes as keys in the JSON output.
${cleanupNote}${customNote}
CRITICAL RULES:
1. Translate the COMPLETE text - do NOT skip or omit any part, especially the FIRST LINE (title/heading).
2. The first line is the TITLE and MUST be translated - never skip or remove it.
3. If the source text is already in Chinese, copy it exactly to the "chinese" field.
4. If the source text is NOT Chinese, translate it to Chinese (Simplified) for the "chinese" field.
5. Preserve all line breaks and formatting from the original.
6. Do NOT remove any content - translate everything including titles, slogans, and all body text.

Return in this exact JSON format (no markdown):
{"translations": {${targetLangJson}}, "chinese": "Chinese translation or original if source is Chinese", "detectedLanguage": "语言名称"}

Text to translate:
"""
${textToTranslate}
"""`;

            const translateResponse = await ai.models.generateContent({
                model: textModel,
                contents: translatePrompt
            });

            let translatedText = translateResponse.text ?? '';
            let chineseText = '';
            let detectedLanguage = '';
            let translations: Record<string, string> | undefined;

            try {
                let cleanResponse = translatedText.trim();
                if (cleanResponse.startsWith('```')) {
                    cleanResponse = cleanResponse.replace(/^```json?\s*/, '').replace(/```\s*$/, '');
                }
                const parsed = JSON.parse(cleanResponse);
                if (!isChineseOnly) {
                    if (parsed.translations && typeof parsed.translations === 'object') {
                        translations = {};
                        effectiveBatchLanguages.forEach(code => {
                            const value = parsed.translations[code];
                            if (typeof value === 'string') {
                                translations![code] = value;
                            }
                        });
                    } else if (parsed.translated) {
                        translations = { [primaryBatchLanguage]: parsed.translated };
                    }
                }
                if (parsed.chinese) {
                    chineseText = parsed.chinese;
                }
                if (parsed.detectedLanguage) {
                    detectedLanguage = parsed.detectedLanguage;
                }
            } catch {
                if (isChineseOnly) {
                    chineseText = translatedText;
                } else {
                    translations = { [primaryBatchLanguage]: translatedText };
                }
            }

            if (!isChineseOnly && translations && translations[primaryBatchLanguage]) {
                translatedText = translations[primaryBatchLanguage];
            }

            // 第二步：检测原文语言（简单的语言检测）
            if (!detectedLanguage) {
                try {
                    const detectPrompt = `What language is this text written in? Reply with only the language name in Chinese (e.g., 英语, 日语, 西班牙语, 法语, 德语, 韩语, 俄语, 阿拉伯语, etc.). Just one or two words, nothing else.\n\nText: "${textToTranslate.slice(0, 200)}"`;

                    const detectResponse = await ai.models.generateContent({
                        model: textModel,
                        contents: detectPrompt
                    });

                    detectedLanguage = (detectResponse.text ?? '').trim().replace(/[。.，,\s]/g, '');
                } catch (detectError) {
                }
            }

            if (isChineseOnly) {
                translatedText = '';
                translations = undefined;
            }

            setItems(prev => prev.map(i =>
                i.id === id ? {
                    ...i,
                    status: 'success' as const,
                    translatedText,
                    chineseText,
                    translations,
                    detectedLanguage
                } : i
            ));
        } catch (e: any) {
            console.error(e);
            const errMsg = e.message || t('error_generic');
            setItems(prev => prev.map(i =>
                i.id === id ? { ...i, status: 'error' as const, error: errMsg } : i
            ));
        }
    };

    const handleClear = () => {
        setItems([]);
        setInputText("");
    };

    const handleBatchCopy = async () => {
        // Helper to escape XML/HTML special chars for the table
        const escapeHtml = (str: string) => {
            if (!str) return "";
            return str
                .replace(/&/g, "&amp;")
                .replace(/</g, "&lt;")
                .replace(/>/g, "&gt;")
                .replace(/"/g, "&quot;")
                .replace(/'/g, "&#039;")
                .replace(/\n/g, "<br>");
        };

        const escapeForTsv = (str: string) => {
            if (!str) return "";
            if (/[\n\t"]/.test(str)) {
                return `"${str.replace(/"/g, '""')}"`;
            }
            return str;
        };

        const validItems = items.filter(i => i.status === 'success' || i.sourceUrl);
        const getTranslationForLang = (item: TranslateItem, code: string) => {
            if (!code) return '';
            if (item.translations && item.translations[code]) return item.translations[code];
            if (code === primaryBatchLanguage) return item.translatedText || '';
            return '';
        };

        // 1. Build TSV (Fallback)
        const tsvLines = validItems.map(i => {
            let visualRef = '';
            if (i.sourceUrl && i.sourceUrl.length > 0) {
                visualRef = i.sourceUrl;
            } else if (i.fileName) {
                visualRef = i.fileName;
            } else if (i.type === 'text') {
                visualRef = '(Text)';
            }
            const cleanOriginal = (i.originalText || '').trim();
            const cleanChinese = (i.chineseText || '').trim();
            const translatedColumns = effectiveBatchLanguages.map(code => escapeForTsv((getTranslationForLang(i, code) || '').trim()));
            const rowParts = [escapeForTsv(visualRef), escapeForTsv(cleanOriginal)];
            if (translatedColumns.length > 0) {
                rowParts.push(...translatedColumns);
            }
            rowParts.push(escapeForTsv(cleanChinese));
            return rowParts.join('\t');
        });
        const tsvData = tsvLines.join('\n');

        // 2. Build HTML Table (Primary for Excel/Sheets)
        let htmlData = '<meta charset="utf-8"><table><tbody>';
        validItems.forEach(i => {
            let visualRef = '';
            if (i.sourceUrl && i.sourceUrl.length > 0) {
                visualRef = i.sourceUrl;
            } else if (i.fileName) {
                visualRef = i.fileName;
            } else if (i.type === 'text') {
                visualRef = '(Text)';
            }
            const cleanOriginal = (i.originalText || '').trim();
            const cleanChinese = (i.chineseText || '').trim();
            const translatedColumns = effectiveBatchLanguages.map(code => escapeHtml((getTranslationForLang(i, code) || '').trim()));

            htmlData += '<tr>';
            htmlData += `<td>${escapeHtml(visualRef)}</td>`;
            htmlData += `<td>${escapeHtml(cleanOriginal)}</td>`;
            translatedColumns.forEach(col => {
                htmlData += `<td>${col}</td>`;
            });
            htmlData += `<td>${escapeHtml(cleanChinese)}</td>`;
            htmlData += '</tr>';
        });
        htmlData += '</tbody></table>';

        try {
            if (navigator.clipboard && window.ClipboardItem) {
                const item = new ClipboardItem({
                    'text/html': new Blob([htmlData], { type: 'text/html' }),
                    'text/plain': new Blob([tsvData], { type: 'text/plain' })
                });
                await navigator.clipboard.write([item]);
            } else {
                await navigator.clipboard.writeText(tsvData);
            }
            setCopyAllStatus(true);
            setTimeout(() => setCopyAllStatus(false), 3000);
        } catch (err) {
            console.error("Clipboard write failed", err);
            navigator.clipboard.writeText(tsvData).then(() => {
                setCopyAllStatus(true);
                setTimeout(() => setCopyAllStatus(false), 3000);
            });
        }
    };

    // 批量复制选项函数 - 使用 TSV 格式（Tab 分隔，适合粘贴到 Google Sheets）
    const getItemOriginal = (item: TranslateItem) => item.originalText || (item.type === 'text' ? item.content : '') || '';

    // 转义 TSV 格式（处理换行和 Tab）
    const escapeForSheet = (str: string) => {
        if (!str) return '';
        // 如果包含换行、Tab 或双引号，需要用双引号包裹并转义内部双引号
        if (/[\n\t"]/.test(str)) {
            return `"${str.replace(/"/g, '""')}"`;
        }
        return str;
    };

    const getItemTranslationByLang = (item: TranslateItem, code: string) => {
        if (!code) return '';
        if (item.translations && item.translations[code]) return item.translations[code];
        if (code === primaryBatchLanguage) return item.translatedText || '';
        return '';
    };

    const getTranslationColumns = (item: TranslateItem, escapeFn: (val: string) => string) => {
        return effectiveBatchLanguages.map(code => escapeFn(getItemTranslationByLang(item, code)));
    };

    // 复制所有原文（每行一个）
    const copyAllOriginals = () => {
        const text = items.filter(i => getItemOriginal(i)).map(i => escapeForSheet(getItemOriginal(i))).join('\n');
        navigator.clipboard.writeText(text).then(() => {
            setCopyAllStatus(true);
            setShowBatchCopyMenu(false);
            setTimeout(() => setCopyAllStatus(false), 3000);
        });
    };

    // 复制所有译文（每行一个，未翻译的行保留为空，以保持行数对应）
    const copyAllTranslated = () => {
        const text = items
            .map(i => {
                if (!hasExtraLanguages) {
                    return escapeForSheet(i.chineseText || '');
                }
                return getTranslationColumns(i, escapeForSheet).join('\t');
            })
            .join('\n');
        navigator.clipboard.writeText(text).then(() => {
            setCopyAllStatus(true);
            setShowBatchCopyMenu(false);
            setTimeout(() => setCopyAllStatus(false), 3000);
        });
    };

    // 复制所有译文+中文（两列，Tab 分隔，未翻译的行保留为空）
    const copyAllTranslatedAndChinese = () => {
        const text = items
            .map(i => {
                if (!hasExtraLanguages) {
                    return escapeForSheet(i.chineseText || '');
                }
                const translatedColumns = getTranslationColumns(i, escapeForSheet).join('\t');
                return `${translatedColumns}\t${escapeForSheet(i.chineseText || '')}`;
            })
            .join('\n');
        navigator.clipboard.writeText(text).then(() => {
            setCopyAllStatus(true);
            setShowBatchCopyMenu(false);
            setTimeout(() => setCopyAllStatus(false), 3000);
        });
    };

    // 复制所有（原文+译文+中文，三列，Tab 分隔，保持行数对应）
    const copyAllComplete = () => {
        const text = items
            .map(i => {
                if (!hasExtraLanguages) {
                    return `${escapeForSheet(getItemOriginal(i))}\t${escapeForSheet(i.chineseText || '')}`;
                }
                const translatedColumns = getTranslationColumns(i, escapeForSheet).join('\t');
                return `${escapeForSheet(getItemOriginal(i))}\t${translatedColumns}\t${escapeForSheet(i.chineseText || '')}`;
            })
            .join('\n');
        navigator.clipboard.writeText(text).then(() => {
            setCopyAllStatus(true);
            setShowBatchCopyMenu(false);
            setTimeout(() => setCopyAllStatus(false), 3000);
        });
    };

    // Drag and Drop
    const onDragOver = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(true); };
    const onDragLeave = (e: React.DragEvent) => { e.preventDefault(); setIsDragging(false); };
    const onDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        handleFiles(e.dataTransfer.files);
    };

    const renderBatchLanguageSummary = (compact?: boolean) => (
        <div className={`batch-language-summary ${compact ? 'compact' : ''}`}>
            <span className="batch-language-label">{t('batchLanguagesLabel')}</span>
            <span className="batch-language-values" title={batchLanguageSummary}>
                {batchLanguageSummary}
            </span>
            <button className="text-btn batch-language-edit" onClick={() => setSettingsOpen(true)}>
                {t('batchLanguagesEdit')}
            </button>
        </div>
    );

    return (
        <div className="tool-container">
            {/* 批量模式收起时：只显示紧凑工具栏 */}
            {mode === 'batch' && isInputCollapsed ? (
                <div className="batch-header-collapsed">
                    <div className="left-controls">
                        <span className="collapsed-title">批量翻译</span>
                        <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                            📷 {t('uploadButton')}
                        </button>
                        <input
                            type="file"
                            multiple
                            accept="image/*"
                            ref={fileInputRef}
                            className="d-none"
                            onChange={e => handleFiles(e.target.files)}
                        />
                        <button
                            className="btn btn-secondary"
                            onClick={addEmptyItem}
                            title={t('addEmptyTooltip')}
                        >
                            + {t('addEmpty')}
                        </button>
                    </div>
                    <div className="right-controls">
                        {renderBatchLanguageSummary(true)}
                        {items.some(i => i.status === 'success' || i.sourceUrl) && (
                            <button className={`btn btn-secondary ${copyAllStatus ? 'success-btn' : ''}`} onClick={handleBatchCopy}>
                                {copyAllStatus ? `✓` : `📋`}
                            </button>
                        )}
                        {items.some(i => i.status === 'success') && (
                            <button
                                className={`btn btn-secondary ${sheetSaveStatus === 'success' ? 'success-btn' : sheetSaveStatus === 'error' ? 'error-btn' : ''}`}
                                onClick={handleSaveToSheet}
                                disabled={sheetSaveStatus === 'saving'}
                                title={sheetSaveStatus === 'error' ? sheetSaveError : '保存到 Google Sheets'}
                            >
                                {sheetSaveStatus === 'saving' ? '...' :
                                    sheetSaveStatus === 'success' ? '✓' :
                                        '📊'}
                            </button>
                        )}
                        {items.length > 0 && (
                            <button className="text-btn" onClick={handleClear}>清空</button>
                        )}
                        {/* 翻译进度显示 */}
                        {items.length > 0 && (
                            <span className="translate-progress-inline">
                                {items.filter(i => i.status === 'success').length}/{items.length}
                                {items.some(i => i.status === 'error') && (
                                    <span className="error-count"> ❌{items.filter(i => i.status === 'error').length}</span>
                                )}
                            </span>
                        )}
                        {/* 重试失败按钮 */}
                        {items.some(i => i.status === 'error') && (
                            <button
                                className="retry-failed-btn tooltip-bottom"
                                onClick={() => {
                                    setItems(prev => prev.map(item =>
                                        item.status === 'error'
                                            ? { ...item, status: 'idle' as const, error: '' }
                                            : item
                                    ));
                                    setTimeout(() => processQueue(), 100);
                                }}
                                disabled={isProcessing}
                                data-tip="重试所有失败的项目"
                            >
                                ↻ 重试失败
                            </button>
                        )}
                        <select
                            className="batch-size-select"
                            value={batchSize}
                            onChange={e => handleBatchSizeChange(parseInt(e.target.value))}
                            title="每批翻译数量"
                            disabled={isProcessing}
                        >
                            {[1, 2, 3, 5, 8, 10, 15, 20].map(n => <option key={n} value={n}>{n}条/批</option>)}
                        </select>
                        <button
                            className="btn btn-primary"
                            onClick={processQueue}
                            disabled={isProcessing || items.every(i => i.status === 'success' || i.status === 'error')}
                        >
                            {isProcessing ? <Loader small /> : '翻译'}
                        </button>
                        <button
                            className="expand-input-btn tooltip-bottom"
                            onClick={() => setIsInputCollapsed(false)}
                            data-tip="展开输入区域"
                        >
                            ▼
                        </button>
                        {/* 当前项目名称 */}
                        {currentProject && !currentProject.id.startsWith('temp_') && (
                            <span className="text-xs text-zinc-500 max-w-[100px] truncate" title={currentProject.name}>
                                ⋮ {currentProject.name}
                            </span>
                        )}
                        {/* 项目管理按钮 */}
                        <button
                            className="btn btn-secondary tooltip-bottom"
                            onClick={() => setShowProjectPanel(true)}
                            data-tip="项目管理"
                        >
                            📁
                        </button>
                    </div>
                </div>
            ) : (
                <>
                    <div className="tool-header">
                        <div>
                            <h2>{t('translateTitle')}</h2>
                            <p className="tool-description">{t('translateDescription')}</p>
                        </div>
                        <div className="tool-header-actions">
                            {mode === 'batch' && (
                                <button
                                    className="collapse-input-btn tooltip-bottom"
                                    onClick={() => setIsInputCollapsed(true)}
                                    data-tip="收起输入区域"
                                >
                                    ▲ 收起
                                </button>
                            )}
                            {mode !== 'instant' && (
                                <div className="lang-select-group">
                                    {renderBatchLanguageSummary()}
                                </div>
                            )}
                            {/* Model selector removed - using global textModel */}
                        </div>
                    </div>

                    {/* Mode switching tabs */}
                    <div className="mode-tabs">
                        <button
                            className={`mode-tab ${mode === 'batch' ? 'active' : ''}`}
                            onClick={() => setMode('batch')}
                        >
                            {t('modeBatch')}
                        </button>
                        <button
                            className={`mode-tab ${mode === 'instant' ? 'active' : ''}`}
                            onClick={() => setMode('instant')}
                        >
                            {t('modeInstant')}
                        </button>
                        {/* 当前项目名称 */}
                        {currentProject && !currentProject.id.startsWith('temp_') && (
                            <span className="text-xs text-zinc-500 truncate" style={{ marginLeft: '8px', maxWidth: '100px' }} title={currentProject.name}>
                                ⋮ {currentProject.name}
                            </span>
                        )}
                        {/* 项目管理按钮 */}
                        <button
                            className="mode-tab tooltip-bottom"
                            onClick={() => setShowProjectPanel(true)}
                            data-tip="项目管理"
                            style={{ marginLeft: '8px' }}
                        >
                            📁
                        </button>
                    </div>
                </>
            )}

            {/* Conditional rendering based on mode */}
            {mode === 'instant' ? (
                <InstantTranslateTool
                    targetLanguage={targetLanguage}
                    setTargetLanguage={setTargetLanguage}
                    getAiInstance={getAiInstance}
                    t={t}
                    model={textModel}
                    onSwitchToBatch={(files, urls) => {
                        // 切换到批量模式
                        setMode('batch');
                        // 添加图片文件
                        if (files && files.length > 0) {
                            addItems(files);
                        }
                        // 添加图片链接
                        if (urls && urls.length > 0) {
                            const newItems: TranslateItem[] = urls.map(url => createTextOrUrlItem(url));
                            setItems(prev => [...prev, ...newItems]);
                        }
                    }}
                />
            ) : (
                <>
                    {/* 可收起的输入区域 */}
                    <div className={`batch-input-wrapper ${isInputCollapsed ? 'collapsed' : ''}`}>
                        {isInputCollapsed ? (
                            /* 收起状态：只显示紧凑工具栏 */
                            <div className="batch-input-collapsed">
                                <div className="left-controls">
                                    <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                                        📷 {t('uploadButton')}
                                    </button>
                                    <input
                                        type="file"
                                        multiple
                                        accept="image/*"
                                        ref={fileInputRef}
                                        className="d-none"
                                        onChange={e => handleFiles(e.target.files)}
                                    />
                                    <button
                                        className="btn btn-secondary"
                                        onClick={addEmptyItem}
                                        title={t('addEmptyTooltip')}
                                    >
                                        + {t('addEmpty')}
                                    </button>
                                </div>
                                <div className="right-controls">
                                    {items.some(i => i.status === 'success' || i.sourceUrl) && (
                                        <button className={`btn btn-secondary ${copyAllStatus ? 'success-btn' : ''}`} onClick={handleBatchCopy}>
                                            {copyAllStatus ? `✓ ${t('copyAllSuccess')}` : `📋 ${t('copyAll')}`}
                                        </button>
                                    )}
                                    {items.some(i => i.status === 'success') && (
                                        <button
                                            className={`btn btn-secondary ${sheetSaveStatus === 'success' ? 'success-btn' : sheetSaveStatus === 'error' ? 'error-btn' : ''}`}
                                            onClick={handleSaveToSheet}
                                            disabled={sheetSaveStatus === 'saving'}
                                            title={sheetSaveStatus === 'error' ? sheetSaveError : '保存到 Google Sheets'}
                                        >
                                            {sheetSaveStatus === 'saving' ? '保存中...' :
                                                sheetSaveStatus === 'success' ? '✓ 已保存' :
                                                    '📊 保存表格'}
                                        </button>
                                    )}
                                    {items.length > 0 && (
                                        <button className="text-btn" onClick={handleClear}>{t('clearQueue')}</button>
                                    )}
                                    <button
                                        className="btn btn-primary"
                                        onClick={processQueue}
                                        disabled={isProcessing || items.every(i => i.status === 'success' || i.status === 'error')}
                                    >
                                        {isProcessing ? <Loader small /> : t('translateButton')}
                                    </button>
                                    <button
                                        className="expand-input-btn tooltip-bottom"
                                        onClick={() => setIsInputCollapsed(false)}
                                        data-tip="展开输入区域"
                                    >
                                        ▼
                                    </button>
                                </div>
                            </div>
                        ) : (
                            /* 展开状态：完整输入区域 */
                            <div
                                className={`batch-input-area ${isDragging ? 'dragging' : ''}`}
                                onDragOver={onDragOver}
                                onDragLeave={onDragLeave}
                                onDrop={onDrop}
                                ref={dropZoneRef}
                            >
                                <textarea
                                    className="batch-textarea"
                                    placeholder={t('inputPlaceholder')}
                                    value={inputText}
                                    onChange={e => setInputText(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                                            processQueue();
                                        }
                                    }}
                                />
                                <div className="batch-controls">
                                    <div className="left-controls">
                                        <button className="btn btn-secondary" onClick={() => fileInputRef.current?.click()}>
                                            📷 {t('uploadButton')}
                                        </button>
                                        <input
                                            type="file"
                                            multiple
                                            accept="image/*"
                                            ref={fileInputRef}
                                            className="d-none"
                                            onChange={e => handleFiles(e.target.files)}
                                        />
                                        <button
                                            className="btn btn-secondary"
                                            onClick={addEmptyItem}
                                            title={t('addEmptyTooltip')}
                                        >
                                            + {t('addEmpty')}
                                        </button>
                                    </div>
                                    <div className="right-controls">
                                        {items.some(i => i.status === 'success' || i.sourceUrl) && (
                                            <div className="batch-copy-menu-container">
                                                <button
                                                    className={`btn btn-secondary ${copyAllStatus ? 'success-btn' : ''}`}
                                                    onClick={() => setShowBatchCopyMenu(!showBatchCopyMenu)}
                                                >
                                                    {copyAllStatus ? `✓ ${t('copyAllSuccess')}` : `📋 ${t('copyAll')} ▼`}
                                                </button>
                                                {showBatchCopyMenu && (
                                                    <div className="batch-copy-dropdown-menu" onMouseLeave={() => setShowBatchCopyMenu(false)}>
                                                        <button onClick={copyAllOriginals}>
                                                            <Pencil size={14} /> 复制所有原文
                                                        </button>
                                                        <button onClick={copyAllTranslated}>
                                                            <Globe size={14} /> 复制所有译文
                                                        </button>
                                                        <button onClick={copyAllTranslatedAndChinese}>
                                                            <RefreshCw size={14} /> 复制译文+中文
                                                        </button>
                                                        <button onClick={copyAllComplete}>
                                                            <Copy size={14} /> 复制全部内容
                                                        </button>
                                                        <hr />
                                                        <button onClick={() => { handleBatchCopy(); setShowBatchCopyMenu(false); }}>
                                                            📊 复制为表格
                                                        </button>
                                                    </div>
                                                )}
                                            </div>
                                        )}
                                        {items.some(i => i.status === 'success') && (
                                            <button
                                                className={`btn btn-secondary ${sheetSaveStatus === 'success' ? 'success-btn' : sheetSaveStatus === 'error' ? 'error-btn' : ''}`}
                                                onClick={handleSaveToSheet}
                                                disabled={sheetSaveStatus === 'saving'}
                                                title={sheetSaveStatus === 'error' ? sheetSaveError : '保存到 Google Sheets'}
                                            >
                                                {sheetSaveStatus === 'saving' ? '...' :
                                                    sheetSaveStatus === 'success' ? '✓ 已存' :
                                                        '📊 表格'}
                                            </button>
                                        )}
                                        {items.length > 0 && (
                                            <button className="text-btn" onClick={handleClear}>{t('clearQueue')}</button>
                                        )}
                                        {/* 翻译进度显示 */}
                                        {items.length > 0 && (
                                            <span className="translate-progress-inline">
                                                ✅ {items.filter(i => i.status === 'success').length}/{items.length}
                                                {items.some(i => i.status === 'error') && (
                                                    <span className="error-count"> ❌{items.filter(i => i.status === 'error').length}</span>
                                                )}
                                                {isProcessing && (
                                                    <span className="processing-count"> ⏳{items.filter(i => i.status.startsWith('processing')).length}</span>
                                                )}
                                            </span>
                                        )}
                                        {/* 重试失败按钮 */}
                                        {items.some(i => i.status === 'error') && (
                                            <button
                                                className="retry-failed-btn tooltip-bottom"
                                                onClick={() => {
                                                    setItems(prev => prev.map(item =>
                                                        item.status === 'error'
                                                            ? { ...item, status: 'idle' as const, error: '' }
                                                            : item
                                                    ));
                                                    setTimeout(() => processQueue(), 100);
                                                }}
                                                disabled={isProcessing}
                                                data-tip="重试所有失败的项目"
                                            >
                                                ↻ 重试失败
                                            </button>
                                        )}
                                        {items.some(i => i.status === 'success' || i.status === 'error') && (
                                            <button
                                                className="btn btn-secondary tooltip-bottom"
                                                onClick={() => {
                                                    // Reset all completed/error items to idle for retranslation
                                                    setItems(prev => prev.map(item =>
                                                        (item.status === 'success' || item.status === 'error')
                                                            ? { ...item, status: 'idle' as const, translatedText: '', chineseText: '', translations: undefined, error: '' }
                                                            : item
                                                    ));
                                                    // Start processing
                                                    setTimeout(() => processQueue(), 100);
                                                }}
                                                disabled={isProcessing}
                                                data-tip="重新翻译所有已翻译/失败的项目"
                                            >
                                                🔄 {t('retranslateAll') || '重新翻译'}
                                            </button>
                                        )}
                                        <select
                                            className="batch-size-select"
                                            value={batchSize}
                                            onChange={e => handleBatchSizeChange(parseInt(e.target.value))}
                                            title="每批翻译数量"
                                            disabled={isProcessing}
                                        >
                                            {[1, 2, 3, 5, 8, 10, 15, 20].map(n => <option key={n} value={n}>{n}条/批</option>)}
                                        </select>
                                        <button
                                            className="btn btn-primary"
                                            onClick={processQueue}
                                            disabled={isProcessing || (!inputText.trim() && items.every(i => i.status === 'success' || i.status === 'error'))}
                                        >
                                            {isProcessing ? <Loader small /> : t('translateButton')}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* 自定义翻译要求 - 直接显示在页面上 */}
                    <div className="inline-custom-instruction">
                        <button
                            className="inline-instruction-toggle"
                            onClick={() => setShowInlineInstruction(!showInlineInstruction)}
                            type="button"
                        >
                            <span className={`toggle-arrow ${showInlineInstruction ? 'open' : ''}`}>▶</span>
                            <span>📝 翻译指令</span>
                            {customInstruction?.trim() && !showInlineInstruction && (
                                <span className="inline-instruction-preview">
                                    {customInstruction.trim().slice(0, 40)}{customInstruction.trim().length > 40 ? '...' : ''}
                                </span>
                            )}
                        </button>
                        {showInlineInstruction && (
                            <div className="inline-instruction-body">
                                <div className="instruction-presets">
                                    {[
                                        { label: '🔠 标题全大写', text: 'The first sentence or title of each translation MUST use ALL UPPERCASE LETTERS.' },
                                        { label: '✂️ 去掉@内容', text: 'Remove all @username handles and any content after @ symbols (e.g. @someone).' },
                                        { label: '✨ 正式语气', text: 'Use formal and professional tone in all translations.' },
                                        { label: '💬 口语化', text: 'Use casual, conversational tone in all translations.' },
                                    ].map(preset => {
                                        const isActive = customInstruction?.includes(preset.text);
                                        return (
                                            <button
                                                key={preset.label}
                                                className={`instruction-preset-chip ${isActive ? 'active' : ''}`}
                                                onClick={() => {
                                                    if (isActive) {
                                                        const updated = customInstruction.replace(preset.text, '').replace(/\n{2,}/g, '\n').trim();
                                                        setCustomInstruction(updated);
                                                    } else {
                                                        const updated = customInstruction?.trim()
                                                            ? customInstruction.trim() + '\n' + preset.text
                                                            : preset.text;
                                                        setCustomInstruction(updated);
                                                    }
                                                }}
                                                type="button"
                                            >
                                                {preset.label}
                                            </button>
                                        );
                                    })}
                                </div>
                                <textarea
                                    className="inline-instruction-textarea"
                                    placeholder="可选：添加翻译要求，也可以点击上方预设快速添加..."
                                    value={customInstruction}
                                    onChange={(e) => setCustomInstruction(e.target.value)}
                                    rows={2}
                                />
                            </div>
                        )}
                    </div>

                    <div className="batch-queue">
                        {items.map(item => (
                            <BatchItemCard
                                key={item.id}
                                item={item}
                                batchTargetLanguages={effectiveBatchLanguages}
                                batchOnlyChinese={batchOnlyChinese}
                                onDelete={handleDelete}
                                onUpdate={handleUpdateItem}
                                onTranslate={handleTranslateItem}
                            />
                        ))}
                    </div>
                </>
            )}

            {/* 项目管理面板 */}
            <ProjectPanel
                isOpen={showProjectPanel}
                onClose={() => setShowProjectPanel(false)}
                moduleId="smart-translate"
                currentProjectId={currentProject?.id}
                onProjectChange={(project) => {
                    setCurrentProject(project);
                    // 恢复项目状态
                    if (project.currentState?.items) {
                        setItems(project.currentState.items.map((item: any) => ({
                            ...item,
                            id: Date.now() + Math.random().toString(36).substr(2, 9),
                            status: item.status || 'success'
                        })));
                    }
                    if (project.currentState?.targetLanguage) {
                        setTargetLanguage(project.currentState.targetLanguage);
                    }
                    if (project.currentState?.batchTargetLanguages) {
                        setBatchTargetLanguages(project.currentState.batchTargetLanguages);
                    }
                    if (typeof project.currentState?.batchOnlyChinese === 'boolean') {
                        setBatchOnlyChinese(project.currentState.batchOnlyChinese);
                    }
                    setShowProjectPanel(false);
                }}
                onCreateNew={() => {
                    // 创建新项目时清空状态
                    setItems([]);
                    setCurrentProject(null);
                }}
            />
        </div>
    );
};

// --- Main App Component ---

const ApiKeyModal: React.FC<{
    onClose: () => void;
    batchTargetLanguages: string[];
    setBatchTargetLanguages: (val: string[] | ((prev: string[]) => string[])) => void;
    batchOnlyChinese: boolean;
    setBatchOnlyChinese: (val: boolean | ((prev: boolean) => boolean)) => void;
    batchCleanupMode: boolean;
    setBatchCleanupMode: (val: boolean | ((prev: boolean) => boolean)) => void;
    customInstruction: string;
    setCustomInstruction: (val: string) => void;
}> = ({ onClose, batchTargetLanguages, setBatchTargetLanguages, batchOnlyChinese, setBatchOnlyChinese, batchCleanupMode, setBatchCleanupMode, customInstruction, setCustomInstruction }) => {
    const { t } = useTranslation();
    const { apiKey, setApiKey, gyazoToken, setGyazoToken, allowApiKeySettings } = useApi();
    const [localKey, setLocalKey] = useState(apiKey);
    // Only show local token if it's different from default, otherwise show empty/placeholder
    const [localGyazo, setLocalGyazo] = useState(gyazoToken === DEFAULT_GYAZO_TOKEN ? '' : gyazoToken);
    const [languageSearch, setLanguageSearch] = useState('');
    const [localBatchLanguages, setLocalBatchLanguages] = useState<string[]>(batchTargetLanguages);
    const [localBatchOnlyChinese, setLocalBatchOnlyChinese] = useState<boolean>(batchOnlyChinese);
    const [localBatchCleanupMode, setLocalBatchCleanupMode] = useState<boolean>(batchCleanupMode);
    const [localCustomInstruction, setLocalCustomInstruction] = useState<string>(customInstruction);
    const [showCustomInstruction, setShowCustomInstruction] = useState<boolean>(!!customInstruction?.trim());
    const inputRef = useRef<HTMLInputElement>(null);
    const languageSearchRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (allowApiKeySettings) {
            inputRef.current?.focus();
        } else if (!localBatchOnlyChinese) {
            languageSearchRef.current?.focus();
        }
    }, [allowApiKeySettings, localBatchOnlyChinese]);

    useEffect(() => {
        setLocalBatchLanguages(batchTargetLanguages);
    }, [batchTargetLanguages]);

    useEffect(() => {
        setLocalBatchOnlyChinese(batchOnlyChinese);
    }, [batchOnlyChinese]);

    useEffect(() => {
        setLocalBatchCleanupMode(batchCleanupMode);
    }, [batchCleanupMode]);

    useEffect(() => {
        setLocalCustomInstruction(customInstruction);
        if (customInstruction?.trim()) setShowCustomInstruction(true);
    }, [customInstruction]);

    const selectableLanguages = useMemo(() => {
        return allLanguages.filter(lang => lang.code !== 'smart_auto' && lang.code !== 'zh');
    }, []);

    const filteredLanguages = useMemo(() => {
        const keyword = languageSearch.trim().toLowerCase();
        if (!keyword) return selectableLanguages;
        return selectableLanguages.filter(lang =>
            getLanguageName(lang.code).toLowerCase().includes(keyword) ||
            lang.name.toLowerCase().includes(keyword) ||
            lang.code.toLowerCase().includes(keyword)
        );
    }, [languageSearch, selectableLanguages]);

    const sortedLanguages = useMemo(() => {
        const selected: typeof filteredLanguages = [];
        const unselected: typeof filteredLanguages = [];
        filteredLanguages.forEach(lang => {
            if (localBatchLanguages.includes(lang.code)) {
                selected.push(lang);
            } else {
                unselected.push(lang);
            }
        });
        return [...selected, ...unselected];
    }, [filteredLanguages, localBatchLanguages]);

    const selectedLanguageNames = useMemo(() => {
        return localBatchLanguages.map(code => getLanguageName(code)).filter(Boolean);
    }, [localBatchLanguages]);

    const toggleBatchLanguage = (code: string) => {
        setLocalBatchLanguages(prev => {
            if (prev.includes(code)) {
                return prev.filter(item => item !== code);
            }
            return [...prev, code];
        });
    };

    const handleSave = () => {
        if (allowApiKeySettings) {
            setApiKey(localKey);
            setGyazoToken(localGyazo);
        }
        setBatchTargetLanguages(localBatchLanguages);
        setBatchOnlyChinese(localBatchOnlyChinese);
        setBatchCleanupMode(localBatchCleanupMode);
        setCustomInstruction(localCustomInstruction);
        onClose();
    };

    const modalTitle = allowApiKeySettings ? t('apiKeyTitle') : t('batchLanguagesLabel');
    const modalDescription = allowApiKeySettings ? t('apiKeyPrompt') : t('batchLanguagesHint');

    return (
        <div className="modal-overlay" onMouseDown={onClose}>
            <div className="modal-content api-key-modal" onMouseDown={e => e.stopPropagation()}>
                <h3>{modalTitle}</h3>
                <p className="modal-description">{modalDescription}</p>

                {allowApiKeySettings && (
                    <>
                        <div className="form-group">
                            <label className="form-label">Google Gemini API Key</label>
                            <input
                                ref={inputRef}
                                type="password"
                                placeholder={t('apiKeyInputPlaceholder')}
                                value={localKey}
                                onChange={e => setLocalKey(e.target.value)}
                            />
                        </div>

                        <hr className="form-separator" />

                        <div className="form-group">
                            <label className="form-label">{t('gyazoTokenLabel')}</label>
                            <input
                                type="password"
                                placeholder={t('gyazoTokenPlaceholder')}
                                value={localGyazo}
                                onChange={e => setLocalGyazo(e.target.value)}
                                onKeyPress={(e) => e.key === 'Enter' && handleSave()}
                            />
                        </div>

                        <hr className="form-separator" />
                    </>
                )}

                <div className="form-group batch-language-config">
                    <label className="form-label">
                        {t('batchLanguagesLabel')}
                    </label>
                    <div className="batch-language-hint">{t('batchLanguagesHint')}</div>
                    <div className="batch-only-chinese-toggle">
                        <label>
                            <input
                                type="checkbox"
                                checked={localBatchOnlyChinese}
                                onChange={(e) => setLocalBatchOnlyChinese(e.target.checked)}
                            />
                            <span>{t('batchOnlyChineseLabel')}</span>
                        </label>
                        <div className="batch-only-chinese-hint">{t('batchOnlyChineseHint')}</div>
                    </div>
                    <div className="batch-cleanup-mode-toggle">
                        <label>
                            <input
                                type="checkbox"
                                checked={localBatchCleanupMode}
                                onChange={(e) => setLocalBatchCleanupMode(e.target.checked)}
                            />
                            <span>{t('batchCleanupModeLabel')}</span>
                        </label>
                        <div className="batch-cleanup-mode-hint">{t('batchCleanupModeHint')}</div>
                        {localBatchCleanupMode && (
                            <div className="batch-cleanup-mode-warning">{t('batchCleanupModeWarning')}</div>
                        )}
                    </div>
                    <div className="batch-custom-instruction-section">
                        <button
                            className="custom-instruction-toggle"
                            onClick={() => setShowCustomInstruction(!showCustomInstruction)}
                            type="button"
                        >
                            <span className={`toggle-arrow ${showCustomInstruction ? 'open' : ''}`}>▶</span>
                            <span>自定义翻译要求</span>
                            {localCustomInstruction?.trim() && !showCustomInstruction && (
                                <span className="custom-instruction-badge">已设置</span>
                            )}
                        </button>
                        {showCustomInstruction && (
                            <div className="custom-instruction-body">
                                <div className="custom-instruction-hint">
                                    可选：添加额外的翻译要求，AI 会在翻译时遵循这些指令。留空则使用默认翻译规则。
                                </div>
                                <textarea
                                    className="custom-instruction-textarea"
                                    placeholder="例如：&#10;• 使用正式/书面语气&#10;• 品牌名称保持英文不翻译&#10;• 翻译风格偏口语化&#10;• 专业术语使用行业标准译法"
                                    value={localCustomInstruction}
                                    onChange={(e) => setLocalCustomInstruction(e.target.value)}
                                    rows={4}
                                />
                                {localCustomInstruction?.trim() && (
                                    <button
                                        className="text-btn custom-instruction-clear"
                                        onClick={() => setLocalCustomInstruction('')}
                                        type="button"
                                    >
                                        ✕ 清除要求
                                    </button>
                                )}
                            </div>
                        )}
                    </div>
                    <div className="batch-language-selected">
                        {t('batchLanguagesSelected')}:
                        <span className={`batch-language-selected-values ${localBatchOnlyChinese ? 'disabled' : ''}`}>
                            {selectedLanguageNames.length > 0 ? selectedLanguageNames.join(' / ') : t('batchLanguagesEmpty')}
                        </span>
                    </div>
                    <input
                        type="text"
                        placeholder={t('searchLanguage')}
                        value={languageSearch}
                        onChange={(e) => setLanguageSearch(e.target.value)}
                        className="batch-language-search"
                        ref={languageSearchRef}
                        disabled={localBatchOnlyChinese}
                    />
                    <div className={`batch-language-options ${localBatchOnlyChinese ? 'disabled' : ''}`}>
                        {sortedLanguages.map(lang => {
                            const isSelected = localBatchLanguages.includes(lang.code);
                            return (
                                <label
                                    key={lang.code}
                                    className={`batch-language-option ${isSelected ? 'selected' : ''} ${localBatchOnlyChinese ? 'disabled' : ''}`}
                                >
                                    <input
                                        type="checkbox"
                                        checked={isSelected}
                                        disabled={localBatchOnlyChinese}
                                        onChange={() => toggleBatchLanguage(lang.code)}
                                    />
                                    <span>{getLanguageName(lang.code)}</span>
                                </label>
                            );
                        })}
                    </div>
                </div>

                <div className="modal-footer">
                    <button className="btn btn-secondary" onClick={onClose}>{t('cancel')}</button>
                    <button className="btn btn-primary" onClick={handleSave}>{t('save')}</button>
                </div>
            </div>
        </div>
    );
};

interface SmartTranslateInnerProps {
    showHeader?: boolean;
    textModel: string;
    imageModel: string;
    state?: SmartTranslateState;
    setState?: React.Dispatch<React.SetStateAction<SmartTranslateState>>;
}

const SmartTranslateInner: React.FC<SmartTranslateInnerProps> = ({ showHeader = true, textModel, imageModel, state, setState }) => {
    const { t, setLanguage, language } = useTranslation();
    const { theme, toggleTheme } = useTheme();
    const { isKeySet, isSettingsOpen, setSettingsOpen, allowApiKeySettings } = useApi();
    const { batchTargetLanguages, setBatchTargetLanguages, batchOnlyChinese, setBatchOnlyChinese, batchCleanupMode, setBatchCleanupMode, customInstruction, setCustomInstruction } = useBatchLanguageState(state, setState);

    useEffect(() => {
        if (!allowApiKeySettings) return;
        if (!isKeySet) setSettingsOpen(true);
    }, [allowApiKeySettings, isKeySet, setSettingsOpen]);

    useEffect(() => {
        if (!showHeader) return;
        document.title = t('appTitle');
    }, [t, showHeader]);

    return (
        <div className={`smart-translate-app theme-${theme}`}>
            <div className="smart-translate-root">
                {isSettingsOpen && (
                    <ApiKeyModal
                        onClose={() => setSettingsOpen(false)}
                        batchTargetLanguages={batchTargetLanguages}
                        setBatchTargetLanguages={setBatchTargetLanguages}
                        batchOnlyChinese={batchOnlyChinese}
                        setBatchOnlyChinese={setBatchOnlyChinese}
                        batchCleanupMode={batchCleanupMode}
                        setBatchCleanupMode={setBatchCleanupMode}
                        customInstruction={customInstruction}
                        setCustomInstruction={setCustomInstruction}
                    />
                )}
                {showHeader && (
                    <header>
                        <div className="title-bar">
                            <h1>🪄 {t('appTitle')}</h1>
                            <div className="header-controls">
                                {allowApiKeySettings && (
                                    <button onClick={() => setSettingsOpen(true)} className="btn btn-secondary api-key-btn">
                                        ⚙️ {t('apiKeyButtonLabel')}
                                    </button>
                                )}
                                <div className="language-selector">
                                    <button onClick={() => setLanguage('zh')} className={language === 'zh' ? 'active' : ''}>中</button>
                                    <button onClick={() => setLanguage('en')} className={language === 'en' ? 'active' : ''}>EN</button>
                                </div>
                                <button onClick={toggleTheme} className="theme-toggle" aria-label="Toggle theme">
                                    {theme === 'dark' ? '☀️' : theme === 'light' ? '🌿' : '🌙'}
                                </button>
                            </div>
                        </div>
                        <nav>
                            <button className="active">{t('navTranslate')}</button>
                        </nav>
                    </header>
                )}
                <main>
                    <TranslateTool
                        textModel={textModel}
                        imageModel={imageModel}
                        state={state}
                        setState={setState}
                        batchTargetLanguages={batchTargetLanguages}
                        setBatchTargetLanguages={setBatchTargetLanguages}
                        batchOnlyChinese={batchOnlyChinese}
                        setBatchOnlyChinese={setBatchOnlyChinese}
                        batchCleanupMode={batchCleanupMode}
                        setBatchCleanupMode={setBatchCleanupMode}
                        customInstruction={customInstruction}
                        setCustomInstruction={setCustomInstruction}
                    />
                </main>
            </div>
        </div>
    );
};

interface SmartTranslateAppProps {
    mode?: 'standalone' | 'embedded';
    getAiInstance?: () => GoogleGenAI;
    gyazoToken?: string;
    language?: Language;
    setLanguage?: (lang: Language) => void;
    theme?: Theme;
    toggleTheme?: () => void;
    textModel?: string;
    imageModel?: string;
    state?: SmartTranslateState;
    setState?: React.Dispatch<React.SetStateAction<SmartTranslateState>>;
}

const SmartTranslateApp: React.FC<SmartTranslateAppProps> = ({
    mode = 'standalone',
    getAiInstance,
    gyazoToken,
    language,
    setLanguage,
    theme,
    toggleTheme,
    textModel = 'gemini-3.1-flash-lite-preview',
    imageModel = 'gemini-2.5-flash-image',
    state,
    setState,
}) => {
    const externalApi = getAiInstance ? { getAiInstance, gyazoToken } : undefined;
    const externalLanguage = language && setLanguage ? { language, setLanguage } : undefined;
    const externalTheme = theme && toggleTheme ? { theme, toggleTheme } : undefined;
    const showHeader = mode !== 'embedded';
    return (
        <ThemeProvider external={externalTheme}>
            <LanguageProvider external={externalLanguage}>
                <ApiProvider external={externalApi}>
                    <SmartTranslateInner showHeader={showHeader} textModel={textModel} imageModel={imageModel} state={state} setState={setState} />
                </ApiProvider>
            </LanguageProvider>
        </ThemeProvider>
    );
};

export default SmartTranslateApp;
