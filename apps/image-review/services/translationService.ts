/**
 * 翻译服务 - 中英文翻译与回译验证
 * 支持语气级别选择（温和、协作式的表达）
 */

import { GoogleGenAI } from "@google/genai";
import { shouldUseAiStudioMode } from '../../../utils/aiStudioDetect';
import { TranslationResult } from '../types';

// 语气级别类型
export type ToneLevel = 'neutral' | 'suggestive' | 'collaborative';
export type TranslationTargetLanguage = string;

export interface TranslationLanguageOption {
    code: string;
    label: string;
    labelEn: string;
    promptName: string;
}

// 语气级别配置
export const TONE_CONFIG: Record<ToneLevel, { label: string; labelEn: string; description: string }> = {
    neutral: {
        label: '中性',
        labelEn: 'Neutral',
        description: '客观陈述问题，不带情感色彩'
    },
    suggestive: {
        label: '建议式',
        labelEn: 'Suggestive',
        description: '以建议的方式表达，温和友好'
    },
    collaborative: {
        label: '协作式',
        labelEn: 'Collaborative',
        description: '强调合作，共同解决问题'
    },
};

// 常用语言列表（覆盖 Google Translate 主流语言；也支持手动输入任意语言代码/名称）
export const TRANSLATION_TARGET_LANGUAGES: TranslationLanguageOption[] = [
    { code: 'en', label: '英文', labelEn: 'English', promptName: 'English' },
    { code: 'es', label: '西班牙文', labelEn: 'Spanish', promptName: 'Spanish' },
    { code: 'fr', label: '法文', labelEn: 'French', promptName: 'French' },
    { code: 'de', label: '德文', labelEn: 'German', promptName: 'German' },
    { code: 'it', label: '意大利文', labelEn: 'Italian', promptName: 'Italian' },
    { code: 'pt', label: '葡萄牙文', labelEn: 'Portuguese', promptName: 'Portuguese' },
    { code: 'pt-BR', label: '葡萄牙文（巴西）', labelEn: 'Portuguese (Brazil)', promptName: 'Brazilian Portuguese' },
    { code: 'ru', label: '俄文', labelEn: 'Russian', promptName: 'Russian' },
    { code: 'uk', label: '乌克兰文', labelEn: 'Ukrainian', promptName: 'Ukrainian' },
    { code: 'pl', label: '波兰文', labelEn: 'Polish', promptName: 'Polish' },
    { code: 'nl', label: '荷兰文', labelEn: 'Dutch', promptName: 'Dutch' },
    { code: 'sv', label: '瑞典文', labelEn: 'Swedish', promptName: 'Swedish' },
    { code: 'da', label: '丹麦文', labelEn: 'Danish', promptName: 'Danish' },
    { code: 'no', label: '挪威文', labelEn: 'Norwegian', promptName: 'Norwegian' },
    { code: 'fi', label: '芬兰文', labelEn: 'Finnish', promptName: 'Finnish' },
    { code: 'el', label: '希腊文', labelEn: 'Greek', promptName: 'Greek' },
    { code: 'cs', label: '捷克文', labelEn: 'Czech', promptName: 'Czech' },
    { code: 'ro', label: '罗马尼亚文', labelEn: 'Romanian', promptName: 'Romanian' },
    { code: 'hu', label: '匈牙利文', labelEn: 'Hungarian', promptName: 'Hungarian' },
    { code: 'bg', label: '保加利亚文', labelEn: 'Bulgarian', promptName: 'Bulgarian' },
    { code: 'hr', label: '克罗地亚文', labelEn: 'Croatian', promptName: 'Croatian' },
    { code: 'sr', label: '塞尔维亚文', labelEn: 'Serbian', promptName: 'Serbian' },
    { code: 'sk', label: '斯洛伐克文', labelEn: 'Slovak', promptName: 'Slovak' },
    { code: 'sl', label: '斯洛文尼亚文', labelEn: 'Slovenian', promptName: 'Slovenian' },
    { code: 'lt', label: '立陶宛文', labelEn: 'Lithuanian', promptName: 'Lithuanian' },
    { code: 'lv', label: '拉脱维亚文', labelEn: 'Latvian', promptName: 'Latvian' },
    { code: 'et', label: '爱沙尼亚文', labelEn: 'Estonian', promptName: 'Estonian' },
    { code: 'is', label: '冰岛文', labelEn: 'Icelandic', promptName: 'Icelandic' },
    { code: 'ga', label: '爱尔兰文', labelEn: 'Irish', promptName: 'Irish' },
    { code: 'cy', label: '威尔士文', labelEn: 'Welsh', promptName: 'Welsh' },
    { code: 'mt', label: '马耳他文', labelEn: 'Maltese', promptName: 'Maltese' },
    { code: 'sq', label: '阿尔巴尼亚文', labelEn: 'Albanian', promptName: 'Albanian' },
    { code: 'bs', label: '波斯尼亚文', labelEn: 'Bosnian', promptName: 'Bosnian' },
    { code: 'mk', label: '马其顿文', labelEn: 'Macedonian', promptName: 'Macedonian' },
    { code: 'be', label: '白俄罗斯文', labelEn: 'Belarusian', promptName: 'Belarusian' },
    { code: 'ca', label: '加泰罗尼亚文', labelEn: 'Catalan', promptName: 'Catalan' },
    { code: 'eu', label: '巴斯克文', labelEn: 'Basque', promptName: 'Basque' },
    { code: 'gl', label: '加利西亚文', labelEn: 'Galician', promptName: 'Galician' },
    { code: 'af', label: '南非荷兰文', labelEn: 'Afrikaans', promptName: 'Afrikaans' },
    { code: 'sw', label: '斯瓦希里文', labelEn: 'Swahili', promptName: 'Swahili' },
    { code: 'zu', label: '祖鲁文', labelEn: 'Zulu', promptName: 'Zulu' },
    { code: 'xh', label: '科萨文', labelEn: 'Xhosa', promptName: 'Xhosa' },
    { code: 'st', label: '索托文', labelEn: 'Sesotho', promptName: 'Sesotho' },
    { code: 'sn', label: '绍纳文', labelEn: 'Shona', promptName: 'Shona' },
    { code: 'am', label: '阿姆哈拉文', labelEn: 'Amharic', promptName: 'Amharic' },
    { code: 'so', label: '索马里文', labelEn: 'Somali', promptName: 'Somali' },
    { code: 'yo', label: '约鲁巴文', labelEn: 'Yoruba', promptName: 'Yoruba' },
    { code: 'ha', label: '豪萨文', labelEn: 'Hausa', promptName: 'Hausa' },
    { code: 'ig', label: '伊博文', labelEn: 'Igbo', promptName: 'Igbo' },
    { code: 'ar', label: '阿拉伯文', labelEn: 'Arabic', promptName: 'Arabic' },
    { code: 'fa', label: '波斯文', labelEn: 'Persian', promptName: 'Persian' },
    { code: 'he', label: '希伯来文', labelEn: 'Hebrew', promptName: 'Hebrew' },
    { code: 'tr', label: '土耳其文', labelEn: 'Turkish', promptName: 'Turkish' },
    { code: 'ku', label: '库尔德文', labelEn: 'Kurdish', promptName: 'Kurdish' },
    { code: 'ps', label: '普什图文', labelEn: 'Pashto', promptName: 'Pashto' },
    { code: 'ur', label: '乌尔都文', labelEn: 'Urdu', promptName: 'Urdu' },
    { code: 'hi', label: '印地文', labelEn: 'Hindi', promptName: 'Hindi' },
    { code: 'bn', label: '孟加拉文', labelEn: 'Bengali', promptName: 'Bengali' },
    { code: 'pa', label: '旁遮普文', labelEn: 'Punjabi', promptName: 'Punjabi' },
    { code: 'gu', label: '古吉拉特文', labelEn: 'Gujarati', promptName: 'Gujarati' },
    { code: 'mr', label: '马拉地文', labelEn: 'Marathi', promptName: 'Marathi' },
    { code: 'ne', label: '尼泊尔文', labelEn: 'Nepali', promptName: 'Nepali' },
    { code: 'si', label: '僧伽罗文', labelEn: 'Sinhala', promptName: 'Sinhala' },
    { code: 'ta', label: '泰米尔文', labelEn: 'Tamil', promptName: 'Tamil' },
    { code: 'te', label: '泰卢固文', labelEn: 'Telugu', promptName: 'Telugu' },
    { code: 'kn', label: '卡纳达文', labelEn: 'Kannada', promptName: 'Kannada' },
    { code: 'ml', label: '马拉雅拉姆文', labelEn: 'Malayalam', promptName: 'Malayalam' },
    { code: 'or', label: '奥里亚文', labelEn: 'Odia', promptName: 'Odia' },
    { code: 'as', label: '阿萨姆文', labelEn: 'Assamese', promptName: 'Assamese' },
    { code: 'sa', label: '梵文', labelEn: 'Sanskrit', promptName: 'Sanskrit' },
    { code: 'mai', label: '迈蒂利文', labelEn: 'Maithili', promptName: 'Maithili' },
    { code: 'gom', label: '贡根文', labelEn: 'Konkani', promptName: 'Konkani' },
    { code: 'mni-Mtei', label: '曼尼普尔文', labelEn: 'Manipuri (Meitei)', promptName: 'Manipuri (Meitei)' },
    { code: 'bho', label: '博杰普尔文', labelEn: 'Bhojpuri', promptName: 'Bhojpuri' },
    { code: 'doi', label: '多格来文', labelEn: 'Dogri', promptName: 'Dogri' },
    { code: 'lus', label: '米佐文', labelEn: 'Mizo', promptName: 'Mizo' },
    { code: 'zh-CN', label: '中文（简体）', labelEn: 'Chinese (Simplified)', promptName: 'Simplified Chinese' },
    { code: 'zh-TW', label: '中文（繁体）', labelEn: 'Chinese (Traditional)', promptName: 'Traditional Chinese' },
    { code: 'ja', label: '日文', labelEn: 'Japanese', promptName: 'Japanese' },
    { code: 'ko', label: '韩文', labelEn: 'Korean', promptName: 'Korean' },
    { code: 'vi', label: '越南文', labelEn: 'Vietnamese', promptName: 'Vietnamese' },
    { code: 'th', label: '泰文', labelEn: 'Thai', promptName: 'Thai' },
    { code: 'id', label: '印尼文', labelEn: 'Indonesian', promptName: 'Indonesian' },
    { code: 'ms', label: '马来文', labelEn: 'Malay', promptName: 'Malay' },
    { code: 'tl', label: '菲律宾文', labelEn: 'Filipino', promptName: 'Filipino' },
    { code: 'my', label: '缅甸文', labelEn: 'Myanmar (Burmese)', promptName: 'Myanmar (Burmese)' },
    { code: 'km', label: '高棉文', labelEn: 'Khmer', promptName: 'Khmer' },
    { code: 'lo', label: '老挝文', labelEn: 'Lao', promptName: 'Lao' },
    { code: 'mn', label: '蒙古文', labelEn: 'Mongolian', promptName: 'Mongolian' },
    { code: 'kk', label: '哈萨克文', labelEn: 'Kazakh', promptName: 'Kazakh' },
    { code: 'ky', label: '吉尔吉斯文', labelEn: 'Kyrgyz', promptName: 'Kyrgyz' },
    { code: 'uz', label: '乌兹别克文', labelEn: 'Uzbek', promptName: 'Uzbek' },
    { code: 'tg', label: '塔吉克文', labelEn: 'Tajik', promptName: 'Tajik' },
    { code: 'tk', label: '土库曼文', labelEn: 'Turkmen', promptName: 'Turkmen' },
    { code: 'hy', label: '亚美尼亚文', labelEn: 'Armenian', promptName: 'Armenian' },
    { code: 'ka', label: '格鲁吉亚文', labelEn: 'Georgian', promptName: 'Georgian' },
    { code: 'az', label: '阿塞拜疆文', labelEn: 'Azerbaijani', promptName: 'Azerbaijani' },
    { code: 'ceb', label: '宿务文', labelEn: 'Cebuano', promptName: 'Cebuano' },
    { code: 'hmn', label: '苗文', labelEn: 'Hmong', promptName: 'Hmong' },
    { code: 'haw', label: '夏威夷文', labelEn: 'Hawaiian', promptName: 'Hawaiian' },
    { code: 'mi', label: '毛利文', labelEn: 'Maori', promptName: 'Maori' },
    { code: 'sm', label: '萨摩亚文', labelEn: 'Samoan', promptName: 'Samoan' },
    { code: 'co', label: '科西嘉文', labelEn: 'Corsican', promptName: 'Corsican' },
    { code: 'fy', label: '弗里西文', labelEn: 'Frisian', promptName: 'Frisian' },
    { code: 'la', label: '拉丁文', labelEn: 'Latin', promptName: 'Latin' },
    { code: 'lb', label: '卢森堡文', labelEn: 'Luxembourgish', promptName: 'Luxembourgish' },
    { code: 'mg', label: '马尔加什文', labelEn: 'Malagasy', promptName: 'Malagasy' },
    { code: 'ny', label: '齐切瓦文', labelEn: 'Chichewa', promptName: 'Chichewa' },
    { code: 'rw', label: '卢旺达文', labelEn: 'Kinyarwanda', promptName: 'Kinyarwanda' },
    { code: 'ln', label: '林加拉文', labelEn: 'Lingala', promptName: 'Lingala' },
    { code: 'lg', label: '干达文', labelEn: 'Luganda', promptName: 'Luganda' },
    { code: 'eo', label: '世界语', labelEn: 'Esperanto', promptName: 'Esperanto' },
    { code: 'yi', label: '意第绪文', labelEn: 'Yiddish', promptName: 'Yiddish' },
    { code: 'jv', label: '爪哇文', labelEn: 'Javanese', promptName: 'Javanese' },
    { code: 'su', label: '巽他文', labelEn: 'Sundanese', promptName: 'Sundanese' },
];

