/**
 * API Key Pool Service
 * 从Google Sheets读取和管理多个API密钥，实现自动轮换
 */

export interface ApiKeyRow {
    user: string;
    apiKey: string;
    status?: string;
    nickname?: string;
}

export interface ApiPoolConfig {
    sheetId: string;
    sheetName?: string; // 默认 'ApiKeys'
}

const DEFAULT_SHEET_NAME = 'ApiKeys';

const getSafeString = (value: any): string => {
    if (value === null || value === undefined) return '';
    return String(value).trim();
};

const isLikelyHeaderValue = (value: string): boolean => {
    const normalized = value.trim().toLowerCase();
    return normalized === 'apikey' || normalized === 'api key' || normalized === 'key';
};

/**
 * 从Google Sheet读取用户的API密钥列表
 */
export async function fetchUserApiKeys(
    userName: string,
    config: ApiPoolConfig
): Promise<ApiKeyRow[]> {
    const normalizedUser = getSafeString(userName).toLowerCase();
    if (!normalizedUser) return [];
    if (!config.sheetId) throw new Error('未配置API池的表格 ID');

    const sheetName = encodeURIComponent(config.sheetName || DEFAULT_SHEET_NAME);
    const escapedUser = normalizedUser.replace(/'/g, "''");
    const query = encodeURIComponent(`select * where lower(A)='${escapedUser}'`);
    const url = `https://docs.google.com/spreadsheets/d/${config.sheetId}/gviz/tq?tq=${query}&sheet=${sheetName}&tqx=out:json&_=${Date.now()}`;

    const response = await fetch(url);
    if (!response.ok) {
        throw new Error(`读取API密钥表格失败: ${response.statusText}`);
    }

    const text = await response.text();
    const jsonString = text.substring(text.indexOf('{'), text.lastIndexOf('}') + 1);
    const json = JSON.parse(jsonString);

    if (json.status === 'error') {
        const message = (json.errors?.[0]?.message || '表格返回错误').trim();
        if (message.toUpperCase() === 'INVALID_QUERY') {
            console.warn(
                'Google Sheet query returned INVALID_QUERY. Check sheet name/header configuration.',
                { sheetId: config.sheetId, sheetName: config.sheetName || DEFAULT_SHEET_NAME, user: normalizedUser }
            );
            return [];
        }
        throw new Error(message);
    }

    const rows = (json.table.rows || []) as any[];
    return rows
        .map((r) => {
            const cells = r.c || [];
            return {
                user: getSafeString(cells[0]?.v),
                apiKey: getSafeString(cells[1]?.v),
                status: getSafeString(cells[2]?.v),
                nickname: getSafeString(cells[3]?.v)
            } as ApiKeyRow;
        })
        .filter((row) => {
            // 只返回有效的API密钥，且状态不是 'disabled'
            return row.apiKey &&
                (!row.status || row.status.toLowerCase() !== 'disabled');
        });
}

/**
 * 单个 Key 的运行时状态
 */
interface KeyStats {
    failedAt: number | null;  // 额度用完的时间戳（ms），null = 正常
    failReason: string;       // 失败原因
}

// ===== 按天持久化调用次数（localStorage） =====
const DAILY_CALL_PREFIX = 'api_daily_calls_';

function getTodayKey(): string {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function getKeyId(apiKey: string): string {
    // 用 key 的前12位作为标识（避免存完整 key）
    return apiKey.substring(0, 12);
}

function getDailyCallCount(apiKey: string): number {
    try {
        const stored = localStorage.getItem(`${DAILY_CALL_PREFIX}${getTodayKey()}`);
        if (!stored) return 0;
        const data = JSON.parse(stored);
        return data[getKeyId(apiKey)] || 0;
    } catch { return 0; }
}

function incrementDailyCallCount(apiKey: string): number {
    try {
        const dateKey = `${DAILY_CALL_PREFIX}${getTodayKey()}`;
        const stored = localStorage.getItem(dateKey);
        const data = stored ? JSON.parse(stored) : {};
        const keyId = getKeyId(apiKey);
        data[keyId] = (data[keyId] || 0) + 1;
        localStorage.setItem(dateKey, JSON.stringify(data));

        // 清理旧日期的数据（只保留最近3天）
        cleanOldDailyData();

        return data[keyId];
    } catch { return 0; }
}

function cleanOldDailyData(): void {
    try {
        const keys = Object.keys(localStorage).filter(k => k.startsWith(DAILY_CALL_PREFIX));
        const today = getTodayKey();
        const yesterday = (() => { const d = new Date(); d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; })();
        keys.forEach(k => {
            const dateStr = k.replace(DAILY_CALL_PREFIX, '');
            if (dateStr !== today && dateStr !== yesterday) {
                localStorage.removeItem(k);
            }
        });
    } catch { /* ignore */ }
}

/**
 * API密钥池管理类
 * 实现轮询策略、调用统计、额度追踪、冷却恢复
 */
export class ApiKeyPool {
    private keys: string[];
    private nicknames: Map<string, string>;
    private currentIndex: number;
    private keyStats: Map<string, KeyStats>;
    private cooldownMs: number; // 额度用完后的冷却时间（毫秒）

    constructor(keys: string[] = [], nicknames: Map<string, string> = new Map(), cooldownMs: number = 60000) {
        this.keys = keys;
        this.nicknames = nicknames;
        this.currentIndex = 0;
        this.keyStats = new Map();
        this.cooldownMs = cooldownMs;
        keys.forEach(k => this.ensureStats(k));
    }

    private ensureStats(key: string): KeyStats {
        if (!this.keyStats.has(key)) {
            this.keyStats.set(key, { failedAt: null, failReason: '' });
        }
        return this.keyStats.get(key)!;
    }

    /**
     * 判断 key 是否在冷却中（额度用完 + 冷却期未过）
     */
    private isKeyExhausted(key: string): boolean {
        const stats = this.keyStats.get(key);
        if (!stats || !stats.failedAt) return false;
        const elapsed = Date.now() - stats.failedAt;
        if (elapsed >= this.cooldownMs) {
            stats.failedAt = null;
            stats.failReason = '';
            return false;
        }
        return true;
    }

    /**
     * 从表格加载API密钥
     */
    async load(userName: string, config: ApiPoolConfig): Promise<void> {
        const rows = await fetchUserApiKeys(userName, config);

        const unique = new Map<string, ApiKeyRow>();
        for (const row of rows) {
            if (!row.apiKey || isLikelyHeaderValue(row.apiKey)) continue;
            if (!unique.has(row.apiKey)) {
                unique.set(row.apiKey, row);
            }
        }
        const uniqueRows = Array.from(unique.values());

        this.keys = uniqueRows.map(r => r.apiKey);
        this.nicknames = new Map(
            uniqueRows
                .filter(r => r.nickname)
                .map(r => [r.apiKey, r.nickname!])
        );
        this.currentIndex = 0;
        this.keys.forEach(k => this.ensureStats(k));
    }

    /**
     * 记录一次 API 调用（持久化到 localStorage，按天统计）
     */
    recordCall(key?: string): number {
        const k = key || this.keys[this.currentIndex];
        if (k) {
            return incrementDailyCallCount(k);
        }
        return 0;
    }

    /**
     * 获取指定 key 今日调用次数
     */
    getTodayCallCount(key?: string): number {
        const k = key || this.keys[this.currentIndex];
        return k ? getDailyCallCount(k) : 0;
    }

    /**
     * 获取当前API密钥（自动跳过已耗尽的 key）
     */
    getCurrentKey(): string {
        if (this.keys.length === 0) {
            throw new Error('API池中没有可用的密钥');
        }

        // 跳过已耗尽的 key
        let attempts = 0;
        while (this.isKeyExhausted(this.keys[this.currentIndex]) && attempts < this.keys.length) {
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;
            attempts++;
        }

        // 如果所有 key 都耗尽了，选冷却最早的（即将恢复的）
        if (attempts >= this.keys.length) {
            let earliestIdx = 0;
            let earliestTime = Infinity;
            this.keys.forEach((k, idx) => {
                const stats = this.keyStats.get(k);
                if (stats?.failedAt && stats.failedAt < earliestTime) {
                    earliestTime = stats.failedAt;
                    earliestIdx = idx;
                }
            });
            this.currentIndex = earliestIdx;
            console.warn('[ApiKeyPool] 所有 key 都已耗尽，使用冷却最久的 key');
        }

        return this.keys[this.currentIndex];
    }

    /**
     * 获取当前key的昵称
     */
    getCurrentNickname(): string | undefined {
        const currentKey = this.getCurrentKey();
        return this.nicknames.get(currentKey);
    }

    /**
     * 轮换到下一个密钥
     */
    rotateToNext(): void {
        if (this.keys.length <= 1) return;
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
    }

    /**
     * 标记 key 为额度耗尽（记录时间和原因）
     */
    markKeyAsFailed(key: string, reason: string = '额度用完'): void {
        if (key) {
            const stats = this.ensureStats(key);
            stats.failedAt = Date.now();
            stats.failReason = reason;
            const nick = this.nicknames.get(key) || key.substring(0, 10) + '...';
            console.warn(`[ApiKeyPool] 标记 ${nick} 为耗尽: ${reason}`);
        }
        this.rotateToNext();
    }

    /**
     * 标记当前key为失败并轮换
     */
    markCurrentAsFailed(reason: string = '额度用完'): void {
        const currentKey = this.keys[this.currentIndex];
        this.markKeyAsFailed(currentKey, reason);
    }

    /**
     * 强制重置指定 key（误报时手动恢复）
     */
    forceResetKey(key: string): void {
        const stats = this.keyStats.get(key);
        if (stats) {
            stats.failedAt = null;
            stats.failReason = '';
            const nick = this.nicknames.get(key) || key.substring(0, 10) + '...';
            console.log(`[ApiKeyPool] 强制重置 ${nick}，重新启用`);
        }
    }

    /**
     * 强制重置所有 key
     */
    forceResetAll(): void {
        this.keyStats.forEach(stats => {
            stats.failedAt = null;
            stats.failReason = '';
        });
        console.log('[ApiKeyPool] 已强制重置所有 key');
    }

    /**
     * 检查是否有可用的密钥
     */
    hasKeys(): boolean {
        return this.keys.length > 0;
    }

    /**
     * 获取池状态信息
     */
    getStatus(): {
        total: number;
        current: number;
        failed: number;
        currentNickname?: string;
    } {
        const exhaustedCount = this.keys.filter(k => this.isKeyExhausted(k)).length;
        return {
            total: this.keys.length,
            current: this.currentIndex + 1,
            failed: exhaustedCount,
            currentNickname: this.getCurrentNickname()
        };
    }

    /**
     * 获取每个 key 的详细状态
     */
    getDetailedStatus(): Array<{
        index: number;
        nickname: string;
        keyPrefix: string;
        callCount: number;
        isExhausted: boolean;
        failedAt: string | null;
        failReason: string;
        cooldownRemaining: number; // 剩余冷却秒数
    }> {
        return this.keys.map((key, idx) => {
            const stats = this.keyStats.get(key) || { failedAt: null, failReason: '' };
            const isExhausted = this.isKeyExhausted(key);
            const cooldownRemaining = stats.failedAt
                ? Math.max(0, Math.ceil((this.cooldownMs - (Date.now() - stats.failedAt)) / 1000))
                : 0;
            return {
                index: idx + 1,
                nickname: this.nicknames.get(key) || `Key ${idx + 1}`,
                keyPrefix: key.substring(0, 8) + '...',
                callCount: getDailyCallCount(key),
                isExhausted,
                failedAt: stats.failedAt ? new Date(stats.failedAt).toLocaleTimeString() : null,
                failReason: stats.failReason,
                cooldownRemaining,
            };
        });
    }

    /**
     * 设置冷却时间（秒）
     */
    setCooldownSeconds(seconds: number): void {
        this.cooldownMs = seconds * 1000;
    }

    /**
     * 清除失败标记（兼容旧接口）
     */
    clearFailedMarks(): void {
        this.forceResetAll();
    }
}
