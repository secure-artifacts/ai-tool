import { ChevronLeft } from 'lucide-react';

type InputTab = 'text' | 'image' | 'document' | 'youtube' | 'webpage' | 'audio';

interface SourceMenuPanelProps {
  onClose: () => void;
  onSelectTab: (tab: InputTab) => void;
  onOpenMaps: () => void;
  onImport: () => void;
}

const MENU_SECTIONS: Array<{
  title: string;
  items: Array<{
    label: string;
    icon: string;
    tab?: InputTab;
    action?: 'import';
    hint?: string;
    disabled?: boolean;
  }>;
}> = [
  {
    title: '视频转思维导图',
    items: [
      { label: '视频链接', icon: '🎬', tab: 'youtube' },
      { label: '视频文件', icon: '📽️', disabled: true, hint: '即将支持' },
    ],
  },
  {
    title: '文本转思维导图',
    items: [
      { label: '长文本', icon: '📝', tab: 'text' },
      { label: '电子邮件', icon: '✉️', tab: 'text' },
    ],
  },
  {
    title: '网页转思维导图',
    items: [
      { label: '网页', icon: '🌐', tab: 'webpage' },
      { label: '博客帖子', icon: '📰', tab: 'webpage' },
      { label: '社交媒体', icon: '📣', tab: 'webpage' },
    ],
  },
  {
    title: '音频转思维导图',
    items: [
      { label: '音频文件', icon: '🎧', tab: 'audio' },
      { label: '播客', icon: '📻', tab: 'audio' },
    ],
  },
  {
    title: '图像转思维导图',
    items: [
      { label: '图像文件', icon: '🖼️', tab: 'image' },
    ],
  },
];

export const SourceMenuPanel: React.FC<SourceMenuPanelProps> = ({
  onClose,
  onSelectTab,
  onOpenMaps,
  onImport,
}) => {
  const handleItemClick = (item: (typeof MENU_SECTIONS)[number]['items'][number]) => {
    if (item.disabled) {
      alert(`${item.label} 暂未开放，敬请期待。`);
      return;
    }
    if (item.action === 'import') {
      onImport();
      return;
    }
    if (item.tab) {
      onSelectTab(item.tab);
    }
  };

  return (
    <div className="source-menu-panel">
      <button className="source-menu-back" onClick={onClose}>
        <ChevronLeft size={18} />
        返回
      </button>

      <button className="source-menu-card" onClick={onOpenMaps}>
        <span className="source-menu-card-icon">🗂️</span>
        <span className="source-menu-card-title">我的导图</span>
        <span className="source-menu-card-action">›</span>
      </button>

      <div className="source-menu-divider" />

      {MENU_SECTIONS.map((section) => (
        <div key={section.title} className="source-menu-section">
          <div className="source-menu-section-title">{section.title}</div>
          <div className="source-menu-list">
            {section.items.map((item) => (
              <button
                key={item.label}
                className={`source-menu-item ${item.disabled ? 'disabled' : ''}`}
                onClick={() => handleItemClick(item)}
              >
                <span className="source-menu-item-left">
                  <span className="source-menu-item-icon">{item.icon}</span>
                  <span className="source-menu-item-label">{item.label}</span>
                </span>
                <span className="source-menu-item-meta">
                  {item.hint || (item.disabled ? '即将支持' : '›')}
                </span>
              </button>
            ))}
          </div>
        </div>
      ))}

      <div className="source-menu-divider" />

      <button className="source-menu-item" onClick={() => handleItemClick({ label: '导入', icon: '📥', action: 'import' })}>
        <span className="source-menu-item-left">
          <span className="source-menu-item-icon">📥</span>
          <span className="source-menu-item-label">导入</span>
        </span>
        <span className="source-menu-item-meta">›</span>
      </button>
    </div>
  );
};
