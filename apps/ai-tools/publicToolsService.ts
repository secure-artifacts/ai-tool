/**
 * Public AI Tools Service - 社区分享功能
 * 使用 Firestore 存储公共工具库
 */

import {
    collection,
    doc,
    getDocs,
    addDoc,
    deleteDoc,
    query,
    orderBy,
    serverTimestamp,
    Timestamp
} from 'firebase/firestore';
import { db } from '@/firebase/index';
import { AITool } from './types';

// Firestore collection name
const COLLECTION_NAME = 'publicAITools';

export interface SharedAITool extends AITool {
    sharedAt: Timestamp;
    sharedBy?: string;        // Display name (optional)
    sharedByEmail: string;    // Email for ownership verification
    docId?: string;           // Firestore document ID
}

/**
 * Load all public tools from Firestore
 */
export const loadPublicTools = async (): Promise<SharedAITool[]> => {
    try {
        const colRef = collection(db, COLLECTION_NAME);
        const q = query(colRef, orderBy('sharedAt', 'desc'));
        const snapshot = await getDocs(q);

        return snapshot.docs.map(doc => ({
            ...doc.data() as SharedAITool,
            docId: doc.id
        }));
    } catch (error) {
        console.error('Failed to load public tools:', error);
        return [];
    }
};

/**
 * Share a tool to the public library
 */
export const shareToolToPublic = async (
    tool: AITool,
    userEmail: string,
    displayName?: string
): Promise<string> => {
    try {
        const colRef = collection(db, COLLECTION_NAME);

        const sharedTool: Omit<SharedAITool, 'docId'> = {
            ...tool,
            id: `shared-${Date.now()}`, // Generate new ID for shared version
            sharedAt: serverTimestamp() as Timestamp,
            sharedByEmail: userEmail,
            sharedBy: displayName || undefined,
            isCustom: false // Public tools are not marked as custom
        };

        const docRef = await addDoc(colRef, sharedTool);
        return docRef.id;
    } catch (error) {
        console.error('Failed to share tool:', error);
        throw new Error('分享失败，请稍后重试');
    }
};

/**
 * Delete a shared tool (only by owner)
 */
export const deleteSharedTool = async (
    docId: string,
    userEmail: string,
    tool: SharedAITool
): Promise<void> => {
    // Verify ownership
    if (tool.sharedByEmail !== userEmail) {
        throw new Error('只能删除自己分享的工具');
    }

    try {
        const docRef = doc(db, COLLECTION_NAME, docId);
        await deleteDoc(docRef);
    } catch (error) {
        console.error('Failed to delete shared tool:', error);
        throw new Error('删除失败，请稍后重试');
    }
};

/**
 * Check if user can delete a tool
 */
export const canDeleteTool = (tool: SharedAITool, userEmail: string): boolean => {
    return tool.sharedByEmail === userEmail;
};
