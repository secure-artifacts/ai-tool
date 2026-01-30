// Firebase Authentication Service
import {
    signInWithPopup,
    signInWithEmailAndPassword,
    createUserWithEmailAndPassword,
    sendPasswordResetEmail as firebaseSendPasswordResetEmail,
    signOut as firebaseSignOut,
    onAuthStateChanged as firebaseOnAuthStateChanged,
    GoogleAuthProvider,
    User,
    UserCredential
} from 'firebase/auth';
import { auth } from '@/firebase/index';

// 普通登录 Provider（只读，无 Sheets scope）
const googleProviderBasic = new GoogleAuthProvider();

// 高级登录 Provider（读写，带 Sheets 和 Gemini API scope）
const googleProviderAdvanced = new GoogleAuthProvider();
googleProviderAdvanced.addScope('https://www.googleapis.com/auth/spreadsheets');
// Gemini API / Generative Language API scope
googleProviderAdvanced.addScope('https://www.googleapis.com/auth/generative-language.tuning');
googleProviderAdvanced.addScope('https://www.googleapis.com/auth/cloud-platform');

// Storage key for OAuth access token
const ACCESS_TOKEN_KEY = 'google_oauth_access_token';
const ACCESS_TOKEN_EXPIRY_KEY = 'google_oauth_token_expiry';
const LOGIN_MODE_KEY = 'google_login_mode'; // 'basic' | 'advanced'

// Load stored access token on module init
let storedAccessToken: string | null = (() => {
    if (typeof window === 'undefined') return null;
    try {
        // Check if token is expired
        const expiry = localStorage.getItem(ACCESS_TOKEN_EXPIRY_KEY);
        if (expiry && Date.now() > parseInt(expiry)) {
            // Token expired, clear it
            localStorage.removeItem(ACCESS_TOKEN_KEY);
            localStorage.removeItem(ACCESS_TOKEN_EXPIRY_KEY);
            return null;
        }
        return localStorage.getItem(ACCESS_TOKEN_KEY);
    } catch {
        return null;
    }
})();

/**
 * 获取当前登录模式
 */
export const getLoginMode = (): 'basic' | 'advanced' => {
    if (typeof window === 'undefined') return 'basic';
    return (localStorage.getItem(LOGIN_MODE_KEY) as 'basic' | 'advanced') || 'basic';
};

/**
 * 检查是否有 Sheets 写入权限
 */
export const hasSheetsWritePermission = (): boolean => {
    return getLoginMode() === 'advanced' && !!getGoogleAccessToken();
};

/**
 * Sign in with Google popup - 普通模式（只读）
 */
export const signInWithGoogle = async (): Promise<UserCredential> => {
    return signInWithGoogleBasic();
};

/**
 * Sign in with Google popup - 普通模式（只读，无 Sheets 权限）
 */
export const signInWithGoogleBasic = async (): Promise<UserCredential> => {
    const result = await signInWithPopup(auth, googleProviderBasic);
    // 保存登录模式
    try {
        localStorage.setItem(LOGIN_MODE_KEY, 'basic');
    } catch { }
    // 普通模式不需要保存 access token（无 Sheets 权限）
    return result;
};

/**
 * Sign in with Google popup - 高级模式（读写，带 Sheets 权限）
 */
export const signInWithGoogleAdvanced = async (): Promise<UserCredential> => {
    // console.log('[Auth] 开始高级登录...');
    const result = await signInWithPopup(auth, googleProviderAdvanced);
    // console.log('[Auth] 弹窗登录完成，提取 credential...');
    // Extract and store the OAuth access token
    const credential = GoogleAuthProvider.credentialFromResult(result);
    // console.log('[Auth] credential:', credential ? '存在' : '不存在');
    // console.log('[Auth] accessToken:', credential?.accessToken ? '存在' : '不存在');
    if (credential?.accessToken) {
        storedAccessToken = credential.accessToken;
        // Persist to localStorage for longer sessions
        // Token typically lasts ~1 hour, we'll store expiry time
        try {
            localStorage.setItem(ACCESS_TOKEN_KEY, credential.accessToken);
            // Set expiry to 55 minutes from now (slightly before actual expiry)
            localStorage.setItem(ACCESS_TOKEN_EXPIRY_KEY, String(Date.now() + 55 * 60 * 1000));
            localStorage.setItem(LOGIN_MODE_KEY, 'advanced');
            // console.log('[Auth] ✅ Token 已保存到 localStorage');
            // console.log('[Auth] Token 前缀:', credential.accessToken.substring(0, 20) + '...');
        } catch (e) {
            console.warn('Failed to persist access token:', e);
        }
    } else {
        console.warn('[Auth] ⚠️ 未能获取 accessToken！');
    }
    return result;
};

/**
 * Get the stored Google OAuth access token (for Sheets API)
 * Returns null if token is expired
 */
export const getGoogleAccessToken = (): string | null => {
    // Check expiry first
    if (typeof window !== 'undefined') {
        try {
            const expiry = localStorage.getItem(ACCESS_TOKEN_EXPIRY_KEY);
            if (expiry && Date.now() > parseInt(expiry)) {
                // Token expired, clear and return null
                clearGoogleAccessToken();
                return null;
            }
        } catch {
            // ignore
        }
    }

    // If in-memory cache is null, try reading from localStorage
    if (!storedAccessToken && typeof window !== 'undefined') {
        try {
            storedAccessToken = localStorage.getItem(ACCESS_TOKEN_KEY);
        } catch {
            // ignore
        }
    }
    return storedAccessToken;
};

/**
 * Check if the Google access token is likely expired or expiring soon
 */
export const isGoogleTokenExpiringSoon = (): boolean => {
    if (typeof window === 'undefined') return true;
    try {
        const expiry = localStorage.getItem(ACCESS_TOKEN_EXPIRY_KEY);
        if (!expiry) return true;
        // Consider "expiring soon" if less than 10 minutes remaining
        return Date.now() > parseInt(expiry) - 10 * 60 * 1000;
    } catch {
        return true;
    }
};

/**
 * Clear stored access token (call on sign out)
 */
export const clearGoogleAccessToken = (): void => {
    storedAccessToken = null;
    try {
        localStorage.removeItem(ACCESS_TOKEN_KEY);
        localStorage.removeItem(ACCESS_TOKEN_EXPIRY_KEY);
    } catch {
        // ignore
    }
};

/**
 * Sign in with email and password
 */
export const signInWithEmail = async (
    email: string,
    password: string
): Promise<UserCredential> => {
    return signInWithEmailAndPassword(auth, email, password);
};

/**
 * Create a new account with email and password
 */
export const signUp = async (
    email: string,
    password: string
): Promise<UserCredential> => {
    return createUserWithEmailAndPassword(auth, email, password);
};

/**
 * Send password reset email
 */
export const sendPasswordReset = async (email: string): Promise<void> => {
    return firebaseSendPasswordResetEmail(auth, email);
};

/**
 * Sign out the current user
 */
export const signOut = async (): Promise<void> => {
    clearGoogleAccessToken();
    return firebaseSignOut(auth);
};

/**
 * Subscribe to auth state changes
 */
export const onAuthStateChanged = (
    callback: (user: User | null) => void
): (() => void) => {
    return firebaseOnAuthStateChanged(auth, callback);
};

/**
 * Get current user (synchronous)
 */
export const getCurrentUser = (): User | null => {
    return auth.currentUser;
};
