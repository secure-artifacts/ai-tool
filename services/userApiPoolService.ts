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
    private failedKeys: Set<string> = new Set();
    private userId: string | null = null;
    private unsubscribe: (() => void) | null = null;

    /**
     * 从 Firebase 加载用户 API 池
     */
    async load(userId: string): Promise<void> {
        this.userId = userId;
        this.keys = await loadUserApiPool(userId);
        this.currentIndex = 0;
        this.failedKeys.clear();
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
        this.failedKeys.delete(apiKey);
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
        while (this.failedKeys.has(this.keys[this.currentIndex].apiKey) && attempts < this.keys.length) {
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;
            attempts++;
        }

        if (attempts >= this.keys.length) {
            console.warn('[User API Pool] All keys failed, resetting...');
            this.failedKeys.clear();
            this.currentIndex = 0;
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
            this.failedKeys.add(currentKey);
        }
        this.rotateToNext();
    }

    /**
     * 标记指定密钥为失败
     */
    markKeyAsFailed(key: string): void {
        this.failedKeys.add(key);
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
    }
}

/**
 * 获取当前登录用户的 ID
 */
export function getCurrentUserId(): string | null {
    return auth.currentUser?.uid || null;
}
