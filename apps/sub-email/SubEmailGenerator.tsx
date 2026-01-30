/**
 * SubEmailGenerator - 子邮箱生成工具
 * 生成 Gmail 子邮箱变体和可选密码
 */

import React, { useState } from 'react';

// 内联 ToolHeader 组件
const ToolHeader = ({ title, description }: { title: string, description?: string }) => (
    <div className="tool-header">
        <h2>{title}</h2>
        {description && <p className="tool-description">{description}</p>}
    </div>
);

// 翻译字典
const translations: Record<string, string> = {
    subEmailTitle: '生成子邮箱',
    subEmailDescription: '为 Gmail 地址生成点号变体，用于组织和隐私保护',
    subEmailEmailLabel: 'Gmail 地址',
    subEmailEmailPlaceholder: 'example@gmail.com',
    subEmailVariantsLabel: '生成数量',
    subEmailVariantsHelper: '输入数字或 "all" 生成所有变体',
    subEmailMaxLimit: '最大限制',
    subEmailPasswordLength: '密码长度',
    subEmailGeneratePasswords: '同时生成密码',
    subEmailIncludeSymbols: '包含特殊符号',
    subEmailAvoidAmbiguous: '避免相似字符 (I/l/1, O/0)',
    subEmailGenerateButton: '生成',
    subEmailErrorInvalidEmail: '请输入有效的 Gmail 地址',
    subEmailErrorVariants: '请输入有效的数量',
    subEmailNoVariants: '无法生成变体（用户名太短）',
    subEmailSummaryAll: '已生成全部 {count} 个变体（最大 {limit}）',
    subEmailSummaryPartial: '已生成 {count} 个变体（最大 {limit}）',
    subEmailLimitNotice: '由于安全限制，最多生成 {limit} 个变体',
    subEmailResultsTitle: '生成结果',
    subEmailCopyAll: '复制全部',
    subEmailCopyRow: '复制',
    subEmailColumnEmail: '邮箱',
    subEmailColumnPassword: '密码',
    copied: '已复制',
    processing: '处理中...',
};

// 简单的翻译函数
const useTranslation = () => ({
    t: (key: string, params?: Record<string, string | number>) => {
        let text = translations[key] || key;
        if (params) {
            Object.entries(params).forEach(([k, v]) => {
                text = text.replace(`{${k}}`, String(v));
            });
        }
        return text;
    }
});

// 密码生成选项
interface PasswordOptions {
    useLower: boolean;
    useUpper: boolean;
    useDigits: boolean;
    useSymbols: boolean;
    avoidAmbiguous: boolean;
}

// Fisher-Yates shuffle
function shuffleInPlace<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
        const j = Math.floor(Math.random() * (i + 1));
        [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
}

// 生成密码
function generatePassword(length: number, opts: PasswordOptions): string {
    const lower = 'abcdefghijklmnopqrstuvwxyz';
    const upper = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
    const digits = '0123456789';
    const symbols = '!@#$%^&*()_+-=[]{}|;:,.<>?';
    const ambiguous = 'Il1O0';

    let pool = '';
    if (opts.useLower) pool += lower;
    if (opts.useUpper) pool += upper;
    if (opts.useDigits) pool += digits;
    if (opts.useSymbols) pool += symbols;

    if (opts.avoidAmbiguous) {
        pool = pool.split('').filter(c => !ambiguous.includes(c)).join('');
    }

    if (!pool) return '';

    let password = '';
    for (let i = 0; i < length; i++) {
        password += pool[Math.floor(Math.random() * pool.length)];
    }
    return password;
}

type SubEmailResult = {
    email: string;
    password?: string;
    isOriginal?: boolean;
};

