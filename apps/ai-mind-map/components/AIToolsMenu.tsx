import { useEffect, useRef, useState } from 'react';
import {
  Sparkles,
  Lightbulb,
  ListTodo,
  Wand2,
  Shuffle,
  BookOpen,
  ShieldAlert,
  Clapperboard,
  ChevronDown
} from 'lucide-react';

type Action =
  | 'cultivate'
  | 'wbs'
  | 'optimize'
  | 'regroup'
  | 'explain'
  | 'desensitize'
  | 'video_script'
  | 'cluster';

interface AIToolsMenuProps {
  disabled: boolean;
  isProcessing?: boolean;
  onAction: (action: Action) => void;
}

const MENU_ITEMS: Array<{
  id: Action;
  label: string;
  desc: string;
  icon: typeof Sparkles;
  color: string;
  isNew?: boolean;
}> = [
    {
      id: 'cultivate',
      label: '培养想法 (Idea)',
      desc: '发散性思维，生成相关灵感',
      icon: Lightbulb,
      color: 'text-yellow-600 bg-yellow-50',
    },
    {
      id: 'wbs',
      label: '工作分解 (WBS)',
      desc: '将任务拆解为执行步骤',
      icon: ListTodo,
      color: 'text-blue-600 bg-blue-50',
    },
    {
      id: 'optimize',
      label: '地图优化 (Optimize)',
      desc: '润色文案，使其更专业',
      icon: Wand2,
      color: 'text-purple-600 bg-purple-50',
    },
    {
      id: 'regroup',
      label: '改组 (Regroup)',
      desc: '按 MECE 原则重新分类',
      icon: Shuffle,
      color: 'text-green-600 bg-green-50',
    },
    {
      id: 'cluster',
      label: '语义聚类 (Cluster)',
      desc: '自动分组并生成分类',
      icon: Shuffle,
      color: 'text-teal-600 bg-teal-50',
    },
    {
      id: 'video_script',
      label: '视频脚本 (Script)',
      desc: '生成 AI 视频提示词与脚本',
      icon: Clapperboard,
      color: 'text-pink-600 bg-pink-50',
      isNew: true,
    },
    {
      id: 'explain',
      label: '解释 (Explain)',
      desc: '生成定义和解释说明',
      icon: BookOpen,
      color: 'text-gray-600 bg-gray-100',
    },
    {
      id: 'desensitize',
      label: '数据脱敏 (Mask)',
      desc: '自动隐藏敏感信息',
      icon: ShieldAlert,
      color: 'text-red-600 bg-red-50',
    },
  ];

export const AIToolsMenu: React.FC<AIToolsMenuProps> = ({ disabled, isProcessing, onAction }) => {
  const [open, setOpen] = useState(false);
  const [dropdownPos, setDropdownPos] = useState({ top: 0, left: 0, maxHeight: 400 });
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, []);

  const handleToggle = () => {
    if (!open && triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const viewportHeight = window.innerHeight;
      const spaceBelow = viewportHeight - rect.bottom - 20; // 20px margin from bottom
      setDropdownPos({
        top: rect.bottom + 8,
        left: rect.left,
        maxHeight: Math.max(200, spaceBelow) // minimum 200px
      });
    }
    setOpen(!open);
  };

  const handleSelect = (action: Action) => {
    if (disabled) {
      alert('请先选择一个节点');
      return;
    }
    onAction(action);
    setOpen(false);
  };

  return (
    <div className="ai-tools-menu-v2" ref={menuRef}>
      <button
        ref={triggerRef}
        className={`ai-tools-trigger-v2 ${open ? 'open' : ''}`}
        onClick={handleToggle}
        disabled={disabled && !open}
      >
        <Sparkles size={16} className="trigger-icon" />
        <span>AI 智能工具</span>
        <ChevronDown size={14} className={`chevron ${open ? 'rotate' : ''}`} />
      </button>

      {open && (
        <div
          className="ai-tools-dropdown-v2"
          style={{
            position: 'fixed',
            top: dropdownPos.top,
            left: dropdownPos.left,
            maxHeight: dropdownPos.maxHeight,
            overflowY: 'auto',
          }}
        >
          <div className="dropdown-header">
            <span className="header-title">XMind Copilot 功能集</span>
            {isProcessing && <span className="processing-badge">处理中...</span>}
          </div>

          <div className="dropdown-items">
            {MENU_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.id}
                  className={`dropdown-item ${disabled ? 'disabled' : ''}`}
                  onClick={() => handleSelect(item.id)}
                  disabled={disabled || isProcessing}
                >
                  <div className={`item-icon-wrap ${item.color}`}>
                    <Icon size={18} />
                  </div>
                  <div className="item-content">
                    <div className="item-title">
                      {item.label}
                      {item.isNew && <span className="new-badge">NEW</span>}
                    </div>
                    <div className="item-desc">{item.desc}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