// 语言配置映射（按小写 code 索引）
export const TRANSLATION_TARGET_CONFIG: Record<string, TranslationLanguageOption> = TRANSLATION_TARGET_LANGUAGES.reduce((acc, item) => {
    acc[item.code.toLowerCase()] = item;
    return acc;
}, {} as Record<string, TranslationLanguageOption>);

const languageDisplayEn = typeof Intl !== 'undefined' && Intl.DisplayNames
    ? new Intl.DisplayNames(['en'], { type: 'language' })
    : null;
const languageDisplayZh = typeof Intl !== 'undefined' && Intl.DisplayNames
    ? new Intl.DisplayNames(['zh-CN'], { type: 'language' })
    : null;

const normalizeLanguageCode = (language: string): string =>
    language.trim().replace(/_/g, '-');

const getLanguageNameByCode = (display: Intl.DisplayNames | null, code: string): string | null => {
    if (!display || !code) return null;
    try {
        return display.of(code) || null;
    } catch {
        return null;
    }
};

export const getTranslationTargetConfig = (targetLanguage: TranslationTargetLanguage): TranslationLanguageOption => {
    const normalized = normalizeLanguageCode(targetLanguage || 'en');
    const lookupKey = normalized.toLowerCase();
    const builtIn = TRANSLATION_TARGET_CONFIG[lookupKey];
    if (builtIn) return builtIn;

    // 支持任意语言代码（例如：de, pt-BR, ar）
    const baseCode = normalized.split('-')[0];
    const promptName =
        getLanguageNameByCode(languageDisplayEn, normalized) ||
        getLanguageNameByCode(languageDisplayEn, baseCode) ||
        normalized;
    const labelEn =
        getLanguageNameByCode(languageDisplayEn, normalized) ||
        getLanguageNameByCode(languageDisplayEn, baseCode) ||
        normalized;
    const label =
        getLanguageNameByCode(languageDisplayZh, normalized) ||
        getLanguageNameByCode(languageDisplayZh, baseCode) ||
        normalized;

    return {
        code: normalized,
        label,
        labelEn,
        promptName,
    };
};

