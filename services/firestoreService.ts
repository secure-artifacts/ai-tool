// Firestore Data Sync Service
import {
    doc,
    getDoc,
    setDoc,
    updateDoc,
    collection,
    query,
    getDocs,
    deleteDoc,
    onSnapshot,
    serverTimestamp
} from 'firebase/firestore';
import { db } from '@/firebase/index';

// Types
export interface UserSettings {
    uiScale: number;
    fontScale: number;
    theme: 'dark' | 'light';
    language: 'zh' | 'en';
    textModel: string;
    imageModel: string;
    updatedAt?: any;
}

export interface UserPreset {
    id: string;
    category: string;
    label: string;
    prompt: string;
    order: number;
}

// ==================== User Settings ====================

/**
 * Save user settings to Firestore
 */
export const saveUserSettings = async (
    userId: string,
    settings: Partial<UserSettings>
): Promise<void> => {
    const docRef = doc(db, 'users', userId, 'settings', 'preferences');
    await setDoc(docRef, {
        ...settings,
        updatedAt: serverTimestamp()
    }, { merge: true });
};

/**
 * Load user settings from Firestore
 */
export const loadUserSettings = async (
    userId: string
): Promise<UserSettings | null> => {
    const docRef = doc(db, 'users', userId, 'settings', 'preferences');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data() as UserSettings;
    }
    return null;
};

/**
 * Subscribe to user settings changes (real-time)
 */
export const subscribeToUserSettings = (
    userId: string,
    callback: (settings: UserSettings | null) => void
): (() => void) => {
    const docRef = doc(db, 'users', userId, 'settings', 'preferences');

    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            callback(docSnap.data() as UserSettings);
        } else {
            callback(null);
        }
    });
};

// ==================== Presets ====================

/**
 * Save presets to Firestore
 */
export const savePresets = async (
    userId: string,
    scope: string,
    presets: any
): Promise<void> => {
    const docRef = doc(db, 'users', userId, 'presets', scope);
    await setDoc(docRef, {
        data: presets,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load presets from Firestore
 */
export const loadPresets = async (
    userId: string,
    scope: string
): Promise<any | null> => {
    const docRef = doc(db, 'users', userId, 'presets', scope);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().data;
    }
    return null;
};

/**
 * Subscribe to presets changes (real-time)
 */
export const subscribeToPresets = (
    userId: string,
    scope: string,
    callback: (presets: any | null) => void
): (() => void) => {
    const docRef = doc(db, 'users', userId, 'presets', scope);

    return onSnapshot(docRef, (docSnap) => {
        if (docSnap.exists()) {
            callback(docSnap.data().data);
        } else {
            callback(null);
        }
    });
};

// ==================== API Keys ====================

/**
 * Save API keys to Firestore
 */
export const saveApiKeys = async (
    userId: string,
    keys: { apiKey: string; nickname?: string; status?: string }[]
): Promise<void> => {
    const docRef = doc(db, 'users', userId, 'apiKeys', 'pool');
    await setDoc(docRef, {
        keys,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load API keys from Firestore
 */
export const loadApiKeys = async (
    userId: string
): Promise<{ apiKey: string; nickname?: string; status?: string }[] | null> => {
    const docRef = doc(db, 'users', userId, 'apiKeys', 'pool');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().keys;
    }
    return null;
};

// ==================== Templates ====================

/**
 * Save templates to Firestore
 */
export const saveTemplates = async (
    userId: string,
    templates: any
): Promise<void> => {
    const docRef = doc(db, 'users', userId, 'templates', 'data');
    await setDoc(docRef, {
        templates,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load templates from Firestore
 */
export const loadTemplates = async (
    userId: string
): Promise<any | null> => {
    const docRef = doc(db, 'users', userId, 'templates', 'data');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().templates;
    }
    return null;
};

// ==================== Gallery Config ====================

/**
 * Save gallery config to Firestore
 */
export const saveGalleryConfig = async (
    userId: string,
    configName: string,
    config: any
): Promise<void> => {
    const docRef = doc(db, 'users', userId, 'galleryConfigs', configName);
    await setDoc(docRef, {
        data: config,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load gallery config from Firestore
 */
export const loadGalleryConfig = async (
    userId: string,
    configName: string
): Promise<any | null> => {
    const docRef = doc(db, 'users', userId, 'galleryConfigs', configName);
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().data;
    }
    return null;
};

/**
 * List all gallery configs for a user
 */
export const listGalleryConfigs = async (
    userId: string
): Promise<{ name: string; updatedAt: any }[]> => {
    const colRef = collection(db, 'users', userId, 'galleryConfigs');
    const snapshot = await getDocs(query(colRef));

    return snapshot.docs.map(doc => ({
        name: doc.id,
        updatedAt: doc.data().updatedAt
    }));
};

/**
 * Delete gallery config from Firestore
 */
export const deleteGalleryConfig = async (
    userId: string,
    configName: string
): Promise<void> => {
    const docRef = doc(db, 'users', userId, 'galleryConfigs', configName);
    await deleteDoc(docRef);
};

// ==================== Category Presets ====================

export interface CategoryPreset {
    id: string;
    name: string;
    emoji: string;
    options: string[];
    createdAt?: any;
}

/**
 * Save category presets to Firestore
 */
export const saveCategoryPresets = async (
    userId: string,
    presets: CategoryPreset[]
): Promise<void> => {
    const docRef = doc(db, 'users', userId, 'categoryPresets', 'data');
    await setDoc(docRef, {
        presets,
        updatedAt: serverTimestamp()
    });
};

/**
 * Load category presets from Firestore
 */
export const loadCategoryPresets = async (
    userId: string
): Promise<CategoryPreset[] | null> => {
    const docRef = doc(db, 'users', userId, 'categoryPresets', 'data');
    const docSnap = await getDoc(docRef);

    if (docSnap.exists()) {
        return docSnap.data().presets;
    }
    return null;
};
