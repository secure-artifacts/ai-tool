export interface FeedbackSubmission {
    userName: string;
    feedbackType: 'suggestion' | 'bug';
    title: string;
    description: string;
    timestamp: string;
}

const FEEDBACK_SHEET_ID = '1InDrlrypvb_5xwtNCmqYIUuWL5cm7YNbBaCvJuEY9D0'; // 软件目录的表格 ID
const FEEDBACK_SUBMIT_URL = 'https://script.google.com/macros/s/AKfycbw9isNUlIuSST9DxOV-d8hfpfp85_fMJnRLJJRBcNPVMvw5ut83ShNGS-S8Fht99nKvsg/exec';

export async function submitFeedback(feedback: Omit<FeedbackSubmission, 'timestamp'>): Promise<void> {
    if (!feedback.userName || !feedback.title || !feedback.description) {
        throw new Error('请填写所有必填字段');
    }

    const timestamp = new Date().toISOString();
    const feedbackTypeText = feedback.feedbackType === 'suggestion' ? '💡 功能建议' : '🐛 Bug反馈';

    // 使用与 softwareService.submitSoftware 相同的格式
    const payload = {
        mode: 'create',  // 使用 create 模式
        data: {
            category: feedback.feedbackType === 'suggestion' ? '功能建议' : 'Bug反馈',
            name: `[反馈] ${feedbackTypeText}: ${feedback.title}`,
            summary: feedback.description,
            website: '',
            usageLevel: '',
            rating: '',
            safety: '',
            copyrightLink: '',
            tutorial: '',
            comments: `提交者: ${feedback.userName || '匿名用户'}`,
            icon: ''
        },
        submittedAt: timestamp
    };

    try {
        await fetch(FEEDBACK_SUBMIT_URL, {
            method: 'POST',
            mode: 'no-cors',
            redirect: 'follow',
            headers: {
                'Content-Type': 'text/plain;charset=utf-8'
            },
            body: JSON.stringify(payload)
        });
    } catch (error) {
        console.error('Failed to submit feedback:', error);
        throw new Error('提交反馈失败，请稍后重试。');
    }
}
