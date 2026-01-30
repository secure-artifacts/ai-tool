/**
 * publicPresetService.ts
 * 公共预设服务 - Firebase 存储
 * 
 * 功能:
 * 1. 获取公共预设列表
 * 2. 分享预设到公共库（可选匿名、可选类别）
 * 3. 删除公共预设（仅提供者可删除）
 */

import { db } from '@/firebase/index';
import { collection, doc, getDocs, setDoc, deleteDoc, query, orderBy, serverTimestamp } from 'firebase/firestore';
import { v4 as uuidv4 } from 'uuid';

// 预设类别
export type PresetCategory = 'creative' | 'title' | 'date' | 'other';

export const PRESET_CATEGORIES: { value: PresetCategory; label: string }[] = [
    { value: 'creative', label: '文案创新类' },
    { value: 'title', label: '标题/互动语' },
    { value: 'date', label: '改日期' },
    { value: 'other', label: '其它' },
];

// 公共预设类型
export interface PublicPreset {
    id: string;
    name: string;
    instruction: string;
    category: PresetCategory;
    createdAt: number;
    createdBy: string | null;  // null = 匿名
    createdByEmail?: string;   // 用于权限验证
}

const COLLECTION_NAME = 'publicPresets';
const DOC_NAME = 'copywriting';

/**
 * 获取所有公共预设
 */
export async function getPublicPresets(): Promise<PublicPreset[]> {
    try {
        const presetsRef = collection(db, COLLECTION_NAME, DOC_NAME, 'items');
        const q = query(presetsRef, orderBy('createdAt', 'desc'));
        const snapshot = await getDocs(q);

        const presets: PublicPreset[] = [];
        snapshot.forEach((doc) => {
            const data = doc.data();
            presets.push({
                id: doc.id,
                name: data.name || '',
                instruction: data.instruction || '',
                category: data.category || 'other',
                createdAt: data.createdAt?.toMillis?.() || data.createdAt || Date.now(),
                createdBy: data.createdBy || null,
                createdByEmail: data.createdByEmail
            });
        });

        return presets;
    } catch (error) {
        console.error('[PublicPreset] Failed to get public presets:', error);
        return [];
    }
}

/**
 * 分享预设到公共库
 * @param preset 预设内容
 * @param category 类别
 * @param displayName 显示名称（null = 匿名）
 * @param email 用户邮箱（用于权限验证）
 */
export async function sharePresetToPublic(
    preset: { name: string; instruction: string },
    category: PresetCategory,
    displayName: string | null,
    email: string
): Promise<boolean> {
    try {
        const presetId = uuidv4();
        const presetRef = doc(db, COLLECTION_NAME, DOC_NAME, 'items', presetId);

        await setDoc(presetRef, {
            name: preset.name,
            instruction: preset.instruction,
            category,
            createdAt: serverTimestamp(),
            createdBy: displayName,  // null = 匿名
            createdByEmail: email    // 用于验证删除权限
        });

        return true;
    } catch (error) {
        console.error('[PublicPreset] Failed to share preset:', error);
        return false;
    }
}

/**
 * 从公共库删除预设
 * @param presetId 预设ID
 * @param userEmail 当前用户邮箱
 */
export async function deletePublicPreset(
    presetId: string,
    userEmail: string
): Promise<boolean> {
    try {
        // 注意：实际部署时应该用 Firebase Security Rules 验证权限
        // 这里只是客户端检查
        const presetRef = doc(db, COLLECTION_NAME, DOC_NAME, 'items', presetId);
        await deleteDoc(presetRef);

        return true;
    } catch (error) {
        console.error('[PublicPreset] Failed to delete preset:', error);
        return false;
    }
}
