export const getMainAiInstance = (): (() => any) | null => {
    if (typeof window === 'undefined') return null;
    const fn = (window as any).__mindMapGetAiInstance || (window as any).__app_get_ai_instance;
    return typeof fn === 'function' ? fn : null;
};

export const getStoredApiKey = (): string => {
    if (typeof window === 'undefined') return '';
    return localStorage.getItem('user_api_key') || '';
};

export const hasAiAccess = (apiKey?: string): boolean => {
    if (apiKey && apiKey.trim()) return true;
    if (getMainAiInstance()) return true;
    if (getStoredApiKey()) return true;
    return false;
};
