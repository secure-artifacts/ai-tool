import React, { useCallback, useEffect, useState } from 'react';
import { X, Lock, Send, MessageSquare, Loader2 } from 'lucide-react';
import {
    collection,
    doc,
    getDocs,
    query,
    serverTimestamp,
    setDoc,
    where,
    orderBy,
} from 'firebase/firestore';
import { db } from '@/firebase/index';

interface TutorialSurveyResultsProps {
    isOpen: boolean;
    onClose: () => void;
}

interface ResultRow {
    module: string;
    recordingStatus: string;
    note: string;
    usedCount: number;
    needTutorialCount: number;
    voteCount: number;
    hasLink?: boolean;
    tutorialLink?: string;
    highlightNote?: boolean;
}

interface FeedbackItem {
    id: string;
    text: string;
    author: string;
    createdAt: string;
}

// 锁定的投票结果数据（按截图顺序排列）
const RESULTS_DATA: ResultRow[] = [
    { module: '反推提示词', recordingStatus: '筹备录制ing', note: '', usedCount: 44, needTutorialCount: 40, voteCount: 35 },
    { module: 'AI 图片识别', recordingStatus: '筹备录制ing', note: '', usedCount: 34, needTutorialCount: 38, voteCount: 29 },
    { module: '提示词工具', recordingStatus: '筹备录制ing', note: '', usedCount: 32, needTutorialCount: 42, voteCount: 33 },
    { module: '智能翻译', recordingStatus: '筹备录制ing', note: '', usedCount: 6, needTutorialCount: 14, voteCount: 6 },
    { module: '专业文案查重', recordingStatus: '筹备录制ing', note: '', usedCount: 3, needTutorialCount: 6, voteCount: 3 },
    { module: '图片前景文字提取', recordingStatus: '筹备录制ing', note: '', usedCount: 5, needTutorialCount: 13, voteCount: 11 },
    { module: '文案拆分', recordingStatus: '筹备录制ing', note: '', usedCount: 8, needTutorialCount: 9, voteCount: 13 },
    { module: '生成子邮箱', recordingStatus: '筹备录制ing', note: '', usedCount: 11, needTutorialCount: 19, voteCount: 14 },
    { module: 'AI 一键修图', recordingStatus: '之前有教程录屏', note: '教程已删除，建议使用现在的 Opal 工作流代替（批量修改图片换背景、换风格）。', usedCount: 43, needTutorialCount: 41, voteCount: 40 },
    { module: 'AI 图片编辑器', recordingStatus: '之前有教程录屏', note: '教程链接', usedCount: 22, needTutorialCount: 33, voteCount: 33, hasLink: true, tutorialLink: 'https://drive.google.com/drive/folders/1wR5M0hLOIi307Hr6y9axExPG5Cxx-tQ2' },
    { module: '模版指令+随机库生成器', recordingStatus: '', note: '涉及到工作流，计划会在工作流学习组专门分享使用方法。', usedCount: 25, needTutorialCount: 37, voteCount: 33, highlightNote: true },
    { module: '表格数据分析', recordingStatus: '', note: '功能比较局限使用的人员，且复杂，并且只是涉及到月底图片视频总结使用，所以暂时不考虑录屏。如果有需要可以再单独找我，之后考虑录制一个他的作用的录屏。', usedCount: 5, needTutorialCount: 11, voteCount: 8 },
    { module: '图片审核', recordingStatus: '', note: '涉及到给外国新人反馈生图和视频效果建议，如果有需要可以单独找我了解使用方法。', usedCount: 2, needTutorialCount: 10, voteCount: 9 },
    { module: 'AI 思维导图', recordingStatus: '', note: '目前测试中，有点复杂，而且现在实用性还比较低，暂时不分享，有兴趣的可以自己研究使用。', usedCount: 5, needTutorialCount: 12, voteCount: 8 },
    { module: 'API 生图', recordingStatus: '', note: '必须使用付费api且费用较高，不实用所以不分享使用方法。', usedCount: 9, needTutorialCount: 23, voteCount: 22 },
    { module: '指令模版', recordingStatus: '', note: '比较老的一个写指令的工具，目前有些opal工作流的快捷方法所以这个就不分享使用方法了。', usedCount: 12, needTutorialCount: 23, voteCount: 15 },
    { module: 'AI 工具集', recordingStatus: '', note: '收集的常用软件，直接看就行', usedCount: 3, needTutorialCount: 17, voteCount: 15 },
    { module: 'AI 文案去重', recordingStatus: '', note: '没有专业文案去重工具好用，不推荐所以不分享教程。', usedCount: 2, needTutorialCount: 6, voteCount: 2 },
    { module: '教程检索', recordingStatus: '', note: '目前仅适用于欧洲区几个小区的教程库，已经欧洲区范围分享使用方法，涉及到教程库的收集整理，所以不大范围分享了。', usedCount: 4, needTutorialCount: 4, voteCount: 7 },
];

