/**
 * 随机库管理组件 - 用于高级创新的随机组合功能
 */

import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { useToast } from '@/components/ui/Toast';
import {
    Library,
    Plus,
    Trash2,
    Download,
    Upload,
    ClipboardPaste,
    X,
    Shuffle,
    Check,
    ChevronDown,
    Pencil,
    RotateCcw,
    Eye,
    Copy,
    Sparkles,
    Loader2,
    Search,
    RefreshCw,
    ArrowRightLeft,
    Image as ImageIcon,
} from 'lucide-react';
import {
    RandomLibrary,
    RandomLibraryConfig,
    DEFAULT_RANDOM_LIBRARY_CONFIG,
    DEFAULT_TRANSITION_INSTRUCTION,
    LIBRARY_COLORS,
    createLibrary,
    parseTableData,
    parseTableDataToLibraries,
    generateRandomCombination,
    pickRandomValues,
    saveRandomLibraryConfig,
    getDefaultLibraries,
    loadRandomLibraryConfig,
    exportLibraries,
    importLibraries,
    ImportOptions,
    importFromGoogleSheets,
    extractSpreadsheetId,
    scanMasterSheets,
    MasterSheetInfo,
    hasCategoryLinkData,
    buildAICategoryPrompt,
    applyAICategoryResult,
    AICategoryResult,
    FIXED_PRIORITY_INSTRUCTION,
    getPriorityInstruction,
} from '../services/randomLibraryService';
import { WorkMode } from '../types';

interface RandomLibraryManagerProps {
    config: RandomLibraryConfig;
    onChange: (config: RandomLibraryConfig) => void;
    onClose?: () => void;
    onAIGenerate?: (prompt: string) => Promise<string>; // AI生成函数
    onAIAnalyzeImages?: (images: { base64: string; mimeType: string }[], prompt: string) => Promise<string>; // 多图片分析函数
    innovationCount?: number; // 创新个数，用于预览显示
    workMode?: WorkMode; // 工作模式：快捷模式下隐藏部分设置
    baseInstruction?: string; // 基础指令，用于预览最终指令
    globalUserPrompt?: string; // 全局用户特殊要求
}