// 获取 API Key（使用整个软件统一的 user_api_key）
const getApiKey = (): string => {
    if (typeof window !== 'undefined') {
        return localStorage.getItem('user_api_key') || '';
    }
    return '';
};

// 根据语气级别生成翻译提示词
const getToneInstruction = (tone: ToneLevel): string => {
    switch (tone) {
        case 'neutral':
            return 'Keep the translation professional and objective, stating facts without emotional language.';
        case 'suggestive':
            return `Use a gentle, suggestive tone. Instead of commands like "Fix this" or "Change that", use phrases like:
- "It might be helpful to..."
- "Consider adjusting..."
- "Perhaps we could..."
- "This could benefit from..."
- "You might want to look at..."
The goal is to provide feedback in a friendly, non-confrontational way.`;
        case 'collaborative':
            return `Use a collaborative, team-oriented tone. Frame feedback as shared goals. Use phrases like:
- "Let's work on..."
- "We could improve this by..."
- "Together, we might consider..."
- "How about we try..."
- "It would be great if we could..."
The goal is to make the recipient feel like a valued team member, not someone being criticized.`;
        default:
            return '';
    }
};

/**
 * 翻译中文反馈为英文，并进行回译验证
 * @param chineseFeedback 中文反馈内容
 * @param apiKey 可选的 API Key
 * @param tone 语气级别
 */
