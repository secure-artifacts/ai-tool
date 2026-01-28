// 统一 Gemini 模型管理 - Context
// 遵循 2025年12月 Google Gemini API 规范

import React, { createContext, useContext, useState, useEffect, useCallback, ReactNode } from 'react';

// 模型路由模式
export type ModelMode = 'fast' | 'high_logic' | 'image_edit' | 'image_gen';

// 模型配置
export const MODEL_ROUTES: Record<ModelMode, string> = {
    fast: 'gemini-3-flash-preview',           // 默认文本/代码任务
    high_logic: 'gemini-3-pro-preview',       // 复杂逻辑/长文本分析
    image_edit: 'gemini-2.5-flash-image',     // 图片编辑/对话改图
    image_gen: 'imagen-4.0-generate-001',     // 高画质创作/写字
};

// 模型显示名称
export const MODEL_LABELS: Record<ModelMode, { zh: string; en: string }> = {
    fast: { zh: '快速 (3-flash)', en: 'Fast (3-flash)' },
    high_logic: { zh: '高级推理 (3-pro)', en: 'High Logic (3-pro)' },
    image_edit: { zh: '图片编辑 (2.5-flash-image)', en: 'Image Edit (2.5-flash-image)' },
    image_gen: { zh: '图片生成 (Imagen 4)', en: 'Image Gen (Imagen 4)' },
};

// Context 接口
interface ModelContextType {
    // 当前文本模式
    textMode: ModelMode;
    setTextMode: (mode: ModelMode) => void;

    // 当前图片模式
    imageMode: ModelMode;
    setImageMode: (mode: ModelMode) => void;

    // 获取当前模型名称
    getTextModel: () => string;
    getImageModel: () => string;

    // 根据任务类型自动选择模型
    getModelForTask: (task: 'text' | 'image_edit' | 'image_gen' | 'complex') => string;
}

const ModelContext = createContext<ModelContextType | null>(null);

// localStorage keys
const TEXT_MODE_KEY = 'app_text_mode';
const IMAGE_MODE_KEY = 'app_image_mode';

// Provider 组件
export const ModelProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
    // 从 localStorage 加载，默认 fast
    const [textMode, setTextModeState] = useState<ModelMode>(() => {
        if (typeof window === 'undefined') return 'fast';
        try {
            const saved = localStorage.getItem(TEXT_MODE_KEY);
            if (saved && saved in MODEL_ROUTES) return saved as ModelMode;
        } catch { }
        return 'fast';
    });

    const [imageMode, setImageModeState] = useState<ModelMode>(() => {
        if (typeof window === 'undefined') return 'image_edit';
        try {
            const saved = localStorage.getItem(IMAGE_MODE_KEY);
            if (saved && saved in MODEL_ROUTES) return saved as ModelMode;
        } catch { }
        return 'image_edit';
    });

    // 保存到 localStorage
    const setTextMode = useCallback((mode: ModelMode) => {
        setTextModeState(mode);
        try {
            localStorage.setItem(TEXT_MODE_KEY, mode);
        } catch { }
    }, []);

    const setImageMode = useCallback((mode: ModelMode) => {
        setImageModeState(mode);
        try {
            localStorage.setItem(IMAGE_MODE_KEY, mode);
        } catch { }
    }, []);

    // 获取模型名称
    const getTextModel = useCallback(() => MODEL_ROUTES[textMode], [textMode]);
    const getImageModel = useCallback(() => MODEL_ROUTES[imageMode], [imageMode]);

    // 根据任务类型自动路由
    const getModelForTask = useCallback((task: 'text' | 'image_edit' | 'image_gen' | 'complex') => {
        switch (task) {
            case 'complex':
                return MODEL_ROUTES.high_logic;
            case 'image_edit':
                return MODEL_ROUTES.image_edit;
            case 'image_gen':
                return MODEL_ROUTES.image_gen;
            default:
                return MODEL_ROUTES[textMode];
        }
    }, [textMode]);

    return (
        <ModelContext.Provider value={{
            textMode,
            setTextMode,
            imageMode,
            setImageMode,
            getTextModel,
            getImageModel,
            getModelForTask,
        }}>
            {children}
        </ModelContext.Provider>
    );
};

// Hook
export const useModel = (): ModelContextType => {
    const context = useContext(ModelContext);
    if (!context) {
        throw new Error('useModel must be used within a ModelProvider');
    }
    return context;
};

// 兼容性 Hook - 返回字符串模型名称（用于旧代码迁移）
export const useTextModel = (): string => {
    const { getTextModel } = useModel();
    return getTextModel();
};

export const useImageModel = (): string => {
    const { getImageModel } = useModel();
    return getImageModel();
};

export default ModelContext;
