/**
 * 快捷创新面板 - 简化版两步创新模式
 * 
 * 步骤1：输入素材（图片/关键词/批量）
 * 步骤2：选择配方（从表格读取指令+随机库）
 */

import React, { useState, useCallback, useMemo, useEffect } from 'react';
import {
    Image as ImageIcon,
    FileText,
    List,
    Upload,
    Link,
    Sparkles,
    RefreshCcw,
    Play,
    Settings2,
    Check,
    Copy,
    Loader2,
    AlertCircle,
    ChevronDown,
    ChevronUp,
    X,
    Plus,
    Trash2,
} from 'lucide-react';
import {
    RandomLibraryConfig,
    MasterSheetInfo,
    generateRandomCombination,
    generateMultipleUniqueCombinations,
    extractSpreadsheetId,
    scanMasterSheets,
    DEFAULT_QUICK_TRANSITION_INSTRUCTION,
} from '../../services/randomLibraryService';

// 输入模式
type InputMode = 'image' | 'keyword' | 'batch';

// 输入项
interface InputItem {
    id: string;
    type: 'image' | 'keyword';
    content: string; // base64 for image, text for keyword
    imageUrl?: string; // 用于显示的URL
}

// 配方信息（从MasterSheetInfo提取）
interface RecipeInfo {
    sheetName: string;
    libraryCount: number;
    instruction?: string;
}

interface QuickInnovationPanelProps {
    config: RandomLibraryConfig;
    onChange: (config: RandomLibraryConfig) => void;
    onStartInnovation: (params: {
        items: InputItem[];
        instruction: string;
        transitionInstruction: string;
        combination: string;
        count: number;
    }) => Promise<string[]>;
    onAIGenerate?: (prompt: string) => Promise<string>;
    onNavigateToAdvanced?: () => void;
    gyazoToken?: string;
}