export const translateFeedback = async (
    chineseFeedback: string,
    apiKey?: string,
    tone: ToneLevel = 'suggestive',
    targetLanguage: TranslationTargetLanguage = 'en'
): Promise<TranslationResult> => {
    const key = apiKey || getApiKey();
    if (!key) {
        throw new Error('请先配置 API Key');
    }

    // 自动检测：AIza 开头 或 AI Studio 环境 = AI Studio 模式
    const cleanKey = key.trim().replace(/[^\x20-\x7E]/g, '');
    const ai = shouldUseAiStudioMode(cleanKey)
        ? new GoogleGenAI({ apiKey: cleanKey })
        : new GoogleGenAI({ apiKey: cleanKey, vertexai: true });
    const toneInstruction = getToneInstruction(tone);
    const targetConfig = getTranslationTargetConfig(targetLanguage);

    // 第一步：中文翻译为目标语言（带语气调整）
    const translatePrompt = `You are a professional translator specializing in creative team communication. Translate the following Chinese feedback about AI-generated images into clear, natural ${targetConfig.promptName}.

${toneInstruction}

Important guidelines:
- This feedback is from a Chinese reviewer to an international production team
- Avoid harsh or commanding language
- Be constructive and encouraging
- Maintain the core meaning while softening the delivery

Chinese feedback:
${chineseFeedback}

Respond with ONLY the ${targetConfig.promptName} translation, nothing else.`;

    const translateResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: translatePrompt,
    });

    const targetTranslation = translateResponse.text?.trim() || '';

    // 第二步：目标语言回译为中文（验证）
    const backTranslatePrompt = `You are a professional translator. Translate the following ${targetConfig.promptName} text back into Chinese. This is for verification purposes.

${targetConfig.promptName}:
${targetTranslation}

Respond with ONLY the Chinese translation, nothing else.`;

    const backTranslateResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: backTranslatePrompt,
    });

    const backTranslation = backTranslateResponse.text?.trim() || '';

    // 第三步：判断翻译是否准确
    const accuracyPrompt = `Compare these two Chinese texts and determine if they convey the same CORE meaning (not necessarily word-for-word):

Original: ${chineseFeedback}
Back-translated: ${backTranslation}

The tone may differ (the back-translation might be softer), but the main point should be preserved.

Respond with ONLY "true" if the core meaning is preserved, or "false" if the meaning is significantly different.`;

    const accuracyResponse = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: accuracyPrompt,
    });

    const isAccurate = accuracyResponse.text?.trim().toLowerCase() === 'true';

    return {
        original: chineseFeedback,
        english: targetTranslation,
        backTranslation,
        isAccurate,
        targetLanguage,
        targetLanguageLabel: targetConfig.labelEn,
        timestamp: Date.now(),
    };
};

