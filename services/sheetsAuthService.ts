/**
 * Google Sheets 统一认证服务
 * 
 * 支持四种认证模式：
 * 1. API Key - 只读公开表格
 * 2. Service Account - 读写（用户上传自己的密钥）
 * 3. Custom OAuth - 读写（用户导入自己的 Client ID）
 * 4. Built-in OAuth Test - 读写（需管理员添加邮箱，100用户限制）
 */

// ==================== 类型定义 ====================

export type SheetsAuthMode = 'apiKey' | 'serviceAccount' | 'customOAuth' | 'builtinOAuth';

export interface ServiceAccountCredentials {
    type: string;
    project_id: string;
    private_key_id: string;
    private_key: string;
    client_email: string;
    client_id: string;
    auth_uri: string;
    token_uri: string;
}

export interface CustomOAuthConfig {
    clientId: string;
    clientSecret: string;
}

export interface SheetsAuthState {
    mode: SheetsAuthMode;
    // Service Account
    serviceAccountCredentials?: ServiceAccountCredentials;
    serviceAccountToken?: string;
    serviceAccountTokenExpiry?: number;
    // Custom OAuth
    customOAuthConfig?: CustomOAuthConfig;
    customOAuthToken?: string;
    customOAuthTokenExpiry?: number;
    // Built-in OAuth (from Firebase Auth)
    builtinOAuthToken?: string;
    builtinOAuthTokenExpiry?: number;
}

// ==================== 常量 ====================

const STORAGE_KEY = 'sheets_auth_config';
const API_KEY = 'AIzaSyBsSspB57hO83LQhAGZ_71cJeOouZzONsQ';

// 内置 OAuth 测试用户白名单
const BUILTIN_OAUTH_WHITELIST: string[] = [
    // 管理员可以在这里添加测试用户邮箱
    // 'test@example.com',
];

// ==================== 存储管理 ====================

/**
 * 加载保存的认证配置
 */
export function loadAuthConfig(): SheetsAuthState {
    try {
        const saved = localStorage.getItem(STORAGE_KEY);
        if (saved) {
            const config = JSON.parse(saved);
            return {
                mode: config.mode || 'apiKey',
                serviceAccountCredentials: config.serviceAccountCredentials,
                customOAuthConfig: config.customOAuthConfig,
            };
        }
    } catch (e) {
        console.error('Failed to load auth config:', e);
    }
    return { mode: 'apiKey' };
}

/**
 * 保存认证配置
 */
export function saveAuthConfig(config: Partial<SheetsAuthState>): void {
    try {
        const current = loadAuthConfig();
        const updated = { ...current, ...config };
        // 不保存 token（每次重新生成）
        const toSave = {
            mode: updated.mode,
            serviceAccountCredentials: updated.serviceAccountCredentials,
            customOAuthConfig: updated.customOAuthConfig,
        };
        localStorage.setItem(STORAGE_KEY, JSON.stringify(toSave));
    } catch (e) {
        console.error('Failed to save auth config:', e);
    }
}

/**
 * 清除认证配置
 */
export function clearAuthConfig(): void {
    localStorage.removeItem(STORAGE_KEY);
}

// ==================== API Key 模式 ====================

/**
 * 获取 API Key（用于只读访问公开表格）
 */
export function getApiKey(): string {
    return API_KEY;
}

/**
 * 构建带 API Key 的 URL
 */
export function buildApiKeyUrl(baseUrl: string): string {
    const separator = baseUrl.includes('?') ? '&' : '?';
    return `${baseUrl}${separator}key=${API_KEY}`;
}

// ==================== Service Account 模式 ====================

/**
 * 验证 Service Account 密钥格式
 */
export function validateServiceAccountCredentials(creds: unknown): creds is ServiceAccountCredentials {
    if (!creds || typeof creds !== 'object') return false;
    const c = creds as Record<string, unknown>;
    return (
        c.type === 'service_account' &&
        typeof c.private_key === 'string' &&
        typeof c.client_email === 'string' &&
        typeof c.token_uri === 'string'
    );
}

/**
 * 使用 Service Account 生成 Access Token
 * 注意：这需要在前端实现 JWT 签名
 */
export async function getServiceAccountToken(
    credentials: ServiceAccountCredentials
): Promise<{ token: string; expiresAt: number }> {
    // JWT Header
    const header = {
        alg: 'RS256',
        typ: 'JWT',
    };

    const now = Math.floor(Date.now() / 1000);
    const expiry = now + 3600; // 1 hour

    // JWT Payload
    const payload = {
        iss: credentials.client_email,
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        aud: credentials.token_uri,
        iat: now,
        exp: expiry,
    };

    // 编码 Header 和 Payload
    const encodedHeader = btoa(JSON.stringify(header)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const encodedPayload = btoa(JSON.stringify(payload)).replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
    const signatureInput = `${encodedHeader}.${encodedPayload}`;

    // 使用 Web Crypto API 签名
    const privateKey = credentials.private_key;
    const signature = await signWithPrivateKey(signatureInput, privateKey);
    const jwt = `${signatureInput}.${signature}`;

    // 交换 JWT 获取 Access Token
    const response = await fetch(credentials.token_uri, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
            assertion: jwt,
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`Service Account 认证失败: ${error.error_description || error.error}`);
    }

    const data = await response.json();
    return {
        token: data.access_token,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000, // 提前 1 分钟过期
    };
}

