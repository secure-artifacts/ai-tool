import React, { useEffect, useRef } from 'react';

// 使用非受控组件模式（defaultValue）来彻底解决 React Flow 中的中文输入法（IME）截断问题。
// 它依赖于底层的 DOM 状态处理真正的键盘输入，仅在失焦且外部数据改变时同步回内部。

interface WfTextareaProps extends Omit<React.TextareaHTMLAttributes<HTMLTextAreaElement>, 'value' | 'onChange'> {
  value: string;
  onChangeContent: (val: string) => void;
}

export const WfTextarea: React.FC<WfTextareaProps> = ({ value, onChangeContent, onFocus, onBlur, className, ...props }) => {
  const ref = useRef<HTMLTextAreaElement>(null);
  const isFocused = useRef(false);

  // 当外部 value 发生改变时，如果当前没有处于焦点状态，则手动同步 value 到 DOM
  useEffect(() => {
    if (!isFocused.current && ref.current && ref.current.value !== value) {
      ref.current.value = value || '';
    }
  }, [value]);

  return (
    <textarea
      {...props}
      ref={ref}
      defaultValue={value}
      className={`nodrag nopan ${className || ''}`}
      onFocus={(e) => {
        isFocused.current = true;
        if (onFocus) onFocus(e);
      }}
      onBlur={(e) => {
        isFocused.current = false;
        if (onBlur) onBlur(e);
      }}
      onChange={(e) => {
        onChangeContent(e.target.value);
      }}
    />
  );
};

interface WfInputProps extends Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange'> {
  value: string;
  onChangeContent: (val: string) => void;
}

export const WfInput: React.FC<WfInputProps> = ({ value, onChangeContent, onFocus, onBlur, className, ...props }) => {
  const ref = useRef<HTMLInputElement>(null);
  const isFocused = useRef(false);

  useEffect(() => {
    if (!isFocused.current && ref.current && ref.current.value !== value) {
      ref.current.value = value || '';
    }
  }, [value]);

  return (
    <input
      {...props}
      ref={ref}
      defaultValue={value}
      className={`nodrag nopan ${className || ''}`}
      onFocus={(e) => {
        isFocused.current = true;
        if (onFocus) onFocus(e);
      }}
      onBlur={(e) => {
        isFocused.current = false;
        if (onBlur) onBlur(e);
      }}
      onChange={(e) => {
        onChangeContent(e.target.value);
      }}
    />
  );
};
