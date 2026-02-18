import {
    collection,
    doc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    where,
} from 'firebase/firestore';
import { db } from '@/firebase/index';

export type TutorialSurveyToolId =
    | 'studio'
    | 'magicCanvas'
    | 'prompt'
    | 'imageRecognition'
    | 'desc'
    | 'skillGenerator'
    | 'proDedup'
    | 'translate'
    | 'script'
    | 'sheetMind'
    | 'mindMap'
    | 'template'
    | 'subemail'
    | 'aiToolsDirectory'
    | 'apiImageGen'
    | 'copyDedup'
    | 'imageReview'
    | 'imageTextExtractor'
    | 'tutorialHub';

export interface TutorialSurveyToolOption {
    id: TutorialSurveyToolId;
    labelZh: string;
    labelEn: string;
    purposeZh: string;
    purposeEn: string;
}

export const TUTORIAL_SURVEY_KEY = 'tutorial_demand_v1';
const SURVEY_RESPONDER_ID_KEY = 'tutorial_survey_responder_id';
const SURVEY_DRAFT_STORAGE_PREFIX = 'tutorial_survey_draft_';
const SURVEY_COMPLETED_STORAGE_PREFIX = 'tutorial_survey_completed_';
const SURVEY_COLLECTION = 'publicSync';

export const TUTORIAL_SURVEY_TOOLS: TutorialSurveyToolOption[] = [
    { id: 'studio', labelZh: 'AI 一键修图', labelEn: 'AI One-Click Retouch', purposeZh: '预设修图、批量处理', purposeEn: 'Preset retouching and batch processing' },
    { id: 'magicCanvas', labelZh: 'AI 图片编辑器', labelEn: 'AI Image Editor', purposeZh: '图层编辑、蒙版、对话改图', purposeEn: 'Layer editing, mask, conversational edits' },
    { id: 'prompt', labelZh: '反推提示词', labelEn: 'Image to Prompt', purposeZh: '从图片反推提示词（固定反推指令）', purposeEn: 'Reverse prompts from images with fixed instruction templates' },
    { id: 'imageRecognition', labelZh: 'AI 图片识别', labelEn: 'AI Image Recognition', purposeZh: '批量识图、反推词、批量根据图创新、根据 Opal 流转化批量写词、自定义写词指令、拆分图片元素（提供给 Opal 工作流作为精准随机库）', purposeEn: 'Batch image understanding, reverse prompts, and Opal-oriented prompt workflows' },
    { id: 'desc', labelZh: '提示词工具', labelEn: 'Prompt Tool', purposeZh: '对成品描述词进行创新、改写、对话生成；视频图片文案批量改写；批量添加人声情感标签；批量字幕断行', purposeEn: 'Prompt refinement, rewriting, dialogue generation, and batch copy processing' },
    { id: 'skillGenerator', labelZh: '模版指令+随机库生成器', labelEn: 'Template & Library Generator', purposeZh: '生成基础指令与随机库，加速制作 Opal 工作流，减少复杂训练指令提取库过程', purposeEn: 'Generate base instructions and random libraries for Opal workflows' },
    { id: 'proDedup', labelZh: '专业文案查重', labelEn: 'Pro Dedup Search', purposeZh: '专业级批量查重、相似文案搜索与文案分类', purposeEn: 'Professional duplicate detection, similarity search, and copy classification' },
    { id: 'translate', labelZh: '智能翻译', labelEn: 'Smart Translate', purposeZh: 'OCR+多语翻译，批量翻译文案', purposeEn: 'OCR and multilingual batch translation' },
    { id: 'script', labelZh: '文案拆分', labelEn: 'Script Split', purposeZh: '标题正文拆分、清洗（便于批量制作视频）', purposeEn: 'Split and clean title/body for batch video production' },
    { id: 'sheetMind', labelZh: '表格数据分析', labelEn: 'SheetMind', purposeZh: '方便查看、总结、分类图片和数据统计', purposeEn: 'Data viewing, summarization, categorization, and statistics' },
    { id: 'mindMap', labelZh: 'AI 思维导图', labelEn: 'AI Mind Map', purposeZh: '多来源导图与结构化整理（测试版）', purposeEn: 'Multi-source mind map and structured organization (beta)' },
    { id: 'template', labelZh: '指令模版', labelEn: 'Instruction Template', purposeZh: '模块化模板与版本管理，类似 Opal 指令修改和编写', purposeEn: 'Modular instruction templates and version management' },
    { id: 'subemail', labelZh: '生成子邮箱', labelEn: 'Sub-email Generator', purposeZh: 'Gmail 子邮箱批量生成', purposeEn: 'Generate Gmail sub-email variants in batch' },
    { id: 'aiToolsDirectory', labelZh: 'AI 工具集', labelEn: 'AI Tools Directory', purposeZh: '工具目录与筛选', purposeEn: 'AI tools catalog and filtering' },
    { id: 'apiImageGen', labelZh: 'API 生图', labelEn: 'API Image Gen', purposeZh: '批量生图任务流（需付费 API，禁止使用公用 API 生图，超额会产生费用）', purposeEn: 'Batch image generation workflow with paid API usage controls' },
    { id: 'copyDedup', labelZh: 'AI 文案去重', labelEn: 'AI Copy Deduplicator', purposeZh: '语义分组去重（测试）', purposeEn: 'Semantic grouping and deduplication (beta)' },
    { id: 'imageReview', labelZh: '图片审核', labelEn: 'Image Review', purposeZh: '审核标注与报告导出（便于给新人反馈生图、图片视频修改建议，AI 以合适语气翻译解释反馈建议，便于新人理解接受）', purposeEn: 'Review annotation and report export for production feedback' },
    { id: 'imageTextExtractor', labelZh: '图片前景文字提取', labelEn: 'Image Text Extractor', purposeZh: '批量提字+翻译（解决 YouTube 导出贴文文案提取错乱）', purposeEn: 'Batch text extraction + translation for cleaner YouTube copy' },
    { id: 'tutorialHub', labelZh: '教程检索', labelEn: 'Tutorial Hub', purposeZh: '按格式收集教程，可 AI 搜索教程名称并 AI 分类，便于查找教程', purposeEn: 'Collect tutorials, AI search tutorial names, and AI-based categorization' },
];

