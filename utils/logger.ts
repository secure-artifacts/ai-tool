/**
 * 统一日志工具
 * 在生产环境中禁用调试日志，保留错误日志
 */

const isDev = import.meta.env?.DEV ?? process.env.NODE_ENV !== 'production';

export const logger = {
    /**
     * 调试日志 - 仅在开发环境输出
     */
    debug: (...args: unknown[]) => {
        if (isDev) {
            console.log('[DEBUG]', ...args);
        }
    },

    /**
     * 信息日志 - 仅在开发环境输出
     */
    info: (...args: unknown[]) => {
        if (isDev) {
            console.log('[INFO]', ...args);
        }
    },

    /**
     * 警告日志 - 始终输出
     */
    warn: (...args: unknown[]) => {
        console.warn('[WARN]', ...args);
    },

    /**
     * 错误日志 - 始终输出
     */
    error: (...args: unknown[]) => {
        console.error('[ERROR]', ...args);
    }
};

export default logger;