export const RandomLibraryManager: React.FC<RandomLibraryManagerProps> = ({
    config,
    onChange,
    onClose,
    onAIGenerate,
    onAIAnalyzeImages,
    innovationCount = 4,
    workMode = 'creative',
    baseInstruction = '',
    globalUserPrompt = '',
}) => {
    const toast = useToast();
    const [activeLibraryId, setActiveLibraryId] = useState<string | null>(
        config.libraries[0]?.id || null
    );
    const [editingName, setEditingName] = useState<string | null>(null);
    const [newName, setNewName] = useState('');
    const [showImportModal, setShowImportModal] = useState(false);
    const [importText, setImportText] = useState('');
    const [importMode, setImportMode] = useState<ImportOptions['mode']>('merge-add');
    // 预览状态：每组是一个组合
    const [previewGroups, setPreviewGroups] = useState<{ name: string; value: string; color: string }[][]>([]);
    const [showAddLibraryInput, setShowAddLibraryInput] = useState(false);
    const [newLibraryName, setNewLibraryName] = useState('');

    // AI智能生成相关状态
    const [showAIModal, setShowAIModal] = useState(false);
    const [aiPrompt, setAiPrompt] = useState('');
    const [aiGenerating, setAiGenerating] = useState(false);
    const [aiCount, setAiCount] = useState(10);

    // 确认弹窗状态
    const [confirmModal, setConfirmModal] = useState<{ show: boolean; message: string; onConfirm: () => void }>({
        show: false,
        message: '',
        onConfirm: () => { },
    });

    // Google Sheets导入相关状态
    const [showSheetsImportModal, setShowSheetsImportModal] = useState(false);
    const [sheetsUrl, setSheetsUrl] = useState('');
    const [sheetsImporting, setSheetsImporting] = useState(false);
    const [sheetsImportMode, setSheetsImportMode] = useState<'merge-add' | 'merge-update' | 'replace'>('replace');

    // 多总库选择相关状态
    const [sheetsImportStep, setSheetsImportStep] = useState<'input' | 'select'>('input'); // 导入步骤
    const [foundMasterSheets, setFoundMasterSheets] = useState<MasterSheetInfo[]>([]); // 扫描到的总库
    const [selectedMasterSheets, setSelectedMasterSheets] = useState<Set<string>>(new Set()); // 选中的总库分页名

    const [customSheetName, setCustomSheetName] = useState(''); // 手动输入的分页名

    // 格式说明弹窗
    const [showFormatGuide, setShowFormatGuide] = useState(false);

    // AI智能分类相关状态
    const [showAiCategoryModal, setShowAiCategoryModal] = useState(false);
    const [aiCategoryInput, setAiCategoryInput] = useState(''); // 用户粘贴的原始数据
    const [aiCategoryDimension, setAiCategoryDimension] = useState(''); // 分类维度/规则
    const [aiCategoryStyle, setAiCategoryStyle] = useState<'strict' | 'creative' | 'custom'>('strict'); // 分类风格
    const [aiCategoryCustomRule, setAiCategoryCustomRule] = useState(''); // 自定义分类规则
    const [aiCategoryOutputFormat, setAiCategoryOutputFormat] = useState<1 | 2 | 3>(3); // 输出格式
    const [aiCategorizing, setAiCategorizing] = useState(false);
    const [aiCategoryResult, setAiCategoryResult] = useState<string>(''); // 分类后的结果文本

    // 权重编辑弹框状态
    const [weightPopup, setWeightPopup] = useState<{ value: string; weight: number; position: { x: number; y: number } } | null>(null);

    // 预览最终指令弹框状态
    const [showFinalPreview, setShowFinalPreview] = useState(false);

    // 同步刷新状态
    const [isSyncing, setIsSyncing] = useState(false);

    // 快捷模式下隐藏高级工具弹窗，避免通过残留状态显示
    useEffect(() => {
        if (workMode === 'quick') {
            setShowAiCategoryModal(false);
            setShowInstructionToLibModal(false);
            setShowImageToLibModal(false);
        }
    }, [workMode]);

    // 指令转库功能状态
    const [showInstructionToLibModal, setShowInstructionToLibModal] = useState(false);
    const [instructionToLibInput, setInstructionToLibInput] = useState(''); // 用户粘贴的通用指令
    const [instructionToLibConverting, setInstructionToLibConverting] = useState(false);
    const [instructionToLibResult, setInstructionToLibResult] = useState<{ headers: string[]; rows: string[][] } | null>(null);
    const [extractedBaseInstruction, setExtractedBaseInstruction] = useState<string>(''); // 提取的基础指令

    // 库本地化功能状态
    const [targetCountry, setTargetCountry] = useState(''); // 目标国家
    const [localizing, setLocalizing] = useState(false); // 本地化进行中
    const [localizedResult, setLocalizedResult] = useState<{ headers: string[]; rows: string[][] } | null>(null); // 本地化后的结果
    const [localizedBaseInstruction, setLocalizedBaseInstruction] = useState<string>(''); // 本地化后的基础指令
    const [directTableInput, setDirectTableInput] = useState(''); // 直接粘贴的表格数据
    const [directBaseInstructionInput, setDirectBaseInstructionInput] = useState(''); // 直接粘贴的基础指令

    // 手动粘贴库+指令弹窗
    const [showManualPasteModal, setShowManualPasteModal] = useState(false);
    const [manualPasteTableInput, setManualPasteTableInput] = useState(''); // 粘贴的库表格数据
    const [manualPasteBaseInstruction, setManualPasteBaseInstruction] = useState(''); // 粘贴的基础指令
    const [manualPasteImportMode, setManualPasteImportMode] = useState<'merge-add' | 'replace'>('replace');
    const [manualPasteSourceLabel, setManualPasteSourceLabel] = useState('手动粘贴'); // 来源标签

    // 图片转库功能状态
    const [showImageToLibModal, setShowImageToLibModal] = useState(false);
    const [imageToLibImages, setImageToLibImages] = useState<{ id: string; base64: string; name: string }[]>([]); // 上传的图片
    const [imageToLibConverting, setImageToLibConverting] = useState(false);
    const [imageToLibResult, setImageToLibResult] = useState<{ headers: string[]; rows: string[][] } | null>(null);
    const [imageToLibBaseInstruction, setImageToLibBaseInstruction] = useState<string>(''); // 从图片分析中提取的基础指令
    const [imageToLibUserDesc, setImageToLibUserDesc] = useState<string>(''); // 用户描述，帮助AI确定分析方向

    const activeLibrary = config.libraries.find(lib => lib.id === activeLibraryId);

    // 获取所有唯一的总库来源
    const sourceSheets = useMemo(() => {
        const sheets = new Set<string>();
        config.libraries.forEach(lib => {
            if (lib.sourceSheet) {
                sheets.add(lib.sourceSheet);
            }
        });
        return Array.from(sheets);
    }, [config.libraries]);

    // 当前激活的总库（如果没有设置，默认第一个）
    const activeSourceSheet = config.activeSourceSheet || sourceSheets[0] || '';

    // 计算有效的基础指令：优先使用从分页目录读取的创新指令（linkedInstructions），否则使用传入的 baseInstruction
    const effectiveBaseInstruction = useMemo(() => {
        // 优先使用当前总库对应的创新指令
        if (activeSourceSheet && config.linkedInstructions?.[activeSourceSheet]) {
            return config.linkedInstructions[activeSourceSheet];
        }
        // 否则使用传入的基础指令
        return baseInstruction;
    }, [activeSourceSheet, config.linkedInstructions, baseInstruction]);

    // 根据当前激活的总库过滤显示的库
    const filteredLibraries = useMemo(() => {
        // 如果只有一个或没有总库分组，显示所有库
        if (sourceSheets.length <= 1) {
            return config.libraries;
        }
        // 否则只显示当前激活总库的库
        return config.libraries.filter(lib =>
            lib.sourceSheet === activeSourceSheet || !lib.sourceSheet
        );
    }, [config.libraries, activeSourceSheet, sourceSheets]);

    // 切换总库时的处理函数
    const handleSwitchSourceSheet = (sheetName: string) => {
        // 更新激活的总库
        const updatedLibraries = config.libraries.map(lib => ({
            ...lib,
            // 只有属于当前选中总库的库才启用
            enabled: lib.sourceSheet === sheetName || !lib.sourceSheet
        }));
        onChange({
            ...config,
            activeSourceSheet: sheetName,
            libraries: updatedLibraries
        });
    };

    // 生成单组预览项
    const generateSinglePreview = useCallback(() => {
        // 根据概率过滤库
        const enabledLibraries = config.libraries.filter(lib => {
            if (!lib.enabled || lib.values.length === 0) return false;
            // 根据概率决定是否参与（默认100%必选）
            const rate = lib.participationRate ?? 100;
            if (rate >= 100) return true; // 100%必选
            if (rate <= 0) return false; // 0%不选
            return Math.random() * 100 < rate; // 按概率决定
        });
        if (enabledLibraries.length === 0) return [];

        return enabledLibraries.map(lib => {
            let picked: string[];
            if (config.combinationMode === 'random') {
                // 整体随机模式：每库只取1个
                const index = Math.floor(Math.random() * lib.values.length);
                picked = [lib.values[index]];
            } else {
                // 笛卡尔积模式：按库的pickMode取值
                picked = pickRandomValues(lib);
            }
            return {
                name: lib.name,
                value: picked.join('、'),
                color: lib.color
            };
        }).filter(item => item.value);
    }, [config]);

    // 生成多组预览（整体随机模式按创新个数，笛卡尔积模式只显示1组示例）
    const generateMultiplePreview = useCallback(() => {
        if (!config.enabled) return [];
        // 只检查是否有启用的库（概率过滤在generateSinglePreview里做）
        const hasEnabledLibraries = config.libraries.some(lib => lib.enabled && lib.values.length > 0);
        if (!hasEnabledLibraries) return [];

        if (config.combinationMode === 'random') {
            // 整体随机模式：按创新个数生成多组
            const groups: { name: string; value: string; color: string }[][] = [];
            for (let i = 0; i < innovationCount; i++) {
                groups.push(generateSinglePreview());
            }
            return groups;
        } else {
            // 笛卡尔积模式：只显示1组示例
            return [generateSinglePreview()];
        }
    }, [config, innovationCount, generateSinglePreview]);

    // 更新预览
    useEffect(() => {
        if (config.enabled) {
            setPreviewGroups(generateMultiplePreview());
        }
    }, [config, generateMultiplePreview]);

    // 自动同步：组件启用且有源URL时自动刷新数据（快捷模式下不自动同步）
    useEffect(() => {
        if (!config.enabled || !config.sourceSpreadsheetUrl || isSyncing || workMode === 'quick') return;

        const autoSync = async () => {
            try {
                const spreadsheetId = extractSpreadsheetId(config.sourceSpreadsheetUrl!);
                if (!spreadsheetId) return;

                console.log('[自动同步] 开始自动同步...');
                setIsSyncing(true);

                const sheetsToRefresh = sourceSheets.length > 0 ? sourceSheets : [config.activeSourceSheet].filter(Boolean);
                const refreshedSheets = await scanMasterSheets(spreadsheetId, sheetsToRefresh as string[]);

                if (refreshedSheets.length === 0) {
                    console.log('[自动同步] 未找到数据');
                    return;
                }

                // Build a map of refreshed libraries
                const refreshedMap = new Map<string, RandomLibrary>();
                for (const masterSheet of refreshedSheets) {
                    for (const lib of masterSheet.libraries) {
                        const key = `${lib.sourceSheet || ''}::${lib.name}`;
                        refreshedMap.set(key, lib);
                    }
                }

                // Update existing libraries: preserve user settings, only update values
                const updatedLibraries = config.libraries.map(existingLib => {
                    const key = `${existingLib.sourceSheet || ''}::${existingLib.name}`;
                    const refreshedLib = refreshedMap.get(key);
                    if (refreshedLib) {
                        refreshedMap.delete(key);
                        return {
                            ...existingLib,
                            values: refreshedLib.values,
                            valuesWithCategory: refreshedLib.valuesWithCategory,
                        };
                    }
                    return existingLib;
                });

                // Add any new libraries
                for (const [, lib] of refreshedMap) {
                    updatedLibraries.push(lib);
                }

                // Preserve existing linkedInstructions, update only refreshed ones
                const linkedInstructions: Record<string, string> = { ...config.linkedInstructions };
                for (const masterSheet of refreshedSheets) {
                    if (masterSheet.linkedInstruction) {
                        linkedInstructions[masterSheet.sheetName] = masterSheet.linkedInstruction;
                    }
                }

                onChange({
                    ...config,
                    libraries: updatedLibraries,
                    linkedInstructions,
                });

                console.log('[自动同步] 完成，更新了', updatedLibraries.length, '个库');
            } catch (error) {
                console.error('[自动同步] 失败:', error);
            } finally {
                setIsSyncing(false);
            }
        };

        autoSync();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [config.enabled, config.sourceSpreadsheetUrl]); // 仅在启用状态或源URL变化时同步

    // 刷新预览
    const refreshPreview = () => {
        setPreviewGroups(generateMultiplePreview());
    };

    // 添加新库
    const handleAddLibrary = () => {
        if (!newLibraryName.trim()) return;

        const newLib = createLibrary(newLibraryName.trim(), config.libraries.length);
        const newConfig = {
            ...config,
            libraries: [...config.libraries, newLib],
        };
        onChange(newConfig);
        setActiveLibraryId(newLib.id);
        setNewLibraryName('');
        setShowAddLibraryInput(false);
    };

    // 删除库
    const handleDeleteLibrary = (id: string) => {
        setConfirmModal({
            show: true,
            message: '确定要删除这个库吗？',
            onConfirm: () => {
                const newLibraries = config.libraries.filter(lib => lib.id !== id);
                const newConfig = {
                    ...config,
                    libraries: newLibraries,
                };
                onChange(newConfig);

                if (activeLibraryId === id) {
                    setActiveLibraryId(newLibraries[0]?.id || null);
                }
                setConfirmModal({ show: false, message: '', onConfirm: () => { } });
            },
        });
    };

    // 更新库名称
    const handleUpdateLibraryName = (id: string, name: string) => {
        const newLibraries = config.libraries.map(lib =>
            lib.id === id ? { ...lib, name, updatedAt: Date.now() } : lib
        );
        onChange({ ...config, libraries: newLibraries });
        setEditingName(null);
    };

    // 更新库设置
    const updateLibrary = (id: string, updates: Partial<RandomLibrary>) => {
        const newLibraries = config.libraries.map(lib =>
            lib.id === id ? { ...lib, ...updates, updatedAt: Date.now() } : lib
        );
        onChange({ ...config, libraries: newLibraries });
    };

    // 粘贴表格数据
    const handlePaste = async () => {
        if (!activeLibrary) return;

        try {
            const text = await navigator.clipboard.readText();
            const values = parseTableData(text);

            if (values.length === 0) {
                toast.warning('未检测到有效数据');
                return;
            }

            updateLibrary(activeLibrary.id, {
                values: [...activeLibrary.values, ...values],
            });

            toast.success(`成功添加 ${values.length} 个值`);
        } catch (error) {
            toast.error('粘贴失败，请手动输入');
        }
    };

    // AI智能生成库值
    const handleAIGenerate = async () => {
        if (!activeLibrary || !onAIGenerate || !aiPrompt.trim()) return;

        setAiGenerating(true);
        try {
            const prompt = `请根据以下要求生成${aiCount}个选项，每行一个，不要编号，不要解释，只输出选项内容：
${aiPrompt}

要求：
1. 每行一个选项
2. 选项要多样化、有创意
3. 不要重复
4. 直接输出选项，不要其他内容`;

            const result = await onAIGenerate(prompt);

            // 解析结果，每行一个值
            const values = result
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0 && !line.match(/^\d+[.\、]/)); // 过滤空行和编号

            if (values.length > 0) {
                updateLibrary(activeLibrary.id, {
                    values: [...activeLibrary.values, ...values],
                });
                toast.success(`AI生成了 ${values.length} 个值`);
                setShowAIModal(false);
                setAiPrompt('');
            } else {
                toast.warning('AI未能生成有效内容，请重试');
            }
        } catch (error) {
            console.error('AI生成失败:', error);
            toast.error('AI生成失败，请重试');
        } finally {
            setAiGenerating(false);
        }
    };

    // 指令转库：将通用创意指令转换成分类的库表格
    const handleInstructionToLibConvert = async () => {
        if (!onAIGenerate || !instructionToLibInput.trim()) return;

        setInstructionToLibConverting(true);
        setExtractedBaseInstruction('');
        try {
            const prompt = `你是一个AI创意指令整理专家。请分析用户给的原始指令，将其拆分为"基础指令"和"随机库数据"两部分。

【用户原始指令】
${instructionToLibInput}

【任务要求】
1. **识别基础指令**：找出其中通用的描述、规则、要求等内容（不包含分类选项的部分）
2. **识别随机库数据**：找出其中包含分类/维度及其选项列表的部分
3. 保持用户原有内容，不要修改或精简文字

【输出格式】
请严格按照以下格式输出：

===基础指令===
（在这里输出提取的基础指令，保留原始文字）

===随机库数据===
（在这里输出TSV格式的表格，用Tab分隔列）
第一行是列标题（用户原有的分类名称）
后续每行是选项

【重要】
1. 保留用户原始内容，不要精简或修改文字
2. 如果没有明确的基础指令，===基础指令===后面留空
3. 如果没有明确的随机库数据，===随机库数据===后面留空
4. 随机库数据必须是TSV格式（Tab分隔）`;

            const result = await onAIGenerate(prompt);

            // 解析结果
            const baseInstructionMatch = result.match(/===基础指令===\s*([\s\S]*?)(?====随机库数据===|$)/);
            const libraryDataMatch = result.match(/===随机库数据===\s*([\s\S]*?)$/);

            // 提取基础指令
            const extractedBase = baseInstructionMatch?.[1]?.trim() || '';
            setExtractedBaseInstruction(extractedBase);

            // 解析随机库数据
            const libraryData = libraryDataMatch?.[1]?.trim() || '';
            const lines = libraryData.split('\n').filter(line => line.trim());

            if (lines.length >= 2) {
                const headers = lines[0].split('\t').map(h => h.trim()).filter(h => h);
                const rows = lines.slice(1).map(line => {
                    const cells = line.split('\t').map(c => c.trim());
                    while (cells.length < headers.length) cells.push('');
                    return cells.slice(0, headers.length);
                });

                setInstructionToLibResult({ headers, rows });
                toast.success(`成功提取！基础指令 ${extractedBase ? '✓' : '无'}, 随机库 ${headers.length} 列 × ${rows.length} 行`);
            } else if (extractedBase) {
                setInstructionToLibResult(null);
                toast.success('成功提取基础指令！未识别到随机库数据');
            } else {
                toast.warning('AI未能识别出内容结构，请重试');
            }
        } catch (error) {
            console.error('指令转库失败:', error);
            toast.error('转换失败，请重试');
        } finally {
            setInstructionToLibConverting(false);
        }
    };

    // 复制转换结果为TSV格式
    const copyInstructionToLibResult = () => {
        if (!instructionToLibResult) return;
        const { headers, rows } = instructionToLibResult;
        const tsv = [headers.join('\t'), ...rows.map(row => row.join('\t'))].join('\n');
        navigator.clipboard.writeText(tsv);
        toast.success('已复制为表格格式，可直接粘贴到 Google Sheets');
    };

    // 复制提取的基础指令
    const copyExtractedBaseInstruction = () => {
        if (!extractedBaseInstruction) return;
        navigator.clipboard.writeText(extractedBaseInstruction);
        toast.success('已复制基础指令');
    };

    // 图片转库：处理图片上传
    const handleImageToLibUpload = (files: FileList | null) => {
        if (!files) return;

        Array.from(files).forEach(file => {
            if (!file.type.startsWith('image/')) return;

            const reader = new FileReader();
            reader.onload = (e) => {
                const base64 = e.target?.result as string;
                setImageToLibImages(prev => [...prev, {
                    id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                    base64,
                    name: file.name
                }]);
            };
            reader.readAsDataURL(file);
        });
    };

    // 图片转库：删除图片
    const handleImageToLibDelete = (id: string) => {
        setImageToLibImages(prev => prev.filter(img => img.id !== id));
    };

    // 图片转库：从URL加载图片（直接返回URL用于显示）
    const loadImageFromUrl = async (url: string): Promise<string | null> => {
        return new Promise((resolve) => {
            const img = document.createElement('img');
            img.onload = () => resolve(url);
            img.onerror = () => resolve(null);
            img.src = url;
        });
    };

    // 图片转库：把多张图片拼接成一张网格图（用于发送给AI分析）
    const combineImagesToGrid = async (imageSources: string[]): Promise<string | null> => {
        if (imageSources.length === 0) return null;

        // 加载图片（区分base64和URL）
        const loadImage = async (src: string): Promise<HTMLImageElement | null> => {
            // 如果是base64，直接加载
            if (src.startsWith('data:')) {
                return new Promise((resolve) => {
                    const img = document.createElement('img');
                    img.onload = () => resolve(img);
                    img.onerror = () => resolve(null);
                    img.src = src;
                });
            }

            // 如果是URL，通过图片代理服务加载
            // wsrv.nl 是一个专门的图片代理服务，支持CORS
            const proxyUrl = `https://wsrv.nl/?url=${encodeURIComponent(src)}`;

            return new Promise((resolve) => {
                const img = document.createElement('img');
                img.crossOrigin = 'anonymous';
                img.onload = () => resolve(img);
                img.onerror = () => resolve(null);
                img.src = proxyUrl;
            });
        };

        const loadedImages: HTMLImageElement[] = [];
        for (const src of imageSources) {
            const img = await loadImage(src);
            if (img) loadedImages.push(img);
        }

        if (loadedImages.length === 0) return null;

        // 计算网格布局（每行最多4张图片）
        const cols = Math.min(4, loadedImages.length);
        const rows = Math.ceil(loadedImages.length / cols);

        // 单个图片缩放到的最大尺寸
        const maxCellSize = 400;

        // 计算每个单元格的实际尺寸
        const cellWidth = maxCellSize;
        const cellHeight = maxCellSize;

        // 创建canvas
        const canvas = document.createElement('canvas');
        canvas.width = cols * cellWidth;
        canvas.height = rows * cellHeight;
        const ctx = canvas.getContext('2d');

        if (!ctx) return null;

        // 填充白色背景
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);

        // 绘制每张图片
        try {
            for (let i = 0; i < loadedImages.length; i++) {
                const img = loadedImages[i];
                const col = i % cols;
                const row = Math.floor(i / cols);

                // 计算缩放比例（保持比例填充单元格）
                const scale = Math.min(cellWidth / img.naturalWidth, cellHeight / img.naturalHeight);
                const drawWidth = img.naturalWidth * scale;
                const drawHeight = img.naturalHeight * scale;

                // 居中绘制
                const x = col * cellWidth + (cellWidth - drawWidth) / 2;
                const y = row * cellHeight + (cellHeight - drawHeight) / 2;

                ctx.drawImage(img, x, y, drawWidth, drawHeight);
            }

            // 转换为base64
            return canvas.toDataURL('image/jpeg', 0.85);
        } catch (err) {
            console.error('拼图失败:', err);
            return null;
        }
    };

    // 图片转库：粘贴图片（支持直接粘贴图片、Google Sheets中的图片）
    const handleImageToLibPaste = async (e: React.ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        let hasDirectImage = false;
        const imageUrls: string[] = [];

        for (const item of Array.from(items)) {
            // 直接粘贴的图片文件
            if (item.type.startsWith('image/')) {
                hasDirectImage = true;
                const file = item.getAsFile();
                if (file) {
                    const reader = new FileReader();
                    reader.onload = (ev) => {
                        const base64 = ev.target?.result as string;
                        setImageToLibImages(prev => [...prev, {
                            id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                            base64,
                            name: `粘贴图片-${prev.length + 1}`
                        }]);
                    };
                    reader.readAsDataURL(file);
                }
            }

            // 从 HTML 中提取图片URL（Google Sheets 粘贴）
            if (item.type === 'text/html') {
                const html = await new Promise<string>((resolve) => {
                    item.getAsString(resolve);
                });

                // 解析HTML提取img标签的src
                const imgRegex = /<img[^>]+src=["']([^"']+)["']/gi;
                let match;
                while ((match = imgRegex.exec(html)) !== null) {
                    const src = match[1];
                    // 过滤掉一些无效的图片（如1x1像素的跟踪图片）
                    if (src && !src.includes('1x1') && !src.includes('blank')) {
                        imageUrls.push(src);
                    }
                }
            }
        }

        // 如果有从HTML提取的图片URL，加载它们（先去重）
        const uniqueUrls = [...new Set(imageUrls)];
        if (!hasDirectImage && uniqueUrls.length > 0) {
            toast.info(`正在加载 ${uniqueUrls.length} 张图片...`);

            let loadedCount = 0;
            for (const url of uniqueUrls) {
                const base64 = await loadImageFromUrl(url);
                if (base64) {
                    loadedCount++;
                    setImageToLibImages(prev => [...prev, {
                        id: `img-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,
                        base64,
                        name: `表格图片-${prev.length + 1}`
                    }]);
                }
            }

            if (loadedCount > 0) {
                toast.success(`成功加载 ${loadedCount} 张图片`);
            } else {
                toast.warning('无法加载图片，可能是跨域限制');
            }
        }
    };

    // 图片转库：AI分析图片生成随机库
    const handleImageToLibConvert = async () => {
        if (imageToLibImages.length === 0) return;

        // 需要 onAIAnalyzeImages 或 onAIGenerate
        if (!onAIAnalyzeImages && !onAIGenerate) {
            toast.error('AI分析功能不可用');
            return;
        }

        setImageToLibConverting(true);
        setImageToLibResult(null);
        setImageToLibBaseInstruction('');

        try {
            // 构建分析提示词
            const userDescPart = imageToLibUserDesc.trim()
                ? `\n\n【用户描述】\n用户对这些图片的描述/期望方向：${imageToLibUserDesc.trim()}\n请重点围绕用户描述的方向进行分析。`
                : '';

            const prompt = `你是一个专业的AI图像分析专家。请仔细分析给出的 ${imageToLibImages.length} 张图片（已拼接成网格图），深入提取它们的共同视觉特征，并整理成丰富可复用的随机库格式。${userDescPart}

【核心任务】
根据图片内容，智能识别并提取10-15个最相关的维度。不要拘泥于固定维度，而是根据图片实际内容来确定。

【常见维度参考】（根据图片内容选择适用的）
- **人物相关**：人物姿势、人物身份、人物表情、年龄段、服装风格、发型、肤色
- **场景相关**：场景类型、背景元素、环境氛围、季节、天气、时间段
- **动植物**：动物种类、植物花卉、自然元素
- **物品道具**：手持元素、装饰物品、食物饮品
- **视觉风格**：艺术流派、色彩风格、光影效果、构图方式、材质质感
- **装饰元素**：边框样式、图案纹理、文字风格、装饰符号
- **文化元素**：国家特色、民族风格、宗教符号、节日主题
- **技术表现**：画面比例、渲染风格、特效类型

【输出格式】
请严格按照以下格式输出：

===基础指令===
根据这些图片的共同特点，生成一段详细的基础创作指令描述（100-200字），准确描述这类图片的核心特征、风格定位、典型元素等。

===随机库数据===
维度1名称\\t维度2名称\\t维度3名称\\t维度4名称\\t维度5名称\\t维度6名称\\t维度7名称\\t维度8名称\\t维度9名称\\t维度10名称
值1\\t值1\\t值1\\t值1\\t值1\\t值1\\t值1\\t值1\\t值1\\t值1
值2\\t值2\\t值2\\t值2\\t值2\\t值2\\t值2\\t值2\\t值2\\t值2
...（继续添加50行，每个维度必须有50个不同的值）

【重要要求】
1. **维度数量**：根据图片内容提取10-15个最相关的维度
2. **值的数量**：每个维度必须提取50个不同的值，这是硬性要求
3. **维度命名**：使用简洁明确的中文名称（2-6个字）
4. **值的格式**：每个值是简洁的标签（2-8个字），方便后续组合使用
5. **完整覆盖**：确保图片中所有明显的视觉特征都被提取
6. **创意拓展**：除了图片中直接看到的，也要拓展相关的合理变体
7. **实用导向**：生成的维度和值要对创作有实际指导意义`;

            // 如果有图片，需要用多模态方式分析
            let result: string;

            if (onAIAnalyzeImages) {
                // 把所有图片拼成一张网格图再发送给AI
                toast.info(`正在拼接 ${imageToLibImages.length} 张图片...`);

                const imageSources = imageToLibImages.map(img => img.base64);
                const combinedImage = await combineImagesToGrid(imageSources);

                if (!combinedImage) {
                    throw new Error('无法拼接图片，可能是跨域限制导致');
                }

                // 从拼接后的图片提取base64数据
                const match = combinedImage.match(/^data:([^;]+);base64,(.+)$/);
                if (!match) {
                    throw new Error('图片数据格式错误');
                }

                const images = [{ base64: match[2], mimeType: match[1] }];
                result = await onAIAnalyzeImages(images, prompt + `\n\n注意：这是${imageToLibImages.length}张图片拼接成的网格图，请分析所有图片的共同特征。`);
            } else if (onAIGenerate) {
                // 降级为纯文本模式
                result = await onAIGenerate(prompt + `\n\n（注意：由于技术限制，AI无法直接看到图片，将基于通用知识生成示例随机库。如需更精确的结果，请描述图片特点。）`);
            } else {
                throw new Error('No AI function available');
            }

            // 解析结果（复用指令转库的解析逻辑）
            const baseInstructionMatch = result.match(/===基础指令===\s*([\s\S]*?)(?====随机库数据===|$)/);
            const libraryDataMatch = result.match(/===随机库数据===\s*([\s\S]*?)$/);

            // 提取基础指令
            const extractedBase = baseInstructionMatch?.[1]?.trim() || '';
            setImageToLibBaseInstruction(extractedBase);

            // 解析随机库数据
            const libraryData = libraryDataMatch?.[1]?.trim() || '';
            const lines = libraryData.split('\n').filter(line => line.trim());

            if (lines.length >= 2) {
                const headers = lines[0].split('\t').map(h => h.trim()).filter(h => h);
                const rows = lines.slice(1).map(line => {
                    const cells = line.split('\t').map(c => c.trim());
                    while (cells.length < headers.length) cells.push('');
                    return cells.slice(0, headers.length);
                });

                setImageToLibResult({ headers, rows });
                toast.success(`成功分析 ${imageToLibImages.length} 张图片！生成 ${headers.length} 列 × ${rows.length} 行随机库`);
            } else if (extractedBase) {
                toast.success('成功提取基础指令！未能生成随机库数据');
            } else {
                toast.warning('AI未能识别出内容结构，请重试');
            }
        } catch (error) {
            console.error('图片转库失败:', error);
            toast.error('分析失败，请重试');
        } finally {
            setImageToLibConverting(false);
        }
    };

    // 复制图片转库结果
    const copyImageToLibResult = () => {
        if (!imageToLibResult) return;
        const { headers, rows } = imageToLibResult;
        const tsv = [headers.join('\t'), ...rows.map(row => row.join('\t'))].join('\n');
        navigator.clipboard.writeText(tsv);
        toast.success('已复制为表格格式，可直接粘贴到 Google Sheets');
    };

    // 复制图片转库的基础指令
    const copyImageToLibBaseInstruction = () => {
        if (!imageToLibBaseInstruction) return;
        navigator.clipboard.writeText(imageToLibBaseInstruction);
        toast.success('已复制基础指令');
    };

    // 库本地化：根据目标国家特点调整随机库内容
    const handleLocalizeLibrary = async () => {
        if (!onAIGenerate || !targetCountry.trim()) return;

        // 优先使用直接粘贴的数据，否则使用解析的数据
        const hasDirectInput = directTableInput.trim() || directBaseInstructionInput.trim();
        const hasParsedData = instructionToLibResult || extractedBaseInstruction;

        if (!hasDirectInput && !hasParsedData) {
            toast.warning('请粘贴表格数据或先解析指令');
            return;
        }

        setLocalizing(true);
        try {
            // 构建原始数据描述
            let originalData = '';

            // 基础指令：优先用直接输入的
            const baseInstr = directBaseInstructionInput.trim() || extractedBaseInstruction;
            if (baseInstr) {
                originalData += `【原始基础指令】\n${baseInstr}\n\n`;
            }

            // 随机库数据：优先用直接输入的
            if (directTableInput.trim()) {
                originalData += `【原始随机库数据】\n${directTableInput.trim()}`;
            } else if (instructionToLibResult) {
                const { headers, rows } = instructionToLibResult;
                const tsv = [headers.join('\t'), ...rows.map(row => row.join('\t'))].join('\n');
                originalData += `【原始随机库数据】\n${tsv}`;
            }

            const prompt = `你是一个AI创意内容本地化专家。请根据目标国家的文化特点，智能调整以下创意库的内容。

${originalData}

【目标国家】
${targetCountry}

【本地化规则】
1. **通用元素保留**：不具有特定国家/文化特色的通用元素（如：暖色调、特写镜头、梦幻氛围）保持不变
2. **文化特色替换**：将原有的国家/地区特色元素替换为目标国家的对应元素
   - 服饰：替换为目标国家的传统或现代服饰
   - 场景：替换为目标国家的标志性地点或典型环境
   - 道具：替换为目标国家的文化符号或常见物品
   - 人物特征：调整为符合目标国家审美的特征
   - 节日/习俗：替换为目标国家的节日和习俗
3. **保持库结构**：保持原有的分类维度/列名不变，只替换具体的值
4. **数量对等**：每个分类的选项数量与原始数据保持一致

【输出格式】
请严格按照以下格式输出：

===本地化基础指令===
（如果有基础指令，输出调整后的版本；没有则留空）

===本地化随机库===
（输出TSV格式的表格，用Tab分隔列，保持原有列名）

【重要】
1. 保持原有的库结构和分类名称
2. 只替换需要本地化的值，通用值保留
3. 替换后的内容要符合目标国家的文化特点
4. 确保输出格式正确（TSV格式，Tab分隔）`;

            const result = await onAIGenerate(prompt);

            // 解析结果
            const baseInstructionMatch = result.match(/===本地化基础指令===\s*([\s\S]*?)(?====本地化随机库===|$)/);
            const libraryDataMatch = result.match(/===本地化随机库===\s*([\s\S]*?)$/);

            // 提取本地化后的基础指令
            const localizedBase = baseInstructionMatch?.[1]?.trim() || '';
            setLocalizedBaseInstruction(localizedBase);

            // 解析本地化后的随机库数据
            const libraryData = libraryDataMatch?.[1]?.trim() || '';
            const lines = libraryData.split('\n').filter(line => line.trim());

            if (lines.length >= 2) {
                const headers = lines[0].split('\t').map(h => h.trim()).filter(h => h);
                const rows = lines.slice(1).map(line => {
                    const cells = line.split('\t').map(c => c.trim());
                    while (cells.length < headers.length) cells.push('');
                    return cells.slice(0, headers.length);
                });

                setLocalizedResult({ headers, rows });
                toast.success(`本地化完成！已调整为${targetCountry}特色`);
            } else if (localizedBase) {
                setLocalizedResult(null);
                toast.success('基础指令已本地化！未识别到随机库数据');
            } else {
                toast.warning('本地化失败，请重试');
            }
        } catch (error) {
            console.error('本地化失败:', error);
            toast.error('本地化失败，请重试');
        } finally {
            setLocalizing(false);
        }
    };

    // 复制本地化后的结果
    const copyLocalizedResult = () => {
        if (!localizedResult) return;
        const { headers, rows } = localizedResult;
        const tsv = [headers.join('\t'), ...rows.map(row => row.join('\t'))].join('\n');
        navigator.clipboard.writeText(tsv);
        toast.success('已复制本地化表格');
    };

    const copyLocalizedBaseInstruction = () => {
        if (!localizedBaseInstruction) return;
        navigator.clipboard.writeText(localizedBaseInstruction);
        toast.success('已复制本地化基础指令');
    };

    // 清空库
    const handleClearLibrary = () => {
        if (!activeLibrary) return;
        setConfirmModal({
            show: true,
            message: '确定要清空这个库的所有值吗？',
            onConfirm: () => {
                updateLibrary(activeLibrary.id, { values: [] });
                setConfirmModal({ show: false, message: '', onConfirm: () => { } });
            },
        });
    };

    // 删除单个值
    const handleDeleteValue = (index: number) => {
        if (!activeLibrary) return;
        const newValues = [...activeLibrary.values];
        newValues.splice(index, 1);
        updateLibrary(activeLibrary.id, { values: newValues });
    };

    // 导出
    const handleExport = () => {
        const json = exportLibraries(config);
        const blob = new Blob([json], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `随机库_${new Date().toISOString().split('T')[0]}.json`;
        a.click();
        URL.revokeObjectURL(url);
    };

    // 导入
    const handleImport = () => {
        try {
            const newConfig = importLibraries(importText, config, { mode: importMode });
            onChange(newConfig);
            setShowImportModal(false);
            setImportText('');
            toast.success('导入成功！');
        } catch (error: any) {
            toast.error(error.message || '导入失败');
        }
    };

    // 手动粘贴库+基础指令
    const handleManualPasteImport = () => {
        const tableText = manualPasteTableInput.trim();
        const baseInstr = manualPasteBaseInstruction.trim();

        if (!tableText && !baseInstr) {
            toast.warning('请至少粘贴库表格数据或基础指令');
            return;
        }

        let newLibraries: RandomLibrary[] = [];
        const sourceLabel = manualPasteSourceLabel.trim() || '手动粘贴';

        // 解析表格数据为库
        if (tableText) {
            newLibraries = parseTableDataToLibraries(tableText, { sourceLabel });
            if (newLibraries.length === 0) {
                toast.warning('未能识别表格数据，请确保第一行是库名表头，用Tab分隔');
                return;
            }
        }

        // 根据导入模式处理
        let finalLibraries: RandomLibrary[];
        if (manualPasteImportMode === 'replace') {
            finalLibraries = newLibraries;
        } else {
            // merge-add 模式：保留现有库，添加新库（同名的跳过）
            const existingNames = new Set(config.libraries.map(l => l.name));
            const addedLibs = newLibraries.filter(l => !existingNames.has(l.name));
            finalLibraries = [...config.libraries, ...addedLibs];
        }

        // 构建 linkedInstructions
        const linkedInstructions: Record<string, string> = { ...config.linkedInstructions };
        if (baseInstr) {
            linkedInstructions[sourceLabel] = baseInstr;
        }

        onChange({
            ...config,
            libraries: finalLibraries,
            linkedInstructions,
            activeSourceSheet: sourceLabel,
            transitionInstruction: DEFAULT_TRANSITION_INSTRUCTION,
        });

        // 设置第一个库为激活状态
        if (finalLibraries.length > 0) {
            setActiveLibraryId(finalLibraries[0].id);
        }

        const libCount = newLibraries.length;
        const instrMsg = baseInstr ? '，已保存基础指令' : '';
        toast.success(`成功导入 ${libCount} 个库${instrMsg}！`);

        // 重置弹窗
        setShowManualPasteModal(false);
        setManualPasteTableInput('');
        setManualPasteBaseInstruction('');
    };

    // 从Google Sheets导入 - 步骤1：扫描总库
    const handleSheetsScan = async () => {
        if (!sheetsUrl.trim()) {
            toast.warning('请输入Google Sheets链接');
            return;
        }

        const spreadsheetId = extractSpreadsheetId(sheetsUrl);
        if (!spreadsheetId) {
            toast.error('无效的Google Sheets链接，请确保链接格式正确');
            return;
        }

        setSheetsImporting(true);
        try {
            // 扫描所有可能的总库分页
            const masterSheets = await scanMasterSheets(spreadsheetId);

            if (masterSheets.length > 0) {
                // 找到了总库，进入选择步骤
                setFoundMasterSheets(masterSheets);
                setSelectedMasterSheets(new Set(masterSheets.map(s => s.sheetName))); // 默认全选
                setSheetsImportStep('select');
            } else {
                // 没有找到总库，直接使用普通导入
                await handleSheetsImportDirect();
            }
        } catch (error: any) {
            console.error('扫描表格失败:', error);
            toast.error(error.message || '扫描失败，请检查表格权限');
        } finally {
            setSheetsImporting(false);
        }
    };

    // 从Google Sheets导入 - 直接导入（无总库选择）
    const handleSheetsImportDirect = async () => {
        const spreadsheetId = extractSpreadsheetId(sheetsUrl);
        if (!spreadsheetId) return;

        setSheetsImporting(true);
        try {
            const newLibraries = await importFromGoogleSheets(
                sheetsUrl,
                config.libraries,
                sheetsImportMode
            );

            onChange({
                ...config,
                libraries: newLibraries,
                sourceSpreadsheetUrl: sheetsUrl, // 保存源 URL 用于同步刷新
            });

            const importedCount = newLibraries.length - config.libraries.length;
            resetSheetsImportModal();
            toast.success(`成功导入 ${importedCount > 0 ? importedCount + ' 个新库' : '数据已更新'}！`);
        } catch (error: any) {
            console.error('Google Sheets导入失败:', error);
            toast.error(error.message || '导入失败，请检查表格权限');
        } finally {
            setSheetsImporting(false);
        }
    };

    // 从Google Sheets导入 - 步骤2：导入选中的总库
    const handleSheetsImportSelected = async () => {
        if (selectedMasterSheets.size === 0) {
            toast.warning('请至少选择一个分页');
            return;
        }

        setSheetsImporting(true);
        try {
            // replace模式：彻底清空现有库，只保留从表格导入的库
            // merge模式：保留现有库
            let allLibraries: RandomLibrary[] =
                sheetsImportMode === 'replace'
                    ? [] // 彻底清空
                    : [...config.libraries];
            const existingNames = new Set(allLibraries.map(lib => lib.name));

            // 获取所有选中的总库分页名（按顺序）
            const selectedSheetNames = foundMasterSheets
                .filter(s => selectedMasterSheets.has(s.sheetName))
                .map(s => s.sheetName);
            const firstSheetName = selectedSheetNames[0];

            // 导入选中的总库
            for (const masterSheet of foundMasterSheets) {
                if (!selectedMasterSheets.has(masterSheet.sheetName)) continue;

                // 只有第一个总库的库是启用的
                const isFirstSheet = masterSheet.sheetName === firstSheetName;

                for (const lib of masterSheet.libraries) {
                    const existing = allLibraries.find(l => l.name === lib.name);

                    if (sheetsImportMode === 'merge-update' && existing) {
                        // 合并值
                        existing.values = [...existing.values, ...lib.values];
                        existing.group = lib.group;
                        existing.sourceSheet = lib.sourceSheet;
                        existing.updatedAt = Date.now();
                    } else if (sheetsImportMode === 'merge-add') {
                        if (!existing) {
                            // 添加新库（根据是否是第一个总库设置启用状态）
                            allLibraries.push({
                                ...lib,
                                enabled: isFirstSheet
                            });
                        } else if (existing.values.length === 0 && lib.values.length > 0) {
                            // 如果已存在的库是空的，用表格数据替换
                            existing.values = lib.values;
                            existing.valuesWithCategory = lib.valuesWithCategory;
                            existing.group = lib.group;
                            existing.sourceSheet = lib.sourceSheet;
                            existing.updatedAt = Date.now();
                        }
                    } else if (sheetsImportMode === 'replace') {
                        // 替换模式：
                        // 1. 优先更新同名的预设库（没有sourceSheet的）
                        // 2. 同名+同来源的导入库合并
                        // 3. 否则添加新库
                        const presetLib = allLibraries.find(l => l.name === lib.name && !l.sourceSheet);
                        const sameSourceLib = allLibraries.find(l => l.name === lib.name && l.sourceSheet === lib.sourceSheet);

                        if (presetLib) {
                            // 更新预设库的数据
                            presetLib.values = lib.values;
                            presetLib.sourceSheet = lib.sourceSheet;
                            presetLib.group = lib.group;
                            presetLib.updatedAt = Date.now();
                            presetLib.enabled = isFirstSheet;
                        } else if (sameSourceLib) {
                            // 同名同来源：合并值
                            sameSourceLib.values = [...sameSourceLib.values, ...lib.values];
                        } else {
                            // 新库：直接添加
                            allLibraries.push({
                                ...lib,
                                enabled: isFirstSheet
                            });
                        }
                    }
                }
            }

            // 调试日志：查看导入后的sourceSheet情况
            const sourceSheetStats = new Map<string, number>();
            allLibraries.forEach(lib => {
                const sheet = lib.sourceSheet || '(无来源)';
                sourceSheetStats.set(sheet, (sourceSheetStats.get(sheet) || 0) + 1);
            });
            console.log('[导入完成] 总库来源统计:', Object.fromEntries(sourceSheetStats));
            console.log('[导入完成] 所有库:', allLibraries.map(l => ({ name: l.name, sourceSheet: l.sourceSheet })));

            // 构建创新指令映射（从分页目录B列读取的）
            const linkedInstructions: Record<string, string> = { ...config.linkedInstructions };
            for (const masterSheet of foundMasterSheets) {
                if (selectedMasterSheets.has(masterSheet.sheetName) && masterSheet.linkedInstruction) {
                    linkedInstructions[masterSheet.sheetName] = masterSheet.linkedInstruction;
                    console.log(`[导入完成] 保存创新指令: "${masterSheet.sheetName}" -> "${masterSheet.linkedInstruction.substring(0, 50)}..."`);
                }
            }

            onChange({
                ...config,
                libraries: allLibraries,
                activeSourceSheet: firstSheetName, // 设置第一个为激活的总库
                linkedInstructions, // 保存创新指令映射
                sourceSpreadsheetUrl: sheetsUrl, // 保存源 URL 用于同步刷新
                transitionInstruction: DEFAULT_TRANSITION_INSTRUCTION, // 重置过渡指令为默认值
            });

            const importedCount = allLibraries.length - config.libraries.length;
            resetSheetsImportModal();
            toast.success(`成功导入！${importedCount > 0 ? `新增 ${importedCount} 个库` : '数据已更新'}`);
        } catch (error: any) {
            console.error('导入失败:', error);
            toast.error(error.message || '导入失败');
        } finally {
            setSheetsImporting(false);
        }
    };

    // 重置导入弹窗状态
    const resetSheetsImportModal = () => {
        setShowSheetsImportModal(false);
        setSheetsUrl('');
        setSheetsImportStep('input');
        setFoundMasterSheets([]);
        setSelectedMasterSheets(new Set());

    };

    // 同步刷新：从源表格重新获取数据
    const handleSyncRefresh = async () => {
        if (!config.sourceSpreadsheetUrl) {
            toast.warning('没有导入源，请先从 Google Sheets 导入');
            return;
        }

        setIsSyncing(true);
        try {
            const spreadsheetId = extractSpreadsheetId(config.sourceSpreadsheetUrl);
            if (!spreadsheetId) {
                throw new Error('无效的表格链接');
            }

            // 重新扫描当前激活的总库
            const sheetsToRefresh = sourceSheets.length > 0 ? sourceSheets : [config.activeSourceSheet].filter(Boolean);
            console.log('[同步刷新] 刷新分页:', sheetsToRefresh);

            const refreshedSheets = await scanMasterSheets(spreadsheetId, sheetsToRefresh);

            if (refreshedSheets.length === 0) {
                toast.warning('未找到数据，请检查表格');
                return;
            }

            // Build a map of refreshed libraries by (name + sourceSheet) for matching
            const refreshedMap = new Map<string, RandomLibrary>();
            for (const masterSheet of refreshedSheets) {
                for (const lib of masterSheet.libraries) {
                    const key = `${lib.sourceSheet || ''}::${lib.name}`;
                    refreshedMap.set(key, lib);
                }
            }

            // Update existing libraries: preserve user settings, only update values
            let updatedCount = 0;
            const updatedLibraries = config.libraries.map(existingLib => {
                const key = `${existingLib.sourceSheet || ''}::${existingLib.name}`;
                const refreshedLib = refreshedMap.get(key);
                if (refreshedLib) {
                    refreshedMap.delete(key); // Mark as matched
                    updatedCount++;
                    // Preserve user settings (enabled, color, participationRate, pickMode, etc.)
                    // Only update data fields (values, valuesWithCategory)
                    return {
                        ...existingLib,
                        values: refreshedLib.values,
                        valuesWithCategory: refreshedLib.valuesWithCategory,
                    };
                }
                return existingLib; // Not refreshed, keep as-is
            });

            // Add any new libraries that didn't exist before
            const newLibs: RandomLibrary[] = [];
            for (const [, lib] of refreshedMap) {
                newLibs.push(lib);
            }
            if (newLibs.length > 0) {
                updatedLibraries.push(...newLibs);
            }

            // Preserve existing linkedInstructions, update only refreshed ones
            const linkedInstructions: Record<string, string> = { ...config.linkedInstructions };
            for (const masterSheet of refreshedSheets) {
                if (masterSheet.linkedInstruction) {
                    linkedInstructions[masterSheet.sheetName] = masterSheet.linkedInstruction;
                }
            }

            onChange({
                ...config,
                libraries: updatedLibraries,
                linkedInstructions,
            });

            toast.success(`同步完成！更新了 ${updatedCount} 个库${newLibs.length > 0 ? `，新增 ${newLibs.length} 个` : ''}`);
        } catch (error: any) {
            console.error('同步失败:', error);
            toast.error(error.message || '同步失败');
        } finally {
            setIsSyncing(false);
        }
    };

    return (
        <div className="space-y-4">
            {/* 头部：总开关和导入导出 */}
            <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2">
                        <Shuffle size={16} className="text-purple-400" />
                        <span className="font-medium text-white">随机库组合</span>
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                        <input
                            type="checkbox"
                            checked={config.enabled}
                            onChange={(e) => onChange({ ...config, enabled: e.target.checked })}
                            className="w-4 h-4 rounded border-zinc-600 bg-zinc-700 text-purple-500 focus:ring-purple-500"
                        />
                        <span className="text-sm text-zinc-400">启用</span>
                    </label>
                </div>
                <div className="flex items-center gap-2">
                    <button
                        onClick={() => {
                            setConfirmModal({
                                show: true,
                                message: '确定要恢复默认库吗？当前库会被删除。',
                                onConfirm: () => {
                                    const defaultLibraries = getDefaultLibraries();
                                    onChange({
                                        ...config,
                                        libraries: defaultLibraries,
                                    });
                                    if (defaultLibraries.length > 0) {
                                        setActiveLibraryId(defaultLibraries[0].id);
                                    }
                                    setConfirmModal({ show: false, message: '', onConfirm: () => { } });
                                },
                            });
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-orange-400 hover:text-orange-300 bg-orange-900/20 hover:bg-orange-800/30 rounded border border-orange-800/30"
                    >
                        <RotateCcw size={12} />
                        恢复默认
                    </button>
                    <button
                        onClick={handleExport}
                        disabled={config.libraries.length === 0}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700 disabled:opacity-40"
                    >
                        <Download size={12} />
                        导出
                    </button>
                    <button
                        onClick={() => setShowImportModal(true)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded border border-zinc-700"
                    >
                        <Upload size={12} />
                        导入
                    </button>
                    <button
                        onClick={() => setShowManualPasteModal(true)}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-cyan-400 hover:text-cyan-300 bg-cyan-900/20 hover:bg-cyan-800/30 rounded border border-cyan-800/30"
                        title="手动粘贴库表格数据和基础指令（无需Google Sheets）"
                    >
                        <ClipboardPaste size={12} />
                        手动粘贴
                    </button>
                    <button
                        onClick={() => {
                            // 打开弹窗时回填已保存的链接
                            if (config.sourceSpreadsheetUrl) {
                                setSheetsUrl(config.sourceSpreadsheetUrl);
                            }
                            setShowSheetsImportModal(true);
                        }}
                        className="flex items-center gap-1 px-2 py-1 text-xs text-green-400 hover:text-green-300 bg-green-900/20 hover:bg-green-800/30 rounded border border-green-800/30"
                        title="从公开的Google Sheets导入，分页名=库名，A列=值"
                    >
                        <Library size={12} />
                        从表格导入
                    </button>
                    {/* 同步刷新按钮 */}
                    {config.sourceSpreadsheetUrl && (
                        <button
                            onClick={handleSyncRefresh}
                            disabled={isSyncing}
                            className="flex items-center gap-1 px-2 py-1 text-xs text-blue-400 hover:text-blue-300 bg-blue-900/20 hover:bg-blue-800/30 rounded border border-blue-800/30 disabled:opacity-50"
                            title="从源表格同步最新数据"
                        >
                            <RefreshCw size={12} className={isSyncing ? 'animate-spin' : ''} />
                            {isSyncing ? '同步中...' : '同步刷新'}
                        </button>
                    )}
                </div>
            </div>

            {config.enabled && (
                <>
                    {/* 1. 组合模式选择 - 快捷模式下只显示整体随机 */}
                    {workMode !== 'quick' && (
                        <div className="p-3 bg-zinc-800/60 rounded-lg border border-zinc-700/50 space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs font-medium text-zinc-400">组合模式:</span>
                            </div>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="combinationMode"
                                        value="random"
                                        checked={config.combinationMode !== 'cartesian'}
                                        onChange={() => onChange({ ...config, combinationMode: 'random' })}
                                        className="w-3.5 h-3.5 text-purple-500"
                                    />
                                    <div>
                                        <span className="font-medium">整体随机</span>
                                        <span className="text-zinc-500 ml-1">（由创新个数控制，各库各随机1个）</span>
                                    </div>
                                </label>
                            </div>
                            <div className="flex items-center gap-4">
                                <label className="flex items-center gap-2 text-xs text-zinc-300 cursor-pointer">
                                    <input
                                        type="radio"
                                        name="combinationMode"
                                        value="cartesian"
                                        checked={config.combinationMode === 'cartesian'}
                                        onChange={() => onChange({ ...config, combinationMode: 'cartesian' })}
                                        className="w-3.5 h-3.5 text-purple-500"
                                    />
                                    <div>
                                        <span className="font-medium">笛卡尔积</span>
                                        <span className="text-zinc-500 ml-1">（场景5×风格2=10组，生成所有排列组合）</span>
                                    </div>
                                </label>
                            </div>
                        </div>
                    )}

                    {/* 分类联动开关 / AI智能分类 */}
                    {config.libraries.length > 0 && (
                        <div className="mt-2 p-2 bg-purple-900/20 border border-purple-700/30 rounded-lg">
                            <div className="flex items-center justify-between">
                                <label className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={config.categoryLinkEnabled ?? true}
                                        onChange={(e) => onChange({ ...config, categoryLinkEnabled: e.target.checked })}
                                        className="w-4 h-4 rounded border-zinc-600 bg-zinc-700 text-purple-500 focus:ring-0"
                                        disabled={!hasCategoryLinkData(config)}
                                    />
                                    <div className="text-sm">
                                        <span className="text-purple-300 font-medium">启用分类联动</span>
                                        <span className="text-zinc-400 ml-2">
                                            {hasCategoryLinkData(config)
                                                ? '（自动按分类筛选，避免不合理组合）'
                                                : '（需先添加分类数据）'}
                                        </span>
                                    </div>
                                </label>
                                {workMode !== 'quick' && (
                                    <>
                                        {/* AI智能分类按钮 */}
                                        <button
                                            onClick={() => setShowAiCategoryModal(true)}
                                            className="px-3 py-1.5 text-xs bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-lg flex items-center gap-1.5"
                                        >
                                            <Sparkles className="w-3.5 h-3.5" />
                                            AI智能分类
                                        </button>
                                        {/* 指令转库按钮 */}
                                        <button
                                            onClick={() => setShowInstructionToLibModal(true)}
                                            className="px-3 py-1.5 text-xs bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 text-white rounded-lg flex items-center gap-1.5"
                                        >
                                            <ArrowRightLeft className="w-3.5 h-3.5" />
                                            指令转库
                                        </button>
                                        {/* 图片转库按钮 */}
                                        <button
                                            onClick={() => setShowImageToLibModal(true)}
                                            className="px-3 py-1.5 text-xs bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 text-white rounded-lg flex items-center gap-1.5"
                                        >
                                            <ImageIcon className="w-3.5 h-3.5" />
                                            图片转库
                                        </button>
                                    </>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 2. 总库切换标签页（当有多个总库时显示） */}
                    {sourceSheets.length > 1 && (
                        <div className="flex items-center gap-2 mb-3">
                            <span className="text-xs text-zinc-400">切换总库：</span>
                            <div className="flex gap-1 flex-wrap">
                                {sourceSheets.map((sheet) => (
                                    <button
                                        key={sheet}
                                        onClick={() => handleSwitchSourceSheet(sheet)}
                                        className={`px-3 py-1.5 text-xs rounded-lg transition-all ${activeSourceSheet === sheet
                                            ? 'bg-purple-600 text-white shadow-lg shadow-purple-500/30'
                                            : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                                            }`}
                                    >
                                        {sheet}
                                        <span className="ml-1 text-zinc-400">
                                            ({config.libraries.filter(lib => lib.sourceSheet === sheet).length})
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* 3. 库标签页 + 库内容 */}
                    <div className="flex items-center gap-1 flex-wrap border-b border-zinc-700 pb-2">
                        {filteredLibraries.map((lib) => (
                            <div
                                key={lib.id}
                                className={`group relative flex items-center gap-1 px-2 py-1 rounded-t text-xs cursor-pointer transition-all ${activeLibraryId === lib.id
                                    ? 'bg-zinc-700 text-white'
                                    : 'bg-zinc-800/50 text-zinc-400 hover:text-white hover:bg-zinc-700/50'
                                    } ${!lib.enabled ? 'opacity-50' : ''}`}
                                style={{
                                    borderBottom: activeLibraryId === lib.id ? `2px solid ${lib.color}` : undefined,
                                }}
                                onClick={() => setActiveLibraryId(lib.id)}
                            >
                                <input
                                    type="checkbox"
                                    checked={lib.enabled}
                                    onChange={(e) => {
                                        e.stopPropagation();
                                        updateLibrary(lib.id, { enabled: e.target.checked });
                                    }}
                                    className="w-3 h-3 rounded border-zinc-600 bg-zinc-700 text-purple-500 focus:ring-0"
                                />
                                {editingName === lib.id ? (
                                    <input
                                        type="text"
                                        value={newName}
                                        onChange={(e) => setNewName(e.target.value)}
                                        onBlur={() => {
                                            if (newName.trim()) {
                                                handleUpdateLibraryName(lib.id, newName.trim());
                                            }
                                            setEditingName(null);
                                        }}
                                        onKeyDown={(e) => {
                                            if (e.key === 'Enter' && newName.trim()) {
                                                handleUpdateLibraryName(lib.id, newName.trim());
                                            }
                                            if (e.key === 'Escape') {
                                                setEditingName(null);
                                            }
                                        }}
                                        className="w-16 px-1 py-0 text-xs bg-zinc-600 border-none rounded focus:ring-1 focus:ring-purple-500"
                                        autoFocus
                                        onClick={(e) => e.stopPropagation()}
                                    />
                                ) : (
                                    <span
                                        onDoubleClick={(e) => {
                                            e.stopPropagation();
                                            setEditingName(lib.id);
                                            setNewName(lib.name);
                                        }}
                                    >
                                        {lib.name}
                                    </span>
                                )}
                                <span className={lib.values.length > 0 ? 'text-emerald-400' : 'text-zinc-500'}>({lib.values.length})</span>
                                <button
                                    onClick={(e) => {
                                        e.stopPropagation();
                                        handleDeleteLibrary(lib.id);
                                    }}
                                    className="opacity-0 group-hover:opacity-100 p-0.5 hover:text-red-400 transition-opacity"
                                >
                                    <X size={10} />
                                </button>
                            </div>
                        ))}

                        {showAddLibraryInput ? (
                            <div className="flex items-center gap-1">
                                <input
                                    type="text"
                                    value={newLibraryName}
                                    onChange={(e) => setNewLibraryName(e.target.value)}
                                    onKeyDown={(e) => {
                                        if (e.key === 'Enter') handleAddLibrary();
                                        if (e.key === 'Escape') {
                                            setShowAddLibraryInput(false);
                                            setNewLibraryName('');
                                        }
                                    }}
                                    placeholder="库名称"
                                    className="w-20 px-2 py-1 text-xs bg-zinc-700 border border-zinc-600 rounded focus:ring-1 focus:ring-purple-500"
                                    autoFocus
                                />
                                <button
                                    onClick={handleAddLibrary}
                                    className="p-1 text-green-400 hover:text-green-300"
                                >
                                    <Check size={12} />
                                </button>
                                <button
                                    onClick={() => {
                                        setShowAddLibraryInput(false);
                                        setNewLibraryName('');
                                    }}
                                    className="p-1 text-zinc-400 hover:text-white"
                                >
                                    <X size={12} />
                                </button>
                            </div>
                        ) : (
                            <button
                                onClick={() => setShowAddLibraryInput(true)}
                                className="flex items-center gap-1 px-2 py-1 text-xs text-purple-400 hover:text-purple-300 bg-purple-900/20 hover:bg-purple-800/30 rounded transition-colors"
                            >
                                <Plus size={12} />
                                新建库
                            </button>
                        )}
                    </div>

                    {/* 当前库内容 */}
                    {activeLibrary && (
                        <div className="space-y-3">
                            {/* 操作栏 */}
                            <div className="flex items-center justify-between">
                                <div className="flex items-center gap-2">
                                    <span className="text-sm text-zinc-400">
                                        {activeLibrary.name} ({activeLibrary.values.length} 个值)
                                    </span>
                                </div>
                                <div className="flex items-center gap-2">
                                    {onAIGenerate && (
                                        <button
                                            onClick={() => setShowAIModal(true)}
                                            className="flex items-center gap-1 px-2 py-1 text-xs text-purple-400 hover:text-purple-300 bg-purple-900/20 hover:bg-purple-800/30 rounded border border-purple-800/30"
                                        >
                                            <Sparkles size={12} />
                                            AI生成
                                        </button>
                                    )}
                                    <button
                                        onClick={() => {
                                            // 复制为表格格式（每行一个值）
                                            const text = activeLibrary.values.join('\n');
                                            navigator.clipboard.writeText(text);
                                            toast.success('已复制到剪贴板！可粘贴到 Excel/Sheets');
                                        }}
                                        disabled={activeLibrary.values.length === 0}
                                        className="flex items-center gap-1 px-2 py-1 text-xs text-green-400 hover:text-green-300 bg-green-900/20 hover:bg-green-800/30 rounded border border-green-800/30 disabled:opacity-40"
                                    >
                                        <Copy size={12} />
                                        复制
                                    </button>
                                    <button
                                        onClick={handlePaste}
                                        className="flex items-center gap-1 px-2 py-1 text-xs text-blue-400 hover:text-blue-300 bg-blue-900/20 hover:bg-blue-800/30 rounded border border-blue-800/30"
                                    >
                                        <ClipboardPaste size={12} />
                                        粘贴追加
                                    </button>
                                    <button
                                        onClick={handleClearLibrary}
                                        disabled={activeLibrary.values.length === 0}
                                        className="flex items-center gap-1 px-2 py-1 text-xs text-red-400 hover:text-red-300 bg-red-900/20 hover:bg-red-800/30 rounded border border-red-800/30 disabled:opacity-40"
                                    >
                                        <Trash2 size={12} />
                                        清空
                                    </button>
                                </div>
                            </div>
                            {/* 抽取数量（仅笛卡尔积模式显示） */}
                            {config.combinationMode === 'cartesian' && (
                                <div className="flex items-center gap-4">
                                    <div className="flex items-center gap-2">
                                        <span className="text-xs text-zinc-500">抽取数量:</span>
                                        <input
                                            type="number"
                                            min={1}
                                            max={activeLibrary.values.length || 10}
                                            value={activeLibrary.pickMode === 'random-multiple' ? activeLibrary.pickCount : 1}
                                            onChange={(e) => {
                                                const val = parseInt(e.target.value) || 1;
                                                updateLibrary(activeLibrary.id, {
                                                    pickMode: val > 1 ? 'random-multiple' : 'random-one',
                                                    pickCount: val
                                                });
                                            }}
                                            className="w-14 px-2 py-1 text-xs bg-zinc-700 border border-zinc-600 rounded text-white focus:ring-1 focus:ring-purple-500"
                                        />
                                        <span className="text-xs text-zinc-600">
                                            (此库随机抽取几个值参与组合)
                                        </span>
                                    </div>
                                </div>
                            )}

                            {/* 参与概率滑块 */}
                            <div className="flex items-center gap-3">
                                <span className="text-xs text-zinc-500 whitespace-nowrap">参与概率:</span>
                                <input
                                    type="range"
                                    min={0}
                                    max={100}
                                    step={1}
                                    value={activeLibrary.participationRate ?? 100}
                                    onChange={(e) => {
                                        updateLibrary(activeLibrary.id, {
                                            participationRate: parseInt(e.target.value)
                                        });
                                    }}
                                    className="flex-1 h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                                />
                                <span className={`text-xs font-medium w-10 text-right ${(activeLibrary.participationRate ?? 100) >= 100
                                    ? 'text-green-400'
                                    : (activeLibrary.participationRate ?? 100) <= 0
                                        ? 'text-zinc-500'
                                        : 'text-yellow-400'
                                    }`}>
                                    {activeLibrary.participationRate ?? 100}%
                                </span>
                                <span className="text-xs text-zinc-600">
                                    {(activeLibrary.participationRate ?? 100) >= 100
                                        ? '(必选)'
                                        : (activeLibrary.participationRate ?? 100) <= 0
                                            ? '(不用)'
                                            : '(可选)'}
                                </span>
                            </div>

                            {/* 抽取说明 */}
                            <div className="flex items-center gap-2 text-xs text-zinc-500">
                                {config.combinationMode === 'cartesian' ? (
                                    <span>笛卡尔积模式：各库抽取数量的乘积 = 总组合数</span>
                                ) : (
                                    <span>整体随机模式：每次从各库各随机1个组成组合</span>
                                )}
                            </div>

                            {/* 值列表（表格视图） */}
                            <div className="max-h-40 overflow-auto border border-zinc-700 rounded bg-zinc-800/50">
                                {activeLibrary.values.length === 0 ? (
                                    <div className="flex flex-col items-center justify-center py-8 text-zinc-500">
                                        <Library size={24} className="mb-2 opacity-50" />
                                        <p className="text-sm">库为空</p>
                                        <p className="text-xs">点击"粘贴表格"从 Google Sheets 添加数据</p>
                                    </div>
                                ) : (
                                    <div className="grid grid-cols-3 sm:grid-cols-4 md:grid-cols-6 gap-1 p-2">
                                        {activeLibrary.values.map((value, index) => {
                                            // 获取该值的分类信息
                                            const categoryInfo = activeLibrary.valuesWithCategory?.find(v => v.value === value);
                                            const categories = categoryInfo?.categories;
                                            // 获取该值的权重（默认为1）
                                            const weight = activeLibrary.valueWeights?.[value] ?? 1;

                                            // 点击显示权重调整弹框
                                            const handleWeightClick = (e: React.MouseEvent) => {
                                                e.stopPropagation();
                                                const rect = (e.target as HTMLElement).getBoundingClientRect();
                                                setWeightPopup({
                                                    value,
                                                    weight,
                                                    position: { x: rect.left, y: rect.bottom + 5 }
                                                });
                                            };

                                            // 右键重置权重
                                            const handleWeightReset = (e: React.MouseEvent) => {
                                                e.preventDefault();
                                                e.stopPropagation();
                                                const newWeights = { ...(activeLibrary.valueWeights || {}) };
                                                delete newWeights[value];
                                                updateLibrary(activeLibrary.id, { valueWeights: newWeights });
                                            };

                                            return (
                                                <div
                                                    key={index}
                                                    className="group relative px-2 py-1.5 text-xs text-zinc-300 bg-zinc-700/50 rounded hover:bg-zinc-600/50"
                                                    title={`${value}${categories ? ` [${categories.join(', ')}]` : ''} | 权重: ${weight}x (点击调整, 右键重置)`}
                                                >
                                                    <div className="flex items-center gap-1">
                                                        <span className="truncate flex-1">{value}</span>
                                                        {/* 权重指示器 */}
                                                        <button
                                                            onClick={handleWeightClick}
                                                            onContextMenu={handleWeightReset}
                                                            className={`flex-shrink-0 w-4 h-4 text-[9px] font-bold rounded ${weight > 1
                                                                ? 'bg-amber-500 text-black'
                                                                : 'bg-zinc-600 text-zinc-400 opacity-0 group-hover:opacity-100'
                                                                } transition-opacity`}
                                                            title={`权重: ${weight}x (点击+1, 右键重置)`}
                                                        >
                                                            {weight}
                                                        </button>
                                                    </div>
                                                    {categories && categories.length > 0 && (
                                                        <div className="flex flex-wrap gap-0.5 mt-0.5">
                                                            {categories.slice(0, 2).map((cat, i) => (
                                                                <span key={i} className="px-1 py-0 text-[10px] bg-purple-600/40 text-purple-300 rounded">
                                                                    {cat}
                                                                </span>
                                                            ))}
                                                            {categories.length > 2 && (
                                                                <span className="px-1 py-0 text-[10px] text-zinc-500">+{categories.length - 2}</span>
                                                            )}
                                                        </div>
                                                    )}
                                                    <button
                                                        onClick={() => handleDeleteValue(index)}
                                                        className="absolute -top-1 -right-1 w-4 h-4 flex items-center justify-center bg-red-500 text-white rounded-full opacity-0 group-hover:opacity-100 transition-opacity"
                                                    >
                                                        <X size={8} />
                                                    </button>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {/* 3. 过渡指令 - 快捷模式下隐藏 */}
                    {workMode !== 'quick' && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-500">过渡指令:</span>
                                <span className="text-xs text-zinc-600">
                                    (连接创新指令和随机组合的文本，不可修改)
                                </span>
                            </div>
                            <div className="w-full px-3 py-2 text-sm bg-zinc-800/50 border border-zinc-700 rounded text-zinc-400 min-h-[40px]">
                                {DEFAULT_TRANSITION_INSTRUCTION}
                            </div>
                        </div>
                    )}

                    {/* 4. 输出格式 - 快捷模式下隐藏（使用默认格式） */}
                    {workMode !== 'quick' && (
                        <div className="space-y-2">
                            <div className="flex items-center gap-2">
                                <span className="text-xs text-zinc-500">输出格式:</span>
                                <span className="text-xs text-zinc-600">
                                    (使用 {'{'}库名{'}'} 作为占位符，留空则使用默认格式)
                                </span>
                            </div>
                            <input
                                type="text"
                                value={config.insertTemplate}
                                onChange={(e) => onChange({ ...config, insertTemplate: e.target.value })}
                                placeholder={`留空使用默认格式，或自定义如：在{场景库}里，使用{风格库}风格`}
                                className="w-full px-3 py-2 text-sm bg-zinc-700 border border-zinc-600 rounded text-white placeholder-zinc-500 focus:ring-1 focus:ring-purple-500"
                            />
                            <div className="text-xs text-zinc-600 bg-zinc-800/50 rounded p-2 space-y-1">
                                <p className="text-zinc-500 font-medium">📋 格式示例（假设场景=森林，风格=赛博朋克）：</p>
                                <p>• <span className="text-zinc-400">留空默认</span> → 场景：森林，风格：赛博朋克</p>
                                <p>• <span className="text-zinc-400">在{'{场景库}'}里，使用{'{风格库}'}风格</span> → 在森林里，使用赛博朋克风格</p>
                                <p>• <span className="text-zinc-400">主题：{'{场景库}'} | 艺术：{'{风格库}'}</span> → 主题：森林 | 艺术：赛博朋克</p>
                            </div>
                        </div>
                    )}

                    {/* 5. 插入位置 - 快捷模式下隐藏（固定为指令后） */}
                    {workMode !== 'quick' && (
                        <div className="flex items-center gap-4">
                            <span className="text-xs text-zinc-500">插入位置:</span>
                            <label className="flex items-center gap-1 text-xs text-zinc-400 cursor-pointer">
                                <input
                                    type="radio"
                                    name="insertPosition"
                                    value="before"
                                    checked={config.insertPosition === 'before'}
                                    onChange={() => onChange({ ...config, insertPosition: 'before' })}
                                    className="w-3 h-3"
                                />
                                指令前
                            </label>
                            <label className="flex items-center gap-1 text-xs text-zinc-400 cursor-pointer">
                                <input
                                    type="radio"
                                    name="insertPosition"
                                    value="after"
                                    checked={config.insertPosition === 'after'}
                                    onChange={() => onChange({ ...config, insertPosition: 'after' })}
                                    className="w-3 h-3"
                                />
                                指令后
                            </label>
                        </div>
                    )}

                    {/* 预览 */}
                    <div className="space-y-2 p-3 bg-zinc-800/50 rounded border border-zinc-700">
                        <div className="flex items-center justify-between">
                            <div className="flex items-center gap-2">
                                <Eye size={12} className="text-zinc-500" />
                                <span className="text-xs text-zinc-500">
                                    预览 {config.combinationMode === 'random' ? `(${previewGroups.length}组)` : '(笛卡尔积示例)'}:
                                </span>
                            </div>
                            <button
                                onClick={refreshPreview}
                                className="flex items-center gap-1 px-2 py-0.5 text-xs text-purple-400 hover:text-purple-300"
                            >
                                <RotateCcw size={10} />
                                刷新
                            </button>
                        </div>
                        <div className="text-sm max-h-40 overflow-y-auto space-y-1.5">
                            {previewGroups.length > 0 ? (
                                previewGroups.map((group, groupIdx) => (
                                    <div key={groupIdx} className="flex flex-wrap gap-1 items-center">
                                        {config.combinationMode === 'random' && (
                                            <span className="text-[10px] text-zinc-600 mr-1">#{groupIdx + 1}</span>
                                        )}
                                        {group.map((item, idx) => (
                                            <span key={idx} className="inline-flex items-center gap-1">
                                                <span
                                                    className="font-medium"
                                                    style={{ color: item.color }}
                                                >
                                                    {item.name}：
                                                </span>
                                                <span className="text-zinc-300">{item.value}</span>
                                                {idx < group.length - 1 && <span className="text-zinc-600 mx-0.5">，</span>}
                                            </span>
                                        ))}
                                    </div>
                                ))
                            ) : (
                                <span className="text-zinc-500 italic">(启用库并添加值后显示预览)</span>
                            )}
                        </div>

                        {/* 预览最终指令按钮 */}
                        {previewGroups.length > 0 && (
                            <div className="mt-3 pt-3 border-t border-zinc-700">
                                <button
                                    onClick={() => setShowFinalPreview(true)}
                                    className="flex items-center gap-1.5 px-3 py-1.5 text-xs bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white rounded-lg transition-all"
                                >
                                    <Eye size={12} />
                                    预览最终指令
                                </button>
                            </div>
                        )}
                    </div>

                    {/* 预览最终指令弹框 */}
                    {showFinalPreview && (
                        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
                            <div className="w-full max-w-2xl max-h-[80vh] p-5 bg-zinc-800 rounded-xl border border-zinc-700 shadow-2xl overflow-hidden flex flex-col">
                                <div className="flex items-center justify-between mb-4">
                                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                                        <Eye size={18} className="text-purple-400" />
                                        最终指令预览
                                    </h3>
                                    <button
                                        onClick={() => setShowFinalPreview(false)}
                                        className="p-1.5 text-zinc-400 hover:text-white hover:bg-zinc-700 rounded-lg transition-colors"
                                    >
                                        <X size={18} />
                                    </button>
                                </div>

                                <div className="flex-1 overflow-y-auto space-y-4">
                                    {/* 图例 */}
                                    <div className="flex items-center gap-4 text-xs p-2 bg-zinc-900/50 rounded-lg flex-wrap">
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-3 h-3 rounded bg-blue-500"></span>
                                            <span className="text-zinc-400">基础指令</span>
                                        </span>
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-3 h-3 rounded bg-green-500"></span>
                                            <span className="text-zinc-400">用户特殊要求</span>
                                        </span>
                                        {workMode !== 'quick' && (
                                            <span className="flex items-center gap-1.5">
                                                <span className="w-3 h-3 rounded bg-yellow-500"></span>
                                                <span className="text-zinc-400">过渡指令</span>
                                            </span>
                                        )}
                                        <span className="flex items-center gap-1.5">
                                            <span className="w-3 h-3 rounded bg-purple-500"></span>
                                            <span className="text-zinc-400">随机库组合</span>
                                        </span>
                                    </div>

                                    {/* 预览内容 */}
                                    {previewGroups.slice(0, 3).map((group, groupIdx) => {
                                        // 生成随机库组合文本
                                        const randomLibraryText = config.insertTemplate
                                            ? group.reduce(
                                                (text, item) => text.replace(`{${item.name}}`, item.value),
                                                config.insertTemplate
                                            )
                                            : group.map(item => `${item.name}：${item.value}`).join('，');

                                        return (
                                            <div key={groupIdx} className="p-4 bg-zinc-900/50 rounded-lg border border-zinc-700">
                                                <div className="text-xs text-zinc-500 mb-2 font-medium">
                                                    组合 #{groupIdx + 1}
                                                </div>
                                                <div className="space-y-2 text-sm leading-relaxed">
                                                    {/* 基础指令 */}
                                                    {effectiveBaseInstruction && (
                                                        <div className="p-2 rounded border-l-4 border-blue-500 bg-blue-900/20">
                                                            <span className="text-blue-300 whitespace-pre-wrap">{effectiveBaseInstruction}</span>
                                                        </div>
                                                    )}

                                                    {/* 用户特殊要求 */}
                                                    {globalUserPrompt && (
                                                        <div className="p-2 rounded border-l-4 border-green-500 bg-green-900/20">
                                                            <div className="text-xs text-green-400 mb-1 font-medium">【用户特别要求】</div>
                                                            <span className="text-green-300 whitespace-pre-wrap">{globalUserPrompt}</span>
                                                        </div>
                                                    )}

                                                    {/* 过渡指令 */}
                                                    {workMode !== 'quick' && (
                                                        <div className="p-2 rounded border-l-4 border-yellow-500 bg-yellow-900/20">
                                                            <span className="text-yellow-300 whitespace-pre-wrap">{DEFAULT_TRANSITION_INSTRUCTION}</span>
                                                        </div>
                                                    )}

                                                    {/* 随机库组合 */}
                                                    <div className="p-2 rounded border-l-4 border-purple-500 bg-purple-900/20">
                                                        <span className="text-purple-300">{randomLibraryText}</span>
                                                    </div>

                                                    {/* 优先级说明（动态） */}
                                                    <div className="p-2 rounded border-l-4 border-orange-500 bg-orange-900/20">
                                                        <span className="text-orange-300 whitespace-pre-wrap">{getPriorityInstruction(false, true)}</span>
                                                    </div>
                                                </div>
                                            </div>
                                        );
                                    })}

                                    {previewGroups.length > 3 && (
                                        <div className="text-center text-xs text-zinc-500">
                                            还有 {previewGroups.length - 3} 个组合...
                                        </div>
                                    )}
                                </div>

                                <div className="mt-4 pt-4 border-t border-zinc-700 flex justify-end">
                                    <button
                                        onClick={() => setShowFinalPreview(false)}
                                        className="px-4 py-2 text-sm bg-zinc-700 hover:bg-zinc-600 text-white rounded-lg transition-colors"
                                    >
                                        关闭
                                    </button>
                                </div>
                            </div>
                        </div>
                    )}
                </>
            )}

            {/* 导入弹窗 */}
            {showImportModal && (
                <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50">
                    <div className="w-full max-w-md p-4 bg-zinc-800 rounded-lg border border-zinc-700 shadow-xl">
                        <div className="flex items-center justify-between mb-4">
                            <h3 className="font-medium text-white">导入随机库</h3>
                            <button
                                onClick={() => setShowImportModal(false)}
                                className="p-1 text-zinc-400 hover:text-white"
                            >
                                <X size={16} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            <div>
                                <label className="block text-sm text-zinc-400 mb-2">导入模式:</label>
                                <select
                                    value={importMode}
                                    onChange={(e) => setImportMode(e.target.value as ImportOptions['mode'])}
                                    className="w-full px-3 py-2 text-sm bg-zinc-700 border border-zinc-600 rounded text-white"
                                >
                                    <option value="merge-add">新增库（不覆盖已有）</option>
                                    <option value="merge-update">合并库（同名库合并值）</option>
                                    <option value="replace">完全覆盖（替换所有）</option>
                                </select>
                            </div>

                            <div>
                                <label className="block text-sm text-zinc-400 mb-2">导入方式:</label>
                                <div className="flex gap-2 mb-2">
                                    <label className="flex-1">
                                        <input
                                            type="file"
                                            accept=".json"
                                            className="hidden"
                                            onChange={(e) => {
                                                const file = e.target.files?.[0];
                                                if (file) {
                                                    const reader = new FileReader();
                                                    reader.onload = (event) => {
                                                        setImportText(event.target?.result as string || '');
                                                    };
                                                    reader.readAsText(file);
                                                }
                                                e.target.value = ''; // 重置以允许重复选择同一文件
                                            }}
                                        />
                                        <div className="flex items-center justify-center gap-2 px-4 py-2 text-sm bg-zinc-600 hover:bg-zinc-500 text-white rounded cursor-pointer transition-colors">
                                            <Upload size={14} />
                                            选择JSON文件
                                        </div>
                                    </label>
                                </div>
                                <textarea
                                    value={importText}
                                    onChange={(e) => setImportText(e.target.value)}
                                    placeholder="或粘贴导出的JSON数据..."
                                    className="w-full h-32 px-3 py-2 text-sm bg-zinc-700 border border-zinc-600 rounded text-white placeholder-zinc-500 resize-none"
                                />
                            </div>

                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setShowImportModal(false)}
                                    className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleImport}
                                    disabled={!importText.trim()}
                                    className="px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded disabled:opacity-40"
                                >
                                    导入
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* AI生成弹窗 */}
            {showAIModal && (
                <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50">
                    <div className="bg-zinc-800 rounded-lg p-4 w-full max-w-md mx-4 shadow-xl border border-zinc-700">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Sparkles size={16} className="text-purple-400" />
                                <h3 className="text-white font-medium">AI智能生成库值</h3>
                            </div>
                            <button
                                onClick={() => setShowAIModal(false)}
                                className="text-zinc-400 hover:text-white"
                            >
                                <X size={18} />
                            </button>
                        </div>
                        <div className="space-y-4">
                            <div>
                                <label className="block text-xs text-zinc-500 mb-1">
                                    描述你想要的内容（AI会根据描述生成）
                                </label>
                                <textarea
                                    value={aiPrompt}
                                    onChange={(e) => setAiPrompt(e.target.value)}
                                    placeholder="例如：&#10;• 适合产品摄影的场景&#10;• 流行的艺术风格&#10;• 常见的配色方案&#10;• 节日主题创意"
                                    className="w-full px-3 py-2 text-sm bg-zinc-700 border border-zinc-600 rounded text-white placeholder-zinc-500 focus:ring-1 focus:ring-purple-500 min-h-[100px] resize-y"
                                    disabled={aiGenerating}
                                />
                            </div>
                            <div className="flex items-center gap-4">
                                <label className="text-xs text-zinc-500">生成数量:</label>
                                <input
                                    type="number"
                                    min={1}
                                    max={50}
                                    value={aiCount}
                                    onChange={(e) => setAiCount(parseInt(e.target.value) || 10)}
                                    className="w-20 px-2 py-1 text-sm bg-zinc-700 border border-zinc-600 rounded text-white"
                                    disabled={aiGenerating}
                                />
                            </div>
                            <div className="text-xs text-zinc-600 bg-zinc-900/50 rounded p-2 space-y-1">
                                <p className="text-zinc-500 font-medium">💡 示例指令：</p>
                                <p>• "10个适合电商产品的拍摄场景"</p>
                                <p>• "流行的插画艺术风格"</p>
                                <p>• "创意配色名称，如莫兰迪色系"</p>
                            </div>
                            <div className="flex justify-end gap-2">
                                <button
                                    onClick={() => setShowAIModal(false)}
                                    className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
                                    disabled={aiGenerating}
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleAIGenerate}
                                    disabled={!aiPrompt.trim() || aiGenerating}
                                    className="flex items-center gap-2 px-4 py-2 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded disabled:opacity-40"
                                >
                                    {aiGenerating ? (
                                        <>
                                            <Loader2 size={14} className="animate-spin" />
                                            生成中...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles size={14} />
                                            开始生成
                                        </>
                                    )}
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 确认弹窗 */}
            {confirmModal.show && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-5 max-w-sm w-full mx-4">
                        <p className="text-white text-sm mb-5">{confirmModal.message}</p>
                        <div className="flex justify-end gap-2">
                            <button
                                onClick={() => setConfirmModal({ show: false, message: '', onConfirm: () => { } })}
                                className="px-4 py-2 text-sm text-zinc-400 hover:text-white bg-zinc-800 hover:bg-zinc-700 rounded-lg transition-colors"
                            >
                                取消
                            </button>
                            <button
                                onClick={confirmModal.onConfirm}
                                className="px-4 py-2 text-sm text-white bg-orange-600 hover:bg-orange-500 rounded-lg transition-colors"
                            >
                                确定
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Google Sheets导入弹窗 */}
            {showSheetsImportModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-5 max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <Library size={18} className="text-green-400" />
                                <h3 className="text-white font-medium">
                                    从 Google Sheets 导入
                                    {sheetsImportStep === 'select' && <span className="text-zinc-400 text-sm ml-2">- 选择总库</span>}
                                </h3>
                            </div>
                            <button
                                onClick={resetSheetsImportModal}
                                className="text-zinc-400 hover:text-white"
                                disabled={sheetsImporting}
                            >
                                <X size={18} />
                            </button>
                        </div>

                        {/* 步骤1：输入URL */}
                        {sheetsImportStep === 'input' && (
                            <div className="space-y-4">
                                <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700/50 text-xs text-zinc-400 space-y-2">
                                    <p className="font-medium text-zinc-300">📋 支持多种格式：</p>
                                    <div className="pl-2 space-y-1">
                                        <p className="text-zinc-300">格式一：多分页模式</p>
                                        <p>• 每个分页名称 = 库名称，A列 = 值</p>
                                    </div>
                                    <div className="pl-2 space-y-1">
                                        <p className="text-zinc-300">格式二：单总库模式</p>
                                        <p>• 创建"随机总库"分页，表头=库名，列=值</p>
                                    </div>
                                    <div className="pl-2 space-y-1">
                                        <p className="text-zinc-300">格式三：分类联动模式 ✨</p>
                                        <p>• 支持按分类避免不合理组合</p>
                                    </div>
                                    <p className="text-orange-400/80">⚠️ 表格需开启"链接可查看"共享权限</p>
                                    <button
                                        onClick={() => setShowFormatGuide(true)}
                                        className="mt-2 text-blue-400 hover:text-blue-300 underline"
                                    >
                                        📖 查看详细格式指南
                                    </button>
                                </div>

                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">
                                        Google Sheets 链接
                                    </label>
                                    <input
                                        type="text"
                                        value={sheetsUrl}
                                        onChange={(e) => setSheetsUrl(e.target.value)}
                                        placeholder="https://docs.google.com/spreadsheets/d/..."
                                        className="w-full px-3 py-2 text-sm bg-zinc-700 border border-zinc-600 rounded text-white placeholder-zinc-500 focus:ring-1 focus:ring-green-500"
                                        disabled={sheetsImporting}
                                    />
                                </div>

                                <div>
                                    <label className="block text-xs text-zinc-500 mb-1">导入模式</label>
                                    <select
                                        value={sheetsImportMode}
                                        onChange={(e) => setSheetsImportMode(e.target.value as 'merge-add' | 'merge-update' | 'replace')}
                                        className="w-full px-3 py-2 text-sm bg-zinc-700 border border-zinc-600 rounded text-white"
                                        disabled={sheetsImporting}
                                    >
                                        <option value="merge-add">添加新库（不覆盖已有）</option>
                                        <option value="merge-update">合并更新（同名库合并值）</option>
                                        <option value="replace">完全替换（删除现有库）</option>
                                    </select>
                                </div>

                                <div className="flex justify-end gap-2 pt-2">
                                    <button
                                        onClick={resetSheetsImportModal}
                                        className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
                                        disabled={sheetsImporting}
                                    >
                                        取消
                                    </button>
                                    <button
                                        onClick={handleSheetsScan}
                                        disabled={!sheetsUrl.trim() || sheetsImporting}
                                        className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 hover:bg-green-500 text-white rounded disabled:opacity-40"
                                    >
                                        {sheetsImporting ? (
                                            <>
                                                <Loader2 size={14} className="animate-spin" />
                                                扫描中...
                                            </>
                                        ) : (
                                            <>
                                                <Search size={14} />
                                                扫描表格
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}

                        {/* 步骤2：选择总库 */}
                        {sheetsImportStep === 'select' && (
                            <div className="space-y-4">
                                <div className="p-3 bg-green-900/30 rounded-lg border border-green-700/50 text-xs text-green-300">
                                    <p>✅ 找到 {foundMasterSheets.length} 个随机总库分页，请选择要导入的：</p>
                                </div>

                                {/* 总库列表 */}
                                <div className="space-y-2 max-h-60 overflow-y-auto">
                                    {foundMasterSheets.map((master) => (
                                        <label
                                            key={master.sheetName}
                                            className={`flex items-start gap-3 p-3 rounded-lg border cursor-pointer transition-colors ${selectedMasterSheets.has(master.sheetName)
                                                ? 'bg-green-900/30 border-green-600'
                                                : 'bg-zinc-800/50 border-zinc-700 hover:border-zinc-600'
                                                }`}
                                        >
                                            <input
                                                type="checkbox"
                                                checked={selectedMasterSheets.has(master.sheetName)}
                                                onChange={(e) => {
                                                    const newSet = new Set(selectedMasterSheets);
                                                    if (e.target.checked) {
                                                        newSet.add(master.sheetName);
                                                    } else {
                                                        newSet.delete(master.sheetName);
                                                    }
                                                    setSelectedMasterSheets(newSet);
                                                }}
                                                className="mt-0.5"
                                            />
                                            <div className="flex-1 min-w-0">
                                                <div className="flex items-center gap-2">
                                                    <span className="text-white font-medium">{master.sheetName}</span>
                                                    {master.groupName !== '默认' && (
                                                        <span className="text-xs text-purple-400 bg-purple-900/30 px-1.5 py-0.5 rounded">
                                                            分组: {master.groupName}
                                                        </span>
                                                    )}
                                                </div>
                                                <div className="text-xs text-zinc-400 mt-1">
                                                    包含 {master.libraries.length} 个库：
                                                    {master.libraries.slice(0, 5).map(lib => lib.name).join('、')}
                                                    {master.libraries.length > 5 && ` 等`}
                                                </div>
                                                {/* 显示创新指令预览 */}
                                                {master.linkedInstruction && (
                                                    <div className="text-xs text-blue-400 mt-1.5 p-1.5 bg-blue-900/20 rounded border border-blue-700/30">
                                                        <span className="text-blue-300 font-medium">📝 创新指令：</span>
                                                        {master.linkedInstruction.length > 80
                                                            ? master.linkedInstruction.substring(0, 80) + '...'
                                                            : master.linkedInstruction}
                                                    </div>
                                                )}
                                            </div>
                                        </label>
                                    ))}
                                </div>

                                {/* 手动添加分页名 */}
                                <div className="p-3 bg-zinc-800/50 rounded-lg border border-zinc-700">
                                    <div className="text-xs text-zinc-400 mb-2">
                                        📝 没找到你的分页？手动输入分页名：
                                    </div>
                                    <div className="flex gap-2">
                                        <input
                                            type="text"
                                            value={customSheetName}
                                            onChange={(e) => setCustomSheetName(e.target.value)}
                                            placeholder="如：口播-随机总库"
                                            className="flex-1 px-3 py-1.5 text-sm bg-zinc-700 border border-zinc-600 rounded text-white placeholder-zinc-500"
                                        />
                                        <button
                                            onClick={async () => {
                                                if (!customSheetName.trim()) return;
                                                const spreadsheetId = extractSpreadsheetId(sheetsUrl);
                                                if (!spreadsheetId) return;

                                                setSheetsImporting(true);
                                                try {
                                                    const customSheets = await scanMasterSheets(spreadsheetId, [customSheetName.trim()]);
                                                    if (customSheets.length > 0) {
                                                        // 合并到已找到的列表
                                                        const existingNames = new Set(foundMasterSheets.map(s => s.sheetName));
                                                        const newSheets = customSheets.filter(s => !existingNames.has(s.sheetName));
                                                        if (newSheets.length > 0) {
                                                            setFoundMasterSheets([...foundMasterSheets, ...newSheets]);
                                                            const newSelected = new Set(selectedMasterSheets);
                                                            newSheets.forEach(s => newSelected.add(s.sheetName));
                                                            setSelectedMasterSheets(newSelected);
                                                        }
                                                        setCustomSheetName('');
                                                    } else {
                                                        toast.warning(`未找到分页 "${customSheetName}"，请检查分页名是否正确`);
                                                    }
                                                } catch (e) {
                                                    toast.error('读取失败，请检查分页名');
                                                } finally {
                                                    setSheetsImporting(false);
                                                }
                                            }}
                                            disabled={sheetsImporting || !customSheetName.trim()}
                                            className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-500 text-white rounded disabled:opacity-50"
                                        >
                                            添加
                                        </button>
                                    </div>
                                </div>

                                <div className="flex justify-between gap-2 pt-2">
                                    <button
                                        onClick={() => {
                                            setSheetsImportStep('input');
                                            setFoundMasterSheets([]);
                                        }}
                                        className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
                                        disabled={sheetsImporting}
                                    >
                                        ← 返回
                                    </button>
                                    <div className="flex gap-2">
                                        <button
                                            onClick={resetSheetsImportModal}
                                            className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
                                            disabled={sheetsImporting}
                                        >
                                            取消
                                        </button>
                                        <button
                                            onClick={handleSheetsImportSelected}
                                            disabled={sheetsImporting || selectedMasterSheets.size === 0}
                                            className="flex items-center gap-2 px-4 py-2 text-sm bg-green-600 hover:bg-green-500 text-white rounded disabled:opacity-40"
                                        >
                                            {sheetsImporting ? (
                                                <>
                                                    <Loader2 size={14} className="animate-spin" />
                                                    导入中...
                                                </>
                                            ) : (
                                                <>
                                                    <Download size={14} />
                                                    导入选中 ({selectedMasterSheets.size} 个总库)
                                                </>
                                            )}
                                        </button>
                                    </div>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            )}

            {/* 手动粘贴库+指令弹窗 */}
            {showManualPasteModal && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-[100] flex items-center justify-center">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl p-5 max-w-3xl w-full mx-4 max-h-[85vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center gap-2">
                                <ClipboardPaste size={18} className="text-cyan-400" />
                                <h3 className="text-white font-medium">手动粘贴库 + 基础指令</h3>
                            </div>
                            <button
                                onClick={() => setShowManualPasteModal(false)}
                                className="text-zinc-400 hover:text-white"
                            >
                                <X size={18} />
                            </button>
                        </div>

                        <div className="space-y-4">
                            {/* 来源标签 */}
                            <div>
                                <label className="block text-xs text-zinc-500 mb-1">来源标签（用于标识和切换）</label>
                                <input
                                    type="text"
                                    value={manualPasteSourceLabel}
                                    onChange={(e) => setManualPasteSourceLabel(e.target.value)}
                                    placeholder="手动粘贴"
                                    className="w-full px-3 py-2 text-sm bg-zinc-700 border border-zinc-600 rounded text-white placeholder-zinc-500 focus:ring-1 focus:ring-cyan-500"
                                />
                            </div>

                            {/* 库表格数据 - 表格样式 */}
                            <div>
                                <div className="flex items-center justify-between mb-1">
                                    <label className="text-xs text-zinc-400">
                                        库表格数据
                                    </label>
                                    {manualPasteTableInput.trim() && (
                                        <button
                                            onClick={() => setManualPasteTableInput('')}
                                            className="flex items-center gap-1 text-xs text-red-400 hover:text-red-300"
                                        >
                                            <Trash2 size={10} />
                                            清除重贴
                                        </button>
                                    )}
                                </div>

                                {!manualPasteTableInput.trim() ? (
                                    /* 空状态：粘贴区域 */
                                    <div
                                        className="relative w-full h-36 bg-zinc-800/50 border-2 border-dashed border-cyan-700/40 hover:border-cyan-500/60 rounded-lg flex flex-col items-center justify-center cursor-pointer transition-colors group"
                                        onClick={(e) => {
                                            const textarea = (e.currentTarget as HTMLElement).querySelector('textarea');
                                            textarea?.focus();
                                        }}
                                    >
                                        <textarea
                                            className="absolute inset-0 opacity-0 w-full h-full cursor-pointer resize-none"
                                            onPaste={(e) => {
                                                e.preventDefault();
                                                const text = e.clipboardData.getData('text/plain');
                                                if (text.trim()) {
                                                    setManualPasteTableInput(text);
                                                }
                                            }}
                                            onChange={(e) => {
                                                if (e.target.value.trim()) {
                                                    setManualPasteTableInput(e.target.value);
                                                }
                                            }}
                                        />
                                        <ClipboardPaste size={24} className="text-cyan-600 group-hover:text-cyan-400 mb-2 transition-colors" />
                                        <p className="text-sm text-zinc-500 group-hover:text-zinc-300 transition-colors">
                                            点击此处，然后 <kbd className="px-1.5 py-0.5 bg-zinc-700 rounded text-zinc-300 text-xs">Ctrl+V</kbd> 粘贴表格
                                        </p>
                                        <p className="text-xs text-zinc-600 mt-1">从 Excel / Google Sheets 复制表格数据</p>
                                    </div>
                                ) : (
                                    /* 已粘贴：表格预览 */
                                    (() => {
                                        const lines = manualPasteTableInput.trim().split(/\r?\n/).filter(l => l.trim());
                                        const headers = (lines[0] || '').split('\t').map(h => h.trim());
                                        const dataRows = lines.slice(1).map(line => {
                                            const cells = line.split('\t').map(c => c.trim());
                                            // 补齐列数
                                            while (cells.length < headers.length) cells.push('');
                                            return cells.slice(0, headers.length);
                                        });
                                        const headerColors = [
                                            'bg-pink-500/20 text-pink-300 border-pink-500/30',
                                            'bg-orange-500/20 text-orange-300 border-orange-500/30',
                                            'bg-yellow-500/20 text-yellow-300 border-yellow-500/30',
                                            'bg-green-500/20 text-green-300 border-green-500/30',
                                            'bg-cyan-500/20 text-cyan-300 border-cyan-500/30',
                                            'bg-indigo-500/20 text-indigo-300 border-indigo-500/30',
                                            'bg-purple-500/20 text-purple-300 border-purple-500/30',
                                            'bg-red-500/20 text-red-300 border-red-500/30',
                                        ];

                                        return (
                                            <div>
                                                <div className="border border-zinc-700 rounded-lg overflow-hidden">
                                                    <div className="max-h-56 overflow-y-auto">
                                                        <table className="w-full text-xs">
                                                            <thead className="sticky top-0 z-10">
                                                                <tr>
                                                                    <th className="px-2 py-1.5 bg-zinc-800 border-b border-r border-zinc-700 text-zinc-500 font-normal text-center w-8">#</th>
                                                                    {headers.map((h, i) => (
                                                                        <th
                                                                            key={i}
                                                                            className={`px-3 py-1.5 border-b border-r border-zinc-700 font-medium text-left ${headerColors[i % headerColors.length]}`}
                                                                        >
                                                                            {h || `列${i + 1}`}
                                                                        </th>
                                                                    ))}
                                                                </tr>
                                                            </thead>
                                                            <tbody>
                                                                {dataRows.map((row, ri) => (
                                                                    <tr key={ri} className="hover:bg-zinc-800/50">
                                                                        <td className="px-2 py-1 bg-zinc-800/30 border-b border-r border-zinc-800 text-zinc-600 text-center">{ri + 1}</td>
                                                                        {row.map((cell, ci) => (
                                                                            <td key={ci} className="px-3 py-1 border-b border-r border-zinc-800 text-zinc-300 truncate max-w-[200px]" title={cell}>
                                                                                {cell || <span className="text-zinc-600">—</span>}
                                                                            </td>
                                                                        ))}
                                                                    </tr>
                                                                ))}
                                                            </tbody>
                                                        </table>
                                                    </div>
                                                </div>
                                                <div className="mt-1.5 text-xs text-cyan-400">
                                                    ✓ 识别到 {headers.filter(h => h).length} 个库：{headers.filter(h => h).join('、')}
                                                    <span className="text-zinc-500 ml-1">（{dataRows.length} 行数据）</span>
                                                </div>
                                            </div>
                                        );
                                    })()
                                )}
                            </div>

                            {/* 基础指令 */}
                            <div>
                                <label className="block text-xs text-zinc-400 mb-1">
                                    基础指令（可选，用于创新时的 AI 指令）
                                </label>
                                <textarea
                                    value={manualPasteBaseInstruction}
                                    onChange={(e) => setManualPasteBaseInstruction(e.target.value)}
                                    placeholder={"粘贴创新指令（可选）\n例如：请根据图片内容，结合以下随机元素进行创意描述..."}
                                    className="w-full h-28 bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-cyan-500 resize-none"
                                />
                                {manualPasteBaseInstruction.trim() && (
                                    <div className="mt-1.5 text-xs text-cyan-400">
                                        ✓ 已填写基础指令（{manualPasteBaseInstruction.trim().length} 字）
                                    </div>
                                )}
                            </div>

                            {/* 导入模式 */}
                            <div>
                                <label className="block text-xs text-zinc-500 mb-1">导入模式</label>
                                <select
                                    value={manualPasteImportMode}
                                    onChange={(e) => setManualPasteImportMode(e.target.value as 'merge-add' | 'replace')}
                                    className="w-full px-3 py-2 text-sm bg-zinc-700 border border-zinc-600 rounded text-white"
                                >
                                    <option value="replace">完全替换（删除现有库）</option>
                                    <option value="merge-add">添加新库（保留现有，同名跳过）</option>
                                </select>
                            </div>

                            {/* 底部按钮 */}
                            <div className="flex justify-end gap-2 pt-2">
                                <button
                                    onClick={() => setShowManualPasteModal(false)}
                                    className="px-4 py-2 text-sm text-zinc-400 hover:text-white"
                                >
                                    取消
                                </button>
                                <button
                                    onClick={handleManualPasteImport}
                                    disabled={!manualPasteTableInput.trim() && !manualPasteBaseInstruction.trim()}
                                    className="flex items-center gap-2 px-4 py-2 text-sm bg-cyan-600 hover:bg-cyan-500 text-white rounded disabled:opacity-40"
                                >
                                    <Download size={14} />
                                    导入
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* 格式说明弹窗 */}
            {showFormatGuide && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] overflow-y-auto">
                        <div className="sticky top-0 bg-zinc-900 border-b border-zinc-700 p-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white">📋 随机库表格设置指南</h2>
                            <button onClick={() => setShowFormatGuide(false)} className="text-zinc-400 hover:text-white">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="p-5 space-y-6">
                            {/* 基础格式 */}
                            <section>
                                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                                    <span className="bg-blue-600 text-xs px-2 py-0.5 rounded">基础</span>
                                    格式1：多分页模式（带分类）
                                </h3>
                                <p className="text-zinc-400 text-sm mb-3">分页名格式：<code className="text-blue-400 bg-zinc-800 px-1 rounded">分类-库名</code>，A列 = 值</p>
                                <div className="grid grid-cols-2 gap-4">
                                    <div>
                                        <div className="text-xs text-zinc-500 mb-1">分页名：<span className="text-blue-400">室内-场景</span></div>
                                        <table className="w-full text-sm border border-zinc-700 rounded overflow-hidden">
                                            <thead><tr className="bg-zinc-800"><th className="p-2 text-left text-zinc-300 border-b border-zinc-700">A列</th></tr></thead>
                                            <tbody className="bg-zinc-800/50">
                                                <tr><td className="p-2 text-white border-b border-zinc-700/50">房间</td></tr>
                                                <tr><td className="p-2 text-white border-b border-zinc-700/50">客厅</td></tr>
                                                <tr><td className="p-2 text-white">卧室</td></tr>
                                            </tbody>
                                        </table>
                                    </div>
                                    <div>
                                        <div className="text-xs text-zinc-500 mb-1">分页名：<span className="text-blue-400">室内-交通工具</span></div>
                                        <table className="w-full text-sm border border-zinc-700 rounded overflow-hidden">
                                            <thead><tr className="bg-zinc-800"><th className="p-2 text-left text-zinc-300 border-b border-zinc-700">A列</th></tr></thead>
                                            <tbody className="bg-zinc-800/50">
                                                <tr><td className="p-2 text-white border-b border-zinc-700/50">自行车</td></tr>
                                                <tr><td className="p-2 text-white border-b border-zinc-700/50">滑板</td></tr>
                                                <tr><td className="p-2 text-white">轮椅</td></tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                                <div className="grid grid-cols-2 gap-4 mt-2">
                                    <div>
                                        <div className="text-xs text-zinc-500 mb-1">分页名：<span className="text-green-400">水边-场景</span></div>
                                        <table className="w-full text-sm border border-zinc-700 rounded overflow-hidden">
                                            <thead><tr className="bg-zinc-800"><th className="p-2 text-left text-zinc-300 border-b border-zinc-700">A列</th></tr></thead>
                                            <tbody className="bg-zinc-800/50">
                                                <tr><td className="p-2 text-white border-b border-zinc-700/50">海边</td></tr>
                                                <tr><td className="p-2 text-white">湖边</td></tr>
                                            </tbody>
                                        </table>
                                    </div>
                                    <div>
                                        <div className="text-xs text-zinc-500 mb-1">分页名：<span className="text-green-400">水边-交通工具</span></div>
                                        <table className="w-full text-sm border border-zinc-700 rounded overflow-hidden">
                                            <thead><tr className="bg-zinc-800"><th className="p-2 text-left text-zinc-300 border-b border-zinc-700">A列</th></tr></thead>
                                            <tbody className="bg-zinc-800/50">
                                                <tr><td className="p-2 text-white border-b border-zinc-700/50">轮船</td></tr>
                                                <tr><td className="p-2 text-white">皮划艇</td></tr>
                                            </tbody>
                                        </table>
                                    </div>
                                </div>
                                <div className="mt-3 p-3 bg-blue-900/20 border border-blue-700/30 rounded-lg text-xs">
                                    <p className="text-blue-300">💡 同分类的值会一起组合：室内场景只配室内交通工具</p>
                                </div>
                            </section>

                            <div className="border-t border-zinc-700/50"></div>

                            {/* 单总库格式 */}
                            <section>
                                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                                    <span className="bg-green-600 text-xs px-2 py-0.5 rounded">基础</span>
                                    格式2：单总库模式（带分类）
                                </h3>
                                <p className="text-zinc-400 text-sm mb-3">表头格式：<code className="text-green-400 bg-zinc-800 px-1 rounded">分类-库名</code></p>
                                <div className="text-xs text-zinc-500 mb-1">分页名：随机总库</div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm border border-zinc-700 rounded overflow-hidden">
                                        <thead><tr className="bg-zinc-800">
                                            <th className="p-2 text-left text-blue-300 border-b border-zinc-700 border-r border-zinc-700/50">室内-场景</th>
                                            <th className="p-2 text-left text-blue-300 border-b border-zinc-700 border-r border-zinc-700/50">室内-交通工具</th>
                                            <th className="p-2 text-left text-green-300 border-b border-zinc-700 border-r border-zinc-700/50">水边-场景</th>
                                            <th className="p-2 text-left text-green-300 border-b border-zinc-700">水边-交通工具</th>
                                        </tr></thead>
                                        <tbody className="bg-zinc-800/50">
                                            <tr>
                                                <td className="p-2 text-white border-b border-zinc-700/50 border-r border-zinc-700/30">房间</td>
                                                <td className="p-2 text-white border-b border-zinc-700/50 border-r border-zinc-700/30">自行车</td>
                                                <td className="p-2 text-white border-b border-zinc-700/50 border-r border-zinc-700/30">海边</td>
                                                <td className="p-2 text-white border-b border-zinc-700/50">轮船</td>
                                            </tr>
                                            <tr>
                                                <td className="p-2 text-white border-r border-zinc-700/30">客厅</td>
                                                <td className="p-2 text-white border-r border-zinc-700/30">滑板</td>
                                                <td className="p-2 text-white border-r border-zinc-700/30">湖边</td>
                                                <td className="p-2 text-white">皮划艇</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div className="mt-3 p-3 bg-green-900/20 border border-green-700/30 rounded-lg text-xs">
                                    <p className="text-green-300">💡 相同颜色的分类会一起组合：蓝色配蓝色，绿色配绿色</p>
                                </div>
                            </section>

                            <div className="border-t border-zinc-700/50"></div>

                            {/* 分类联动格式 */}
                            <section>
                                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                                    <span className="bg-purple-600 text-xs px-2 py-0.5 rounded">进阶</span>
                                    格式3：分类联动（值+分类列）
                                </h3>
                                <p className="text-zinc-400 text-sm mb-3">避免不合理组合，如"房间+轮船"。库名后紧跟"库名分类"列</p>
                                <div className="text-xs text-zinc-500 mb-1">分页名：随机总库</div>
                                <div className="overflow-x-auto">
                                    <table className="w-full text-sm border border-zinc-700 rounded overflow-hidden">
                                        <thead><tr className="bg-zinc-800">
                                            <th className="p-2 text-left text-zinc-300 border-b border-zinc-700 border-r border-zinc-700/50">场景</th>
                                            <th className="p-2 text-left text-purple-300 border-b border-zinc-700 border-r border-zinc-700/50">场景分类</th>
                                            <th className="p-2 text-left text-zinc-300 border-b border-zinc-700 border-r border-zinc-700/50">交通工具</th>
                                            <th className="p-2 text-left text-purple-300 border-b border-zinc-700">交通工具分类</th>
                                        </tr></thead>
                                        <tbody className="bg-zinc-800/50">
                                            <tr>
                                                <td className="p-2 text-white border-b border-zinc-700/50 border-r border-zinc-700/30">房间</td>
                                                <td className="p-2 text-purple-400 border-b border-zinc-700/50 border-r border-zinc-700/30">室内</td>
                                                <td className="p-2 text-white border-b border-zinc-700/50 border-r border-zinc-700/30">自行车</td>
                                                <td className="p-2 text-purple-400 border-b border-zinc-700/50">室内,室外</td>
                                            </tr>
                                            <tr>
                                                <td className="p-2 text-white border-b border-zinc-700/50 border-r border-zinc-700/30">客厅</td>
                                                <td className="p-2 text-purple-400 border-b border-zinc-700/50 border-r border-zinc-700/30">室内</td>
                                                <td className="p-2 text-white border-b border-zinc-700/50 border-r border-zinc-700/30">汽车</td>
                                                <td className="p-2 text-purple-400 border-b border-zinc-700/50">室外</td>
                                            </tr>
                                            <tr>
                                                <td className="p-2 text-white border-b border-zinc-700/50 border-r border-zinc-700/30">海边</td>
                                                <td className="p-2 text-purple-400 border-b border-zinc-700/50 border-r border-zinc-700/30">水边</td>
                                                <td className="p-2 text-white border-b border-zinc-700/50 border-r border-zinc-700/30">轮船</td>
                                                <td className="p-2 text-purple-400 border-b border-zinc-700/50">水边</td>
                                            </tr>
                                            <tr>
                                                <td className="p-2 text-white border-r border-zinc-700/30">马路</td>
                                                <td className="p-2 text-purple-400 border-r border-zinc-700/30">室外</td>
                                                <td className="p-2 text-white border-r border-zinc-700/30">滑板</td>
                                                <td className="p-2 text-purple-400">通用</td>
                                            </tr>
                                        </tbody>
                                    </table>
                                </div>
                                <div className="mt-3 p-3 bg-purple-900/20 border border-purple-700/30 rounded-lg text-xs space-y-1">
                                    <p className="text-purple-300 font-medium">📌 分类规则：</p>
                                    <p className="text-zinc-400">• 多个分类用逗号分隔：<code className="text-purple-400 bg-zinc-800 px-1 rounded">室内,室外</code></p>
                                    <p className="text-zinc-400">• 填"通用"或留空 = 可以和任何分类组合</p>
                                    <p className="text-zinc-400">• 生成时只在同分类内组合</p>
                                </div>
                            </section>

                            <div className="border-t border-zinc-700/50"></div>

                            {/* 生成逻辑说明 */}
                            <section>
                                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                                    <span className="bg-orange-600 text-xs px-2 py-0.5 rounded">工作原理</span>
                                    生成逻辑
                                </h3>
                                <div className="p-4 bg-zinc-800/50 rounded-lg border border-zinc-700/50 text-sm space-y-2">
                                    <div className="flex items-start gap-2">
                                        <span className="bg-orange-600 text-white text-xs px-1.5 py-0.5 rounded">1</span>
                                        <p className="text-zinc-300">系统先随机选择一个<span className="text-orange-400">分类</span>（如"室内"）</p>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <span className="bg-orange-600 text-white text-xs px-1.5 py-0.5 rounded">2</span>
                                        <p className="text-zinc-300">然后从所有库中，只抽取属于该分类的值</p>
                                    </div>
                                    <div className="flex items-start gap-2">
                                        <span className="bg-orange-600 text-white text-xs px-1.5 py-0.5 rounded">3</span>
                                        <p className="text-zinc-300">"通用"分类的值可以和任何分类组合</p>
                                    </div>
                                </div>
                                <div className="mt-3 p-3 bg-green-900/20 border border-green-700/30 rounded-lg text-xs">
                                    <p className="text-green-300">✅ 这样就不会出现"房间+轮船"这种不合理组合了！</p>
                                </div>
                            </section>

                            <div className="border-t border-zinc-700/50"></div>

                            {/* 分页目录功能 */}
                            <section>
                                <h3 className="text-white font-semibold mb-3 flex items-center gap-2">
                                    <span className="bg-cyan-600 text-xs px-2 py-0.5 rounded">推荐</span>
                                    分页目录（自动发现分页）
                                </h3>
                                <p className="text-zinc-400 text-sm mb-3">
                                    创建一个名为 <code className="text-cyan-400 bg-zinc-800 px-1 rounded">分页目录</code> 的分页，在 A 列列出所有分页名，系统会自动读取并识别
                                </p>
                                <div className="text-xs text-zinc-500 mb-1">分页名：分页目录</div>
                                <table className="w-full text-sm border border-zinc-700 rounded overflow-hidden">
                                    <thead><tr className="bg-zinc-800">
                                        <th className="p-2 text-left text-zinc-300 border-b border-zinc-700">A列（分页名）</th>
                                        <th className="p-2 text-left text-zinc-500 border-b border-zinc-700">识别为</th>
                                    </tr></thead>
                                    <tbody className="bg-zinc-800/50">
                                        <tr>
                                            <td className="p-2 text-cyan-400 border-b border-zinc-700/50 border-r border-zinc-700/30">口播-随机总库</td>
                                            <td className="p-2 text-zinc-400 border-b border-zinc-700/50">总库（表头=库名）</td>
                                        </tr>
                                        <tr>
                                            <td className="p-2 text-cyan-400 border-b border-zinc-700/50 border-r border-zinc-700/30">手写字随机总库</td>
                                            <td className="p-2 text-zinc-400 border-b border-zinc-700/50">总库</td>
                                        </tr>
                                        <tr>
                                            <td className="p-2 text-blue-400 border-b border-zinc-700/50 border-r border-zinc-700/30">室内-场景</td>
                                            <td className="p-2 text-zinc-400 border-b border-zinc-700/50">单独分页（分类=室内）</td>
                                        </tr>
                                        <tr>
                                            <td className="p-2 text-blue-400 border-r border-zinc-700/30">场景</td>
                                            <td className="p-2 text-zinc-400">单独分页（无分类）</td>
                                        </tr>
                                    </tbody>
                                </table>
                                <div className="mt-3 p-3 bg-cyan-900/20 border border-cyan-700/30 rounded-lg text-xs space-y-1">
                                    <p className="text-cyan-300 font-medium">💡 自动判断规则：</p>
                                    <p className="text-zinc-400">• 分页名包含"随机总库"或"总库" → 按总库读取（表头=库名）</p>
                                    <p className="text-zinc-400">• 其他 → 按单独分页读取（分页名=库名，A列=值）</p>
                                    <p className="text-zinc-400">• 支持的目录名：分页目录、随机总库目录、目录、库列表</p>
                                </div>
                            </section>
                        </div >
                    </div >
                </div >
            )}

            {/* AI智能分类工具弹窗 */}
            {workMode !== 'quick' && showAiCategoryModal && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                        <div className="border-b border-zinc-700 p-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <Sparkles className="w-5 h-5 text-purple-400" />
                                AI智能分类工具
                            </h2>
                            <button onClick={() => { setShowAiCategoryModal(false); setAiCategoryResult(''); }} className="text-zinc-400 hover:text-white">
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            {/* 步骤1：粘贴数据 */}
                            <section>
                                <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                                    <span className="w-5 h-5 bg-purple-600 rounded-full text-xs flex items-center justify-center">1</span>
                                    粘贴库数据
                                    {aiCategoryInput.trim() && (
                                        <button
                                            onClick={() => setAiCategoryInput('')}
                                            className="ml-auto text-xs text-zinc-500 hover:text-red-400"
                                        >
                                            清空
                                        </button>
                                    )}
                                </h3>

                                {/* 表格显示区域 */}
                                <div
                                    className="border border-zinc-700 rounded-lg overflow-hidden cursor-text focus-within:ring-1 focus-within:ring-purple-500"
                                    tabIndex={0}
                                    onPaste={(e) => {
                                        e.preventDefault();
                                        const text = e.clipboardData.getData('text');
                                        if (text.trim()) {
                                            setAiCategoryInput(text);
                                        }
                                    }}
                                >
                                    {!aiCategoryInput.trim() ? (
                                        <div className="h-32 flex items-center justify-center text-zinc-500 text-sm">
                                            <div className="text-center">
                                                <p>点击此处后按 Ctrl+V / Cmd+V 粘贴</p>
                                                <p className="text-xs mt-1 text-zinc-600">从 Google Sheets 复制表格数据</p>
                                            </div>
                                        </div>
                                    ) : (() => {
                                        const lines = aiCategoryInput.trim().split('\n');
                                        const headers = lines[0]?.split('\t') || [];
                                        const dataRows = lines.slice(1).map(line => line.split('\t'));
                                        const totalRows = lines.length - 1;

                                        return (
                                            <div>
                                                <div className="text-xs text-zinc-500 px-3 py-1 bg-zinc-800/50 border-b border-zinc-700">
                                                    {headers.filter(h => h.trim()).length} 列 × {totalRows} 行
                                                </div>
                                                <div className="overflow-x-auto max-h-64 overflow-y-auto">
                                                    <table className="text-xs w-full">
                                                        <thead className="bg-zinc-700 sticky top-0">
                                                            <tr>
                                                                {headers.map((h, i) => (
                                                                    <th key={i} className={`px-3 py-2 text-left font-medium whitespace-nowrap ${h.trim() ? 'text-purple-300' : 'text-zinc-500'}`}>
                                                                        {h.trim() || <span className="italic">空列</span>}
                                                                    </th>
                                                                ))}
                                                            </tr>
                                                        </thead>
                                                        <tbody className="divide-y divide-zinc-800/50">
                                                            {dataRows.map((row, ri) => (
                                                                <tr key={ri} className="hover:bg-zinc-800/30">
                                                                    {headers.map((_, ci) => (
                                                                        <td key={ci} className={`px-3 py-1.5 whitespace-nowrap ${row[ci]?.trim() ? 'text-white' : 'text-zinc-600'}`}>
                                                                            {row[ci]?.trim() || '-'}
                                                                        </td>
                                                                    ))}
                                                                </tr>
                                                            ))}
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </div>
                                        );
                                    })()}
                                </div>
                            </section>

                            {/* 步骤1.5：分类维度（可选） */}
                            <section>
                                <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                                    <span className="w-5 h-5 bg-orange-600 rounded-full text-xs flex items-center justify-center">★</span>
                                    分类维度
                                    <span className="text-xs text-zinc-500">（可选，指定AI按什么维度分类）</span>
                                </h3>
                                <input
                                    type="text"
                                    value={aiCategoryDimension}
                                    onChange={(e) => setAiCategoryDimension(e.target.value)}
                                    placeholder="如：室内/室外/水边 或 白天/夜晚 或 春/夏/秋/冬 或 现代/复古..."
                                    className="w-full p-3 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-white focus:outline-none focus:ring-1 focus:ring-orange-500"
                                />
                                <div className="mt-2 flex gap-2 flex-wrap">
                                    {['室内/室外/水边', '白天/夜晚', '春/夏/秋/冬', '现代/复古/自然', '正式/休闲'].map(preset => (
                                        <button
                                            key={preset}
                                            onClick={() => setAiCategoryDimension(preset)}
                                            className="px-2 py-1 text-xs bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-400 hover:text-white"
                                        >
                                            {preset}
                                        </button>
                                    ))}
                                </div>
                            </section>

                            {/* 分类风格 */}
                            <section>
                                <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                                    <span className="w-5 h-5 bg-cyan-600 rounded-full text-xs flex items-center justify-center">◎</span>
                                    分类风格
                                    <span className="text-xs text-zinc-500">（分类的严格程度）</span>
                                </h3>
                                <div className="grid grid-cols-3 gap-3 mb-3">
                                    <button
                                        onClick={() => setAiCategoryStyle('strict')}
                                        className={`p-3 rounded-lg border text-left transition-all ${aiCategoryStyle === 'strict'
                                            ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                                            : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
                                    >
                                        <div className="font-medium text-sm mb-1">🔒 严格真实</div>
                                        <div className="text-xs opacity-70">符合真实画面规律</div>
                                    </button>
                                    <button
                                        onClick={() => setAiCategoryStyle('creative')}
                                        className={`p-3 rounded-lg border text-left transition-all ${aiCategoryStyle === 'creative'
                                            ? 'bg-pink-600/20 border-pink-500 text-pink-300'
                                            : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
                                    >
                                        <div className="font-medium text-sm mb-1">✨ 创意宽松</div>
                                        <div className="text-xs opacity-70">允许跨界创新组合</div>
                                    </button>
                                    <button
                                        onClick={() => setAiCategoryStyle('custom')}
                                        className={`p-3 rounded-lg border text-left transition-all ${aiCategoryStyle === 'custom'
                                            ? 'bg-amber-600/20 border-amber-500 text-amber-300'
                                            : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
                                    >
                                        <div className="font-medium text-sm mb-1">📝 自定义规则</div>
                                        <div className="text-xs opacity-70">输入你的分类逻辑</div>
                                    </button>
                                </div>
                                {aiCategoryStyle === 'custom' && (
                                    <textarea
                                        value={aiCategoryCustomRule}
                                        onChange={(e) => setAiCategoryCustomRule(e.target.value)}
                                        placeholder="输入你的分类规则说明，例如：&#10;- 按科幻风格分类&#10;- 同组合物品必须在视觉上形成对比&#10;- 优先按情绪氛围分组..."
                                        className="w-full h-24 p-3 bg-zinc-800 border border-amber-700/50 rounded-lg text-sm text-white font-mono resize-none focus:outline-none focus:ring-1 focus:ring-amber-500"
                                    />
                                )}
                                <div className="text-xs text-zinc-500 mt-2">
                                    {aiCategoryStyle === 'strict' && '💡 严格模式：房间+自行车=✓，房间+轮船=✗（不符合真实场景）'}
                                    {aiCategoryStyle === 'creative' && '💡 创意模式：房间+轮船=✓（超现实主义、梦境风格允许）'}
                                    {aiCategoryStyle === 'custom' && '💡 自定义：按照你输入的规则来分类'}
                                </div>
                            </section>

                            {/* 步骤2：选择输出格式 */}
                            <section>
                                <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                                    <span className="w-5 h-5 bg-purple-600 rounded-full text-xs flex items-center justify-center">2</span>
                                    选择输出格式
                                </h3>
                                <div className="grid grid-cols-3 gap-3">
                                    <button
                                        onClick={() => setAiCategoryOutputFormat(1)}
                                        className={`p-3 rounded-lg border text-left transition-all ${aiCategoryOutputFormat === 1
                                            ? 'bg-blue-600/20 border-blue-500 text-blue-300'
                                            : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
                                    >
                                        <div className="font-medium text-sm mb-1">格式1：多分页</div>
                                        <div className="text-xs opacity-70">分页名 = 分类-库名</div>
                                    </button>
                                    <button
                                        onClick={() => setAiCategoryOutputFormat(2)}
                                        className={`p-3 rounded-lg border text-left transition-all ${aiCategoryOutputFormat === 2
                                            ? 'bg-green-600/20 border-green-500 text-green-300'
                                            : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
                                    >
                                        <div className="font-medium text-sm mb-1">格式2：单总库</div>
                                        <div className="text-xs opacity-70">表头 = 分类-库名</div>
                                    </button>
                                    <button
                                        onClick={() => setAiCategoryOutputFormat(3)}
                                        className={`p-3 rounded-lg border text-left transition-all ${aiCategoryOutputFormat === 3
                                            ? 'bg-purple-600/20 border-purple-500 text-purple-300'
                                            : 'bg-zinc-800 border-zinc-700 text-zinc-400 hover:border-zinc-600'}`}
                                    >
                                        <div className="font-medium text-sm mb-1">格式3：值+分类列</div>
                                        <div className="text-xs opacity-70">库名 | 库名分类</div>
                                    </button>
                                </div>
                            </section>

                            {/* 步骤3：分类结果 */}
                            {aiCategoryResult && (() => {
                                // 解析结果为表格
                                const resultLines = aiCategoryResult.trim().split('\n').filter(l => l.trim() && !l.startsWith('==='));
                                const resultHeaders = resultLines[0]?.split('\t') || [];
                                const resultRows = resultLines.slice(1).map(line => line.split('\t'));

                                return (
                                    <section>
                                        <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                                            <span className="w-5 h-5 bg-green-600 rounded-full text-xs flex items-center justify-center">✓</span>
                                            分类结果
                                            <span className="text-xs text-zinc-500">（{resultHeaders.length} 列 × {resultRows.length} 行）</span>
                                            <button
                                                onClick={() => {
                                                    // 清理多余空行后复制
                                                    const cleanedResult = aiCategoryResult
                                                        .split('\n')
                                                        .filter(line => line.trim())
                                                        .join('\n');
                                                    navigator.clipboard.writeText(cleanedResult);
                                                    toast.success('已复制！可直接粘贴到 Google Sheets');
                                                }}
                                                className="ml-auto px-3 py-1 bg-green-600 hover:bg-green-500 text-white text-xs rounded-lg flex items-center gap-1"
                                            >
                                                <Copy className="w-3.5 h-3.5" />
                                                复制结果
                                            </button>
                                        </h3>
                                        <div className="border border-green-700/50 rounded-lg overflow-hidden">
                                            <div className="overflow-x-auto max-h-64 overflow-y-auto">
                                                <table className="text-xs w-full">
                                                    <thead className="bg-green-900/30 sticky top-0">
                                                        <tr>
                                                            {resultHeaders.map((h, i) => (
                                                                <th key={i} className="px-3 py-2 text-left font-medium whitespace-nowrap text-green-300">
                                                                    {h.trim() || '-'}
                                                                </th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-zinc-800/50">
                                                        {resultRows.map((row, ri) => (
                                                            <tr key={ri} className="hover:bg-zinc-800/30">
                                                                {resultHeaders.map((_, ci) => (
                                                                    <td key={ci} className={`px-3 py-1.5 whitespace-nowrap ${row[ci]?.trim() ? 'text-white' : 'text-zinc-600'}`}>
                                                                        {row[ci]?.trim() || '-'}
                                                                    </td>
                                                                ))}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </section>
                                );
                            })()}
                        </div>

                        <div className="border-t border-zinc-700 p-4 flex items-center justify-between">
                            <div className="text-xs text-zinc-500">
                                {aiCategoryOutputFormat === 1 && '💡 格式1：每个分类一个分页，分页名如"室内-场景"'}
                                {aiCategoryOutputFormat === 2 && '💡 格式2：单个总库分页，表头如"室内-场景"'}
                                {aiCategoryOutputFormat === 3 && '💡 格式3：值后跟分类列，如"场景 | 场景分类"'}
                            </div>
                            <button
                                onClick={async () => {
                                    if (!aiCategoryInput.trim()) {
                                        toast.warning('请先粘贴库数据');
                                        return;
                                    }
                                    if (!onAIGenerate) {
                                        toast.error('AI功能不可用');
                                        return;
                                    }

                                    setAiCategorizing(true);
                                    setAiCategoryResult('');

                                    // 预处理输入数据：过滤掉空列
                                    const inputLines = aiCategoryInput.trim().split('\n');
                                    if (inputLines.length < 2) {
                                        toast.warning('数据至少需要2行（表头+数据）');
                                        setAiCategorizing(false);
                                        return;
                                    }

                                    // 解析表格数据，找出非空列
                                    const headers = inputLines[0].split('\t');
                                    const dataRows = inputLines.slice(1).map(line => line.split('\t'));

                                    // 检查每列是否有数据
                                    const nonEmptyColIndices: number[] = [];
                                    headers.forEach((header, colIndex) => {
                                        const hasData = dataRows.some(row => row[colIndex] && row[colIndex].trim());
                                        if (header.trim() && hasData) {
                                            nonEmptyColIndices.push(colIndex);
                                        }
                                    });

                                    if (nonEmptyColIndices.length === 0) {
                                        toast.warning('没有找到有效的库数据');
                                        setAiCategorizing(false);
                                        return;
                                    }

                                    // 重建只包含非空列的数据
                                    const filteredHeaders = nonEmptyColIndices.map(i => headers[i]).join('\t');
                                    const filteredRows = dataRows.map(row =>
                                        nonEmptyColIndices.map(i => row[i] || '').join('\t')
                                    ).join('\n');
                                    const filteredInput = `${filteredHeaders}\n${filteredRows}`;

                                    console.log(`[AI分类] 过滤前列数: ${headers.length}, 过滤后列数: ${nonEmptyColIndices.length}`);
                                    // 构建prompt
                                    const formatDesc = aiCategoryOutputFormat === 1
                                        ? '格式1（多分页模式）：为每个分类创建独立的数据块，分页名格式为"分类-库名"'
                                        : aiCategoryOutputFormat === 2
                                            ? '格式2（单总库模式）：所有数据在一个表中，表头格式为"分类-库名"'
                                            : '格式3（值+分类列）：返回JSON格式的分类映射';

                                    const dimensionHint = aiCategoryDimension.trim()
                                        ? `\n分类维度：请按照"${aiCategoryDimension}"这些分类来划分。`
                                        : '\n分类维度：请自动分析合适的分类（如室内/室外/水边等）。';

                                    const styleHint = aiCategoryStyle === 'strict'
                                        ? `\n分类规则：【严格真实】组合必须符合客观事实和真实画面规律。例如：房间+自行车=合理，房间+轮船=不合理（轮船不会出现在房间里）。`
                                        : aiCategoryStyle === 'creative'
                                            ? `\n分类规则：【创意宽松】允许跨界创新组合，追求创意和另类效果。例如：房间+轮船=可以（超现实主义、梦境风格）。分类时考虑艺术表达和创意可能性，不需要严格符合现实逻辑。`
                                            : `\n分类规则：【自定义】${aiCategoryCustomRule || '按用户需求灵活分类'}`;

                                    // 格式3使用JSON映射方式，避免大数据量时错位
                                    const format3Prompt = `
你是一个智能分类助手。请为以下库数据中的每个值进行分类。
${dimensionHint}
${styleHint}

用户的库数据（Tab分隔）：
${filteredInput}

请返回JSON格式的分类映射，格式如下：
{
  "值1": "分类1",
  "值2": "分类1,分类2",
  "值3": "通用"
}

注意：
1. 分类数量建议2-5个，如"室内"、"室外"、"水边"等
2. 一个值可以属于多个分类（用逗号分隔）
3. 通用的值标记为"通用"
4. 只输出JSON对象，不要有其他解释文字
5. JSON必须是合法格式，可以直接被JSON.parse解析`;

                                    const format12Prompt = `你是一个智能分类助手。请根据以下库数据进行分类。
${dimensionHint}
${styleHint}

用户粘贴的库数据（Tab分隔，已过滤空列）：
${filteredInput}

请按照${formatDesc}输出分类结果。

${aiCategoryOutputFormat === 1 ? `
输出格式示例（Tab分隔，可直接粘贴到Sheets）：
===室内-场景===
房间
客厅
卧室

===水边-场景===
海边
湖边

===室内-交通工具===
自行车
滑板

===水边-交通工具===
轮船
皮划艇
` : `
输出格式（Tab分隔，可直接粘贴到Sheets，表头用"分类-库名"）：
室内-场景\t室内-交通工具\t水边-场景\t水边-交通工具
房间\t自行车\t海边\t轮船
客厅\t滑板\t湖边\t皮划艇
`}

注意：
1. 分类数量建议2-5个，如"室内"、"室外"、"水边"等
2. 一个值可以属于多个分类（用逗号分隔）
3. 通用的值可以标记为"通用"
4. 【严格】每行必须有与表头完全相同数量的Tab分隔符
5. 只输出表格数据，不要有其他解释文字`;

                                    try {
                                        if (aiCategoryOutputFormat === 3) {
                                            // 格式3：使用JSON映射 + 代码组装
                                            const response = await onAIGenerate(format3Prompt);

                                            // 解析JSON
                                            let categoryMap: Record<string, string> = {};
                                            try {
                                                // 提取JSON部分
                                                const jsonMatch = response.match(/\{[\s\S]*\}/);
                                                if (jsonMatch) {
                                                    categoryMap = JSON.parse(jsonMatch[0]);
                                                }
                                            } catch (parseErr) {
                                                console.error('JSON解析失败:', parseErr);
                                                toast.error('AI返回格式有误，请重试');
                                                setAiCategorizing(false);
                                                return;
                                            }

                                            // 用代码组装结果表格
                                            const inputLines = aiCategoryInput.trim().split('\n');
                                            const inputHeaders = inputLines[0].split('\t');
                                            const inputDataRows = inputLines.slice(1).map(line => line.split('\t'));

                                            // 构建新表头：每个库名后跟一个分类列
                                            const newHeaders: string[] = [];
                                            inputHeaders.forEach(h => {
                                                newHeaders.push(h);
                                                if (h.trim()) {
                                                    newHeaders.push(h.trim() + '分类');
                                                } else {
                                                    newHeaders.push('');
                                                }
                                            });

                                            // 构建新数据行
                                            const newRows = inputDataRows.map(row => {
                                                const newRow: string[] = [];
                                                inputHeaders.forEach((_, colIndex) => {
                                                    const value = row[colIndex] || '';
                                                    newRow.push(value);
                                                    // 添加分类
                                                    const category = value.trim() ? (categoryMap[value.trim()] || '通用') : '';
                                                    newRow.push(category);
                                                });
                                                return newRow;
                                            });

                                            // 组装结果
                                            const result = [newHeaders.join('\t'), ...newRows.map(r => r.join('\t'))].join('\n');
                                            setAiCategoryResult(result);
                                        } else {
                                            // 格式1和2：直接使用AI输出
                                            const response = await onAIGenerate(format12Prompt);
                                            setAiCategoryResult(response.trim());
                                        }
                                    } catch (e) {
                                        console.error('AI分类失败:', e);
                                        toast.error('AI分类失败，请重试');
                                    }
                                    setAiCategorizing(false);
                                }}
                                disabled={aiCategorizing || !aiCategoryInput.trim()}
                                className="px-5 py-2.5 bg-gradient-to-r from-purple-600 to-pink-600 hover:from-purple-500 hover:to-pink-500 text-white rounded-lg flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {aiCategorizing ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        AI分类中...
                                    </>
                                ) : (
                                    <>
                                        <Sparkles className="w-4 h-4" />
                                        开始AI分类
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 权重编辑弹框 */}
            {weightPopup && activeLibrary && (() => {
                // 计算百分比概率
                const totalWeight = activeLibrary.values.reduce((sum, v) =>
                    sum + (activeLibrary.valueWeights?.[v] ?? 1), 0);
                const percentage = totalWeight > 0
                    ? ((weightPopup.weight / totalWeight) * 100).toFixed(1)
                    : '0';

                return (
                    <div
                        className="fixed inset-0 z-[60]"
                        onClick={() => setWeightPopup(null)}
                    >
                        <div
                            className="absolute bg-zinc-800 border border-zinc-600 rounded-lg shadow-xl p-3 min-w-[220px]"
                            style={{
                                left: Math.min(weightPopup.position.x, window.innerWidth - 240),
                                top: Math.min(weightPopup.position.y, window.innerHeight - 180)
                            }}
                            onClick={e => e.stopPropagation()}
                        >
                            <div className="flex justify-between items-center mb-2">
                                <span className="text-xs text-zinc-400 truncate max-w-[150px]">{weightPopup.value}</span>
                                <button
                                    onClick={() => setWeightPopup(null)}
                                    className="text-zinc-500 hover:text-white p-1"
                                >
                                    <X size={12} />
                                </button>
                            </div>

                            {/* 当前权重和百分比显示 */}
                            <div className="text-center mb-3">
                                <div className="text-2xl font-bold text-amber-400">{weightPopup.weight}x</div>
                                <div className="text-sm text-emerald-400">≈ {percentage}% 概率</div>
                            </div>

                            {/* 滑杆 */}
                            <input
                                type="range"
                                min="1"
                                max="10"
                                value={weightPopup.weight}
                                onChange={(e) => {
                                    const newWeight = parseInt(e.target.value);
                                    setWeightPopup({ ...weightPopup, weight: newWeight });
                                    updateLibrary(activeLibrary.id, {
                                        valueWeights: {
                                            ...(activeLibrary.valueWeights || {}),
                                            [weightPopup.value]: newWeight
                                        }
                                    });
                                }}
                                className="w-full h-2 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-amber-500"
                            />
                            <div className="flex justify-between text-[10px] text-zinc-500 mt-1 mb-2">
                                <span>1x</span>
                                <span>5x</span>
                                <span>10x</span>
                            </div>

                            {/* 快捷按钮 */}
                            <div className="flex gap-1 flex-wrap">
                                {[1, 2, 3, 5, 10].map(w => (
                                    <button
                                        key={w}
                                        onClick={() => {
                                            setWeightPopup({ ...weightPopup, weight: w });
                                            updateLibrary(activeLibrary.id, {
                                                valueWeights: {
                                                    ...(activeLibrary.valueWeights || {}),
                                                    [weightPopup.value]: w
                                                }
                                            });
                                        }}
                                        className={`px-2 py-1 text-xs rounded ${weightPopup.weight === w
                                            ? 'bg-amber-500 text-black font-bold'
                                            : 'bg-zinc-700 text-zinc-300 hover:bg-zinc-600'
                                            }`}
                                    >
                                        {w}x
                                    </button>
                                ))}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* 指令转库弹窗 */}
            {workMode !== 'quick' && showInstructionToLibModal && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                        <div className="border-b border-zinc-700 p-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <ArrowRightLeft className="w-5 h-5 text-emerald-400" />
                                指令转库工具
                            </h2>
                            <button
                                onClick={() => {
                                    setShowInstructionToLibModal(false);
                                    setInstructionToLibInput('');
                                    setInstructionToLibResult(null);
                                    setExtractedBaseInstruction('');
                                    setTargetCountry('');
                                    setLocalizedResult(null);
                                    setLocalizedBaseInstruction('');
                                    setDirectTableInput('');
                                    setDirectBaseInstructionInput('');
                                }}
                                className="text-zinc-400 hover:text-white"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            {/* 说明 */}
                            <div className="p-3 bg-emerald-900/20 border border-emerald-500/30 rounded-lg">
                                <p className="text-sm text-emerald-300">
                                    💡 <strong>功能说明：</strong>粘贴通用的创意指令，AI会自动将其解析成分类好的库表格格式，可直接复制到 Google Sheets 使用。
                                </p>
                            </div>

                            {/* 输入区 */}
                            <section>
                                <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                                    <span className="w-5 h-5 bg-emerald-600 rounded-full text-xs flex items-center justify-center">1</span>
                                    粘贴通用创意指令
                                    {instructionToLibInput.trim() && (
                                        <button
                                            onClick={() => {
                                                setInstructionToLibInput('');
                                                setInstructionToLibResult(null);
                                            }}
                                            className="ml-auto text-xs text-zinc-500 hover:text-red-400"
                                        >
                                            清空
                                        </button>
                                    )}
                                </h3>
                                <textarea
                                    value={instructionToLibInput}
                                    onChange={(e) => setInstructionToLibInput(e.target.value)}
                                    placeholder={`粘贴你的创意指令，例如：

赛博朋克风格的城市街头，机甲战士在雨中巡逻，霓虹灯光闪烁，未来科技感，电影级镜头

或者多条指令：
1. 水彩画风格的森林场景，小精灵在采蘑菇
2. 油画质感的海边，少女望向远方，夕阳西下
3. 像素艺术的太空站，宇航员正在修理飞船`}
                                    className="w-full h-40 bg-zinc-800 border border-zinc-700 rounded-lg p-3 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500/30 resize-none"
                                />
                            </section>

                            {/* 转换按钮 */}
                            <div className="flex justify-center">
                                <button
                                    onClick={handleInstructionToLibConvert}
                                    disabled={!instructionToLibInput.trim() || instructionToLibConverting}
                                    className="px-6 py-2.5 bg-gradient-to-r from-emerald-600 to-teal-600 hover:from-emerald-500 hover:to-teal-500 disabled:from-zinc-700 disabled:to-zinc-700 text-white font-medium rounded-lg flex items-center gap-2 transition-all"
                                >
                                    {instructionToLibConverting ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            AI 解析中...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles size={16} />
                                            智能解析为库表格
                                        </>
                                    )}
                                </button>
                            </div>

                            {/* 基础指令预览 */}
                            {extractedBaseInstruction && (
                                <section>
                                    <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                                        <span className="w-5 h-5 bg-blue-600 rounded-full text-xs flex items-center justify-center">2</span>
                                        提取的基础指令
                                        <button
                                            onClick={copyExtractedBaseInstruction}
                                            className="ml-auto text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                                        >
                                            <Copy size={12} />
                                            复制
                                        </button>
                                    </h3>
                                    <div className="border border-blue-500/30 bg-blue-900/20 rounded-lg p-3">
                                        <pre className="text-sm text-blue-200 whitespace-pre-wrap font-sans">{extractedBaseInstruction}</pre>
                                    </div>
                                </section>
                            )}

                            {/* 随机库表格预览 */}
                            {instructionToLibResult && (
                                <section>
                                    <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                                        <span className="w-5 h-5 bg-emerald-600 rounded-full text-xs flex items-center justify-center">3</span>
                                        随机库数据
                                        <span className="text-xs text-zinc-500">
                                            {instructionToLibResult.headers.length} 列 × {instructionToLibResult.rows.length} 行
                                        </span>
                                        <button
                                            onClick={copyInstructionToLibResult}
                                            className="ml-auto text-xs text-emerald-400 hover:text-emerald-300 flex items-center gap-1"
                                        >
                                            <Copy size={12} />
                                            复制表格
                                        </button>
                                    </h3>
                                    <div className="border border-zinc-700 rounded-lg overflow-hidden">
                                        <div className="overflow-x-auto max-h-64 overflow-y-auto">
                                            <table className="text-xs w-full">
                                                <thead className="bg-zinc-700 sticky top-0">
                                                    <tr>
                                                        {instructionToLibResult.headers.map((h, i) => (
                                                            <th key={i} className="px-3 py-2 text-left font-medium text-emerald-300 whitespace-nowrap">
                                                                {h}
                                                            </th>
                                                        ))}
                                                    </tr>
                                                </thead>
                                                <tbody className="divide-y divide-zinc-800/50">
                                                    {instructionToLibResult.rows.map((row, ri) => (
                                                        <tr key={ri} className="hover:bg-zinc-800/30">
                                                            {row.map((cell, ci) => (
                                                                <td key={ci} className={`px-3 py-2 whitespace-nowrap ${cell ? 'text-white' : 'text-zinc-600'}`}>
                                                                    {cell || '-'}
                                                                </td>
                                                            ))}
                                                        </tr>
                                                    ))}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                    <p className="text-xs text-zinc-500 mt-2">
                                        📋 点击"复制表格"后，可直接粘贴到 Google Sheets 中使用
                                    </p>
                                </section>
                            )}

                            {/* ============ 本地化功能区域（始终显示）============ */}
                            <section className="border-t border-zinc-700 pt-4 mt-4">
                                <h3 className="text-sm font-medium text-zinc-300 mb-3 flex items-center gap-2">
                                    <span className="w-5 h-5 bg-orange-600 rounded-full text-xs flex items-center justify-center">★</span>
                                    指令 + 库本地化
                                    <span className="text-xs text-zinc-500">将基础指令和随机库内容一起调整为其他国家特色</span>
                                </h3>

                                {/* 数据来源说明 */}
                                <div className="p-2 bg-orange-900/20 border border-orange-500/30 rounded-lg mb-3">
                                    <p className="text-xs text-orange-300">
                                        💡 <strong>数据来源：</strong>
                                        {(instructionToLibResult || extractedBaseInstruction)
                                            ? '使用上方解析结果，AI 会同时本地化基础指令和随机库。也可在下方直接粘贴覆盖'
                                            : '请在下方直接粘贴随机库表格（从 Google Sheets 复制），并粘贴基础指令以便一起本地化'}
                                    </p>
                                </div>

                                {/* 直接粘贴表格区域 */}
                                <div className="grid grid-cols-2 gap-3 mb-3">
                                    <div>
                                        <label className="text-xs text-zinc-400 mb-1 block">随机库表格（TSV格式）</label>
                                        <textarea
                                            value={directTableInput}
                                            onChange={(e) => setDirectTableInput(e.target.value)}
                                            placeholder="直接粘贴表格数据（从 Google Sheets 复制）&#10;例如：&#10;风格&#9;场景&#9;人物&#10;水墨画&#9;故宫&#9;古装美女&#10;国潮风&#9;长城&#9;武士"
                                            className="w-full h-28 bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500 resize-none font-mono"
                                        />
                                    </div>
                                    <div>
                                        <label className="text-xs text-zinc-400 mb-1 block">基础指令（可选）</label>
                                        <textarea
                                            value={directBaseInstructionInput}
                                            onChange={(e) => setDirectBaseInstructionInput(e.target.value)}
                                            placeholder="粘贴基础指令（可选）&#10;例如：生成一张中国风插画，画面精美..."
                                            className="w-full h-28 bg-zinc-800 border border-zinc-700 rounded-lg p-2 text-xs text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500 resize-none"
                                        />
                                    </div>
                                </div>

                                {/* 目标国家输入 */}
                                <div className="flex gap-2 items-center mb-3">
                                    <input
                                        type="text"
                                        value={targetCountry}
                                        onChange={(e) => setTargetCountry(e.target.value)}
                                        placeholder="输入目标国家（如：日本、美国、法国、韩国...）"
                                        className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500"
                                    />
                                    <button
                                        onClick={handleLocalizeLibrary}
                                        disabled={!targetCountry.trim() || localizing}
                                        className="px-4 py-2 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 disabled:from-zinc-700 disabled:to-zinc-700 text-white font-medium rounded-lg flex items-center gap-2 text-sm whitespace-nowrap"
                                    >
                                        {localizing ? (
                                            <>
                                                <Loader2 size={14} className="animate-spin" />
                                                本地化中...
                                            </>
                                        ) : (
                                            <>
                                                <Sparkles size={14} />
                                                智能本地化
                                            </>
                                        )}
                                    </button>
                                </div>

                                {/* 常用国家快捷按钮 */}
                                <div className="flex gap-1.5 flex-wrap mb-3">
                                    <span className="text-xs text-zinc-500 font-medium">🇪🇺 欧盟</span>
                                    {['法国', '德国', '意大利', '西班牙', '荷兰', '波兰', '奥地利', '比利时', '瑞典', '葡萄牙', '希腊', '捷克', '爱尔兰', '立陶宛'].map(country => (
                                        <button
                                            key={country}
                                            onClick={() => setTargetCountry(country)}
                                            className={`px-2 py-0.5 text-xs rounded ${targetCountry === country ? 'bg-orange-600 text-white' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}`}
                                        >
                                            {country}
                                        </button>
                                    ))}
                                    <span className="w-px h-4 bg-zinc-600 mx-1" />
                                    <span className="text-xs text-zinc-500 font-medium">🌏 其他</span>
                                    {['英国', '美国', '印度', '菲律宾', '乌克兰', '俄罗斯'].map(country => (
                                        <button
                                            key={country}
                                            onClick={() => setTargetCountry(country)}
                                            className={`px-2 py-0.5 text-xs rounded ${targetCountry === country ? 'bg-orange-600 text-white' : 'bg-zinc-700 text-zinc-400 hover:bg-zinc-600'}`}
                                        >
                                            {country}
                                        </button>
                                    ))}
                                </div>

                                {/* 本地化后的基础指令 */}
                                {localizedBaseInstruction && (
                                    <div className="mb-3">
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs text-orange-400">📝 本地化基础指令</span>
                                            <button onClick={copyLocalizedBaseInstruction} className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1">
                                                <Copy size={10} /> 复制
                                            </button>
                                        </div>
                                        <div className="border border-orange-500/30 bg-orange-900/20 rounded-lg p-3">
                                            <pre className="text-sm text-orange-200 whitespace-pre-wrap font-sans">{localizedBaseInstruction}</pre>
                                        </div>
                                    </div>
                                )}

                                {/* 本地化后的随机库表格 */}
                                {localizedResult && (
                                    <div>
                                        <div className="flex items-center justify-between mb-1">
                                            <span className="text-xs text-orange-400">📊 本地化随机库 ({localizedResult.headers.length} 列 × {localizedResult.rows.length} 行)</span>
                                            <button onClick={copyLocalizedResult} className="text-xs text-orange-400 hover:text-orange-300 flex items-center gap-1">
                                                <Copy size={10} /> 复制表格
                                            </button>
                                        </div>
                                        <div className="border border-orange-500/30 rounded-lg overflow-hidden">
                                            <div className="overflow-x-auto max-h-48 overflow-y-auto">
                                                <table className="text-xs w-full">
                                                    <thead className="bg-orange-900/50 sticky top-0">
                                                        <tr>
                                                            {localizedResult.headers.map((h, i) => (
                                                                <th key={i} className="px-3 py-2 text-left font-medium text-orange-300 whitespace-nowrap">
                                                                    {h}
                                                                </th>
                                                            ))}
                                                        </tr>
                                                    </thead>
                                                    <tbody className="divide-y divide-zinc-800/50">
                                                        {localizedResult.rows.map((row, ri) => (
                                                            <tr key={ri} className="hover:bg-orange-900/10">
                                                                {row.map((cell, ci) => (
                                                                    <td key={ci} className={`px-3 py-2 whitespace-nowrap ${cell ? 'text-white' : 'text-zinc-600'}`}>
                                                                        {cell || '-'}
                                                                    </td>
                                                                ))}
                                                            </tr>
                                                        ))}
                                                    </tbody>
                                                </table>
                                            </div>
                                        </div>
                                    </div>
                                )}
                            </section>
                        </div>

                        {/* 底部按钮 */}
                        <div className="border-t border-zinc-700 p-4 flex justify-end gap-2">
                            <button
                                onClick={() => {
                                    setShowInstructionToLibModal(false);
                                    setInstructionToLibInput('');
                                    setInstructionToLibResult(null);
                                    setExtractedBaseInstruction('');
                                    setTargetCountry('');
                                    setLocalizedResult(null);
                                    setLocalizedBaseInstruction('');
                                    setDirectTableInput('');
                                    setDirectBaseInstructionInput('');
                                }}
                                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-sm"
                            >
                                关闭
                            </button>
                            {instructionToLibResult && (
                                <button
                                    onClick={copyInstructionToLibResult}
                                    className="px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg text-sm flex items-center gap-2"
                                >
                                    <Copy size={14} />
                                    复制表格到剪贴板
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 图片转库弹窗 */}
            {workMode !== 'quick' && showImageToLibModal && (
                <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-[100] flex items-center justify-center p-4">
                    <div className="bg-zinc-900 border border-zinc-700 rounded-xl shadow-2xl max-w-4xl w-full max-h-[90vh] flex flex-col">
                        <div className="border-b border-zinc-700 p-4 flex items-center justify-between">
                            <h2 className="text-lg font-bold text-white flex items-center gap-2">
                                <ImageIcon className="w-5 h-5 text-orange-400" />
                                图片转库工具
                            </h2>
                            <button
                                onClick={() => {
                                    setShowImageToLibModal(false);
                                    setImageToLibImages([]);
                                    setImageToLibResult(null);
                                    setImageToLibBaseInstruction('');
                                }}
                                className="text-zinc-400 hover:text-white"
                            >
                                <X size={20} />
                            </button>
                        </div>

                        <div className="flex-1 overflow-y-auto p-5 space-y-4">
                            {/* 说明 */}
                            <div className="p-3 bg-orange-900/20 border border-orange-500/30 rounded-lg">
                                <p className="text-sm text-orange-300">
                                    💡 <strong>功能说明：</strong>上传多张参考图片，AI会分析它们的共同特征（风格、色彩、构图等），并生成可复用的随机库。
                                </p>
                            </div>

                            {/* 上传区 */}
                            <section>
                                <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                                    <span className="w-5 h-5 bg-orange-600 rounded-full text-xs flex items-center justify-center">1</span>
                                    上传参考图片
                                    <span className="text-xs text-zinc-500 ml-auto">支持拖拽、粘贴(Ctrl+V)、点击选择</span>
                                </h3>

                                {/* 上传区域 - 双列布局 */}
                                <div className="grid grid-cols-2 gap-3">
                                    {/* 左侧：点击或拖拽上传 */}
                                    <div
                                        className="border-2 border-dashed border-zinc-600 hover:border-orange-500/50 rounded-lg p-4 text-center cursor-pointer transition-colors"
                                        onClick={() => document.getElementById('image-to-lib-input')?.click()}
                                        onDragOver={(e) => { e.preventDefault(); e.stopPropagation(); }}
                                        onDrop={(e) => {
                                            e.preventDefault();
                                            e.stopPropagation();
                                            handleImageToLibUpload(e.dataTransfer.files);
                                        }}
                                    >
                                        <input
                                            id="image-to-lib-input"
                                            type="file"
                                            accept="image/*"
                                            multiple
                                            className="hidden"
                                            onChange={(e) => handleImageToLibUpload(e.target.files)}
                                        />
                                        <Upload className="w-10 h-10 text-zinc-500 mx-auto mb-2" />
                                        <p className="text-zinc-400 text-sm font-medium">点击选择</p>
                                        <p className="text-zinc-500 text-xs mt-1">或拖拽图片到这里</p>
                                    </div>

                                    {/* 右侧：粘贴区域 */}
                                    <div
                                        tabIndex={0}
                                        onPaste={handleImageToLibPaste}
                                        className="border-2 border-dashed border-zinc-600 hover:border-orange-500/50 focus:border-orange-500 focus:ring-2 focus:ring-orange-500/30 rounded-lg p-4 text-center cursor-text transition-colors outline-none"
                                    >
                                        <ClipboardPaste className="w-10 h-10 text-zinc-500 mx-auto mb-2" />
                                        <p className="text-zinc-400 text-sm font-medium">点击这里，然后 Ctrl+V</p>
                                        <p className="text-zinc-500 text-xs mt-1">粘贴图片或表格中的图片</p>
                                    </div>
                                </div>

                                {/* 已上传图片预览 */}
                                {imageToLibImages.length > 0 && (
                                    <div className="mt-3">
                                        <div className="flex items-center justify-between mb-2">
                                            <span className="text-xs text-zinc-400">已上传 {imageToLibImages.length} 张图片</span>
                                            <button
                                                onClick={() => setImageToLibImages([])}
                                                className="text-xs text-red-400 hover:text-red-300"
                                            >
                                                清空全部
                                            </button>
                                        </div>
                                        <div className="grid grid-cols-6 gap-2">
                                            {imageToLibImages.map(img => (
                                                <div key={img.id} className="relative group aspect-square rounded-lg overflow-hidden bg-zinc-800">
                                                    <img src={img.base64} alt={img.name} className="w-full h-full object-cover" />
                                                    <button
                                                        onClick={() => handleImageToLibDelete(img.id)}
                                                        className="absolute top-1 right-1 w-5 h-5 bg-red-600 hover:bg-red-500 rounded-full flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                                                    >
                                                        <X size={12} />
                                                    </button>
                                                </div>
                                            ))}
                                        </div>
                                    </div>
                                )}
                            </section>

                            {/* 用户描述输入 */}
                            <section>
                                <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                                    <span>💬</span> 辅助描述（可选）
                                </h3>
                                <textarea
                                    value={imageToLibUserDesc}
                                    onChange={(e) => setImageToLibUserDesc(e.target.value)}
                                    placeholder="描述这些图片的主题、用途或期望的分析方向，帮助AI更准确地提取特征...&#10;例如：这是立陶宛宗教祈祷卡片，需要提取人物姿势、宗教符号、边框样式、季节等维度"
                                    className="w-full h-20 px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-sm text-zinc-200 placeholder-zinc-500 focus:outline-none focus:border-orange-500 resize-none"
                                />
                            </section>

                            {/* 转换按钮 */}
                            <div className="flex justify-center">
                                <button
                                    onClick={handleImageToLibConvert}
                                    disabled={imageToLibImages.length === 0 || imageToLibConverting}
                                    className="px-6 py-2.5 bg-gradient-to-r from-orange-600 to-amber-600 hover:from-orange-500 hover:to-amber-500 disabled:from-zinc-700 disabled:to-zinc-700 text-white font-medium rounded-lg flex items-center gap-2 transition-all"
                                >
                                    {imageToLibConverting ? (
                                        <>
                                            <Loader2 size={16} className="animate-spin" />
                                            AI 分析中...
                                        </>
                                    ) : (
                                        <>
                                            <Sparkles size={16} />
                                            分析图片生成随机库
                                        </>
                                    )}
                                </button>
                            </div>

                            {/* 基础指令预览 */}
                            {imageToLibBaseInstruction && (
                                <section>
                                    <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                                        <span className="w-5 h-5 bg-blue-600 rounded-full text-xs flex items-center justify-center">2</span>
                                        提取的基础指令
                                        <button
                                            onClick={copyImageToLibBaseInstruction}
                                            className="ml-auto text-xs text-blue-400 hover:text-blue-300 flex items-center gap-1"
                                        >
                                            <Copy size={12} />
                                            复制
                                        </button>
                                    </h3>
                                    <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3">
                                        <p className="text-sm text-blue-200 whitespace-pre-wrap">{imageToLibBaseInstruction}</p>
                                    </div>
                                </section>
                            )}

                            {/* 结果表格预览 */}
                            {imageToLibResult && (
                                <section>
                                    <h3 className="text-sm font-medium text-zinc-300 mb-2 flex items-center gap-2">
                                        <span className="w-5 h-5 bg-green-600 rounded-full text-xs flex items-center justify-center">3</span>
                                        生成的随机库表格
                                        <span className="text-xs text-zinc-500">({imageToLibResult.headers.length} 列 × {imageToLibResult.rows.length} 行)</span>
                                    </h3>
                                    <div className="overflow-x-auto">
                                        <table className="w-full text-sm border border-zinc-700 rounded-lg overflow-hidden">
                                            <thead>
                                                <tr className="bg-zinc-800">
                                                    {imageToLibResult.headers.map((h, i) => (
                                                        <th key={i} className="border border-zinc-700 px-3 py-2 text-left text-green-400 font-medium">{h}</th>
                                                    ))}
                                                </tr>
                                            </thead>
                                            <tbody>
                                                {imageToLibResult.rows.map((row, ri) => (
                                                    <tr key={ri} className={ri % 2 === 0 ? 'bg-zinc-800/30' : 'bg-zinc-800/50'}>
                                                        {row.map((cell, ci) => (
                                                            <td key={ci} className="border border-zinc-700 px-3 py-2 text-zinc-300">{cell}</td>
                                                        ))}
                                                    </tr>
                                                ))}
                                            </tbody>
                                        </table>
                                    </div>
                                </section>
                            )}
                        </div>

                        {/* 底部按钮 */}
                        <div className="border-t border-zinc-700 p-4 flex justify-end gap-3">
                            <button
                                onClick={() => {
                                    setShowImageToLibModal(false);
                                    setImageToLibImages([]);
                                    setImageToLibResult(null);
                                    setImageToLibBaseInstruction('');
                                }}
                                className="px-4 py-2 bg-zinc-700 hover:bg-zinc-600 text-zinc-300 rounded-lg text-sm"
                            >
                                关闭
                            </button>
                            {imageToLibResult && (
                                <button
                                    onClick={copyImageToLibResult}
                                    className="px-4 py-2 bg-orange-600 hover:bg-orange-500 text-white rounded-lg text-sm flex items-center gap-2"
                                >
                                    <Copy size={14} />
                                    复制表格到剪贴板
                                </button>
                            )}
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
};

export default RandomLibraryManager;