/**
 * 使用私钥签名（Web Crypto API）
 */
async function signWithPrivateKey(data: string, privateKeyPem: string): Promise<string> {
    // 解析 PEM 格式的私钥
    const pemHeader = '-----BEGIN PRIVATE KEY-----';
    const pemFooter = '-----END PRIVATE KEY-----';
    const pemContents = privateKeyPem
        .replace(pemHeader, '')
        .replace(pemFooter, '')
        .replace(/\s/g, '');

    const binaryDer = Uint8Array.from(atob(pemContents), c => c.charCodeAt(0));

    // 导入私钥
    const cryptoKey = await crypto.subtle.importKey(
        'pkcs8',
        binaryDer,
        {
            name: 'RSASSA-PKCS1-v1_5',
            hash: 'SHA-256',
        },
        false,
        ['sign']
    );

    // 签名
    const encoder = new TextEncoder();
    const signatureBuffer = await crypto.subtle.sign(
        'RSASSA-PKCS1-v1_5',
        cryptoKey,
        encoder.encode(data)
    );

    // 编码为 Base64URL
    const signatureArray = new Uint8Array(signatureBuffer);
    const signatureBase64 = btoa(String.fromCharCode(...signatureArray));
    return signatureBase64.replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

// ==================== Custom OAuth 模式 ====================

/**
 * 验证 Custom OAuth 配置
 */
export function validateCustomOAuthConfig(config: unknown): config is CustomOAuthConfig {
    if (!config || typeof config !== 'object') return false;
    const c = config as Record<string, unknown>;
    return (
        typeof c.clientId === 'string' &&
        c.clientId.length > 0 &&
        typeof c.clientSecret === 'string' &&
        c.clientSecret.length > 0
    );
}

/**
 * 获取 Custom OAuth 授权 URL
 */
export function getCustomOAuthAuthUrl(config: CustomOAuthConfig, redirectUri: string): string {
    const params = new URLSearchParams({
        client_id: config.clientId,
        redirect_uri: redirectUri,
        response_type: 'code',
        scope: 'https://www.googleapis.com/auth/spreadsheets',
        access_type: 'offline',
        prompt: 'consent',
    });
    return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

/**
 * 使用授权码交换 Access Token
 */
export async function exchangeCustomOAuthCode(
    config: CustomOAuthConfig,
    code: string,
    redirectUri: string
): Promise<{ token: string; refreshToken?: string; expiresAt: number }> {
    const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: config.clientId,
            client_secret: config.clientSecret,
            code,
            redirect_uri: redirectUri,
            grant_type: 'authorization_code',
        }),
    });

    if (!response.ok) {
        const error = await response.json();
        throw new Error(`OAuth 认证失败: ${error.error_description || error.error}`);
    }

    const data = await response.json();
    return {
        token: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: Date.now() + (data.expires_in - 60) * 1000,
    };
}

// ==================== Built-in OAuth 测试模式 ====================

/**
 * 检查用户是否在内置 OAuth 白名单中
 */
export function isUserInBuiltinOAuthWhitelist(email: string): boolean {
    return BUILTIN_OAUTH_WHITELIST.includes(email.toLowerCase());
}

/**
 * 获取内置 OAuth 白名单（供 UI 显示）
 */
export function getBuiltinOAuthWhitelistInfo(): { hasWhitelist: boolean; count: number } {
    return {
        hasWhitelist: BUILTIN_OAUTH_WHITELIST.length > 0,
        count: BUILTIN_OAUTH_WHITELIST.length,
    };
}

// ==================== 统一接口 ====================

let currentState: SheetsAuthState = loadAuthConfig();

/**
 * 获取当前认证模式
 */
export function getCurrentAuthMode(): SheetsAuthMode {
    return currentState.mode;
}

/**
 * 设置认证模式
 */
export function setAuthMode(mode: SheetsAuthMode): void {
    currentState.mode = mode;
    saveAuthConfig({ mode });
}

/**
 * 设置 Service Account 凭据
 */
export function setServiceAccountCredentials(credentials: ServiceAccountCredentials): void {
    currentState.serviceAccountCredentials = credentials;
    currentState.serviceAccountToken = undefined;
    currentState.serviceAccountTokenExpiry = undefined;
    saveAuthConfig({ serviceAccountCredentials: credentials });
}

