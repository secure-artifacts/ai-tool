/**
 * 获取用户当前选择的全局文本模型
 * 
 * 所有模块在没有收到 textModel prop 时，
 * 可从这里读取用户在设置面板选择的模型。
 * 
 * 优先级：传入参数 > localStorage > 默认值
 */

const DEFAULT_TEXT_MODEL = 'gemini-3.1-flash-lite';
const STORAGE_KEY = 'app_text_model';

export function getGlobalTextModel(override?: string): string {
    if (override) return override;
    try {
        return localStorage.getItem(STORAGE_KEY) || DEFAULT_TEXT_MODEL;
    } catch {
        return DEFAULT_TEXT_MODEL;
    }
}
