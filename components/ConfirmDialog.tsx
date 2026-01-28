import React from 'react';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  description?: React.ReactNode;
  confirmLabel: string;
  cancelLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  dontAskLabel?: string;
  dontAskChecked?: boolean;
  onDontAskChange?: (checked: boolean) => void;
  confirmDisabled?: boolean;
}

const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancel,
  dontAskLabel,
  dontAskChecked = false,
  onDontAskChange,
  confirmDisabled
}) => {
  if (!open) return null;

  return (
    <div className="modal-overlay" onMouseDown={onCancel}>
      <div className="modal-content confirm-dialog" onMouseDown={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {description && <div className="modal-description">{description}</div>}
        {dontAskLabel && onDontAskChange && (
          <label className="dont-ask-row">
            <input
              type="checkbox"
              checked={dontAskChecked}
              onChange={(event) => onDontAskChange(event.target.checked)}
            />
            <span>{dontAskLabel}</span>
          </label>
        )}
        <div className="modal-footer">
          <button className="secondary-btn" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button className="primary" onClick={onConfirm} disabled={confirmDisabled}>
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
