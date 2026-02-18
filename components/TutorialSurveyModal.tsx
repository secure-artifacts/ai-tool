import React, { useEffect, useMemo, useState } from 'react';
import { BarChart3, Check, Loader2, X } from 'lucide-react';
import {
    DEFAULT_TUTORIAL_SURVEY_DRAFT,
    fetchTutorialSurveyStats,
    loadTutorialSurveyDraft,
    markTutorialSurveyCompleted,
    saveTutorialSurveyDraft,
    submitTutorialSurvey,
    TUTORIAL_SURVEY_KEY,
    TUTORIAL_SURVEY_TOOLS,
    type TutorialSurveyDraft,
    type TutorialSurveyToolId,
    type TutorialSurveyStats,
} from '@/services/tutorialSurveyService';

interface TutorialSurveyModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSubmitted?: () => void;
    language: 'zh' | 'en';
    userId?: string | null;
    userEmail?: string | null;
    appVersion?: string;
}

const FORMAT_OPTIONS = [
    { key: 'short_video', zh: '短视频（3-8分钟）', en: 'Short video (3-8 min)' },
    { key: 'long_video', zh: '完整录屏（20分钟+）', en: 'Full walkthrough video (20+ min)' },
    { key: 'article', zh: '图文步骤教程', en: 'Step-by-step article' },
    { key: 'live', zh: '直播答疑', en: 'Live Q&A session' },
    { key: 'case', zh: '真实案例拆解', en: 'Real case breakdown' },
];

const FREQUENCY_OPTIONS = [
    { key: 'daily', zh: '每天', en: 'Daily' },
    { key: 'weekly', zh: '每周', en: 'Weekly' },
    { key: 'monthly', zh: '偶尔', en: 'Occasionally' },
    { key: 'new_user', zh: '刚开始使用', en: 'New user' },
];

const text = (language: 'zh' | 'en', zh: string, en: string) => (language === 'zh' ? zh : en);