export interface TutorialSurveyDraft {
    usedTools: TutorialSurveyToolId[];
    needTutorialTools: TutorialSurveyToolId[];
    priorityTop3: TutorialSurveyToolId[];
    tutorialFormats: string[];
    usageFrequency: string;
    needOverallTutorial: boolean;
    notes: string;
}

export const DEFAULT_TUTORIAL_SURVEY_DRAFT: TutorialSurveyDraft = {
    usedTools: [],
    needTutorialTools: [],
    priorityTop3: [],
    tutorialFormats: [],
    usageFrequency: '',
    needOverallTutorial: true,
    notes: '',
};

export interface SubmitTutorialSurveyPayload extends TutorialSurveyDraft {
    language: 'zh' | 'en';
    userId?: string | null;
    userEmail?: string | null;
    appVersion?: string;
}

type ToolStat = {
    usedCount: number;
    needTutorialCount: number;
    priorityScore: number;
};

export interface TutorialSurveyStats {
    totalResponses: number;
    totalNeedOverallTutorial: number;
    toolStats: Record<TutorialSurveyToolId, ToolStat>;
    formatStats: Record<string, number>;
    frequencyStats: Record<string, number>;
    lastClientSubmittedAt: string | null;
}

const toUniqueTools = (tools: TutorialSurveyToolId[]): TutorialSurveyToolId[] => {
    return Array.from(new Set(tools.filter(Boolean)));
};

const safeArray = (value: any): string[] => (Array.isArray(value) ? value : []);

const getLocalResponderId = (): string => {
    try {
        const existing = localStorage.getItem(SURVEY_RESPONDER_ID_KEY);
        if (existing) return existing;
        const generated = `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
        localStorage.setItem(SURVEY_RESPONDER_ID_KEY, generated);
        return generated;
    } catch {
        return `anon_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
    }
};

export const getTutorialSurveyResponderId = (userId?: string | null): string => {
    if (userId) return `uid_${userId}`;
    return getLocalResponderId();
};

export const loadTutorialSurveyDraft = (surveyKey: string = TUTORIAL_SURVEY_KEY): TutorialSurveyDraft => {
    try {
        const raw = localStorage.getItem(`${SURVEY_DRAFT_STORAGE_PREFIX}${surveyKey}`);
        if (!raw) return { ...DEFAULT_TUTORIAL_SURVEY_DRAFT };
        const parsed = JSON.parse(raw);
        return {
            usedTools: toUniqueTools(safeArray(parsed.usedTools) as TutorialSurveyToolId[]),
            needTutorialTools: toUniqueTools(safeArray(parsed.needTutorialTools) as TutorialSurveyToolId[]),
            priorityTop3: toUniqueTools(safeArray(parsed.priorityTop3) as TutorialSurveyToolId[]),
            tutorialFormats: Array.from(new Set(safeArray(parsed.tutorialFormats))),
            usageFrequency: typeof parsed.usageFrequency === 'string' ? parsed.usageFrequency : '',
            needOverallTutorial: parsed.needOverallTutorial !== false,
            notes: typeof parsed.notes === 'string' ? parsed.notes : '',
        };
    } catch {
        return { ...DEFAULT_TUTORIAL_SURVEY_DRAFT };
    }
};

export const saveTutorialSurveyDraft = (
    draft: TutorialSurveyDraft,
    surveyKey: string = TUTORIAL_SURVEY_KEY
): void => {
    try {
        localStorage.setItem(`${SURVEY_DRAFT_STORAGE_PREFIX}${surveyKey}`, JSON.stringify(draft));
    } catch {
        // ignore storage write failure
    }
};

