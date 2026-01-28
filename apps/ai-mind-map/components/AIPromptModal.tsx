import { useState, useEffect } from 'react';

interface AIPromptModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (instruction: string) => void;
  topic?: string;
  isLoading?: boolean;
}

const PRESETS = [
  { label: '极致细化', value: '用更细的步骤、方法、案例补齐内容。' },
  { label: '多角度分析', value: '从不同视角补充子主题，覆盖优缺点、风险与机会。' },
  { label: '可执行方案', value: '输出可执行的步骤、工具与检查清单。' },
  { label: '案例补充', value: '补充真实或典型的案例与场景。' },
];

export const AIPromptModal: React.FC<AIPromptModalProps> = ({ isOpen, onClose, onSubmit, topic, isLoading }) => {
  const [instruction, setInstruction] = useState('');

  useEffect(() => {
    if (isOpen) {
      setInstruction('');
    }
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="ai-prompt-backdrop">
      <div className="ai-prompt-modal">
        <div className="ai-prompt-header">
          <div>
            <h3>AI 深度扩展</h3>
            {topic && <p className="ai-prompt-topic">当前节点：{topic}</p>}
          </div>
          <button className="ai-prompt-close" onClick={onClose}>×</button>
        </div>

        <div className="ai-prompt-content">
          <div className="ai-prompt-presets">
            {PRESETS.map((preset) => (
              <button
                key={preset.label}
                className="preset-btn"
                onClick={() => setInstruction(preset.value)}
              >
                {preset.label}
              </button>
            ))}
          </div>

          <textarea
            className="ai-prompt-textarea"
            placeholder="输入你希望 AI 如何扩展这个节点…"
            value={instruction}
            onChange={(e) => setInstruction(e.target.value)}
          />
        </div>

        <div className="ai-prompt-footer">
          <button className="ai-prompt-cancel" onClick={onClose} disabled={isLoading}>取消</button>
          <button
            className="ai-prompt-submit"
            onClick={() => onSubmit(instruction)}
            disabled={isLoading}
          >
            {isLoading ? '生成中...' : '生成扩展'}
          </button>
        </div>
      </div>
    </div>
  );
};
