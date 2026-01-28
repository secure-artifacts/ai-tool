/**
 * Firebase API Key Pool Service
 * 从 Firestore 读取和管理共享 API 密钥池
 */

import { doc, getDoc, setDoc, collection, getDocs, onSnapshot } from 'firebase/firestore';
import { db } from '@/firebase/index';

export interface FirebaseApiKeyEntry {
    apiKey: string;
    nickname?: string;
    status?: 'active' | 'disabled' | 'quota_exceeded';
    addedAt?: any;
}

/**
 * 从 Firestore 加载共享 API 池
 * 数据存储在 sharedConfig/apiPool 文档中
 */
export async function loadSharedApiPool(): Promise<FirebaseApiKeyEntry[]> {
    try {
        const docRef = doc(db, 'sharedConfig', 'apiPool');
        const docSnap = await getDoc(docRef);

        if (docSnap.exists()) {
            const data = docSnap.data();
            const keys = (data.keys || []) as FirebaseApiKeyEntry[];
            // 过滤掉已禁用的密钥
            return keys.filter(k => k.status !== 'disabled');
        }
        return [];
    } catch (error) {
        console.error('[Firebase API Pool] Failed to load shared pool:', error);
        return [];
    }
}

/**
 * 保存共享 API 池到 Firestore
 * 仅管理员可以调用此函数
 */
export async function saveSharedApiPool(keys: FirebaseApiKeyEntry[]): Promise<void> {
    const docRef = doc(db, 'sharedConfig', 'apiPool');
    await setDoc(docRef, {
        keys,
        updatedAt: new Date()
    });
}

/**
 * 订阅共享 API 池变化（实时更新）
 */
export function subscribeToSharedApiPool(
    callback: (keys: FirebaseApiKeyEntry[]) => void
): () => void {
    const docRef = doc(db, 'sharedConfig', 'apiPool');

    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            const data = docSnap.data();
            const keys = (data.keys || []) as FirebaseApiKeyEntry[];
            callback(keys.filter(k => k.status !== 'disabled'));
        } else {
            callback([]);
        }
    });
}

/**
 * Firebase API 密钥池管理类
 */
export class FirebaseApiKeyPool {
    private keys: FirebaseApiKeyEntry[] = [];
    private currentIndex: number = 0;
    private failedKeys: Set<string> = new Set();
    private unsubscribe: (() => void) | null = null;

    /**
     * 从 Firestore 加载 API 池
     */
    async load(): Promise<void> {
        this.keys = await loadSharedApiPool();
        this.currentIndex = 0;
        this.failedKeys.clear();
        console.log(`[Firebase API Pool] Loaded ${this.keys.length} API keys`);
    }

    /**
     * 订阅实时更新
     */
    subscribeToUpdates(onUpdate?: () => void): void {
        this.unsubscribe = subscribeToSharedApiPool((keys) => {
            this.keys = keys;
            console.log(`[Firebase API Pool] Updated: ${keys.length} keys`);
            onUpdate?.();
        });
    }

    /**
     * 取消订阅
     */
    unsubscribeFromUpdates(): void {
        if (this.unsubscribe) {
            this.unsubscribe();
            this.unsubscribe = null;
        }
    }

    /**
     * 获取当前 API 密钥
     */
    getCurrentKey(): string {
        if (this.keys.length === 0) {
            throw new Error('No API keys available in pool');
        }

        // 跳过已失败的密钥
        let attempts = 0;
        while (this.failedKeys.has(this.keys[this.currentIndex].apiKey) && attempts < this.keys.length) {
            this.currentIndex = (this.currentIndex + 1) % this.keys.length;
            attempts++;
        }

        // 如果所有密钥都失败，重置
        if (attempts >= this.keys.length) {
            console.warn('[Firebase API Pool] All keys failed, resetting...');
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
        console.log(`[Firebase API Pool] Rotated to key ${this.currentIndex + 1}/${this.keys.length}`);
    }

    /**
     * 标记当前密钥为失败
     */
    markCurrentAsFailed(): void {
        const currentKey = this.keys[this.currentIndex]?.apiKey;
        if (currentKey) {
            this.failedKeys.add(currentKey);
            console.warn(`[Firebase API Pool] Marked key as failed: ${currentKey.substring(0, 10)}...`);
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
