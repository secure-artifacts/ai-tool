/**
 * User API Pool Firebase Service
 * 用户个人 API 池的 Firebase 同步
 */

import { doc, getDoc, setDoc, onSnapshot, serverTimestamp } from 'firebase/firestore';
import { db } from '@/firebase/index';
import { auth } from '@/firebase/index';

export interface UserApiKeyEntry {
    apiKey: string;
    nickname?: string;
    status?: 'active' | 'disabled' | 'quota_exceeded';
}

/**
 * 加载用户的个人 API 池
 */
export async function loadUserApiPool(userId: string): Promise<UserApiKeyEntry[]> {
    try {
        const docRef = doc(db, 'users', userId, 'apiKeys', 'pool');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const keys = (data.keys || []) as UserApiKeyEntry[];
            return keys.filter(k => k.status !== 'disabled');
        }
        return [];
    } catch (error) {
        console.error('[User API Pool] Failed to load:', error);
        return [];
    }
}

/**
 * 保存用户的个人 API 池
 */
export async function saveUserApiPool(userId: string, keys: UserApiKeyEntry[]): Promise<void> {
    try {
        const docRef = doc(db, 'users', userId, 'apiKeys', 'pool');
        await setDoc(docRef, {
            keys,
            updatedAt: serverTimestamp()
        });
        // console.log('[User API Pool] Saved to Firebase');
    } catch (error) {
        console.error('[User API Pool] Failed to save:', error);
        throw error;
    }
}

/**
 * 订阅用户 API 池变化（实时同步）
 */
export function subscribeToUserApiPool(
    userId: string,
    callback: (keys: UserApiKeyEntry[]) => void
): () => void {
    const docRef = doc(db, 'users', userId, 'apiKeys', 'pool');

    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const keys = (data.keys || []) as UserApiKeyEntry[];
            callback(keys.filter(k => k.status !== 'disabled'));
        } else {
            callback([]);
        }
    }, (error) => {
        console.error('[User API Pool] Subscription error:', error);
        callback([]);
    });
}

/**
 * 用户 API 密钥池管理类
 */
export class UserApiKeyPool {
    private keys: UserApiKeyEntry[] = [];
    private currentIndex: number = 0;
    private keyStats: Map<string, { failedAt: number | null; failReason: string }> = new Map();
    private userId: string | null = null;
    private unsubscribe: (() => void) | null = null;
    private cooldownMs: number = 60000;

    private ensureStats(key: string): { failedAt: number | null; failReason: string } {
        if (!this.keyStats.has(key)) {
            this.keyStats.set(key, { failedAt: null, failReason: '' });
        }
        return this.keyStats.get(key)!;
    }

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
     * 从 Firebase 加载用户 API 池
     */
    async load(userId: string): Promise<void> {
        this.userId = userId;
        this.keys = await loadUserApiPool(userId);
        this.currentIndex = 0;
        this.keyStats.clear();
        this.keys.forEach(entry => this.ensureStats(entry.apiKey));
        // console.log(`[User API Pool] Loaded ${this.keys.length} keys for user ${userId}`);
    }

    /**
     * 保存到 Firebase
     */
    async save(): Promise<void> {
        if (!this.userId) return;
        await saveUserApiPool(this.userId, this.keys);
    }

    /**
     * 添加 API Key
     */
    async addKey(apiKey: string, nickname?: string): Promise<void> {
        // 检查是否已存在
        if (this.keys.some(k => k.apiKey === apiKey)) {
            console.warn('[User API Pool] Key already exists');
            return;
        }
        this.keys.push({ apiKey, nickname, status: 'active' });
        await this.save();
    }

    /**
     * 移除 API Key
     */
    async removeKey(apiKey: string): Promise<void> {
        this.keys = this.keys.filter(k => k.apiKey !== apiKey);
        this.keyStats.delete(apiKey);
        if (this.currentIndex >= this.keys.length) {
            this.currentIndex = 0;
        }
        await this.save();
    }