export const SubEmailGenerator: React.FC = () => {
    const { t } = useTranslation();
    const [formData, setFormData] = useState({
        email: '',
        variants: '5',
        maxLimit: '20000',
        generatePasswords: false,
        passwordLength: '14',
        includeSymbols: false,
        avoidAmbiguous: true,
    });
    const [results, setResults] = useState<SubEmailResult[]>([]);
    const [statusMessage, setStatusMessage] = useState('');
    const [notice, setNotice] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [copiedEntry, setCopiedEntry] = useState<string | null>(null);
    const [copiedAll, setCopiedAll] = useState(false);

    const handleInputChange = (event: React.ChangeEvent<HTMLInputElement>) => {
        const { name, type, value, checked } = event.target;
        setFormData(prev => ({
            ...prev,
            [name]: type === 'checkbox' ? checked : value,
        }));
    };

    const canCopy = typeof navigator !== 'undefined' && !!navigator.clipboard;
    const showPasswordColumn = results.some(row => !!row.password);

    const handleCopy = (entry: SubEmailResult) => {
        if (!canCopy || typeof navigator === 'undefined' || !navigator.clipboard) return;
        const payload = entry.password ? `${entry.email}\t${entry.password}` : entry.email;
        navigator.clipboard.writeText(payload).then(() => {
            setCopiedEntry(entry.email);
            if (typeof window !== 'undefined') {
                window.setTimeout(() => setCopiedEntry(null), 2500);
            }
        }).catch(() => {
            setCopiedEntry(null);
        });
    };

    const handleCopyAll = () => {
        if (!canCopy || typeof navigator === 'undefined' || !navigator.clipboard || results.length === 0) return;
        const payload = results
            .map(row => (row.password ? `${row.email}\t${row.password}` : row.email))
            .join('\n');
        if (!payload) return;
        navigator.clipboard.writeText(payload).then(() => {
            setCopiedAll(true);
            if (typeof window !== 'undefined') {
                window.setTimeout(() => setCopiedAll(false), 2500);
            }
        });
    };

    const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        if (isSubmitting) return;
        setIsSubmitting(true);
        setError(null);
        setStatusMessage('');
        setNotice('');
        setCopiedEntry(null);
        setResults([]);

        try {
            const email = formData.email.trim();
            const emailRegex = /^([a-zA-Z0-9](?:[a-zA-Z0-9]*(?:\.[a-zA-Z0-9]+)*)?)@gmail\.com$/;
            if (!emailRegex.test(email)) {
                setError(t('subEmailErrorInvalidEmail'));
                return;
            }
            const [, domainPart] = email.split('@');
            const username = email.slice(0, email.indexOf('@'));
            const slots = Math.max(0, username.length - 1);
            let maxCombinations = 1;
            if (slots > 0) {
                const raw = Math.pow(2, slots);
                maxCombinations = Number.isFinite(raw) ? raw : Number.MAX_SAFE_INTEGER;
            }
            const parsedMaxLimit = parseInt(formData.maxLimit, 10);
            const safetyCap = Math.max(1, Number.isFinite(parsedMaxLimit) ? parsedMaxLimit : 20000);
            const variantsInput = formData.variants.trim();
            const wantAll = !variantsInput || variantsInput.toLowerCase() === 'all';
            const requestedVariants = wantAll ? maxCombinations : parseInt(variantsInput, 10);
            if (!wantAll && (Number.isNaN(requestedVariants) || requestedVariants < 1)) {
                setError(t('subEmailErrorVariants'));
                return;
            }
            const limit = Math.max(1, Math.min(Math.floor(maxCombinations), safetyCap));
            const finalCount = wantAll ? limit : Math.min(requestedVariants, limit);
            const exceededLimit = requestedVariants > limit;
            const limitNoticeText = exceededLimit ? t('subEmailLimitNotice', { limit }) : '';
            const indices = (() => {
                if (wantAll && finalCount === limit) {
                    return Array.from({ length: finalCount }, (_, index) => index);
                }
                const pool = Array.from({ length: limit }, (_, index) => index);
                shuffleInPlace(pool);
                return pool.slice(0, finalCount);
            })();
            const lowerOriginal = email.toLowerCase();
            const variants = indices
                .map(idx => {
                    const binary = idx.toString(2).padStart(slots, '0');
                    const parts: string[] = [];
                    for (let i = 0; i < username.length; i++) {
                        parts.push(username[i]);
                        if (i < username.length - 1 && binary[i] === '1') {
                            parts.push('.');
                        }
                    }
                    return parts.join('') + '@' + domainPart;
                })
                .filter(v => v.toLowerCase() !== lowerOriginal);
            const passwordLength = Math.max(1, parseInt(formData.passwordLength, 10) || 14);
            const passwordOpts: PasswordOptions = {
                useLower: true,
                useUpper: true,
                useDigits: true,
                useSymbols: formData.includeSymbols,
                avoidAmbiguous: formData.avoidAmbiguous,
            };
            const variantRows = variants.map(variant => {
                const row: SubEmailResult = { email: variant };
                if (formData.generatePasswords) {
                    row.password = generatePassword(passwordLength, passwordOpts);
                }
                return row;
            });
            const rows: SubEmailResult[] = [{ email, isOriginal: true }, ...variantRows];
            setResults(rows);
            const summary =
                variants.length === 0
                    ? t('subEmailNoVariants')
                    : wantAll && finalCount === limit
                        ? t('subEmailSummaryAll', { count: variants.length, limit })
                        : t('subEmailSummaryPartial', { count: variants.length, limit });
            setStatusMessage(summary);
            setNotice(limitNoticeText);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="tool-container subemail-tool">
            <ToolHeader title={t('subEmailTitle')} description={t('subEmailDescription')} />
            <form className="subemail-form" onSubmit={handleSubmit}>
                <div className="subemail-grid">
                    <label className="subemail-field">
                        <span>{t('subEmailEmailLabel')}</span>
                        <input
                            type="email"
                            name="email"
                            value={formData.email}
                            onChange={handleInputChange}
                            placeholder={t('subEmailEmailPlaceholder')}
                            autoComplete="email"
                            required
                        />
                    </label>
                    <label className="subemail-field">
                        <span>{t('subEmailVariantsLabel')}</span>
                        <input
                            type="text"
                            name="variants"
                            value={formData.variants}
                            onChange={handleInputChange}
                            placeholder="5"
                        />
                        <small>{t('subEmailVariantsHelper')}</small>
                    </label>
                    <label className="subemail-field">
                        <span>{t('subEmailMaxLimit')}</span>
                        <input
                            type="number"
                            name="maxLimit"
                            min="1"
                            step="1"
                            value={formData.maxLimit}
                            onChange={handleInputChange}
                        />
                    </label>
                </div>
                <div className="subemail-grid">
                    <label className="subemail-field">
                        <span>{t('subEmailPasswordLength')}</span>
                        <input
                            type="number"
                            name="passwordLength"
                            min="1"
                            step="1"
                            value={formData.passwordLength}
                            onChange={handleInputChange}
                        />
                    </label>
                </div>
                <div className="subemail-checkboxes">
                    <label>
                        <input
                            type="checkbox"
                            name="generatePasswords"
                            checked={formData.generatePasswords}
                            onChange={handleInputChange}
                        />
                        {t('subEmailGeneratePasswords')}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            name="includeSymbols"
                            checked={formData.includeSymbols}
                            onChange={handleInputChange}
                        />
                        {t('subEmailIncludeSymbols')}
                    </label>
                    <label>
                        <input
                            type="checkbox"
                            name="avoidAmbiguous"
                            checked={formData.avoidAmbiguous}
                            onChange={handleInputChange}
                        />
                        {t('subEmailAvoidAmbiguous')}
                    </label>
                </div>
                <button className="primary" type="submit" disabled={isSubmitting}>
                    {isSubmitting ? t('processing') : t('subEmailGenerateButton')}
                </button>
            </form>
            {error && <p className="error-message">{error}</p>}
            {notice && <div className="info-message">{notice}</div>}
            {statusMessage && <p className="subemail-status">{statusMessage}</p>}
            {copiedEntry && <p className="subemail-status">{t('copied')} · {copiedEntry}</p>}
            {copiedAll && <p className="subemail-status">{t('copied')} · {t('subEmailCopyAll')}</p>}
            {results.length > 0 && (
                <div className="subemail-results">
                    <div className="subemail-results-header">
                        <strong>{t('subEmailResultsTitle')}</strong>
                        {canCopy && results.length > 0 && (
                            <button type="button" className="copy-btn" onClick={handleCopyAll}>
                                {t('subEmailCopyAll')}
                            </button>
                        )}
                    </div>
                    <table>
                        <thead>
                            <tr>
                                <th>{t('subEmailColumnEmail')}</th>
                                {showPasswordColumn && <th>{t('subEmailColumnPassword')}</th>}
                            </tr>
                        </thead>
                        <tbody>
                            {results.map(row => (
                                <tr key={row.email} className={row.isOriginal ? 'original-row' : ''}>
                                    <td>
                                        <div className="subemail-email-cell">
                                            <span>{row.email}</span>
                                            <button
                                                type="button"
                                                className="secondary-btn subemail-copy-btn"
                                                onClick={() => handleCopy(row)}
                                                disabled={!canCopy}
                                            >
                                                {t('subEmailCopyRow')}
                                            </button>
                                        </div>
                                    </td>
                                    {showPasswordColumn && <td>{row.password || ''}</td>}
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};

export default SubEmailGenerator;