export const isTutorialSurveyCompleted = (surveyKey: string = TUTORIAL_SURVEY_KEY): boolean => {
    try {
        return localStorage.getItem(`${SURVEY_COMPLETED_STORAGE_PREFIX}${surveyKey}`) === '1';
    } catch {
        return false;
    }
};

export const markTutorialSurveyCompleted = (surveyKey: string = TUTORIAL_SURVEY_KEY): void => {
    try {
        localStorage.setItem(`${SURVEY_COMPLETED_STORAGE_PREFIX}${surveyKey}`, '1');
    } catch {
        // ignore storage write failure
    }
};

export const submitTutorialSurvey = async (
    payload: SubmitTutorialSurveyPayload,
    surveyKey: string = TUTORIAL_SURVEY_KEY
): Promise<{ responderId: string; docId: string }> => {
    const responderId = getTutorialSurveyResponderId(payload.userId ?? null);
    const docId = `tutorialSurvey_${surveyKey}_${responderId}`;
    const docRef = doc(db, SURVEY_COLLECTION, docId);

    const priorityTop3 = toUniqueTools(payload.priorityTop3);
    const usedTools = toUniqueTools(payload.usedTools);
    const needTutorialTools = toUniqueTools(payload.needTutorialTools);
    const tutorialFormats = Array.from(new Set(payload.tutorialFormats.filter(Boolean)));

    await setDoc(
        docRef,
        {
            type: 'tutorialSurvey',
            surveyKey,
            responderId,
            responderType: payload.userId ? 'login' : 'anonymous',
            userId: payload.userId || null,
            userEmail: payload.userEmail || null,
            language: payload.language,
            appVersion: payload.appVersion || null,
            usedTools,
            needTutorialTools,
            priorityTop3,
            tutorialFormats,
            usageFrequency: payload.usageFrequency || '',
            needOverallTutorial: !!payload.needOverallTutorial,
            notes: (payload.notes || '').trim(),
            clientSubmittedAt: new Date().toISOString(),
            updatedAt: serverTimestamp(),
        },
        { merge: true }
    );

    return { responderId, docId };
};

export const fetchTutorialSurveyStats = async (
    surveyKey: string = TUTORIAL_SURVEY_KEY
): Promise<TutorialSurveyStats> => {
    const baseToolStats = TUTORIAL_SURVEY_TOOLS.reduce((acc, item) => {
        acc[item.id] = { usedCount: 0, needTutorialCount: 0, priorityScore: 0 };
        return acc;
    }, {} as Record<TutorialSurveyToolId, ToolStat>);

    const q = query(collection(db, SURVEY_COLLECTION), where('type', '==', 'tutorialSurvey'));
    const snapshot = await getDocs(q);
    const rows = snapshot.docs
        .map(d => d.data() as any)
        .filter(row => row.surveyKey === surveyKey);

    const formatStats: Record<string, number> = {};
    const frequencyStats: Record<string, number> = {};
    let totalNeedOverallTutorial = 0;
    let lastClientSubmittedAt: string | null = null;

    rows.forEach((row: any) => {
        const usedTools = toUniqueTools(safeArray(row.usedTools) as TutorialSurveyToolId[]);
        const needTutorialTools = toUniqueTools(safeArray(row.needTutorialTools) as TutorialSurveyToolId[]);
        const priorityTop3 = toUniqueTools(safeArray(row.priorityTop3) as TutorialSurveyToolId[]);

        usedTools.forEach(toolId => {
            if (baseToolStats[toolId]) baseToolStats[toolId].usedCount += 1;
        });
        needTutorialTools.forEach(toolId => {
            if (baseToolStats[toolId]) baseToolStats[toolId].needTutorialCount += 1;
        });
        priorityTop3.forEach((toolId) => {
            if (!baseToolStats[toolId]) return;
            baseToolStats[toolId].priorityScore += 1;
        });

        safeArray(row.tutorialFormats).forEach((fmt: string) => {
            if (!fmt) return;
            formatStats[fmt] = (formatStats[fmt] || 0) + 1;
        });

        if (typeof row.usageFrequency === 'string' && row.usageFrequency) {
            frequencyStats[row.usageFrequency] = (frequencyStats[row.usageFrequency] || 0) + 1;
        }

        if (row.needOverallTutorial) totalNeedOverallTutorial += 1;
        if (typeof row.clientSubmittedAt === 'string') {
            if (!lastClientSubmittedAt || row.clientSubmittedAt > lastClientSubmittedAt) {
                lastClientSubmittedAt = row.clientSubmittedAt;
            }
        }
    });

    return {
        totalResponses: rows.length,
        totalNeedOverallTutorial,
        toolStats: baseToolStats,
        formatStats,
        frequencyStats,
        lastClientSubmittedAt,
    };
};