/**
 * 设置 Custom OAuth 配置
 */
export function setCustomOAuthConfig(config: CustomOAuthConfig): void {
    currentState.customOAuthConfig = config;
    currentState.customOAuthToken = undefined;
    currentState.customOAuthTokenExpiry = undefined;
    saveAuthConfig({ customOAuthConfig: config });
}

/**
 * 检查当前模式是否支持写入
 */
export function canWrite(): boolean {
    return currentState.mode !== 'apiKey';
}

/**
 * 获取当前模式的请求头
 * 返回 null 表示使用 API Key（URL 参数）
 */
export async function getAuthHeaders(): Promise<HeadersInit | null> {
    switch (currentState.mode) {
        case 'apiKey':
            return null; // 使用 URL 参数

        case 'serviceAccount':
            if (!currentState.serviceAccountCredentials) {
                throw new Error('请先配置 Service Account 密钥');
            }
            // 检查 token 是否过期
            if (!currentState.serviceAccountToken ||
                !currentState.serviceAccountTokenExpiry ||
                Date.now() >= currentState.serviceAccountTokenExpiry) {
                const result = await getServiceAccountToken(currentState.serviceAccountCredentials);
                currentState.serviceAccountToken = result.token;
                currentState.serviceAccountTokenExpiry = result.expiresAt;
            }
            return {
                'Authorization': `Bearer ${currentState.serviceAccountToken}`,
                'Content-Type': 'application/json',
            };

        case 'customOAuth':
            if (!currentState.customOAuthToken) {
                throw new Error('请先完成 OAuth 登录');
            }
            if (currentState.customOAuthTokenExpiry && Date.now() >= currentState.customOAuthTokenExpiry) {
                throw new Error('OAuth Token 已过期，请重新登录');
            }
            return {
                'Authorization': `Bearer ${currentState.customOAuthToken}`,
                'Content-Type': 'application/json',
            };

        case 'builtinOAuth':
            if (!currentState.builtinOAuthToken) {
                throw new Error('请先登录 Google 账号');
            }
            if (currentState.builtinOAuthTokenExpiry && Date.now() >= currentState.builtinOAuthTokenExpiry) {
                throw new Error('登录已过期，请重新登录');
            }
            return {
                'Authorization': `Bearer ${currentState.builtinOAuthToken}`,
                'Content-Type': 'application/json',
            };

        default:
            return null;
    }
}

/**
 * 设置 OAuth Token（供外部调用）
 */
export function setOAuthToken(token: string, expiresAt: number, mode: 'customOAuth' | 'builtinOAuth'): void {
    if (mode === 'customOAuth') {
        currentState.customOAuthToken = token;
        currentState.customOAuthTokenExpiry = expiresAt;
    } else {
        currentState.builtinOAuthToken = token;
        currentState.builtinOAuthTokenExpiry = expiresAt;
    }
}

/**
 * 获取当前模式的显示名称
 */
export function getAuthModeDisplayName(mode: SheetsAuthMode): string {
    switch (mode) {
        case 'apiKey': return 'API Key（只读）';
        case 'serviceAccount': return 'Service Account（读写）';
        case 'customOAuth': return '自定义 OAuth（读写）';
        case 'builtinOAuth': return '内置 OAuth 测试（读写）';
    }
}

/**
 * 获取当前认证状态概要
 */
export function getAuthStatusSummary(): {
    mode: SheetsAuthMode;
    modeName: string;
    canWrite: boolean;
    isConfigured: boolean;
    isTokenValid: boolean;
} {
    const mode = currentState.mode;
    let isConfigured = true;
    let isTokenValid = true;

    switch (mode) {
        case 'serviceAccount':
            isConfigured = !!currentState.serviceAccountCredentials;
            isTokenValid = !!currentState.serviceAccountToken &&
                !!currentState.serviceAccountTokenExpiry &&
                Date.now() < currentState.serviceAccountTokenExpiry;
            break;
        case 'customOAuth':
            isConfigured = !!currentState.customOAuthConfig;
            isTokenValid = !!currentState.customOAuthToken &&
                (!currentState.customOAuthTokenExpiry || Date.now() < currentState.customOAuthTokenExpiry);
            break;
        case 'builtinOAuth':
            isConfigured = true;
            isTokenValid = !!currentState.builtinOAuthToken &&
                (!currentState.builtinOAuthTokenExpiry || Date.now() < currentState.builtinOAuthTokenExpiry);
            break;
    }

    return {
        mode,
        modeName: getAuthModeDisplayName(mode),
        canWrite: mode !== 'apiKey',
        isConfigured,
        isTokenValid: mode === 'apiKey' || isTokenValid,
    };
}
