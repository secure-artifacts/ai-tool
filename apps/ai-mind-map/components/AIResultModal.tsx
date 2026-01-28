import { useEffect, useState } from 'react';

interface AIResultModalProps {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  content: string;
}

export const AIResultModal: React.FC<AIResultModalProps> = ({ isOpen, onClose, title, content }) => {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (isOpen) setCopied(false);
  }, [isOpen]);

  if (!isOpen) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="ai-result-backdrop">
      <div className="ai-result-modal">
        <div className="ai-result-header">
          <h3>{title}</h3>
          <button onClick={onClose}>×</button>
        </div>
        <div className="ai-result-body">
          <textarea readOnly value={content} />
        </div>
        <div className="ai-result-footer">
          <button onClick={handleCopy}>{copied ? '已复制' : '复制全文'}</button>
        </div>
      </div>
    </div>
  );
};