const FEEDBACK_COLLECTION = 'publicSync';
const FEEDBACK_TYPE = 'tutorialFeedback';

const TutorialSurveyResults: React.FC<TutorialSurveyResultsProps> = ({ isOpen, onClose }) => {
    const [feedbacks, setFeedbacks] = useState<FeedbackItem[]>([]);
    const [feedbackText, setFeedbackText] = useState('');
    const [feedbackAuthor, setFeedbackAuthor] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isLoadingFeedback, setIsLoadingFeedback] = useState(false);
    const [activeTab, setActiveTab] = useState<'results' | 'feedback'>('results');

    // 加载反馈
    const loadFeedbacks = useCallback(async () => {
        setIsLoadingFeedback(true);
        try {
            const q = query(
                collection(db, FEEDBACK_COLLECTION),
                where('type', '==', FEEDBACK_TYPE)
            );
            const snapshot = await getDocs(q);
            const items: FeedbackItem[] = snapshot.docs
                .map(d => {
                    const data = d.data();
                    return {
                        id: d.id,
                        text: data.text || '',
                        author: data.author || '匿名',
                        createdAt: data.clientCreatedAt || '',
                    };
                })
                .filter(item => item.text.trim())
                .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
            setFeedbacks(items);
        } catch (err) {
            console.error('Failed to load feedbacks:', err);
        } finally {
            setIsLoadingFeedback(false);
        }
    }, []);

    useEffect(() => {
        if (isOpen) {
            loadFeedbacks();
            // 恢复昵称
            try {
                const saved = localStorage.getItem('tutorial_feedback_author');
                if (saved) setFeedbackAuthor(saved);
            } catch { }
        }
    }, [isOpen, loadFeedbacks]);

    // 提交反馈
    const handleSubmitFeedback = async () => {
        if (!feedbackText.trim() || isSubmitting) return;
        setIsSubmitting(true);
        try {
            const docId = `feedback_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
            const author = feedbackAuthor.trim() || '匿名';
            await setDoc(doc(db, FEEDBACK_COLLECTION, docId), {
                type: FEEDBACK_TYPE,
                text: feedbackText.trim(),
                author,
                clientCreatedAt: new Date().toISOString(),
                updatedAt: serverTimestamp(),
            });
            // 保存昵称
            try { localStorage.setItem('tutorial_feedback_author', author); } catch { }
            setFeedbackText('');
            await loadFeedbacks();
        } catch (err) {
            console.error('Failed to submit feedback:', err);
        } finally {
            setIsSubmitting(false);
        }
    };

    if (!isOpen) return null;

    return (
        <div style={{
            position: 'fixed', inset: 0, zIndex: 9999,
            background: 'rgba(0,0,0,0.75)', backdropFilter: 'blur(6px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: '20px',
        }} onClick={onClose}>
            <div style={{
                background: 'var(--surface-color, #1a1a2e)',
                border: '1px solid var(--border-color, #333)',
                borderRadius: '16px',
                width: '100%',
                maxWidth: '1000px',
                maxHeight: '90vh',
                display: 'flex',
                flexDirection: 'column',
                overflow: 'hidden',
                boxShadow: '0 24px 80px rgba(0,0,0,0.6)',
            }} onClick={e => e.stopPropagation()}>
                {/* Header */}
                <div style={{
                    padding: '16px 20px 0',
                    display: 'flex', flexDirection: 'column', gap: '12px',
                }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <Lock size={18} style={{ color: '#fbbf24' }} />
                        <div style={{ flex: 1 }}>
                            <h2 style={{ margin: 0, fontSize: '16px', fontWeight: 700, color: 'var(--text-color, #e0e0e0)' }}>
                                教程需求投票结果
                            </h2>
                            <p style={{ margin: '4px 0 0', fontSize: '12px', color: 'var(--text-muted-color, #888)', lineHeight: 1.5 }}>
                                投票已结束 · 结果已锁定 · 收集时间：2026-02-17 至 2026-02-20
                                <br />
                                <span style={{ color: '#93c5fd' }}>本应用会随时更新完善新的功能（根据现实需求改进和新增功能），如果你有好的功能建议想法，可以填写旁边的「<span style={{ color: '#fbbf24', fontWeight: 600 }}>反馈建议</span>」。</span>
                                <br />
                                <span style={{ color: '#f87171' }}>注意：不要留下联系方式，可以单独添加我。</span>
                            </p>
                        </div>
                        <button
                            onClick={onClose}
                            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted-color, #888)', padding: '4px' }}
                        >
                            <X size={20} />
                        </button>
                    </div>
                    {/* Tabs */}
                    <div style={{ display: 'flex', gap: '0', borderBottom: '1px solid var(--border-color, #333)' }}>
                        <button
                            onClick={() => setActiveTab('results')}
                            style={{
                                padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                                background: 'transparent',
                                color: activeTab === 'results' ? '#fbbf24' : 'var(--text-muted-color, #888)',
                                borderBottom: activeTab === 'results' ? '2px solid #fbbf24' : '2px solid transparent',
                                transition: 'all 0.2s',
                            }}
                        >
                            <Lock size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
                            投票结果
                        </button>
                        <button
                            onClick={() => setActiveTab('feedback')}
                            style={{
                                padding: '8px 16px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 600,
                                background: 'transparent',
                                color: activeTab === 'feedback' ? '#60a5fa' : 'var(--text-muted-color, #888)',
                                borderBottom: activeTab === 'feedback' ? '2px solid #60a5fa' : '2px solid transparent',
                                transition: 'all 0.2s',
                            }}
                        >
                            <MessageSquare size={12} style={{ marginRight: 4, verticalAlign: -1 }} />
                            反馈建议 {feedbacks.length > 0 && `(${feedbacks.length})`}
                        </button>
                    </div>
                </div>

                {/* Content */}
                {activeTab === 'results' ? (
                    <>
                        {/* Table */}
                        <div style={{ flex: 1, overflow: 'auto', padding: '0' }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '13px' }}>
                                <thead>
                                    <tr style={{
                                        position: 'sticky', top: 0, zIndex: 2,
                                        background: 'var(--bg-secondary, #151525)',
                                    }}>
                                        <th style={thStyle}>模块</th>
                                        <th style={{ ...thStyle, minWidth: '200px' }}>录制情况</th>
                                        <th style={{ ...thStyle, width: '70px', textAlign: 'center' }}>在用</th>
                                        <th style={{ ...thStyle, width: '70px', textAlign: 'center', color: '#fbbf24' }}>要教程</th>
                                        <th style={{ ...thStyle, width: '70px', textAlign: 'center' }}>投票数</th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {RESULTS_DATA.map((row, i) => {
                                        const isPreparing = row.recordingStatus === '筹备录制ing';
                                        const hasExisting = row.recordingStatus === '之前有教程录屏';
                                        const hasNote = !!row.note && !row.hasLink;

                                        return (
                                            <tr key={i} style={{
                                                borderBottom: '1px solid rgba(255,255,255,0.06)',
                                                transition: 'background 0.15s',
                                            }}
                                                onMouseEnter={e => (e.currentTarget.style.background = 'rgba(255,255,255,0.03)')}
                                                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
                                            >
                                                <td style={{ ...tdStyle, fontWeight: 600, color: isPreparing ? '#93c5fd' : 'var(--text-color, #e0e0e0)' }}>
                                                    {row.module}
                                                </td>
                                                <td style={{ ...tdStyle, fontSize: '12px' }}>
                                                    <div style={{ display: 'flex', flexDirection: 'column', gap: '2px' }}>
                                                        {isPreparing && (
                                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', color: '#60a5fa', fontSize: '12px' }}>
                                                                <span style={{ display: 'inline-block', width: '6px', height: '6px', borderRadius: '50%', background: '#60a5fa' }} />
                                                                筹备录制ing
                                                            </span>
                                                        )}
                                                        {hasExisting && (
                                                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                                                <span style={{ color: '#4ade80', fontSize: '12px' }}>之前有教程录屏</span>
                                                                {row.hasLink && (
                                                                    row.tutorialLink ? (
                                                                        <a
                                                                            href={row.tutorialLink}
                                                                            target="_blank"
                                                                            rel="noopener noreferrer"
                                                                            style={{
                                                                                padding: '1px 6px', borderRadius: '3px', fontSize: '10px',
                                                                                background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80',
                                                                                border: '1px solid rgba(74, 222, 128, 0.3)',
                                                                                textDecoration: 'none', cursor: 'pointer',
                                                                            }}
                                                                        >教程链接 ↗</a>
                                                                    ) : (
                                                                        <span style={{
                                                                            padding: '1px 6px', borderRadius: '3px', fontSize: '10px',
                                                                            background: 'rgba(74, 222, 128, 0.15)', color: '#4ade80',
                                                                            border: '1px solid rgba(74, 222, 128, 0.3)',
                                                                        }}>教程链接</span>
                                                                    )
                                                                )}
                                                            </div>
                                                        )}
                                                        {hasNote && (
                                                            <span style={{
                                                                color: row.highlightNote ? '#fbbf24' : 'var(--text-muted-color, #888)',
                                                                fontSize: '11px', lineHeight: 1.4,
                                                                fontWeight: row.highlightNote ? 600 : 'normal',
                                                            }}>
                                                                {row.note}
                                                            </span>
                                                        )}
                                                        {!isPreparing && !hasExisting && !hasNote && (
                                                            <span style={{ color: 'var(--text-muted-color, #555)' }}>—</span>
                                                        )}
                                                    </div>
                                                </td>
                                                <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace' }}>{row.usedCount}</td>
                                                <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace', color: '#fbbf24', fontWeight: 700 }}>{row.needTutorialCount}</td>
                                                <td style={{ ...tdStyle, textAlign: 'center', fontFamily: 'monospace' }}>{row.voteCount}</td>
                                            </tr>
                                        );
                                    })}
                                </tbody>
                            </table>
                        </div>
                        {/* Footer */}
                        <div style={{
                            padding: '10px 20px',
                            borderTop: '1px solid var(--border-color, #333)',
                            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                            fontSize: '12px', color: 'var(--text-muted-color, #888)',
                        }}>
                            <span>共 {RESULTS_DATA.length} 个模块 · 投票已关闭</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                                <Lock size={12} /> 结果已锁定
                            </span>
                        </div>
                    </>
                ) : (
                    /* 反馈建议 Tab */
                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
                        {/* 留言列表 */}
                        <div style={{ flex: 1, overflow: 'auto', padding: '12px 20px' }}>
                            {isLoadingFeedback ? (
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '40px', color: 'var(--text-muted-color, #888)' }}>
                                    <Loader2 size={20} style={{ animation: 'spin 1s linear infinite', marginRight: 8 }} />
                                    加载中...
                                </div>
                            ) : feedbacks.length === 0 ? (
                                <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '40px', color: 'var(--text-muted-color, #666)', gap: '8px' }}>
                                    <MessageSquare size={32} style={{ opacity: 0.3 }} />
                                    <span>暂无反馈，来留个言吧～</span>
                                </div>
                            ) : (
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {feedbacks.map(fb => (
                                        <div key={fb.id} style={{
                                            padding: '10px 14px',
                                            borderRadius: '8px',
                                            background: 'rgba(255,255,255,0.03)',
                                            border: '1px solid rgba(255,255,255,0.06)',
                                        }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '6px' }}>
                                                <span style={{
                                                    padding: '1px 8px', borderRadius: '10px', fontSize: '11px', fontWeight: 600,
                                                    background: 'rgba(96, 165, 250, 0.15)', color: '#93c5fd',
                                                    border: '1px solid rgba(96, 165, 250, 0.2)',
                                                }}>
                                                    {fb.author}
                                                </span>
                                                <span style={{ fontSize: '11px', color: 'var(--text-muted-color, #666)' }}>
                                                    {fb.createdAt ? new Date(fb.createdAt).toLocaleString('zh-CN', { month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''}
                                                </span>
                                            </div>
                                            <p style={{ margin: 0, fontSize: '13px', lineHeight: 1.6, color: 'var(--text-color, #e0e0e0)', whiteSpace: 'pre-wrap' }}>
                                                {fb.text}
                                            </p>
                                        </div>
                                    ))}
                                </div>
                            )}
                        </div>

                        {/* 发留言 */}
                        <div style={{
                            padding: '12px 20px',
                            borderTop: '1px solid var(--border-color, #333)',
                            display: 'flex', flexDirection: 'column', gap: '8px',
                            flexShrink: 0,
                        }}>
                            <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                                <input
                                    type="text"
                                    placeholder="昵称（选填）"
                                    value={feedbackAuthor}
                                    onChange={e => setFeedbackAuthor(e.target.value)}
                                    style={{
                                        width: '100px', padding: '6px 10px', borderRadius: '6px', fontSize: '12px',
                                        border: '1px solid var(--border-color, #444)', background: 'var(--background-color, #111)',
                                        color: 'var(--text-color, #e0e0e0)', outline: 'none',
                                    }}
                                />
                                <textarea
                                    placeholder="写下你的反馈或改进建议..."
                                    value={feedbackText}
                                    onChange={e => setFeedbackText(e.target.value)}
                                    onKeyDown={e => {
                                        if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && feedbackText.trim()) {
                                            handleSubmitFeedback();
                                        }
                                    }}
                                    rows={2}
                                    style={{
                                        flex: 1, padding: '6px 10px', borderRadius: '6px', fontSize: '12px',
                                        border: '1px solid var(--border-color, #444)', background: 'var(--background-color, #111)',
                                        color: 'var(--text-color, #e0e0e0)', outline: 'none', resize: 'none',
                                        fontFamily: 'inherit',
                                    }}
                                />
                                <button
                                    onClick={handleSubmitFeedback}
                                    disabled={!feedbackText.trim() || isSubmitting}
                                    style={{
                                        padding: '8px 16px', borderRadius: '6px', fontSize: '12px', fontWeight: 600,
                                        border: 'none', cursor: 'pointer',
                                        background: feedbackText.trim() ? 'rgba(96, 165, 250, 0.3)' : 'rgba(255,255,255,0.05)',
                                        color: feedbackText.trim() ? '#93c5fd' : 'var(--text-muted-color, #666)',
                                        display: 'flex', alignItems: 'center', gap: '4px',
                                        transition: 'all 0.2s',
                                        alignSelf: 'flex-end',
                                    }}
                                >
                                    {isSubmitting ? <Loader2 size={14} style={{ animation: 'spin 1s linear infinite' }} /> : <Send size={14} />}
                                    发送
                                </button>
                            </div>
                            <span style={{ fontSize: '10px', color: 'var(--text-muted-color, #666)' }}>
                                Ctrl+Enter 快速发送 · 所有人可见
                            </span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

const thStyle: React.CSSProperties = {
    padding: '10px 12px',
    textAlign: 'left',
    borderBottom: '2px solid rgba(255,255,255,0.1)',
    color: 'var(--text-muted-color, #aaa)',
    fontWeight: 600,
    fontSize: '12px',
    whiteSpace: 'nowrap',
};

const tdStyle: React.CSSProperties = {
    padding: '10px 12px',
    color: 'var(--text-color, #e0e0e0)',
    verticalAlign: 'top',
};

export default TutorialSurveyResults;
