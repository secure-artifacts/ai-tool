import React, { useState } from 'react';
import { submitFeedback } from '../services/feedbackService';
import { Lightbulb, Bug, Check, X } from 'lucide-react';

interface FeedbackModalProps {
    onClose: () => void;
    userEmail: string;
}

const FeedbackModal: React.FC<FeedbackModalProps> = ({ onClose, userEmail }) => {
    const [feedbackType, setFeedbackType] = useState<'suggestion' | 'bug'>('suggestion');
    const [title, setTitle] = useState('');
    const [description, setDescription] = useState('');
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState(false);

    const handleSubmit = async (e: React.FormEvent) => {
        e.preventDefault();
        setError(null);
        setIsSubmitting(true);

        try {
            await submitFeedback({
                userName: userEmail || '匿名用户',
                feedbackType,
                title,
                description
            });
            setSuccess(true);
            setTimeout(() => {
                onClose();
            }, 2000);
        } catch (err: any) {
            setError(err.message || '提交失败，请稍后重试');
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="modal-backdrop" onClick={onClose}>
            <div className="modal-content feedback-modal" onClick={(e) => e.stopPropagation()}>
                <div className="modal-header">
                    <h2><Lightbulb size={18} className="inline mr-1" /> 建议反馈</h2>
                    <button onClick={onClose} className="modal-close-btn" aria-label="关闭"><X size={16} /></button>
                </div>

                {success ? (
                    <div className="feedback-success">
                        <div className="success-icon"><Check size={24} /></div>
                        <p>感谢您的反馈！我们已收到您的建议。</p>
                    </div>
                ) : (
                    <form onSubmit={handleSubmit} className="feedback-form">
                        <div className="form-field">
                            <label>反馈类型</label>
                            <div className="feedback-type-selector">
                                <button
                                    type="button"
                                    className={`type-btn ${feedbackType === 'suggestion' ? 'active' : ''}`}
                                    onClick={() => setFeedbackType('suggestion')}
                                >
                                    <Lightbulb size={14} className="inline mr-1" /> 功能建议
                                </button>
                                <button
                                    type="button"
                                    className={`type-btn ${feedbackType === 'bug' ? 'active' : ''}`}
                                    onClick={() => setFeedbackType('bug')}
                                >
                                    <Bug size={14} className="inline mr-1" /> Bug 反馈
                                </button>
                            </div>
                        </div>

                        <div className="form-field">
                            <label htmlFor="feedback-title">标题 *</label>
                            <input
                                id="feedback-title"
                                type="text"
                                value={title}
                                onChange={(e) => setTitle(e.target.value)}
                                placeholder={feedbackType === 'suggestion' ? '简要描述您的建议...' : '简要描述遇到的问题...'}
                                required
                                maxLength={100}
                            />
                        </div>

                        <div className="form-field">
                            <label htmlFor="feedback-description">详细说明 *</label>
                            <textarea
                                id="feedback-description"
                                value={description}
                                onChange={(e) => setDescription(e.target.value)}
                                placeholder={
                                    feedbackType === 'suggestion'
                                        ? '请详细描述您希望添加的功能或改进的地方...'
                                        : '请详细描述问题出现的场景、步骤和预期结果...'
                                }
                                required
                                rows={6}
                                maxLength={1000}
                            />
                            <small className="char-count">{description.length}/1000</small>
                        </div>

                        {error && <div className="error-message">{error}</div>}

                        <div className="modal-actions">
                            <button type="button" onClick={onClose} className="btn btn-secondary">
                                取消
                            </button>
                            <button type="submit" className="btn btn-primary" disabled={isSubmitting || !title || !description}>
                                {isSubmitting ? '提交中...' : '提交反馈'}
                            </button>
                        </div>
                    </form>
                )}
            </div>
        </div>
    );
};

export default FeedbackModal;
