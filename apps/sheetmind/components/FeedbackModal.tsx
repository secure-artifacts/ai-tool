import React, { useState } from 'react';
import AnnotationEditor from './AnnotationEditor';

interface FeedbackModalProps {
    imageUrl: string;
    previewUrls?: string[];
    feedbackText: string;
    annotatedDataUrl: string | null;
    gyazoUrl: string | null;
    gyazoPermalink: string | null;
    uploading: boolean;
    onSave: (data: { text: string; annotatedDataUrl: string | null }) => void;
    onCancel: () => void;
}

const FeedbackModal: React.FC<FeedbackModalProps> = ({
    imageUrl,
    previewUrls,
    feedbackText,
    annotatedDataUrl,
    uploading,
    onSave,
    onCancel,
}) => {
    const [currentText, setCurrentText] = useState(feedbackText);

    return (
        <div style={{
            position: 'fixed', top: 0, left: 0, width: '100vw', height: '100vh',
            background: 'rgba(0,0,0,0.85)', zIndex: 999999,
            display: 'flex', flexDirection: 'column'
        }}>
            {uploading ? (
                <div style={{ flex: 1, display: 'flex', justifyContent: 'center', alignItems: 'center', color: 'white' }}>
                    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                        <div style={{ width: 32, height: 32, border: '4px solid #3b82f6', borderTopColor: 'transparent', borderRadius: '50%', animation: 'spin 1s linear infinite', marginBottom: 16 }}></div>
                        <div>上传中，请稍候...</div>
                    </div>
                </div>
            ) : (
                <AnnotationEditor
                    imageUrl={annotatedDataUrl || imageUrl}
                    previewUrls={annotatedDataUrl ? undefined : previewUrls}
                    feedbackText={currentText}
                    onFeedbackTextChange={setCurrentText}
                    onSave={(dataUrl, text, meta) => {
                        onSave({
                            text: text || currentText,
                            annotatedDataUrl: meta?.hasVisualChanges ? dataUrl : null,
                        });
                    }}
                    onCancel={onCancel}
                />
            )}
        </div>
    );
};

export default FeedbackModal;