export const QuickInnovationPanel: React.FC<QuickInnovationPanelProps> = ({
    config,
    onChange,
    onStartInnovation,
    onAIGenerate,
    onNavigateToAdvanced,
    gyazoToken,
}) => {
    // ========== 状态 ==========
    const [inputMode, setInputMode] = useState<InputMode>('image');
    const [inputItems, setInputItems] = useState<InputItem[]>([]);
    const [keywordInput, setKeywordInput] = useState('');
    const [batchInput, setBatchInput] = useState('');

    // 配方相关
    const [sheetsUrl, setSheetsUrl] = useState('');
    const [isScanning, setIsScanning] = useState(false);
    const [scanError, setScanError] = useState<string | null>(null);
    const [recipes, setRecipes] = useState<RecipeInfo[]>([]);
    const [selectedRecipe, setSelectedRecipe] = useState<string | null>(null);

    // 过渡指令
    const [transitionInstruction, setTransitionInstruction] = useState(
        config.quickTransitionInstruction || DEFAULT_QUICK_TRANSITION_INSTRUCTION
    );

    // 随机组合预览
    const [combinationPreview, setCombinationPreview] = useState<string>('');

    // 生成相关
    const [innovationCount, setInnovationCount] = useState(4);
    const [isGenerating, setIsGenerating] = useState(false);
    const [results, setResults] = useState<string[]>([]);
    const [copySuccess, setCopySuccess] = useState(false);

    // 折叠状态
    const [isResultsExpanded, setIsResultsExpanded] = useState(true);

    // ========== 从config恢复已导入的配方 ==========
    useEffect(() => {
        // 从现有libraries提取已导入的配方（按sourceSheet分组）
        const recipeMap = new Map<string, RecipeInfo>();
        config.libraries.forEach(lib => {
            const sheetName = lib.sourceSheet || '默认';
            if (!recipeMap.has(sheetName)) {
                recipeMap.set(sheetName, {
                    sheetName,
                    libraryCount: 0,
                    instruction: config.linkedInstructions?.[sheetName],
                });
            }
            const recipe = recipeMap.get(sheetName)!;
            recipe.libraryCount++;
        });

        if (recipeMap.size > 0) {
            setRecipes(Array.from(recipeMap.values()));
            // 默认选中已有的activeSourceSheet 或 第一个
            if (config.activeSourceSheet && recipeMap.has(config.activeSourceSheet)) {
                setSelectedRecipe(config.activeSourceSheet);
            } else if (recipeMap.size > 0) {
                setSelectedRecipe(Array.from(recipeMap.keys())[0]);
            }
        }
    }, [config.libraries.length, config.activeSourceSheet]);

    // ========== 刷新随机组合预览 ==========
    const refreshCombinationPreview = useCallback(() => {
        if (!selectedRecipe || config.libraries.length === 0) {
            setCombinationPreview('请先选择配方');
            return;
        }

        // 筛选当前配方的库
        const activeLibraries = config.libraries.filter(
            lib => lib.enabled && lib.sourceSheet === selectedRecipe && lib.values.length > 0
        );

        if (activeLibraries.length === 0) {
            setCombinationPreview('当前配方无可用库');
            return;
        }

        // 构造临时config用于生成组合
        const tempConfig: RandomLibraryConfig = {
            ...config,
            libraries: activeLibraries,
        };
        const combination = generateRandomCombination(tempConfig);
        setCombinationPreview(combination);
    }, [selectedRecipe, config]);

    useEffect(() => {
        refreshCombinationPreview();
    }, [selectedRecipe, refreshCombinationPreview]);

    // ========== 获取当前选中配方的指令 ==========
    const currentInstruction = useMemo(() => {
        if (!selectedRecipe) return '';
        return config.linkedInstructions?.[selectedRecipe] || '';
    }, [selectedRecipe, config.linkedInstructions]);

    // ========== 导入表格 ==========
    const handleScanSheets = useCallback(async () => {
        if (!sheetsUrl.trim()) {
            setScanError('请输入 Google Sheets 链接');
            return;
        }

        const spreadsheetId = extractSpreadsheetId(sheetsUrl);
        if (!spreadsheetId) {
            setScanError('无效的表格链接');
            return;
        }

        setIsScanning(true);
        setScanError(null);

        try {
            const masterSheets = await scanMasterSheets(spreadsheetId);

            if (masterSheets.length === 0) {
                setScanError('未找到有效的随机库分页，请检查表格格式');
                return;
            }

            // 更新配方列表
            const newRecipes: RecipeInfo[] = masterSheets.map(ms => ({
                sheetName: ms.sheetName,
                libraryCount: ms.libraries.length,
                instruction: ms.linkedInstruction,
            }));
            setRecipes(newRecipes);

            // 合并库数据到config
            const allLibraries = masterSheets.flatMap(ms => ms.libraries);
            const linkedInstructions: Record<string, string> = { ...config.linkedInstructions };
            masterSheets.forEach(ms => {
                if (ms.linkedInstruction) {
                    linkedInstructions[ms.sheetName] = ms.linkedInstruction;
                }
            });

            onChange({
                ...config,
                libraries: allLibraries,
                linkedInstructions,
                enabled: true,
            });

            // 自动选中第一个
            if (newRecipes.length > 0) {
                setSelectedRecipe(newRecipes[0].sheetName);
            }

            setSheetsUrl('');
        } catch (error: any) {
            setScanError(error.message || '导入失败');
        } finally {
            setIsScanning(false);
        }
    }, [sheetsUrl, config, onChange]);

    // ========== 选择配方 ==========
    const handleSelectRecipe = useCallback((sheetName: string) => {
        setSelectedRecipe(sheetName);
        onChange({
            ...config,
            activeSourceSheet: sheetName,
        });
    }, [config, onChange]);

    // ========== 图片上传处理 ==========
    const handleImageUpload = useCallback((files: FileList | null) => {
        if (!files) return;

        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target?.result as string;
                setInputItems(prev => [...prev, {
                    id: `img_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
                    type: 'image',
                    content: base64,
                    imageUrl: base64,
                }]);
            };
            reader.readAsDataURL(file);
        });
    }, []);

    // ========== 添加关键词 ==========
    const handleAddKeyword = useCallback(() => {
        const keyword = keywordInput.trim();
        if (!keyword) return;

        setInputItems(prev => [...prev, {
            id: `kw_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            type: 'keyword',
            content: keyword,
        }]);
        setKeywordInput('');
    }, [keywordInput]);

    // ========== 批量添加 ==========
    const handleBatchAdd = useCallback(() => {
        const lines = batchInput.split('\n').filter(line => line.trim());
        const newItems: InputItem[] = lines.map(line => ({
            id: `batch_${Date.now()}_${Math.random().toString(36).substr(2, 5)}`,
            type: 'keyword',
            content: line.trim(),
        }));
        setInputItems(prev => [...prev, ...newItems]);
        setBatchInput('');
    }, [batchInput]);

    // ========== 删除输入项 ==========
    const handleRemoveItem = useCallback((id: string) => {
        setInputItems(prev => prev.filter(item => item.id !== id));
    }, []);

    // ========== 清空所有输入 ==========
    const handleClearAllInputs = useCallback(() => {
        setInputItems([]);
    }, []);

    // ========== 开始创新 ==========
    const handleStartInnovation = useCallback(async () => {
        if (inputItems.length === 0) {
            alert('请先添加输入素材');
            return;
        }

        if (!selectedRecipe) {
            alert('请选择一个配方');
            return;
        }

        if (!currentInstruction) {
            alert('当前配方没有配套指令，请在表格分页目录的B列添加创新指令');
            return;
        }

        setIsGenerating(true);
        setResults([]);

        try {
            const generatedResults = await onStartInnovation({
                items: inputItems,
                instruction: currentInstruction,
                transitionInstruction,
                combination: combinationPreview,
                count: innovationCount,
            });

            setResults(generatedResults);
        } catch (error: any) {
            console.error('创新失败:', error);
            alert('创新失败: ' + (error.message || '未知错误'));
        } finally {
            setIsGenerating(false);
        }
    }, [inputItems, selectedRecipe, currentInstruction, transitionInstruction, combinationPreview, innovationCount, onStartInnovation]);

    // ========== 复制结果 ==========
    const handleCopyResults = useCallback(async () => {
        if (results.length === 0) return;

        try {
            await navigator.clipboard.writeText(results.join('\n\n---\n\n'));
            setCopySuccess(true);
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (error) {
            console.error('复制失败:', error);
        }
    }, [results]);

    // ========== 保存过渡指令 ==========
    useEffect(() => {
        if (transitionInstruction !== config.quickTransitionInstruction) {
            onChange({
                ...config,
                quickTransitionInstruction: transitionInstruction,
            });
        }
    }, [transitionInstruction]);

    // ========== 渲染 ==========
    return (
        <div className="quick-innovation-panel" style={{
            padding: '20px',
            display: 'flex',
            flexDirection: 'column',
            gap: '20px',
        }}>
            {/* 步骤1：输入素材 */}
            <div className="step-section" style={{
                background: 'var(--card-bg, #1a1a1a)',
                borderRadius: '12px',
                padding: '16px',
                border: '1px solid var(--border-color, #333)',
            }}>
                <div className="step-header" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '12px',
                }}>
                    <span style={{
                        background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                        color: 'white',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 'bold',
                    }}>1</span>
                    <span style={{ fontWeight: '600', color: 'var(--text-primary, #fff)' }}>输入素材</span>
                </div>

                {/* 输入模式选择 */}
                <div className="input-mode-tabs" style={{
                    display: 'flex',
                    gap: '8px',
                    marginBottom: '12px',
                }}>
                    {[
                        { mode: 'image' as InputMode, icon: ImageIcon, label: '上传图片' },
                        { mode: 'keyword' as InputMode, icon: FileText, label: '输入关键词' },
                        { mode: 'batch' as InputMode, icon: List, label: '批量粘贴' },
                    ].map(({ mode, icon: Icon, label }) => (
                        <button
                            key={mode}
                            onClick={() => setInputMode(mode)}
                            style={{
                                display: 'flex',
                                alignItems: 'center',
                                gap: '6px',
                                padding: '8px 12px',
                                borderRadius: '8px',
                                border: inputMode === mode
                                    ? '1px solid #8b5cf6'
                                    : '1px solid var(--border-color, #333)',
                                background: inputMode === mode
                                    ? 'rgba(139, 92, 246, 0.1)'
                                    : 'transparent',
                                color: inputMode === mode
                                    ? '#8b5cf6'
                                    : 'var(--text-secondary, #888)',
                                cursor: 'pointer',
                                fontSize: '13px',
                                transition: 'all 0.2s',
                            }}
                        >
                            <Icon size={14} />
                            {label}
                        </button>
                    ))}
                </div>

                {/* 输入区域 */}
                <div className="input-area" style={{ marginBottom: '12px' }}>
                    {inputMode === 'image' && (
                        <div
                            onDrop={(e) => {
                                e.preventDefault();
                                handleImageUpload(e.dataTransfer.files);
                            }}
                            onDragOver={(e) => e.preventDefault()}
                            onClick={() => document.getElementById('quick-image-upload')?.click()}
                            style={{
                                border: '2px dashed var(--border-color, #333)',
                                borderRadius: '8px',
                                padding: '32px',
                                textAlign: 'center',
                                cursor: 'pointer',
                                background: 'rgba(139, 92, 246, 0.02)',
                                transition: 'all 0.2s',
                            }}
                        >
                            <Upload size={32} style={{ color: 'var(--text-secondary, #888)', marginBottom: '8px' }} />
                            <div style={{ color: 'var(--text-secondary, #888)', fontSize: '14px' }}>
                                拖拽图片到这里 或 点击上传
                            </div>
                            <input
                                id="quick-image-upload"
                                type="file"
                                accept="image/*"
                                multiple
                                style={{ display: 'none' }}
                                onChange={(e) => handleImageUpload(e.target.files)}
                            />
                        </div>
                    )}

                    {inputMode === 'keyword' && (
                        <div style={{ display: 'flex', gap: '8px' }}>
                            <input
                                type="text"
                                value={keywordInput}
                                onChange={(e) => setKeywordInput(e.target.value)}
                                onKeyDown={(e) => e.key === 'Enter' && handleAddKeyword()}
                                placeholder="输入创意关键词，按回车添加..."
                                style={{
                                    flex: 1,
                                    padding: '10px 14px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--border-color, #333)',
                                    background: 'var(--input-bg, #0a0a0a)',
                                    color: 'var(--text-primary, #fff)',
                                    fontSize: '14px',
                                }}
                            />
                            <button
                                onClick={handleAddKeyword}
                                disabled={!keywordInput.trim()}
                                style={{
                                    padding: '10px 16px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: keywordInput.trim() ? '#8b5cf6' : 'var(--border-color, #333)',
                                    color: 'white',
                                    cursor: keywordInput.trim() ? 'pointer' : 'not-allowed',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                }}
                            >
                                <Plus size={16} />
                                添加
                            </button>
                        </div>
                    )}

                    {inputMode === 'batch' && (
                        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                            <textarea
                                value={batchInput}
                                onChange={(e) => setBatchInput(e.target.value)}
                                placeholder="每行一个关键词..."
                                style={{
                                    width: '100%',
                                    height: '100px',
                                    padding: '10px 14px',
                                    borderRadius: '8px',
                                    border: '1px solid var(--border-color, #333)',
                                    background: 'var(--input-bg, #0a0a0a)',
                                    color: 'var(--text-primary, #fff)',
                                    fontSize: '14px',
                                    resize: 'vertical',
                                }}
                            />
                            <button
                                onClick={handleBatchAdd}
                                disabled={!batchInput.trim()}
                                style={{
                                    padding: '10px 16px',
                                    borderRadius: '8px',
                                    border: 'none',
                                    background: batchInput.trim() ? '#8b5cf6' : 'var(--border-color, #333)',
                                    color: 'white',
                                    cursor: batchInput.trim() ? 'pointer' : 'not-allowed',
                                    alignSelf: 'flex-end',
                                }}
                            >
                                批量添加
                            </button>
                        </div>
                    )}
                </div>

                {/* 已添加的素材列表 */}
                {inputItems.length > 0 && (
                    <div className="input-items-list" style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px',
                    }}>
                        {inputItems.map(item => (
                            <div
                                key={item.id}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    padding: '6px 10px',
                                    borderRadius: '6px',
                                    background: 'rgba(139, 92, 246, 0.1)',
                                    border: '1px solid rgba(139, 92, 246, 0.3)',
                                    fontSize: '13px',
                                    color: 'var(--text-primary, #fff)',
                                }}
                            >
                                {item.type === 'image' ? (
                                    <img
                                        src={item.imageUrl}
                                        alt=""
                                        style={{
                                            width: '24px',
                                            height: '24px',
                                            borderRadius: '4px',
                                            objectFit: 'cover',
                                        }}
                                    />
                                ) : (
                                    <FileText size={14} style={{ color: '#8b5cf6' }} />
                                )}
                                <span style={{
                                    maxWidth: '120px',
                                    overflow: 'hidden',
                                    textOverflow: 'ellipsis',
                                    whiteSpace: 'nowrap',
                                }}>
                                    {item.type === 'image' ? '图片' : item.content}
                                </span>
                                <button
                                    onClick={() => handleRemoveItem(item.id)}
                                    style={{
                                        background: 'none',
                                        border: 'none',
                                        padding: '2px',
                                        cursor: 'pointer',
                                        color: 'var(--text-secondary, #888)',
                                        display: 'flex',
                                    }}
                                >
                                    <X size={14} />
                                </button>
                            </div>
                        ))}
                        <button
                            onClick={handleClearAllInputs}
                            style={{
                                padding: '6px 10px',
                                borderRadius: '6px',
                                border: '1px solid rgba(239, 68, 68, 0.3)',
                                background: 'rgba(239, 68, 68, 0.1)',
                                color: '#ef4444',
                                fontSize: '13px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                            }}
                        >
                            <Trash2 size={12} />
                            清空
                        </button>
                    </div>
                )}
            </div>

            {/* 步骤2：选择配方 */}
            <div className="step-section" style={{
                background: 'var(--card-bg, #1a1a1a)',
                borderRadius: '12px',
                padding: '16px',
                border: '1px solid var(--border-color, #333)',
            }}>
                <div className="step-header" style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                    marginBottom: '12px',
                }}>
                    <span style={{
                        background: 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                        color: 'white',
                        borderRadius: '50%',
                        width: '24px',
                        height: '24px',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '12px',
                        fontWeight: 'bold',
                    }}>2</span>
                    <span style={{ fontWeight: '600', color: 'var(--text-primary, #fff)' }}>选择配方</span>
                </div>

                {/* 表格链接导入 */}
                <div style={{ display: 'flex', gap: '8px', marginBottom: '12px' }}>
                    <div style={{ position: 'relative', flex: 1 }}>
                        <Link size={16} style={{
                            position: 'absolute',
                            left: '12px',
                            top: '50%',
                            transform: 'translateY(-50%)',
                            color: 'var(--text-secondary, #888)',
                        }} />
                        <input
                            type="text"
                            value={sheetsUrl}
                            onChange={(e) => setSheetsUrl(e.target.value)}
                            placeholder="粘贴 Google Sheets 链接..."
                            style={{
                                width: '100%',
                                padding: '10px 14px 10px 36px',
                                borderRadius: '8px',
                                border: '1px solid var(--border-color, #333)',
                                background: 'var(--input-bg, #0a0a0a)',
                                color: 'var(--text-primary, #fff)',
                                fontSize: '14px',
                            }}
                        />
                    </div>
                    <button
                        onClick={handleScanSheets}
                        disabled={isScanning || !sheetsUrl.trim()}
                        style={{
                            padding: '10px 16px',
                            borderRadius: '8px',
                            border: 'none',
                            background: isScanning ? 'var(--border-color, #333)' : '#10b981',
                            color: 'white',
                            cursor: isScanning || !sheetsUrl.trim() ? 'not-allowed' : 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '6px',
                            fontSize: '14px',
                        }}
                    >
                        {isScanning ? (
                            <Loader2 size={16} className="animate-spin" />
                        ) : (
                            <Upload size={16} />
                        )}
                        导入
                    </button>
                </div>

                {scanError && (
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: '6px',
                        padding: '8px 12px',
                        borderRadius: '6px',
                        background: 'rgba(239, 68, 68, 0.1)',
                        border: '1px solid rgba(239, 68, 68, 0.3)',
                        color: '#ef4444',
                        fontSize: '13px',
                        marginBottom: '12px',
                    }}>
                        <AlertCircle size={14} />
                        {scanError}
                    </div>
                )}

                {/* 配方卡片 */}
                {recipes.length > 0 && (
                    <div className="recipe-cards" style={{
                        display: 'flex',
                        flexWrap: 'wrap',
                        gap: '8px',
                        marginBottom: '16px',
                    }}>
                        {recipes.map(recipe => (
                            <button
                                key={recipe.sheetName}
                                onClick={() => handleSelectRecipe(recipe.sheetName)}
                                style={{
                                    padding: '12px 16px',
                                    borderRadius: '8px',
                                    border: selectedRecipe === recipe.sheetName
                                        ? '2px solid #8b5cf6'
                                        : '1px solid var(--border-color, #333)',
                                    background: selectedRecipe === recipe.sheetName
                                        ? 'rgba(139, 92, 246, 0.15)'
                                        : 'rgba(0,0,0,0.2)',
                                    cursor: 'pointer',
                                    textAlign: 'left',
                                    minWidth: '120px',
                                }}
                            >
                                <div style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '6px',
                                    marginBottom: '4px',
                                }}>
                                    {selectedRecipe === recipe.sheetName && (
                                        <Check size={14} style={{ color: '#8b5cf6' }} />
                                    )}
                                    <span style={{
                                        fontWeight: '600',
                                        color: selectedRecipe === recipe.sheetName ? '#8b5cf6' : 'var(--text-primary, #fff)',
                                        fontSize: '14px',
                                    }}>
                                        {recipe.sheetName}
                                    </span>
                                </div>
                                <div style={{
                                    color: 'var(--text-secondary, #888)',
                                    fontSize: '12px',
                                }}>
                                    {recipe.libraryCount} 个库
                                    {recipe.instruction && ' · 有指令'}
                                </div>
                            </button>
                        ))}
                    </div>
                )}

                {/* 当前指令预览 */}
                {selectedRecipe && (
                    <div style={{ marginBottom: '16px' }}>
                        <div style={{
                            fontSize: '12px',
                            color: 'var(--text-secondary, #888)',
                            marginBottom: '6px',
                        }}>
                            📄 配套指令：
                        </div>
                        <div style={{
                            padding: '10px 14px',
                            borderRadius: '8px',
                            background: 'var(--input-bg, #0a0a0a)',
                            border: '1px solid var(--border-color, #333)',
                            fontSize: '13px',
                            color: currentInstruction ? 'var(--text-primary, #fff)' : 'var(--text-secondary, #888)',
                            maxHeight: '80px',
                            overflow: 'auto',
                            whiteSpace: 'pre-wrap',
                        }}>
                            {currentInstruction || '（无配套指令，请在表格分页目录的B列添加）'}
                        </div>
                    </div>
                )}

                {/* 过渡指令编辑 */}
                <div style={{ marginBottom: '16px' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '6px',
                    }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary, #888)' }}>
                            🔗 过渡指令：
                        </span>
                        <button
                            onClick={() => setTransitionInstruction(DEFAULT_QUICK_TRANSITION_INSTRUCTION)}
                            style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #333)',
                                background: 'transparent',
                                color: 'var(--text-secondary, #888)',
                                fontSize: '11px',
                                cursor: 'pointer',
                            }}
                        >
                            重置默认
                        </button>
                    </div>
                    <input
                        type="text"
                        value={transitionInstruction}
                        onChange={(e) => setTransitionInstruction(e.target.value)}
                        style={{
                            width: '100%',
                            padding: '10px 14px',
                            borderRadius: '8px',
                            border: '1px solid var(--border-color, #333)',
                            background: 'var(--input-bg, #0a0a0a)',
                            color: 'var(--text-primary, #fff)',
                            fontSize: '14px',
                        }}
                    />
                </div>

                {/* 随机组合预览 */}
                <div style={{ marginBottom: '16px' }}>
                    <div style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        marginBottom: '6px',
                    }}>
                        <span style={{ fontSize: '12px', color: 'var(--text-secondary, #888)' }}>
                            🎲 当前随机组合预览：
                        </span>
                        <button
                            onClick={refreshCombinationPreview}
                            style={{
                                padding: '4px 8px',
                                borderRadius: '4px',
                                border: '1px solid var(--border-color, #333)',
                                background: 'transparent',
                                color: 'var(--text-secondary, #888)',
                                fontSize: '11px',
                                cursor: 'pointer',
                                display: 'flex',
                                alignItems: 'center',
                                gap: '4px',
                            }}
                        >
                            <RefreshCcw size={10} />
                            刷新
                        </button>
                    </div>
                    <div style={{
                        padding: '10px 14px',
                        borderRadius: '8px',
                        background: 'rgba(139, 92, 246, 0.05)',
                        border: '1px solid rgba(139, 92, 246, 0.2)',
                        fontSize: '13px',
                        color: 'var(--text-primary, #fff)',
                    }}>
                        {combinationPreview || '无预览'}
                    </div>
                </div>
            </div>

            {/* 生成控制 */}
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: '12px',
            }}>
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '8px',
                }}>
                    <span style={{ fontSize: '14px', color: 'var(--text-secondary, #888)' }}>
                        生成数量：
                    </span>
                    <select
                        value={innovationCount}
                        onChange={(e) => setInnovationCount(Number(e.target.value))}
                        style={{
                            padding: '8px 12px',
                            borderRadius: '6px',
                            border: '1px solid var(--border-color, #333)',
                            background: 'var(--input-bg, #0a0a0a)',
                            color: 'var(--text-primary, #fff)',
                            fontSize: '14px',
                        }}
                    >
                        {[1, 2, 3, 4, 5, 6, 8, 10].map(n => (
                            <option key={n} value={n}>{n}</option>
                        ))}
                    </select>
                </div>

                <button
                    onClick={handleStartInnovation}
                    disabled={isGenerating || inputItems.length === 0 || !selectedRecipe}
                    style={{
                        flex: 1,
                        padding: '14px 24px',
                        borderRadius: '10px',
                        border: 'none',
                        background: isGenerating
                            ? 'var(--border-color, #333)'
                            : 'linear-gradient(135deg, #8b5cf6, #6366f1)',
                        color: 'white',
                        fontSize: '16px',
                        fontWeight: '600',
                        cursor: isGenerating || inputItems.length === 0 || !selectedRecipe
                            ? 'not-allowed'
                            : 'pointer',
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: '8px',
                        boxShadow: isGenerating ? 'none' : '0 4px 15px rgba(139, 92, 246, 0.3)',
                        transition: 'all 0.2s',
                    }}
                >
                    {isGenerating ? (
                        <>
                            <Loader2 size={20} className="animate-spin" />
                            生成中...
                        </>
                    ) : (
                        <>
                            <Sparkles size={20} />
                            开始创新
                        </>
                    )}
                </button>

                {onNavigateToAdvanced && (
                    <button
                        onClick={onNavigateToAdvanced}
                        style={{
                            padding: '14px',
                            borderRadius: '10px',
                            border: '1px solid var(--border-color, #333)',
                            background: 'transparent',
                            color: 'var(--text-secondary, #888)',
                            cursor: 'pointer',
                            display: 'flex',
                            alignItems: 'center',
                        }}
                        title="高级设置"
                    >
                        <Settings2 size={20} />
                    </button>
                )}
            </div>

            {/* 结果展示 */}
            {results.length > 0 && (
                <div className="results-section" style={{
                    background: 'var(--card-bg, #1a1a1a)',
                    borderRadius: '12px',
                    padding: '16px',
                    border: '1px solid var(--border-color, #333)',
                }}>
                    <div
                        onClick={() => setIsResultsExpanded(!isResultsExpanded)}
                        style={{
                            display: 'flex',
                            alignItems: 'center',
                            justifyContent: 'space-between',
                            cursor: 'pointer',
                            marginBottom: isResultsExpanded ? '12px' : '0',
                        }}
                    >
                        <div style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: '8px',
                        }}>
                            <Sparkles size={16} style={{ color: '#8b5cf6' }} />
                            <span style={{
                                fontWeight: '600',
                                color: 'var(--text-primary, #fff)',
                            }}>
                                创新结果 ({results.length})
                            </span>
                        </div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                            <button
                                onClick={(e) => {
                                    e.stopPropagation();
                                    handleCopyResults();
                                }}
                                style={{
                                    padding: '6px 12px',
                                    borderRadius: '6px',
                                    border: '1px solid var(--border-color, #333)',
                                    background: copySuccess ? '#10b981' : 'transparent',
                                    color: copySuccess ? 'white' : 'var(--text-secondary, #888)',
                                    fontSize: '12px',
                                    cursor: 'pointer',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '4px',
                                }}
                            >
                                {copySuccess ? <Check size={14} /> : <Copy size={14} />}
                                {copySuccess ? '已复制' : '复制全部'}
                            </button>
                            {isResultsExpanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
                        </div>
                    </div>

                    {isResultsExpanded && (
                        <div style={{
                            display: 'flex',
                            flexDirection: 'column',
                            gap: '8px',
                        }}>
                            {results.map((result, index) => (
                                <div
                                    key={index}
                                    style={{
                                        padding: '12px',
                                        borderRadius: '8px',
                                        background: 'var(--input-bg, #0a0a0a)',
                                        border: '1px solid var(--border-color, #333)',
                                    }}
                                >
                                    <div style={{
                                        fontSize: '12px',
                                        color: 'var(--text-secondary, #888)',
                                        marginBottom: '6px',
                                    }}>
                                        #{index + 1}
                                    </div>
                                    <div style={{
                                        fontSize: '14px',
                                        color: 'var(--text-primary, #fff)',
                                        lineHeight: '1.6',
                                        whiteSpace: 'pre-wrap',
                                    }}>
                                        {result}
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>
            )}

            {/* 加载动画样式 */}
            <style>{`
                @keyframes spin {
                    from { transform: rotate(0deg); }
                    to { transform: rotate(360deg); }
                }
                .animate-spin {
                    animation: spin 1s linear infinite;
                }
            `}</style>
        </div>
    );
};

export default QuickInnovationPanel;
