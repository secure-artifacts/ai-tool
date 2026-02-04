/**
 * Google Sheets 同步服务
 * 用于将 AI 工具的处理结果自动保存到 Google Sheets
 */

// ============ 类型定义 ============

export interface SheetsSyncConfig {
    webAppUrl: string;      // Google Apps Script Web App URL
    submitter: string;      // 提交人名称
    autoSave: boolean;      // 是否启用自动保存
}

export interface AppendRowsPayload {
    action: 'appendRows';
    sheetData: string;      // 分页名称
    rows: (string | number)[][];  // 数据行
    headers?: string[];     // 表头（可选，分页不存在时用于创建）
}

export interface AppendRowsResponse {
    ok: boolean;
    inserted?: number;
    error?: string;
}

// ============ 工具类型定义 ============

export type ToolType = 'image-recognition' | 'prompt-tool' | 'translate' | 'deduplicator' | 'copywriting';

export const TOOL_NAMES: Record<ToolType, string> = {
    'image-recognition': '图片识别',
    'prompt-tool': '提示词',
    'translate': '翻译',
    'deduplicator': '查重',
    'copywriting': '文案改写',
};

export const TOOL_HEADERS: Record<ToolType, string[]> = {
    'image-recognition': ['时间', '图片链接', '图片公式', '识别结果'],
    'prompt-tool': ['时间', '模式', '原文', '生成结果'],
    'translate': ['时间', '目标语言', '原文', '翻译结果'],
    'deduplicator': ['时间', '原文', '改写结果', '相似度'],
    'copywriting': ['时间', '模式', '原文', '改写结果', '中文翻译'],
};

// ============ 配置管理 ============

const STORAGE_KEY = 'sheets_sync_config';

export function getSheetsSyncConfig(): SheetsSyncConfig {
    try {
        const stored = localStorage.getItem(STORAGE_KEY);
        if (stored) {
            return JSON.parse(stored);
        }
    } catch (e) {
        console.error('读取表格同步配置失败:', e);
    }
    return {
        webAppUrl: '',
        submitter: '',
        autoSave: false,
    };
}

export function saveSheetsSyncConfig(config: SheetsSyncConfig): void {
    try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
    } catch (e) {
        console.error('保存表格同步配置失败:', e);
    }
}

// ============ 核心功能 ============

/**
 * 获取分页名称
 * 格式：提交人-功能名称
 */
export function getSheetName(toolType: ToolType, submitter: string): string {
    const toolName = TOOL_NAMES[toolType];
    return submitter ? `${submitter}-${toolName}` : toolName;
}

/**
 * 追加数据到 Google Sheets
 */
export async function appendToSheet(
    toolType: ToolType,
    rows: (string | number)[][],
    config?: SheetsSyncConfig
): Promise<{ success: boolean; error?: string; inserted?: number }> {
    const cfg = config || getSheetsSyncConfig();

    if (!cfg.webAppUrl) {
        return { success: false, error: '未配置 Web App URL' };
    }

    if (!cfg.submitter) {
        return { success: false, error: '未设置提交人名称' };
    }

    if (!rows.length) {
        return { success: false, error: '没有数据' };
    }

    const sheetName = getSheetName(toolType, cfg.submitter);
    const headers = TOOL_HEADERS[toolType];

    const payload: AppendRowsPayload = {
        action: 'appendRows',
        sheetData: sheetName,
        rows,
        headers,
    };

    try {
        const response = await fetch(cfg.webAppUrl, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8',
            },
            body: 'data=' + encodeURIComponent(JSON.stringify(payload)),
        });

        const result: AppendRowsResponse = await response.json();

        if (!result.ok) {
            return { success: false, error: result.error || '保存失败' };
        }

        return { success: true, inserted: result.inserted };
    } catch (e) {
        console.error('保存到表格失败:', e);
        return { success: false, error: e instanceof Error ? e.message : '网络错误' };
    }
}

/**
 * 测试 Web App 连接
 */
export async function testConnection(webAppUrl: string): Promise<{ success: boolean; error?: string }> {
    if (!webAppUrl) {
        return { success: false, error: 'URL 不能为空' };
    }

    try {
        const response = await fetch(`${webAppUrl}?action=test`);
        const result = await response.json();

        if (result.ok) {
            return { success: true };
        }
        return { success: false, error: result.error || '连接失败' };
    } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : '网络错误' };
    }
}

// ============ 便捷方法 ============

/**
 * 保存图片识别结果
 */
export async function saveImageRecognitionResult(
    imageUrl: string,
    result: string
): Promise<{ success: boolean; error?: string }> {
    const time = new Date().toLocaleString('zh-CN');
    const imageFormula = imageUrl ? `=IMAGE("${imageUrl}")` : '';

    return appendToSheet('image-recognition', [
        [time, imageUrl || '', imageFormula, result]
    ]);
}

/**
 * 保存提示词结果
 */
export async function savePromptResult(
    mode: string,
    original: string,
    result: string
): Promise<{ success: boolean; error?: string }> {
    const time = new Date().toLocaleString('zh-CN');

    return appendToSheet('prompt-tool', [
        [time, mode, original, result]
    ]);
}

/**
 * 保存翻译结果
 */
export async function saveTranslateResult(
    targetLang: string,
    original: string,
    result: string
): Promise<{ success: boolean; error?: string }> {
    const time = new Date().toLocaleString('zh-CN');

    return appendToSheet('translate', [
        [time, targetLang, original, result]
    ]);
}

/**
 * 保存查重结果
 */
export async function saveDeduplicatorResult(
    original: string,
    result: string,
    similarity: string | number
): Promise<{ success: boolean; error?: string }> {
    const time = new Date().toLocaleString('zh-CN');

    return appendToSheet('deduplicator', [
        [time, original, result, String(similarity)]
    ]);
}