    /**
     * 获取当前 API 密钥
     */
    getCurrentKey(): string {
        if (this.keys.length === 0) {
            throw new Error('No API keys in pool');
        }

        let attempts = 0;
        while (this.isKeyExhausted(this.keys[this.currentIndex].apiKey) && attempts < this.keys.length) {
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;
            attempts++;
        }

        if (attempts >= this.keys.length) {
            let earliestIdx = 0;
            let earliestTime = Infinity;
            this.keys.forEach((entry, idx) => {
                const stats = this.keyStats.get(entry.apiKey);
                if (stats?.failedAt && stats.failedAt < earliestTime) {
                    earliestTime = stats.failedAt;
                    earliestIdx = idx;
                }
            });
            this.currentIndex = earliestIdx;
            console.warn('[User API Pool] 所有 key 都在冷却中，回退到最早恢复的 key');
        }

        return this.keys[this.currentIndex].apiKey;
    }

    /**
     * 获取当前密钥昵称
     */
    getCurrentNickname(): string | undefined {
        if (this.keys.length === 0) return undefined;
        return this.keys[this.currentIndex].nickname;
    }

    /**
     * 轮换到下一个密钥
     */
    rotateToNext(): void {
        if (this.keys.length <= 1) return;
        this.currentIndex = (this.currentIndex + 1) % this.keys.length;
        // console.log(`[User API Pool] Rotated to key ${this.currentIndex + 1}/${this.keys.length}`);
    }

    /**
     * 标记当前密钥为失败
     */
    markCurrentAsFailed(): void {
        const currentKey = this.keys[this.currentIndex]?.apiKey;
        if (currentKey) {
            this.markKeyAsFailed(currentKey);
        }
        this.rotateToNext();
    }

    /**
     * 标记指定密钥为失败
     */
    markKeyAsFailed(key: string, reason: string = '额度用完'): void {
        if (!key) return;
        const stats = this.ensureStats(key);
        stats.failedAt = Date.now();
        stats.failReason = reason;
    }

    /**
     * 检查是否有可用密钥
     */
    hasKeys(): boolean {
        return this.keys.length > 0;
    }

    /**
     * 获取所有密钥（用于显示）
     */
    getAllKeys(): UserApiKeyEntry[] {
        return [...this.keys];
    }

    /**
     * 获取池状态
     */
    getStatus(): {
        total: number;
        current: number;
        failed: number;
        currentNickname?: string;
    } {
        const failed = this.keys.filter(entry => this.isKeyExhausted(entry.apiKey)).length;
        return {
            total: this.keys.length,
            current: this.currentIndex + 1,
            failed,
            currentNickname: this.getCurrentNickname()
        };
    }

    /**
     * 清除失败标记
     */
    clearFailedMarks(): void {
        this.keyStats.forEach(stats => {
            stats.failedAt = null;
            stats.failReason = '';
        });
    }

    /**
     * 强制重置所有密钥状态
     */
    forceResetAll(): void {
        this.clearFailedMarks();
        this.currentIndex = 0;
    }

    /**
     * 记录 API 调用次数
     */
    recordCall(key?: string): void {
        const targetKey = key || (this.keys.length > 0 ? this.keys[this.currentIndex]?.apiKey : null);
        if (!targetKey) return;
        const today = new Date().toISOString().slice(0, 10);
        const storageKey = `api_call_count_${today}_${targetKey.substring(0, 12)}`;
        const current = parseInt(localStorage.getItem(storageKey) || '0', 10);
        localStorage.setItem(storageKey, String(current + 1));
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
        cooldownRemaining: number;
        modelUsage: Record<string, number>;
    }> {
        const today = new Date().toISOString().slice(0, 10);
        return this.keys.map((entry, idx) => {
            const storageKey = `api_call_count_${today}_${entry.apiKey.substring(0, 12)}`;
            const callCount = parseInt(localStorage.getItem(storageKey) || '0', 10);
            const stats = this.ensureStats(entry.apiKey);
            const isExhausted = this.isKeyExhausted(entry.apiKey);
            const cooldownRemaining = stats.failedAt
                ? Math.max(0, Math.ceil((this.cooldownMs - (Date.now() - stats.failedAt)) / 1000))
                : 0;
            return {
                index: idx + 1,
                nickname: entry.nickname || `Key ${idx + 1}`,
                keyPrefix: entry.apiKey.substring(0, 8) + '...',
                callCount,
                isExhausted,
                failedAt: stats.failedAt ? new Date(stats.failedAt).toISOString() : null,
                failReason: stats.failReason,
                cooldownRemaining,
                modelUsage: {},
            };
        });
    }
}

/**
 * 获取当前登录用户的 ID
 */
export function getCurrentUserId(): string | null {
    return auth.currentUser?.uid || null;
}