/**
 * 批量翻译多个反馈
 */
export const translateFeedbackBatch = async (
    feedbacks: string[],
    apiKey?: string,
    onProgress?: (completed: number, total: number) => void,
    tone: ToneLevel = 'suggestive',
    targetLanguage: TranslationTargetLanguage = 'en'
): Promise<TranslationResult[]> => {
    const results: TranslationResult[] = [];

    for (let i = 0; i < feedbacks.length; i++) {
        const feedback = feedbacks[i];
        if (feedback.trim()) {
            try {
                const result = await translateFeedback(feedback, apiKey, tone, targetLanguage);
                results.push(result);
            } catch (error) {
                // 失败时返回空结果
                results.push({
                    original: feedback,
                    english: '',
                    backTranslation: '',
                    isAccurate: false,
                    targetLanguage,
                    targetLanguageLabel: getTranslationTargetConfig(targetLanguage).labelEn,
                    timestamp: Date.now(),
                });
            }
        }
        onProgress?.(i + 1, feedbacks.length);
    }

    return results;
};

/**
 * 格式化翻译结果为可复制的文本
 */
export const formatTranslationForCopy = (
    result: TranslationResult,
    format: 'english-only' | 'with-back' | 'full'
): string => {
    const targetLabel = result.targetLanguageLabel || 'Target Language';
    switch (format) {
        case 'english-only':
            return result.english;
        case 'with-back':
            return `${result.english}\n(${result.backTranslation})`;
        case 'full':
            return `📝 原始反馈:\n${result.original}\n\n🔤 ${targetLabel}:\n${result.english}\n\n🔙 回译确认:\n${result.backTranslation} ${result.isAccurate ? '✅' : '⚠️'}`;
        default:
            return result.english;
    }
};
