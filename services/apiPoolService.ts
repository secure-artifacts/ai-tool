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
 * API密钥池管理类
 * 实现轮询策略和自动切换
 */
export class ApiKeyPool {
    private keys: string[];
    private nicknames: Map<string, string>;
    private currentIndex: number;
    private failedKeys: Set<string>;

    constructor(keys: string[] = [], nicknames: Map<string, string> = new Map()) {
        this.keys = keys;
        this.nicknames = nicknames;
        this.currentIndex = 0;
        this.failedKeys = new Set();
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
        this.failedKeys.clear();

        // console.log(`[ApiKeyPool] 加载了 ${this.keys.length} 个API密钥`);
    }

    /**
     * 获取当前API密钥
     */
    getCurrentKey(): string {
        if (this.keys.length === 0) {
            throw new Error('API池中没有可用的密钥');
        }

        // 如果当前key已失败，尝试找到下一个可用的
        let attempts = 0;
        while (this.failedKeys.has(this.keys[this.currentIndex]) && attempts < this.keys.length) {
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;
            attempts++;
        }

        // 如果所有key都失败了，重置失败记录并从头开始
        if (attempts >= this.keys.length) {
            console.warn('[ApiKeyPool] 所有API密钥都已失败，重置状态');
            this.failedKeys.clear();
            this.currentIndex = 0;
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
        // console.log(`[ApiKeyPool] 轮换到下一个密钥 (${this.currentIndex + 1}/${this.keys.length})`);
    }

    /**
     * 标记当前key为失败并轮换
     */
    markCurrentAsFailed(): void {
        const currentKey = this.keys[this.currentIndex];
        this.failedKeys.add(currentKey);
        console.warn(`[ApiKeyPool] 标记密钥为失败: ${currentKey.substring(0, 10)}...`);
        this.rotateToNext();
    }

    /**
     * 标记指定key为失败并轮换
     */
    markKeyAsFailed(key: string): void {
        if (key) {
            this.failedKeys.add(key);
            console.warn(`[ApiKeyPool] 标记密钥为失败: ${key.substring(0, 10)}...`);
        }
        this.rotateToNext();
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
        return {
            total: this.keys.length,
            current: this.currentIndex + 1,
            failed: this.failedKeys.size,
            currentNickname: this.getCurrentNickname()
        };
    }

    /**
     * 清除失败标记
     */
    clearFailedMarks(): void {
        this.failedKeys.clear();
        // console.log('[ApiKeyPool] 已清除所有失败标记');
    }
}
