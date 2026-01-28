"use strict";
/**
 * Cloud Functions for AI Toolkit
 *
 * getServiceAccountToken - 生成 Service Account 的 OAuth Token
 * 用于前端直接访问 Google Sheets API
 */
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.getServiceAccountToken = void 0;
const functions = __importStar(require("firebase-functions"));
const admin = __importStar(require("firebase-admin"));
const google_auth_library_1 = require("google-auth-library");
// 初始化 Firebase Admin
admin.initializeApp();
// CORS 允许的来源
const ALLOWED_ORIGINS = [
    'https://ai-toolkit-b2b78.web.app',
    'https://ai-toolkit-b2b78.firebaseapp.com',
    'http://localhost:5173', // Vite dev server
    'http://localhost:3000',
];
/**
 * 获取 Service Account 的 Access Token
 * 用于前端访问 Google Sheets API
 */
exports.getServiceAccountToken = functions.https.onRequest(async (req, res) => {
    // CORS 处理
    const origin = req.headers.origin || '';
    if (ALLOWED_ORIGINS.includes(origin)) {
        res.set('Access-Control-Allow-Origin', origin);
    }
    res.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
    res.set('Access-Control-Allow-Headers', 'Content-Type');
    // 预检请求
    if (req.method === 'OPTIONS') {
        res.status(204).send('');
        return;
    }
    try {
        // 使用 Firebase Admin 的默认凭证生成 token
        // 这会自动使用项目关联的 Service Account
        const auth = new google_auth_library_1.GoogleAuth({
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });
        const authClient = await auth.getClient();
        const accessToken = await authClient.getAccessToken();
        if (!accessToken.token) {
            throw new Error('Failed to get access token');
        }
        // 返回 token（有效期约 1 小时）
        res.json({
            token: accessToken.token,
            expiresAt: Date.now() + 3500000, // ~58 分钟后过期
        });
    }
    catch (error) {
        console.error('Error getting service account token:', error);
        res.status(500).json({
            error: 'Failed to get service account token',
            message: error instanceof Error ? error.message : 'Unknown error',
        });
    }
});
//# sourceMappingURL=index.js.map