const TutorialSurveyModal: React.FC<TutorialSurveyModalProps> = ({
    isOpen,
    onClose,
    onSubmitted,
    language,
    userId,
    userEmail,
    appVersion,
}) => {
    const [form, setForm] = useState<TutorialSurveyDraft>(DEFAULT_TUTORIAL_SURVEY_DRAFT);
    const [stats, setStats] = useState<TutorialSurveyStats | null>(null);
    const [submitting, setSubmitting] = useState(false);
    const [loadingStats, setLoadingStats] = useState(false);
    const [saveMessage, setSaveMessage] = useState('');
    const [errorMessage, setErrorMessage] = useState('');

    useEffect(() => {
        if (!isOpen) return;
        setForm(loadTutorialSurveyDraft(TUTORIAL_SURVEY_KEY));
    }, [isOpen]);

    useEffect(() => {
        if (!isOpen) return;
        saveTutorialSurveyDraft(form, TUTORIAL_SURVEY_KEY);
    }, [form, isOpen]);

    const refreshStats = async () => {
        setLoadingStats(true);
        try {
            const next = await fetchTutorialSurveyStats(TUTORIAL_SURVEY_KEY);
            setStats(next);
        } catch (err) {
            console.error('[TutorialSurveyModal] Failed to load stats:', err);
        } finally {
            setLoadingStats(false);
        }
    };

    useEffect(() => {
        if (!isOpen) return;
        refreshStats();
    }, [isOpen]);

    const sortedToolRows = useMemo(() => {
        const source = TUTORIAL_SURVEY_TOOLS.map(item => ({
            ...item,
            usedCount: stats?.toolStats[item.id]?.usedCount || 0,
            needTutorialCount: stats?.toolStats[item.id]?.needTutorialCount || 0,
            priorityScore: stats?.toolStats[item.id]?.priorityScore || 0,
        }));
        return source.sort((a, b) => {
            if (b.needTutorialCount !== a.needTutorialCount) return b.needTutorialCount - a.needTutorialCount;
            if (b.priorityScore !== a.priorityScore) return b.priorityScore - a.priorityScore;
            return b.usedCount - a.usedCount;
        });
    }, [stats]);

    const toggleTool = (key: 'usedTools' | 'needTutorialTools', toolId: TutorialSurveyToolId) => {
        setForm(prev => {
            const has = prev[key].includes(toolId);
            return {
                ...prev,
                [key]: has ? prev[key].filter(id => id !== toolId) : [...prev[key], toolId],
            };
        });
    };

    const toggleFormat = (formatKey: string) => {
        setForm(prev => {
            const has = prev.tutorialFormats.includes(formatKey);
            return {
                ...prev,
                tutorialFormats: has
                    ? prev.tutorialFormats.filter(key => key !== formatKey)
                    : [...prev.tutorialFormats, formatKey],
            };
        });
    };

    const togglePriorityTool = (toolId: TutorialSurveyToolId) => {
        setForm(prev => {
            const has = prev.priorityTop3.includes(toolId);
            return {
                ...prev,
                priorityTop3: has
                    ? prev.priorityTop3.filter(id => id !== toolId)
                    : [...prev.priorityTop3, toolId],
            };
        });
    };

    const handleSubmit = async () => {
        setSaveMessage('');
        setErrorMessage('');
        if (!form.usedTools.length && !form.needTutorialTools.length) {
            setErrorMessage(text(language, '请至少选择一个“使用中”或“需要教程”的模块。', 'Please select at least one module in "Used" or "Need tutorial".'));
            return;
        }

        setSubmitting(true);
        try {
            await submitTutorialSurvey(
                {
                    ...form,
                    language,
                    userId: userId || null,
                    userEmail: userEmail || null,
                    appVersion,
                },
                TUTORIAL_SURVEY_KEY
            );
            markTutorialSurveyCompleted(TUTORIAL_SURVEY_KEY);
            onSubmitted?.();
            setSaveMessage(text(language, '已提交投票，感谢反馈。', 'Survey submitted. Thanks for your feedback.'));
            await refreshStats();
        } catch (err) {
            console.error('[TutorialSurveyModal] submit failed:', err);
            setErrorMessage(text(language, '提交失败，请稍后重试。', 'Submit failed. Please try again.'));
        } finally {
            setSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div
            style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(0,0,0,0.55)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 2000,
                padding: '20px',
            }}
            onMouseDown={onClose}
        >
            <div
                style={{
                    width: 'min(1180px, 96vw)',
                    maxHeight: '86vh',
                    background: 'var(--surface-color, #12131a)',
                    border: '1px solid var(--border-color, #2a2d35)',
                    borderRadius: '14px',
                    boxShadow: '0 16px 48px rgba(0,0,0,0.35)',
                    display: 'flex',
                    flexDirection: 'column',
                    overflow: 'hidden',
                }}
                onMouseDown={e => e.stopPropagation()}
            >
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    padding: '14px 18px',
                    borderBottom: '1px solid var(--border-color, #2a2d35)',
                    background: 'linear-gradient(180deg, rgba(67,56,202,0.15), rgba(67,56,202,0.04))',
                }}>
                    <div>
                        <div style={{ fontSize: '18px', fontWeight: 700, color: 'var(--text-color, #f5f7ff)' }}>
                            {text(language, '教程需求投票', 'Tutorial Demand Survey')}
                        </div>
                        <div style={{ fontSize: '12px', color: 'var(--text-muted-color, #9aa3b2)', marginTop: '2px' }}>
                            {text(language, '用于统计模块教程需求人数和教程优先级。', 'Used to track tutorial demand by module and tutorial priority.')}
                        </div>
                        <div style={{ fontSize: '12px', color: '#f59e0b', marginTop: '4px', fontWeight: 600 }}>
                            {text(language, '限时收集：2026-02-17 至 2026-02-20', 'Limited collection: 2026-02-17 to 2026-02-20')}
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        style={{
                            border: 'none',
                            background: 'transparent',
                            color: 'var(--text-muted-color, #a6adbb)',
                            cursor: 'pointer',
                            padding: '4px',
                            borderRadius: '6px',
                        }}
                    >
                        <X size={18} />
                    </button>
                </div>

                <div style={{
                    display: 'grid',
                    gridTemplateColumns: '1.2fr 1fr',
                    gap: '0',
                    minHeight: 0,
                    overflow: 'hidden',
                }}>
                    <div style={{ padding: '14px 18px', overflow: 'auto', borderRight: '1px solid var(--border-color, #2a2d35)' }}>
                        <div style={{ marginBottom: '14px', fontSize: '13px', color: 'var(--text-muted-color, #9aa3b2)' }}>
                            {text(language, '每期可重复修改提交，系统保留你最后一次结果。', 'You can resubmit and update your response anytime; latest response wins.')}
                        </div>

                        <section style={{ marginBottom: '16px' }}>
                            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--text-color, #f5f7ff)' }}>
                                {text(language, '1) 你在使用哪些模块？', '1) Which modules are you currently using?')}
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                                {TUTORIAL_SURVEY_TOOLS.map(item => {
                                    const checked = form.usedTools.includes(item.id);
                                    return (
                                        <label key={`used_${item.id}`} style={{
                                            display: 'flex',
                                            gap: '8px',
                                            alignItems: 'flex-start',
                                            padding: '8px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--border-color, #2a2d35)',
                                            background: checked ? 'rgba(34,197,94,0.12)' : 'transparent',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleTool('usedTools', item.id)}
                                            />
                                            <span>
                                                <strong style={{ color: 'var(--text-color, #f5f7ff)' }}>{text(language, item.labelZh, item.labelEn)}</strong>
                                                <span style={{ display: 'block', color: 'var(--text-muted-color, #9aa3b2)', marginTop: '2px' }}>
                                                    {text(language, item.purposeZh, item.purposeEn)}
                                                </span>
                                            </span>
                                        </label>
                                    );
                                })}
                            </div>
                        </section>

                        <section style={{ marginBottom: '16px' }}>
                            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--text-color, #f5f7ff)' }}>
                                {text(language, '2) 你需要哪些模块的教程？', '2) Which modules do you need tutorials for?')}
                            </h3>
                            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '6px' }}>
                                {TUTORIAL_SURVEY_TOOLS.map(item => {
                                    const checked = form.needTutorialTools.includes(item.id);
                                    return (
                                        <label key={`need_${item.id}`} style={{
                                            display: 'flex',
                                            gap: '8px',
                                            alignItems: 'center',
                                            padding: '8px',
                                            borderRadius: '8px',
                                            border: '1px solid var(--border-color, #2a2d35)',
                                            background: checked ? 'rgba(234,179,8,0.14)' : 'transparent',
                                            cursor: 'pointer',
                                            fontSize: '12px',
                                        }}>
                                            <input
                                                type="checkbox"
                                                checked={checked}
                                                onChange={() => toggleTool('needTutorialTools', item.id)}
                                            />
                                            <span style={{ color: 'var(--text-color, #f5f7ff)' }}>{text(language, item.labelZh, item.labelEn)}</span>
                                        </label>
                                    );
                                })}
                            </div>
                        </section>

                        <section style={{ marginBottom: '16px' }}>
                            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--text-color, #f5f7ff)' }}>
                                {text(language, '3) 你最想先学哪些模块？（不限数量，可多选）', '3) Which modules do you want to learn first? (No limit, multi-select)')}
                            </h3>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {TUTORIAL_SURVEY_TOOLS.map(item => {
                                    const active = form.priorityTop3.includes(item.id);
                                    return (
                                        <button
                                            key={`priority_${item.id}`}
                                            type="button"
                                            onClick={() => togglePriorityTool(item.id)}
                                            style={{
                                                borderRadius: '999px',
                                                border: '1px solid var(--border-color, #2a2d35)',
                                                padding: '6px 10px',
                                                fontSize: '12px',
                                                cursor: 'pointer',
                                                background: active ? 'rgba(168,85,247,0.22)' : 'transparent',
                                                color: active ? '#c4b5fd' : 'var(--text-color, #f5f7ff)',
                                            }}
                                        >
                                            {text(language, item.labelZh, item.labelEn)}
                                        </button>
                                    );
                                })}
                            </div>
                        </section>

                        <section style={{ marginBottom: '16px' }}>
                            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--text-color, #f5f7ff)' }}>
                                {text(language, '4) 你偏好的教程形式', '4) Preferred tutorial format')}
                            </h3>
                            <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                                {FORMAT_OPTIONS.map(opt => {
                                    const active = form.tutorialFormats.includes(opt.key);
                                    return (
                                        <button
                                            key={opt.key}
                                            type="button"
                                            onClick={() => toggleFormat(opt.key)}
                                            style={{
                                                borderRadius: '999px',
                                                border: '1px solid var(--border-color, #2a2d35)',
                                                padding: '6px 10px',
                                                fontSize: '12px',
                                                cursor: 'pointer',
                                                background: active ? 'rgba(59,130,246,0.2)' : 'transparent',
                                                color: active ? '#93c5fd' : 'var(--text-color, #f5f7ff)',
                                            }}
                                        >
                                            {text(language, opt.zh, opt.en)}
                                        </button>
                                    );
                                })}
                            </div>
                        </section>

                        <section style={{ marginBottom: '16px' }}>
                            <h3 style={{ margin: '0 0 8px', fontSize: '14px', color: 'var(--text-color, #f5f7ff)' }}>
                                {text(language, '5) 使用频率', '5) Usage frequency')}
                            </h3>
                            <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                                {FREQUENCY_OPTIONS.map(opt => (
                                    <label key={opt.key} style={{ fontSize: '12px', color: 'var(--text-color, #f5f7ff)', display: 'flex', alignItems: 'center', gap: '4px' }}>
                                        <input
                                            type="radio"
                                            name="survey_frequency"
                                            checked={form.usageFrequency === opt.key}
                                            onChange={() => setForm(prev => ({ ...prev, usageFrequency: opt.key }))}
                                        />
                                        {text(language, opt.zh, opt.en)}
                                    </label>
                                ))}
                            </div>
                        </section>

                        <section style={{ marginBottom: '16px' }}>
                            <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '12px', color: 'var(--text-color, #f5f7ff)' }}>
                                <input
                                    type="checkbox"
                                    checked={form.needOverallTutorial}
                                    onChange={e => setForm(prev => ({ ...prev, needOverallTutorial: e.target.checked }))}
                                />
                                {text(language, '我需要系统性教程（从入门到实战）', 'I need a systematic tutorial path (from basics to practical cases)')}
                            </label>
                        </section>

                        <section style={{ marginBottom: '12px' }}>
                            <textarea
                                value={form.notes}
                                onChange={e => setForm(prev => ({ ...prev, notes: e.target.value }))}
                                placeholder={text(language, '可选：补充你最希望看到的教程内容', 'Optional: tell us what tutorial content you want most')}
                                style={{
                                    width: '100%',
                                    minHeight: '72px',
                                    background: 'var(--surface-color, #12131a)',
                                    color: 'var(--text-color, #f5f7ff)',
                                    border: '1px solid var(--border-color, #2a2d35)',
                                    borderRadius: '8px',
                                    padding: '8px 10px',
                                    fontSize: '12px',
                                    resize: 'vertical',
                                }}
                            />
                        </section>

                        {errorMessage && <div style={{ color: '#f87171', fontSize: '12px', marginBottom: '8px' }}>{errorMessage}</div>}
                        {saveMessage && <div style={{ color: '#4ade80', fontSize: '12px', marginBottom: '8px' }}>{saveMessage}</div>}

                        <button
                            onClick={handleSubmit}
                            disabled={submitting}
                            style={{
                                width: '100%',
                                border: 'none',
                                borderRadius: '10px',
                                padding: '10px 12px',
                                fontSize: '13px',
                                fontWeight: 700,
                                cursor: submitting ? 'not-allowed' : 'pointer',
                                color: '#fff',
                                background: 'linear-gradient(135deg, #2563eb, #4f46e5)',
                                opacity: submitting ? 0.7 : 1,
                                display: 'flex',
                                justifyContent: 'center',
                                alignItems: 'center',
                                gap: '6px',
                            }}
                        >
                            {submitting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Check size={14} />}
                            {text(language, '提交投票', 'Submit Vote')}
                        </button>
                    </div>

                    <div style={{ padding: '14px 18px', overflow: 'auto' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px' }}>
                            <h3 style={{ margin: 0, fontSize: '14px', color: 'var(--text-color, #f5f7ff)', display: 'flex', alignItems: 'center', gap: '6px' }}>
                                <BarChart3 size={14} />
                                {text(language, '实时统计', 'Live Stats')}
                            </h3>
                            <button
                                onClick={refreshStats}
                                disabled={loadingStats}
                                style={{
                                    border: '1px solid var(--border-color, #2a2d35)',
                                    background: 'transparent',
                                    color: 'var(--text-muted-color, #9aa3b2)',
                                    borderRadius: '6px',
                                    padding: '4px 8px',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                }}
                            >
                                {loadingStats ? text(language, '刷新中...', 'Refreshing...') : text(language, '刷新', 'Refresh')}
                            </button>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '12px' }}>
                            <div style={{ border: '1px solid var(--border-color, #2a2d35)', borderRadius: '8px', padding: '10px' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted-color, #9aa3b2)' }}>{text(language, '总投票人数', 'Total responses')}</div>
                                <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--text-color, #f5f7ff)' }}>{stats?.totalResponses || 0}</div>
                            </div>
                            <div style={{ border: '1px solid var(--border-color, #2a2d35)', borderRadius: '8px', padding: '10px' }}>
                                <div style={{ fontSize: '11px', color: 'var(--text-muted-color, #9aa3b2)' }}>{text(language, '需要系统教程', 'Need full tutorial path')}</div>
                                <div style={{ fontSize: '20px', fontWeight: 700, color: '#fbbf24' }}>{stats?.totalNeedOverallTutorial || 0}</div>
                            </div>
                        </div>

                        <div style={{ border: '1px solid var(--border-color, #2a2d35)', borderRadius: '8px', overflow: 'hidden' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '12px' }}>
                                <thead>
                                    <tr style={{ background: 'rgba(148,163,184,0.08)' }}>
                                        <th style={{ textAlign: 'left', padding: '8px', color: 'var(--text-muted-color, #9aa3b2)' }}>{text(language, '模块', 'Module')}</th>
                                        <th style={{ textAlign: 'center', padding: '8px', color: 'var(--text-muted-color, #9aa3b2)' }}>{text(language, '在用', 'Using')}</th>
                                        <th style={{ textAlign: 'center', padding: '8px', color: 'var(--text-muted-color, #9aa3b2)' }}>{text(language, '要教程', 'Need')}</th>
                                        <th style={{ textAlign: 'center', padding: '8px', color: 'var(--text-muted-color, #9aa3b2)' }}>
                                            {text(language, '投票数', 'Votes')}
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {sortedToolRows.map(row => (
                                        <tr key={row.id} style={{ borderTop: '1px solid var(--border-color, #2a2d35)' }}>
                                            <td style={{ padding: '8px', color: 'var(--text-color, #f5f7ff)' }}>{text(language, row.labelZh, row.labelEn)}</td>
                                            <td style={{ padding: '8px', textAlign: 'center', color: '#93c5fd' }}>{row.usedCount}</td>
                                            <td style={{ padding: '8px', textAlign: 'center', color: '#facc15' }}>{row.needTutorialCount}</td>
                                            <td style={{ padding: '8px', textAlign: 'center', color: '#c4b5fd' }}>{row.priorityScore}</td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {stats?.lastClientSubmittedAt && (
                            <div style={{ marginTop: '8px', fontSize: '11px', color: 'var(--text-muted-color, #9aa3b2)' }}>
                                {text(language, '最近提交', 'Latest submit')}: {new Date(stats.lastClientSubmittedAt).toLocaleString()}
                            </div>
                        )}
                    </div>
                </div>
            </div>
            <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
        </div>
    );
};

export default TutorialSurveyModal;
