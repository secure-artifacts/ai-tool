// Login Modal Component with Password Reset
import React, { useState } from 'react';
import { useAuth } from '@/contexts/AuthContext';
import { sendPasswordReset } from '@/services/authService';
import SheetsAuthConfig from './SheetsAuthConfig';

interface LoginModalProps {
    isOpen: boolean;
    onClose: () => void;
    language: 'zh' | 'en';
}

export const LoginModal: React.FC<LoginModalProps> = ({ isOpen, onClose, language }) => {
    const { user, signInWithGoogle, signInWithEmail, signUp, signOut } = useAuth();
    const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login');
    const [email, setEmail] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [showSheetsConfig, setShowSheetsConfig] = useState(false);

    // 检测是否在嵌入式环境（AI Studio）或 Electron 桌面版
    const isEmbedded = typeof window !== 'undefined' && (
        window.self !== window.top ||
        window.location.hostname.includes('aistudio') ||
        window.location.hostname.includes('googleusercontent')
    );

    // 检测 Electron 桌面版 (现在使用 localhost，Google 登录可以正常工作)
    const isElectron = typeof window !== 'undefined' && (
        (window as any).electronAPI !== undefined
    );

    // 只在嵌入式环境（AI Studio）中隐藏 Google 登录
    // Electron 桌面版现在使用 localhost，可以正常 Google 登录
    const hideGoogleLogin = isEmbedded;

    if (!isOpen) return null;

    const t = {
        zh: {
            title: mode === 'login' ? '登录' : mode === 'register' ? '注册' : '重置密码',
            accountTitle: '账号管理',
            email: '邮箱',
            password: '密码 (至少6位)',
            loginBtn: '登录',
            registerBtn: '注册',
            resetBtn: '发送重置邮件',
            googleBtn: '使用 Google 登录',
            switchToRegister: '没有账号？注册',
            switchToLogin: '已有账号？登录',
            forgotPassword: '忘记密码？',
            backToLogin: '返回登录',
            or: '或',
            switchAccount: '切换账号',
            logout: '退出登录',
            embeddedWarning: 'AI Studio 环境不支持 Google 弹窗登录',
            embeddedHint: '请使用邮箱密码登录，或点击下方注册新账号',
            resetSuccess: '密码重置邮件已发送，请检查您的邮箱',
            googleUserHint: '💡 如果您之前用 Google 登录，请先点击"忘记密码"设置密码。如果要使用数据分析功能，则必须点击使用 Google 登录，否则无法读取数据。',
            errors: {
                'auth/user-not-found': '用户不存在，请先注册',
                'auth/wrong-password': '密码错误',
                'auth/email-already-in-use': '⚠️ 该邮箱已注册！请点击下方"忘记密码"设置一个新密码',
                'auth/weak-password': '密码太弱，至少6位',
                'auth/invalid-email': '邮箱格式不正确',
                'auth/popup-closed-by-user': '登录已取消',
                'auth/unauthorized-domain': '域名未授权，请使用邮箱密码登录',
                'auth/invalid-credential': '邮箱或密码错误',
                'auth/too-many-requests': '尝试次数过多，请稍后再试',
                'auth/network-request-failed': '网络错误，请检查网络连接',
                default: '操作失败，请重试'
            }
        },
        en: {
            title: mode === 'login' ? 'Login' : mode === 'register' ? 'Register' : 'Reset Password',
            accountTitle: 'Account',
            email: 'Email',
            password: 'Password (min 6 chars)',
            loginBtn: 'Login',
            registerBtn: 'Register',
            resetBtn: 'Send Reset Email',
            googleBtn: 'Sign in with Google',
            switchToRegister: "Don't have an account? Register",
            switchToLogin: 'Already have an account? Login',
            forgotPassword: 'Forgot password?',
            backToLogin: 'Back to login',
            or: 'or',
            switchAccount: 'Switch Account',
            logout: 'Logout',
            embeddedWarning: 'Google popup login not supported in AI Studio',
            embeddedHint: 'Use email/password login, or register a new account below',
            resetSuccess: 'Password reset email sent. Check your inbox.',
            googleUserHint: 'If you previously logged in with Google, click "Forgot password" to set a password',
            errors: {
                'auth/user-not-found': 'User not found. Please register first.',
                'auth/wrong-password': 'Wrong password',
                'auth/email-already-in-use': 'Email already in use. Please login or reset password.',
                'auth/weak-password': 'Password too weak (min 6 chars)',
                'auth/invalid-email': 'Invalid email format',
                'auth/popup-closed-by-user': 'Login cancelled',
                'auth/unauthorized-domain': 'Domain not authorized. Use email/password login.',
                'auth/invalid-credential': 'Invalid email or password',
                'auth/too-many-requests': 'Too many attempts. Please try again later.',
                'auth/network-request-failed': 'Network error. Check your connection.',
                default: 'Operation failed. Please try again.'
            }
        }
    };

    const texts = t[language];

    const getErrorMessage = (code: string): string => {
        return (texts.errors as any)[code] || `${texts.errors.default} (${code})`;
    };

    const handleGoogleSignIn = async () => {
        setError(null);
        setSuccess(null);
        setIsSubmitting(true);
        try {
            await signInWithGoogle();
            onClose();
        } catch (err: any) {
            console.error('[Login] Google sign-in error:', err);
            setError(getErrorMessage(err.code));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleGoogleSignInAdvanced = async () => {
        setError(null);
        setSuccess(null);
        setIsSubmitting(true);
        try {
            const { signInWithGoogleAdvanced } = await import('@/services/authService');
            await signInWithGoogleAdvanced();
            onClose();
        } catch (err: any) {
            console.error('[Login] Google advanced sign-in error:', err);
            setError(getErrorMessage(err.code));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleEmailSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setSuccess(null);
        setIsSubmitting(true);

        try {
            if (mode === 'login') {
                await signInWithEmail(email, password);
                onClose();
            } else if (mode === 'register') {
                await signUp(email, password);
                onClose();
            } else if (mode === 'reset') {
                await sendPasswordReset(email);
                setSuccess(texts.resetSuccess);
            }
        } catch (err: any) {
            console.error('[Login] Email submit error:', err);
            setError(getErrorMessage(err.code));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleSwitchAccount = async () => {
        await signOut();
    };

    const handleLogout = async () => {
        await signOut();
        onClose();
    };

    return (
        <div
            className="login-modal-overlay"
            onClick={(e) => e.target === e.currentTarget && onClose()}
        >
            <div className={`login-modal ${showSheetsConfig ? 'wide' : ''}`}>
                {/* 已登录状态 */}
                {user ? (
                    <>
                        <div className="modal-header">
                            <h2 className="modal-title">
                                {showSheetsConfig ? '📊 Sheets 认证配置' : texts.accountTitle}
                            </h2>
                            <button onClick={onClose} className="modal-close-btn">×</button>
                        </div>

                        {showSheetsConfig ? (
                            <>
                                <SheetsAuthConfig onConfigChanged={() => { }} />
                                <button
                                    onClick={() => setShowSheetsConfig(false)}
                                    className="modal-btn modal-btn-outline"
                                    style={{ marginTop: '1rem' }}
                                >
                                    ← 返回账号管理
                                </button>
                            </>
                        ) : (
                            <>
                                <div className="user-profile-card">
                                    {user.photoURL ? (
                                        <img src={user.photoURL} alt="avatar" className="user-avatar" />
                                    ) : (
                                        <div className="user-avatar-placeholder">
                                            {user.email?.charAt(0).toUpperCase() || '?'}
                                        </div>
                                    )}
                                    <div>
                                        <div className="user-name">
                                            {user.displayName || user.email?.split('@')[0] || '用户'}
                                        </div>
                                        <div className="user-email">
                                            {user.email}
                                        </div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3">
                                    <button
                                        onClick={() => setShowSheetsConfig(true)}
                                        className="modal-btn modal-btn-filled"
                                    >
                                        📊 Sheets 认证配置
                                    </button>
                                    <button onClick={handleSwitchAccount} className="modal-btn modal-btn-outline">
                                        🔄 {texts.switchAccount}
                                    </button>
                                    <button onClick={handleLogout} className="modal-btn modal-btn-danger">
                                        🚪 {texts.logout}
                                    </button>
                                </div>
                            </>
                        )}
                    </>
                ) : (
                    /* 未登录状态 */
                    <>
                        <div className="modal-header">
                            <h2 className="modal-title">{texts.title}</h2>
                            <button onClick={onClose} className="modal-close-btn">×</button>
                        </div>

                        {/* AI Studio / Electron 环境提示 */}
                        {hideGoogleLogin && (
                            <div className="notice-box notice-box-warning">
                                <p className="notice-title">
                                    ⚠️ {isElectron ? '桌面版请使用邮箱密码登录' : texts.embeddedWarning}
                                </p>
                                <p className="notice-hint">
                                    {texts.embeddedHint}
                                </p>
                            </div>
                        )}

                        {/* Google 用户提示 */}
                        {mode === 'login' && (
                            <div className="notice-box notice-box-info" style={{ fontSize: '0.8rem' }}>
                                💡 {texts.googleUserHint}
                            </div>
                        )}

                        {/* Google 登录按钮 - 只在非嵌入式/非Electron环境显示 */}
                        {!hideGoogleLogin && mode === 'login' && (
                            <>
                                {/* 普通登录（只读） */}
                                <button
                                    onClick={handleGoogleSignIn}
                                    disabled={isSubmitting}
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem',
                                        borderRadius: '8px',
                                        border: '1px solid var(--border-color)',
                                        backgroundColor: 'white',
                                        color: '#333',
                                        fontSize: '1rem',
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '0.5rem',
                                        marginBottom: '0.5rem'
                                    }}
                                >
                                    <svg width="18" height="18" viewBox="0 0 18 18">
                                        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
                                        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" />
                                        <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
                                        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
                                    </svg>
                                    🔵 普通登录（只读）
                                </button>

                                {/* 高级登录（读写） */}
                                <button
                                    onClick={handleGoogleSignInAdvanced}
                                    disabled={isSubmitting}
                                    style={{
                                        width: '100%',
                                        padding: '0.75rem',
                                        borderRadius: '8px',
                                        border: '2px solid #34a853',
                                        backgroundColor: '#f0fdf4',
                                        color: '#166534',
                                        fontSize: '1rem',
                                        fontWeight: 500,
                                        cursor: 'pointer',
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'center',
                                        gap: '0.5rem',
                                        marginBottom: '0.5rem'
                                    }}
                                >
                                    <svg width="18" height="18" viewBox="0 0 18 18">
                                        <path fill="#4285F4" d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844c-.209 1.125-.843 2.078-1.796 2.717v2.258h2.908c1.702-1.567 2.684-3.875 2.684-6.615z" />
                                        <path fill="#34A853" d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 009 18z" />
                                        <path fill="#FBBC05" d="M3.964 10.71A5.41 5.41 0 013.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 000 9c0 1.452.348 2.827.957 4.042l3.007-2.332z" />
                                        <path fill="#EA4335" d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 00.957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58z" />
                                    </svg>
                                    🟢 高级登录（读写）
                                </button>

                                {/* 高级登录说明 */}
                                <div className="login-advanced-hint">
                                    💡 高级登录需要 Sheets 写入权限，适合需要同步/入库功能的用户。
                                    普通用户选择"普通登录"即可。
                                </div>

                                <div className="login-or-divider">
                                    <div className="login-or-divider-line" />
                                    <span className="login-or-divider-text">{texts.or}</span>
                                    <div className="login-or-divider-line" />
                                </div>
                            </>
                        )}

                        {/* 邮箱表单 */}
                        <form onSubmit={handleEmailSubmit}>
                            <div className="mb-4">
                                <input
                                    type="email"
                                    value={email}
                                    onChange={(e) => setEmail(e.target.value)}
                                    placeholder={texts.email}
                                    required
                                    className="login-input"
                                />
                            </div>

                            {/* 密码输入框（重置密码模式不需要） */}
                            {mode !== 'reset' && (
                                <div className="mb-4">
                                    <input
                                        type="password"
                                        value={password}
                                        onChange={(e) => setPassword(e.target.value)}
                                        placeholder={texts.password}
                                        required
                                        minLength={6}
                                        className="login-input"
                                    />
                                </div>
                            )}

                            {/* 错误提示 */}
                            {error && (
                                <div className="login-error-box">
                                    ❌ {error}
                                </div>
                            )}

                            {/* 成功提示 */}
                            {success && (
                                <div className="login-success-box">
                                    ✅ {success}
                                </div>
                            )}

                            <button
                                type="submit"
                                disabled={isSubmitting}
                                className="login-submit-btn"
                            >
                                {isSubmitting ? '...' : (
                                    mode === 'login' ? texts.loginBtn :
                                        mode === 'register' ? texts.registerBtn :
                                            texts.resetBtn
                                )}
                            </button>
                        </form>

                        {/* 切换模式按钮 */}
                        <div className="login-mode-switch">
                            {mode === 'login' && (
                                <>
                                    <button
                                        onClick={() => { setMode('reset'); setError(null); setSuccess(null); }}
                                        className="login-link-btn muted"
                                    >
                                        {texts.forgotPassword}
                                    </button>
                                    <br />
                                    <button
                                        onClick={() => { setMode('register'); setError(null); setSuccess(null); }}
                                        className="login-link-btn primary"
                                    >
                                        {texts.switchToRegister}
                                    </button>
                                </>
                            )}
                            {mode === 'register' && (
                                <>
                                    <button
                                        onClick={() => { setMode('reset'); setError(null); setSuccess(null); }}
                                        className="login-link-btn muted"
                                    >
                                        {texts.forgotPassword}
                                    </button>
                                    <br />
                                    <button
                                        onClick={() => { setMode('login'); setError(null); setSuccess(null); }}
                                        className="login-link-btn primary"
                                    >
                                        {texts.switchToLogin}
                                    </button>
                                </>
                            )}
                            {mode === 'reset' && (
                                <button
                                    onClick={() => { setMode('login'); setError(null); setSuccess(null); }}
                                    className="login-link-btn primary"
                                >
                                    {texts.backToLogin}
                                </button>
                            )}
                        </div>
                    </>
                )}
            </div>
        </div>
    );
};

export default LoginModal;
