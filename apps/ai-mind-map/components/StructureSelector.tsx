import { LAYOUT_GROUPS } from '../types';
import type { LayoutDirection } from '../types';

interface StructureSelectorProps {
  value: LayoutDirection;
  onChange: (value: LayoutDirection) => void;
}

export const StructureSelector: React.FC<StructureSelectorProps> = ({ value, onChange }) => {
  return (
    <div className="structure-selector">
      {LAYOUT_GROUPS.map((group) => (
        <div key={group.label} className="structure-group">
          <div className="structure-group-title">{group.label}</div>
          <div className="structure-grid">
            {group.layouts.map((layout) => (
              <button
                key={layout.type}
                className={`structure-btn ${value === layout.type ? 'active' : ''}`}
                onClick={() => onChange(layout.type)}
                title={layout.description}
              >
                <span className="structure-icon">{layout.icon}</span>
                <span className="structure-label">{layout.label}</span>
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
};
